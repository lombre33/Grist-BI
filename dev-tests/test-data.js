/*
 * Tests unitaires (Node, sans navigateur ni Grist) des fonctions pures de js/data.js, js/state.js,
 * js/demo-data.js, js/combobox.js et js/i18n.js. Lancer avec: node dev-tests/test-data.js
 */
const assert = require('assert');
const zlib = require('zlib');
const data = require('../js/data.js');
const state = require('../js/state.js');
const demoData = require('../js/demo-data.js');
const combobox = require('../js/combobox.js');
const duckdbEngine = require('../js/duckdb-engine.js');
const i18n = require('../js/i18n.js');
const pbixLayout = require('../js/pbix-layout.js');
const csvImport = require('../js/csv-import.js');
const keywords = require('../js/keywords.js');
const pdfText = require('../js/pdf-text.js');
const advice = require('../js/advice.js');
const welcome = require('../js/welcome.js');
const models = require('../js/models.js');

const rows = [
  { id: 1, Region: 'Nord', Montant: 100 },
  { id: 2, Region: 'Nord', Montant: 50 },
  { id: 3, Region: 'Sud', Montant: 30 },
  { id: 4, Region: 'Sud', Montant: 70 }
];

// groupByAggregate
{
  const agg = data.groupByAggregate(rows, 'Region', 'Montant', 'sum');
  assert.deepStrictEqual(agg, [
    { dimension: 'Nord', value: 150 },
    { dimension: 'Sud', value: 100 }
  ]);
  console.log('OK groupByAggregate(sum)');
}

{
  const agg = data.groupByAggregate(rows, 'Region', 'Montant', 'avg');
  assert.strictEqual(agg.find((d) => d.dimension === 'Nord').value, 75);
  console.log('OK groupByAggregate(avg)');
}

// sortGroups / isSortableTile : tri d'AFFICHAGE optionnel (barres, courbe/aire, camembert), séparé de
// groupByAggregate qui garde son ordre d'apparition (piège n°14, CLAUDE.md §7)
{
  const agg = [
    { dimension: 'T10', value: 5 }, { dimension: 'T2', value: 40 }, { dimension: 'T1', value: null },
    { dimension: 'T3', value: 12 }, { dimension: 'T4', value: NaN }
  ];
  const original = agg.map((d) => d.dimension);
  // Valeur décroissante : valeurs absentes (null/NaN) toujours en dernier, quel que soit le sens
  assert.deepStrictEqual(data.sortGroups(agg, 'value-desc').map((d) => d.dimension), ['T2', 'T3', 'T10', 'T1', 'T4']);
  assert.deepStrictEqual(data.sortGroups(agg, 'value-asc').map((d) => d.dimension), ['T10', 'T3', 'T2', 'T1', 'T4']);
  // Libellé : tri « naturel » (T2 avant T10), pas alphabétique brut (T10 avant T2)
  assert.deepStrictEqual(data.sortGroups(agg, 'label').map((d) => d.dimension), ['T1', 'T2', 'T3', 'T4', 'T10']);
  // Libellés numériques (ex. Annee = 2025, un nombre) : ordre numérique, pas lexicographique
  assert.deepStrictEqual(
    data.sortGroups([{ dimension: 100, value: 1 }, { dimension: 20, value: 2 }, { dimension: 3, value: 3 }], 'label').map((d) => d.dimension),
    [3, 20, 100]
  );
  // Jamais de tri en place, et sans mode (ou mode inconnu) : l'agrégat revient TEL QUEL
  assert.deepStrictEqual(agg.map((d) => d.dimension), original);
  assert.strictEqual(data.sortGroups(agg, undefined), agg);
  assert.strictEqual(data.sortGroups(agg, ''), agg);
  assert.strictEqual(data.sortGroups(agg, 'mode-futur-inconnu'), agg);
  assert.deepStrictEqual(data.sortGroups([], 'value-desc'), []);

  // Types triables : Barres (hors mode mesure temporelle), Courbe/aire, Camembert — jamais Cascade
  // (l'ordre EST le sens du cumul), Treemap, Radar, Nuage de mots, KPI
  assert.strictEqual(data.isSortableTile({ type: 'bar' }), true);
  assert.strictEqual(data.isSortableTile({ type: 'bar', measureMode: 'brut' }), true);
  assert.strictEqual(data.isSortableTile({ type: 'bar', measureMode: 'ytd' }), false);
  assert.strictEqual(data.isSortableTile({ type: 'line' }), true);
  assert.strictEqual(data.isSortableTile({ type: 'pie' }), true);
  assert.strictEqual(data.isSortableTile({ type: 'funnel' }), true); // l'entonnoir pose `sort: 'none'` : c'est ce tri-ci qui ordonne les étapes
  for (const type of ['waterfall', 'treemap', 'radar', 'wordcloud', 'kpi', 'gauge', 'scatter', 'pivot']) {
    assert.strictEqual(data.isSortableTile({ type }), false, type);
  }
  assert.strictEqual(data.isSortableTile(null), false);

  // Export Excel = ordre affiché : tileExportSheet applique le même tri, jamais à un type non triable
  const exportRows = [
    { Region: 'Nord', Montant: 100 }, { Region: 'Sud', Montant: 150 }, { Region: 'Est', Montant: 40 }
  ];
  const sortState = { rows: exportRows, activeFilters: [], advancedFilters: [], drillIns: {} };
  const tileOf = (type, extra) => Object.assign({ id: 't', type, title: 'x', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }, extra);
  assert.deepStrictEqual(data.tileExportSheet(tileOf('bar'), sortState).rows.map((r) => r[0]), ['Nord', 'Sud', 'Est']);
  assert.deepStrictEqual(data.tileExportSheet(tileOf('bar', { sortMode: 'value-desc' }), sortState).rows.map((r) => r[0]), ['Sud', 'Nord', 'Est']);
  assert.deepStrictEqual(data.tileExportSheet(tileOf('line', { sortMode: 'label' }), sortState).rows.map((r) => r[0]), ['Est', 'Nord', 'Sud']);
  assert.deepStrictEqual(data.tileExportSheet(tileOf('pie', { sortMode: 'value-asc' }), sortState).rows.map((r) => r[0]), ['Est', 'Nord', 'Sud']);
  // Entonnoir : trié comme un camembert (valeur décroissante) ou, sans tri, dans l'ordre des données (étapes déjà rangées)
  assert.deepStrictEqual(data.tileExportSheet(tileOf('funnel', { sortMode: 'value-desc' }), sortState).rows.map((r) => r[0]), ['Sud', 'Nord', 'Est']);
  assert.deepStrictEqual(data.tileExportSheet(tileOf('funnel'), sortState).rows.map((r) => r[0]), ['Nord', 'Sud', 'Est']);
  assert.strictEqual(data.tileExportKind(tileOf('funnel')), 'image');
  // Cascade : sortMode (même s'il traînait sur la tuile) est ignoré
  assert.deepStrictEqual(data.tileExportSheet(tileOf('waterfall', { sortMode: 'value-desc' }), sortState).rows.map((r) => r[0]), ['Nord', 'Sud', 'Est']);
  // Courbe sans option d'aire : même export que Barres (même chemin de code, en-têtes inclus)
  assert.deepStrictEqual(data.tileExportSheet(tileOf('line'), sortState), data.tileExportSheet(tileOf('bar'), sortState));
  console.log('OK sortGroups / isSortableTile / tileExportSheet (tri d\'affichage, valeurs absentes en dernier, types non triables intacts)');
}

// Séries multiples (`tile.seriesColumn`) : barres (hors mode mesure) et courbe/aire.
{
  const sRows = [
    { Region: 'Nord', Produit: 'A', Montant: 10 }, { Region: 'Nord', Produit: 'B', Montant: 5 },
    { Region: 'Sud', Produit: 'A', Montant: 30 },
    { Region: 'Est', Produit: 'B', Montant: 7 }, { Region: 'Est', Produit: 'A', Montant: 1 },
    { Region: 'Ouest', Produit: '', Montant: 2 }, { Region: 'Ouest', Produit: null, Montant: 3 }
  ];
  const mk = (type, extra) => Object.assign({ id: 't', type, title: 'x', dimension: 'Region', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Produit' }, extra);
  // Types concernés : barres brutes et courbe/aire — jamais un type à une seule série par nature, ni sans colonne
  assert.strictEqual(data.isSeriesTile(mk('bar')), true);
  assert.strictEqual(data.isSeriesTile(mk('bar', { measureMode: 'brut' })), true);
  assert.strictEqual(data.isSeriesTile(mk('bar', { measureMode: 'ytd' })), false, 'mode mesure temporelle : une seule série');
  assert.strictEqual(data.isSeriesTile(mk('line')), true);
  assert.strictEqual(data.isSeriesTile(mk('line', { areaFill: true })), true);
  for (const type of ['pie', 'funnel', 'treemap', 'waterfall', 'radar', 'scatter', 'kpi', 'gauge', 'pivot', 'wordcloud']) {
    assert.strictEqual(data.isSeriesTile(mk(type)), false, type);
  }
  assert.strictEqual(data.isSeriesTile(mk('bar', { seriesColumn: '' })), false);
  assert.strictEqual(data.isSeriesTile(mk('bar', { seriesColumn: undefined })), false);
  assert.strictEqual(data.isSeriesTile(null), false);

  // splitBySeries : ordre de première apparition (piège n°14), cellule vide/null regroupées sous leur clé propre
  const parts = data.splitBySeries(sRows, 'Produit', '(vide)');
  assert.deepStrictEqual(parts.map((p) => p.name), ['A', 'B', '(vide)', '(vide)']);
  assert.deepStrictEqual(parts.map((p) => p.rows.length), [3, 2, 1, 1]);
  assert.strictEqual(data.splitBySeries([], 'Produit').length, 0);
  assert.strictEqual(data.splitBySeries([{ P: 3 }], 'P')[0].name, '3', 'une valeur numérique devient son libellé texte');

  // assembleSeries : trou = null (jamais 0), ordre des catégories = ordre d'apparition sans tri
  const cats = data.groupByAggregate(sRows, 'Region', 'Montant', 'sum').map((d) => d.dimension);
  const per = [
    { name: 'A', groups: data.groupByAggregate(parts[0].rows, 'Region', 'Montant', 'sum') },
    { name: 'B', groups: data.groupByAggregate(parts[1].rows, 'Region', 'Montant', 'sum') }
  ];
  const asm = data.assembleSeries(cats, per, undefined);
  assert.deepStrictEqual(asm.categories, ['Nord', 'Sud', 'Est', 'Ouest']);
  assert.deepStrictEqual(asm.series.map((x) => x.name), ['A', 'B']);
  assert.deepStrictEqual(asm.series[0].values, [10, 30, 1, null]);
  assert.deepStrictEqual(asm.series[1].values, [5, null, 7, null]);
  // Tri sur le TOTAL des séries : Sud (30) > Nord (15) > Est (8) > Ouest (0)
  const desc = data.assembleSeries(cats, per, 'value-desc');
  assert.deepStrictEqual(desc.categories, ['Sud', 'Nord', 'Est', 'Ouest']);
  assert.deepStrictEqual(desc.series[0].values, [30, 10, 1, null], 'les valeurs suivent leur catégorie dans chaque série');
  assert.deepStrictEqual(desc.series[1].values, [null, 5, 7, null]);
  assert.deepStrictEqual(data.assembleSeries(cats, per, 'label').categories, ['Est', 'Nord', 'Ouest', 'Sud']);
  assert.deepStrictEqual(data.assembleSeries(cats, per, 'mode-futur-inconnu').categories, cats, 'mode inconnu : ordre d\'apparition');
  // Jamais de mutation des entrées
  assert.deepStrictEqual(cats, ['Nord', 'Sud', 'Est', 'Ouest']);
  assert.strictEqual(per[0].groups.length, 3);
  // Aucune catégorie : structure vide mais valide
  const none = data.assembleSeries([], per, 'value-desc');
  assert.deepStrictEqual(none.categories, []);
  assert.deepStrictEqual(none.series.map((x) => x.values), [[], []]);

  // Bug réel du 18/11/2026 : DuckDB-WASM rend une dimension entière en BigInt (2022n), le JS pur en
  // nombre (2022) ; `assembleSeries` recevait les catégories d'un moteur et les séries de l'autre (au-delà
  // de 5 000 lignes au total, chaque série reste sous le seuil) et ne retrouvait aucune valeur.
  {
    const bigCats = [2022n, 2023n, 2024n];
    const mixed = [
      { name: 'A', groups: [{ dimension: 2022, value: 10 }, { dimension: 2024, value: 30 }] },
      { name: 'B', groups: [{ dimension: 2023, value: 5 }] }
    ];
    const m = data.assembleSeries(bigCats, mixed, undefined);
    assert.deepStrictEqual(m.series[0].values, [10, null, 30], 'BigInt contre nombre : la valeur est retrouvée');
    assert.deepStrictEqual(m.series[1].values, [null, 5, null]);
    const sorted = data.assembleSeries(bigCats, mixed, 'value-desc');
    assert.deepStrictEqual(sorted.series[0].values, [30, 10, null], 'le tri sur le total voit aussi les valeurs');
    // L'inverse (catégories en nombre, séries en BigInt) et la chaîne « 2022 » : même clé.
    assert.deepStrictEqual(data.assembleSeries([2022, 2023], [{ name: 'A', groups: [{ dimension: 2023n, value: 7 }] }], undefined).series[0].values, [null, 7]);
    assert.deepStrictEqual(data.assembleSeries(['2022'], [{ name: 'A', groups: [{ dimension: 2022, value: 1 }] }], undefined).series[0].values, [1]);
    // null reste une catégorie à part, jamais confondue avec la chaîne « null ».
    assert.deepStrictEqual(data.assembleSeries([null, 'null'], [{ name: 'A', groups: [{ dimension: null, value: 3 }] }], undefined).series[0].values, [3, null]);
    console.log('OK assembleSeries — catégories BigInt (DuckDB) contre séries en nombre (JS) : valeurs retrouvées, null distinct de « null »');
  }

  // Export Excel : une colonne par série, mêmes catégories/ordre que le rendu, cellule vide (pas 0) pour un trou
  const st = { rows: sRows, activeFilters: [], advancedFilters: [], drillIns: {} };
  const sheet = data.tileExportSheet(mk('bar'), st);
  assert.deepStrictEqual(sheet.header, ['Region', 'A', 'B', '(vide)', '(vide)']);
  assert.deepStrictEqual(sheet.rows[0], ['Nord', 10, 5, '', '']);
  assert.deepStrictEqual(sheet.rows[1], ['Sud', 30, '', '', '']);
  assert.deepStrictEqual(sheet.rows.map((r) => r[0]), ['Nord', 'Sud', 'Est', 'Ouest']);
  assert.deepStrictEqual(data.tileExportSheet(mk('bar', { sortMode: 'value-desc' }), st).rows.map((r) => r[0]), ['Sud', 'Nord', 'Est', 'Ouest']);
  // Sans colonne Séries : l'export historique (2 colonnes) est INCHANGÉ
  assert.deepStrictEqual(data.tileExportSheet(mk('bar', { seriesColumn: '' }), st).header, ['Region', 'Montant']);
  // Un filtre croisé s'applique avant le découpage : la série sans ligne restante disparaît
  const filtered = data.tileExportSheet(mk('bar'), { rows: sRows, activeFilters: [{ column: 'Region', value: 'Sud' }], advancedFilters: [], drillIns: {} });
  assert.deepStrictEqual(filtered.header, ['Region', 'A']);
  assert.deepStrictEqual(filtered.rows, [['Sud', 30]]);
  console.log('OK séries multiples — isSeriesTile / splitBySeries / assembleSeries (trous null, tri sur total, ordre d\'apparition) / export Excel');
}

// Empilé (`tile.stacked`) : barres et AIRE avec une colonne Séries.
{
  const mk = (type, extra) => Object.assign({ id: 't', type, title: 'x', dimension: 'Region', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Produit', stacked: true }, extra);
  assert.strictEqual(data.isStackedTile(mk('bar')), true);
  assert.strictEqual(data.isStackedTile(mk('bar', { horizontal: true })), true);
  assert.strictEqual(data.isStackedTile(mk('line', { areaFill: true })), true);
  assert.strictEqual(data.isStackedTile(mk('line')), false, 'courbe sans remplissage : pas de pile');
  assert.strictEqual(data.isStackedTile(mk('bar', { stacked: false })), false);
  assert.strictEqual(data.isStackedTile(mk('bar', { stacked: undefined })), false);
  assert.strictEqual(data.isStackedTile(mk('bar', { seriesColumn: '' })), false, 'sans série, rien à empiler');
  assert.strictEqual(data.isStackedTile(mk('bar', { measureMode: 'ytd' })), false, 'mode mesure temporelle : une seule série');
  for (const type of ['pie', 'funnel', 'treemap', 'waterfall', 'radar', 'scatter', 'kpi', 'gauge', 'pivot']) {
    assert.strictEqual(data.isStackedTile(mk(type, { areaFill: true })), false, type);
  }
  assert.strictEqual(data.isStackedTile(null), false);
  // L'empilement est purement visuel : l'export Excel d'une tuile empilée est celui de la même tuile non empilée
  const st = { rows: [{ Region: 'Nord', Produit: 'A', Montant: 10 }, { Region: 'Nord', Produit: 'B', Montant: 5 }, { Region: 'Sud', Produit: 'A', Montant: 30 }], activeFilters: [], advancedFilters: [], drillIns: {} };
  assert.deepStrictEqual(data.tileExportSheet(mk('bar'), st), data.tileExportSheet(mk('bar', { stacked: false }), st));
  console.log('OK empilé — isStackedTile (barres et aire seulement, avec une colonne Séries), export Excel inchangé');
}

// Palettes de couleurs (`tile.palette`).
{
  const fsP = require('fs');
  const pathP = require('path');
  assert.deepStrictEqual(data.PALETTE_KEYS, ['standard', 'okabe', 'blue', 'orange', 'green', 'gray']);
  // `standard` est la palette HISTORIQUE : une tuile sans choix doit rester identique, octet pour octet
  assert.deepStrictEqual(data.PALETTES.standard, ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']);
  // La miniature de l'accueil (js/welcome.js) garde sa propre copie : elle doit rester la même
  const welcomeSrc = fsP.readFileSync(pathP.join(__dirname, '..', 'js', 'welcome.js'), 'utf8');
  const welcomeCopy = /const PALETTE = (\[[^\]]+\]);/.exec(welcomeSrc);
  assert.ok(welcomeCopy, 'js/welcome.js : const PALETTE introuvable');
  assert.deepStrictEqual(JSON.parse(welcomeCopy[1].replace(/'/g, '"')), data.PALETTES.standard, 'js/welcome.js:PALETTE diverge de data.PALETTES.standard');
  // Clé inconnue ou piégée -> standard, jamais undefined
  for (const key of [undefined, null, '', 'inconnue', 'constructor', '__proto__', 'toString', 42]) {
    assert.strictEqual(data.paletteColors(key), data.PALETTES.standard, String(key));
  }
  assert.strictEqual(data.paletteColors('okabe'), data.PALETTES.okabe);
  // Types qui suivent la palette ; la cascade (vert/rouge = sens), le KPI et le tableau croisé non
  for (const type of ['bar', 'line', 'pie', 'funnel', 'treemap', 'scatter', 'radar', 'gauge', 'wordcloud']) assert.strictEqual(data.supportsPalette({ type }), true, type);
  for (const type of ['waterfall', 'kpi', 'pivot', 'inconnu']) assert.strictEqual(data.supportsPalette({ type }), false, type);
  assert.strictEqual(data.supportsPalette(null), false);
  // Garde-fous de forme et de validation (le validateur de la skill dataviz n'est pas dans le dépôt : on
  // rejoue ici ses vérifications de rampe, valeur par valeur, pour qu'une retouche à la main ne les casse pas)
  const lin = (c) => { const v = parseInt(c, 16) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const rgb = (hex) => [lin(hex.slice(1, 3)), lin(hex.slice(3, 5)), lin(hex.slice(5, 7))];
  const relLum = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const oklabL = (hex) => {
    const [r, g, b] = rgb(hex);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const sv = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * sv;
  };
  for (const key of data.PALETTE_KEYS) {
    const colors = data.PALETTES[key];
    assert.ok(colors.length >= 6 && colors.every((c) => /^#[0-9a-f]{6}$/.test(c)), key + ' : hex #rrggbb en minuscules');
    assert.strictEqual(new Set(colors).size, colors.length, key + ' : aucune couleur en double');
  }
  for (const key of ['blue', 'orange', 'green', 'gray']) {
    const colors = data.PALETTES[key];
    const Ls = colors.map(oklabL);
    for (let i = 1; i < Ls.length; i++) assert.ok(Ls[i] - Ls[i - 1] >= 0.06, key + ' : écart de luminosité entre pas voisins ' + i + ' = ' + (Ls[i] - Ls[i - 1]).toFixed(3) + ' (< 0,06, du foncé au clair)');
    for (const surface of ['#fcfcfb', '#ffffff']) assert.ok(contrast(colors[colors.length - 1], surface) >= 2.0, key + ' : pas le plus clair < 2:1 sur ' + surface);
  }
  // Okabe-Ito : les 6 teintes restent dans la bande de luminosité de la skill (0,43-0,77)
  for (const c of data.PALETTES.okabe) assert.ok(oklabL(c) >= 0.43 && oklabL(c) <= 0.77, 'okabe ' + c + ' hors bande : ' + oklabL(c).toFixed(3));
  console.log('OK palettes — historique inchangée, repli sur standard, types concernés, rampes (luminosité, contraste), Okabe-Ito dans la bande');
}

{
  const agg = data.groupByAggregate(rows, 'Region', 'Montant', 'count');
  assert.strictEqual(agg.find((d) => d.dimension === 'Sud').value, 2);
  console.log('OK groupByAggregate(count)');
}

// groupByAggregate respecte l'ordre de première apparition, PAS un tri alphabétique — sinon
// "Mois" (Janvier/Février/Mars...) s'afficherait dans le désordre. Rows volontairement dans un
// ordre non-alphabétique pour ne pas masquer une régression par coïncidence.
{
  const monthRows = [
    { Mois: 'Mars', Montant: 10 },
    { Mois: 'Janvier', Montant: 20 },
    { Mois: 'Février', Montant: 5 }
  ];
  const agg = data.groupByAggregate(monthRows, 'Mois', 'Montant', 'sum');
  assert.deepStrictEqual(agg.map((d) => d.dimension), ['Mars', 'Janvier', 'Février']);
  console.log('OK groupByAggregate préserve l\'ordre de première apparition (pas alphabétique)');
}

// wordFrequency — mode "une entrée par ligne" : strictement délégué à groupByAggregate.
{
  const authorRows = [
    { Auteur: 'Alla F', Citations: 12 },
    { Auteur: 'Soubran C', Citations: 4 },
    { Auteur: 'Alla F', Citations: 7 }
  ];
  const agg = data.wordFrequency(authorRows, 'Auteur', false, 'Citations', 'sum');
  assert.deepStrictEqual(agg, data.groupByAggregate(authorRows, 'Auteur', 'Citations', 'sum'));
  console.log('OK wordFrequency (mode une entrée par ligne) = groupByAggregate');
}

// wordFrequency — mode "découpage de cellule" : fréquence cumulée sur toutes les lignes,
// insensible à la casse, graphie de la première occurrence conservée, mots de moins de 2
// caractères ignorés (ponctuation isolée issue du split).
{
  const keywordRows = [
    { Keywords: 'Santé, cohorte, génétique' },
    { Keywords: 'santé cohorte' },
    { Keywords: 'Mortality a' },
    { Keywords: null },
    { Keywords: '' }
  ];
  const agg = data.wordFrequency(keywordRows, 'Keywords', true);
  const byLabel = Object.fromEntries(agg.map((d) => [d.dimension.toLowerCase(), d.value]));
  assert.strictEqual(byLabel['santé'], 2);
  assert.strictEqual(byLabel['cohorte'], 2);
  assert.strictEqual(byLabel['génétique'], 1);
  assert.strictEqual(byLabel['mortality'], 1);
  assert.strictEqual('a' in byLabel, false); // mot d'une seule lettre ignoré
  assert.strictEqual(agg.find((d) => d.dimension === 'Santé') !== undefined, true); // 1re graphie
  console.log('OK wordFrequency (mode découpage de cellule)');
}

// applyFilters (ET entre tous les filtres passés)
{
  const filtered = data.applyFilters(rows, [{ column: 'Region', value: 'Sud' }]);
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(data.applyFilters(rows, []).length, 4);
  assert.strictEqual(data.applyFilters(rows, null).length, 4);
  const none = data.applyFilters(rows, [{ column: 'Region', value: 'Sud' }, { column: 'Montant', value: 999 }]);
  assert.strictEqual(none.length, 0); // ET: aucune ligne Sud n'a Montant=999
  console.log('OK applyFilters');
}

// applyFilters/sameValue : une valeur de filtre en chaîne doit matcher une colonne numérique.
// Cas réel : le clic ECharts (params.name) est TOUJOURS une chaîne, même pour une dimension
// numérique comme "Annee" — une comparaison stricte ('2025' === 2025 -> false) filtrerait tout.
{
  const yearRows = [{ Annee: 2025, Montant: 10 }, { Annee: 2026, Montant: 20 }];
  const filtered = data.applyFilters(yearRows, [{ column: 'Annee', value: '2025' }]); // value en string
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].Annee, 2025);
  assert.strictEqual(data.sameValue(2025, '2025'), true);
  assert.strictEqual(data.sameValue('Nord', 'Sud'), false);
  console.log('OK applyFilters/sameValue (comparaison robuste au type, ex. clic ECharts sur une dimension numérique)');
}

// applyFilters — filtre "range" (Roadmap Tier 1, filtres avancés) : bornes min/max, chacune
// optionnelle indépendamment, et une valeur non numérique ne matche jamais plutôt que de planter.
{
  const priceRows = [{ Montant: 10 }, { Montant: 50 }, { Montant: 100 }, { Montant: 'texte' }];
  assert.strictEqual(data.applyFilters(priceRows, [{ column: 'Montant', type: 'range', min: 20, max: 80 }]).length, 1);
  assert.strictEqual(data.applyFilters(priceRows, [{ column: 'Montant', type: 'range', min: 20 }]).length, 2); // pas de max -> non borné à droite
  assert.strictEqual(data.applyFilters(priceRows, [{ column: 'Montant', type: 'range', max: 50 }]).length, 2); // pas de min -> non borné à gauche
  assert.strictEqual(data.applyFilters(priceRows, [{ column: 'Montant', type: 'range', min: 0, max: 200 }]).length, 3); // la valeur texte ne matche jamais
  console.log('OK applyFilters — filtre "range" (bornes optionnelles indépendamment, valeur non numérique jamais matchée)');
}

// applyFilters — filtres "dateRange"/"relativeDate" sur la colonne Date (AAAA-MM-JJ), et
// parseDateValue/relativeDateRange en isolation.
{
  const dateRows = [
    { Date: '2026-09-10', Montant: 1 },
    { Date: '2026-09-14', Montant: 2 },
    { Date: '2026-09-16', Montant: 3 },
    { Date: 'pas une date', Montant: 4 }
  ];
  assert.strictEqual(data.parseDateValue('2026-09-16'), Date.parse('2026-09-16T00:00:00Z'));
  assert.strictEqual(data.parseDateValue('16/09/2026'), null, 'format non-ISO refusé plutôt que mal interprété');
  assert.strictEqual(data.parseDateValue('pas une date'), null);

  const inRange = data.applyFilters(dateRows, [{ column: 'Date', type: 'dateRange', start: '2026-09-12', end: '2026-09-16' }]);
  assert.deepStrictEqual(inRange.map((r) => r.Montant), [2, 3]); // borne 'start'/'end' inclusive des deux côtés
  assert.strictEqual(data.applyFilters(dateRows, [{ column: 'Date', type: 'dateRange', start: '2026-09-12' }]).length, 2); // pas de 'end' -> non borné à droite

  const now = Date.parse('2026-09-16T00:00:00Z');
  const last7d = data.applyFilters(dateRows, [{ column: 'Date', type: 'relativeDate', preset: 'last7d', now }]);
  assert.deepStrictEqual(last7d.map((r) => r.Montant), [1, 2, 3]); // 09-10 est exactement la borne basse (now-6j), incluse
  assert.strictEqual(data.relativeDateRange('last7d', now)[0], Date.parse('2026-09-10T00:00:00Z'));
  assert.strictEqual(data.relativeDateRange('inconnu', now), null, 'preset inconnu -> null plutôt qu\'une erreur');
  console.log('OK applyFilters — filtres "dateRange"/"relativeDate" + parseDateValue/relativeDateRange');
}

// applyFilters — filtre "contains" (recherche texte, insensible à la casse)
{
  const textRows = [{ Produit: 'Casque audio' }, { Produit: 'Clavier mécanique' }, { Produit: 'Souris sans fil' }];
  assert.strictEqual(data.applyFilters(textRows, [{ column: 'Produit', type: 'contains', query: 'clavier' }]).length, 1);
  assert.strictEqual(data.applyFilters(textRows, [{ column: 'Produit', type: 'contains', query: 'AUDIO' }]).length, 1); // insensible à la casse
  assert.strictEqual(data.applyFilters(textRows, [{ column: 'Produit', type: 'contains', query: 'inexistant' }]).length, 0);
  assert.strictEqual(data.applyFilters(textRows, [{ column: 'Produit', type: 'contains', query: '' }]).length, 3); // chaîne vide -> tout matche (contains de '')
  console.log('OK applyFilters — filtre "contains" (recherche texte insensible à la casse)');
}

// applyFilters — plusieurs filtres avancés de types différents combinés en ET, avec un filtre "eq"
// classique (issu d'un clic) en même temps : les deux mécanismes doivent pouvoir cohabiter.
{
  const combinedRows = [
    { Region: 'Nord', Montant: 50, Date: '2026-09-14' },
    { Region: 'Nord', Montant: 500, Date: '2026-09-14' },
    { Region: 'Sud', Montant: 50, Date: '2026-09-14' }
  ];
  const combined = data.applyFilters(combinedRows, [
    { column: 'Region', value: 'Nord' }, // eq, comme un clic ECharts
    { column: 'Montant', type: 'range', min: 0, max: 100 },
    { column: 'Date', type: 'dateRange', start: '2026-09-01', end: '2026-09-30' }
  ]);
  assert.strictEqual(combined.length, 1);
  console.log('OK applyFilters — filtre "eq" (clic) et filtres avancés typés combinés en ET');
}

// computeTrend (tendance KPI vs période précédente, sur une dimension numérique)
{
  const yearly = [
    { Annee: 2025, Montant: 100 }, { Annee: 2025, Montant: 100 },
    { Annee: 2026, Montant: 150 }, { Annee: 2026, Montant: 150 }
  ];
  const trend = data.computeTrend(yearly, 'Annee', 'Montant', 'sum');
  assert.strictEqual(trend.latestKey, 2026);
  assert.strictEqual(trend.previousKey, 2025);
  assert.strictEqual(trend.deltaPct, 50); // 300 vs 200 = +50%
  assert.strictEqual(data.computeTrend(yearly, null, 'Montant', 'sum'), null); // pas de dimension -> pas de tendance
  assert.strictEqual(data.computeTrend(yearly.filter((r) => r.Annee === 2026), 'Annee', 'Montant', 'sum'), null); // 1 seul groupe -> pas de tendance
  // Dimension texte (non numérique) -> pas de tendance plutôt qu'un delta absurde
  const textRows = [{ Mois: 'Janvier', Montant: 10 }, { Mois: 'Février', Montant: 20 }];
  assert.strictEqual(data.computeTrend(textRows, 'Mois', 'Montant', 'sum'), null);
  console.log('OK computeTrend');
}

// escapeHtml
{
  assert.strictEqual(data.escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
  console.log('OK escapeHtml');
}

// aggregateSingle
{
  assert.strictEqual(data.aggregateSingle(rows, 'Montant', 'sum'), 250);
  assert.strictEqual(data.aggregateSingle(rows, 'Montant', 'max'), 100);
  console.log('OK aggregateSingle');
}

// pivotTable (tableau croisé dynamique, Roadmap Tier 2) : regroupe par DEUX dimensions à la fois
{
  const pivotRows = [
    { Region: 'Nord', Produit: 'B', Montant: 10 },
    { Region: 'Nord', Produit: 'A', Montant: 20 },
    { Region: 'Nord', Produit: 'A', Montant: 5 },
    { Region: 'Sud', Produit: 'A', Montant: 30 }
    // Pas de ligne Sud/B : intersection volontairement absente (voir cellule `null` ci-dessous).
  ];
  const p = data.pivotTable(pivotRows, 'Region', 'Produit', 'Montant', 'sum');
  // Ordre de 1re apparition (Produit "B" vu avant "A" dans les données) — pas alphabétique, comme
  // groupByAggregate/distinctColumnValues : un tri alphabétique aurait donné ['A', 'B'].
  assert.deepStrictEqual(p.rowKeys, ['Nord', 'Sud']);
  assert.deepStrictEqual(p.colKeys, ['B', 'A']);
  assert.deepStrictEqual(p.cells, [[10, 25], [null, 30]]); // Sud/B : aucune ligne -> null, PAS 0
  assert.deepStrictEqual(p.rowTotals, [35, 30]);
  assert.deepStrictEqual(p.colTotals, [10, 55]);
  assert.strictEqual(p.grandTotal, 65);
  console.log('OK pivotTable (sum : ordre de 1re apparition, cellule sans donnée -> null, totaux)');
}

// pivotTable — avg : les totaux ligne/colonne/général doivent être calculés en agrégeant les lignes
// DIRECTEMENT (ignorant l'autre dimension), pas en recombinant les valeurs déjà agrégées des
// cellules affichées — recombiner fonctionnerait pour "somme" mais serait FAUX pour "moyenne" dès
// que les colonnes n'ont pas le même nombre de lignes (moyenne des moyennes != moyenne globale).
{
  const avgRows = [
    { Region: 'Nord', Produit: 'A', Montant: 10 },
    { Region: 'Nord', Produit: 'A', Montant: 20 }, // Nord/A : moyenne 15 (2 lignes)
    { Region: 'Nord', Produit: 'B', Montant: 100 }, // Nord/B : moyenne 100 (1 ligne)
    { Region: 'Sud', Produit: 'A', Montant: 6 }
  ];
  const p = data.pivotTable(avgRows, 'Region', 'Produit', 'Montant', 'avg');
  assert.deepStrictEqual(p.cells, [[15, 100], [6, null]]);
  // Moyenne des cellules de Nord ((15+100)/2 = 57.5) serait FAUSSE : la vraie moyenne des 3 lignes
  // Nord (10, 20, 100) est (10+20+100)/3 = 43.33...
  assert.ok(Math.abs(p.rowTotals[0] - 130 / 3) < 1e-9);
  assert.strictEqual(p.colTotals[0], 12); // colonne "A" : (10+20+6)/3 = 12
  assert.strictEqual(p.colTotals[1], 100); // colonne "B" : une seule ligne
  assert.ok(Math.abs(p.grandTotal - 136 / 4) < 1e-9); // moyenne des 4 lignes, pas des 4 cellules
  console.log('OK pivotTable (avg : totaux calculés sur les lignes réelles, pas en recombinant les cellules)');
}

// pivotTable — jeu de données vide : aucune erreur, structure vide plutôt qu'un plantage
{
  const p = data.pivotTable([], 'Region', 'Produit', 'Montant', 'sum');
  assert.deepStrictEqual(p, { rowKeys: [], colKeys: [], cells: [], rowTotals: [], colTotals: [], grandTotal: 0 });
  console.log('OK pivotTable (jeu de données vide -> structure vide, grandTotal=0 comme aggregateSingle)');
}

// distinctColumnValues (suggestions de valeurs, barre de filtres avancés)
{
  assert.deepStrictEqual(data.distinctColumnValues(rows, 'Region'), ['Nord', 'Sud']); // ordre de 1re apparition, pas alphabétique — Sud avant Nord donnerait un ordre différent si trié
  assert.deepStrictEqual(data.distinctColumnValues(rows, 'Montant'), ['100', '50', '30', '70']); // converties en chaîne (cohérent avec un <input> texte)
  const withBlanks = rows.concat([{ id: 5, Region: '', Montant: null }, { id: 6, Region: undefined, Montant: 100 }]);
  assert.deepStrictEqual(data.distinctColumnValues(withBlanks, 'Region'), ['Nord', 'Sud']); // null/undefined/'' ignorés, rien à suggérer
  assert.deepStrictEqual(data.distinctColumnValues(withBlanks, 'Montant'), ['100', '50', '30', '70']); // doublon (id 6, Montant=100) dédupliqué
  const manyRows = Array.from({ length: 1000 }, (_, i) => ({ id: i, Unique: i }));
  assert.strictEqual(data.distinctColumnValues(manyRows, 'Unique', 500).length, 500); // plafond respecté (colonne quasi unique, type Montant sur le jeu de charge)
  assert.strictEqual(data.distinctColumnValues([], 'Region').length, 0);
  console.log('OK distinctColumnValues (ordre de 1re apparition, valeurs vides ignorées, dédupliqué, plafonné)');
}

// tableToRows (format colonnaire -> lignes, utilisé pour la table de config)
{
  const table = { id: [1, 2], TableId: ['Ventes', 'Autre'], ConfigJSON: ['[]', '[{"a":1}]'] };
  const r = data.tableToRows(table);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].TableId, 'Autre');
  console.log('OK tableToRows');
}

// tableToRows exclut les colonnes techniques ajoutées par Grist lui-même (jamais demandées via
// AddColumn côté widget) — `manualSort` en particulier fuitait dans les sélecteurs Dimension/
// Mesure/Filtre du formulaire d'ajout de tuile en conditions réelles [BUG RÉEL, voir
// TEST_PROTOCOL.md #19]. `fetchTable()` la renvoie mêlée aux vraies colonnes du document.
{
  const table = { id: [1, 2], Region: ['Nord', 'Sud'], Montant: [100, 50], manualSort: [1.0, 2.0] };
  const r = data.tableToRows(table);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(Object.keys(r[0]).sort(), ['Montant', 'Region', 'id']);
  assert.ok(!('manualSort' in r[0]), 'manualSort ne doit jamais apparaître dans une ligne convertie');
  console.log('OK tableToRows exclut manualSort (colonne technique Grist)');
}

// currentDimension : dimension racine si drillPath vide, sinon le niveau correspondant à la
// profondeur atteinte
{
  const tile = { dimension: 'Annee', drillDimensions: ['Mois', 'Jour'] };
  assert.strictEqual(data.currentDimension(tile, []), 'Annee');
  assert.strictEqual(data.currentDimension(tile, undefined), 'Annee');
  assert.strictEqual(data.currentDimension(tile, [{ column: 'Annee', value: 2026 }]), 'Mois');
  assert.strictEqual(data.currentDimension(tile, [{ column: 'Annee', value: 2026 }, { column: 'Mois', value: 'Mars' }]), 'Jour');
  console.log('OK currentDimension');
}

// rowsForTile : source de vérité partagée rendu/export — filtres des AUTRES tuiles + filtres
// avancés + drill-down propre à la tuile, la tuile SOURCE d'un filtre croisé n'est pas filtrée sur
// CE filtre-là (reste cliquable sur tous ses segments)
{
  const tileRows = [
    { Region: 'Nord', Produit: 'A', Montant: 10 },
    { Region: 'Nord', Produit: 'B', Montant: 20 },
    { Region: 'Sud', Produit: 'A', Montant: 30 }
  ];
  const state1 = {
    rows: tileRows,
    activeFilters: [{ column: 'Region', value: 'Nord', sourceTileId: 't1' }],
    advancedFilters: [],
    drillIns: {}
  };
  // La tuile t1 (source du filtre) le voit ignoré -> toutes les lignes
  assert.strictEqual(data.rowsForTile({ id: 't1' }, state1).length, 3);
  // Une AUTRE tuile le subit -> seulement Nord
  assert.strictEqual(data.rowsForTile({ id: 't2' }, state1).length, 2);

  // advancedFilters s'appliquent à TOUTES les tuiles sans exception, y compris la source d'un filtre croisé
  const state2 = Object.assign({}, state1, { advancedFilters: [{ column: 'Produit', type: 'contains', query: 'A' }] });
  assert.strictEqual(data.rowsForTile({ id: 't1' }, state2).length, 2); // Nord/A + Sud/A, le filtre croisé Region reste ignoré pour t1
  assert.strictEqual(data.rowsForTile({ id: 't2' }, state2).length, 1); // Nord ET Produit contient A -> juste Nord/A

  // drillIns propre à la tuile s'applique même pour la tuile source d'un filtre croisé
  const state3 = Object.assign({}, state1, { drillIns: { t1: [{ column: 'Produit', value: 'B' }] } });
  assert.deepStrictEqual(data.rowsForTile({ id: 't1' }, state3).map((r) => r.Produit), ['B']);
  console.log('OK rowsForTile (source de vérité partagée rendu/export)');
}

// tileExportSheet : une feuille par type de tuile, avec les mêmes agrégats que le rendu
{
  const exportRows = [
    { Region: 'Nord', Produit: 'Casque audio', Quantite: 2, Montant: 100 },
    { Region: 'Sud', Produit: 'Casque audio', Quantite: 3, Montant: 150 },
    { Region: 'Nord', Produit: 'Clavier', Quantite: 1, Montant: 90 }
  ];
  const baseState = { rows: exportRows, activeFilters: [], advancedFilters: [], drillIns: {} };

  const barTile = { id: 't1', type: 'bar', title: 'Montant par Région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  const barSheet = data.tileExportSheet(barTile, baseState);
  assert.strictEqual(barSheet.name, 'Montant par Région');
  assert.deepStrictEqual(barSheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(barSheet.rows, [['Nord', 190], ['Sud', 150]]);

  // Nuage de mots, mode "une entrée par ligne" (wordCloudSplit falsy) : export identique à "bar"
  // (même header/mêmes lignes), voir js/data.js:tileExportSheet — c'est délibérément le MÊME chemin
  // de code que barTile ci-dessus, pas une branche dédiée.
  const wordCloudTile = { id: 't1b', type: 'wordcloud', title: 'Nuage de mots : Region', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  const wordCloudSheet = data.tileExportSheet(wordCloudTile, baseState);
  assert.deepStrictEqual(wordCloudSheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(wordCloudSheet.rows, [['Nord', 190], ['Sud', 150]]);

  // Nuage de mots, mode "découpage de cellule" (wordCloudSplit vrai) : fréquence de mots sur la
  // colonne Produit (ici "Casque audio" x2, "Clavier" x1), triée par fréquence décroissante — measure/
  // aggFn ignorés (undefined, comme le fait js/main.js côté formulaire).
  const wordCloudSplitTile = { id: 't1c', type: 'wordcloud', title: 'Nuage de mots : Produit', dimension: 'Produit', wordCloudSplit: true, measure: undefined, aggFn: undefined };
  const wordCloudSplitSheet = data.tileExportSheet(wordCloudSplitTile, baseState);
  assert.deepStrictEqual(wordCloudSplitSheet.header, ['Produit', 'Occurrences']);
  assert.deepStrictEqual(wordCloudSplitSheet.rows, [['Casque', 2], ['audio', 2], ['Clavier', 1]]);
  console.log('OK tileExportSheet (nuage de mots : mode "une entrée par ligne" = export bar ; mode "découpage de cellule" = fréquence triée)');

  const kpiTile = { id: 't2', type: 'kpi', measure: 'Montant', aggFn: 'sum' };
  const kpiSheet = data.tileExportSheet(kpiTile, baseState);
  assert.strictEqual(kpiTile.title, undefined); // titre absent -> repli sur aggFn(measure)
  assert.strictEqual(kpiSheet.name, 'sum(Montant)');
  assert.deepStrictEqual(kpiSheet.header, ['Mesure', 'Valeur']);
  assert.deepStrictEqual(kpiSheet.rows, [['sum(Montant)', 340]]);

  const scatterTile = { id: 't3', type: 'scatter', title: 'Quantité vs Montant', dimension: 'Produit', measure: 'Quantite', measureY: 'Montant', aggFn: 'sum' };
  const scatterSheet = data.tileExportSheet(scatterTile, baseState);
  assert.deepStrictEqual(scatterSheet.header, ['Produit', 'Quantite', 'Montant']);
  assert.deepStrictEqual(scatterSheet.rows, [['Casque audio', 5, 250], ['Clavier', 1, 90]]);

  // pivot : une ligne "Total" et une colonne "Total" en plus de la grille, cellule sans donnée
  // (Sud/Clavier, absente des lignes) exportée en chaîne vide plutôt que 0 (cohérent avec le "–"
  // affiché par le rendu, voir js/charts.js:renderPivot)
  const pivotTile = { id: 't4', type: 'pivot', title: 'Montant par Région et Produit', dimension: 'Region', columnDimension: 'Produit', measure: 'Montant', aggFn: 'sum' };
  const pivotSheet = data.tileExportSheet(pivotTile, baseState);
  assert.deepStrictEqual(pivotSheet.header, ['Region', 'Casque audio', 'Clavier', 'Total']);
  assert.deepStrictEqual(pivotSheet.rows, [
    ['Nord', 100, 90, 190],
    ['Sud', 150, '', 150],
    ['Total', 250, 90, 340]
  ]);
  console.log('OK tileExportSheet (pivot : grille + ligne/colonne Total, cellule sans donnée -> chaîne vide)');

  // tileExportKind (voir js/pdf-export.js) : pivot/kpi -> 'table' (déjà rendus sans graphique),
  // tout le reste (y compris bar en mode mesure DAX) -> 'image' (capturée depuis l'instance ECharts
  // déjà rendue, voir GristBI.charts.getInstance).
  assert.strictEqual(data.tileExportKind(pivotTile), 'table');
  assert.strictEqual(data.tileExportKind({ type: 'kpi' }), 'table');
  assert.strictEqual(data.tileExportKind({ type: 'gauge' }), 'image');
  assert.strictEqual(data.tileExportKind({ type: 'scatter' }), 'image');
  assert.strictEqual(data.tileExportKind({ type: 'bar' }), 'image');
  assert.strictEqual(data.tileExportKind({ type: 'bar', measureMode: 'ytd' }), 'image');
  console.log('OK tileExportKind (pivot/kpi -> table, tout le reste -> image)');

  // Tuile filtrée jusqu'à zéro ligne -> en-têtes présents, aucune ligne (pas planté, pas d'en-tête absent)
  const emptyState = Object.assign({}, baseState, { activeFilters: [{ column: 'Region', value: 'Ouest', sourceTileId: 'autre' }] });
  const emptySheet = data.tileExportSheet(barTile, emptyState);
  assert.deepStrictEqual(emptySheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(emptySheet.rows, []);
  console.log('OK tileExportSheet (bar/kpi/scatter + tuile vide après filtrage)');

  // Tuile Barres en mode de calcul temporel (Cumul/YTD/N-1, voir ROADMAP.md "Mesures façon DAX
  // simplifié") : le calcul réel passe par GristBI.duckdbEngine.timeSeriesMeasures, ASYNCHRONE (une
  // vraie requête SQL), incompatible avec cette fonction volontairement pure/synchrone — un texte
  // explicite plutôt qu'une feuille silencieusement incohérente (sans ce cas particulier,
  // `dimension` vide produirait une seule ligne "undefined" trompeuse, voir data.js).
  const measureTile = { id: 't4', type: 'bar', title: 'YTD : sum(Montant)', dimension: '', measure: 'Montant', aggFn: 'sum', measureMode: 'ytd', dateColumn: 'Date' };
  const measureSheet = data.tileExportSheet(measureTile, baseState);
  assert.deepStrictEqual(measureSheet.header, ['Info']);
  assert.strictEqual(measureSheet.rows.length, 1);
  console.log('OK tileExportSheet — tuile en mode de calcul temporel : message explicite plutôt qu\'un export incohérent');

  // Radar "compétences en colonnes" (tile.radarAxisMode === 'columns', ROADMAP.md — demande du
  // forum Grist, entretiens d'orientation : compétences déjà en colonnes plutôt qu'en lignes). Un
  // axe par colonne choisie (tile.radarAxes), une seule ligne = la moyenne de chaque colonne sur
  // les lignes visibles — ni dimension ni measure/aggFn ne sont utilisés dans ce mode.
  const radarColumnsRows = [
    { Eleve: 'Dupont', Maths: 12, Francais: 16 },
    { Eleve: 'Martin', Maths: 18, Francais: 8 }
  ];
  const radarColumnsState = { rows: radarColumnsRows, activeFilters: [], advancedFilters: [], drillIns: {} };
  const radarColumnsTile = {
    id: 't5', type: 'radar', title: 'Radar : Maths, Francais',
    radarAxisMode: 'columns', radarAxes: ['Maths', 'Francais']
  };
  const radarColumnsSheet = data.tileExportSheet(radarColumnsTile, radarColumnsState);
  assert.deepStrictEqual(radarColumnsSheet.header, ['Maths', 'Francais']);
  assert.deepStrictEqual(radarColumnsSheet.rows, [[15, 12]]); // avg(12,18)=15, avg(16,8)=12

  // Radar classique (dimension/measure/aggFn, radarAxisMode absent ou 'dimension') : comportement
  // INCHANGÉ, même branche générique que bar/pie/treemap ci-dessus.
  const radarDimensionTile = { id: 't6', type: 'bar', title: 'Montant par Région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  radarDimensionTile.type = 'radar';
  const radarDimensionSheet = data.tileExportSheet(radarDimensionTile, baseState);
  assert.deepStrictEqual(radarDimensionSheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(radarDimensionSheet.rows, [['Nord', 190], ['Sud', 150]]);
  console.log('OK tileExportSheet (radar "compétences en colonnes" : un axe par colonne, moyenne par colonne ; radar classique inchangé)');

  // Comparaison élève/moyenne du groupe filtré (tile.radarEntityColumn/radarEntityValue/
  // radarCompareAverage, ROADMAP.md — 2e idée du même fil forum) — mode "colonnes" : entité seule
  // (pas de 2e ligne tant que radarCompareAverage n'est pas coché).
  const radarColumnsEntityOnlyTile = Object.assign({}, radarColumnsTile, { radarEntityColumn: 'Eleve', radarEntityValue: 'Dupont' });
  const radarColumnsEntityOnlySheet = data.tileExportSheet(radarColumnsEntityOnlyTile, radarColumnsState);
  assert.deepStrictEqual(radarColumnsEntityOnlySheet.header, ['Série', 'Maths', 'Francais']);
  assert.deepStrictEqual(radarColumnsEntityOnlySheet.rows, [['Dupont', 12, 16]]);

  // Mode "colonnes" + radarCompareAverage : 2 lignes, élève puis "Moyenne" du groupe filtré entier.
  const radarColumnsCompareTile = Object.assign({}, radarColumnsEntityOnlyTile, { radarCompareAverage: true });
  const radarColumnsCompareSheet = data.tileExportSheet(radarColumnsCompareTile, radarColumnsState);
  assert.deepStrictEqual(radarColumnsCompareSheet.header, ['Série', 'Maths', 'Francais']);
  assert.deepStrictEqual(radarColumnsCompareSheet.rows, [['Dupont', 12, 16], ['Moyenne', 15, 12]]);

  // Mode "dimension" (classique) + radarCompareAverage : les axes viennent du groupement par
  // dimension (Region), l'entité (Produit = "Casque audio") a une ligne par région -> aucun axe
  // manquant ici.
  const radarDimensionCompareTile = Object.assign({}, radarDimensionTile, {
    radarEntityColumn: 'Produit', radarEntityValue: 'Casque audio', radarCompareAverage: true
  });
  const radarDimensionCompareSheet = data.tileExportSheet(radarDimensionCompareTile, baseState);
  assert.deepStrictEqual(radarDimensionCompareSheet.header, ['Série', 'Nord', 'Sud']); // axes = valeurs de Region, ordre de 1re apparition
  assert.deepStrictEqual(radarDimensionCompareSheet.rows, [['Casque audio', 100, 150], ['Moyenne', 190, 150]]);

  // Mode "dimension" + entité dont les lignes ne couvrent PAS tous les axes du groupe (Produit =
  // "Clavier" n'existe qu'en région Nord) : l'axe manquant (Sud) est comblé à 0, pas décalé.
  const radarDimensionMissingAxisTile = Object.assign({}, radarDimensionTile, { radarEntityColumn: 'Produit', radarEntityValue: 'Clavier' });
  const radarDimensionMissingAxisSheet = data.tileExportSheet(radarDimensionMissingAxisTile, baseState);
  assert.deepStrictEqual(radarDimensionMissingAxisSheet.header, ['Série', 'Nord', 'Sud']);
  assert.deepStrictEqual(radarDimensionMissingAxisSheet.rows, [['Clavier', 90, 0]]); // pas de "Moyenne" : radarCompareAverage absent

  // Valeur de comparaison orpheline (aucune ligne ne correspond, ex. après un changement de table) :
  // repli silencieux sur le comportement SANS comparaison, identique à radarDimensionSheet ci-dessus.
  const radarDimensionOrphanTile = Object.assign({}, radarDimensionTile, { radarEntityColumn: 'Produit', radarEntityValue: 'Inexistant' });
  const radarDimensionOrphanSheet = data.tileExportSheet(radarDimensionOrphanTile, baseState);
  assert.deepStrictEqual(radarDimensionOrphanSheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(radarDimensionOrphanSheet.rows, [['Nord', 190], ['Sud', 150]]);
  console.log('OK tileExportSheet (radar : comparaison élève/moyenne du groupe filtré, modes "colonnes" et "dimension", axe manquant comblé à 0, valeur orpheline sans effet)');
}

// sanitizeSheetName : caractères interdits Excel, troncature à 31, unicité dans le classeur
{
  const used = new Set();
  assert.strictEqual(data.sanitizeSheetName('Montant par Région', used), 'Montant par Région');
  assert.strictEqual(data.sanitizeSheetName('Ventes: Q1/Q2 [2026]?*', used), 'Ventes  Q1 Q2  2026');
  const long = 'Un titre de tuile vraiment beaucoup trop long pour Excel';
  assert.strictEqual(data.sanitizeSheetName(long, used).length, 31);
  // Collision : le même nom une 2e fois -> suffixe " (2)" plutôt qu'une erreur/écrasement
  const dup1 = data.sanitizeSheetName('Montant', used);
  const dup2 = data.sanitizeSheetName('Montant', used);
  assert.strictEqual(dup1, 'Montant');
  assert.strictEqual(dup2, 'Montant (2)');
  assert.ok(dup2.length <= 31);
  console.log('OK sanitizeSheetName (caractères interdits, troncature 31, unicité)');
}

// buildWorkbookSheets : une feuille par tuile, toutes pages confondues, préfixée par le nom de la
// page seulement s'il y en a plusieurs
{
  const wbRows = [{ Region: 'Nord', Montant: 10 }, { Region: 'Sud', Montant: 20 }];
  const singlePageState = {
    rows: wbRows, activeFilters: [], advancedFilters: [], drillIns: {},
    pages: [{ id: 'p1', name: 'Page 1', tiles: [
      { id: 't1', type: 'bar', title: 'Montant par Région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }
    ] }]
  };
  const singlePageSheets = data.buildWorkbookSheets(singlePageState);
  assert.strictEqual(singlePageSheets.length, 1);
  assert.strictEqual(singlePageSheets[0].name, 'Montant par Région'); // pas de préfixe : une seule page

  const multiPageState = Object.assign({}, singlePageState, {
    pages: [
      { id: 'p1', name: 'Ventes', tiles: [{ id: 't1', type: 'kpi', measure: 'Montant', aggFn: 'sum' }] },
      { id: 'p2', name: 'Stock', tiles: [{ id: 't2', type: 'kpi', measure: 'Montant', aggFn: 'sum' }] }
    ]
  });
  const multiPageSheets = data.buildWorkbookSheets(multiPageState);
  assert.deepStrictEqual(multiPageSheets.map((s) => s.name), ['Ventes - sum(Montant)', 'Stock - sum(Montant)']);
  console.log('OK buildWorkbookSheets (préfixe de page conditionnel + une feuille par tuile toutes pages confondues)');
}

// blendRows : data blending multi-tables (ROADMAP.md Tier 2) — LEFT JOIN en JS pur, colonnes
// secondaires préfixées `<secondaryTableId>.<colonne>`. Cas nominal : chaque ligne principale
// trouve sa correspondance secondaire.
{
  const primary = [
    { id: 1, Region: 'Nord', Montant: 100 },
    { id: 2, Region: 'Sud', Montant: 30 }
  ];
  const secondary = [
    { id: 10, Region: 'Nord', Population: 500 },
    { id: 11, Region: 'Sud', Population: 200 }
  ];
  const merged = data.blendRows(primary, secondary, 'Region', 'Region', 'Villes');
  // 'id' n'est jamais reporté côté secondaire (identifiant interne Grist, pas une vraie colonne —
  // même exclusion que availableColumns() dans js/main.js).
  assert.deepStrictEqual(merged, [
    { id: 1, Region: 'Nord', Montant: 100, 'Villes.Region': 'Nord', 'Villes.Population': 500 },
    { id: 2, Region: 'Sud', Montant: 30, 'Villes.Region': 'Sud', 'Villes.Population': 200 }
  ]);
  console.log('OK blendRows (cas nominal : LEFT JOIN, colonnes secondaires préfixées, id secondaire exclu)');
}

// blendRows : ligne principale sans correspondance -> colonnes secondaires à `null`, PAS absentes —
// availableColumns() (js/main.js) ne lit que rows[0] pour peupler les sélecteurs de colonne, donc
// une forme de ligne qui varierait selon le match rendrait les colonnes secondaires invisibles dès
// que la toute première ligne ne matche pas.
{
  const primary = [
    { id: 1, Region: 'Nord' },
    { id: 2, Region: 'Ouest' } // aucune correspondance côté secondaire
  ];
  const secondary = [{ id: 10, Region: 'Nord', Population: 500 }];
  const merged = data.blendRows(primary, secondary, 'Region', 'Region', 'Villes');
  assert.deepStrictEqual(Object.keys(merged[0]), Object.keys(merged[1])); // même forme, matché ou pas
  assert.strictEqual(merged[1]['Villes.Population'], null);
  assert.strictEqual(merged[0]['Villes.Population'], 500);
  console.log('OK blendRows (ligne sans correspondance : colonnes secondaires à null, jamais absentes)');
}

// blendRows : table secondaire vide -> identité (aucune colonne ajoutée, mêmes lignes principales)
{
  const primary = [{ id: 1, Region: 'Nord' }];
  assert.deepStrictEqual(data.blendRows(primary, [], 'Region', 'Region', 'Villes'), [{ id: 1, Region: 'Nord' }]);
  console.log('OK blendRows (table secondaire vide : identité)');
}

// blendRows : table principale vide -> tableau vide, sans exception même avec une table secondaire
// non vide
{
  assert.deepStrictEqual(data.blendRows([], [{ id: 1, Region: 'Nord' }], 'Region', 'Region', 'Villes'), []);
  console.log('OK blendRows (table principale vide : tableau vide)');
}

// blendRows : clé de jointure numérique d'un côté, chaîne de l'autre (même souci que la comparaison
// d'un clic ECharts, voir sameValue) -> doit matcher malgré le type différent
{
  const primary = [{ id: 1, RegionId: 1 }];
  const secondary = [{ id: 10, Id: '1', Population: 500 }];
  const merged = data.blendRows(primary, secondary, 'RegionId', 'Id', 'Villes');
  assert.strictEqual(merged[0]['Villes.Population'], 500);
  console.log('OK blendRows (comparaison de clé insensible au type, comme sameValue)');
}

// blendRows : clé secondaire dupliquée -> dernière ligne gagne (limite connue, documentée dans
// HYPOTHESES.md — pas un vrai LEFT JOIN 1-n)
{
  const primary = [{ id: 1, Region: 'Nord' }];
  const secondary = [
    { id: 10, Region: 'Nord', Population: 500 },
    { id: 11, Region: 'Nord', Population: 999 }
  ];
  const merged = data.blendRows(primary, secondary, 'Region', 'Region', 'Villes');
  assert.strictEqual(merged[0]['Villes.Population'], 999);
  console.log('OK blendRows (clé secondaire dupliquée : dernière ligne gagne, limite documentée)');
}

// deriveDateHierarchyColumns : drill-down hiérarchique automatique (ROADMAP.md Tier 2) — Année/
// Trimestre/Mois dérivés d'une colonne Date, en plus de la colonne d'origine (jamais un
// remplacement). Cas nominal : plusieurs mois couvrant plusieurs trimestres.
{
  const rows = [
    { id: 1, Date: '2026-01-15', Montant: 10 }, // T1
    { id: 2, Date: '2026-04-02', Montant: 20 }, // T2
    { id: 3, Date: '2026-12-31', Montant: 30 }  // T4
  ];
  const enriched = data.deriveDateHierarchyColumns(rows, 'Date');
  assert.deepStrictEqual(enriched, [
    { id: 1, Date: '2026-01-15', Montant: 10, 'Date.Annee': 2026, 'Date.Trimestre': 'T1', 'Date.Mois': '01' },
    { id: 2, Date: '2026-04-02', Montant: 20, 'Date.Annee': 2026, 'Date.Trimestre': 'T2', 'Date.Mois': '04' },
    { id: 3, Date: '2026-12-31', Montant: 30, 'Date.Annee': 2026, 'Date.Trimestre': 'T4', 'Date.Mois': '12' }
  ]);
  console.log('OK deriveDateHierarchyColumns (cas nominal : Année/Trimestre/Mois dérivés, colonne Date conservée)');
}

// deriveDateHierarchyColumns : valeur qui ne parse pas comme date (voir parseDateValue, format
// AAAA-MM-JJ strict) -> les 3 colonnes dérivées à null, jamais absentes (même raison que
// blendRows : availableColumns(), js/main.js, ne lit que rows[0]).
{
  const rows = [
    { id: 1, Date: '2026-01-15' },
    { id: 2, Date: 'pas une date' },
    { id: 3, Date: null }
  ];
  const enriched = data.deriveDateHierarchyColumns(rows, 'Date');
  assert.deepStrictEqual(Object.keys(enriched[0]), Object.keys(enriched[1]));
  assert.strictEqual(enriched[1]['Date.Annee'], null);
  assert.strictEqual(enriched[1]['Date.Trimestre'], null);
  assert.strictEqual(enriched[1]['Date.Mois'], null);
  assert.strictEqual(enriched[2]['Date.Annee'], null);
  console.log('OK deriveDateHierarchyColumns (valeur non parseable : colonnes dérivées à null, jamais absentes)');
}

// deriveDateHierarchyColumns : tableau vide -> tableau vide, sans exception
{
  assert.deepStrictEqual(data.deriveDateHierarchyColumns([], 'Date'), []);
  console.log('OK deriveDateHierarchyColumns (tableau vide : identité)');
}

// commentsForTile (commentaires collaboratifs, ROADMAP.md Tier 2) : filtre par TileId (pas
// TableId, voir js/data.js — les id de tuile sont déjà globalement uniques), trié du plus ancien
// au plus récent sur CreatedAt (ISO 8601, comparable en chaîne) plutôt que sur l'ordre de retour
// de fetchTable (non garanti, même prudence que groupByAggregate).
{
  const comments = [
    { id: 3, TableId: 'BI_StressTest', TileId: 'tile_a', Author: 'Bea', Text: 'Dernier', CreatedAt: '2026-09-29T10:00:00.000Z' },
    { id: 1, TableId: 'BI_StressTest', TileId: 'tile_a', Author: 'Ana', Text: 'Premier', CreatedAt: '2026-09-29T08:00:00.000Z' },
    { id: 2, TableId: 'BI_StressTest', TileId: 'tile_b', Author: 'Cy', Text: 'Autre tuile', CreatedAt: '2026-09-29T09:00:00.000Z' }
  ];
  const forTileA = data.commentsForTile(comments, 'tile_a');
  assert.deepStrictEqual(forTileA.map((c) => c.id), [1, 3], 'filtré sur tile_a, du plus ancien au plus récent malgré l\'ordre de départ');
  assert.deepStrictEqual(data.commentsForTile(comments, 'tile_b').map((c) => c.id), [2]);
  assert.deepStrictEqual(data.commentsForTile(comments, 'tile_inconnue'), [], 'aucune correspondance -> tableau vide');
  assert.deepStrictEqual(data.commentsForTile([], 'tile_a'), [], 'aucun commentaire chargé -> tableau vide');
  assert.deepStrictEqual(data.commentsForTile(null, 'tile_a'), [], 'comments absent (undefined/null) -> tableau vide, pas une exception');
  console.log('OK data.commentsForTile (filtre par tuile, tri chronologique, cas vides)');
}

// isAccessRuleRefusal (consigne GFS 012, « Partager » sur BI_Dashboard_Config) : reconnaît le
// refus d'écriture Grist sur une ligne qu'on ne fait que lire, quel que soit le verbe exact
// (« row update »/« row delete »/« table update » access rules), pour que js/main.js:runPendingSave
// le distingue d'un échec réseau quelconque et le dise une fois plutôt que de le laisser filer en
// silence dans la seule console.
{
  assert.strictEqual(
    data.isAccessRuleRefusal(new Error('Blocked by row update access rules')), true,
    'texte exact cité par la consigne GFS 012'
  );
  assert.strictEqual(
    data.isAccessRuleRefusal(new Error('Blocked by row delete access rules')), true,
    'variante "delete" : même famille de refus'
  );
  assert.strictEqual(
    data.isAccessRuleRefusal(new Error('blocked BY TABLE update ACCESS RULES')), true,
    'insensible à la casse'
  );
  assert.strictEqual(
    data.isAccessRuleRefusal(new Error('Network request failed')), false,
    'un échec réseau quelconque n\'est pas pris pour un refus de droits'
  );
  assert.strictEqual(data.isAccessRuleRefusal(null), false, 'aucune exception sur une erreur absente');
  assert.strictEqual(data.isAccessRuleRefusal(undefined), false, 'aucune exception sur une erreur absente (undefined)');
  assert.strictEqual(
    data.isAccessRuleRefusal('Blocked by row update access rules'), true,
    'tolère aussi une erreur rejetée comme chaîne brute, pas seulement un objet Error'
  );
  console.log('OK data.isAccessRuleRefusal (refus Grist "access rules" vs. échec quelconque, consigne GFS 012)');
}

// tableToRows / epochSecondsToIsoDate (format réel de l'API Grist, vérifié le 29/09/2026 après la
// livraison du drill-down) : une colonne réellement typée `Date` côté Grist renvoie, via
// fetchTable(), un nombre de secondes depuis l'epoch UTC — pas la chaîne ISO 'AAAA-MM-JJ' que ce
// widget écrit lui-même (js/demo-data.js:deriveDateColumn). Sans conversion à la lecture,
// inferColumnKind (js/main.js) classerait une vraie colonne Date comme "number", cassant le
// drill-down hiérarchique automatique (PR #14) et le sélecteur de colonne date des mesures DAX. Voir
// js/grist-api.js:dateColumnIdsFrom pour où `dateColumnIds` est calculé (uniquement pour les tables
// dont ce widget connaît le schéma — BI_StressTest, BI_Dashboard_Comments — jamais pour une table
// arbitraire choisie via le sélecteur, voir HYPOTHESES.md).
{
  assert.strictEqual(data.epochSecondsToIsoDate(1768435200), '2026-01-15', 'epoch UTC -> AAAA-MM-JJ');
  console.log('OK epochSecondsToIsoDate');
}

{
  // Table colonnaire façon fetchTable() réel : `Date` en nombre (colonne typée Date côté Grist),
  // `Montant` en nombre aussi (une vraie mesure numérique, qui ne doit JAMAIS être convertie même si
  // elle tombe par coïncidence dans une plage plausible d'epoch).
  const table = {
    id: [1, 2],
    Region: ['Nord', 'Sud'],
    Date: [1768435200, 1735689600], // 2026-01-15, 2025-01-01 (secondes depuis epoch UTC)
    Montant: [100, 1768435200] // coïncidence délibérée avec une valeur Date ci-dessus
  };
  const rowsFromTable = data.tableToRows(table, ['Date']);
  assert.deepStrictEqual(rowsFromTable, [
    { id: 1, Region: 'Nord', Date: '2026-01-15', Montant: 100 },
    { id: 2, Region: 'Sud', Date: '2025-01-01', Montant: 1768435200 }
  ], 'seule la colonne déclarée date est convertie, jamais une mesure numérique par coïncidence de valeur');
  console.log('OK tableToRows convertit uniquement les colonnes déclarées dans dateColumnIds');
}

{
  // Sans dateColumnIds (comportement historique, ex. loadTable() pour une table arbitraire dont ce
  // widget ne connaît pas le schéma) : aucune conversion, le nombre brut traverse tel quel — point
  // ouvert documenté dans HYPOTHESES.md, pas une régression de ce correctif.
  const table = { id: [1], Date: [1768435200] };
  assert.deepStrictEqual(data.tableToRows(table), [{ id: 1, Date: 1768435200 }]);
  console.log('OK tableToRows sans dateColumnIds : comportement historique inchangé (schéma inconnu)');
}

// state: toggle de filtre croisé - un seul filtre par colonne (activation/toggle-off/remplacement)
{
  const store = state.createStore();
  const seen = [];
  store.subscribe((s) => seen.push(s.activeFilters));
  store.setRows(rows);
  store.toggleFilter('Region', 'Nord', 'tileA');
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Region', value: 'Nord', sourceTileId: 'tileA' }]);
  store.toggleFilter('Region', 'Nord', 'tileA'); // même clic -> retire le filtre
  assert.deepStrictEqual(store.getState().activeFilters, []);
  store.toggleFilter('Region', 'Nord', 'tileA');
  store.toggleFilter('Region', 'Sud', 'tileA'); // clic sur un autre segment DE LA MÊME colonne -> remplace
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Region', value: 'Sud', sourceTileId: 'tileA' }]);
  assert.strictEqual(seen.length, 5); // setRows + 4 toggles
  console.log('OK state.toggleFilter (activation / toggle-off / remplacement, une colonne)');
}

// state: filtres croisés simultanés sur des colonnes DIFFÉRENTES -> cumul (ET), pas remplacement
{
  const store = state.createStore();
  store.toggleFilter('Region', 'Nord', 'tileA');
  store.toggleFilter('Produit', 'Casque audio', 'tileB');
  assert.deepStrictEqual(store.getState().activeFilters, [
    { column: 'Region', value: 'Nord', sourceTileId: 'tileA' },
    { column: 'Produit', value: 'Casque audio', sourceTileId: 'tileB' }
  ]);
  store.clearFilter('Region'); // efface seulement celui-là
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Produit', value: 'Casque audio', sourceTileId: 'tileB' }]);
  store.clearFilter(); // sans argument -> efface tout
  assert.deepStrictEqual(store.getState().activeFilters, []);
  console.log('OK state.toggleFilter (cumul multi-colonnes) + clearFilter(column)');
}

// state: drill-down multi-niveaux (chemin empilé, remontée à une profondeur donnée)
{
  const store = state.createStore();
  store.addTile({
    id: 't1', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois', 'Semaine'],
    measure: 'Montant', aggFn: 'sum'
  });
  assert.strictEqual(store.getState().drillIns.t1, undefined); // niveau racine par défaut
  store.drillInto('t1', 'Annee', 2026); // -> niveau 1 (Mois)
  assert.deepStrictEqual(store.getState().drillIns.t1, [{ column: 'Annee', value: 2026 }]);
  store.drillInto('t1', 'Mois', 'Mars'); // -> niveau 2 (Semaine)
  assert.deepStrictEqual(store.getState().drillIns.t1, [
    { column: 'Annee', value: 2026 }, { column: 'Mois', value: 'Mars' }
  ]);
  store.drillUp('t1', 1); // remonte au niveau 1 seulement (garde juste Annee=2026)
  assert.deepStrictEqual(store.getState().drillIns.t1, [{ column: 'Annee', value: 2026 }]);
  store.drillUp('t1'); // sans argument -> remonte complètement à la racine
  assert.strictEqual(store.getState().drillIns.t1, undefined);
  store.drillUp('t1'); // déjà à la racine -> no-op, pas d'erreur
  // Supprimer une tuile drillée nettoie aussi son état de drill (pas de fuite mémoire/état fantôme)
  store.drillInto('t1', 'Annee', 2026);
  store.removeTile('t1');
  assert.strictEqual('t1' in store.getState().drillIns, false);
  console.log('OK state.drillInto/drillUp multi-niveaux (empilage + remontée à une profondeur + nettoyage)');
}

// state: drill-down avec cross-filtering activé PAR TUILE (drillCrossFilter: true, réglage exposé
// dans le formulaire de tuile) -> chaque niveau franchi filtre aussi les AUTRES tuiles, pas
// seulement au niveau le plus profond (comportement par défaut, inchangé si non coché). Répond à
// un retour utilisateur : sans ce réglage, drill-down et cross-filter sont deux interactions
// séparées (comme dans Power BI), ce qui peut surprendre si on s'attend à ce que détailler UNE
// carte filtre automatiquement les autres.
{
  const store = state.createStore();
  store.addTile({
    id: 't1', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois', 'Semaine'],
    drillCrossFilter: true, measure: 'Montant', aggFn: 'sum'
  });

  store.drillInto('t1', 'Annee', 2026); // niveau 1 -> filtre croisé posé sur Annee=2026
  assert.deepStrictEqual(store.getState().activeFilters, [
    { column: 'Annee', value: 2026, sourceTileId: 't1', fromDrill: true }
  ]);
  store.drillInto('t1', 'Mois', 'Mars'); // niveau 2 -> le filtre croisé suit tout le chemin parcouru
  assert.deepStrictEqual(store.getState().activeFilters, [
    { column: 'Annee', value: 2026, sourceTileId: 't1', fromDrill: true },
    { column: 'Mois', value: 'Mars', sourceTileId: 't1', fromDrill: true }
  ]);
  store.drillUp('t1', 1); // remonter retire le filtre du niveau abandonné
  assert.deepStrictEqual(store.getState().activeFilters, [
    { column: 'Annee', value: 2026, sourceTileId: 't1', fromDrill: true }
  ]);
  store.drillUp('t1'); // retour à la racine -> plus aucun filtre croisé issu du drill
  assert.deepStrictEqual(store.getState().activeFilters, []);

  // Sans drillCrossFilter (réglage par défaut) : drill-down purement local, comme avant.
  store.updateTile('t1', { drillCrossFilter: false });
  store.drillInto('t1', 'Annee', 2025);
  assert.deepStrictEqual(store.getState().activeFilters, []);
  console.log('OK state.drillInto/drillUp avec drillCrossFilter (filtre croisé par tuile, réglage optionnel)');
}

// state: removeTile nettoie aussi les filtres croisés (toggleFilter OU drillCrossFilter) posés par
// la tuile supprimée, sinon un filtre reste actif sans plus aucune tuile source pour le faire
// évoluer ou le lever.
{
  const store = state.createStore();
  store.addTile({
    id: 't1', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois'],
    drillCrossFilter: true, measure: 'Montant', aggFn: 'sum'
  });
  store.addTile({ id: 't2', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
  store.toggleFilter('Region', 'Nord', 't2');
  store.drillInto('t1', 'Annee', 2026);
  assert.strictEqual(store.getState().activeFilters.length, 2);
  store.removeTile('t1');
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Region', value: 'Nord', sourceTileId: 't2' }]);
  store.removeTile('t2');
  assert.deepStrictEqual(store.getState().activeFilters, []);
  console.log('OK state.removeTile nettoie les filtres croisés (toggle + drill) qu\'elle avait posés');
}

// state: updateTile réinitialise le drill-down EN COURS d'une tuile dès que son patch touche
// drillDimensions (le formulaire d'édition envoie toujours ce champ, voir main.js) : sinon un
// chemin de drill-down pourrait référencer un niveau qui n'existe plus pour cette tuile, avec un
// filtre invisible (pas de fil d'Ariane pour le signaler puisque tileDrillLevels serait vide).
{
  const store = state.createStore();
  store.addTile({
    id: 't1', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois'],
    drillCrossFilter: true, measure: 'Montant', aggFn: 'sum'
  });
  store.drillInto('t1', 'Annee', 2026);
  assert.notStrictEqual(store.getState().drillIns.t1, undefined);
  assert.strictEqual(store.getState().activeFilters.length, 1);
  store.updateTile('t1', { drillDimensions: undefined, drillCrossFilter: undefined }); // drill-down retiré via édition
  assert.strictEqual(store.getState().drillIns.t1, undefined);
  assert.deepStrictEqual(store.getState().activeFilters, []);
  console.log('OK state.updateTile réinitialise le drill-down en cours quand drillDimensions change');
}

// data.tileDrillLevels : nouveau format (tableau) et ancien format (chaîne unique) tous deux acceptés
{
  assert.deepStrictEqual(data.tileDrillLevels({ drillDimensions: ['Mois', 'Semaine'] }), ['Mois', 'Semaine']);
  assert.deepStrictEqual(data.tileDrillLevels({ drillDimension: 'Mois' }), ['Mois']); // ancien format (compat)
  assert.deepStrictEqual(data.tileDrillLevels({}), []);
  console.log('OK data.tileDrillLevels (nouveau format tableau + ancien format compat)');
}

// Drill-down hiérarchique NON temporel (ex. Région > Produit, voir ROADMAP.md) : contrairement au
// drill-down automatique (temporel uniquement, dérivé par deriveDateHierarchyColumns/
// withDateHierarchies dans js/main.js), rien n'empêche de composer `drillDimensions` avec de pures
// colonnes catégorielles — le mécanisme a été généralisé à N niveaux arbitraires pour #14 (voir
// state.js/data.js) sans jamais inspecter le TYPE des colonnes. Vérifié ici de bout en bout
// (rowsForTile + groupByAggregate, le même chemin que charts.js), pas seulement sur l'état du
// store comme les tests drillInto/drillUp plus haut : confirmé aussi en conditions réelles de clic
// contre dev-tests/harness.html (Région > Produit > Année), voir HYPOTHESES.md.
{
  const categoricalRows = [
    { Region: 'Nord', Produit: 'Casque audio', Annee: 2025, Montant: 100 },
    { Region: 'Nord', Produit: 'Casque audio', Annee: 2026, Montant: 120 },
    { Region: 'Nord', Produit: 'Enceinte', Annee: 2025, Montant: 40 },
    { Region: 'Sud', Produit: 'Casque audio', Annee: 2025, Montant: 30 },
    { Region: 'Sud', Produit: 'Enceinte', Annee: 2025, Montant: 70 }
  ];
  const store = state.createStore();
  store.setRows(categoricalRows);
  store.addTile({
    id: 't1', type: 'bar', dimension: 'Region', drillDimensions: ['Produit', 'Annee'],
    measure: 'Montant', aggFn: 'sum'
  });
  const tile = store.getState().tiles[0];

  // Racine : agrégat par Région, aucune colonne dérivée/temporelle en jeu.
  let agg = data.groupByAggregate(data.rowsForTile(tile, store.getState()), data.currentDimension(tile, []), tile.measure, tile.aggFn);
  assert.deepStrictEqual(agg, [{ dimension: 'Nord', value: 260 }, { dimension: 'Sud', value: 100 }]);

  // Niveau 1 : détaille "Nord" par Produit (toujours catégoriel, pas de date).
  store.drillInto('t1', 'Region', 'Nord');
  let state1 = store.getState();
  let dim1 = data.currentDimension(tile, state1.drillIns.t1);
  assert.strictEqual(dim1, 'Produit');
  agg = data.groupByAggregate(data.rowsForTile(tile, state1), dim1, tile.measure, tile.aggFn);
  assert.deepStrictEqual(agg, [{ dimension: 'Casque audio', value: 220 }, { dimension: 'Enceinte', value: 40 }]);

  // Niveau 2 : détaille "Nord > Casque audio" par Année (mélange catégoriel + numérique dans la
  // même hiérarchie, sans aucun traitement spécial).
  store.drillInto('t1', 'Produit', 'Casque audio');
  let state2 = store.getState();
  let dim2 = data.currentDimension(tile, state2.drillIns.t1);
  assert.strictEqual(dim2, 'Annee');
  agg = data.groupByAggregate(data.rowsForTile(tile, state2), dim2, tile.measure, tile.aggFn);
  assert.deepStrictEqual(agg, [{ dimension: 2025, value: 100 }, { dimension: 2026, value: 120 }]);

  console.log('OK drill-down catégoriel non temporel (Région > Produit > Année) sans dérivation de date');
}

// state: addTile / removeTile
{
  const store = state.createStore();
  store.addTile({ id: 't1', type: 'bar' });
  store.addTile({ id: 't2', type: 'kpi' });
  assert.strictEqual(store.getState().tiles.length, 2);
  store.removeTile('t1');
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t2']);
  console.log('OK state.addTile/removeTile');
}

// state: updateTile (édition en place, position conservée dans le tableau)
{
  const store = state.createStore();
  store.addTile({ id: 't1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
  store.addTile({ id: 't2', type: 'kpi', measure: 'Montant', aggFn: 'sum' });
  store.updateTile('t1', { aggFn: 'avg', title: 'Montant par Région (moyenne)' });
  const tiles = store.getState().tiles;
  assert.strictEqual(tiles.length, 2); // pas de doublon
  assert.strictEqual(tiles[0].id, 't1'); // position conservée
  assert.strictEqual(tiles[0].aggFn, 'avg');
  assert.strictEqual(tiles[0].dimension, 'Region'); // champs non modifiés préservés
  assert.strictEqual(tiles[1].id, 't2'); // tuile voisine inchangée
  console.log('OK state.updateTile (édition en place)');
}

// state: moveTile (réorganisation, no-op sûr en bout de liste)
{
  const store = state.createStore();
  store.addTile({ id: 't1' });
  store.addTile({ id: 't2' });
  store.addTile({ id: 't3' });
  store.moveTile('t2', -1); // t2 monte d'un cran
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t2', 't1', 't3']);
  store.moveTile('t2', 1); // redescend -> retour à l'ordre initial
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t1', 't2', 't3']);
  store.moveTile('t1', -1); // déjà en tête -> no-op
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t1', 't2', 't3']);
  store.moveTile('t3', 1); // déjà en queue -> no-op
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t1', 't2', 't3']);
  store.moveTile('inconnu', 1); // id inexistant -> no-op, pas d'erreur
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t1', 't2', 't3']);
  console.log('OK state.moveTile (réorganisation + no-op en bout de liste / id inconnu)');
}

// state: bookmarks (vues sauvegardées = filtres + drill-down, PAS les tuiles)
{
  const store = state.createStore();
  store.addTile({ id: 't1', type: 'bar', dimension: 'Annee', drillDimension: 'Mois', measure: 'Montant', aggFn: 'sum' });
  store.toggleFilter('Region', 'Nord', 'tileA');
  store.drillInto('t1', 'Annee', 2026);
  store.saveBookmark('bm1', 'Nord, détail 2026');
  assert.strictEqual(store.getState().bookmarks.length, 1);
  assert.strictEqual(store.getState().bookmarks[0].name, 'Nord, détail 2026');

  // Revenir à un état différent...
  store.clearFilter();
  store.drillUp('t1');
  assert.deepStrictEqual(store.getState().activeFilters, []);
  assert.strictEqual(store.getState().drillIns.t1, undefined);

  // ... puis restaurer le bookmark doit tout remettre en place
  store.applyBookmark('bm1');
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Region', value: 'Nord', sourceTileId: 'tileA' }]);
  assert.deepStrictEqual(store.getState().drillIns.t1, [{ column: 'Annee', value: 2026 }]);

  store.removeBookmark('bm1');
  assert.strictEqual(store.getState().bookmarks.length, 0);
  store.applyBookmark('bm1'); // bookmark supprimé -> no-op, pas d'erreur
  console.log('OK state.saveBookmark/applyBookmark/removeBookmark');
}

// state: filtres avancés (setAdvancedFilter/clearAdvancedFilter) — au plus un par colonne comme
// toggleFilter, mais jamais de sourceTileId (posés depuis la barre de filtres, pas un clic sur une
// tuile) et capturés eux aussi dans les bookmarks.
{
  const store = state.createStore();
  store.setAdvancedFilter('Montant', { type: 'range', min: 0, max: 100 });
  assert.deepStrictEqual(store.getState().advancedFilters, [{ column: 'Montant', type: 'range', min: 0, max: 100 }]);

  // Reposer un filtre sur la MÊME colonne remplace l'ancien plutôt que de le cumuler (comme
  // toggleFilter sur une colonne déjà filtrée)
  store.setAdvancedFilter('Montant', { type: 'range', min: 50, max: 200 });
  assert.strictEqual(store.getState().advancedFilters.length, 1);
  assert.strictEqual(store.getState().advancedFilters[0].min, 50);

  // Une colonne différente s'ajoute (cumul en ET, comme les filtres croisés)
  store.setAdvancedFilter('Produit', { type: 'contains', query: 'audio' });
  assert.strictEqual(store.getState().advancedFilters.length, 2);

  store.clearAdvancedFilter('Montant');
  assert.deepStrictEqual(store.getState().advancedFilters.map((f) => f.column), ['Produit']);

  store.clearAdvancedFilter(); // sans argument -> tout efface
  assert.deepStrictEqual(store.getState().advancedFilters, []);
  console.log('OK state.setAdvancedFilter/clearAdvancedFilter (remplacement par colonne, cumul multi-colonnes, effacement total)');
}

// state: les filtres avancés sont capturés par les bookmarks au même titre que activeFilters/drillIns,
// avec repli sur [] pour un bookmark sauvegardé avant l'ajout de cette feature (compat ascendante)
{
  const store = state.createStore();
  store.setAdvancedFilter('Montant', { type: 'range', min: 0, max: 100 });
  store.saveBookmark('bm1', 'Petits montants');
  store.clearAdvancedFilter();
  assert.deepStrictEqual(store.getState().advancedFilters, []);
  store.applyBookmark('bm1');
  assert.deepStrictEqual(store.getState().advancedFilters, [{ column: 'Montant', type: 'range', min: 0, max: 100 }]);

  // Bookmark "ancien format" simulé (pas de champ advancedFilters du tout, comme avant cette feature)
  store.setBookmarks(store.getState().bookmarks.concat([{ id: 'bmOld', name: 'Ancien', activeFilters: [], drillIns: {} }]));
  store.setAdvancedFilter('Produit', { type: 'contains', query: 'x' }); // état courant à écraser par applyBookmark
  store.applyBookmark('bmOld');
  assert.deepStrictEqual(store.getState().advancedFilters, [], 'un bookmark sans advancedFilters restaure une liste vide, pas undefined');
  console.log('OK state.saveBookmark/applyBookmark capturent advancedFilters (+ compat ascendante bookmark sans ce champ)');
}

// state: suivi de la vue sauvegardée active (retours d'Antoine du 18/11/2026, point 4) — savoir qu'on
// regarde une vue déjà sauvegardée, si elle a été modifiée depuis, la mettre à jour ou la quitter
{
  // sameSnapshot : pur, insensible à l'ordre des filtres et aux détails de forme
  assert.ok(state.sameSnapshot(
    { activeFilters: [{ column: 'A', value: 1 }, { column: 'B', value: 2 }], advancedFilters: [], drillIns: {} },
    { activeFilters: [{ value: 2, column: 'B' }, { value: 1, column: 'A' }], advancedFilters: [], drillIns: {} }
  ), 'même ensemble de filtres, ordre et ordre des clés différents -> même vue');
  assert.ok(state.sameSnapshot(
    { activeFilters: [], advancedFilters: [], drillIns: { t1: [] } },
    { activeFilters: [], drillIns: {} }
  ), 'un chemin de drill-down vide = aucune entrée ; advancedFilters absent = []');
  assert.ok(!state.sameSnapshot(
    { activeFilters: [{ column: 'A', value: 1 }], advancedFilters: [], drillIns: {} },
    { activeFilters: [{ column: 'A', value: 2 }], advancedFilters: [], drillIns: {} }
  ), 'une valeur différente = autre vue');
  assert.ok(!state.sameSnapshot(
    { activeFilters: [], advancedFilters: [], drillIns: { t1: [{ column: 'A', value: 1 }] } },
    { activeFilters: [], advancedFilters: [], drillIns: {} }
  ), 'un drill-down de plus = autre vue');

  const store = state.createStore();
  store.addTile({ id: 't1', type: 'bar', dimension: 'Annee', drillDimension: 'Mois', measure: 'Montant', aggFn: 'sum' });
  let s = store.getState();
  assert.strictEqual(s.activeBookmarkId, null, 'aucune vue suivie au départ');
  assert.strictEqual(s.activeBookmarkModified, false);

  // Sauvegarder = on suit cette vue, non modifiée
  store.toggleFilter('Region', 'Nord', 'tileA');
  store.saveBookmark('bm1', 'Nord');
  s = store.getState();
  assert.strictEqual(s.activeBookmarkId, 'bm1');
  assert.strictEqual(s.activeBookmarkModified, false, 'la vue qu\'on vient de sauvegarder n\'est pas modifiée');

  // Toute modification des filtres la rend « modifiée »
  store.toggleFilter('Produit', 'Widget', 'tileA');
  assert.strictEqual(store.getState().activeBookmarkId, 'bm1');
  assert.strictEqual(store.getState().activeBookmarkModified, true);
  // ... et défaire la modification la rend de nouveau identique (dérivé, pas un drapeau collant)
  store.toggleFilter('Produit', 'Widget', 'tileA');
  assert.strictEqual(store.getState().activeBookmarkModified, false);
  store.setAdvancedFilter('Montant', { type: 'range', min: 0, max: 10 });
  assert.strictEqual(store.getState().activeBookmarkModified, true, 'un filtre avancé de plus modifie la vue');
  store.clearAdvancedFilter();
  store.drillInto('t1', 'Annee', 2026);
  assert.strictEqual(store.getState().activeBookmarkModified, true, 'un drill-down de plus modifie la vue');
  store.drillUp('t1');
  assert.strictEqual(store.getState().activeBookmarkModified, false);

  // Mettre à jour : la vue prend l'état actuel, même id/nom, nouvelle référence de `bookmarks`
  store.toggleFilter('Canal', 'Web', 'tileA');
  const before = store.getState().bookmarks;
  store.updateBookmark('bm1');
  s = store.getState();
  assert.notStrictEqual(s.bookmarks, before, 'nouvelle référence : main.js y voit un changement à persister');
  assert.strictEqual(s.bookmarks.length, 1);
  assert.strictEqual(s.bookmarks[0].id, 'bm1');
  assert.strictEqual(s.bookmarks[0].name, 'Nord');
  assert.strictEqual(s.bookmarks[0].activeFilters.length, 2);
  assert.strictEqual(s.activeBookmarkModified, false);
  store.updateBookmark('inconnue'); // id inconnu -> no-op
  assert.strictEqual(store.getState().bookmarks, s.bookmarks);

  // Quitter : les filtres restent, plus de suivi
  store.leaveBookmark();
  s = store.getState();
  assert.strictEqual(s.activeBookmarkId, null);
  assert.strictEqual(s.activeBookmarkModified, false);
  assert.strictEqual(s.activeFilters.length, 2, 'quitter la vue ne touche pas aux filtres');

  // Appliquer une autre vue la rend active
  store.clearFilter();
  store.saveBookmark('bm2', 'Sans filtre'); // vue vide : valide
  store.applyBookmark('bm1');
  assert.strictEqual(store.getState().activeBookmarkId, 'bm1');
  assert.strictEqual(store.getState().activeBookmarkModified, false);
  store.applyBookmark('bm2');
  assert.strictEqual(store.getState().activeBookmarkId, 'bm2');
  assert.deepStrictEqual(store.getState().activeFilters, []);
  store.applyBookmark('inconnue'); // no-op : le suivi ne bouge pas
  assert.strictEqual(store.getState().activeBookmarkId, 'bm2');

  // Une vue vide suivie devient « modifiée » dès qu'on pose un filtre
  store.toggleFilter('Region', 'Sud', 'tileA');
  assert.strictEqual(store.getState().activeBookmarkModified, true);

  // Supprimer la vue suivie libère le suivi ; supprimer une autre vue n'y touche pas
  store.removeBookmark('bm1');
  assert.strictEqual(store.getState().activeBookmarkId, 'bm2');
  store.removeBookmark('bm2');
  assert.strictEqual(store.getState().activeBookmarkId, null);
  assert.strictEqual(store.getState().activeBookmarkModified, false);

  // Changer de table (setBookmarks) ne suit plus rien, même si un id identique existait
  store.saveBookmark('bm3', 'Autre');
  assert.strictEqual(store.getState().activeBookmarkId, 'bm3');
  store.setBookmarks([{ id: 'bm3', name: 'Autre table', activeFilters: [], advancedFilters: [], drillIns: {} }]);
  assert.strictEqual(store.getState().activeBookmarkId, null, 'setBookmarks (changement de table) lève le suivi');

  // Un bookmark d'avant les filtres avancés (pas de champ) se compare comme [] et s'applique sans casse
  store.setBookmarks([{ id: 'old', name: 'Ancien', activeFilters: [], drillIns: {} }]);
  store.applyBookmark('old');
  assert.strictEqual(store.getState().activeBookmarkModified, false);
  console.log('OK state : suivi de la vue active (sameSnapshot, modifiée dérivée, mettre à jour, quitter, supprimer, changer de table)');
}

// state: setBlend (data blending multi-tables) — propre à la table de travail courante, comme
// bookmarks/pages (voir js/grist-api.js/js/main.js), pas capturé par les bookmarks eux-mêmes.
{
  const store = state.createStore();
  assert.strictEqual(store.getState().blend, null, 'aucune jointure par défaut');
  const blend = { secondaryTableId: 'Villes', primaryColumn: 'Region', secondaryColumn: 'Region' };
  store.setBlend(blend);
  assert.deepStrictEqual(store.getState().blend, blend);
  store.setBlend(null); // retirer la jointure
  assert.strictEqual(store.getState().blend, null);
  store.setBlend(undefined); // comme setBookmarks(undefined) -> [] : repli sur la valeur par défaut
  assert.strictEqual(store.getState().blend, null);
  console.log('OK state.setBlend (jointure propre à la table courante, repli sur null)');
}

// state: setComments/addCommentLocal (commentaires collaboratifs) — contrairement à blend/bookmarks/
// pages, PAS propre à une table de travail (voir js/state.js) : setComments remplace TOUJOURS
// l'ensemble complet (relecture de BI_Dashboard_Comments), addCommentLocal ajoute un commentaire
// déjà écrit côté Grist sans redemander toute la table.
{
  const store = state.createStore();
  assert.deepStrictEqual(store.getState().comments, [], 'aucun commentaire par défaut');
  const loaded = [{ id: 1, TableId: 'T', TileId: 'tile_a', Author: 'Ana', Text: 'Salut', CreatedAt: '2026-09-29T08:00:00.000Z' }];
  store.setComments(loaded);
  assert.deepStrictEqual(store.getState().comments, loaded);
  const added = { id: 2, TableId: 'T', TileId: 'tile_a', Author: 'Bea', Text: 'Bonjour', CreatedAt: '2026-09-29T09:00:00.000Z' };
  store.addCommentLocal(added);
  assert.deepStrictEqual(store.getState().comments, loaded.concat([added]), 'ajout optimiste, sans perdre les commentaires déjà chargés');
  store.setComments(undefined); // comme setBookmarks(undefined)/setBlend(undefined) -> repli sur []
  assert.deepStrictEqual(store.getState().comments, []);
  console.log('OK state.setComments/addCommentLocal (chargement complet + ajout optimiste, repli sur [])');
}

// state: dashboards multi-pages — nominal (addTile/removeTile/updateTile/moveTile n'agissent QUE
// sur la page courante, les autres pages restent intactes)
{
  const store = state.createStore();
  const page1Id = store.getState().currentPageId; // page par défaut créée à l'initialisation
  assert.strictEqual(store.getState().pages.length, 1);
  store.addTile({ id: 't1', type: 'bar' });

  const page2Id = store.addPage('Page 2');
  assert.strictEqual(store.getState().currentPageId, page2Id, 'addPage navigue vers la page créée');
  assert.strictEqual(store.getState().pages.length, 2);
  assert.deepStrictEqual(store.getState().tiles, [], 'la nouvelle page démarre sans tuile');
  store.addTile({ id: 't2', type: 'kpi' });
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t2']);

  store.setCurrentPage(page1Id);
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t1'], 'la page 1 garde sa propre tuile, non affectée par les actions sur la page 2');
  store.updateTile('t1', { title: 'Renommée' });
  assert.strictEqual(store.getState().tiles[0].title, 'Renommée');

  store.setCurrentPage(page2Id);
  assert.strictEqual(store.getState().tiles[0].title, undefined, 'updateTile sur la page 1 ne doit pas modifier la tuile de la page 2');

  store.setCurrentPage('id-inexistant');
  assert.strictEqual(store.getState().currentPageId, page2Id, 'setCurrentPage avec un id inconnu est un no-op');

  store.renamePage(page2Id, 'Ventes détaillées');
  assert.strictEqual(store.getState().pages.find((p) => p.id === page2Id).name, 'Ventes détaillées');
  console.log('OK state.addPage/setCurrentPage/renamePage (isolation des tuiles par page)');
}

// state: dashboards multi-pages — filtres croisés et drill-down restent GLOBAUX entre pages
// (décision produit délibérée de v1, voir ROADMAP.md/HYPOTHESES.md), removePage nettoie les
// filtres/drill-down des tuiles qui disparaissent avec elle, et une page unique ne se supprime
// jamais (garde-fou : toujours au moins une page).
{
  const store = state.createStore();
  const page1Id = store.getState().currentPageId;
  store.addTile({ id: 't1', type: 'bar', dimension: 'Annee', drillDimension: 'Mois', drillCrossFilter: true, measure: 'Montant', aggFn: 'sum' });
  store.drillInto('t1', 'Annee', 2026);
  store.toggleFilter('Region', 'Nord', 'tileExterne');
  assert.strictEqual(store.getState().activeFilters.length, 2); // le filtre externe + le cross-filter du drill

  const page2Id = store.addPage('Page 2');
  assert.strictEqual(store.getState().activeFilters.length, 2, 'les filtres actifs restent visibles après changement de page (globaux, pas par page)');
  store.addTile({ id: 't2', type: 'kpi' });

  store.removePage(page1Id);
  assert.strictEqual(store.getState().pages.length, 1);
  assert.strictEqual(store.getState().currentPageId, page2Id, 'supprimer la page courante bascule sur une page restante');
  assert.strictEqual(store.getState().drillIns.t1, undefined, 'le drill-down de la tuile supprimée avec sa page est nettoyé');
  assert.deepStrictEqual(store.getState().activeFilters, [{ column: 'Region', value: 'Nord', sourceTileId: 'tileExterne' }], 'le cross-filter posé par la tuile supprimée disparaît, le filtre externe reste');

  store.removePage(page2Id); // dernière page restante -> no-op
  assert.strictEqual(store.getState().pages.length, 1);
  assert.strictEqual(store.getState().pages[0].id, page2Id);
  console.log('OK state.removePage (nettoyage drill/filtres + garde-fou dernière page) + filtres globaux inter-pages');
}

// state: setPages — chargement d'une config multi-pages complète (voir grist-api.js), y compris le
// repli si currentPageId sauvegardé ne correspond plus à aucune page (page supprimée entre deux
// sauvegardes d'un autre poste, config corrompue à la main, etc.)
{
  const store = state.createStore();
  const loaded = [
    { id: 'pA', name: 'Ventes', tiles: [{ id: 't1', type: 'bar' }] },
    { id: 'pB', name: 'Stock', tiles: [{ id: 't2', type: 'kpi' }] }
  ];
  store.setPages(loaded, 'pB');
  assert.strictEqual(store.getState().currentPageId, 'pB');
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['t2']);

  store.setPages(loaded, 'id-disparu');
  assert.strictEqual(store.getState().currentPageId, 'pA', 'repli sur la première page si le currentPageId sauvegardé est invalide');

  store.setPages([], 'peu-importe');
  assert.strictEqual(store.getState().pages.length, 1, 'setPages avec un tableau vide retombe sur une page par défaut plutôt que zéro page');
  console.log('OK state.setPages (chargement config + repli currentPageId invalide + garde-fou tableau vide)');
}

// main.js:switchTable + render() — consigne GFS 009 : CHARGER un rapport (y compris vierge,
// "Nouveau" dans GFS) ne doit jamais, par lui-même, planifier une sauvegarde (main.js:scheduleSave) ;
// seul un geste réel de la personne doit écrire une ligne dans BI_Dashboard_Config. render()
// (main.js) détecte un geste en comparant state.pages/bookmarks/blend PAR RÉFÉRENCE à lastRendered*
// (variables tenues par main.js, hors du store) ; le correctif lève un drapeau `suppressNextSave`
// pendant tout le bloc synchrone où switchTable pose saved.pages/bookmarks/blend (3 notify(), un par
// store.set*) — render() continue de mettre lastRendered* à jour à chaque notify (pour ne pas se
// désynchroniser), mais ne planifie aucune sauvegarde tant que le drapeau reste levé. Un drapeau
// aligné puis rebaissé APRÈS les 3 appels (plutôt qu'à l'intérieur de la condition de render(),
// qui tournerait sinon 3 fois et retomberait à `false` dès la première) est indispensable : un essai
// plus simple (aligner lastRendered* sur `saved.*` avant de les poser, sans drapeau) échoue ici,
// car les 3 notify() se déclenchent un par un et voient un état intermédiaire incohérent (ex.
// `pages` déjà chargé mais `bookmarks`/`blend` encore ceux de l'ANCIEN rapport) — détecté par ce
// test avant ce correctif (saveCount valait 2, pas 0). main.js n'est pas chargeable sous Node (glue
// DOM/Grist, voir CLAUDE.md §2) : ce test reproduit le même idiome (subscriber + comparaison par
// référence + drapeau) directement contre js/state.js pour couvrir le mécanisme réel sous Node.
{
  const store = state.createStore();
  let lastRenderedPages = null;
  let lastRenderedCurrentPageId = null;
  let lastRenderedBookmarks = null;
  let lastRenderedBlend = null;
  let suppressNextSave = false;
  let saveCount = 0;
  store.subscribe((s) => {
    if (s.pages !== lastRenderedPages || s.currentPageId !== lastRenderedCurrentPageId ||
        s.bookmarks !== lastRenderedBookmarks || s.blend !== lastRenderedBlend) {
      lastRenderedPages = s.pages;
      lastRenderedCurrentPageId = s.currentPageId;
      lastRenderedBookmarks = s.bookmarks;
      lastRenderedBlend = s.blend;
      if (!suppressNextSave) saveCount += 1;
    }
  });

  // Reproduit switchTable(tableId, rows, report) après son correctif (js/main.js) : lève le
  // drapeau, pose saved.pages/bookmarks/blend (3 notify()), le rebaisse. Avant ce correctif,
  // switchTable posait directement saved.* sans drapeau, et le subscriber ci-dessus aurait vu ça
  // comme un ou plusieurs changements (saveCount serait passé au-dessus de 0 sans aucun geste de la
  // personne — le bug mesuré par GFS, consigne 009).
  function loadReportLikeSwitchTable(saved) {
    suppressNextSave = true;
    store.setPages(saved.pages, saved.currentPageId);
    store.setBookmarks(saved.bookmarks);
    store.setBlend(saved.blend);
    suppressNextSave = false;
  }

  // "Nouveau" dans GFS (openBlankReport) : GristBI.api.blankConfig().
  const blank = { pages: [{ id: 'page_default', name: 'Page 1', tiles: [] }], currentPageId: 'page_default', bookmarks: [], blend: null };
  loadReportLikeSwitchTable(blank);
  assert.strictEqual(saveCount, 0, 'charger un rapport vierge ("Nouveau") ne doit déclencher aucune sauvegarde par lui-même');

  // Ouvrir un rapport déjà enregistré (openReportById) ne doit pas non plus resauvegarder sa propre
  // config telle quelle.
  const existing = { pages: [{ id: 'pA', name: 'Ventes', tiles: [{ id: 't0', type: 'bar' }] }], currentPageId: 'pA', bookmarks: [{ id: 'bk1', name: 'Vue 1' }], blend: { secondaryTableId: 'Autre', primaryColumn: 'Id', secondaryColumn: 'Id' } };
  loadReportLikeSwitchTable(existing);
  assert.strictEqual(saveCount, 0, 'ouvrir un rapport déjà enregistré ne doit pas non plus déclencher de sauvegarde par lui-même');

  // Un VRAI geste de la personne (ex. le bouton "+ Tuile") change la référence de `pages` -> doit
  // toujours être détecté et sauvegardé, exactement comme avant ce correctif.
  store.addTile({ id: 't1', type: 'kpi' });
  assert.strictEqual(saveCount, 1, 'un geste réel de la personne doit toujours déclencher exactement une sauvegarde');

  console.log('OK main.js:switchTable+render (consigne GFS 009) — charger un rapport (vierge ou déjà enregistré) ne planifie plus de sauvegarde, un geste réel si');
}

// main.js:switchTable — consigne GFS 010 : le drapeau `suppressNextSave` (voir le test 009
// ci-dessus) est levé puis baissé dans un `try…finally`, pas un simple "levé puis baissé" - GFS a
// relevé que `render()` tourne à chaque `store.set*` pendant le chargement et PEUT lever (une tuile
// qu'il ne sait pas dessiner, une configuration abîmée) ; `notify()` (js/state.js) ne rattrape rien
// lui-même. Sans `finally`, une exception laisserait le drapeau levé pour le reste de la session :
// plus aucun geste réel de la personne ne se sauvegarderait ensuite, sans le moindre message.
{
  const store = state.createStore();
  let lastRenderedPages = null;
  let lastRenderedCurrentPageId = null;
  let lastRenderedBookmarks = null;
  let lastRenderedBlend = null;
  let suppressNextSave = false;
  let saveCount = 0;
  let throwOnNextBookmarks = false;
  store.subscribe((s) => {
    if (s.pages !== lastRenderedPages || s.currentPageId !== lastRenderedCurrentPageId ||
        s.bookmarks !== lastRenderedBookmarks || s.blend !== lastRenderedBlend) {
      lastRenderedPages = s.pages;
      lastRenderedCurrentPageId = s.currentPageId;
      lastRenderedBookmarks = s.bookmarks;
      lastRenderedBlend = s.blend;
      if (throwOnNextBookmarks) { throwOnNextBookmarks = false; throw new Error('tuile illisible (simulée)'); }
      if (!suppressNextSave) saveCount += 1;
    }
  });

  // Reproduit switchTable (js/main.js) APRÈS la consigne 010 : try…finally autour des 3 store.set*.
  function loadReportWithGuard(saved) {
    suppressNextSave = true;
    try {
      store.setPages(saved.pages, saved.currentPageId);
      store.setBookmarks(saved.bookmarks);
      store.setBlend(saved.blend);
    } finally {
      suppressNextSave = false;
    }
  }

  const blank = { pages: [{ id: 'page_default', name: 'Page 1', tiles: [] }], currentPageId: 'page_default', bookmarks: [], blend: null };
  throwOnNextBookmarks = true; // simule render() qui lève pendant le TOUT PREMIER store.set* du chargement
  assert.throws(() => loadReportWithGuard(blank), /tuile illisible/, 'l\'exception du rendu doit remonter (pas avalée ici), seul le drapeau est garanti retomber');
  assert.strictEqual(suppressNextSave, false, 'le drapeau doit retomber MÊME si render() a levé pendant le chargement (try…finally, consigne GFS 010)');
  assert.strictEqual(saveCount, 0, 'aucune sauvegarde ne doit avoir été planifiée pendant ce chargement en échec');

  // Un geste réel après cet échec doit continuer à se sauvegarder normalement - c'est précisément
  // ce qu'un drapeau resté bloqué (sans finally) aurait silencieusement empêché.
  store.addTile({ id: 't1', type: 'kpi' });
  assert.strictEqual(saveCount, 1, 'un geste réel après un chargement en échec doit quand même être sauvegardé (le drapeau n\'est pas resté bloqué)');

  console.log('OK main.js:switchTable (consigne GFS 010) — le drapeau retombe même si render() lève pendant le chargement (try…finally), un geste réel se sauvegarde toujours ensuite');
}

// demo-data: deriveDateColumn — recalcule Date à partir des colonnes déjà présentes sur une ligne
// EXISTANTE (pas au moment de la génération), pour la migration de schéma d'une table déjà créée
// (voir grist-api.js:ensureColumnsUpToDate) : AddColumn + remplissage, jamais une nouvelle table.
{
  assert.deepStrictEqual(demoData.deriveDateColumn({ Annee: 2025, Mois: 'Décembre', Jour: 28 }), { Date: '2025-12-28' });
  // Cohérent avec la colonne Date générée directement par buildLargeSampleRows
  const largeRow = demoData.buildLargeSampleRows()[0];
  assert.deepStrictEqual(demoData.deriveDateColumn(largeRow), { Date: largeRow.Date });
  console.log('OK demoData.deriveDateColumn (cohérent avec la génération directe)');
}

// demo-data: jeu de données "test de charge" - volume + cohérence + perf d'agrégation côté client
{
  const t0 = Date.now();
  const large = demoData.buildLargeSampleRows();
  const buildMs = Date.now() - t0;
  const expectedLargeCount = demoData.REGIONS.length * demoData.PRODUITS.length
    * demoData.ANNEES_LARGE.length * demoData.MOIS.length * demoData.JOURS_PAR_MOIS;
  assert.strictEqual(large.length, expectedLargeCount);
  const colIds = demoData.COLUMNS_LARGE.map((c) => c.id);
  for (const col of colIds) assert.ok(col in large[0], `colonne manquante: ${col}`);
  assert.ok(large.every((r) => r.Quantite > 0 && r.Montant > 0));

  const t1 = Date.now();
  const parAnnee = data.groupByAggregate(large, 'Annee', 'Montant', 'sum');
  const parMois = data.groupByAggregate(large, 'Mois', 'Montant', 'avg');
  const filtered = data.applyFilters(large, [{ column: 'Region', value: 'Nord' }, { column: 'Annee', value: 2026 }]);
  const aggregateMs = Date.now() - t1;

  assert.strictEqual(parAnnee.length, demoData.ANNEES_LARGE.length);
  assert.strictEqual(parMois.length, demoData.MOIS.length);
  assert.ok(filtered.length > 0 && filtered.length < large.length);
  // Pas une assertion stricte de perf (dépend trop de la machine) : juste un garde-fou généreux
  // pour repérer une régression algorithmique grossière (ex. un tri/parcours O(n²) introduit par
  // erreur), pas pour valider un budget de perf précis.
  assert.ok(aggregateMs < 2000, `agrégation anormalement lente pour ${large.length} lignes : ${aggregateMs}ms`);

  const largeTiles = demoData.defaultLargeTiles();
  const availableLargeCols = new Set(colIds);
  for (const tile of largeTiles) {
    if (tile.type !== 'kpi') assert.ok(availableLargeCols.has(tile.dimension));
    for (const lvl of data.tileDrillLevels(tile)) assert.ok(availableLargeCols.has(lvl));
  }

  console.log(`OK demoData.buildLargeSampleRows (${large.length} lignes, génération ${buildMs}ms, `
    + `3 agrégations/filtrage ${aggregateMs}ms) + defaultLargeTiles`);
}

// combobox.filterOptions : sous-chaîne insensible à la casse, ordre d'origine préservé, query vide
// -> tout matche (état du menu à l'ouverture avant toute saisie)
{
  const options = ['Région', 'Produit', 'Montant', 'Quantite'];
  assert.deepStrictEqual(combobox.filterOptions(options, ''), options);
  assert.deepStrictEqual(combobox.filterOptions(options, 'on'), ['Région', 'Montant']); // ordre d'origine, pas alphabétique
  assert.deepStrictEqual(combobox.filterOptions(options, 'MON'), ['Montant']); // insensible à la casse
  assert.deepStrictEqual(combobox.filterOptions(options, 'xyz'), []);
  assert.deepStrictEqual(combobox.filterOptions(options, '  produit  '), ['Produit']); // espaces superflus ignorés
  console.log('OK combobox.filterOptions (sous-chaîne insensible à la casse, ordre préservé, query vide/espaces)');
}

// combobox.highlightMatch : découpe autour de la 1re occurrence, pour surligner le texte tapé
{
  assert.deepStrictEqual(combobox.highlightMatch('Montant', 'ont'), { before: 'M', match: 'ont', after: 'ant' });
  assert.deepStrictEqual(combobox.highlightMatch('Montant', 'MON'), { before: '', match: 'Mon', after: 'tant' }); // insensible à la casse, casse d'origine conservée dans `match`
  assert.deepStrictEqual(combobox.highlightMatch('Montant', ''), { before: 'Montant', match: '', after: '' });
  assert.deepStrictEqual(combobox.highlightMatch('Montant', 'xyz'), { before: 'Montant', match: '', after: '' });
  console.log('OK combobox.highlightMatch (découpe autour de la 1re occurrence, insensible à la casse)');
}

// duckdbEngine.csvEscape/assertSafeIdentifier : logique pure (le chargement/l'exécution SQL réels
// exigent un vrai navigateur — Worker + WASM — voir duckdb-engine-test.js, Playwright, dans
// TEST_PROTOCOL.md).
{
  assert.strictEqual(duckdbEngine.csvEscape('Nord'), 'Nord');
  assert.strictEqual(duckdbEngine.csvEscape(42), '42');
  assert.strictEqual(duckdbEngine.csvEscape(null), '');
  assert.strictEqual(duckdbEngine.csvEscape(undefined), '');
  assert.strictEqual(duckdbEngine.csvEscape('a,b'), '"a,b"');
  assert.strictEqual(duckdbEngine.csvEscape('a"b'), '"a""b"'); // guillemet interne doublé
  assert.strictEqual(duckdbEngine.csvEscape('a\nb'), '"a\nb"');
  console.log('OK duckdbEngine.csvEscape (virgule/guillemet/retour à la ligne échappés, valeurs nulles -> chaîne vide)');
}
{
  assert.strictEqual(duckdbEngine.assertSafeIdentifier('Region'), 'Region');
  assert.throws(() => duckdbEngine.assertSafeIdentifier('a"b'), /invalide/);
  assert.throws(() => duckdbEngine.assertSafeIdentifier(''), /invalide/);
  assert.throws(() => duckdbEngine.assertSafeIdentifier(null), /invalide/);
  console.log('OK duckdbEngine.assertSafeIdentifier (rejette un nom de colonne contenant un guillemet, vide ou non-chaîne)');
}

// data.periodLabel/measureSeriesForTile : transforment le résultat de
// duckdbEngine.timeSeriesMeasures (Roadmap Tier 2, "Mesures façon DAX simplifié" — YTD/N-1/cumul)
// en catégories/séries affichables. Logique pure (aucune dépendance ECharts/DuckDB), testée ici sur
// un résultat synthétique plutôt que le calcul SQL réel lui-même (voir duckdb-engine-test.js,
// Playwright, TEST_PROTOCOL.md, pour la vérification de la requête SQL contre un vrai navigateur).
{
  assert.strictEqual(data.periodLabel('2025-01-01'), '2025-01');
  assert.strictEqual(data.periodLabel('2026-12-01'), '2026-12');
  assert.strictEqual(data.periodLabel(null), 'null'); // valeur inattendue -> String(), pas une exception
  console.log('OK data.periodLabel (AAAA-MM-JJ -> AAAA-MM)');
}

// Résultat synthétique délibérément NON trivial (valeurs volontairement pas dans un ordre qui
// masquerait un bug de correspondance par index) : 3 mois, dont le 1er (janvier) sans donnée
// l'année précédente (previousYear: null, voir timeSeriesMeasures — 1re année de la série).
const SAMPLE_TIME_SERIES = [
  { period: '2026-01-01', value: 100, cumulative: 100, ytd: 100, previousYear: null },
  { period: '2026-02-01', value: 50, cumulative: 150, ytd: 150, previousYear: 80 },
  { period: '2026-03-01', value: -20, cumulative: 130, ytd: 130, previousYear: 40 }
];

{
  const { categories, series } = data.measureSeriesForTile('cumulative', SAMPLE_TIME_SERIES);
  assert.deepStrictEqual(categories, ['2026-01', '2026-02', '2026-03']);
  assert.strictEqual(series.length, 1);
  assert.deepStrictEqual(series[0].data, [100, 150, 130]);
  console.log('OK data.measureSeriesForTile("cumulative") — 1 seule série, valeurs cumulatives');
}

{
  const { series } = data.measureSeriesForTile('ytd', SAMPLE_TIME_SERIES);
  assert.strictEqual(series.length, 1);
  assert.deepStrictEqual(series[0].data, [100, 150, 130]);
  console.log('OK data.measureSeriesForTile("ytd") — 1 seule série, valeurs YTD');
}

{
  const { series } = data.measureSeriesForTile('yoy', SAMPLE_TIME_SERIES);
  assert.strictEqual(series.length, 2);
  assert.deepStrictEqual(series[0].data, [100, 50, -20]); // "Valeur"
  assert.deepStrictEqual(series[1].data, [null, 80, 40]); // "N-1" — null conservé (pas de donnée en janvier N-1)
  console.log('OK data.measureSeriesForTile("yoy") — 2 séries (Valeur/N-1), null préservé plutôt que 0');
}

{
  const { categories, series } = data.measureSeriesForTile('cumulative', []);
  assert.deepStrictEqual(categories, []);
  assert.deepStrictEqual(series[0].data, []);
  console.log('OK data.measureSeriesForTile — série temporelle vide -> catégories/données vides, pas d\'exception');
}

// data.waterfallSeries (tuile "Cascade (waterfall)", js/charts.js:renderChart) : décompose un
// agrégat ordonné en 3 séries empilables (base invisible + hausse/baisse visibles) simulant une
// vraie série waterfall, absente d'ECharts — voir ROADMAP.md.
{
  // Mélange hausse/baisse/zéro, dans l'ORDRE D'APPARITION (jamais retrié, piège n°14) : +10, -4, 0, +7.
  const agg = [
    { dimension: 'A', value: 10 },
    { dimension: 'B', value: -4 },
    { dimension: 'C', value: 0 },
    { dimension: 'D', value: 7 }
  ];
  const { base, rise, fall } = data.waterfallSeries(agg);
  // Cumul attendu après chaque catégorie : 10, 6, 6, 13.
  assert.deepStrictEqual(base, [0, 6, 6, 6]); // min(départ, arrivée) de chaque barre
  assert.deepStrictEqual(rise, [10, 0, 0, 7]);
  assert.deepStrictEqual(fall, [0, 4, 0, 0]);
  console.log('OK data.waterfallSeries (cumul correct, hausse/baisse/zéro décomposés, ordre préservé)');
}
{
  const { base, rise, fall } = data.waterfallSeries([]);
  assert.deepStrictEqual(base, []);
  assert.deepStrictEqual(rise, []);
  assert.deepStrictEqual(fall, []);
  console.log('OK data.waterfallSeries — agrégat vide -> 3 tableaux vides, pas d\'exception');
}

// --- js/i18n.js : mécanisme de traduction fr/en (data-i18n, voir index.html/harness.html) ---

// Complétude du dictionnaire : chaque clé doit porter fr ET en, non vides — une entrée oubliée
// n'échouerait sinon qu'au hasard d'un test manuel en anglais (voir MAINTENANCE en tête du fichier,
// même garde-fou que publipostageGrist/js/i18n.js).
{
  const keys = Object.keys(i18n.STRINGS);
  assert.ok(keys.length > 0, 'STRINGS ne doit pas être vide');
  for (const key of keys) {
    const entry = i18n.STRINGS[key];
    assert.ok(typeof entry.fr === 'string' && entry.fr.trim() !== '', `${key} : traduction fr manquante ou vide`);
    assert.ok(typeof entry.en === 'string' && entry.en.trim() !== '', `${key} : traduction en manquante ou vide`);
  }
  console.log(`OK i18n.STRINGS — ${keys.length} clés, toutes avec fr ET en non vides`);
}

// t()/getLang()/setLang() fonctionnent sans DOM ni localStorage (Node) — repli silencieux plutôt
// qu'une exception, comme documenté en tête de js/i18n.js.
{
  assert.strictEqual(i18n.getLang(), 'fr'); // repli par défaut hors navigateur (pas de localStorage)
  assert.strictEqual(i18n.t('topbar.title'), 'Dashboard BI');
  i18n.setLang('en');
  assert.strictEqual(i18n.getLang(), 'en');
  assert.strictEqual(i18n.t('topbar.title'), 'BI Dashboard');
  i18n.setLang('fr');
  assert.strictEqual(i18n.getLang(), 'fr');
  console.log('OK i18n.t/getLang/setLang — bascule fr/en, repli "fr" par défaut sans localStorage');
}

// Clé inconnue : avertit (console.warn) et renvoie la clé elle-même plutôt que planter ou renvoyer
// une chaîne vide silencieuse — permet de repérer un data-i18n mal orthographié à l'écran.
{
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const result = i18n.t('cle.qui.nexiste.pas');
  console.warn = originalWarn;
  assert.strictEqual(result, 'cle.qui.nexiste.pas');
  assert.ok(warned, 'une clé inconnue doit avertir en console');
  console.log('OK i18n.t — clé inconnue : avertit et renvoie la clé (pas de plantage, pas de silence)');
}

// Substitution de variables ({var}) et pluriel ({n|singulier|pluriel}, via Intl.PluralRules) —
// mêmes règles pour fr (0 et 1 au singulier) et en (seul 1 au singulier).
{
  assert.strictEqual(i18n.t('table.connectFailed', { table: 'Ventes' }), 'Impossible de se connecter à la table "Ventes" — voir la console (F12).');
  assert.strictEqual(i18n.t('status.rowCount', { n: 0 }), '0 ligne');
  assert.strictEqual(i18n.t('status.rowCount', { n: 1 }), '1 ligne');
  assert.strictEqual(i18n.t('status.rowCount', { n: 2 }), '2 lignes');
  i18n.setLang('en');
  assert.strictEqual(i18n.t('status.rowCount', { n: 0 }), '0 rows');
  assert.strictEqual(i18n.t('status.rowCount', { n: 1 }), '1 row');
  assert.strictEqual(i18n.t('status.rowCount', { n: 2 }), '2 rows');
  i18n.setLang('fr');
  console.log('OK i18n.t — substitution de variables + pluriel fr/en (Intl.PluralRules)');
}

// Titres de tuile : un titre auto-composé porte sa clé de traduction (`titleKey`/`titleVars`) et suit
// la langue ; une tuile sans clé (ancienne config, import Power BI, titre libre) garde son `title`
// stocké tel quel — jamais une chaîne vide ni une exception, même pour une clé devenue inconnue
// (audit UI/UX du 18/11/2026 : « Montant par Région » restait en français sous une interface EN).
{
  const tile = { title: 'Montant par Région', titleKey: 'tileTitle.measureByDimension', titleVars: { measure: 'Montant', dimension: 'Région' } };
  assert.strictEqual(i18n.tileTitle(tile), 'Montant par Région');
  i18n.setLang('en');
  assert.strictEqual(i18n.tileTitle(tile), 'Montant by Région');
  assert.strictEqual(i18n.tileTitle({ title: 'Mon titre' }), 'Mon titre', 'sans titleKey : le titre stocké tel quel');
  assert.strictEqual(i18n.tileTitle({ title: 'Repli', titleKey: 'tileTitle.cle.inconnue' }), 'Repli', 'clé inconnue : repli sur le titre stocké, sans avertissement bruyant');
  assert.strictEqual(i18n.tileTitle({}), '', 'tuile sans aucun titre : chaîne vide, jamais undefined');
  assert.strictEqual(i18n.tileTitle(null), '');
  assert.strictEqual(i18n.tileTitle({ title: 'x', titleKey: 'tileTitle.pivot', titleVars: { measure: 'M', dimension: 'A', columnDimension: 'B' } }), 'M by A × B');
  assert.strictEqual(i18n.tileTitle({ title: 'x', titleKey: 'tileTitle.yoy', titleVars: { agg: 'sum', measure: 'M' } }), 'Year-over-year: sum(M)');
  i18n.setLang('fr');
  assert.strictEqual(i18n.tileTitle({ title: 'x', titleKey: 'tileTitle.yoy', titleVars: { agg: 'sum', measure: 'M' } }), 'Comparaison N-1 : sum(M)');
  console.log('OK i18n.tileTitle — titre auto-composé traduit, repli sur le titre stocké (fr/en)');
}

// Barre unique (audit UI/UX du 18/11/2026, lot 1) : placement des menus déroulants et navigation au
// clavier des onglets/menus — les fonctions pures de js/appbar.js ; le câblage DOM (ouverture, Échap,
// focus) est exercé par les scripts Playwright, jamais depuis Node.
{
  const appbar = require('../js/appbar.js');
  const vp = { width: 700, height: 400 };
  // Cas nominal : le bord gauche du panneau s'aligne sur celui du bouton, 6 px sous lui.
  let spot = appbar.placePopover({ left: 100, right: 160, bottom: 48 }, { width: 300 }, vp);
  assert.deepStrictEqual(spot, { left: 100, top: 54, maxHeight: 400 - 54 - 8 });
  // Débordement à droite : le bord DROIT du panneau s'aligne sur celui du bouton.
  spot = appbar.placePopover({ left: 600, right: 660, bottom: 48 }, { width: 300 }, vp);
  assert.strictEqual(spot.left, 360, 'rabattu sur le bord droit du bouton');
  // Bouton trop près du bord gauche ET panneau plus large que l'espace : jamais hors cadre (marge 8).
  spot = appbar.placePopover({ left: 2, right: 40, bottom: 48 }, { width: 300 }, vp);
  assert.strictEqual(spot.left, 8, 'marge minimale respectée à gauche');
  spot = appbar.placePopover({ left: 10, right: 690, bottom: 48 }, { width: 900 }, vp);
  assert.ok(spot.left >= 8 || 900 + 16 > vp.width, 'un panneau plus large que le cadre ne passe pas en marge négative arbitraire');
  // Cadre très bas : la hauteur maximale ne tombe jamais sous 120 px (le panneau défile).
  spot = appbar.placePopover({ left: 10, right: 60, bottom: 300 }, { width: 200 }, { width: 700, height: 360 });
  assert.strictEqual(spot.maxHeight, 120);
  // Onglets : ← → circulaires, Début/Fin, touche non gérée → null, aucun onglet → null.
  assert.strictEqual(appbar.tabKeyTarget('ArrowRight', 2, 3), 0);
  assert.strictEqual(appbar.tabKeyTarget('ArrowRight', 0, 3), 1);
  assert.strictEqual(appbar.tabKeyTarget('ArrowLeft', 0, 3), 2);
  assert.strictEqual(appbar.tabKeyTarget('Home', 2, 3), 0);
  assert.strictEqual(appbar.tabKeyTarget('End', 0, 3), 2);
  assert.strictEqual(appbar.tabKeyTarget('a', 0, 3), null);
  assert.strictEqual(appbar.tabKeyTarget('ArrowRight', 0, 0), null);
  assert.strictEqual(appbar.tabKeyTarget('ArrowRight', 0, 1), 0, 'un seul onglet : reste dessus');
  // Menus verticaux : ↓ ↑ circulaires ; depuis « aucun actif » (-1), ↓ → premier, ↑ → dernier.
  assert.strictEqual(appbar.menuKeyTarget('ArrowDown', -1, 4), 0);
  assert.strictEqual(appbar.menuKeyTarget('ArrowUp', -1, 4), 3);
  assert.strictEqual(appbar.menuKeyTarget('ArrowDown', 3, 4), 0);
  assert.strictEqual(appbar.menuKeyTarget('ArrowUp', 0, 4), 3);
  assert.strictEqual(appbar.menuKeyTarget('End', 0, 4), 3);
  assert.strictEqual(appbar.menuKeyTarget('ArrowLeft', 0, 4), null);
  assert.strictEqual(appbar.menuKeyTarget('ArrowDown', -1, 0), null);
  console.log('OK appbar — placePopover (bords, marge, hauteur mini), tabKeyTarget, menuKeyTarget');
}

// `dev-tests/harness.html` recopie le <body> d'index.html (voir dev-tests/sync-harness.js) : un id ajouté
// à l'un et oublié dans l'autre faisait planter js/main.js dès son chargement dans le harnais (bug réel
// n°27). Faux ici = lancer `node dev-tests/sync-harness.js`.
{
  const syncHarness = require('./sync-harness.js');
  assert.ok(syncHarness.isInSync(), 'dev-tests/harness.html diffère d\'index.html : lancer `node dev-tests/sync-harness.js`');
  // Le badge est la seule différence voulue.
  const harness = require('fs').readFileSync(require('path').join(__dirname, 'harness.html'), 'utf8');
  assert.ok(harness.includes('Harnais local') && !harness.includes('data-i18n="topbar.badgeAlpha"'));
  // Les chemins du harnais sont rebasés d'un niveau : aucun `src="js/` nu ne doit y subsister.
  assert.ok(!/(src|href)="(js|css|img|kit)\//.test(harness), 'chemin non rebasé dans harness.html');
  console.log('OK sync-harness — harness.html est identique à index.html (au badge près)');
}

// Consigne GFS 007, point 1 : dans le sous-cadre isolé d'un hébergeur comme GFS (sandbox sans
// allow-same-origin), LIRE `localStorage` lève une exception — y compris à travers un simple
// `typeof` (un `typeof` ne masque qu'une référence jamais déclarée, pas une exception levée par un
// accesseur qui existe réellement) — ce n'est PAS le même cas que "pas de localStorage du tout"
// déjà testé plus haut (Node n'a pas ce global, donc `typeof` y renvoie juste 'undefined', sans
// jamais lever). Simulé en posant un tel accesseur sur `global.localStorage`, puis en rechargeant
// js/i18n.js à neuf (une instance déjà requise a déjà figé son `lang` initial au premier chargement).
{
  Object.defineProperty(global, 'localStorage', {
    get() { throw new Error('SecurityError (simulation : cadre isolé sans allow-same-origin)'); },
    configurable: true
  });
  delete require.cache[require.resolve('../js/i18n.js')];
  let sandboxed;
  assert.doesNotThrow(() => { sandboxed = require('../js/i18n.js'); }, 'js/i18n.js ne doit pas planter au chargement si localStorage lève');
  assert.strictEqual(sandboxed.getLang(), 'fr', 'repli français si localStorage lève dès le chargement');
  assert.doesNotThrow(() => sandboxed.setLang('en'), 'setLang ne doit pas planter si localStorage lève');
  assert.strictEqual(sandboxed.getLang(), 'en', 'setLang doit tout de même changer la langue en mémoire, même sans pouvoir la persister');
  sandboxed.setLang('fr');
  delete global.localStorage;
  delete require.cache[require.resolve('../js/i18n.js')];
  console.log('OK i18n.js — démarre et fonctionne quand localStorage lève (cadre isolé GFS, consigne 007 point 1)');
}

// measureExportSheet / buildWorkbookSheetsAsync : export Excel RÉEL (plus un simple message) pour
// une tuile Barres en mode de calcul temporel (Cumul/YTD/N-1) — voir js/export.js. `computeMeasureSeries`
// est ici FACTICE (une Promise résolue avec un timeSeries écrit à la main), jamais le vrai
// GristBI.duckdbEngine.timeSeriesMeasures : l'exécution SQL réelle nécessite un navigateur (voir
// CLAUDE.md §5), ce module reste donc testable 100% sous Node grâce à l'injection de dépendance
// (voir js/data.js). Seule partie asynchrone de ce fichier de test : placée en tout dernier pour
// que son achèvement précède le message final ci-dessous plutôt que de le laisser s'afficher avant
// que ces assertions n'aient tourné.
(async () => {
  const fakeTimeSeries = [
    { period: '2025-01-01', value: 100, cumulative: 100, ytd: 100, previousYear: null },
    { period: '2025-02-01', value: 50, cumulative: 150, ytd: 150, previousYear: null },
    { period: '2026-01-01', value: 120, cumulative: 270, ytd: 120, previousYear: 100 }
  ];
  const computeMeasureSeries = async () => fakeTimeSeries;
  const baseState = { rows: [], activeFilters: [], advancedFilters: [], drillIns: {} };

  // 'ytd' : une seule colonne de valeur en plus de la période
  const ytdTile = { id: 't1', title: 'Cumul annuel', type: 'bar', measure: 'Montant', aggFn: 'sum', measureMode: 'ytd', dateColumn: 'Date' };
  const ytdSheet = await data.measureExportSheet(ytdTile, baseState, computeMeasureSeries);
  assert.strictEqual(ytdSheet.name, 'Cumul annuel');
  assert.deepStrictEqual(ytdSheet.header, ['Période', 'Cumul annuel (YTD)']);
  assert.deepStrictEqual(ytdSheet.rows, [['2025-01', 100], ['2025-02', 150], ['2026-01', 120]]);

  // 'yoy' : deux colonnes (Valeur + N-1), N-1 manquant -> chaîne vide plutôt que `null`
  const yoyTile = { id: 't2', title: 'Comparaison N-1', type: 'bar', measure: 'Montant', aggFn: 'sum', measureMode: 'yoy', dateColumn: 'Date' };
  const yoySheet = await data.measureExportSheet(yoyTile, baseState, computeMeasureSeries);
  assert.deepStrictEqual(yoySheet.header, ['Période', 'Valeur', 'N-1']);
  assert.deepStrictEqual(yoySheet.rows, [['2025-01', 100, ''], ['2025-02', 50, ''], ['2026-01', 120, 100]]);
  console.log('OK measureExportSheet (ytd : 1 colonne ; yoy : Valeur+N-1, N-1 manquant -> chaîne vide)');

  // Échec du calcul (DuckDB indisponible/erreur SQL) -> message explicite PAR TUILE, pas un plantage
  const failingCompute = async () => { throw new Error('DuckDB indisponible (simulé)'); };
  const failedSheet = await data.measureExportSheet(ytdTile, baseState, failingCompute);
  assert.deepStrictEqual(failedSheet.header, ['Info']);
  assert.strictEqual(failedSheet.rows.length, 1);
  console.log('OK measureExportSheet — échec du calcul : message explicite plutôt qu\'un plantage');

  // buildWorkbookSheetsAsync : seule la tuile en mode mesure passe par computeMeasureSeries, les
  // autres types de tuiles restent calculés en pur/synchrone (tileExportSheet, inchangé) — même
  // classeur, même préfixage de page que buildWorkbookSheets.
  const mixedState = {
    rows: [{ Region: 'Nord', Montant: 10 }, { Region: 'Sud', Montant: 20 }],
    activeFilters: [], advancedFilters: [], drillIns: {},
    pages: [{ id: 'p1', name: 'Page 1', tiles: [
      { id: 't1', type: 'bar', title: 'Montant par Région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' },
      ytdTile
    ] }]
  };
  const mixedSheets = await data.buildWorkbookSheetsAsync(mixedState, computeMeasureSeries);
  assert.deepStrictEqual(mixedSheets.map((s) => s.name), ['Montant par Région', 'Cumul annuel']);
  assert.deepStrictEqual(mixedSheets[0].rows, [['Nord', 10], ['Sud', 20]]); // chemin synchrone inchangé
  assert.deepStrictEqual(mixedSheets[1].rows, ytdSheet.rows); // chemin async, même valeurs que ci-dessus
  console.log('OK buildWorkbookSheetsAsync (tuile mesure -> computeMeasureSeries injecté, le reste inchangé)');

  // --- js/pbix-layout.js : lecture de la mise en page d'un fichier Power BI (.pbix/.pbit) ---
  // Construit une archive ZIP minimale mais VALIDE en mémoire (en-têtes locaux + répertoire
  // central + fin de répertoire central), sans aucune dépendance de dézippage — exactement ce que
  // parseZipCentralDirectory/readZipEntryBytes doivent savoir lire. `entries`: [{name, data:
  // Buffer, method}]. Fixture maison, pas un vrai fichier Power BI tiers (jamais redistribué ici).
  function buildTestZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf-8');
      const stored = entry.method === pbixLayout.ZIP_METHOD_DEFLATE
        ? zlib.deflateRawSync(entry.data)
        : entry.data;
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0, 6); // flags
      localHeader.writeUInt16LE(entry.method, 8);
      localHeader.writeUInt16LE(0, 10); // mod time
      localHeader.writeUInt16LE(0, 12); // mod date
      localHeader.writeUInt32LE(0, 14); // crc32 (non vérifié par nos fonctions de lecture)
      localHeader.writeUInt32LE(stored.length, 18);
      localHeader.writeUInt32LE(entry.data.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra length
      localParts.push(localHeader, nameBuf, stored);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4); // version made by
      centralHeader.writeUInt16LE(20, 6); // version needed
      centralHeader.writeUInt16LE(0, 8); // flags
      centralHeader.writeUInt16LE(entry.method, 10);
      centralHeader.writeUInt16LE(0, 12); // mod time
      centralHeader.writeUInt16LE(0, 14); // mod date
      centralHeader.writeUInt32LE(0, 16); // crc32
      centralHeader.writeUInt32LE(stored.length, 20);
      centralHeader.writeUInt32LE(entry.data.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30); // extra length
      centralHeader.writeUInt16LE(0, 32); // comment length
      centralHeader.writeUInt16LE(0, 34); // disk number
      centralHeader.writeUInt16LE(0, 36); // internal attrs
      centralHeader.writeUInt32LE(0, 38); // external attrs
      centralHeader.writeUInt32LE(offset, 42); // local header offset
      centralParts.push(centralHeader, nameBuf);

      offset += localHeader.length + nameBuf.length + stored.length;
    }
    const centralDirStart = offset;
    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(centralDirStart, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat(localParts.concat([centralDir, eocd]));
  }

  const inflateRawForNode = (bytes) => zlib.inflateRawSync(Buffer.from(bytes));

  {
    const storedContent = Buffer.from('contenu stocké tel quel');
    const deflateContent = Buffer.from('contenu compressé en DEFLATE, répété répété répété répété');
    const zip = buildTestZip([
      { name: 'Version', data: Buffer.from('1.0'), method: pbixLayout.ZIP_METHOD_STORED },
      { name: 'Report/Layout', data: deflateContent, method: pbixLayout.ZIP_METHOD_DEFLATE },
      { name: 'DataModel', data: storedContent, method: pbixLayout.ZIP_METHOD_STORED },
    ]);
    const entries = pbixLayout.parseZipCentralDirectory(zip);
    assert.deepStrictEqual(entries.map((e) => e.name), ['Version', 'Report/Layout', 'DataModel']);
    const layoutEntry = entries.find((e) => e.name === 'Report/Layout');
    const dataModelEntry = entries.find((e) => e.name === 'DataModel');
    assert.strictEqual((await pbixLayout.readZipEntryBytes(zip, layoutEntry, inflateRawForNode)).toString(), deflateContent.toString());
    assert.strictEqual((await pbixLayout.readZipEntryBytes(zip, dataModelEntry, inflateRawForNode)).toString(), storedContent.toString());
    console.log('OK pbixLayout.parseZipCentralDirectory/readZipEntryBytes (STORED et DEFLATE, fixture ZIP maison)');
  }

  // decodeLayoutJson : UTF-16LE AVEC BOM en premier (encodage réel observé sur de vrais fichiers
  // .pbix/.pbit, voir l'en-tête de js/pbix-layout.js), UTF-8 accepté en repli.
  {
    const payload = { id: 0, sections: [{ displayName: 'Page 1', visualContainers: [] }] };
    const utf16Buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(payload), 'utf16le')]);
    assert.deepStrictEqual(pbixLayout.decodeLayoutJson(utf16Buf), payload);
    const utf8Buf = Buffer.from(JSON.stringify(payload), 'utf-8');
    assert.deepStrictEqual(pbixLayout.decodeLayoutJson(utf8Buf), payload);
    console.log('OK pbixLayout.decodeLayoutJson (UTF-16LE avec BOM, repli UTF-8)');
  }

  // extractVisuals : structure reprise fidèlement d'un vrai Report/Layout (barChart avec dimension +
  // mesure, visuel non pris en charge ignoré, config JSON cassée ignorée sans faire échouer les
  // autres visuels de la section).
  {
    const layoutJson = {
      sections: [{
        displayName: 'Page 1',
        visualContainers: [
          {
            config: JSON.stringify({
              name: 'visual1',
              singleVisual: {
                visualType: 'barChart',
                vcObjects: { title: [{ properties: { text: { expr: { Literal: { Value: "'Ventes par Région'" } } } } }] },
                prototypeQuery: {
                  Select: [
                    { Column: { Property: 'Region' }, Name: 'Table.Region', NativeReferenceName: 'Région' },
                    { Measure: { Property: 'SalesAmount' }, Name: 'Measures.SalesAmount', NativeReferenceName: 'Sales Amount' },
                  ],
                },
              },
            }),
          },
          { config: JSON.stringify({ name: 'visual2', singleVisual: { visualType: 'slicer', prototypeQuery: { Select: [] } } }) },
          { config: 'ceci n\'est pas du JSON valide' },
        ],
      }],
    };
    const visuals = pbixLayout.extractVisuals(layoutJson);
    assert.strictEqual(visuals.length, 2); // le visuel au config cassé est ignoré
    const bar = visuals.find((v) => v.visualId === 'visual1');
    assert.strictEqual(bar.tileType, 'bar');
    assert.strictEqual(bar.title, 'Ventes par Région');
    assert.strictEqual(bar.fields.length, 2);
    assert.strictEqual(bar.fields[0].isMeasure, false);
    assert.strictEqual(bar.fields[1].isMeasure, true);
    const slicer = visuals.find((v) => v.visualId === 'visual2');
    assert.strictEqual(slicer.tileType, null); // slicer : pas de tuile équivalente
    console.log('OK pbixLayout.extractVisuals (dimension+mesure, type non pris en charge, config cassée ignorée)');
  }

  // suggestTiles : correspondance tolérante des noms de colonnes (espaces/casse ignorés), et
  // tileData à null + missingFields rempli quand une colonne n'existe pas dans la table connectée.
  {
    const visuals = [
      {
        visualId: 'v1', visualType: 'barChart', tileType: 'bar', title: 'Ventes par Région',
        fields: [
          { isMeasure: false, property: 'Region', displayName: 'Région' },
          { isMeasure: true, property: 'SalesAmount', displayName: 'Sales Amount' },
        ],
      },
      {
        visualId: 'v2', visualType: 'card', tileType: 'kpi', title: null,
        fields: [{ isMeasure: true, property: 'Inconnue', displayName: 'Colonne Inconnue' }],
      },
    ];
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'SalesAmount', 'Montant']);
    const barSuggestion = suggestions.find((s) => s.visual.visualId === 'v1');
    assert.deepStrictEqual(barSuggestion.missingFields, []);
    assert.deepStrictEqual(barSuggestion.tileData, { type: 'bar', measure: 'SalesAmount', aggFn: 'sum', title: 'Ventes par Région', dimension: 'Region' });
    const kpiSuggestion = suggestions.find((s) => s.visual.visualId === 'v2');
    assert.strictEqual(kpiSuggestion.tileData, null);
    assert.deepStrictEqual(kpiSuggestion.missingFields, ['Colonne Inconnue']);
    console.log('OK pbixLayout.suggestTiles (correspondance tolérante + colonnes manquantes détectées)');
  }

  // Un visuel « donut » Power BI devient un camembert avec trou (donut: true) ; un camembert plein
  // (pieChart) n'a PAS le drapeau ; lineChart/areaChart ne sont toujours pas mappés (voir le
  // commentaire de VISUAL_TYPE_TO_TILE_TYPE)
  {
    assert.strictEqual(pbixLayout.VISUAL_TYPE_TO_TILE_TYPE.donutChart, 'pie');
    assert.strictEqual(pbixLayout.VISUAL_TYPE_TO_TILE_TYPE.lineChart, undefined);
    // Entonnoir Power BI : une catégorie + une mesure, correspondance directe (comme pieChart/treemap)
    assert.strictEqual(pbixLayout.VISUAL_TYPE_TO_TILE_TYPE.funnel, 'funnel');
    {
      const funnelFields = [
        { isMeasure: false, property: 'Etape', displayName: 'Étape' },
        { isMeasure: true, property: 'Visiteurs', displayName: 'Visiteurs' },
      ];
      const [fs] = pbixLayout.suggestTiles([{ visualId: 'f1', visualType: 'funnel', tileType: 'funnel', title: null, fields: funnelFields }], ['Etape', 'Visiteurs']);
      assert.ok(fs.tileData && fs.tileData.type === 'funnel' && fs.tileData.dimension === 'Etape' && fs.tileData.measure === 'Visiteurs', JSON.stringify(fs));
      const [missing] = pbixLayout.suggestTiles([{ visualId: 'f2', visualType: 'funnel', tileType: 'funnel', title: null, fields: funnelFields }], ['Autre']);
      assert.strictEqual(missing.tileData, null, 'colonne absente : pas de tuile pointant dans le vide');
    }
    const fields = [
      { isMeasure: false, property: 'Region', displayName: 'Région' },
      { isMeasure: true, property: 'SalesAmount', displayName: 'Sales Amount' },
    ];
    const suggestions = pbixLayout.suggestTiles([
      { visualId: 'd', visualType: 'donutChart', tileType: 'pie', title: 'Donut', fields },
      { visualId: 'p', visualType: 'pieChart', tileType: 'pie', title: 'Pie', fields },
    ], ['Region', 'SalesAmount']);
    assert.deepStrictEqual(suggestions[0].tileData, { type: 'pie', measure: 'SalesAmount', aggFn: 'sum', title: 'Donut', dimension: 'Region', donut: true });
    assert.deepStrictEqual(suggestions[1].tileData, { type: 'pie', measure: 'SalesAmount', aggFn: 'sum', title: 'Pie', dimension: 'Region' });
    console.log('OK pbixLayout.suggestTiles (donutChart -> camembert avec trou, pieChart inchangé)');
  }

  // extractCandidatePhrases : un espace seul ne coupe PAS la phrase candidate (sinon chaque mot
  // deviendrait sa propre phrase d'un seul mot) ; un mot vide ou de la ponctuation, si.
  {
    const phrases = keywords.extractCandidatePhrases(
      'Analyse sémantique de publications, et recherche automatique.',
      keywords.buildStopwordSet('fr'),
      2
    );
    assert.deepStrictEqual(phrases, [['analyse', 'sémantique'], ['publications'], ['recherche', 'automatique']]);
    console.log('OK keywords.extractCandidatePhrases (espace neutre, ponctuation/mot vide coupent)');
  }

  // extractKeywords : une phrase de plusieurs mots pleins doit surclasser un mot isolé (score RAKE
  // = degree/freq, degree inclut la co-occurrence avec les autres mots de la phrase).
  {
    const text = 'Analyse sémantique des publications de chercheurs. Ce widget propose une '
      + 'recherche par mots clés automatique, sans backend, pour indexer des documents PDF volumineux.';
    const results = keywords.extractKeywords(text, { maxKeywords: 4 });
    assert.strictEqual(results[0].phrase, 'mots clés automatique'); // ex-aequo avec "documents pdf
    // volumineux" (3 mots pleins chacune, score 9) : départagé par l'ordre de première apparition.
    assert.ok(results[0].score > results[results.length - 1].score);
    assert.strictEqual(results.length, 4);
    console.log('OK keywords.extractKeywords (phrase multi-mots mieux classée qu\'un mot isolé)');
  }

  // extractKeywords : ex-aequo tranché par l'ordre de première apparition, jamais alphabétique
  // (même prudence que groupByAggregate, voir CLAUDE.md §7 piège n°14).
  {
    const results = keywords.extractKeywords('Zèbre. Chat. Alpaga. Chat.', { maxKeywords: 10, minWordLength: 1 });
    assert.deepStrictEqual(results.map((r) => r.phrase), ['zèbre', 'chat', 'alpaga']); // "chat" dédoublonné
    console.log('OK keywords.extractKeywords (ex-aequo dans l\'ordre d\'apparition)');
  }

  // extractKeywords : un texte sans aucun mot vide sur une longue plage (ex. liste à puces mal
  // extraite d'un PDF) est découpé en tronçons par maxPhraseWords, pour ne pas laisser une seule
  // "phrase" géante dominer le classement par un degree artificiellement énorme.
  {
    const longRun = Array.from({ length: 20 }, (_, i) => `motunique${i}`).join(' ');
    const phrases = keywords.extractCandidatePhrases(longRun, keywords.buildStopwordSet('fr'), 2);
    assert.strictEqual(phrases[0].length, 20); // pas encore découpé à ce stade (fait par extractKeywords)
    const results = keywords.extractKeywords(longRun, { maxKeywords: 50, maxPhraseWords: 5 });
    assert.ok(results.every((r) => r.phrase.split(' ').length <= 5));
    console.log('OK keywords.extractKeywords (découpage défensif des phrases trop longues)');
  }

  // pdfText : fonctions pures de jointure, testables sans PDF.js ni navigateur.
  {
    assert.strictEqual(pdfText.joinTextItems([{ str: 'Bonjour' }, { str: 'le' }, { str: 'monde' }]), 'Bonjour le monde');
    assert.strictEqual(pdfText.joinTextItems([]), '');
    assert.strictEqual(pdfText.joinPages(['page un', 'page deux']), 'page un\npage deux');
    console.log('OK pdfText.joinTextItems/joinPages');
  }

  // pdfText : tant que GFS n'a pas ajouté PDF.js (voir GFS-ETAT.md), isAvailable() est false et
  // extractTextFromPdf rejette avec un code clair — jamais un échec silencieux.
  {
    assert.strictEqual(pdfText.isAvailable(), false);
    await assert.rejects(pdfText.extractTextFromPdf(new ArrayBuffer(0)), (e) => e.code === 'PDFJS_NOT_AVAILABLE');
    console.log('OK pdfText.extractTextFromPdf (rejette clairement sans PDF.js)');
  }

  // extractVisuals + suggestTiles : waterfallChart — même forme que "bar" (1 dimension + 1 mesure,
  // voir js/charts.js:renderChart qui calcule la cascade à partir du même groupByAggregate).
  {
    const layoutJson = {
      sections: [{
        displayName: 'Page 1',
        visualContainers: [{
          config: JSON.stringify({
            name: 'visualW',
            singleVisual: {
              visualType: 'waterfallChart',
              prototypeQuery: {
                Select: [
                  { Column: { Property: 'Mois' }, Name: 'Table.Mois', NativeReferenceName: 'Mois' },
                  { Measure: { Property: 'Variation' }, Name: 'Measures.Variation', NativeReferenceName: 'Variation' },
                ],
              },
            },
          }),
        }],
      }],
    };
    const visuals = pbixLayout.extractVisuals(layoutJson);
    assert.strictEqual(visuals[0].tileType, 'waterfall');
    const suggestions = pbixLayout.suggestTiles(visuals, ['Mois', 'Variation']);
    assert.deepStrictEqual(suggestions[0].tileData, { type: 'waterfall', measure: 'Variation', aggFn: 'sum', title: 'Variation par Mois', dimension: 'Mois' });
    console.log('OK pbixLayout.extractVisuals/suggestTiles — waterfallChart (même forme que bar)');
  }

  // extractVisuals + suggestTiles : scatterChart — DEUX mesures (X et Y) désambiguïsées via
  // `projections` (rolesByQueryRef), jamais par position dans `Select`. Ce fixture met
  // volontairement, dans `Select`, la mesure Y puis une mesure "Taille" (bulle, sans rôle X/Y) puis
  // la mesure X dans cet ordre : une lecture purement positionnelle donnerait Y puis Taille (faux),
  // alors que la lecture par rôle donne X puis Y (correct).
  {
    const layoutJson = {
      sections: [{
        displayName: 'Page 1',
        visualContainers: [{
          config: JSON.stringify({
            name: 'visualS',
            singleVisual: {
              visualType: 'scatterChart',
              prototypeQuery: {
                Select: [
                  { Column: { Property: 'Region' }, Name: 'Table.Region', NativeReferenceName: 'Région' },
                  { Measure: { Property: 'Revenue' }, Name: 'Measures.Revenue', NativeReferenceName: "Chiffre d'affaires" },
                  { Measure: { Property: 'Volume' }, Name: 'Measures.Volume', NativeReferenceName: 'Volume' },
                  { Measure: { Property: 'Cost' }, Name: 'Measures.Cost', NativeReferenceName: 'Coût' },
                ],
              },
              projections: {
                Category: [{ queryRef: 'Table.Region' }],
                Y: [{ queryRef: 'Measures.Revenue' }],
                Size: [{ queryRef: 'Measures.Volume' }],
                X: [{ queryRef: 'Measures.Cost' }],
              },
            },
          }),
        }],
      }],
    };
    const visuals = pbixLayout.extractVisuals(layoutJson);
    assert.strictEqual(visuals[0].tileType, 'scatter');
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'Revenue', 'Volume', 'Cost']);
    assert.deepStrictEqual(suggestions[0].tileData, {
      type: 'scatter', measure: 'Cost', aggFn: 'sum', title: 'Cost par Region', dimension: 'Region', measureY: 'Revenue',
    });
    console.log('OK pbixLayout.extractVisuals/suggestTiles — scatterChart (X/Y désambiguïsés via projections, pas par position)');
  }

  // suggestTiles : scatterChart sans `projections` (fichier/variante qui ne le fournit pas) — repli
  // sur la position dans `Select` plutôt que de bloquer la suggestion.
  {
    const visuals = [{
      visualId: 'v3', visualType: 'scatterChart', tileType: 'scatter', title: null,
      fields: [
        { isMeasure: false, property: 'Region', displayName: 'Région', role: null },
        { isMeasure: true, property: 'Cost', displayName: 'Coût', role: null },
        { isMeasure: true, property: 'Revenue', displayName: "Chiffre d'affaires", role: null },
      ],
    }];
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'Cost', 'Revenue']);
    assert.deepStrictEqual(suggestions[0].tileData, { type: 'scatter', measure: 'Cost', aggFn: 'sum', title: 'Cost par Region', dimension: 'Region', measureY: 'Revenue' });
    console.log('OK pbixLayout.suggestTiles — scatterChart sans projections (repli positionnel)');
  }

  // extractVisuals + suggestTiles : matrix (tableau croisé Power BI) — rôles "Rows"/"Columns"/
  // "Values" (confirmés par une lecture indépendante de fichiers réels, voir pbix-layout.js), Select
  // volontairement dans le désordre pour prouver que c'est le rôle qui compte, pas la position.
  {
    const layoutJson = {
      sections: [{
        displayName: 'Page 1',
        visualContainers: [{
          config: JSON.stringify({
            name: 'visualM',
            singleVisual: {
              visualType: 'matrix',
              prototypeQuery: {
                Select: [
                  { Measure: { Property: 'SalesAmount' }, Name: 'Measures.SalesAmount', NativeReferenceName: 'Sales Amount' },
                  { Column: { Property: 'Product' }, Name: 'Table.Product', NativeReferenceName: 'Produit' },
                  { Column: { Property: 'Region' }, Name: 'Table.Region', NativeReferenceName: 'Région' },
                ],
              },
              projections: {
                Rows: [{ queryRef: 'Table.Region' }],
                Columns: [{ queryRef: 'Table.Product' }],
                Values: [{ queryRef: 'Measures.SalesAmount' }],
              },
            },
          }),
        }],
      }],
    };
    const visuals = pbixLayout.extractVisuals(layoutJson);
    assert.strictEqual(visuals[0].tileType, 'pivot');
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'Product', 'SalesAmount']);
    assert.deepStrictEqual(suggestions[0].tileData, {
      type: 'pivot', measure: 'SalesAmount', aggFn: 'sum', title: 'SalesAmount par Region × Product', dimension: 'Region', columnDimension: 'Product',
    });
    console.log('OK pbixLayout.extractVisuals/suggestTiles — matrix (Rows/Columns/Values désambiguïsés via projections)');
  }

  // suggestTiles : matrix sans rôle "Columns" (matrix réduite à un tableau plat, voir le
  // commentaire de rolesByQueryRef) — pas une tuile pivot exploitable, tileData à null plutôt
  // qu'une tuile à une seule dimension qui ne serait pas ce que l'utilisateur a vu dans Power BI.
  {
    const visuals = [{
      visualId: 'vFlat', visualType: 'matrix', tileType: 'pivot', title: null,
      fields: [
        { isMeasure: false, property: 'Region', displayName: 'Région', role: 'Rows' },
        { isMeasure: true, property: 'SalesAmount', displayName: 'Sales Amount', role: 'Values' },
      ],
    }];
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'SalesAmount']);
    assert.strictEqual(suggestions[0].tileData, null);
    assert.deepStrictEqual(suggestions[0].missingFields, ['(dimension colonne manquante dans le visuel)']);
    console.log('OK pbixLayout.suggestTiles — matrix sans colonnes (tableau plat, pas une tuile pivot)');
  }

  // suggestTiles : matrix dont les rôles "Rows" et "Columns" désignent la MÊME colonne Grist réelle
  // (ex. deux noms Power BI différents qui normalisent vers le même id) — refusé plutôt que de
  // créer une tuile pivot aux deux dimensions identiques, qui violerait la même contrainte que le
  // formulaire manuel (voir js/main.js, tileForm.alert.pivotDimsDiffer).
  {
    const visuals = [{
      visualId: 'vDup', visualType: 'matrix', tileType: 'pivot', title: null,
      fields: [
        { isMeasure: false, property: 'Region', displayName: 'Région', role: 'Rows' },
        { isMeasure: false, property: 'Region', displayName: 'Region ', role: 'Columns' },
        { isMeasure: true, property: 'SalesAmount', displayName: 'Sales Amount', role: 'Values' },
      ],
    }];
    const suggestions = pbixLayout.suggestTiles(visuals, ['Region', 'SalesAmount']);
    assert.strictEqual(suggestions[0].tileData, null);
    assert.ok(suggestions[0].missingFields.includes('(dimension colonne identique à la dimension ligne)'));
    console.log('OK pbixLayout.suggestTiles — matrix avec lignes = colonnes (refusé, pas une tuile pivot valide)');
  }

  // --- Import d'un CSV exporté depuis Power BI (js/csv-import.js) ---------------------------

  // detectDelimiter : fichier virgule (locale EN), fichier point-virgule (locale FR — le cas réel
  // d'Antoine, voir l'en-tête de js/csv-import.js), fichier tabulation, et une virgule DANS un
  // champ guillemeté qui ne doit jamais fausser la détection d'un fichier réellement point-virgule.
  {
    assert.strictEqual(csvImport.detectDelimiter('Region,Montant\nNord,100\nSud,30\n'), ',');
    assert.strictEqual(csvImport.detectDelimiter('Region;Montant\nNord;100\nSud;30\n'), ';');
    assert.strictEqual(csvImport.detectDelimiter('Region\tMontant\nNord\t100\nSud\t30\n'), '\t');
    assert.strictEqual(
      csvImport.detectDelimiter('Region;Note\n"Dupont, Jean";1\n"Martin, Paul";2\n'), ';'
    );
    console.log('OK csvImport.detectDelimiter — EN/FR/tabulation, virgule interne ignorée');
  }

  // parseCsv : champs guillemetés (virgule interne, retour à la ligne interne, guillemet doublé
  // ""->"), CRLF et LF mélangés, BOM UTF-8 en tête — parseCsvFile (plus bas) passe par-dessus, ce
  // bloc teste directement l'automate à états.
  {
    const text = 'Nom,Ville\r\n"Dupont, Jean","Paris\nFrance"\n"Il dit ""bonjour""",Lyon\n';
    const { headers, rows: r } = csvImport.parseCsv(text, ',');
    assert.deepStrictEqual(headers, ['Nom', 'Ville']);
    assert.deepStrictEqual(r, [
      ['Dupont, Jean', 'Paris\nFrance'],
      ['Il dit "bonjour"', 'Lyon']
    ]);
    console.log('OK csvImport.parseCsv — champs guillemetés, CRLF/LF, guillemet doublé');
  }

  // parseLocaleNumber : virgule décimale FR (avec espace en séparateur de milliers), point décimal
  // EN (avec virgule en séparateur de milliers), entier simple, texte non numérique -> null, chaîne
  // vide -> null (jamais 0, voir l'en-tête de js/csv-import.js).
  {
    assert.strictEqual(csvImport.parseLocaleNumber('1 234,56'), 1234.56);
    assert.strictEqual(csvImport.parseLocaleNumber('1234,56'), 1234.56);
    assert.strictEqual(csvImport.parseLocaleNumber('1,234.56'), 1234.56);
    assert.strictEqual(csvImport.parseLocaleNumber('1234.56'), 1234.56);
    assert.strictEqual(csvImport.parseLocaleNumber('-42'), -42);
    assert.strictEqual(csvImport.parseLocaleNumber('Nord'), null);
    assert.strictEqual(csvImport.parseLocaleNumber(''), null);
    console.log('OK csvImport.parseLocaleNumber — virgule FR, point EN, jamais 0 par défaut');
  }

  // parseLocaleDate : ISO, JJ/MM/AAAA (export FR le plus courant), JJ-MM-AAAA, date invalide
  // (31 février) -> null, format non reconnu -> null.
  {
    assert.strictEqual(csvImport.parseLocaleDate('2026-03-05'), '2026-03-05');
    assert.strictEqual(csvImport.parseLocaleDate('05/03/2026'), '2026-03-05');
    assert.strictEqual(csvImport.parseLocaleDate('5/3/2026'), '2026-03-05');
    assert.strictEqual(csvImport.parseLocaleDate('05-03-2026'), '2026-03-05');
    assert.strictEqual(csvImport.parseLocaleDate('31/02/2026'), null);
    assert.strictEqual(csvImport.parseLocaleDate('pas une date'), null);
    console.log('OK csvImport.parseLocaleDate — ISO, JJ/MM/AAAA, date invalide rejetée');
  }

  // inferColumnType : colonne entièrement numérique -> Numeric, entièrement date FR -> Date,
  // texte -> Text, colonne À PRÉDOMINANCE numérique mais avec UNE valeur texte -> Text en entier
  // (jamais une coercition partielle qui perdrait silencieusement cette valeur), colonne vide ->
  // Text (repli neutre).
  {
    assert.strictEqual(csvImport.inferColumnType(['100', '1 234,56', '-3']), 'Numeric');
    assert.strictEqual(csvImport.inferColumnType(['05/03/2026', '2026-03-06']), 'Date');
    assert.strictEqual(csvImport.inferColumnType(['Nord', 'Sud']), 'Text');
    assert.strictEqual(csvImport.inferColumnType(['100', 'N/A', '30']), 'Text');
    assert.strictEqual(csvImport.inferColumnType(['', '', '']), 'Text');
    console.log('OK csvImport.inferColumnType — Numeric/Date/Text, repli intégral sur Text si une seule valeur ne correspond pas');
  }

  // sanitizeColumnId : accents/espaces/ponctuation -> identifiant valide, en-tête commençant par un
  // chiffre -> préfixé, deux en-têtes qui se réduisent au même identifiant -> suffixés (jamais un
  // doublon silencieux qui écraserait une colonne sur l'autre).
  {
    const used = new Set();
    assert.strictEqual(csvImport.sanitizeColumnId('Région', used), 'Region');
    assert.strictEqual(csvImport.sanitizeColumnId('Montant €', used), 'Montant');
    assert.strictEqual(csvImport.sanitizeColumnId('2026 Ventes', used), 'c_2026_Ventes');
    assert.strictEqual(csvImport.sanitizeColumnId('Montant €', used), 'Montant_2');
    console.log('OK csvImport.sanitizeColumnId — accents/espaces/collision, jamais un identifiant invalide ou dupliqué');
  }

  // parseCsvFile : bout-en-bout sur un CSV FR réaliste (point-virgule, virgule décimale, dates
  // JJ/MM/AAAA, en-têtes accentués) — vérifie que columns/rows sont directement exploitables par
  // GristBI.api.createTableFromRows (js/grist-api.js, colonne par colonne).
  {
    const csv = 'Région;Montant;Date de vente\n'
      + 'Nord;1 234,56;05/03/2026\n'
      + 'Sud;987,65;06/03/2026\n';
    const { columns, rows: r, rowCount } = csvImport.parseCsvFile(csv);
    assert.deepStrictEqual(columns, [
      { id: 'Region', type: 'Text', label: 'Région' },
      { id: 'Montant', type: 'Numeric', label: 'Montant' },
      { id: 'Date_de_vente', type: 'Date', label: 'Date de vente' }
    ]);
    assert.strictEqual(rowCount, 2);
    assert.deepStrictEqual(r, [
      { Region: 'Nord', Montant: 1234.56, Date_de_vente: '2026-03-05' },
      { Region: 'Sud', Montant: 987.65, Date_de_vente: '2026-03-06' }
    ]);
    console.log('OK csvImport.parseCsvFile — CSV FR bout-en-bout (point-virgule, virgule décimale, dates JJ/MM/AAAA)');
  }

  // parseCsvFile : valeur manquante dans une colonne Numeric/Date -> null (jamais 0 ni une chaîne
  // vide qui vaudrait un 1/1/1970 ou un zéro silencieux, voir l'en-tête de js/csv-import.js).
  {
    const csv = 'Région,Montant\nNord,100\nSud,\n';
    const { rows: r } = csvImport.parseCsvFile(csv);
    assert.strictEqual(r[1].Montant, null);
    console.log('OK csvImport.parseCsvFile — valeur numérique manquante -> null, jamais 0');
  }

  // --- js/advice.js : suggestions de tuiles, valeurs par défaut, avertissements de lisibilité -------
  {
    const fs = require('fs');
    const path = require('path');
    const withHierarchies = (rows) => Object.keys(rows[0]).filter((k) => k !== 'id')
      .reduce((acc, col) => (data.parseDateValue(rows[0][col]) != null ? data.deriveDateHierarchyColumns(acc, col) : acc), rows);
    const big = withHierarchies(demoData.buildLargeSampleRows());
    const tr = (key, vars) => i18n.t(key, vars);
    const sameKeys = (a, b) => assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());

    // Profil des colonnes : rôle déduit des VALEURS (jamais d'un nom de colonne seul).
    {
      const roles = Object.fromEntries(advice.profileColumns(big).map((p) => [p.id, p.role]));
      assert.strictEqual(roles.Region, 'category');
      assert.strictEqual(roles.Produit, 'category');
      assert.strictEqual(roles.Annee, 'category'); // 2020-2026 : une année, pas une mesure à additionner
      assert.strictEqual(roles.Date, 'time');
      assert.strictEqual(roles['Date.Annee'], 'timePart');
      assert.strictEqual(roles['Date.Trimestre'], 'timePart');
      assert.strictEqual(roles.Montant, 'measure');
      assert.ok(advice.profileColumns(big).find((p) => p.id === 'Jour').ordinal, 'jour du mois 1-28 : ordinal, jamais une mesure vedette');
      console.log('OK advice.profileColumns — Région/Produit catégories, Année année, Date temps, Montant mesure');
    }
    {
      const table = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Numero: i + 1, Email: `p${i}@x.fr`, Salaire: 1000 + i * 37, Pays: 'FR', Commentaire: 'x'.repeat(60) + i }));
      const roles = Object.fromEntries(advice.profileColumns(table).map((p) => [p.id, p.role]));
      assert.strictEqual(roles.Numero, 'identifier'); // 1..40 consécutifs, un par ligne
      assert.strictEqual(roles.Email, 'identifier'); // 40 valeurs toutes différentes : une clé, pas un axe
      // (à 12 lignes, des noms tous différents restent une catégorie : une barre par personne est légitime)
      assert.strictEqual(roles.Salaire, 'measure'); // entiers tous différents mais PAS consécutifs : une mesure, pas une clé
      assert.strictEqual(roles.Pays, 'constant');
      assert.strictEqual(roles.Commentaire, 'freeText');
      console.log('OK advice.profileColumns — identifiant, mesure entière, colonne constante, texte libre');
    }
    // Vote d'échantillon (pas la seule première valeur) : une cellule égarée ne change pas le type.
    assert.strictEqual(advice.columnKind(['12', 7, 'n/a', 'oui', 'non', 3]), 'text'); // moitié texte : texte (choix le plus sûr)
    assert.strictEqual(advice.columnKind([12, 7, 3, 9, 4, 8, 6, 5, 2, 1, 11, 10, 14, 13, 15, 16, 17, 18, 19, 'n/a']), 'number');
    assert.strictEqual(advice.columnKind(['2026-01-02', '2026-02-03']), 'date');

    // suggestTiles : tableau vide, forme des résultats, limite, variété.
    assert.deepStrictEqual(advice.suggestTiles([], undefined), []);
    assert.deepStrictEqual(advice.suggestTiles(undefined, undefined), []);
    {
      const sugg = advice.suggestTiles(big, undefined, { t: tr });
      assert.strictEqual(sugg.length, 3, '3 suggestions par défaut');
      assert.deepStrictEqual(sugg.map((x) => x.type).sort(), ['bar', 'kpi', 'line'], 'trois types différents, pas trois barres');
      sugg.forEach((x) => {
        assert.ok(x.titleKey && x.reasonKey && x.tileData && x.tileData.title, 'clés d\'affichage + tuile prête pour addTile');
        assert.ok(typeof x.score === 'number');
        assert.ok(x.tileData.dimension === '' || Object.keys(big[0]).indexOf(x.tileData.dimension) !== -1, 'dimension = vraie colonne');
        assert.ok(Object.keys(big[0]).indexOf(x.tileData.measure) !== -1, 'mesure = vraie colonne');
        assert.notStrictEqual(x.tileData.dimension, x.tileData.measure);
      });
      const line = sugg.find((x) => x.type === 'line');
      assert.strictEqual(line.tileData.dimension, 'Date.Annee');
      assert.deepStrictEqual(line.tileData.drillDimensions, ['Date.Trimestre', 'Date.Mois', 'Date'], 'même drill-down que le bouton « Détailler par Année… »');
      assert.strictEqual(line.tileData.measure, 'Montant', 'la vraie mesure, pas le numéro du jour');
      const kpi = sugg.find((x) => x.type === 'kpi');
      assert.strictEqual(kpi.tileData.trendDimension, 'Date.Annee', 'KPI avec tendance quand il y a au moins 2 années');
      assert.strictEqual(advice.suggestTiles(big, undefined, { limit: 5 }).length, 5);
      assert.strictEqual(advice.suggestTiles(big, undefined, { limit: 1 }).length, 1);
      // Sans `opts.t` : repli neutre fait des noms de colonnes, jamais un mot de français en dur.
      const bare = advice.suggestTiles(big)[0].tileData.title;
      assert.ok(!/\bpar\b|\bby\b/i.test(bare), 'repli sans mot de la langue : ' + bare);
      console.log('OK advice.suggestTiles — 3 types différents, vraies colonnes, drill-down et tendance');
    }
    // Tableau sans date : barres + KPI + anneau (peu de parts) ; avec une colonne « note » : moyenne.
    {
      const t1 = [
        { id: 1, Region: 'Nord', Produit: 'Stylo', Montant: 100 }, { id: 2, Region: 'Nord', Produit: 'Cahier', Montant: 50 },
        { id: 3, Region: 'Sud', Produit: 'Stylo', Montant: 30 }, { id: 4, Region: 'Sud', Produit: 'Cahier', Montant: 70 },
        { id: 5, Region: 'Est', Produit: 'Stylo', Montant: 90 }, { id: 6, Region: 'Est', Produit: 'Cahier', Montant: 20 }
      ];
      const types = advice.suggestTiles(t1).map((x) => x.type);
      assert.deepStrictEqual(types, ['bar', 'kpi', 'pie']);
      const pie = advice.suggestTiles(t1).find((x) => x.type === 'pie');
      assert.strictEqual(pie.tileData.donut, true);
      assert.strictEqual(pie.tileData.showPct, true);
      // Montants négatifs : plus d'anneau (un camembert ne peut pas les représenter).
      const neg = t1.map((r, i) => (i === 0 ? Object.assign({}, r, { Montant: -5 }) : r));
      assert.ok(!advice.suggestTiles(neg, undefined, { limit: 10 }).some((x) => x.type === 'pie'), 'pas d\'anneau avec une valeur négative');
      const notes = t1.map((r, i) => Object.assign({}, r, { Moyenne_note: 10 + i / 2 }));
      const kpi = advice.suggestTiles(notes, ['Region', 'Moyenne_note'], { limit: 5 }).find((x) => x.type === 'kpi');
      assert.strictEqual(kpi.tileData.aggFn, 'avg', 'une colonne « note »/« moyenne » se moyenne plutôt que de s\'additionner');
      assert.strictEqual(kpi.titleKey, 'advice.title.average');
      console.log('OK advice.suggestTiles — sans date : barres/KPI/anneau ; négatif -> pas d\'anneau ; colonne « note » -> moyenne');
    }
    // Aucune colonne numérique : on compte les lignes plutôt que de proposer une somme impossible.
    {
      const textOnly = [{ id: 1, Ville: 'Paris', Pays: 'FR' }, { id: 2, Ville: 'Lyon', Pays: 'FR' }, { id: 3, Ville: 'Rome', Pays: 'IT' }];
      const sugg = advice.suggestTiles(textOnly);
      assert.ok(sugg.length >= 2);
      sugg.forEach((x) => assert.strictEqual(x.tileData.aggFn, 'count'));
      assert.ok(sugg.some((x) => x.type === 'kpi' && x.titleKey === 'advice.title.countAll'));
      console.log('OK advice.suggestTiles — aucune colonne numérique : comptage de lignes');
    }
    // Compétences en colonnes (cas d'usage forum Grist) : un radar est proposé.
    {
      const eleves = ['Ana', 'Ben', 'Cléo', 'Dan', 'Eli', 'Fay'].map((n, i) => ({ id: i + 1, Eleve: n, Classe: i % 2 ? 'A' : 'B', Maths: 10 + i, Francais: 12 - i / 2, Histoire: 8 + i * 1.5, Anglais: 15 - i }));
      const radar = advice.suggestTiles(eleves, undefined, { limit: 5 }).find((x) => x.type === 'radar');
      assert.ok(radar, 'radar proposé pour des colonnes de notes sur une même échelle');
      assert.strictEqual(radar.tileData.radarAxisMode, 'columns');
      assert.deepStrictEqual(radar.tileData.radarAxes, ['Maths', 'Francais', 'Histoire', 'Anglais']);
      const rich = eleves.map((r) => Object.assign({}, r, { CA: r.id * 1000000 }));
      assert.ok(!advice.suggestTiles(rich, undefined, { limit: 10 }).some((x) => x.type === 'radar' && x.tileData.radarAxes.indexOf('CA') !== -1), 'jamais un chiffre d\'affaires mêlé à des notes');
      console.log('OK advice.suggestTiles — radar « compétences en colonnes » sur une échelle commune');
    }
    // Une suggestion se laisse vraiment créer : addTile + groupByAggregate sur les vraies données.
    {
      const store = state.createStore();
      advice.suggestTiles(big, undefined, { limit: 8, t: tr }).forEach((x, i) => store.addTile(Object.assign({ id: 'sugg-' + i }, x.tileData)));
      assert.ok(store.getState().pages[0].tiles.length >= 3);
      advice.suggestTiles(big, undefined, { limit: 8 }).forEach((x) => {
        if (x.tileData.dimension) {
          const groups = data.groupByAggregate(big, x.tileData.dimension, x.tileData.measure, x.tileData.aggFn);
          assert.ok(groups.length >= 2 && groups.every((g) => Number.isFinite(g.value)), `${x.type} : agrégat valide`);
        }
      });
      console.log('OK advice.suggestTiles — chaque suggestion s\'ajoute au store et s\'agrège sur les vraies données');
    }
    // Miniatures de l'accueil : `previewFor` (nombres normalisés) puis `previewSvg` (dessin) — sans ECharts.
    {
      const sugg = advice.suggestTiles(big, undefined, { limit: 8, t: tr });
      sugg.forEach((x) => {
        const p = advice.previewFor(x.tileData, big);
        assert.ok(p && p.kind, `${x.type} : une miniature existe`);
        const svg = welcome.previewSvg(p, { lang: 'fr' });
        assert.ok(/^<svg viewBox="0 0 120 64"/.test(svg) && /<\/svg>$/.test(svg) && svg.length > 80, `${x.type} : SVG non vide`);
        assert.ok(!/NaN|undefined|Infinity/.test(svg), `${x.type} : aucun nombre invalide dans le SVG`);
        const numbers = JSON.stringify(p).match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert.ok(numbers.every(Number.isFinite), `${x.type} : aperçu fini`);
      });
      const typed = (tileData) => advice.previewFor(tileData, big);
      const bars = typed({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', horizontal: true, sortMode: 'value-desc' });
      assert.strictEqual(bars.kind, 'bars');
      assert.ok(bars.horizontal && bars.values.length <= 6 && Math.max.apply(null, bars.values) === 1 && bars.values.every((v) => v >= 0 && v <= 1));
      assert.deepStrictEqual(bars.values.slice().sort((a, b) => b - a), bars.values, 'tri décroissant respecté dans l\'aperçu');
      assert.strictEqual(typed({ type: 'line', dimension: 'Date.Annee', measure: 'Montant', aggFn: 'sum', areaFill: true }).area, true);
      assert.strictEqual(typed({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum', donut: true }).donut, true);
      const pie = typed({ type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum' });
      assert.ok(Math.abs(pie.values.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'parts du camembert : somme 1');
      assert.strictEqual(typed({ type: 'pivot' }).kind, 'grid');
      const gauge = typed({ type: 'gauge', measure: 'Montant', aggFn: 'sum', gaugeMin: 0, gaugeMax: 1 });
      assert.strictEqual(gauge.ratio, 1, 'jauge : ratio borné à 1');
      // Cas où l'on ne dessine rien plutôt que de dessiner faux.
      assert.strictEqual(advice.previewFor({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }, []), null);
      assert.strictEqual(advice.previewFor(null, big), null);
      assert.strictEqual(typed({ type: 'inconnu' }), null);
      assert.strictEqual(typed({ type: 'gauge', measure: 'Montant', aggFn: 'sum', gaugeMin: 5, gaugeMax: 5 }), null);
      assert.strictEqual(typed({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Montant', 'Quantite'] }), null, 'radar à 2 axes : pas de miniature');
      assert.strictEqual(typed({ type: 'line', dimension: 'Produit', measure: 'Montant', aggFn: 'sum', sortMode: 'label' }) && typed({ type: 'line', dimension: 'Produit', measure: 'Montant', aggFn: 'sum' }).kind, 'line');
      assert.strictEqual(typed({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }) && typed({ type: 'bar', dimension: 'Region', measure: 'Nul', aggFn: 'sum' }), null, 'barres toutes nulles : pas de miniature');
      assert.strictEqual(welcome.previewSvg(null), '');
      assert.strictEqual(welcome.previewSvg({ kind: 'inconnu' }), '');
      // Une valeur de KPI avec tendance : la flèche suit le signe, le nombre suit la langue.
      const up = welcome.previewSvg({ kind: 'value', value: 3690, trendPct: 12.1 }, { lang: 'fr' });
      const down = welcome.previewSvg({ kind: 'value', value: 3690, trendPct: -4 }, { lang: 'en' });
      assert.ok(up.includes('▲') && up.includes('12,1') && down.includes('▼') && down.includes('3.7K') && down.includes('4 %'), `${up} / ${down}`);
      assert.ok(!welcome.previewSvg({ kind: 'value', value: 5, trendPct: null }).includes('▲'));
      console.log('OK advice.previewFor + welcome.previewSvg — une miniature finie par type suggéré, bornes, null, tendance fr/en');
    }
    // Courbe suggérée sur des dates dans le désordre : tri par libellé posé d'office (jamais de zigzag).
    {
      const dates = ['2024-03-01', '2024-01-01', '2024-04-01', '2024-02-01', '2024-05-01'].map((d, i) => ({ id: i + 1, Jour: d, Montant: 10 * (i + 1), Region: 'N' + (i % 2) }));
      const rows = data.deriveDateHierarchyColumns(dates, 'Jour');
      const line = advice.suggestTiles(rows, undefined, { limit: 6 }).find((x) => x.type === 'line');
      assert.ok(line, 'courbe proposée');
      assert.strictEqual(line.tileData.dimension, 'Jour');
      assert.strictEqual(line.tileData.sortMode, 'label');
      assert.deepStrictEqual(data.sortGroups(data.groupByAggregate(rows, 'Jour', 'Montant', 'sum'), 'label').map((g) => g.dimension),
        ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01']);
      console.log('OK advice.suggestTiles — dates dans le désordre : courbe triée par libellé');
    }

    // defaultsForType : jamais « Région / Région / Somme » ; une vraie colonne par rôle.
    {
      const d = advice.defaultsForType('bar', big);
      assert.notStrictEqual(d.dimension, d.measure);
      assert.strictEqual(d.measure, 'Montant');
      assert.strictEqual(d.aggFn, 'sum');
      const pie = advice.defaultsForType('pie', big);
      assert.ok(pie.donut && pie.showPct);
      assert.ok(big.length && new Set(big.map((r) => r[pie.dimension])).size <= 6, 'anneau sur une dimension à peu de parts');
      const line = advice.defaultsForType('line', big);
      assert.strictEqual(line.dimension, 'Date.Annee');
      assert.deepStrictEqual(line.drillDimensions, ['Date.Trimestre', 'Date.Mois', 'Date']);
      const kpi = advice.defaultsForType('kpi', big);
      assert.strictEqual(kpi.dimension, '');
      assert.strictEqual(kpi.trendDimension, 'Date.Annee');
      const scatter = advice.defaultsForType('scatter', big);
      assert.notStrictEqual(scatter.measure, scatter.measureY);
      const pivot = advice.defaultsForType('pivot', big);
      assert.ok(pivot.columnDimension && pivot.columnDimension !== pivot.dimension, 'pivot : deux dimensions différentes');
      const gauge = advice.defaultsForType('gauge', big);
      const total = data.aggregateSingle(big, gauge.measure, gauge.aggFn);
      assert.ok(gauge.gaugeMax > total && gauge.gaugeMax < total * 3, 'borne max arrondie juste au-dessus de la valeur actuelle');
      assert.strictEqual(gauge.gaugeMin, 0);
      assert.strictEqual(advice.defaultsForType('inconnu', big), null);
      assert.strictEqual(advice.defaultsForType('bar', []), null);
      // Un seul jeu de colonnes (Région seulement) : pas de plantage, un repli plutôt qu'un champ vide.
      const solo = advice.defaultsForType('bar', [{ id: 1, Region: 'Nord' }, { id: 2, Region: 'Sud' }]);
      assert.strictEqual(solo.dimension, 'Region');
      assert.strictEqual(solo.aggFn, 'count');
      console.log('OK advice.defaultsForType — vraies colonnes par rôle, jauge bornée, repli sans colonne numérique');
    }

    // Entonnoir : valeurs par défaut, avertissements, carte « Choisir », miniature.
    {
      assert.ok(advice.TILE_TYPES.includes('funnel') && advice.USE_KEYS.funnel === 'advice.use.funnel');
      const stages = ['Visite', 'Inscription', 'Essai', 'Achat'];
      const funnelRows = [];
      stages.forEach((st, si) => { for (let k = 0; k < 8 - si * 2; k++) funnelRows.push({ id: funnelRows.length + 1, Etape: st, Personnes: 10 }); });
      const d = advice.defaultsForType('funnel', funnelRows);
      assert.strictEqual(d.dimension, 'Etape');
      assert.strictEqual(d.sortMode, 'value-desc', 'valeur décroissante : le sens habituel d\'un entonnoir');
      // Une dimension qui se range d'elle-même (mois) reste dans l'ordre des données : ce sont des étapes
      const monthRows = ['Janvier', 'Février', 'Mars', 'Avril'].map((m, i) => ({ id: i + 1, Mois: m, V: 10 - i }));
      assert.strictEqual(advice.defaultsForType('funnel', monthRows).sortMode, undefined);
      // Avertissements : valeurs négatives, trop d'étapes ; sinon rien
      const chkF = (rows, tile) => advice.adviceForTile(Object.assign({ type: 'funnel', measure: 'V', aggFn: 'sum' }, tile), rows);
      const negF = chkF([{ id: 1, S: 'a', V: 5 }, { id: 2, S: 'b', V: -3 }], { dimension: 'S' });
      assert.ok(negF && negF.key === 'advice.funnel.negative' && negF.level === 'warn');
      const tooMany = chkF(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, S: 'E' + i, V: 20 - i })), { dimension: 'S' });
      assert.ok(tooMany && tooMany.key === 'advice.funnel.tooManyStages' && tooMany.vars.n === 12);
      assert.strictEqual(chkF(funnelRows, { dimension: 'Etape', measure: 'Personnes', sortMode: 'value-desc' }), null);
      // Carte « Choisir » : une ligne, jamais null
      const card = advice.adviceForType('funnel', funnelRows);
      assert.ok(card && card.key && card.level);
      // Miniature : largeurs relatives à la plus large étape, dans l'ordre affiché ; un entonnoir d'une seule étape n'en a pas
      const pv = advice.previewFor({ type: 'funnel', dimension: 'Etape', measure: 'Personnes', aggFn: 'sum', sortMode: 'value-desc' }, funnelRows);
      assert.strictEqual(pv.kind, 'funnel');
      assert.deepStrictEqual(pv.values, [1, 0.75, 0.5, 0.25]);
      assert.strictEqual(advice.previewFor({ type: 'funnel', dimension: 'S', measure: 'V', aggFn: 'sum' }, [{ id: 1, S: 'a', V: 3 }]), null);
      const svg = welcome.previewSvg(pv, { lang: 'fr' });
      assert.ok(/^<svg viewBox="0 0 120 64"/.test(svg) && (svg.match(/<rect /g) || []).length === 4 && !/NaN|undefined|Infinity/.test(svg), svg);
      console.log('OK advice + welcome — entonnoir (défauts, avertissements, carte, miniature)');
    }

    // Séries multiples : un avertissement seulement quand il est juste.
    {
      const sr = [];
      for (let i = 0; i < 40; i++) sr.push({ id: i + 1, Region: ['Nord', 'Sud'][i % 2], Prod: 'P' + (i % 10), V: 10 + i });
      const chkS = (tile) => advice.adviceForTile(Object.assign({ type: 'bar', dimension: 'Region', measure: 'V', aggFn: 'sum', seriesColumn: 'Prod' }, tile), sr);
      const tooManyS = chkS({});
      assert.ok(tooManyS && tooManyS.key === 'advice.series.tooMany' && tooManyS.level === 'warn' && tooManyS.vars.n === 10, JSON.stringify(tooManyS));
      const same = chkS({ seriesColumn: 'Region' });
      assert.ok(same && same.key === 'advice.series.sameAsDimension', JSON.stringify(same));
      const noSeries = chkS({ seriesColumn: undefined });
      assert.ok(!noSeries || !/^advice\.series\./.test(noSeries.key), 'sans série : aucun avertissement de série');
      const fewS = advice.adviceForTile({ type: 'line', dimension: 'Region', measure: 'V', aggFn: 'sum', seriesColumn: 'Region2' }, sr.map((r) => Object.assign({}, r, { Region2: r.id % 3 })));
      assert.ok(!fewS || !/^advice\.series\./.test(fewS.key), 'trois séries : pas d\'avertissement de série');
      // Empilé : une pile additionne, donc moyenne/min/max avertissent ; somme/comptage non ; sans « empilé » non
      const stk = (extra) => advice.adviceForTile(Object.assign({ type: 'bar', dimension: 'Region', measure: 'V', aggFn: 'sum', seriesColumn: 'Region2', stacked: true }, extra), sr.map((r) => Object.assign({}, r, { Region2: r.id % 3 })));
      for (const agg of ['avg', 'min', 'max']) {
        const w = stk({ aggFn: agg });
        assert.ok(w && w.key === 'advice.stacked.notAdditive' && w.level === 'warn', agg + ' : ' + JSON.stringify(w));
      }
      for (const agg of ['sum', 'count']) assert.strictEqual(stk({ aggFn: agg }), null, agg);
      assert.strictEqual(stk({ aggFn: 'avg', stacked: false }), null, 'moyenne NON empilée : rien à dire');
      // Courbe sans aire : jamais empilée (isStackedTile) -> jamais l'avertissement de pile (un autre conseil de courbe peut s'appliquer)
      const lineNoArea = stk({ aggFn: 'avg', type: 'line' });
      assert.ok(!lineNoArea || lineNoArea.key !== 'advice.stacked.notAdditive', JSON.stringify(lineNoArea));
      // Plafond de séries = nombre de couleurs de la palette choisie (ECharts reprend au début au-delà)
      assert.strictEqual(tooManyS.vars.max, 8, 'palette standard : 8');
      const sr7 = [];
      for (let i = 0; i < 42; i++) sr7.push({ id: i + 1, Region: ['Nord', 'Sud'][i % 2], Prod: 'P' + (i % 7), V: 10 + i });
      const okabeSeries = advice.adviceForTile({ type: 'bar', dimension: 'Region', measure: 'V', aggFn: 'sum', seriesColumn: 'Prod', palette: 'okabe' }, sr7);
      assert.ok(okabeSeries && okabeSeries.key === 'advice.series.tooMany' && okabeSeries.vars.max === 6 && okabeSeries.vars.n === 7, JSON.stringify(okabeSeries));
      const stdSeries = advice.adviceForTile({ type: 'bar', dimension: 'Region', measure: 'V', aggFn: 'sum', seriesColumn: 'Prod' }, sr7);
      assert.ok(!stdSeries || stdSeries.key !== 'advice.series.tooMany', '7 séries en palette standard : pas d\'avertissement');
      // Camembert / entonnoir / treemap : palette choisie plus courte que le nombre de parts -> avertissement ; sans choix, inchangé
      const seven = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, Cat: 'C' + i, V: 20 - i }));
      const pieOkabe = advice.adviceForTile({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum', palette: 'okabe' }, seven);
      assert.ok(pieOkabe && pieOkabe.key === 'advice.palette.tooFewColors' && pieOkabe.vars.n === 7 && pieOkabe.vars.max === 6, JSON.stringify(pieOkabe));
      const notPalette = (tile) => { const a = advice.adviceForTile(tile, seven); return !a || a.key !== 'advice.palette.tooFewColors'; };
      assert.ok(notPalette({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum' }), '7 parts, palette historique : pas d\'avertissement de palette');
      assert.ok(notPalette({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum', palette: 'blue' }), 'dégradé de 7 pas pour 7 parts : pas d\'avertissement de palette');
      for (const type of ['funnel', 'treemap']) {
        const w = advice.adviceForTile({ type, dimension: 'Cat', measure: 'V', aggFn: 'sum', palette: 'okabe' }, seven);
        assert.ok(w && w.key === 'advice.palette.tooFewColors', type + ' : ' + JSON.stringify(w));
      }
      console.log('OK advice — séries multiples (trop de séries, série = dimension)');
    }

    // adviceForTile : un avertissement à la fois, seulement quand il est juste.
    {
      const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, Cat: 'Catégorie ' + (i + 1), V: 10 + i }));
      const neg = [{ id: 1, C: 'a', V: 5 }, { id: 2, C: 'b', V: -3 }, { id: 3, C: 'c', V: 2 }];
      const chk = (tile, rows, key, level) => {
        const a = advice.adviceForTile(tile, rows);
        if (key === null) { assert.strictEqual(a, null, JSON.stringify(tile) + ' -> ' + JSON.stringify(a)); return; }
        assert.ok(a, 'conseil attendu : ' + key);
        assert.strictEqual(a.key, key);
        if (level) assert.strictEqual(a.level, level);
        assert.ok(a.vars && typeof a.vars === 'object');
      };
      chk({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum' }, many, 'advice.pie.tooManySlices', 'warn');
      assert.strictEqual(advice.adviceForTile({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum' }, many).vars.n, 12);
      chk({ type: 'pie', dimension: 'C', measure: 'V', aggFn: 'sum' }, neg, 'advice.pie.negative', 'warn');
      chk({ type: 'treemap', dimension: 'C', measure: 'V', aggFn: 'sum' }, neg, 'advice.treemap.negative', 'warn');
      chk({ type: 'bar', dimension: 'C', measure: 'V', aggFn: 'sum' }, neg, null); // des barres négatives sont légitimes
      const m14 = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, Cat: 'C' + i, V: i }));
      chk({ type: 'bar', dimension: 'Cat', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, m14, 'advice.bar.horizontal', 'tip');
      chk({ type: 'bar', dimension: 'Cat', measure: 'V', aggFn: 'sum', sortMode: 'value-desc', horizontal: true }, m14, null);
      const lbl = ['Direction régionale Nord', 'Direction régionale Sud', 'Direction Est', 'Direction Ouest'].map((c, i) => ({ id: i + 1, C: c, V: i + 1 }));
      chk({ type: 'bar', dimension: 'C', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, lbl, 'advice.bar.longLabels');
      const six = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, Cat: 'C' + i, V: i }));
      chk({ type: 'bar', dimension: 'Cat', measure: 'V', aggFn: 'sum' }, six, 'advice.bar.unsorted', 'tip');
      chk({ type: 'bar', dimension: 'Cat', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, six, null);
      // Courbe : exige un axe ordonné.
      chk({ type: 'line', dimension: 'Cat', measure: 'V', aggFn: 'sum' }, six, 'advice.line.notTime', 'warn');
      const dates = ['2024-03-01', '2024-01-01', '2024-02-01', '2024-04-01'].map((d, i) => ({ id: i + 1, D: d, V: i }));
      chk({ type: 'line', dimension: 'D', measure: 'V', aggFn: 'sum' }, dates, 'advice.line.unordered', 'tip');
      chk({ type: 'line', dimension: 'D', measure: 'V', aggFn: 'sum', sortMode: 'label' }, dates, null);
      chk({ type: 'line', dimension: 'D', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, dates, 'advice.line.valueSort', 'warn');
      chk({ type: 'waterfall', dimension: 'D', measure: 'V', aggFn: 'sum' }, dates, 'advice.waterfall.unordered', 'tip');
      const mois = ['Janvier', 'Février', 'Mars', 'Avril'].map((m, i) => ({ id: i + 1, M: m, V: i }));
      chk({ type: 'line', dimension: 'M', measure: 'V', aggFn: 'sum' }, mois, null); // des mois sont un axe de temps ; jamais « triez par libellé » (Avril < Janvier)
      chk({ type: 'line', dimension: 'A', measure: 'V', aggFn: 'sum' }, [{ id: 1, A: 2023, V: 1 }, { id: 2, A: 2024, V: 2 }], 'advice.line.fewPoints', 'tip');
      // Radar, jauge, données incomplètes.
      const axes = Array.from({ length: 10 }, (_, i) => 'c' + i);
      const prow = { id: 1 };
      axes.forEach((a) => { prow[a] = 5; });
      chk({ type: 'radar', radarAxisMode: 'columns', radarAxes: axes }, [prow], 'advice.radar.tooManyAxes', 'warn');
      chk({ type: 'radar', radarAxisMode: 'dimension', dimension: 'Cat', measure: 'V', aggFn: 'avg' }, many, 'advice.radar.tooManyAxes');
      chk({ type: 'gauge', measure: 'V', aggFn: 'sum', gaugeMin: 0, gaugeMax: 50 }, many, 'advice.gauge.outOfRange', 'warn');
      chk({ type: 'gauge', measure: 'V', aggFn: 'sum', gaugeMin: 0, gaugeMax: 500 }, many, null);
      const sparse = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, C: 'a' + (i % 3), V: i < 3 ? i : null }));
      const empty = advice.adviceForTile({ type: 'bar', dimension: 'C', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, sparse);
      assert.strictEqual(empty.key, 'advice.data.mostlyEmpty');
      assert.deepStrictEqual(empty.vars, { column: 'V', pct: 70 });
      // KPI simple, aucune donnée, brouillon incomplet : pas de conseil, et jamais de plantage.
      chk({ type: 'kpi', measure: 'V', aggFn: 'sum' }, many, null);
      assert.strictEqual(advice.adviceForTile({ type: 'bar', dimension: 'Cat', measure: 'V' }, []), null);
      assert.strictEqual(advice.adviceForTile(null, many), null);
      assert.strictEqual(advice.adviceForTile({}, many), null);
      assert.strictEqual(advice.adviceForTile({ type: 'bar' }, many), null);
      // Les tuiles de démonstration du banc d'essai (bien faites) ne reçoivent aucun conseil.
      demoData.defaultLargeTiles().forEach((tile) => assert.strictEqual(advice.adviceForTile(tile, big), null, tile.title));
      // Ne mute jamais ses entrées.
      const frozen = Object.freeze(many.map((r) => Object.freeze(Object.assign({}, r))));
      advice.adviceForTile(Object.freeze({ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum' }), frozen);
      advice.suggestTiles(frozen);
      console.log('OK advice.adviceForTile — anneau/radar/jauge/courbe/barres, mois jamais « triés par libellé », aucun faux positif sur les tuiles de démo');
    }

    // adviceForType : toujours un objet ; l'avertissement du type, sinon sa raison d'indisponibilité, sinon la ligne générique.
    {
      advice.TILE_TYPES.forEach((type) => {
        const a = advice.adviceForType(type, big);
        assert.ok(a && a.key && typeof a.vars === 'object' && ['info', 'warn', 'tip'].indexOf(a.level) !== -1, type);
      });
      assert.strictEqual(advice.adviceForType('bar', big).key, 'advice.use.bar');
      const noDate = [{ id: 1, Region: 'Nord', Montant: 1 }, { id: 2, Region: 'Sud', Montant: 2 }, { id: 3, Region: 'Est', Montant: 3 }];
      assert.strictEqual(advice.adviceForType('line', noDate).key, 'advice.fit.noTime');
      assert.strictEqual(advice.adviceForType('scatter', noDate).key, 'advice.fit.needTwoMeasures');
      assert.strictEqual(advice.adviceForType('pivot', noDate).key, 'advice.fit.needTwoDimensions');
      const textOnly = [{ id: 1, Ville: 'Paris' }, { id: 2, Ville: 'Lyon' }, { id: 3, Ville: 'Rome' }];
      assert.strictEqual(advice.adviceForType('kpi', textOnly).key, 'advice.fit.noMeasure');
      assert.strictEqual(advice.adviceForType('wordcloud', [{ id: 1, N: 1 }, { id: 2, N: 2 }]).key, 'advice.fit.needText');
      assert.strictEqual(advice.adviceForType('bar', []).key, 'advice.use.bar'); // pas de données : la ligne générique
      assert.strictEqual(advice.adviceForType('inconnu', big).key, 'advice.use.bar');
      console.log('OK advice.adviceForType — avertissement, indisponibilité ou ligne générique, jamais null');
    }

    // Aucun texte en dur + clés i18n complètes fr/en : toute clé citée par advice.js existe, toute
    // clé `advice.*` du dictionnaire est utilisée, et chaque phrase se résout sans `{variable}` orpheline.
    {
      const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'advice.js'), 'utf8');
      const used = new Set((source.match(/'advice\.[A-Za-z]+\.[A-Za-z]+'/g) || []).map((k) => k.slice(1, -1)));
      const defined = Object.keys(i18n.STRINGS).filter((k) => k.startsWith('advice.'));
      used.forEach((k) => assert.ok(i18n.STRINGS[k], 'clé i18n manquante : ' + k));
      defined.forEach((k) => assert.ok(used.has(k), 'clé i18n jamais utilisée par advice.js : ' + k));
      defined.forEach((k) => assert.ok(i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction manquante : ' + k));
      advice.TILE_TYPES.forEach((type) => assert.ok(advice.USE_KEYS[type] && i18n.STRINGS[advice.USE_KEYS[type]], 'ligne « quand l\'utiliser » : ' + type));
      // Mêmes variables dans les deux langues.
      defined.forEach((k) => {
        const vars = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
        assert.strictEqual(vars(i18n.STRINGS[k].fr), vars(i18n.STRINGS[k].en), 'variables différentes fr/en : ' + k);
      });
      // Tout ce que le module sait renvoyer se traduit complètement dans les deux langues.
      const outputs = [];
      advice.suggestTiles(big, undefined, { limit: 10 }).forEach((x) => outputs.push([x.titleKey, x.titleVars], [x.reasonKey, x.reasonVars]));
      advice.TILE_TYPES.forEach((type) => outputs.push([advice.adviceForType(type, big).key, advice.adviceForType(type, big).vars]));
      const sampleTiles = [
        [{ type: 'pie', dimension: 'Cat', measure: 'V', aggFn: 'sum' }, Array.from({ length: 12 }, (_, i) => ({ id: i, Cat: 'C' + i, V: i + 1 }))],
        [{ type: 'gauge', measure: 'V', aggFn: 'sum', gaugeMin: 0, gaugeMax: 3 }, [{ id: 1, V: 10 }, { id: 2, V: 20 }]],
        [{ type: 'bar', dimension: 'C', measure: 'V', aggFn: 'sum', sortMode: 'value-desc' }, Array.from({ length: 10 }, (_, i) => ({ id: i, C: 'a' + (i % 3), V: i < 3 ? i : null }))]
      ];
      sampleTiles.forEach(([tile, rows]) => { const a = advice.adviceForTile(tile, rows); outputs.push([a.key, a.vars]); });
      ['fr', 'en'].forEach((lang) => {
        i18n.setLang(lang);
        outputs.forEach(([key, vars]) => {
          const text = i18n.t(key, vars);
          assert.ok(text && text.indexOf('{') === -1 && text !== key, `${lang} ${key} : « ${text} »`);
        });
      });
      i18n.setLang('fr');
      // Seule exception au « zéro texte » : `opts.t` résout les titres persistés dans la langue courante.
      i18n.setLang('en');
      const en = advice.suggestTiles(big, undefined, { t: i18n.t })[0].tileData.title;
      i18n.setLang('fr');
      const fr = advice.suggestTiles(big, undefined, { t: i18n.t })[0].tileData.title;
      assert.notStrictEqual(en, fr);
      assert.ok(/ by /.test(en) && / par /.test(fr), `${en} / ${fr}`);
      console.log(`OK advice — ${used.size} clés i18n, toutes définies et utilisées, fr/en à variables identiques, aucune {variable} orpheline`);
    }
  }

  // grist-api.js:getCurrentUserEmail — détection de l'auteur courant par la table-sonde (bug réel n°35,
  // 18/11/2026 : la colonne était une formule ORDINAIRE, `user` y est indéfini → `NameError`, que le champ
  // Auteur affichait tel quel, « E,NameError »). Le module est chargé dans un contexte `vm` avec un faux
  // `grist` : il lit `window`/`grist`/`setTimeout` comme globales, jamais `require`.
  {
    const vm = require('vm');
    const fsG = require('fs');
    const pathG = require('path');
    const source = fsG.readFileSync(pathG.join(__dirname, '..', 'js', 'grist-api.js'), 'utf8');
    async function runProbe({ reads, failModify, exists = true }) {
      const calls = [];
      const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; } };
      sandbox.window = sandbox;
      sandbox.GristBI = { data };
      let probeReads = 0;
      let modified = false;
      let nextId = 1;
      let tables = exists ? ['BI_Dashboard_UserProbe'] : [];
      sandbox.grist = { docApi: {
        listTables: async () => tables.slice(),
        fetchTable: async () => {
          const value = reads(modified, probeReads++);
          return { id: [nextId - 1], Email: [value] };
        },
        applyUserActions: async (actions) => {
          const result = { retValues: [] };
          actions.forEach((a) => {
            calls.push(a);
            if (a[0] === 'AddTable') { tables = tables.concat([a[1]]); result.retValues.push({ id: 1, table_id: a[1], columns: [] }); }
            else if (a[0] === 'AddRecord') result.retValues.push(nextId++);
            else if (a[0] === 'ModifyColumn') { if (failModify) throw new Error('refusé'); modified = true; result.retValues.push(null); }
            else result.retValues.push(null);
          });
          return result;
        }
      } };
      vm.runInNewContext(source, sandbox);
      const email = await sandbox.GristBI.api.getCurrentUserEmail();
      return { email, calls };
    }
    const kinds = (calls) => calls.map((c) => c[0]);

    // 1. Cas nominal : adresse lue du premier coup, rien n'est modifié, la ligne de sonde est supprimée.
    let r = await runProbe({ reads: () => 'ada@exemple.org' });
    assert.strictEqual(r.email, 'ada@exemple.org');
    assert.strictEqual(kinds(r.calls).join(), 'AddRecord,RemoveRecord');

    // 2. Table à créer : la colonne est une formule DÉCLENCHÉE (isFormula false), jamais une formule ordinaire.
    r = await runProbe({ reads: () => 'ada@exemple.org', exists: false });
    const addTable = r.calls.find((c) => c[0] === 'AddTable');
    assert.ok(addTable, 'AddTable attendu');
    const emailCol = addTable[2].find((c) => c.id === 'Email');
    assert.strictEqual(emailCol.isFormula, false, 'formule déclenchée, pas ordinaire');
    assert.strictEqual(emailCol.formula, 'user.Email');

    // 3. Ancienne colonne (NameError) : réparée par ModifyColumn puis relue, l'adresse sort.
    r = await runProbe({ reads: (modified) => (modified ? 'ada@exemple.org' : ['E', 'NameError']) });
    assert.strictEqual(r.email, 'ada@exemple.org');
    const mod = r.calls.find((c) => c[0] === 'ModifyColumn');
    assert.ok(mod, 'ModifyColumn attendu');
    assert.strictEqual(JSON.stringify(mod[3]), JSON.stringify({ isFormula: false, formula: 'user.Email' }));

    // 4. Erreur persistante : repli sur null (saisie manuelle), JAMAIS la valeur d'erreur.
    r = await runProbe({ reads: () => ['E', 'NameError'] });
    assert.strictEqual(r.email, null);
    assert.strictEqual(kinds(r.calls).filter((k) => k === 'ModifyColumn').length, 1, 'une seule réparation par session');

    // 5. Réparation refusée par Grist : toujours null, sans exception.
    r = await runProbe({ reads: () => ['E', 'NameError'], failModify: true });
    assert.strictEqual(r.email, null);

    // 6. Utilisateur anonyme (cellule vide / null / chaîne sans arobase) : null, et AUCUNE réparation.
    for (const value of [null, '', 'anonymous', 12, 'E,NameError']) {
      r = await runProbe({ reads: () => value });
      assert.strictEqual(r.email, null, `valeur ${JSON.stringify(value)} refusée`);
      assert.ok(!kinds(r.calls).includes('ModifyColumn'), 'pas de réparation hors cellule en erreur');
    }
    console.log('OK grist-api:getCurrentUserEmail — colonne déclenchée, ancienne colonne réparée, jamais une valeur d\'erreur comme auteur');
  }

  // --- js/models.js + modeles/modeles.json : modèles de « Nouveau > Depuis un modèle » (consigne GFS 016) ---
  {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const withHierarchies = (rows) => Object.keys(rows[0]).filter((k) => k !== 'id')
      .reduce((acc, col) => (data.parseDateValue(rows[0][col]) != null ? data.deriveDateHierarchyColumns(acc, col) : acc), rows);
    const big = withHierarchies(demoData.buildLargeSampleRows());
    const cols = (rows) => Object.keys(rows[0]).filter((k) => k !== 'id');

    assert.deepStrictEqual(models.ids().sort(), ['evolution', 'repartition', 'vue-d-ensemble']);
    assert.strictEqual(models.REPORT_TYPE, 'rapport');
    assert.ok(models.has('evolution') && !models.has('nope') && !models.has('') && !models.has(undefined) && !models.has('__proto__') && !models.has('toString'));

    // Chaque modèle sur un vrai tableau : des tuiles qui s'ajoutent au store et s'agrègent.
    models.ids().forEach((id) => {
      ['fr', 'en'].forEach((lang) => {
        i18n.setLang(lang);
        const r = models.build(id, big, cols(big), { t: i18n.t });
        assert.ok(r.ok, `${id} (${lang}) s'applique au jeu de données de test`);
        assert.ok(r.tiles.length >= 3 && r.tiles.length <= 6, `${id} : de 3 à 6 tuiles (${r.tiles.length})`);
        assert.ok(r.pageName && r.pageName.indexOf('models.') === -1, `${id} (${lang}) : nom de page traduit « ${r.pageName} »`);
        const store = state.createStore();
        store.setPages([{ id: 'p1', name: r.pageName, tiles: r.tiles.map((t, i) => Object.assign({ id: `m${i}` }, t)) }], 'p1');
        r.tiles.forEach((tile) => {
          assert.ok(tile.title && tile.title.indexOf('{') === -1 && tile.title.indexOf('models.') === -1, `${id} : titre « ${tile.title} »`);
          [tile.dimension, tile.measure, tile.columnDimension, tile.seriesColumn, tile.trendDimension].filter(Boolean).forEach((c) => {
            assert.ok(Object.keys(big[0]).indexOf(c) !== -1, `${id} : la colonne « ${c} » existe`);
          });
          if (tile.dimension) {
            const groups = data.groupByAggregate(big, tile.dimension, tile.measure, tile.aggFn);
            assert.ok(groups.length >= 1 && groups.every((g) => Number.isFinite(g.value)), `${id}/${tile.type} : agrégat valide`);
          }
          assert.ok(!('id' in tile), 'les tuiles n\'ont pas d\'id : main.js le pose');
        });
      });
    });
    i18n.setLang('fr');
    {
      const fr = models.build('vue-d-ensemble', big, cols(big), { t: i18n.t });
      i18n.setLang('en');
      const en = models.build('vue-d-ensemble', big, cols(big), { t: i18n.t });
      i18n.setLang('fr');
      assert.strictEqual(fr.pageName, 'Vue d’ensemble');
      assert.strictEqual(en.pageName, 'Overview');
      assert.notStrictEqual(fr.tiles[2].title, en.tiles[2].title, 'les titres suivent la langue');
      // Sans `opts.t` : jamais un mot de français en dur dans un titre.
      const bare = models.build('evolution', big, cols(big));
      assert.ok(bare.ok && bare.tiles.every((t) => !/\bpar\b|\bby\b|Total/.test(t.title)), 'repli neutre sans t : ' + bare.tiles.map((t) => t.title).join(' | '));
      console.log('OK models.build — 3 modèles sur le jeu de données de test : vraies colonnes, agrégats valides, fr/en, sans id');
    }

    // Contenu de chaque modèle : ce que la personne y verra.
    {
      const tr = (key, vars) => i18n.t(key, vars);
      const overview = models.build('vue-d-ensemble', big, cols(big), { t: tr });
      assert.deepStrictEqual(overview.tiles.map((t) => t.type), ['kpi', 'kpi', 'line', 'bar', 'pie'], 'chiffres clés d\'abord, puis courbe, barres, anneau');
      assert.strictEqual(overview.tiles[0].trendDimension, 'Date.Annee', 'KPI avec tendance');
      assert.strictEqual(overview.tiles[2].areaFill, true, 'la courbe de la vue d\'ensemble est une aire');
      assert.ok(overview.tiles[3].dimension !== 'Date.Annee' && overview.tiles[4].dimension !== 'Date.Annee', 'barres et anneau : de vraies catégories, pas l\'année');

      const evolution = models.build('evolution', big, cols(big), { t: tr });
      const series = evolution.tiles.find((t) => t.seriesColumn);
      assert.ok(series && series.type === 'line' && series.areaFill && series.stacked, 'courbe de séries empilée');
      assert.strictEqual(series.dimension, evolution.tiles.find((t) => t.type === 'line').dimension, 'même axe que la courbe de base');
      assert.strictEqual(series.measure, evolution.tiles.find((t) => t.type === 'line').measure, 'même mesure');
      assert.ok(data.isStackedTile(series) && data.isSeriesTile(series), 'la tuile est reconnue comme série empilée par js/data.js');
      assert.ok(['Produit', 'Region'].indexOf(series.seriesColumn) !== -1, 'séries = une vraie catégorie de 2 à 6 valeurs');
      const bar = evolution.tiles.find((t) => t.type === 'bar');
      assert.ok(bar && /^(Mois|Date\.Mois|Date\.Trimestre|Trimestre|Jour|Annee)$/.test(bar.dimension), 'barres par mois : la saisonnalité, ' + (bar && bar.dimension));

      const rep = models.build('repartition', big, cols(big), { t: tr });
      const repDims = rep.tiles.filter((t) => t.type === 'bar').map((t) => t.dimension);
      assert.strictEqual(new Set(repDims).size, repDims.length, 'deux barres = deux dimensions différentes : ' + repDims);
      assert.ok(rep.tiles.every((t) => !/^(Date|Annee|Mois|Jour|Trimestre)/.test(t.dimension || '')), 'répartition : aucune dimension de temps');
      console.log('OK models — vue d\'ensemble (KPI/aire/barres/anneau), évolution (série empilée, saisonnalité), répartition (dimensions distinctes)');
    }

    // Ce que le tableau n'a pas : `{ ok: false, missing }`, jamais un rapport vide ni une exception.
    {
      const noTime = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, Equipe: ['A', 'B', 'C'][i % 3], Ventes: 10 + i }));
      assert.deepStrictEqual(models.build('evolution', noTime, cols(noTime)), { ok: false, missing: ['time'] }, 'pas de date : l\'évolution refuse');
      assert.ok(models.build('vue-d-ensemble', noTime, cols(noTime)).ok, 'sans date, la vue d\'ensemble reste possible (sans courbe)');
      assert.ok(!models.build('vue-d-ensemble', noTime, cols(noTime)).tiles.some((t) => t.type === 'line'), 'et sans courbe');
      const numbersOnly = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, A: i * 1.5 + 0.25, B: Math.sin(i) * 100 + 0.5 }));
      assert.deepStrictEqual(models.build('repartition', numbersOnly, cols(numbersOnly)), { ok: false, missing: ['category'] });
      assert.deepStrictEqual(models.build('vue-d-ensemble', [], []), { ok: false, missing: ['data'] }, 'table vide');
      assert.deepStrictEqual(models.build('vue-d-ensemble', undefined), { ok: false, missing: ['data'] });
      assert.deepStrictEqual(models.build('nope', big, cols(big)), { ok: false, unknown: true, missing: [] }, 'id inconnu');
      assert.deepStrictEqual(models.build('__proto__', big, cols(big)), { ok: false, unknown: true, missing: [] });
      // Une table qui ne fait que des textes : on compte les lignes plutôt que de refuser.
      const textOnly = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, Ville: ['Lyon', 'Nice', 'Brest'][i % 3], Statut: ['Ouvert', 'Fermé'][i % 2] }));
      const counted = models.build('vue-d-ensemble', textOnly, cols(textOnly));
      assert.ok(counted.ok && counted.tiles.some((t) => t.aggFn === 'count'), 'sans mesure : comptage de lignes');
      console.log('OK models.build — sans date / sans catégorie / vide / id inconnu : { ok: false, missing }, jamais une exception ni un rapport vide');
    }

    // Deux appels de suite ne partagent aucun objet (un modèle ne modifie jamais ses suggestions).
    {
      const a = models.build('vue-d-ensemble', big, cols(big));
      a.tiles[0].title = 'modifié';
      a.tiles.forEach((t) => { t.measure = 'XXX'; });
      const b = models.build('vue-d-ensemble', big, cols(big));
      assert.notStrictEqual(b.tiles[0].title, 'modifié');
      assert.ok(b.tiles.every((t) => t.measure !== 'XXX'));
      console.log('OK models.build — résultats indépendants d\'un appel à l\'autre');
    }

    // Clés i18n : toute clé `models.*` citée par le code existe en fr ET en anglais, mêmes variables.
    {
      const sources = ['js/models.js', 'js/main.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
      const used = new Set((sources.match(/'models\.[A-Za-z.]+'/g) || []).map((k) => k.slice(1, -1)));
      ['data', 'time', 'category'].forEach((role) => used.add('models.need.' + role)); // composée : 'models.need.' + role
      used.delete('models.need.');
      assert.ok(used.size >= 10, 'au moins dix clés citées, trouvé ' + used.size);
      const vars = (str) => (str.match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
      used.forEach((key) => {
        const entry = i18n.STRINGS && i18n.STRINGS[key];
        i18n.setLang('fr'); const fr = i18n.t(key, {});
        i18n.setLang('en'); const en = i18n.t(key, {});
        i18n.setLang('fr');
        assert.ok(fr !== key && en !== key && fr && en, 'clé définie en fr et en : ' + key);
        assert.strictEqual(vars(fr), vars(en), 'mêmes variables en fr et en : ' + key);
      });
      const defined = Object.keys(i18n.STRINGS || {}).filter((k) => /^models\./.test(k));
      if (defined.length) defined.forEach((k) => assert.ok(used.has(k), 'clé models.* définie et jamais utilisée : ' + k));
      console.log(`OK models — ${used.size} clés i18n, toutes définies fr/en à variables identiques`);
    }

    // Le catalogue que GFS copie (modeles/modeles.json) : les règles de GFS (contrats 5.4 point 13), au
    // mot près, et la correspondance exacte avec les modèles que le code sait ouvrir.
    {
      const dir = path.join(root, 'modeles');
      const catalogue = JSON.parse(fs.readFileSync(path.join(dir, 'modeles.json'), 'utf8'));
      assert.ok(Array.isArray(catalogue) && catalogue.length === models.ids().length, 'une entrée par modèle');
      const ids = new Set();
      const bilingual = (v, max, label) => {
        assert.ok(v && typeof v.fr === 'string' && typeof v.en === 'string' && v.fr.trim() && v.en.trim(), label + ' : fr ET en');
        assert.ok(v.fr.length <= max && v.en.length <= max, `${label} : ${max} signes au plus`);
      };
      const webpSize = (buf) => {
        assert.strictEqual(buf.toString('latin1', 0, 4), 'RIFF');
        assert.strictEqual(buf.toString('latin1', 8, 12), 'WEBP');
        const kind = buf.toString('latin1', 12, 16);
        if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
        if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
        throw new Error('WebP inconnu : ' + kind);
      };
      catalogue.forEach((e) => {
        assert.ok(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(e.id), 'id valide : ' + e.id);
        assert.ok(!ids.has(e.id), 'id unique : ' + e.id); ids.add(e.id);
        assert.ok(models.has(e.id), 'chaque entrée du catalogue est un modèle que le code sait ouvrir : ' + e.id);
        assert.strictEqual(e.type, models.REPORT_TYPE, 'type = celui du manifeste');
        bilingual(e.nom, 60, e.id + ' nom');
        bilingual(e.description, 140, e.id + ' description');
        assert.ok(Array.isArray(e.etiquettes) && e.etiquettes.length >= 3, e.id + ' : des étiquettes pour la recherche');
        e.etiquettes.forEach((tag, i) => bilingual(tag, 40, `${e.id} étiquette ${i}`));
        assert.ok(!e.tables, 'aucun modèle ne crée de table (CLAUDE.md §8) : pas de tables: true');
        assert.ok(!e.extensions, 'aucune extension de plus que celle du type');
        assert.ok(/^[a-z0-9][a-z0-9._-]*\.webp$/.test(e.vignette), 'vignette WebP : ' + e.vignette);
        const file = fs.readFileSync(path.join(dir, e.vignette));
        const size = webpSize(file);
        assert.deepStrictEqual(size, { w: 240, h: 320 }, e.id + ' : vignette 240 × 320');
        assert.ok(file.length <= 12 * 1024, `${e.id} : vignette ${file.length} octets (12 Ko conseillés)`);
      });
      models.ids().forEach((id) => assert.ok(ids.has(id), 'chaque modèle du code est au catalogue : ' + id));
      const onDisk = fs.readdirSync(dir).filter((f) => /\.webp$/.test(f));
      assert.strictEqual(onDisk.length, catalogue.length, 'aucune vignette orpheline dans modeles/');
      console.log(`OK modeles/modeles.json — ${catalogue.length} entrées valides (règles de GFS : id, 60/140 signes fr/en, étiquettes, vignettes WebP 240×320 ≤ 12 Ko), sans tables ni extensions`);
    }

    // Câblage de l'ouverture `modele` (js/main.js) : lu dans la source, le navigateur le rejoue (voir TEST_PROTOCOL.md).
    {
      const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
      assert.ok(/GfsLink\.onOpen\(async \(\{ fichier, type, modele \}\)/.test(main), 'onOpen lit `modele`');
      assert.ok(/if \(modele\) return openModelById\(modele\.id, type\)/.test(main), 'onOpen : un modèle ne retombe JAMAIS sur le départ vierge');
      assert.ok(/opening && opening\.modele/.test(main), 'bootstrap : l\'ouverture initiale `modele` a sa branche, avant le départ vierge');
      assert.ok(main.indexOf('opening && opening.modele') < main.indexOf('await openBlankReport(); // gère déjà'), 'la branche modèle passe avant « Nouveau »');
      assert.ok(!/createTableFromRows[\s\S]{0,400}openModelById|openModelById[\s\S]{0,2500}createTableFromRows/.test(main.slice(main.indexOf('async function openModelById'), main.indexOf('GristBI.openModel ='))), 'openModelById ne crée aucune table');
      assert.ok(/<script src="js\/models\.js"><\/script>/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'index.html charge js/models.js');
      assert.ok(fs.readFileSync(path.join(root, 'index.html'), 'utf8').indexOf('js/models.js') > fs.readFileSync(path.join(root, 'index.html'), 'utf8').indexOf('js/advice.js'), 'models.js après advice.js');
      console.log('OK js/main.js — onOpen/bootstrap lisent `modele` avant « Nouveau », openModelById ne crée aucune table, index.html charge js/models.js');
    }
  }
})().then(() => {
  console.log('\nTous les tests data.js/state.js/demo-data.js/combobox.js/duckdb-engine.js/i18n.js sont passés.');
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
