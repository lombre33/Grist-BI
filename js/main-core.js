/*
 * Bootstrap de l'UI — socle : lien avec GFS (ambiance, extensions), le store, les icônes et les références
 * du DOM (formulaire, panneau, barre, menus). Voir js/main.js pour le point d'entrée.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts || (GristBI.mainParts = { S: {} });
  const S = parts.S;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const flushPendingSave = (...args) => parts.flushPendingSave(...args);
  const openBlankReport = (...args) => parts.openBlankReport(...args);
  const openModelById = (...args) => parts.openModelById(...args);
  const openReportById = (...args) => parts.openReportById(...args);
  const refreshTilePanelTexts = (...args) => parts.refreshTilePanelTexts(...args);
  const render = (...args) => parts.render(...args);
  Object.assign(parts, {
    icon
  });

  // Ambiance de GFS (consigne 004, guide des apps règle 15) : Grist-BI n'a pas son propre lien
  // avec GFS (contrairement à Publipostage+), donc la version toute prête du kit,
  // `Ambiance.start()`, qui démarre ELLE-MÊME son lien (`kit/js/gfs-link.js`) plutôt que `js/main.js`
  // qui lui donnerait le sien — voir le README du kit, section « L'ambiance de GFS ». `import()`
  // dynamique plutôt qu'un `<script type="module">` d'entrée dans index.html : `js/main.js` reste un script
  // classique (CLAUDE.md §2), et le kit se charge par NOM au chargeur unique (js/loader.js ; la table des modules
  // permis, en chemins littéraux, est js/modules.js — audit `gwaudit` C-EXFIL-06 : aucune adresse n'est calculée
  // ici). Le chemin du kit est celui de js/modules.js (`../kit/…`), donc juste que l'on charge index.html (à la
  // racine) ou dev-tests/harness.html (un sous-dossier, kit/ qui s'y retrouve via dev-tests/README.md). Seul (hors GFS), `Ambiance.start()` ne pose rien et ne
  // regarde ni n'envoie rien (kit/js/host.js:hostContract) : aucun risque pour ce widget en dehors
  // de GFS. Un échec de chargement (kit/ absent, réseau) est intercepté plutôt que de faire
  // remonter une exception non gérée — l'ambiance est un embellissement, jamais une dépendance du
  // dashboard lui-même.
  // Lien avec GFS (kit 0.9.0+, `kit/js/gfs-link.js`) : résolu une fois pour tout le fichier - pour
  // que `bootstrap()` (plus bas) sache, via `GfsLink.opening()`/`onOpen`, si GFS demande d'ouvrir un
  // rapport précis plutôt que la connexion automatique habituelle (consigne 007, point 3), et pour
  // que `loadSavedCommentAuthor`/`saveCommentAuthor` et la langue (plus bas) passent par
  // `GfsLink.storageGet`/`storageSet` quand ce widget est hébergé (contrats 5.3) plutôt que par
  // `localStorage`, peu fiable dans son sous-cadre isolé. `gfsLinkReady` ne se résout JAMAIS à une
  // erreur (`null` hors GFS, ou si le chargement du kit échoue) : tout ce qui l'attend retombe alors
  // sur son comportement d'avant cette consigne, jamais un widget bloqué.
  S.gfsLink = null;

  S.gfsLinkReady = Promise.resolve(null);

  if (typeof document !== 'undefined' && GristBI.loader) {
    GristBI.loader.module('kit-ambiance').then(({ Ambiance }) => Ambiance.start()).catch((e) => {
      console.warn('[GristBI] ambiance de GFS indisponible (kit/ absent ou erreur de chargement)', e);
    });

    // Consignes GFS 006/007/008 : un seul import du lien du kit (même module que `Ambiance.start()`
    // importe ci-dessus - un module ES est mis en cache par URL, donc les deux `import()` rendent le
    // MÊME singleton `GfsLink` : Grist-BI n'a pas son propre lien avec GFS, contrairement à
    // Publipostage+, jamais un second lien démarré ici), qui câble :
    //  - `onClose` (006/008) : répond à l'appel « fermer » de GFS. L'autosave de ce widget
    //    (scheduleSave/flushPendingSave, plus bas) est TOUJOURS allumée, jamais de brouillon
    //    distinct - la règle de la 006 se réduit donc systématiquement à son cas du milieu
    //    (« enregistrement automatique allumé ») : `flushPendingSave()` jusqu'au bout puis `true`,
    //    sans jamais poser de question.
    //  - `onOpen` (007, point 3) : GFS demande d'ouvrir un autre rapport pendant que l'app est déjà
    //    ouverte (double-clic sur un autre fichier, ou « Nouveau ») - `openReportById`/le départ
    //    vierge sont définis plus bas dans ce fichier, mais déjà en portée ici (fonctions
    //    hoistées dans la même IIFE ; cet abonné n'est de toute façon appelé que bien plus tard,
    //    jamais à l'exécution synchrone de ce bloc).
    //  - `onLanguage` (007, point 3) : dans GFS, la langue est un seul choix pour GFS et ses apps
    //    (contrats 5.2, point 6) - ce widget suit, il ne décide plus seul.
    // Un échec de chargement (kit/ absent, réseau) est intercepté comme pour l'ambiance ci-dessus -
    // `gfsLink` reste `null`, sans abonné le kit répond lui-même GFS_INCONNU à « fermer »/« ouvrir »,
    // comportement d'avant ces consignes.
    S.gfsLinkReady = GristBI.loader.module('kit-gfs-link').then(({ GfsLink }) => {
      S.gfsLink = GfsLink;
      GfsLink.onClose(async () => {
        await flushPendingSave();
        return true;
      });
      GfsLink.onOpen(async ({ fichier, type, modele }) => {
        // openReportById/openBlankReport/openModelById (plus bas) appellent déjà flushPendingSave()
        // en premier - pas la peine de le refaire ici.
        // Consigne GFS 016 (kit 0.24.0+) : `modele: { id }` = « Nouveau > Depuis un modèle », un
        // rapport de départ NON enregistré. Rendre `false` (donc `{ ouvert: false }` pour GFS) quand
        // l'`id` est inconnu ou qu'aucune table ne convient : JAMAIS un rapport vierge à la place.
        if (modele) return openModelById(modele.id, type);
        if (fichier) await openReportById(fichier.id);
        else await openBlankReport();
        return true;
      });
      GfsLink.onLanguage((lang) => GristBI.i18n.setLang(lang));
      return GfsLink;
    }).catch((e) => {
      console.warn('[GristBI] lien GFS indisponible (kit/ absent ou erreur de chargement)', e);
      return null;
    });
  }

  // Extensions de GFS (consigne 019, js/extensions.js) : reçoit le lien du kit résolu plus haut. Quand l'état d'une extension change
  // (GFS a répondu, ou la personne en ajoute/retire une pendant que l'app est ouverte), les tuiles qui en dépendent sont repeintes et
  // les cartes de « Ajouter une visualisation » (grisées ou non) refaites. `store`/`render`/`renderTypeCards` sont définis plus bas :
  // l'abonné n'est appelé que bien après, jamais à l'exécution synchrone de ce bloc.
  GristBI.extensions.attach(S.gfsLinkReady);

  GristBI.extensions.onChange(() => {
    if (typeof render === 'function' && store) render(store.getState());
    if (typeof refreshTilePanelTexts === 'function') refreshTilePanelTexts();
  });

  const store = (GristBI.store = GristBI.state.createStore());

  // Icônes du chrome : traits monochromes dessinés à la main (`stroke="currentColor"`, `fill="none"`)
  // plutôt que des glyphes texte/emoji (◂ ▸ ✎ ✓ &times;) — mêmes contraintes que le reste du projet :
  // zéro dépendance tierce, rien à vendoriser, un seul jeu de tracés partagé par tous les boutons
  // icône-seule. `currentColor` fait hériter la couleur du bouton (texte/accent/danger selon l'état
  // survolé — voir css/style.css) sans le moindre asset séparé par thème clair/sombre.
  const ICON_PATHS = {
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    edit: '<path d="M12.9 2.1a2 2 0 0 1 2.8 2.8L5.6 15 2 16l1-3.6L12.9 2.1Z"/><path d="M10.6 4.4l2.8 2.8"/>',
    chevronLeft: '<path d="M10 3l-5 5 5 5"/>',
    chevronRight: '<path d="M6 3l5 5-5 5"/>',
    warning: '<path d="M8 2.2l6.5 11.6H1.5L8 2.2Z"/><path d="M8 6.6v3.2"/><path d="M8 11.9v.01"/>',
    settings: '<circle cx="8" cy="8" r="2.3"/><path d="M8 2v1.6M8 12.4V14M14 8h-1.6M3.6 8H2M12.24 3.76l-1.13 1.13M4.89 11.11l-1.13 1.13M12.24 12.24l-1.13-1.13M4.89 4.89L3.76 3.76"/>',
    comment: '<path d="M2.5 3.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H6.5l-2.8 2.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/>',
    search: '<circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l4 4"/>',
    // Agrandir / réduire une tuile (zone d'agrandissement) : quatre coins vers l'extérieur / l'intérieur.
    expand: '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5L7 9"/>',
    collapse: '<path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M2.5 6.5l4-4M13.5 9.5l-4 4"/>',
    // Une icône par type de visualisation (cartes de l'étape « Choisir » du panneau latéral).
    'type-bar': '<path d="M3.5 13V8M8 13V3.5M12.5 13V6"/><path d="M2 14h12"/>',
    'type-line': '<path d="M2 12l3.5-4 3 2.5L14 4"/><path d="M2 14h12"/>',
    'type-histogram': '<path d="M2 14v-4h2.6v4M4.6 14V6h2.6v8M7.2 14V3h2.6v11M9.8 14V7h2.6v7M12.4 14v-3H14v3"/><path d="M2 14h12"/>',
    'type-gantt': '<path d="M2.5 3.5h5.5M5 8h6M8.5 12.5h5"/><path d="M2.5 2v12"/>',
    'type-calendar': '<rect x="2.5" y="3" width="11" height="10" rx="1.2"/><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5"/><path d="M5 9h1M7.5 9h1M10 9h1M5 11h1M7.5 11h1"/>',
    'type-sankey': '<path d="M2.5 3v4.5M2.5 9v4M13.5 3v10"/><path d="M3 4.5c4 0 6 1 10 1.5M3 6.5c4 0 6 2.2 10 3.5M3 11c4 0 6-1.2 10-1.5"/>',
    'type-box': '<path d="M5 3v2.5M5 10.5V13M3.5 3h3M3.5 13h3"/><rect x="3" y="5.5" width="4" height="5" rx=".5"/><path d="M3 8h4"/><path d="M11.5 4.5v1.5M11.5 11v2M10 4.5h3M10 13h3"/><rect x="9.5" y="6" width="4" height="5" rx=".5"/><path d="M9.5 8.5h4"/>',
    'type-combo': '<path d="M3 13V9M7 13V6M11 13V8"/><path d="M2 14h12"/><path d="M2.5 6l4-2.5L10.5 5l3-2.7"/>',
    'type-pie': '<circle cx="8" cy="8" r="5.5"/><path d="M8 8V2.5M8 8l4.7 2.9"/>',
    'type-treemap': '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M8.5 2.5v11M8.5 8H14"/>',
    'type-sunburst': '<circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V6M8 10v3.5M2.5 8H6M10 8h3.5"/>',
    'type-funnel': '<path d="M2 3h12l-3.5 4.5v4.5L5.5 14V7.5L2 3Z"/>',
    'type-text': '<path d="M2.5 4h11M2.5 8h11M2.5 12h6.5"/>',
    'type-progress': '<rect x="2" y="3" width="12" height="2.4" rx="1.2"/><rect x="2" y="6.8" width="8" height="2.4" rx="1.2"/><rect x="2" y="10.6" width="5" height="2.4" rx="1.2"/>',
    'type-table': '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.2h12M2 9.9h12"/>',
    'type-scatter': '<circle cx="4.5" cy="10.5" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="11" cy="9" r="1"/><circle cx="12" cy="4.5" r="1"/><path d="M2 14h12"/>',
    'type-waterfall': '<rect x="2.5" y="3" width="3" height="5" rx=".5"/><rect x="6.5" y="6" width="3" height="4" rx=".5"/><rect x="10.5" y="8" width="3" height="5" rx=".5"/>',
    'type-radar': '<path d="M8 2l5.5 4-2 6.5h-7L2.5 6 8 2Z"/><path d="M8 5.5l2.8 2-1 3.2H6.2l-1-3.2 2.8-2Z"/>',
    'type-wordcloud': '<path d="M2 5h6M10 5h4M3 8.5h4M9 8.5h5M2 12h7M11 12h3"/>',
    'type-kpi': '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 10l1.8-2.2 1.6 1.4L11 6"/>',
    'type-gauge': '<path d="M2.5 11.5a5.5 5.5 0 0 1 11 0"/><path d="M8 11.5l2.5-3.5"/>',
    'type-pivot': '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.5h12M2 10h12M6 2.5v11"/>',
    'type-heatmap': '<rect x="2.5" y="2.5" width="3" height="3" rx=".5"/><rect x="6.5" y="2.5" width="3" height="3" rx=".5" opacity=".55"/><rect x="10.5" y="2.5" width="3" height="3" rx=".5" opacity=".25"/><rect x="2.5" y="6.5" width="3" height="3" rx=".5" opacity=".7"/><rect x="6.5" y="6.5" width="3" height="3" rx=".5"/><rect x="10.5" y="6.5" width="3" height="3" rx=".5" opacity=".4"/><rect x="2.5" y="10.5" width="3" height="3" rx=".5" opacity=".3"/><rect x="6.5" y="10.5" width="3" height="3" rx=".5" opacity=".6"/><rect x="10.5" y="10.5" width="3" height="3" rx=".5"/>'
  };

  function icon(name) {
    return `<svg class="icon icon-${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
  }

  const tilesContainer = document.getElementById('tiles');

  // Zone d'agrandissement au-dessus de la grille (point 8 des retours d'Antoine, 18/11/2026) : les tuiles
  // agrandies y sont déplacées (jamais recréées, voir render()). `workspaceMainEl` les contient toutes
  // les deux : c'est lui que les fonctions de rendu de js/charts.js reçoivent pour retrouver une tuile.
  const workspaceMainEl = document.getElementById('workspace-main');

  const focusZoneEl = document.getElementById('tiles-focus');

  const focusGridEl = document.getElementById('tiles-focus-grid');

  const focusLabelEl = document.getElementById('tiles-focus-label');

  const focusResetBtn = document.getElementById('tiles-focus-reset');

  const emptyState = document.getElementById('empty-state');

  const emptyStateHintEl = document.getElementById('empty-state-hint');

  const emptyStateStatusEl = document.getElementById('empty-state-status');

  const retryConnectBtn = document.getElementById('retry-connect');

  const addTileForm = document.getElementById('add-tile-form');

  const tileTypeSelect = document.getElementById('tile-type');

  const dimensionField = document.getElementById('tile-dimension-field');

  const dimensionLabel = document.getElementById('tile-dimension-label');

  const dimensionSelect = document.getElementById('tile-dimension');

  const suggestDateHierarchyBtn = document.getElementById('tile-suggest-date-hierarchy');

  const wordCloudSplitField = document.getElementById('tile-wordcloud-split-field');

  const wordCloudSplitCheckbox = document.getElementById('tile-wordcloud-split');

  const columnDimensionField = document.getElementById('tile-column-dimension-field');

  const columnDimensionLabel = document.querySelector('label[for="tile-column-dimension"]');

  const columnDimensionSelect = document.getElementById('tile-column-dimension');

  const seriesField = document.getElementById('tile-series-field');

  const seriesSelect = document.getElementById('tile-series');

  const radarModeField = document.getElementById('tile-radar-mode-field');

  const radarModeSelect = document.getElementById('tile-radar-mode');

  const radarAxesField = document.getElementById('tile-radar-axes-field');

  const radarAxesContainer = document.getElementById('tile-radar-axes');

  const addRadarAxisBtn = document.getElementById('tile-radar-axes-add');

  const radarEntityColumnField = document.getElementById('tile-radar-entity-column-field');

  const radarEntityColumnSelect = document.getElementById('tile-radar-entity-column');

  const radarEntityValueField = document.getElementById('tile-radar-entity-value-field');

  const radarEntityValueSelect = document.getElementById('tile-radar-entity-value');

  const radarCompareAverageField = document.getElementById('tile-radar-compare-average-field');

  const radarCompareAverageCheckbox = document.getElementById('tile-radar-compare-average');

  const drillField = document.getElementById('tile-drill-field');

  const drillLabel = document.getElementById('tile-drill-label');

  const drillLevelsContainer = document.getElementById('tile-drill-levels');

  const addDrillLevelBtn = document.getElementById('tile-drill-add-level');

  const drillCrossFilterField = document.getElementById('tile-drill-crossfilter-field');

  const drillCrossFilterCheckbox = document.getElementById('tile-drill-crossfilter');

  const measureField = document.getElementById('tile-measure-field');

  const targetField = document.getElementById('tile-target-field');

  const targetInput = document.getElementById('tile-target');

  const targetColumnField = document.getElementById('tile-target-column-field');

  const targetColumnSelect = document.getElementById('tile-target-column');

  const thresholdsField = document.getElementById('tile-thresholds-field');

  const goodPctInput = document.getElementById('tile-good-pct');

  const warnPctInput = document.getElementById('tile-warn-pct');

  const sparklineField = document.getElementById('tile-sparkline-field');

  const sparklineCheckbox = document.getElementById('tile-sparkline');

  const tileColumnsField = document.getElementById('tile-columns-field');

  const tileColumnsList = document.getElementById('tile-columns');

  const tileTextField = document.getElementById('tile-text-field');

  const tileTextInput = document.getElementById('tile-text');

  const measureLabel = document.getElementById('tile-measure-label');

  const measureSelect = document.getElementById('tile-measure');

  const measureYField = document.getElementById('tile-measure-y-field');

  const measureYSelect = document.getElementById('tile-measure-y');

  const measureYLabel = document.getElementById('tile-measure-y-label');

  const aggYField = document.getElementById('tile-agg-y-field');

  const aggYSelect = document.getElementById('tile-agg-y');

  // Bulles (nuage de points) : 3e mesure = taille, avec son propre agrégat ; la colonne « Séries » devient la couleur.
  const startColumnField = document.getElementById('tile-start-column-field');

  const startColumnSelect = document.getElementById('tile-start-column');

  const endColumnField = document.getElementById('tile-end-column-field');

  const endColumnSelect = document.getElementById('tile-end-column');

  const measureSizeField = document.getElementById('tile-measure-size-field');

  const measureSizeSelect = document.getElementById('tile-measure-size');

  const aggSizeField = document.getElementById('tile-agg-size-field');

  const aggSizeSelect = document.getElementById('tile-agg-size');

  const seriesLabel = document.getElementById('tile-series-label');

  const comboModeField = document.getElementById('tile-combo-mode-field');

  const comboModeSelect = document.getElementById('tile-combo-mode');

  const aggField = document.getElementById('tile-agg-field');

  const aggLabel = document.getElementById('tile-agg-label');

  const binsField = document.getElementById('tile-bins-field');

  const binsInput = document.getElementById('tile-bins');

  const aggSelect = document.getElementById('tile-agg');

  // Options d'affichage propres à certains types (tri, barres horizontales, aire, anneau,
  // pourcentages) : voir updateFormFieldsForType pour la visibilité par type.
  const sortField = document.getElementById('tile-sort-field');

  const sortSelect = document.getElementById('tile-sort');

  const horizontalField = document.getElementById('tile-horizontal-field');

  const horizontalCheckbox = document.getElementById('tile-horizontal');

  const areaField = document.getElementById('tile-area-field');

  const areaCheckbox = document.getElementById('tile-area');

  const paletteField = document.getElementById('tile-palette-field');

  const paletteSelect = document.getElementById('tile-palette');

  const paletteSwatch = document.getElementById('tile-palette-swatch');

  const paletteHint = document.getElementById('tile-palette-hint');

  const stackPercentField = document.getElementById('tile-stack-percent-field');

  const stackPercentCheckbox = document.getElementById('tile-stack-percent');

  const smallMultiplesField = document.getElementById('tile-small-multiples-field');

  const smallMultiplesCheckbox = document.getElementById('tile-small-multiples');

  const lineShapeField = document.getElementById('tile-line-shape-field');

  const lineShapeSelect = document.getElementById('tile-line-shape');

  const valueLabelsField = document.getElementById('tile-value-labels-field');

  const valueLabelsCheckbox = document.getElementById('tile-value-labels');

  const refLineField = document.getElementById('tile-refline-field');

  const refLineSelect = document.getElementById('tile-refline');

  const refValueField = document.getElementById('tile-refvalue-field');

  const refValueInput = document.getElementById('tile-refvalue');

  const pivotHeatField = document.getElementById('tile-pivot-heat-field');

  const pivotHeatCheckbox = document.getElementById('tile-pivot-heat');

  // Format des nombres de la tuile (`tile.numberFormat`, js/format.js) : liste Automatique / Comme dans la colonne /
  // Personnalisé, + (décimales, notation compacte) visibles seulement en « Personnalisé » et une ligne d'explication.
  const numFmtField = document.getElementById('tile-numfmt-field');

  const numFmtSelect = document.getElementById('tile-numfmt');

  const numFmtCustom = document.getElementById('tile-numfmt-custom');

  const numFmtDecimals = document.getElementById('tile-numfmt-decimals');

  const numFmtCompact = document.getElementById('tile-numfmt-compact');

  const numFmtHint = document.getElementById('tile-numfmt-hint');

  const stackField = document.getElementById('tile-stack-field');

  const stackedCheckbox = document.getElementById('tile-stacked');

  const donutField = document.getElementById('tile-donut-field');

  const donutCheckbox = document.getElementById('tile-donut');

  const showPctField = document.getElementById('tile-show-pct-field');

  const showPctCheckbox = document.getElementById('tile-show-pct');

  const gaugeMinField = document.getElementById('tile-gauge-min-field');

  const gaugeMinInput = document.getElementById('tile-gauge-min');

  const gaugeMaxField = document.getElementById('tile-gauge-max-field');

  const gaugeMaxInput = document.getElementById('tile-gauge-max');

  const measureModeField = document.getElementById('tile-measure-mode-field');

  const measureModeSelect = document.getElementById('tile-measure-mode');

  const dateColumnField = document.getElementById('tile-date-column-field');

  const dateColumnSelect = document.getElementById('tile-date-column');

  const trendField = document.getElementById('tile-trend-field');

  const trendDimensionSelect = document.getElementById('tile-trend-dimension');

  const submitTileBtn = document.getElementById('submit-tile');

  const cancelEditBtn = document.getElementById('cancel-edit');

  // Panneau latéral « Ajouter / Modifier une visualisation » (lot 2 de l'audit UI/UX du 18/11/2026).
  const workspaceEl = document.getElementById('workspace');

  const tilePanel = document.getElementById('tile-panel');

  const tilePanelTitle = document.getElementById('tile-panel-title');

  const tilePanelCloseBtn = document.getElementById('tile-panel-close');

  const chooseStepEl = document.getElementById('tile-panel-choose');

  const configureStepEl = document.getElementById('tile-panel-configure');

  const typeGridEl = document.getElementById('tile-type-grid');

  const typeLineNameEl = document.getElementById('tile-type-line-name');

  const panelBackBtn = document.getElementById('tile-panel-back');

  const tileTitleInput = document.getElementById('tile-title');

  const tileAdviceEl = document.getElementById('tile-advice');

  const tilePreviewEl = document.getElementById('tile-preview');

  const tilePreviewEmptyEl = document.getElementById('tile-preview-empty');

  const advancedDetailsEl = document.getElementById('tile-advanced');

  const addTileOpenBtn = document.getElementById('add-tile-open');

  const welcomeAddBtn = document.getElementById('welcome-add');

  const clearFilterBtn = document.getElementById('clear-filter');

  const filterBadgesEl = document.getElementById('filter-badges');

  const rowCountEl = document.getElementById('row-count');

  const dataPillNameEl = document.getElementById('data-pill-name');

  const chipsRowEl = document.getElementById('chips-row');

  const filterToggleBtn = document.getElementById('filter-toggle');

  const filterCountEl = document.getElementById('filter-count');

  const viewsToggleBtn = document.getElementById('views-toggle');

  const exportToggleBtn = document.getElementById('export-toggle');

  const modeToggleBtn = document.getElementById('mode-toggle');

  const modeToggleLabelEl = document.getElementById('mode-toggle-label');

  const welcomeEl = document.getElementById('welcome');

  const emptyStateReadHintEl = document.getElementById('empty-state-readhint');

  // Menu Vues + suivi de la vue active (retours d'Antoine du 18/11/2026, point 4) : la liste des vues,
  // le bouton de la barre (nom de la vue suivie + point « modifiée ») et la pastille sous la barre.
  const viewsListEl = document.getElementById('views-list');

  const viewsEmptyEl = document.getElementById('views-empty');

  const saveBookmarkBtn = document.getElementById('save-bookmark');

  const updateBookmarkBtn = document.getElementById('update-bookmark');

  const viewsActiveNameEl = document.getElementById('views-active-name');

  const viewsActiveDotEl = document.getElementById('views-active-dot');

  const viewChipEl = document.getElementById('view-chip');

  const viewChipNameEl = document.getElementById('view-chip-name');

  const viewChipModifiedEl = document.getElementById('view-chip-modified');

  const viewChipUpdateBtn = document.getElementById('view-chip-update');

  const viewChipLeaveBtn = document.getElementById('view-chip-leave');

  const exportExcelBtn = document.getElementById('export-excel');

  const exportPdfBtn = document.getElementById('export-pdf');

  const exportPptxBtn = document.getElementById('export-pptx');

  const tableSelectInput = document.getElementById('table-select');

  const blendSecondaryTableInput = document.getElementById('blend-secondary-table');

  const blendPrimaryColumnInput = document.getElementById('blend-primary-column');

  const blendSecondaryColumnInput = document.getElementById('blend-secondary-column');

  const pageTabsEl = document.getElementById('page-tabs');

  const addPageBtn = document.getElementById('add-page');

  const advancedFilterForm = document.getElementById('advanced-filter-form');

  const filterColumnSelect = document.getElementById('filter-column');

  const filterNumberField = document.getElementById('filter-number-field');

  const filterMinInput = document.getElementById('filter-min');

  const filterMaxInput = document.getElementById('filter-max');

  const filterDateModeField = document.getElementById('filter-date-mode-field');

  const filterDateModeSelect = document.getElementById('filter-date-mode');

  const filterDateRangeField = document.getElementById('filter-date-range-field');

  const filterDateStartInput = document.getElementById('filter-date-start');

  const filterDateEndInput = document.getElementById('filter-date-end');

  const filterRelativeDateField = document.getElementById('filter-relative-date-field');

  const filterRelativePresetSelect = document.getElementById('filter-relative-preset');

  const filterTextField = document.getElementById('filter-text-field');

  const filterTextInput = document.getElementById('filter-text');

  const advancedFilterBadgesEl = document.getElementById('advanced-filter-badges');

  const renderTimeEl = document.getElementById('render-time');

  const echartsWarning = document.getElementById('echarts-warning');

  const sharedReadOnlyWarning = document.getElementById('shared-readonly-warning');

  const settingsBtn = document.getElementById('open-settings');

  const settingsModal = document.getElementById('settings-modal');

  const styleOptionsEl = document.getElementById('settings-style-options');
 // options valables pour tous les styles
  const layoutOptionsEl = document.getElementById('settings-layout-options');
 // cartes de choix de la disposition de la page courante, voir renderLayoutOptions
  const layoutHintEl = document.getElementById('settings-layout-hint');

  const settingsCloseBtn = document.getElementById('settings-close');

  const commentsModal = document.getElementById('comments-modal');

  const commentsCloseBtn = document.getElementById('comments-close');

  const commentsModalTileEl = document.getElementById('comments-modal-tile');

  const commentsListEl = document.getElementById('comments-list');

  const commentsEmptyEl = document.getElementById('comments-empty');

  const commentForm = document.getElementById('comment-form');

  const detailModal = document.getElementById('detail-modal');

  const detailCloseBtn = document.getElementById('detail-close');

  const detailModalTitleEl = document.getElementById('detail-modal-title');

  const detailModalEmptyEl = document.getElementById('detail-modal-empty');

  const detailModalTableWrapEl = document.getElementById('detail-modal-table-wrap');

  const detailModalTruncatedEl = document.getElementById('detail-modal-truncated');

  const commentAuthorInput = document.getElementById('comment-author');

  const commentAuthorNote = document.getElementById('comment-author-note');

  const commentTextInput = document.getElementById('comment-text');

  const openPbixImportBtn = document.getElementById('open-pbix-import');

  const pbixImportModal = document.getElementById('pbix-import-modal');

  const pbixImportCloseBtn = document.getElementById('pbix-import-close');

  const pbixImportFileInput = document.getElementById('pbix-import-file');

  const pbixImportStatusEl = document.getElementById('pbix-import-status');

  const pbixImportResultsEl = document.getElementById('pbix-import-results');

  const pbixImportCreateBtn = document.getElementById('pbix-import-create');

  const csvImportFileInput = document.getElementById('csv-import-file');

  const csvImportStatusEl = document.getElementById('csv-import-status');

  const csvImportPreviewEl = document.getElementById('csv-import-preview');

  const csvImportTableNameInput = document.getElementById('csv-import-table-name');

  const csvImportColumnsEl = document.getElementById('csv-import-columns');

  const csvImportCreateBtn = document.getElementById('csv-import-create');

  const csvImportConfirmEl = document.getElementById('csv-import-confirm');

  const csvImportConfirmTextEl = document.getElementById('csv-import-confirm-text');

  const csvImportConfirmYesBtn = document.getElementById('csv-import-confirm-yes');

  const csvImportConfirmNoBtn = document.getElementById('csv-import-confirm-no');

  // --- Menu Filtre, étape 1 : la liste des colonnes ---
  const filterStepColumns = document.getElementById('filter-step-columns');

  const filterColumnSearch = document.getElementById('filter-column-search');

  const filterColumnList = document.getElementById('filter-column-list');

  const filterColumnEmpty = document.getElementById('filter-column-empty');

  const filterBackBtn = document.getElementById('filter-back');

  const filterColumnNameEl = document.getElementById('filter-column-name');

  const filterValueList = document.getElementById('filter-value-list');

  const filterValueMore = document.getElementById('filter-value-more');

  const filterValuesHint = document.getElementById('filter-values-hint');

  const filterErrorEl = document.getElementById('filter-error');

  Object.assign(parts, {
    addDrillLevelBtn, addPageBtn, addRadarAxisBtn, addTileForm, addTileOpenBtn, advancedDetailsEl,
    advancedFilterBadgesEl, advancedFilterForm, aggField, aggLabel, aggSelect, aggSizeField, aggSizeSelect, aggYField,
    aggYSelect, areaCheckbox, areaField, binsField, binsInput, blendPrimaryColumnInput, blendSecondaryColumnInput,
    blendSecondaryTableInput, cancelEditBtn, chipsRowEl, chooseStepEl, clearFilterBtn, columnDimensionField,
    columnDimensionLabel, columnDimensionSelect, comboModeField, comboModeSelect, commentAuthorInput,
    commentAuthorNote, commentForm, commentTextInput, commentsCloseBtn, commentsEmptyEl, commentsListEl,
    commentsModal, commentsModalTileEl, configureStepEl, csvImportColumnsEl, csvImportConfirmEl,
    csvImportConfirmNoBtn, csvImportConfirmTextEl, csvImportConfirmYesBtn, csvImportCreateBtn, csvImportFileInput,
    csvImportPreviewEl, csvImportStatusEl, csvImportTableNameInput, dataPillNameEl, dateColumnField, dateColumnSelect,
    detailCloseBtn, detailModal, detailModalEmptyEl, detailModalTableWrapEl, detailModalTitleEl,
    detailModalTruncatedEl, dimensionField, dimensionLabel, dimensionSelect, donutCheckbox, donutField,
    drillCrossFilterCheckbox, drillCrossFilterField, drillField, drillLabel, drillLevelsContainer, echartsWarning,
    emptyState, emptyStateHintEl, emptyStateReadHintEl, emptyStateStatusEl, endColumnField, endColumnSelect,
    exportExcelBtn, exportPdfBtn, exportPptxBtn, exportToggleBtn, filterBackBtn, filterBadgesEl, filterColumnEmpty,
    filterColumnList, filterColumnNameEl, filterColumnSearch, filterColumnSelect, filterCountEl, filterDateEndInput,
    filterDateModeField, filterDateModeSelect, filterDateRangeField, filterDateStartInput, filterErrorEl,
    filterMaxInput, filterMinInput, filterNumberField, filterRelativeDateField, filterRelativePresetSelect,
    filterStepColumns, filterTextField, filterTextInput, filterToggleBtn, filterValueList, filterValueMore,
    filterValuesHint, focusGridEl, focusLabelEl, focusResetBtn, focusZoneEl, gaugeMaxField, gaugeMaxInput,
    gaugeMinField, gaugeMinInput, goodPctInput, horizontalCheckbox, horizontalField, layoutHintEl, layoutOptionsEl,
    lineShapeField, lineShapeSelect, measureField, measureLabel, measureModeField, measureModeSelect, measureSelect,
    measureSizeField, measureSizeSelect, measureYField, measureYLabel, measureYSelect, modeToggleBtn,
    modeToggleLabelEl, numFmtCompact, numFmtCustom, numFmtDecimals, numFmtField, numFmtHint, numFmtSelect,
    openPbixImportBtn, pageTabsEl, paletteField, paletteHint, paletteSelect, paletteSwatch, panelBackBtn,
    pbixImportCloseBtn, pbixImportCreateBtn, pbixImportFileInput, pbixImportModal, pbixImportResultsEl,
    pbixImportStatusEl, pivotHeatCheckbox, pivotHeatField, radarAxesContainer, radarAxesField,
    radarCompareAverageCheckbox, radarCompareAverageField, radarEntityColumnField, radarEntityColumnSelect,
    radarEntityValueField, radarEntityValueSelect, radarModeField, radarModeSelect, refLineField, refLineSelect,
    refValueField, refValueInput, renderTimeEl, retryConnectBtn, rowCountEl, saveBookmarkBtn, seriesField,
    seriesLabel, seriesSelect, settingsBtn, settingsCloseBtn, settingsModal, sharedReadOnlyWarning, showPctCheckbox,
    showPctField, smallMultiplesCheckbox, smallMultiplesField, sortField, sortSelect, sparklineCheckbox,
    sparklineField, stackField, stackPercentCheckbox, stackPercentField, stackedCheckbox, startColumnField,
    startColumnSelect, store, styleOptionsEl, submitTileBtn, suggestDateHierarchyBtn, tableSelectInput,
    targetColumnField, targetColumnSelect, targetField, targetInput, thresholdsField, tileAdviceEl, tileColumnsField,
    tileColumnsList, tilePanel, tilePanelCloseBtn, tilePanelTitle, tilePreviewEl, tilePreviewEmptyEl, tileTextField,
    tileTextInput, tileTitleInput, tileTypeSelect, tilesContainer, trendDimensionSelect, trendField, typeGridEl,
    typeLineNameEl, updateBookmarkBtn, valueLabelsCheckbox, valueLabelsField, viewChipEl, viewChipLeaveBtn,
    viewChipModifiedEl, viewChipNameEl, viewChipUpdateBtn, viewsActiveDotEl, viewsActiveNameEl, viewsEmptyEl,
    viewsListEl, viewsToggleBtn, warnPctInput, welcomeAddBtn, welcomeEl, wordCloudSplitCheckbox, wordCloudSplitField,
    workspaceEl, workspaceMainEl
  });
})(window);
