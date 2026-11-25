#!/bin/sh
# Tous les essais du dépôt, dans l'ordre : les dix-neuf essais Node (dont test-advice, test-advice-insights, test-advice-types, test-advice-types-time-grid, test-advice-complete, test-advice-column, test-advice-join, test-advice-pages, test-graphique et test-graphique-dessin, le module js/graphique/), puis les deux essais dans un vrai navigateur (dev-tests/test-browser.js, dev-tests/test-graphique-navigateur.js).
# À LANCER AVANT TOUTE FUSION ET AVANT TOUT ENVOI VERS UN DÉPÔT PUBLIÉ (GitHub Pages) : sh dev-tests/run-all.sh
# Sortie 0 = tout passe ; au premier échec, le script s'arrête et le dit. Playwright + Chromium sont requis pour le dernier essai
# (NODE_PATH est pris sur `npm root -g` s'il n'est pas déjà posé) ; leur absence est un ÉCHEC, jamais un essai « sauté ».
set -e
cd "$(dirname "$0")/.."
for t in test-data test-styles test-layouts test-safe-html test-loader test-csp test-audit test-internal-pages test-config-names test-advice test-advice-insights test-advice-types test-advice-types-time-grid test-advice-complete test-advice-column test-advice-join test-advice-pages test-graphique test-graphique-dessin; do
  echo "== $t"
  node "dev-tests/$t.js"
done
echo "== test-browser (Chromium : le vrai index.html, sa politique de sécurité, un grist-plugin-api qui passe par eval)"
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node dev-tests/test-browser.js
echo "== test-graphique-navigateur (Chromium : le dessin du module graphique face à celui de Grist BI, 500 images de suite)"
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node dev-tests/test-graphique-navigateur.js
echo
echo "TOUT PASSE : on peut fusionner / envoyer."
