// Busca completa (M3): texto integral (índice gerado fora do navegador),
// highlights e notas (indexados aqui, na hora), metadados e tags.

import MiniSearch from '../vendor/minisearch-7.2.0.es.js';
import * as dados from './dados.js';
import { OPCOES_TEXTO, OPCOES_CONSULTA, VERSAO_INDICE, normalizar, termosDaConsulta, SEPARADOR, processarTermo } from '../lib/busca.js';
import { acharTermos } from '../lib/ancora.js';
import { textoDeHtml } from './util.js';

let buscaTexto = null; // MiniSearch do texto integral
let buscaAnot = null; // MiniSearch de highlights e notas
let versaoAnot = -1;

async function prepararTexto() {
  if (buscaTexto !== null) return buscaTexto;
  const d = await dados.carregarIndiceBusca().catch(() => null);
  buscaTexto = d && d.versao === VERSAO_INDICE ? MiniSearch.loadJS(d.indice, OPCOES_TEXTO) : false;
  return buscaTexto;
}

async function prepararAnotacoes() {
  if (buscaAnot && versaoAnot === dados.versaoDasAnotacoes()) return buscaAnot;
  versaoAnot = dados.versaoDasAnotacoes();
  const ms = new MiniSearch({ idField: 'id', fields: ['texto', 'nota'], storeFields: ['tipo', 'artigo', 'hl'], tokenize: (s) => s.split(SEPARADOR), processTerm: processarTermo });
  for (const { entrada, anotacoes } of await dados.todasAnotacoes()) {
    if (anotacoes.note?.trim()) ms.add({ id: `n:${entrada.id}`, tipo: 'nota', artigo: entrada.id, texto: '', nota: anotacoes.note });
    for (const h of anotacoes.highlights || []) {
      const exact = h.target.selector.find((s) => s.type === 'TextQuoteSelector')?.exact || '';
      ms.add({ id: `h:${h.id}`, tipo: 'highlight', artigo: entrada.id, hl: h.id, texto: exact, nota: h.note || '' });
    }
  }
  buscaAnot = ms;
  return ms;
}

/**
 * Devolve { artigos: [{ entrada, score }], highlights: [{ entrada, h }], notas: [{ entrada, nota }], semIndice }
 */
export async function buscar(consulta) {
  const [texto, anot] = await Promise.all([prepararTexto(), prepararAnotacoes()]);
  const pontos = new Map();

  if (texto) for (const r of texto.search(consulta, OPCOES_CONSULTA)) pontos.set(r.id, r.score);

  // metadados e tags (também cobre artigos fora do índice, ex.: extração falhou)
  const termos = termosDaConsulta(consulta);
  if (termos.length) {
    for (const e of dados.artigosDoIndice()) {
      const alvo = normalizar([e.title, e.siteName, e.byline, e.excerpt, ...(e.tags || [])].join(' '));
      if (termos.every((t) => alvo.includes(t))) pontos.set(e.id, (pontos.get(e.id) || 0) + ((e.tags || []).some((t) => termos.includes(normalizar(t))) ? 5 : 1));
    }
  }

  const artigos = [...pontos.entries()]
    .map(([id, score]) => ({ entrada: dados.entrada(id), score }))
    .filter((r) => r.entrada)
    .sort((a, b) => b.score - a.score);

  const highlights = [];
  const notas = [];
  const todas = new Map((await dados.todasAnotacoes()).map((x) => [x.entrada.id, x]));
  for (const r of anot.search(consulta, { ...OPCOES_CONSULTA, boost: { texto: 1, nota: 1 } })) {
    const x = todas.get(r.artigo);
    if (!x) continue;
    if (r.tipo === 'nota') notas.push({ entrada: x.entrada, nota: x.anotacoes.note });
    else {
      const h = x.anotacoes.highlights.find((y) => y.id === r.hl);
      if (h) highlights.push({ entrada: x.entrada, h });
    }
  }

  return { artigos, highlights, notas, semIndice: !texto };
}

const trechos = new Map();

/** Trecho do texto do artigo em volta do primeiro termo encontrado. */
export async function trechoDoArtigo(id, consulta) {
  const chave = `${id}\u0000${consulta}`;
  if (trechos.has(chave)) return trechos.get(chave);
  let resultado = null;
  try {
    const a = await dados.carregarArtigo(id);
    const texto = textoDeHtml(a.contentHtml);
    const [primeiro] = acharTermos(texto, termosDaConsulta(consulta), 1);
    if (primeiro) {
      const de = Math.max(0, texto.lastIndexOf(' ', Math.max(0, primeiro.inicio - 90)) + 1);
      const ate = Math.min(texto.length, texto.indexOf(' ', primeiro.fim + 110) === -1 ? texto.length : texto.indexOf(' ', primeiro.fim + 110));
      const pedaco = texto.slice(de, ate);
      resultado = { antes: (de > 0 ? '…' : '') + pedaco.slice(0, primeiro.inicio - de), termo: texto.slice(primeiro.inicio, primeiro.fim), depois: pedaco.slice(primeiro.fim - de) + (ate < texto.length ? '…' : '') };
    }
  } catch {
    /* sem trecho */
  }
  trechos.set(chave, resultado);
  return resultado;
}

/** Esquece o índice de texto (ex.: depois de importar um backup). */
export function reiniciar() {
  buscaTexto = null;
  buscaAnot = null;
}
