-- ==========================================================
-- COLIGO — Cycle de vie des données (conservation, anonymisation,
-- archivage statistique, suppression automatique ou manuelle)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Idempotent : peut être relancé sans risque.
-- À lancer APRÈS toutes les autres migrations (retraits, listings,
-- messagerie, reset_password, securite_mots_de_passe, presence_agents).
-- Si une de ces tables n'existe pas encore chez vous, l'étape correspondante
-- est simplement ignorée (aucune erreur bloquante).
--
-- LE CYCLE FERMÉ D'UN COLIS
--
--   Enregistré → En transit → Disponible → Retiré        (vie active)
--        │                                   │
--        │                                   ├─ J+90  : anonymisation (CNI, téléphones masqués)
--        │                                   └─ J+365 : les chiffres du colis sont versés dans
--        │                                              stats_archive, puis le colis, son historique
--        │                                              et sa fiche de retrait sont supprimés
--        │
--        └─ Disponible depuis J+30 sans retrait : signalé « non réclamé » à l'admin
--           Disponible depuis J+90                : suppression MANUELLE possible (jamais automatique)
--
-- LES DONNÉES TECHNIQUES
--   Codes « mot de passe oublié »   : supprimés 24 h après expiration / utilisation
--   Compteurs de connexion ratée    : remis à zéro après 24 h
--   Présence « en ligne » fantôme   : remise à « hors ligne » après 12 h sans activité
--   Listings vides                  : supprimés après 30 jours
--   Messages                        : supprimés après 180 jours (masquages supprimés avec)
--   Journal des nettoyages          : conservé 2 ans
--
-- Toutes les durées sont modifiables depuis Admin.html > « Conservation des données »
-- (avec confirmation par mot de passe administrateur). Chaque passage, automatique
-- ou manuel, est inscrit dans le journal `purge_journal`.
-- ==========================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------
-- 1. Règles de conservation (une seule ligne, modifiable par un admin)
-- ----------------------------------------------------------
create table if not exists retention_settings (
  id int primary key default 1,
  purge_auto_active boolean not null default true,
  retraits_anonymisation_jours int not null default 90,
  colis_retires_conservation_jours int not null default 365,
  non_reclames_alerte_jours int not null default 30,
  non_reclames_suppression_jours int not null default 90,
  listings_vides_jours int not null default 30,
  messages_conservation_jours int not null default 180,
  codes_techniques_heures int not null default 24,
  presence_expiration_heures int not null default 12,
  journal_conservation_jours int not null default 730,
  derniere_execution_auto timestamptz,
  updated_at timestamptz default now(),
  updated_by text,
  constraint retention_settings_single_row check (id = 1)
);
insert into retention_settings (id) values (1) on conflict (id) do nothing;
-- Ajouté avec la désactivation des comptes agents (sans effet si déjà présent).
alter table retention_settings add column if not exists agents_desactives_suppression_jours int not null default 30;

alter table retention_settings enable row level security;
-- Aucune politique : lecture via lifecycle_regles(), écriture via
-- lifecycle_modifier_regles() (mot de passe admin exigé).

-- ----------------------------------------------------------
-- 2. Archive statistique : ce qui reste d'un colis après suppression
--    (aucune donnée personnelle, uniquement des totaux par agence et par mois)
-- ----------------------------------------------------------
create table if not exists stats_archive (
  agence text not null,
  annee int not null,
  mois int not null,              -- 1 à 12
  nb_colis int not null default 0,
  montant_total numeric not null default 0,
  valeur_totale numeric not null default 0,
  nb_retires int not null default 0,
  nb_non_reclames int not null default 0,
  updated_at timestamptz default now(),
  primary key (agence, annee, mois)
);
grant select on stats_archive to anon, authenticated;
alter table stats_archive enable row level security;
drop policy if exists stats_archive_lecture on stats_archive;
create policy stats_archive_lecture on stats_archive for select using (true);
revoke insert, update, delete, truncate on stats_archive from anon, authenticated;

-- ----------------------------------------------------------
-- 3. Journal des nettoyages (traçabilité)
-- ----------------------------------------------------------
create table if not exists purge_journal (
  id bigint generated always as identity primary key,
  executed_at timestamptz not null default now(),
  declencheur text not null check (declencheur in ('auto', 'manuel', 'cron', 'colis')),
  execute_par text,
  total int not null default 0,
  details jsonb not null default '{}'::jsonb
);
create index if not exists purge_journal_date_idx on purge_journal (executed_at desc);
alter table purge_journal enable row level security;
revoke all on purge_journal from anon, authenticated;

-- Marqueur d'anonymisation sur les fiches de retrait.
do $$ begin
  alter table retraits add column if not exists anonymise_le timestamptz;
exception when undefined_table then null; end $$;

-- ----------------------------------------------------------
-- 4. Fermeture du cycle : plus aucune suppression directe depuis le site
--    pour les tables métier. Toute suppression passe par les fonctions
--    ci-dessous (règles + journal). La table `retraits` garde le droit de
--    suppression car retrait.js annule une fiche si la mise à jour du
--    statut échoue.
-- ----------------------------------------------------------
do $$ begin
  revoke delete, truncate on colis from anon, authenticated;
  revoke delete, truncate on colis_historique from anon, authenticated;
exception when undefined_table then null; end $$;
do $$ begin
  revoke delete, truncate on listings from anon, authenticated;
exception when undefined_table then null; end $$;

-- ----------------------------------------------------------
-- 5. Outils internes
-- ----------------------------------------------------------
create or replace function _masquer(v text)
returns text language sql immutable as $$
  select case
    when v is null or v = '' then v
    when v like '***%' then v                      -- déjà masqué
    when length(v) <= 3 then '***'
    else '***' || right(v, 3)
  end;
$$;

-- Vérifie qu'un identifiant + mot de passe correspondent à un administrateur.
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
     and v.password is not null
     and crypt(p_password, v.password) = v.password;
end;
$$;
revoke all on function _verifier_admin(text, text) from public, anon, authenticated;

-- Verse un ensemble de colis dans stats_archive AVANT leur suppression.
create or replace function _archiver_colis(p_ids text[], p_non_reclames boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into stats_archive as s (agence, annee, mois, nb_colis, montant_total, valeur_totale, nb_retires, nb_non_reclames)
  select coalesce(nullif(trim(c.agence), ''), 'Inconnue'),
         extract(year from c.created_at)::int,
         extract(month from c.created_at)::int,
         count(*),
         coalesce(sum(c.montant_paye), 0),
         coalesce(sum(c.valeur), 0),
         count(*) filter (where c.statut in ('Retiré', 'Livré')),
         case when p_non_reclames then count(*) else 0 end
  from colis c
  where c.id::text = any (p_ids)
  group by 1, 2, 3
  on conflict (agence, annee, mois) do update set
    nb_colis        = s.nb_colis + excluded.nb_colis,
    montant_total   = s.montant_total + excluded.montant_total,
    valeur_totale   = s.valeur_totale + excluded.valeur_totale,
    nb_retires      = s.nb_retires + excluded.nb_retires,
    nb_non_reclames = s.nb_non_reclames + excluded.nb_non_reclames,
    updated_at      = now();
end;
$$;
revoke all on function _archiver_colis(text[], boolean) from public, anon, authenticated;

-- Supprime proprement un ensemble de colis (historique, retraits, colis).
create or replace function _supprimer_colis(p_ids text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  delete from colis_historique where colis_id::text = any (p_ids);
  begin
    delete from retraits where colis_id::text = any (p_ids);
  exception when undefined_table then null; end;
  delete from colis where id::text = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function _supprimer_colis(text[]) from public, anon, authenticated;

-- ----------------------------------------------------------
-- 6. Moteur du cycle de vie
--    p_simuler = true  → ne touche à rien, renvoie seulement les comptes
--    p_categories      → null = toutes les catégories automatiques
-- ----------------------------------------------------------
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

  -- a) Codes « mot de passe oublié » expirés ou utilisés
  if toutes or 'codes' = any (p_categories) then
    begin
      if p_simuler then
        select count(*) into n from password_reset_codes
        where (used or expires_at < now())
          and created_at < now() - make_interval(hours => r.codes_techniques_heures);
      else
        delete from password_reset_codes
        where (used or expires_at < now())
          and created_at < now() - make_interval(hours => r.codes_techniques_heures);
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

  -- Information seulement (jamais supprimé automatiquement) : colis non réclamés
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
revoke all on function _lifecycle_run(boolean, text[], text, text) from public, anon, authenticated;

-- ----------------------------------------------------------
-- 7. Fonctions appelées par le site
-- ----------------------------------------------------------

-- 7.1 Passage automatique : appelé à l'ouverture des espaces agent / retrait /
--     admin. Ne s'exécute réellement qu'une fois toutes les 20 h, et
--     seulement si la purge automatique est activée.
create or replace function lifecycle_auto()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r retention_settings%rowtype;
begin
  select * into r from retention_settings where id = 1 for update skip locked;
  if r.id is null then
    return jsonb_build_object('ok', true, 'execute', false, 'raison', 'occupé');
  end if;
  if not r.purge_auto_active then
    return jsonb_build_object('ok', true, 'execute', false, 'raison', 'désactivé');
  end if;
  if r.derniere_execution_auto is not null and r.derniere_execution_auto > now() - interval '20 hours' then
    return jsonb_build_object('ok', true, 'execute', false, 'raison', 'déjà fait récemment');
  end if;

  update retention_settings set derniere_execution_auto = now() where id = 1;
  return _lifecycle_run(false, null, 'auto', 'système') || jsonb_build_object('execute', true);
end;
$$;

-- Version pour pg_cron (même chose, marquée « cron » dans le journal).
create or replace function lifecycle_cron()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r retention_settings%rowtype;
begin
  select * into r from retention_settings where id = 1;
  if not r.purge_auto_active then
    return jsonb_build_object('ok', true, 'execute', false, 'raison', 'désactivé');
  end if;
  update retention_settings set derniere_execution_auto = now() where id = 1;
  return _lifecycle_run(false, null, 'cron', 'pg_cron');
end;
$$;
revoke all on function lifecycle_cron() from public, anon, authenticated;

-- Compatibilité : l'ancien nom (appelé par les versions précédentes de
-- retrait.js) déclenche maintenant le cycle complet, avec les mêmes garde-fous.
create or replace function nettoyer_retraits_expires()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform lifecycle_auto();
end;
$$;

-- 7.2 Lecture des règles (aucune donnée sensible)
create or replace function lifecycle_regles()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(r) - 'id' from retention_settings r where id = 1;
$$;

-- 7.3 Aperçu : ce qui partirait si on lançait le nettoyage maintenant
create or replace function lifecycle_apercu()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select _lifecycle_run(true, null, 'manuel', null);
$$;

-- 7.4 Nettoyage manuel (mot de passe administrateur exigé)
create or replace function lifecycle_executer_manuel(
  p_username text, p_password text, p_categories text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _verifier_admin(p_username, p_password) then
    return jsonb_build_object('ok', false, 'message', 'Mot de passe administrateur incorrect.');
  end if;
  if p_categories is null or array_length(p_categories, 1) is null then
    return jsonb_build_object('ok', false, 'message', 'Choisissez au moins une catégorie.');
  end if;
  return _lifecycle_run(false, p_categories, 'manuel', p_username);
end;
$$;

-- 7.5 Modification des règles (mot de passe administrateur exigé).
--     Des planchers empêchent une erreur de saisie de tout effacer.
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
  v_non_rec_suppr  := greatest(coalesce((p_regles->>'non_reclames_suppression_jours')::int, 90), 60, v_non_rec_alerte);

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

-- 7.6 Journal (lecture)
create or replace function lifecycle_journal(p_limite int default 50)
returns setof purge_journal
language sql
security definer
set search_path = public
as $$
  select * from purge_journal order by executed_at desc limit least(greatest(p_limite, 1), 200);
$$;

-- 7.7 Liste des colis non réclamés (Disponible depuis longtemps)
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
  limit 500;
$$;

-- 7.8 Suppression manuelle d'UN colis (mot de passe admin + motif exigés).
--     Autorisée uniquement pour :
--       - un colis Retiré (dossier clos), quelle que soit son ancienneté ;
--       - un colis non réclamé au-delà du délai de suppression.
--     Les colis Enregistré / En transit ne peuvent jamais être supprimés ici.
create or replace function lifecycle_supprimer_colis(
  p_username text, p_password text, p_colis_id text, p_motif text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c colis%rowtype;
  r retention_settings%rowtype;
  v_non_reclame boolean;
begin
  if not _verifier_admin(p_username, p_password) then
    return jsonb_build_object('ok', false, 'message', 'Mot de passe administrateur incorrect.');
  end if;
  if p_motif is null or length(trim(p_motif)) < 5 then
    return jsonb_build_object('ok', false, 'message', 'Indiquez un motif (5 caractères minimum).');
  end if;

  select * into r from retention_settings where id = 1;
  select * into c from colis where id::text = p_colis_id;
  if c.id is null then
    return jsonb_build_object('ok', false, 'message', 'Colis introuvable (peut-être déjà supprimé).');
  end if;

  v_non_reclame := c.statut in ('Disponible', 'Disponible pour retrait')
    and coalesce(c.updated_at, c.created_at) < now() - make_interval(days => r.non_reclames_suppression_jours);

  if not (c.statut in ('Retiré', 'Livré') or v_non_reclame) then
    return jsonb_build_object('ok', false, 'message',
      'Seuls les colis retirés, ou non réclamés depuis plus de ' || r.non_reclames_suppression_jours ||
      ' jours, peuvent être supprimés.');
  end if;

  perform _archiver_colis(array[p_colis_id], v_non_reclame);
  perform _supprimer_colis(array[p_colis_id]);

  insert into purge_journal (declencheur, execute_par, total, details)
  values ('colis', p_username, 1, jsonb_build_object(
    'numero_suivi', c.numero_suivi,
    'statut', c.statut,
    'agence', c.agence,
    'non_reclame', v_non_reclame,
    'motif', trim(p_motif)
  ));

  return jsonb_build_object('ok', true, 'numero_suivi', c.numero_suivi);
end;
$$;

grant execute on function lifecycle_auto() to anon, authenticated;
grant execute on function nettoyer_retraits_expires() to anon, authenticated;
grant execute on function lifecycle_regles() to anon, authenticated;
grant execute on function lifecycle_apercu() to anon, authenticated;
grant execute on function lifecycle_executer_manuel(text, text, text[]) to anon, authenticated;
grant execute on function lifecycle_modifier_regles(text, text, jsonb) to anon, authenticated;
grant execute on function lifecycle_journal(int) to anon, authenticated;
grant execute on function lifecycle_non_reclames() to anon, authenticated;
grant execute on function lifecycle_supprimer_colis(text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------
-- 8. (Recommandé) Passage quotidien garanti, même si personne n'ouvre le site.
--    Supabase : Database > Extensions > activer « pg_cron », puis décommentez :
--
-- select cron.unschedule('nettoyage-retraits-1an');   -- ancienne tâche, si elle existe
-- select cron.schedule('coligo-cycle-de-vie', '0 2 * * *', 'select lifecycle_cron();');
--    (tous les jours à 2 h UTC = 3 h à Yaoundé / Douala)
-- ----------------------------------------------------------

-- Vérification : aperçu de ce qui serait nettoyé aujourd'hui (ne supprime rien).
select lifecycle_apercu();
