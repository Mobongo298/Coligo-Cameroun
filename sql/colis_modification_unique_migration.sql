-- ==========================================================
-- COLIGO — Modification d'un colis : UNE SEULE fois + alerte temps réel admin
-- ==========================================================
-- À exécuter dans Supabase > SQL Editor, APRÈS
-- agents_desactivation_modification_migration.sql et activer_realtime.sql.
-- Peut être relancé sans risque (idempotent).
--
--   1. colis_modifier : un colis ne peut être corrigé qu'UNE SEULE fois et la
--      raison est obligatoire (contrôle fait dans la base, pas seulement
--      dans l'écran).
--   2. colis_modifications est ajoutée à la diffusion temps réel : l'espace
--      administrateur reçoit la correction (avec sa raison) à l'instant même.
-- ==========================================================

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
  v_motif text := nullif(left(trim(coalesce(p_motif, '')), 200), '');
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

  -- Une seule correction par colis.
  if exists (select 1 from colis_modifications where colis_id = c.id::text) then
    return jsonb_build_object('ok', false, 'message', 'Ce colis a déjà été modifié une fois : aucune autre modification n''est possible.');
  end if;

  -- La raison est obligatoire : elle est transmise à l'administrateur.
  if v_motif is null then
    return jsonb_build_object('ok', false, 'message', 'Indiquez la raison de la modification.');
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
  values (c.id::text, c.numero_suivi, a.username, v_avant, v_apres, v_motif);

  return jsonb_build_object('ok', true,
    'colis', (select to_jsonb(x) from colis x where x.id = c.id),
    'champs', (select array_agg(k) from jsonb_object_keys(v_apres) k));
end;
$$;
grant execute on function colis_modifier(text, text, jsonb, text) to anon, authenticated;

-- Temps réel (sans erreur si déjà activé)
do $$ begin
  alter publication supabase_realtime add table colis_modifications;
exception when duplicate_object then null;
end $$;

-- Vérification : colis_modifications doit apparaître ici.
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by tablename;
