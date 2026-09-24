-- ==========================================================
-- COLIGO — Listings (regroupements de colis)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
--
-- Un "listing" est une feuille A4 imprimée regroupant plusieurs colis
-- (bouteilles de gaz, ou gros envois enregistrés le même jour), remise
-- au chauffeur du bus. À l'arrivée, l'agent de destination saisit le
-- numéro du listing dans l'espace Retraits pour faire passer tous les
-- colis du groupe à "Disponible" en une seule fois.
-- ==========================================================

create table if not exists listings (
  id bigint generated always as identity primary key,
  numero_listing text unique not null,
  agence text not null,        -- agence qui a imprimé (agence d'origine)
  type text not null,          -- 'bg' (bouteilles de gaz) ou 'bulk' (gros envois)
  agent text,                  -- identifiant de l'agent qui a imprimé
  created_at timestamptz default now()
);

alter table colis add column if not exists listing_id bigint references listings(id);

create index if not exists colis_listing_id_idx on colis (listing_id);
