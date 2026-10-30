// COLIGO — affichage des fenêtres sans défilement vertical.
// Quand une fenêtre (détail colis, reçu, listing, suivi client, modification…) est plus haute
// que l'écran, son contenu est légèrement réduit pour que TOUT soit visible d'un coup d'œil.
// Réduction limitée à 70 % : en dessous, le texte devient illisible et le défilement reprend.
// Sur téléphone (écran étroit), on garde le défilement normal.
(function () {
  const ZOOM_MIN = 0.7;      // plus petit facteur de réduction accepté
  const LARGEUR_MIN = 700;   // en dessous : mobile, pas de réduction
  const MARGE = 0.97;        // part de la hauteur d'écran utilisable

  // [fenêtre, zones défilantes internes]
  const CIBLES = [
    ['#modal-backdrop > #modal-content', []],
    ['#recu-modal > div', ['#recu-modal-corps']],
    ['#suivi-modal .suivi-dialog', ['#suivi-modal-corps']],
    ['#ld-fond .ld-boite', ['.ld-corps']]
  ];

  function visible(el) {
    return !!(el && el.offsetParent !== null || (el && getComputedStyle(el).position === 'fixed' && el.getClientRects().length));
  }

  function ajuster(boite, zones) {
    boite.style.zoom = '';
    boite.style.maxHeight = '';
    if (window.innerWidth < LARGEUR_MIN || !visible(boite)) return;

    // Mesure de la hauteur « naturelle » : on lève temporairement les limites de hauteur.
    const saves = [];
    const libere = (el) => {
      saves.push([el, el.style.maxHeight, el.style.overflow, el.style.overflowY, el.style.height]);
      el.style.maxHeight = 'none'; el.style.overflow = 'visible'; el.style.overflowY = 'visible';
    };
    libere(boite);
    zones.forEach(sel => boite.querySelectorAll(sel).forEach(libere));
    const hauteur = boite.getBoundingClientRect().height;
    saves.forEach(([el, mh, ov, ovy, h]) => { el.style.maxHeight = mh; el.style.overflow = ov; el.style.overflowY = ovy; el.style.height = h; });

    const dispo = window.innerHeight * MARGE;
    if (!hauteur || hauteur <= dispo) return;           // ça tient déjà : rien à faire

    const z = Math.max(ZOOM_MIN, dispo / hauteur);
    boite.style.zoom = String(z);
    if (z > ZOOM_MIN) {
      // Tout tient : plus aucune barre de défilement.
      boite.style.maxHeight = 'none';
      zones.forEach(sel => boite.querySelectorAll(sel).forEach(el => { el.style.overflow = 'visible'; }));
    }
    // Si z = ZOOM_MIN, le contenu restant reste accessible par défilement (cas extrême).
  }

  function toutAjuster() {
    CIBLES.forEach(([sel, zones]) => document.querySelectorAll(sel).forEach(b => ajuster(b, zones)));
  }

  let planifie = false;
  function planifier() {
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(() => {
      planifie = false;
      toutAjuster();
      // Contenus qui arrivent après coup (requêtes, iframes de reçus) : on revérifie.
      setTimeout(toutAjuster, 150);
      setTimeout(toutAjuster, 500);
      setTimeout(toutAjuster, 1100);
    });
  }

  new MutationObserver(planifier).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden']
  });
  window.addEventListener('resize', planifier);
  window.addEventListener('orientationchange', planifier);
  document.addEventListener('DOMContentLoaded', planifier);
})();
