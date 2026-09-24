// ==========================================================
// COLIGO — js/messagerie.js
// ==========================================================
// Messagerie interne, partagée À L'IDENTIQUE par agent.html,
// retrait.html et Admin.html : chaque page ne fournit qu'un
// conteneur vide <div id="msg-root"></div>, et toute l'interface
// (nouveau message, cloche, boîte de réception, bouton Répondre)
// est construite ici. Un seul code = trois espaces identiques.
//
// Table réelle : messages (voir sql/messagerie_migration.sql et
// sql/messagerie_admin_a_admin_migration.sql — cette dernière doit avoir
// été exécutée pour que la circulation agent -> admin fonctionne, car
// c'est elle qui autorise destinataire_type = 'admin' dans la table).
//
// Règles de circulation (appliquées ici, côté application) :
//   - Un agent peut écrire à un autre agent ou à un administrateur précis.
//     Sa boîte de réception reçoit les messages des autres agents ET les
//     messages/diffusions envoyés par un administrateur.
//   - Un administrateur écrit à un agent précis, à tous les agents
//     ('tous'), ou à un autre administrateur. Sa boîte de réception
//     reçoit les messages des agents qui lui écrivent directement ET
//     ceux des autres administrateurs.
//
// Conservation des discussions :
//   - Les messages ne sont JAMAIS effacés de la table `messages` par le site.
//   - « Supprimer » retire le message de MA boîte de réception seulement :
//     on enregistre « ce message est masqué pour moi » dans la table
//     `messages_masques` (voir sql/messagerie_conservation_migration.sql).
//     L'expéditeur et les autres destinataires (cas d'une diffusion « tous
//     les agents ») le gardent dans leur boîte.
//   - Chaque utilisateur ne peut donc supprimer que ce qui est dans SA boîte.
//
// Bip sonore : quand un nouveau message arrive (temps réel), un seul bip
// court est joué, qui s'arrête net (voir msgBip).
//
// Messages « non lus » : la base n'a pas de colonne « lu ». On mémorise
// donc, dans le navigateur (localStorage), les identifiants des messages
// déjà consultés dans la cloche. Le compteur rouge = messages jamais ouverts
// depuis ce navigateur.
// ==========================================================

function msgEsc(s) {
  return (s === null || s === undefined) ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function msgDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function msgEl(id) { return document.getElementById(id); }

let msgMoi = null;            // { type: 'admin'|'agent', username, nom }
let msgAgentsListe = [];      // agents pouvant recevoir un message
let msgAdminsListe = [];      // autres administrateurs
let msgInbox = [];            // messages reçus
let msgChannel = null;
let msgBoiteOuverte = false;  // la cloche est-elle dépliée ?
let msgSurlignes = new Set(); // messages « nouveaux » à mettre en évidence pendant que la boîte est ouverte
let msgReponseA = null;       // message auquel on est en train de répondre
let msgMasques = new Set();   // identifiants des messages que J'AI supprimés de ma boîte
let msgLimite = 200;          // nombre de messages affichés (extensible avec « Afficher plus »)
let msgAPlus = false;         // y a-t-il des messages plus anciens non affichés ?
let msgIdsConnus = new Set(); // messages déjà vus dans cette session (pour repérer les nouveaux)
let msgPremierChargement = true;

const MSG_ICONE_CLOCHE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

function msgWho() {
  const admin = sessionStorage.getItem('coliexpress_admin');
  if (admin) { const a = JSON.parse(admin); return { type: 'admin', username: a.username, nom: a.nom_complet || a.username }; }
  const agent = sessionStorage.getItem('coliexpress_agent');
  if (agent) { const a = JSON.parse(agent); return { type: 'agent', username: a.username, nom: a.nom_complet }; }
  return null;
}

// ---------- Interface (identique partout) ----------

function msgConstruireInterface() {
  const root = msgEl('msg-root');
  if (!root || root.dataset.pret) return;
  root.dataset.pret = '1';

  root.innerHTML = `
    <div class="msg-shell">
      <div class="msg-panel msg-toolbar">
        <p class="msg-intro">Écrivez à un collègue ou à l'administration. Vos messages reçus se consultent avec la cloche, et vous pouvez y répondre directement. Ils restent dans votre boîte tant que vous ne les supprimez pas vous-même.</p>
        <button type="button" id="msg-cloche" class="msg-cloche" aria-expanded="false" aria-controls="msg-boite">
          ${MSG_ICONE_CLOCHE}
          <span>Boîte de réception</span>
          <span id="msg-cloche-count" class="msg-cloche-count" hidden>0</span>
        </button>
      </div>

      <section id="msg-boite" class="msg-panel msg-boite" hidden aria-label="Messages reçus">
        <div class="msg-boite-tete">
          <h3>Messages reçus</h3>
          <button type="button" id="msg-boite-fermer" class="msg-lien">Fermer</button>
        </div>
        <div id="msg-liste" class="msg-boite-liste"><p class="msg-empty">Chargement…</p></div>
      </section>

      <section id="msg-nouveau" class="msg-panel">
        <h3>Nouveau message</h3>
        <div id="msg-reponse-chip" class="msg-chip" hidden></div>
        <div class="msg-field msg-field-court">
          <label for="msg-destinataire">Destinataire</label>
          <select id="msg-destinataire"><option value="">Choisir…</option></select>
        </div>
        <div class="msg-field">
          <label for="msg-texte">Message</label>
          <textarea id="msg-texte" rows="6" placeholder="Votre message…"></textarea>
        </div>
        <button type="button" id="msg-envoyer" class="msg-btn">Envoyer</button>
        <div id="msg-envoi-message" class="msg-envoi-message"></div>
      </section>
    </div>`;

  msgEl('msg-cloche').addEventListener('click', () => msgBasculerBoite());
  msgEl('msg-boite-fermer').addEventListener('click', () => msgBasculerBoite(false));
  msgEl('msg-envoyer').addEventListener('click', msgEnvoyer);
  msgEl('msg-destinataire').addEventListener('change', () => {
    // Si on change de destinataire, on n'est plus en train de répondre à ce message.
    if (msgReponseA && msgEl('msg-destinataire').value !== msgValeurReponse(msgReponseA)) msgAnnulerReponse();
  });
  msgEl('msg-reponse-chip').addEventListener('click', (e) => {
    if (e.target.closest('.msg-chip-annuler')) msgAnnulerReponse();
  });

  // Boutons Répondre / Supprimer (délégation : la liste est re-générée à chaque rendu)
  msgEl('msg-liste').addEventListener('click', async (e) => {
    const rep = e.target.closest('.msg-reply');
    if (rep) { msgRepondre(rep.dataset.id); return; }
    const del = e.target.closest('.msg-delete');
    if (del) {
      if (!confirm('Supprimer ce message de votre boîte de réception ?\n\nIl sera retiré de votre boîte uniquement : les autres personnes concernées le conservent.')) return;
      del.disabled = true;
      del.textContent = '…';
      await msgSupprimerDeMaBoite(del.dataset.id);
      return;
    }
    if (e.target.closest('#msg-plus')) {
      msgLimite += 200;
      await msgChargerBoite({ silencieux: true });   // messages anciens : pas de bip
    }
  });
}

// ---------- Cycle de vie ----------

// Appelée depuis chaque page une fois le tableau de bord affiché.
async function initMessagerie() {
  msgMoi = msgWho();
  if (!msgMoi) return;

  // Nouvelle session : on repart d'un état propre (évite tout mélange entre deux comptes).
  msgMasques = new Set(); msgIdsConnus = new Set(); msgPremierChargement = true; msgLimite = 200;

  msgConstruireInterface();
  await msgChargerContacts();
  await msgChargerBoite();
  msgAbonnerTempsReel();
}

async function msgChargerContacts() {
  const { data } = await supabaseClient.from('agents').select('id,username,nom_complet,agence,role');
  const tous = data || [];
  msgAgentsListe = tous.filter(a => a.role === 'agent' && a.username !== msgMoi.username);
  msgAdminsListe = tous.filter(a => a.role === 'administrateur' && a.username !== msgMoi.username);
  msgRemplirDestinataires();
}

function msgRemplirDestinataires() {
  const sel = msgEl('msg-destinataire');
  if (!sel) return;

  const agentsOpts = msgAgentsListe.map(a => `<option value="agent:${msgEsc(a.username)}">${msgEsc(a.nom_complet)} — Agence de ${msgEsc(a.agence)}</option>`).join('');
  const adminsOpts = msgAdminsListe.map(a => `<option value="admin:${msgEsc(a.username)}">${msgEsc(a.nom_complet)} — Administration</option>`).join('');

  if (msgMoi.type === 'admin') {
    sel.innerHTML =
      `<option value="">Choisir…</option>` +
      `<option value="tous">Tous les agents (actifs et inactifs)</option>` +
      (agentsOpts ? `<optgroup label="Agents">${agentsOpts}</optgroup>` : '') +
      (adminsOpts ? `<optgroup label="Autres administrateurs">${adminsOpts}</optgroup>` : '');
  } else {
    sel.innerHTML =
      `<option value="">Choisir…</option>` +
      (agentsOpts ? `<optgroup label="Agents">${agentsOpts}</optgroup>` : '') +
      (adminsOpts ? `<optgroup label="Administration">${adminsOpts}</optgroup>` : '');
  }
}

async function msgChargerBoite(options) {
  const silencieux = !!(options && options.silencieux);
  msgConstruireInterface();
  const zone = msgEl('msg-liste');
  if (!zone) return;
  if (!msgMoi) { msgMoi = msgWho(); if (!msgMoi) return; }

  // Ce que J'ai supprimé de ma boîte (et rien d'autre).
  const masques = await msgChargerMasques();

  // Reçus : un administrateur ne reçoit que ce qui lui est adressé ; un agent
  // reçoit ce qui lui est adressé + les diffusions « tous les agents ».
  const requete = msgMoi.type === 'admin'
    ? supabaseClient.from('messages').select('*')
        .eq('destinataire_type', 'admin').eq('destinataire_username', msgMoi.username)
    : supabaseClient.from('messages').select('*')
        .or(`destinataire_username.eq.${msgMoi.username},destinataire_type.eq.tous`);

  // On demande « limite + nombre de masqués » pour que les messages supprimés
  // ne prennent pas la place des autres dans la page affichée.
  const taille = msgLimite + masques.size;
  const { data, error } = await requete.order('created_at', { ascending: false }).limit(taille);
  if (error) {
    console.error('Chargement des messages impossible :', error);
    zone.innerHTML = '<p class="msg-empty">Impossible de charger les messages. Réessayez.</p>';
    return;
  }
  const recus = data || [];
  msgAPlus = recus.length >= taille;
  msgInbox = recus.filter(m => !masques.has(String(m.id)));

  // Nouveau message = un identifiant jamais vu depuis l'ouverture de cette session.
  // (Au tout premier chargement, les messages déjà présents ne font pas « bip ».)
  // Les identifiants sont mémorisés AVANT le bip : deux chargements simultanés
  // ne peuvent donc pas déclencher deux bips pour le même message.
  const nouveaux = msgInbox.filter(m => !msgIdsConnus.has(String(m.id)));
  msgInbox.forEach(m => msgIdsConnus.add(String(m.id)));
  const etaitPremier = msgPremierChargement;
  msgPremierChargement = false;
  if (!etaitPremier && !silencieux && nouveaux.length) msgBip();

  // Un message qui arrive pendant que la cloche est ouverte est mis en évidence,
  // puis considéré comme lu (on est en train de le regarder).
  if (msgBoiteOuverte) {
    msgNonLus().forEach(m => msgSurlignes.add(String(m.id)));
    msgMarquerLus();
  }
  msgRendreBoite();
}

// ---------- Suppression = retirer de MA boîte, sans rien effacer ----------

function msgCleMasquesLocaux() { return 'coligo_msg_masques_' + msgMoi.type + '_' + msgMoi.username; }
function msgLireMasquesLocaux() {
  try { return JSON.parse(localStorage.getItem(msgCleMasquesLocaux()) || '[]').map(String); }
  catch (e) { return []; }
}

async function msgChargerMasques() {
  // Repli : si la table `messages_masques` n'existe pas encore (migration pas exécutée),
  // les messages supprimés sont masqués seulement dans ce navigateur (voir msgSupprimerDeMaBoite).
  const ids = new Set(msgLireMasquesLocaux());
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

async function msgSupprimerDeMaBoite(id) {
  const { error } = await supabaseClient.from('messages_masques').insert({
    message_id: Number(id),
    utilisateur_type: msgMoi.type,
    utilisateur_username: msgMoi.username
  });
  // 23505 = déjà masqué : sans importance.
  if (error && error.code !== '23505') {
    console.warn('Suppression enregistrée seulement dans ce navigateur :', error.message);
    try {
      const locaux = new Set(msgLireMasquesLocaux()); locaux.add(String(id));
      localStorage.setItem(msgCleMasquesLocaux(), JSON.stringify([...locaux].slice(-2000)));
    } catch (e) { /* silencieux */ }
  }
  msgMasques.add(String(id));
  msgInbox = msgInbox.filter(m => String(m.id) !== String(id));
  msgRendreBoite();
}

// ---------- Bip sonore ----------
// Un seul bip bref (sinusoïde 1000 Hz, 0,22 s), coupé net : le volume monte en
// 4 ms et retombe à zéro en 6 ms pile à la fin (sans ce micro-fondu on entendrait
// un « clac »), puis l'oscillateur est arrêté et débranché. Jamais de boucle, jamais de
// résonance.
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
  if (maintenant - msgDernierBip < 500) return;   // plusieurs messages d'un coup = un seul bip
  msgDernierBip = maintenant;
  try {
    msgPreparerSon();
    const ctx = msgAudioCtx;
    // Pas encore de geste de l'utilisateur : on ne programme rien (sinon le bip
    // se jouerait en retard, au premier clic).
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

// ---------- Lu / non lu (mémorisé dans ce navigateur) ----------

function msgCleLus() { return 'coliexpress_msg_lus_' + msgMoi.type + '_' + msgMoi.username; }
function msgLireLus() {
  try { return new Set(JSON.parse(localStorage.getItem(msgCleLus()) || '[]')); }
  catch (e) { return new Set(); }
}
function msgNonLus() {
  if (!msgMoi) return [];
  const lus = msgLireLus();
  return msgInbox.filter(m => !lus.has(String(m.id)));
}
function msgMarquerLus() {
  const lus = msgLireLus();
  msgInbox.forEach(m => lus.add(String(m.id)));
  try { localStorage.setItem(msgCleLus(), JSON.stringify([...lus].slice(-1000))); } catch (e) { /* silencieux */ }
}

// ---------- Cloche et boîte de réception ----------

function msgBasculerBoite(ouvrir) {
  const boite = msgEl('msg-boite');
  const cloche = msgEl('msg-cloche');
  if (!boite || !cloche) return;
  msgBoiteOuverte = (ouvrir === undefined) ? boite.hidden : ouvrir;
  boite.hidden = !msgBoiteOuverte;
  cloche.setAttribute('aria-expanded', String(msgBoiteOuverte));

  if (msgBoiteOuverte) {
    msgSurlignes = new Set(msgNonLus().map(m => String(m.id)));
    msgMarquerLus();
    msgRendreBoite();
    boite.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    msgSurlignes = new Set();
    msgRendreBoite();
  }
}

// Nom lisible + rôle de l'expéditeur.
function msgExpediteurLibelle(m) {
  if (m.expediteur_type === 'admin') return msgEsc(m.expediteur_nom) + ' · Administration';
  if (msgMoi && msgMoi.type === 'admin') return msgEsc(m.expediteur_nom) + ' · Agent';
  return msgEsc(m.expediteur_nom);
}

function msgCarteHtml(m) {
  const nouveau = msgSurlignes.has(String(m.id));
  // Les anciens messages d'un admin n'ont pas d'identifiant d'expéditeur : impossible d'y répondre.
  const peutRepondre = !!m.expediteur_username;
  return `
    <div class="msg-card${nouveau ? ' is-new' : ''}" data-id="${m.id}">
      <div class="msg-card-top">
        <span class="msg-from">${nouveau ? '<span class="msg-dot" title="Nouveau"></span>' : ''}${msgExpediteurLibelle(m)}</span>
        <span class="msg-time">${msgDate(m.created_at)}</span>
      </div>
      <p class="msg-content">${msgEsc(m.contenu)}</p>
      <div class="msg-actions">
        ${peutRepondre ? `<button type="button" class="msg-reply" data-id="${m.id}">Répondre</button>` : ''}
        <button type="button" class="msg-delete" data-id="${m.id}" title="Supprimer">Supprimer</button>
      </div>
    </div>`;
}

function msgRendreBoite() {
  const zone = msgEl('msg-liste');
  if (zone) {
    zone.innerHTML = (msgInbox.length
      ? msgInbox.map(msgCarteHtml).join('')
      : '<p class="msg-empty">Aucun message reçu pour le moment.</p>')
      + (msgAPlus ? '<div style="text-align:center; padding:10px 0 2px;"><button type="button" id="msg-plus" class="msg-lien">Afficher les messages plus anciens</button></div>' : '');
  }
  msgMajPastille();
}

// Compteur rouge : sur la cloche, et sur l'entrée « Messagerie » du menu.
function msgMajPastille() {
  const n = msgNonLus().length;

  const c = msgEl('msg-cloche-count');
  if (c) { c.textContent = n; c.hidden = n === 0; }
  const cloche = msgEl('msg-cloche');
  if (cloche) cloche.setAttribute('aria-label', n ? `Boîte de réception, ${n} nouveau${n > 1 ? 'x' : ''} message${n > 1 ? 's' : ''}` : 'Boîte de réception');

  document.querySelectorAll('.msg-badge').forEach(el => {
    if (n > 0) { el.textContent = n; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

function msgAbonnerTempsReel() {
  if (msgChannel) supabaseClient.removeChannel(msgChannel);
  msgChannel = supabaseClient
    .channel('messagerie-' + (msgMoi.username || 'moi'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { msgChargerBoite(); })
    .subscribe();
}

// ---------- Répondre ----------

function msgValeurReponse(m) { return m.expediteur_type + ':' + m.expediteur_username; }

function msgRepondre(id) {
  const m = msgInbox.find(x => String(x.id) === String(id));
  if (!m || !m.expediteur_username) return;

  const sel = msgEl('msg-destinataire');
  const valeur = msgValeurReponse(m);
  // L'expéditeur peut ne pas figurer dans la liste (compte supprimé, etc.) : on l'ajoute.
  if (![...sel.options].some(o => o.value === valeur)) {
    const o = document.createElement('option');
    o.value = valeur;
    o.textContent = m.expediteur_nom || m.expediteur_username;
    sel.appendChild(o);
  }
  sel.value = valeur;
  msgReponseA = m;

  const extrait = String(m.contenu || '').replace(/\s+/g, ' ').trim();
  const chip = msgEl('msg-reponse-chip');
  chip.innerHTML =
    `<span>Réponse à <strong>${msgEsc(m.expediteur_nom || m.expediteur_username)}</strong> — « ${msgEsc(extrait.length > 90 ? extrait.slice(0, 90) + '…' : extrait)} »</span>` +
    `<button type="button" class="msg-chip-annuler" aria-label="Annuler la réponse">Annuler</button>`;
  chip.hidden = false;

  msgBasculerBoite(false);
  msgEl('msg-nouveau').scrollIntoView({ behavior: 'smooth', block: 'start' });
  msgEl('msg-texte').focus({ preventScroll: true });
}

function msgAnnulerReponse() {
  msgReponseA = null;
  const chip = msgEl('msg-reponse-chip');
  if (chip) { chip.hidden = true; chip.innerHTML = ''; }
}

// ---------- Envoi ----------

async function msgEnvoyer() {
  const btn = msgEl('msg-envoyer');
  const zone = msgEl('msg-envoi-message');
  const destSelect = msgEl('msg-destinataire');
  const texteInput = msgEl('msg-texte');
  if (!zone || !destSelect || !texteInput) return;

  const destRaw = destSelect.value;
  const contenu = texteInput.value.trim();
  zone.innerHTML = '';

  // Garde-fou : si la messagerie n'a pas encore fini de s'initialiser
  // (page rechargée trop vite), on le dit clairement au lieu de ne rien faire.
  if (!msgMoi) {
    msgMoi = msgWho();
    if (!msgMoi) {
      zone.innerHTML = '<div class="msg-error">Session expirée. Reconnectez-vous puis réessayez.</div>';
      return;
    }
  }
  if (!destRaw) { zone.innerHTML = '<div class="msg-error">Choisissez un destinataire.</div>'; return; }
  if (!contenu) { zone.innerHTML = '<div class="msg-error">Écrivez un message avant d\'envoyer.</div>'; return; }

  setBtnLoading(btn, 'Envoi…');

  try {
    // "tous" (uniquement pour un admin) ; sinon "agent:username" ou "admin:username".
    const [destType, destUsername] = destRaw === 'tous' ? ['tous', null] : destRaw.split(':');

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
      zone.innerHTML = `<div class="msg-error">Envoi impossible : ${msgEsc(error.message || 'réessayez.')}</div>`;
      return;
    }

    texteInput.value = '';
    msgAnnulerReponse();
    zone.innerHTML = '<div class="msg-success">Message envoyé.</div>';
    setTimeout(() => { zone.innerHTML = ''; }, 2500);
  } catch (e) {
    console.error('Erreur inattendue lors de l\'envoi du message :', e);
    zone.innerHTML = '<div class="msg-error">Une erreur inattendue est survenue. Réessayez.</div>';
  } finally {
    clearBtnLoading(btn);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  msgConstruireInterface();

  // Rechargement de la page avec une session déjà ouverte : la page a affiché son
  // tableau de bord avant que ce fichier ne soit chargé, donc initMessagerie() n'a
  // pas pu être appelée. On l'appelle ici (liste des destinataires, boîte, temps réel).
  if (!msgMoi && msgWho()) initMessagerie();
});
