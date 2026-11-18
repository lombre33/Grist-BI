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
 *  - duckdb : le moteur SQL DuckDB-WASM, copie du dépôt (`js/vendor/duckdb/`), chargé au premier gros calcul.
 */
window.GristBI.loader.register({
  'kit-ambiance': () => import('../kit/js/ambiance.js'),
  'kit-gfs-link': () => import('../kit/js/gfs-link.js'),
  'kit-dialogs': () => import('../kit/js/dialogs.js'),
  'duckdb': () => import('./vendor/duckdb/duckdb-browser.mjs')
});
