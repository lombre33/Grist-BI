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

**Mise à jour du 2026-10-21** : la note ci-dessous (2026-09-19) sur le retrait du code de création
de table est désormais **actée et appliquée** — ce widget ne crée plus aucune table de DONNÉES
(`BI_StressTest` a été retiré, voir §3/§7/§8). Il continue de créer `BI_Dashboard_Config`,
`BI_Dashboard_Comments` et `BI_Dashboard_UserProbe`, trois tables internes qui ne portent jamais de
données de l'utilisateur. Au démarrage, le widget se connecte désormais à la 1re table utilisateur
du document (`main.js:bootstrap`), ou affiche un état explicite si le document n'en contient encore
aucune.

**Mise à jour du 2026-11-04** : ce widget reçoit des consignes de GFS (Grist Factory Suite, un
hébergeur commun en préparation pour plusieurs apps Grist d'Antoine) via le dépôt public
`lombre33/grist-widget-GFS` (lecture seule — aucun push depuis ce dépôt), et y répond dans
`GFS-ETAT.md` à la racine (seul canal vers GFS, que GFS lit mais ne modifie jamais). Consigne 004
(« suivre l'ambiance de GFS ») : ce widget référencie désormais le **kit commun des apps Grist
Factory** (`lombre33/grist-factory-kit`, licence GPL 3.0 comme ce dépôt) en **sous-module Git**
(`kit/`), et appelle `Ambiance.start()` au démarrage (`js/main.js`, tout en haut du fichier) — ce
qui ne fait RIEN tant que ce widget tourne hors de GFS (`kit/js/host.js:hostContract` : pas de
`gfs=<n>` dans l'adresse, donc le lien du kit n'écoute ni n'envoie rien). Quand une personne choisit
une ambiance dans GFS (cinq directions artistiques prédéfinies, ou sa propre couleur), le kit pose
les jetons de couleur/forme correspondants directement sur `<html>` par le CSSOM ; `css/style.css`
lit désormais ces mêmes noms de jeton (voir son commentaire d'en-tête) pour que l'interface de ce
widget (jamais les graphiques, qui gardent la palette du tableau de bord, ni les couleurs d'état)
suive. Voir §2 (ligne `kit/`) et §7/§8 pour le détail.

## 2. Structure du dépôt et rôle de chaque fichier

Pas de `package.json`, pas d'étape de build : `index.html` charge directement chaque script via
`<script src="...">`, dans un ordre précis (voir la fin du `<body>` d'`index.html`) :
`i18n.js → data.js → combobox.js → state.js → charts.js → export.js →
pdf-export.js → pptx-export.js → grist-api.js → duckdb-engine.js → appbar.js → dialogs.js → main.js` (la liste
est abrégée : `pbix-layout.js`, `csv-import.js` et `advice.js` s'y intercalent, voir `index.html`). `js/demo-data.js`
n'en fait plus partie depuis le retrait de `BI_StressTest` (2026-10-21, voir §3/§7/§8) : ce fichier
reste dans le dépôt comme fixture de test Node pure (`dev-tests/test-data.js`), jamais chargé par
`index.html`/`dev-tests/harness.html`. `i18n.js` est chargé en tout premier
(depuis le 29/09/2026, bilingue fr/en — voir le tableau ci-dessous) pour que tous les scripts
suivants lisent `GristBI.i18n.t()` comme un global déjà prêt.

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique du widget : tout le DOM (barre de tuiles, formulaire d'ajout/édition, barre de filtres avancés, sélecteur de table, onglets de pages, bookmarks, panneau Réglages/Crédits), le chargement d'ECharts/SheetJS vendorisés localement, l'`importmap` qui résout les imports nus de DuckDB-WASM vers les copies vendorisées, et l'ordre de chargement des scripts JS. |
| `css/style.css` | Layout des tuiles (grille CSS `repeat(auto-fill, minmax(270px,1fr))`), design tokens (palette catégorielle colorblind-safe validée via la skill *dataviz* du projet ; les palettes au choix par tuile vivent dans `js/data.js:PALETTES`, et `js/welcome.js` garde une copie de la Standard, vérifiée par un test). Contient plusieurs correctifs CSS documentés (voir §7). |
| `js/i18n.js` | Bilingue fr/en (depuis le 29/09/2026) : dictionnaire `STRINGS` fr/en, `t(key, vars)` (variables + pluriel via `Intl.PluralRules`), attributs `data-i18n`/`data-i18n-html`/`data-i18n-title`/`data-i18n-aria`/`data-i18n-placeholder` résolus par `applyTranslations()`. **Chargé en tout premier**, langue persistée en `localStorage` (`gristbi_lang`). Ne couvre QUE la chrome de l'interface — le contenu généré à partir de noms de colonnes (titres de tuile, en-têtes d'export Excel dans `js/data.js`) reste hors périmètre, voir HYPOTHESES.md. |
| `js/data.js` | Cœur **pur JS, testable sous Node**, sans DOM ni Grist : conversion du format colonnaire Grist en lignes, filtrage (`matchesFilter`/`applyFilters`, types `eq`/`range`/`dateRange`/`relativeDate`/`contains`), agrégation (`groupByAggregate`, `aggregateSingle`, agrégateurs sum/avg/count/min/max), tendance KPI (`computeTrend`, dont la comparaison pure est factorisée dans `trendFromGroups` pour être réutilisable sur un groupement obtenu par n'importe quel moteur, JS ou DuckDB — voir §6/js/charts.js), échappement HTML, toute la logique d'export Excel (`rowsForTile`, `tileExportSheet`, `buildWorkbookSheets`, `sanitizeSheetName`, et leurs variantes async `measureExportSheet`/`buildWorkbookSheetsAsync` pour les tuiles en mode mesure Cumul/YTD/N-1, le calcul DuckDB étant injecté par `js/export.js` plutôt qu'importé ici — voir HYPOTHESES.md) partagée avec le rendu à l'écran, le data blending multi-tables (`blendRows` : LEFT JOIN en JS pur entre lignes principales et secondaires, colonnes secondaires préfixées `<table>.<colonne>` — voir §6/ROADMAP.md), la dérivation Année/Trimestre/Mois pour le drill-down hiérarchique automatique (`deriveDateHierarchyColumns`, appelée pour chaque colonne date via `js/main.js:withDateHierarchies` — voir ROADMAP.md/HYPOTHESES.md), et la décomposition cumulative pour la tuile "Cascade (waterfall)" (`waterfallSeries`, consommée par `js/charts.js` qui ne fait que construire l'option ECharts à partir de son résultat). Le tri d'affichage optionnel des barres, de la courbe/aire et du camembert (`tile.sortMode`, `sortGroups`/`isSortableTile`) est une étape SÉPARÉE appliquée après `groupByAggregate`, jamais fusionnée dedans (piège n°14, §7), et réutilisée par l'export Excel (`tileExportSheet`) pour que le fichier suive l'ordre affiché. **Tuile Texte** (18/11/2026, `type: 'text'`, une note sans donnée) : `renderTextHtml(text)` échappe TOUT (`escapeHtml`) puis ne pose qu'une liste fermée de balises (`h3`/`h4`/`p`/`ul`/`li`/`strong`/`br`) pour les repères `# `, `## `, `- `, `**gras**` — jamais d'HTML brut (widget en accès `full`) ; `plainTextOf` pour PDF/PPTX ; `tileExportKind` rend `'text'`, aucune feuille Excel. **Table plate** (18/11/2026, `type: 'table'`, `tile.columns` = colonnes cochées dans l'ordre choisi) : `tableColumnsOf`, `sortRowsBy` (nombres comme des nombres, texte « naturel », vides toujours à la fin, stable, copie : le tableau partagé n'est jamais trié en place), `nextSortDir`, `moveInOrder` (flèches du formulaire), `cellText`, `tableSheet` (export plafonné par `maxRows`, `truncated` = lignes laissées de côté) ; `TABLE_TILE_MAX_ROWS` = 500 lignes affichées. |
| `js/format.js` | **Format des nombres** (audit de lisibilité du 18/11/2026) : pur JS, testable sous Node, UN SEUL endroit — `js/charts.js` n'a plus aucun `Intl.NumberFormat`/`toFixed`. `forTile(tile, colonne, langue)` rend `{ format, axis, percent }` : `format` = valeur complète (KPI, infobulle, tableau croisé, valeur de jauge), `axis` = libellé d'axe compact à 3 chiffres significatifs (jamais deux graduations identiques), `percent` = variation/part en %. Trois modes par tuile (`tile.numberFormat`, absent = Automatique) : `auto` (séparateurs de la LANGUE de l'interface, entiers dès 1 000, 2 décimales de 0,1 à 100, 2 chiffres significatifs sous 0,1, compact dès 10^12), `custom` (`{decimals: 'auto'|0..6, notation: 'standard'|'compact'}`, décimales FIXES) et `column` (options Grist de la colonne : `numMode` currency/decimal/percent/scientific, `currency`, `decimals` = minimum, `maxDecimals`, `numSign` parenthèses, + `locale`/`currency` du document ; sans option de décimales : rendu Automatique ; un comptage n'est jamais formaté comme la colonne). Registre des colonnes alimenté par `setColumnInfo` (`js/main.js:refreshColumnFormats`, appelée par `switchTable`, depuis `GristBI.api.readColumnFormats` qui lit le type et les `widgetOptions` de `_grist_Tables_column` et `documentSettings` de `_grist_DocInfo` ; registre vidé au changement de table) ; vide hors Grist -> Automatique. Réglage dans le panneau : champ « Format des nombres » des Options avancées (`data.supportsNumberFormat`, liste `NUMBER_FORMAT_TILE_TYPES` à compléter pour tout nouveau type qui montre un nombre ; `readTileForm` n'écrit `tile.numberFormat` que s'il est différent d'Automatique) ; `columnModeState(tile, colonne)` dit ce que donnerait « Comme dans la colonne » (`ok`/`none`/`unknown`/`count`) pour la ligne d'explication. Chargé après `js/data.js`, avant `js/charts.js`. Porte aussi la géométrie de la jauge (`gaugeLayout(w, h)`, `fitFont`, `niceCeil` : pures, testées). Voir §7 piège n°23/24. `cellNumber(tile, colonne, v, langue)` = nombre d'une TABLE PLATE : Automatique sans séparateur de milliers ni bruit de flottant, format choisi (`custom`/`column`) respecté. |
| `js/state.js` | Store pub/sub **pur JS, testable sous Node** (`createStore()`) : pages (chacune avec son propre tableau de tuiles), filtres croisés et filtres avancés (globaux entre pages, volontairement), chemins de drill-down par tuile (`drillIns`), bookmarks, jointure de data blending courante (`blend`, propre à la table de travail comme les bookmarks). Expose `getState`/`subscribe` + mutateurs (`addTile`, `updateTile`, `toggleFilter`, `drillInto`/`drillUp`, `saveBookmark`, `setBlend`, etc.). **Suivi de la vue active** (18/11/2026) : `activeBookmarkId` (session seulement, jamais persisté ; posé par `applyBookmark`/`saveBookmark`/`updateBookmark`, levé par `leaveBookmark`, la suppression de la vue ou `setBookmarks`) et `activeBookmarkModified` (DÉRIVÉ dans `getState` en comparant l'état courant à la vue par `sameSnapshot` — ordre des filtres indifférent, jamais un drapeau à tenir à jour) ; `updateBookmark(id)` remplace le contenu d'une vue par l'état actuel. **Tuiles agrandies** (18/11/2026, point 8) : `zoomedTileIds` (session seulement, global aux pages, jamais persisté — `toggleZoom(id)`/`clearZoom()` ne créent pas de nouvelle référence de `pages`, donc aucune sauvegarde) ; `getState().zoomedTileIds` n'expose que celles de la page courante, dans l'ordre d'affichage des tuiles ; `removeTile`/`removePage`/`setPages` les nettoient. |
| `js/grist-api.js` | **Seul pont** entre le widget et l'hôte Grist. Voir §3. |
| `js/duckdb-engine.js` | Moteur SQL **DuckDB-WASM** : `groupByAggregate`/`aggregateSingle`/`pivotTable` (équivalents SQL des fonctions pures de `js/data.js`) et `timeSeriesMeasures` (mesures façon DAX). **Chargé paresseusement** (rien n'est téléchargé tant que `init()` n'est pas appelé explicitement) — voir §6/§7. Depuis le 2026-10-21, `js/charts.js` l'utilise pour TOUTE tuile au-delà d'un seuil de volume (voir sa doc), plus seulement pour les mesures temporelles. |
| `js/demo-data.js` | **Fixture de test Node uniquement** (`dev-tests/test-data.js`), plus chargée par `index.html`/`dev-tests/harness.html` depuis le retrait de `BI_StressTest` (2026-10-21, voir §3/§7/§8) : génère un jeu de données de test de charge (~47 040 lignes : 4 régions × 5 produits × 7 années × 12 mois × 28 jours fixes), avec des valeurs Quantité/Montant cohérentes entre elles (croissance +6 %/an), et un jeu de tuiles de démonstration — plus jamais posées automatiquement sur une table réelle. |
| `js/charts.js` | Rendu ECharts pour les 10 types de tuiles graphiques (bar/line/pie/treemap/funnel/scatter/waterfall/radar/kpi/gauge — `line` = courbe, ou aire avec `tile.areaFill` ; `funnel` = entonnoir ECharts en `sort: 'none'` (l'ordre est celui des données ou de `tile.sortMode`, comme un camembert) ; `bar` accepte `tile.horizontal` ; `pie` accepte `tile.donut`/`tile.showPct` ; `bar` (hors mode mesure) et `line` acceptent `tile.seriesColumn` = une série par valeur d'une colonne, voir `js/data.js:isSeriesTile`/`splitBySeries`/`assembleSeries` et `computeSeriesGroups` ici : un `groupByAggregate` par série, trou `null` jamais 0 ; `tile.stacked` empile barres et aire, voir `js/data.js:isStackedTile` ; `tile.palette` choisit parmi `js/data.js:PALETTES` — `standard` = l'ancienne `CATEGORICAL_PALETTE`, jamais modifiée, gardée aussi pour le vert/rouge de la cascade et le chargement) + le pivot (table HTML) + le nuage de mots (canvas maison, voir plus bas), une instance ECharts par tuile mise en cache, gestionnaire de clic générique (drill-down vs cross-filter) qui relit l'état du store en direct à chaque clic plutôt que de capturer des variables au moment du rendu — sauf pour radar (pas de drill-down/cross-filter, voir HYPOTHESES.md). Waterfall simule une série ECharts absente nativement (2 barres empilées, cumul calculé par `js/data.js:waterfallSeries`). Chaque fonction de rendu est **async** : au-delà de `DUCKDB_ROW_THRESHOLD` lignes, l'agrégation passe par `GristBI.duckdbEngine` plutôt que la version JS pure de `js/data.js` (repli silencieux si DuckDB échoue), avec un compteur de rendu par tuile (`renderSeq`/`bumpSeq`/`isStale`, partagé par tous les chemins de rendu asynchrones) qui abandonne le résultat d'un calcul devenu périmé. `text` n'est pas une tuile ECharts : `renderText` écrit `GristBI.data.renderTextHtml(tile.text)` dans `.tile-text-body` (seule exception où `innerHTML` reçoit du texte saisi, toujours via cette fonction). **Table plate** : `renderTable` (table HTML dans `.tile-chart`, comme le pivot) ; le tri d'un clic sur l'en-tête est un état de LECTURE (`tableSort`, par id de tuile, jamais enregistré dans la configuration), la tuile est relue vivante au clic (piège n°18), le HTML n'est reconstruit que s'il change (le défilement et le focus survivent aux `render()`) ; cellules numériques par `GristBI.format.cellNumber` (Automatique = la donnée, jamais « 2 024 » pour une année). |
| `js/advice.js` | Conseil de visualisation et assistance au premier lancement (18/11/2026) : **pur JS, testable sous Node**, dépend uniquement de `js/data.js`, **aucun texte en dur** (renvoie des clés i18n `advice.*` + variables, traduites par l'appelant). `suggestTiles(rows, columns, {limit, t})` (cartes d'accueil, prêtes pour `addTile`), `defaultsForType(type, rows, columns)` (préremplissage du formulaire), `adviceForTile(tile, rows)` (`{key, vars, level}` ou `null` : anneau > 7 parts, radar > 8 axes, courbe sans ordre naturel…), `adviceForType(type, rows, columns)` (une ligne par type pour l'étape « Choisir »). Rôle de chaque colonne déduit des VALEURS, pas du nom ; voir HYPOTHESES.md. Chargé juste après `js/csv-import.js`. `previewFor(tileData, rows)` (nombres normalisés 0-1 pour une miniature, SANS ECharts) alimente `js/welcome.js` ; l'écran d'accueil est branché (PR 2b), l'étape « Choisir » et le préremplissage du formulaire le seront par la refonte de l'interface (lot 2 du fil UI/UX). `'text'` est volontairement HORS de `TILE_TYPES` (types qui agrègent une colonne) : ligne `USE_KEYS.text` pour la carte de type, aucun préremplissage, `adviceForTile` rend `null`, `suggestTiles` n'en propose jamais. |
| `js/welcome.js` | Écran d'accueil d'un tableau de bord sans tuile (PR 2b, 18/11/2026) : cartes de suggestion de `GristBI.advice.suggestTiles` (miniature SVG, titre, raison, « Ajouter »), « Ajouter ces N visualisations », « Importer un fichier Power BI… ». UMD : `previewSvg(preview, {lang})` PURE (testée sous Node), glue DOM seulement dans un navigateur. `init(callbacks)` ne reçoit que des rappels (`addTile`, `importPowerBi`) : ne connaît ni le store ni le formulaire. `update(state, connected, tableId)` appelé par `js/main.js:render()` ; ne recalcule les suggestions que si la référence `state.rows` ou la langue change (un clic de filtre ailleurs ne relance pas le profilage). Visible seulement en Édition, table connectée (`dashboardReady`) ET aucune tuile ; table sans ligne → message `welcome.emptyTable`, aucune carte. Chargé juste après `js/advice.js`. |
| `js/models.js` | Modèles de rapport de « Nouveau > Depuis un modèle » de GFS (consigne 016, 18/11/2026) : **pur JS, testable sous Node**, dépend uniquement de `js/advice.js`. Un modèle (`vue-d-ensemble`, `evolution`, `repartition`) est un rapport de départ posé sur UNE table du document, défini par des RÔLES (date, catégorie, mesure) et non par des noms de colonne : `build(id, rows, columnIds, {t})` choisit ses tuiles parmi `advice.suggestTiles` et rend `{ok:true, pageName, tiles}` (tuiles sans `id`) ou `{ok:false, missing}` (`'data'`/`'time'`/`'category'`) — jamais un rapport vide. **Ne crée aucune table** (le catalogue n'a donc jamais `tables: true`). Câblé par `js/main.js:openModelById` (appelé par `GfsLink.onOpen` et par `bootstrap` quand l'ouverture porte `modele: { id }` ; jeton `'new'` comme « Nouveau » : rien n'est écrit avant un geste ; `{ ouvert: false }` pour un `id` inconnu, un type autre que `rapport` ou aucune table qui convienne, avec une fenêtre qui dit pourquoi — jamais un rapport vierge à la place). `GristBI.openModel` est exposé pour les essais navigateur. Ajouter un modèle = une entrée de `MODELS` + une entrée de `modeles/modeles.json` + sa vignette (un test Node vérifie la correspondance exacte). |
| `modeles/` | Catalogue de départ pour la fenêtre « Depuis un modèle » de GFS (consigne 016) : `modeles.json` (id, type `rapport`, nom ≤ 60 et description ≤ 140 signes fr/en, étiquettes bilingues, vignette) + une vignette WebP 240 × 320 (≤ 12 Ko) par modèle. Jamais chargé par `index.html` : GFS le copie chez lui (`modeles/bi/`). Vignettes prises avec le vrai `index.html` et le faux Grist du dépôt, PAS dans un vrai Grist — même réserve que `vitrine/`. Un `id` n'est jamais changé ni réutilisé. |
| `js/combobox.js` | Composant d'autocomplétion réutilisable, DOM-agnostique pour sa logique de filtrage (`filterOptions`, `highlightMatch`) + câblage DOM (`attach`). Modes `strict` (doit correspondre à une option, comme un `<select>`) et non-strict (texte libre, suggestions seulement). |
| `js/dialogs.js` | `GristBI.dialogs.prompt/confirm/notice` (promesses) : fenêtres du kit (`kit/js/dialogs.js`, feuille `kit/css/windows.css` liée dans `index.html`) à la place de `window.prompt/confirm/alert`, **muets dans le cadre isolé de GFS** (pas de `allow-modals`) — voir §7 piège n°17. Chargé paresseusement par `import()` dynamique résolu sur `document.currentScript.src` ; libellés des boutons toujours passés par ce widget (`dialog.*`), jamais ceux du kit ; repli sur les boîtes du navigateur si le kit manque. Les jetons que lit `windows.css` (`--pp-scrim`, `--z-window`, `--z-dialog`, `--danger-ink`, `--danger-soft`) sont définis dans `css/style.css` : `kit/css/tokens.css` n'est PAS chargé. **Toujours `await`** (ou ignorer la promesse pour un simple message) : la fenêtre n'arrête pas le script. |
| `js/appbar.js` | Barre unique (lot 1 de l'audit UI/UX, 18/11/2026) : menus déroulants marqués `data-popover="<id du panneau>"` (un seul ouvert à la fois, Échap/clic ailleurs/Tab pour fermer, `position: fixed` rabattu dans le cadre), `data-close-popover` (ferme au clic), `data-autofocus` (champ à focaliser à l'ouverture — jamais d'office un combobox, voir §7 piège n°19) ; `GristBI.appbar.onOpen(idPanneau, rappel)` (appelé à l'ouverture, avant le focus : le menu Filtre y remet son 1er écran) ; navigation clavier des onglets et des menus. UMD : `placePopover`/`tabKeyTarget`/`menuKeyTarget` pures et testées sous Node, câblage DOM seulement dans un navigateur. Ne connaît ni les données ni les filtres : `js/main.js` appelle `GristBI.appbar.closePopovers()` après une action. |
| `js/main.js` (panneau « Ajouter une visualisation ») | Lot 2 de l'audit UI/UX (18/11/2026) : le formulaire d'ajout/modification de tuile n'est plus une bande au-dessus des tuiles mais un **panneau latéral dans le flux** (`#tile-panel`, jamais `position: fixed` : 400 px à droite des tuiles à partir de 900 px, empilé au-dessus en dessous ; hauteur de la barre lue dans `--chrome-h` par un `ResizeObserver` sur `#chrome`). Deux étapes : « Choisir » (`#tile-type-grid`, une carte par type de `TYPE_CARDS`, avec la ligne de conseil `advice.adviceForType`) puis « Régler » (champs essentiels, bloc « Options avancées » `<details>`, conseil `advice.adviceForTile`, **aperçu vivant** rendu par `GristBI.charts.renderTile` sur une tuile d'id `__preview__` que `disposeTile` libère à la fermeture). Points d'entrée : `GristBI.openTilePanel({step, type, editing})`, `closeTilePanel(returnFocus)`, `applyTypeDefaults(type)` (préremplit via `advice.defaultsForType`). `readTileForm()` lit le formulaire et valide ; l'échec passe par `fail('id-du-champ', 'cleI18n')` (message `tileForm.error.*` sous le champ, focus au champ). Ajouter un champ ou un type = `index.html` (champ) + `readTileForm` + `applyTypeDefaults` + `TYPE_CARDS`/`ICON_PATHS`. **Zone d'agrandissement** (même fichier, 18/11/2026) : le bouton `.tile-zoom` de chaque tuile (Lecture comme Édition) la DÉPLACE de la grille `#tiles` vers `#tiles-focus-grid`, une zone en flux au-dessus de la grille (plusieurs tuiles possibles côte à côte, barre « N tuiles agrandies » + « Tout réduire ») ; `render()` déplace l'ÉLÉMENT sans jamais le recréer (son graphique ECharts reste attaché, piège n°6) puis `resizeAll()` ; **les tuiles vivent donc dans DEUX conteneurs** : toute recherche d'une tuile par id passe par `workspaceMainEl` (parent des deux, c'est lui que reçoit `GristBI.charts.renderTile`), jamais par `tilesContainer` seul. Hauteur d'une tuile agrandie FIXE (`.tile.tile-zoomed`, `clamp(340px, 62vh, 680px)`, piège n°8) ; le sélecteur doit rester `.tile.tile-zoomed` car `.tile { height: 224px }` est défini plus bas dans la feuille. **Menu Vues** (même fichier, 18/11/2026) : une liste (`#views-list`, une ligne cliquable + une croix par vue, écouteurs délégués car la liste est reconstruite à chaque `render()` par `renderBookmarks(state)`), la vue suivie cochée avec « vue active » / « modifiée », « Mettre à jour « X » » et « Sauvegarder comme nouvelle vue » ; le bouton Vues de la barre porte le nom de la vue (+ point `#views-active-dot` si modifiée, nom accessible dans `aria-label`/`title`) ; la pastille `#view-chip` en tête de `#chips-row` (rangée visible tant qu'une vue est suivie, même sans filtre) propose « Mettre à jour » et quitter ; « Effacer les filtres » quitte aussi la vue. Supprimer une vue demande confirmation (`GristBI.dialogs.confirm`). **Menu Filtre** (même fichier, 18/11/2026) : deux étapes SANS combobox — `#filter-step-columns` (liste de toutes les colonnes cliquables + recherche, `renderFilterColumns`) puis `#advanced-filter-form` (réglage pour la colonne cliquée, `selectFilterColumn` ; `#filter-column` n'est plus qu'un `<input type="hidden">` qui porte la colonne ; valeurs texte cliquables `#filter-value-list`, un clic pose le filtre) ; `resetFilterPopover` à chaque ouverture ; erreurs sous les champs (`showFilterError`). |
| `js/export.js` | Construit le classeur `.xlsx` (une feuille par tuile, toutes pages confondues) via SheetJS vendorisé (`window.XLSX`) et déclenche le téléchargement ; async depuis que les tuiles en mode mesure (Cumul/YTD/N-1) y exportent leurs vraies valeurs via `GristBI.duckdbEngine.timeSeriesMeasures`, injecté dans `GristBI.data.buildWorkbookSheetsAsync`. |
| `js/pdf-export.js` | Export PDF (page actuellement affichée uniquement) via pdfmake, chargé depuis un CDN externe et non vendorisé (exception, voir §8) — capture l'image de chaque graphique déjà rendu (`GristBI.charts.getInstance`) plutôt que de recalculer, ce qui évite le mur asynchrone des tuiles en mode mesure DAX rencontré par l'export Excel. |
| `js/pptx-export.js` | Export PPTX (page actuellement affichée uniquement) via PptxGenJS, même dérogation CDN/même stratégie de capture d'image que `js/pdf-export.js` — une diapositive par tuile (image ou tableau natif `slide.addTable`, selon `GristBI.data.tileExportKind`) plutôt qu'une grille façon écran. |
| `js/vendor/echarts/` (**ECharts 6.1.0** depuis le 18/11/2026, `dist/echarts.min.js` du paquet npm + `LICENSE` + `NOTICE`), `js/vendor/xlsx/`, `js/vendor/duckdb/`, `js/vendor/apache-arrow/`, `js/vendor/flatbuffers/`, `js/vendor/tslib/` | Bibliothèques tierces **vendorisées localement, jamais chargées depuis un CDN externe** — voir §7 pour la raison (bug réel rencontré). |
| `kit/` | **Sous-module Git** (`lombre33/grist-factory-kit`, public, GPL 3.0 — pas une bibliothèque tierce vendorisée comme la ligne ci-dessus, et pas davantage une « nouvelle bibliothèque » au sens du protocole GFS §8 : l'adresse de ce dépôt est documentée dans ses propres consignes, référencée directement sans passer par une demande à GFS). Pointe sur un commit ≥ `7aa030c` (Kit 0.24.0, depuis la consigne 016 : `GfsLink.opening()`/`onOpen` gardent `modele: { id }` ; avant, `8afa569`/Kit 0.6.0+ pour l'ambiance de GFS, puis `eaa2ae2`/0.9.0 pour `onClose`). Ce widget n'en importe pour l'instant que `kit/js/ambiance.js` et, depuis le 18/11/2026, `kit/js/dialogs.js` (+ `kit/css/windows.css`, voir la ligne `js/dialogs.js`) (`js/main.js`, tout en haut du fichier, via un `import()` dynamique — même mécanisme que `js/duckdb-engine.js`/`js/charts.js:loadD3Cloud` pour charger un module ES depuis un script classique) : `Ambiance.start()` au démarrage, qui pose les jetons de couleur/forme de l'ambiance GFS choisie sur `<html>`, lus par `css/style.css` — voir §7/§8. N'importe aucun autre module du kit (pas encore de traduction/thème/fenêtres communs : ce lot ne couvre que l'ambiance, voir la consigne GFS 004). |
| `vitrine/` | Carte et fiche de l'app dans la fenêtre « Apps et extensions » de GFS (consigne 014, 17/11/2026) : `vitrine.json` (description ≤ 280 caractères et trois légendes ≤ 60, fr/en) + `1.webp`/`2.webp`/`3.webp` (960 × 600, ≤ 60 Ko, données d'exemple sans nom de personne). Jamais chargé par `index.html` : GFS en copie les images chez lui. Prises avec le vrai `index.html` et le faux Grist du dépôt, PAS dans un vrai Grist — voir HYPOTHESES.md. |
| `dev-tests/` | Harnais de test hors Grist — voir §5. `dev-tests/harness.html` est **régénéré** depuis `index.html` par `node dev-tests/sync-harness.js` (ne plus l'éditer à la main : `test-data.js` échoue s'il diverge). |
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
  widget ne s'appuie plus sur la table liée à la page hôte, il se connecte tout seul à une table de
  travail au démarrage.
- **Verbes Grist utilisés** : `grist.docApi.listTables()`, `grist.docApi.fetchTable()`,
  `grist.docApi.applyUserActions()` avec `AddTable`, `AddRecord`, `UpdateRecord`, `RenameTable`,
  `AddColumn`. **`RemoveTable` n'est jamais utilisé nulle part dans ce projet** — jugé verbe non
  éprouvé pour ce chemin critique de sécurité des données ; une table orpheline créée par une
  collision de nom est laissée en place plutôt que supprimée automatiquement.
- **Ce widget ne crée plus aucune table de DONNÉES** (retiré le 2026-10-21, demande explicite de
  l'utilisateur du 2026-09-19 — voir §7/§8) : `AddTable` ne sert plus qu'aux 3 tables internes
  (`BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe`, jamais de données de
  l'utilisateur). L'ancienne table de test de charge `BI_StressTest` (et son mécanisme de migration
  de nom legacy, `migrateLegacyTableName`) ont été entièrement retirés, y compris de `js/demo-data.js`
  côté câblage production (le fichier reste comme fixture de test Node, voir §2).
- **Connexion par défaut** : au bootstrap (`main.js:bootstrap`, en bas du fichier), le widget se
  connecte automatiquement à la **1re table du document** renvoyée par `listAvailableTables()`
  (lecture fraîche de `listTables()`, tables internes de ce widget exclues). Si le document n'a
  encore AUCUNE table utilisateur, le dashboard affiche un état explicite (`status.noTables`) plutôt
  que de créer quoi que ce soit — l'utilisateur crée sa table dans Grist, puis la choisit via le
  sélecteur ci-dessous, sans recharger le widget. L'état de la connexion est explicite
  (`main.js:connectionState` : `connecting` jusqu'à ce que la liste des tables soit lue — jamais « Aucune
  table » avant — puis `noTables`/`failed`, ce dernier avec un bouton « Réessayer »). Contrairement à l'ancien comportement
  (`BI_StressTest`), aucune tuile n'est jamais pré-configurée automatiquement : un dashboard neuf
  démarre toujours vide, qu'il s'agisse de la connexion automatique du démarrage ou d'un changement
  de table manuel.
- **Évolution de schéma sans jamais recréer de table** : `ensureColumnsUpToDate(tableId, columns,
  deriveMissingColumns, onProgress)` diffuse les colonnes manquantes via `AddColumn` puis
  recalcule leur valeur **en JS** (jamais via une formule Grist — ce projet n'utilise aucun
  langage de formule Grist, par choix explicite) et les écrit via `UpdateRecord`. C'est le
  mécanisme retenu après une évolution de politique du projet (voir §7) : plus jamais de nouvelle
  table pour un changement de schéma — ne s'applique plus qu'à `BI_Dashboard_Comments` (seule table
  interne dont le schéma JS statique est connu à l'avance), depuis le retrait de `BI_StressTest`.
- **Sélecteur de table** : `listAvailableTables()` (toujours une lecture fraîche, jamais en cache,
  filtre `BI_Dashboard_Config`/`BI_Dashboard_UserProbe`/`BI_Dashboard_Comments` de la liste — les 3
  tables internes de ce widget, jamais une donnée à visualiser ni une candidate valide pour la
  connexion automatique du démarrage ci-dessus) et `loadTable(tableId)` (simple `fetchTable`, sans
  création/remplissage) permettent de se reconnecter à n'importe quelle autre table du document —
  celle-ci démarre alors sur un dashboard vide.
- **Format des colonnes** (lot 3 de l'audit de lisibilité, 18/11/2026) : `readColumnFormats(tableId)` lit, dans `_grist_Tables_column`, le type et les `widgetOptions` (JSON texte, jamais interprété ici : c'est `js/format.js`) de chaque colonne de la table de travail, et `documentSettings` de `_grist_DocInfo` — pour le réglage de tuile « Comme dans la colonne ». Même mécanisme et mêmes droits que `realDateColumnIds` ; repli sur `{columns: {}, docSettings: null}` (Automatique partout) si la lecture échoue. Forme exacte des deux tables NON vérifiée sur un vrai Grist (§7 piège n°26).
- **Garde-fous contre la duplication de données** — le bug le plus grave rencontré sur ce projet
  (voir §7) a produit deux mécanismes de protection toujours actifs dans le code, désormais au
  service de `BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe` (les seules
  tables encore créées par ce widget) plutôt que de `BI_StressTest` :
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
- **Commentaires collaboratifs** (`loadOrCreateComments`/`addComment`, 2026-09-29, ROADMAP.md
  Tier 2) : 3e table interne créée par ce widget, `BI_Dashboard_Comments` — 1 LIGNE PAR
  COMMENTAIRE (`TableId`/`TileId`/`Author`/`Text`/`CreatedAt`), même mécanisme idempotent
  (`loadOrCreateTable`) que `BI_StressTest`/`BI_Dashboard_Config` ci-dessus, mais sans aucune ligne
  de départ. Chargée UNE SEULE fois par session au bootstrap (pas à chaque changement de table,
  contrairement à la config) : les commentaires ne sont pas structurés par table de travail, un id
  de tuile est déjà globalement unique dans ce widget. **Fusionné (PR #15, 2026-09-30)** : Antoine
  a répondu à la carte de décision sur le lieu de stockage en choisissant « Nouvelle table » (le
  choix déjà implémenté par la PR) — voir HYPOTHESES.md.
  **Auteur reconnu automatiquement (21/10/2026)** : `grist-api.js:getCurrentUserEmail()` lit une
  4e table interne dédiée, `BI_Dashboard_UserProbe` (1 colonne `Email`, formule Grist déclenchée
  `user.Email`, en formule DÉCLENCHÉE `isFormula: false` — voir §7 piège n°22 — SEULE exception de ce projet à la règle "aucune formule Grist", voir §8), via un
  `AddRecord`/`fetchTable`/`RemoveRecord` qui ne lit la valeur calculée QUE pour la ligne qu'il vient
  de créer, jamais relue plus tard. Une valeur qui n'est pas une adresse (cellule en erreur, anonyme) n'est jamais un auteur ; une ancienne colonne
  en formule ordinaire est réparée par `ModifyColumn` (une fois par session). Détectée une seule fois par session comme les commentaires
  eux-mêmes ; si la détection échoue (widget hors Grist, droits insuffisants, mock de `dev-tests/`
  qui ne simule pas le moteur de formules), le champ auteur retombe sur la saisie manuelle mémorisée
  en localStorage, exactement comme avant cette fonctionnalité.

## 4. Lancer et prévisualiser en local

**Avant tout, sur un clone frais** : `kit/` est un sous-module Git (voir §2) — un simple `git clone`
laisse ce dossier VIDE (seule une référence de commit, pas les fichiers). `git submodule update
--init` (une fois) le remplit. Sans ça, `Ambiance.start()` (js/main.js) échoue silencieusement sur
un `import()` qui 404, intercepté par son propre `catch` (console.warn, rien d'autre) — le reste du
widget continue de fonctionner normalement, sans ambiance. GitHub Pages, lui, récupère les
sous-modules à la construction pour un dépôt public en `https://` (documentation GitHub elle-même,
vérifiée par GFS le 14/10/2026 — `lombre33/grist-widget-GFS:docs/faits-verifies.md`), donc sans
action supplémentaire côté déploiement.

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
    DuckDB-WASM (`js/duckdb-engine.js`) sert désormais les mesures façon DAX (`timeSeriesMeasures`)
    ET, depuis le 2026-10-21, TOUTE tuile (bar/pie/treemap/scatter/kpi/gauge/pivot) au-delà d'un
    seuil de volume (`js/charts.js:DUCKDB_ROW_THRESHOLD`, repli JS sous ce seuil ou en cas
    d'échec) — voir §2. **Le data blending, lui, n'en dépend toujours pas**
    (`js/data.js:blendRows`, LEFT JOIN en JS pur). ✅ Faits (voir ROADMAP.md pour le détail de
    chacun) : mesures façon DAX simplifié, tableau croisé dynamique, export PDF/PPT/Excel (y
    compris les tuiles en mode mesure, désormais avec leurs vraies valeurs), data blending
    multi-tables, drill-down hiérarchique automatique (temporel uniquement), commentaires
    collaboratifs (PR #15, fusionnée le 2026-09-30 après le choix d'Antoine sur le lieu de
    stockage — voir HYPOTHESES.md), moteur DuckDB-WASM étendu à toute agrégation (21/10/2026). ✅
    Waterfall/Radar : faits (21/10/2026, voir §2 et HYPOTHESES.md) — dernières features visibles de
    la roadmap qui ne nécessitent pas de backend.
  - **Tier 3** : faisable seulement en sortant du widget (nécessite un service externe avec
    backend/cron — alertes email/SMS, rafraîchissement programmé réel, Q&A IA générative,
    embedding live hors Grist).
  - **Tier 4** : structurellement bloqué par l'architecture « widget JS statique sans backend »
    (Row-Level Security réelle, carte géographique générique, etc.) — à ne jamais promettre tel
    quel.
  - Une correction technique importante du 2026-09-15 a révisé plusieurs affirmations initiales de
    la roadmap après vérification dans le code réel du widget frère `publipostageGrist` : le widget
    **peut** en réalité lire les vrais types de colonnes Grist (`_grist_Tables_column`) et obtenir
    l'identité de l'utilisateur courant (pattern table-sonde à formule déclenchée). **Les deux
    points sont désormais faits** : le premier (29/09/2026, PR #17, voir §7 piège n°16) —
    `grist-api.js:realDateColumnIds` lit `_grist_Tables`/`_grist_Tables_column` pour détecter les
    colonnes Date/DateTime de n'importe quelle table, avec repli silencieux en cas d'échec — et le
    second (21/10/2026) — `grist-api.js:getCurrentUserEmail()` utilise une table-sonde dédiée
    (`BI_Dashboard_UserProbe`, 1 colonne `Email` à formule Grist déclenchée `user.Email` — SEULE
    exception du projet à la règle "aucune formule Grist", voir §8) pour reconnaître automatiquement
    l'auteur d'un commentaire, avec le même repli silencieux sur la saisie manuelle en cas d'échec
    (voir §3, "Commentaires collaboratifs").
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
   `table_id` réel retourné par `AddTable`). **`BI_StressTest` elle-même a été retirée le
   2026-10-21** (voir §3/§8) : les deux mécanismes de protection restent en place, désormais au
   service de `BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe`, les seules
   tables encore créées par ce widget.
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
16. **Une colonne réellement typée `Date`/`DateTime` côté Grist renvoie sa valeur, via
    `fetchTable()`, en nombre de secondes depuis l'epoch UTC — jamais la chaîne ISO 'AAAA-MM-JJ'**
    que ce widget écrit lui-même via `AddRecord` (`js/demo-data.js:deriveDateColumn`). Repéré le
    29/09/2026 en vérifiant le format réel de l'API Grist après la livraison du drill-down
    hiérarchique (bug n°14 de cette liste concerne le même point aveugle méthodologique : la
    campagne réelle du 19/09/2026 n'avait testé ni ce format, ni celui des colonnes Reference, voir
    HYPOTHESES.md) — la colonne `Date` de `BI_StressTest` (`{id:'Date', type:'Date'}` dans
    `js/demo-data.js:COLUMNS_LARGE`) est réellement typée ainsi, donc directement concernée. Sans
    correctif, `GristBI.data.parseDateValue` (chaîne stricte `^\d{4}-\d{2}-\d{2}$`) échoue sur un
    nombre, et `inferColumnKind` (`js/main.js`) classe alors la colonne comme "nombre" au lieu de
    "date" — cassant silencieusement le drill-down hiérarchique automatique et le sélecteur de
    colonne date des mesures façon DAX. Corrigé en deux temps le même jour : d'abord (PR #16)
    `GristBI.data.tableToRows(table, dateColumnIds)` (nouveau 2e paramètre optionnel, reconvertit en
    'AAAA-MM-JJ') avec `dateColumnIdsFrom(columns)`, limité aux tables dont ce widget connaît le
    schéma JS statique à l'avance (`BI_StressTest`, `BI_Dashboard_Comments`) ; puis, à la demande du
    coordinateur du projet (le cas principal — une table choisie par l'utilisateur via le sélecteur
    n'a jamais ce schéma statique), généralisé (PR #17) par `grist-api.js:realDateColumnIds(tableId)`,
    qui lit le VRAI type de chaque colonne via les tables système Grist (`_grist_Tables`/
    `_grist_Tables_column`, accessible avec l'accès `full` déjà demandé — voir §6, correction
    technique du 2026-09-15, qui l'avait déjà identifié comme possible, jamais fait avant ce jour) :
    couvre désormais N'IMPORTE QUELLE table du document, y compris une table arbitraire choisie via
    le sélecteur ou le data blending (`loadTable`). Repli sur `[]` si cette lecture échoue (droits
    restreints, tables système absentes/renommées) — dans ce cas, seul le schéma JS statique
    continue de s'appliquer pour les deux tables internes, exactement comme avant cette
    généralisation. Le mock (`dev-tests/grist-stub.js`) simule aussi ces deux tables système
    (`AddTable`/`AddColumn`/`RenameTable` les tiennent à jour), et `listTables()` les exclut
    (comme le vrai moteur). **Ce qui reste non vérifié depuis cette session** : ce format exact
    (secondes depuis l'epoch UTC pour `Date`) et la forme exacte de `_grist_Tables_column` sont
    affirmés à partir de la documentation/du comportement connu du moteur Grist, jamais revérifiés
    contre un vrai document Grist ouvert dans cette session précise — une vérification à la console
    d'un vrai widget (`JSON.stringify(await grist.docApi.fetchTable('_grist_Tables_column'))`) reste
    le seul point de confirmation manquant. Voir HYPOTHESES.md pour le détail complet, y compris les
    deux autres points vérifiés le même jour (colonnes Reference, collision `AddTable` pour
    `BI_Dashboard_Comments`).

17. **`window.prompt`, `confirm` et `alert` ne font RIEN dans le cadre isolé de GFS** (`sandbox="allow-scripts"`,
    sans `allow-modals`) : `prompt()` rend `null`, `confirm()` rend `false`, `alert()` n'affiche rien, sans
    exception — « + Page » et « Sauvegarder la vue » ne créaient rien, et tout message de validation ou d'erreur
    était invisible (audit UI/UX du 18/11/2026). Ne plus jamais les appeler : `GristBI.dialogs.*` (`js/dialogs.js`,
    fenêtres du kit), avec `await`. Un test qui ne tourne que dans une page directe ne voit pas ce défaut : le
    rejouer dans un `<iframe sandbox="allow-scripts">`.
18. **Une tuile mise en cache ne doit jamais capturer l'objet `tile` de sa création dans ses écouteurs ni son
    en-tête** : `buildTileElement` n'est appelé qu'une fois, donc après `store.updateTile` l'en-tête gardait l'ancien
    titre et « Modifier » rechargeait les anciennes valeurs. Relire la tuile vive (`store.getState().tiles`) à
    chaque clic, réécrire le titre à chaque `render()`. Un titre auto-composé porte `titleKey`/`titleVars`
    (`i18n.tileTitle`), jamais seulement du français figé ; les exports lisent encore `tile.title`.
19. **Lecture/Édition et menus : trois règles qui ont déjà mordu.** (a) `body[data-mode]` pilote `.edit-only`/`.read-only` avec
    `display:none !important` — sans `!important`, une règle d'auteur `display:flex` bat `[hidden]` et le contrôle reste
    visible (piège n°10). (b) Une table n'est « connectée » (pastille, conseil, mode auto) qu'une fois sa configuration
    chargée (`dashboardReady`), sinon un document neuf affiche « 0 ligne » pendant ~9 s. (c) Un panneau de menu ne donne
    jamais le focus d'office à un combobox (il ouvre sa liste au focus : Échap devait être pressé deux fois) ; l'écouteur
    d'Échap de `js/appbar.js` est en phase de capture pour lire l'état de la liste avant que le combobox ne la ferme.
    Les scripts de test d'avant ce lot cherchent « + Page » ou « Sauvegarder la vue » sans passer en Édition : à adapter,
    ce n'est pas une régression.
20. **`submit` ne part JAMAIS dans le cadre isolé de GFS** (`sandbox="allow-scripts"`, sans `allow-forms` : le navigateur journalise
    « Blocked form submission » et n'émet aucun événement `submit`) — « Ajouter la tuile », les filtres avancés et les commentaires
    ne faisaient rien dans GFS alors qu'ils marchent dans une page directe (bug réel n°33, lot 2). Ne jamais compter sur `submit` :
    `js/main.js:bindFormSubmit(form, handler)` (bouton `type="button"` + Entrée dans un champ texte, `preventDefault` du `submit`
    pour le cas d'une page directe) pour TOUT nouveau formulaire. Même défaut que le piège n°17 : un test qui ne tourne que dans
    une page directe ne le voit pas — rejouer dans un `<iframe sandbox="allow-scripts">`. Deuxième piège du même lot : un combobox
    ouvre sa liste au focus ; donner le focus à un champ combobox par programme (ouverture du panneau, focus d'une erreur) recouvre
    les champs suivants. Le panneau focalise donc le conteneur d'étape (`tabindex="-1"`, `preventScroll`) et, après avoir mis le focus
    sur un combobox en erreur, ferme sa liste par un Échap synthétique.

21. **Monter ECharts, c'est changer des DÉFAUTS, pas seulement des numéros** (5.x -> 6.1.0, 18/11/2026). La v6 a un autre thème et
    d'autres cadres par défaut : treemap sans cadre explicite = marges fixes 20/50 px (62 px de haut dans une tuile de 224 px, au lieu de
    80 % × 80 % centré), `labelLine.length2` du camembert 15 -> 30 px (les noms se tronquaient en « Widge… »), rayon du radar 75 % -> 50 %.
    `js/charts.js` pose donc ces trois réglages explicitement ; tout NOUVEAU type de tuile doit fixer lui-même ses cadres/marges/rayons
    plutôt que de compter sur les défauts d'ECharts (la palette, elle, est déjà toujours explicite : `CATEGORICAL_PALETTE`). Autre
    piège, plus ancien : un radar sans aucun indicateur (filtre qui ne laisse aucune ligne) lève « reading 'push' » dans ECharts 5 comme
    6 — gardé. Et `echarts.version` de la v5 vendorisée annonçait 5.5.1 alors que le bundle était la 5.6.0 : ne pas s'y fier. Test :
    attendre que `GristBI.store.getState().rows` soit rempli (~10 s dans le harnais) AVANT d'ajouter des tuiles, sinon elles se
    rendent sans donnée et masquent tout écart visuel.

22. **`user` n'existe que dans une formule DÉCLENCHÉE** (`isFormula: false` + `formula`) et dans les règles d'accès, jamais dans une formule
    ordinaire : la table-sonde `BI_Dashboard_UserProbe` créée avec `isFormula: true` valait `NameError` dans un vrai Grist, et `fetchTable` rend une
    cellule en erreur sous la forme d'un TABLEAU `['E','NameError']` — affiché « E,NameError » dans le champ Auteur d'un commentaire (bug réel n°35,
    18/11/2026). Le mock ne simule pas le moteur de formules : tout ce qui touche à une formule Grist reste à confirmer sur un vrai document, et une
    valeur lue d'une cellule doit toujours être validée (`validEmailOrNull`) avant d'être montrée. Même famille : une bulle ECharts sans `confine` sort
    de sa tuile (bug n°36) — `confineTooltip` est appliqué à toutes les options.

23. **Tout nombre affiché passe par `GristBI.format` — ECharts, par défaut, formate à l'anglaise et sans limite de décimales** (audit de
    lisibilité, 18/11/2026). Une infobulle ECharts par défaut (axe ou élément) affichait « 1,542,980.8799999997 » (séparateurs anglais, bruit
    de flottant d'une somme) alors que KPI/radar/entonnoir utilisaient `fr-FR` : trois formats pour une même valeur. Pose `tooltip.valueFormatter`
    (c'est ce qui formate la valeur de l'infobulle par défaut, treemap compris) ou un `formatter` complet, et `axisLabel.formatter: f.axis` ; ne
    jamais écrire `Intl.NumberFormat` ni `toFixed` dans `js/charts.js` (un test Node le vérifie). Autres pièges du même lot : un format compact à
    1 décimale écrit « 0,1 » deux fois pour des graduations 0,05 d'écart et affiche « 0 » pour toute une échelle de valeurs minuscules (0,0001 à
    0,0007) — `axis` garde 3 chiffres significatifs ; une moyenne de 0,0006 s'affichait « 0 » dans une carte KPI (2 décimales maximum, quelle que
    soit la valeur) ; au-delà de 5 000 lignes DuckDB rend les valeurs en `BigInt` (`format` les accepte).

24. **Une jauge ECharts par défaut est illisible dans une tuile de 220 px** (audit de lisibilité, 18/11/2026 ; capture d'Antoine : « 825,5 k » écrit sur
    « 1,7 M », « 0 » collé à « 3,3 M », aiguille sur les libellés, valeur « 3 266 234,27 » qui sortait sous la jauge). Arc de 270° de ~60 px de
    rayon, 5 libellés et 5 traits DANS l'arc, aiguille par-dessus, valeur de 18 px fixes : aucune taille de police ne règle ça. La jauge est donc
    un DEMI-CERCLE dont la géométrie est calculée en pixels (`GristBI.format.gaugeLayout`) : arc en haut, bornes min/max (`graphic`) sous ses
    extrémités, valeur sous le moyeu, police réduite jusqu'à tenir puis compacte. Une géométrie en pixels ne suit pas le redimensionnement : la
    jauge pose `instance.__refit` et `resizeAll()` le rappelle (agrandissement d'une tuile compris). Autres règles : une jauge sans borne haute
    reçoit un « beau » nombre (`niceCeil`), jamais 1,5 x la valeur ; la couleur du texte et du fond de l'arc vient des jetons CSS (`chartTheme`),
    ECharts dessine sinon en gris foncé quel que soit le fond. Côté CSS : `container-type: inline-size` (carte KPI, pour que `cqw` mesure la
    tuile) EXIGE une largeur propre (`width: 100%`), sinon le conteneur tombe à 0 px et la valeur disparaît.

25. **Une tuile dont le TYPE change en édition (Modifier > Changer de type) gardait l'élément DOM de l'ancien type** (18/11/2026, trouvé
    en testant la table plate dans un `<iframe sandbox="allow-scripts">`) : balisage de l'ancien type (KPI, texte), classe `tile-<type>`
    et instance ECharts attachée au conteneur. Une barre devenue table restait « tile-bar » ; une tuile Texte devenue graphique n'avait
    plus de `.tile-chart` où se dessiner, et un graphique rebasculé sur une table puis de nouveau sur un graphique se rattachait à un
    canvas détaché (vide, sans erreur). `render()` compare `el.dataset.tileType` à `tile.type` et recrée l'élément (`disposeTile`
    d'abord) ; tout nouveau balisage propre à un type doit donc s'appuyer sur ce garde, pas sur la création initiale.

26. **« Comme dans la colonne » : `decimals` n'est qu'un MINIMUM, et `maxDecimals` vaut 10 par défaut dans Grist** (lot 3 de l'audit de lisibilité, 18/11/2026).
    Reprendre telle quelle l'option d'une colonne Grist sans réglage de décimales afficherait jusqu'à 10 décimales (« 600 688,2299999992 ») : le défaut que le
    réglage devait justement corriger. `styleFromColumn` rend donc l'Automatique quand la colonne n'a ni `decimals` ni `maxDecimals` (et garde devise, %, parenthèses) ;
    un comptage n'a jamais le format d'une colonne ; une mesure fusionnée (`Table.colonne`) ou dérivée (`Date.Annee`) n'est pas dans le registre (Automatique).
    Le registre est vidé à chaque changement de table (`refreshColumnFormats(tableId, true)`) : sans cela, la colonne `Montant` d'une autre table reprendrait le format
    de la première. La forme de `widgetOptions`/`documentSettings` vient de la documentation du moteur, pas d'un document ouvert : le mock (`dev-tests/grist-stub.js`,
    `registerMetaColumn(..., widgetOptions)`) la reproduit à l'identique, donc ne la prouve pas.

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
  table existante (`ensureColumnsUpToDate`).
- **Ce widget ne crée plus aucune table de données** (retiré le 2026-10-21, demande explicite de
  l'utilisateur du 2026-09-19 — voir §1/§3/§7). `BI_Dashboard_Config`, `BI_Dashboard_Comments` et
  `BI_Dashboard_UserProbe` restent les 3 SEULES tables créées par ce widget — toutes internes,
  jamais une donnée de l'utilisateur. Le widget se connecte désormais à la table de travail de
  l'utilisateur (1re table du document au démarrage, ou une autre via le sélecteur), sans jamais la
  créer ni la remplir.
- **`RemoveTable` n'est jamais utilisé** dans ce projet — jugé verbe non éprouvé pour ce chemin
  critique de sécurité des données ; une table orpheline est laissée en place plutôt que supprimée
  automatiquement.
- **GFS (Grist Factory Suite) et l'ambiance (depuis le 2026-11-04)** : ce widget suit les consignes
  de `lombre33/grist-widget-GFS` (lecture seule) et y répond dans `GFS-ETAT.md`. Le sous-module
  `kit/` (§2) et `Ambiance.start()` (`js/main.js`) sont la SEULE intégration GFS faite à ce jour —
  ni `gfs.json`, ni liste unique de bibliothèques, ni contexte/stockage par le courtier du kit
  (guide des apps GFS, section 1.2, points 2/3/4/5+) : ce widget reste par ailleurs un widget Grist
  autonome, sans lien avec GFS en dehors de l'ambiance. **Toute bibliothèque/extension nouvelle au-delà
  du kit passe par une demande à GFS** (section « Demandes à GFS » de `GFS-ETAT.md`, jamais ajoutée
  soi-même, ni en CDN ni vendorisée) — voir `d3-cloud`/`pdfjs-dist` dans ce fichier à titre d'exemple
  de demandes en cours. **Les graphiques gardent toujours la palette du tableau de bord** — une
  ambiance ne recolore jamais une tuile, seulement le chrome (barres, panneaux, fenêtres, Réglages) ;
  les couleurs d'état (succès/erreur/avertissement) restent elles aussi celles de ce widget, jamais
  reposées par une ambiance.
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
