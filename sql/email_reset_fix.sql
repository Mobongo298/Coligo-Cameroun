-- ==========================================================
-- COLIGO — CORRECTIF DÉFINITIF : « Mot de passe oublié » (e-mail jamais reçu)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > Run.
-- À lancer APRÈS reset_password_migration.sql, securite_mots_de_passe_migration.sql
-- et messagerie_codes_suivi_migration.sql (il remplace leur version de
-- request_password_reset). Peut être relancé sans risque.
--
-- POURQUOI LE MESSAGE « Un code a été envoyé » S'AFFICHAIT SANS RIEN RECEVOIR
-- ----------------------------------------------------------
--  1. L'ancienne fonction répondait « envoyé » dans TOUS les cas, même si la clé
--     Resend n'avait jamais été enregistrée (aucun envoi tenté).
--  2. L'envoi se faisait avec pg_net, qui est ASYNCHRONE : la fonction ne connaît
--     jamais la réponse du fournisseur. Si Resend refusait (très fréquent : avec
--     l'expéditeur de test onboarding@resend.dev, Resend n'envoie QU'À l'adresse
--     du propriétaire du compte Resend, jamais aux autres Gmail), l'erreur
--     disparaissait en silence et l'écran affichait quand même « envoyé ».
--
-- CE QUE CE SCRIPT CHANGE
-- ----------------------------------------------------------
--  • L'envoi devient SYNCHRONE (extension « http ») : la fonction attend la réponse
--    réelle du fournisseur. « Un code a été envoyé » n'est affiché que si l'e-mail
--    a VRAIMENT été accepté. Sinon : message d'erreur clair, code annulé.
--  • Nouveau fournisseur par défaut : un petit relais Google Apps Script qui envoie
--    depuis VOTRE Gmail, vers n'importe quelle adresse, gratuitement, sans nom de
--    domaine (voir email-relay/Code.gs et LISEZ-MOI.md). Resend reste possible si
--    vous avez un domaine vérifié.
--  • Journal email_log : chaque tentative (réussie ou non) y est notée avec la
--    cause exacte. Plus jamais d'échec invisible.
--  • Anti-abus : 5 demandes maximum par compte toutes les 10 minutes (protège le
--    quota quotidien d'envois).
--  • Fonction de test test_envoi_email() pour vérifier l'installation en 1 clic.
-- ==========================================================

-- ---------- 1. Envoi synchrone ----------
create extension if not exists http with schema extensions;

-- ---------- 2. Réglages d'envoi ----------
alter table email_settings add column if not exists provider   text not null default 'gas';
alter table email_settings add column if not exists gas_url    text;
alter table email_settings add column if not exists gas_secret text;
-- (RLS déjà activé sur email_settings, sans aucune politique : illisible depuis le site.)

-- ---------- 3. Journal des envois (illisible depuis le site) ----------
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

-- ---------- 4. Moteur d'envoi (interne, jamais appelable depuis le site) ----------
create or replace function send_email_sync(p_to text, p_subject text, p_html text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s email_settings%rowtype;
  v_url text;
  v_headers extensions.http_header[];
  v_body text;
  v_resp extensions.http_response;
  v_ok boolean := false;
  v_detail text;
begin
  select * into s from email_settings where id = 1;

  if coalesce(s.provider, 'gas') = 'resend' then
    if coalesce(s.resend_api_key, '') = '' then
      return jsonb_build_object('ok', false, 'configured', false,
        'detail', 'Clé Resend non enregistrée dans email_settings.');
    end if;
    v_url := 'https://api.resend.com/emails';
    v_headers := array[
      extensions.http_header('Authorization', 'Bearer ' || s.resend_api_key)
    ];
    v_body := jsonb_build_object(
      'from', s.from_email,
      'to', jsonb_build_array(p_to),
      'subject', p_subject,
      'html', p_html
    )::text;
  else
    if coalesce(s.gas_url, '') = '' or coalesce(s.gas_secret, '') = '' then
      return jsonb_build_object('ok', false, 'configured', false,
        'detail', 'Relais Google (gas_url / gas_secret) non enregistré dans email_settings.');
    end if;
    v_url := s.gas_url;
    v_headers := array[]::extensions.http_header[];
    v_body := jsonb_build_object(
      'secret', s.gas_secret,
      'to', p_to,
      'subject', p_subject,
      'html', p_html
    )::text;
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
    perform extensions.http_set_curlopt('CURLOPT_FOLLOWLOCATION', '1');  -- Apps Script répond par une redirection

    v_resp := extensions.http((
      'POST', v_url, v_headers, 'application/json', v_body
    )::extensions.http_request);
  exception when others then
    return jsonb_build_object('ok', false, 'configured', true,
      'detail', 'Échec de connexion au fournisseur : ' || sqlerrm);
  end;

  v_detail := left(coalesce(v_resp.content, ''), 500);

  if coalesce(s.provider, 'gas') = 'resend' then
    v_ok := v_resp.status between 200 and 299;
  else
    begin
      v_ok := v_resp.status = 200 and coalesce((v_resp.content::jsonb ->> 'ok')::boolean, false);
    exception when others then
      v_ok := false;   -- réponse HTML (relais non déployé « Tout le monde », autorisation manquante…)
    end;
  end if;

  return jsonb_build_object('ok', v_ok, 'configured', true,
    'status', v_resp.status, 'detail', v_detail);
end;
$$;

revoke all on function send_email_sync(text, text, text) from public, anon, authenticated;

-- ---------- 5. « Mot de passe oublié » : étape 1 (honnête, vérifiée) ----------
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
  v_prov text;
  v_html text;
begin
  -- Ménage général : codes expirés ou déjà utilisés.
  delete from password_reset_codes where used or expires_at < now();

  select * into v_agent from agents where username = p_username;

  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'message', 'Identifiant introuvable.');
  end if;

  if coalesce((to_jsonb(v_agent)->>'actif')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'message', 'Ce compte est désactivé. Contactez un administrateur.');
  end if;

  if v_agent.email is null or v_agent.email = '' then
    return jsonb_build_object('ok', false, 'message',
      'Aucun e-mail n''est enregistré pour ce compte. Demandez à un administrateur de l''ajouter.');
  end if;

  -- Anti-abus : 5 demandes maximum par compte sur 10 minutes.
  if (select count(*) from email_log
        where username = p_username and created_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'message',
      'Trop de demandes. Patientez quelques minutes avant de redemander un code.');
  end if;

  -- Les anciens codes de ce compte sont effacés.
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

  v_res := send_email_sync(v_agent.email, 'Votre code de vérification COLIGO', v_html);

  select coalesce(provider, 'gas') into v_prov from email_settings where id = 1;
  insert into email_log (username, destinataire, provider, ok, http_status, detail)
  values (p_username, v_agent.email, v_prov,
          coalesce((v_res->>'ok')::boolean, false),
          nullif(v_res->>'status', '')::int,
          v_res->>'detail');

  if coalesce((v_res->>'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'email_masque', mask_email(v_agent.email));
  end if;

  -- L'envoi a échoué : on annule le code et on le dit clairement.
  delete from password_reset_codes where username = p_username;

  if coalesce((v_res->>'configured')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'message',
      'Le service d''envoi d''e-mails n''est pas encore configuré. Contactez un administrateur.');
  end if;

  return jsonb_build_object('ok', false, 'message',
    'L''e-mail n''a pas pu être envoyé. Réessayez dans un instant ou contactez un administrateur.');
end;
$$;

grant execute on function request_password_reset(text) to anon;

-- ---------- 6. Test d'installation (SQL Editor uniquement) ----------
-- Utilisation : select test_envoi_email('votre.adresse@gmail.com');
-- Doit renvoyer {"ok": true, ...} ET vous devez recevoir l'e-mail.
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
  values ('(test)', p_to, (select coalesce(provider, 'gas') from email_settings where id = 1),
          coalesce((v_res->>'ok')::boolean, false), nullif(v_res->>'status', '')::int, v_res->>'detail');
  return v_res;
end;
$$;

revoke all on function test_envoi_email(text) from public, anon, authenticated;

-- ==========================================================
-- ÉTAPE SUIVANTE (obligatoire) — enregistrer votre relais d'e-mail
-- ==========================================================
-- 1. Suivez « email-relay/Code.gs » (5 minutes) pour obtenir l'URL du relais
--    et choisir un code secret.
-- 2. Lancez (en remplaçant les deux valeurs) :
--
--      update email_settings
--         set provider   = 'gas',
--             gas_url    = 'https://script.google.com/macros/s/XXXXXXXX/exec',
--             gas_secret = 'VOTRE-CODE-SECRET'
--       where id = 1;
--
-- 3. Testez :   select test_envoi_email('votre.adresse@gmail.com');
--    Résultat attendu : "ok": true  + e-mail reçu (vérifiez aussi les spams).
-- 4. En cas d'échec, la cause exacte est ici :
--      select created_at, destinataire, ok, http_status, detail
--        from email_log order by id desc limit 10;
-- ==========================================================
