-- ==========================================================
-- COLIGO — Messagerie : conservation des discussions
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- À lancer APRÈS sql/messagerie_migration.sql (et messagerie_admin_a_admin_migration.sql).
-- N'efface aucune donnée existante.
--
-- Ce que ça change :
--   1. Les messages ne peuvent plus être effacés ni modifiés depuis le site :
--      la table `messages` devient « en ajout seulement ».
--   2. Quand quelqu'un clique sur « Supprimer » dans sa boîte de réception,
--      le message est simplement MASQUÉ POUR LUI (une ligne dans la table
--      `messages_masques`). L'expéditeur et les autres destinataires (par
--      exemple lors d'une diffusion « tous les agents ») le conservent.
--
-- Avant cette mise à jour, « Supprimer » effaçait la ligne pour tout le monde :
-- un agent qui supprimait une diffusion la supprimait chez tous les agents.
-- ==========================================================

create table if not exists messages_masques (
  id bigint generated always as identity primary key,
  message_id bigint not null references messages(id) on delete cascade,
  utilisateur_type text not null check (utilisateur_type in ('admin', 'agent')),
  utilisateur_username text not null,
  created_at timestamptz default now(),
  unique (message_id, utilisateur_type, utilisateur_username)
);

create index if not exists messages_masques_utilisateur_idx
  on messages_masques (utilisateur_type, utilisateur_username);

-- Le site (clé « anon ») peut lire et ajouter des masquages, jamais les modifier
-- ni les supprimer.
grant select, insert on messages_masques to anon, authenticated;
alter table messages_masques enable row level security;

drop policy if exists messages_masques_lecture on messages_masques;
create policy messages_masques_lecture on messages_masques for select using (true);

drop policy if exists messages_masques_ajout on messages_masques;
create policy messages_masques_ajout on messages_masques for insert with check (true);

-- Plus aucune suppression ni modification de message depuis le site.
-- (Vous gardez la possibilité de gérer les messages depuis Supabase : Table Editor.)
revoke delete, update, truncate on messages from anon, authenticated;

-- ----------------------------------------------------------
-- Remarque de sécurité (identique au reste de l'application) : comme il n'y a
-- pas de vraie connexion Supabase par compte, « chacun ne supprime que sa
-- propre boîte » est garanti par le site, pas par la base. Ce qui est garanti
-- par la base, c'est qu'AUCUN message ne peut plus être effacé depuis le site.
-- ----------------------------------------------------------
