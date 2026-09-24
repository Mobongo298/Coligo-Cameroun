-- ==========================================================
-- COLIGO — présence réelle des agents
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
--
-- Jusqu'ici, le menu Agents ne montrait qu'une estimation ("actif si un
-- colis a été traité aujourd'hui"). Ces 3 colonnes permettent de savoir
-- réellement si un agent est connecté, et depuis/jusqu'à quand.
-- ==========================================================

alter table agents add column if not exists en_ligne boolean default false;
alter table agents add column if not exists derniere_connexion timestamptz;
alter table agents add column if not exists derniere_deconnexion timestamptz;
