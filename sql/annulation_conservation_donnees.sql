-- ==========================================================
-- COLIGO — ANNULATION de « Conservation des données » (cycle de vie)
-- ==========================================================
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être lancé même si les scripts du cycle de vie n'ont jamais été
-- exécutés, et peut être relancé sans risque.
--
-- Ce script retire tout ce qu'avaient ajouté :
--   - sql/cycle_de_vie_donnees_migration.sql
--   - sql/liste_retraits_migration.sql
--   - la partie « colis non réclamés » de
--     sql/messagerie_codes_non_reclames_migration.sql
-- c'est-à-dire : règles de conservation, journal des nettoyages, nettoyage
-- automatique (colis retirés, non réclamés, listings vides, messages,
-- anonymisation des retraits), suppression d'un colis par l'admin ou par
-- l'agent retrait, et la tâche planifiée pg_cron si elle avait été créée.
--
-- Il remet le fonctionnement d'origine : les colis retirés depuis plus
-- d'un an sont supprimés à l'ouverture de l'espace Retraits
-- (fonction nettoyer_retraits_expires, comme avant).
--
-- Ce qui est GARDÉ (fonctionnalités indépendantes) :
--   - désactivation des agents, avec suppression du compte après 30 jours
--     (nouvelle petite fonction agents_purger_desactives ci-dessous) ;
--   - suppression des messages par chacun dans sa messagerie ;
--   - effacement des codes « mot de passe oublié » après usage ;
--   - informations de retrait sur le suivi client.
--
-- IMPORTANT : ce qui a déjà été supprimé ou masqué par le cycle de vie
-- (colis effacés, CNI/téléphones masqués en ***) ne peut pas être
-- restauré par ce script. Seule une sauvegarde Supabase le permettrait.
-- ==========================================================

-- 1. Tâche planifiée (si pg_cron avait été activé)
do $$ begin
  perform cron.unschedule('coligo-cycle-de-vie');
exception when others then null; end $$;

-- 2. Fonctions du cycle de vie et de la liste des retraits
drop function if exists lifecycle_auto();
drop function if exists lifecycle_cron();
drop function if exists lifecycle_regles();
drop function if exists lifecycle_apercu();
drop function if exists lifecycle_executer_manuel(text, text, text[]);
drop function if exists lifecycle_modifier_regles(text, text, jsonb);
drop function if exists lifecycle_journal(int);
drop function if exists lifecycle_non_reclames();
drop function if exists lifecycle_supprimer_colis(text, text, text, text);
drop function if exists lifecycle_retraits(int);
drop function if exists retrait_supprimer_colis(text, text, text, text);
drop function if exists _lifecycle_run(boolean, text[], text, text);
drop function if exists _archiver_colis(text[], boolean);
drop function if exists _supprimer_colis(text[]);
drop function if exists _masquer(text);
-- _verifier_admin est conservée : la désactivation des agents et la
-- modification des colis s'en servent.

-- 3. Tables du cycle de vie
drop table if exists retention_settings;
drop table if exists purge_journal;

-- stats_archive contient les totaux (nombre de colis, montants) des colis
-- déjà supprimés. Elle n'est effacée que si elle est vide, pour ne pas
-- fausser vos Rapports. Pour la supprimer quand même, lancez à part :
--   drop table if exists stats_archive;
do $$ begin
  if to_regclass('public.stats_archive') is not null
     and not exists (select 1 from stats_archive) then
    drop table stats_archive;
  end if;
end $$;

-- 4. Marqueur d'anonymisation ajouté sur les fiches de retrait
alter table if exists retraits drop column if exists anonymise_le;

-- 5. Retour au nettoyage d'origine : colis retirés depuis plus d'un an
create or replace function nettoyer_retraits_expires()
returns void
language plpgsql
security definer
as $$
declare
  seuil timestamptz := now() - interval '1 year';
begin
  -- Historique des statuts des colis concernés.
  delete from colis_historique
  where colis_id in (select colis_id from retraits where created_at < seuil);

  -- Le colis lui-même (supprime aussi sa fiche de retrait si votre
  -- contrainte "on delete cascade" est active — sinon la ligne suivante
  -- s'en charge de toute façon).
  delete from colis
  where id in (select colis_id from retraits where created_at < seuil);

  -- Sécurité : au cas où la fiche de retrait n'aurait pas été supprimée
  -- automatiquement ci-dessus.
  delete from retraits where created_at < seuil;
end;
$$;

grant execute on function nettoyer_retraits_expires() to anon;

-- 6. Comptes agents désactivés : suppression après 30 jours, sans le cycle de vie
do $$ begin
  if to_regclass('public.agents_archives') is null then
    raise notice 'agents_archives absente : exécutez sql/agents_desactivation_modification_migration.sql pour la désactivation des agents.';
  end if;
end $$;

-- ----------------------------------------------------------
-- Suppression définitive des comptes désactivés depuis 30 jours
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

-- Vérification (ne supprime rien) : doit renvoyer 0 ligne.
select proname from pg_proc
where proname like 'lifecycle%' or proname in ('retrait_supprimer_colis', '_lifecycle_run', '_archiver_colis', '_supprimer_colis');
