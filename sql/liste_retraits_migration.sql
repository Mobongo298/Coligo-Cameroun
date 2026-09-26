-- ==========================================================
-- COLIGO — Liste des retraits (colis au statut « Retiré »)
-- ==========================================================
-- À exécuter dans Supabase > SQL Editor, APRÈS :
--   retraits_migration.sql, cycle_de_vie_donnees_migration.sql et
--   agents_desactivation_modification_migration.sql.
-- Le script peut être relancé sans risque (idempotent). Il ne supprime rien.
--
-- Principe :
--   - Dès qu'un colis passe au statut « Retiré », il apparaît dans la
--     « Liste des retraits » (Admin > Conservation des données, et
--     retrait.html > Historique des colis retirés).
--   - Il peut être supprimé :
--       * manuellement par un agent retrait de l'agence où il a été remis
--         (son mot de passe + un motif), ou par un administrateur ;
--       * automatiquement au bout d'un an (365 jours, règle
--         « Supprimer les colis retirés après » de Conservation des données).
--   - Avant toute suppression, les chiffres du colis (montant, valeur) sont
--     versés dans stats_archive : les Rapports restent justes.
--   - Chaque suppression est inscrite dans le journal des nettoyages.
-- ==========================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------
-- 1. Liste des retraits pour l'administrateur
--    (colis Retiré, date et auteur du retrait, jours restants avant la
--    suppression automatique)
-- ----------------------------------------------------------
create or replace function lifecycle_retraits(p_limite int default 1000)
returns table (
  id text, numero_suivi text, destinataire_nom text, destinataire_telephone text,
  agence text, ville_arrivee text, montant_paye numeric,
  retire_le timestamptz, retire_par_agent text, beneficiaire text,
  jours int, jours_restants int
)
language sql
security definer
set search_path = public
as $$
  select c.id::text, c.numero_suivi, c.destinataire_nom, c.destinataire_telephone,
         c.agence, c.ville_arrivee, c.montant_paye,
         coalesce(t.created_at, c.updated_at, c.created_at) as retire_le,
         t.agent as retire_par_agent,
         case when t.mandataire_nom is not null then t.mandataire_nom || ' (mandataire)'
              else coalesce(c.destinataire_nom, '—') || ' (destinataire)' end as beneficiaire,
         floor(extract(epoch from now() - coalesce(t.created_at, c.updated_at, c.created_at)) / 86400)::int as jours,
         greatest(r.colis_retires_conservation_jours
                  - floor(extract(epoch from now() - coalesce(t.created_at, c.updated_at, c.created_at)) / 86400)::int, 0) as jours_restants
  from colis c
  cross join retention_settings r
  left join lateral (
    select x.created_at, x.agent, x.mandataire_nom
    from retraits x where x.colis_id = c.id
    order by x.created_at desc limit 1
  ) t on true
  where r.id = 1
    and c.statut in ('Retiré', 'Livré')
  order by retire_le desc
  limit least(greatest(coalesce(p_limite, 1000), 1), 5000);
$$;
grant execute on function lifecycle_retraits(int) to anon, authenticated;

-- ----------------------------------------------------------
-- 2. Suppression manuelle d'un colis retiré par un AGENT RETRAIT
--    Conditions :
--      - identifiant + mot de passe de l'agent (compte actif) ;
--      - motif de 5 caractères minimum ;
--      - colis au statut « Retiré » uniquement ;
--      - colis remis par son agence (fiche de retrait de son agence,
--        ou colis à destination de son agence).
-- ----------------------------------------------------------
create or replace function retrait_supprimer_colis(
  p_username text, p_password text, p_colis_id text, p_motif text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v agents%rowtype;
  c colis%rowtype;
  v_agence_ok boolean := false;
begin
  -- Même protection anti-essais répétés que la connexion (5 erreurs = 15 min).
  begin
    if exists (select 1 from login_attempts where username = p_username
               and locked_until is not null and locked_until > now()) then
      return jsonb_build_object('ok', false, 'message', 'Trop de tentatives. Réessayez dans quelques minutes.');
    end if;
  exception when undefined_table then null; end;

  select * into v from agents where username = p_username;
  if v.id is null or v.password is null
     or crypt(coalesce(p_password, ''), v.password) <> v.password then
    begin
      insert into login_attempts (username, failed_count, locked_until)
      values (p_username, 1, null)
      on conflict (username) do update set
        failed_count = login_attempts.failed_count + 1,
        locked_until = case when login_attempts.failed_count + 1 >= 5
                            then now() + interval '15 minutes' else null end;
    exception when undefined_table then null; end;
    return jsonb_build_object('ok', false, 'message', 'Mot de passe incorrect.');
  end if;
  if not coalesce(v.actif, true) then
    return jsonb_build_object('ok', false, 'message', 'Ce compte a été désactivé.');
  end if;
  if p_motif is null or length(trim(p_motif)) < 5 then
    return jsonb_build_object('ok', false, 'message', 'Indiquez un motif (5 caractères minimum).');
  end if;

  select * into c from colis where id::text = p_colis_id;
  if c.id is null then
    return jsonb_build_object('ok', false, 'message', 'Colis introuvable (peut-être déjà supprimé).');
  end if;
  if c.statut not in ('Retiré', 'Livré') then
    return jsonb_build_object('ok', false, 'message', 'Seuls les colis au statut « Retiré » peuvent être supprimés ici.');
  end if;

  if v.role = 'administrateur' then
    v_agence_ok := true;
  else
    begin
      select exists (select 1 from retraits t where t.colis_id = c.id and t.agence = v.agence)
        into v_agence_ok;
    exception when undefined_table then v_agence_ok := false; end;
    v_agence_ok := v_agence_ok or coalesce(c.ville_arrivee = v.agence, false);
  end if;
  if not v_agence_ok then
    return jsonb_build_object('ok', false, 'message', 'Ce colis a été remis par une autre agence : vous ne pouvez pas le supprimer.');
  end if;

  perform _archiver_colis(array[c.id::text], false);
  perform _supprimer_colis(array[c.id::text]);

  insert into purge_journal (declencheur, execute_par, total, details)
  values ('colis', p_username, 1, jsonb_build_object(
    'numero_suivi', c.numero_suivi,
    'statut', c.statut,
    'agence', c.agence,
    'non_reclame', false,
    'par_role', case when v.role = 'administrateur' then 'administrateur' else 'agent retrait' end,
    'motif', trim(p_motif)
  ));

  return jsonb_build_object('ok', true, 'numero_suivi', c.numero_suivi);
end;
$$;
grant execute on function retrait_supprimer_colis(text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------
-- 3. Suppression automatique au bout d'un an : déjà assurée par le cycle de
--    vie (catégorie « colis_retires », 365 jours par défaut). Si la durée a
--    été modifiée auparavant et que vous voulez revenir à 1 an, décommentez :
--
-- update retention_settings set colis_retires_conservation_jours = 365 where id = 1;
-- ----------------------------------------------------------

-- Vérification (ne supprime rien) : les 20 retraits les plus récents.
select numero_suivi, retire_le, retire_par_agent, jours_restants from lifecycle_retraits(20);
