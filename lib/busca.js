// Configuração da busca (MiniSearch), igual no Node (gera o índice) e no
// navegador (consulta). Quem chama passa a classe MiniSearch.
// Se mudar as opções, aumente VERSAO_INDICE: o índice antigo deixa de valer.

export const VERSAO_INDICE = 1;

const PALAVRAS_VAZIAS = new Set(
  (
    'a o e é de do da dos das em no na nos nas um uma uns umas para por com sem que se ao aos às à ' +
    'como mais mas ou sua seu suas seus ele ela eles elas isso esse essa este esta foi ser são há ' +
    'the of and to in is it for on with as at by an be this that from are was or not'
  ).split(' '),
);

/** Minúsculas e sem acentos: "Ação" → "acao". */
export function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function processarTermo(termo) {
  const t = normalizar(termo);
  if (t.length < 2 || PALAVRAS_VAZIAS.has(t)) return null;
  return t;
}

// letras (com acentos) e números; o resto separa palavras
export const SEPARADOR = /[^\p{L}\p{N}]+/u;

export const OPCOES_TEXTO = {
  idField: 'id',
  fields: ['title', 'byline', 'siteName', 'text'],
  storeFields: [],
  tokenize: (s) => s.split(SEPARADOR),
  processTerm: processarTermo,
};

export const OPCOES_CONSULTA = {
  boost: { title: 3, byline: 2, siteName: 1.5 },
  combineWith: 'AND',
  prefix: (termo) => termo.length >= 3,
  fuzzy: (termo) => (termo.length >= 5 ? 0.15 : false),
};

/** Termos de uma consulta, já normalizados (para sublinhar no texto). */
export function termosDaConsulta(consulta) {
  return (consulta || '').split(SEPARADOR).map(processarTermo).filter(Boolean);
}
