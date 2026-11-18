/*
 * Bootstrap de l'UI — formulaire de tuile : champs affichés selon le type, lecture et validation (`readTileForm`),
 * modification d'une tuile, envoi. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { tileDrillLevels } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    addTileForm, aggField, aggLabel, aggSelect, aggSizeField, aggSizeSelect, aggYField, aggYSelect, areaCheckbox,
    areaField, autoTileTitle, availableColumns, binsField, binsInput, cancelEditBtn, columnDimensionField,
    columnDimensionLabel, columnDimensionSelect, comboModeField, comboModeSelect, createDrillLevelSelect,
    createRadarAxisSelect, dateColumnField, dateColumnSelect, dimensionField, dimensionLabel, dimensionSelect,
    donutCheckbox, donutField, drillCrossFilterCheckbox, drillField, drillLabel, drillLevelsContainer, endColumnField,
    endColumnSelect, fillCombobox, formHasNoDimension, gaugeMaxField, gaugeMaxInput, gaugeMinField, gaugeMinInput,
    genTileId, goodPctInput, horizontalCheckbox, horizontalField, inferColumnKind, isRadarColumnsMode,
    isWordCloudSplitMode, lineShapeField, lineShapeSelect, measureField, measureLabel, measureModeField,
    measureModeSelect, measureSelect, measureSizeField, measureSizeSelect, measureYField, measureYLabel,
    measureYSelect, numFmtField, numberFormatFromForm, numericColumns, paletteField, paletteSelect, pivotHeatCheckbox,
    pivotHeatField, radarAxesContainer, radarAxesField, radarCompareAverageCheckbox, radarCompareAverageField,
    radarEntityColumnField, radarEntityColumnSelect, radarEntityValueField, radarEntityValueSelect, radarModeField,
    radarModeSelect, readColumnsOrder, readColumnsPicker, refLineField, refLineSelect, refValueField, refValueInput,
    renderColumnsPicker, resetDrillLevels, resetRadarAxes, seriesField, seriesLabel, seriesSelect, setColumnsPicker,
    setNumberFormatForm, showPctCheckbox, showPctField, smallMultiplesCheckbox, smallMultiplesField, sortField,
    sortSelect, sparklineCheckbox, sparklineField, stackField, stackPercentCheckbox, stackPercentField,
    stackedCheckbox, startColumnField, startColumnSelect, store, suggestDateHierarchyBtn, supportsLevels,
    targetColumnField, targetColumnSelect, targetField, targetInput, thresholdsField, tileColumnsField,
    tileColumnsList, tileTextField, tileTextInput, tileTitleInput, tileTypeSelect, trendDimensionSelect, trendField,
    updateDrillLevelsUI, updateNumberFormatUI, updatePaletteSwatch, updateRadarAxesUI, updateRadarEntityValueOptions,
    updateSuggestDateHierarchyVisibility, valueLabelsCheckbox, valueLabelsField, warnPctInput, wordCloudSplitCheckbox,
    wordCloudSplitField
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const closeTilePanel = (...args) => parts.closeTilePanel(...args);
  const flashTile = (...args) => parts.flashTile(...args);
  const openTilePanel = (...args) => parts.openTilePanel(...args);
  const schedulePreview = (...args) => parts.schedulePreview(...args);
  const updateAdvancedVisibility = (...args) => parts.updateAdvancedVisibility(...args);
  const updatePanelTexts = (...args) => parts.updatePanelTexts(...args);
  Object.assign(parts, {
    bindFormSubmit, clearFormErrors, readTileForm, setDrillLevels, setRadarAxes, showFormErrors, startEditTile,
    stopEditTile, updateFormFieldsForType
  });

  S.editingTileId = null;

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
      if (i >= S.drillLevelSelects.length) {
        const select = createDrillLevelSelect(i);
        fillCombobox(select, cols, { blankLabel: t('tileForm.none.m') });
        drillLevelsContainer.appendChild(select.parentElement);
        S.drillLevelSelects.push(select);
      }
      S.drillLevelSelects[i].value = lvl;
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
      if (i >= S.radarAxisSelects.length) {
        const select = createRadarAxisSelect(i);
        fillCombobox(select, cols);
        radarAxesContainer.appendChild(select.parentElement);
        S.radarAxisSelects.push(select);
      }
      S.radarAxisSelects[i].value = col;
    });
    updateRadarAxesUI();
  }

  function startEditTile(tile) {
    S.editingTileId = tile.id;
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
    S.editingTileId = null;
    updatePanelTexts();
  }

  tileTypeSelect.addEventListener('change', updateFormFieldsForType);

  measureModeSelect.addEventListener('change', updateFormFieldsForType);

  // La case « Empilé » dépend de la colonne Séries et, pour une courbe, de la case Aire.
  seriesSelect.addEventListener('change', updateFormFieldsForType);

  measureSizeSelect.addEventListener('change', updateFormFieldsForType);
 // l'agrégat de la taille n'apparaît qu'avec une colonne de taille
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
    const radarAxes = isRadarColumns ? S.radarAxisSelects.map((s) => s.value).filter(Boolean) : [];
    if (isRadarColumns && !radarAxes.length) fail('tile-radar-axis-1', 'tileForm.error.radarAxisRequired'); // au moins un axe requis
    else if (isRadarColumns && new Set(radarAxes).size !== radarAxes.length) fail('tile-radar-axis-1', 'tileForm.alert.radarAxesDuplicate');
    let gaugeMin, gaugeMax;
    if (isGauge) {
      gaugeMin = parseFloat(gaugeMinInput.value);
      gaugeMax = parseFloat(gaugeMaxInput.value);
      if (!Number.isFinite(gaugeMin) || !Number.isFinite(gaugeMax) || gaugeMax <= gaugeMin) fail('tile-gauge-max', 'tileForm.alert.gaugeMinMax');
    }
    const drillDimensions = (supportsLevels(type) && !isWordCloudSplit) ? S.drillLevelSelects.map((s) => s.value).filter(Boolean) : [];
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
  S.submitAttempted = false;

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
    S.submitAttempted = true;
    const { tileData, errors } = readTileForm();
    if (errors.length) { showFormErrors(errors, true); return; }
    clearFormErrors();
    let savedId;
    if (S.editingTileId) {
      savedId = S.editingTileId;
      store.updateTile(S.editingTileId, tileData);
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
})(window);
