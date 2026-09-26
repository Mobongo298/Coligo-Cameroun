// Enregistrement du service worker — rend chaque page installable
// et disponible hors-ligne pour sa "coquille" (apparence de l'app).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Echec silencieux : l'app continue de fonctionner normalement
      // en mode "site web classique" si le service worker est refusé.
    });
  });
}
