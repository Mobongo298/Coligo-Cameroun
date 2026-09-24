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
  const raw = sessionStorage.getItem('coliexpress_admin');
  return raw ? JSON.parse(raw) : null;
}
function setSession(admin) { sessionStorage.setItem('coliexpress_admin', JSON.stringify(admin)); }
function clearSession() { sessionStorage.removeItem('coliexpress_admin'); }

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

  const { data: account, error } = await supabaseClient
    .from('agents')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle();

  clearBtnLoading(btn);

  if (error) {
    errorZone.innerHTML = '<div class="admin-error-box">Impossible de contacter la base de données.</div>';
    return;
  }
  if (!account) {
    errorZone.innerHTML = '<div class="admin-error-box">Identifiants incorrects.</div>';
    return;
  }

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

const viewLoaded = { dashboard: false, colis: false, agents: false, rapports: false, historique: false, messagerie: false, invitation: false, parametres: false };
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

async function initDashboard() {
  await loadSharedCache();
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
  const montant = colisCache.reduce((s, c) => s + Number(c.montant_paye || 0), 0);
  const retard = colisCache.filter(isLate).length;

  zone.innerHTML = `
    <div class="hero-card hero-done">
      <div class="hero-label">Montant total encaissé</div>
      <div class="hero-num hero-num-money">${formatFCFA(montant)}</div>
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
    : '<tr><td colspan="10" class="table-state">Aucun colis enregistré pour le moment.</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="11" class="table-state">Aucun colis ne correspond à ces critères.</td></tr>';
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
  const rows = agentsCache.map(a => ({
    a,
    enLigne: !!a.en_ligne,
    depuis: a.en_ligne ? a.derniere_connexion : a.derniere_deconnexion
  }));
  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td data-label="Nom">${esc(r.a.nom_complet)}</td>
      <td data-label="Identifiant">${esc(r.a.username)}</td>
      <td data-label="E-mail">${r.a.email
        ? esc(r.a.email)
        : `<button class="admin-btn ghost small btn-add-email" data-id="${r.a.id}">Ajouter un e-mail</button>`}</td>
      <td data-label="Agence">${esc(r.a.agence)}</td>
      <td data-label="Statut">${r.enLigne ? '<span class="badge-online">Actif</span>' : '<span class="badge-offline">Inactif</span>'}</td>
      <td data-label="Depuis">${r.depuis ? formatDateTime(r.depuis) : 'Jamais connecté'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="table-state">Aucun agent enregistré.</td></tr>';

  tbody.querySelectorAll('.btn-add-email').forEach(btn => {
    btn.addEventListener('click', () => openEditEmailModal(btn.dataset.id));
  });
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
  return [...noms.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---------- Vue : Rapports (mensuel + total annuel, par agence réelle) ----------

function renderRapports() {
  const zone = document.getElementById('rapports-zone');
  const agences = listeAgences();

  if (!agences.length) {
    zone.innerHTML = '<div class="admin-card"><p class="muted-admin">Aucune donnée à rapporter pour le moment.</p></div>';
    return;
  }

  zone.innerHTML = agences.map(ag => {
    const parMois = {};
    colisCache.filter(c => normalizeCity(c.agence) === ag.key).forEach(c => {
      const d = new Date(c.created_at);
      const key = d.getFullYear() * 100 + d.getMonth();
      if (!parMois[key]) parMois[key] = { label: MOIS[d.getMonth()] + ' ' + d.getFullYear(), ordre: key, count: 0, montant: 0 };
      parMois[key].count++;
      parMois[key].montant += Number(c.montant_paye || 0);
    });
    const rows = Object.values(parMois).sort((a, b) => b.ordre - a.ordre);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    const totalMontant = rows.reduce((s, r) => s + r.montant, 0);

    return `
      <div class="admin-card">
        <h3>Rapport Agence de ${esc(ag.label)}</h3>
        <div class="admin-table-wrap"><table class="admin-table">
          <thead><tr><th>Mois</th><th>Nombre de colis</th><th>Montant encaissé</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr><td data-label="Mois">${r.label}</td><td data-label="Nombre">${r.count}</td><td data-label="Montant">${formatFCFA(r.montant)}</td></tr>
            `).join('') : '<tr><td colspan="3" class="table-state">Aucune donnée.</td></tr>'}
            ${rows.length ? `<tr class="total-row"><td data-label="Total">Total annuel</td><td data-label="Nombre">${totalCount}</td><td data-label="Montant">${formatFCFA(totalMontant)}</td></tr>` : ''}
          </tbody>
        </table></div>
      </div>`;
  }).join('');
}

// ---------- Vue : Historique des actions (recherche regroupée, sans réinitialiser) ----------

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
    zone.innerHTML = '<div class="admin-card"><p class="table-state">Aucune activité trouvée.</p></div>';
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
  const btn = document.getElementById('btn-refresh-invite');
  box.textContent = 'Chargement…';
  const { data, error } = await supabaseClient.rpc('get_current_invite_code');
  clearBtnLoading(btn);
  if (error || !data) {
    box.innerHTML = '<span class="muted-admin">Code d\'invitation indisponible pour le moment.</span>';
    return;
  }
  box.innerHTML = `Code actuel : <strong style="font-size:1.3rem; letter-spacing:0.05em; color:var(--admin-primary);">${esc(data)}</strong>`;
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
  if (actuel !== a.password) {
    zone.innerHTML = '<div class="admin-error-box">Le mot de passe actuel est incorrect.</div>';
    return;
  }

  setBtnLoading(btn, 'Enregistrement…');
  const { error } = await supabaseClient.from('agents').update({ password: nouveau }).eq('id', a.id);
  clearBtnLoading(btn);

  if (error) {
    zone.innerHTML = '<div class="admin-error-box">Modification impossible pour le moment. Réessayez.</div>';
    return;
  }

  a.password = nouveau;
  setSession(a);
  ['pw-actuel', 'pw-nouveau', 'pw-confirme'].forEach(id => document.getElementById(id).value = '');
  zone.innerHTML = '<div class="admin-success-box">Mot de passe modifié. Il sera demandé à votre prochaine connexion.</div>';
});

// ---------- Déconnexion : rien n'est conservé sur l'appareil ----------

function deconnexionComplete() {
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (typeof msgChannel !== 'undefined' && msgChannel) { supabaseClient.removeChannel(msgChannel); msgChannel = null; }
  sessionStorage.clear();
  localStorage.removeItem('coliexpress_admin');
  localStorage.removeItem('coliexpress_agent');

  colisCache = []; histCache = []; agentsCache = []; listingsCache = new Map();
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
    <div class="modal-sub">Consultation uniquement — aucune modification possible depuis l'espace administrateur.</div>
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
    <button class="admin-btn admin-btn-block" id="btn-close-modal">Fermer</button>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
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
