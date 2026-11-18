// Núcleo da extração: recebe um Document já carregado e devolve metadados e
// o HTML do corpo. Não acessa rede nem disco, então roda igual no Node (com
// jsdom, pela Action) e no navegador (bookmarklet → receber.html).

import { Readability, isProbablyReaderable } from '@mozilla/readability';

const IMG_IRRELEVANTE = /(logo|avatar|icon|sprite|gravatar|badge|pixel|spacer|tracking|banner|emoji|placeholder|blank\.gif|loading|\bads?\b|advert|publicidade|patrocin)/i;

/** Lê os metadados da página inteira (antes do Readability mexer nela). */
export function lerMetadados(doc) {
  const meta = (...nomes) => {
    for (const n of nomes) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
      const v = el?.getAttribute('content')?.trim();
      if (v) return v;
    }
    return null;
  };

  const ld = lerJsonLd(doc);
  const canonica = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || meta('og:url');

  return {
    titulo: meta('og:title', 'twitter:title') || ld.headline || null,
    site: meta('og:site_name', 'application-name') || ld.publisher || null,
    autor: ld.autor || meta('author', 'article:author', 'parsely-author', 'sailthru.author') || null,
    publicado: dataIso(ld.datePublished || meta('article:published_time', 'datePublished', 'pubdate', 'publish-date', 'date', 'DC.date.issued', 'parsely-pub-date')),
    descricao: meta('og:description', 'description', 'twitter:description') || null,
    imagem: meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') || ld.image || null,
    canonica: canonica ? absoluta(canonica, doc.baseURI) : null,
    idioma: doc.documentElement.getAttribute('lang') || meta('og:locale') || null,
  };
}

function lerJsonLd(doc) {
  const achados = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const dado = JSON.parse(s.textContent);
      const fila = Array.isArray(dado) ? [...dado] : [dado];
      while (fila.length) {
        const item = fila.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) fila.push(...item['@graph']);
        const tipo = [].concat(item['@type'] || []).join(' ');
        if (/Article|BlogPosting|Report|Recipe|NewsArticle/i.test(tipo)) achados.push(item);
      }
    } catch {
      /* JSON-LD malformado: ignora */
    }
  }
  const a = achados[0] || {};
  const nomes = [].concat(a.author || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  const img = [].concat(a.image || [])[0];
  return {
    headline: a.headline || null,
    datePublished: a.datePublished || null,
    autor: nomes.length ? [...new Set(nomes)].join(', ') : null,
    publisher: a.publisher?.name || null,
    image: typeof img === 'string' ? img : img?.url || null,
  };
}

function dataIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function absoluta(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Escolhe a maior imagem de um srcset sem passar de ~1600px. */
function melhorDoSrcset(srcset, base) {
  const candidatos = srcset
    .split(/,\s+(?=\S)/)
    .map((parte) => {
      const [url, desc = ''] = parte.trim().split(/\s+/);
      const n = parseFloat(desc) || (desc.endsWith('x') ? parseFloat(desc) * 800 : 0);
      return { url: absoluta(url, base), largura: n };
    })
    .filter((c) => c.url);
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => a.largura - b.largura);
  const ate = candidatos.filter((c) => c.largura <= 1600);
  return (ate.length ? ate[ate.length - 1] : candidatos[0]).url;
}

/** Resolve imagens com carregamento preguiçoso e <picture>, na página inteira. */
export function resolverImagens(doc) {
  const base = doc.baseURI;
  for (const img of doc.querySelectorAll('img')) {
    const preguicosa = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-hi-res-src', 'data-full-src']
      .map((a) => img.getAttribute(a))
      .find(Boolean);
    const srcsetAttr = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    const fonte = img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset');
    const melhor = (srcsetAttr && melhorDoSrcset(srcsetAttr, base)) || (fonte && melhorDoSrcset(fonte, base));
    const atual = img.getAttribute('src');
    const atualRuim = !atual || atual.startsWith('data:') || IMG_IRRELEVANTE.test(atual);
    const escolhida = melhor || (atualRuim && preguicosa) || atual || preguicosa;
    if (escolhida) img.setAttribute('src', absoluta(escolhida, base) || escolhida);
    img.removeAttribute('srcset');
    img.removeAttribute('data-srcset');
  }
}

/** Tira do corpo extraído as imagens que claramente não são do texto. */
function filtrarImagens(raiz) {
  for (const img of [...raiz.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    const pistas = [src, img.getAttribute('alt'), img.getAttribute('class'), img.parentElement?.getAttribute('class')].join(' ');
    const w = parseInt(img.getAttribute('width'), 10);
    const h = parseInt(img.getAttribute('height'), 10);
    const minuscula = (w && w < 60) || (h && h < 60);
    const svg = /\.svg(\?|$)/i.test(src) || src.startsWith('data:image/svg');
    const dataPequena = src.startsWith('data:') && src.length < 3000;
    if (!src || minuscula || svg || dataPequena || IMG_IRRELEVANTE.test(pistas)) {
      const fig = img.closest('figure');
      if (fig && fig.querySelectorAll('img').length === 1) fig.remove();
      else img.remove();
    }
  }
}

/** Troca vídeos e posts incorporados por um link para o original. */
function trocarIncorporados(raiz) {
  const doc = raiz.ownerDocument;
  for (const el of [...raiz.querySelectorAll('iframe, video, embed, object, blockquote.twitter-tweet, blockquote.instagram-media')]) {
    const src = el.getAttribute('src') || el.getAttribute('data-src') || el.querySelector('a[href]')?.getAttribute('href') || el.getAttribute('data');
    if (!src || !/^https?:/i.test(absoluta(src, doc.baseURI) || '')) {
      el.remove();
      continue;
    }
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', absoluta(src, doc.baseURI));
    a.textContent = /youtube|vimeo|video/i.test(src) || el.tagName === 'VIDEO' ? '[vídeo no site original]' : '[conteúdo incorporado no site original]';
    p.appendChild(a);
    el.replaceWith(p);
  }
}

/**
 * Extrai o artigo. `doc` é o documento da página (já com baseURI correto).
 * Devolve { ok, metadados, titulo, autor, site, idioma, publicado, html, avisos }.
 * O `html` ainda NÃO está sanitizado: passe por sanitizar() depois de
 * resolver as imagens.
 */
export function extrairArtigo(doc) {
  const avisos = [];
  const metadados = lerMetadados(doc);
  resolverImagens(doc);

  if (!isProbablyReaderable(doc)) avisos.push('A página não parece um artigo (pode ser capa, lista ou galeria).');

  const copia = doc.cloneNode(true);
  const resultado = new Readability(copia, { keepClasses: true, charThreshold: 300 }).parse();
  if (!resultado || !resultado.content) {
    return { ok: false, metadados, avisos, erro: 'Não foi possível identificar o texto do artigo nesta página.' };
  }

  const tmp = doc.createElement('div');
  tmp.innerHTML = resultado.content;
  trocarIncorporados(tmp);
  filtrarImagens(tmp);
  for (const h1 of [...tmp.querySelectorAll('h1')]) {
    const h2 = doc.createElement('h2');
    h2.append(...h1.childNodes);
    h1.replaceWith(h2);
  }

  return {
    ok: true,
    metadados,
    titulo: resultado.title || metadados.titulo,
    autor: metadados.autor || limparByline(resultado.byline),
    site: resultado.siteName || metadados.site,
    idioma: resultado.lang || metadados.idioma,
    publicado: metadados.publicado || dataIso(resultado.publishedTime),
    descricao: metadados.descricao || resultado.excerpt || null,
    html: tmp.innerHTML,
    avisos,
  };
}

function limparByline(b) {
  if (!b) return null;
  const t = b.replace(/\s+/g, ' ').replace(/^(por|by)\s+/i, '').trim();
  return t.length > 120 ? null : t;
}

/** Texto corrido normalizado (base para contagem de palavras e textHash). */
export function textoNormalizado(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Sinais de paywall no texto curto. */
export const PISTAS_PAYWALL = /(assine|assinante|exclusivo para assinantes|conteúdo exclusivo|faça login|já é assinante|subscribe|subscriber|sign in to continue|to continue reading|create a free account|members only)/i;
