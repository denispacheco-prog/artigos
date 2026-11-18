// Botão "→ Quote": envia um highlight ao meus-bookmarks e marca como enviado.

import * as mb from './meus-bookmarks.js';
import * as dados from './dados.js';
import { avisar, armazenamento, dataCurta } from './util.js';

const citacao = (h) => h.target.selector.find((s) => s.type === 'TextQuoteSelector')?.exact || '';

export const jaEnviado = (h) => !!h.exportedTo?.id;
export const rotuloEnviado = (h) => `Enviado ao Bookmarks em ${dataCurta(h.exportedTo.at)}`;

/** Envia; devolve true se deu certo. */
export async function exportarHighlight(entrada, h) {
  if (jaEnviado(h)) {
    avisar('Este highlight já está no Bookmarks.');
    return false;
  }
  if (!mb.configurado()) {
    avisar('Configure o token no Bookmarks (menu ⋯ → Token do GitHub) neste navegador e tente de novo.');
    return false;
  }
  if (!armazenamento.ler('artigos:avisoQuotePublico', false)) {
    const ok = confirm('Lembrete: o Bookmarks fica num repositório PÚBLICO (meus-bookmarks).\n\nO trecho, a sua nota, o título e o link do artigo vão ficar visíveis para qualquer pessoa no GitHub.\n\nEnviar? (Este aviso não aparece de novo.)');
    if (!ok) return false;
    armazenamento.gravar('artigos:avisoQuotePublico', true);
  }
  avisar('Enviando ao Bookmarks…');
  try {
    const id = await mb.enviarQuote({ trecho: citacao(h), nota: h.note, artigo: entrada });
    h.exportedTo = { destino: 'meus-bookmarks', id, at: new Date().toISOString() };
    await dados.salvarAnotacoes(entrada.id);
    avisar('Enviado ao Bookmarks como Quote. ✓');
    return true;
  } catch (e) {
    avisar(e.message);
    return false;
  }
}
