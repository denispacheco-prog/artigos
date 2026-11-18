// Roda no <head>, antes de desenhar a página, para o tema não "piscar".
// Mesmo modelo do meus-bookmarks: segue o sistema; a escolha manual fica em
// localStorage "artigos:theme" = "light" | "dark".
(function () {
  try {
    var t = localStorage.getItem('artigos:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
