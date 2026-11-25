/*
 * Les deux jeux de noms de BI_Dashboard_Config (consigne GFS 030, 25/11/2026) — sans navigateur ni vrai Grist :
 *   node dev-tests/test-config-names.js
 *
 *  - `js/config-names.js` (pur) : la résolution colonne par colonne (nouveau nom, ancien nom, les deux, aucun), la lecture réunie, les champs d'écriture,
 *    le lot `RenameColumn` de la fenêtre commune (jamais une colonne dont les DEUX noms existent), « Réunir » (jamais une cellule déjà remplie), la
 *    reconnaissance d'une écriture refusée parce qu'un nom a disparu ;
 *  - le vrai `js/grist-api.js` sur un faux document : un document d'avant la consigne (`Nom`…) est lu ET écrit sous ses noms, sans qu'une colonne anglaise
 *    apparaisse à côté ; un document neuf naît en anglais ; un document à noms mêlés ; un document qui porte les deux jeux se lit réuni et s'écrit en
 *    anglais ; un renommage venu d'un autre onglet est rattrapé UNE fois (relire les noms, recommencer), pas deux ;
 *  - garde-fou des sources : plus aucun nom français dans le code de `js/grist-api.js` (hors commentaires).
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { read, loadApiWithFakeConfigTable } = require('./lib/helpers.js');
const CN = require('../js/config-names.js');
const data = require('../js/data.js');
const i18n = require('../js/i18n.js');

const same = (a, b, message) => assert.deepStrictEqual(a, b, message);
const EN = ['Name', 'ReportType', 'ModifiedAt', 'ModifiedBy'];
const FR = ['Nom', 'TypeRapport', 'DateModif', 'ModifiePar'];

(async () => {
  // --- 1. resolve : colonne par colonne ----------------------------------------------------------------------------------------------------------------
  {
    const en = CN.resolve(['id', 'TableId', 'ConfigJSON', ...EN]);
    for (const key of CN.KEYS) assert.ok(en[key].present && !en[key].both, key);
    same(CN.KEYS.map((k) => en[k].write), EN, 'document anglais : on écrit en anglais');

    const fr = CN.resolve(['TableId', 'ConfigJSON', ...FR]);
    same(CN.KEYS.map((k) => fr[k].write), FR, 'document d\'avant : on écrit SOUS LES NOMS QU\'IL A, jamais ceux qu\'il n\'a pas');
    same(CN.KEYS.map((k) => fr[k].present), [true, true, true, true]);

    const both = CN.resolve(['TableId', 'ConfigJSON', ...EN, ...FR]);
    same(both.name.ids, ['Name', 'Nom'], 'les deux jeux : le nouveau d\'abord');
    assert.ok(CN.KEYS.every((k) => both[k].both && both[k].write === CN.NAMES[k][0]), 'les deux jeux : on écrit en anglais');

    const mixed = CN.resolve(['TableId', 'ConfigJSON', 'Nom', 'ReportType', 'DateModif']);
    same([mixed.name.write, mixed.reportType.write, mixed.modifiedAt.write], ['Nom', 'ReportType', 'DateModif'], 'noms mêlés : chaque colonne garde le sien');
    assert.strictEqual(mixed.modifiedBy.present, false, 'aucun des deux noms : colonne à créer');
    assert.strictEqual(mixed.modifiedBy.write, 'ModifiedBy', 'une colonne à créer prend son nom anglais');

    const upper = CN.resolve(['NOM', 'typerapport']);
    assert.ok(upper.name.present && upper.reportType.present, 'Grist ne distingue pas les capitales');
    assert.strictEqual(upper.name.write, 'NOM', 'on écrit avec la casse que le document a');

    assert.ok(!CN.resolve(null).name.present && !CN.resolve(undefined).modifiedAt.present, 'entrée absente : rien de présent, jamais d\'exception');
    console.log('OK noms — résolution colonne par colonne : anglais, d\'avant, les deux, mêlés, capitales, absent');
  }

  // --- 2. cell / values / fieldsFor --------------------------------------------------------------------------------------------------------------------
  {
    const table = { id: [1, 2, 3, 4], Name: ['A', '', null, ''], Nom: ['ancien A', 'B', 'C', ''] };
    const cols = CN.resolve(Object.keys(table).filter((k) => k !== 'id'));
    same([0, 1, 2, 3].map((i) => CN.cell(table, cols, 'name', i)), ['A', 'B', 'C', ''], 'le premier nom NON VIDE, le nouveau d\'abord ; vide = chaîne vide');
    same(CN.values(table, cols, 'name'), ['A', 'B', 'C'], 'values : les deux jeux réunis, sans les vides');
    assert.strictEqual(CN.cell(table, cols, 'modifiedBy', 0), '', 'colonne absente : vide, jamais d\'exception');
    assert.strictEqual(CN.cell({ id: [1], ModifiedAt: [0] }, CN.resolve(['ModifiedAt']), 'modifiedAt', 0), 0, 'un zéro n\'est pas une cellule vide');
    assert.strictEqual(CN.cell(null, cols, 'name', 0), '', 'table absente');

    const fields = CN.fieldsFor(CN.resolve(['TableId', 'ConfigJSON', ...FR]), { ConfigJSON: '{}', modifiedAt: 5, modifiedBy: undefined, name: 'R' });
    same(fields, { ConfigJSON: '{}', DateModif: 5, Nom: 'R' }, 'les champs logiques sortent sous les noms du document, une valeur indéfinie est omise');
    same(CN.fieldsFor(CN.resolve(['ModifiedAt']), { TableId: 'T', modifiedAt: 1 }), { TableId: 'T', ModifiedAt: 1 }, 'TableId/ConfigJSON passent tels quels');
    console.log('OK noms — lecture réunie (premier nom non vide), valeurs, champs d\'écriture');
  }

  // --- 3. renamePlan : le lot de la fenêtre commune ------------------------------------------------------------------------------------------------------
  {
    const schemaOf = (columns, extra) => ({ tables: Object.assign({ Ventes: ['Montant', 'Region'], BI_Dashboard_Config: ['TableId', 'ConfigJSON', ...columns] }, extra) });
    same(CN.renamePlan(schemaOf(FR)), [
      ['RenameColumn', 'BI_Dashboard_Config', 'Nom', 'Name'], ['RenameColumn', 'BI_Dashboard_Config', 'TypeRapport', 'ReportType'],
      ['RenameColumn', 'BI_Dashboard_Config', 'DateModif', 'ModifiedAt'], ['RenameColumn', 'BI_Dashboard_Config', 'ModifiePar', 'ModifiedBy']
    ], 'document d\'avant : quatre RenameColumn, sur la table de l\'app SEULEMENT');
    same(CN.renamePlan(schemaOf(EN)), [], 'document déjà en anglais : rien à faire (la fenêtre ne s\'ouvre pas)');
    same(CN.renamePlan(schemaOf(['Nom', 'ReportType', 'DateModif'])), [
      ['RenameColumn', 'BI_Dashboard_Config', 'Nom', 'Name'], ['RenameColumn', 'BI_Dashboard_Config', 'DateModif', 'ModifiedAt']
    ], 'noms mêlés (un autre onglet est passé à moitié) : seulement ce qui reste');
    same(CN.renamePlan(schemaOf([...EN, ...FR])), [], 'les deux jeux : JAMAIS renommé (Grist ajouterait « 2 » au nom pris), c\'est « Réunir »');
    same(CN.renamePlan(schemaOf(['Nom', 'Name', 'TypeRapport', 'DateModif'])), [
      ['RenameColumn', 'BI_Dashboard_Config', 'TypeRapport', 'ReportType'], ['RenameColumn', 'BI_Dashboard_Config', 'DateModif', 'ModifiedAt']
    ], 'une colonne qui porte les deux noms est laissée, les autres se renomment');
    same(CN.renamePlan({ tables: { Ventes: ['Montant'] } }), [], 'table de l\'app absente : rien');
    same(CN.renamePlan({ tables: { bi_dashboard_config: ['nom'] } }), [['RenameColumn', 'bi_dashboard_config', 'nom', 'Name']], 'la casse du document est celle des actions');
    same(CN.renamePlan(null), []); same(CN.renamePlan({}), []);
    // Ne touche JAMAIS aux tables de la personne : même une table qui a une colonne « Nom » reste intacte.
    same(CN.renamePlan(schemaOf(EN, { Clients: ['Nom', 'Prenom'], BI_Dashboard_Comments: ['TableId', 'Text'] })), [], 'une colonne « Nom » d\'une table de la personne n\'est pas la nôtre');
    same(CN.bothSets(schemaOf([...EN, ...FR])), CN.KEYS, 'bothSets : les quatre colonnes');
    same(CN.bothSets(schemaOf(FR)), [], 'bothSets : un seul jeu');
    console.log('OK noms — lot de la fenêtre : quatre renommages, jamais un nom pris, jamais une table de la personne, noms mêlés, capitales');
  }

  // --- 4. mergePlan : « Réunir » ------------------------------------------------------------------------------------------------------------------------
  {
    const table = {
      id: [10, 11, 12, 13], TableId: ['A', 'B', 'C', 'D'],
      Name: ['Rapport A', '', '', 'Rapport D'], Nom: ['ancien A', 'Rapport B', '', 'ancien D'],
      ReportType: ['rapport', '', '', ''], TypeRapport: ['rapport', 'rapport', '', 'rapport']
    };
    same(CN.mergePlan(table), [
      ['BulkUpdateRecord', 'BI_Dashboard_Config', [11], { Name: ['Rapport B'] }],
      ['BulkUpdateRecord', 'BI_Dashboard_Config', [11, 13], { ReportType: ['rapport', 'rapport'] }]
    ], 'copie l\'ancien dans le nouveau SEULEMENT là où le nouveau est vide ; ne touche jamais une cellule remplie, ni une ligne sans ancienne valeur');
    same(CN.mergePlan({ id: [1], Name: ['x'], Nom: ['x'] }), [], 'rien à copier');
    same(CN.mergePlan({ id: [1], Nom: ['x'] }), [], 'un seul jeu : jamais de copie (c\'est la fenêtre qui renomme)');
    console.log('OK noms — « Réunir » : copie seulement dans le vide, jamais d\'écrasement, jamais d\'effet sur un seul jeu');
  }

  // --- 5. isNameError ------------------------------------------------------------------------------------------------------------------------------------
  {
    for (const text of ["[Sandbox] KeyError 'Nom'", 'Table not found "BI_Dashboard_Config"', 'Invalid column "DateModif"', 'colonne introuvable : Nom', 'table introuvable'])
      assert.ok(CN.isNameError(new Error(text)) && CN.isNameError(text), text);
    for (const text of ['GFS_REFUSE : renommage refusé', 'Blocked by table access rules', 'NetworkError', 'timeout', '', null, undefined])
      assert.ok(!CN.isNameError(text && new Error(text)) && !CN.isNameError(text), `pas un nom disparu : ${text}`);
    console.log('OK noms — une écriture refusée parce qu\'un nom a disparu se reconnaît ; un refus de droits ou un réseau coupé, non');
  }

  // --- 6. Le vrai js/grist-api.js sur un faux document ---------------------------------------------------------------------------------------------------
  const makeApi = (names, actions) => loadApiWithFakeConfigTable(data, i18n, actions, names);
  const seed = (cfg, nameKey, rows) => rows.forEach((row) => {
    cfg.id.push(cfg.id.length + 1);
    Object.keys(cfg).filter((k) => k !== 'id').forEach((k) => cfg[k].push(row[k] !== undefined ? row[k] : ''));
  });
  const saveArgs = (api, id) => api.saveConfig('Ventes', [{ id: 'p1', name: 'P', tiles: [] }], 'p1', [], null, id, 'moi@exemple.fr', 'standard', {});

  // 6a. document déjà en anglais
  {
    const actions = [];
    const { api, cfg } = makeApi('en', actions);
    const rowId = await saveArgs(api, 'new');
    assert.strictEqual(rowId, 1);
    assert.ok(cfg.Name[0] && cfg.ReportType[0] === 'rapport' && cfg.ModifiedAt[0] > 0 && cfg.ModifiedBy[0] === 'moi@exemple.fr', 'écrit sous les noms anglais');
    assert.ok(FR.every((k) => !(k in cfg)), 'aucune colonne française créée');
    const loaded = await api.loadConfigById(1);
    assert.strictEqual(loaded.name, cfg.Name[0]);
    assert.strictEqual(loaded.tableId, 'Ventes');
    console.log('OK api — document anglais : écrit et relu en anglais, aucune colonne française');
  }

  // 6b. document d'AVANT la consigne : lu et écrit sous ses noms, rien d'anglais ajouté à côté
  {
    const actions = [];
    const { api, cfg } = makeApi('fr', actions);
    seed(cfg, 'Nom', [{ TableId: 'Ventes', ConfigJSON: '{"pages":[{"id":"p1","name":"Vieille","tiles":[]}],"currentPageId":"p1"}', Nom: 'Mon rapport', TypeRapport: 'rapport', DateModif: 1, ModifiePar: 'a@b.fr' }]);
    const loaded = await api.loadConfigById(1);
    assert.strictEqual(loaded.name, 'Mon rapport', 'le nom se lit dans `Nom`');
    assert.strictEqual(loaded.config.pages[0].name, 'Vieille');
    const config = await api.loadConfig('Ventes');
    assert.strictEqual(config.pages[0].name, 'Vieille', 'loadConfig lit aussi la ligne d\'avant');
    await saveArgs(api, 1);
    assert.ok(cfg.DateModif[0] > 1 && cfg.ModifiePar[0] === 'moi@exemple.fr', 'écrit dans DateModif et ModifiePar, ceux que le document a');
    assert.ok(EN.every((k) => !(k in cfg)), 'AUCUNE colonne anglaise n\'apparaît à côté des françaises (sinon la fenêtre refuserait de renommer)');
    assert.ok(!actions.some((a) => a[0] === 'AddColumn' || a[0] === 'AddTable'), 'aucune création de colonne ni de table');
    // un rapport neuf : le nom proposé évite ceux que portent déjà les lignes (colonne `Nom`)
    const newId = await saveArgs(api, 'new');
    assert.strictEqual(newId, 2);
    assert.ok(cfg.Nom[1] && cfg.Nom[1] !== 'Mon rapport' && cfg.TypeRapport[1] === 'rapport', 'le rapport neuf est nommé dans `Nom`');
    // un type inconnu n'est ni ouvert ni réécrit, sous l'ancien nom aussi
    cfg.TypeRapport[0] = 'formulaire';
    assert.strictEqual(await api.loadConfigById(1), null, 'ReportType inconnu : jamais ouvert');
    console.log('OK api — document d\'avant : lu et écrit sous Nom/TypeRapport/DateModif/ModifiePar, rien d\'anglais ajouté, type inconnu refusé');
  }

  // 6c. noms mêlés : on ne crée que la colonne qui manque tout à fait, en anglais
  {
    const actions = [];
    const { api, cfg } = makeApi({ id: [], TableId: [], ConfigJSON: [], Nom: [], TypeRapport: [], DateModif: [] }, actions);
    await saveArgs(api, 'new');
    assert.deepStrictEqual(actions.filter((a) => a[0] === 'AddColumn').map((a) => a[2]), ['ModifiedBy'], 'seule la colonne qui manque est ajoutée, sous son nom anglais');
    assert.ok(cfg.Nom[0] && cfg.ModifiedBy[0] === 'moi@exemple.fr' && cfg.DateModif[0] > 0);
    assert.ok(!('Name' in cfg) && !('ModifiedAt' in cfg), 'ni Name ni ModifiedAt à côté de Nom et DateModif');
    console.log('OK api — noms mêlés : seule la colonne absente est ajoutée (en anglais)');
  }

  // 6d. les deux jeux : lu réuni, écrit en anglais, « Réunir » copie dans le vide seulement
  {
    const actions = [];
    const { api, cfg } = makeApi('both', actions);
    seed(cfg, 'Name', [
      { TableId: 'Ventes', ConfigJSON: '{}', Name: '', Nom: 'Nom d\'avant', TypeRapport: 'rapport', ReportType: '' },
      { TableId: 'Achats', ConfigJSON: '{}', Name: 'Nom neuf', Nom: 'autre', ReportType: 'rapport', TypeRapport: 'rapport' }
    ]);
    const first = await api.loadConfigById(1);
    assert.strictEqual(first.name, 'Nom d\'avant', 'les deux jeux : la valeur de l\'ancien nom se lit quand le nouveau est vide');
    assert.strictEqual((await api.loadConfigById(2)).name, 'Nom neuf', 'le nouveau gagne quand il est rempli');
    await saveArgs(api, 1);
    assert.ok(cfg.ModifiedAt[0] > 0 && !cfg.DateModif[0], 'écrit en anglais, l\'ancienne colonne n\'est pas touchée');
    const status = await api.configNamesStatus();
    assert.deepStrictEqual(Array.from(status.both), ['name', 'reportType', 'modifiedAt', 'modifiedBy']);
    assert.strictEqual(status.cells, 2, 'Name de la ligne 1 et ReportType de la ligne 1 sont vides côté nouveau');
    const merged = await api.mergeConfigNames();
    assert.strictEqual(merged.cells, status.cells);
    assert.ok(cfg.Name[0] === 'Nom d\'avant' && cfg.ReportType[0] === 'rapport', 'copié dans le vide');
    assert.ok(cfg.Name[1] === 'Nom neuf' && cfg.Nom[1] === 'autre', 'une cellule déjà remplie n\'est JAMAIS écrasée, l\'ancienne colonne reste');
    assert.strictEqual((await api.configNamesStatus()).cells, 0, 'après « Réunir », plus rien à proposer');
    assert.ok(!actions.some((a) => a[0] === 'RenameColumn'), 'jamais un renommage ici');
    console.log('OK api — les deux jeux : lu réuni, écrit en anglais, « Réunir » copie dans le vide sans rien écraser ni supprimer');
  }

  // 6e. un renommage venu d'un autre onglet pendant la session : relire les noms et recommencer UNE fois
  {
    const actions = [];
    const { api, cfg, renameColumn } = makeApi('fr', actions);
    seed(cfg, 'Nom', [{ TableId: 'Ventes', ConfigJSON: '{}', Nom: 'R', TypeRapport: 'rapport' }]);
    await api.loadConfigById(1); // la page lit les noms d'avant ; la ligne est « nommée » : la prochaine sauvegarde est directe
    await saveArgs(api, 1);
    FR.forEach((fr, i) => renameColumn(fr, EN[i])); // l'autre onglet renomme
    const before = actions.length;
    await saveArgs(api, 1); // `DateModif` n'existe plus : rattrapé
    assert.ok(cfg.ModifiedAt[0] > 0 && cfg.ModifiedBy[0] === 'moi@exemple.fr', 'la sauvegarde a abouti sous les nouveaux noms');
    assert.strictEqual(actions.length - before, 2, 'un essai refusé, puis UN seul nouvel essai');
    // une seconde disparition (la colonne n'existe plus du tout) : l'erreur remonte, rien d'autre n'est écrit
    delete cfg.ModifiedAt;
    delete cfg.DateModif;
    const writes = actions.length;
    let failure = null;
    try { await saveArgs(api, 1); } catch (e) { failure = e; }
    assert.ok(failure && api.isNameError(failure), 'après un seul nouvel essai, l\'erreur remonte (« Rechargez la page »)');
    assert.strictEqual(actions.length - writes, 2, 'jamais plus de deux essais');
    console.log('OK api — un renommage d\'un autre onglet est rattrapé une fois (relire les noms, recommencer), pas deux');
  }

  // 6f. un document neuf : la table naît avec les noms anglais
  {
    const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; }, URL, location: { href: 'https://exemple.test/widget/index.html' } };
    sandbox.window = sandbox;
    vm.runInNewContext(read('dev-tests', 'grist-stub.js'), sandbox);
    sandbox.GristBI = { data, i18n, state: { DEFAULT_PAGE_ID: 'page_default' }, configNames: CN };
    vm.runInNewContext(read('js', 'grist-api.js'), sandbox);
    const api = sandbox.GristBI.api;
    await api.saveConfig('Ventes', [{ id: 'p1', name: 'P', tiles: [] }], 'p1', [], null, 'new', null, 'standard', {});
    const table = await sandbox.grist.docApi.fetchTable('BI_Dashboard_Config');
    assert.deepStrictEqual(Array.from(Object.keys(table)).filter((k) => k !== 'id' && k !== 'manualSort'), ['TableId', 'ConfigJSON', ...EN], 'la table neuve a les noms anglais, aucun français');
    assert.ok(table.Name[0] && table.ReportType[0] === 'rapport');
    console.log('OK api — document neuf : BI_Dashboard_Config naît avec Name/ReportType/ModifiedAt/ModifiedBy');
  }

  // --- 7. Garde-fou des sources --------------------------------------------------------------------------------------------------------------------------
  {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    const code = strip(read('js', 'grist-api.js'));
    for (const old of FR) assert.ok(!new RegExp(`['"\`.]${old}\\b|\\b${old}:`).test(code), `js/grist-api.js ne nomme plus ${old} (tout passe par js/config-names.js)`);
    for (const html of ['index.html', 'dev-tests/harness.html']) {
      const text = require('fs').readFileSync(require('path').join(__dirname, '..', html), 'utf8');
      const prefix = html.startsWith('dev-tests') ? '../' : '';
      const a = text.indexOf(`<script src="${prefix}js/config-names.js">`);
      const b = text.indexOf(`<script src="${prefix}js/grist-api.js">`);
      assert.ok(a > 0 && b > a, `${html} : js/config-names.js se charge avant js/grist-api.js`);
    }
    assert.ok(!/RenameTable|RemoveColumn|RemoveTable/.test(strip(read('js', 'config-names.js'))), 'config-names.js ne détruit ni ne renomme de table');
    console.log('OK noms — sources : plus aucun nom français dans le code de grist-api.js, config-names.js chargé avant lui (index.html et harnais)');
  }

  console.log('\nTous les essais des deux jeux de noms de BI_Dashboard_Config sont passés.');
})().catch((error) => { console.error(error); process.exit(1); });
