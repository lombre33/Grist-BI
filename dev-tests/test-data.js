/*
 * Tests unitaires (Node, sans navigateur ni Grist) des fonctions pures de js/data.js, js/state.js
 * et js/demo-data.js. Lancer avec: node dev-tests/test-data.js
 */
const assert = require('assert');
const data = require('../js/data.js');
const state = require('../js/state.js');
const demoData = require('../js/demo-data.js');

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

// applyFilter
{
  const filtered = data.applyFilter(rows, { column: 'Region', value: 'Sud' });
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(data.applyFilter(rows, null).length, 4);
  console.log('OK applyFilter');
}

// aggregateSingle
{
  assert.strictEqual(data.aggregateSingle(rows, 'Montant', 'sum'), 250);
  assert.strictEqual(data.aggregateSingle(rows, 'Montant', 'max'), 100);
  console.log('OK aggregateSingle');
}

// tableToRows (format colonnaire -> lignes, utilisé pour la table de config)
{
  const table = { id: [1, 2], TableId: ['Ventes', 'Autre'], ConfigJSON: ['[]', '[{"a":1}]'] };
  const r = data.tableToRows(table);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].TableId, 'Autre');
  console.log('OK tableToRows');
}

// state: toggle de filtre croisé
{
  const store = state.createStore();
  const seen = [];
  store.subscribe((s) => seen.push(s.activeFilter));
  store.setRows(rows);
  store.toggleFilter('Region', 'Nord', 'tileA');
  assert.deepStrictEqual(store.getState().activeFilter, { column: 'Region', value: 'Nord', sourceTileId: 'tileA' });
  store.toggleFilter('Region', 'Nord', 'tileA'); // même clic -> retire le filtre
  assert.strictEqual(store.getState().activeFilter, null);
  store.toggleFilter('Region', 'Nord', 'tileA');
  store.toggleFilter('Region', 'Sud', 'tileA'); // clic sur un autre segment -> remplace le filtre
  assert.deepStrictEqual(store.getState().activeFilter, { column: 'Region', value: 'Sud', sourceTileId: 'tileA' });
  assert.strictEqual(seen.length, 5); // setRows + 4 toggles
  console.log('OK state.toggleFilter (activation / toggle-off / remplacement)');
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

// demo-data: buildSampleRows -> des valeurs cohérentes (Montant/Quantite positifs, colonnes complètes)
{
  const sample = demoData.buildSampleRows();
  const expectedCount = demoData.REGIONS.length * demoData.PRODUITS.length
    * demoData.ANNEES.length * demoData.MOIS.length;
  assert.strictEqual(sample.length, expectedCount);
  const colIds = demoData.COLUMNS.map((c) => c.id);
  for (const row of sample) {
    for (const col of colIds) assert.ok(col in row, `colonne manquante: ${col}`);
    assert.ok(row.Quantite > 0 && Number.isFinite(row.Quantite));
    assert.ok(row.Montant > 0 && Number.isFinite(row.Montant));
    assert.ok(demoData.ANNEES.includes(row.Annee));
  }
  // La croissance 2026 > 2025 (voir CROISSANCE_ANNUELLE) doit rester visible malgré l'aléatoire :
  // vérifié sur la moyenne des Quantite par année plutôt que ligne à ligne.
  const dataMod = require('../js/data.js');
  const parAnnee = dataMod.groupByAggregate(sample, 'Annee', 'Quantite', 'avg');
  const q2025 = parAnnee.find((d) => d.dimension === 2025).value;
  const q2026 = parAnnee.find((d) => d.dimension === 2026).value;
  assert.ok(q2026 > q2025, `croissance attendue 2026 (${q2026}) > 2025 (${q2025})`);
  console.log(`OK demoData.buildSampleRows (${sample.length} lignes, croissance 2025->2026 cohérente)`);
}

// demo-data: defaultTiles -> compatibles avec le store, et référencent des colonnes qui existent
// réellement dans buildSampleRows() (regression guard si une colonne est renommée d'un côté sans
// l'autre).
{
  const sample = demoData.buildSampleRows();
  const availableCols = new Set(Object.keys(sample[0]));
  const tiles = demoData.defaultTiles();
  assert.ok(tiles.length >= 3);
  for (const tile of tiles) {
    assert.ok(tile.id && tile.type && tile.measure && tile.aggFn);
    assert.ok(availableCols.has(tile.measure), `mesure inconnue: ${tile.measure}`);
    if (tile.type !== 'kpi') assert.ok(availableCols.has(tile.dimension), `dimension inconnue: ${tile.dimension}`);
  }
  const store = state.createStore();
  store.setTiles(tiles);
  assert.strictEqual(store.getState().tiles.length, tiles.length);
  console.log('OK demoData.defaultTiles (cohérentes avec buildSampleRows + state.js)');
}

console.log('\nTous les tests data.js/state.js/demo-data.js sont passés.');
