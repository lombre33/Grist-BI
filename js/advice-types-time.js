/*
 * Suggestions des types de tuile « du temps » (niveau 2c de l'intelligence des suggestions, 25/11/2026) : le calendrier (une case par jour)
 * et le planning (Gantt, une barre par tâche). Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-types-time-grid.js).
 *
 * Même rôle et même contrat que js/advice-types.js, dont il est une partie (js/advice-types.js l'appelle ; il ne dépend ni de lui ni de
 * js/advice.js) : `candidates(rows, ctx, opts, core)`, `annotate(c, ctx, core)`, `previewFor(tileData, rows, core)`. `core` est l'objet
 * d'outils que js/advice.js passe (`candidate`, `resolveTitle`, `measureOptions`, `defaultsFor`, `fmt`…).
 *
 * AUCUN TEXTE EN DUR : clés i18n (`advice.*`, `tileTitle.*`) + variables. Un type n'est proposé que si les données ont un fait à dire :
 * un calendrier seulement quand un rythme se voit (un jour de la semaine qui domine, un pic) ; un planning seulement sur deux colonnes de
 * dates que leur NOM désigne comme un début et une fin, pour quelques dizaines de tâches.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./advice-insights.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceTypesTime = factory(root.GristBI.data, root.GristBI.adviceInsights);
  }
})(typeof self !== 'undefined' ? self : this, function (data, insights) {
  'use strict';

  // `calendar` suit le rythme d'une activité, `gantt` est un planning : deux intentions de plus (js/advice.js:INTENT_KEYS).
  const INTENT_BY_TYPE = { calendar: 'rhythm', gantt: 'schedule' };
  const HANDLED = ['calendar', 'gantt'];

  // Calendrier : au moins 60 jours avec une valeur dans la fenêtre affichée (en dessous, une courbe dit la même chose) ; un RYTHME de la
  // semaine : un jour qui pèse au moins 1,5 fois le plus calme des jours actifs (ou une semaine à jours vides) ET que le jour de la
  // semaine explique au moins 5 % de la variation (`eta2`, voir js/advice-insights.js:calendarStats ; le hasard en donne moins de 2 %). Un
  // pic isolé (une grosse vente) n'est pas un rythme : il ne suffit jamais à proposer un calendrier.
  const CALENDAR_MIN_DAYS = 60;
  const CALENDAR_WEEKDAY_SAYS = 1.5;
  const CALENDAR_MIN_ETA2 = 0.05;
  // Planning : de 3 à 60 tâches (au-delà, des centaines de lignes ne se lisent plus : un histogramme des durées est le bon outil), au moins
  // une semaine d'étendue, et au plus 20 % de lignes sans dates valables.
  const GANTT_MIN_TASKS = 3;
  const GANTT_MAX_TASKS = 60;
  const GANTT_MIN_SPAN_DAYS = 7;
  const GANTT_MAX_IGNORED_SHARE = 0.2;
  const GANTT_MAX_ROWS_SCANNED = 3000;
  // Deux dates ne font pas un planning (naissance et embauche ne sont pas un début et une fin) : l'une des deux colonnes porte un nom de
  // début ou de fin. C'est un indice de NOM, jamais seul : les valeurs doivent aussi donner des tâches (début avant la fin).
  const START_NAME_RE = /(^|[^a-zà-ÿ])(d[eé]but|debut|start|begin|d[eé]part|ouverture|opened|cr[eé][eé]e?|created|from)([^a-zà-ÿ]|$)/i;
  const END_NAME_RE = /(^|[^a-zà-ÿ])(fin|end|[eé]ch[eé]ance|due|deadline|livraison|delivery|cl[oô]tur[eé]?e?|closed|fermeture|termin[eé]e?|finish|to)([^a-zà-ÿ]|$)/i;
  // Miniatures : semaines d'un calendrier, barres d'un planning.
  const PREVIEW_WEEKS = 12;
  const PREVIEW_TASKS = 6;

  const additive = (m) => m.count || m.aggFn === 'sum';

  // ---------------------------------------------------------------------------------------------
  // Calendrier
  // ---------------------------------------------------------------------------------------------

  // La mesure d'un calendrier : une somme (ou le nombre de lignes), jamais une moyenne — « le jour le plus chargé » demande de l'additionner.
  function calendarMeasure(ctx, core) {
    const options = core.measureOptions(ctx);
    const sum = options.find(additive);
    if (sum) return sum;
    return ctx.countColumn ? { column: ctx.countColumn, aggFn: 'count', count: true, profile: null } : null;
  }

  // Les jours (avec valeur) d'une colonne de dates et leurs chiffres, sur TOUTES les lignes (jamais sur l'échantillon : un jour que le tirage
  // n'a pas touché passerait pour un jour sans activité), calculés UNE fois par suggestTiles.
  function calendarView(ctx, dateColumn, m) {
    if (!ctx.calendarCache) ctx.calendarCache = new Map();
    const key = [dateColumn, m.column, m.aggFn].join('\u0001');
    if (!ctx.calendarCache.has(key)) {
      const cal = data.calendarDays(ctx.allRows || ctx.insightRows, dateColumn, m.column, m.aggFn);
      ctx.calendarCache.set(key, { cal, stats: cal.days.length >= CALENDAR_MIN_DAYS ? insights.calendarStats(cal.days, { additive: true }) : null });
    }
    return ctx.calendarCache.get(key);
  }

  // Un rythme se voit : un jour de la semaine qui domine (ou une semaine à jours vides), et pas par hasard.
  function hasRhythm(stats) {
    return !!stats && stats.eta2 >= CALENDAR_MIN_ETA2 && (stats.emptyWorst || stats.activeRatio >= CALENDAR_WEEKDAY_SAYS);
  }

  function calendarCandidates(rows, ctx, opts, core) {
    const m = calendarMeasure(ctx, core);
    if (!m) return [];
    const dates = ctx.profiles.filter((p) => p.role === 'time' && p.distinct >= CALENDAR_MIN_DAYS).slice(0, 2);
    const out = [];
    dates.forEach((date) => {
      if (out.length || !hasRhythm(calendarView(ctx, date.id, m).stats)) return;
      const spec = m.count
        ? { key: 'advice.title.calendarCount', vars: { dimension: date.id }, fallback: date.id }
        : { key: 'tileTitle.calendar', vars: { measure: m.column, dimension: date.id }, fallback: `${m.column} / ${date.id}` };
      out.push(core.candidate({
        type: 'calendar',
        score: 6.5,
        dims: [date.id],
        measures: [m.column],
        tileData: { type: 'calendar', dimension: date.id, measure: m.column, aggFn: m.aggFn, title: core.resolveTitle(opts, spec.key, spec.vars, spec.fallback) },
        titleKey: spec.key,
        titleVars: spec.vars,
        reasonKey: 'advice.reason.calendar',
        reasonVars: { dimension: date.id }
      }));
    });
    return out;
  }

  function annotateCalendar(td, ctx) {
    const { stats } = calendarView(ctx, td.dimension, { column: td.measure, aggFn: td.aggFn });
    if (!stats) return null;
    const facts = {
      days: stats.n, bestDay: stats.bestDay, worstDay: stats.worstDay, bestShare: stats.bestShare, worstShare: stats.worstShare,
      activeRatio: stats.activeRatio, emptyWorst: stats.emptyWorst, eta2: stats.eta2, peakDate: stats.peakDate, peakRatio: stats.peakRatio
    };
    const insight = { key: 'advice.insight.calWeekday', vars: {
      best: insights.weekdayName(stats.bestDay, ctx.lang), pct: insights.percentOf(stats.bestShare),
      worst: insights.weekdayName(stats.worstDay, ctx.lang), pct2: Math.round(stats.worstShare * 100)
    } };
    return { facts, note: insights.interest.calendar(stats), insight };
  }

  // Miniature : les dernières semaines (colonnes) de sept jours (du lundi au dimanche), chaque case de 0 à 1 sur le plus gros jour AFFICHÉ (un
  // pic d'il y a deux ans ne doit pas pâlir toute la miniature) ; un jour sans ligne = null.
  function previewCalendar(td, rows) {
    const cal = data.calendarDays(rows, td.dimension, td.measure, td.aggFn || 'sum');
    if (!cal.days.length) return null;
    const byDay = new Map(cal.days.map((d) => [d.date, d.value]));
    const last = insights.dayNumber(cal.to);
    const mondayOfLast = last - ((insights.weekdayOf(cal.to) + 6) % 7);
    const iso = (n) => data.isoDayShift('1970-01-01', n);
    const weeks = [];
    for (let w = PREVIEW_WEEKS - 1; w >= 0; w--) {
      const start = mondayOfLast - 7 * w;
      weeks.push(Array.from({ length: 7 }, (_, d) => { const v = byDay.get(iso(start + d)); return v === undefined ? null : Math.max(0, v); }));
    }
    const top = Math.max.apply(null, [].concat.apply([], weeks).filter((v) => v !== null));
    if (!(top > 0)) return null;
    return { kind: 'calendar', weeks: weeks.map((week) => week.map((v) => (v === null ? null : v / top))) };
  }

  // ---------------------------------------------------------------------------------------------
  // Planning (Gantt)
  // ---------------------------------------------------------------------------------------------

  // Les tâches d'un planning ou null : deux colonnes de dates dont le NOM dit un début ou une fin, quelques dizaines de tâches valables.
  function ganttView(rows, ctx, core) {
    if (ctx.profiles.filter((p) => p.role === 'time').length < 2 || rows.length > GANTT_MAX_ROWS_SCANNED) return null;
    const d = core.defaultsFor('gantt', rows, ctx);
    if (!d || !d.startColumn || !d.endColumn || !(START_NAME_RE.test(d.startColumn) || END_NAME_RE.test(d.endColumn))) return null;
    const result = data.ganttTasks(rows, d.dimension, d.startColumn, d.endColumn, d.seriesColumn, Infinity);
    const seen = result.total + result.ignored;
    if (result.total < GANTT_MIN_TASKS || result.total > GANTT_MAX_TASKS || (seen > 0 && result.ignored / seen > GANTT_MAX_IGNORED_SHARE)) return null;
    const stats = insights.ganttStats(result.tasks);
    return stats && stats.spanDays >= GANTT_MIN_SPAN_DAYS ? { d, result, stats } : null;
  }

  function ganttCandidates(rows, ctx, opts, core) {
    const view = ganttView(rows, ctx, core);
    if (!view) return [];
    const { d } = view;
    const vars = { dimension: d.dimension };
    const tileData = { type: 'gantt', dimension: d.dimension, startColumn: d.startColumn, endColumn: d.endColumn,
      title: core.resolveTitle(opts, 'tileTitle.gantt', vars, d.dimension) };
    if (d.seriesColumn) tileData.seriesColumn = d.seriesColumn;
    return [core.candidate({
      type: 'gantt',
      score: 7,
      dims: [d.dimension],
      measures: [],
      tileData,
      titleKey: 'tileTitle.gantt',
      titleVars: vars,
      reasonKey: 'advice.reason.gantt',
      reasonVars: { start: d.startColumn, end: d.endColumn }
    })];
  }

  function annotateGantt(td, ctx) {
    const result = data.ganttTasks(ctx.insightRows, td.dimension, td.startColumn, td.endColumn, td.seriesColumn, Infinity);
    const stats = insights.ganttStats(result.tasks);
    if (!stats) return null;
    const vars = { n: stats.n, days: stats.spanDays, name: stats.longestName, d: stats.longestDays, k: stats.overlap };
    return {
      facts: { tasks: stats.n, spanDays: stats.spanDays, longest: stats.longestName, longestDays: stats.longestDays, medianDays: stats.medianDays, overlap: stats.overlap },
      note: insights.interest.gantt(stats),
      insight: { key: stats.overlap >= 3 && stats.overlap / stats.n >= 0.3 ? 'advice.insight.ganttOverlap' : 'advice.insight.ganttSpan', vars }
    };
  }

  // Miniature : les premières tâches (triées par début) en barres `{ left, width }` de 0 à 1 sur l'étendue du planning.
  function previewGantt(td, rows) {
    const result = data.ganttTasks(rows, td.dimension, td.startColumn, td.endColumn, td.seriesColumn, PREVIEW_TASKS * 4);
    const tasks = result.tasks.slice(0, PREVIEW_TASKS);
    if (tasks.length < 2) return null;
    const lo = Math.min.apply(null, tasks.map((t) => insights.dayNumber(t.start)));
    const hi = Math.max.apply(null, tasks.map((t) => insights.dayNumber(t.end))) + 1;
    if (!(hi > lo)) return null;
    return { kind: 'gantt', bars: tasks.map((t) => {
      const s = insights.dayNumber(t.start);
      const e = insights.dayNumber(t.end) + 1;
      return { left: (s - lo) / (hi - lo), width: Math.max(0.04, (e - s) / (hi - lo)) };
    }) };
  }

  // ---------------------------------------------------------------------------------------------
  // Contrat commun
  // ---------------------------------------------------------------------------------------------

  const BUILDERS = [calendarCandidates, ganttCandidates];

  function candidates(rows, ctx, opts, core) {
    const out = [];
    BUILDERS.forEach((build) => {
      try { out.push.apply(out, build(rows, ctx, opts, core)); } catch (e) { /* ce type n'est pas proposé, les autres le sont */ }
    });
    return out;
  }

  function annotate(c, ctx, core) {
    if (HANDLED.indexOf(c.type) === -1) return null;
    return c.type === 'calendar' ? annotateCalendar(c.tileData, ctx) : annotateGantt(c.tileData, ctx);
  }

  function previewFor(tileData, rows) {
    if (!tileData || !Array.isArray(rows) || !rows.length) return null;
    try {
      if (tileData.type === 'calendar') return previewCalendar(tileData, rows);
      if (tileData.type === 'gantt') return previewGantt(tileData, rows);
    } catch (e) { /* pas de miniature */ }
    return null;
  }

  return {
    INTENT_BY_TYPE, HANDLED, START_NAME_RE, END_NAME_RE, CALENDAR_MIN_DAYS, CALENDAR_WEEKDAY_SAYS, CALENDAR_MIN_ETA2,
    GANTT_MIN_TASKS, GANTT_MAX_TASKS, GANTT_MIN_SPAN_DAYS, candidates, annotate, previewFor
  };
});
