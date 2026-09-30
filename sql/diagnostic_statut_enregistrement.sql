-- ==========================================================
-- COLIGO — Diagnostic : statut incorrect à l'enregistrement
-- ==========================================================
-- Le code de l'application enregistre explicitement chaque nouveau colis
-- avec statut = 'Enregistré'. Si vous voyez "En transit" dès la création,
-- la cause est très probablement une valeur par défaut ou un déclencheur
-- (trigger) resté sur la table depuis une version antérieure du projet.
--
-- ÉTAPE 1 — Copiez-collez ces 2 requêtes dans Supabase SQL Editor et
-- regardez ce qu'elles renvoient (partagez-moi le résultat si besoin) :

select column_name, column_default, is_nullable
from information_schema.columns
where table_name = 'colis' and column_name = 'statut';

select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where event_object_table = 'colis';

-- ÉTAPE 2 — Si la première requête montre autre chose que
-- column_default = NULL (ou 'Enregistré'::text), exécutez ceci pour
-- forcer la bonne valeur par défaut (sans danger, ne touche aucune
-- donnée existante) :

alter table colis alter column statut set default 'Enregistré';

-- ÉTAPE 3 — Vérification : les 10 derniers colis, avec leur statut réel
-- en base (indépendamment de ce que l'écran affiche) :

select numero_suivi, statut, created_at
from colis
order by created_at desc
limit 10;
