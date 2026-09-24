// ==========================================================
// COLIGO — "Mot de passe oublié ?" (code envoyé par e-mail)
// ----------------------------------------------------------
// Chargé sur Admin.html, agent.html et retrait.html : les trois écrans
// de connexion partagent exactement les mêmes ids (#forgot-toggle,
// #forgot-panel, etc.), donc ce seul fichier suffit pour les trois.
// Nécessite sql/reset_password_migration.sql (fonctions request_password_reset
// et confirm_password_reset) déjà exécuté dans Supabase.
// ==========================================================

document.addEventListener('DOMContentLoaded', function () {
  const $ = (id) => document.getElementById(id);

  const loginForm = $('login-form');
  const forgotPanel = $('forgot-panel');
  const forgotToggle = $('forgot-toggle');
  const forgotCancel = $('forgot-cancel');
  const step1 = $('forgot-step-1');
  const step2 = $('forgot-step-2');
  const resendBtn = $('btn-forgot-resend');

  // Sécurité : si une page n'a pas (encore) ce bloc, on ne fait rien.
  if (!forgotToggle || !forgotPanel || !loginForm) return;

  const MAX_ENVOIS = 4;   // 1 envoi initial + jusqu'à 3 renvois
  const COOLDOWN_SEC = 25;
  let envoisCount = 0;
  let cooldownTimer = null;

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function errBox(msg) { return `<div class="admin-error-box">${escHtml(msg)}</div>`; }
  function okBox(msg) { return `<div class="admin-info-box">${escHtml(msg)}</div>`; }

  function stopCooldown() {
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
  }

  function resetResendButton() {
    stopCooldown();
    if (resendBtn) { resendBtn.disabled = true; resendBtn.textContent = 'Renvoyer le code (25s)'; }
  }

  // Verrouille le bouton "Renvoyer le code" pendant COOLDOWN_SEC secondes,
  // puis le relibère — sauf si le nombre maximal d'envois est atteint.
  function startCooldown() {
    if (!resendBtn) return;
    stopCooldown();
    let restant = COOLDOWN_SEC;
    resendBtn.disabled = true;
    resendBtn.textContent = `Renvoyer le code (${restant}s)`;
    cooldownTimer = setInterval(() => {
      restant--;
      if (restant <= 0) {
        stopCooldown();
        if (envoisCount >= MAX_ENVOIS) {
          resendBtn.disabled = true;
          resendBtn.textContent = 'Nombre maximal de tentatives atteint';
        } else {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Renvoyer le code';
        }
      } else {
        resendBtn.textContent = `Renvoyer le code (${restant}s)`;
      }
    }, 1000);
  }

  function showForgot() {
    loginForm.classList.add('hidden');
    forgotPanel.classList.remove('hidden');
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    $('forgot-username').value = '';
    $('forgot-error-1').innerHTML = '';
    $('forgot-error-2').innerHTML = '';
    envoisCount = 0;
    resetResendButton();
  }

  function showLoginAgain() {
    forgotPanel.classList.add('hidden');
    loginForm.classList.remove('hidden');
    stopCooldown();
  }

  forgotToggle.addEventListener('click', (e) => { e.preventDefault(); showForgot(); });
  forgotCancel.addEventListener('click', (e) => { e.preventDefault(); showLoginAgain(); });

  // ---------- Étape 1 : demander le code (1er envoi) ----------
  $('btn-forgot-send').addEventListener('click', async () => {
    const btn = $('btn-forgot-send');
    const username = $('forgot-username').value.trim();
    const zone = $('forgot-error-1');
    zone.innerHTML = '';

    if (!username) { zone.innerHTML = errBox("Renseignez votre identifiant."); return; }

    setBtnLoading(btn, 'Envoi…');
    const { data, error } = await supabaseClient.rpc('request_password_reset', { p_username: username });
    clearBtnLoading(btn);

    if (error) { zone.innerHTML = errBox("Impossible de contacter le serveur. Réessayez."); return; }
    if (!data || !data.ok) {
      zone.innerHTML = errBox((data && data.message) || "Identifiant introuvable.");
      return;
    }

    envoisCount = 1;
    $('forgot-sent-msg').textContent = data.email_masque
      ? `Un code a été envoyé à ${data.email_masque}. Il est valable 10 minutes.`
      : "Un code a été envoyé par e-mail. Il est valable 10 minutes.";
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
    $('forgot-code').value = '';
    $('forgot-new-password').value = '';
    $('forgot-error-2').innerHTML = '';
    startCooldown();
  });

  // ---------- Renvoyer le code (verrouillé 25s après chaque envoi, 4 envois max) ----------
  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (resendBtn.disabled || envoisCount >= MAX_ENVOIS) return;
      const username = $('forgot-username').value.trim();
      const zone = $('forgot-error-2');
      zone.innerHTML = '';

      resendBtn.disabled = true;
      resendBtn.textContent = 'Envoi…';
      const { data, error } = await supabaseClient.rpc('request_password_reset', { p_username: username });

      if (error || !data || !data.ok) {
        zone.innerHTML = errBox((data && data.message) || "Échec de l'envoi. Réessayez.");
        resendBtn.disabled = false;
        resendBtn.textContent = 'Renvoyer le code';
        return;
      }

      envoisCount++;
      $('forgot-sent-msg').textContent = data.email_masque
        ? `Un nouveau code a été envoyé à ${data.email_masque}. Il est valable 10 minutes.`
        : "Un nouveau code a été envoyé par e-mail. Il est valable 10 minutes.";
      $('forgot-code').value = '';

      if (envoisCount >= MAX_ENVOIS) {
        // Le dernier envoi autorisé vient de partir : on laisse les 25s
        // s'écouler (au cas où le code arrive), puis le bouton reste verrouillé.
        startCooldown();
      } else {
        startCooldown();
      }
    });
  }

  // ---------- Étape 2 : valider le code + nouveau mot de passe ----------
  $('btn-forgot-confirm').addEventListener('click', async () => {
    const btn = $('btn-forgot-confirm');
    const username = $('forgot-username').value.trim();
    const code = $('forgot-code').value.trim();
    const nouveau = $('forgot-new-password').value;
    const zone = $('forgot-error-2');
    zone.innerHTML = '';

    if (!code || !nouveau) { zone.innerHTML = errBox("Renseignez le code reçu et le nouveau mot de passe."); return; }
    if (nouveau.length < 4) { zone.innerHTML = errBox("Le mot de passe doit contenir au moins 4 caractères."); return; }

    setBtnLoading(btn, 'Vérification…');
    const { data, error } = await supabaseClient.rpc('confirm_password_reset', {
      p_username: username, p_code: code, p_nouveau_mdp: nouveau
    });
    clearBtnLoading(btn);

    if (error) { zone.innerHTML = errBox("Impossible de contacter le serveur. Réessayez."); return; }
    if (!data || !data.ok) {
      zone.innerHTML = errBox((data && data.message) || "Code invalide ou expiré.");
      return;
    }

    showLoginAgain();
    $('login-username').value = username;
    $('login-password').value = '';
    $('login-error').innerHTML = okBox('Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.');
  });
});
