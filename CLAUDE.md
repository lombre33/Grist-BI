# CLAUDE.md

Ce fichier donne à une nouvelle session Claude tout le contexte nécessaire pour travailler sur ce
dépôt sans avoir à redemander l'historique du projet. Il a été écrit en lisant l'intégralité du
dépôt (code, README.md, ROADMAP.md, HYPOTHESES.md, TEST_PROTOCOL.md) le 2026-09-19 ; rien ici n'est
inventé — tout est sourcé, et les points qui n'ont pas pu être vérifiés depuis cette session sont
signalés explicitement en fin de document.

## 1. Qu'est-ce que ce projet

**Grist BI Dashboard** est un widget personnalisé [Grist](https://www.getgrist.com/), au stade
**brouillon / preuve de concept (POC) — pas prêt pour un usage réel** (README.md:3). Il reprend, à
l'intérieur d'un seul widget, des mécaniques inspirées de **Power BI** et **DigDash** que Grist n'a
pas nativement :

- plusieurs tuiles (graphiques + cartes KPI) affichant la même table, avec **cross-filtering** au
  clic entre tuiles (à la façon d'un slicer Power BI) ;
- **drill-down à N niveaux** par tuile, avec fil d'Ariane cliquable ;
- **tendance KPI** (comparaison à la période précédente, delta en %) ;
- **dashboards multi-pages**, **vues sauvegardées (bookmarks)**, **filtres avancés** typés
  (plage numérique, plage de dates, dates relatives, recherche texte) ;
- **export Excel** (`.xlsx`, une feuille par tuile) ;
- **autocomplétion** (composant maison) sur tous les sélecteurs de colonne, y compris un
  **sélecteur de table** pour se reconnecter à n'importe quelle table du document.

La raison d'être de ce POC (ROADMAP.md:5-11, HYPOTHESES.md:5-11) : un widget personnalisé Grist ne
peut pas piloter un widget voisin sur la même page, donc la seule façon de démontrer un
cross-filtering façon Power BI est de tout faire vivre **à l'intérieur d'un seul widget**, avec ses
propres tuiles internes.

Architecture reprise de [publipostageGrist](https://github.com/lombre33/publipostagegrist), du même
auteur (Antoine, `lombre33`) : **page statique unique, aucune étape de build**. La configuration du
dashboard est stockée dans une table Grist interne cachée (`BI_Dashboard_Config`).

**Note du 2026-09-19 — à revérifier avant de s'appuyer dessus** : Antoine a indiqué dans un autre
fil de discussion ne plus avoir besoin de code capable de créer une nouvelle table Grist. Cette
décision n'est ni actée ni appliquée dans le code au moment de la rédaction de ce document — la
section 3 ci-dessous décrit donc le mécanisme de création de table (`BI_StressTest`) tel qu'il
existe encore aujourd'hui, avec toute sa robustesse contre la duplication de données, mais ce
périmètre est en cours de réexamen. Vérifier l'état de cette discussion avant de considérer ce
mécanisme comme un pilier acquis de l'architecture.

## 2. Structure du dépôt et rôle de chaque fichier

Pas de `package.json`, pas d'étape de build : `index.html` charge directement chaque script via
`<script src="...">`, dans un ordre précis (voir la fin du `<body>` d'`index.html`) :
`i18n.js → data.js → combobox.js → demo-data.js → state.js → charts.js → export.js →
pdf-export.js → pptx-export.js → grist-api.js → duckdb-engine.js → main.js`. `i18n.js` est chargé en tout premier
(depuis le 29/09/2026, bilingue fr/en — voir le tableau ci-dessous) pour que tous les scripts
suivants lisent `GristBI.i18n.t()` comme un global déjà prêt.

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique du widget : tout le DOM (barre de tuiles, formulaire d'ajout/édition, barre de filtres avancés, sélecteur de table, onglets de pages, bookmarks, panneau Réglages/Crédits), le chargement d'ECharts/SheetJS vendorisés localement, l'`importmap` qui résout les imports nus de DuckDB-WASM vers les copies vendorisées, et l'ordre de chargement des scripts JS. |
| `css/style.css` | Layout des tuiles (grille CSS `repeat(auto-fill, minmax(270px,1fr))`), design tokens (palette catégorielle colorblind-safe validée via la skill *dataviz* du projet). Contient plusieurs correctifs CSS documentés (voir §7). |
| `js/i18n.js` | Bilingue fr/en (depuis le 29/09/2026) : dictionnaire `STRINGS` fr/en, `t(key, vars)` (variables + pluriel via `Intl.PluralRules`), attributs `data-i18n`/`data-i18n-html`/`data-i18n-title`/`data-i18n-aria`/`data-i18n-placeholder` résolus par `applyTranslations()`. **Chargé en tout premier**, langue persistée en `localStorage` (`gristbi_lang`). Ne couvre QUE la chrome de l'interface — le contenu généré à partir de noms de colonnes (titres de tuile, en-têtes d'export Excel dans `js/data.js`) reste hors périmètre, voir HYPOTHESES.md. |
| `js/data.js` | Cœur **pur JS, testable sous Node**, sans DOM ni Grist : conversion du format colonnaire Grist en lignes, filtrage (`matchesFilter`/`applyFilters`, types `eq`/`range`/`dateRange`/`relativeDate`/`contains`), agrégation (`groupByAggregate`, `aggregateSingle`, agrégateurs sum/avg/count/min/max), tendance KPI (`computeTrend`), échappement HTML, toute la logique d'export Excel (`rowsForTile`, `tileExportSheet`, `buildWorkbookSheets`, `sanitizeSheetName`) partagée avec le rendu à l'écran, et le data blending multi-tables (`blendRows` : LEFT JOIN en JS pur entre lignes principales et secondaires, colonnes secondaires préfixées `<table>.<colonne>` — voir §6/ROADMAP.md). |
| `js/state.js` | Store pub/sub **pur JS, testable sous Node** (`createStore()`) : pages (chacune avec son propre tableau de tuiles), filtres croisés et filtres avancés (globaux entre pages, volontairement), chemins de drill-down par tuile (`drillIns`), bookmarks, jointure de data blending courante (`blend`, propre à la table de travail comme les bookmarks). Expose `getState`/`subscribe` + mutateurs (`addTile`, `updateTile`, `toggleFilter`, `drillInto`/`drillUp`, `saveBookmark`, `setBlend`, etc.). |
| `js/grist-api.js` | **Seul pont** entre le widget et l'hôte Grist. Voir §3. |
| `js/duckdb-engine.js` | Moteur SQL **DuckDB-WASM**, fondation du Tier 2 de la roadmap. **Chargé paresseusement** (rien n'est téléchargé tant que `init()` n'est pas appelé explicitement) — voir §6/§7. **Aucune fonctionnalité UI ne l'utilise encore** (confirmé par recherche dans tout le dépôt : seuls `duckdb-engine.js` lui-même, `dev-tests/test-data.js` et `HYPOTHESES.md` le mentionnent). |
| `js/demo-data.js` | Génère l'unique jeu de données du widget, `BI_StressTest` (~47 040 lignes : 4 régions × 5 produits × 7 années × 12 mois × 28 jours fixes), avec des valeurs Quantité/Montant cohérentes entre elles (croissance +6 %/an), et les 4 tuiles par défaut. |
| `js/charts.js` | Rendu ECharts pour les 6 types de tuiles (bar/pie/treemap/scatter/kpi/gauge), une instance ECharts par tuile mise en cache, gestionnaire de clic générique (drill-down vs cross-filter) qui relit l'état du store en direct à chaque clic plutôt que de capturer des variables au moment du rendu. |
| `js/combobox.js` | Composant d'autocomplétion réutilisable, DOM-agnostique pour sa logique de filtrage (`filterOptions`, `highlightMatch`) + câblage DOM (`attach`). Modes `strict` (doit correspondre à une option, comme un `<select>`) et non-strict (texte libre, suggestions seulement). |
| `js/export.js` | Construit le classeur `.xlsx` (une feuille par tuile, toutes pages confondues) via SheetJS vendorisé (`window.XLSX`) et déclenche le téléchargement. |
| `js/pdf-export.js` | Export PDF (page actuellement affichée uniquement) via pdfmake, chargé depuis un CDN externe et non vendorisé (exception, voir §8) — capture l'image de chaque graphique déjà rendu (`GristBI.charts.getInstance`) plutôt que de recalculer, ce qui évite le mur asynchrone des tuiles en mode mesure DAX rencontré par l'export Excel. |
| `js/pptx-export.js` | Export PPTX (page actuellement affichée uniquement) via PptxGenJS, même dérogation CDN/même stratégie de capture d'image que `js/pdf-export.js` — une diapositive par tuile (image ou tableau natif `slide.addTable`, selon `GristBI.data.tileExportKind`) plutôt qu'une grille façon écran. |
| `js/vendor/echarts/`, `js/vendor/xlsx/`, `js/vendor/duckdb/`, `js/vendor/apache-arrow/`, `js/vendor/flatbuffers/`, `js/vendor/tslib/` | Bibliothèques tierces **vendorisées localement, jamais chargées depuis un CDN externe** — voir §7 pour la raison (bug réel rencontré). |
| `dev-tests/` | Harnais de test hors Grist — voir §5. |
| `README.md` | Vue d'ensemble produit, fonctionnalités, installation dans Grist, historique condensé des bugs réels corrigés. |
| `ROADMAP.md` | **Source unique des priorités** — voir §6. |
| `HYPOTHESES.md` | **Journal détaillé** de ce qui est implémenté/testé et de ce qui reste à valider en conditions réelles — voir §6. |
| `TEST_PROTOCOL.md` | Protocole de test qui grandit à chaque feature — voir §5. |
| `LICENSE` | **GNU GPL v3.0** pour le code de ce dépôt (passé de MIT le 2026-09-29, identité Grist Factory — voir §8). Chaque dossier `js/vendor/*` contient sa propre licence (Apache-2.0 pour ECharts/SheetJS/Apache Arrow/FlatBuffers, MIT pour DuckDB-WASM, 0BSD pour tslib). |
| `img/grist-factory-logo.jpg` | Avatar Grist Factory fourni par Antoine (2026-09-29), redimensionné/compressé en local (60×60, ~1,3 Ko) — jamais un asset à recréer ou deviner. Affiché dans le bandeau du haut, juste à droite du bouton Réglages (`index.html`). |

Il n'y a **aucune issue GitHub ouverte, aucun TODO dans le code, et aucune configuration CI**
(pas de dossier `.github/workflows` au moment de la rédaction) — vérifié par recherche dans tout le
dépôt. Les tests se lancent manuellement (voir §5).

## 3. Comment le widget dialogue avec Grist (`js/grist-api.js`)

- **Accès requis** : `grist.ready({requiredAccess: 'full'})` (`grist-api.js:47`). Justifié par la
  nécessité de créer/lire la table de config interne `BI_Dashboard_Config` — l'API widget Grist
  n'offre pas de palier intermédiaire entre « lecture d'une seule table » et « accès complet ».
  La restriction fine des données doit passer par les Règles d'accès natives de Grist, pas par la
  configuration du widget.
- **`grist.onRecords()` n'est jamais appelé** (décision délibérée, `grist-api.js` header) : le
  widget ne s'appuie plus sur la table liée à la page hôte, il se connecte tout seul à sa propre
  table de travail au démarrage.
- **Verbes Grist utilisés** : `grist.docApi.listTables()`, `grist.docApi.fetchTable()`,
  `grist.docApi.applyUserActions()` avec `AddTable`, `AddRecord`, `UpdateRecord`, `RenameTable`,
  `AddColumn`. **`RemoveTable` n'est jamais utilisé nulle part dans ce projet** — jugé verbe non
  éprouvé pour ce chemin critique de sécurité des données ; une table orpheline créée par une
  collision de nom est laissée en place plutôt que supprimée automatiquement.
- **Connexion par défaut** : au bootstrap (`main.js:bootstrap`, en bas du fichier), le widget se
  connecte automatiquement à sa table de travail fixe **`BI_StressTest`** (nom qui ne change plus
  jamais) via `loadOrCreateStressData()` → `loadOrCreateTable()`, de façon **idempotente** : si la
  table existe déjà, elle est juste relue ; sinon elle est créée et remplie par lots de 2000
  actions (`applyActionsInChunks`, `ACTION_CHUNK_SIZE = 2000`).
- **Évolution de schéma sans jamais recréer de table** : `ensureColumnsUpToDate(tableId, columns,
  deriveMissingColumns, onProgress)` diffuse les colonnes manquantes via `AddColumn` puis
  recalcule leur valeur **en JS** (jamais via une formule Grist — ce projet n'utilise aucun
  langage de formule Grist, par choix explicite) et les écrit via `UpdateRecord`. C'est le
  mécanisme retenu après une évolution de politique du projet (voir §7) : plus jamais de nouvelle
  table pour un changement de schéma.
- **Sélecteur de table** : `listAvailableTables()` (toujours une lecture fraîche, jamais en cache,
  filtre `BI_Dashboard_Config` de la liste) et `loadTable(tableId)` (simple `fetchTable`, sans
  création/remplissage) permettent de se reconnecter à n'importe quelle autre table du document —
  celle-ci démarre alors sur un dashboard vide.
- **Garde-fous contre la duplication de données** — le bug le plus grave rencontré sur ce projet
  (voir §7) a produit deux mécanismes de protection toujours actifs dans le code :
  1. `tableExistsConfirmed()` : au tout premier contrôle d'existence de la session, ré-interroge
     `listTables()` avec des délais croissants (`RACE_GUARD_RETRY_DELAYS_MS = [300,600,1200,2400,4800]` ms,
     ~9,3 s au pire) avant de conclure qu'une table n'existe vraiment pas.
  2. **Filet de sécurité indépendant** : après un `AddTable`, le code compare le `table_id` réel
     retourné (`actualAddTableId`) à celui demandé — Grist ne renvoie jamais d'erreur sur une
     collision de nom, il suffixe silencieusement l'id créé. Une différence prouve qu'un faux
     négatif est passé au travers du garde n°1 ; le code abandonne alors le remplissage de la
     table fantôme (vide) et bascule sur le chemin « la table existe déjà ».
- Config du dashboard : `loadConfig`/`saveConfig` lisent/écrivent `BI_Dashboard_Config` (colonnes
  `TableId`/`ConfigJSON`, JSON texte) ; `normalizeConfig()` sait lire 3 formats historiques
  (tableau brut de tuiles → `{tiles, bookmarks}` → format actuel `{pages, currentPageId,
  bookmarks}`).

## 4. Lancer et prévisualiser en local

**Dans Grist (conditions réelles)** — README.md:111-119 :
1. Publier ce dépôt en page statique (GitHub Pages : Settings → Pages → Deploy from branch → `main`
   / racine).
2. Dans une page Grist, ajouter un widget personnalisé, coller l'URL GitHub Pages, le lier à une
   table quelconque (même vide — le widget ne s'en sert pas, il se connecte tout seul à sa propre
   table de travail).
3. Accepter la demande d'accès `full` au chargement.

**Preview locale sans Grist** — `dev-tests/harness.html` :
- Ouvrir `dev-tests/harness.html` directement dans un navigateur (double-clic) : **aucun build, aucun
  serveur requis** pour l'essentiel des tests.
- Ce harnais charge exactement les mêmes fichiers applicatifs que `index.html` (même DOM, même CSS,
  même chaîne de scripts JS, y compris ECharts vendorisé), mais remplace
  `grist-plugin-api.js` par `dev-tests/grist-stub.js` : un faux `window.grist` en mémoire qui simule
  `docApi.listTables`/`fetchTable`/`applyUserActions` (`AddTable`/`AddRecord`/`UpdateRecord`/
  `RemoveRecord`/`AddColumn`/`RenameTable`) **sans persistance** — un `page.reload()` y perd tout,
  contrairement à un vrai document Grist. Le widget s'y connecte automatiquement à sa table de test
  de charge simulée (`BI_StressTest`, ~47 040 lignes).
- **Exception** : `js/duckdb-engine.js` fait un `import()` dynamique de module ES, bloqué par CORS
  sous `file://` (origine `"null"`). Un test qui l'exerce réellement doit servir le dépôt via un
  petit serveur HTTP local (`http.createServer` de Node, sans dépendance ajoutée) plutôt que
  `file://`. Sans impact sur l'usage normal du widget puisque ce moteur est chargé paresseusement et
  n'est jamais appelé au démarrage.
- **Ce que ce mock ne prouve pas** : le comportement réel de `grist.docApi` dans un vrai document
  Grist — voir `HYPOTHESES.md`, section « Points à valider en conditions réelles », et §6/§8
  ci-dessous.

## 5. Comment jouer les tests

- **`node dev-tests/test-data.js`** — logique pure, sans navigateur ni Grist. Exerce `js/data.js`
  (agrégation, filtrage, tendance, échappement HTML, export), `js/state.js` (store complet),
  `js/demo-data.js` (génération/cohérence du jeu de données), `js/combobox.js` (filtrage/surlignage
  seulement — le câblage DOM est laissé à des tests navigateur), `js/duckdb-engine.js`
  (**seulement** `csvEscape`/`assertSafeIdentifier` : le chargement réel et l'exécution SQL
  nécessitent un vrai navigateur) et `js/i18n.js` (complétude du dictionnaire fr/en, `t()`/
  `getLang()`/`setLang()`, substitution de variables/pluriel — l'application des attributs
  `data-i18n-*` au DOM est laissée à des tests navigateur).
- **`dev-tests/harness.html`** — rendu visuel dans un navigateur avec un faux `window.grist`, sans
  document Grist réel (voir §4).
- **Point important à savoir avant de chercher des fichiers de test** : `HYPOTHESES.md` et
  `TEST_PROTOCOL.md` citent abondamment des suites Playwright nommées (`table-race-test.js`,
  `combobox-test.js`, `tile-height-stability-test.js`, `filter-value-autocomplete-test.js`,
  `table-picker-test.js`, `schema-migration-test.js`, `restore-default-tiles-test.js`,
  `combobox-integration-test.js`, `duckdb-engine-test.js`, etc.). **Aucun de ces fichiers n'est
  présent dans ce dépôt** — vérifié par inspection du contenu réel de `dev-tests/` (seulement
  `grist-stub.js`, `harness.html`, `test-data.js`, `README.md`). `dev-tests/README.md:29-32` le
  confirme explicitement pour `duckdb-engine-test.js` (« dans le scratchpad de développement, pas
  committé ici ») — cela semble s'appliquer à l'ensemble de cette suite Playwright : elle a servi à
  valider chaque feature au moment du développement mais ne peut pas être rejouée depuis un clone
  frais de ce dépôt. Seuls `test-data.js` et `harness.html` sont committés et exécutables tels
  quels.
- **`TEST_PROTOCOL.md`** — protocole vivant, organisé en : une checklist méthodologique fixe à
  appliquer à chaque nouvelle feature (cas nominal, vide/zéro, valeurs limites, coercition de type,
  ordre non trivial, combinaison avec l'existant, persistance + rétrocompatibilité, idempotence,
  nettoyage à la suppression, visibilité réelle via `isHidden()` et pas seulement `.hidden`, état
  vivant vs. variable figée dans une closure, distinction explicite réel/mock, rendu visuel via
  captures d'écran, stabilité dans le temps) ; un catalogue exhaustif par module (cases ✅
  Node-automatisé / 🌐 Playwright-automatisé / ⬜ documenté seulement) ; une liste permanente de 18
  bugs réels (jamais supprimée, seulement adaptée) ; une note de flakiness connue (clics sur points
  de scatter proches, dû à des données aléatoires non seedées — pas un bug produit) ; et une liste
  explicite de cas non testables depuis ce sandbox (round-trip réseau réel vers `applyUserActions`,
  lecture de `_grist_Tables`/`_grist_Tables_column`, probe `getCurrentUserEmail`, redimensionnement
  réel du panneau Grist, comportement mobile réel).
- **Process** (`TEST_PROTOCOL.md:9-19`) : ajouter des cas de test à chaque nouvelle feature (qu'ils
  soient automatisés ou non), automatiser sous Node ou documenter un scénario Playwright, rejouer
  `test-data.js` + la suite Playwright de temps en temps (typiquement avant un commit
  multi-module), ne jamais supprimer une entrée `[BUG RÉEL]`.
- **Pas de CI** : aucun pipeline n'exécute ces tests automatiquement à ce jour.

## 6. Où sont suivies les priorités et les hypothèses non vérifiées

- **`ROADMAP.md`** est la **source unique des priorités**. Structure en paliers, priorisés par
  valeur × risque de faisabilité :
  - **Tier 1** et **Tier 1.5** : ✅ entièrement terminés (2026-09-16).
  - **Tier 2** (chantiers structurants, toujours sans backend) : en cours. Le moteur SQL
    DuckDB-WASM (`js/duckdb-engine.js`) est posé comme fondation, consommé depuis par les mesures
    façon DAX (`timeSeriesMeasures`) et le tableau croisé — **le data blending, lui, n'en dépend
    pas** (`js/data.js:blendRows`, LEFT JOIN en JS pur, voir §2). ✅ Faits (voir ROADMAP.md pour le
    détail de chacun) : mesures façon DAX simplifié, tableau croisé dynamique, export PDF/PPT, data
    blending multi-tables. Restent à faire : drill-down hiérarchique automatique, commentaires
    collaboratifs.
  - **Tier 3** : faisable seulement en sortant du widget (nécessite un service externe avec
    backend/cron — alertes email/SMS, rafraîchissement programmé réel, Q&A IA générative,
    embedding live hors Grist).
  - **Tier 4** : structurellement bloqué par l'architecture « widget JS statique sans backend »
    (Row-Level Security réelle, carte géographique générique, etc.) — à ne jamais promettre tel
    quel.
  - Une correction technique importante du 2026-09-15 a révisé plusieurs affirmations initiales de
    la roadmap après vérification dans le code réel du widget frère `publipostageGrist` : le widget
    **peut** en réalité lire les vrais types de colonnes Grist (`_grist_Tables_column`) et obtenir
    l'identité de l'utilisateur courant (pattern table-sonde à formule déclenchée) — ce POC ne le
    fait pas encore, mais ce n'est plus considéré comme bloqué.
- **`HYPOTHESES.md`** (~1285 lignes, dense) est le **journal de vérité** sur ce qui a vraiment été
  testé et où. Il documente, dans l'ordre chronologique, chaque feature livrée avec où/comment elle
  a été testée (Node, Playwright contre le mock, **jamais** un vrai document Grist), les bugs réels
  trouvés à cette occasion, une section « délibérément hors scope pour ce POC », et une liste
  numérotée (14 points + un « 13bis ») de **points à valider en conditions réelles** — notamment :
  le round-trip réseau réel d'`applyUserActions` sur un gros volume, le déclenchement réel du
  téléchargement Excel depuis l'iframe du widget, le comportement réel d'`AddColumn`/`RenameTable`
  sur un vrai document, et le chargement du binaire DuckDB-WASM (~34 Mo) depuis GitHub Pages.
- **`TEST_PROTOCOL.md`** est le protocole de test associé, qui grandit à chaque nouvelle feature de
  la roadmap (voir §5).

## 7. Pièges déjà rencontrés — à ne pas refaire

Cette liste condense les bugs réels les plus instructifs (détail complet dans `HYPOTHESES.md` et
`TEST_PROTOCOL.md`, qui en documentent une vingtaine au total) :

1. **Le bug le plus grave du projet** : `grist.ready()` **ne renvoie pas de promesse** — la
   véritable négociation d'accès avec l'hôte se termine de façon asynchrone après le retour de
   `ready()`. Le bootstrap appelait `listTables()` immédiatement, ce qui pouvait faussement
   indiquer que `BI_StressTest` n'existait pas encore et déclencher un `AddTable` + remplissage
   complet à chaque réouverture du widget — **risque réel de duplication de dizaines de milliers de
   lignes dans le document réel de l'utilisateur**. Remonté DEUX FOIS en conditions réelles ; un
   premier correctif à délai fixe (500 ms) s'est révélé insuffisant. Voir §3 pour les deux
   mécanismes de protection actuellement en place (`tableExistsConfirmed` + comparaison du
   `table_id` réel retourné par `AddTable`).
2. **`RenameTable` ne peut pas être protégé de la même façon** : contrairement à `AddTable`, il ne
   renvoie aucune valeur exploitable côté client en cas de collision de nom — seule une détection
   après coup (nouveau contrôle d'existence + `console.error`) est possible.
3. **Ne jamais recréer une table pour faire évoluer un schéma.** L'ancien mécanisme (suffixer le nom
   de table par une version de schéma) laissait des tables orphelines et a produit un vrai bug en
   production (`KeyError 'Annee'` chez un utilisateur resté sur un schéma obsolète). Remplacé par
   `ensureColumnsUpToDate` + `AddColumn` + backfill JS sur la table existante (voir §3).
4. **CDN externe = risque réseau silencieux.** ECharts chargé depuis `cdnjs.cloudflare.com` a été
   bloqué en conditions réelles par un proxy réseau (institutionnel/entreprise) renvoyant une page
   HTML avec `X-Content-Type-Options: nosniff` à la place du script — symptôme : tuiles
   barres/camemberts vides, **sans aucune erreur explicite** (la carte KPI, elle, fonctionnait). Un
   garde silencieux (`if (typeof echarts === 'undefined') return;`) masquait le problème. Corrigé en
   vendorisant ECharts localement ; même principe appliqué depuis à SheetJS et DuckDB-WASM (+
   Apache Arrow/FlatBuffers/tslib, dépendances transitives elles aussi vendorisées).
5. **Même famille de piège avec DuckDB-WASM** : `read_json_auto`/`read_ndjson_auto` déclenchent le
   téléchargement à la volée de l'extension `json` de DuckDB depuis le CDN externe
   `extensions.duckdb.org` — remplacé par un chargement CSV (`read_csv_auto`), compilé dans le
   binaire `.wasm` déjà vendorisé, donc sans téléchargement supplémentaire.
6. **Un rebuild complet du DOM (`innerHTML=''`) détache silencieusement une instance ECharts mise en
   cache** — le canvas continue d'exister en mémoire mais n'est plus rendu, sans aucune erreur JS.
   `main.js:render()` fait maintenant une réconciliation DOM incrémentale (Map par id de tuile)
   plutôt qu'un rebuild complet.
7. **Comparer une valeur de clic ECharts (`params.name`) avec `===`** échoue silencieusement pour
   une dimension numérique : ECharts renvoie toujours une chaîne, même pour une année. `js/data.js`
   utilise `sameValue()` (`String(a) === String(b)`) partout où une valeur de clic est comparée.
8. **Boucle de redimensionnement infinie** : `.tile` utilisait `min-height` au lieu d'une hauteur
   fixe pendant que `.tile-chart` avait `flex:1` — un `ResizeObserver` remesurant un conteneur dont
   la taille dépend circulairement du graphique qu'il contient grossissait indéfiniment, sans erreur
   JS, invisible sur une capture d'écran unique. Détecté seulement en échantillonnant
   `getBoundingClientRect().height` toutes les ~300-400 ms sur plusieurs secondes — a fait naître
   une nouvelle catégorie méthodologique dans `TEST_PROTOCOL.md` : « stabilité dans le temps, pas
   seulement à l'instant T ». Corrigé en passant `.tile` à une hauteur fixe (224px).
9. **Un `min-height` laissé incohérent après ce correctif** a ensuite fait déborder le canvas
   ECharts sous la carte (jusqu'à ~22px mesurés sur une tuile en drill-down) — tout changement
   structurel de layout doit être ré-audité, pas seulement jugé « ça a l'air bon » sur une ancienne
   capture d'écran.
10. **`[hidden]` vs. une règle d'auteur `display:flex`** : à spécificité CSS égale, une règle
    d'auteur bat toujours la règle native du navigateur `[hidden]{display:none}`, indépendamment de
    l'ordre de chargement. `.hidden = true` en JS n'a alors **aucun effet visuel**. Rencontré 3 fois
    (`.demo-banner`, `.field`, et par précaution étendu à `.combobox-list`) ; nécessite une règle
    explicite `.selector[hidden]{display:none}`.
11. **Un combobox strict qui laisse Entrée sans correspondance sans `e.preventDefault()`** laisse
    fuiter l'événement `change` natif du navigateur avec le texte brut invalide, contournant toute
    la validation — a révélé que le sélecteur de table ne fonctionnait en réalité que grâce à ce
    bug. Toute branche « Entrée sans correspondance » d'un combobox doit appeler
    `e.preventDefault()`, pas seulement la branche de commit réussi.
12. **Taper puis appuyer sur Entrée sans navigation clavier préalable ne commitait rien** (aucune
    option n'était présélectionnée) — trouvé seulement en migrant un vrai formulaire, pas par les
    tests du composant isolé. Corrigé par deux modes d'ouverture distincts (`openOnType` qui
    présélectionne, `openPassive` qui ne présélectionne rien).
13. **Un timer de debounce partagé (`scheduleSave`) qui relit une variable de fermeture au moment du
    déclenchement plutôt qu'au moment de la planification** peut perdre silencieusement une
    sauvegarde : changer de table pendant les 600 ms de debounce faisait sauvegarder sous l'id de la
    **nouvelle** table, ou pire, le `clearTimeout` du nouveau `scheduleSave` annulait la sauvegarde
    en attente de l'ancienne table. Corrigé par `flushPendingSave()` appelé avant tout changement de
    table, et en capturant l'id de table dans l'objet du timer plutôt que dans une closure.
14. **`groupByAggregate` doit préserver l'ordre d'apparition**, jamais trier alphabétiquement (sinon
    « Mois » trierait Avril avant Janvier). DuckDB-WASM ne garantit pas cet ordre nativement — un
    correctif (`__row_idx` + `ORDER BY MIN(__row_idx)`) reproduit le même contrat côté SQL.
15. **La forme réelle de `grist.docApi.listTables()`** est `Promise<string[]>`, pas des objets
    `{id}` — un décalage entre le mock et l'API réelle a laissé une branche défensive du code
    totalement non exercée par les tests jusqu'à ce que ce bug soit trouvé.

## 8. Règles du projet (vérifiées dans le code et la documentation)

- **Zéro dépendance de build, JS vanilla.** Toute bibliothèque tierce est vendorisée localement
  dans `js/vendor/`, jamais chargée depuis un CDN externe (voir piège n°4/5 ci-dessus).
  **Exception actée par Antoine le 2026-09-29** : pdfmake et PptxGenJS (export PDF/PPT, voir
  ROADMAP.md Tier 2) sont chargés depuis `cdnjs.cloudflare.com` à la demande, PAS vendorisés — décision
  explicite après discussion, pour rester cohérent avec le widget frère `publipostageGrist` qui fait
  déjà de même. Cette dérogation ne s'étend PAS aux autres bibliothèques : elle ne vaut que pour
  ces deux-là. Conséquences à respecter dans tout code qui en dépend : version figée dans l'URL du
  CDN (jamais `@latest`), hash SRI (`integrity`/`crossOrigin="anonymous"`), et un échec de
  chargement réseau doit toujours produire un message clair à l'utilisateur (voir
  `js/pdf-export.js`/`js/pptx-export.js`), jamais une page cassée ou un échec silencieux — c'est le
  prix de ne pas vendoriser.
- **Identité Grist Factory (logo + Crédits + licence), actée par Antoine le 2026-09-29** : bouton
  « Réglages » dans le bandeau du haut (`#open-settings`, `index.html`) ouvrant un panneau à deux
  sections — **Langue** (deux radio-boutons fr/en, `input[name="settings-lang"]`) puis **Crédits**
  (Auteur / Site / Licence / Bio, `.settings-credits-list`). Logo Grist Factory juste à droite du
  bouton (`img/grist-factory-logo.jpg`). Repris du même cadrage/de la même convention d'ouverture que
  le widget frère `publipostageGrist` (`js/settings.js` de ce dépôt) — y compris le placement de la
  langue en radio-boutons dans les Réglages plutôt qu'en bouton de bandeau séparé : une langue
  choisie une fois est mémorisée (`localStorage`), pas besoin d'une place permanente dans un bandeau
  qui porte déjà les exports, Réglages et le logo. Ce placement a remplacé un premier jet en bouton
  de bandeau (`#lang-toggle`) une fois le panneau Réglages disponible, à la demande du coordinateur
  du projet le 29/09/2026 — voir HYPOTHESES.md pour le détail. Antoine a refusé Manrope le même jour
  (le chrome garde la police système) — ne pas la reproposer sans nouvel avis.
- **Aucun langage de formule Grist n'est utilisé** — tout calcul de colonne dérivée se fait
  côté JS (`deriveDateColumn`, etc.), par choix explicite et cohérent du projet.
- **Jamais de nouvelle table créée pour faire évoluer un schéma** — `AddColumn` + backfill JS sur la
  table existante (`ensureColumnsUpToDate`). `BI_StressTest` est la seule table que ce widget crée
  (voir la note de la section 1 sur la réexamination de ce périmètre au 2026-09-19).
- **`RemoveTable` n'est jamais utilisé** dans ce projet — jugé verbe non éprouvé pour ce chemin
  critique de sécurité des données ; une table orpheline est laissée en place plutôt que supprimée
  automatiquement.
- **Tout bug réel corrigé est documenté** dans `HYPOTHESES.md` (diagnostic complet) et
  `TEST_PROTOCOL.md` (entrée `[BUG RÉEL]` permanente, jamais supprimée, seulement adaptée).
- **Distinction permanente entre « testé en sandbox/mock » et « vérifié en conditions réelles
  Grist »** — le mock `dev-tests/grist-stub.js` est explicitement documenté comme ne prouvant pas le
  comportement réel de `grist.docApi`. Rien ne doit être présenté comme fonctionnel en production
  sans cette réserve tant que ce n'est pas confirmé sur un vrai document.

## 9. Ce qui n'a pas pu être vérifié depuis cette session

- Aucun accès à un vrai document Grist n'était disponible pour rédiger ce document : tout ce qui est
  répertorié ci-dessus comme « vérifié en sandbox/mock uniquement » reste dans cet état — voir la
  liste des 14 points (+ 13bis) de `HYPOTHESES.md`, section « Points à valider en conditions
  réelles », qui reste la référence à jour.
- La demande initiale de ce document citait un « CLAUDE.md écrit pour le dossier Site de Grist
  Factory » comme modèle de rubriques/niveau de détail. Ce fichier n'était pas accessible depuis
  cette session (hors du périmètre du dépôt GitHub attaché) — la structure ci-dessus a donc été
  choisie à partir des rubriques explicitement demandées et des conventions habituelles d'un
  CLAUDE.md, sans pouvoir être calquée sur ce modèle précis.
- Aucun fichier de configuration CI (`.github/workflows` ou équivalent) n'existe dans ce dépôt au
  moment de la rédaction — non vérifié s'il y en a un de prévu.
- La suite de tests Playwright citée abondamment dans `HYPOTHESES.md`/`TEST_PROTOCOL.md` n'est pas
  présente dans ce dépôt (voir §5) — son contenu exact n'a donc pas pu être lu, seulement ce qu'en
  disent `HYPOTHESES.md`/`TEST_PROTOCOL.md`.
