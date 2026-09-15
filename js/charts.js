/*
 * Rendu des tuiles (bar/pie/kpi) avec ECharts : filtres croisés multiples, tendance KPI, et
 * drill-down multi-niveaux (jusqu'à 2 niveaux au-delà de la dimension racine, voir
 * GristBI.data.tileDrillLevels) avec fil d'Ariane. Dépend du global `echarts` (js/vendor/echarts/,
 * voir index.html) et de GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const {
    groupByAggregate, applyFilters, sameValue, aggregateSingle, computeTrend, escapeHtml, tileDrillLevels
  } = GristBI.data;

  const chartInstances = new Map();

  // Palette catégorielle validée colorblind-safe (skill dataviz de ce projet,
  // references/palette.md — worst adjacent CVD ΔE 9.1 clair, OKLab, cible ≥8 — ordre figé, jamais
  // cyclé au hasard). Camembert : ECharts assigne une couleur par part dans cet ordre. Barres :
  // une seule série -> une seule couleur (le 1er slot, l'accent bleu) plutôt qu'une couleur par
  // catégorie, redondant avec les libellés déjà présents sur l'axe.
  const CATEGORICAL_PALETTE = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'
  ];

  // Dimension actuellement affichée par une tuile bar/pie : sa dimension racine si `drillPath` est
  // vide, sinon le niveau correspondant à la profondeur atteinte (voir state.js:drillInto/drillUp).
  function currentDimension(tile, drillPath) {
    if (!drillPath || !drillPath.length) return tile.dimension;
    const levels = tileDrillLevels(tile);
    return levels[drillPath.length - 1] || tile.dimension;
  }

  function renderTile(tile, state, container) {
    // Une tuile qui EST la source d'un filtre s'affiche non filtrée SUR CE FILTRE LÀ (pour rester
    // cliquable sur tous ses segments) ; elle reçoit quand même les filtres posés par d'AUTRES
    // tuiles. Plusieurs filtres simultanés (sur des colonnes différentes) s'appliquent tous en ET.
    const filtersFromOtherTiles = state.activeFilters.filter((f) => f.sourceTileId !== tile.id);
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    const rowsForTile = applyFilters(state.rows, filtersFromOtherTiles.concat(drillPath));

    if (tile.type === 'kpi') {
      renderKpi(tile, rowsForTile, container);
    } else {
      renderChart(tile, rowsForTile, state, container, drillPath);
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

  function renderChart(tile, rows, state, container, drillPath) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    renderBreadcrumb(tile, drillPath, container);
    if (typeof echarts === 'undefined') {
      // Pas d'erreur JS ici : sans ce message, la tuile resterait juste vide sans indice (voir le
      // bandeau #echarts-warning dans main.js pour le diagnostic complet).
      el.textContent = 'ECharts indisponible — voir le bandeau en haut de page.';
      return;
    }

    const dimension = currentDimension(tile, drillPath);

    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
      // Ne PAS capturer `tile`/`dimension`/`drillPath` du rendu courant dans cette closure : elle
      // n'est créée qu'une fois (instance mise en cache), donc resterait périmée après une édition
      // de tuile (cf. HYPOTHESES.md) ou un drill-down. On relit l'état vivant à chaque clic à la
      // place, en ne fixant que l'id de la tuile (stable, lui, tout au long de sa vie).
      instance.on('click', (params) => {
        const liveState = GristBI.store.getState();
        const currentTile = liveState.tiles.find((t) => t.id === tile.id);
        if (!currentTile) return; // tuile supprimée entre-temps
        const livePath = (liveState.drillIns && liveState.drillIns[currentTile.id]) || [];
        const dim = currentDimension(currentTile, livePath);
        const levels = tileDrillLevels(currentTile);
        if (livePath.length < levels.length) {
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
          color: CATEGORICAL_PALETTE,
          tooltip: { trigger: 'item' },
          series: [{
            type: 'pie',
            radius: '65%',
            data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
          }]
        }
      : {
          color: CATEGORICAL_PALETTE,
          // `containLabel: true` : sans ça, ECharts réserve une marge gauche estimée AVANT de
          // savoir combien de place le formatter compact va réellement prendre (variable selon la
          // valeur : "0" vs "2,7 M") — l'estimation était trop courte, dessinant une partie du
          // texte hors du canvas (silencieusement coupé, pas d'erreur). `containLabel` fait
          // recalculer la marge à partir du texte réellement rendu.
          grid: { containLabel: true, left: 8, right: 12, top: 24, bottom: 8 },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
          yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
          series: [{
            type: 'bar',
            data: agg.map((d) => ({ value: d.value, itemStyle: dim(d.dimension) }))
          }]
        };
    instance.setOption(option, true);
  }

  // Fil d'Ariane : la dimension racine (cliquable dès qu'on a drillé, pour tout remonter) puis un
  // segment par niveau franchi (chacun cliquable pour remonter jusqu'à CE niveau, sauf le dernier).
  function renderBreadcrumb(tile, drillPath, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (!el) return;
    const levels = tileDrillLevels(tile);
    if (!levels.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!drillPath.length) {
      el.innerHTML = `<span>${escapeHtml(tile.dimension)}</span>
        <span class="breadcrumb-hint">(cliquer pour détailler par ${escapeHtml(levels[0])})</span>`;
      return;
    }
    const rootCrumb = `<button type="button" class="breadcrumb-link" data-depth="0">${escapeHtml(tile.dimension)}</button>`;
    const pathCrumbs = drillPath.map((step, i) => {
      const depth = i + 1;
      const label = `${escapeHtml(String(step.value))} · ${escapeHtml(levels[i])}`;
      return depth === drillPath.length ? `<span>${label}</span>`
        : `<button type="button" class="breadcrumb-link" data-depth="${depth}">${label}</button>`;
    });
    el.innerHTML = [rootCrumb].concat(pathCrumbs).join(' <span class="breadcrumb-sep">▸</span> ');
    el.querySelectorAll('.breadcrumb-link').forEach((btn) => {
      btn.addEventListener('click', () => GristBI.store.drillUp(tile.id, Number(btn.dataset.depth)));
    });
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
  }

  // Format compact ("2,7 M", "150 k") pour les libellés d'AXE seulement (pas les cartes KPI ni les
  // info-bulles, qui gardent la précision exacte). [BUG RÉEL trouvé en capturant la première version
  // de cette passe de design] sur le jeu de test de charge, les valeurs à 7 chiffres (~2 700 000)
  // dépassaient la largeur d'axe disponible dans une tuile ; ECharts repliait le libellé sur 2
  // lignes et la partie haute sortait du cadre visible, n'affichant plus que "000" empilés.
  const compactNumberFormatter = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  function formatCompactNumber(n) {
    return compactNumberFormatter.format(n);
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
