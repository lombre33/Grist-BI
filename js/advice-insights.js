/*
 * Chiffres qui rendent une suggestion de tuile INTÉRESSANTE et qui la justifient (niveau 2 de l'intelligence des suggestions,
 * 25/11/2026) : pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-insights.js), AUCUNE dépendance — js/advice.js
 * le reçoit (`GristBI.adviceInsights` dans un navigateur, `require` sous Node) et js/advice-types.js aussi.
 *
 * Deux sortes de fonctions :
 *  - des STATISTIQUES (`shareStats`, `spreadStats`, `trendStats`, `correlationStats`, `outlierStats`, `skewStats`, `paretoStats`,
 *    `distributionStats`, `waterfallStats`, `funnelStats`, `boxGapStats`) : elles
 *    prennent des groupes `[{ dimension, value }]` (la forme de `data.groupByAggregate`) ou des listes de nombres, et rendent des
 *    NOMBRES (jamais une phrase) ou `null` quand les données ne permettent pas de conclure ; une valeur vide, absente ou non finie
 *    est toujours IGNORÉE, jamais comptée pour 0 ;
 *  - des NOTES D'INTÉRÊT (`interest.*`, de 0 à 1) : « ce graphique montre-t-il quelque chose ? ». 0 = rien à voir (des barres toutes
 *    égales, un nuage sans lien), 1 = frappant. js/advice.js en tire le score d'une suggestion à la place du score fixe par type.
 *
 * Toutes les statistiques sont ÉCHELLE-NEUTRES (parts, rapports, pourcentages de variation, corrélations) : js/advice.js les calcule
 * sur un échantillon réparti de la table quand elle dépasse 20 000 lignes, et ne dit jamais un total qu'un échantillon fausserait.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceInsights = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Un nombre fini, ou null : vide, texte, booléen, NaN ou infini ne sont jamais un nombre ici. `BigInt` (DuckDB) est accepté.
  function finite(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function sum(values) { let s = 0; for (const v of values) s += v; return s; }
  function mean(values) { return values.length ? sum(values) / values.length : null; }

  // Quantile par interpolation linéaire (« type 7 » : QUARTILE.INC d'Excel, quantile_cont de DuckDB), sur une liste DÉJÀ triée.
  function quantileSorted(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Les groupes dont la valeur est un vrai nombre : `[{ name, value }]` (le nom en chaîne).
  function numericGroups(groups) {
    return (Array.isArray(groups) ? groups : [])
      .map((g) => ({ name: String(g.dimension), value: finite(g.value) }))
      .filter((g) => g.value !== null);
  }

  // ---------------------------------------------------------------------------------------------
  // Statistiques
  // ---------------------------------------------------------------------------------------------

  // Qui pèse combien dans le total. Des parts n'ont de sens que pour des valeurs POSITIVES qui s'additionnent : une seule valeur
  // négative ou nulle ôte tout le calcul (null), jamais une part « de 120 % ». Au moins 2 groupes.
  function shareStats(groups) {
    const list = numericGroups(groups);
    if (list.length < 2 || list.some((g) => g.value <= 0)) return null;
    const sorted = list.slice().sort((a, b) => b.value - a.value);
    const total = sum(sorted.map((g) => g.value));
    const n = sorted.length;
    const topShare = sorted[0].value / total;
    const equalShare = 1 / n;
    return {
      n,
      topName: sorted[0].name,
      topShare,
      top3Share: sum(sorted.slice(0, 3).map((g) => g.value)) / total,
      equalShare,
      // 0 = toutes les parts égales, 1 = un seul groupe porte tout.
      excess: (topShare - equalShare) / (1 - equalShare),
      names: sorted.map((g) => g.name)
    };
  }

  // Écart entre les groupes : plus grande et plus petite valeur, leur rapport, coefficient de variation (écart-type / |moyenne|).
  function spreadStats(groups) {
    const list = numericGroups(groups);
    if (list.length < 2) return null;
    const values = list.map((g) => g.value);
    const m = mean(values);
    const variance = sum(values.map((v) => (v - m) * (v - m))) / values.length;
    const sorted = list.slice().sort((a, b) => a.value - b.value);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    return {
      n: list.length,
      mean: m,
      minName: lo.name,
      minValue: lo.value,
      maxName: hi.name,
      maxValue: hi.value,
      // Le rapport n'a de sens que si la plus petite valeur est positive.
      ratio: lo.value > 0 ? hi.value / lo.value : null,
      cv: m !== 0 ? Math.sqrt(variance) / Math.abs(m) : null
    };
  }

  // Évolution d'une série dans l'ordre : droite de tendance (pente en % de la moyenne par pas, R²) et variation entre le début et la
  // fin — la moyenne du premier tiers contre celle du dernier tiers, jamais deux points isolés (la dernière période est souvent
  // partielle). `changePct` est null quand le début vaut 0 (variation infinie). Au moins 2 valeurs.
  function trendStats(values) {
    const ys = (Array.isArray(values) ? values : []).map(finite).filter((v) => v !== null);
    const n = ys.length;
    if (n < 2) return null;
    const edge = Math.max(1, Math.floor(n / 3));
    const first = mean(ys.slice(0, edge));
    const last = mean(ys.slice(n - edge));
    const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
    let r2 = null;
    let slopePct = null;
    if (n >= 3) {
      const mx = (n - 1) / 2;
      const my = mean(ys);
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      ys.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) * (i - mx); syy += (y - my) * (y - my); });
      r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
      slopePct = my !== 0 ? (sxy / sxx / Math.abs(my)) * 100 : null;
    }
    const direction = changePct === null ? (last > first ? 'up' : (last < first ? 'down' : 'flat'))
      : (Math.abs(changePct) < 5 ? 'flat' : (changePct > 0 ? 'up' : 'down'));
    return { n, first, last, changePct, slopePct, r2, direction };
  }

  // Corrélation de Pearson entre deux listes de même longueur (les paires incomplètes sont écartées). Au moins 6 paires, et aucune
  // des deux colonnes constante.
  function correlationStats(xs, ys) {
    const pairs = [];
    const len = Math.min((xs || []).length, (ys || []).length);
    for (let i = 0; i < len; i++) {
      const x = finite(xs[i]);
      const y = finite(ys[i]);
      if (x !== null && y !== null) pairs.push([x, y]);
    }
    if (pairs.length < 6) return null;
    const mx = mean(pairs.map((p) => p[0]));
    const my = mean(pairs.map((p) => p[1]));
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); syy += (y - my) * (y - my); });
    if (!(sxx > 0) || !(syy > 0)) return null;
    return { n: pairs.length, r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) };
  }

  // Valeurs aberrantes au sens de Tukey (au-delà de 1,5 x l'écart interquartile). Au moins 8 valeurs ; un écart interquartile nul
  // (presque toutes égales) déclare toute autre valeur aberrante, comme la boîte à moustaches de l'application.
  function outlierStats(values) {
    const xs = (Array.isArray(values) ? values : []).map(finite).filter((v) => v !== null).sort((a, b) => a - b);
    if (xs.length < 8) return null;
    const q1 = quantileSorted(xs, 0.25);
    const q3 = quantileSorted(xs, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const count = xs.filter((v) => v < lo || v > hi).length;
    return { n: xs.length, count, share: count / xs.length, q1, q3, iqr, median: quantileSorted(xs, 0.5) };
  }

  // Asymétrie de la distribution (coefficient de Fisher-Pearson) : 0 = symétrique, > 1 = longue queue à droite (quelques très
  // grandes valeurs). Au moins 8 valeurs, non constantes.
  function skewStats(values) {
    const xs = (Array.isArray(values) ? values : []).map(finite).filter((v) => v !== null);
    if (xs.length < 8) return null;
    const m = mean(xs);
    const m2 = sum(xs.map((v) => (v - m) * (v - m))) / xs.length;
    if (!(m2 > 0)) return null;
    const m3 = sum(xs.map((v) => Math.pow(v - m, 3))) / xs.length;
    return { n: xs.length, skew: m3 / Math.pow(m2, 1.5) };
  }

  // Loi de Pareto : quelle part du total portent les 20 % de groupes les plus gros, et combien de groupes font 80 % du total.
  // Des valeurs POSITIVES seulement ; au moins 5 groupes.
  function paretoStats(groups) {
    const list = numericGroups(groups);
    // Un groupe à 0 existe mais ne pèse rien (un client sans vente) : il compte dans n. Un négatif n'a pas de part cumulée qui ait un sens.
    if (list.length < 5 || list.some((g) => g.value < 0)) return null;
    const sorted = list.slice().sort((a, b) => b.value - a.value);
    const total = sum(sorted.map((g) => g.value));
    if (!(total > 0)) return null;
    const n = sorted.length;
    const topCount = Math.max(1, Math.ceil(n * 0.2));
    let running = 0;
    let countFor80 = n;
    for (let i = 0; i < n; i++) {
      running += sorted[i].value;
      if (running / total >= 0.8) { countFor80 = i + 1; break; }
    }
    return {
      n, topCount, topShare: sum(sorted.slice(0, topCount).map((g) => g.value)) / total,
      countFor80, shareOfGroupsFor80: countFor80 / n, topName: sorted[0].name
    };
  }


  // Une colonne numérique d'un coup d'oeil : moyenne, médiane, asymétrie et part de valeurs aberrantes (Tukey). Au moins 8 valeurs,
  // non constantes. Sert à dire pourquoi un histogramme vaut le coup d'oeil (« la moyenne dépasse nettement la médiane »).
  function distributionStats(values) {
    const xs = (Array.isArray(values) ? values : []).map(finite).filter((v) => v !== null);
    const skew = skewStats(xs);
    const outliers = outlierStats(xs);
    if (!skew || !outliers) return null;
    return { n: xs.length, mean: mean(xs), median: outliers.median, skew: skew.skew, outlierCount: outliers.count, outlierShare: outliers.share };
  }

  // Cascade : ce que les hausses (groupes positifs) et les baisses (groupes négatifs) ajoutent et retirent. Il faut au moins 3 groupes ET
  // des signes mêlés : sans baisse (ou sans hausse) une cascade n'est qu'un cumul. `offset` = baisses / hausses (1 = elles s'annulent).
  function waterfallStats(groups) {
    const list = numericGroups(groups);
    if (list.length < 3) return null;
    const ups = list.filter((g) => g.value > 0);
    const downs = list.filter((g) => g.value < 0);
    if (!ups.length || !downs.length) return null;
    const gain = sum(ups.map((g) => g.value));
    const loss = -sum(downs.map((g) => g.value));
    const biggestUp = ups.reduce((a, b) => (b.value > a.value ? b : a));
    const biggestDown = downs.reduce((a, b) => (b.value < a.value ? b : a));
    return { n: list.length, ups: ups.length, downs: downs.length, gain, loss, net: gain - loss, offset: loss / gain, biggestUpName: biggestUp.name, biggestDownName: biggestDown.name };
  }

  // Entonnoir : des étapes de taille décroissante (valeurs POSITIVES, au moins 3). `keep` = ce qui reste de la plus grande étape à la plus
  // petite ; `worst` = la plus forte baisse d'une étape à la suivante, en % de l'étape qui précède.
  function funnelStats(groups) {
    const list = numericGroups(groups);
    if (list.length < 3 || list.some((g) => g.value <= 0)) return null;
    const sorted = list.slice().sort((a, b) => b.value - a.value);
    let worst = null;
    for (let i = 1; i < sorted.length; i++) {
      const dropPct = (1 - sorted[i].value / sorted[i - 1].value) * 100;
      if (!worst || dropPct > worst.dropPct) worst = { from: sorted[i - 1].name, to: sorted[i].name, dropPct };
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return { n: sorted.length, firstName: first.name, lastName: last.name, keep: last.value / first.value, ratio: first.value / last.value, worst };
  }

  // Boîtes à moustaches : groupes `[{ name, n, median, q1, q3, outlierCount }]` (la forme que rend data.boxStatsByGroup). Les groupes de
  // moins de `minN` valeurs n'ont pas de quartiles parlants : ils ne comptent pas. `gapIqr` = écart entre la plus haute et la plus basse
  // médiane, en écarts interquartiles moyens (null quand tous les groupes ont un écart nul) ; `outlierShare` = valeurs aberrantes / valeurs.
  function boxGapStats(groups, minN) {
    const need = minN === undefined ? 5 : minN;
    const list = (Array.isArray(groups) ? groups : []).filter((g) => g && g.n >= need && finite(g.median) !== null);
    if (list.length < 2) return null;
    const sorted = list.slice().sort((a, b) => a.median - b.median);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const meanIqr = mean(list.map((g) => g.q3 - g.q1));
    const values = sum(list.map((g) => g.n));
    const outliers = sum(list.map((g) => g.outlierCount || 0));
    const worst = list.reduce((a, b) => ((b.outlierCount || 0) > (a.outlierCount || 0) ? b : a));
    return {
      n: list.length, lowName: lo.name, lowMedian: lo.median, highName: hi.name, highMedian: hi.median,
      gapIqr: meanIqr > 0 ? (hi.median - lo.median) / meanIqr : null,
      outlierShare: values ? outliers / values : 0, outlierCount: outliers, outlierName: outliers > 0 ? worst.name : null
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Dates, planning, croisements, hiérarchies, objectifs (niveau 2c)
  // ---------------------------------------------------------------------------------------------

  const MS_PER_DAY = 86400000;

  // Numéro du jour (jours depuis l'époque) d'une date ISO 'AAAA-MM-JJ', ou null. Aucune horloge, aucun fuseau : Date.UTC seulement.
  function dayNumber(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? Math.round(t / MS_PER_DAY) : null;
  }

  // Jour de la semaine d'une date ISO (0 = dimanche), ou null. Le 1er janvier 1970 était un jeudi.
  function weekdayOf(iso) {
    const n = dayNumber(iso);
    return n === null ? null : (((n + 4) % 7) + 7) % 7;
  }

  // Calendrier : le jour de la semaine le plus chargé et le plus calme (moyenne par jour de la semaine, en part de la semaine), et le jour
  // le plus haut face à un jour ordinaire. `days` = [{ date, value }] (un jour par ligne, comme data.calendarDays), au moins 28 jours,
  // valeurs jamais négatives (une part négative n'a pas de sens). Avec `additive` (somme, comptage) un jour de la période sans ligne vaut
  // 0 (rien ne s'est passé) ; sinon (une moyenne) seuls les jours qui ont une valeur comptent. Un jour de la semaine sans AUCUN jour de
  // valeur (le week-end d'une activité de bureau) est `emptyWorst` : sa moyenne est 0, `ratio` est alors null et `activeRatio` compare
  // le plus chargé au plus calme des jours qui ont de l'activité. `eta2` (de 0 à 1) = la part de la variation des valeurs journalières que
  // le jour de la semaine explique (rapport de corrélation) : sur des jours sans lien avec la semaine il vaut environ 6 / (nombre de jours),
  // soit moins de 0,02 sur une année ; c'est lui qui dit qu'un écart de moyennes n'est pas un hasard (un rapport de 2 entre deux jours peut
  // sortir de quelques ventes réparties au hasard).
  function calendarStats(days, options) {
    const additive = !options || options.additive !== false;
    const list = (days || []).map((d) => ({ date: d.date, value: finite(d.value), wd: weekdayOf(d.date) })).filter((d) => d.value !== null && d.wd !== null);
    if (list.length < 28 || list.some((d) => d.value < 0)) return null;
    const sums = [0, 0, 0, 0, 0, 0, 0];
    const present = [0, 0, 0, 0, 0, 0, 0];
    list.forEach((d) => { sums[d.wd] += d.value; present[d.wd]++; });
    const occurrences = [0, 0, 0, 0, 0, 0, 0];
    const first = dayNumber(list[0].date);
    const last = dayNumber(list[list.length - 1].date);
    for (let n = first; n <= last; n++) occurrences[(((n + 4) % 7) + 7) % 7]++;
    const means = sums.map((v, i) => { const base = additive ? occurrences[i] : present[i]; return base > 0 ? v / base : 0; });
    const total = sum(means);
    if (!(total > 0)) return null;
    let best = 0;
    let worst = 0;
    means.forEach((m, i) => { if (m > means[best]) best = i; if (m < means[worst]) worst = i; });
    // Rapport de corrélation : la variation entre jours de la semaine face à la variation totale, sur les jours de la période (un jour sans
    // ligne compte pour 0 quand on additionne, il est absent sinon).
    const byDay = new Map(list.map((d) => [dayNumber(d.date), d.value]));
    const series = [];
    if (additive) { for (let n = first; n <= last; n++) series.push([(((n + 4) % 7) + 7) % 7, byDay.get(n) || 0]); } else { list.forEach((d) => series.push([d.wd, d.value])); }
    const grand = sum(series.map((e) => e[1])) / series.length;
    const ssTotal = sum(series.map((e) => (e[1] - grand) * (e[1] - grand)));
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const totals = [0, 0, 0, 0, 0, 0, 0];
    series.forEach((e) => { counts[e[0]]++; totals[e[0]] += e[1]; });
    const ssBetween = sum(counts.map((c, i) => (c > 0 ? c * Math.pow(totals[i] / c - grand, 2) : 0)));
    const positive = means.filter((m) => m > 0);
    const activeLow = Math.min.apply(null, positive);
    const values = list.map((d) => d.value).sort((a, b) => a - b);
    const median = quantileSorted(values, 0.5);
    const peak = list.reduce((a, b) => (b.value > a.value ? b : a));
    return {
      n: list.length, bestDay: best, worstDay: worst, bestShare: means[best] / total, worstShare: means[worst] / total,
      emptyWorst: means[worst] === 0, ratio: means[worst] > 0 ? means[best] / means[worst] : null, activeRatio: means[best] / activeLow,
      eta2: ssTotal > 0 ? ssBetween / ssTotal : 0,
      peakDate: peak.date, peakValue: peak.value, peakRatio: median > 0 ? peak.value / median : null, median
    };
  }

  // Planning : combien de tâches, sur quelle durée, la plus longue, et combien se déroulent en même temps au plus. `tasks` = [{ label, start, end }]
  // en dates ISO (data.ganttTasks) ; au moins 3 tâches valides (une fin avant le début n'en est pas une).
  function ganttStats(tasks) {
    const list = (tasks || []).map((t) => ({ label: String(t.label), s: dayNumber(t.start), e: dayNumber(t.end) })).filter((t) => t.s !== null && t.e !== null && t.e >= t.s);
    if (list.length < 3) return null;
    const durations = list.map((t) => t.e - t.s + 1);
    const longest = list.reduce((a, b) => ((b.e - b.s) > (a.e - a.s) ? b : a));
    const events = [];
    list.forEach((t) => { events.push([t.s, 1]); events.push([t.e + 1, -1]); });
    events.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])); // à jour égal, une fin libère la place avant qu'un début la prenne
    let running = 0;
    let overlap = 0;
    events.forEach((e) => { running += e[1]; if (running > overlap) overlap = running; });
    const min = Math.min.apply(null, list.map((t) => t.s));
    const max = Math.max.apply(null, list.map((t) => t.e));
    return {
      n: list.length, spanDays: max - min + 1, longestName: longest.label, longestDays: longest.e - longest.s + 1,
      medianDays: quantileSorted(durations.slice().sort((a, b) => a - b), 0.5), overlap
    };
  }

  // Croisement : la case dont la valeur dépasse le plus ce que donneraient deux colonnes sans lien (« attendu » = total de la ligne x total
  // de la colonne / total général). `cells` = [{ row, col, value }], valeurs jamais négatives, au moins 3 lignes et 3 colonnes ; une case
  // dont l'attendu est sous 2 % du total n'est pas comparée (trop petite pour dire quoi que ce soit). `rowCount` (facultatif) = le nombre de
  // lignes derrière les cases : il donne `chi2` (khi-deux d'indépendance, calculé sur les parts, donc pour toute mesure qui s'additionne),
  // `df` (degrés de liberté) et `v` (V de Cramér, de 0 à 1) ; `significant` dit que le khi-deux dépasse 4 écarts-types au-dessus de ce
  // que des colonnes sans lien donnent en moyenne (`df + 4 x racine(2 df)`) : sans cela, quelques dizaines de lignes tirées au hasard
  // « montrent » une case chaude.
  function heatLiftStats(cells, rowCount) {
    const list = (cells || []).map((c) => ({ row: String(c.row), col: String(c.col), value: finite(c.value) })).filter((c) => c.value !== null);
    if (list.some((c) => c.value < 0)) return null;
    const rowSum = new Map();
    const colSum = new Map();
    list.forEach((c) => { rowSum.set(c.row, (rowSum.get(c.row) || 0) + c.value); colSum.set(c.col, (colSum.get(c.col) || 0) + c.value); });
    const total = sum(Array.from(rowSum.values()));
    if (rowSum.size < 3 || colSum.size < 3 || !(total > 0)) return null;
    let best = null;
    list.forEach((c) => {
      const expected = rowSum.get(c.row) * colSum.get(c.col) / total;
      if (!(expected / total >= 0.02)) return;
      const lift = c.value / expected;
      if (!best || lift > best.lift) best = { row: c.row, col: c.col, lift, share: c.value / total };
    });
    if (!best) return null;
    let phi2 = 0;
    list.forEach((c) => {
      const expected = rowSum.get(c.row) * colSum.get(c.col) / (total * total);
      phi2 += Math.pow(c.value / total - expected, 2) / expected;
    });
    // Les cases absentes (aucune ligne) comptent pour 0 : leur écart à l'attendu fait partie du khi-deux.
    const seen = new Set(list.map((c) => `${c.row}\u0001${c.col}`));
    rowSum.forEach((rs, row) => colSum.forEach((cs, col) => { if (!seen.has(`${row}\u0001${col}`)) phi2 += rs * cs / (total * total); }));
    const df = (rowSum.size - 1) * (colSum.size - 1);
    const n = finite(rowCount);
    const chi2 = n !== null && n > 0 ? phi2 * n : null;
    return {
      rows: rowSum.size, cols: colSum.size, maxLift: best.lift, row: best.row, col: best.col, cellShare: best.share,
      v: Math.sqrt(phi2 / Math.min(rowSum.size - 1, colSum.size - 1)), chi2, df,
      significant: chi2 !== null && chi2 >= df + 4 * Math.sqrt(2 * df)
    };
  }

  // Hiérarchie : la part du dehors la plus grosse et, dans elle, la plus grosse sous-part. `roots` = [{ name, value, children: [{ name, value }] }]
  // (data.sunburstTree) ; au moins 2 parts au dehors, des valeurs positives.
  function hierarchyStats(roots) {
    const parents = (roots || []).map((r) => ({
      name: String(r.name), value: finite(r.value),
      children: (r.children || []).map((c) => ({ name: String(c.name), value: finite(c.value) })).filter((c) => c.value !== null && c.value > 0)
    })).filter((p) => p.value !== null && p.value > 0);
    if (parents.length < 2) return null;
    const total = sum(parents.map((p) => p.value));
    const top = parents.reduce((a, b) => (b.value > a.value ? b : a));
    const topChild = top.children.length ? top.children.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    return {
      parents: parents.length, parts: sum(parents.map((p) => p.children.length)), topName: top.name, topShare: top.value / total,
      topChildName: topChild ? topChild.name : null, topChildShare: topChild ? topChild.value / top.value : null
    };
  }

  // Objectif : l'atteinte globale (somme des valeurs / somme des objectifs), la catégorie la plus en retard et la plus avancée, en %.
  // `rows` = [{ name, value, target }] ; un objectif nul, négatif ou absent n'a pas de pourcentage (ligne ignorée) ; au moins 2 lignes.
  function progressStats(rows) {
    const list = (rows || []).map((r) => ({ name: String(r.name), value: finite(r.value), target: finite(r.target) })).filter((r) => r.value !== null && r.target !== null && r.target > 0);
    if (list.length < 2) return null;
    const withPct = list.map((r) => Object.assign({ pct: r.value / r.target * 100 }, r));
    const low = withPct.reduce((a, b) => (b.pct < a.pct ? b : a));
    const high = withPct.reduce((a, b) => (b.pct > a.pct ? b : a));
    return {
      n: list.length, overall: sum(list.map((r) => r.value)) / sum(list.map((r) => r.target)),
      lowName: low.name, lowPct: low.pct, highName: high.name, highPct: high.pct,
      behind: withPct.filter((r) => r.pct < 90).length, ahead: withPct.filter((r) => r.pct >= 100).length
    };
  }

  // Atteinte d'un objectif unique : somme des valeurs / somme des objectifs, ou null (aucun objectif positif).
  function goalReach(values, targets) {
    const v = (values || []).map(finite).filter((x) => x !== null);
    const t = (targets || []).map(finite).filter((x) => x !== null);
    const target = sum(t);
    return v.length && t.length && target > 0 ? sum(v) / target : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Notes d'intérêt (0 à 1)
  // ---------------------------------------------------------------------------------------------

  const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

  const interest = {
    // Barres : des groupes très différents ou dominés par un seul se lisent ; des groupes égaux ne disent rien.
    compare(share, spread) {
      const fromShare = share ? clamp01(share.excess * 1.3) : 0;
      const fromSpread = spread && spread.cv !== null ? clamp01(spread.cv / 0.9) : 0;
      return clamp01(Math.max(fromShare, fromSpread));
    },
    // Parts : une part dominante ou un net classement ; des parts égales font un anneau sans histoire.
    share(share) {
      return share ? clamp01(share.excess * 1.5) : 0;
    },
    // Courbe : une tendance nette (droite bien ajustée ET variation d'au moins 30 %) ; une série plate ou en dents de scie, non.
    trend(trend) {
      if (!trend) return 0;
      const change = trend.changePct === null ? 1 : clamp01(Math.abs(trend.changePct) / 30);
      return clamp01((trend.r2 === null ? 0.5 : trend.r2) * change);
    },
    // Nuage de points : la force du lien (|r|), dans un sens comme dans l'autre.
    relation(correlation) {
      return correlation ? clamp01(Math.abs(correlation.r)) : 0;
    },
    // Radar : un profil irrégulier (points forts et faibles) se lit ; un polygone régulier est un cercle. Jamais en dessous de 0,3 : un
    // radar sur une famille de notes reste le bon outil même quand les moyennes se ressemblent.
    profile(spread) {
      return spread && spread.cv !== null ? clamp01(0.3 + spread.cv / 0.35) : 0.3;
    },
    // Distribution : une asymétrie ou des valeurs aberrantes valent le coup d'oeil.
    distribution(skew, outliers) {
      const fromSkew = skew ? clamp01(Math.abs(skew.skew) / 2) : 0;
      const fromOutliers = outliers ? clamp01(outliers.share * 10) : 0;
      return clamp01(Math.max(fromSkew, fromOutliers, 0.25));
    },
    // Pareto : quelques groupes portent presque tout (20 % des groupes pour 80 % du total = 1) ; si presque tous sont nécessaires pour
    // atteindre 80 %, rien n'est concentré (0).
    pareto(pareto) {
      return pareto ? clamp01((0.8 - pareto.shareOfGroupsFor80) / 0.6) : 0;
    },
    // Cascade : des hausses et des baisses de poids comparable se compensent (c'est ce que le graphique montre) ; une seule petite baisse
    // dans un mur de hausses n'a presque rien à dire.
    waterfall(waterfall) {
      if (!waterfall) return 0;
      const ratio = Math.min(waterfall.gain, waterfall.loss) / Math.max(waterfall.gain, waterfall.loss);
      return clamp01(0.15 + 0.85 * ratio);
    },
    // Entonnoir : une marche franche (la moitié perdue d'une étape à l'autre) se voit ; des étapes de taille égale, non.
    funnel(funnel) {
      return funnel && funnel.worst ? clamp01(0.2 + 0.8 * clamp01(funnel.worst.dropPct / 50)) : 0;
    },
    // Boîtes : des groupes bien séparés (écart de médianes de deux écarts interquartiles) ou des valeurs aberrantes (10 % = max).
    box(gap) {
      if (!gap) return 0;
      const fromGap = gap.gapIqr === null ? 0 : clamp01(gap.gapIqr / 2);
      return clamp01(Math.max(fromGap, clamp01(gap.outlierShare * 10), 0.15));
    },
    // Calendrier : la part de la variation que le jour de la semaine explique (le quart = plein), un jour sans aucune activité (0,4), un pic
    // qui vaut plusieurs jours ordinaires (8 fois = demi-note : un pic isolé n'est pas un rythme).
    calendar(cal) {
      if (!cal) return 0;
      const fromWeekday = clamp01(cal.eta2 / 0.25);
      const fromEmpty = cal.emptyWorst && cal.eta2 >= 0.05 ? 0.4 : 0;
      const fromPeak = cal.peakRatio === null ? 0 : clamp01((cal.peakRatio - 2) / 6) * 0.5;
      return clamp01(Math.max(fromWeekday, fromEmpty, fromPeak));
    },
    // Planning : plus de tâches menées en parallèle et une tâche qui s'étire loin devant les autres = plus à lire ; trois tâches bout à
    // bout ne disent presque rien. Jamais sous 0,3 : un planning est le bon outil pour deux colonnes de dates.
    gantt(gantt) {
      if (!gantt) return 0;
      const parallel = clamp01((gantt.overlap - 1) / Math.max(1, gantt.n - 1));
      const stretch = gantt.medianDays > 0 ? clamp01((gantt.longestDays / gantt.medianDays - 1) / 4) : 0;
      return clamp01(0.3 + 0.5 * parallel + 0.2 * stretch);
    },
    // Croisement : une case qui pèse deux fois ce que le hasard donnerait = 0,5 ; trois fois = plein.
    heat(heat) {
      return heat ? clamp01((heat.maxLift - 1) / 2) : 0;
    },
    // Hiérarchie : une part du dehors qui domine (un anneau déséquilibré se lit) ; des parts égales font un soleil sans histoire.
    hierarchy(hier) {
      if (!hier) return 0;
      const even = 1 / hier.parents;
      return clamp01(0.25 + 0.75 * clamp01((hier.topShare - even) / (1 - even)));
    },
    // Objectif : un écart entre la catégorie la plus en retard et la plus avancée (100 points d'écart = plein) ; un objectif atteint
    // partout n'a rien à signaler (0,3 : la progression reste le bon outil pour suivre un objectif).
    progress(progress) {
      return progress ? clamp01(0.3 + 0.7 * clamp01((progress.highPct - progress.lowPct) / 100)) : 0;
    },
    // Chiffre clé face à son objectif : loin de 100 % (en retard ou en avance) se dit ; pile dessus, un peu moins.
    goal(reach) {
      return reach === null ? 0 : clamp01(0.4 + Math.abs(1 - reach));
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Formats
  // ---------------------------------------------------------------------------------------------

  const formatters = {};
  // Un nombre écrit à la manière de la langue (virgule en français, point en anglais), au plus `digits` décimales, sans zéro de fin.
  function formatNumber(x, lang, digits) {
    const n = finite(x);
    if (n === null) return '';
    const key = (lang === 'en' ? 'en' : 'fr') + ':' + digits;
    if (!formatters[key]) formatters[key] = new Intl.NumberFormat(lang === 'en' ? 'en' : 'fr', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    return formatters[key].format(n);
  }

  const nameFormatters = {};
  // Nom d'un jour de la semaine (0 = dimanche) dans la langue : « mardi », « Tuesday ». Intl seulement, aucune horloge.
  function weekdayName(index, lang) {
    const l = lang === 'en' ? 'en' : 'fr';
    if (!nameFormatters['w' + l]) nameFormatters['w' + l] = new Intl.DateTimeFormat(l, { weekday: 'long', timeZone: 'UTC' });
    return nameFormatters['w' + l].format(Date.UTC(2024, 0, 7 + (((index % 7) + 7) % 7))); // le 7 janvier 2024 était un dimanche
  }

  // Un jour ISO écrit en toutes lettres dans la langue (« 9 avril 2025 », « April 9, 2025 »), ou '' si ce n'est pas une date.
  function formatDay(iso, lang) {
    const n = dayNumber(iso);
    if (n === null) return '';
    const l = lang === 'en' ? 'en' : 'fr';
    if (!nameFormatters['d' + l]) nameFormatters['d' + l] = new Intl.DateTimeFormat(l, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return nameFormatters['d' + l].format(n * MS_PER_DAY);
  }

  // Un coefficient de corrélation à deux décimales, jamais « 1 » pour un lien qui n'est pas parfait (0,997 s'écrit 0,99) : seule une droite
  // exacte vaut ±1. Le signe est gardé (le sens du lien est ce qu'on dit).
  function formatCorrelation(r, lang) {
    const n = finite(r);
    if (n === null) return '';
    const a = Math.abs(n);
    return formatNumber(Math.sign(n) * (a < 1 ? Math.min(a, 0.99) : 1), lang, 2);
  }

  // Pourcentage entier d'une part (0,423 -> 42), jamais 0 ni 100 pour une part qui n'est ni nulle ni totale.
  function percentOf(share) {
    const p = Math.round(share * 100);
    if (share > 0 && p === 0) return 1;
    if (share < 1 && p === 100) return 99;
    return p;
  }

  return {
    finite, quantileSorted, shareStats, spreadStats, trendStats, correlationStats, outlierStats, skewStats, paretoStats,
    distributionStats, waterfallStats, funnelStats, boxGapStats,
    dayNumber, weekdayOf, calendarStats, ganttStats, heatLiftStats, hierarchyStats, progressStats, goalReach,
    interest, formatNumber, formatCorrelation, weekdayName, formatDay, percentOf
  };
});
