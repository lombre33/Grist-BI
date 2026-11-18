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
| Lot 4 bis (`data.js`, `charts.js` et `main.js` coupés en fichiers de moins de 600 lignes de code, `58db90c` + découpage de `main.js`) | 56 | CONFORME SOUS RÉSERVE (aucun bloquant) | 19 | 88 | 1 | 100 | 93 | 85 |
| Lot 5 (sécurité : assainisseur de balisage, chargeur unique de code, ECharts nettoyé, adresse des pièces jointes ; `527b00d` + ce lot) | 57 | CONFORME SOUS RÉSERVE (aucun bloquant) | 22 | 85 | 6 | 100 | 93 | 85 |

Les lignes ne se comparent pas toutes entre elles : entre le lot 3 et le lot 4, des dizaines de fonctions et trois fichiers de plus de
600 lignes sont arrivés avec les nouveaux types de tuile et l'export Excel refait, ce qui a ramené A de 18 à 6 et B de 94 à 85 *avant*
tout travail du lot 4. Comparer le lot 4 à la ligne qui le précède (`b8b7d4d`).

La note d'un axe se joue sur ses règles *entières* : une règle ne coûte jamais plus que sa sévérité × 2,5, quel que soit le
nombre d'occurrences. Corriger 20 occurrences sur 24 ne rapporte donc rien ; supprimer la règle rapporte tout. D'où les scores qui
bougent peu tant que des occurrences durables (le code tiers, la taille des fichiers) restent.

**Lire le lot 5 avec ce qu'il a changé dans la VUE de l'outil** : tant que les `import()` du kit et de DuckDB-WASM étaient calculés, l'outil ne suivait pas ces fichiers ; avec des chemins littéraux
(`js/modules.js`) il les lit, donc leurs constats qui existaient déjà comptent maintenant (la surface exécutée passe de 183 à 200 fichiers). Mesure statique de l'axe C, même dépôt : avant le lot 5 la
pénalité était de 131,6 (note 3), après elle est de 106,6 (note 6). Le lot ôte C-EXFIL-06 (4 `import()` calculés) et C-XSS-02 (`document.write` d'ECharts), ramène C-EXFIL-05 de 4 `<script>` calculés à 1 (le chargeur lui-même) ;
mais **40,6 points de la pénalité restante sont des constats anciens que l'outil ne voyait pas** : C-PM-01 × 2 et C-PM-02 (le kit de GFS, un `Worker` de DuckDB) et un C-EXFIL-02 de DuckDB (voir « Voulu »). Sans eux la pénalité serait
de 66 (note 34) : cinq constats majeurs de structure (C-GRIST-03, C-GRIST-04, C-EXFIL-04, C-EXFIL-05 sur le chargeur, C-EXFIL-02 sur la pièce jointe) et deux mineurs (C-CSP-01, C-STOCK-01). B perd 3 points
(B-NOM-01 : trois noms très courts dans `kit/js/dom.js`, que l'outil lit maintenant) ; A passe de 19 à 22 sans que ce lot vise cet axe.

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
  `keywords-panel.js`, `main.js`, `state.js`, `styles.js`, `welcome.js` ; six noms d'une lettre arrivés avec les exports PDF/PPTX et Excel refaits
  (`js/export.js`, `js/snapshot.js`, `js/pdf-writer.js`) renommés dans la foulée, la règle étant revenue avec eux. Aucun nom exporté (`GristBI.*`) ni clé de configuration ne change.
  Quatre essais de `dev-tests/test-data.js` lisent le texte des sources avec des expressions régulières : ils suivent les nouveaux noms.
  Comparé à `main` dans Chromium (22 types de tuile, 6 000 lignes pour passer par DuckDB, page directe et `<iframe sandbox="allow-scripts">`) :
  0 pixel de différence, aucune erreur de console.
- **A-TAILLE-01** (partiel) : les trois fichiers de plus de 1 200 lignes de code sont coupés, un à la fois, avec la même vérification à chaque fois
  (essais Node, puis Chromium : 22 types de tuile, 6 000 lignes pour passer par DuckDB, page directe et `<iframe sandbox="allow-scripts">`, comparaison de pixels avec `main`, clics réels) :
  `js/data.js` (1 343 lignes de code) devient `js/data.js` (897) + `js/data-tiles.js` (492) ; `js/charts.js` (1 957) devient `charts-core.js`, `charts-cards.js`,
  `charts-cloud.js`, `charts-extra.js` et `charts.js` ; `js/main.js` (2 752) devient `main-core.js`, `main-fields.js`, `main-form.js`, `main-panel.js`,
  `main-filters.js`, `main-dialogs.js`, `main-render.js`, `main-session.js` et `main.js` (le point d'entrée). Aucun fichier ne dépasse plus 600 lignes de code, sauf `js/advice.js`,
  `js/data.js` et `js/i18n.js` (seuil mineur). Même API (`GristBI.*`), mêmes noms de fonction ; les fichiers d'un même ensemble partagent un objet interne
  (`GristBI.chartParts`, `GristBI.mainParts`) : voir `CLAUDE.md` §2 pour les règles de ce partage (raccourcis à liaison tardive, `let` partagés rangés dans `parts.S`).
  Comparé à `main` : 0 pixel de différence sur les 22 types de tuile (page directe et cadre isolé), mêmes résultats aux clics réels (filtre croisé, histogramme,
  agrandissement, suppression) et au parcours d'interface complet (ajout/modification de tuile, filtres, vues, Réglages, langue, changement de table), aucune erreur de console.

### Lot 5 : sécurité applicative (18/11/2026, soir ; demande d'Antoine : « la sécurité d'abord »)

- **C-XSS-01** (`innerHTML`, PR #130) : voir « Revue de C-XSS-01 » ; tout balisage passe par `js/safe-html.js` (liste blanche), jamais par `innerHTML`.
- **C-EXFIL-05 / C-EXFIL-06** (code chargé à l'exécution) : UN chargeur, `js/loader.js` (un seul `createElement('script')` du dépôt : https hors du site de la page, empreinte `integrity`
  obligatoire pour un autre site, liste d'hôtes, aucun identifiant dans l'adresse, empreinte mal formée refusée parce qu'un navigateur l'ignorerait en silence) et `js/modules.js` (les quatre modules ES,
  en chemins LITTÉRAUX, demandés par nom). ExcelJS (même site), PptxGenJS (`cdn.jsdelivr.net`, empreinte, sans référent), pdf.js et les extensions de GFS (empreinte de GFS) passent par lui.
  **Pourquoi un fichier de modules et pas un `import()` littéral dans chaque fichier** : dans le cadre isolé de GFS un `import()` écrit dans un script classique n'a pas d'adresse de base
  (mesuré cassé le 18/11/2026 par un premier essai, repris) ; écrit dans un module il se résout. Garde : `node dev-tests/test-loader.js`. Mesuré dans Chromium, page directe et
  `<iframe sandbox="allow-scripts allow-downloads">` servi en CORS : 22 types de tuile, DuckDB au-delà de 5 000 lignes, fenêtre du kit, ambiance et lien GFS, exports Excel / PPTX (vraie bibliothèque) / PDF
  téléchargés, extension à bonne empreinte chargée et à empreinte fausse refusée par le navigateur, `http:` / `javascript:` / `data:` / sans empreinte / adresse en guise de nom de module refusés,
  0 script étranger dans la page ; 0 pixel de différence dans le cadre isolé avec la version d'avant (140 pixels en page directe : le bruit d'animation connu).
- **C-XSS-02** (`document.write` dans ECharts) : la barre d'outils `saveAsImage` (que ce widget n'emploie pas) perd ses deux branches pour Internet Explorer et l'ancien Edge, qui écrivaient une page par
  `document.write` ; `windowOpen` n'ouvre plus qu'une adresse `http(s)://` et coupe `opener` (un lien `javascript:`/`data:` d'une option ne s'exécute plus). `node dev-tests/patch-echarts.js` rejoue les cinq
  modifications ; `test-loader.js` évalue `windowOpen` dans un `vm` ; `js/vendor/SOURCES.md` à jour. `duckdb-browser.mjs` reçoit une ligne d'en-tête (nom, version, licence, origine), sans quoi l'outil ne
  reconnaît plus la bibliothèque et plafonne la note globale (B-MIN-01) maintenant qu'il la lit.
- **C-EXFIL-02** (`fetch` d'une pièce jointe, `js/grist-api.js`) : l'adresse que Grist donne avec le jeton (`getAccessToken`) n'est suivie que si elle est en https (ou en http sur la machine locale / pour une page
  elle-même en http), sans identifiant, requête ni fragment (`safeAttachmentBase`, testée), et la requête part sans cookies ni référent (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`). Le jeton ne part
  jamais vers une adresse que Grist n'a pas donnée en bonne forme. L'outil continue de compter le `fetch` (adresse calculée par nature).
- **Documentation** : le README liste ce que le widget charge, d'où et quand (« Sécurité et permissions ») ; `GFS-ETAT.md` dit ce qui change pour GFS (modules en CORS, empreinte exigée d'une extension).

## Voulu, ou hors de portée de ce dépôt

- **C-EXFIL-04** : le script d'API de Grist vient de `docs.getgrist.com` (`index.html`). C'est le chargement normal d'un widget
  Grist ; GFS note le même constat chez lui comme voulu.
- **C-GRIST-03 / C-GRIST-04** : accès `full` et modification de la structure du document. Voir `CLAUDE.md` §3 : l'API des widgets
  n'a pas de palier entre « une table » et « tout » ; les seules tables créées sont `BI_Dashboard_Config`, `BI_Dashboard_Comments`,
  `BI_Dashboard_UserProbe` (et la table d'un import CSV, après confirmation de la personne).
- **C-EXFIL-05** (1 constat, `js/loader.js` : `el.src = plan.url`) : c'est le chargeur lui-même ; l'adresse a déjà passé `planScript` (voir « Lot 5 ») mais l'outil ne sait pas lire cette validation.
  Un script ne se charge nulle part ailleurs dans le dépôt. **C-EXFIL-06** n'a plus de constat : les `import()` sont des chemins littéraux dans `js/modules.js`.
- **C-EXFIL-02** (2 constats) : le `fetch` d'une pièce jointe dans `js/grist-api.js` (voir « Lot 5 », l'adresse est contrôlée) et un `fetch` dans `js/vendor/duckdb/duckdb-browser.mjs` (le chargement du `.wasm` et du
  worker, adresse calculée par la bibliothèque sur celle de ses propres fichiers, que ce widget donne en dur dans `js/duckdb-engine.js` : `VENDOR_BASE_URL`). Ce second constat n'existait pas pour l'outil avant le lot 5 : il ne voyait pas le fichier.
- **C-PM-01 × 2 / C-PM-02** (`kit/js/gfs-link.js`, `js/vendor/duckdb/duckdb-browser.mjs`) : arrivés avec la visibilité du lot 5, aucun n'est dans du code de ce dépôt. Le kit vérifie `event.source` et le jeton de contrat avant de
  lire un message (l'outil cherche `event.origin`, qu'un cadre isolé ne peut guère écrire en dur) et poste à `host.parent` avec `'*'` ; DuckDB écoute les messages de ses propres `Worker`. Question posée à GFS dans `GFS-ETAT.md`
  (« Questions pour GFS ») pour l'adresse de destination ; `kit/` n'est pas modifié ici (sous-module de GFS).
- **A-PERF-01** (information, 0 point) : deux boucles de `js/grist-api.js` attendent Grist une fois par tour, et les deux doivent rester en série.
  `applyActionsInChunks` (ligne 443) envoie une liste d'actions par lots de 2 000, dans l'ordre : l'ordre des `AddRecord` est l'ordre des lignes de la table, et un échec en
  cours de route laisse un préfixe connu plutôt qu'un trou ; en parallèle, les lignes arriveraient dans le désordre et la progression affichée n'aurait plus de sens.
  La boucle de `tableExistsConfirmed` relit `listTables()` avec des délais croissants (300 ms à 4,8 s) : c'est une *attente*, la course contre la négociation d'accès (`CLAUDE.md` §7 piège n°1).
- **F-SOUV-01** : `cdn.jsdelivr.net` pour PptxGenJS (version figée, SRI), dérogation actée par Antoine le 29/09/2026 (`CLAUDE.md` §8) ; pdfmake et cdnjs ont disparu le 18/11/2026.
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
- **Dans ECharts** : C-XSS-02 (`document.write` de la barre d'outils `saveAsImage`) est retiré au lot 5 ; restent C-XSS-04 (minuteries, information, sans pénalité) et, côté DuckDB, C-EXFIL-02 (une requête dont l'adresse est calculée). Ce widget n'active ni barre d'outils, ni carte, ni `geo` (aucun `toolbox`, `registerMap` ni `geo` dans `js/charts.js`), et l'axe D, qui capture le trafic réellement émis,
  n'observe aucune requête vers un domaine tiers (D-RESEAU-00).

## Reste à faire

- **A-TAILLE-01** (3 fichiers, seuil mineur) : `js/advice.js` 979 lignes de code, `js/data.js` 897 et `js/i18n.js` 883. Plus aucun fichier au-dessus du seuil majeur
  (1 200). Le découpage de `advice.js` suivrait le même schéma que `data.js` ; `i18n.js` est surtout un dictionnaire, ce qui est une donnée plutôt qu'un code à couper.
- **A-FONC-01 / A-FONC-02 / A-FONC-03** : 46 fonctions longues, 50 trop ramifiées, une imbrication de profondeur 6 (`captureTileImages`). Les plus lourdes sont `readTileForm`
  (135 chemins), `adviceForTile` (103), `defaultsForType` (82), `renderChart` (73) : ce sont les fonctions que chaque nouveau type de tuile modifie. Ces deux règles sont
  déjà au plafond de leur pénalité (30 points chacune) : il faut les faire disparaître *toutes* pour gagner, pas en réduire le nombre. Une table de correspondance par type
  remplace les cascades de `if` ; à faire quand plus aucun fil n'ajoute de type de tuile. Les « fonctions anonymes de 900 lignes » sont l'enveloppe
  `(function (root, factory) { … })` de chaque module : c'est l'architecture « scripts classiques, sans build ».
- **Axe C (sécurité applicative, 6/100 après le lot 5, 1/100 avant)** : ce qui reste est de structure ou n'est pas du code de ce dépôt, et l'outil ne peut pas le savoir : C-GRIST-03 et C-GRIST-04
  (accès `full` et écriture dans la structure du document : l'API des widgets n'a pas de palier intermédiaire ; le README dit maintenant précisément ce que le widget lit et écrit), C-EXFIL-04 (l'API de widget vient de
  `docs.getgrist.com` : la remplacer par une adresse relative demande que Grist l'héberge sous l'instance du document, ou une copie vendorisée qui dériverait du protocole), C-STOCK-01 (deux préférences en `localStorage`), un
  seul `<script>` dynamique (le chargeur), le `fetch` d'une pièce jointe (contrôlé) et trois constats qui viennent du kit et de DuckDB (voir « Voulu »). L'axe est rendu par un plancher doux (8·exp(−(pénalité − 92)/40)) :
  tant que la pénalité reste au-dessus de 92, la note reste sous 8, quelle que soit la sécurité réelle. **Un chiffre honnête** : tant que le kit et DuckDB sont lus par l'outil, l'axe reste autour de 6 (pénalité 106,6) ; hors leurs trois constats il serait de 34 (pénalité 66), et il ne remonterait plus que si Grist offrait un
  palier d'accès intermédiaire ou hébergeait son API de widget sous l'instance, ou si GFS corrigeait ses constats. La valeur du lot est dans ce que les contrôles empêchent (XSS par la configuration, script non prévu, jeton envoyé ailleurs), pas dans la note.
- **C-CSP-01** : aucune politique de sécurité de contenu. DuckDB-WASM (`wasm-unsafe-eval`, worker `blob:`), l'`importmap` en ligne,
  les attributs `style` et les scripts de `cdnjs` demandent une politique à mesurer dans un vrai Grist et dans GFS avant d'en poser
  une : une balise `<meta>` trop stricte casserait le widget sans message. Non posée ici. Et même sans `unsafe-eval`, deux copies de code qui
  compile une chaîne restent dans `js/vendor/` : le worker de DuckDB (`duckdb-browser-eh.worker.js`) embarque sa propre copie d'Apache
  Arrow, avec le même `createIsValidFunction` que celui qu'on a remplacé dans `apache-arrow/` (copie non modifiée : l'outil ne la
  voit pas, elle est chargée dans un `Worker`, et ce widget n'y déclare jamais de valeurs nulles), et ExcelJS (voir `SOURCES.md`).
- **B-VERB-01** (13 750 lignes de code exécutées : l'ampleur du widget, pas un défaut à corriger) et **F-ECO-01** : voir le rapport.
