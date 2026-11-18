// Ancoragem de highlights (decisão 5): W3C TextQuoteSelector + TextPositionSelector.
// As posições contam caracteres na concatenação de todos os nós de texto do
// corpo do artigo — o mesmo que Range.toString() devolve.

const CONTEXTO = 32;

export function textoCorrido(raiz) {
  let s = '';
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) s += n.data;
  return s;
}

/** Posições (início, fim) de um Range dentro de `raiz`. */
export function posicoesDoRange(raiz, range) {
  const antes = document.createRange();
  antes.setStart(raiz, 0);
  antes.setEnd(range.startContainer, range.startOffset);
  const inicio = antes.toString().length;
  return { inicio, fim: inicio + range.toString().length };
}

/** Tira espaços das pontas da seleção. */
export function aparar(texto, inicio, fim) {
  while (inicio < fim && /\s/.test(texto[inicio])) inicio++;
  while (fim > inicio && /\s/.test(texto[fim - 1])) fim--;
  return { inicio, fim };
}

export function criarSeletores(texto, inicio, fim) {
  return [
    {
      type: 'TextQuoteSelector',
      exact: texto.slice(inicio, fim),
      prefix: texto.slice(Math.max(0, inicio - CONTEXTO), inicio),
      suffix: texto.slice(fim, fim + CONTEXTO),
    },
    { type: 'TextPositionSelector', start: inicio, end: fim },
  ];
}

function comumNoFim(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function comumNoInicio(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Reencontra o trecho no texto atual. Devolve { inicio, fim } ou null (órfão). */
export function ancorar(texto, seletores) {
  const citacao = seletores.find((s) => s.type === 'TextQuoteSelector');
  const posicao = seletores.find((s) => s.type === 'TextPositionSelector');
  if (!citacao?.exact) return null;
  const { exact, prefix = '', suffix = '' } = citacao;

  // 1. a posição guardada ainda bate
  if (posicao && texto.slice(posicao.start, posicao.end) === exact) return { inicio: posicao.start, fim: posicao.end };

  // 2. melhor ocorrência pelo contexto (antes/depois) e proximidade
  let melhor = null;
  let melhorNota = -Infinity;
  for (let i = texto.indexOf(exact); i !== -1; i = texto.indexOf(exact, i + 1)) {
    const nota =
      comumNoFim(texto.slice(Math.max(0, i - prefix.length), i), prefix) +
      comumNoInicio(texto.slice(i + exact.length, i + exact.length + suffix.length), suffix) -
      (posicao ? Math.abs(i - posicao.start) / 2000 : 0);
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = { inicio: i, fim: i + exact.length };
    }
  }
  return melhor;
}

const PAIS_DE_BLOCO = new Set(['UL', 'OL', 'DL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'FIGURE', 'DIV', 'ARTICLE', 'SECTION']);

/**
 * Envolve o trecho [inicio, fim) em elementos criados por `criarMarca()`.
 * Pode atravessar parágrafos (gera uma marca por pedaço). Devolve as marcas.
 */
export function pintar(raiz, inicio, fim, criarMarca) {
  const pedacos = [];
  let pos = 0;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const tam = n.data.length;
    if (pos < fim && pos + tam > inicio) pedacos.push({ no: n, de: Math.max(inicio, pos) - pos, ate: Math.min(fim, pos + tam) - pos });
    pos += tam;
    if (pos >= fim) break;
  }
  const marcas = [];
  for (const { no, de, ate } of pedacos) {
    let alvo = no;
    if (ate < alvo.data.length) alvo.splitText(ate);
    if (de > 0) alvo = alvo.splitText(de);
    if (!alvo.data.trim() && PAIS_DE_BLOCO.has(alvo.parentNode?.nodeName)) continue;
    const marca = criarMarca();
    alvo.replaceWith(marca);
    marca.append(alvo);
    marcas.push(marca);
  }
  return marcas;
}

/** Remove marcas (seletor CSS) mantendo o texto. */
export function despintar(raiz, seletor) {
  for (const m of [...raiz.querySelectorAll(seletor)]) m.replaceWith(...m.childNodes);
  raiz.normalize();
}

/**
 * Acha termos (já normalizados, sem acento) no texto, como início de palavra.
 * Devolve intervalos { inicio, fim } no texto original.
 */
export function acharTermos(texto, termos, limite = 300) {
  // texto normalizado + mapa de volta para o original
  let norm = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const ch of c) {
      norm += ch;
      mapa.push(i);
    }
  }
  const achados = [];
  for (const termo of termos) {
    for (let i = norm.indexOf(termo); i !== -1 && achados.length < limite; i = norm.indexOf(termo, i + 1)) {
      if (i > 0 && /[\p{L}\p{N}]/u.test(norm[i - 1])) continue; // só início de palavra
      achados.push({ inicio: mapa[i], fim: mapa[i + termo.length - 1] + 1 });
    }
  }
  achados.sort((a, b) => a.inicio - b.inicio);
  // junta sobreposições
  const unidos = [];
  for (const a of achados) {
    const u = unidos[unidos.length - 1];
    if (u && a.inicio <= u.fim) u.fim = Math.max(u.fim, a.fim);
    else unidos.push({ ...a });
  }
  return unidos;
}
