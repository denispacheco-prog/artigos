#!/usr/bin/env node
// Gera o índice de busca do texto integral: <dados>/search/texto.json.
//   npm run indexar [-- --saida pasta]
// Também é chamado automaticamente ao fim do "npm run extrair".
// No M4 a Action roda este mesmo código no repo privado.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MiniSearch from 'minisearch';
import { JSDOM } from 'jsdom';
import { OPCOES_TEXTO, VERSAO_INDICE } from '../lib/busca.js';

function textoDoHtml(html) {
  const { document } = new JSDOM('').window;
  const div = document.createElement('div');
  div.innerHTML = html || '';
  // separa blocos para palavras de parágrafos vizinhos não grudarem
  for (const bloco of div.querySelectorAll('p, li, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, br')) bloco.append(' ');
  return div.textContent.replace(/\s+/g, ' ').trim();
}

export async function gerarIndiceBusca(saida = 'amostra-dados') {
  const dir = path.join(saida, 'articles');
  const arquivos = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const busca = new MiniSearch(OPCOES_TEXTO);
  for (const f of arquivos) {
    const a = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    if (a.extraction?.status === 'failed' && !a.contentHtml) continue;
    busca.add({ id: a.id, title: a.title || '', byline: a.byline || '', siteName: a.siteName || '', text: textoDoHtml(a.contentHtml) });
  }
  const conteudo = JSON.stringify({ schema: 1, versao: VERSAO_INDICE, geradoEm: new Date().toISOString(), artigos: busca.documentCount, indice: busca.toJSON() });
  await mkdir(path.join(saida, 'search'), { recursive: true });
  await writeFile(path.join(saida, 'search', 'texto.json'), conteudo);
  return { artigos: busca.documentCount, bytes: Buffer.byteLength(conteudo) };
}

// rodando direto: npm run indexar
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--saida');
  const saida = i > 0 ? process.argv[i + 1] : 'amostra-dados';
  const r = await gerarIndiceBusca(saida);
  console.log(`Índice de busca: ${r.artigos} artigos, ${(r.bytes / 1024).toFixed(0)} KB → ${path.join(saida, 'search', 'texto.json')}`);
}
