/*
 * Rendu des tuiles (bar/pie/kpi) avec ECharts : filtres croisés multiples, tendance KPI, et
 * drill-down (un niveau, tile.drillDimension) avec fil d'Ariane. Dépend du global `echarts`
 * (js/vendor/echarts/, voir index.html) et de GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const { groupByAggregate, applyFilters, sameValue, aggregateSingle, computeTrend, escapeHtml } = GristBI.data;

  const chartInstances = new Map();

  // Dimension actuellement affichée par une tuile bar/pie : celle de base, ou son
  // `drillDimension` si la tuile a été "drillée" (voir renderTile/state.js:drillInto).
  function currentDimension(tile, drillIn) {
    return drillIn ? tile.drillDimension : tile.dimension;
  }

  function renderTile(tile, state, container) {
    // Une tuile qui EST la source d'un filtre s'affiche non filtrée SUR CE FILTRE LÀ (pour rester
    // cliquable sur tous ses segments) ; elle reçoit quand même les filtres posés par d'AUTRES
    // tuiles. Plusieurs filtres simultanés (sur des colonnes différentes) s'appliquent tous en ET.
    const filtersFromOtherTiles = state.activeFilters.filter((f) => f.sourceTileId !== tile.id);
    const drillIn = state.drillIns && state.drillIns[tile.id];
    const rowsForTile = applyFilters(state.rows, drillIn ? filtersFromOtherTiles.concat([drillIn]) : filtersFromOtherTiles);

    if (tile.type === 'kpi') {
      renderKpi(tile, rowsForTile, container);
    } else {
      renderChart(tile, rowsForTile, state, container, drillIn);
    }
  }

  function renderKpi(tile, rows, container) {
    const valueEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-value`);
    if (!valueEl) return;
    valueEl.textContent = formatNumber(aggregateSingle(rows, tile.measure, tile.aggFn));

    const trendEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-trend`);
    if (!trendEl) return;
    const trend = tile.trendDimension ? computeTrend(rows, tile.trendDimension, tile.measure, tile.aggFn) : null;
    if (!trend) {
      trendEl.hidden = true;
      return;
    }
    const isUp = trend.deltaPct >= 0;
    trendEl.hidden = false;
    trendEl.className = `tile-kpi-trend ${isUp ? 'trend-up' : 'trend-down'}`;
    trendEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(trend.deltaPct).toFixed(1)}% vs ${trend.previousKey}`;
  }

  function renderChart(tile, rows, state, container, drillIn) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    renderBreadcrumb(tile, drillIn, container);
    if (typeof echarts === 'undefined') {
      // Pas d'erreur JS ici : sans ce message, la tuile resterait juste vide sans indice (voir le
      // bandeau #echarts-warning dans main.js pour le diagnostic complet).
      el.textContent = 'ECharts indisponible — voir le bandeau en haut de page.';
      return;
    }

    const dimension = currentDimension(tile, drillIn);

    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
      // Ne PAS capturer `tile`/`dimension`/`drillIn` du rendu courant dans cette closure : elle
      // n'est créée qu'une fois (instance mise en cache), donc resterait périmée après une édition
      // de tuile (cf. HYPOTHESES.md) ou un drill-down. On relit l'état vivant à chaque clic à la
      // place, en ne fixant que l'id de la tuile (stable, lui, tout au long de sa vie).
      instance.on('click', (params) => {
        const liveState = GristBI.store.getState();
        const currentTile = liveState.tiles.find((t) => t.id === tile.id);
        if (!currentTile) return; // tuile supprimée entre-temps
        const liveDrillIn = liveState.drillIns && liveState.drillIns[currentTile.id];
        const dim = currentDimension(currentTile, liveDrillIn);
        if (!liveDrillIn && currentTile.drillDimension) {
          GristBI.store.drillInto(currentTile.id, dim, params.name);
        } else {
          GristBI.store.toggleFilter(dim, params.name, currentTile.id);
        }
      });
    }

    const agg = groupByAggregate(rows, dimension, tile.measure, tile.aggFn);
    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    // sameValue (pas !==) : le filtre stocke souvent params.name (toujours une chaîne ECharts),
    // à comparer à `d` qui garde le type d'origine de la donnée (ex. Annee=2025, un nombre).
    const dim = (d) => (activeOnThisDimension && !sameValue(activeOnThisDimension.value, d)
      ? { opacity: 0.3 }
      : undefined);

    const option = tile.type === 'pie'
      ? {
          tooltip: { trigger: 'item' },
          series: [{
            type: 'pie',
            radius: '65%',
            data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
          }]
        }
      : {
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
          yAxis: { type: 'value' },
          series: [{
            type: 'bar',
            data: agg.map((d) => ({ value: d.value, itemStyle: dim(d.dimension) }))
          }]
        };
    instance.setOption(option, true);
  }

  function renderBreadcrumb(tile, drillIn, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (!el) return;
    if (!tile.drillDimension) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!drillIn) {
      el.innerHTML = `<span>${escapeHtml(tile.dimension)}</span>
        <span class="breadcrumb-hint">(cliquer pour détailler par ${escapeHtml(tile.drillDimension)})</span>`;
      return;
    }
    el.innerHTML = `<button type="button" class="breadcrumb-link">${escapeHtml(tile.dimension)}</button>
      <span class="breadcrumb-sep">▸</span>
      <span>${escapeHtml(String(drillIn.value))} · ${escapeHtml(tile.drillDimension)}</span>`;
    el.querySelector('.breadcrumb-link').addEventListener('click', () => GristBI.store.drillUp(tile.id));
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
  }

  function resizeAll() { chartInstances.forEach((inst) => !inst.isDisposed() && inst.resize()); }

  function disposeTile(tileId) {
    const inst = chartInstances.get(tileId);
    if (inst) { inst.dispose(); chartInstances.delete(tileId); }
  }

  // Exposé uniquement pour dev-tests/ (calcul de coordonnées pixel précises dans le test Playwright
  // via convertToPixel) - ne pas s'appuyer dessus pour de la logique applicative.
  function getInstance(tileId) { return chartInstances.get(tileId) || null; }

  GristBI.charts = { renderTile, resizeAll, disposeTile, getInstance };
})(window);
