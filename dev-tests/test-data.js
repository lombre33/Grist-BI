/*
 * Tests unitaires (Node, sans navigateur ni Grist) des fonctions pures de js/data.js, js/state.js,
 * js/demo-data.js et js/combobox.js. Lancer avec: node dev-tests/test-data.js
 */
const assert = require('assert');
const data = require('../js/data.js');
const state = require('../js/state.js');
const demoData = require('../js/demo-data.js');
const combobox = require('../js/combobox.js');

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

  // Tuile filtrée jusqu'à zéro ligne -> en-têtes présents, aucune ligne (pas planté, pas d'en-tête absent)
  const emptyState = Object.assign({}, baseState, { activeFilters: [{ column: 'Region', value: 'Ouest', sourceTileId: 'autre' }] });
  const emptySheet = data.tileExportSheet(barTile, emptyState);
  assert.deepStrictEqual(emptySheet.header, ['Region', 'Montant']);
  assert.deepStrictEqual(emptySheet.rows, []);
  console.log('OK tileExportSheet (bar/kpi/scatter + tuile vide après filtrage)');
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

console.log('\nTous les tests data.js/state.js/demo-data.js/combobox.js sont passés.');
