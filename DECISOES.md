# Decisões do projeto

Aprovadas em 18/11/2026.

## Identidade visual

- Referência: o reader atual (colunas, sem serifa, escuro por padrão) e o
  meus-bookmarks. A moldura usa os tokens do meus-bookmarks (`--bg`,
  `--surface`, `--space-*`…) mais `--raised` e `--accent-soft` do reader.
  Acento azul `#1d7af2` (claro) / `#3b93ff` (escuro).
- Tema: segue o sistema; toggle manual grava `artigos:theme`.
- Leitura (preferências em `artigos:leitura`): fontes Literata, Source Serif
  4, Georgia, Inter, Atkinson Hyperlegible, sistema (arquivos de fonte no
  repo, sem Google Fonts); fundos automático, claro, sépia, cinza, escuro.
- Highlights: pastel estilo Kindle colorido — amarelo, laranja, azul, rosa.
  Busca dentro do artigo marca com sublinhado azul, nunca com fundo.
- Tokens copiados para `tokens.css` (sem fonte única entre os projetos).

## Arquitetura

1. **Extração:** URL colada → `workflow_dispatch` da Action que roda **dentro
   do repo privado `artigos-dados`** (grava sem secret; baixa o código do
   extrator deste repo). Plano B: bookmarklet que só passa o HTML da página
   aberta para `artigos/receber.html`, que extrai no navegador. Mesmo código
   de extração (Readability) nos dois. Falha/parcial ficam marcados; opções:
   tentar de novo, bookmarklet, editar à mão.
2. **Dados:** site público + repo privado. Token fine-grained só para
   `artigos-dados`, permissões Contents RW e Actions RW, guardado no
   localStorage (`artigos:githubToken`).
3. **Modelo:** cada arquivo tem um único dono.
   - `index.json` — metadados + estados (`readAt`, `archivedAt`,
     `favorite`, `tags`). Só o app escreve.
   - `articles/<id>.json` — conteúdo limpo. Action/bookmarklet criam;
     só muda em edição manual.
   - `annotations/<AAAA-MM>.json` — nota geral + highlights, agrupados pelo
     mês em que o artigo foi salvo. Só o app escreve.
   - `media/<id>/N.webp` — imagens.
   - `search/texto.json` — índice MiniSearch do texto. Só a Action escreve.
4. **Imagens:** baixadas e comprimidas (webp, ≤1200px, ≤8 por artigo),
   guardando `originalSrc`.
5. **Highlights:** W3C TextQuoteSelector (exato + 32 antes + 32 depois) +
   TextPositionSelector; sem âncora → "órfão", nunca apagado.
6. **Busca:** MiniSearch, sem acentos; texto integral indexado pela Action;
   highlights e notas indexados no navegador.
7. **Integração (M5):** reader abre `artigos/#salvar?url=…&origem=reader`;
   highlight exportado direto para `meus-bookmarks/data/bookmarks.json` como
   categoria "Quote" (aquele repo é PÚBLICO). Formato da nota a confirmar.
8. **Sanitização:** DOMPurify com lista permitida, na extração e na exibição,
   + CSP na página.

## Etapas

- **E0** — Node 22, repos `artigos` (público) e `artigos-dados` (privado),
  primeiro commit. ← atual
- **M1** — extrator local sobre 5 URLs de teste → `amostra-dados/`.
- **M2** — lista + leitura + preferências, local, com a moldura visual.
- **M3** — highlights, notas, tags, estados, busca, backup.
- **M4** — Action, repo privado, token, Pages, bookmarklet, edição manual.
- **M5** — integração com reader e meus-bookmarks.

Ambiente: Mac Intel, macOS 12 (Monterey) → Node 22 LTS (o 24 exige macOS
13.5+). Suporte do Node 22 termina em abril de 2027.
