# Audit `gwaudit` de Grist-BI

`gwaudit` ([`lombre33/Grist-widget-audit`](https://github.com/lombre33/Grist-widget-audit), 1.0.0) est l'outil d'audit des
widgets Grist de la suite : six axes (A qualité du code, B lisibilité, C sécurité applicative, D sécurité en condition réelle,
E dépendances, F conformité Grist.Gouv / souveraineté / accessibilité), un score par axe, un verdict, et des « points
bloquants » qui ne se compensent pas. GFS s'en sert déjà sur lui-même (`docs/faits-verifies.md` §84 de `grist-widget-GFS`).

Ce fichier garde l'état de l'audit pour la prochaine personne (ou session) : comment le rejouer, ce qui a été corrigé, ce qui est
voulu, ce qui reste et pourquoi. Le rapport de l'outil lit le code **tel qu'il est** ; il ne remplace pas une revue humaine.

## Rejouer l'audit

```bash
git clone https://github.com/lombre33/Grist-widget-audit && cd Grist-widget-audit && npm install
git -C <Grist-BI> submodule update --init     # l'outil ne récupère pas les sous-modules : sans `kit/`, des 404 faussent l'axe D
GWAUDIT_CHROMIUM_PATH=/opt/pw-browsers/chromium GWAUDIT_CHROMIUM_SANS_SANDBOX=1 \
  node bin/gwaudit.js <Grist-BI> --json --sans-reseau --sortie <dossier>
node bin/gwaudit.js --diff <avant>/rapport.json <apres>/rapport.json
```

`GWAUDIT_CHROMIUM_PATH` et `GWAUDIT_CHROMIUM_SANS_SANDBOX` ne servent que dans le cloud (Chromium déjà installé, session `root`) :
sur un poste, `npx playwright install chromium` suffit. `--sans-reseau` coupe `npm audit` (ce dépôt n'a aucun `package.json`).
Le Chromium lancé sans bac à sable exécute le widget audité : à ne faire que sur un code dont on connaît la source.

## Résultats

| | Score | Verdict | A | B | C | D | E | F |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 18/11/2026, `4a58e35`, sans `kit/` | 51 | NON CONFORME (2 bloquants) | 8 | 82 | 0 | 97 | 93 | 70 |
| 18/11/2026, `4a58e35`, avec `kit/` (référence) | 54 | NON CONFORME (2 bloquants) | 19 | 82 | 0 | 100 | 93 | 70 |
| Lot 1 (accessibilité, `SECURITY.md`, `SOURCES.md`) | 55 | NON CONFORME (2 bloquants) | 19 | 82 | 0 | 100 | 93 | 85 |
| Lot 2 (`new Function` retirés du code tiers, en-tête d'ECharts) | 57 | CONFORME SOUS RÉSERVE (aucun bloquant) | 18 | 94 | 2 | 100 | 93 | 85 |
| Lot 3 (revue des `innerHTML`, id de tuile assaini) | 57 | CONFORME SOUS RÉSERVE (aucun bloquant) | 18 | 94 | 2 | 100 | 93 | 85 |
| Avant le lot 4 (`b8b7d4d`, après les types de tuile ajoutés depuis) | 53 | CONFORME SOUS RÉSERVE (aucun bloquant) | 6 | 85 | 1 | 100 | 93 | 85 |
| Lot 4 (qualité du code : marqueurs, doublons, noms, `data.js` coupé, `6e59a0f`) | 54 | CONFORME SOUS RÉSERVE (aucun bloquant) | 11 | 88 | 1 | 100 | 93 | 85 |

Les lignes ne se comparent pas toutes entre elles : entre le lot 3 et le lot 4, des dizaines de fonctions et trois fichiers de plus de
600 lignes sont arrivés avec les nouveaux types de tuile et l'export Excel refait, ce qui a ramené A de 18 à 6 et B de 94 à 85 *avant*
tout travail du lot 4. Comparer le lot 4 à la ligne qui le précède (`b8b7d4d`).

La note d'un axe se joue sur ses règles *entières* : une règle ne coûte jamais plus que sa sévérité × 2,5, quel que soit le
nombre d'occurrences. Corriger 20 occurrences sur 24 ne rapporte donc rien ; supprimer la règle rapporte tout. D'où les scores qui
bougent peu tant que des occurrences durables (le code tiers, la taille des fichiers) restent.

Le lot 3 ne change aucune note : il corrige un vrai défaut que l'outil ne sait pas distinguer d'un `innerHTML` sûr (C-XSS-01 compte 31 occurrences avant comme après, dont 7 dans
`js/vendor/`). Une revue humaine n'est pas un score ; elle est consignée ci-dessous.

## Corrigé

- **F-RGAA-04** (4 champs sans étiquette : `#filter-max`, `#filter-date-end`, `#pbix-import-file`, `#csv-import-file`) :
  `aria-label` traduits (`data-i18n-aria`, clés `filters.*.aria`, `pbixImport.*FileAria`), et `#filter-min`, `#filter-date-start`
  nommés pareillement pour que la paire se lise « Valeur minimale » / « Valeur maximale ».
- **F-RGAA-05** (2 boutons vides) : `#update-bookmark` et `#welcome-add-all` portent un intitulé de départ ; le script l'écrase
  dès qu'il les montre (jamais lu par un lecteur d'écran tant qu'ils sont masqués).
- **D-RGAA-aria-allowed-role** et **D-RGAA-landmark-one-main** (mesurés par axe-core dans Chromium) : `<main>` ne peut pas porter
  `role="tabpanel"` et la page n'avait donc aucun repère `main`. `<main id="workspace-main">` enveloppe maintenant la zone de travail
  (zone d'agrandissement, tuiles, accueil) ; `#tiles` reste le panneau des onglets de page, sur un `<div>`. Aucune règle CSS ne
  ciblait la balise.
- **F-GUIDE-02** : [`SECURITY.md`](SECURITY.md) (comment signaler une faille, sans issue publique).
- **E-DEP-02** (traçabilité) : [`js/vendor/SOURCES.md`](js/vendor/SOURCES.md) — paquet, version et SHA-256 de chaque bibliothèque
  embarquée, **comparés** aux paquets npm (`echarts@6.1.0`, `exceljs@4.4.0`, `@duckdb/duckdb-wasm@1.32.0`, `apache-arrow@17.0.0`,
  `tslib@2.8.1`, `flatbuffers`). `dev-tests/test-audit.js` vérifie que le tableau dit vrai. L'outil ne lit que l'en-tête de chaque
  fichier : ses 136 constats E-DEP-02 restent, sans effet sur la note (une règle mineure coûte au plus 7,5 points).

`dev-tests/test-audit.js` garde ce lot : champs étiquetés, boutons nommés, un seul `<main>`, `SECURITY.md`, `SOURCES.md` exact.

- **C-XSS-03** (les 2 bloquants) : `new Function()` dans `js/vendor/echarts/echarts.min.js` (repli GeoJSON quand `JSON.parse` n'existe pas)
  et `js/vendor/apache-arrow/builder/valid.mjs` (compilation d'un `switch` de valeurs nulles). Aucun n'était atteint avec une
  donnée de ce widget. Les deux fichiers sont modifiés a minima, à la main, **sans nouvelle bibliothèque** : `JSON.parse` à la place du
  repli ; une fermeture sur un `Set` à la place du code compilé (comparée à l'original sur 76 057 cas, aucun écart). Dit dans
  `js/vendor/SOURCES.md`, rejouable par `node dev-tests/patch-echarts.js`, gardé par `dev-tests/test-audit.js` (qui échoue sur les
  fichiers d'origine). Vérifié dans Chromium : barres et secteurs ECharts rendus, DuckDB-WASM initialisé et utilisé sur 8 000 lignes
  (au-delà du seuil de 5 000), aucune erreur de console. **Si la modification d'un fichier tiers ne vous convient pas** : revenir
  au fichier du paquet (`git revert`) rend les 2 bloquants et le verdict NON CONFORME ; ce sont des faux risques ici, mais l'outil ne
  le sait pas.
- **B-MIN-01** : `echarts.min.js` porte maintenant une ligne d'en-tête (nom, version, licence, origine) : l'outil le reconnaît
  comme une bibliothèque identifiée, la note globale n'est plus plafonnée.

### Lot 4 : qualité du code (18/11/2026, soir)

- **A-DEV-03** (11 « marqueurs ») : le mot `BUG` des commentaires qui racontent un défaut *corrigé* devient `DÉFAUT RÉEL` / `DÉFAUT DE TEST`
  (11 commentaires, aucun code). L'historique reste retrouvable par `DÉFAUT RÉEL` ; la règle ne se déclenche plus.
- **A-DUP-01** : les blocs que `dev-tests/test-layouts.js` et `dev-tests/test-styles.js` recopiaient (lecture d'un fichier, analyse d'une
  feuille de style, faux `grist` portant `BI_Dashboard_Config`) vivent dans `dev-tests/lib/helpers.js`. Il reste 46 blocs dupliqués dont 4
  seulement entre fichiers : la règle passe de majeure à mineure.
- **B-NOM-01** (76 identifiants non descriptifs) : renommés avec le service de langage TypeScript (portée respectée, collisions
  vérifiées une à une) dans `advice.js`, `charts.js`, `csv-import.js`, `data.js`, `duckdb-engine.js`, `format.js`, `grist-api.js`, `i18n.js`,
  `keywords-panel.js`, `main.js`, `state.js`, `styles.js`, `welcome.js`. Aucun nom exporté (`GristBI.*`) ni clé de configuration ne change.
  Quatre essais de `dev-tests/test-data.js` lisent le texte des sources avec des expressions régulières : ils suivent les nouveaux noms.
  Comparé à `main` dans Chromium (22 types de tuile, 6 000 lignes pour passer par DuckDB, page directe et `<iframe sandbox="allow-scripts">`) :
  0 pixel de différence, aucune erreur de console.
- **A-TAILLE-01** (partiel) : `js/data.js` (1 343 lignes de code) est coupé en `js/data.js` (897) et `js/data-tiles.js` (492), qui porte les calculs
  purs des types de tuile récents. Même API (`GristBI.data.*`), même vérification (0 pixel de différence, deux cadres). `js/data.js` ne dépasse plus le seuil majeur de 1 200 lignes.

## Voulu, ou hors de portée de ce dépôt

- **C-EXFIL-04** : le script d'API de Grist vient de `docs.getgrist.com` (`index.html`). C'est le chargement normal d'un widget
  Grist ; GFS note le même constat chez lui comme voulu.
- **C-GRIST-03 / C-GRIST-04** : accès `full` et modification de la structure du document. Voir `CLAUDE.md` §3 : l'API des widgets
  n'a pas de palier entre « une table » et « tout » ; les seules tables créées sont `BI_Dashboard_Config`, `BI_Dashboard_Comments`,
  `BI_Dashboard_UserProbe` (et la table d'un import CSV, après confirmation de la personne).
- **C-EXFIL-05 / C-EXFIL-06** : `<script>` et `import()` dont l'adresse est calculée. Les trois scripts (`js/export.js`,
  `js/pdf-export.js`, `js/pptx-export.js`) viennent d'un dossier local ou d'une adresse figée à version et empreinte SRI ; les
  quatre `import()` (kit, dialogues, DuckDB) sont résolus sur `document.currentScript.src`. **Ce n'est pas une facilité :** dans GFS le widget
  tourne dans un `<iframe sandbox="allow-scripts">` (origine opaque) ; un `import('../kit/js/…')` littéral y échoue (« base URL is about:blank
  because import() is called from a CORS-cross-origin script »). Essayé le 18/11/2026 en littéral, mesuré cassé dans un cadre isolé, remis
  tel quel. Seule une adresse absolue calculée sur `document.currentScript.src` fonctionne dans les deux contextes.
- **A-PERF-01** (information, 0 point) : deux boucles de `js/grist-api.js` attendent Grist une fois par tour, et les deux doivent rester en série.
  `applyActionsInChunks` (ligne 443) envoie une liste d'actions par lots de 2 000, dans l'ordre : l'ordre des `AddRecord` est l'ordre des lignes de la table, et un échec en
  cours de route laisse un préfixe connu plutôt qu'un trou ; en parallèle, les lignes arriveraient dans le désordre et la progression affichée n'aurait plus de sens.
  La boucle de `tableExistsConfirmed` relit `listTables()` avec des délais croissants (300 ms à 4,8 s) : c'est une *attente*, la course contre la négociation d'accès (`CLAUDE.md` §7 piège n°1).
- **F-SOUV-01** : `cdnjs.cloudflare.com` pour pdfmake et PptxGenJS, dérogation actée par Antoine le 29/09/2026 (`CLAUDE.md` §8).
- **C-STOCK-01** : deux clés `localStorage`, déjà documentées (`gristbi_lang`, `gristbi_comment_author`) : préférences, aucun contenu
  du document.
- **A-DUP-01** (mineure) : les blocs encore dupliqués sont dans `dev-tests/test-data.js` (des cas d'essai voisins) et dans le sous-module `kit/` (qui n'est pas ce dépôt).

## Revue de C-XSS-01 (`innerHTML` dynamique)

La règle signale tout `innerHTML` dont le texte n'est pas une constante (31 occurrences : 24 dans le code de ce dépôt, le reste dans `js/vendor/echarts/`, `js/i18n.js` pour le
mécanisme `data-i18n-html`, et `js/combobox.js`/`js/welcome.js`). Elle ne dit pas lesquelles sont exploitables ; les 24 du dépôt ont été lues une à une (filtres, onglets de pages,
pastilles, liste des vues, en-tête et corps de tuile, commentaires, fenêtre de détail, imports Power BI/CSV, sélecteur de colonnes, tuile Texte, table plate, pivot, fil d'Ariane, carte d'accueil,
liste du combobox).

- **Valeurs de cellule, noms de colonnes, titres, noms de pages et de vues, valeurs de filtre** : toutes passent par `escapeHtml` (`& < > " '`) avant d'être écrites. La tuile Texte
  n'accepte que `renderTextHtml` (tout est échappé, puis une liste fermée de balises). Aucun défaut.
- **Un défaut réel : l'identifiant d'une tuile** (bug réel n°45, TEST_PROTOCOL.md). `data-tile-id="${tile.id}"` (`js/main.js`) et ~14 sélecteurs `[data-tile-id="${tile.id}"]` (`js/charts.js`)
  recevaient l'id tel qu'il est relu de `BI_Dashboard_Config`, une ligne qu'une autre personne du document peut avoir écrite. `x"><img src=x onerror=…>` exécutait du script dans le widget
  (accès `full`) : mesuré dans Chromium avec une ligne de configuration hostile (`window.__xss = 1`, 2 nœuds injectés, 7 erreurs « not a valid selector »). Corrigé par
  `js/state.js:sanitizePages` (tout id relu est ramené à `[A-Za-z0-9_-]`, unique) + `escapeHtml` à la pose ; même mesure après : 0, 0, aucune erreur, les trois tuiles se dessinent.
  Garde : `dev-tests/test-data.js` (blocs « ids de tuile relus » et « défense en profondeur »).
- **Non modifié, par choix** : les ids de pages et de vues (déjà échappés partout où ils sont écrits, jamais utilisés comme sélecteur) ; les gabarits de sélecteurs de `js/charts.js`
  (aucun code de ce widget n'y met un id qui ne vienne pas de `setPages` ou de son propre générateur) ; le code d'ECharts.
- **Dans ECharts** (non modifié sur ce point) : C-XSS-02 (`document.write`, l'ouverture de l'image par la barre d'outils `saveAsImage`), C-EXFIL-02 (une requête dont l'adresse est calculée) et
  C-XSS-04 (minuteries). Ce widget n'active ni barre d'outils, ni carte, ni `geo` (aucun `toolbox`, `registerMap` ni `geo` dans `js/charts.js`), et l'axe D, qui capture le trafic réellement émis,
  n'observe aucune requête vers un domaine tiers (D-RESEAU-00).

## Reste à faire

- **A-TAILLE-01** (5 fichiers) : `js/main.js` 2 754 lignes de code et `js/charts.js` 1 924 (seuil majeur 1 200), puis `js/advice.js` 979,
  `js/data.js` 897 et `js/i18n.js` 887 (seuil mineur 600). Découper `main.js` et `charts.js` est le seul chantier qui rapporte vraiment
  (environ +16 points sur l'axe A) ; il touche le démarrage et le rendu de tous les types de tuile. Décision d'Antoine attendue (carte du 18/11/2026) : à faire
  par un fichier à la fois, avec la même vérification que `data.js` (essais Node + Chromium, page directe et cadre isolé, comparaison de pixels avec `main`).
  Le schéma qui a servi pour `data.js` : `api.extend(factory)` et un `tileCore` qui donne à la suite les fonctions communes (voir `CLAUDE.md` §2, ligne `js/data-tiles.js`).
- **A-FONC-01 / A-FONC-02 / A-FONC-03** : 38 fonctions longues, 49 trop ramifiées, une imbrication de profondeur 6 (`captureTileImages`). Les plus lourdes sont `readTileForm`
  (135 chemins), `adviceForTile` (103), `defaultsForType` (82), `renderChart` (73) : ce sont les fonctions que chaque nouveau type de tuile modifie. Ces deux règles sont
  déjà au plafond de leur pénalité (30 points chacune) : il faut les faire disparaître *toutes* pour gagner, pas en réduire le nombre. Une table de correspondance par type
  remplace les cascades de `if` ; à faire quand plus aucun fil n'ajoute de type de tuile. Les « fonctions anonymes de 900 lignes » sont l'enveloppe
  `(function (root, factory) { … })` de chaque module : c'est l'architecture « scripts classiques, sans build ».
- **Axe C (sécurité applicative, 1/100)** : 32 `innerHTML` (relus : voir plus haut), les `import()`/`<script>` calculés, l'accès `full`, `localStorage` et le script d'API de Grist
  sont des constats **de structure** : ils se justifient (voir « Voulu ») mais l'outil ne peut pas le savoir. L'axe est rendu par un plancher doux (8·exp(−(pénalité − 92)/40)) : tant qu'une
  seule de ces règles reste, il ne remonte pas. Ce n'est pas un défaut de ce dépôt qu'on corrige en réécrivant du code ;
- **C-CSP-01** : aucune politique de sécurité de contenu. DuckDB-WASM (`wasm-unsafe-eval`, worker `blob:`), l'`importmap` en ligne,
  les attributs `style` et les scripts de `cdnjs` demandent une politique à mesurer dans un vrai Grist et dans GFS avant d'en poser
  une : une balise `<meta>` trop stricte casserait le widget sans message. Non posée ici. Et même sans `unsafe-eval`, deux copies de code qui
  compile une chaîne restent dans `js/vendor/` : le worker de DuckDB (`duckdb-browser-eh.worker.js`) embarque sa propre copie d'Apache
  Arrow, avec le même `createIsValidFunction` que celui qu'on a remplacé dans `apache-arrow/` (copie non modifiée : l'outil ne la
  voit pas, elle est chargée dans un `Worker`, et ce widget n'y déclare jamais de valeurs nulles), et ExcelJS (voir `SOURCES.md`).
- **B-VERB-01** (12 300 lignes de code exécutées : l'ampleur du widget, pas un défaut à corriger) et **F-ECO-01** : voir le rapport.
