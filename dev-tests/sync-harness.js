/*
 * Garde `dev-tests/harness.html` identique à `index.html` : le harnais en recopie tout le <body>
 * (même DOM, mêmes ids, mêmes scripts — chemins relatifs en `../`), à une seule différence près, le
 * badge du bandeau (« Harnais local » à la place de « Alpha »).
 *
 * Pourquoi ce fichier : le harnais n'était qu'une COPIE faite à la main. Un id ajouté à index.html
 * et oublié dans le harnais faisait planter js/main.js dès son chargement (`getElementById` rendait
 * `null`, voir TEST_PROTOCOL.md, bug réel n°27) — et seul un test qui OUVRAIT le harnais le voyait.
 * Depuis la refonte de la barre (18/11/2026), le <body> change à chaque lot : on le régénère.
 *
 *   node dev-tests/sync-harness.js          réécrit le <body> de harness.html d'après index.html
 *   node dev-tests/sync-harness.js --check  ne réécrit rien ; code de sortie 1 s'il y a un écart
 *
 * `dev-tests/test-data.js` appelle `isInSync()` : un index.html modifié sans régénérer le harnais
 * fait échouer les tests. Seul le CORPS est géré ; l'<head> du harnais (faux window.grist, import
 * map) reste écrit à la main.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'index.html');
const HARNESS = path.join(__dirname, 'harness.html');

// <body ...>…</body> d'un document : { open: '<body …>', inner, close } (ou lève si absent).
function splitBody(html) {
  const m = html.match(/(<body[^>]*>)([\s\S]*)(<\/body>)/);
  if (!m) throw new Error('<body> introuvable');
  return { open: m[1], inner: m[2], close: m[3] };
}

// Le corps du harnais d'après celui d'index.html : chemins relatifs rebasés d'un niveau, commentaires
// HTML retirés (le harnais n'a pas à les redoubler), badge propre au harnais.
function harnessBodyFrom(indexHtml) {
  const { open, inner } = splitBody(indexHtml);
  let body = inner
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(src|href)="(js|css|img|kit)\//g, '$1="../$2/')
    .replace('<span class="badge-alpha" data-i18n="topbar.badgeAlpha">Alpha</span>', '<span class="badge-alpha">Harnais local</span>')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
  return { open, inner: body };
}

function regenerate(harnessHtml, indexHtml) {
  const h = splitBody(harnessHtml);
  const next = harnessBodyFrom(indexHtml);
  return harnessHtml.replace(/<body[^>]*>[\s\S]*<\/body>/, () => next.open + next.inner + h.close);
}

function isInSync() {
  const indexHtml = fs.readFileSync(INDEX, 'utf8');
  const harnessHtml = fs.readFileSync(HARNESS, 'utf8');
  return regenerate(harnessHtml, indexHtml) === harnessHtml;
}

if (require.main === module) {
  const indexHtml = fs.readFileSync(INDEX, 'utf8');
  const harnessHtml = fs.readFileSync(HARNESS, 'utf8');
  const next = regenerate(harnessHtml, indexHtml);
  if (process.argv.includes('--check')) {
    if (next === harnessHtml) { console.log('harness.html est à jour.'); process.exit(0); }
    console.error('harness.html diffère d\'index.html : lancer `node dev-tests/sync-harness.js`.');
    process.exit(1);
  }
  if (next === harnessHtml) console.log('harness.html était déjà à jour.');
  else { fs.writeFileSync(HARNESS, next); console.log('harness.html réécrit d\'après index.html.'); }
}

module.exports = { harnessBodyFrom, regenerate, isInSync, splitBody };
