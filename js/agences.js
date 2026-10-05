/* COLIGO — Agences dynamiques (liste, codes de suivi, administration).
   Dépend de config.js (supabaseClient). Sans la migration SQL, repli sur
   Douala / Yaoundé : rien ne casse. */
const VILLES_CAMEROUN = {
  'Bafoussam':'BFM','Bamenda':'BDA','Bertoua':'BTA','Buea':'BUE','Dschang':'DSG','Ebolowa':'EBW',
  'Edéa':'EDA','Foumban':'FMB','Garoua':'GRA','Kribi':'KRB','Kumba':'KMB','Limbé':'LMB',
  'Maroua':'MRA','Mbalmayo':'MBL','Mbouda':'MBD','Ngaoundéré':'NGE','Nkongsamba':'NKS',
  'Sangmélima':'SGM','Yokadouma':'YKD'
};
const AGENCES_DEFAUT = [{ nom:'Yaoundé', code:'YDE' }, { nom:'Douala', code:'DLA' }];
let AGENCES = AGENCES_DEFAUT.slice();

function _agNorm(s) { return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function _agEsc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function chargerAgences(tout) {
  try {
    let q = supabaseClient.from('agences').select('*').order('nom');
    if (!tout) q = q.eq('actif', true);
    const { data, error } = await q;
    if (error) throw error;
    if (data && data.length) AGENCES = data;
  } catch (e) { AGENCES = AGENCES_DEFAUT.slice(); window.AGENCES_ERREUR = e; }
  if (typeof AGENCE_CODES !== 'undefined') AGENCES.forEach(a => { AGENCE_CODES[_agNorm(a.nom)] = a.code; });
  return AGENCES;
}

function remplirSelectAgences(select, valeur) {
  if (!select) return;
  select.innerHTML = AGENCES.filter(a => a.actif !== false)
    .map(a => `<option value="${_agEsc(a.nom)}">${_agEsc(a.nom)}</option>`).join('');
  if (valeur) select.value = valeur;
}

/* ---- Administration : bloc « Agences » (Admin.html) ---- */
function _agMsg(txt, erreur) {
  const el = document.getElementById('ag-msg'); if (!el) return;
  el.textContent = txt; el.style.color = erreur ? 'var(--danger)' : 'var(--ok)';
  if (!erreur) setTimeout(() => { if (el.textContent === txt) el.textContent = ''; }, 2000);
}
async function rendreAgencesAdmin() {
  const liste = document.getElementById('agences-liste'); if (!liste) return;
  const sel = document.getElementById('ag-ville');
  if (sel && !sel.options.length) {
    sel.innerHTML = Object.keys(VILLES_CAMEROUN).map(v => `<option>${v}</option>`).join('') + '<option value="__autre">Autre…</option>';
    sel.onchange = majChampAgence; majChampAgence();
    document.getElementById('ag-add').onclick = ajouterAgence;
  }
  await chargerAgences(false);
  if (window.AGENCES_ERREUR) _agMsg("Table « agences » introuvable : exécutez sql/agences_migration.sql dans Supabase.", true);
  liste.innerHTML = AGENCES.map(a => `<div class="ag-ligne"><span><strong>${_agEsc(a.nom)}</strong> <span class="muted-admin">· ${_agEsc(a.code)}000001/${new Date().getFullYear()%100}</span></span>
    <button class="admin-btn ag-retirer" data-nom="${_agEsc(a.nom)}" type="button">Retirer</button></div>`).join('') || '<div class="table-state">Aucune agence.</div>';
  liste.querySelectorAll('.ag-retirer').forEach(b => b.onclick = () => retirerAgence(b.dataset.nom));
}
function majChampAgence() {
  const sel = document.getElementById('ag-ville'), autre = sel.value === '__autre';
  document.getElementById('ag-nom-wrap').style.display = autre ? '' : 'none';
  const code = document.getElementById('ag-code');
  if (!autre) code.value = VILLES_CAMEROUN[sel.value] || '';
}
async function ajouterAgence() {
  const sel = document.getElementById('ag-ville');
  const nom = (sel.value === '__autre' ? document.getElementById('ag-nom').value : sel.value).trim().replace(/\s+/g, ' ');
  const code = document.getElementById('ag-code').value.trim().toUpperCase();
  if (nom.length < 2) return _agMsg('Saisissez le nom de la ville.', true);
  if (!/^[A-Z]{3}$/.test(code)) return _agMsg('Le code doit contenir exactement 3 lettres (ex. BTA).', true);
  if (AGENCES.some(a => _agNorm(a.nom) === _agNorm(nom))) return _agMsg('Cette agence existe déjà.', true);
  if (AGENCES.some(a => a.code === code)) return _agMsg('Ce code est déjà utilisé par une autre agence.', true);
  const btn = document.getElementById('ag-add'); btn.classList.add('is-loading');
  // Une agence retirée puis rajoutée est réactivée.
  let { error } = await supabaseClient.from('agences').upsert({ nom, code, actif: true }, { onConflict: 'nom' });
  btn.classList.remove('is-loading');
  if (error) return _agMsg("Ajout impossible : " + (error.message || 'erreur inconnue'), true);
  document.getElementById('ag-nom').value = '';
  _agMsg(`Agence ${nom} ajoutée.`); rendreAgencesAdmin();
}
async function retirerAgence(nom) {
  if (!confirm(`Retirer l'agence ${nom} ?\nElle ne sera plus proposée à l'inscription. Les colis et l'historique sont conservés.`)) return;
  const { error } = await supabaseClient.from('agences').update({ actif: false }).eq('nom', nom);
  if (error) return _agMsg('Retrait impossible : ' + error.message, true);
  _agMsg(`Agence ${nom} retirée.`); rendreAgencesAdmin();
}
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('agences-liste')) rendreAgencesAdmin();
  const s = document.getElementById('s-agence');
  if (s) chargerAgences(false).then(() => remplirSelectAgences(s));
});
