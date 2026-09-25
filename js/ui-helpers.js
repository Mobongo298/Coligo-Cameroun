// Petite aide partagée, chargée avant chaque script de page.
// Utilisation : setBtnLoading(bouton, "Connexion…") puis clearBtnLoading(bouton)
// une fois la réponse de Supabase reçue.

function setBtnLoading(btn, loadingText) {
  if (!btn) return;
  if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span>${loadingText || 'Chargement…'}`;
}

function clearBtnLoading(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.dataset.origHtml !== undefined) {
    btn.innerHTML = btn.dataset.origHtml;
    delete btn.dataset.origHtml;
  }
}


// ==========================================================
// Tableaux ajustés à la largeur de l'écran
// ----------------------------------------------------------
// Chargé par toutes les pages. Un tableau reste un tableau (mêmes lignes, mêmes
// colonnes) et toutes ses colonnes sont visibles en même temps : plus besoin de
// le faire défiler de gauche à droite. Chaque tableau choisit tout seul la
// présentation la moins serrée qui tient dans la largeur disponible :
//
//   0. Tel quel, s'il tient déjà.
//   1. Resserré : texte un peu plus petit, marges réduites, les noms et
//      descriptions passent à la ligne. Les numéros de suivi, téléphones et
//      montants restent d'un seul tenant.
//   2. Plus serré : les téléphones et montants peuvent passer sur deux lignes
//      (jamais au milieu d'un mot).
//   3. Si ça ne tient toujours pas (petit écran de téléphone) : le tableau entier est
//      réduit à l'échelle pour tenir en largeur. Les mots restent entiers et
//      on peut zoomer avec deux doigts ou passer le téléphone en mode paysage.
//
// Refait automatiquement quand la fenêtre change de taille, quand un onglet qui
// contenait le tableau devient visible, ou quand de nouvelles lignes arrivent.
// Pour exclure un tableau : lui mettre l'attribut data-tableau-fixe.
// ==========================================================
(function () {
  const ID_SUIVI = /^[A-Z]{2,4}\d{4,}\/\d{2}$/;
  const INSECABLE = t => /^\+?\d[\d\s().-]{5,}$/.test(t) || /^[\d\s\u00a0\u202f]+FCFA$/i.test(t) || ID_SUIVI.test(t);
  const CLASSES = ['tf-1', 'tf-2'];
  const enregistres = new WeakSet();
  const largeurs = new WeakMap();
  let file = new Set();
  let planifie = false;

  function planifier(table) {
    file.add(table);
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(() => {
      planifie = false;
      const tables = [...file]; file = new Set();
      tables.forEach(ajuster);
    });
  }

  // Repère les cellules qu'on évite de couper : numéros de suivi, téléphones, montants
  // (y compris un téléphone écrit sous un nom, dans la même cellule).
  function reperer(table) {
    table.querySelectorAll('tbody td').forEach(td => {
      if (td.colSpan > 1) return;
      if (INSECABLE(td.textContent.trim())) td.classList.add('tf-nb');
      td.querySelectorAll('div, span').forEach(el => {
        if (!el.children.length && INSECABLE(el.textContent.trim())) el.classList.add('tf-nb');
      });
    });
  }

  function deborde(table) {
    const cont = table.parentElement;
    return !!cont && table.offsetWidth > cont.clientWidth + 1;
  }

  function remettreAZero(table) {
    table.classList.remove(...CLASSES);
    const cont = table.parentElement;
    if (table.dataset.tfEchelle) {
      table.style.transform = ''; table.style.transformOrigin = ''; table.style.width = '';
      if (cont) { cont.style.height = ''; cont.style.overflow = ''; }
      delete table.dataset.tfEchelle;
    }
  }

  // 4) Réduction à l'échelle : seulement si le tableau est seul dans son conteneur.
  function reduire(table) {
    const cont = table.parentElement;
    if (!cont || cont.children.length !== 1) return;
    const naturelle = table.offsetWidth;                    // largeur minimale du tableau (niveau 2)
    const dispo = cont.clientWidth;
    if (!naturelle || naturelle <= dispo) return;
    const k = dispo / naturelle;
    table.style.width = naturelle + 'px';
    table.style.transformOrigin = '0 0';
    table.style.transform = 'scale(' + k + ')';
    cont.style.overflow = 'hidden';
    cont.style.height = Math.ceil(table.offsetHeight * k) + 'px';
    table.dataset.tfEchelle = '1';
  }

  function ajuster(table) {
    if (!table.isConnected || table.hasAttribute('data-tableau-fixe')) return;
    reperer(table);
    remettreAZero(table);
    if (table.getClientRects().length === 0) return;      // masqué : refait à l'affichage
    if (!deborde(table)) return;                           // 0) tient tel quel
    for (const cls of ['tf-1', 'tf-2']) {                  // 1) puis 2)
      table.classList.remove(...CLASSES);
      table.classList.add(cls);
      if (!deborde(table)) return;
    }
    reduire(table);                                        // 3) (le niveau 2 est en place)
  }

  function enregistrer(table) {
    if (!enregistres.has(table)) {
      enregistres.add(table);
      const cont = table.parentElement;
      if (cont && typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
          const w = cont.clientWidth;
          if (largeurs.get(table) !== w) { largeurs.set(table, w); planifier(table); }
        }).observe(cont);
      }
    }
    planifier(table);
  }

  function demarrer() {
    document.querySelectorAll('table').forEach(enregistrer);

    new MutationObserver(mutations => {
      for (const m of mutations) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const t = el && el.closest ? el.closest('table') : null;
        if (t) planifier(t);
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'TABLE') enregistrer(n);
          else if (n.querySelectorAll) n.querySelectorAll('table').forEach(enregistrer);
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Page entièrement affichée, polices chargées, fenêtre redimensionnée : les largeurs changent.
    const toutRefaire = () => document.querySelectorAll('table').forEach(planifier);
    window.addEventListener('load', toutRefaire);
    window.addEventListener('resize', toutRefaire);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(toutRefaire);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})();

// ==========================================================
// Afficher / masquer le mot de passe (icône "œil")
// ----------------------------------------------------------
// S'applique automatiquement à TOUS les champs type="password"
// présents sur la page, sans avoir à modifier chaque écran.
// ==========================================================
(function () {
  const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.27 21.27 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.27 21.27 0 0 1-3.22 4.34M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function wrapOne(input) {
    if (input.dataset.pwToggled) return;
    input.dataset.pwToggled = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'pw-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Afficher le mot de passe');
    btn.tabIndex = -1;
    btn.innerHTML = EYE_OPEN;
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE_OPEN : EYE_OFF;
      btn.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    });
  }

  function scan() {
    document.querySelectorAll('input[type="password"]').forEach(wrapOne);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();

  // Certains champs (ex. dans une fenêtre modale) peuvent être injectés après coup.
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();

// ==========================================================
// Champs numériques stricts (code, montant, téléphone)
// ----------------------------------------------------------
// class="digits-only" → uniquement des chiffres (0-9).
// class="phone-only"  → chiffres, espaces et un "+" en tête (format téléphone).
// Fonctionne aussi sur les champs ajoutés dynamiquement (fenêtres modales),
// et bloque aussi bien la saisie clavier que le collage de texte.
// ==========================================================
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'INPUT') return;

  if (el.classList.contains('digits-only')) {
    const clean = el.value.replace(/[^0-9]/g, '');
    if (clean !== el.value) el.value = clean;
  } else if (el.classList.contains('phone-only')) {
    let clean = el.value.replace(/[^0-9+ ]/g, '');
    if (clean.length) clean = clean[0] + clean.slice(1).replace(/\+/g, '');
    if (clean !== el.value) el.value = clean;
  }
});
