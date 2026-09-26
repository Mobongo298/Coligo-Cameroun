-- ==========================================================
-- COLIGO — Suppression automatique des listings terminés
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être relancé sans risque.
--
-- Règle : dès que TOUS les colis d'un listing sont au statut « Retiré »
-- (ou l'ancien statut « Livré »), le listing est supprimé automatiquement
-- et définitivement de la table listings.
--
-- Ce qui se passe au moment de la suppression :
--   - les colis restent dans la base (avec leur historique et leur fiche
--     de retrait) ; seul leur lien vers le listing (listing_id) est vidé ;
--   - le listing disparaît de « Historique des listings » (espace agent),
--     de « Historique des listings reçus » (espace Retraits) et de
--     « Historique des actions sur listing » (admin : ses actions passent
--     dans le groupe « Sans listing ») ;
--   - un listing supprimé ne peut plus être réimprimé ni restauré.
--
-- Un listing vide (aucun colis) n'est jamais supprimé par ce script.
-- ==========================================================

-- 1. Fonction : supprime un listing si tous ses colis sont retirés
create or replace function listing_supprimer_si_termine(p_listing_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_listing_id is null then return false; end if;

  -- Au moins un colis, et aucun colis encore en cours.
  if not exists (select 1 from colis where listing_id = p_listing_id) then return false; end if;
  if exists (select 1 from colis where listing_id = p_listing_id
             and coalesce(statut, '') not in ('Retiré', 'Livré')) then
    return false;
  end if;

  update colis set listing_id = null where listing_id = p_listing_id;
  delete from listings where id = p_listing_id;
  return true;
end;
$$;
revoke all on function listing_supprimer_si_termine(bigint) from public, anon, authenticated;

-- 2. Déclencheur : vérifié à chaque changement de statut d'un colis
create or replace function _colis_listing_termine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_id is not null
     and new.statut in ('Retiré', 'Livré')
     and new.statut is distinct from old.statut then
    perform listing_supprimer_si_termine(new.listing_id);
  end if;
  return new;
end;
$$;

drop trigger if exists colis_listing_termine on colis;
create trigger colis_listing_termine
  after update of statut on colis
  for each row execute function _colis_listing_termine();

-- 3. Rattrapage : supprime tout de suite les listings déjà terminés
do $$
declare r record; n int := 0;
begin
  for r in
    select l.id from listings l
    where exists (select 1 from colis c where c.listing_id = l.id)
      and not exists (select 1 from colis c where c.listing_id = l.id
                      and coalesce(c.statut, '') not in ('Retiré', 'Livré'))
  loop
    if listing_supprimer_si_termine(r.id) then n := n + 1; end if;
  end loop;
  raise notice 'Listings terminés supprimés : %', n;
end $$;

-- 4. Vérification : doit renvoyer 0 ligne
select l.id, l.numero_listing
from listings l
where exists (select 1 from colis c where c.listing_id = l.id)
  and not exists (select 1 from colis c where c.listing_id = l.id
                  and coalesce(c.statut, '') not in ('Retiré', 'Livré'));
