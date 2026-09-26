// ==========================================================
// COLIGO — Admin.html — logique complète
// Tables réelles utilisées : colis, colis_historique, agents
// (colonnes confirmées dans js/agent.js : numero_suivi, expediteur_nom,
// expediteur_telephone, destinataire_nom, destinataire_telephone,
// ville_depart, ville_arrivee, Description_du_colis, montant_paye,
// valeur, statut, agence, cree_par, created_at, updated_at)
// ==========================================================

const MOIS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

// Seuils métier utilisés pour les alertes (aucune colonne d'échéance
// n'existe dans la base : ce sont des règles raisonnables, ajustables ici).
const LATE_DAYS = 3;   // "en retard" : créé depuis plus de X jours et pas encore livré
const STALE_DAYS = 4;  // "bloqué" : statut non mis à jour depuis plus de X jours et pas livré

// Le tableau de bord, les agences et les rapports travaillent sur un cache
// des colis les plus récents (limite ci-dessous), rafraîchi en temps réel.
// La vue "Colis" (liste principale) interroge Supabase directement à
// chaque page/filtre, donc n'est pas concernée par cette limite. Si le
// volume dépasse largement cette limite, les agrégats du tableau de bord
// (montant total, etc.) devront passer par une fonction SQL côté serveur
// plutôt que ce cache — à revoir si besoin.
const CACHE_LIMIT = 2000;
// Nombre maximal de colis affichés d'un coup dans "Rechercher un colis" (plus de pagination :
// au-delà, on affine avec les filtres).
const COLIS_LIMIT = 200;

function formatFCFA(n) {
  return Number(n || 0).toLocaleString('fr-FR') + ' FCFA';
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
function daysSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}
function statutBadge(s) {
  const st = normalizeStatut(s);
  const c = statutColors(st);
  return `<span class="badge-statut" style="background:${c.bg}; color:${c.text}">${st}</span>`;
}
function esc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// Comparaison de ville/agence insensible aux accents, à la casse et aux espaces.
// normalizeCity() et agenceCode() viennent maintenant de js/receipt.js (chargé avant ce fichier).

// ---------- Session administrateur (séparée de la session agent) ----------

function getSession() {
  const raw = sessionStorage.getItem('coligo_admin_session');
  return raw ? JSON.parse(raw) : null;
}
function setSession(admin) { sessionStorage.setItem('coligo_admin_session', JSON.stringify(admin)); }
function clearSession() { sessionStorage.removeItem('coligo_admin_session'); }

function showScreen(id) {
  ['login-screen', 'access-denied-screen', 'dashboard-shell'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function showLogin() { showScreen('login-screen'); }

function showAccessDenied(msg) {
  document.getElementById('access-denied-msg').textContent = msg || "Ce compte n'est pas un compte administrateur.";
  showScreen('access-denied-screen');
}

function showDashboard(admin) {
  showScreen('dashboard-shell');
  document.getElementById('admin-name').textContent = admin.nom_complet || admin.username;
  initDashboard();
  if (typeof initMessagerie === 'function') initMessagerie();
}

document.getElementById('btn-access-denied-ok').addEventListener('click', () => {
  clearSession();
  showLogin();
});

// ---------- Connexion ----------

document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorZone = document.getElementById('login-error');
  errorZone.innerHTML = '';

  if (!username || !password) {
    errorZone.innerHTML = '<div class="admin-error-box">Renseignez l\'identifiant et le mot de passe.</div>';
    return;
  }

  setBtnLoading(btn, 'Connexion…');

  const { data, error } = await supabaseClient.rpc('agent_login', {
    p_username: username, p_password: password
  });

  clearBtnLoading(btn);

  if (error) {
    errorZone.innerHTML = '<div class="admin-error-box">Impossible de contacter la base de données.</div>';
    return;
  }
  if (!data || !data.ok) {
    errorZone.innerHTML = `<div class="admin-error-box">${(data && data.message) || 'Identifiants incorrects.'}</div>`;
    return;
  }
  const account = data.agent;

  // Vérification réelle du rôle : un compte agent classique reste sur
  // place, avec un message d'accès refusé — pas de redirection silencieuse.
  if (account.role !== 'administrateur') {
    errorZone.innerHTML = '<div class="admin-error-box">Accès refusé : ce compte n\'a pas les droits administrateur. Utilisez agent.html.</div>';
    return;
  }

  setSession(account);
  showDashboard(account);
});

document.getElementById('btn-logout').addEventListener('click', () => {
  const btn = document.getElementById('btn-logout');
  setBtnLoading(btn, 'Déconnexion…');
  setTimeout(() => { deconnexionComplete(); clearBtnLoading(btn); }, 250);
});

// ---------- Navigation (sidebar + mobile) ----------

const viewLoaded = { dashboard: false, colis: false, agents: false, rapports: false, historique: false, messagerie: false, invitation: false, conservation: false, parametres: false };
const viewDirty = { dashboard: true, agents: true, rapports: true };

function switchView(name) {
  document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  document.querySelectorAll('.admin-view').forEach(el => el.classList.toggle('active', el.id === 'view-' + name));
  document.querySelector('.admin-shell').classList.remove('sidebar-open');

  if (name === 'dashboard' && (!viewLoaded.dashboard || viewDirty.dashboard)) { renderDashboardSections(); viewLoaded.dashboard = true; viewDirty.dashboard = false; }
  if (name === 'colis' && !viewLoaded.colis) { initColisView(); viewLoaded.colis = true; }
  else if (name === 'colis') { loadColisPage(); }
  if (name === 'agents' && (!viewLoaded.agents || viewDirty.agents)) { renderAgentsView(); viewLoaded.agents = true; viewDirty.agents = false; }
  if (name === 'rapports' && (!viewLoaded.rapports || viewDirty.rapports)) { renderRapports(); viewLoaded.rapports = true; viewDirty.rapports = false; }
  if (name === 'historique' && !viewLoaded.historique) { initHistoriqueView(); viewLoaded.historique = true; }
  if (name === 'messagerie' && typeof msgChargerBoite === 'function') { msgChargerBoite(); viewLoaded.messagerie = true; }
  if (name === 'invitation' && !viewLoaded.invitation) { loadInviteCode(); viewLoaded.invitation = true; }
  if (name === 'conservation' && typeof initCycleVie === 'function') { initCycleVie(); viewLoaded.conservation = true; }
  if (name === 'parametres' && !viewLoaded.parametres) { renderParametres(); viewLoaded.parametres = true; }
}

document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => switchView(el.dataset.view));
});

document.getElementById('btn-menu-toggle').addEventListener('click', () => {
  document.querySelector('.admin-shell').classList.toggle('sidebar-open');
});
document.getElementById('sidebar-backdrop').addEventListener('click', () => {
  document.querySelector('.admin-shell').classList.remove('sidebar-open');
});

// ---------- Cache partagé (tableau de bord / agences / rapports) ----------

let colisCache = [];
let histCache = [];
let agentsCache = [];
let listingsCache = new Map(); // id (numérique) -> ligne listings
let trueTotalCount = 0;
let ancienStatutMap = new Map(); // id historique -> ancien statut
// Totaux des colis déjà supprimés par le cycle de vie (sql/cycle_de_vie_donnees_migration.sql).
// Sans ce cache, les rapports et le montant total baisseraient à chaque nettoyage.
let archiveCache = [];

async function initDashboard() {
  // Passage automatique du cycle de vie des données (au plus une fois toutes
  // les 20 h, décidé par la base). Silencieux : si la migration n'est pas
  // encore faite, l'appel échoue sans conséquence.
  try { await supabaseClient.rpc('lifecycle_auto'); } catch (e) { /* ignoré */ }
  await Promise.all([loadSharedCache(), chargerDelaiSuppressionAgents()]);
  subscribeRealtime();
  renderDashboardSections();
}

async function loadSharedCache() {
  const [{ count: totalCount }, { data: colis, error: colisErr }, { data: hist, error: histErr }, { data: agents, error: agentsErr }, { data: listings, error: listingsErr }] = await Promise.all([
    supabaseClient.from('colis').select('*', { count: 'exact', head: true }),
    supabaseClient.from('colis').select('*').order('created_at', { ascending: false }).limit(CACHE_LIMIT),
    supabaseClient.from('colis_historique').select('*, colis(numero_suivi, listing_id)').order('date_changement', { ascending: false }).limit(CACHE_LIMIT),
    supabaseClient.from('agents').select('*').eq('role', 'agent'),
    supabaseClient.from('listings').select('*')
  ]);

  trueTotalCount = totalCount || 0;
  colisCache = colisErr ? [] : (colis || []);
  histCache = histErr ? [] : (hist || []);
  agentsCache = agentsErr ? [] : (agents || []);
  listingsCache = new Map((listingsErr ? [] : (listings || [])).map(l => [l.id, l]));

  const { data: archive, error: archiveErr } = await supabaseClient.from('stats_archive').select('*');
  archiveCache = archiveErr ? [] : (archive || []);

  computeAncienStatutMap();
}

function computeAncienStatutMap() {
  ancienStatutMap = new Map();
  const parColis = {};
  histCache.forEach(h => {
    if (!parColis[h.colis_id]) parColis[h.colis_id] = [];
    parColis[h.colis_id].push(h);
  });
  Object.values(parColis).forEach(list => {
    list.sort((a, b) => new Date(a.date_changement) - new Date(b.date_changement));
    for (let i = 0; i < list.length; i++) {
      ancienStatutMap.set(list[i].id, i === 0 ? null : list[i - 1].statut);
    }
  });
}

// ---------- Temps réel ----------

let realtimeChannel = null;

function setRealtimePill(state) {
  const pill = document.getElementById('realtime-pill');
  const retryBtn = document.getElementById('btn-retry-realtime');
  if (state === 'up') {
    pill.classList.remove('down');
    pill.innerHTML = '<span class="dot"></span> Connexion temps réel active';
    retryBtn.classList.add('hidden');
  } else {
    pill.classList.add('down');
    pill.innerHTML = '<span class="dot"></span> Connexion temps réel interrompue';
    retryBtn.classList.remove('hidden');
  }
}

function subscribeRealtime() {
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); }

  realtimeChannel = supabaseClient
    .channel('admin-dashboard-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis' }, handleColisChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colis_historique' }, handleHistoriqueChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, handleAgentChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, handleListingChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setRealtimePill('up');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimePill('down');
    });
}

// Un nouvel agent apparaît dans la table `agents` uniquement quand une
// inscription a réussi — donc uniquement quand le code d'invitation vient
// d'être vérifié ET automatiquement renouvelé côté base de données (voir
// verify_and_rotate_invite dans sql/invite_code_migration.sql). C'est le
// signal le plus fiable pour rafraîchir le code affiché sans clic manuel.
function handleAgentChange(payload) {
  if (payload.eventType === 'UPDATE') {
    const i = agentsCache.findIndex(a => a.id === payload.new.id);
    if (i !== -1) agentsCache[i] = payload.new;
    if (document.querySelector('.admin-view.active').id === 'view-agents') renderAgentsView();
    return;
  }
  if (payload.eventType !== 'INSERT') return;

  agentsCache.push(payload.new);
  viewDirty.agents = true;
  viewDirty.dashboard = true;
  if (document.querySelector('.admin-view.active').id === 'view-invitation') loadInviteCode();
  if (typeof msgAgentsListe !== 'undefined') {
    if (payload.new.role === 'agent') msgAgentsListe.push(payload.new);
    else if (payload.new.role === 'administrateur' && typeof msgAdminsListe !== 'undefined' && msgMoi && payload.new.username !== msgMoi.username) msgAdminsListe.push(payload.new);
    if (typeof msgRemplirDestinataires === 'function') msgRemplirDestinataires();
  }
}

function handleListingChange(payload) {
  if (payload.eventType === 'DELETE') listingsCache.delete(payload.old.id);
  else listingsCache.set(payload.new.id, payload.new);
  if (document.querySelector('.admin-view.active').id === 'view-historique') applyHistoriqueFilters();
}

document.getElementById('btn-retry-realtime').addEventListener('click', () => {
  const btn = document.getElementById('btn-retry-realtime');
  setBtnLoading(btn, 'Reconnexion…');
  subscribeRealtime();
  setTimeout(() => clearBtnLoading(btn), 800);
});

// ---------- Cloche : uniquement l'alerte qui compte (colis en retard) ----------
// Plus de journal d'activité générale : la cloche reflète en permanence le
// nombre de colis en retard, et un clic ouvre directement la liste.

function isLate(c) {
  return normalizeStatut(c.statut) !== 'Retiré' && daysSince(c.created_at) >= LATE_DAYS;
}

function updateAlertBell() {
  const retard = colisCache.filter(isLate).length;
  const countEl = document.getElementById('notif-count');
  if (retard > 0) { countEl.textContent = retard; countEl.classList.remove('hidden'); }
  else { countEl.classList.add('hidden'); }
}

document.getElementById('notif-bell').addEventListener('click', () => {
  openProblemListModal(`Colis en retard (aucune mise à jour depuis plus de ${LATE_DAYS} jours)`, colisCache.filter(isLate));
});

function handleColisChange(payload) {
  if (payload.eventType === 'INSERT') {
    colisCache.unshift(payload.new);
    trueTotalCount += 1;
  } else if (payload.eventType === 'UPDATE') {
    const i = colisCache.findIndex(c => c.id === payload.new.id);
    if (i !== -1) colisCache[i] = payload.new;
  } else if (payload.eventType === 'DELETE') {
    colisCache = colisCache.filter(c => c.id !== payload.old.id);
    trueTotalCount = Math.max(0, trueTotalCount - 1);
  }
  ['agents', 'rapports'].forEach(v => viewDirty[v] = true);
  viewDirty.dashboard = true;
  updateAlertBell();

  const active = document.querySelector('.admin-view.active').id;
  if (active === 'view-dashboard') { renderDashboardSections(); viewDirty.dashboard = false; }
  if (active === 'view-colis') loadColisPage();
  if (active === 'view-rapports') { renderRapports(); viewDirty.rapports = false; }
  if (active === 'view-agents') { renderAgentsView(); viewDirty.agents = false; }
  // Liste des retraits (Conservation des données) : un colis qui passe « Retiré »
  // y apparaît aussitôt, un colis supprimé en disparaît.
  const st = payload.new && normalizeStatut(payload.new.statut);
  if (active === 'view-conservation' && typeof cdvRafraichirRetraits === 'function'
      && (payload.eventType === 'DELETE' || st === 'Retiré')) cdvRafraichirRetraits();
}

function handleHistoriqueChange(payload) {
  if (payload.eventType === 'INSERT') {
    // On ne connaît pas encore le numero_suivi joint : on va le chercher.
    supabaseClient.from('colis_historique').select('*, colis(numero_suivi, listing_id)').eq('id', payload.new.id).maybeSingle()
      .then(({ data }) => {
        if (data) histCache.unshift(data);
        computeAncienStatutMap();
        refreshHistoriqueDependentViews();
      });
    return;
  } else if (payload.eventType === 'DELETE') {
    histCache = histCache.filter(h => h.id !== payload.old.id);
  }
  computeAncienStatutMap();
  refreshHistoriqueDependentViews();
}

function refreshHistoriqueDependentViews() {
  const active = document.querySelector('.admin-view.active').id;
  if (active === 'view-historique') applyHistoriqueFilters();
  if (active === 'view-agents') renderAgentsView();
}

// ---------- Vue : Tableau de bord ----------

// La carte "Alertes nécessitant une attention" a été retirée : le retard
// (seule alerte qui comptait ici) reste visible via la grosse carte rouge
// "En retard" ci-dessous et via la cloche, toutes deux basées sur isLate().

function renderDashboardSections() {
  renderStatCards();
  renderDerniersColis();
  updateAlertBell();
}

// Trois indicateurs, et rien d'autre : les autres chiffres (total, en
// attente, enregistrés aujourd'hui…) restent consultables dans les vues
// dédiées (Agents, Rapports, Rechercher un colis) plutôt que d'encombrer
// le tableau de bord.
function renderStatCards() {
  const zone = document.getElementById('stats-row');
  const transit = colisCache.filter(c => normalizeStatut(c.statut) === 'En transit').length;
  const montantActif = colisCache.reduce((s, c) => s + Number(c.montant_paye || 0), 0);
  const montantArchive = archiveCache.reduce((s, a) => s + Number(a.montant_total || 0), 0);
  const montant = montantActif + montantArchive;
  const retard = colisCache.filter(isLate).length;

  zone.innerHTML = `
    <div class="hero-card hero-done">
      <div class="hero-label">Montant total encaissé</div>
      <div class="hero-num hero-num-money">${formatFCFA(montant)}</div>
      ${montantArchive ? `<div class="hero-sub" style="color:var(--muted);">dont ${formatFCFA(montantArchive)} de colis archivés</div>` : ''}
    </div>
    <div class="hero-card hero-transit">
      <div class="hero-label">En transit</div>
      <div class="hero-num">${transit}</div>
      <div class="hero-sub">Colis actuellement sur la route entre les deux agences</div>
    </div>
    <div class="hero-card hero-late" id="hero-retard" role="button" tabindex="0">
      <div class="hero-label">En retard</div>
      <div class="hero-num">${retard}</div>
      <div class="hero-sub">Aucune mise à jour depuis plus de ${LATE_DAYS} jours — cliquez pour voir le détail</div>
    </div>
  `;

  const heroRetard = document.getElementById('hero-retard');
  if (heroRetard) {
    const ouvrir = () => openProblemListModal(`Colis en retard (aucune mise à jour depuis plus de ${LATE_DAYS} jours)`, colisCache.filter(isLate));
    heroRetard.addEventListener('click', ouvrir);
    heroRetard.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') ouvrir(); });
  }
}

function openProblemListModal(title, list) {
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h3>${esc(title)}</h3>
    <div class="modal-sub">${list.length} colis concerné(s) — cliquez sur une ligne pour le détail complet.</div>
    <div class="admin-table-wrap" style="margin-bottom:16px;"><table class="admin-table">
      <thead><tr><th>Tracking</th><th>Destinataire</th><th>Statut</th><th>Date</th></tr></thead>
      <tbody>
        ${list.length ? list.map(c => `
          <tr class="row-click" data-id="${c.id}">
            <td data-label="Tracking">${esc(c.numero_suivi)}</td>
            <td data-label="Destinataire">${esc(c.destinataire_nom)}</td>
            <td data-label="Statut">${statutBadge(c.statut)}</td>
            <td data-label="Date">${formatDate(c.created_at)}</td>
          </tr>`).join('') : '<tr><td colspan="4" class="table-state">Aucun colis concerné.</td></tr>'}
      </tbody>
    </table></div>
    <button class="admin-btn admin-btn-block" id="btn-close-modal">Fermer</button>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  content.querySelectorAll('tr.row-click').forEach(row => {
    row.addEventListener('click', () => {
      const c = colisCache.find(x => String(x.id) === row.dataset.id);
      if (c) openColisModal(c);
    });
  });
}

function derniersColisRowHtml(c) {
  return `
    <tr class="row-click" data-id="${c.id}">
      <td data-label="Tracking">${esc(c.numero_suivi)}</td>
      <td data-label="Expéditeur">${esc(c.expediteur_nom)}</td>
      <td data-label="Destinataire">${esc(c.destinataire_nom)}</td>
      <td data-label="Téléphone">${esc(c.destinataire_telephone) || '—'}</td>
      <td data-label="Destination">${esc(c.ville_arrivee) || '—'}</td>
      <td data-label="Agence">${esc(c.agence) || '—'}</td>
      <td data-label="Description" class="cell-desc">${esc(c.Description_du_colis) || '—'}</td>
      <td data-label="Statut">${statutBadge(c.statut)}</td>
      <td data-label="Date">${formatDate(c.created_at)}</td>
      <td data-label="Agent">${esc(c.cree_par) || '—'}</td>
    </tr>`;
}

function renderDerniersColis() {
  const tbody = document.querySelector('#table-derniers-colis tbody');
  const list = colisCache.slice(0, 10);
  tbody.innerHTML = list.length
    ? list.map(derniersColisRowHtml).join('')
    : `<tr><td colspan="10">${etatVide('colis', 'Aucun colis enregistré pour le moment', 'Les colis apparaîtront ici dès leur enregistrement par une agence.')}</td></tr>`;
  wireRowClickColis(tbody);
}

// Rend chaque ligne de colis cliquable (au lieu d'un bouton "Voir" séparé) :
// un clic n'importe où sur la ligne ouvre le détail du colis.
function wireRowClickColis(scope) {
  scope.querySelectorAll('tr.row-click[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const c = colisCache.find(x => String(x.id) === row.dataset.id) || (colisRowsCache && colisRowsCache.find(x => String(x.id) === row.dataset.id));
      if (c) openColisModal(c);
    });
  });
}

// ---------- Vue : Colis (liste principale, paginée côté serveur — seule vue avec recherche) ----------

let colisFilters = {};
let colisRowsCache = []; // lignes actuellement affichées (pour le bouton Voir)

function initColisView() {
  const statutSel = document.getElementById('cf-statut');
  STATUTS.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; statutSel.appendChild(o); });

  const agenceSel = document.getElementById('cf-agence');
  const agences = [...new Set(agentsCache.map(a => a.agence).filter(Boolean))].sort();
  agences.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; agenceSel.appendChild(o); });

  const agentSel = document.getElementById('cf-agent');
  agentsCache.forEach(a => { const o = document.createElement('option'); o.value = a.username; o.textContent = a.nom_complet; agentSel.appendChild(o); });

  document.getElementById('btn-apply-filters').addEventListener('click', async () => {
    const btn = document.getElementById('btn-apply-filters');
    colisFilters = {
      search: document.getElementById('cf-search').value.trim(),
      statut: document.getElementById('cf-statut').value,
      agence: document.getElementById('cf-agence').value,
      agent: document.getElementById('cf-agent').value,
      destination: document.getElementById('cf-destination').value.trim(),
      from: document.getElementById('cf-date-from').value,
      to: document.getElementById('cf-date-to').value,
      sort: document.getElementById('cf-sort').value
    };
    setBtnLoading(btn, 'Recherche…');
    await loadColisPage();
    clearBtnLoading(btn);
  });

  document.getElementById('btn-reset-filters').addEventListener('click', async () => {
    ['cf-search', 'cf-destination', 'cf-date-from', 'cf-date-to'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cf-statut').value = '';
    document.getElementById('cf-agence').value = '';
    document.getElementById('cf-agent').value = '';
    document.getElementById('cf-sort').value = 'desc';
    colisFilters = {};
    await loadColisPage();
  });

  loadColisPage();
}

async function loadColisPage() {
  const tbody = document.querySelector('#table-colis tbody');
  tbody.innerHTML = '<tr><td colspan="11" class="table-state">Chargement…</td></tr>';

  let q = supabaseClient.from('colis').select('*', { count: 'exact' });

  const f = colisFilters;
  if (f.search) {
    const s = f.search.replace(/[%_]/g, '');
    q = q.or(`numero_suivi.ilike.%${s}%,destinataire_nom.ilike.%${s}%,destinataire_telephone.ilike.%${s}%,expediteur_nom.ilike.%${s}%,expediteur_telephone.ilike.%${s}%`);
  }
  if (f.statut) q = q.eq('statut', f.statut);
  if (f.agence) q = q.eq('agence', f.agence);
  if (f.agent) q = q.eq('cree_par', f.agent);
  if (f.destination) q = q.ilike('ville_arrivee', `%${f.destination.replace(/[%_]/g, '')}%`);
  if (f.from) q = q.gte('created_at', f.from);
  if (f.to) q = q.lt('created_at', addOneDay(f.to));

  q = q.order('created_at', { ascending: f.sort === 'asc' });
  q = q.limit(COLIS_LIMIT);

  const { data, count, error } = await q;

  if (error) {
    tbody.innerHTML = '<tr><td colspan="11" class="table-state err">Impossible de charger les colis. Réessayez.</td></tr>';
    return;
  }

  colisRowsCache = data || [];

  if (!colisRowsCache.length) {
    tbody.innerHTML = `<tr><td colspan="11">${etatVide('recherche', 'Aucun colis ne correspond à ces critères', 'Élargissez la période ou retirez un filtre.')}</td></tr>`;
  } else {
    tbody.innerHTML = colisRowsCache.map(c => `
      <tr class="row-click" data-id="${c.id}">
        <td data-label="Tracking">${esc(c.numero_suivi)}</td>
        <td data-label="Expéditeur">${esc(c.expediteur_nom)}</td>
        <td data-label="Destinataire">${esc(c.destinataire_nom)}</td>
        <td data-label="Téléphone">${esc(c.destinataire_telephone) || '—'}</td>
        <td data-label="Destination">${esc(c.ville_arrivee) || '—'}</td>
        <td data-label="Agence">${esc(c.agence) || '—'}</td>
        <td data-label="Description" class="cell-desc">${esc(c.Description_du_colis) || '—'}</td>
        <td data-label="Montant">${formatFCFA(c.montant_paye)}</td>
        <td data-label="Statut">${statutBadge(c.statut)}</td>
        <td data-label="Date">${formatDate(c.created_at)}</td>
        <td data-label="Agent">${esc(c.cree_par) || '—'}</td>
      </tr>`).join('');
    wireRowClickColis(tbody);
  }

  const total = count || 0;
  const shown = colisRowsCache.length;
  document.getElementById('colis-pagination-info').textContent = total > shown
    ? `Affichage des ${shown} colis les plus ${f.sort === 'asc' ? 'anciens' : 'récents'} sur ${total} — affinez avec les filtres pour voir les autres.`
    : `${total} colis`;
}

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Vue : Agents (lecture seule, sans recherche) ----------

function renderAgentsView() {
  const tbody = document.querySelector('#table-agents tbody');
  // Actifs d'abord, puis désactivés (suppression la plus proche en premier).
  const rows = agentsCache.map(a => ({
    a,
    actif: a.actif !== false,
    enLigne: a.actif !== false && !!a.en_ligne,
    depuis: a.en_ligne ? a.derniere_connexion : a.derniere_deconnexion
  })).sort((x, y) => (x.actif === y.actif) ? 0 : (x.actif ? -1 : 1));

  tbody.innerHTML = rows.length ? rows.map(r => {
    let compte, action;
    if (r.actif) {
      compte = '<span class="badge-compte ok">Actif</span>';
      action = `<button class="admin-btn small ghost-danger btn-desactiver" data-id="${r.a.id}">Désactiver</button>`;
    } else {
      const j = joursAvantSuppression(r.a.desactive_le);
      compte = `<span class="badge-compte off">Désactivé</span>
        <div class="compte-sub">le ${formatDateTime(r.a.desactive_le)}${r.a.desactive_motif ? ' · ' + esc(r.a.desactive_motif) : ''}</div>
        <div class="compte-sub warn">${j > 0 ? `Suppression définitive dans ${j} jour${j > 1 ? 's' : ''}` : 'Suppression au prochain passage du nettoyage'}</div>`;
      action = `<button class="admin-btn small btn-reactiver" data-id="${r.a.id}">Réactiver</button>`;
    }
    return `
    <tr class="${r.actif ? '' : 'row-desactive'}">
      <td data-label="Nom">${esc(r.a.nom_complet)}</td>
      <td data-label="Identifiant">${esc(r.a.username)}</td>
      <td data-label="E-mail">${r.a.email
        ? esc(r.a.email)
        : `<button class="admin-btn ghost small btn-add-email" data-id="${r.a.id}">Ajouter un e-mail</button>`}</td>
      <td data-label="Agence">${esc(r.a.agence)}</td>
      <td data-label="Statut">${r.enLigne ? '<span class="badge-online">En ligne</span>' : '<span class="badge-offline">Hors ligne</span>'}</td>
      <td data-label="Depuis">${r.depuis ? formatDateTime(r.depuis) : 'Jamais connecté'}</td>
      <td data-label="Compte">${compte}</td>
      <td data-label="Action">${action}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8">${etatVide('agents', 'Aucun agent enregistré', 'Les comptes créés avec le code d\u2019invitation apparaîtront ici.')}</td></tr>`;

  tbody.querySelectorAll('.btn-add-email').forEach(btn => {
    btn.addEventListener('click', () => openEditEmailModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-desactiver').forEach(btn => {
    btn.addEventListener('click', () => demanderDesactivation(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-reactiver').forEach(btn => {
    btn.addEventListener('click', () => demanderReactivation(btn.dataset.id));
  });
}

// Délai avant suppression définitive d'un compte désactivé (réglable dans
// « Conservation des données », 30 jours par défaut).
let delaiSuppressionAgents = 30;
async function chargerDelaiSuppressionAgents() {
  try {
    const { data } = await supabaseClient.rpc('lifecycle_regles');
    if (data && data.agents_desactives_suppression_jours) delaiSuppressionAgents = Number(data.agents_desactives_suppression_jours);
  } catch (e) { /* valeur par défaut */ }
}
function joursAvantSuppression(desactiveLe) {
  if (!desactiveLe) return delaiSuppressionAgents;
  const fin = new Date(desactiveLe).getTime() + delaiSuppressionAgents * 86400000;
  return Math.max(0, Math.ceil((fin - Date.now()) / 86400000));
}

function rafraichirAgentLocal(id, champs) {
  const i = agentsCache.findIndex(x => String(x.id) === String(id));
  if (i !== -1) agentsCache[i] = { ...agentsCache[i], ...champs };
  renderAgentsView();
}

function demanderDesactivation(agentId) {
  const a = agentsCache.find(x => String(x.id) === String(agentId));
  if (!a) return;
  cdvConfirmer({
    titre: `Désactiver le compte de ${a.nom_complet}`,
    texte: `<strong>${esc(a.username)}</strong> · agence de ${esc(a.agence)}<br>
      La connexion est bloquée immédiatement (une session ouverte est coupée en moins de 2 minutes).
      Sans réactivation sous <strong>${delaiSuppressionAgents} jours</strong>, le compte sera supprimé définitivement.
      Ses colis, son historique, ses retraits et ses messages sont conservés.`,
    avecMotif: true,
    motifPlaceholder: 'Ex. : démission, licenciement, fin de contrat',
    libelleBouton: 'Désactiver le compte',
    action: async (mdp, motif) => {
      const moi = getSession();
      const { data, error } = await supabaseClient.rpc('agent_desactiver', {
        p_admin: moi.username, p_password: mdp, p_agent_id: String(a.id), p_motif: motif
      });
      if (error) return { ok: false, message: messageMigrationAgents(error) };
      if (!data || !data.ok) return { ok: false, message: (data && data.message) || 'Opération refusée.' };
      return { ok: true, apres: () => rafraichirAgentLocal(a.id, {
        actif: false, desactive_le: new Date().toISOString(), desactive_par: moi.username, desactive_motif: motif, en_ligne: false
      }) };
    }
  });
}

function demanderReactivation(agentId) {
  const a = agentsCache.find(x => String(x.id) === String(agentId));
  if (!a) return;
  cdvConfirmer({
    titre: `Réactiver le compte de ${a.nom_complet}`,
    texte: `<strong>${esc(a.username)}</strong> pourra de nouveau se connecter avec son mot de passe habituel. La suppression programmée est annulée.`,
    sansDanger: true,
    libelleBouton: 'Réactiver le compte',
    action: async (mdp) => {
      const moi = getSession();
      const { data, error } = await supabaseClient.rpc('agent_reactiver', {
        p_admin: moi.username, p_password: mdp, p_agent_id: String(a.id)
      });
      if (error) return { ok: false, message: messageMigrationAgents(error) };
      if (!data || !data.ok) return { ok: false, message: (data && data.message) || 'Opération refusée.' };
      return { ok: true, apres: () => rafraichirAgentLocal(a.id, {
        actif: true, desactive_le: null, desactive_par: null, desactive_motif: null
      }) };
    }
  });
}

function messageMigrationAgents(error) {
  return /function|does not exist|schema cache/i.test(error.message || '')
    ? 'Fonction absente : exécutez sql/agents_desactivation_modification_migration.sql dans Supabase.'
    : 'Opération impossible pour le moment. Réessayez.';
}

// ---------- État vide (remplace les « Aucune donnée » en texte brut) ----------

const ETAT_VIDE_ICONES = {
  rapports: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="14" width="3" height="4" rx="1"/>',
  agents: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  colis: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
};
function etatVide(type, titre, texte, actionHtml) {
  return `<div class="etat-vide">
    <div class="etat-vide-icone"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ETAT_VIDE_ICONES[type] || ETAT_VIDE_ICONES.recherche}</svg></div>
    <div class="etat-vide-titre">${esc(titre)}</div>
    ${texte ? `<div class="etat-vide-texte">${esc(texte)}</div>` : ''}
    ${actionHtml || ''}
  </div>`;
}

// Petite fenêtre pour ajouter/corriger l'e-mail d'un compte (nécessaire pour
// que "Mot de passe oublié ?" fonctionne sur ce compte).
function openEditEmailModal(agentId) {
  const a = agentsCache.find(x => String(x.id) === String(agentId));
  if (!a) return;
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h3>E-mail de ${esc(a.nom_complet)}</h3>
    <div class="modal-sub">Utilisé uniquement pour recevoir le code « mot de passe oublié ».</div>
    <div class="admin-field">
      <label>Adresse e-mail</label>
      <input type="email" id="modal-email-input" placeholder="vous@exemple.com" value="${esc(a.email || '')}">
    </div>
    <div id="modal-email-error"></div>
    <button class="admin-btn admin-btn-block" id="btn-save-email">Enregistrer</button>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');

  document.getElementById('btn-save-email').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-email');
    const zone = document.getElementById('modal-email-error');
    const email = document.getElementById('modal-email-input').value.trim();
    zone.innerHTML = '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      zone.innerHTML = '<div class="admin-error-box">Adresse e-mail invalide.</div>';
      return;
    }

    setBtnLoading(btn, 'Enregistrement…');
    const { error } = await supabaseClient.from('agents').update({ email }).eq('id', a.id);
    clearBtnLoading(btn);

    if (error) { zone.innerHTML = '<div class="admin-error-box">Échec de l\'enregistrement. Réessayez.</div>'; return; }

    a.email = email;
    closeModal();
    renderAgentsView();
  });
}

// ---------- Agences (liste déduite, utilisée par la vue Rapports) ----------
// Les agences ne sont plus écrites en dur : elles sont déduites des colis
// et des comptes agents, pour ne rater aucune agence réellement en usage.

function listeAgences() {
  const noms = new Map(); // clé normalisée -> libellé affiché
  colisCache.forEach(c => { if (c.agence) noms.set(normalizeCity(c.agence), String(c.agence).trim()); });
  agentsCache.forEach(a => { if (a.agence) noms.set(normalizeCity(a.agence), String(a.agence).trim()); });
  archiveCache.forEach(a => { if (a.agence && !noms.has(normalizeCity(a.agence))) noms.set(normalizeCity(a.agence), String(a.agence).trim()); });
  return [...noms.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---------- Vue : Rapports → voir js/rapports.js (tableau de bord premium) ----------

// ---------- Vue : Historique des actions sur listing (recherche regroupée, sans réinitialiser) ----------

function initHistoriqueView() {
  const sel = document.getElementById('hf-agent');
  agentsCache.forEach(a => { const o = document.createElement('option'); o.value = a.username; o.textContent = a.nom_complet; sel.appendChild(o); });

  document.getElementById('btn-historique-filter').addEventListener('click', () => {
    const btn = document.getElementById('btn-historique-filter');
    setBtnLoading(btn, 'Recherche…');
    applyHistoriqueFilters();
    clearBtnLoading(btn);
  });

  applyHistoriqueFilters();
}

function applyHistoriqueFilters() {
  const agent = document.getElementById('hf-agent').value;
  const tracking = document.getElementById('hf-tracking').value.trim().toLowerCase();

  let list = histCache;
  if (agent) list = list.filter(h => h.agent === agent);
  if (tracking) list = list.filter(h => h.colis && h.colis.numero_suivi && h.colis.numero_suivi.toLowerCase().includes(tracking));

  const zone = document.getElementById('historique-zone');

  if (!list.length) {
    zone.innerHTML = `<div class="admin-card">${etatVide('recherche', 'Aucune activité trouvée', 'Aucune action ne correspond à ces filtres.')}</div>`;
    return;
  }

  // Regroupement par numéro de listing (via colis.listing_id -> listings.numero_listing).
  // Les entrées dont le colis n'appartient encore à aucun listing sont
  // rassemblées à part, sous "Sans listing".
  const groupes = new Map(); // clé d'affichage -> { ordre, rows: [] }
  list.forEach(h => {
    const listingId = h.colis && h.colis.listing_id;
    const listing = listingId ? listingsCache.get(listingId) : null;
    const cle = listing ? listing.numero_listing : '__sans_listing__';
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        titre: listing ? `Listing ${listing.numero_listing}` : 'Sans listing (colis pas encore imprimé dans un envoi groupé)',
        ordre: listing ? new Date(listing.created_at).getTime() : -1,
        rows: []
      });
    }
    groupes.get(cle).rows.push(h);
  });

  const groupesTries = [...groupes.values()].sort((a, b) => b.ordre - a.ordre);

  zone.innerHTML = groupesTries.map(g => `
    <div class="admin-card">
      <h3>${esc(g.titre)}<span class="muted-admin" style="font-weight:500; font-size:0.78rem;">${g.rows.length} action(s)</span></h3>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Date</th><th>Agent</th><th>Tracking</th><th>Ancien statut</th><th>Nouveau statut</th></tr></thead>
        <tbody>
          ${g.rows.slice(0, 300).map(h => `
            <tr>
              <td data-label="Date">${formatDateTime(h.date_changement)}</td>
              <td data-label="Agent">${esc(h.agent) || '—'}</td>
              <td data-label="Tracking">${esc(h.colis ? h.colis.numero_suivi : '—')}</td>
              <td data-label="Ancien statut">${ancienStatutMap.get(h.id) ? statutBadge(ancienStatutMap.get(h.id)) : '<span class="muted-admin">Nouveau colis</span>'}</td>
              <td data-label="Nouveau statut">${statutBadge(h.statut)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`).join('');
}

// ---------- Vue : Paramètres (code d'invitation, sans recherche) ----------

async function loadInviteCode() {
  const box = document.getElementById('invite-code-box');
  const boxAdmin = document.getElementById('invite-code-box-admin');
  const btn = document.getElementById('btn-refresh-invite');
  box.textContent = 'Chargement…';
  boxAdmin.textContent = 'Chargement…';
  const { data, error } = await supabaseClient.rpc('get_current_invite_code');
  clearBtnLoading(btn);
  if (error || !data) {
    box.innerHTML = '<span class="muted-admin">Code d\'invitation indisponible pour le moment.</span>';
    boxAdmin.innerHTML = '<span class="muted-admin">Code d\'invitation indisponible pour le moment.</span>';
    return;
  }
  box.innerHTML = `Code actuel : <strong style="font-size:1.3rem; letter-spacing:0.05em; color:var(--admin-primary);">${esc(data.agent)}</strong>`;
  boxAdmin.innerHTML = `Code actuel : <strong style="font-size:1.3rem; letter-spacing:0.05em; color:var(--admin-primary);">${esc(data.administrateur)}</strong>`;
}
document.getElementById('btn-refresh-invite').addEventListener('click', () => {
  setBtnLoading(document.getElementById('btn-refresh-invite'), 'Actualisation…');
  loadInviteCode();
});

// ---------- Vue : Paramètres (compte + mot de passe) ----------

function renderParametres() {
  const a = getSession();
  if (!a) return;
  document.getElementById('param-nom').textContent = a.nom_complet || '—';
  document.getElementById('param-username').textContent = a.username || '—';
  document.getElementById('param-agence').textContent = a.agence || '—';
}

document.getElementById('btn-change-pw').addEventListener('click', async () => {
  const btn = document.getElementById('btn-change-pw');
  const zone = document.getElementById('pw-message');
  const actuel = document.getElementById('pw-actuel').value;
  const nouveau = document.getElementById('pw-nouveau').value;
  const confirme = document.getElementById('pw-confirme').value;
  const a = getSession();
  zone.innerHTML = '';

  if (!actuel || !nouveau || !confirme) {
    zone.innerHTML = '<div class="admin-error-box">Remplissez les trois champs.</div>';
    return;
  }
  if (nouveau !== confirme) {
    zone.innerHTML = '<div class="admin-error-box">Le nouveau mot de passe et sa confirmation ne correspondent pas.</div>';
    return;
  }
  if (nouveau.length < 4) {
    zone.innerHTML = '<div class="admin-error-box">Le nouveau mot de passe doit contenir au moins 4 caractères.</div>';
    return;
  }

  setBtnLoading(btn, 'Enregistrement…');
  const { data, error } = await supabaseClient.rpc('change_own_password', {
    p_username: a.username, p_ancien: actuel, p_nouveau: nouveau
  });
  clearBtnLoading(btn);

  if (error) {
    zone.innerHTML = '<div class="admin-error-box">Modification impossible pour le moment. Réessayez.</div>';
    return;
  }
  if (!data || !data.ok) {
    zone.innerHTML = `<div class="admin-error-box">${(data && data.message) || 'Le mot de passe actuel est incorrect.'}</div>`;
    return;
  }

  ['pw-actuel', 'pw-nouveau', 'pw-confirme'].forEach(id => document.getElementById(id).value = '');
  zone.innerHTML = '<div class="admin-success-box">Mot de passe modifié. Il sera demandé à votre prochaine connexion.</div>';
});

// ---------- Déconnexion : rien n'est conservé sur l'appareil ----------

function deconnexionComplete() {
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (typeof msgChannel !== 'undefined' && msgChannel) { supabaseClient.removeChannel(msgChannel); msgChannel = null; }
  sessionStorage.clear();
  localStorage.removeItem('coligo_admin_session');
  localStorage.removeItem('coligo_agent_session');

  colisCache = []; histCache = []; agentsCache = []; listingsCache = new Map(); archiveCache = [];
  if (typeof rap !== 'undefined') { if (rap.chart) rap.chart.destroy(); rap.chart = null; rap.lignes = null; rap.perime = true; rap.initialise = false; }
  Object.keys(viewLoaded).forEach(k => viewLoaded[k] = false);

  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').innerHTML = '';
  document.getElementById('notif-count').classList.add('hidden');
  showLogin();
}

document.getElementById('btn-logout-param').addEventListener('click', () => {
  const btn = document.getElementById('btn-logout-param');
  setBtnLoading(btn, 'Déconnexion…');
  setTimeout(() => { deconnexionComplete(); clearBtnLoading(btn); }, 250);
});

// ---------- Modal lecture seule (détail d'un colis) ----------

function openColisModal(c) {
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h3>${esc(c.numero_suivi)}</h3>
    <div class="modal-sub">Consultation uniquement — les corrections se font par l'agent tant que le colis est « Enregistré » (seule la suppression d'un dossier clos est proposée ici).</div>
    <div class="modal-grid">
      <div><div class="k">Statut</div><div class="v">${statutBadge(c.statut)}</div></div>
      <div><div class="k">Agence</div><div class="v">${esc(c.agence) || '—'}</div></div>
      <div><div class="k">Expéditeur</div><div class="v">${esc(c.expediteur_nom)}</div></div>
      <div><div class="k">Téléphone expéditeur</div><div class="v">${esc(c.expediteur_telephone) || '—'}</div></div>
      <div><div class="k">Destinataire</div><div class="v">${esc(c.destinataire_nom)}</div></div>
      <div><div class="k">Téléphone destinataire</div><div class="v">${esc(c.destinataire_telephone) || '—'}</div></div>
      <div><div class="k">Ville de départ</div><div class="v">${esc(c.ville_depart) || '—'}</div></div>
      <div><div class="k">Ville d'arrivée</div><div class="v">${esc(c.ville_arrivee) || '—'}</div></div>
      <div><div class="k">Montant payé</div><div class="v">${formatFCFA(c.montant_paye)}</div></div>
      <div><div class="k">Valeur déclarée</div><div class="v">${formatFCFA(c.valeur)}</div></div>
      <div><div class="k">Agent</div><div class="v">${esc(c.cree_par) || '—'}</div></div>
      <div><div class="k">Date d'enregistrement</div><div class="v">${formatDateTime(c.created_at)}</div></div>
      <div class="full"><div class="k">Description du colis</div><div class="v">${esc(c.Description_du_colis) || '—'}</div></div>
    </div>
    <div id="modal-corrections"></div>
    ${normalizeStatut(c.statut) === 'Retiré' && typeof cdvDemanderSuppressionColis === 'function' ? `
      <p class="muted-admin" style="font-size:0.8rem; margin:0 0 10px;">Dossier clos : ce colis sera supprimé automatiquement à la fin de sa durée de conservation. Vous pouvez aussi le supprimer dès maintenant.</p>
      <button class="admin-btn admin-btn-block danger" id="btn-delete-colis" style="margin-bottom:10px;">Supprimer ce dossier clos</button>` : ''}
    <button class="admin-btn admin-btn-block" id="btn-close-modal">Fermer</button>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  const btnDel = document.getElementById('btn-delete-colis');
  if (btnDel) btnDel.addEventListener('click', () => cdvDemanderSuppressionColis(c, false));
  afficherCorrectionsColis(c);
}

// Corrections faites par l'agent après l'enregistrement (table colis_modifications).
const LIBELLES_CHAMPS_COLIS = {
  expediteur_nom: 'Expéditeur', expediteur_telephone: 'Tél. expéditeur',
  destinataire_nom: 'Destinataire', destinataire_telephone: 'Tél. destinataire',
  Description_du_colis: 'Description', montant_paye: 'Montant payé', valeur: 'Valeur déclarée'
};
async function afficherCorrectionsColis(c) {
  const zone = document.getElementById('modal-corrections');
  if (!zone) return;
  const { data, error } = await supabaseClient.from('colis_modifications')
    .select('*').eq('colis_id', String(c.id)).order('modifie_le', { ascending: false });
  if (error || !data || !data.length || !document.getElementById('modal-corrections')) return;
  const val = (k, v) => (k === 'montant_paye' || k === 'valeur') ? formatFCFA(v) : (esc(v) || '—');
  zone.innerHTML = `
    <div class="corrections-box">
      <div class="corrections-titre">Corrigé ${data.length} fois après l'enregistrement</div>
      ${data.map(m => `
        <div class="correction">
          <div class="correction-meta">${formatDateTime(m.modifie_le)} · par ${esc(m.agent)}${m.motif ? ' · ' + esc(m.motif) : ''}</div>
          ${Object.keys(m.apres || {}).filter(k => k !== 'valeur').map(k => `
            <div class="correction-ligne"><span>${LIBELLES_CHAMPS_COLIS[k] || esc(k)}</span>
              <s>${val(k, (m.avant || {})[k])}</s> <b>${val(k, m.apres[k])}</b></div>`).join('')}
        </div>`).join('')}
    </div>`;
}
function closeModal() { document.getElementById('modal-backdrop').classList.add('hidden'); }
document.getElementById('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------- Au chargement ----------


const existing = getSession();
if (existing) {
  if (existing.role === 'administrateur') showDashboard(existing);
  else showAccessDenied();
} else {
  showLogin();
}
