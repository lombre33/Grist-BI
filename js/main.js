/*
 * Bootstrap de l'UI : formulaire d'ajout/édition de tuile, rendu de la grille et des filtres
 * croisés actifs, câblage store <-> GristBI.api (connexion à la table de travail + persistance
 * config). Le widget se connecte automatiquement à la 1re table du document au démarrage (voir
 * bootstrap() en bas de fichier) plutôt que d'attendre un clic ou une table liée dans la page — il
 * ne crée lui-même aucune table de données (CLAUDE.md §1/§7).
 */
(function () {
  'use strict';

  // Ambiance de GFS (consigne 004, guide des apps règle 15) : Grist-BI n'a pas son propre lien
  // avec GFS (contrairement à Publipostage+), donc la version toute prête du kit,
  // `Ambiance.start()`, qui démarre ELLE-MÊME son lien (`kit/js/gfs-link.js`) plutôt que `js/main.js`
  // qui lui donnerait le sien — voir le README du kit, section « L'ambiance de GFS ». `import()`
  // dynamique plutôt qu'un `<script type="module">` séparé dans index.html : `js/main.js` reste un
  // script classique (CLAUDE.md §2), et c'est déjà ainsi que ce widget charge un module ES depuis du
  // code classique (js/duckdb-engine.js:VENDOR_BASE_URL). `document.
  // currentScript` n'est fiable qu'ICI, à l'exécution synchrone initiale de CE script (jamais dans
  // du code async) : capturé en tout premier, avant le moindre rendu, pour démarrer l'ambiance aussi
  // tôt que possible dans ce widget sans module d'entrée propre — et pour que le chemin reste juste
  // qu'on charge index.html (à la racine) ou dev-tests/harness.html (un sous-dossier, kit/ qui s'y
  // retrouve via dev-tests/README.md). Seul (hors GFS), `Ambiance.start()` ne pose rien et ne
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
  let gfsLink = null;
  let gfsLinkReady = Promise.resolve(null);

  if (typeof document !== 'undefined' && document.currentScript) {
    const ambianceUrl = new URL('../kit/js/ambiance.js', document.currentScript.src).href;
    import(ambianceUrl).then(({ Ambiance }) => Ambiance.start()).catch((e) => {
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
    const gfsLinkUrl = new URL('../kit/js/gfs-link.js', document.currentScript.src).href;
    gfsLinkReady = import(gfsLinkUrl).then(({ GfsLink }) => {
      gfsLink = GfsLink;
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

  const GristBI = window.GristBI;
  // Extensions de GFS (consigne 019, js/extensions.js) : reçoit le lien du kit résolu plus haut. Quand l'état d'une extension change
  // (GFS a répondu, ou la personne en ajoute/retire une pendant que l'app est ouverte), les tuiles qui en dépendent sont repeintes et
  // les cartes de « Ajouter une visualisation » (grisées ou non) refaites. `store`/`render`/`renderTypeCards` sont définis plus bas :
  // l'abonné n'est appelé que bien après, jamais à l'exécution synchrone de ce bloc.
  GristBI.extensions.attach(gfsLinkReady);
  GristBI.extensions.onChange(() => {
    if (typeof render === 'function' && store) render(store.getState());
    if (typeof refreshTilePanelTexts === 'function') refreshTilePanelTexts();
  });
  const store = (GristBI.store = GristBI.state.createStore());
  const { escapeHtml, tileDrillLevels } = GristBI.data;
  const { t } = GristBI.i18n;

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

  let currentTableId = null;
  // Rapport actuellement ouvert, au sens de la consigne GFS 007 point 2/3 : une LIGNE précise de
  // BI_Dashboard_Config (un `id` Grist), jamais un `TableId` seul (plusieurs rapports peuvent
  // partager la même table de travail). `null` = comportement HISTORIQUE (hors GFS, ou table
  // choisie via le sélecteur) : GristBI.api.saveConfig retombe alors sur "la première ligne qui
  // porte ce TableId", exactement comme avant cette consigne. Le jeton `'new'` marque un rapport
  // vierge ("Nouveau" dans GFS) dont la ligne n'existe pas encore : voir openBlankReport/
  // scheduleSave plus bas pour comment il se résout en un vrai id à la première sauvegarde.
  let currentReportId = null;
  let commentsModalTileId = null; // tuile actuellement affichée dans #comments-modal, ou null si fermé
  // Email de l'utilisateur courant, détecté UNE SEULE fois au bootstrap via la table-sonde
  // BI_Dashboard_UserProbe (GristBI.api.getCurrentUserEmail(), js/grist-api.js) — `null` tant que la
  // détection n'a pas abouti (mock de dev-tests/, widget hors Grist, droits insuffisants...), auquel
  // cas openCommentsModal retombe sur la saisie manuelle existante (loadSavedCommentAuthor).
  let detectedUserEmail = null;
  let detailModalTileId = null; // tuile actuellement affichée dans #detail-modal, ou null si fermé
  const DETAIL_MODAL_MAX_ROWS = 500; // voir renderDetailModal : au-delà, l'export Excel reste la voie pour tout voir
  let saveTimer = null;
  let pendingSave = null; // { tableId, reportId, authorLabel, pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions } en attente d'écriture, voir flushPendingSave()
  let lastRenderedPages = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let lastRenderedCurrentPageId = null; // idem, côté page active (changer de page se sauvegarde aussi)
  let lastRenderedBookmarks = null; // idem, côté bookmarks
  let lastRenderedBlend = null; // idem, côté jointure de data blending (voir applyBlend/commitBlendFromForm)
  let lastRenderedDashStyle = 'standard'; // idem, côté style global des tuiles (js/styles.js) — le Standard est ce que le chargement pose par défaut
  let lastRenderedDashStyleOptions = store.getState().dashStyleOptions; // idem, côté options d'affichage globales (une référence : le store n'en crée une neuve que si elles changent)
  // Consigne GFS 009 : levé par switchTable pendant qu'il CHARGE un rapport (pages/bookmarks/blend
  // posés depuis BI_Dashboard_Config ou depuis un départ vierge), jamais pendant un geste réel de la
  // personne — voir render() et switchTable plus bas.
  let suppressNextSave = false;
  // Lignes BRUTES (non jointes) de la table de travail PRINCIPALE, tenues à jour par switchTable —
  // c'est TOUJOURS depuis celles-ci que la jointure de data blending est recalculée (voir
  // applyBlend), jamais depuis store.getState().rows qui peut déjà porter les colonnes préfixées
  // d'une jointure précédente : rejoindre des lignes déjà jointes les préfixerait une seconde fois.
  let currentPrimaryRows = [];
  // { secondaryTableId, primaryColumn, secondaryColumn } de la table de travail courante, ou null
  // (aucune jointure) — miroir de currentTableId, tenu à jour par switchTable/commitBlendFromForm.
  let currentBlend = null;
  let editingTileId = null; // id de la tuile en cours d'édition via le formulaire, ou null (mode ajout)
  // <select> de niveaux de drill-down actuellement affichés dans le formulaire, un par niveau
  // AU-DELÀ de la dimension racine (index 0 = niveau 1, etc.) — voir gestion plus bas.
  let drillLevelSelects = [];
  // Garde-fou d'ergonomie (pas une limite technique : data.js/state.js/charts.js gèrent un nombre
  // de niveaux arbitraire) : au-delà, une tuile chaînant trop de niveaux sur un jeu de données trop
  // petit produit des paliers de drill quasi vides, voir ROADMAP.md.
  const MAX_DRILL_LEVELS = 5;
  // <select> d'axes du radar en mode "compétences en colonnes" (tile-radar-mode = 'columns', voir
  // ROADMAP.md : demande du forum Grist, un radar à partir de plusieurs colonnes numériques plutôt
  // que d'une seule dimension catégorielle) — même pattern dynamique que drillLevelSelects
  // ci-dessus ("+ Axe" plutôt que des champs figés), un axe = une colonne numérique.
  let radarAxisSelects = [];
  // Garde-fou d'ergonomie, même raison que MAX_DRILL_LEVELS : au-delà, un radar devient illisible.
  const MAX_RADAR_AXES = 8;

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
  // Cartes de suggestion de l'écran d'accueil (js/welcome.js, décisions de js/advice.js) : seulement des
  // rappels ici, pour que ce fichier-là ne connaisse ni le store ni le formulaire. Le bouton « Créer une
  // visualisation » de l'accueil n'est pas ici : il appartient à la refonte de l'interface (lot 2).
  GristBI.welcome.init({
    addTile: (tileData, index) => store.addTile(Object.assign({ id: genTileId(index) }, tileData)),
    importPowerBi: () => document.getElementById('open-pbix-import').click()
  });
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

  // Exports PDF/PPTX/Excel provisoirement désactivés (18/11/2026, demande d'Antoine : le PDF empile les cartes au lieu
  // de garder le visuel du tableau de bord, le PPTX ne charge pas sa bibliothèque dans un vrai Grist). Les boutons du
  // menu Exporter sont grisés dans index.html (« bientôt disponible ») ; ce drapeau les garde fermés quand une table se
  // connecte (setTableDependentControlsEnabled) et coupe les écouteurs. Remettre à `true` quand les exports sont refaits.
  const EXPORTS_AVAILABLE = false;
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
  const styleOptionsEl = document.getElementById('settings-style-options'); // cartes de choix du style des tuiles, voir renderStyleOptions
  const styleExtraInputs = { hideBorders: document.getElementById('settings-opt-hideBorders'), uniform: document.getElementById('settings-opt-uniform') }; // options valables pour tous les styles
  const layoutOptionsEl = document.getElementById('settings-layout-options'); // cartes de choix de la disposition de la page courante, voir renderLayoutOptions
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

  // Tous les champs qui référencent une COLONNE deviennent des comboboxes avec autocomplétion
  // (demande explicite de l'utilisateur, voir js/combobox.js) — en mode strict : la valeur doit
  // rester l'une des colonnes réellement chargées, comme un <select>. `.nextElementSibling` est le
  // <ul class="combobox-list"> voisin dans le même wrapper `.combobox` (voir index.html/harness.html).
  [dimensionSelect, columnDimensionSelect, startColumnSelect, endColumnSelect, seriesSelect, measureSelect, measureYSelect, measureSizeSelect, trendDimensionSelect, dateColumnSelect,
   radarEntityColumnSelect, radarEntityValueSelect, targetColumnSelect].forEach((input) => {
    GristBI.combobox.attach(input, input.nextElementSibling, { strict: true });
  });

  // Menu Filtre (retour d'Antoine du 18/11/2026) : la colonne se choisit dans une LISTE visible et
  // cliquable, et les valeurs du filtre texte sont une liste cliquable sous le champ — plus aucun
  // combobox (sa liste s'ouvrait au focus et débordait du panneau). Voir renderFilterColumns /
  // refreshFilterValues plus bas.

  // Sélecteur de TABLE (pas une colonne, mais même composant/mêmes raisons : autocomplétion,
  // simple et efficace) — voir refreshTablePicker()/le listener 'change' plus bas. `beforeOpen`
  // relit la liste des tables à CHAQUE ouverture du menu (pas seulement au démarrage/après un
  // changement de table réussi comme le fait refreshTablePicker par ailleurs) : une table créée
  // dans Grist après le chargement du widget doit rester atteignable sans recharger la page
  // [BUG RÉEL, voir HYPOTHESES.md].
  GristBI.combobox.attach(tableSelectInput, tableSelectInput.nextElementSibling, { strict: true, beforeOpen: refreshTablePicker });

  // Data blending multi-tables (ROADMAP.md Tier 2) : trois comboboxes de plus, même composant/même
  // raisonnement que le sélecteur de table ci-dessus. Les 3 ont un `blankLabel` "(aucune)" — pas
  // seulement la table secondaire : un blend est TOUT ou RIEN (voir commitBlendFromForm), donc les
  // 3 champs doivent pouvoir représenter "pas encore choisi"/"jointure retirée" de façon valide,
  // même convention que les champs de drill-down/Tendance optionnels (blankLabel "(aucun)"/
  // "(aucune)"). Attention : `fillCombobox` réinitialise le blankLabel à CHAQUE appel (voir sa
  // définition plus bas) — tout rafraîchissement de ces 2 derniers champs doit donc toujours
  // repasser `{ blankLabel: t('blend.none') }`, jamais l'omettre. `beforeOpen` relit toujours à la
  // demande, jamais un instantané : une table créée dans Grist entre-temps doit rester atteignable,
  // comme pour le sélecteur de table principal.
  GristBI.combobox.attach(blendSecondaryTableInput, blendSecondaryTableInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'), beforeOpen: refreshSecondaryTablePicker
  });
  GristBI.combobox.attach(blendPrimaryColumnInput, blendPrimaryColumnInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'),
    beforeOpen: () => fillCombobox(blendPrimaryColumnInput, blendJoinColumns(currentPrimaryRows), { blankLabel: t('blend.none') })
  });
  GristBI.combobox.attach(blendSecondaryColumnInput, blendSecondaryColumnInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'), beforeOpen: refreshBlendSecondaryColumnPicker
  });

  // Si le <script> ECharts (js/vendor/echarts/, voir index.html) n'a pas pu se charger, les tuiles
  // barres/camembert resteraient vides SANS AUCUNE erreur visible — seules les cartes KPI
  // fonctionneraient (elles ne dépendent pas d'ECharts). Signal explicite plutôt que de laisser
  // deviner via la console. Défense en profondeur : ECharts étant maintenant embarqué localement
  // (plus de dépendance CDN), ce cas ne devrait plus se produire en usage normal.
  if (typeof echarts === 'undefined') {
    console.error('[GristBI] `echarts` est indéfini : js/vendor/echarts/echarts.min.js ne s\'est probablement pas chargé.');
    echartsWarning.hidden = false;
  }

  function availableColumns(rows) {
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((k) => k !== 'id');
  }

  // Colonnes proposées comme axe d'un radar "compétences en colonnes" (voir tile-radar-axes) :
  // seules les colonnes classées "nombre" par inferColumnKind ont un sens comme axe numérique — une
  // colonne texte/date moyennée ne produirait qu'un agrégat sans signification. `rows` optionnel,
  // même raison que pour updateAdvancedFilterFieldsForColumn/updateSuggestDateHierarchyVisibility :
  // passé explicitement par refreshColumnSelects pendant un changement de table, où
  // store.getState().rows n'est pas encore à jour.
  function numericColumns(rows) {
    rows = rows || store.getState().rows;
    return availableColumns(rows).filter((col) => inferColumnKind(col, rows) === 'number');
  }

  // Colonnes proposables comme CLÉ DE JOINTURE pour le data blending (voir applyBlend/
  // commitBlendFromForm plus bas) : `availableColumns` ci-dessus EXCLUT `id` (identifiant interne
  // Grist, jamais une vraie colonne à afficher dans un graphique) — mais c'est justement la clé
  // qu'il faut pouvoir choisir CÔTÉ TABLE SECONDAIRE pour joindre sur une colonne de référence
  // Grist (`Ref:`) : côté widget, une telle colonne n'est qu'une colonne numérique contenant l'id
  // de ligne de la table référencée (ce POC ne lit pas les vrais types Grist, voir §6 de
  // CLAUDE.md), donc rejoindre dessus nécessite de pouvoir cibler `id` sur l'autre table. Proposé
  // aussi côté table PRINCIPALE par symétrie (une référence peut pointer dans l'autre sens). Piège
  // remonté par le coordinateur du projet : le filtre ajouté pour `manualSort`
  // (GRIST_TECHNICAL_COLUMNS, js/data.js) n'a pas cette conséquence — il ne retire jamais `id` — la
  // seule exclusion en cause est celle d'`availableColumns` ci-dessus.
  function blendJoinColumns(rows) {
    return ['id'].concat(availableColumns(rows));
  }

  // Fin délégué à Combobox.setOptions (voir js/combobox.js) : tous les champs qui référencent une
  // colonne sont désormais des comboboxes avec autocomplétion (demande explicite de l'utilisateur),
  // plus de <select> brut. Le nom `fillCombobox` (plutôt que l'ancien `fillSelect`) reflète ça —
  // gardé comme petite fonction dédiée pour que les sites d'appel restent lisibles.
  function fillCombobox(input, options, { blankLabel } = {}) {
    input.setOptions(options, { blankLabel: blankLabel || null });
  }

  function refreshColumnSelects(rows) {
    const cols = availableColumns(rows);
    fillCombobox(dimensionSelect, cols);
    fillCombobox(columnDimensionSelect, cols);
    fillCombobox(startColumnSelect, cols);
    fillCombobox(endColumnSelect, cols);
    fillCombobox(seriesSelect, cols, { blankLabel: t('tileForm.none.f') });
    fillCombobox(measureSelect, cols);
    fillCombobox(measureYSelect, cols);
    fillCombobox(measureSizeSelect, cols, { blankLabel: t('tileForm.none.f') });
    drillLevelSelects.forEach((select) => fillCombobox(select, cols, { blankLabel: t('tileForm.none.m') }));
    const numCols = numericColumns(rows);
    radarAxisSelects.forEach((select) => fillCombobox(select, numCols));
    fillCombobox(trendDimensionSelect, cols, { blankLabel: t('tileForm.none.f') });
    fillCombobox(targetColumnSelect, numCols, { blankLabel: t('tileForm.none.f') });
    fillCombobox(radarEntityColumnSelect, cols, { blankLabel: t('tileForm.none.f') });
    updateRadarEntityValueOptions(rows);
    fillCombobox(dateColumnSelect, cols);
    refreshColumnsPicker(cols);
    renderFilterColumns(rows);
    updateAdvancedFilterFieldsForColumn(rows);
    updateSuggestDateHierarchyVisibility(rows);
  }

  // Valeurs proposées pour "Valeur à comparer" (comparaison élève/moyenne du radar, voir
  // ROADMAP.md) : dépend de la colonne choisie juste au-dessus (`tile-radar-entity-column`), même
  // principe que `updateAdvancedFilterFieldsForColumn`/`distinctColumnValues` pour les suggestions
  // de valeurs du filtre avancé "contient" — sauf qu'ici la valeur DOIT être l'une des valeurs
  // réellement présentes (`strict: true`, comme un `<select>`), pas une simple suggestion de texte
  // libre : comparer "Dupont" alors que personne ne s'appelle ainsi dans la colonne choisie n'aurait
  // aucun sens. `rows` optionnel, même raison que les fonctions voisines : passé explicitement par
  // `refreshColumnSelects` pendant un changement de table, où `store.getState().rows` n'est pas
  // encore à jour.
  function updateRadarEntityValueOptions(rows) {
    rows = rows || store.getState().rows;
    const column = radarEntityColumnSelect.value;
    fillCombobox(radarEntityValueSelect, column ? GristBI.data.distinctColumnValues(rows, column) : [], { blankLabel: t('tileForm.none.f') });
  }

  // Devine le "type" d'une colonne en inspectant une VALEUR réelle plutôt qu'un nom de colonne
  // (heuristique fragile) — même principe que la détection Date/Numeric du widget publipostageGrist
  // (voir ROADMAP.md, correction technique du 2026-09-15) : ce POC n'a pas encore de lecture des
  // vrais types Grist (`_grist_Tables_column`), donc on infère depuis la donnée chargée, pas depuis
  // le nom. `GristBI.data.parseDateValue` reconnaît le seul format de date utilisé ici (AAAA-MM-JJ,
  // voir demo-data.js:isoDate) ; une chaîne numérique (ex. Grist renvoie parfois des nombres en
  // chaîne) compte comme 'number', pas comme texte.
  function inferColumnKind(column, rows) {
    rows = rows || store.getState().rows;
    if (!rows.length) return 'text';
    const sample = rows.find((r) => r[column] != null && r[column] !== '');
    if (!sample) return 'text';
    const v = sample[column];
    if (GristBI.data.parseDateValue(v) != null) return 'date';
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)))) return 'number';
    return 'text';
  }

  // Drill-down hiérarchique automatique (ROADMAP.md Tier 2) : dérive Année/Trimestre/Mois (voir
  // GristBI.data.deriveDateHierarchyColumns) pour CHAQUE colonne classée "date" par
  // inferColumnKind ci-dessus — automatique et sans configuration, contrairement au choix
  // d'utiliser cette hiérarchie pour une tuile donnée, qui reste une suggestion à confirmer (voir
  // updateSuggestDateHierarchyVisibility/le clic du bouton plus bas). `availableColumns(rows)` est
  // calculé UNE FOIS avant la boucle (pas recalculé à chaque itération) : les colonnes dérivées
  // elles-mêmes (des chaînes comme "T1"/"01", jamais au format AAAA-MM-JJ) ne repasseraient de
  // toute façon jamais le test `inferColumnKind === 'date'`, mais autant rester explicite plutôt
  // que de dépendre de cette propriété. Appelé depuis applyBlend (js/main.js), jamais depuis
  // refreshColumnSelects : cette dernière ne fait que peupler des comboboxes, jamais transformer les
  // lignes elles-mêmes.
  function withDateHierarchies(rows) {
    if (!rows.length) return rows;
    let enriched = rows;
    availableColumns(rows).forEach((col) => {
      if (inferColumnKind(col, rows) === 'date') enriched = GristBI.data.deriveDateHierarchyColumns(enriched, col);
    });
    return enriched;
  }

  // Bouton "Détailler par Année/Trimestre/Mois/Jour" : visible seulement quand la dimension
  // choisie est une colonne classée "date" par inferColumnKind ET que le drill-down a un sens pour
  // ce type de tuile (formHasNoDimension couvre KPI/jauge/mode mesure ; le pivot n'a pas de
  // drill-down non plus, voir supportsDrillDown). N'applique rien tout seul — reste une suggestion
  // à confirmer d'un clic (voir ROADMAP.md : seule la dérivation des colonnes elle-même,
  // withDateHierarchies ci-dessus, est automatique et sans confirmation). `rows` optionnel : passé
  // explicitement par refreshColumnSelects, même raison que pour
  // updateAdvancedFilterFieldsForColumn (store.getState().rows n'est pas encore à jour à cet
  // instant lors d'un changement de table).
  function updateSuggestDateHierarchyVisibility(rows) {
    const noDrill = formHasNoDimension() || tileTypeSelect.value === 'pivot' || tileTypeSelect.value === 'heatmap';
    const column = dimensionSelect.value;
    suggestDateHierarchyBtn.hidden = noDrill || !column || inferColumnKind(column, rows) !== 'date';
  }

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
  const FILTER_VALUES_SHOWN = 40; // au-delà : « N autres valeurs », on affine en tapant
  let filterColumns = []; // [{ id, kind }] — colonnes proposées par l'étape 1
  let filterValuesPool = []; // valeurs distinctes de la colonne choisie (filtre texte)

  const KIND_BADGES = { text: 'Aa', number: '123', date: '31' };

  function renderFilterColumns(rows) {
    rows = rows || store.getState().rows;
    filterColumns = availableColumns(rows).map((id) => ({ id, kind: inferColumnKind(id, rows) }));
    // La colonne choisie a disparu (changement de table) : retour à l'étape 1.
    if (filterColumnSelect.value && !filterColumns.some((c) => c.id === filterColumnSelect.value)) {
      filterColumnSelect.value = '';
      showFilterStep('columns');
    }
    refreshFilterColumnList();
  }

  function refreshFilterColumnList() {
    const q = filterColumnSearch.value.trim().toLowerCase();
    const shown = q ? filterColumns.filter((c) => c.id.toLowerCase().includes(q)) : filterColumns;
    filterColumnList.innerHTML = shown.map((c) => {
      const kind = t('filters.kind.' + c.kind);
      return `<li><button type="button" class="filter-column-item" data-column="${escapeHtml(c.id)}" aria-label="${escapeHtml(t('filters.column.aria', { name: c.id, kind }))}">`
        + `<span class="kind-badge kind-${c.kind}" aria-hidden="true">${KIND_BADGES[c.kind]}</span>`
        + `<span class="filter-column-label">${escapeHtml(c.id)}</span></button></li>`;
    }).join('');
    filterColumnEmpty.hidden = shown.length > 0;
  }

  function showFilterStep(step) {
    const columns = step === 'columns';
    filterStepColumns.hidden = !columns;
    advancedFilterForm.hidden = columns;
    showFilterError(null);
  }

  // Étape 2 : réglage du filtre pour la colonne cliquée.
  function selectFilterColumn(columnId) {
    filterColumnSelect.value = columnId;
    filterColumnNameEl.textContent = columnId;
    const kind = (filterColumns.find((c) => c.id === columnId) || {}).kind || 'text';
    filterColumnNameEl.dataset.kind = kind;
    filterTextInput.value = '';
    updateAdvancedFilterFieldsForColumn();
    showFilterStep('form');
    // Focus sur le 1er champ utile (pas un combobox, voir CLAUDE.md §7 piège n°19) ; sinon le bouton « Retour ».
    const first = kind === 'number' ? filterMinInput : kind === 'date' ? (filterDateModeField.hidden ? filterBackBtn : filterDateModeSelect) : filterTextInput;
    first.focus({ preventScroll: true });
  }

  // Remet le menu sur son 1er écran : appelé à CHAQUE ouverture (js/appbar.js:onOpen).
  function resetFilterPopover() {
    filterColumnSearch.value = '';
    filterColumnSelect.value = '';
    refreshFilterColumnList();
    showFilterStep('columns');
  }

  // Valeurs cliquables du filtre texte, filtrées par ce qui est tapé dans le champ.
  function refreshFilterValues() {
    const q = filterTextInput.value.trim().toLowerCase();
    const pool = q ? filterValuesPool.filter((v) => v.toLowerCase().includes(q)) : filterValuesPool;
    const shown = pool.slice(0, FILTER_VALUES_SHOWN);
    filterValueList.innerHTML = shown.map((v) => `<li><button type="button" class="filter-value-item" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button></li>`).join('');
    filterValueList.hidden = shown.length === 0;
    filterValuesHint.hidden = filterValuesPool.length === 0;
    const more = pool.length - shown.length;
    filterValueMore.hidden = more <= 0;
    if (more > 0) filterValueMore.textContent = t('filters.values.more', { n: more });
  }

  function showFilterError(key) {
    filterErrorEl.hidden = !key;
    filterErrorEl.textContent = key ? t(key) : '';
  }

  // Flèches ↑ ↓ dans une liste de boutons (colonnes / valeurs) ; ↑ depuis le 1er élément rend le champ de recherche.
  function listArrowNav(evt, listEl, backTo) {
    if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return;
    const items = Array.from(listEl.querySelectorAll('button'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (evt.key === 'ArrowDown') next = items[i + 1] || (i === -1 ? items[0] : null);
    else if (i > 0) next = items[i - 1];
    else if (i === 0 && backTo) next = backTo;
    if (next) { evt.preventDefault(); next.focus(); }
  }

  // Bascule les champs du formulaire de filtre avancé selon le "type" inféré de la colonne
  // choisie : plage min/max (numérique), plage de dates OU période relative au choix (date, via
  // `#filter-date-mode`), recherche texte (tout le reste). Même pattern que
  // `updateFormFieldsForType` pour le formulaire de tuile. `rows` optionnel : passé explicitement
  // par `refreshColumnSelects` (table qui vient de changer — `store.getState().rows` n'est mis à
  // jour qu'APRÈS refreshColumnSelects dans switchTable, donc serait encore celui de l'ANCIENNE
  // table à cet instant précis) ; sinon (changement de colonne/mode par l'utilisateur, table déjà
  // stable) repli sur `store.getState().rows`, à jour dans ce cas.
  function updateAdvancedFilterFieldsForColumn(rows) {
    rows = rows || store.getState().rows;
    const column = filterColumnSelect.value;
    const kind = column ? inferColumnKind(column, rows) : 'text';
    filterNumberField.hidden = kind !== 'number';
    filterDateModeField.hidden = kind !== 'date';
    filterTextField.hidden = kind !== 'text';
    if (kind === 'date') {
      const mode = filterDateModeSelect.value;
      filterDateRangeField.hidden = mode !== 'dateRange';
      filterRelativeDateField.hidden = mode !== 'relativeDate';
    } else {
      filterDateRangeField.hidden = true;
      filterRelativeDateField.hidden = true;
    }
    // Valeurs réellement présentes dans la colonne choisie, juste des SUGGESTIONS (voir l'attach
    // en `strict: false` plus haut) — uniquement pour la recherche texte : pour une colonne
    // numérique quasi unique (ex. Montant), la liste des valeurs distinctes n'aiderait pas plus
    // qu'un champ nombre natif, qui garde en plus son clavier numérique dédié ; idem pour les
    // dates, où le sélecteur natif du navigateur est déjà une meilleure UX qu'une liste de ~47 000
    // jours quasi tous différents. Décision de périmètre documentée dans HYPOTHESES.md.
    filterValuesPool = kind === 'text' && column ? GristBI.data.distinctColumnValues(rows, column) : [];
    refreshFilterValues();
  }

  // KPI et jauge : une seule valeur agrégée, pas de dimension de regroupement ni de drill-down. Texte : aucune
  // donnée du tout (ni mesure, ni dimension, voir updateFormFieldsForType).
  function typeHasNoDimension(type) { return type === 'kpi' || type === 'gauge' || type === 'text' || type === 'table' || type === 'histogram'; }

  // Titres de tuile auto-composés (ex. "YTD : sum(Montant)") : du CONTENU généré à partir de noms
  // de colonnes, pas de la chrome — même périmètre volontairement laissé de côté que les titres
  // par défaut de js/demo-data.js et les en-têtes d'export Excel de js/data.js (voir js/i18n.js).
  // Clés de titre par mode de mesure (voir `tileTitleFor` plus bas) : un titre auto-composé est
  // stocké avec sa clé i18n (`titleKey`/`titleVars`) pour suivre la langue de l'interface.
  const MEASURE_MODE_TITLE_KEYS = { cumulative: 'tileTitle.cumulative', ytd: 'tileTitle.ytd', yoy: 'tileTitle.yoy' };

  // Messages à l'utilisateur : fenêtres du kit (js/dialogs.js) plutôt que `window.alert`, qui ne fait
  // RIEN dans le cadre isolé de GFS (pas de `allow-modals`). Jamais attendues : un message ne doit
  // pas retenir le code qui suit, contrairement à la boîte native.
  function showNotice(message) { GristBI.dialogs.notice({ message }); }
  function showError(message) { GristBI.dialogs.notice({ title: t('dialog.error.title'), message }); }

  // Titre d'une tuile composé automatiquement à la création/modification. `titleKey: undefined`
  // pour le seul cas sans texte traduisible (« sum(Montant) », indépendant de la langue) ; les
  // `undefined` sont gardés explicites parce que `store.updateTile` (Object.assign) n'efface une
  // clé que si elle est présente dans le patch.
  function autoTileTitle(p) {
    let key;
    let vars;
    if (p.isText) { key = 'tileTitle.text'; vars = undefined; }
    else if (p.isHistogram) { key = 'tileTitle.histogram'; vars = { measure: p.measure }; }
    else if (p.isGantt) { key = 'tileTitle.gantt'; vars = { dimension: p.dimension }; }
    else if (p.isCalendar) { key = 'tileTitle.calendar'; vars = { measure: p.measure, dimension: p.dimension }; }
    else if (p.isSunburst) { key = 'tileTitle.sunburst'; vars = { measure: p.measure, levels: [p.dimension].concat(p.drillDimensions || []).join(' › ') }; }
    else if (p.isSankey) { key = 'tileTitle.sankey'; vars = { measure: p.measure, dimension: p.dimension, columnDimension: p.columnDimension }; }
    else if (p.isBox) { key = 'tileTitle.box'; vars = { measure: p.measure, dimension: p.dimension }; }
    else if (p.isCombo && p.comboPareto) { key = 'tileTitle.pareto'; vars = { measure: p.measure, dimension: p.dimension }; }
    else if (p.isCombo) { key = 'tileTitle.combo'; vars = { measure: p.measure, measureY: p.measureY, dimension: p.dimension }; }
    else if (p.isProgress) { key = 'tileTitle.progress'; vars = { measure: p.measure, dimension: p.dimension }; }
    else if (p.isTable) { key = 'tileTitle.table'; vars = { columns: p.tableColumns.slice(0, 3).join(', ') + (p.tableColumns.length > 3 ? '…' : '') }; }
    else if (p.isHeatmap) { key = 'tileTitle.heatmap'; vars = { measure: p.measure, dimension: p.dimension, columnDimension: p.columnDimension }; }
    else if (p.isPivot) { key = 'tileTitle.pivot'; vars = { measure: p.measure, dimension: p.dimension, columnDimension: p.columnDimension }; }
    else if (p.isRadarColumns) { key = 'tileTitle.radarColumns'; vars = { axes: p.radarAxes.join(', ') }; }
    else if (p.isWordCloudSplit) { key = 'tileTitle.wordCloud'; vars = { dimension: p.dimension }; }
    else if (p.isBubble) { key = 'tileTitle.bubble'; vars = { measure: p.measure, measureY: p.measureY, measureSize: p.measureSize, dimension: p.dimension }; }
    else if (p.hasDimension && p.seriesColumn) { key = 'tileTitle.measureByDimensionSeries'; vars = { measure: p.measure, dimension: p.dimension, series: p.seriesColumn }; }
    else if (p.hasDimension) { key = 'tileTitle.measureByDimension'; vars = { measure: p.measure, dimension: p.dimension }; }
    else if (p.measureMode) { key = MEASURE_MODE_TITLE_KEYS[p.measureMode]; vars = { agg: p.aggFn, measure: p.measure }; }
    if (!key) return { title: `${p.aggFn}(${p.measure})`, titleKey: undefined, titleVars: undefined };
    return { title: t(key, vars), titleKey: key, titleVars: vars };
  }

  // Idem pour une tuile "Barres" avec un mode de calcul temporel actif ('cumulative'/'ytd'/'yoy',
  // voir ROADMAP.md "Mesures façon DAX simplifié") : l'axe est TOUJOURS le mois calculé depuis
  // `tile-date-column` (voir js/duckdb-engine.js:timeSeriesMeasures), la dimension/le drill-down du
  // formulaire n'ont donc pas de sens dans ce mode — même traitement que KPI/jauge.
  //
  // Un radar en mode "compétences en colonnes" (tile-radar-mode) non plus : ses axes viennent de
  // plusieurs colonnes choisies (tile-radar-axes), pas d'une seule dimension catégorielle — demande
  // du forum Grist (entretiens d'orientation, compétences déjà en colonnes plutôt qu'en lignes).
  function isRadarColumnsMode() {
    return tileTypeSelect.value === 'radar' && radarModeSelect.value === 'columns';
  }

  // Nuage de mots en mode "découpage de cellule" (tile-wordcloud-split) : chaque mot vient du
  // découpage d'UNE cellule, pas d'un groupement par dimension — mesure/agrégat n'ont pas de sens
  // (voir GristBI.data.wordFrequency, le compte d'occurrences est la seule valeur possible) et un
  // clic n'a aucune valeur de dimension cohérente à driller/filtrer (voir js/charts.js). Contrairement
  // à isRadarColumnsMode, la dimension (colonne à découper) reste toujours requise dans ce mode —
  // seuls mesure/agrégat/drill-down en sont absents, voir formHasNoDimension ci-dessous.
  function isWordCloudSplitMode() {
    return tileTypeSelect.value === 'wordcloud' && wordCloudSplitCheckbox.checked;
  }

  function formHasNoDimension() {
    return typeHasNoDimension(tileTypeSelect.value)
      || (tileTypeSelect.value === 'bar' && measureModeSelect.value && measureModeSelect.value !== 'brut')
      || isRadarColumnsMode();
  }

  // Le pivot a DEUX dimensions (lignes + colonnes, voir tile-column-dimension-field) déjà
  // affichées simultanément dans la grille : pas de notion de "détailler" une dimension au clic
  // comme pour bar/pie/treemap/scatter (qui n'en ont qu'une), donc pas de drill-down pour ce type.
  // Le radar non plus (voir js/charts.js:renderChart) : une seule série couvre TOUTES les valeurs
  // de la dimension à la fois (un axe par valeur), le clic ECharts sur un radar ne distingue pas
  // quel axe a été visé — aucune valeur de dimension cohérente à driller, le gestionnaire de clic
  // générique l'ignore explicitement (voir le garde dans getOrCreateChartInstance). Masquer le
  // formulaire de configuration du drill-down pour ce type plutôt que de laisser l'utilisateur
  // configurer des niveaux qui ne se déclencheront jamais au clic.
  function supportsDrillDown(type) { return !typeHasNoDimension(type) && type !== 'pivot' && type !== 'heatmap' && type !== 'radar' && type !== 'progress' && type !== 'box' && type !== 'sankey' && type !== 'calendar' && type !== 'gantt' && type !== 'sunburst'; }
  // Niveaux de la liste « drill-down » : ceux d'un type qui détaille au clic, et les anneaux d'un soleil (qui les montre tous à la fois, sans drill-down).
  function supportsLevels(type) { return supportsDrillDown(type) || type === 'sunburst'; }

  // Drill-down à N niveaux : un combobox par niveau, créé dynamiquement ("+ Niveau") plutôt que des
  // champs figés dans le HTML — data.js/state.js/charts.js gèrent déjà un tableau drillDimensions
  // de longueur quelconque, seul le formulaire limitait ça à 2 champs statiques auparavant. Retourne
  // l'INPUT (enrichi par Combobox.attach, voir js/combobox.js) : `drillLevelSelects` en garde la
  // référence pour `.value`/`.setOptions` ; `input.parentElement` est le wrapper `.combobox` à
  // insérer dans le DOM (voir les sites d'appel), pas l'input seul.
  function createDrillLevelSelect(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'combobox';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `tile-drill-dimension-${index + 1}`;
    input.className = 'combobox-input';
    const list = document.createElement('ul');
    list.className = 'combobox-list';
    list.hidden = true;
    wrapper.appendChild(input);
    wrapper.appendChild(list);
    GristBI.combobox.attach(input, list, { strict: true, blankLabel: t('tileForm.none.m') });
    input.addEventListener('change', () => {
      if (!input.value) {
        // Niveau vidé -> tout niveau plus profond n'a plus de sens (un trou dans la hiérarchie,
        // ex. Année > (rien) > Semaine, ne veut rien dire) : on les retire.
        truncateDrillLevelsAfter(index);
        if (index === 0) drillCrossFilterCheckbox.checked = false; // plus de drill-down du tout
      }
      updateDrillLevelsUI();
    });
    return input;
  }

  function truncateDrillLevelsAfter(index) {
    while (drillLevelSelects.length > index + 1) {
      drillLevelSelects.pop().parentElement.remove(); // retire le wrapper .combobox entier, pas juste l'input
    }
  }

  // Réaffiche le bouton "+ Niveau" seulement si le dernier niveau visible est rempli (progression
  // séquentielle, comme l'ancien niveau 2 qui n'apparaissait qu'une fois le niveau 1 choisi) et que
  // le plafond n'est pas atteint ; recalcule aussi la visibilité de la case cross-filter.
  function updateDrillLevelsUI() {
    const noDrill = formHasNoDimension() || !supportsLevels(tileTypeSelect.value);
    const lastSelect = drillLevelSelects[drillLevelSelects.length - 1];
    addDrillLevelBtn.hidden = noDrill || !lastSelect || !lastSelect.value || drillLevelSelects.length >= (tileTypeSelect.value === 'sunburst' ? GristBI.data.SUNBURST_MAX_LEVELS - 1 : MAX_DRILL_LEVELS);
    drillCrossFilterField.hidden = noDrill || tileTypeSelect.value === 'sunburst' || !drillLevelSelects[0] || !drillLevelSelects[0].value;
  }

  addDrillLevelBtn.addEventListener('click', () => {
    if (drillLevelSelects.length >= MAX_DRILL_LEVELS) return;
    const select = createDrillLevelSelect(drillLevelSelects.length);
    fillCombobox(select, availableColumns(store.getState().rows), { blankLabel: t('tileForm.none.m') });
    drillLevelsContainer.appendChild(select.parentElement);
    drillLevelSelects.push(select);
    updateDrillLevelsUI();
  });

  // Vide le formulaire de tous ses niveaux de drill sauf le premier (toujours présent).
  function resetDrillLevels() {
    truncateDrillLevelsAfter(0);
    if (drillLevelSelects[0]) drillLevelSelects[0].value = '';
  }

  // Niveau 1 toujours présent dans le formulaire (comme avant), les suivants sont ajoutés
  // dynamiquement au clic sur "+ Niveau" ou lors du préremplissage en édition.
  (function initFirstDrillLevel() {
    const select = createDrillLevelSelect(0);
    drillLevelsContainer.appendChild(select.parentElement);
    drillLevelSelects.push(select);
  })();

  // Axes du radar en mode "compétences en colonnes" (tile-radar-mode = 'columns') : même pattern
  // dynamique que createDrillLevelSelect ci-dessus (combobox créée à la demande, "+ Axe"), mais
  // sur `radarAxisSelects`/`radarAxesContainer`/`addRadarAxisBtn`, et sans blankLabel : contrairement
  // à un niveau de drill (où "(aucun)" veut dire "pas de niveau suivant"), un axe vide n'a pas de
  // sens à conserver — vidé, il est retiré (voir truncateRadarAxesAfter) au lieu de devenir "(aucun)".
  function createRadarAxisSelect(index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'combobox';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `tile-radar-axis-${index + 1}`;
    input.className = 'combobox-input';
    const list = document.createElement('ul');
    list.className = 'combobox-list';
    list.hidden = true;
    wrapper.appendChild(input);
    wrapper.appendChild(list);
    GristBI.combobox.attach(input, list, { strict: true });
    input.addEventListener('change', () => {
      if (!input.value) truncateRadarAxesAfter(index);
      updateRadarAxesUI();
    });
    return input;
  }

  function truncateRadarAxesAfter(index) {
    while (radarAxisSelects.length > index + 1) {
      radarAxisSelects.pop().parentElement.remove();
    }
  }

  // Réaffiche "+ Axe" seulement si le dernier axe visible est rempli et que le plafond n'est pas
  // atteint — même logique que updateDrillLevelsUI.
  function updateRadarAxesUI() {
    const isRadarColumns = tileTypeSelect.value === 'radar' && radarModeSelect.value === 'columns';
    const lastSelect = radarAxisSelects[radarAxisSelects.length - 1];
    addRadarAxisBtn.hidden = !isRadarColumns || !lastSelect || !lastSelect.value || radarAxisSelects.length >= MAX_RADAR_AXES;
  }

  addRadarAxisBtn.addEventListener('click', () => {
    if (radarAxisSelects.length >= MAX_RADAR_AXES) return;
    const select = createRadarAxisSelect(radarAxisSelects.length);
    fillCombobox(select, numericColumns(store.getState().rows));
    radarAxesContainer.appendChild(select.parentElement);
    radarAxisSelects.push(select);
    updateRadarAxesUI();
  });

  // Vide le formulaire de tous ses axes sauf le premier (toujours présent) — même rôle que
  // resetDrillLevels.
  function resetRadarAxes() {
    truncateRadarAxesAfter(0);
    if (radarAxisSelects[0]) radarAxisSelects[0].value = '';
  }

  // Axe 1 toujours présent dans le formulaire, comme le niveau 1 de drill-down — les suivants sont
  // ajoutés dynamiquement au clic sur "+ Axe" ou lors du préremplissage en édition.
  (function initFirstRadarAxis() {
    const select = createRadarAxisSelect(0);
    radarAxesContainer.appendChild(select.parentElement);
    radarAxisSelects.push(select);
  })();

  // Désactive les contrôles qui n'ont de sens qu'avec une table de travail connectée (formulaire
  // d'ajout de tuile, filtre avancé, data blending, vues sauvegardées/exports, +Page) tant que
  // `currentTableId` reste `null` (document sans aucune table utilisateur, voir bootstrap()) —
  // repéré lors de l'audit UX du 21/10/2026 : ces contrôles restaient auparavant pleinement
  // interactifs (bouton "+ Ajouter la tuile" bleu, premier plan) mais totalement inopérants dans cet
  // état (voir addTileForm submit, `if (!measure...) return;`), sans le moindre retour pour
  // l'utilisateur — seul le message `status.noTables`, discret dans le bandeau du haut, expliquait
  // pourquoi. Le sélecteur de table principal (`tableSelectInput`) reste volontairement actif : c'est
  // la seule échappatoire utile dans cet état. Les boutons de la liste des vues ne sont pas listés
  // ici : ils sont reconstruits par renderBookmarks() à chaque rendu, et le menu Vues lui-même ne
  // s'ouvre pas tant que `viewsToggleBtn` est désactivé.
  function setTableDependentControlsEnabled(enabled) {
    for (const form of [addTileForm, advancedFilterForm]) {
      form.querySelectorAll('input, select, button, textarea').forEach((el) => { el.disabled = !enabled; });
    }
    for (const el of [saveBookmarkBtn, exportExcelBtn, exportPdfBtn, exportPptxBtn, addPageBtn,
                       filterToggleBtn, viewsToggleBtn, exportToggleBtn, modeToggleBtn,
                       blendSecondaryTableInput, blendPrimaryColumnInput, blendSecondaryColumnInput]) {
      el.disabled = !enabled;
    }
    if (!EXPORTS_AVAILABLE) for (const el of [exportExcelBtn, exportPdfBtn, exportPptxBtn]) el.disabled = true;
  }

  // Mode Lecture / Édition (audit UI/UX du 18/11/2026) : `body[data-mode]` masque en lecture tout ce
  // qui sert à CONSTRUIRE le tableau de bord (`.edit-only` : formulaire d'ajout, « + » des pages,
  // déplacer/modifier/supprimer une tuile, jointure, import). Pas persisté : à chaque connexion à une
  // table, un tableau de bord qui a déjà des tuiles s'ouvre en lecture, un tableau vide en édition ;
  // le bouton de la barre bascule ensuite à la main. Au démarrage (rien de connecté) : lecture, pour
  // ne pas montrer un formulaire inutilisable le temps du chargement.
  let mode = 'read';
  function applyMode() {
    document.body.dataset.mode = mode;
    const editing = mode === 'edit';
    modeToggleBtn.setAttribute('aria-pressed', String(editing));
    const label = t(editing ? 'mode.done' : 'mode.edit');
    modeToggleLabelEl.textContent = label;
    // Écran très étroit : le libellé visible disparaît (css), le nom accessible reste.
    modeToggleBtn.setAttribute('aria-label', label);
  }
  function setMode(next) {
    mode = next === 'edit' ? 'edit' : 'read';
    if (mode === 'read') closeTilePanel(false); // on ne laisse ni panneau ouvert ni édition en cours derrière un mode qui les masque
    GristBI.appbar.closePopovers();
    applyMode();
    fitPageTabs(); // le mode Édition ajoute des boutons à la barre
  }
  function autoMode() {
    const hasTiles = store.getState().pages.some((p) => p.tiles && p.tiles.length > 0);
    setMode(hasTiles ? 'read' : 'edit');
  }

  // État de la connexion aux données, distinct de « une table est connectée » : tant que le
  // démarrage n'a rien tranché, l'écran dit « Connexion… » — jamais « Aucune table dans ce
  // document » avant que la liste des tables ait été lue (audit UI/UX du 18/11/2026 : ce message
  // trompeur s'affichait pendant tout le chargement). 'connecting' | 'noTables' | 'failed' ; sans
  // objet dès qu'une table est connectée (`currentTableId`).
  let connectionState = 'connecting';
  // Vrai une fois la configuration de la table lue (switchTable) : `currentTableId` est posé AVANT cette
  // lecture, qui peut durer une dizaine de secondes sur un document neuf (création de
  // BI_Dashboard_Config, voir `tableExistsConfirmed`) — pendant ce temps « 0 ligne » et « Ce tableau de
  // bord est vide » seraient faux, la table n'est pas encore prête.
  let dashboardReady = false;
  function connectionMessage() {
    if (connectionState === 'noTables') return t('status.noTables');
    if (connectionState === 'failed') return t('status.connectionFailed');
    return t('status.connecting');
  }
  // Texte COURT de la pastille « Données » tant qu'aucune table n'est connectée (la phrase complète
  // ci-dessus va dans l'état vide, assez large pour elle).
  function connectionShortMessage() {
    if (connectionState === 'noTables') return t('status.noTables.short');
    if (connectionState === 'failed') return t('status.failed.short');
    return t('status.connecting');
  }
  // `currentTableId` reste `null` tant qu'aucune table n'a pu être rejointe : un rendu déclenché
  // dans cet état (ex. un changement de langue) ne doit jamais écraser le message de connexion par
  // « 0 ligne », qui donnerait à tort l'impression qu'une table vide est connectée. Le même message
  // remplace aussi le conseil habituel de l'état vide (« Ajoutez-une tuile… », trompeur ici puisque
  // le formulaire est désactivé, voir setTableDependentControlsEnabled), bien plus visible que le
  // seul badge du bandeau ; un échec y propose « Réessayer ». Le conseil est MASQUÉ plutôt que
  // remplacé (le `textContent` de l'ancien code détruisait son <span> à jamais : une fois une
  // première table connectée, le conseil ne revenait plus).
  function renderConnectionStatus(state) {
    const connected = Boolean(currentTableId) && dashboardReady;
    dataPillNameEl.textContent = currentTableId ? currentTableId : connectionShortMessage();
    rowCountEl.textContent = connected ? t('status.rowCount', { n: state.rows.length }) : '';
    emptyStateHintEl.hidden = !connected;
    emptyStateReadHintEl.hidden = !connected;
    emptyStateStatusEl.hidden = connected;
    emptyStateStatusEl.textContent = connected ? '' : connectionMessage();
    retryConnectBtn.hidden = connected || connectionState !== 'failed';
    welcomeAddBtn.hidden = !connected;
  }
  function setConnectionState(next) {
    connectionState = next;
    renderConnectionStatus(store.getState());
  }

  // Pose le plan d'agencement d'UNE tuile (js/layouts.js:plan) : variables CSS lues par css/layouts.css (`--ls` colonnes, `--lr` rangées,
  // `--lc` colonne de départ du Rail), groupe et classes de repère. `item` absent (grille) = tout retirer, la tuile redevient ce qu'elle était.
  function applyTileLayout(el, item) {
    if (!item) {
      el.style.removeProperty('--ls');
      el.style.removeProperty('--lr');
      el.style.removeProperty('--lc');
      delete el.dataset.layoutGroup;
      el.classList.remove('layout-hero', 'layout-first');
      return;
    }
    el.style.setProperty('--ls', String(item.span));
    el.style.setProperty('--lr', String(item.rows));
    if (item.start) el.style.setProperty('--lc', String(item.start)); else el.style.removeProperty('--lc');
    el.dataset.layoutGroup = item.group;
    el.classList.toggle('layout-hero', !!item.hero);
    el.classList.toggle('layout-first', !!item.first);
  }

  function render(state) {
    // Style global des tuiles (js/styles.js) : posé AVANT les rendus ci-dessous, que js/charts.js lit à chaque tuile
    // (`GristBI.styles.current()`) — un changement de style repasse donc par ce `render()` complet, sans rien d'autre à rafraîchir.
    GristBI.styles.apply(state.dashStyle);
    GristBI.styles.applyOptions(state.dashStyleOptions);
    refreshStyleOptions(state.dashStyle, state.dashStyleOptions);
    // Balaie tout le document pour les attributs data-i18n-* (voir js/i18n.js) à CHAQUE rendu, pas
    // seulement au changement de langue : les boutons d'en-tête de tuile (buildTileElement) sont mis
    // en cache et jamais reconstruits tant que la tuile existe (voir juste en dessous), donc un
    // changement de langue seul ne les régénérerait pas — applyTranslations() les retrouve par leurs
    // attributs data-i18n-aria/-title et les corrige même sans reconstruction, même principe que la
    // relecture d'état en direct plutôt que capturée (voir js/charts.js).
    GristBI.i18n.applyTranslations();

    // Réconciliation incrémentale plutôt que innerHTML='' + reconstruction : une instance ECharts
    // reste attachée à SON élément .tile-chart tant que la tuile existe, sinon setOption() continue
    // de s'exécuter sur un canvas détaché du DOM (rendu invisible bien qu'aucune erreur ne soit levée).
    // Les tuiles vivent dans la grille OU dans la zone d'agrandissement : les deux sont relues.
    const existingEls = new Map(
      Array.from(tilesContainer.children).concat(Array.from(focusGridEl.children)).map((el) => [el.dataset.tileId, el])
    );
    const nextIds = new Set(state.tiles.map((t) => t.id));
    const zoomedIds = new Set(state.zoomedTileIds);
    // Agencement de la page (js/layouts.js) : un plan par page, posé en variables CSS sur chaque tuile. L'ordre ENREGISTRÉ (`state.tiles`) ne
    // change jamais ; seul l'ordre AFFICHÉ en dérive (les chiffres d'abord) et c'est lui qu'on pose dans le DOM, pour que la tabulation suive l'écran.
    const layoutId = GristBI.layouts.normalizeLayoutId(state.pageLayout);
    const layoutPlan = GristBI.layouts.plan(layoutId, state.tiles);
    const displayTiles = layoutPlan ? GristBI.layouts.displayOrder(layoutId, state.tiles) : state.tiles;
    if (layoutPlan) tilesContainer.dataset.layout = layoutId; else delete tilesContainer.dataset.layout;
    if (layoutPlan && layoutPlan.hasRail) tilesContainer.dataset.hasRail = ''; else delete tilesContainer.dataset.hasRail;
    refreshLayoutOptions(state);

    for (const [id, el] of existingEls) {
      if (!nextIds.has(id)) {
        GristBI.charts.disposeTile(id);
        el.remove();
        existingEls.delete(id);
      }
    }

    // Une tuile agrandie est DÉPLACÉE dans la zone d'agrandissement, jamais recréée : son élément (donc
    // son graphique ECharts, piège n°6) reste le même, seule sa place dans le DOM change — et
    // `resizeAll()` plus bas lui donne sa nouvelle taille. Chaque conteneur garde l'ordre d'affichage des
    // tuiles ; on ne touche au DOM que si la place est mauvaise (avant : un déplacement à chaque rendu).
    let previousGridEl = null;
    let previousFocusEl = null;
    displayTiles.forEach((tile) => {
      let el = existingEls.get(tile.id);
      // Une tuile dont le TYPE a changé (Modifier > Changer de type) ne peut pas garder son élément : le balisage
      // (KPI, texte, graphique), la classe `tile-<type>` et l'instance ECharts attachée sont ceux de l'ancien type
      // (un graphique ne se dessinerait plus, un bouton Détail resterait masqué...). On le recrée.
      if (el && el.dataset.tileType !== tile.type) {
        GristBI.charts.disposeTile(tile.id);
        el.remove();
        existingEls.delete(tile.id);
        el = null;
      }
      if (!el) {
        el = buildTileElement(tile);
        existingEls.set(tile.id, el);
      }
      const isZoomed = zoomedIds.has(tile.id);
      const target = isZoomed ? focusGridEl : tilesContainer;
      const previousEl = isZoomed ? previousFocusEl : previousGridEl;
      if (el.parentElement !== target || el.previousElementSibling !== previousEl) {
        if (previousEl) previousEl.after(el); else target.prepend(el);
      }
      if (isZoomed) previousFocusEl = el; else previousGridEl = el;
      el.classList.toggle('tile-zoomed', isZoomed);
      applyTileLayout(el, layoutPlan && layoutPlan.items[tile.id]);
      const zoomBtn = el.querySelector('.tile-zoom');
      if (zoomBtn) {
        const zoomKey = isZoomed ? 'tile.unzoom' : 'tile.zoom';
        zoomBtn.setAttribute('aria-pressed', String(isZoomed));
        zoomBtn.setAttribute('aria-label', t(zoomKey + '.aria'));
        zoomBtn.title = t(zoomKey + '.title');
      }
      // Recalculé à chaque rendu (pas seulement à la création) : la position d'une tuile change
      // quand une autre est ajoutée/supprimée/déplacée autour d'elle.
      // Titre rafraîchi à chaque rendu : suit un changement de langue (titre auto-composé, voir
      // i18n.js:tileTitle) comme une modification de la tuile (l'élément est mis en cache).
      const titleEl = el.querySelector('.tile-title');
      if (titleEl) {
        const titleText = GristBI.i18n.tileTitle(tile);
        if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
        titleEl.title = titleText;
      }
      const moveLeftBtn = el.querySelector('.tile-move-left');
      const moveRightBtn = el.querySelector('.tile-move-right');
      // Dans un agencement, une tuile ne dépasse que celles de son groupe (js/layouts.js:moveTarget) : sinon rien ne changerait à l'écran.
      if (moveLeftBtn) moveLeftBtn.disabled = GristBI.layouts.moveTarget(layoutId, state.tiles, tile.id, -1) === null;
      if (moveRightBtn) moveRightBtn.disabled = GristBI.layouts.moveTarget(layoutId, state.tiles, tile.id, 1) === null;
      // Badge de compte sur le bouton "Commentaires" : recalculé à chaque rendu (comme
      // moveLeftBtn/moveRightBtn ci-dessus), jamais seulement à la création de la tuile — un
      // commentaire peut être ajouté alors que la tuile est déjà affichée depuis longtemps.
      const commentsCountEl = el.querySelector('.tile-comments-count');
      if (commentsCountEl) {
        const n = GristBI.data.commentsForTile(state.comments, tile.id).length;
        commentsCountEl.hidden = n === 0;
        commentsCountEl.parentElement.classList.toggle('has-comments', n > 0);
        commentsCountEl.textContent = n > 99 ? '99+' : String(n);
      }
    });

    focusZoneEl.hidden = zoomedIds.size === 0;
    focusLabelEl.textContent = t('zoom.count', { n: zoomedIds.size });
    emptyState.hidden = state.tiles.length > 0;
    welcomeEl.hidden = state.tiles.length > 0;
    GristBI.welcome.update(state, Boolean(currentTableId) && dashboardReady, currentTableId);
    // Temps de rendu affiché dans le bandeau : utile pour repérer à l'œil un ralentissement sur une
    // table de travail à fort volume, sans devoir ouvrir les DevTools à chaque fois.
    const renderStart = performance.now();
    for (const tile of state.tiles) GristBI.charts.renderTile(tile, state, workspaceMainEl);
    // Le nombre de tuiles change la largeur de chaque colonne de la grille CSS ; ECharts ne
    // réagit pas seul à un redimensionnement de son conteneur (pas d'observer par défaut).
    GristBI.charts.resizeAll();
    if (renderTimeEl) {
      const ms = Math.round(performance.now() - renderStart);
      renderTimeEl.textContent = state.tiles.length ? t('status.renderTime', { ms }) : '';
    }

    renderPageTabs(state.pages, state.currentPageId);
    renderFilterBadges(state.activeFilters);
    renderAdvancedFilterBadges(state.advancedFilters);
    renderFilterSummary(state.activeFilters.length + state.advancedFilters.length, Boolean(state.activeBookmarkId));
    applyMode();
    setTableDependentControlsEnabled(Boolean(currentTableId) && dashboardReady);
    renderBookmarks(state);
    renderConnectionStatus(state);
    fitPageTabs();

    // `pages`/`currentPageId`/`bookmarks` ne changent de référence/valeur que via leurs actions
    // dédiées (state.js) : un rendu déclenché par un simple rafraîchissement de données (setRows) ne
    // doit pas re-déclencher une écriture dans le document Grist (évite de polluer l'historique à
    // chaque édition externe). Changer de page ne modifie QUE currentPageId (référence de `pages`
    // inchangée) mais mérite quand même d'être sauvegardé, comme la page active dans Power BI.
    if (state.pages !== lastRenderedPages || state.currentPageId !== lastRenderedCurrentPageId ||
        state.bookmarks !== lastRenderedBookmarks || state.blend !== lastRenderedBlend || state.dashStyle !== lastRenderedDashStyle ||
        state.dashStyleOptions !== lastRenderedDashStyleOptions) {
      lastRenderedPages = state.pages;
      lastRenderedCurrentPageId = state.currentPageId;
      lastRenderedBookmarks = state.bookmarks;
      lastRenderedBlend = state.blend;
      lastRenderedDashStyle = state.dashStyle;
      lastRenderedDashStyleOptions = state.dashStyleOptions;
      // Consigne GFS 009 : pendant que switchTable CHARGE un rapport (même vierge, "Nouveau" dans
      // GFS), ce bloc s'exécute une fois par store.set* (jusqu'à 3 fois, un par champ chargé) sans
      // qu'aucun geste de la personne n'ait eu lieu — lastRendered* est quand même mis à jour
      // ci-dessus (pour ne pas se retrouver désynchronisé au prochain geste réel), mais aucune
      // sauvegarde n'est planifiée tant que switchTable n'a pas fini de poser son chargement.
      if (!suppressNextSave) scheduleSave(state.pages, state.currentPageId, state.bookmarks, state.blend, state.dashStyle, state.dashStyleOptions);
    }
    // Tient la liste du panneau Commentaires à jour s'il est ouvert (ajout d'un commentaire,
    // changement de langue...) sans avoir à le refermer/rouvrir — no-op si fermé
    // (commentsModalTileId à null, voir sa définition).
    renderCommentsModal();
    // Même principe pour la modale de détail : un filtre posé/levé pendant qu'elle est ouverte doit
    // se refléter dans les lignes affichées, pas seulement au prochain clic sur le bouton Détail.
    renderDetailModal();
  }

  // Une page ne se supprime jamais toute seule (state.js:removePage refuse de vider la dernière),
  // donc pas besoin de gérer un état "aucune page" ici. Onglets d'un `tablist` ARIA (audit UI/UX du
  // 18/11/2026) : `role="tab"` + `aria-selected`, un seul onglet dans l'ordre de tabulation
  // (`tabindex` itinérant), flèches ← → / Début / Fin pour passer d'une page à l'autre
  // (`GristBI.appbar.tabKeyTarget`, testé sous Node). Renommer (double-clic) et supprimer (croix de
  // l'onglet actif, seulement s'il y a plus d'une page) ne sont offerts qu'en mode Édition ; la croix
  // est un 2e bouton à côté de l'onglet, jamais un contrôle imbriqué dans un bouton.
  function updateTabsOverflow() {
    pageTabsEl.classList.toggle('overflows', pageTabsEl.scrollWidth > pageTabsEl.clientWidth + 1);
  }
  // Les onglets sont la navigation : le reste de la barre s'allège avant qu'un onglet ne soit rogné (bug réel n°51 : « Segments » coupé à
  // 1100 et 1200 px dès qu'une vue était suivie ; avec 4 pages, réduit à une lettre). Deux paliers, essayés dans l'ordre à partir de la
  // barre complète, et gardés seulement s'ils servent :
  // 1. `bar-names-hidden` : le nom de la vue suivie écrit dans le bouton Vues (un rappel : la pastille « Vue » de la rangée des filtres et
  //    le nom accessible du bouton le disent aussi) ;
  // 2. `bar-labels-hidden` : les libellés des boutons (icônes seules, comme au-dessous de 900 px) — SEULEMENT si les onglets tiennent alors ;
  //    sinon (beaucoup de pages) les boutons gardent leur texte et les onglets défilent, avec le fondu de bord (`overflows`).
  // À rappeler après tout ce qui change la largeur de la barre : `render()` en dernier (le nom de la vue est posé APRÈS le rendu des onglets,
  // d'où le fondu qui restait faux), le changement de mode ou de langue, la taille de la fenêtre, et un ResizeObserver en filet de sécurité.
  const appbarEl = document.getElementById('appbar');
  const tabsClipped = () => pageTabsEl.scrollWidth > pageTabsEl.clientWidth + 1;
  function fitPageTabs() {
    if (appbarEl) {
      GristBI.appbar.fitTabsLevel(tabsClipped, (level) => {
        appbarEl.classList.toggle('bar-names-hidden', level === 1);
        appbarEl.classList.toggle('bar-labels-hidden', level === 2);
      }, !viewsActiveNameEl.hidden);
    }
    updateTabsOverflow();
    revealActiveTab();
  }
  // L'onglet actif doit rester visible dans une liste qui défile (la largeur disponible vient peut-être de changer). On fait défiler la LISTE
  // des onglets seulement, jamais `scrollIntoView` : il fait aussi défiler la page, et la barre étant collante (`sticky`), un redimensionnement
  // de la fenêtre emportait la page plus bas (bug réel n°52, vu en prenant des captures pleine page).
  function revealActiveTab() {
    const tab = pageTabsEl.querySelector('.page-tab-group.active');
    if (!tab) return;
    const box = pageTabsEl.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left < box.left) pageTabsEl.scrollLeft -= box.left - at.left;
    else if (at.right > box.right) pageTabsEl.scrollLeft += at.right - box.right;
  }
  window.addEventListener('resize', fitPageTabs);
  // Différé d'une image : modifier la barre dans le rappel d'un ResizeObserver qui l'observe ferait « loop completed with undelivered notifications ».
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(fitPageTabs)).observe(pageTabsEl);
  let restoreTabFocus = false; // le rendu qui suit une flèche doit rendre le focus à l'onglet actif
  function renderPageTabs(pages, currentPageId) {
    pageTabsEl.innerHTML = pages.map((p) => {
      const active = p.id === currentPageId;
      const removeBtn = active && pages.length > 1
        ? `<button type="button" class="page-tab-remove edit-only" data-page-id="${escapeHtml(p.id)}" title="${escapeHtml(t('pages.remove.title'))}" aria-label="${escapeHtml(t('pages.remove.title'))}">${icon('close')}</button>`
        : '';
      return `<span class="page-tab-group${active ? ' active' : ''}"><button type="button" class="page-tab${active ? ' active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-page-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>${removeBtn}</span>`;
    }).join('');
    const tabs = Array.from(pageTabsEl.querySelectorAll('.page-tab'));
    tabs.forEach((tab, index) => {
      const pageId = tab.dataset.pageId;
      tab.addEventListener('click', () => store.setCurrentPage(pageId));
      tab.addEventListener('keydown', (e) => {
        const target = GristBI.appbar.tabKeyTarget(e.key, index, tabs.length);
        if (target == null) return;
        e.preventDefault();
        restoreTabFocus = true;
        store.setCurrentPage(tabs[target].dataset.pageId);
      });
      tab.addEventListener('dblclick', async () => {
        if (mode !== 'edit') return;
        const page = pages.find((p) => p.id === pageId);
        const answer = await GristBI.dialogs.prompt({
          title: t('pages.rename.title'), label: t('pages.rename.prompt'),
          value: page ? page.name : '', confirmLabel: t('pages.rename.confirm')
        });
        const name = (answer || '').trim();
        if (name) store.renamePage(pageId, name);
      });
    });
    const activeTab = pageTabsEl.querySelector('.page-tab.active');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (restoreTabFocus) {
      restoreTabFocus = false;
      if (activeTab) activeTab.focus();
    }
    for (const removeBtn of pageTabsEl.querySelectorAll('.page-tab-remove')) {
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pageId = removeBtn.dataset.pageId;
        const page = pages.find((p) => p.id === pageId);
        const ok = await GristBI.dialogs.confirm({
          title: t('pages.remove.dialogTitle'), message: t('pages.remove.confirm', { name: page ? page.name : '' }),
          confirmLabel: t('pages.remove.confirmLabel'), danger: true
        });
        if (ok) store.removePage(pageId);
      });
    }
  }

  // Un badge par filtre actif (plusieurs colonnes peuvent être filtrées en même temps), chacun
  // avec son propre bouton de suppression, + le bouton "Effacer les filtres" global reste utile
  // dès qu'il y en a 2+.
  function renderFilterBadges(activeFilters) {
    filterBadgesEl.innerHTML = activeFilters.map((f) => `
      <span class="filter-chip">
        ${f.type && f.type !== 'eq' ? escapeHtml(describeAdvancedFilter(f)) : `${escapeHtml(f.column)} = ${escapeHtml(String(f.value))}`}
        <button type="button" class="filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="${escapeHtml(t('filters.remove.aria'))}">${icon('close')}</button>
      </span>
    `).join('');
    for (const btn of filterBadgesEl.querySelectorAll('.filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearFilter(btn.dataset.column));
    }
  }

  // Rangée de pastilles sous la barre (visible seulement avec au moins un filtre, croisé ou avancé),
  // « Effacer les filtres » (les deux familles) et compteur sur le bouton « Filtre ».
  // La rangée reste visible tant qu'une vue sauvegardée est suivie, même sans aucun filtre (la vue
  // peut être « modifiée » justement parce qu'on les a tous levés).
  function renderFilterSummary(total, viewTracked) {
    chipsRowEl.hidden = total === 0 && !viewTracked;
    clearFilterBtn.hidden = total === 0;
    filterCountEl.hidden = total === 0;
    filterCountEl.textContent = String(total);
  }

  // Mêmes clés que les options du <select> "Période" du formulaire de filtre avancé (voir
  // index.html/harness.html, filters.relative.*) — un seul texte traduit pour les deux.
  const RELATIVE_DATE_KEYS = {
    last7d: 'filters.relative.last7d', last30d: 'filters.relative.last30d', thisMonth: 'filters.relative.thisMonth',
    thisYear: 'filters.relative.thisYear', last12m: 'filters.relative.last12m'
  };

  // Libellé lisible d'un filtre avancé pour son badge (voir GristBI.data.matchesFilter pour la
  // sémantique de chaque type). Une plage/plage de dates avec une seule borne renseignée l'affiche
  // sans l'autre plutôt que "… – " ou "de … à undefined".
  function describeAdvancedFilter(f) {
    switch (f.type) {
      case 'range': {
        // Classe d'histogramme : borne haute exclue (voir data.js:matchesFilter, `maxExclusive`).
        if (f.min != null && f.max != null && f.maxExclusive) return t('filters.rangeExclusive', { column: f.column, min: f.min, max: f.max });
        if (f.min != null && f.max != null) return `${f.column} : ${f.min} – ${f.max}`;
        if (f.min != null) return `${f.column} ≥ ${f.min}`;
        if (f.max != null) return `${f.column} ≤ ${f.max}`;
        return `${f.column} : ${t('filters.emptyRange')}`;
      }
      case 'dateRange': {
        if (f.start && f.end) return `${f.column} : ${f.start} → ${f.end}`;
        if (f.start) return `${f.column} ≥ ${f.start}`;
        if (f.end) return `${f.column} ≤ ${f.end}`;
        return `${f.column} : ${t('filters.emptyRange')}`;
      }
      case 'relativeDate':
        return `${f.column} : ${RELATIVE_DATE_KEYS[f.preset] ? t(RELATIVE_DATE_KEYS[f.preset]) : f.preset}`;
      case 'contains':
        return `${f.column} ${t('filters.contains')} "${f.query}"`;
      default:
        return `${f.column} : ${f.type}`;
    }
  }

  // Filtres avancés (barre dédiée, pas un clic sur une tuile) : mêmes badges que les filtres
  // croisés, mais retirés via clearAdvancedFilter et sans bouton "Effacer les filtres" partagé (une
  // barre de filtres avancés vide se contente de n'afficher aucun badge).
  function renderAdvancedFilterBadges(advancedFilters) {
    advancedFilterBadgesEl.innerHTML = advancedFilters.map((f) => `
      <span class="filter-chip">
        ${escapeHtml(describeAdvancedFilter(f))}
        <button type="button" class="advanced-filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="${escapeHtml(t('filters.remove.aria'))}">${icon('close')}</button>
      </span>
    `).join('');
    for (const btn of advancedFilterBadgesEl.querySelectorAll('.advanced-filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearAdvancedFilter(btn.dataset.column));
    }
  }

  // Menu Vues + suivi de la vue active (retours d'Antoine du 18/11/2026, point 4). Avant : un <select>
  // qui appliquait la vue au choix mais n'indiquait ni laquelle on regardait, ni si les filtres s'en
  // étaient écartés. Maintenant : la liste des vues (la vue suivie cochée, « modifiée » si besoin,
  // une croix par vue), le nom de la vue suivie sur le bouton de la barre (+ un point quand elle est
  // modifiée) et une pastille sous la barre pour la mettre à jour ou la quitter. Les écouteurs sont
  // posés une fois sur la liste (délégation) : elle est reconstruite à chaque rendu.
  function renderBookmarks(state) {
    const bookmarks = state.bookmarks;
    const active = bookmarks.find((b) => b.id === state.activeBookmarkId) || null;
    const modified = Boolean(active) && state.activeBookmarkModified;

    viewsListEl.innerHTML = bookmarks.map((b) => {
      const isActive = active && b.id === active.id;
      return `<li class="views-item${isActive ? ' views-item-active' : ''}">
        <button type="button" class="views-item-apply" data-id="${escapeHtml(b.id)}"${isActive ? ' aria-current="true"' : ''}
                aria-label="${escapeHtml(t('views.apply.aria', { name: b.name }))}">
          <svg class="icon icon-check views-item-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7"/></svg>
          <span class="views-item-name">${escapeHtml(b.name)}</span>
          ${isActive ? `<span class="views-item-badge${modified ? ' is-modified' : ''}">${escapeHtml(t(modified ? 'views.modified' : 'views.current'))}</span>` : ''}
        </button>
        <button type="button" class="views-item-delete" data-id="${escapeHtml(b.id)}"
                aria-label="${escapeHtml(t('views.delete.aria', { name: b.name }))}" title="${escapeHtml(t('views.delete.title'))}">
          <svg class="icon icon-close" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </li>`;
    }).join('');
    viewsEmptyEl.hidden = bookmarks.length > 0;

    updateBookmarkBtn.hidden = !modified;
    if (modified) updateBookmarkBtn.textContent = t('views.update', { name: active.name });
    saveBookmarkBtn.textContent = t(active ? 'views.saveNew' : 'bookmarks.save');

    viewsActiveNameEl.hidden = !active;
    viewsActiveNameEl.textContent = active ? active.name : '';
    viewsActiveDotEl.hidden = !modified;
    viewsToggleBtn.dataset.viewActive = active ? 'true' : 'false';
    const toggleName = active ? t(modified ? 'views.toggle.ariaModified' : 'views.toggle.aria', { name: active.name }) : t('bar.views');
    viewsToggleBtn.setAttribute('aria-label', toggleName);
    viewsToggleBtn.title = toggleName;

    viewChipEl.hidden = !active;
    viewChipEl.dataset.modified = modified ? 'true' : 'false';
    viewChipNameEl.textContent = active ? active.name : '';
    viewChipModifiedEl.hidden = !modified;
    viewChipUpdateBtn.hidden = !modified;
  }

  // `opts.preview` : version de l'aperçu du panneau latéral — même corps (c'est ce que cherchent les
  // fonctions de rendu de js/charts.js), mais sans les boutons d'action ni les écouteurs du store.
  function buildTileElement(tile, opts) {
    const preview = Boolean(opts && opts.preview);
    const el = document.createElement('div');
    el.className = `tile tile-${tile.type}`;
    el.dataset.tileId = tile.id;
    el.dataset.tileType = tile.type;
    // data-i18n-aria/-title (en plus du texte déjà traduit ci-dessous) : cette tuile est mise en
    // cache et jamais reconstruite tant qu'elle existe (voir render()), donc un changement de
    // langue seul ne repasserait jamais ici — c'est GristBI.i18n.applyTranslations(), appelé à
    // chaque render(), qui retrouve ces boutons par leurs attributs et les corrige sans
    // reconstruction (voir le commentaire en tête de render()).
    const header = `<div class="tile-header"><span class="tile-title" title="${escapeHtml(GristBI.i18n.tileTitle(tile))}">${escapeHtml(GristBI.i18n.tileTitle(tile))}</span>
        ${preview ? '' : `<span class="tile-actions">
          <button class="tile-move-left edit-only" type="button" data-i18n-aria="tile.moveLeft" data-i18n-title="tile.moveLeft" aria-label="${escapeHtml(t('tile.moveLeft'))}" title="${escapeHtml(t('tile.moveLeft'))}">${icon('chevronLeft')}</button>
          <button class="tile-move-right edit-only" type="button" data-i18n-aria="tile.moveRight" data-i18n-title="tile.moveRight" aria-label="${escapeHtml(t('tile.moveRight'))}" title="${escapeHtml(t('tile.moveRight'))}">${icon('chevronRight')}</button>
          <button class="tile-edit edit-only" type="button" data-i18n-aria="tile.edit.aria" data-i18n-title="tile.edit.title" aria-label="${escapeHtml(t('tile.edit.aria'))}" title="${escapeHtml(t('tile.edit.title'))}">${icon('edit')}</button>
          <button class="tile-zoom" type="button" aria-pressed="false" aria-label="${escapeHtml(t('tile.zoom.aria'))}" title="${escapeHtml(t('tile.zoom.title'))}">${icon('expand')}${icon('collapse')}</button>
          <button class="tile-comments" type="button" data-i18n-aria="tile.comments.aria" data-i18n-title="tile.comments.title" aria-label="${escapeHtml(t('tile.comments.aria'))}" title="${escapeHtml(t('tile.comments.title'))}">${icon('comment')}<span class="tile-comments-count" hidden></span></button>
          <button class="tile-detail" type="button" data-i18n-aria="tile.detail.aria" data-i18n-title="tile.detail.title" aria-label="${escapeHtml(t('tile.detail.aria'))}" title="${escapeHtml(t('tile.detail.title'))}">${icon('search')}</button>
          <button class="tile-remove edit-only" type="button" data-i18n-aria="tile.remove.aria" data-i18n-title="tile.remove.title" aria-label="${escapeHtml(t('tile.remove.aria'))}" title="${escapeHtml(t('tile.remove.title'))}">${icon('close')}</button>
        </span>`}</div>`;
    el.innerHTML = tile.type === 'text'
      ? `${header}
         <div class="tile-text-body"></div>`
      : tile.type === 'kpi'
      ? `${header}
         <div class="tile-kpi">
           <span class="tile-kpi-value">-</span>
           <span class="tile-kpi-label">${escapeHtml(tile.aggFn)}(${escapeHtml(tile.measure)})</span>
           <span class="tile-kpi-trend" hidden></span>
           <div class="tile-kpi-spark" hidden></div>
           <div class="tile-kpi-goal" hidden>
             <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="goal-fill"></span></div>
             <div class="goal-text"><span class="goal-pct"></span><span class="goal-target"></span></div>
           </div>
         </div>`
      : `${header}
         <div class="tile-breadcrumb" data-tile-id="${escapeHtml(tile.id)}" hidden></div>
         <div class="tile-chart" data-tile-id="${escapeHtml(tile.id)}"></div>`;
    if (preview) return el;
    el.querySelector('.tile-remove').addEventListener('click', () => {
      if (tile.id === editingTileId) closeTilePanel(false); // formulaire en cours d'édition sur une tuile qui disparaît
      store.removeTile(tile.id);
    });
    // Toujours la tuile VIVE du store, jamais l'objet capturé à la création de cet élément (mis en
    // cache et jamais reconstruit, voir render()) : après une modification, ce dernier serait périmé
    // (le formulaire d'édition rechargerait les anciennes valeurs).
    const liveTile = () => store.getState().tiles.find((x) => x.id === tile.id) || tile;
    el.querySelector('.tile-edit').addEventListener('click', () => startEditTile(liveTile()));
    // Agrandir/réduire : le rendu suivant déplace la tuile ; on la ramène ensuite à l'écran, la zone
    // d'agrandissement étant au-dessus de ce que la personne regardait peut-être.
    el.querySelector('.tile-zoom').addEventListener('click', () => { store.toggleZoom(tile.id); flashTile(tile.id); });
    el.querySelector('.tile-comments').addEventListener('click', () => openCommentsModal(liveTile()));
    el.querySelector('.tile-detail').addEventListener('click', () => openDetailModal(liveTile()));
    // L'état est relu au clic (piège n°18), jamais figé à la création de la tuile : la page change d'agencement sans que la tuile soit recréée.
    const moveBy = (direction) => {
      const live = store.getState();
      const target = GristBI.layouts.moveTarget(live.pageLayout, live.tiles, tile.id, direction);
      if (target !== null) store.moveTile(tile.id, direction, target);
    };
    el.querySelector('.tile-move-left').addEventListener('click', () => moveBy(-1));
    el.querySelector('.tile-move-right').addEventListener('click', () => moveBy(1));
    return el;
  }

  // Nom saisi une fois, mémorisé d'une session à l'autre comme la langue — pas la peine de le
  // retaper à chaque commentaire. Dans GFS (consigne 007, point 3), passe par
  // `GfsLink.storageGet`/`storageSet` (contrats 5.3) plutôt que `localStorage`, peu fiable dans le
  // sous-cadre isolé de GFS (voir gfsLink/gfsLinkReady en tête de fichier) ; hors GFS, ou si le
  // lien n'a pas pu se charger, retombe sur `localStorage` — comportement d'avant cette consigne.
  // Le `typeof` reste DANS le `try` (consigne GFS 007, point 1) : dans ce cadre isolé, lire
  // `localStorage` lève une exception même à travers un `typeof`, elle n'est jamais simplement
  // absente comme sous Node.
  function loadSavedCommentAuthor() {
    if (gfsLink && gfsLink.hosted) return gfsLink.storageGet('gristbi_comment_author') || '';
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem('gristbi_comment_author') || '';
    } catch (e) { return ''; }
  }
  function saveCommentAuthor(author) {
    if (gfsLink && gfsLink.hosted) { gfsLink.storageSet('gristbi_comment_author', author); return; }
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('gristbi_comment_author', author);
    } catch (e) { /* stockage indisponible (cadre isolé compris) - sans conséquence, juste à retaper la prochaine fois */ }
  }

  // "Rapport modifié par" (consigne GFS 007, point 2, colonne ModifiePar) : MÊME précédence que le
  // champ Auteur du formulaire de commentaire ci-dessus (openCommentsModal) - l'adresse détectée
  // automatiquement (table-sonde BI_Dashboard_UserProbe, voir bootstrap()) quand elle est connue,
  // sinon le nom mémorisé pour les commentaires, sinon `null` (saveConfig laisse alors la colonne
  // telle qu'elle est plutôt que d'y écrire une chaîne vide). La consigne évoque aussi "Nom
  // <adresse>" comme Publipostage+ ; non reproduit ici, faute d'un moyen de connaître à la fois un
  // NOM et une adresse dans ce widget — detectedUserEmail et loadSavedCommentAuthor() sont déjà
  // deux sources ALTERNATIVES nulle part combinées ailleurs dans ce fichier (voir
  // openCommentsModal), jamais les deux à la fois.
  function currentReportAuthorLabel() {
    if (detectedUserEmail) return detectedUserEmail;
    return loadSavedCommentAuthor() || null;
  }

  // Reconstruit la liste de commentaires affichée dans #comments-modal pour `commentsModalTileId`
  // — relit TOUJOURS l'état vivant du store (comme le gestionnaire de clic générique de
  // js/charts.js), jamais une variable capturée au moment de l'ouverture, pour qu'un ajout de
  // commentaire (ou un changement de langue, voir GristBI.i18n.onChange plus bas) mette la liste à
  // jour sans avoir à refermer/rouvrir le panneau.
  function renderCommentsModal() {
    if (!commentsModalTileId) return;
    const comments = GristBI.data.commentsForTile(store.getState().comments, commentsModalTileId);
    const locale = GristBI.i18n.getLang() === 'en' ? 'en-US' : 'fr-FR';
    commentsListEl.innerHTML = comments.map((c) => `
      <li class="comment-item">
        <div class="comment-meta"><strong>${escapeHtml(c.Author)}</strong><span class="comment-date">${escapeHtml(new Date(c.CreatedAt).toLocaleString(locale))}</span></div>
        <p class="comment-text">${escapeHtml(c.Text)}</p>
      </li>`).join('');
    commentsEmptyEl.hidden = comments.length > 0;
  }

  function openCommentsModal(tile) {
    commentsModalTileId = tile.id;
    commentsModalTileEl.textContent = GristBI.i18n.tileTitle(tile);
    // Auteur reconnu automatiquement quand la détection a abouti (voir detectedUserEmail
    // ci-dessus) : champ pré-rempli et verrouillé, cohérence garantie avec la véritable identité
    // Grist plutôt qu'un nom retapé/modifiable. Repli IDENTIQUE à avant cette fonctionnalité sinon.
    if (detectedUserEmail) {
      commentAuthorInput.value = detectedUserEmail;
      commentAuthorInput.readOnly = true;
    } else {
      commentAuthorInput.value = loadSavedCommentAuthor();
      commentAuthorInput.readOnly = false;
    }
    commentAuthorNote.hidden = !detectedUserEmail;
    commentTextInput.value = '';
    renderCommentsModal();
    commentsModal.hidden = false;
    commentTextInput.focus();
  }

  function closeCommentsModal() {
    commentsModal.hidden = true;
    commentsModalTileId = null;
  }

  // Modale de détail (substitut du drillthrough, voir index.html/ROADMAP.md) : affiche les lignes
  // BRUTES actuellement reçues par la tuile (GristBI.data.rowsForTile, même filtrage que le rendu
  // ECharts/l'export Excel — cross-filtres des AUTRES tuiles, filtres avancés, et le propre chemin
  // de drill-down de la tuile), pas seulement le segment cliqué : l'utilisateur a déjà affiné sa
  // vue en filtrant/drillant avant de vouloir le détail. Relit l'état vivant à chaque rendu (comme
  // renderCommentsModal) plutôt qu'un instantané figé à l'ouverture, pour rester cohérente si un
  // filtre est posé/levé pendant qu'elle est ouverte. Colonnes = `Object.keys(rows[0])`, même
  // convention que `availableColumns()` (js/main.js) : la 1re ligne représente la forme commune.
  // Plafonnée à DETAIL_MODAL_MAX_ROWS lignes affichées (une table de travail à fort volume peut en
  // compter des dizaines de milliers) — un tableau HTML de cette taille sans pagination serait un
  // coût DOM inutile pour une modale d'inspection ; l'export Excel reste la voie pour tout voir d'un coup.
  function renderDetailModal() {
    if (!detailModalTileId) return;
    const state = store.getState();
    const tile = state.tiles.find((tl) => tl.id === detailModalTileId);
    if (!tile) { closeDetailModal(); return; } // tuile supprimée entre-temps (voir charts.js, même garde)

    const rows = GristBI.data.rowsForTile(tile, state);
    detailModalTitleEl.textContent = t('detail.modal.title', { n: rows.length });
    detailModalEmptyEl.hidden = rows.length > 0;

    const shown = rows.slice(0, DETAIL_MODAL_MAX_ROWS);
    if (!shown.length) {
      detailModalTableWrapEl.innerHTML = '';
    } else {
      const columns = Object.keys(shown[0]);
      const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const body = shown.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c] == null ? '' : row[c])}</td>`).join('')}</tr>`).join('');
      detailModalTableWrapEl.innerHTML = `<table class="detail-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    detailModalTruncatedEl.hidden = rows.length <= DETAIL_MODAL_MAX_ROWS;
    if (rows.length > DETAIL_MODAL_MAX_ROWS) {
      detailModalTruncatedEl.textContent = t('detail.modal.truncated', { shown: shown.length, total: rows.length });
    }
  }

  function openDetailModal(tile) {
    detailModalTileId = tile.id;
    renderDetailModal();
    detailModal.hidden = false;
  }

  function closeDetailModal() {
    detailModal.hidden = true;
    detailModalTileId = null;
  }

  // id de tuile unique parmi celles créées dans la même milliseconde (ex. import Power BI en lot,
  // voir handlePbixImportCreate plus bas) : l'horodatage seul ne suffit pas dans ce cas, `suffix`
  // (index dans le lot) lève l'ambiguïté avant même la part aléatoire.
  function genTileId(suffix) {
    return 'tile_' + Date.now().toString(36) + (suffix != null ? '_' + suffix : '') + Math.random().toString(36).slice(2, 6);
  }

  // --- Import de la MISE EN PAGE d'un fichier Power BI (.pbix/.pbit) --------------------------
  // Partie pure (parsing ZIP, décodage Report/Layout, extraction des visuels, correspondance de
  // colonnes) dans js/pbix-layout.js, testée sous Node — tout ce qui suit est la glue navigateur
  // (lecture de fichier, DOM), jamais testée sous Node pour cette raison (voir TEST_PROTOCOL.md).
  // Importe UNIQUEMENT la mise en page (quels visuels, quel type, quelles colonnes) vers des
  // tuiles sur la table de travail DÉJÀ connectée — jamais les données du fichier Power BI, jamais
  // de table créée par ce chemin (voir CLAUDE.md, étude de faisabilité du 2026-11-03 : le format de
  // stockage des données, VertiPaq, est propriétaire et non documenté officiellement).
  let pbixImportSuggestions = []; // dernière liste affichée dans la modale, relue par "Créer les tuiles sélectionnées"

  // Décompresse une entrée ZIP DEFLATE via l'API navigateur native (`DecompressionStream`), sans la
  // moindre nouvelle dépendance — disponible dans tous les navigateurs évergreens visés par ce
  // widget (Chrome/Edge 80+, Firefox 97+, Safari 16.4+). Seule l'entrée Report/Layout (quelques Ko
  // à dizaines de Ko) passe par ici ; `DataModel`, bien plus gros, est stocké NON compressé au
  // niveau ZIP (voir l'en-tête de js/pbix-layout.js) et n'est de toute façon jamais lu par ce
  // chemin.
  async function inflateRawBrowser(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Un visuel sans tuile équivalente n'arrive déjà plus jusqu'ici (GristBI.pbixLayout.suggestTiles
  // filtre sur les types reconnus) : une suggestion affichée ici est donc toujours soit prête à
  // créer (`tileData` rempli), soit bloquée UNIQUEMENT par des colonnes introuvables
  // (`missingFields` forcément non vide dans ce cas, voir js/pbix-layout.js).
  function renderPbixImportResults() {
    pbixImportResultsEl.innerHTML = pbixImportSuggestions.map((s, i) => {
      const disabled = !s.tileData;
      const meta = disabled
        ? t('pbixImport.missingColumns', { columns: s.missingFields.join(', ') })
        : s.visual.visualType;
      return `<li class="pbix-import-result${disabled ? ' pbix-import-result-disabled' : ''}">
        <label>
          <input type="checkbox" data-pbix-index="${i}" ${disabled ? 'disabled' : 'checked'} />
          <span>
            <span class="pbix-import-result-title">${escapeHtml(s.title)}</span><br>
            <span class="pbix-import-result-meta">${escapeHtml(meta)}</span>
          </span>
        </label>
      </li>`;
    }).join('');
    pbixImportCreateBtn.hidden = !pbixImportSuggestions.some((s) => s.tileData);
  }

  async function handlePbixImportFile(file) {
    pbixImportSuggestions = [];
    pbixImportResultsEl.innerHTML = '';
    pbixImportCreateBtn.hidden = true;
    if (!file) { pbixImportStatusEl.textContent = ''; return; }
    pbixImportStatusEl.textContent = t('pbixImport.reading');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = GristBI.pbixLayout.parseZipCentralDirectory(buf);
      const layoutEntry = entries.find((e) => e.name === 'Report/Layout');
      if (!layoutEntry) { pbixImportStatusEl.textContent = t('pbixImport.noLayout'); return; }
      const layoutBytes = await GristBI.pbixLayout.readZipEntryBytes(buf, layoutEntry, inflateRawBrowser);
      const layoutJson = GristBI.pbixLayout.decodeLayoutJson(layoutBytes);
      const visuals = GristBI.pbixLayout.extractVisuals(layoutJson);
      pbixImportSuggestions = GristBI.pbixLayout.suggestTiles(visuals, availableColumns(store.getState().rows));
      if (!pbixImportSuggestions.length) { pbixImportStatusEl.textContent = t('pbixImport.noVisual'); return; }
      const n = pbixImportSuggestions.filter((s) => s.tileData).length;
      pbixImportStatusEl.textContent = t('pbixImport.found', { n, total: pbixImportSuggestions.length });
      renderPbixImportResults();
    } catch (e) {
      console.error('[GristBI] échec de la lecture du fichier Power BI', e);
      pbixImportStatusEl.textContent = t('pbixImport.readFailed');
    }
  }

  function handlePbixImportCreate() {
    const checked = pbixImportResultsEl.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
    let created = 0;
    checked.forEach((cb) => {
      const suggestion = pbixImportSuggestions[Number(cb.dataset.pbixIndex)];
      if (!suggestion || !suggestion.tileData) return;
      store.addTile(Object.assign({ id: genTileId(created) }, suggestion.tileData));
      created++;
    });
    pbixImportStatusEl.textContent = t('pbixImport.created', { n: created });
    pbixImportSuggestions = [];
    pbixImportResultsEl.innerHTML = '';
    pbixImportCreateBtn.hidden = true;
    pbixImportFileInput.value = '';
  }

  // --- Import des DONNÉES d'un CSV exporté depuis Power BI --------------------------------------
  // Complète l'import de mise en page ci-dessus : js/csv-import.js (pur, testé Node) détecte le
  // délimiteur/les types de colonnes et convertit déjà les valeurs — tout ce qui suit est la glue
  // navigateur (lecture de fichier, DOM, création de la table dans Grist), jamais testée sous Node
  // pour cette raison, même convention que le reste de cette modale. Contrairement à l'import de
  // mise en page ci-dessus, CE chemin crée une VRAIE table de données dans le document —
  // exception ponctuelle à la règle habituelle "ce widget ne crée aucune table de données"
  // (CLAUDE.md §1/§3/§7/§8), accordée par Antoine le 03/11/2026 spécifiquement pour l'import Power
  // BI, et gardée derrière une pop-up de confirmation explicite (voir handleCsvImportConfirmYes)
  // avant le moindre AddTable.
  let csvImportParsed = null; // { columns, rows, rowCount } de la dernière lecture réussie
  let csvImportPendingTableName = null; // nom proposé à l'utilisateur sur la pop-up de confirmation

  function renderCsvImportColumns(columns) {
    csvImportColumnsEl.innerHTML = columns.map((c) => `
      <li class="csv-import-column">
        <span class="csv-import-col-label">${escapeHtml(c.label)}</span>
        <span class="csv-import-col-type">${escapeHtml(c.type)}</span>
      </li>
    `).join('');
  }

  // Nom de table proposé par défaut (modifiable avant confirmation) : nom de fichier sans
  // extension, assaini en identifiant Grist valide — même règles que
  // GristBI.csvImport.sanitizeColumnId (lettre/underscore en tête, puis lettres/chiffres/
  // underscores), jamais vide.
  function suggestTableNameFromFile(file) {
    const base = file.name.replace(/\.csv$/i, '').trim();
    const sanitized = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Import';
    return /^[0-9]/.test(sanitized) ? 'T_' + sanitized : sanitized;
  }

  async function handleCsvImportFile(file) {
    csvImportParsed = null;
    csvImportPreviewEl.hidden = true;
    csvImportConfirmEl.hidden = true;
    if (!file) { csvImportStatusEl.textContent = ''; return; }
    csvImportStatusEl.textContent = t('pbixImport.csvReading');
    try {
      const text = await file.text();
      const parsed = GristBI.csvImport.parseCsvFile(text);
      if (!parsed.rowCount || !parsed.columns.length) {
        csvImportStatusEl.textContent = t('pbixImport.csvEmpty');
        return;
      }
      csvImportParsed = parsed;
      csvImportTableNameInput.value = suggestTableNameFromFile(file);
      renderCsvImportColumns(parsed.columns);
      csvImportStatusEl.textContent = t('pbixImport.csvFound', { columns: parsed.columns.length, rows: parsed.rowCount });
      csvImportPreviewEl.hidden = false;
    } catch (e) {
      console.error('[GristBI] échec de la lecture du fichier CSV', e);
      csvImportStatusEl.textContent = t('pbixImport.csvReadFailed');
    }
  }

  // Ouvre la pop-up de confirmation (jamais d'AddTable direct depuis "Créer la table" — voir
  // l'en-tête de cette section) avec le nom de table et le volume EXACTS qui seront créés.
  function handleCsvImportCreateClick() {
    if (!csvImportParsed) return;
    const tableName = csvImportTableNameInput.value.trim();
    if (!tableName) { showNotice(t('pbixImport.csvNameRequired')); return; }
    csvImportPendingTableName = tableName;
    csvImportConfirmTextEl.textContent = t('pbixImport.csvConfirmText', {
      table: tableName, columns: csvImportParsed.columns.length, rows: csvImportParsed.rowCount
    });
    csvImportConfirmEl.hidden = false;
  }

  function handleCsvImportConfirmNo() {
    csvImportConfirmEl.hidden = true;
    csvImportPendingTableName = null;
  }

  // Seul chemin qui appelle réellement GristBI.api.createTableFromRows (AddTable) — après ce
  // dernier clic explicite de confirmation. Reconnecte ensuite le widget à la table créée (comme
  // un changement manuel via le sélecteur, voir switchTable) puis, si un .pbix a déjà été lu dans
  // cette même ouverture de la modale (pbixImportSuggestions non vide, mise en page pas encore
  // créée), ré-essaie immédiatement la correspondance de colonnes : le CSV vient du MÊME fichier
  // Power BI que ce .pbix, ses en-têtes de colonnes portent donc vraisemblablement les mêmes noms,
  // sans que l'utilisateur ait à relire son .pbix une seconde fois.
  async function handleCsvImportConfirmYes() {
    if (!csvImportParsed || !csvImportPendingTableName) return;
    csvImportConfirmEl.hidden = true;
    csvImportCreateBtn.disabled = true;
    csvImportStatusEl.textContent = t('pbixImport.csvCreating');
    try {
      const actualTableId = await GristBI.api.createTableFromRows(
        csvImportPendingTableName, csvImportParsed.columns, csvImportParsed.rows,
        (phase, sent, total) => { csvImportStatusEl.textContent = t('pbixImport.csvCreatingProgress', { sent, total }); }
      );
      const rowCount = csvImportParsed.rowCount;
      csvImportStatusEl.textContent = t('pbixImport.csvCreated', { table: actualTableId, rows: rowCount });
      const { rows } = await GristBI.api.loadTable(actualTableId);
      await switchTable(actualTableId, rows);
      await refreshTablePicker();
      if (pbixImportSuggestions.length) {
        pbixImportSuggestions = GristBI.pbixLayout.suggestTiles(
          pbixImportSuggestions.map((s) => s.visual), availableColumns(rows)
        );
        renderPbixImportResults();
      }
      csvImportParsed = null;
      csvImportPendingTableName = null;
      csvImportPreviewEl.hidden = true;
      csvImportFileInput.value = '';
    } catch (e) {
      console.error('[GristBI] échec de la création de la table depuis le CSV importé', e);
      csvImportStatusEl.textContent = t('pbixImport.csvCreateFailed');
    } finally {
      csvImportCreateBtn.disabled = false;
    }
  }

  // Pastilles de la palette choisie sous la liste (une liste native ne sait pas montrer de couleurs).
  // CSSOM (`style.background`), jamais un attribut `style` posé en HTML : même règle que le reste du widget.
  function updatePaletteSwatch() {
    paletteSwatch.textContent = '';
    // Carte de chaleur / tableau croisé coloré : la pastille montre le dégradé réellement utilisé (4 arrêts, clair -> foncé).
    const heat = tileTypeSelect.value === 'heatmap' || (tileTypeSelect.value === 'pivot' && pivotHeatCheckbox.checked);
    paletteHint.hidden = !heat;
    (heat ? GristBI.data.heatStops(paletteSelect.value) : GristBI.data.paletteColors(paletteSelect.value)).forEach((color) => {
      const chip = document.createElement('span');
      chip.style.background = color;
      paletteSwatch.appendChild(chip);
    });
  }

  // Affiche/masque le réglage « Personnalisé » et écrit l'explication du mode choisi. Appelée par
  // updateFormFieldsForType et à chaque activité du formulaire (changer de mesure ou d'agrégation change le
  // verdict de « Comme dans la colonne »).
  function updateNumberFormatUI() {
    const mode = numFmtSelect.value;
    numFmtCustom.hidden = mode !== 'custom';
    let key = null;
    let vars = {};
    if (mode === 'auto') key = 'tileForm.numFormat.hint.auto';
    else if (mode === 'column' && tileTypeSelect.value === 'table') {
      key = 'tileForm.numFormat.hint.columnEach'; // pas de mesure : chaque colonne numérique reprend son propre format
    } else if (mode === 'column') {
      const state = GristBI.format.columnModeState({ aggFn: aggSelect.value }, measureSelect.value);
      key = `tileForm.numFormat.hint.column${state.charAt(0).toUpperCase()}${state.slice(1)}`;
      vars = { column: measureSelect.value };
    }
    numFmtHint.hidden = !key;
    numFmtHint.textContent = key ? t(key, vars) : '';
  }

  // Lecture/écriture du réglage dans le formulaire (jamais « auto » dans la configuration : une tuile sans
  // `numberFormat` est déjà en Automatique, voir readTileForm).
  function setNumberFormatForm(spec) {
    const s = GristBI.format.normalizeSpec(spec);
    numFmtSelect.value = s.mode;
    numFmtDecimals.value = s.mode === 'custom' ? String(s.decimals) : 'auto';
    numFmtCompact.checked = s.mode === 'custom' && s.notation === 'compact';
    updateNumberFormatUI();
  }
  function numberFormatFromForm() {
    const mode = numFmtSelect.value;
    if (mode === 'column') return { mode: 'column' };
    if (mode === 'custom') {
      const d = numFmtDecimals.value;
      return { mode: 'custom', decimals: d === 'auto' ? 'auto' : Number(d), notation: numFmtCompact.checked ? 'compact' : 'standard' };
    }
    return undefined;
  }
  // --- Table plate : colonnes à afficher (cases à cocher + flèches d'ordre) -----------------------------------
  // `tile.columns` = les colonnes COCHÉES, dans l'ordre de la liste. Les colonnes non cochées suivent, dans
  // l'ordre de la table. L'état vit dans le DOM (une ligne `li[data-col]` par colonne) : la lecture
  // (`readColumnsPicker`) ne mémorise rien, donc rien à resynchroniser quand la table change.
  function readColumnsOrder() { return Array.from(tileColumnsList.querySelectorAll('li')).map((li) => li.dataset.col); }
  function readColumnsPicker() {
    return Array.from(tileColumnsList.querySelectorAll('li')).filter((li) => li.querySelector('input').checked).map((li) => li.dataset.col);
  }
  function renderColumnsPicker(order, checkedSet, focusCol, focusDir) {
    tileColumnsList.innerHTML = '';
    order.forEach((col, i) => {
      const li = document.createElement('li');
      li.dataset.col = col;
      li.innerHTML = `<label><input type="checkbox"> <span></span></label>`
        + `<button type="button" class="col-move" data-dir="-1" aria-label="${escapeHtml(t('tileForm.columns.up', { column: col }))}">▲</button>`
        + `<button type="button" class="col-move" data-dir="1" aria-label="${escapeHtml(t('tileForm.columns.down', { column: col }))}">▼</button>`;
      li.querySelector('span').textContent = col;
      li.querySelector('input').checked = checkedSet.has(col);
      li.querySelector('[data-dir="-1"]').disabled = i === 0;
      li.querySelector('[data-dir="1"]').disabled = i === order.length - 1;
      tileColumnsList.appendChild(li);
    });
    if (focusCol) {
      const li = Array.from(tileColumnsList.children).find((n) => n.dataset.col === focusCol);
      const btn = li && li.querySelector(`[data-dir="${focusDir}"]:not(:disabled)`) || (li && li.querySelector('.col-move:not(:disabled)'));
      if (btn) btn.focus({ preventScroll: true });
    }
  }
  // `selected` : colonnes à cocher (dans l'ordre voulu) ; les autres colonnes de `cols` suivent, décochées.
  function setColumnsPicker(selected, cols) {
    cols = cols || availableColumns(store.getState().rows);
    const sel = (selected || []).filter((c) => cols.includes(c));
    renderColumnsPicker(sel.concat(cols.filter((c) => !sel.includes(c))), new Set(sel));
  }
  function defaultTableColumns(cols) {
    const d = GristBI.advice ? GristBI.advice.defaultsForType('table', [], cols) : null;
    return d && d.columns ? d.columns : cols.slice(0, 6);
  }
  // Changement de table/de lignes : garde les cases cochées qui existent encore, sinon recoche les premières.
  function refreshColumnsPicker(cols) {
    const keep = readColumnsPicker().filter((c) => cols.includes(c));
    const order = readColumnsOrder().filter((c) => cols.includes(c));
    if (!keep.length && !order.length) { setColumnsPicker(defaultTableColumns(cols), cols); return; }
    const rest = cols.filter((c) => !order.includes(c));
    renderColumnsPicker(order.concat(rest), new Set(keep));
  }
  tileColumnsList.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.col-move');
    if (!btn) return;
    const col = btn.closest('li').dataset.col;
    const dir = Number(btn.dataset.dir);
    const checked = new Set(readColumnsPicker());
    renderColumnsPicker(GristBI.data.moveInOrder(readColumnsOrder(), col, dir), checked, col, String(dir));
    schedulePreview();
  });
  tileColumnsList.addEventListener('change', () => schedulePreview());

  function updateFormFieldsForType() {
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    const isBar = type === 'bar';
    const hasMeasureMode = isBar && measureModeSelect.value && measureModeSelect.value !== 'brut';
    const isPivot = type === 'pivot';
    const isHeatmap = type === 'heatmap';
    const isSankey = type === 'sankey';
    const isGrid = isPivot || isHeatmap || isSankey; // deux dimensions : tableau croisé, carte de chaleur (lignes + colonnes), flux (source + cible)
    const isRadar = type === 'radar';
    const isRadarColumns = isRadarColumnsMode();
    const isWordCloud = type === 'wordcloud';
    const isWordCloudSplit = isWordCloudSplitMode();
    const isText = type === 'text';
    const isTable = type === 'table';
    const isProgress = type === 'progress';
    const isCombo = type === 'combo';
    const isComboPareto = isCombo && comboModeSelect.value === 'pareto';
    const isHistogram = type === 'histogram';
    const isBox = type === 'box';
    const isGantt = type === 'gantt';
    // KPI/jauge/tuile "Barres" en mode de calcul temporel : pas de dimension de regroupement ni de
    // drill-down, juste un agrégat sur toute la sélection (le KPI peut en plus le comparer à une
    // période via "Tendance vs", la jauge le positionne sur un cadran Min/Max, la tuile Barres en
    // mode mesure affiche l'évolution mensuelle de `tile-date-column`). Le nuage de points ajoute
    // une 2e mesure (axe Y). Le pivot et le radar ajoutent une 2e dimension/un axe par valeur mais
    // n'ont pas de drill-down (voir supportsDrillDown).
    dimensionField.hidden = formHasNoDimension();
    dimensionLabel.textContent = t(type === 'sunburst' ? 'tileForm.dimension.labelRing' : isSankey ? 'tileForm.dimension.labelSource' : (isGrid ? 'tileForm.dimension.labelRows' : (type === 'calendar' ? 'tileForm.dimension.labelDate' : (isGantt ? 'tileForm.dimension.labelTask' : 'tileForm.dimension.label'))));
    columnDimensionLabel.textContent = t(isSankey ? 'tileForm.columnDimension.labelTarget' : 'tileForm.columnDimension.label');
    columnDimensionField.hidden = !isGrid;
    startColumnField.hidden = !isGantt;
    endColumnField.hidden = !isGantt;
    pivotHeatField.hidden = !isPivot;
    wordCloudSplitField.hidden = !isWordCloud;
    // Radar "compétences en colonnes" ET nuage de mots "découpage de cellule" : mesure/agrégat n'ont
    // pas de sens dans les deux cas (un axe radar = la moyenne d'une colonne ; un mot du nuage = un
    // compte d'occurrences, voir js/charts.js:renderChart / js/data.js:wordFrequency) — masqués
    // comme dimensionField/drillField ci-dessus plutôt que laissés visibles mais ignorés.
    radarModeField.hidden = !isRadar;
    radarAxesField.hidden = !isRadarColumns;
    measureField.hidden = isRadarColumns || isWordCloudSplit || isText || isTable || isGantt; // Gantt : une barre est une tâche, aucune mesure
    // Histogramme : une colonne numérique et un nombre de classes, jamais d'agrégat (on compte des lignes).
    // Boîte à moustaches : les valeurs brutes de chaque ligne, jamais un agrégat.
    aggField.hidden = isRadarColumns || isWordCloudSplit || isText || isTable || isHistogram || isBox || isGantt;
    binsField.hidden = !isHistogram;
    tileTextField.hidden = !isText;
    tileColumnsField.hidden = !isTable;
    // Objectif et seuils : la carte KPI (facultatif) et la tuile Progression (obligatoire). La courbe de la carte KPI
    // n'a de sens qu'avec une dimension de tendance (ce sont ses points).
    targetField.hidden = !(isKpi || isProgress);
    targetColumnField.hidden = !(isKpi || isProgress);
    thresholdsField.hidden = !(isKpi || isProgress);
    sparklineField.hidden = !(isKpi && trendDimensionSelect.value);
    // Comparaison élève/moyenne du groupe filtré : valable dans les DEUX modes d'axes (dimension ET
    // columns), voir ROADMAP.md — contrairement au bloc ci-dessus, pas de dépendance à isRadarColumns.
    radarEntityColumnField.hidden = !isRadar;
    radarEntityValueField.hidden = !isRadar;
    radarCompareAverageField.hidden = !isRadar;
    // Nuage de mots "découpage de cellule" : pas de drill-down non plus (voir isWordCloudSplitMode
    // et js/charts.js, clic neutralisé pour ce mode précisément).
    drillField.hidden = formHasNoDimension() || !supportsLevels(type) || isWordCloudSplit;
    // Soleil : la liste sert d'anneaux (tous visibles), pas de drill-down ; elle s'arrête à SUNBURST_MAX_LEVELS - 1 anneaux après le central.
    drillLabel.textContent = t(type === 'sunburst' ? 'tileForm.drill.labelRings' : 'tileForm.drill.label');
    trendField.hidden = !isKpi;
    gaugeMinField.hidden = !isGauge;
    gaugeMaxField.hidden = !isGauge;
    measureModeField.hidden = !isBar;
    dateColumnField.hidden = !hasMeasureMode;
    // Options d'affichage : Barres en mode mesure temporelle exclu (son axe est un mois calculé, pas
    // une catégorie à trier ni à orienter, voir GristBI.data.isSortableTile).
    const isBarBrut = isBar && !hasMeasureMode;
    sortField.hidden = !GristBI.data.isSortableTile({ type, measureMode: measureModeSelect.value, comboMode: comboModeSelect.value });
    // Séries multiples : barres (hors mode mesure temporelle) et courbe/aire seulement (voir
    // GristBI.data.isSeriesTile) — les autres types n'ont qu'une série par nature.
    seriesField.hidden = !(isBarBrut || type === 'line' || isScatter || isGantt); // nuage de points : la colonne devient la couleur des bulles ; Gantt : le statut
    seriesLabel.textContent = t(isGantt ? 'tileForm.series.labelStatus' : (isScatter ? 'tileForm.series.labelColor' : 'tileForm.series.label'));
    horizontalField.hidden = !isBarBrut;
    areaField.hidden = type !== 'line';
    // Empilé : seulement avec une colonne Séries (sinon une seule série, rien à empiler), pour les barres
    // et l'AIRE — une courbe sans remplissage empilée serait une courbe cumulée, que personne ne lit comme
    // telle (voir GristBI.data.isStackedTile).
    // Palette : tous les types qui colorent leurs marques (pas la cascade, le KPI ni le tableau croisé).
    // Ligne de repère : barres (hors mode mesure) et courbe ; la valeur fixe demande un champ de plus.
    const refOk = GristBI.data.supportsRefLine({ type, measureMode: measureModeSelect.value });
    refLineField.hidden = !refOk;
    refValueField.hidden = !(refOk && refLineSelect.value === 'value');
    paletteField.hidden = !GristBI.data.supportsPalette({ type, pivotHeat: pivotHeatCheckbox.checked });
    updatePaletteSwatch();
    numFmtField.hidden = !GristBI.data.supportsNumberFormat({ type });
    updateNumberFormatUI();
    stackField.hidden = !(seriesSelect.value && (isBarBrut || (type === 'line' && areaCheckbox.checked)));
    // 100 % : seulement quand la pile est cochée ; tracé de la courbe et étiquettes : courbe, et barres hors mode mesure.
    stackPercentField.hidden = stackField.hidden || !stackedCheckbox.checked;
    lineShapeField.hidden = type !== 'line';
    valueLabelsField.hidden = !GristBI.data.supportsValueLabels({ type, measureMode: measureModeSelect.value });
    // Ligne de repère : pas en 100 % (l'axe est en parts, un objectif brut n'y est pas comparable).
    const pctOn = !stackPercentField.hidden && stackPercentCheckbox.checked;
    refLineField.hidden = !refOk || pctOn;
    refValueField.hidden = !(refOk && !pctOn && refLineSelect.value === 'value');
    // Petits multiples : barres (hors mode mesure) et courbe avec une colonne Séries. Un petit graphique par série ne s'empile pas, ne s'oriente
    // pas, et n'a ni ligne de repère ni étiquettes de valeur (un panneau est trop petit pour les porter) : ces champs disparaissent, et
    // `readTileForm` n'écrit plus leur valeur.
    smallMultiplesField.hidden = !(seriesSelect.value && (isBarBrut || type === 'line'));
    if (!smallMultiplesField.hidden && smallMultiplesCheckbox.checked) {
      [stackField, stackPercentField, horizontalField, valueLabelsField, refLineField, refValueField].forEach((fld) => { fld.hidden = true; });
    }
    donutField.hidden = type !== 'pie';
    showPctField.hidden = type !== 'pie';
    // Combo : mode « autre mesure » = 2e mesure + son agrégat ; Pareto = rien de plus (la courbe se déduit des barres).
    comboModeField.hidden = !isCombo;
    measureYField.hidden = !(isScatter || (isCombo && !isComboPareto));
    aggYField.hidden = !(isCombo && !isComboPareto);
    measureSizeField.hidden = !isScatter;
    aggSizeField.hidden = !(isScatter && measureSizeSelect.value);
    // Ordre des champs : Combo = mesure des barres, SON agrégat, puis la courbe (mesure + agrégat) ; les autres
    // types gardent mesure, [mesure Y], agrégat. Les nœuds sont déplacés, jamais recréés (leurs combobox restent branchés).
    if (isCombo) { measureField.after(aggField); aggField.after(measureYField); measureYField.after(aggYField); }
    else { measureField.after(measureYField); measureYField.after(aggField); }
    aggLabel.textContent = t(isCombo && !isComboPareto ? 'tileForm.agg.labelBars' : 'tileForm.agg.label');
    measureYLabel.textContent = t(isCombo ? 'tileForm.measureY.labelLine' : 'tileForm.measureY.label');
    measureLabel.textContent = t(isScatter ? 'tileForm.measure.labelX' : (isCombo && !isComboPareto ? 'tileForm.measure.labelBars' : ((isHistogram || isBox) ? 'tileForm.measure.labelHistogram' : 'tileForm.measure.label')));
    updateDrillLevelsUI();
    updateRadarAxesUI();
    updateSuggestDateHierarchyVisibility();
    updateAdvancedVisibility();
    updatePanelTexts();
    schedulePreview();
  }

  // Remplit les niveaux de drill-down du formulaire avec `levels` (noms de colonnes réelles ou
  // dérivées, ex. "Date.Trimestre") : crée les comboboxes de niveau manquantes au besoin, exactement
  // comme le faisait l'édition d'une tuile existante avant cette extraction — réutilisé par le
  // bouton de suggestion Année/Trimestre/Mois/Jour ci-dessous, qui doit remplir les niveaux 2 et 3
  // sans que l'utilisateur ait cliqué "+ Niveau" à la main.
  function setDrillLevels(levels) {
    resetDrillLevels();
    const cols = availableColumns(store.getState().rows);
    levels.forEach((lvl, i) => {
      if (i >= drillLevelSelects.length) {
        const select = createDrillLevelSelect(i);
        fillCombobox(select, cols, { blankLabel: t('tileForm.none.m') });
        drillLevelsContainer.appendChild(select.parentElement);
        drillLevelSelects.push(select);
      }
      drillLevelSelects[i].value = lvl;
    });
    updateDrillLevelsUI();
  }

  // Même rôle que setDrillLevels ci-dessus, pour les axes du radar "compétences en colonnes"
  // (tile-radar-axes) : préremplit depuis `tile.radarAxes` en édition, crée les comboboxes d'axe
  // manquantes au besoin.
  function setRadarAxes(axes) {
    resetRadarAxes();
    const cols = numericColumns(store.getState().rows);
    (axes || []).forEach((col, i) => {
      if (i >= radarAxisSelects.length) {
        const select = createRadarAxisSelect(i);
        fillCombobox(select, cols);
        radarAxesContainer.appendChild(select.parentElement);
        radarAxisSelects.push(select);
      }
      radarAxisSelects[i].value = col;
    });
    updateRadarAxesUI();
  }

  function startEditTile(tile) {
    editingTileId = tile.id;
    tileTypeSelect.value = tile.type;
    if (tile.dimension) dimensionSelect.value = tile.dimension;
    setDrillLevels(tileDrillLevels(tile));
    drillCrossFilterCheckbox.checked = !!tile.drillCrossFilter;
    columnDimensionSelect.value = tile.columnDimension || '';
    startColumnSelect.value = tile.startColumn || '';
    endColumnSelect.value = tile.endColumn || '';
    seriesSelect.value = tile.seriesColumn || '';
    measureYSelect.value = tile.measureY || '';
    measureSizeSelect.value = tile.measureSize || '';
    comboModeSelect.value = tile.comboMode === 'pareto' ? 'pareto' : 'measure';
    binsInput.value = Number.isFinite(tile.bins) ? tile.bins : '';
    gaugeMinInput.value = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    gaugeMaxInput.value = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : 100;
    // Avant updateFormFieldsForType() : elle lit measureModeSelect.value/radarModeSelect.value
    // pour décider de la visibilité de dimensionField/drillField/dateColumnField/radarAxesField
    // (voir formHasNoDimension/isRadarColumnsMode).
    measureModeSelect.value = tile.measureMode || 'brut';
    dateColumnSelect.value = tile.dateColumn || '';
    radarModeSelect.value = tile.radarAxisMode === 'columns' ? 'columns' : 'dimension';
    setRadarAxes(tile.radarAxes);
    wordCloudSplitCheckbox.checked = !!tile.wordCloudSplit;
    sortSelect.value = tile.sortMode || '';
    horizontalCheckbox.checked = !!tile.horizontal;
    areaCheckbox.checked = !!tile.areaFill;
    stackedCheckbox.checked = !!tile.stacked;
    stackPercentCheckbox.checked = !!tile.stackPercent;
    smallMultiplesCheckbox.checked = !!tile.smallMultiples;
    lineShapeSelect.value = GristBI.data.LINE_SHAPES.includes(tile.lineShape) ? tile.lineShape : '';
    valueLabelsCheckbox.checked = !!tile.valueLabels;
    paletteSelect.value = GristBI.data.PALETTE_KEYS.includes(tile.palette) ? tile.palette : 'standard';
    pivotHeatCheckbox.checked = !!tile.pivotHeat;
    refLineSelect.value = GristBI.data.REF_LINE_KINDS.includes(tile.refLine) ? tile.refLine : '';
    refValueInput.value = Number.isFinite(tile.refValue) ? tile.refValue : '';
    setNumberFormatForm(tile.numberFormat);
    donutCheckbox.checked = !!tile.donut;
    showPctCheckbox.checked = !!tile.showPct;
    radarEntityColumnSelect.value = tile.radarEntityColumn || '';
    updateRadarEntityValueOptions();
    radarEntityValueSelect.value = tile.radarEntityValue || '';
    radarCompareAverageCheckbox.checked = !!tile.radarCompareAverage;
    updateFormFieldsForType();
    measureSelect.value = tile.measure || '';
    tileTextInput.value = tile.text || '';
    if (tile.type === 'table') setColumnsPicker(tile.columns);
    aggSelect.value = tile.aggFn;
    aggYSelect.value = tile.aggFnY || tile.aggFn || 'sum';
    aggSizeSelect.value = tile.aggFnSize || tile.aggFn || 'sum';
    trendDimensionSelect.value = tile.trendDimension || '';
    targetInput.value = Number.isFinite(tile.target) ? tile.target : '';
    targetColumnSelect.value = tile.targetColumn || '';
    goodPctInput.value = Number.isFinite(tile.goodPct) ? tile.goodPct : GristBI.data.DEFAULT_GOOD_PCT;
    warnPctInput.value = Number.isFinite(tile.warnPct) ? tile.warnPct : GristBI.data.DEFAULT_WARN_PCT;
    sparklineCheckbox.checked = !!tile.kpiSparkline;
    updateFormFieldsForType(); // la case « courbe » dépend de la dimension de tendance, posée juste au-dessus
    // Titre : un titre auto-composé (`titleKey`) n'est PAS recopié dans le champ — il resterait figé
    // dans la langue d'aujourd'hui ; le champ vide + son aperçu en placeholder disent « automatique ».
    tileTitleInput.value = tile.titleKey ? '' : (tile.title || '');
    openTilePanel({ step: 'configure', editing: true });
  }

  function stopEditTile() {
    editingTileId = null;
    updatePanelTexts();
  }

  tileTypeSelect.addEventListener('change', updateFormFieldsForType);
  measureModeSelect.addEventListener('change', updateFormFieldsForType);
  // La case « Empilé » dépend de la colonne Séries et, pour une courbe, de la case Aire.
  seriesSelect.addEventListener('change', updateFormFieldsForType);
  measureSizeSelect.addEventListener('change', updateFormFieldsForType); // l'agrégat de la taille n'apparaît qu'avec une colonne de taille
  trendDimensionSelect.addEventListener('change', updateFormFieldsForType);
  paletteSelect.addEventListener('change', updatePaletteSwatch);
  areaCheckbox.addEventListener('change', updateFormFieldsForType);
  stackedCheckbox.addEventListener('change', updateFormFieldsForType);
  stackPercentCheckbox.addEventListener('change', updateFormFieldsForType);
  smallMultiplesCheckbox.addEventListener('change', updateFormFieldsForType);
  pivotHeatCheckbox.addEventListener('change', updateFormFieldsForType);
  refLineSelect.addEventListener('change', updateFormFieldsForType);
  radarModeSelect.addEventListener('change', updateFormFieldsForType);
  comboModeSelect.addEventListener('change', updateFormFieldsForType);
  wordCloudSplitCheckbox.addEventListener('change', updateFormFieldsForType);
  // Changer de colonne de comparaison invalide la valeur déjà choisie (elle appartenait à l'ANCIENNE
  // colonne) : vidée plutôt que laissée incohérente, même principe que `truncateDrillLevelsAfter`.
  radarEntityColumnSelect.addEventListener('change', () => {
    radarEntityValueSelect.value = '';
    updateRadarEntityValueOptions();
  });
  dimensionSelect.addEventListener('change', () => updateSuggestDateHierarchyVisibility());

  // Applique la suggestion Année/Trimestre/Mois/Jour : bascule la dimension sur la colonne Année
  // dérivée (voir withDateHierarchies) et préremplit les niveaux de drill-down avec
  // Trimestre/Mois/`dateColumn` — la colonne de date d'origine sert de dernier niveau (Jour), voir
  // GristBI.data.deriveDateHierarchyColumns pour la raison de ne pas dériver ce niveau. Un clic
  // configure, ne soumet pas le formulaire — l'utilisateur garde la main pour ajuster avant de
  // valider, comme pour tout autre choix de dimension/drill-down.
  suggestDateHierarchyBtn.addEventListener('click', () => {
    const dateColumn = dimensionSelect.value;
    if (!dateColumn || inferColumnKind(dateColumn) !== 'date') return;
    dimensionSelect.value = `${dateColumn}.Annee`;
    setDrillLevels([`${dateColumn}.Trimestre`, `${dateColumn}.Mois`, dateColumn]);
    updateSuggestDateHierarchyVisibility();
  });

  // `submit` NE SE DÉCLENCHE JAMAIS dans le cadre isolé de GFS (`sandbox="allow-scripts"`, sans
  // `allow-forms`) : le navigateur bloque l'envoi AVANT de lever l'événement, sans exception ni message
  // visible (« Blocked form submission… » dans la console seulement) — « + Ajouter la tuile », « + Filtre »
  // et l'ajout d'un commentaire ne faisaient donc RIEN dans GFS (bug trouvé en jouant le formulaire dans un
  // <iframe sandbox="allow-scripts">, audit UI/UX du 18/11/2026). On écoute à la place le clic sur le bouton
  // d'envoi et la touche Entrée dans un champ (comme l'envoi implicite d'un formulaire : sauf si le
  // composant — combobox — a déjà pris l'Entrée), et on neutralise l'envoi natif.
  function bindFormSubmit(form, handler) {
    form.addEventListener('submit', (evt) => evt.preventDefault());
    form.querySelectorAll('[type="submit"]').forEach((btn) => {
      btn.type = 'button';
      btn.addEventListener('click', () => handler());
    });
    form.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || evt.defaultPrevented || evt.isComposing) return;
      const target = evt.target;
      if (!target || target.tagName !== 'INPUT' || ['checkbox', 'radio', 'button', 'submit'].includes(target.type)) return;
      evt.preventDefault();
      handler();
    });
  }

  // Lit le formulaire sans rien écrire : `{ tileData, errors }`. `errors` liste les champs fautifs
  // (`field` = id de l'élément, `key`/`vars` = message i18n) — affichés EN LIGNE sous le champ par
  // showFormErrors, à la place des retours silencieux et des fenêtres de message d'avant (audit
  // UI/UX du 18/11/2026 : « Ajouter » ne faisait rien, sans un mot, quand la mesure était vide).
  // `tileData` vaut `null` tant qu'il y a une erreur. Sert aussi à l'aperçu en direct, qui ne montre
  // rien tant que le formulaire n'est pas valide.
  function readTileForm() {
    const errors = [];
    const fail = (field, key, vars) => { errors.push({ field, key, vars }); };
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    const isBar = type === 'bar';
    const measureMode = (isBar && measureModeSelect.value && measureModeSelect.value !== 'brut') ? measureModeSelect.value : undefined;
    const dateColumn = measureMode ? dateColumnSelect.value : '';
    const isPivot = type === 'pivot';
    const isHeatmap = type === 'heatmap';
    const isSankey = type === 'sankey';
    const isSunburst = type === 'sunburst';
    const isGrid = isPivot || isHeatmap || isSankey; // deux dimensions (lignes + colonnes, ou source + cible), obligatoires et différentes
    const isRadarColumns = isRadarColumnsMode();
    const isWordCloudSplit = isWordCloudSplitMode();
    const isText = type === 'text';
    const isTable = type === 'table';
    const isProgress = type === 'progress';
    const isCombo = type === 'combo';
    const comboPareto = isCombo && comboModeSelect.value === 'pareto';
    const isHistogram = type === 'histogram';
    const isBox = type === 'box';
    const isGantt = type === 'gantt';
    const binsRaw = isHistogram ? binsInput.value.trim() : '';
    const binsValue = binsRaw === '' ? undefined : Number(binsRaw);
    const tableColumns = isTable ? readColumnsPicker() : [];
    // Objectif (carte KPI : facultatif ; Progression : obligatoire, valeur OU colonne) et seuils de couleur.
    const usesTarget = isKpi || isProgress;
    const targetRaw = usesTarget ? targetInput.value.trim() : '';
    const target = targetRaw === '' ? undefined : Number(targetRaw);
    const targetColumn = usesTarget ? targetColumnSelect.value : '';
    const goodPct = Number(goodPctInput.value);
    const warnPct = Number(warnPctInput.value);
    const textValue = isText ? tileTextInput.value.slice(0, GristBI.data.TEXT_TILE_MAX) : '';
    const hasDimension = !formHasNoDimension();
    const dimension = dimensionSelect.value;
    const columnDimension = columnDimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    // Radar "compétences en colonnes" et nuage de mots "découpage de cellule" : aucune mesure à
    // valider (voir isRadarColumnsMode/isWordCloudSplitMode) — ses propres axes (radarAxes
    // ci-dessous) ou le simple compte d'occurrences (js/data.js:wordFrequency) en tiennent lieu. La
    // dimension, elle, reste requise dans les deux cas sauf radar "colonnes" (seul mode sans aucune
    // dimension unique, voir formHasNoDimension).
    if (isText && !textValue.trim()) fail('tile-text', 'tileForm.error.textRequired');
    if (isTable && !tableColumns.length) fail('tile-columns', 'tileForm.error.columnsRequired');
    if (usesTarget && target !== undefined && !(Number.isFinite(target) && target > 0)) fail('tile-target', 'tileForm.error.targetPositive');
    else if (isProgress && target === undefined && !targetColumn) fail('tile-target', 'tileForm.error.targetRequired');
    if (usesTarget && (target !== undefined || targetColumn) && !(Number.isFinite(goodPct) && Number.isFinite(warnPct) && warnPct >= 0 && goodPct > warnPct)) fail('tile-good-pct', 'tileForm.error.thresholds');
    if (!isRadarColumns && !isWordCloudSplit && !isText && !isTable && !isGantt && !measure) fail('tile-measure', 'tileForm.error.measureRequired');
    if (hasDimension && !dimension) fail('tile-dimension', 'tileForm.error.dimensionRequired');
    // Calendrier : une case = un jour, la colonne doit contenir de vraies dates (format ISO, comme toutes les colonnes Date).
    else if (type === 'calendar' && dimension && inferColumnKind(dimension) !== 'date') fail('tile-dimension', 'tileForm.error.calendarNotDate');
    // Gantt : début et fin sont deux colonnes de vraies dates (format ISO) ; une barre va de l'une à l'autre.
    if (isGantt) {
      if (!startColumnSelect.value) fail('tile-start-column', 'tileForm.error.ganttStartRequired');
      else if (inferColumnKind(startColumnSelect.value) !== 'date') fail('tile-start-column', 'tileForm.error.calendarNotDate');
      if (!endColumnSelect.value) fail('tile-end-column', 'tileForm.error.ganttEndRequired');
      else if (inferColumnKind(endColumnSelect.value) !== 'date') fail('tile-end-column', 'tileForm.error.calendarNotDate');
    }
    if (isScatter && !measureYSelect.value) fail('tile-measure-y', 'tileForm.error.measureYRequired'); // 2e mesure obligatoire pour un nuage de points
    if (isHistogram && binsValue !== undefined && !(Number.isInteger(binsValue) && binsValue >= 2 && binsValue <= GristBI.data.HISTOGRAM_MAX_BINS)) fail('tile-bins', 'tileForm.error.binsRange');
    // Ligne de repère : une valeur fixe demande un nombre.
    const stackPctForm = !!seriesSelect.value && stackedCheckbox.checked && stackPercentCheckbox.checked && ((isBar && !measureMode) || (type === 'line' && areaCheckbox.checked));
    // Petits multiples : jamais d'empilé, de barres horizontales, de ligne de repère ni d'étiquettes (les champs sont masqués, leur valeur écartée).
    const smallOnForm = !!seriesSelect.value && smallMultiplesCheckbox.checked && ((isBar && !measureMode) || type === 'line');
    const refKind = (GristBI.data.supportsRefLine({ type, measureMode }) && !stackPctForm && !smallOnForm) ? refLineSelect.value : '';
    const refRaw = refKind === 'value' ? refValueInput.value.trim() : '';
    const refValue = refRaw === '' ? undefined : Number(refRaw);
    if (refKind === 'value' && !(refValue !== undefined && Number.isFinite(refValue))) fail('tile-refvalue', 'tileForm.error.refValueRequired');
    if (isCombo && !comboPareto && !measureYSelect.value) fail('tile-measure-y', 'tileForm.error.comboMeasureRequired'); // la courbe d'un combo a sa propre mesure
    if (measureMode && !dateColumn) fail('tile-date-column', 'tileForm.alert.dateColumnRequired');
    if (isGrid && !columnDimension) fail('tile-column-dimension', isSankey ? 'tileForm.error.sankeyTargetRequired' : 'tileForm.error.columnDimensionRequired'); // 2e dimension obligatoire pour un tableau croisé / une carte de chaleur / un flux
    else if (isGrid && columnDimension === dimension) fail('tile-column-dimension', isSankey ? 'tileForm.alert.sankeyDimsDiffer' : 'tileForm.alert.pivotDimsDiffer');
    // Séries multiples : seulement pour les barres (hors mode mesure) et la courbe/aire ; jamais la
    // dimension elle-même (chaque catégorie n'aurait qu'une série).
    const seriesColumn = ((isBar && !measureMode) || type === 'line' || isScatter || isGantt) ? seriesSelect.value : '';
    if (seriesColumn && seriesColumn === dimension) fail('tile-series', 'tileForm.error.seriesSameAsDimension');
    const radarAxes = isRadarColumns ? radarAxisSelects.map((s) => s.value).filter(Boolean) : [];
    if (isRadarColumns && !radarAxes.length) fail('tile-radar-axis-1', 'tileForm.error.radarAxisRequired'); // au moins un axe requis
    else if (isRadarColumns && new Set(radarAxes).size !== radarAxes.length) fail('tile-radar-axis-1', 'tileForm.alert.radarAxesDuplicate');
    let gaugeMin, gaugeMax;
    if (isGauge) {
      gaugeMin = parseFloat(gaugeMinInput.value);
      gaugeMax = parseFloat(gaugeMaxInput.value);
      if (!Number.isFinite(gaugeMin) || !Number.isFinite(gaugeMax) || gaugeMax <= gaugeMin) fail('tile-gauge-max', 'tileForm.alert.gaugeMinMax');
    }
    const drillDimensions = (supportsLevels(type) && !isWordCloudSplit) ? drillLevelSelects.map((s) => s.value).filter(Boolean) : [];
    // Soleil : l'angle d'une part est une quantité qui s'additionne ; une moyenne, un minimum ou un maximum n'aurait pas pour valeur la somme de ses sous-parts.
    if (isSunburst && aggFn !== 'sum' && aggFn !== 'count') fail('tile-agg', 'tileForm.error.sunburstAdditive');
    if (isSunburst && drillDimensions.length > GristBI.data.SUNBURST_MAX_LEVELS - 1) fail('tile-drill-dimension-1', 'tileForm.error.sunburstTooManyRings');
    // Garde-fou : une même colonne ne peut pas apparaître deux fois dans le chemin de drill (ni
    // reprendre la dimension racine) — un cas non gardé auparavant, repéré en généralisant à N
    // niveaux (voir ROADMAP.md, cluster "Hiérarchies & drill-down").
    const allDims = hasDimension ? [dimension].concat(drillDimensions) : [];
    if (new Set(allDims).size !== allDims.length) fail('tile-drill-dimension-1', 'tileForm.alert.drillDuplicate');
    if (errors.length) return { tileData: null, errors };
    // Titre : celui que la personne a saisi (alors figé, sans clé de traduction), sinon auto-composé,
    // stocké EN CLAIR (`title`, repli et exports) ET avec sa clé de traduction (`titleKey`/`titleVars`,
    // voir i18n.js:tileTitle) pour que l'en-tête de tuile suive la langue de l'interface au lieu de
    // rester figé dans celle de sa création.
    const auto = autoTileTitle({
      isText, isTable, isProgress, isCombo, comboPareto, isHistogram, isBox, isSankey, isSunburst, drillDimensions, isGantt, isCalendar: type === 'calendar', isBubble: isScatter && !!measureSizeSelect.value, measureSize: measureSizeSelect.value, measureY: measureYSelect.value, tableColumns, isPivot, isHeatmap, isRadarColumns, isWordCloudSplit, hasDimension, measureMode,
      measure, dimension, columnDimension, aggFn, radarAxes, seriesColumn
    });
    const customTitle = tileTitleInput.value.trim();
    const title = customTitle || auto.title;
    const titleKey = customTitle ? undefined : auto.titleKey;
    const titleVars = customTitle ? undefined : auto.titleVars;
    const tileData = { type, dimension, measure, aggFn, title, titleKey, titleVars };
    // Tuile Texte : aucune donnée. Les champs de données sont effacés (`undefined`) plutôt que laissés à la
    // valeur fantôme du formulaire, et `text` n'existe que sur ce type.
    if (isText || isTable) { tileData.dimension = undefined; tileData.measure = undefined; tileData.aggFn = undefined; }
    // Histogramme : la colonne est `measure` ; ni dimension ni agrégat (on compte des lignes).
    if (isHistogram) { tileData.dimension = undefined; tileData.aggFn = undefined; }
    // Boîte à moustaches : dimension = les groupes, mesure = la colonne numérique ; pas d'agrégat (valeurs brutes).
    if (isBox) tileData.aggFn = undefined;
    // Gantt : dimension = le libellé de la tâche ; ni mesure ni agrégat (une barre n'est pas un total), début et fin = deux colonnes de dates.
    if (isGantt) { tileData.measure = undefined; tileData.aggFn = undefined; }
    tileData.startColumn = isGantt ? startColumnSelect.value : undefined;
    tileData.endColumn = isGantt ? endColumnSelect.value : undefined;
    tileData.bins = isHistogram ? binsValue : undefined;
    tileData.text = isText ? textValue : undefined;
    tileData.columns = isTable ? tableColumns : undefined;
    // Nuage de mots "découpage de cellule" : mesure/agrégat ignorés par le rendu (voir
    // js/charts.js), effacés ici plutôt que laissés à une valeur fantôme du formulaire — même
    // principe que les champs spécifiques à un type plus bas.
    if (isWordCloudSplit) { tileData.measure = undefined; tileData.aggFn = undefined; }
    tileData.wordCloudSplit = (type === 'wordcloud') ? wordCloudSplitCheckbox.checked : undefined;
    // Champs spécifiques à un type explicitement mis à `undefined` quand non pertinents (plutôt que
    // simplement omis) : `store.updateTile` fusionne le patch via Object.assign, qui ne fait QUE
    // écraser les clés présentes dans l'objet — omettre une clé laisserait une ancienne valeur
    // fantôme sur la tuile éditée (ex. un drill-down retiré via le formulaire resterait actif en
    // pratique) ; l'inclure avec `undefined` l'efface bien.
    tileData.drillDimensions = drillDimensions.length ? drillDimensions : undefined;
    tileData.drillCrossFilter = drillDimensions.length ? drillCrossFilterCheckbox.checked : undefined;
    tileData.trendDimension = (isKpi && trendDimensionSelect.value) ? trendDimensionSelect.value : undefined;
    tileData.kpiSparkline = (isKpi && trendDimensionSelect.value && sparklineCheckbox.checked) ? true : undefined;
    // Objectif : `undefined` hors des deux types concernés (effacer plutôt que laisser une valeur fantôme, voir plus haut).
    // Les seuils ne sont écrits que s'ils diffèrent des valeurs par défaut (90 % / 60 %) : une tuile qui n'y a pas touché
    // garde une configuration sans eux.
    const hasTarget = usesTarget && (target !== undefined || Boolean(targetColumn));
    tileData.target = usesTarget && target !== undefined ? target : undefined;
    tileData.targetColumn = usesTarget && targetColumn ? targetColumn : undefined;
    tileData.goodPct = hasTarget && goodPct !== GristBI.data.DEFAULT_GOOD_PCT ? goodPct : undefined;
    tileData.warnPct = hasTarget && warnPct !== GristBI.data.DEFAULT_WARN_PCT ? warnPct : undefined;
    tileData.measureY = (isScatter || (isCombo && !comboPareto)) ? measureYSelect.value : undefined;
    // Combo : l'agrégat de la courbe n'est écrit que s'il diffère de celui des barres (sinon `aggFn` fait foi).
    tileData.aggFnY = (isCombo && !comboPareto && aggYSelect.value !== aggFn) ? aggYSelect.value : undefined;
    // Bulles : taille facultative ; son agrégat n'est écrit que s'il diffère de celui des deux axes.
    tileData.measureSize = (isScatter && measureSizeSelect.value) ? measureSizeSelect.value : undefined;
    tileData.aggFnSize = (isScatter && measureSizeSelect.value && aggSizeSelect.value !== aggFn) ? aggSizeSelect.value : undefined;
    tileData.comboMode = comboPareto ? 'pareto' : undefined;
    tileData.gaugeMin = isGauge ? gaugeMin : undefined;
    tileData.gaugeMax = isGauge ? gaugeMax : undefined;
    tileData.measureMode = measureMode;
    tileData.dateColumn = measureMode ? dateColumn : undefined;
    tileData.columnDimension = isGrid ? columnDimension : undefined;
    tileData.pivotHeat = (isPivot && pivotHeatCheckbox.checked) ? true : undefined;
    tileData.refLine = refKind || undefined;
    tileData.refValue = refKind === 'value' ? refValue : undefined;
    tileData.seriesColumn = seriesColumn || undefined;
    tileData.radarAxisMode = (type === 'radar') ? (isRadarColumns ? 'columns' : 'dimension') : undefined;
    tileData.radarAxes = isRadarColumns ? radarAxes : undefined;
    // Comparaison élève/moyenne du groupe filtré (voir ROADMAP.md) : valable dans les deux modes
    // d'axes, donc indépendante d'isRadarColumns. radarEntityValue n'a de sens que si une colonne de
    // comparaison est aussi choisie (sinon ce serait une valeur orpheline, comparée à rien).
    const radarEntityColumn = (type === 'radar') ? radarEntityColumnSelect.value : '';
    tileData.radarEntityColumn = radarEntityColumn ? radarEntityColumn : undefined;
    tileData.radarEntityValue = (radarEntityColumn && radarEntityValueSelect.value) ? radarEntityValueSelect.value : undefined;
    tileData.radarCompareAverage = (type === 'radar') ? radarCompareAverageCheckbox.checked : undefined;
    // Options d'affichage (tri, barres horizontales, aire, anneau, pourcentages) : `undefined` quand
    // décochées ou non pertinentes pour ce type, pour la même raison que les champs ci-dessus
    // (Object.assign de `store.updateTile` n'efface que les clés présentes). Jamais `false` : un
    // booléen décoché n'a pas à alourdir la config sauvegardée.
    tileData.sortMode = (GristBI.data.isSortableTile({ type, measureMode, comboMode: comboPareto ? 'pareto' : undefined }) && sortSelect.value) ? sortSelect.value : undefined;
    tileData.horizontal = (isBar && !measureMode && horizontalCheckbox.checked && !smallOnForm) ? true : undefined;
    tileData.areaFill = (type === 'line' && areaCheckbox.checked) ? true : undefined;
    // `standard` n'est jamais écrit : une tuile sans choix de palette garde exactement sa configuration d'avant.
    tileData.palette = (GristBI.data.supportsPalette({ type, pivotHeat: isPivot && pivotHeatCheckbox.checked }) && paletteSelect.value !== 'standard' && GristBI.data.PALETTE_KEYS.includes(paletteSelect.value)) ? paletteSelect.value : undefined;
    // Format des nombres : `undefined` = Automatique (jamais écrit), comme `palette` ci-dessus.
    tileData.numberFormat = GristBI.data.supportsNumberFormat({ type }) ? numberFormatFromForm() : undefined;
    tileData.stacked = (seriesColumn && !smallOnForm && stackedCheckbox.checked && ((isBar && !measureMode) || (type === 'line' && areaCheckbox.checked))) ? true : undefined;
    tileData.smallMultiples = smallOnForm ? true : undefined;
    tileData.stackPercent = (tileData.stacked && stackPercentCheckbox.checked) ? true : undefined;
    tileData.lineShape = (type === 'line' && GristBI.data.LINE_SHAPES.includes(lineShapeSelect.value)) ? lineShapeSelect.value : undefined;
    tileData.valueLabels = (GristBI.data.supportsValueLabels({ type, measureMode }) && valueLabelsCheckbox.checked && !smallOnForm) ? true : undefined;
    tileData.donut = (type === 'pie' && donutCheckbox.checked) ? true : undefined;
    tileData.showPct = (type === 'pie' && showPctCheckbox.checked) ? true : undefined;
    return { tileData, errors: [], autoTitle: auto.title };
  }

  // --- Erreurs de saisie en ligne -------------------------------------------------------------
  // Un message sous chaque champ fautif (`role="alert"`, relié par `aria-describedby`), jamais une
  // fenêtre ni un retour silencieux. Affichées seulement après une 1re tentative d'envoi
  // (`submitAttempted`) : pas de rouge sur un formulaire que la personne n'a pas fini de remplir.
  let submitAttempted = false;
  function clearFormErrors() {
    addTileForm.querySelectorAll('.field-error').forEach((n) => n.remove());
    addTileForm.querySelectorAll('[aria-invalid]').forEach((n) => { n.removeAttribute('aria-invalid'); n.removeAttribute('aria-describedby'); });
  }
  function showFormErrors(errors, focusFirst) {
    clearFormErrors();
    let first = null;
    errors.forEach((err) => {
      const input = document.getElementById(err.field);
      const wrap = input && input.closest('.field');
      if (!input || !wrap) return;
      const msg = document.createElement('p');
      msg.className = 'field-error';
      msg.id = `${err.field}-error`;
      msg.setAttribute('role', 'alert');
      msg.textContent = t(err.key, err.vars);
      wrap.appendChild(msg);
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', msg.id);
      if (!first) first = input;
    });
    if (first && focusFirst) {
      const details = first.closest('details');
      if (details) details.open = true; // un champ fautif ne reste jamais caché dans « Options avancées »
      first.focus();
      // Un combobox ouvre sa liste au focus : elle recouvrirait le message d'erreur et les champs
      // suivants. On la referme tout de suite (Échap, sans effet sur la valeur : elle est valide).
      if (first.classList.contains('combobox-input')) first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
  }

  function submitTileForm() {
    submitAttempted = true;
    const { tileData, errors } = readTileForm();
    if (errors.length) { showFormErrors(errors, true); return; }
    clearFormErrors();
    let savedId;
    if (editingTileId) {
      savedId = editingTileId;
      store.updateTile(editingTileId, tileData);
      stopEditTile();
    } else {
      tileData.id = genTileId();
      savedId = tileData.id;
      store.addTile(tileData);
    }
    closeTilePanel(true);
    flashTile(savedId);
  }
  bindFormSubmit(addTileForm, submitTileForm);

  cancelEditBtn.addEventListener('click', () => closeTilePanel(true));

  // =============================================================================================
  // Panneau latéral « Ajouter / Modifier une visualisation » (audit UI/UX du 18/11/2026, lot 2)
  // ---------------------------------------------------------------------------------------------
  // Deux étapes dans un même panneau : « Choisir » (une carte par type, avec la ligne de
  // js/advice.js:adviceForType) puis « Régler » (le formulaire d'avant, mêmes ids, options avancées
  // repliées, aperçu en direct, conseil en direct). Le panneau est en flux normal (voir css/style.css) :
  // il ne recouvre jamais la barre. Toute la lecture du formulaire passe par readTileForm() ci-dessus.
  // =============================================================================================
  const TYPE_CARDS = ['bar', 'histogram', 'box', 'line', 'combo', 'pie', 'treemap', 'sunburst', 'funnel', 'sankey', 'calendar', 'gantt', 'scatter', 'waterfall', 'radar', 'wordcloud', 'kpi', 'gauge', 'progress', 'pivot', 'heatmap', 'table', 'text'];
  const PREVIEW_TILE_ID = '__preview__';
  // Types de tuile portés par une extension de GFS (js/extensions.js:EXTENSIONS).
  const TYPE_EXTENSION = { wordcloud: 'nuage-de-mots' };
  let panelOpener = null;
  let previewTimer = null;

  function updatePanelTexts() {
    const editing = Boolean(editingTileId);
    tilePanelTitle.textContent = t(editing ? 'tilePanel.title.edit' : 'tilePanel.title.add');
    submitTileBtn.textContent = t(editing ? 'tileForm.submit.edit' : 'tileForm.submit.add');
    const type = tileTypeSelect.value;
    typeLineNameEl.innerHTML = `${icon('type-' + type)}<span>${escapeHtml(t('tileForm.type.' + type))}</span>`;
  }

  // Une carte par type. La ligne sous le nom vient de js/advice.js (avertissement propre à CES
  // données, sinon « quand l'utiliser ») ; sans lui, la carte n'a que son nom — jamais de texte en dur.
  function renderTypeCards() {
    const rows = store.getState().rows;
    const columns = availableColumns(rows);
    typeGridEl.innerHTML = '';
    // Un type qui dépend d'une extension de GFS reste proposé, GRISÉ avec « pas encore » comme raison (consigne 019, point 4) ;
    // son clic ne choisit pas le type : voir `requestExtension`.
    TYPE_CARDS.forEach((type) => {
      const extensionId = TYPE_EXTENSION[type];
      const locked = Boolean(extensionId) && GristBI.extensions.stateOf(extensionId) !== 'active';
      const advice = GristBI.advice ? GristBI.advice.adviceForType(type, rows, columns) : null;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'type-card';
      card.dataset.type = type;
      const adviceText = locked
        ? t(GristBI.extensions.stateOf(extensionId) === 'inactive' ? 'ext.pending.hosted' : 'ext.pending.standalone', { extension: t('ext.name.' + extensionId) })
        : (advice ? t(advice.key, advice.vars) : '');
      card.innerHTML = `${icon('type-' + type)}<span class="type-card-name">${escapeHtml(t('tileForm.type.' + type))}</span>`
        + `<span class="type-card-advice" data-level="${locked ? 'locked' : (advice ? advice.level : '')}">${escapeHtml(adviceText)}</span>`;
      if (locked) { card.classList.add('type-card-locked'); card.setAttribute('aria-disabled', 'true'); }
      card.addEventListener('click', () => chooseType(type));
      typeGridEl.appendChild(card);
    });
  }

  // Remet le formulaire à blanc (les valeurs du dernier ajout ne doivent pas fuiter dans le suivant).
  function resetTileForm() {
    dimensionSelect.value = '';
    measureSelect.value = '';
    aggSelect.value = 'sum';
    measureYSelect.value = '';
    aggYSelect.value = 'sum';
    measureSizeSelect.value = '';
    aggSizeSelect.value = 'sum';
    comboModeSelect.value = 'measure';
    binsInput.value = '';
    columnDimensionSelect.value = '';
    startColumnSelect.value = '';
    endColumnSelect.value = '';
    seriesSelect.value = '';
    resetDrillLevels();
    drillCrossFilterCheckbox.checked = false;
    measureModeSelect.value = 'brut';
    dateColumnSelect.value = '';
    trendDimensionSelect.value = '';
    targetInput.value = '';
    targetColumnSelect.value = '';
    goodPctInput.value = GristBI.data.DEFAULT_GOOD_PCT;
    warnPctInput.value = GristBI.data.DEFAULT_WARN_PCT;
    sparklineCheckbox.checked = false;
    radarModeSelect.value = 'dimension';
    resetRadarAxes();
    radarEntityColumnSelect.value = '';
    radarEntityValueSelect.value = '';
    radarCompareAverageCheckbox.checked = false;
    wordCloudSplitCheckbox.checked = false;
    sortSelect.value = '';
    horizontalCheckbox.checked = false;
    areaCheckbox.checked = false;
    stackedCheckbox.checked = false;
    stackPercentCheckbox.checked = false;
    smallMultiplesCheckbox.checked = false;
    lineShapeSelect.value = '';
    valueLabelsCheckbox.checked = false;
    paletteSelect.value = 'standard';
    pivotHeatCheckbox.checked = false;
    refLineSelect.value = '';
    refValueInput.value = '';
    setNumberFormatForm(null);
    donutCheckbox.checked = false;
    showPctCheckbox.checked = false;
    gaugeMinInput.value = 0;
    gaugeMaxInput.value = 100;
    tileTitleInput.value = '';
    tileTextInput.value = '';
    setColumnsPicker([]);
    advancedDetailsEl.open = false;
  }

  // Préremplit le formulaire avec les valeurs que js/advice.js propose pour ce type et CES données
  // (vraie catégorie en dimension, vraie colonne numérique en mesure — jamais « Région / Région »).
  // Même ordre que startEditTile : ce qui commande la visibilité des champs d'abord, puis
  // updateFormFieldsForType(), puis mesure/agrégat/tendance.
  function applyTypeDefaults(type) {
    resetTileForm();
    tileTypeSelect.value = type;
    const rows = store.getState().rows;
    const d = GristBI.advice ? GristBI.advice.defaultsForType(type, rows, availableColumns(rows)) : null;
    if (d) {
      if (d.dimension) dimensionSelect.value = d.dimension;
      columnDimensionSelect.value = d.columnDimension || '';
      startColumnSelect.value = d.startColumn || '';
      endColumnSelect.value = d.endColumn || '';
      seriesSelect.value = d.seriesColumn || '';
      measureYSelect.value = d.measureY || '';
      comboModeSelect.value = d.comboMode === 'pareto' ? 'pareto' : 'measure';
      if (d.drillDimensions) setDrillLevels(d.drillDimensions);
      if (Number.isFinite(d.gaugeMin)) gaugeMinInput.value = d.gaugeMin;
      if (Number.isFinite(d.gaugeMax)) gaugeMaxInput.value = d.gaugeMax;
      radarModeSelect.value = d.radarAxisMode === 'columns' ? 'columns' : 'dimension';
      if (d.radarAxisMode === 'columns') setRadarAxes(d.radarAxes);
      wordCloudSplitCheckbox.checked = !!d.wordCloudSplit;
      sortSelect.value = d.sortMode || '';
      horizontalCheckbox.checked = !!d.horizontal;
      areaCheckbox.checked = !!d.areaFill;
      stackedCheckbox.checked = !!d.stacked;
      donutCheckbox.checked = !!d.donut;
      showPctCheckbox.checked = !!d.showPct;
      if (d.columns) setColumnsPicker(d.columns);
    }
    updateFormFieldsForType();
    if (d) {
      measureSelect.value = d.measure || '';
      aggSelect.value = d.aggFn || 'sum';
      aggYSelect.value = d.aggFnY || d.aggFn || 'sum';
      aggSizeSelect.value = d.aggFn || 'sum';
      trendDimensionSelect.value = d.trendDimension || '';
    }
  }

  // Un clic sur une fonction grisée (consigne 019, point 4) : dans GFS, sa fenêtre « Apps et extensions » s'ouvre sur la ligne de
  // l'extension ; l'app seule montre la fenêtre du grisé du guide (section 5). Rien n'est jamais ajouté sans le geste de la personne.
  async function requestExtension(extensionId, type) {
    const state = await GristBI.extensions.requestInstall(extensionId);
    if (state !== 'standalone') return;
    await GristBI.dialogs.notice({
      title: t('ext.standalone.title'),
      message: t('ext.standalone.body', { feature: t('tileForm.type.' + type), extension: t('ext.name.' + extensionId) })
    });
  }

  function chooseType(type) {
    const extensionId = TYPE_EXTENSION[type];
    if (extensionId && GristBI.extensions.stateOf(extensionId) !== 'active') { requestExtension(extensionId, type); return; }
    applyTypeDefaults(type);
    submitAttempted = false;
    clearFormErrors();
    setPanelStep('configure');
  }

  function setPanelStep(step) {
    chooseStepEl.hidden = step !== 'choose';
    configureStepEl.hidden = step !== 'configure';
    if (step === 'choose') {
      disposePreview();
      const first = typeGridEl.querySelector('.type-card');
      (first || tilePanelCloseBtn).focus();
    } else {
      updatePanelTexts();
      renderPreview();
      // Le focus va à l'étape elle-même, jamais dans un champ : un combobox ouvre sa liste au focus (voir
      // js/appbar.js) et la liste d'une dimension recouvrirait le reste du formulaire dès l'ouverture.
      // Tab mène au 1er champ.
      configureStepEl.focus({ preventScroll: true });
    }
  }

  function updateAdvancedVisibility() {
    advancedDetailsEl.hidden = !Array.from(advancedDetailsEl.querySelectorAll('.field')).some((f) => !f.hidden);
  }

  function openTilePanel(opts) {
    opts = opts || {};
    if (mode !== 'edit') setMode('edit'); // l'API publique peut être appelée depuis le mode Lecture
    const opener = document.activeElement;
    panelOpener = (opener && opener !== document.body && opener.id !== 'tile-panel-close') ? opener : addTileOpenBtn;
    const wasOpen = !tilePanel.hidden;
    if (!opts.editing) { stopEditTile(); resetTileForm(); }
    tilePanel.hidden = false;
    workspaceEl.classList.add('panel-open');
    addTileOpenBtn.setAttribute('aria-expanded', 'true');
    submitAttempted = false;
    clearFormErrors();
    renderTypeCards();
    updatePanelTexts();
    if (opts.type && !opts.editing) chooseType(opts.type);
    else setPanelStep(opts.step || 'choose');
    requestAnimationFrame(() => {
      GristBI.charts.resizeAll();
      if (!wasOpen) tilePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function closeTilePanel(returnFocus) {
    if (tilePanel.hidden) { if (editingTileId) stopEditTile(); return; }
    if (editingTileId) stopEditTile();
    tilePanel.hidden = true;
    workspaceEl.classList.remove('panel-open');
    addTileOpenBtn.setAttribute('aria-expanded', 'false');
    clearTimeout(previewTimer);
    disposePreview();
    clearFormErrors();
    submitAttempted = false;
    requestAnimationFrame(() => GristBI.charts.resizeAll());
    if (returnFocus) {
      const target = (panelOpener && document.body.contains(panelOpener) && panelOpener.getClientRects().length) ? panelOpener : addTileOpenBtn;
      target.focus();
    }
  }
  GristBI.openTilePanel = openTilePanel;
  GristBI.closeTilePanel = closeTilePanel;

  // --- Aperçu et conseil en direct ---------------------------------------------------------------
  function disposePreview() {
    GristBI.charts.disposeTile(PREVIEW_TILE_ID);
    tilePreviewEl.innerHTML = '';
  }
  function schedulePreview() {
    if (tilePanel.hidden || configureStepEl.hidden) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 200);
  }
  function renderPreview() {
    if (tilePanel.hidden || configureStepEl.hidden) return;
    const { tileData, errors, autoTitle } = readTileForm();
    tileTitleInput.placeholder = autoTitle || t('tilePanel.titleField.placeholder');
    refreshTileAdvice(tileData);
    disposePreview();
    tilePreviewEmptyEl.hidden = !errors.length;
    if (errors.length) return;
    const previewTile = Object.assign({}, tileData, { id: PREVIEW_TILE_ID });
    tilePreviewEl.appendChild(buildTileElement(previewTile, { preview: true }));
    GristBI.charts.renderTile(previewTile, store.getState(), tilePreviewEl);
  }
  // Un seul conseil à la fois (voir js/advice.js:adviceForTile), recalculé sur toutes les lignes.
  function refreshTileAdvice(tileData) {
    const advice = (GristBI.advice && tileData) ? GristBI.advice.adviceForTile(tileData, store.getState().rows) : null;
    tileAdviceEl.hidden = !advice;
    if (advice) { tileAdviceEl.textContent = t(advice.key, advice.vars); tileAdviceEl.dataset.level = advice.level; }
    else tileAdviceEl.textContent = '';
  }
  // Après un changement de langue : les textes écrits par JS (titre, type, cartes, erreurs, aperçu).
  function refreshTilePanelTexts() {
    updatePanelTexts();
    if (tilePanel.hidden) return;
    renderTypeCards();
    if (!configureStepEl.hidden) {
      renderPreview();
      if (submitAttempted) showFormErrors(readTileForm().errors, false);
    }
  }

  // Un tuile qui vient d'être ajoutée ou modifiée clignote une fois : on voit où elle est tombée.
  function flashTile(id) {
    requestAnimationFrame(() => {
      const el = workspaceMainEl.querySelector(`.tile[data-tile-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.classList.add('tile-flash');
      setTimeout(() => el.classList.remove('tile-flash'), 1600);
    });
  }

  function onFormActivity(evt) {
    // Pendant la frappe dans un combobox, la valeur n'est pas encore choisie : on attend son `change`.
    if (evt.type === 'input' && evt.target.classList && evt.target.classList.contains('combobox-input')) return;
    updateNumberFormatUI();
    schedulePreview();
    if (submitAttempted) showFormErrors(readTileForm().errors, false);
  }
  addTileForm.addEventListener('input', onFormActivity);
  addTileForm.addEventListener('change', onFormActivity);
  addTileOpenBtn.addEventListener('click', () => {
    if (!tilePanel.hidden && !editingTileId) closeTilePanel(true);
    else openTilePanel();
  });
  welcomeAddBtn.addEventListener('click', () => openTilePanel());
  tilePanelCloseBtn.addEventListener('click', () => closeTilePanel(true));
  panelBackBtn.addEventListener('click', () => setPanelStep('choose'));
  // Échap ferme le panneau — sauf si la liste d'un combobox est ouverte : c'est elle qui le prend
  // d'abord (phase de capture, pour lire l'état AVANT que combobox.js ne la ferme ; même règle que
  // js/appbar.js).
  tilePanel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (tilePanel.querySelector('.combobox-list:not([hidden])')) return;
    e.preventDefault();
    closeTilePanel(true);
  }, true);

  // La barre collante change de hauteur (2 lignes en étroit, rangée de pastilles de filtre) : le
  // panneau collant et les ancres de défilement en ont besoin (`--chrome-h`, voir css/style.css).
  const chromeEl = document.getElementById('chrome');
  function syncChromeHeight() {
    document.documentElement.style.setProperty('--chrome-h', `${Math.round(chromeEl.getBoundingClientRect().height)}px`);
  }
  syncChromeHeight();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncChromeHeight).observe(chromeEl);

  // Appelées SANS argument (via une flèche plutôt qu'en passant la fonction directement en callback)
  // : un `addEventListener` passe l'Event en 1er argument, qui satisferait silencieusement le
  // paramètre optionnel `rows` de `updateAdvancedFilterFieldsForColumn` à sa place (`rows` vaudrait
  // l'Event, pas les lignes) — `distinctColumnValues` plante alors sur un Event non itérable [BUG
  // RÉEL trouvé en testant l'autocomplétion des valeurs, voir HYPOTHESES.md/TEST_PROTOCOL.md].
  filterDateModeSelect.addEventListener('change', () => updateAdvancedFilterFieldsForColumn());

  // Menu Filtre : clic sur une colonne, recherche de colonne, retour, valeurs cliquables.
  GristBI.appbar.onOpen('filter-popover', resetFilterPopover);
  filterColumnList.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-column-item');
    if (btn) selectFilterColumn(btn.dataset.column);
  });
  filterColumnSearch.addEventListener('input', refreshFilterColumnList);
  filterColumnSearch.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      const first = filterColumnList.querySelector('.filter-column-item');
      if (first) selectFilterColumn(first.dataset.column);
    } else listArrowNav(evt, filterColumnList, null);
  });
  filterColumnList.addEventListener('keydown', (evt) => listArrowNav(evt, filterColumnList, filterColumnSearch));
  filterBackBtn.addEventListener('click', () => { showFilterStep('columns'); filterColumnSearch.focus({ preventScroll: true }); });
  filterTextInput.addEventListener('input', () => { refreshFilterValues(); showFilterError(null); });
  filterTextInput.addEventListener('keydown', (evt) => {
    // Entrée dans le champ est gérée par bindFormSubmit ; ↓ descend dans les valeurs proposées.
    if (evt.key === 'ArrowDown') listArrowNav(evt, filterValueList, null);
  });
  filterValueList.addEventListener('keydown', (evt) => listArrowNav(evt, filterValueList, filterTextInput));
  // Une valeur cliquée pose le filtre tout de suite (« contient » cette valeur) : un clic, pas deux.
  filterValueList.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-value-item');
    if (!btn) return;
    filterTextInput.value = btn.dataset.value;
    submitAdvancedFilter();
  });
  [filterMinInput, filterMaxInput, filterDateStartInput, filterDateEndInput].forEach((el) => el.addEventListener('input', () => showFilterError(null)));

  function submitAdvancedFilter() {
    const column = filterColumnSelect.value;
    if (!column) return;
    const kind = inferColumnKind(column);
    let filter;
    if (kind === 'number') {
      const min = filterMinInput.value === '' ? null : parseFloat(filterMinInput.value);
      const max = filterMaxInput.value === '' ? null : parseFloat(filterMaxInput.value);
      if (min == null && max == null) { showFilterError('filters.minBoundRequired'); filterMinInput.focus(); return; }
      if (min != null && max != null && max < min) { showFilterError('filters.maxGteMin'); filterMaxInput.focus(); return; }
      filter = { type: 'range', min, max };
    } else if (kind === 'date') {
      if (filterDateModeSelect.value === 'relativeDate') {
        filter = { type: 'relativeDate', preset: filterRelativePresetSelect.value };
      } else {
        const start = filterDateStartInput.value || null;
        const end = filterDateEndInput.value || null;
        if (!start && !end) { showFilterError('filters.dateBoundRequired'); filterDateStartInput.focus(); return; }
        if (start && end && end < start) { showFilterError('filters.endAfterStart'); filterDateEndInput.focus(); return; }
        filter = { type: 'dateRange', start, end };
      }
    } else {
      const query = filterTextInput.value.trim();
      if (!query) { showFilterError('filters.textRequired'); filterTextInput.focus(); return; }
      filter = { type: 'contains', query };
    }
    store.setAdvancedFilter(column, filter);
    // Formulaire remis à zéro après ajout (contrairement au formulaire de tuile, qui reste
    // pré-rempli en mode édition) : un filtre avancé n'a pas de mode édition, juste
    // ajout/remplacement par colonne (voir setAdvancedFilter) et suppression via son badge.
    filterMinInput.value = '';
    filterMaxInput.value = '';
    filterDateStartInput.value = '';
    filterDateEndInput.value = '';
    filterTextInput.value = '';
    showFilterError(null);
    GristBI.appbar.closePopovers(); // le filtre est posé : sa pastille apparaît sous la barre
    resetFilterPopover(); // prêt pour le prochain filtre : 1er écran
  }
  bindFormSubmit(advancedFilterForm, submitAdvancedFilter);

  viewsListEl.addEventListener('click', async (e) => {
    const applyBtn = e.target.closest('.views-item-apply');
    const deleteBtn = e.target.closest('.views-item-delete');
    if (applyBtn) {
      store.applyBookmark(applyBtn.dataset.id);
      GristBI.appbar.closePopovers();
    } else if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const bm = store.getState().bookmarks.find((b) => b.id === id);
      if (!bm) return;
      const ok = await GristBI.dialogs.confirm({
        title: t('views.delete.dialogTitle'), message: t('views.delete.confirm', { name: bm.name }),
        confirmLabel: t('views.delete.confirmLabel'), danger: true
      });
      if (ok) store.removeBookmark(id);
    }
  });

  updateBookmarkBtn.addEventListener('click', () => {
    const id = store.getState().activeBookmarkId;
    if (id) store.updateBookmark(id);
  });
  viewChipUpdateBtn.addEventListener('click', () => {
    const id = store.getState().activeBookmarkId;
    if (id) store.updateBookmark(id);
  });
  viewChipLeaveBtn.addEventListener('click', () => store.leaveBookmark());

  saveBookmarkBtn.addEventListener('click', async () => {
    const answer = await GristBI.dialogs.prompt({
      title: t('bookmarks.save.title'), label: t('bookmarks.save.prompt'), confirmLabel: t('bookmarks.save.confirm')
    });
    const name = (answer || '').trim();
    if (!name) return; // annulé ou vide
    store.saveBookmark('bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name);
  });

  // Une feuille par tuile, toutes pages confondues (voir GristBI.data.buildWorkbookSheetsAsync) —
  // les données déjà agrégées/filtrées EXACTEMENT comme à l'écran (rowsForTile est la même fonction
  // que charts.js), y compris pour une tuile en mode mesure (Cumul/YTD/N-1), désormais calculée via
  // DuckDB-WASM plutôt que remplacée par un message (voir js/export.js). Jamais vérifié en
  // conditions réelles Grist que le téléchargement se déclenche bien depuis l'iframe du widget
  // (voir HYPOTHESES.md) — fonctionne dans ce harness et un navigateur standard, l'iframe n'étant
  // pas sandboxée (voir ROADMAP.md).
  exportExcelBtn.addEventListener('click', async () => {
    if (!EXPORTS_AVAILABLE) return;
    try {
      const exported = await GristBI.exportExcel.exportDashboardToExcel(store.getState());
      if (!exported) showNotice(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export Excel', e);
      showError(t('export.failed'));
    }
  });

  // Seulement la page actuellement affichée (voir js/pdf-export.js), pas toutes les pages comme
  // l'export Excel — chaque graphique capturé est celui déjà rendu de CETTE page. pdfmake est
  // chargé depuis un CDN externe (dérogation d'Antoine, voir CLAUDE.md) : un échec réseau doit être
  // clairement dit à l'utilisateur plutôt que de rester silencieux ou de casser la page.
  exportPdfBtn.addEventListener('click', async () => {
    if (!EXPORTS_AVAILABLE) return;
    try {
      const exported = await GristBI.exportPdf.exportDashboardToPdf(store.getState());
      if (!exported) showNotice(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export PDF', e);
      showError(t('export.pdf.networkError'));
    }
  });

  // Même raisonnement que l'export PDF ci-dessus, pour PptxGenJS (js/pptx-export.js).
  exportPptxBtn.addEventListener('click', async () => {
    if (!EXPORTS_AVAILABLE) return;
    try {
      const exported = await GristBI.exportPptx.exportDashboardToPptx(store.getState());
      if (!exported) showNotice(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export PPTX', e);
      showError(t('export.pptx.networkError'));
    }
  });

  addPageBtn.addEventListener('click', async () => {
    const answer = await GristBI.dialogs.prompt({
      title: t('pages.new.title'), label: t('pages.new.prompt'),
      value: `Page ${store.getState().pages.length + 1}`, confirmLabel: t('pages.new.confirm')
    });
    const name = (answer || '').trim();
    if (name) store.addPage(name);
  });

  // « Effacer les filtres » repart d'une page blanche : on quitte aussi la vue suivie (en premier,
  // pour qu'un rendu intermédiaire ne l'affiche pas « modifiée » une fraction de seconde).
  focusResetBtn.addEventListener('click', () => store.clearZoom());

  clearFilterBtn.addEventListener('click', () => { store.leaveBookmark(); store.clearFilter(); store.clearAdvancedFilter(); });
  modeToggleBtn.addEventListener('click', () => setMode(mode === 'edit' ? 'read' : 'edit'));

  // Même convention d'ouverture/fermeture que Publipostage+ (js/settings.js de ce widget frère) :
  // `hidden` natif, pas de fermeture au clic sur le fond — un clic accidentel sur l'overlay pendant
  // la lecture des Crédits ne doit pas fermer le panneau.
  if (settingsBtn && settingsModal && settingsCloseBtn) {
    settingsBtn.addEventListener('click', () => { settingsModal.hidden = false; });
    settingsCloseBtn.addEventListener('click', () => { settingsModal.hidden = true; });
  }

  // Panneau Commentaires : même convention hidden natif/pas de fermeture au clic sur le fond que
  // #settings-modal ci-dessus (voir openCommentsModal/closeCommentsModal plus haut pour l'ouverture,
  // déclenchée depuis le bouton de CHAQUE tuile, pas un bouton de bandeau unique).
  if (commentsCloseBtn) commentsCloseBtn.addEventListener('click', closeCommentsModal);
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetailModal);

  // Panneau Import Power BI : même convention hidden natif/pas de fermeture au clic sur le fond
  // que les autres modales ci-dessus. Réinitialisé à chaque ouverture (pas de résultat d'un import
  // précédent qui traîne si l'utilisateur change de fichier ou rouvre le panneau).
  // Mots-clés des publications (menu Données, consigne GFS 019) : tout le branchement vit dans js/keywords-panel.js,
  // qui ne reçoit d'ici que la table de travail courante et de quoi relire la table après une écriture (l'état de
  // l'extension `mots-cles-pdf` vient de GristBI.extensions, comme pour « Nuage de mots »).
  if (GristBI.keywordsPanel) {
    GristBI.keywordsPanel.init({
      getTableId: () => currentTableId,
      reloadTable: reloadWorkingTable
    });
  }

  if (openPbixImportBtn && pbixImportModal && pbixImportCloseBtn) {
    openPbixImportBtn.addEventListener('click', () => {
      pbixImportSuggestions = [];
      pbixImportResultsEl.innerHTML = '';
      pbixImportStatusEl.textContent = '';
      pbixImportCreateBtn.hidden = true;
      pbixImportFileInput.value = '';
      csvImportParsed = null;
      csvImportPendingTableName = null;
      csvImportStatusEl.textContent = '';
      csvImportPreviewEl.hidden = true;
      csvImportConfirmEl.hidden = true;
      csvImportFileInput.value = '';
      pbixImportModal.hidden = false;
    });
    pbixImportCloseBtn.addEventListener('click', () => { pbixImportModal.hidden = true; });
  }
  if (pbixImportFileInput) {
    pbixImportFileInput.addEventListener('change', () => handlePbixImportFile(pbixImportFileInput.files[0]));
  }
  if (pbixImportCreateBtn) pbixImportCreateBtn.addEventListener('click', handlePbixImportCreate);
  if (csvImportFileInput) {
    csvImportFileInput.addEventListener('change', () => handleCsvImportFile(csvImportFileInput.files[0]));
  }
  if (csvImportCreateBtn) csvImportCreateBtn.addEventListener('click', handleCsvImportCreateClick);
  if (csvImportConfirmYesBtn) csvImportConfirmYesBtn.addEventListener('click', handleCsvImportConfirmYes);
  if (csvImportConfirmNoBtn) csvImportConfirmNoBtn.addEventListener('click', handleCsvImportConfirmNo);

  // Ajout d'un commentaire : AddRecord côté Grist (js/grist-api.js:addComment), puis ajout
  // optimiste côté store (pas de re-fetch de toute la table) — la liste affichée se remet à jour
  // via renderCommentsModal(), appelée depuis render() (voir plus haut) puisque addCommentLocal
  // déclenche notify(). Le nom est mémorisé pour la prochaine fois, le texte est vidé mais le
  // panneau reste ouvert (plusieurs commentaires à la suite sans le rouvrir).
  if (commentForm) {
    async function submitComment() {
      if (!commentsModalTileId) return;
      const author = commentAuthorInput.value.trim();
      const text = commentTextInput.value.trim();
      if (!author || !text) return;
      // Pas la peine de mémoriser en localStorage un auteur qui n'a jamais été retapé à la main
      // (voir openCommentsModal) : ça resterait un nom figé par la détection automatique d'une
      // session passée, jamais relu tant que detectedUserEmail reste disponible de toute façon.
      if (!detectedUserEmail) saveCommentAuthor(author);
      try {
        const comment = await GristBI.api.addComment(currentTableId, commentsModalTileId, author, text);
        store.addCommentLocal(comment);
        commentTextInput.value = '';
        commentTextInput.focus();
      } catch (e) {
        console.error('[GristBI] échec de l\'ajout du commentaire', e);
        showError(t('comments.addFailed'));
      }
    }
    bindFormSubmit(commentForm, submitComment);
  }

  window.addEventListener('resize', () => GristBI.charts.resizeAll());

  // `window`.resize ne se déclenche pas forcément de façon fiable quand c'est le panneau Grist
  // hébergeant l'iframe du widget qui change de taille (ouverture d'un panneau latéral, colonne
  // redimensionnée...) plutôt que la fenêtre du navigateur elle-même. ResizeObserver observe
  // directement la boîte du conteneur, donc capte aussi ce cas.
  if (typeof ResizeObserver !== 'undefined') {
    let resizeRaf = null;
    const observer = new ResizeObserver(() => {
      // Coalesce : ResizeObserver peut déclencher plusieurs callbacks par frame pendant un
      // redimensionnement continu ; un seul resizeAll() par frame suffit.
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        GristBI.charts.resizeAll();
      });
    });
    observer.observe(document.body);
  }

  // `tableId` capturé À L'APPEL (pas relu dans le setTimeout) : sans ça, changer de table pendant
  // les 600ms de debounce fait s'exécuter la sauvegarde sous le tableId de la table SUIVANTE (bug
  // réel trouvé en testant le sélecteur de table — voir flushPendingSave()/HYPOTHESES.md). Même
  // raison pour `reportId`/`authorLabel` (consigne GFS 007) : capturés ici, jamais relus plus tard
  // dans le setTimeout.
  function scheduleSave(pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions) {
    if (!currentTableId) return;
    clearTimeout(saveTimer);
    pendingSave = { tableId: currentTableId, reportId: currentReportId, authorLabel: currentReportAuthorLabel(), pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions };
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const p = pendingSave;
      pendingSave = null;
      runPendingSave(p);
    }, 600);
  }

  // Partagé par scheduleSave/flushPendingSave : écrit `p` puis, si c'était la toute première
  // sauvegarde d'un rapport vierge ("Nouveau" dans GFS, voir openBlankReport plus bas), adopte
  // l'id réel que Grist vient d'assigner comme `currentReportId` — sinon les sauvegardes SUIVANTES
  // recréeraient chacune une nouvelle ligne au lieu de mettre à jour celle-ci (consigne GFS 007,
  // point 2/3). Cette promotion ne s'applique que si `currentReportId` porte ENCORE le jeton
  // `'new'` : un changement de table/rapport pendant l'écriture (rare, mais possible) l'aurait déjà
  // remplacé, et l'écraser ici serait une course perdante sur l'état affiché à l'écran.
  function runPendingSave(p) {
    return GristBI.api.saveConfig(p.tableId, p.pages, p.currentPageId, p.bookmarks, p.blend, p.reportId, p.authorLabel, p.dashStyle, p.dashStyleOptions).then((rowId) => {
      if (p.reportId === 'new' && currentReportId === 'new') currentReportId = rowId;
    }).catch((e) => {
      console.error('[GristBI] échec de sauvegarde de la config', e);
      // Consigne GFS 012 : une fois « Partager » activé sur BI_Dashboard_Config, Grist refuse
      // cette écriture pour qui n'a accès à cette ligne qu'en lecture — jamais corrigé par un
      // réessai (le droit ne change pas tout seul), donc on se contente de le dire une fois
      // plutôt que de rejouer l'échec en boucle à chaque frappe (`scheduleSave` redéclenche ce
      // catch toutes les 600ms tant que la personne modifie le rapport).
      if (GristBI.data.isAccessRuleRefusal(e)) sharedReadOnlyWarning.hidden = false;
    });
  }

  // Écrit IMMÉDIATEMENT une sauvegarde encore en attente (debounce de scheduleSave), au lieu
  // d'attendre les 600ms. Indispensable avant de changer de table : `switchTable` va lui-même
  // déclencher un rendu (chargement de la config de la table suivante), donc un nouvel appel à
  // scheduleSave qui réutilise le même `saveTimer` — sans ce flush, ce nouvel appel annule
  // silencieusement la sauvegarde en attente de l'ANCIENNE table (`clearTimeout`), qui perd
  // alors sa configuration jamais écrite dans Grist.
  function flushPendingSave() {
    if (!pendingSave) return Promise.resolve();
    clearTimeout(saveTimer);
    saveTimer = null;
    const p = pendingSave;
    pendingSave = null;
    return runPendingSave(p);
  }

  // Rejoint `currentPrimaryRows` (TOUJOURS les lignes brutes de la table principale, jamais des
  // lignes déjà jointes, voir la déclaration de `currentPrimaryRows` plus haut) avec la table
  // secondaire de `blend`, si elle est complètement configurée (les 3 champs remplis — un blend
  // partiel équivaut à "aucune jointure", plus simple et plus sûr qu'un état intermédiaire à moitié
  // appliqué). `withDateHierarchies` (voir plus haut) enrichit ensuite systématiquement le résultat,
  // qu'une jointure ait eu lieu ou non — jamais sauté, y compris sans blend, sinon la hiérarchie
  // Année/Trimestre/Mois de la table de travail principale elle-même ne serait jamais dérivée.
  // Pousse toujours le résultat dans le store, y compris `blend == null` : c'est l'unique point
  // d'entrée qui alimente `refreshColumnSelects`/`store.setRows` après le chargement initial, pour
  // que ces deux appels ne soient jamais dupliqués/oubliés à un site d'appel.
  async function applyBlend(blend) {
    if (!blend || !blend.secondaryTableId || !blend.primaryColumn || !blend.secondaryColumn) {
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
      return;
    }
    try {
      const { rows: secondaryRows } = await GristBI.api.loadTable(blend.secondaryTableId);
      const merged = GristBI.data.blendRows(currentPrimaryRows, secondaryRows, blend.primaryColumn, blend.secondaryColumn, blend.secondaryTableId);
      const rows = withDateHierarchies(merged);
      refreshColumnSelects(rows);
      store.setRows(rows);
    } catch (e) {
      console.error('[GristBI] échec de la jointure avec la table secondaire', e);
      showError(t('blend.failed', { table: blend.secondaryTableId }));
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
    }
  }

  // Relit la table de travail dans Grist après une écriture faite par ce widget (mots-clés des publications) : les
  // tuiles et les filtres voient tout de suite la colonne remplie. Même chemin que le chargement (`currentPrimaryRows`
  // puis `applyBlend`) ; abandonné si la personne a changé de table pendant la lecture. Un échec ne casse rien :
  // les données écrites sont dans Grist, un rechargement du widget les montrera.
  async function reloadWorkingTable() {
    const tableId = currentTableId;
    if (!tableId) return;
    const { rows } = await GristBI.api.loadTable(tableId);
    if (tableId !== currentTableId) return;
    currentPrimaryRows = rows;
    await refreshColumnFormats(tableId, false);
    await applyBlend(currentBlend);
  }

  // Bascule l'affichage sur `tableId`/`rows`. Met TOUJOURS à jour `currentPrimaryRows` (même hors
  // changement de table : un futur rafraîchissement de la même table doit rejoindre les lignes
  // FRAÎCHES, pas rejouer la jointure sur un instantané périmé) puis délègue à `applyBlend` le
  // rafraîchissement des sélecteurs de colonne et `store.setRows` — jamais fait ici directement,
  // pour ne pas contourner la jointure en cours.
  // `report` (consigne GFS 007, point 2/3), optionnel : `{ id, config }` quand GFS a demandé
  // d'ouvrir UN rapport précis ou un départ vierge ("Nouveau", `id: 'new'`) plutôt que la
  // convention historique "la config déjà sauvegardée pour cette table" - voir openReportById/
  // openBlankReport plus bas. Sa seule présence force une (re)prise en compte même si `tableId` ne
  // change pas (un deuxième rapport sur la MÊME table de travail doit quand même recharger ses
  // propres pages/bookmarks/blend, jamais ceux du rapport précédent).
  // Format des colonnes de la table de travail (type + options d'affichage Grist), pour « Comme dans la colonne »
  // (js/format.js:setColumnInfo). Lu à CHAQUE changement/rechargement de table ; vidé avant, pour que le format d'une
  // colonne de l'ancienne table ne s'applique jamais à une colonne de même nom d'une autre. Un échec de lecture
  // laisse le registre vide (Automatique partout) sans jamais bloquer l'affichage.
  async function refreshColumnFormats(tableId, clearFirst) {
    if (clearFirst) GristBI.format.setColumnInfo({}, null);
    if (!GristBI.api.readColumnFormats) return;
    try {
      const info = await GristBI.api.readColumnFormats(tableId);
      if (tableId !== currentTableId) return; // l'utilisateur a changé de table pendant la lecture
      GristBI.format.setColumnInfo(info.columns, info.docSettings);
    } catch (e) {
      console.warn('[GristBI] format des colonnes illisible, format des nombres Automatique', e);
    }
  }

  async function switchTable(tableId, rows, report) {
    await flushPendingSave();
    const isNewTable = tableId !== currentTableId || Boolean(report);
    currentTableId = tableId;
    currentPrimaryRows = rows;
    await refreshColumnFormats(tableId, isNewTable);
    if (isNewTable) {
      dashboardReady = false;
      connectionState = 'connecting';
      renderConnectionStatus(store.getState());
      store.clearFilter();
      store.clearAdvancedFilter();
      closeTilePanel(false); // le panneau (colonnes, édition en cours) référence l'ancienne table
      const saved = report ? report.config : await GristBI.api.loadConfig(tableId);
      currentReportId = report ? report.id : null;
      // Consigne GFS 009 : CHARGER un rapport (y compris vierge, "Nouveau" dans GFS) ne doit jamais,
      // par lui-même, planifier une sauvegarde — seul un geste réel de la personne doit écrire une
      // ligne dans BI_Dashboard_Config. render() (plus haut) compare state.pages/bookmarks/blend à
      // lastRendered* (par référence) pour décider s'il y a eu un geste ; sans garde, les trois
      // notify() ci-dessous (un par store.set*) feraient chacun passer ce test, et planifieraient
      // une sauvegarde dès le chargement. `suppressNextSave` reste levé pendant tout le bloc
      // (synchrone, aucun `await` entre les trois appels) : render() met quand même lastRendered* à
      // jour à chaque notify (pour ne pas se retrouver désynchronisé), mais sans planifier de
      // sauvegarde tant que le drapeau est levé. Un changement réel ultérieur de la personne arrive
      // hors de ce bloc, drapeau baissé, et continue d'être détecté et sauvegardé normalement.
      // Consigne GFS 010 : `try…finally` plutôt qu'un simple "levé puis baissé" - `render()` tourne
      // à chaque `store.set*` et peut lever (tuile qu'il ne sait pas dessiner, configuration abîmée) ;
      // sans `finally`, une exception laisserait le drapeau levé pour le reste de la session, et plus
      // aucun geste réel de la personne ne se sauvegarderait ensuite, sans message. `notify()`
      // (js/state.js) ne rattrape rien lui-même : seul ce `finally` referme le trou.
      suppressNextSave = true;
      try {
        store.setPages(saved.pages, saved.currentPageId);
        store.setBookmarks(saved.bookmarks);
        currentBlend = saved.blend;
        store.setBlend(currentBlend);
        store.setDashStyle(saved.style); // absent d'une configuration d'avant ce réglage -> Standard
        store.setDashStyleOptions(saved.styleOptions); // idem : aucune option cochée
      } finally {
        suppressNextSave = false;
      }
      dashboardReady = true;
      autoMode();
      refreshBlendPicker();
    }
    await applyBlend(currentBlend);
  }

  // Ouvre le rapport `reportId` (une ligne de BI_Dashboard_Config, voir GristBI.api.loadConfigById)
  // - ce que GFS demande via GfsLink.opening()/onOpen (consigne 007, point 3 ; `reportId` y est
  // toujours du TEXTE, voir kit/js/gfs-link.js:normalizeOpening). Rien à recharger si c'est déjà ce
  // rapport qui est affiché (comparé en texte : `currentReportId` devient un NOMBRE une fois un
  // rapport ouvert, voir switchTable/GristBI.api.loadConfigById).
  async function openReportById(reportId) {
    if (String(currentReportId) === String(reportId)) return;
    await flushPendingSave();
    const report = await GristBI.api.loadConfigById(reportId);
    if (!report) {
      console.error(`[GristBI] rapport "${reportId}" introuvable, ou d'un type inconnu pour ce widget - affichage inchangé`);
      return;
    }
    const { rows } = await GristBI.api.loadTable(report.tableId);
    await switchTable(report.tableId, rows, { id: report.id, config: report.config });
    await refreshTablePicker();
  }

  // "Nouveau" dans GFS (consigne 007, point 3 : GfsLink.opening()/onOpen avec `fichier` null) :
  // l'écran de départ habituel (connexion à la 1re table du document, comme bootstrap() plus bas),
  // mais avec un dashboard VIERGE plutôt que la config déjà sauvegardée pour cette table - sa
  // propre ligne de BI_Dashboard_Config ne s'écrit qu'au premier enregistrement (jeton `'new'`, vu
  // par scheduleSave/runPendingSave), jamais ici : « Nouveau » n'écrit rien par lui-même.
  async function openBlankReport() {
    await flushPendingSave();
    try {
      const tables = await GristBI.api.listAvailableTables();
      if (!tables.length) { setConnectionState('noTables'); return; }
      const tableId = tables[0];
      const { rows } = await GristBI.api.loadTable(tableId);
      await switchTable(tableId, rows, { id: 'new', config: GristBI.api.blankConfig() });
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec du départ vierge ("Nouveau" dans GFS)', e);
      setConnectionState('failed');
    }
  }

  // Plafond de tables lues pour trouver celle qui convient à un modèle : sur un gros document, relire
  // toutes les tables pour un seul clic serait long ; la table déjà connectée passe d'abord.
  const MODEL_TABLE_SCAN_LIMIT = 8;

  // « Nouveau > Depuis un modèle » dans GFS (consigne 016, contrats 5.4 point 13 ; `GfsLink.opening()`/
  // `onOpen` avec `modele: { id }`) : un rapport de départ NON enregistré, fait d'après le modèle `id`
  // (js/models.js) sur la première table du document qui a ce qu'il lui faut (une date, des
  // catégories…). Comme openBlankReport, rien n'est écrit ici : la ligne de BI_Dashboard_Config ne naît
  // qu'au premier geste de la personne (jeton `'new'`, voir switchTable/scheduleSave) ; ce modèle ne
  // crée AUCUNE table (CLAUDE.md §8). Rend `true` si le modèle est ouvert, sinon `false` après avoir
  // dit pourquoi dans une fenêtre — jamais un rapport vierge à la place, et rien n'est changé à
  // l'écran : le rapport en cours reste affiché.
  async function openModelById(modelId, type) {
    await flushPendingSave();
    if (!GristBI.models.has(modelId) || (type && type !== GristBI.models.REPORT_TYPE)) {
      console.error(`[GristBI] modèle "${modelId}" inconnu de cette version, ou de type "${type}" : rien n'est ouvert`);
      showNotice(t('models.unknown'));
      return false;
    }
    try {
      const names = await GristBI.api.listAvailableTables();
      if (!names.length) { showNotice(t('models.noTables')); return false; }
      const ordered = (currentTableId && names.indexOf(currentTableId) !== -1)
        ? [currentTableId].concat(names.filter((n) => n !== currentTableId)) : names;
      let firstMissing = null;
      for (const tableId of ordered.slice(0, MODEL_TABLE_SCAN_LIMIT)) {
        const { rows } = await GristBI.api.loadTable(tableId);
        const enriched = withDateHierarchies(rows);
        const built = GristBI.models.build(modelId, enriched, availableColumns(enriched), { t });
        if (!built.ok) { if (!firstMissing) firstMissing = built.missing; continue; }
        const config = GristBI.api.blankConfig();
        config.pages = [{ id: config.currentPageId, name: built.pageName,
          tiles: built.tiles.map((tile, i) => Object.assign({ id: genTileId(i) }, tile)) }];
        await switchTable(tableId, rows, { id: 'new', config });
        await refreshTablePicker();
        return true;
      }
      const needs = (firstMissing && firstMissing.length ? firstMissing : ['data'])
        .map((role) => t('models.need.' + role)).join(' ' + t('models.needAnd') + ' ');
      showNotice(t('models.noFit', { needs }));
      return false;
    } catch (e) {
      console.error(`[GristBI] échec de l'ouverture du modèle "${modelId}"`, e);
      showNotice(t('models.failed'));
      return false;
    }
  }
  GristBI.openModel = openModelById; // essais navigateur (dev-tests/) : même chemin que `onOpen`

  store.subscribe(render);
  // Premier rendu explicite, synchrone, AVANT que bootstrap() (plus bas, jamais attendu ici) n'ait pu
  // résoudre quoi que ce soit : `store.subscribe` seul ne peint rien tant qu'aucune mutation d'état
  // n'a eu lieu, or un document SANS aucune table utilisateur ne déclenche jamais switchTable() — la
  // seule mutation d'état qui ferait naturellement tourner `render()` ailleurs (ex. store.setPages()
  // dans switchTable). Sans cet appel, `status.noTables`/setTableDependentControlsEnabled restaient
  // inertes indéfiniment dans ce cas précis : le DOM gardait tel quel le HTML statique de départ
  // (formulaire d'ajout de tuile pleinement interactif mais inopérant) — repéré lors de l'audit UX du
  // 21/10/2026 en testant un document réellement vide. Repeint sans effet de bord dans le cas normal
  // (une table est trouvée) : switchTable() déclenchera de toute façon ses propres rendus juste après.
  render(store.getState());

  // Liste les tables du document dans le sélecteur (voir GristBI.api.listAvailableTables — relit
  // TOUJOURS à la demande, jamais un cache, pour refléter une table créée dans Grist entre-temps) et
  // remet la valeur sur `currentTableId`. Rechargée après chaque changement de table réussi, pas
  // seulement au démarrage : la table qu'on vient de rejoindre doit rester sélectionnée à l'écran.
  async function refreshTablePicker() {
    try {
      const tables = await GristBI.api.listAvailableTables();
      fillCombobox(tableSelectInput, tables);
      tableSelectInput.value = currentTableId;
    } catch (e) {
      console.error('[GristBI] échec du chargement de la liste des tables', e);
    }
  }

  // Table secondaire du data blending : mêmes tables que le sélecteur principal ci-dessus, MOINS la
  // table de travail courante elle-même (se joindre à soi-même n'a pas de sens dans ce premier jet).
  async function refreshSecondaryTablePicker() {
    try {
      const tables = (await GristBI.api.listAvailableTables()).filter((id) => id !== currentTableId);
      fillCombobox(blendSecondaryTableInput, tables, { blankLabel: t('blend.none') });
    } catch (e) {
      console.error('[GristBI] échec du chargement de la liste des tables (blending)', e);
    }
  }

  // Colonnes de la table secondaire ACTUELLEMENT choisie dans le combobox (pas celle de `currentBlend`
  // — l'utilisateur a pu changer la table secondaire sans encore valider les clés) : relue à chaque
  // ouverture du combobox de clé secondaire, jamais mise en cache, même raison que
  // `refreshTablePicker`/`refreshSecondaryTablePicker`.
  async function refreshBlendSecondaryColumnPicker() {
    const secondaryTableId = blendSecondaryTableInput.value;
    if (!secondaryTableId) { fillCombobox(blendSecondaryColumnInput, [], { blankLabel: t('blend.none') }); return; }
    try {
      const { rows: secondaryRows } = await GristBI.api.loadTable(secondaryTableId);
      fillCombobox(blendSecondaryColumnInput, blendJoinColumns(secondaryRows), { blankLabel: t('blend.none') });
    } catch (e) {
      console.error('[GristBI] échec du chargement des colonnes de la table secondaire', e);
      fillCombobox(blendSecondaryColumnInput, [], { blankLabel: t('blend.none') });
    }
  }

  // Remet les 3 comboboxes de blending sur `currentBlend` (après un changement de table, voir
  // switchTable) — même idiome que `refreshTablePicker` (`fillCombobox` puis affectation directe de
  // `.value`, PAS via `setOptions`, voir js/combobox.js) : la valeur choisie faisant partie des
  // options qui viennent d'être posées, `isValid()` la reconnaîtra dès la première interaction.
  function refreshBlendPicker() {
    blendSecondaryTableInput.value = (currentBlend && currentBlend.secondaryTableId) || '';
    fillCombobox(blendPrimaryColumnInput, blendJoinColumns(currentPrimaryRows), { blankLabel: t('blend.none') });
    blendPrimaryColumnInput.value = (currentBlend && currentBlend.primaryColumn) || '';
    refreshBlendSecondaryColumnPicker().then(() => {
      blendSecondaryColumnInput.value = (currentBlend && currentBlend.secondaryColumn) || '';
    });
  }

  // Relit les 3 comboboxes de blending et applique/persiste le résultat — appelé par les 3
  // écouteurs 'change' ci-dessous. Un blend INCOMPLET (au moins un des 3 champs encore vide) équivaut
  // à "aucune jointure" (voir applyBlend) : plus simple à raisonner qu'un état à moitié configuré, et
  // ça laisse l'utilisateur choisir les 3 champs dans n'importe quel ordre sans jamais déclencher une
  // jointure invalide entre-temps.
  function commitBlendFromForm() {
    const secondaryTableId = blendSecondaryTableInput.value;
    const primaryColumn = blendPrimaryColumnInput.value;
    const secondaryColumn = blendSecondaryColumnInput.value;
    currentBlend = (secondaryTableId && primaryColumn && secondaryColumn)
      ? { secondaryTableId, primaryColumn, secondaryColumn }
      : null;
    store.setBlend(currentBlend);
    applyBlend(currentBlend);
  }

  // Suggère une paire de clés de jointure à partir des colonnes de référence Grist RÉELLES
  // (`Ref:`, jamais `RefList:` — voir GristBI.api.refColumnsForTable) plutôt que de laisser
  // l'utilisateur deviner quelle colonne numérique réfère quelle table (ROADMAP.md : piste notée
  // comme "pas tentée dans ce premier jet" au moment du data blending initial). Respecte un choix
  // DÉJÀ fait côté table principale (`currentPrimaryColumn`, voir le commentaire du listener de
  // changement de table secondaire ci-dessous, qui le préserve délibérément) : dans ce cas, ne
  // suggère QUE la clé secondaire, et seulement si cette colonne réfère bien la nouvelle table
  // secondaire — jamais une suggestion qui contredirait un choix explicite déjà en place. Sinon,
  // cherche d'abord une référence PRINCIPALE -> SECONDAIRE (cas le plus courant : enrichir la table
  // de travail avec une table de référence), puis seulement à défaut l'inverse (SECONDAIRE ->
  // PRINCIPALE). Renvoie `null` si aucune référence ne relie les deux tables — l'utilisateur choisit
  // alors ses clés à la main, exactement comme avant cette fonctionnalité.
  async function suggestBlendJoinColumns(secondaryTableId, currentPrimaryColumn) {
    if (!secondaryTableId) return null;
    const [primaryRefCols, secondaryRefCols] = await Promise.all([
      GristBI.api.refColumnsForTable(currentTableId),
      GristBI.api.refColumnsForTable(secondaryTableId)
    ]);
    if (currentPrimaryColumn) {
      const stillValid = primaryRefCols.some((c) => c.colId === currentPrimaryColumn && c.targetTableId === secondaryTableId);
      return stillValid ? { primaryColumn: currentPrimaryColumn, secondaryColumn: 'id' } : null;
    }
    const primaryMatch = primaryRefCols.find((c) => c.targetTableId === secondaryTableId);
    if (primaryMatch) return { primaryColumn: primaryMatch.colId, secondaryColumn: 'id' };
    const secondaryMatch = secondaryRefCols.find((c) => c.targetTableId === currentTableId);
    if (secondaryMatch) return { primaryColumn: 'id', secondaryColumn: secondaryMatch.colId };
    return null;
  }

  blendSecondaryTableInput.addEventListener('change', () => {
    // Changer de table secondaire invalide les clés déjà choisies (colonnes d'une autre table) :
    // on ne garde QUE la clé côté table principale, jamais la clé secondaire de l'ancien choix.
    blendSecondaryColumnInput.value = '';
    const secondaryTableId = blendSecondaryTableInput.value;
    const keptPrimaryColumn = blendPrimaryColumnInput.value;
    refreshBlendSecondaryColumnPicker().then(() => suggestBlendJoinColumns(secondaryTableId, keptPrimaryColumn)).then((suggestion) => {
      if (suggestion) {
        blendPrimaryColumnInput.value = suggestion.primaryColumn;
        blendSecondaryColumnInput.value = suggestion.secondaryColumn;
      }
      commitBlendFromForm();
    });
  });
  blendPrimaryColumnInput.addEventListener('change', commitBlendFromForm);
  blendSecondaryColumnInput.addEventListener('change', commitBlendFromForm);

  // Reconnexion à une AUTRE table du document, choisie via le sélecteur. Ne crée/ne remplit jamais
  // rien (`GristBI.api.loadTable`, la table choisie existe forcément déjà — elle vient de
  // `listAvailableTables`) et ne préconfigure aucune tuile : une table quelconque du document
  // démarre sur un dashboard VIDE à construire soi-même, exactement comme la 1re table connectée
  // automatiquement au démarrage (voir bootstrap plus bas) — ce widget ne connaît plus aucun jeu de
  // tuiles par défaut depuis qu'il ne crée plus lui-même de table de données (CLAUDE.md §1/§7).
  tableSelectInput.addEventListener('change', async () => {
    const tableId = tableSelectInput.value;
    if (!tableId) return;
    try {
      const { rows } = await GristBI.api.loadTable(tableId);
      await switchTable(tableId, rows);
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec de la connexion à la table choisie', e);
      showError(t('table.connectFailed', { table: tableId }));
      tableSelectInput.value = currentTableId; // revient sur la table encore effectivement active
    }
  });

  // Connexion automatique, au démarrage, à la 1re table du document (voir
  // GristBI.api.listAvailableTables ci-dessus) — plus de table de données par défaut créée par ce
  // widget depuis que la table de test de charge (`BI_StressTest`) a été retirée (demande explicite
  // de l'utilisateur, 2026-09-19, voir CLAUDE.md §1/§7) : le dashboard démarre VIDE sur cette 1re
  // table, exactement comme une reconnexion manuelle via le sélecteur (`tableSelectInput` ci-dessus)
  // — aucune tuile pré-configurée à poser, ce widget ne connaît plus le schéma d'aucune table à
  // l'avance. Si le document ne contient encore AUCUNE table (hors tables internes de ce widget),
  // il n'y a rien à connecter automatiquement (voir `status.noTables`) : l'utilisateur peut créer
  // une table dans Grist puis la choisir via le sélecteur ci-dessus SANS recharger le widget — son
  // `beforeOpen` (`refreshTablePicker`) relit toujours la liste à la demande, jamais un instantané.
  // Connexion automatique à la 1re table du document (voir plus haut) — extraite de bootstrap()
  // pour que le bouton « Réessayer » de l'état vide (échec de connexion) la rejoue telle quelle.
  async function connectToFirstTable() {
    setConnectionState('connecting');
    try {
      const tables = await GristBI.api.listAvailableTables();
      if (tables.length) {
        const tableId = tables[0];
        const { rows } = await GristBI.api.loadTable(tableId);
        await switchTable(tableId, rows);
        await refreshTablePicker();
      } else {
        setConnectionState('noTables');
      }
    } catch (e) {
      console.error('[GristBI] échec de la connexion automatique à la 1re table du document', e);
      setConnectionState('failed');
    }
  }
  retryConnectBtn.addEventListener('click', connectToFirstTable);

  async function bootstrap() {
    await GristBI.api.init();
    setConnectionState('connecting');

    // Consigne GFS 007, point 3 : si GFS demande d'ouvrir un rapport précis (ou un départ vierge,
    // "Nouveau"), ce départ remplace la connexion automatique habituelle ci-dessous - jamais
    // l'inverse. `opening()` reste `null` hors GFS, et dans GFS tant qu'aucune route précise n'est
    // donnée : dans les deux cas, tout ce qui suivait déjà cette ligne avant cette consigne reste
    // inchangé (branche `else`).
    const linkedGfs = await gfsLinkReady;
    let opening = null;
    if (linkedGfs && linkedGfs.hosted) {
      await linkedGfs.ready;
      opening = linkedGfs.opening();
    }

    if (opening && opening.fichier) {
      try {
        await openReportById(opening.fichier.id);
      } catch (e) {
        console.error('[GristBI] échec de l\'ouverture du rapport demandé par GFS', e);
        setConnectionState('failed');
      }
    } else if (opening && opening.modele) {
      // Consigne GFS 016 : le modèle choisi dans GFS démarre l'app. S'il ne s'ouvre pas (id inconnu,
      // aucune table qui convienne), la raison est dite dans une fenêtre (openModelById) et l'app
      // démarre comme d'habitude sur la première table, avec son rapport déjà enregistré — jamais
      // un rapport vierge qui ferait croire que le modèle s'est ouvert.
      if (!(await openModelById(opening.modele.id, opening.type))) await connectToFirstTable();
    } else if (opening) {
      await openBlankReport(); // gère déjà son propre try/catch
    } else {
      await connectToFirstTable();
    }
    // Table dédiée, indépendante de la table de travail (voir js/state.js:comments) : chargée UNE
    // SEULE fois par session, jamais rechargée à un changement de table (switchTable) — dans un
    // try/catch séparé pour qu'un échec ici (ex. table de commentaires non créable) n'empêche
    // jamais l'affichage du dashboard lui-même, la vraie raison d'être du widget.
    try {
      const { rows: commentRows } = await GristBI.api.loadOrCreateComments();
      store.setComments(commentRows);
    } catch (e) {
      console.error('[GristBI] échec de la connexion à la table de commentaires collaboratifs (BI_Dashboard_Comments) — les commentaires resteront indisponibles pour cette session', e);
    }
    // Détection de l'auteur courant (table-sonde BI_Dashboard_UserProbe, voir js/grist-api.js) :
    // UNE SEULE fois par session, comme les commentaires ci-dessus — l'identité ne change pas en
    // cours de route. `detectedUserEmail` reste à `null` (repli sur la saisie manuelle inchangée,
    // voir openCommentsModal) si cette détection échoue pour n'importe quelle raison (widget hors
    // Grist, mock de dev-tests/ qui ne simule pas le moteur de formules, droits insuffisants...) —
    // try/catch séparé pour la même raison que les commentaires : jamais bloquant pour le dashboard.
    try {
      detectedUserEmail = await GristBI.api.getCurrentUserEmail();
    } catch (e) {
      console.error('[GristBI] échec de la détection automatique de l\'auteur courant — repli sur la saisie manuelle', e);
    }
  }

  // Sélecteur de langue (panneau Réglages, radio-boutons fr/en) : persisté par GristBI.i18n
  // (localStorage). Même placement de référence que Publipostage+ (js/settings.js de ce widget
  // frère) — une langue choisie une fois n'a pas besoin d'une place permanente dans le bandeau, qui
  // porte déjà les exports, Réglages et le logo (demande du coordinateur du 29/09/2026, après un
  // premier jet en bouton de bandeau). onChange (voir js/i18n.js) couvre tout ce qu'aucun attribut
  // data-i18n-* ne peut porter parce que ça dépend d'un autre état que la langue : le libellé
  // Dimension/Mesure selon le type de tuile choisi (updateFormFieldsForType) et le texte du bouton
  // Ajouter/Modifier selon le mode édition (submitTileBtn) — puis un render() complet pour tout le
  // reste (tuiles, badges, pages).
  const langRadios = Array.from(document.querySelectorAll('input[name="settings-lang"]'));
  function refreshLangRadios() {
    const lang = GristBI.i18n.getLang();
    langRadios.forEach((r) => { r.checked = (r.value === lang); });
  }
  langRadios.forEach((radio) => {
    radio.addEventListener('change', () => { if (radio.checked) GristBI.i18n.setLang(radio.value); });
  });
  GristBI.i18n.onChange(() => {
    refreshLangRadios();
    // Rafraîchit aussi le blankLabel "(aucun)"/"(none)" des comboboxes optionnelles (drill-down,
    // Tendance vs) : c'est `Combobox.setOptions` (js/combobox.js) qui l'écrit dans `.placeholder`
    // au moment de l'appel, jamais relu automatiquement — sans ce rappel, le placeholder resterait
    // figé dans l'ancienne langue après un changement, contrairement au reste du formulaire.
    // `setOptions` en mode strict garde la valeur déjà choisie si elle reste valide (voir
    // combobox.js), donc sans effet de bord sur une tuile en cours d'édition.
    refreshColumnSelects(store.getState().rows);
    // Même raison, pour le blankLabel "(aucune)"/"(none)" des 3 comboboxes de data blending — sans
    // toucher au reste : refreshBlendPicker() ne fait que reposer les options/valeurs déjà connues
    // (currentBlend/currentPrimaryRows inchangés), ne relance aucune jointure.
    refreshBlendPicker();
    updateFormFieldsForType();
    refreshTilePanelTexts();
    render(store.getState());
  });
  // Thème des graphiques (audit de lisibilité, lot 4) : `js/charts.js` lit les jetons de couleur de la page à CHAQUE
  // rendu (infobulle, quadrillage, texte), mais rien ne relançait un rendu quand ils changent — passage clair/sombre du
  // système, ambiance de GFS posée sur <html> par le CSSOM. On compare une signature des jetons lus (jamais un rendu à
  // chaque mutation de <html> : `--chrome-h` y est réécrit à chaque redimensionnement de la barre).
  (function watchChartTheme() {
    const TOKENS = ['--text', '--text-secondary', '--text-muted', '--surface', '--dash-tile-surface', '--border', '--border-strong'];
    const signature = () => {
      const cs = getComputedStyle(document.documentElement);
      return TOKENS.map((n) => cs.getPropertyValue(n).trim()).join('|');
    };
    let last = signature();
    let timer = null;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = signature();
        if (now === last) return;
        last = now;
        render(store.getState());
      }, 120);
    };
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', check); else if (mq.addListener) mq.addListener(check);
    } catch (e) { /* pas de matchMedia (hors navigateur) : seul l'observateur ci-dessous reste */ }
    try {
      new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    } catch (e) { /* idem */ }
  })();

  // Consigne GFS 007, point 3 : dans GFS, `gristbi_lang` passe par `GfsLink.storageSet` plutôt que
  // `localStorage`, peu fiable dans le sous-cadre isolé de GFS — `GristBI.i18n.setLang` essaie
  // quand même `localStorage` de son côté (voir js/i18n.js), sans effet dans ce cas, harmless. La
  // LANGUE elle-même (quel fr/en est actif) reste pilotée par GFS via `GfsLink.onLanguage`
  // (ci-dessus, tête de fichier) : ceci n'est qu'une sauvegarde de secours, jamais la source de
  // vérité tant que ce widget est hébergé.
  GristBI.i18n.onChange((lang) => { if (gfsLink && gfsLink.hosted) gfsLink.storageSet('gristbi_lang', lang); });
  refreshLangRadios();

  // Style global des tuiles (js/styles.js, css/dash-styles.css) : une carte par style dans le menu Réglages, construites d'après
  // le registre pour qu'un style ajouté y apparaisse sans toucher au HTML. Le texte vient de `data-i18n` (résolu par
  // `applyTranslations()` à chaque rendu, donc il suit un changement de langue) ; la pastille est un aperçu fait des MÊMES jetons CSS
  // que les tuiles (`.style-swatch[data-dash-style]`), jamais une image. Choisir un style passe par le store : `render()` pose le
  // style, redessine toutes les tuiles et planifie la sauvegarde dans la configuration du tableau de bord.
  function renderStyleOptions() {
    if (!styleOptionsEl) return;
    styleOptionsEl.textContent = '';
    GristBI.styles.STYLE_IDS.forEach((id) => {
      const style = GristBI.styles.STYLES[id];
      const label = document.createElement('label');
      label.className = 'style-option';
      label.dataset.styleId = id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'settings-style';
      input.value = id;
      input.addEventListener('change', () => { if (input.checked) store.setDashStyle(id); });
      const swatch = document.createElement('span');
      swatch.className = 'style-swatch';
      swatch.setAttribute('data-dash-style', id);
      swatch.setAttribute('aria-hidden', 'true');
      const card = document.createElement('span');
      card.className = 'sw-card';
      const title = document.createElement('span');
      title.className = 'sw-title';
      const bars = document.createElement('span');
      bars.className = 'sw-bars';
      for (let i = 0; i < 4; i++) bars.appendChild(document.createElement('i'));
      card.append(title, bars);
      swatch.appendChild(card);
      const name = document.createElement('span');
      name.className = 'style-option-name';
      name.setAttribute('data-i18n', style.nameKey);
      name.textContent = t(style.nameKey);
      const desc = document.createElement('span');
      desc.className = 'style-option-desc';
      desc.setAttribute('data-i18n', style.descKey);
      desc.textContent = t(style.descKey);
      label.append(input, swatch, name, desc);
      styleOptionsEl.appendChild(label);
    });
    refreshStyleOptions(store.getState().dashStyle, store.getState().dashStyleOptions);
  }
  // Coche la carte du style en vigueur (un id inconnu de ce widget s'affiche, et se coche, en Standard).
  function refreshStyleOptions(dashStyle, dashStyleOptions) {
    if (!styleOptionsEl) return;
    const opts = dashStyleOptions || {};
    Object.keys(styleExtraInputs).forEach((key) => {
      const input = styleExtraInputs[key];
      if (input && input.checked !== !!opts[key]) input.checked = !!opts[key];
    });
    const current = GristBI.styles.normalizeStyleId(dashStyle);
    styleOptionsEl.querySelectorAll('.style-option').forEach((label) => {
      const selected = label.dataset.styleId === current;
      label.classList.toggle('is-selected', selected);
      const input = label.querySelector('input');
      if (input && input.checked !== selected) input.checked = selected;
    });
  }
  // Options valables pour tous les styles (cases sous les cartes de style) : tout-ou-rien chacune, passent par le store comme le style.
  Object.keys(styleExtraInputs).forEach((key) => {
    const input = styleExtraInputs[key];
    if (!input) return;
    input.addEventListener('change', () => store.setDashStyleOptions(Object.assign({}, store.getState().dashStyleOptions, { [key]: input.checked })));
  });
  renderStyleOptions();

  // Disposition de la PAGE courante (js/layouts.js, css/layouts.css) : une carte par agencement dans le menu Réglages, construites d'après le
  // registre. La miniature est un petit SVG fait des formes de `GristBI.layouts.thumb` (testées sous Node), coloré par les mêmes jetons que
  // la page ; le texte vient de `data-i18n`. Choisir un agencement passe par le store (`setPageLayout`, pour LA page affichée) : `render()` pose le
  // plan, redessine et planifie la sauvegarde, comme pour le style. Le réglage suit la page : changer d'onglet recoche la carte de cette page.
  function renderLayoutOptions() {
    if (!layoutOptionsEl) return;
    layoutOptionsEl.textContent = '';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    GristBI.layouts.LAYOUT_IDS.forEach((id) => {
      const layout = GristBI.layouts.LAYOUTS[id];
      const label = document.createElement('label');
      label.className = 'style-option layout-option';
      label.dataset.layoutId = id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'settings-layout';
      input.value = id;
      input.addEventListener('change', () => { if (input.checked) store.setPageLayout(store.getState().currentPageId, id); });
      const swatch = document.createElement('span');
      swatch.className = 'layout-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${GristBI.layouts.THUMB_W} ${GristBI.layouts.THUMB_H}`);
      svg.setAttribute('focusable', 'false');
      GristBI.layouts.thumb(id).forEach((shape) => {
        const node = document.createElementNS(SVG_NS, shape.kind === 'rule' ? 'line' : 'rect');
        if (shape.kind === 'rule') {
          node.setAttribute('x1', shape.x); node.setAttribute('y1', shape.y);
          node.setAttribute('x2', shape.x + shape.w); node.setAttribute('y2', shape.y + shape.h);
        } else {
          node.setAttribute('x', shape.x); node.setAttribute('y', shape.y);
          node.setAttribute('width', shape.w); node.setAttribute('height', shape.h);
          node.setAttribute('rx', shape.kind === 'frame' ? '2' : '1');
        }
        node.setAttribute('class', 'lt-' + shape.kind);
        svg.appendChild(node);
      });
      swatch.appendChild(svg);
      const name = document.createElement('span');
      name.className = 'style-option-name';
      name.setAttribute('data-i18n', layout.nameKey);
      name.textContent = t(layout.nameKey);
      const desc = document.createElement('span');
      desc.className = 'style-option-desc';
      desc.setAttribute('data-i18n', layout.descKey);
      desc.textContent = t(layout.descKey);
      label.append(input, swatch, name, desc);
      layoutOptionsEl.appendChild(label);
    });
    refreshLayoutOptions(store.getState());
  }
  // Coche la carte de l'agencement de la page affichée (un id inconnu de ce widget s'affiche, et se coche, en Grille) et nomme la page.
  function refreshLayoutOptions(state) {
    if (!layoutOptionsEl) return;
    const page = state.pages.find((p) => p.id === state.currentPageId) || state.pages[0];
    if (layoutHintEl) {
      const hint = t('layout.hint', { page: page ? page.name : '' });
      if (layoutHintEl.textContent !== hint) layoutHintEl.textContent = hint;
    }
    const current = GristBI.layouts.normalizeLayoutId(state.pageLayout);
    layoutOptionsEl.querySelectorAll('.layout-option').forEach((label) => {
      const selected = label.dataset.layoutId === current;
      label.classList.toggle('is-selected', selected);
      const input = label.querySelector('input');
      if (input && input.checked !== selected) input.checked = selected;
    });
  }
  renderLayoutOptions();

  bootstrap();
})();
