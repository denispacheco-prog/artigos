// Camada de dados. Hoje: modo local (amostra-dados/ via scripts/servidor.js).
// No M4 ganha o modo GitHub (repo privado artigos-dados, com token), com a
// mesma interface — o resto do app não muda.

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const BASE_LOCAL = 'amostra-dados/';

export const modo = LOCAL ? 'local' : 'github';

let indice = null;

async function lerJson(caminho) {
  const resp = await fetch(BASE_LOCAL + caminho, { cache: 'no-store' });
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

export async function carregarIndice() {
  if (modo !== 'local') throw new Error('O modo GitHub chega no M4. Por enquanto, rode localmente com "npm run site".');
  indice = await lerJson('index.json').catch(() => ({ schema: 1, updatedAt: null, articles: [] }));
  return indice;
}

export function artigosDoIndice() {
  return indice ? indice.articles : [];
}

export function entrada(id) {
  return artigosDoIndice().find((a) => a.id === id) || null;
}

export function carregarArtigo(id) {
  return lerJson(`articles/${encodeURIComponent(id)}.json`);
}

/** Endereço utilizável de uma imagem guardada (media/...). */
export function urlMidia(src) {
  if (!src) return null;
  return /^media\//.test(src) ? BASE_LOCAL + src : src;
}

// Gravações do índice agrupadas: várias mudanças seguidas viram uma gravação.
let gravacaoPendente = null;
let fila = Promise.resolve();

/** Muda campos de estado de um artigo (favorite, archivedAt, readAt, progress, tags). */
export function atualizar(id, mudancas) {
  const a = entrada(id);
  if (!a) return;
  Object.assign(a, mudancas, { updatedAt: new Date().toISOString() });
  indice.updatedAt = a.updatedAt;
  clearTimeout(gravacaoPendente);
  gravacaoPendente = setTimeout(() => {
    fila = fila.then(() => gravarJson('index.json', indice)).catch((e) => avisarErro(e));
  }, 600);
}

let ouvinteErro = () => {};
export function aoErrar(fn) {
  ouvinteErro = fn;
}
function avisarErro(e) {
  ouvinteErro(e);
}
