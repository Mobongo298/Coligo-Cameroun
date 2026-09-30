-- ==========================================================
-- COLIGO — Espace Retraits
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- N'efface aucune donnée existante.
-- ==========================================================

create table if not exists retraits (
  id bigint generated always as identity primary key,
  colis_id bigint not null references colis(id) on delete cascade,

  -- Rempli si c'est le destinataire lui-même qui vient retirer le colis.
  destinataire_cni text,

  -- Rempli si une autre personne (mandataire) vient retirer à sa place.
  mandataire_nom text,
  mandataire_telephone text,
  mandataire_cni text,

  agent text,        -- identifiant de l'agent qui a traité le retrait
  agence text,        -- agence où le retrait a eu lieu
  created_at timestamptz default now()
);

create index if not exists retraits_colis_id_idx on retraits (colis_id);
