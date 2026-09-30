-- ==========================================================
-- COLIGO — activer le temps réel Supabase
-- ==========================================================
-- Le code de l'application s'abonne bien aux changements ("postgres_changes"),
-- mais Supabase ne diffuse RIEN pour une table tant que sa réplication temps
-- réel n'est pas explicitement activée. Sans cette étape, les abonnements se
-- connectent (le voyant peut même afficher "actif") mais ne reçoivent jamais
-- aucun événement — ce qui explique pourquoi les statuts ne semblent pas se
-- mettre à jour tout seuls dans les autres espaces ouverts.
--
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Sans danger, aucune donnée n'est modifiée.
-- ==========================================================

alter publication supabase_realtime add table colis;
alter publication supabase_realtime add table colis_historique;
alter publication supabase_realtime add table listings;
alter publication supabase_realtime add table retraits;

-- Vérification : les 4 tables doivent apparaître dans ce résultat.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
