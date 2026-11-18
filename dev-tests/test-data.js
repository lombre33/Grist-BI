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

// state: tuiles agrandies (retours d'Antoine du 18/11/2026, point 8) — zone d'agrandissement au-dessus de la grille
{
  const store = state.createStore();
  store.addTile({ id: 'a', type: 'kpi', measure: 'Montant', aggFn: 'sum' });
  store.addTile({ id: 'b', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
  store.addTile({ id: 'c', type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum' });
  assert.deepStrictEqual(store.getState().zoomedTileIds, [], 'aucune tuile agrandie au départ');

  store.toggleZoom('c');
  store.toggleZoom('a');
  // exposé dans l'ordre d'AFFICHAGE des tuiles, pas dans l'ordre des clics
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['a', 'c'], 'plusieurs tuiles, ordre d\'affichage');
  store.toggleZoom('c');
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['a'], 'toggle : réduit une tuile agrandie');
  store.toggleZoom('inconnue');
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['a'], 'id inconnu = no-op');

  // pas une donnée à sauvegarder : aucune nouvelle référence de `pages`
  const pagesBefore = store.getState().pages;
  store.toggleZoom('b');
  assert.strictEqual(store.getState().pages, pagesBefore, 'agrandir ne touche pas `pages` (rien à persister)');

  // les tuiles se déplacent : l'ordre d'affichage suit state.tiles
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['a', 'b']);
  store.moveTile('b', -1);
  assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['b', 'a', 'c']);
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['b', 'a'], 'ordre d\'affichage après déplacement');

  // tout réduire
  store.clearZoom();
  assert.deepStrictEqual(store.getState().zoomedTileIds, []);
  store.clearZoom(); // déjà vide : pas de notification inutile
  let notified = 0;
  const unsub = store.subscribe(() => { notified++; });
  store.clearZoom();
  assert.strictEqual(notified, 0, 'clearZoom sans rien d\'agrandi ne notifie pas');
  unsub();

  // supprimer une tuile agrandie la retire de la liste (et une tuile recréée avec le même id ne revient pas agrandie)
  store.toggleZoom('a');
  store.removeTile('a');
  assert.deepStrictEqual(store.getState().zoomedTileIds, []);
  store.addTile({ id: 'a', type: 'kpi', measure: 'Montant', aggFn: 'sum' });
  assert.deepStrictEqual(store.getState().zoomedTileIds, [], 'une tuile recréée n\'est pas agrandie');

  // multi-pages : l'agrandissement est mémorisé par tuile ; getState n'expose que la page courante
  store.toggleZoom('b');
  const p2 = store.addPage('Page 2'); // navigue vers la page 2
  store.addTile({ id: 'd', type: 'kpi', measure: 'Montant', aggFn: 'sum' });
  assert.deepStrictEqual(store.getState().zoomedTileIds, [], 'la page 2 n\'a aucune tuile agrandie');
  store.toggleZoom('b'); // 'b' est sur la page 1 : no-op
  store.toggleZoom('d');
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['d']);
  store.setCurrentPage(store.getState().pages[0].id);
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['b'], 'retour à la page 1 : son agrandissement est resté');
  // supprimer la page 2 emporte l'agrandissement de ses tuiles
  store.removePage(p2);
  store.setCurrentPage(store.getState().pages[0].id);
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['b']);

  // setPages (autre rapport / autre table) : seules les tuiles qui existent encore restent agrandies
  store.setPages([{ id: 'p', name: 'P', tiles: [{ id: 'z', type: 'kpi', measure: 'M', aggFn: 'sum' }] }], 'p');
  assert.deepStrictEqual(store.getState().zoomedTileIds, []);
  store.toggleZoom('z');
  store.setPages([{ id: 'p', name: 'P', tiles: [{ id: 'z', type: 'kpi', measure: 'M', aggFn: 'sum' }, { id: 'y', type: 'kpi', measure: 'M', aggFn: 'sum' }] }], 'p');
  assert.deepStrictEqual(store.getState().zoomedTileIds, ['z'], 'une tuile toujours présente reste agrandie');
  console.log('OK state : tuiles agrandies (plusieurs, ordre d\'affichage, toggle, tout réduire, suppression, multi-pages, setPages)');
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

// state: ids de tuile relus d'une configuration (audit gwaudit C-XSS-01, bug réel n°45). Un id est reposé
// tel quel dans `data-tile-id="…"` et dans des sélecteurs : une ligne de BI_Dashboard_Config écrite par
// quelqu'un d'autre pouvait y glisser `x"><img src=x onerror=…>` et exécuter du script dans le widget.
{
  const UNSAFE = /[^A-Za-z0-9_-]/;
  const hostile = 'x"><img src=x onerror="window.__xss=1">';
  const store = state.createStore();
  store.setPages([
    { id: 'p1', name: 'Ventes', tiles: [{ id: hostile, type: 'bar', title: 'Garde son titre' }, { id: "a'b c", type: 'kpi' }, { id: '', type: 'kpi' }, { type: 'kpi' }, { id: 42, type: 'kpi' }] },
    { id: 'p2', name: 'Stock', tiles: [{ id: 'tile_abc', type: 'bar' }, { id: 'tile_abc', type: 'pie' }, null, 'pas-une-tuile'] }
  ], 'p1');
  const ids = store.getState().pages.flatMap((p) => p.tiles.map((t) => t.id));
  assert.ok(ids.every((id) => typeof id === 'string' && id !== '' && !UNSAFE.test(id)), 'aucun id ne garde un caractère hors [A-Za-z0-9_-] : ' + JSON.stringify(ids));
  assert.strictEqual(new Set(ids).size, ids.length, 'ids uniques dans tout le rapport, pages confondues : ' + JSON.stringify(ids));
  assert.strictEqual(store.getState().pages[0].tiles[0].title, 'Garde son titre', 'seul l\'id change, le reste de la tuile reste intact');
  assert.strictEqual(store.getState().pages[1].tiles.length, 2, 'une « tuile » qui n\'est pas un objet est écartée');
  assert.strictEqual(ids[ids.length - 2], 'tile_abc');
  assert.strictEqual(ids[ids.length - 1], 'tile_abc_2', 'un id déjà pris reçoit un suffixe');
  // Les ids que ce widget fabrique lui-même ne changent jamais : même référence, donc aucune sauvegarde au chargement.
  const clean = [{ id: 'page_default', name: 'P', tiles: [{ id: 'tile_lx9a_3k2z', type: 'bar' }, { id: '__preview__', type: 'bar' }, { id: 'stress_bar-region', type: 'bar' }] }];
  assert.strictEqual(state.sanitizePages(clean), clean, 'rien à corriger : la MÊME référence revient');
  assert.strictEqual(state.sanitizePages([{ id: 'p', name: 'P', tiles: [] }]).length, 1);
  // Une page sans tableau de tuiles ne fait plus lever setPages.
  store.setPages([{ id: 'p', name: 'P' }], 'p');
  assert.deepStrictEqual(store.getState().tiles, []);
  assert.strictEqual(state.safeTileId(undefined, new Set()), 'tile');
  console.log('OK state.setPages — ids de tuile relus de la configuration : caractères sûrs, uniques, tuile invalide écartée, ids du widget inchangés (même référence)');
}

// Le balisage de buildTileElement et le pivot échappent aussi (défense en profondeur : le correctif de
// l'ingestion ci-dessus ne doit pas être la seule barrière).
{
  const nodeFs = require('fs'), nodePath = require('path');
  const main = nodeFs.readFileSync(nodePath.join(__dirname, '..', 'js', 'main.js'), 'utf8');
  const charts = nodeFs.readFileSync(nodePath.join(__dirname, '..', 'js', 'charts.js'), 'utf8');
  assert.ok(!/data-tile-id="\$\{tile\.id\}"/.test(main), 'main.js : `data-tile-id` reçoit escapeHtml(tile.id), jamais tile.id nu');
  assert.ok(/data-tile-id="\$\{escapeHtml\(tile\.id\)\}"/.test(main));
  assert.ok(/const fmt = \(v\) => \(v == null \? '–' : escapeHtml\(String\(pivotFmt\.format\(v\)\)\)\);/.test(charts), 'charts.js : les valeurs du pivot sont échappées');
  console.log('OK défense en profondeur — data-tile-id échappé (main.js), valeurs du pivot échappées (charts.js)');
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

// Onglets de page rognés quand le bouton Vues porte le nom de la vue suivie (bug réel n°51, 18/11/2026) : `fitTabsLevel` (js/appbar.js, pure) choisit
// combien alléger la barre pour que les onglets tiennent ; le DOM est remplacé ici par un modèle de largeurs.
{
  const appbar = require('../js/appbar.js');
  const A = 300; // largeur offerte aux onglets par la barre complète
  const NAME_W = 60; // gagnée en effaçant le nom de la vue
  const LABELS_W = 100; // gagnée en effaçant en plus les libellés des boutons
  const run = (need, hasName) => {
    const calls = [];
    let level = -1;
    const avail = () => A + (level >= 1 && hasName ? NAME_W : 0) + (level === 2 ? LABELS_W : 0);
    const result = appbar.fitTabsLevel(() => need > avail(), (n) => { level = n; calls.push(n); }, hasName);
    return { result, calls, final: level, clipped: need > avail() };
  };
  // Ça tient d'emblée : un seul réglage (barre complète), rien n'est effacé.
  let r = run(280, true);
  assert.deepStrictEqual([r.result, r.calls], [0, [0]]);
  // Le nom de la vue suffit : les libellés des boutons ne sont jamais touchés.
  r = run(A + 50, true);
  assert.deepStrictEqual([r.result, r.calls, r.clipped], [1, [0, 1], false]);
  // Le nom ne suffit pas, les libellés oui.
  r = run(A + 150, true);
  assert.deepStrictEqual([r.result, r.calls, r.clipped], [2, [0, 1, 2], false]);
  // Sans nom de vue : on passe directement aux libellés (le palier 1 n'existe pas), jamais de palier 1.
  r = run(A + 50, false);
  assert.deepStrictEqual([r.result, r.calls], [2, [0, 2]]);
  r = run(A + 150, false);
  assert.deepStrictEqual([r.result, r.clipped], [0, true], 'sans nom, 100 px ne suffisent pas : on garde les libellés');
  // Beaucoup de pages : rien ne suffit. Les libellés sont gardés (inutile de les perdre), le nom de la vue reste effacé (il aide un peu).
  r = run(A + 500, true);
  assert.deepStrictEqual([r.result, r.final, r.clipped], [1, 1, true]);
  assert.strictEqual(r.calls[r.calls.length - 1], 1, 'le dernier réglage posé est le palier rendu');
  r = run(A + 500, false);
  assert.deepStrictEqual([r.result, r.final], [0, 0]);
  // Pour tout besoin de largeur : le dernier réglage posé EST le palier rendu, le palier ne baisse jamais quand le besoin augmente,
  // et si le palier rendu laisse les onglets rognés, aucun palier plus fort n'aurait suffi.
  for (const hasName of [true, false]) {
    let previous = -1;
    for (let need = 200; need <= 600; need += 10) {
      const x = run(need, hasName);
      assert.strictEqual(x.final, x.result, `besoin ${need} : état final cohérent`);
      // Le palier 2 est le plus puissant : s'il avait suffi, il aurait été gardé. Rogné = même tous les paliers ne suffisent pas.
      if (x.clipped) assert.ok(need > A + (hasName ? NAME_W : 0) + LABELS_W, `besoin ${need} : rogné seulement si même tous les paliers ne suffisent pas`);
      assert.ok(x.result >= previous || x.clipped, `besoin ${need} : le palier ne baisse pas quand le besoin augmente`);
      if (!x.clipped) previous = x.result;
    }
  }
  // Câblage : l'ajustement passe APRÈS le rendu du nom de la vue (le bug : il se faisait avant, dans renderPageTabs), au changement de mode,
  // au redimensionnement et par un ResizeObserver différé ; les deux classes existent dans la feuille.
  const fs = require('fs');
  const main = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'main.js'), 'utf8');
  const css = fs.readFileSync(require('path').join(__dirname, '..', 'css', 'style.css'), 'utf8');
  assert.ok(/renderBookmarks\(state\);\s*renderConnectionStatus\(state\);\s*fitPageTabs\(\);/.test(main), 'render() ajuste les onglets après le nom de la vue et la pastille de table');
  assert.ok(!/function renderPageTabs[\s\S]*?updateTabsOverflow\(\);\s*for \(const removeBtn/.test(main), 'renderPageTabs ne mesure plus (avant que le bouton Vues ait changé de largeur)');
  assert.ok(/applyMode\(\);\s*fitPageTabs\(\);/.test(main), 'le changement de mode (boutons en plus en Édition) réajuste la barre');
  assert.ok(/window\.addEventListener\('resize', fitPageTabs\)/.test(main) && /new ResizeObserver\(\(\) => requestAnimationFrame\(fitPageTabs\)\)\.observe\(pageTabsEl\)/.test(main), 'redimensionnement : tout de suite, et en filet différé d\'une image');
  assert.ok(/GristBI\.appbar\.fitTabsLevel\(tabsClipped/.test(main), 'main.js délègue le choix du palier à js/appbar.js');
  // Bug réel n°52 : `scrollIntoView` (appelé sur l'onglet actif à chaque redimensionnement) fait aussi défiler la PAGE ; la barre étant collante,
  // une capture pleine page emportait le document de 232 px. L'ajustement des onglets ne fait défiler que la liste d'onglets.
  const fitBody = main.slice(main.indexOf('function fitPageTabs()'), main.indexOf('// L\'onglet actif doit rester visible dans une liste qui défile'));
  assert.ok(fitBody.length > 100 && !/scrollIntoView/.test(fitBody), 'fitPageTabs ne fait jamais défiler la page');
  assert.ok(/function revealActiveTab\(\) \{[\s\S]*?pageTabsEl\.scrollLeft [-+]= /.test(main) && /updateTabsOverflow\(\);\s*revealActiveTab\(\);/.test(main), 'l\'onglet actif est ramené dans la vue par le défilement de la liste seulement');
  assert.ok(/\.appbar\.bar-names-hidden \.bar-view-name/.test(css) && /\.appbar\.bar-labels-hidden \.bar-label \{ display: none; \}/.test(css) && /\.appbar\.bar-labels-hidden \.bar-btn-mode \.bar-label \{ display: inline; \}/.test(css), 'classes de palier dans la feuille (le libellé du mode reste)');
  console.log('OK appbar — fitTabsLevel (paliers nom de vue puis libellés, gardés seulement s\'ils servent, 2 x 41 largeurs), câblage');
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

// js/format.js : format des nombres des tuiles (audit de lisibilité du 18/11/2026). Les `Intl` insèrent des
// espaces insécables fines (U+202F/U+00A0) : normalisées en espace simple pour que les attendus restent lisibles.
{
  const format = require('../js/format.js');
  const n = (s) => s.replace(/[  ]/g, ' ');
  const fmt = (spec, ctx) => format.makeFormatter(format.resolveStyle(spec, ctx));
  const fr = fmt(null, { lang: 'fr' });
  const en = fmt(null, { lang: 'en' });

  // Automatique : peu de chiffres significatifs, séparateurs de la LANGUE (le bug de l'audit : 600,688.2299999992)
  assert.strictEqual(n(fr.format(3266234.27)), '3 266 234', 'fr : entier dès 1 000');
  assert.strictEqual(n(fr.format(600688.2299999992)), '600 688', 'le bruit de flottant ne ressort plus');
  assert.strictEqual(n(fr.format(1542980.8799999997)), '1 542 981');
  assert.strictEqual(n(en.format(3266234.27)), '3,266,234', 'en : virgule des milliers');
  assert.strictEqual(fr.format(123.456), '123,5', '1 décimale de 100 à 1 000');
  assert.strictEqual(fr.format(20.84), '20,84', '2 décimales de 0,1 à 100');
  assert.strictEqual(fr.format(0.20472679998130852), '0,2');
  assert.strictEqual(en.format(0.20472679998130852), '0.2');
  assert.strictEqual(fr.format(0.000618558008651509), '0,00062', 'une valeur minuscule ne devient PAS « 0 » (KPI/axes de l\'audit)');
  assert.strictEqual(fr.format(0), '0');
  assert.strictEqual(n(fr.format(-1234.5)), '-1 235');
  assert.strictEqual(fr.format(-0.4), '-0,4');
  assert.strictEqual(fr.format(-0.00001), '-0,00001');
  assert.strictEqual(fmt({ mode: 'custom', decimals: 0 }, { lang: 'fr' }).format(-0.3), '0', 'jamais un « -0 » : arrondi à zéro, le signe disparaît');
  assert.strictEqual(fr.format(null), '');
  assert.strictEqual(fr.format(NaN), '');
  assert.strictEqual(fr.format(undefined), '');
  assert.strictEqual(n(fr.format('12.5')), '12,5', 'une chaîne numérique est acceptée');
  assert.strictEqual(n(fr.format(10n ** 13n)), '10 Bn', 'BigInt de DuckDB (au-delà de 5 000 lignes), compact dès 10^12');
  assert.strictEqual(n(fr.format(5430335971750.53)), '5,43 Bn');
  assert.strictEqual(n(en.format(5430335971750.53)), '5.43T');
  assert.strictEqual(n(fr.format(7n)), '7', 'BigInt courant');
  console.log('OK js/format.js — Automatique : entiers dès 1 000, 2 chiffres significatifs sous 0,1, fr/en, BigInt, null');

  // Libellés d'axe : compacts, jamais deux graduations voisines identiques (« 0,1 » « 0,1 » sur 0,05 d'écart)
  assert.strictEqual(n(fr.axis(1500000)), '1,5 M');
  assert.strictEqual(n(fr.axis(825500)), '826 k');
  assert.strictEqual(n(en.axis(1500000)), '1.5M');
  assert.strictEqual(n(en.axis(1.5e12)), '1.5T');
  assert.strictEqual(n(fr.axis(0)), '0');
  assert.strictEqual(fr.axis(0.05), '0,05');
  const ticks = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map(fr.axis);
  assert.strictEqual(new Set(ticks).size, ticks.length, 'graduations 0 -> 0,3 par 0,05 : toutes distinctes : ' + ticks.join(' '));
  const tiny = [0, 0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006, 0.0007].map(fr.axis);
  assert.strictEqual(new Set(tiny).size, tiny.length, 'graduations minuscules toutes distinctes (étaient toutes « 0 ») : ' + tiny.join(' '));
  assert.strictEqual(n(fr.axis(-2000000)), '-2 M');
  assert.strictEqual(fr.axis(null), '');
  console.log('OK js/format.js — axis : compact, 3 chiffres significatifs, graduations distinctes');

  // Variation en % : séparateurs de la langue (le KPI affichait « 1.5% » même en français)
  assert.strictEqual(n(fr.percent(1.5)), '1,5 %');
  assert.strictEqual(n(en.percent(12.84)), '12.8%');
  assert.strictEqual(n(fr.percent(0)), '0 %');
  assert.strictEqual(fr.percent(null), '');
  console.log('OK js/format.js — percent : séparateurs de la langue');

  // Personnalisé : décimales FIXES, notation complète ou compacte
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 2, notation: 'standard' }, { lang: 'fr' }).format(3266234.27)), '3 266 234,27');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 2 }, { lang: 'fr' }).format(5)), '5,00', 'décimales fixes : zéros conservés');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 0 }, { lang: 'fr' }).format(3266234.27)), '3 266 234');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 6 }, { lang: 'fr' }).format(600688.2299999992)), '600 688,230000', 'le bruit de flottant ne ressort pas non plus en décimales fixes');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 'auto', notation: 'compact' }, { lang: 'fr' }).format(3266234.27)), '3,27 M');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 1, notation: 'compact' }, { lang: 'en' }).format(3266234.27)), '3.3M');
  assert.strictEqual(n(fmt({ mode: 'custom', decimals: 'auto', notation: 'standard' }, { lang: 'fr' }).format(5430335971750.53)), '5 430 335 971 751', 'Personnalisé standard ne bascule jamais en compact tout seul');
  assert.deepStrictEqual(format.normalizeSpec({ mode: 'custom', decimals: 9 }), { mode: 'custom', decimals: 'auto', notation: 'standard' }, 'décimales hors plage -> auto');
  assert.deepStrictEqual(format.normalizeSpec({ mode: 'nimportequoi' }), { mode: 'auto' });
  assert.deepStrictEqual(format.normalizeSpec(null), { mode: 'auto' });
  assert.deepStrictEqual(format.normalizeSpec({ mode: 'column' }), { mode: 'column' });
  console.log('OK js/format.js — Personnalisé : décimales fixes, notation, spécifications invalides ramenées à Automatique');

  // Comme dans la colonne : widgetOptions Grist + réglages du document
  const col = (type, widgetOptions) => ({ type, widgetOptions: typeof widgetOptions === 'string' ? widgetOptions : JSON.stringify(widgetOptions) });
  const doc = { locale: 'fr-FR', currency: 'EUR' };
  const colFmt = (column, docSettings, lang) => fmt({ mode: 'column' }, { lang: lang || 'fr', column, docSettings });
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'currency', currency: 'EUR', decimals: 2 }), doc).format(3266234.27)), '3 266 234,27 €', 'devise + 2 décimales');
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'currency' }), doc).format(1234.5)), '1 234,50 €', 'devise du DOCUMENT quand la colonne n\'en nomme pas');
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'currency', currency: 'USD' }), { locale: 'en-US' }).format(1234.5)), '$1,234.50', 'devise de la colonne, locale du document');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 2, maxDecimals: 2 }), doc).format(600688.2299999992)), '600 688,23', 'décimales de la colonne');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 2, maxDecimals: 2 }), doc).format(5)), '5,00', 'minimum de décimales de la colonne');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 0, maxDecimals: 0 }), doc).format(3266234.27)), '3 266 234');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 2, maxDecimals: 2 }), { locale: 'en-US' }).format(3266234.27)), '3,266,234.27', 'séparateurs de la locale du DOCUMENT, pas de la langue de l\'interface');
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'percent' }), doc).format(0.2147)), '21,5 %', 'mode pourcentage (fraction x 100)');
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'percent', decimals: 0, maxDecimals: 0 }), doc).format(0.2147)), '21 %');
  assert.strictEqual(n(colFmt(col('Numeric', { numMode: 'scientific' }), doc).format(1234567)), '1,235E6');
  assert.strictEqual(n(colFmt(col('Int', { numSign: 'parens', decimals: 0, maxDecimals: 0 }), doc).format(-1234.5)), '(1 235)', 'négatifs entre parenthèses');
  assert.strictEqual(n(colFmt(col('Int', { numSign: 'parens', decimals: 0, maxDecimals: 0 }), doc).format(1234.5)), '1 235');
  // Sans aucune option de décimales : rien à reprendre, rendu Automatique (jamais les 10 décimales par défaut de Grist)
  assert.strictEqual(n(colFmt(col('Numeric', ''), doc).format(600688.2299999992)), '600 688');
  assert.strictEqual(n(colFmt(col('Numeric', '{}'), doc).format(0.000618558)), '0,00062');
  assert.strictEqual(n(colFmt(col('Numeric', 'pas du json'), doc).format(20.84)), '20,84', 'JSON invalide -> aucune option');
  assert.strictEqual(n(colFmt(null, doc).format(3266234.27)), '3 266 234', 'colonne inconnue -> Automatique');
  assert.strictEqual(n(colFmt(col('Text', { numMode: 'currency' }), doc).format(3266234.27)), '3 266 234', 'colonne non numérique -> Automatique');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 2, maxDecimals: 2 }), { locale: 'xx-pas-une-locale-valide-!!' }).format(1234.5)), '1 234,50', 'locale de document inutilisable -> langue de l\'interface');
  assert.strictEqual(n(colFmt(col('Numeric', { decimals: 2, maxDecimals: 2 }), null, 'en').format(1234.5)), '1,234.50', 'pas de réglages de document -> langue de l\'interface');
  // valeurs lues telles que Grist les range
  assert.deepStrictEqual(format.parseWidgetOptions('{"numMode":"currency"}'), { numMode: 'currency' });
  assert.deepStrictEqual(format.parseWidgetOptions('[1,2]'), {}, 'un tableau JSON n\'est pas un objet d\'options');
  assert.deepStrictEqual(format.parseWidgetOptions(undefined), {});
  assert.deepStrictEqual(format.parseDocSettings('{"locale":"fr-FR","currency":"EUR","engine":"python3"}'), { locale: 'fr-FR', currency: 'EUR' });
  assert.strictEqual(format.parseDocSettings(''), null);
  assert.strictEqual(format.parseDocSettings('{"engine":"python3"}'), null);
  console.log('OK js/format.js — Comme dans la colonne : devise, décimales, %, scientifique, parenthèses, locale du document, replis');

  // forTile : registre des colonnes, comptage, mise en cache
  format.setColumnInfo({ Montant: col('Numeric', { numMode: 'currency', currency: 'EUR', decimals: 2 }), Quantite: col('Int', { decimals: 0, maxDecimals: 0 }) }, doc);
  const tileCol = { measure: 'Montant', aggFn: 'sum', numberFormat: { mode: 'column' } };
  assert.strictEqual(n(format.forTile(tileCol, 'Montant', 'fr').format(3266234.27)), '3 266 234,27 €');
  assert.strictEqual(n(format.forTile({ ...tileCol, aggFn: 'count' }, 'Montant', 'fr').format(96)), '96', 'un comptage n\'est jamais formaté comme la colonne (pas « 96,00 € »)');
  assert.strictEqual(n(format.forTile({ measure: 'Montant', aggFn: 'sum' }, 'Montant', 'fr').format(3266234.27)), '3 266 234', 'sans réglage de tuile : Automatique, la colonne ne compte pas');
  assert.strictEqual(n(format.forTile(tileCol, 'Inconnue', 'fr').format(3266234.27)), '3 266 234', 'colonne absente du registre -> Automatique');
  assert.strictEqual(n(format.forTile(tileCol, 'Quantite', 'fr').format(20.84)), '21', 'chaque colonne a SON format (radar « colonnes », nuage de points)');
  assert.strictEqual(format.forTile(tileCol, 'Montant', 'fr'), format.forTile(tileCol, 'Montant', 'fr'), 'formateur mis en cache');
  const before = format.forTile(tileCol, 'Montant', 'fr');
  format.setColumnInfo({ Montant: col('Numeric', { decimals: 0, maxDecimals: 0 }) }, doc);
  assert.notStrictEqual(format.forTile(tileCol, 'Montant', 'fr'), before, 'le cache est vidé quand les colonnes changent');
  assert.strictEqual(n(format.forTile(tileCol, 'Montant', 'fr').format(3266234.27)), '3 266 234');
  format.setColumnInfo({}, null);
  assert.strictEqual(n(format.forTile(tileCol, 'Montant', 'fr').format(3266234.27)), '3 266 234', 'registre vidé (widget hors Grist) -> Automatique');
  console.log('OK js/format.js — forTile : registre, comptage, cache, repli sans registre');

  // câblage : plus aucun format en dur dans le rendu ; le module est chargé avant charts.js
  {
    const fs2 = require('fs');
    const path2 = require('path');
    const charts = fs2.readFileSync(path2.join(__dirname, '..', 'js', 'charts.js'), 'utf8');
    assert.ok(!/Intl\.NumberFormat|toFixed\(/.test(charts), 'js/charts.js ne formate plus aucun nombre lui-même');
    assert.ok(!/formatNumber|formatCompactNumber|formatPercent/.test(charts), 'anciennes fonctions de format retirées');
    const index = fs2.readFileSync(path2.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(index.indexOf('js/format.js') > index.indexOf('js/data.js') && index.indexOf('js/format.js') < index.indexOf('js/charts.js'), 'format.js chargé après data.js et avant charts.js');
    console.log('OK js/charts.js — aucun format en dur, format.js chargé avant charts.js');
  }
}

// js/format.js : échelle et géométrie de la jauge (audit de lisibilité du 18/11/2026, lot 2)
{
  const format = require('../js/format.js');
  // borne haute « ronde » : le libellé de fin d'échelle se lit
  assert.strictEqual(format.niceCeil(3919480), 4000000);
  assert.strictEqual(format.niceCeil(0.252), 0.3);
  assert.strictEqual(format.niceCeil(1), 1);
  assert.strictEqual(format.niceCeil(1.01), 1.2);
  assert.strictEqual(format.niceCeil(7.9), 8);
  assert.strictEqual(format.niceCeil(9), 10);
  assert.strictEqual(format.niceCeil(100), 100);
  assert.strictEqual(format.niceCeil(6.5e12), 8e12);
  assert.strictEqual(format.niceCeil(0), 1);
  assert.strictEqual(format.niceCeil(-5), 1);
  assert.strictEqual(format.niceCeil(null), 1);
  for (const x of [0.00037, 0.8, 1.3, 17, 250, 999, 12345, 3919480, 1e9 + 1]) assert.ok(format.niceCeil(x) >= x, 'niceCeil >= x pour ' + x);
  // géométrie : l'arc, les bornes et la valeur tiennent dans la zone, à toutes les tailles de tuile
  for (const [w, h] of [[240, 150], [270, 160], [316, 162], [420, 200], [600, 400], [1200, 500], [900, 640]]) {
    const L = format.gaugeLayout(w, h);
    assert.ok(L.cx - L.r >= 10 && L.cx + L.r <= w - 10, `${w}x${h} : l'arc tient en largeur`);
    assert.ok(L.cy - L.r >= 0, `${w}x${h} : l'arc tient en haut`);
    assert.ok(L.cy + L.below <= h + 0.001, `${w}x${h} : bornes et valeur tiennent en bas (cy ${L.cy}, place ${L.below}, h ${h})`);
    assert.ok(L.valueMaxWidth <= w && L.valueMaxWidth > 0, `${w}x${h} : la valeur tient en largeur`);
    assert.ok(L.ringW >= 8 && L.labelFont >= 10 && L.valueMaxFont >= 14, `${w}x${h} : tailles lisibles`);
  }
  // une zone plus haute ou plus large donne un arc plus grand, jamais l'inverse
  assert.ok(format.gaugeLayout(600, 400).r > format.gaugeLayout(316, 162).r);
  // ajustement de la valeur : la plus grande police qui tient, jamais sous le plancher
  const measure = (text, px) => text.length * px * 0.6;
  assert.strictEqual(format.fitFont('96', 100, 40, 11, measure), 40, 'court : police maximale');
  const fitted = format.fitFont('5 430 335 971 750,50', 160, 40, 11, measure);
  assert.ok(fitted < 40 && measure('5 430 335 971 750,50', fitted) <= 160, 'long : réduit jusqu\'à tenir (' + fitted + ' px)');
  assert.strictEqual(format.fitFont('5 430 335 971 750,50 5 430 335 971 750,50', 20, 40, 11, measure), 11, 'plancher respecté');
  // graduations intermédiaires (à l'extérieur de l'arc) : des valeurs rondes, jamais aux extrémités, jamais plus que demandé
  assert.deepStrictEqual(format.gaugeTicks(0, 3266234, 4), [1e6, 2e6, 3e6], '0 -> 3,27 M : 1 M, 2 M, 3 M (pas 825,5 k, 1,65 M)');
  assert.deepStrictEqual(format.gaugeTicks(-2e6, 2e6, 3), [-1e6, 0, 1e6], 'jauge négative : -1 M, 0, 1 M');
  assert.deepStrictEqual(format.gaugeTicks(0, 100, 4), [20, 40, 60, 80]);
  assert.deepStrictEqual(format.gaugeTicks(0, 100, 1), [50]);
  assert.deepStrictEqual(format.gaugeTicks(0, 1, 3), [0.25, 0.5, 0.75]);
  assert.deepStrictEqual(format.gaugeTicks(0, 0.0007, 4), [0.0002, 0.0004, 0.0006], 'petites valeurs : pas de bruit de flottant');
  assert.deepStrictEqual(format.gaugeTicks(1990, 2030, 4), [2000, 2010, 2020]);
  assert.deepStrictEqual(format.gaugeTicks(5, 5, 3), [], 'intervalle vide');
  assert.deepStrictEqual(format.gaugeTicks(10, 0, 3), [], 'intervalle inversé');
  assert.deepStrictEqual(format.gaugeTicks(0, 100, 0), [], 'zéro graduation demandée');
  assert.deepStrictEqual(format.gaugeTicks(null, 100, 3), [], 'borne absente');
  for (const [lo, hi] of [[0, 3266234], [-2e6, 2e6], [0, 100], [0, 1], [-7, 13], [0, 0.0007], [1990, 2030], [0, 1e9 + 1], [-5e12, 5e12], [0.3, 0.31]]) {
    for (const cap of [1, 2, 3, 4, 5]) {
      const ticks = format.gaugeTicks(lo, hi, cap);
      assert.ok(ticks.length <= cap, `${lo}..${hi} (${cap}) : pas plus de graduations que demandé (${ticks.length})`);
      for (let i = 0; i < ticks.length; i++) {
        const f = (ticks[i] - lo) / (hi - lo);
        assert.ok(f > 0.08 && f < 0.92, `${lo}..${hi} : ${ticks[i]} loin des extrémités (${f})`);
        if (i) assert.ok(ticks[i] > ticks[i - 1], 'croissantes');
        assert.ok(Number.isFinite(ticks[i]) && !Object.is(ticks[i], -0), 'nombre fini, jamais -0');
      }
      // un pas régulier : des repères à égale distance
      for (let i = 2; i < ticks.length; i++) assert.ok(Math.abs((ticks[i] - ticks[i - 1]) - (ticks[i - 1] - ticks[i - 2])) <= Math.abs(hi - lo) * 1e-9, 'pas régulier');
    }
  }
  assert.strictEqual(format.gaugeTickBudget(30), 0);
  assert.strictEqual(format.gaugeTickBudget(46), 1);
  assert.strictEqual(format.gaugeTickBudget(100), 4);
  assert.strictEqual(format.gaugeTickBudget(400), 5);
  // la place des graduations est réservée AVANT l'arc : les traits et les libellés tiennent dans la zone, à toutes les tailles
  const approxWidth = (text, px) => text.length * px * 0.6; // largeur d'un libellé (estimation, pas de canvas sous Node)
  for (const [w, h] of [[240, 150], [270, 160], [316, 162], [420, 200], [600, 400], [1200, 500], [900, 640]]) {
    const plain = format.gaugeLayout(w, h);
    for (const [lo, hi] of [[0, 3266234], [-2e6, 2e6], [0, 100], [0, 0.0007]]) {
      for (const cap of [1, 3, 5]) {
        const vals = format.gaugeTicks(lo, hi, cap);
        const items = vals.map((v) => ({ text: String(v), frac: (v - lo) / (hi - lo) }));
        const L = format.gaugeLayout(w, h, items.map((it) => ({ frac: it.frac, w10: approxWidth(it.text, 10) })));
        assert.ok(L.r <= plain.r + 1e-9, `${w}x${h} : les graduations ne font jamais grandir l'arc`);
        assert.ok(L.cx - L.r >= 10 && L.cx + L.r <= w - 10, `${w}x${h} : l'arc tient en largeur`);
        assert.ok(L.cy + L.below <= h + 0.001, `${w}x${h} : bornes et valeur tiennent en bas`);
        if (L.overflow) continue; // trop petit : l'appelant renonce aux graduations (testé plus bas)
        for (const it of items) {
          const P = format.gaugeTickPlacement(L, it.frac);
          const tw = approxWidth(it.text, L.tick.font);
          const th = L.tick.font * 1.25;
          const x0 = P.align === 'left' ? P.x : P.align === 'right' ? P.x - tw : P.x - tw / 2;
          const x1 = x0 + tw;
          const y0 = P.valign === 'bottom' ? P.y - th : P.y - th / 2;
          const y1 = y0 + th;
          const where = `${w}x${h} ${lo}..${hi} tick ${it.text}`;
          assert.ok(x0 >= 0 && x1 <= w && y0 >= 0 && y1 <= h, `${where} : libellé dans la zone (${x0.toFixed(1)}..${x1.toFixed(1)} x ${y0.toFixed(1)}..${y1.toFixed(1)} / ${w}x${h})`);
          assert.ok(P.y2 >= 0 && P.y1 <= L.cy, `${where} : trait au-dessus de la ligne de base`);
          // le trait est radial et commence hors de l'arc, le libellé plus loin encore
          const d1 = Math.hypot(P.x1 - L.cx, P.y1 - L.cy);
          const d2 = Math.hypot(P.x2 - L.cx, P.y2 - L.cy);
          const dl = Math.hypot(P.x - L.cx, P.y - L.cy);
          assert.ok(d1 > L.r && d2 > d1 && dl > d2, `${where} : trait puis libellé, vers l'extérieur de l'arc`);
          // aucun libellé ne touche la valeur ni les bornes (sous la ligne de base)
          assert.ok(y1 <= L.cy, `${where} : libellé au-dessus de la ligne de base (bornes et valeur en dessous)`);
        }
        // deux libellés voisins ne se recouvrent pas
        for (let i = 1; i < items.length; i++) {
          const a = format.gaugeTickPlacement(L, items[i - 1].frac);
          const b = format.gaugeTickPlacement(L, items[i].frac);
          const wa = approxWidth(items[i - 1].text, L.tick.font);
          const wb = approxWidth(items[i].text, L.tick.font);
          const hh = L.tick.font * 1.25;
          const ax0 = a.align === 'left' ? a.x : a.align === 'right' ? a.x - wa : a.x - wa / 2;
          const bx0 = b.align === 'left' ? b.x : b.align === 'right' ? b.x - wb : b.x - wb / 2;
          const ay0 = a.valign === 'bottom' ? a.y - hh : a.y - hh / 2;
          const by0 = b.valign === 'bottom' ? b.y - hh : b.y - hh / 2;
          const overlap = ax0 < bx0 + wb && bx0 < ax0 + wa && ay0 < by0 + hh && by0 < ay0 + hh;
          assert.ok(!overlap, `${w}x${h} ${lo}..${hi} : « ${items[i - 1].text} » et « ${items[i].text} » ne se recouvrent pas`);
        }
      }
    }
  }
  // une échelle d'ENTIERS de moins de 5 chiffres (années, colonne entière) n'est jamais compactée ; au-delà, le compact reste
  {
    const fr = format.forTile({}, 'x', 'fr');
    const en = format.forTile({}, 'x', 'en');
    const n = (x) => x.replace(/[\u202f\u00a0]/g, ' ');
    assert.ok(format.plainScale(1990, 2030) && format.plainScale(0, 3000) && format.plainScale(-2000, 2000) && format.plainScale(0, 9999), 'entiers < 10 000 : échelle en toutes lettres');
    assert.ok(!format.plainScale(0, 10000) && !format.plainScale(0, 3266234) && !format.plainScale(-20000, 5), 'dès 5 chiffres : compact');
    assert.ok(!format.plainScale(0, 0.0007) && !format.plainScale(0, 2500.5) && !format.plainScale(null, 5) && !format.plainScale(5, undefined) && !format.plainScale('a', 5), 'bouts non entiers ou absents : compact');
    const years = fr.forScale(1990, 2030);
    assert.deepStrictEqual([1990, 2000, 2010, 2020, 2030].map(years.axis), ['1990', '2000', '2010', '2020', '2030'], 'années : « 2010 », jamais « 2,01 k » ni « 2 010 »');
    assert.strictEqual(years.format(2010), '2010');
    assert.strictEqual(years.format(2010.4), '2010', 'valeur non entière >= 1000 : sans séparateur de milliers non plus');
    assert.strictEqual(years.format(12.345), n(fr.format(12.345)), 'sous 1000 : le format habituel');
    assert.deepStrictEqual([0, 1000, 2500, 3000].map(fr.forScale(0, 3000).axis), ['0', '1000', '2500', '3000'], 'colonne entière : pas de « 1 k »');
    assert.deepStrictEqual([-2000, 0, 1000].map(en.forScale(-2000, 2000).axis), ['-2000', '0', '1000']);
    assert.strictEqual(Object.is(fr.forScale(0, 100).axis(-0), true), false);
    assert.strictEqual(fr.forScale(0, 100).axis(-0), '0', 'jamais « -0 »');
    assert.deepStrictEqual([0, 1e6, 2e6].map(fr.forScale(0, 3266234).axis).map(n), ['0', '1 M', '2 M'], 'grande échelle : compact inchangé');
    assert.strictEqual(n(fr.forScale(0, 3266234).format(3266234)), '3 266 234', 'grande échelle : format inchangé');
    // un non-entier sur une échelle entière garde le compact exact (jamais arrondi à l'entier)
    assert.strictEqual(fr.forScale(0, 100).axis(7.5), fr.axis(7.5));
    assert.strictEqual(fr.forScale(0, 100).axis(null), '');
    // les formats choisis restent les leurs : devise, pourcentage, décimales fixes, parenthèses
    const cur = format.makeFormatter({ locale: 'fr-FR', kind: 'currency', currency: 'EUR', minFD: null, maxFD: null, notation: 'standard', useAuto: false, parens: false });
    assert.strictEqual(n(cur.forScale(0, 5000).format(2500)), n(cur.format(2500)), 'devise : format de la colonne conservé');
    const pct = format.makeFormatter({ locale: 'fr-FR', kind: 'percent', useAuto: true, minFD: 0, maxFD: 0, notation: 'standard', parens: false });
    assert.strictEqual(pct.forScale(0, 1).axis(0.5), pct.axis(0.5), 'pourcentage : inchangé');
    const fixed = format.forTile({ numberFormat: { mode: 'custom', decimals: 2, notation: 'standard' } }, 'x', 'fr');
    assert.strictEqual(n(fixed.forScale(0, 5000).format(2500)), n(fixed.format(2500)), 'décimales choisies : respectées');
    // BigInt de DuckDB
    assert.strictEqual(years.axis(2010n), '2010');
  }
  // sans graduation, la géométrie est exactement celle d'avant (aucune place réservée pour rien)
  for (const [w, h] of [[240, 150], [316, 162], [600, 400]]) {
    const a = format.gaugeLayout(w, h);
    const b = format.gaugeLayout(w, h, []);
    assert.strictEqual(a.r, b.r);
    assert.strictEqual(a.cy, b.cy);
    assert.strictEqual(a.cy, 6 + a.r, 'cy = marge + rayon');
    assert.strictEqual(a.overflow, false);
  }
  // une zone minuscule : les graduations ne tiennent pas, `overflow` le dit (l'appelant les retire)
  assert.strictEqual(format.gaugeLayout(120, 60, [{ frac: 0.5, w10: 30 }]).overflow, true);
  // câblage : la jauge n'a plus de graduations intermédiaires ni d'aiguille sur des libellés ; elle suit le redimensionnement
  const charts = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'charts.js'), 'utf8');
  assert.ok(/F\.gaugeTicks\(g\.min, g\.max, n\)/.test(charts) && /F\.gaugeTickBudget\(base\.r\)/.test(charts) && /F\.gaugeTickPlacement\(L, it\.frac\)/.test(charts), 'graduations calculées, plafonnées par la place, placées à l\'extérieur de l\'arc');
  assert.ok(/g\.fmt\.forScale\(g\.min, g\.max\)/.test(charts) && /scale\.format\(g\.value\)/.test(charts), 'jauge : bornes, graduations et valeur lues sur l\'échelle entière (années jamais compactées)');
  assert.ok(/f\.forScale\(hist\.bins\[0\]\.lo, hist\.bins\[hist\.bins\.length - 1\]\.hi\)/.test(charts), 'histogramme : les bornes de classes forment une échelle');
  assert.ok(/axisLabel: \{ interval: 'auto', width: 84, overflow: 'truncate'/.test(charts), 'histogramme : libellé de classe de largeur fixée (finalizeOption ne le tronque pas à la largeur d\'une barre : « 199… »)');
  assert.ok(/lay\.overflow/.test(charts) && /0\.72 \* base\.r/.test(charts), 'elles disparaissent plutôt que de faire trop rétrécir l\'arc ou de sortir de la tuile');
  assert.ok(/startAngle: 180,\s*endAngle: 0/.test(charts), 'jauge en demi-cercle');
  assert.ok(/axisLabel: \{ show: false \}/.test(charts) && /splitLine: \{ show: false \}/.test(charts), 'plus de graduations dans l\'arc');
  assert.ok(/inst\.__refit/.test(charts) && /instance\.__refit = draw/.test(charts), 'la jauge se redessine à chaque redimensionnement (resizeAll)');
  assert.ok(/container-type: inline-size/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'style.css'), 'utf8')), 'carte KPI : conteneur de requête (valeur ajustée à la largeur)');
  console.log('OK js/format.js — jauge : niceCeil, gaugeLayout (7 tailles de tuile), graduations extérieures (gaugeTicks, placement, 4 plages), échelles entières jamais compactées (plainScale, forScale), fitFont, câblage');
}

// js/format.js : radar avec légende (bug réel n°50, 18/11/2026) — la légende « Élève / Moyenne du groupe » recouvrait le nom de l'axe du haut
{
  const fs = require('fs');
  const path = require('path');
  const format = require('../js/format.js');
  // Toutes les tailles de zone réalistes : tuile normale (283 x 162), étroite, large, agrandie, très haute.
  const sizes = [[283, 162], [298, 162], [240, 150], [330, 190], [316, 224], [600, 400], [938, 422], [500, 800], [200, 160]];
  for (const [w, h] of sizes) {
    const L = format.radarLayout(w, h, true);
    const top = L.cy - L.r - L.gap - L.nameH; // haut du nom de l'axe du haut
    const bottom = L.cy + L.r + L.gap + L.nameH; // bas du nom de l'axe du bas
    assert.ok(top >= L.legendH - 0.001, `${w}x${h} : le nom de l'axe du haut commence sous la légende (${top} >= ${L.legendH})`);
    assert.ok(bottom <= h + 0.001, `${w}x${h} : le nom de l'axe du bas reste dans la zone (${bottom} <= ${h})`);
    assert.strictEqual(L.cx, w / 2, `${w}x${h} : centré horizontalement`);
    assert.ok(L.r <= 0.62 * Math.min(w, h) / 2 + 1e-9, `${w}x${h} : jamais plus grand que le réglage historique (62 %)`);
    assert.ok(L.r >= 20, `${w}x${h} : un polygone reste lisible`);
  }
  // L'ancienne géométrie (centre à 50 %, rayon 62 %, nom d'axe à 15 px) recouvrait bel et bien la légende dans une tuile de 162 px :
  // c'est ce que ce test aurait vu, et ce qu'il garantit de ne plus revoir.
  const oldTop = 162 / 2 - 0.62 * 162 / 2 - 15 - 16;
  assert.ok(oldTop < format.radarLayout(283, 162, true).legendH, 'avant : le nom de l\'axe du haut (' + oldTop.toFixed(1) + ' px) commençait DANS la bande de la légende');
  // Sans légende : centre à mi-hauteur, rien de réservé ; une tuile plus grande donne un polygone plus grand.
  for (const [w, h] of sizes) {
    const L = format.radarLayout(w, h, false);
    assert.strictEqual(L.legendH, 0);
    assert.strictEqual(L.cy, h / 2, 'sans légende : centré à mi-hauteur');
  }
  assert.ok(format.radarLayout(938, 422, true).r > format.radarLayout(283, 162, true).r, 'la tuile agrandie a un plus grand polygone');
  // Une zone minuscule ne donne jamais un rayon nul ni négatif (le texte déborde alors, mais le polygone existe).
  assert.strictEqual(format.radarLayout(100, 60, true).r, 20);
  // câblage : légende défilante, place réservée par finalizeOption, recalcul au redimensionnement, couleur de légende conservée
  const charts = fs.readFileSync(path.join(__dirname, '..', 'js', 'charts.js'), 'utf8');
  assert.ok(/legend: series\.length > 1\s*\? \{ top: 2, type: 'scroll'/.test(charts), 'la légende du radar est compacte et défilante (deux noms longs ne passent pas à la ligne)');
  assert.ok(/GristBI\.format\.radarLayout\(w, h, true\)/.test(charts) && /axisNameGap: L\.gap/.test(charts), 'finalizeOption place le polygone dans la place laissée par la légende');
  assert.ok(/instance\.__refit = placed \?/.test(charts), 'centre et rayon en pixels : recalculés par resizeAll (tuile agrandie)');
  assert.ok(/option\.legend = Object\.assign\(\{\}, option\.legend, \{ textStyle: Object\.assign\(\{ color: th\.secondary \}, option\.legend\.textStyle\) \}\)/.test(charts), 'une légende qui règle sa police garde la couleur du thème');
  console.log('OK js/format.js — radar avec légende : radarLayout (9 tailles de zone, ancienne géométrie qui se chevauchait), câblage');
}

// js/format.js + js/charts.js : noms d'axe d'un radar qui sortent de la tuile (bug réel n°53, 18/11/2026) — sur les captures du forum, « Montre Connectée »
// (axe de gauche) avait sa première lettre coupée par le bord de la tuile : l'ancienne règle (un tiers de la largeur) ne tenait pas compte de la place
// réelle entre le polygone et le bord.
{
  const fs = require('fs');
  const path = require('path');
  const format = require('../js/format.js');
  // Estimation de la largeur d'un nom (comme un canvas de 12 px, ~0,56 em par signe) : suffisante pour comparer à la place disponible.
  const textW = (n) => n * 12 * 0.56;
  const sizes = [[283, 162], [330, 190], [240, 150], [316, 224], [600, 400], [938, 422], [200, 160]];
  for (const withLegend of [false, true]) {
    for (const [w, h] of sizes) {
      for (const count of [3, 4, 5, 8, 12]) {
        for (let i = 0; i < count; i += 1) {
          const room = format.radarNameRoom(w, h, withLegend, i, count);
          assert.ok(room >= 24 && room <= w, `${w}x${h} n=${count} i=${i} : place bornée (${room})`);
          // Le sommet de ce nom ne sort jamais de la tuile : un nom de côté tient entre le polygone et le bord.
          const L = format.radarLayout(w, h, withLegend);
          const r = withLegend ? L.r : 0.62 * Math.min(w, h) / 2;
          const gap = withLegend ? L.gap : 15;
          const s = Math.abs(Math.sin((2 * Math.PI * i) / count));
          if (s >= 0.1) assert.ok(r * s + gap * s + room <= w / 2 + 1e-6, `${w}x${h} n=${count} i=${i} : le nom, posé à côté de son sommet, reste dans la tuile`);
        }
      }
    }
  }
  // Le cas des captures : tuile de 330 x 190, 8 axes, sans légende. Le nom de l'axe de gauche (i = 6) n'a que la place entre le polygone et le bord.
  const left = format.radarNameRoom(330, 190, false, 6, 8);
  const old = Math.floor(330 * 0.34 / 6.8) * 6.8; // largeur permise par l'ancienne règle (16 signes)
  assert.ok(left < old, 'avant : la règle d\'un tiers laissait ' + old.toFixed(0) + ' px à un nom qui n\'en a que ' + left);
  assert.ok(left < textW('Montre Connectée'.length), '« Montre Connectée » est donc tronqué (au lieu de sortir de la tuile)');
  // Le nom du haut est centré : il a presque toute la largeur ; celui d'un côté a moins que celui du haut.
  assert.ok(format.radarNameRoom(330, 190, false, 0, 8) > format.radarNameRoom(330, 190, false, 2, 8), 'l\'axe du haut a plus de place que celui du côté');
  // Symétrie : l'axe de droite et celui de gauche ont la même place.
  assert.strictEqual(format.radarNameRoom(330, 190, false, 2, 8), format.radarNameRoom(330, 190, false, 6, 8));
  // Une tuile agrandie donne plus de place.
  assert.ok(format.radarNameRoom(938, 422, true, 2, 8) > format.radarNameRoom(283, 162, true, 2, 8));
  // câblage : le formatter du nom d'axe lit la taille de l'instance à chaque appel (agrandissement) et mesure le texte
  const charts = fs.readFileSync(path.join(__dirname, '..', 'js', 'charts.js'), 'utf8');
  const fmtSrc = charts.slice(charts.indexOf('formatter: (name) => {\n            const text = String(name == null'), charts.indexOf('axisLine: Object.assign({ lineStyle: { color: th.grid } }, option.radar.axisLine)'));
  assert.ok(/GristBI\.format\.radarNameRoom\(w, h, !!option\.legend/.test(fmtSrc) && /instance\.getWidth\(\)/.test(fmtSrc) && /measureText\(/.test(fmtSrc), 'le nom d\'axe est coupé à la place réelle, mesurée en pixels');
  assert.ok(!/Math\.floor\(\(width \|\| 330\) \* 0\.34/.test(fmtSrc.slice(0, fmtSrc.indexOf('if (!w || !h')) ), 'la règle d\'un tiers de la largeur n\'est plus la règle principale');
  console.log('OK js/format.js — radarNameRoom : place d\'un nom d\'axe de radar (7 tailles, avec/sans légende, 3 à 12 axes), ancien cas « Montre Connectée », câblage');
}

// js/format.js + panneau : réglage « Format des nombres » par tuile (audit de lisibilité, lot 3, 18/11/2026)
{
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const format = require('../js/format.js');

  // types concernés : ceux qui affichent un nombre ; pas de réglage pour un type inconnu ni null
  for (const type of ['kpi', 'gauge', 'bar', 'line', 'pie', 'funnel', 'treemap', 'waterfall', 'radar', 'scatter', 'pivot', 'wordcloud', 'table', 'progress', 'combo', 'histogram', 'heatmap', 'box', 'sankey', 'calendar', 'sunburst']) {
    assert.strictEqual(data.supportsNumberFormat({ type }), true, type);
  }
  assert.strictEqual(data.supportsNumberFormat({ type: 'text' }), false, 'la tuile Texte ne montre aucun nombre');
  assert.strictEqual(data.supportsNumberFormat({ type: 'inconnu' }), false);
  assert.strictEqual(data.supportsNumberFormat(null), false);
  assert.deepStrictEqual(data.NUMBER_FORMAT_TILE_TYPES.filter((ty) => !['kpi', 'gauge', 'bar', 'line', 'pie', 'funnel', 'treemap', 'waterfall', 'radar', 'scatter', 'pivot', 'wordcloud', 'table', 'progress', 'combo', 'histogram', 'heatmap', 'box', 'sankey', 'calendar', 'sunburst'].includes(ty)), []);

  // verdict de « Comme dans la colonne » : sert l'explication affichée sous le réglage
  format.setColumnInfo({
    Montant: { type: 'Numeric', widgetOptions: JSON.stringify({ numMode: 'currency', currency: 'EUR' }) },
    Qte: { type: 'Int', widgetOptions: '{"decimals":0}' },
    Libre: { type: 'Numeric', widgetOptions: '' },
    Plain: { type: 'Numeric', widgetOptions: '{"numMode":"decimal"}' },
    Nom: { type: 'Text', widgetOptions: '' }
  }, null);
  assert.strictEqual(format.columnModeState({ aggFn: 'sum' }, 'Montant'), 'ok');
  assert.strictEqual(format.columnModeState({ aggFn: 'avg' }, 'Qte'), 'ok');
  assert.strictEqual(format.columnModeState({ aggFn: 'sum' }, 'Libre'), 'none');
  assert.strictEqual(format.columnModeState({ aggFn: 'sum' }, 'Plain'), 'none');
  assert.strictEqual(format.columnModeState({ aggFn: 'sum' }, 'Nom'), 'unknown', 'colonne non numérique');
  assert.strictEqual(format.columnModeState({ aggFn: 'sum' }, 'Absente'), 'unknown', 'colonne inconnue (calculée, fusionnée)');
  assert.strictEqual(format.columnModeState({ aggFn: 'count' }, 'Montant'), 'count', 'un comptage n\'a jamais de format de colonne');
  // et le rendu suit : la même valeur, trois réglages
  const tileBase = { measure: 'Montant', aggFn: 'sum' };
  assert.strictEqual(format.forTile(tileBase, 'Montant', 'fr').format(600688.2299999992), '600\u202f688', 'Automatique : entier dès 1 000 (pas 600688.2299999992)');
  assert.ok(/600\s688,23\s€/.test(format.forTile({ ...tileBase, numberFormat: { mode: 'column' } }, 'Montant', 'fr').format(600688.2299999992).replace(/[\u202f\u00a0]/g, ' ')), 'Comme dans la colonne : euros');
  assert.strictEqual(format.forTile({ ...tileBase, numberFormat: { mode: 'custom', decimals: 2, notation: 'standard' } }, 'Montant', 'fr').format(600688.2299999992), '600\u202f688,23', 'Personnalisé : 2 décimales fixes');
  assert.strictEqual(format.forTile({ ...tileBase, numberFormat: { mode: 'custom', decimals: 1, notation: 'compact' } }, 'Montant', 'fr').format(1542980.88), '1,5\u00a0M', 'Personnalisé : compact, 1 décimale');
  format.setColumnInfo({}, null);

  // câblage du panneau : champ, lecture/écriture du formulaire, chargement des formats à chaque table
  const html = read('index.html');
  for (const id of ['tile-numfmt-field', 'tile-numfmt', 'tile-numfmt-decimals', 'tile-numfmt-compact', 'tile-numfmt-hint']) {
    assert.ok(html.includes(`id="${id}"`), `index.html : #${id}`);
  }
  assert.ok(/<option value="column" data-i18n="tileForm\.numFormat\.column">/.test(html), 'option « Comme dans la colonne »');
  const main = read('js/main.js');
  assert.ok(/tileData\.numberFormat = GristBI\.data\.supportsNumberFormat\(\{ type \}\) \? numberFormatFromForm\(\) : undefined/.test(main), 'readTileForm écrit numberFormat (undefined = Automatique)');
  assert.ok(/setNumberFormatForm\(tile\.numberFormat\)/.test(main), 'startEditTile relit le réglage de la tuile');
  assert.ok(/setNumberFormatForm\(null\)/.test(main), 'resetTileForm remet Automatique');
  assert.ok(/await refreshColumnFormats\(tableId, isNewTable\)/.test(main), 'switchTable charge les formats de colonne à chaque (re)chargement');
  assert.ok(/GristBI\.format\.setColumnInfo\(\{\}, null\)/.test(main), 'registre vidé au changement de table');
  // chaque clé i18n du réglage existe en fr et en
  const keys = [...html.matchAll(/data-i18n="(tileForm\.numFormat\.[\w.]+)"/g)].map((m) => m[1])
    .concat(['tileForm.numFormat.hint.auto', 'tileForm.numFormat.hint.columnCount', 'tileForm.numFormat.hint.columnUnknown', 'tileForm.numFormat.hint.columnNone', 'tileForm.numFormat.hint.columnOk', 'tileForm.numFormat.hint.columnEach']);
  for (const k of keys) {
    for (const lang of ['fr', 'en']) {
      i18n.setLang(lang);
      assert.notStrictEqual(i18n.t(k, { column: 'X' }), k, `${k} (${lang})`);
    }
  }
  i18n.setLang('fr');
  assert.ok(/X/.test(i18n.t('tileForm.numFormat.hint.columnOk', { column: 'X' })), 'le nom de la colonne est injecté');
  console.log(`OK js/format.js — réglage « Format des nombres » : types concernés, verdict « Comme dans la colonne », rendu des trois modes, câblage du panneau, ${keys.length} clés i18n fr/en`);
}

// js/charts.js + js/main.js : thème des graphiques, infobulles, libellés (audit de lisibilité, lot 4, 18/11/2026)
{
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const charts = read('js/charts.js');
  const main = read('js/main.js');
  const css = read('css/style.css');
  // une seule dernière étape avant setOption, pour les sept chemins ECharts (graphiques, mesures temporelles, histogramme, carte de chaleur, boîte, flux, calendrier)
  assert.strictEqual((charts.match(/finalizeOption\(option, instance\);\s*\n\s*instance\.setOption\(option, true\);/g) || []).length, 8, 'finalizeOption avant chaque setOption d\'option');
  assert.strictEqual((charts.match(/^\s*confineTooltip\(option\);/gm) || []).length, 1, 'confineTooltip n\'est plus appelée qu\'à l\'intérieur de finalizeOption');
  // les jetons du thème viennent de la page, pas de couleurs en dur
  for (const token of ["'--surface'", "'--border-strong'", "'--border'", "'--text-secondary'"]) assert.ok(charts.includes(token), `chartTheme lit ${token}`);
  // infobulle : jetons, 12 px, retour à la ligne ; axes : quadrillage aux jetons ; camembert/entonnoir : pas de contour de texte
  assert.ok(/backgroundColor: th\.surface/.test(charts) && /fontSize: 12/.test(charts) && /white-space: normal/.test(charts), 'infobulle aux jetons, repliée');
  assert.ok(/splitLine: Object\.assign\(\{ lineStyle: \{ color: th\.grid \} \}/.test(charts), 'quadrillage aux jetons');
  assert.ok(/textBorderWidth: 0/.test(charts), 'étiquettes sans contour blanc');
  assert.ok(/label\.overflow = 'truncate'/.test(charts) && /label\.interval = 0/.test(charts), 'libellés de catégorie tronqués à la largeur d\'une catégorie');
  assert.ok(/splitNumber = Math\.max\(2, Math\.min\(6/.test(charts), 'graduations de l\'axe horizontal en nombre raisonnable');
  assert.ok(/overflow: 'truncate',\s*\n\s*fontSize: 11/.test(charts), 'étiquettes d\'entonnoir tronquées, sur deux lignes');
  assert.ok(/canvas\.style\.display = 'none'/.test(charts) && /canvas\.style\.display = ''/.test(charts), 'nuage de mots : le canvas ne cache plus le message « indisponible »');
  // le thème est repris quand il change (système clair/sombre, ambiance de GFS), sans rendre à chaque mutation de <html>
  assert.ok(/watchChartTheme/.test(main) && /prefers-color-scheme: dark/.test(main) && /MutationObserver/.test(main), 'rendu repris au changement de thème');
  assert.ok(/now === last\) return/.test(main), 'comparaison de signature : un --chrome-h réécrit ne relance rien');
  assert.ok(/\.tile-wordcloud-message \{[^}]*padding: 24px 12px/.test(css), 'message du nuage de mots lisible');
  console.log('OK js/charts.js — lot 4 : finalizeOption (thème, infobulle repliée, axes, libellés tronqués, entonnoir, radar), nuage de mots, rendu repris au changement de thème');
}

// Carte KPI sans objectif : la piste d'objectif cachée (`hidden`) ne doit laisser aucune trace (piège n°10, 18/11/2026)
{
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const css = read('css/style.css');
  const charts = read('js/charts.js');
  const main = read('js/main.js');
  // la règle d'auteur `display: flex` bat [hidden] : sans règle explicite, une piste grise vide reste visible sous la carte
  assert.ok(/\.tile-kpi-goal \{[^}]*display: flex/.test(css), 'précondition : .tile-kpi-goal est bien en display: flex');
  assert.ok(/\.tile-kpi-goal\[hidden\] \{\s*display: none;?\s*\}/.test(css), '.tile-kpi-goal[hidden] { display: none } (piège n°10)');
  // le HTML de la carte le crée caché, et renderKpi le cache sans objectif / le montre avec
  assert.ok(/<div class="tile-kpi-goal" hidden>/.test(main), 'la piste d\'objectif naît cachée');
  assert.ok(/if \(!prog\) \{\s*goalEl\.hidden = true;/.test(charts) && /goalEl\.hidden = false;/.test(charts), 'renderKpi cache la piste sans objectif et la montre avec');
  // même règle pour tout autre élément que ce fichier cache avec `hidden` alors que sa feuille lui pose un display : chaque sélecteur
  // `.x { ...display: flex|grid... }` dont le JS bascule `.hidden` doit avoir son `.x[hidden]` (ou un `!important` comme .edit-only)
  for (const sel of ['tile-kpi-spark']) {
    const rule = css.match(new RegExp('\\.' + sel + ' \\{([^}]*)\\}'));
    assert.ok(rule, `règle .${sel} trouvée`);
    assert.ok(!/display:\s*(flex|grid|block|inline)/.test(rule[1]) || new RegExp('\\.' + sel + '\\[hidden\\]').test(css), `.${sel} : [hidden] respecté`);
  }
  console.log('OK carte KPI — piste d\'objectif : [hidden] respecté (piège n°10), cachée sans objectif, visible avec');
}

// Extensions de GFS (consigne 019, 18/11/2026) : « Nuage de mots » grisé, jamais masqué, bibliothèque reçue de GFS (js/extensions.js)
{
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const ext = require('../js/extensions.js');
  const link = (opts) => {
    const o = Object.assign({ hosted: true, libs: {}, ready: Promise.resolve(), installs: [], onExt: null }, opts || {});
    return {
      hosted: o.hosted, ready: o.ready,
      library: (id) => o.libs[id] || null,
      onExtensions: (fn) => { o.onExt = fn; },
      install: async (id) => { o.installs.push(id); if (o.reject) throw new Error('annulé'); return []; },
      _o: o
    };
  };
  const SRC = { src: 'https://gfs.example/vendor/d3-cloud/1.0.0/d3-cloud.js', integrite: 'sha384-AAAA', forme: 'module' };

  // état : seule, hébergée sans l'extension, hébergée avec elle ; id inconnu -> seule (jamais « active » par défaut)
  assert.strictEqual(ext.stateFor(null, 'nuage-de-mots'), 'standalone', 'pas de lien -> seule');
  assert.strictEqual(ext.stateFor(link({ hosted: false }), 'nuage-de-mots'), 'standalone', 'lien non hébergé -> seule');
  assert.strictEqual(ext.stateFor(link(), 'nuage-de-mots'), 'inactive', 'hébergée, bibliothèque non donnée -> pas encore ajoutée');
  assert.strictEqual(ext.stateFor(link({ libs: { 'd3-cloud': SRC } }), 'nuage-de-mots'), 'active', 'hébergée avec la bibliothèque -> active');
  assert.strictEqual(ext.stateFor(link({ libs: { 'd3-cloud': { src: SRC.src } } }), 'nuage-de-mots'), 'inactive', 'sans empreinte la source ne vaut rien');
  assert.strictEqual(ext.stateFor(link({ libs: { 'd3-cloud': SRC } }), 'inconnue'), 'standalone', 'extension inconnue -> jamais active');
  assert.strictEqual(ext.stateFor(link({ libs: { pdfjs: SRC } }), 'mots-cles-pdf'), 'active', 'mots-clés des PDF : même état, bibliothèque pdfjs');

  // module posé par GFS : lu à chaque appel, jamais figé
  class FakeCloud {}
  const scopeWith = { GfsPaquets: { 'd3-cloud': { modules: { 'd3-cloud': { default: FakeCloud } } } } };
  assert.strictEqual(ext.moduleFrom(scopeWith, 'nuage-de-mots').default, FakeCloud, 'GfsPaquets["d3-cloud"].modules["d3-cloud"].default');
  assert.strictEqual(ext.moduleFrom({}, 'nuage-de-mots'), null);
  assert.strictEqual(ext.moduleFrom({ GfsPaquets: { 'd3-cloud': {} } }, 'nuage-de-mots'), null);
  assert.strictEqual(ext.moduleFrom({ GfsPaquets: { pdfjs: { modules: { 'pdfjs-dist/build/pdf.min.mjs': { getDocument() {} } } } } }, 'mots-cles-pdf').getDocument !== undefined, true, 'pdf.js : clé du module de la demande');

  // Rejoué dans la chaîne asynchrone du fichier (`await extensionsAsyncTest()` plus bas) : un faux `document` posé ici ne doit pas
  // rester en place pendant les essais synchrones qui suivent.
  globalThis.extensionsAsyncTest = async () => {
    const savedDoc = global.document;
    const scripts = [];
    global.document = {
      createElement: () => ({}),
      head: { append(script) { scripts.push(script); setTimeout(() => { global.GfsPaquets = scopeWith.GfsPaquets; script.onload(); }, 0); } }
    };
    try {
      // sans lien (hors GFS) : null, rien n'est chargé, aucun abonné réveillé
      let changes = 0;
      const off = ext.onChange(() => { changes++; });
      await ext.attach(Promise.resolve(null));
      assert.strictEqual(await ext.load('nuage-de-mots'), null);
      assert.strictEqual(scripts.length, 0, 'seule : aucune balise <script>');
      assert.strictEqual(changes, 0, 'seule : rien ne change, personne n\'est réveillé');
      assert.strictEqual(await ext.requestInstall('nuage-de-mots'), 'standalone', 'seule : le clic rend « standalone » (l\'appelant montre la fenêtre du grisé)');

      // hébergée sans l'extension : null (non gardé), un clic appelle GfsLink.install, une annulation ne lève rien
      const hosted = link();
      await ext.attach(Promise.resolve(hosted));
      assert.strictEqual(changes, 1, 'hébergée : un réveil quand GFS a répondu');
      assert.strictEqual(ext.stateOf('nuage-de-mots'), 'inactive');
      assert.strictEqual(await ext.load('nuage-de-mots'), null);
      assert.strictEqual(scripts.length, 0, 'sans l\'extension : aucune balise <script>');
      assert.strictEqual(await ext.requestInstall('nuage-de-mots'), 'inactive');
      assert.deepStrictEqual(hosted._o.installs, ['nuage-de-mots'], 'un clic ouvre « Apps et extensions » sur la ligne de l\'extension');
      hosted._o.reject = true;
      assert.strictEqual(await ext.requestInstall('nuage-de-mots'), 'inactive', 'installation annulée : pas d\'exception');

      // l'extension est ajoutée pendant que l'app est ouverte : l'événement réveille l'abonné, la bibliothèque se charge
      hosted._o.libs['d3-cloud'] = SRC;
      hosted._o.onExt(['nuage-de-mots']);
      assert.strictEqual(changes, 2, 'l\'événement `extensions` réveille l\'abonné');
      assert.strictEqual(ext.stateOf('nuage-de-mots'), 'active');
      const mod = await ext.load('nuage-de-mots');
      assert.strictEqual(mod.default, FakeCloud, 'le module posé par le fichier de GFS');
      assert.strictEqual(scripts.length, 1);
      assert.strictEqual(scripts[0].type, 'module', '<script type="module">, jamais import()');
      assert.strictEqual(scripts[0].src, SRC.src);
      assert.strictEqual(scripts[0].integrity, SRC.integrite, 'empreinte de GFS');
      assert.strictEqual(scripts[0].crossOrigin, 'anonymous');
      assert.strictEqual((await ext.load('nuage-de-mots')).default, FakeCloud);
      assert.strictEqual(scripts.length, 1, 'déjà posé : pas de deuxième balise');
      // l'extension est retirée alors que son fichier est déjà en mémoire : la fonction se grise (null), jamais à moitié
      hosted._o.libs = {};
      hosted._o.onExt([]);
      assert.strictEqual(await ext.load('nuage-de-mots'), null, 'retirée : plus de module, même déjà chargé');
      hosted._o.libs['d3-cloud'] = SRC;
      assert.strictEqual((await ext.load('nuage-de-mots')).default, FakeCloud, 'ré-ajoutée : le module déjà posé sert, sans deuxième balise');
      assert.strictEqual(scripts.length, 1);
      // GFS muet : link.ready rejeté ne bloque pas
      await ext.attach(Promise.resolve(link({ ready: Promise.reject(new Error('muet')) })));
      assert.strictEqual(ext.stateOf('nuage-de-mots'), 'inactive');
      off();
    } finally {
      global.document = savedDoc;
      delete global.GfsPaquets;
    }

    // câblage : le type reste proposé (grisé), plus aucun import map ni import() pour d3-cloud
    const main = read('js/main.js');
    const charts = read('js/charts.js');
    const html = read('index.html');
    const css = read('css/style.css');
    assert.ok(/'wordcloud'/.test(main.match(/const TYPE_CARDS = \[[^\]]*\]/)[0]), 'TYPE_CARDS garde wordcloud');
    assert.ok(!/TYPE_CARDS\.filter\(/.test(main), 'aucune carte n\'est retirée : grisée, jamais masquée');
    assert.ok(/const TYPE_EXTENSION = \{ wordcloud: 'nuage-de-mots' \}/.test(main), 'le type nuage de mots dépend de l\'extension nuage-de-mots');
    assert.ok(/aria-disabled/.test(main) && /type-card-locked/.test(main) && /\.type-card-locked/.test(css), 'carte grisée : aria-disabled + classe + règle CSS');
    assert.ok(/function chooseType\(type\) \{\s*const extensionId = TYPE_EXTENSION\[type\];\s*if \(extensionId && GristBI\.extensions\.stateOf\(extensionId\) !== 'active'\) \{ requestExtension/.test(main), 'un type grisé ne se choisit pas : il appelle requestExtension');
    assert.ok(/GristBI\.extensions\.attach\(gfsLinkReady\)/.test(main) && /GristBI\.extensions\.onChange\(/.test(main), 'main.js donne le lien à js/extensions.js et repeint à chaque changement');
    assert.ok(/dialogs\.notice\(\{[^}]*ext\.standalone\.title/.test(main.replace(/\s+/g, ' ')), 'seule : la fenêtre du grisé');
    assert.ok(!/import\('d3-cloud'\)|importMapHas|isWordCloudAvailable/.test(charts + main), 'plus d\'import() nu ni de lecture de l\'importmap');
    assert.ok(/GristBI\.extensions\.load\('nuage-de-mots'\)/.test(charts), 'charts.js reçoit d3-cloud de js/extensions.js');
    assert.ok(/<option value="wordcloud"/.test(html), 'le <select> garde l\'option (relecture d\'une tuile enregistrée)');
    const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
    assert.ok(!('d3-cloud' in map.imports) && !('pdfjs-dist' in map.imports), 'l\'import map ne nomme aucune bibliothèque d\'extension (règle 9 du guide)');
    assert.ok(html.indexOf('js/extensions.js') > html.indexOf('js/data.js') && html.indexOf('js/extensions.js') < html.indexOf('js/charts.js'), 'js/extensions.js chargé entre data.js et charts.js');
    assert.ok(!/https?:\/\//.test(read('js/extensions.js').replace(/\/\*[\s\S]*?\*\//, '')), 'aucune adresse en dur dans js/extensions.js');
    console.log('OK extensions de GFS — états seule/pas encore/active, module de GfsPaquets, <script type="module"> avec empreinte, événement `extensions`, clic -> GfsLink.install ou fenêtre du grisé, carte grisée jamais masquée');
  };
}

// Assistant de démarrage : un montant passe avant un prix unitaire (18/11/2026, constaté sur la table de démo où PrixUnitaire précédait Montant)
{
  // le nom, coupé en mots (camelCase, `_`, espaces, accents), décide ce qui est un prix par unité
  for (const name of ['Prix', 'PrixUnitaire', 'Prix_unitaire', 'prix unitaire', 'unit_price', 'UnitPrice', 'Price', 'Tarif', 'PU', 'Prix HT', 'Prix de vente', 'Sales price', 'Coût unitaire', 'UnitCost']) {
    assert.strictEqual(advice.isUnitPriceName(name), true, name + ' est un prix unitaire');
  }
  for (const name of ['Montant', 'Total', 'CA', 'Quantité', 'Unités vendues', 'Prix total', 'PrixTotal', 'Prix de vente total', 'Montant HT', 'Coût', 'Note', 'Priorité', 'Puissance', 'Prime', 'Surprise', '', null, undefined, 42]) {
    assert.strictEqual(advice.isUnitPriceName(name), false, String(name) + ' n\'est pas un prix unitaire');
  }
  const regions = ['Nord', 'Sud', 'Est', 'Ouest'];
  const produits = ['A', 'B', 'C', 'D', 'E'];
  const table = (order, over) => {
    const make = Object.assign({
      Region: (i) => regions[i % 4],
      Produit: (i) => produits[i % 5],
      Quantite: (i) => 10 + (i * 7) % 23,
      PrixUnitaire: (i) => 9.5 + (i % 5) * 3.25,
      Montant: (i) => (10 + (i * 7) % 23) * (9.5 + (i % 5) * 3.25)
    }, over || {});
    return Array.from({ length: 60 }, (_, i) => Object.fromEntries([['id', i + 1]].concat(order.map((c) => [c, make[c](i)]))));
  };
  const measureOrder = (order, over) => advice.analyzeColumns(table(order, over)).measures.map((p) => p.id);
  // quel que soit l'ordre des colonnes, le prix passe après le montant
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'PrixUnitaire', 'Montant']), ['Montant', 'PrixUnitaire']);
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'Montant', 'PrixUnitaire']), ['Montant', 'PrixUnitaire']);
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'PrixUnitaire', 'Quantite', 'Montant']), ['Quantite', 'Montant', 'PrixUnitaire']);
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'Quantite', 'PrixUnitaire', 'Montant']), ['Quantite', 'Montant', 'PrixUnitaire']);
  // un montant avec des retours (négatifs) et des cases vides passe encore avant le prix
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'PrixUnitaire', 'Montant'], { Montant: (i) => (i % 7 === 0 ? -50 : 100 + i) }), ['Montant', 'PrixUnitaire']);
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'PrixUnitaire', 'Montant'], { Montant: (i) => (i % 10 === 0 ? '' : 100.5 + i * 1.7) }), ['Montant', 'PrixUnitaire']);
  // « Prix total » est un montant : il garde son rang d'origine (colonne d'avant)
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'Prix total', 'Prix unitaire'], { 'Prix total': (i) => 100.5 + i * 3.1, 'Prix unitaire': (i) => 9.5 + (i % 5) }), ['Prix total', 'Prix unitaire']);
  assert.deepStrictEqual(measureOrder(['Region', 'Produit', 'Prix unitaire', 'Prix total'], { 'Prix total': (i) => 100.5 + i * 3.1, 'Prix unitaire': (i) => 9.5 + (i % 5) }), ['Prix total', 'Prix unitaire']);
  // les suggestions de l'accueil et le préremplissage du formulaire suivent : le montant, additionné
  for (const order of [['Region', 'Produit', 'PrixUnitaire', 'Montant'], ['Region', 'Produit', 'Quantite', 'PrixUnitaire', 'Montant']]) {
    const rows = table(order);
    const first = order.indexOf('Quantite') === -1 ? 'Montant' : 'Quantite';
    const sugg = advice.suggestTiles(rows, order);
    assert.ok(sugg.length >= 3);
    sugg.forEach((x) => assert.notStrictEqual(x.tileData.measure, 'PrixUnitaire', x.type + ' : jamais le prix unitaire en vedette'));
    assert.ok(sugg.some((x) => x.tileData.measure === first && x.tileData.aggFn === 'sum'), 'la mesure vedette est additionnée');
    const d = advice.defaultsForType('bar', rows, order);
    assert.strictEqual(d.measure, first);
    assert.strictEqual(d.aggFn, 'sum');
  }
  assert.strictEqual(advice.defaultsForType('kpi', table(['Region', 'Produit', 'PrixUnitaire', 'Montant']), ['Region', 'Produit', 'PrixUnitaire', 'Montant']).measure, 'Montant');
  // un prix qui reste la seule mesure est proposé, mais jamais additionné
  {
    const rows = table(['Region', 'Produit', 'PrixUnitaire']);
    const sugg = advice.suggestTiles(rows, ['Region', 'Produit', 'PrixUnitaire']);
    assert.ok(sugg.length >= 1);
    sugg.forEach((x) => { assert.strictEqual(x.tileData.measure, 'PrixUnitaire'); assert.strictEqual(x.tileData.aggFn, 'avg', x.type + ' : prix moyenné'); });
    assert.strictEqual(advice.defaultsForType('bar', rows, ['Region', 'Produit', 'PrixUnitaire']).aggFn, 'avg');
  }
  // les noms déjà moyennés (note, taux…) et les autres colonnes ne changent pas
  assert.strictEqual(advice.defaultsForType('bar', table(['Region', 'Produit', 'Montant']), ['Region', 'Produit', 'Montant']).aggFn, 'sum');
  console.log('OK assistant de démarrage — un montant passe avant un prix unitaire (ordre des colonnes, négatifs, cases vides), « Prix total » épargné, prix seul moyenné');
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
  await globalThis.extensionsAsyncTest();
  delete globalThis.extensionsAsyncTest;
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
    assert.strictEqual(results.length, 3); // 4 demandés, mais ~14 mots utiles : plafond d'un mot-clé pour cinq mots
    console.log('OK keywords.extractKeywords (phrase multi-mots mieux classée qu\'un mot isolé)');
  }

  // extractKeywords : ex-aequo tranché par l'ordre de première apparition, jamais alphabétique
  // (même prudence que groupByAggregate, voir CLAUDE.md §7 piège n°14).
  {
    const results = keywords.extractKeywords('Zèbre. Chat. Alpaga. Girafe.', { maxKeywords: 10, minWordLength: 1 });
    // 4 mots utiles seulement : le plafond d'un mot-clé pour cinq mots (au moins 3) coupe « girafe »
    assert.deepStrictEqual(results.map((r) => r.phrase), ['zèbre', 'chat', 'alpaga']);
    // un terme qui REVIENT passe devant ceux qui n'apparaissent qu'une fois, et n'est listé qu'une fois
    const repeated = keywords.extractKeywords('Zèbre. Chat. Alpaga. Chat.', { maxKeywords: 10, minWordLength: 1 });
    assert.deepStrictEqual(repeated.map((r) => r.phrase), ['chat', 'zèbre', 'alpaga']);
    console.log('OK keywords.extractKeywords (ex-aequo dans l\'ordre d\'apparition, un terme qui revient passe devant)');
  }

  // extractKeywords : un texte court n'a que quelques termes (essai du 18/11/2026 : un résumé de 40 mots rendait
  // onze mots-clés dont « jour, hausse, personnes, atteignent »). Plafond : un mot-clé pour cinq mots utiles, au
  // moins 3, jamais plus que `maxKeywords` ; un texte long n'est pas touché.
  {
    const resume = 'Suivi sur douze ans d\'une cohorte de 8 400 adultes : un temps passé assis supérieur à dix heures par jour est associé à une hausse du risque cardiovasculaire de 34 %, même chez les personnes qui atteignent les recommandations d\'activité physique.';
    const got = keywords.extractKeywords(resume, { maxKeywords: 15 }).map((k) => k.phrase);
    assert.deepStrictEqual(got, ['douze ans', 'dix heures', 'risque cardiovasculaire', 'activité physique']);
    // les termes gardés sont les mêmes qu'avant le plafond, seule la queue disparaît
    assert.deepStrictEqual(keywords.extractKeywords(resume, { maxKeywords: 2 }).map((k) => k.phrase), ['douze ans', 'dix heures']);
    // un titre court : au moins un terme, trois au plus
    const titre = keywords.extractKeywords('Impact de la sédentarité sur le risque cardiovasculaire chez les adultes', { maxKeywords: 15 });
    assert.ok(titre.length >= 1 && titre.length <= 3, `titre : ${titre.length} mots-clés`);
    // un texte long (plusieurs centaines de mots utiles) donne autant de mots-clés qu'on en demande
    const sentences = [];
    for (let rep = 0; rep < 2; rep++) for (let i = 0; i < 40; i++) sentences.push(`Le concept${i} et le mécanisme${i}.`);
    const longText = sentences.join(' ');
    assert.strictEqual(keywords.extractKeywords(longText, { maxKeywords: 15 }).length, 15);
    // ...et la même demande sur un extrait de trois phrases est plafonnée par le texte, pas par la demande
    assert.ok(keywords.extractKeywords(sentences.slice(0, 3).join(' '), { maxKeywords: 15 }).length <= 3);
    console.log('OK keywords.extractKeywords (texte court : un mot-clé pour cinq mots utiles, texte long inchangé)');
  }

  // extractKeywords : un texte sans aucun mot vide sur une longue plage (ex. liste à puces mal
  // extraite d'un PDF) est découpé en tronçons par maxPhraseWords, pour ne pas laisser une seule
  // "phrase" géante dominer le classement par un degree artificiellement énorme.
  {
    const longRun = Array.from({ length: 20 }, (_, i) => `motunique${i}`).join(' ');
    const phrases = keywords.extractCandidatePhrases(longRun, keywords.buildStopwordSet('fr'), 2);
    assert.strictEqual(phrases[0].length, 20); // pas encore découpé à ce stade (fait par extractKeywords)
    const rake = keywords.rakeKeywords(longRun, { maxKeywords: 50, maxPhraseWords: 5 });
    assert.ok(rake.length > 0 && rake.every((r) => r.phrase.split(' ').length <= 5), 'RAKE d\'origine : découpage en tronçons');
    // extractKeywords : aucune coupe d'une suite sans mot vide n'est un terme tant qu'elle ne revient pas ; si elle revient, elle est plafonnée
    assert.deepStrictEqual(keywords.extractKeywords(longRun, { maxKeywords: 50, maxPhraseWords: 5 }), []);
    const twice = keywords.extractKeywords(longRun + '. ' + longRun, { maxKeywords: 50, maxPhraseWords: 5 });
    assert.ok(twice.length > 0 && twice.every((r) => r.phrase.split(' ').length <= 5));
    console.log('OK keywords.rakeKeywords (découpage défensif) et extractKeywords (plafond de longueur, rien sans répétition)');
  }

  // extractKeywords : la qualité sur des textes réalistes (18/11/2026). RAKE seul classait en tête de longues
  // phrases rares et des demi-phrases (« recherche documentaire efficace doit rester utilisable ») ; on exige
  // maintenant qu'un terme REVIENNE, en 3 mots au plus, et que les verbes courants ne s'y collent pas.
  {
    const FR = `Impact de la sédentarité sur le risque cardiovasculaire chez les adultes.

Résumé. La sédentarité est devenue un facteur de risque majeur pour les maladies cardiovasculaires. Nous avons suivi pendant douze ans une cohorte d'adultes afin d'évaluer l'association entre le temps passé assis et la survenue d'un infarctus du myocarde. Après ajustement sur l'activité physique, l'indice de masse corporelle et le tabagisme, un temps de sédentarité supérieur à dix heures par jour est associé à une augmentation du risque cardiovasculaire.

Introduction. Les maladies cardiovasculaires restent la première cause de mortalité. Si l'activité physique modérée à vigoureuse protège le cœur, la sédentarité constitue un facteur de risque indépendant. Les recommandations de santé publique insistent désormais sur la réduction du temps assis, en particulier chez les travailleurs de bureau.

Résultats. Le risque cardiovasculaire augmente de façon continue avec le temps de sédentarité. L'association persiste chez les participants qui atteignent les recommandations d'activité physique, ce qui suggère que l'activité physique ne compense pas entièrement le temps passé assis. La sédentarité prolongée fragmentée par de courtes pauses actives semble moins délétère. Les interventions de santé publique devraient cibler la réduction de la sédentarité professionnelle grâce à des pauses actives régulières.`;
    const top = keywords.extractKeywords(FR, { maxKeywords: 8 }).map((k) => k.phrase);
    for (const want of ['activité physique', 'risque cardiovasculaire', 'santé publique', 'pauses actives', 'temps passé assis']) assert.ok(top.includes(want), `« ${want} » parmi ${top.join(' | ')}`);
    for (const bad of top) assert.ok(!/\b(insistent|augmente|suggère|compense|semble|devraient|doit)\b/.test(bad), `verbe collé dans « ${bad} »`);
    assert.ok(top.every((k) => k.split(' ').length <= 3), 'trois mots au plus');
    assert.ok(!top.some((k) => /\bd'|\bl'/.test(k)), 'jamais d\'élision collée');

    const EN = `Stability of perovskite solar cells under humidity and thermal stress. Perovskite solar cells combine high efficiency with low-cost solution processing. However, the perovskite absorber degrades when exposed to moisture, oxygen, heat and light. Ion migration across the perovskite layer creates defects at the interfaces and accelerates the degradation of the device. A two-dimensional capping layer suppresses ion migration and improves the stability of the device. The capped devices showed a more stable power output than the control devices. Impedance spectroscopy indicated that the capping layer reduces ion migration, which explains the improved operational stability of perovskite solar cells.`;
    const topEn = keywords.extractKeywords(EN, { maxKeywords: 6 }).map((k) => k.phrase);
    for (const want of ['perovskite solar cells', 'ion migration']) assert.ok(topEn.includes(want), `« ${want} » parmi ${topEn.join(' | ')}`);
    assert.ok(topEn.every((k) => !/\b(across|indicated|explains|showed)\b/.test(k)), 'pas de verbe collé : ' + topEn.join(' | '));

    // un terme qui revient bat une longue phrase vue une fois
    const mix = 'La recherche sémantique des publications. ' + 'Notre système de recherche documentaire efficace doit rester utilisable sans serveur. ' + 'La recherche sémantique repose sur un index. Une recherche sémantique rapide. Cette recherche sémantique est locale.';
    const mixTop = keywords.extractKeywords(mix, { maxKeywords: 3 }).map((k) => k.phrase);
    assert.strictEqual(mixTop[0], 'recherche sémantique');
    assert.ok(mixTop.indexOf('recherche documentaire efficace') !== 0, 'la phrase vue une fois ne passe pas devant');
    const mixLong = keywords.extractKeywords((mix + ' ').repeat(3).replace(/Notre système de recherche documentaire efficace doit rester utilisable sans serveur\. /g, (m, o) => (o === 0 ? m : '')), { maxKeywords: 5 }).map((k) => k.phrase);
    assert.ok(!mixLong.includes('recherche documentaire efficace') || mixLong.indexOf('recherche documentaire efficace') > 0);

    // mots composés (« mots-clés ») gardés entiers, élision (« d'indexation ») sans le « d' », paragraphes qui coupent
    assert.deepStrictEqual(keywords.extractCandidatePhrases('Les mots-clés automatiques; la méthode d\'indexation.', keywords.buildStopwordSet('fr'), 2), [['mots-clés', 'automatiques'], ['indexation']]);
    assert.deepStrictEqual(keywords.extractCandidatePhrases('analyse sémantique\n\nréseau neuronal', keywords.buildStopwordSet('fr'), 2), [['analyse', 'sémantique'], ['réseau', 'neuronal']], 'une ligne vide coupe (fin de page)');
    assert.deepStrictEqual(keywords.extractCandidatePhrases('analyse sémantique\nréseau neuronal', keywords.buildStopwordSet('fr'), 2), [['analyse', 'sémantique', 'réseau', 'neuronal']], 'un simple retour à la ligne est neutre');
    // les rubriques et verbes de discours ne sont pas des mots-clés
    assert.ok(!keywords.extractKeywords('Résultats. Résultats. Introduction. Introduction. Conclusion. Conclusion.', { maxKeywords: 5 }).length);
    // plafond et nombre demandé, ordre stable
    assert.strictEqual(keywords.extractKeywords(FR, { maxKeywords: 3 }).length, 3);
    assert.deepStrictEqual(keywords.extractKeywords(FR, { maxKeywords: 8 }), keywords.extractKeywords(FR, { maxKeywords: 8 }), 'déterministe');
    assert.deepStrictEqual(keywords.extractKeywords('', {}), []);
    assert.deepStrictEqual(keywords.extractKeywords(null, {}), []);
    console.log('OK keywords.extractKeywords (textes réalistes : termes qui reviennent, pas de verbe collé, mots composés, élision, ligne vide)');
  }

  // pdfText : fonctions pures de jointure, testables sans PDF.js ni navigateur.
  {
    assert.strictEqual(pdfText.joinTextItems([{ str: 'Bonjour' }, { str: 'le' }, { str: 'monde' }]), 'Bonjour le monde');
    assert.strictEqual(pdfText.joinTextItems([]), '');
    assert.strictEqual(pdfText.joinPages(['page un', 'page deux']), 'page un\n\npage deux');
    console.log('OK pdfText.joinTextItems/joinPages');
  }

  // pdfText : tant que GFS n'a pas ajouté PDF.js (voir GFS-ETAT.md), isAvailable() est false et
  // extractTextFromPdf rejette avec un code clair — jamais un échec silencieux.
  {
    assert.strictEqual(pdfText.isAvailable(), false);
    await assert.rejects(pdfText.extractTextFromPdf(new ArrayBuffer(0)), (e) => e.code === 'PDFJS_NOT_AVAILABLE');
    await assert.rejects(pdfText.loadLibrary(null), (e) => e.code === 'PDFJS_NOT_AVAILABLE');
    console.log('OK pdfText.extractTextFromPdf (rejette clairement sans PDF.js)');
  }

  // pdfText : la forme que GFS fournit (`GfsPaquets.pdfjs.modules['pdfjs-dist/build/pdf.min.mjs']`,
  // relevée dans le dépôt de GFS le 18/11/2026) — un faux module qui rend deux pages, vérifié sur le
  // texte joint (pages séparées par un saut de ligne) et sur les options passées à getDocument.
  {
    let opened = null;
    const page = (strs) => ({ getTextContent: async () => ({ items: strs.map((str) => ({ str })) }) });
    globalThis.GfsPaquets = { pdfjs: { version: '1.0.0', modules: { 'pdfjs-dist/build/pdf.min.mjs': {
      getDocument: (options) => { opened = options; return { promise: Promise.resolve({ numPages: 2, getPage: async (n) => page(n === 1 ? ['Analyse', 'sémantique'] : ['des', 'publications']) }) }; },
    } } } };
    try {
      assert.strictEqual(pdfText.isAvailable(), true);
      assert.strictEqual(await pdfText.extractTextFromPdf(new ArrayBuffer(4)), 'Analyse sémantique\n\ndes publications');
      assert.ok(opened.data instanceof Uint8Array && opened.data.length === 4);
      assert.strictEqual(opened.isEvalSupported, false);
      assert.strictEqual(await pdfText.loadLibrary(null), globalThis.GfsPaquets.pdfjs.modules['pdfjs-dist/build/pdf.min.mjs']);
    } finally {
      delete globalThis.GfsPaquets;
    }
    assert.strictEqual(pdfText.isAvailable(), false);
    console.log('OK pdfText avec GfsPaquets.pdfjs (module de GFS : pages jointes, isEvalSupported=false)');
  }

  // ---------------------------------------------------------------------------------------------
  // Mots-clés des publications (consigne GFS 019) : js/publications.js (logique pure), js/pdf-text.js (lecture page
  // par page), js/grist-api.js (pièces jointes, colonne, écriture) et le câblage de la fenêtre.
  // ---------------------------------------------------------------------------------------------
  const publications = require('../js/publications.js');

  // Cellules : vide, pièces jointes (['L', ...] de fetchTable, liste nue, nombre, texte JSON), mots saisis.
  {
    for (const v of [null, undefined, '', '   ', [], ['L']]) assert.strictEqual(publications.isEmptyCell(v), true, JSON.stringify(v));
    for (const v of ['a', 0, ['L', 3], [1]]) assert.strictEqual(publications.isEmptyCell(v), false, JSON.stringify(v));
    assert.deepStrictEqual(publications.attachmentIds(['L', 12, 13, 12, 'x', -1, 1.5]), [12, 13], 'doublons, non-entiers et négatifs écartés, ordre gardé');
    assert.deepStrictEqual(publications.attachmentIds([4, 5]), [4, 5]);
    assert.deepStrictEqual(publications.attachmentIds(7), [7]);
    assert.deepStrictEqual(publications.attachmentIds('[8, 9]'), [8, 9]);
    assert.deepStrictEqual(publications.attachmentIds('pas du json'), []);
    assert.deepStrictEqual(publications.attachmentIds(null), []);
    assert.deepStrictEqual(publications.splitWords('a, b ;c\n d,, '), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual(publications.splitWords(['L', 'x', 'y']), ['x', 'y']);
    assert.deepStrictEqual(publications.splitWords(null), []);
    assert.strictEqual(publications.formatKeywords(['analyse sémantique', 'réseau']), 'analyse sémantique, réseau');
    assert.strictEqual(publications.normalizeWord('  Réseau   NEURONAL '), 'reseau neuronal');
    assert.deepStrictEqual(publications.dropKnown(['Réseau neuronal', 'analyse', 'ANALYSE', 'données'], ['reseau  neuronal']), ['analyse', 'données'], 'mots saisis et doublons retirés, sans tenir compte des accents ni de la casse');
    console.log('OK publications : cellules (vide, pièces jointes, mots saisis, comparaison sans accent)');
  }

  // Colonnes et lignes à traiter : jamais une cellule déjà remplie, jamais une ligne sans texte.
  {
    const cols = { Titre: { type: 'Text' }, Resume: { type: 'Text' }, Fichier: { type: 'Attachments' }, Mots: { type: 'ChoiceList' }, Auto: { type: 'Text' }, N: { type: 'Numeric' }, Dates: { type: 'Date' } };
    const c = publications.columnChoices(cols);
    assert.deepStrictEqual(c.pdfSource, ['Fichier']);
    assert.deepStrictEqual(c.textSource, ['Titre', 'Resume', 'Auto']);
    assert.deepStrictEqual(c.target, ['Titre', 'Resume', 'Auto'], 'on n\'écrit que dans du texte');
    assert.deepStrictEqual(c.manual, ['Titre', 'Resume', 'Mots', 'Auto'], 'les mots saisis se lisent aussi dans une liste de choix');
    assert.strictEqual(publications.freshColumnName(['Titre', 'Mots_cles_auto']), 'Mots_cles_auto_2');
    assert.strictEqual(publications.freshColumnName(['mots_cles_AUTO', 'Mots_cles_auto_2']), 'Mots_cles_auto_3', 'insensible à la casse comme Grist');
    assert.strictEqual(publications.freshColumnName(['A']), 'Mots_cles_auto');

    const table = {
      id: [1, 2, 3, 4, 5],
      Fichier: [['L', 10], ['L', 11, 12, 13, 14], null, ['L'], ['L', 15]],
      Auto: ['', 'déjà là', null, null, '   '],
      Mots: ['alpha, beta', null, null, null, ['L', 'gamma']]
    };
    const plan = publications.planRows(table, { kind: 'pdf', sourceColumn: 'Fichier', targetColumn: 'Auto', manualColumn: 'Mots' });
    assert.deepStrictEqual(plan.todo.map((x) => x.id), [1, 5], 'la ligne 2 est remplie, 3 et 4 n\'ont pas de PDF');
    assert.deepStrictEqual(plan.todo[0], { id: 1, ids: [10], known: ['alpha', 'beta'] });
    assert.deepStrictEqual(plan.todo[1].known, ['gamma']);
    assert.strictEqual(plan.filled, 1);
    assert.strictEqual(plan.noSource, 2);
    assert.strictEqual(plan.total, 5);
    const longRow = publications.planRows({ id: [1], Fichier: [['L', 1, 2, 3, 4, 5]] }, { kind: 'pdf', sourceColumn: 'Fichier', targetColumn: null });
    assert.deepStrictEqual(longRow.todo[0].ids, [1, 2, 3], 'au plus 3 pièces jointes par ligne');
    // Colonne cible à créer (null) : tout est vide ; source texte : un texte trop court n'a rien à indexer.
    const textPlan = publications.planRows({ id: [1, 2, 3], Resume: ['Un résumé assez long pour être indexé.', 'court', null] }, { kind: 'text', sourceColumn: 'Resume', targetColumn: null });
    assert.deepStrictEqual(textPlan.todo.map((x) => x.id), [1]);
    assert.strictEqual(textPlan.noSource, 2);
    // Une colonne source absente ne plante pas.
    assert.deepStrictEqual(publications.planRows({ id: [1] }, { kind: 'pdf', sourceColumn: 'Absente', targetColumn: null }).todo, []);
    console.log('OK publications : choix des colonnes et des lignes (cellule remplie jamais touchée, 3 pièces jointes au plus)');
  }

  // Une ligne : PDF, texte, ce qui n'a rien à écrire, mots saisis exclus.
  {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]).buffer;
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const calls = { fetch: [], extract: [] };
    const deps = {
      fetchPdf: async (id) => { calls.fetch.push(id); return id === 99 ? imageBytes : pdfBytes; },
      isPdf: pdfText.isPdfBytes,
      extractText: async (buffer, opts) => { calls.extract.push(opts); return 'Analyse sémantique des publications scientifiques. Analyse sémantique et mots-clés automatiques.'; },
      extractKeywords: keywords.extractKeywords
    };
    const ok = await publications.keywordsForTask({ id: 1, ids: [5] }, deps, { maxKeywords: 3, maxPages: 7 });
    assert.strictEqual(ok.status, 'ok');
    assert.ok(ok.keywords.length >= 1 && ok.keywords.length <= 3);
    assert.strictEqual(calls.extract[0].maxPages, 7, 'les limites de lecture sont transmises');
    assert.deepStrictEqual(await publications.keywordsForTask({ id: 2, ids: [99] }, deps, {}), { status: 'noPdf' }, 'une image jointe n\'est pas un PDF');
    const mixed = await publications.keywordsForTask({ id: 3, ids: [99, 5] }, deps, { maxKeywords: 2 });
    assert.strictEqual(mixed.status, 'ok', 'une image à côté d\'un PDF est ignorée sans erreur');
    const none = await publications.keywordsForTask({ id: 4, ids: [5] }, { ...deps, extractText: async () => '   ' }, {});
    assert.deepStrictEqual(none, { status: 'noText' }, 'PDF scanné : pas de texte, rien à écrire');
    const stop = await publications.keywordsForTask({ id: 5, text: 'le la les de du des et ou pour dans sur avec sans sous' }, deps, {});
    assert.deepStrictEqual(stop, { status: 'noKeywords' }, 'que des mots vides');
    const known = await publications.keywordsForTask({ id: 6, text: 'Analyse sémantique. Réseau neuronal profond. Analyse sémantique. Réseau neuronal profond.', known: ['Analyse sémantique'] }, deps, { maxKeywords: 5 });
    assert.ok(known.keywords.every((k) => publications.normalizeWord(k) !== 'analyse semantique'), 'un mot saisi à la main n\'est pas répété');
    console.log('OK publications.keywordsForTask (PDF, image ignorée, scan sans texte, mots vides, mots saisis exclus)');
  }

  // La boucle : lots d'écriture, erreur par ligne, annulation, écriture refusée.
  {
    const fakeDeps = (overrides) => {
      const written = [];
      return {
        written,
        deps: Object.assign({
          fetchPdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer,
          isPdf: pdfText.isPdfBytes,
          extractText: async () => 'Analyse sémantique des publications scientifiques et indexation automatique.',
          extractKeywords: keywords.extractKeywords,
          write: async (entries) => { written.push(entries.map((e) => e.id)); },
          yieldNow: async () => {}
        }, overrides)
      };
    };
    const todo = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, ids: [i + 1] }));

    // lots de 3 : 3 + 3 + 1, valeur au format « a, b, c »
    {
      const { deps, written } = fakeDeps();
      const progress = [];
      const result = await publications.runJob(todo, deps, { batchSize: 3, maxKeywords: 4, onProgress: (p) => progress.push(p.index) });
      assert.deepStrictEqual(written, [[1, 2, 3], [4, 5, 6], [7]]);
      assert.strictEqual(result.written, 7);
      assert.strictEqual(result.cancelled, false);
      assert.strictEqual(progress[progress.length - 1], 7, 'la progression finit à total');
    }
    // la valeur écrite est un texte « mot, mot »
    {
      let values = null;
      const { deps } = fakeDeps({ write: async (entries) => { values = entries; } });
      await publications.runJob([{ id: 1, ids: [1] }], deps, { maxKeywords: 3 });
      assert.strictEqual(typeof values[0].value, 'string');
      assert.ok(values[0].value.includes('analyse sémantique') || values[0].value.length > 0);
    }
    // une ligne en erreur n'arrête pas les autres, et ne s'écrit pas
    {
      const { deps, written } = fakeDeps({ fetchPdf: async (id) => { if (id === 2) throw new Error('réponse 404'); return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer; } });
      const rows = [];
      const result = await publications.runJob(todo.slice(0, 4), deps, { batchSize: 10, onRow: (r) => rows.push(r.status) });
      assert.strictEqual(result.errors, 1);
      assert.strictEqual(result.errorSamples[0].message, 'réponse 404');
      assert.deepStrictEqual(written, [[1, 3, 4]]);
      assert.deepStrictEqual(rows, ['ok', 'error', 'ok', 'ok']);
    }
    // sans texte : compté, jamais écrit
    {
      const { deps, written } = fakeDeps({ extractText: async () => '' });
      const result = await publications.runJob(todo.slice(0, 2), deps, {});
      assert.strictEqual(result.noText, 2);
      assert.deepStrictEqual(written, []);
    }
    // annulation entre deux lignes : ce qui est prêt est écrit, le reste ne l'est pas
    {
      const controller = new AbortController();
      const { deps, written } = fakeDeps({ yieldNow: async () => {} });
      const result = await publications.runJob(todo, deps, {
        batchSize: 50, signal: controller.signal,
        onRow: (r) => { if (r.id === 3) controller.abort(); }
      });
      assert.strictEqual(result.cancelled, true);
      assert.deepStrictEqual(written, [[1, 2, 3]], 'les trois premières lignes sont enregistrées avant l\'arrêt');
    }
    // écriture refusée : on s'arrête (elle échouerait pour chaque ligne), l'erreur est rendue
    {
      let attempts = 0;
      const { deps } = fakeDeps({ write: async () => { attempts++; throw new Error('droits insuffisants'); } });
      const result = await publications.runJob(todo, deps, { batchSize: 2 });
      assert.strictEqual(result.writeFailed, 'droits insuffisants');
      assert.strictEqual(attempts, 1, 'pas un essai par ligne');
      assert.strictEqual(result.written, 0);
    }
    // source texte : aucune pièce jointe n'est demandée
    {
      let fetched = 0;
      const { deps, written } = fakeDeps({ fetchPdf: async () => { fetched++; return new ArrayBuffer(0); } });
      await publications.runJob([{ id: 9, text: 'Un résumé de publication sur la recherche sémantique et l\'indexation automatique.' }], deps, {});
      assert.strictEqual(fetched, 0);
      assert.deepStrictEqual(written, [[9]]);
    }
    console.log('OK publications.runJob (lots, erreur par ligne, scan, annulation, écriture refusée, source texte)');
  }

  // pdfText.readPdf : page par page, plafonds, libération du document.
  {
    assert.strictEqual(pdfText.isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).buffer), true);
    const lead = new Uint8Array(200); lead.set([0x25, 0x50, 0x44, 0x46, 0x2d], 100);
    assert.strictEqual(pdfText.isPdfBytes(lead.buffer), true, '%PDF- dans les 1024 premiers octets');
    assert.strictEqual(pdfText.isPdfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), false);
    assert.strictEqual(pdfText.isPdfBytes(new ArrayBuffer(0)), false);
    assert.strictEqual(pdfText.isPdfBytes(null), false);

    let destroyed = 0; let cleaned = 0; let requested = [];
    const makeDoc = (pages) => ({
      numPages: pages,
      getPage: async (n) => { requested.push(n); return { cleanup: () => { cleaned++; }, getTextContent: async () => ({ items: [{ str: 'page' }, { str: String(n) }] }) }; },
      destroy: async () => { destroyed++; }
    });
    globalThis.GfsPaquets = { pdfjs: { modules: { 'pdfjs-dist/build/pdf.min.mjs': { getDocument: () => ({ promise: Promise.resolve(makeDoc(10)) }) } } } };
    try {
      let yields = 0;
      const all = await pdfText.readPdf(new ArrayBuffer(4), { maxPages: 100, yieldNow: async () => { yields++; } });
      assert.strictEqual(all.readPages, 10);
      assert.strictEqual(all.truncated, false);
      assert.strictEqual(all.text.split('\n\n').length, 10);
      assert.strictEqual(yields, 10, 'la main est rendue au navigateur après chaque page');
      assert.strictEqual(destroyed, 1, 'le document est libéré');
      assert.strictEqual(cleaned, 10);

      requested = [];
      const capped = await pdfText.readPdf(new ArrayBuffer(4), { maxPages: 3, yieldNow: async () => {} });
      assert.deepStrictEqual(requested, [1, 2, 3], 'jamais plus de pages que le plafond');
      assert.strictEqual(capped.truncated, true);
      assert.strictEqual(capped.pages, 10);

      const small = await pdfText.readPdf(new ArrayBuffer(4), { maxChars: 12, yieldNow: async () => {} });
      assert.ok(small.text.length <= 12 && small.truncated, 'plafond de caractères');

      const controller = new AbortController();
      requested = [];
      const aborted = await pdfText.readPdf(new ArrayBuffer(4), { signal: controller.signal, yieldNow: async () => { controller.abort(); } });
      assert.deepStrictEqual(requested, [1], 'l\'annulation arrête la lecture entre deux pages');
      assert.strictEqual(aborted.truncated, true);
      assert.ok(destroyed >= 4);
      assert.strictEqual(await pdfText.extractTextFromPdf(new ArrayBuffer(4), { maxPages: 1, yieldNow: async () => {} }), 'page 1');
    } finally {
      delete globalThis.GfsPaquets;
    }
    console.log('OK pdfText.readPdf (page par page, plafonds, annulation, document libéré) et isPdfBytes');
  }

  // grist-api.js : pièces jointes (jeton en lecture seule), colonne ajoutée, écriture — contre un faux `grist` et un faux `fetch`.
  {
    const vm = require('vm');
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'grist-api.js'), 'utf8');
    assert.ok(!/\[\s*'(RemoveTable|RemoveColumn|BulkRemoveRecord|ApplyUndoActions)'/.test(source), 'aucune action destructrice de table ou de colonne dans le pont Grist');
    const calls = { actions: [], tokens: [], urls: [] };
    let tokenCount = 0;
    const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; }, encodeURIComponent };
    sandbox.window = sandbox;
    sandbox.GristBI = { data };
    sandbox.fetch = async (url) => {
      calls.urls.push(url);
      if (/attachments\/401\//.test(url)) return { ok: false, status: 404, headers: { get: () => null } };
      if (/attachments\/402\//.test(url)) return { ok: true, status: 200, headers: { get: () => String(500 * 1024 * 1024) }, arrayBuffer: async () => new ArrayBuffer(0) };
      if (/attachments\/403\//.test(url) && !calls.retried) { calls.retried = true; return { ok: false, status: 401, headers: { get: () => null } }; }
      return { ok: true, status: 200, headers: { get: () => '4' }, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    };
    sandbox.grist = { docApi: {
      getAccessToken: async (opts) => { calls.tokens.push(opts); return { token: 'jeton' + (++tokenCount), baseUrl: 'https://grist.example/api/docs/abc/', ttlMsecs: 600000 }; },
      applyUserActions: async (actions) => { actions.forEach((a) => calls.actions.push(a)); return { retValues: actions.map((a) => (a[0] === 'AddColumn' ? { colRef: 9, colId: a[2] + '_2' } : null)) }; },
      fetchTable: async () => ({ id: [1], A: ['x'] })
    } };
    vm.runInNewContext(source, sandbox);
    const api = sandbox.GristBI.api;

    const same = (x, y, msg) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y), msg); // objets nés dans le contexte `vm` : on compare le JSON
    same(await api.checkAttachmentAccess(), { ok: true });
    same(calls.tokens[0], { readOnly: true }, 'jeton en LECTURE SEULE');
    const bytes = await api.getAttachmentBytes(400);
    assert.strictEqual(bytes.byteLength, 4);
    assert.strictEqual(calls.urls[0], 'https://grist.example/api/docs/abc/attachments/400/download?auth=jeton1', 'adresse de téléchargement, sans double barre, jeton réutilisé');
    await assert.rejects(api.getAttachmentBytes(401), (e) => e.code === 'ATTACHMENT_HTTP' && /404/.test(e.message));
    await assert.rejects(api.getAttachmentBytes(402), (e) => e.code === 'ATTACHMENT_TOO_LARGE');
    const retried = await api.getAttachmentBytes(403);
    assert.strictEqual(retried.byteLength, 4, 'un 401 est retenté une fois avec un jeton neuf');
    assert.ok(calls.urls.filter((u) => /attachments\/403\//.test(u)).length === 2);
    assert.strictEqual(tokenCount, 2, 'un seul jeton demandé pour toute la série, renouvelé une fois après le 401');

    // colonne : l'identifiant rendu par Grist gagne sur celui demandé
    assert.strictEqual(await api.addTextColumn('Pubs', 'Mots_cles_auto'), 'Mots_cles_auto_2');
    same(calls.actions[0], ['AddColumn', 'Pubs', 'Mots_cles_auto', { type: 'Text', isFormula: false }], 'une colonne de données, jamais une formule');
    // écriture : un UpdateRecord par ligne, en un seul appel
    calls.actions.length = 0;
    await api.writeColumnValues('Pubs', 'Mots_cles_auto_2', [{ id: 4, value: 'a, b' }, { id: 7, value: 'c' }]);
    same(calls.actions, [['UpdateRecord', 'Pubs', 4, { Mots_cles_auto_2: 'a, b' }], ['UpdateRecord', 'Pubs', 7, { Mots_cles_auto_2: 'c' }]]);
    await api.writeColumnValues('Pubs', 'X', []);
    assert.strictEqual(calls.actions.length, 2, 'rien à écrire = aucun appel');

    // sans jeton (GFS sans la capacité `jeton`) : un refus clair avant tout travail
    const refused = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; } };
    refused.window = refused; refused.GristBI = { data };
    refused.grist = { docApi: { getAccessToken: async () => { throw new Error('GFS_REFUSE : getAccessToken demande la capacité jeton'); } } };
    vm.runInNewContext(source, refused);
    const check = await refused.GristBI.api.checkAttachmentAccess();
    assert.strictEqual(check.ok, false);
    assert.ok(/jeton/.test(check.message));
    console.log('OK grist-api : jeton en lecture seule, téléchargement d\'une pièce jointe (404, trop lourde, jeton expiré), colonne ajoutée, écriture par UpdateRecord, refus clair sans jeton');
  }

  // Câblage : la fenêtre, ses scripts et ses textes.
  {
    const fsK = require('fs');
    const pathK = require('path');
    const index = fsK.readFileSync(pathK.join(__dirname, '..', 'index.html'), 'utf8');
    const panel = fsK.readFileSync(pathK.join(__dirname, '..', 'js', 'keywords-panel.js'), 'utf8');
    const main = fsK.readFileSync(pathK.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    // chaque élément que le panneau cherche par id existe dans la page
    const wanted = Array.from(panel.matchAll(/\$\('([a-z-]+)'\)/g)).map((m) => m[1]);
    assert.ok(wanted.length >= 20);
    for (const id of wanted) assert.ok(index.includes(`id="${id}"`), `#${id} manque dans index.html`);
    // les scripts, dans l'ordre : les pièces pures avant le pont Grist, le panneau avant main.js
    const pos = (name) => index.indexOf(`<script src="js/${name}"`);
    assert.ok(pos('keywords.js') > 0 && pos('keywords.js') < pos('pdf-text.js') && pos('pdf-text.js') < pos('publications.js') && pos('publications.js') < pos('keywords-panel.js') && pos('keywords-panel.js') < pos('main.js'));
    // pas de <form> (submit ne part jamais dans le cadre isolé de GFS) ni de boîtes natives
    const modal = index.slice(index.indexOf('id="keywords-modal"'), index.indexOf('id="comments-modal"'));
    assert.ok(modal.length > 500 && !/<form/.test(modal), 'aucun <form> dans la fenêtre (piège n°20)');
    assert.ok(!/\b(alert|confirm|prompt)\(/.test(panel.replace(/GristBI\.dialogs\.(alert|confirm|prompt)\(/g, '')), 'jamais de boîte native');
    // tous les data-i18n de la fenêtre existent en fr ET en en
    const keysUsed = new Set(Array.from(modal.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)).map((m) => m[1]));
    for (const k of Array.from(panel.matchAll(/\bt\('([a-zA-Z.]+)'/g)).map((m) => m[1])) if (!k.endsWith('.')) keysUsed.add(k);
    keysUsed.add('keywords.open');
    keysUsed.add('ext.name.mots-cles-pdf'); // posée par `t('ext.name.' + EXTENSION_ID)`
    keysUsed.add('ext.standalone.title');
    keysUsed.add('ext.standalone.body');
    for (const k of keysUsed) {
      i18n.setLang('fr'); assert.notStrictEqual(i18n.t(k), k, `fr manquant : ${k}`);
      i18n.setLang('en'); assert.notStrictEqual(i18n.t(k), k, `en manquant : ${k}`);
    }
    i18n.setLang('fr');
    assert.ok(index.includes('id="open-keywords"') && /id="open-keywords"[^>]*edit-only/.test(index), 'le bouton du menu Données est réservé à l\'Édition');
    assert.ok(/GristBI\.keywordsPanel\.init\(\{[^}]*getTableId[^}]*reloadTable/s.test(main) && !/getGfsLink|gfsLinkReady/.test(main.slice(main.indexOf('GristBI.keywordsPanel.init'), main.indexOf('GristBI.keywordsPanel.init') + 200)), 'main.js branche la fenêtre');
    // grisé, jamais masqué : l'option PDF reste dans la page sans extension, l'extension se nomme comme dans le manifeste de GFS ;
    // l'état, le chargement et l'ajout passent par js/extensions.js (jamais un lien avec GFS ni une bibliothèque ici)
    assert.ok(/EXTENSION_ID = 'mots-cles-pdf'/.test(panel) && /disabled = !available/.test(panel));
    assert.ok(/GristBI\.extensions\.stateOf\(EXTENSION_ID\)/.test(panel) && /GristBI\.extensions\.load\(EXTENSION_ID\)/.test(panel) && /GristBI\.extensions\.requestInstall\(EXTENSION_ID\)/.test(panel) && /GristBI\.extensions\.onChange\(/.test(panel));
    assert.ok(!/GfsLink|\.library\(|\.install\(|loadLibrary/.test(panel), 'le panneau ne parle pas directement à GFS');
    assert.ok(pos('extensions.js') > 0 && pos('extensions.js') < pos('keywords-panel.js'), 'js/extensions.js est chargé avant le panneau');
    assert.ok(!/import\(['"]pdfjs|pdfjs-dist\//.test(index), 'aucune bibliothèque PDF dans la page : elle vient de GFS');
    console.log('OK mots-clés des publications : fenêtre câblée (ids, scripts dans l\'ordre, aucun <form>, textes fr/en, grisé sans l\'extension)');
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
      // Radar « colonnes » : une échelle PARTAGÉE (voulu), donc des colonnes d'ordres de grandeur très différents sont signalées.
      const mixed = [{ id: 1, Qte: 18, Marge: 0.2, Montant: 65000 }, { id: 2, Qte: 20, Marge: 0.22, Montant: 66000 }];
      chk({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Qte', 'Marge', 'Montant'] }, mixed, 'advice.radar.mixedScales', 'warn');
      const mixedAdvice = advice.adviceForTile({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Qte', 'Marge', 'Montant'] }, mixed);
      assert.deepStrictEqual(mixedAdvice.vars, { small: 'Marge', big: 'Montant' }, 'cite la plus petite et la plus grande colonne');
      const sameScale = [{ id: 1, Maths: 12, Francais: 15, Anglais: 18 }, { id: 2, Maths: 10, Francais: 14, Anglais: 19 }];
      chk({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Maths', 'Francais', 'Anglais'] }, sameScale, null); // compétences sur 20 : rien à dire
      chk({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Qte'] }, mixed, null);
      chk({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Qte', 'Vide'] }, mixed, null); // une colonne sans valeur ne compte pas
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

  // grist-api.js:readColumnFormats — type + widgetOptions de chaque colonne de la table de travail et réglages du
  // document, lus dans les tables système (forme exacte NON vérifiée sur un vrai Grist, voir HYPOTHESES.md).
  {
    const vm = require('vm');
    const fsG = require('fs');
    const pathG = require('path');
    const format = require('../js/format.js');
    const source = fsG.readFileSync(pathG.join(__dirname, '..', 'js', 'grist-api.js'), 'utf8');
    async function runRead(fetchTable, tableId) {
      const warns = [];
      const sandbox = { console: { error() {}, log() {}, warn: (...a) => warns.push(a.join(' ')) }, setTimeout: (fn) => { fn(); return 0; } };
      sandbox.window = sandbox;
      sandbox.GristBI = { data, format };
      sandbox.grist = { docApi: { fetchTable } };
      vm.runInNewContext(source, sandbox);
      const out = await sandbox.GristBI.api.readColumnFormats(tableId);
      return { out: JSON.parse(JSON.stringify(out)), warns };
    }
    const system = {
      _grist_Tables: { id: [1, 2], tableId: ['Ventes', 'Autre'] },
      _grist_Tables_column: {
        id: [10, 11, 12, 13, 14, 20],
        parentId: [1, 1, 1, 1, 1, 2],
        colId: ['Montant', 'Qte', 'Nom', 'manualSort', 'gristHelper_Display', 'Montant'],
        type: ['Numeric', 'Int', 'Text', 'ManualSortPos', 'Any', 'Numeric'],
        widgetOptions: ['{"numMode":"currency","currency":"EUR"}', '{"decimals":0}', '', '', '', '{"decimals":5}']
      },
      _grist_DocInfo: { id: [1], documentSettings: ['{"locale":"fr-FR","currency":"EUR"}'] }
    };
    const fetchOk = async (id) => { if (!system[id]) throw new Error('inconnue ' + id); return JSON.parse(JSON.stringify(system[id])); };

    // 1. Cas nominal : les colonnes de LA table (pas celles de « Autre »), sans colonne d'aide, + réglages du document
    let r = await runRead(fetchOk, 'Ventes');
    assert.deepStrictEqual(Object.keys(r.out.columns).sort(), ['Montant', 'Nom', 'Qte', 'manualSort']);
    assert.strictEqual(r.out.columns.Montant.type, 'Numeric');
    assert.strictEqual(r.out.columns.Montant.widgetOptions, '{"numMode":"currency","currency":"EUR"}', 'le JSON reste brut ici, interprété par js/format.js');
    assert.deepStrictEqual(r.out.docSettings, { locale: 'fr-FR', currency: 'EUR' });
    // et de bout en bout : ce que lit l'API produit bien un format monétaire
    format.setColumnInfo(r.out.columns, r.out.docSettings);
    assert.ok(/€/.test(format.forTile({ numberFormat: { mode: 'column' }, aggFn: 'sum' }, 'Montant', 'fr').format(1234.5)));
    format.setColumnInfo({}, null);

    // 2. Table inconnue : vide, sans avertissement ni exception
    r = await runRead(fetchOk, 'Fantome');
    assert.deepStrictEqual(r.out, { columns: {}, docSettings: null });

    // 3. Tables système illisibles (droits restreints, version de Grist différente) : vide + avertissement
    r = await runRead(async () => { throw new Error('refusé'); }, 'Ventes');
    assert.deepStrictEqual(r.out, { columns: {}, docSettings: null });
    assert.strictEqual(r.warns.length, 1, 'un avertissement, jamais une exception');

    // 4. Réglages du document illisibles : les options de colonne restent utilisables
    r = await runRead(async (id) => { if (id === '_grist_DocInfo') throw new Error('absente'); return fetchOk(id); }, 'Ventes');
    assert.strictEqual(r.out.docSettings, null);
    assert.ok(r.out.columns.Montant, 'colonnes lues malgré tout');

    // 5. `widgetOptions` absent de _grist_Tables_column (ancien moteur / mock sans cette colonne) : chaînes vides
    r = await runRead(async (id) => {
      const t = await fetchOk(id);
      if (id === '_grist_Tables_column') delete t.widgetOptions;
      return t;
    }, 'Ventes');
    assert.strictEqual(r.out.columns.Montant.widgetOptions, '');
    // 6. `documentSettings` vide, invalide ou sans locale : null, jamais une exception
    for (const raw of ['', '{}', 'pas du json', '[1]']) {
      r = await runRead(async (id) => { const t = await fetchOk(id); if (id === '_grist_DocInfo') t.documentSettings = [raw]; return t; }, 'Ventes');
      assert.strictEqual(r.out.docSettings, null, JSON.stringify(raw));
    }
    console.log('OK grist-api:readColumnFormats — colonnes de la bonne table, réglages du document, replis sans exception');
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

    // --- Tuile Texte (type 'text') : une note sans donnée, rendue SANS HTML brut ---
    {
      // Échappement : rien de ce qu'une personne saisit ne devient une balise, sauf les quatre repères.
      const html = data.renderTextHtml('# Titre <b>x</b>\n\nUn **gras** & "guillemets"\nsuite\n- un\n- deux **b**\n\n## Sous\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>');
      assert.strictEqual(html,
        '<h3>Titre &lt;b&gt;x&lt;/b&gt;</h3><p>Un <strong>gras</strong> &amp; &quot;guillemets&quot;<br>suite</p><ul><li>un</li><li>deux <strong>b</strong></li></ul><h4>Sous</h4><p>&lt;img src=x onerror=alert(1)&gt;<br>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
      assert.ok(!/<(?!\/?(h3|h4|p|ul|li|strong|br)\b)/.test(html), 'aucune balise hors de la liste fermée');
      assert.strictEqual(data.renderTextHtml(''), '');
      assert.strictEqual(data.renderTextHtml(null), '');
      assert.strictEqual(data.renderTextHtml(undefined), '');
      // Un `**` seul en début de ligne n'est pas une liste ; deux ** vides ne font pas de gras vide.
      assert.strictEqual(data.renderTextHtml('**gras** début'), '<p><strong>gras</strong> début</p>');
      assert.strictEqual(data.renderTextHtml('a ** b'), '<p>a ** b</p>');
      // Fins de ligne Windows, lignes vides multiples, plafond de longueur.
      assert.strictEqual(data.renderTextHtml('a\r\nb\r\n\r\n\r\nc'), '<p>a<br>b</p><p>c</p>');
      assert.ok(data.renderTextHtml('x'.repeat(data.TEXT_TILE_MAX + 500)).length <= '<p></p>'.length + data.TEXT_TILE_MAX);
      // Texte sans repères pour les exports.
      assert.strictEqual(data.plainTextOf('# T\n- a\n**b** c\n\n## S'), 'T\n• a\nb c\n\nS');
      assert.strictEqual(data.plainTextOf(null), '');
      // Exports : ni feuille Excel (synchrone comme asynchrone), un genre d'export dédié pour PDF/PPTX.
      const textTile = { id: 'tt', type: 'text', title: 'Note', text: '# Lire\n- source : ERP' };
      const barTile = { id: 'tb', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par Région' };
      const exState = { rows, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [{ id: 'p1', name: 'Page', tiles: [textTile, barTile] }] };
      assert.strictEqual(data.tileExportKind(textTile), 'text');
      assert.deepStrictEqual(data.tileExportSheet(textTile, exState), { name: 'Note', header: ['Texte'], rows: [['Lire\n• source : ERP']] });
      assert.deepStrictEqual(data.buildWorkbookSheets(exState).map((sh) => sh.name), ['Montant par Région']);
      assert.deepStrictEqual((await data.buildWorkbookSheetsAsync(exState, async () => ({}))).map((sh) => sh.name), ['Montant par Région']);
      // Le texte n'est ni triable, ni colorable, ni filtré : aucune dimension.
      assert.strictEqual(data.isSortableTile(textTile), false);
      assert.strictEqual(data.supportsPalette(textTile), false);
      // Conseil : une ligne « quand l'utiliser » (avec sa traduction), aucun préremplissage ni avertissement.
      assert.strictEqual(advice.USE_KEYS.text, 'advice.use.text');
      assert.ok(i18n.STRINGS['advice.use.text'] && i18n.STRINGS['tileForm.type.text'] && i18n.STRINGS['tileForm.error.textRequired'] && i18n.STRINGS['tileTitle.text']);
      assert.deepStrictEqual(advice.adviceForType('text', big, ['Region']), { key: 'advice.use.text', vars: {}, level: 'info' });
      assert.deepStrictEqual(advice.defaultsForType('text', big), {});
      assert.strictEqual(advice.adviceForTile(textTile, big), null);
      // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
      const mainSrc = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
      const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const chartsSrc = fs.readFileSync(path.join(root, 'js', 'charts.js'), 'utf8');
      assert.ok(/const TYPE_CARDS = \[[^\]]*'text'\]/.test(mainSrc), 'carte « Texte » dans l\'étape Choisir');
      assert.ok(/<option value="text"/.test(indexSrc) && /<textarea id="tile-text"[^>]*maxlength="2000"/.test(indexSrc), 'option + zone de texte plafonnée');
      assert.ok(/tile\.type === 'text'\) \{\s*renderText\(/.test(chartsSrc) || /tile\.type === 'text'\) \{\r?\n\s*renderText\(/.test(chartsSrc), 'renderTile aiguille vers renderText');
      assert.ok(!/innerHTML = tile\.text|innerHTML = textValue/.test(mainSrc + chartsSrc), 'jamais de texte saisi dans innerHTML sans passer par renderTextHtml');
      console.log('OK tuile Texte — échappement total (liste fermée de balises), repères # ## - **, plafond, exports sans feuille Excel, conseil et i18n');

      // --- Table plate (type 'table') : les lignes telles quelles, colonnes choisies, tri de lecture ---
      {
        const fmtMod = require('../js/format.js');
        const mixed = [
          { id: 1, Region: 'Sud', Lot: 'Lot 10', Montant: 1542980.8799999997, Annee: 2024, Date: '2024-03-02', Note: null },
          { id: 2, Region: 'nord', Lot: 'Lot 2', Montant: 12, Annee: 2023, Date: '2023-12-31', Note: '' },
          { id: 3, Region: 'Est', Lot: 'Lot 1', Montant: null, Annee: 2025, Date: '2025-01-05', Note: ['L', 'a', 'b'] },
          { id: 4, Region: 'Ouest', Lot: 'Lot 3', Montant: -4.5, Annee: 2022, Date: '', Note: 'ok' }
        ];
        const tb = { id: 'tt1', type: 'table', title: 'Lignes', columns: ['Lot', 'Region', 'Montant', 'Gone'] };
        // Colonnes : celles qui existent encore, dans l'ordre choisi ; sans ligne, la liste choisie telle quelle.
        assert.deepStrictEqual(data.tableColumnsOf(tb, mixed), ['Lot', 'Region', 'Montant']);
        assert.deepStrictEqual(data.tableColumnsOf(tb, []), ['Lot', 'Region', 'Montant', 'Gone']);
        assert.deepStrictEqual(data.tableColumnsOf({ type: 'table' }, mixed), []);
        // Texte d'une cellule : liste de choix Grist lue sans son marqueur, null vide, objet jamais « [object Object] ».
        assert.strictEqual(data.cellText(['L', 'a', 'b']), 'a, b');
        assert.strictEqual(data.cellText(null), '');
        assert.strictEqual(data.cellText(true), 'true');
        assert.strictEqual(data.cellText({ a: 1 }), '{"a":1}');
        // Tri : nombres comme des nombres, texte « naturel » sans casse, dates telles quelles, vides toujours à la fin.
        const ids = (rs) => rs.map((r) => r.id);
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Montant', 'asc')), [4, 2, 1, 3]);
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Montant', 'desc')), [1, 2, 4, 3]);
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Lot', 'asc')), [3, 2, 4, 1]); // Lot 1, 2, 3, 10 (pas 1, 10, 2, 3)
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Region', 'asc')), [3, 2, 4, 1]); // Est, nord, Ouest, Sud
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Date', 'asc')), [2, 1, 3, 4]);
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Date', 'desc')), [3, 1, 2, 4]);
        assert.deepStrictEqual(ids(data.sortRowsBy(mixed, 'Note', 'asc')), [3, 4, 1, 2]);
        assert.strictEqual(data.sortRowsBy(mixed, 'Montant', null), mixed, 'sans sens : le même tableau, pas de copie');
        assert.deepStrictEqual(ids(mixed), [1, 2, 3, 4], 'le tableau partagé n\'est jamais modifié par un tri');
        const stable = [{ id: 1, k: 'a' }, { id: 2, k: 'a' }, { id: 3, k: 'a' }];
        assert.deepStrictEqual(ids(data.sortRowsBy(stable, 'k', 'desc')), [1, 2, 3], 'tri stable');
        assert.deepStrictEqual(ids(data.sortRowsBy([{ id: 1, k: 5n }, { id: 2, k: 2n }], 'k', 'asc')), [2, 1], 'BigInt (DuckDB)');
        // Cycle du clic d'en-tête et réordonnancement du formulaire.
        assert.strictEqual(data.nextSortDir(null), 'asc');
        assert.strictEqual(data.nextSortDir('asc'), 'desc');
        assert.strictEqual(data.nextSortDir('desc'), null);
        assert.deepStrictEqual(data.moveInOrder(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
        assert.deepStrictEqual(data.moveInOrder(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
        assert.deepStrictEqual(data.moveInOrder(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
        assert.deepStrictEqual(data.moveInOrder(['a', 'b', 'c'], 'zz', 1), ['a', 'b', 'c']);
        // Nombres : Automatique = la donnée (jamais « 2 024 » pour une année, ni de bruit de flottant) ; format choisi respecté.
        assert.strictEqual(fmtMod.cellNumber(tb, 'Annee', 2024, 'fr'), '2024');
        assert.strictEqual(fmtMod.cellNumber(tb, 'Montant', 1542980.8799999997, 'fr'), '1542980,88');
        assert.strictEqual(fmtMod.cellNumber(tb, 'Montant', 1542980.88, 'en'), '1542980.88');
        assert.strictEqual(fmtMod.cellNumber(tb, 'Montant', -0, 'fr'), '0');
        assert.strictEqual(fmtMod.cellNumber(tb, 'Montant', 12345678901n, 'fr'), '12345678901');
        assert.strictEqual(fmtMod.cellNumber(tb, 'Montant', null, 'fr'), '');
        const withFmt = Object.assign({}, tb, { numberFormat: { mode: 'custom', decimals: 2, notation: 'standard' } });
        assert.strictEqual(fmtMod.cellNumber(withFmt, 'Montant', 1542980.879, 'en'), '1,542,980.88');
        // Export : mêmes colonnes et même ordre, valeurs brutes, plafond annoncé (`truncated`).
        const exState = { rows: mixed, activeFilters: [{ column: 'Region', value: 'Est', sourceTileId: 'autre' }], advancedFilters: [], drillIns: {}, comments: [], pages: [{ id: 'p1', name: 'P', tiles: [tb] }] };
        assert.strictEqual(data.tileExportKind(tb), 'table');
        const sheet = data.tileExportSheet(tb, exState);
        assert.deepStrictEqual(sheet.header, ['Lot', 'Region', 'Montant']);
        assert.deepStrictEqual(sheet.rows, [['Lot 1', 'Est', '']], 'filtres croisés des autres tuiles respectés, valeur vide -> chaîne vide');
        assert.strictEqual(data.tileExportSheet(tb, { rows: mixed, activeFilters: [], advancedFilters: [], drillIns: {} }, 2).truncated, 2);
        assert.deepStrictEqual(data.tileExportSheet(tb, { rows: mixed, activeFilters: [], advancedFilters: [], drillIns: {} }).rows[0], ['Lot 10', 'Sud', 1542980.8799999997]);
        assert.deepStrictEqual(data.buildWorkbookSheets(Object.assign({}, exState, { activeFilters: [] })).map((sh) => sh.name), ['Lignes']);
        // Aucune dimension/mesure/agrégat : ni triable, ni colorable, aucun conseil ni préremplissage fantôme.
        assert.strictEqual(data.isSortableTile(tb), false);
        assert.strictEqual(data.supportsPalette(tb), false);
        assert.strictEqual(advice.adviceForTile(tb, big), null);
        assert.deepStrictEqual(advice.adviceForType('table', big, ['Region']), { key: 'advice.use.table', vars: {}, level: 'info' });
        assert.deepStrictEqual(advice.defaultsForType('table', big, ['id', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), { columns: ['a', 'b', 'c', 'd', 'e', 'f'] });
        assert.deepStrictEqual(advice.suggestTiles(big, Object.keys(big[0]), { limit: 20, t: (k) => k }).filter((c) => c.type === 'table'), [], 'jamais proposée à l\'accueil');
        ['tileForm.type.table', 'tileForm.columns.label', 'tileForm.columns.hint', 'tileForm.columns.up', 'tileForm.columns.down', 'tileForm.error.columnsRequired',
          'tileTitle.table', 'advice.use.table', 'chart.table.empty', 'chart.table.noColumns', 'chart.table.sortBy', 'chart.table.truncated', 'export.table.more']
          .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
        // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
        const mainSrc2 = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
        const chartsSrc2 = fs.readFileSync(path.join(root, 'js', 'charts.js'), 'utf8');
        const indexSrc2 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        assert.ok(/const TYPE_CARDS = \[[^\]]*'table'/.test(mainSrc2) && /<option value="table"/.test(indexSrc2) && /id="tile-columns"/.test(indexSrc2));
        assert.ok(/tile\.type === 'table'\) \{\s*renderTable\(/.test(chartsSrc2), 'renderTile aiguille vers renderTable');
        assert.ok(/el\.dataset\.tileType !== tile\.type/.test(mainSrc2), 'une tuile dont le type change est recréée');
        assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsSrc2), 'aucun format de nombre en dur dans charts.js');
        console.log('OK tuile Table — colonnes, tri (naturel, vides à la fin, stable), nombres bruts, exports plafonnés, conseil et i18n');
      }

      // --- Objectif, courbe de tendance d'une carte KPI et tuile « Progression » ---
      {
        // Niveaux : vert dès `good`, orange dès `warn`, rouge en dessous ; seuils par défaut 90 / 60.
        assert.deepStrictEqual(data.targetProgress(82, 100), { pct: 82, fill: 0.82, level: 'warn' });
        assert.strictEqual(data.targetProgress(90, 100).level, 'good', 'le seuil lui-même est atteint');
        assert.strictEqual(data.targetProgress(60, 100).level, 'warn');
        assert.strictEqual(data.targetProgress(59.9, 100).level, 'bad');
        assert.strictEqual(data.targetProgress(58, 100).pct, 58, 'pas de bruit de flottant (58/100*100)');
        assert.deepStrictEqual(data.targetProgress(104, 100), { pct: 104, fill: 1, level: 'good' }, 'dépassement : % réel, barre plafonnée');
        assert.strictEqual(data.targetProgress(-5, 100).fill, 0, 'valeur négative : barre vide, jamais négative');
        assert.strictEqual(data.targetProgress(50, 100, 40, 20).level, 'good', 'seuils réglables');
        assert.strictEqual(data.targetProgress(5, 0), null, 'objectif nul');
        assert.strictEqual(data.targetProgress(5, -3), null, 'objectif négatif');
        assert.strictEqual(data.targetProgress(5, null), null);
        assert.strictEqual(data.targetProgress(null, 100), null);
        assert.strictEqual(data.targetProgress('', 100), null);
        assert.strictEqual(data.targetProgress(50n, 100n).pct, 50, 'BigInt (DuckDB)');
        // Lignes d'une Progression : objectif commun, ou colonne agrégée PAR catégorie (catégorie sans objectif -> sans barre).
        const groups = [{ dimension: 'Léa', value: 104 }, { dimension: 'Marc', value: 58 }, { dimension: 'Zoé', value: 10 }];
        const common = data.progressRows(groups, null, 100);
        assert.deepStrictEqual(common.map((r) => [r.key, r.pct, r.level]), [['Léa', 104, 'good'], ['Marc', 58, 'bad'], ['Zoé', 10, 'bad']]);
        const perKey = data.progressRows(groups, [{ dimension: 'Léa', value: 200 }, { dimension: 'Marc', value: 58 }], undefined);
        assert.deepStrictEqual(perKey.map((r) => [r.key, r.target, r.pct, r.level]), [['Léa', 200, 52, 'bad'], ['Marc', 58, 100, 'good'], ['Zoé', null, null, null]]);
        assert.strictEqual(perKey[2].fill, 0);
        assert.strictEqual(data.progressRows(groups, null, undefined)[0].pct, null, 'sans objectif du tout : rien à afficher');
        // Courbe : années triées, mois dans l'ordre des données ; moins de 2 points -> rien ; série plate au milieu.
        assert.deepStrictEqual(data.sparklineValues([{ dimension: 2025, value: 3 }, { dimension: 2023, value: 1 }, { dimension: 2024, value: 2 }]), [1, 2, 3]);
        assert.deepStrictEqual(data.sparklineValues([{ dimension: 'Mars', value: 3 }, { dimension: 'Janvier', value: 1 }]), [3, 1], 'ordre des données pour du texte');
        assert.deepStrictEqual(data.sparklineValues([{ dimension: 'a', value: null }, { dimension: 'b', value: 2 }]), [2], 'valeurs nulles ignorées');
        assert.strictEqual(data.sparklineGeometry([5], 100, 30, 3), null);
        assert.strictEqual(data.sparklineGeometry([], 100, 30, 3), null);
        const geo = data.sparklineGeometry([1, 3, 2, 5], 100, 30, 3);
        assert.strictEqual(geo.line, 'M0 27 L33.33 15 L66.67 21 L100 3');
        assert.ok(geo.area.endsWith('L100 30 L0 30 Z'));
        assert.deepStrictEqual(geo.last, { x: 100, y: 10 });
        assert.strictEqual(data.sparklineGeometry([4, 4, 4], 100, 30, 3).line, 'M0 15 L50 15 L100 15', 'série plate : trait au milieu');
        // Exports : Progression en table (type + valeur + objectif + %) ; carte KPI avec objectif ; sans objectif, inchangée.
        const exRows = [{ R: 'A', M: 80, T: 100 }, { R: 'A', M: 10, T: 0 }, { R: 'B', M: 30, T: 100 }];
        const exState = { rows: exRows, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
        const progTile = { id: 'pg', type: 'progress', title: 'Obj', dimension: 'R', measure: 'M', aggFn: 'sum', targetColumn: 'T' };
        assert.strictEqual(data.tileExportKind(progTile), 'table');
        assert.deepStrictEqual(data.tileExportSheet(progTile, exState), { name: 'Obj', header: ['R', 'Valeur', 'Objectif', '% de l’objectif'], rows: [['A', 90, 100, 90], ['B', 30, 100, 30]] });
        assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, progTile, { targetColumn: undefined, target: 200 }), exState).rows, [['A', 90, 200, 45], ['B', 30, 200, 15]]);
        const kpiT = { id: 'k', type: 'kpi', title: 'K', measure: 'M', aggFn: 'sum' };
        assert.deepStrictEqual(data.tileExportSheet(kpiT, exState), { name: 'K', header: ['Mesure', 'Valeur'], rows: [['sum(M)', 120]] });
        assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, kpiT, { target: 150 }), exState), { name: 'K', header: ['Mesure', 'Valeur', 'Objectif', '% de l’objectif'], rows: [['sum(M)', 120, 150, 80]] });
        assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, kpiT, { targetColumn: 'T' }), exState).rows, [['sum(M)', 120, 200, 60]]);
        // Assistant et format : la Progression a sa ligne d'usage, ses valeurs par défaut (catégorie + mesure), le format des nombres.
        assert.strictEqual(advice.USE_KEYS.progress, 'advice.use.progress');
        assert.strictEqual(advice.adviceForType('progress', big, ['Region']).key !== undefined, true);
        const progDefaults = advice.defaultsForType('progress', big, Object.keys(big[0]));
        assert.ok(progDefaults.dimension && progDefaults.measure, 'catégorie + mesure préremplies');
        assert.strictEqual(data.supportsNumberFormat({ type: 'progress' }), true);
        assert.strictEqual(data.supportsPalette({ type: 'progress' }), false);
        assert.strictEqual(data.isSortableTile({ type: 'progress' }), false);
        ['tileForm.type.progress', 'tileForm.target.label', 'tileForm.targetColumn.label', 'tileForm.target.hint', 'tileForm.goodPct.label', 'tileForm.warnPct.label',
          'tileForm.sparkline.label', 'tileForm.error.targetRequired', 'tileForm.error.targetPositive', 'tileForm.error.thresholds', 'tileTitle.progress',
          'advice.use.progress', 'chart.kpi.goalPct', 'chart.kpi.goalTarget', 'chart.progress.empty', 'chart.progress.row', 'chart.progress.legend']
          .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
        // Câblage lu dans les sources.
        const mainSrc3 = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
        const chartsSrc3 = fs.readFileSync(path.join(root, 'js', 'charts.js'), 'utf8');
        const indexSrc3 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        assert.ok(/const TYPE_CARDS = \[[^\]]*'progress'/.test(mainSrc3) && /<option value="progress"/.test(indexSrc3) && /id="tile-target"/.test(indexSrc3) && /id="tile-sparkline"/.test(indexSrc3));
        assert.ok(/tile-kpi-spark/.test(mainSrc3) && /tile-kpi-goal/.test(mainSrc3), 'balisage de la carte KPI : courbe + objectif');
        assert.ok(/tile\.type === 'progress'\) \{\s*renderProgress\(/.test(chartsSrc3), 'renderTile aiguille vers renderProgress');
        assert.ok(/setProperty\('--kpi-chars'/.test(chartsSrc3), 'la police de la valeur KPI s\'ajuste toujours (lot jauge/KPI)');
        console.log('OK objectif KPI, courbe, Progression — niveaux et seuils, lignes par catégorie, courbe SVG, exports, conseil et i18n');
        // Combo barres + courbe (lot 2 de l'étude, 18/11/2026) : Pareto, alignement par nom, export, conseil, câblage.
        {
          assert.strictEqual(data.comboModeOf({ type: 'combo' }), 'measure');
          assert.strictEqual(data.comboModeOf({ type: 'combo', comboMode: 'pareto' }), 'pareto');
          assert.strictEqual(data.comboModeOf({ type: 'combo', comboMode: 'inconnu' }), 'measure', 'mode inconnu -> défaut');
          assert.strictEqual(data.comboModeOf(null), 'measure');
          // Pareto : tri décroissant (copie), parts cumulées, dernier point = 100 exactement.
          const gs = [{ dimension: 'A', value: 10 }, { dimension: 'B', value: 50 }, { dimension: 'C', value: 30 }, { dimension: 'D', value: 10 }];
          const p = data.paretoSeries(gs);
          assert.deepStrictEqual(p.groups.map((g) => g.dimension), ['B', 'C', 'A', 'D'], 'tri décroissant, ex æquo dans l\'ordre d\'apparition');
          assert.deepStrictEqual(p.cumulative, [50, 80, 90, 100]);
          assert.strictEqual(p.total, 100);
          assert.deepStrictEqual(gs.map((g) => g.dimension), ['A', 'B', 'C', 'D'], 'les groupes d\'origine ne sont jamais triés en place');
          assert.strictEqual(data.paretoSeries([{ dimension: 'a', value: 1 }, { dimension: 'b', value: 1 }, { dimension: 'c', value: 1 }]).cumulative[2], 100, '3 x 1/3 : exactement 100, pas 99,99999999999999');
          assert.deepStrictEqual(data.paretoSeries([{ dimension: 'x', value: -5 }, { dimension: 'y', value: 20 }, { dimension: 'z', value: null }]).cumulative, [100, 100, 100], 'négatif et absent comptent pour 0');
          assert.deepStrictEqual(data.paretoSeries([{ dimension: 'x', value: 0 }, { dimension: 'y', value: 0 }]).cumulative, [0, 0], 'total nul : 0, jamais NaN');
          assert.deepStrictEqual(data.paretoSeries([]), { groups: [], cumulative: [], total: 0 });
          assert.deepStrictEqual(data.paretoSeries(null), { groups: [], cumulative: [], total: 0 });
          // Mode « autre mesure » : la courbe est alignée sur les barres PAR NOM (catégorie absente -> null, jamais 0 ni décalage),
          // y compris une catégorie BigInt (DuckDB) face à un nombre (JS).
          const bars = [{ dimension: 'N', value: 10 }, { dimension: 'S', value: 20 }, { dimension: 2024n, value: 5 }];
          const line = [{ dimension: 2024, value: 7 }, { dimension: 'S', value: 4 }];
          const cs = data.comboSeries({ type: 'combo' }, bars, line);
          assert.deepStrictEqual(cs.categories, ['N', 'S', 2024n]);
          assert.deepStrictEqual(cs.bars, [10, 20, 5]);
          assert.deepStrictEqual(cs.line, [null, 4, 7], 'alignement par nom, trou = null');
          assert.strictEqual(cs.mode, 'measure');
          const csP = data.comboSeries({ type: 'combo', comboMode: 'pareto' }, gs, null);
          assert.deepStrictEqual([csP.mode, csP.categories, csP.bars, csP.line], ['pareto', ['B', 'C', 'A', 'D'], [50, 30, 10, 10], [50, 80, 90, 100]]);
          assert.deepStrictEqual(data.comboSeries({ type: 'combo' }, bars, null).line, [null, null, null], 'sans 2e agrégation : courbe vide, jamais une exception');
          // Tri : réglable en mode « autre mesure », jamais en Pareto (l'ordre fait la méthode) ; palette et format des nombres.
          assert.strictEqual(data.isSortableTile({ type: 'combo' }), true);
          assert.strictEqual(data.isSortableTile({ type: 'combo', comboMode: 'pareto' }), false);
          assert.strictEqual(data.supportsPalette({ type: 'combo' }), true);
          assert.strictEqual(data.supportsNumberFormat({ type: 'combo' }), true);
          assert.strictEqual(data.isSeriesTile({ type: 'combo', seriesColumn: 'R' }), false, 'pas de colonne Séries sur un combo');
          // Export Excel : mêmes valeurs que l'écran (barres, 2e mesure alignée / % cumulé), même ordre ; image pour PDF/PPTX.
          const cRows = [{ R: 'A', M: 10, Q: 1 }, { R: 'B', M: 50, Q: 2 }, { R: 'B', M: 0, Q: 4 }, { R: 'C', M: 30, Q: 3 }, { R: 'D', M: 10, Q: 0 }];
          const cState = { rows: cRows, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
          const cTile = { id: 'cb', type: 'combo', title: 'Combo', dimension: 'R', measure: 'M', aggFn: 'sum', measureY: 'Q', aggFnY: 'avg' };
          assert.strictEqual(data.tileExportKind(cTile), 'image');
          assert.deepStrictEqual(data.tileExportSheet(cTile, cState), { name: 'Combo', header: ['R', 'M', 'Q'], rows: [['A', 10, 1], ['B', 50, 3], ['C', 30, 3], ['D', 10, 0]] });
          assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, cTile, { sortMode: 'value-desc' }), cState).rows.map((r) => r[0]), ['B', 'C', 'A', 'D'], 'le fichier suit le tri affiché');
          assert.deepStrictEqual(data.tileExportSheet({ id: 'pa', type: 'combo', title: 'Par', dimension: 'R', measure: 'M', aggFn: 'sum', comboMode: 'pareto', sortMode: 'label' }, cState),
            { name: 'Par', header: ['R', 'M', '% cumulé'], rows: [['B', 50, 50], ['C', 30, 80], ['A', 10, 90], ['D', 10, 100]] }, 'Pareto : trié du plus grand au plus petit quoi que dise sortMode');
          // Formulaire : valeurs par défaut (2 mesures -> courbe ; 1 seule -> Pareto en somme) et avertissements.
          const two = [{ Region: 'N', Montant: 100, Quantite: 3 }, { Region: 'S', Montant: 50, Quantite: 2 }, { Region: 'E', Montant: 20, Quantite: 9 }, { Region: 'O', Montant: 5, Quantite: 1 }];
          const d2 = advice.defaultsForType('combo', two, ['Region', 'Montant', 'Quantite']);
          assert.deepStrictEqual([d2.dimension, d2.measure, d2.measureY, d2.comboMode], ['Region', 'Montant', 'Quantite', undefined]);
          const one = [{ Region: 'N', Montant: 100 }, { Region: 'S', Montant: 50 }, { Region: 'E', Montant: 20 }];
          const d1 = advice.defaultsForType('combo', one, ['Region', 'Montant']);
          assert.deepStrictEqual([d1.dimension, d1.measure, d1.aggFn, d1.comboMode, d1.measureY], ['Region', 'Montant', 'sum', 'pareto', undefined]);
          assert.strictEqual(advice.TILE_TYPES.includes('combo'), false, 'jamais proposé à l\'accueil (suggestTiles)');
          assert.deepStrictEqual(advice.suggestTiles(two, Object.keys(two[0]), { limit: 20, t: (k) => k }).filter((c) => c.type === 'combo'), []);
          assert.strictEqual(advice.adviceForTile({ type: 'combo', dimension: 'Region', measure: 'Montant', aggFn: 'avg', comboMode: 'pareto' }, two).key, 'advice.combo.paretoAgg');
          assert.strictEqual(advice.adviceForTile({ type: 'combo', dimension: 'Region', measure: 'Montant', aggFn: 'sum', measureY: 'Montant' }, two).key, 'advice.combo.sameSeries');
          assert.strictEqual(advice.adviceForTile({ type: 'combo', dimension: 'Region', measure: 'Montant', aggFn: 'sum', measureY: 'Montant', aggFnY: 'avg' }, two), null, 'même colonne, autre agrégat : légitime');
          assert.strictEqual(advice.adviceForTile({ type: 'combo', dimension: 'Region', measure: 'Montant', aggFn: 'sum', measureY: 'Quantite' }, two), null);
          const negs = [{ Region: 'N', Montant: 100 }, { Region: 'S', Montant: -50 }];
          assert.strictEqual(advice.adviceForTile({ type: 'combo', dimension: 'Region', measure: 'Montant', aggFn: 'sum', comboMode: 'pareto' }, negs).key, 'advice.combo.paretoNegative');
          assert.strictEqual(advice.adviceForType('combo', two, ['Region', 'Montant', 'Quantite']).key, 'advice.use.combo');
          ['tileForm.type.combo', 'tileForm.comboMode.label', 'tileForm.comboMode.measure', 'tileForm.comboMode.pareto', 'tileForm.measure.labelBars', 'tileForm.measureY.labelLine',
            'tileForm.aggY.label', 'tileForm.agg.labelBars', 'tileForm.error.comboMeasureRequired', 'tileTitle.combo', 'tileTitle.pareto', 'chart.combo.cumulative', 'advice.use.combo', 'advice.combo.paretoAgg',
            'advice.combo.paretoNegative', 'advice.combo.sameSeries', 'advice.combo.manyBars']
            .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
          // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
          const mainSrc4 = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
          const chartsSrc4 = fs.readFileSync(path.join(root, 'js', 'charts.js'), 'utf8');
          const indexSrc4 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
          assert.ok(/const TYPE_CARDS = \[[^\]]*'combo'/.test(mainSrc4) && /<option value="combo"/.test(indexSrc4) && /id="tile-combo-mode"/.test(indexSrc4) && /id="tile-agg-y"/.test(indexSrc4));
          assert.ok(/tile\.type === 'combo'\) \{\s*\/\/ Combo barres/.test(chartsSrc4) && /yAxisIndex: 1/.test(chartsSrc4), 'branche combo de renderChart : 2 axes Y');
          assert.ok(/fmtFor\(\{ \.\.\.tile, aggFn: tile\.aggFnY \|\| tile\.aggFn \}, tile\.measureY\)/.test(chartsSrc4), 'format de la courbe : celui de SA colonne, un comptage jamais comme la colonne');
          assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsSrc4), 'aucun format de nombre en dur dans charts.js');
          console.log('OK combo barres + courbe — Pareto (cumul, 100 exact, négatifs), alignement par nom, tri, export, valeurs par défaut, conseil et i18n');
        }
        // Histogramme (lot 2 de l'étude, 18/11/2026) : classes rondes, bornes, filtre par plage, store, export, conseil, câblage.
        {
          // Pas « rond » le plus proche (1, 2, 5 x 10^n).
          assert.deepStrictEqual([0.9, 1.4, 1.5, 2.9, 3, 3.33, 6.9, 7, 0.04, 130].map(data.niceStep), [1, 1, 2, 2, 5, 5, 5, 10, 0.05, 100]);
          assert.strictEqual(data.niceStep(0), 1); assert.strictEqual(data.niceStep(-3), 1); assert.strictEqual(data.niceStep(NaN), 1);
          // Notes sur 20 : 10 valeurs -> 5 classes demandées (Sturges), pas rond 5 -> [0;5[ [5;10[ [10;15[ [15;20].
          const notes = [3, 8, 8, 12, 12, 12, 15, 18, 20, 5].map((Note, i) => ({ id: i, Note }));
          const h = data.histogramBins(notes, notes, 'Note');
          assert.deepStrictEqual(h.bins.map((b) => [b.lo, b.hi, b.count, b.last]), [[0, 5, 1, false], [5, 10, 3, false], [10, 15, 3, false], [15, 20, 3, true]]);
          assert.strictEqual(h.total, 10); assert.strictEqual(h.ignored, 0); assert.strictEqual(h.step, 5);
          assert.strictEqual(h.bins.reduce((a, b) => a + b.count, 0), 10, 'chaque ligne dans une classe, une seule');
          // Valeurs vides / non numériques / booléens ignorées, JAMAIS comptées comme 0.
          const messy = [null, '', 'abc', true, undefined, 4, '6', 8n].map((Note, i) => ({ id: i, Note }));
          const hm = data.histogramBins(messy, messy, 'Note');
          assert.strictEqual(hm.total, 3, '4, « 6 » et 8n (BigInt) seulement'); assert.strictEqual(hm.ignored, 5);
          assert.ok(hm.bins[0].lo > 0 || hm.bins[0].lo === 0); assert.ok(hm.bins.every((b) => b.lo >= 0), 'aucune classe négative créée par un null pris pour 0');
          // Aucune valeur numérique : aucune classe (le rendu affiche un message).
          assert.deepStrictEqual(data.histogramBins([{ a: 'x' }, { a: null }], [{ a: 'x' }, { a: null }], 'a'), { bins: [], step: 0, total: 0, ignored: 2 });
          assert.deepStrictEqual(data.histogramBins([], [], 'a').bins, []);
          // Une seule valeur distincte : une classe fermée des deux côtés.
          const one = [7, 7, 7].map((Note) => ({ Note }));
          assert.deepStrictEqual(data.histogramBins(one, one, 'Note').bins, [{ lo: 7, hi: 7, count: 3, last: true }]);
          assert.deepStrictEqual(data.histogramFilter({ lo: 7, hi: 7, count: 3, last: true }), { type: 'range', min: 7, max: 7 });
          assert.strictEqual(data.applyFilters(one.map((r) => ({ Note: r.Note })), [Object.assign({ column: 'Note' }, data.histogramFilter({ lo: 7, hi: 7, last: true }))]).length, 3);
          // Entiers : jamais de classe plus étroite que 1 (sinon une classe sur deux vide) ; bornes décimales sans bruit de flottant.
          const ints = [1, 2, 3, 1, 2].map((Note) => ({ Note }));
          assert.deepStrictEqual(data.histogramBins(ints, ints, 'Note').bins.map((b) => [b.lo, b.hi, b.count]), [[1, 2, 2], [2, 3, 3]]);
          const tenths = Array.from({ length: 11 }, (_, i) => ({ x: i / 10 + (i === 3 ? 0.1 + 0.2 - 0.3 : 0) }));
          const ht = data.histogramBins(tenths, tenths, 'x');
          assert.deepStrictEqual(ht.bins.map((b) => b.lo).concat(ht.bins[ht.bins.length - 1].hi), [0, 0.2, 0.4, 0.6, 0.8, 1], 'bornes arrondies');
          // Nombre de classes demandé : indicatif (bornes rondes), borné à 2..60 ; invalide ou < 2 -> automatique.
          const twenty = Array.from({ length: 21 }, (_, i) => ({ v: i }));
          assert.strictEqual(data.histogramBins(twenty, twenty, 'v', 4).bins.length, 4);
          assert.strictEqual(data.histogramBins(twenty, twenty, 'v', '4').bins.length, 4, 'nombre saisi sous forme de texte');
          assert.deepStrictEqual(data.histogramBins(twenty, twenty, 'v', 1).bins, data.histogramBins(twenty, twenty, 'v').bins, '1 classe : automatique');
          assert.deepStrictEqual(data.histogramBins(twenty, twenty, 'v', 'abc').bins, data.histogramBins(twenty, twenty, 'v').bins);
          const wide = Array.from({ length: 200 }, (_, i) => ({ v: i * 5000003 }));
          assert.ok(data.histogramBins(wide, wide, 'v', 500).bins.length <= data.HISTOGRAM_MAX_BINS, 'plafond de 60 classes');
          // Grille tirée de TOUTES les lignes, comptes sur les lignes visibles : l'axe ne bouge pas quand on filtre ailleurs.
          const shown = twenty.filter((r) => r.v >= 10);
          const hs = data.histogramBins(twenty, shown, 'v', 4);
          assert.deepStrictEqual(hs.bins.map((b) => [b.lo, b.hi]), data.histogramBins(twenty, twenty, 'v', 4).bins.map((b) => [b.lo, b.hi]));
          assert.strictEqual(hs.total, 11);
          // Cohérence classe <-> filtre : chaque classe contient EXACTEMENT les lignes que son filtre range retient (bornes
          // communes, flottants, dernière classe fermée). Jeu pseudo-aléatoire reproductible.
          let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
          for (const gen of [() => Math.round(rnd() * 100) / 10, () => Math.floor(rnd() * 40), () => rnd() * 1e6, () => -50 + rnd() * 100]) {
            const rs = Array.from({ length: 400 }, () => ({ v: gen() }));
            const hh = data.histogramBins(rs, rs, 'v');
            hh.bins.forEach((b) => {
              const kept = data.applyFilters(rs, [Object.assign({ column: 'v' }, data.histogramFilter(b))]).length;
              assert.strictEqual(kept, b.count, 'classe [' + b.lo + ' ; ' + b.hi + (b.last ? ']' : '[') + ' : le filtre retient autant de lignes que le compte');
            });
            assert.strictEqual(hh.bins.reduce((a, b) => a + b.count, 0), 400);
          }
          // matchesFilter : cellule vide jamais prise pour 0 ; borne haute exclue seulement avec maxExclusive.
          assert.strictEqual(data.matchesFilter(null, { type: 'range', min: -1, max: 1 }), false);
          assert.strictEqual(data.matchesFilter('', { type: 'range', min: -1, max: 1 }), false);
          assert.strictEqual(data.matchesFilter(0, { type: 'range', min: -1, max: 1 }), true);
          assert.strictEqual(data.matchesFilter(10, { type: 'range', min: 5, max: 10 }), true, 'borne haute incluse par défaut (filtres avancés inchangés)');
          assert.strictEqual(data.matchesFilter(10, { type: 'range', min: 5, max: 10, maxExclusive: true }), false);
          assert.strictEqual(data.matchesFilter(5, { type: 'range', min: 5, max: 10, maxExclusive: true }), true);
          // filterSelects : égalité comme avant (types mêlés), plage par matchesFilter.
          assert.strictEqual(data.filterSelects({ column: 'A', value: 2025 }, '2025'), true);
          assert.strictEqual(data.filterSelects({ column: 'A', value: 'x' }, 'y'), false);
          assert.strictEqual(data.filterSelects({ column: 'A', type: 'range', min: 5, max: 10, maxExclusive: true }, 7), true);
          assert.strictEqual(data.filterSelects({ column: 'A', type: 'range', min: 5, max: 10, maxExclusive: true }, 10), false);
          assert.strictEqual(data.filterSelects(undefined, 1), false);
          // Classe active : le filtre posé par l'histogramme, rien d'autre.
          const b1 = { lo: 5, hi: 10, count: 3, last: false };
          assert.strictEqual(data.histogramBinIsActive(Object.assign({ column: 'Note' }, data.histogramFilter(b1)), b1), true);
          assert.strictEqual(data.histogramBinIsActive(Object.assign({ column: 'Note' }, data.histogramFilter({ lo: 5, hi: 10, last: true })), b1), false, 'même bornes mais fermée à droite : autre classe');
          assert.strictEqual(data.histogramBinIsActive({ column: 'Note', value: 5 }, b1), false);
          assert.strictEqual(data.histogramBinIsActive(undefined, b1), false);
          // Store : un clic de classe pose un filtre croisé `range`, le même clic le retire, une autre classe le remplace,
          // un filtre d'égalité sur la colonne est remplacé ; la tuile source garde son filtre jusqu'à sa suppression.
          const st = state.createStore();
          st.setRows(notes);
          st.addTile({ id: 'hs', type: 'histogram', measure: 'Note', title: 'H' });
          st.addTile({ id: 'bs', type: 'bar', dimension: 'id', measure: 'Note', aggFn: 'sum', title: 'B' });
          st.toggleRangeFilter('Note', data.histogramFilter(h.bins[1]), 'hs');
          assert.deepStrictEqual(st.getState().activeFilters, [{ column: 'Note', type: 'range', min: 5, max: 10, maxExclusive: true, sourceTileId: 'hs' }]);
          assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 10, 'l\'histogramme reste affiché en entier');
          assert.strictEqual(data.rowsForTile(st.getState().tiles[1], st.getState()).length, 3, 'les autres tuiles sont filtrées (5, 8, 8)');
          st.toggleRangeFilter('Note', data.histogramFilter(h.bins[1]), 'hs');
          assert.deepStrictEqual(st.getState().activeFilters, [], 'même classe : filtre retiré');
          st.toggleRangeFilter('Note', data.histogramFilter(h.bins[1]), 'hs');
          st.toggleRangeFilter('Note', data.histogramFilter(h.bins[3]), 'hs');
          assert.strictEqual(st.getState().activeFilters.length, 1); assert.strictEqual(st.getState().activeFilters[0].min, 15);
          assert.strictEqual(st.getState().activeFilters[0].maxExclusive, undefined, 'dernière classe : fermée à droite');
          st.toggleFilter('Note', 8, 'bs');
          assert.strictEqual(st.getState().activeFilters[0].value, 8); assert.strictEqual(st.getState().activeFilters[0].type, undefined, 'l\'égalité remplace la plage');
          st.toggleRangeFilter('Note', data.histogramFilter(h.bins[0]), 'hs');
          assert.strictEqual(st.getState().activeFilters[0].type, 'range', 'la plage remplace l\'égalité');
          st.removeTile('hs');
          assert.deepStrictEqual(st.getState().activeFilters, [], 'supprimer l\'histogramme lève son filtre');
          // Export Excel : mêmes classes et mêmes comptes que l'écran, filtres des autres tuiles appliqués.
          const hState = { rows: notes, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
          const hTile = { id: 'hx', type: 'histogram', title: 'Notes', measure: 'Note' };
          assert.strictEqual(data.tileExportKind(hTile), 'image');
          assert.deepStrictEqual(data.tileExportSheet(hTile, hState), { name: 'Notes', header: ['Note : borne basse', 'borne haute', 'Lignes'], rows: [[0, 5, 1], [5, 10, 3], [10, 15, 3], [15, 20, 3]] });
          const filteredState = Object.assign({}, hState, { activeFilters: [{ column: 'Note', value: 8, sourceTileId: 'autre' }] });
          assert.deepStrictEqual(data.tileExportSheet(hTile, filteredState).rows, [[0, 5, 0], [5, 10, 2], [10, 15, 0], [15, 20, 0]], 'grille inchangée, comptes filtrés');
          assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, hTile, { bins: 2 }), hState).rows.length, 2);
          // Types : palette et format oui, tri / séries / empilé non.
          assert.strictEqual(data.supportsPalette({ type: 'histogram' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'histogram' }), true);
          assert.strictEqual(data.isSortableTile({ type: 'histogram' }), false); assert.strictEqual(data.isSeriesTile({ type: 'histogram', seriesColumn: 'R' }), false);
          // Formulaire : valeurs par défaut (vraie mesure, ni dimension ni agrégat), conseils.
          const hd = advice.defaultsForType('histogram', big, ['Region', 'Montant']);
          assert.ok(hd && hd.measure && !hd.dimension && hd.aggFn === undefined, 'colonne numérique préremplie, ni dimension ni agrégat');
          assert.strictEqual(advice.defaultsForType('histogram', [{ Region: 'N' }, { Region: 'S' }], ['Region']), null, 'aucune colonne numérique : rien à préremplir');
          assert.strictEqual(advice.adviceForType('histogram', [{ Region: 'N' }, { Region: 'S' }], ['Region']).key, 'advice.fit.noMeasure');
          assert.strictEqual(advice.TILE_TYPES.includes('histogram'), false, 'jamais proposé à l\'accueil');
          const few = [1, 2, 1, 2, 3].map((Note) => ({ Note }));
          assert.strictEqual(advice.adviceForTile({ type: 'histogram', measure: 'Note' }, few).key, 'advice.histogram.fewValues');
          assert.strictEqual(advice.adviceForTile({ type: 'histogram', measure: 'Note' }, twenty.map((r) => ({ Note: r.v }))), null);
          assert.strictEqual(advice.adviceForType('histogram', notes, ['Note']).key, 'advice.use.histogram');
          ['tileForm.type.histogram', 'tileForm.measure.labelHistogram', 'tileForm.bins.label', 'tileForm.bins.placeholder', 'tileForm.bins.hint', 'tileForm.error.binsRange',
            'tileTitle.histogram', 'chart.histogram.empty', 'chart.histogram.rows', 'filters.rangeExclusive', 'advice.use.histogram', 'advice.histogram.fewValues']
            .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
          i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.histogram.rows', { n: 1, count: 1 }), '1 ligne'); assert.strictEqual(i18n.t('chart.histogram.rows', { n: '12', count: 12 }), '12 lignes');
          i18n.setLang('en'); assert.strictEqual(i18n.t('chart.histogram.rows', { n: 1, count: 1 }), '1 row'); i18n.setLang('fr');
          // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
          const mainSrc5 = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
          const chartsSrc5 = fs.readFileSync(path.join(root, 'js', 'charts.js'), 'utf8');
          const indexSrc5 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
          assert.ok(/const TYPE_CARDS = \[[^\]]*'histogram'/.test(mainSrc5) && /<option value="histogram"/.test(indexSrc5) && /id="tile-bins"/.test(indexSrc5));
          assert.ok(/currentTile\.type === 'histogram'/.test(chartsSrc5) && /toggleRangeFilter\(currentTile\.measure/.test(chartsSrc5), 'le clic d\'une classe pose un filtre par plage');
          assert.ok(!/sameValue\([a-zA-Z]*(Filter|OnThisDimension)\.value/.test(chartsSrc5), 'plus de comparaison d\'égalité seule sur un filtre actif : filterSelects');
          assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsSrc5), 'aucun format de nombre en dur dans charts.js');
          console.log('OK histogramme — classes rondes, bornes, vides ignorés, grille stable, cohérence classe/filtre, store (plage), export, défauts, conseil et i18n');
        }
      }
    }
  }

  // Carte de chaleur (`type: 'heatmap'`) et tableau croisé coloré (`tile.pivotHeat`) : rampes, couleur du texte, grille, filtres de case,
  // export, défauts, conseil, i18n, câblage.
  {
    const fsH = require('fs');
    const pathH = require('path');
    const rootH = pathH.join(__dirname, '..');
    const hex = /^#[0-9a-f]{6}$/;
    const lum = (h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

    // Rampes : 4 arrêts, du plus clair au plus foncé (luminance strictement décroissante), tirées des dégradés validés de PALETTES.
    assert.deepStrictEqual(Object.keys(data.HEAT_RAMPS), ['blue', 'orange', 'green', 'gray']);
    Object.entries(data.HEAT_RAMPS).forEach(([key, stops]) => {
      assert.strictEqual(stops.length, 4, key);
      stops.forEach((c) => assert.ok(hex.test(c), key + ' ' + c));
      for (let i = 1; i < stops.length; i++) assert.ok(lum(stops[i]) < lum(stops[i - 1]), key + ' : clair -> foncé, arrêt ' + i);
      assert.deepStrictEqual(stops.slice(1), [data.PALETTES[key][5], data.PALETTES[key][3], data.PALETTES[key][0]], key + ' reprend le dégradé validé de PALETTES');
    });
    // Palette catégorielle ou inconnue : le bleu ; clé piégée : jamais une propriété d'Object.
    for (const key of [undefined, null, '', 'standard', 'okabe', 'inconnue', 'constructor', '__proto__', 'toString', 42]) assert.strictEqual(data.heatStops(key), data.HEAT_RAMPS.blue, String(key));
    assert.strictEqual(data.heatStops('orange'), data.HEAT_RAMPS.orange);

    // heatColor : bornes exactes, interpolation, hors bornes et NaN ramenés dans [0 ; 1], luminance monotone.
    const blue = data.HEAT_RAMPS.blue;
    assert.strictEqual(data.heatColor(0, blue), blue[0]);
    assert.strictEqual(data.heatColor(1, blue), blue[3]);
    assert.strictEqual(data.heatColor(1 / 3, blue), blue[1], 'arrêts régulièrement espacés');
    assert.strictEqual(data.heatColor(-5, blue), blue[0]); assert.strictEqual(data.heatColor(9, blue), blue[3]); assert.strictEqual(data.heatColor(NaN, blue), blue[0]);
    for (const stops of Object.values(data.HEAT_RAMPS)) {
      let prev = Infinity;
      for (let i = 0; i <= 40; i++) { const c = data.heatColor(i / 40, stops); assert.ok(hex.test(c), c); const l = lum(c); assert.ok(l <= prev + 1e-9, 'luminance non croissante le long de la rampe'); prev = l; }
    }

    // Texte blanc ou noir : celui des deux qui contraste le plus ; jamais sous 4,5:1 sur aucune couleur d'aucune rampe.
    assert.strictEqual(data.heatTextColor('#eef4fc'), '#000000'); assert.strictEqual(data.heatTextColor('#002f63'), '#ffffff');
    let worst = Infinity;
    for (const stops of Object.values(data.HEAT_RAMPS)) {
      for (let i = 0; i <= 100; i++) {
        const bg = data.heatColor(i / 100, stops);
        const fg = data.heatTextColor(bg);
        assert.ok(fg === '#000000' || fg === '#ffffff');
        const ratio = contrast(bg, fg);
        worst = Math.min(worst, ratio);
        assert.ok(ratio >= 4.5, 'contraste ' + ratio.toFixed(2) + ' sur ' + bg);
        assert.ok(ratio + 1e-9 >= contrast(bg, fg === '#ffffff' ? '#000000' : '#ffffff'), 'le meilleur des deux');
      }
    }

    // Grille : bornes, cellule sans valeur (null, vide, booléen, texte) ni couleur ni influence sur l'échelle.
    assert.deepStrictEqual(data.heatRange([[1, null], [5, '']]), { min: 1, max: 5 });
    assert.deepStrictEqual(data.heatRange([['4', 2.5], [true, false]]), { min: 2.5, max: 4 }, 'chaîne numérique comptée, booléens jamais');
    assert.strictEqual(data.heatRange([]), null); assert.strictEqual(data.heatRange([[null, null]]), null); assert.strictEqual(data.heatRange(null), null);
    const grid = [[10, null, 50], [30, 0, 'x']];
    const hc = data.heatCellColors(grid, blue);
    assert.strictEqual(hc[0][0] && hc[0][0].bg, data.heatColor(0.2, blue));
    assert.strictEqual(hc[0][1], null, 'intersection sans donnée : aucune couleur, jamais « la plus claire »');
    assert.strictEqual(hc[1][2], null, 'texte : aucune couleur');
    assert.strictEqual(hc[1][1].bg, blue[0], 'le minimum (0) est le plus clair'); assert.strictEqual(hc[0][2].bg, blue[3], 'le maximum est le plus foncé');
    assert.strictEqual(hc[0][2].fg, '#ffffff'); assert.strictEqual(hc[1][1].fg, '#000000');
    // Toutes les valeurs égales : couleur du milieu ; aucune valeur : que des null ; négatifs : l'échelle s'ajuste.
    assert.deepStrictEqual(data.heatCellColors([[7, 7]], blue).map((l) => l.map((c) => c.bg)), [[data.heatColor(0.5, blue), data.heatColor(0.5, blue)]]);
    assert.deepStrictEqual(data.heatCellColors([[null]], blue), [[null]]); assert.deepStrictEqual(data.heatCellColors([], blue), []);
    const neg = data.heatCellColors([[-10, 0, 10]], blue)[0];
    assert.strictEqual(neg[0].bg, blue[0]); assert.strictEqual(neg[2].bg, blue[3]); assert.strictEqual(neg[1].bg, data.heatColor(0.5, blue));
    // Valeurs BigInt de DuckDB : une cellule BigInt n'est jamais une couleur (les cellules numériques du pivot sont des Number).
    assert.doesNotThrow(() => data.heatCellColors([[1, 2n]], blue));

    // Clic sur une case : quels toggleFilter, sans lever le filtre d'une ligne déjà choisie.
    const eq = (column, value) => ({ column, value, sourceTileId: 'h' });
    assert.deepStrictEqual(data.cellFilterToggles([], 'Region', 'Nord', 'Produit', 'A'), [{ column: 'Region', value: 'Nord' }, { column: 'Produit', value: 'A' }], 'rien de posé : les deux');
    assert.deepStrictEqual(data.cellFilterToggles([eq('Region', 'Nord'), eq('Produit', 'A')], 'Region', 'Nord', 'Produit', 'A'), [{ column: 'Region', value: 'Nord' }, { column: 'Produit', value: 'A' }], 'déjà la sélection : les deux, qui la retirent');
    assert.deepStrictEqual(data.cellFilterToggles([eq('Region', 'Nord'), eq('Produit', 'A')], 'Region', 'Nord', 'Produit', 'B'), [{ column: 'Produit', value: 'B' }], 'autre case de la même ligne : la ligne reste');
    assert.deepStrictEqual(data.cellFilterToggles([eq('Region', 'Nord')], 'Region', 'Sud', 'Produit', 'A'), [{ column: 'Region', value: 'Sud' }, { column: 'Produit', value: 'A' }]);
    assert.deepStrictEqual(data.cellFilterToggles([{ column: 'Region', type: 'range', min: 0, max: 5 }], 'Region', '3', 'Produit', 'A').map((c) => c.column), ['Region', 'Produit'], 'un filtre de plage n\'est pas une égalité');
    {
      const st = state.createStore();
      st.setRows([{ Region: 'Nord', Produit: 'A', M: 1 }, { Region: 'Nord', Produit: 'B', M: 2 }, { Region: 'Sud', Produit: 'A', M: 4 }]);
      st.addTile({ id: 'hm', type: 'heatmap', dimension: 'Region', columnDimension: 'Produit', measure: 'M', aggFn: 'sum', title: 'H' });
      const click = (r, c) => data.cellFilterToggles(st.getState().activeFilters, 'Region', r, 'Produit', c).forEach((x) => st.toggleFilter(x.column, x.value, 'hm'));
      click('Nord', 'A');
      assert.deepStrictEqual(st.getState().activeFilters.map((f) => [f.column, f.value]), [['Region', 'Nord'], ['Produit', 'A']]);
      click('Nord', 'B');
      assert.deepStrictEqual(st.getState().activeFilters.map((f) => [f.column, f.value]), [['Region', 'Nord'], ['Produit', 'B']], 'la ligne Nord reste filtrée');
      click('Nord', 'B');
      assert.deepStrictEqual(st.getState().activeFilters, [], 'un 2e clic sur la même case retire les deux filtres');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 3, 'la carte reste affichée en entier');
    }

    // Types : palette (carte toujours ; tableau croisé seulement coloré), format oui, tri / séries / empilé non.
    assert.strictEqual(data.supportsPalette({ type: 'heatmap' }), true);
    assert.strictEqual(data.supportsPalette({ type: 'pivot' }), false); assert.strictEqual(data.supportsPalette({ type: 'pivot', pivotHeat: false }), false);
    assert.strictEqual(data.supportsPalette({ type: 'pivot', pivotHeat: true }), true);
    assert.strictEqual(data.supportsNumberFormat({ type: 'heatmap' }), true);
    assert.strictEqual(data.isSortableTile({ type: 'heatmap' }), false); assert.strictEqual(data.isSeriesTile({ type: 'heatmap', seriesColumn: 'R' }), false);
    assert.strictEqual(data.isStackedTile({ type: 'heatmap', seriesColumn: 'R', stacked: true }), false);

    // Export Excel : la même grille que le tableau croisé (cases vides vides, Total en plus) ; la couleur n'est pas exportée.
    const hmRows = [{ Region: 'Nord', Produit: 'A', M: 10 }, { Region: 'Nord', Produit: 'B', M: 5 }, { Region: 'Sud', Produit: 'A', M: 30 }];
    const hmState = { rows: hmRows, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const hmTile = { id: 'hx', type: 'heatmap', title: 'Carte', dimension: 'Region', columnDimension: 'Produit', measure: 'M', aggFn: 'sum' };
    assert.strictEqual(data.tileExportKind(hmTile), 'image');
    const hmSheet = data.tileExportSheet(hmTile, hmState);
    assert.deepStrictEqual(hmSheet, Object.assign({}, data.tileExportSheet(Object.assign({}, hmTile, { type: 'pivot' }), hmState), { name: 'Carte' }));
    assert.deepStrictEqual(hmSheet.header, ['Region', 'A', 'B', 'Total']);
    assert.deepStrictEqual(hmSheet.rows, [['Nord', 10, 5, 15], ['Sud', 30, '', 30], ['Total', 40, 5, 45]]);
    assert.strictEqual(data.tileExportKind(Object.assign({}, hmTile, { type: 'pivot', pivotHeat: true })), 'table', 'le tableau croisé reste un tableau, coloré ou non');

    // Formulaire : valeurs par défaut (deux vraies catégories, comme le tableau croisé), conseils.
    const cats = [];
    ['Nord', 'Sud', 'Est'].forEach((Region) => ['A', 'B', 'C'].forEach((Produit) => cats.push({ Region, Produit, Montant: 10 + cats.length })));
    const hd = advice.defaultsForType('heatmap', cats, ['Region', 'Produit', 'Montant']);
    assert.ok(hd && hd.dimension && hd.columnDimension && hd.dimension !== hd.columnDimension && hd.measure === 'Montant', 'deux catégories différentes et une mesure préremplies');
    assert.strictEqual(advice.adviceForType('heatmap', cats.map((r) => ({ Region: r.Region, Montant: r.Montant })), ['Region', 'Montant']).key, 'advice.fit.needTwoDimensions');
    assert.strictEqual(advice.adviceForType('heatmap', cats, ['Region', 'Produit', 'Montant']).key, 'advice.use.heatmap');
    assert.strictEqual(advice.TILE_TYPES.includes('heatmap'), false, 'jamais proposé à l\'accueil');
    assert.deepStrictEqual(advice.suggestTiles(cats, ['Region', 'Produit', 'Montant'], { limit: 30, t: (k) => k }).filter((c) => c.type === 'heatmap'), []);
    assert.strictEqual(advice.adviceForTile({ type: 'heatmap', dimension: 'Region', columnDimension: 'Produit', measure: 'Montant', aggFn: 'sum' }, cats), null);
    const wide = [];
    for (let i = 0; i < 30; i++) for (let j = 0; j < 3; j++) wide.push({ J: 'j' + i, H: 'h' + j, M: i + j });
    const tooBig = advice.adviceForTile({ type: 'heatmap', dimension: 'J', columnDimension: 'H', measure: 'M', aggFn: 'sum' }, wide);
    assert.deepStrictEqual([tooBig.key, tooBig.level, tooBig.vars], ['advice.heatmap.tooBig', 'warn', { rows: 30, columns: 3 }]);
    assert.strictEqual(advice.adviceForTile({ type: 'heatmap', dimension: 'H', columnDimension: 'J', measure: 'M', aggFn: 'sum' }, wide).key, 'advice.heatmap.tooBig', 'trop de colonnes aussi');
    assert.strictEqual(advice.previewFor({ type: 'heatmap', dimension: 'Region', columnDimension: 'Produit', measure: 'Montant', aggFn: 'sum' }, cats).kind, 'grid');

    // i18n fr/en, titre automatique.
    ['tileForm.type.heatmap', 'tileForm.pivotHeat.label', 'tileForm.palette.heatHint', 'tileTitle.heatmap', 'chart.heatmap.empty', 'advice.use.heatmap', 'advice.heatmap.tooBig']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('en');
    assert.strictEqual(i18n.tileTitle({ title: 'x', titleKey: 'tileTitle.heatmap', titleVars: { measure: 'M', dimension: 'A', columnDimension: 'B' } }), 'M by A × B');
    assert.strictEqual(i18n.t('advice.heatmap.tooBig', { rows: 30, columns: 3 }).includes('30 rows × 3 columns'), true);
    i18n.setLang('fr');

    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainH = fsH.readFileSync(pathH.join(rootH, 'js', 'main.js'), 'utf8');
    const chartsH = fsH.readFileSync(pathH.join(rootH, 'js', 'charts.js'), 'utf8');
    const indexH = fsH.readFileSync(pathH.join(rootH, 'index.html'), 'utf8');
    assert.ok(/const TYPE_CARDS = \[[^\]]*'heatmap'/.test(mainH) && /<option value="heatmap"/.test(indexH) && /id="tile-pivot-heat"/.test(indexH) && /'type-heatmap'/.test(mainH));
    assert.ok(/currentTile\.type === 'heatmap'/.test(chartsH) && /toggleCellFilters\(currentTile/.test(chartsH), 'le clic d\'une case pose les filtres de la ligne et de la colonne');
    assert.ok(/type: 'heatmap'/.test(chartsH) && /visualMap/.test(chartsH) && /inverse: true/.test(chartsH));
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsH), 'aucun format de nombre en dur dans charts.js');
    // Seules des couleurs CALCULÉES (hex des rampes) entrent dans un attribut `style` du tableau croisé, jamais une chaîne de la configuration.
    assert.ok(/style="background:\$\{c\.bg\};color:\$\{c\.fg\}"/.test(chartsH) && !/style="[^"]*\$\{tile\./.test(chartsH));
    // Carte de chaleur et pivot restent hors drill-down (deux dimensions déjà affichées en même temps).
    assert.ok(/type !== 'heatmap'/.test(mainH));
    const cssH = fsH.readFileSync(pathH.join(rootH, 'css', 'style.css'), 'utf8');
    assert.ok(/\.pivot-heat \.pivot-cell\.pivot-active/.test(cssH), 'une cellule colorée sélectionnée reste repérable (contour, pas un fond écrasé par la couleur)');
    console.log('OK carte de chaleur et tableau croisé coloré — rampes, contraste du texte (min ' + worst.toFixed(1) + ':1), grille, clic de case, export, défauts, conseil et i18n');
  }

  // Ligne de repère (`tile.refLine` / `tile.refValue`) : moyenne des valeurs affichées ou objectif saisi, sur barres et courbe.
  {
    const fsR = require('fs');
    const pathR = require('path');
    const rootR = pathR.join(__dirname, '..');
    assert.deepStrictEqual(data.REF_LINE_KINDS, ['average', 'value']);
    // Types : barres (hors mode mesure temporelle) et courbe seulement.
    for (const tile of [{ type: 'bar' }, { type: 'bar', measureMode: 'brut' }, { type: 'bar', measureMode: undefined }, { type: 'line' }, { type: 'line', areaFill: true }]) assert.strictEqual(data.supportsRefLine(tile), true, JSON.stringify(tile));
    for (const tile of [{ type: 'bar', measureMode: 'ytd' }, { type: 'bar', measureMode: 'cumulative' }, { type: 'pie' }, { type: 'kpi' }, { type: 'combo' }, { type: 'histogram' }, { type: 'heatmap' }, { type: 'pivot' }, { type: 'radar' }, null, undefined]) assert.strictEqual(data.supportsRefLine(tile), false, JSON.stringify(tile));
    // Genre tracé : une clé inconnue, un objectif sans nombre valide, un type qui n'en porte pas -> aucune ligne.
    assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'average' }), 'average');
    assert.strictEqual(data.refLineKind({ type: 'line', refLine: 'average', refValue: 'abc' }), 'average', 'la moyenne ignore refValue');
    assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'value', refValue: 100 }), 'value');
    assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'value', refValue: 0 }), 'value', 'zéro est un objectif valide');
    assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'value', refValue: '12,5' }), '', 'texte non numérique');
    assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'value', refValue: '12.5' }), 'value', 'chaîne numérique');
    for (const refValue of [undefined, null, '', 'abc', NaN, Infinity, true, false]) assert.strictEqual(data.refLineKind({ type: 'bar', refLine: 'value', refValue }), '', String(refValue));
    for (const refLine of [undefined, '', 'median', 'constructor', '__proto__', 1]) assert.strictEqual(data.refLineKind({ type: 'bar', refLine, refValue: 5 }), '', String(refLine));
    assert.strictEqual(data.refLineKind({ type: 'pie', refLine: 'average' }), '');
    assert.strictEqual(data.refLineKind({ type: 'bar', measureMode: 'ytd', refLine: 'average' }), '');
    // Valeur : l'objectif saisi, ou la moyenne des valeurs affichées (vides ignorés, jamais comptés comme 0).
    const bar = { type: 'bar', refLine: 'average' };
    assert.strictEqual(data.refLineValue(bar, [10, null, 20, '', 30]), 20);
    assert.strictEqual(data.refLineValue(bar, [10, 20, 30, 0]), 15, 'un vrai zéro compte');
    assert.strictEqual(data.refLineValue(bar, [-10, 10, 30]), 10);
    assert.strictEqual(data.refLineValue(bar, [4n, 6n]), 5, 'BigInt de DuckDB');
    assert.strictEqual(data.refLineValue(bar, ['4', 6]), 5, 'chaîne numérique');
    assert.strictEqual(data.refLineValue(bar, [true, 'x', null]), null, 'aucune valeur numérique : pas de ligne');
    assert.strictEqual(data.refLineValue(bar, []), null); assert.strictEqual(data.refLineValue(bar, undefined), null);
    assert.strictEqual(data.refLineValue({ type: 'bar', refLine: 'value', refValue: 7.5 }, []), 7.5, 'objectif : indépendant des valeurs');
    assert.strictEqual(data.refLineValue({ type: 'bar', refLine: 'value', refValue: -3 }, [1, 2]), -3);
    assert.strictEqual(data.refLineValue({ type: 'bar' }, [1, 2]), null); assert.strictEqual(data.refLineValue({ type: 'pie', refLine: 'average' }, [1, 2]), null);
    // Moyenne sans bruit de flottant visible : l'affichage passe par js/format.js (« 0,2 »), pas par la valeur brute.
    assert.ok(Math.abs(data.refLineValue(bar, [0.1, 0.2, 0.3]) - 0.2) < 1e-12);
    // Le store garde et efface les deux champs ; l'export Excel n'en dépend pas.
    {
      const st = state.createStore();
      st.setRows([{ R: 'A', M: 1 }, { R: 'B', M: 3 }]);
      st.addTile({ id: 'r1', type: 'bar', dimension: 'R', measure: 'M', aggFn: 'sum', title: 'T', refLine: 'value', refValue: 2 });
      assert.deepStrictEqual([st.getState().tiles[0].refLine, st.getState().tiles[0].refValue], ['value', 2]);
      const rState = { rows: [{ R: 'A', M: 1 }, { R: 'B', M: 3 }], activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
      const withRef = data.tileExportSheet(st.getState().tiles[0], rState);
      st.updateTile('r1', { refLine: undefined, refValue: undefined });
      assert.strictEqual(st.getState().tiles[0].refLine, undefined);
      assert.deepStrictEqual(data.tileExportSheet(st.getState().tiles[0], rState), withRef, 'la ligne de repère n\'est pas exportée : même feuille');
    }
    ['tileForm.refLine.label', 'tileForm.refLine.none', 'tileForm.refLine.average', 'tileForm.refLine.value', 'tileForm.refValue.label', 'tileForm.error.refValueRequired', 'chart.refLine.average', 'chart.refLine.value']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    // Libellé d'une ligne horizontale : HORS de la zone de tracé (à droite), sur deux lignes, jamais plus de ~22 % de la tuile
    // (posé dedans il cachait la fin de la courbe et la dernière barre).
    {
      const fmtR = require('../js/format.js');
      const measureR = (text, px) => String(text).length * px * 0.56; // estimation : le navigateur mesure avec un canvas
      for (const width of [180, 224, 270, 340, 640]) {
        for (const [name, value] of [['Moyenne', '816 559'], ['Objectif', '900 000'], ['Moyenne', '1 234 567,89'], ['Average', '0,2'], ['Objectif', '12 345 678 901,23']]) {
          const lay = fmtR.refLabelLayout([name, value], width, measureR);
          assert.strictEqual(lay.text, `${name}\n${value}`);
          assert.ok(lay.font >= 9 && lay.font <= 11, `taille ${lay.font}`);
          assert.ok(lay.reserve <= Math.max(Math.ceil(width * 0.22) + 1, 30 + 13), `${width} px : marge ${lay.reserve} <= 22 % de la tuile (plancher : 30 px de texte)`);
          assert.ok(lay.reserve >= 16, 'au moins la marge historique de la grille (16 px)');
          // Ce qui est réservé contient le texte (dans la limite du tiers) : jamais de libellé qui sorte de la tuile.
          const widest = Math.max(measureR(name, lay.font), measureR(value, lay.font));
          if (lay.width == null) assert.ok(widest + 6 + 5 + 2 <= lay.reserve + 1, `${width} px, « ${value} » : le texte tient dans la marge`);
          else assert.ok(lay.width + 6 + 5 + 2 <= lay.reserve + 1, 'texte tronqué : la largeur demandée tient dans la marge');
        }
      }
      // Large tuile et texte court : taille pleine, rien de tronqué ; petite tuile et nombre long : réduit, puis tronqué en dernier recours.
      const roomy = fmtR.refLabelLayout(['Moyenne', '816 559'], 640, measureR);
      assert.deepStrictEqual([roomy.font, roomy.width], [11, null]);
      const tight = fmtR.refLabelLayout(['Objectif', '12 345 678 901,23'], 180, measureR);
      assert.ok(tight.font < 11 && tight.width !== null && tight.width > 0, 'réduit puis tronqué');
      assert.strictEqual(fmtR.refLabelLayout('Seul', 270, measureR).text, 'Seul', 'une chaîne seule est acceptée');
      assert.doesNotThrow(() => fmtR.refLabelLayout([], 0, measureR));
      assert.doesNotThrow(() => fmtR.refLabelLayout([null, undefined], NaN, measureR));
    }
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainR = fsR.readFileSync(pathR.join(rootR, 'js', 'main.js'), 'utf8');
    const chartsR = fsR.readFileSync(pathR.join(rootR, 'js', 'charts.js'), 'utf8');
    const indexR = fsR.readFileSync(pathR.join(rootR, 'index.html'), 'utf8');
    assert.ok(/id="tile-refline"/.test(indexR) && /id="tile-refvalue"/.test(indexR) && /<label for="tile-refvalue"/.test(indexR), 'champs étiquetés');
    assert.ok(/supportsRefLine\(\{ type, measureMode/.test(mainR) && /tileData\.refLine = refKind \|\| undefined/.test(mainR));
    assert.ok(/markLine/.test(chartsR) && /function addRefLine/.test(chartsR) && /refLineValue\(tile, groups\.map/.test(chartsR), 'la moyenne se calcule sur les valeurs AFFICHÉES (groupes triés/drillés)');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsR), 'aucun format de nombre en dur dans charts.js');
    assert.ok(/label\.position = 'end'/.test(chartsR) && !/insideEndTop/.test(chartsR), 'libellé d\'un trait horizontal : hors de la zone de tracé, jamais « insideEndTop »');
    assert.ok(/option\.grid = \{ \.\.\.grid, right: Math\.max\(/.test(chartsR), 'marge prise sur une COPIE de la grille (numericGrid est partagée)');
    console.log('OK ligne de repère — types, genre tracé, objectif invalide, moyenne (vides, BigInt), store, export inchangé, i18n, câblage');
  }

  // Options d'affichage : étiquettes de valeur, tracé de la courbe (lissé / escalier), 100 % empilé.
  {
    const fsD = require('fs');
    const pathD = require('path');
    const rootD = pathD.join(__dirname, '..');
    // Tracé de la courbe : courbe/aire seulement, clé inconnue ou piégée -> droit.
    assert.deepStrictEqual(data.LINE_SHAPES, ['smooth', 'step']);
    assert.strictEqual(data.lineShapeOf({ type: 'line', lineShape: 'smooth' }), 'smooth');
    assert.strictEqual(data.lineShapeOf({ type: 'line', lineShape: 'step' }), 'step');
    for (const lineShape of [undefined, '', 'straight', 'constructor', '__proto__', 1, null]) assert.strictEqual(data.lineShapeOf({ type: 'line', lineShape }), '', String(lineShape));
    for (const type of ['bar', 'pie', 'combo', 'kpi']) assert.strictEqual(data.lineShapeOf({ type, lineShape: 'smooth' }), '', type);
    assert.strictEqual(data.lineShapeOf(null), '');
    // Étiquettes de valeur : mêmes types que la ligne de repère (barres hors mode mesure, courbe).
    for (const tile of [{ type: 'bar' }, { type: 'bar', measureMode: 'brut' }, { type: 'line' }]) assert.strictEqual(data.supportsValueLabels(tile), true, JSON.stringify(tile));
    for (const tile of [{ type: 'bar', measureMode: 'yoy' }, { type: 'pie' }, { type: 'combo' }, { type: 'histogram' }, { type: 'heatmap' }, null]) assert.strictEqual(data.supportsValueLabels(tile), false, JSON.stringify(tile));
    // 100 % empilé : seulement une pile (colonne Séries + empilé), barres ou aire.
    const pile = { type: 'bar', dimension: 'R', measure: 'M', aggFn: 'sum', seriesColumn: 'P', stacked: true, stackPercent: true };
    assert.strictEqual(data.isStackedPercentTile(pile), true);
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { type: 'line', areaFill: true })), true);
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { type: 'line' })), false, 'une courbe sans aire n\'est pas une pile');
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { stacked: false })), false, '100 % sans « Empiler » : ignoré');
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { seriesColumn: '' })), false);
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { stackPercent: false })), false);
    assert.strictEqual(data.isStackedPercentTile(Object.assign({}, pile, { measureMode: 'ytd' })), false);
    assert.strictEqual(data.isStackedPercentTile(null), false);
    // Parts : somme 100, cellule absente reste absente, total non positif -> aucune part, BigInt, texte numérique.
    assert.deepStrictEqual(data.shareOfTotal([1, 3]), [25, 75]);
    assert.deepStrictEqual(data.shareOfTotal([5, null, 5]), [50, null, 50]);
    assert.deepStrictEqual(data.shareOfTotal([7]), [100]);
    assert.deepStrictEqual(data.shareOfTotal([0, 0]), [null, null], 'total nul : pas de 0 % trompeur');
    assert.deepStrictEqual(data.shareOfTotal([-5, 2]), [null, null], 'total négatif : aucune part');
    assert.deepStrictEqual(data.shareOfTotal([1n, 3n]), [25, 75]);
    assert.deepStrictEqual(data.shareOfTotal(['1', 3, '', true]), [25, 75, null, null]);
    assert.deepStrictEqual(data.shareOfTotal([]), []); assert.deepStrictEqual(data.shareOfTotal(undefined), []);
    assert.deepStrictEqual(data.shareOfTotal([-10, 30]), [-50, 150], 'négatifs dans une pile positive : part sans sens, le conseil le signale');
    const total = data.shareOfTotal([0.1, 0.2, 0.7]).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, 'somme à 100 (flottants)');
    // Tout le graphique : chaque colonne somme à 100, séries de longueurs inégales, vide.
    const sh = data.stackShares([[10, 0, null], [30, 0, 5], [60, 0, 5]]);
    assert.deepStrictEqual(sh, [[10, null, null], [30, null, 50], [60, null, 50]]);
    for (const c of [0, 2]) assert.ok(Math.abs(sh.reduce((a, srs) => a + (srs[c] || 0), 0) - 100) < 1e-9, 'colonne ' + c);
    assert.deepStrictEqual(data.stackShares([[1, 1], [1]]), [[50, 100], [50, null]]);
    assert.deepStrictEqual(data.stackShares([]), []); assert.deepStrictEqual(data.stackShares(undefined), []);
    // Export Excel : les trois options n'y changent rien (valeurs brutes, comme avant).
    const dRows = [{ R: 'A', P: 'x', M: 10 }, { R: 'A', P: 'y', M: 30 }, { R: 'B', P: 'x', M: 20 }];
    const dState = { rows: dRows, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const plainSheet = data.tileExportSheet(Object.assign({ id: 'p', title: 'T' }, pile, { stackPercent: undefined }), dState);
    assert.deepStrictEqual(data.tileExportSheet(Object.assign({ id: 'p', title: 'T' }, pile, { valueLabels: true }), dState), plainSheet, '100 % et étiquettes : même feuille');
    assert.deepStrictEqual(data.tileExportSheet({ id: 'l', title: 'L', type: 'line', dimension: 'R', measure: 'M', aggFn: 'sum', lineShape: 'smooth' }, dState), data.tileExportSheet({ id: 'l', title: 'L', type: 'line', dimension: 'R', measure: 'M', aggFn: 'sum' }, dState));
    // Conseil : des valeurs négatives en 100 % ; rien sans négatif, rien si ce n'est pas du 100 %.
    const negRows = [{ R: 'A', P: 'x', M: 10 }, { R: 'A', P: 'y', M: -3 }, { R: 'B', P: 'x', M: 5 }];
    assert.strictEqual(advice.adviceForTile(pile, negRows).key, 'advice.stackedPercent.negative');
    assert.strictEqual(advice.adviceForTile(pile, dRows), null);
    assert.strictEqual(advice.adviceForTile(Object.assign({}, pile, { stackPercent: false }), negRows), null, 'pile ordinaire : pas ce conseil');
    assert.strictEqual(advice.adviceForTile(Object.assign({}, pile, { aggFn: 'avg' }), dRows).key, 'advice.stacked.notAdditive', 'le conseil existant prime');
    ['tileForm.stackPercent.label', 'tileForm.lineShape.label', 'tileForm.lineShape.straight', 'tileForm.lineShape.smooth', 'tileForm.lineShape.step', 'tileForm.valueLabels.label', 'advice.stackedPercent.negative']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainD = fsD.readFileSync(pathD.join(rootD, 'js', 'main.js'), 'utf8');
    const chartsD = fsD.readFileSync(pathD.join(rootD, 'js', 'charts.js'), 'utf8');
    const indexD = fsD.readFileSync(pathD.join(rootD, 'index.html'), 'utf8');
    for (const id of ['tile-stack-percent', 'tile-line-shape', 'tile-value-labels']) assert.ok(new RegExp(`id="${id}"`).test(indexD) && new RegExp(`<label for="${id}"`).test(indexD), 'champ étiqueté : ' + id);
    assert.ok(/stackPercentCheckbox\.addEventListener\('change', updateFormFieldsForType\)/.test(mainD) && /stackedCheckbox\.addEventListener\('change', updateFormFieldsForType\)/.test(mainD), 'cocher/décocher recalcule les champs visibles');
    assert.ok(/tileData\.stackPercent = \(tileData\.stacked && stackPercentCheckbox\.checked\)/.test(mainD), 'le 100 % ne s\'écrit que sur une pile');
    assert.ok(/stackShares\(/.test(chartsD) && /labelLayout: \{ hideOverlap: true \}/.test(chartsD) && /step: 'middle'/.test(chartsD) && /if \(!stackPct && option\.series/.test(chartsD), 'pas de ligne de repère brute sur un axe en %');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsD), 'aucun format de nombre en dur dans charts.js');
    console.log('OK options d\'affichage — tracé de la courbe, étiquettes, 100 % empilé (parts, colonnes, négatifs), export inchangé, conseil, i18n, câblage');
  }

  // Boîte à moustaches (type 'box', 18/11/2026, lot 3 de l'étude des tuiles usuelles) : quantiles, moustaches de Tukey, aberrantes,
  // valeurs ignorées, plafond de points tracés, clic (filtre de groupe), export, défauts, conseils, i18n, câblage.
  {
    const fsB = require('fs');
    const pathB = require('path');
    const rootB = pathB.join(__dirname, '..');
    // Quantiles (type 7, comme QUARTILE.INC d'Excel et quantile_cont de DuckDB) : valeurs de référence calculées à la main.
    const q = data.quantileSorted;
    assert.strictEqual(q([], 0.5), null);
    assert.strictEqual(q([7], 0.25), 7); assert.strictEqual(q([7], 0.75), 7);
    assert.strictEqual(q([1, 2, 3, 4], 0.5), 2.5, 'médiane d\'un effectif pair : moyenne des deux du milieu');
    assert.strictEqual(q([1, 2, 3, 4], 0.25), 1.75); assert.strictEqual(q([1, 2, 3, 4], 0.75), 3.25);
    assert.strictEqual(q([1, 2, 3, 4, 5], 0.25), 2); assert.strictEqual(q([1, 2, 3, 4, 5], 0.5), 3); assert.strictEqual(q([1, 2, 3, 4, 5], 0.75), 4);
    assert.strictEqual(q([10, 20], 0), 10); assert.strictEqual(q([10, 20], 1), 20); assert.strictEqual(q([10, 20], 5), 20, 'p borné à [0 ; 1]');
    // Un groupe de référence : [2,4,4,4,5,5,7,9,100] -> Q1 4, médiane 5, Q3 7, EIQ 3, barrière haute 11,5 : 100 est aberrante.
    const sample = [];
    [2, 4, 4, 4, 5, 5, 7, 9, 100].forEach((v) => sample.push({ g: 'A', v }));
    [1, 2, 3, 4].forEach((v) => sample.push({ g: 'B', v }));
    sample.push({ g: 'C', v: null }, { g: 'D', v: 'x' }, { g: 'E', v: '' }, { g: 'A', v: true }, { g: 'F', v: NaN });
    const bs = data.boxStatsByGroup(sample, 'g', 'v');
    assert.deepStrictEqual(bs.groups.map((g) => g.name), ['A', 'B'], 'ordre de première apparition ; un groupe sans valeur numérique n\'a pas de boîte');
    assert.strictEqual(bs.ignored, 5, 'null, texte, vide, booléen et NaN : ignorés, jamais comptés comme 0');
    const gA = bs.groups[0];
    assert.deepStrictEqual([gA.n, gA.min, gA.max, gA.q1, gA.median, gA.q3, gA.low, gA.high, gA.outliers, gA.outlierCount], [9, 2, 100, 4, 5, 7, 2, 9, [100], 1]);
    const gB = bs.groups[1];
    assert.deepStrictEqual([gB.q1, gB.median, gB.q3, gB.low, gB.high, gB.outlierCount], [1.75, 2.5, 3.25, 1, 4, 0], 'pas d\'aberrante : les moustaches vont jusqu\'au min et au max');
    // Aberrantes basses ET hautes, et moustache = la valeur extrême QUI RESTE dans les barrières (pas la barrière elle-même).
    const lo = data.boxStatsByGroup([-50, 10, 11, 12, 13, 14, 15, 16, 80].map((v) => ({ g: 'X', v })), 'g', 'v').groups[0];
    assert.deepStrictEqual([lo.low, lo.high, lo.outliers], [10, 16, [-50, 80]]);
    assert.ok(lo.low >= lo.q1 - 1.5 * (lo.q3 - lo.q1) && lo.high <= lo.q3 + 1.5 * (lo.q3 - lo.q1));
    // Valeurs identiques : boîte réduite à un trait, rien d'aberrant ; une seule valeur de même ; BigInt (DuckDB) et chaînes numériques.
    const flat = data.boxStatsByGroup([5, 5, 5, 5].map((v) => ({ g: 'X', v })), 'g', 'v').groups[0];
    assert.deepStrictEqual([flat.q1, flat.median, flat.q3, flat.low, flat.high, flat.outlierCount], [5, 5, 5, 5, 5, 0]);
    const one = data.boxStatsByGroup([{ g: 'X', v: 3 }], 'g', 'v').groups[0];
    assert.deepStrictEqual([one.n, one.low, one.q1, one.median, one.q3, one.high], [1, 3, 3, 3, 3, 3]);
    const big = data.boxStatsByGroup([{ g: 1n, v: 10n }, { g: 1n, v: '20' }, { g: 1n, v: 30 }], 'g', 'v').groups[0];
    assert.deepStrictEqual([big.name, big.n, big.median], ['1', 3, 20], 'BigInt et chaînes numériques acceptés');
    // Presque toutes les valeurs égales : l'EIQ est nul, toute autre valeur est aberrante (comportement de Tukey, pas un défaut).
    const skew = data.boxStatsByGroup([5, 5, 5, 5, 5, 5, 9].map((v) => ({ g: 'X', v })), 'g', 'v').groups[0];
    assert.deepStrictEqual([skew.low, skew.high, skew.outliers], [5, 5, [9]]);
    // Plafond de points tracés : les plus éloignées de la médiane sont gardées, rangées par ordre croissant, le compte reste exact.
    const many = [];
    for (let i = 0; i < 400; i++) many.push({ g: 'X', v: 50 }); // boîte nette (EIQ nul : toute autre valeur est aberrante)
    for (let i = 1; i <= 100; i++) many.push({ g: 'X', v: 50 + 10 * i * (i % 2 ? 1 : -1) }); // 100 aberrantes
    const capped = data.boxStatsByGroup(many, 'g', 'v', 10).groups[0];
    assert.strictEqual(capped.outlierCount, 100); assert.strictEqual(capped.outliers.length, 10);
    assert.deepStrictEqual(capped.outliers, capped.outliers.slice().sort((a, b) => a - b), 'ordre croissant');
    assert.ok(capped.outliers.every((v) => Math.abs(v - capped.median) >= 900), 'les 10 plus éloignées');
    assert.strictEqual(data.boxStatsByGroup(many, 'g', 'v').groups[0].outliers.length, data.BOX_MAX_OUTLIERS, 'plafond par défaut');
    assert.strictEqual(data.boxStatsByGroup(many, 'g', 'v', 0).groups[0].outliers.length, 0); assert.strictEqual(data.boxStatsByGroup(many, 'g', 'v', 0).groups[0].outlierCount, 100);
    // Entrées vides ou absentes : rien, jamais d'exception.
    assert.deepStrictEqual(data.boxStatsByGroup([], 'g', 'v'), { groups: [], ignored: 0 });
    assert.deepStrictEqual(data.boxStatsByGroup(undefined, 'g', 'v'), { groups: [], ignored: 0 });
    // Cohérence avec le calcul indépendant d'une jeu pseudo-aléatoire reproductible (tri + interpolation écrits autrement).
    let seedB = 11; const rndB = () => { seedB = (seedB * 16807) % 2147483647; return seedB / 2147483647; };
    const rs = Array.from({ length: 300 }, (_, i) => ({ g: ['a', 'b', 'c'][i % 3], v: Math.round(rndB() * 1000) / 10 }));
    data.boxStatsByGroup(rs, 'g', 'v').groups.forEach((g) => {
      const vals = rs.filter((r) => r.g === g.name).map((r) => r.v).sort((a, b) => a - b);
      const at = (p) => { const h = (vals.length - 1) * p; return vals[Math.floor(h)] + (h - Math.floor(h)) * (vals[Math.ceil(h)] - vals[Math.floor(h)]); };
      assert.ok(Math.abs(g.median - at(0.5)) < 1e-9 && Math.abs(g.q1 - at(0.25)) < 1e-9 && Math.abs(g.q3 - at(0.75)) < 1e-9, 'quartiles du groupe ' + g.name);
      assert.ok(g.min <= g.low && g.low <= g.q1 && g.q1 <= g.median && g.median <= g.q3 && g.q3 <= g.high && g.high <= g.max, 'ordre min <= moustache <= Q1 <= médiane <= Q3 <= moustache <= max');
    });
    // Store : un clic de boîte pose un filtre d'égalité sur le groupe (comme une barre), la tuile source reste entière, les autres sont filtrées.
    {
      const st = state.createStore();
      st.setRows(sample.filter((r) => typeof r.v === 'number' && !Number.isNaN(r.v)));
      st.addTile({ id: 'bx', type: 'box', dimension: 'g', measure: 'v', title: 'B' });
      st.addTile({ id: 'br', type: 'bar', dimension: 'g', measure: 'v', aggFn: 'sum', title: 'R' });
      st.toggleFilter('g', 'B', 'bx');
      assert.deepStrictEqual(st.getState().activeFilters, [{ column: 'g', value: 'B', sourceTileId: 'bx' }]);
      assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 13, 'la boîte reste affichée en entier');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[1], st.getState()).length, 4, 'les autres tuiles sont filtrées');
      st.toggleFilter('g', 'B', 'bx');
      assert.deepStrictEqual(st.getState().activeFilters, [], 'même groupe : filtre retiré');
      st.toggleFilter('g', 'A', 'bx'); st.removeTile('bx');
      assert.deepStrictEqual(st.getState().activeFilters, [], 'supprimer la tuile lève son filtre');
    }
    // Export Excel : une ligne par groupe, mêmes statistiques que l'écran, filtres des autres tuiles appliqués ; la tuile est une image pour PDF/PPTX.
    const bState = { rows: sample.filter((r) => typeof r.v === 'number'), activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const bTile = { id: 'bx', type: 'box', title: 'Notes par classe', dimension: 'g', measure: 'v' };
    assert.strictEqual(data.tileExportKind(bTile), 'image');
    assert.deepStrictEqual(data.tileExportSheet(bTile, bState), {
      name: 'Notes par classe',
      header: ['g', 'Effectif', 'Moustache basse', '1er quartile', 'Médiane', '3e quartile', 'Moustache haute', 'Valeurs aberrantes'],
      rows: [['A', 9, 2, 4, 5, 7, 9, 1], ['B', 4, 1, 1.75, 2.5, 3.25, 4, 0]]
    });
    const bFiltered = Object.assign({}, bState, { activeFilters: [{ column: 'g', value: 'B', sourceTileId: 'autre' }] });
    assert.deepStrictEqual(data.tileExportSheet(bTile, bFiltered).rows.map((r) => r[0]), ['B'], 'filtre d\'une autre tuile appliqué');
    assert.deepStrictEqual(data.tileExportSheet(bTile, { rows: [], activeFilters: [], advancedFilters: [], drillIns: {} }).rows, [], 'aucune ligne : en-têtes seuls');
    assert.strictEqual(data.buildWorkbookSheets && true, true);
    // Types : palette et format oui ; ni tri, ni séries, ni empilé, ni ligne de repère.
    assert.strictEqual(data.supportsPalette({ type: 'box' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'box' }), true);
    assert.strictEqual(data.isSortableTile({ type: 'box' }), false); assert.strictEqual(data.isSeriesTile({ type: 'box', seriesColumn: 'P' }), false);
    assert.strictEqual(data.supportsRefLine({ type: 'box' }), false); assert.strictEqual(data.supportsValueLabels({ type: 'box' }), false);
    // Valeurs par défaut : une vraie mesure et une catégorie de quelques groupes, sans agrégat ; rien sans colonne numérique.
    const cls = [];
    for (let i = 0; i < 120; i++) cls.push({ Classe: ['2nde A', '2nde B', '1re S'][i % 3], Matiere: 'M' + (i % 40), Note: 8 + ((i * 7) % 13) });
    const bd = advice.defaultsForType('box', cls, ['Classe', 'Matiere', 'Note']);
    assert.ok(bd && bd.measure === 'Note' && bd.dimension === 'Classe' && bd.aggFn === undefined, 'catégorie à peu de groupes, colonne numérique, pas d\'agrégat : ' + JSON.stringify(bd));
    assert.strictEqual(advice.defaultsForType('box', [{ R: 'N' }, { R: 'S' }], ['R']), null);
    assert.strictEqual(advice.adviceForType('box', [{ R: 'N' }, { R: 'S' }], ['R']).key, 'advice.fit.noMeasure');
    assert.strictEqual(advice.TILE_TYPES.includes('box'), false, 'jamais proposé à l\'accueil');
    assert.strictEqual(advice.adviceForType('box', cls, ['Classe', 'Matiere', 'Note']).key, 'advice.use.box');
    // Conseils : trop de groupes ; trop peu de valeurs par groupe ; rien sinon.
    const wide = Array.from({ length: 300 }, (_, i) => ({ G: 'g' + (i % 30), V: i }));
    assert.deepStrictEqual(advice.adviceForTile({ type: 'box', dimension: 'G', measure: 'V' }, wide), { key: 'advice.box.tooManyGroups', vars: { n: 30 }, level: 'warn' });
    const thin = [{ G: 'a', V: 1 }, { G: 'a', V: 2 }, { G: 'b', V: 3 }, { G: 'b', V: 4 }, { G: 'b', V: 9 }];
    assert.strictEqual(advice.adviceForTile({ type: 'box', dimension: 'G', measure: 'V' }, thin).key, 'advice.box.fewValues');
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'box', dimension: 'Absente', measure: 'Aussi' }, cls), 'colonnes absentes : aucune exception');
    assert.strictEqual(advice.adviceForTile({ type: 'box', dimension: 'Classe', measure: 'Note' }, cls), null);
    ['tileForm.type.box', 'tileTitle.box', 'chart.box.empty', 'chart.box.count', 'chart.box.max', 'chart.box.q3', 'chart.box.median', 'chart.box.q1', 'chart.box.min', 'chart.box.outliers', 'chart.box.outlier',
      'advice.use.box', 'advice.box.tooManyGroups', 'advice.box.fewValues']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.box.count', { n: 1, count: 1 }), '1 valeur'); assert.strictEqual(i18n.t('chart.box.outliers', { n: 3, count: 3 }), '3 valeurs aberrantes');
    i18n.setLang('en'); assert.strictEqual(i18n.t('chart.box.outliers', { n: 1, count: 1 }), '1 outlier'); i18n.setLang('fr');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainB = fsB.readFileSync(pathB.join(rootB, 'js', 'main.js'), 'utf8');
    const chartsB = fsB.readFileSync(pathB.join(rootB, 'js', 'charts.js'), 'utf8');
    const indexB = fsB.readFileSync(pathB.join(rootB, 'index.html'), 'utf8');
    assert.ok(/const TYPE_CARDS = \[[^\]]*'box'/.test(mainB) && /<option value="box"/.test(indexB) && /'type-box':/.test(mainB), 'carte, option et icône du type');
    assert.ok(/type !== 'box' && /.test(mainB), 'pas de drill-down (valeurs brutes, pas de niveau suivant)');
    assert.ok(/if \(isBox\) tileData\.aggFn = undefined;/.test(mainB) && /isHistogram \|\| isBox \|\| isGantt;/.test(mainB), 'ni agrégat écrit ni champ Agrégat affiché');
    assert.ok(/currentTile\.type === 'box'/.test(chartsB) && /params\.seriesType === 'scatter' && Array\.isArray\(params\.value\) \? params\.value\[0\]/.test(chartsB), 'le clic retrouve le groupe par son rang (boîte : dataIndex, aberrante : value[0])');
    assert.ok(/toggleFilter\(currentTile\.dimension, names\[rank\], currentTile\.id\)/.test(chartsB), 'filtre d\'égalité sur le groupe, tuile source = la boîte');
    assert.ok(/escapeHtml\(g\.name\)/.test(chartsB), 'le nom du groupe (donnée saisie) est échappé dans l\'infobulle');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsB), 'aucun format de nombre en dur dans charts.js');
    console.log('OK boîte à moustaches — quantiles (type 7), moustaches de Tukey, aberrantes (plafond), valeurs ignorées, groupes, store, export, défauts, conseil, i18n, câblage');
  }

  // Flux / Sankey (type 'sankey', 18/11/2026, lot 3 de l'étude des tuiles usuelles) : flux par paire source -> cible, flux écartés,
  // plafond de liens dessinés, clics (nœud, lien), export, défauts, conseils, i18n, câblage.
  {
    const fsK = require('fs');
    const pathK = require('path');
    const rootK = pathK.join(__dirname, '..');
    const mk = (list) => list.map(([c, st, v]) => ({ c, st, v }));
    const rowsK = mk([['Web', 'Gagné', 10], ['Web', 'Perdu', 5], ['Mail', 'Gagné', 3], ['Mail', 'Gagné', 4], ['Web', 'Gagné', -2], ['Tel', 'Perdu', -9], ['Tel', '', 4], ['Tel', 'Gagné', 'x'], [null, 'Gagné', 1]]);
    const sk = data.sankeyFlows(rowsK, 'c', 'st', 'v', 'sum');
    assert.deepStrictEqual(sk.flows, [{ source: 'Web', target: 'Gagné', value: 8 }, { source: 'Web', target: 'Perdu', value: 5 }, { source: 'Mail', target: 'Gagné', value: 7 }], 'une valeur par paire, somme, ordre de première apparition');
    assert.deepStrictEqual([sk.sources, sk.targets, sk.total], [['Web', 'Mail'], ['Gagné', 'Perdu'], 20]);
    assert.strictEqual(sk.ignored, 2, 'cible vide et source vide : pas de flux');
    assert.strictEqual(sk.dropped, 2, 'Tel -> Perdu (-9) et Tel -> Gagné (texte = 0) : pas d\'épaisseur');
    assert.deepStrictEqual(sk.pairs.map((f) => [f.source, f.target, f.value]), [['Web', 'Gagné', 8], ['Web', 'Perdu', 5], ['Mail', 'Gagné', 7], ['Tel', 'Perdu', -9], ['Tel', 'Gagné', 0]], 'toutes les paires restent pour l\'export');
    assert.deepStrictEqual(data.sankeyFlows(rowsK, 'c', 'st', 'v', 'count').flows.map((f) => f.value), [2, 1, 2, 1, 1], 'comptage : lignes par paire, jamais négatif');
    assert.strictEqual(data.sankeyFlows(rowsK, 'c', 'st', 'v', 'inconnu').flows[0].value, 8, 'agrégat inconnu : somme');
    // Une valeur des deux côtés : deux ensembles de nœuds distincts, donc jamais de cycle ; un flux A -> A reste un flux.
    const loop = data.sankeyFlows(mk([['A', 'B', 3], ['B', 'A', 2], ['A', 'A', 1]]), 'c', 'st', 'v', 'sum');
    assert.deepStrictEqual([loop.sources, loop.targets, loop.flows.length], [['A', 'B'], ['B', 'A'], 3]);
    // Types mêlés (nombre / texte / BigInt) : une paire par texte ; vide / absent sans exception.
    const mixed = data.sankeyFlows([{ c: 1, st: 'x', v: 2n }, { c: '1', st: 'x', v: 3 }, { c: 2, st: 'x', v: '4' }], 'c', 'st', 'v', 'sum');
    assert.deepStrictEqual(mixed.flows.map((f) => [f.source, f.value]), [['1', 5], ['2', 4]], '1 et "1" sont la même source ; BigInt et chaîne numérique acceptés');
    assert.deepStrictEqual(data.sankeyFlows([], 'c', 'st', 'v', 'sum').flows, []); assert.deepStrictEqual(data.sankeyFlows(undefined, 'c', 'st', 'v', 'sum').flows, []);
    // Plafond de liens dessinés : les plus gros, dans l'ordre d'origine, les premiers à valeur égale.
    const fl = [5, 9, 1, 9, 7, 9].map((value, i) => ({ source: 's' + i, target: 't', value }));
    assert.strictEqual(data.topFlows(fl, 10), fl, 'sous le plafond : la même liste');
    assert.deepStrictEqual(data.topFlows(fl, 3).map((f) => f.source), ['s1', 's3', 's5'], 'les trois plus gros, ordre d\'origine');
    assert.deepStrictEqual(data.topFlows(fl, 4).map((f) => f.source), ['s1', 's3', 's4', 's5']);
    assert.deepStrictEqual(data.topFlows(fl, 0), []); assert.strictEqual(data.topFlows(Array.from({ length: 100 }, (_, i) => ({ source: 's' + i, target: 't', value: i + 1 }))).length, data.SANKEY_MAX_LINKS, 'plafond par défaut');
    // Store : un nœud filtre sa colonne ; un lien pose source ET cible (cellFilterToggles) ; le même lien les retire ; la tuile reste entière.
    {
      const st = state.createStore();
      st.setRows(mk([['Web', 'Gagné', 10], ['Web', 'Perdu', 5], ['Mail', 'Gagné', 3]]));
      st.addTile({ id: 'sk', type: 'sankey', dimension: 'c', columnDimension: 'st', measure: 'v', aggFn: 'sum', title: 'F' });
      st.addTile({ id: 'br', type: 'bar', dimension: 'c', measure: 'v', aggFn: 'sum', title: 'B' });
      st.toggleFilter('c', 'Web', 'sk');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 3, 'le flux reste affiché en entier');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[1], st.getState()).length, 2, 'les autres tuiles sont filtrées');
      data.cellFilterToggles(st.getState().activeFilters, 'c', 'Web', 'st', 'Perdu').forEach((c) => st.toggleFilter(c.column, c.value, 'sk'));
      assert.deepStrictEqual(st.getState().activeFilters.map((f) => [f.column, f.value]), [['c', 'Web'], ['st', 'Perdu']], 'lien Web -> Perdu : la source reste, la cible s\'ajoute');
      data.cellFilterToggles(st.getState().activeFilters, 'c', 'Web', 'st', 'Perdu').forEach((c) => st.toggleFilter(c.column, c.value, 'sk'));
      assert.deepStrictEqual(st.getState().activeFilters, [], 'même lien : les deux filtres retirés');
      st.toggleFilter('st', 'Gagné', 'sk'); st.removeTile('sk');
      assert.deepStrictEqual(st.getState().activeFilters, [], 'supprimer la tuile lève ses filtres');
    }
    // Export Excel : toutes les paires (négatives comprises), filtres des autres tuiles appliqués ; image pour PDF/PPTX.
    const kState = { rows: rowsK, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const kTile = { id: 'sk', type: 'sankey', title: 'Canal -> statut', dimension: 'c', columnDimension: 'st', measure: 'v', aggFn: 'sum' };
    assert.strictEqual(data.tileExportKind(kTile), 'image');
    assert.deepStrictEqual(data.tileExportSheet(kTile, kState), { name: 'Canal -> statut', header: ['c', 'st', 'v'], rows: [['Web', 'Gagné', 8], ['Web', 'Perdu', 5], ['Mail', 'Gagné', 7], ['Tel', 'Perdu', -9], ['Tel', 'Gagné', 0]] });
    assert.deepStrictEqual(data.tileExportSheet(kTile, Object.assign({}, kState, { activeFilters: [{ column: 'c', value: 'Mail', sourceTileId: 'autre' }] })).rows, [['Mail', 'Gagné', 7]]);
    assert.deepStrictEqual(data.tileExportSheet(kTile, Object.assign({}, kState, { rows: [] })).rows, [], 'aucune ligne : en-têtes seuls');
    // Types : palette et format oui ; ni tri, ni séries, ni repère, ni étiquettes de valeur.
    assert.strictEqual(data.supportsPalette({ type: 'sankey' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'sankey' }), true);
    assert.strictEqual(data.isSortableTile({ type: 'sankey' }), false); assert.strictEqual(data.isSeriesTile({ type: 'sankey', seriesColumn: 'P' }), false);
    assert.strictEqual(data.supportsRefLine({ type: 'sankey' }), false); assert.strictEqual(data.supportsValueLabels({ type: 'sankey' }), false);
    // Valeurs par défaut : deux catégories distinctes, jamais une moyenne (un flux s'additionne), comptage sans mesure ; types sans conseil d'accueil.
    const cmd = [];
    for (let i = 0; i < 120; i++) cmd.push({ Canal: ['Web', 'Mail', 'Tel'][i % 3], Statut: ['Gagné', 'Perdu'][(i * 5) % 2], Note: 1 + (i % 5) });
    const kd = advice.defaultsForType('sankey', cmd, ['Canal', 'Statut', 'Note']);
    assert.ok(kd && kd.dimension && kd.columnDimension && kd.dimension !== kd.columnDimension && kd.measure === 'Note', JSON.stringify(kd));
    assert.ok(['sum', 'count'].includes(kd.aggFn) && kd.aggFn !== 'avg', 'jamais une moyenne');
    assert.strictEqual(advice.defaultsForType('sankey', [{ A: 'x', B: 'y' }, { A: 'z', B: 'w' }], ['A', 'B']).aggFn, 'count', 'aucune mesure : comptage');
    assert.strictEqual(advice.adviceForType('sankey', cmd.map((r, i) => ({ Canal: r.Canal, Montant: 100.5 + i * 7.25 })), ['Canal', 'Montant']).key, 'advice.fit.needTwoDimensions', 'une seule catégorie : le type est déconseillé');
    assert.strictEqual(advice.TILE_TYPES.includes('sankey'), false, 'jamais proposé à l\'accueil');
    assert.strictEqual(advice.adviceForType('sankey', cmd, ['Canal', 'Statut', 'Note']).key, 'advice.use.sankey');
    // Conseils : moyenne/min/max, trop de nœuds, flux écartés ; rien pour un flux sain.
    const tk = { type: 'sankey', dimension: 'Canal', columnDimension: 'Statut', measure: 'Note', aggFn: 'sum' };
    assert.strictEqual(advice.adviceForTile(tk, cmd), null);
    for (const agg of ['avg', 'min', 'max']) assert.strictEqual(advice.adviceForTile(Object.assign({}, tk, { aggFn: agg }), cmd).key, 'advice.sankey.notAdditive', agg);
    const wideK = Array.from({ length: 200 }, (_, i) => ({ S: 's' + (i % 10), T: 't' + (Math.floor(i / 10) % 10), V: 1 }));
    assert.deepStrictEqual(advice.adviceForTile({ type: 'sankey', dimension: 'S', columnDimension: 'T', measure: 'V', aggFn: 'sum' }, wideK), { key: 'advice.sankey.tooManyNodes', vars: { nodes: 20 }, level: 'warn' });
    assert.deepStrictEqual(advice.adviceForTile({ type: 'sankey', dimension: 'c', columnDimension: 'st', measure: 'v', aggFn: 'sum' }, rowsK), { key: 'advice.sankey.dropped', vars: { n: 2 }, level: 'tip' });
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'sankey', dimension: 'Z', columnDimension: 'Y', measure: 'X', aggFn: 'sum' }, cmd), 'colonnes absentes : aucune exception');
    ['tileForm.type.sankey', 'tileTitle.sankey', 'tileForm.dimension.labelSource', 'tileForm.columnDimension.labelTarget', 'tileForm.error.sankeyTargetRequired', 'tileForm.alert.sankeyDimsDiffer', 'chart.sankey.empty', 'chart.sankey.node',
      'chart.sankey.capped', 'advice.use.sankey', 'advice.sankey.tooManyNodes', 'advice.sankey.notAdditive', 'advice.sankey.dropped']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.sankey.capped', { shown: 60, total: 144 }), '60 flux les plus importants sur 144'); i18n.setLang('en'); assert.strictEqual(i18n.t('chart.sankey.capped', { shown: 60, total: 144 }), 'Top 60 flows of 144'); i18n.setLang('fr');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainK = fsK.readFileSync(pathK.join(rootK, 'js', 'main.js'), 'utf8');
    const chartsK = fsK.readFileSync(pathK.join(rootK, 'js', 'charts.js'), 'utf8');
    const indexK = fsK.readFileSync(pathK.join(rootK, 'index.html'), 'utf8');
    assert.ok(/const TYPE_CARDS = \[[^\]]*'sankey'/.test(mainK) && /<option value="sankey"/.test(indexK) && /'type-sankey':/.test(mainK), 'carte, option et icône du type');
    assert.ok(/type !== 'sankey' && type !== 'calendar'( && type !== 'gantt')?( && type !== 'sunburst')?; \}/.test(mainK), 'pas de drill-down (flux, calendrier)');
    assert.ok(/isGrid = isPivot \|\| isHeatmap \|\| isSankey/.test(mainK) && /sankeyDimsDiffer/.test(mainK) && /sankeyTargetRequired/.test(mainK), 'deux colonnes obligatoires et différentes, messages propres au flux');
    assert.ok(/currentTile\.type === 'sankey'/.test(chartsK) && /params\.dataType === 'edge'/.test(chartsK) && /toggleCellFilters\(currentTile, from\.value, to\.value\)/.test(chartsK) && /toggleFilter\(node\.column, node\.value, currentTile\.id\)/.test(chartsK), 'nœud = filtre de sa colonne, lien = source ET cible');
    assert.ok(/instance\.__refit = \(\) => \{\s*const p = place\(\);/.test(chartsK), 'les marges de libellés suivent le redimensionnement');
    assert.ok(/return n \? escapeHtml\(n\.value\) : ''/.test(chartsK), 'les noms de nœuds (données saisies) sont échappés dans l\'infobulle');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsK), 'aucun format de nombre en dur dans charts.js');
    console.log('OK flux (Sankey) — flux par paire, écartés, sources et cibles distinctes (jamais de cycle), plafond, store (nœud, lien), export, défauts, conseils, i18n, câblage');
  }

  // Bulles (nuage de points + taille + couleur, 18/11/2026, lot 3 de l'étude des tuiles usuelles, §5.5) : points alignés par nom,
  // diamètres à aire proportionnelle, tailles sans aire, export, conseils, i18n, câblage. Le nuage de points simple ne change pas.
  {
    const fsB = require('fs');
    const pathB = require('path');
    const rootB = pathB.join(__dirname, '..');
    // Diamètres : l'aire suit la valeur (diamètre ~ racine carrée), plancher, pas d'aire pour une taille <= 0 ou absente.
    assert.deepStrictEqual(data.bubbleDiameters([100, 25, 0, -3, null, undefined, 4n], 40, 6), [40, 20, null, null, null, null, 8]);
    assert.deepStrictEqual(data.bubbleDiameters([1, 10000], 40, 6), [6, 40], 'plancher : une très petite bulle reste visible');
    assert.deepStrictEqual(data.bubbleDiameters([0, -1, null], 40), [null, null, null], 'aucune taille positive : aucune bulle');
    assert.deepStrictEqual(data.bubbleDiameters([], 40), []); assert.deepStrictEqual(data.bubbleDiameters(undefined, 40), []);
    assert.deepStrictEqual(data.bubbleDiameters([4, 1], 'x'), [40, 20], 'diamètre maximal invalide : 40 par défaut');
    assert.deepStrictEqual(data.bubbleDiameters([9, 1], 4, 10), [4, 4], 'un plancher au-dessus du maximum n\'agrandit pas le maximum');
    const ds = data.bubbleDiameters([50, 200, 800], 60, 1); assert.ok(Math.abs((ds[2] / ds[0]) ** 2 - 16) < 1e-9 && Math.abs((ds[1] / ds[0]) ** 2 - 4) < 1e-9, 'l\'aire est proportionnelle, pas le diamètre');
    // Points : alignement PAR NOM (BigInt DuckDB et nombre JS sont la même dimension), trou = null, point sans X ou Y écarté.
    {
      const gx = [{ dimension: 'a', value: 1 }, { dimension: 2n, value: 3n }, { dimension: null, value: 9 }, { dimension: 'z', value: 5 }];
      const gy = [{ dimension: 'a', value: 5 }, { dimension: 2, value: 7 }, { dimension: null, value: 4 }];
      const gs = [{ dimension: 'a', value: 100 }, { dimension: 2, value: 'x' }];
      const r = data.bubblePoints(gx, gy, gs);
      assert.deepStrictEqual(r.points.map((q) => [String(q.dimension), q.x, q.y, q.size]), [['a', 1, 5, 100], ['2', 3, 7, null], ['null', 9, 4, null]], 'alignement par nom ; taille absente ou non numérique = null, jamais 0');
      assert.strictEqual(r.skipped, 1, 'z n\'a pas de Y : écarté');
      const none = data.bubblePoints(gx, gy); assert.ok(none.points.every((q) => !('size' in q)), 'sans mesure de taille, pas de champ size');
      assert.deepStrictEqual(data.bubblePoints([], [], []), { points: [], skipped: 0 }); assert.deepStrictEqual(data.bubblePoints(undefined, undefined, undefined), { points: [], skipped: 0 });
      assert.strictEqual(data.bubblePoints([{ dimension: 'a', value: NaN }], [{ dimension: 'a', value: 1 }]).skipped, 1, 'X non fini : écarté');
    }
    // Types : seule la combinaison nuage de points + taille / couleur ; isSeriesTile (barres et courbes) ne bouge pas.
    assert.strictEqual(data.isBubbleTile({ type: 'scatter', measureSize: 'M' }), true); assert.strictEqual(data.isBubbleTile({ type: 'scatter' }), false); assert.strictEqual(data.isBubbleTile({ type: 'bar', measureSize: 'M' }), false); assert.strictEqual(data.isBubbleTile(null), false);
    assert.strictEqual(data.isColorSplitTile({ type: 'scatter', seriesColumn: 'G' }), true); assert.strictEqual(data.isColorSplitTile({ type: 'scatter' }), false); assert.strictEqual(data.isColorSplitTile({ type: 'line', seriesColumn: 'G' }), false);
    assert.strictEqual(data.isSeriesTile({ type: 'scatter', seriesColumn: 'G' }), false, 'la couleur d\'un nuage de points n\'est pas une série de barres : ni pile, ni tri');
    assert.strictEqual(data.isStackedTile({ type: 'scatter', seriesColumn: 'G', stacked: true }), false);
    assert.strictEqual(data.supportsPalette({ type: 'scatter' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'scatter' }), true);
    // Export : nuage simple inchangé ; + taille = une colonne ; + couleur = une colonne « série » et un jeu de points par valeur.
    const rowsB = [];
    for (let i = 0; i < 12; i++) rowsB.push({ Produit: 'P' + (i % 4), Gamme: i % 4 < 2 ? 'A' : 'B', Prix: 10 + (i % 4) * 5 + i % 3, Marge: 20 + (i % 4) * 4, CA: 100 + i * 10 });
    const stB = { rows: rowsB, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const plainB = { id: 'sc', type: 'scatter', title: 'S', dimension: 'Produit', measure: 'Prix', measureY: 'Marge', aggFn: 'avg' };
    const sheetPlain = data.tileExportSheet(plainB, stB);
    assert.deepStrictEqual(sheetPlain.header, ['Produit', 'Prix', 'Marge']); assert.strictEqual(sheetPlain.rows.length, 4);
    const sheetSize = data.tileExportSheet(Object.assign({}, plainB, { measureSize: 'CA', aggFnSize: 'sum' }), stB);
    assert.deepStrictEqual(sheetSize.header, ['Produit', 'Prix', 'Marge', 'CA']);
    const p0 = rowsB.filter((r) => r.Produit === 'P0');
    assert.deepStrictEqual(sheetSize.rows[0], ['P0', p0.reduce((a, r) => a + r.Prix, 0) / p0.length, 20, p0.reduce((a, r) => a + r.CA, 0)], 'taille = SOMME (agrégat propre), axes = moyenne');
    const sheetColor = data.tileExportSheet(Object.assign({}, plainB, { measureSize: 'CA', seriesColumn: 'Gamme' }), stB);
    assert.deepStrictEqual(sheetColor.header, ['Produit', 'Gamme', 'Prix', 'Marge', 'CA']); assert.strictEqual(sheetColor.rows.length, 4, 'chaque produit n\'a qu\'une gamme : 4 lignes');
    assert.deepStrictEqual(sheetColor.rows.map((r) => r[1]), ['A', 'A', 'B', 'B']);
    assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, plainB, { seriesColumn: 'Gamme' }), stB).header, ['Produit', 'Gamme', 'Prix', 'Marge'], 'couleur sans taille');
    assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, plainB, { measureSize: 'CA' }), Object.assign({}, stB, { rows: [] })).rows, [], 'aucune ligne : en-têtes seuls');
    assert.strictEqual(data.tileExportKind(plainB), 'image');
    // Conseils : couleur = colonne des points, trop de couleurs, tailles sans aire ; rien pour un graphique sain ; colonnes absentes sans exception.
    const goodB = Object.assign({}, plainB, { measureSize: 'CA', aggFnSize: 'sum', seriesColumn: 'Gamme' });
    assert.strictEqual(advice.adviceForTile(goodB, rowsB), null);
    assert.strictEqual(advice.adviceForTile(Object.assign({}, goodB, { seriesColumn: 'Produit' }), rowsB).key, 'advice.bubble.sameAsDimension');
    const manyB = []; for (let i = 0; i < 40; i++) manyB.push({ Produit: 'P' + i, Gamme: 'G' + i, Prix: i + 1, Marge: i + 2, CA: i + 3 });
    assert.deepStrictEqual(advice.adviceForTile(Object.assign({}, goodB, { dimension: 'Produit' }), manyB), { key: 'advice.bubble.tooManyColors', vars: { n: 40, max: 8 }, level: 'warn' });
    assert.deepStrictEqual(advice.adviceForTile({ type: 'scatter', dimension: 'Produit', measure: 'Prix', measureY: 'Marge', aggFn: 'sum', measureSize: 'CA' }, rowsB.concat([{ Produit: 'Neg', Gamme: 'A', Prix: 1, Marge: 1, CA: -500 }])), { key: 'advice.bubble.sizeSign', vars: { n: 1 }, level: 'warn' });
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'scatter', dimension: 'Produit', measure: 'Prix', measureY: 'Marge', aggFn: 'sum', measureSize: 'Absente', seriesColumn: 'Absente2' }, rowsB));
    assert.strictEqual(advice.adviceForTile(plainB, rowsB), null, 'nuage de points simple : aucun conseil nouveau');
    // i18n : libellés, titre, conseils.
    ['tileForm.measureSize.label', 'tileForm.aggSize.label', 'tileForm.series.labelColor', 'tileTitle.bubble', 'chart.bubble.size', 'advice.bubble.sizeSign', 'advice.bubble.tooManyColors', 'advice.bubble.sameAsDimension']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('tileTitle.bubble', { measure: 'Prix', measureY: 'Marge', dimension: 'Produit', measureSize: 'CA' }), 'Prix et Marge par Produit, taille : CA');
    i18n.setLang('en'); assert.strictEqual(i18n.t('tileTitle.bubble', { measure: 'Prix', measureY: 'Marge', dimension: 'Produit', measureSize: 'CA' }), 'Prix and Marge by Produit, size: CA'); i18n.setLang('fr');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainB = fsB.readFileSync(pathB.join(rootB, 'js', 'main.js'), 'utf8');
    const chartsB = fsB.readFileSync(pathB.join(rootB, 'js', 'charts.js'), 'utf8');
    const indexB = fsB.readFileSync(pathB.join(rootB, 'index.html'), 'utf8');
    assert.ok(/id="tile-measure-size"/.test(indexB) && /id="tile-agg-size"/.test(indexB) && /id="tile-series-label"/.test(indexB), 'champs de taille et libellé de la couleur');
    assert.ok(/measureSizeSelect, trendDimensionSelect/.test(mainB), 'la colonne de taille est un combobox strict');
    assert.ok(/\|\| type === 'line' \|\| isScatter( \|\| isGantt)?\) \? seriesSelect\.value : ''/.test(mainB), 'la colonne Séries est lue pour un nuage de points (couleur)');
    assert.ok(/tileData\.measureSize = \(isScatter && measureSizeSelect\.value\)/.test(mainB) && /tileData\.aggFnSize = \(isScatter && measureSizeSelect\.value && aggSizeSelect\.value !== aggFn\)/.test(mainB), 'taille écrite seulement pour un nuage de points ; son agrégat seulement s\'il diffère');
    assert.ok(/p\.isBubble\) \{ key = 'tileTitle\.bubble'/.test(mainB), 'titre automatique des bulles');
    assert.ok(/computeScatterSplit\(rows, dimension, tile\)/.test(chartsB) && /bubbleDiameters\(allSizes, diameterMax\)/.test(chartsB) && /if \(bubble\) instance\.__refit = /.test(chartsB), 'une couleur = un calcul par couleur ; diamètres en pixels qui suivent le redimensionnement');
    assert.ok(/escapeHtml\(String\(params\.name\)\)/.test(chartsB) && /escapeHtml\(tile\.measureSize\)/.test(chartsB), 'noms échappés dans l\'infobulle');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsB), 'aucun format de nombre en dur dans charts.js');
    console.log('OK bulles — points alignés par nom, diamètres à aire proportionnelle, tailles sans aire, export, conseils, i18n, câblage');
  }

  // Calendrier (type 'calendar', 18/11/2026, lot 3 de l'étude des tuiles usuelles, §5.6) : valeur agrégée par jour, jours sans ligne,
  // fenêtre d'un an, clic = filtre du jour, export, défauts, conseils, i18n, câblage.
  {
    const fsC = require('fs');
    const pathC = require('path');
    const rootC = pathC.join(__dirname, '..');
    // Décalage de jours : fins de mois, année bissextile, entrée invalide.
    assert.strictEqual(data.isoDayShift('2024-02-28', 1), '2024-02-29'); assert.strictEqual(data.isoDayShift('2023-02-28', 1), '2023-03-01');
    assert.strictEqual(data.isoDayShift('2024-12-31', 1), '2025-01-01'); assert.strictEqual(data.isoDayShift('2025-03-01', -1), '2025-02-28');
    assert.strictEqual(data.isoDayShift('2025-01-10', 0), '2025-01-10'); assert.strictEqual(data.isoDayShift('x', 1), null); assert.strictEqual(data.isoDayShift(null, 1), null);
    // Une valeur par jour, jours triés, plusieurs lignes le même jour agrégées, lignes sans date valide ignorées.
    const rowsC = [
      { D: '2025-03-05', M: 10, R: 'a' }, { D: '2025-03-03', M: 4, R: 'a' }, { D: '2025-03-05', M: 6, R: 'b' }, { D: '2025-03-03', M: 1, R: 'b' }, { D: '2025-03-10', M: 2, R: 'a' },
      { D: 'bad', M: 99 }, { D: null, M: 99 }, { D: '2025-13-45', M: 99 }, { D: 45000, M: 99 }, { M: 99 }
    ];
    const cs = data.calendarDays(rowsC, 'D', 'M', 'sum');
    assert.deepStrictEqual(cs.days, [{ date: '2025-03-03', value: 5 }, { date: '2025-03-05', value: 16 }, { date: '2025-03-10', value: 2 }], 'somme par jour, dates triées');
    assert.deepStrictEqual([cs.from, cs.to, cs.ignored, cs.hidden, cs.total], ['2025-03-03', '2025-03-10', 5, 0, 3], 'dates invalides ou absentes : ignorées, jamais un jour inventé');
    assert.deepStrictEqual(data.calendarDays(rowsC, 'D', 'M', 'count').days.map((d) => d.value), [2, 2, 1], 'comptage : lignes par jour');
    assert.deepStrictEqual(data.calendarDays(rowsC, 'D', 'M', 'avg').days.map((d) => d.value), [2.5, 8, 2]);
    assert.deepStrictEqual(data.calendarDays(rowsC, 'D', 'M', 'min').days.map((d) => d.value), [1, 6, 2]); assert.deepStrictEqual(data.calendarDays(rowsC, 'D', 'M', 'max').days.map((d) => d.value), [4, 10, 2]);
    assert.deepStrictEqual(data.calendarDays(rowsC, 'D', 'M', 'inconnu').days.map((d) => d.value), [5, 16, 2], 'agrégat inconnu : somme');
    assert.deepStrictEqual(data.calendarDays([], 'D', 'M', 'sum'), { days: [], from: null, to: null, ignored: 0, hidden: 0, total: 0 }); assert.deepStrictEqual(data.calendarDays(undefined, 'D', 'M', 'sum').days, []);
    assert.deepStrictEqual(data.calendarDays([{ D: 'x', M: 1 }], 'D', 'M', 'sum'), { days: [], from: null, to: null, ignored: 1, hidden: 0, total: 0 }, 'aucune date valide : aucun jour');
    // Fenêtre d'un an : les 366 derniers jours depuis le dernier jour qui a une valeur ; le reste est compté, pas perdu.
    const long = []; for (let i = 0; i < 500; i++) long.push({ D: data.isoDayShift('2024-01-01', i), M: i });
    const lg = data.calendarDays(long, 'D', 'M', 'sum');
    assert.deepStrictEqual([lg.days.length, lg.hidden, lg.total, lg.to, lg.from], [366, 134, 500, data.isoDayShift('2024-01-01', 499), data.isoDayShift('2024-01-01', 134)]);
    assert.strictEqual(lg.days[0].value, 134, 'le plus ancien jour dessiné est le 135e'); assert.strictEqual(data.CALENDAR_MAX_DAYS, 366);
    assert.strictEqual(data.calendarDays(long, 'D', 'M', 'sum', 30).days.length, 30, 'plafond réglé'); assert.strictEqual(data.calendarDays(long, 'D', 'M', 'sum', Infinity).days.length, 500, 'sans plafond : tout');
    assert.strictEqual(data.calendarDays(long, 'D', 'M', 'sum', 'x').days.length, 366, 'plafond invalide : défaut');
    // Un trou n'est pas un jour à zéro : seuls les jours avec ligne existent.
    const gaps = data.calendarDays([{ D: '2025-01-01', M: 1 }, { D: '2025-01-05', M: 1 }], 'D', 'M', 'sum'); assert.strictEqual(gaps.days.length, 2);
    // Store : le clic pose un filtre d'égalité sur le jour ; la tuile reste entière, les autres sont filtrées ; même jour = retiré.
    {
      const st = state.createStore();
      st.setRows(rowsC.slice(0, 5));
      st.addTile({ id: 'cal', type: 'calendar', dimension: 'D', measure: 'M', aggFn: 'sum', title: 'C' });
      st.addTile({ id: 'br', type: 'bar', dimension: 'R', measure: 'M', aggFn: 'sum', title: 'B' });
      st.toggleFilter('D', '2025-03-05', 'cal');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 5, 'le calendrier reste affiché en entier');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[1], st.getState()).length, 2, 'les autres tuiles ne gardent que les lignes du jour');
      st.toggleFilter('D', '2025-03-05', 'cal'); assert.deepStrictEqual(st.getState().activeFilters, [], 'même jour : filtre retiré');
      st.toggleFilter('D', '2025-03-03', 'cal'); st.removeTile('cal'); assert.deepStrictEqual(st.getState().activeFilters, [], 'supprimer la tuile lève son filtre');
    }
    // Export : un jour par ligne, TOUS les jours avec une valeur (au-delà de l'année aussi), filtres des autres tuiles appliqués.
    const stC = { rows: long, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const calTile = { id: 'cal', type: 'calendar', title: 'Activité', dimension: 'D', measure: 'M', aggFn: 'sum' };
    const sheetC = data.tileExportSheet(calTile, stC);
    assert.deepStrictEqual(sheetC.header, ['D', 'M']); assert.strictEqual(sheetC.rows.length, 500); assert.deepStrictEqual(sheetC.rows[0], ['2024-01-01', 0]);
    assert.strictEqual(data.tileExportSheet(calTile, Object.assign({}, stC, { rows: [] })).rows.length, 0, 'aucune ligne : en-têtes seuls'); assert.strictEqual(data.tileExportKind(calTile), 'image');
    assert.deepStrictEqual(data.tileExportSheet(calTile, Object.assign({}, stC, { rows: rowsC, activeFilters: [{ column: 'R', value: 'a', sourceTileId: 'autre' }] })).rows, [['2025-03-03', 4], ['2025-03-05', 10], ['2025-03-10', 2]], 'filtre d\'une autre tuile');
    // Types : palette et format oui ; ni tri, ni séries, ni repère, ni étiquettes de valeur, ni drill-down.
    assert.strictEqual(data.supportsPalette({ type: 'calendar' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'calendar' }), true);
    assert.strictEqual(data.isSortableTile({ type: 'calendar' }), false); assert.strictEqual(data.isSeriesTile({ type: 'calendar', seriesColumn: 'x' }), false);
    assert.strictEqual(data.supportsRefLine({ type: 'calendar' }), false); assert.strictEqual(data.supportsValueLabels({ type: 'calendar' }), false);
    // Défauts : la vraie colonne de dates (jamais l'année dérivée), Somme d'une vraie mesure ou Comptage ; pas de date = type déconseillé.
    const ventes = [];
    for (let i = 0; i < 60; i++) ventes.push({ Date: data.isoDayShift('2025-01-01', i), Region: ['Nord', 'Sud', 'Est'][i % 3], Montant: 100.5 + i * 3.25 });
    const dc = advice.defaultsForType('calendar', ventes, ['Date', 'Region', 'Montant']);
    assert.strictEqual(dc.dimension, 'Date'); assert.strictEqual(dc.measure, 'Montant'); assert.strictEqual(dc.aggFn, 'sum');
    const cnt = advice.defaultsForType('calendar', ventes.map((r) => ({ Date: r.Date, Region: r.Region })), ['Date', 'Region']); assert.strictEqual(cnt.dimension, 'Date'); assert.strictEqual(cnt.aggFn, 'count', 'aucune mesure : comptage');
    assert.strictEqual(advice.defaultsForType('calendar', ventes.map((r) => ({ Region: r.Region, Montant: r.Montant })), ['Region', 'Montant']), null, 'aucune colonne de dates : rien à préremplir');
    assert.strictEqual(advice.adviceForType('calendar', ventes.map((r) => ({ Region: r.Region, Montant: r.Montant })), ['Region', 'Montant']).key, 'advice.fit.noDate');
    assert.strictEqual(advice.adviceForType('calendar', ventes, ['Date', 'Region', 'Montant']).key, 'advice.use.calendar'); assert.strictEqual(advice.TILE_TYPES.includes('calendar'), false, 'jamais proposé à l\'accueil');
    // Conseils : colonne sans date, moins d'une semaine, au-delà d'un an ; rien pour un calendrier sain ; colonnes absentes sans exception.
    const tc = { type: 'calendar', dimension: 'Date', measure: 'Montant', aggFn: 'sum' };
    assert.strictEqual(advice.adviceForTile(tc, ventes), null);
    assert.deepStrictEqual(advice.adviceForTile(Object.assign({}, tc, { dimension: 'Region' }), ventes), { key: 'advice.calendar.notDate', vars: { dimension: 'Region' }, level: 'warn' });
    assert.deepStrictEqual(advice.adviceForTile(tc, ventes.slice(0, 4)), { key: 'advice.calendar.fewDays', vars: { n: 4 }, level: 'warn' });
    assert.deepStrictEqual(advice.adviceForTile(tc, long.map((r) => ({ Date: r.D, Montant: r.M }))), { key: 'advice.calendar.truncated', vars: { days: 366, hidden: 134 }, level: 'tip' });
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'calendar', dimension: 'Absente', measure: 'Autre', aggFn: 'sum' }, ventes));
    // i18n : textes, 7 jours (dimanche en premier) et 12 mois dans les deux langues, pluriels sans objet.
    ['tileForm.type.calendar', 'tileTitle.calendar', 'tileForm.dimension.labelDate', 'tileForm.error.calendarNotDate', 'chart.calendar.empty', 'chart.calendar.dayNames', 'chart.calendar.monthNames',
      'advice.use.calendar', 'advice.fit.noDate', 'advice.calendar.notDate', 'advice.calendar.fewDays', 'advice.calendar.truncated'].forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    for (const lang of ['fr', 'en']) { i18n.setLang(lang); assert.strictEqual(i18n.t('chart.calendar.dayNames').split(',').length, 7, lang); assert.strictEqual(i18n.t('chart.calendar.monthNames').split(',').length, 12, lang); }
    i18n.setLang('fr'); assert.strictEqual(i18n.t('tileTitle.calendar', { measure: 'Montant', dimension: 'Date' }), 'Montant par jour (Date)'); i18n.setLang('en'); assert.strictEqual(i18n.t('tileTitle.calendar', { measure: 'Montant', dimension: 'Date' }), 'Montant per day (Date)'); i18n.setLang('fr');
    assert.strictEqual(i18n.t('chart.calendar.dayNames').split(',')[0], 'D', 'le tableau commence par dimanche (convention d\'ECharts), lundi en premier par `firstDay: 1`');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainC = fsC.readFileSync(pathC.join(rootC, 'js', 'main.js'), 'utf8');
    const chartsC = fsC.readFileSync(pathC.join(rootC, 'js', 'charts.js'), 'utf8');
    const indexC = fsC.readFileSync(pathC.join(rootC, 'index.html'), 'utf8');
    assert.ok(/const TYPE_CARDS = \[[^\]]*'calendar'/.test(mainC) && /<option value="calendar"/.test(indexC) && /'type-calendar':/.test(mainC), 'carte, option et icône du type');
    assert.ok(/inferColumnKind\(dimension\) !== 'date'\) fail\('tile-dimension', 'tileForm\.error\.calendarNotDate'\)/.test(mainC), 'la colonne doit contenir de vraies dates');
    assert.ok(/currentTile\.type === 'calendar'/.test(chartsC) && /toggleFilter\(currentTile\.dimension, day, currentTile\.id\)/.test(chartsC), 'clic = filtre du jour');
    assert.ok(/firstDay: 1/.test(chartsC) && /escapeHtml\(longDate\(/.test(chartsC) && /heatStops\(tile\.palette\)/.test(chartsC), 'lundi en premier, date de l\'infobulle échappée, rampe de la carte de chaleur');
    const emptyCal = chartsC.slice(chartsC.indexOf('function renderCalendar'), chartsC.indexOf('const f = fmtFor(tile, tile.measure);', chartsC.indexOf('function renderCalendar')));
    assert.ok(!/calendar: \{/.test(emptyCal) && !/visualMap/.test(emptyCal), 'aucun composant `calendar` sans plage (ECharts lèverait une exception)');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsC), 'aucun format de nombre en dur dans charts.js');
    console.log('OK calendrier — valeur par jour, jours sans ligne, fenêtre d\'un an, clic = filtre du jour, export, défauts, conseils, i18n, câblage');
  }

  // Gantt (type 'gantt', 18/11/2026, lot 3 de l'étude des tuiles usuelles, §5.7) : une barre par tâche de sa date de début à sa date de fin,
  // lignes sans dates valides écartées (et comptées), tri par début, plafond, axe du temps, aujourd'hui, export, défauts, conseils, i18n, câblage.
  {
    const fsG = require('fs');
    const pathG = require('path');
    const rootG = pathG.join(__dirname, '..');
    const rowsG = [
      { T: 'c', S: '2025-11-02', E: '2025-12-15', St: 'A faire' }, { T: 'b', S: '2025-10-10', E: '2025-10-20', St: 'En cours' }, { T: 'a', S: '2025-09-01', E: '2025-09-30', St: 'Fait' },
      { T: 'inversée', S: '2025-11-05', E: '2025-11-01', St: 'Fait' }, { T: 'sans fin', S: '2025-11-05', E: null, St: 'Fait' }, { T: 'mauvaise', S: 'bientôt', E: '2025-11-30', St: 'Fait' },
      { T: 'nombre', S: 45000, E: 45010, St: 'Fait' }, { T: 'texte', S: '2025-1-5', E: '2025-01-09', St: 'Fait' }
    ];
    const g = data.ganttTasks(rowsG, 'T', 'S', 'E', 'St');
    assert.deepStrictEqual(g.tasks.map((x) => x.label), ['a', 'b', 'c'], 'triées par début, quel que soit l\'ordre de la table');
    assert.deepStrictEqual(g.statuses, ['A faire', 'En cours', 'Fait'], 'statuts dans l\'ordre de la TABLE (les couleurs ne bougent pas avec le tri)');
    assert.deepStrictEqual([g.ignored, g.hidden, g.total, g.min, g.max], [5, 0, 3, '2025-09-01', '2025-12-15'], 'fin avant début, fin absente, date illisible, nombre, date non ISO : écartées et comptées');
    assert.deepStrictEqual(g.tasks[0], { label: 'a', start: '2025-09-01', end: '2025-09-30', status: 'Fait' });
    assert.strictEqual(data.ganttTasks(rowsG, 'T', 'S', 'E').tasks[0].status, undefined, 'sans colonne de couleur : pas de statut'); assert.deepStrictEqual(data.ganttTasks(rowsG, 'T', 'S', 'E').statuses, []);
    // Une tâche d'un seul jour (début = fin) est valide ; un libellé vide reste une ligne ; un statut vide est la valeur '' ; une ligne sans libellé du tout aussi.
    const one = data.ganttTasks([{ T: null, S: '2025-03-01', E: '2025-03-01', St: null }, { S: '2025-03-02', E: '2025-03-03' }], 'T', 'S', 'E', 'St');
    assert.deepStrictEqual(one.tasks.map((x) => [x.label, x.status]), [['', ''], ['', '']]); assert.deepStrictEqual(one.statuses, ['']);
    // Ordre stable : à début égal, l'ordre de la table.
    assert.deepStrictEqual(data.ganttTasks([{ T: 'z', S: '2025-01-01', E: '2025-01-02' }, { T: 'y', S: '2025-01-01', E: '2025-01-09' }, { T: 'x', S: '2024-12-31', E: '2025-01-02' }], 'T', 'S', 'E').tasks.map((x) => x.label), ['x', 'z', 'y']);
    // Plafond : les premières tâches (par début), le reste est compté ; les statuts et les bornes suivent les tâches AFFICHÉES / valides.
    const many = []; for (let i = 0; i < 260; i++) many.push({ T: 'n' + i, S: data.isoDayShift('2025-01-01', i), E: data.isoDayShift('2025-01-01', i + 2), St: i === 259 ? 'dernier' : 'x' });
    const gm = data.ganttTasks(many, 'T', 'S', 'E', 'St');
    assert.deepStrictEqual([gm.tasks.length, gm.hidden, gm.total, gm.max], [200, 60, 260, data.isoDayShift('2025-01-01', 201)]); assert.strictEqual(data.GANTT_MAX_ROWS, 200);
    assert.deepStrictEqual(gm.statuses, ['x', 'dernier'], 'les statuts viennent de TOUTES les tâches valides : une couleur ne change pas quand le plafond coupe');
    assert.strictEqual(data.ganttTasks(many, 'T', 'S', 'E', 'St', Infinity).tasks.length, 260); assert.strictEqual(data.ganttTasks(many, 'T', 'S', 'E', 'St', 5).tasks.length, 5); assert.strictEqual(data.ganttTasks(many, 'T', 'S', 'E', 'St', 'x').tasks.length, 200, 'plafond invalide : défaut');
    assert.deepStrictEqual(data.ganttTasks([], 'T', 'S', 'E', 'St'), { tasks: [], statuses: [], ignored: 0, hidden: 0, total: 0, min: null, max: null }); assert.deepStrictEqual(data.ganttTasks(undefined, 'T', 'S', 'E').tasks, []);
    // Une fin qui précède le début d'UNE autre tâche ne compte pas pour max : max = la dernière fin, pas la dernière tâche.
    assert.strictEqual(data.ganttTasks([{ T: 'a', S: '2025-01-01', E: '2025-06-30' }, { T: 'b', S: '2025-02-01', E: '2025-02-05' }], 'T', 'S', 'E').max, '2025-06-30');
    // Axe : mois au-delà de 60 jours (jamais plus de 8, un sur deux/trois au besoin), lundis de 11 à 60 jours, chaque jour jusqu'à 10 ; pct croissants dans [0, 1).
    const day = (iso) => Date.parse(iso + 'T00:00:00Z');
    const tm = data.ganttTicks(day('2025-01-15'), day('2025-08-20'));
    assert.ok(tm.every((tk) => tk.kind === 'month') && tm.every((tk, i) => i === 0 || tk.pct > tm[i - 1].pct) && tm.every((tk) => tk.pct >= 0 && tk.pct < 1), 'mois, croissants, dans l\'axe');
    assert.ok(tm.length <= data.GANTT_MAX_TICKS, 'au plus ' + data.GANTT_MAX_TICKS + ' graduations'); assert.deepStrictEqual([tm[0].year, tm[0].month, tm[0].day], [2025, 1, 1], 'le 1er mois commence à 8 % de l\'axe : pas de graduation de plus au bord');
    assert.ok(tm.every((tk) => tk.day === 1), 'les graduations de mois tombent le 1er');
    const tj = data.ganttTicks(day('2025-01-15'), day('2025-03-20'));
    assert.deepStrictEqual([tj[0].year, tj[0].month, tj[0].day, tj[0].pct, tj[1].month, tj[1].day], [2025, 0, 15, 0, 1, 1], 'le 1er mois commence loin du bord : une graduation au début nomme le mois de départ');
    const t2 = data.ganttTicks(day('2025-01-01'), day('2025-01-30'));
    assert.ok(t2.every((tk) => tk.kind === 'week') && t2.every((tk) => new Date(Date.UTC(tk.year, tk.month, tk.day)).getUTCDay() === 1), 'semaines : des lundis');
    const t3 = data.ganttTicks(day('2025-01-01'), day('2025-01-08')); assert.ok(t3.every((tk) => tk.kind === 'day') && t3.length === 8, 'chaque jour d\'une période courte');
    assert.ok(data.ganttTicks(day('2020-01-01'), day('2025-12-31')).length <= data.GANTT_MAX_TICKS, 'six ans : toujours au plus 8 graduations');
    assert.ok(data.ganttTicks(day('2025-01-01'), day('2025-12-31'), 3).length <= 4 && data.ganttTicks(day('2025-01-01'), day('2025-12-31'), 3).length >= 2, 'budget réglé par la largeur (3, +1 pour le début)');
    assert.deepStrictEqual(data.ganttTicks(day('2025-01-01'), day('2025-12-31'), 0).length, data.ganttTicks(day('2025-01-01'), day('2025-12-31')).length, 'budget invalide : défaut');
    assert.strictEqual(data.ganttTicks(day('2025-03-01'), day('2025-03-01')).length, 1, 'une période d\'un jour : une graduation');
    // Géométrie : une tâche occupe ses cases de jour entières (fin incluse) ; aujourd'hui = milieu de sa case, ou null hors de l'axe.
    const lay = data.ganttLayout(data.ganttTasks([{ T: 'a', S: '2025-03-01', E: '2025-03-10' }, { T: 'b', S: '2025-03-10', E: '2025-03-10' }], 'T', 'S', 'E'), Date.parse('2025-03-05T10:00:00Z'));
    assert.deepStrictEqual(lay.bars.map((x) => [x.label, x.left, x.width]), [['a', 0, 1], ['b', 0.9, 0.1]], 'axe de 10 jours : « a » le remplit, « b » (un jour) en prend un dixième');
    assert.ok(Math.abs(lay.today - 0.45) < 1e-9, 'le 5 mars occupe la 5e case : milieu à 45 %');
    assert.strictEqual(data.ganttLayout(data.ganttTasks(rowsG, 'T', 'S', 'E'), Date.parse('2030-01-01T00:00:00Z')).today, null, 'aujourd\'hui hors de l\'axe : pas de repère');
    assert.strictEqual(data.ganttLayout(data.ganttTasks(rowsG, 'T', 'S', 'E'), NaN).today, null); assert.strictEqual(data.ganttLayout(data.ganttTasks(rowsG, 'T', 'S', 'E'), undefined).today, null);
    assert.strictEqual(data.ganttLayout(data.ganttTasks([{ T: 'a', S: '2025-03-01', E: '2025-03-10' }], 'T', 'S', 'E'), Date.parse('2025-03-01T00:00:00Z')).today > 0, true, 'le 1er jour : dans l\'axe');
    assert.strictEqual(data.ganttLayout(data.ganttTasks([{ T: 'a', S: '2025-03-01', E: '2025-03-10' }], 'T', 'S', 'E'), Date.parse('2025-03-10T23:59:59Z')).today < 1, true, 'le dernier jour : dans l\'axe');
    assert.deepStrictEqual(data.ganttLayout(data.ganttTasks([], 'T', 'S', 'E'), Date.now()).bars, []); assert.strictEqual(data.ganttLayout(data.ganttTasks([], 'T', 'S', 'E'), Date.now()).today, null);
    // Store : un clic pose un filtre d'égalité sur le libellé ; la tuile reste entière, les autres sont filtrées ; même valeur = retiré.
    {
      const st = state.createStore();
      st.setRows(rowsG.slice(0, 3));
      st.addTile({ id: 'gt', type: 'gantt', dimension: 'T', startColumn: 'S', endColumn: 'E', seriesColumn: 'St', title: 'G' });
      st.addTile({ id: 'br', type: 'bar', dimension: 'St', measure: 'T', aggFn: 'count', title: 'B' });
      st.toggleFilter('T', 'b', 'gt');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[0], st.getState()).length, 3, 'le Gantt reste affiché en entier');
      assert.strictEqual(data.rowsForTile(st.getState().tiles[1], st.getState()).length, 1, 'les autres tuiles ne gardent que la tâche choisie');
      st.toggleFilter('T', 'b', 'gt'); assert.deepStrictEqual(st.getState().activeFilters, [], 'même tâche : filtre retiré');
      st.toggleFilter('St', 'Fait', 'gt'); st.removeTile('gt'); assert.deepStrictEqual(st.getState().activeFilters, [], 'supprimer la tuile lève son filtre');
    }
    // Export : une ligne par tâche dessinable, TOUTES (au-delà du plafond aussi), triées ; la colonne de couleur seulement si choisie ; filtres des autres tuiles appliqués.
    const stG = { rows: many, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const gTile = { id: 'gt', type: 'gantt', title: 'Planning', dimension: 'T', startColumn: 'S', endColumn: 'E', seriesColumn: 'St' };
    const sheetG = data.tileExportSheet(gTile, stG);
    assert.deepStrictEqual(sheetG.header, ['T', 'S', 'E', 'St']); assert.strictEqual(sheetG.rows.length, 260); assert.deepStrictEqual(sheetG.rows[0], ['n0', '2025-01-01', '2025-01-03', 'x']);
    const sheetG2 = data.tileExportSheet(Object.assign({}, gTile, { seriesColumn: undefined }), stG); assert.deepStrictEqual(sheetG2.header, ['T', 'S', 'E']); assert.deepStrictEqual(sheetG2.rows[1], ['n1', '2025-01-02', '2025-01-04']);
    assert.strictEqual(data.tileExportSheet(gTile, Object.assign({}, stG, { rows: [] })).rows.length, 0, 'aucune ligne : en-têtes seuls'); assert.strictEqual(data.tileExportKind(gTile), 'table', 'PDF/PPTX : un tableau natif (pas d\'instance ECharts)');
    assert.strictEqual(data.tileExportSheet(gTile, Object.assign({}, stG, { rows: rowsG, activeFilters: [{ column: 'St', value: 'Fait', sourceTileId: 'autre' }] })).rows.length, 1, 'filtre d\'une autre tuile : seule « a » reste (les autres lignes « Fait » n\'ont pas de dates valides)');
    // Types : palette oui, format de nombre non (aucun nombre) ; ni tri, ni séries de barres, ni repère, ni étiquettes de valeur.
    assert.strictEqual(data.supportsPalette({ type: 'gantt' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'gantt' }), false, 'un Gantt n\'affiche aucun nombre');
    assert.strictEqual(data.isSortableTile({ type: 'gantt' }), false); assert.strictEqual(data.isSeriesTile({ type: 'gantt', seriesColumn: 'x' }), false, 'la couleur n\'est pas une série de barres');
    assert.strictEqual(data.supportsRefLine({ type: 'gantt' }), false); assert.strictEqual(data.supportsValueLabels({ type: 'gantt' }), false);
    // Défauts : deux vraies colonnes de dates, la 1re = celle qui précède l'autre sur la majorité des lignes (jugé sur les VALEURS) ; libellé = une colonne d'identifiants ; couleur = petite catégorie.
    const projet = [];
    for (let i = 0; i < 24; i++) projet.push({ Tâche: 'Tâche ' + i, Fin: data.isoDayShift('2025-02-10', i * 3 + 5), Debut: data.isoDayShift('2025-02-10', i * 3), Statut: ['Fait', 'En cours', 'A faire'][i % 3], Charge: 2 + (i % 4) });
    const dg = advice.defaultsForType('gantt', projet, ['Tâche', 'Fin', 'Debut', 'Statut', 'Charge']);
    assert.deepStrictEqual([dg.startColumn, dg.endColumn, dg.dimension, dg.seriesColumn], ['Debut', 'Fin', 'Tâche', 'Statut'], 'colonnes dans l\'ordre INVERSE de la table : le début est trouvé par les valeurs');
    assert.ok(!('measure' in dg) && !('aggFn' in dg), 'ni mesure ni agrégat');
    const dg2 = advice.defaultsForType('gantt', projet.map((r) => ({ Tâche: r.Tâche, Debut: r.Debut, Fin: r.Fin })), ['Tâche', 'Debut', 'Fin']); assert.strictEqual(dg2.seriesColumn, undefined, 'aucune petite catégorie : pas de couleur'); assert.deepStrictEqual([dg2.startColumn, dg2.endColumn], ['Debut', 'Fin']);
    assert.strictEqual(advice.defaultsForType('gantt', projet.map((r) => ({ Tâche: r.Tâche, Debut: r.Debut })), ['Tâche', 'Debut']), null, 'une seule colonne de dates : rien à préremplir');
    assert.strictEqual(advice.adviceForType('gantt', projet.map((r) => ({ Tâche: r.Tâche, Debut: r.Debut })), ['Tâche', 'Debut']).key, 'advice.fit.noTwoDates');
    assert.strictEqual(advice.adviceForType('gantt', projet, ['Tâche', 'Fin', 'Debut', 'Statut', 'Charge']).key, 'advice.use.gantt'); assert.strictEqual(advice.TILE_TYPES.includes('gantt'), false, 'jamais proposé à l\'accueil');
    // Conseils : aucune barre dessinable, plus de statuts que de couleurs, lignes écartées, plafond ; rien pour un planning sain ; colonnes absentes sans exception.
    const tg = { type: 'gantt', dimension: 'Tâche', startColumn: 'Debut', endColumn: 'Fin', seriesColumn: 'Statut' };
    assert.strictEqual(advice.adviceForTile(tg, projet), null);
    assert.deepStrictEqual(advice.adviceForTile(Object.assign({}, tg, { startColumn: 'Statut' }), projet), { key: 'advice.gantt.noTask', vars: { start: 'Statut', end: 'Fin' }, level: 'warn' });
    assert.deepStrictEqual(advice.adviceForTile(tg, projet.concat([{ Tâche: 'X', Debut: '2025-05-01', Fin: '2025-04-01', Statut: 'Fait' }, { Tâche: 'Y', Debut: null, Fin: null, Statut: 'Fait' }])), { key: 'advice.gantt.ignored', vars: { n: 2 }, level: 'tip' });
    const nine = projet.map((r, i) => Object.assign({}, r, { Statut: 'S' + (i % 9) })); assert.deepStrictEqual(advice.adviceForTile(tg, nine), { key: 'advice.gantt.manyStatuses', vars: { n: 9, max: data.paletteColors(undefined).length }, level: 'warn' });
    assert.strictEqual(advice.adviceForTile(Object.assign({}, tg, { palette: 'okabe' }), nine).key, data.paletteColors('okabe').length >= 9 ? 'advice.gantt.ignored' : 'advice.gantt.manyStatuses', 'le seuil suit la longueur de la palette choisie');
    assert.deepStrictEqual(advice.adviceForTile(Object.assign({}, tg, { seriesColumn: undefined }), many.map((r) => ({ Tâche: r.T, Debut: r.S, Fin: r.E }))), { key: 'advice.gantt.truncated', vars: { max: 200, hidden: 60 }, level: 'tip' });
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'gantt', dimension: 'Absente', startColumn: 'Autre', endColumn: 'Encore' }, projet)); assert.strictEqual(advice.adviceForTile({ type: 'gantt', dimension: 'Tâche' }, projet), null, 'sans début/fin : pas de conseil');
    // i18n : textes dans les deux langues, pluriels du libellé de ligne et des lignes écartées.
    ['tileForm.type.gantt', 'tileForm.dimension.labelTask', 'tileForm.startColumn.label', 'tileForm.endColumn.label', 'tileForm.series.labelStatus', 'tileForm.error.ganttStartRequired', 'tileForm.error.ganttEndRequired', 'tileTitle.gantt',
      'chart.gantt.empty', 'chart.gantt.row', 'chart.gantt.today', 'chart.gantt.hidden', 'chart.gantt.ignored', 'advice.use.gantt', 'advice.fit.noTwoDates', 'advice.gantt.noTask', 'advice.gantt.manyStatuses', 'advice.gantt.ignored', 'advice.gantt.truncated']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.gantt.row', { label: 'A', start: '1 mars 2025', end: '1 mars 2025', days: '1' }), 'A : du 1 mars 2025 au 1 mars 2025 (1 jour)'); assert.ok(/\(12 jours\)/.test(i18n.t('chart.gantt.row', { label: 'A', start: 'a', end: 'b', days: '12' })));
    assert.ok(/^1 ligne ignorée/.test(i18n.t('chart.gantt.ignored', { n: '1' })) && /^3 lignes ignorées/.test(i18n.t('chart.gantt.ignored', { n: '3' })));
    i18n.setLang('en'); assert.strictEqual(i18n.t('chart.gantt.row', { label: 'A', start: 'x', end: 'y', days: '1' }), 'A: x to y (1 day)'); assert.ok(/\(5 days\)/.test(i18n.t('chart.gantt.row', { label: 'A', start: 'x', end: 'y', days: '5' }))); assert.strictEqual(i18n.t('tileTitle.gantt', { dimension: 'Tâche' }), 'Schedule (Tâche)'); i18n.setLang('fr');
    assert.strictEqual(i18n.t('tileTitle.gantt', { dimension: 'Tâche' }), 'Planning (Tâche)');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainG = fsG.readFileSync(pathG.join(rootG, 'js', 'main.js'), 'utf8');
    const chartsG = fsG.readFileSync(pathG.join(rootG, 'js', 'charts.js'), 'utf8');
    const indexG = fsG.readFileSync(pathG.join(rootG, 'index.html'), 'utf8');
    const cssG = fsG.readFileSync(pathG.join(rootG, 'css', 'style.css'), 'utf8');
    assert.ok(/const TYPE_CARDS = \[[^\]]*'gantt'/.test(mainG) && /<option value="gantt"/.test(indexG) && /'type-gantt':/.test(mainG), 'carte, option et icône du type');
    assert.ok(/type !== 'calendar' && type !== 'gantt'(?: && type !== 'sunburst')?; \}/.test(mainG), 'pas de drill-down');
    assert.ok(/id="tile-start-column"/.test(indexG) && /id="tile-end-column"/.test(indexG) && /startColumnSelect, endColumnSelect,/.test(mainG), 'deux champs de colonne branchés comme comboboxes');
    assert.ok(/inferColumnKind\(startColumnSelect\.value\) !== 'date'\) fail\('tile-start-column', 'tileForm\.error\.calendarNotDate'\)/.test(mainG) && /inferColumnKind\(endColumnSelect\.value\) !== 'date'\) fail\('tile-end-column', 'tileForm\.error\.calendarNotDate'\)/.test(mainG), 'début et fin doivent être de vraies dates');
    assert.ok(/!isText && !isTable && !isGantt && !measure\) fail\('tile-measure'/.test(mainG) && /tileData\.measure = undefined; tileData\.aggFn = undefined; \}\s*\n\s*tileData\.startColumn/.test(mainG), 'aucune mesure exigée ni écrite');
    assert.ok(/tile\.type === 'gantt'\) \{\s*renderGantt\(tile, rows, state, container\);/.test(chartsG), 'dispatch de renderTile');
    const rg = chartsG.slice(chartsG.indexOf('function renderGantt'), chartsG.indexOf('async function renderGauge'));
    assert.ok(/data-value="\$\{escapeHtml\(b\.label\)\}"/.test(rg) && /escapeHtml\(label\)/.test(rg) && /data-status="\$\{escapeHtml\(st\)\}"/.test(rg) && /title="\$\{escapeHtml\(title\)\}"/.test(rg), 'libellé, statut et infobulle (saisis dans les données) sont échappés');
    assert.ok(/background:\$\{colorOf\(/.test(rg) && /paletteColors\(tile\.palette\)/.test(rg) && !/style="[^"]*\$\{(?:b\.status|st\b|label)/.test(rg), 'les couleurs en ligne viennent de la palette, jamais d\'une donnée');
    assert.ok(/toggleFilter\(live\.seriesColumn, chip\.dataset\.status, live\.id\)/.test(rg) && /toggleFilter\(live\.dimension, row\.dataset\.value, live\.id\)/.test(rg), 'clic = filtre du libellé ou du statut, sur la tuile VIVANTE');
    assert.ok(/e\.key !== 'Enter' && e\.key !== ' '/.test(rg), 'clavier : Entrée et Espace');
    assert.ok(/<\/p>`\s*:\s*''\)|gantt-note/.test(rg) && /gantt-foot/.test(rg) && /\.gantt-foot \{ position: sticky; bottom: 0;/.test(cssG), 'légende collante en bas de la tuile');
    assert.ok(/\.gantt-tick \{[^}]*overflow: hidden; text-overflow: ellipsis/.test(cssG), 'chaque graduation est rognée à sa case : jamais posée sur la voisine');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsG), 'aucun format de nombre en dur dans charts.js');
    console.log('OK gantt — barres début/fin, lignes sans dates écartées, tri, plafond, axe du temps, aujourd\'hui, store (libellé, statut), export, défauts, conseils, i18n, câblage');
  }

  // Petits multiples (18/11/2026) : un petit graphique par valeur de la colonne Séries, même échelle, mêmes catégories ; option des barres/courbe, pas un type.
  {
    const fsS = require('fs'), pathS = require('path'), rootS = pathS.join(__dirname, '..');
    // Prédicats : barres brutes ou courbe avec une colonne Séries, case cochée ; jamais sans Séries, en mode mesure, ni sur un autre type.
    const smBar = { type: 'bar', dimension: 'P', measure: 'M', aggFn: 'sum', seriesColumn: 'R', smallMultiples: true };
    assert.strictEqual(data.isSmallMultiplesTile(smBar), true);
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { type: 'line' })), true);
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { smallMultiples: undefined })), false);
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { smallMultiples: 'true' })), false, 'seul `true` compte');
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { seriesColumn: '' })), false, 'sans colonne Séries : rien à séparer');
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { measureMode: 'ytd', dateColumn: 'D' })), false, 'mode mesure : une seule série par nature');
    assert.strictEqual(data.isSmallMultiplesTile(Object.assign({}, smBar, { type: 'pie' })), false);
    assert.strictEqual(data.isSmallMultiplesTile(null), false);
    // Rien d'empilé, ni repère, ni étiquettes : les options valables pour des séries superposées sont ignorées (elles restent lisibles si la case est décochée).
    const wished = Object.assign({}, smBar, { stacked: true, stackPercent: true, refLine: 'average', valueLabels: true, horizontal: true });
    assert.strictEqual(data.isStackedTile(wished), false); assert.strictEqual(data.isStackedPercentTile(wished), false);
    assert.strictEqual(data.supportsRefLine(wished), false); assert.strictEqual(data.refLineKind(wished), ''); assert.strictEqual(data.refLineValue(wished, [1, 2, 3]), null); assert.strictEqual(data.supportsValueLabels(wished), false);
    assert.strictEqual(data.isStackedTile(Object.assign({}, wished, { smallMultiples: undefined })), true, 'décochée : la pile revient');
    assert.strictEqual(data.supportsRefLine(Object.assign({}, wished, { smallMultiples: undefined })), true);
    assert.strictEqual(data.isSeriesTile(smBar), true, 'ce sont bien les calculs des séries multiples');

    // Panneaux : au plus 12, le reste compté.
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: 'S' + i, values: [i] }));
    assert.deepStrictEqual(data.smallMultiplesPanels(mk(4)).hidden, 0); assert.strictEqual(data.smallMultiplesPanels(mk(4)).panels.length, 4);
    const big14 = data.smallMultiplesPanels(mk(14)); assert.strictEqual(big14.panels.length, 12); assert.strictEqual(big14.hidden, 2); assert.strictEqual(big14.panels[11].name, 'S11', 'les premières séries');
    assert.deepStrictEqual(data.smallMultiplesPanels(mk(5), 3).panels.map((x) => x.name), ['S0', 'S1', 'S2']); assert.strictEqual(data.smallMultiplesPanels(null).panels.length, 0); assert.strictEqual(data.SMALL_MULTIPLES_MAX, 12);

    // Échelle commune : de 0 au plus haut (négatifs compris), 2 à 4 intervalles, la plus serrée ; valeurs vides/texte/BigInt.
    const rg = (vals) => data.smallMultiplesRange([{ values: vals }]);
    assert.deepStrictEqual(rg([6021]), { min: 0, max: 7500, step: 2500 }, '6 021 s\'arrête à 7 500, pas à 10 000');
    assert.deepStrictEqual(rg([2014]), { min: 0, max: 3000, step: 1000 });
    assert.deepStrictEqual(rg([100]), { min: 0, max: 100, step: 50 }, 'jamais une échelle à un seul intervalle');
    assert.deepStrictEqual(rg([12]), { min: 0, max: 15, step: 5 });
    assert.deepStrictEqual(rg([0.35]), { min: 0, max: 0.4, step: 0.2 }); assert.deepStrictEqual(rg([-3, 2]), { min: -4, max: 2, step: 2 }); assert.deepStrictEqual(rg([-100, 50]), { min: -100, max: 50, step: 50 });
    assert.deepStrictEqual(rg([0, 0]), { min: 0, max: 1, step: 0.5 }, 'rien à montrer : 0 à 1'); assert.deepStrictEqual(rg([null, 'x', true, NaN]), { min: 0, max: 1, step: 0.5 }); assert.deepStrictEqual(data.smallMultiplesRange([]), { min: 0, max: 1, step: 0.5 }); assert.deepStrictEqual(data.smallMultiplesRange(null), { min: 0, max: 1, step: 0.5 });
    assert.deepStrictEqual(rg([BigInt(6021)]), rg([6021]), 'DuckDB rend des BigInt');
    assert.deepStrictEqual(data.smallMultiplesRange([{ values: [1, null] }, { values: [12, 3] }, { values: [5] }]), { min: 0, max: 15, step: 5 }, 'tous les panneaux, un seul jeu de bornes');
    for (const hi of [1, 2, 3, 5, 7, 9, 12, 33, 99, 101, 250, 999, 1500, 4800, 6021, 12345, 1234567, 0.07, 0.9]) {
      const r = rg([hi]); const k = (r.max - r.min) / r.step;
      assert.ok(r.max >= hi && r.min <= 0, 'couvre ' + hi); assert.ok(Math.abs(k - Math.round(k)) < 1e-9 && k >= 2 && k <= 4, 'de 2 à 4 intervalles entiers pour ' + hi + ' : ' + k);
      assert.ok(hi / r.max >= 0.5, 'la plus haute valeur remplit au moins la moitié de l\'échelle (' + hi + ' sur ' + r.max + ')');
    }

    // Grille : colonnes choisies pour la plus grande zone de tracé, dans la tuile, sans recouvrement, jamais une dimension nulle.
    const gr = (n, w, h, o) => data.smallMultiplesGrid(n, w, h, o);
    assert.strictEqual(gr(1, 270, 180).cols, 1); assert.strictEqual(gr(4, 270, 180).cols, 2); assert.strictEqual(gr(4, 270, 180).rows, 2); assert.strictEqual(gr(12, 270, 180).cols, 4);
    assert.strictEqual(gr(4, 1200, 200).cols, 4, 'tuile très large : une rangée'); assert.strictEqual(gr(4, 200, 900).cols, 1, 'tuile très haute : une colonne');
    for (const [n, w, h] of [[1, 270, 180], [2, 270, 180], [3, 270, 180], [4, 270, 180], [5, 270, 180], [7, 300, 200], [12, 270, 180], [12, 1200, 600], [6, 80, 60], [9, 0, 0]]) {
      const g = gr(n, w, h); assert.strictEqual(g.cols * g.rows >= n, true); assert.ok(g.plotW >= 1 && g.plotH >= 1);
      assert.strictEqual(g.xs.length, g.cols); assert.strictEqual(g.ys.length, g.rows);
      if (w > 0 && h > 0 && w > 120 && h > 100) {
        assert.ok(g.xs[g.cols - 1] + g.plotW <= w + 1e-6, 'dans la largeur ' + [n, w, h]); assert.ok(g.ys[g.rows - 1] + g.plotH <= h + 1e-6, 'dans la hauteur ' + [n, w, h]);
        for (let c = 1; c < g.cols; c++) assert.ok(g.xs[c] >= g.xs[c - 1] + g.plotW, 'colonnes sans recouvrement'); for (let r = 1; r < g.rows; r++) assert.ok(g.ys[r] - g.titleH >= g.ys[r - 1] + g.plotH, 'rangées sans recouvrement (titre compris)');
      }
    }
    assert.deepStrictEqual(gr(3, 300, 200, { left: 60, bottom: 40 }).xs[0], 60, 'marge gauche réservée aux graduations'); assert.ok(gr(1, 300, 200, { bottom: 60 }).plotH < gr(1, 300, 200, { bottom: 10 }).plotH, 'marge basse réservée aux catégories');

    // Export Excel : celui des mêmes séries superposées (la mise en page ne change pas les données).
    const rowsS = []; ['N', 'S', 'E'].forEach((r, ri) => ['a', 'b', 'c', 'd'].forEach((p, pi) => rowsS.push({ R: r, P: p, M: (ri + 1) * (pi + 1) })));
    const stS = { rows: rowsS, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const sheetOn = data.tileExportSheet(Object.assign({ id: 'x', title: 'Montants' }, smBar), stS); const sheetOff = data.tileExportSheet(Object.assign({ id: 'x', title: 'Montants' }, smBar, { smallMultiples: undefined }), stS);
    assert.deepStrictEqual(sheetOn, sheetOff); assert.ok(sheetOn.rows.length > 0);

    // Conseils : plus de 12 séries (seuls 12 panneaux), une seule série, trop de catégories ; la couleur n'est plus le sujet (> 8 séries ne dit rien de la palette).
    const many = []; for (let r = 0; r < 14; r++) for (let p = 0; p < 3; p++) many.push({ R: 'S' + r, P: 'p' + p, M: r + p });
    assert.deepStrictEqual(advice.adviceForTile(smBar, many), { key: 'advice.smallMultiples.tooMany', vars: { n: 14, max: 12 }, level: 'warn' });
    assert.strictEqual(advice.adviceForTile(Object.assign({}, smBar, { smallMultiples: undefined }), many).key, 'advice.series.tooMany', 'sans la case : l\'avertissement de couleurs');
    const ten = []; for (let r = 0; r < 10; r++) for (let p = 0; p < 3; p++) ten.push({ R: 'S' + r, P: 'p' + p, M: r + p });
    assert.strictEqual(advice.adviceForTile(smBar, ten), null, '10 séries : plus de limite de couleurs, 10 panneaux');
    assert.strictEqual(advice.adviceForTile(Object.assign({}, smBar, { smallMultiples: undefined }), ten).key, 'advice.series.tooMany');
    assert.deepStrictEqual(advice.adviceForTile(smBar, rowsS.filter((r) => r.R === 'N')), { key: 'advice.smallMultiples.single', vars: {}, level: 'tip' });
    const wide = []; for (let r = 0; r < 3; r++) for (let p = 0; p < 30; p++) wide.push({ R: 'S' + r, P: 'p' + p, M: r + p });
    assert.deepStrictEqual(advice.adviceForTile(smBar, wide), { key: 'advice.smallMultiples.tooManyCategories', vars: { n: 30, max: 24 }, level: 'tip' });
    assert.strictEqual(advice.adviceForTile(smBar, rowsS), null, 'un cas sain : aucun conseil');
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'bar', dimension: 'Absente', measure: 'Autre', aggFn: 'sum', seriesColumn: 'Encore', smallMultiples: true }, rowsS));

    // i18n : fr/en, et la note dit combien de panneaux sont dessinés.
    ['tileForm.smallMultiples.label', 'chart.smallMultiples.hidden', 'advice.smallMultiples.tooMany', 'advice.smallMultiples.single', 'advice.smallMultiples.tooManyCategories']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.smallMultiples.hidden', { shown: 12, n: 14 }), 'Les 12 premières séries sur 14');
    i18n.setLang('en'); assert.strictEqual(i18n.t('chart.smallMultiples.hidden', { shown: 12, n: 14 }), 'First 12 of 14 series'); i18n.setLang('fr');

    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainS = fsS.readFileSync(pathS.join(rootS, 'js', 'main.js'), 'utf8');
    const chartsS = fsS.readFileSync(pathS.join(rootS, 'js', 'charts.js'), 'utf8');
    const indexS = fsS.readFileSync(pathS.join(rootS, 'index.html'), 'utf8');
    assert.ok(/id="tile-small-multiples"/.test(indexS) && /id="tile-small-multiples-field"/.test(indexS) && /data-i18n="tileForm\.smallMultiples\.label"/.test(indexS), 'case et champ du formulaire');
    assert.ok(/smallMultiplesCheckbox\.addEventListener\('change', updateFormFieldsForType\)/.test(mainS), 'la case relance l\'affichage des champs qu\'elle exclut');
    assert.ok(/smallMultiplesField\.hidden = !\(seriesSelect\.value && \(isBarBrut \|\| type === 'line'\)\)/.test(mainS), 'visible avec une colonne Séries, barres brutes ou courbe');
    assert.ok(/\[stackField, stackPercentField, horizontalField, valueLabelsField, refLineField, refValueField\]\.forEach/.test(mainS), 'les champs exclus sont masqués');
    assert.ok(/tileData\.smallMultiples = smallOnForm \? true : undefined/.test(mainS) && /tileData\.stacked = \(seriesColumn && !smallOnForm &&/.test(mainS) && /horizontalCheckbox\.checked && !smallOnForm/.test(mainS) && /valueLabelsCheckbox\.checked && !smallOnForm/.test(mainS) && /!stackPctForm && !smallOnForm/.test(mainS), 'readTileForm écarte ce qui est exclu : jamais une valeur cachée qui bloque ou revient');
    assert.ok(/smallMultiplesCheckbox\.checked = !!tile\.smallMultiples/.test(mainS) && /smallMultiplesCheckbox\.checked = false;/.test(mainS), 'édition et réinitialisation');
    assert.ok(/const smallOn = !!multi && isSmallMultiplesTile\(tile\);\s*\n\s*if \(smallOn\) \{/.test(chartsS), 'branché dans la chaîne de renderChart (le nombre de finalizeOption/setOption ne change pas)');
    assert.ok(/instance\.__refit = undefined; \/\/ une géométrie en pixels/.test(chartsS) && /instance\.__refit = \(\) => \{\s*\n\s*const w = instance\.getWidth\(\);/.test(chartsS), 'la géométrie en pixels est reposée au redimensionnement, et levée quand la case est décochée');
    const bs = chartsS.slice(chartsS.indexOf('function buildSmallMultiplesOption'), chartsS.indexOf('async function renderChart'));
    assert.ok(/String\(sr\.name\)/.test(bs) && !/innerHTML|formatter: \(/.test(bs.replace(/formatter: f\.axis/g, '')), 'le nom de série n\'est que du texte canvas, aucune chaîne en HTML');
    assert.ok(/xAxisIndex: i, yAxisIndex: i/.test(bs) && /min: range\.min,\s*\n\s*max: range\.max,\s*\n\s*interval: range\.step/.test(bs), 'chaque panneau a ses axes, tous sur la même échelle');
    assert.ok(!/Intl\.NumberFormat|toFixed/.test(chartsS), 'aucun format de nombre en dur dans charts.js');
    console.log('OK petits multiples — prédicats, échelle commune, grille, panneaux plafonnés, export inchangé, conseils, i18n, câblage');
  }

  // Soleil (18/11/2026) : une répartition hiérarchique en anneaux ; l'angle d'une part est une quantité qui s'additionne, un clic filtre chaque anneau jusqu'à la part.
  {
    const fsU = require('fs'), pathU = require('path'), rootU = pathU.join(__dirname, '..');
    const U = (R, P, M, V) => ({ R, P, M, V });
    const rowsU = [
      U('Nord', 'N1', 'a', 10), U('Nord', 'N1', 'b', 20), U('Nord', 'N2', 'a', 5), U('Nord', '', 'a', 7), // la 4e s'arrête à l'anneau central
      U('Sud', 'S1', 'a', 40),
      U('', 'X', 'a', 99), // aucune valeur au 1er anneau : ignorée
      U('Est', 'E1', 'a', -5) // taille négative : pas d'angle
    ];
    const treeU = (o) => data.sunburstTree(rowsU, ['R', 'P', 'M'], 'V', 'sum', o && o.sort, o && o.cap);
    // Niveaux : la dimension puis la liste, sans doublon ni vide, au plus 4.
    assert.deepStrictEqual(data.sunburstLevels({ dimension: 'A', drillDimensions: ['B', 'A', '', 'C', 'D', 'E'] }), ['A', 'B', 'C', 'D']);
    assert.deepStrictEqual(data.sunburstLevels({ dimension: 'A' }), ['A']); assert.deepStrictEqual(data.sunburstLevels(null), []); assert.strictEqual(data.SUNBURST_MAX_LEVELS, 4); assert.strictEqual(data.SUNBURST_MAX_CHILDREN, 15);
    // Arbre : valeur d'une part = sa part propre + ses enfants ; ignorées, écartées, négatives ; la somme de l'export est celle des lignes retenues.
    const tU = treeU();
    assert.deepStrictEqual(tU.roots.map((r) => [r.name, r.value]), [['Nord', 42], ['Sud', 40]], 'une part négative n\'est pas dessinée');
    assert.deepStrictEqual(tU.roots[0].children.map((c) => [c.name, c.value]), [['N1', 30], ['N2', 5]]);
    assert.deepStrictEqual(tU.roots[0].children[0].children.map((c) => [c.path.join('/'), c.value]), [['Nord/N1/a', 10], ['Nord/N1/b', 20]]);
    assert.strictEqual(tU.total, 82); assert.strictEqual(tU.ignored, 1); assert.strictEqual(tU.depth, 3); assert.ok(tU.dropped >= 1 && tU.negative >= 1); assert.strictEqual(tU.hidden, 0);
    assert.strictEqual(tU.roots[0].value - tU.roots[0].children.reduce((a, c) => a + c.value, 0), 7, 'la ligne qui s\'arrête à l\'anneau central laisse un vide honnête dans sa part');
    assert.deepStrictEqual(tU.paths.map((p) => [p.path.join('/'), p.value]), [['Nord', 7], ['Nord/N1/a', 10], ['Nord/N1/b', 20], ['Nord/N2/a', 5], ['Sud/S1/a', 40], ['Est/E1/a', -5]]);
    assert.strictEqual(tU.paths.reduce((a, p) => a + p.value, 0), 77, 'somme de l\'export = somme des lignes retenues (la ligne ignorée exclue)');
    assert.strictEqual(tU.levels.join(','), 'R,P,M');
    // Comptage, moyenne héritée lue comme une somme, BigInt et chaînes numériques, cellules vides.
    const cU = data.sunburstTree(rowsU, ['R', 'P', 'M'], 'V', 'count');
    assert.deepStrictEqual(cU.roots.map((r) => [r.name, r.value]), [['Nord', 4], ['Sud', 1], ['Est', 1]], 'un comptage compte les lignes, négatives comprises');
    assert.strictEqual(data.sunburstTree(rowsU, ['R', 'P'], null, 'sum').roots[0].value, 4, 'sans mesure : comptage');
    assert.deepStrictEqual(data.sunburstTree(rowsU, ['R', 'P', 'M'], 'V', 'avg').roots.map((r) => r.value), tU.roots.map((r) => r.value), 'moyenne/min/max d\'une ancienne configuration : lus comme une somme');
    assert.strictEqual(data.sunburstTree([{ A: 'x', B: 'y', M: BigInt(5) }, { A: 'x', B: 'y', M: '7' }, { A: 'x', B: 'y', M: null }, { A: 'x', B: 'y', M: 'texte' }], ['A', 'B'], 'M', 'sum').roots[0].value, 12, 'BigInt (DuckDB), chaîne numérique, vide et texte comptés pour 0');
    assert.strictEqual(data.sunburstTree([{ A: 2024, B: 1 }, { A: '2024', B: 2 }], ['A', 'B'], null, 'count').roots.length, 1, 'une valeur de niveau est comparée en String()');
    assert.deepStrictEqual(data.sunburstTree([], ['A'], 'M', 'sum').roots, []); assert.deepStrictEqual(data.sunburstTree(null, null, 'M', 'sum').roots, []); assert.strictEqual(data.sunburstTree(rowsU, [], 'V', 'sum').ignored, rowsU.length);
    assert.strictEqual(data.sunburstTree(rowsU, ['R', 'R', 'P'], 'V', 'sum').levels.join(','), 'R,P', 'une colonne qui revient ne fait pas un anneau de plus');
    // Plafond par part : les plus grandes, le reste compté ; tri : ordre d'apparition par défaut, sinon celui du tri de la tuile.
    const capU = treeU({ cap: 1 });
    assert.strictEqual(capU.roots.length, 1); assert.strictEqual(capU.roots[0].name, 'Nord'); assert.strictEqual(capU.roots[0].children.length, 1); assert.strictEqual(capU.roots[0].children[0].children[0].name, 'b', 'la plus grande part reste');
    assert.strictEqual(capU.hidden, 3); assert.strictEqual(capU.roots[0].value, 42, 'le parent garde sa vraie taille : les parts écartées laissent un vide honnête, jamais un parent rétréci qui prétendrait ne rien contenir de plus');
    assert.strictEqual(capU.paths.length, tU.paths.length, 'l\'export garde tout, plafond ou non');
    assert.deepStrictEqual(treeU({ sort: 'value-asc' }).roots.map((r) => r.name), ['Sud', 'Nord']); assert.deepStrictEqual(treeU({ sort: 'label' }).roots.map((r) => r.name), ['Nord', 'Sud']); assert.deepStrictEqual(treeU({ sort: 'value-desc' }).roots[0].children.map((c) => c.name), ['N1', 'N2']);
    const wideU = []; for (let i = 0; i < 20; i++) wideU.push({ R: 'Nord', P: 'p' + i, V: i + 1 });
    assert.strictEqual(data.sunburstTree(wideU, ['R', 'P'], 'V', 'sum').hidden, 5, '20 parts : les 15 plus grandes, 5 comptées'); assert.strictEqual(data.sunburstTree(wideU, ['R', 'P'], 'V', 'sum').roots[0].children.length, 15);
    assert.ok(!data.sunburstTree(wideU, ['R', 'P'], 'V', 'sum').roots[0].children.some((c) => c.name === 'p0'), 'les plus petites sont celles qu\'on écarte');
    // Filtres d'un clic : chaque anneau jusqu'à la part ; 2e clic = tout retirer ; remonter retire les anneaux plus profonds ; les filtres d'une AUTRE tuile restent.
    const cols = ['R', 'P', 'M'];
    const tg = (f, values) => data.sunburstFilterToggles(f, cols, values, 't');
    const F = (column, value, sourceTileId) => ({ column, value, sourceTileId });
    assert.deepStrictEqual(tg([], ['Nord', 'N1']), [{ column: 'R', value: 'Nord' }, { column: 'P', value: 'N1' }]);
    assert.deepStrictEqual(tg([F('R', 'Nord', 't'), F('P', 'N1', 't')], ['Nord', 'N1']), [{ column: 'R', value: 'Nord' }, { column: 'P', value: 'N1' }], '2e clic sur la même part : tout part');
    assert.deepStrictEqual(tg([F('R', 'Nord', 't'), F('P', 'N1', 't')], ['Nord', 'N2']), [{ column: 'P', value: 'N2' }], 'un voisin dans la même branche : seul l\'anneau qui change bouge (jamais le filtre commun levé)');
    assert.deepStrictEqual(tg([F('R', 'Nord', 't'), F('P', 'N1', 't'), F('M', 'a', 't')], ['Nord']), [{ column: 'P', value: 'N1' }, { column: 'M', value: 'a' }], 'remonter : les anneaux plus profonds sont retirés, Nord reste');
    assert.deepStrictEqual(tg([F('R', 'Nord', 't'), F('P', 'N1', 'autre')], ['Nord']), [{ column: 'R', value: 'Nord' }], 'le filtre d\'une autre tuile sur un anneau plus profond n\'est pas touché');
    assert.deepStrictEqual(tg([F('R', 'Sud', 't')], ['Nord', 'N1']), [{ column: 'R', value: 'Nord' }, { column: 'P', value: 'N1' }], 'une autre région : remplacée, puis le produit');
    assert.deepStrictEqual(tg([{ column: 'R', type: 'range', min: 0, max: 9 }], ['Nord']), [{ column: 'R', value: 'Nord' }], 'un filtre de plage n\'est pas « déjà la bonne valeur »');
    assert.deepStrictEqual(tg(null, []), []); assert.deepStrictEqual(data.sunburstFilterToggles([], null, ['x'], 't'), []);
    // Application dans le store : l'enchaînement des appels donne le bon état à chaque clic, jamais un anneau commun levé par erreur.
    {
      const stU = state.createStore(); stU.setRows(rowsU); stU.addTile({ id: 't', type: 'sunburst', dimension: 'R', drillDimensions: ['P', 'M'], measure: 'V', aggFn: 'sum' });
      const click = (values) => data.sunburstFilterToggles(stU.getState().activeFilters, cols, values, 't').forEach((c) => stU.toggleFilter(c.column, c.value, 't'));
      const now = () => stU.getState().activeFilters.map((f) => f.column + '=' + f.value).join('|');
      click(['Nord']); assert.strictEqual(now(), 'R=Nord'); click(['Nord', 'N1']); assert.strictEqual(now(), 'R=Nord|P=N1'); click(['Nord', 'N2']); assert.strictEqual(now(), 'R=Nord|P=N2');
      click(['Nord', 'N2', 'a']); assert.strictEqual(now(), 'R=Nord|P=N2|M=a'); click(['Nord']); assert.strictEqual(now(), 'R=Nord'); click(['Nord']); assert.strictEqual(now(), '');
      click(['Sud', 'S1', 'a']); assert.strictEqual(now(), 'R=Sud|P=S1|M=a'); click(['Sud', 'S1', 'a']); assert.strictEqual(now(), '');
    }
    // Part retenue ? Un filtre sur un anneau plus profond ne concerne pas ses parents.
    const sel = (f, path) => data.sunburstNodeSelected(f, cols, path);
    assert.strictEqual(sel([], ['Nord']), true); assert.strictEqual(sel([F('R', 'Nord', 't')], ['Nord', 'N1']), true); assert.strictEqual(sel([F('R', 'Nord', 't')], ['Sud']), false); assert.strictEqual(sel([F('R', 'Nord', 't'), F('P', 'N1', 't')], ['Nord']), true, 'le parent contient la part retenue');
    assert.strictEqual(sel([F('R', 'Nord', 't'), F('P', 'N1', 't')], ['Nord', 'N2']), false); assert.strictEqual(sel([F('R', 'Nord', 't'), F('P', 'N1', 't')], ['Nord', 'N1', 'a']), true); assert.strictEqual(sel(null, null), true);
    assert.strictEqual(sel([{ column: 'R', type: 'range', min: 0, max: 1 }], ['Nord']), false, 'un filtre de plage sur un nom : aucune part ne passe');
    // Types : tri, palette et format oui ; ni séries, ni repère, ni étiquettes ; jamais de drill-down.
    assert.strictEqual(data.isSortableTile({ type: 'sunburst' }), true); assert.strictEqual(data.supportsPalette({ type: 'sunburst' }), true); assert.strictEqual(data.supportsNumberFormat({ type: 'sunburst' }), true);
    assert.strictEqual(data.isSeriesTile({ type: 'sunburst', seriesColumn: 'P' }), false); assert.strictEqual(data.supportsRefLine({ type: 'sunburst' }), false); assert.strictEqual(data.supportsValueLabels({ type: 'sunburst' }), false); assert.strictEqual(data.tileExportKind({ type: 'sunburst' }), 'image');
    // Export Excel : une ligne par part où des lignes s'arrêtent, rangs vides complétés ; filtres des autres tuiles appliqués.
    const tileU = { id: 't', type: 'sunburst', dimension: 'R', drillDimensions: ['P', 'M'], measure: 'V', aggFn: 'sum', title: 'Soleil' };
    const stateU = { rows: rowsU, activeFilters: [], advancedFilters: [], drillIns: {}, comments: [], pages: [] };
    const shU = data.tileExportSheet(tileU, stateU);
    assert.deepStrictEqual(shU.header, ['R', 'P', 'M', 'V']);
    assert.deepStrictEqual(shU.rows, [['Nord', '', '', 7], ['Nord', 'N1', 'a', 10], ['Nord', 'N1', 'b', 20], ['Nord', 'N2', 'a', 5], ['Sud', 'S1', 'a', 40], ['Est', 'E1', 'a', -5]], 'rien n\'est plafonné ni écarté dans l\'export, les négatives y sont');
    assert.deepStrictEqual(data.tileExportSheet(Object.assign({}, tileU, { aggFn: 'count' }), stateU).rows[0], ['Nord', '', '', 1]);
    assert.deepStrictEqual(data.tileExportSheet(tileU, Object.assign({}, stateU, { activeFilters: [{ column: 'R', value: 'Sud', sourceTileId: 'autre' }] })).rows, [['Sud', 'S1', 'a', 40]]);
    assert.deepStrictEqual(data.tileExportSheet(tileU, Object.assign({}, stateU, { rows: [] })).rows, [], 'aucune ligne : en-têtes seuls');
    // Valeurs par défaut : une vraie hiérarchie jugée sur les VALEURS (jamais le nom), sinon les deux premières catégories ; toujours Somme/Comptage ; jamais proposé à l'accueil.
    const hier = []; ['Nord', 'Sud', 'Est'].forEach((r, ri) => { for (let p = 0; p < 3; p++) for (let m = 0; m < 2; m++) for (let k = 0; k < 3; k++) hier.push({ Region: r, Produit: r + '-' + (p + 1), Mois: 'M' + m, Montant: 100.5 + (ri * 9 + p * 3 + m + k) * 7.25 }); });
    const dU = advice.defaultsForType('sunburst', hier, ['Region', 'Produit', 'Mois', 'Montant']);
    assert.ok(dU && dU.dimension === 'Region' && JSON.stringify(dU.drillDimensions) === '["Produit"]' && dU.measure === 'Montant' && dU.aggFn === 'sum', JSON.stringify(dU));
    const flat = []; for (let i = 0; i < 60; i++) flat.push({ A: ['x', 'y', 'z'][i % 3], B: ['p', 'q', 'r', 's'][(i * 7 + (i >> 2)) % 4], Montant: 100.5 + i * 7.25 });
    const dF = advice.defaultsForType('sunburst', flat, ['A', 'B', 'Montant']);
    assert.ok(dF && dF.dimension && dF.drillDimensions && dF.drillDimensions.length === 1 && dF.drillDimensions[0] !== dF.dimension, JSON.stringify(dF));
    assert.strictEqual(advice.defaultsForType('sunburst', hier.map((r) => ({ Region: r.Region, Produit: r.Produit })), ['Region', 'Produit']).aggFn, 'count', 'aucune mesure : comptage');
    assert.strictEqual(advice.TILE_TYPES.includes('sunburst'), false, 'jamais proposé à l\'accueil');
    assert.strictEqual(advice.adviceForType('sunburst', hier, ['Region', 'Produit', 'Mois', 'Montant']).key, 'advice.use.sunburst');
    assert.strictEqual(advice.adviceForType('sunburst', hier.map((r) => ({ Region: r.Region, Montant: r.Montant })), ['Region', 'Montant']).key, 'advice.fit.needTwoDimensions', 'une seule catégorie : le type est déconseillé');
    // Conseils : moyenne/min/max, valeurs négatives, anneaux au-delà du plafond, couleurs qui se répètent, petites parts écartées ; rien pour un soleil sain.
    const tileA = { type: 'sunburst', dimension: 'Region', drillDimensions: ['Produit'], measure: 'Montant', aggFn: 'sum' };
    assert.strictEqual(advice.adviceForTile(tileA, hier), null);
    for (const agg of ['avg', 'min', 'max']) assert.strictEqual(advice.adviceForTile(Object.assign({}, tileA, { aggFn: agg }), hier).key, 'advice.sunburst.notAdditive', agg);
    assert.strictEqual(advice.adviceForTile(tileA, hier.map((r, i) => (i === 0 ? Object.assign({}, r, { Montant: -9999 }) : r))).key, 'advice.sunburst.negative');
    assert.deepStrictEqual(advice.adviceForTile(Object.assign({}, tileA, { drillDimensions: ['Produit', 'Mois', 'Montant', 'Region2', 'X'] }), hier), { key: 'advice.sunburst.tooManyLevels', vars: { max: 4 }, level: 'warn' });
    const manyRoots = []; for (let i = 0; i < 10; i++) for (let k = 0; k < 2; k++) manyRoots.push({ Region: 'R' + i, Produit: 'P' + k, Montant: 1 + i + k });
    assert.deepStrictEqual(advice.adviceForTile(tileA, manyRoots), { key: 'advice.sunburst.tooManyColors', vars: { n: 10, max: 8 }, level: 'tip' });
    assert.deepStrictEqual(advice.adviceForTile(tileA, wideU.map((r) => ({ Region: r.R, Produit: r.P, Montant: r.V }))), { key: 'advice.sunburst.hidden', vars: { n: 5, max: 15 }, level: 'tip' });
    assert.doesNotThrow(() => advice.adviceForTile({ type: 'sunburst', dimension: 'Absente', drillDimensions: ['Autre'], measure: 'Rien', aggFn: 'sum' }, hier));
    // i18n : fr/en pour tout ; les pluriels de la note disent combien de petites parts sont écartées.
    ['tileForm.type.sunburst', 'tileForm.drill.labelRings', 'tileForm.dimension.labelRing', 'tileTitle.sunburst', 'tileForm.error.sunburstAdditive', 'tileForm.error.sunburstTooManyRings', 'chart.sunburst.empty', 'chart.sunburst.hidden', 'advice.use.sunburst', 'advice.sunburst.notAdditive', 'advice.sunburst.negative', 'advice.sunburst.tooManyLevels', 'advice.sunburst.tooManyColors', 'advice.sunburst.hidden']
      .forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, 'traduction fr/en : ' + k));
    i18n.setLang('fr'); assert.strictEqual(i18n.t('chart.sunburst.hidden', { n: 1 }), '1 petite part non dessinée'); assert.strictEqual(i18n.t('chart.sunburst.hidden', { n: 5 }), '5 petites parts non dessinées');
    assert.strictEqual(i18n.t('tileTitle.sunburst', { measure: 'Montant', levels: 'Region › Produit' }), 'Montant : Region › Produit');
    i18n.setLang('en'); assert.strictEqual(i18n.t('chart.sunburst.hidden', { n: 1 }), '1 small part not drawn'); assert.strictEqual(i18n.t('chart.sunburst.hidden', { n: 5 }), '5 small parts not drawn'); i18n.setLang('fr');
    // Câblage lu dans les sources (le navigateur le rejoue, voir TEST_PROTOCOL.md).
    const mainU = fsU.readFileSync(pathU.join(rootU, 'js', 'main.js'), 'utf8');
    const chartsU = fsU.readFileSync(pathU.join(rootU, 'js', 'charts.js'), 'utf8');
    const indexU = fsU.readFileSync(pathU.join(rootU, 'index.html'), 'utf8');
    assert.ok(/<option value="sunburst" data-i18n="tileForm\.type\.sunburst"/.test(indexU) && /id="tile-drill-label"/.test(indexU), 'type et libellé des anneaux dans le formulaire');
    assert.ok(/'sunburst', 'funnel'/.test(mainU) && /'type-sunburst':/.test(mainU), 'carte de type et icône');
    assert.ok(/function supportsLevels\(type\) \{ return supportsDrillDown\(type\) \|\| type === 'sunburst'; \}/.test(mainU), 'la liste d\'anneaux est celle du drill-down, mais sans drill-down');
    assert.ok(/isSunburst && aggFn !== 'sum' && aggFn !== 'count'\) fail\('tile-agg', 'tileForm\.error\.sunburstAdditive'\)/.test(mainU) && /isSunburst && drillDimensions\.length > GristBI\.data\.SUNBURST_MAX_LEVELS - 1\) fail\(/.test(mainU), 'readTileForm refuse une moyenne et plus de 4 anneaux');
    assert.ok(/tileTypeSelect\.value === 'sunburst' \? GristBI\.data\.SUNBURST_MAX_LEVELS - 1/.test(mainU) && /drillCrossFilterField\.hidden = noDrill \|\| tileTypeSelect\.value === 'sunburst'/.test(mainU), '« + Niveau » plafonné, case du filtre croisé masquée (un clic filtre toujours)');
    assert.ok(/if \(tile\.type === 'sunburst'\) \{\s*\n\s*bumpSeq\(tile\.id\);\s*\n\s*instance\.hideLoading\(\);\s*\n\s*renderSunburst\(/.test(chartsU), 'aiguillé depuis renderChart');
    assert.ok(/!levels\.length \|\| tile\.type === 'sunburst'/.test(chartsU), 'pas de « cliquer pour détailler » : un soleil filtre');
    const rs = chartsU.slice(chartsU.indexOf('function renderSunburst'), chartsU.indexOf('async function renderMeasureChart'));
    assert.ok(/nodeClick: false/.test(rs) && /focus: 'none'/.test(rs), 'un clic ne zoome pas, le survol n\'estompe rien (on le prendrait pour un filtre)');
    assert.ok(/escapeHtml\(v\)/.test(rs) && !/innerHTML/.test(rs), 'les noms de parts sont échappés dans l\'infobulle, jamais d\'innerHTML');
    assert.ok(/selected \? 1 : 0\.3/.test(rs) && /sunburstNodeSelected\(filters, tree\.levels, n\.path\)/.test(rs) && /heatTextColor\(selected \? fill : mix\(fill, 0\.7\)\)/.test(rs), 'parts non retenues estompées par les filtres de leurs anneaux');
    assert.ok(/inst && inst\.__sunburstLevels/.test(chartsU) && /sunburstFilterToggles\(liveState\.activeFilters, columns, path, currentTile\.id\)\.forEach\(\(c\) => GristBI\.store\.toggleFilter\(c\.column, c\.value, currentTile\.id\)\)/.test(chartsU), 'un clic lit l\'état vivant et pose les filtres de chaque anneau, un par un');
    assert.ok(/chartTheme\(\)\.muted/.test(rs) && !/Intl\.NumberFormat|toFixed/.test(chartsU), 'message vide thémé, aucun format de nombre en dur dans charts.js');
    console.log('OK soleil — arbre, plafonds, tri, filtres de chaque anneau, store, export, défauts, conseils, i18n, câblage');
  }

  // Export Excel avec ExcelJS 4.4.0 (consigne GFS 017, 18/11/2026) : le VRAI paquet vendorisé, exécuté sous Node
  // (js/export.js se charge sous Node : mise en forme des cellules et construction du classeur, sans DOM). Ce que ces
  // essais ne voient pas : le chargement paresseux dans un navigateur et le déclenchement du téléchargement.
  {
    const nodeFs = require('fs');
    const nodePath = require('path');
    const nodeCrypto = require('crypto');
    const repoRoot = nodePath.join(__dirname, '..');
    const exportJs = require('../js/export.js');
    const vendored = nodePath.join(repoRoot, 'js', 'vendor', 'exceljs', 'exceljs.min.js');

    // Le fichier est CELUI de la liste de GFS (même empreinte SHA-384 que son catalogue, 4.4.0) ; SheetJS a disparu.
    const sri = 'sha384-' + nodeCrypto.createHash('sha384').update(nodeFs.readFileSync(vendored)).digest('base64');
    assert.strictEqual(sri, 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz');
    assert.ok(nodeFs.existsSync(nodePath.join(repoRoot, 'js', 'vendor', 'exceljs', 'LICENSE')), 'licence à côté du fichier');
    assert.ok(!nodeFs.existsSync(nodePath.join(repoRoot, 'js', 'vendor', 'xlsx')), 'SheetJS retiré du dépôt');
    const exportSrc = nodeFs.readFileSync(nodePath.join(repoRoot, 'js', 'export.js'), 'utf8');
    const indexSrcX = nodeFs.readFileSync(nodePath.join(repoRoot, 'index.html'), 'utf8');
    assert.ok(!/XLSX\./.test(exportSrc) && !/<script[^>]+xlsx/i.test(indexSrcX), 'plus aucun appel à SheetJS');
    assert.ok(!/<script[^>]+exceljs/i.test(indexSrcX), 'ExcelJS n\'est jamais une balise statique (chargé au premier export, consigne 013)');

    // cellValue : nombre / texte / booléen / date / vide / erreur / grands entiers / objets
    const cv = exportJs.cellValue;
    assert.strictEqual(cv(12.5), 12.5);
    assert.strictEqual(cv(0), 0);
    assert.strictEqual(cv(''), '');
    assert.strictEqual(cv(null), null);
    assert.strictEqual(cv(undefined), null);
    assert.strictEqual(cv(true), true);
    assert.deepStrictEqual(cv(NaN), { error: '#NUM!' });
    assert.deepStrictEqual(cv(Infinity), { error: '#DIV/0!' });
    assert.deepStrictEqual(cv(-Infinity), { error: '#DIV/0!' });
    assert.strictEqual(cv(5n), 5);
    assert.strictEqual(cv(12345678901234567890n), '12345678901234567890'); // au-delà de 2^53 : du texte, pas un arrondi silencieux
    assert.strictEqual(cv(['L', 'a']), 'L,a'); // jamais l'objet : ExcelJS le lirait comme une formule/un lien
    assert.strictEqual(cv({ formula: 'SUM(A1)' }), '[object Object]');
    assert.strictEqual(cv(new Date('invalide')), null);
    assert.strictEqual(cv('x'.repeat(40000)).length, 32767);

    // Un classeur complet : écriture puis relecture par ExcelJS lui-même, et inspection du XML réel.
    const ExcelJSLib = require('../js/vendor/exceljs/exceljs.min.js');
    const zlibForXlsx = require('zlib');
    const sheetsForXlsx = [
      { name: 'Montant par Région', header: ['Région', 'Montant'], rows: [
        ['Nord', 1234.5], ['Sud', 0], ['=SUM(A1)', 5], ['+cmd|x', -1], ['@x', null], ['', undefined],
        ['nan', NaN], ['gros', 12345678901234567890n], ['petit', 5n], ['oui', true],
        ['date', new Date(Date.UTC(2026, 10, 18, 9, 30))], ['liste', ['L', 'a']], ['accentué é ç', 'a\nb'] ] },
      { name: 'Vide', header: ['A', 'B'], rows: [] }
    ];
    const wbX = exportJs.buildWorkbook(ExcelJSLib, sheetsForXlsx);
    assert.strictEqual(wbX.creator, 'Grist BI');
    const buf = Buffer.from(await wbX.xlsx.writeBuffer());
    assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', 'un classeur .xlsx est une archive zip');
    const back = new ExcelJSLib.Workbook();
    await back.xlsx.load(buf);
    assert.deepStrictEqual(back.worksheets.map((w) => w.name), ['Montant par Région', 'Vide']);
    const first = back.getWorksheet('Montant par Région');
    assert.strictEqual(first.rowCount, 14); // en-tête + 13 lignes
    assert.deepStrictEqual(first.getRow(1).values.slice(1), ['Région', 'Montant']);
    assert.strictEqual(first.getCell('B2').value, 1234.5);
    assert.strictEqual(first.getCell('B3').value, 0);
    assert.strictEqual(first.getCell('B3').type, ExcelJSLib.ValueType.Number);
    assert.strictEqual(first.getCell('A4').value, '=SUM(A1)');
    assert.strictEqual(first.getCell('A4').type, ExcelJSLib.ValueType.String, 'un texte qui commence par = reste du texte');
    assert.strictEqual(first.getCell('A5').value, '+cmd|x');
    assert.strictEqual(first.getCell('A6').value, '@x');
    assert.strictEqual(first.getCell('B6').value, null);
    assert.deepStrictEqual(first.getCell('B8').value, { error: '#NUM!' });
    assert.strictEqual(first.getCell('B9').value, '12345678901234567890');
    assert.strictEqual(first.getCell('B10').value, 5);
    assert.strictEqual(first.getCell('B11').value, true);
    assert.strictEqual(first.getCell('B12').value.toISOString(), '2026-11-18T09:30:00.000Z');
    assert.strictEqual(first.getCell('B13').value, 'L,a');
    assert.strictEqual(first.getCell('A14').value, 'accentué é ç');
    assert.strictEqual(back.getWorksheet('Vide').rowCount, 1); // une feuille vide garde son en-tête
    // XML réel : aucune formule dans aucune feuille, du texte en chaînes partagées, jamais « NaN » en clair.
    const xmlFiles = (() => {
      // Lecteur de zip minimal par le répertoire central (tailles exactes, même quand les entrées sont en flux).
      let eocd = buf.length - 22;
      while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
      assert.ok(eocd >= 0, 'fin d\'archive zip trouvée');
      const count = buf.readUInt16LE(eocd + 10);
      let o = buf.readUInt32LE(eocd + 16);
      const out = {};
      for (let i = 0; i < count; i++) {
        assert.strictEqual(buf.readUInt32LE(o), 0x02014b50);
        const method = buf.readUInt16LE(o + 10);
        const csize = buf.readUInt32LE(o + 20);
        const nlen = buf.readUInt16LE(o + 28);
        const xlen = buf.readUInt16LE(o + 30);
        const clen = buf.readUInt16LE(o + 32);
        const local = buf.readUInt32LE(o + 42);
        const name = buf.slice(o + 46, o + 46 + nlen).toString('utf8');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.slice(start, start + csize);
        if (!name.endsWith('/')) out[name] = (method === 8 ? zlibForXlsx.inflateRawSync(raw) : raw).toString('utf8');
        o += 46 + nlen + xlen + clen;
      }
      return out;
    })();
    const sheetXml = xmlFiles['xl/worksheets/sheet1.xml'];
    assert.ok(sheetXml, 'feuille 1 lisible dans le zip');
    assert.ok(!/<f[ >]/.test(sheetXml), 'aucune formule écrite, même pour un texte qui commence par = + - @');
    assert.ok(!/NaN|Infinity/.test(sheetXml), 'aucun nombre non fini écrit en clair');
    assert.ok(/t="e"><v>#NUM!<\/v>/.test(sheetXml), 'NaN = cellule d\'erreur');
    assert.ok(xmlFiles['xl/sharedStrings.xml'].includes('=SUM(A1)'), 'le texte est une chaîne partagée');

    // Les noms de feuille que fabrique sanitizeSheetName ne font JAMAIS lever ExcelJS (il est plus strict que
    // SheetJS : casse, apostrophes, « History »).
    const titles = ['Ventes', 'ventes', 'VENTES', "'Apostrophe'", "Fin d'", 'History', 'history', 'a'.repeat(40), 'a'.repeat(40),
      'Ligne: A/B [x]?*', '', '   ', "''", 'x'.repeat(30) + "'y", 'Page 1 - Montant par catégorie et par région en 2026'];
    const usedX = new Set();
    const names = titles.map((tt) => data.sanitizeSheetName(tt, usedX));
    assert.strictEqual(new Set(names.map((nm) => nm.toLowerCase())).size, names.length, 'noms uniques sans tenir compte de la casse');
    assert.ok(names.every((nm) => nm.length >= 1 && nm.length <= 31 && !/^'|'$/.test(nm) && !/[:\\/?*[\]]/.test(nm) && nm.toLowerCase() !== 'history'));
    assert.deepStrictEqual(names.slice(0, 3), ['Ventes', 'ventes (2)', 'VENTES (3)']);
    const wbNames = exportJs.buildWorkbook(ExcelJSLib, names.map((nm) => ({ name: nm, header: ['A'], rows: [[1]] })));
    assert.strictEqual(wbNames.worksheets.length, titles.length);

    // Bout en bout (hors DuckDB et hors DOM) : les feuilles d'un VRAI état, par la chaîne que js/export.js utilise.
    const stateX = {
      rows: [{ Region: 'Nord', Montant: 10 }, { Region: 'Sud', Montant: 20 }, { Region: 'Nord', Montant: 5 }],
      activeFilters: [], advancedFilters: [], drillIns: {},
      pages: [
        { id: 'p1', name: 'Ventes', tiles: [
          { id: 't1', type: 'bar', title: 'Par région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' },
          { id: 't2', type: 'kpi', measure: 'Montant', aggFn: 'sum' },
          { id: 't3', type: 'text', text: 'note' }
        ] },
        { id: 'p2', name: 'Autre', tiles: [{ id: 't4', type: 'pivot', dimension: 'Region', columnDimension: 'Region', measure: 'Montant', aggFn: 'sum' }] }
      ]
    };
    const sheetsReal = await data.buildWorkbookSheetsAsync(stateX, async () => { throw new Error('pas de mesure temporelle ici'); });
    const wbReal = exportJs.buildWorkbook(ExcelJSLib, sheetsReal);
    const backReal = new ExcelJSLib.Workbook();
    await backReal.xlsx.load(Buffer.from(await wbReal.xlsx.writeBuffer()));
    assert.deepStrictEqual(backReal.worksheets.map((w) => w.name), ['Ventes - Par région', 'Ventes - sum(Montant)', 'Autre - sum(Montant)']);
    assert.deepStrictEqual(backReal.getWorksheet('Ventes - Par région').getRow(2).values.slice(1), ['Nord', 15]);
    assert.deepStrictEqual(backReal.getWorksheet('Ventes - Par région').getRow(3).values.slice(1), ['Sud', 20]);
    assert.deepStrictEqual(backReal.getWorksheet('Ventes - sum(Montant)').getRow(2).values.slice(1), ['sum(Montant)', 35]);
    console.log('OK export Excel ExcelJS 4.4.0 — empreinte de GFS, SheetJS retiré, cellules (types, NaN, grands entiers, objets), texte = formule jamais, noms de feuille, relecture complète');
  }

  // Exports PDF/PPTX/Excel provisoirement désactivés (18/11/2026, demande d'Antoine) : boutons GRISÉS (jamais retirés) avec la
  // mention « bientôt disponible » en fr ET en anglais ; le drapeau de js/main.js les garde fermés quand une table se connecte
  // (setTableDependentControlsEnabled ré-activait tout) et coupe les trois écouteurs. À remplacer quand les exports reviennent.
  {
    const fsE = require('fs');
    const pathE = require('path');
    const indexE = fsE.readFileSync(pathE.join(__dirname, '..', 'index.html'), 'utf8');
    const mainE = fsE.readFileSync(pathE.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    for (const id of ['export-excel', 'export-pdf', 'export-pptx']) {
      const m = indexE.match(new RegExp('<button id="' + id + '"[^>]*>'));
      assert.ok(m, id + ' : bouton présent (grisé, jamais retiré)');
      assert.ok(/\sdisabled\b/.test(m[0]) && /aria-disabled="true"/.test(m[0]), id + ' : désactivé dans index.html');
    }
    assert.strictEqual((indexE.match(/data-i18n="export\.soon"/g) || []).length, 3, 'la mention « bientôt disponible » sur les trois boutons');
    assert.strictEqual(i18n.STRINGS['export.soon'].fr, 'bientôt disponible');
    assert.strictEqual(i18n.STRINGS['export.soon'].en, 'coming soon');
    assert.ok(/const EXPORTS_AVAILABLE = false;/.test(mainE), 'drapeau EXPORTS_AVAILABLE à false');
    assert.ok(/if \(!EXPORTS_AVAILABLE\) for \(const el of \[exportExcelBtn, exportPdfBtn, exportPptxBtn\]\) el\.disabled = true;/.test(mainE), 'la connexion d\'une table ne ré-active pas les exports');
    assert.strictEqual((mainE.match(/if \(!EXPORTS_AVAILABLE\) return;/g) || []).length, 3, 'les trois écouteurs de clic sont coupés');
    console.log('OK exports désactivés — trois boutons grisés avec « bientôt disponible » fr/en, jamais ré-activés par la connexion d\'une table');
  }
})().then(() => {
  console.log('\nTous les tests data.js/state.js/demo-data.js/combobox.js/duckdb-engine.js/i18n.js sont passés.');
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
