document.getElementById('btn-signup').addEventListener('click', async () => {
  const errorZone = document.getElementById('signup-error');
  const successZone = document.getElementById('signup-success');
  errorZone.innerHTML = '';
  successZone.innerHTML = '';

  const nom = document.getElementById('s-nom').value.trim();
  const agence = document.getElementById('s-agence').value.trim();
  const role = document.getElementById('s-role').value;
  const username = document.getElementById('s-username').value.trim();
  const email = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-password').value;
  const password2 = document.getElementById('s-password2').value;
  const invite = document.getElementById('s-invite').value.trim();

  if (!nom || !agence || !username || !email || !password || !invite) {
    errorZone.innerHTML = '<div class="error-box">Merci de remplir tous les champs.</div>';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorZone.innerHTML = '<div class="error-box">Adresse e-mail invalide.</div>';
    return;
  }
  if (password !== password2) {
    errorZone.innerHTML = '<div class="error-box">Les mots de passe ne correspondent pas.</div>';
    return;
  }
  if (password.length < 4) {
    errorZone.innerHTML = '<div class="error-box">Le mot de passe doit contenir au moins 4 caractères.</div>';
    return;
  }

  const btn = document.getElementById('btn-signup');
  setBtnLoading(btn, 'Création du compte…');

  const { data, error } = await supabaseClient.rpc('agent_signup', {
    p_nom: nom,
    p_agence: agence,
    p_role: role,
    p_username: username,
    p_email: email,
    p_password: password,
    p_invite: invite
  });

  clearBtnLoading(btn);

  if (error) {
    errorZone.innerHTML = '<div class="error-box">Impossible de créer le compte pour le moment. Réessayez.</div>';
    return;
  }
  if (!data || !data.ok) {
    errorZone.innerHTML = `<div class="error-box">${(data && data.message) || 'Impossible de créer le compte.'}</div>`;
    return;
  }

  successZone.innerHTML = `<div class="success-box">Compte créé avec succès. Vous pouvez maintenant vous connecter sur <a href="${role === 'administrateur' ? 'Admin.html' : 'agent.html'}">${role === 'administrateur' ? 'Admin.html' : 'agent.html'}</a>.</div>`;

  ['s-nom','s-agence','s-username','s-email','s-password','s-password2','s-invite'].forEach(id => {
    document.getElementById(id).value = '';
  });
});
