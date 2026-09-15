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
  let lastRenderedTiles = null; // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
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
    drillLevelSelects.forEach((select) => fillSelect(select, cols, { blankLabel: '(aucun)' }));
    fillSelect(trendDimensionSelect, cols, { blankLabel: '(aucune)' });
  }

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
    const isKpi = tileTypeSelect.value === 'kpi';
    const lastSelect = drillLevelSelects[drillLevelSelects.length - 1];
    addDrillLevelBtn.hidden = isKpi || !lastSelect || !lastSelect.value || drillLevelSelects.length >= MAX_DRILL_LEVELS;
    drillCrossFilterField.hidden = isKpi || !drillLevelSelects[0] || !drillLevelSelects[0].value;
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
    const dimension = dimensionSelect.value;
    const measure = measureSelect.value;
    const aggFn = aggSelect.value;
    if (!measure || (type !== 'kpi' && !dimension)) return;
    const drillDimensions = type !== 'kpi' ? drillLevelSelects.map((s) => s.value).filter(Boolean) : [];
    // Garde-fou : une même colonne ne peut pas apparaître deux fois dans le chemin de drill (ni
    // reprendre la dimension racine) — un cas non gardé auparavant, repéré en généralisant à N
    // niveaux (voir ROADMAP.md, cluster "Hiérarchies & drill-down").
    const allDims = type !== 'kpi' ? [dimension].concat(drillDimensions) : [];
    if (new Set(allDims).size !== allDims.length) {
      alert('Une même colonne ne peut pas apparaître deux fois dans le drill-down, ni reprendre la dimension racine.');
      return;
    }
    const title = type === 'kpi' ? `${aggFn}(${measure})` : `${measure} par ${dimension}`;
    const tileData = { type, dimension, measure, aggFn, title };
    // drillDimensions/drillCrossFilter/trendDimension explicitement mis à `undefined` quand non
    // pertinents pour le type (plutôt que simplement omis) : `store.updateTile` fusionne le patch
    // via Object.assign, qui ne fait QUE écraser les clés présentes dans l'objet — omettre une clé
    // laisserait une ancienne valeur fantôme sur la tuile éditée (ex. un drill-down retiré via le
    // formulaire resterait actif en pratique) ; l'inclure avec `undefined` l'efface bien.
    tileData.drillDimensions = drillDimensions.length ? drillDimensions : undefined;
    tileData.drillCrossFilter = drillDimensions.length ? drillCrossFilterCheckbox.checked : undefined;
    tileData.trendDimension = (type === 'kpi' && trendDimensionSelect.value) ? trendDimensionSelect.value : undefined;
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
      if (editingTileId) stopEditTile(); // le formulaire en cours d'édition référence une tuile de l'ancienne table
      const saved = await GristBI.api.loadConfig(tableId);
      store.setTiles(saved.tiles.length ? saved.tiles : (seedTiles ? seedTiles() : []));
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
