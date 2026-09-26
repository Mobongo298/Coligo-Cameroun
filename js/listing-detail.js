// ==========================================================
// COLIGO — js/listing-detail.js
// ==========================================================
// Fiche d'un listing, partagée par agent.html, retrait.html et Admin.html.
// Un clic sur un listing ouvre une fenêtre qui présente le listing
// (numéro, type, agence, date, agent) et la liste de TOUS les colis
// enregistrés dessus, avec leur statut actuel. Bouton « Réimprimer »
// (copie à l'identique, aucun statut n'est modifié).
//
// Autonome : injecte son propre style, fonctionne avec ou sans Tailwind.
// ==========================================================

(function () {
  if (document.getElementById('ld-style')) return;
  const st = document.createElement('style');
  st.id = 'ld-style';
  st.textContent = `
    .ld-fond { position: fixed; inset: 0; z-index: 9990; background: rgba(15,23,42,.5);
      display: flex; align-items: center; justify-content: center; padding: 16px; animation: ldIn .15s ease-out; }
    @keyframes ldIn { from { opacity: 0; } to { opacity: 1; } }
    .ld-boite { background: #fff; color: #1e293b; border-radius: 16px; width: 100%; max-width: 980px;
      max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px -12px rgba(15,23,42,.45);
      font-family: inherit; overflow: hidden; }
    .ld-tete { padding: 18px 22px 14px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 12px;
      align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .ld-titre { font-size: 1.15rem; font-weight: 700; margin: 0; }
    .ld-sous { font-size: .8rem; color: #64748b; margin-top: 3px; }
    .ld-actions { display: flex; gap: 8px; }
    .ld-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 10px;
      padding: 8px 14px; font-size: .82rem; font-weight: 600; cursor: pointer; }
    .ld-btn:hover { background: #f1f5f9; }
    .ld-btn.primaire { background: #0C3F65; border-color: #0C3F65; color: #fff; }
    .ld-btn.primaire:hover { background: #0a3555; }
    .ld-kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; padding: 14px 22px; }
    .ld-kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; }
    .ld-kpi b { display: block; font-size: 1.05rem; margin-top: 2px; }
    .ld-kpi span { font-size: .72rem; color: #64748b; }
    .ld-filtre { padding: 0 22px 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .ld-filtre input { flex: 1; min-width: 180px; border: 1px solid #cbd5e1; border-radius: 10px;
      padding: 8px 12px; font-size: .85rem; }
    .ld-corps { overflow: auto; padding: 0 22px 18px; }
    .ld-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .ld-table th { position: sticky; top: 0; background: #fff; text-align: left; font-weight: 600;
      font-size: .72rem; color: #64748b; padding: 8px 8px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .ld-table td { padding: 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .ld-table tr:hover td { background: #f8fafc; }
    .ld-num { font-weight: 600; white-space: nowrap; }
    .ld-badge { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: .72rem; font-weight: 600; white-space: nowrap; }
    .ld-vide { text-align: center; color: #64748b; padding: 34px 10px; }
    .ld-vide svg { width: 38px; height: 38px; color: #94a3b8; display: block; margin: 0 auto 8px; }
    @media (max-width: 700px) {
      .ld-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .ld-table thead { display: none; }
      .ld-table tr { display: block; border-bottom: 1px solid #e2e8f0; padding: 6px 0; }
      .ld-table td { display: flex; justify-content: space-between; gap: 10px; border: 0; padding: 3px 0; }
      .ld-table td::before { content: attr(data-label); color: #64748b; font-size: .72rem; }
    }
  `;
  document.head.appendChild(st);
})();

function ldEsc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function ldMontant(n) {
  const v = Number(n);
  return isNaN(v) ? '—' : v.toLocaleString('fr-FR') + ' FCFA';
}
function ldDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function ldTitre(listing) {
  return listing.type === 'bg' ? 'Listing — Bouteilles de gaz' : 'Listing — Colis groupés';
}

function ldFermer() {
  const f = document.getElementById('ld-fond');
  if (f) f.remove();
  document.removeEventListener('keydown', ldEchap);
}
function ldEchap(e) { if (e.key === 'Escape') ldFermer(); }

async function ouvrirDetailListing(listingId) {
  ldFermer();
  const fond = document.createElement('div');
  fond.id = 'ld-fond';
  fond.className = 'ld-fond';
  fond.innerHTML = `<div class="ld-boite" role="dialog" aria-modal="true"><div class="ld-vide">Chargement du listing…</div></div>`;
  fond.addEventListener('click', (e) => { if (e.target === fond) ldFermer(); });
  document.body.appendChild(fond);
  document.addEventListener('keydown', ldEchap);

  const [{ data: listing, error: e1 }, { data: colis, error: e2 }] = await Promise.all([
    supabaseClient.from('listings').select('*').eq('id', listingId).maybeSingle(),
    supabaseClient.from('colis').select('*').eq('listing_id', listingId).order('numero_suivi', { ascending: true })
  ]);

  const boite = fond.querySelector('.ld-boite');
  if (!boite) return;
  if (e1 || e2 || !listing) {
    boite.innerHTML = `<div class="ld-vide">Impossible d'afficher ce listing. Réessayez.<br><br>
      <button class="ld-btn" onclick="ldFermer()">Fermer</button></div>`;
    return;
  }

  const liste = colis || [];
  const total = liste.reduce((s, c) => s + (Number(c.montant_paye) || 0), 0);
  const parStatut = {};
  liste.forEach(c => {
    const s = (typeof normalizeStatut === 'function') ? normalizeStatut(c.statut) : c.statut;
    parStatut[s] = (parStatut[s] || 0) + 1;
  });
  const trajet = liste.length ? `${liste[0].ville_depart || '—'} → ${liste[0].ville_arrivee || '—'}` : '—';
  const resume = Object.entries(parStatut).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(' · ') || '—';

  boite.innerHTML = `
    <div class="ld-tete">
      <div>
        <h2 class="ld-titre">Listing ${ldEsc(listing.numero_listing)}</h2>
        <div class="ld-sous">${ldEsc(ldTitre(listing).replace('Listing — ', ''))} · agence ${ldEsc(listing.agence) || '—'} ·
          imprimé le ${ldDate(listing.created_at)}${listing.agent ? ' par ' + ldEsc(listing.agent) : ''}</div>
      </div>
      <div class="ld-actions">
        <button class="ld-btn primaire" id="ld-imprimer">Réimprimer</button>
        <button class="ld-btn" id="ld-fermer">Fermer</button>
      </div>
    </div>
    <div class="ld-kpis">
      <div class="ld-kpi"><span>Colis enregistrés</span><b>${liste.length}</b></div>
      <div class="ld-kpi"><span>Montant total</span><b>${ldMontant(total)}</b></div>
      <div class="ld-kpi"><span>Trajet</span><b>${ldEsc(trajet)}</b></div>
      <div class="ld-kpi"><span>Statuts</span><b style="font-size:.82rem; font-weight:600;">${ldEsc(resume)}</b></div>
    </div>
    ${liste.length > 6 ? `<div class="ld-filtre"><input id="ld-recherche" type="search" placeholder="Rechercher un colis (n° de suivi, nom, téléphone)…"></div>` : ''}
    <div class="ld-corps">
      <table class="ld-table">
        <thead><tr>
          <th>#</th><th>N° de suivi</th><th>Expéditeur</th><th>Destinataire</th><th>Tél. destinataire</th>
          <th>Description</th><th>Montant</th><th>Statut</th>
        </tr></thead>
        <tbody id="ld-lignes"></tbody>
      </table>
    </div>`;

  const rendreLignes = (filtre) => {
    const f = (filtre || '').trim().toLowerCase();
    const lignes = liste.filter(c => !f || [c.numero_suivi, c.expediteur_nom, c.destinataire_nom, c.destinataire_telephone, c.expediteur_telephone]
      .some(v => String(v || '').toLowerCase().includes(f)));
    const tbody = document.getElementById('ld-lignes');
    if (!lignes.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="ld-vide">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>
        ${f ? 'Aucun colis ne correspond à cette recherche.' : 'Aucun colis rattaché à ce listing.'}</div></td></tr>`;
      return;
    }
    tbody.innerHTML = lignes.map((c, i) => {
      const s = (typeof normalizeStatut === 'function') ? normalizeStatut(c.statut) : c.statut;
      const col = (typeof statutColors === 'function') ? statutColors(s) : { bg: '#f1f5f9', text: '#334155' };
      return `<tr>
        <td data-label="#">${i + 1}</td>
        <td data-label="N° de suivi" class="ld-num">${ldEsc(c.numero_suivi)}</td>
        <td data-label="Expéditeur">${ldEsc(c.expediteur_nom) || '—'}</td>
        <td data-label="Destinataire">${ldEsc(c.destinataire_nom) || '—'}</td>
        <td data-label="Tél. destinataire">${ldEsc(c.destinataire_telephone) || '—'}</td>
        <td data-label="Description">${ldEsc(c.Description_du_colis) || '—'}</td>
        <td data-label="Montant" style="white-space:nowrap">${ldMontant(c.montant_paye)}</td>
        <td data-label="Statut"><span class="ld-badge" style="background:${col.bg}; color:${col.text}">${ldEsc(s)}</span></td>
      </tr>`;
    }).join('');
  };
  rendreLignes('');

  const rech = document.getElementById('ld-recherche');
  if (rech) rech.addEventListener('input', () => rendreLignes(rech.value));
  document.getElementById('ld-fermer').addEventListener('click', ldFermer);
  document.getElementById('ld-imprimer').addEventListener('click', () => {
    // Réimpression uniquement : aucun statut n'est modifié.
    if (typeof imprimerListing === 'function') imprimerListing(listing, liste, ldTitre(listing));
  });
}
