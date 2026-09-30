-- ==========================================================
-- COLIGO — Correctif : impression des listings impossible
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être relancé sans risque.
--
-- Cause : le numéro d'un nouveau listing était calculé avec
-- « nombre de listings de l'agence + 1 ». Depuis que les listings
-- terminés sont supprimés automatiquement, ce nombre diminue et le
-- numéro calculé existe déjà -> erreur « duplicate key value violates
-- unique constraint listings_numero_listing_key » -> plus d'impression.
--
-- Solution : un compteur par agence qui ne redescend jamais, géré
-- côté base (atomique, sans doublon même avec plusieurs agents).
-- ==========================================================

create table if not exists listing_compteurs (
  agence text primary key,
  dernier_numero integer not null default 0
);

-- Initialisation : on part du plus grand numéro déjà utilisé par agence.
insert into listing_compteurs (agence, dernier_numero)
select l.agence,
       coalesce(max(nullif(substring(l.numero_listing from '^N°(\d+)'), '')::int), 0)
from listings l
group by l.agence
on conflict (agence) do update
  set dernier_numero = greatest(listing_compteurs.dernier_numero, excluded.dernier_numero);

-- Fonction appelée par le site : renvoie le prochain numéro libre.
create or replace function prochain_numero_listing(p_agence text, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_max integer;
begin
  -- Sécurité : ne jamais retomber sur un numéro encore présent dans listings.
  select coalesce(max(nullif(substring(numero_listing from '^N°(\d+)'), '')::int), 0)
    into v_max from listings where agence = p_agence;

  insert into listing_compteurs (agence, dernier_numero)
  values (p_agence, greatest(v_max, 0) + 1)
  on conflict (agence) do update
    set dernier_numero = greatest(listing_compteurs.dernier_numero, v_max) + 1
  returning dernier_numero into v_n;

  return 'N°' || lpad(v_n::text, 4, '0') || ' ' || p_code;
end;
$$;

grant execute on function prochain_numero_listing(text, text) to anon, authenticated;

-- La table de compteurs n'est pas accessible directement depuis le site.
alter table listing_compteurs enable row level security;

-- Vérification : doit renvoyer un numéro du type N°0005 DLA
-- select prochain_numero_listing('Douala', 'DLA');
