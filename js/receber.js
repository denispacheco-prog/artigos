// Janela aberta pelo bookmarklet: recebe o HTML da página que você está
// lendo, extrai o artigo AQUI (mesmo código da Action), mostra uma prévia e
// só grava quando você confirma.

import DOMPurify from '../vendor/purify-3.4.18.es.mjs';
import { sanitizar } from '../lib/sanitizar.js';
import { normalizarUrl } from '../lib/url.js';
import { extrairArtigo, textoNormalizado, avaliarExtracao, tempoDeLeitura, IMG_IRRELEVANTE } from '../lib/extrair-nucleo.js';
import * as dados from './dados.js';
import { $, el, plural } from './util.js';

const conteudo = $('#conteudo');
const TAMANHO_MAX = 20 * 1024 * 1024;
let recebido = false;

function mostrar(...filhos) {
  conteudo.replaceChildren(...filhos);
}

function erro(texto, { url = null } = {}) {
  mostrar(
    el('p', { class: 'receber-erro', text: texto }),
    el('div', { class: 'receber-acoes' }, url ? el('a', { class: 'btn-secundario', href: `./#salvar?url=${encodeURIComponent(url)}`, text: 'Tentar salvar pela URL' }) : null, el('button', { type: 'button', class: 'btn-secundario', onclick: () => close(), text: 'Fechar' })),
  );
}

// Se nada chegar, o site provavelmente bloqueia a comunicação entre janelas.
const espera = setTimeout(() => {
  if (!recebido) {
    erro('Nada chegou da página. Alguns sites bloqueiam a comunicação com outras janelas. Use o botão "+ Salvar" do Artigos com a URL, ou abra esta página pelo bookmarklet de novo.');
  }
}, 15000);

addEventListener('message', async (e) => {
  const d = e.data;
  if (recebido || !d || d.tipo !== 'artigos-pagina' || typeof d.html !== 'string' || typeof d.url !== 'string') return;
  recebido = true;
  clearTimeout(espera);
  try {
    e.source?.postMessage('artigos-recebido', e.origin);
  } catch {}
  // a página de origem precisa bater com a URL declarada (evita "empurrar" conteúdo de outro site)
  let origemDeclarada = null;
  try {
    origemDeclarada = new URL(d.url).origin;
  } catch {}
  if (!origemDeclarada || origemDeclarada !== e.origin) return erro('A página enviada não confere com o site de origem. Nada foi salvo.');
  if (d.html.length > TAMANHO_MAX) return erro('A página é grande demais para salvar.', { url: d.url });
  await processar(d.url, d.html);
});

async function processar(urlBruta, html) {
  mostrar(el('p', { class: 'receber-status', text: 'Extraindo o artigo…' }));
  const url = normalizarUrl(urlBruta);

  // monta o documento sem executar nada (DOMParser não roda scripts nem carrega imagens)
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = urlBruta;
  doc.head.prepend(base);

  const r = extrairArtigo(doc, { Readability: window.Readability, isProbablyReaderable: window.isProbablyReaderable });
  const agora = new Date().toISOString();
  if (!r.ok) return erro(`${r.erro} Tente pela URL ou abra o original.`, { url });

  const corpo = document.createElement('div');
  corpo.innerHTML = sanitizar(DOMPurify, r.html);
  const texto = textoNormalizado(corpo);
  const av = avaliarExtracao(texto, { dica: '' });
  const avisos = [...r.avisos, ...(av.aviso ? [av.aviso] : [])];

  // imagens ficam com o link original; a Action baixa depois
  const imagens = [];
  const vistas = new Set();
  for (const img of corpo.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!/^https:/i.test(src || '') || vistas.has(src.split('?')[0])) {
      (img.closest('figure') || img).remove();
      continue;
    }
    vistas.add(src.split('?')[0]);
    imagens.push({ src, originalSrc: src, hotlink: true });
  }
  let principal = null;
  if (r.metadados.imagem) {
    try {
      const src = new URL(r.metadados.imagem, urlBruta).toString();
      if (/^https:/i.test(src) && !IMG_IRRELEVANTE.test(src)) principal = { src, originalSrc: src, hotlink: true, inBody: vistas.has(src.split('?')[0]) };
    } catch {}
  }

  const artigo = {
    schema: 1,
    id: null,
    url,
    canonicalUrl: r.metadados.canonica && normalizarUrl(r.metadados.canonica) !== url ? normalizarUrl(r.metadados.canonica) : null,
    title: r.titulo,
    byline: r.autor,
    siteName: r.site || new URL(url).hostname.replace(/^www\d?\./, ''),
    lang: r.idioma,
    publishedAt: r.publicado,
    savedAt: agora,
    excerpt: (r.descricao || texto).slice(0, 220),
    leadImage: principal,
    wordCount: av.palavras,
    readingMinutes: tempoDeLeitura(av.palavras, imagens.length),
    contentHtml: corpo.innerHTML,
    textHash: null,
    images: imagens,
    extraction: { method: 'bookmarklet', status: av.status, tool: 'readability@0.6.0', at: agora, warnings: [...new Set(avisos)], error: av.erro || null },
    edits: [],
  };

  await mostrarPrevia(artigo);
}

async function mostrarPrevia(artigo) {
  let existente = null;
  try {
    await dados.carregarIndice();
    existente = dados.artigosDoIndice().find((a) => a.url === artigo.url) || null;
  } catch (e) {
    return erro(e instanceof dados.SemToken ? 'Este navegador ainda não tem o token do GitHub. Abra o Artigos, configure o token (menu ⋯) e tente de novo.' : e.message);
  }

  const resumo = artigo.contentHtml ? textoNormalizado(Object.assign(document.createElement('div'), { innerHTML: artigo.contentHtml })).slice(0, 320) : '';
  const rotulo = { ok: '✓ texto completo', partial: '⚠ talvez incompleto', failed: '✕ quase nada extraído' }[artigo.extraction.status];
  // não deixar uma extração pior apagar um texto bom sem avisar
  const ordem = { ok: 2, partial: 1, failed: 0 };
  const pior = existente && (ordem[artigo.extraction.status] ?? 0) < (ordem[existente.extraction] ?? 0);
  const rotuloBotao = pior ? 'Substituir mesmo assim' : existente ? 'Substituir o texto salvo' : artigo.extraction.status === 'failed' ? 'Salvar mesmo assim' : 'Salvar';
  const botao = el('button', { type: 'button', class: pior || artigo.extraction.status === 'failed' ? 'btn-secundario' : 'btn-primario', text: rotuloBotao });
  const status = el('p', { class: 'dica', 'aria-live': 'polite' });

  botao.addEventListener('click', async () => {
    botao.disabled = true;
    status.textContent = 'Salvando…';
    try {
      const e = await dados.salvarArtigoPronto(artigo);
      mostrar(
        el('p', { class: 'receber-ok', text: existente ? 'Texto substituído. ✓' : 'Salvo no Artigos. ✓' }),
        artigo.images.length || artigo.leadImage ? el('p', { class: 'dica', text: 'As imagens serão copiadas para o seu repositório em 1 a 2 minutos.' }) : null,
        el('div', { class: 'receber-acoes' }, el('a', { class: 'btn-secundario', href: `./#/ler/${e.id}`, target: 'artigos', text: 'Abrir no Artigos' }), el('button', { type: 'button', class: 'btn-secundario', onclick: () => close(), text: 'Fechar' })),
      );
      setTimeout(() => close(), 4000);
    } catch (err) {
      status.textContent = `Não foi possível salvar: ${err.message}`;
      botao.disabled = false;
    }
  });

  mostrar(
    el(
      'article',
      { class: 'receber-previa' },
      el('p', { class: 'item-fonte' }, el('span', { class: 'item-site', text: artigo.siteName || '' }), el('span', { class: 'item-sep', text: plural(artigo.wordCount, 'palavra', 'palavras') }), el('span', { class: 'item-sep', text: `${artigo.readingMinutes} min` })),
      el('h1', { class: 'receber-titulo', text: artigo.title || artigo.url }),
      artigo.byline ? el('p', { class: 'dica', text: artigo.byline }) : null,
      el('p', { class: `receber-selo st-${artigo.extraction.status}`, text: rotulo }),
      resumo ? el('p', { class: 'receber-resumo', text: resumo + '…' }) : null,
      pior
        ? el('p', { class: 'receber-aviso receber-aviso-forte', text: `Atenção: a versão já salva está mais completa (${plural(existente.wordCount || 0, 'palavra', 'palavras')}) do que esta (${plural(artigo.wordCount, 'palavra', 'palavras')}). Substituir apaga o texto bom.` })
        : existente
          ? el('p', { class: 'receber-aviso', text: `Este artigo já está salvo${existente.extraction === 'failed' ? ' (a extração automática tinha falhado)' : ''}. Salvar de novo substitui o texto e mantém seus highlights, notas e tags.` })
          : null,
      artigo.extraction.error ? el('p', { class: 'receber-aviso', text: artigo.extraction.error }) : null,
    ),
    el('div', { class: 'receber-acoes' }, botao, el('button', { type: 'button', class: 'btn-secundario', onclick: () => close(), text: 'Cancelar' })),
    status,
  );
  botao.focus();
}

// sem janela de origem: aberta à mão, ou o site cortou o vínculo entre as janelas
if (!opener) {
  clearTimeout(espera);
  erro('Nada chegou da página. Esta janela é aberta pelo bookmarklet "→ artigos" (veja como instalar no menu ⋯ do Artigos). Se você usou o bookmarklet, este site bloqueia a comunicação entre janelas: salve pelo botão "+ Salvar" com a URL.');
}
