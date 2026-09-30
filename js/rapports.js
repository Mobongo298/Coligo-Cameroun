// ==========================================================
// COLIGO — Admin.html — Vue « Rapports » (tableau de bord)
// ----------------------------------------------------------
//  - filtre de dates (du / au) + raccourcis (ce mois, 3 mois, 12 mois,
//    cette année, tout) ;
//  - 4 indicateurs : chiffre d'affaires, nombre de colis, agence la plus
//    performante, croissance par rapport au mois précédent ;
//  - graphique en barres Douala / Yaoundé par mois (CA ou nombre de colis) ;
//  - tableau mensuel détaillé par agence ;
//  - export PDF (jsPDF + AutoTable).
//
// Les chiffres sont calculés sur TOUS les colis de la base (lecture paginée
// de trois colonnes seulement), et non plus sur le cache des 2000 derniers,
// auxquels s'ajoutent les totaux archivés par le cycle de vie des données
// (stats_archive) pour les colis déjà supprimés.
// Dépend de admin.js : supabaseClient, archiveCache, esc, formatFCFA,
// normalizeCity, etatVide.
// ==========================================================

const RAP_COULEURS = { douala: '#1D6FA8', yaounde: '#E0A33B' };
const RAP_COULEURS_AUTRES = ['#15795A', '#7A5AC8', '#5B6B7F', '#B42318'];
const RAP_MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const RAP_MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const rap = {
  lignes: null,        // [{ t: Date, ag: 'douala', label: 'Douala', nb, montant, archive }]
  enCours: null,       // promesse de chargement en cours
  perime: true,
  minuterie: null,
  preset: '12m',
  du: '', au: '',
  metrique: 'montant',
  chart: null,
  dernierCalcul: null,
  initialise: false
};

// ---------- Outils dates ----------

function rapIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rapParse(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function rapCleMois(d) { return d.getFullYear() * 12 + d.getMonth(); }
function rapMoisDepuisCle(k) { return new Date(Math.floor(k / 12), k % 12, 1); }
function rapLibelleMois(k, court) {
  const d = rapMoisDepuisCle(k);
  return (court ? RAP_MOIS_COURT : RAP_MOIS_LONG)[d.getMonth()] + ' ' + d.getFullYear();
}
function rapDateLongue(d) {
  const t = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return d.getDate() === 1 ? t.replace(/^1 /, '1er ') : t;
}
function rapPourcent(x) {
  return (x > 0 ? '+' : '') + x.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
}
function rapCompact(n) {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function rapAppliquerPreset(p) {
  const auj = new Date();
  const fin = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate());
  let debut = null;
  if (p === 'mois') debut = new Date(auj.getFullYear(), auj.getMonth(), 1);
  if (p === '3m') debut = new Date(auj.getFullYear(), auj.getMonth() - 2, 1);
  if (p === '12m') debut = new Date(auj.getFullYear(), auj.getMonth() - 11, 1);
  if (p === 'annee') debut = new Date(auj.getFullYear(), 0, 1);
  rap.preset = p;
  rap.du = debut ? rapIso(debut) : '';
  rap.au = p === 'tout' ? '' : rapIso(fin);
}

// ---------- Chargement des données ----------

async function rapCharger() {
  const lignes = [];
  const PAGE = 1000;
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await supabaseClient
      .from('colis')
      .select('agence,montant_paye,created_at')
      .order('created_at', { ascending: true })
      .range(debut, debut + PAGE - 1);
    if (error) {
      // Repli : on travaille sur le cache du tableau de bord.
      if (!lignes.length && typeof colisCache !== 'undefined') {
        colisCache.forEach(c => lignes.push(rapLigneColis(c)));
        break;
      }
      throw error;
    }
    (data || []).forEach(c => lignes.push(rapLigneColis(c)));
    if (!data || data.length < PAGE) break;
  }
  (typeof archiveCache !== 'undefined' ? archiveCache : []).forEach(a => {
    lignes.push({
      t: new Date(Number(a.annee), Number(a.mois) - 1, 1),
      ag: normalizeCity(a.agence),
      label: String(a.agence || 'Inconnue').trim(),
      nb: Number(a.nb_colis || 0),
      montant: Number(a.montant_total || 0),
      archive: true
    });
  });
  return lignes.filter(l => !isNaN(l.t.getTime()));
}

function rapLigneColis(c) {
  return {
    t: new Date(c.created_at),
    ag: normalizeCity(c.agence),
    label: String(c.agence || 'Inconnue').trim(),
    nb: 1,
    montant: Number(c.montant_paye || 0),
    archive: false
  };
}

async function rapAssurerDonnees() {
  if (rap.lignes && !rap.perime) return;
  if (!rap.enCours) {
    rap.enCours = rapCharger()
      .then(l => { rap.lignes = l; rap.perime = false; })
      .finally(() => { rap.enCours = null; });
  }
  await rap.enCours;
}

// ---------- Point d'entrée (appelé par admin.js) ----------

function renderRapports() {
  const zone = document.getElementById('rapports-zone');
  if (!rap.initialise) {
    rapAppliquerPreset(rap.preset);
    rapConstruireSquelette(zone);
    rap.initialise = true;
    rapRafraichir();
    return;
  }
  // Appel suivant (changement en temps réel) : rechargement groupé.
  rap.perime = true;
  clearTimeout(rap.minuterie);
  rap.minuterie = setTimeout(rapRafraichir, 1500);
}

async function rapRafraichir() {
  const contenu = document.getElementById('rap-contenu');
  if (!rap.lignes) contenu.innerHTML = rapSqueletteChargement();
  try {
    await rapAssurerDonnees();
  } catch (e) {
    contenu.innerHTML = `<div class="admin-card">${etatVide('rapports', 'Rapport indisponible', 'Impossible de lire les données pour le moment. Vérifiez la connexion puis réessayez.',
      '<button class="admin-btn small ghost" onclick="rap.perime = true; rapRafraichir()">Réessayer</button>')}</div>`;
    return;
  }
  rapAfficher();
}

// ---------- Squelette : barre de filtres + zone de contenu ----------

function rapConstruireSquelette(zone) {
  const presets = [['mois', 'Ce mois'], ['3m', '3 mois'], ['12m', '12 mois'], ['annee', 'Cette année'], ['tout', 'Tout']];
  zone.innerHTML = `
    <div class="rap-toolbar admin-card">
      <div class="rap-toolbar-left">
        <div class="rap-presets" role="group" aria-label="Période rapide">
          ${presets.map(([k, l]) => `<button type="button" class="rap-preset" data-preset="${k}">${l}</button>`).join('')}
        </div>
        <div class="rap-dates">
          <label>Du <input type="date" id="rap-du"></label>
          <label>Au <input type="date" id="rap-au"></label>
        </div>
      </div>
      <div class="rap-exports">
        <button type="button" class="admin-btn small ghost" id="rap-export-pdf">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="m9 14 3 3 3-3"/></svg>
          Exporter en PDF</button>
      </div>
    </div>
    <div id="rap-contenu"></div>
  `;
  rapSynchroniserFiltres();

  zone.querySelectorAll('.rap-preset').forEach(b => b.addEventListener('click', () => {
    rapAppliquerPreset(b.dataset.preset);
    rapSynchroniserFiltres();
    rapAfficher();
  }));
  ['rap-du', 'rap-au'].forEach(id => document.getElementById(id).addEventListener('change', () => {
    rap.du = document.getElementById('rap-du').value;
    rap.au = document.getElementById('rap-au').value;
    if (rap.du && rap.au && rap.du > rap.au) { const x = rap.du; rap.du = rap.au; rap.au = x; }
    rap.preset = '';
    rapSynchroniserFiltres();
    rapAfficher();
  }));
  document.getElementById('rap-export-pdf').addEventListener('click', rapExporterPDF);
}

function rapSynchroniserFiltres() {
  document.getElementById('rap-du').value = rap.du;
  document.getElementById('rap-au').value = rap.au;
  document.querySelectorAll('.rap-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === rap.preset));
}

function rapSqueletteChargement() {
  return `
    <div class="rap-kpis">${'<div class="rap-kpi rap-skel"><div></div><div></div><div></div></div>'.repeat(4)}</div>
    <div class="admin-card rap-skel-chart"><div class="rap-skel-bar"></div></div>`;
}

// ---------- Calculs ----------

function rapCalculer() {
  const lignes = rap.lignes || [];
  const auj = new Date();
  const du = rapParse(rap.du);
  const au = rapParse(rap.au);
  const auFin = au ? new Date(au.getFullYear(), au.getMonth(), au.getDate(), 23, 59, 59, 999) : null;

  const dansPeriode = l => {
    if (l.archive) {
      // Totaux archivés : granularité du mois entier.
      const debutMois = l.t, finMois = new Date(l.t.getFullYear(), l.t.getMonth() + 1, 0, 23, 59, 59);
      return (!du || finMois >= du) && (!auFin || debutMois <= auFin);
    }
    return (!du || l.t >= du) && (!auFin || l.t <= auFin);
  };
  const sel = lignes.filter(dansPeriode);

  // Agences (Douala et Yaoundé en premier)
  const agences = new Map();
  sel.forEach(l => { if (!agences.has(l.ag)) agences.set(l.ag, { cle: l.ag, label: l.label, nb: 0, montant: 0 }); });
  const ordre = { douala: 0, yaounde: 1 };
  const listeAg = [...agences.values()].sort((a, b) => (ordre[a.cle] ?? 9) - (ordre[b.cle] ?? 9) || a.label.localeCompare(b.label));
  let iAutre = 0;
  listeAg.forEach(a => { a.couleur = RAP_COULEURS[a.cle] || RAP_COULEURS_AUTRES[iAutre++ % RAP_COULEURS_AUTRES.length]; });

  // Mois de la période (mois vides inclus, pour un graphique continu)
  let kMin, kMax;
  if (sel.length) {
    kMin = du ? rapCleMois(du) : Math.min(...sel.map(l => rapCleMois(l.t)));
    kMax = au ? rapCleMois(au) : Math.max(...sel.map(l => rapCleMois(l.t)), rapCleMois(auj));
    if (kMax - kMin > 119) kMin = kMax - 119; // 10 ans maximum à l'écran
  }
  const mois = [];
  if (sel.length) for (let k = kMin; k <= kMax; k++) mois.push({ k, parAg: {}, nb: 0, montant: 0, archive: false });
  const indexMois = new Map(mois.map((m, i) => [m.k, i]));

  let archivePresente = false;
  sel.forEach(l => {
    const a = agences.get(l.ag);
    a.nb += l.nb; a.montant += l.montant;
    const i = indexMois.get(rapCleMois(l.t));
    if (i === undefined) return;
    const m = mois[i];
    if (!m.parAg[l.ag]) m.parAg[l.ag] = { nb: 0, montant: 0 };
    m.parAg[l.ag].nb += l.nb; m.parAg[l.ag].montant += l.montant;
    m.nb += l.nb; m.montant += l.montant;
    if (l.archive) { m.archive = true; archivePresente = true; }
  });

  const totalMontant = listeAg.reduce((s, a) => s + a.montant, 0);
  const totalNb = listeAg.reduce((s, a) => s + a.nb, 0);
  const meilleure = listeAg.length ? [...listeAg].sort((a, b) => b.montant - a.montant)[0] : null;
  const moisActifs = mois.filter(m => m.nb > 0).length;

  // Croissance : mois de fin de période comparé au mois précédent. Si c'est
  // le mois en cours, on compare à la même période du mois précédent (du 1er
  // au même jour), sinon on comparerait un mois entamé à un mois complet.
  const refFin = au && au < auj ? au : auj;
  const kRef = rapCleMois(refFin);
  const moisEnCours = kRef === rapCleMois(auj);
  const jourLimite = moisEnCours ? auj.getDate() : 31;
  const somme = (k) => lignes.reduce((s, l) => {
    if (rapCleMois(l.t) !== k) return s;
    if (!l.archive && l.t.getDate() > jourLimite) return s;
    return s + l.montant;
  }, 0);
  const caRef = somme(kRef);
  const caPrec = somme(kRef - 1);
  const croissance = caPrec > 0 ? ((caRef - caPrec) / caPrec) * 100 : null;

  return {
    du, au, sel, listeAg, mois, totalMontant, totalNb, meilleure, moisActifs, archivePresente,
    croissance: { valeur: croissance, caRef, caPrec, kRef, moisEnCours, jourLimite }
  };
}

function rapLibellePeriode(c) {
  if (!c.du && !c.au) return 'Toute la période';
  if (c.du && c.au) return `Du ${rapDateLongue(c.du)} au ${rapDateLongue(c.au)}`;
  if (c.du) return `Depuis le ${rapDateLongue(c.du)}`;
  return `Jusqu'au ${rapDateLongue(c.au)}`;
}

// ---------- Affichage ----------

function rapAfficher() {
  const contenu = document.getElementById('rap-contenu');
  if (!contenu || !rap.lignes) return;
  const c = rapCalculer();
  rap.dernierCalcul = c;

  const vide = c.totalNb === 0;
  document.getElementById('rap-export-pdf').disabled = vide;

  if (rap.chart) { rap.chart.destroy(); rap.chart = null; }

  if (vide) {
    contenu.innerHTML = `<div class="admin-card rap-vide">${etatVide('rapports',
      'Aucune donnée sur cette période',
      `${rapLibellePeriode(c)} : aucun colis enregistré. Essayez une période plus large.`,
      rap.preset !== 'tout' ? '<button class="admin-btn small ghost" id="rap-voir-tout">Voir toute la période</button>' : '')}</div>`;
    const b = document.getElementById('rap-voir-tout');
    if (b) b.addEventListener('click', () => { rapAppliquerPreset('tout'); rapSynchroniserFiltres(); rapAfficher(); });
    return;
  }

  const cr = c.croissance;
  let crValeur, crClasse, crFleche;
  if (cr.valeur === null) {
    crValeur = cr.caRef > 0 ? 'Nouveau' : '—';
    crClasse = 'neutre'; crFleche = '';
  } else {
    crValeur = rapPourcent(cr.valeur);
    crClasse = cr.valeur > 0.05 ? 'hausse' : (cr.valeur < -0.05 ? 'baisse' : 'neutre');
    crFleche = crClasse === 'hausse'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>'
      : crClasse === 'baisse'
        ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10"/><path d="M17 8v9H8"/></svg>'
        : '';
  }
  const crSous = cr.moisEnCours
    ? `${rapLibelleMois(cr.kRef)} (1er au ${cr.jourLimite}) vs même période de ${RAP_MOIS_LONG[rapMoisDepuisCle(cr.kRef - 1).getMonth()]}`
    : `${rapLibelleMois(cr.kRef)} vs ${rapLibelleMois(cr.kRef - 1)}`;

  const partMeilleure = c.totalMontant > 0 && c.meilleure ? (c.meilleure.montant / c.totalMontant) * 100 : 0;
  const moyenneMois = c.moisActifs ? c.totalMontant / c.moisActifs : 0;
  const panier = c.totalNb ? c.totalMontant / c.totalNb : 0;

  const icone = (p) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

  contenu.innerHTML = `
    <div class="rap-periode">${esc(rapLibellePeriode(c))}${c.archivePresente ? ' <span class="rap-note">· inclut des totaux archivés</span>' : ''}</div>

    <div class="rap-kpis">
      <div class="rap-kpi">
        <div class="rap-kpi-top"><span class="rap-kpi-label">Chiffre d'affaires total</span><span class="rap-kpi-ico ico-bleu">${icone('<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')}</span></div>
        <div class="rap-kpi-val">${formatFCFA(c.totalMontant)}</div>
        <div class="rap-kpi-sub">Moyenne ${formatFCFA(Math.round(moyenneMois))} par mois actif</div>
      </div>
      <div class="rap-kpi">
        <div class="rap-kpi-top"><span class="rap-kpi-label">Nombre total de colis</span><span class="rap-kpi-ico ico-vert">${icone('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>')}</span></div>
        <div class="rap-kpi-val">${c.totalNb.toLocaleString('fr-FR')}</div>
        <div class="rap-kpi-sub">Montant moyen ${formatFCFA(Math.round(panier))} par colis</div>
      </div>
      <div class="rap-kpi">
        <div class="rap-kpi-top"><span class="rap-kpi-label">Agence la plus performante</span><span class="rap-kpi-ico ico-or">${icone('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>')}</span></div>
        <div class="rap-kpi-val">${c.meilleure ? esc(c.meilleure.label) : '—'}</div>
        <div class="rap-kpi-sub">${c.meilleure ? `${formatFCFA(c.meilleure.montant)} · ${partMeilleure.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} % du CA` : ''}</div>
        ${c.meilleure && c.listeAg.length > 1 ? `<div class="rap-part"><span style="width:${partMeilleure.toFixed(1)}%; background:${c.meilleure.couleur}"></span></div>` : ''}
      </div>
      <div class="rap-kpi">
        <div class="rap-kpi-top"><span class="rap-kpi-label">Croissance vs mois dernier</span><span class="rap-kpi-ico ico-${crClasse}">${icone('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>')}</span></div>
        <div class="rap-kpi-val rap-cr ${crClasse}">${crFleche}${crValeur}</div>
        <div class="rap-kpi-sub">${esc(crSous)}</div>
        <div class="rap-kpi-sub">${formatFCFA(cr.caRef)} contre ${formatFCFA(cr.caPrec)}</div>
      </div>
    </div>

    <div class="admin-card rap-chart-card">
      <div class="rap-card-head">
        <div>
          <h3 class="rap-titre">${c.listeAg.length === 2 && c.listeAg[0].cle === 'douala' && c.listeAg[1].cle === 'yaounde' ? 'Douala vs Yaoundé par mois' : 'Comparaison des agences par mois'}</h3>
          <div class="rap-sous">${rap.metrique === 'montant' ? "Chiffre d'affaires encaissé (FCFA)" : 'Nombre de colis enregistrés'}</div>
        </div>
        <div class="rap-seg" role="group" aria-label="Indicateur du graphique">
          <button type="button" data-m="montant" class="${rap.metrique === 'montant' ? 'active' : ''}">Chiffre d'affaires</button>
          <button type="button" data-m="nb" class="${rap.metrique === 'nb' ? 'active' : ''}">Colis</button>
        </div>
      </div>
      <div class="rap-legende">
        ${c.listeAg.map(a => `<span><i style="background:${a.couleur}"></i>${esc(a.label)} <strong>${rap.metrique === 'montant' ? formatFCFA(a.montant) : a.nb.toLocaleString('fr-FR') + ' colis'}</strong></span>`).join('')}
      </div>
      <div class="rap-chart-wrap"><canvas id="rap-chart" aria-label="Graphique en barres par agence et par mois" role="img"></canvas></div>
      <div id="rap-chart-fallback"></div>
    </div>

    <div class="admin-card">
      <div class="rap-card-head"><div><h3 class="rap-titre">Détail mensuel</h3><div class="rap-sous">Du mois le plus récent au plus ancien</div></div></div>
      <div class="admin-table-wrap"><table class="admin-table rap-table">
        <thead>
          <tr><th rowspan="2">Mois</th>${c.listeAg.map(a => `<th colspan="2" class="rap-th-ag"><i style="background:${a.couleur}"></i>${esc(a.label)}</th>`).join('')}<th colspan="2" class="rap-th-ag">Total</th></tr>
          <tr>${c.listeAg.map(() => '<th class="num">Colis</th><th class="num">CA</th>').join('')}<th class="num">Colis</th><th class="num">CA</th></tr>
        </thead>
        <tbody>
          ${[...c.mois].reverse().map(m => `
            <tr class="${m.nb ? '' : 'rap-mois-vide'}">
              <td data-label="Mois">${rapLibelleMois(m.k)}${m.archive ? ' <span class="muted-admin" title="Inclut des colis archivés (supprimés après leur durée de conservation)">· archivé</span>' : ''}</td>
              ${c.listeAg.map(a => {
                const v = m.parAg[a.cle] || { nb: 0, montant: 0 };
                return `<td class="num" data-label="${esc(a.label)} · colis">${v.nb || '—'}</td><td class="num" data-label="${esc(a.label)} · CA">${v.montant ? formatFCFA(v.montant) : '—'}</td>`;
              }).join('')}
              <td class="num" data-label="Total colis"><strong>${m.nb || '—'}</strong></td>
              <td class="num" data-label="Total CA"><strong>${m.montant ? formatFCFA(m.montant) : '—'}</strong></td>
            </tr>`).join('')}
          <tr class="total-row">
            <td data-label="Total">Total de la période</td>
            ${c.listeAg.map(a => `<td class="num" data-label="${esc(a.label)} · colis">${a.nb.toLocaleString('fr-FR')}</td><td class="num" data-label="${esc(a.label)} · CA">${formatFCFA(a.montant)}</td>`).join('')}
            <td class="num" data-label="Total colis">${c.totalNb.toLocaleString('fr-FR')}</td>
            <td class="num" data-label="Total CA">${formatFCFA(c.totalMontant)}</td>
          </tr>
        </tbody>
      </table></div>
    </div>
  `;

  contenu.querySelectorAll('.rap-seg button').forEach(b => b.addEventListener('click', () => {
    rap.metrique = b.dataset.m;
    rapAfficher();
  }));

  rapDessinerGraphique(c);
}

function rapDessinerGraphique(c) {
  const canvas = document.getElementById('rap-chart');
  if (!window.Chart) {
    document.getElementById('rap-chart-fallback').innerHTML =
      '<p class="muted-admin" style="margin:0;">Le graphique n\u2019a pas pu être chargé (connexion internet requise).</p>';
    canvas.style.display = 'none';
    return;
  }
  const m = rap.metrique;
  // Fond blanc : indispensable pour l'image insérée dans le PDF.
  const fondBlanc = {
    id: 'fondBlanc',
    beforeDraw(chart) {
      const ctx = chart.canvas.getContext('2d');
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, chart.width, chart.height); ctx.restore();
    }
  };
  rap.chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: c.mois.map(x => rapLibelleMois(x.k, true)),
      datasets: c.listeAg.map(a => ({
        label: a.label,
        data: c.mois.map(x => (x.parAg[a.cle] || { nb: 0, montant: 0 })[m]),
        backgroundColor: a.couleur,
        hoverBackgroundColor: a.couleur,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 34,
        categoryPercentage: 0.72,
        barPercentage: 0.86
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      transitions: { resize: { animation: { duration: 0 } } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0C3F65', padding: 12, cornerRadius: 10,
          titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label} : ${m === 'montant' ? formatFCFA(ctx.parsed.y) : ctx.parsed.y.toLocaleString('fr-FR') + ' colis'}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64778D', font: { family: 'Inter', size: 11 } } },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: '#EFF3F7' },
          ticks: {
            color: '#64778D', font: { family: 'Inter', size: 11 }, maxTicksLimit: 6,
            precision: m === 'nb' ? 0 : undefined,
            callback: v => m === 'montant' ? rapCompact(v) : v
          }
        }
      }
    },
    plugins: [fondBlanc]
  });
}

// ---------- Nom du fichier exporté ----------

function rapNomFichier(ext) {
  const c = rap.dernierCalcul;
  const du = c.du ? rapIso(c.du) : 'debut';
  const au = c.au ? rapIso(c.au) : rapIso(new Date());
  return `coligo-rapport_${du}_${au}.${ext}`;
}

// ---------- Export PDF ----------

// Les polices standard du PDF ne connaissent pas les espaces fines insécables
// utilisées par toLocaleString('fr-FR') : on les remplace par des espaces.
function rapTxt(s) { return String(s).replace(/[\u202F\u00A0]/g, ' '); }

async function rapLogoDataUrl() {
  try {
    const r = await fetch('assets/logo-coligo-blanc.png');
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  } catch (e) { return null; }
}

async function rapExporterPDF() {
  const c = rap.dernierCalcul;
  if (!c || !c.totalNb) return;
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("L'export PDF n'a pas pu être chargé. Vérifiez la connexion internet puis rechargez la page."); return; }

  const btn = document.getElementById('rap-export-pdf');
  setBtnLoading(btn, 'Préparation…');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 14;
    const bleuNuit = [12, 63, 101], encre = [20, 32, 45], gris = [100, 119, 141], ligne = [220, 229, 238];

    // En-tête
    doc.setFillColor(...bleuNuit);
    doc.rect(0, 0, W, 30, 'F');
    const logo = await rapLogoDataUrl();
    let xTitre = M;
    if (logo) {
      try {
        const p = doc.getImageProperties(logo);
        const h = 12, w = (p.width / p.height) * h;
        doc.addImage(logo, 'PNG', M, 9, w, h);
        xTitre = M + w + 6;
      } catch (e) { /* logo ignoré */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(rapTxt("Rapport d'activité"), xTitre, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text(rapTxt(rapLibellePeriode(c)), xTitre, 20.5);
    doc.setFontSize(8.5);
    doc.text(rapTxt('Généré le ' + new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })), W - M, 20.5, { align: 'right' });

    // Indicateurs
    const cr = c.croissance;
    const kpis = [
      ["Chiffre d'affaires total", formatFCFA(c.totalMontant), `${c.moisActifs} mois actif${c.moisActifs > 1 ? 's' : ''}`],
      ['Nombre total de colis', c.totalNb.toLocaleString('fr-FR'), `Moyenne ${formatFCFA(Math.round(c.totalMontant / c.totalNb))} / colis`],
      ['Agence la plus performante', c.meilleure ? c.meilleure.label : '-', c.meilleure && c.totalMontant ? `${Math.round((c.meilleure.montant / c.totalMontant) * 100)} % du CA` : ''],
      ['Croissance vs mois dernier', cr.valeur === null ? (cr.caRef > 0 ? 'Nouveau' : '-') : rapPourcent(cr.valeur),
        `${rapLibelleMois(cr.kRef, true)} vs ${rapLibelleMois(cr.kRef - 1, true)}${cr.moisEnCours ? ' (même période)' : ''}`]
    ];
    const gap = 4, bw = (W - 2 * M - 3 * gap) / 4, by = 38, bh = 26;
    kpis.forEach(([l, v, s], i) => {
      const x = M + i * (bw + gap);
      doc.setDrawColor(...ligne); doc.setFillColor(248, 251, 253);
      doc.roundedRect(x, by, bw, bh, 2.5, 2.5, 'FD');
      doc.setTextColor(...gris); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(rapTxt(l), x + 3.5, by + 6.5);
      if (i === 3 && cr.valeur !== null) doc.setTextColor(...(cr.valeur >= 0 ? [21, 121, 90] : [180, 35, 24]));
      else doc.setTextColor(...encre);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(v.length > 16 ? 10.5 : 12.5);
      doc.text(rapTxt(v), x + 3.5, by + 15);
      doc.setTextColor(...gris); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.text(doc.splitTextToSize(rapTxt(s), bw - 7).slice(0, 2), x + 3.5, by + 20.5);
    });

    // Graphique
    let y = by + bh + 10;
    doc.setTextColor(...bleuNuit); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(rapTxt(rap.metrique === 'montant' ? "Chiffre d'affaires par mois et par agence" : 'Nombre de colis par mois et par agence'), M, y);
    y += 3;
    if (rap.chart) {
      const img = rap.chart.toBase64Image('image/png', 1);
      const cw = rap.chart.width, ch = rap.chart.height;
      const iw = W - 2 * M, ih = Math.min(80, iw * ch / cw);
      doc.addImage(img, 'PNG', M, y, iw, ih);
      y += ih + 5;
      // Légende
      let lx = M;
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      c.listeAg.forEach(a => {
        const rgb = a.couleur.match(/\w\w/g).map(h => parseInt(h, 16));
        doc.setFillColor(...rgb); doc.roundedRect(lx, y - 2.6, 3, 3, 0.6, 0.6, 'F');
        doc.setTextColor(...encre);
        const t = rapTxt(`${a.label} : ${formatFCFA(a.montant)} (${a.nb} colis)`);
        doc.text(t, lx + 4.5, y);
        lx += doc.getTextWidth(t) + 12;
      });
      y += 7;
    }

    // Tableau mensuel
    const head = [['Mois', ...c.listeAg.flatMap(a => [`${a.label}\ncolis`, `${a.label}\nCA`]), 'Total\ncolis', 'Total\nCA']];
    const body = [...c.mois].reverse().map(m => [
      rapLibelleMois(m.k) + (m.archive ? ' *' : ''),
      ...c.listeAg.flatMap(a => { const v = m.parAg[a.cle] || { nb: 0, montant: 0 }; return [v.nb ? String(v.nb) : '-', v.montant ? rapTxt(formatFCFA(v.montant)) : '-']; }),
      m.nb ? String(m.nb) : '-', m.montant ? rapTxt(formatFCFA(m.montant)) : '-'
    ]);
    const foot = [['Total', ...c.listeAg.flatMap(a => [String(a.nb), rapTxt(formatFCFA(a.montant))]), String(c.totalNb), rapTxt(formatFCFA(c.totalMontant))]];

    doc.autoTable({
      startY: y,
      head, body, foot,
      margin: { left: M, right: M, bottom: 16 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, lineColor: ligne, lineWidth: 0.2, textColor: encre },
      headStyles: { fillColor: bleuNuit, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
      footStyles: { fillColor: [232, 242, 249], textColor: bleuNuit, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 251, 253] },
      columnStyles: Object.fromEntries(Array.from({ length: head[0].length }, (_, i) => [i, { halign: i === 0 ? 'left' : 'right' }])),
      didParseCell: (d) => { if (d.section === 'foot' && d.column.index > 0) d.cell.styles.halign = 'right'; },
      didDrawPage: () => {
        const H = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5); doc.setTextColor(...gris); doc.setFont('helvetica', 'normal');
        doc.text('COLIGO', M, H - 8);
        doc.text(rapTxt(`Page ${doc.internal.getNumberOfPages()}`), W - M, H - 8, { align: 'right' });
      }
    });

    if (c.archivePresente) {
      const fy = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(7.5); doc.setTextColor(...gris);
      doc.text(rapTxt('* Inclut des totaux archivés : colis supprimés après leur durée de conservation, chiffres conservés.'), M, fy);
    }

    doc.save(rapNomFichier('pdf'));
  } catch (e) {
    console.error(e);
    alert("La génération du PDF a échoué. Réessayez.");
  } finally {
    clearBtnLoading(btn);
  }
}
