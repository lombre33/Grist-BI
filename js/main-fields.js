/*
 * Bootstrap de l'UI — champs du formulaire de tuile : listes de colonnes, niveaux de drill-down, axes de radar,
 * format des nombres, colonnes d'une table plate, titre automatique. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { escapeHtml } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    addDrillLevelBtn, addRadarAxisBtn, aggSelect, columnDimensionSelect, dateColumnSelect, dimensionSelect,
    drillCrossFilterCheckbox, drillCrossFilterField, drillLevelsContainer, endColumnSelect, measureModeSelect,
    measureSelect, measureSizeSelect, measureYSelect, numFmtCompact, numFmtCustom, numFmtDecimals, numFmtHint,
    numFmtSelect, paletteHint, paletteSelect, paletteSwatch, pivotHeatCheckbox, radarAxesContainer,
    radarEntityColumnSelect, radarEntityValueSelect, radarModeSelect, seriesSelect, startColumnSelect, store,
    suggestDateHierarchyBtn, targetColumnSelect, tileColumnsList, tileTypeSelect, trendDimensionSelect,
    wordCloudSplitCheckbox
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const renderFilterColumns = (...args) => parts.renderFilterColumns(...args);
  const updateAdvancedFilterFieldsForColumn = (...args) => parts.updateAdvancedFilterFieldsForColumn(...args);
  Object.assign(parts, {
    autoTileTitle, availableColumns, blendJoinColumns, createDrillLevelSelect, createRadarAxisSelect, fillCombobox,
    formHasNoDimension, genTileId, inferColumnKind, isRadarColumnsMode, isWordCloudSplitMode, numberFormatFromForm,
    numericColumns, readColumnsOrder, readColumnsPicker, refreshColumnSelects, renderColumnsPicker, resetDrillLevels,
    resetRadarAxes, setColumnsPicker, setNumberFormatForm, showError, showNotice, supportsLevels, updateDrillLevelsUI,
    updateNumberFormatUI, updatePaletteSwatch, updateRadarAxesUI, updateRadarEntityValueOptions,
    updateSuggestDateHierarchyVisibility, withDateHierarchies
  });
 // id de la tuile en cours d'édition via le formulaire, ou null (mode ajout)
  // <select> de niveaux de drill-down actuellement affichés dans le formulaire, un par niveau
  // AU-DELÀ de la dimension racine (index 0 = niveau 1, etc.) — voir gestion plus bas.
  S.drillLevelSelects = [];

  // Garde-fou d'ergonomie (pas une limite technique : data.js/state.js/charts.js gèrent un nombre
  // de niveaux arbitraire) : au-delà, une tuile chaînant trop de niveaux sur un jeu de données trop
  // petit produit des paliers de drill quasi vides, voir ROADMAP.md.
  const MAX_DRILL_LEVELS = 5;

  // <select> d'axes du radar en mode "compétences en colonnes" (tile-radar-mode = 'columns', voir
  // ROADMAP.md : demande du forum Grist, un radar à partir de plusieurs colonnes numériques plutôt
  // que d'une seule dimension catégorielle) — même pattern dynamique que drillLevelSelects
  // ci-dessus ("+ Axe" plutôt que des champs figés), un axe = une colonne numérique.
  S.radarAxisSelects = [];

  // Garde-fou d'ergonomie, même raison que MAX_DRILL_LEVELS : au-delà, un radar devient illisible.
  const MAX_RADAR_AXES = 8;

  // Tous les champs qui référencent une COLONNE deviennent des comboboxes avec autocomplétion
  // (demande explicite de l'utilisateur, voir js/combobox.js) — en mode strict : la valeur doit
  // rester l'une des colonnes réellement chargées, comme un <select>. `.nextElementSibling` est le
  // <ul class="combobox-list"> voisin dans le même wrapper `.combobox` (voir index.html/harness.html).
  [dimensionSelect, columnDimensionSelect, startColumnSelect, endColumnSelect, seriesSelect, measureSelect, measureYSelect, measureSizeSelect, trendDimensionSelect, dateColumnSelect,
   radarEntityColumnSelect, radarEntityValueSelect, targetColumnSelect].forEach((input) => {
    GristBI.combobox.attach(input, input.nextElementSibling, { strict: true });
  });

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
    S.drillLevelSelects.forEach((select) => fillCombobox(select, cols, { blankLabel: t('tileForm.none.m') }));
    const numCols = numericColumns(rows);
    S.radarAxisSelects.forEach((select) => fillCombobox(select, numCols));
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
    while (S.drillLevelSelects.length > index + 1) {
      S.drillLevelSelects.pop().parentElement.remove(); // retire le wrapper .combobox entier, pas juste l'input
    }
  }

  // Réaffiche le bouton "+ Niveau" seulement si le dernier niveau visible est rempli (progression
  // séquentielle, comme l'ancien niveau 2 qui n'apparaissait qu'une fois le niveau 1 choisi) et que
  // le plafond n'est pas atteint ; recalcule aussi la visibilité de la case cross-filter.
  function updateDrillLevelsUI() {
    const noDrill = formHasNoDimension() || !supportsLevels(tileTypeSelect.value);
    const lastSelect = S.drillLevelSelects[S.drillLevelSelects.length - 1];
    addDrillLevelBtn.hidden = noDrill || !lastSelect || !lastSelect.value || S.drillLevelSelects.length >= (tileTypeSelect.value === 'sunburst' ? GristBI.data.SUNBURST_MAX_LEVELS - 1 : MAX_DRILL_LEVELS);
    drillCrossFilterField.hidden = noDrill || tileTypeSelect.value === 'sunburst' || !S.drillLevelSelects[0] || !S.drillLevelSelects[0].value;
  }

  addDrillLevelBtn.addEventListener('click', () => {
    if (S.drillLevelSelects.length >= MAX_DRILL_LEVELS) return;
    const select = createDrillLevelSelect(S.drillLevelSelects.length);
    fillCombobox(select, availableColumns(store.getState().rows), { blankLabel: t('tileForm.none.m') });
    drillLevelsContainer.appendChild(select.parentElement);
    S.drillLevelSelects.push(select);
    updateDrillLevelsUI();
  });

  // Vide le formulaire de tous ses niveaux de drill sauf le premier (toujours présent).
  function resetDrillLevels() {
    truncateDrillLevelsAfter(0);
    if (S.drillLevelSelects[0]) S.drillLevelSelects[0].value = '';
  }

  // Niveau 1 toujours présent dans le formulaire (comme avant), les suivants sont ajoutés
  // dynamiquement au clic sur "+ Niveau" ou lors du préremplissage en édition.
  (function initFirstDrillLevel() {
    const select = createDrillLevelSelect(0);
    drillLevelsContainer.appendChild(select.parentElement);
    S.drillLevelSelects.push(select);
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
    while (S.radarAxisSelects.length > index + 1) {
      S.radarAxisSelects.pop().parentElement.remove();
    }
  }

  // Réaffiche "+ Axe" seulement si le dernier axe visible est rempli et que le plafond n'est pas
  // atteint — même logique que updateDrillLevelsUI.
  function updateRadarAxesUI() {
    const isRadarColumns = tileTypeSelect.value === 'radar' && radarModeSelect.value === 'columns';
    const lastSelect = S.radarAxisSelects[S.radarAxisSelects.length - 1];
    addRadarAxisBtn.hidden = !isRadarColumns || !lastSelect || !lastSelect.value || S.radarAxisSelects.length >= MAX_RADAR_AXES;
  }

  addRadarAxisBtn.addEventListener('click', () => {
    if (S.radarAxisSelects.length >= MAX_RADAR_AXES) return;
    const select = createRadarAxisSelect(S.radarAxisSelects.length);
    fillCombobox(select, numericColumns(store.getState().rows));
    radarAxesContainer.appendChild(select.parentElement);
    S.radarAxisSelects.push(select);
    updateRadarAxesUI();
  });

  // Vide le formulaire de tous ses axes sauf le premier (toujours présent) — même rôle que
  // resetDrillLevels.
  function resetRadarAxes() {
    truncateRadarAxesAfter(0);
    if (S.radarAxisSelects[0]) S.radarAxisSelects[0].value = '';
  }

  // Axe 1 toujours présent dans le formulaire, comme le niveau 1 de drill-down — les suivants sont
  // ajoutés dynamiquement au clic sur "+ Axe" ou lors du préremplissage en édition.
  (function initFirstRadarAxis() {
    const select = createRadarAxisSelect(0);
    radarAxesContainer.appendChild(select.parentElement);
    S.radarAxisSelects.push(select);
  })();

  // id de tuile unique parmi celles créées dans la même milliseconde (ex. import Power BI en lot,
  // voir handlePbixImportCreate plus bas) : l'horodatage seul ne suffit pas dans ce cas, `suffix`
  // (index dans le lot) lève l'ambiguïté avant même la part aléatoire.
  function genTileId(suffix) {
    return 'tile_' + Date.now().toString(36) + (suffix != null ? '_' + suffix : '') + Math.random().toString(36).slice(2, 6);
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
      const decimalsChoice = numFmtDecimals.value;
      return { mode: 'custom', decimals: decimalsChoice === 'auto' ? 'auto' : Number(decimalsChoice), notation: numFmtCompact.checked ? 'compact' : 'standard' };
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
      GristBI.safeHtml.setHtml(li, `<label><input type="checkbox"> <span></span></label>`
        + `<button type="button" class="col-move" data-dir="-1" aria-label="${escapeHtml(t('tileForm.columns.up', { column: col }))}">▲</button>`
        + `<button type="button" class="col-move" data-dir="1" aria-label="${escapeHtml(t('tileForm.columns.down', { column: col }))}">▼</button>`);
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
    const tableDefaults = GristBI.advice ? GristBI.advice.defaultsForType('table', [], cols) : null;
    return tableDefaults && tableDefaults.columns ? tableDefaults.columns : cols.slice(0, 6);
  }

  // Changement de table/de lignes : garde les cases cochées qui existent encore, sinon recoche les premières.
  function refreshColumnsPicker(cols) {
    const keep = readColumnsPicker().filter((c) => cols.includes(c));
    const order = readColumnsOrder().filter((c) => cols.includes(c));
    if (!keep.length && !order.length) { setColumnsPicker(defaultTableColumns(cols), cols); return; }
    const rest = cols.filter((c) => !order.includes(c));
    renderColumnsPicker(order.concat(rest), new Set(keep));
  }
})(window);
