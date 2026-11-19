#!/usr/bin/env node
// Servidor local para testar o site sem GitHub (M2/M3). Sem dependências.
//   npm run site   →   http://localhost:8000
// Serve os arquivos do projeto e deixa o app gravar JSON em amostra-dados/
// (PUT /dados/<caminho>.json), como o server.py do meus-bookmarks.
// Escuta só em 127.0.0.1: nada fica acessível de fora do seu computador.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(RAIZ, 'amostra-dados');
const PORTA = Number(process.env.PORTA) || 8000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** Resolve um caminho da URL dentro de `base`, recusando "../". */
function dentroDe(base, caminhoUrl) {
  const alvo = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(caminhoUrl)));
  return alvo === base || alvo.startsWith(base + path.sep) ? alvo : null;
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'PUT' && url.pathname.startsWith('/dados/')) {
      const alvo = dentroDe(DADOS, url.pathname.slice('/dados'.length));
      if (!alvo || !alvo.endsWith('.json')) return enviar(res, 400, 'caminho inválido');
      let corpo = '';
      for await (const parte of req) corpo += parte;
      try {
        JSON.parse(corpo); // só grava JSON válido
      } catch {
        return enviar(res, 400, 'JSON inválido');
      }
      await mkdir(path.dirname(alvo), { recursive: true });
      await writeFile(alvo, corpo);
      return enviar(res, 204);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return enviar(res, 405, 'método não permitido');

    let alvo = dentroDe(RAIZ, url.pathname);
    if (!alvo || /(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(path.relative(RAIZ, alvo))) return enviar(res, 404, 'não encontrado');
    if ((await stat(alvo).catch(() => null))?.isDirectory()) alvo = path.join(alvo, 'index.html');
    const dados = await readFile(alvo);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : dados);
  } catch (e) {
    enviar(res, e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'não encontrado' : String(e.message));
  }
});

function enviar(res, status, texto = '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`Artigos rodando em http://localhost:${PORTA}  (Ctrl+C para parar)`);
});
