/* Bouton « Installer l'application » — visible uniquement sur téléphone, jamais une fois installée.
   Android : installation en un clic (beforeinstallprompt). iPhone : mini-guide (Apple n'autorise pas mieux). */
(function () {
  var ua = navigator.userAgent || '';
  var estTel = /Android.+Mobile|iPhone|iPod/i.test(ua) && Math.min(screen.width, screen.height) <= 820;
  var installee = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!estTel || installee) return;
  try { if (sessionStorage.getItem('coligo-install-ferme')) return; } catch (e) {}

  var ios = /iPhone|iPod/i.test(ua), pasSafari = /CriOS|FxiOS|EdgiOS/i.test(ua), invite = null, barre;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); invite = e; });
  window.addEventListener('appinstalled', function () { if (barre) barre.remove(); });

  function el(tag, css, txt) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (txt) n.textContent = txt; return n; }

  function monter() {
    barre = el('div', 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#0B1F3A;color:#fff;padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));box-shadow:0 -4px 18px rgba(0,0,0,.3);font-family:inherit');
    var aide = el('div', 'display:none;font-size:15px;line-height:1.45;margin-bottom:10px');
    var ligne = el('div', 'display:flex;gap:10px;align-items:center');
    var bouton = el('button', 'flex:1;min-height:56px;border:0;border-radius:12px;background:#fff;color:#0B1F3A;font-size:17px;font-weight:700', "Installer l'application");
    var fermer = el('button', 'min-width:48px;min-height:56px;border:0;background:transparent;color:#fff;font-size:26px', '×');
    fermer.setAttribute('aria-label', 'Fermer');
    ligne.appendChild(bouton); ligne.appendChild(fermer); barre.appendChild(aide); barre.appendChild(ligne);
    document.body.appendChild(barre);

    bouton.addEventListener('click', function () {
      if (invite) { invite.prompt(); invite = null; return; }
      aide.textContent = ios
        ? (pasSafari ? "Ouvrez cette page dans Safari, puis appuyez sur Partager → « Sur l'écran d'accueil »."
                     : "Appuyez sur Partager (le carré avec une flèche), puis sur « Sur l'écran d'accueil ».")
        : "Ouvrez le menu ⋮ du navigateur, puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».";
      aide.style.display = 'block';
    });
    fermer.addEventListener('click', function () {
      try { sessionStorage.setItem('coligo-install-ferme', '1'); } catch (e) {}
      barre.remove();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
