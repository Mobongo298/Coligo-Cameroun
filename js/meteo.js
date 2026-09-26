// ==========================================================
// COLIGO — Météo du Cameroun (tableau de bord agent)
// ----------------------------------------------------------
// Source : Open-Meteo (https://open-meteo.com), service gratuit, sans clé
// et sans inscription. Les données sont actualisées toutes les 10 minutes
// (et dès que l'onglet redevient visible). Le fond de la carte est une
// scène animée (soleil, nuages, pluie, orage, nuit, brouillard) qui suit le
// temps actuel de la ville de l'agence. La ville de l'agence est mise
// en avant ; les autres grandes villes du pays sont affichées en dessous.
// Aucune donnée COLIGO n'est envoyée : seules des coordonnées de villes.
// ==========================================================

const METEO_VILLES = [
  { nom: 'Douala',     lat: 4.0511,  lon: 9.7679 },
  { nom: 'Yaoundé',    lat: 3.8480,  lon: 11.5021 },
  { nom: 'Bafoussam',  lat: 5.4778,  lon: 10.4176 },
  { nom: 'Bamenda',    lat: 5.9631,  lon: 10.1591 },
  { nom: 'Garoua',     lat: 9.3017,  lon: 13.3921 },
  { nom: 'Maroua',     lat: 10.5956, lon: 14.3247 },
  { nom: 'Ngaoundéré', lat: 7.3167,  lon: 13.5833 },
  { nom: 'Bertoua',    lat: 4.5773,  lon: 13.6846 },
  { nom: 'Ebolowa',    lat: 2.9000,  lon: 11.1500 },
  { nom: 'Buea',       lat: 4.1527,  lon: 9.2410 }
];
const METEO_INTERVALLE_MS = 10 * 60 * 1000;
let meteoMinuteur = null;
let meteoDernierAppel = 0;

// ---------- Icônes (SVG en ligne, en couleur) ----------
const M_SOLEIL = '<g><circle cx="24" cy="24" r="8" fill="#F5B30B"/><g stroke="#F5B30B" stroke-width="3" stroke-linecap="round"><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/></g></g>';
const M_LUNE = '<path d="M30 8a15 15 0 1 0 10 26A13 13 0 0 1 30 8z" fill="#8FA3BF"/>';
const M_NUAGE = (x = 0, y = 0, c = '#B7C3D2') => `<path transform="translate(${x} ${y})" d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21-2 8 8 0 0 0 1 18z" fill="${c}"/>`;
const M_PLUIE = '<g stroke="#1D6FA8" stroke-width="3" stroke-linecap="round"><path d="M17 40l-2 5M25 40l-2 5M33 40l-2 5"/></g>';
const M_BRUINE = '<g fill="#368AC8"><circle cx="17" cy="42" r="1.6"/><circle cx="25" cy="44" r="1.6"/><circle cx="33" cy="42" r="1.6"/></g>';
const M_ECLAIR = '<path d="M26 34l-6 9h5l-3 6 9-10h-5l3-5z" fill="#F5B30B" stroke="#C98A00" stroke-width="0.8" stroke-linejoin="round"/>';
const M_BROUILLARD = '<g stroke="#9AA8BA" stroke-width="3" stroke-linecap="round"><path d="M10 40h28M14 45h20"/></g>';

function meteoIcone(code, jour, taille) {
  let dessin;
  const astre = jour ? `<g transform="translate(-6 -8) scale(0.8)">${M_SOLEIL}</g>` : `<g transform="translate(-4 -6) scale(0.7)">${M_LUNE}</g>`;
  if (code === 0) dessin = jour ? M_SOLEIL : M_LUNE;
  else if (code === 1 || code === 2) dessin = astre + M_NUAGE(4, 2);
  else if (code === 3) dessin = M_NUAGE(-2, -4, '#C8D2DE') + M_NUAGE(2, 2, '#9FB0C4');
  else if (code === 45 || code === 48) dessin = M_NUAGE(0, -6) + M_BROUILLARD;
  else if (code >= 51 && code <= 57) dessin = M_NUAGE(0, -4, '#A9B7C8') + M_BRUINE;
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) dessin = M_NUAGE(0, -4, '#8FA1B6') + M_PLUIE;
  else if (code >= 95) dessin = M_NUAGE(0, -6, '#6F8198') + M_ECLAIR;
  else dessin = M_NUAGE(0, -2);
  return `<svg viewBox="0 0 48 48" width="${taille}" height="${taille}" aria-hidden="true">${dessin}</svg>`;
}

function meteoLibelle(code) {
  if (code === 0) return 'Ciel dégagé';
  if (code === 1) return 'Plutôt ensoleillé';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Couvert';
  if (code === 45 || code === 48) return 'Brouillard';
  if (code >= 51 && code <= 57) return 'Bruine';
  if (code === 61 || code === 80) return 'Pluie faible';
  if (code === 63 || code === 81) return 'Pluie';
  if (code === 65 || code === 82) return 'Forte pluie';
  if (code === 66 || code === 67) return 'Pluie verglaçante';
  if (code >= 95) return 'Orage';
  return 'Nuageux';
}

// ---------- Fond animé : une scène par type de temps ----------
// Chaque scène a une ambiance (ciel, soleil, nuages, pluie, éclairs, étoiles,
// brume). Sur les fonds sombres le texte passe en blanc ; sur les fonds
// clairs il reste foncé, pour rester lisible.
function meteoScene(code, jour) {
  if (code >= 95) return { nom: 'orage', texte: 'sombre' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { nom: jour ? 'pluie' : 'pluie-nuit', texte: 'sombre' };
  if (code >= 51 && code <= 57) return { nom: jour ? 'bruine' : 'pluie-nuit', texte: 'sombre' };
  if (code === 45 || code === 48) return { nom: jour ? 'brouillard' : 'nuit-nuageux', texte: jour ? 'clair' : 'sombre' };
  if (!jour) return { nom: code <= 1 ? 'nuit' : 'nuit-nuageux', texte: 'sombre' };
  if (code === 0 || code === 1) return { nom: 'soleil', texte: 'sombre' };
  if (code === 2) return { nom: 'nuageux', texte: 'sombre' };
  return { nom: 'couvert', texte: 'sombre' };
}

function meteoAleatoire(min, max) { return (Math.random() * (max - min) + min).toFixed(2); }

function meteoConstruireFond(scene) {
  const fond = document.getElementById('meteo-fond');
  const carte = document.getElementById('meteo-carte');
  if (!fond || !carte) return;
  if (carte.dataset.scene === scene.nom) return; // déjà en place, pas de saut d'animation
  carte.dataset.scene = scene.nom;
  carte.className = carte.className.replace(/\bmeteo-scene-\S+/g, '').replace(/\bmeteo-texte-\S+/g, '').trim()
    + ` meteo-scene-${scene.nom} meteo-texte-${scene.texte}`;

  const n = scene.nom;
  let html = '<div class="mf-ciel"></div>';
  if (n === 'soleil' || n === 'nuageux') html += '<div class="mf-soleil"><div class="mf-rayons"></div></div>';
  if (n === 'nuit' || n === 'nuit-nuageux' || n === 'pluie-nuit') {
    html += '<div class="mf-lune"></div>';
    for (let i = 0; i < 28; i++) {
      html += `<span class="mf-etoile" style="left:${meteoAleatoire(0, 100)}%;top:${meteoAleatoire(0, 70)}%;animation-delay:${meteoAleatoire(0, 4)}s;animation-duration:${meteoAleatoire(2, 5)}s"></span>`;
    }
  }
  const nbNuages = { soleil: 1, nuageux: 3, couvert: 5, bruine: 4, pluie: 5, 'pluie-nuit': 4, orage: 5, brouillard: 2, nuit: 0, 'nuit-nuageux': 3 }[n] || 0;
  for (let i = 0; i < nbNuages; i++) {
    const taille = meteoAleatoire(0.7, 1.35);
    html += `<div class="mf-nuage" style="top:${meteoAleatoire(-10, 45)}%;--echelle:${taille};animation-duration:${meteoAleatoire(38, 70)}s;animation-delay:-${meteoAleatoire(0, 60)}s"></div>`;
  }
  const nbGouttes = { bruine: 35, pluie: 70, 'pluie-nuit': 60, orage: 90 }[n] || 0;
  if (nbGouttes) {
    html += '<div class="mf-pluie">';
    for (let i = 0; i < nbGouttes; i++) {
      html += `<span style="left:${meteoAleatoire(-5, 105)}%;animation-delay:-${meteoAleatoire(0, 1.5)}s;animation-duration:${meteoAleatoire(0.55, 1.05)}s;opacity:${meteoAleatoire(0.35, 0.85)}"></span>`;
    }
    html += '</div>';
  }
  if (n === 'orage') html += '<div class="mf-eclair"></div><svg class="mf-foudre" viewBox="0 0 40 120" aria-hidden="true"><path d="M24 0 8 58h12L10 120 34 46H22L30 0z"/></svg>';
  if (n === 'brouillard') html += '<div class="mf-brume mf-brume-1"></div><div class="mf-brume mf-brume-2"></div>';
  html += '<div class="mf-voile"></div>';
  fond.innerHTML = html;
}

function meteoEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function meteoNorm(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function meteoArrondi(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Math.round(n); }

// ---------- Chargement ----------
async function chargerMeteo() {
  const zoneMain = document.getElementById('meteo-principale');
  const zoneVilles = document.getElementById('meteo-villes');
  const maj = document.getElementById('meteo-maj');
  if (!zoneMain || !zoneVilles) return;
  meteoDernierAppel = Date.now();

  const session = (typeof getSession === 'function') ? getSession() : null;
  const agence = session ? meteoNorm(session.agence) : '';
  const principale = METEO_VILLES.find(v => meteoNorm(v.nom) === agence) || METEO_VILLES[0];
  const autres = METEO_VILLES.filter(v => v !== principale).slice(0, 9);
  const villes = [principale, ...autres];

  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + villes.map(v => v.lat).join(',')
    + '&longitude=' + villes.map(v => v.lon).join(',')
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&forecast_days=1&timezone=Africa%2FDouala';

  try {
    const rep = await fetch(url);
    if (!rep.ok) throw new Error('HTTP ' + rep.status);
    let donnees = await rep.json();
    if (!Array.isArray(donnees)) donnees = [donnees];

    const p = donnees[0], cur = p.current || {}, day = p.daily || {};
    const code = cur.weather_code, jour = cur.is_day === 1;
    meteoConstruireFond(meteoScene(code, jour));
    zoneMain.innerHTML = `
      <div class="flex items-center gap-3 sm:gap-4">
        <div class="shrink-0 meteo-icone-principale">${meteoIcone(code, jour, 58)}</div>
        <div class="min-w-0">
          <div class="text-xs font-semibold meteo-sous">${meteoEsc(principale.nom)} · votre agence</div>
          <div class="flex items-baseline gap-2.5 flex-wrap">
            <span class="meteo-temp">${meteoArrondi(cur.temperature_2m)}°C</span>
            <span class="text-sm font-semibold meteo-titre">${meteoLibelle(code)}</span>
          </div>
          <div class="text-[11px] meteo-sous mt-0.5">
            Ressenti ${meteoArrondi(cur.apparent_temperature)}°C ·
            Min ${meteoArrondi(day.temperature_2m_min && day.temperature_2m_min[0])}° / Max ${meteoArrondi(day.temperature_2m_max && day.temperature_2m_max[0])}° ·
            Humidité ${meteoArrondi(cur.relative_humidity_2m)} % ·
            Vent ${meteoArrondi(cur.wind_speed_10m)} km/h ·
            Pluie ${meteoArrondi(day.precipitation_probability_max && day.precipitation_probability_max[0])} %
          </div>
        </div>
      </div>`;

    zoneVilles.innerHTML = donnees.slice(1).map((d, i) => {
      const c = d.current || {};
      return `
        <div class="meteo-ville" title="${meteoEsc(autres[i].nom)} : ${meteoLibelle(c.weather_code)}">
          ${meteoIcone(c.weather_code, c.is_day === 1, 24)}
          <div class="min-w-0">
            <div class="meteo-ville-nom truncate">${meteoEsc(autres[i].nom)}</div>
            <div class="meteo-ville-temp">${meteoArrondi(c.temperature_2m)}°C</div>
          </div>
        </div>`;
    }).join('');

    const h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (maj) maj.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle"></span>Mis à jour à ${h}`;
  } catch (e) {
    if (!zoneMain.innerHTML.trim()) {
      zoneMain.innerHTML = '<p class="text-sm meteo-sous">Météo indisponible pour le moment (connexion internet requise).</p>';
    }
    if (maj) maj.textContent = 'Nouvelle tentative dans 10 min';
  }
}

function demarrerMeteo() {
  chargerMeteo();
  clearInterval(meteoMinuteur);
  meteoMinuteur = setInterval(chargerMeteo, METEO_INTERVALLE_MS);
}

// Onglet de nouveau visible : actualise si la dernière mise à jour date de plus de 5 min.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - meteoDernierAppel > 5 * 60 * 1000) chargerMeteo();
});

// ---------- Horloge de la carte « Aperçu du jour » ----------
function majHorlogeApercu() {
  const heure = document.getElementById('apercu-heure');
  const date = document.getElementById('today-date');
  const maintenant = new Date();
  if (heure) heure.textContent = maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (date) {
    const txt = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    date.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
  }
}
majHorlogeApercu();
setInterval(majHorlogeApercu, 20 * 1000);

// Démarre dès que l'espace agent est ouvert (session présente).
if (typeof getSession === 'function' && getSession()) demarrerMeteo();
