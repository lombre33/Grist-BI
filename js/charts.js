/*
 * Rendu des tuiles (bar/line/pie/kpi/gauge/treemap/scatter/waterfall/radar) avec ECharts : filtres
 * croisés multiples, tendance KPI, et drill-down multi-niveaux (voir GristBI.data.tileDrillLevels)
 * avec fil d'Ariane. Dépend du global `echarts` (js/vendor/echarts/, voir index.html) et de
 * GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const {
    groupByAggregate, sameValue, aggregateSingle, pivotTable, trendFromGroups, targetProgress, progressRows, sparklineValues, sparklineGeometry, measureSeriesForTile,
    waterfallSeries, sortGroups, isSortableTile, isSeriesTile, comboSeries, comboModeOf, histogramBins, histogramFilter, histogramBinIsActive, filterSelects, cellFilterToggles, heatStops, heatRange, heatCellColors, heatTextColor, isStackedTile, splitBySeries, assembleSeries, paletteColors, PALETTES, escapeHtml,
    tileDrillLevels, currentDimension, rowsForTile, wordFrequency
  } = GristBI.data;
  const { t } = GristBI.i18n;

  // Format des nombres : un formateur PAR TUILE (`tile.numberFormat`, défaut Automatique), pour la colonne dont
  // vient la valeur — voir js/format.js. `format` = valeur complète (KPI, infobulle, tableau croisé), `axis` =
  // libellé d'axe compact, `percent` = variation/part en %. La langue est relue à chaque rendu (un changement
  // de langue relance render(), js/main.js).
  function fmtFor(tile, columnId) {
    return GristBI.format.forTile(tile, columnId, GristBI.i18n.getLang());
  }
  // Tuile VIVANTE par id : un écouteur posé une fois (nuage de mots) ne doit pas figer l'objet `tile` de
  // sa création (CLAUDE.md §7 n°18).
  function liveTile(tileId) {
    const live = GristBI.store.getState().tiles.find((tl) => tl.id === tileId);
    return live || null;
  }

  const chartInstances = new Map();
  // Numéro de rendu en cours par tuile, PARTAGÉ par tous les chemins de rendu asynchrones
  // (renderKpi/renderGauge/renderChart/renderPivot/renderMeasureChart, voir computeGroupBy et
  // consorts plus bas) : un calcul SQL DuckDB est asynchrone, un nouveau rendu (filtre, édition,
  // suppression, ou même un changement de type de rendu pour la MÊME tuile) peut démarrer avant
  // qu'un précédent n'ait fini — seul le résultat du DERNIER appel lancé pour une tuile donnée doit
  // s'appliquer, les autres sont silencieusement abandonnés à leur retour. Un seul compteur par
  // tuile (pas un par fonction de rendu) : si une tuile passe de "Barres" à "KPI" entre-temps, le
  // calcul KPI qui démarre invalide aussi un calcul Barres encore en vol pour cette même tuile.
  const renderSeq = new Map();
  function bumpSeq(tileId) {
    const seq = (renderSeq.get(tileId) || 0) + 1;
    renderSeq.set(tileId, seq);
    return seq;
  }
  function isStale(tileId, seq) {
    return renderSeq.get(tileId) !== seq;
  }

  // Volume à partir duquel une agrégation passe par une vraie requête SQL DuckDB-WASM plutôt que
  // par la version JS pure de js/data.js (ROADMAP.md Tier 2 : "Moteur DuckDB-WASM, remplace
  // Array.reduce"). En-dessous, le coût FIXE du moteur (sérialisation CSV des lignes, chargement
  // paresseux du binaire ~34 Mo au tout premier appel, aller-retour avec le Worker) dépasse
  // largement ce qu'`Array.reduce` coûte déjà pour un petit tableau — valeur choisie empiriquement
  // (pas une recommandation DuckDB officielle) pour rester nettement sous le volume de la table de
  // test de charge de ce projet (~47 000 lignes, voir HYPOTHESES.md) tout en laissant les dashboards
  // habituels, bien plus petits, sur le chemin JS synchrone existant — AUCUN changement de
  // comportement pour eux. Un échec du chargement/calcul DuckDB (réseau, navigateur trop ancien)
  // retombe silencieusement sur la version JS plutôt que de casser le rendu — même philosophie que
  // le bandeau d'avertissement ECharts (`typeof echarts === 'undefined'`) plus bas dans ce fichier.
  const DUCKDB_ROW_THRESHOLD = 5000;

  async function computeGroupBy(rows, dimensionCol, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.groupByAggregate(rows, dimensionCol, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour cette agrégation, repli sur le calcul JS', e); }
    }
    return groupByAggregate(rows, dimensionCol, measureCol, aggFn);
  }

  // Séries multiples (`tile.seriesColumn`) : une agrégation par série, chacune sur SES lignes — donc
  // chacune au-dessus du seuil DuckDB seulement si elle le mérite — lancées en parallèle (même
  // raisonnement que le nuage de points : une seule latence DuckDB à payer). Le résultat est aligné
  // sur les catégories par `GristBI.data.assembleSeries` (js/data.js).
  async function computeSeriesGroups(rows, dimensionCol, seriesColumn, measureCol, aggFn) {
    return Promise.all(splitBySeries(rows, seriesColumn, t('chart.series.empty')).map(async (sr) => ({
      name: sr.name, groups: await computeGroupBy(sr.rows, dimensionCol, measureCol, aggFn)
    })));
  }

  async function computeAggregateSingle(rows, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.aggregateSingle(rows, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour cette agrégation, repli sur le calcul JS', e); }
    }
    return aggregateSingle(rows, measureCol, aggFn);
  }

  async function computePivot(rows, rowDim, colDim, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.pivotTable(rows, rowDim, colDim, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour ce tableau croisé, repli sur le calcul JS', e); }
    }
    return pivotTable(rows, rowDim, colDim, measureCol, aggFn);
  }

  // Palette catégorielle validée colorblind-safe (skill dataviz de ce projet,
  // references/palette.md — worst adjacent CVD ΔE 9.1 clair, OKLab, cible ≥8 — ordre figé, jamais
  // cyclé au hasard). Camembert : ECharts assigne une couleur par part dans cet ordre. Barres :
  // une seule série -> une seule couleur (le 1er slot, l'accent bleu) plutôt qu'une couleur par
  // catégorie, redondant avec les libellés déjà présents sur l'axe.
  // Elle vit désormais dans GristBI.data.PALETTES.standard (avec les autres palettes au choix, voir
  // `tile.palette` et paletteColors) ; cette constante reste la couleur des éléments qui n'ont PAS à
  // suivre le choix : indicateur de chargement, hausse/baisse de la cascade (vert/rouge = un sens).
  const CATEGORICAL_PALETTE = PALETTES.standard;

  // `containLabel: true` : sans ça, ECharts réserve une marge estimée AVANT de savoir combien de
  // place le formatter compact va réellement prendre (variable selon la valeur : "0" vs "2,7 M")
  // — l'estimation était trop courte, dessinant une partie du texte hors du canvas (silencieusement
  // coupé, pas d'erreur, voir HYPOTHESES.md). Partagé par tout axe numérique (bar, scatter, mesures
  // temporelles) — pas seulement le cas où le bug a été trouvé la première fois.
  const numericGrid = { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 };

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
    } else if (tile.type === 'text') {
      renderText(tile, container);
    } else if (tile.type === 'table') {
      renderTable(tile, rows, container);
    } else if (tile.type === 'progress') {
      renderProgress(tile, rows, state, container);
    } else if (tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut') {
      renderMeasureChart(tile, rows, container);
    } else {
      renderChart(tile, rows, state, container, drillPath);
    }
  }

  // Tuile Texte : aucune donnée, aucune instance ECharts (donc rien à disposer ni à redimensionner). Le contenu
  // n'est reconstruit que s'il change : la tuile est mise en cache et re-rendue à chaque render() (js/main.js).
  // `renderTextHtml` échappe tout (js/data.js) : jamais d'HTML saisi par une personne dans le DOM.
  function renderText(tile, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-text-body`);
    if (!el) return;
    const html = GristBI.data.renderTextHtml(tile.text);
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }

  // Table plate (type 'table') : une table HTML dans `.tile-chart` (comme le tableau croisé), colonnes choisies dans
  // l'ordre voulu, lignes telles qu'elles arrivent après les filtres. Le TRI d'un clic sur l'en-tête est un état de
  // lecture, jamais enregistré dans la configuration : une personne qui lit le tableau de bord le change sans le
  // modifier pour les autres (comme le chemin de drill-down, qui n'est pas persisté non plus) ; il survit aux
  // re-rendus (clé = id de tuile), tombe avec la tuile (`disposeTile`). Plafond d'affichage TABLE_TILE_MAX_ROWS
  // lignes, avec un message : le tri s'applique à TOUTES les lignes avant la coupe. Aucune cellule n'est cliquable
  // (pas de cross-filtre : une ligne n'est pas une catégorie) ; le bouton « Détail » montre toutes les colonnes.
  const tableSort = new Map(); // id de tuile -> { column, dir: 'asc' | 'desc' }
  function renderTable(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const columns = GristBI.data.tableColumnsOf(tile, rows);
    const sort = tableSort.get(tile.id);
    const sortCol = sort && columns.includes(sort.column) ? sort : null;
    const sorted = sortCol ? GristBI.data.sortRowsBy(rows, sortCol.column, sortCol.dir) : rows;
    const shown = sorted.slice(0, GristBI.data.TABLE_TILE_MAX_ROWS);
    const lang = GristBI.i18n.getLang();

    let html;
    if (!columns.length) {
      html = `<p class="pivot-empty">${escapeHtml(t('chart.table.noColumns'))}</p>`;
    } else {
      const head = columns.map((c) => {
        const dir = sortCol && sortCol.column === c ? sortCol.dir : null;
        const arrow = dir === 'asc' ? '▲' : (dir === 'desc' ? '▼' : '');
        const aria = dir === 'asc' ? 'ascending' : (dir === 'desc' ? 'descending' : 'none');
        return `<th scope="col" aria-sort="${aria}"><button type="button" class="dt-sort" data-column="${escapeHtml(c)}" title="${escapeHtml(t('chart.table.sortBy', { column: c }))}">`
          + `<span>${escapeHtml(c)}</span><span class="dt-arrow" aria-hidden="true">${arrow}</span></button></th>`;
      }).join('');
      const body = shown.map((r) => `<tr>${columns.map((c) => {
        const v = r[c];
        const isNum = (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'bigint';
        const text = isNum ? GristBI.format.cellNumber(tile, c, v, lang) : GristBI.data.cellText(v);
        return `<td${isNum ? ' class="dt-num"' : ''}>${escapeHtml(text)}</td>`;
      }).join('')}</tr>`).join('');
      const empty = shown.length ? '' : `<p class="pivot-empty">${escapeHtml(t('chart.table.empty'))}</p>`;
      const more = rows.length > shown.length
        ? `<p class="dt-truncated">${escapeHtml(t('chart.table.truncated', { shown: shown.length, total: rows.length }))}</p>` : '';
      html = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${empty}${more}`;
    }
    // Reconstruit seulement si le contenu change : la tuile est re-rendue à chaque render() (js/main.js) et un
    // innerHTML identique ferait perdre la position de défilement et le focus d'un en-tête.
    if (el.dataset.html !== html) {
      const scroll = el.scrollTop;
      el.innerHTML = html;
      el.dataset.html = html;
      el.scrollTop = scroll;
    }
    if (el.dataset.bound !== '1') {
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.dt-sort');
        if (!btn || !el.contains(btn)) return;
        const live = liveTile(tile.id); // la tuile VIVANTE, jamais celle du premier rendu (CLAUDE.md §7 n°18)
        if (!live) return;
        const column = btn.dataset.column;
        const cur = tableSort.get(live.id);
        const dir = GristBI.data.nextSortDir(cur && cur.column === column ? cur.dir : null);
        if (dir) tableSort.set(live.id, { column, dir }); else tableSort.delete(live.id);
        const state = GristBI.store.getState();
        renderTable(live, rowsForTile(live, state), container);
        const again = el.querySelector(`.dt-sort[data-column="${CSS.escape(column)}"]`);
        if (again) again.focus();
      });
    }
  }

  // ASYNCHRONE depuis que la valeur/la tendance peuvent passer par DuckDB-WASM au-delà du seuil
  // (voir computeAggregateSingle/computeGroupBy) — les calculs sont indépendants (une
  // tuile KPI n'a qu'une seule mesure mais potentiellement une dimension de tendance différente),
  // lancés en parallèle plutôt qu'en séquence pour ne payer qu'une seule fois la latence du plus
  // lent des deux. Sous le seuil (l'immense majorité des dashboards), les deux résolvent sur le
  // même tick et rien ne change visuellement par rapport à l'ancien comportement synchrone.
  async function renderKpi(tile, rows, container) {
    const seq = bumpSeq(tile.id);
    // Les groupes de la dimension de tendance servent deux fois : le delta (deux dernières périodes) et, si la
    // tuile le demande, la courbe (toutes les périodes). Un seul calcul, DuckDB au-delà du seuil comme le reste.
    const hasTarget = Boolean(tile.targetColumn) || finiteTarget(tile.target) != null;
    const [value, groups, targetValue] = await Promise.all([
      computeAggregateSingle(rows, tile.measure, tile.aggFn),
      tile.trendDimension ? computeGroupBy(rows, tile.trendDimension, tile.measure, tile.aggFn) : Promise.resolve(null),
      tile.targetColumn ? computeAggregateSingle(rows, tile.targetColumn, tile.aggFn) : Promise.resolve(tile.target)
    ]);
    if (isStale(tile.id, seq)) return; // rendu plus récent pour cette tuile entre-temps
    const trend = groups ? trendFromGroups(groups) : null;

    const valueEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-value`);
    if (!valueEl) return;
    const kpiFmt = fmtFor(tile, tile.measure);
    const kpiText = kpiFmt.format(value) || '–';
    valueEl.textContent = kpiText;
    // Le CSS réduit la police pour que la valeur tienne dans la tuile (voir `.tile-kpi-value`) : il lui faut la longueur.
    valueEl.style.setProperty('--kpi-chars', String(Math.max(kpiText.length, 4)));

    const trendEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-trend`);
    if (trendEl) {
      if (!trend) {
        trendEl.hidden = true;
      } else {
        const isUp = trend.deltaPct >= 0;
        trendEl.hidden = false;
        trendEl.className = `tile-kpi-trend ${isUp ? 'trend-up' : 'trend-down'}`;
        trendEl.textContent = `${isUp ? '▲' : '▼'} ${kpiFmt.percent(Math.abs(trend.deltaPct))} vs ${trend.previousKey}`;
      }
    }

    // Courbe de tendance (SVG maison, pas d'instance ECharts : rien à disposer ni à redimensionner).
    const sparkEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-spark`);
    if (sparkEl) {
      const geo = tile.kpiSparkline && groups ? sparklineGeometry(sparklineValues(groups), 100, 30, 3) : null;
      if (!geo) {
        sparkEl.hidden = true;
        sparkEl.innerHTML = '';
      } else {
        sparkEl.hidden = false;
        sparkEl.innerHTML = '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
          + `<path class="spark-area" d="${geo.area}"/><path class="spark-line" d="${geo.line}" vector-effect="non-scaling-stroke"/></svg>`
          + `<span class="spark-dot" style="left:${geo.last.x}%;top:${geo.last.y}%"></span>`;
      }
    }

    // Objectif : barre de progression, « 82 % de l'objectif », l'objectif lui-même ; couleur selon les seuils de la tuile.
    const goalEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-goal`);
    if (goalEl) {
      const prog = hasTarget ? targetProgress(value, targetValue, tile.goodPct, tile.warnPct) : null;
      if (!prog) {
        goalEl.hidden = true;
      } else {
        goalEl.hidden = false;
        const pctText = kpiFmt.percent(prog.pct);
        const bar = goalEl.querySelector('.goal-bar');
        const fill = goalEl.querySelector('.goal-fill');
        fill.style.width = `${Math.round(prog.fill * 1000) / 10}%`;
        fill.className = `goal-fill goal-${prog.level}`;
        bar.setAttribute('aria-valuenow', String(Math.round(prog.pct)));
        bar.setAttribute('aria-label', t('chart.kpi.goalPct', { pct: pctText }));
        goalEl.querySelector('.goal-pct').textContent = t('chart.kpi.goalPct', { pct: pctText });
        goalEl.querySelector('.goal-target').textContent = t('chart.kpi.goalTarget', { target: kpiFmt.format(finiteTarget(targetValue)) });
      }
    }
  }

  function finiteTarget(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Tuile « Progression » : une barre par catégorie, remplie à hauteur de son % d'objectif (objectif commun saisi, ou
  // colonne d'objectifs agrégée PAR catégorie). Cliquable comme une barre de graphique : filtre les autres tuiles sur la
  // catégorie (re-clic = retire), les autres lignes s'estompent. Pas de drill-down, pas de tri : l'ordre des données.
  // HTML/CSS maison dans `.tile-chart` (comme la table plate), reconstruit seulement s'il change.
  async function renderProgress(tile, rows, state, container) {
    const seq = bumpSeq(tile.id);
    const [valueGroups, targetGroups] = await Promise.all([
      computeGroupBy(rows, tile.dimension, tile.measure, tile.aggFn),
      tile.targetColumn ? computeGroupBy(rows, tile.dimension, tile.targetColumn, tile.aggFn) : Promise.resolve(null)
    ]);
    if (isStale(tile.id, seq)) return;
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const list = progressRows(valueGroups, targetGroups, tile.target, tile.goodPct, tile.warnPct);
    const f = fmtFor(tile, tile.measure);
    const filter = state.activeFilters.find((af) => af.column === tile.dimension);
    const good = finiteTarget(tile.goodPct) != null ? Number(tile.goodPct) : GristBI.data.DEFAULT_GOOD_PCT;
    const warn = finiteTarget(tile.warnPct) != null ? Number(tile.warnPct) : GristBI.data.DEFAULT_WARN_PCT;
    let html;
    if (!list.length) {
      html = `<p class="pivot-empty">${escapeHtml(t('chart.progress.empty'))}</p>`;
    } else {
      const rowsHtml = list.map((r) => {
        const key = String(r.key);
        const active = filter && filterSelects(filter, key);
        const dimmed = filter && !active;
        const pctText = r.pct == null ? '–' : f.percent(r.pct);
        const title = r.target == null ? `${key} : ${f.format(r.value) || '–'}`
          : t('chart.progress.row', { label: key, value: f.format(r.value) || '–', target: f.format(r.target) || '–' });
        return `<div class="prog-row${active ? ' prog-active' : ''}${dimmed ? ' prog-dimmed' : ''}" role="button" tabindex="0" data-value="${escapeHtml(key)}" title="${escapeHtml(title)}">`
          + `<span class="prog-label">${escapeHtml(key)}</span>`
          + `<span class="prog-track"><span class="prog-fill ${r.level ? 'goal-' + r.level : ''}" style="width:${Math.round(r.fill * 1000) / 10}%"></span></span>`
          + `<span class="prog-pct">${escapeHtml(pctText)}</span></div>`;
      }).join('');
      const legend = t('chart.progress.legend', { good: String(good), warn: String(warn) });
      html = `<div class="prog-list">${rowsHtml}</div><p class="prog-legend">${escapeHtml(legend)}</p>`;
    }
    if (el.dataset.html !== html) {
      const scroll = el.scrollTop;
      el.innerHTML = html;
      el.dataset.html = html;
      el.scrollTop = scroll;
    }
    if (el.dataset.bound !== '1') {
      el.dataset.bound = '1';
      const pick = (target) => {
        const row = target.closest && target.closest('.prog-row');
        const live = liveTile(tile.id);
        if (!row || !live || !el.contains(row)) return;
        GristBI.store.toggleFilter(live.dimension, row.dataset.value, live.id);
      };
      el.addEventListener('click', (e) => pick(e.target));
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!(e.target.classList && e.target.classList.contains('prog-row'))) return;
        e.preventDefault();
        pick(e.target);
      });
    }
  }

  // Une jauge est sémantiquement proche d'une carte KPI (une seule valeur agrégée, pas de
  // dimension) : réutilise aggregateSingle telle quelle. Rendue via ECharts (contrairement à la
  // carte KPI, en texte pur) pour l'aiguille/le cadran, donc utilise .tile-chart comme bar/pie.
  // Pas de dimension -> pas de gestionnaire de clic (rien à filtrer/détailler par segment).
  async function renderGauge(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      el.textContent = t('chart.unavailable');
      return;
    }
    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
    }
    const seq = bumpSeq(tile.id);
    const usingDuckDb = rows.length >= DUCKDB_ROW_THRESHOLD;
    if (usingDuckDb) instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });
    const value = await computeAggregateSingle(rows, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq) || instance.isDisposed()) return;
    // Inconditionnel (pas `if (usingDuckDb)`) : CE rendu-ci peut être sous le seuil (donc ne pas
    // avoir affiché son propre masque) alors qu'un rendu précédent pour CETTE MÊME tuile, lui
    // au-dessus du seuil, l'avait affiché puis a été invalidé par ce rendu-ci avant d'atteindre son
    // propre hideLoading() (voir isStale ci-dessus) — sans cet appel inconditionnel, un filtre qui
    // fait repasser une tuile sous le seuil pendant qu'un calcul DuckDB est encore en vol pour elle
    // laisserait le masque de chargement bloqué indéfiniment sur un graphique pourtant à jour.
    // hideLoading() est documenté comme sans effet si aucun masque n'est affiché.
    instance.hideLoading();
    const gaugeFmt = fmtFor(tile, tile.measure);
    const min = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    // Sans borne haute (tuile importée) : un « beau » nombre au-dessus de la valeur, pas 1,5 x la valeur (« 4 118 723 »).
    const shown = Number.isFinite(Number(value)) ? Number(value) : 0;
    const max = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : GristBI.format.niceCeil(Math.max(shown * 1.2, 1));
    // La jauge se redessine à la taille de SA zone (demi-cercle, voir GristBI.format.gaugeLayout) : à chaque rendu
    // et à chaque redimensionnement (resizeAll appelle `__refit`, ECharts ne sait pas refaire une géométrie en px).
    const draw = () => instance.setOption(gaugeOption(tile, { value: shown, hasValue: value != null, min, max, fmt: gaugeFmt, w: instance.getWidth(), h: instance.getHeight() }), true);
    draw();
    instance.__refit = draw;
  }

  // Texte d'un canvas hors écran pour MESURER une chaîne (ajustement de la valeur centrale de la jauge).
  let _measureCtx = null;
  function measureText(text, size, weight, family) {
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = `${weight} ${size}px ${family}`;
    return _measureCtx.measureText(text).width;
  }

  // Option ECharts d'une jauge en demi-cercle. Éléments : arc de fond + arc de progression arrondi, aiguille fine
  // (elle ne dépasse pas 74 % du rayon, donc jamais sur l'anneau) et moyeu, bornes min/max en `graphic` sous les
  // extrémités de l'arc, valeur sous le moyeu, police réduite jusqu'à ce qu'elle tienne, sinon compacte (« 5,43 Bn »
  // plutôt qu'un nombre coupé). Graduations intermédiaires : À L'EXTÉRIEUR de l'arc (un trait, puis le libellé),
  // jamais dedans — dans l'arc elles se chevauchaient entre elles et avec l'aiguille (« 825,5 k » sur « 1,7 M ») ; leur
  // place est réservée avant de dimensionner l'arc (`GristBI.format.gaugeLayout(w, h, ticks)`), qui rétrécit un peu,
  // et elles disparaissent d'abord (moins, puis aucune) plutôt que de faire trop rétrécir l'arc ou de sortir de la tuile.
  function gaugeOption(tile, g) {
    const th = chartTheme();
    const F = GristBI.format;
    const family = th.font;
    const bound = (v) => g.fmt.axis(v);
    // Graduations : le plus grand nombre que la place permet, des valeurs rondes (1 M, 2 M, 3 M).
    const base = F.gaugeLayout(g.w, g.h);
    let L = base;
    let ticks = [];
    for (let n = F.gaugeTickBudget(base.r); n >= 1 && !ticks.length; n--) {
      const items = F.gaugeTicks(g.min, g.max, n).map((v) => ({ text: bound(v), frac: (v - g.min) / (g.max - g.min) }));
      if (!items.length) continue;
      const lay = F.gaugeLayout(g.w, g.h, items.map((it) => ({ frac: it.frac, w10: measureText(it.text, 10, 400, family) })));
      if (!lay.overflow && lay.r >= Math.max(44, 0.72 * base.r)) {
        L = lay;
        ticks = items;
      }
    }
    let text = g.hasValue ? (g.fmt.format(g.value) || '–') : '–';
    let fs = F.fitFont(text, L.valueMaxWidth, L.valueMaxFont, L.valueMinFont, (s, px) => measureText(s, px, 700, family));
    if (fs <= L.valueMinFont && measureText(text, fs, 700, family) > L.valueMaxWidth) {
      text = g.fmt.axis(g.value) || text;
      fs = F.fitFont(text, L.valueMaxWidth, L.valueMaxFont, L.valueMinFont, (s, px) => measureText(s, px, 700, family));
    }
    const endX = L.r - L.ringW / 2;
    const labelY = L.ringW / 2 + 4; // sous le bout arrondi de l'arc, qui dépasse de la moitié de son épaisseur
    const labelStyle = { fill: th.muted, font: `${L.labelFont}px ${family}`, textAlign: 'center', textVerticalAlign: 'top' };
    const tickElements = [];
    for (const it of ticks) {
      const P = F.gaugeTickPlacement(L, it.frac);
      tickElements.push({ type: 'line', silent: true, shape: { x1: P.x1, y1: P.y1, x2: P.x2, y2: P.y2 }, style: { stroke: th.muted, lineWidth: 1 } });
      tickElements.push({ type: 'text', silent: true, x: P.x, y: P.y, style: { text: it.text, fill: th.muted, font: `${L.tick.font}px ${family}`, textAlign: P.align, textVerticalAlign: P.valign } });
    }
    return {
      series: [{
        type: 'gauge',
        min: g.min,
        max: g.max,
        startAngle: 180,
        endAngle: 0,
        center: [L.cx, L.cy],
        radius: L.r,
        itemStyle: { color: paletteColors(tile.palette)[0] },
        progress: { show: true, width: L.ringW, roundCap: true },
        axisLine: { roundCap: true, lineStyle: { width: L.ringW, color: [[1, th.track]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: true, length: '74%', width: clamp(L.r * 0.04, 3, 8), itemStyle: { color: th.text } },
        anchor: { show: true, showAbove: true, size: clamp(L.r * 0.09, 7, 16), itemStyle: { color: th.text } },
        title: { show: false },
        detail: {
          valueAnimation: false,
          formatter: () => text,
          fontSize: fs,
          fontWeight: 700,
          fontFamily: family,
          color: th.text,
          offsetCenter: [0, 12 + fs * 0.62]
        },
        data: [{ value: g.value }]
      }],
      graphic: {
        elements: [
          { type: 'text', silent: true, x: L.cx - endX, y: L.cy + labelY, style: Object.assign({ text: bound(g.min) }, labelStyle) },
          { type: 'text', silent: true, x: L.cx + endX, y: L.cy + labelY, style: Object.assign({ text: bound(g.max) }, labelStyle) }
        ].concat(tickElements)
      }
    };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Couleurs lues sur les jetons CSS de la page (clair/sombre, ambiance GFS) : ECharts ne les lit pas tout seul, il
  // dessine en gris foncé sur n'importe quel fond. Relues à chaque rendu : un changement de thème est repris au
  // prochain rendu sans rien recréer.
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function chartTheme() {
    let font = 'sans-serif';
    try { font = getComputedStyle(document.body).fontFamily || font; } catch (e) { /* hors navigateur */ }
    return {
      text: cssVar('--text', '#0b0b0b'),
      secondary: cssVar('--text-secondary', '#52514e'),
      muted: cssVar('--text-muted', '#6b6a64'),
      surface: cssVar('--surface', '#fcfcfb'),
      line: cssVar('--border-strong', '#e1e0d9'), // cadre de l'infobulle
      grid: cssVar('--border', 'rgba(11, 11, 11, 0.10)'), // quadrillage, discret sur fond clair comme sombre
      track: 'rgba(128, 128, 128, 0.22)', // visible sur fond clair comme sombre
      font
    };
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

  // Clic sur une case de la carte de chaleur : filtre de la ligne ET de la colonne (js/data.js:cellFilterToggles décide lesquels).
  function toggleCellFilters(tile, rowValue, colValue) {
    cellFilterToggles(GristBI.store.getState().activeFilters, tile.dimension, rowValue, tile.columnDimension, colValue)
      .forEach((c) => GristBI.store.toggleFilter(c.column, c.value, tile.id));
  }

  // Instance ECharts partagée par renderChart/renderMeasureChart pour une même tuile : une tuile
  // peut passer de l'un à l'autre au fil des éditions (mode mesure activé/désactivé), il ne faut
  // donc PAS que le gestionnaire de clic ne soit attaché que par un seul des deux chemins de rendu
  // — sinon une tuile d'abord créée en mode mesure, puis éditée pour repasser en "Brut", garderait
  // une instance déjà en cache sans aucun clic câblé (le `if (!instance...)` de création ne se
  // redéclencherait jamais).
  function getOrCreateChartInstance(tileId, el) {
    let instance = chartInstances.get(tileId);
    if (instance && !instance.isDisposed()) return instance;
    instance = echarts.init(el);
    chartInstances.set(tileId, instance);
    instance.on('click', (params) => handleTileClick(tileId, params.name, params));
    return instance;
  }

  // === Nuage de mots (d3-cloud) ==============================================================
  // Choix du 03/11/2026 (remplace echarts-wordcloud, écarté par Antoine pour défaut de maintenance
  // — dépôt amont sans commit de code depuis fin 2022, voir GFS-ETAT.md et HYPOTHESES.md) :
  // d3-cloud 2.0.0, réécrit le 30/10/2026, zéro dépendance, publié avec tests + types + guide de
  // migration. Contrepartie assumée : d3-cloud ne fait QUE le calcul de placement des mots (voir
  // son README, "your application renders the results with canvas, SVG, or another renderer") —
  // ni rendu ni détection de clic/survol intégrés, contrairement à echarts-wordcloud qui les aurait
  // obtenus gratuitement d'ECharts. Ce widget dessine donc lui-même sur un <canvas> dédié
  // (getOrCreateWordCloudCanvas) et fait sa propre détection de clic/survol (hitTestWordCloud) —
  // bien plus de code que les autres types de tuile, qui délèguent tout cela à ECharts.
  //
  // Chargement paresseux via import() dynamique d'un spécificateur NU ("d3-cloud"), résolu par
  // l'`importmap` d'index.html (voir js/vendor/apache-arrow, flatbuffers, tslib pour le même
  // mécanisme) — absent de cet importmap tant que GFS n'a pas ajouté la bibliothèque (voir
  // GFS-ETAT.md "Demandes à GFS", protocole du 03/11/2026 : plus aucune lib chargée en dur par
  // l'app elle-même). Sans entrée dans l'importmap, le navigateur rejette IMMÉDIATEMENT cet
  // import() (spécificateur non résolu) — aucune requête réseau, donc rien à voir avec le piège
  // silencieux `typeof echarts === 'undefined'` (CLAUDE.md §7 n°4) : ici l'échec est explicite
  // (promesse rejetée), juste intercepté pour afficher le même message qu'avant plutôt que de
  // laisser une exception non gérée remonter jusqu'au rendu de la tuile.
  let _d3CloudPromise = null;
  function loadD3Cloud() {
    if (!_d3CloudPromise) {
      _d3CloudPromise = import('d3-cloud').catch((e) => {
        console.warn('[GristBI] d3-cloud indisponible (bibliothèque pas encore fournie par GFS)', e);
        return null;
      });
    }
    return _d3CloudPromise;
  }

  // La bibliothèque est-elle déclarée dans l'`importmap` d'index.html ? Réponse immédiate, sans rien charger : sert à ne pas proposer
  // le type « Nuage de mots » dans « Ajouter une visualisation » tant que GFS n'a pas fourni d3-cloud (une tuile qui n'afficherait
  // que « indisponible » n'a pas sa place dans une version publiée). Une tuile Nuage de mots déjà enregistrée garde son message.
  function isWordCloudAvailable() {
    const el = typeof document !== 'undefined' ? document.querySelector('script[type="importmap"]') : null;
    return Boolean(el && GristBI.data.importMapHas(el.textContent, 'd3-cloud'));
  }

  // Même plage que l'ancien `sizeRange: [14, 48]` d'echarts-wordcloud.
  function wordCloudSizeFor(value, minV, maxV) {
    if (maxV === minV) return 28; // toutes les valeurs égales : taille médiane plutôt qu'une
      // division par zéro
    return 14 + ((value - minV) / (maxV - minV)) * (48 - 14);
  }

  // Même esprit que l'ancien `rotationRange: [-45, 45]` / `rotationStep: 15`, mais assignée par
  // index plutôt qu'aléatoirement : un mot garde le même angle à chaque re-rendu (filtre, resize),
  // pas de scintillement visuel — même principe déjà appliqué à la couleur par index ci-dessous.
  const WORD_CLOUD_ROTATIONS = [-45, -30, -15, 0, 15, 30, 45];
  const WORD_CLOUD_FONT = 'sans-serif'; // police système, pas de police tierce (Manrope refusée
    // par Antoine le 29/09/2026, CLAUDE.md §8 — vaut pour tout le chrome ET les graphiques)

  // Calcule le placement des mots via d3-cloud (bibliothèque de LAYOUT seule, voir plus haut) :
  // les plus grands d'abord pour que `place()` remplisse mieux l'espace (recommandation de son
  // README), un sprite préparé puis placé par mot (API par classe de d3-cloud 2.x — voir son
  // MIGRATING.md pour la différence avec l'ancienne API événementielle 1.x). `dim` reproduit
  // exactement l'estompage de filtre croisé des autres types de tuile (voir renderChart) :
  // inchangé depuis la version ECharts de ce code, y compris pour le mode découpage (un filtre
  // posé sur CETTE colonne depuis une AUTRE tuile ne correspondra jamais à un mot découpé via
  // `sameValue`, donc tout le nuage s'estompe uniformément dans ce cas précis — déjà le
  // comportement de la version fusionnée dans la PR #38, pas un changement introduit ici).
  function placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight, palette) {
    const values = wordCloudAgg.map((d) => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const layout = new CloudLayout().size([cssWidth, cssHeight]).overflow(false);
    const measureCtx = document.createElement('canvas').getContext('2d');
    const sorted = wordCloudAgg.slice().sort((a, b) => b.value - a.value);
    const placed = [];
    sorted.forEach((d, i) => {
      const size = wordCloudSizeFor(d.value, minV, maxV);
      const rotate = WORD_CLOUD_ROTATIONS[i % WORD_CLOUD_ROTATIONS.length];
      const sprite = layout.getSprite(String(d.dimension), { size, font: WORD_CLOUD_FONT, padding: 2, rotate });
      if (!sprite) return; // taille <1px : ne devrait jamais arriver (un comptage vaut toujours
        // au moins 1, voir wordFrequency/groupByAggregate), repli silencieux par cohérence
      const word = layout.place(sprite);
      if (!word) return; // n'a pas pu être placé dans l'espace disponible (trop de mots/trop
        // grands pour cette tuile) : nuage incomplet plutôt qu'une erreur JS, même esprit que le
        // message "chart.wordCloudUnavailable" plus bas
      const style = dim(d.dimension);
      measureCtx.font = `${word.size}px ${WORD_CLOUD_FONT}`;
      placed.push({
        text: word.text,
        value: d.value,
        x: word.x,
        y: word.y,
        rotate: word.rotate,
        size: word.size,
        width: measureCtx.measureText(word.text).width,
        color: palette[i % palette.length],
        opacity: style ? style.opacity : 1
      });
    });
    return placed;
  }

  // Dessine les mots déjà placés (coordonnées centrées sur [0,0], voir le README de d3-cloud,
  // section "Rendering Placed Words") sur un canvas dimensionné en pixels CSS × devicePixelRatio
  // (texte net sur les écrans à forte densité — même raison que `pixelRatio: 2` passé à
  // `instance.getDataURL` pour les exports PDF/PPTX des autres types de tuile, voir plus bas).
  function drawWordCloud(canvas, placedWords, cssWidth, cssHeight) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    canvas.height = Math.max(1, Math.round(cssHeight * ratio));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Fond blanc explicite : cohérent avec le fond des autres tuiles ET nécessaire pour un export
    // PNG lisible (canvas.toDataURL ne compose pas sur un fond — un PNG transparent serait illisible
    // sur fond sombre dans certains lecteurs/diapositives, contrairement à l'ancien
    // `backgroundColor: '#ffffff'` passé à ECharts pour les autres types de tuile).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    placedWords.forEach((w) => {
      ctx.save();
      ctx.globalAlpha = w.opacity;
      ctx.translate(cssWidth / 2 + w.x, cssHeight / 2 + w.y);
      ctx.rotate((w.rotate * Math.PI) / 180);
      ctx.font = `${w.size}px ${WORD_CLOUD_FONT}`;
      ctx.fillStyle = w.color;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
    });
  }

  // Détection de clic/survol : inverse exactement la transformation appliquée au dessin (translation
  // au centre du mot puis rotation) pour ramener le point cliqué dans le repère LOCAL, non tourné,
  // du mot — où sa boîte englobante (largeur mesurée au placement, hauteur approximée depuis la
  // ligne de base comme une ascendante/descendante de police classique) est un simple rectangle
  // aligné aux axes. Approximatif par nature (pas le contour exact du glyphe, comme la détection de
  // clic native d'echarts-wordcloud ne l'était pas non plus) : suffisant pour un clic/survol, pas
  // pour un rendu.
  function hitTestWordCloud(placedWords, x, y) {
    const rad = Math.PI / 180;
    for (let i = placedWords.length - 1; i >= 0; i -= 1) {
      const w = placedWords[i];
      const dx = x - w.x;
      const dy = y - w.y;
      const angle = -w.rotate * rad;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (localX >= -w.width / 2 && localX <= w.width / 2 && localY >= -w.size * 0.8 && localY <= w.size * 0.3) {
        return w;
      }
    }
    return null;
  }

  // Crée (ou réutilise) le <canvas> dédié au nuage de mots d'une tuile. Objet adapté au même
  // contrat minimal qu'une instance ECharts partout ailleurs dans ce fichier
  // (isDisposed/dispose/resize/getDataURL, voir resizeAll/disposeTile/js/pdf-export.js/
  // js/pptx-export.js) et mis en cache dans la MÊME Map (`chartInstances`, marquée
  // `isWordCloudCanvas`) : aucun de ces appelants n'a besoin de savoir qu'il ne s'agit pas d'ECharts
  // pour cette tuile précise.
  function getOrCreateWordCloudCanvas(tileId, el) {
    const existing = chartInstances.get(tileId);
    if (existing && existing.isWordCloudCanvas && !existing.isDisposed()) return existing;
    // Une instance ECharts peut être restée en cache pour cette tuile si son type vient de changer
    // (un autre type -> nuage de mots) : jamais mélanger les deux mondes (voir le symétrique dans
    // renderChart pour le sens inverse).
    if (existing && !existing.isDisposed()) existing.dispose();
    el.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'tile-wordcloud-canvas';
    el.appendChild(canvas);
    let disposed = false;
    let placedWords = [];
    let isSplit = false;

    function hitAt(evt) {
      const rect = canvas.getBoundingClientRect();
      return hitTestWordCloud(placedWords, evt.clientX - rect.left - rect.width / 2, evt.clientY - rect.top - rect.height / 2);
    }

    canvas.addEventListener('mousemove', (evt) => {
      const hit = hitAt(evt);
      const live = liveTile(tileId);
      canvas.title = hit ? `${hit.text} (${fmtFor(live || {}, live && live.measure).format(hit.value)})` : '';
      canvas.style.cursor = hit && !isSplit ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', (evt) => {
      if (isSplit) return; // voir handleTileClick : un mot découpé ne correspond à aucune valeur
        // de colonne exacte, rien de cohérent à filtrer/driller
      const hit = hitAt(evt);
      if (hit) handleTileClick(tileId, hit.text);
    });

    const instance = {
      isWordCloudCanvas: true,
      isDisposed: () => disposed,
      dispose() { disposed = true; canvas.remove(); },
      resize() {
        // Redessine à la taille ACTUELLE du conteneur à partir du placement déjà calculé, sans
        // relancer tout le layout d3-cloud à chaque redimensionnement continu de fenêtre (déjà
        // debounced côté main.js) : un léger décalage du placement par rapport à la nouvelle taille
        // est accepté (POC) — le prochain rendu complet (filtre, drill-down...) recalculera de toute
        // façon le placement pour la taille alors en vigueur.
        if (!placedWords.length) return;
        drawWordCloud(canvas, placedWords, el.clientWidth || 1, el.clientHeight || 1);
      },
      getDataURL() { return canvas.toDataURL('image/png'); }, // voir js/pdf-export.js/js/pptx-export.js
      showUnavailable(message) {
        placedWords = [];
        // Le <canvas> (300 x 150 par défaut) poussait le message sous le bas de la tuile : tuile vide, sans explication.
        canvas.style.display = 'none';
        const old = el.querySelector('.tile-wordcloud-message');
        if (old) old.remove();
        const msg = document.createElement('p');
        msg.className = 'tile-wordcloud-message';
        msg.textContent = message;
        el.appendChild(msg);
      },
      render(words, cssWidth, cssHeight, split) {
        canvas.style.display = '';
        const old = el.querySelector('.tile-wordcloud-message');
        if (old) old.remove();
        placedWords = words;
        isSplit = split;
        drawWordCloud(canvas, words, cssWidth, cssHeight);
      }
    };
    chartInstances.set(tileId, instance);
    return instance;
  }

  // Point d'entrée du rendu "Nuage de mots" (voir renderChart, qui y redirige avant toute logique
  // ECharts). Reprend les deux modes existants (tile.wordCloudSplit, voir js/data.js:
  // wordFrequency) à l'identique de la version ECharts fusionnée dans la PR #38 : le mode
  // "découpage de cellule" reste pur JS quel que soit le volume de lignes (même raisonnement que le
  // data blending, `blendRows` — voir ROADMAP.md : "n'en dépend toujours pas").
  async function renderWordCloud(tile, rows, state, el) {
    const seq = bumpSeq(tile.id);
    const instance = getOrCreateWordCloudCanvas(tile.id, el);
    const dimension = tile.dimension;
    const isSplit = !!tile.wordCloudSplit;
    const wordCloudAgg = isSplit ? wordFrequency(rows, dimension, true) : await computeGroupBy(rows, dimension, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps

    const mod = await loadD3Cloud();
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé pendant le chargement de la lib
    if (!mod) {
      instance.showUnavailable(t('chart.wordCloudUnavailable'));
      return;
    }
    const CloudLayout = mod.default || mod.CloudLayout;

    if (!wordCloudAgg.length) {
      instance.render([], el.clientWidth || 1, el.clientHeight || 1, isSplit);
      return;
    }

    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    const dim = (d) => (activeOnThisDimension && !filterSelects(activeOnThisDimension, d) ? { opacity: 0.3 } : undefined);

    const cssWidth = el.clientWidth || 1;
    const cssHeight = el.clientHeight || 1;
    const placedWords = placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight, paletteColors(tile.palette));
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps
    instance.render(placedWords, cssWidth, cssHeight, isSplit);
  }
  // ============================================================================================

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
  async function renderPivot(tile, rows, state, container) {
    const seq = bumpSeq(tile.id);
    const pivot = await computePivot(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq)) return; // rendu plus récent pour cette tuile entre-temps
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (!pivot.rowKeys.length || !pivot.colKeys.length) {
      el.innerHTML = '<p class="pivot-empty">Aucune donnée à afficher.</p>';
      return;
    }
    const rowFilter = state.activeFilters.find((f) => f.column === tile.dimension);
    const colFilter = state.activeFilters.find((f) => f.column === tile.columnDimension);
    const pivotFmt = fmtFor(tile, tile.measure);
    const fmt = (v) => (v == null ? '–' : escapeHtml(String(pivotFmt.format(v))));

    const headCells = pivot.colKeys.map((ck) => {
      const active = colFilter && filterSelects(colFilter, ck);
      const dimmed = colFilter && !active;
      const cls = `pivot-col-header${active ? ' pivot-active' : ''}${dimmed ? ' pivot-dimmed' : ''}`;
      return `<th class="${cls}" data-axis="col" data-value="${escapeHtml(String(ck))}">${escapeHtml(String(ck))}</th>`;
    }).join('');

    // Tableau croisé coloré (`tile.pivotHeat`) : fond de chaque cellule de données d'un dégradé séquentiel (js/data.js:heatCellColors),
    // texte blanc ou noir selon le contraste ; le nombre reste écrit, la couleur n'est jamais seule. Totaux jamais colorés
    // (une somme de ligne écraserait l'échelle des cellules). Couleurs CALCULÉES (hex), jamais une chaîne de la configuration.
    const heat = tile.pivotHeat ? heatCellColors(pivot.cells, heatStops(tile.palette)) : null;
    const heatStyle = (ri, ci) => {
      const c = heat && heat[ri] && heat[ri][ci];
      return c ? ` style="background:${c.bg};color:${c.fg}"` : '';
    };
    const bodyRows = pivot.rowKeys.map((rk, ri) => {
      const rowActive = rowFilter && filterSelects(rowFilter, rk);
      const rowDimmed = rowFilter && !rowActive;
      const rowHeaderCls = `pivot-row-header${rowActive ? ' pivot-active' : ''}${rowDimmed ? ' pivot-dimmed' : ''}`;
      const cells = pivot.cells[ri].map((v, ci) => {
        const ck = pivot.colKeys[ci];
        const colActive = colFilter && filterSelects(colFilter, ck);
        const colDimmed = colFilter && !colActive;
        const cellActive = rowActive && colActive;
        const cellDimmed = !cellActive && (rowDimmed || colDimmed);
        const cls = `pivot-cell${cellActive ? ' pivot-active' : ''}${cellDimmed ? ' pivot-dimmed' : ''}${v == null ? ' pivot-cell-empty' : ''}`;
        return `<td class="${cls}" data-axis="cell" data-row="${escapeHtml(String(rk))}" data-col="${escapeHtml(String(ck))}"${heatStyle(ri, ci)}>${fmt(v)}</td>`;
      }).join('');
      return `<tr>
        <th class="${rowHeaderCls}" data-axis="row" data-value="${escapeHtml(String(rk))}">${escapeHtml(String(rk))}</th>
        ${cells}
        <td class="pivot-cell pivot-total-cell">${fmt(pivot.rowTotals[ri])}</td>
      </tr>`;
    }).join('');

    const totalLabel = escapeHtml(t('chart.pivot.total'));
    const totalRow = `<tr class="pivot-total-row">
      <th class="pivot-row-header pivot-total-label">${totalLabel}</th>
      ${pivot.colTotals.map((v) => `<td class="pivot-cell pivot-total-cell">${fmt(v)}</td>`).join('')}
      <td class="pivot-cell pivot-total-cell pivot-grand-total">${fmt(pivot.grandTotal)}</td>
    </tr>`;

    el.innerHTML = `<table class="pivot-table${heat ? ' pivot-heat' : ''}">
      <thead><tr><th class="pivot-corner"></th>${headCells}<th class="pivot-col-header pivot-total-label">${totalLabel}</th></tr></thead>
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
    if (tile.type === 'heatmap') {
      return renderHeatmap(tile, rows, state, instance);
    }
    // Formateur de la mesure (axe Y, infobulles, étiquettes) ; nuage de points : l'axe X porte `measure`,
    // l'axe Y `measureY`, chacun avec le format de SA colonne.
    const f = fmtFor(tile, tile.measure);
    const fY = tile.type === 'scatter' ? fmtFor(tile, tile.measureY) : f;
    // Valeur d'infobulle : une valeur absente (combinaison sans donnée) s'affiche « – », jamais vide.
    const tipValue = (v) => (f.format(v) || '–');

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
    const [agg, aggY, radarColumnValues, radarEntityColumnValues, radarEntityAgg, seriesGroups] = await Promise.all([
      isRadarColumns ? Promise.resolve(null) : computeGroupBy(rows, dimension, tile.measure, tile.aggFn),
      tile.type === 'scatter' ? computeGroupBy(rows, dimension, tile.measureY, tile.aggFn)
        // Combo : la 2e mesure (courbe) a son propre agrégat ; en Pareto la courbe se déduit des barres.
        : (tile.type === 'combo' && comboModeOf(tile) === 'measure') ? computeGroupBy(rows, dimension, tile.measureY, tile.aggFnY || tile.aggFn)
          : Promise.resolve(null),
      isRadarColumns ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(rows, col, 'avg'))) : Promise.resolve(null),
      (isRadarColumns && hasRadarEntity) ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(radarEntityRows, col, 'avg'))) : Promise.resolve(null),
      (!isRadarColumns && tile.type === 'radar' && hasRadarEntity) ? computeGroupBy(radarEntityRows, dimension, tile.measure, tile.aggFn) : Promise.resolve(null),
      hasSeries ? computeSeriesGroups(rows, dimension, tile.seriesColumn, tile.measure, tile.aggFn) : Promise.resolve(null)
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
          return `${p.marker}${escapeHtml(String(p.seriesName))} : ${Number.isFinite(v) ? f.format(v) : '–'}`;
        });
        const head = escapeHtml(String(list[0].axisValueLabel != null ? list[0].axisValueLabel : list[0].name));
        return `${head}<br/>${lines.join('<br/>')}<br/><b>${escapeHtml(t('chart.stacked.total'))} : ${f.format(total)}</b>`;
      }
    };

    // Palette choisie sur la tuile (`tile.palette`, js/data.js:PALETTES) ; `standard` sans choix.
    const palette = paletteColors(tile.palette);
    let option;
    if (tile.type === 'pie') {
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
            label: { formatter: (p) => `${p.name}\n${f.percent(p.percent)}` }
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
              ? `<br/>${escapeHtml(t('chart.funnel.ofFirst', { pct: f.percent((p.value / firstValue) * 100) }))}` : '';
            return `${escapeHtml(String(p.name))}<br/>${f.format(p.value)}${pct}`;
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
            formatter: (p) => `${p.name}\n${f.axis(p.value)}`
          },
          labelLine: { show: true, length: 12 },
          data: groups.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'scatter') {
      // Version agrégée (pas ligne-à-ligne) : un point par valeur de la dimension, ses coordonnées
      // X/Y sont les agrégats de deux mesures DIFFÉRENTES sur ce même groupe. Les deux appels à
      // computeGroupBy (ci-dessus, en parallèle) portent sur le même `rows`/`dimension`, donc le
      // même ensemble de groupes, mais on associe par NOM de dimension (Map) plutôt que par index
      // pour rester correct même si l'ordre venait à diverger un jour entre les deux appels.
      const aggYByDimension = new Map(aggY.map((d) => [d.dimension, d.value]));
      option = {
        color: palette,
        grid: numericGrid,
        tooltip: {
          trigger: 'item',
          formatter: (params) => `${escapeHtml(String(params.name))}<br/>`
            + `${escapeHtml(tile.measure)} : ${f.format(params.value[0])}<br/>`
            + `${escapeHtml(tile.measureY)} : ${fY.format(params.value[1])}`
        },
        xAxis: { type: 'value', axisLabel: { formatter: f.axis } },
        yAxis: { type: 'value', axisLabel: { formatter: fY.axis } },
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
        yAxis: { type: 'value', axisLabel: { formatter: f.axis } },
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
      const axisFmts = axisNames.map((n) => (isRadarColumns ? fmtFor(tile, n) : f));
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
      const fLine = pareto ? f : fmtFor({ ...tile, aggFn: tile.aggFnY || tile.aggFn }, tile.measureY);
      const aggLabel = (fn) => t('tileForm.agg.' + (fn || 'sum'));
      // Légende : les noms de colonnes, seuls (une tuile de 270 px ne porte pas « Montant (Somme) » + « Quantité (Somme) ») ;
      // l'agrégat n'est ajouté que si les deux séries portent la même colonne et ne se distingueraient plus.
      const sameColumn = !pareto && tile.measure === tile.measureY;
      const barName = sameColumn ? `${tile.measure} (${aggLabel(tile.aggFn)})` : String(tile.measure);
      const lineName = pareto ? t('chart.combo.cumulative') : (sameColumn ? `${tile.measureY} (${aggLabel(tile.aggFnY || tile.aggFn)})` : String(tile.measureY));
      const lineValue = (v) => (pareto ? (Number.isFinite(Number(v)) ? f.percent(Number(v)) : '–') : (fLine.format(v) || '–'));
      option = {
        color: palette,
        grid: { ...numericGrid, top: 40 },
        legend: { top: 0, type: 'scroll' },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: combo.categories },
        yAxis: [
          { type: 'value', axisLabel: { formatter: f.axis } },
          {
            type: 'value',
            position: 'right',
            splitLine: { show: false },
            axisLabel: { formatter: pareto ? (v) => f.percent(v) : fLine.axis },
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
      option = {
        color: palette,
        grid: seriesGrid,
        legend: seriesLegend,
        tooltip: stacked ? stackedTooltip : { trigger: 'axis', valueFormatter: tipValue },
        xAxis: { type: 'category', data: lineCategories },
        yAxis: { type: 'value', axisLabel: { formatter: f.axis } },
        series: lineSeries.map((sr) => ({
          type: 'line',
          name: sr.name,
          symbolSize: 8,
          // Aire empilée : bandes plus opaques (à 0,25 deux bandes voisines se confondent) ; aire
          // non empilée : les séries se recouvrent, donc très transparentes.
          ...(tile.areaFill ? { areaStyle: { opacity: stacked ? 0.65 : 0.25 } } : {}),
          ...(stacked ? { stack: 'total' } : {}),
          // Une combinaison absente vaut 0 dans une pile : ECharts empile sur la valeur de la série du
          // dessous, et un `null` y rompt la bande de TOUTES les séries au-dessus.
          data: sr.values.map((v, i) => ({ value: (stacked && v == null) ? 0 : v, itemStyle: dim(lineCategories[i]) }))
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
      const valueAxis = { type: 'value', axisLabel: { formatter: f.axis } };
      option = {
        color: palette,
        grid: seriesGrid,
        legend: seriesLegend,
        tooltip: stacked ? stackedTooltip : { trigger: 'axis', valueFormatter: tipValue },
        ...(tile.horizontal
          ? {
            xAxis: valueAxis,
            yAxis: { type: 'category', inverse: true, data: categoryLabels, axisLabel: { width: 110, overflow: 'truncate' } }
          }
          : {
            xAxis: { type: 'category', data: categoryLabels },
            yAxis: valueAxis
          }),
        series: barSeries.map((sr) => ({
          type: 'bar',
          name: sr.name,
          ...(stacked ? { stack: 'total' } : {}),
          data: sr.values.map((v, i) => ({ value: v, itemStyle: dim(categoryLabels[i]) }))
        }))
      };
    }
    finalizeOption(option, instance);
    instance.setOption(option, true);
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
    const f = fmtFor(tile, tile.measure);
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
    const data = [];
    pivot.cells.forEach((line, ri) => line.forEach((v, ci) => {
      if (!colors[ri][ci]) return; // intersection sans donnée : case vide
      const selected = (!rowFilter || filterSelects(rowFilter, pivot.rowKeys[ri])) && (!colFilter || filterSelects(colFilter, pivot.colKeys[ci]));
      data.push({
        value: [ci, ri, Number(v)],
        itemStyle: selected ? undefined : { opacity: 0.3 },
        label: labelRoom ? { show: true, color: colors[ri][ci].fg, fontSize: 10, formatter: () => f.axis(Number(v)) } : undefined
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
          return `${escapeHtml(String(pivot.rowKeys[v[1]]))} × ${escapeHtml(String(pivot.colKeys[v[0]]))}<br/>${escapeHtml(f.format(v[2]) || '–')}`;
        }
      },
      xAxis: { type: 'category', data: pivot.colKeys.map(String), splitArea: { show: false }, axisLabel: { interval: 'auto' } },
      yAxis: { type: 'category', data: pivot.rowKeys.map(String), inverse: true, splitArea: { show: false }, axisLabel: { interval: 0, width: 72, overflow: 'truncate', ellipsis: '…' } },
      visualMap: {
        type: 'continuous', min: lo, max: hi, calculable: false, orient: 'horizontal', left: 'center', bottom: 2,
        itemWidth: 8, itemHeight: Math.max(60, Math.min(170, Math.round(width * 0.5))),
        text: [f.axis(range.max), f.axis(range.min)], textGap: 6,
        inRange: { color: stops }, textStyle: { fontSize: 10 }
      },
      series: [{
        type: 'heatmap',
        data,
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
    const f = fmtFor(tile, tile.measure);
    const fCount = fmtFor({ ...tile, aggFn: 'count' }, tile.measure);
    const palette = paletteColors(tile.palette);
    const mine = state.activeFilters.find((af) => af.column === tile.measure && af.sourceTileId === tile.id);
    const bound = (v) => (f.axis(v) || String(v));
    const label = (b) => (b.lo === b.hi ? bound(b.lo) : `${bound(b.lo)} – ${bound(b.hi)}`);
    const fullLabel = (b) => (b.lo === b.hi ? (f.format(b.lo) || String(b.lo)) : `${f.format(b.lo) || b.lo} – ${f.format(b.hi) || b.hi}`);
    const option = {
      color: palette,
      grid: { ...numericGrid },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // Texte HTML : les bornes sont des nombres formatés (jamais du texte saisi), rien à échapper de plus.
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          const b = hist.bins[p.dataIndex];
          if (!b) return '';
          const share = hist.total > 0 ? ` (${f.percent((b.count * 100) / hist.total)})` : '';
          return `${escapeHtml(fullLabel(b))}<br/>${t('chart.histogram.rows', { n: fCount.format(b.count) || b.count, count: b.count })}${share}`;
        }
      },
      xAxis: { type: 'category', data: hist.bins.map(label), axisLabel: { interval: 'auto' } },
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
    if (!levels.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!drillPath.length) {
      el.innerHTML = `<span>${escapeHtml(tile.dimension)}</span>
        <span class="breadcrumb-hint">${escapeHtml(t('chart.breadcrumb.hint', { column: levels[0] }))}</span>`;
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

  // Bulle d'info toujours DANS la zone du graphique (`confine`) : sans ça, ECharts la posait à côté du
  // point survolé, donc hors de la carte — jusqu'à sortir de l'écran à gauche pour un radar (retour
  // d'Antoine du 18/11/2026).
  function confineTooltip(option) {
    if (option && option.tooltip) option.tooltip = Object.assign({ confine: true }, option.tooltip);
  }

  // Dernière étape de TOUT graphique ECharts, juste avant `setOption` (audit de lisibilité, lot 4, 18/11/2026) : le
  // thème de la page (clair/sombre/ambiance, jetons CSS) et la lisibilité des libellés. Les réglages DÉJÀ posés par un
  // type de tuile gagnent (`Object.assign(défauts, existant)`), jamais l'inverse.
  // - infobulle : fond et texte des jetons (ECharts la dessinait blanche sur fond sombre), 12 px, retour à la ligne
  //   (« Tablette Graphique Professionnelle 12 pouces » tenait sur toute la largeur de la tuile) ;
  // - axes : quadrillage et traits des jetons (ECharts les dessine en #E0E6F1 / gris foncé, blancs éclatants sur fond
  //   sombre), libellés qui se chevauchent masqués, libellés de catégorie TRONQUÉS à la largeur d'une catégorie (le 1er
  //   de « Tablette Graphique Professionnelle 12 pouces » sortait de la tuile à gauche, les autres disparaissaient),
  //   graduations de l'axe horizontal en nombre raisonnable (« 200 k400 k600 k » collés dans une barre horizontale) ;
  // - camembert/entonnoir : texte aux jetons, sans le contour blanc qu'ECharts leur met (illisible sur fond sombre) ;
  // - radar : noms d'axes, cercles et bandes des jetons (les bandes claires par défaut éclairent un fond sombre).
  function finalizeOption(option, instance) {
    if (!option) return option;
    confineTooltip(option);
    const th = chartTheme();
    const width = (instance && typeof instance.getWidth === 'function') ? instance.getWidth() : 0;
    if (option.tooltip) {
      option.tooltip = Object.assign({
        backgroundColor: th.surface,
        borderColor: th.line,
        textStyle: { color: th.text, fontSize: 12 },
        extraCssText: 'max-width: 85%; white-space: normal; overflow-wrap: anywhere;'
      }, option.tooltip);
    }
    if (option.legend) option.legend = Object.assign({}, option.legend, { textStyle: Object.assign({ color: th.secondary }, option.legend.textStyle) });
    // Légende de dégradé (carte de chaleur) : ses libellés aux jetons, sinon noirs sur fond sombre.
    if (option.visualMap && !Array.isArray(option.visualMap)) {
      option.visualMap = Object.assign({}, option.visualMap, { textStyle: Object.assign({ color: th.muted }, option.visualMap.textStyle) });
    }
    const styleAxis = (axis, isX) => {
      if (!axis) return axis;
      const one = (a) => {
        const label = Object.assign({ color: th.muted, hideOverlap: true }, a.axisLabel);
        const out = Object.assign({}, a, {
          axisLine: Object.assign({ lineStyle: { color: th.muted } }, a.axisLine),
          axisTick: Object.assign({ lineStyle: { color: th.muted } }, a.axisTick),
          splitLine: Object.assign({ lineStyle: { color: th.grid } }, a.splitLine),
          axisLabel: label
        });
        if (isX && width) {
          const plotW = Math.max(60, width - 70);
          if (a.type === 'category' && Array.isArray(a.data) && a.data.length && label.width == null) {
            // Peu de catégories : chacune garde sa place (largeur d'une catégorie moins une marge, nom tronqué par « … »,
            // aucun libellé masqué). Beaucoup de catégories : ECharts n'en montre qu'une sur k (intervalle automatique),
            // chacune avec plus de place.
            const band = Math.floor(plotW / a.data.length) - 6;
            if (a.data.length <= 8 && band >= 28) {
              label.width = Math.min(150, band);
              if (label.interval == null) label.interval = 0;
            } else {
              label.width = 70;
            }
            label.overflow = 'truncate';
            label.ellipsis = '…';
          } else if (a.type === 'value' && a.splitNumber == null) {
            out.splitNumber = Math.max(2, Math.min(6, Math.floor(plotW / 64)));
          }
        }
        return out;
      };
      return Array.isArray(axis) ? axis.map(one) : one(axis);
    };
    if (option.xAxis) option.xAxis = styleAxis(option.xAxis, true);
    if (option.yAxis) option.yAxis = styleAxis(option.yAxis, false);
    if (Array.isArray(option.series)) {
      option.series.forEach((sr, i) => {
        if (sr && (sr.type === 'pie' || sr.type === 'funnel')) {
          option.series[i] = Object.assign({}, sr, {
            label: Object.assign({ color: th.text, textBorderWidth: 0 }, sr.label),
            // Traits entre les étapes de l'entonnoir : le blanc par défaut d'ECharts éclaire un fond sombre.
            ...(sr.type === 'funnel' ? { itemStyle: Object.assign({ borderColor: th.surface, borderWidth: 1 }, sr.itemStyle) } : {})
          });
        }
      });
    }
    if (option.radar) {
      // Avec une légende, le polygone se place dans la place qu'elle laisse (centre et rayon en PIXELS, comme la jauge : ils ne
      // suivent donc pas un redimensionnement, `__refit` les recalcule — voir resizeAll). Sans légende : réglage d'origine (62 %).
      const placeRadar = () => {
        const h = instance.getHeight();
        const w = instance.getWidth();
        if (!w || !h) return null;
        const L = GristBI.format.radarLayout(w, h, true);
        return { center: [L.cx, L.cy], radius: L.r, axisNameGap: L.gap };
      };
      const placed = (instance && option.legend && typeof instance.getHeight === 'function') ? placeRadar() : null;
      if (instance) {
        instance.__refit = placed ? () => { const p = placeRadar(); if (p) instance.setOption({ radar: p }); } : undefined;
      }
      option.radar = Object.assign({}, option.radar, placed || {}, {
        // Noms d'axe tronqués à un tiers de la tuile (`overflow` n'agit pas sur les noms d'axe d'un radar : on coupe nous-mêmes) :
        // « Station d'accueil USB-C » sortait de la carte à droite.
        axisName: Object.assign({
          color: th.muted,
          formatter: (name) => {
            const max = Math.max(8, Math.floor((width || 330) * 0.34 / 6.8));
            const text = String(name == null ? '' : name);
            return text.length > max ? `${text.slice(0, max - 1)}…` : text;
          }
        }, option.radar.axisName),
        axisLine: Object.assign({ lineStyle: { color: th.grid } }, option.radar.axisLine),
        splitLine: Object.assign({ lineStyle: { color: th.grid } }, option.radar.splitLine),
        splitArea: Object.assign({ show: false }, option.radar.splitArea)
      });
    }
    return option;
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
    if (inst) { inst.dispose(); chartInstances.delete(tileId); }
    renderSeq.delete(tileId);
  }

  // Exposé uniquement pour dev-tests/ (calcul de coordonnées pixel précises dans le test Playwright
  // via convertToPixel) - ne pas s'appuyer dessus pour de la logique applicative.
  function getInstance(tileId) { return chartInstances.get(tileId) || null; }

  GristBI.charts = { renderTile, resizeAll, disposeTile, getInstance, isWordCloudAvailable };
})(window);
