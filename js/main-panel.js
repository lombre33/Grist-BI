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
    configureStepEl, dateColumnSelect, dimensionSelect, genTileId, donutCheckbox, drillCrossFilterCheckbox, endColumnSelect,
    gaugeMaxInput, gaugeMinInput, goodPctInput, horizontalCheckbox, icon, lineShapeSelect, measureModeSelect,
    measureSelect, measureSizeSelect, measureYSelect, paletteSelect, panelBackBtn, pivotHeatCheckbox,
    radarCompareAverageCheckbox, radarEntityColumnSelect, radarEntityValueSelect, radarModeSelect, readTileForm,
    refLineSelect, refValueInput, resetDrillLevels, resetRadarAxes, seriesSelect, setColumnsPicker, setDrillLevels,
    setNumberFormatForm, setRadarAxes, showFormErrors, showPctCheckbox, smallMultiplesCheckbox, sortSelect,
    sparklineCheckbox, stackPercentCheckbox, stackedCheckbox, startColumnSelect, stopEditTile, store, submitTileBtn,
    targetColumnSelect, targetInput, tileAdviceEl, tileLinkNoteEl, tileCompleteEl, tileCompleteListEl, tileCompleteLiveEl,
    tileJoinEl, tileJoinListEl, tileJoinDoneEl,
    tilePagesEl, tilePagesListEl, tilePagesLiveEl,
    columnPickEl, columnProfileEl, columnUsedEl, columnEmptyEl, columnListEl, columnLiveEl, tilePanel, tilePanelCloseBtn, tilePanelTitle, tilePreviewEl,
    tilePreviewEmptyEl, tileTextInput, tileTitleInput, tileTypeSelect, trendDimensionSelect, typeGridEl,
    typeLineNameEl, updateFormFieldsForType, updateNumberFormatUI, valueLabelsCheckbox, warnPctInput, welcomeAddBtn,
    wordCloudSplitCheckbox, workspaceEl, workspaceMainEl, clearFormColumns, fillCombobox, formRows, refreshFormColumns, tableInput, tableNoteEl,
    updateTableFieldVisibility
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const buildTileElement = (...args) => parts.buildTileElement(...args);
  const setMode = (...args) => parts.setMode(...args);
  const linkTable = (...args) => parts.linkTable(...args);
  const ensureTableRows = (...args) => parts.ensureTableRows(...args);
  Object.assign(parts, {
    closeTilePanel, flashTile, hideColumnResults, openTilePanel, refreshTableField, refreshTilePanelTexts, renderColumnHelper, schedulePreview,
    updateAdvancedVisibility, updatePanelTexts
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

  // « Pour compléter ce tableau de bord » (niveau 3 des suggestions, js/advice-complete.js) : au-dessus des cartes de type, jusqu'à trois tuiles
  // que les données permettent et que les tuiles posées (toutes pages) ne montrent pas encore, chacune avec ce qu'elle comble. Calculé APRÈS
  // l'ouverture du panneau (une table de plusieurs dizaines de milliers de lignes se profile en quelques centaines de millisecondes : le panneau
  // ne doit pas attendre), et seulement quand les lignes, la langue ou les tuiles ont changé depuis la dernière fois.
  let completion = { rows: null, lang: null, tiles: null, items: [] };
  let completionToken = 0;

  // Les tuiles de TOUTES les pages du rapport (« ce tableau de bord » est le rapport, pas la page courante).
  const tilesOfAllPages = (state) => state.pages.reduce((all, page) => all.concat(page.tiles || []), []);

  const sameRefs = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

  function hideCompletion() {
    completionToken++;
    tileCompleteEl.hidden = true;
    tileCompleteListEl.textContent = '';
    markRecommended([]);
  }

  // Badge « Recommandé » sur les cartes de TYPE que les propositions du moment utilisent (celles de « Pour compléter ce tableau de bord », ou les
  // meilleures suggestions d'un tableau de bord vide) : une pastille discrète, et la raison en infobulle (le manque dit, sinon la raison chiffrée).
  // L'ordre des cartes ne change jamais. Un type que la personne ne peut pas choisir (extension absente) n'est jamais recommandé.
  function markRecommended(items) {
    typeGridEl.querySelectorAll('.type-card').forEach((card) => {
      card.classList.remove('type-card-recommended');
      delete card.dataset.recommended;
      card.removeAttribute('title');
      const old = card.querySelector('.type-card-badge');
      if (old) old.remove();
    });
    items.forEach((item) => {
      const card = typeGridEl.querySelector(`.type-card[data-type="${item.type}"]`);
      if (!card || card.getAttribute('aria-disabled') === 'true' || card.dataset.recommended) return;
      const why = item.gapKey ? t(item.gapKey, item.gapVars) : t(item.reasonKey, item.reasonVars);
      const badge = document.createElement('span');
      badge.className = 'type-card-badge';
      badge.textContent = t('tilePanel.recommended');
      card.appendChild(badge);
      card.classList.add('type-card-recommended');
      card.dataset.recommended = 'true';
      card.title = t('tilePanel.recommended.why', { reason: why });
    });
  }

  // `showList` : la section « Pour compléter » n'a de sens que s'il y a déjà des tuiles ; les badges des types, eux, valent aussi pour un tableau de bord vide.
  function paintCompletion(items, rows, lang, showList) {
    tileCompleteListEl.textContent = '';
    tileCompleteEl.hidden = !showList || !items.length;
    markRecommended(items);
    if (!showList) return;
    fillCards(tileCompleteListEl, items, rows, lang, 'data-complete');
  }

  // Les cartes d'une liste de propositions (celles de « Pour compléter » et de « Que faire avec cette colonne ? » sont les mêmes) : aperçu,
  // titre, manque dit, raison chiffrée, bouton « Ajouter » portant son rang dans l'attribut `attr`.
  function fillCards(listEl, items, rows, lang, attr) {
    items.forEach((s, i) => {
      const title = t(s.titleKey, s.titleVars);
      const li = document.createElement('li');
      li.className = 'complete-card';
      GristBI.safeHtml.setHtml(li, `<div class="complete-preview">${GristBI.welcome.previewSvg(GristBI.advice.previewFor(s.tileData, rows), { lang })}</div>`
        + `<div class="complete-body"><h4 class="complete-card-title">${escapeHtml(title)}</h4>`
        + (s.gapKey ? `<p class="complete-card-gap">${escapeHtml(t(s.gapKey, s.gapVars))}</p>` : '')
        + `<p class="complete-card-reason">${escapeHtml(t(s.reasonKey, s.reasonVars))}</p>`
        + `<button type="button" class="btn-primary" ${attr}="${i}" aria-label="${escapeHtml(t('welcome.addAria', { title }))}">${escapeHtml(t('welcome.add'))}</button></div>`);
      listEl.appendChild(li);
    });
  }

  // `afterPaint` (facultatif) : appelé une fois la liste dessinée (ou masquée) — le focus d'un clic sur « Ajouter » ne peut aller qu'à une carte qui existe.
  function renderCompletion(afterPaint) {
    const token = ++completionToken;
    const done = () => { if (afterPaint) afterPaint(); };
    const state = store.getState();
    const tiles = tilesOfAllPages(state);
    if (!GristBI.adviceComplete || S.editingTileId || !state.rows.length) { hideCompletion(); done(); return; }
    const lang = GristBI.i18n.getLang();
    if (completion.rows === state.rows && completion.lang === lang && sameRefs(completion.tiles, tiles)) { paintCompletion(completion.items, state.rows, lang, tiles.length > 0); done(); return; }
    // Une liste calculée pour d'autres tuiles se retire d'abord : elle proposerait, un instant, ce qui vient d'être posé.
    tileCompleteEl.hidden = true;
    tileCompleteListEl.textContent = '';
    markRecommended([]);
    setTimeout(() => {
      if (token !== completionToken || tilePanel.hidden) return; // fermé, rouvert ou déjà recalculé entre-temps
      const result = GristBI.adviceComplete.complete(state.rows, tiles, { t, lang, limit: 3 });
      completion = { rows: state.rows, lang, tiles, items: result.items };
      paintCompletion(result.items, state.rows, lang, tiles.length > 0);
      done();
    }, 0);
  }

  // Ajouter une suggestion : la tuile est posée comme l'écran d'accueil le fait, la liste se recalcule (la tuile posée n'y est plus, une autre
  // intention passe devant) et le focus reste dans la liste, jamais perdu avec le bouton qui disparaît.
  tileCompleteListEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-complete]');
    const item = btn && completion.items[Number(btn.dataset.complete)];
    if (!item) return;
    const id = genTileId(0);
    store.addTile(Object.assign({ id }, item.tileData));
    flashTile(id);
    tileCompleteLiveEl.textContent = t('tilePanel.complete.added', { title: t(item.titleKey, item.titleVars) });
    renderPages();
    renderCompletion(() => { (tileCompleteListEl.querySelector('button[data-complete]') || typeGridEl.querySelector('.type-card') || tilePanelCloseBtn).focus(); });
  });

  // « Analyser par nom plutôt que par numéro » (js/advice-join.js) : une colonne Référence de Grist ne contient que des numéros de ligne d'une autre
  // table ; si la relier apporte des axes (une ville, un segment, un nom), le panneau le propose, avec la phrase de ce qu'elle apporte. Un clic pose
  // la jointure (`linkTable`, la même que « Joindre une autre table » du menu Données), puis les suggestions se recalculent sur les lignes jointes.
  // Il faut LIRE l'autre table (une lecture par table, au plus quatre) : rien n'est écrit tant que la lecture n'est pas revenue, et un résultat
  // périmé (panneau fermé, lignes changées, autre calcul) n'écrit rien (`joinToken`). Une jointure déjà posée = aucune proposition.
  let joinToken = 0;
  let joinItems = [];
  let joinShown = null; // { rows, lang } : ce que les cartes affichées ont lu (un `change` ou un recalcul identique ne refait rien)
  let joinDone = null;  // { table, column, axes } : la jointure posée depuis ce panneau, redite tant que le panneau reste ouvert

  function paintJoinDone() {
    const state = store.getState();
    // La phrase ne vaut que tant que CETTE jointure est en place (retirée par le menu Données, elle disparaît).
    const still = !!joinDone && (state.joins || []).some((j) => j.table === joinDone.table && j.primaryColumn === joinDone.column);
    tileJoinDoneEl.textContent = still ? t('tilePanel.join.done', { table: joinDone.table, axes: joinDone.axes }) : '';
    tileJoinDoneEl.hidden = !still;
    return still;
  }

  function paintJoin(items) {
    joinItems = items;
    tileJoinListEl.textContent = '';
    items.forEach((p, i) => {
      const title = t(p.titleKey, p.titleVars);
      const li = document.createElement('li');
      li.className = 'complete-card join-card';
      GristBI.safeHtml.setHtml(li, `<div class="complete-body"><h4 class="complete-card-title">${escapeHtml(title)}</h4>`
        + `<p class="complete-card-reason">${escapeHtml(t(p.reasonKey, p.reasonVars))}</p>`
        + `<button type="button" class="btn-primary" data-join="${i}" aria-label="${escapeHtml(t('tilePanel.join.addAria', { table: p.table, column: p.column }))}">${escapeHtml(t('tilePanel.join.add', { table: p.table }))}</button></div>`);
      tileJoinListEl.appendChild(li);
    });
    const showDone = paintJoinDone();
    tileJoinEl.hidden = !items.length && !showDone;
  }

  function hideJoin() {
    joinToken++;
    joinItems = [];
    joinShown = null;
    joinDone = null;
    tileJoinListEl.textContent = '';
    tileJoinDoneEl.textContent = '';
    tileJoinDoneEl.hidden = true;
    tileJoinEl.hidden = true;
  }

  // `afterPaint` (facultatif) : appelé une fois les cartes dessinées (ou retirées).
  function renderJoin(afterPaint) {
    const token = ++joinToken;
    const done = () => { if (afterPaint) afterPaint(); };
    const state = store.getState();
    if (!GristBI.adviceJoin || S.editingTileId || !state.rows.length) { hideJoin(); done(); return; }
    const lang = GristBI.i18n.getLang();
    // Les jointures déjà posées (plusieurs depuis le lot 1) : une colonne déjà jointe vers sa table n'est plus proposée.
    const opts = { currentTable: S.currentTableId, blend: state.blend, joined: state.joins };
    const cands = GristBI.adviceJoin.candidates(state.rows, opts);
    if (!cands.length) { joinItems = []; joinShown = null; tileJoinListEl.textContent = ''; const showDone = paintJoinDone(); tileJoinEl.hidden = !showDone; done(); return; }
    if (joinShown && joinShown.rows === state.rows && joinShown.lang === lang) { paintJoin(joinItems); done(); return; }
    // Des cartes d'avant (autres lignes, autre langue) se retirent d'abord : elles proposeraient, un instant, ce qui n'est plus vrai.
    tileJoinEl.hidden = true;
    tileJoinListEl.textContent = '';
    const tables = GristBI.adviceJoin.tablesToLoad(cands);
    Promise.all(tables.map((table) => GristBI.api.loadTable(table).then((res) => [table, res && res.rows], () => [table, null]))).then((pairs) => {
      if (token !== joinToken || tilePanel.hidden || store.getState().rows !== state.rows) return; // fermé, rouvert, lignes changées ou déjà recalculé
      const secondary = {};
      pairs.forEach(([table, rows]) => { if (Array.isArray(rows)) secondary[table] = rows; });
      const result = GristBI.adviceJoin.propose(state.rows, secondary, opts);
      joinShown = { rows: state.rows, lang };
      paintJoin(result.proposals);
      done();
    });
  }

  tileJoinListEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-join]');
    const item = btn && joinItems[Number(btn.dataset.join)];
    if (!item) return;
    btn.disabled = true;
    linkTable(item.join).then((joined) => {
      if (!joined) { renderJoin(); return; }
      joinDone = { table: item.table, column: item.column, axes: item.reasonVars.axes };
      // Les lignes ont changé (colonnes de l'autre table) : la phrase de confirmation prend la place des cartes, les suggestions se recalculent.
      renderJoin();
      renderPages();
      renderCompletion(() => { (tileCompleteListEl.querySelector('button[data-complete]') || typeGridEl.querySelector('.type-card') || tilePanelCloseBtn).focus({ preventScroll: true }); });
    });
  });

  // « Ajouter une page entière » (js/advice-pages.js) : les modèles de rapport (vue d'ensemble, évolution, répartition) proposés comme PAGES quand ils
  // apportent au moins trois visualisations que les tuiles posées (toutes pages) ne montrent pas encore. Un clic crée la page (`store.addPage`, qui y
  // navigue) et y pose ces visualisations ; la proposition disparaît d'elle-même (ses visualisations sont désormais des tuiles posées). Même discipline
  // que `renderCompletion` : calcul différé après le dessin, jamais écrit s'il est périmé (`pagesToken`), liste retirée avant le recalcul, focus rendu
  // APRÈS le dessin, annonce dans une zone de statut. Rien tant que le tableau de bord n'a aucune tuile (l'écran d'accueil s'en charge).
  let pagesToken = 0;
  let pagesItems = [];
  let pagesShown = null; // { rows, lang, tiles, names } : ce que les cartes affichées ont lu (rien ne se refait si rien de cela n'a changé)

  const pageNamesOf = (state) => state.pages.map((page) => page.name).join('\u0001');

  function hidePages() {
    pagesToken++;
    pagesItems = [];
    pagesShown = null;
    tilePagesListEl.textContent = '';
    tilePagesEl.hidden = true;
  }

  function paintPages(items) {
    pagesItems = items;
    tilePagesListEl.textContent = '';
    items.forEach((p, i) => {
      const title = t(p.titleKey, p.titleVars);
      const li = document.createElement('li');
      li.className = 'complete-card page-card';
      const types = p.tiles.map((tile) => `<span class="page-card-type">${icon('type-' + tile.type)}</span>`).join('');
      GristBI.safeHtml.setHtml(li, `<div class="complete-body"><h4 class="complete-card-title">${escapeHtml(title)}</h4>`
        + `<div class="page-card-types" aria-hidden="true">${types}</div>`
        + `<p class="complete-card-reason">${escapeHtml(t(p.reasonKey, p.reasonVars))}</p>`
        + `<button type="button" class="btn-primary" data-page="${i}" aria-label="${escapeHtml(t('tilePanel.pages.addAria', { page: p.pageName, n: p.tiles.length }))}">${escapeHtml(t('tilePanel.pages.add'))}</button></div>`);
      tilePagesListEl.appendChild(li);
    });
    tilePagesEl.hidden = !items.length;
  }

  // `afterPaint` (facultatif) : appelé une fois les cartes dessinées (ou retirées).
  function renderPages(afterPaint) {
    const token = ++pagesToken;
    const done = () => { if (afterPaint) afterPaint(); };
    const state = store.getState();
    const tiles = tilesOfAllPages(state);
    if (!GristBI.advicePages || S.editingTileId || !state.rows.length || !tiles.length) { hidePages(); done(); return; }
    const lang = GristBI.i18n.getLang();
    const names = pageNamesOf(state);
    if (pagesShown && pagesShown.rows === state.rows && pagesShown.lang === lang && pagesShown.names === names && sameRefs(pagesShown.tiles, tiles)) { paintPages(pagesItems); done(); return; }
    // Des cartes calculées pour d'autres tuiles ou d'autres pages se retirent d'abord : elles proposeraient, un instant, ce qui vient d'être posé.
    tilePagesEl.hidden = true;
    tilePagesListEl.textContent = '';
    setTimeout(() => {
      if (token !== pagesToken || tilePanel.hidden) return; // fermé, rouvert ou déjà recalculé entre-temps
      const result = GristBI.advicePages.propose(state.rows, tiles, state.pages, { t, lang });
      pagesShown = { rows: state.rows, lang, tiles, names };
      paintPages(result.proposals);
      done();
    }, 0);
  }

  tilePagesListEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-page]');
    const item = btn && pagesItems[Number(btn.dataset.page)];
    if (!item) return;
    store.addPage(item.pageName);
    item.tiles.forEach((tile, i) => store.addTile(Object.assign({ id: genTileId(i) }, tile)));
    tilePagesLiveEl.textContent = t('tilePanel.pages.added', { page: item.pageName, n: item.tiles.length });
    renderCompletion();
    renderPages(() => { (tilePagesListEl.querySelector('button[data-page]') || tileCompleteListEl.querySelector('button[data-complete]') || typeGridEl.querySelector('.type-card') || tilePanelCloseBtn).focus({ preventScroll: true }); });
  });

  // « Que faire avec cette colonne ? » (js/advice-column.js) : la personne choisit une colonne dans le champ à autocomplétion, on lui dit ce qu'elle est
  // (une phrase), combien de tuiles la lisent déjà, et on lui montre jusqu'à trois tuiles qui la lisent — les MÊMES cartes que « Pour compléter ».
  // Même discipline que `renderCompletion` : calcul différé après le dessin (un jeton écarte un résultat périmé), liste retirée avant le recalcul,
  // focus rendu APRÈS le dessin, annonce dans une zone de statut. Rien tant qu'aucune colonne n'est choisie.
  let columnToken = 0;
  let columnItems = [];
  // Ce que les résultats affichés ont lu (colonne, lignes, langue, tuiles posées) : tant que rien de cela n'a changé, un événement `change` du
  // champ ne refait RIEN. Il en arrive un second à la perte du focus (le navigateur le déclenche à son tour après celui que le combobox émet
  // lui-même) : refaire la liste à ce moment retirait le bouton « Ajouter » entre le bouton de la souris enfoncé et relâché, et le clic se perdait
  // (trouvé par un vrai clic Playwright, pas par la lecture).
  let columnShown = null;
  S.columnHelperRows = null; // les lignes pour lesquelles les résultats affichés ont été calculés (voir refreshColumnSelects)

  function columnResultsAreFresh() {
    const state = store.getState();
    return !!columnShown && columnShown.column === columnPickEl.value && columnShown.rows === state.rows
      && columnShown.lang === GristBI.i18n.getLang() && sameRefs(columnShown.tiles, tilesOfAllPages(state));
  }

  function hideColumnResults() {
    columnToken++;
    columnItems = [];
    columnShown = null;
    S.columnHelperRows = null;
    columnProfileEl.textContent = '';
    columnUsedEl.textContent = '';
    columnEmptyEl.textContent = '';
    columnEmptyEl.hidden = true;
    columnListEl.textContent = '';
    columnLiveEl.textContent = '';
  }

  function renderColumnHelper(afterPaint) {
    const token = ++columnToken;
    const done = () => { if (afterPaint) afterPaint(); };
    const column = columnPickEl.value;
    const state = store.getState();
    if (!GristBI.adviceColumn || S.editingTileId || !column || !state.rows.length) { hideColumnResults(); done(); return; }
    // Les résultats d'avant se retirent d'abord : ils parleraient de la colonne précédente ou de tuiles qui ont changé.
    columnItems = [];
    columnShown = null;
    columnUsedEl.textContent = '';
    columnEmptyEl.hidden = true;
    columnListEl.textContent = '';
    columnProfileEl.textContent = t('tilePanel.column.working');
    setTimeout(() => {
      if (token !== columnToken || tilePanel.hidden) return; // fermé, rouvert, autre colonne ou déjà recalculé entre-temps
      const lang = GristBI.i18n.getLang();
      const tiles = tilesOfAllPages(state);
      const result = GristBI.adviceColumn.describe(state.rows, tiles, column, { t, lang, limit: 3 });
      if (!result.ok) { hideColumnResults(); done(); return; }
      S.columnHelperRows = state.rows;
      columnShown = { column, rows: state.rows, lang, tiles };
      columnItems = result.items;
      columnProfileEl.textContent = t(result.roleKey, result.roleVars);
      columnUsedEl.textContent = result.usedBy ? t(GristBI.adviceColumn.USED_KEY, { n: result.usedBy }) : '';
      columnListEl.textContent = '';
      fillCards(columnListEl, result.items, state.rows, lang, 'data-column-add');
      columnEmptyEl.hidden = !result.emptyKey;
      columnEmptyEl.textContent = result.emptyKey ? t(result.emptyKey) : '';
      columnLiveEl.textContent = result.items.length ? t('tilePanel.column.found', { n: result.items.length, column }) : t(result.emptyKey);
      done();
    }, 0);
  }

  columnPickEl.addEventListener('change', () => { if (!columnResultsAreFresh()) renderColumnHelper(); });
  columnListEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-column-add]');
    const item = btn && columnItems[Number(btn.dataset.columnAdd)];
    if (!item) return;
    const id = genTileId(0);
    store.addTile(Object.assign({ id }, item.tileData));
    flashTile(id);
    // La tuile posée n'est plus à compléter : « Pour compléter » et les pages proposées se recalculent aussi.
    renderCompletion();
    renderPages();
    renderColumnHelper(() => {
      // La tuile posée n'est plus proposée : le focus reste dans la liste (jamais perdu avec le bouton qui disparaît), puis sur le champ.
      (columnListEl.querySelector('button[data-column-add]') || columnPickEl).focus({ preventScroll: true });
    });
  });

  // --- Le champ « Table » (lot 2 de « colonnes de toutes les tables », 26/11/2026) ---------------------------------------------------------
  // Une visualisation lit la table de travail du rapport, sauf si on en choisit une autre ici : elle porte alors `tile.table` et ne voit que les
  // lignes (et les filtres) de cette table. Le champ ne se montre que si le document compte au moins deux tables. Les listes de colonnes du formulaire
  // suivent la table choisie (`S.formTable`, `formRows`) ; la table est lue à la demande (`ensureTableRows`).
  // Pas de `beforeOpen` (la liste s'ouvre alors tout de suite, comme celle des colonnes) : une liste qui s'ouvre après une attente échappe à l'Échap
  // synthétique de `showFormErrors`, qui fermerait le PANNEAU au lieu de la liste. La liste se relit à l'ouverture du panneau et à chaque prise de
  // focus du champ (une table créée dans Grist entre-temps se voit à l'ouverture suivante).
  GristBI.combobox.attach(tableInput, tableInput.nextElementSibling, { strict: true });

  let tableNames = '';
  async function loadTableOptions() {
    let tables = [];
    try { tables = await GristBI.api.listAvailableTables(); } catch (e) { console.error('[GristBI] liste des tables illisible (champ Table)', e); }
    S.tableCount = tables.length;
    // Une liste identique ne se repose pas : `setOptions` d'un champ strict efface un texte en cours de frappe.
    if (tables.join('\n') !== tableNames) {
      tableNames = tables.join('\n');
      const typing = tableInput.value;
      fillCombobox(tableInput, tables);
      if (tables.indexOf(typing) !== -1) tableInput.value = typing;
    }
    updateTableFieldVisibility();
    return tables;
  }

  async function refreshTableField() {
    await loadTableOptions();
    tableInput.value = S.formTable || store.getState().workingTable;
    updateTableNote();
    updateTableFieldVisibility();
  }

  tableInput.addEventListener('focus', () => { loadTableOptions(); });

  // Ce que dit le champ de la table choisie : lecture en cours, illisible, ou la portée de la tuile (ses filtres sont ceux de SA table).
  function updateTableNote() {
    const table = S.formTable;
    let key = '';
    if (table) {
      const status = GristBI.data.tableRowsStatus(store.getState(), table);
      key = status === 'failed' ? 'tileTable.failed' : (status === 'loading' ? 'tileForm.table.loading' : 'tileForm.table.other');
    }
    tableNoteEl.hidden = !key;
    tableNoteEl.textContent = key ? t(key, { table }) : '';
  }

  // Un seul changement à la fois compte : le dernier (une lecture lente d'une table abandonnée n'écrit rien dans le formulaire).
  let tableChangeToken = 0;
  async function changeFormTable() {
    const chosen = tableInput.value;
    const table = chosen && chosen !== store.getState().workingTable ? chosen : '';
    if (table === S.formTable) return;
    const token = ++tableChangeToken;
    S.formTable = table;
    // Les colonnes choisies appartenaient à l'autre table : on les vide (un même nom ailleurs n'est pas la même colonne), sans toucher au reste.
    clearFormColumns();
    refreshFormColumns();
    updateTableNote();
    updateTableFieldVisibility();
    if (table) await ensureTableRows(table);
    if (token !== tableChangeToken || S.formTable !== table) return;
    updateTableNote();
    refreshFormColumns();
    if (!S.editingTileId) applyTypeDefaults(tileTypeSelect.value); // un nouvel ajout : les colonnes que cette table suggère, comme au choix du type
    updateFormFieldsForType();
    schedulePreview();
  }

  tableInput.addEventListener('change', changeFormTable);

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
    const rows = formRows();
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
    if (!opts.editing) {
      stopEditTile();
      if (S.formTable) { S.formTable = ''; refreshFormColumns(); } // un nouvel ajout repart de la table de travail
      resetTileForm();
    }
    tilePanel.hidden = false;
    refreshTableField();
    workspaceEl.classList.add('panel-open');
    addTileOpenBtn.setAttribute('aria-expanded', 'true');
    S.submitAttempted = false;
    clearFormErrors();
    hideLinkNote();
    renderTypeCards();
    renderCompletion();
    renderJoin();
    renderPages();
    columnPickEl.value = '';
    hideColumnResults();
    updatePanelTexts();
    if (opts.type && !opts.editing) chooseType(opts.type);
    else setPanelStep(opts.step || 'choose');
    requestAnimationFrame(() => {
      GristBI.charts.resizeAll();
      if (!wasOpen) tilePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // La phrase qui dit qu'un choix de colonne vient de relier une table (js/main-session.js:ensureColumnJoined) : valable le temps d'un panneau.
  function hideLinkNote() {
    tileLinkNoteEl.hidden = true;
    tileLinkNoteEl.textContent = '';
  }

  function closeTilePanel(returnFocus) {
    if (tilePanel.hidden) { if (S.editingTileId) stopEditTile(); return; }
    if (S.editingTileId) stopEditTile();
    if (S.formTable) { S.formTable = ''; refreshFormColumns(); }
    tilePanel.hidden = true;
    hideLinkNote();
    hideCompletion();
    hideJoin();
    hidePages();
    hideColumnResults();
    columnPickEl.value = '';
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
    const advice = (GristBI.advice && tileData) ? GristBI.advice.adviceForTile(tileData, formRows()) : null;
    tileAdviceEl.hidden = !advice;
    if (advice) { tileAdviceEl.textContent = t(advice.key, advice.vars); tileAdviceEl.dataset.level = advice.level; }
    else tileAdviceEl.textContent = '';
  }

  // Après un changement de langue : les textes écrits par JS (titre, type, cartes, erreurs, aperçu).
  function refreshTilePanelTexts() {
    updatePanelTexts();
    if (tilePanel.hidden) return;
    renderTypeCards();
    renderCompletion();
    renderJoin();
    renderPages();
    if (columnPickEl.value) renderColumnHelper();
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
