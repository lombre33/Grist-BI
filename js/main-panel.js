/*
 * Bootstrap de l'UI — panneau « Ajouter une visualisation » : choix du type, réglages, aperçu vivant, conseil. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { escapeHtml } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    addTileForm, addTileOpenBtn, advancedDetailsEl, aggSelect, aggSizeSelect, aggYSelect, areaCheckbox,
    availableColumns, binsInput, chooseStepEl, clearFormErrors, columnDimensionSelect, comboModeSelect,
    configureStepEl, dateColumnSelect, dimensionSelect, donutCheckbox, drillCrossFilterCheckbox, endColumnSelect,
    gaugeMaxInput, gaugeMinInput, goodPctInput, horizontalCheckbox, icon, lineShapeSelect, measureModeSelect,
    measureSelect, measureSizeSelect, measureYSelect, paletteSelect, panelBackBtn, pivotHeatCheckbox,
    radarCompareAverageCheckbox, radarEntityColumnSelect, radarEntityValueSelect, radarModeSelect, readTileForm,
    refLineSelect, refValueInput, resetDrillLevels, resetRadarAxes, seriesSelect, setColumnsPicker, setDrillLevels,
    setNumberFormatForm, setRadarAxes, showFormErrors, showPctCheckbox, smallMultiplesCheckbox, sortSelect,
    sparklineCheckbox, stackPercentCheckbox, stackedCheckbox, startColumnSelect, stopEditTile, store, submitTileBtn,
    targetColumnSelect, targetInput, tileAdviceEl, tilePanel, tilePanelCloseBtn, tilePanelTitle, tilePreviewEl,
    tilePreviewEmptyEl, tileTextInput, tileTitleInput, tileTypeSelect, trendDimensionSelect, typeGridEl,
    typeLineNameEl, updateFormFieldsForType, updateNumberFormatUI, valueLabelsCheckbox, warnPctInput, welcomeAddBtn,
    wordCloudSplitCheckbox, workspaceEl, workspaceMainEl
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const buildTileElement = (...args) => parts.buildTileElement(...args);
  const setMode = (...args) => parts.setMode(...args);
  Object.assign(parts, {
    closeTilePanel, flashTile, openTilePanel, refreshTilePanelTexts, schedulePreview, updateAdvancedVisibility,
    updatePanelTexts
  });

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
    const editing = Boolean(S.editingTileId);
    tilePanelTitle.textContent = t(editing ? 'tilePanel.title.edit' : 'tilePanel.title.add');
    submitTileBtn.textContent = t(editing ? 'tileForm.submit.edit' : 'tileForm.submit.add');
    const type = tileTypeSelect.value;
    GristBI.safeHtml.setHtml(typeLineNameEl, `${icon('type-' + type)}<span>${escapeHtml(t('tileForm.type.' + type))}</span>`);
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
      GristBI.safeHtml.setHtml(card, `${icon('type-' + type)}<span class="type-card-name">${escapeHtml(t('tileForm.type.' + type))}</span>`
        + `<span class="type-card-advice" data-level="${locked ? 'locked' : (advice ? advice.level : '')}">${escapeHtml(adviceText)}</span>`);
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
    const typeDefaults = GristBI.advice ? GristBI.advice.defaultsForType(type, rows, availableColumns(rows)) : null;
    if (typeDefaults) {
      if (typeDefaults.dimension) dimensionSelect.value = typeDefaults.dimension;
      columnDimensionSelect.value = typeDefaults.columnDimension || '';
      startColumnSelect.value = typeDefaults.startColumn || '';
      endColumnSelect.value = typeDefaults.endColumn || '';
      seriesSelect.value = typeDefaults.seriesColumn || '';
      measureYSelect.value = typeDefaults.measureY || '';
      comboModeSelect.value = typeDefaults.comboMode === 'pareto' ? 'pareto' : 'measure';
      if (typeDefaults.drillDimensions) setDrillLevels(typeDefaults.drillDimensions);
      if (Number.isFinite(typeDefaults.gaugeMin)) gaugeMinInput.value = typeDefaults.gaugeMin;
      if (Number.isFinite(typeDefaults.gaugeMax)) gaugeMaxInput.value = typeDefaults.gaugeMax;
      radarModeSelect.value = typeDefaults.radarAxisMode === 'columns' ? 'columns' : 'dimension';
      if (typeDefaults.radarAxisMode === 'columns') setRadarAxes(typeDefaults.radarAxes);
      wordCloudSplitCheckbox.checked = !!typeDefaults.wordCloudSplit;
      sortSelect.value = typeDefaults.sortMode || '';
      horizontalCheckbox.checked = !!typeDefaults.horizontal;
      areaCheckbox.checked = !!typeDefaults.areaFill;
      stackedCheckbox.checked = !!typeDefaults.stacked;
      donutCheckbox.checked = !!typeDefaults.donut;
      showPctCheckbox.checked = !!typeDefaults.showPct;
      if (typeDefaults.columns) setColumnsPicker(typeDefaults.columns);
    }
    updateFormFieldsForType();
    if (typeDefaults) {
      measureSelect.value = typeDefaults.measure || '';
      aggSelect.value = typeDefaults.aggFn || 'sum';
      aggYSelect.value = typeDefaults.aggFnY || typeDefaults.aggFn || 'sum';
      aggSizeSelect.value = typeDefaults.aggFn || 'sum';
      trendDimensionSelect.value = typeDefaults.trendDimension || '';
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
    S.submitAttempted = false;
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
    if (S.mode !== 'edit') setMode('edit'); // l'API publique peut être appelée depuis le mode Lecture
    const opener = document.activeElement;
    panelOpener = (opener && opener !== document.body && opener.id !== 'tile-panel-close') ? opener : addTileOpenBtn;
    const wasOpen = !tilePanel.hidden;
    if (!opts.editing) { stopEditTile(); resetTileForm(); }
    tilePanel.hidden = false;
    workspaceEl.classList.add('panel-open');
    addTileOpenBtn.setAttribute('aria-expanded', 'true');
    S.submitAttempted = false;
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
    if (tilePanel.hidden) { if (S.editingTileId) stopEditTile(); return; }
    if (S.editingTileId) stopEditTile();
    tilePanel.hidden = true;
    workspaceEl.classList.remove('panel-open');
    addTileOpenBtn.setAttribute('aria-expanded', 'false');
    clearTimeout(previewTimer);
    disposePreview();
    clearFormErrors();
    S.submitAttempted = false;
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
      if (S.submitAttempted) showFormErrors(readTileForm().errors, false);
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
    if (S.submitAttempted) showFormErrors(readTileForm().errors, false);
  }

  addTileForm.addEventListener('input', onFormActivity);

  addTileForm.addEventListener('change', onFormActivity);

  addTileOpenBtn.addEventListener('click', () => {
    if (!tilePanel.hidden && !S.editingTileId) closeTilePanel(true);
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
})(window);
