-- ==========================================================
-- COLIGO — Désactivation des comptes agents + modification d'un colis
-- ==========================================================
-- À exécuter dans Supabase > SQL Editor, APRÈS :
--   securite_mots_de_passe_migration.sql, invite_code_par_role_migration.sql,
--   presence_agents_migration.sql.
-- Le script peut être relancé sans risque (idempotent).
--
-- Contenu :
--   A. Désactivation / réactivation d'un compte agent (démission, licenciement)
--      - connexion refusée dès la désactivation ;
--      - si le compte n'est pas réactivé sous 30 jours, il est supprimé
--        définitivement (agents_purger_desactives, appelée à l'ouverture de
--        l'espace admin). Une fiche est gardée dans agents_archives et TOUTES ses
--        activités restent (colis, historique, retraits, messages) ;
--      - l'identifiant d'un compte supprimé ne peut pas être réutilisé.
--   B. Correction d'un colis par l'agent après l'enregistrement (erreur de
--      saisie), tant que le colis est « Enregistré » et pas encore sur un
--      listing. Chaque correction est tracée dans colis_modifications.
-- ==========================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------
-- A1. Colonnes de désactivation
-- ----------------------------------------------------------
alter table agents add column if not exists actif boolean not null default true;
alter table agents add column if not exists desactive_le timestamptz;
alter table agents add column if not exists desactive_par text;
alter table agents add column if not exists desactive_motif text;

-- ----------------------------------------------------------
-- A2. Fiches des comptes supprimés définitivement
--     (aucun mot de passe, seulement de quoi afficher « qui était-ce »)
-- ----------------------------------------------------------
create table if not exists agents_archives (
  username text primary key,
  agent_id text,
  nom_complet text,
  agence text,
  role text,
  fiche jsonb,
  desactive_le timestamptz,
  desactive_par text,
  desactive_motif text,
  supprime_le timestamptz not null default now()
);
alter table agents_archives enable row level security;
drop policy if exists agents_archives_lecture on agents_archives;
create policy agents_archives_lecture on agents_archives for select using (true);
grant select on agents_archives to anon, authenticated;
revoke insert, update, delete, truncate on agents_archives from anon, authenticated;

-- ----------------------------------------------------------
-- A3. Le site ne peut plus modifier que l'e-mail et la présence d'un compte.
--     Avant, la clé publique permettait de changer n'importe quelle colonne
--     (rôle, agence… et bientôt « actif ») : un agent désactivé aurait pu se
--     réactiver lui-même. Toute autre modification passe par les fonctions.
-- ----------------------------------------------------------
revoke update on agents from anon, authenticated;
do $$ begin
  execute 'grant update (email, en_ligne, derniere_connexion, derniere_deconnexion) on agents to anon, authenticated';
exception when undefined_column then
  -- presence_agents_migration.sql pas encore exécutée : seul l'e-mail reste modifiable.
  execute 'grant update (email) on agents to anon, authenticated';
end $$;

-- ----------------------------------------------------------
-- A4. Vérification administrateur (mot de passe vérifié dans la base)
-- ----------------------------------------------------------
create or replace function _verifier_admin(p_username text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v agents%rowtype;
begin
  select * into v from agents where username = p_username;
  return v.id is not null
     and v.role = 'administrateur'
     -- compte désactivé refusé (lu via jsonb : fonctionne même avant l'ajout de la colonne « actif »)
     and coalesce((to_jsonb(v)->>'actif')::boolean, true)
     and v.password is not null
     and crypt(p_password, v.password) = v.password;
end;
$$;
revoke all on function _verifier_admin(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------
-- A5. Connexion : refuse un compte désactivé
--     (même logique anti brute-force que securite_mots_de_passe_migration.sql)
-- ----------------------------------------------------------
create or replace function agent_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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

  -- Le mot de passe est juste, mais le compte est suspendu.
  if not coalesce(v_agent.actif, true) then
    return jsonb_build_object('ok', false, 'desactive', true,
      'message', 'Ce compte a été désactivé par un administrateur. Contactez votre responsable.');
  end if;

  return jsonb_build_object('ok', true, 'agent', to_jsonb(v_agent) - 'password');
end;
$$;
grant execute on function agent_login(text, text) to anon, authenticated;

-- ----------------------------------------------------------
-- A6. Inscription : un identifiant supprimé ne peut pas être réutilisé
--     (sinon l'historique d'un ancien agent serait attribué au nouveau)
-- ----------------------------------------------------------
create or replace function agent_signup(
  p_nom text, p_agence text, p_role text,
  p_username text, p_email text, p_password text, p_invite text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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

  if exists (select 1 from agents where username = p_username)
     or exists (select 1 from agents_archives where username = p_username) then
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
grant execute on function agent_signup(text, text, text, text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------
-- A7. Désactiver / réactiver (mot de passe administrateur exigé)
-- ----------------------------------------------------------
create or replace function agent_desactiver(
  p_admin text, p_password text, p_agent_id text, p_motif text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v agents%rowtype;
  v_jours int := 30;
begin
  if not _verifier_admin(p_admin, p_password) then
    return jsonb_build_object('ok', false, 'message', 'Mot de passe administrateur incorrect.');
  end if;

  select * into v from agents where id::text = p_agent_id;
  if v.id is null then
    return jsonb_build_object('ok', false, 'message', 'Compte introuvable.');
  end if;
  if v.role = 'administrateur' then
    return jsonb_build_object('ok', false, 'message', 'Un compte administrateur ne peut pas être désactivé depuis cet écran.');
  end if;
  if not coalesce(v.actif, true) then
    return jsonb_build_object('ok', false, 'message', 'Ce compte est déjà désactivé.');
  end if;
  if coalesce(trim(p_motif), '') = '' then
    return jsonb_build_object('ok', false, 'message', 'Indiquez le motif (démission, licenciement…).');
  end if;

  update agents set
    actif = false,
    desactive_le = now(),
    desactive_par = p_admin,
    desactive_motif = left(trim(p_motif), 200)
  where id = v.id;

  -- Le compte est aussitôt affiché hors ligne (la session ouverte est
  -- coupée par le site à sa prochaine vérification).
  begin
    update agents set en_ligne = false, derniere_deconnexion = now() where id = v.id and en_ligne;
  exception when undefined_column then null; end;


  return jsonb_build_object('ok', true,
    'suppression_prevue', now() + make_interval(days => coalesce(v_jours, 30)));
end;
$$;

create or replace function agent_reactiver(
  p_admin text, p_password text, p_agent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v agents%rowtype;
begin
  if not _verifier_admin(p_admin, p_password) then
    return jsonb_build_object('ok', false, 'message', 'Mot de passe administrateur incorrect.');
  end if;

  select * into v from agents where id::text = p_agent_id;
  if v.id is null then
    return jsonb_build_object('ok', false, 'message', 'Compte introuvable (peut-être déjà supprimé définitivement).');
  end if;
  if coalesce(v.actif, true) then
    return jsonb_build_object('ok', false, 'message', 'Ce compte est déjà actif.');
  end if;

  update agents set actif = true, desactive_le = null, desactive_par = null, desactive_motif = null
  where id = v.id;


  return jsonb_build_object('ok', true);
end;
$$;

-- Vérifié régulièrement par agent.html et retrait.html : coupe la session
-- d'un agent désactivé (ou supprimé) même s'il était déjà connecté.
create or replace function agent_compte_actif(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(actif, true) from agents where username = p_username), false);
$$;

grant execute on function agent_desactiver(text, text, text, text) to anon, authenticated;
grant execute on function agent_reactiver(text, text, text) to anon, authenticated;
grant execute on function agent_compte_actif(text) to anon, authenticated;

-- ----------------------------------------------------------
-- A8. Suppression définitive des comptes désactivés depuis 30 jours
--     Appelée silencieusement à l'ouverture de l'espace administrateur.
--     Une fiche résumée est gardée dans agents_archives ; toutes les
--     activités de l'agent (colis, historique, retraits, messages) restent.
-- ----------------------------------------------------------
create or replace function agents_purger_desactives()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  insert into agents_archives (agent_id, username, nom_complet, agence, role, fiche, desactive_le, desactive_par, desactive_motif, supprime_le)
  select a.id::text, a.username, a.nom_complet, a.agence, a.role, to_jsonb(a) - 'password', a.desactive_le, a.desactive_par, a.desactive_motif, now()
  from agents a
  where a.actif = false and a.desactive_le < now() - interval '30 days'
  on conflict (username) do update set supprime_le = excluded.supprime_le;

  delete from agents where actif = false and desactive_le < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function agents_purger_desactives() to anon, authenticated;

-- ----------------------------------------------------------
-- B1. Journal des corrections de colis
-- ----------------------------------------------------------
create table if not exists colis_modifications (
  id bigserial primary key,
  colis_id text not null,
  numero_suivi text,
  agent text not null,
  avant jsonb not null,
  apres jsonb not null,
  motif text,
  modifie_le timestamptz not null default now()
);
create index if not exists colis_modifications_colis_idx on colis_modifications (colis_id);
alter table colis_modifications enable row level security;
drop policy if exists colis_modifications_lecture on colis_modifications;
create policy colis_modifications_lecture on colis_modifications for select using (true);
grant select on colis_modifications to anon, authenticated;
revoke insert, update, delete, truncate on colis_modifications from anon, authenticated;

-- ----------------------------------------------------------
-- B2. Correction d'un colis par l'agent
--     Autorisé seulement si :
--       - le compte est un agent actif de la même agence que le colis ;
--       - le colis est encore « Enregistré » et n'est sur aucun listing
--         (une fois parti, le reçu et le listing imprimés font foi).
--     La valeur déclarée est recalculée (10 × montant payé).
-- ----------------------------------------------------------
create or replace function colis_modifier(
  p_username text, p_colis_id text, p_champs jsonb, p_motif text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a agents%rowtype;
  c colis%rowtype;
  v_exp text := trim(coalesce(p_champs->>'expediteur_nom', ''));
  v_exp_tel text := trim(coalesce(p_champs->>'expediteur_telephone', ''));
  v_dest text := trim(coalesce(p_champs->>'destinataire_nom', ''));
  v_dest_tel text := trim(coalesce(p_champs->>'destinataire_telephone', ''));
  v_desc text := trim(coalesce(p_champs->>'Description_du_colis', ''));
  v_montant numeric;
  v_avant jsonb := '{}'::jsonb;
  v_apres jsonb := '{}'::jsonb;
  v_listing text;
begin
  select * into a from agents where username = p_username;
  if a.id is null or not coalesce(a.actif, true) then
    return jsonb_build_object('ok', false, 'message', 'Compte agent introuvable ou désactivé.');
  end if;

  select * into c from colis where id::text = p_colis_id for update;
  if c.id is null then
    return jsonb_build_object('ok', false, 'message', 'Colis introuvable.');
  end if;

  if lower(trim(coalesce(c.agence, ''))) <> lower(trim(coalesce(a.agence, '')))
     and coalesce(c.cree_par, '') <> a.username then
    return jsonb_build_object('ok', false, 'message', 'Ce colis appartient à une autre agence.');
  end if;

  if c.statut <> 'Enregistré' then
    return jsonb_build_object('ok', false, 'message', 'Seul un colis encore « Enregistré » peut être corrigé. Celui-ci est « ' || c.statut || ' ».');
  end if;

  begin
    execute 'select listing_id::text from colis where id = $1' into v_listing using c.id;
  exception when undefined_column then v_listing := null; end;
  if v_listing is not null then
    return jsonb_build_object('ok', false, 'message', 'Ce colis est déjà sur un listing : la correction n''est plus possible.');
  end if;

  begin
    v_montant := (p_champs->>'montant_paye')::numeric;
  exception when others then v_montant := null; end;

  if v_exp = '' or v_dest = '' or v_desc = '' or v_montant is null or v_montant < 0 then
    return jsonb_build_object('ok', false, 'message', 'Complétez l''expéditeur, le destinataire, la description et un montant valide.');
  end if;

  -- Ne garde que ce qui change réellement.
  if v_exp is distinct from c.expediteur_nom then
    v_avant := v_avant || jsonb_build_object('expediteur_nom', c.expediteur_nom);
    v_apres := v_apres || jsonb_build_object('expediteur_nom', v_exp);
  end if;
  if v_exp_tel is distinct from coalesce(c.expediteur_telephone, '') then
    v_avant := v_avant || jsonb_build_object('expediteur_telephone', c.expediteur_telephone);
    v_apres := v_apres || jsonb_build_object('expediteur_telephone', v_exp_tel);
  end if;
  if v_dest is distinct from c.destinataire_nom then
    v_avant := v_avant || jsonb_build_object('destinataire_nom', c.destinataire_nom);
    v_apres := v_apres || jsonb_build_object('destinataire_nom', v_dest);
  end if;
  if v_dest_tel is distinct from coalesce(c.destinataire_telephone, '') then
    v_avant := v_avant || jsonb_build_object('destinataire_telephone', c.destinataire_telephone);
    v_apres := v_apres || jsonb_build_object('destinataire_telephone', v_dest_tel);
  end if;
  if v_desc is distinct from coalesce(c."Description_du_colis", '') then
    v_avant := v_avant || jsonb_build_object('Description_du_colis', c."Description_du_colis");
    v_apres := v_apres || jsonb_build_object('Description_du_colis', v_desc);
  end if;
  if v_montant is distinct from c.montant_paye then
    v_avant := v_avant || jsonb_build_object('montant_paye', c.montant_paye, 'valeur', c.valeur);
    v_apres := v_apres || jsonb_build_object('montant_paye', v_montant, 'valeur', v_montant * 10);
  end if;

  if v_apres = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'message', 'Aucune modification à enregistrer.');
  end if;

  update colis set
    expediteur_nom = v_exp,
    expediteur_telephone = v_exp_tel,
    destinataire_nom = v_dest,
    destinataire_telephone = v_dest_tel,
    "Description_du_colis" = v_desc,
    montant_paye = v_montant,
    valeur = v_montant * 10
  where id = c.id;

  insert into colis_modifications (colis_id, numero_suivi, agent, avant, apres, motif)
  values (c.id::text, c.numero_suivi, a.username, v_avant, v_apres, nullif(left(trim(coalesce(p_motif, '')), 200), ''));

  return jsonb_build_object('ok', true,
    'colis', (select to_jsonb(x) from colis x where x.id = c.id),
    'champs', (select array_agg(k) from jsonb_object_keys(v_apres) k));
end;
$$;
grant execute on function colis_modifier(text, text, jsonb, text) to anon, authenticated;

-- Vérification rapide (ne modifie rien)
select username, role, actif from agents order by role, username;
