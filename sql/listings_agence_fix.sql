-- ==========================================================
-- COLIGO — Correctif : « Historique des listings » vide (espace agent)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être relancé sans risque.
--
-- Cause possible : l'historique de l'agent cherche les listings dont la
-- colonne « agence » est exactement celle de l'agent. Si un listing a été
-- créé avec une ancienne graphie (ex. « Agence DOUALA »), il n'apparaissait pas.
-- Le site retrouve désormais ces listings via leurs colis ; ce script
-- remet en plus la bonne graphie dans la table listings.
-- ==========================================================

update listings set agence = 'Yaoundé' where agence ilike '%yaound%' and agence <> 'Yaoundé';
update listings set agence = 'Douala'  where agence ilike '%douala%' and agence <> 'Douala';

-- Vérification : listings existants par agence (les listings dont tous les colis
-- sont « Retiré » sont supprimés automatiquement, c'est normal qu'ils n'y soient plus).
select agence, count(*) from listings group by agence order by agence;
