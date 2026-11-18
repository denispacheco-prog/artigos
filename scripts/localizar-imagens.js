#!/usr/bin/env node
// Baixa e comprime as imagens de um artigo que entrou com links externos
// (salvo pelo bookmarklet: o navegador não pode baixar imagens de outros sites).
//   node scripts/localizar-imagens.js --id <id> --saida ../dados
// Roda na Action (modo "imagens"). Mesmas regras de imagem do extrator.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { cuidarDasImagens } from './extrair.js';
import { ID_VALIDO } from '../lib/indice.js';

const args = process.argv.slice(2);
const id = args[args.indexOf('--id') + 1];
const saida = args.includes('--saida') ? args[args.indexOf('--saida') + 1] : 'amostra-dados';
if (!ID_VALIDO.test(id || '')) {
  console.error('Uso: localizar-imagens.js --id AAAAMMDD-xxxxxx [--saida pasta]');
  process.exit(1);
}

const arquivo = path.join(saida, 'articles', `${id}.json`);
const a = JSON.parse(await readFile(arquivo, 'utf8'));

const { document } = new JSDOM('').window;
const corpo = document.createElement('div');
corpo.innerHTML = a.contentHtml || '';

const avisos = [];
const principalOriginal = a.leadImage?.originalSrc || a.leadImage?.src || null;
const { imagens, principal } = await cuidarDasImagens(corpo, id, a.url, principalOriginal, path.join(saida, 'media', id), avisos);

a.contentHtml = corpo.innerHTML;
a.images = imagens;
if (principal) a.leadImage = { ...a.leadImage, ...principal };
else if (principalOriginal) a.leadImage = null; // capa descartada (pequena, svg…)
a.extraction = { ...a.extraction, imagesAt: new Date().toISOString(), warnings: [...new Set([...(a.extraction?.warnings || []), ...avisos])] };

await writeFile(arquivo, JSON.stringify(a, null, 2));
const locais = imagens.filter((i) => !i.hotlink).length;
console.log(`${id}: ${locais} imagens baixadas, ${imagens.length - locais} mantidas com link externo.`);
