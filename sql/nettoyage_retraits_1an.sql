-- ==========================================================
-- COLIGO — conservation 1 an des colis retirés
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Nécessite que sql/retraits_migration.sql ait déjà été exécuté.
--
-- Un colis retiré reste visible dans l'historique des retraits pendant
-- 1 an à partir de la date du retrait, puis est supprimé définitivement
-- (colis + son historique de statuts + sa fiche de retrait).
-- ==========================================================

create or replace function nettoyer_retraits_expires()
returns void
language plpgsql
security definer
as $$
declare
  seuil timestamptz := now() - interval '1 year';
begin
  -- Historique des statuts des colis concernés.
  delete from colis_historique
  where colis_id in (select colis_id from retraits where created_at < seuil);

  -- Le colis lui-même (supprime aussi sa fiche de retrait si votre
  -- contrainte "on delete cascade" est active — sinon la ligne suivante
  -- s'en charge de toute façon).
  delete from colis
  where id in (select colis_id from retraits where created_at < seuil);

  -- Sécurité : au cas où la fiche de retrait n'aurait pas été supprimée
  -- automatiquement ci-dessus.
  delete from retraits where created_at < seuil;
end;
$$;

grant execute on function nettoyer_retraits_expires() to anon;

-- ----------------------------------------------------------
-- Cette fonction est aussi appelée automatiquement à chaque ouverture
-- de retrait.html (voir js/retrait.js), donc le nettoyage se fait tout
-- seul sans étape supplémentaire de votre part.
--
-- Optionnel : pour un nettoyage garanti même si personne n'ouvre la
-- page (agence fermée un moment), vous pouvez programmer une exécution
-- automatique quotidienne. Cela nécessite l'extension pg_cron
-- (Supabase : Database > Extensions > activer "pg_cron"), puis :
--
-- select cron.schedule(
--   'nettoyage-retraits-1an',
--   '0 3 * * *',  -- tous les jours à 3h du matin
--   'select nettoyer_retraits_expires();'
-- );
-- ----------------------------------------------------------
