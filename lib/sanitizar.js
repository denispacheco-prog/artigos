// Limpeza de segurança do HTML do artigo (decisão 8).
// Usada na extração e de novo na exibição. Recebe uma instância do DOMPurify
// (no Node: createDOMPurify(janelaJsdom); no navegador: window.DOMPurify).

import { limparRastreio } from './url.js';

export const TAGS_PERMITIDAS = [
  'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'figure', 'figcaption', 'img', 'a', 'em', 'strong', 'i', 'b', 'u', 's',
  'code', 'pre', 'hr', 'br', 'sup', 'sub', 'q', 'cite', 'abbr', 'small',
  'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
];

export const ATRIBUTOS_PERMITIDOS = ['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'];

// Elementos removidos com todo o conteúdo (o resto que não é permitido é
// "desembrulhado": some a tag, fica o texto).
const REMOVER_COM_CONTEUDO = [
  'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas',
  'iframe', 'object', 'embed', 'video', 'audio', 'source', 'track',
  'form', 'button', 'input', 'select', 'textarea', 'label',
  'nav', 'aside', 'footer', 'header', 'dialog', 'link', 'meta',
];

const URI_PERMITIDA = /^(?:https?:|mailto:|media\/)/i;

export function sanitizar(DOMPurify, html) {
  const fragmento = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TAGS_PERMITIDAS,
    ALLOWED_ATTR: ATRIBUTOS_PERMITIDOS,
    ALLOWED_URI_REGEXP: URI_PERMITIDA,
    FORBID_CONTENTS: REMOVER_COM_CONTEUDO,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });
  arrumar(fragmento);
  const div = fragmento.ownerDocument.createElement('div');
  div.appendChild(fragmento);
  return div.innerHTML.trim();
}

/** Ajustes depois da limpeza: links, títulos, vazios. */
function arrumar(raiz) {
  for (const a of [...raiz.querySelectorAll('a')]) {
    const href = a.getAttribute('href');
    if (!href || !/^(https?:|mailto:)/i.test(href)) {
      a.replaceWith(...a.childNodes); // âncoras internas (#nota) e links inválidos viram texto
    } else {
      a.setAttribute('href', limparRastreio(href));
    }
  }
  for (const img of [...raiz.querySelectorAll('img')]) {
    if (!img.getAttribute('src')) img.remove();
  }
  // figure sem imagem não faz sentido; parágrafos e itens vazios saem
  for (const fig of [...raiz.querySelectorAll('figure')]) {
    if (!fig.querySelector('img')) fig.remove();
  }
  for (const el of [...raiz.querySelectorAll('p, li, h2, h3, h4, h5, h6, blockquote, figcaption')]) {
    if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
  }
  for (const lista of [...raiz.querySelectorAll('ul, ol')]) {
    if (!lista.querySelector('li')) lista.remove();
  }
}
