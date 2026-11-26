/*
 * Les suggestions sur TOUT le document (js/advice-tables.js + son branchement dans le panneau, lot 3A du chantier « Colonnes de toutes les
 * tables », 26/11/2026) :
 *
 *   node dev-tests/test-advice-tables.js
 *
 * Huit sortes d'essais :
 *  1. TABLES À REGARDER : `pickTables` (celles que des tuiles lisent, puis celles qu'une Référence vise, puis l'ordre du document ; jamais la table
 *     de travail ni un doublon ni plus de huit en tout) et `tilesOf` (les tuiles d'UNE table) ;
 *  2. UNE TABLE À LA FOIS : ce que rend `completeTable` — la table de travail est celle de `complete` à l'identique (`table: ''`, tuile sans champ
 *     `table`), une autre table porte son nom et ses propres types Grist (jamais ceux de la table de travail), une tuile d'une table ne répond
 *     jamais à une question d'une autre ;
 *  3. FUSION : une file par table dont l'ordre ne change jamais, la meilleure tête à chaque pas, la table de travail devant à égalité, le malus d'un
 *     type déjà retenu AILLEURS (jamais dans la même table), deux propositions d'une même autre table au plus, jamais sous `MIN_SCORE` ;
 *  4. PROPRIÉTÉS « jamais absurde » rejouées sur les 20 tables du corpus prises tour à tour pour table de travail, avec trois autres tables du
 *     corpus, sur trois tableaux de bord de départ : colonnes qui existent dans LA table de la proposition, aucune question déjà posée sur sa table,
 *     aucun doublon dans sa table, au plus deux propositions par autre table, file de chaque table respectée ;
 *  5. EXTINCTION : à force d'ajouter la première proposition (avec sa table) la liste se vide, sans jamais reposer une question ;
 *  6. ROBUSTESSE : entrées hostiles, entrées intactes, déterminisme, huit tables en un temps raisonnable, fichier pur sans texte en dur ;
 *  7. VERSIONS FAUTIVES : chacune des erreurs plausibles de `js/advice-tables.js` est vue par les vérifications ci-dessus ;
 *  8. CÂBLAGE : le panneau (une seule liste, tuiles de la table de travail seulement pour « Que faire avec cette colonne ? » et « Ajouter une page
 *     entière »), la lecture silencieuse des autres tables (jamais `setTableRows`, vidée à chaque changement de table), textes fr/en, ordre des scripts.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (bloc 7).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const advice = require('../js/advice.js');
const complete = require('../js/advice-complete.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');
const { read, readMain } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); };
const same = (a, b, msg) => { checks += 1; assert.strictEqual(a, b, msg); };

// Charge un module du dépôt (UMD) avec un texte éventuellement modifié : `require` y reste relatif au fichier.
function loadModule(file, transform) {
  const full = path.join(__dirname, '..', 'js', file);
  const source = transform ? transform(fs.readFileSync(full, 'utf8')) : fs.readFileSync(full, 'utf8');
  const m = new Module(full, null);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(source, full);
  return m.exports;
}

const tables = corpus.build();
const table = (name) => tables.find((t) => t.name === name);
const MIN_SCORE = complete.MIN_SCORE;
const T = { t: (key) => key, lang: 'fr' };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const keysOf = (tile) => complete.questionKeys(tile);
const QUESTIONS_OF = (tiles) => { const set = new Set(); tiles.forEach((tile) => keysOf(tile).forEach((k) => set.add(k))); return set; };

// Une petite table fabriquée : `n` lignes, une catégorie `cat` (k valeurs) et une mesure.
function fake(n, cat, measure, k) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ id: i + 1, [cat]: `${cat[0]}${i % k}`, [measure]: 10 + (i % k) * 7 + (i % 5) });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tout ce qu'on vérifie d'une version de `js/advice-tables.js` : rejoué tel quel sur chaque version fautive (bloc 7).
// ---------------------------------------------------------------------------------------------------------------------
function tableChecks(tablesApi) {
  const baseRows = fake(60, 'Region', 'Montant', 4);
  const otherRows = fake(60, 'Region', 'Montant', 4);

  // ---- 1. Tables à regarder ----------------------------------------------------------------------------------------
  const names = ['Ventes', 'Clients', 'Personnes', 'Produits', 'Zones'];
  eq(tablesApi.pickTables(names, 'Ventes', [], []), ['Clients', 'Personnes', 'Produits', 'Zones'], 'l\'ordre du document, sans la table de travail');
  eq(tablesApi.pickTables(names, 'Ventes', [{ id: 'a', table: 'Zones' }, { id: 'b' }, { id: 'c', table: 'Personnes' }], []), ['Zones', 'Personnes', 'Clients', 'Produits'], 'les tables que des tuiles lisent d\'abord');
  eq(tablesApi.pickTables(names, 'Ventes', [{ id: 'a', table: 'Zones' }], ['Produits', 'Zones']), ['Zones', 'Produits', 'Clients', 'Personnes'], 'puis celles qu\'une Référence vise, puis le reste');
  eq(tablesApi.pickTables(names, 'Ventes', [{ id: 'a', table: 'Ventes' }, { id: 'b', table: 'Inconnue' }], ['Ventes', 'Absente']), ['Clients', 'Personnes', 'Produits', 'Zones'], 'jamais la table de travail ni une table qui n\'existe pas');
  eq(tablesApi.pickTables(['Ventes', 'Clients', 'Clients', '', null, 3, 'Zones'], 'Ventes', [], []), ['Clients', 'Zones'], 'sans doublon ni entrée qui n\'est pas un nom');
  const twelve = ['W'].concat(Array.from({ length: 12 }, (_, i) => `T${i + 1}`));
  same(tablesApi.pickTables(twelve, 'W', [], []).length, tablesApi.MAX_TABLES - 1, 'la table de travail et sept autres au plus');
  eq(tablesApi.pickTables(twelve, 'W', [{ id: 'x', table: 'T12' }], []).slice(0, 2), ['T12', 'T1'], 'une table lue par une tuile reste dans les huit même tout au bout du document');
  same(tablesApi.MAX_TABLES, 8, 'huit tables au plus');
  eq(tablesApi.pickTables(null, 'W', null, null), [], 'entrées absentes');

  // tilesOf : une table de travail lit les tuiles sans table et celles qui la nomment ; une autre table, les siennes seulement.
  const tw = { id: 'w' }; const tc = { id: 'c', table: 'Clients' }; const tself = { id: 's', table: 'Ventes' };
  eq(tablesApi.tilesOf([tw, tc, tself, null, 'x'], 'Ventes', true).map((x) => x.id), ['w', 's'], 'la table de travail : sans table, ou elle-même');
  eq(tablesApi.tilesOf([tw, tc, tself, null, 'x'], 'Clients', false).map((x) => x.id), ['c'], 'une autre table : les siennes');
  eq(tablesApi.tilesOf(null, 'Clients', false), [], 'tuiles absentes');

  // ---- 2. Une table à la fois ---------------------------------------------------------------------------------------
  const ventes = table('ventes');
  advice.setColumnInfo(ventes.info || {});
  const plain = complete.complete(ventes.rows, [], { lang: 'fr', limit: 3 });
  const asWorking = tablesApi.completeTable({ id: 'Ventes', rows: ventes.rows, working: true }, [], { lang: 'fr' });
  eq(asWorking.items.map((i) => ({ type: i.type, tileData: i.tileData, title: i.titleKey, score: i.completeScore })), plain.items.map((i) => ({ type: i.type, tileData: i.tileData, title: i.titleKey, score: i.completeScore })), 'la table de travail : exactement ce que rend `complete`');
  ok(asWorking.items.length > 0, 'la table de travail propose quelque chose');
  asWorking.items.forEach((item) => { same(item.table, '', 'une proposition de la table de travail n\'a pas de table'); ok(!own(item.tileData, 'table'), 'jamais de champ `table` pour la table de travail'); });
  same(asWorking.working, true); same(asWorking.id, 'Ventes');

  const rh = table('rh');
  const asOther = tablesApi.completeTable({ id: 'RH', rows: rh.rows, columnInfo: rh.info || {} }, [], { lang: 'fr' });
  ok(asOther.items.length > 0, 'une autre table propose quelque chose');
  asOther.items.forEach((item) => { same(item.table, 'RH', 'une autre table se nomme'); same(item.tileData.table, 'RH', 'et la tuile posée la lira'); });
  ok(own(asOther.items[0], 'completeScore') && Number.isFinite(asOther.items[0].completeScore), 'la note est gardée pour la fusion');
  eq(tablesApi.completeTable({ id: 'RH', rows: [], working: false }, [], { lang: 'fr' }).items, [], 'une table sans ligne ne propose rien');
  eq(tablesApi.completeTable({ id: 'RH', rows: null }, [], { lang: 'fr' }).items, [], 'une table illisible ne propose rien');
  eq(tablesApi.completeTable(null, [], {}).items, [], 'une table absente ne propose rien');
  // Une table dont les lignes font échouer le profilage ne retire rien aux autres.
  const broken = tablesApi.completeTable({ id: 'Cassee', rows: [null, 3] }, [], { lang: 'fr' });
  eq(broken.items, [], 'une table aux lignes inutilisables ne propose rien');
  same(broken.failed, true, 'et le dit');
  const mixed = tablesApi.completeAcross([{ id: 'Travail', rows: baseRows, working: true }, { id: 'Cassee', rows: [null, 3] }], [], { lang: 'fr' });
  ok(mixed.items.length > 0, 'les autres tables proposent quand même');
  ok(asWorking.items.length <= tablesApi.PER_TABLE && asOther.items.length <= tablesApi.PER_TABLE, 'trois propositions au plus par table avant la fusion');
  ok(tablesApi.completeTable({ id: 'RH', rows: rh.rows, columnInfo: rh.info || {} }, [], { lang: 'fr', perTable: 1 }).items.length === 1, 'le plafond par table se règle');
  ok(asOther.items.length === tablesApi.PER_TABLE, 'trois propositions d\'une table riche : le plafond par défaut est celui de `PER_TABLE`');

  // Les types Grist d'une autre table sont les siens : jamais le registre de la table de travail (`Client` y est une Référence).
  advice.setColumnInfo({ Client: { type: 'Ref:Clients' } });
  const clientRows = [];
  for (let i = 0; i < 90; i++) clientRows.push({ id: i + 1, Client: `Cl${i % 5}`, Montant: 50 + (i % 5) * 30 + (i % 7) });
  const withOwn = tablesApi.completeTable({ id: 'Autre', rows: clientRows, columnInfo: {} }, [], { lang: 'fr' });
  ok(withOwn.items.some((i) => i.tileData.dimension === 'Client'), 'une colonne `Client` qui n\'est pas une Référence dans SA table sert d\'axe, quoi que dise la table de travail');
  const noInfo = tablesApi.completeTable({ id: 'Autre', rows: clientRows }, [], { lang: 'fr' });
  ok(noInfo.items.some((i) => i.tileData.dimension === 'Client'), 'une table dont les types sont illisibles n\'hérite jamais de ceux de la table de travail : ses valeurs en jugent');
  const refOwn = tablesApi.completeTable({ id: 'Autre', rows: clientRows, columnInfo: { Client: { type: 'Ref:Zones' } } }, [], { lang: 'fr' });
  ok(!refOwn.items.some((i) => i.tileData.dimension === 'Client'), 'et une Référence de SA table n\'en sert jamais');
  // La table de travail, elle, lit le registre posé par le widget.
  const workRef = tablesApi.completeTable({ id: 'Travail', rows: clientRows, working: true }, [], { lang: 'fr' });
  ok(!workRef.items.some((i) => i.tileData.dimension === 'Client'), 'la table de travail lit le registre des types Grist du widget');
  advice.setColumnInfo({});

  // Une tuile d'une table ne répond jamais à une question d'une autre, même quand les colonnes portent les mêmes noms.
  const askedElsewhere = { id: 'x', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', table: 'Autre' };
  const askedHere = { id: 'y', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  const questionOf = (items) => items.map((i) => keysOf(i.tileData)[0]);
  const key = keysOf(askedHere)[0];
  const freeWork = tablesApi.completeTable({ id: 'Travail', rows: baseRows, working: true }, [], { lang: 'fr' });
  ok(questionOf(freeWork.items).indexOf(key) !== -1 || freeWork.items.length > 0, 'point de départ : la table de travail propose');
  eq(questionOf(tablesApi.completeTable({ id: 'Travail', rows: baseRows, working: true }, [askedElsewhere], { lang: 'fr' }).items), questionOf(freeWork.items), 'une tuile d\'une autre table ne masque rien dans la table de travail');
  ok(questionOf(tablesApi.completeTable({ id: 'Travail', rows: baseRows, working: true }, [askedHere], { lang: 'fr' }).items).indexOf(key) === -1, 'une tuile de la table de travail masque sa question');
  const otherFree = tablesApi.completeTable({ id: 'Autre', rows: otherRows }, [], { lang: 'fr' });
  eq(questionOf(tablesApi.completeTable({ id: 'Autre', rows: otherRows }, [askedHere], { lang: 'fr' }).items), questionOf(otherFree.items), 'une tuile de la table de travail ne masque rien dans une autre table');
  ok(questionOf(tablesApi.completeTable({ id: 'Autre', rows: otherRows }, [askedElsewhere], { lang: 'fr' }).items).indexOf(key) === -1, 'une tuile d\'une autre table masque sa question dans CETTE table');

  // ---- 3. Fusion ---------------------------------------------------------------------------------------------------
  const mk = (type, score, tag) => ({ type, completeScore: score, tag: tag || `${type}${score}` });
  const part = (id, working, items) => ({ id, working, items });
  const tags = (items) => items.map((i) => i.tag);
  // Une seule table : la fusion rend la file, jamais reclassée ni pénalisée.
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8), mk('bar', 7), mk('pie', 5)])], { limit: 3 })), ['bar8', 'bar7', 'pie5'], 'une seule table : sa file telle quelle, même type deux fois');
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8), mk('pie', 7), mk('line', 6), mk('kpi', 5)])])), ['bar8', 'pie7', 'line6'], 'trois par défaut');
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8), mk('pie', 7), mk('line', 6)])], { limit: 2 })), ['bar8', 'pie7'], 'la limite demandée');
  // À égalité, la table de travail passe devant, quel que soit l'ordre des tables dans la liste.
  eq(tags(tablesApi.merge([part('O', false, [mk('kpi', 6, 'O')]), part('W', true, [mk('pie', 6, 'W')])], { limit: 2 })), ['W', 'O'], 'à égalité la table de travail d\'abord');
  eq(tags(tablesApi.merge([part('W', true, [mk('pie', 6, 'W')]), part('O', false, [mk('kpi', 6, 'O')])], { limit: 2 })), ['W', 'O']);
  eq(tags(tablesApi.merge([part('O1', false, [mk('kpi', 6, 'O1')]), part('O2', false, [mk('pie', 6, 'O2')])], { limit: 2 })), ['O1', 'O2'], 'à égalité entre deux autres tables : l\'ordre des tables');
  // Une autre table passe devant quand sa note est meilleure.
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 5, 'W')]), part('O', false, [mk('kpi', 9, 'O')])], { limit: 2 })), ['O', 'W'], 'la meilleure note passe devant');
  // Un type déjà retenu depuis une AUTRE table pèse deux points : ici la barre de O (7 -> 5) passe derrière le camembert de W (6).
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8, 'Wbar'), mk('pie', 6, 'Wpie')]), part('O', false, [mk('bar', 7, 'Obar')])], { limit: 3 })), ['Wbar', 'Wpie', 'Obar'], 'le type déjà retenu ailleurs pèse');
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8, 'Wbar'), mk('pie', 6, 'Wpie')]), part('O', false, [mk('line', 7, 'Oline')])], { limit: 3 })), ['Wbar', 'Oline', 'Wpie'], 'un autre type ne pèse pas');
  same(tablesApi.SAME_TYPE_PENALTY, 2, 'le malus est de deux points');
  // ... mais jamais dans la même table (`complete` l'a déjà fait) : 4,5 reste 4,5.
  eq(tags(tablesApi.merge([part('W', true, [mk('bar', 8, 'a'), mk('bar', 4.5, 'b')]), part('O', false, [mk('pie', 4.2, 'c')])], { limit: 3 })), ['a', 'b', 'c'], 'pas de second malus dans la même table');
  // Deux propositions au plus d'une même autre table ; la table de travail n'est pas plafonnée.
  eq(tags(tablesApi.merge([part('O', false, [mk('a', 9, 'o1'), mk('b', 8.5, 'o2'), mk('c', 8, 'o3')]), part('W', true, [mk('d', 5, 'w1')])], { limit: 4 })), ['o1', 'o2', 'w1'], 'au plus deux d\'une même autre table');
  same(tablesApi.MAX_PER_OTHER_TABLE, 2);
  eq(tags(tablesApi.merge([part('W', true, [mk('a', 9, 'w1'), mk('b', 8.5, 'w2'), mk('c', 8, 'w3'), mk('d', 7, 'w4')])], { limit: 4 })), ['w1', 'w2', 'w3', 'w4'], 'la table de travail n\'est pas plafonnée');
  // Jamais sous MIN_SCORE.
  eq(tags(tablesApi.merge([part('W', true, [mk('a', 6, 'w1')]), part('O', false, [mk('b', MIN_SCORE - 0.1, 'o1')])], { limit: 3 })), ['w1'], 'sous le seuil : mieux vaut moins de cartes');
  eq(tags(tablesApi.merge([part('W', true, [mk('a', 6, 'w1')]), part('O', false, [mk('b', MIN_SCORE, 'o1')])], { limit: 3 })), ['w1', 'o1'], 'au seuil : gardée');
  // Une file n'est jamais reclassée : l'ordre interne d'une table est celui de `complete`.
  eq(tags(tablesApi.merge([part('O', false, [mk('a', 5, 'o1'), mk('b', 9, 'o2')])], { limit: 2 })), ['o1', 'o2'], 'l\'ordre d\'une file ne change jamais');
  // Les entrées ne bougent pas, des entrées hostiles ne cassent rien.
  const frozen = [part('W', true, Object.freeze([mk('a', 8), mk('b', 6)])), part('O', false, Object.freeze([mk('c', 7)]))];
  const before = JSON.stringify(frozen);
  tablesApi.merge(frozen, { limit: 3 });
  same(JSON.stringify(frozen), before, 'les entrées de la fusion ne sont jamais modifiées');
  [null, undefined, 'x', 3, {}, [null], [{}], [{ id: 'W', working: true, items: [null, {}, { type: 'a' }, { type: 'a', completeScore: NaN }, { type: 'a', completeScore: 'x' }] }]].forEach((bad) => {
    let result;
    assert.doesNotThrow(() => { result = tablesApi.merge(bad, { limit: 3 }); }, `merge(${JSON.stringify(bad)})`);
    eq(result, [], 'rien d\'inventé pour une entrée sans note');
  });
  eq(tags(tablesApi.merge([part('W', true, [{ type: 'a', completeScore: NaN, tag: 'x' }, mk('b', 6, 'ok')])], { limit: 3 })), ['ok'], 'une proposition sans note valide est écartée');

  // ---- 4. L'ensemble, d'un bloc, sur des tables fabriquées ------------------------------------------------------------
  const across = tablesApi.completeAcross([{ id: 'Travail', rows: baseRows, working: true }, { id: 'Autre', rows: otherRows }], [], { lang: 'fr' });
  ok(across.items.length > 0 && across.items.length <= 3, 'completeAcross : au plus trois');
  eq(Object.keys(across.perTable), ['Travail', 'Autre'], 'completeAcross garde le détail de chaque table');
  eq(tablesApi.completeAcross(null, null, null).items, [], 'completeAcross sans table');
}

tableChecks(loadModule('advice-tables.js'));
console.log(`OK tables — ${checks} vérifications (tables à regarder, une table à la fois, fusion, types Grist propres à chaque table, tuiles propres à chaque table)`);

const api = loadModule('advice-tables.js');

// ---------------------------------------------------------------------------------------------------------------------
// 4. PROPRIÉTÉS « jamais absurde » : chaque table du corpus en table de travail, trois autres tables, trois tableaux de départ
// ---------------------------------------------------------------------------------------------------------------------
const columnsOf = (tile) => complete.columnsOfTile(tile);
const questionsOfTable = (all, id, working) => QUESTIONS_OF(api.tilesOf(all, id, working));
function firstSuggestions(t, limit) {
  advice.setColumnInfo(t.info || {});
  return advice.suggestTiles(t.rows, undefined, { limit, lang: 'fr', columnInfo: t.info || {} }).map((s, i) => Object.assign({ id: `p${i}` }, s.tileData));
}
function documentOf(workingTable, index) {
  const others = [];
  for (let k = 1; others.length < 3 && k < tables.length; k++) {
    const other = tables[(index + k * 3) % tables.length];
    if (other !== workingTable && others.indexOf(other) === -1) others.push(other);
  }
  return { working: { id: `W_${workingTable.name}`, rows: workingTable.rows, working: true, info: workingTable.info }, others: others.map((o) => ({ id: `T_${o.name}`, rows: o.rows, columnInfo: o.info || {}, name: o.name })) };
}
function acrossDocument(doc, tiles) {
  advice.setColumnInfo(doc.working.info || {});
  const parts = [api.completeTable({ id: doc.working.id, rows: doc.working.rows, working: true }, tiles, { lang: 'fr' })];
  doc.others.forEach((o) => parts.push(api.completeTable(o, tiles, { lang: 'fr' })));
  return { parts, items: api.merge(parts, { limit: 3 }) };
}
{
  let cases = 0;
  let proposals = 0;
  let fromOthers = 0;
  tables.forEach((workingTable, index) => {
    const doc = documentOf(workingTable, index);
    const first = firstSuggestions(workingTable, 3);
    const boards = [[], first.slice(0, 1), first];
    // Un tableau de départ qui lit AUSSI une autre table : une tuile posée sur la 1re autre table.
    const otherTile = firstSuggestions({ name: doc.others[0].name, rows: doc.others[0].rows, info: doc.others[0].columnInfo }, 1).map((tile) => Object.assign({}, tile, { id: 'o0', table: doc.others[0].id }));
    boards.push(first.slice(0, 1).concat(otherTile));
    boards.forEach((board) => {
      cases += 1;
      const { parts, items } = acrossDocument(doc, board);
      const label = `${workingTable.name} / ${board.length} tuile(s)`;
      ok(items.length <= 3, `${label} : trois au plus`);
      const rowsById = { [doc.working.id]: doc.working.rows };
      doc.others.forEach((o) => { rowsById[o.id] = o.rows; });
      const perTable = {};
      let otherCount = {};
      items.forEach((item) => {
        proposals += 1;
        ok(Number.isFinite(item.completeScore) && item.completeScore >= MIN_SCORE, `${label} : jamais sous ${MIN_SCORE} points (${item.completeScore})`);
        const isWorking = item.table === '';
        const tid = isWorking ? doc.working.id : item.table;
        ok(own(rowsById, tid), `${label} : « ${item.table} » est une table du document`);
        if (isWorking) ok(!own(item.tileData, 'table'), `${label} : la table de travail ne porte jamais de champ \`table\``);
        else { same(item.tileData.table, item.table, `${label} : la tuile lira la table de la proposition`); fromOthers += 1; otherCount[tid] = (otherCount[tid] || 0) + 1; }
        // Les colonnes lues existent dans LA table de la proposition (ou sont des colonnes dérivées d'une date de cette table).
        const have = new Set(Object.keys(rowsById[tid][0]));
        columnsOf(item.tileData).forEach((column) => ok(have.has(column), `${label} : « ${column} » n'est pas une colonne de ${tid}`));
        // Aucune question déjà posée sur SA table, ni deux fois dans la même table.
        const asked = questionsOfTable(board, tid, isWorking);
        const k = keysOf(item.tileData)[0];
        ok(!k || !asked.has(k), `${label} : la question « ${k} » est déjà posée sur ${tid}`);
        perTable[tid] = perTable[tid] || new Set();
        ok(!k || !perTable[tid].has(k), `${label} : deux propositions posent « ${k} » sur ${tid}`);
        if (k) perTable[tid].add(k);
      });
      Object.keys(otherCount).forEach((tid) => ok(otherCount[tid] <= api.MAX_PER_OTHER_TABLE, `${label} : au plus ${api.MAX_PER_OTHER_TABLE} propositions de ${tid}`));
      // La file de chaque table est respectée : ses propositions retenues sont les premières de sa file, dans son ordre.
      parts.forEach((p) => {
        const mine = items.filter((item) => (p.working ? item.table === '' : item.table === p.id));
        eq(mine.map((i) => i.titleKey + JSON.stringify(i.titleVars)), p.items.slice(0, mine.length).map((i) => i.titleKey + JSON.stringify(i.titleVars)), `${label} : la file de ${p.id} garde son ordre`);
      });
      // Une proposition = ce que `complete` propose pour sa table avec SES tuiles (jamais celles des autres).
      if (items.some((item) => item.table === '')) {
        advice.setColumnInfo(doc.working.info || {});
        const direct = complete.complete(doc.working.rows, api.tilesOf(board, doc.working.id, true), { lang: 'fr', limit: 3 }).items.map((i) => JSON.stringify(i.tileData));
        items.filter((item) => item.table === '').forEach((item) => ok(direct.indexOf(JSON.stringify(item.tileData)) !== -1, `${label} : une proposition de la table de travail est celle de \`complete\``));
      }
      // Déterminisme.
      eq(acrossDocument(doc, board).items.map((i) => i.titleKey + i.table), items.map((i) => i.titleKey + i.table), `${label} : déterministe`);
    });
  });
  ok(fromOthers > 0, 'des propositions viennent d\'autres tables');
  console.log(`OK propriétés — ${cases} documents (20 tables en table de travail, 3 autres tables chacune, 4 tableaux de départ), ${proposals} propositions dont ${fromOthers} d'autres tables : colonnes de leur table, questions de leur table, au plus deux par autre table, files respectées`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. EXTINCTION : à force d'ajouter la première proposition, avec sa table
// ---------------------------------------------------------------------------------------------------------------------
{
  const doc = documentOf(table('ventes'), 11);
  let board = [];
  let steps = 0;
  const seen = new Set();
  const perTableLeft = {};
  while (steps < 120) {
    const { items } = acrossDocument(doc, board);
    if (!items.length) break;
    const item = items[0];
    const k = `${item.table}|${keysOf(item.tileData)[0]}`;
    ok(!seen.has(k), `une question déjà posée est reproposée : ${k}`);
    seen.add(k);
    board = board.concat([Object.assign({ id: `n${steps}` }, item.tileData)]);
    perTableLeft[item.table || '(travail)'] = (perTableLeft[item.table || '(travail)'] || 0) + 1;
    steps += 1;
  }
  ok(steps < 120, 'la liste finit par se vider');
  ok(Object.keys(perTableLeft).length > 1, 'plusieurs tables ont été proposées avant que la liste se vide');
  console.log(`OK extinction — la liste se vide en ${steps} ajouts, sans reposer une question (${Object.keys(perTableLeft).map((k) => `${k} : ${perTableLeft[k]}`).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. ROBUSTESSE
// ---------------------------------------------------------------------------------------------------------------------
{
  [null, undefined, 'x', 3, {}, [], [null], [{}], [{ id: 'A' }], [{ id: 'A', rows: 'x' }], [{ id: 'A', rows: [null, 3] }], [{ rows: [{ a: 1 }] }]].forEach((bad) => {
    assert.doesNotThrow(() => api.completeAcross(bad, bad, bad), `completeAcross(${JSON.stringify(bad)})`);
    assert.doesNotThrow(() => api.completeTable(bad, bad, bad), `completeTable(${JSON.stringify(bad)})`);
    assert.doesNotThrow(() => api.pickTables(bad, bad, bad, bad), `pickTables(${JSON.stringify(bad)})`);
    assert.doesNotThrow(() => api.tilesOf(bad, bad, bad), `tilesOf(${JSON.stringify(bad)})`);
  });
  // Les entrées ne bougent pas.
  const t1 = table('rh');
  const tiles = [{ id: 'a', type: 'bar', dimension: 'Service', measure: 'Salaire', aggFn: 'sum', table: 'RH' }];
  const rowsBefore = JSON.stringify(t1.rows.slice(0, 5));
  const tilesBefore = JSON.stringify(tiles);
  api.completeAcross([{ id: 'RH', rows: t1.rows, columnInfo: t1.info || {} }], tiles, { lang: 'fr' });
  same(JSON.stringify(t1.rows.slice(0, 5)), rowsBefore, 'les lignes ne sont pas modifiées');
  same(JSON.stringify(tiles), tilesBefore, 'les tuiles ne sont pas modifiées');
  // Huit tables d'un coup : le calcul reste court (le profilage rend la main entre deux tables dans le panneau, mais le total compte).
  const eight = tables.slice(0, 8).map((t, i) => ({ id: `T${i}`, rows: t.rows, columnInfo: t.info || {}, working: i === 0 }));
  advice.setColumnInfo(tables[0].info || {});
  const started = Date.now();
  const result = api.completeAcross(eight, [], { lang: 'fr' });
  const elapsed = Date.now() - started;
  ok(result.items.length > 0, 'huit tables : des propositions');
  ok(elapsed < 8000, `huit tables en ${elapsed} ms : trop long`);
  // Phrases : jamais de texte en dur dans le fichier ; les clés de `complete` se traduisent dans les deux langues.
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'advice-tables.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch(', 'console.'].forEach((bad) => ok(code.indexOf(bad) === -1, `le fichier est pur : « ${bad} »`));
  ok(!/['"`][^'"`\n]*[éèêàùçô][^'"`\n]*['"`]/.test(code), 'aucun texte français en dur dans le code');
  ok(/require\('\.\/advice-complete\.js'\)/.test(source) && !/require\('\.\.?\/(?!advice-complete)/.test(source), 'une seule dépendance : advice-complete.js');
  console.log(`OK robustesse — entrées hostiles, entrées intactes, huit tables en ${elapsed} ms, fichier pur`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. VERSIONS FAUTIVES : chacune doit être vue
// ---------------------------------------------------------------------------------------------------------------------
const ADVICE_TABLES_MUTANTS = [
  ['la table de travail ne lit plus les tuiles sans table', "return working ? (!own || own === id) : own === id;", 'return working ? own === id : own === id;'],
  ['une autre table lit toutes les tuiles', "return working ? (!own || own === id) : own === id;", 'return working ? (!own || own === id) : true;'],
  ['la table de travail lit les tuiles des autres tables', "return working ? (!own || own === id) : own === id;", 'return working ? true : own === id;'],
  ['la table de travail proposée parmi les autres', "(Array.isArray(names) ? names : []).filter((n) => text(n) && n !== working)", '(Array.isArray(names) ? names : []).filter((n) => text(n))'],
  ['les tables lues par des tuiles pas prioritaires', "(Array.isArray(tiles) ? tiles : []).forEach((tile) => { if (isObject(tile)) take(text(tile.table)); });", ''],
  ['les tables visées par une Référence pas prioritaires', "(Array.isArray(linked) ? linked : []).forEach(take);", ''],
  ['pas de plafond de tables', 'return out.slice(0, MAX_TABLES - 1);', 'return out;'],
  ['un doublon gardé', "if (known.has(n) && out.indexOf(n) === -1) out.push(n);", "if (known.has(n)) out.push(n);"],
  ['les types Grist de la table de travail ignorés', "columnInfo: working ? table.columnInfo : (table.columnInfo || {})", "columnInfo: table.columnInfo || {}"],
  ['les types Grist de la table de travail prêtés aux autres', "columnInfo: working ? table.columnInfo : (table.columnInfo || {})", "columnInfo: table.columnInfo"],
  ['toutes les tuiles passées à `complete`', "adviceComplete.complete(table.rows, tilesOf(tiles, id, working), {", "adviceComplete.complete(table.rows, Array.isArray(tiles) ? tiles : [], {"],
  ['une autre table sans son nom', "table: working ? '' : id,", "table: '',"],
  ['la table de travail nommée', "table: working ? '' : id,", "table: id,"],
  ['la tuile posée sans sa table', "tileData: working || !isObject(item.tileData) ? item.tileData : Object.assign({}, item.tileData, { table: id })", "tileData: item.tileData"],
  ['la tuile de la table de travail marquée', "tileData: working || !isObject(item.tileData) ? item.tileData : Object.assign({}, item.tileData, { table: id })", "tileData: Object.assign({}, item.tileData, { table: id })"],
  ['un seul résultat par table', "limit: o.perTable > 0 ? o.perTable : PER_TABLE", "limit: 1"],
  ['la note de la proposition perdue', "const items = result.items.map((item) => Object.assign({}, item, {", "const items = result.items.map((item) => Object.assign({}, item, { completeScore: undefined,"],
  ['pas de plafond par autre table', "if (!q.items.length || (!q.working && q.taken >= MAX_PER_OTHER_TABLE)) return;", "if (!q.items.length) return;"],
  ['pas de seuil', "if (!best || best.score < adviceComplete.MIN_SCORE) break;", "if (!best) break;"],
  ['à égalité une autre table devant', "(score === best.score && (q.working && !best.q.working))", "(score === best.score && (!q.working && best.q.working))"],
  ['pas de malus entre tables', "const score = head.completeScore - (elsewhere ? SAME_TYPE_PENALTY : 0);", "const score = head.completeScore;"],
  ['un malus dans la même table', "typeFrom.some((c) => c.type === head.type && c.id !== q.id)", "typeFrom.some((c) => c.type === head.type)"],
  ['un malus trop faible', 'const SAME_TYPE_PENALTY = 2;', 'const SAME_TYPE_PENALTY = 0.5;'],
  ['une file reclassée', "items: (Array.isArray(p.items) ? p.items : []).filter(scored), taken: 0 }", "items: (Array.isArray(p.items) ? p.items : []).filter(scored).sort((a, b) => b.completeScore - a.completeScore), taken: 0 }"],
  ['la limite ignorée', 'while (chosen.length < limit) {', 'while (chosen.length < 99) {'],
  ['les entrées de la fusion modifiées', "items: (Array.isArray(p.items) ? p.items : []).filter(scored), taken: 0 }", "items: Array.isArray(p.items) ? p.items : [], taken: 0 }"],
  ['une proposition sans note acceptée', "const scored = (item) => isObject(item) && Number.isFinite(item.completeScore);", "const scored = (item) => isObject(item);"],
  ['la table de travail plafonnée comme une autre', "(!q.working && q.taken >= MAX_PER_OTHER_TABLE)", "(q.taken >= MAX_PER_OTHER_TABLE)"],
  ['une table qui lève retire tout', "    } catch (e) {\n      // Une table dont les lignes font échouer le profilage ne retire jamais les propositions des autres.\n      return { id, working, result: empty, items: [], failed: true };\n    }", "    } catch (e) {\n      throw e;\n    }"]
];
const advicetablesSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'advice-tables.js'), 'utf8');
let seen = 0;
ADVICE_TABLES_MUTANTS.forEach(([label, from, to]) => {
  assert.ok(advicetablesSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/advice-tables.js`);
  let caught = false;
  try { tableChecks(loadModule('advice-tables.js', (src) => src.replace(from, to))); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  seen += 1;
});
console.log(`OK versions fautives — ${seen} versions de js/advice-tables.js vues par les vérifications`);

// ---------------------------------------------------------------------------------------------------------------------
// 8. CÂBLAGE lu dans les sources
// ---------------------------------------------------------------------------------------------------------------------
{
  const panel = read('js', 'main-panel.js');
  const session = read('js', 'main-session.js');
  const index = read('index.html');
  const harness = read('dev-tests', 'harness.html');
  const css = read('css', 'style.css');
  const main = readMain();
  // Ordre des scripts : après advice-complete.js, avant le premier fichier qui s'en sert.
  [index, harness].forEach((html, n) => {
    const at = html.indexOf('js/advice-tables.js');
    ok(at > html.indexOf('js/advice-complete.js') && html.indexOf('js/advice-complete.js') > 0, `${n ? 'harness' : 'index'} : advice-tables.js après advice-complete.js`);
    ok(at < html.indexOf('js/main-core.js'), `${n ? 'harness' : 'index'} : advice-tables.js avant main-core.js`);
    same(html.split('js/advice-tables.js').length - 1, 1, 'chargé une seule fois');
  });
  // Le panneau : une seule liste sur tout le document, les autres tables lues par la lecture silencieuse.
  ok(/async function suggestAcrossDocument\(/.test(panel) && /GristBI\.adviceTables\.pickTables|adviceTables\.pickTables\(/.test(panel), 'le panneau choisit les tables');
  ok(/adviceTables\.merge\(parts, \{ limit: 3 \}\)/.test(panel), 'et fusionne trois propositions au plus');
  ok(/suggestionTable\(name\)/.test(panel) && /const suggestionTable = \(\.\.\.args\) => parts\.suggestionTable\(\.\.\.args\);/.test(panel), 'la lecture silencieuse est celle de main-session.js');
  ok(/SUGGESTION_READ_TIMEOUT_MS = 8000/.test(panel) && /readWithin\(suggestionTable/.test(panel), 'une table qui ne répond pas en 8 s est laissée de côté');
  ok(/await pause\(\)/.test(panel), 'chaque table rend la main avant son profilage');
  ok(/tiles\.length \? adviceTables\.pickTables/.test(panel), 'les autres tables ne sont regardées que si le rapport a déjà des tuiles');
  ok(/referencedTables\(working\)/.test(panel) && /\^Ref:\(\.\+\)\$/.test(panel), 'les tables visées par une Référence passent avant');
  ok(/markRecommended\(items\.filter\(\(item\) => !item\.table\)\)/.test(panel), 'un badge « Recommandé » ne vient jamais d\'une autre table');
  ok(/item\.rows = rowsOf\[item\.table\]/.test(panel) && /Array\.isArray\(s\.rows\) \? s\.rows : rows/.test(panel), 'l\'aperçu d\'une carte d\'une autre table est dessiné avec SES lignes');
  ok(/tilePanel\.complete\.table/.test(panel) && /tilePanel\.complete\.addAriaTable/.test(panel), 'la carte dit sa table, le bouton aussi');
  // « Que faire avec cette colonne ? » et « Ajouter une page entière » ne comptent que les tuiles de la table de travail.
  const pagesBody = panel.slice(panel.indexOf('function renderPages('), panel.indexOf('tilePagesListEl.addEventListener'));
  const columnBody = panel.slice(panel.indexOf('function columnResultsAreFresh()'), panel.indexOf('function hideColumnResults'));
  const helperBody = panel.slice(panel.indexOf('function renderColumnHelper('), panel.indexOf('function renderColumnHelper(') + 2400);
  ok(/tilesOfWorkingTable\(state\)/.test(pagesBody) && !/tilesOfAllPages\(state\)/.test(pagesBody), 'les pages proposées ne lisent que les tuiles de la table de travail');
  ok(/tilesOfWorkingTable\(state\)/.test(columnBody) && !/tilesOfAllPages\(state\)/.test(columnBody), 'la fraîcheur de la colonne choisie aussi');
  ok(/tilesOfWorkingTable\(state\)/.test(helperBody) && !/tilesOfAllPages\(state\)/.test(helperBody), 'et « Que faire avec cette colonne ? »');
  ok(/const tilesOfWorkingTable = \(state\) =>/.test(panel) && /adviceTables\.tilesOf\(tilesOfAllPages\(state\), workingTableOf\(state\), true\)/.test(panel));
  // La lecture silencieuse : jamais `setTableRows` (une lecture que personne n'a demandée ne redessine pas toutes les tuiles), vidée à chaque changement de table.
  const suggestionBody = session.slice(session.indexOf('function suggestionTable('), session.indexOf('// Lit la table `table` si elle ne l\'est pas encore'));
  ok(suggestionBody.length > 200 && !/setTableRows/.test(suggestionBody), 'la lecture silencieuse n\'écrit pas dans le store');
  ok(/listAvailableTables\(\)/.test(suggestionBody) && /available\.indexOf\(table\) === -1/.test(suggestionBody), 'elle ne lit qu\'une table que `listAvailableTables` rend');
  ok(/store\.getState\(\)\.workingTable !== epoch/.test(suggestionBody), 'une réponse venue après un changement de table de travail n\'écrit rien');
  ok(/readColumnFormats\(table\)/.test(suggestionBody), 'les types Grist de la table lue sont les siens');
  ok(/Array\.isArray\(known\)/.test(suggestionBody), 'une table que le store connaît déjà n\'est pas relue');
  same((session.match(/suggestionTables\.clear\(\)/g) || []).length, 2, 'vidée au rechargement des données et au changement de table de travail');
  ok(/suggestionTables\.has\(table\) \? await suggestionTables\.get\(table\)/.test(session), 'une tuile qui demande ensuite la même table réutilise ces lignes');
  ok(/Object\.assign\(parts, \{[^}]*suggestionTable/.test(session) || /suggestionTable,/.test(session), 'exportée vers le panneau');
  // Textes et styles.
  const i18nSource = read('js', 'i18n.js');
  ['tilePanel.complete.table', 'tilePanel.complete.addAriaTable'].forEach((k) => {
    const entry = new RegExp(`'${k.replace(/\./g, '\\.')}': \\{ fr: '([^']+)', en: '([^']+)' \\}`).exec(i18nSource);
    ok(entry && entry[1].indexOf('{table}') !== -1 && entry[2].indexOf('{table}') !== -1, `${k} : fr et en nomment la table`);
  });
  i18n.setLang('fr');
  same(i18n.t('tilePanel.complete.table', { table: 'Clients' }), 'Dans la table « Clients »');
  i18n.setLang('en');
  same(i18n.t('tilePanel.complete.table', { table: 'Clients' }), 'In the “Clients” table');
  i18n.setLang('fr');
  ok(/\.complete-card-table\s*\{/.test(css), 'la ligne de la table est stylée');
  ok(main.indexOf('GristBI.adviceTables') > 0, 'le module est lu par le panneau');
  console.log('OK câblage — le panneau fait UNE liste sur tout le document, la lecture des autres tables est silencieuse, vidée à chaque changement de table, fr/en');
}
