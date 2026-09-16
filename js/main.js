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

  let currentTableId = null;
  let saveTimer = null;
  let lastRenderedPages = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let lastRenderedCurrentPageId = null; // idem, côté page active (changer de page se sauvegarde aussi)
  let lastRenderedBookmarks = null; // idem, côté bookmarks
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
  const addTileForm = document.getElementById('add-tile-form');
  const tileTypeSelect = document.getElementById('tile-type');
  const dimensionField = document.getElementById('tile-dimension-field');
  const dimensionSelect = document.getElementById('tile-dimension');
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

  function fillSelect(select, options, { blankLabel } = {}) {
    const current = select.value;
    const optionsHtml = options.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    select.innerHTML = blankLabel ? `<option value="">${escapeHtml(blankLabel)}</option>${optionsHtml}` : optionsHtml;
    if (options.includes(current) || (blankLabel && current === '')) select.value = current;
  }

  function refreshColumnSelects(rows) {
    const cols = availableColumns(rows);
    fillSelect(dimensionSelect, cols);
    fillSelect(measureSelect, cols);
    fillSelect(measureYSelect, cols);
    drillLevelSelects.forEach((select) => fillSelect(select, cols, { blankLabel: '(aucun)' }));
    fillSelect(trendDimensionSelect, cols, { blankLabel: '(aucune)' });
    fillSelect(filterColumnSelect, cols);
    updateAdvancedFilterFieldsForColumn();
  }

  // Devine le "type" d'une colonne en inspectant une VALEUR réelle plutôt qu'un nom de colonne
  // (heuristique fragile) — même principe que la détection Date/Numeric du widget publipostageGrist
  // (voir ROADMAP.md, correction technique du 2026-09-15) : ce POC n'a pas encore de lecture des
  // vrais types Grist (`_grist_Tables_column`), donc on infère depuis la donnée chargée, pas depuis
  // le nom. `GristBI.data.parseDateValue` reconnaît le seul format de date utilisé ici (AAAA-MM-JJ,
  // voir demo-data.js:isoDate) ; une chaîne numérique (ex. Grist renvoie parfois des nombres en
  // chaîne) compte comme 'number', pas comme texte.
  function inferColumnKind(column) {
    const rows = store.getState().rows;
    if (!rows.length) return 'text';
    const sample = rows.find((r) => r[column] != null && r[column] !== '');
    if (!sample) return 'text';
    const v = sample[column];
    if (GristBI.data.parseDateValue(v) != null) return 'date';
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)))) return 'number';
    return 'text';
  }

  // Bascule les champs du formulaire de filtre avancé selon le "type" inféré de la colonne
  // choisie : plage min/max (numérique), plage de dates OU période relative au choix (date, via
  // `#filter-date-mode`), recherche texte (tout le reste). Même pattern que
  // `updateFormFieldsForType` pour le formulaire de tuile.
  function updateAdvancedFilterFieldsForColumn() {
    const column = filterColumnSelect.value;
    const kind = column ? inferColumnKind(column) : 'text';
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
  }

  // KPI et jauge : une seule valeur agrégée, pas de dimension de regroupement ni de drill-down.
  function typeHasNoDimension(type) { return type === 'kpi' || type === 'gauge'; }

  // Drill-down à N niveaux : un <select> par niveau, créé dynamiquement ("+ Niveau") plutôt que des
  // champs figés dans le HTML — data.js/state.js/charts.js gèrent déjà un tableau drillDimensions
  // de longueur quelconque, seul le formulaire limitait ça à 2 champs statiques auparavant.
  function createDrillLevelSelect(index) {
    const select = document.createElement('select');
    select.id = `tile-drill-dimension-${index + 1}`;
    select.innerHTML = '<option value="">(aucun)</option>';
    select.addEventListener('change', () => {
      if (!select.value) {
        // Niveau vidé -> tout niveau plus profond n'a plus de sens (un trou dans la hiérarchie,
        // ex. Année > (rien) > Semaine, ne veut rien dire) : on les retire.
        truncateDrillLevelsAfter(index);
        if (index === 0) drillCrossFilterCheckbox.checked = false; // plus de drill-down du tout
      }
      updateDrillLevelsUI();
    });
    return select;
  }

  function truncateDrillLevelsAfter(index) {
    while (drillLevelSelects.length > index + 1) {
      drillLevelSelects.pop().remove();
    }
  }

  // Réaffiche le bouton "+ Niveau" seulement si le dernier niveau visible est rempli (progression
  // séquentielle, comme l'ancien niveau 2 qui n'apparaissait qu'une fois le niveau 1 choisi) et que
  // le plafond n'est pas atteint ; recalcule aussi la visibilité de la case cross-filter.
  function updateDrillLevelsUI() {
    const noDimension = typeHasNoDimension(tileTypeSelect.value);
    const lastSelect = drillLevelSelects[drillLevelSelects.length - 1];
    addDrillLevelBtn.hidden = noDimension || !lastSelect || !lastSelect.value || drillLevelSelects.length >= MAX_DRILL_LEVELS;
    drillCrossFilterField.hidden = noDimension || !drillLevelSelects[0] || !drillLevelSelects[0].value;
  }

  addDrillLevelBtn.addEventListener('click', () => {
    if (drillLevelSelects.length >= MAX_DRILL_LEVELS) return;
    const select = createDrillLevelSelect(drillLevelSelects.length);
    fillSelect(select, availableColumns(store.getState().rows), { blankLabel: '(aucun)' });
    drillLevelsContainer.appendChild(select);
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
    drillLevelsContainer.appendChild(select);
    drillLevelSelects.push(select);
  })();

  function render(state) {
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
    });

    emptyState.hidden = state.tiles.length > 0;
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
      renderTimeEl.textContent = state.tiles.length ? `rendu : ${ms} ms` : '';
    }

    renderPageTabs(state.pages, state.currentPageId);
    renderFilterBadges(state.activeFilters);
    renderAdvancedFilterBadges(state.advancedFilters);
    renderBookmarks(state.bookmarks);
    rowCountEl.textContent = `${state.rows.length} ligne(s)`;

    // `pages`/`currentPageId`/`bookmarks` ne changent de référence/valeur que via leurs actions
    // dédiées (state.js) : un rendu déclenché par un simple rafraîchissement de données (setRows) ne
    // doit pas re-déclencher une écriture dans le document Grist (évite de polluer l'historique à
    // chaque édition externe). Changer de page ne modifie QUE currentPageId (référence de `pages`
    // inchangée) mais mérite quand même d'être sauvegardé, comme la page active dans Power BI.
    if (state.pages !== lastRenderedPages || state.currentPageId !== lastRenderedCurrentPageId ||
        state.bookmarks !== lastRenderedBookmarks) {
      lastRenderedPages = state.pages;
      lastRenderedCurrentPageId = state.currentPageId;
      lastRenderedBookmarks = state.bookmarks;
      scheduleSave(state.pages, state.currentPageId, state.bookmarks);
    }
  }

  // Une page ne se supprime jamais toute seule (state.js:removePage refuse de vider la dernière),
  // donc pas besoin de gérer un état "aucune page" ici. Double-clic = renommer (pattern déjà utilisé
  // nulle part ailleurs dans ce fichier mais discoverable, comme un onglet de tableur) ; le bouton
  // ✕ n'apparaît que sur l'onglet actif pour ne pas encombrer les onglets inactifs, et seulement
  // s'il y a plus d'une page (sinon il ne ferait jamais rien).
  function renderPageTabs(pages, currentPageId) {
    pageTabsEl.innerHTML = pages.map((p) => {
      const active = p.id === currentPageId;
      const removeBtn = active && pages.length > 1
        ? `<span class="page-tab-remove" data-page-id="${escapeHtml(p.id)}" title="Supprimer cette page">&times;</span>`
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
        const name = (prompt('Nouveau nom de la page :', page ? page.name : '') || '').trim();
        if (name) store.renamePage(pageId, name);
      });
    }
    for (const removeBtn of pageTabsEl.querySelectorAll('.page-tab-remove')) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // ne pas aussi déclencher le clic de l'onglet parent (setCurrentPage, no-op ici)
        const pageId = removeBtn.dataset.pageId;
        const page = pages.find((p) => p.id === pageId);
        if (confirm(`Supprimer la page « ${page ? page.name : ''} » et toutes ses tuiles ?`)) {
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
        <button type="button" class="filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="Retirer ce filtre">&times;</button>
      </span>
    `).join('');
    for (const btn of filterBadgesEl.querySelectorAll('.filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearFilter(btn.dataset.column));
    }
    clearFilterBtn.hidden = activeFilters.length === 0;
  }

  const RELATIVE_DATE_LABELS = {
    last7d: '7 derniers jours', last30d: '30 derniers jours', thisMonth: 'ce mois-ci',
    thisYear: 'cette année', last12m: '12 derniers mois'
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
        return `${f.column} : (plage vide)`;
      }
      case 'dateRange': {
        if (f.start && f.end) return `${f.column} : ${f.start} → ${f.end}`;
        if (f.start) return `${f.column} ≥ ${f.start}`;
        if (f.end) return `${f.column} ≤ ${f.end}`;
        return `${f.column} : (plage vide)`;
      }
      case 'relativeDate':
        return `${f.column} : ${RELATIVE_DATE_LABELS[f.preset] || f.preset}`;
      case 'contains':
        return `${f.column} contient "${f.query}"`;
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
        <button type="button" class="advanced-filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="Retirer ce filtre">&times;</button>
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
    bookmarkSelect.innerHTML = '<option value="">Vues sauvegardées…</option>'
      + bookmarks.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
    if (bookmarks.some((b) => b.id === current)) bookmarkSelect.value = current;
    deleteBookmarkBtn.disabled = !bookmarkSelect.value;
  }

  function buildTileElement(tile) {
    const el = document.createElement('div');
    el.className = `tile tile-${tile.type}`;
    el.dataset.tileId = tile.id;
    const header = `<div class="tile-header"><span>${escapeHtml(tile.title)}</span>
        <span class="tile-actions">
          <button class="tile-move-left" type="button" aria-label="Déplacer vers la gauche">◂</button>
          <button class="tile-move-right" type="button" aria-label="Déplacer vers la droite">▸</button>
          <button class="tile-edit" type="button" aria-label="Modifier">✎</button>
          <button class="tile-remove" type="button" aria-label="Supprimer">&times;</button>
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
    el.querySelector('.tile-move-left').addEventListener('click', () => store.moveTile(tile.id, -1));
    el.querySelector('.tile-move-right').addEventListener('click', () => store.moveTile(tile.id, 1));
    return el;
  }

  function updateFormFieldsForType() {
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    // KPI/jauge : pas de dimension de regroupement ni de drill-down, juste un agrégat sur toute la
    // sélection (le KPI peut en plus le comparer à une période via "Tendance vs", la jauge le
    // positionne sur un cadran Min/Max). Le nuage de points ajoute une 2e mesure (axe Y).
    dimensionField.hidden = typeHasNoDimension(type);
    drillField.hidden = typeHasNoDimension(type);
    trendField.hidden = !isKpi;
    gaugeMinField.hidden = !isGauge;
    gaugeMaxField.hidden = !isGauge;
    measureYField.hidden = !isScatter;
    measureLabel.textContent = isScatter ? 'Mesure X' : 'Mesure';
    updateDrillLevelsUI();
  }

  function startEditTile(tile) {
    editingTileId = tile.id;
    tileTypeSelect.value = tile.type;
    if (tile.dimension) dimensionSelect.value = tile.dimension;
    resetDrillLevels();
    const levels = tileDrillLevels(tile);
    const cols = availableColumns(store.getState().rows);
    levels.forEach((lvl, i) => {
      if (i >= drillLevelSelects.length) {
        const select = createDrillLevelSelect(i);
        fillSelect(select, cols, { blankLabel: '(aucun)' });
        drillLevelsContainer.appendChild(select);
        drillLevelSelects.push(select);
      }
      drillLevelSelects[i].value = lvl;
    });
    drillCrossFilterCheckbox.checked = !!tile.drillCrossFilter;
    measureYSelect.value = tile.measureY || '';
    gaugeMinInput.value = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    gaugeMaxInput.value = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : 100;
    updateFormFieldsForType();
    measureSelect.value = tile.measure;
    aggSelect.value = tile.aggFn;
    trendDimensionSelect.value = tile.trendDimension || '';
    submitTileBtn.textContent = '✓ Modifier la tuile';
    cancelEditBtn.hidden = false;
    addTileForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function stopEditTile() {
    editingTileId = null;
    submitTileBtn.textContent = '+ Ajouter la tuile';
    cancelEditBtn.hidden = true;
  }

  tileTypeSelect.addEventListener('change', updateFormFieldsForType);

  addTileForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const type = tileTypeSelect.value;
    const isKpi = type === 'kpi';
    const isGauge = type === 'gauge';
    const isScatter = type === 'scatter';
    const hasDimension = !typeHasNoDimension(type);
    const dimension = dimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    if (!measure || (hasDimension && !dimension)) return;
    if (isScatter && !measureYSelect.value) return; // 2e mesure obligatoire pour un nuage de points
    let gaugeMin, gaugeMax;
    if (isGauge) {
      gaugeMin = parseFloat(gaugeMinInput.value);
      gaugeMax = parseFloat(gaugeMaxInput.value);
      if (!Number.isFinite(gaugeMin) || !Number.isFinite(gaugeMax) || gaugeMax <= gaugeMin) {
        alert('Les valeurs Min/Max de la jauge doivent être des nombres valides, avec Max > Min.');
        return;
      }
    }
    const drillDimensions = hasDimension ? drillLevelSelects.map((s) => s.value).filter(Boolean) : [];
    // Garde-fou : une même colonne ne peut pas apparaître deux fois dans le chemin de drill (ni
    // reprendre la dimension racine) — un cas non gardé auparavant, repéré en généralisant à N
    // niveaux (voir ROADMAP.md, cluster "Hiérarchies & drill-down").
    const allDims = hasDimension ? [dimension].concat(drillDimensions) : [];
    if (new Set(allDims).size !== allDims.length) {
      alert('Une même colonne ne peut pas apparaître deux fois dans le drill-down, ni reprendre la dimension racine.');
      return;
    }
    const title = hasDimension ? `${measure} par ${dimension}` : `${aggFn}(${measure})`;
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
    if (editingTileId) {
      store.updateTile(editingTileId, tileData);
      stopEditTile();
    } else {
      tileData.id = 'tile_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      store.addTile(tileData);
    }
  });

  cancelEditBtn.addEventListener('click', stopEditTile);

  filterColumnSelect.addEventListener('change', updateAdvancedFilterFieldsForColumn);
  filterDateModeSelect.addEventListener('change', updateAdvancedFilterFieldsForColumn);

  advancedFilterForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const column = filterColumnSelect.value;
    if (!column) return;
    const kind = inferColumnKind(column);
    let filter;
    if (kind === 'number') {
      const min = filterMinInput.value === '' ? null : parseFloat(filterMinInput.value);
      const max = filterMaxInput.value === '' ? null : parseFloat(filterMaxInput.value);
      if (min == null && max == null) { alert('Renseignez au moins une borne (Min ou Max).'); return; }
      if (min != null && max != null && max < min) { alert('Max doit être supérieur ou égal à Min.'); return; }
      filter = { type: 'range', min, max };
    } else if (kind === 'date') {
      if (filterDateModeSelect.value === 'relativeDate') {
        filter = { type: 'relativeDate', preset: filterRelativePresetSelect.value };
      } else {
        const start = filterDateStartInput.value || null;
        const end = filterDateEndInput.value || null;
        if (!start && !end) { alert('Renseignez au moins une date (Du ou au).'); return; }
        if (start && end && end < start) { alert('La date de fin doit être postérieure à la date de début.'); return; }
        filter = { type: 'dateRange', start, end };
      }
    } else {
      const query = filterTextInput.value.trim();
      if (!query) { alert('Saisissez un texte à rechercher.'); return; }
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
    const name = (prompt('Nom de la vue à sauvegarder :') || '').trim();
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
      if (!exported) alert('Aucune tuile à exporter.');
    } catch (e) {
      console.error('[GristBI] échec de l\'export Excel', e);
      alert("Échec de l'export Excel — voir la console (F12).");
    }
  });

  addPageBtn.addEventListener('click', () => {
    const name = (prompt('Nom de la nouvelle page :', `Page ${store.getState().pages.length + 1}`) || '').trim();
    if (name) store.addPage(name);
  });

  clearFilterBtn.addEventListener('click', () => store.clearFilter());
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

  function scheduleSave(pages, currentPageId, bookmarks) {
    if (!currentTableId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      GristBI.api.saveConfig(currentTableId, pages, currentPageId, bookmarks).catch((e) => {
        console.error('[GristBI] échec de sauvegarde de la config', e);
      });
    }, 600);
  }

  // Bascule l'affichage sur `tableId`/`rows`. `seedTiles()` ne sert que si aucune config n'a
  // jamais été sauvegardée pour cette table. N'est en pratique appelée qu'UNE fois (voir
  // bootstrap() plus bas : plus de changement de table en cours de session), mais reste générique
  // (et testable) plutôt que codée en dur pour un seul appel.
  async function switchTable(tableId, rows, { seedTiles } = {}) {
    const isNewTable = tableId !== currentTableId;
    currentTableId = tableId;
    refreshColumnSelects(rows);
    store.setRows(rows);
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
    }
  }

  store.subscribe(render);

  // Connexion automatique, au chargement, à la table de test de charge (~47 000 lignes) : c'est
  // désormais LA table de travail par défaut du widget, plus besoin de cliquer sur un bouton pour
  // avoir un dashboard à tester. Idempotent côté grist-api.js (loadOrCreateStressData) : ne
  // recrée/renvoie les lignes que si la table n'existe pas encore dans le document, sinon se
  // contente de la relire (quasi instantané). Si le schéma doit un jour se complexifier (colonnes
  // en plus), il suffit de bumper STRESS_TABLE_SCHEMA_VERSION (js/grist-api.js) : une table du
  // nouveau nom sera automatiquement créée au prochain chargement, sans bouton à remettre pour ça.
  async function bootstrap() {
    await GristBI.api.init();
    rowCountEl.textContent = 'Connexion…';
    const onProgress = (phase, sent, total) => {
      const pct = Math.round((sent / total) * 100);
      rowCountEl.textContent = `Création… ${pct}% (${sent.toLocaleString('fr-FR')}/${total.toLocaleString('fr-FR')})`;
    };
    try {
      const { tableId, rows, created } = await GristBI.api.loadOrCreateStressData(onProgress);
      console.log(`[GristBI] ${tableId} ${created ? 'créée' : 'déjà présente, réutilisée telle quelle'} (${rows.length} lignes).`);
      await switchTable(tableId, rows, { seedTiles: GristBI.demoData.defaultLargeTiles });
    } catch (e) {
      console.error('[GristBI] échec de la connexion automatique au jeu de données de test de charge', e);
      rowCountEl.textContent = 'Échec de la connexion aux données — voir la console (F12).';
    }
  }
  bootstrap();
})();
