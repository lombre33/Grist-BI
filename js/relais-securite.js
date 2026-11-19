/*
 * Relais à GFS des appels que la politique de sécurité de la page bloque (règle S8 du guide des apps de GFS, consigne 026, kit 0.25.0 et
 * après ; contrats de GFS 5.4, point 14).
 *
 * Ce fichier est un MODULE ES déclaré par `index.html` (`<script type="module" src="js/relais-securite.js">`), AVANT `js/modules.js` :
 * les modules s'évaluent dans l'ordre de la page, donc le relais écoute avant que le reste ne démarre (une violation d'avant ne serait
 * pas vue). Il est à part de `js/modules.js` pour une raison : si `kit/` manque (sous-module non initialisé, réseau), seul CE module
 * échoue ; `js/modules.js` s'évalue quand même et DuckDB, les fenêtres et l'ambiance gardent leur repli. Il ne fait rien d'autre que
 * l'import, et ne passe pas par `GristBI.loader` : ce n'est pas du code chargé à la demande, c'est une ligne de la page.
 *
 * Ce que fait le kit : quand le widget est hébergé par GFS (`gfs=<n>` dans l'adresse de son cadre), il écoute `securitypolicyviolation`
 * et dit à GFS, sans réponse attendue, ce que la politique d'`index.html` a bloqué : SEUL le nom d'hôte part, jamais le chemin ni les
 * paramètres. Hors de GFS il n'écoute rien et n'envoie rien. Cela INFORME, cela ne PROTÈGE pas : la protection est la politique ; un code
 * piraté peut taire le relais ; un appel que la politique permet (ici toute adresse en `https:` de `connect-src`, pour la pièce jointe que
 * Grist désigne) ne lève aucun événement. `GfsLink` est le même module que celui de `js/modules.js` (même adresse, donc une seule instance).
 */
import '../kit/js/violations-start.js';
