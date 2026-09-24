// ==========================================================
// CONFIGURATION — à remplir une seule fois
// ==========================================================
// 1. Va sur https://supabase.com, crée un compte et un projet gratuit.
// 2. Dans le projet : Settings (Paramètres) > API.
// 3. Copie "Project URL" et colle-la ci-dessous à la place de SUPABASE_URL.
// 4. Copie la clé "anon public" et colle-la à la place de SUPABASE_ANON_KEY.
// 5. Enregistre ce fichier. Ne touche à rien d'autre.
// ==========================================================

const SUPABASE_URL = "https://gloockvvwlllcqxfftbv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdsb29ja3Z2d2xsbGNxeGZmdGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMjA2MzYsImV4cCI6MjEwNDg5NjYzNn0.MTlILCvQ74SQjG7ZaDRQGpnJVchSdYOp32vzTudY1sU";

// Le code d'invitation n'est plus stocké ici (un fichier .js est visible par
// n'importe qui). Il vit maintenant dans la base de données, change après
// chaque utilisation, et n'est affiché que sur le tableau de bord admin.
// Voir sql/invite_code_migration.sql.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================================
// Vérification de rôle (agent / administrateur)
//
// Chaque compte de la table `agents` a un champ `role` qui vaut soit
// 'agent' soit 'administrateur'. agent.html et Admin.html appellent
// enforceRole() juste après une connexion (ou une reprise de session)
// pour garantir qu'un administrateur atterrit toujours sur Admin.html
// et qu'un agent atterrit toujours sur agent.html — même s'il s'est
// connecté depuis la mauvaise page.
// ==========================================================

const ROLE_PAGES = {
  agent: 'agent.html',
  administrateur: 'Admin.html'
};

function redirectToOwnSpace(agent) {
  const target = ROLE_PAGES[agent && agent.role] || ROLE_PAGES.agent;
  window.location.href = target;
}

// Retourne true si le rôle correspond à la page actuelle.
// Sinon, redirige automatiquement vers le bon espace et retourne false.
function enforceRole(agent, expectedRole) {
  if (!agent || agent.role !== expectedRole) {
    redirectToOwnSpace(agent);
    return false;
  }
  return true;
}
