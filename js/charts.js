/*
 * Rendu des tuiles (bar/pie/kpi) avec ECharts, et câblage du clic -> filtre croisé.
 * Dépend du global `echarts` (chargé en CDN, voir index.html) et de GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const { groupByAggregate, applyFilter, aggregateSingle } = GristBI.data;

  const chartInstances = new Map();

  function renderTile(tile, state, container) {
    // Une tuile qui EST la source du filtre actif s'affiche non filtrée (pour rester cliquable sur
    // tous ses segments) ; toutes les autres tuiles reçoivent les lignes filtrées. Comportement
    // inspiré du cross-filtering Power BI, simplifié : un seul filtre actif à la fois pour ce POC.
    const isSource = state.activeFilter && state.activeFilter.sourceTileId === tile.id;
    const rowsForTile = isSource ? state.rows : applyFilter(state.rows, state.activeFilter);

    if (tile.type === 'kpi') {
      renderKpi(tile, rowsForTile, container);
    } else {
      renderChart(tile, rowsForTile, state, container);
    }
  }

  function renderKpi(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-value`);
    if (!el) return;
    const value = aggregateSingle(rows, tile.measure, tile.aggFn);
    el.textContent = formatNumber(value);
  }

  function renderChart(tile, rows, state, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      // Pas d'erreur JS ici : sans ce message, la tuile resterait juste vide sans indice (voir le
      // bandeau #echarts-warning dans main.js pour le diagnostic complet).
      el.textContent = 'ECharts indisponible — voir le bandeau en haut de page.';
      return;
    }

    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
      instance.on('click', (params) => {
        GristBI.store.toggleFilter(tile.dimension, params.name, tile.id);
      });
    }

    const agg = groupByAggregate(rows, tile.dimension, tile.measure, tile.aggFn);
    const isActiveHere = state.activeFilter && state.activeFilter.column === tile.dimension;
    const dim = (d) => (isActiveHere && state.activeFilter.value !== d
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
