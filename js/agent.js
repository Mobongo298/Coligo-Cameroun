// ==========================================================
// COLIGO — agent.html — logique complète
// Tables réelles : colis, colis_historique, agents
// ==========================================================

const LATE_DAYS = 3; // seuil "retard" : non livré depuis plus de X jours

function formatFCFA(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA'; }
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
function daysSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0; }
function esc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function badge(s) {
  const st = normalizeStatut(s);
  const c = statutColors(st);
  return `<span class="text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-semibold" style="background:${c.bg}; color:${c.text}">${esc(st)}</span>`;
}
function initials(nom) {
  return (nom || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ---------- Session ----------

function getSession() {
  const raw = sessionStorage.getItem('coligo_agent_session');
  return raw ? JSON.parse(raw) : null;
}
function setSession(agent) { sessionStorage.setItem('coligo_agent_session', JSON.stringify(agent)); }
function clearSession() { sessionStorage.removeItem('coligo_agent_session'); }

// villeArriveePour() vient maintenant de js/receipt.js (chargé avant ce fichier).

function showDashboard(agent) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');

  document.getElementById('agent-nom').textContent = agent.nom_complet;
  document.getElementById('agent-agence').textContent = 'Agence de ' + agent.agence;
  document.getElementById('agent-initials').textContent = initials(agent.nom_complet);
  document.getElementById('header-agence').textContent = 'Agence de ' + agent.agence;
  document.getElementById('apercu-agent').textContent = 'Connecté : ' + agent.nom_complet;

  // Départ = l'agence de l'agent, arrivée = l'autre agence. Plus de saisie manuelle.
  document.getElementById('f-depart-affichage').textContent = agent.agence;
  document.getElementById('f-arrivee-affichage').textContent = villeArriveePour(agent.agence);

  loadColisList();
  loadListingsPendants();
  demarrerTempsReel(agent);
  if (typeof initMessagerie === 'function') initMessagerie();
  if (typeof demarrerMeteo === 'function') demarrerMeteo();
  // Coupe la session si un administrateur désactive ce compte.
  surveillerCompteActif();
}

// ---------- Temps réel ----------

let realtimeChannel = null;

function demarrerTempsReel(agent) {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel('agent-' + agent.username)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis', filter: `agence=eq.${agent.agence}` }, () => {
      loadColisList();
      loadListingsPendants();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', filter: `agence=eq.${agent.agence}` }, () => {
      if (document.getElementById('view-listings').classList.contains('active')) loadHistoriqueListings();
    })
    .subscribe();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
}

// ---------- Navigation ----------

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  // Revenir au menu « Colis enregistrés » affiche toujours la liste.
  if (id === 'suivi') {
    document.getElementById('suivi-detail').classList.add('hidden');
    document.getElementById('suivi-liste').classList.remove('hidden');
  }

  document.querySelectorAll('.rail-item[data-nav]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.nav === id);
  });

  if (window.innerWidth < 1024) {
    const rail = document.getElementById('sidebar');
    rail.classList.add('hidden');
    rail.classList.remove('flex');
  }
  window.scrollTo(0, 0);
}

function toggleMenu() {
  const rail = document.getElementById('sidebar');
  const ouvrir = rail.classList.contains('hidden');
  rail.classList.toggle('hidden', !ouvrir);
  rail.classList.toggle('flex', ouvrir);
}

// ---------- Connexion ----------

document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorZone = document.getElementById('login-error');
  errorZone.innerHTML = '';

  if (!username || !password) {
    errorZone.innerHTML = msgError("Renseignez l'identifiant et le mot de passe.");
    return;
  }

  setBtnLoading(btn, 'Connexion…');

  const { data, error } = await supabaseClient.rpc('agent_login', {
    p_username: username, p_password: password
  });

  clearBtnLoading(btn);

  if (error) { errorZone.innerHTML = msgError('Impossible de contacter la base de données.'); return; }
  if (!data || !data.ok) { errorZone.innerHTML = msgError((data && data.message) || 'Identifiant ou mot de passe incorrect.'); return; }
  const agent = data.agent;

  // Un compte administrateur est redirigé vers son propre espace.
  if (!enforceRole(agent, 'agent')) return;

  setSession(agent);
  marquerPresence(agent.id, true);
  showDashboard(agent);
});

document.getElementById('btn-logout').addEventListener('click', () => {
  const btn = document.getElementById('btn-logout');
  setBtnLoading(btn, 'Déconnexion…');
  const agentActuel = getSession();
  setTimeout(async () => {
    if (agentActuel) await marquerPresence(agentActuel.id, false);
    clearBtnLoading(btn);
    if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
    if (typeof msgChannel !== 'undefined' && msgChannel) { supabaseClient.removeChannel(msgChannel); msgChannel = null; }
    // Efface toute trace de connexion : rien n'est conservé, il faudra
    // ressaisir identifiant et mot de passe pour se reconnecter.
    sessionStorage.clear();
    localStorage.removeItem('coligo_agent_session');
    localStorage.removeItem('coligo_admin_session');
    colisCache = [];
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').innerHTML = '';
    showLogin();
  }, 250);
});

function msgError(text) {
  return `<div class="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">${esc(text)}</div>`;
}
function msgSuccess(html) {
  return `<div class="msg-confirmation rounded-lg px-4 py-3 text-sm">${html}</div>`;
}

// ---------- Valeur déclarée (10 × le montant payé) ----------

document.getElementById('f-montant').addEventListener('input', (e) => {
  const montant = parseFloat(e.target.value) || 0;
  document.getElementById('valeur-preview-amount').textContent = formatFCFA(montant * 10);
});

// ---------- Génération du numéro de suivi ----------

async function genererNumero(agence) {
  const yy = String(new Date().getFullYear()).slice(-2);
  const code = agenceCode(agence);
  // La séquence repart de 1 pour chaque agence (DLA et YDE ont chacune leur propre numérotation).
  // On prend le plus grand des deux : nombre de colis + 1, ou dernier numéro
  // utilisé + 1. Depuis que le cycle de vie supprime les anciens colis
  // retirés, compter seul ferait retomber la séquence sur un numéro déjà
  // attribué (doublon).
  const [{ count }, { data: dernier }] = await Promise.all([
    supabaseClient.from('colis').select('*', { count: 'exact', head: true }).eq('agence', agence),
    supabaseClient.from('colis').select('numero_suivi').like('numero_suivi', code + '%')
      .order('numero_suivi', { ascending: false }).limit(1)
  ]);
  const m = dernier && dernier[0] && String(dernier[0].numero_suivi).match(/^[A-Z]+(\d+)/);
  const suivant = Math.max((count || 0) + 1, m ? parseInt(m[1], 10) + 1 : 1);
  const seq = String(suivant).padStart(6, '0');
  return `${code}${seq}/${yy}`;
}

// ---------- Enregistrement d'un colis ----------

document.getElementById('btn-create').addEventListener('click', async () => {
  const agent = getSession();
  const btn = document.getElementById('btn-create');
  const errorZone = document.getElementById('new-error');
  const successZone = document.getElementById('new-success');
  errorZone.innerHTML = '';
  successZone.innerHTML = '';

  const expediteur = document.getElementById('f-expediteur').value.trim();
  const expediteurTel = document.getElementById('f-expediteur-tel').value.trim();
  const destinataire = document.getElementById('f-destinataire').value.trim();
  const destinataireTel = document.getElementById('f-destinataire-tel').value.trim();
  const depart = agent.agence;
  const arrivee = villeArriveePour(agent.agence);
  const description = document.getElementById('description').value.trim();
  const montant = parseFloat(document.getElementById('f-montant').value);

  if (!expediteur || !destinataire || !description || isNaN(montant) || montant < 0) {
    errorZone.innerHTML = msgError("Complétez le nom de l'expéditeur, celui du destinataire, la description et un montant valide.");
    return;
  }

  if (!['yaounde', 'douala'].includes(normalizeCity(agent.agence))) {
    errorZone.innerHTML = msgError(
      `Votre compte n'a pas d'agence reconnue (valeur actuelle : "${agent.agence || 'vide'}"). ` +
      `Un administrateur doit corriger votre agence (Yaoundé ou Douala) dans Supabase avant que vous puissiez enregistrer des colis.`
    );
    return;
  }

  setBtnLoading(btn, 'Enregistrement…');

  const numero = await genererNumero(agent.agence);
  const valeur = montant * 10;

  const { data: colis, error } = await supabaseClient
    .from('colis')
    .insert({
      numero_suivi: numero,
      expediteur_nom: expediteur,
      expediteur_telephone: expediteurTel,
      destinataire_nom: destinataire,
      destinataire_telephone: destinataireTel,
      ville_depart: depart,
      ville_arrivee: arrivee,
      Description_du_colis: description,
      montant_paye: montant,
      valeur: valeur,
      statut: 'Enregistré',
      agence: agent.agence,
      cree_par: agent.username
    })
    .select()
    .single();

  if (error) {
    clearBtnLoading(btn);
    errorZone.innerHTML = msgError("Erreur lors de l'enregistrement. Réessayez.");
    return;
  }

  await supabaseClient.from('colis_historique').insert({
    colis_id: colis.id,
    statut: 'Enregistré',
    agent: agent.username
  });

  clearBtnLoading(btn);

  successZone.innerHTML = msgSuccess(
    `Colis enregistré. Numéro de suivi : <strong>${esc(numero)}</strong> — Valeur déclarée : ${formatFCFA(valeur)}<br>
     <span class="text-xs">Impression du reçu en double lancée automatiquement.</span>
     <button id="btn-reprint" class="mt-2 block underline text-xs">Relancer l'impression</button>`
  );

  // Impression automatique du reçu en double (exemplaire client + agence),
  // au format 80 mm pour imprimante thermique.
  imprimerRecu(colis);
  document.getElementById('btn-reprint').addEventListener('click', () => imprimerRecu(colis));

  ['f-expediteur', 'f-destinataire', 'f-montant', 'description'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-expediteur-tel').value = '+237 ';
  document.getElementById('f-destinataire-tel').value = '+237 ';
  document.getElementById('valeur-preview-amount').textContent = '0 FCFA';

  loadColisList();
});

// ---------- Chargement des colis de l'agence ----------

let colisCache = [];

async function loadColisList() {
  const agent = getSession();

  // Les colis "Retiré" ne font plus partie de la liste de travail : ils
  // sortent automatiquement dès le retrait et ne vivent plus que dans
  // l'historique des retraits (espace Retraits).
  const { data, error } = await supabaseClient
    .from('colis')
    .select('*')
    .eq('agence', agent.agence)
    .neq('statut', 'Retiré')
    .order('created_at', { ascending: false });

  if (error) return;

  colisCache = data || [];
  renderStats();
  chargerRegistre();
  rafraichirDetailOuvert();
}

// ---------- Listings (BG et colis enregistrés) ----------
// Affichés dans le menu « Colis enregistrés depuis votre agence ».
// Restent affichés jusqu'à leur impression : l'impression fait passer
// tous les colis concernés à "En transit", donc ils sortent de cette
// liste toute seuls (elle ne montre que ceux encore "Enregistré").

let bgEnAttente = [];
let bulkEnAttente = [];

function ligneListingHtml(c) {
  return `<tr class="hover:bg-slate-50 cursor-pointer" onclick="voirColis('${c.id}')" title="Voir le reçu">
    <td class="py-2 pr-3 font-medium whitespace-nowrap">${esc(c.numero_suivi)}</td>
    <td class="py-2 pr-3">${esc(c.destinataire_nom)}</td>
    <td class="py-2 text-slate-600">${esc(c.Description_du_colis) || '—'}</td>
  </tr>`;
}

async function loadListingsPendants() {
  const agent = getSession();
  const { data, error } = await supabaseClient
    .from('colis')
    .select('*')
    .eq('agence', agent.agence)
    .eq('statut', 'Enregistré')
    .order('created_at', { ascending: true });

  if (error) return;
  const enAttente = data || [];

  bgEnAttente = enAttente.filter(c => estColisBG(c.Description_du_colis));
  bulkEnAttente = enAttente.filter(c => !estColisBG(c.Description_du_colis));

  document.getElementById('table-bg').innerHTML = bgEnAttente.length
    ? bgEnAttente.map(ligneListingHtml).join('')
    : '<tr><td colspan="3" class="py-4 text-center text-slate-500 text-sm">Aucune bouteille de gaz en attente.</td></tr>';
  document.getElementById('btn-print-bg').disabled = !bgEnAttente.length;

  document.getElementById('table-bulk').innerHTML = bulkEnAttente.length
    ? bulkEnAttente.map(ligneListingHtml).join('')
    : '<tr><td colspan="3" class="py-4 text-center text-slate-500 text-sm">Aucun colis en attente d\'impression.</td></tr>';
  document.getElementById('btn-print-bulk').disabled = !bulkEnAttente.length;
}

async function imprimerEtBasculerListing(colisListe, type, titre, btn) {
  if (!colisListe.length) return;
  const agent = getSession();
  setBtnLoading(btn, 'Préparation…');

  // Jusqu'à 5 essais : si deux agents impriment en même temps, un numéro déjà pris
  // (erreur 23505) est simplement regénéré au lieu de bloquer l'impression.
  let listing = null, errListing = null;
  for (let essai = 0; essai < 5; essai++) {
    const numero = await genererNumeroListing(agent.agence);
    const r = await supabaseClient
      .from('listings')
      .insert({ numero_listing: numero, agence: agent.agence, type, agent: agent.username })
      .select().single();
    listing = r.data; errListing = r.error;
    if (!errListing || errListing.code !== '23505') break;
  }

  if (errListing) {
    clearBtnLoading(btn);
    alert("Impossible de créer le listing : " + (errListing.message || 'erreur inconnue') +
      "\n\nVérifiez que sql/listings_migration.sql et sql/listings_numerotation_fix.sql ont bien été exécutés dans Supabase.");
    return;
  }

  const ids = colisListe.map(c => c.id);
  const { error: errUpdate } = await supabaseClient
    .from('colis')
    .update({ statut: 'En transit', listing_id: listing.id, updated_at: new Date().toISOString() })
    .in('id', ids);

  if (errUpdate) {
    clearBtnLoading(btn);
    alert("Le listing a été créé, mais la mise à jour des colis a échoué : " + (errUpdate.message || 'erreur inconnue'));
    return;
  }

  await supabaseClient.from('colis_historique').insert(
    ids.map(id => ({ colis_id: id, statut: 'En transit', agent: agent.username }))
  );

  clearBtnLoading(btn);
  imprimerListing(listing, colisListe, titre);
  // On ne dépend pas uniquement du temps réel pour rafraîchir sa propre
  // session : on recharge tout de suite tout ce qui vient de changer.
  await loadColisList();
  await loadListingsPendants();
}

document.getElementById('btn-print-bg').addEventListener('click', (e) => {
  imprimerEtBasculerListing(bgEnAttente, 'bg', 'Listing — Bouteilles de gaz', e.currentTarget);
});
document.getElementById('btn-print-bulk').addEventListener('click', (e) => {
  imprimerEtBasculerListing(bulkEnAttente, 'bulk', 'Listing — Colis groupés', e.currentTarget);
});

// ---------- Historique des listings (consultation + réimpression, sans changement de statut) ----------

function afficherHistoriqueListings() {
  show('listings');
  loadHistoriqueListings();
}

async function loadHistoriqueListings() {
  const agent = getSession();
  const zone = document.getElementById('table-listings');
  if (!agent || !zone) return;

  // 1) Listings dont l'agence est celle de l'agent.
  const rAgence = await supabaseClient
    .from('listings')
    .select('*')
    .eq('agence', agent.agence)
    .order('created_at', { ascending: false })
    .limit(200);

  if (rAgence.error) {
    console.error('Historique des listings :', rAgence.error);
    zone.innerHTML = '<div class="lg-vide" style="color:#dc2626">Impossible de charger l\'historique des listings : '
      + esc(rAgence.error.message || 'erreur inconnue') + '</div>';
    return;
  }
  const parId = new Map((rAgence.data || []).map(l => [l.id, l]));

  // 2) Listings rattachés aux colis de l'agence. Le texte « agence » des colis est fiable
  //    (c'est lui qui sert partout ailleurs) : cela retrouve aussi les listings créés avec
  //    une ancienne graphie de l'agence, qui n'apparaissaient donc pas dans l'historique.
  const idsColis = new Set();
  for (let debut = 0; ; debut += 1000) {
    const r = await supabaseClient.from('colis').select('listing_id')
      .eq('agence', agent.agence).not('listing_id', 'is', null).range(debut, debut + 999);
    if (r.error) break;
    (r.data || []).forEach(c => idsColis.add(c.listing_id));
    if (!r.data || r.data.length < 1000) break;
  }
  const manquants = [...idsColis].filter(id => !parId.has(id));
  for (let i = 0; i < manquants.length; i += 100) {
    const r = await supabaseClient.from('listings').select('*').in('id', manquants.slice(i, i + 100));
    if (!r.error) (r.data || []).forEach(l => parId.set(l.id, l));
  }

  const listings = [...parId.values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 200);

  // Regroupés par date d'impression, avec l'identifiant de l'agent qui a imprimé et tous les colis.
  histOpts = {
    champDate: 'created_at', champAgent: 'agent',
    verbeAgent: 'Imprimé par', verbeHeure: 'imprimé à',
    montrerOrigine: false,
    messageVide: 'Aucun listing imprimé pour le moment.'
  };
  histListings = listings;
  const r = await afficherListingsGroupes(zone, listings, { ...histOpts, filtre: document.getElementById('search-listings').value });
  histParListing = r ? r.parListing : null;
}

// Recherche dans l'historique : numéro de suivi, téléphone du destinataire ou de l'expéditeur.
let histListings = [], histParListing = null, histOpts = null;

function appliquerRechercheListings() {
  const champ = document.getElementById('search-listings');
  document.getElementById('btn-clear-search-listings').classList.toggle('hidden', !champ.value);
  const zone = document.getElementById('table-listings');
  if (!histParListing || !histOpts) return; // pas encore chargé : le chargement applique le filtre
  lgRendre(zone, histListings, histParListing, { ...histOpts, filtre: champ.value });
}
document.getElementById('search-listings').addEventListener('input', appliquerRechercheListings);
document.getElementById('btn-clear-search-listings').addEventListener('click', () => {
  const champ = document.getElementById('search-listings');
  champ.value = '';
  appliquerRechercheListings();
  champ.focus();
});

async function reimprimerListing(listingId) {
  const { data: listing, error: e1 } = await supabaseClient.from('listings').select('*').eq('id', listingId).maybeSingle();
  const { data: colisListe, error: e2 } = await supabaseClient.from('colis').select('*').eq('listing_id', listingId);
  if (e1 || e2 || !listing) { alert('Impossible de récupérer ce listing.'); return; }
  // Réimpression uniquement : aucune mise à jour de statut ici.
  imprimerListing(listing, colisListe || [], listing.type === 'bg' ? 'Listing — Bouteilles de gaz' : 'Listing — Colis groupés');
}

function renderStats() {
  const agent = getSession();
  const mesColisAujourdhui = colisCache.filter(c => c.cree_par === agent.username && isToday(c.created_at)).length;
  const enAttente = colisCache.filter(c => normalizeStatut(c.statut) === 'Enregistré').length;
  const aLivrer = colisCache.filter(c => normalizeStatut(c.statut) === 'Disponible').length;

  document.getElementById('stat-today').textContent = mesColisAujourdhui;
  document.getElementById('stat-attente').textContent = enAttente;
  document.getElementById('stat-alivrer').textContent = aLivrer;
}

// Registre complet : contrairement à colisCache (qui exclut les colis
// retirés), on interroge ici TOUS les colis jamais enregistrés par vous,
// quel que soit leur statut actuel — c'est un historique, pas une liste de travail.
async function chargerRegistre() {
  const agent = getSession();
  const zone = document.getElementById('registre-list');

  const { data, error } = await supabaseClient
    .from('colis')
    .select('*')
    .eq('cree_par', agent.username)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    zone.innerHTML = '<p class="py-4 text-sm text-red-600">Impossible de charger le registre.</p>';
    return;
  }
  if (!data || !data.length) {
    zone.innerHTML = '<p class="py-4 text-sm text-slate-500">Vous n\'avez encore enregistré aucun colis.</p>';
    return;
  }

  const parJour = {};
  data.forEach(c => {
    const jour = new Date(c.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!parJour[jour]) parJour[jour] = [];
    parJour[jour].push(c);
  });

  zone.innerHTML = Object.entries(parJour).map(([jour, liste]) => `
    <div>
      <div class="text-xs font-semibold text-coligo uppercase tracking-wide mb-2">${esc(jour)} — ${liste.length} colis</div>
      <ul class="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
        ${liste.map(c => `
          <li class="py-3 px-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-medium">${esc(c.numero_suivi)}</div>
              <div class="text-xs text-slate-500 truncate">${esc(c.expediteur_nom)} → ${esc(c.destinataire_nom)} · ${formatDateTime(c.created_at)}</div>
            </div>
            ${badge(c.statut)}
          </li>`).join('')}
      </ul>
    </div>`).join('');
}

// ---------- Modale : voir un colis ----------

function closeModal() { document.getElementById('modal-backdrop').classList.add('hidden'); }
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

// ---------- Détail d'un colis : statut, informations, puis son reçu ----------
// Le détail remplace la liste dans la même page ; « Fermer » ramène à la
// liste, à la même position de défilement.

let suiviScrollY = 0;
let detailOuvert = null; // { id, statut } du colis affiché

// Temps réel : si le statut du colis affiché change, le détail est mis à jour.
// S'il n'est plus dans la liste (retiré), on revient à la liste.
function rafraichirDetailOuvert() {
  if (!detailOuvert || document.getElementById('suivi-detail').classList.contains('hidden')) return;
  const c = colisCache.find(x => String(x.id) === String(detailOuvert.id));
  if (!c) { fermerDetailColis(); return; }
  if (normalizeStatut(c.statut) !== detailOuvert.statut) voirColis(c.id);
}

// Nombre de corrections déjà faites sur ce colis (une seule est autorisée).
async function corrections_deja_faites(id) {
  const { count, error } = await supabaseClient
    .from('colis_modifications')
    .select('*', { count: 'exact', head: true })
    .eq('colis_id', String(id));
  // En cas d'erreur de lecture on ne bloque pas : la base refuse de toute façon une 2e correction.
  return error ? 0 : (count || 0);
}

async function voirColis(id, bandeau) {
  const c = colisCache.find(x => String(x.id) === String(id));
  if (!c) return;
  closeModal();
  const vueSuivi = document.getElementById('view-suivi');
  if (!vueSuivi.classList.contains('active')) show('suivi');
  const liste = document.getElementById('suivi-liste');
  if (!liste.classList.contains('hidden')) suiviScrollY = window.scrollY;

  const dejaModifie = (await corrections_deja_faites(c.id)) > 0;
  const modifiable = colisModifiable(c) && !dejaModifie;
  const st = normalizeStatut(c.statut);

  let note = '';
  if (dejaModifie) note = 'Les informations d\u2019enregistrement de ce colis ont déjà été modifiées une fois : aucune autre modification n\u2019est possible.';
  else if (!colisModifiable(c)) note = raisonNonModifiable(c);

  const detail = document.getElementById('suivi-detail');
  detail.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <button type="button" onclick="fermerDetailColis()" class="inline-flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-4 py-2.5 rounded-xl transition">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        Fermer
      </button>
    </div>

    <div class="bg-white rounded-2xl border border-slate-200 p-5 lg:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="font-semibold">Reçu du colis ${esc(c.numero_suivi)}</h2>
        <div class="flex flex-wrap gap-2">
          ${modifiable ? `<button type="button" id="btn-modifier-detail" class="inline-flex items-center gap-2 bg-white border border-coligo text-coligo hover:bg-coligo-light font-semibold px-4 py-2.5 rounded-xl transition">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            Modifier les informations d'enregistrement</button>` : ''}
          <button type="button" id="btn-imprimer-detail" class="inline-flex items-center gap-2 bg-coligo hover:bg-coligo-dark text-white font-semibold px-5 py-2.5 rounded-xl transition">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>
            Réimprimer le reçu</button>
        </div>
      </div>
      ${bandeau ? `<div class="mb-4">${bandeau}</div>` : ''}
      ${note ? `<p class="text-xs text-slate-500 mb-4">${esc(note)}</p>` : ''}
      <div id="detail-recu" class="overflow-x-auto"></div>
      <div class="flex justify-end mt-4">
        <button type="button" onclick="fermerDetailColis()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-5 py-2.5 rounded-xl transition">Fermer</button>
      </div>
    </div>
  `;
  document.getElementById('btn-imprimer-detail').addEventListener('click', () => imprimerRecu(c));
  const btnModif = document.getElementById('btn-modifier-detail');
  if (btnModif) btnModif.addEventListener('click', () => modifierColis(c.id));

  // Aperçu du reçu (2 exemplaires, format 80 mm) dans une iframe isolée.
  const iframe = document.createElement('iframe');
  iframe.title = 'Reçu du colis';
  iframe.style.cssText = 'width:100%; border:0; display:block; height:600px;';
  document.getElementById('detail-recu').appendChild(iframe);
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

  detailOuvert = { id: c.id, statut: st };
  liste.classList.add('hidden');
  detail.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function fermerDetailColis() {
  detailOuvert = null;
  document.getElementById('suivi-detail').classList.add('hidden');
  document.getElementById('suivi-detail').innerHTML = '';
  document.getElementById('suivi-liste').classList.remove('hidden');
  window.scrollTo(0, suiviScrollY);
}

// ---------- Correction d'un colis après l'enregistrement ----------
// Autorisée UNE SEULE FOIS, tant que le colis est « Enregistré » et n'est sur
// aucun listing (vérifié aussi côté base par colis_modifier, voir
// sql/colis_modification_unique_migration.sql). La raison est obligatoire :
// l'administrateur en est informé en temps réel (avant / après, agent, raison).

function colisModifiable(c) {
  return normalizeStatut(c.statut) === 'Enregistré' && !c.listing_id;
}
function raisonNonModifiable(c) {
  if (c.listing_id) return 'Modification impossible : ce colis est déjà sur un listing.';
  return `Modification impossible : le colis est « ${normalizeStatut(c.statut)} ». Seul un colis encore « Enregistré » peut être corrigé.`;
}

function modifierColis(id) {
  const c = colisCache.find(x => String(x.id) === String(id));
  if (!c) return;
  if (!colisModifiable(c)) { voirColis(id); return; }
  const champ = (cle, label, type, valeur, extra) => `
    <div>
      <label for="m-${cle}" class="block text-xs font-medium text-slate-600 mb-1">${label}</label>
      <input id="m-${cle}" type="${type}" value="${esc(valeur ?? '')}" ${extra || ''}
        class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-coligo/40 focus:border-coligo">
    </div>`;
  document.getElementById('modal-content').innerHTML = `
    <h3 class="text-lg font-bold text-coligo mb-1">Modifier ${esc(c.numero_suivi)}</h3>
    <p class="text-sm text-slate-500 mb-5">Corrigez l'erreur de saisie. Le numéro de suivi, le trajet et la date ne changent pas. <strong>Une seule modification est possible</strong> : l'administrateur en est informé immédiatement, avec la raison indiquée.</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      ${champ('expediteur_nom', 'Expéditeur *', 'text', c.expediteur_nom)}
      ${champ('expediteur_telephone', 'Téléphone expéditeur', 'tel', c.expediteur_telephone)}
      ${champ('destinataire_nom', 'Destinataire *', 'text', c.destinataire_nom)}
      ${champ('destinataire_telephone', 'Téléphone destinataire', 'tel', c.destinataire_telephone)}
      <div class="sm:col-span-2">
        <label for="m-description" class="block text-xs font-medium text-slate-600 mb-1">Description du colis *</label>
        <textarea id="m-description" rows="2" class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-coligo/40 focus:border-coligo">${esc(c.Description_du_colis || '')}</textarea>
      </div>
      ${champ('montant_paye', 'Montant payé (FCFA) *', 'number', c.montant_paye, 'min="0" step="1"')}
      <div>
        <div class="block text-xs font-medium text-slate-600 mb-1">Valeur déclarée (10 × montant)</div>
        <div id="m-valeur" class="bg-coligo-light rounded-xl px-3 py-2.5 text-sm font-semibold text-coligo-dark">${formatFCFA((Number(c.montant_paye) || 0) * 10)}</div>
      </div>
      <div class="sm:col-span-2">
        ${champ('motif', 'Raison de la modification *', 'text', '', 'maxlength="200" required placeholder="Ex. : nom mal orthographié, mauvais montant"')}
      </div>
    </div>
    <div id="m-erreur" class="mb-3"></div>
    <div class="flex gap-3">
      <button id="m-annuler" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-4 py-2.5 rounded-xl transition">Annuler</button>
      <button id="m-enregistrer" class="flex-1 bg-coligo hover:bg-coligo-dark text-white font-semibold px-4 py-2.5 rounded-xl transition">Enregistrer la correction</button>
    </div>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('m-montant_paye').addEventListener('input', (e) => {
    document.getElementById('m-valeur').textContent = formatFCFA((parseFloat(e.target.value) || 0) * 10);
  });
  document.getElementById('m-annuler').addEventListener('click', () => closeModal());
  document.getElementById('m-enregistrer').addEventListener('click', async () => {
    const btn = document.getElementById('m-enregistrer');
    const zone = document.getElementById('m-erreur');
    zone.innerHTML = '';
    const v = k => document.getElementById('m-' + k).value.trim();
    const tel = t => (t === '+237' ? '' : t);
    const champs = {
      expediteur_nom: v('expediteur_nom'),
      expediteur_telephone: tel(v('expediteur_telephone')),
      destinataire_nom: v('destinataire_nom'),
      destinataire_telephone: tel(v('destinataire_telephone')),
      Description_du_colis: document.getElementById('m-description').value.trim(),
      montant_paye: parseFloat(v('montant_paye'))
    };
    if (!champs.expediteur_nom || !champs.destinataire_nom || !champs.Description_du_colis || isNaN(champs.montant_paye) || champs.montant_paye < 0) {
      zone.innerHTML = msgError("Complétez l'expéditeur, le destinataire, la description et un montant valide.");
      return;
    }
    if (!v('motif')) {
      zone.innerHTML = msgError('Indiquez la raison de la modification : elle est transmise à l\u2019administrateur.');
      return;
    }
    setBtnLoading(btn, 'Enregistrement…');
    const agent = getSession();
    const { data, error } = await supabaseClient.rpc('colis_modifier', {
      p_username: agent.username, p_colis_id: String(c.id), p_champs: champs, p_motif: v('motif')
    });
    clearBtnLoading(btn);
    if (error) {
      zone.innerHTML = msgError(/function|schema cache|does not exist/i.test(error.message || '')
        ? "La modification n'est pas encore activée : l'administrateur doit exécuter sql/colis_modification_unique_migration.sql."
        : 'Erreur lors de la modification. Réessayez.');
      return;
    }
    if (!data || !data.ok) { zone.innerHTML = msgError((data && data.message) || 'Modification refusée.'); return; }

    const i = colisCache.findIndex(x => String(x.id) === String(c.id));
    if (i !== -1 && data.colis) colisCache[i] = data.colis;
    loadListingsPendants();
    voirColis(c.id, msgSuccess('Modification enregistrée et transmise à l\u2019administrateur. Pensez à réimprimer le reçu si le client l\u2019a déjà reçu.').replace('rounded-lg px-4 py-3 text-sm', 'rounded-lg px-4 py-3 text-sm mb-4'));
  });
}

// ---------- Initialisation ----------


document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

show('dashboard');

const existing = getSession();
if (existing && enforceRole(existing, 'agent')) {
  marquerPresence(existing.id, true);
  showDashboard(existing);
} else if (!existing) {
  showLogin();
}
