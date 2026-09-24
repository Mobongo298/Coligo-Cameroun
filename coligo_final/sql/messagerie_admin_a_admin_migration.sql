-- ==========================================================
-- COLIGO — messages : un administrateur peut désormais
-- écrire à un autre administrateur (et recevoir sa réponse).
-- ==========================================================
-- À exécuter APRÈS sql/messagerie_migration.sql.
-- SQL Editor > New query > coller > Run.
-- ==========================================================

alter table messages drop constraint if exists messages_destinataire_type_check;
alter table messages add constraint messages_destinataire_type_check
  check (destinataire_type in ('agent', 'admin', 'tous'));

-- Remarque : les messages déjà envoyés par un administrateur avant cette
-- mise à jour ont expediteur_username = NULL (l'application ne
-- l'enregistrait pas encore pour les admins). Ce n'est pas gênant pour la
-- suite : seuls les nouveaux messages ont besoin de ce champ pour que
-- chaque administrateur ne voie que ses propres messages envoyés et sa
-- propre boîte de réception.
