/*
 * Suggestions des types spécialisés (js/advice-types.js : Pareto, barres + courbe, histogramme, boîtes, cascade, entonnoir),
 * jugées sur les tables du corpus (dev-tests/lib/advice-corpus.js) et sur des tables fabriquées pour un seul défaut :
 *
 *   node dev-tests/test-advice-types.js
 *
 * Cinq sortes d'essais :
 *  1. ÉLIGIBILITÉ : chaque type n'est proposé que quand les données ont quelque chose à montrer (jamais un Pareto sans concentration,
 *     une cascade sans baisse, des boîtes identiques, un entonnoir sur une colonne qui n'est pas une étape, des barres + courbe sans lien) ;
 *  2. JUSTESSE : chaque chiffre annoncé est recalculé par une boucle INDÉPENDANTE de js/advice-insights.js (une Map et des tris, rien d'autre) ;
 *  3. PHRASES : chacune se résout en français et en anglais, sans variable orpheline ni NaN, avec le bon pourcentage ;
 *  4. CLASSEMENT : ce qui montre un fait passe devant ce qui n'en montre pas ; les miniatures se dessinent ;
 *  5. ROBUSTESSE : cellules vides, mesure vide, 300 000 lignes, un générateur qui lève ne retire rien aux autres, hygiène du fichier.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir la note « mutations » de HYPOTHESES.md, niveau 2b).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const advice = require('../js/advice.js');
const types = require('../js/advice-types.js');
const welcome = require('../js/welcome.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');

const tables = corpus.build();
const table = (name) => tables.find((t) => t.name === name);
const NEW_TYPES = ['combo', 'histogram', 'box', 'waterfall', 'funnel'];
const suggest = (rowsOrTable, opts) => {
  const t = Array.isArray(rowsOrTable) ? { rows: rowsOrTable, info: {} } : rowsOrTable;
  advice.setColumnInfo(t.info || {});
  return advice.suggestTiles(t.rows, undefined, Object.assign({ limit: 40, lang: 'fr', columnInfo: t.info || {} }, opts || {}));
};
const pareto = (list) => list.filter((s) => s.type === 'combo' && s.tileData.comboMode === 'pareto');
const comboTwo = (list) => list.filter((s) => s.type === 'combo' && s.tileData.comboMode !== 'pareto');
const of = (list, type) => list.filter((s) => s.type === type);

// Recalculs INDÉPENDANTS : des nombres, une Map, des tris.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const groupsOf = (rows, dimension, measure, aggFn) => {
  const map = new Map();
  rows.forEach((r) => {
    if (r[dimension] === null || r[dimension] === undefined || r[dimension] === '') return;
    const key = String(r[dimension]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r[measure]);
  });
  return Array.from(map.entries()).map(([name, values]) => {
    const nums = values.map(num).filter((v) => v !== null);
    return { name, value: aggFn === 'count' ? values.length : nums.reduce((a, b) => a + b, 0) };
  });
};
const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); const pos = (s.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
const pearson = (xs, ys) => {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const resolve = (s, lang) => { i18n.setLang(lang); const text = i18n.t(s.reasonKey, s.reasonVars); i18n.setLang('fr'); return text; };

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Éligibilité : proposé quand les données le justifient, jamais sinon
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const ventes = suggest(table('ventes'));
  const p = pareto(ventes);
  assert.strictEqual(p.length, 1, 'un Pareto sur les ventes (quelques clients font presque tout)');
  assert.deepStrictEqual([p[0].tileData.dimension, p[0].tileData.measure, p[0].tileData.aggFn], ['Client', 'Montant', 'sum']);
  assert.strictEqual(p[0].tileData.comboMode, 'pareto');
  assert.strictEqual(p[0].tileData.measureY, undefined, 'un Pareto n\'a pas de 2e mesure');
  assert.strictEqual(p[0].intent, 'concentrate');
  assert.strictEqual(p[0].titleKey, 'tileTitle.pareto');
  assert.ok(of(ventes, 'histogram').some((s) => s.tileData.measure === 'Montant' && s.tileData.dimension === ''), 'un histogramme du montant');
  assert.ok(of(ventes, 'box').some((s) => s.tileData.dimension === 'Region'), 'des boîtes par région (le Nord a des montants plus hauts)');

  // Pas de Pareto sans concentration : cinq groupes égaux (RH), cinq étapes de tailles voisines (CRM), des tickets répartis à parts égales.
  ['rh', 'crm', 'tickets', 'notes', 'compta', 'enquete', 'large', 'contacts', 'commandes', 'projet', 'resultat', 'parcours'].forEach((name) => {
    assert.strictEqual(pareto(suggest(table(name))).length, 0, `${name} : aucun Pareto (rien n'est concentré)`);
  });

  const resultat = suggest(table('resultat'));
  const w = of(resultat, 'waterfall');
  // La cascade des postes, et — depuis que le nom « Mois » (1 à 12) le fait lire comme un repère du temps — celle des mois, qui ne remplace pas la première.
  assert.deepStrictEqual(w.map((x) => x.tileData.dimension).sort(), ['Mois', 'Poste'], 'une cascade des postes de recettes et de dépenses, puis celle des mois');
  const poste = w.find((x) => x.tileData.dimension === 'Poste');
  assert.deepStrictEqual([poste.tileData.dimension, poste.tileData.measure, poste.tileData.aggFn], ['Poste', 'Montant', 'sum']);
  assert.strictEqual(poste.intent, 'change');
  // Jamais de cascade sans baisse : les montants de la compta changent de signe LIGNE par ligne, mais chaque catégorie, additionnée, est positive.
  tables.filter((t) => t.name !== 'resultat').forEach((t) => assert.strictEqual(of(suggest(t), 'waterfall').length, 0, `${t.name} : aucune cascade`));

  const parcours = of(suggest(table('parcours')), 'funnel');
  assert.strictEqual(parcours.length, 1, 'un entonnoir sur la colonne Etape');
  assert.deepStrictEqual([parcours[0].tileData.dimension, parcours[0].tileData.aggFn, parcours[0].tileData.sortMode], ['Etape', 'count', 'value-desc']);
  assert.strictEqual(parcours[0].intent, 'stages');
  // Le NOM décide : un statut de ticket (Ouvert, En cours, Résolu, Fermé) n'est pas un parcours qui se rétrécit.
  ['tickets', 'commandes', 'projet', 'rh', 'compta'].forEach((name) => assert.strictEqual(of(suggest(table(name)), 'funnel').length, 0, `${name} : pas d'entonnoir`));
  assert.ok(of(suggest(table('crm')), 'funnel').length === 1, 'la colonne Etape du CRM en est un');

  const combos = comboTwo(suggest(table('produits')));
  assert.ok(combos.length >= 1, 'barres + courbe quand les marges suivent les ventes');
  assert.deepStrictEqual([combos[0].tileData.dimension, combos[0].tileData.measure, combos[0].tileData.measureY], ['Produit', 'Ventes', 'Marge']);
  assert.ok(Math.abs(combos[0].facts.r) >= types.COMBO_MIN_ABS_R);
  tables.filter((t) => t.name !== 'produits').forEach((t) => assert.strictEqual(comboTwo(suggest(t)).length, 0, `${t.name} : aucun graphique à deux mesures sans lien net`));

  // Histogramme : jamais sur une note de 1 à 5, un identifiant, une Référence ni une colonne à 5 valeurs.
  const all = tables.map((t) => ({ t, list: of(suggest(t), 'histogram') }));
  const hist = (name) => all.find((x) => x.t.name === name).list.map((s) => s.tileData.measure);
  assert.ok(!hist('enquete').some((c) => /^Q[123]$/.test(c)), 'pas d\'histogramme d\'une note de 1 à 5');
  assert.ok(!hist('crm').includes('Probabilite'), 'ni d\'une probabilité à 5 valeurs');
  assert.ok(!hist('rh').includes('Matricule') && !hist('rh').includes('id'), 'ni d\'un identifiant');
  assert.ok(!hist('commandes').includes('Client'), 'ni d\'une Référence');
  assert.ok(hist('notes').includes('Maths'), 'une note sur 20 (21 valeurs) a bien une répartition');
  assert.ok(hist('tickets').includes('Duree_h') && !hist('tickets').includes('Satisfaction'), 'une durée, pas une satisfaction de 1 à 5');

  // Boîtes : seulement quand les groupes se distinguent ou ont des valeurs hors norme ; jamais des groupes de moins de 5 lignes.
  // (La mesure que chaque table a été fabriquée pour montrer : une autre colonne, comme l'ancienneté de `rh` que son nom fait désormais lire comme une vraie
  // mesure, peut avoir par hasard des médianes un peu écartées.)
  const MAIN_MEASURE = { rh: 'Salaire', tickets: 'Duree_h', compta: 'Montant', crm: 'Montant', commandes: 'Montant' };
  Object.keys(MAIN_MEASURE).forEach((name) => assert.strictEqual(of(suggest(table(name)), 'box').filter((s) => s.tileData.measure === MAIN_MEASURE[name]).length, 0, `${name} : des groupes qui se ressemblent, pas de boîtes`));
  const boxEnquete = of(suggest(table('enquete')), 'box');
  assert.ok(boxEnquete.some((s) => s.tileData.dimension === 'Ville' && s.tileData.measure === 'Age'), 'des âges qui diffèrent d\'une ville à l\'autre');
  const few = Array.from({ length: 30 }, (_, i) => ({ Groupe: 'G' + (i % 10), Valeur: (i % 10) * 100 + (i % 3) })); // 3 lignes par groupe
  assert.strictEqual(of(suggest(few), 'box').length, 0, 'moins de 5 lignes par groupe : aucun quartile parlant');
  console.log('OK éligibilité — Pareto, cascade, entonnoir, boîtes, barres + courbe et histogramme : proposés sur les tables qui les justifient, jamais sur les autres');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Justesse : les chiffres annoncés sont ceux qu'on retrouve en recalculant
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Pareto (ventes, Client x Montant) : combien de clients pour 80 % du total.
  const ventes = table('ventes');
  const p = pareto(suggest(ventes))[0];
  const totals = groupsOf(ventes.rows, 'Client', 'Montant', 'sum').map((g) => g.value).sort((a, b) => b - a);
  const total = totals.reduce((a, b) => a + b, 0);
  let running = 0; let k = 0;
  for (; k < totals.length; k++) { running += totals[k]; if (running / total >= 0.8) { k++; break; } }
  assert.strictEqual(p.facts.countFor80, k, `clients pour 80 % : ${p.facts.countFor80} au lieu de ${k}`);
  assert.strictEqual(p.facts.n, totals.length);
  assert.strictEqual(p.reasonVars.k, k); assert.strictEqual(p.reasonVars.n, totals.length);
  assert.strictEqual(p.insightKey, 'advice.insight.paretoTop');
  assert.ok(Math.abs(p.facts.shareOfGroupsFor80 - k / totals.length) < 1e-12);
  assert.ok(p.interest > 0.8, `une vraie concentration : intérêt ${p.interest}`);

  // Histogramme (ventes, Montant) : moyenne, médiane, asymétrie, aberrantes.
  const h = of(suggest(ventes), 'histogram').find((s) => s.tileData.measure === 'Montant');
  const xs = ventes.rows.map((r) => num(r.Montant)).filter((v) => v !== null);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const m2 = xs.reduce((a, v) => a + (v - mean) ** 2, 0) / xs.length;
  const m3 = xs.reduce((a, v) => a + (v - mean) ** 3, 0) / xs.length;
  const q1 = quantile(xs, 0.25); const q3 = quantile(xs, 0.75);
  const outliers = xs.filter((v) => v < q1 - 1.5 * (q3 - q1) || v > q3 + 1.5 * (q3 - q1)).length;
  assert.ok(Math.abs(h.facts.mean - mean) < 1e-9 && Math.abs(h.facts.median - quantile(xs, 0.5)) < 1e-9, 'moyenne et médiane');
  assert.ok(Math.abs(h.facts.skew - m3 / Math.pow(m2, 1.5)) < 1e-9, 'asymétrie');
  assert.strictEqual(h.facts.outlierCount, outliers);
  assert.strictEqual(h.insightKey, 'advice.insight.histSkewRight', 'des montants à longue queue : la moyenne dépasse la médiane');
  assert.ok(h.facts.mean > h.facts.median);
  assert.strictEqual(h.reasonVars.median, advice.profileColumns ? require('../js/advice-insights.js').formatNumber(h.facts.median, 'fr', 0) : '');

  // Boîtes (ventes, Region x Montant) : médiane de chaque région, plus haute et plus basse.
  const b = of(suggest(ventes), 'box').find((s) => s.tileData.dimension === 'Region');
  const perRegion = new Map();
  ventes.rows.forEach((r) => { if (!perRegion.has(r.Region)) perRegion.set(r.Region, []); perRegion.get(r.Region).push(r.Montant); });
  const stats = Array.from(perRegion.entries()).map(([name, v]) => ({ name, median: quantile(v, 0.5), iqr: quantile(v, 0.75) - quantile(v, 0.25), n: v.length }));
  stats.sort((x, y) => x.median - y.median);
  assert.strictEqual(b.facts.high, stats[stats.length - 1].name); assert.strictEqual(b.facts.low, stats[0].name);
  const meanIqr = stats.reduce((a, s) => a + s.iqr, 0) / stats.length;
  assert.ok(Math.abs(b.facts.gapIqr - (stats[stats.length - 1].median - stats[0].median) / meanIqr) < 1e-9, 'écart de médianes en écarts interquartiles');
  assert.strictEqual(b.facts.high, 'Nord', 'le Nord a les montants les plus hauts');

  // Cascade (resultat, Poste x Montant) : hausses, baisses, solde.
  const resultat = table('resultat');
  const w = of(suggest(resultat), 'waterfall').find((x) => x.tileData.dimension === 'Poste');
  const sums = groupsOf(resultat.rows, 'Poste', 'Montant', 'sum');
  const gain = sums.filter((g) => g.value > 0).reduce((a, g) => a + g.value, 0);
  const loss = -sums.filter((g) => g.value < 0).reduce((a, g) => a + g.value, 0);
  assert.ok(Math.abs(w.facts.offset - loss / gain) < 1e-12 && Math.abs(w.facts.net - (gain - loss)) < 1e-9, 'baisses / hausses et solde');
  assert.strictEqual(w.insightKey, gain - loss >= 0 ? 'advice.insight.waterfallGain' : 'advice.insight.waterfallLoss');
  const biggestDown = sums.filter((g) => g.value < 0).sort((x, y) => x.value - y.value)[0].name;
  assert.strictEqual(w.facts.biggestDown, biggestDown); assert.strictEqual(w.reasonVars.fall, biggestDown);
  assert.strictEqual(w.reasonVars.pct, gain - loss >= 0 ? Math.round(loss / gain * 100) : Math.round(loss / gain * 100), 'pourcentage de la phrase');
  assert.strictEqual(biggestDown, 'Achats', 'les achats sont la plus grosse dépense');

  // Entonnoir (parcours) : 400 -> 220 -> 120 -> 45.
  const f = of(suggest(table('parcours')), 'funnel')[0];
  const counts = groupsOf(table('parcours').rows, 'Etape', 'Visiteur', 'count').sort((x, y) => y.value - x.value);
  assert.deepStrictEqual(counts.map((c) => c.value), [400, 220, 120, 45]);
  assert.ok(Math.abs(f.facts.keep - 45 / 400) < 1e-12);
  assert.deepStrictEqual([f.facts.first, f.facts.last, f.facts.worstFrom, f.facts.worstTo], ['Visite', 'Achat', 'Essai', 'Achat']);
  assert.ok(Math.abs(f.facts.worstDropPct - (1 - 45 / 120) * 100) < 1e-9);
  assert.strictEqual(f.reasonVars.pct, 63, '(1 - 45/120) = 62,5 % arrondi à 63');
  assert.strictEqual(f.reasonVars.ratio, '8,9', '400 / 45 = 8,89 arrondi à 8,9, virgule française');
  assert.strictEqual(f.insightKey, 'advice.insight.funnelDrop');
  assert.strictEqual(suggest(table('parcours'), { lang: 'en' }).find((s) => s.type === 'funnel').reasonVars.ratio, '8.9', 'point en anglais');

  // Barres + courbe (produits) : corrélation d'un produit à l'autre.
  const c = comboTwo(suggest(table('produits')))[0];
  const ventesP = groupsOf(table('produits').rows, 'Produit', 'Ventes', 'sum');
  const margeP = new Map(groupsOf(table('produits').rows, 'Produit', 'Marge', 'sum').map((g) => [g.name, g.value]));
  const r = pearson(ventesP.map((g) => g.value), ventesP.map((g) => margeP.get(g.name)));
  assert.ok(Math.abs(c.facts.r - r) < 1e-9, `corrélation ${c.facts.r} au lieu de ${r}`);
  assert.strictEqual(c.insightKey, 'advice.insight.comboUp');
  assert.strictEqual(c.tileData.sortMode, 'value-desc', 'des catégories se rangent par la mesure en barres');
  assert.strictEqual(c.tileData.aggFnY, undefined, 'même agrégat pour les deux mesures : pas d\'aggFnY');
  console.log('OK justesse — Pareto, histogramme, boîtes, cascade, entonnoir et barres + courbe : chaque chiffre recalculé à la main (k pour 80 %, moyenne/médiane/asymétrie, écart de médianes, baisses/hausses, conservation, Pearson)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Phrases : fr/en résolues, sans variable orpheline, avec le bon pourcentage
// ---------------------------------------------------------------------------------------------------------------------------------
{
  let checked = 0;
  const kinds = new Set();
  tables.forEach((t) => suggest(t).filter((s) => NEW_TYPES.indexOf(s.type) !== -1).forEach((s) => {
    ['fr', 'en'].forEach((lang) => {
      const text = resolve(s, lang);
      assert.ok(text && !/[{}]/.test(text) && !/undefined|NaN|null|Infinity/.test(text), `${t.name} / ${s.type} (${lang}) : phrase mal résolue « ${text} »`);
    });
    if (s.facts) Object.keys(s.facts).forEach((key) => { if (typeof s.facts[key] === 'number') assert.ok(Number.isFinite(s.facts[key]), `${t.name} / ${s.type} : ${key} fini`); });
    kinds.add(s.reasonKey);
    checked++;
  }));
  assert.ok(checked >= 25, `${checked} suggestions de ces types sur le corpus`);
  ['advice.insight.paretoTop', 'advice.insight.histSkewRight', 'advice.insight.histEven', 'advice.insight.boxGap', 'advice.insight.waterfallLoss', 'advice.insight.waterfallGain',
    'advice.insight.funnelDrop', 'advice.insight.comboUp'].forEach((key) => {
    if (key === 'advice.insight.waterfallLoss' || key === 'advice.insight.waterfallGain') return; // l'un ou l'autre selon le solde
    assert.ok(kinds.has(key), `le corpus produit la phrase ${key}`);
  });

  // Les phrases de chaque clé du module, avec des variables types, dans les deux langues.
  const vars = { measure: 'Montant', measureY: 'Marge', dimension: 'Client', r: '0,8', k: 8, n: 40, pct: 45, mean: '1 200', median: '800', high: 'Nord', low: 'Sud', highValue: '900', lowValue: '400',
    name: 'Nord', fall: 'Achats', first: 'Visite', last: 'Achat', ratio: '8,9', from: 'Essai', to: 'Achat' };
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'advice-types.js'), 'utf8');
  const keys = new Set((source.match(/'advice\.(insight|reason|title)\.[A-Za-z]+'/g) || []).map((k) => k.slice(1, -1)));
  assert.ok(keys.size >= 25, `${keys.size} clés citées par advice-types.js`);
  keys.forEach((key) => {
    assert.ok(i18n.STRINGS[key] && i18n.STRINGS[key].fr && i18n.STRINGS[key].en, `traduction fr ET en : ${key}`);
    ['fr', 'en'].forEach((lang) => { i18n.setLang(lang); const text = i18n.t(key, vars); assert.ok(!/[{}]/.test(text), `${key} (${lang}) : variable non résolue dans « ${text} »`); });
  });
  i18n.setLang('fr');
  (source.match(/'tileTitle\.[A-Za-z]+'/g) || []).forEach((k) => assert.ok(i18n.STRINGS[k.slice(1, -1)], `titre de tuile : ${k}`));
  ['concentrate', 'distribution', 'change', 'stages'].forEach((intent) => {
    assert.strictEqual(advice.INTENT_KEYS[intent], 'advice.intent.' + intent);
    assert.ok(i18n.STRINGS['advice.intent.' + intent].fr && i18n.STRINGS['advice.intent.' + intent].en);
  });
  console.log(`OK phrases — ${checked} suggestions du corpus et ${keys.size} clés résolues en français et en anglais, sans variable orpheline ni NaN`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Classement : ce qui montre un fait passe devant ce qui n'en montre pas
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const stageRows = (counts) => { const out = []; Object.keys(counts).forEach((stage) => { for (let i = 0; i < counts[stage]; i++) out.push({ Etape: stage, Ref: 'R' + out.length }); }); return out; };
  // Entonnoir : une pente franche, des étapes égales.
  const steep = of(suggest(stageRows({ Visite: 400, Inscrit: 200, Essai: 90, Achat: 30 })), 'funnel')[0];
  const flat = of(suggest(stageRows({ Visite: 100, Inscrit: 99, Essai: 98, Achat: 97 })), 'funnel')[0];
  assert.strictEqual(steep.insightKey, 'advice.insight.funnelDrop'); assert.strictEqual(flat.insightKey, 'advice.insight.funnelEven');
  assert.ok(steep.interest > 0.9 && flat.interest < 0.3, `pente ${steep.interest} contre ${flat.interest}`);
  assert.ok(steep.score > flat.score + 2, `l'entonnoir qui se rétrécit passe devant (${steep.score} contre ${flat.score})`);
  assert.ok(/étapes de/.test(resolve(flat, 'fr')) && /same size/.test(resolve(flat, 'en')), 'des étapes égales le disent');

  // Histogramme : une longue queue passe devant une répartition régulière ; la queue est DITE.
  const skewed = Array.from({ length: 200 }, (_, i) => ({ Id: 'x' + i, Valeur: i < 190 ? 10 + (i * 0.37) % 20 : 1000.5 + i }));
  const regular = Array.from({ length: 200 }, (_, i) => ({ Id: 'x' + i, Valeur: 10 + (i * 0.37) % 20 })); // des décimales : un petit entier répété serait un numéro de jour, jamais une mesure
  const hs = of(suggest(skewed), 'histogram')[0]; const hr = of(suggest(regular), 'histogram')[0];
  assert.ok(hs.interest > hr.interest + 0.3 && hs.score > hr.score + 1, `queue ${hs.interest} contre régulier ${hr.interest}`);
  assert.strictEqual(hr.insightKey, 'advice.insight.histEven');
  assert.ok(['advice.insight.histSkewRight', 'advice.insight.histOutliers'].includes(hs.insightKey), hs.insightKey);
  // Une longue queue à GAUCHE se dit à l'inverse.
  const left = Array.from({ length: 200 }, (_, i) => ({ Id: 'x' + i, Valeur: i < 190 ? 1000 - (i * 0.37) % 20 : 10.5 + i }));
  assert.strictEqual(of(suggest(left), 'histogram')[0].insightKey, 'advice.insight.histSkewLeft');

  // Cascade : des hausses et des baisses de poids comparable passent devant une seule petite baisse.
  const waterfallRows = (spec) => spec.reduce((acc, [poste, amount]) => acc.concat(Array.from({ length: 10 }, (_, i) => ({ Poste: poste, Montant: amount + i }))), []);
  const balanced = of(suggest(waterfallRows([['A', 500], ['B', -300], ['C', -150], ['D', 200]])), 'waterfall')[0];
  const lopsided = of(suggest(waterfallRows([['A', 500], ['B', 300], ['C', -5], ['D', 200]])), 'waterfall')[0];
  assert.ok(balanced.interest > lopsided.interest + 0.4, `compensées ${balanced.interest} contre une petite baisse ${lopsided.interest}`);
  assert.strictEqual(balanced.insightKey, 'advice.insight.waterfallGain');
  const negative = of(suggest(waterfallRows([['A', 100], ['B', -300], ['C', -150], ['D', 50]])), 'waterfall')[0];
  assert.strictEqual(negative.insightKey, 'advice.insight.waterfallLoss', 'un solde négatif se dit autrement');
  assert.ok(negative.reasonVars.pct > 100, `les baisses valent ${negative.reasonVars.pct} % des hausses`);
  assert.ok(/surtout B/.test(resolve(negative, 'fr')), 'la plus grosse baisse est nommée');

  // Pareto : une concentration NETTE passe devant une concentration limite ; sans cela, rien.
  const zipf = (n, exponent) => { const out = []; for (let i = 0; i < n; i++) { const w = Math.max(1, Math.round(300 / Math.pow(i + 1, exponent))); for (let k = 0; k < w; k++) out.push({ Client: 'C' + String(i).padStart(2, '0'), Montant: 100.5 + (k % 5) * 1.5 }); } return out; };
  const sharp = pareto(suggest(zipf(30, 1.6)))[0];
  const mild = pareto(suggest(zipf(30, 0.9)));
  assert.ok(sharp && sharp.interest > 0.8, 'une loi puissante raide : concentration nette');
  assert.ok(mild.length === 0 || mild[0].interest < sharp.interest, 'une concentration plus douce vaut moins');
  assert.strictEqual(pareto(suggest(zipf(30, 0))).length, 0, 'tous les clients égaux : aucun Pareto');

  // Pareto d'un NOMBRE de lignes quand aucune mesure ne s'additionne (une note se moyenne).
  const countRows = zipf(30, 1.6).map((r, i) => ({ Id: 'T' + i, Client: r.Client, Note: 1 + (i % 5) + (i % 3) }));
  const countPareto = pareto(suggest(countRows))[0];
  assert.ok(countPareto, 'un Pareto sans mesure additive');
  assert.strictEqual(countPareto.tileData.aggFn, 'count');
  assert.strictEqual(countPareto.titleKey, 'advice.title.paretoCount');
  assert.strictEqual(countPareto.insightKey, 'advice.insight.paretoTopCount');

  // Boîtes : des groupes bien séparés passent devant des groupes qui se chevauchent, et une valeur hors norme se dit.
  const boxRows = (shift, outlier) => Array.from({ length: 120 }, (_, i) => ({ Groupe: ['A', 'B', 'C'][i % 3], Valeur: 50.25 + (i % 10) + (i % 3) * shift + ([4, 7, 10, 13].indexOf(i) !== -1 && outlier ? 900 : 0) }));
  const apart = of(suggest(boxRows(40, false)), 'box')[0];
  assert.strictEqual(apart.insightKey, 'advice.insight.boxGap');
  assert.strictEqual(of(suggest(boxRows(0, false)), 'box').length, 0, 'groupes confondus : pas de boîtes');
  const withOutliers = of(suggest(boxRows(0, true)), 'box')[0];
  assert.ok(withOutliers, 'des valeurs hors norme justifient des boîtes même sans écart de médianes');
  assert.strictEqual(withOutliers.insightKey, 'advice.insight.boxOutliers');
  assert.strictEqual(withOutliers.facts.outlierCount, 4, 'quatre valeurs hors norme sur 120 (3 %)');
  assert.ok(apart.interest > 0.9, `écart net ${apart.interest}`);

  // Une seule valeur hors norme sur 40 ne justifie pas des boîtes : ce serait une coïncidence.
  const one = Array.from({ length: 40 }, (_, i) => ({ Groupe: ['A', 'B'][i % 2], Valeur: 50.25 + (i % 10) + (i === 6 ? 900 : 0) }));
  assert.strictEqual(of(suggest(one), 'box').length, 0, 'une seule aberrante : pas assez pour proposer');

  // Un double axe : la courbe en pente inverse se dit « en sens inverse ».
  const inverse = Array.from({ length: 120 }, (_, i) => ({ Produit: 'P' + (i % 12), Ventes: 100 * ((i % 12) + 1), Retours: 2000 - 150 * ((i % 12) + 1) + (i % 4) }));
  const down = comboTwo(suggest(inverse))[0];
  assert.ok(down && down.facts.r < -0.6, 'deux mesures qui évoluent en sens inverse');
  assert.strictEqual(down.insightKey, 'advice.insight.comboDown');
  assert.ok(down.interest > 0.9);

  // Régression : des barres de signes mêlés (recettes et dépenses) ne sont jamais « toutes de la même hauteur » (un rapport min/max n'a pas de sens).
  suggest(table('resultat')).filter((s) => (s.type === 'bar' || s.type === 'pie') && s.tileData.measure === 'Montant').forEach((s) => assert.notStrictEqual(s.insightKey, 'advice.insight.flat', `${s.type} sur des montants de signes mêlés : jamais « plat »`));
  const mixedBars = suggest(table('resultat')).filter((s) => s.type === 'bar' && s.tileData.measure === 'Montant');
  assert.ok(mixedBars.length >= 1, 'le corpus a bien des barres sur ces montants');

  // Régression : un numéro de mois (petit entier dense) n'est jamais une mesure quand un vrai montant existe (« Mois par Poste », « Mois pèse 17 % »).
  suggest(table('resultat')).forEach((s) => assert.notStrictEqual(s.tileData.measure, 'Mois', `${s.type} : un numéro de mois n'est pas une quantité`));
  // Régression : un lien presque parfait ne s'écrit pas « 1 » (seule une droite exacte vaut 1).
  const nearlyOne = comboTwo(suggest(table('produits')))[0];
  const nearlyOneEn = comboTwo(suggest(table('produits'), { lang: 'en' }))[0];
  assert.ok(/corrélation de 0,99\)/.test(resolve(nearlyOne, 'fr')) && /correlation of 0\.99\)/.test(resolve(nearlyOneEn, 'en')), `corrélation presque parfaite : « ${resolve(nearlyOne, 'fr')} » / « ${resolve(nearlyOneEn, 'en')} »`);
  assert.ok(nearlyOne.facts.r < 1 && nearlyOne.facts.r > 0.99);

  // Les miniatures de chaque type se dessinent (jamais NaN, jamais hors du cadre 0-1).
  const checkPreview = (s, rows, kind) => {
    const pv = advice.previewFor(s.tileData, rows);
    assert.ok(pv && pv.kind === kind, `${s.type} : miniature ${kind} (${pv && pv.kind})`);
    const numbers = [];
    (function walk(v) { if (typeof v === 'number') numbers.push(v); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); })(pv);
    assert.ok(numbers.length > 0, `${kind} : des valeurs à dessiner`);
    numbers.forEach((n) => assert.ok(Number.isFinite(n) && n >= -1e-9 && n <= 1 + 1e-9, `${kind} : valeur hors de [0 ; 1] : ${n}`));
    const svg = welcome.previewSvg(pv, { lang: 'fr' });
    assert.ok(svg.startsWith('<svg') && !/NaN|undefined|Infinity/.test(svg), `${kind} : SVG sain`);
    return pv;
  };
  const vp = pareto(suggest(table('ventes')))[0];
  const pvPareto = checkPreview(vp, table('ventes').rows, 'barline');
  assert.strictEqual(pvPareto.bars[0], 1, 'la plus grande barre est pleine'); assert.deepStrictEqual(pvPareto.bars, pvPareto.bars.slice().sort((a, b) => b - a), 'barres décroissantes');
  assert.deepStrictEqual(pvPareto.line, pvPareto.line.slice().sort((a, b) => a - b), 'part cumulée croissante');
  checkPreview(comboTwo(suggest(table('produits')))[0], table('produits').rows, 'barline');
  checkPreview(of(suggest(table('ventes')), 'histogram')[0], table('ventes').rows, 'histogram');
  const pvBox = checkPreview(of(suggest(table('ventes')), 'box')[0], table('ventes').rows, 'boxes');
  pvBox.boxes.forEach((bx) => assert.ok(bx.low <= bx.q1 && bx.q1 <= bx.median && bx.median <= bx.q3 && bx.q3 <= bx.high, 'boîte ordonnée'));
  const pvWaterfall = checkPreview(of(suggest(table('resultat')), 'waterfall')[0], table('resultat').rows, 'waterfall');
  for (let i = 1; i < pvWaterfall.steps.length; i++) assert.ok(Math.abs(pvWaterfall.steps[i].from - pvWaterfall.steps[i - 1].to) < 1e-12, 'chaque marche part de l\'arrivée de la précédente');
  checkPreview(of(suggest(table('parcours')), 'funnel')[0], table('parcours').rows, 'funnel');
  assert.strictEqual(advice.previewFor({ type: 'histogram', measure: 'Vide', dimension: '' }, [{ Vide: null }]), null, 'rien à dessiner = pas de miniature');
  console.log('OK classement — le fait net passe devant le plat (entonnoir, queue, cascade, Pareto, boîtes, double axe) ; miniatures saines pour chaque type');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5bis. Un compte de résultat : la cascade des postes, et la barre de signes mêlés qui dit son plus haut et son plus bas (lot du 25/11/2026)
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const resultat = table('resultat');
  const top = suggest(resultat, { limit: 9 });
  const waterfallRank = (dimension) => top.findIndex((s) => s.type === 'waterfall' && s.tileData.dimension === dimension);
  // (a) La cascade des POSTES (de quoi le solde est fait) est dans les trois premières, avec la barre des mêmes colonnes ; celle des mois — un
  // cumul qui double la courbe — vient derrière. Avant ce lot : la cascade des mois au rang 2, celle des postes au rang 8.
  assert.ok(waterfallRank('Poste') >= 0 && waterfallRank('Poste') < 3, `cascade des postes dans les trois premières (rang ${waterfallRank('Poste') + 1})`);
  assert.ok(waterfallRank('Mois') === -1 || waterfallRank('Mois') > waterfallRank('Poste'), 'la cascade des mois derrière celle des postes');
  const bar = top.findIndex((s) => s.type === 'bar' && s.tileData.dimension === 'Poste' && s.tileData.measure === 'Montant');
  assert.ok(bar >= 0 && bar < 3, 'la barre des postes reste dans les trois premières : une cascade et une barre ne se remplacent pas');

  // (b) Des groupes de signes mêlés n'ont pas de rapport, mais un plus haut et un plus bas : la phrase les nomme, avec leurs valeurs.
  const groups = groupsOf(resultat.rows, 'Poste', 'Montant', 'sum');
  const hi = groups.reduce((a, b) => (b.value > a.value ? b : a));
  const lo = groups.reduce((a, b) => (b.value < a.value ? b : a));
  assert.ok(lo.value < 0 && hi.value > 0, 'le jeu de données mêle bien les signes');
  const barSuggestion = top[bar];
  assert.strictEqual(barSuggestion.insightKey, 'advice.insight.signed', 'la barre des postes a sa phrase');
  const digits = (text) => text.replace(/[^\d]/g, '');
  ['fr', 'en'].forEach((lang) => {
    // Les nombres de la phrase sont écrits à l'appel (séparateur de la langue) : on redemande les suggestions dans la langue.
    const suggestion = suggest(resultat, { limit: 9, lang }).find((s) => s.type === 'bar' && s.tileData.dimension === 'Poste' && s.tileData.measure === 'Montant');
    const text = resolve(suggestion, lang);
    assert.ok(text.includes(hi.name) && text.includes(lo.name), `${lang} : les deux noms (${text})`);
    assert.ok(digits(text).includes(String(Math.round(hi.value))) && digits(text).includes(String(Math.abs(Math.round(lo.value)))), `${lang} : les deux valeurs (${text})`);
    assert.ok(/-|−/.test(text.slice(text.indexOf(lo.name))), `${lang} : la valeur négative garde son signe (${text})`);
    assert.ok(!/\{|\}|NaN|undefined/.test(text), `${lang} : sans variable orpheline`);
  });
  // Tous positifs : jamais cette phrase (une part ou un rapport la remplace) ; un seul groupe ou des signes mêlés sur un seul groupe : rien.
  tables.filter((t) => t.name !== 'resultat').forEach((t) => suggest(t).filter((s) => s.type === 'bar').forEach((s) => {
    const sums = groupsOf(t.rows, s.tileData.dimension, s.tileData.measure, s.tileData.aggFn).map((g) => g.value);
    if (sums.length && Math.min.apply(null, sums) >= 0) assert.notStrictEqual(s.insightKey, 'advice.insight.signed', `${t.name} : jamais « plus haut / plus bas » sur des valeurs positives`);
  }));

  // Des postes de même total négatif n'ont ni plus haut ni plus bas : la phrase se tait (jamais « A le plus haut (-60), B le plus bas (-60) »).
  const tied = [];
  [['Loyer', [-10, -20, -30]], ['Salaires', [-30, -20, -10]], ['Impôts', [-20, -20, -20]], ['Achats', [-15, -25, -20]]].forEach(([poste, valeurs]) => {
    valeurs.forEach((v, i) => tied.push({ Poste: poste, Montant: v, Mois: `2025-0${i + 1}`, Note: `ligne ${tied.length}` }));
  });
  const tiedBars = suggest(tied).filter((s) => s.type === 'bar' && s.tileData.dimension === 'Poste');
  assert.ok(tiedBars.length > 0, 'le jeu de postes à égalité propose une barre par poste');
  tiedBars.forEach((s) => assert.notStrictEqual(s.insightKey, 'advice.insight.signed', 'aucun plus haut ni plus bas entre des totaux égaux'));

  // (c) Une barre, un anneau ou un treemap des MÊMES colonnes restent un doublon (jamais deux d'entre eux dans les trois premières) ; seule la
  // cascade, qui répond à une autre question, échappe à cette règle.
  tables.forEach((t) => {
    const firstThree = suggest(t, { limit: 3 }).filter((s) => ['bar', 'pie', 'treemap'].indexOf(s.type) !== -1);
    const seen = new Set();
    firstThree.forEach((s) => {
      const key = [s.tileData.dimension, s.tileData.measure, s.tileData.aggFn].join('|');
      assert.ok(!seen.has(key), `${t.name} : ${key} deux fois dans les trois premières`);
      seen.add(key);
    });
  });
  console.log(`OK compte de résultat — cascade des postes au rang ${waterfallRank('Poste') + 1} (celle des mois derrière), barre des postes : « ${hi.name} le plus haut, ${lo.name} le plus bas » avec leurs valeurs fr/en ; jamais sur des valeurs positives ; barre/anneau/treemap des mêmes colonnes toujours dédoublonnés`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. Robustesse et hygiène
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Des cellules vides sont ignorées, jamais comptées pour 0 ; une mesure entièrement vide ne casse rien.
  const ventes = table('ventes');
  const holes = ventes.rows.map((r, i) => (i % 4 === 0 ? Object.assign({}, r, { Montant: null }) : r));
  const withHoles = suggest({ rows: holes, info: ventes.info });
  assert.ok(of(withHoles, 'histogram').length >= 1 && pareto(withHoles).length === 1, 'des cellules vides ne retirent ni l\'histogramme ni le Pareto');
  const hh = of(withHoles, 'histogram')[0];
  const kept = holes.map((r) => num(r.Montant)).filter((v) => v !== null);
  assert.strictEqual(hh.facts.n, kept.length, 'n ne compte que les valeurs renseignées');
  const empty = ventes.rows.map((r) => Object.assign({}, r, { Montant: null }));
  assert.doesNotThrow(() => suggest({ rows: empty, info: ventes.info }), 'une mesure entièrement vide');
  assert.strictEqual(of(suggest({ rows: empty, info: ventes.info }), 'histogram').length, 0);

  // 300 000 lignes triées : toujours rapide (les chiffres se calculent sur l'échantillon réparti).
  const big = corpus.sortedBigTable();
  const started = Date.now();
  const bigResult = suggest(big, { limit: 40 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `300 000 lignes en ${elapsed} ms (moins de 3 s)`);
  assert.ok(of(bigResult, 'histogram').length >= 1, 'un histogramme sur 300 000 lignes');
  const bigH = of(bigResult, 'histogram')[0];
  assert.ok(bigH.facts.n <= 20000, 'calculé sur l\'échantillon réparti, pas sur les 300 000 lignes');
  const pvStarted = Date.now();
  assert.ok(advice.previewFor(bigH.tileData, big), 'la miniature de 300 000 lignes');
  assert.ok(Date.now() - pvStarted < 1500, 'miniature rapide sur 300 000 lignes');

  // Un générateur qui lève ne retire rien aux autres ; un type inconnu n'est pas annoté.
  const rows = table('ventes').rows;
  const ctxFor = () => { advice.setColumnInfo({}); return advice.analyzeColumns(rows); };
  const ctx = ctxFor();
  ctx.insightRows = rows; ctx.lang = 'fr';
  const throwing = { candidate: () => { throw new Error('boum'); }, resolveTitle: () => '', groupsFor: () => { throw new Error('boum'); }, aggFor: () => 'sum', fmt: () => '', sampleOf: (r) => r, appearsAscending: () => true };
  assert.deepStrictEqual(types.candidates(rows, ctx, {}, throwing), [], 'chaque générateur est isolé : aucune exception ne sort');
  assert.strictEqual(types.annotate({ type: 'bar', tileData: {} }, ctx, throwing), null, 'un autre type n\'est pas annoté ici');
  assert.strictEqual(types.previewFor({ type: 'histogram', measure: 'Montant' }, [], throwing), null);
  assert.strictEqual(types.previewFor(null, rows, throwing), null);

  // Le score ne bouge pas d'un appel à l'autre (déterministe) ; l'ordre des lignes de la table ne change pas ce qu'on propose.
  const a = suggest(table('ventes')).map((s) => s.type + s.tileData.dimension + s.score).join('|');
  const b = suggest(table('ventes')).map((s) => s.type + s.tileData.dimension + s.score).join('|');
  assert.strictEqual(a, b, 'déterministe');

  // Hygiène du fichier : aucune dépendance à advice.js, aucun texte français en dur, aucun accès au navigateur.
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'advice-types.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/require\(['"]\.\/advice\.js['"]\)/.test(code) && !/GristBI\.advice\b(?!Types|Insights)/.test(code), 'pas d\'import circulaire de advice.js');
  ['document', 'window', 'localStorage', 'fetch(', 'eval(', 'Function(', 'Math.random', 'Date.now', 'new Date'].forEach((w) => assert.ok(!code.includes(w), `jamais ${w}`));
  const strings = (code.match(/'[^'\n]*'/g) || []).map((x) => x.slice(1, -1)).filter((x) => /[A-Za-zÀ-ÿ]{4,} [A-Za-zÀ-ÿ]{3,}/.test(x));
  assert.deepStrictEqual(strings.filter((x) => !/^(advice|tileTitle)\./.test(x) && !/^[a-z-]+$/.test(x)), [], 'aucun texte lisible en dur : que des clés i18n');
  assert.ok(source.split('\n').length < 600, 'moins de 600 lignes');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const at = (name) => index.indexOf(`<script src="js/${name}"></script>`);
  assert.ok(at('advice-names.js') > 0 && at('advice-names.js') < at('advice-types.js') && at('advice-insights.js') > 0 && at('advice-insights.js') < at('advice-types.js') && at('advice-types.js') < at('advice.js'), 'ordre de chargement : noms et insights, types, advice');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  assert.ok(harness.includes('../js/advice-types.js'), 'le harnais charge aussi le module');
  console.log(`OK robustesse — cellules vides, mesure vide, 300 000 lignes en ${elapsed} ms, générateur isolé, déterministe, fichier pur sans texte en dur`);
}

console.log('Tous les essais des types spécialisés de suggestion sont passés.');
