/*
  Service worker COLIGO — mode "coquille d'app".
  Rôle : mettre en cache l'apparence de l'app (HTML/CSS/JS/logos)
  pour qu'elle s'ouvre instantanément, même avec une connexion faible.
  Les données (colis, comptes, messages) passent TOUJOURS par le
  réseau vers Supabase : rien de ça n'est mis en cache ici, pour ne
  jamais afficher d'information périmée ou fausse.
*/

const CACHE_NAME = "coligo-shell-v2";

const SHELL_FILES = [
  "./index.html",
  "./hub.html",
  "./agent.html",
  "./Admin.html",
  "./retrait.html",
  "./signup.html",
  "./css/theme.css",
  "./css/auth.css",
  "./css/admin.css",
  "./js/config.js",
  "./js/ui-helpers.js",
  "./js/client.js",
  "./js/agent.js",
  "./js/admin.js",
  "./js/retrait.js",
  "./js/signup.js",
  "./js/messagerie.js",
  "./js/meteo.js",
  "./js/rapports.js",
  "./js/receipt.js",
  "./js/listing-detail.js",
  "./js/reset-password.js",
  "./assets/logo-coligo.png",
  "./assets/logo-coligo-blanc.png",
  "./assets/favicon-coligo.png",
  "./assets/bus-vip-confort-fond.jpg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_FILES.map((f) => cache.add(f)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // On ne touche jamais aux appels vers Supabase (données en direct).
  if (req.url.includes("supabase.co") || req.url.includes("supabase.io")) {
    return;
  }
  // Seules les requêtes GET peuvent être mises en cache.
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && req.url.startsWith(self.location.origin)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
