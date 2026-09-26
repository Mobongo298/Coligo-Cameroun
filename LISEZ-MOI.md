# COLIGO — guide de mise en ligne (sans terminal, sans installation)

Ce projet fonctionne avec de simples fichiers HTML. Il n'y a rien à installer sur votre ordinateur. Vous ferez tout depuis votre navigateur.

Il y a 3 étapes : **la base de données**, **la connexion du site à la base de données**, **la mise en ligne**.

---

## Design

Toute l'application partage désormais une seule charte, définie dans **`css/theme.css`**.
Le logo COLIGO est dans `assets/` : `logo-coligo.png` (fond transparent, pour les fonds clairs) et
`logo-coligo-blanc.png` (version blanche, pour les fonds sombres). Il apparaît sur toutes les pages,
sur les reçus et sur les listings imprimés. Si vous changez de charte un jour, modifiez les variables en haut de ce fichier : les
cinq pages suivent automatiquement.

- **Le bleu, c'est l'interface** (boutons, liens, rail de navigation) et rien d'autre.
- **Les couleurs de statut veulent dire quelque chose** : Enregistré (ardoise, rien à
  faire) → En transit (cyan, ça bouge) → Disponible (ambre, il faut agir) → Retiré
  (vert, dossier clos).
- **Tableaux sans défilement horizontal** : un tableau reste un tableau et toutes ses colonnes sont
  visibles en même temps. Il s'ajuste tout seul à la largeur de l'écran (`js/ui-helpers.js`) : tel
  quel s'il tient, sinon texte resserré avec retours à la ligne, et, en dernier recours sur un petit
  téléphone, réduit pour tenir en largeur (on peut le zoomer avec deux doigts). Cela vaut aussi pour les tableaux que vous ajouterez.
- **Même châssis partout** : rail sombre à gauche, zone de travail claire à droite,
  identique dans l'espace agent, les retraits et l'administration.
- **Fond photo** : une photo nette, sans flou ni voile (pirogues au coucher du soleil à
  Douala, Unsplash). Le texte ne repose jamais directement dessus : il est posé sur une
  carte blanche ou sur une « plaque » claire, donc lisible quelle que soit la photo. La photo
  se charge depuis internet ; sans connexion, un dégradé bleu de la marque la remplace.
  Pour changer de photo : `css/theme.css`, ligne `--fond-photo` (une URL, ou un fichier posé
  dans `assets/`, par exemple `url('assets/fond.jpg')`).
- **Typographie** : Archivo pour les titres et les chiffres, Inter pour le texte. Les
  numéros de suivi et les montants utilisent des chiffres de largeur fixe, pour
  s'aligner proprement en colonne dans les tableaux.

---

## Étape 1 — Créer la base de données (Supabase, gratuit)

1. Allez sur **https://supabase.com** et créez un compte (avec Google ou un e-mail).
2. Cliquez sur **New project**. Donnez-lui un nom, par exemple `coligo`, et un mot de passe de base de données (notez-le de côté, vous n'en aurez normalement plus besoin).
3. Attendez 1 à 2 minutes que le projet soit prêt.
4. Dans le menu de gauche, cliquez sur **SQL Editor**, puis **New query**.
5. Ouvrez le fichier `sql/schema.sql` fourni dans ce dossier, copiez tout son contenu, collez-le dans la zone de Supabase, puis cliquez sur **Run**.
   → Cela crée automatiquement les tables `colis`, `colis_historique` et `agents`, avec un agent de démonstration (`agent` / `1234`) et un colis d'exemple.
   → Si vous aviez déjà exécuté une version précédente de ce script, relancez-le simplement : il met à jour la base sans effacer vos colis existants (ajout des rôles, de la limite de 10 administrateurs, etc.).

---

## Étape 2 — Connecter le site à votre base de données

1. Toujours dans Supabase, allez dans **Settings** (icône en bas à gauche) puis **API**.
2. Vous verrez deux informations :
   - **Project URL**
   - **anon public** (une longue clé)
3. Ouvrez le fichier `js/config.js` fourni dans ce dossier (clic droit > Ouvrir avec > Bloc-notes, ou tout éditeur de texte).
4. Remplacez :
   - `COLLEZ_ICI_VOTRE_PROJECT_URL` par votre Project URL
   - `COLLEZ_ICI_VOTRE_CLE_ANON_PUBLIC` par votre clé anon public
   - `CHANGEZ-CE-CODE-SECRET` par un code que vous inventez (par exemple `COLIGO-2026-ACCES`). Ce code sera à donner uniquement à vos agents et responsables : sans lui, personne ne peut créer de compte.
5. Enregistrez le fichier.

---

## Étape 3 — Mettre le site en ligne (gratuit, sans terminal)

La méthode la plus simple, **Netlify Drop** :
1. Allez sur **https://app.netlify.com/drop**
2. Faites glisser **tout le dossier `coligo`** (celui qui contient `index.html`, `agent.html`, `css`, `js`) directement dans la page.
3. En quelques secondes, Netlify vous donne une adresse du type `https://votre-site.netlify.app`.
4. C'est cette adresse que vous partagez avec vos clients et vos agents. Elle fonctionne depuis un téléphone comme depuis un ordinateur, sans rien installer.

Vous pouvez revenir sur cette même page à tout moment pour glisser une nouvelle version du dossier si vous modifiez quelque chose.

---

## Comment utiliser l'application

- **Vos clients** ne reçoivent qu'un seul lien : celui de la page d'accueil (`index.html`, l'adresse Netlify elle-même, ex. `https://votre-site.netlify.app`). Cette page ne contient aucun lien vers l'espace agent ou vers la création de compte — un client ne peut pas y accéder par un simple clic.
- **Vous (ou vos agents/responsables)** créez vos comptes vous-mêmes sur `agent.html` → « Créer un compte », en connaissant le **code d'invitation** que vous avez défini à l'étape 2. C'est la première chose à faire : il n'y a plus de compte de démonstration, vous créez directement votre propre compte réel.
  - **Agent** : enregistre des colis et suit leur statut. En tapant le montant payé, la **valeur du colis se calcule automatiquement** (10 fois le montant payé — exemple : 1000 FCFA payés → valeur déclarée de 10 000 FCFA). Chaque colis créé et chaque changement de statut est enregistré au nom de son propre compte (identifiant).
  - **Responsable / administrateur** : accède en plus à un onglet **Statistiques** qui affiche en temps réel le nombre total de colis, la valeur totale déclarée, le montant total encaissé, la répartition par statut, par agence et par agent, ainsi que l'historique récent de toutes les opérations. Maximum 10 comptes administrateur pour tout le système.

## Garder l'espace agent hors de portée des clients

- Ne partagez **jamais** l'adresse de `agent.html` ou `signup.html` avec vos clients — seulement avec vos agents et responsables, en privé (SMS, WhatsApp, etc.).
- Le **code d'invitation** dans `js/config.js` est votre deuxième barrière : même si quelqu'un devine l'adresse de `signup.html`, il ne peut pas créer de compte sans ce code. Choisissez un code que vous seul(e) et votre équipe connaissez, et changez-le si vous pensez qu'il a fuité.
- Ces deux pages restent techniquement accessibles à qui tape l'adresse exacte (c'est une limite des sites sans serveur), mais sans le code d'invitation, la création de compte est bloquée, et sans compte, rien n'est consultable sur `agent.html`.

## Activer la mise à jour en temps réel des statistiques

Le script `sql/schema.sql` active déjà la réplication temps réel pour les tables `colis` et `colis_historique`. Si l'onglet Statistiques ne se met pas à jour automatiquement, vérifiez dans Supabase : **Database > Replication**, et assurez-vous que les tables `colis` et `colis_historique` sont bien cochées dans la publication `supabase_realtime`.

## Étape 1bis — Activer le code d'invitation à usage unique

1. Toujours dans **SQL Editor > New query**.
2. Ouvrez le fichier `sql/invite_code_migration.sql` fourni dans ce dossier, copiez tout son contenu, collez-le dans Supabase, puis cliquez sur **Run**.
   → Cela crée un système où le code d'invitation change automatiquement après chaque inscription (agent ou responsable), et où seul le tableau de bord administrateur peut afficher le code actuel.
3. Le code de départ est `2010` (celui que vous utilisiez déjà). Vous pouvez le changer à tout moment depuis Supabase : **Table Editor > invite_settings**, modifiez la colonne `code`.

## Étape 1ter — Activer la messagerie interne

1. Toujours dans **SQL Editor > New query**.
2. Ouvrez `sql/messagerie_migration.sql`, copiez tout son contenu, collez-le dans Supabase, puis **Run**.
   → Cela crée la table `messages` et active sa diffusion en temps réel, ainsi que celle de la table
   `agents` (nécessaire pour que le code d'invitation se rafraîchisse tout seul sur le tableau de bord
   admin dès qu'un nouvel agent s'inscrit).
3. Sans cette étape, les boîtes de réception (agent, retraits, admin) resteront visibles mais vides,
   et l'envoi de messages échouera.
4. Ensuite, exécutez de la même façon `sql/messagerie_conservation_migration.sql`.
   → Les messages ne peuvent plus être effacés depuis le site. Quand quelqu'un clique sur **Supprimer**,
   le message disparaît seulement de **sa** boîte de réception ; l'expéditeur et les autres destinataires
   le conservent. Tant que cette étape n'est pas faite, « Supprimer » ne masque le message que dans le
   navigateur utilisé.
5. **Bip sonore** : à l'arrivée d'un nouveau message, un seul bip court est joué. Les navigateurs
   n'autorisent le son qu'après un premier clic ou toucher sur la page (par exemple le clic de connexion) :
   si la page vient d'être rechargée, un clic n'importe où suffit à l'activer.

## Étape 1quater — Activer « Mot de passe oublié ? » (gratuit, par e-mail)

1. Toujours dans **SQL Editor > New query**.
2. Ouvrez `sql/reset_password_migration.sql`, copiez tout son contenu, collez-le dans Supabase, puis **Run**.
   → Cela ajoute une colonne `email` aux comptes, et permet à chacun (admin, agent, retrait) de
   recevoir un code à 6 chiffres par e-mail depuis l'écran de connexion, pour choisir un nouveau
   mot de passe sans intervention d'un administrateur.
3. Pour que les e-mails partent réellement (sinon le code est bien créé mais reste dans la base,
   invisible pour l'agent) :
   - Créez un compte gratuit sur **https://resend.com** (jusqu'à 3000 e-mails/mois offerts).
   - Copiez votre clé API (commence par `re_`).
   - Dans Supabase, **SQL Editor > New query**, lancez (avec votre propre clé) :
     ```sql
     update email_settings set resend_api_key = 're_VOTRE_CLE_ICI' where id = 1;
     ```
4. Les comptes créés **avant** cette étape n'ont pas d'e-mail. Depuis le tableau de bord
   administrateur, onglet **Agents**, un bouton **« Ajouter un e-mail »** apparaît sur chaque
   compte qui n'en a pas encore — un clic suffit pour le renseigner. Les comptes créés depuis
   `signup.html` après cette étape ont désormais un champ e-mail obligatoire, rempli dès l'inscription.

---

## Étape 1quinquies — Sécuriser les mots de passe (à faire, une seule fois)

1. Toujours dans **SQL Editor > New query**.
2. Ouvrez `sql/securite_mots_de_passe_migration.sql`, copiez tout, collez, **Run**.
   → Tous les mots de passe existants sont automatiquement convertis en mots de passe
   hachés (bcrypt) — personne n'a besoin de changer le sien. À partir de maintenant,
   la connexion, l'inscription, le changement de mot de passe et « mot de passe
   oublié » passent tous par des fonctions côté base de données : **le mot de passe
   ne transite plus jamais en clair entre le site et la base**, et il n'est plus
   comparé depuis le navigateur.
   → Bonus inclus : après **5 tentatives de connexion échouées** sur un même
   identifiant, le compte est verrouillé 15 minutes.
3. Peut être exécuté avant ou après `sql/reset_password_migration.sql`, l'ordre n'a
   pas d'importance.

## Étape 1sexies — Annulation de « Conservation des données »

Le module « Conservation des données » (cycle de vie : règles, journal, liste des retraits, colis
non réclamés, archivage statistique) a été **retiré** de l'application.

1. **Si vous aviez exécuté** `cycle_de_vie_donnees_migration.sql` ou `liste_retraits_migration.sql`
   (ou si vous n'êtes pas sûr) : **SQL Editor > New query**, ouvrez
   `sql/annulation_conservation_donnees.sql`, copiez tout, collez, **Run**. Le script peut être lancé
   même si ces migrations n'ont jamais été faites. Il se termine par une vérification qui doit
   renvoyer 0 ligne.
2. Le fonctionnement d'origine revient : les colis retirés depuis plus d'un an sont supprimés
   automatiquement à l'ouverture de l'espace Retraits (`sql/nettoyage_retraits_1an.sql`, déjà inclus
   dans le script d'annulation).
3. Ce qui a déjà été supprimé ou masqué par le cycle de vie ne peut pas être restauré par ce script
   (seule une sauvegarde Supabase le permet). La table `stats_archive` n'est effacée que si elle est
   vide, pour ne pas fausser les Rapports.

## Étape 1septies — Modification des colis, désactivation des agents et Rapports

1. **SQL Editor > New query**.
2. Ouvrez `sql/agents_desactivation_modification_migration.sql`, copiez tout, collez, **Run**.
   → Si vous l'aviez déjà exécuté, **relancez-le** : il ne dépend plus du cycle de vie. Puis lancez
   `sql/annulation_conservation_donnees.sql` (étape 1sexies), qui ajoute la suppression des comptes
   désactivés depuis 30 jours.
3. Ce que cela apporte :
   - **Espace agent** : en cliquant sur un colis, un bouton **Modifier** apparaît entre Fermer et
     Imprimer le reçu. Il est disponible tant que le colis est « Enregistré » et n'est pas encore sur
     un listing. Numéro de suivi, trajet et date ne changent pas ; chaque correction est gardée
     (avant / après) et visible par l'admin sur la fiche du colis. Pensez à réimprimer le reçu.
   - **Admin > Agents** : bouton **Désactiver** (motif + mot de passe administrateur). La connexion
     est bloquée tout de suite (une session ouverte est coupée en moins de 2 minutes). Bouton
     **Réactiver** possible pendant 30 jours ; ensuite le compte est supprimé définitivement de la
     table `agents`, mais ses colis, son historique, ses retraits et ses messages restent, et une
     fiche résumée (sans mot de passe) est gardée dans `agents_archives`. L'identifiant ne peut plus
     être réutilisé.
   - **Admin > Rapports** : tableau de bord avec 4 indicateurs, graphique Douala / Yaoundé par mois,
     filtre de dates et export **PDF**. Ces fonctions utilisent des bibliothèques en
     ligne (Chart.js, jsPDF) : une connexion internet est nécessaire, comme pour Supabase.

## Étape 1octies — Messages de confirmation

Aucun script à exécuter.
- Tous les **messages de confirmation** s'affichent sur fond vert citron et disparaissent en fondu
  après 2 secondes. Les messages d'erreur, eux, restent affichés.
- Le menu « Historique des actions » s'appelle désormais **Historique des actions sur listing**.

## Étape 1nonies — Messagerie, codes de récupération, listings, suivi client

1. **SQL Editor > New query** : ouvrez `sql/messagerie_codes_suivi_migration.sql`, copiez tout,
   collez, **Run**. → À faire **après** l'étape 1sexies. Peut être relancé sans risque.
2. Ce que cela apporte :
   - **Messagerie** : l'expéditeur comme le destinataire peuvent supprimer un message (icône corbeille)
     ou vider toute la conversation (bouton **Vider**), chacun dans sa propre messagerie, quand il le veut.
     L'autre personne garde sa copie. Quand les deux l'ont supprimé, le message est effacé
     définitivement de la base.
   - **Codes « mot de passe oublié »** : un code est effacé de la base dès qu'il a servi. Les anciens
     codes sont effacés à chaque nouvelle demande, un code expiré est effacé, et 5 codes faux d'affilée
     annulent le code. Les codes déjà présents dans la base sont nettoyés par le script.
   - **Listings** : un clic sur un listing (espace agent, espace Retraits, et « Historique des actions sur
     listing » côté admin) ouvre sa fiche avec **tous les colis enregistrés** dessus, les totaux, une
     recherche et le bouton **Réimprimer**.
   - **Suivi client (page d'accueil)** : le reçu est en consultation seule, le client ne peut pas
     l'imprimer. Pour un colis déjà **retiré**, le reçu n'est plus affiché : seul un message apparaît avec
     les informations du retrait (remis au destinataire ou au mandataire, date, agence, agent ayant fait
     l'opération). Aucun numéro de CNI ni de téléphone n'est montré.
3. Redéployez le dossier sur Netlify.

## Étape 1decies — Montant masqué, Rapports et suppression automatique des listings

1. **Montant total encaissé (admin)** : il est masqué par défaut (••••••• FCFA). Cliquez sur
   l'œil, puis saisissez votre mot de passe administrateur pour l'afficher. Il se masque de
   nouveau tout seul après 2 minutes, au rechargement de la page et à la déconnexion.
   Après 5 mots de passe erronés, le compte est temporairement bloqué (même règle que la
   connexion). Aucun script SQL n'est nécessaire.
2. **Rapports** : le bouton « Exporter en Excel » a été retiré ; l'export PDF est conservé.
3. **Suppression automatique des listings** : faites d'abord une sauvegarde, puis exécutez
   une fois `sql/listings_suppression_auto_migration.sql` (SQL Editor > New query > Run).
   Dès que tous les colis d'un listing sont « Retiré », le listing est supprimé
   définitivement. Le script supprime aussi tout de suite les listings déjà terminés.
   Les colis, leur historique et leurs retraits sont conservés ; dans « Historique des
   actions sur listing », leurs actions apparaissent dans le groupe « Sans listing ».
   Un listing supprimé ne peut plus être réimprimé ni restauré.
4. Les textes de la plateforme ont été relus (orthographe, accords, guillemets).

## Étape 1undecies — Espace agent : colis enregistrés et météo

1. Le menu « Mes colis et suivi » s'appelle désormais **« Colis enregistrés depuis votre
   agence »**. La liste est classée par date d'enregistrement (plus récents d'abord, ou plus
   anciens d'abord via le sélecteur). Un clic sur un colis affiche son statut (barre
   d'avancement), ses informations, puis son reçu, avec les boutons « Imprimer le reçu »,
   « Modifier » (si le colis est encore « Enregistré ») et « Fermer » pour revenir à la liste.
2. **Tableau de bord** : la carte « Aperçu du jour » est agrandie (agence, date et heure en
   grand). Juste à côté, une carte **Météo au Cameroun** affiche la ville de l'agence
   (température en °C, ressenti, min/max, humidité, vent, risque de pluie) et 9 autres
   grandes villes, avec une icône (soleil, nuages, pluie, orage…). Les données viennent
   d'Open-Meteo (gratuit, sans clé) et se mettent à jour toutes les 10 minutes.
   Aucun script SQL n'est nécessaire.

## Étape 1duodecies — Correctif messagerie agent et météo animée

1. **Messagerie de l'agent** : elle ne s'affichait plus, à cause d'une balise `</div>` en trop
   dans la vue « Historique des listings » (agent.html). Cette balise fermait la page trop tôt :
   la section Messagerie se retrouvait en dehors de la zone d'affichage. Elle est supprimée et la
   structure des pages a été revérifiée.
2. **Tableau de bord** : les cartes « Aperçu du jour » et « Météo » sont plus compactes. La carte
   météo a un fond animé qui suit le temps actuel de la ville de l'agence : soleil et rayons,
   nuages qui défilent, pluie qui tombe, orage avec éclairs, nuit étoilée avec lune, brouillard.
   La couleur du texte s'adapte au fond (texte blanc sur les fonds sombres, texte foncé sur le
   brouillard) et un voile assure la lisibilité. Les villes défilent horizontalement.
   Les animations sont coupées si l'appareil demande de réduire les animations.

## Impression du reçu

Le reçu est imprimé en double (exemplaire client + exemplaire agence) sur **une seule page (1/1)**,
les deux exemplaires l'un sous l'autre, séparés par la ligne de coupe. Le format du reçu (80 mm)
ne change pas. Aucun script SQL à exécuter.

## Important à savoir sur la sécurité

Les mots de passe sont maintenant hachés et jamais comparés depuis le navigateur — la
faille la plus critique est corrigée. Il reste une limite structurelle à connaître :
ce système utilise sa propre table `agents` pour l'authentification plutôt que le
système de comptes intégré de Supabase (Supabase Auth). Concrètement, cela veut dire
qu'un visiteur qui interrogerait directement votre base avec des outils avancés (en
dehors du site) pourrait, selon la configuration exacte des règles d'accès (RLS) de
chaque table, potentiellement lire ou modifier des données sans passer par les écrans
de connexion — même s'il ne pourra plus jamais lire ni deviner un mot de passe, ni se
connecter comme un compte existant. Cela convient pour démarrer avec une petite équipe
de confiance. Si votre activité grandit, ou avant de vendre/déployer cette plateforme
chez un client, il est recommandé de migrer vers une vraie authentification Supabase
(un compte = une vraie session sécurisée, avec des règles RLS vérifiables automatiquement
par table). Dites-le-moi quand vous serez prêt pour cette étape, on la fera ensemble.

## Si quelque chose ne fonctionne pas

- Rien ne s'affiche / erreur de connexion → vérifiez que `js/config.js` contient bien votre Project URL et votre clé, sans espace ni guillemet en trop.
- « Aucun colis ne correspond » → vérifiez que le numéro a bien été créé côté agent, et qu'il est tapé sans espace.
- Le site Netlify affiche une page blanche → vérifiez que vous avez glissé le dossier complet (avec `css` et `js` à l'intérieur), pas seulement `index.html`.
