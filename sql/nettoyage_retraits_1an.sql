-- ==========================================================
-- COLIGO — OBSOLÈTE : ne plus exécuter ce fichier
-- ==========================================================
-- L'ancien nettoyage « colis retirés supprimés après 1 an » est remplacé par
-- sql/cycle_de_vie_donnees_migration.sql, qui fait la même chose en mieux :
--   - archive les chiffres (montant, valeur) AVANT de supprimer, pour que
--     les rapports restent justes ;
--   - anonymise les CNI et téléphones dès 90 jours ;
--   - nettoie aussi messages, codes, listings vides, présence ;
--   - durées réglables depuis Admin.html, journal de chaque passage.
--
-- La fonction nettoyer_retraits_expires() existe toujours (même nom), mais
-- elle déclenche maintenant le nouveau cycle complet. Relancer l'ancienne
-- version de ce fichier l'aurait écrasée : il a donc été vidé volontairement.
-- ==========================================================

select 'Fichier obsolète : exécutez sql/cycle_de_vie_donnees_migration.sql' as information;
