-- ==========================================================
-- COLIGO — Messagerie, codes de récupération, suivi client
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- À lancer APRÈS : messagerie_conservation_migration.sql,
-- reset_password_migration.sql, securite_mots_de_passe_migration.sql et
-- annulation_conservation_donnees.sql. Peut être relancé sans risque.
--
-- Ce que ça change :
--   1. MESSAGERIE : l'expéditeur et le destinataire suppriment chacun le
--      message dans leur propre messagerie, quand ils le veulent. Dès que
--      les deux l'ont supprimé, le message est effacé DÉFINITIVEMENT de la
--      base (pour une diffusion « Tous les agents » : quand l'administrateur
--      expéditeur et tous les agents l'ont supprimée).
--   2. CODES « MOT DE PASSE OUBLIÉ » : un code est effacé de la base dès
--      qu'il a servi. Les anciens codes d'un compte sont effacés quand un
--      nouveau est demandé, un code expiré est effacé dès qu'on tente de
--      l'utiliser, et 5 codes faux d'affilée effacent le code (anti-essais).
--   3. SUIVI CLIENT : pour un colis retiré, le site affiche seulement les
--      informations du retrait (sans reçu, sans CNI ni téléphone).
-- ==========================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------
-- 1. Messagerie : effacement définitif quand tout le monde a supprimé
-- ----------------------------------------------------------
create or replace function _messages_effacer_si_supprime_partout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m messages%rowtype;
  v_exp boolean;
  v_dest boolean;
begin
  select * into m from messages where id = new.message_id;
  if m.id is null then return null; end if;

  -- L'expéditeur l'a-t-il supprimé ?
  select exists (
    select 1 from messages_masques k
    where k.message_id = m.id
      and k.utilisateur_type = m.expediteur_type
      and k.utilisateur_username = m.expediteur_username
  ) into v_exp;
  if not v_exp then return null; end if;

  if m.destinataire_type = 'tous' then
    -- Diffusion : effacée quand plus aucun agent ne la garde.
    select not exists (
      select 1 from agents a
      where a.role = 'agent'
        and not exists (
          select 1 from messages_masques k
          where k.message_id = m.id and k.utilisateur_type = 'agent' and k.utilisateur_username = a.username
        )
    ) into v_dest;
  else
    select exists (
      select 1 from messages_masques k
      where k.message_id = m.id
        and k.utilisateur_type = m.destinataire_type
        and k.utilisateur_username = m.destinataire_username
    ) into v_dest;
  end if;

  if v_dest then
    delete from messages where id = m.id;   -- les masquages partent avec (cascade)
  end if;
  return null;
end;
$$;
revoke all on function _messages_effacer_si_supprime_partout() from public, anon, authenticated;

drop trigger if exists messages_effacer_si_supprime_partout on messages_masques;
create trigger messages_effacer_si_supprime_partout
  after insert on messages_masques
  for each row execute function _messages_effacer_si_supprime_partout();

-- Rattrapage : messages directs déjà supprimés des deux côtés avant cette mise à jour.
delete from messages m
where m.destinataire_type <> 'tous'
  and exists (select 1 from messages_masques k where k.message_id = m.id
              and k.utilisateur_type = m.expediteur_type and k.utilisateur_username = m.expediteur_username)
  and exists (select 1 from messages_masques k where k.message_id = m.id
              and k.utilisateur_type = m.destinataire_type and k.utilisateur_username = m.destinataire_username);

-- ----------------------------------------------------------
-- 2. Codes « mot de passe oublié » : effacés dès leur usage
-- ----------------------------------------------------------
alter table password_reset_codes add column if not exists tentatives int not null default 0;

-- Nettoyage immédiat de tout ce qui a déjà servi ou expiré.
delete from password_reset_codes where used or expires_at < now();

create or replace function request_password_reset(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_agent agents%rowtype;
  v_code text;
  v_key text;
  v_from text;
begin
  -- Ménage général : codes expirés de tous les comptes.
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

  -- Les anciens codes de ce compte sont EFFACÉS (plus seulement marqués « utilisés »).
  delete from password_reset_codes where username = p_username;

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
          '<p>Ce code est valable 10 minutes et ne peut servir qu''une seule fois. Si vous n''êtes pas à l''origine de cette demande, ignorez cet e-mail.</p>'
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'email_masque', mask_email(v_agent.email));
end;
$$;

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

  -- Code le plus récent de ce compte.
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

  if v_row.code is distinct from trim(coalesce(p_code, '')) then
    if v_row.tentatives + 1 >= 5 then
      delete from password_reset_codes where username = p_username;
      return jsonb_build_object('ok', false, 'message', 'Trop de codes incorrects : ce code a été annulé. Demandez-en un nouveau.');
    end if;
    update password_reset_codes set tentatives = tentatives + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'message', 'Code invalide.');
  end if;

  update agents set password = crypt(p_nouveau_mdp, gen_salt('bf')) where username = p_username;

  -- Le code a servi : il est effacé de la base, avec tout autre code de ce compte.
  delete from password_reset_codes where username = p_username;
  begin
    delete from login_attempts where username = p_username;   -- déverrouille la connexion
  exception when undefined_table then null; end;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function request_password_reset(text) to anon;
grant execute on function confirm_password_reset(text, text, text) to anon;

-- ----------------------------------------------------------
-- 3. Suivi client (index.html) : informations de retrait d'un colis Retiré
--    Renvoie uniquement ce que le client doit voir : qui a retiré
--    (destinataire ou mandataire), quand, où et quel agent a fait
--    l'opération. Jamais de numéro de CNI ni de téléphone.
-- ----------------------------------------------------------
create or replace function suivi_retrait_info(p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c colis%rowtype;
  t retraits%rowtype;
  v_agent_nom text;
begin
  select * into c from colis where numero_suivi ilike trim(p_numero) limit 1;
  if c.id is null then
    return jsonb_build_object('ok', false);
  end if;
  if c.statut not in ('Retiré', 'Livré') then
    return jsonb_build_object('ok', true, 'retire', false);
  end if;

  select * into t from retraits where colis_id = c.id order by created_at desc limit 1;

  if t.id is not null then
    select nom_complet into v_agent_nom from agents where username = t.agent;
    if v_agent_nom is null then
      begin
        select nom_complet into v_agent_nom from agents_archives where username = t.agent;
      exception when undefined_table then null; end;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'retire', true,
    'numero_suivi', c.numero_suivi,
    'retire_le', coalesce(t.created_at, c.updated_at),
    'agence', coalesce(t.agence, c.ville_arrivee),
    'par_mandataire', coalesce(nullif(trim(t.mandataire_nom), ''), '') <> '',
    'beneficiaire', coalesce(nullif(trim(t.mandataire_nom), ''), c.destinataire_nom),
    'destinataire', c.destinataire_nom,
    'agent', coalesce(v_agent_nom, t.agent)
  );
end;
$$;
grant execute on function suivi_retrait_info(text) to anon, authenticated;

-- Vérifications (ne suppriment rien)
select count(*) as codes_restants from password_reset_codes;
