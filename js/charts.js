/*
 * Rendu des tuiles (bar/line/pie/kpi/gauge/treemap/scatter/waterfall/radar…) avec ECharts : filtres
 * croisés multiples, tendance KPI, et drill-down multi-niveaux (voir GristBI.data.tileDrillLevels)
 * avec fil d Ariane. Dépend du global `echarts` (js/vendor/echarts/, voir index.html) et de
 * GristBI.data/GristBI.store.
 *
 * Ce fichier est le POINT D ENTRÉE : il aiguille chaque tuile vers son rendu, gère le clic et expose
 * GristBI.charts. Le reste est coupé par responsabilité (chargés AVANT lui, dans cet ordre) :
 * charts-core.js (socle), charts-cards.js (cartes, tables, jauge, tableau croisé), charts-cloud.js
 * (nuage de mots), charts-extra.js (types ECharts récents, petits multiples). Ils partagent
 * GristBI.chartParts (interne : ne pas s en servir ailleurs).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.chartParts;
  const {
    sameValue, waterfallSeries, sortGroups, isSortableTile, isSeriesTile, sunburstFilterToggles, isSmallMultiplesTile, comboSeries, comboModeOf, histogramFilter, isBubbleTile, bubblePoints, bubbleDiameters, filterSelects, lineShapeOf, isStackedPercentTile, stackShares, supportsValueLabels, refLineValue, heatTextColor, isStackedTile, assembleSeries, paletteColors, escapeHtml, tileDrillLevels, currentDimension, rowsForTile
  } = GristBI.data;
  const { t } = GristBI.i18n;
  const { CATEGORICAL_PALETTE, DUCKDB_ROW_THRESHOLD, addRefLine, buildSmallMultiplesOption, bumpSeq, chartInstances, chartTheme, computeAggregateSingle, computeGroupBy, computeScatterSplit, computeSeriesGroups, finalizeOption, fmtFor, getOrCreateChartInstance, isStale, loadingInstances, numericGrid, renderBox, renderBreadcrumb, renderCalendar, renderGantt, renderGauge, renderHeatmap, renderHistogram, renderKpi, renderMeasureChart, renderPivot, renderProgress, renderSankey, renderSeq, renderSunburst, renderTable, renderText, renderWordCloud, tableSort, toggleCellFilters, trackPending, whenSettled } = parts;

  // Rend la promesse du dessin (ou `undefined` pour une tuile synchrone) : l'écran l'ignore, les exports l'attendent (js/export.js pour l'image
  // d'un graphique) et `whenSettled` aussi (js/snapshot.js : rien n'est photographié tant qu'un calcul DuckDB est en vol).
  function renderTile(tile, state, container) {
    const pending = drawTile(tile, state, container);
    trackPending(pending);
    return pending;
  }

  function drawTile(tile, state, container) {
    // Filtrage délégué à GristBI.data.rowsForTile (source de vérité partagée avec l'export Excel,
    // voir data.js) : une tuile qui EST la source d'un filtre croisé s'affiche non filtrée SUR CE
    // FILTRE LÀ (pour rester cliquable sur tous ses segments) ; elle reçoit quand même les filtres
    // posés par d'AUTRES tuiles ainsi que les filtres avancés (qui s'appliquent à toutes les tuiles
    // sans exception, `sourceTileId` n'a jamais de sens pour eux) et son propre drill-down.
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    const rows = rowsForTile(tile, state);

    if (tile.type === 'kpi') {
      return renderKpi(tile, rows, container);
    } else if (tile.type === 'gauge') {
      return renderGauge(tile, rows, container);
    } else if (tile.type === 'pivot') {
      return renderPivot(tile, rows, state, container);
    } else if (tile.type === 'text') {
      return renderText(tile, container);
    } else if (tile.type === 'table') {
      return renderTable(tile, rows, container);
    } else if (tile.type === 'progress') {
      return renderProgress(tile, rows, state, container);
    } else if (tile.type === 'gantt') {
      return renderGantt(tile, rows, state, container);
    } else if (tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut') {
      return renderMeasureChart(tile, rows, container);
    }
    return renderChart(tile, rows, state, container, drillPath);
  }

  // Logique de clic (drill-down vs filtre croisé) PARTAGÉE par l'instance ECharts générique
  // (getOrCreateChartInstance, bar/pie/treemap/scatter/waterfall/radar/nuage de mots en mode "une
  // entrée par ligne") et le <canvas> maison du nuage de mots en mode découpage
  // (getOrCreateWordCloudCanvas, voir renderWordCloud — depuis le 03/11/2026, d3-cloud ne fait que
  // le placement, pas le clic). Ne PAS capturer `tile` du rendu courant dans une closure : un appel
  // peut arriver bien après le rendu qui l'a câblé (édition de tuile, drill-down — voir
  // HYPOTHESES.md) ; on relit l'état vivant à chaque clic, en ne fixant que l'id de la tuile (stable
  // tout au long de sa vie).
  function handleTileClick(tileId, name, params) {
    const liveState = GristBI.store.getState();
    const currentTile = liveState.tiles.find((t) => t.id === tileId);
    if (!currentTile) return; // tuile supprimée entre-temps
    // Histogramme : une barre est une CLASSE de valeurs, pas une catégorie — le clic pose un filtre par plage (jamais un
    // filtre d'égalité sur le libellé « 10 – 20 », qui ne correspondrait à aucune ligne). Les classes affichées sont celles du
    // dernier rendu (`instance.__bins`), retrouvées par rang : `params.name` est un libellé, pas une borne.
    if (currentTile.type === 'histogram') {
      const inst = chartInstances.get(tileId);
      const bin = inst && inst.__bins && params ? inst.__bins[params.dataIndex] : null;
      if (bin) GristBI.store.toggleRangeFilter(currentTile.measure, histogramFilter(bin), currentTile.id);
      return;
    }
    // Flux (Sankey) : un NŒUD = une valeur de la source (à gauche) ou de la cible (à droite) -> filtre d'égalité sur SA colonne ; un
    // FLUX (lien) = une source ET une cible -> les deux filtres, comme une case de la carte de chaleur (toggleCellFilters). Les nœuds
    // portent un identifiant interne `s:valeur` / `t:valeur` (la même valeur peut figurer des deux côtés) : la table du dernier rendu
    // (`instance.__sankeyNodes`) donne la colonne et la valeur de chacun. Pas de drill-down.
    if (currentTile.type === 'sankey') {
      const inst = chartInstances.get(tileId);
      const nodes = inst && inst.__sankeyNodes;
      if (!nodes || !params || !params.data) return;
      if (params.dataType === 'edge') {
        const from = nodes.get(params.data.source);
        const to = nodes.get(params.data.target);
        if (from && to) toggleCellFilters(currentTile, from.value, to.value);
      } else if (params.dataType === 'node') {
        const node = nodes.get(params.data.name);
        if (node) GristBI.store.toggleFilter(node.column, node.value, currentTile.id);
      }
      return;
    }
    // Boîte à moustaches : une boîte (ou une valeur aberrante tracée à côté) est UN GROUPE de la dimension — le clic pose un filtre
    // d'égalité sur ce groupe, jamais de drill-down (les valeurs sont brutes, pas agrégées). Le groupe est retrouvé par son RANG dans
    // le dernier rendu (`instance.__boxGroups`) : pour la série de boîtes c'est `params.dataIndex`, pour celle des valeurs
    // aberrantes (points [rang, valeur]) le rang est `params.value[0]` — leur `dataIndex` ne compte que parmi les aberrantes.
    if (currentTile.type === 'box') {
      const inst = chartInstances.get(tileId);
      const names = inst && inst.__boxGroups;
      const rank = params && params.seriesType === 'scatter' && Array.isArray(params.value) ? params.value[0] : (params ? params.dataIndex : -1);
      if (names && names[rank] !== undefined) GristBI.store.toggleFilter(currentTile.dimension, names[rank], currentTile.id);
      return;
    }
    // Soleil : une part = UNE valeur de SON anneau dans ses parents ; le clic pose le filtre de chaque anneau jusqu'à elle (et retire ceux des
    // anneaux plus profonds de cette tuile, voir `sunburstFilterToggles`). Les colonnes sont celles du DERNIER rendu (`instance.__sunburstLevels`),
    // les valeurs celles du chemin porté par la part (`params.data.path`), jamais son libellé seul. Pas de drill-down : tous les anneaux se voient.
    if (currentTile.type === 'sunburst') {
      const inst = chartInstances.get(tileId);
      const columns = inst && inst.__sunburstLevels;
      const path = params && params.data && Array.isArray(params.data.path) ? params.data.path : null;
      if (!columns || !path) return;
      sunburstFilterToggles(liveState.activeFilters, columns, path, currentTile.id).forEach((c) => GristBI.store.toggleFilter(c.column, c.value, currentTile.id));
      return;
    }
    // Calendrier : une case = UN jour ; le clic pose un filtre d'égalité sur la colonne de dates (le jour au format ISO, celui des
    // cellules). Le jour vient de la donnée de la case (`params.value[0]`), jamais d'un rang ou d'un libellé. Pas de drill-down.
    if (currentTile.type === 'calendar') {
      const day = params && Array.isArray(params.value) ? params.value[0] : null;
      if (typeof day === 'string' && day) GristBI.store.toggleFilter(currentTile.dimension, day, currentTile.id);
      return;
    }
    // Carte de chaleur : une case = UNE ligne ET UNE colonne du tableau croisé, le clic pose les deux filtres (comme une cellule du
    // tableau croisé). Les valeurs des deux axes viennent du dernier rendu (`instance.__grid`), retrouvées par rang : jamais
    // `params.name`, qui ne donne que l'abscisse. Pas de drill-down (comme le tableau croisé).
    if (currentTile.type === 'heatmap') {
      const inst = chartInstances.get(tileId);
      const grid = inst && inst.__grid;
      const v = params && Array.isArray(params.value) ? params.value : null;
      if (grid && v && grid.colKeys[v[0]] !== undefined && grid.rowKeys[v[1]] !== undefined) {
        toggleCellFilters(currentTile, String(grid.rowKeys[v[1]]), String(grid.colKeys[v[0]]));
      }
      return;
    }
    // Mode mesure temporelle (voir renderMeasureChart) : un point est un mois CALCULÉ (bucket
    // DuckDB), pas une vraie valeur de la dimension d'origine — rien de cohérent à filtrer/driller.
    if (currentTile.type === 'bar' && currentTile.measureMode && currentTile.measureMode !== 'brut') return;
    // Radar (voir renderChart) : une seule série/un seul "polygone" couvrant TOUTES les valeurs de
    // la dimension à la fois (un axe par valeur) — le nom reçu au clic est alors celui de CE
    // polygone (tile.measure), jamais celui d'un axe précis cliqué individuellement. ECharts ne
    // distingue pas l'axe survolé/cliqué au clic sur un radar (seulement au survol, dans le
    // tooltip) : aucune valeur de dimension cohérente à driller/filtrer ici, contrairement à
    // bar/pie/treemap/scatter/waterfall qui restent tous sur un axe catégoriel classique. Repli
    // silencieux (aucune action) plutôt qu'un filtre posé par erreur sur "tile.measure".
    if (currentTile.type === 'radar') return;
    // Nuage de mots en mode "découpage de cellule" : un mot issu du découpage d'une cellule (ex.
    // "génétique") n'est jamais une valeur de colonne telle quelle (la cellule d'origine vaut
    // "génétique, cohorte, adolescent") — un filtre par égalité stricte sur ce mot
    // (toggleFilter/matchesFilter, type 'eq') ne correspondrait à AUCUNE ligne, vidant
    // silencieusement la tuile au clic plutôt que de filtrer quoi que ce soit de cohérent. Ce
    // widget n'a pas de filtre de type "contient" branché sur le clic (seulement sur le champ de
    // recherche texte des filtres avancés, voir matchesFilter) : repli silencieux (aucune action),
    // même traitement que le radar ci-dessus. En pratique, le <canvas> du nuage de mots neutralise
    // déjà lui-même le clic dans ce mode (voir getOrCreateWordCloudCanvas) — ce garde-fou reste ici
    // par cohérence/défense en profondeur, inchangé depuis la version ECharts de ce code.
    if (currentTile.type === 'wordcloud' && currentTile.wordCloudSplit) return;
    const livePath = (liveState.drillIns && liveState.drillIns[currentTile.id]) || [];
    const dim = currentDimension(currentTile, livePath);
    const levels = tileDrillLevels(currentTile);
    if (livePath.length < levels.length) {
      GristBI.store.drillInto(currentTile.id, dim, name);
    } else {
      GristBI.store.toggleFilter(dim, name, currentTile.id);
    }
  }

  // ASYNCHRONE depuis que l'agrégation peut passer par DuckDB-WASM au-delà du seuil (voir
  // computeGroupBy) : récupère/crée l'instance ECharts et affiche le fil d'Ariane IMMÉDIATEMENT
  // (ni l'un ni l'autre ne dépend du calcul), bascule l'instance en "chargement" seulement si ce
  // rendu-ci va effectivement utiliser DuckDB (jamais pour les dashboards habituels, bien plus
  // petits que le seuil — zéro changement visuel pour eux), puis attend l'agrégation avant de
  // construire les séries ECharts, exactement comme renderMeasureChart le fait déjà pour les
  // mesures temporelles.
  async function renderChart(tile, rows, state, container, drillPath) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    renderBreadcrumb(tile, drillPath, container);

    // Nuage de mots : chemin de rendu entièrement séparé depuis le 03/11/2026 (passage à d3-cloud,
    // voir renderWordCloud ci-dessous et la discussion avec Antoine ce jour-là) — PAS une instance
    // ECharts, donc rien du reste de cette fonction (getOrCreateChartInstance, l'option ECharts
    // construite plus bas, instance.setOption) ne s'applique à ce type de tuile.
    if (tile.type === 'wordcloud') {
      return renderWordCloud(tile, rows, state, el);
    }
    // Une instance "nuage de mots" (canvas maison, voir getOrCreateWordCloudCanvas) peut être
    // restée en cache pour cette tuile si son type vient de changer (nuage de mots -> un autre
    // type) : jamais la laisser traîner pour qu'ECharts réutilise le même <canvas> à sa place.
    const staleWordCloud = chartInstances.get(tile.id);
    if (staleWordCloud && staleWordCloud.isWordCloudCanvas && !staleWordCloud.isDisposed()) {
      staleWordCloud.dispose();
      chartInstances.delete(tile.id);
    }

    if (typeof echarts === 'undefined') {
      // Pas d'erreur JS ici : sans ce message, la tuile resterait juste vide sans indice (voir le
      // bandeau #echarts-warning dans main.js pour le diagnostic complet).
      el.textContent = t('chart.unavailable');
      return;
    }

    const dimension = currentDimension(tile, drillPath);
    const instance = getOrCreateChartInstance(tile.id, el);
    if (tile.type === 'histogram') {
      bumpSeq(tile.id); // un rendu asynchrone encore en vol pour cette tuile (ancien type) ne doit plus s'appliquer
      instance.hideLoading();
      renderHistogram(tile, rows, state, instance);
      return;
    }
    if (tile.type === 'box') {
      bumpSeq(tile.id);
      instance.hideLoading();
      renderBox(tile, rows, state, instance);
      return;
    }
    if (tile.type === 'sankey') {
      bumpSeq(tile.id);
      instance.hideLoading();
      renderSankey(tile, rows, state, instance);
      return;
    }
    if (tile.type === 'sunburst') {
      bumpSeq(tile.id);
      instance.hideLoading();
      renderSunburst(tile, rows, state, instance);
      return;
    }
    if (tile.type === 'calendar') {
      bumpSeq(tile.id);
      instance.hideLoading();
      renderCalendar(tile, rows, state, instance);
      return;
    }
    if (tile.type === 'heatmap') {
      return renderHeatmap(tile, rows, state, instance);
    }
    // Formateur de la mesure (axe Y, infobulles, étiquettes) ; nuage de points : l'axe X porte `measure`,
    // l'axe Y `measureY`, chacun avec le format de SA colonne.
    const tileFormat = fmtFor(tile, tile.measure);
    const fY = tile.type === 'scatter' ? fmtFor(tile, tile.measureY) : tileFormat;
    // Valeur d'infobulle : une valeur absente (combinaison sans donnée) s'affiche « – », jamais vide.
    const tipValue = (v) => (tileFormat.format(v) || '–');

    // Radar "compétences en colonnes" (tile.radarAxisMode === 'columns', voir ROADMAP.md : demande
    // du forum Grist, un radar à partir de plusieurs colonnes numériques plutôt que d'une seule
    // dimension catégorielle) : `tile.dimension`/`tile.measure` ne sont pas renseignés dans ce mode
    // (voir js/main.js, champs masqués), donc computeGroupBy ci-dessous n'a rien de cohérent à
    // regrouper — un axe par colonne choisie, valeur = moyenne de cette colonne sur `rows`.
    const isRadarColumns = tile.type === 'radar' && tile.radarAxisMode === 'columns';
    const radarAxesColumns = isRadarColumns ? (tile.radarAxes || []).filter(Boolean) : [];
    // Comparaison élève/moyenne du groupe filtré (ROADMAP.md, demande du forum Grist) : valable dans
    // les DEUX modes d'axes du radar. `radarEntityRows` reste `null` hors radar/sans comparaison
    // choisie — `hasRadarEntity` distingue "pas de comparaison" de "comparaison choisie mais aucune
    // ligne ne correspond" (valeur orpheline après un changement de table, par ex.), qui retombe
    // silencieusement sur l'affichage normal plutôt que sur une tuile vide.
    const radarEntityRows = (tile.type === 'radar' && tile.radarEntityColumn && tile.radarEntityValue)
      ? rows.filter((r) => sameValue(r[tile.radarEntityColumn], tile.radarEntityValue))
      : null;
    const hasRadarEntity = !!(radarEntityRows && radarEntityRows.length);

    const seq = bumpSeq(tile.id);
    const usingDuckDb = rows.length >= DUCKDB_ROW_THRESHOLD;
    if (usingDuckDb) instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });
    // scatter a besoin de deux agrégations indépendantes (mesures X/Y) : lancées en parallèle, pas
    // en séquence, pour ne payer qu'une seule fois la latence du plus lent des deux chargements
    // DuckDB — même raisonnement que renderKpi (valeur + tendance). Radar "colonnes" : une moyenne
    // par axe, lancées en parallèle elles aussi, même raison. Radar + comparaison : la série de
    // l'entité comparée (ses propres lignes seulement) est elle aussi calculée en parallèle du
    // reste plutôt qu'après coup.
    const hasSeries = isSeriesTile(tile);
    const [agg, aggY, radarColumnValues, radarEntityColumnValues, radarEntityAgg, seriesGroups, aggSize, scatterSplit] = await Promise.all([
      isRadarColumns ? Promise.resolve(null) : computeGroupBy(rows, dimension, tile.measure, tile.aggFn),
      tile.type === 'scatter' ? computeGroupBy(rows, dimension, tile.measureY, tile.aggFn)
        // Combo : la 2e mesure (courbe) a son propre agrégat ; en Pareto la courbe se déduit des barres.
        : (tile.type === 'combo' && comboModeOf(tile) === 'measure') ? computeGroupBy(rows, dimension, tile.measureY, tile.aggFnY || tile.aggFn)
          : Promise.resolve(null),
      isRadarColumns ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(rows, col, 'avg'))) : Promise.resolve(null),
      (isRadarColumns && hasRadarEntity) ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(radarEntityRows, col, 'avg'))) : Promise.resolve(null),
      (!isRadarColumns && tile.type === 'radar' && hasRadarEntity) ? computeGroupBy(radarEntityRows, dimension, tile.measure, tile.aggFn) : Promise.resolve(null),
      hasSeries ? computeSeriesGroups(rows, dimension, tile.seriesColumn, tile.measure, tile.aggFn) : Promise.resolve(null),
      // Bulles : la 3e mesure (taille, son propre agrégat) ; avec une colonne de couleur, tout se calcule PAR couleur (computeScatterSplit).
      (tile.type === 'scatter' && tile.measureSize && !tile.seriesColumn) ? computeGroupBy(rows, dimension, tile.measureSize, tile.aggFnSize || tile.aggFn) : Promise.resolve(null),
      (tile.type === 'scatter' && tile.seriesColumn) ? computeScatterSplit(rows, dimension, tile) : Promise.resolve(null)
    ]);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps
    // Inconditionnel, même raison que renderGauge ci-dessus : un rendu qui repasse sous le seuil
    // pendant qu'un rendu précédent (au-dessus du seuil) pour cette même tuile est encore en vol
    // doit quand même lever le masque que CE DERNIER a affiché, même si CE rendu-ci (le gagnant)
    // n'utilise pas DuckDB lui-même — sinon le masque reste bloqué indéfiniment.
    instance.hideLoading();

    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    // sameValue (pas !==) : le filtre stocke souvent params.name (toujours une chaîne ECharts),
    // à comparer à `d` qui garde le type d'origine de la donnée (ex. Annee=2025, un nombre).
    const dim = (d) => (activeOnThisDimension && !filterSelects(activeOnThisDimension, d)
      ? { opacity: 0.3 }
      : undefined);

    // Tri d'affichage optionnel (tile.sortMode) : une étape distincte, appliquée APRÈS l'agrégation
    // (qui garde son ordre d'apparition, piège n°14), et seulement pour les types qui s'y prêtent
    // (voir GristBI.data.isSortableTile) — `agg` reste tel quel pour tous les autres.
    const groups = isSortableTile(tile) ? sortGroups(agg, tile.sortMode) : agg;
    // Séries multiples : catégories (triées sur le total des séries) et une série ECharts par valeur de
    // la colonne « Séries ». `null` pour une tuile à série unique : les branches bar/line plus bas
    // gardent alors EXACTEMENT leur construction d'avant.
    const multi = seriesGroups ? assembleSeries(agg.map((d) => d.dimension), seriesGroups, tile.sortMode) : null;
    const seriesLegend = multi && multi.series.length > 1 ? { top: 0, type: 'scroll' } : undefined;
    const seriesGrid = seriesLegend ? { ...numericGrid, top: 40 } : numericGrid;
    // Empilé : toutes les séries partagent UNE pile ECharts. Une info-bulle sur l'axe y ajoute le TOTAL de
    // la catégorie (la seule chose qu'on ne lit pas sur la hauteur d'une pile). Texte HTML : noms de
    // séries échappés (ce sont des valeurs de la table), nombres au format français.
    const stacked = !!multi && isStackedTile(tile);
    const stackedTooltip = {
      trigger: 'axis',
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        if (!list.length) return '';
        let total = 0;
        const lines = list.map((p) => {
          const v = Number(p.value);
          if (Number.isFinite(v)) total += v;
          return `${p.marker}${escapeHtml(String(p.seriesName))} : ${Number.isFinite(v) ? tileFormat.format(v) : '–'}`;
        });
        const head = escapeHtml(String(list[0].axisValueLabel != null ? list[0].axisValueLabel : list[0].name));
        return `${head}<br/>${lines.join('<br/>')}<br/><b>${escapeHtml(t('chart.stacked.total'))} : ${tileFormat.format(total)}</b>`;
      }
    };

    // Palette choisie sur la tuile (`tile.palette`, js/data.js:PALETTES) ; `standard` sans choix.
    const palette = paletteColors(tile.palette);
    // 100 % empilé : chaque catégorie ramenée à ses parts, la valeur brute gardée (`raw`) pour l'infobulle. La pile somme à 100, l'axe va de
    // 0 à 100 et ses graduations s'écrivent en %.
    const stackPct = stacked && isStackedPercentTile(tile);
    const pctTooltip = {
      trigger: 'axis',
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        if (!list.length) return '';
        let total = 0;
        const lines = list.map((p) => {
          const raw = p.data && p.data.raw;
          if (Number.isFinite(Number(raw))) total += Number(raw);
          return `${p.marker}${escapeHtml(String(p.seriesName))} : ${tileFormat.percent(Number(p.value))}${raw != null ? ` (${tileFormat.format(raw) || '–'})` : ''}`;
        });
        const head = escapeHtml(String(list[0].axisValueLabel != null ? list[0].axisValueLabel : list[0].name));
        return `${head}<br/>${lines.join('<br/>')}<br/><b>${escapeHtml(t('chart.stacked.total'))} : ${tileFormat.format(total)}</b>`;
      }
    };
    const valueAxisPct = { type: 'value', min: 0, max: 100, axisLabel: { formatter: (v) => tileFormat.percent(v) } };
    // Étiquettes de valeur (`tile.valueLabels`, barres et courbe) : au-dessus de la barre ou du point (à droite d'une barre horizontale),
    // DANS le segment d'une pile avec le texte noir ou blanc qui contraste avec sa couleur ; compactes (`f.axis`) ou en % en 100 % empilé ;
    // une valeur absente ou nulle d'une pile n'écrit rien, et celles qui se recouvrent sont masquées (`labelLayout.hideOverlap`).
    const labelsOn = !!tile.valueLabels && supportsValueLabels(tile);
    const thLabel = chartTheme();
    const seriesLabelOptions = (index) => {
      if (!labelsOn) return {};
      const color = palette[index % palette.length];
      return {
        label: {
          show: true,
          position: stacked ? 'inside' : (tile.type === 'bar' && tile.horizontal ? 'right' : 'top'),
          color: stacked ? heatTextColor(color) : thLabel.text,
          fontSize: 10,
          formatter: (p) => {
            const raw = p.value;
            const v = Number(raw);
            if (raw == null || !Number.isFinite(v) || (stacked && v === 0)) return '';
            return stackPct ? tileFormat.percent(v) : (tileFormat.axis(v) || '');
          }
        },
        labelLayout: { hideOverlap: true }
      };
    };
    instance.__refit = undefined; // une géométrie en pixels d'un rendu précédent (petits multiples) ne vaut plus ; celui qui en pose une la repose
    let option;
    // Petits multiples : un petit graphique par série, sur UNE instance (js/data.js:isSmallMultiplesTile) ; remplace la construction
    // barres/courbe plus bas, qui ne s'exécute donc pas.
    const smallOn = !!multi && isSmallMultiplesTile(tile);
    if (smallOn) {
      const built = buildSmallMultiplesOption(tile, multi, { f: tileFormat, tipValue, dim, palette, width: instance.getWidth(), height: instance.getHeight() });
      option = built.option;
      instance.__refit = () => {
        const w = instance.getWidth();
        const h = instance.getHeight();
        if (w && h) instance.setOption(built.refit(w, h));
      };
    } else if (tile.type === 'pie') {
      // `tile.donut` : même série `pie` qu'un camembert plein, seul le rayon change (un tableau
      // [intérieur, extérieur] ouvre le trou central) — drill-down/cross-filter inchangés, un clic
      // renvoie toujours `params.name`. `tile.showPct` : étiquette « nom » puis « x,x % » sur DEUX
      // lignes (une seule ligne « nom : x,x % » était tronquée avec des points de suspension dans une
      // tuile de ~270 px, le pourcentage — la seule raison d'être de l'option — disparaissait), au
      // format de la langue (`f.percent`, js/format.js ; texte canvas d'ECharts, jamais interprété comme du
      // HTML, voir GFS-ETAT.md consigne 005).
      option = {
        color: palette,
        tooltip: { trigger: 'item', valueFormatter: tipValue },
        series: [{
          type: 'pie',
          radius: tile.donut ? ['40%', '65%'] : '65%',
          // ECharts 6 a doublé la 2e partie du trait d'étiquette par défaut (15 -> 30 px) : les noms
          // longs ("Widget B") se tronquaient alors en "Widge…". On garde le trait court de la v5.
          labelLine: { length: 15, length2: 15 },
          ...(tile.showPct ? {
            percentPrecision: 1,
            label: { formatter: (p) => `${p.name}\n${tileFormat.percent(p.percent)}` }
          } : {}),
          data: groups.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'treemap') {
      option = {
        color: palette,
        tooltip: { trigger: 'item', valueFormatter: tipValue },
        series: [{
          type: 'treemap',
          roam: false,
          // Version PLATE délibérément (voir ROADMAP.md) : un seul niveau de rectangles, pas de
          // hiérarchie imbriquée. `nodeClick: false` désactive le zoom-sur-clic natif d'ECharts
          // (pensé pour une hiérarchie à plusieurs niveaux) pour laisser le clic au gestionnaire
          // générique ci-dessus (drill-down/cross-filter), sans comportement concurrent.
          nodeClick: false,
          breadcrumb: { show: false },
          // ECharts 6 a remplacé le cadre par défaut (80 % × 80 % centré) par des marges fixes en
          // pixels (20 / 50), qui laissaient ~60 px de haut dans une tuile de 224 px : cadre explicite.
          left: 8, right: 8, top: 8, bottom: 8,
          data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'funnel') {
      // Entonnoir : une série `funnel` (ECharts 6.1.0) alimentée par le MÊME agrégat « une dimension +
      // une mesure » que le camembert. `sort: 'none'` : l'ordre des étapes est décidé en amont (`groups`,
      // ordre des données ou tri choisi, voir isSortableTile) — l'`'descending'` par défaut d'ECharts
      // remettrait à plat un parcours (Visite, Inscription, Achat) que la table range déjà dans l'ordre.
      // Chaque étape porte son `name` : le gestionnaire de clic générique (drill-down/filtre croisé)
      // marche tel quel. Cadre explicite (voir la note ECharts 6 plus haut, piège n°21) ; libellés à
      // DROITE de l'entonnoir, en texte foncé, plutôt que « inside » (blanc sur jaune, illisible, et
      // coupé sur les dernières étapes, étroites).
      const firstValue = groups.length ? Number(groups[0].value) : 0;
      option = {
        color: palette,
        tooltip: {
          trigger: 'item',
          formatter: (p) => {
            const pct = firstValue > 0 && Number.isFinite(p.value)
              ? `<br/>${escapeHtml(t('chart.funnel.ofFirst', { pct: tileFormat.percent((p.value / firstValue) * 100) }))}` : '';
            return `${escapeHtml(String(p.name))}<br/>${tileFormat.format(p.value)}${pct}`;
          }
        },
        series: [{
          type: 'funnel',
          sort: 'none',
          left: 8, right: 8, top: 8, bottom: 8,
          width: '55%',
          minSize: '8%',
          gap: 2,
          // Nom puis valeur sur DEUX lignes, la place à droite de l'entonnoir (45 % moins le trait) comme largeur : un
          // nom long est tronqué par « … », la valeur (l'info utile) reste visible. Une ligne unique sortait de la tuile.
          label: {
            show: true,
            position: 'right',
            width: Math.max(48, Math.floor((instance.getWidth() - 16) * 0.45 - 22)),
            overflow: 'truncate',
            fontSize: 11,
            lineHeight: 13,
            formatter: (p) => `${p.name}\n${tileFormat.axis(p.value)}`
          },
          labelLine: { show: true, length: 12 },
          data: groups.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'scatter') {
      // Version agrégée (pas ligne-à-ligne) : un point par valeur de la dimension, ses coordonnées
      // X/Y sont les agrégats de deux mesures DIFFÉRENTES sur ce même groupe. Les appels à
      // computeGroupBy (ci-dessus, en parallèle) portent sur le même `rows`/`dimension`, donc le
      // même ensemble de groupes, mais on associe par NOM de dimension (`bubblePoints`) plutôt que par
      // index pour rester correct même si l'ordre venait à diverger un jour entre les appels.
      // Bulles (`tile.measureSize`, `tile.seriesColumn`) : l'aire d'une bulle = la 3e mesure (échelle commune à
      // toutes les couleurs, voir `bubbleDiameters`), une couleur et une entrée de légende par valeur de la colonne.
      instance.__refit = undefined;
      const bubble = isBubbleTile(tile);
      const fSize = bubble ? fmtFor({ ...tile, aggFn: tile.aggFnSize || tile.aggFn }, tile.measureSize) : null;
      const sets = scatterSplit
        ? scatterSplit.map((sr) => ({ name: sr.name, points: bubblePoints(sr.gx, sr.gy, sr.gs).points }))
        : [{ name: '', points: bubblePoints(agg, aggY, aggSize).points }];
      const allSizes = [].concat(...sets.map((set) => set.points.map((pt) => pt.size)));
      // Diamètre maximal : une fraction de la plus petite côté de la tuile (en pixels : suit le redimensionnement, voir __refit).
      const maxDiameter = () => Math.max(18, Math.min(56, Math.round(Math.min(instance.getWidth() || 300, instance.getHeight() || 220) * 0.18)));
      const buildSeries = (diameterMax) => {
        const diameters = bubble ? bubbleDiameters(allSizes, diameterMax) : null;
        let k = 0;
        return sets.map((set) => {
          const items = [];
          set.points.forEach((pt) => {
            const diameter = diameters ? diameters[k] : 14;
            k++;
            if (diameter === null) return; // taille nulle, négative ou absente : pas d'aire, pas de bulle
            // `name` explicite : contrairement à bar (axe catégoriel, ECharts déduit params.name de
            // l'index sur l'axe), scatter a deux axes numériques -> rien n'associe un point à sa
            // catégorie sans ce champ, et le gestionnaire de clic générique deviendrait muet
            // (params.name undefined, drill/cross-filter sur une valeur "undefined").
            items.push({
              name: pt.dimension,
              value: bubble ? [pt.x, pt.y, pt.size] : [pt.x, pt.y],
              symbolSize: diameter,
              itemStyle: dim(pt.dimension) || (bubble ? { opacity: 0.8 } : undefined)
            });
          });
          return { type: 'scatter', name: set.name || undefined, symbolSize: 14, data: items };
        });
      };
      const showLegend = sets.length > 1;
      option = {
        color: palette,
        grid: showLegend ? { ...numericGrid, top: 40 } : numericGrid,
        legend: showLegend ? { top: 0, type: 'scroll' } : undefined,
        tooltip: {
          trigger: 'item',
          formatter: (params) => {
            const v = params.value || [];
            const lines = [escapeHtml(String(params.name))];
            if (showLegend && params.seriesName) lines.push(`${params.marker || ''}${escapeHtml(tile.seriesColumn)} : ${escapeHtml(String(params.seriesName))}`);
            lines.push(`${escapeHtml(tile.measure)} : ${tileFormat.format(v[0])}`);
            lines.push(`${escapeHtml(tile.measureY)} : ${fY.format(v[1])}`);
            if (bubble) lines.push(`${escapeHtml(tile.measureSize)} (${t('chart.bubble.size')}) : ${fSize.format(v[2]) || '–'}`);
            return lines.join('<br/>');
          }
        },
        xAxis: { type: 'value', axisLabel: { formatter: tileFormat.axis } },
        yAxis: { type: 'value', axisLabel: { formatter: fY.axis } },
        series: buildSeries(maxDiameter())
      };
      if (bubble) instance.__refit = () => instance.setOption({ series: buildSeries(maxDiameter()) });
    } else if (tile.type === 'waterfall') {
      // Pas de série ECharts native "waterfall" (voir ROADMAP.md) : simulation standard par 2
      // séries de barres empilées — une invisible (`base`, la partie du cumul déjà atteinte avant
      // cette catégorie) portant la vraie partie visible (`rise`/`fall` selon le signe), comme
      // documenté par ECharts lui-même pour ce type de graphique. Reste sur le MÊME
      // dimension/measure/aggFn que "bar" (aucun nouveau champ de formulaire) : seul l'empilement
      // cumulatif change, pas la donnée sous-jacente — même `agg` que la branche "bar" ci-dessous.
      // xAxis reste catégoriel -> params.name (clic) est TOUJOURS la catégorie, quelle que soit la
      // série cliquée (y compris la base invisible) : le gestionnaire générique de clic
      // (getOrCreateChartInstance) fonctionne donc ici SANS aucune adaptation, contrairement au
      // radar ci-dessous.
      const { base, rise, fall } = waterfallSeries(agg);
      option = {
        color: palette,
        grid: { ...numericGrid, top: 40 },
        legend: { top: 0, data: [t('chart.waterfall.increase'), t('chart.waterfall.decrease')] },
        // Une seule ligne par catégorie : sa variation (signée) sous la bonne légende. L'infobulle par défaut
        // listait aussi l'autre série à 0 (« Baisse 0 » sur une hausse) et la valeur brute non formatée.
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const list = Array.isArray(params) ? params : [params];
            const idx = list.length ? list[0].dataIndex : -1;
            if (idx < 0 || !agg[idx]) return '';
            const v = agg[idx].value;
            const name = t(v < 0 ? 'chart.waterfall.decrease' : 'chart.waterfall.increase');
            const hit = list.find((p) => p.seriesName === name);
            return `${escapeHtml(String(agg[idx].dimension))}<br/>${hit ? hit.marker : ''}${escapeHtml(name)} : ${tipValue(v)}`;
          }
        },
        xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
        yAxis: { type: 'value', axisLabel: { formatter: tileFormat.axis } },
        series: [
          {
            name: t('chart.waterfall.base'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: 'transparent' },
            tooltip: { show: false },
            data: base.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          },
          {
            name: t('chart.waterfall.increase'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: CATEGORICAL_PALETTE[2] },
            data: rise.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          },
          {
            name: t('chart.waterfall.decrease'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: CATEGORICAL_PALETTE[7] },
            data: fall.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          }
        ]
      };
    } else if (tile.type === 'radar') {
      // Radar à une ou DEUX séries (un ou deux "polygones"). Deux façons d'obtenir ses axes
      // (tile.radarAxisMode, voir ROADMAP.md) :
      // - 'dimension' (par défaut, comportement historique) : un axe par valeur de la dimension —
      //   plutôt que le radar classique Power BI (plusieurs mesures en axes pour comparer quelques
      //   entités), qui ne collait à aucun jeu de données démonstratif disponible au moment du
      //   premier jet (voir HYPOTHESES.md).
      // - 'columns' (compétences en colonnes, demande du forum Grist — entretiens d'orientation :
      //   compétences déjà en colonnes, une ligne par élève) : un axe par colonne numérique choisie
      //   (tile.radarAxes), valeur = moyenne de cette colonne sur `rows` (radarColumnValues
      //   ci-dessus, déjà calculé en tenant compte du seuil DuckDB).
      const axisNames = isRadarColumns ? radarAxesColumns : agg.map((d) => String(d.dimension));
      // Aucun axe (filtre qui ne laisse aucune ligne, colonnes pas encore choisies) : ECharts, en v5
      // comme en v6, lève « Cannot read properties of undefined (reading 'push') » sur un radar sans
      // indicateur — l'exception sortait de ce rendu async sans rien afficher. Tuile simplement vide.
      if (!axisNames.length) {
        instance.setOption({ series: [] }, true);
        return;
      }
      const groupValues = isRadarColumns ? radarColumnValues : agg.map((d) => d.value);
      // Étiquette de la série "groupe" : `tile.measure` en mode dimension (inchangé, même valeur
      // qu'avant la comparaison élève/moyenne ci-dessous) ; en mode colonnes, `tile.title` tant
      // qu'aucune comparaison n'est affichée (comportement du premier jet de ce mode, inchangé),
      // sinon un libellé explicite ("Moyenne du groupe") pour la distinguer de la série élève.
      const groupLabel = isRadarColumns ? (hasRadarEntity ? t('chart.radar.groupAverage') : GristBI.i18n.tileTitle(tile)) : tile.measure;

      // Comparaison élève/moyenne du groupe filtré (tile.radarEntityColumn/radarEntityValue/
      // radarCompareAverage, voir ROADMAP.md) : une 2e série avec les mêmes axes, calculée sur les
      // seules lignes de l'élève choisi. En mode dimension, ses propres valeurs peuvent ne pas
      // couvrir tous les axes du groupe (ex. une note manquante pour une matière) — complétées à 0
      // par nom d'axe plutôt que de décaler les valeurs par position.
      let series;
      if (hasRadarEntity) {
        const entityValues = isRadarColumns
          ? radarEntityColumnValues
          : (() => {
              const byName = new Map(radarEntityAgg.map((d) => [String(d.dimension), d.value]));
              return axisNames.map((name) => (byName.has(name) ? byName.get(name) : 0));
            })();
        const entitySeries = { name: String(tile.radarEntityValue), value: entityValues };
        series = tile.radarCompareAverage ? [entitySeries, { name: groupLabel, value: groupValues }] : [entitySeries];
      } else {
        series = [{ name: groupLabel, value: groupValues }];
      }

      // Même max/min PARTAGÉ par tous les axes ET toutes les séries affichées (pas un max par axe,
      // qui normaliserait chaque axe à 100% et rendrait toute comparaison de hauteur trompeuse, ni
      // un max par série, qui rendrait la comparaison élève/moyenne elle-même trompeuse) ; `min`
      // partagé aussi, pour les mesures pouvant être négatives.
      // Mode « colonnes » : chaque axe est une colonne, donc SON format ; mode dimension : celui de la mesure.
      const axisFmts = axisNames.map((n) => (isRadarColumns ? fmtFor(tile, n) : tileFormat));
      const allValues = series.reduce((acc, s) => acc.concat(s.value), []);
      const maxVal = Math.max(0, ...allValues);
      const minVal = Math.min(0, ...allValues);
      option = {
        color: palette,
        // Une ligne par axe, nombres au format français (par défaut : « 8.504166666666666 »), noms
        // échappés (ce sont des valeurs de la table). `confine` est posé pour TOUS les types plus bas.
        tooltip: {
          trigger: 'item',
          formatter: (p) => {
            const values = Array.isArray(p.value) ? p.value : [];
            return `<b>${escapeHtml(String(p.name == null ? '' : p.name))}</b><br/>`
              + axisNames.map((n, i) => `${escapeHtml(String(n))} : ${axisFmts[i].format(values[i]) || '–'}`).join('<br/>');
          }
        },
        // Légende compacte et défilante : deux noms longs ne passent pas sur deux lignes (elle recouvrirait le polygone), ils se
        // parcourent par des flèches. Sa place est réservée en haut par `finalizeOption` (GristBI.format.radarLayout).
        legend: series.length > 1
          ? { top: 2, type: 'scroll', itemWidth: 14, itemHeight: 8, itemGap: 14, textStyle: { fontSize: 11 }, data: series.map((s) => s.name) }
          : undefined,
        radar: {
          // ECharts 6 a réduit le rayon par défaut (75 % -> 50 %) mais affiche désormais les noms
          // d'axes en entier : 62 % garde un polygone lisible dans une tuile de 224 px sans les couper.
          radius: '62%',
          indicator: axisNames.map((name) => ({ name: String(name), max: maxVal || 1, min: minVal }))
        },
        series: [{
          type: 'radar',
          data: series
        }]
      };
    } else if (tile.type === 'combo') {
      // Combo barres + courbe à DOUBLE AXE (js/data.js:comboSeries) : barres sur l'axe de gauche, courbe sur
      // celui de droite, deux formats de nombres (chaque série formate SA colonne). Mode Pareto : barres du
      // plus grand au plus petit, courbe = part cumulée en % sur un axe fixe 0-100 avec un repère à 80 %.
      // Les deux séries partagent l'axe des catégories : le clic (drill-down / filtre croisé) passe par le
      // gestionnaire générique, qui lit `params.name`, quelle que soit la série cliquée.
      const combo = comboSeries(tile, groups, aggY);
      const pareto = combo.mode === 'pareto';
      // L'agrégat de la courbe peut différer de celui des barres : un comptage n'a jamais le format d'une colonne.
      const fLine = pareto ? tileFormat : fmtFor({ ...tile, aggFn: tile.aggFnY || tile.aggFn }, tile.measureY);
      const aggLabel = (fn) => t('tileForm.agg.' + (fn || 'sum'));
      // Légende : les noms de colonnes, seuls (une tuile de 270 px ne porte pas « Montant (Somme) » + « Quantité (Somme) ») ;
      // l'agrégat n'est ajouté que si les deux séries portent la même colonne et ne se distingueraient plus.
      const sameColumn = !pareto && tile.measure === tile.measureY;
      const barName = sameColumn ? `${tile.measure} (${aggLabel(tile.aggFn)})` : String(tile.measure);
      const lineName = pareto ? t('chart.combo.cumulative') : (sameColumn ? `${tile.measureY} (${aggLabel(tile.aggFnY || tile.aggFn)})` : String(tile.measureY));
      const lineValue = (v) => (pareto ? (Number.isFinite(Number(v)) ? tileFormat.percent(Number(v)) : '–') : (fLine.format(v) || '–'));
      option = {
        color: palette,
        grid: { ...numericGrid, top: 40 },
        legend: { top: 0, type: 'scroll' },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: combo.categories },
        yAxis: [
          { type: 'value', axisLabel: { formatter: tileFormat.axis } },
          {
            type: 'value',
            position: 'right',
            splitLine: { show: false },
            axisLabel: { formatter: pareto ? (v) => tileFormat.percent(v) : fLine.axis },
            ...(pareto ? { min: 0, max: 100 } : {})
          }
        ],
        series: [
          {
            type: 'bar',
            name: barName,
            yAxisIndex: 0,
            tooltip: { valueFormatter: tipValue },
            data: combo.bars.map((v, i) => ({ value: v, itemStyle: dim(combo.categories[i]) }))
          },
          {
            type: 'line',
            name: lineName,
            yAxisIndex: 1,
            symbolSize: 8,
            z: 3,
            tooltip: { valueFormatter: lineValue },
            data: combo.line.map((v, i) => ({ value: v, itemStyle: dim(combo.categories[i]) })),
            ...(pareto ? {
              markLine: {
                silent: true,
                symbol: 'none',
                data: [{ yAxis: 80 }],
                // Pas d'étiquette : la graduation « 80 % » de l'axe de droite la dit déjà, et le texte recouvrait la courbe.
                lineStyle: { type: 'dashed', width: 1 },
                label: { show: false }
              }
            } : {})
          }
        ]
      };
    } else if (tile.type === 'line') {
      // Courbe (ou aire si `tile.areaFill`) : même formulaire et mêmes données que "bar" (1 dimension
      // + 1 mesure + agrégat, drill-down, cross-filter), seule la série ECharts change — l'axe est
      // catégoriel et chaque point porte son `name`, donc le gestionnaire de clic générique
      // (handleTileClick) marche tel quel. L'ordre des points est celui des données (ou du tri
      // choisi) : pour une série temporelle, une dimension dérivée d'une date ("Date.Annee",
      // "Date.Mois") ou un tri « Libellé » donne l'ordre chronologique.
      const lineCategories = multi ? multi.categories : groups.map((d) => d.dimension);
      const lineSeries = multi
        ? multi.series.map((sr) => ({ name: sr.name, values: sr.values }))
        : [{ name: undefined, values: groups.map((d) => d.value) }];
      const lineShares = stackPct ? stackShares(lineSeries.map((sr) => sr.values)) : null;
      option = {
        color: palette,
        grid: seriesGrid,
        legend: seriesLegend,
        tooltip: stackPct ? pctTooltip : (stacked ? stackedTooltip : { trigger: 'axis', valueFormatter: tipValue }),
        xAxis: { type: 'category', data: lineCategories },
        yAxis: stackPct ? valueAxisPct : { type: 'value', axisLabel: { formatter: tileFormat.axis } },
        series: lineSeries.map((sr, si) => ({
          type: 'line',
          name: sr.name,
          symbolSize: 8,
          // Tracé : lissé (courbe de Bézier adoucie, jamais l'arrondi maximal) ou en escalier centré sur chaque catégorie.
          ...(lineShapeOf(tile) === 'smooth' ? { smooth: 0.35 } : (lineShapeOf(tile) === 'step' ? { step: 'middle' } : {})),
          ...seriesLabelOptions(si),
          // Aire empilée : bandes plus opaques (à 0,25 deux bandes voisines se confondent) ; aire
          // non empilée : les séries se recouvrent, donc très transparentes.
          ...(tile.areaFill ? { areaStyle: { opacity: stacked ? 0.65 : 0.25 } } : {}),
          ...(stacked ? { stack: 'total' } : {}),
          // Une combinaison absente vaut 0 dans une pile : ECharts empile sur la valeur de la série du
          // dessous, et un `null` y rompt la bande de TOUTES les séries au-dessus.
          data: sr.values.map((v, i) => (stackPct
            ? { value: lineShares[si][i] == null ? 0 : lineShares[si][i], raw: v, itemStyle: dim(lineCategories[i]) }
            : { value: (stacked && v == null) ? 0 : v, itemStyle: dim(lineCategories[i]) }))
        }))
      };
    } else {
      // bar (par défaut). `tile.horizontal` : mêmes séries, axes permutés. L'axe des catégories est
      // inversé pour que la première catégorie (ou la plus grande avec le tri « Valeur décroissante »)
      // soit EN HAUT, comme une liste qu'on lit de haut en bas ; les libellés longs sont tronqués
      // (le survol — tooltip — garde le nom complet) plutôt que de rétrécir la zone du graphique.
      const categoryLabels = multi ? multi.categories : groups.map((d) => d.dimension);
      const barSeries = multi
        ? multi.series.map((sr) => ({ name: sr.name, values: sr.values }))
        : [{ name: undefined, values: groups.map((d) => d.value) }];
      const valueAxis = stackPct ? valueAxisPct : { type: 'value', axisLabel: { formatter: tileFormat.axis } };
      const barShares = stackPct ? stackShares(barSeries.map((sr) => sr.values)) : null;
      option = {
        color: palette,
        grid: seriesGrid,
        legend: seriesLegend,
        tooltip: stackPct ? pctTooltip : (stacked ? stackedTooltip : { trigger: 'axis', valueFormatter: tipValue }),
        ...(tile.horizontal
          ? {
            xAxis: valueAxis,
            yAxis: { type: 'category', inverse: true, data: categoryLabels, axisLabel: { width: 110, overflow: 'truncate' } }
          }
          : {
            xAxis: { type: 'category', data: categoryLabels },
            yAxis: valueAxis
          }),
        series: barSeries.map((sr, si) => ({
          type: 'bar',
          name: sr.name,
          ...(stacked ? { stack: 'total' } : {}),
          ...seriesLabelOptions(si),
          data: sr.values.map((v, i) => (stackPct
            ? { value: barShares[si][i] == null ? 0 : barShares[si][i], raw: v, itemStyle: dim(categoryLabels[i]) }
            : { value: v, itemStyle: dim(categoryLabels[i]) }))
        }))
      };
    }
    // Ligne de repère (`tile.refLine`, barres et courbe) : moyenne des valeurs affichées ou objectif saisi.
    // Pas en 100 % empilé : l'axe y est en parts, un objectif ou une moyenne en valeur brute n'y est pas comparable.
    if (!stackPct && option.series && option.series.length && (tile.type === 'bar' || tile.type === 'line')) {
      const ref = refLineValue(tile, groups.map((g) => g.value));
      if (ref !== null) addRefLine(option, tile, ref, tileFormat, instance);
    }
    finalizeOption(option, instance);
    instance.setOption(option, true);
  }

  // `__refit` : une jauge dont la géométrie est calculée en pixels se redessine à la nouvelle taille (voir renderGauge).
  function resizeAll() {
    chartInstances.forEach((inst) => {
      if (inst.isDisposed()) return;
      inst.resize();
      if (typeof inst.__refit === 'function') inst.__refit();
    });
  }

  function disposeTile(tileId) {
    tableSort.delete(tileId);
    const inst = chartInstances.get(tileId);
    if (inst) { loadingInstances.delete(inst); inst.dispose(); chartInstances.delete(tileId); }
    renderSeq.delete(tileId);
  }

  // Exposé uniquement pour dev-tests/ (calcul de coordonnées pixel précises dans le test Playwright
  // via convertToPixel) - ne pas s'appuyer dessus pour de la logique applicative.
  function getInstance(tileId) { return chartInstances.get(tileId) || null; }

  GristBI.charts = { renderTile, resizeAll, disposeTile, getInstance, whenSettled };

  Object.assign(parts, { handleTileClick });
})(window);
