# Bibliothèques tierces embarquées

Chaque dossier de `js/vendor/` est une copie de fichiers publiés sur npm, rangée telle quelle (voir « Modifications » plus bas
pour la seule exception). Aucune n'est chargée depuis un CDN : voir `CLAUDE.md` §7 (pièges n°4 et n°5) pour la raison.

Les empreintes SHA-256 ci-dessous sont celles des fichiers de ce dépôt ; elles ont été comparées, le 18/11/2026, à celles des
fichiers du paquet npm de la version indiquée (`npm pack <paquet>@<version>`, registre npm). `node dev-tests/test-data.js` vérifie
que chaque fichier listé ici correspond encore à son empreinte : changer une bibliothèque oblige à mettre ce fichier à jour.

| Dossier | Paquet npm | Version | Licence | Fichier suivi | SHA-256 |
|---|---|---|---|---|---|
| `echarts/` | `echarts` | 6.1.0 | Apache-2.0 | `dist/echarts.min.js` | `b66b25aeb4df84e33199dc21694014d336d222cbd9deb0e5a7c14bd6aa0d0fd0` |
| `xlsx/` | `xlsx` (SheetJS) | 0.18.5 | Apache-2.0 | `dist/xlsx.full.min.js` | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-browser.mjs` | `4f8c0bb3c23d1ec457a451cc27418597b9a40dd772cceacc436a2cb7b9a49c18` |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-eh.wasm` | `4c221bfa59c11f24dbd750e70c90b9252eca6eec5633936e6a2ec766e55fd879` |
| `duckdb/` | `@duckdb/duckdb-wasm` | 1.32.0 | MIT | `dist/duckdb-browser-eh.worker.js` | `f8ab72b6b90b3ad83077d47426d4a99d5d9a4c7e07cba1a2be37d655adc7c1ab` |
| `apache-arrow/` | `apache-arrow` | 17.0.0 | Apache-2.0 | `builder/valid.mjs` | `5b6ed8736c4fcb54d268ed125b1bdd98c29f8eb29b55766faff3cace38ac27a2` |
| `flatbuffers/` | `flatbuffers` | 24.3.25 à 25.2.10 (le fichier est identique) | Apache-2.0 | `mjs/flatbuffers.js` | `db9cda7751832e00abec7d2e2e6ec39b06c0bdf1fe7dd9cdf5a8e4edf0bd8958` |
| `tslib/` | `tslib` | 2.8.1 | 0BSD | `tslib.es6.mjs` | `0929993220938091ede542d688b0fdb87dad99a7e77678e1983c32d18a503339` |

`apache-arrow` et `flatbuffers` et `tslib` ne sont pas appelés par ce widget : ce sont les dépendances de `@duckdb/duckdb-wasm`
(`apache-arrow ^17.0.0`, qui demande `flatbuffers ^24.3.25` et `tslib ^2.6.2`). Elles sont embarquées pour que DuckDB-WASM se
charge sans aller les chercher ailleurs (l'`importmap` d'`index.html` y renvoie).

## Ce qui n'est pas dans cette liste

- `pdfmake` et `PptxGenJS` ne sont pas embarqués : ils sont chargés à la demande depuis `cdnjs.cloudflare.com`, version figée
  dans l'adresse, avec une empreinte SRI (`js/pdf-export.js`, `js/pptx-export.js`) — dérogation actée par Antoine le 29/09/2026,
  voir `CLAUDE.md` §8.
- `d3-cloud` et `pdfjs-dist` passent par GFS (`GFS-ETAT.md`, « Demandes à GFS »).

## Modifications

Aucune : les fichiers ci-dessus sont ceux des paquets npm, octet pour octet.

## Mettre une bibliothèque à jour

1. `npm pack <paquet>@<nouvelle version>`, extraire, copier le ou les fichiers au même endroit.
2. Mettre à jour la ligne de ce tableau (version, SHA-256 : `sha256sum <fichier>`).
3. Rejouer `node dev-tests/test-data.js` et ouvrir `dev-tests/harness.html` (servi en HTTP pour DuckDB).
4. Une mise à jour d'ECharts change des défauts (rayons, marges, thème) : `CLAUDE.md` §7 piège n°21.
5. Dire le changement dans « Changements qui touchent GFS » de `GFS-ETAT.md`.
