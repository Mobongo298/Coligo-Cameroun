-- ==========================================================
-- COLIGO — nettoyage des comptes agents créés avant que
-- le champ "Agence" de signup.html devienne un menu fixe
-- (certains comptes ont une agence en texte libre, ex : "Agence YAOUNDE"
-- au lieu de "Yaoundé" exactement — ce qui bloque l'enregistrement
-- des colis avec le message "Votre compte n'a pas d'agence reconnue").
-- ==========================================================
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run.
-- Sans danger : ne touche que les lignes dont l'agence contient déjà
-- "yaound" ou "douala" (quelle que soit la casse/l'orthographe autour).
-- ==========================================================

update agents set agence = 'Yaoundé' where agence ilike '%yaound%' and agence <> 'Yaoundé';
update agents set agence = 'Douala'  where agence ilike '%douala%' and agence <> 'Douala';

-- Les colis déjà enregistrés par ces comptes portent la même agence en
-- texte libre : on les corrige aussi (sinon ils resteront mal classés
-- dans les vues Agences/Rapports de l'espace admin).
update colis set agence = 'Yaoundé' where agence ilike '%yaound%' and agence <> 'Yaoundé';
update colis set agence = 'Douala'  where agence ilike '%douala%' and agence <> 'Douala';

-- Vérification : la colonne agence ne doit plus contenir que ces 2 valeurs.
select agence, count(*) from agents group by agence order by agence;
select agence, count(*) from colis group by agence order by agence;
