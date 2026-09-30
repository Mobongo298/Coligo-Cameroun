-- ==========================================================
-- COLIGO — passage à 3 statuts
-- ==========================================================
-- Le système n'utilise plus que : Enregistré, En transit, Disponible.
--
-- Les colis déjà en base peuvent encore porter les anciens statuts.
-- L'application les affiche correctement sans rien faire (conversion
-- automatique à l'écran), donc ce script est FACULTATIF : exécutez-le
-- seulement si vous voulez nettoyer définitivement la base.
--
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run.
-- ==========================================================

update colis set statut = 'En transit'
  where statut in ('Pris en charge', 'Arrivé à destination');

update colis set statut = 'Disponible'
  where statut in ('Disponible pour retrait', 'Livré');

-- Même conversion dans l'historique des actions.
update colis_historique set statut = 'En transit'
  where statut in ('Pris en charge', 'Arrivé à destination');

update colis_historique set statut = 'Disponible'
  where statut in ('Disponible pour retrait', 'Livré');

-- Vérification : doit ne renvoyer que les 3 statuts actuels.
select statut, count(*) from colis group by statut order by statut;
