-- ==========================================================
-- COLIGO — Conservation 1 an : colis retirés + colis enregistrés
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > Run.
-- Peut être relancé sans risque. Nécessite sql/retraits_migration.sql.
--
-- Règle unique : tout colis dont la date d'enregistrement remonte à plus
-- d'un an est supprimé définitivement, avec son historique de statuts et
-- sa fiche de retrait. Cela concerne :
--   - « Historique des colis retirés »  (espace Retraits)
--   - « Liste des colis enregistrés à l'agence de ... » (espace Retraits)
-- Les listings restés vides après ce nettoyage sont supprimés aussi.
--
-- La fonction garde le nom nettoyer_retraits_expires : le site l'appelle
-- déjà à chaque ouverture de l'espace Retraits, rien d'autre à brancher.
--
-- ATTENTION : un colis jamais retiré (non réclamé) est aussi supprimé
-- après 1 an. Pour l'épargner, ajoutez dans le « where » du 2e delete :
--   and statut in ('Retiré', 'Livré')
-- ==========================================================

create or replace function nettoyer_retraits_expires()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seuil timestamptz := now() - interval '1 year';
begin
  -- 1. Retraits de plus d'un an (date du retrait) : colis + historique + fiche.
  delete from colis_historique
  where colis_id in (select colis_id from retraits where created_at < seuil);
  delete from colis
  where id in (select colis_id from retraits where created_at < seuil);
  delete from retraits where created_at < seuil;

  -- 2. Colis enregistrés depuis plus d'un an (date d'enregistrement).
  delete from colis_historique
  where colis_id in (select id from colis where created_at < seuil);
  delete from colis where created_at < seuil;   -- les fiches de retrait partent en cascade

  -- 3. Listings devenus vides et vieux d'un an.
  delete from listings l
  where l.created_at < seuil
    and not exists (select 1 from colis c where c.listing_id = l.id);
end;
$$;

grant execute on function nettoyer_retraits_expires() to anon, authenticated;

-- Optionnel : nettoyage garanti chaque nuit même si personne n'ouvre la page
-- (Database > Extensions > activer « pg_cron », puis) :
-- select cron.schedule('nettoyage-1an-colis', '0 3 * * *', 'select nettoyer_retraits_expires();');
