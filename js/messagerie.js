// ==========================================================
// COLIGO — js/messagerie.js
// ==========================================================
// Messagerie interne, partagée À L'IDENTIQUE par agent.html,
// retrait.html et Admin.html : chaque page ne fournit qu'un
// conteneur vide <div id="msg-root"></div>, et toute l'interface
// (liste des discussions + conversation ouverte, façon WhatsApp)
// est construite ici. Un seul code = trois espaces identiques.
//
// Table réelle : messages (voir sql/messagerie_migration.sql et
// sql/messagerie_admin_a_admin_migration.sql — cette dernière doit avoir
// été exécutée pour que la circulation agent -> admin fonctionne, car
// c'est elle qui autorise destinataire_type = 'admin' dans la table).
//
// Règles de circulation (appliquées ici, côté application) :
//   - Un agent peut écrire à un autre agent ou à un administrateur précis.
//     Il reçoit les messages des autres agents ET les diffusions envoyées
//     par un administrateur ("Tous les agents" — lecture seule, un agent
//     ne peut pas y écrire, il doit ouvrir une discussion directe avec
//     l'administrateur concerné).
//   - Un administrateur écrit à un agent précis, à tous les agents
//     ('tous'), ou à un autre administrateur.
//
// Conservation des discussions :
//   - L'expéditeur ET le destinataire peuvent, chacun dans sa propre
//     messagerie et au moment voulu, supprimer un message (icône corbeille
//     sur la bulle) ou vider toute la discussion (bouton en haut à droite).
//   - La suppression ne concerne que MA vue : on enregistre « ce message est
//     masqué pour moi » dans la table `messages_masques`. L'autre personne le
//     conserve tant qu'elle ne l'a pas supprimé de son côté.
//   - Quand les DEUX personnes d'une discussion directe ont supprimé un
//     message, il est effacé définitivement de la base (déclencheur ajouté par
//     sql/messagerie_codes_non_reclames_migration.sql).
//
// Bip sonore : quand un nouveau message arrive (temps réel) et que la
// discussion n'est pas déjà ouverte à l'écran, un seul bip bref est joué.
//
// Messages « non lus » : la base n'a pas de colonne « lu ». On mémorise
// donc, dans le navigateur (localStorage), les identifiants des messages
// déjà consultés. Le badge de chaque discussion = messages jamais ouverts
// depuis ce navigateur.
// ==========================================================

function msgEsc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function msgHeure(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function msgJourLabel(iso) {
  const d = new Date(iso);
  const auj = new Date();
  const hier = new Date(); hier.setDate(auj.getDate() - 1);
  const meme = (a, b) => a.toDateString() === b.toDateString();
  if (meme(d, auj)) return "Aujourd'hui";
  if (meme(d, hier)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: d.getFullYear() !== auj.getFullYear() ? 'numeric' : undefined });
}
function msgEl(id) { return document.getElementById(id); }

// Initiale(s) pour l'avatar rond, et une couleur stable dérivée du nom.
function msgInitiales(nom) {
  const mots = String(nom || '?').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return '?';
  return (mots[0][0] + (mots[1] ? mots[1][0] : '')).toUpperCase();
}
const MSG_PALETTE = ['#368AC8', '#4CAF7D', '#B4884D', '#8E6FC9', '#D4756B', '#3D9C9C', '#6B8E4E'];
function msgCouleur(cle) {
  let h = 0;
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return MSG_PALETTE[h % MSG_PALETTE.length];
}

let msgMoi = null;              // { type: 'admin'|'agent', username, nom }
let msgContacts = new Map();    // 'agent:username' | 'admin:username' -> { nom_complet, agence, role }
let msgTous = [];               // toutes mes conversations (envoyés + reçus), à plat
let msgMasques = new Set();     // identifiants des messages que J'AI masqués
let msgIdsConnus = new Set();   // messages déjà vus dans cette session (repérer les nouveaux -> bip)
let msgPremierChargement = true;
let msgChannel = null;
let msgConvOuverte = null;      // clé de la conversation actuellement ouverte ('agent:x', 'admin:x', 'tous')

const MSG_ICONE_CLOCHE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const MSG_ICONE_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const MSG_ICONE_RETOUR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const MSG_ICONE_ENVOYER =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.2 21 12 3 3.8v6.4L15 12 3 13.8v6.4Z"/></svg>';
const MSG_ICONE_FERMER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
const MSG_ICONE_SUPPR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const MSG_ICONE_ENVOYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const MSG_ICONE_VIDE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

function msgWho() {
  const admin = sessionStorage.getItem('coligo_admin_session');
  if (admin) { const a = JSON.parse(admin); return { type: 'admin', username: a.username, nom: a.nom_complet || a.username }; }
  const agent = sessionStorage.getItem('coligo_agent_session');
  if (agent) { const a = JSON.parse(agent); return { type: 'agent', username: a.username, nom: a.nom_complet }; }
  return null;
}

// ---------- Interface (identique partout) ----------

function msgConstruireInterface() {
  const root = msgEl('msg-root');
  if (!root || root.dataset.pret) return;
  root.dataset.pret = '1';

  root.innerHTML = `
    <div class="msg-shell" id="msg-shell">
      <aside class="msg-sidebar">
        <div class="msg-sidebar-head">
          <h3>Messagerie</h3>
          <button type="button" id="msg-nouvelle-btn" class="msg-nouvelle-btn" title="Nouvelle discussion" aria-label="Nouvelle discussion">${MSG_ICONE_PLUS}</button>
        </div>
        <div id="msg-conv-liste" class="msg-conv-liste"><p class="msg-conv-empty">Chargement…</p></div>
      </aside>

      <section class="msg-thread" id="msg-thread">
        <div class="msg-thread-vide" id="msg-thread-vide">
          ${MSG_ICONE_VIDE}
          <p>Choisissez une discussion, ou démarrez-en une nouvelle.</p>
        </div>

        <div id="msg-thread-ouverte" hidden style="display:contents;">
          <div class="msg-thread-head">
            <button type="button" id="msg-retour" class="msg-retour" aria-label="Retour aux discussions">${MSG_ICONE_RETOUR}</button>
            <div class="msg-avatar" id="msg-thread-avatar"></div>
            <div style="flex:1; min-width:0;">
              <div class="msg-thread-nom" id="msg-thread-nom"></div>
              <div class="msg-thread-sous" id="msg-thread-sous"></div>
            </div>
            <button type="button" id="msg-vider" class="msg-vider-btn" title="Supprimer toute la discussion de ma messagerie" aria-label="Supprimer la discussion">${MSG_ICONE_SUPPR}<span>Vider</span></button>
          </div>
          <div class="msg-bulles" id="msg-bulles"></div>
          <div id="msg-lecture-seule" class="msg-lecture-seule" hidden></div>
          <div id="msg-thread-erreur" class="msg-thread-erreur" hidden></div>
          <div class="msg-saisie" id="msg-saisie">
            <textarea id="msg-texte" rows="1" placeholder="Écrivez un message…"></textarea>
            <button type="button" id="msg-envoyer" class="msg-envoyer-btn" aria-label="Envoyer">${MSG_ICONE_ENVOYER}</button>
          </div>
        </div>
      </section>
    </div>`;

  msgEl('msg-nouvelle-btn').addEventListener('click', msgOuvrirNouvelle);
  msgEl('msg-retour').addEventListener('click', () => msgFermerConversation());
  msgEl('msg-envoyer').addEventListener('click', msgEnvoyer);
  msgEl('msg-vider').addEventListener('click', msgViderConversation);

  const texte = msgEl('msg-texte');
  texte.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); msgEnvoyer(); }
  });
  texte.addEventListener('input', () => {
    texte.style.height = 'auto';
    texte.style.height = Math.min(texte.scrollHeight, 120) + 'px';
  });

  msgEl('msg-conv-liste').addEventListener('click', (e) => {
    const item = e.target.closest('.msg-conv-item');
    if (item) msgOuvrirConversation(item.dataset.cle);
  });

  msgEl('msg-bulles').addEventListener('click', (e) => {
    const del = e.target.closest('.msg-bulle-supprimer');
    if (del) msgSupprimerMessage(del.dataset.id);
  });
}

// ---------- Cycle de vie ----------

async function initMessagerie() {
  msgMoi = msgWho();
  if (!msgMoi) return;

  msgMasques = new Set(); msgIdsConnus = new Set(); msgPremierChargement = true; msgConvOuverte = null;

  msgConstruireInterface();
  await msgChargerContacts();
  await msgChargerTout();
  msgAbonnerTempsReel();
}

async function msgChargerContacts() {
  const { data } = await supabaseClient.from('agents').select('id,username,nom_complet,agence,role');
  msgContacts = new Map();
  (data || []).forEach(a => {
    if (a.username === msgMoi.username) return;
    const type = a.role === 'administrateur' ? 'admin' : 'agent';
    msgContacts.set(type + ':' + a.username, a);
  });
}

// ---------- Chargement : mes messages envoyés + reçus, fusionnés ----------

async function msgChargerMasques() {
  const ids = new Set();
  try {
    const { data, error } = await supabaseClient.from('messages_masques')
      .select('message_id')
      .eq('utilisateur_type', msgMoi.type)
      .eq('utilisateur_username', msgMoi.username)
      .limit(5000);
    if (error) console.warn('messages_masques indisponible (exécutez sql/messagerie_conservation_migration.sql) :', error.message);
    else (data || []).forEach(r => ids.add(String(r.message_id)));
  } catch (e) { /* silencieux */ }
  msgMasques = ids;
  return ids;
}

async function msgChargerTout() {
  msgConstruireInterface();
  if (!msgMoi) { msgMoi = msgWho(); if (!msgMoi) return; }

  await msgChargerMasques();

  const requeteRecus = msgMoi.type === 'admin'
    ? supabaseClient.from('messages').select('*').eq('destinataire_type', 'admin').eq('destinataire_username', msgMoi.username)
    : supabaseClient.from('messages').select('*').or(`destinataire_username.eq.${msgMoi.username},destinataire_type.eq.tous`);

  const requeteEnvoyes = supabaseClient.from('messages').select('*')
    .eq('expediteur_type', msgMoi.type).eq('expediteur_username', msgMoi.username);

  const [{ data: recus, error: err1 }, { data: envoyes, error: err2 }] = await Promise.all([
    requeteRecus.order('created_at', { ascending: true }).limit(2000),
    requeteEnvoyes.order('created_at', { ascending: true }).limit(2000)
  ]);

  if (err1 || err2) {
    console.error('Chargement des messages impossible :', err1 || err2);
    msgEl('msg-conv-liste').innerHTML = '<p class="msg-conv-empty">Impossible de charger les messages. Réessayez.</p>';
    return;
  }

  const fusion = new Map();
  (recus || []).forEach(m => fusion.set(m.id, m));
  (envoyes || []).forEach(m => fusion.set(m.id, m));

  msgTous = [...fusion.values()]
    .filter(m => !msgMasques.has(String(m.id)))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Nouveau message = jamais vu depuis l'ouverture de cette session (pas au tout premier chargement).
  const nouveaux = msgTous.filter(m => !msgIdsConnus.has(String(m.id)) && m.expediteur_username !== msgMoi.username);
  msgTous.forEach(m => msgIdsConnus.add(String(m.id)));
  const etaitPremier = msgPremierChargement;
  msgPremierChargement = false;

  // Un nouveau message dans la discussion actuellement ouverte est marqué lu tout de suite.
  if (msgConvOuverte) msgMarquerConvLue(msgConvOuverte);

  if (!etaitPremier && nouveaux.length) {
    const horsConv = nouveaux.some(m => msgCleConversation(m) !== msgConvOuverte);
    if (horsConv || !msgConvOuverte) msgBip();
  }

  msgRendreListe();
  if (msgConvOuverte) msgRendreBulles();
}

// Clé de conversation d'un message, de MON point de vue.
function msgCleConversation(m) {
  if (m.destinataire_type === 'tous') return 'tous';
  if (m.expediteur_username === msgMoi.username) return m.destinataire_type + ':' + m.destinataire_username;
  return m.expediteur_type + ':' + m.expediteur_username;
}

function msgGroupes() {
  const groupes = new Map();

  // Pour un administrateur : « Tous les agents » est toujours épinglée, même vide.
  if (msgMoi.type === 'admin') {
    groupes.set('tous', { cle: 'tous', type: 'tous', username: null, nom: 'Tous les agents', sous: 'Diffusion', messages: [] });
  }

  msgTous.forEach(m => {
    const cle = msgCleConversation(m);
    if (!groupes.has(cle)) {
      let nom, sous, type, username;
      if (cle === 'tous') { nom = 'Tous les agents'; sous = 'Diffusion'; type = 'tous'; username = null; }
      else {
        [type, username] = cle.split(':');
        const contact = msgContacts.get(cle);
        const estMoi = m.expediteur_username === msgMoi.username;
        nom = contact ? contact.nom_complet : (estMoi ? username : (m.expediteur_nom || username));
        sous = contact ? (type === 'admin' ? 'Administration' : 'Agence de ' + (contact.agence || '—')) : (type === 'admin' ? 'Administration' : 'Agent');
      }
      groupes.set(cle, { cle, type, username, nom, sous, messages: [] });
    }
    groupes.get(cle).messages.push(m);
  });

  return [...groupes.values()].sort((a, b) => {
    const da = a.messages.length ? new Date(a.messages[a.messages.length - 1].created_at) : 0;
    const db = b.messages.length ? new Date(b.messages[b.messages.length - 1].created_at) : 0;
    if (a.cle === 'tous' && !a.messages.length) return db ? 1 : -1;
    return db - da;
  });
}

function msgCleLus() { return 'coligo_msg_lus_' + msgMoi.type + '_' + msgMoi.username; }
function msgLireLus() {
  try { return new Set(JSON.parse(localStorage.getItem(msgCleLus()) || '[]')); }
  catch (e) { return new Set(); }
}
function msgEcrireLus(set) {
  try { localStorage.setItem(msgCleLus(), JSON.stringify([...set].slice(-3000))); } catch (e) { /* silencieux */ }
}
function msgNonLusDe(g) {
  const lus = msgLireLus();
  return g.messages.filter(m => m.expediteur_username !== msgMoi.username && !lus.has(String(m.id))).length;
}
function msgMarquerConvLue(cle) {
  const g = msgGroupes().find(x => x.cle === cle);
  if (!g) return;
  const lus = msgLireLus();
  g.messages.forEach(m => lus.add(String(m.id)));
  msgEcrireLus(lus);
}

// ---------- Rendu : liste des discussions ----------

function msgRendreListe() {
  const zone = msgEl('msg-conv-liste');
  if (!zone) return;
  const groupes = msgGroupes();

  if (!groupes.length) {
    zone.innerHTML = '<p class="msg-conv-empty">Aucune discussion pour le moment.<br>Touchez « + » pour en démarrer une.</p>';
  } else {
    zone.innerHTML = groupes.map(g => {
      const dernier = g.messages[g.messages.length - 1];
      const nonLus = msgNonLusDe(g);
      const estMoiDernier = dernier && dernier.expediteur_username === msgMoi.username;
      const apercu = dernier ? (estMoiDernier ? 'Vous : ' : '') + msgEsc(String(dernier.contenu || '').replace(/\s+/g, ' ')) : 'Aucun message';
      return `
        <div class="msg-conv-item${g.cle === msgConvOuverte ? ' is-active' : ''}" data-cle="${msgEsc(g.cle)}">
          <div class="msg-avatar${g.type === 'tous' ? ' is-broadcast' : ''}" style="${g.type === 'tous' ? '' : `background:${msgCouleur(g.cle)}`}">
            ${g.type === 'tous' ? MSG_ICONE_CLOCHE : msgEsc(msgInitiales(g.nom))}
          </div>
          <div class="msg-conv-body">
            <div class="msg-conv-top">
              <span class="msg-conv-nom">${msgEsc(g.nom)}</span>
              ${dernier ? `<span class="msg-conv-heure">${msgHeure(dernier.created_at)}</span>` : ''}
            </div>
            <div class="msg-conv-bottom">
              <span class="msg-conv-apercu">${apercu}</span>
              ${nonLus ? `<span class="msg-conv-badge">${nonLus}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  msgMajPastille();
}

// Compteur rouge sur l'entrée « Messagerie » du menu (en dehors du composant).
function msgMajPastille() {
  const n = msgGroupes().reduce((total, g) => total + msgNonLusDe(g), 0);
  document.querySelectorAll('.msg-badge').forEach(el => {
    if (n > 0) { el.textContent = n; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

// ---------- Rendu : conversation ouverte (bulles) ----------

function msgOuvrirConversation(cle) {
  msgConvOuverte = cle;
  msgMarquerConvLue(cle);

  const shell = msgEl('msg-shell');
  shell.classList.add('is-thread-open');
  msgEl('msg-thread-vide').hidden = true;
  msgEl('msg-thread-ouverte').hidden = false;

  const g = msgGroupes().find(x => x.cle === cle) || { cle, nom: msgContacts.get(cle)?.nom_complet || cle, sous: '', type: cle.split(':')[0], messages: [] };

  const avatar = msgEl('msg-thread-avatar');
  avatar.className = 'msg-avatar' + (g.type === 'tous' ? ' is-broadcast' : '');
  avatar.style.background = g.type === 'tous' ? '' : msgCouleur(g.cle);
  avatar.innerHTML = g.type === 'tous' ? MSG_ICONE_CLOCHE : msgEsc(msgInitiales(g.nom));
  msgEl('msg-thread-nom').textContent = g.nom;
  msgEl('msg-thread-sous').textContent = g.sous || '';

  // Un agent ne peut pas écrire dans « Tous les agents » : lecture seule.
  const lectureSeule = g.cle === 'tous' && msgMoi.type !== 'admin';
  const zoneLS = msgEl('msg-lecture-seule');
  zoneLS.hidden = !lectureSeule;
  zoneLS.textContent = "Vous ne pouvez pas répondre à une diffusion. Ouvrez une discussion directe avec l'administrateur concerné.";
  msgEl('msg-saisie').style.display = lectureSeule ? 'none' : 'flex';

  msgEl('msg-thread-erreur').hidden = true;
  msgRendreBulles();
  msgRendreListe();

  if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
    msgEl('msg-texte').blur();
  } else {
    msgEl('msg-texte').focus({ preventScroll: true });
  }
}

function msgFermerConversation() {
  msgConvOuverte = null;
  msgEl('msg-shell').classList.remove('is-thread-open');
  msgEl('msg-thread-vide').hidden = false;
  msgEl('msg-thread-ouverte').hidden = true;
  msgRendreListe();
}

function msgRendreBulles() {
  const zone = msgEl('msg-bulles');
  if (!zone || !msgConvOuverte) return;
  const g = msgGroupes().find(x => x.cle === msgConvOuverte);
  const messages = g ? g.messages : [];

  if (!messages.length) {
    zone.innerHTML = '<p class="msg-conv-empty">Aucun message. Écrivez le premier !</p>';
    return;
  }

  let html = '';
  let dernierJour = null;
  messages.forEach(m => {
    const jour = msgJourLabel(m.created_at);
    if (jour !== dernierJour) { html += `<div class="msg-jour-separateur">${jour}</div>`; dernierJour = jour; }

    const estMoi = m.expediteur_username === msgMoi.username;
    const afficherAuteur = msgConvOuverte === 'tous' && !estMoi;

    html += `
      <div class="msg-bulle-ligne ${estMoi ? 'is-sent' : 'is-received'}">
        <div class="msg-bulle ${estMoi ? 'is-sent' : 'is-received'}" data-id="${m.id}">
          <button type="button" class="msg-bulle-supprimer" data-id="${m.id}" title="Supprimer de ma messagerie" aria-label="Supprimer ce message">${MSG_ICONE_SUPPR}</button>
          ${afficherAuteur ? `<div class="msg-bulle-auteur">${msgEsc(m.expediteur_nom)}</div>` : ''}
          <p class="msg-bulle-texte">${msgEsc(m.contenu)}</p>
          <div class="msg-bulle-pied">${msgHeure(m.created_at)} ${estMoi ? MSG_ICONE_ENVOYE : ''}</div>
        </div>
      </div>`;
  });

  const scrollEnBas = zone.scrollTop + zone.clientHeight >= zone.scrollHeight - 60;
  zone.innerHTML = html;
  if (scrollEnBas || zone.dataset.premier !== '1') {
    zone.scrollTop = zone.scrollHeight;
    zone.dataset.premier = '1';
  }
}

async function msgSupprimerMessage(id) {
  if (!confirm('Supprimer ce message de votre messagerie ?\n\nIl disparaît de votre discussion uniquement : l\'autre personne le garde tant qu\'elle ne l\'a pas supprimé elle aussi. Quand les deux l\'ont supprimé, il est effacé définitivement.')) return;

  const { error } = await supabaseClient.from('messages_masques').insert({
    message_id: Number(id),
    utilisateur_type: msgMoi.type,
    utilisateur_username: msgMoi.username
  });
  if (error && error.code !== '23505') {
    console.warn('Suppression indisponible :', error.message);
    return;
  }
  msgMasques.add(String(id));
  msgTous = msgTous.filter(m => String(m.id) !== String(id));
  msgRendreBulles();
  msgRendreListe();
}

// Vide TOUTE la discussion ouverte, de MA messagerie uniquement.
async function msgViderConversation() {
  if (!msgConvOuverte) return;
  const g = msgGroupes().find(x => x.cle === msgConvOuverte);
  const ids = g ? g.messages.map(m => m.id) : [];
  if (!ids.length) return;
  if (!confirm(`Supprimer les ${ids.length} message(s) de cette discussion de votre messagerie ?\n\nL'autre personne garde sa copie tant qu'elle ne l'a pas supprimée elle aussi.`)) return;

  const lignes = ids.map(id => ({ message_id: Number(id), utilisateur_type: msgMoi.type, utilisateur_username: msgMoi.username }));
  const { error } = await supabaseClient.from('messages_masques')
    .upsert(lignes, { onConflict: 'message_id,utilisateur_type,utilisateur_username', ignoreDuplicates: true });
  if (error) { console.warn('Suppression de la discussion impossible :', error.message); alert('Suppression impossible pour le moment. Réessayez.'); return; }

  const set = new Set(ids.map(String));
  set.forEach(id => msgMasques.add(id));
  msgTous = msgTous.filter(m => !set.has(String(m.id)));
  msgRendreBulles();
  msgRendreListe();
}

// ---------- Nouvelle discussion ----------

function msgOuvrirNouvelle() {
  const thread = msgEl('msg-thread');
  const existant = thread.querySelector('.msg-nouvelle-overlay');
  if (existant) { existant.remove(); return; }

  const agents = [...msgContacts.entries()].filter(([cle, c]) => c.role === 'agent');
  const admins = [...msgContacts.entries()].filter(([cle, c]) => c.role === 'administrateur');

  const ligne = ([cle, c]) => `
    <div class="msg-nouvelle-item" data-cle="${msgEsc(cle)}">
      <div class="msg-avatar" style="background:${msgCouleur(cle)}">${msgEsc(msgInitiales(c.nom_complet))}</div>
      <div>
        <span class="msg-conv-nom">${msgEsc(c.nom_complet)}</span>
        <div class="msg-conv-sous">${c.role === 'administrateur' ? 'Administration' : 'Agence de ' + msgEsc(c.agence || '—')}</div>
      </div>
    </div>`;

  const diffusion = msgMoi.type === 'admin'
    ? `<div class="msg-nouvelle-groupe-titre">Diffusion</div>
       <div class="msg-nouvelle-item" data-cle="tous">
         <div class="msg-avatar is-broadcast">${MSG_ICONE_CLOCHE}</div>
         <div><span class="msg-conv-nom">Tous les agents</span></div>
       </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'msg-nouvelle-overlay';
  overlay.innerHTML = `
    <div class="msg-nouvelle-panneau">
      <div class="msg-nouvelle-tete">
        <h4>Nouvelle discussion</h4>
        <button type="button" class="msg-nouvelle-fermer" aria-label="Fermer">${MSG_ICONE_FERMER}</button>
      </div>
      <div class="msg-nouvelle-liste">
        ${diffusion}
        ${admins.length ? '<div class="msg-nouvelle-groupe-titre">Administration</div>' + admins.map(ligne).join('') : ''}
        ${agents.length ? '<div class="msg-nouvelle-groupe-titre">Agents</div>' + agents.map(ligne).join('') : ''}
        ${(!admins.length && !agents.length) ? '<p class="msg-conv-empty">Aucun autre compte pour le moment.</p>' : ''}
      </div>
    </div>`;

  thread.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); return; }
    if (e.target.closest('.msg-nouvelle-fermer')) { overlay.remove(); return; }
    const item = e.target.closest('.msg-nouvelle-item');
    if (item) {
      overlay.remove();
      msgOuvrirConversation(item.dataset.cle);
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) msgEl('msg-shell').classList.add('is-thread-open');
    }
  });
}

// ---------- Bip sonore ----------
// Un seul bip bref (sinusoïde 1000 Hz, 0,22 s), coupé net : le volume monte en
// 4 ms et retombe à zéro en 6 ms pile à la fin (sans ce micro-fondu on entendrait
// un « clac »), puis l'oscillateur est arrêté et débranché. Jamais de boucle.
// Les navigateurs interdisent tout son tant que l'utilisateur n'a pas cliqué ou
// touché la page au moins une fois : le moteur audio est donc activé au premier geste.
let msgAudioCtx = null;
let msgDernierBip = 0;

function msgPreparerSon() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!msgAudioCtx) msgAudioCtx = new AC();
    if (msgAudioCtx.state === 'suspended') msgAudioCtx.resume();
  } catch (e) { /* silencieux */ }
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, msgPreparerSon, { passive: true }));

function msgBip() {
  const maintenant = Date.now();
  if (maintenant - msgDernierBip < 500) return;
  msgDernierBip = maintenant;
  try {
    msgPreparerSon();
    const ctx = msgAudioCtx;
    if (!ctx || ctx.state !== 'running') return;

    const debut = ctx.currentTime + 0.02;
    const duree = 0.22;
    const volume = 0.35;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, debut);
    gain.gain.setValueAtTime(0, debut);
    gain.gain.linearRampToValueAtTime(volume, debut + 0.004);
    gain.gain.setValueAtTime(volume, debut + duree - 0.006);
    gain.gain.linearRampToValueAtTime(0, debut + duree);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) { /* silencieux */ } };
    osc.start(debut);
    osc.stop(debut + duree);
  } catch (e) { /* le son ne doit jamais gêner la messagerie */ }
}

// ---------- Temps réel ----------

function msgAbonnerTempsReel() {
  if (msgChannel) supabaseClient.removeChannel(msgChannel);
  msgChannel = supabaseClient
    .channel('messagerie-' + (msgMoi.username || 'moi'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { msgChargerTout(); })
    .subscribe();
}

// ---------- Envoi ----------

async function msgEnvoyer() {
  const btn = msgEl('msg-envoyer');
  const zoneErreur = msgEl('msg-thread-erreur');
  const texteInput = msgEl('msg-texte');
  if (!texteInput || !msgConvOuverte) return;

  const contenu = texteInput.value.trim();
  zoneErreur.hidden = true;

  if (!msgMoi) {
    msgMoi = msgWho();
    if (!msgMoi) { zoneErreur.hidden = false; zoneErreur.textContent = 'Session expirée. Reconnectez-vous puis réessayez.'; return; }
  }
  if (!contenu) return;
  if (msgConvOuverte === 'tous' && msgMoi.type !== 'admin') return;

  btn.disabled = true;

  try {
    const [destType, destUsername] = msgConvOuverte === 'tous' ? ['tous', null] : msgConvOuverte.split(':');

    const payload = {
      expediteur_type: msgMoi.type,
      expediteur_username: msgMoi.username,
      expediteur_nom: msgMoi.nom,
      destinataire_type: destType,
      destinataire_username: destUsername,
      contenu
    };

    const { error } = await supabaseClient.from('messages').insert(payload);

    if (error) {
      console.error('Envoi du message impossible :', error);
      zoneErreur.hidden = false;
      zoneErreur.textContent = 'Envoi impossible : ' + (error.message || 'réessayez.');
      return;
    }

    texteInput.value = '';
    texteInput.style.height = 'auto';
    await msgChargerTout();
  } catch (e) {
    console.error('Erreur inattendue lors de l\'envoi du message :', e);
    zoneErreur.hidden = false;
    zoneErreur.textContent = 'Une erreur inattendue est survenue. Réessayez.';
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  msgConstruireInterface();

  // Rechargement de la page avec une session déjà ouverte : la page a affiché son
  // tableau de bord avant que ce fichier ne soit chargé, donc initMessagerie() n'a
  // pas pu être appelée. On l'appelle ici.
  if (!msgMoi && msgWho()) initMessagerie();
});
