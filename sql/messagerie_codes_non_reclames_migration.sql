-- ==========================================================
-- COLIGO — Messagerie, codes de récupération, colis non réclamés
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- À lancer APRÈS : messagerie_conservation_migration.sql,
-- reset_password_migration.sql, securite_mots_de_passe_migration.sql,
-- cycle_de_vie_donnees_migration.sql, agents_desactivation_modification_migration.sql
-- et liste_retraits_migration.sql. Peut être relancé sans risque.
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
--   3. COLIS NON RÉCLAMÉS : la liste est conservée ; un colis non réclamé
--      reste 1 an (365 jours, réglable) puis il est supprimé
--      automatiquement, ou manuellement par un administrateur (motif exigé).
--      Ses chiffres restent dans les statistiques archivées (Rapports).
--   4. SUIVI CLIENT : pour un colis retiré, le site affiche seulement les
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
-- 3. Colis non réclamés : conservés 1 an, puis suppression auto ou manuelle
-- ----------------------------------------------------------
alter table retention_settings alter column non_reclames_suppression_jours set default 365;
-- Passe l'ancien délai (90 jours, valeur par défaut précédente) à 1 an.
-- Si vous aviez choisi vous-même une autre durée, elle n'est pas modifiée.
update retention_settings set non_reclames_suppression_jours = 365
where id = 1 and non_reclames_suppression_jours = 90;

-- Moteur du cycle de vie : ajoute la catégorie automatique « non_reclames »
-- et supprime les codes utilisés/expirés sans délai (identique à
-- cycle_de_vie_donnees_migration.sql, mise à jour).
create or replace function _lifecycle_run(
  p_simuler boolean, p_categories text[], p_declencheur text, p_par text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r retention_settings%rowtype;
  d jsonb := '{}'::jsonb;
  n int;
  total int := 0;
  ids text[];
  toutes boolean := p_categories is null;
begin
  select * into r from retention_settings where id = 1;

  -- a) Codes « mot de passe oublié » utilisés ou expirés : supprimés sans délai
  --    (un code utilisé est déjà effacé au moment même de son usage ; ceci
  --    rattrape les codes restés sans usage et arrivés à expiration).
  if toutes or 'codes' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from password_reset_codes
        where used or expires_at < now();
      else
        delete from password_reset_codes
        where used or expires_at < now();
        get diagnostics n = row_count;
      end if;
    exception when undefined_table then n := 0; end;
    d := d || jsonb_build_object('codes', n); total := total + n;
  end if;

  -- b) Compteurs de connexion ratée (verrou terminé depuis X heures, ou jamais verrouillé)
  if toutes or 'tentatives' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from login_attempts
        where locked_until is null or locked_until < now() - make_interval(hours => r.codes_techniques_heures);
      else
        delete from login_attempts
        where locked_until is null or locked_until < now() - make_interval(hours => r.codes_techniques_heures);
        get diagnostics n = row_count;
      end if;
    exception when undefined_table then n := 0; end;
    d := d || jsonb_build_object('tentatives', n); total := total + n;
  end if;

  -- c) Présence « en ligne » restée bloquée (navigateur fermé brutalement)
  if toutes or 'presence' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from agents
        where en_ligne and coalesce(derniere_connexion, 'epoch') < now() - make_interval(hours => r.presence_expiration_heures);
      else
        update agents set en_ligne = false, derniere_deconnexion = now()
        where en_ligne and coalesce(derniere_connexion, 'epoch') < now() - make_interval(hours => r.presence_expiration_heures);
        get diagnostics n = row_count;
      end if;
    exception when undefined_column or undefined_table then n := 0; end;
    d := d || jsonb_build_object('presence', n); total := total + n;
  end if;

  -- d) Anonymisation des retraits (CNI + téléphones masqués, le reste conservé)
  if toutes or 'anonymisation' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from retraits
        where anonymise_le is null
          and created_at < now() - make_interval(days => r.retraits_anonymisation_jours);
      else
        update colis c set
          expediteur_telephone   = _masquer(c.expediteur_telephone),
          destinataire_telephone = _masquer(c.destinataire_telephone)
        from retraits t
        where t.colis_id = c.id and t.anonymise_le is null
          and t.created_at < now() - make_interval(days => r.retraits_anonymisation_jours);

        update retraits set
          destinataire_cni     = _masquer(destinataire_cni),
          mandataire_telephone = _masquer(mandataire_telephone),
          mandataire_cni       = _masquer(mandataire_cni),
          anonymise_le         = now()
        where anonymise_le is null
          and created_at < now() - make_interval(days => r.retraits_anonymisation_jours);
        get diagnostics n = row_count;
      end if;
    exception when undefined_table or undefined_column then n := 0; end;
    d := d || jsonb_build_object('anonymisation', n); total := total + n;
  end if;

  -- e) Colis retirés depuis plus de X jours : archivage statistique puis suppression
  if toutes or 'colis_retires' = any (p_categories) then
    begin
      select coalesce(array_agg(c.id::text), '{}') into ids
      from colis c
      left join lateral (
        select max(t.created_at) as date_retrait from retraits t where t.colis_id = c.id
      ) t on true
      where c.statut in ('Retiré', 'Livré')
        and coalesce(t.date_retrait, c.updated_at, c.created_at)
            < now() - make_interval(days => r.colis_retires_conservation_jours);
    exception when undefined_table then
      select coalesce(array_agg(c.id::text), '{}') into ids
      from colis c
      where c.statut in ('Retiré', 'Livré')
        and coalesce(c.updated_at, c.created_at) < now() - make_interval(days => r.colis_retires_conservation_jours);
    end;
    n := coalesce(array_length(ids, 1), 0);
    if not p_simuler and n > 0 then
      perform _archiver_colis(ids, false);
      n := _supprimer_colis(ids);
    end if;
    d := d || jsonb_build_object('colis_retires', n); total := total + n;
  end if;

  -- f) Listings vides (plus aucun colis rattaché) depuis plus de X jours
  if toutes or 'listings' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from listings l
        where l.created_at < now() - make_interval(days => r.listings_vides_jours)
          and not exists (select 1 from colis c where c.listing_id = l.id);
      else
        delete from listings l
        where l.created_at < now() - make_interval(days => r.listings_vides_jours)
          and not exists (select 1 from colis c where c.listing_id = l.id);
        get diagnostics n = row_count;
      end if;
    exception when undefined_table or undefined_column then n := 0; end;
    d := d || jsonb_build_object('listings', n); total := total + n;
  end if;

  -- g) Messages anciens (les masquages partent avec, par cascade)
  if toutes or 'messages' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from messages
        where created_at < now() - make_interval(days => r.messages_conservation_jours);
      else
        delete from messages
        where created_at < now() - make_interval(days => r.messages_conservation_jours);
        get diagnostics n = row_count;
      end if;
    exception when undefined_table then n := 0; end;
    d := d || jsonb_build_object('messages', n); total := total + n;
  end if;

  -- h) Comptes agents désactivés depuis plus de N jours (défaut 30).
  --    Le compte est supprimé, une fiche est gardée dans agents_archives et
  --    TOUTES ses activités restent (colis, historique, retraits, messages
  --    référencent l'agent par son identifiant, pas par une clé étrangère).
  --    Nécessite sql/agents_desactivation_modification_migration.sql.
  if toutes or 'agents' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from agents
        where actif = false and desactive_le < now() - make_interval(days => r.agents_desactives_suppression_jours);
      else
        insert into agents_archives (agent_id, username, nom_complet, agence, role, fiche, desactive_le, desactive_par, desactive_motif, supprime_le)
        select a.id::text, a.username, a.nom_complet, a.agence, a.role, to_jsonb(a) - 'password', a.desactive_le, a.desactive_par, a.desactive_motif, now()
        from agents a
        where a.actif = false and a.desactive_le < now() - make_interval(days => r.agents_desactives_suppression_jours)
        on conflict (username) do update set supprime_le = excluded.supprime_le;

        delete from agents
        where actif = false and desactive_le < now() - make_interval(days => r.agents_desactives_suppression_jours);
        get diagnostics n = row_count;
      end if;
    exception when undefined_table or undefined_column then n := 0; end;
    d := d || jsonb_build_object('agents', n); total := total + n;
  end if;

  -- i) Journal des nettoyages lui-même
  if toutes or 'journal' = any (p_categories) then
    if p_simuler then
      select count(*) into n from purge_journal
      where executed_at < now() - make_interval(days => r.journal_conservation_jours);
    else
      delete from purge_journal
      where executed_at < now() - make_interval(days => r.journal_conservation_jours);
      get diagnostics n = row_count;
    end if;
    d := d || jsonb_build_object('journal', n); total := total + n;
  end if;

  -- j) Colis non réclamés (« Disponible » jamais retirés) depuis plus de N jours
  --    (défaut 365 = 1 an) : chiffres archivés comme « non réclamés », puis
  --    colis + historique supprimés. Même délai que la suppression manuelle.
  if toutes or 'non_reclames' = any (p_categories) then
    select coalesce(array_agg(c.id::text), '{}') into ids
    from colis c
    where c.statut in ('Disponible', 'Disponible pour retrait')
      and coalesce(c.updated_at, c.created_at) < now() - make_interval(days => r.non_reclames_suppression_jours);
    n := coalesce(array_length(ids, 1), 0);
    if not p_simuler and n > 0 then
      perform _archiver_colis(ids, true);
      n := _supprimer_colis(ids);
    end if;
    d := d || jsonb_build_object('non_reclames', n); total := total + n;
  end if;

  -- Information : colis non réclamés signalés / arrivés au délai de suppression
  select count(*) into n from colis
  where statut in ('Disponible', 'Disponible pour retrait')
    and coalesce(updated_at, created_at) < now() - make_interval(days => r.non_reclames_alerte_jours);
  d := d || jsonb_build_object('non_reclames_alerte', n);

  select count(*) into n from colis
  where statut in ('Disponible', 'Disponible pour retrait')
    and coalesce(updated_at, created_at) < now() - make_interval(days => r.non_reclames_suppression_jours);
  d := d || jsonb_build_object('non_reclames_supprimables', n);

  if not p_simuler then
    insert into purge_journal (declencheur, execute_par, total, details)
    values (p_declencheur, p_par, total, d);
  end if;

  return jsonb_build_object('ok', true, 'simulation', p_simuler, 'total', total, 'details', d);
end;
$$;

create or replace function lifecycle_modifier_regles(
  p_username text, p_password text, p_regles jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_non_rec_alerte int;
  v_non_rec_suppr int;
begin
  if not _verifier_admin(p_username, p_password) then
    return jsonb_build_object('ok', false, 'message', 'Mot de passe administrateur incorrect.');
  end if;

  v_non_rec_alerte := greatest(coalesce((p_regles->>'non_reclames_alerte_jours')::int, 30), 7);
  v_non_rec_suppr  := greatest(coalesce((p_regles->>'non_reclames_suppression_jours')::int, 365), 60, v_non_rec_alerte);

  update retention_settings set
    purge_auto_active                = coalesce((p_regles->>'purge_auto_active')::boolean, purge_auto_active),
    retraits_anonymisation_jours     = greatest(coalesce((p_regles->>'retraits_anonymisation_jours')::int, retraits_anonymisation_jours), 30),
    colis_retires_conservation_jours = greatest(coalesce((p_regles->>'colis_retires_conservation_jours')::int, colis_retires_conservation_jours), 90),
    non_reclames_alerte_jours        = v_non_rec_alerte,
    non_reclames_suppression_jours   = v_non_rec_suppr,
    listings_vides_jours             = greatest(coalesce((p_regles->>'listings_vides_jours')::int, listings_vides_jours), 7),
    messages_conservation_jours      = greatest(coalesce((p_regles->>'messages_conservation_jours')::int, messages_conservation_jours), 30),
    codes_techniques_heures          = greatest(coalesce((p_regles->>'codes_techniques_heures')::int, codes_techniques_heures), 1),
    presence_expiration_heures       = greatest(coalesce((p_regles->>'presence_expiration_heures')::int, presence_expiration_heures), 2),
    journal_conservation_jours       = greatest(coalesce((p_regles->>'journal_conservation_jours')::int, journal_conservation_jours), 180),
    agents_desactives_suppression_jours = greatest(coalesce((p_regles->>'agents_desactives_suppression_jours')::int, agents_desactives_suppression_jours), 7),
    updated_at = now(),
    updated_by = p_username
  where id = 1;

  -- L'anonymisation doit toujours arriver AVANT la suppression.
  update retention_settings
  set retraits_anonymisation_jours = least(retraits_anonymisation_jours, colis_retires_conservation_jours)
  where id = 1;

  insert into purge_journal (declencheur, execute_par, total, details)
  values ('manuel', p_username, 0, jsonb_build_object('regles_modifiees', lifecycle_regles()));

  return jsonb_build_object('ok', true, 'regles', lifecycle_regles());
end;
$$;

create or replace function lifecycle_non_reclames()
returns table (
  id text, numero_suivi text, destinataire_nom text, destinataire_telephone text,
  agence text, ville_arrivee text, disponible_depuis timestamptz, jours int, supprimable boolean
)
language sql
security definer
set search_path = public
as $$
  select c.id::text, c.numero_suivi, c.destinataire_nom, c.destinataire_telephone,
         c.agence, c.ville_arrivee,
         coalesce(c.updated_at, c.created_at) as disponible_depuis,
         floor(extract(epoch from now() - coalesce(c.updated_at, c.created_at)) / 86400)::int as jours,
         coalesce(c.updated_at, c.created_at) < now() - make_interval(days => r.non_reclames_suppression_jours) as supprimable
  from colis c, retention_settings r
  where r.id = 1
    and c.statut in ('Disponible', 'Disponible pour retrait')
    and coalesce(c.updated_at, c.created_at) < now() - make_interval(days => r.non_reclames_alerte_jours)
  order by disponible_depuis asc
  limit 2000;
$$;

revoke all on function _lifecycle_run(boolean, text[], text, text) from public, anon, authenticated;
grant execute on function lifecycle_modifier_regles(text, text, jsonb) to anon, authenticated;
grant execute on function lifecycle_non_reclames() to anon, authenticated;

-- ----------------------------------------------------------
-- 4. Suivi client (index.html) : informations de retrait d'un colis Retiré
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
select non_reclames_alerte_jours, non_reclames_suppression_jours from retention_settings where id = 1;
select count(*) as codes_restants from password_reset_codes;
