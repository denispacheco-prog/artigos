// Testes da ancoragem de highlights e da busca no texto (lib/ancora.js).
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="c"></div>');
globalThis.document = dom.window.document;
globalThis.NodeFilter = dom.window.NodeFilter;
const A = await import('../lib/ancora.js');

const HTML = `<h2>Um título</h2>
<p>O sobrevivente da bomba atômica morreu aos 97 anos. A <a href="https://ex.com">prefeitura</a> decretou luto.</p>
<p>Ele tocava o sino nas cerimônias da bomba atômica, todos os anos, em agosto.</p>
<ul><li>Primeiro item</li><li>Segundo item</li></ul>`;

function montar() {
  const c = document.getElementById('c');
  c.innerHTML = HTML;
  return c;
}

test('posições do Range batem com o texto corrido', () => {
  const c = montar();
  const ps = c.querySelectorAll('p');
  const r = document.createRange();
  r.setStart(ps[0].firstChild, 2);
  r.setEnd(ps[1].firstChild, 15);
  const { inicio, fim } = A.posicoesDoRange(c, r);
  assert.equal(A.textoCorrido(c).slice(inicio, fim), r.toString());
});

test('pintar atravessa parágrafos e links sem mudar o texto', () => {
  const c = montar();
  const texto = A.textoCorrido(c);
  const inicio = texto.indexOf('97 anos');
  const fim = texto.indexOf('o sino') + 6;
  const marcas = A.pintar(c, inicio, fim, () => document.createElement('mark'));
  assert.ok(marcas.length >= 3, `esperava ≥3 marcas, veio ${marcas.length}`);
  assert.equal(A.textoCorrido(c), texto);
  const semEspaco = (x) => x.replace(/\s+/g, '');
  assert.equal(semEspaco(marcas.map((m) => m.textContent).join('')), semEspaco(texto.slice(inicio, fim)));
  assert.ok(c.querySelector('a mark'), 'o pedaço dentro do link também é marcado');
  assert.ok(!c.querySelector('ul > mark'), 'não põe marca solta dentro de lista');
});

test('reancora na mesma posição', () => {
  const texto = A.textoCorrido(montar());
  const i = texto.indexOf('decretou luto');
  const sel = A.criarSeletores(texto, i, i + 13);
  assert.deepEqual(A.ancorar(texto, sel), { inicio: i, fim: i + 13 });
});

test('reancora depois de texto inserido antes (posição velha)', () => {
  const texto = A.textoCorrido(montar());
  const i = texto.indexOf('decretou luto');
  const sel = A.criarSeletores(texto, i, i + 13);
  const novo = 'PARÁGRAFO NOVO. ' + texto;
  const r = A.ancorar(novo, sel);
  assert.equal(novo.slice(r.inicio, r.fim), 'decretou luto');
  assert.equal(r.inicio, i + 16);
});

test('trecho repetido: escolhe a ocorrência pelo contexto', () => {
  const texto = A.textoCorrido(montar());
  const segunda = texto.indexOf('bomba atômica', texto.indexOf('bomba atômica') + 1);
  const sel = A.criarSeletores(texto, segunda, segunda + 13);
  const novo = 'Intro. ' + texto; // posição velha não bate mais
  const r = A.ancorar(novo, sel);
  assert.equal(r.inicio, segunda + 7);
});

test('trecho apagado vira órfão', () => {
  const texto = A.textoCorrido(montar());
  const i = texto.indexOf('decretou luto');
  const sel = A.criarSeletores(texto, i, i + 13);
  assert.equal(A.ancorar(texto.replace('decretou luto', 'fez silêncio'), sel), null);
});

test('despintar devolve o HTML ao normal', () => {
  const c = montar();
  const texto = A.textoCorrido(c);
  A.pintar(c, 5, 60, () => document.createElement('mark'));
  A.despintar(c, 'mark');
  assert.equal(c.querySelector('mark'), null);
  assert.equal(A.textoCorrido(c), texto);
});

test('aparar tira espaços das pontas da seleção', () => {
  assert.deepEqual(A.aparar('  abc  ', 0, 7), { inicio: 2, fim: 5 });
});

test('acharTermos ignora acento e só pega início de palavra', () => {
  const achados = A.acharTermos('Ação e acao; reação; atômica', ['acao', 'atomica']);
  assert.equal(achados.length, 3); // Ação, acao, atômica (não "reação")
  assert.equal('Ação e acao; reação; atômica'.slice(achados[2].inicio, achados[2].fim), 'atômica');
});
