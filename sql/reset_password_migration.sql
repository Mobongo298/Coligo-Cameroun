-- ==========================================================
-- COLIGO — Mot de passe oublié (code envoyé par e-mail, gratuit)
-- ==========================================================
-- À exécuter UNE SEULE FOIS dans Supabase : SQL Editor > New query
-- > coller tout ce fichier > Run.
-- N'efface aucune donnée existante (colis, colis_historique, agents).
--
-- Comment ça marche :
--   1. Un compte doit avoir un e-mail enregistré (colonne "email" ajoutée
--      ci-dessous à la table agents). Les comptes déjà créés n'en ont pas
--      encore : un administrateur doit l'ajouter une fois depuis l'onglet
--      "Agents" du tableau de bord (nouveau bouton "Ajouter un e-mail").
--   2. Sur l'écran de connexion, "Mot de passe oublié ?" envoie un code à
--      6 chiffres par e-mail, valable 10 minutes, via l'API gratuite de
--      Resend (https://resend.com — jusqu'à 3000 e-mails/mois gratuits).
--   3. L'agent saisit le code + un nouveau mot de passe : le compte est
--      mis à jour, sans qu'aucun administrateur n'ait besoin d'intervenir.
--
-- Rien n'est envoyé tant que vous n'avez pas collé votre clé Resend
-- (voir tout en bas de ce fichier — c'est la dernière étape).
-- ==========================================================

-- ---------- 1. Colonne e-mail sur les comptes ----------
alter table agents add column if not exists email text;

-- ---------- 2. Réglages d'envoi d'e-mail (clé secrète, jamais lisible depuis le site) ----------
create table if not exists email_settings (
  id int primary key default 1,
  resend_api_key text,
  from_email text not null default 'Coligo <onboarding@resend.dev>',
  constraint email_settings_single_row check (id = 1)
);
insert into email_settings (id) values (1) on conflict (id) do nothing;

alter table email_settings enable row level security;
-- Volontairement aucune politique "select"/"update" ici : personne ne peut
-- lire ou modifier cette table depuis le site. Seul le SQL Editor le peut.

-- ---------- 3. Codes de vérification ----------
create table if not exists password_reset_codes (
  id bigint generated always as identity primary key,
  username text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
alter table password_reset_codes enable row level security;
-- Là aussi : aucune politique publique. Tout passe par les 2 fonctions
-- ci-dessous, qui tournent avec les droits du propriétaire de la base
-- ("security definer"), pas avec ceux du visiteur.

-- ---------- 4. Envoi d'e-mail depuis la base (extension officielle Supabase) ----------
create extension if not exists pg_net;

-- Masque une adresse pour l'affichage : j***@exemple.com
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

-- ---------- Fonction 1 : demande de réinitialisation ----------
-- Utilisée par l'écran de connexion, étape 1 ("Mot de passe oublié ?").
create or replace function request_password_reset(p_username text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_agent agents%rowtype;
  v_code text;
  v_key text;
  v_from text;
begin
  select * into v_agent from agents where username = p_username;

  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'message', 'Identifiant introuvable.');
  end if;

  if v_agent.email is null or v_agent.email = '' then
    return jsonb_build_object('ok', false, 'message',
      'Aucun e-mail n''est enregistré pour ce compte. Demandez à un administrateur de l''ajouter.');
  end if;

  -- Les anciens codes non utilisés pour cet identifiant deviennent caducs.
  update password_reset_codes set used = true where username = p_username and used = false;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  insert into password_reset_codes (username, code, expires_at)
  values (p_username, v_code, now() + interval '10 minutes');

  select resend_api_key, from_email into v_key, v_from from email_settings where id = 1;

  if v_key is not null and v_key <> '' then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', v_from,
        'to', jsonb_build_array(v_agent.email),
        'subject', 'Votre code de vérification COLIGO',
        'html',
          '<p>Bonjour ' || coalesce(v_agent.nom_complet, '') || ',</p>' ||
          '<p>Voici votre code de vérification :</p>' ||
          '<p style="font-size:26px;font-weight:700;letter-spacing:4px;">' || v_code || '</p>' ||
          '<p>Ce code est valable 10 minutes. Si vous n''êtes pas à l''origine de cette demande, ignorez cet e-mail.</p>'
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'email_masque', mask_email(v_agent.email));
end;
$$;

-- ---------- Fonction 2 : confirmation du nouveau mot de passe ----------
-- Utilisée par l'écran de connexion, étape 2 (code + nouveau mot de passe).
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

  update agents set password = p_nouveau_mdp where username = p_username;
  update password_reset_codes set used = true where id = v_row.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function request_password_reset(text) to anon;
grant execute on function confirm_password_reset(text, text, text) to anon;

-- ==========================================================
-- DERNIÈRE ÉTAPE — activer l'envoi réel des e-mails (gratuit)
-- ==========================================================
-- 1. Allez sur https://resend.com et créez un compte gratuit
--    (jusqu'à 3000 e-mails/mois, 100/jour — largement suffisant ici).
-- 2. Dans Resend : API Keys > Create API Key. Copiez la clé (commence par "re_").
-- 3. Revenez dans Supabase (SQL Editor > New query) et lancez, en remplaçant
--    la clé par la vôtre :
--
--      update email_settings set resend_api_key = 're_VOTRE_CLE_ICI' where id = 1;
--
-- 4. (Optionnel) Pour envoyer depuis votre propre nom/domaine plutôt que
--    "onboarding@resend.dev", vérifiez un domaine dans Resend puis :
--
--      update email_settings set from_email = 'COLIGO <no-reply@votredomaine.com>' where id = 1;
--
-- Tant que l'étape 3 n'est pas faite, le code est bien généré et enregistré
-- (visible avec : select * from password_reset_codes order by created_at desc;)
-- mais aucun e-mail ne part réellement.
-- ==========================================================
