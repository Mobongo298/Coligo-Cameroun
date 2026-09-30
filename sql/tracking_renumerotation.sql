-- ==========================================================
-- COLIGO — renumérotation des colis existants
-- ==========================================================
-- Les NOUVEAUX colis sont déjà enregistrés au format :
--   DLA000001/26 (Douala)   /   YDE000001/26 (Yaoundé)
-- Ce script renumérote UNE FOIS les colis déjà présents dans la base
-- pour qu'ils suivent le même format (utile si certains ont encore
-- l'ancien numéro, ex : CM-2026-000001).
--
-- Chaque agence repart de 000001, dans l'ordre de la date d'enregistrement.
-- L'année utilisée est celle de la date d'enregistrement du colis (pas
-- l'année en cours), pour rester fidèle à l'historique.
--
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run.
-- Faites-le une seule fois : le réexécuter changerait à nouveau tous
-- les numéros et invaliderait les reçus déjà imprimés.
-- ==========================================================

create extension if not exists unaccent;

with numerotation as (
  select
    id,
    case
      when lower(unaccent(coalesce(agence, ''))) = 'douala'  then 'DLA'
      when lower(unaccent(coalesce(agence, ''))) = 'yaounde' then 'YDE'
      -- Repli pour une agence imprévue : ses 3 premières lettres (même
      -- logique que agenceCode() côté application, js/receipt.js).
      else upper(left(regexp_replace(unaccent(coalesce(agence, 'AGE')), '[^a-zA-Z]', '', 'g'), 3))
    end as code,
    to_char(created_at, 'YY') as annee,
    row_number() over (partition by agence order by created_at) as sequence
  from colis
)
update colis c
set numero_suivi = n.code || lpad(n.sequence::text, 6, '0') || '/' || n.annee
from numerotation n
where c.id = n.id;

-- Vérification : chaque numéro doit maintenant suivre le format attendu.
select numero_suivi, agence, created_at from colis order by created_at desc limit 20;
