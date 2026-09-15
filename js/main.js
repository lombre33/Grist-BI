/*
 * Bootstrap de l'UI : formulaire d'ajout de tuile, rendu de la grille, câblage
 * store <-> GristBI.api (lecture de la table liée + persistance de la config).
 */
(function () {
  'use strict';
  const GristBI = window.GristBI;
  const store = (GristBI.store = GristBI.state.createStore());

  let currentTableId = null;
  let saveTimer = null;
  let lastRenderedTiles = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let demoActive = false;
  let linkedTableId = null; // dernière table réellement liée au widget dans la page Grist (via onRecords)
  let linkedRows = null;
  let editingTileId = null; // id de la tuile en cours d'édition via le formulaire, ou null (mode ajout)

  const tilesContainer = document.getElementById('tiles');
  const emptyState = document.getElementById('empty-state');
  const addTileForm = document.getElementById('add-tile-form');
  const tileTypeSelect = document.getElementById('tile-type');
  const dimensionSelect = document.getElementById('tile-dimension');
  const measureSelect = document.getElementById('tile-measure');
  const aggSelect = document.getElementById('tile-agg');
  const submitTileBtn = document.getElementById('submit-tile');
  const cancelEditBtn = document.getElementById('cancel-edit');
  const clearFilterBtn = document.getElementById('clear-filter');
  const filterBadge = document.getElementById('filter-badge');
  const rowCountEl = document.getElementById('row-count');
  const generateDemoBtn = document.getElementById('generate-demo');
  const demoBanner = document.getElementById('demo-banner');
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

  function fillSelect(select, options) {
    const current = select.value;
    select.innerHTML = options.map((c) => `<option value="${c}">${c}</option>`).join('');
    if (options.includes(current)) select.value = current;
  }

  function refreshColumnSelects(rows) {
    const cols = availableColumns(rows);
    fillSelect(dimensionSelect, cols);
    fillSelect(measureSelect, cols);
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
    for (const tile of state.tiles) {
      let el = existingEls.get(tile.id);
      if (!el) {
        el = buildTileElement(tile);
        existingEls.set(tile.id, el);
      }
      if (previousEl) previousEl.after(el); else tilesContainer.prepend(el);
      previousEl = el;
    }

    emptyState.hidden = state.tiles.length > 0;
    for (const tile of state.tiles) GristBI.charts.renderTile(tile, state, tilesContainer);
    // Le nombre de tuiles change la largeur de chaque colonne de la grille CSS ; ECharts ne
    // réagit pas seul à un redimensionnement de son conteneur (pas d'observer par défaut).
    GristBI.charts.resizeAll();

    filterBadge.hidden = !state.activeFilter;
    if (state.activeFilter) {
      filterBadge.textContent = `Filtre actif : ${state.activeFilter.column} = ${state.activeFilter.value}`;
    }
    rowCountEl.textContent = `${state.rows.length} ligne(s)`;

    // `tiles` ne change de référence que via setTiles/addTile/removeTile (state.js) : un rendu
    // déclenché par un simple rafraîchissement de données (setRows) ne doit pas re-déclencher une
    // écriture dans le document Grist (évite de polluer l'historique à chaque édition externe).
    if (state.tiles !== lastRenderedTiles) {
      lastRenderedTiles = state.tiles;
      scheduleSave(state.tiles);
    }
  }

  function buildTileElement(tile) {
    const el = document.createElement('div');
    el.className = `tile tile-${tile.type}`;
    el.dataset.tileId = tile.id;
    const header = `<div class="tile-header"><span>${escapeHtml(tile.title)}</span>
        <span class="tile-actions">
          <button class="tile-edit" type="button" aria-label="Modifier">✎</button>
          <button class="tile-remove" type="button" aria-label="Supprimer">&times;</button>
        </span></div>`;
    el.innerHTML = tile.type === 'kpi'
      ? `${header}
         <div class="tile-kpi"><span class="tile-kpi-value">-</span>
           <span class="tile-kpi-label">${escapeHtml(tile.aggFn)}(${escapeHtml(tile.measure)})</span></div>`
      : `${header}
         <div class="tile-chart" data-tile-id="${tile.id}"></div>`;
    el.querySelector('.tile-remove').addEventListener('click', () => {
      if (tile.id === editingTileId) stopEditTile(); // formulaire en cours d'édition sur une tuile qui disparaît
      store.removeTile(tile.id);
    });
    el.querySelector('.tile-edit').addEventListener('click', () => startEditTile(tile));
    return el;
  }

  function updateDimensionFieldVisibility() {
    // Une carte KPI n'a pas de dimension de regroupement, juste un agrégat sur toute la sélection.
    dimensionSelect.closest('.field').hidden = tileTypeSelect.value === 'kpi';
  }

  function startEditTile(tile) {
    editingTileId = tile.id;
    tileTypeSelect.value = tile.type;
    updateDimensionFieldVisibility();
    if (tile.dimension) dimensionSelect.value = tile.dimension;
    measureSelect.value = tile.measure;
    aggSelect.value = tile.aggFn;
    submitTileBtn.textContent = '✓ Modifier la tuile';
    cancelEditBtn.hidden = false;
    addTileForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function stopEditTile() {
    editingTileId = null;
    submitTileBtn.textContent = '+ Ajouter la tuile';
    cancelEditBtn.hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  tileTypeSelect.addEventListener('change', updateDimensionFieldVisibility);

  addTileForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const type = tileTypeSelect.value;
    const dimension = dimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    if (!measure || (type !== 'kpi' && !dimension)) return;
    const title = type === 'kpi' ? `${aggFn}(${measure})` : `${measure} par ${dimension}`;
    if (editingTileId) {
      store.updateTile(editingTileId, { type, dimension, measure, aggFn, title });
      stopEditTile();
    } else {
      store.addTile({
        id: 'tile_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type,
        dimension,
        measure,
        aggFn,
        title
      });
    }
  });

  cancelEditBtn.addEventListener('click', stopEditTile);

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

  function scheduleSave(tiles) {
    if (!currentTableId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      GristBI.api.saveConfig(currentTableId, tiles).catch((e) => {
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
      store.setTiles(saved.length ? saved : (seedTiles ? seedTiles() : []));
    }
    updateDemoBanner();
  }

  function updateDemoBanner() {
    demoBanner.hidden = !(demoActive && linkedTableId && linkedTableId !== currentTableId);
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
