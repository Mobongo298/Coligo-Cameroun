-- ==========================================================
-- COLIGO — Diagnostic « e-mail du code non reçu » (lecture seule)
-- À lancer AVANT le correctif si vous voulez voir la cause exacte.
-- ==========================================================

-- 1. Une clé d'envoi est-elle enregistrée ? (vide = aucun e-mail n'a JAMAIS été tenté)
select (resend_api_key is not null and resend_api_key <> '') as cle_resend_presente,
       from_email
from email_settings where id = 1;

-- 2. Réponses réelles de Resend aux anciens envois (pg_net).
--    status_code 403 / 422 = refusé par Resend (cas typique : onboarding@resend.dev
--    n'envoie qu'à l'e-mail du propriétaire du compte Resend). 200 = accepté.
select r.id, r.created, r.status_code, left(r.content::text, 300) as reponse, r.error_msg
from net._http_response r
order by r.id desc
limit 10;

-- 3. Le compte a-t-il bien un e-mail enregistré ?
select username, email from agents order by username;
