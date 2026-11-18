// Integração com o meus-bookmarks (M5): envia um highlight como "Quote".
// Usa o token que o próprio meus-bookmarks guarda neste navegador (mesma
// origem denispacheco-prog.github.io) e grava data/bookmarks.json do mesmo
// jeito que o api-client.js dele: lê, acrescenta no fim, grava com sha.
// ATENÇÃO: o repositório meus-bookmarks é PÚBLICO.

const DONO = 'denispacheco-prog';
const REPO = 'meus-bookmarks';
const ARQUIVO = 'data/bookmarks.json';
const CHAVE_TOKEN = 'meusBookmarks.githubToken'; // mesma chave do api-client.js do meus-bookmarks
const API = `https://api.github.com/repos/${DONO}/${REPO}/contents/${ARQUIVO}`;

export const URL_SITE = `https://${DONO}.github.io/${REPO}/`;

function token() {
  try {
    return localStorage.getItem(CHAVE_TOKEN) || '';
  } catch {
    return '';
  }
}

export const configurado = () => !!token();

const cabecalhos = (extra = {}) => ({ Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra });

function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function deBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function erroHttp(status) {
  if (status === 401) return new Error('O token do Bookmarks neste navegador é inválido ou expirou. Atualize-o no Bookmarks (menu ⋯ → Token do GitHub).');
  if (status === 403 || status === 404) return new Error('O token do Bookmarks não tem permissão para gravar lá.');
  return new Error(`O GitHub respondeu ${status} ao gravar no Bookmarks.`);
}

async function lerArquivo() {
  const r = await fetch(`${API}?ref=main`, { headers: cabecalhos(), cache: 'no-store' });
  if (!r.ok) throw erroHttp(r.status);
  const meta = await r.json();
  // acima de 1 MB a API não manda o conteúdo junto: busca a versão bruta
  const texto = meta.content
    ? deBase64(meta.content)
    : await (await fetch(`${API}?ref=main`, { headers: cabecalhos({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' })).text();
  const dados = JSON.parse(texto);
  dados.bookmarks ||= [];
  return { dados, sha: meta.sha };
}

/** Texto do Quote: o trecho e, se houver, a nota depois de uma linha em branco. */
export function descricaoDoQuote(trecho, nota) {
  const t = (trecho || '').trim();
  const n = (nota || '').trim();
  return n ? `${t}\n\n— Nota: ${n}` : t;
}

/**
 * Cria um Quote no meus-bookmarks. Devolve o id do bookmark criado.
 * `artigo` = entrada do índice do artigos (title, url, tags).
 */
export async function enviarQuote({ trecho, nota, artigo }) {
  if (!configurado()) throw new Error('Este navegador ainda não tem o token do Bookmarks. Abra o Bookmarks, configure o token (menu ⋯ → Token do GitHub) e tente de novo.');
  const bookmark = {
    id: crypto.randomUUID(),
    url: artigo.url,
    title: (artigo.title || artigo.url).trim(),
    description: descricaoDoQuote(trecho, nota),
    tags: [...new Set((artigo.tags || []).map((t) => t.trim()).filter(Boolean))],
    categories: ['Quote'],
    favorite: false,
    createdAt: new Date().toISOString(),
  };
  // em conflito (o meus-bookmarks gravou ao mesmo tempo), relê e tenta de novo
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { dados, sha } = await lerArquivo();
    dados.bookmarks.push(bookmark);
    const r = await fetch(API, {
      method: 'PUT',
      headers: cabecalhos({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: `Adiciona bookmark: ${bookmark.title} (Quote, via artigos)`, content: paraBase64(JSON.stringify(dados, null, 2) + '\n'), sha, branch: 'main' }),
    });
    if (r.ok) return bookmark.id;
    if (r.status !== 409 || tentativa === 3) throw erroHttp(r.status);
  }
}
