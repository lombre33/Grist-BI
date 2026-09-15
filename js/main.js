/*
 * Bootstrap de l'UI : formulaire d'ajout/édition de tuile, rendu de la grille et des filtres
 * croisés actifs, câblage store <-> GristBI.api (lecture de la table liée + persistance config).
 */
(function () {
  'use strict';
  const GristBI = window.GristBI;
  const store = (GristBI.store = GristBI.state.createStore());
  const { escapeHtml } = GristBI.data;

  let currentTableId = null;
  let saveTimer = null;
  let lastRenderedTiles = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let lastRenderedBookmarks = null; // idem, côté bookmarks
  let demoActive = false;
  let linkedTableId = null; // dernière table réellement liée au widget dans la page Grist (via onRecords)
  let linkedRows = null;
  let editingTileId = null; // id de la tuile en cours d'édition via le formulaire, ou null (mode ajout)

  const tilesContainer = document.getElementById('tiles');
  const emptyState = document.getElementById('empty-state');
  const addTileForm = document.getElementById('add-tile-form');
  const tileTypeSelect = document.getElementById('tile-type');
  const dimensionField = document.getElementById('tile-dimension-field');
  const dimensionSelect = document.getElementById('tile-dimension');
  const drillField = document.getElementById('tile-drill-field');
  const drillDimensionSelect = document.getElementById('tile-drill-dimension');
  const measureSelect = document.getElementById('tile-measure');
  const aggSelect = document.getElementById('tile-agg');
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
  const generateDemoBtn = document.getElementById('generate-demo');
  const demoBanner = document.getElementById('demo-banner');
  const demoBannerTable = document.getElementById('demo-banner-table');
  const backToLinkedBtn = document.getElementById('back-to-linked');
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
    fillSelect(drillDimensionSelect, cols, { blankLabel: '(aucun)' });
    fillSelect(trendDimensionSelect, cols, { blankLabel: '(aucune)' });
  }

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
    for (const tile of state.tiles) GristBI.charts.renderTile(tile, state, tilesContainer);
    // Le nombre de tuiles change la largeur de chaque colonne de la grille CSS ; ECharts ne
    // réagit pas seul à un redimensionnement de son conteneur (pas d'observer par défaut).
    GristBI.charts.resizeAll();

    renderFilterBadges(state.activeFilters);
    renderBookmarks(state.bookmarks);
    rowCountEl.textContent = `${state.rows.length} ligne(s)`;

    // `tiles`/`bookmarks` ne changent de référence que via leurs actions dédiées (state.js) : un
    // rendu déclenché par un simple rafraîchissement de données (setRows) ne doit pas re-déclencher
    // une écriture dans le document Grist (évite de polluer l'historique à chaque édition externe).
    if (state.tiles !== lastRenderedTiles || state.bookmarks !== lastRenderedBookmarks) {
      lastRenderedTiles = state.tiles;
      lastRenderedBookmarks = state.bookmarks;
      scheduleSave(state.tiles, state.bookmarks);
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
    const isKpi = tileTypeSelect.value === 'kpi';
    // Une carte KPI n'a pas de dimension de regroupement ni de drill-down, juste un agrégat sur
    // toute la sélection (éventuellement comparé à une période via "Tendance vs").
    dimensionField.hidden = isKpi;
    drillField.hidden = isKpi;
    trendField.hidden = !isKpi;
  }

  function startEditTile(tile) {
    editingTileId = tile.id;
    tileTypeSelect.value = tile.type;
    updateFormFieldsForType();
    if (tile.dimension) dimensionSelect.value = tile.dimension;
    drillDimensionSelect.value = tile.drillDimension || '';
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
    const dimension = dimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    if (!measure || (type !== 'kpi' && !dimension)) return;
    const title = type === 'kpi' ? `${aggFn}(${measure})` : `${measure} par ${dimension}`;
    const tileData = { type, dimension, measure, aggFn, title };
    // drillDimension/trendDimension seulement quand pertinents pour le type, pour ne pas laisser
    // une valeur fantôme d'un type précédent si l'utilisateur bascule le type en cours d'édition.
    if (type !== 'kpi' && drillDimensionSelect.value) tileData.drillDimension = drillDimensionSelect.value;
    if (type === 'kpi' && trendDimensionSelect.value) tileData.trendDimension = trendDimensionSelect.value;
    if (editingTileId) {
      store.updateTile(editingTileId, tileData);
      stopEditTile();
    } else {
      tileData.id = 'tile_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      store.addTile(tileData);
    }
  });

  cancelEditBtn.addEventListener('click', stopEditTile);

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

  function scheduleSave(tiles, bookmarks) {
    if (!currentTableId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      GristBI.api.saveConfig(currentTableId, tiles, bookmarks).catch((e) => {
        console.error('[GristBI] échec de sauvegarde de la config', e);
      });
    }, 600);
  }

  // Bascule l'affichage sur `tableId`/`rows` (table liée réelle OU table de démo générée).
  // `seedTiles()` ne sert que si aucune config n'a jamais été sauvegardée pour cette table.
  async function switchTable(tableId, rows, { isDemo, seedTiles } = {}) {
    const isNewTable = tableId !== currentTableId;
    currentTableId = tableId;
    demoActive = !!isDemo;
    refreshColumnSelects(rows);
    store.setRows(rows);
    if (isNewTable) {
      // Un filtre croisé référence une colonne/valeur d'un dataset précis : le garder en changeant
      // de table (démo <-> table liée) afficherait un badge sans rapport avec ce qui est affiché.
      // À l'inverse, une simple régénération des données de LA MÊME table de démo (isNewTable
      // false) doit le laisser actif.
      store.clearFilter();
      if (editingTileId) stopEditTile(); // le formulaire en cours d'édition référence une tuile de l'ancienne table
      const saved = await GristBI.api.loadConfig(tableId);
      store.setTiles(saved.tiles.length ? saved.tiles : (seedTiles ? seedTiles() : []));
      store.setBookmarks(saved.bookmarks);
    }
    updateDemoBanner();
  }

  function updateDemoBanner() {
    const show = demoActive && linkedTableId && linkedTableId !== currentTableId;
    demoBanner.hidden = !show;
    // Nom de la table de démo lu dynamiquement (currentTableId) plutôt que codé en dur dans le
    // HTML : son nom change à chaque évolution du schéma (voir DEMO_TABLE_SCHEMA_VERSION,
    // js/grist-api.js), un texte figé serait rapidement faux.
    if (show) demoBannerTable.textContent = currentTableId;
  }

  generateDemoBtn.addEventListener('click', async () => {
    generateDemoBtn.disabled = true;
    const originalLabel = generateDemoBtn.textContent;
    generateDemoBtn.textContent = 'Génération…';
    try {
      const { tableId, rows } = await GristBI.api.generateDemoData();
      await switchTable(tableId, rows, { isDemo: true, seedTiles: GristBI.demoData.defaultTiles });
    } catch (e) {
      console.error('[GristBI] échec de génération des données de démo', e);
      alert('Échec de la génération des données de démo : ' + e.message);
    } finally {
      generateDemoBtn.disabled = false;
      generateDemoBtn.textContent = originalLabel;
    }
  });

  backToLinkedBtn.addEventListener('click', () => {
    if (linkedTableId && linkedRows) switchTable(linkedTableId, linkedRows, { isDemo: false });
  });

  store.subscribe(render);

  GristBI.api.init({
    onRows: (rows, tableId) => {
      linkedTableId = tableId;
      linkedRows = rows;
      if (!demoActive) {
        switchTable(tableId, rows, { isDemo: false });
      } else {
        updateDemoBanner(); // la table liée a changé en arrière-plan ; ne pas quitter le mode démo tout seul
      }
    }
  });
})();
