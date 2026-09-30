-- ==========================================================
-- COLIGO — Messagerie interne + notifications d'invitation
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- N'efface aucune donnée existante.
--
-- Règles de circulation appliquées côté application (pas au niveau SQL,
-- comme le reste de l'app — voir la remarque de sécurité en bas de fichier) :
--   - Un administrateur peut écrire à n'importe quel agent (actif ou non),
--     individuellement ou à tous les agents à la fois ('tous').
--   - Un agent (espace agent OU espace retraits — même compte) peut écrire
--     à un autre agent, mais jamais à un administrateur.
--   - Chacun peut supprimer un message de SA boîte de réception après
--     l'avoir consulté (il est alors masqué pour lui seul : voir
--     sql/messagerie_conservation_migration.sql, à exécuter ensuite).
-- ==========================================================

create table if not exists messages (
  id bigint generated always as identity primary key,

  expediteur_type text not null check (expediteur_type in ('admin', 'agent')),
  expediteur_username text,          -- identifiant de l'agent expéditeur (null si admin)
  expediteur_nom text not null,      -- nom affiché dans la boîte de réception

  destinataire_type text not null check (destinataire_type in ('agent', 'tous')),
  destinataire_username text,        -- identifiant de l'agent destinataire (null si 'tous')

  contenu text not null,
  created_at timestamptz default now()
);

create index if not exists messages_destinataire_idx on messages (destinataire_username);
create index if not exists messages_created_idx on messages (created_at desc);

-- Diffusion en temps réel : sans cette ligne, les boîtes de réception ne
-- se mettent à jour qu'au rechargement de la page.
alter publication supabase_realtime add table messages;

-- Le tableau de bord admin détecte automatiquement qu'un code d'invitation
-- vient d'être utilisé (un nouvel agent apparaît) pour rafraîchir le code
-- affiché sans clic manuel. Cela suppose que la table agents diffuse
-- elle aussi ses changements en temps réel.
alter publication supabase_realtime add table agents;

-- ----------------------------------------------------------
-- Remarque de sécurité (déjà valable pour le reste de l'application) :
-- comme les autres tables ici, aucune politique RLS restrictive n'est
-- posée sur `messages` : la clé anon utilisée par le site peut tout lire
-- et tout écrire, et le tri "qui peut parler à qui" n'est fait que côté
-- JavaScript. Un utilisateur techniquement averti pourrait contourner
-- cette règle. Si vous voulez une vraie garantie, il faudra mettre en
-- place l'authentification Supabase et des politiques RLS — comme noté
-- pour la table `agents`.
-- ----------------------------------------------------------
