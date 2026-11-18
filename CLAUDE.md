# Artigos

App pessoal de "ler depois". HTML + CSS + JS puro, sem framework nem build no
front-end. GitHub Pages + GitHub Actions + API do GitHub, sem servidor próprio.
Interface em pt-BR. Decisões e plano completos em `DECISOES.md`: leia antes de
propor mudanças de arquitetura.

## Regras

- **O dono é jornalista, não programador.** Guie uma etapa por vez: o quê e
  por quê, passos exatos, como conferir; espere "feito".
- **Pergunte antes de commitar, dar push ou mexer no GitHub** (repos, Pages,
  secrets, workflows). O dono confirma cada um.
- **Nunca peça token ou senha na conversa.** Diga onde guardá-lo.
- **Texto de terceiros nunca entra neste repo (público).** Saída local do
  extrator vai para `amostra-dados/` (no `.gitignore`); dados reais ficam no
  repo privado `artigos-dados`.
- **Bibliotecas copiadas para o repo** (`vendor/`), com versão fixa. Nada de
  CDN: o token fica no localStorage da origem `denispacheco-prog.github.io`,
  compartilhada com o reader e o meus-bookmarks.
- **Workflows só com ações oficiais `actions/*`** (mesma regra do reader).
- **Coesão visual é requisito:** use os tokens de `tokens.css`; não invente
  cores na moldura. O artigos se adapta ao reader e ao meus-bookmarks, nunca o
  contrário.
- **Rode `git pull` antes de mexer** (o dono usa mais de uma máquina).
