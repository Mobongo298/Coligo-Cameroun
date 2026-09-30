-- ==========================================================
-- COLIGO — Historique des listings REÇUS
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > Run.
-- Peut être relancé sans risque.
--
-- Un listing n'entre dans « Historique des listings reçus » qu'une fois
-- réceptionné (saisi dans l'espace Retraits => colis « Disponible »).
-- Tant qu'il est seulement envoyé (colis « En transit »), il n'y figure pas.
-- ==========================================================

alter table listings add column if not exists recu_le timestamptz;
alter table listings add column if not exists recu_par text;

-- Rattrapage : listings déjà réceptionnés = au moins un colis passé
-- « Disponible » / « Retiré » / « Livré ».
update listings l
set recu_le = coalesce(
      (select max(c.updated_at) from colis c
        where c.listing_id = l.id and c.statut in ('Disponible', 'Retiré', 'Livré')),
      now())
where l.recu_le is null
  and exists (select 1 from colis c
               where c.listing_id = l.id and c.statut in ('Disponible', 'Retiré', 'Livré'));

-- Vérification : listings envoyés mais pas encore reçus (ne doivent plus apparaître dans l'historique des reçus)
-- select numero_listing, agence from listings where recu_le is null;
