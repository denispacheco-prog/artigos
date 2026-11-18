// Camada de dados. Hoje: modo local (amostra-dados/ via scripts/servidor.js).
// No M4 ganha o modo GitHub (repo privado artigos-dados, com token), com a
// mesma interface — o resto do app não muda.
//
// Dono de cada arquivo (DECISOES.md): o app escreve index.json e
// annotations/*.json; articles/*.json só na importação de backup.

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const BASE_LOCAL = 'amostra-dados/';

export const modo = LOCAL ? 'local' : 'github';

let indice = null;

async function lerJson(caminho, { opcional = false } = {}) {
  const resp = await fetch(BASE_LOCAL + caminho, { cache: 'no-store' });
  if (opcional && resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Não foi possível ler ${caminho} (HTTP ${resp.status}).`);
  return resp.json();
}

async function gravarJson(caminho, dado) {
  const resp = await fetch('dados/' + caminho, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dado, null, 2),
  });
  if (!resp.ok) throw new Error(`Não foi possível gravar ${caminho} (HTTP ${resp.status}).`);
}

// ---------------------------------------------------------------- gravação
// Várias mudanças seguidas no mesmo arquivo viram uma gravação só; as
// gravações saem em fila, uma de cada vez.

const pendentes = new Map(); // caminho -> timer
let fila = Promise.resolve();

function agendarGravacao(caminho, obterDado, atraso = 600) {
  clearTimeout(pendentes.get(caminho));
  pendentes.set(
    caminho,
    setTimeout(() => {
      pendentes.delete(caminho);
      fila = fila.then(() => gravarJson(caminho, obterDado())).catch((e) => ouvinteErro(e));
    }, atraso),
  );
}

/** Há gravações ainda não enviadas? (para avisar ao fechar a página) */
export const temPendencias = () => pendentes.size > 0;

let ouvinteErro = () => {};
export function aoErrar(fn) {
  ouvinteErro = fn;
}

// ---------------------------------------------------------------- índice

export async function carregarIndice() {
  if (modo !== 'local') throw new Error('O modo GitHub chega no M4. Por enquanto, rode localmente com "npm run site".');
  indice = (await lerJson('index.json', { opcional: true })) || { schema: 1, updatedAt: null, articles: [] };
  return indice;
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

/** Muda campos de estado de um artigo (favorite, archivedAt, readAt, progress, tags…). */
export function atualizar(id, mudancas) {
  const a = entrada(id);
  if (!a) return;
  Object.assign(a, mudancas, { updatedAt: new Date().toISOString() });
  indice.updatedAt = a.updatedAt;
  agendarGravacao('index.json', () => indice);
}

// ---------------------------------------------------------------- artigos

export function carregarArtigo(id) {
  return lerJson(`articles/${encodeURIComponent(id)}.json`);
}

/** Endereço utilizável de uma imagem guardada (media/...). */
export function urlMidia(src) {
  if (!src) return null;
  return /^media\//.test(src) ? BASE_LOCAL + src : src;
}

// ---------------------------------------------------------------- anotações
// annotations/AAAA-MM.json = { schema: 1, "<id do artigo>": { note, noteUpdatedAt, highlights: [] } }

const arquivosAnotacoes = new Map(); // caminho -> Promise<objeto>
let versaoAnotacoes = 0;
export const versaoDasAnotacoes = () => versaoAnotacoes;

function arquivoDe(id) {
  const e = entrada(id);
  return e?.annotationsFile || `annotations/${(e?.savedAt || new Date().toISOString()).slice(0, 7)}.json`;
}

function carregarArquivoAnotacoes(caminho) {
  if (!arquivosAnotacoes.has(caminho)) {
    arquivosAnotacoes.set(
      caminho,
      lerJson(caminho, { opcional: true }).then((d) => d || { schema: 1 }),
    );
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
  atualizar(id, { highlightCount: a.highlights.length, hasNote: !!a.note?.trim() });
  agendarGravacao(caminho, () => {
    // não grava entradas vazias
    const limpo = { schema: 1 };
    for (const [k, v] of Object.entries(arq)) {
      if (k === 'schema') continue;
      if (v.note?.trim() || v.highlights?.length) limpo[k] = v;
    }
    return limpo;
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

// ---------------------------------------------------------------- busca

let indiceBusca = null;
export async function carregarIndiceBusca() {
  if (!indiceBusca) indiceBusca = lerJson('search/texto.json', { opcional: true });
  return indiceBusca;
}

// ---------------------------------------------------------------- backup

export async function exportarBackup() {
  const artigos = [];
  for (const a of artigosDoIndice()) {
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
export async function importarBackup(b) {
  if (b?.tipo !== 'artigos-backup' || !b.index?.articles) throw new Error('Este arquivo não é um backup do Artigos.');
  for (const art of b.articles || []) await gravarJson(`articles/${art.id}.json`, art);
  for (const [caminho, conteudo] of Object.entries(b.annotations || {})) {
    if (!/^annotations\/\d{4}-\d{2}\.json$/.test(caminho)) continue;
    const atual = await carregarArquivoAnotacoes(caminho);
    const unido = { ...atual, ...conteudo, schema: 1 };
    arquivosAnotacoes.set(caminho, Promise.resolve(unido));
    await gravarJson(caminho, unido);
  }
  const porId = new Map(artigosDoIndice().map((a) => [a.id, a]));
  for (const a of b.index.articles) porId.set(a.id, a);
  indice.articles = [...porId.values()];
  indice.updatedAt = new Date().toISOString();
  await gravarJson('index.json', indice);
  versaoAnotacoes++;
  return { artigos: (b.articles || []).length };
}
