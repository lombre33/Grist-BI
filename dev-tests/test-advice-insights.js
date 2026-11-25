/*
 * js/advice-insights.js : les statistiques et les notes d'intérêt qui servent aux suggestions de tuiles, jugées sur des valeurs
 * calculées À LA MAIN (aucune ne dépend de la statistique qu'elle contrôle) :
 *
 *   node dev-tests/test-advice-insights.js
 */
'use strict';
const assert = require('assert');
const I = require('../js/advice-insights.js');

const close = (a, b, eps, label) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${label || ''} : ${a} au lieu de ${b}`);
const groups = (pairs) => pairs.map(([dimension, value]) => ({ dimension, value }));

// finite : jamais un 0 pour une valeur vide.
{
  assert.strictEqual(I.finite(null), null);
  assert.strictEqual(I.finite(undefined), null);
  assert.strictEqual(I.finite(''), null);
  assert.strictEqual(I.finite('abc'), null);
  assert.strictEqual(I.finite(true), null, 'un booléen n\'est pas un nombre');
  assert.strictEqual(I.finite(NaN), null);
  assert.strictEqual(I.finite(Infinity), null);
  assert.strictEqual(I.finite(0), 0);
  assert.strictEqual(I.finite('12.5'), 12.5);
  assert.strictEqual(I.finite(5n), 5, 'BigInt de DuckDB');
  console.log('OK finite — vide, texte, booléen, NaN, infini = null ; 0, texte numérique et BigInt = un nombre');
}

// shareStats : 50 / 30 / 20.
{
  const s = I.shareStats(groups([['a', 50], ['b', 30], ['c', 20]]));
  assert.strictEqual(s.n, 3);
  assert.strictEqual(s.topName, 'a');
  close(s.topShare, 0.5, 1e-12, 'part du premier');
  close(s.top3Share, 1, 1e-12, 'les trois premiers font tout');
  close(s.equalShare, 1 / 3, 1e-12);
  close(s.excess, (0.5 - 1 / 3) / (2 / 3), 1e-12, 'excès sur des parts égales');
  assert.deepStrictEqual(s.names, ['a', 'b', 'c'], 'classé du plus gros au plus petit');
  // Parts égales : excès nul. Un groupe qui porte tout : excès 1.
  close(I.shareStats(groups([['a', 10], ['b', 10], ['c', 10], ['d', 10]])).excess, 0, 1e-12);
  close(I.shareStats(groups([['a', 1000000], ['b', 1]])).excess, 999999 / 1000001, 1e-12, 'un groupe qui porte presque tout');
  // Une valeur négative, nulle ou absente ôte tout calcul de part (jamais « une part de 120 % »).
  assert.strictEqual(I.shareStats(groups([['a', 50], ['b', -5]])), null);
  assert.strictEqual(I.shareStats(groups([['a', 50], ['b', 0]])), null);
  assert.strictEqual(I.shareStats(groups([['a', 50]])), null, 'un seul groupe');
  assert.strictEqual(I.shareStats([]), null);
  assert.strictEqual(I.shareStats(null), null);
  // Une valeur absente est ignorée, pas comptée pour 0 : deux groupes restent.
  const withHole = I.shareStats(groups([['a', 60], ['b', null], ['c', 40]]));
  assert.strictEqual(withHole.n, 2);
  close(withHole.topShare, 0.6);
  // Le nom est toujours une chaîne (une année numérique).
  assert.strictEqual(I.shareStats(groups([[2024, 3], [2025, 1]])).topName, '2024');
  console.log('OK shareStats — 50/30/20, excès, classement, négatif/nul/un seul/vide = null, cellule absente ignorée');
}

// spreadStats : 10, 20, 30.
{
  const s = I.spreadStats(groups([['a', 10], ['b', 20], ['c', 30]]));
  assert.strictEqual(s.n, 3);
  close(s.mean, 20);
  close(s.cv, Math.sqrt(200 / 3) / 20, 1e-12, 'coefficient de variation (écart-type de population)');
  assert.strictEqual(s.maxName, 'c');
  assert.strictEqual(s.minName, 'a');
  close(s.ratio, 3);
  // Plus petite valeur négative : pas de rapport. Moyenne nulle : pas de coefficient.
  assert.strictEqual(I.spreadStats(groups([['a', -5], ['b', 10]])).ratio, null);
  assert.strictEqual(I.spreadStats(groups([['a', -5], ['b', 5]])).cv, null);
  assert.strictEqual(I.spreadStats(groups([['a', 5]])), null);
  close(I.spreadStats(groups([['a', 7], ['b', 7], ['c', 7]])).cv, 0, 1e-12, 'groupes égaux');
  console.log('OK spreadStats — moyenne, coefficient de variation, rapport (seulement si le plus petit est positif)');
}

// trendStats.
{
  const up = I.trendStats([1, 2, 3, 4, 5, 6]);
  assert.strictEqual(up.n, 6);
  close(up.first, 1.5);
  close(up.last, 5.5);
  close(up.changePct, (4 / 1.5) * 100, 1e-9, 'premier tiers contre dernier tiers');
  close(up.r2, 1, 1e-12, 'droite parfaite');
  close(up.slopePct, (1 / 3.5) * 100, 1e-9, 'pente en % de la moyenne par pas');
  assert.strictEqual(up.direction, 'up');
  assert.strictEqual(I.trendStats([6, 5, 4, 3, 2, 1]).direction, 'down');
  // Série plate : changement nul, R² nul (jamais NaN), direction « flat ».
  const flat = I.trendStats([5, 5, 5, 5]);
  assert.strictEqual(flat.changePct, 0);
  assert.strictEqual(flat.r2, 0);
  assert.strictEqual(flat.direction, 'flat');
  // Moins de 5 % : « flat ».
  assert.strictEqual(I.trendStats([100, 101, 102, 103]).direction, 'flat');
  // Deux points seulement : variation directe, pas de R².
  const two = I.trendStats([10, 12]);
  close(two.changePct, 20);
  assert.strictEqual(two.r2, null);
  // Début à zéro : variation infinie = null (jamais Infinity).
  const fromZero = I.trendStats([0, 0, 5, 9]);
  assert.strictEqual(fromZero.changePct, null);
  assert.strictEqual(fromZero.direction, 'up');
  // Une valeur absente est ignorée, pas comptée pour 0.
  assert.strictEqual(I.trendStats([1, null, 2, '', 3]).n, 3);
  assert.strictEqual(I.trendStats([5]), null);
  assert.strictEqual(I.trendStats([]), null);
  // Dents de scie : R² faible.
  close(I.trendStats([1, 9, 1, 9, 1, 9]).r2, 144 / (17.5 * 96), 1e-12, 'dents de scie : R² à la main (somme des produits 12, sxx 17,5, syy 96)');
  console.log('OK trendStats — tiers contre tiers, droite, pente, plate, deux points, début nul, valeurs absentes ignorées');
}

// correlationStats.
{
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  close(I.correlationStats(xs, xs.map((x) => 2 * x + 1)).r, 1, 1e-12);
  close(I.correlationStats(xs, xs.map((x) => -3 * x)).r, -1, 1e-12);
  // Valeur calculée à la main : x = 1..6, y = 2, 1, 4, 3, 6, 5 (moyennes 3,5) : somme des produits d'écarts 14,5 ; sxx = syy = 17,5 -> r = 14,5 / 17,5.
  const r = I.correlationStats([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5]);
  close(r.r, 14.5 / 17.5, 1e-12, 'Pearson');
  assert.strictEqual(r.n, 6);
  assert.strictEqual(I.correlationStats(xs, xs.map(() => 4)), null, 'colonne constante');
  assert.strictEqual(I.correlationStats([1, 2, 3], [1, 2, 3]), null, 'moins de six paires');
  // Les paires incomplètes sont écartées (pas comptées pour 0).
  const holes = I.correlationStats([1, 2, 3, 4, 5, 6, 7, null], [2, 4, null, 8, 10, 12, 14, 99]);
  assert.strictEqual(holes.n, 6);
  close(holes.r, 1, 1e-12);
  console.log('OK correlationStats — ±1, valeur de Pearson à la main, constante/trop court = null, paires incomplètes écartées');
}

// outlierStats.
{
  const o = I.outlierStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.strictEqual(o.n, 10);
  close(o.q1, 3.25);
  close(o.q3, 7.75);
  close(o.iqr, 4.5);
  assert.strictEqual(o.count, 1);
  close(o.share, 0.1);
  assert.strictEqual(I.outlierStats([1, 2, 3, 4, 5, 6, 7, 8]).count, 0);
  assert.strictEqual(I.outlierStats([1, 2, 3]), null, 'moins de huit valeurs');
  // Écart interquartile nul : toute autre valeur est aberrante (comme la boîte à moustaches de l'application).
  assert.strictEqual(I.outlierStats([5, 5, 5, 5, 5, 5, 5, 5, 5, 9]).count, 1);
  console.log('OK outlierStats — Tukey calculé à la main, aucune valeur aberrante, trop court, écart interquartile nul');
}

// skewStats.
{
  close(I.skewStats([1, 2, 3, 4, 5, 6, 7, 8, 9]).skew, 0, 1e-12, 'symétrique');
  assert.ok(I.skewStats([1, 1, 1, 1, 1, 1, 1, 50]).skew > 2, 'longue queue à droite');
  assert.ok(I.skewStats([50, 50, 50, 50, 50, 50, 50, 1]).skew < -2, 'longue queue à gauche');
  assert.strictEqual(I.skewStats([4, 4, 4, 4, 4, 4, 4, 4]), null, 'constante');
  assert.strictEqual(I.skewStats([1, 2]), null);
  console.log('OK skewStats — symétrique 0, queue à droite et à gauche, constante et trop court = null');
}

// formatCorrelation : deux décimales, jamais « 1 » pour un lien imparfait.
{
  assert.strictEqual(I.formatCorrelation(0.8123, 'fr'), '0,81');
  assert.strictEqual(I.formatCorrelation(-0.8123, 'en'), '-0.81');
  assert.strictEqual(I.formatCorrelation(0.9971, 'fr'), '0,99', 'presque parfait : pas « 1 »');
  assert.strictEqual(I.formatCorrelation(-0.9999, 'en'), '-0.99');
  assert.strictEqual(I.formatCorrelation(1, 'fr'), '1', 'une droite exacte vaut 1');
  assert.strictEqual(I.formatCorrelation(-1, 'en'), '-1');
  assert.strictEqual(I.formatCorrelation(0, 'fr'), '0');
  assert.strictEqual(I.formatCorrelation(null, 'fr'), '');
  assert.strictEqual(I.formatCorrelation(NaN, 'fr'), '');
  console.log('OK formatCorrelation — deux décimales, 0,99 plutôt que 1 pour un lien imparfait, signe gardé, vide pour une valeur absente');
}

// paretoStats.
{
  const p = I.paretoStats(groups([['a', 80], ['b', 10], ['c', 4], ['d', 3], ['e', 3]]));
  assert.strictEqual(p.n, 5);
  assert.strictEqual(p.topCount, 1);
  close(p.topShare, 0.8);
  assert.strictEqual(p.countFor80, 1);
  close(p.shareOfGroupsFor80, 0.2);
  assert.strictEqual(p.topName, 'a');
  // Dix groupes égaux : il faut huit groupes pour 80 %.
  const flat = I.paretoStats(groups(Array.from({ length: 10 }, (_, i) => ['g' + i, 10])));
  assert.strictEqual(flat.countFor80, 8);
  close(flat.topShare, 0.2);
  assert.strictEqual(I.paretoStats(groups([['a', 5], ['b', 3], ['c', 2]])), null, 'moins de cinq groupes');
  assert.strictEqual(I.paretoStats(groups([['a', 5], ['b', 3], ['c', 2], ['d', 1], ['e', -1]])), null, 'un négatif');
  // Un groupe à 0 (un client sans vente) reste un groupe : il compte dans n et ne pèse rien ; un total nul n'a pas de parts.
  const withZero = I.paretoStats(groups([['a', 80], ['b', 10], ['c', 10], ['d', 0], ['e', 0]]));
  assert.ok(withZero && withZero.n === 5 && withZero.countFor80 === 1, 'les groupes à zéro comptent dans n');
  assert.strictEqual(I.paretoStats(groups([['a', 0], ['b', 0], ['c', 0], ['d', 0], ['e', 0]])), null, 'total nul : aucune part');
  console.log('OK paretoStats — 80/20 calculé à la main, dix groupes égaux, trop peu de groupes, négatif = null, groupes à zéro gardés');
}

// distributionStats : moyenne, médiane, asymétrie et valeurs aberrantes d'une colonne.
{
  // 1 à 7 et 100 : moyenne 128 / 8 = 16, médiane (4 + 5) / 2 = 4,5 ; quartiles « type 7 » : Q1 = 2 + 0,75 = 2,75, Q3 = 6 + 0,25 = 6,25,
  // écart interquartile 3,5, barrière haute 6,25 + 5,25 = 11,5 : seul 100 est aberrant.
  const tail = I.distributionStats([1, 2, 3, 4, 5, 6, 7, 100]);
  assert.strictEqual(tail.n, 8);
  close(tail.mean, 16, 1e-9, 'moyenne');
  close(tail.median, 4.5, 1e-9, 'médiane');
  assert.strictEqual(tail.outlierCount, 1);
  close(tail.outlierShare, 0.125, 1e-9, 'part aberrante');
  assert.ok(tail.skew > 1, `longue queue à droite : ${tail.skew}`);
  const even = I.distributionStats([1, 2, 3, 4, 5, 6, 7, 8]);
  close(even.mean, 4.5); close(even.median, 4.5); close(even.skew, 0, 1e-12, 'symétrique'); assert.strictEqual(even.outlierCount, 0);
  assert.strictEqual(I.distributionStats([5, 5, 5, 5, 5, 5, 5, 5]), null, 'constante');
  assert.strictEqual(I.distributionStats([1, 2, 3]), null, 'moins de huit valeurs');
  assert.strictEqual(I.distributionStats(['a', null, '', true, 1, 2, 3]), null, 'le vide et le texte ne comptent pas');
  assert.strictEqual(I.distributionStats([1, 2, 3, 4, 5, 6, 7, 8, null, '', 'x']).n, 8, 'les vides sont ignorés, jamais comptés pour 0');
  console.log('OK distributionStats — moyenne, médiane, aberrantes et asymétrie calculées à la main, constante et trop court = null');
}

// waterfallStats : hausses, baisses et solde.
{
  const w = I.waterfallStats(groups([['Ventes', 100], ['Achats', -60], ['Loyer', -20], ['Aides', 10]]));
  assert.strictEqual(w.n, 4); assert.strictEqual(w.ups, 2); assert.strictEqual(w.downs, 2);
  assert.strictEqual(w.gain, 110); assert.strictEqual(w.loss, 80); assert.strictEqual(w.net, 30);
  close(w.offset, 80 / 110);
  assert.strictEqual(w.biggestUpName, 'Ventes'); assert.strictEqual(w.biggestDownName, 'Achats');
  assert.strictEqual(I.waterfallStats(groups([['a', 5], ['b', 3], ['c', 2]])), null, 'aucune baisse : un cumul, pas une cascade');
  assert.strictEqual(I.waterfallStats(groups([['a', -5], ['b', -3], ['c', -2]])), null, 'aucune hausse');
  assert.strictEqual(I.waterfallStats(groups([['a', 5], ['b', -3]])), null, 'moins de trois groupes');
  assert.strictEqual(I.waterfallStats(groups([['a', 5], ['b', -3], ['c', null], ['d', '']])), null, 'les vides ne sont pas des groupes');
  assert.ok(I.interest.waterfall(w) > 0.7 && I.interest.waterfall(w) < 0.8, 'baisses et hausses comparables : 0,15 + 0,85 x 80/110');
  close(I.interest.waterfall(I.waterfallStats(groups([['a', 100], ['b', -100], ['c', 1]]))), 0.15 + 0.85 * (100 / 101), 1e-9);
  assert.ok(I.interest.waterfall(I.waterfallStats(groups([['a', 1000], ['b', -10], ['c', 5]]))) < 0.2, 'une petite baisse dans un mur de hausses : rien à dire');
  assert.strictEqual(I.interest.waterfall(null), 0);
  console.log('OK waterfallStats — gain, perte, solde et rapport calculés à la main ; sans signes mêlés ou avec moins de trois groupes = null');
}

// funnelStats : de la plus grande à la plus petite étape.
{
  const f = I.funnelStats(groups([['Essai', 120], ['Visite', 400], ['Achat', 45], ['Inscrit', 220]])); // volontairement en désordre
  assert.strictEqual(f.n, 4); assert.strictEqual(f.firstName, 'Visite'); assert.strictEqual(f.lastName, 'Achat');
  close(f.keep, 45 / 400); close(f.ratio, 400 / 45);
  // 220/400 -> 45 % perdus ; 120/220 -> 45,45 % ; 45/120 -> 62,5 % : la plus forte baisse est d'Essai à Achat.
  assert.strictEqual(f.worst.from, 'Essai'); assert.strictEqual(f.worst.to, 'Achat'); close(f.worst.dropPct, 62.5, 1e-9);
  assert.strictEqual(I.interest.funnel(f), 1, 'une marche à plus de 50 % : intérêt plein');
  const flat = I.funnelStats(groups([['a', 100], ['b', 99], ['c', 98]]));
  close(flat.worst.dropPct, (1 - 98 / 99) * 100, 1e-9);
  assert.ok(I.interest.funnel(flat) < 0.25, 'des étapes égales : un entonnoir sans pente');
  assert.strictEqual(I.funnelStats(groups([['a', 5], ['b', 3]])), null, 'moins de trois étapes');
  assert.strictEqual(I.funnelStats(groups([['a', 5], ['b', 3], ['c', 0]])), null, 'une étape à zéro');
  assert.strictEqual(I.funnelStats(groups([['a', 5], ['b', 3], ['c', -2]])), null, 'une étape négative');
  assert.strictEqual(I.interest.funnel(null), 0);
  console.log('OK funnelStats — étapes rangées, conservation et plus forte marche calculées à la main ; égales = peu d\'intérêt');
}

// boxGapStats : l'écart entre les groupes en écarts interquartiles.
{
  const box = (name, n, median, iqr, outlierCount) => ({ name, n, median, q1: median - iqr / 2, q3: median + iqr / 2, outlierCount: outlierCount || 0 });
  const gap = I.boxGapStats([box('A', 10, 100, 20), box('B', 10, 200, 20, 1), box('C', 3, 999, 1)]); // C : moins de 5 valeurs, ne compte pas
  assert.strictEqual(gap.n, 2); assert.strictEqual(gap.lowName, 'A'); assert.strictEqual(gap.highName, 'B');
  close(gap.gapIqr, 5, 1e-9, '(200 - 100) / 20'); close(gap.outlierShare, 1 / 20); assert.strictEqual(gap.outlierCount, 1); assert.strictEqual(gap.outlierName, 'B');
  assert.strictEqual(I.interest.box(gap), 1);
  const alike = I.boxGapStats([box('A', 10, 100, 20), box('B', 10, 101, 20)]);
  close(alike.gapIqr, 0.05, 1e-9); assert.strictEqual(alike.outlierName, null);
  assert.strictEqual(I.interest.box(alike), 0.15, 'des groupes qui se ressemblent : plancher');
  assert.strictEqual(I.boxGapStats([box('A', 10, 100, 0), box('B', 10, 200, 0)]).gapIqr, null, 'écarts interquartiles nuls : pas de rapport');
  assert.strictEqual(I.boxGapStats([box('A', 10, 100, 20)]), null, 'un seul groupe');
  assert.strictEqual(I.boxGapStats([box('A', 10, 100, 20), box('B', 4, 300, 20)]), null, 'un seul groupe assez fourni');
  assert.strictEqual(I.boxGapStats([box('A', 4, 100, 20), box('B', 4, 300, 20)], 3).n, 2, 'le seuil se règle');
  assert.strictEqual(I.interest.box(null), 0);
  console.log('OK boxGapStats — écart de médianes en écarts interquartiles, aberrantes comptées, groupes trop petits écartés');
}

// interest.pareto.
{
  assert.strictEqual(I.interest.pareto(I.paretoStats(groups([['a', 80], ['b', 10], ['c', 4], ['d', 3], ['e', 3]]))), 1, '1 groupe sur 5 pour 80 % : plein');
  assert.strictEqual(I.interest.pareto(I.paretoStats(groups(Array.from({ length: 10 }, (_, i) => ['g' + i, 10])))), 0, 'dix groupes égaux : aucune concentration');
  close(I.interest.pareto({ shareOfGroupsFor80: 0.5 }), 0.5, 1e-12);
  assert.strictEqual(I.interest.pareto(null), 0);
  console.log('OK interest.pareto — plein à 20 % des groupes pour 80 %, nul à 80 %');
}

// Notes d'intérêt : bornées, monotones, honnêtes.
{
  const clamp = (x) => assert.ok(x >= 0 && x <= 1, `note hors de [0 ; 1] : ${x}`);
  const flatShare = I.shareStats(groups([['a', 10], ['b', 10], ['c', 10]]));
  const bigShare = I.shareStats(groups([['a', 90], ['b', 5], ['c', 5]]));
  const flatSpread = I.spreadStats(groups([['a', 10], ['b', 10], ['c', 10]]));
  const bigSpread = I.spreadStats(groups([['a', 1], ['b', 10], ['c', 100]]));
  assert.strictEqual(I.interest.compare(flatShare, flatSpread), 0, 'des barres égales ne montrent rien');
  assert.ok(I.interest.compare(bigShare, bigSpread) > 0.9, 'un groupe dominant se lit');
  assert.ok(I.interest.share(bigShare) > I.interest.share(I.shareStats(groups([['a', 40], ['b', 35], ['c', 25]]))), 'plus dominant = plus d\'intérêt');
  assert.strictEqual(I.interest.share(flatShare), 0);
  assert.strictEqual(I.interest.share(null), 0);
  assert.strictEqual(I.interest.compare(null, null), 0);
  assert.ok(I.interest.trend(I.trendStats([1, 2, 3, 4, 5, 6])) > 0.95, 'tendance nette');
  assert.ok(I.interest.trend(I.trendStats([5, 5, 5, 5])) === 0, 'série plate');
  assert.ok(I.interest.trend(I.trendStats([1, 9, 1, 9, 1, 9])) < 0.1, 'dents de scie');
  assert.ok(I.interest.trend(I.trendStats([0, 0, 5, 9])) > 0, 'début nul : variation infinie, intérêt plein (jamais NaN)');
  assert.strictEqual(I.interest.trend(null), 0);
  assert.ok(I.interest.relation({ r: 0.9 }) > 0.85 && I.interest.relation({ r: -0.9 }) === I.interest.relation({ r: 0.9 }), 'le sens du lien ne change rien');
  assert.strictEqual(I.interest.relation(null), 0);
  assert.strictEqual(I.interest.profile(null), 0.3);
  assert.ok(I.interest.profile(I.spreadStats(groups([['a', 1], ['b', 10], ['c', 5]]))) > I.interest.profile(flatSpread), 'profil irrégulier > profil régulier');
  assert.ok(I.interest.profile(flatSpread) >= 0.3, 'jamais sous 0,3');
  assert.ok(I.interest.distribution(I.skewStats([1, 1, 1, 1, 1, 1, 1, 50]), null) > 0.9);
  assert.ok(I.interest.distribution(null, null) >= 0.25);
  [I.interest.compare(bigShare, bigSpread), I.interest.share(bigShare), I.interest.trend(I.trendStats([1, 2, 3])), I.interest.relation({ r: 1 }), I.interest.profile(bigSpread),
    I.interest.distribution(I.skewStats([1, 1, 1, 1, 1, 1, 1, 500]), I.outlierStats([1, 1, 1, 1, 1, 1, 1, 500])),
    I.interest.pareto({ shareOfGroupsFor80: 0.05 }), I.interest.pareto({ shareOfGroupsFor80: 0.99 }), I.interest.funnel({ worst: { dropPct: 400 } }),
    I.interest.waterfall({ gain: 1, loss: 1e9 }), I.interest.box({ gapIqr: 1e9, outlierShare: 5 })].forEach(clamp);
  console.log('OK notes d\'intérêt — dans [0 ; 1], égales = 0, plus net = plus haut, sens de la corrélation indifférent, jamais NaN');
}

// Formats : la langue décide du séparateur ; un pourcentage n'est jamais 0 ni 100 à tort.
{
  assert.strictEqual(I.formatNumber(1.25, 'fr', 2), '1,25');
  assert.strictEqual(I.formatNumber(1.25, 'en', 2), '1.25');
  assert.strictEqual(I.formatNumber(1.254, 'en', 1), '1.3');
  assert.strictEqual(I.formatNumber(3, 'fr', 2), '3', 'pas de zéro de fin');
  assert.strictEqual(I.formatNumber(null, 'fr', 2), '');
  assert.strictEqual(I.formatNumber('x', 'en', 2), '');
  assert.strictEqual(I.percentOf(0.423), 42);
  assert.strictEqual(I.percentOf(0.004), 1, 'une part non nulle ne s\'écrit pas 0 %');
  assert.strictEqual(I.percentOf(0.996), 99, 'une part qui n\'est pas le tout ne s\'écrit pas 100 %');
  assert.strictEqual(I.percentOf(1), 100);
  assert.strictEqual(I.percentOf(0), 0);
  console.log('OK formats — virgule en français, point en anglais, jamais 0 % ni 100 % à tort');
}

// Hygiène : pur, aucune dépendance, aucun accès au navigateur.
{
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'advice-insights.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\brequire\s*\(/.test(source), 'aucune dépendance');
  ['document', 'window', 'localStorage', 'fetch(', 'eval(', 'Function('].forEach((w) => assert.ok(!source.includes(w), `jamais ${w}`));
  assert.ok(!/Math\.random|Date\.now|new Date/.test(source), 'déterministe : ni hasard ni horloge');
  console.log('OK hygiène — pur, déterministe, aucune dépendance ni accès à la page');
}

console.log('Tous les essais des statistiques de suggestion sont passés.');
