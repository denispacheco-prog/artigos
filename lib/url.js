// Normalização de URLs: desembrulha redirecionadores e tira parâmetros de rastreio.
// Sem dependências: roda no Node e no navegador.

const PARAMS_RASTREIO = [
  /^utm_/i,
  /^(ref|ref_src|ref_url|referrer|source|src)$/i,
  /^(fbclid|gclid|dclid|msclkid|yclid|igshid|twclid|ttclid)$/i,
  /^(mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|mkt_tok|vero_id|oly_enc_id|oly_anon_id)$/i,
  /^(cmpid|cmp|campaign|origem|share|s_cid|ncid|smid|sh|sr_share)$/i,
];

/** Desembrulha links de redirecionamento conhecidos (ex.: RSS da Folha). */
export function desembrulhar(bruta) {
  let url = String(bruta).trim();
  for (let i = 0; i < 3; i++) {
    // redir.folha.com.br/redir/online/.../*https://www1.folha.uol.com.br/...
    const estrela = url.lastIndexOf('*http');
    if (estrela > 0) {
      url = url.slice(estrela + 1);
      continue;
    }
    let u;
    try {
      u = new URL(url);
    } catch {
      break;
    }
    // redirecionadores com ?url= / ?u= / ?q= (Google, Facebook, newsletters)
    const ehRedir = /(^|\.)(google\.[a-z.]+|l\.facebook\.com|lm\.facebook\.com|t\.co|out\.reddit\.com)$/i.test(u.hostname) || /redir|redirect|click|track/i.test(u.pathname);
    const alvo = ehRedir && (u.searchParams.get('url') || u.searchParams.get('u') || u.searchParams.get('q') || u.searchParams.get('target'));
    if (alvo && /^https?:\/\//i.test(alvo)) {
      url = alvo;
      continue;
    }
    break;
  }
  return url;
}

/** Remove parâmetros de rastreio e o fragmento (#...). */
export function limparRastreio(bruta) {
  let u;
  try {
    u = new URL(bruta);
  } catch {
    return bruta;
  }
  for (const chave of [...u.searchParams.keys()]) {
    if (PARAMS_RASTREIO.some((re) => re.test(chave))) u.searchParams.delete(chave);
  }
  u.hash = '';
  return u.toString();
}

export function normalizarUrl(bruta) {
  return limparRastreio(desembrulhar(bruta));
}
