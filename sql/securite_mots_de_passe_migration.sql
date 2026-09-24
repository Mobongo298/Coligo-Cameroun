-- ==========================================================
-- COLIGO — Sécurisation des mots de passe
-- ==========================================================
-- À exécuter UNE SEULE FOIS dans Supabase : SQL Editor > New query
-- > coller tout ce fichier > Run.
-- N'efface aucune donnée existante (colis, colis_historique, agents).
-- Se lance sans risque même si vous le relancez par erreur (idempotent).
--
-- PRÉREQUIS : sql/invite_code_migration.sql doit déjà avoir été exécuté
-- (la fonction agent_signup ci-dessous appelle verify_and_rotate_invite,
-- définie dans ce fichier). Si ce n'est pas encore fait, lancez-le d'abord.
--
-- CE QUE CE FICHIER CORRIGE :
--   Avant : les mots de passe étaient stockés EN CLAIR dans la table
--   "agents", et le site les comparait lui-même depuis le navigateur
--   (n'importe qui ouvrant les outils de développement pouvait les voir
--   transiter, ou les lire directement). En cas de fuite de la base,
--   tous les mots de passe auraient été immédiatement lisibles.
--
--   Après : les mots de passe sont hachés (bcrypt, via l'extension
--   officielle "pgcrypto"). Aucun mot de passe ne quitte plus jamais la
--   base de données : la vérification se fait entièrement côté serveur,
--   via 4 fonctions (connexion, inscription, changement de mot de passe,
--   réinitialisation). En prime : 5 tentatives de connexion échouées
--   verrouillent le compte 15 minutes (anti "essais en boucle").
--
-- CE QUE VOUS DEVEZ FAIRE ENSUITE : rien. Les comptes existants sont
-- automatiquement migrés vers des mots de passe hachés ci-dessous, avec
-- leur mot de passe actuel (personne n'a besoin de le changer).
-- ==========================================================

create extension if not exists pgcrypto;

-- ---------- 1. Migration des mots de passe existants (en clair → hachés) ----------
-- Ne touche que les mots de passe qui ne sont pas déjà hachés (sûr à relancer).
update agents
set password = crypt(password, gen_salt('bf'))
where password is not null
  and password !~ '^\$2[aby]\$';

-- ---------- 2. Verrouillage anti brute-force ----------
create table if not exists login_attempts (
  username text primary key,
  failed_count int not null default 0,
  locked_until timestamptz
);
alter table login_attempts enable row level security;
-- Aucune politique publique : uniquement accessible via les fonctions ci-dessous.

-- ---------- 3. Connexion (remplace le .select('*').eq('password', ...) du site) ----------
-- Renvoie { ok: true, agent: {...sans le mot de passe} } ou { ok: false, message, locked? }.
create or replace function agent_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_agent agents%rowtype;
  v_attempts login_attempts%rowtype;
  v_ok boolean;
begin
  select * into v_attempts from login_attempts where username = p_username;

  if v_attempts.locked_until is not null and v_attempts.locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'locked', true,
      'message', 'Trop de tentatives. Réessayez dans quelques minutes.'
    );
  end if;

  select * into v_agent from agents where username = p_username;

  v_ok := (v_agent.id is not null)
      and (v_agent.password is not null)
      and (crypt(p_password, v_agent.password) = v_agent.password);

  if not v_ok then
    insert into login_attempts (username, failed_count, locked_until)
    values (p_username, 1, null)
    on conflict (username) do update set
      failed_count = login_attempts.failed_count + 1,
      locked_until = case when login_attempts.failed_count + 1 >= 5
                          then now() + interval '15 minutes'
                          else null end;
    return jsonb_build_object('ok', false, 'message', 'Identifiant ou mot de passe incorrect.');
  end if;

  delete from login_attempts where username = p_username;

  return jsonb_build_object('ok', true, 'agent', to_jsonb(v_agent) - 'password');
end;
$$;

-- ---------- 4. Inscription (remplace le .insert() direct de signup.js) ----------
-- Vérifie le code d'invitation, l'unicité de l'identifiant, la limite de 10
-- admins, puis hache le mot de passe avant de créer le compte.
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

  select verify_and_rotate_invite(p_invite) into v_code_valide;
  if not v_code_valide then
    return jsonb_build_object('ok', false, 'message', 'Code d''invitation invalide. Demandez le code actuel à un administrateur.');
  end if;

  insert into agents (nom_complet, agence, role, username, email, password)
  values (p_nom, p_agence, p_role, p_username, p_email, crypt(p_password, gen_salt('bf')));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- 5. Changement de mot de passe (compte déjà connecté) ----------
create or replace function change_own_password(p_username text, p_ancien text, p_nouveau text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_agent agents%rowtype;
begin
  if p_nouveau is null or length(p_nouveau) < 4 then
    return jsonb_build_object('ok', false, 'message', 'Le nouveau mot de passe doit contenir au moins 4 caractères.');
  end if;

  select * into v_agent from agents where username = p_username;

  if v_agent.id is null or v_agent.password is null or crypt(p_ancien, v_agent.password) <> v_agent.password then
    return jsonb_build_object('ok', false, 'message', 'Le mot de passe actuel est incorrect.');
  end if;

  update agents set password = crypt(p_nouveau, gen_salt('bf')) where id = v_agent.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- 6. Reprend la fonction de reset_password_migration.sql pour hacher le nouveau mot de passe ----------
-- (Sans effet si reset_password_migration.sql n'a pas encore été exécuté ;
-- dans ce cas, exécutez-le, l'ordre entre les deux fichiers n'a pas d'importance.)
create or replace function confirm_password_reset(p_username text, p_code text, p_nouveau_mdp text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row password_reset_codes%rowtype;
begin
  if p_nouveau_mdp is null or length(p_nouveau_mdp) < 4 then
    return jsonb_build_object('ok', false, 'message', 'Le mot de passe doit contenir au moins 4 caractères.');
  end if;

  select * into v_row from password_reset_codes
    where username = p_username and code = p_code and used = false
    order by created_at desc
    limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'message', 'Code invalide.');
  end if;

  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'message', 'Ce code a expiré. Demandez-en un nouveau.');
  end if;

  update agents set password = crypt(p_nouveau_mdp, gen_salt('bf')) where username = p_username;
  update password_reset_codes set used = true where id = v_row.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function agent_login(text, text) to anon;
grant execute on function agent_signup(text, text, text, text, text, text, text) to anon;
grant execute on function change_own_password(text, text, text) to anon;

-- ==========================================================
-- ÉTAPE SUIVANTE (recommandée, à faire vous-même quand vous êtes prêt)
-- ==========================================================
-- Ce fichier empêche déjà le site d'envoyer ou de comparer des mots de
-- passe en clair. Pour fermer complètement l'accès direct à la colonne
-- "password" (même par un visiteur qui interrogerait Supabase depuis les
-- outils de développement du navigateur, en dehors du site), il faut
-- restreindre les colonnes lisibles de la table "agents" par le rôle
-- public ("anon"). Cette étape n'est pas incluse automatiquement ici car
-- elle exige de connaître la liste EXACTE des colonnes que votre
-- application utilise ailleurs (un oubli bloquerait l'app entière). Pour
-- la faire vous-même en sécurité :
--
--   1. Listez vos colonnes :
--        select column_name from information_schema.columns where table_name = 'agents';
--   2. Puis, en gardant TOUTES les colonnes sauf "password" :
--        revoke select on agents from anon;
--        grant select (liste, de, vos, colonnes, sans, password) on agents to anon;
--   3. Testez ensuite les 3 espaces (admin, agent, retrait) de bout en
--      bout avant de considérer cette étape terminée.
-- ==========================================================
