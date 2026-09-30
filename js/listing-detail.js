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


// ==========================================================
// Historique des listings REGROUPÉ PAR JOUR, colis affichés directement
// ----------------------------------------------------------
// Utilisé par agent.html (regroupé par date d'impression) et retrait.html
// (regroupé par date de réception). Options :
//   champDate   : 'created_at' (impression) ou 'recu_le' (réception)
//   champAgent  : 'agent' (imprimé par) ou 'recu_par' (reçu par)
//   verbeAgent  : 'Imprimé par' / 'Reçu par'
//   verbeHeure  : 'Imprimé à' / 'Reçu à'
//   montrerOrigine : true pour afficher l'agence d'origine du listing
// ==========================================================
(function () {
  if (document.getElementById('lg-style')) return;
  const st = document.createElement('style');
  st.id = 'lg-style';
  st.textContent = `
    .lg-jour { margin: 22px 0 10px; padding: 10px 14px; border-radius: 12px; background: #0C3F65; color: #fff;
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 14px; font-weight: 700; font-size: .95rem; }
    .lg-jour:first-child { margin-top: 0; }
    .lg-jour small { font-weight: 500; opacity: .85; font-size: .78rem; }
    .lg-carte { border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 14px; overflow: hidden; background: #fff; }
    .lg-tete { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px;
      padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .lg-num { font-weight: 800; font-size: 1rem; color: #0C3F65; }
    .lg-meta { font-size: .78rem; color: #475569; margin-top: 3px; line-height: 1.5; }
    .lg-meta b { color: #0f172a; }
    .lg-btn { border: 1px solid #0C3F65; background: #0C3F65; color: #fff; border-radius: 10px; padding: 7px 13px;
      font-size: .78rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .lg-btn:hover { background: #0a3555; }
    .lg-table-wrap { overflow-x: auto; }
    .lg-table { width: 100%; border-collapse: collapse; font-size: .78rem; min-width: 980px; }
    .lg-table th { text-align: left; font-weight: 600; font-size: .68rem; text-transform: uppercase; letter-spacing: .03em;
      color: #64748b; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .lg-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .lg-table tr:last-child td { border-bottom: 0; }
    .lg-sub { color: #64748b; font-size: .72rem; }
    .lg-badge { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: .7rem; font-weight: 600; white-space: nowrap; }
    .lg-vide { text-align: center; color: #64748b; padding: 30px 10px; }
    div.lg-vide { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; }
  `;
  document.head.appendChild(st);
})();

const lgCache = {};   // id de listing -> { listing, colis } (pour la réimpression sans nouvelle requête)

function lgCleJour(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '0000-00-00';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lgLibelleJour(cle) {
  if (cle === '0000-00-00') return 'Date inconnue';
  const [a, m, j] = cle.split('-').map(Number);
  const t = new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function lgHeure(iso) {
  return iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
}

// Charge les colis de tous les listings par paquets (sans dépasser la limite de 1000 lignes par requête).
async function lgChargerColis(ids) {
  const parListing = {};
  ids.forEach(id => { parListing[id] = []; });
  const PAQUET = 20;
  for (let i = 0; i < ids.length; i += PAQUET) {
    const paquet = ids.slice(i, i + PAQUET);
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await supabaseClient.from('colis').select('*')
        .in('listing_id', paquet).order('numero_suivi', { ascending: true }).range(debut, debut + 999);
      if (error) return { error };
      (data || []).forEach(c => { if (parListing[c.listing_id]) parListing[c.listing_id].push(c); });
      if (!data || data.length < 1000) break;
    }
  }
  return { parListing };
}

async function afficherListingsGroupes(conteneur, listings, opts) {
  if (!listings.length) { conteneur.innerHTML = `<div class="lg-vide">${ldEsc(opts.messageVide || 'Aucun listing.')}</div>`; return; }

  const { parListing, error } = await lgChargerColis(listings.map(l => l.id));
  if (error) { conteneur.innerHTML = '<div class="lg-vide" style="color:#dc2626">Impossible de charger les colis des listings.</div>'; return; }

  listings.forEach(l => { lgCache[l.id] = { listing: l, colis: parListing[l.id] || [] }; });
  lgRendre(conteneur, listings, parListing, opts);
  return { parListing };
}

// Un colis correspond à la recherche si le texte figure dans son numéro de suivi,
// ou si les chiffres saisis figurent dans le téléphone du destinataire ou de l'expéditeur
// (espaces, « + » et tirets ignorés : « 677 12 » retrouve « +237 677 12 34 56 »).
function lgColisCorrespond(c, filtre) {
  const q = (filtre || '').trim().toLowerCase();
  if (!q) return true;
  if (String(c.numero_suivi || '').toLowerCase().includes(q)) return true;
  const chiffres = q.replace(/\D/g, '');
  if (chiffres.length < 3) return false;
  return [c.destinataire_telephone, c.expediteur_telephone]
    .some(t => String(t || '').replace(/\D/g, '').includes(chiffres));
}

// Affiche les listings déjà chargés. Avec opts.filtre, ne garde que les colis
// correspondants (et les listings qui en contiennent) — sans nouvelle requête.
function lgRendre(conteneur, listingsTous, parListingTous, opts) {
  const filtre = (opts.filtre || '').trim();
  let listings = listingsTous, parListing = parListingTous;
  if (filtre) {
    parListing = {};
    listings = listingsTous.filter(l => {
      const trouves = (parListingTous[l.id] || []).filter(c => lgColisCorrespond(c, filtre));
      parListing[l.id] = trouves;
      return trouves.length > 0;
    });
    if (!listings.length) {
      conteneur.innerHTML = `<div class="lg-vide">Aucun colis ne correspond à « ${ldEsc(filtre)} ». Vérifiez le numéro de suivi ou le numéro de téléphone.</div>`;
      return;
    }
  }

  // Regroupement par jour (les listings arrivent déjà triés du plus récent au plus ancien).
  const jours = [];
  const index = {};
  listings.forEach(l => {
    const k = lgCleJour(l[opts.champDate] || l.created_at);
    if (!(k in index)) { index[k] = jours.length; jours.push({ cle: k, listings: [] }); }
    jours[index[k]].listings.push(l);
  });

  conteneur.innerHTML = jours.map(j => {
    const nbColis = j.listings.reduce((s, l) => s + (parListing[l.id] || []).length, 0);
    const entete = `<div class="lg-jour"><span>${ldEsc(lgLibelleJour(j.cle))}</span>
      <small>${j.listings.length} listing${j.listings.length > 1 ? 's' : ''} · ${nbColis} colis</small></div>`;
    return entete + j.listings.map(l => {
      const liste = parListing[l.id] || [];
      const total = liste.reduce((s, c) => s + (Number(c.montant_paye) || 0), 0);
      const type = l.type === 'bg' ? 'Bouteilles de gaz' : 'Colis groupés';
      const dateRef = l[opts.champDate] || l.created_at;
      const lignes = liste.map((c, i) => {
        const s = (typeof normalizeStatut === 'function') ? normalizeStatut(c.statut) : c.statut;
        const col = (typeof statutColors === 'function') ? statutColors(s) : { bg: '#f1f5f9', text: '#334155' };
        return `<tr>
          <td>${i + 1}</td>
          <td style="font-weight:600;white-space:nowrap">${ldEsc(c.numero_suivi)}</td>
          <td>${ldEsc(c.expediteur_nom) || '—'}<div class="lg-sub">${ldEsc(c.expediteur_telephone) || '—'}</div></td>
          <td>${ldEsc(c.destinataire_nom) || '—'}<div class="lg-sub">${ldEsc(c.destinataire_telephone) || '—'}</div></td>
          <td style="white-space:nowrap">${ldEsc(c.ville_depart) || '—'} → ${ldEsc(c.ville_arrivee) || '—'}</td>
          <td>${ldEsc(c.Description_du_colis) || '—'}</td>
          <td style="white-space:nowrap">${c.valeur !== null && c.valeur !== undefined && c.valeur !== '' ? ldMontant(c.valeur) : '—'}</td>
          <td style="white-space:nowrap">${ldMontant(c.montant_paye)}</td>
          <td><span class="lg-badge" style="background:${col.bg};color:${col.text}">${ldEsc(s)}</span></td>
          <td style="white-space:nowrap">${ldDate(c.created_at)}<div class="lg-sub">par ${ldEsc(c.cree_par) || '—'}</div></td>
        </tr>`;
      }).join('') || `<tr><td colspan="10" class="lg-vide">Aucun colis rattaché à ce listing.</td></tr>`;

      return `<div class="lg-carte">
        <div class="lg-tete">
          <div>
            <div class="lg-num">Listing ${ldEsc(l.numero_listing)}</div>
            <div class="lg-meta">
              ${ldEsc(type)} · ${opts.montrerOrigine ? `agence d'origine <b>${ldEsc(l.agence) || '—'}</b> · ` : ''}${ldEsc(opts.verbeHeure)} <b>${lgHeure(dateRef)}</b> ·
              ${ldEsc(opts.verbeAgent)} <b>${ldEsc(l[opts.champAgent]) || '—'}</b><br>
              <b>${liste.length}</b> colis${filtre ? ` trouvé${liste.length > 1 ? 's' : ''} (sur ${(parListingTous[l.id] || []).length})` : ''} · montant total <b>${ldMontant(total)}</b>
            </div>
          </div>
          <button class="lg-btn" onclick="lgReimprimer(${l.id})">Réimprimer</button>
        </div>
        <div class="lg-table-wrap"><table class="lg-table">
          <thead><tr><th>#</th><th>N° de suivi</th><th>Expéditeur</th><th>Destinataire</th><th>Trajet</th><th>Description</th><th>Valeur</th><th>Montant payé</th><th>Statut</th><th>Enregistré</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table></div>
      </div>`;
    }).join('');
  }).join('');
}

function lgReimprimer(listingId) {
  const e = lgCache[listingId];
  if (!e) return;
  // Réimpression uniquement : aucun statut n'est modifié.
  if (typeof imprimerListing === 'function') imprimerListing(e.listing, e.colis, ldTitre(e.listing));
}
