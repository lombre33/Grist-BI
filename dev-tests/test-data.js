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

// tableToRows (format colonnaire -> lignes, utilisé pour la table de config)
{
  const table = { id: [1, 2], TableId: ['Ventes', 'Autre'], ConfigJSON: ['[]', '[{"a":1}]'] };
  const r = data.tableToRows(table);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].TableId, 'Autre');
  console.log('OK tableToRows');
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

// demo-data: buildSampleRows -> des valeurs cohérentes (Montant/Quantite positifs, colonnes complètes)
{
  const sample = demoData.buildSampleRows();
  const expectedCount = demoData.REGIONS.length * demoData.PRODUITS.length
    * demoData.ANNEES.length * demoData.MOIS.length * demoData.SEMAINES.length;
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
    for (const lvl of data.tileDrillLevels(tile)) {
      assert.ok(availableCols.has(lvl), `niveau de drill-down inconnu: ${lvl}`);
    }
    if (tile.trendDimension) assert.ok(availableCols.has(tile.trendDimension), `trendDimension inconnue: ${tile.trendDimension}`);
  }
  assert.ok(tiles.some((t) => data.tileDrillLevels(t).length >= 2), 'au moins une tuile de démo devrait démontrer le drill-down à 2 niveaux');
  assert.ok(tiles.some((t) => t.trendDimension), 'au moins une tuile de démo devrait démontrer la tendance KPI');
  assert.ok(tiles.some((t) => t.drillCrossFilter), 'au moins une tuile de démo devrait démontrer le cross-filtering pendant le drill-down');
  const store = state.createStore();
  store.setPages([{ id: 'p1', name: 'Page 1', tiles }], 'p1');
  assert.strictEqual(store.getState().tiles.length, tiles.length);
  console.log('OK demoData.defaultTiles (cohérentes avec buildSampleRows + state.js)');
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

console.log('\nTous les tests data.js/state.js/demo-data.js sont passés.');
