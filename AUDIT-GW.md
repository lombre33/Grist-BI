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

## Voulu, ou hors de portée de ce dépôt

- **C-EXFIL-04** : le script d'API de Grist vient de `docs.getgrist.com` (`index.html`). C'est le chargement normal d'un widget
  Grist ; GFS note le même constat chez lui comme voulu.
- **C-GRIST-03 / C-GRIST-04** : accès `full` et modification de la structure du document. Voir `CLAUDE.md` §3 : l'API des widgets
  n'a pas de palier entre « une table » et « tout » ; les seules tables créées sont `BI_Dashboard_Config`, `BI_Dashboard_Comments`,
  `BI_Dashboard_UserProbe` (et la table d'un import CSV, après confirmation de la personne).
- **C-EXFIL-05 / C-EXFIL-06** : `<script>` et `import()` dont l'adresse est calculée. Les trois scripts (`js/export.js`,
  `js/pdf-export.js`, `js/pptx-export.js`) viennent d'un dossier local ou d'une adresse figée à version et empreinte SRI ; les
  quatre `import()` (kit, dialogues, DuckDB) sont résolus sur `document.currentScript.src`.
- **F-SOUV-01** : `cdnjs.cloudflare.com` pour pdfmake et PptxGenJS, dérogation actée par Antoine le 29/09/2026 (`CLAUDE.md` §8).
- **C-STOCK-01** : deux clés `localStorage`, déjà documentées (`gristbi_lang`, `gristbi_comment_author`) : préférences, aucun contenu
  du document.
- **A-DEV-03** : les 11 « marqueurs » sont le mot `BUG` dans des commentaires qui racontent un défaut *corrigé* (« bug réel n°… »),
  jamais un travail inachevé. Faux positif ; les mots ne sont pas changés (ils servent à retrouver l'historique).
- **A-DUP-01** : blocs dupliqués dans `dev-tests/test-data.js` et dans le sous-module `kit/` (qui n'est pas ce dépôt).

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

- **A-FONC-01 / A-FONC-02 / A-TAILLE-01** : 25 fonctions longues, 23 trop ramifiées, 5 fichiers de plus de 600 lignes
  (`js/main.js` 2 366, `js/charts.js` 1 121, `js/advice.js`, `js/data.js`, `js/i18n.js`). Les plus lourdes sont `readTileForm` (135 chemins), `adviceForTile`
  (103), `defaultsForType` (82), `renderChart` (73) : ce sont les fonctions que chaque nouveau type de tuile modifie, et elles ont grossi avec les
  types ajoutés pendant cet audit (combo, progression, table plate). Les remanier
  pendant que d'autres lots ajoutent des types de tuile ferait des conflits sans fin ; à reprendre quand ils sont fusionnés
  (une table de correspondance par type remplace les cascades de `if`). Les « fonctions anonymes de 955 lignes » sont
  l'enveloppe `(function (root, factory) { … })` de chaque module : c'est l'architecture « scripts classiques, sans build ».
- **C-CSP-01** : aucune politique de sécurité de contenu. DuckDB-WASM (`wasm-unsafe-eval`, worker `blob:`), l'`importmap` en ligne,
  les attributs `style` et les scripts de `cdnjs` demandent une politique à mesurer dans un vrai Grist et dans GFS avant d'en poser
  une : une balise `<meta>` trop stricte casserait le widget sans message. Non posée ici. Et même sans `unsafe-eval`, deux copies de code qui
  compile une chaîne restent dans `js/vendor/` : le worker de DuckDB (`duckdb-browser-eh.worker.js`) embarque sa propre copie d'Apache
  Arrow, avec le même `createIsValidFunction` que celui qu'on a remplacé dans `apache-arrow/` (copie non modifiée : l'outil ne la
  voit pas, elle est chargée dans un `Worker`, et ce widget n'y déclare jamais de valeurs nulles), et ExcelJS (voir `SOURCES.md`).
- **B-NOM-01**, **B-VERB-01**, **F-ECO-01** : voir le rapport.
