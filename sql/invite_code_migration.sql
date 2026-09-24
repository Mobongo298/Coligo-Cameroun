-- ==========================================================
-- COLIGO — Code d'invitation à usage unique
-- ==========================================================
-- À exécuter UNE SEULE FOIS dans Supabase : SQL Editor > New query
-- > coller tout ce fichier > Run.
-- N'efface aucune donnée existante (colis, colis_historique, agents).
-- ==========================================================

-- Table à une seule ligne qui contient le code d'invitation actuel.
create table if not exists invite_settings (
  id int primary key default 1,
  code text not null,
  updated_at timestamptz default now(),
  constraint invite_settings_single_row check (id = 1)
);

-- Reprend votre code actuel comme point de départ (à changer si vous voulez).
insert into invite_settings (id, code)
values (1, '2010')
on conflict (id) do nothing;

alter table invite_settings enable row level security;
-- Volontairement aucune politique "select"/"update" n'est créée ici :
-- personne ne peut lire ou modifier cette table directement.
-- Tout passe obligatoirement par les 2 fonctions ci-dessous.

-- ---------- Fonction 1 : utilisée par la page d'inscription ----------
-- Vérifie le code saisi. S'il est correct : le remplace immédiatement
-- par un nouveau code à 6 chiffres (usage unique) et renvoie "true".
-- S'il est incorrect : ne change rien et renvoie "false".
create or replace function verify_and_rotate_invite(code_saisi text)
returns boolean
language plpgsql
security definer
as $$
declare
  code_actuel text;
  nouveau_code text;
begin
  select code into code_actuel from invite_settings where id = 1;

  if code_actuel is null or code_saisi <> code_actuel then
    return false;
  end if;

  nouveau_code := lpad(floor(random() * 1000000)::text, 6, '0');
  update invite_settings set code = nouveau_code, updated_at = now() where id = 1;

  return true;
end;
$$;

-- ---------- Fonction 2 : utilisée par le tableau de bord administrateur ----------
-- Renvoie le code actuel, à donner au prochain agent ou responsable à inscrire.
create or replace function get_current_invite_code()
returns text
language plpgsql
security definer
as $$
declare
  c text;
begin
  select code into c from invite_settings where id = 1;
  return c;
end;
$$;

grant execute on function verify_and_rotate_invite(text) to anon;
grant execute on function get_current_invite_code() to anon;
