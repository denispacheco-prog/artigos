// Highlights, notas e tags na tela de leitura (M3).

import * as dados from './dados.js';
import { $, el, svg, ICONES, CORES, armazenamento, debounce, copiar, plural, avisar } from './util.js';
import { textoCorrido, posicoesDoRange, aparar, criarSeletores, ancorar, pintar, despintar, acharTermos } from '../lib/ancora.js';

let ctx = null; // { entrada, corpo, anot, texto, orfaos }

const ordenar = (hs) => [...hs].sort((a, b) => posicao(a) - posicao(b));
const posicao = (h) => h.target.selector.find((s) => s.type === 'TextPositionSelector')?.start ?? 0;
const citacao = (h) => h.target.selector.find((s) => s.type === 'TextQuoteSelector')?.exact || '';
const novoId = () => 'h_' + Math.random().toString(36).slice(2, 10);

// ======================================================================
// montar / desmontar
// ======================================================================

export async function montar(entrada, corpo) {
  fecharTudo();
  const anot = await dados.anotacoesDe(entrada.id);
  ctx = { entrada, corpo, anot, texto: textoCorrido(corpo), orfaos: [] };
  pintarTodos();
  if (painelAberto()) desenharPainel();
}

export function desmontar() {
  fecharTudo();
  ctx = null;
  $('#painel-artigo').hidden = true;
  $('#btn-painel').classList.remove('ativo');
}

function pintarTodos() {
  despintar(ctx.corpo, 'mark.hl');
  ctx.orfaos = [];
  for (const h of ordenar(ctx.anot.highlights)) {
    const pos = ancorar(ctx.texto, h.target.selector);
    if (!pos) {
      ctx.orfaos.push(h);
      h.orphan = true;
      continue;
    }
    h.orphan = false;
    pintarHighlight(h, pos);
  }
}

function pintarHighlight(h, pos) {
  const marcas = pintar(ctx.corpo, pos.inicio, pos.fim, () => el('mark', { class: `hl hl-${h.color}`, 'data-hl': h.id }));
  marcas[marcas.length - 1]?.classList.add('hl-fim');
  if (h.note?.trim()) marcas.forEach((m) => m.classList.add('tem-nota'));
  return marcas;
}

function repintar(h) {
  despintar(ctx.corpo, `mark[data-hl="${h.id}"]`);
  const pos = ancorar(ctx.texto, h.target.selector);
  return pos ? pintarHighlight(h, pos) : [];
}

function salvar() {
  dados.salvarAnotacoes(ctx.entrada.id);
  if (painelAberto()) desenharPainel();
}

/** Sublinha os termos de uma busca e devolve a primeira marca. */
export function marcarTermos(termos) {
  if (!ctx || !termos.length) return null;
  const achados = acharTermos(ctx.texto, termos);
  let primeira = null;
  for (const a of achados.reverse()) {
    const m = pintar(ctx.corpo, a.inicio, a.fim, () => el('mark', { class: 'termo' }));
    primeira = m[0] || primeira;
  }
  return primeira;
}

/** Leva até um highlight e faz piscar. */
export function irPara(idHl) {
  const marca = ctx?.corpo.querySelector(`mark[data-hl="${CSS.escape(idHl)}"]`);
  if (!marca) return false;
  marca.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const todas = ctx.corpo.querySelectorAll(`mark[data-hl="${CSS.escape(idHl)}"]`);
  todas.forEach((m) => m.classList.remove('piscar'));
  requestAnimationFrame(() => todas.forEach((m) => m.classList.add('piscar')));
  return true;
}

// ======================================================================
// barra de seleção (aparece ao selecionar texto)
// ======================================================================

const barraSelecao = $('#barra-selecao');
let ultimaCor = armazenamento.ler('artigos:ultimaCor', 'amarelo');

function desenharBarraSelecao() {
  barraSelecao.replaceChildren(
    ...CORES.map((c) =>
      el('button', { type: 'button', class: `cor cor-${c.id}`, title: `Marcar em ${c.nome.toLowerCase()}`, 'aria-label': `Marcar em ${c.nome.toLowerCase()}`, onclick: () => criarHighlight(c.id) }),
    ),
    el('span', { class: 'barra-sep', 'aria-hidden': 'true' }),
    el('button', { type: 'button', class: 'barra-btn', title: 'Marcar e anotar', onclick: () => criarHighlight(ultimaCor, { comNota: true }) }, svg(ICONES.lapis, { tamanho: 15 }), el('span', { text: 'Nota' })),
  );
}
desenharBarraSelecao();
// manter a seleção ao clicar na barra
barraSelecao.addEventListener('mousedown', (e) => e.preventDefault());

function selecaoNoCorpo() {
  const sel = getSelection();
  if (!ctx || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!ctx.corpo.contains(range.commonAncestorContainer)) return null;
  if (range.toString().trim().length < 2) return null;
  return range;
}

function verificarSelecao() {
  const range = selecaoNoCorpo();
  if (!range) {
    barraSelecao.hidden = true;
    return;
  }
  fecharPopover();
  barraSelecao.hidden = false;
  const r = range.getBoundingClientRect();
  const tocavel = matchMedia('(pointer: coarse)').matches;
  const larg = barraSelecao.offsetWidth;
  const alt = barraSelecao.offsetHeight;
  let top = tocavel ? r.bottom + scrollY + 12 : r.top + scrollY - alt - 10;
  if (!tocavel && r.top < alt + 70) top = r.bottom + scrollY + 10; // sem espaço acima (barra do topo)
  const left = Math.min(Math.max(8, r.left + scrollX + r.width / 2 - larg / 2), document.documentElement.clientWidth - larg - 8);
  barraSelecao.style.top = `${top}px`;
  barraSelecao.style.left = `${left}px`;
}

const verificarDepois = () => setTimeout(verificarSelecao, 0);
document.addEventListener('mouseup', verificarDepois);
document.addEventListener('keyup', (e) => e.shiftKey && verificarDepois());
document.addEventListener('selectionchange', debounce(() => {
  if (matchMedia('(pointer: coarse)').matches || !selecaoNoCorpo()) verificarSelecao();
}, 250));

function criarHighlight(cor, { comNota = false } = {}) {
  const range = selecaoNoCorpo();
  if (!range) return;
  const bruto = posicoesDoRange(ctx.corpo, range);
  const { inicio, fim } = aparar(ctx.texto, bruto.inicio, bruto.fim);
  if (fim - inicio < 1) return;
  const agora = new Date().toISOString();
  const h = { id: novoId(), color: cor, note: '', createdAt: agora, updatedAt: agora, target: { selector: criarSeletores(ctx.texto, inicio, fim) }, orphan: false, exportedTo: null };
  ctx.anot.highlights.push(h);
  ultimaCor = cor;
  armazenamento.gravar('artigos:ultimaCor', cor);
  getSelection().removeAllRanges();
  barraSelecao.hidden = true;
  const marcas = pintarHighlight(h, { inicio, fim });
  salvar();
  if (comNota) abrirPopover(h, marcas[marcas.length - 1], { focarNota: true });
}

// ======================================================================
// popover de um highlight (clicar numa marca)
// ======================================================================

const popover = $('#pop-hl');
let hlAberto = null;

function abrirPopover(h, ancoraEl, { focarNota = false } = {}) {
  hlAberto = h;
  const salvarNota = debounce(() => {
    h.updatedAt = new Date().toISOString();
    for (const m of ctx.corpo.querySelectorAll(`mark[data-hl="${h.id}"]`)) m.classList.toggle('tem-nota', !!h.note.trim());
    salvar();
  }, 600);

  const nota = el('textarea', { class: 'pop-nota', rows: '3', placeholder: 'Escreva uma nota…', 'aria-label': 'Nota do highlight' });
  nota.value = h.note || '';
  nota.addEventListener('input', () => {
    h.note = nota.value;
    salvarNota();
  });
  nota.addEventListener('blur', () => salvarNota.agora());

  popover.replaceChildren(
    el(
      'div',
      { class: 'pop-cores' },
      ...CORES.map((c) =>
        el('button', {
          type: 'button',
          class: `cor cor-${c.id}` + (c.id === h.color ? ' ativa' : ''),
          'aria-label': c.nome,
          'aria-pressed': c.id === h.color ? 'true' : 'false',
          title: c.nome,
          onclick: () => {
            h.color = c.id;
            h.updatedAt = new Date().toISOString();
            ultimaCor = c.id;
            armazenamento.gravar('artigos:ultimaCor', c.id);
            const marcas = repintar(h);
            salvar();
            abrirPopover(h, marcas[marcas.length - 1]);
          },
        }),
      ),
    ),
    nota,
    el(
      'div',
      { class: 'pop-acoes' },
      el('button', { type: 'button', class: 'pop-btn', onclick: () => copiar(textoParaCopiar(h)) }, svg(ICONES.copiar, { tamanho: 14 }), 'Copiar'),
      el('button', { type: 'button', class: 'pop-btn pop-apagar', onclick: () => apagar(h) }, svg(ICONES.lixo, { tamanho: 14 }), 'Apagar'),
    ),
  );
  popover.hidden = false;
  posicionarPopover(ancoraEl);
  if (focarNota) nota.focus();
}

function posicionarPopover(ancoraEl) {
  if (!ancoraEl) return;
  const r = ancoraEl.getBoundingClientRect();
  const larg = popover.offsetWidth;
  const left = Math.min(Math.max(8, r.left + scrollX + r.width / 2 - larg / 2), document.documentElement.clientWidth - larg - 8);
  popover.style.top = `${r.bottom + scrollY + 8}px`;
  popover.style.left = `${left}px`;
}

function fecharPopover() {
  if (popover.hidden) return;
  popover.querySelector('textarea')?.blur();
  popover.hidden = true;
  hlAberto = null;
}

function fecharTudo() {
  fecharPopover();
  barraSelecao.hidden = true;
}

function apagar(h) {
  const i = ctx.anot.highlights.indexOf(h);
  if (i < 0) return;
  ctx.anot.highlights.splice(i, 1);
  despintar(ctx.corpo, `mark[data-hl="${h.id}"]`);
  ctx.orfaos = ctx.orfaos.filter((o) => o !== h);
  fecharPopover();
  salvar();
  avisar('Highlight apagado.');
}

function textoParaCopiar(h) {
  const e = ctx.entrada;
  return `“${citacao(h)}”${h.note?.trim() ? `\n\nNota: ${h.note.trim()}` : ''}\n\n— ${e.title}${e.siteName ? `, ${e.siteName}` : ''}\n${e.url}`;
}

document.addEventListener('click', (e) => {
  if (!ctx) return;
  const marca = e.target.closest?.('mark.hl');
  if (marca && ctx.corpo.contains(marca) && getSelection().isCollapsed) {
    const h = ctx.anot.highlights.find((x) => x.id === marca.dataset.hl);
    if (h) {
      e.preventDefault(); // marca dentro de link: não navega
      abrirPopover(h, marca);
      return;
    }
  }
  // composedPath: o botão clicado pode já ter sido trocado ao redesenhar o popover
  if (!popover.hidden && !e.composedPath().includes(popover)) fecharPopover();
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (!popover.hidden || !barraSelecao.hidden)) {
    e.stopImmediatePropagation();
    fecharTudo();
  }
}, true);

// ======================================================================
// painel do artigo: nota geral, tags, lista de highlights
// ======================================================================

const painel = $('#painel-artigo');
const btnPainel = $('#btn-painel');
const painelAberto = () => !painel.hidden;

export function alternarPainel(abrir = painel.hidden) {
  painel.hidden = !abrir;
  btnPainel.classList.toggle('ativo', abrir);
  btnPainel.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  document.body.classList.toggle('com-painel', abrir);
  armazenamento.gravar('artigos:painel', abrir);
  if (abrir && ctx) desenharPainel();
}
btnPainel.addEventListener('click', () => alternarPainel());
if (armazenamento.ler('artigos:painel', false) && matchMedia('(min-width: 1100px)').matches) alternarPainel(true);

function desenharPainel() {
  if (!ctx) return;
  const { entrada, anot } = ctx;

  // nota geral
  const salvarNota = debounce(() => {
    anot.noteUpdatedAt = new Date().toISOString();
    dados.salvarAnotacoes(entrada.id);
    status.textContent = 'salvo';
  }, 800);
  const status = el('span', { class: 'painel-status', 'aria-live': 'polite' });
  const nota = el('textarea', { class: 'painel-nota', rows: '5', placeholder: 'Uma nota sobre este artigo…', 'aria-label': 'Nota geral do artigo' });
  nota.value = anot.note || '';
  nota.addEventListener('input', () => {
    anot.note = nota.value;
    status.textContent = '…';
    salvarNota();
  });
  nota.addEventListener('blur', () => salvarNota.agora());

  // highlights
  const visiveis = ordenar(anot.highlights.filter((h) => !ctx.orfaos.includes(h)));
  const itemHl = (h, orfao) =>
    el(
      'li',
      { class: `painel-hl hl-borda-${h.color}` },
      el(
        orfao ? 'div' : 'button',
        orfao ? { class: 'painel-hl-texto' } : { type: 'button', class: 'painel-hl-texto', title: 'Ir para o trecho', onclick: () => irPara(h.id) },
        citacao(h),
      ),
      h.note?.trim() ? el('p', { class: 'painel-hl-nota', text: h.note }) : null,
      orfao ? el('button', { type: 'button', class: 'pop-btn pop-apagar', onclick: () => apagar(h) }, svg(ICONES.lixo, { tamanho: 13 }), 'Apagar') : null,
    );

  painel.replaceChildren(
    el(
      'div',
      { class: 'painel-cabecalho' },
      el('h2', { class: 'painel-titulo', text: 'Anotações' }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar painel', onclick: () => alternarPainel(false) }, svg(ICONES.fechar, { tamanho: 16 })),
    ),
    el('section', { class: 'painel-secao' }, el('h3', { class: 'titulo-secao' }, 'Nota ', status), nota),
    el('section', { class: 'painel-secao' }, el('h3', { class: 'titulo-secao', text: 'Tags' }), editorDeTags(entrada)),
    el(
      'section',
      { class: 'painel-secao' },
      el('h3', { class: 'titulo-secao', text: `Highlights · ${anot.highlights.length}` }),
      visiveis.length ? el('ul', { class: 'painel-hls' }, ...visiveis.map((h) => itemHl(h, false))) : el('p', { class: 'nota-vazia', text: 'Selecione um trecho do texto para marcar.' }),
      ctx.orfaos.length
        ? el('div', { class: 'painel-orfaos' }, el('p', { class: 'nota-vazia', text: `${plural(ctx.orfaos.length, 'trecho não foi reencontrado', 'trechos não foram reencontrados')} no texto atual:` }), el('ul', { class: 'painel-hls' }, ...ctx.orfaos.map((h) => itemHl(h, true))))
        : null,
    ),
  );
}

// ---------------------------------------------------------------- tags

/** Editor de tags com sugestões (padrão do meus-bookmarks). */
function editorDeTags(entrada) {
  const caixa = el('div', { class: 'tags-editor' });
  const lista = el('div', { class: 'tags-lista' });
  const entradaTxt = el('input', { type: 'text', class: 'tags-input', placeholder: 'adicionar tag…', autocomplete: 'off', 'aria-label': 'Adicionar tag' });
  const sugestoes = el('div', { class: 'tags-sugestoes', role: 'listbox' });
  sugestoes.hidden = true;

  const tags = () => entrada.tags || [];
  const gravar = (novas) => {
    dados.atualizar(entrada.id, { tags: novas });
    desenhar();
  };
  const adicionar = (bruta) => {
    const t = bruta.replace(/^#/, '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    const existente = [...dados.todasAsTags().keys()].find((x) => x.toLocaleLowerCase('pt-BR') === t.toLocaleLowerCase('pt-BR'));
    const final = existente || t;
    if (!tags().some((x) => x.toLocaleLowerCase('pt-BR') === final.toLocaleLowerCase('pt-BR'))) gravar([...tags(), final]);
    entradaTxt.value = '';
    sugestoes.hidden = true;
  };

  function desenhar() {
    lista.replaceChildren(
      ...tags().map((t) =>
        el('span', { class: 'chip' }, el('span', { class: 'tag ativa', text: t }), el('button', { type: 'button', class: 'chip-x', 'aria-label': `Remover tag ${t}`, onclick: () => gravar(tags().filter((x) => x !== t)) }, '✕')),
      ),
    );
  }

  function sugerir() {
    const q = entradaTxt.value.trim().toLocaleLowerCase('pt-BR');
    const opcoes = [...dados.todasAsTags().entries()]
      .filter(([t]) => !tags().includes(t) && (!q || t.toLocaleLowerCase('pt-BR').includes(q)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    sugestoes.replaceChildren(...opcoes.map(([t]) => el('button', { type: 'button', class: 'tags-sugestao', role: 'option', onmousedown: (e) => e.preventDefault(), onclick: () => adicionar(t) }, t)));
    sugestoes.hidden = !opcoes.length;
  }

  entradaTxt.addEventListener('input', () => {
    if (entradaTxt.value.includes(',')) {
      entradaTxt.value.split(',').slice(0, -1).forEach(adicionar);
      entradaTxt.value = entradaTxt.value.split(',').pop();
    }
    sugerir();
  });
  entradaTxt.addEventListener('focus', sugerir);
  entradaTxt.addEventListener('blur', () => setTimeout(() => (sugestoes.hidden = true), 120));
  entradaTxt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionar(entradaTxt.value);
    } else if (e.key === 'Backspace' && !entradaTxt.value && tags().length) {
      gravar(tags().slice(0, -1));
    }
  });

  desenhar();
  caixa.append(lista, el('div', { class: 'tags-campo' }, entradaTxt, sugestoes));
  return caixa;
}
