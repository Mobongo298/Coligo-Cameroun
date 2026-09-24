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

  // Limite de 10 comptes administrateur pour tout le système.
  if (role === 'administrateur') {
    const { count } = await supabaseClient
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'administrateur');

    if ((count || 0) >= 10) {
      errorZone.innerHTML = '<div class="error-box">Le nombre maximum de comptes administrateur (10) est déjà atteint.</div>';
      clearBtnLoading(btn);
      return;
    }
  }

  // L'identifiant doit être unique.
  const { data: dejaExistant } = await supabaseClient
    .from('agents')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (dejaExistant) {
    errorZone.innerHTML = '<div class="error-box">Cet identifiant est déjà utilisé. Choisissez-en un autre.</div>';
    clearBtnLoading(btn);
    return;
  }

  // Vérification du code d'invitation, en base de données : s'il est
  // correct, il est immédiatement remplacé par un nouveau code (usage
  // unique). Rien n'est encore créé à ce stade.
  const { data: codeValide, error: codeError } = await supabaseClient.rpc(
    'verify_and_rotate_invite',
    { code_saisi: invite }
  );

  if (codeError) {
    errorZone.innerHTML = '<div class="error-box">Impossible de vérifier le code d\'invitation pour le moment. Réessayez.</div>';
    clearBtnLoading(btn);
    return;
  }
  if (!codeValide) {
    errorZone.innerHTML = '<div class="error-box">Code d\'invitation invalide. Demandez le code actuel à un administrateur.</div>';
    clearBtnLoading(btn);
    return;
  }

  // Le code est valide et vient d'être régénéré : on crée maintenant le compte.
  const { error: insertError } = await supabaseClient
    .from('agents')
    .insert({
      nom_complet: nom,
      agence: agence,
      role: role,
      username: username,
      email: email,
      password: password
    });

  clearBtnLoading(btn);

  if (insertError) {
    errorZone.innerHTML = '<div class="error-box">Le code a été accepté mais la création du compte a échoué. Contactez un administrateur pour obtenir un nouveau code.</div>';
    return;
  }

  successZone.innerHTML = `<div class="success-box">Compte créé avec succès. Vous pouvez maintenant vous connecter sur <a href="${role === 'administrateur' ? 'Admin.html' : 'agent.html'}">${role === 'administrateur' ? 'Admin.html' : 'agent.html'}</a>.</div>`;

  ['s-nom','s-agence','s-username','s-email','s-password','s-password2','s-invite'].forEach(id => {
    document.getElementById(id).value = '';
  });
});
