/*
 * Bootstrap de l'UI : formulaire d'ajout/édition de tuile, rendu de la grille et des filtres
 * croisés actifs, câblage store <-> GristBI.api (connexion à la table de travail + persistance
 * config). Le widget se connecte automatiquement à sa table de test de charge au démarrage (voir
 * bootstrap() en bas de fichier) plutôt que d'attendre un clic ou une table liée dans la page.
 */
(function () {
  'use strict';
  const GristBI = window.GristBI;
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
    comment: '<path d="M2.5 3.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H6.5l-2.8 2.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/>'
  };
  function icon(name) {
    return `<svg class="icon icon-${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
  }

  let currentTableId = null;
  // Id réel de LA table de travail par défaut (BI_StressTest), capturé au bootstrap plutôt que
  // codé en dur ici — c'est la SEULE table pour laquelle ce widget connaît des tuiles par défaut
  // (GristBI.demoData.defaultLargeTiles), donc la seule sur laquelle proposer de les restaurer.
  let defaultTableId = null;
  let commentsModalTileId = null; // tuile actuellement affichée dans #comments-modal, ou null si fermé
  let saveTimer = null;
  let pendingSave = null; // { tableId, pages, currentPageId, bookmarks, blend } en attente d'écriture, voir flushPendingSave()
  let lastRenderedPages = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let lastRenderedCurrentPageId = null; // idem, côté page active (changer de page se sauvegarde aussi)
  let lastRenderedBookmarks = null; // idem, côté bookmarks
  let lastRenderedBlend = null; // idem, côté jointure de data blending (voir applyBlend/commitBlendFromForm)
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

  const tilesContainer = document.getElementById('tiles');
  const emptyState = document.getElementById('empty-state');
  const restoreDefaultTilesBtn = document.getElementById('restore-default-tiles');
  const addTileForm = document.getElementById('add-tile-form');
  const tileTypeSelect = document.getElementById('tile-type');
  const dimensionField = document.getElementById('tile-dimension-field');
  const dimensionLabel = document.getElementById('tile-dimension-label');
  const dimensionSelect = document.getElementById('tile-dimension');
  const suggestDateHierarchyBtn = document.getElementById('tile-suggest-date-hierarchy');
  const columnDimensionField = document.getElementById('tile-column-dimension-field');
  const columnDimensionSelect = document.getElementById('tile-column-dimension');
  const drillField = document.getElementById('tile-drill-field');
  const drillLevelsContainer = document.getElementById('tile-drill-levels');
  const addDrillLevelBtn = document.getElementById('tile-drill-add-level');
  const drillCrossFilterField = document.getElementById('tile-drill-crossfilter-field');
  const drillCrossFilterCheckbox = document.getElementById('tile-drill-crossfilter');
  const measureLabel = document.getElementById('tile-measure-label');
  const measureSelect = document.getElementById('tile-measure');
  const measureYField = document.getElementById('tile-measure-y-field');
  const measureYSelect = document.getElementById('tile-measure-y');
  const aggSelect = document.getElementById('tile-agg');
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
  const clearFilterBtn = document.getElementById('clear-filter');
  const filterBadgesEl = document.getElementById('filter-badges');
  const rowCountEl = document.getElementById('row-count');
  const bookmarkSelect = document.getElementById('bookmark-select');
  const deleteBookmarkBtn = document.getElementById('delete-bookmark');
  const saveBookmarkBtn = document.getElementById('save-bookmark');
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
  const settingsBtn = document.getElementById('open-settings');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close');
  const commentsModal = document.getElementById('comments-modal');
  const commentsCloseBtn = document.getElementById('comments-close');
  const commentsModalTileEl = document.getElementById('comments-modal-tile');
  const commentsListEl = document.getElementById('comments-list');
  const commentsEmptyEl = document.getElementById('comments-empty');
  const commentForm = document.getElementById('comment-form');
  const commentAuthorInput = document.getElementById('comment-author');
  const commentTextInput = document.getElementById('comment-text');

  // Tous les champs qui référencent une COLONNE deviennent des comboboxes avec autocomplétion
  // (demande explicite de l'utilisateur, voir js/combobox.js) — en mode strict : la valeur doit
  // rester l'une des colonnes réellement chargées, comme un <select>. `.nextElementSibling` est le
  // <ul class="combobox-list"> voisin dans le même wrapper `.combobox` (voir index.html/harness.html).
  [dimensionSelect, columnDimensionSelect, measureSelect, measureYSelect, trendDimensionSelect, dateColumnSelect, filterColumnSelect].forEach((input) => {
    GristBI.combobox.attach(input, input.nextElementSibling, { strict: true });
  });

  // Champ "Recherche" (filtre avancé "contient") : mode `strict: false`, la liste n'est qu'une
  // SUGGESTION des valeurs réellement présentes dans la colonne choisie (voir
  // updateAdvancedFilterFieldsForColumn) — l'utilisateur tape une sous-chaîne libre (ex. "cam" pour
  // "Webcam"), pas forcément une valeur exacte de la liste. Demande explicite de l'utilisateur
  // ("Colonnes ET valeurs" pour l'autocomplétion des filtres).
  GristBI.combobox.attach(filterTextInput, filterTextInput.nextElementSibling, { strict: false });

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
    fillCombobox(measureSelect, cols);
    fillCombobox(measureYSelect, cols);
    drillLevelSelects.forEach((select) => fillCombobox(select, cols, { blankLabel: t('tileForm.none.m') }));
    fillCombobox(trendDimensionSelect, cols, { blankLabel: t('tileForm.none.f') });
    fillCombobox(dateColumnSelect, cols);
    fillCombobox(filterColumnSelect, cols);
    updateAdvancedFilterFieldsForColumn(rows);
    updateSuggestDateHierarchyVisibility(rows);
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
    const noDrill = formHasNoDimension() || tileTypeSelect.value === 'pivot';
    const column = dimensionSelect.value;
    suggestDateHierarchyBtn.hidden = noDrill || !column || inferColumnKind(column, rows) !== 'date';
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
    filterTextInput.setOptions(kind === 'text' && column ? GristBI.data.distinctColumnValues(rows, column) : []);
  }

  // KPI et jauge : une seule valeur agrégée, pas de dimension de regroupement ni de drill-down.
  function typeHasNoDimension(type) { return type === 'kpi' || type === 'gauge'; }

  // Titres de tuile auto-composés (ex. "YTD : sum(Montant)") : du CONTENU généré à partir de noms
  // de colonnes, pas de la chrome — même périmètre volontairement laissé de côté que les titres
  // par défaut de js/demo-data.js et les en-têtes d'export Excel de js/data.js (voir js/i18n.js).
  const MEASURE_MODE_TITLES = { cumulative: 'Cumul', ytd: 'YTD', yoy: 'Comparaison N-1' };

  // Idem pour une tuile "Barres" avec un mode de calcul temporel actif ('cumulative'/'ytd'/'yoy',
  // voir ROADMAP.md "Mesures façon DAX simplifié") : l'axe est TOUJOURS le mois calculé depuis
  // `tile-date-column` (voir js/duckdb-engine.js:timeSeriesMeasures), la dimension/le drill-down du
  // formulaire n'ont donc pas de sens dans ce mode — même traitement que KPI/jauge.
  function formHasNoDimension() {
    return typeHasNoDimension(tileTypeSelect.value)
      || (tileTypeSelect.value === 'bar' && measureModeSelect.value && measureModeSelect.value !== 'brut');
  }

  // Le pivot a DEUX dimensions (lignes + colonnes, voir tile-column-dimension-field) déjà
  // affichées simultanément dans la grille : pas de notion de "détailler" une dimension au clic
  // comme pour bar/pie/treemap/scatter (qui n'en ont qu'une), donc pas de drill-down pour ce type.
  function supportsDrillDown(type) { return !typeHasNoDimension(type) && type !== 'pivot'; }

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
    const noDrill = formHasNoDimension() || tileTypeSelect.value === 'pivot';
    const lastSelect = drillLevelSelects[drillLevelSelects.length - 1];
    addDrillLevelBtn.hidden = noDrill || !lastSelect || !lastSelect.value || drillLevelSelects.length >= MAX_DRILL_LEVELS;
    drillCrossFilterField.hidden = noDrill || !drillLevelSelects[0] || !drillLevelSelects[0].value;
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

  function render(state) {
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
    const existingEls = new Map(
      Array.from(tilesContainer.children).map((el) => [el.dataset.tileId, el])
    );
    const nextIds = new Set(state.tiles.map((t) => t.id));

    for (const [id, el] of existingEls) {
      if (!nextIds.has(id)) {
        GristBI.charts.disposeTile(id);
        el.remove();
        existingEls.delete(id);
      }
    }

    let previousEl = null;
    state.tiles.forEach((tile, index) => {
      let el = existingEls.get(tile.id);
      if (!el) {
        el = buildTileElement(tile);
        existingEls.set(tile.id, el);
      }
      if (previousEl) previousEl.after(el); else tilesContainer.prepend(el);
      previousEl = el;
      // Recalculé à chaque rendu (pas seulement à la création) : la position d'une tuile change
      // quand une autre est ajoutée/supprimée/déplacée autour d'elle.
      const moveLeftBtn = el.querySelector('.tile-move-left');
      const moveRightBtn = el.querySelector('.tile-move-right');
      if (moveLeftBtn) moveLeftBtn.disabled = index === 0;
      if (moveRightBtn) moveRightBtn.disabled = index === state.tiles.length - 1;
      // Badge de compte sur le bouton "Commentaires" : recalculé à chaque rendu (comme
      // moveLeftBtn/moveRightBtn ci-dessus), jamais seulement à la création de la tuile — un
      // commentaire peut être ajouté alors que la tuile est déjà affichée depuis longtemps.
      const commentsCountEl = el.querySelector('.tile-comments-count');
      if (commentsCountEl) {
        const n = GristBI.data.commentsForTile(state.comments, tile.id).length;
        commentsCountEl.hidden = n === 0;
        commentsCountEl.textContent = n > 99 ? '99+' : String(n);
      }
    });

    emptyState.hidden = state.tiles.length > 0;
    // Visible seulement sur la table par défaut (la seule dont on connaît des tuiles toutes
    // faites) ET quand la page courante est réellement vide — pas de sens sur une table choisie
    // manuellement via le sélecteur (voir switchTable : dashboard vide par design dans ce cas).
    restoreDefaultTilesBtn.hidden = state.tiles.length > 0 || currentTableId !== defaultTableId;
    // Temps de rendu affiché dans le bandeau : utile pour repérer à l'œil un ralentissement sur le
    // gros volume de la table de travail par défaut (~47 000 lignes, voir bootstrap() plus bas),
    // sans devoir ouvrir les DevTools à chaque fois.
    const renderStart = performance.now();
    for (const tile of state.tiles) GristBI.charts.renderTile(tile, state, tilesContainer);
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
    renderBookmarks(state.bookmarks);
    rowCountEl.textContent = t('status.rowCount', { n: state.rows.length });

    // `pages`/`currentPageId`/`bookmarks` ne changent de référence/valeur que via leurs actions
    // dédiées (state.js) : un rendu déclenché par un simple rafraîchissement de données (setRows) ne
    // doit pas re-déclencher une écriture dans le document Grist (évite de polluer l'historique à
    // chaque édition externe). Changer de page ne modifie QUE currentPageId (référence de `pages`
    // inchangée) mais mérite quand même d'être sauvegardé, comme la page active dans Power BI.
    if (state.pages !== lastRenderedPages || state.currentPageId !== lastRenderedCurrentPageId ||
        state.bookmarks !== lastRenderedBookmarks || state.blend !== lastRenderedBlend) {
      lastRenderedPages = state.pages;
      lastRenderedCurrentPageId = state.currentPageId;
      lastRenderedBookmarks = state.bookmarks;
      lastRenderedBlend = state.blend;
      scheduleSave(state.pages, state.currentPageId, state.bookmarks, state.blend);
    }
    // Tient la liste du panneau Commentaires à jour s'il est ouvert (ajout d'un commentaire,
    // changement de langue...) sans avoir à le refermer/rouvrir — no-op si fermé
    // (commentsModalTileId à null, voir sa définition).
    renderCommentsModal();
  }

  // Une page ne se supprime jamais toute seule (state.js:removePage refuse de vider la dernière),
  // donc pas besoin de gérer un état "aucune page" ici. Double-clic = renommer (pattern déjà utilisé
  // nulle part ailleurs dans ce fichier mais discoverable, comme un onglet de tableur) ; le bouton
  // de suppression (icône `close`) n'apparaît que sur l'onglet actif pour ne pas encombrer les
  // onglets inactifs, et seulement s'il y a plus d'une page (sinon il ne ferait jamais rien).
  function renderPageTabs(pages, currentPageId) {
    pageTabsEl.innerHTML = pages.map((p) => {
      const active = p.id === currentPageId;
      const removeBtn = active && pages.length > 1
        ? `<span class="page-tab-remove" data-page-id="${escapeHtml(p.id)}" title="${escapeHtml(t('pages.remove.title'))}">${icon('close')}</span>`
        : '';
      return `<button type="button" class="page-tab${active ? ' active' : ''}" data-page-id="${escapeHtml(p.id)}">
        ${escapeHtml(p.name)}${removeBtn}
      </button>`;
    }).join('');
    for (const tab of pageTabsEl.querySelectorAll('.page-tab')) {
      const pageId = tab.dataset.pageId;
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.page-tab-remove')) return; // géré séparément ci-dessous
        store.setCurrentPage(pageId);
      });
      tab.addEventListener('dblclick', () => {
        const page = pages.find((p) => p.id === pageId);
        const name = (prompt(t('pages.rename.prompt'), page ? page.name : '') || '').trim();
        if (name) store.renamePage(pageId, name);
      });
    }
    for (const removeBtn of pageTabsEl.querySelectorAll('.page-tab-remove')) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // ne pas aussi déclencher le clic de l'onglet parent (setCurrentPage, no-op ici)
        const pageId = removeBtn.dataset.pageId;
        const page = pages.find((p) => p.id === pageId);
        if (confirm(t('pages.remove.confirm', { name: page ? page.name : '' }))) {
          store.removePage(pageId);
        }
      });
    }
  }

  // Un badge par filtre actif (plusieurs colonnes peuvent être filtrées en même temps), chacun
  // avec son propre bouton de suppression, + le bouton "Effacer les filtres" global reste utile
  // dès qu'il y en a 2+.
  function renderFilterBadges(activeFilters) {
    filterBadgesEl.innerHTML = activeFilters.map((f) => `
      <span class="filter-chip">
        ${escapeHtml(f.column)} = ${escapeHtml(String(f.value))}
        <button type="button" class="filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="${escapeHtml(t('filters.remove.aria'))}">${icon('close')}</button>
      </span>
    `).join('');
    for (const btn of filterBadgesEl.querySelectorAll('.filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearFilter(btn.dataset.column));
    }
    clearFilterBtn.hidden = activeFilters.length === 0;
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

  // Choisir une vue dans la liste l'applique immédiatement (voir le listener 'change' plus bas) :
  // ce <select> est un menu d'action, pas un indicateur d'état - il ne reflète PAS si les filtres
  // actuels correspondent encore à la vue choisie après coup (simplification délibérée).
  function renderBookmarks(bookmarks) {
    const current = bookmarkSelect.value;
    bookmarkSelect.innerHTML = `<option value="">${escapeHtml(t('bookmarks.placeholder'))}</option>`
      + bookmarks.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
    if (bookmarks.some((b) => b.id === current)) bookmarkSelect.value = current;
    deleteBookmarkBtn.disabled = !bookmarkSelect.value;
  }

  function buildTileElement(tile) {
    const el = document.createElement('div');
    el.className = `tile tile-${tile.type}`;
    el.dataset.tileId = tile.id;
    // data-i18n-aria/-title (en plus du texte déjà traduit ci-dessous) : cette tuile est mise en
    // cache et jamais reconstruite tant qu'elle existe (voir render()), donc un changement de
    // langue seul ne repasserait jamais ici — c'est GristBI.i18n.applyTranslations(), appelé à
    // chaque render(), qui retrouve ces boutons par leurs attributs et les corrige sans
    // reconstruction (voir le commentaire en tête de render()).
    const header = `<div class="tile-header"><span>${escapeHtml(tile.title)}</span>
        <span class="tile-actions">
          <button class="tile-move-left" type="button" data-i18n-aria="tile.moveLeft" data-i18n-title="tile.moveLeft" aria-label="${escapeHtml(t('tile.moveLeft'))}" title="${escapeHtml(t('tile.moveLeft'))}">${icon('chevronLeft')}</button>
          <button class="tile-move-right" type="button" data-i18n-aria="tile.moveRight" data-i18n-title="tile.moveRight" aria-label="${escapeHtml(t('tile.moveRight'))}" title="${escapeHtml(t('tile.moveRight'))}">${icon('chevronRight')}</button>
          <button class="tile-edit" type="button" data-i18n-aria="tile.edit.aria" data-i18n-title="tile.edit.title" aria-label="${escapeHtml(t('tile.edit.aria'))}" title="${escapeHtml(t('tile.edit.title'))}">${icon('edit')}</button>
          <button class="tile-comments" type="button" data-i18n-aria="tile.comments.aria" data-i18n-title="tile.comments.title" aria-label="${escapeHtml(t('tile.comments.aria'))}" title="${escapeHtml(t('tile.comments.title'))}">${icon('comment')}<span class="tile-comments-count" hidden></span></button>
          <button class="tile-remove" type="button" data-i18n-aria="tile.remove.aria" data-i18n-title="tile.remove.title" aria-label="${escapeHtml(t('tile.remove.aria'))}" title="${escapeHtml(t('tile.remove.title'))}">${icon('close')}</button>
        </span></div>`;
    el.innerHTML = tile.type === 'kpi'
      ? `${header}
         <div class="tile-kpi">
           <span class="tile-kpi-value">-</span>
           <span class="tile-kpi-label">${escapeHtml(tile.aggFn)}(${escapeHtml(tile.measure)})</span>
           <span class="tile-kpi-trend" hidden></span>
         </div>`
      : `${header}
         <div class="tile-breadcrumb" data-tile-id="${tile.id}" hidden></div>
         <div class="tile-chart" data-tile-id="${tile.id}"></div>`;
    el.querySelector('.tile-remove').addEventListener('click', () => {
      if (tile.id === editingTileId) stopEditTile(); // formulaire en cours d'édition sur une tuile qui disparaît
      store.removeTile(tile.id);
    });
    el.querySelector('.tile-edit').addEventListener('click', () => startEditTile(tile));
    el.querySelector('.tile-comments').addEventListener('click', () => openCommentsModal(tile));
    el.querySelector('.tile-move-left').addEventListener('click', () => store.moveTile(tile.id, -1));
    el.querySelector('.tile-move-right').addEventListener('click', () => store.moveTile(tile.id, 1));
    return el;
  }

  // Clé localStorage dédiée (même garde `typeof localStorage !== 'undefined'` + repli silencieux
  // que GristBI.i18n pour `gristbi_lang`, voir js/i18n.js) : le nom saisi une fois est mémorisé
  // d'une session à l'autre, comme la langue — pas la peine de le retaper à chaque commentaire.
  function loadSavedCommentAuthor() {
    if (typeof localStorage === 'undefined') return '';
    try { return localStorage.getItem('gristbi_comment_author') || ''; } catch (e) { return ''; }
  }
  function saveCommentAuthor(author) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem('gristbi_comment_author', author); } catch (e) { /* stockage indisponible - sans conséquence, juste à retaper la prochaine fois */ }
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
    commentsModalTileEl.textContent = tile.title;
    commentAuthorInput.value = loadSavedCommentAuthor();
    commentTextInput.value = '';
    renderCommentsModal();
    commentsModal.hidden = false;
    commentTextInput.focus();
  }

  function closeCommentsModal() {
    commentsModal.hidden = true;
    commentsModalTileId = null;
  }

  function updateFormFieldsForType() {
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    const isBar = type === 'bar';
    const hasMeasureMode = isBar && measureModeSelect.value && measureModeSelect.value !== 'brut';
    const isPivot = type === 'pivot';
    // KPI/jauge/tuile "Barres" en mode de calcul temporel : pas de dimension de regroupement ni de
    // drill-down, juste un agrégat sur toute la sélection (le KPI peut en plus le comparer à une
    // période via "Tendance vs", la jauge le positionne sur un cadran Min/Max, la tuile Barres en
    // mode mesure affiche l'évolution mensuelle de `tile-date-column`). Le nuage de points ajoute
    // une 2e mesure (axe Y). Le pivot ajoute une 2e dimension (colonnes) et n'a pas de drill-down
    // (voir supportsDrillDown).
    dimensionField.hidden = formHasNoDimension();
    dimensionLabel.textContent = t(isPivot ? 'tileForm.dimension.labelRows' : 'tileForm.dimension.label');
    columnDimensionField.hidden = !isPivot;
    drillField.hidden = formHasNoDimension() || isPivot;
    trendField.hidden = !isKpi;
    gaugeMinField.hidden = !isGauge;
    gaugeMaxField.hidden = !isGauge;
    measureModeField.hidden = !isBar;
    dateColumnField.hidden = !hasMeasureMode;
    measureYField.hidden = !isScatter;
    measureLabel.textContent = t(isScatter ? 'tileForm.measure.labelX' : 'tileForm.measure.label');
    updateDrillLevelsUI();
    updateSuggestDateHierarchyVisibility();
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

  function startEditTile(tile) {
    editingTileId = tile.id;
    tileTypeSelect.value = tile.type;
    if (tile.dimension) dimensionSelect.value = tile.dimension;
    setDrillLevels(tileDrillLevels(tile));
    drillCrossFilterCheckbox.checked = !!tile.drillCrossFilter;
    columnDimensionSelect.value = tile.columnDimension || '';
    measureYSelect.value = tile.measureY || '';
    gaugeMinInput.value = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    gaugeMaxInput.value = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : 100;
    // Avant updateFormFieldsForType() : elle lit measureModeSelect.value pour décider de la
    // visibilité de dimensionField/drillField/dateColumnField (voir formHasNoDimension).
    measureModeSelect.value = tile.measureMode || 'brut';
    dateColumnSelect.value = tile.dateColumn || '';
    updateFormFieldsForType();
    measureSelect.value = tile.measure;
    aggSelect.value = tile.aggFn;
    trendDimensionSelect.value = tile.trendDimension || '';
    submitTileBtn.textContent = t('tileForm.submit.edit');
    cancelEditBtn.hidden = false;
    addTileForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function stopEditTile() {
    editingTileId = null;
    submitTileBtn.textContent = t('tileForm.submit.add');
    cancelEditBtn.hidden = true;
  }

  tileTypeSelect.addEventListener('change', updateFormFieldsForType);
  measureModeSelect.addEventListener('change', updateFormFieldsForType);
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

  addTileForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    const isBar = type === 'bar';
    const measureMode = (isBar && measureModeSelect.value && measureModeSelect.value !== 'brut') ? measureModeSelect.value : undefined;
    const dateColumn = measureMode ? dateColumnSelect.value : '';
    const isPivot = type === 'pivot';
    const hasDimension = !formHasNoDimension();
    const dimension = dimensionSelect.value;
    const columnDimension = columnDimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    if (!measure || (hasDimension && !dimension)) return;
    if (isScatter && !measureYSelect.value) return; // 2e mesure obligatoire pour un nuage de points
    if (measureMode && !dateColumn) { alert(t('tileForm.alert.dateColumnRequired')); return; }
    if (isPivot && !columnDimension) return; // 2e dimension obligatoire pour un tableau croisé
    if (isPivot && columnDimension === dimension) {
      alert(t('tileForm.alert.pivotDimsDiffer'));
      return;
    }
    let gaugeMin, gaugeMax;
    if (isGauge) {
      gaugeMin = parseFloat(gaugeMinInput.value);
      gaugeMax = parseFloat(gaugeMaxInput.value);
      if (!Number.isFinite(gaugeMin) || !Number.isFinite(gaugeMax) || gaugeMax <= gaugeMin) {
        alert(t('tileForm.alert.gaugeMinMax'));
        return;
      }
    }
    const drillDimensions = supportsDrillDown(type) ? drillLevelSelects.map((s) => s.value).filter(Boolean) : [];
    // Garde-fou : une même colonne ne peut pas apparaître deux fois dans le chemin de drill (ni
    // reprendre la dimension racine) — un cas non gardé auparavant, repéré en généralisant à N
    // niveaux (voir ROADMAP.md, cluster "Hiérarchies & drill-down").
    const allDims = hasDimension ? [dimension].concat(drillDimensions) : [];
    if (new Set(allDims).size !== allDims.length) {
      alert(t('tileForm.alert.drillDuplicate'));
      return;
    }
    const title = isPivot ? `${measure} par ${dimension} × ${columnDimension}`
      : hasDimension ? `${measure} par ${dimension}`
      : measureMode ? `${MEASURE_MODE_TITLES[measureMode]} : ${aggFn}(${measure})`
      : `${aggFn}(${measure})`;
    const tileData = { type, dimension, measure, aggFn, title };
    // Champs spécifiques à un type explicitement mis à `undefined` quand non pertinents (plutôt que
    // simplement omis) : `store.updateTile` fusionne le patch via Object.assign, qui ne fait QUE
    // écraser les clés présentes dans l'objet — omettre une clé laisserait une ancienne valeur
    // fantôme sur la tuile éditée (ex. un drill-down retiré via le formulaire resterait actif en
    // pratique) ; l'inclure avec `undefined` l'efface bien.
    tileData.drillDimensions = drillDimensions.length ? drillDimensions : undefined;
    tileData.drillCrossFilter = drillDimensions.length ? drillCrossFilterCheckbox.checked : undefined;
    tileData.trendDimension = (isKpi && trendDimensionSelect.value) ? trendDimensionSelect.value : undefined;
    tileData.measureY = isScatter ? measureYSelect.value : undefined;
    tileData.gaugeMin = isGauge ? gaugeMin : undefined;
    tileData.gaugeMax = isGauge ? gaugeMax : undefined;
    tileData.measureMode = measureMode;
    tileData.dateColumn = measureMode ? dateColumn : undefined;
    tileData.columnDimension = isPivot ? columnDimension : undefined;
    if (editingTileId) {
      store.updateTile(editingTileId, tileData);
      stopEditTile();
    } else {
      tileData.id = 'tile_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      store.addTile(tileData);
    }
  });

  cancelEditBtn.addEventListener('click', stopEditTile);

  // Appelées SANS argument (via une flèche plutôt qu'en passant la fonction directement en callback)
  // : un `addEventListener` passe l'Event en 1er argument, qui satisferait silencieusement le
  // paramètre optionnel `rows` de `updateAdvancedFilterFieldsForColumn` à sa place (`rows` vaudrait
  // l'Event, pas les lignes) — `distinctColumnValues` plante alors sur un Event non itérable [BUG
  // RÉEL trouvé en testant l'autocomplétion des valeurs, voir HYPOTHESES.md/TEST_PROTOCOL.md].
  filterColumnSelect.addEventListener('change', () => updateAdvancedFilterFieldsForColumn());
  filterDateModeSelect.addEventListener('change', () => updateAdvancedFilterFieldsForColumn());

  advancedFilterForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const column = filterColumnSelect.value;
    if (!column) return;
    const kind = inferColumnKind(column);
    let filter;
    if (kind === 'number') {
      const min = filterMinInput.value === '' ? null : parseFloat(filterMinInput.value);
      const max = filterMaxInput.value === '' ? null : parseFloat(filterMaxInput.value);
      if (min == null && max == null) { alert(t('filters.minBoundRequired')); return; }
      if (min != null && max != null && max < min) { alert(t('filters.maxGteMin')); return; }
      filter = { type: 'range', min, max };
    } else if (kind === 'date') {
      if (filterDateModeSelect.value === 'relativeDate') {
        filter = { type: 'relativeDate', preset: filterRelativePresetSelect.value };
      } else {
        const start = filterDateStartInput.value || null;
        const end = filterDateEndInput.value || null;
        if (!start && !end) { alert(t('filters.dateBoundRequired')); return; }
        if (start && end && end < start) { alert(t('filters.endAfterStart')); return; }
        filter = { type: 'dateRange', start, end };
      }
    } else {
      const query = filterTextInput.value.trim();
      if (!query) { alert(t('filters.textRequired')); return; }
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
  });

  bookmarkSelect.addEventListener('change', () => {
    deleteBookmarkBtn.disabled = !bookmarkSelect.value;
    if (bookmarkSelect.value) store.applyBookmark(bookmarkSelect.value);
  });

  deleteBookmarkBtn.addEventListener('click', () => {
    if (bookmarkSelect.value) store.removeBookmark(bookmarkSelect.value);
  });

  saveBookmarkBtn.addEventListener('click', () => {
    const name = (prompt(t('bookmarks.save.prompt')) || '').trim();
    if (!name) return; // annulé ou vide
    store.saveBookmark('bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name);
  });

  // Une feuille par tuile, toutes pages confondues (voir GristBI.data.buildWorkbookSheets) — les
  // données déjà agrégées/filtrées EXACTEMENT comme à l'écran (rowsForTile est la même fonction que
  // charts.js). Jamais vérifié en conditions réelles Grist que le téléchargement se déclenche bien
  // depuis l'iframe du widget (voir HYPOTHESES.md) — fonctionne dans ce harness et un navigateur
  // standard, l'iframe n'étant pas sandboxée (voir ROADMAP.md).
  exportExcelBtn.addEventListener('click', () => {
    try {
      const exported = GristBI.exportExcel.exportDashboardToExcel(store.getState());
      if (!exported) alert(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export Excel', e);
      alert(t('export.failed'));
    }
  });

  // Seulement la page actuellement affichée (voir js/pdf-export.js), pas toutes les pages comme
  // l'export Excel — chaque graphique capturé est celui déjà rendu de CETTE page. pdfmake est
  // chargé depuis un CDN externe (dérogation d'Antoine, voir CLAUDE.md) : un échec réseau doit être
  // clairement dit à l'utilisateur plutôt que de rester silencieux ou de casser la page.
  exportPdfBtn.addEventListener('click', async () => {
    try {
      const exported = await GristBI.exportPdf.exportDashboardToPdf(store.getState());
      if (!exported) alert(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export PDF', e);
      alert(t('export.pdf.networkError'));
    }
  });

  // Même raisonnement que l'export PDF ci-dessus, pour PptxGenJS (js/pptx-export.js).
  exportPptxBtn.addEventListener('click', async () => {
    try {
      const exported = await GristBI.exportPptx.exportDashboardToPptx(store.getState());
      if (!exported) alert(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export PPTX', e);
      alert(t('export.pptx.networkError'));
    }
  });

  addPageBtn.addEventListener('click', () => {
    const name = (prompt(t('pages.new.prompt'), `Page ${store.getState().pages.length + 1}`) || '').trim();
    if (name) store.addPage(name);
  });

  clearFilterBtn.addEventListener('click', () => store.clearFilter());

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

  // Ajout d'un commentaire : AddRecord côté Grist (js/grist-api.js:addComment), puis ajout
  // optimiste côté store (pas de re-fetch de toute la table) — la liste affichée se remet à jour
  // via renderCommentsModal(), appelée depuis render() (voir plus haut) puisque addCommentLocal
  // déclenche notify(). Le nom est mémorisé pour la prochaine fois, le texte est vidé mais le
  // panneau reste ouvert (plusieurs commentaires à la suite sans le rouvrir).
  if (commentForm) {
    commentForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      if (!commentsModalTileId) return;
      const author = commentAuthorInput.value.trim();
      const text = commentTextInput.value.trim();
      if (!author || !text) return;
      saveCommentAuthor(author);
      try {
        const comment = await GristBI.api.addComment(currentTableId, commentsModalTileId, author, text);
        store.addCommentLocal(comment);
        commentTextInput.value = '';
        commentTextInput.focus();
      } catch (e) {
        console.error('[GristBI] échec de l\'ajout du commentaire', e);
        alert(t('comments.addFailed'));
      }
    });
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
  // réel trouvé en testant le sélecteur de table — voir flushPendingSave()/HYPOTHESES.md).
  function scheduleSave(pages, currentPageId, bookmarks, blend) {
    if (!currentTableId) return;
    clearTimeout(saveTimer);
    pendingSave = { tableId: currentTableId, pages, currentPageId, bookmarks, blend };
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const p = pendingSave;
      pendingSave = null;
      GristBI.api.saveConfig(p.tableId, p.pages, p.currentPageId, p.bookmarks, p.blend).catch((e) => {
        console.error('[GristBI] échec de sauvegarde de la config', e);
      });
    }, 600);
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
    return GristBI.api.saveConfig(p.tableId, p.pages, p.currentPageId, p.bookmarks, p.blend).catch((e) => {
      console.error('[GristBI] échec de sauvegarde de la config', e);
    });
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
      alert(t('blend.failed', { table: blend.secondaryTableId }));
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
    }
  }

  // Bascule l'affichage sur `tableId`/`rows`. `seedTiles()` ne sert que si aucune config n'a
  // jamais été sauvegardée pour cette table. Met TOUJOURS à jour `currentPrimaryRows` (même hors
  // changement de table : un futur rafraîchissement de la même table doit rejoindre les lignes
  // FRAÎCHES, pas rejouer la jointure sur un instantané périmé) puis délègue à `applyBlend` le
  // rafraîchissement des sélecteurs de colonne et `store.setRows` — jamais fait ici directement,
  // pour ne pas contourner la jointure en cours.
  async function switchTable(tableId, rows, { seedTiles } = {}) {
    await flushPendingSave();
    const isNewTable = tableId !== currentTableId;
    currentTableId = tableId;
    currentPrimaryRows = rows;
    if (isNewTable) {
      store.clearFilter();
      store.clearAdvancedFilter();
      if (editingTileId) stopEditTile(); // le formulaire en cours d'édition référence une tuile de l'ancienne table
      const saved = await GristBI.api.loadConfig(tableId);
      const hasAnyTile = saved.pages.some((p) => p.tiles.length > 0);
      if (!hasAnyTile && seedTiles) {
        store.setPages([{ id: GristBI.state.DEFAULT_PAGE_ID, name: 'Page 1', tiles: seedTiles() }], GristBI.state.DEFAULT_PAGE_ID);
      } else {
        store.setPages(saved.pages, saved.currentPageId);
      }
      store.setBookmarks(saved.bookmarks);
      currentBlend = saved.blend;
      store.setBlend(currentBlend);
      refreshBlendPicker();
    }
    await applyBlend(currentBlend);
  }

  store.subscribe(render);

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

  blendSecondaryTableInput.addEventListener('change', () => {
    // Changer de table secondaire invalide les clés déjà choisies (colonnes d'une autre table) :
    // on ne garde QUE la clé côté table principale, jamais la clé secondaire de l'ancien choix.
    blendSecondaryColumnInput.value = '';
    refreshBlendSecondaryColumnPicker().then(commitBlendFromForm);
  });
  blendPrimaryColumnInput.addEventListener('change', commitBlendFromForm);
  blendSecondaryColumnInput.addEventListener('change', commitBlendFromForm);

  // Se sortir seul d'un dashboard vide sur la table par défaut (ex. une config sauvegardée vide),
  // sans avoir à reconstruire les tuiles à la main ni à aller manipuler la table de config interne
  // dans Grist — demande explicite de l'utilisateur. N'ajoute qu'à la page COURANTE (`addTile`, pas
  // `setPages`) : ne touche jamais aux autres pages d'un dashboard multi-pages.
  restoreDefaultTilesBtn.addEventListener('click', () => {
    GristBI.demoData.defaultLargeTiles().forEach((tile) => store.addTile(tile));
  });

  // Reconnexion à une AUTRE table du document, choisie via le sélecteur (demande explicite de
  // l'utilisateur : pas seulement la table de test de charge par défaut). Contrairement au
  // chargement de démarrage, ne crée/ne remplit jamais rien (`GristBI.api.loadTable`, la table
  // choisie existe forcément déjà — elle vient de `listAvailableTables`) et ne préconfigure aucune
  // tuile (`seedTiles` omis) : une table quelconque du document démarre sur un dashboard VIDE à
  // construire soi-même, contrairement à `BI_StressTest` qui a ses 4 tuiles de démonstration.
  tableSelectInput.addEventListener('change', async () => {
    const tableId = tableSelectInput.value;
    if (!tableId) return;
    try {
      const { rows } = await GristBI.api.loadTable(tableId);
      await switchTable(tableId, rows);
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec de la connexion à la table choisie', e);
      alert(t('table.connectFailed', { table: tableId }));
      tableSelectInput.value = currentTableId; // revient sur la table encore effectivement active
    }
  });

  // Connexion automatique, au chargement, à la table de test de charge (~47 000 lignes) : c'est
  // désormais LA table de travail par défaut du widget, plus besoin de cliquer sur un bouton pour
  // avoir un dashboard à tester. Idempotent côté grist-api.js (loadOrCreateStressData) : ne
  // recrée/renvoie les lignes que si la table n'existe pas encore dans le document, sinon se
  // contente de la relire (quasi instantané). Si le schéma doit un jour se complexifier (colonnes
  // en plus), `ensureColumnsUpToDate` (js/grist-api.js) ajoute la colonne manquante à la table déjà
  // présente et remplit les lignes déjà là — jamais une nouvelle table à recréer. L'utilisateur peut
  // ensuite se reconnecter à N'IMPORTE QUELLE AUTRE table du document via le sélecteur ci-dessus.
  async function bootstrap() {
    await GristBI.api.init();
    rowCountEl.textContent = t('status.connecting');
    const onProgress = (phase, sent, total) => {
      const pct = Math.round((sent / total) * 100);
      const label = t(phase === 'migrate' ? 'status.migrating' : 'status.creating');
      const locale = GristBI.i18n.getLang() === 'en' ? 'en-US' : 'fr-FR';
      rowCountEl.textContent = t('status.progress', { label, pct, sent: sent.toLocaleString(locale), total: total.toLocaleString(locale) });
    };
    try {
      const { tableId, rows, created } = await GristBI.api.loadOrCreateStressData(onProgress);
      console.log(`[GristBI] ${tableId} ${created ? 'créée' : 'déjà présente, réutilisée telle quelle'} (${rows.length} lignes).`);
      defaultTableId = tableId;
      await switchTable(tableId, rows, { seedTiles: GristBI.demoData.defaultLargeTiles });
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec de la connexion automatique au jeu de données de test de charge', e);
      rowCountEl.textContent = t('status.connectionFailed');
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
    submitTileBtn.textContent = t(editingTileId ? 'tileForm.submit.edit' : 'tileForm.submit.add');
    render(store.getState());
  });
  refreshLangRadios();

  bootstrap();
})();
