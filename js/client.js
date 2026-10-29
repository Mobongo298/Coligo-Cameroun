// ==========================================================
// COLIGO — index.html — suivi client (aucun compte requis)
// Ce fichier manquait dans le projet : c'est pour cela que la
// recherche n'affichait jamais de résultat.
//
// Temps réel : une fois un colis affiché, la page s'abonne aux
// changements Supabase Realtime sur CE colis précis. Si un agent
// change son statut, l'affichage se met à jour tout seul, sans
// que le client ait besoin de relancer une recherche.
//
// Reçu : consultation uniquement. Le client ne peut PAS l'imprimer
// (pas de bouton, impression du navigateur bloquée). Le reçu
// officiel est celui remis au guichet.
// Colis déjà retiré : le reçu n'est plus affiché ; seuls un message et les
// informations du retrait (destinataire ou mandataire, date, agence, agent
// ayant effectué l'opération) sont présentés.
// ==========================================================


function msgErreur(text) {
  return `<div class="bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3 text-sm">${escR(text)}</div>`;
}

let realtimeChannel = null;
let colisActuel = null;

async function rechercher() {
  const btn = document.getElementById('btn-search');
  const numero = document.getElementById('numero-input').value.trim();
  const errorZone = document.getElementById('error-zone');
  const resultZone = document.getElementById('result-zone');

  errorZone.innerHTML = '';
  fermerSuiviModal();

  if (!numero) {
    errorZone.innerHTML = msgErreur('Entrez votre numéro de suivi.');
    return;
  }

  setBtnLoading(btn, 'Recherche…');

  // La recherche ignore la casse et les espaces autour du numéro.
  const { data: colis, error } = await supabaseClient
    .from('colis')
    .select('*')
    .ilike('numero_suivi', numero)
    .maybeSingle();

  clearBtnLoading(btn);

  if (error) {
    errorZone.innerHTML = msgErreur('Service momentanément indisponible. Réessayez dans un instant.');
    return;
  }
  if (!colis) {
    errorZone.innerHTML = msgErreur(`Aucun colis trouvé avec le numéro « ${numero} ». Vérifiez le numéro figurant sur votre reçu. Les colis retirés depuis longtemps ne sont plus consultables en ligne : pour toute question, contactez votre agence.`);
    return;
  }

  colisActuel = colis;
  ouvrirSuiviModal();
  await afficherResultat(colis);
  abonnerTempsReel(colis.id);
}

// ---------- Fenêtre de résultat (se ferme à la main) ----------

function ouvrirSuiviModal() {
  document.getElementById('modal-info').innerHTML = '';
  document.getElementById('result-zone').innerHTML = '';
  document.getElementById('suivi-modal').classList.remove('hidden');
  document.getElementById('suivi-modal-corps').scrollTop = 0;
}

// Ferme la fenêtre, coupe le suivi en direct et ramène à l'espace de recherche.
function fermerSuiviModal() {
  const m = document.getElementById('suivi-modal');
  if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  document.getElementById('result-zone').innerHTML = '';
  document.getElementById('modal-info').innerHTML = '';
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  colisActuel = null;
  const champ = document.getElementById('numero-input');
  champ.value = '';
  champ.focus();
}

// ---------- Abonnement temps réel à CE colis ----------

function abonnerTempsReel(colisId) {
  realtimeChannel = supabaseClient
    .channel('client-suivi-' + colisId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'colis', filter: `id=eq.${colisId}` },
      (payload) => {
        const etaitRetire = estStatutRetire(colisActuel && colisActuel.statut);
        colisActuel = payload.new;
        // Le colis vient d'être retiré : on remplace le reçu par les informations de retrait.
        if (!etaitRetire && estStatutRetire(colisActuel.statut)) afficherResultat(colisActuel);
        else renderStatutCard(colisActuel);
      }
    )
    .subscribe((status) => {
      const pill = document.getElementById('realtime-pill');
      if (!pill) return;
      if (status === 'SUBSCRIBED') {
        pill.style.color = '#07823B';
        pill.innerHTML = '<span class="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style="background:#07823B"></span> Mise à jour en direct active';
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        pill.style.color = '#8a9a92';
        pill.innerHTML = '<span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-400"></span> Mise à jour en direct interrompue';
      }
    });
}

// ---------- Rendu ----------

function estStatutRetire(statut) {
  return normalizeStatut(statut) === 'Retiré';
}

const CARTE_CLASSES = 'suivi-card';

async function afficherResultat(c) {
  const resultZone = document.getElementById('result-zone');

  if (estStatutRetire(c.statut)) {
    await afficherRetrait(c);
    document.getElementById('suivi-modal-corps').scrollTop = 0;
    return;
  }

  resultZone.innerHTML = `
    <div id="statut-card" class="${CARTE_CLASSES}"></div>
    <div id="alerte-groupe-zone" style="margin-top:16px;"></div>
    <div class="${CARTE_CLASSES}" style="margin-top:16px;">
      <div class="recu-head">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>
          Votre reçu
        </h3>
        <span class="recu-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          Consultation uniquement
        </span>
      </div>
      <p class="recu-note">Ce reçu est affiché pour vérification et ne peut pas être imprimé.
        Le reçu officiel est celui qui vous a été remis au guichet lors de l'envoi.</p>
      <div class="recu-table"><div id="recu-preview" class="select-none"></div></div>
    </div>
  `;

  renderStatutCard(c);

  // Aperçu isolé dans une iframe (style 80 mm). Les deux exemplaires (client, agence)
  // sont posés côte à côte ; ils passent l'un sous l'autre seulement si la place manque.
  // La hauteur de l'iframe s'ajuste au contenu : aucune barre de défilement interne.
  const preview = document.getElementById('recu-preview');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%; height:760px; border:0; display:block;';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('title', 'Reçu (consultation uniquement)');
  preview.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${RECU_CSS}
    html, body { overflow: hidden; }
    body { background: transparent; margin: 0; padding: 22px 12px 18px; -webkit-user-select: none; user-select: none;
           display: flex; flex-wrap: wrap; gap: 22px; justify-content: center; align-items: flex-start; }
    .recu { margin: 0; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 14px 30px -12px rgba(6,50,30,.35); }
    @media (min-width: 760px) { .recu { zoom: 1.12; } }
    @media print { html, body { display: none !important; } }
    </style></head><body oncontextmenu="return false">${recuCompletHtml(c)}</body></html>`);
  doc.close();
  // Raccourci Ctrl+P / Cmd+P bloqué aussi quand le focus est dans l'iframe.
  try { doc.addEventListener('keydown', bloquerRaccourciImpression, true); } catch (e) { /* silencieux */ }

  const ajuster = () => {
    try {
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h) iframe.style.height = Math.ceil(h) + 'px';
    } catch (e) { /* silencieux */ }
  };
  [60, 250, 700, 1500].forEach(t => setTimeout(ajuster, t));
  try { iframe.contentWindow.addEventListener('resize', ajuster); } catch (e) { /* silencieux */ }
  try { doc.querySelectorAll('img').forEach(im => im.addEventListener('load', ajuster)); } catch (e) { /* silencieux */ }

  document.getElementById('suivi-modal-corps').scrollTop = 0;
}

// ---------- Colis retiré : message + informations du retrait, sans reçu ----------

async function afficherRetrait(c) {
  const resultZone = document.getElementById('result-zone');
  resultZone.innerHTML = `
    <div id="statut-card" class="${CARTE_CLASSES}"></div>
    <div id="alerte-groupe-zone"></div>
    <div id="retrait-card" class="${CARTE_CLASSES}" style="margin-top:16px;">
      <div class="text-center text-slate-500 text-sm py-4">Chargement des informations du retrait…</div>
    </div>`;
  renderStatutCard(c);

  const info = await chargerInfoRetrait(c);
  const card = document.getElementById('retrait-card');
  if (!card) return;

  const date = info.retire_le
    ? new Date(info.retire_le).toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const qui = info.par_mandataire
    ? `<strong>${escR(info.beneficiaire)}</strong> <span class="text-slate-500">(mandataire, pour le compte de ${escR(info.destinataire || c.destinataire_nom || 'le destinataire')})</span>`
    : `<strong>${escR(info.beneficiaire || c.destinataire_nom || '—')}</strong> <span class="text-slate-500">(destinataire)</span>`;

  card.innerHTML = `
    <div class="flex items-start gap-3 mb-5">
      <span class="flex-none w-11 h-11 rounded-full bg-[#DDF7A6] text-[#2E4A08] flex items-center justify-center">
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      <div>
        <h2 class="font-semibold text-lg">Ce colis a déjà été retiré</h2>
        <p class="text-sm text-slate-600 mt-0.5">Le colis <strong>${escR(c.numero_suivi)}</strong> a été remis en agence.
          Le reçu n'est plus consultable en ligne une fois le colis retiré.</p>
      </div>
    </div>
    <dl class="grid sm:grid-cols-2 gap-3 text-sm">
      <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:col-span-2">
        <dt class="text-xs text-slate-500">Remis à</dt><dd class="mt-0.5">${qui}</dd>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <dt class="text-xs text-slate-500">Date du retrait</dt><dd class="mt-0.5 font-medium first-letter:uppercase">${escR(date)}</dd>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <dt class="text-xs text-slate-500">Agence de retrait</dt><dd class="mt-0.5 font-medium">${escR(info.agence || c.ville_arrivee || '—')}</dd>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:col-span-2">
        <dt class="text-xs text-slate-500">Opération de retrait effectuée par l'agent</dt><dd class="mt-0.5 font-medium">${escR(info.agent || '—')}</dd>
      </div>
    </dl>
    <p class="text-xs text-slate-500 mt-4">Vous n'êtes pas à l'origine de ce retrait ? Contactez rapidement votre agence
      en indiquant le numéro de suivi.</p>`;
}

// Informations du retrait : fonction sécurisée suivi_retrait_info (aucune CNI,
// aucun téléphone). Repli sur la table retraits si la migration n'est pas faite.
async function chargerInfoRetrait(c) {
  try {
    const { data, error } = await supabaseClient.rpc('suivi_retrait_info', { p_numero: c.numero_suivi });
    if (!error && data && data.ok) return data;
  } catch (e) { /* repli ci-dessous */ }

  const info = { retire_le: c.updated_at, agence: c.ville_arrivee, par_mandataire: false,
                 beneficiaire: c.destinataire_nom, destinataire: c.destinataire_nom, agent: null };
  try {
    const { data: t } = await supabaseClient.from('retraits')
      .select('mandataire_nom, agent, agence, created_at')
      .eq('colis_id', c.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (t) {
      info.retire_le = t.created_at || info.retire_le;
      info.agence = t.agence || info.agence;
      info.agent = t.agent;
      if (t.mandataire_nom && t.mandataire_nom.trim()) { info.par_mandataire = true; info.beneficiaire = t.mandataire_nom; }
    }
  } catch (e) { /* silencieux */ }
  return info;
}

// ---------- Impression impossible pour le client ----------

function bloquerRaccourciImpression(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    e.stopPropagation();
    const ouvert = !document.getElementById('suivi-modal').classList.contains('hidden');
    const zone = document.getElementById(ouvert ? 'modal-info' : 'error-zone');
    if (zone) {
      zone.innerHTML = `<div class="bg-slate-50 text-slate-700 border border-slate-200 rounded-xl px-4 py-3 text-sm">
        L'impression n'est pas disponible depuis le suivi en ligne. Le reçu officiel vous est remis au guichet.</div>`;
    }
  }
}
document.addEventListener('keydown', bloquerRaccourciImpression, true);

// Ne redessine QUE la carte de statut — appelée à l'affichage initial et
// à chaque mise à jour reçue en temps réel (le reçu n'a pas besoin de
// changer, son contenu ne dépend pas du statut).
function renderStatutCard(c) {
  const card = document.getElementById('statut-card');
  if (!card) return;
  const st = normalizeStatut(c.statut);
  const col = statutColors(st);
  const etapes = ['Enregistré', 'En transit', 'Disponible', 'Retiré'];
  const idx = Math.max(0, etapes.indexOf(st));
  const pct = (idx / (etapes.length - 1)) * 100;
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icones = {
    'Enregistré': svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    'En transit': svg('<path d="M1 6h13v10H1zM14 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
    'Disponible': svg('<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="M3 8.5 12 14l9-5.5M12 14v7"/>'),
    'Retiré':     svg('<polyline points="20 6 9 17 4 12"/>')
  };
  const coche = svg('<polyline points="20 6 9 17 4 12"/>');
  const trajet = (c.ville_depart && c.ville_arrivee)
    ? `<div class="trajet">${escR(String(c.ville_depart).toUpperCase())}<span>→</span>${escR(String(c.ville_arrivee).toUpperCase())}</div>` : '';

  card.innerHTML = `
    <div class="st-top">
      <div class="st-id">
        <div class="st-ico" style="background:${col.bg}; color:${col.text}">${icones[st]}</div>
        <div>
          <div class="st-lib">Statut actuel de votre colis</div>
          <div class="st-val" style="color:${col.text}">${escR(st)}</div>
          <div id="realtime-pill" class="st-live">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-300"></span> Connexion au suivi en direct…
          </div>
        </div>
      </div>
      <div class="st-num">
        <span class="chip" style="background:${col.bg}; color:${col.text}">${escR(c.numero_suivi)}</span>
        ${trajet}
      </div>
    </div>
    <div class="st-steps" style="--ring:${col.bg}">
      <div class="st-track"><div class="st-fill" style="width:${pct}%; background:${col.solid}"></div></div>
      ${etapes.map((e, i) => `
        <div class="st-step ${i < idx ? 'done' : (i === idx ? 'now' : '')}">
          <div class="st-dot" style="${i <= idx ? `background:${col.solid}` : ''}">${i < idx ? coche : (i === idx ? icones[e] : i + 1)}</div>
          <div class="st-name">${e}</div>
        </div>`).join('')}
    </div>
  `;

  // Message de réassurance pour les envois groupés ("3 colis", "mini
  // déménagement"…) dès qu'ils passent à Disponible : une partie du lot
  // peut arriver avant le reste, on prévient le client pour éviter l'inquiétude.
  const alerteZone = document.getElementById('alerte-groupe-zone');
  if (alerteZone) {
    if (st === 'Disponible' && estColisGroupe(c.Description_du_colis)) {
      alerteZone.innerHTML = `
        <div class="st-alerte">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <p>
            En cas de disponibilité incomplète de l'ensemble de vos colis, pas d'inquiétude :
            le reste vous parviendra d'ici <strong>2 jours maximum</strong>.
            Merci pour votre aimable compréhension.
          </p>
        </div>`;
    } else {
      alerteZone.innerHTML = '';
    }
  }
}

document.getElementById('btn-search').addEventListener('click', rechercher);
document.getElementById('numero-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') rechercher();
});

document.getElementById('suivi-modal-x').addEventListener('click', fermerSuiviModal);
document.getElementById('suivi-modal-fermer').addEventListener('click', fermerSuiviModal);
document.getElementById('suivi-modal').addEventListener('click', (e) => { if (e.target.id === 'suivi-modal') fermerSuiviModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerSuiviModal(); });
