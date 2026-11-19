#!/bin/sh
# Tous les essais du dépôt, dans l'ordre : les huit essais Node (dont test-graphique, le module js/graphique/), puis l'essai dans un vrai navigateur (dev-tests/test-browser.js).
# À LANCER AVANT TOUTE FUSION ET AVANT TOUT ENVOI VERS UN DÉPÔT PUBLIÉ (GitHub Pages) : sh dev-tests/run-all.sh
# Sortie 0 = tout passe ; au premier échec, le script s'arrête et le dit. Playwright + Chromium sont requis pour le dernier essai
# (NODE_PATH est pris sur `npm root -g` s'il n'est pas déjà posé) ; leur absence est un ÉCHEC, jamais un essai « sauté ».
set -e
cd "$(dirname "$0")/.."
for t in test-data test-styles test-layouts test-safe-html test-loader test-csp test-audit test-graphique; do
  echo "== $t"
  node "dev-tests/$t.js"
done
echo "== test-browser (Chromium : le vrai index.html, sa politique de sécurité, un grist-plugin-api qui passe par eval)"
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node dev-tests/test-browser.js
echo
echo "TOUT PASSE : on peut fusionner / envoyer."
