#!/usr/bin/env node
// Extrator de artigos (Node). Uso:
//   npm run extrair -- <url> [<url> ...] [--saida pasta]
// Modo Action (repo privado): grava só articles/<id>.json e media/<id>/;
// o index.json é do app e o índice de busca é refeito no próprio workflow.
//   node scripts/extrair.js <url> --id <id> --saida ../dados --apenas-artigo
// Grava no formato do schema (DECISOES.md) em amostra-dados/ por padrão:
//   index.json, articles/<id>.json, media/<id>/N.webp, previa/<id>.html

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import createDOMPurify from 'dompurify';
import sharp from 'sharp';

import { normalizarUrl } from '../lib/url.js';
import { sanitizar } from '../lib/sanitizar.js';
import { extrairArtigo, textoNormalizado, PISTAS_PAYWALL } from '../lib/extrair-nucleo.js';
import { gerarIndiceBusca } from './indexar.js';
import { entradaDoArtigo, ID_VALIDO } from '../lib/indice.js';

const FERRAMENTA = 'readability@0.6.0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_IMAGENS = 30;
const ORCAMENTO_BYTES = 3 * 1024 * 1024; // por artigo, depois de comprimir
const LARGURA_MIN_PRINCIPAL = 500;
const LARGURA_MAX = 1200;
const LARGURA_MIN = 200;
const MIN_PALAVRAS_OK = 300;
const MIN_PALAVRAS_FALHA = 60;
const PALAVRAS_POR_MINUTO = 220;
const SEGUNDOS_POR_IMAGEM = 6;

// ---------------------------------------------------------------- utilidades

const sha1 = (x) => createHash('sha1').update(x).digest('hex');

/** Tempo de leitura em minutos: 220 palavras/min + 6 s por imagem, mínimo 1. */
function tempoDeLeitura(palavras, nImagens) {
  if (!palavras) return 0;
  return Math.max(1, Math.ceil(palavras / PALAVRAS_POR_MINUTO + (nImagens * SEGUNDOS_POR_IMAGEM) / 60));
}

function novoId(url, quando) {
  const d = quando.toISOString().slice(0, 10).replaceAll('-', '');
  return `${d}-${sha1(url).slice(0, 6)}`;
}

async function buscar(url, { referer, tipo = 'html' } = {}) {
  const resp = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(tipo === 'html' ? 25_000 : 60_000),
    headers: {
      'User-Agent': UA,
      'Accept': tipo === 'html' ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' : 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      ...(referer ? { Referer: referer } : {}),
    },
  });
  return resp;
}

function lerJson(arquivo, padrao) {
  return readFile(arquivo, 'utf8').then(JSON.parse, () => padrao);
}

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- imagens

/** Baixa, filtra por tamanho e converte para webp. Devolve null se não serve. */
async function processarImagem(src, pagina) {
  const resp = await buscar(src, { referer: pagina, tipo: 'img' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const bruto = Buffer.from(await resp.arrayBuffer());
  if (bruto.length > 30 * 1024 * 1024) throw new Error('imagem grande demais');
  const img = sharp(bruto, { animated: false, failOn: 'none' });
  const info = await img.metadata();
  if (info.format === 'svg') return { descartar: 'svg' };
  if ((info.width || 0) < LARGURA_MIN) return { descartar: `pequena (${info.width}px)` };
  const saida = await img.rotate().resize({ width: LARGURA_MAX, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer({ resolveWithObject: true });
  return { buffer: saida.data, width: saida.info.width, height: saida.info.height, hashOriginal: sha1(bruto) };
}

/** Processa as imagens do corpo (já sanitizado) e a imagem principal. */
async function cuidarDasImagens(corpo, id, paginaUrl, imagemPrincipal, dirMedia, avisos) {
  await rm(dirMedia, { recursive: true, force: true });
  const imagens = [];
  const porHash = new Map();
  const porUrl = new Map();
  let n = 0;
  let usados = 0;

  for (const el of [...corpo.querySelectorAll('img')]) {
    const original = el.getAttribute('src');
    const chave = original.split('?')[0];
    if (porUrl.has(chave)) {
      removerImg(el);
      continue;
    }
    if (n >= MAX_IMAGENS || usados >= ORCAMENTO_BYTES) {
      avisos.push(`Limite de imagens do artigo atingido (${MAX_IMAGENS} imagens ou 3 MB): as excedentes ficaram com link para o site original.`);
      imagens.push({ src: original, originalSrc: original, hotlink: true });
      porUrl.set(chave, true);
      continue;
    }
    try {
      const r = await processarImagem(original, paginaUrl);
      if (r.descartar) {
        removerImg(el);
        continue;
      }
      if (porHash.has(r.hashOriginal)) {
        removerImg(el);
        continue;
      }
      n += 1;
      usados += r.buffer.length;
      const rel = `media/${id}/${n}.webp`;
      await mkdir(dirMedia, { recursive: true });
      await writeFile(path.join(dirMedia, `${n}.webp`), r.buffer);
      el.setAttribute('src', rel);
      el.setAttribute('width', r.width);
      el.setAttribute('height', r.height);
      const registro = { src: rel, originalSrc: original, width: r.width, height: r.height, bytes: r.buffer.length };
      imagens.push(registro);
      porHash.set(r.hashOriginal, registro);
      porUrl.set(chave, registro);
    } catch (e) {
      avisos.push(`Imagem não baixada (${e.message}): mantido o link original.`);
      imagens.push({ src: original, originalSrc: original, hotlink: true });
      porUrl.set(chave, true);
    }
  }

  // imagem principal (og:image): reaproveita se for igual a uma do corpo
  let principal = null;
  if (imagemPrincipal) {
    const repetida = porUrl.get(imagemPrincipal.split('?')[0]);
    if (repetida && repetida !== true) {
      principal = { src: repetida.src, originalSrc: imagemPrincipal, inBody: true };
    } else {
      try {
        const r = await processarImagem(imagemPrincipal, paginaUrl);
        if (r && !r.descartar) {
          const igual = porHash.get(r.hashOriginal);
          const primeira = imagens.find((i) => !i.hotlink);
          if (igual) {
            principal = { src: igual.src, originalSrc: imagemPrincipal, inBody: true };
          } else if (r.width < LARGURA_MIN_PRINCIPAL && primeira) {
            principal = { src: primeira.src, originalSrc: primeira.originalSrc, inBody: true };
          } else {
            const rel = `media/${id}/0.webp`;
            await mkdir(dirMedia, { recursive: true });
            await writeFile(path.join(dirMedia, '0.webp'), r.buffer);
            principal = { src: rel, originalSrc: imagemPrincipal, width: r.width, height: r.height, inBody: false };
          }
        }
      } catch (e) {
        avisos.push(`Imagem principal não baixada (${e.name === 'TimeoutError' ? 'demorou demais' : e.message}): mantido o link original.`);
        principal = { src: imagemPrincipal, originalSrc: imagemPrincipal, hotlink: true, inBody: false };
      }
    }
  }
  return { imagens, principal };
}

function removerImg(el) {
  const fig = el.closest('figure');
  if (fig && fig.querySelectorAll('img').length === 1) fig.remove();
  else el.remove();
}

// ---------------------------------------------------------------- extração

async function extrair(urlBruta, saida, index, { idForcado = null, metodo = 'local' } = {}) {
  const url = normalizarUrl(urlBruta);
  const agora = new Date();
  const existente = index?.articles.find((a) => a.url === url);
  const id = idForcado || existente?.id || novoId(url, agora);
  const avisos = [];
  const base = {
    schema: 1,
    id,
    url,
    canonicalUrl: null,
    title: null,
    byline: null,
    siteName: null,
    lang: null,
    publishedAt: null,
    savedAt: existente?.savedAt || agora.toISOString(),
    excerpt: null,
    leadImage: null,
    wordCount: 0,
    readingMinutes: 0,
    contentHtml: '',
    textHash: null,
    images: [],
    extraction: { method: metodo, status: 'failed', tool: FERRAMENTA, at: agora.toISOString(), warnings: avisos, error: null },
    edits: [],
  };

  let artigo = base;
  try {
    const resp = await buscar(url);
    const tipo = resp.headers.get('content-type') || '';
    if (!resp.ok) throw new Error(resp.status === 403 || resp.status === 429 ? `O site bloqueou o acesso automático (HTTP ${resp.status}). Use o bookmarklet.` : `O site respondeu com erro HTTP ${resp.status}.`);
    if (!/html/i.test(tipo)) throw new Error(`O endereço não é uma página HTML (${tipo || 'tipo desconhecido'}).`);
    const html = await resp.text();
    const urlFinal = resp.url || url;

    const vc = new VirtualConsole(); // silencia avisos de CSS/JS da página
    const dom = new JSDOM(html, { url: urlFinal, virtualConsole: vc });
    const r = extrairArtigo(dom.window.document);
    avisos.push(...r.avisos);
    if (!r.ok) throw new Error(r.erro);

    // limpeza de segurança, depois imagens sobre o HTML limpo
    const DOMPurify = createDOMPurify(dom.window);
    const limpo = sanitizar(DOMPurify, r.html);
    const corpo = dom.window.document.createElement('div');
    corpo.innerHTML = limpo;

    const imgPrincipal = r.metadados.imagem ? new URL(r.metadados.imagem, urlFinal).toString() : null;
    const { imagens, principal } = await cuidarDasImagens(corpo, id, urlFinal, imgPrincipal, path.join(saida, 'media', id), avisos);

    const texto = textoNormalizado(corpo);
    const palavras = texto ? texto.split(' ').length : 0;
    let status = 'ok';
    if (palavras < MIN_PALAVRAS_FALHA) {
      status = 'failed';
      base.extraction.error = `Só ${palavras} palavras extraídas: provável bloqueio ou paywall. Use o bookmarklet.`;
    } else if (palavras < MIN_PALAVRAS_OK || (palavras < 600 && PISTAS_PAYWALL.test(texto.slice(-400)))) {
      status = 'partial';
      avisos.push(`Texto curto (${palavras} palavras): pode estar incompleto (paywall?). Confira com o original.`);
    }

    artigo = {
      ...base,
      canonicalUrl: r.metadados.canonica && r.metadados.canonica !== url ? normalizarUrl(r.metadados.canonica) : null,
      title: r.titulo,
      byline: r.autor,
      siteName: r.site || new URL(urlFinal).hostname.replace(/^www\d?\./, ''),
      lang: r.idioma,
      publishedAt: r.publicado,
      excerpt: (r.descricao || texto).slice(0, 220),
      leadImage: principal,
      wordCount: palavras,
      readingMinutes: tempoDeLeitura(palavras, corpo.querySelectorAll('img').length),
      contentHtml: corpo.innerHTML,
      textHash: sha1(texto),
      images: imagens,
      extraction: { ...base.extraction, status, warnings: [...new Set(avisos)] },
    };
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'O site demorou demais para responder.' : e.cause?.code ? `Falha de rede (${e.cause.code}).` : e.message;
    artigo.extraction.error = artigo.extraction.error || msg;
    artigo.extraction.warnings = [...new Set(avisos)];
    artigo.siteName = artigo.siteName || hostname(url);
  }

  await mkdir(path.join(saida, 'articles'), { recursive: true });
  await writeFile(path.join(saida, 'articles', `${id}.json`), JSON.stringify(artigo, null, 2));
  if (index) {
    atualizarIndex(index, artigo, existente);
    await escreverPrevia(saida, artigo);
  }
  return artigo;
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\d?\./, '');
  } catch {
    return null;
  }
}

function atualizarIndex(index, a, existente) {
  const entrada = entradaDoArtigo(a, existente);
  const i = index.articles.findIndex((x) => x.id === a.id);
  if (i >= 0) index.articles[i] = entrada;
  else index.articles.unshift(entrada);
  index.updatedAt = entrada.updatedAt;
}

// ---------------------------------------------------------------- prévia

const ROTULO = { ok: '✓ ok', partial: '⚠ parcial', failed: '✕ falhou' };

async function escreverPrevia(saida, a) {
  const dir = path.join(saida, 'previa');
  await mkdir(dir, { recursive: true });
  const data = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('pt-BR') : 's/ data';
  const lead = a.leadImage && !a.leadImage.inBody ? `<figure><img src="${escapar(a.leadImage.src)}" alt=""></figure>` : '';
  const avisos = [a.extraction.error, ...a.extraction.warnings].filter(Boolean).map((w) => `<li>${escapar(w)}</li>`).join('');
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="../"><title>${escapar(a.title || a.url)}</title>
<link rel="stylesheet" href="../tokens.css"><link rel="stylesheet" href="previa/previa.css"></head>
<body><div class="leitura" data-fundo="claro" data-fonte="georgia"><main>
<p class="aviso-previa">Prévia do M1 (sem o visual final) · <a href="previa/index.html">todas</a> · <a href="${escapar(a.url)}" target="_blank" rel="noopener noreferrer">original ↗</a></p>
<p class="meta"><b>${escapar(a.siteName)}</b> · ${escapar(data)} · ${a.wordCount} palavras · ${a.readingMinutes} min de leitura · <span class="st-${a.extraction.status}">${ROTULO[a.extraction.status]}</span></p>
<h1>${escapar(a.title || '(sem título)')}</h1>
${a.byline ? `<p class="meta">${escapar(a.byline)}</p>` : ''}
${avisos ? `<ul class="avisos">${avisos}</ul>` : ''}
${lead}
<article>${a.contentHtml}</article>
</main></div></body></html>`;
  await writeFile(path.join(dir, `${a.id}.html`), html);
}

async function escreverIndicePrevia(saida, index) {
  const linhas = index.articles
    .map((a) => `<tr><td class="st-${a.extraction}">${ROTULO[a.extraction]}</td><td><a href="previa/${a.id}.html">${escapar(a.title || a.url)}</a><br><small>${escapar(a.siteName)} · ${a.readingMinutes} min</small></td><td><a href="${escapar(a.url)}" target="_blank" rel="noopener noreferrer">original ↗</a></td></tr>`)
    .join('\n');
  await writeFile(
    path.join(saida, 'previa', 'index.html'),
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="../"><title>Prévia M1</title>
<link rel="stylesheet" href="../tokens.css"><link rel="stylesheet" href="previa/previa.css"></head>
<body><main class="lista"><h1>Prévia da extração (M1)</h1><table>${linhas}</table></main></body></html>`,
  );
  await writeFile(
    path.join(saida, 'previa', 'previa.css'),
    `body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans)}
.leitura{background:var(--read-bg);color:var(--read-fg);min-height:100vh;padding:2rem 1rem}
.leitura main{max-width:var(--read-width);margin:0 auto}
article{font-family:var(--read-font);font-size:var(--read-size);line-height:var(--read-leading)}
h1{font-family:var(--read-font);line-height:1.2}
img{max-width:100%;height:auto}figure{margin:1.5em 0}figcaption{font:14px/1.4 var(--font-sans);color:var(--read-muted)}
.meta,.aviso-previa{font-size:13px;color:var(--read-muted)}
.avisos{font-size:13px;background:#fff6db;border:1px solid #f0d58a;border-radius:6px;padding:.5rem 1rem .5rem 2rem;color:#5c4400}
.st-ok{color:#1a7f37}.st-partial{color:#9a6700}.st-failed{color:var(--danger)}
.lista{max-width:900px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}
td{border-bottom:1px solid var(--border);padding:.6rem .5rem;vertical-align:top}td:first-child{white-space:nowrap}
a{color:var(--accent)}`,
  );
}

// ---------------------------------------------------------------- principal

async function main() {
  const args = process.argv.slice(2);
  let saida = 'amostra-dados';
  let idForcado = null;
  let apenasArtigo = false;
  const urls = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--saida') saida = args[++i];
    else if (args[i] === '--id') idForcado = args[++i];
    else if (args[i] === '--apenas-artigo') apenasArtigo = true;
    else urls.push(args[i]);
  }
  if (idForcado && (!ID_VALIDO.test(idForcado) || urls.length !== 1)) {
    console.error('--id precisa ter o formato AAAAMMDD-xxxxxx e vir com uma única URL.');
    process.exit(1);
  }

  if (apenasArtigo) {
    const a = await extrair(urls[0], saida, null, { idForcado, metodo: 'action' });
    console.log(`${ROTULO[a.extraction.status]} · ${a.id} · ${a.siteName} · ${a.wordCount} palavras`);
    for (const w of [a.extraction.error, ...a.extraction.warnings].filter(Boolean)) console.log(`  ! ${w}`);
    return; // falha de extração não é erro do workflow: o app mostra o motivo
  }
  if (!urls.length) {
    console.log('Uso: npm run extrair -- <url> [<url> ...] [--saida pasta]');
    process.exit(1);
  }

  const arqIndex = path.join(saida, 'index.json');
  const index = await lerJson(arqIndex, { schema: 1, updatedAt: null, articles: [] });

  for (const u of urls) {
    process.stdout.write(`→ ${u.slice(0, 90)}\n`);
    const a = await extrair(u, saida, index, { idForcado });
    const imgs = a.images.filter((i) => !i.hotlink).length;
    console.log(`  ${ROTULO[a.extraction.status]} · ${a.siteName} · "${(a.title || '').slice(0, 60)}" · ${a.wordCount} palavras · ${a.readingMinutes} min · ${imgs} imagens`);
    for (const w of [a.extraction.error, ...a.extraction.warnings].filter(Boolean)) console.log(`    ! ${w}`);
  }

  await writeFile(arqIndex, JSON.stringify(index, null, 2));
  await escreverIndicePrevia(saida, index);
  const busca = await gerarIndiceBusca(saida);
  console.log(`Índice de busca atualizado: ${busca.artigos} artigos, ${(busca.bytes / 1024).toFixed(0)} KB.`);
  console.log(`\nPrévia: ${path.resolve(saida, 'previa', 'index.html')}`);
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
