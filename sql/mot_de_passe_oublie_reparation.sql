-- ==========================================================
-- COLIGO — RÉPARATION « Mot de passe oublié » (code par e-mail)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être relancé sans risque. N'efface ni comptes, ni colis, ni vos réglages d'envoi.
--
-- POURQUOI LE CODE N'ARRIVAIT PLUS
-- ----------------------------------------------------------
-- Plusieurs fichiers SQL du projet redéfinissent la MÊME fonction request_password_reset :
--   • reset_password_migration.sql et messagerie_codes_suivi_migration.sql : ancienne
--     version (envoi Resend « à l'aveugle », erreurs invisibles) ;
--   • email_reset_fix.sql : version actuelle (envoi vérifié, relais Google ou Resend).
-- Le dernier fichier lancé gagne. Il suffit donc d'avoir relancé un ancien fichier
-- (ou d'avoir lancé email_reset_fix.sql sans enregistrer gas_url / gas_secret alors que
-- votre clé Resend était déjà là) pour que l'envoi cesse sans que rien ne l'indique.
--
-- CE SCRIPT
-- ----------------------------------------------------------
--  1. Remet en place tout ce qui est nécessaire (extensions, tables, colonnes).
--  2. Réinstalle la bonne version des 2 fonctions, avec la sécurité actuelle
--     (mot de passe haché, 5 essais max, codes effacés après usage).
--  3. CHOISIT AUTOMATIQUEMENT le fournisseur d'e-mail qui est réellement configuré :
--       relais Google (gas_url + gas_secret)  →  sinon Resend (clé enregistrée)  →  sinon message clair.
--     Plus de blocage « service non configuré » quand une clé Resend existait déjà.
--  4. Note chaque tentative dans email_log, avec la cause exacte en cas d'échec.
--  5. Affiche à la fin un état des lieux (dernier bloc, lecture seule).
-- ==========================================================

-- ---------- 1. Prérequis ----------
create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists http with schema extensions;

alter table agents add column if not exists email text;

create table if not exists email_settings (
  id int primary key default 1,
  resend_api_key text,
  from_email text not null default 'Coligo <onboarding@resend.dev>',
  constraint email_settings_single_row check (id = 1)
);
alter table email_settings add column if not exists provider   text not null default 'gas';
alter table email_settings add column if not exists gas_url    text;
alter table email_settings add column if not exists gas_secret text;
insert into email_settings (id) values (1) on conflict (id) do nothing;
alter table email_settings enable row level security;   -- aucune politique : illisible depuis le site

create table if not exists password_reset_codes (
  id bigint generated always as identity primary key,
  username text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
alter table password_reset_codes add column if not exists tentatives int not null default 0;
alter table password_reset_codes enable row level security;

create table if not exists email_log (
  id bigint generated always as identity primary key,
  username text,
  destinataire text,
  provider text,
  ok boolean not null,
  http_status int,
  detail text,
  created_at timestamptz not null default now()
);
alter table email_log enable row level security;
revoke all on email_log from anon, authenticated;

create or replace function mask_email(e text)
returns text
language sql
immutable
as $$
  select case
    when e is null or position('@' in e) <= 1 then e
    else left(e, 1) || repeat('*', greatest(position('@' in e) - 2, 1)) || substring(e from position('@' in e))
  end;
$$;

-- ---------- 2. Moteur d'envoi : choisit le fournisseur réellement configuré ----------
create or replace function send_email_sync(p_to text, p_subject text, p_html text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s email_settings%rowtype;
  v_mode text;                      -- 'gas' ou 'resend'
  v_url text;
  v_headers extensions.http_header[];
  v_body text;
  v_resp extensions.http_response;
  v_ok boolean := false;
  v_detail text;
begin
  select * into s from email_settings where id = 1;

  if coalesce(s.gas_url, '') <> '' and coalesce(s.gas_secret, '') <> ''
     and coalesce(s.provider, 'gas') <> 'resend' then
    v_mode := 'gas';
  elsif coalesce(s.resend_api_key, '') <> '' then
    v_mode := 'resend';
  elsif coalesce(s.gas_url, '') <> '' and coalesce(s.gas_secret, '') <> '' then
    v_mode := 'gas';
  else
    return jsonb_build_object('ok', false, 'configured', false, 'provider', 'aucun',
      'detail', 'Aucun fournisseur d''e-mail enregistré (ni relais Google gas_url/gas_secret, ni clé Resend).');
  end if;

  if v_mode = 'resend' then
    v_url := 'https://api.resend.com/emails';
    v_headers := array[ extensions.http_header('Authorization', 'Bearer ' || s.resend_api_key) ];
    v_body := jsonb_build_object(
      'from', s.from_email, 'to', jsonb_build_array(p_to),
      'subject', p_subject, 'html', p_html)::text;
  else
    v_url := s.gas_url;
    v_headers := array[]::extensions.http_header[];
    v_body := jsonb_build_object(
      'secret', s.gas_secret, 'to', p_to, 'subject', p_subject, 'html', p_html)::text;
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
    perform extensions.http_set_curlopt('CURLOPT_FOLLOWLOCATION', '1');   -- le relais Google répond par une redirection
    v_resp := extensions.http((
      'POST', v_url, v_headers, 'application/json', v_body
    )::extensions.http_request);
  exception when others then
    return jsonb_build_object('ok', false, 'configured', true, 'provider', v_mode,
      'detail', 'Échec de connexion au fournisseur : ' || sqlerrm);
  end;

  v_detail := left(coalesce(v_resp.content, ''), 500);

  if v_mode = 'resend' then
    v_ok := v_resp.status between 200 and 299;
  else
    begin
      v_ok := v_resp.status = 200 and coalesce((v_resp.content::jsonb ->> 'ok')::boolean, false);
    exception when others then
      v_ok := false;   -- réponse HTML : relais non déployé « Tout le monde », autorisation manquante, URL périmée…
    end;
  end if;

  return jsonb_build_object('ok', v_ok, 'configured', true, 'provider', v_mode,
    'status', v_resp.status, 'detail', v_detail);
end;
$$;
revoke all on function send_email_sync(text, text, text) from public, anon, authenticated;

-- ---------- 3. Étape 1 : demander le code ----------
create or replace function request_password_reset(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_agent agents%rowtype;
  v_code text;
  v_res jsonb;
  v_html text;
begin
  delete from password_reset_codes where used or expires_at < now();

  select * into v_agent from agents where username = p_username;

  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'message', 'Identifiant introuvable.');
  end if;

  if coalesce((to_jsonb(v_agent)->>'actif')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'message', 'Ce compte est désactivé. Contactez un administrateur.');
  end if;

  if v_agent.email is null or btrim(v_agent.email) = '' then
    return jsonb_build_object('ok', false, 'message',
      'Aucun e-mail n''est enregistré pour ce compte. Demandez à un administrateur de l''ajouter.');
  end if;

  -- Anti-abus : 5 demandes maximum par compte sur 10 minutes.
  if (select count(*) from email_log
        where username = p_username and created_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'message',
      'Trop de demandes. Patientez quelques minutes avant de redemander un code.');
  end if;

  delete from password_reset_codes where username = p_username;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  insert into password_reset_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '10 minutes');

  v_html :=
    '<p>Bonjour ' || coalesce(v_agent.nom_complet, '') || ',</p>' ||
    '<p>Voici votre code de vérification COLIGO :</p>' ||
    '<p style="font-size:26px;font-weight:700;letter-spacing:4px;">' || v_code || '</p>' ||
    '<p>Ce code est valable 10 minutes et ne peut servir qu''une seule fois. ' ||
    'Si vous n''êtes pas à l''origine de cette demande, ignorez cet e-mail.</p>';

  v_res := send_email_sync(btrim(v_agent.email), 'Votre code de vérification COLIGO', v_html);

  insert into email_log (username, destinataire, provider, ok, http_status, detail)
  values (p_username, btrim(v_agent.email), coalesce(v_res->>'provider', '?'),
          coalesce((v_res->>'ok')::boolean, false),
          nullif(v_res->>'status', '')::int,
          v_res->>'detail');

  if coalesce((v_res->>'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'email_masque', mask_email(btrim(v_agent.email)));
  end if;

  delete from password_reset_codes where username = p_username;

  if coalesce((v_res->>'configured')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'message',
      'Le service d''envoi d''e-mails n''est pas configuré. Contactez un administrateur.');
  end if;

  return jsonb_build_object('ok', false, 'message',
    'L''e-mail n''a pas pu être envoyé. Réessayez dans un instant ou contactez un administrateur.');
end;
$$;
grant execute on function request_password_reset(text) to anon;

-- ---------- 4. Étape 2 : confirmer le code + nouveau mot de passe ----------
create or replace function confirm_password_reset(p_username text, p_code text, p_nouveau_mdp text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row password_reset_codes%rowtype;
begin
  if p_nouveau_mdp is null or length(p_nouveau_mdp) < 4 then
    return jsonb_build_object('ok', false, 'message', 'Le mot de passe doit contenir au moins 4 caractères.');
  end if;

  select * into v_row from password_reset_codes
    where username = p_username and used = false
    order by created_at desc
    limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'message', 'Code invalide. Demandez un nouveau code.');
  end if;

  if v_row.expires_at < now() then
    delete from password_reset_codes where username = p_username;
    return jsonb_build_object('ok', false, 'message', 'Ce code a expiré. Demandez-en un nouveau.');
  end if;

  if v_row.code is distinct from btrim(coalesce(p_code, '')) then
    if v_row.tentatives + 1 >= 5 then
      delete from password_reset_codes where username = p_username;
      return jsonb_build_object('ok', false, 'message', 'Trop de codes incorrects : ce code a été annulé. Demandez-en un nouveau.');
    end if;
    update password_reset_codes set tentatives = tentatives + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'message', 'Code invalide.');
  end if;

  update agents set password = crypt(p_nouveau_mdp, gen_salt('bf')) where username = p_username;

  delete from password_reset_codes where username = p_username;
  begin
    delete from login_attempts where username = p_username;   -- déverrouille la connexion
  exception when undefined_table then null; end;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function confirm_password_reset(text, text, text) to anon;

-- ---------- 5. Test d'installation (SQL Editor uniquement) ----------
create or replace function test_envoi_email(p_to text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_res jsonb;
begin
  v_res := send_email_sync(p_to, 'Test COLIGO',
    '<p>Si vous lisez ce message, l''envoi d''e-mails COLIGO fonctionne.</p>');
  insert into email_log (username, destinataire, provider, ok, http_status, detail)
  values ('(test)', p_to, coalesce(v_res->>'provider', '?'),
          coalesce((v_res->>'ok')::boolean, false), nullif(v_res->>'status', '')::int, v_res->>'detail');
  return v_res;
end;
$$;
revoke all on function test_envoi_email(text) from public, anon, authenticated;

-- ==========================================================
-- ÉTAT DES LIEUX (lecture seule) — regardez le résultat de cette requête
-- ==========================================================
select
  (select coalesce(gas_url, '') <> '' and coalesce(gas_secret, '') <> '' from email_settings where id = 1) as relais_google_enregistre,
  (select coalesce(resend_api_key, '') <> '' from email_settings where id = 1)                              as cle_resend_enregistree,
  (select count(*) from agents where coalesce(email, '') <> '')                                              as comptes_avec_email,
  (select count(*) from agents where coalesce(email, '') = '')                                               as comptes_sans_email,
  (select prosrc like '%send_email_sync%' from pg_proc where proname = 'request_password_reset' limit 1)    as fonction_a_jour;

-- ==========================================================
-- ÉTAPE FINALE — tester (remplacez par VOTRE adresse) :
--
--      select test_envoi_email('votre.adresse@gmail.com');
--
--   • "ok": true et e-mail reçu (vérifiez les spams)  → c'est réparé, testez l'écran de connexion.
--   • "ok": false → lisez la cause :
--        select created_at, destinataire, provider, http_status, detail
--          from email_log order by id desc limit 5;
--
--   Causes fréquentes et remèdes :
--     - « Aucun fournisseur d'e-mail enregistré » : relancez la commande de email-relay/Code.gs (étape 7) :
--          update email_settings set provider='gas',
--            gas_url='https://script.google.com/macros/s/XXXX/exec', gas_secret='VOTRE_SECRET' where id = 1;
--     - detail qui contient du HTML (« <!DOCTYPE… », page Google) : le relais Apps Script doit être
--       redéployé en « Application Web », accès « Tout le monde » (Déployer > Gérer les déploiements >
--       crayon > Nouvelle version), ou l'autorisation Google a expiré (relancez « autoriserEnvoi »).
--     - « secret invalide » : gas_secret n'est pas identique à CODE_SECRET dans Code.gs.
--     - Resend 403/422 : sans domaine vérifié, Resend n'envoie qu'à l'adresse du propriétaire du compte.
--     - quota Gmail dépassé (~100 e-mails/jour) : réessayez le lendemain.
-- ==========================================================
