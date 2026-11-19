// Monta a entrada do index.json a partir de um artigo (articles/<id>.json).
// Usado pelo extrator local (Node) e pelo app quando descobre um artigo novo
// gravado pela Action. Campos de estado do usuário vêm de `existente`.

export const ID_VALIDO = /^\d{8}-[0-9a-f]{6}$/;

export function entradaDoArtigo(a, existente = null) {
  const savedAt = existente?.savedAt || a.savedAt;
  return {
    id: a.id,
    url: existente?.url || a.url,
    title: a.title || existente?.title || null,
    siteName: a.siteName || existente?.siteName || null,
    byline: a.byline,
    publishedAt: a.publishedAt,
    savedAt,
    excerpt: a.excerpt,
    leadImage: a.leadImage?.src || null,
    wordCount: a.wordCount,
    readingMinutes: a.readingMinutes,
    lang: a.lang,
    readAt: existente?.readAt ?? null,
    archivedAt: existente?.archivedAt ?? null,
    favorite: existente?.favorite ?? false,
    tags: existente?.tags ?? [],
    categories: existente?.categories ?? [],
    progress: existente?.progress ?? 0,
    extraction: a.extraction?.status || 'failed',
    extractionError: a.extraction?.status === 'failed' ? a.extraction?.error || null : null,
    highlightCount: existente?.highlightCount ?? 0,
    hasNote: existente?.hasNote ?? false,
    annotationsFile: existente?.annotationsFile || `annotations/${savedAt.slice(0, 7)}.json`,
    updatedAt: new Date().toISOString(),
  };
}

/** Entrada provisória ("extraindo…") criada pelo app ao colar uma URL. */
export function entradaPendente(id, url, agora = new Date()) {
  let site = null;
  try {
    site = new URL(url).hostname.replace(/^www\d?\./, '');
  } catch {}
  const savedAt = agora.toISOString();
  return {
    id,
    url,
    title: null,
    siteName: site,
    byline: null,
    publishedAt: null,
    savedAt,
    excerpt: null,
    leadImage: null,
    wordCount: 0,
    readingMinutes: 0,
    lang: null,
    readAt: null,
    archivedAt: null,
    favorite: false,
    tags: [],
    progress: 0,
    extraction: 'pending',
    extractionError: null,
    highlightCount: 0,
    hasNote: false,
    annotationsFile: `annotations/${savedAt.slice(0, 7)}.json`,
    updatedAt: savedAt,
  };
}
