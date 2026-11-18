// Utilidades de interface compartilhadas pelos módulos do app.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function el(tag, props = {}, ...filhos) {
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

export function svg(caminhos, { tamanho = 16, preenchido = false } = {}) {
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

export const ICONES = {
  estrela: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  arquivar: ['M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v3H3z', 'M10 11h4'],
  desarquivar: ['M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v3H3z', 'M12 17v-6M9.5 13.5L12 11l2.5 2.5'],
  original: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  sol: ['M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  lua: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  lapis: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  lixo: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12', 'M9 7V4h6v3'],
  copiar: ['M9 9h10v11H9z', 'M5 15V4h10'],
  painel: ['M4 5h16v14H4z', 'M14 5v14', 'M16.5 9h1.5M16.5 12h1.5'],
  fechar: 'M6 6l12 12M18 6L6 18',
};

export const CORES = [
  { id: 'amarelo', nome: 'Amarelo' },
  { id: 'laranja', nome: 'Laranja' },
  { id: 'azul', nome: 'Azul' },
  { id: 'rosa', nome: 'Rosa' },
];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function dataLonga(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export const armazenamento = {
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
export function avisar(texto) {
  const a = $('#aviso');
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (a.hidden = true), 4000);
}

export function debounce(fn, ms) {
  let t = null;
  const f = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  f.agora = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return f;
}

export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Copia texto para a área de transferência. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    avisar('Copiado.');
  } catch {
    avisar('Não foi possível copiar.');
  }
}

/** Texto corrido de um HTML, sem carregar imagens (template é inerte). */
export function textoDeHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  for (const b of t.content.querySelectorAll('p, li, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, br')) b.append(' ');
  return t.content.textContent.replace(/\s+/g, ' ').trim();
}
