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
    interest, formatNumber, formatCorrelation, percentOf
  };
});
