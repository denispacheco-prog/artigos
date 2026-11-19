// Service worker do Artigos: deixa abrir o app e ler sem internet.
//
// - Arquivos do site (HTML, CSS, JS, fontes): sempre da rede quando há
//   internet, para nunca ficar preso numa versão velha; a cópia guardada só
//   entra quando a rede falha ou demora demais.
// - Dados do artigos-dados lidos pela API do GitHub (index.json, artigos,
//   anotações, lista de arquivos): mesma regra. As imagens não passam por
//   aqui: o app já as guarda no cache "artigos-midia" (dados.js).
// - Gravações (PUT, POST, PATCH, DELETE) nunca são guardadas nem respondidas
//   daqui: sem internet elas esperam no app até a conexão voltar.

const CACHE_SITE = 'artigos-site-v1';
const CACHE_DADOS = 'artigos-dados-v1';
const ESPERA_REDE_MS = 4000; // rede ruim no celular: depois disso, usa a cópia guardada
const REPO_DADOS = '/repos/denispacheco-prog/artigos-dados/';
const ESCOPO = new URL('./', self.location).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_SITE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const validos = [CACHE_SITE, CACHE_DADOS, 'artigos-midia'];
      for (const nome of await caches.keys()) if (nome.startsWith('artigos-') && !validos.includes(nome)) await caches.delete(nome);
      await self.clients.claim();
    })(),
  );
});

// O app manda a lista do que já carregou (CSS, módulos JS, fontes) para
// guardar de uma vez: assim a primeira visita já deixa o site pronto offline.
self.addEventListener('message', (e) => {
  if (e.data?.tipo !== 'guardar-site' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(
    caches.open(CACHE_SITE).then((c) =>
      Promise.all(
        e.data.urls
          .filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin && new URL(u).pathname.startsWith(ESCOPO))
          .map(async (u) => {
            if (!(await c.match(u))) await c.add(u).catch(() => {});
          }),
      ),
    ),
  );
});

function ehDadoDoArtigos(url) {
  return (
    url.origin === 'https://api.github.com' &&
    url.pathname.startsWith(REPO_DADOS) &&
    !url.pathname.startsWith(REPO_DADOS + 'contents/media/') &&
    (url.pathname.startsWith(REPO_DADOS + 'contents/') || url.pathname.startsWith(REPO_DADOS + 'git/trees/'))
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // gravações do servidor local (dados/) não são GET; amostra-dados/ pode ser guardada
    if (!url.pathname.startsWith(ESCOPO)) return;
    e.respondWith(redePrimeiro(req, CACHE_SITE, req.mode === 'navigate' ? './' : null));
  } else if (ehDadoDoArtigos(url)) {
    e.respondWith(redePrimeiro(req, CACHE_DADOS));
  }
});

/** Tenta a rede; se falhar ou demorar, usa a cópia guardada. Guarda toda resposta boa. */
async function redePrimeiro(req, nomeCache, reserva = null) {
  const cache = await caches.open(nomeCache);
  const rede = fetch(req).then((r) => {
    if (r.ok) cache.put(req, r.clone()).catch(() => {});
    return r;
  });
  const guardada = (await cache.match(req)) || (reserva && (await cache.match(reserva)));
  if (!guardada) return rede;
  const prazo = new Promise((ok) => setTimeout(() => ok(guardada), ESPERA_REDE_MS));
  return Promise.race([rede, prazo]).catch(() => guardada);
}
