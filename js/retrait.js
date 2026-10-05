// ==========================================================
// COLIGO — retrait.html — Service de retrait
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
// ---------- Regroupement par mois ----------
function moisCle(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '0000-00' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function moisLibelle(cle) {
  if (cle === '0000-00') return 'Date inconnue';
  const [a, m] = cle.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// Lignes triées du plus récent au plus ancien -> HTML avec un bandeau par mois.
function htmlParMois(lignes, dateDe, colspan, ligneHtml, unite) {
  let out = '', courant = null, nb = {};
  lignes.forEach(l => { const k = moisCle(dateDe(l)); nb[k] = (nb[k] || 0) + 1; });
  lignes.forEach(l => {
    const k = moisCle(dateDe(l));
    if (k !== courant) {
      courant = k;
      out += `<tr class="bg-slate-100"><td colspan="${colspan}" class="py-2 px-3 font-semibold text-coligo-deep text-sm">${esc(moisLibelle(k))} <span class="font-normal text-slate-500">— ${nb[k]} ${unite}${nb[k] > 1 ? 's' : ''}</span></td></tr>`;
    }
    out += ligneHtml(l);
  });
  return out;
}
// Récupère TOUTES les lignes (Supabase plafonne chaque requête à 1000).
async function toutCharger(construire) {
  const PAS = 1000; let tout = [];
  for (let debut = 0; ; debut += PAS) {
    const { data, error } = await construire().range(debut, debut + PAS - 1);
    if (error) return { data: null, error };
    tout = tout.concat(data || []);
    if (!data || data.length < PAS) break;
  }
  return { data: tout, error: null };
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

  show('dashboard');
  chargerHistorique();
  chargerListingsRecus();
  document.getElementById('header-agence').textContent = 'Agence de ' + agent.agence;
  document.getElementById('apercu-agent').textContent = 'Connecté : ' + agent.nom_complet;
  if (typeof demarrerMeteo === 'function') demarrerMeteo();
  demarrerTempsReel(agent);
  if (typeof initMessagerie === 'function') initMessagerie();
  // Nettoyage silencieux des retraits vieux de plus d'1 an (voir
  // sql/nettoyage_retraits_1an.sql). Aucun message affiché : c'est de
  // la maintenance de fond, pas une action de l'agent.
  supabaseClient.rpc('nettoyer_retraits_expires').then(({ error }) => {
    if (!error) chargerHistorique();
  });
  // Coupe la session si un administrateur désactive ce compte.
  surveillerCompteActif();
}

// ---------- Navigation latérale ----------
// Vues atteignables d'un seul clic depuis le rail : Tableau de bord (vue par
// défaut), retrait de colis, historique des colis retirés, listings reçus
// et messagerie.

function show(vue) {
  ['dashboard', 'retrait-colis', 'retraits', 'listings', 'messagerie'].forEach(v => {
    document.getElementById('section-' + v).classList.toggle('hidden', v !== vue);
  });
  document.querySelectorAll('.rail-item[data-nav]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.nav === vue);
  });
  // Chaque menu affiche son propre titre en tête de page.
  const titres = {
    'dashboard': ['Tableau de bord', 'aperçu de la journée, météo et recherche d\'un colis.'],
    'retrait-colis': ['Retrait de colis', 'réceptionnez un listing, puis remettez les colis à leurs destinataires.'],
    'retraits': ['Historique des colis retirés', 'tous les retraits de votre agence depuis le début, regroupés par mois (supprimés après 1 an).'],
    'listings': ['Historique des listings reçus', 'tous les listings envoyés vers votre agence.'],
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
    document.getElementById('dash-recherche-input').value = '';
    document.getElementById('dash-recherche-erreur').innerHTML = '';
    fermerRecuModal();
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
      // Si le colis affiché à l'écran vient de changer, on rafraîchit son affichage.
      if (colisTrouve && payload.new && payload.new.id === colisTrouve.id) {
        colisTrouve = payload.new;
        afficherColis(colisTrouve);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', }, () => {
      chargerListingsRecus();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'retraits', filter: `agence=eq.${agent.agence}` }, () => {
      // Signal direct en plus du signal indirect via "colis" ci-dessus :
      // couvre le cas où un autre agent de la même agence traite un retrait.
      chargerHistorique();
    })
    .subscribe();
}

// ---------- Tableau de bord : recherche d'un colis par numéro de suivi ----------
// Affiche le reçu du colis dans une fenêtre qui se referme à la main
// (bouton « Fermer », croix, clic à côté ou touche Échap).

function fermerRecuModal() {
  const m = document.getElementById('recu-modal');
  if (!m) return;
  m.classList.add('hidden');
  document.getElementById('recu-modal-corps').innerHTML = '';
}

function ouvrirRecuModal(c) {
  document.getElementById('recu-modal-titre').textContent = 'Reçu du colis ' + (c.numero_suivi || '');
  const corps = document.getElementById('recu-modal-corps');
  corps.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.title = 'Reçu du colis';
  iframe.style.cssText = 'width:100%; border:0; display:block; height:600px;';
  corps.appendChild(iframe);
  document.getElementById('recu-modal').classList.remove('hidden');

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${RECU_CSS}
    body { background:#f8fafc; padding:12px 0; margin:0; }
    .recu { box-shadow:0 2px 10px rgba(0,0,0,0.08); margin:0 auto 14px; }
    @media (min-width: 700px) { body { display:flex; gap:14px; justify-content:center; align-items:flex-start; } .recu { margin:0; } }
    </style></head><body>${recuCompletHtml(c)}</body></html>`);
  doc.close();
  const ajuster = () => {
    try {
      const bas = Math.max(0, ...Array.from(doc.querySelectorAll('.recu')).map(r => r.getBoundingClientRect().bottom));
      if (bas) iframe.style.height = Math.ceil(bas + 16) + 'px';
    } catch (e) { /* silencieux */ }
  };
  setTimeout(ajuster, 60); setTimeout(ajuster, 400);
  iframe.contentWindow.addEventListener('resize', ajuster);
}

async function rechercherColisDashboard() {
  const btn = document.getElementById('dash-btn-rechercher');
  const errZone = document.getElementById('dash-recherche-erreur');
  const q = document.getElementById('dash-recherche-input').value.trim();
  errZone.innerHTML = '';
  if (!q) { errZone.innerHTML = msgError('Entrez le numéro de suivi du colis.'); return; }

  setBtnLoading(btn, 'Recherche…');
  // Correspondance exacte (insensible à la casse) : on neutralise les jokers ilike.
  const exact = q.replace(/[\\%_]/g, m => '\\' + m);
  const { data, error } = await supabaseClient.from('colis').select('*').ilike('numero_suivi', exact).limit(5);
  clearBtnLoading(btn);

  if (error) { errZone.innerHTML = msgError('Service momentanément indisponible. Réessayez.'); return; }
  if (!data || !data.length) { errZone.innerHTML = msgError('Aucun colis trouvé avec ce numéro de suivi.'); return; }

  // Un agent ne consulte que les colis qui partent de son agence ou qui y arrivent.
  const agent = getSession();
  const ville = normalizeCity(agent.agence);
  const colis = data.find(c => normalizeCity(c.ville_arrivee) === ville || normalizeCity(c.ville_depart) === ville || normalizeCity(c.agence) === ville);
  if (!colis) {
    errZone.innerHTML = msgWarn(`Le colis ${data[0].numero_suivi} ne concerne pas votre agence (${agent.agence}).`);
    return;
  }
  ouvrirRecuModal(colis);
}

document.getElementById('dash-btn-rechercher').addEventListener('click', rechercherColisDashboard);
document.getElementById('dash-recherche-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') rechercherColisDashboard(); });
document.getElementById('recu-modal-x').addEventListener('click', fermerRecuModal);
document.getElementById('recu-modal-fermer').addEventListener('click', fermerRecuModal);
document.getElementById('recu-modal').addEventListener('click', (e) => { if (e.target.id === 'recu-modal') fermerRecuModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerRecuModal(); });

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
    zone.innerHTML = msgWarn('Les colis de ce listing sont déjà tous « Disponible » (ou dans un autre état).');
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

  // Le listing est désormais « reçu » : c'est ce qui le fait entrer dans l'historique des listings reçus.
  await supabaseClient.from('listings')
    .update({ recu_le: new Date().toISOString(), recu_par: agent.username })
    .eq('id', listing.id);

  clearBtnLoading(btn);
  zone.innerHTML = msgSuccess(`${idsATraiter.length} colis du listing <strong>${esc(listing.numero_listing)}</strong> sont maintenant « Disponible ».`);
  document.getElementById('listing-input').value = '';
  chargerListingsRecus();
});

// ---------- Historique des colis reçus (listings), réimpression sans changement de statut ----------

async function chargerListingsRecus() {
  const agent = getSession();
  const zone = document.getElementById('listings-recus-body');

  const { data, error } = await supabaseClient
    .from('listings')
    .select('*')
    .neq('agence', agent.agence)
    .not('recu_le', 'is', null)
    .order('recu_le', { ascending: false })
    .limit(200);

  if (error) {
    zone.innerHTML = '<div class="lg-vide" style="color:#dc2626">Impossible de charger l\'historique. Vérifiez que sql/listings_recus_migration.sql a été exécuté dans Supabase.</div>';
    return;
  }
  // Regroupés par date de réception, avec l'identifiant de l'agent qui les a reçus et tous les colis.
  await afficherListingsGroupes(zone, data || [], {
    champDate: 'recu_le', champAgent: 'recu_par',
    verbeAgent: 'Reçu par', verbeHeure: 'reçu à',
    montrerOrigine: true,
    messageVide: 'Aucun listing reçu pour le moment.'
  });
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
        ${msgWarn(`Ce colis n'est pas encore disponible pour retrait (statut actuel : ${normalizeStatut(c.statut)}). Le retrait ne peut être enregistré qu'une fois le colis « Disponible ».`)}
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
    zone.innerHTML = msgError('Le colis n\'a pas pu être marqué « Retiré ». Réessayez.');
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

async function chargerHistorique() {
  const agent = getSession();
  const tbody = document.getElementById('historique-body');

  const { data, error } = await toutCharger(() => supabaseClient
    .from('retraits')
    .select('*, colis(*)')
    .eq('agence', agent.agence)
    .order('created_at', { ascending: false }));

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-red-600 text-sm">
      Impossible de charger l'historique. Si c'est la première utilisation, exécutez sql/retraits_migration.sql dans Supabase (SQL Editor), puis actualisez.
    </td></tr>`;
    return;
  }

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-500">Aucun retrait enregistré pour le moment.</td></tr>';
    return;
  }

  tbody.innerHTML = htmlParMois(data, r => r.created_at, 7, r => {
    const c = r.colis || {};
    const retirePar = r.mandataire_nom ? `${esc(r.mandataire_nom)} (mandataire)` : `${esc(c.destinataire_nom) || '—'} (destinataire)`;
    const cni = r.mandataire_cni || r.destinataire_cni || '—';
    return `
      <tr class="hover:bg-slate-50">
        <td class="py-3 pr-3 whitespace-nowrap">${fmtDateTime(r.created_at)}</td>
        <td class="py-3 pr-3 font-medium whitespace-nowrap">${esc(c.numero_suivi) || '—'}</td>
        <td class="py-3 pr-3">${esc(c.destinataire_nom) || '—'}<div class="text-xs text-slate-500">${esc(c.destinataire_telephone) || '—'}</div></td>
        <td class="py-3 pr-3">${retirePar}${r.mandataire_telephone ? `<div class="text-xs text-slate-500">${esc(r.mandataire_telephone)}</div>` : ''}</td>
        <td class="py-3 pr-3 whitespace-nowrap">${esc(cni)}</td>
        <td class="py-3 pr-3 text-slate-600 max-w-[200px]">${esc(c.Description_du_colis) || '—'}</td>
        <td class="py-3 whitespace-nowrap">${fcfa(c.montant_paye)}</td>
      </tr>`;
  }, 'colis retiré');
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
