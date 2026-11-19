// Camada de dados. Dois modos, mesma interface:
//  - local  (localhost): amostra-dados/ via scripts/servidor.js
//  - github (Pages):     repositório privado artigos-dados via API, com token
//
// Dono de cada arquivo (DECISOES.md): o app escreve index.json e
// annotations/*.json; a Action escreve articles/, media/ e search/.
// (articles/ também na importação de backup e na edição manual.)

import * as gh from './github.js';
import { entradaDoArtigo, entradaPendente, ID_VALIDO } from '../lib/indice.js';
import { normalizarUrl } from '../lib/url.js';

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const BASE_LOCAL = 'amostra-dados/';

export const modo = LOCAL ? 'local' : 'github';
export const ErroGitHub = gh.ErroGitHub;

let indice = null;

// ======================================================================
// leitura e gravação (por modo)
// ======================================================================

const shas = new Map(); // github: caminho → sha da versão que temos

async function ler(caminho, { opcional = false } = {}) {
  if (!LOCAL) return gh.lerJson(caminho, { opcional });
  const resp = await fetch(BASE_LOCAL + caminho, { cache: 'no-store' });
  if (opcional && resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Não foi possível ler ${caminho} (HTTP ${resp.status}).`);
  return resp.json();
}

async function gravar(caminho, dado, mensagem) {
  if (!LOCAL) {
    shas.set(caminho, await gh.gravarJson(caminho, dado, shas.get(caminho) || null, mensagem));
    return;
  }
  const resp = await fetch('dados/' + caminho, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dado, null, 2) });
  if (!resp.ok) throw new Error(`Não foi possível gravar ${caminho} (HTTP ${resp.status}).`);
}

// ---------------------------------------------------------------- fila
// Várias mudanças seguidas no mesmo arquivo viram uma gravação só; as
// gravações saem em fila, uma de cada vez. Em conflito (outro aparelho
// gravou antes), relê, junta as mudanças e tenta de novo.

const pendentes = new Map(); // caminho → timer
let fila = Promise.resolve();
let gravando = 0;

function agendarGravacao(caminho, { obter, mesclar, mensagem, atraso = 800, aoGravar = () => {} }) {
  clearTimeout(pendentes.get(caminho));
  pendentes.set(
    caminho,
    setTimeout(() => {
      pendentes.delete(caminho);
      gravando++;
      fila = fila
        .then(() => gravarComMescla(caminho, obter, mesclar, mensagem))
        .then(aoGravar)
        .catch((e) => ouvinteErro(e))
        .finally(() => gravando--);
    }, atraso),
  );
}

async function gravarComMescla(caminho, obter, mesclar, mensagem) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await gravar(caminho, obter(), mensagem);
    } catch (e) {
      if (!(e instanceof gh.Conflito) || tentativa >= 4) throw e;
      const { dado, sha } = await gh.lerJsonComSha(caminho);
      shas.set(caminho, sha);
      if (dado) mesclar(dado);
    }
  }
}

/** Há gravações ainda não enviadas? (para avisar ao fechar a página) */
export const temPendencias = () => pendentes.size > 0 || gravando > 0;

let ouvinteErro = () => {};
export function aoErrar(fn) {
  ouvinteErro = fn;
}

const ouvintesMudanca = new Set();
/** Avisa quando artigos mudam por fora (Action terminou, sincronização). */
export function aoMudar(fn) {
  ouvintesMudanca.add(fn);
}
const notificar = (tipo) => ouvintesMudanca.forEach((fn) => fn(tipo));

// ======================================================================
// índice
// ======================================================================

// Campos mudados aqui e ainda não confirmados no GitHub. Só são esquecidos
// depois que a gravação dá certo — num conflito, são eles que vencem.
let alterados = new Map(); // id → Set(campos) mudados desde o início da última gravação
let emVoo = new Map(); // id → Set(campos) da gravação em andamento

function marcar(id, campos, mapa = alterados) {
  if (!mapa.has(id)) mapa.set(id, new Set());
  for (const c of campos) mapa.get(id).add(c);
}

const meusCampos = (id) => new Set([...(alterados.get(id) || []), ...(emVoo.get(id) || [])]);

function gravarIndice(atraso) {
  agendarGravacao('index.json', {
    atraso,
    mensagem: 'artigos: atualiza index.json',
    obter: () => {
      for (const [id, campos] of alterados) marcar(id, campos, emVoo);
      alterados = new Map();
      return indice;
    },
    mesclar: (remoto) => mesclarIndice(remoto),
    aoGravar: () => (emVoo = new Map()),
  });
}

/** Junta o index remoto no nosso: o que mudamos aqui vence, o resto vem de lá. */
function mesclarIndice(remoto) {
  for (const r of remoto.articles || []) {
    const l = entrada(r.id);
    if (!l) {
      indice.articles.push(r);
      continue;
    }
    const meus = meusCampos(r.id);
    for (const [k, v] of Object.entries(r)) if (!meus.has(k)) l[k] = v;
  }
}

export class SemToken extends Error {}

export async function carregarIndice() {
  if (LOCAL) {
    indice = (await ler('index.json', { opcional: true })) || { schema: 1, updatedAt: null, articles: [] };
    return indice;
  }
  if (!gh.lerToken()) throw new SemToken('Configure o token do GitHub para ver seus artigos.');
  const [arv, idx] = await Promise.all([gh.arvore(), gh.lerJson('index.json', { opcional: true })]);
  for (const [c, sha] of arv) shas.set(c, sha);
  indice = idx || { schema: 1, updatedAt: null, articles: [] };
  await sincronizar(arv);
  for (const e of indice.articles) if (e.extraction === 'pending') vigiar(e.id, e.updatedAt);
  return indice;
}

/** Acrescenta ao índice os artigos que a Action gravou e o índice ainda não conhece. */
async function sincronizar(arv) {
  // novo, pendente ou mudado por fora (Action baixou imagens, edição em
  // outro aparelho): o sha do arquivo no repo difere do que o índice conhece
  const faltando = [];
  let mudou = false;
  for (const [caminho, sha] of arv) {
    const m = caminho.match(/^articles\/(.+)\.json$/);
    if (!m || !ID_VALIDO.test(m[1])) continue;
    const e = entrada(m[1]);
    if (!e || e.extraction === 'pending' || (e.articleSha && e.articleSha !== sha)) faltando.push(m[1]);
    else if (!e.articleSha) {
      e.articleSha = sha;
      marcar(e.id, ['articleSha']);
      mudou = true;
    }
  }
  for (let i = 0; i < faltando.length; i += 6) {
    await Promise.all(faltando.slice(i, i + 6).map((id) => absorverArtigo(id).catch(() => {})));
  }
  if (faltando.length || mudou) gravarIndice(0);
}

async function absorverArtigo(id, artigo = null) {
  const a = artigo || (await ler(`articles/${id}.json`));
  artigosCache.set(id, a);
  const existente = entrada(id);
  const nova = { ...entradaDoArtigo(a, existente), articleSha: shas.get(`articles/${id}.json`) || null };
  if (existente) Object.assign(existente, nova);
  else indice.articles.unshift(nova);
  marcar(id, Object.keys(nova));
}

export function artigosDoIndice() {
  return indice ? indice.articles : [];
}

export function entrada(id) {
  return artigosDoIndice().find((a) => a.id === id) || null;
}

export function todasAsTags() {
  const n = new Map();
  for (const a of artigosDoIndice()) for (const t of a.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return n;
}

export function todasAsCategorias() {
  const n = new Map();
  for (const a of artigosDoIndice()) for (const c of a.categories || []) n.set(c, (n.get(c) || 0) + 1);
  return n;
}

/** Muda campos de estado de um artigo (favorite, archivedAt, readAt, progress, tags, categories…). */
export function atualizar(id, mudancas) {
  const a = entrada(id);
  if (!a) return;
  Object.assign(a, mudancas, { updatedAt: new Date().toISOString() });
  marcar(id, [...Object.keys(mudancas), 'updatedAt']);
  indice.updatedAt = a.updatedAt;
  gravarIndice();
}

// ======================================================================
// salvar por URL (Action) e acompanhar a extração
// ======================================================================

async function novoId(url) {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${hex.slice(0, 6)}`;
}

/** Salva uma URL. Devolve { entrada, jaExistia }. */
export async function salvarUrl(bruta) {
  const url = normalizarUrl(bruta);
  if (!/^https?:\/\/[^/]+\.[^/]+/i.test(url)) throw new Error('Isso não parece um endereço de página (https://…).');
  const existente = artigosDoIndice().find((a) => a.url === url);
  if (existente) return { entrada: existente, jaExistia: true };
  if (LOCAL) throw new Error('No modo local, salve pelo terminal: npm run extrair -- "URL"');

  const id = await novoId(url);
  const e = entradaPendente(id, url);
  indice.articles.unshift(e);
  marcar(id, Object.keys(e));
  gravarIndice(0);
  await disparar(e);
  return { entrada: e, jaExistia: false };
}

/** Dispara a extração de novo (artigo que falhou). */
export async function tentarDeNovo(id) {
  const e = entrada(id);
  if (!e) return;
  atualizar(id, { extraction: 'pending', extractionError: null });
  await disparar(e);
}

async function disparar(e) {
  try {
    await gh.dispararExtracao(e.url, e.id);
    vigiar(e.id, new Date().toISOString());
  } catch (err) {
    atualizar(e.id, { extraction: 'failed', extractionError: `Não foi possível iniciar a extração: ${err.message}` });
    notificar('artigos');
    throw err;
  }
}

const vigiados = new Set();

/** Confere a cada 15 s se a Action terminou; desiste em 8 min. `desde` = quando foi pedida. */
function vigiar(id, desde) {
  if (vigiados.has(id) || LOCAL) return;
  vigiados.add(id);
  const inicio = Date.now();
  const passo = async () => {
    const e = entrada(id);
    if (!e || e.extraction !== 'pending') return vigiados.delete(id);
    try {
      const a = await ler(`articles/${id}.json`, { opcional: true });
      // só vale um artigo extraído depois do pedido (no "tentar de novo" o arquivo antigo ainda existe)
      const novo = a && new Date(a.extraction?.at || 0) > new Date(desde) - 30_000;
      if (novo) {
        artigosCache.delete(id);
        await absorverArtigo(id, a);
        gravarIndice(0);
        indiceBusca = null;
        vigiados.delete(id);
        notificar('artigos');
        return;
      }
      if (Date.now() - inicio > 60_000) {
        const exec = await gh.execucaoDe(id).catch(() => null);
        if (exec?.status === 'completed' && exec.conclusion !== 'success') {
          atualizar(id, { extraction: 'failed', extractionError: `A Action terminou com erro (${exec.conclusion}). Veja o registro: ${exec.html_url}` });
          vigiados.delete(id);
          notificar('artigos');
          return;
        }
      }
      if (Date.now() - inicio > 8 * 60_000) {
        atualizar(id, { extraction: 'failed', extractionError: 'A extração demorou demais. Tente de novo ou use o bookmarklet.' });
        vigiados.delete(id);
        notificar('artigos');
        return;
      }
    } catch {
      /* falha passageira de rede: tenta no próximo passo */
    }
    setTimeout(passo, 15_000);
  };
  setTimeout(passo, 20_000);
}

// ======================================================================
// artigos e imagens
// ======================================================================

/** Espera todas as gravações pendentes chegarem ao GitHub (ou ao disco). */
export async function aguardarGravacoes() {
  for (let i = 0; i < 40 && temPendencias(); i++) {
    await new Promise((r) => setTimeout(r, 400));
    await fila;
  }
}

/**
 * Grava um artigo já extraído (bookmarklet; edição manual no 4f).
 * Se a URL já estiver salva, substitui o texto mantendo id, estado e anotações.
 * Devolve a entrada do índice.
 */
export async function salvarArtigoPronto(artigo, { motivo = artigo.extraction?.method || 'app' } = {}) {
  const existente = artigosDoIndice().find((a) => a.url === artigo.url || a.id === artigo.id);
  const id = existente?.id || (await novoId(artigo.url));
  const final = { ...artigo, id, savedAt: existente?.savedAt || artigo.savedAt || new Date().toISOString() };
  const caminho = `articles/${id}.json`;
  if (!LOCAL && !shas.has(caminho)) {
    // o arquivo pode existir no repo sem estarmos sabendo (ex.: extração que falhou)
    const atual = await gh.lerJsonComSha(caminho).catch(() => ({ sha: null }));
    if (atual.sha) shas.set(caminho, atual.sha);
  }
  await gravarComMescla(caminho, () => final, () => {}, `artigos: ${existente ? 'substitui' : 'salva'} ${id} (${motivo})`);
  artigosCache.set(id, Promise.resolve(final));
  await absorverArtigo(id, final);
  gravarIndice(0);
  await aguardarGravacoes();

  // imagens externas → a Action baixa (e já refaz a busca); senão, só refaz a busca
  const temLinkExterno = final.images?.some((i) => i.hotlink) || final.leadImage?.hotlink;
  if (!LOCAL) await gh.dispararModo(temLinkExterno ? 'imagens' : 'indexar', final.url, id).catch((e) => ouvinteErro(e));
  versaoAnotacoes++;
  indiceBusca = null;
  notificar('artigos');
  return entrada(id);
}

const artigosCache = new Map();

export async function carregarArtigo(id) {
  if (!artigosCache.has(id)) {
    const p = ler(`articles/${encodeURIComponent(id)}.json`);
    artigosCache.set(id, p);
    p.catch(() => artigosCache.delete(id));
  }
  return artigosCache.get(id);
}

const midias = new Map(); // caminho → Promise<url utilizável>
let observador = null;

/** Põe uma imagem guardada (media/...) num <img>. No modo GitHub baixa com o token, quando a imagem aparece na tela. */
export function aplicarMidia(img, src) {
  if (!src) return;
  if (/^https?:/i.test(src)) {
    img.src = src; // imagem que ficou com o link original
    return;
  }
  if (LOCAL) {
    img.src = BASE_LOCAL + src;
    return;
  }
  img.dataset.midia = src;
  img.classList.add('midia-carregando');
  observador ||= new IntersectionObserver(
    (itens) => {
      for (const it of itens) {
        if (!it.isIntersecting) continue;
        observador.unobserve(it.target);
        carregarMidia(it.target);
      }
    },
    { rootMargin: '600px 0px' },
  );
  observador.observe(img);
}

async function carregarMidia(img) {
  const src = img.dataset.midia;
  try {
    img.src = await urlDaMidia(src);
  } catch {
    img.alt = '[imagem indisponível]';
  } finally {
    img.classList.remove('midia-carregando');
  }
}

// no máximo 6 downloads de imagem ao mesmo tempo
let emCurso = 0;
const esperando = [];
async function vez(fn) {
  if (emCurso >= 6) await new Promise((r) => esperando.push(r));
  emCurso++;
  try {
    return await fn();
  } finally {
    emCurso--;
    esperando.shift()?.();
  }
}

function urlDaMidia(src) {
  if (!midias.has(src)) {
    const p = (async () => {
      // cache do navegador: a chave inclui o sha, então imagem trocada é baixada de novo
      const chave = `https://artigos.cache/${src}?v=${shas.get(src) || '0'}`;
      let cache = null;
      try {
        cache = await caches.open('artigos-midia');
        const r = await cache.match(chave);
        if (r) return URL.createObjectURL(await r.blob());
      } catch {}
      const blob = await vez(() => gh.lerBlob(src));
      try {
        await cache?.put(chave, new Response(blob));
      } catch {}
      return URL.createObjectURL(blob);
    })();
    midias.set(src, p);
    p.catch(() => midias.delete(src));
  }
  return midias.get(src);
}

// ======================================================================
// anotações
// annotations/AAAA-MM.json = { schema: 1, "<id>": { note, noteUpdatedAt, highlights: [] } }
// ======================================================================

const arquivosAnotacoes = new Map(); // caminho → Promise<objeto>
const sujos = new Map(); // caminho → Set(ids mudados aqui, ainda não confirmados)
const sujosEmVoo = new Map(); // caminho → Set(ids da gravação em andamento)
let versaoAnotacoes = 0;
export const versaoDasAnotacoes = () => versaoAnotacoes;

function arquivoDe(id) {
  const e = entrada(id);
  return e?.annotationsFile || `annotations/${(e?.savedAt || new Date().toISOString()).slice(0, 7)}.json`;
}

function carregarArquivoAnotacoes(caminho) {
  if (!arquivosAnotacoes.has(caminho)) {
    const p = ler(caminho, { opcional: true }).then((d) => d || { schema: 1 });
    arquivosAnotacoes.set(caminho, p);
    p.catch(() => arquivosAnotacoes.delete(caminho));
  }
  return arquivosAnotacoes.get(caminho);
}

const vazia = () => ({ note: '', noteUpdatedAt: null, highlights: [] });

/** Anotações de um artigo. Edite o objeto e chame salvarAnotacoes(id). */
export async function anotacoesDe(id) {
  const arq = await carregarArquivoAnotacoes(arquivoDe(id));
  if (!arq[id]) arq[id] = vazia();
  return arq[id];
}

export async function salvarAnotacoes(id) {
  const caminho = arquivoDe(id);
  const arq = await carregarArquivoAnotacoes(caminho);
  const a = arq[id] || vazia();
  versaoAnotacoes++;
  if (!sujos.has(caminho)) sujos.set(caminho, new Set());
  sujos.get(caminho).add(id);
  atualizar(id, { highlightCount: a.highlights.length, hasNote: !!a.note?.trim() });
  agendarGravacao(caminho, {
    mensagem: `artigos: anotações (${caminho.slice(12, 19)})`,
    obter: () => {
      const voo = sujosEmVoo.get(caminho) || new Set();
      for (const x of sujos.get(caminho) || []) voo.add(x);
      sujosEmVoo.set(caminho, voo);
      sujos.delete(caminho);
      const limpo = { schema: 1 }; // não grava entradas vazias
      for (const [k, v] of Object.entries(arq)) {
        if (k === 'schema') continue;
        if (v.note?.trim() || v.highlights?.length) limpo[k] = v;
      }
      return limpo;
    },
    mesclar: (remoto) => {
      // o que outro aparelho mudou entra; o que mudamos aqui vence
      const meus = new Set([...(sujos.get(caminho) || []), ...(sujosEmVoo.get(caminho) || [])]);
      for (const [k, v] of Object.entries(remoto)) {
        if (k === 'schema' || meus.has(k)) continue;
        if (arq[k]) {
          for (const c of Object.keys(arq[k])) delete arq[k][c];
          Object.assign(arq[k], v); // mantém o mesmo objeto (a tela pode estar usando)
        } else arq[k] = v;
      }
    },
    aoGravar: () => sujosEmVoo.delete(caminho),
  });
}

/** Todas as anotações: [{ entrada, anotacoes }] (para a vista geral e a busca). */
export async function todasAnotacoes() {
  const caminhos = [...new Set(artigosDoIndice().map((a) => arquivoDe(a.id)))];
  const arquivos = await Promise.all(caminhos.map(carregarArquivoAnotacoes));
  const lista = [];
  for (const arq of arquivos) {
    for (const [id, anot] of Object.entries(arq)) {
      if (id === 'schema') continue;
      const e = entrada(id);
      if (e && (anot.highlights?.length || anot.note?.trim())) lista.push({ entrada: e, anotacoes: anot });
    }
  }
  return lista;
}

// ======================================================================
// busca
// ======================================================================

let indiceBusca = null;
export async function carregarIndiceBusca() {
  if (!indiceBusca) {
    indiceBusca = ler('search/texto.json', { opcional: true });
    indiceBusca.catch(() => (indiceBusca = null));
  }
  return indiceBusca;
}

// ======================================================================
// backup
// ======================================================================

export async function exportarBackup() {
  const artigos = [];
  for (const a of artigosDoIndice()) {
    if (a.extraction === 'pending') continue;
    try {
      artigos.push(await carregarArtigo(a.id));
    } catch {
      /* artigo sem arquivo: segue */
    }
  }
  const caminhos = [...new Set(artigosDoIndice().map((a) => arquivoDe(a.id)))];
  const anotacoes = {};
  for (const c of caminhos) anotacoes[c] = await carregarArquivoAnotacoes(c);
  return {
    tipo: 'artigos-backup',
    schema: 1,
    exportadoEm: new Date().toISOString(),
    observacao: 'Imagens não incluídas (ficam no repositório de dados).',
    index: indice,
    annotations: anotacoes,
    articles: artigos,
  };
}

/** Importa um backup: artigos e anotações com o mesmo id são substituídos. */
export async function importarBackup(b, aoProgredir = () => {}) {
  if (b?.tipo !== 'artigos-backup' || !b.index?.articles) throw new Error('Este arquivo não é um backup do Artigos.');
  const artigos = (b.articles || []).filter((a) => ID_VALIDO.test(a.id));
  let n = 0;
  for (const art of artigos) {
    await gravar(`articles/${art.id}.json`, art, `artigos: importa ${art.id}`).catch(async (e) => {
      if (!(e instanceof gh.Conflito)) throw e;
      shas.set(`articles/${art.id}.json`, (await gh.lerJsonComSha(`articles/${art.id}.json`)).sha);
      await gravar(`articles/${art.id}.json`, art, `artigos: importa ${art.id}`);
    });
    artigosCache.set(art.id, Promise.resolve(art));
    aoProgredir(++n, artigos.length);
  }
  for (const [caminho, conteudo] of Object.entries(b.annotations || {})) {
    if (!/^annotations\/\d{4}-\d{2}\.json$/.test(caminho)) continue;
    const atual = await carregarArquivoAnotacoes(caminho);
    for (const [k, v] of Object.entries(conteudo)) if (k !== 'schema') atual[k] = v;
    await gravarComMescla(caminho, () => atual, () => {}, 'artigos: importa anotações');
  }
  for (const a of b.index.articles) {
    if (!ID_VALIDO.test(a.id)) continue;
    const e = entrada(a.id);
    if (e) Object.assign(e, a);
    else indice.articles.push(a);
    marcar(a.id, Object.keys(a));
  }
  indice.updatedAt = new Date().toISOString();
  await gravarComMescla('index.json', () => indice, mesclarIndice, 'artigos: importa backup');
  versaoAnotacoes++;
  indiceBusca = null;
  return { artigos: artigos.length };
}
