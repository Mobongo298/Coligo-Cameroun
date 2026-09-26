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
// (pas de bouton, impression du navigateur bloquée, filigrane). Le reçu
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
  resultZone.innerHTML = '';
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }

  if (!numero) {
    errorZone.innerHTML = msgErreur('Entrez votre numéro de suivi.');
    return;
  }

  setBtnLoading(btn, 'Recherche…');
  resultZone.innerHTML = '<div class="text-center text-slate-500 text-sm py-6">Recherche de votre colis…</div>';

  // La recherche ignore la casse et les espaces autour du numéro.
  const { data: colis, error } = await supabaseClient
    .from('colis')
    .select('*')
    .ilike('numero_suivi', numero)
    .maybeSingle();

  clearBtnLoading(btn);
  resultZone.innerHTML = '';

  if (error) {
    errorZone.innerHTML = msgErreur('Service momentanément indisponible. Réessayez dans un instant.');
    return;
  }
  if (!colis) {
    errorZone.innerHTML = msgErreur(`Aucun colis trouvé avec le numéro « ${numero} ». Vérifiez le numéro figurant sur votre reçu. Les colis retirés depuis longtemps ne sont plus consultables en ligne : pour toute question, contactez votre agence.`);
    return;
  }

  colisActuel = colis;
  await afficherResultat(colis);
  abonnerTempsReel(colis.id);
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
        pill.classList.remove('text-slate-400');
        pill.classList.add('text-coligo');
        pill.innerHTML = '<span class="inline-block w-1.5 h-1.5 rounded-full bg-coligo animate-pulse"></span> Mise à jour en direct active';
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        pill.classList.remove('text-coligo');
        pill.classList.add('text-slate-400');
        pill.innerHTML = '<span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-400"></span> Mise à jour en direct interrompue';
      }
    });
}

// ---------- Rendu ----------

function estStatutRetire(statut) {
  return normalizeStatut(statut) === 'Retiré';
}

const CARTE_CLASSES = 'bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6';

async function afficherResultat(c) {
  const resultZone = document.getElementById('result-zone');

  if (estStatutRetire(c.statut)) {
    await afficherRetrait(c);
    resultZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  resultZone.innerHTML = `
    <div id="statut-card" class="${CARTE_CLASSES} mb-5"></div>
    <div id="alerte-groupe-zone" class="mb-5"></div>
    <div class="${CARTE_CLASSES}">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 class="font-semibold">Votre reçu</h2>
        <span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          Consultation uniquement
        </span>
      </div>
      <p class="text-xs text-slate-500 mb-4">Ce reçu est affiché pour vérification et ne peut pas être imprimé.
        Le reçu officiel est celui qui vous a été remis au guichet lors de l'envoi.</p>
      <div class="overflow-x-auto">
        <div id="recu-preview" class="flex flex-wrap gap-4 justify-center select-none"></div>
      </div>
    </div>
  `;

  renderStatutCard(c);

  // Aperçu isolé dans une iframe (style 80 mm), avec filigrane et
  // impression neutralisée à l'intérieur de l'iframe elle-même.
  const preview = document.getElementById('recu-preview');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%; max-width:720px; height:1180px; border:0;';
  iframe.setAttribute('title', 'Reçu (consultation uniquement)');
  preview.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${RECU_CSS}
    body { background:#f8fafc; padding:10px 0; -webkit-user-select:none; user-select:none; }
    .recu { box-shadow:0 2px 10px rgba(0,0,0,0.08); position:relative; overflow:hidden; }
    .recu::after {
      content:'CONSULTATION — NON VALABLE'; position:absolute; left:50%; top:45%;
      transform:translate(-50%,-50%) rotate(-32deg); white-space:nowrap; pointer-events:none;
      font:700 17px/1 Arial, sans-serif; letter-spacing:2px; color:rgba(12,63,101,0.13);
      border:2px solid rgba(12,63,101,0.13); padding:6px 10px; border-radius:4px;
    }
    @media (min-width: 700px) {
      body { display:flex; gap:14px; justify-content:center; align-items:flex-start; }
    }
    @media print { html, body { display:none !important; } }
    </style></head><body oncontextmenu="return false">${recuCompletHtml(c)}</body></html>`);
  doc.close();
  // Raccourci Ctrl+P / Cmd+P bloqué aussi quand le focus est dans l'iframe.
  try { doc.addEventListener('keydown', bloquerRaccourciImpression, true); } catch (e) { /* silencieux */ }

  resultZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Colis retiré : message + informations du retrait, sans reçu ----------

async function afficherRetrait(c) {
  const resultZone = document.getElementById('result-zone');
  resultZone.innerHTML = `
    <div id="statut-card" class="${CARTE_CLASSES} mb-5"></div>
    <div id="alerte-groupe-zone"></div>
    <div id="retrait-card" class="${CARTE_CLASSES}">
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
    const zone = document.getElementById('error-zone');
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
  const idx = etapes.indexOf(st);
  const pct = ((idx + 1) / etapes.length) * 100;

  card.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs text-slate-500">Statut actuel de votre colis</div>
        <div class="text-2xl font-bold mt-0.5" style="color:${col.text}">${escR(st)}</div>
        <div id="realtime-pill" class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-300"></span> Connexion au suivi en direct…
        </div>
      </div>
      <span class="px-4 py-2 rounded-full text-sm font-semibold"
            style="background:${col.bg}; color:${col.text}">${escR(c.numero_suivi)}</span>
    </div>
    <div class="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
      <div class="h-full rounded-full transition-all" style="width:${pct}%; background:${col.solid}"></div>
    </div>
    <div class="flex justify-between text-[11px] text-slate-500 mt-1.5">
      ${etapes.map(e => `<span>${e}</span>`).join('')}
    </div>
  `;

  // Message de réassurance pour les envois groupés ("3 colis", "mini
  // déménagement"…) dès qu'ils passent à Disponible : une partie du lot
  // peut arriver avant le reste, on prévient le client pour éviter l'inquiétude.
  const alerteZone = document.getElementById('alerte-groupe-zone');
  if (alerteZone) {
    if (st === 'Disponible' && estColisGroupe(c.Description_du_colis)) {
      alerteZone.innerHTML = `
        <div class="bg-coligo-light border border-coligo/30 rounded-2xl px-5 py-4 text-sm text-coligo-dark flex gap-3">
          <svg class="w-5 h-5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
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
