/*
 * Une tuile, sa table (chantier « colonnes de toutes les tables », lot 2, 26/11/2026) : `tile.table` (une autre table que celle de travail), les
 * lignes lues à la demande (`store.tableRows`), les filtres propres à chaque table, la vue qu'une tuile a de l'état (`stateForTile`), le champ « Table »
 * du formulaire et le câblage de `js/main-session.js`, `js/main-render.js`, `js/main-form.js`.
 * Lancer : node dev-tests/test-tile-tables.js
 * Ce qui ne se joue QUE dans un navigateur (le champ « Table » au clavier, le badge, une table illisible, un cadre isolé) est dans
 * `dev-tests/test-browser.js` (pas 11).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const i18n = require('../js/i18n.js');
const { read, readMain, readCharts } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); };
const same = (a, b, msg) => { checks += 1; assert.strictEqual(a, b, msg); };

// Charge un module du dépôt (UMD) avec un texte éventuellement modifié : `require` y reste relatif au fichier (data.js lit data-tiles.js).
function loadModule(file, transform) {
  const full = path.join(__dirname, '..', 'js', file);
  const source = transform ? transform(fs.readFileSync(full, 'utf8')) : fs.readFileSync(full, 'utf8');
  const m = new Module(full, null);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(source, full);
  return m.exports;
}

const ventes = [{ id: 1, Region: 'Nord', Montant: 10 }, { id: 2, Region: 'Sud', Montant: 20 }, { id: 3, Region: 'Nord', Montant: 30 }];
const clients = [{ id: 1, Region: 'Nord', Ville: 'Lille' }, { id: 2, Region: 'Sud', Ville: 'Nice' }, { id: 3, Region: 'Est', Ville: 'Metz' }, { id: 4, Region: 'Sud', Ville: 'Pau' }];
const A = { id: 'a', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
const A2 = { id: 'a2', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
const B = { id: 'b', type: 'bar', dimension: 'Region', measure: 'id', aggFn: 'count', table: 'Clients' };
const C = { id: 'c', type: 'bar', dimension: 'Ville', measure: 'id', aggFn: 'count', table: 'Clients' };
const page = (tiles) => [{ id: 'p1', name: 'P', tiles }];
const count = (rows) => rows.length;

function build(S) {
  const store = S.createStore();
  store.setWorkingTable('Ventes');
  store.setRows(ventes);
  return store;
}

// Les vérifications, rejouées ensuite sur des versions fautives des deux modules.
function tableChecks(S, D) {
  // ---- Un rapport d'avant ce lot : rien ne change, la même référence --------------------------------------------------------------------
  {
    const store = build(S);
    const pages = page([A, A2]);
    store.setPages(pages, 'p1');
    const st = store.getState();
    same(st.pages, pages, 'un rapport sans `table` garde la MÊME référence de pages');
    same(D.stateForTile(A, st), st, 'sans table ni filtre d\'une autre table, la vue d\'une tuile est l\'état lui-même');
    same(count(D.rowsForTile(A, st)), 3, 'les lignes de la table de travail');
    same(D.tileTable(A, st), '', 'pas de table');
    same(D.tileTable(Object.assign({}, A, { table: 'Ventes' }), st), '', 'la table de travail nommée n\'est pas « une autre table »');
    eq(['x'.repeat(161), 'a\nb', '', 5, null, {}, []].map((v) => D.tileTable(Object.assign({}, A, { table: v }), st)), ['', '', '', '', '', '', ''], 'un nom mal formé n\'est pas une table');
    same(D.tileTable(Object.assign({}, A, { table: 'Clients' }), st), 'Clients', 'une autre table');
  }

  // ---- Les lignes d'une autre table : en cours, lues, illisibles --------------------------------------------------------------------------
  {
    const store = build(S);
    store.setPages(page([A, B]), 'p1');
    let st = store.getState();
    same(D.tableRowsStatus(st, ''), 'ready', 'la table de travail est toujours prête');
    same(D.tableRowsStatus(st, 'Clients'), 'loading', 'pas encore lue');
    eq(D.rowsForTile(B, st), [], 'une table pas encore lue : zéro ligne (jamais celles de la table de travail)');
    store.setTableRows('Clients', clients);
    st = store.getState();
    same(D.tableRowsStatus(st, 'Clients'), 'ready', 'lue');
    same(count(D.rowsForTile(B, st)), 4, 'les lignes de SA table');
    same(count(D.rowsForTile(A, st)), 3, 'l\'autre tuile garde les siennes');
    store.setTableRows('Clients', null);
    st = store.getState();
    same(D.tableRowsStatus(st, 'Clients'), 'failed', 'illisible');
    eq(D.rowsForTile(B, st), [], 'une table illisible : zéro ligne');
    // Un tableau neuf à chaque écriture, jamais modifié sur place ; sans prototype (un nom de table est une clé comme une autre).
    const before = store.getState().tableRows;
    store.setTableRows('Autre', []);
    ok(store.getState().tableRows !== before, 'un objet NEUF à chaque écriture');
    same(Object.getPrototypeOf(store.getState().tableRows), null, 'sans prototype');
    store.setTableRows('__proto__', [{ polluted: 1 }]);
    same(({}).polluted, undefined, 'un nom forgé ne pollue rien');
    same(({}).id, undefined, 'ni ne touche Object.prototype');
    store.setTableRows('', [{ id: 9 }]);
    store.setTableRows('x\ny', [{ id: 9 }]);
    ok(!Object.prototype.hasOwnProperty.call(store.getState().tableRows, '') && !Object.prototype.hasOwnProperty.call(store.getState().tableRows, 'x\ny'), 'un nom mal formé n\'est pas une table');
    // Changer de table de travail oublie les autres tables (elles appartenaient à l'autre rapport) ; rien si c'est la même.
    store.setTableRows('Clients', clients);
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.setWorkingTable('Ventes');
    same(notified, 0, 'la même table de travail ne notifie rien');
    ok(Object.prototype.hasOwnProperty.call(store.getState().tableRows, 'Clients'), 'ni n\'oublie les lignes');
    store.setWorkingTable('Autre');
    same(notified, 1, 'une autre table de travail notifie une fois');
    eq(Object.keys(store.getState().tableRows), [], 'les lignes des autres tables sont oubliées');
    store.setTableRows('Clients', clients);
    store.clearTableRows();
    eq(Object.keys(store.getState().tableRows), [], 'clearTableRows oublie tout');
    const n = notified;
    store.clearTableRows();
    same(notified, n, 'rien à oublier : rien n\'est notifié');
  }

  // ---- Les filtres croisés : chacun reste dans sa table ---------------------------------------------------------------------------------
  {
    const store = build(S);
    store.setPages(page([A, A2, B, C]), 'p1');
    store.setTableRows('Clients', clients);
    store.toggleFilter('Region', 'Nord', 'a'); // un clic sur la tuile des ventes
    let st = store.getState();
    eq(st.activeFilters, [{ column: 'Region', value: 'Nord', sourceTileId: 'a' }], 'un filtre de la table de travail ne porte pas de `table` (identique à avant)');
    same(count(D.rowsForTile(A2, st)), 2, 'l\'autre tuile des ventes est filtrée');
    same(count(D.rowsForTile(A, st)), 3, 'la tuile qui pose le filtre reste entière');
    same(count(D.rowsForTile(B, st)), 4, 'une tuile d\'une AUTRE table n\'est pas filtrée par une colonne de même nom');
    store.toggleFilter('Region', 'Sud', 'b'); // même nom de colonne, autre table
    st = store.getState();
    same(st.activeFilters.length, 2, 'deux filtres côte à côte : même colonne, deux tables');
    eq(st.activeFilters[1], { column: 'Region', value: 'Sud', sourceTileId: 'b', table: 'Clients' }, 'le filtre d\'une autre table dit sa table');
    same(count(D.rowsForTile(C, st)), 2, 'l\'autre tuile des clients est filtrée par SON filtre (Sud : Nice, Pau)');
    same(count(D.rowsForTile(B, st)), 4, 'la tuile qui pose son filtre reste entière');
    same(count(D.rowsForTile(A2, st)), 2, 'le filtre des clients ne touche pas les ventes');
    store.toggleFilter('Region', 'Sud', 'b');
    st = store.getState();
    eq(st.activeFilters.map((f) => f.sourceTileId), ['a'], 'le même clic retire SON filtre, pas celui de l\'autre table');
    store.toggleFilter('Region', 'Sud', 'b');
    store.toggleFilter('Region', 'Est', 'c');
    st = store.getState();
    eq(st.activeFilters.filter((f) => f.table === 'Clients').map((f) => f.value), ['Est'], 'un autre clic sur la même colonne de la même table remplace');
    same(st.activeFilters.filter((f) => !f.table).length, 1, 'sans toucher à celui des ventes');
    store.clearFilter('Region', 'Clients');
    eq(store.getState().activeFilters.map((f) => f.sourceTileId), ['a'], 'clearFilter(colonne, table) ne retire que celui de la table');
    store.toggleFilter('Region', 'Sud', 'b');
    store.clearFilter('Region');
    eq(store.getState().activeFilters.map((f) => f.sourceTileId), ['b'], 'clearFilter(colonne) sans table retire celui de la table de travail');
    store.clearFilter();
    eq(store.getState().activeFilters, [], 'sans argument : tout');
    // Plage (histogramme) : même règle.
    store.toggleRangeFilter('id', { min: 1, max: 3 }, 'b');
    eq(store.getState().activeFilters.map((f) => f.table), ['Clients'], 'un filtre de plage prend aussi la table de sa tuile');
    store.toggleRangeFilter('id', { min: 1, max: 3 }, 'a');
    same(store.getState().activeFilters.length, 2, 'une plage de la table de travail ne remplace pas celle des clients');
  }

  // ---- Les filtres avancés : un par colonne ET par table ------------------------------------------------------------------------------------
  {
    const store = build(S);
    store.setPages(page([A, C]), 'p1');
    store.setTableRows('Clients', clients);
    store.setAdvancedFilter('id', { type: 'range', min: 2 });
    store.setAdvancedFilter('id', { type: 'range', min: 4, table: 'Clients' });
    let st = store.getState();
    same(st.advancedFilters.length, 2, 'la même colonne dans deux tables : deux filtres');
    eq(st.advancedFilters.map((f) => f.table), [undefined, 'Clients'], 'seul celui d\'une autre table dit sa table');
    same(count(D.rowsForTile(A, st)), 2, 'les ventes : id >= 2');
    same(count(D.rowsForTile(C, st)), 1, 'les clients : id >= 4');
    store.setAdvancedFilter('id', { type: 'range', min: 3, table: 'Clients' });
    same(store.getState().advancedFilters.length, 2, 'un nouveau réglage remplace celui de SA table');
    store.setAdvancedFilter('id', { type: 'range', min: 3, table: 'Ventes' });
    same(store.getState().advancedFilters.filter((f) => f.table).length, 1, 'la table de travail nommée est la table de travail (jamais deux filtres)');
    store.clearAdvancedFilter('id', 'Clients');
    eq(store.getState().advancedFilters.map((f) => f.table), [undefined], 'clearAdvancedFilter(colonne, table) ne retire que celui de la table');
    store.clearAdvancedFilter();
    eq(store.getState().advancedFilters, [], 'sans argument : tout');
    store.setAdvancedFilter('id', { type: 'range', min: 2, table: 'x\ny' });
    eq(store.getState().advancedFilters.map((f) => f.table), [undefined], 'un nom de table mal formé n\'est pas gardé (le filtre vaut pour la table de travail)');
  }

  // ---- Le drill-down d'une tuile d'une autre table ------------------------------------------------------------------------------------------
  {
    const store = build(S);
    const drilled = Object.assign({}, C, { id: 'd', dimension: 'Region', drillDimensions: ['Ville'], drillCrossFilter: true });
    store.setPages(page([A2, drilled]), 'p1');
    store.setTableRows('Clients', clients);
    store.drillInto('d', 'Region', 'Sud');
    const st = store.getState();
    eq(st.activeFilters, [{ column: 'Region', value: 'Sud', sourceTileId: 'd', fromDrill: true, table: 'Clients' }], 'le filtre de drill-down croisé dit sa table');
    same(count(D.rowsForTile(drilled, st)), 2, 'le chemin de drill-down filtre les lignes de SA table');
    same(count(D.rowsForTile(A2, st)), 3, 'et ne touche pas les ventes');
  }

  // ---- Changer la table d'une tuile lève ce qui ne vaut plus ---------------------------------------------------------------------------------
  {
    const store = build(S);
    const drilled = Object.assign({}, C, { id: 'd', dimension: 'Region', drillDimensions: ['Ville'], drillCrossFilter: true });
    store.setPages(page([A, drilled]), 'p1');
    store.setTableRows('Clients', clients);
    store.drillInto('d', 'Region', 'Sud');
    store.toggleFilter('Region', 'Nord', 'a');
    store.toggleFilter('Ville', 'Pau', 'd'); // un clic de la tuile, en plus de son drill-down croisé
    store.updateTile('d', { title: 'autre titre' });
    same(store.getState().activeFilters.length, 3, 'une modification qui ne change pas la table ne lève rien');
    store.updateTile('d', { table: undefined });
    let st = store.getState();
    same(st.drillIns.d, undefined, 'le chemin de drill-down est levé');
    eq(st.activeFilters.map((f) => f.sourceTileId), ['a'], 'les filtres posés par cette tuile sont levés, pas ceux des autres');
    store.updateTile('d', { table: 'Ventes' });
    st = store.getState();
    same(D.tileTable(st.tiles.find((t) => t.id === 'd'), st), '', 'nommer la table de travail revient à ne pas en nommer');
    store.drillInto('d', 'Region', 'Nord');
    store.updateTile('d', { table: 'Clients' });
    same(store.getState().drillIns.d, undefined, 'et le chemin tombe aussi quand on passe à une autre table');
    store.removeTile('d');
    eq(store.getState().activeFilters.map((f) => f.sourceTileId), ['a'], 'une tuile retirée lève son filtre');
  }

  // ---- Un rapport relu : `table` mal formé est écarté, le reste intact ----------------------------------------------------------------------
  {
    const store = build(S);
    const hostile = [
      Object.assign({}, B, { id: 't1', table: 5 }), Object.assign({}, B, { id: 't2', table: 'a\nb' }), Object.assign({}, B, { id: 't3', table: 'x'.repeat(161) }),
      Object.assign({}, B, { id: 't4', table: {} }), Object.assign({}, B, { id: 't5', table: '' }), Object.assign({}, B, { id: 't6' }), Object.assign({}, B, { id: 't7', table: 'Clients' })
    ];
    store.setPages(page(hostile), 'p1');
    const tiles = store.getState().tiles;
    eq(tiles.map((t) => ('table' in t ? t.table : '(aucune)')), ['(aucune)', '(aucune)', '(aucune)', '(aucune)', '(aucune)', 'Clients', 'Clients'], 'un `table` mal formé est retiré, un bon est gardé');
    // `table: undefined` (ce que le formulaire écrit pour la table de travail) ne fait pas de nouvelle référence à chaque chargement.
    const withUndefined = page([Object.assign({}, A, { table: undefined })]);
    store.setPages(withUndefined, 'p1');
    same(store.getState().pages, withUndefined, '`table: undefined` est déjà bien formé : la même référence');
  }
}

// ---- 1. Les modules tels qu'ils sont ----------------------------------------------------------------------------------------------------
const stateSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
tableChecks(loadModule('state.js'), loadModule('data.js'));
console.log(`OK tuile et table — le store et la vue d'une tuile (${checks} vérifications)`);

// ---- 2. Versions fautives : chacune doit être vue ---------------------------------------------------------------------------------------
const STATE_MUTANTS = [
  ['un filtre croisé retrouvé par sa seule colonne', 'const idx = activeFilters.findIndex((f) => sameFilterKey(f, column, table));\n      if (idx >= 0 && activeFilters[idx].value === value)', 'const idx = activeFilters.findIndex((f) => f.column === column);\n      if (idx >= 0 && activeFilters[idx].value === value)'],
  ['la table d\'une tuile source ignorée', "return tile ? tileTableKey(tile) : '';", "return '';"],
  ['la table jamais écrite dans un filtre', 'const withTable = (filter, table) => (table ? Object.assign(filter, { table }) : filter);', 'const withTable = (filter) => filter;'],
  ['une table qui garde les lignes de l\'autre rapport', '      workingTable = next;\n      tableRows = Object.create(null);', '      workingTable = next;'],
  ['les lignes d\'une table écrites sur place', 'tableRows = Object.assign(Object.create(null), tableRows);\n      tableRows[table] = Array.isArray(newRows) ? newRows : null;', 'tableRows[table] = Array.isArray(newRows) ? newRows : null;'],
  ['des lignes avec un prototype', 'tableRows = Object.assign(Object.create(null), tableRows);', 'tableRows = Object.assign({}, tableRows);'],
  ['une table illisible prise pour une table vide', 'tableRows[table] = Array.isArray(newRows) ? newRows : null;', 'tableRows[table] = Array.isArray(newRows) ? newRows : [];'],
  ['un nom de table mal formé accepté', "      if (!isTableName(table)) return;\n      tableRows =", '      tableRows ='],
  ['un `table` mal formé gardé', "const badTable = Object.prototype.hasOwnProperty.call(tile, 'table') && tile.table !== undefined && !isTableName(tile.table);", 'const badTable = false;'],
  ['`table: undefined` pris pour mal formé', "&& tile.table !== undefined && !isTableName(tile.table);", '&& !isTableName(tile.table);'],
  ['les filtres d\'une tuile qui change de table gardés', 'activeFilters = activeFilters.filter((f) => f.sourceTileId !== id);\n        }\n      }\n      syncDrillCrossFilters(id);', '}\n      }\n      syncDrillCrossFilters(id);'],
  ['le drill-down d\'une tuile qui change de table gardé', 'if (id in drillIns) { drillIns = Object.assign({}, drillIns); delete drillIns[id]; }\n          activeFilters', 'activeFilters'],
  ['clearFilter sans la table', 'activeFilters = column ? activeFilters.filter((f) => !sameFilterKey(f, column, key)) : [];', 'activeFilters = column ? activeFilters.filter((f) => f.column !== column) : [];'],
  ['setAdvancedFilter sans la table', 'const withoutThisColumn = advancedFilters.filter((f) => !sameFilterKey(f, column, table));', 'const withoutThisColumn = advancedFilters.filter((f) => f.column !== column);'],
  ['clearAdvancedFilter sans la table', 'advancedFilters = column ? advancedFilters.filter((f) => !sameFilterKey(f, column, key)) : [];', 'advancedFilters = column ? advancedFilters.filter((f) => f.column !== column) : [];'],
  ['la table de travail nommée prise pour une autre', "const table = isTableName(filter && filter.table) && filter.table !== workingTable ? filter.table : '';", "const table = isTableName(filter && filter.table) ? filter.table : '';"],
  ['un filtre de drill-down croisé sans sa table', "path.map((step) => withTable({ column: step.column, value: step.value, sourceTileId: tileId, fromDrill: true }, table))", "path.map((step) => ({ column: step.column, value: step.value, sourceTileId: tileId, fromDrill: true }))"],
  ['un filtre de plage sans sa table', "const filter = withTable({ column, type: 'range', min: range.min, max: range.max, sourceTileId }, table);", "const filter = { column, type: 'range', min: range.min, max: range.max, sourceTileId };"],
  ['clearTableRows qui notifie toujours', "if (!Object.keys(tableRows).length) return;\n      tableRows = Object.create(null);", "tableRows = Object.create(null);"],
  ['la même table de travail qui oublie tout', 'if (next === workingTable) return;', '']
];
const DATA_MUTANTS = [
  ['la vue d\'une tuile toujours l\'état entier', 'if (!table && !mixed) return state;', 'return state;'],
  ['les filtres d\'une autre table appliqués partout', 'activeFilters: filters.filter((f) => filterTable(f, state) === table),', 'activeFilters: filters,'],
  ['les filtres avancés d\'une autre table appliqués partout', 'advancedFilters: advanced.filter((f) => filterTable(f, state) === table),', 'advancedFilters: advanced,'],
  ['les lignes de la table de travail pour toute tuile', "const rows = table ? (tableRowsStatus(state, table) === 'ready' ? state.tableRows[table] : []) : state.rows;", 'const rows = state.rows;'],
  ['une table pas encore lue qui montre les lignes de travail', "const rows = table ? (tableRowsStatus(state, table) === 'ready' ? state.tableRows[table] : []) : state.rows;", 'const rows = table ? (state.tableRows[table] || state.rows) : state.rows;'],
  ['une table illisible prise pour « en cours »', "return rows === null ? 'failed' : 'loading';", "return 'loading';"],
  ['une table jamais prête', "if (Array.isArray(rows)) return 'ready';", ''],
  ['la table de travail nommée prise pour une autre', "return table !== ((state && state.workingTable) || '') ? table : '';\n  }\n\n  // La table qu'un filtre", "return table;\n  }\n\n  // La table qu'un filtre"],
  ['un nom de table avec un caractère de contrôle accepté', '&& v.length <= 160 && !/[\\u0000-\\u001f\\u007f]/.test(v);', '&& v.length <= 160;'],
  ['un nom de table trop long accepté', '&& v.length <= 160 &&', '&&'],
  ['le filtre d\'une autre table pris pour celui de travail', "const table = filter && isTableName(filter.table) ? filter.table : '';\n    return table !== ((state && state.workingTable) || '') ? table : '';\n  }\n\n  // Les lignes d'une table", "return '';\n  }\n\n  // Les lignes d'une table"]
];
let seen = 0;
STATE_MUTANTS.forEach(([label, from, to]) => {
  assert.ok(stateSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/state.js`);
  let caught = false;
  try { tableChecks(loadModule('state.js', (src) => src.replace(from, to)), loadModule('data.js')); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  seen += 1;
});
DATA_MUTANTS.forEach(([label, from, to]) => {
  assert.ok(dataSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/data.js`);
  let caught = false;
  try { tableChecks(loadModule('state.js'), loadModule('data.js', (src) => src.replace(from, to))); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  seen += 1;
});
console.log(`OK tuile et table — ${seen} versions fautives vues par les vérifications`);

// ---- 3. Câblage lu dans les sources ----------------------------------------------------------------------------------------------------
{
  const main = readMain();
  const session = read('js', 'main-session.js');
  const form = read('js', 'main-form.js');
  const fields = read('js', 'main-fields.js');
  const panel = read('js', 'main-panel.js');
  const render = read('js', 'main-render.js');
  const charts = readCharts();
  const index = read('index.html');
  const harness = read('dev-tests', 'harness.html');
  const css = read('css', 'style.css');

  // Lecture à la demande, sans jamais rien lire qui ne soit une table du document.
  ok(/const available = await GristBI\.api\.listAvailableTables\(\);\s*if \(available\.indexOf\(table\) === -1\) throw/.test(session), 'loadTileTable ne lit qu\'une table que listAvailableTables rend (jamais `_grist_*`, une table interne ou un nom forgé)');
  ok(/if \(store\.getState\(\)\.workingTable !== epoch\) return;/.test(session), 'une réponse qui arrive après un changement de table de travail n\'écrit rien');
  ok(/rows = null;[\s\S]{0,200}showError\(t\('tileTable\.failed', \{ table \}\)\)/.test(session) || /if \(rows === null\) showError\(t\('tileTable\.failed'/.test(session), 'une table illisible : le message, une fois, et `null` dans le store');
  ok(/if \(!S\.dashboardReady \|\| !state\.workingTable\) return;/.test(session), 'rien n\'est lu pendant le chargement d\'un rapport (les tuiles de l\'ancien ne lisent rien)');
  ok((session.match(/tileTablesAsked\.clear\(\)/g) || []).length >= 2, 'les demandes sont oubliées à un changement de table et à un rechargement des données');
  ok(/store\.setWorkingTable\(tableId\)/.test(session) && /S\.formTable = '';/.test(session), 'la table de travail est posée dans le store et le formulaire repart d\'elle');
  ok(/store\.clearTableRows\(\);\s*ensureTileTables\(store\.getState\(\)\);/.test(session), 'un rechargement des données relit les autres tables');
  ok(/ensureTileTables\(store\.getState\(\)\);/.test(session) && /ensureTileTables\(state\);/.test(render), 'les tables des tuiles sont demandées à l\'affichage et une fois le rapport prêt');
  ok(/function ensureTableRows\(table\)[\s\S]{0,300}tileTablesAsked\.has\(table\)/.test(session), 'une seule lecture par table, quel que soit le nombre de demandeurs (tuiles et formulaire)');
  ok(/await ensureAllTileTables\(\);/.test(render) && (render.match(/await ensureAllTileTables\(\)/g) || []).length === 2, 'les exports attendent les tables de TOUTES les tuiles');

  // Rendu : la vue d'une tuile avant tout calcul.
  ok(/state = GristBI\.data\.stateForTile\(tile, state\);/.test(charts), 'drawTile lit l\'état tel que le voit la tuile');
  ok(/GristBI\.data\.stateForTile\(currentTile, liveState\)\.activeFilters/.test(charts) && /GristBI\.data\.stateForTile\(tile, GristBI\.store\.getState\(\)\)\.activeFilters/.test(charts), 'les clics (soleil, cases) lisent les filtres de la table de la tuile');
  ok(/GristBI\.data\.stateForTile\(tile, state\)\.rows/.test(charts), 'la grille de l\'histogramme vient des lignes de SA table');

  // Badge et pastilles.
  ok(/<span class="tile-table" hidden><\/span>/.test(render) && /\.tile-table\[hidden\] \{ display: none; \}/.test(css), 'le badge de table, masqué par une règle explicite (piège n°10)');
  ok(/'⚠ '/.test(render) && /dataset\.state/.test(render), 'une table illisible : le badge le dit (⚠ et état)');
  ok(/store\.clearFilter\(column, table \|\| undefined\)|clearFilter\(/.test(render) && /chipTablePrefix/.test(render), 'les pastilles disent la table et retirent le filtre de CETTE table');

  // Formulaire.
  ok(/id="tile-table"/.test(index) && /id="tile-table"/.test(harness) && /id="tile-table-field" hidden/.test(index), 'le champ « Table » est dans index.html et le harnais, masqué au départ');
  ok(/tileData\.table = \(!isText && S\.formTable\) \? S\.formTable : undefined;/.test(form), 'readTileForm n\'écrit `table` que pour une autre table (jamais sur une note)');
  ok(/tableRowsStatus\(store\.getState\(\), S\.formTable\) !== 'ready'\) fail\('tile-table', 'tileForm\.error\.tableUnreadable'/.test(form), 'une table pas lue ou illisible refuse l\'envoi');
  ok(/const table = GristBI\.data\.tileTable\(tile, store\.getState\(\)\);\s*S\.formTable = table;/.test(form), 'modifier une tuile reprend sa table');
  ok(/function formRows\(\)/.test(fields) && /if \(!S\.formTable\) return state\.rows;/.test(fields) && /function clearFormColumns\(\)/.test(fields), 'le formulaire lit les lignes de sa table et vide ses colonnes quand elle change');
  ok(/columnOptions\(rows, undefined, plainOnly\)/.test(fields) && /if \(plainOnly \|\| !graph \|\| !rows\.length\) return plain;/.test(fields), 'une autre table n\'a que ses colonnes (les jointures sont celles de la table de travail)');
  ok(/refreshFormColumns\(S\.formTable \? formRows\(\) : rows\)/.test(fields), 'un changement de table de travail ne remplit pas le formulaire d\'une tuile d\'une autre table avec les mauvaises colonnes');
  ok(/GristBI\.advice\.adviceForTile\(tileData, formRows\(\)\)/.test(panel) && /const rows = formRows\(\);\s*const typeDefaults/.test(panel), 'le conseil et les valeurs par défaut regardent la table du formulaire');
  ok(/if \(S\.formTable\) \{ S\.formTable = ''; refreshFormColumns\(\); \}/.test(panel), 'un nouvel ajout repart de la table de travail');
  ok(/tableInput\.addEventListener\('change', changeFormTable\)/.test(panel) && /let tableChangeToken = 0;/.test(panel), 'le changement de table : le dernier compte');
  // Bug réel trouvé par Chromium : une liste qui s'ouvre APRÈS une attente (`beforeOpen` async) échappe à l'Échap synthétique de `showFormErrors`, qui
  // fermait alors le PANNEAU (et vidait le formulaire) au lieu de la liste, dès qu'une erreur portait sur le champ « Table ».
  ok(/attach\(tableInput, tableInput\.nextElementSibling, \{ strict: true \}\)/.test(panel) && !/attach\(tableInput[^)]*beforeOpen/.test(panel), 'la liste des tables s\'ouvre tout de suite (aucun beforeOpen asynchrone : une erreur sur ce champ ne ferme pas le panneau)');
  ok(/tableInput\.addEventListener\('focus', \(\) => \{ loadTableOptions\(\); \}\)/.test(panel) && /if \(tables\.join\('\\n'\) !== tableNames\)/.test(panel), 'la liste se relit à la prise de focus sans effacer un texte en cours de frappe (liste identique : rien n\'est reposé)');
  ok(/tableField\.hidden = tileTypeSelect\.value === 'text' \|\| \(!S\.formTable && !\(S\.tableCount >= 2\)\)/.test(form), 'le champ ne se montre qu\'avec deux tables au moins (jamais sur une note)');
  ok(main.length > 0, 'les neuf fichiers se lisent');

  // Textes.
  ['tile.table.title', 'tile.table.failed', 'tileTable.failed', 'tileForm.table.label', 'tileForm.table.loading', 'tileForm.table.other', 'tileForm.error.tableUnreadable'].forEach((key) => {
    ['fr', 'en'].forEach((lang) => {
      i18n.setLang(lang);
      const text = i18n.t(key, { table: 'Clients' });
      ok(text && text !== key && text.indexOf('{') === -1, `« ${key} » en ${lang} : ${text}`);
    });
  });
  i18n.setLang('fr');

  // Le module graphique partagé porte le champ (un essai du formulaire le vérifie aussi : test-graphique.js).
  ok(/'table',\n\];/.test(read('js', 'graphique', 'definition.js')), 'js/graphique/definition.js lit `table`');
}

// ---- 4. Menu Filtre : la table d'un filtre avancé (2e moitié du lot 2) ------------------------------------------------------------------
// Le menu Filtre n'a PAS de liste déroulante (elle débordait du menu, retour d'Antoine du 18/11/2026) : la table se choisit par des boutons. Le filtre
// porte `table` seulement quand elle diffère de la table de travail ; les colonnes et les valeurs viennent des lignes de CETTE table.
{
  const filtersSource = read('js', 'main-filters.js');
  const index = read('index.html');
  const harness = read('dev-tests', 'harness.html');
  const css = read('css', 'style.css');
  const session = read('js', 'main-session.js');
  const core = read('js', 'main-core.js');

  const FILTER_CHECKS = [
    ['la table du filtre repart de la table de travail', (src) => /S\.filterTable = '';\s*let filterTableNames = \[\];/.test(src)],
    ['les lignes du filtre sont celles de SA table (vides tant qu\'elle n\'est pas lue)', (src) => /function filterRows\(\) \{[\s\S]{0,200}if \(!S\.filterTable\) return state\.rows;[\s\S]{0,120}Array\.isArray\(rows\) \? rows : \[\];/.test(src)],
    ['une autre table n\'a que ses colonnes (pas de jointure)', (src) => /columnOptions\(rows, undefined, !!S\.filterTable\)/.test(src) && /rows = S\.filterTable \? filterRows\(\) : \(rows \|\| store\.getState\(\)\.rows\);/.test(src)],
    ['le genre de la colonne (nombre, date, texte) se juge sur les lignes de sa table', (src) => /inferColumnKind\(column, filterRows\(\)\)/.test(src) && /updateAdvancedFilterFieldsForColumn\(rows\) \{\s*rows = S\.filterTable \? filterRows\(\)/.test(src)],
    ['le filtre porte `table` pour une autre table, avant d\'être posé', (src) => /if \(S\.filterTable\) filter\.table = S\.filterTable;\s*store\.setAdvancedFilter\(column, filter\);/.test(src)],
    ['la table de travail n\'est jamais une « autre table »', (src) => /const next = table && table !== store\.getState\(\)\.workingTable \? table : '';/.test(src)],
    ['le dernier choix de table compte (la lecture arrive après un autre clic)', (src) => /const token = \+\+filterTableToken;/.test(src) && /if \(next\) await ensureTableRows\(next\);\s*if \(token !== filterTableToken \|\| S\.filterTable !== next\) return;/.test(src)],
    ['une ouverture du menu remet la table de travail et relit la liste des tables', (src) => /if \(S\.filterTable\) \{ filterTableToken \+= 1; S\.filterTable = ''; renderFilterColumns\(\); \}\s*renderFilterTables\(\);\s*loadFilterTables\(\);/.test(src)],
    ['les boutons de table ne se montrent qu\'avec deux tables au moins', (src) => /filterTableField\.hidden = filterTableNames\.length < 2;/.test(src)],
    ['chaque bouton de table dit s\'il est choisi (aria-pressed) et n\'envoie rien', (src) => /<button type="button" class="filter-table-btn" data-table="\$\{escapeHtml\(name\)\}" aria-pressed="\$\{name === current \? 'true' : 'false'\}">\$\{escapeHtml\(name\)\}<\/button>/.test(src)],
    ['le nom de la table est écrit échappé', (src) => /data-table="\$\{escapeHtml\(name\)\}"/.test(src) && !/data-table="\$\{name\}"/.test(src)],
    ['la colonne choisie dit sa table à l\'étape 2', (src) => /filterColumnNameEl\.textContent = S\.filterTable \? `\$\{S\.filterTable\} › \$\{columnId\}` : columnId;/.test(src)],
    ['une table pas lue ou illisible : la phrase le dit, pas « aucune colonne ne correspond »', (src) => /filterColumnEmpty\.hidden = shown\.length > 0 \|\| \(!!S\.filterTable && GristBI\.data\.tableRowsStatus\(store\.getState\(\), S\.filterTable\) !== 'ready'\);/.test(src) && /status === 'failed' \? 'filters\.table\.failed' : \(status === 'loading' \? 'filters\.table\.loading' : 'filters\.table\.scope'\)/.test(src)],
    ['un clic sur un bouton de table est délégué (la liste est reconstruite)', (src) => /filterTablesEl\.addEventListener\('click'/.test(src) && /evt\.target\.closest\('\.filter-table-btn'\)/.test(src)],
    ['aucune liste déroulante dans le menu Filtre (piège des menus qui débordent)', (src) => !/combobox\.attach\(filterTables/.test(src) && !/GristBI\.combobox/.test(src)]
  ];
  FILTER_CHECKS.forEach(([label, check]) => ok(check(filtersSource), label));

  // Chaque vérification doit pouvoir échouer : le texte d'origine est remplacé par une version fautive.
  const FILTER_MUTANTS = [
    ['le filtre ne dit jamais sa table', 'if (S.filterTable) filter.table = S.filterTable;', ''],
    ['les colonnes de la table de travail pour une autre table', 'columnOptions(rows, undefined, !!S.filterTable)', 'columnOptions(rows)'],
    ['le genre jugé sur les lignes de travail', 'inferColumnKind(column, filterRows())', 'inferColumnKind(column)'],
    ['le dernier choix de table ne compte pas', 'if (token !== filterTableToken || S.filterTable !== next) return;', ''],
    ['la table de travail prise pour une autre', "table && table !== store.getState().workingTable ? table : ''", "table || ''"],
    ['la table gardée d\'une ouverture à l\'autre', "if (S.filterTable) { filterTableToken += 1; S.filterTable = ''; renderFilterColumns(); }", ''],
    ['la liste des tables jamais relue', 'loadFilterTables();\n    refreshFilterColumnList();', 'refreshFilterColumnList();'],
    ['les boutons de table avec une seule table', 'filterTableField.hidden = filterTableNames.length < 2;', 'filterTableField.hidden = false;'],
    ['un bouton de table sans état', "aria-pressed=\"${name === current ? 'true' : 'false'}\"", ''],
    ['un nom de table non échappé', 'data-table="${escapeHtml(name)}"', 'data-table="${name}"'],
    ['une table illisible qui ne dit rien', "status === 'failed' ? 'filters.table.failed' : (status === 'loading' ? 'filters.table.loading' : 'filters.table.scope')", "'filters.table.scope'"],
    ['les lignes d\'une table pas lue remplacées par celles de travail', 'return Array.isArray(rows) ? rows : [];', 'return Array.isArray(rows) ? rows : state.rows;'],
    ['la table non lue attendue pour rien', 'if (next) await ensureTableRows(next);', ''],
    ['la table absente de l\'étape 2', 'S.filterTable ? `${S.filterTable} › ${columnId}` : columnId', 'columnId'],
    ['une liste déroulante dans le menu', 'filterTablesEl.addEventListener(\'click\'', 'GristBI.combobox.attach(filterTablesEl); filterTablesEl.addEventListener(\'click\'']
  ];
  let filterSeen = 0;
  FILTER_MUTANTS.forEach(([label, from, to]) => {
    assert.ok(filtersSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/main-filters.js`);
    const mutated = filtersSource.replace(from, to);
    assert.ok(FILTER_CHECKS.some(([, check]) => !check(mutated)), `version fautive non vue : ${label}`);
    filterSeen += 1;
  });
  console.log(`OK menu Filtre et table — ${filterSeen} versions fautives vues par les vérifications`);

  // Une autre table que celle de travail : la table de travail est remise à zéro du côté de la session.
  ok(/S\.formTable = ''; S\.filterTable = ''; (?:resetColumnTable\(\); )?store\.setWorkingTable\(tableId\);/.test(session), 'un changement de table de travail remet la table du filtre à la table de travail');
  ok(!/S\.formTable = ''; store\.setWorkingTable/.test(session), 'aucune remise à zéro de la table de travail ne laisse le filtre sur l\'ancienne');

  // Le balisage, les références du DOM, la règle de masquage (piège n°10) et les textes.
  [['index.html', index], ['harness.html', harness]].forEach(([name, text]) => {
    ok(/<div id="filter-table-field" class="filter-table-field" hidden>/.test(text) && /id="filter-tables" class="filter-tables" role="group" aria-labelledby="filter-table-label"/.test(text) && /id="filter-table-note"[^>]*role="status"[^>]*hidden/.test(text), `${name} : le groupe de boutons de table est dans le menu Filtre, masqué au départ, nommé, avec sa phrase annoncée`);
    const step = text.slice(text.indexOf('id="filter-step-columns"'), text.indexOf('id="filter-column-list"'));
    ok(step.indexOf('id="filter-table-field"') !== -1 && step.indexOf('id="filter-table-field"') < step.indexOf('id="filter-column-search"'), `${name} : les boutons de table précèdent la recherche de colonne (étape 1)`);
  });
  ok(/const filterTablesEl = document\.getElementById\('filter-tables'\);/.test(core) && /filterTableField, filterTablesEl, filterTableNoteEl/.test(core), 'les trois références du DOM sont posées et partagées');
  ok(/\.filter-table-field\[hidden\] \{ display: none; \}/.test(css) && /\.filter-table-btn\[aria-pressed="true"\]/.test(css), 'le groupe est masqué par une règle explicite (piège n°10) et le bouton choisi se voit');
  ['filters.table.label', 'filters.table.loading', 'filters.table.scope', 'filters.table.failed'].forEach((key) => {
    ['fr', 'en'].forEach((lang) => {
      i18n.setLang(lang);
      const text = i18n.t(key, { table: 'Clients' });
      ok(text && text !== key && text.indexOf('{') === -1, `« ${key} » en ${lang} : ${text}`);
    });
  });
  i18n.setLang('fr');
}

console.log(`\nTOUT PASSE (${checks} vérifications) : une tuile, sa table`);
