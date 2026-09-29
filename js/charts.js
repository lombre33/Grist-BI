/*
 * Rendu des tuiles (bar/pie/kpi/gauge/treemap/scatter) avec ECharts : filtres croisés multiples,
 * tendance KPI, et drill-down multi-niveaux (voir GristBI.data.tileDrillLevels) avec fil d'Ariane.
 * Dépend du global `echarts` (js/vendor/echarts/, voir index.html) et de GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const {
    groupByAggregate, sameValue, aggregateSingle, pivotTable, computeTrend, escapeHtml,
    tileDrillLevels, currentDimension, rowsForTile
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

  function renderTile(tile, state, container) {
    // Filtrage délégué à GristBI.data.rowsForTile (source de vérité partagée avec l'export Excel,
    // voir data.js) : une tuile qui EST la source d'un filtre croisé s'affiche non filtrée SUR CE
    // FILTRE LÀ (pour rester cliquable sur tous ses segments) ; elle reçoit quand même les filtres
    // posés par d'AUTRES tuiles ainsi que les filtres avancés (qui s'appliquent à toutes les tuiles
    // sans exception, `sourceTileId` n'a jamais de sens pour eux) et son propre drill-down.
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    const rows = rowsForTile(tile, state);

    if (tile.type === 'kpi') {
      renderKpi(tile, rows, container);
    } else if (tile.type === 'gauge') {
      renderGauge(tile, rows, container);
    } else if (tile.type === 'pivot') {
      renderPivot(tile, rows, state, container);
    } else {
      renderChart(tile, rows, state, container, drillPath);
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

  // Une jauge est sémantiquement proche d'une carte KPI (une seule valeur agrégée, pas de
  // dimension) : réutilise aggregateSingle telle quelle. Rendue via ECharts (contrairement à la
  // carte KPI, en texte pur) pour l'aiguille/le cadran, donc utilise .tile-chart comme bar/pie.
  // Pas de dimension -> pas de gestionnaire de clic (rien à filtrer/détailler par segment).
  function renderGauge(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      el.textContent = 'ECharts indisponible — voir le bandeau en haut de page.';
      return;
    }
    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
    }
    const value = aggregateSingle(rows, tile.measure, tile.aggFn);
    const min = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    const max = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : Math.max(value * 1.5, 1);
    instance.setOption({
      series: [{
        type: 'gauge',
        min,
        max,
        // splitNumber par défaut d'ECharts (10, donc 11 libellés) se chevauche systématiquement à
        // la taille d'une tuile [BUG RÉEL trouvé en capturant un screenshot] : 4 divisions (5
        // libellés : min, 1/4, 1/2, 3/4, max) restent lisibles à n'importe quelle taille de jauge.
        splitNumber: 4,
        itemStyle: { color: CATEGORICAL_PALETTE[0] },
        progress: { show: true, width: 12 },
        axisLine: { lineStyle: { width: 12 } },
        axisTick: { show: false },
        splitLine: { length: 12 },
        axisLabel: { distance: 14, fontSize: 10, formatter: formatCompactNumber },
        pointer: { show: true },
        title: { show: false },
        detail: { valueAnimation: true, formatter: (v) => formatNumber(v), fontSize: 18, offsetCenter: [0, '70%'] },
        data: [{ value }]
      }]
    }, true);
  }

  // Tableau croisé dynamique : rendu en table HTML plutôt qu'en graphique ECharts (aucune série
  // ECharts adaptée à une grille lignes × colonnes, voir ROADMAP.md). Pas de gestion d'instance
  // ECharts à mettre en cache ici : l'intégralité de la table est reconstruite à chaque rendu
  // (comme buildTileElement/render() le fait déjà pour tout le DOM des tuiles), donc pas de risque
  // de closure figée sur un ancien état (voir la remarque sur renderChart plus haut) — les
  // gestionnaires de clic posés ci-dessous lisent `tile`/`state` du rendu COURANT à chaque fois.
  //
  // Cross-filtering à deux dimensions indépendantes plutôt qu'un mécanisme dédié : un clic sur une
  // cellule de donnée pose/retire un filtre sur la dimension LIGNE et un filtre sur la dimension
  // COLONNE (deux appels à `toggleFilter`, déjà cumulatifs par colonne — voir state.js), un clic sur
  // un en-tête de ligne/colonne ne pose/retire que le filtre correspondant à CETTE dimension. Reclic
  // sur la même cellule retire les deux (toggleFilter est déjà idempotent par colonne). Les totaux
  // (ligne/colonne/général) ne sont jamais cliquables : ce sont des agrégats, pas un point de donnée.
  function renderPivot(tile, rows, state, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const pivot = pivotTable(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
    if (!pivot.rowKeys.length || !pivot.colKeys.length) {
      el.innerHTML = '<p class="pivot-empty">Aucune donnée à afficher.</p>';
      return;
    }
    const rowFilter = state.activeFilters.find((f) => f.column === tile.dimension);
    const colFilter = state.activeFilters.find((f) => f.column === tile.columnDimension);
    const fmt = (v) => (v == null ? '–' : formatNumber(v));

    const headCells = pivot.colKeys.map((ck) => {
      const active = colFilter && sameValue(colFilter.value, ck);
      const dimmed = colFilter && !active;
      const cls = `pivot-col-header${active ? ' pivot-active' : ''}${dimmed ? ' pivot-dimmed' : ''}`;
      return `<th class="${cls}" data-axis="col" data-value="${escapeHtml(String(ck))}">${escapeHtml(String(ck))}</th>`;
    }).join('');

    const bodyRows = pivot.rowKeys.map((rk, ri) => {
      const rowActive = rowFilter && sameValue(rowFilter.value, rk);
      const rowDimmed = rowFilter && !rowActive;
      const rowHeaderCls = `pivot-row-header${rowActive ? ' pivot-active' : ''}${rowDimmed ? ' pivot-dimmed' : ''}`;
      const cells = pivot.cells[ri].map((v, ci) => {
        const ck = pivot.colKeys[ci];
        const colActive = colFilter && sameValue(colFilter.value, ck);
        const colDimmed = colFilter && !colActive;
        const cellActive = rowActive && colActive;
        const cellDimmed = !cellActive && (rowDimmed || colDimmed);
        const cls = `pivot-cell${cellActive ? ' pivot-active' : ''}${cellDimmed ? ' pivot-dimmed' : ''}${v == null ? ' pivot-cell-empty' : ''}`;
        return `<td class="${cls}" data-axis="cell" data-row="${escapeHtml(String(rk))}" data-col="${escapeHtml(String(ck))}">${fmt(v)}</td>`;
      }).join('');
      return `<tr>
        <th class="${rowHeaderCls}" data-axis="row" data-value="${escapeHtml(String(rk))}">${escapeHtml(String(rk))}</th>
        ${cells}
        <td class="pivot-cell pivot-total-cell">${fmt(pivot.rowTotals[ri])}</td>
      </tr>`;
    }).join('');

    const totalRow = `<tr class="pivot-total-row">
      <th class="pivot-row-header pivot-total-label">Total</th>
      ${pivot.colTotals.map((v) => `<td class="pivot-cell pivot-total-cell">${fmt(v)}</td>`).join('')}
      <td class="pivot-cell pivot-total-cell pivot-grand-total">${fmt(pivot.grandTotal)}</td>
    </tr>`;

    el.innerHTML = `<table class="pivot-table">
      <thead><tr><th class="pivot-corner"></th>${headCells}<th class="pivot-col-header pivot-total-label">Total</th></tr></thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>`;

    el.querySelectorAll('th[data-axis="row"]').forEach((th) => {
      th.addEventListener('click', () => GristBI.store.toggleFilter(tile.dimension, th.dataset.value, tile.id));
    });
    el.querySelectorAll('th[data-axis="col"]').forEach((th) => {
      th.addEventListener('click', () => GristBI.store.toggleFilter(tile.columnDimension, th.dataset.value, tile.id));
    });
    el.querySelectorAll('td[data-axis="cell"]').forEach((td) => {
      if (td.classList.contains('pivot-cell-empty')) return; // rien à filtrer sur une intersection sans donnée
      td.addEventListener('click', () => {
        GristBI.store.toggleFilter(tile.dimension, td.dataset.row, tile.id);
        GristBI.store.toggleFilter(tile.columnDimension, td.dataset.col, tile.id);
      });
    });
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
    // `containLabel: true` : sans ça, ECharts réserve une marge estimée AVANT de savoir combien de
    // place le formatter compact va réellement prendre (variable selon la valeur : "0" vs "2,7 M")
    // — l'estimation était trop courte, dessinant une partie du texte hors du canvas (silencieusement
    // coupé, pas d'erreur, voir HYPOTHESES.md). `containLabel` recalcule la marge à partir du texte
    // réellement rendu. Réutilisé pour tout axe numérique (bar, scatter), pas seulement le cas où le
    // bug a été trouvé la première fois.
    const numericGrid = { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 };

    let option;
    if (tile.type === 'pie') {
      option = {
        color: CATEGORICAL_PALETTE,
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie',
          radius: '65%',
          data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'treemap') {
      option = {
        color: CATEGORICAL_PALETTE,
        tooltip: { trigger: 'item' },
        series: [{
          type: 'treemap',
          roam: false,
          // Version PLATE délibérément (voir ROADMAP.md) : un seul niveau de rectangles, pas de
          // hiérarchie imbriquée. `nodeClick: false` désactive le zoom-sur-clic natif d'ECharts
          // (pensé pour une hiérarchie à plusieurs niveaux) pour laisser le clic au gestionnaire
          // générique ci-dessus (drill-down/cross-filter), sans comportement concurrent.
          nodeClick: false,
          breadcrumb: { show: false },
          data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'scatter') {
      // Version agrégée (pas ligne-à-ligne) : un point par valeur de la dimension, ses coordonnées
      // X/Y sont les agrégats de deux mesures DIFFÉRENTES sur ce même groupe. Les deux appels à
      // groupByAggregate portent sur le même `rows`/`dimension`, donc le même ensemble de groupes,
      // mais on associe par NOM de dimension (Map) plutôt que par index pour rester correct même si
      // l'ordre venait à diverger un jour entre les deux appels.
      const aggY = groupByAggregate(rows, dimension, tile.measureY, tile.aggFn);
      const aggYByDimension = new Map(aggY.map((d) => [d.dimension, d.value]));
      option = {
        color: CATEGORICAL_PALETTE,
        grid: numericGrid,
        tooltip: {
          trigger: 'item',
          formatter: (params) => `${escapeHtml(String(params.name))}<br/>`
            + `${escapeHtml(tile.measure)} : ${formatNumber(params.value[0])}<br/>`
            + `${escapeHtml(tile.measureY)} : ${formatNumber(params.value[1])}`
        },
        xAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        series: [{
          type: 'scatter',
          symbolSize: 14,
          // `name` explicite : contrairement à bar (axe catégoriel, ECharts déduit params.name de
          // l'index sur l'axe), scatter a deux axes numériques -> rien n'associe un point à sa
          // catégorie sans ce champ, et le gestionnaire de clic générique deviendrait muet
          // (params.name undefined, drill/cross-filter sur une valeur "undefined").
          data: agg.map((d) => ({
            name: d.dimension,
            value: [d.value, aggYByDimension.get(d.dimension)],
            itemStyle: dim(d.dimension)
          }))
        }]
      };
    } else {
      // bar (par défaut)
      option = {
        color: CATEGORICAL_PALETTE,
        grid: numericGrid,
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
        yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        series: [{
          type: 'bar',
          data: agg.map((d) => ({ value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    }
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
