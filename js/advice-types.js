/*
 * Suggestions des types de tuile « spécialisés » (niveau 2b de l'intelligence des suggestions, 25/11/2026) : Pareto, barres + courbe,
 * histogramme, boîte à moustaches, cascade et entonnoir. Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-types.js).
 *
 * Niveau 2c (25/11/2026) : js/advice-types-time.js (calendrier, planning) et js/advice-types-grid.js (carte de chaleur, soleil, objectif) ont le
 * même contrat ; ce fichier les appelle et les expose avec les siens (`candidates`, `annotate`, `previewFor`, `handles`, `INTENT_BY_TYPE`).
 *
 * Ce fichier est la SUITE de js/advice.js (même rôle que js/data-tiles.js pour js/data.js) : js/advice.js lui passe les fonctions
 * communes dont il se sert (`core` : `candidate`, `groupsFor`, `measureOptions`, `aggFor`… — le module ne les redéfinit pas, il ne dépend
 * donc pas de js/advice.js et n'a aucun import circulaire) et lui demande deux choses :
 *   - `candidates(rows, ctx, opts, core)` : les tuiles candidates, chacune ÉLIGIBLE d'après les données (un Pareto seulement quand la
 *     concentration existe, une cascade seulement quand les signes sont mêlés, un entonnoir seulement sur une colonne d'étapes…) ;
 *   - `annotate(c, ctx, core)` : `{ facts, note, insight }` d'un candidat (les chiffres, l'intérêt de 0 à 1 et l'explication chiffrée),
 *     que js/advice.js transforme en score (`score = a priori + SCORE_SPAN x (intérêt - SCORE_NEUTRAL)`, voir js/advice.js:annotate).
 *   - `previewFor(tileData, rows, core)` : les nombres normalisés de la miniature de l'écran d'accueil (js/welcome.js:previewSvg).
 *
 * AUCUN TEXTE EN DUR : clés i18n (`advice.*`, `tileTitle.*`) + variables, comme js/advice.js. Les chiffres se calculent sur
 * `ctx.insightRows` (l'échantillon réparti de js/advice.js:sampleOf) et ne sont que des rapports, jamais un total que l'échantillon fausserait.
 * Un candidat est un graphique que la personne pourrait demander : mieux vaut en proposer moins que montrer un graphique vide de sens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./advice-insights.js'), require('./advice-types-time.js'), require('./advice-types-grid.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceTypes = factory(root.GristBI.data, root.GristBI.adviceInsights, root.GristBI.adviceTypesTime, root.GristBI.adviceTypesGrid);
  }
})(typeof self !== 'undefined' ? self : this, function (data, insights, time, grid) {
  'use strict';

  // Intention de chaque type (voir js/advice.js:INTENT_BY_TYPE) : le Pareto déclare la sienne (`concentrate`) au cas par cas, c'est un
  // `combo` comme le graphique à deux mesures.
  const INTENT_BY_TYPE = Object.assign(
    { combo: 'relation', histogram: 'distribution', box: 'distribution', waterfall: 'change', funnel: 'stages' },
    time.INTENT_BY_TYPE, grid.INTENT_BY_TYPE
  );

  // Pareto : au moins 5 groupes (en dessous, « 20 % des groupes » ne veut rien dire), au plus 60 (au-delà les barres ne se lisent plus) ;
  // jamais proposé quand il faut plus de la moitié des groupes pour atteindre 80 % du total (aucune concentration à montrer).
  const PARETO_MIN_GROUPS = 5;
  const PARETO_MAX_GROUPS = 60;
  const PARETO_MAX_SHARE_FOR_80 = 0.5;
  // Histogramme et boîtes : une colonne qui prend assez de valeurs différentes (une note de 1 à 5 est une catégorie) sur assez de lignes.
  const NUMBER_MIN_DISTINCT = 8;
  const NUMBER_MIN_FILLED = 30;
  // Barres + courbe : un axe de 6 à 24 catégories (une corrélation entre deux courbes de 4 points n'est qu'une coïncidence), et un lien net
  // entre les deux mesures (|r| d'au moins 0,6) : deux mesures sans rapport ne justifient pas un double axe.
  const COMBO_MIN_GROUPS = 6;
  const COMBO_MAX_GROUPS = 24;
  const COMBO_MIN_ABS_R = 0.6;
  // Entonnoir : 3 à 8 étapes, dans une colonne que son NOM désigne comme des étapes. Les valeurs seules ne disent pas qu'un parcours se
  // rétrécit (n'importe quelle catégorie triée par taille ressemble à un entonnoir) : c'est un indice de NOM, jamais seul — il faut aussi
  // que les données forment des étapes (3 à 8 valeurs, de tailles qui décroissent).
  const FUNNEL_MIN_STAGES = 3;
  const FUNNEL_MAX_STAGES = 8;
  const STAGE_NAME_RE = /(^|[^a-zà-ÿ])(etapes?|étapes?|stages?|phases?|steps?|pipeline|funnel|entonnoir)([^a-zà-ÿ]|$)/i;
  // Histogramme : une asymétrie d'au moins 1 (coefficient de Fisher-Pearson) ou 2 % de valeurs aberrantes se disent.
  const SKEW_SAYS = 1;
  const OUTLIER_SAYS = 0.02;
  // Boîtes : deux groupes dont les médianes sont à plus de 0,75 écart interquartile l'un de l'autre sont « différents ».
  const BOX_GAP_SAYS = 0.75;
  // Miniature : nombre de barres, de classes et de boîtes dessinées.
  const PREVIEW_MAX_BARS = 8;
  const PREVIEW_MAX_BINS = 12;
  const PREVIEW_MAX_BOXES = 5;

  const isNumberColumn = (p) => p.kind === 'number' && !p.ordinal;
  const realMeasures = (ctx) => ctx.measures.filter(isNumberColumn);
  const spreadable = (p) => isNumberColumn(p) && p.distinct >= NUMBER_MIN_DISTINCT && p.filled >= NUMBER_MIN_FILLED;
  const textGroup = (p) => p.kind === 'text' && !p.listLike && p.role !== 'reference' && p.role !== 'list';

  // Un nombre court pour une phrase : 100 et plus sans décimale, de 10 à 100 une, en dessous deux.
  function short(x, ctx, core) {
    const a = Math.abs(x);
    return core.fmt(x, ctx, a >= 100 ? 0 : (a >= 10 ? 1 : 2));
  }

  // ---------------------------------------------------------------------------------------------
  // Candidats
  // ---------------------------------------------------------------------------------------------

  // Pareto : « quelques catégories font l'essentiel du total ». Une mesure qui s'additionne (jamais une moyenne ni une note), sinon le
  // nombre de lignes ; les catégories peuvent être NOMBREUSES (un client, un produit : de 5 à 60), ce que les barres ordinaires évitent.
  function paretoCandidates(rows, ctx, opts, core) {
    const dims = ctx.profiles.filter((p) => textGroup(p) && (p.role === 'category' || p.role === 'highCardinality') && !p.timeLike
      && p.distinct >= PARETO_MIN_GROUPS && p.distinct <= PARETO_MAX_GROUPS).slice(0, 2);
    const amount = realMeasures(ctx).find((p) => core.aggFor(p) === 'sum' && p.negatives === 0);
    const measure = amount
      ? { column: amount.id, aggFn: 'sum', count: false }
      : (ctx.countColumn ? { column: ctx.countColumn, aggFn: 'count', count: true } : null);
    if (!measure) return [];
    const out = [];
    dims.filter((d) => d.id !== measure.column).forEach((d) => {
      const stats = insights.paretoStats(core.groupsFor(ctx, d.id, measure.column, measure.aggFn));
      if (!stats || stats.shareOfGroupsFor80 > PARETO_MAX_SHARE_FOR_80) return;
      const spec = measure.count
        ? { key: 'advice.title.paretoCount', vars: { dimension: d.id }, fallback: d.id }
        : { key: 'tileTitle.pareto', vars: { measure: measure.column, dimension: d.id }, fallback: `${measure.column} / ${d.id}` };
      out.push(core.candidate({
        type: 'combo',
        intent: 'concentrate',
        score: 7.5,
        dims: [d.id],
        measures: [measure.column],
        tileData: { type: 'combo', comboMode: 'pareto', dimension: d.id, measure: measure.column, aggFn: measure.aggFn,
          title: core.resolveTitle(opts, spec.key, spec.vars, spec.fallback) },
        titleKey: spec.key,
        titleVars: spec.vars,
        reasonKey: 'advice.reason.pareto',
        reasonVars: { dimension: d.id }
      }));
    });
    return out;
  }

  // Barres + courbe : deux mesures d'une même catégorie (ou d'une même période) sur deux axes. Proposé seulement quand elles sont mesurées
  // sur assez de groupes pour qu'on puisse dire si elles évoluent ensemble.
  function comboCandidates(rows, ctx, opts, core) {
    const real = realMeasures(ctx).filter((p) => !p.lowCardinality);
    const first = real[0];
    const second = real.slice(1).find((p) => !(first.score && p.score && first.scaleTop === p.scaleTop));
    if (!first || !second) return [];
    const dims = ctx.categories.filter((d) => textGroup(d) && d.distinct >= COMBO_MIN_GROUPS && d.distinct <= COMBO_MAX_GROUPS).slice(0, 2).map((d) => d.id);
    if (ctx.time && dims.indexOf(ctx.time.dimension) === -1) dims.push(ctx.time.dimension);
    const aggFn = core.aggFor(first);
    const aggFnY = core.aggFor(second);
    const out = [];
    dims.forEach((dimension) => {
      if (out.length >= 2) return;
      const corr = comboCorrelation(ctx, dimension, first.id, aggFn, second.id, aggFnY, core);
      if (!corr || Math.abs(corr.r) < COMBO_MIN_ABS_R) return;
      const ordered = ctx.time && dimension === ctx.time.dimension;
      const ascending = !ordered || core.appearsAscending(rows, dimension);
      const vars = { measure: first.id, measureY: second.id, dimension };
      out.push(core.candidate({
        type: 'combo',
        score: 5.5,
        dims: [dimension],
        measures: [first.id, second.id],
        tileData: Object.assign(
          { type: 'combo', dimension, measure: first.id, aggFn, measureY: second.id,
            title: core.resolveTitle(opts, 'tileTitle.combo', vars, `${first.id} / ${second.id}`) },
          aggFnY !== aggFn ? { aggFnY } : {},
          // Un axe qui a son ordre (le temps) garde l'ordre de ses valeurs ; des catégories se rangent par taille de la mesure en barres.
          ordered ? (ascending ? {} : { sortMode: 'label' }) : { sortMode: 'value-desc' }
        ),
        titleKey: 'tileTitle.combo',
        titleVars: vars,
        reasonKey: 'advice.reason.combo',
        reasonVars: { measure: first.id, measureY: second.id }
      }));
    });
    return out;
  }

  // Corrélation des deux mesures d'un groupe à l'autre (alignées PAR NOM de groupe, jamais par rang), ou null : moins de 6 groupes en commun.
  function comboCorrelation(ctx, dimension, measure, aggFn, measureY, aggFnY, core) {
    const ys = new Map(core.groupsFor(ctx, dimension, measureY, aggFnY).map((g) => [String(g.dimension), g.value]));
    const pairs = core.groupsFor(ctx, dimension, measure, aggFn).filter((g) => ys.has(String(g.dimension)));
    if (pairs.length < COMBO_MIN_GROUPS || pairs.length > COMBO_MAX_GROUPS) return null;
    return insights.correlationStats(pairs.map((g) => g.value), pairs.map((g) => ys.get(String(g.dimension))));
  }

  // Histogramme : comment se répartissent les valeurs d'une colonne numérique (une vraie mesure, pas un rang ni une note de 1 à 5).
  function histogramCandidates(rows, ctx, opts, core) {
    return realMeasures(ctx).filter(spreadable).slice(0, 2).map((p) => core.candidate({
      type: 'histogram',
      score: 5.5, // un regard de plus sur une colonne, jamais avant le chiffre clé : il doit avoir un fait à dire pour passer devant
      measures: [p.id],
      tileData: { type: 'histogram', dimension: '', measure: p.id, title: core.resolveTitle(opts, 'tileTitle.histogram', { measure: p.id }, p.id) },
      titleKey: 'tileTitle.histogram',
      titleVars: { measure: p.id },
      reasonKey: 'advice.reason.histogram',
      reasonVars: { measure: p.id }
    }));
  }

  // Des boîtes qui ont quelque chose à montrer : des groupes aux médianes bien séparées, ou des valeurs aberrantes (au moins 2).
  function boxHasStory(gap) {
    return !!gap && ((gap.gapIqr !== null && gap.gapIqr >= BOX_GAP_SAYS) || (gap.outlierShare >= OUTLIER_SAYS && gap.outlierCount >= 2));
  }

  // Boîtes à moustaches : une colonne numérique répartie entre quelques groupes qui ont chacun assez de lignes pour que des quartiles
  // aient un sens (5 au moins, comme le dit l'avertissement de la tuile). Jamais proposées quand les groupes se ressemblent : des boîtes
  // identiques ne disent que « rien à voir ».
  function boxCandidates(rows, ctx, opts, core) {
    const measures = realMeasures(ctx).filter(spreadable).slice(0, 2);
    const dims = ctx.categories.filter((d) => textGroup(d) && d.distinct >= 2 && d.distinct <= data.BOX_MAX_GROUPS
      && d.filled / d.distinct >= data.BOX_MIN_RELIABLE).slice(0, 2);
    const out = [];
    dims.forEach((d, i) => measures.slice(0, i === 0 ? 2 : 1).forEach((p) => {
      const gap = insights.boxGapStats(data.boxStatsByGroup(ctx.insightRows, d.id, p.id).groups, data.BOX_MIN_RELIABLE);
      if (!boxHasStory(gap)) return;
      const vars = { measure: p.id, dimension: d.id };
      out.push(core.candidate({
        type: 'box',
        score: 5.5,
        dims: [d.id],
        measures: [p.id],
        tileData: { type: 'box', dimension: d.id, measure: p.id, title: core.resolveTitle(opts, 'tileTitle.box', vars, `${p.id} / ${d.id}`) },
        titleKey: 'tileTitle.box',
        titleVars: vars,
        reasonKey: 'advice.reason.box',
        reasonVars: vars
      }));
    }));
    return out;
  }

  // Cascade : comment des hausses et des baisses mènent à un solde. Il faut une mesure qui s'additionne ET qui change de signe, et des
  // groupes de signes mêlés (sans baisse, une cascade n'est qu'un cumul) : une catégorie de 3 à 12 valeurs, ou un axe de temps déjà rangé.
  function waterfallCandidates(rows, ctx, opts, core) {
    const measure = realMeasures(ctx).find((p) => p.negatives > 0 && !p.score && core.aggFor(p) === 'sum');
    if (!measure) return [];
    const dims = ctx.categories.filter((d) => textGroup(d) && !d.timeLike && d.distinct >= 3 && d.distinct <= 12).slice(0, 2).map((d) => d.id);
    if (ctx.time && core.appearsAscending(rows, ctx.time.dimension)) dims.push(ctx.time.dimension);
    const out = [];
    dims.filter((dimension) => dimension !== measure.id).forEach((dimension) => {
      if (out.length >= 2 || !insights.waterfallStats(core.groupsFor(ctx, dimension, measure.id, 'sum'))) return;
      const vars = { measure: measure.id, dimension };
      out.push(core.candidate({
        type: 'waterfall',
        score: 6.5,
        dims: [dimension],
        measures: [measure.id],
        tileData: { type: 'waterfall', dimension, measure: measure.id, aggFn: 'sum', title: core.resolveTitle(opts, 'advice.title.waterfall', vars, `${measure.id} / ${dimension}`) },
        titleKey: 'advice.title.waterfall',
        titleVars: vars,
        reasonKey: 'advice.reason.waterfall',
        reasonVars: { measure: measure.id }
      }));
    });
    return out;
  }

  // Entonnoir : le nombre de lignes à chaque étape d'un parcours, quand une colonne d'étapes existe (3 à 8 valeurs, nom d'étape) et que
  // ses étapes ont des tailles différentes à ranger (voir STAGE_NAME_RE).
  function funnelCandidates(rows, ctx, opts, core) {
    if (!ctx.countColumn) return [];
    const stage = ctx.profiles.find((p) => textGroup(p) && p.role === 'category' && !p.timeLike && STAGE_NAME_RE.test(p.id)
      && p.distinct >= FUNNEL_MIN_STAGES && p.distinct <= FUNNEL_MAX_STAGES);
    if (!stage || !insights.funnelStats(core.groupsFor(ctx, stage.id, ctx.countColumn, 'count'))) return [];
    const vars = { dimension: stage.id };
    return [core.candidate({
      type: 'funnel',
      score: 7,
      dims: [stage.id],
      measures: [ctx.countColumn],
      tileData: { type: 'funnel', dimension: stage.id, measure: ctx.countColumn, aggFn: 'count', sortMode: 'value-desc',
        title: core.resolveTitle(opts, 'advice.title.funnelCount', vars, stage.id) },
      titleKey: 'advice.title.funnelCount',
      titleVars: vars,
      reasonKey: 'advice.reason.funnel',
      reasonVars: { n: stage.distinct, dimension: stage.id }
    })];
  }

  const BUILDERS = [paretoCandidates, funnelCandidates, waterfallCandidates, histogramCandidates, boxCandidates, comboCandidates,
    time.candidates, grid.candidates];

  // Les candidats de ces types ; un générateur qui échoue n'en retire jamais un autre (ni aucune suggestion de js/advice.js).
  function candidates(rows, ctx, opts, core) {
    const out = [];
    BUILDERS.forEach((build) => {
      try { out.push.apply(out, build(rows, ctx, opts, core)); } catch (e) { /* ce type n'est pas proposé, les autres le sont */ }
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Intérêt et explication chiffrée
  // ---------------------------------------------------------------------------------------------

  const OWN_HANDLED = ['combo', 'histogram', 'box', 'waterfall', 'funnel'];
  const HANDLED = OWN_HANDLED.concat(time.HANDLED, grid.HANDLED);

  // Cette suggestion est-elle annotée par un module de ce dossier ? Ses types, et un chiffre clé qui porte une colonne cible (objectif).
  function handles(c) {
    return !!c && (HANDLED.indexOf(c.type) !== -1 || grid.handles(c));
  }

  function numbersOf(ctx, column) {
    return ctx.insightRows.map((r) => insights.finite(r[column])).filter((v) => v !== null);
  }

  function annotateHistogram(td, ctx, core) {
    const stats = insights.distributionStats(numbersOf(ctx, td.measure));
    if (!stats) return null;
    const facts = { n: stats.n, mean: stats.mean, median: stats.median, skew: stats.skew, outlierShare: stats.outlierShare, outlierCount: stats.outlierCount };
    const note = insights.interest.distribution({ skew: stats.skew }, { share: stats.outlierShare });
    const vars = { measure: td.measure, mean: short(stats.mean, ctx, core), median: short(stats.median, ctx, core) };
    let insight;
    const fromSkew = Math.abs(stats.skew) / 2;
    const fromOutliers = stats.outlierShare * 10;
    if (Math.abs(stats.skew) >= SKEW_SAYS && fromSkew >= fromOutliers) {
      insight = { key: stats.skew > 0 ? 'advice.insight.histSkewRight' : 'advice.insight.histSkewLeft', vars };
    } else if (stats.outlierShare >= OUTLIER_SAYS && stats.outlierCount >= 2) {
      insight = { key: 'advice.insight.histOutliers', vars: Object.assign({ pct: insights.percentOf(stats.outlierShare) }, vars) };
    } else {
      insight = { key: 'advice.insight.histEven', vars };
    }
    return { facts, note, insight };
  }

  function annotateBox(td, ctx, core) {
    const groups = data.boxStatsByGroup(ctx.insightRows, td.dimension, td.measure).groups;
    const gap = insights.boxGapStats(groups, data.BOX_MIN_RELIABLE);
    if (!gap) return null;
    const facts = { groups: gap.n, high: gap.highName, low: gap.lowName, gapIqr: gap.gapIqr, outlierShare: gap.outlierShare, outlierCount: gap.outlierCount, outlierName: gap.outlierName };
    const note = insights.interest.box(gap);
    const gapNote = gap.gapIqr === null ? 0 : Math.min(1, gap.gapIqr / 2);
    let insight;
    if (gap.gapIqr !== null && gap.gapIqr >= BOX_GAP_SAYS && gapNote >= gap.outlierShare * 10) {
      insight = { key: 'advice.insight.boxGap', vars: { measure: td.measure, high: gap.highName, highValue: short(gap.highMedian, ctx, core), low: gap.lowName, lowValue: short(gap.lowMedian, ctx, core) } };
    } else if (gap.outlierName !== null && gap.outlierShare >= OUTLIER_SAYS && gap.outlierCount >= 2) {
      insight = { key: 'advice.insight.boxOutliers', vars: { measure: td.measure, pct: insights.percentOf(gap.outlierShare), name: gap.outlierName } };
    } else {
      insight = { key: 'advice.insight.boxAlike', vars: { measure: td.measure, dimension: td.dimension } };
    }
    return { facts, note, insight };
  }

  function annotatePareto(td, ctx, core) {
    const stats = insights.paretoStats(core.groupsFor(ctx, td.dimension, td.measure, td.aggFn));
    if (!stats) return null;
    return {
      facts: { n: stats.n, countFor80: stats.countFor80, shareOfGroupsFor80: stats.shareOfGroupsFor80, topShare: stats.topShare, topName: stats.topName },
      note: insights.interest.pareto(stats),
      insight: { key: td.aggFn === 'count' ? 'advice.insight.paretoTopCount' : 'advice.insight.paretoTop', vars: { k: stats.countFor80, n: stats.n, dimension: td.dimension, measure: td.measure } }
    };
  }

  function annotateCombo(td, ctx, core) {
    if (td.comboMode === 'pareto') return annotatePareto(td, ctx, core);
    const corr = comboCorrelation(ctx, td.dimension, td.measure, td.aggFn, td.measureY, td.aggFnY || td.aggFn, core);
    if (!corr) return { facts: null, note: 0.2, insight: null }; // trop peu de groupes pour dire quoi que ce soit : l'a priori ne tient plus
    const vars = { measure: td.measure, measureY: td.measureY, dimension: td.dimension, r: insights.formatCorrelation(corr.r, ctx.lang) };
    return {
      facts: { r: corr.r, n: corr.n },
      note: insights.interest.relation(corr),
      insight: { key: corr.r >= 0.5 ? 'advice.insight.comboUp' : (corr.r <= -0.5 ? 'advice.insight.comboDown' : 'advice.insight.comboWeak'), vars }
    };
  }

  function annotateWaterfall(td, ctx, core) {
    const stats = insights.waterfallStats(core.groupsFor(ctx, td.dimension, td.measure, 'sum'));
    if (!stats) return null;
    const vars = { measure: td.measure, fall: stats.biggestDownName, pct: stats.net >= 0 ? insights.percentOf(Math.min(1, stats.offset)) : Math.round(stats.offset * 100) };
    return {
      facts: { n: stats.n, ups: stats.ups, downs: stats.downs, offset: stats.offset, net: stats.net, biggestDown: stats.biggestDownName, biggestUp: stats.biggestUpName },
      note: insights.interest.waterfall(stats),
      insight: { key: stats.net >= 0 ? 'advice.insight.waterfallGain' : 'advice.insight.waterfallLoss', vars }
    };
  }

  function annotateFunnel(td, ctx, core) {
    const stats = insights.funnelStats(core.groupsFor(ctx, td.dimension, td.measure, 'count'));
    if (!stats) return null;
    const facts = { n: stats.n, first: stats.firstName, last: stats.lastName, keep: stats.keep, worstFrom: stats.worst.from, worstTo: stats.worst.to, worstDropPct: stats.worst.dropPct };
    // Des étapes de taille proche (la dernière garde plus de 90 % de la première) ne forment pas un entonnoir : on le dit.
    const insight = stats.keep >= 0.9
      ? { key: 'advice.insight.funnelEven', vars: { dimension: td.dimension, n: stats.n } }
      : { key: 'advice.insight.funnelDrop', vars: { first: stats.firstName, last: stats.lastName, ratio: core.fmt(stats.ratio, ctx, 1), from: stats.worst.from, to: stats.worst.to, pct: Math.round(stats.worst.dropPct) } };
    return { facts, note: insights.interest.funnel(stats), insight };
  }

  // `{ facts, note, insight }` d'un candidat de ces types, ou null (autre type, ou des données qui ne permettent aucun chiffre : le
  // candidat garde alors son a priori et sa raison générique).
  function annotate(c, ctx, core) {
    if (!handles(c)) return null;
    if (time.HANDLED.indexOf(c.type) !== -1) return time.annotate(c, ctx, core);
    if (grid.handles(c)) return grid.annotate(c, ctx, core);
    const td = c.tileData;
    switch (c.type) {
      case 'histogram': return annotateHistogram(td, ctx, core);
      case 'box': return annotateBox(td, ctx, core);
      case 'combo': return annotateCombo(td, ctx, core);
      case 'waterfall': return annotateWaterfall(td, ctx, core);
      default: return annotateFunnel(td, ctx, core);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Miniatures (nombres normalisés de 0 à 1, dessinés par js/welcome.js:previewSvg)
  // ---------------------------------------------------------------------------------------------

  const evenly = (values, max) => (values.length <= max ? values
    : Array.from({ length: max }, (_, i) => values[Math.round(i * (values.length - 1) / (max - 1))]));

  // Barres et courbe : les plus grandes valeurs en barres, et la part cumulée (Pareto) ou la 2e mesure (combo) en courbe, de 0 à 1.
  function previewBarLine(td, rows, core) {
    const groups = data.groupByAggregate(rows, td.dimension, td.measure, td.aggFn || 'sum');
    if (td.comboMode === 'pareto') {
      const sorted = groups.map((g) => Math.max(0, Number(g.value) || 0)).sort((a, b) => b - a);
      const total = sorted.reduce((s, v) => s + v, 0);
      if (sorted.length < 2 || !(total > 0)) return null;
      let running = 0;
      const cumulative = sorted.map((v) => { running += v; return running / total; });
      // Les plus grandes barres (la tête de la distribution, ce qu'un Pareto montre) et la part cumulée à leur hauteur.
      const head = sorted.slice(0, PREVIEW_MAX_BARS);
      return { kind: 'barline', bars: head.map((v) => v / sorted[0]), line: head.map((_, i) => cumulative[i]) };
    }
    const ys = new Map(data.groupByAggregate(rows, td.dimension, td.measureY, td.aggFnY || td.aggFn).map((g) => [String(g.dimension), Number(g.value) || 0]));
    const pairs = evenly(data.isSortableTile(td) ? data.sortGroups(groups, td.sortMode) : groups, PREVIEW_MAX_BARS)
      .filter((g) => ys.has(String(g.dimension))).map((g) => [Math.abs(Number(g.value) || 0), ys.get(String(g.dimension))]);
    if (pairs.length < 2) return null;
    const norm = (list) => { const lo = Math.min.apply(null, list); const hi = Math.max.apply(null, list); return list.map((v) => (hi === lo ? 0.5 : (v - lo) / (hi - lo))); };
    const top = Math.max.apply(null, pairs.map((p) => p[0]));
    return top > 0 ? { kind: 'barline', bars: pairs.map((p) => p[0] / top), line: norm(pairs.map((p) => p[1])) } : null;
  }

  function previewHistogram(td, rows, core) {
    const sample = core.sampleOf(rows);
    const bins = data.histogramBins(sample, sample, td.measure).bins.map((b) => b.count);
    const top = Math.max.apply(null, bins.length ? bins : [0]);
    return top > 0 ? { kind: 'histogram', values: evenly(bins, PREVIEW_MAX_BINS).map((v) => v / top) } : null;
  }

  function previewBoxes(td, rows, core) {
    const groups = data.boxStatsByGroup(core.sampleOf(rows), td.dimension, td.measure).groups.filter((g) => g.n >= 2).slice(0, PREVIEW_MAX_BOXES);
    if (groups.length < 2) return null;
    const lo = Math.min.apply(null, groups.map((g) => g.low));
    const hi = Math.max.apply(null, groups.map((g) => g.high));
    if (!(hi > lo)) return null;
    const at = (v) => (v - lo) / (hi - lo);
    return { kind: 'boxes', boxes: groups.map((g) => ({ low: at(g.low), q1: at(g.q1), median: at(g.median), q3: at(g.q3), high: at(g.high) })) };
  }

  // Cascade : chaque marche va de `from` à `to` (de 0 à 1) sur l'échelle qui contient tout le chemin cumulé, zéro compris.
  function previewWaterfall(td, rows) {
    const groups = data.groupByAggregate(rows, td.dimension, td.measure, 'sum').slice(0, PREVIEW_MAX_BARS)
      .map((g) => Number(g.value)).filter((v) => Number.isFinite(v));
    if (groups.length < 3) return null;
    let running = 0;
    const path = groups.map((v) => { const from = running; running += v; return [from, running]; });
    const lo = Math.min.apply(null, path.map((p) => Math.min(p[0], p[1])).concat([0]));
    const hi = Math.max.apply(null, path.map((p) => Math.max(p[0], p[1])).concat([0]));
    if (!(hi > lo)) return null;
    return { kind: 'waterfall', steps: path.map((p) => ({ from: (p[0] - lo) / (hi - lo), to: (p[1] - lo) / (hi - lo) })) };
  }

  // La miniature d'une tuile de ces types, ou null (autre type, ou des données qui n'en donnent aucune).
  function previewFor(tileData, rows, core) {
    if (!tileData || !Array.isArray(rows) || !rows.length) return null;
    try {
      switch (tileData.type) {
        case 'combo': return previewBarLine(tileData, rows, core);
        case 'histogram': return previewHistogram(tileData, rows, core);
        case 'box': return previewBoxes(tileData, rows, core);
        case 'waterfall': return previewWaterfall(tileData, rows);
        case 'calendar': case 'gantt': return time.previewFor(tileData, rows, core);
        case 'heatmap': case 'sunburst': case 'progress': return grid.previewFor(tileData, rows, core);
        default: return null;
      }
    } catch (e) { return null; }
  }

  return {
    INTENT_BY_TYPE, HANDLED, STAGE_NAME_RE, PARETO_MIN_GROUPS, PARETO_MAX_GROUPS, PARETO_MAX_SHARE_FOR_80, NUMBER_MIN_DISTINCT, NUMBER_MIN_FILLED,
    COMBO_MIN_GROUPS, COMBO_MAX_GROUPS, COMBO_MIN_ABS_R, FUNNEL_MIN_STAGES, FUNNEL_MAX_STAGES, SKEW_SAYS, OUTLIER_SAYS, BOX_GAP_SAYS,
    candidates, handles, annotate, previewFor
  };
});
