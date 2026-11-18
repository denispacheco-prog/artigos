// Artigos — app: lista, leitura, preferências (M2); highlights, notas, tags,
// busca e backup (M3). Dados locais até o M4.

import DOMPurify from '../vendor/purify-3.4.18.es.mjs';
import { sanitizar } from '../lib/sanitizar.js';
import { termosDaConsulta } from '../lib/busca.js';
import * as dados from './dados.js';
import * as anotacoes from './anotacoes.js';
import * as busca from './busca.js';
import { desenharVistaHighlights } from './vista-highlights.js';
import { $, el, svg, ICONES, dataCurta, dataLonga, armazenamento, avisar, debounce, plural } from './util.js';

dados.aoErrar((e) => avisar(e.message));

// ======================================================================
// tema (modelo do meus-bookmarks; chave artigos:theme)
// ======================================================================

function temaEfetivo() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function desenharBotoesTema() {
  const escuro = temaEfetivo() === 'dark';
  for (const b of document.querySelectorAll('.js-tema')) {
    b.replaceChildren(svg(escuro ? ICONES.sol : ICONES.lua, { tamanho: 16 }));
    b.title = escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    b.setAttribute('aria-label', b.title);
  }
}

for (const b of document.querySelectorAll('.js-tema')) {
  b.addEventListener('click', () => {
    const proximo = temaEfetivo() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', proximo);
    try {
      localStorage.setItem('artigos:theme', proximo);
    } catch {}
    desenharBotoesTema();
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', desenharBotoesTema);

// ======================================================================
// estado da lista
// ======================================================================

const FILTROS = [
  { id: 'ler', nome: 'Para ler', teste: (a) => !a.archivedAt },
  { id: 'favoritos', nome: 'Favoritos', teste: (a) => a.favorite },
  { id: 'arquivados', nome: 'Arquivados', teste: (a) => !!a.archivedAt },
  { id: 'highlights', nome: 'Highlights', contar: (todos) => todos.reduce((s, a) => s + (a.highlightCount || 0), 0) },
];

const estado = {
  filtro: armazenamento.ler('artigos:filtro', 'ler'),
  tag: null,
  busca: '',
  cores: new Set(),
};
if (!FILTROS.some((f) => f.id === estado.filtro)) estado.filtro = 'ler';

// ======================================================================
// lista
// ======================================================================

let geracao = 0; // descarta desenhos assíncronos que ficaram velhos

async function desenharLista() {
  const minha = ++geracao;
  const todos = dados.artigosDoIndice();
  const buscando = estado.busca.trim().length >= 2;

  // filtros com contagem
  $('#filtros').replaceChildren(
    ...FILTROS.map((f) =>
      el(
        'button',
        {
          type: 'button',
          class: 'filtro' + (f.id === estado.filtro && !buscando ? ' ativo' : ''),
          'aria-current': f.id === estado.filtro ? 'true' : null,
          onclick: () => {
            estado.filtro = f.id;
            armazenamento.gravar('artigos:filtro', f.id);
            if (estado.busca) {
              estado.busca = '';
              $('#busca').value = '';
            }
            desenharLista();
          },
        },
        el('span', { text: f.nome }),
        el('span', { class: 'filtro-n', text: String(f.contar ? f.contar(todos) : todos.filter(f.teste).length) }),
      ),
    ),
  );

  // tags
  const contagemTags = dados.todasAsTags();
  const nuvem = $('#nuvem-tags');
  if (!contagemTags.size) {
    nuvem.replaceChildren(el('p', { class: 'nota-vazia', text: 'Nenhuma tag ainda. Adicione no painel ✎ de um artigo.' }));
  } else {
    nuvem.replaceChildren(
      ...[...contagemTags.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
        .map(([t, n]) => el('button', { type: 'button', class: 'tag' + (t === estado.tag ? ' ativa' : ''), title: plural(n, 'artigo', 'artigos'), onclick: () => escolherTag(t === estado.tag ? null : t) }, t)),
    );
  }

  // filtro de tag ativo
  const ativos = $('#filtros-ativos');
  ativos.hidden = !estado.tag || buscando;
  if (estado.tag) {
    ativos.replaceChildren(
      el('span', { class: 'filtros-ativos-rotulo', text: 'Filtrando por' }),
      el('span', { class: 'chip' }, el('span', { class: 'tag ativa', text: estado.tag }), el('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover filtro', onclick: () => escolherTag(null) }, '✕')),
    );
  }

  const lista = $('#lista');
  const vazio = $('#vazio');
  vazio.hidden = true;

  if (buscando) return desenharBusca(minha);

  if (estado.filtro === 'highlights') {
    return desenharVistaHighlights(lista, $('#contagem'), { cores: estado.cores, tag: estado.tag }, (cores) => {
      estado.cores = cores;
      desenharLista();
    });
  }

  const filtro = FILTROS.find((f) => f.id === estado.filtro);
  const itens = todos
    .filter(filtro.teste)
    .filter((a) => !estado.tag || (a.tags || []).includes(estado.tag))
    .sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));

  $('#contagem').textContent = `${plural(itens.length, 'artigo', 'artigos')} · ${filtro.nome}`;
  lista.replaceChildren(...itens.map((a) => itemDaLista(a)));

  vazio.hidden = itens.length > 0;
  if (!itens.length) {
    vazio.textContent = !todos.length
      ? 'Nenhum artigo salvo ainda. Use "+ Salvar" para ver como adicionar.'
      : estado.filtro === 'arquivados'
        ? 'Nenhum artigo arquivado.'
        : estado.filtro === 'favoritos'
          ? 'Nenhum favorito ainda. Use ☆ para marcar.'
          : estado.tag
            ? 'Nenhum artigo com essa tag aqui.'
            : 'Tudo lido. 🎉';
  }
}

function escolherTag(t) {
  estado.tag = t;
  desenharLista();
}

// ---------------------------------------------------------------- busca

async function desenharBusca(minha) {
  const consulta = estado.busca.trim();
  const lista = $('#lista');
  const r = await busca.buscar(consulta);
  if (minha !== geracao) return;

  const q = encodeURIComponent(consulta);
  const secao = (titulo, n) => el('li', { class: 'secao-busca' }, el('h2', { class: 'titulo-secao', text: `${titulo} · ${n}` }));
  const partes = [];

  if (r.artigos.length) {
    partes.push(secao('Artigos', r.artigos.length));
    r.artigos.forEach(({ entrada }, i) => partes.push(itemDaLista(entrada, { consulta: q, trecho: i < 20 ? consulta : null })));
  }
  if (r.highlights.length) {
    partes.push(secao('Highlights', r.highlights.length));
    for (const { entrada, h } of r.highlights) {
      const exact = h.target.selector.find((s) => s.type === 'TextQuoteSelector')?.exact || '';
      partes.push(
        el(
          'li',
          { class: `citacao citacao-busca hl-borda-${h.color}` },
          el('a', { class: 'citacao-texto', href: `#/ler/${entrada.id}?hl=${h.id}` }, exact),
          h.note?.trim() ? el('p', { class: 'citacao-nota', text: h.note }) : null,
          el('p', { class: 'citacao-origem', text: `${entrada.title} · ${entrada.siteName || ''}` }),
        ),
      );
    }
  }
  if (r.notas.length) {
    partes.push(secao('Notas', r.notas.length));
    for (const { entrada, nota } of r.notas) {
      partes.push(el('li', { class: 'nota-busca' }, el('a', { href: `#/ler/${entrada.id}`, class: 'citacao-texto' }, nota), el('p', { class: 'citacao-origem', text: `${entrada.title} · ${entrada.siteName || ''}` })));
    }
  }

  const total = r.artigos.length + r.highlights.length + r.notas.length;
  $('#contagem').textContent = `${plural(total, 'resultado', 'resultados')} para “${consulta}”`;
  lista.replaceChildren(...partes);
  const vazio = $('#vazio');
  vazio.hidden = total > 0;
  vazio.textContent = r.semIndice ? 'Nada encontrado. O índice de busca ainda não existe: rode "npm run indexar" no terminal.' : 'Nada encontrado no texto, nos highlights nem nas notas.';
}

// ---------------------------------------------------------------- item

function itemDaLista(a, { consulta = null, trecho = null } = {}) {
  const lido = !!a.readAt;
  const link = `#/ler/${a.id}${consulta ? `?q=${consulta}` : ''}`;
  const thumb = a.leadImage ? el('img', { class: 'item-thumb', src: dados.urlMidia(a.leadImage), alt: '', loading: 'lazy', decoding: 'async' }) : null;
  const status =
    a.extraction === 'partial' ? el('span', { class: 'selo selo-parcial', title: 'Extração possivelmente incompleta', text: 'parcial' }) : a.extraction === 'failed' ? el('span', { class: 'selo selo-falha', title: 'A extração falhou', text: 'falhou' }) : null;
  const resumo = el('p', { class: 'item-resumo', text: a.excerpt || '' });

  if (trecho) {
    busca.trechoDoArtigo(a.id, trecho).then((t) => {
      if (t) resumo.replaceChildren(t.antes, el('mark', { class: 'termo', text: t.termo }), t.depois);
    });
  }

  return el(
    'li',
    { class: 'item' + (lido ? ' lido' : ''), 'data-id': a.id },
    el(
      'div',
      { class: 'item-texto' },
      el(
        'div',
        { class: 'item-fonte' },
        el('span', { class: 'favicon', 'aria-hidden': 'true', text: (a.siteName || '?').trim().charAt(0).toUpperCase() }),
        el('span', { class: 'item-site', text: a.siteName || '' }),
        a.publishedAt || a.savedAt ? el('span', { class: 'item-sep', text: dataCurta(a.publishedAt || a.savedAt) }) : null,
        a.readingMinutes ? el('span', { class: 'item-sep', text: `${a.readingMinutes} min` }) : null,
        status,
        consulta && a.archivedAt ? el('span', { class: 'selo selo-neutro', text: 'arquivado' }) : null,
      ),
      el('h3', { class: 'item-titulo' }, el('a', { href: link }, a.title || a.url)),
      a.excerpt || trecho ? resumo : null,
      el(
        'div',
        { class: 'item-meta' },
        a.highlightCount ? el('a', { class: 'item-contador', href: `#/ler/${a.id}`, title: 'Highlights', text: plural(a.highlightCount, 'highlight', 'highlights') }) : null,
        a.hasNote ? el('span', { class: 'item-contador', text: 'nota' }) : null,
        ...(a.tags || []).map((t) => el('button', { type: 'button', class: 'tag', onclick: () => escolherTag(t) }, t)),
        el(
          'div',
          { class: 'item-acoes' },
          botaoFavorito(a, 'acao'),
          botaoArquivar(a, 'acao'),
          el('a', { class: 'acao', href: a.url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir o original', 'aria-label': 'Abrir o original' }, svg(ICONES.original, { tamanho: 15 })),
        ),
      ),
    ),
    thumb ? el('a', { href: link, class: 'item-thumb-link', tabindex: '-1', 'aria-hidden': 'true' }, thumb) : null,
  );
}

function botaoFavorito(a, classe) {
  const b = el('button', { type: 'button', class: classe });
  const desenhar = () => {
    b.replaceChildren(svg(ICONES.estrela, { tamanho: classe === 'acao' ? 15 : 17, preenchido: a.favorite }));
    b.classList.toggle('ativo-estrela', !!a.favorite);
    b.title = a.favorite ? 'Tirar dos favoritos' : 'Favoritar';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', a.favorite ? 'true' : 'false');
  };
  desenhar();
  b.addEventListener('click', () => {
    dados.atualizar(a.id, { favorite: !a.favorite });
    desenhar();
    if (b.closest('#vista-lista')) desenharLista();
  });
  return b;
}

function botaoArquivar(a, classe) {
  const b = el('button', { type: 'button', class: classe });
  const desenhar = () => {
    b.replaceChildren(svg(a.archivedAt ? ICONES.desarquivar : ICONES.arquivar, { tamanho: classe === 'acao' ? 15 : 17 }));
    b.title = a.archivedAt ? 'Voltar para "Para ler"' : 'Arquivar';
    b.setAttribute('aria-label', b.title);
  };
  desenhar();
  b.addEventListener('click', () => {
    const arquivar = !a.archivedAt;
    dados.atualizar(a.id, { archivedAt: arquivar ? new Date().toISOString() : null, ...(arquivar && !a.readAt ? { readAt: new Date().toISOString() } : {}) });
    desenhar();
    avisar(arquivar ? 'Arquivado.' : 'De volta em "Para ler".');
    if (b.closest('#vista-lista')) desenharLista();
  });
  return b;
}

const buscarDepois = debounce(() => desenharLista(), 200);
$('#busca').addEventListener('input', (e) => {
  estado.busca = e.target.value;
  buscarDepois();
});

const dialogoSalvar = $('#dialogo-salvar');
$('#btn-salvar').addEventListener('click', () => dialogoSalvar.showModal());
dialogoSalvar.querySelector('.js-fechar').addEventListener('click', () => dialogoSalvar.close());
dialogoSalvar.addEventListener('click', (e) => {
  if (e.target === dialogoSalvar) dialogoSalvar.close();
});

// ---------------------------------------------------------------- backup

const menu = $('.header-menu');
document.addEventListener('click', (e) => {
  if (menu.open && !e.composedPath().includes(menu)) menu.open = false;
});

$('#btn-exportar').addEventListener('click', async () => {
  menu.open = false;
  avisar('Preparando backup…');
  try {
    const backup = await dados.exportarBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `artigos-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    avisar(`Backup exportado: ${plural(backup.articles.length, 'artigo', 'artigos')}.`);
  } catch (e) {
    avisar(`Não foi possível exportar: ${e.message}`);
  }
});

$('#btn-importar').addEventListener('click', () => {
  menu.open = false;
  $('#arquivo-importar').click();
});

$('#arquivo-importar').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  try {
    const b = JSON.parse(await arquivo.text());
    const n = b.articles?.length ?? 0;
    if (!confirm(`Importar ${plural(n, 'artigo', 'artigos')} deste backup?\n\nArtigos, notas e highlights com o mesmo identificador serão substituídos pelos do backup. O resto fica como está.`)) return;
    const r = await dados.importarBackup(b);
    busca.reiniciar();
    avisar(`Importado: ${plural(r.artigos, 'artigo', 'artigos')}.`);
    desenharLista();
  } catch (err) {
    avisar(err instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : err.message);
  }
});

// ======================================================================
// preferências de leitura (localStorage artigos:leitura)
// ======================================================================

const FONTES = [
  { id: 'literata', nome: 'Literata' },
  { id: 'source-serif', nome: 'Source Serif' },
  { id: 'georgia', nome: 'Georgia' },
  { id: 'inter', nome: 'Inter' },
  { id: 'atkinson', nome: 'Atkinson' },
  { id: 'sistema', nome: 'Sistema' },
];
const ENTRELINHAS = [
  { id: 'compacta', nome: 'Compacta', valor: 1.45 },
  { id: 'normal', nome: 'Normal', valor: 1.6 },
  { id: 'ampla', nome: 'Ampla', valor: 1.8 },
];
const LARGURAS = [
  { id: 'estreita', nome: 'Estreita', valor: '32rem' },
  { id: 'media', nome: 'Média', valor: '38rem' },
  { id: 'larga', nome: 'Larga', valor: '46rem' },
];
const FUNDOS = [
  { id: 'auto', nome: 'Automático (segue o tema)' },
  { id: 'claro', nome: 'Claro' },
  { id: 'sepia', nome: 'Sépia' },
  { id: 'cinza', nome: 'Cinza' },
  { id: 'escuro', nome: 'Escuro' },
];
const TAMANHO_MIN = 15;
const TAMANHO_MAX = 28;

const PREFS_PADRAO = { fonte: 'literata', tamanho: matchMedia('(max-width: 600px)').matches ? 18 : 20, entrelinha: 'normal', largura: 'media', fundo: 'auto' };
let prefs = { ...PREFS_PADRAO, ...armazenamento.ler('artigos:leitura', {}) };

function aplicarPrefs() {
  const l = $('#leitura');
  l.dataset.fonte = prefs.fonte;
  l.dataset.fundo = prefs.fundo;
  l.style.setProperty('--read-size', `${prefs.tamanho}px`);
  l.style.setProperty('--read-leading', (ENTRELINHAS.find((e) => e.id === prefs.entrelinha) || ENTRELINHAS[1]).valor);
  l.style.setProperty('--read-width', (LARGURAS.find((e) => e.id === prefs.largura) || LARGURAS[1]).valor);
  document.body.dataset.fundo = prefs.fundo;
}

function mudarPref(chave, valor) {
  prefs = { ...prefs, [chave]: valor };
  armazenamento.gravar('artigos:leitura', prefs);
  aplicarPrefs();
  desenharPainelPrefs();
}

function grupoOpcoes(rotulo, opcoes, atual, chave, extra = () => ({})) {
  return el(
    'div',
    { class: 'pref' },
    el('span', { class: 'pref-rotulo', text: rotulo }),
    el(
      'div',
      { class: 'pref-opcoes', role: 'radiogroup', 'aria-label': rotulo },
      ...opcoes.map((o) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': o.id === atual ? 'true' : 'false',
            class: 'pref-op' + (o.id === atual ? ' ativa' : ''),
            title: o.nome,
            onclick: () => mudarPref(chave, o.id),
            ...extra(o),
          },
          o.conteudo || o.nome,
        ),
      ),
    ),
  );
}

function iconeBarras(posicoes) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', 20);
  s.setAttribute('height', 20);
  s.setAttribute('aria-hidden', 'true');
  for (const [x, y, w] of posicoes) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', y);
    r.setAttribute('width', w);
    r.setAttribute('height', 2);
    r.setAttribute('rx', 1);
    r.setAttribute('fill', 'currentColor');
    s.append(r);
  }
  return s;
}
const iconeLinhas = (esp) => iconeBarras([0, 1, 2].map((i) => [4, 11 - esp + i * esp, 16]));
const iconeLargura = (w) => iconeBarras([7, 11, 15].map((y) => [12 - w / 2, y, w]));

function desenharPainelPrefs() {
  const painel = $('#painel-prefs');
  painel.replaceChildren(
    grupoOpcoes('Fonte', FONTES, prefs.fonte, 'fonte', (o) => ({ class: `pref-op pref-fonte fonte-${o.id}` + (o.id === prefs.fonte ? ' ativa' : '') })),
    el(
      'div',
      { class: 'pref' },
      el('span', { class: 'pref-rotulo', text: 'Tamanho' }),
      el(
        'div',
        { class: 'pref-tamanho' },
        el('button', { type: 'button', class: 'pref-op', 'aria-label': 'Diminuir texto', disabled: prefs.tamanho <= TAMANHO_MIN, onclick: () => mudarPref('tamanho', prefs.tamanho - 1) }, el('span', { class: 'a-menor', text: 'A' })),
        el('span', { class: 'pref-valor', text: `${prefs.tamanho}px` }),
        el('button', { type: 'button', class: 'pref-op', 'aria-label': 'Aumentar texto', disabled: prefs.tamanho >= TAMANHO_MAX, onclick: () => mudarPref('tamanho', prefs.tamanho + 1) }, el('span', { class: 'a-maior', text: 'A' })),
      ),
    ),
    grupoOpcoes('Entrelinha', ENTRELINHAS.map((e, i) => ({ ...e, conteudo: iconeLinhas(4 + i * 2) })), prefs.entrelinha, 'entrelinha'),
    grupoOpcoes('Largura', LARGURAS.map((e, i) => ({ ...e, conteudo: iconeLargura(8 + i * 5) })), prefs.largura, 'largura'),
    grupoOpcoes('Fundo', FUNDOS.map((f) => ({ ...f, conteudo: el('span', { class: `amostra-fundo fundo-${f.id}`, 'aria-hidden': 'true' }) })), prefs.fundo, 'fundo', (o) => ({
      class: 'pref-op pref-fundo' + (o.id === prefs.fundo ? ' ativa' : ''),
      'aria-label': o.nome,
    })),
    el('button', {
      type: 'button',
      class: 'pref-restaurar',
      onclick: () => {
        prefs = { ...PREFS_PADRAO };
        armazenamento.gravar('artigos:leitura', prefs);
        aplicarPrefs();
        desenharPainelPrefs();
      },
    }, 'Restaurar padrão'),
  );
}

const btnPrefs = $('#btn-prefs');
const painelPrefs = $('#painel-prefs');
function abrirPrefs(abrir) {
  painelPrefs.hidden = !abrir;
  btnPrefs.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  btnPrefs.classList.toggle('ativo', abrir);
  if (abrir) desenharPainelPrefs();
}
btnPrefs.addEventListener('click', () => abrirPrefs(painelPrefs.hidden));
document.addEventListener('click', (e) => {
  // composedPath: o botão clicado já pode ter sido trocado ao redesenhar o painel
  const caminho = e.composedPath();
  if (!painelPrefs.hidden && !caminho.includes(painelPrefs) && !caminho.includes(btnPrefs)) abrirPrefs(false);
});

// ======================================================================
// leitura
// ======================================================================

let artigoAberto = null;

async function abrirArtigo(id, { consulta = null, hl = null } = {}) {
  const a = dados.entrada(id);
  if (!a) {
    avisar('Artigo não encontrado.');
    location.hash = '#/';
    return;
  }
  const mesmoArtigo = artigoAberto === a && $('#artigo .artigo-corpo');
  artigoAberto = a;
  mostrar('leitura');
  aplicarPrefs();

  // mesmo artigo, só mudou o destino (ex.: clicar em outro highlight)
  if (mesmoArtigo) {
    if (hl) anotacoes.irPara(hl);
    return;
  }

  document.title = `${a.title || 'Artigo'} · Artigos`;
  $('#barra-titulo').textContent = [a.siteName, a.readingMinutes ? `${a.readingMinutes} min` : null].filter(Boolean).join(' · ');
  $('#btn-favorito').replaceWith(Object.assign(botaoFavorito(a, 'icon-btn'), { id: 'btn-favorito' }));
  $('#btn-arquivar').replaceWith(Object.assign(botaoArquivar(a, 'icon-btn'), { id: 'btn-arquivar' }));
  $('#btn-original').href = a.url;

  const artigo = $('#artigo');
  artigo.replaceChildren(el('p', { class: 'carregando', text: 'carregando…' }));
  anotacoes.desmontar();
  window.scrollTo(0, 0);

  let completo;
  try {
    completo = await dados.carregarArtigo(id);
  } catch (e) {
    artigo.replaceChildren(el('p', { class: 'carregando', text: e.message }));
    return;
  }
  if (artigoAberto !== a) return; // trocou de artigo enquanto carregava

  const cabecalho = el(
    'header',
    { class: 'artigo-cabecalho' },
    el('p', { class: 'artigo-fonte' }, el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: completo.siteName || '' }), completo.publishedAt ? ` · ${dataLonga(completo.publishedAt)}` : '', completo.readingMinutes ? ` · ${completo.readingMinutes} min de leitura` : ''),
    el('h1', { class: 'artigo-titulo', text: completo.title || completo.url }),
    completo.byline ? el('p', { class: 'artigo-autor', text: completo.byline }) : null,
  );

  const avisos = [completo.extraction?.error, ...(completo.extraction?.warnings || [])].filter(Boolean);
  const caixaAvisos =
    completo.extraction?.status !== 'ok' && avisos.length
      ? el('div', { class: 'artigo-aviso' }, el('strong', { text: completo.extraction.status === 'failed' ? 'A extração falhou.' : 'Este texto pode estar incompleto.' }), ' ', avisos[0], ' ', el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir o original ↗' }))
      : null;

  const lead =
    completo.leadImage && !completo.leadImage.inBody ? el('figure', { class: 'artigo-lead' }, el('img', { src: dados.urlMidia(completo.leadImage.src), alt: '', decoding: 'async' })) : null;

  // limpeza de novo na exibição (decisão 8) + ajustes de links e imagens
  const corpo = el('div', { class: 'artigo-corpo' });
  corpo.innerHTML = sanitizar(DOMPurify, completo.contentHtml || '');
  for (const img of corpo.querySelectorAll('img')) {
    img.src = dados.urlMidia(img.getAttribute('src'));
    img.loading = 'lazy';
    img.decoding = 'async';
  }
  for (const link of corpo.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const rodape = el(
    'footer',
    { class: 'artigo-rodape' },
    el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', class: 'artigo-original', text: 'Ler no site original ↗' }),
    el(
      'div',
      { class: 'artigo-rodape-acoes' },
      a.archivedAt
        ? el('a', { href: '#/', class: 'btn-secundario', text: '← Voltar à lista' })
        : el('button', {
            type: 'button',
            class: 'btn-primario',
            onclick: () => {
              dados.atualizar(a.id, { archivedAt: new Date().toISOString(), readAt: a.readAt || new Date().toISOString() });
              avisar('Arquivado.');
              location.hash = '#/';
            },
          }, 'Arquivar e voltar'),
    ),
  );

  artigo.replaceChildren(cabecalho, caixaAvisos, lead, corpo, rodape);
  await anotacoes.montar(a, corpo);
  if (artigoAberto !== a) return;

  // destino: highlight > termo da busca > onde parou
  if (hl && anotacoes.irPara(hl)) {
    /* rolou até o highlight */
  } else if (consulta) {
    const primeira = anotacoes.marcarTermos(termosDaConsulta(consulta));
    primeira?.scrollIntoView({ block: 'center' });
  } else if (a.progress > 0.02 && a.progress < 0.95) {
    requestAnimationFrame(() => window.scrollTo(0, a.progress * (document.documentElement.scrollHeight - innerHeight)));
  }
  atualizarProgresso();
}

// progresso de leitura + barra que some ao rolar para baixo
let ultimoY = 0;
let progressoTimer = null;

function atualizarProgresso() {
  if ($('#vista-leitura').hidden || !artigoAberto) return;
  const total = document.documentElement.scrollHeight - innerHeight;
  const p = total > 0 ? Math.min(1, Math.max(0, scrollY / total)) : 1;
  $('#progresso').style.transform = `scaleX(${p})`;

  const barra = $('#barra-leitura');
  const descendo = scrollY > ultimoY && scrollY > 80;
  if (painelPrefs.hidden) barra.classList.toggle('escondida', descendo);
  ultimoY = scrollY;

  const a = artigoAberto;
  clearTimeout(progressoTimer);
  progressoTimer = setTimeout(() => {
    if (Math.abs((a.progress || 0) - p) < 0.02) return;
    const mudancas = { progress: Math.round(p * 1000) / 1000 };
    if (p >= 0.9 && !a.readAt) mudancas.readAt = new Date().toISOString();
    dados.atualizar(a.id, mudancas);
  }, 1500);
}
addEventListener('scroll', atualizarProgresso, { passive: true });

// ======================================================================
// navegação: #/  ·  #/ler/<id>  ·  #/ler/<id>?q=termo  ·  #/ler/<id>?hl=<id>
// ======================================================================

function mostrar(vista) {
  $('#vista-lista').hidden = vista !== 'lista';
  $('#vista-leitura').hidden = vista !== 'leitura';
  if (vista === 'lista') {
    delete document.body.dataset.fundo;
    abrirPrefs(false);
    anotacoes.desmontar();
  }
}

let posicaoLista = 0;

function rotear() {
  const m = location.hash.match(/^#\/ler\/([\w-]+)(?:\?(.*))?$/);
  if (m) {
    if ($('#vista-leitura').hidden) posicaoLista = scrollY;
    const params = new URLSearchParams(m[2] || '');
    abrirArtigo(m[1], { consulta: params.get('q'), hl: params.get('hl') });
  } else {
    const vindoDaLeitura = !$('#vista-leitura').hidden;
    artigoAberto = null;
    document.title = 'Artigos';
    mostrar('lista');
    desenharLista().then(() => {
      if (vindoDaLeitura) requestAnimationFrame(() => window.scrollTo(0, posicaoLista));
    });
  }
}

addEventListener('hashchange', rotear);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!painelPrefs.hidden) abrirPrefs(false);
  else if (!$('#vista-leitura').hidden && !e.target.closest?.('textarea, input')) location.hash = '#/';
});
addEventListener('keydown', (e) => {
  if (e.key === '/' && !$('#vista-lista').hidden && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    $('#busca').focus();
  }
});
addEventListener('beforeunload', (e) => {
  if (dados.temPendencias()) e.preventDefault();
});

// ======================================================================
// início
// ======================================================================

desenharBotoesTema();
try {
  await dados.carregarIndice();
} catch (e) {
  avisar(e.message);
}
rotear();
