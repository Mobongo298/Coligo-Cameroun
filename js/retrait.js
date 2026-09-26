// ==========================================================
// COLIGO — retrait.html — espace agent dédié aux retraits
// Tables réelles : colis, colis_historique, agents, retraits
// ==========================================================

function fcfa(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function badge(s) {
  const st = normalizeStatut(s);
  const c = statutColors(st);
  return `<span class="text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-semibold" style="background:${c.bg}; color:${c.text}">${esc(st)}</span>`;
}

// ---------- Session (partagée avec agent.html) ----------

function getSession() {
  const raw = sessionStorage.getItem('coligo_agent_session');
  return raw ? JSON.parse(raw) : null;
}
function setSession(a) { sessionStorage.setItem('coligo_agent_session', JSON.stringify(a)); }
function clearSession() { sessionStorage.removeItem('coligo_agent_session'); }

function initiales(nom) {
  return (nom || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function showDashboard(agent) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('agent-nom').textContent = agent.nom_complet;
  document.getElementById('agent-agence').textContent = agent.agence;
  document.getElementById('agent-agence-rail').textContent = 'Agence de ' + agent.agence;
  document.getElementById('agent-initials').textContent = initiales(agent.nom_complet);

  const autre = villeArriveePour(agent.agence);
  document.getElementById('agence-opposee-nom').textContent = `l'agence de ${autre}`;
  document.getElementById('nav-opposee-label').textContent = `Colis enregistrés à l'agence de ${autre}`;

  show('retrait-colis');
  chargerHistorique();
  chargerListingsRecus();
  chargerColisAgenceOpposee();
  demarrerTempsReel(agent);
  if (typeof initMessagerie === 'function') initMessagerie();
  // Passage automatique du cycle de vie des données (voir
  // sql/cycle_de_vie_donnees_migration.sql) : anonymisation, archivage puis
  // suppression selon les règles définies par l'administrateur. La base
  // décide elle-même s'il faut agir (au plus une fois toutes les 20 h).
  // Repli sur l'ancienne fonction si la nouvelle migration n'est pas faite.
  supabaseClient.rpc('lifecycle_auto').then(({ data, error }) => {
    if (error) {
      return supabaseClient.rpc('nettoyer_retraits_expires').then(({ error: e2 }) => { if (!e2) chargerHistorique(); });
    }
    if (data && data.execute) chargerHistorique();
  });
  // Coupe la session si un administrateur désactive ce compte.
  surveillerCompteActif();
}

// ---------- Navigation latérale ----------
// Vues atteignables d'un seul clic depuis le rail : Retrait de colis (vue par
// défaut), historique des colis retirés, listings reçus, colis de l'agence
// opposée et messagerie.

function show(vue) {
  ['retrait-colis', 'retraits', 'listings', 'opposee', 'messagerie'].forEach(v => {
    document.getElementById('section-' + v).classList.toggle('hidden', v !== vue);
  });
  document.querySelectorAll('.rail-item[data-nav]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.nav === vue);
  });
  // Chaque menu affiche son propre titre en tête de page.
  const titres = {
    'retrait-colis': ['Retrait de colis', 'réceptionnez un listing, puis remettez les colis à leurs destinataires.'],
    'retraits': ['Historique des colis retirés', 'les 100 derniers retraits traités par votre agence.'],
    'listings': ['Historique des listings reçus', 'tous les listings envoyés vers votre agence.'],
    'opposee': [document.getElementById('nav-opposee-label').textContent, 'colis pas encore partis dans un listing.'],
    'messagerie': ['Messagerie', 'échangez avec les autres agents et l\'administration.']
  };
  const [titre, desc] = titres[vue];
  document.getElementById('page-titre').textContent = titre;
  document.getElementById('page-desc').textContent = desc;
  window.scrollTo(0, 0);
  // Sur mobile, le rail se referme dès qu'on a choisi.
  if (window.innerWidth < 1024) {
    const rail = document.getElementById('sidebar');
    rail.classList.add('hidden');
    rail.classList.remove('flex');
  }
}

function toggleMenu() {
  const rail = document.getElementById('sidebar');
  const ouvrir = rail.classList.contains('hidden');
  rail.classList.toggle('hidden', !ouvrir);
  rail.classList.toggle('flex', ouvrir);
}

async function chargerColisAgenceOpposee() {
  const agent = getSession();
  const tbody = document.getElementById('colis-opposee-body');

  const { data, error } = await supabaseClient
    .from('colis')
    .select('*')
    .eq('ville_arrivee', agent.agence)
    .eq('statut', 'Enregistré')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-red-600">Impossible de charger cette liste.</td></tr>';
    return;
  }
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500">Aucun colis en attente d\'impression pour le moment.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td class="py-2 pr-3 font-medium whitespace-nowrap">${esc(c.numero_suivi)}</td>
      <td class="py-2 pr-3">${esc(c.destinataire_nom)}</td>
      <td class="py-2 pr-3 text-slate-600">${esc(c.Description_du_colis) || '—'}</td>
      <td class="py-2 whitespace-nowrap">${fmtDateTime(c.created_at)}</td>
    </tr>`).join('');
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
}

function msgError(t) { return `<div class="bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3 text-sm">${esc(t)}</div>`; }
function msgSuccess(h) { return `<div class="msg-confirmation rounded-xl px-4 py-3 text-sm">${h}</div>`; }
function msgWarn(t) { return `<div class="bg-amber-50 text-amber-700 border border-amber-200 rounded-xl px-4 py-3 text-sm">${esc(t)}</div>`; }

// ---------- Connexion ----------

document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorZone = document.getElementById('login-error');
  errorZone.innerHTML = '';

  if (!username || !password) { errorZone.innerHTML = msgError("Renseignez l'identifiant et le mot de passe."); return; }

  setBtnLoading(btn, 'Connexion…');
  const { data, error } = await supabaseClient.rpc('agent_login', {
    p_username: username, p_password: password
  });
  clearBtnLoading(btn);

  if (error) { errorZone.innerHTML = msgError('Impossible de contacter la base de données.'); return; }
  if (!data || !data.ok) { errorZone.innerHTML = msgError((data && data.message) || 'Identifiant ou mot de passe incorrect.'); return; }
  const agent = data.agent;
  if (!enforceRole(agent, 'agent')) return;

  setSession(agent);
  marquerPresence(agent.id, true);
  showDashboard(agent);
});

document.getElementById('btn-logout').addEventListener('click', () => {
  const btn = document.getElementById('btn-logout');
  setBtnLoading(btn, '…');
  const agentActuel = getSession();
  setTimeout(async () => {
    if (agentActuel) await marquerPresence(agentActuel.id, false);
    clearBtnLoading(btn);
    if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
    if (typeof msgChannel !== 'undefined' && msgChannel) { supabaseClient.removeChannel(msgChannel); msgChannel = null; }
    sessionStorage.clear();
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').innerHTML = '';
    document.getElementById('resultat-zone').innerHTML = '';
    document.getElementById('recherche-input').value = '';
    showLogin();
  }, 250);
});

// ---------- Temps réel ----------

let realtimeChannel = null;

function demarrerTempsReel(agent) {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel('retrait-' + agent.username)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis', filter: `ville_arrivee=eq.${agent.agence}` }, (payload) => {
      chargerHistorique();
      chargerColisAgenceOpposee();
      // Si le colis affiché à l'écran vient de changer, on rafraîchit son affichage.
      if (colisTrouve && payload.new && payload.new.id === colisTrouve.id) {
        colisTrouve = payload.new;
        afficherColis(colisTrouve);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', filter: `agence=eq.${villeArriveePour(agent.agence)}` }, () => {
      chargerListingsRecus();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'retraits', filter: `agence=eq.${agent.agence}` }, () => {
      // Signal direct en plus du signal indirect via "colis" ci-dessus :
      // couvre le cas où un autre agent de la même agence traite un retrait.
      chargerHistorique();
    })
    .subscribe();
}

// ---------- Recherche d'un colis ----------

let colisTrouve = null;

async function rechercher() {
  const btn = document.getElementById('btn-rechercher');
  const q = document.getElementById('recherche-input').value.trim();
  const errZone = document.getElementById('recherche-erreur');
  const resZone = document.getElementById('resultat-zone');
  errZone.innerHTML = '';
  resZone.innerHTML = '';
  colisTrouve = null;

  if (!q) { errZone.innerHTML = msgError('Entrez un numéro de suivi ou un numéro de téléphone.'); return; }

  setBtnLoading(btn, 'Recherche…');

  const agent = getSession();
  const { data, error } = await supabaseClient
    .from('colis')
    .select('*')
    .or(`numero_suivi.ilike.${q},destinataire_telephone.ilike.%${q}%`);

  clearBtnLoading(btn);

  if (error) { errZone.innerHTML = msgError('Service momentanément indisponible. Réessayez.'); return; }
  if (!data || !data.length) {
    errZone.innerHTML = msgError('Aucun colis trouvé avec ces informations.');
    return;
  }

  // Un agent ne traite que les retraits destinés à sa propre agence.
  const ici = data.filter(c => normalizeCity(c.ville_arrivee) === normalizeCity(agent.agence));
  const colis = ici[0] || data[0];

  if (!ici.length) {
    resZone.innerHTML = msgWarn(
      `Ce colis (${esc(colis.numero_suivi)}) a pour destination ${esc(colis.ville_arrivee)}, pas votre agence (${esc(agent.agence)}). Le retrait ne peut se faire qu'à l'agence de destination.`
    );
    return;
  }

  colisTrouve = colis;
  afficherColis(colis);
}

document.getElementById('btn-rechercher').addEventListener('click', rechercher);

// ---------- Listing (plusieurs colis d'un coup) ----------

document.getElementById('btn-listing-disponible').addEventListener('click', async () => {
  const btn = document.getElementById('btn-listing-disponible');
  const zone = document.getElementById('listing-message');
  const saisie = document.getElementById('listing-input').value.trim();
  const agent = getSession();
  zone.innerHTML = '';

  if (!saisie) { zone.innerHTML = msgError('Entrez le numéro du listing.'); return; }

  setBtnLoading(btn, 'Vérification…');

  // Comparaison robuste : on récupère les listings de l'agence d'en face
  // (les 2 seules agences existent, donc "l'agence d'en face" = celle qui
  // n'est pas la nôtre) et on compare en ignorant espaces/casse/symboles,
  // pour que la saisie fonctionne quel que soit le formatage exact.
  const { data: listingsCandidats, error: errListing } = await supabaseClient
    .from('listings')
    .select('*')
    .neq('agence', agent.agence);

  if (errListing) { clearBtnLoading(btn); zone.innerHTML = msgError('Service momentanément indisponible. Réessayez.'); return; }

  const cible = normaliserNumeroListing(saisie);
  const listing = (listingsCandidats || []).find(l => normaliserNumeroListing(l.numero_listing) === cible);

  if (!listing) { clearBtnLoading(btn); zone.innerHTML = msgError(`Aucun listing trouvé avec le numéro « ${saisie} » pour votre agence.`); return; }

  const { data: colisListing, error: errColis } = await supabaseClient
    .from('colis').select('*').eq('listing_id', listing.id);

  if (errColis || !colisListing || !colisListing.length) {
    clearBtnLoading(btn);
    zone.innerHTML = msgError('Ce listing ne contient aucun colis.');
    return;
  }

  // Un listing ne peut être réceptionné que par l'agence de destination.
  const destinationOk = colisListing.every(c => normalizeCity(c.ville_arrivee) === normalizeCity(agent.agence));
  if (!destinationOk) {
    clearBtnLoading(btn);
    zone.innerHTML = msgError(`Ce listing ne concerne pas votre agence (destination : ${esc(colisListing[0].ville_arrivee)}).`);
    return;
  }

  const idsATraiter = colisListing.filter(c => normalizeStatut(c.statut) === 'En transit').map(c => c.id);

  if (!idsATraiter.length) {
    clearBtnLoading(btn);
    zone.innerHTML = msgWarn('Les colis de ce listing sont déjà tous "Disponible" (ou dans un autre état).');
    return;
  }

  const { error: errUpdate } = await supabaseClient
    .from('colis')
    .update({ statut: 'Disponible', updated_at: new Date().toISOString() })
    .in('id', idsATraiter);

  if (errUpdate) { clearBtnLoading(btn); zone.innerHTML = msgError('Mise à jour impossible. Réessayez.'); return; }

  await supabaseClient.from('colis_historique').insert(
    idsATraiter.map(id => ({ colis_id: id, statut: 'Disponible', agent: agent.username }))
  );

  clearBtnLoading(btn);
  zone.innerHTML = msgSuccess(`${idsATraiter.length} colis du listing <strong>${esc(listing.numero_listing)}</strong> sont maintenant "Disponible".`);
  document.getElementById('listing-input').value = '';
  chargerListingsRecus();
});

// ---------- Historique des colis reçus (listings), réimpression sans changement de statut ----------

async function chargerListingsRecus() {
  const agent = getSession();
  const tbody = document.getElementById('listings-recus-body');

  const { data, error } = await supabaseClient
    .from('listings')
    .select('*')
    .neq('agence', agent.agence)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-red-600">Impossible de charger l\'historique.</td></tr>';
    return;
  }
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-500">Aucun listing reçu pour le moment.</td></tr>';
    return;
  }

  const counts = await Promise.all(data.map(l =>
    supabaseClient.from('colis').select('*', { count: 'exact', head: true }).eq('listing_id', l.id)
  ));

  tbody.innerHTML = data.map((l, i) => `
    <tr>
      <td class="py-2 pr-3 font-medium whitespace-nowrap">${esc(l.numero_listing)}</td>
      <td class="py-2 pr-3">${l.type === 'bg' ? 'Bouteilles de gaz' : 'Colis groupés'}</td>
      <td class="py-2 pr-3">${counts[i].count || 0}</td>
      <td class="py-2 pr-3 whitespace-nowrap">${fmtDateTime(l.created_at)}</td>
      <td class="py-2 pr-3">${esc(l.agence)}</td>
      <td class="py-2"><button class="text-coligo hover:underline text-xs font-medium" onclick="reimprimerListingRecu(${l.id})">Réimprimer</button></td>
    </tr>`).join('');
}

async function reimprimerListingRecu(listingId) {
  const { data: listing, error: e1 } = await supabaseClient.from('listings').select('*').eq('id', listingId).maybeSingle();
  const { data: colisListe, error: e2 } = await supabaseClient.from('colis').select('*').eq('listing_id', listingId);
  if (e1 || e2 || !listing) { alert('Impossible de récupérer ce listing.'); return; }
  // Réimpression uniquement : aucune mise à jour de statut ici.
  imprimerListing(listing, colisListe || [], listing.type === 'bg' ? 'Listing — Bouteilles de gaz' : 'Listing — Colis groupés');
}

document.getElementById('btn-refresh-listings-recus').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-listings-recus');
  setBtnLoading(btn, 'Actualisation…');
  await chargerListingsRecus();
  clearBtnLoading(btn);
});
document.getElementById('recherche-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') rechercher(); });

// ---------- Affichage du colis + formulaire de retrait ----------

function afficherColis(c) {
  const resZone = document.getElementById('resultat-zone');
  const dejaRetire = normalizeStatut(c.statut) === 'Retiré';
  const disponible = normalizeStatut(c.statut) === 'Disponible';

  resZone.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6 mb-5">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="font-semibold text-lg">${esc(c.numero_suivi)}</h2>
        ${badge(c.statut)}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-2">
        <div><div class="text-xs text-slate-500">Expéditeur</div><div class="font-medium">${esc(c.expediteur_nom)}</div></div>
        <div><div class="text-xs text-slate-500">Téléphone expéditeur</div><div class="font-medium">${esc(c.expediteur_telephone) || '—'}</div></div>
        <div><div class="text-xs text-slate-500">Destinataire</div><div class="font-medium">${esc(c.destinataire_nom)}</div></div>
        <div><div class="text-xs text-slate-500">Téléphone destinataire</div><div class="font-medium">${esc(c.destinataire_telephone) || '—'}</div></div>
        <div><div class="text-xs text-slate-500">Trajet</div><div class="font-medium">${esc(c.ville_depart)} → ${esc(c.ville_arrivee)}</div></div>
        <div><div class="text-xs text-slate-500">Agence d'enregistrement</div><div class="font-medium">${esc(c.agence)}</div></div>
        <div><div class="text-xs text-slate-500">Montant payé</div><div class="font-medium">${fcfa(c.montant_paye)}</div></div>
        <div><div class="text-xs text-slate-500">Valeur déclarée</div><div class="font-medium">${fcfa(c.valeur)}</div></div>
        <div><div class="text-xs text-slate-500">Enregistré le</div><div class="font-medium">${fmtDateTime(c.created_at)}</div></div>
        <div><div class="text-xs text-slate-500">Enregistré par</div><div class="font-medium">${esc(c.cree_par) || '—'}</div></div>
        <div class="sm:col-span-2"><div class="text-xs text-slate-500">Description du contenu</div><div class="font-medium">${esc(c.Description_du_colis) || '—'}</div></div>
      </div>
    </div>

    ${dejaRetire ? `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6">
        ${msgWarn('Ce colis a déjà été retiré. Consultez « Historique des colis retirés » dans le menu pour voir les informations de retrait déjà enregistrées.')}
      </div>
    ` : !disponible ? `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6">
        ${msgWarn(`Ce colis n'est pas encore disponible pour retrait (statut actuel : ${normalizeStatut(c.statut)}). Le retrait ne peut être enregistré qu'une fois le colis "Disponible".`)}
      </div>
    ` : `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6">
        <h3 class="font-semibold mb-1 text-coligo">Identité de la personne qui retire le colis</h3>
        <p class="text-xs text-slate-500 mb-4">Remplissez soit le N° de CNI du destinataire, soit les informations du mandataire (si une autre personne vient retirer à sa place).</p>

        <div class="mb-5">
          <div class="text-sm font-medium mb-2">Le destinataire retire lui-même</div>
          <label class="block text-sm text-slate-600 mb-1" for="r-dest-cni">N° de CNI du destinataire</label>
          <input id="r-dest-cni" type="text" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Ex : 123456789">
        </div>

        <div class="border-t border-slate-200 pt-4 mb-5">
          <div class="text-sm font-medium mb-2">Ou retrait par un mandataire (autre personne)</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-sm text-slate-600 mb-1" for="r-mand-nom">Nom complet</label>
              <input id="r-mand-nom" type="text" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1" for="r-mand-tel">Téléphone</label>
              <input id="r-mand-tel" type="tel" value="+237 " class="phone-only w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            </div>
            <div>
              <label class="block text-sm text-slate-600 mb-1" for="r-mand-cni">N° de CNI</label>
              <input id="r-mand-cni" type="text" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            </div>
          </div>
        </div>

        <div id="retrait-message" class="mb-3"></div>

        <button id="btn-retire"
          class="w-full sm:w-auto text-white font-semibold px-8 py-3.5 rounded-xl transition text-base bg-[#15795A] hover:bg-[#106349] shadow-[0_8px_20px_-10px_rgba(21,121,90,0.6)]">
          Retiré
        </button>
      </div>
    `}
  `;

  if (!dejaRetire && disponible) {
    document.getElementById('btn-retire').addEventListener('click', () => confirmerRetrait(c));
  }
}

// ---------- Confirmation du retrait ----------

async function confirmerRetrait(c) {
  const btn = document.getElementById('btn-retire');
  const zone = document.getElementById('retrait-message');
  const agent = getSession();

  const destCni = document.getElementById('r-dest-cni').value.trim();
  const mandNom = document.getElementById('r-mand-nom').value.trim();
  const mandTel = document.getElementById('r-mand-tel').value.trim();
  const mandCni = document.getElementById('r-mand-cni').value.trim();

  const mandataireComplet = mandNom && mandTel && mandCni;
  zone.innerHTML = '';

  if (!destCni && !mandataireComplet) {
    zone.innerHTML = msgError("Renseignez soit le N° de CNI du destinataire, soit les 3 informations complètes du mandataire (nom, téléphone, CNI).");
    return;
  }

  setBtnLoading(btn, 'Enregistrement…');

  // 1) On enregistre d'abord QUI a retiré le colis. Si cette étape échoue
  //    (par exemple parce que sql/retraits_migration.sql n'a pas encore
  //    été exécuté dans Supabase), on s'arrête ici : le colis reste
  //    "Disponible" plutôt que de passer "Retiré" sans aucune trace de
  //    qui l'a récupéré.
  const { error: errRetrait } = await supabaseClient.from('retraits').insert({
    colis_id: c.id,
    destinataire_cni: destCni || null,
    mandataire_nom: mandataireComplet ? mandNom : null,
    mandataire_telephone: mandataireComplet ? mandTel : null,
    mandataire_cni: mandataireComplet ? mandCni : null,
    agent: agent.username,
    agence: agent.agence
  });

  if (errRetrait) {
    clearBtnLoading(btn);
    zone.innerHTML = msgError(
      "Le retrait n'a pas pu être enregistré. Si c'est la première fois, il est probable que la table \"retraits\" " +
      "n'existe pas encore dans Supabase : exécutez sql/retraits_migration.sql (SQL Editor > New query), puis réessayez."
    );
    return;
  }

  // 2) Le retrait est bien enregistré : on peut maintenant faire passer
  //    le colis au statut "Retiré".
  const { error: errUpdate } = await supabaseClient
    .from('colis')
    .update({ statut: 'Retiré', updated_at: new Date().toISOString() })
    .eq('id', c.id);

  if (errUpdate) {
    // Le retrait est enregistré mais le statut n'a pas pu être mis à jour :
    // on retire l'enregistrement pour ne pas laisser une trace incohérente,
    // et on prévient l'agent de réessayer.
    await supabaseClient.from('retraits').delete().eq('colis_id', c.id).eq('agent', agent.username);
    clearBtnLoading(btn);
    zone.innerHTML = msgError('Le colis n\'a pas pu être marqué "Retiré". Réessayez.');
    return;
  }

  await supabaseClient.from('colis_historique').insert({
    colis_id: c.id, statut: 'Retiré', agent: agent.username
  });

  clearBtnLoading(btn);

  // Confirmation claire — plus jamais le message "déjà retiré" juste
  // après un retrait qu'on vient tout juste d'effectuer.
  document.getElementById('resultat-zone').innerHTML = `
    <div class="msg-confirmation rounded-2xl p-6 text-center">
      <svg viewBox="0 0 24 24" class="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="m7.5 12.3 3 3 6-6.3"/></svg>
      <h2 class="font-semibold text-lg mb-1">Retrait confirmé</h2>
      <p class="text-sm">Le colis <strong>${esc(c.numero_suivi)}</strong> a été marqué comme retiré et vient d'être ajouté à « Historique des colis retirés ».</p>
    </div>
  `;
  document.getElementById('recherche-input').value = '';
  colisTrouve = null;

  chargerHistorique();
}

// ---------- Historique des retraits ----------

// Durée de conservation des colis retirés (règle de l'administrateur, 365 j par défaut).
let dureeConservationRetires = 365;

async function chargerDureeConservation() {
  const { data, error } = await supabaseClient.rpc('lifecycle_regles');
  if (error || !data) return;
  const j = Number(data.colis_retires_conservation_jours) || 365;
  dureeConservationRetires = j;
  const el = document.getElementById('ret-duree-auto');
  if (el) el.textContent = j % 365 === 0 ? `au bout de ${j === 365 ? 'un an' : (j / 365) + ' ans'}` : `après ${j} jours`;
}

async function chargerHistorique() {
  const agent = getSession();
  const tbody = document.getElementById('historique-body');

  const [{ data, error }] = await Promise.all([
    supabaseClient
      .from('retraits')
      .select('*, colis(*)')
      .eq('agence', agent.agence)
      .order('created_at', { ascending: false })
      .limit(100),
    chargerDureeConservation()
  ]);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-red-600 text-sm">
      Impossible de charger l'historique. Si c'est la première utilisation, exécutez sql/retraits_migration.sql dans Supabase (SQL Editor), puis actualisez.
    </td></tr>`;
    return;
  }

  // Les fiches dont le colis a déjà été supprimé (ou n'est plus « Retiré ») ne sont pas listées.
  const lignes = (data || []).filter(r => r.colis && ['Retiré', 'Livré'].includes(r.colis.statut));

  if (!lignes.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-10 text-center">
      <div class="mx-auto w-12 h-12 rounded-2xl grid place-items-center bg-slate-100 text-slate-400 mb-3">
        <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="M3 8.5 12 14l9-5.5M12 14v7"/></svg>
      </div>
      <div class="font-semibold text-coligo-deep text-sm">Aucun colis retiré pour le moment</div>
      <div class="text-xs text-slate-500 mt-1">Les colis apparaîtront ici dès leur passage au statut Retiré.</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = lignes.map(r => {
    const c = r.colis || {};
    const retirePar = r.mandataire_nom ? `${esc(r.mandataire_nom)} (mandataire)` : `${esc(c.destinataire_nom) || '—'} (destinataire)`;
    const cni = r.mandataire_cni || r.destinataire_cni || '—';
    const jours = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    const restants = Math.max(dureeConservationRetires - jours, 0);
    const pct = Math.min(100, Math.round(jours / Math.max(dureeConservationRetires, 1) * 100));
    return `
      <tr class="hover:bg-slate-50">
        <td class="py-3 pr-3 whitespace-nowrap">${fmtDateTime(r.created_at)}</td>
        <td class="py-3 pr-3 font-medium whitespace-nowrap">${esc(c.numero_suivi) || '—'}</td>
        <td class="py-3 pr-3">${esc(c.destinataire_nom) || '—'}<div class="text-xs text-slate-500">${esc(c.destinataire_telephone) || '—'}</div></td>
        <td class="py-3 pr-3">${retirePar}${r.mandataire_telephone ? `<div class="text-xs text-slate-500">${esc(r.mandataire_telephone)}</div>` : ''}</td>
        <td class="py-3 pr-3 whitespace-nowrap">${esc(cni)}</td>
        <td class="py-3 pr-3 text-slate-600 max-w-[200px]">${esc(c.Description_du_colis) || '—'}</td>
        <td class="py-3 pr-3 whitespace-nowrap">${fcfa(c.montant_paye)}</td>
        <td class="py-3 pr-3 whitespace-nowrap text-xs">
          ${restants > 0 ? `dans <strong>${restants} j</strong>` : '<strong>au prochain passage</strong>'}
          <div class="h-1 w-20 rounded-full bg-slate-200 mt-1 overflow-hidden"><div class="h-full rounded-full ${restants <= 30 ? 'bg-amber-500' : 'bg-coligo'}" style="width:${pct}%"></div></div>
        </td>
        <td class="py-3 whitespace-nowrap">
          <button class="btn-suppr-retrait text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50 transition"
                  data-id="${esc(String(c.id))}" data-num="${esc(c.numero_suivi)}">Supprimer</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-suppr-retrait').forEach(b =>
    b.addEventListener('click', () => demanderSuppressionRetrait(b.dataset.id, b.dataset.num)));
}

// ---------- Suppression manuelle d'un colis retiré (agent retrait) ----------

function demanderSuppressionRetrait(colisId, numero) {
  let fond = document.getElementById('modal-suppr-retrait');
  if (fond) fond.remove();
  fond = document.createElement('div');
  fond.id = 'modal-suppr-retrait';
  fond.className = 'fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4';
  fond.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="sr-titre">
      <h3 id="sr-titre" class="font-semibold text-lg text-coligo-deep mb-1">Supprimer le colis ${esc(numero)}</h3>
      <p class="text-sm text-slate-600 mb-4">Ce dossier est clos (colis retiré). Le colis, son historique et sa fiche de retrait
        seront <strong>définitivement supprimés</strong>. Ses chiffres restent comptés dans les rapports.</p>
      <label class="block text-sm font-medium text-slate-700 mb-1" for="sr-motif">Motif (obligatoire, conservé dans le journal)</label>
      <input id="sr-motif" type="text" class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-coligo/40"
             placeholder="Ex. : dossier clos, archivé sur papier">
      <label class="block text-sm font-medium text-slate-700 mb-1" for="sr-mdp">Votre mot de passe</label>
      <input id="sr-mdp" type="password" autocomplete="current-password" class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-coligo/40">
      <div id="sr-msg" class="mb-3"></div>
      <div class="flex gap-3">
        <button id="sr-annuler" class="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50">Annuler</button>
        <button id="sr-ok" class="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">Supprimer définitivement</button>
      </div>
    </div>`;
  document.body.appendChild(fond);
  const fermer = () => fond.remove();
  fond.addEventListener('click', e => { if (e.target === fond) fermer(); });
  document.getElementById('sr-annuler').addEventListener('click', fermer);
  setTimeout(() => document.getElementById('sr-motif').focus(), 30);

  document.getElementById('sr-ok').addEventListener('click', async () => {
    const btn = document.getElementById('sr-ok');
    const motif = document.getElementById('sr-motif').value.trim();
    const mdp = document.getElementById('sr-mdp').value;
    const zone = document.getElementById('sr-msg');
    zone.innerHTML = '';
    if (motif.length < 5) { zone.innerHTML = msgError('Indiquez un motif (5 caractères minimum).'); return; }
    if (!mdp) { zone.innerHTML = msgError('Saisissez votre mot de passe.'); return; }
    setBtnLoading(btn, 'Suppression…');
    const agent = getSession();
    const { data, error } = await supabaseClient.rpc('retrait_supprimer_colis', {
      p_username: agent.username, p_password: mdp, p_colis_id: String(colisId), p_motif: motif
    });
    clearBtnLoading(btn);
    if (error) { zone.innerHTML = msgError("Suppression impossible. La migration sql/liste_retraits_migration.sql a-t-elle été exécutée ?"); return; }
    if (!data || !data.ok) { zone.innerHTML = msgError((data && data.message) || 'Suppression refusée.'); return; }
    fermer();
    const info = document.getElementById('historique-info');
    if (info) info.innerHTML = msgSuccess(`Colis <strong>${esc(numero)}</strong> supprimé définitivement.`);
    chargerHistorique();
  });
}

document.getElementById('btn-refresh-historique').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-historique');
  setBtnLoading(btn, 'Actualisation…');
  await chargerHistorique();
  clearBtnLoading(btn);
});

// ---------- Initialisation ----------


const existing = getSession();
if (existing && enforceRole(existing, 'agent')) {
  marquerPresence(existing.id, true);
  showDashboard(existing);
} else if (!existing) {
  showLogin();
}
