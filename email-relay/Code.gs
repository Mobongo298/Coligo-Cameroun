// ==========================================================
// COLIGO — Relais d'e-mail Google (gratuit, sans nom de domaine)
// Envoie les codes « mot de passe oublié » depuis VOTRE Gmail,
// vers n'importe quelle adresse (limite Google : ~100 e-mails/jour).
// ----------------------------------------------------------
// INSTALLATION (5 minutes, depuis le navigateur) :
// 1. Connectez-vous au Gmail qui servira d'expéditeur (ex. coligo.noreply@gmail.com).
// 2. Allez sur https://script.google.com > « Nouveau projet ».
// 3. Supprimez le code existant, collez TOUT ce fichier.
// 4. Remplacez CODE_SECRET ci-dessous par un code inventé (long, aléatoire).
//    Notez-le : vous le collerez aussi dans Supabase (gas_secret).
// 5. Dans la liste de fonctions en haut, choisissez « autoriserEnvoi » puis
//    « Exécuter » : acceptez les autorisations Google (Avancé > Accéder au projet).
//    Un e-mail de test arrive dans votre boîte : l'envoi marche.
// 6. « Déployer » > « Nouveau déploiement » > type « Application Web » :
//      - Exécuter en tant que : Moi
//      - Qui a accès : Tout le monde
//    Cliquez « Déployer » et copiez l'URL (elle finit par /exec).
// 7. Dans Supabase (SQL Editor) :
//      update email_settings set provider='gas',
//        gas_url='URL_COPIÉE', gas_secret='VOTRE_CODE_SECRET' where id = 1;
// 8. Test :  select test_envoi_email('votre.adresse@gmail.com');
// Si vous modifiez ce script plus tard : « Déployer » > « Gérer les déploiements »
// > crayon > Version « Nouvelle version » > Déployer (l'URL ne change pas).
// ==========================================================

const CODE_SECRET = 'CHANGEZ-MOI-PAR-UN-LONG-CODE-SECRET';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.secret || d.secret !== CODE_SECRET) return sortie_({ ok: false, error: 'secret invalide' });
    if (!d.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.to)) return sortie_({ ok: false, error: 'destinataire invalide' });

    MailApp.sendEmail({
      to: d.to,
      subject: d.subject || 'COLIGO',
      htmlBody: d.html || '',
      name: 'COLIGO'
    });
    return sortie_({ ok: true });
  } catch (err) {
    return sortie_({ ok: false, error: String(err) });
  }
}

function sortie_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// À exécuter UNE FOIS à la main (étape 5) : déclenche la demande d'autorisation Google.
function autoriserEnvoi() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'COLIGO — relais prêt',
    'Les autorisations sont accordées. Vous pouvez déployer le script.');
}
