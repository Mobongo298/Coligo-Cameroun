// ==========================================================
// COLIGO — fenêtre de détail d'un colis, PARTAGÉE par tous les espaces
// Dès qu'on clique sur un colis (liste, historique, notification, recherche…) dans l'espace
// administrateur, agent d'expédition ou agent de retrait, cette même fenêtre s'ouvre :
// informations du colis à gauche, reçus (2 exemplaires) à droite.
//
//   SuiviFenetre.ouvrir(colis, {
//     sous,                 // texte sous le numéro (facultatif)
//     extra: (zone, c) => {},          // contenu ajouté sous les informations (ex. corrections)
//     retour: { label, onClick },      // bouton « ← Retour … » (facultatif)
//     actions: [{ label, onClick }],   // boutons supplémentaires (facultatif)
//     onFermer: () => {}
//   });
//   SuiviFenetre.fermer([sansCallback]);
// Dépendances : receipt.js (RECU_CSS, recuCompletHtml, recuSurveillerIframe, normalizeStatut, statutColors).
// ==========================================================
(function () {
  const CSS = `
  .sw-fond { position: fixed; inset: 0; z-index: 9995; display: flex; align-items: center; justify-content: center; padding: 8px;
    background: rgba(12, 32, 50, 0.5); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    font-family: Inter, 'Segoe UI', system-ui, sans-serif; color: #0f172a; }
  .sw-fond.sw-cache { display: none !important; }
  .sw-fond *, .sw-fond *::before, .sw-fond *::after { box-sizing: border-box; }
  .sw-boite { background: #fff; border-radius: 16px; padding: 18px 22px; width: 100%; max-width: 560px; max-height: 96vh; overflow-y: auto;
    box-shadow: 0 30px 70px rgba(6, 26, 43, 0.4); }
  .sw-gauche { display: flex; flex-direction: column; min-height: 0; }
  .sw-titre { margin: 0 0 4px; color: #0C3F65; font-size: 1.45rem; font-weight: 800; letter-spacing: -.01em; }
  .sw-sous { color: #64748b; font-size: .9rem; margin-bottom: 12px; line-height: 1.35; }
  .sw-grille { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin-bottom: 12px; }
  .sw-grille .sw-plein { grid-column: 1 / -1; }
  .sw-grille .k { font-size: .84rem; color: #64748b; }
  .sw-grille .v { font-size: 1.02rem; font-weight: 600; margin-top: 1px; word-break: break-word; }
  .sw-badge { display: inline-block; padding: 2px 12px; border-radius: 999px; font-size: .85rem; font-weight: 600; }
  .sw-btn { display: block; width: 100%; cursor: pointer; font: inherit; font-weight: 700; font-size: 1.02rem; text-align: center;
    border-radius: 12px; padding: 14px 16px; margin-top: 12px; min-height: 0; line-height: 1.2;
    background: var(--action-green, #07823B); color: #fff; border: 1.5px solid var(--action-green, #07823B); transition: background .15s; }
  .sw-btn:hover { background: var(--action-green-hover, #066B31); border-color: var(--action-green-hover, #066B31); }
  .sw-btn.sw-fermer { margin-top: auto; }
  .sw-gauche .sw-reste { flex: 1 1 auto; min-height: 12px; }
  .sw-droite { display: flex; flex-direction: column; min-height: 0; margin-top: 16px; }
  .sw-recu-titre { font-weight: 800; font-size: 1.05rem; color: #0C3F65; margin: 2px 0 8px; }
  .sw-recu-zone { border-radius: 10px; overflow-x: hidden; overflow-y: auto; background: #f8fafc; flex: 1 1 0; min-height: 360px; }
  @media (min-width: 900px) {
    .sw-boite { max-width: min(1560px, 98vw); width: 98vw; height: 97vh; max-height: 97vh; padding: 18px 22px; overflow: hidden;
      display: grid; grid-template-columns: minmax(340px, 430px) minmax(0, 1fr); gap: 22px; }
    .sw-gauche { overflow-y: auto; padding-right: 4px; }
    .sw-droite { margin-top: 0; }
    .sw-recu-zone { min-height: 0; }
  }
  `;
  let fond = null, colis = null, options = {};

  function e(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const fcfa = (n) => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('fr-FR') + ' FCFA';
  function dateHeure(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function construire() {
    if (fond) return;
    const st = document.createElement('style');
    st.id = 'sw-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    fond = document.createElement('div');
    fond.id = 'sw-fond';
    fond.className = 'sw-fond sw-cache';
    fond.setAttribute('aria-modal', 'true');
    fond.setAttribute('aria-label', 'Détail du colis');
    document.body.appendChild(fond);
    fond.addEventListener('click', (ev) => { if (ev.target === fond) fermer(); });
    // Échap : ferme cette fenêtre en priorité (sans refermer ce qui se trouve dessous).
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && estOuverte()) { ev.stopImmediatePropagation(); fermer(); }
    }, true);
  }

  function estOuverte() { return !!fond && !fond.classList.contains('sw-cache'); }

  function rendreRecu(c, zone) {
    const iframe = document.createElement('iframe');
    iframe.title = 'Reçu du colis';
    iframe.style.cssText = 'width:100%; border:0; display:block; height:600px;';
    zone.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${RECU_CSS}
      body { background:#f8fafc; padding:12px 0; margin:0; }
      .recu { box-shadow:0 2px 10px rgba(0,0,0,0.08); margin:0 auto 14px; }
      @media (min-width: 640px) { body { display:flex; gap:14px; justify-content:center; align-items:flex-start; } .recu { margin:0; } }
      </style></head><body>${recuCompletHtml(c)}</body></html>`);
    doc.close();
    // Les 2 reçus sont agrandis pour remplir la largeur ; la zone défile si besoin.
    recuSurveillerIframe(iframe, () => zone.clientHeight - 4, undefined, true);
  }

  function ouvrir(c, opts) {
    if (!c) return;
    construire();
    options = opts || {};
    colis = c;
    const s = normalizeStatut(c.statut);
    const col = statutColors(s);
    const sous = options.sous != null ? options.sous : '';

    fond.innerHTML = `
      <div class="sw-boite">
        <div class="sw-gauche">
          <h3 class="sw-titre">${e(c.numero_suivi)}</h3>
          ${sous ? `<div class="sw-sous">${e(sous)}</div>` : ''}
          <div class="sw-grille">
            <div><div class="k">Statut</div><div class="v"><span class="sw-badge" style="background:${col.bg};color:${col.text}">${e(s)}</span></div></div>
            <div><div class="k">Agence</div><div class="v">${e(c.agence) || '—'}</div></div>
            <div><div class="k">Expéditeur</div><div class="v">${e(c.expediteur_nom) || '—'}</div></div>
            <div><div class="k">Téléphone expéditeur</div><div class="v">${e(c.expediteur_telephone) || '—'}</div></div>
            <div><div class="k">Destinataire</div><div class="v">${e(c.destinataire_nom) || '—'}</div></div>
            <div><div class="k">Téléphone destinataire</div><div class="v">${e(c.destinataire_telephone) || '—'}</div></div>
            <div><div class="k">Ville de départ</div><div class="v">${e(c.ville_depart) || '—'}</div></div>
            <div><div class="k">Ville d'arrivée</div><div class="v">${e(c.ville_arrivee) || '—'}</div></div>
            <div><div class="k">Montant payé</div><div class="v">${fcfa(c.montant_paye)}</div></div>
            <div><div class="k">Valeur déclarée</div><div class="v">${fcfa(c.valeur)}</div></div>
            <div><div class="k">Agent</div><div class="v">${e(c.cree_par) || '—'}</div></div>
            <div><div class="k">Date d'enregistrement</div><div class="v">${dateHeure(c.created_at)}</div></div>
            <div class="sw-plein"><div class="k">Description du colis</div><div class="v">${e(c.Description_du_colis) || '—'}</div></div>
          </div>
          <div id="sw-extra"></div>
          <div class="sw-reste"></div>
          <div id="sw-boutons"></div>
        </div>
        <div class="sw-droite">
          <div class="sw-recu-titre">Reçu du colis ${e(c.numero_suivi)}</div>
          <div class="sw-recu-zone" id="sw-recu-zone"></div>
        </div>
      </div>`;

    const boutons = fond.querySelector('#sw-boutons');
    const ajouterBtn = (label, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw-btn' + (cls ? ' ' + cls : ''); b.textContent = label;
      b.addEventListener('click', fn);
      boutons.appendChild(b);
    };
    (options.actions || []).forEach(a => ajouterBtn(a.label, () => a.onClick && a.onClick(colis)));
    if (options.retour) ajouterBtn('← ' + options.retour.label, () => { const r = options.retour.onClick; fermer(true); if (r) r(); });
    ajouterBtn('Fermer', () => fermer(), 'sw-fermer');

    fond.classList.remove('sw-cache');
    const extra = fond.querySelector('#sw-extra');
    if (typeof options.extra === 'function') { try { options.extra(extra, c); } catch (err) { /* silencieux */ } }
    rendreRecu(c, fond.querySelector('#sw-recu-zone'));
  }

  function fermer(sansCallback) {
    if (!estOuverte()) return;
    fond.classList.add('sw-cache');
    fond.innerHTML = '';
    const cb = options.onFermer;
    colis = null; options = {};
    if (!sansCallback && typeof cb === 'function') { try { cb(); } catch (err) { /* silencieux */ } }
  }

  window.SuiviFenetre = { ouvrir, fermer, estOuverte, courant: () => colis };
})();
