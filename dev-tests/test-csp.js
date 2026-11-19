/*
 * Essais de la politique de sécurité du contenu de `index.html` (audit `gwaudit` C-CSP-01 / C-CSP-02, 18/11/2026).
 *
 * La politique est une balise `<meta http-equiv="Content-Security-Policy">` : le filet quand une autre défense cède
 * (`js/safe-html.js`, `js/loader.js`). Ce que ces essais figent, et qu'une retouche d'`index.html` peut défaire SANS erreur :
 *  - la balise existe, est dans `<head>` et AVANT toute balise `<script>` ou `<link>` (sinon Chromium ne l'applique pas à
 *    ce qui la précède) ;
 *  - `script-src` n'a ni `'unsafe-inline'`, ni joker, ni `data:`/`blob:`/`http:` ; il garde `'self'`, `'wasm-unsafe-eval'` (DuckDB-WASM) et
 *    `'unsafe-eval'` : le fichier que Grist sert (`grist-plugin-api.js`, bundle webpack) s'exécute par `eval`, sans quoi `grist` reste
 *    indéfini et le widget ne démarre pas (régression du 18/11/2026, corrigée le 19/11). Ce texte EXIGE donc `'unsafe-eval'` ; que la page
 *    démarre vraiment avec la vraie politique se mesure dans `dev-tests/test-browser.js` ;
 *  - le SEUL script en ligne de la page (l'`importmap` de DuckDB) est autorisé par son EMPREINTE : si son texte change sans que
 *    l'empreinte suive, DuckDB ne se charge plus et le widget retombe sur le calcul JS sans le dire — cet essai le dit ;
 *  - aucun attribut `on…=` ni `javascript:` dans la page ;
 *  - rien que `frame-ancestors` (ignoré dans une balise `<meta>`) ne manque : GFS et Grist cadrent le widget comme avant.
 * Ce que la politique laisse passer ou bloque dans Chromium (eval, script en ligne, gestionnaire en ligne, 22 types de tuile,
 * DuckDB, exports, extension de GFS, cadre isolé) se mesure dans un navigateur : voir dev-tests/README.md.
 * `node dev-tests/test-csp.js`
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

// --- La balise ------------------------------------------------------------------------------------------------------------
const metas = [...html.matchAll(/<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)];
assert.strictEqual(metas.length, 1, 'une seule balise de politique de sécurité du contenu');
const meta = metas[0];
assert.ok(meta.index > html.indexOf('<head>') && meta.index < html.indexOf('</head>'), 'la balise est dans <head>');
const before = html.slice(0, meta.index);
assert.ok(!/<script[\s>]/i.test(before) && !/<link[\s>]/i.test(before) && !/<style[\s>]/i.test(before),
  'aucune balise <script>, <link> ni <style> avant la politique : elle ne s\'applique qu\'à ce qui la suit');
const content = (meta[0].match(/content="([^"]*)"/) || [])[1];
assert.ok(content, 'la balise porte un attribut content');

const directives = {};
for (const part of content.split(';')) {
  const tokens = part.trim().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    assert.ok(!(tokens[0] in directives), 'directive répétée : ' + tokens[0]);
    directives[tokens[0].toLowerCase()] = tokens.slice(1);
  }
}

// --- Les directives -------------------------------------------------------------------------------------------------------
assert.deepStrictEqual(directives['default-src'], ["'none'"], 'tout ce qui n\'est pas nommé est refusé');
const script = directives['script-src'];
assert.ok(script, 'script-src');
for (const bad of ["'unsafe-inline'", "'unsafe-hashes'", '*', 'data:', 'blob:', 'http:', "'strict-dynamic'"]) {
  assert.ok(!script.includes(bad), `script-src ne contient pas ${bad}`);
}
assert.ok(script.includes("'self'"), "script-src : 'self'");
assert.ok(script.includes("'wasm-unsafe-eval'"), "script-src : 'wasm-unsafe-eval' (DuckDB-WASM)");
assert.ok(script.includes("'unsafe-eval'"), "script-src : 'unsafe-eval' est NÉCESSAIRE : grist-plugin-api.js, que Grist sert, s'exécute par eval ; sans lui le widget ne démarre pas dans Grist (dev-tests/test-browser.js)");
assert.ok(script.includes('https:'), 'script-src : https: (adresse des extensions de GFS, inconnue d\'avance ; le chargeur exige une empreinte)');
for (const source of script) {
  assert.ok(source === "'self'" || source === "'unsafe-eval'" || source === "'wasm-unsafe-eval'" || source === 'https:' || /^'sha256-[A-Za-z0-9+/]{43}='$/.test(source),
    'source de script inattendue : ' + source);
}
assert.deepStrictEqual(directives['object-src'], ["'none'"]);
assert.deepStrictEqual(directives['base-uri'], ["'self'"]);
assert.deepStrictEqual(directives['form-action'], ["'none'"], 'aucun formulaire ne part : les envois passent par bindFormSubmit (CLAUDE.md §7 piège n°20)');
assert.deepStrictEqual(directives['worker-src'], ["'self'", 'blob:'], 'DuckDB lance son Worker depuis une adresse blob:');
for (const name of Object.keys(directives)) {
  assert.ok(!directives[name].includes('*'), `${name} sans joker`);
}
for (const name of ['connect-src', 'img-src', 'font-src', 'style-src']) {
  assert.ok(directives[name], name);
  assert.ok(!directives[name].includes('http:'), `${name} : jamais http:`);
}
assert.ok(directives['connect-src'].includes("'self'") && directives['connect-src'].includes('https:'),
  'connect-src : le site (DuckDB charge son .wasm) et l\'adresse que Grist donne pour une pièce jointe');
assert.ok(!('frame-ancestors' in directives) && !('report-uri' in directives) && !('sandbox' in directives),
  'frame-ancestors, report-uri et sandbox sont ignorés dans une balise <meta> : ne pas les écrire donne l\'impression d\'une protection qui n\'existe pas');

// --- Les scripts en ligne --------------------------------------------------------------------------------------------------
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.deepStrictEqual(inline.map((m) => (m[1].match(/type="([^"]+)"/) || [])[1]), ['importmap'], 'le seul script en ligne est l\'importmap de DuckDB');
const hashes = script.filter((source) => source.startsWith("'sha256-")).map((source) => source.slice(1, -1));
const importmapHash = 'sha256-' + crypto.createHash('sha256').update(inline[0][2]).digest('base64');
assert.deepStrictEqual(hashes, [importmapHash],
  `l'empreinte de l'importmap a changé : mettre 'sha256-… ' à ${importmapHash} dans la balise de politique de index.html`);
const importmap = JSON.parse(inline[0][2]);
for (const target of Object.values(importmap.imports)) {
  assert.ok(/^\.\/js\/vendor\//.test(target), 'l\'importmap ne pointe que vers js/vendor/ : ' + target);
}

// --- Aucun gestionnaire ni adresse exécutable en ligne ---------------------------------------------------------------------
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'aucun attribut on…= dans index.html');
assert.ok(!/javascript:/i.test(html), 'aucune adresse javascript: dans index.html');
assert.ok(!/<style[\s>]/i.test(html), 'aucune balise <style> dans index.html (les styles sont dans css/)');
assert.ok(!/<iframe[\s>]/i.test(html), 'aucune iframe dans index.html');

// --- Les scripts de l'en-tête : adresses permises ------------------------------------------------------------------------------
for (const m of head.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)) {
  assert.ok(/^(js\/|https:\/\/docs\.getgrist\.com\/grist-plugin-api\.js$)/.test(m[1]), 'script de l\'en-tête inattendu : ' + m[1]);
}

console.log('Tous les essais de la politique de sécurité du contenu sont passés.');
