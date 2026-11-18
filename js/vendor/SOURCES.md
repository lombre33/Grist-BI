# Bibliothèques tierces embarquées

Chaque dossier de `js/vendor/` est une copie de fichiers publiés sur npm, rangée telle quelle, à deux exceptions près (voir
« Modifications » plus bas : ECharts et un fichier d'Apache Arrow). Aucune n'est chargée depuis un CDN : voir `CLAUDE.md` §7 (pièges n°4 et n°5) pour la raison.

Les empreintes SHA-256 ci-dessous sont celles des fichiers de ce dépôt ; celles des fichiers **non modifiés** ont été comparées,
le 18/11/2026, à celles des fichiers du paquet npm de la version indiquée (`npm pack <paquet>@<version>`, registre npm). `node dev-tests/test-data.js` vérifie
que chaque fichier listé ici correspond encore à son empreinte : changer une bibliothèque oblige à mettre ce fichier à jour.

| Dossier | Paquet npm | Version | Licence | Fichier suivi | SHA-256 |
|---|---|---|---|---|---|
| `echarts/` | `echarts` | 6.1.0 | Apache-2.0 | `dist/echarts.min.js` | `7701bb6b19ad58458a1b3bc92d3a57dbe02c28b743c2589c2637859a5201a77c` (modifié) |
| `exceljs/` | `exceljs` | 4.4.0 | MIT | `dist/exceljs.min.js` | `7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9` |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-browser.mjs` | `136e1a195d85a98cad5e6aae7d040a229bcf1c8cb78a5e949e14adb35eb093b9` (modifié) |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-eh.wasm` | `4c221bfa59c11f24dbd750e70c90b9252eca6eec5633936e6a2ec766e55fd879` |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-browser-eh.worker.js` | `f8ab72b6b90b3ad83077d47426d4a99d5d9a4c7e07cba1a2be37d655adc7c1ab` |
| `apache-arrow/` | `apache-arrow` | 17.0.0 | Apache-2.0 | `builder/valid.mjs` | `d6495c945339fa27a08a9d1936eabd44e5beb827c61d5a68529b17984221eff2` (modifié) |
| `flatbuffers/` | `flatbuffers` | 24.3.25 à 25.2.10 (le fichier est identique) | Apache-2.0 | `mjs/flatbuffers.js` | `db9cda7751832e00abec7d2e2e6ec39b06c0bdf1fe7dd9cdf5a8e4edf0bd8958` |
| `tslib/` | `tslib` | 2.8.1 | 0BSD | `tslib.es6.mjs` | `0929993220938091ede542d688b0fdb87dad99a7e77678e1983c32d18a503339` |

`apache-arrow` et `flatbuffers` et `tslib` ne sont pas appelés par ce widget : ce sont les dépendances de `@duckdb/duckdb-wasm`
(`apache-arrow ^17.0.0`, qui demande `flatbuffers ^24.3.25` et `tslib ^2.6.2`). Elles sont embarquées pour que DuckDB-WASM se
charge sans aller les chercher ailleurs (l'`importmap` d'`index.html` y renvoie).

## Ce qui n'est pas dans cette liste

- `PptxGenJS` n'est pas embarqué : il est chargé à la demande depuis `cdn.jsdelivr.net` (`pptxgenjs@4.0.1/dist/pptxgen.bundle.js`), version
  figée dans l'adresse, avec une empreinte SRI (`js/pptx-export.js`) — dérogation actée par Antoine le 29/09/2026, voir `CLAUDE.md` §8.
  `pdfmake` n'est plus utilisé depuis le 18/11/2026 : le PDF est écrit par `js/pdf-writer.js`, sans bibliothèque.
- `d3-cloud` et `pdfjs-dist` passent par GFS (`GFS-ETAT.md`, « Demandes à GFS »).

## Modifications

Trois fichiers ne sont plus ceux du paquet. Deux (`echarts`, `apache-arrow`) pour retirer du code que l'audit `gwaudit` compte comme un point
bloquant ou majeur — code qui compile une chaîne en fonction (`new Function(...)`, C-XSS-03, CWE-95), qui écrit du HTML sans filtre (C-XSS-01),
qui écrit une page par `document.write` (C-XSS-02) ou qui ouvre un lien `javascript:` — et qu'une politique de sécurité de contenu sans
`unsafe-eval` refuserait : dans tous les cas le code retiré n'est jamais atteint avec une donnée de ce widget. Le troisième (`duckdb-browser.mjs`)
ne reçoit qu'une ligne de commentaire en tête, qui dit ce qu'est ce fichier minifié (nom, version, licence, origine).

| Fichier | SHA-256 d'origine (paquet npm) | Ce qui change | Pourquoi c'est sans effet ici |
|---|---|---|---|
| `echarts/echarts.min.js` | `b66b25aeb4df84e33199dc21694014d336d222cbd9deb0e5a7c14bd6aa0d0fd0` (`echarts@6.1.0`) | (1) le repli `"undefined"!=typeof JSON&&JSON.parse?JSON.parse(i):new Function("return ("+i+");")()` de l'analyse d'un GeoJSON devient `JSON.parse(i)` ; (2) une ligne d'en-tête (nom, version, licence, origine) ajoutée en tête, pour qu'on sache d'où vient ce fichier minifié ; (3) les sept affectations `élément.innerHTML = texte` (infobulle HTML ; SVG et boîte « données » de la barre d'outils) passent par `__gristBiSetHtml(élément, texte)`, une fonction de six lignes posée sous l'en-tête, qui confie le texte à `GristBI.safeHtml.setHtml` (`js/safe-html.js`) et, si ce module manque, l'écrit comme TEXTE ; (4) le bouton « enregistrer en image » de la barre d'outils perd ses deux branches de repli pour d'anciens navigateurs (IE, Edge d'avant 2020), qui écrivaient une page par `document.open`/`document.write` ; il ne reste que le téléchargement par un lien `download` ; (5) `windowOpen(lien, cible)` n'ouvre plus qu'une adresse `http:`/`https:` dans un NOUVEL onglet (`opener` coupé) : plus de `javascript:`/`data:`, plus de cible nommée | (1) ECharts n'emploie `new Function` que si `JSON.parse` n'existe pas (aucun navigateur actuel) et pour un GeoJSON, type de carte que ce widget n'a pas ; (3) l'infobulle affiche le même contenu : le test `dev-tests/test-safe-html.js` et le parcours au survol (22 types de tuile) comparent l'infobulle avant et après ; (4) et (5) ne touchent que la barre d'outils (`toolbox`) et les options `link` d'un titre ou d'une série, qu'aucune tuile de ce widget n'emploie (`grep toolbox js/` : rien) ; `dev-tests/test-safe-html.js` vérifie qu'il ne reste ni `document.write` ni `.open(` à arguments |
| `apache-arrow/builder/valid.mjs` | `5b6ed8736c4fcb54d268ed125b1bdd98c29f8eb29b55766faff3cace38ac27a2` (`apache-arrow@17.0.0`) | `createIsValidFunction` rend une fermeture sur un `Set` au lieu de compiler un `switch` par le constructeur `Function` | Même résultat : comparé à l'original sur 76 057 cas (listes de valeurs nulles tirées au hasard parmi `null`, `undefined`, `NaN`, `0`, `-0`, nombres, bigints, chaînes ; aucun écart). Ne sert qu'à construire des vecteurs Arrow avec des valeurs nulles déclarées, ce que ce widget ne fait pas (il lit les résultats de DuckDB) |
| `duckdb/duckdb-browser.mjs` | `4f8c0bb3c23d1ec457a451cc27418597b9a40dd772cceacc436a2cb7b9a49c18` (`@duckdb/duckdb-wasm@1.32.0`) | une ligne de commentaire ajoutée en tête (`/*! @duckdb/duckdb-wasm 1.32.0 \| MIT License \| … */`) | un commentaire ne s'exécute pas ; sans lui un outil d'audit lit un fichier minifié d'origine inconnue (B-MIN-01). Pour revenir au fichier du paquet : retirer la première ligne |

`node dev-tests/test-audit.js` vérifie que ces deux fichiers ne contiennent plus de `new Function(` et qu'ECharts ne contient plus d'affectation `.innerHTML=` hors de `__gristBiSetHtml`. Après une mise à jour d'ECharts,
`node dev-tests/patch-echarts.js` rejoue les cinq modifications (et dit si un motif a changé) ; pour Apache Arrow, reprendre le
fichier de ce dépôt tel quel si `builder/valid.mjs` n'a pas changé dans le nouveau paquet (comparer à l'empreinte d'origine
ci-dessus), sinon refaire la même modification. Si une mise à jour d'une de ces bibliothèques corrige le problème en amont,
revenir au fichier du paquet et retirer sa ligne ici.

`duckdb/duckdb-browser-eh.worker.js` embarque sa propre copie d'Apache Arrow, donc le même `createIsValidFunction` à `new Function`
que celui remplacé ci-dessus dans `apache-arrow/` : non modifié (l'audit ne suit pas un fichier chargé dans un `Worker`, et
ce widget ne déclare jamais de valeurs nulles à Arrow, il lit les résultats de DuckDB). Le patcher serait modifier un fichier
minifié de 770 Ko pour un code qui n'est pas atteint.

`exceljs/exceljs.min.js` contient encore des `Function("return this")` et un `new Function` (le remplissage de `setImmediate`) :
ils ne sont atteints qu'avec un navigateur sans `globalThis` ou un appel à `setImmediate` avec une chaîne, et le fichier
n'est chargé qu'au premier export Excel (adresse calculée) : l'audit ne le compte pas. Non modifié.

## Mettre une bibliothèque à jour

1. `npm pack <paquet>@<nouvelle version>`, extraire, copier le ou les fichiers au même endroit.
2. Mettre à jour la ligne de ce tableau (version, SHA-256 : `sha256sum <fichier>`).
3. Rejouer `node dev-tests/test-data.js` et ouvrir `dev-tests/harness.html` (servi en HTTP pour DuckDB).
4. Une mise à jour d'ECharts change des défauts (rayons, marges, thème) : `CLAUDE.md` §7 piège n°21.
5. Dire le changement dans « Changements qui touchent GFS » de `GFS-ETAT.md`.
