// ==========================================================
// COLIGO — Admin.html — Conservation des données (cycle de vie)
// ----------------------------------------------------------
// S'appuie sur sql/cycle_de_vie_donnees_migration.sql.
// Toute suppression passe par des fonctions de la base :
//   - automatique : lifecycle_auto() (1 fois / 20 h max, à l'ouverture des espaces)
//                   ou lifecycle_cron() si pg_cron est activé ;
//   - manuelle    : lifecycle_executer_manuel() et lifecycle_supprimer_colis(),
//                   qui exigent le mot de passe d'un administrateur.
// Chaque passage est inscrit dans le journal (purge_journal).
// Dépend de admin.js (esc, formatDateTime, getSession, closeModal).
// ==========================================================

const CDV_CATEGORIES = [
  { cle: 'anonymisation', label: 'Anonymisation des retraits',
    regle: r => `CNI et téléphones masqués ${r.retraits_anonymisation_jours} j après le retrait (le reste de la fiche est conservé)` },
  { cle: 'colis_retires', label: 'Colis retirés (dossiers clos)',
    regle: r => `Chiffres versés dans les statistiques archivées, puis colis + historique + fiche de retrait supprimés ${r.colis_retires_conservation_jours} j après le retrait` },
  { cle: 'listings', label: 'Listings vides',
    regle: r => `Listings sans aucun colis rattaché, supprimés après ${r.listings_vides_jours} j` },
  { cle: 'messages', label: 'Messages',
    regle: r => `Supprimés ${r.messages_conservation_jours} j après leur envoi` },
  { cle: 'codes', label: 'Codes « mot de passe oublié »',
    regle: r => `Codes utilisés ou expirés, supprimés après ${r.codes_techniques_heures} h` },
  { cle: 'tentatives', label: 'Compteurs de connexion ratée',
    regle: r => `Remis à zéro ${r.codes_techniques_heures} h après la fin du verrouillage` },
  { cle: 'presence', label: 'Présence « en ligne » bloquée',
    regle: r => `Agent repassé « hors ligne » après ${r.presence_expiration_heures} h sans nouvelle connexion` },
  { cle: 'agents', label: 'Comptes agents désactivés',
    regle: r => `Supprimés ${r.agents_desactives_suppression_jours ?? 30} j après la désactivation s'ils n'ont pas été réactivés (leurs activités restent)` },
  { cle: 'journal', label: 'Journal des nettoyages',
    regle: r => `Entrées du journal supprimées après ${r.journal_conservation_jours} j` }
];

const CDV_CHAMPS_REGLES = [
  { cle: 'retraits_anonymisation_jours', label: 'Anonymiser les retraits après', unite: 'jours', min: 30 },
  { cle: 'colis_retires_conservation_jours', label: 'Supprimer les colis retirés après', unite: 'jours', min: 90 },
  { cle: 'non_reclames_alerte_jours', label: 'Signaler un colis non réclamé après', unite: 'jours', min: 7 },
  { cle: 'non_reclames_suppression_jours', label: 'Autoriser la suppression manuelle d\u2019un non réclamé après', unite: 'jours', min: 60 },
  { cle: 'listings_vides_jours', label: 'Supprimer les listings vides après', unite: 'jours', min: 7 },
  { cle: 'messages_conservation_jours', label: 'Supprimer les messages après', unite: 'jours', min: 30 },
  { cle: 'codes_techniques_heures', label: 'Purger les codes et compteurs après', unite: 'heures', min: 1 },
  { cle: 'presence_expiration_heures', label: 'Présence expirée après', unite: 'heures', min: 2 },
  { cle: 'agents_desactives_suppression_jours', label: 'Supprimer un compte agent désactivé après', unite: 'jours', min: 7 },
  { cle: 'journal_conservation_jours', label: 'Conserver le journal', unite: 'jours', min: 180 }
];

const CDV_LIBELLES_JOURNAL = {
  anonymisation: 'retrait(s) anonymisé(s)', colis_retires: 'colis retiré(s) supprimé(s)',
  listings: 'listing(s) vide(s)', messages: 'message(s)', codes: 'code(s)',
  tentatives: 'compteur(s) de connexion', presence: 'présence(s) corrigée(s)', agents: 'compte(s) agent supprimé(s)', journal: 'entrée(s) de journal'
};

let cdvEtat = { regles: null, apercu: null, nonReclames: [], journal: [] };
let cdvInitialise = false;

function cdvEl(id) { return document.getElementById(id); }

// ---------- Chargement ----------

async function initCycleVie() {
  const root = cdvEl('cdv-root');
  if (!root) return;
  root.innerHTML = '<div class="table-state">Chargement…</div>';

  const [regles, apercu, nonRec, journal] = await Promise.all([
    supabaseClient.rpc('lifecycle_regles'),
    supabaseClient.rpc('lifecycle_apercu'),
    supabaseClient.rpc('lifecycle_non_reclames'),
    supabaseClient.rpc('lifecycle_journal', { p_limite: 50 })
  ]);

  if (regles.error || !regles.data) {
    root.innerHTML = `
      <div class="admin-card">
        <div class="admin-info-box">
          Le cycle de vie des données n'est pas encore activé dans la base.
          Exécutez <strong>sql/cycle_de_vie_donnees_migration.sql</strong> dans Supabase
          (SQL Editor &gt; New query &gt; coller &gt; Run), puis actualisez cette page.
        </div>
      </div>`;
    return;
  }

  cdvEtat.regles = regles.data;
  cdvEtat.apercu = (apercu.data && apercu.data.details) || {};
  cdvEtat.nonReclames = nonRec.data || [];
  cdvEtat.journal = journal.data || [];
  cdvRendre();
  cdvInitialise = true;
}

// ---------- Rendu ----------

function cdvRendre() {
  const r = cdvEtat.regles;
  const a = cdvEtat.apercu;
  const root = cdvEl('cdv-root');

  const derniere = r.derniere_execution_auto ? formatDateTime(r.derniere_execution_auto) : 'jamais';
  const etatAuto = r.purge_auto_active
    ? `<span class="badge-online">Automatique activé</span>`
    : `<span class="badge-offline">Automatique désactivé</span>`;

  root.innerHTML = `
    <div class="admin-card">
      <h3>Le cycle de vie d'un colis</h3>
      <div class="cdv-timeline">
        <div class="cdv-step"><div class="cdv-dot st-a"></div><div class="cdv-t">Enregistré → En transit → Disponible</div><div class="cdv-s">Vie active, rien n'est supprimé</div></div>
        <div class="cdv-step"><div class="cdv-dot st-b"></div><div class="cdv-t">Retiré</div><div class="cdv-s">Dossier clos, visible dans l'historique</div></div>
        <div class="cdv-step"><div class="cdv-dot st-c"></div><div class="cdv-t">J+${r.retraits_anonymisation_jours}</div><div class="cdv-s">CNI et téléphones masqués</div></div>
        <div class="cdv-step"><div class="cdv-dot st-d"></div><div class="cdv-t">J+${r.colis_retires_conservation_jours}</div><div class="cdv-s">Chiffres archivés, colis supprimé</div></div>
      </div>
      <p class="muted-admin" style="font-size:0.82rem; margin:12px 0 0;">
        Un colis « Disponible » jamais retiré n'est <strong>jamais supprimé automatiquement</strong> :
        il est signalé après ${r.non_reclames_alerte_jours} jours, et un administrateur peut le supprimer
        manuellement à partir de ${r.non_reclames_suppression_jours} jours, avec un motif.
        Les rapports restent justes après suppression grâce aux statistiques archivées.
      </p>
    </div>

    <div class="admin-card">
      <h3>Ce qui peut être nettoyé aujourd'hui ${etatAuto}</h3>
      <p class="muted-admin" style="font-size:0.82rem; margin:-4px 0 10px;">
        Dernier passage automatique : ${esc(derniere)}. Le passage automatique a lieu au plus une fois
        toutes les 20 heures, dès qu'un espace (agent, retraits ou admin) est ouvert.
      </p>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th></th><th>Catégorie</th><th>Règle appliquée</th><th>Éligible maintenant</th></tr></thead>
        <tbody>
          ${CDV_CATEGORIES.map(cat => {
            const n = Number(a[cat.cle] || 0);
            return `<tr>
              <td data-label="Choisir"><input type="checkbox" class="cdv-cat" value="${cat.cle}" ${n > 0 ? 'checked' : ''}></td>
              <td data-label="Catégorie"><strong>${esc(cat.label)}</strong></td>
              <td data-label="Règle">${esc(cat.regle(r))}</td>
              <td data-label="Éligible">${n > 0 ? `<strong>${n}</strong>` : '<span class="muted-admin">0</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      <div class="filter-bar" style="margin-top:12px;">
        <button class="admin-btn small danger" id="cdv-btn-executer">Nettoyer maintenant la sélection</button>
        <button class="admin-btn small ghost" id="cdv-btn-actualiser">Actualiser</button>
      </div>
      <div id="cdv-exec-msg"></div>
    </div>

    <div class="admin-card">
      <h3>Colis non réclamés <span class="muted-admin" style="font-weight:500; font-size:0.78rem;">${cdvEtat.nonReclames.length} colis « Disponible » depuis plus de ${r.non_reclames_alerte_jours} jours</span></h3>
      <p class="muted-admin" style="font-size:0.82rem; margin:-4px 0 10px;">
        Conseil : relancez le destinataire par téléphone avant toute suppression. La suppression ne devient
        possible qu'après ${r.non_reclames_suppression_jours} jours et reste tracée dans le journal.
      </p>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Tracking</th><th>Destinataire</th><th>Téléphone</th><th>Agence</th><th>Disponible depuis</th><th>Attente</th><th>Action</th></tr></thead>
        <tbody>
          ${cdvEtat.nonReclames.length ? cdvEtat.nonReclames.map(c => `
            <tr>
              <td data-label="Tracking">${esc(c.numero_suivi)}</td>
              <td data-label="Destinataire">${esc(c.destinataire_nom) || '—'}</td>
              <td data-label="Téléphone">${esc(c.destinataire_telephone) || '—'}</td>
              <td data-label="Agence">${esc(c.agence) || '—'}</td>
              <td data-label="Depuis">${formatDateTime(c.disponible_depuis)}</td>
              <td data-label="Attente"><strong>${c.jours} j</strong></td>
              <td data-label="Action">${c.supprimable
                ? `<button class="admin-btn small danger cdv-suppr" data-id="${esc(c.id)}" data-num="${esc(c.numero_suivi)}">Supprimer</button>`
                : `<span class="muted-admin">Possible dans ${Math.max(r.non_reclames_suppression_jours - c.jours, 0)} j</span>`}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="table-state">Aucun colis non réclamé. Tout est en ordre.</td></tr>'}
        </tbody>
      </table></div>
    </div>

    <div class="admin-card">
      <h3>Règles de conservation</h3>
      <div class="cdv-regles">
        <label class="cdv-toggle">
          <input type="checkbox" id="cdv-auto" ${r.purge_auto_active ? 'checked' : ''}>
          <span>Nettoyage automatique activé</span>
        </label>
        ${CDV_CHAMPS_REGLES.map(f => `
          <div class="f-group">
            <label for="cdv-${f.cle}">${esc(f.label)} <span class="muted-admin">(${f.unite}, min. ${f.min})</span></label>
            <input type="number" id="cdv-${f.cle}" min="${f.min}" step="1" value="${Number(r[f.cle] ?? (f.cle === 'agents_desactives_suppression_jours' ? 30 : f.min))}">
          </div>`).join('')}
      </div>
      <p class="muted-admin" style="font-size:0.8rem; margin:10px 0;">
        ${r.updated_by ? `Dernière modification par ${esc(r.updated_by)}, le ${formatDateTime(r.updated_at)}.` : 'Valeurs par défaut.'}
        Des minimums sont imposés par la base pour éviter qu'une erreur de saisie efface des données trop tôt.
      </p>
      <button class="admin-btn small" id="cdv-btn-regles">Enregistrer les règles</button>
      <div id="cdv-regles-msg" style="margin-top:10px;"></div>
    </div>

    <div class="admin-card">
      <h3>Journal des nettoyages</h3>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Date</th><th>Type</th><th>Par</th><th>Détail</th></tr></thead>
        <tbody>
          ${cdvEtat.journal.length ? cdvEtat.journal.map(j => `
            <tr>
              <td data-label="Date">${formatDateTime(j.executed_at)}</td>
              <td data-label="Type">${esc(cdvLibelleDeclencheur(j.declencheur))}</td>
              <td data-label="Par">${esc(j.execute_par) || '—'}</td>
              <td data-label="Détail">${cdvDetailJournal(j)}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="table-state">Aucun nettoyage pour le moment.</td></tr>'}
        </tbody>
      </table></div>
    </div>
  `;

  cdvEl('cdv-btn-actualiser').addEventListener('click', initCycleVie);
  cdvEl('cdv-btn-executer').addEventListener('click', cdvDemanderExecution);
  cdvEl('cdv-btn-regles').addEventListener('click', cdvDemanderRegles);
  root.querySelectorAll('.cdv-suppr').forEach(b => b.addEventListener('click', () =>
    cdvDemanderSuppressionColis({ id: b.dataset.id, numero_suivi: b.dataset.num }, true)));
}

function cdvLibelleDeclencheur(d) {
  return ({ auto: 'Automatique', cron: 'Automatique (planifié)', manuel: 'Manuel', colis: 'Suppression d\u2019un colis' })[d] || d;
}

function cdvDetailJournal(j) {
  const d = j.details || {};
  if (j.declencheur === 'colis') {
    return `Colis <strong>${esc(d.numero_suivi)}</strong> (${esc(d.statut)}${d.non_reclame ? ', non réclamé' : ''}) — motif : ${esc(d.motif)}`;
  }
  if (d.regles_modifiees) return 'Règles de conservation modifiées';
  if (d.compte_desactive) return `Compte <strong>${esc(d.compte_desactive)}</strong> désactivé — motif : ${esc(d.motif)}`;
  if (d.compte_reactive) return `Compte <strong>${esc(d.compte_reactive)}</strong> réactivé`;
  const parts = Object.keys(CDV_LIBELLES_JOURNAL)
    .filter(k => Number(d[k] || 0) > 0)
    .map(k => `${d[k]} ${CDV_LIBELLES_JOURNAL[k]}`);
  return parts.length ? esc(parts.join(', ')) : '<span class="muted-admin">Rien à nettoyer</span>';
}

// ---------- Fenêtre de confirmation par mot de passe ----------

function cdvConfirmer({ titre, texte, avecMotif, libelleBouton, action, motifPlaceholder, sansDanger }) {
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h3>${esc(titre)}</h3>
    <div class="modal-sub">${texte}</div>
    ${avecMotif ? `
      <div class="admin-field">
        <label>Motif (obligatoire, conservé dans le journal)</label>
        <input type="text" id="cdv-motif" placeholder="${esc(motifPlaceholder || 'Ex. : destinataire injoignable depuis 3 mois')}">
      </div>` : ''}
    <div class="admin-field">
      <label>Votre mot de passe administrateur</label>
      <input type="password" id="cdv-mdp" autocomplete="current-password">
    </div>
    <div id="cdv-modal-msg"></div>
    <div class="filter-bar">
      <button class="admin-btn small ${sansDanger ? '' : 'danger'}" id="cdv-modal-ok">${esc(libelleBouton)}</button>
      <button class="admin-btn small ghost" id="cdv-modal-annuler">Annuler</button>
    </div>
  `;
  document.getElementById('modal-backdrop').classList.remove('hidden');
  setTimeout(() => { const f = cdvEl(avecMotif ? 'cdv-motif' : 'cdv-mdp'); if (f) f.focus(); }, 50);

  cdvEl('cdv-modal-annuler').addEventListener('click', closeModal);
  cdvEl('cdv-modal-ok').addEventListener('click', async () => {
    const btn = cdvEl('cdv-modal-ok');
    const mdp = cdvEl('cdv-mdp').value;
    const motif = avecMotif ? cdvEl('cdv-motif').value.trim() : null;
    const zone = cdvEl('cdv-modal-msg');
    zone.innerHTML = '';
    if (avecMotif && motif.length < 5) { zone.innerHTML = '<div class="admin-error-box">Indiquez un motif (5 caractères minimum).</div>'; return; }
    if (!mdp) { zone.innerHTML = '<div class="admin-error-box">Saisissez votre mot de passe.</div>'; return; }
    setBtnLoading(btn, 'Traitement…');
    const res = await action(mdp, motif);
    clearBtnLoading(btn);
    if (!res.ok) { zone.innerHTML = `<div class="admin-error-box">${esc(res.message)}</div>`; return; }
    closeModal();
    if (res.apres) res.apres();
  });
}

// ---------- Actions ----------

function cdvDemanderExecution() {
  const cats = [...document.querySelectorAll('.cdv-cat:checked')].map(i => i.value);
  const msg = cdvEl('cdv-exec-msg');
  msg.innerHTML = '';
  if (!cats.length) { msg.innerHTML = '<div class="admin-error-box" style="margin-top:10px;">Cochez au moins une catégorie.</div>'; return; }
  const noms = CDV_CATEGORIES.filter(c => cats.includes(c.cle)).map(c => c.label).join(', ');

  cdvConfirmer({
    titre: 'Nettoyer maintenant',
    texte: `Catégories : <strong>${esc(noms)}</strong>.<br>Seules les données ayant dépassé leur durée de conservation sont concernées. Cette opération est définitive.`,
    libelleBouton: 'Confirmer le nettoyage',
    action: async (mdp) => {
      const a = getSession();
      const { data, error } = await supabaseClient.rpc('lifecycle_executer_manuel', {
        p_username: a.username, p_password: mdp, p_categories: cats
      });
      if (error) return { ok: false, message: 'Opération impossible pour le moment. Réessayez.' };
      if (!data || !data.ok) return { ok: false, message: (data && data.message) || 'Opération refusée.' };
      return { ok: true, apres: async () => {
        await initCycleVie();
        const z = cdvEl('cdv-exec-msg');
        if (z) z.innerHTML = `<div class="admin-success-box" style="margin-top:10px;">Nettoyage terminé : ${data.total} élément(s) traité(s).</div>`;
        cdvRafraichirCaches();
      } };
    }
  });
}

function cdvDemanderRegles() {
  const regles = { purge_auto_active: cdvEl('cdv-auto').checked };
  for (const f of CDV_CHAMPS_REGLES) {
    const v = parseInt(cdvEl('cdv-' + f.cle).value, 10);
    if (!Number.isFinite(v) || v < f.min) {
      cdvEl('cdv-regles-msg').innerHTML = `<div class="admin-error-box">« ${esc(f.label)} » : minimum ${f.min} ${f.unite}.</div>`;
      return;
    }
    regles[f.cle] = v;
  }
  if (regles.retraits_anonymisation_jours > regles.colis_retires_conservation_jours) {
    cdvEl('cdv-regles-msg').innerHTML = '<div class="admin-error-box">L\u2019anonymisation doit avoir lieu avant la suppression des colis retirés.</div>';
    return;
  }
  if (regles.non_reclames_suppression_jours < regles.non_reclames_alerte_jours) {
    cdvEl('cdv-regles-msg').innerHTML = '<div class="admin-error-box">La suppression d\u2019un non réclamé ne peut pas précéder son signalement.</div>';
    return;
  }

  cdvConfirmer({
    titre: 'Modifier les règles de conservation',
    texte: 'Les nouvelles durées s\u2019appliqueront dès le prochain nettoyage (automatique ou manuel).',
    libelleBouton: 'Enregistrer',
    action: async (mdp) => {
      const a = getSession();
      const { data, error } = await supabaseClient.rpc('lifecycle_modifier_regles', {
        p_username: a.username, p_password: mdp, p_regles: regles
      });
      if (error) return { ok: false, message: 'Enregistrement impossible pour le moment. Réessayez.' };
      if (!data || !data.ok) return { ok: false, message: (data && data.message) || 'Modification refusée.' };
      return { ok: true, apres: async () => {
        await initCycleVie();
        const z = cdvEl('cdv-regles-msg');
        if (z) z.innerHTML = '<div class="admin-success-box">Règles enregistrées.</div>';
      } };
    }
  });
}

// Utilisée aussi depuis la fiche d'un colis (admin.js > openColisModal).
function cdvDemanderSuppressionColis(c, nonReclame) {
  cdvConfirmer({
    titre: `Supprimer le colis ${c.numero_suivi}`,
    texte: (nonReclame
      ? 'Ce colis n\u2019a jamais été retiré. '
      : 'Ce dossier est clos (colis retiré). ') +
      'Ses chiffres (montant, valeur) restent comptés dans les rapports via les statistiques archivées, mais le colis, son historique et sa fiche de retrait seront <strong>définitivement supprimés</strong>.',
    avecMotif: true,
    libelleBouton: 'Supprimer définitivement',
    action: async (mdp, motif) => {
      const a = getSession();
      const { data, error } = await supabaseClient.rpc('lifecycle_supprimer_colis', {
        p_username: a.username, p_password: mdp, p_colis_id: String(c.id), p_motif: motif
      });
      if (error) return { ok: false, message: 'Suppression impossible. La migration sql/cycle_de_vie_donnees_migration.sql a-t-elle été exécutée ?' };
      if (!data || !data.ok) return { ok: false, message: (data && data.message) || 'Suppression refusée.' };
      return { ok: true, apres: () => {
        if (typeof colisCache !== 'undefined') {
          colisCache = colisCache.filter(x => String(x.id) !== String(c.id));
        }
        if (cdvInitialise) initCycleVie();
        cdvRafraichirCaches();
      } };
    }
  });
}

// Après une suppression, les vues d'admin.js reposent sur un cache :
// on le recharge pour que tableau de bord et rapports restent justes.
async function cdvRafraichirCaches() {
  if (typeof loadSharedCache !== 'function') return;
  await loadSharedCache();
  if (typeof viewDirty !== 'undefined') { viewDirty.dashboard = true; viewDirty.rapports = true; viewDirty.agents = true; }
  if (typeof renderDashboardSections === 'function') renderDashboardSections();
}
