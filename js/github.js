// Cliente da API do GitHub para o repositório PRIVADO de dados.
// O token (fine-grained, só artigos-dados, Contents RW + Actions RW) fica no
// localStorage deste navegador e só é enviado para api.github.com.

export const DONO = 'denispacheco-prog';
export const REPO = 'artigos-dados';
export const RAMO = 'main';
export const WORKFLOW = 'extrair.yml';

const API = 'https://api.github.com';
const CHAVE_TOKEN = 'artigos:githubToken';

export function lerToken() {
  try {
    return localStorage.getItem(CHAVE_TOKEN) || '';
  } catch {
    return '';
  }
}

export function gravarToken(token) {
  try {
    if (token) localStorage.setItem(CHAVE_TOKEN, token.trim());
    else localStorage.removeItem(CHAVE_TOKEN);
  } catch {}
}

export class ErroGitHub extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

async function pedir(caminho, { metodo = 'GET', corpo, aceitar = 'application/vnd.github+json', opcional = false } = {}) {
  const token = lerToken();
  if (!token) throw new ErroGitHub('Configure o token do GitHub (menu ⋯ → Token do GitHub).', 401);
  let resp;
  try {
    resp = await fetch(API + caminho, {
      method: metodo,
      cache: 'no-store',
      headers: {
        Accept: aceitar,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroGitHub('Sem conexão com o GitHub. Verifique a internet.', 0);
  }
  if (opcional && resp.status === 404) return null;
  if (!resp.ok) {
    let detalhe = '';
    try {
      detalhe = (await resp.json()).message || '';
    } catch {}
    const msg =
      resp.status === 401
        ? 'O token do GitHub é inválido ou expirou. Gere outro e cole em ⋯ → Token do GitHub.'
        : resp.status === 403 && /rate limit/i.test(detalhe)
          ? 'Limite de uso da API do GitHub atingido. Tente de novo em alguns minutos.'
          : resp.status === 403 || resp.status === 404
            ? `O token não tem acesso a ${REPO} (ou falta permissão). ${detalhe}`
            : `GitHub respondeu ${resp.status}: ${detalhe}`;
    throw new ErroGitHub(msg, resp.status);
  }
  return resp;
}

const caminhoConteudo = (p) => `/repos/${DONO}/${REPO}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

// ---------------------------------------------------------------- texto ↔ base64 (UTF-8)

function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function deBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- leitura

/** Confere o token e o acesso ao repositório. */
export async function verificarAcesso() {
  const r = await (await pedir(`/repos/${DONO}/${REPO}`)).json();
  if (!r.permissions?.push) throw new ErroGitHub('O token lê o repositório mas não pode gravar. Dê a permissão "Contents: Read and write".', 403);
  return r;
}

/** Lista de arquivos do repositório: Map(caminho → sha). Uma chamada só. */
export async function arvore() {
  const r = await pedir(`/repos/${DONO}/${REPO}/git/trees/${RAMO}?recursive=1`, { opcional: true });
  const mapa = new Map();
  if (!r) return mapa; // repositório vazio
  for (const item of (await r.json()).tree || []) if (item.type === 'blob') mapa.set(item.path, item.sha);
  return mapa;
}

/** Lê um JSON. Devolve null se não existir (com opcional). */
export async function lerJson(caminho, { opcional = false } = {}) {
  const r = await pedir(caminhoConteudo(caminho), { aceitar: 'application/vnd.github.raw+json', opcional });
  return r ? r.json() : null;
}

/** Lê um JSON junto com o sha atual (para gravar depois de um conflito). */
export async function lerJsonComSha(caminho) {
  const r = await pedir(caminhoConteudo(caminho), { opcional: true });
  if (!r) return { dado: null, sha: null };
  const meta = await r.json();
  const texto = meta.content && meta.encoding === 'base64' ? deBase64(meta.content) : await (await pedir(caminhoConteudo(caminho), { aceitar: 'application/vnd.github.raw+json' })).text();
  return { dado: JSON.parse(texto), sha: meta.sha };
}

/** Lê um arquivo binário (imagem). */
export async function lerBlob(caminho) {
  const r = await pedir(caminhoConteudo(caminho), { aceitar: 'application/vnd.github.raw+json' });
  return r.blob();
}

// ---------------------------------------------------------------- gravação

export class Conflito extends Error {}

/** Grava um JSON. `sha` = versão que estamos substituindo (null = arquivo novo). Devolve o novo sha. */
export async function gravarJson(caminho, dado, sha, mensagem) {
  try {
    const r = await pedir(caminhoConteudo(caminho), {
      metodo: 'PUT',
      corpo: { message: mensagem || `artigos: atualiza ${caminho}`, content: paraBase64(JSON.stringify(dado, null, 2) + '\n'), branch: RAMO, ...(sha ? { sha } : {}) },
    });
    return (await r.json()).content.sha;
  } catch (e) {
    // 409 = sha velho; 422 = arquivo já existe e não mandamos sha
    if (e.status === 409 || e.status === 422) throw new Conflito(caminho);
    throw e;
  }
}

// ---------------------------------------------------------------- Action

/** Dispara a extração no repositório de dados. */
export async function dispararExtracao(url, id) {
  await pedir(`/repos/${DONO}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { metodo: 'POST', corpo: { ref: RAMO, inputs: { url, id } } });
}

/** Pede à Action só uma parte do trabalho: 'imagens' (baixar as imagens de um
 *  artigo do bookmarklet) ou 'indexar' (refazer a busca depois de uma edição). */
export async function dispararModo(modo, url, id) {
  await pedir(`/repos/${DONO}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { metodo: 'POST', corpo: { ref: RAMO, inputs: { url, id, modo } } });
}

/** Execução mais recente do workflow para um id (ou null). */
export async function execucaoDe(id) {
  const r = await (await pedir(`/repos/${DONO}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`)).json();
  return (r.workflow_runs || []).find((x) => x.display_title === `Extrair ${id}`) || null;
}
