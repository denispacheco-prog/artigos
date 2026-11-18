// Artigos — app (M2: lista, leitura, preferências; dados locais).

import DOMPurify from '../vendor/purify-3.4.18.es.mjs';
import { sanitizar } from '../lib/sanitizar.js';
import * as dados from './dados.js';

// ======================================================================
// utilidades
// ======================================================================

const $ = (sel, raiz = document) => raiz.querySelector(sel);

function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
}

function svg(caminhos, { tamanho = 16, preenchido = false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', tamanho);
  s.setAttribute('height', tamanho);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', preenchido ? 'currentColor' : 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  for (const d of [].concat(caminhos)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

const ICONES = {
  estrela: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  arquivar: ['M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v3H3z', 'M10 11h4'],
  desarquivar: ['M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v3H3z', 'M12 17v-6M9.5 13.5L12 11l2.5 2.5'],
  original: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  sol: ['M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  lua: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function dataLonga(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const armazenamento = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem(chave);
      return v == null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* navegador sem armazenamento: segue sem lembrar */
    }
  },
};

let avisoTimer = null;
function avisar(texto) {
  const a = $('#aviso');
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (a.hidden = true), 4000);
}
dados.aoErrar((e) => avisar(e.message));

// ======================================================================
// tema (modelo do meus-bookmarks; chave artigos:theme)
// ======================================================================

function temaEfetivo() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function desenharBotoesTema() {
  const escuro = temaEfetivo() === 'dark';
  for (const b of document.querySelectorAll('.js-tema')) {
    b.replaceChildren(svg(escuro ? ICONES.sol : ICONES.lua, { tamanho: 16 }));
    b.title = escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    b.setAttribute('aria-label', b.title);
  }
}

for (const b of document.querySelectorAll('.js-tema')) {
  b.addEventListener('click', () => {
    const proximo = temaEfetivo() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', proximo);
    try {
      localStorage.setItem('artigos:theme', proximo);
    } catch {}
    desenharBotoesTema();
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', desenharBotoesTema);

// ======================================================================
// estado da lista
// ======================================================================

const FILTROS = [
  { id: 'ler', nome: 'Para ler', teste: (a) => !a.archivedAt },
  { id: 'favoritos', nome: 'Favoritos', teste: (a) => a.favorite },
  { id: 'arquivados', nome: 'Arquivados', teste: (a) => !!a.archivedAt },
];

const estado = {
  filtro: armazenamento.ler('artigos:filtro', 'ler'),
  tag: null,
  busca: '',
};

function artigosFiltrados() {
  const filtro = FILTROS.find((f) => f.id === estado.filtro) || FILTROS[0];
  const termos = semAcento(estado.busca).split(/\s+/).filter(Boolean);
  return dados
    .artigosDoIndice()
    .filter(filtro.teste)
    .filter((a) => !estado.tag || (a.tags || []).includes(estado.tag))
    .filter((a) => {
      if (!termos.length) return true;
      const alvo = semAcento([a.title, a.siteName, a.byline, a.excerpt, ...(a.tags || [])].join(' '));
      return termos.every((t) => alvo.includes(t));
    })
    .sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));
}

// ======================================================================
// lista
// ======================================================================

function desenharLista() {
  const todos = dados.artigosDoIndice();

  // filtros com contagem
  $('#filtros').replaceChildren(
    ...FILTROS.map((f) =>
      el(
        'button',
        {
          type: 'button',
          class: 'filtro' + (f.id === estado.filtro ? ' ativo' : ''),
          'aria-current': f.id === estado.filtro ? 'true' : null,
          onclick: () => {
            estado.filtro = f.id;
            armazenamento.gravar('artigos:filtro', f.id);
            desenharLista();
          },
        },
        el('span', { text: f.nome }),
        el('span', { class: 'filtro-n', text: String(todos.filter(f.teste).length) }),
      ),
    ),
  );

  // tags
  const contagemTags = new Map();
  for (const a of todos) for (const t of a.tags || []) contagemTags.set(t, (contagemTags.get(t) || 0) + 1);
  const nuvem = $('#nuvem-tags');
  if (!contagemTags.size) {
    nuvem.replaceChildren(el('p', { class: 'nota-vazia', text: 'Nenhuma tag ainda.' }));
  } else {
    nuvem.replaceChildren(
      ...[...contagemTags.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
        .map(([t, n]) =>
          el('button', { type: 'button', class: 'tag' + (t === estado.tag ? ' ativa' : ''), title: `${n} artigo(s)`, onclick: () => escolherTag(t === estado.tag ? null : t) }, t),
        ),
    );
  }

  // filtro de tag ativo
  const ativos = $('#filtros-ativos');
  ativos.hidden = !estado.tag;
  if (estado.tag) {
    ativos.replaceChildren(
      el('span', { class: 'filtros-ativos-rotulo', text: 'Filtrando por' }),
      el('span', { class: 'chip' }, el('span', { class: 'tag ativa', text: estado.tag }), el('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover filtro', onclick: () => escolherTag(null) }, '✕')),
    );
  }

  const itens = artigosFiltrados();
  const nome = (FILTROS.find((f) => f.id === estado.filtro) || FILTROS[0]).nome;
  $('#contagem').textContent = `${itens.length} ${itens.length === 1 ? 'artigo' : 'artigos'} · ${nome}`;
  $('#lista').replaceChildren(...itens.map(itemDaLista));

  const vazio = $('#vazio');
  vazio.hidden = itens.length > 0;
  if (!itens.length) {
    vazio.textContent = !todos.length
      ? 'Nenhum artigo salvo ainda. Use "+ Salvar" para ver como adicionar.'
      : estado.busca
        ? 'Nada encontrado para essa busca.'
        : estado.filtro === 'arquivados'
          ? 'Nenhum artigo arquivado.'
          : estado.filtro === 'favoritos'
            ? 'Nenhum favorito ainda. Use ☆ para marcar.'
            : 'Tudo lido. 🎉';
  }
}

function escolherTag(t) {
  estado.tag = t;
  desenharLista();
}

function itemDaLista(a) {
  const lido = !!a.readAt;
  const thumb = a.leadImage ? el('img', { class: 'item-thumb', src: dados.urlMidia(a.leadImage), alt: '', loading: 'lazy', decoding: 'async' }) : null;
  const status =
    a.extraction === 'partial' ? el('span', { class: 'selo selo-parcial', title: 'Extração possivelmente incompleta', text: 'parcial' }) : a.extraction === 'failed' ? el('span', { class: 'selo selo-falha', title: 'A extração falhou', text: 'falhou' }) : null;

  return el(
    'li',
    { class: 'item' + (lido ? ' lido' : ''), 'data-id': a.id },
    el(
      'div',
      { class: 'item-texto' },
      el(
        'div',
        { class: 'item-fonte' },
        el('span', { class: 'favicon', 'aria-hidden': 'true', text: (a.siteName || '?').trim().charAt(0).toUpperCase() }),
        el('span', { class: 'item-site', text: a.siteName || '' }),
        a.publishedAt || a.savedAt ? el('span', { class: 'item-sep', text: dataCurta(a.publishedAt || a.savedAt) }) : null,
        a.readingMinutes ? el('span', { class: 'item-sep', text: `${a.readingMinutes} min` }) : null,
        status,
      ),
      el('h3', { class: 'item-titulo' }, el('a', { href: `#/ler/${a.id}` }, a.title || a.url)),
      a.excerpt ? el('p', { class: 'item-resumo', text: a.excerpt }) : null,
      el(
        'div',
        { class: 'item-meta' },
        ...(a.tags || []).map((t) => el('button', { type: 'button', class: 'tag', onclick: () => escolherTag(t) }, t)),
        el(
          'div',
          { class: 'item-acoes' },
          botaoFavorito(a, 'acao'),
          botaoArquivar(a, 'acao'),
          el('a', { class: 'acao', href: a.url, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir o original', 'aria-label': 'Abrir o original' }, svg(ICONES.original, { tamanho: 15 })),
        ),
      ),
    ),
    thumb ? el('a', { href: `#/ler/${a.id}`, class: 'item-thumb-link', tabindex: '-1', 'aria-hidden': 'true' }, thumb) : null,
  );
}

function botaoFavorito(a, classe) {
  const b = el('button', { type: 'button', class: classe + (a.favorite ? ' ativo-estrela' : '') });
  const desenhar = () => {
    b.replaceChildren(svg(ICONES.estrela, { tamanho: classe === 'acao' ? 15 : 17, preenchido: a.favorite }));
    b.classList.toggle('ativo-estrela', !!a.favorite);
    b.title = a.favorite ? 'Tirar dos favoritos' : 'Favoritar';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', a.favorite ? 'true' : 'false');
  };
  desenhar();
  b.addEventListener('click', () => {
    dados.atualizar(a.id, { favorite: !a.favorite });
    desenhar();
    if (b.closest('#vista-lista')) desenharLista();
  });
  return b;
}

function botaoArquivar(a, classe) {
  const b = el('button', { type: 'button', class: classe });
  const desenhar = () => {
    b.replaceChildren(svg(a.archivedAt ? ICONES.desarquivar : ICONES.arquivar, { tamanho: classe === 'acao' ? 15 : 17 }));
    b.title = a.archivedAt ? 'Voltar para "Para ler"' : 'Arquivar';
    b.setAttribute('aria-label', b.title);
  };
  desenhar();
  b.addEventListener('click', () => {
    const arquivar = !a.archivedAt;
    dados.atualizar(a.id, { archivedAt: arquivar ? new Date().toISOString() : null, ...(arquivar && !a.readAt ? { readAt: new Date().toISOString() } : {}) });
    desenhar();
    avisar(arquivar ? 'Arquivado.' : 'De volta em "Para ler".');
    if (b.closest('#vista-lista')) desenharLista();
  });
  return b;
}

$('#busca').addEventListener('input', (e) => {
  estado.busca = e.target.value;
  desenharLista();
});

const dialogoSalvar = $('#dialogo-salvar');
$('#btn-salvar').addEventListener('click', () => dialogoSalvar.showModal());
dialogoSalvar.querySelector('.js-fechar').addEventListener('click', () => dialogoSalvar.close());
dialogoSalvar.addEventListener('click', (e) => {
  if (e.target === dialogoSalvar) dialogoSalvar.close();
});

// ======================================================================
// preferências de leitura (localStorage artigos:leitura)
// ======================================================================

const FONTES = [
  { id: 'literata', nome: 'Literata' },
  { id: 'source-serif', nome: 'Source Serif' },
  { id: 'georgia', nome: 'Georgia' },
  { id: 'inter', nome: 'Inter' },
  { id: 'atkinson', nome: 'Atkinson' },
  { id: 'sistema', nome: 'Sistema' },
];
const ENTRELINHAS = [
  { id: 'compacta', nome: 'Compacta', valor: 1.45 },
  { id: 'normal', nome: 'Normal', valor: 1.6 },
  { id: 'ampla', nome: 'Ampla', valor: 1.8 },
];
const LARGURAS = [
  { id: 'estreita', nome: 'Estreita', valor: '32rem' },
  { id: 'media', nome: 'Média', valor: '38rem' },
  { id: 'larga', nome: 'Larga', valor: '46rem' },
];
const FUNDOS = [
  { id: 'auto', nome: 'Automático (segue o tema)' },
  { id: 'claro', nome: 'Claro' },
  { id: 'sepia', nome: 'Sépia' },
  { id: 'cinza', nome: 'Cinza' },
  { id: 'escuro', nome: 'Escuro' },
];
const TAMANHO_MIN = 15;
const TAMANHO_MAX = 28;

const PREFS_PADRAO = { fonte: 'literata', tamanho: matchMedia('(max-width: 600px)').matches ? 18 : 20, entrelinha: 'normal', largura: 'media', fundo: 'auto' };
let prefs = { ...PREFS_PADRAO, ...armazenamento.ler('artigos:leitura', {}) };

function aplicarPrefs() {
  const l = $('#leitura');
  l.dataset.fonte = prefs.fonte;
  l.dataset.fundo = prefs.fundo;
  l.style.setProperty('--read-size', `${prefs.tamanho}px`);
  l.style.setProperty('--read-leading', (ENTRELINHAS.find((e) => e.id === prefs.entrelinha) || ENTRELINHAS[1]).valor);
  l.style.setProperty('--read-width', (LARGURAS.find((e) => e.id === prefs.largura) || LARGURAS[1]).valor);
  // a página inteira (atrás da barra) assume o fundo de leitura
  document.body.dataset.fundo = prefs.fundo;
}

function mudarPref(chave, valor) {
  prefs = { ...prefs, [chave]: valor };
  armazenamento.gravar('artigos:leitura', prefs);
  aplicarPrefs();
  desenharPainelPrefs();
}

function grupoOpcoes(rotulo, opcoes, atual, chave, extra = () => ({})) {
  return el(
    'div',
    { class: 'pref' },
    el('span', { class: 'pref-rotulo', text: rotulo }),
    el(
      'div',
      { class: 'pref-opcoes', role: 'radiogroup', 'aria-label': rotulo },
      ...opcoes.map((o) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': o.id === atual ? 'true' : 'false',
            class: 'pref-op' + (o.id === atual ? ' ativa' : ''),
            title: o.nome,
            onclick: () => mudarPref(chave, o.id),
            ...extra(o),
          },
          o.conteudo || o.nome,
        ),
      ),
    ),
  );
}

function iconeLinhas(espaco) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', 20);
  s.setAttribute('height', 20);
  s.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const r = document.createElementNS(ns, 'rect');
    const y = 12 - espaco + i * espaco - 1;
    r.setAttribute('x', 4);
    r.setAttribute('y', y);
    r.setAttribute('width', 16);
    r.setAttribute('height', 2);
    r.setAttribute('rx', 1);
    r.setAttribute('fill', 'currentColor');
    s.append(r);
  }
  return s;
}

function iconeLargura(w) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', 20);
  s.setAttribute('height', 20);
  s.setAttribute('aria-hidden', 'true');
  for (const y of [7, 11, 15]) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', 12 - w / 2);
    r.setAttribute('y', y);
    r.setAttribute('width', w);
    r.setAttribute('height', 2);
    r.setAttribute('rx', 1);
    r.setAttribute('fill', 'currentColor');
    s.append(r);
  }
  return s;
}

function desenharPainelPrefs() {
  const painel = $('#painel-prefs');
  painel.replaceChildren(
    grupoOpcoes('Fonte', FONTES, prefs.fonte, 'fonte', (o) => ({ class: `pref-op pref-fonte fonte-${o.id}` + (o.id === prefs.fonte ? ' ativa' : '') })),
    el(
      'div',
      { class: 'pref' },
      el('span', { class: 'pref-rotulo', text: 'Tamanho' }),
      el(
        'div',
        { class: 'pref-tamanho' },
        el('button', { type: 'button', class: 'pref-op', 'aria-label': 'Diminuir texto', disabled: prefs.tamanho <= TAMANHO_MIN, onclick: () => mudarPref('tamanho', prefs.tamanho - 1) }, el('span', { class: 'a-menor', text: 'A' })),
        el('span', { class: 'pref-valor', text: `${prefs.tamanho}px` }),
        el('button', { type: 'button', class: 'pref-op', 'aria-label': 'Aumentar texto', disabled: prefs.tamanho >= TAMANHO_MAX, onclick: () => mudarPref('tamanho', prefs.tamanho + 1) }, el('span', { class: 'a-maior', text: 'A' })),
      ),
    ),
    grupoOpcoes('Entrelinha', ENTRELINHAS.map((e, i) => ({ ...e, conteudo: iconeLinhas(4 + i * 2) })), prefs.entrelinha, 'entrelinha'),
    grupoOpcoes('Largura', LARGURAS.map((e, i) => ({ ...e, conteudo: iconeLargura(8 + i * 5) })), prefs.largura, 'largura'),
    grupoOpcoes('Fundo', FUNDOS.map((f) => ({ ...f, conteudo: el('span', { class: `amostra-fundo fundo-${f.id}`, 'aria-hidden': 'true' }) })), prefs.fundo, 'fundo', (o) => ({
      class: 'pref-op pref-fundo' + (o.id === prefs.fundo ? ' ativa' : ''),
      'aria-label': o.nome,
    })),
    el('button', { type: 'button', class: 'pref-restaurar', onclick: () => {
      prefs = { ...PREFS_PADRAO };
      armazenamento.gravar('artigos:leitura', prefs);
      aplicarPrefs();
      desenharPainelPrefs();
    } }, 'Restaurar padrão'),
  );
}

const btnPrefs = $('#btn-prefs');
function abrirPrefs(abrir) {
  const painel = $('#painel-prefs');
  painel.hidden = !abrir;
  btnPrefs.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  btnPrefs.classList.toggle('ativo', abrir);
  if (abrir) desenharPainelPrefs();
}
btnPrefs.addEventListener('click', () => abrirPrefs($('#painel-prefs').hidden));
document.addEventListener('click', (e) => {
  if (!$('#painel-prefs').hidden && !e.target.closest('#painel-prefs, #btn-prefs')) abrirPrefs(false);
});

// ======================================================================
// leitura
// ======================================================================

let artigoAberto = null;

async function abrirArtigo(id) {
  const a = dados.entrada(id);
  if (!a) {
    avisar('Artigo não encontrado.');
    location.hash = '#/';
    return;
  }
  artigoAberto = a;
  mostrar('leitura');
  aplicarPrefs();
  document.title = `${a.title || 'Artigo'} · Artigos`;
  $('#barra-titulo').textContent = [a.siteName, a.readingMinutes ? `${a.readingMinutes} min` : null].filter(Boolean).join(' · ');
  $('#btn-favorito').replaceWith(Object.assign(botaoFavorito(a, 'icon-btn'), { id: 'btn-favorito' }));
  $('#btn-arquivar').replaceWith(Object.assign(botaoArquivar(a, 'icon-btn'), { id: 'btn-arquivar' }));
  $('#btn-original').href = a.url;

  const artigo = $('#artigo');
  artigo.replaceChildren(el('p', { class: 'carregando', text: 'carregando…' }));
  window.scrollTo(0, 0);

  let completo;
  try {
    completo = await dados.carregarArtigo(id);
  } catch (e) {
    artigo.replaceChildren(el('p', { class: 'carregando', text: e.message }));
    return;
  }
  if (artigoAberto !== a) return; // trocou de artigo enquanto carregava

  const cabecalho = el(
    'header',
    { class: 'artigo-cabecalho' },
    el('p', { class: 'artigo-fonte' }, el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: completo.siteName || '' }), completo.publishedAt ? ` · ${dataLonga(completo.publishedAt)}` : '', completo.readingMinutes ? ` · ${completo.readingMinutes} min de leitura` : ''),
    el('h1', { class: 'artigo-titulo', text: completo.title || completo.url }),
    completo.byline ? el('p', { class: 'artigo-autor', text: completo.byline }) : null,
  );

  const avisos = [completo.extraction?.error, ...(completo.extraction?.warnings || [])].filter(Boolean);
  const caixaAvisos =
    completo.extraction?.status !== 'ok' && avisos.length
      ? el('div', { class: 'artigo-aviso' }, el('strong', { text: completo.extraction.status === 'failed' ? 'A extração falhou.' : 'Este texto pode estar incompleto.' }), ' ', avisos[0], ' ', el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir o original ↗' }))
      : null;

  const lead =
    completo.leadImage && !completo.leadImage.inBody ? el('figure', { class: 'artigo-lead' }, el('img', { src: dados.urlMidia(completo.leadImage.src), alt: '', decoding: 'async' })) : null;

  // limpeza de novo na exibição (decisão 8) + ajustes de links e imagens
  const corpo = el('div', { class: 'artigo-corpo' });
  corpo.innerHTML = sanitizar(DOMPurify, completo.contentHtml || '');
  for (const img of corpo.querySelectorAll('img')) {
    img.src = dados.urlMidia(img.getAttribute('src'));
    img.loading = 'lazy';
    img.decoding = 'async';
  }
  for (const link of corpo.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const rodape = el(
    'footer',
    { class: 'artigo-rodape' },
    el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', class: 'artigo-original', text: 'Ler no site original ↗' }),
    el('div', { class: 'artigo-rodape-acoes' }, a.archivedAt ? el('a', { href: '#/', class: 'btn-secundario', text: '← Voltar à lista' }) : el('button', { type: 'button', class: 'btn-primario', onclick: () => {
      dados.atualizar(a.id, { archivedAt: new Date().toISOString(), readAt: a.readAt || new Date().toISOString() });
      avisar('Arquivado.');
      location.hash = '#/';
    } }, 'Arquivar e voltar')),
  );

  artigo.replaceChildren(cabecalho, caixaAvisos, lead, corpo, rodape);

  // volta para onde parou
  if (a.progress > 0.02 && a.progress < 0.95) {
    requestAnimationFrame(() => window.scrollTo(0, a.progress * (document.documentElement.scrollHeight - innerHeight)));
  }
  atualizarProgresso();
}

// progresso de leitura + barra que some ao rolar para baixo
let ultimoY = 0;
let progressoTimer = null;

function atualizarProgresso() {
  if ($('#vista-leitura').hidden || !artigoAberto) return;
  const total = document.documentElement.scrollHeight - innerHeight;
  const p = total > 0 ? Math.min(1, Math.max(0, scrollY / total)) : 1;
  $('#progresso').style.transform = `scaleX(${p})`;

  const barra = $('#barra-leitura');
  const descendo = scrollY > ultimoY && scrollY > 80;
  if ($('#painel-prefs').hidden) barra.classList.toggle('escondida', descendo);
  ultimoY = scrollY;

  const a = artigoAberto;
  clearTimeout(progressoTimer);
  progressoTimer = setTimeout(() => {
    if (Math.abs((a.progress || 0) - p) < 0.02) return;
    const mudancas = { progress: Math.round(p * 1000) / 1000 };
    if (p >= 0.9 && !a.readAt) mudancas.readAt = new Date().toISOString();
    dados.atualizar(a.id, mudancas);
  }, 1500);
}
addEventListener('scroll', atualizarProgresso, { passive: true });

// ======================================================================
// navegação
// ======================================================================

function mostrar(vista) {
  $('#vista-lista').hidden = vista !== 'lista';
  $('#vista-leitura').hidden = vista !== 'leitura';
  if (vista === 'lista') {
    delete document.body.dataset.fundo;
    abrirPrefs(false);
  }
}

let posicaoLista = 0;

function rotear() {
  const m = location.hash.match(/^#\/ler\/([\w-]+)/);
  if (m) {
    if ($('#vista-leitura').hidden) posicaoLista = scrollY;
    abrirArtigo(m[1]);
  } else {
    const vindoDaLeitura = !$('#vista-leitura').hidden;
    artigoAberto = null;
    document.title = 'Artigos';
    mostrar('lista');
    desenharLista();
    if (vindoDaLeitura) requestAnimationFrame(() => window.scrollTo(0, posicaoLista));
  }
}

addEventListener('hashchange', rotear);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#painel-prefs').hidden) abrirPrefs(false);
  else if (!$('#vista-leitura').hidden) location.hash = '#/';
});
addEventListener('keydown', (e) => {
  if (e.key === '/' && !$('#vista-lista').hidden && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    $('#busca').focus();
  }
});

// ======================================================================
// início
// ======================================================================

desenharBotoesTema();
try {
  await dados.carregarIndice();
} catch (e) {
  avisar(e.message);
}
rotear();
