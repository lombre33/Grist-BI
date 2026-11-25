/*
 * Les modules ES que le widget peut charger, nommés ICI et nulle part ailleurs (audit `gwaudit`
 * C-EXFIL-06 ; voir js/loader.js pour le pourquoi). Ce fichier est un MODULE ES déclaré par
 * `index.html` (`<script type="module" src="js/modules.js">`) : un `import()` écrit dans un module se
 * résout par rapport à CE fichier, y compris dans le cadre isolé de GFS (origine opaque), où le même
 * `import()` écrit dans un script classique n'a pas d'adresse de base.
 *
 * Chaque entrée est un chemin LITTÉRAL : ajouter un module = une ligne ici, relue en revue ; aucune
 * adresse n'est construite à l'exécution et `GristBI.loader.module('autre chose')` est refusé. Les
 * modules ne sont chargés qu'à la demande (rien ici ne s'exécute au démarrage hors l'enregistrement).
 *
 *  - kit-ambiance, kit-gfs-link, kit-dialogs : le kit commun des apps Grist Factory (sous-module Git `kit/`).
 *  - kit-names-update, kit-i18n : la fenêtre commune de mise à jour des noms (consigne GFS 030) et la langue du kit (la même instance que celle des fenêtres :
 *    un module n'existe qu'une fois par adresse), chargées seulement quand un renommage est à proposer (js/main-session.js:runNamesUpdate).
 *  - duckdb : le moteur SQL DuckDB-WASM, copie du dépôt (`js/vendor/duckdb/`), chargé au premier gros calcul.
 */
window.GristBI.loader.register({
  'kit-ambiance': () => import('../kit/js/ambiance.js'),
  'kit-gfs-link': () => import('../kit/js/gfs-link.js'),
  'kit-dialogs': () => import('../kit/js/dialogs.js'),
  'kit-names-update': () => import('../kit/js/names-update/index.js'),
  'kit-i18n': () => import('../kit/js/i18n.js'),
  'duckdb': () => import('./vendor/duckdb/duckdb-browser.mjs')
});
