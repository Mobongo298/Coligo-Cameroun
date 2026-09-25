-- ==========================================================
-- COLIGO — Code d'invitation distinct pour Agent et Responsable
-- ==========================================================
-- À exécuter UNE SEULE FOIS dans Supabase : SQL Editor > New query
-- > coller tout ce fichier > Run.
-- N'efface aucune donnée existante (colis, colis_historique, agents).
-- Se lance sans risque même si vous le relancez par erreur (idempotent).
--
-- PRÉREQUIS : sql/invite_code_migration.sql et
-- sql/securite_mots_de_passe_migration.sql doivent déjà avoir été exécutés.
--
-- CE QUE CE FICHIER CORRIGE :
--   Avant : un seul code d'invitation servait à la fois pour créer un
--   compte "agent" ET un compte "responsable" (administrateur). La page
--   d'inscription laisse l'utilisateur choisir librement son rôle dans
--   une liste déroulante : n'importe qui connaissant le code agent
--   pouvait donc simplement sélectionner "Responsable" et obtenir un
--   compte admin, sans que le code d'invitation ne s'y oppose.
--
--   Après : il existe désormais UN code pour les agents et UN AUTRE code,
--   distinct, pour les responsables. Le serveur vérifie que le code saisi
--   correspond bien au rôle demandé dans le formulaire — un code agent ne
--   permet plus de créer un compte administrateur, et inversement.
--
-- CE QUE VOUS DEVEZ FAIRE ENSUITE : rien pour que ce soit sécurisé. Mais
-- pensez à consulter Admin.html > "Code d'invitation" : vous y verrez
-- maintenant DEUX codes séparés à communiquer selon le rôle du prochain
-- compte à créer.
-- ==========================================================

-- ---------- 1. Nouvelle colonne : code dédié aux responsables ----------
alter table invite_settings add column if not exists code_admin text;

update invite_settings
set code_admin = lpad(floor(random() * 1000000)::text, 6, '0')
where id = 1 and code_admin is null;

-- La colonne "code" existante continue de servir de code AGENT.

-- ---------- 2. Vérification tenant compte du rôle demandé ----------
-- Remplace l'ancienne fonction à un seul paramètre : on exige désormais
-- le rôle pour être sûr de vérifier/faire tourner le BON code.
drop function if exists verify_and_rotate_invite(text);

create or replace function verify_and_rotate_invite(p_role text, code_saisi text)
returns boolean
language plpgsql
security definer
as $$
declare
  code_actuel text;
  nouveau_code text;
begin
  if p_role = 'administrateur' then
    select code_admin into code_actuel from invite_settings where id = 1;
  else
    select code into code_actuel from invite_settings where id = 1;
  end if;

  if code_actuel is null or code_saisi <> code_actuel then
    return false;
  end if;

  nouveau_code := lpad(floor(random() * 1000000)::text, 6, '0');

  if p_role = 'administrateur' then
    update invite_settings set code_admin = nouveau_code, updated_at = now() where id = 1;
  else
    update invite_settings set code = nouveau_code, updated_at = now() where id = 1;
  end if;

  return true;
end;
$$;

-- ---------- 3. Lecture des deux codes (tableau de bord admin) ----------
create or replace function get_current_invite_code()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_code text;
  v_code_admin text;
begin
  select code, code_admin into v_code, v_code_admin from invite_settings where id = 1;
  return jsonb_build_object('agent', v_code, 'administrateur', v_code_admin);
end;
$$;

-- ---------- 4. agent_signup : transmet le rôle à la vérification ----------
create or replace function agent_signup(
  p_nom text, p_agence text, p_role text,
  p_username text, p_email text, p_password text, p_invite text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_admin_count int;
  v_code_valide boolean;
begin
  if p_role = 'administrateur' then
    select count(*) into v_admin_count from agents where role = 'administrateur';
    if v_admin_count >= 10 then
      return jsonb_build_object('ok', false, 'message', 'Le nombre maximum de comptes administrateur (10) est déjà atteint.');
    end if;
  end if;

  if exists (select 1 from agents where username = p_username) then
    return jsonb_build_object('ok', false, 'message', 'Cet identifiant est déjà utilisé. Choisissez-en un autre.');
  end if;

  select verify_and_rotate_invite(p_role, p_invite) into v_code_valide;
  if not v_code_valide then
    return jsonb_build_object('ok', false, 'message', 'Code d''invitation invalide pour ce type de compte. Demandez le code actuel à un administrateur.');
  end if;

  insert into agents (nom_complet, agence, role, username, email, password)
  values (p_nom, p_agence, p_role, p_username, p_email, crypt(p_password, gen_salt('bf')));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function verify_and_rotate_invite(text, text) to anon;
grant execute on function get_current_invite_code() to anon;
grant execute on function agent_signup(text, text, text, text, text, text, text) to anon;
-- ==========================================================
