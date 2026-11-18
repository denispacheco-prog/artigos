// Vista geral de highlights (M3): todos os highlights, por artigo,
// filtráveis por cor e por tag do artigo.

import * as dados from './dados.js';
import { el, svg, ICONES, CORES, dataCurta, plural, copiar } from './util.js';
import { exportarHighlight, jaEnviado, rotuloEnviado } from './exportar-quote.js';

const citacao = (h) => h.target.selector.find((s) => s.type === 'TextQuoteSelector')?.exact || '';
const posicao = (h) => h.target.selector.find((s) => s.type === 'TextPositionSelector')?.start ?? 0;

/**
 * Desenha em `alvo`. `filtros` = { cores: Set, tag: string|null }.
 * `aoMudarCores(novoSet)` é chamado quando o usuário clica numa cor.
 */
export async function desenharVistaHighlights(alvo, contagem, filtros, aoMudarCores) {
  alvo.replaceChildren(el('li', { class: 'vazio', text: 'carregando…' }));
  const todas = await dados.todasAnotacoes();

  const grupos = todas
    .filter(({ entrada }) => !filtros.tag || (entrada.tags || []).includes(filtros.tag))
    .map(({ entrada, anotacoes }) => ({
      entrada,
      hls: anotacoes.highlights.filter((h) => !filtros.cores.size || filtros.cores.has(h.color)).sort((a, b) => posicao(a) - posicao(b)),
    }))
    .filter((g) => g.hls.length)
    .sort((a, b) => (b.entrada.savedAt || '').localeCompare(a.entrada.savedAt || ''));

  const total = grupos.reduce((s, g) => s + g.hls.length, 0);
  contagem.textContent = `${plural(total, 'highlight', 'highlights')} em ${plural(grupos.length, 'artigo', 'artigos')}`;

  const barraCores = el(
    'li',
    { class: 'filtro-cores' },
    el('span', { class: 'filtros-ativos-rotulo', text: 'Cores' }),
    ...CORES.map((c) =>
      el('button', {
        type: 'button',
        class: `cor cor-${c.id}` + (filtros.cores.has(c.id) ? ' ativa' : ''),
        title: c.nome,
        'aria-label': `Filtrar por ${c.nome.toLowerCase()}`,
        'aria-pressed': filtros.cores.has(c.id) ? 'true' : 'false',
        onclick: () => {
          const novo = new Set(filtros.cores);
          novo.has(c.id) ? novo.delete(c.id) : novo.add(c.id);
          aoMudarCores(novo);
        },
      }),
    ),
    filtros.cores.size ? el('button', { type: 'button', class: 'limpar', onclick: () => aoMudarCores(new Set()), text: 'todas' }) : null,
  );

  if (!grupos.length) {
    alvo.replaceChildren(barraCores, el('li', { class: 'vazio', text: todas.length ? 'Nenhum highlight com esses filtros.' : 'Nenhum highlight ainda. Abra um artigo e selecione um trecho.' }));
    return;
  }

  alvo.replaceChildren(
    barraCores,
    ...grupos.map(({ entrada, hls }) =>
      el(
        'li',
        { class: 'grupo-hl' },
        el(
          'div',
          { class: 'item-fonte' },
          el('span', { class: 'favicon', 'aria-hidden': 'true', text: (entrada.siteName || '?').charAt(0).toUpperCase() }),
          el('span', { class: 'item-site', text: entrada.siteName || '' }),
          el('span', { class: 'item-sep', text: dataCurta(entrada.publishedAt || entrada.savedAt) }),
          el('span', { class: 'item-sep', text: plural(hls.length, 'highlight', 'highlights') }),
        ),
        el('h3', { class: 'item-titulo' }, el('a', { href: `#/ler/${entrada.id}` }, entrada.title || entrada.url)),
        el(
          'ul',
          { class: 'citacoes' },
          ...hls.map((h) => itemCitacao(entrada, h)),
        ),
      ),
    ),
  );
}

function itemCitacao(entrada, h) {
  const li = el(
    'li',
    { class: `citacao hl-borda-${h.color}` },
    el('a', { class: 'citacao-texto', href: `#/ler/${entrada.id}?hl=${h.id}`, title: 'Abrir no artigo' }, citacao(h)),
    h.note?.trim() ? el('p', { class: 'citacao-nota', text: h.note }) : null,
    jaEnviado(h) ? el('p', { class: 'citacao-enviado', title: rotuloEnviado(h), text: 'no meus-bookmarks ✓' }) : null,
    el(
      'div',
      { class: 'citacao-acoes' },
      jaEnviado(h)
        ? null
        : el('button', {
            type: 'button',
            class: 'acao acao-texto',
            title: 'Enviar ao meus-bookmarks como Quote',
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              if (await exportarHighlight(entrada, h)) li.replaceWith(itemCitacao(entrada, h));
              else e.currentTarget.disabled = false;
            },
          }, '→ Quote'),
      el('button', {
        type: 'button',
        class: 'acao',
        title: 'Copiar com a referência',
        'aria-label': 'Copiar com a referência',
        onclick: () => copiar(`“${citacao(h)}”${h.note?.trim() ? `\n\nNota: ${h.note.trim()}` : ''}\n\n— ${entrada.title}${entrada.siteName ? `, ${entrada.siteName}` : ''}\n${entrada.url}`),
      }, svg(ICONES.copiar, { tamanho: 14 })),
    ),
  );
  return li;
}
