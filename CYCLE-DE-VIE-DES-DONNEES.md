# COLIGO — Cycle de vie des données : analyse et recommandations

## 1. Constat sur la version précédente

| Donnée | Avant | Problème |
|---|---|---|
| Colis retirés | Supprimés après 1 an (colis + historique + retrait) | Les **Rapports** et le **montant total** baissaient à chaque suppression : les chiffres disparaissaient avec le colis. |
| Fiches de retrait (CNI, téléphone du mandataire) | Conservées en clair pendant 1 an | Données d'identité gardées plus longtemps que nécessaire. |
| Colis « Disponible » jamais retirés | Conservés à vie, comptés « en retard » à vie | Aucun suivi, aucune sortie possible. |
| Messages | Jamais supprimés | La table grossit sans fin. |
| Codes « mot de passe oublié » | Jamais supprimés | Accumulation de lignes inutiles. |
| Compteurs de connexion ratée | Jamais remis à zéro | Idem. |
| Présence « en ligne » | Reste « en ligne » si le navigateur est fermé brutalement | Faux statut dans le menu Agents. |
| Listings vidés | Jamais supprimés | Idem. |
| Suppression depuis le site | Possible directement sur `colis`, `colis_historique`, `listings` avec la clé publique | N'importe qui connaissant l'adresse Supabase pouvait effacer des colis. |
| Nettoyage | Déclenché uniquement à l'ouverture de `retrait.html`, sans trace | Aucun journal, aucune règle réglable, aucun contrôle admin. |

## 2. Le cycle fermé mis en place

```
Enregistré → En transit → Disponible → Retiré                 (vie active : rien n'est supprimé)
                               │          │
                               │          ├─ J+90  : CNI et téléphones masqués (***123)
                               │          └─ J+365 : chiffres versés dans stats_archive,
                               │                     puis colis + historique + retrait supprimés
                               │
                               ├─ J+30 : signalé « non réclamé » à l'admin
                               └─ J+90 : suppression MANUELLE possible (motif obligatoire)
```

Chaque donnée a une entrée, une durée de vie et une sortie, et chaque sortie laisse une trace dans le journal.

| Catégorie | Durée par défaut | Minimum imposé | Mode |
|---|---|---|---|
| Anonymisation des retraits | 90 jours | 30 jours | Auto + manuel |
| Colis retirés (dossiers clos) | 365 jours | 90 jours | Auto + manuel (+ suppression unitaire depuis la fiche) |
| Colis non réclamés : signalement | 30 jours | 7 jours | Information |
| Colis non réclamés : suppression | 90 jours | 60 jours | **Manuel uniquement** |
| Listings vides | 30 jours | 7 jours | Auto + manuel |
| Messages | 180 jours | 30 jours | Auto + manuel |
| Codes et compteurs de connexion | 24 heures | 1 heure | Auto + manuel |
| Présence « en ligne » bloquée | 12 heures | 2 heures | Auto + manuel |
| Journal des nettoyages | 2 ans | 180 jours | Auto + manuel |

## 3. Garde-fous

- **Mot de passe administrateur** redemandé pour tout nettoyage manuel, toute suppression de colis et toute modification des règles (vérifié dans la base, pas dans le navigateur).
- **Minimums** imposés par la base : une faute de frappe (ex. « 1 jour ») ne peut pas tout effacer.
- **Jamais de suppression automatique** d'un colis Enregistré, En transit ou Disponible.
- **Archivage avant suppression** : `stats_archive` garde, par agence et par mois, le nombre de colis, le montant encaissé et la valeur déclarée. Aucune donnée personnelle n'y figure.
- **Journal** (`purge_journal`) : date, type (automatique, planifié, manuel, colis), auteur, détail, et motif pour une suppression unitaire.
- **Cycle fermé côté base** : le site ne peut plus supprimer directement de colis, d'historique ou de listing avec la clé publique. Toute suppression passe par les fonctions du cycle de vie.
- **Anti double passage** : le nettoyage automatique ne s'exécute qu'une fois toutes les 20 heures, même si 10 agents ouvrent le site en même temps.

## 4. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `sql/cycle_de_vie_donnees_migration.sql` | **Nouveau.** Tables `retention_settings`, `stats_archive`, `purge_journal`, et fonctions du cycle de vie. |
| `sql/nettoyage_retraits_1an.sql` | Rendu obsolète (vidé pour éviter d'écraser la nouvelle logique). |
| `js/cycle-vie.js` | **Nouveau.** Écran « Conservation des données » de l'admin. |
| `Admin.html` | Nouveau menu et nouvelle vue « Conservation des données ». |
| `js/admin.js` | Rapports et montant total incluant les archives, bouton « Supprimer ce dossier clos » sur la fiche d'un colis retiré, passage automatique à l'ouverture. |
| `js/agent.js`, `js/retrait.js` | Passage automatique du cycle à l'ouverture (avec repli sur l'ancienne fonction). |
| `js/client.js` | Message plus clair quand un ancien colis n'est plus consultable. |
| `css/admin.css` | Styles de la nouvelle vue. |
| `LISEZ-MOI.md` | Nouvelle étape « 1sexies » et lien Netlify corrigé. |

## 5. Ordre de mise en place conseillé

1. Faire une **sauvegarde** : Supabase > Database > Backups (ou exporter les tables en CSV).
2. Exécuter `sql/cycle_de_vie_donnees_migration.sql`. Il se termine par un **aperçu** qui ne supprime rien.
3. Ouvrir Admin.html > Conservation des données, vérifier les chiffres « éligibles maintenant ».
4. Si les durées vous conviennent, laisser le nettoyage automatique activé ; sinon, les ajuster d'abord.
5. (Conseillé) Activer `pg_cron` pour un passage chaque nuit à 3 h (heure du Cameroun).
6. Redéployer le dossier sur Netlify.

## 6. Recommandations complémentaires (non appliquées)

1. **Fichier `sql/schema.sql` manquant** : le guide y fait référence mais il n'est pas dans le dossier. Pour une nouvelle installation, il faut le reconstituer (tables `colis`, `colis_historique`, `agents`).
2. **Durée légale** : vérifiez avec votre comptable la durée de conservation exigée pour les pièces commerciales (au Cameroun comme dans l'espace OHADA, elle est souvent de 10 ans pour les documents comptables). Si c'est le cas, gardez plutôt une trace comptable (reçus, totaux) hors de l'application, ou exportez les dossiers avant suppression. Les totaux de `stats_archive` ne remplacent pas une comptabilité.
3. **Export avant suppression** : ajouter plus tard un bouton « Exporter en CSV » des dossiers qui vont être supprimés.
4. **Comptes agents inactifs** : ne pas les supprimer (l'historique y fait référence par identifiant), mais ajouter un statut « désactivé » qui bloque la connexion.
5. **Colis « en retard »** : l'indicateur compte aussi les colis Disponible qui attendent leur destinataire. Il serait plus juste de ne compter que Enregistré et En transit, les Disponible étant suivis dans « non réclamés ».
6. **Sécurité de fond** : l'application utilise toujours la clé publique (`anon`) pour tout. La migration vers Supabase Auth, avec des règles RLS par rôle, reste l'étape la plus importante avant une montée en charge ou une revente.
7. **Cache des 2000 derniers colis** : au-delà, le tableau de bord devient approximatif. Le cycle de vie limite ce volume, mais un calcul des totaux côté base serait plus fiable à terme.
