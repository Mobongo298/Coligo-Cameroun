// ==========================================================
// COLIGO — index.html — suivi client (aucun compte requis)
// Ce fichier manquait dans le projet : c'est pour cela que la
// recherche n'affichait jamais de résultat.
//
// Temps réel : une fois un colis affiché, la page s'abonne aux
// changements Supabase Realtime sur CE colis précis. Si un agent
// change son statut, l'affichage se met à jour tout seul, sans
// que le client ait besoin de relancer une recherche.
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
  afficherResultat(colis);
  abonnerTempsReel(colis.id);
}

// ---------- Abonnement temps réel à CE colis ----------

function abonnerTempsReel(colisId) {
  realtimeChannel = supabaseClient
    .channel('client-suivi-' + colisId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'colis', filter: `id=eq.${colisId}` },
      (payload) => {
        colisActuel = payload.new;
        renderStatutCard(colisActuel);
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

function afficherResultat(c) {
  const resultZone = document.getElementById('result-zone');
  resultZone.innerHTML = `
    <div id="statut-card" class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6 mb-5"></div>
    <div id="alerte-groupe-zone" class="mb-5"></div>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_4px_rgba(12,63,101,0.06),0_8px_20px_-12px_rgba(12,63,101,0.22)] p-5 lg:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="font-semibold">Votre reçu</h2>
        <button id="btn-print-recu"
          class="bg-coligo hover:bg-coligo-dark text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
          Imprimer le reçu
        </button>
      </div>
      <div class="overflow-x-auto">
        <div id="recu-preview" class="flex flex-wrap gap-4 justify-center"></div>
      </div>
    </div>
  `;

  renderStatutCard(c);

  // Les deux exemplaires sont rendus dans une iframe isolée pour que le
  // style du reçu (80 mm, monospace) n'interfère pas avec la page.
  const preview = document.getElementById('recu-preview');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%; max-width:720px; height:1180px; border:0;';
  preview.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${RECU_CSS}
    body { background:#f8fafc; padding:10px 0; }
    .recu { box-shadow:0 2px 10px rgba(0,0,0,0.08); }
    @media (min-width: 700px) {
      body { display:flex; gap:14px; justify-content:center; align-items:flex-start; }
    }</style></head><body>${recuCompletHtml(c)}</body></html>`);
  doc.close();

  document.getElementById('btn-print-recu').addEventListener('click', () => imprimerRecu(colisActuel));

  resultZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
          <span class="text-lg leading-none">✅</span>
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
