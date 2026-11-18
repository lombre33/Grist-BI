/*
 * Rendu des tuiles — types ECharts plus récents (carte de chaleur, histogramme, boîte à moustaches,
 * calendrier, flux, soleil), petits multiples, ligne de repère et mesures temporelles. Voir js/charts.js.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.chartParts;
  const {
    measureSeriesForTile, sunburstLevels, sunburstTree, sunburstNodeSelected, smallMultiplesPanels, smallMultiplesGrid, smallMultiplesRange, histogramBins, histogramBinIsActive, boxStatsByGroup, sankeyFlows, topFlows, SANKEY_MAX_LINKS, calendarDays, filterSelects, lineShapeOf, refLineKind, cellFilterToggles, heatStops, heatRange, heatCellColors, heatTextColor, paletteColors, escapeHtml, tileDrillLevels
  } = GristBI.data;
  const { t } = GristBI.i18n;
  const { CATEGORICAL_PALETTE, DUCKDB_ROW_THRESHOLD, bumpSeq, chartTheme, computePivot, finalizeOption, fmtFor, getOrCreateChartInstance, isStale, measureText, numericGrid } = parts;

  // Clic sur une case de la carte de chaleur : filtre de la ligne ET de la colonne (js/data.js:cellFilterToggles décide lesquels).
  function toggleCellFilters(tile, rowValue, colValue) {
    cellFilterToggles(GristBI.store.getState().activeFilters, tile.dimension, rowValue, tile.columnDimension, colValue)
      .forEach((c) => GristBI.store.toggleFilter(c.column, c.value, tile.id));
  }

  // === Petits multiples (`tile.smallMultiples`, barres ou courbe avec une colonne Séries) ================================================
  // UNE instance ECharts, N grilles : un petit graphique par valeur de la colonne Séries, tous sur la MÊME échelle (sinon un petit panneau
  // ressemblerait à un grand) et sur les mêmes catégories. La géométrie est en PIXELS (js/data.js:smallMultiplesGrid) : elle ne suit pas
  // un redimensionnement seule, `instance.__refit` la recalcule (comme la jauge et le radar). Les graduations de l'axe des valeurs ne
  // s'écrivent que sur la 1re colonne, celles des catégories que sous le dernier panneau de chaque colonne : le reste du quadrillage
  // suffit à lire, et chaque panneau gagne sa place. Le nom de la série est le titre du panneau (la couleur ne porte jamais seule le nom).
  // Retourne `{ option, refit }` : `refit(w, h)` rend la partie de l'option qui ne dépend que de la taille.
  function buildSmallMultiplesOption(tile, multi, ctx) {
    const { f, tipValue, dim, palette, width, height } = ctx;
    const th = chartTheme();
    const { panels, hidden } = smallMultiplesPanels(multi.series);
    const range = smallMultiplesRange(panels);
    const cats = multi.categories;
    const n = panels.length;
    const isBar = tile.type === 'bar';
    const labelSize = Math.max(10, (GristBI.styles && GristBI.styles.current().chart && GristBI.styles.current().chart.labelSize) || 0);
    // Largeur de la marge gauche : la plus large des graduations (mesurées, au format de l'axe), jamais plus que le quart de la tuile.
    let widest = 0;
    for (let v = range.min, guard = 0; v <= range.max + range.step * 1e-6 && guard < 40; v = Math.round((v + range.step) * 1e10) / 1e10, guard++) {
      widest = Math.max(widest, measureText(f.axis(v) || '', labelSize, 400, th.font));
    }
    const left = Math.max(24, Math.min(Math.ceil(widest) + 8, Math.max(24, Math.floor((width || 300) / 4))));
    const noteH = hidden > 0 ? 14 : 0;
    const geometry = (w, h) => {
      const layout = (bottom) => smallMultiplesGrid(n, w, h, { left, bottom: bottom + noteH, right: 8, titleH: 16, gapX: 10, gapY: 8 });
      let g = layout(22);
      // Des noms de catégorie qui n'ont plus que quelques pixels (« E… ») ne se lisent pas : on les retire (l'infobulle les donne) et la
      // place qu'ils prenaient sous la dernière rangée revient aux panneaux.
      const labelRaw = g.plotW / Math.max(1, Math.min(cats.length, 4));
      const showCats = labelRaw >= 24;
      if (!showCats) g = layout(4);
      const cell = (i) => ({ c: i % g.cols, r: Math.floor(i / g.cols) });
      const isBottom = (i) => showCats && i + g.cols >= n; // aucun panneau en dessous : c'est lui qui porte les catégories
      const labelW = Math.max(20, Math.min(70, Math.floor(labelRaw)));
      return {
        g, cell, isBottom, labelW,
        grid: panels.map((_, i) => { const { c, r } = cell(i); return { left: g.xs[c], top: g.ys[r], width: g.plotW, height: g.plotH, containLabel: false }; }),
        title: panels.map((sr, i) => { const { c, r } = cell(i); return { text: String(sr.name), left: g.xs[c], top: g.ys[r] - g.titleH, textStyle: { color: th.text, fontSize: 11, fontWeight: 600, width: Math.floor(g.plotW), overflow: 'truncate' } }; })
      };
    };
    const geo = geometry(width, height);
    const color = (i) => palette[i % palette.length];
    const option = {
      color: palette,
      grid: geo.grid,
      title: geo.title,
      tooltip: { trigger: 'axis', valueFormatter: tipValue, axisPointer: { type: isBar ? 'shadow' : 'line' } },
      xAxis: panels.map((_, i) => ({
        type: 'category',
        gridIndex: i,
        data: cats,
        axisLabel: { show: geo.isBottom(i), width: geo.labelW, overflow: 'truncate', ellipsis: '…', fontSize: labelSize },
        axisTick: { show: geo.isBottom(i), alignWithLabel: true }
      })),
      yAxis: panels.map((_, i) => ({
        type: 'value',
        gridIndex: i,
        min: range.min,
        max: range.max,
        interval: range.step,
        axisLabel: { show: geo.cell(i).c === 0, formatter: f.axis, fontSize: labelSize }
      })),
      series: panels.map((sr, i) => {
        const col = color(i);
        const panelData = sr.values.map((v, k) => ({ value: v, itemStyle: dim(cats[k]) }));
        const base = { name: String(sr.name), xAxisIndex: i, yAxisIndex: i, data: panelData };
        if (isBar) return { ...base, type: 'bar', barCategoryGap: '30%', itemStyle: { color: col } };
        return {
          ...base,
          type: 'line',
          symbolSize: cats.length > 24 ? 0 : 4,
          lineStyle: { color: col },
          itemStyle: { color: col },
          ...(lineShapeOf(tile) === 'smooth' ? { smooth: 0.35 } : (lineShapeOf(tile) === 'step' ? { step: 'middle' } : {})),
          ...(tile.areaFill ? { areaStyle: { color: col, opacity: 0.25 } } : {})
        };
      }),
      graphic: hidden > 0 ? [{
        type: 'text', left: 8, bottom: 2, silent: true,
        style: { text: t('chart.smallMultiples.hidden', { shown: n, n: n + hidden }), fill: th.muted, fontSize: 11, fontFamily: th.font }
      }] : undefined
    };
    // La partie qui ne dépend que de la taille de la tuile : grilles, titres, largeur des libellés de catégorie.
    const refit = (w, h) => {
      const next = geometry(w, h);
      return { grid: next.grid, title: next.title, xAxis: panels.map((_, i) => ({ axisLabel: { show: next.isBottom(i), width: next.labelW }, axisTick: { show: next.isBottom(i) } })) };
    };
    return { option, refit };
  }

  // Trait de repère (ECharts `markLine`, sur la 1re série) + axe des valeurs élargi pour qu'il soit toujours dans le cadre : sans cela,
  // un objectif à 100 k sur des barres de 20 k serait tracé hors de la zone et on ne verrait rien. `max`/`min` en fonctions : ECharts
  // garde ses graduations rondes, et les barres commencent toujours à 0. Le libellé dit CE que c'est (« Moyenne 12,4 k », « Objectif
  // 100 k ») au format de la mesure ; texte canvas, jamais interprété comme du HTML. Silencieux : ni survol ni clic.
  function addRefLine(option, tile, ref, f, instance) {
    const th = chartTheme();
    const horizontal = tile.type === 'bar' && !!tile.horizontal; // barres horizontales : l'axe des valeurs est X
    const kind = refLineKind(tile);
    const name = t(kind === 'average' ? 'chart.refLine.average' : 'chart.refLine.value');
    const value = f.format(ref) || String(ref);
    const label = {
      show: true,
      color: th.text,
      fontSize: 11,
      backgroundColor: th.surface,
      padding: [1, 3],
      borderRadius: 3
    };
    if (horizontal) {
      // Barres horizontales : le trait est vertical, son libellé va en HAUT (marge du cadre) ; au bout (en bas) il recouvrait les graduations.
      label.formatter = `${name} ${value}`;
      label.position = 'start';
    } else {
      // Trait horizontal : libellé À DROITE de la zone de tracé, sur deux lignes (nom puis valeur). Posé dedans, au bout du trait, il
      // recouvrait la fin de la courbe et la dernière barre (voir GristBI.format.refLabelLayout) ; la marge est prise sur la grille.
      const family = th.font;
      const lay = GristBI.format.refLabelLayout([name, value], instance && instance.getWidth ? instance.getWidth() : 270, (s, px) => measureText(s, px, 400, family));
      label.formatter = lay.text;
      label.position = 'end';
      label.fontSize = lay.font;
      label.lineHeight = lay.font + 3;
      if (lay.width) { label.width = lay.width; label.overflow = 'truncate'; }
      // `numericGrid` est partagée par tous les rendus : toujours une copie, jamais la modifier.
      const grid = option.grid && !Array.isArray(option.grid) ? option.grid : {};
      option.grid = { ...grid, right: Math.max(Number(grid.right) || 0, lay.reserve) };
    }
    option.series[0].markLine = {
      silent: true,
      symbol: 'none',
      animation: false,
      data: [horizontal ? { xAxis: ref } : { yAxis: ref }],
      lineStyle: { color: th.text, type: 'dashed', width: 1.5 },
      label
    };
    const axis = option[horizontal ? 'xAxis' : 'yAxis'];
    if (axis && !Array.isArray(axis)) {
      if (ref > 0) axis.max = (v) => Math.max(v.max, ref);
      else if (ref < 0) axis.min = (v) => Math.min(v.min, ref);
    }
  }

  // Carte de chaleur (type 'heatmap') : le MÊME calcul que le tableau croisé (`computePivot`, DuckDB au-delà du seuil), dessiné en cases
  // colorées plutôt qu'en chiffres — pour repérer d'un coup d'œil où une mesure se concentre (jour × heure, région × produit).
  // Une case = (ligne, colonne) ; une intersection sans donnée reste VIDE (jamais la couleur du minimum : « pas de ligne » n'est pas
  // « la plus petite valeur »). Dégradé séquentiel d'une seule teinte (`tile.palette` : bleu/orange/vert/gris, sinon bleu), légende
  // continue dessous. Le nombre est écrit dans la case seulement quand elle est assez grande pour qu'il se lise ; sinon il est dans
  // l'infobulle — la couleur n'est jamais le seul porteur de la valeur. Clic = filtre sur la ligne ET la colonne (handleTileClick).
  async function renderHeatmap(tile, rows, state, instance) {
    const seq = bumpSeq(tile.id);
    const usingDuckDb = rows.length >= DUCKDB_ROW_THRESHOLD;
    if (usingDuckDb) instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });
    const pivot = await computePivot(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent pour cette tuile entre-temps
    instance.hideLoading();
    const range = heatRange(pivot.cells);
    instance.__grid = { rowKeys: pivot.rowKeys, colKeys: pivot.colKeys };
    if (!pivot.rowKeys.length || !pivot.colKeys.length || !range) {
      instance.setOption({ title: { text: t('chart.heatmap.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal', color: chartTheme().muted } }, series: [], xAxis: { show: false }, yAxis: { show: false }, visualMap: [], grid: {}, tooltip: { show: false } }, true);
      return;
    }
    const heatFormat = fmtFor(tile, tile.measure);
    const th = chartTheme();
    const stops = heatStops(tile.palette);
    const colors = heatCellColors(pivot.cells, stops);
    const rowFilter = state.activeFilters.find((af) => af.column === tile.dimension);
    const colFilter = state.activeFilters.find((af) => af.column === tile.columnDimension);
    const width = instance.getWidth() || 330;
    const height = instance.getHeight() || 190;
    const nRows = pivot.rowKeys.length;
    const nCols = pivot.colKeys.length;
    // Place réelle d'une case (grille moins axes et légende) : le nombre n'est écrit que si elle le contient.
    const labelRoom = Math.max(0, width - 96) / nCols >= 40 && Math.max(0, height - 74) / nRows >= 17;
    const heatPoints = [];
    pivot.cells.forEach((line, ri) => line.forEach((v, ci) => {
      if (!colors[ri][ci]) return; // intersection sans donnée : case vide
      const selected = (!rowFilter || filterSelects(rowFilter, pivot.rowKeys[ri])) && (!colFilter || filterSelects(colFilter, pivot.colKeys[ci]));
      heatPoints.push({
        value: [ci, ri, Number(v)],
        itemStyle: selected ? undefined : { opacity: 0.3 },
        label: labelRoom ? { show: true, color: colors[ri][ci].fg, fontSize: 10, formatter: () => heatFormat.axis(Number(v)) } : undefined
      });
    }));
    // Toutes les valeurs égales : l'échelle de la légende s'ouvre autour d'elles (couleur du milieu, comme heatCellColors).
    const lo = range.min === range.max ? range.min - 1 : range.min;
    const hi = range.min === range.max ? range.max + 1 : range.max;
    const option = {
      grid: { containLabel: true, left: 8, right: 12, top: 8, bottom: 36 },
      tooltip: {
        trigger: 'item',
        // Texte HTML : clés échappées (valeurs de cellules), valeur formatée par js/format.js.
        formatter: (p) => {
          const v = p && p.value;
          if (!Array.isArray(v)) return '';
          return `${escapeHtml(String(pivot.rowKeys[v[1]]))} × ${escapeHtml(String(pivot.colKeys[v[0]]))}<br/>${escapeHtml(heatFormat.format(v[2]) || '–')}`;
        }
      },
      xAxis: { type: 'category', data: pivot.colKeys.map(String), splitArea: { show: false }, axisLabel: { interval: 'auto' } },
      yAxis: { type: 'category', data: pivot.rowKeys.map(String), inverse: true, splitArea: { show: false }, axisLabel: { interval: 0, width: 72, overflow: 'truncate', ellipsis: '…' } },
      visualMap: {
        type: 'continuous', min: lo, max: hi, calculable: false, orient: 'horizontal', left: 'center', bottom: 2,
        itemWidth: 8, itemHeight: Math.max(60, Math.min(170, Math.round(width * 0.5))),
        text: [heatFormat.axis(range.max), heatFormat.axis(range.min)], textGap: 6,
        inRange: { color: stops }, textStyle: { fontSize: 10 }
      },
      series: [{
        type: 'heatmap',
        data: heatPoints,
        itemStyle: { borderColor: th.surface, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: th.text, borderWidth: 1 } },
        progressive: 0
      }]
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Histogramme (type 'histogram') : une barre par classe de valeurs de `tile.measure` (js/data.js:histogramBins : grille tirée de
  // TOUTES les lignes, comptes sur celles qui restent après les autres filtres). Deux formats de nombres : les bornes ont celui de
  // la colonne, les comptes (axe Y, infobulle) celui d'un comptage — jamais la devise de la colonne sur « 12 lignes ». Le clic
  // (handleTileClick) pose un filtre par plage ; la classe filtrée garde sa couleur, les autres sont atténuées, comme une barre.
  function renderHistogram(tile, rows, state, instance) {
    const hist = histogramBins(state.rows, rows, tile.measure, tile.bins);
    instance.__bins = hist.bins;
    if (!hist.bins.length) {
      // Aucune valeur numérique : un message au centre plutôt qu'un cadre vide sans explication.
      instance.setOption({ title: { text: t('chart.histogram.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal' } }, series: [], xAxis: { show: false }, yAxis: { show: false } }, true);
      return;
    }
    const histogramFormat = fmtFor(tile, tile.measure);
    const fCount = fmtFor({ ...tile, aggFn: 'count' }, tile.measure);
    const palette = paletteColors(tile.palette);
    const mine = state.activeFilters.find((af) => af.column === tile.measure && af.sourceTileId === tile.id);
    // Les bornes des classes forment UNE échelle : des années (1990 – 2000) ne sont jamais compactées (« 1,99 k – 2 k »).
    const scale = histogramFormat.forScale(hist.bins[0].lo, hist.bins[hist.bins.length - 1].hi);
    const bound = (v) => (scale.axis(v) || String(v));
    const label = (b) => (b.lo === b.hi ? bound(b.lo) : `${bound(b.lo)} – ${bound(b.hi)}`);
    const fullLabel = (b) => (b.lo === b.hi ? (scale.format(b.lo) || String(b.lo)) : `${scale.format(b.lo) || b.lo} – ${scale.format(b.hi) || b.hi}`);
    const option = {
      color: palette,
      grid: { ...numericGrid },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // Texte HTML : les bornes sont des nombres formatés (jamais du texte saisi), rien à échapper de plus.
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          const histogramBin = hist.bins[p.dataIndex];
          if (!histogramBin) return '';
          const share = hist.total > 0 ? ` (${histogramFormat.percent((histogramBin.count * 100) / hist.total)})` : '';
          return `${escapeHtml(fullLabel(histogramBin))}<br/>${t('chart.histogram.rows', { n: fCount.format(histogramBin.count) || histogramBin.count, count: histogramBin.count })}${share}`;
        }
      },
      // Largeur de libellé FIXÉE : un libellé de classe (« 1998 – 2003 », « 1 200 – 1 400 ») est deux nombres, bien plus large que
      // la barre ; sans cela finalizeOption le tronquerait à la largeur d'une barre (« 199… »). Les libellés qui se touchent sont
      // omis par ECharts (intervalle automatique), chacun s'écrit en entier.
      xAxis: { type: 'category', data: hist.bins.map(label), axisLabel: { interval: 'auto', width: 84, overflow: 'truncate', ellipsis: '…' } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { formatter: fCount.axis } },
      series: [{
        type: 'bar',
        // Classes contiguës, comme un histogramme : un trait d'espace seulement.
        barCategoryGap: '8%',
        data: hist.bins.map((b) => ({
          value: b.count,
          itemStyle: mine && !histogramBinIsActive(mine, b) ? { opacity: 0.3 } : undefined
        }))
      }]
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Boîte à moustaches (type 'box') : une boîte par valeur de `tile.dimension`, sur les valeurs BRUTES de `tile.measure`
  // (js/data.js:boxStatsByGroup : médiane, quartiles, moustaches de Tukey, valeurs aberrantes tracées une à une, au plus
  // BOX_MAX_OUTLIERS par groupe). Deux séries ECharts : `boxplot` (les boîtes) et `scatter` (les aberrantes, cercles creux). Les
  // nombres ont le format de la colonne ; l'effectif a celui d'un comptage. Le clic (handleTileClick) filtre sur le groupe ; les
  // groupes non retenus par un filtre sur cette dimension sont atténués, comme une barre.
  function renderBox(tile, rows, state, instance) {
    const box = boxStatsByGroup(rows, tile.dimension, tile.measure);
    instance.__boxGroups = box.groups.map((g) => g.name);
    if (!box.groups.length) {
      // Aucune valeur numérique : un message au centre plutôt qu'un cadre vide sans explication.
      instance.setOption({ title: { text: t('chart.box.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal' } }, series: [], xAxis: { show: false }, yAxis: { show: false } }, true);
      return;
    }
    const boxFormat = fmtFor(tile, tile.measure);
    const fCount = fmtFor({ ...tile, aggFn: 'count' }, tile.measure);
    const color = paletteColors(tile.palette)[0];
    let fill = color;
    try { fill = echarts.color.modifyAlpha(color, 0.22); } catch (e) { /* repli : la couleur pleine, la boîte reste lisible */ }
    const filter = state.activeFilters.find((af) => af.column === tile.dimension);
    const dimmed = (g) => (filter && !filterSelects(filter, g.dimension) ? { opacity: 0.3 } : undefined);
    const num = (v) => escapeHtml(boxFormat.format(v) || String(v));
    const outliers = [];
    box.groups.forEach((g, i) => g.outliers.forEach((v) => outliers.push({ value: [i, v], itemStyle: dimmed(g) })));
    const option = {
      color: [color],
      grid: { ...numericGrid },
      tooltip: {
        trigger: 'item',
        // Texte HTML : le nom du groupe vient des données (échappé), les nombres sont formatés.
        formatter: (p) => {
          const rank = p.seriesType === 'scatter' ? p.value[0] : p.dataIndex;
          const g = box.groups[rank];
          if (!g) return '';
          const head = `<b>${escapeHtml(g.name)}</b> · ${t('chart.box.count', { n: fCount.format(g.n) || g.n, count: g.n })}`;
          if (p.seriesType === 'scatter') return `${head}<br/>${t('chart.box.outlier')} : ${num(p.value[1])}`;
          const lines = [
            `${t('chart.box.max')} : ${num(g.high)}`, `${t('chart.box.q3')} : ${num(g.q3)}`, `<b>${t('chart.box.median')} : ${num(g.median)}</b>`,
            `${t('chart.box.q1')} : ${num(g.q1)}`, `${t('chart.box.min')} : ${num(g.low)}`
          ];
          if (g.outlierCount) lines.push(t('chart.box.outliers', { n: fCount.format(g.outlierCount) || g.outlierCount, count: g.outlierCount }));
          return `${head}<br/>${lines.join('<br/>')}`;
        }
      },
      xAxis: { type: 'category', data: box.groups.map((g) => g.name), axisTick: { alignWithLabel: true } },
      // Pas de zéro imposé : des notes entre 8 et 18 se lisent sur 8-18, pas sur 0-18 (la boîte n'est pas une barre).
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: boxFormat.axis } },
      series: [
        {
          type: 'boxplot',
          data: box.groups.map((g) => ({ value: [g.low, g.q1, g.median, g.q3, g.high], itemStyle: dimmed(g) })),
          itemStyle: { color: fill, borderColor: color, borderWidth: 1.5 },
          emphasis: { itemStyle: { borderWidth: 2.5 } },
          boxWidth: [8, 48]
        },
        {
          type: 'scatter',
          data: outliers,
          symbolSize: 6,
          z: 3,
          itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 }
        }
      ]
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Calendrier (type 'calendar') : une case par jour (js/data.js:calendarDays : valeur agrégée du jour, au plus CALENDAR_MAX_DAYS
  // jours, le reste est compté), semaines en colonnes et jours de la semaine en lignes (lundi en haut), mois en en-tête. Même rampe de
  // couleur que la carte de chaleur (`heatStops`, légende `visualMap` continue) ; un jour sans valeur n'a PAS de case colorée (une
  // trame neutre : « aucune ligne » ne se lit pas « la valeur la plus basse »). Jours non retenus par un filtre sur la colonne de
  // dates : atténués (`filterSelects`). Le clic (handleTileClick) lit le jour dans la donnée de la case.
  function renderCalendar(tile, rows, state, instance) {
    const cal = calendarDays(rows, tile.dimension, tile.measure, tile.aggFn);
    if (!cal.days.length) {
      // Aucun jour exploitable (colonne qui n'est pas une date, filtre sans ligne) : un message au centre, pas un cadre vide.
      instance.setOption({ title: { text: t('chart.calendar.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal', color: chartTheme().muted } }, series: [] }, true); // pas de composant `calendar` sans plage : ECharts lèverait une exception
      return;
    }
    const calendarFormat = fmtFor(tile, tile.measure);
    const th = chartTheme();
    const stops = heatStops(tile.palette);
    const lang = GristBI.i18n.getLang();
    const dayFilter = state.activeFilters.find((af) => af.column === tile.dimension);
    let min = Infinity;
    let max = -Infinity;
    cal.days.forEach((d) => { if (d.value < min) min = d.value; if (d.value > max) max = d.value; });
    // Toutes les valeurs égales : l'échelle de la légende s'ouvre autour d'elles (couleur du milieu).
    const lo = min === max ? min - 1 : min;
    const hi = min === max ? max + 1 : max;
    // Plage affichée : du 1er du mois du premier jour au dernier du mois du dernier jour (des mois entiers, jamais coupés au milieu).
    const first = cal.from.slice(0, 8) + '01';
    const lastYear = Number(cal.to.slice(0, 4));
    const lastMonth = Number(cal.to.slice(5, 7));
    const end = new Date(Date.UTC(lastYear, lastMonth, 0)).toISOString().slice(0, 10);
    const names = (key) => t(key).split(',');
    const width = instance.getWidth() || 330;
    const longDate = (iso) => {
      const ms = Date.parse(iso + 'T00:00:00Z');
      try { return new Date(ms).toLocaleDateString(lang, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return iso; }
    };
    const option = {
      tooltip: {
        trigger: 'item',
        // Texte HTML : le jour est une date ISO validée, la valeur est formatée par js/format.js ; rien de saisi n'y entre.
        formatter: (p) => {
          const v = p && p.value;
          if (!Array.isArray(v)) return '';
          return `${escapeHtml(longDate(String(v[0])))}<br/>${escapeHtml(calendarFormat.format(v[1]) || '–')}`;
        }
      },
      visualMap: {
        type: 'continuous', min: lo, max: hi, calculable: false, orient: 'horizontal', left: 'center', bottom: 2,
        itemWidth: 8, itemHeight: Math.max(60, Math.min(170, Math.round(width * 0.5))),
        text: [calendarFormat.axis(max), calendarFormat.axis(min)], textGap: 6,
        inRange: { color: stops }, textStyle: { fontSize: 10 }
      },
      calendar: {
        top: 28, left: 26, right: 8, bottom: 40,
        cellSize: ['auto', 'auto'],
        range: [first, end],
        orient: 'horizontal',
        splitLine: { show: false },
        itemStyle: { color: th.track, borderWidth: 2, borderColor: th.surface },
        yearLabel: { show: false },
        dayLabel: { firstDay: 1, nameMap: names('chart.calendar.dayNames'), color: th.muted, fontSize: 10, margin: 6 },
        monthLabel: { nameMap: names('chart.calendar.monthNames'), color: th.muted, fontSize: 10, margin: 6 }
      },
      series: [{
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: cal.days.map((d) => ({ value: [d.date, d.value], itemStyle: (!dayFilter || filterSelects(dayFilter, d.date)) ? undefined : { opacity: 0.3 } })),
        emphasis: { itemStyle: { borderColor: th.text, borderWidth: 1 } },
        progressive: 0
      }]
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Flux (type 'sankey') : source = `tile.dimension` (nœuds à gauche, colorés par la palette, les liens prennent leur couleur), cible =
  // `tile.columnDimension` (nœuds à droite, gris neutre : ce sont les liens qui racontent d'où vient le flux). Calcul : js/data.js:
  // sankeyFlows (une passe, groupement par paire) ; seuls les SANKEY_MAX_LINKS plus gros flux sont dessinés (la tuile le dit). Les
  // marges gauche/droite réservent la place des libellés, en pixels : `instance.__refit` les recalcule au redimensionnement (comme
  // la jauge). Nœuds et liens non retenus par un filtre sur leur colonne sont atténués (`filterSelects`), comme une barre.
  function renderSankey(tile, rows, state, instance) {
    const sk = sankeyFlows(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
    const shown = topFlows(sk.flows, SANKEY_MAX_LINKS);
    instance.__sankeyNodes = new Map();
    instance.__refit = undefined;
    if (!shown.length) {
      // Aucun flux positif : un message au centre plutôt qu'un cadre vide sans explication.
      instance.setOption({ title: { text: t('chart.sankey.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal' } }, series: [], graphic: [], xAxis: { show: false }, yAxis: { show: false } }, true);
      return;
    }
    const sankeyFormat = fmtFor(tile, tile.measure);
    const th = chartTheme();
    const palette = paletteColors(tile.palette);
    const sources = Array.from(new Set(shown.map((fl) => fl.source)));
    const targets = Array.from(new Set(shown.map((fl) => fl.target)));
    const shownTotal = shown.reduce((a, fl) => a + fl.value, 0);
    const srcFilter = state.activeFilters.find((af) => af.column === tile.dimension);
    const tgtFilter = state.activeFilters.find((af) => af.column === tile.columnDimension);
    const sid = (v) => `s:${v}`;
    const tid = (v) => `t:${v}`;
    const srcOk = (v) => !srcFilter || filterSelects(srcFilter, v);
    const tgtOk = (v) => !tgtFilter || filterSelects(tgtFilter, v);
    const nodes = sources.map((v, i) => ({ name: sid(v), text: v, label: { position: 'left' }, itemStyle: { color: palette[i % palette.length], opacity: srcOk(v) ? 1 : 0.3 } }))
      .concat(targets.map((v) => ({ name: tid(v), text: v, label: { position: 'right' }, itemStyle: { color: th.muted, opacity: tgtOk(v) ? 1 : 0.3 } })));
    sources.forEach((v) => instance.__sankeyNodes.set(sid(v), { column: tile.dimension, value: v }));
    targets.forEach((v) => instance.__sankeyNodes.set(tid(v), { column: tile.columnDimension, value: v }));
    const links = shown.map((fl) => ({
      source: sid(fl.source), target: tid(fl.target), value: fl.value,
      lineStyle: srcOk(fl.source) && tgtOk(fl.target) ? undefined : { opacity: 0.08 }
    }));
    const label = (name) => { const n = instance.__sankeyNodes.get(name); return n ? escapeHtml(n.value) : ''; };
    // Place des libellés : un quart de la largeur de chaque côté, de 56 à 190 px (le nom entier reste dans l'infobulle).
    const place = () => {
      const w = instance.getWidth() || 300;
      const m = Math.max(56, Math.min(190, Math.round(w * 0.24)));
      return { left: m, right: m, labelWidth: m - 16 };
    };
    const p0 = place();
    const option = {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const share = (v) => (shownTotal > 0 ? ` (${sankeyFormat.percent((v * 100) / shownTotal)})` : '');
          if (p.dataType === 'edge') return `${label(p.data.source)} → ${label(p.data.target)}<br/>${escapeHtml(sankeyFormat.format(p.data.value) || String(p.data.value))}${share(p.data.value)}`;
          return `<b>${label(p.data.name)}</b><br/>${t('chart.sankey.node')} : ${escapeHtml(sankeyFormat.format(p.value) || String(p.value))}${share(p.value)}`;
        }
      },
      series: [{
        type: 'sankey',
        data: nodes,
        links,
        draggable: false,
        nodeWidth: 12,
        nodeGap: 8,
        left: p0.left,
        right: p0.right,
        top: 10,
        bottom: shown.length < sk.flows.length ? 22 : 10,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'source', opacity: 0.35, curveness: 0.5 },
        label: { color: th.text, fontSize: 11, width: p0.labelWidth, overflow: 'truncate', ellipsis: '…', formatter: (p) => (p.data && p.data.text != null ? String(p.data.text) : '') }
      }],
      graphic: shown.length < sk.flows.length
        ? [{ type: 'text', right: 8, bottom: 4, style: { text: t('chart.sankey.capped', { shown: shown.length, total: sk.flows.length }), fill: th.muted, fontSize: 10 } }]
        : []
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
    instance.__refit = () => {
      const p = place();
      instance.setOption({ series: [{ left: p.left, right: p.right, label: { width: p.labelWidth } }] });
    };
  }

  // Soleil (`type: 'sunburst'`, 8e chemin avant `finalizeOption`/`setOption`) : série ECharts `sunburst`, un anneau par niveau (`sunburstLevels` : la
  // dimension, puis la liste « drill-down » de la tuile), un arbre calculé en JS pur à tout volume (`sunburstTree`). Une couleur par part de l'anneau
  // central, ses descendantes en teintes de plus en plus pâles vers le fond de la carte (un anneau se lit comme une famille) ; texte de chaque part
  // noir ou blanc selon son fond (`heatTextColor`). Les parts qui n'ont plus la place d'écrire leur nom n'en écrivent pas (`label.minAngle`), le nom
  // entier est dans l'infobulle. Clic : filtre jusqu'à la part (handleTileClick) ; les parts non retenues par un filtre sont estompées à 0,3.
  function renderSunburst(tile, rows, state, instance) {
    const tree = sunburstTree(rows, sunburstLevels(tile), tile.measure, tile.aggFn, tile.sortMode);
    instance.__sunburstLevels = tree.levels;
    instance.__refit = undefined;
    if (!tree.roots.length) {
      instance.setOption({ title: { text: t('chart.sunburst.empty'), left: 'center', top: 'middle', textStyle: { fontSize: 12, fontWeight: 'normal', color: chartTheme().muted } }, series: [], graphic: [], xAxis: { show: false }, yAxis: { show: false } }, true);
      return;
    }
    const sunburstFormat = fmtFor(tile, tile.measure);
    const th = chartTheme();
    const palette = paletteColors(tile.palette);
    const filters = state.activeFilters;
    const mix = (c, amount) => (GristBI.styles ? GristBI.styles.mixColors(c, th.surface, amount) : c);
    const toNode = (n, depth, base) => {
      const fill = mix(base, Math.min(0.5, 0.17 * (depth - 1)));
      const selected = sunburstNodeSelected(filters, tree.levels, n.path);
      // Le nom se pose sur ce qu'on VOIT : une part estompée (0,3) est à 70 % la couleur du fond de la carte, noir pur sur un fond sombre ne se lirait plus.
      return {
        name: n.name,
        value: n.value,
        path: n.path,
        itemStyle: { color: fill, opacity: selected ? 1 : 0.3 },
        label: { color: heatTextColor(selected ? fill : mix(fill, 0.7)) },
        children: n.children.map((c) => toNode(c, depth + 1, base))
      };
    };
    const sunburstRoots = tree.roots.map((r, i) => toNode(r, 1, palette[i % palette.length]));
    // Place d'un nom dans son anneau : l'épaisseur d'un anneau (rayon / nombre d'anneaux) divisée par ~6 px par signe ; relu à chaque dessin,
    // donc à jour quand la tuile est agrandie. Le nom entier reste dans l'infobulle.
    const fit = (name) => {
      const radius = Math.max(40, Math.min(instance.getWidth() || 200, instance.getHeight() || 200) / 2 * 0.9);
      const budget = Math.max(3, Math.floor(radius / Math.max(1, tree.depth) / 6));
      const text = String(name == null ? '' : name);
      return text.length > budget ? `${text.slice(0, Math.max(1, budget - 1))}…` : text;
    };
    const option = {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const path = p.data && Array.isArray(p.data.path) ? p.data.path : [p.name];
          const share = tree.total > 0 ? ` (${sunburstFormat.percent((Number(p.value) * 100) / tree.total)})` : '';
          return `${path.map((v) => escapeHtml(v)).join(' › ')}<br/>${escapeHtml(sunburstFormat.format(p.value) || String(p.value))}${share}`;
        }
      },
      series: [{
        type: 'sunburst',
        data: sunburstRoots,
        radius: [0, '90%'],
        center: ['50%', tree.hidden > 0 ? '46%' : '50%'],
        sort: null, // l'ordre est celui de l'arbre (apparition ou tri choisi), pas un tri d'ECharts
        nodeClick: false, // un clic filtre, il ne zoome pas sur la part
        itemStyle: { borderColor: th.surface, borderWidth: 1 },
        // Par défaut ECharts estompe tout sauf la part survolée et ses descendantes : on le confondrait avec un filtre posé (0,3 d'opacité).
        emphasis: { focus: 'none', itemStyle: { opacity: 1, borderColor: th.text, borderWidth: 1.5 } },
        label: { rotate: 'radial', minAngle: 12, fontSize: 10, formatter: (p) => fit(p.name) }
      }],
      graphic: tree.hidden > 0
        ? [{ type: 'text', left: 8, bottom: 4, silent: true, style: { text: t('chart.sunburst.hidden', { n: tree.hidden }), fill: th.muted, fontSize: 10, fontFamily: th.font } }]
        : []
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Tuile bar avec un mode de calcul temporel ('cumulative'/'ytd'/'yoy', voir ROADMAP.md "Mesures
  // façon DAX simplifié") : contrairement à toutes les autres tuiles, ce chemin de rendu est
  // ASYNCHRONE (le calcul passe par GristBI.duckdbEngine.timeSeriesMeasures, une vraie requête SQL
  // DuckDB-WASM) — la seule tuile de ce widget dont le rendu ne se termine pas de façon synchrone
  // dans le même tick que l'appel à renderTile. Pas de dimension/drill-down ici : l'axe est TOUJOURS
  // le mois calculé depuis `tile.dateColumn` (voir data.js:measureSeriesForTile), donc le fil
  // d'Ariane est masqué comme pour KPI/gauge.
  async function renderMeasureChart(tile, rows, container) {
    const breadcrumbEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (breadcrumbEl) breadcrumbEl.hidden = true;
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      el.textContent = t('chart.unavailable');
      return;
    }
    const instance = getOrCreateChartInstance(tile.id, el);

    // Capturé AVANT l'attente asynchrone : seul le dernier appel lancé pour CETTE tuile doit
    // appliquer son résultat (voir la doc de renderSeq plus haut) — un filtre posé, une tuile
    // éditée/supprimée pendant le calcul SQL ne doivent pas faire apparaître un résultat périmé.
    const seq = bumpSeq(tile.id);
    instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });

    let timeSeries;
    try {
      timeSeries = await GristBI.duckdbEngine.timeSeriesMeasures(rows, tile.dateColumn, tile.measure, tile.aggFn);
    } catch (e) {
      console.error('[GristBI] échec du calcul de la mesure temporelle (DuckDB)', e);
      if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé/tuile supprimée entre-temps
      instance.hideLoading();
      const freshEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
      if (freshEl) freshEl.textContent = t('chart.measureFailed');
      return;
    }
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé/tuile supprimée entre-temps
    instance.hideLoading();

    const { categories, series } = measureSeriesForTile(tile.measureMode, timeSeries);
    const palette = paletteColors(tile.palette);
    const mf = fmtFor(tile, tile.measure);
    const option = {
      color: palette,
      grid: { ...numericGrid, top: series.length > 1 ? 40 : numericGrid.top },
      legend: series.length > 1 ? { top: 0 } : undefined,
      tooltip: { trigger: 'axis', valueFormatter: (v) => (mf.format(v) || '–') },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value', axisLabel: { formatter: mf.axis } },
      series: series.map((s) => ({ type: 'bar', name: s.label, data: s.data }))
    };
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // Fil d'Ariane : la dimension racine (cliquable dès qu'on a drillé, pour tout remonter) puis un
  // segment par niveau franchi (chacun cliquable pour remonter jusqu'à CE niveau, sauf le dernier).
  function renderBreadcrumb(tile, drillPath, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (!el) return;
    const levels = tileDrillLevels(tile);
    // Un soleil n'a pas de drill-down (ses anneaux sont déjà tous dessinés, un clic filtre) : « cliquer pour détailler » serait faux.
    if (!levels.length || tile.type === 'sunburst') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!drillPath.length) {
      GristBI.safeHtml.setHtml(el, `<span>${escapeHtml(tile.dimension)}</span>
        <span class="breadcrumb-hint">${escapeHtml(t('chart.breadcrumb.hint', { column: levels[0] }))}</span>`);
      return;
    }
    const rootCrumb = `<button type="button" class="breadcrumb-link" data-depth="0">${escapeHtml(tile.dimension)}</button>`;
    const pathCrumbs = drillPath.map((step, i) => {
      const depth = i + 1;
      const label = `${escapeHtml(String(step.value))} · ${escapeHtml(levels[i])}`;
      return depth === drillPath.length ? `<span>${label}</span>`
        : `<button type="button" class="breadcrumb-link" data-depth="${depth}">${label}</button>`;
    });
    GristBI.safeHtml.setHtml(el, [rootCrumb].concat(pathCrumbs).join(' <span class="breadcrumb-sep">▸</span> '));
    el.querySelectorAll('.breadcrumb-link').forEach((btn) => {
      btn.addEventListener('click', () => GristBI.store.drillUp(tile.id, Number(btn.dataset.depth)));
    });
  }

  Object.assign(parts, { addRefLine, buildSmallMultiplesOption, renderBox, renderBreadcrumb, renderCalendar, renderHeatmap, renderHistogram, renderMeasureChart, renderSankey, renderSunburst, toggleCellFilters });
})(window);
