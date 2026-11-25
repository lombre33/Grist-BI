/*
 * Suggestions des types de tuile « qui croisent ou comparent » (niveau 2c de l'intelligence des suggestions, 25/11/2026) : la carte de
 * chaleur (deux catégories croisées), le soleil (une vraie hiérarchie) et l'objectif (une progression par catégorie et un chiffre clé face à
 * sa cible). Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-types-time-grid.js).
 *
 * Même rôle et même contrat que js/advice-types.js, dont il est une partie (js/advice-types.js l'appelle ; il ne dépend ni de lui ni de
 * js/advice.js) : `candidates(rows, ctx, opts, core)`, `annotate(c, ctx, core)`, `previewFor(tileData, rows, core)`.
 *
 * AUCUN TEXTE EN DUR : clés i18n (`advice.*`, `tileTitle.*`) + variables. Un type n'est proposé que si les données ont un fait à dire :
 * une carte de chaleur seulement quand une case dépasse nettement ce que donneraient deux colonnes sans lien, un soleil seulement sur une
 * hiérarchie VRAIE (chaque valeur du dehors ne figure que sous une valeur du centre, jugé sur les valeurs), un objectif seulement quand une
 * colonne que son nom désigne comme une cible existe à côté d'une vraie mesure du même ordre de grandeur.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./advice-insights.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceTypesGrid = factory(root.GristBI.data, root.GristBI.adviceInsights);
  }
})(typeof self !== 'undefined' ? self : this, function (data, insights) {
  'use strict';

  // La carte de chaleur garde l'intention « croisement » du tableau croisé ; le soleil dit comment un total est construit ; l'objectif
  // (progression, chiffre clé avec cible) répond à « où en est-on ? ».
  const INTENT_BY_TYPE = { heatmap: 'cross', sunburst: 'structure', progress: 'goal' };
  const HANDLED = ['heatmap', 'sunburst', 'progress'];

  // Carte de chaleur : de 3 à 12 valeurs sur chaque axe (en dessous, un tableau suffit ; au-dessus, les cases ne se lisent plus) ; une case
  // qui pèse au moins 1,5 fois ce que donneraient deux colonnes sans lien et au moins 5 % du total (une petite case isolée n'est qu'un détail).
  const HEAT_MIN_AXIS = 3;
  const HEAT_MAX_AXIS = 12;
  const HEAT_MIN_LIFT = 1.5;
  const HEAT_MIN_CELL_SHARE = 0.05;
  const HEAT_MIN_V = 0.1;
  const HEAT_MAX_CANDIDATES = 2;
  // Soleil : de 2 à 8 parts au centre (la palette en a huit), jusqu'à 15 sous-valeurs au total (au-delà, des tranches trop fines), chaque
  // sous-valeur de la colonne extérieure sous UNE seule valeur du centre, au moins 3 lignes par sous-valeur (sinon l'emboîtement est un
  // hasard) et au moins 4 parts en tout.
  const SUN_MIN_PARENTS = 2;
  const SUN_MAX_PARENTS = 8;
  const SUN_MAX_PARTS = 15;
  const SUN_MIN_ROWS_PER_PART = 3;
  const SUN_MIN_PARTS = 4;
  // Objectif : une colonne dont le NOM dit une cible (objectif, target, quota…). Jamais « budget », « prévu » ni « plan » : un coût qui
  // dépasse son budget y paraîtrait « atteint », une progression dit « plus c'est haut, mieux c'est ». Indice de NOM, jamais seul : l'atteinte
  // globale (somme des valeurs / somme des cibles) doit rester plausible (de 20 % à 500 %), sinon ce n'est pas la cible de cette mesure.
  const TARGET_NAME_RE = /(^|[^a-zà-ÿ])(objectifs?|cibles?|targets?|goals?|quotas?|attendus?|expected)([^a-zà-ÿ]|$)/i;
  const TARGET_MIN_FILLED = 30;
  const TARGET_MIN_REACH = 0.2;
  const TARGET_MAX_REACH = 5;
  const PROGRESS_MIN_GROUPS = 3;
  const PROGRESS_MAX_GROUPS = 12;
  // Miniatures : lignes et colonnes d'une carte de chaleur, lignes d'une progression, parts de chaque anneau d'un soleil.
  const PREVIEW_HEAT_ROWS = 5;
  const PREVIEW_HEAT_COLS = 7;
  const PREVIEW_PROGRESS_ROWS = 5;
  const PREVIEW_RING_PARENTS = 6;
  const PREVIEW_RING_CHILDREN = 4;

  const empty = (v) => v === null || v === undefined || v === '';
  const isNumberColumn = (p) => p.kind === 'number' && !p.ordinal;
  const textGroup = (p) => p.kind === 'text' && !p.listLike && p.role !== 'reference' && p.role !== 'list';
  const additive = (m) => m.count || m.aggFn === 'sum';
  const nonNegative = (m) => m.count || (m.profile && m.profile.negatives === 0);

  // La mesure qui s'additionne (somme ou nombre de lignes) d'une carte de chaleur ou d'un soleil : jamais une moyenne, des parts
  // d'une moyenne ne forment pas un tout.
  function additiveMeasure(ctx, core) {
    const found = core.measureOptions(ctx).find((m) => additive(m) && nonNegative(m));
    if (found) return found;
    return ctx.countColumn ? { column: ctx.countColumn, aggFn: 'count', count: true, profile: null } : null;
  }

  // Un nombre court pour une phrase (même règle que js/advice-types.js).
  function short(x, ctx, core) {
    const a = Math.abs(x);
    return core.fmt(x, ctx, a >= 100 ? 0 : (a >= 10 ? 1 : 2));
  }

  // ---------------------------------------------------------------------------------------------
  // Carte de chaleur
  // ---------------------------------------------------------------------------------------------

  // Les cases d'un croisement : `{ cells: [{ row, col, value }], n }` (une valeur par paire de valeurs, comptage ou somme ; `n` = les lignes
  // qui y contribuent), sur `rowsList`.
  function crossCells(rowsList, rowColumn, colColumn, m) {
    const cells = new Map();
    let n = 0;
    rowsList.forEach((r) => {
      const a = r[rowColumn];
      const b = r[colColumn];
      if (empty(a) || empty(b)) return;
      const v = m.count ? 1 : insights.finite(r[m.column]);
      if (v === null) return;
      n++;
      const key = `${a}\u0001${b}`;
      const cell = cells.get(key);
      if (cell) cell.value += v; else cells.set(key, { row: String(a), col: String(b), value: v });
    });
    return { cells: Array.from(cells.values()), n };
  }

  // Les chiffres d'un croisement (`heatLiftStats` avec le nombre de lignes derrière), ou null.
  function crossStats(rowsList, rowColumn, colColumn, m) {
    const crossed = crossCells(rowsList, rowColumn, colColumn, m);
    return insights.heatLiftStats(crossed.cells, crossed.n);
  }

  // Une case qui ressort : la plus forte au-dessus de l'attendu, assez grosse pour compter, et pas due au hasard (khi-deux d'indépendance
  // nettement au-dessus de ce que des colonnes sans lien donnent, lien d'au moins 0,1 en V de Cramér : un lien infime sur 20 000 lignes
  // passerait le khi-deux sans rien dire de visible).
  function heatStory(stats) {
    return !!stats && stats.significant && stats.v >= HEAT_MIN_V && stats.maxLift >= HEAT_MIN_LIFT && stats.cellShare >= HEAT_MIN_CELL_SHARE;
  }

  // Quand on compte les lignes, la « colonne » de comptage n'est qu'un nom (la première colonne si aucune ne sert d'identifiant) : elle peut
  // très bien servir d'axe, jamais l'écarter (une table de deux catégories seulement n'aurait sinon qu'un axe).
  function heatmapCandidates(rows, ctx, opts, core) {
    const m = additiveMeasure(ctx, core);
    if (!m) return [];
    const axes = ctx.categories.filter((d) => textGroup(d) && d.distinct >= HEAT_MIN_AXIS && d.distinct <= HEAT_MAX_AXIS && (m.count || d.id !== m.column)).slice(0, 4);
    const found = [];
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        // Deux colonnes emboîtées (département dans région) ne se croisent pas : chaque ligne n'a qu'une case, c'est un soleil.
        if (isNested(ctx.insightRows, axes[i].id, axes[j].id) || isNested(ctx.insightRows, axes[j].id, axes[i].id)) continue;
        const stats = crossStats(ctx.insightRows, axes[i].id, axes[j].id, m);
        if (heatStory(stats)) found.push({ row: axes[i].id, col: axes[j].id, lift: stats.maxLift });
      }
    }
    found.sort((a, b) => b.lift - a.lift);
    return found.slice(0, HEAT_MAX_CANDIDATES).map((pair) => {
      const vars = { measure: m.column, dimension: pair.row, columnDimension: pair.col };
      const spec = m.count
        ? { key: 'advice.title.countByTwo', vars: { dimension: pair.row, columnDimension: pair.col }, fallback: `${pair.row} × ${pair.col}` }
        : { key: 'advice.title.byTwoDimensions', vars, fallback: `${m.column} / ${pair.row} × ${pair.col}` };
      return core.candidate({
        type: 'heatmap',
        score: 6,
        dims: [pair.row, pair.col],
        measures: [m.column],
        tileData: { type: 'heatmap', dimension: pair.row, columnDimension: pair.col, measure: m.column, aggFn: m.aggFn,
          title: core.resolveTitle(opts, spec.key, spec.vars, spec.fallback) },
        titleKey: spec.key,
        titleVars: spec.vars,
        reasonKey: 'advice.reason.heatmap',
        reasonVars: { dimension: pair.row, columnDimension: pair.col }
      });
    });
  }

  function annotateHeatmap(td, ctx, core) {
    const m = { column: td.measure, aggFn: td.aggFn, count: td.aggFn === 'count' };
    const stats = crossStats(ctx.insightRows, td.dimension, td.columnDimension, m);
    if (!stats) return null;
    return {
      facts: { rows: stats.rows, cols: stats.cols, lift: stats.maxLift, row: stats.row, col: stats.col, cellShare: stats.cellShare, v: stats.v },
      note: insights.interest.heat(stats),
      insight: { key: 'advice.insight.heatHot', vars: { row: stats.row, col: stats.col, pct: insights.percentOf(stats.cellShare), lift: core.fmt(stats.maxLift, ctx, 1) } }
    };
  }

  // Miniature : les lignes et colonnes de plus gros total (la case chaude s'y voit), chaque case de 0 à 1 sur le maximum ; case sans ligne = null.
  function previewHeatmap(td, rows, core) {
    const m = { column: td.measure, aggFn: td.aggFn, count: td.aggFn === 'count' };
    const cells = crossCells(core.sampleOf(rows), td.dimension, td.columnDimension, m).cells;
    if (!cells.length) return null;
    const totalBy = (key) => {
      const sums = new Map();
      cells.forEach((c) => sums.set(c[key], (sums.get(c[key]) || 0) + c.value));
      return Array.from(sums.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    };
    const rowNames = totalBy('row').slice(0, PREVIEW_HEAT_ROWS);
    const colNames = totalBy('col').slice(0, PREVIEW_HEAT_COLS);
    if (rowNames.length < 2 || colNames.length < 2) return null;
    const at = new Map(cells.map((c) => [`${c.row}\u0001${c.col}`, c.value]));
    const top = Math.max.apply(null, cells.map((c) => c.value));
    if (!(top > 0)) return null;
    return { kind: 'heat', rows: rowNames.map((r) => colNames.map((c) => (at.has(`${r}\u0001${c}`) ? Math.max(0, at.get(`${r}\u0001${c}`)) / top : null))) };
  }

  // ---------------------------------------------------------------------------------------------
  // Soleil
  // ---------------------------------------------------------------------------------------------

  // Chaque valeur de `child` figure-t-elle sous UNE seule valeur de `parent` (département dans région) ? Jugé sur les valeurs, jamais sur
  // le nom des colonnes ; une valeur vide n'est sous aucun parent.
  function isNested(rowsList, parent, child) {
    const owners = new Map();
    for (const r of rowsList) {
      const a = r[child];
      const b = r[parent];
      if (empty(a) || empty(b)) continue;
      const seen = owners.get(String(a));
      if (seen === undefined) owners.set(String(a), String(b));
      else if (seen !== String(b)) return false;
    }
    return owners.size > 0;
  }

  function sunburstCandidates(rows, ctx, opts, core) {
    const m = additiveMeasure(ctx, core);
    if (!m) return [];
    const small = ctx.categories.filter((d) => textGroup(d) && d.distinct >= 2 && d.distinct <= SUN_MAX_PARTS && (m.count || d.id !== m.column));
    const parents = small.filter((d) => d.distinct >= SUN_MIN_PARENTS && d.distinct <= SUN_MAX_PARENTS);
    for (const parent of parents) {
      for (const child of small) {
        if (child.id === parent.id || child.distinct < parent.distinct + 2 || child.filled / child.distinct < SUN_MIN_ROWS_PER_PART) continue;
        if (!isNested(ctx.insightRows, parent.id, child.id)) continue;
        const tree = data.sunburstTree(ctx.insightRows, [parent.id, child.id], m.column, m.aggFn);
        const stats = insights.hierarchyStats(tree.roots);
        if (!stats || stats.parts < SUN_MIN_PARTS) continue;
        const levels = `${parent.id} › ${child.id}`;
        const spec = m.count
          ? { key: 'advice.title.sunburstCount', vars: { levels }, fallback: levels }
          : { key: 'tileTitle.sunburst', vars: { measure: m.column, levels }, fallback: `${m.column} : ${levels}` };
        return [core.candidate({
          type: 'sunburst',
          score: 6,
          dims: [parent.id, child.id],
          measures: [m.column],
          tileData: { type: 'sunburst', dimension: parent.id, drillDimensions: [child.id], measure: m.column, aggFn: m.aggFn,
            title: core.resolveTitle(opts, spec.key, spec.vars, spec.fallback) },
          titleKey: spec.key,
          titleVars: spec.vars,
          reasonKey: 'advice.reason.sunburst',
          reasonVars: { dimension: parent.id, child: child.id }
        })];
      }
    }
    return [];
  }

  function annotateSunburst(td, ctx, core) {
    const levels = [td.dimension].concat(td.drillDimensions || []);
    const tree = data.sunburstTree(ctx.insightRows, levels, td.measure, td.aggFn);
    const stats = insights.hierarchyStats(tree.roots);
    if (!stats) return null;
    const facts = { parents: stats.parents, parts: stats.parts, top: stats.topName, topShare: stats.topShare, topChild: stats.topChildName, topChildShare: stats.topChildShare };
    // Un seul enfant sous la plus grosse part : « il en fait 100 % » ne dit rien de plus que la part elle-même.
    const lonely = stats.topChildShare === null || stats.topChildShare >= 0.995;
    const count = td.aggFn === 'count';
    const insight = lonely
      ? { key: count ? 'advice.insight.topShareCount' : 'advice.insight.topShare', vars: { top: stats.topName, pct: insights.percentOf(stats.topShare), measure: td.measure } }
      : { key: 'advice.insight.hierTop', vars: { top: stats.topName, pct: insights.percentOf(stats.topShare), child: stats.topChildName, pct2: insights.percentOf(stats.topChildShare) } };
    return { facts, note: insights.interest.hierarchy(stats), insight };
  }

  // Miniature : les plus grosses parts du centre et, sous chacune, leurs plus grosses sous-parts, toutes en part du total (0 à 1).
  function previewSunburst(td, rows, core) {
    const tree = data.sunburstTree(core.sampleOf(rows), [td.dimension].concat(td.drillDimensions || []), td.measure, td.aggFn || 'sum');
    const total = tree.roots.reduce((s, r) => s + (r.value > 0 ? r.value : 0), 0);
    if (!(total > 0) || tree.roots.length < 2) return null;
    const parents = tree.roots.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, PREVIEW_RING_PARENTS).map((r) => ({
      share: r.value / total,
      children: (r.children || []).filter((c) => c.value > 0).sort((a, b) => b.value - a.value).slice(0, PREVIEW_RING_CHILDREN).map((c) => c.value / total)
    }));
    return parents.length >= 2 ? { kind: 'rings', parents } : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Objectif : progression par catégorie, chiffre clé face à sa cible
  // ---------------------------------------------------------------------------------------------

  // Une colonne cible et la mesure qu'elle vise, ou null : la colonne dont le nom dit une cible (valeurs positives, assez remplie) et, parmi
  // les autres vraies mesures, celle dont l'atteinte globale (somme des valeurs / somme des cibles, ou moyennes) est plausible (de 20 % à
  // 500 %) ET la plus proche de 100 % : une colonne qui n'a rien à voir (un numéro de mois, une année) n'est jamais la mesure d'une cible, même
  // si elle précède la bonne dans la table. Mise en cache sur `ctx` (deux générateurs, plus l'annotation, la demandent).
  function targetPair(ctx, core) {
    if (ctx.targetPairCache !== undefined) return ctx.targetPairCache;
    ctx.targetPairCache = null;
    const target = ctx.measures.find((p) => isNumberColumn(p) && TARGET_NAME_RE.test(p.id) && p.negatives === 0 && p.filled >= TARGET_MIN_FILLED);
    if (!target) return null;
    let best = null;
    ctx.measures.filter((p) => isNumberColumn(p) && p.id !== target.id && !TARGET_NAME_RE.test(p.id) && p.negatives === 0).forEach((actual) => {
      const aggFn = core.aggFor(actual);
      const value = data.aggregateSingle(ctx.insightRows, actual.id, aggFn);
      const goal = data.aggregateSingle(ctx.insightRows, target.id, aggFn);
      const reach = insights.goalReach([value], [goal]);
      if (reach === null || reach < TARGET_MIN_REACH || reach > TARGET_MAX_REACH) return;
      const gap = Math.abs(Math.log(reach));
      if (!best || gap < best.gap) best = { actual, target, aggFn, reach, value, goal, gap };
    });
    ctx.targetPairCache = best;
    return best;
  }

  // Les lignes `{ name, value, target }` d'une progression : une valeur et une cible par catégorie, alignées PAR NOM.
  function progressInput(ctx, dimension, pair, core) {
    const goals = new Map(core.groupsFor(ctx, dimension, pair.target.id, pair.aggFn).map((g) => [String(g.dimension), g.value]));
    return core.groupsFor(ctx, dimension, pair.actual.id, pair.aggFn).filter((g) => goals.has(String(g.dimension)))
      .map((g) => ({ name: String(g.dimension), value: g.value, target: goals.get(String(g.dimension)) }));
  }

  function progressCandidates(rows, ctx, opts, core) {
    const pair = targetPair(ctx, core);
    if (!pair) return [];
    const dimension = ctx.categories.find((d) => textGroup(d) && d.distinct >= PROGRESS_MIN_GROUPS && d.distinct <= PROGRESS_MAX_GROUPS);
    if (!dimension || !insights.progressStats(progressInput(ctx, dimension.id, pair, core))) return [];
    const vars = { measure: pair.actual.id, dimension: dimension.id };
    return [core.candidate({
      type: 'progress',
      score: 7.5,
      dims: [dimension.id],
      measures: [pair.actual.id, pair.target.id],
      tileData: { type: 'progress', dimension: dimension.id, measure: pair.actual.id, aggFn: pair.aggFn, targetColumn: pair.target.id,
        title: core.resolveTitle(opts, 'tileTitle.progress', vars, `${pair.actual.id} / ${dimension.id}`) },
      titleKey: 'tileTitle.progress',
      titleVars: vars,
      reasonKey: 'advice.reason.progress',
      reasonVars: { measure: pair.actual.id, target: pair.target.id, dimension: dimension.id }
    })];
  }

  // Le chiffre clé avec son objectif : la même tuile qu'un chiffre clé, plus la colonne cible (une barre et un pourcentage atteint).
  function goalKpiCandidates(rows, ctx, opts, core) {
    const pair = targetPair(ctx, core);
    if (!pair) return [];
    const trendDimension = (ctx.time && ctx.time.numericKeys && ctx.byId.get(ctx.time.dimension).distinct >= 2) ? ctx.time.dimension : undefined;
    const spec = pair.aggFn === 'avg'
      ? { key: 'advice.title.average', vars: { measure: pair.actual.id } }
      : { key: 'advice.title.total', vars: { measure: pair.actual.id } };
    return [core.candidate({
      type: 'kpi',
      intent: 'goal',
      score: 8.5,
      measures: [pair.actual.id, pair.target.id],
      tileData: Object.assign(
        { type: 'kpi', dimension: '', measure: pair.actual.id, aggFn: pair.aggFn, targetColumn: pair.target.id,
          title: core.resolveTitle(opts, spec.key, spec.vars, pair.actual.id) },
        trendDimension ? { trendDimension } : {}
      ),
      titleKey: spec.key,
      titleVars: spec.vars,
      reasonKey: 'advice.reason.kpiGoal',
      reasonVars: { measure: pair.actual.id, target: pair.target.id }
    })];
  }

  function annotateProgress(td, ctx, core) {
    const pair = { actual: { id: td.measure }, target: { id: td.targetColumn }, aggFn: td.aggFn };
    const stats = insights.progressStats(progressInput(ctx, td.dimension, pair, core));
    if (!stats) return null;
    const facts = { n: stats.n, overall: stats.overall, low: stats.lowName, lowPct: stats.lowPct, high: stats.highName, highPct: stats.highPct, behind: stats.behind, ahead: stats.ahead };
    const insight = stats.behind > 0
      ? { key: 'advice.insight.progressBehind', vars: { low: stats.lowName, pct: Math.round(stats.lowPct), behind: stats.behind, n: stats.n } }
      : { key: 'advice.insight.progressAhead', vars: { high: stats.highName, pct: Math.round(stats.highPct), low: stats.lowName, pct2: Math.round(stats.lowPct) } };
    return { facts, note: insights.interest.progress(stats), insight };
  }

  function annotateGoalKpi(td, ctx, core) {
    const value = data.aggregateSingle(ctx.insightRows, td.measure, td.aggFn);
    const goal = data.aggregateSingle(ctx.insightRows, td.targetColumn, td.aggFn);
    const reach = insights.goalReach([value], [goal]);
    if (reach === null) return null;
    const trend = td.trendDimension ? data.computeTrend(ctx.insightRows, td.trendDimension, td.measure, td.aggFn) : null;
    // Un objectif manqué ne s'écrit jamais « 100 % » (99,6 % arrondi) : « atteint 100 % » et « n'atteint que 100 % » seraient une même phrase fausse.
    const pct = reach < 1 ? Math.min(99, Math.round(reach * 100)) : Math.round(reach * 100);
    return {
      facts: { reach, value, goal, trendPct: trend ? trend.deltaPct : null },
      note: insights.interest.goal(reach),
      insight: reach < 1
        ? { key: 'advice.insight.goalShort', vars: { measure: td.measure, pct, goal: short(goal, ctx, core) } }
        : { key: 'advice.insight.goalMet', vars: { measure: td.measure, pct } }
    };
  }

  // Miniature : une barre par catégorie, remplie à la part de l'objectif atteinte (plafonnée à 1), de la couleur d'état de la tuile.
  function previewProgress(td, rows, core) {
    const goals = new Map(data.groupByAggregate(rows, td.dimension, td.targetColumn, td.aggFn || 'sum').map((g) => [String(g.dimension), g.value]));
    const lines = data.groupByAggregate(rows, td.dimension, td.measure, td.aggFn || 'sum').filter((g) => goals.has(String(g.dimension)))
      .map((g) => data.targetProgress(g.value, goals.get(String(g.dimension)))).filter(Boolean).slice(0, PREVIEW_PROGRESS_ROWS);
    return lines.length >= 2 ? { kind: 'progress', rows: lines.map((l) => ({ fill: Math.max(0, Math.min(1, l.fill)), level: l.level })) } : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Contrat commun
  // ---------------------------------------------------------------------------------------------

  const BUILDERS = [heatmapCandidates, sunburstCandidates, progressCandidates, goalKpiCandidates];

  function candidates(rows, ctx, opts, core) {
    const out = [];
    BUILDERS.forEach((build) => {
      try { out.push.apply(out, build(rows, ctx, opts, core)); } catch (e) { /* ce type n'est pas proposé, les autres le sont */ }
    });
    return out;
  }

  // Une suggestion que ce module annote : ses trois types, et un chiffre clé qui porte une colonne cible.
  function handles(c) {
    return !!c && (HANDLED.indexOf(c.type) !== -1 || (c.type === 'kpi' && !!c.tileData && !!c.tileData.targetColumn));
  }

  function annotate(c, ctx, core) {
    if (!handles(c)) return null;
    if (c.type === 'kpi') return annotateGoalKpi(c.tileData, ctx, core);
    if (c.type === 'heatmap') return annotateHeatmap(c.tileData, ctx, core);
    if (c.type === 'sunburst') return annotateSunburst(c.tileData, ctx, core);
    return annotateProgress(c.tileData, ctx, core);
  }

  function previewFor(tileData, rows, core) {
    if (!tileData || !Array.isArray(rows) || !rows.length) return null;
    try {
      if (tileData.type === 'heatmap') return previewHeatmap(tileData, rows, core);
      if (tileData.type === 'sunburst') return previewSunburst(tileData, rows, core);
      if (tileData.type === 'progress' && tileData.targetColumn) return previewProgress(tileData, rows, core);
    } catch (e) { /* pas de miniature */ }
    return null;
  }

  return {
    INTENT_BY_TYPE, HANDLED, TARGET_NAME_RE, HEAT_MIN_AXIS, HEAT_MAX_AXIS, HEAT_MIN_LIFT, HEAT_MIN_CELL_SHARE, SUN_MAX_PARENTS, SUN_MAX_PARTS, SUN_MIN_PARTS,
    HEAT_MIN_V, TARGET_MIN_REACH, TARGET_MAX_REACH, PROGRESS_MIN_GROUPS, PROGRESS_MAX_GROUPS,
    candidates, handles, annotate, previewFor
  };
});
