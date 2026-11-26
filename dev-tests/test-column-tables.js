/*
 * « Que faire avec cette colonne ? » choisit sa table (js/advice-column.js `opts.table` + son branchement dans le panneau, lot 3C du chantier
 * « Colonnes de toutes les tables », 26/11/2026) :
 *
 *   node dev-tests/test-column-tables.js
 *
 * Quatre sortes d'essais :
 *  1. LE CALCUL (`describe` avec `table`) : la table de travail garde ses propositions à l'identique (aucun champ `table`), une autre table rend des
 *     propositions qui portent `table` et `tileData.table`, jamais les types Grist de la table de travail (une colonne `Client` y est une Référence :
 *     dans une autre table, ses valeurs en jugent), une valeur de `table` qui n'est pas un nom est ignorée, les tuiles passées ne sont pas modifiées ;
 *  2. VERSIONS FAUTIVES du calcul : chaque erreur plausible de `js/advice-column.js` est vue par ces vérifications ;
 *  3. LE CÂBLAGE du panneau (boutons de table, lecture silencieuse, choix oublié, tuiles de la table choisie seulement, aperçu avec SES lignes,
 *     phrases fr/en) lu dans les sources ;
 *  4. VERSIONS FAUTIVES du câblage : chacune des erreurs plausibles de `js/main-panel.js`, `js/main-session.js` et `js/main-fields.js` est vue.
 * Le geste réel (un clic sur le bouton de table, les colonnes de l'autre table, un clic réel sur « Ajouter ») se joue dans Chromium :
 * `dev-tests/test-browser.js`, scénarios « une autre table pour « Que faire avec cette colonne ? » ».
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const advice = require('../js/advice.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ok = (cond, msg) => assert.ok(cond, msg);

// Charge un module du dépôt, éventuellement avec son texte transformé (versions fautives).
function loadModule(file, transform) {
  const full = path.join(ROOT, 'js', file);
  const source = transform ? transform(fs.readFileSync(full, 'utf8')) : fs.readFileSync(full, 'utf8');
  const m = new Module(full, null);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(source, full);
  return m.exports;
}

const tables = corpus.build();
const commandes = tables.find((t) => t.name === 'commandes'); // `Client` est une colonne Référence (`Ref:Clients`) dans son registre de types

// Une autre table fabriquée : une colonne `Client` de TEXTE (12 noms) et un montant.
const NAMES = ['Alma', 'Brice', 'Chloé', 'Dario', 'Elsa', 'Farid', 'Gaëlle', 'Hugo', 'Inès', 'Jules', 'Kim', 'Lola'];
const otherRows = [];
for (let i = 0; i < 120; i++) otherRows.push({ id: i + 1, Client: NAMES[i % NAMES.length], Montant: 20 + (i % 9) * 11 + (i % 4) });

// ---------------------------------------------------------------------------------------------------------------------
// 1 et 2. LE CALCUL, rejoué sur chaque version fautive de js/advice-column.js
// ---------------------------------------------------------------------------------------------------------------------
function describeChecks(columnApi) {
  advice.setColumnInfo(commandes.info);
  const base = { lang: 'fr', limit: 3 };

  // La table de travail : aucun champ `table`, nulle part (comme avant le lot 3C).
  const working = columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info }, base));
  ok(working.ok && working.items.length > 0, 'la colonne Montant a des propositions');
  ok(working.items.every((item) => !('table' in item) && !('table' in item.tileData)), 'la table de travail : aucune proposition ne porte `table`');
  ok(columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info, table: '' }, base)).items.every((item) => !('table' in item)), 'table vide = la table de travail');

  // Une autre table : mêmes propositions, marquées de la table (aussi dans la tuile qu'un clic posera).
  const other = columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info, table: 'Commandes' }, base));
  ok(other.ok && other.items.length === working.items.length, 'même nombre de propositions');
  ok(other.items.every((item, i) => item.table === 'Commandes' && item.tileData.table === 'Commandes'
    && item.type === working.items[i].type && item.tileData.dimension === working.items[i].tileData.dimension && item.tileData.measure === working.items[i].tileData.measure),
  'une autre table : chaque proposition porte `table` et `tileData.table`, le reste ne change pas');
  ok(other.items.every((item) => Object.keys(item.tileData).every((k) => k !== 'id')), 'la tuile n\'a pas d\'identifiant : l\'appelant le pose');

  // Les types Grist de la table de travail ne sont jamais prêtés à une autre : dans le registre, `Client` est une Référence (un numéro de ligne) ;
  // dans une autre table de même colonne `Client`, ce sont des noms (une catégorie).
  const asWorking = columnApi.describe(otherRows, [], 'Client', { lang: 'fr' });
  ok(asWorking.ok && asWorking.role === 'reference', 'sans `table`, le registre de la table de travail s\'applique (le contrôle est sensible)');
  const asOther = columnApi.describe(otherRows, [], 'Client', { lang: 'fr', table: 'Autre' });
  ok(asOther.ok && asOther.role === 'category', 'une autre table ne reprend pas le registre de la table de travail : ses valeurs en jugent (' + asOther.role + ')');
  const ownInfo = columnApi.describe(otherRows, [], 'Client', { lang: 'fr', table: 'Autre', columnInfo: { Client: { type: 'Ref:Clients' } } });
  ok(ownInfo.ok && ownInfo.role === 'reference', 'les types Grist de SA table sont pris en compte');

  // Une valeur de `table` qui n'est pas un nom : la table de travail.
  [5, null, undefined, {}, [], true].forEach((bad) => {
    const res = columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info, table: bad }, base));
    ok(res.items.every((item) => !('table' in item) && !('table' in item.tileData)), `table = ${JSON.stringify(bad)} : la table de travail`);
  });
  // Un nom hostile reste une simple valeur (pas de pollution du prototype).
  const hostile = columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info, table: '__proto__' }, base));
  ok(hostile.items.every((item) => Object.prototype.hasOwnProperty.call(item.tileData, 'table') && item.tileData.table === '__proto__'), 'un nom hostile est une valeur');
  ok(({}).table === undefined && ({}).dimension === undefined, 'le prototype des objets n\'a pas bougé');

  // Les tuiles passées ne bougent pas, et seules elles comptent (celles des autres tables n'y sont pas : l'appelant les retire).
  const tile = Object.freeze({ id: 't1', type: 'bar', dimension: 'Statut', measure: 'Montant', aggFn: 'sum', table: 'Commandes' });
  const used = columnApi.describe(commandes.rows, [tile], 'Montant', Object.assign({ columnInfo: commandes.info, table: 'Commandes' }, base));
  ok(used.ok && used.usedBy === 1, 'une tuile posée sur cette table la lit déjà : ' + used.usedBy);
  const unused = columnApi.describe(commandes.rows, [], 'Montant', Object.assign({ columnInfo: commandes.info, table: 'Commandes' }, base));
  ok(unused.usedBy === 0, 'sans tuile, personne ne la lit');

  // Une colonne qui n'existe pas dans CETTE table : rien (jamais la colonne de la table de travail).
  const missing = columnApi.describe(otherRows, [], 'Statut', { lang: 'fr', table: 'Autre' });
  ok(missing.ok === false && missing.reason === 'column', 'colonne inconnue de cette table');
  ok(columnApi.describe([], [], 'Montant', { lang: 'fr', table: 'Autre' }).ok === false, 'table sans ligne : rien');
}

describeChecks(loadModule('advice-column.js'));
console.log('OK le calcul — table de travail inchangée, autre table marquée (`table` et `tileData.table`), registre jamais prêté, valeurs hostiles, tuiles intactes');

const columnSource = read('js/advice-column.js');
const columnMutants = [
  ['une valeur qui n\'est pas un nom marque quand même', 'const other = text(o.table);', 'const other = o.table;'],
  ['la tuile posée ne porte pas la table', 'Object.assign({}, item.tileData, { table: other })', 'item.tileData'],
  ['la proposition ne porte pas la table', 'Object.assign({}, item, { table: other,', 'Object.assign({}, item, { tab: other,'],
  ['le registre de la table de travail prêté à une autre table', 'const columnInfo = other ? (o.columnInfo || {}) : o.columnInfo;', 'const columnInfo = o.columnInfo;'],
  ['la table de travail marquée aussi', 'const items = other\n      ?', 'const items = true\n      ?'],
  ['les types propres à la table ignorés', 'const columnInfo = other ? (o.columnInfo || {}) : o.columnInfo;', 'const columnInfo = other ? {} : o.columnInfo;'],
  ['le profil lu sans les types', 'advice.profileColumns(rows, undefined, columnInfo)', 'advice.profileColumns(rows, undefined, undefined)']
];
let seen = 0;
columnMutants.forEach(([label, from, to]) => {
  assert.ok(columnSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/advice-column.js`);
  let caught = false;
  try { describeChecks(loadModule('advice-column.js', (src) => src.replace(from, to))); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  seen += 1;
});
console.log(`OK versions fautives du calcul — ${seen} versions de js/advice-column.js vues par les vérifications`);

// ---------------------------------------------------------------------------------------------------------------------
// 3 et 4. LE CÂBLAGE, rejoué sur chaque version fautive du panneau, de la session et des champs
// ---------------------------------------------------------------------------------------------------------------------
function wiringChecks(src) {
  const { panel, session, fields, html, harness } = src;

  // Les boutons de table : au moins deux tables, une seule fois reconstruits, `aria-pressed`, le choix par défaut est la table de travail.
  ok(/function renderColumnTables\(\)/.test(panel) && /columnTableField\.hidden = !GristBI\.adviceTables \|\| columnTableNames\.length < 2/.test(panel), 'les boutons de table se montrent avec au moins deux tables');
  ok(/const current = S\.columnTable \|\| workingTableOf\(store\.getState\(\)\)/.test(panel), 'la table de travail est le choix par défaut');
  ok(/if \(key !== columnTablesShown\) \{/.test(panel) && /btn\.setAttribute\('aria-pressed'/.test(panel), 'les boutons ne sont reconstruits que si la liste des tables change : le focus reste sur le bouton cliqué');
  ok(/columnTablesEl\.addEventListener\('click'/.test(panel) && /chooseColumnTable\(btn\.dataset\.table\)/.test(panel), 'un clic sur un bouton choisit la table');
  ok(/class="filter-table-btn" data-table="\$\{escapeHtml\(name\)\}"/.test(panel), 'le nom de la table est échappé');

  // Choisir une table : champ et résultats vidés, colonnes de CETTE table (lue en silence, 8 s au plus), le dernier choix compte.
  const choose = panel.slice(panel.indexOf('async function chooseColumnTable('), panel.indexOf('function resetColumnTable('));
  ok(/const next = table && table !== store\.getState\(\)\.workingTable \? table : ''/.test(choose) && /if \(next === S\.columnTable\) return;/.test(choose), 'la table de travail = aucun choix ; un même choix ne refait rien');
  ok(/columnPickEl\.value = '';\s*hideColumnResults\(\);\s*renderColumnTables\(\);/.test(choose), 'changer de table vide le champ et retire les résultats (ils parlaient d\'une autre table)');
  ok(/readWithin\(suggestionTable\(next\), SUGGESTION_READ_TIMEOUT_MS\)/.test(choose), 'lecture silencieuse, 8 s au plus (jamais `setTableRows`)');
  ok(!/setTableRows|ensureTableRows/.test(choose), 'la lecture ne passe pas par le store (elle redessinerait toutes les tuiles)');
  ok(/if \(token !== columnTableToken \|\| S\.columnTable !== next\) return;/.test(choose), 'une lecture revenue trop tard (autre clic, panneau fermé) n\'écrit rien');
  ok(/const ok = Array\.isArray\(read\.rows\) && read\.rows\.length > 0;/.test(choose) && /columnTableStatus = !Array\.isArray\(read\.rows\) \? 'failed' : \(ok \? 'ready' : 'empty'\)/.test(choose), 'illisible, vide et lisible se distinguent');
  ok(/S\.columnTableRows = ok \? read\.rows : null;/.test(choose) && /S\.columnTableInfo = read\.columnInfo \|\| \{\}/.test(choose), 'les lignes et les types Grist de SA table');
  ok(/failed: 'tilePanel\.column\.tableFailed'/.test(panel) && /empty: 'tilePanel\.column\.tableEmpty'/.test(panel) && /loading: 'tilePanel\.column\.tableLoading'/.test(panel), 'la phrase dit la lecture, l\'échec, le vide');
  const refresh = panel.slice(panel.indexOf('function refreshColumnPick('), panel.indexOf('async function chooseColumnTable('));
  ok(/pickableColumns\(availableColumns\(rows\)\)/.test(refresh) && /: \[\], \{ keepEmpty: true \}\)/.test(refresh), 'les colonnes de l\'autre table (sans jointure), aucune tant qu\'elle n\'est pas lue, le champ reste vide (aucune colonne choisie d\'office)');
  ok(/parts\.fillColumnPick\(store\.getState\(\)\.rows\)/.test(refresh), 'la table de travail retrouve sa liste (avec les tables liées)');

  // Le contexte : les lignes, les types Grist et les tuiles de la table choisie SEULEMENT.
  const context = panel.slice(panel.indexOf('function columnContext('), panel.indexOf('function updateColumnTableNote'));
  ok(/tiles: tilesOfWorkingTable\(state\)/.test(context), 'la table de travail : ses tuiles');
  ok(/rows: S\.columnTableRows, info: S\.columnTableInfo/.test(context), 'une autre table : SES lignes et SES types');
  ok(/adviceTables\.tilesOf\(tilesOfAllPages\(state\), table, false\)/.test(context), 'une autre table : les tuiles posées sur elle seulement (toutes pages)');
  const helper = panel.slice(panel.indexOf('function renderColumnHelper('), panel.indexOf('columnPickEl.addEventListener(\'change\''));
  ok(/describe\(ctx\.rows, ctx\.tiles, column, \{ t, lang, limit: 3, table: ctx\.table, columnInfo: ctx\.info \}\)/.test(helper), 'le calcul reçoit la table et ses types');
  ok(/fillCards\(columnListEl, result\.items, ctx\.rows, lang, 'data-column-add'\)/.test(helper), 'l\'aperçu des cartes est dessiné avec les lignes de la table choisie');
  ok(/!ctx\.rows \|\| !ctx\.rows\.length/.test(helper), 'une table illisible ou vide ne calcule rien');
  ok(/columnShown = \{ column, table: ctx\.table, rows: ctx\.rows, lang, tiles: ctx\.tiles \}/.test(helper), 'ce que les résultats ont lu comprend la table');
  const fresh = panel.slice(panel.indexOf('function columnResultsAreFresh('), panel.indexOf('S.columnTable = \'\';'));
  ok(/columnShown\.table === ctx\.table && columnShown\.rows === ctx\.rows/.test(fresh) && /sameRefs\(columnShown\.tiles, ctx\.tiles\)/.test(fresh), 'un `change` qui ne change rien ne refait rien, même d\'une table à l\'autre');

  // Un clic sur « Ajouter » pose la tuile telle que le calcul la rend : elle porte `table`, la table est lue à la demande par `render()`.
  ok(/store\.addTile\(Object\.assign\(\{ id \}, item\.tileData\)\)/.test(panel), 'la tuile posée est celle de la proposition (avec sa table)');

  // Le choix est oublié : ouverture et fermeture du panneau, changement de table de travail, rechargement des données.
  const reset = panel.slice(panel.indexOf('function resetColumnTable('), panel.indexOf('function hideColumnResults'));
  ok(/columnTableToken\+\+;/.test(reset) && /S\.columnTable = '';/.test(reset) && /S\.columnTableRows = null;/.test(reset), 'une lecture en cours devient périmée, les lignes sont oubliées');
  ok(/if \(had\) \{ columnPickEl\.value = ''; hideColumnResults\(\); parts\.fillColumnPick\(store\.getState\(\)\.rows\); \}/.test(reset), 'le champ, les résultats et la liste de la table de travail sont rendus');
  ok(/refreshTableField\(\);\s*resetColumnTable\(\);\s*loadColumnTables\(\);/.test(panel), 'ouverture du panneau : la table de travail, la liste des tables relue');
  ok(/tilePanel\.hidden = true;\s*hideLinkNote\(\);\s*resetColumnTable\(\);/.test(panel), 'fermeture du panneau : le choix est oublié');
  ok(/S\.formTable = ''; S\.filterTable = ''; resetColumnTable\(\); store\.setWorkingTable\(tableId\);/.test(session), 'un changement de table de travail oublie le choix');
  ok(/suggestionTables\.clear\(\);\s*resetColumnTable\(\);/.test(session), 'un rechargement des données oublie le choix (les lignes lues sont périmées)');
  ok(/render, renderConnectionStatus, resetColumnTable,/.test(session) && /renderColumnHelper, resetColumnTable, schedulePreview/.test(panel), 'la fonction est partagée entre fichiers');

  // La liste de la table de travail ne touche pas au champ quand une autre table est choisie.
  ok(/function fillColumnPick\(rows, cols, choices\) \{\s*if \(S\.columnTable\) return;/.test(fields), 'les lignes de la table de travail n\'écrasent pas les colonnes de l\'autre table');
  ok(/fillColumnPick\(rows, cols, choices\);/.test(fields) && /fillColumnPick, numericColumns/.test(fields), 'refreshColumnSelects et le panneau partagent la liste');
  ok(/pickableColumns\(cols\)/.test(fields) && /columnHelperRows !== rows/.test(fields), 'la liste de la table de travail est celle d\'avant (colonnes sans les dérivées d\'une date, choix périmé vidé)');

  // Le balisage (index.html et harnais) et les textes.
  [[html, 'index'], [harness, 'harness']].forEach(([text, name]) => {
    ok(/id="tile-column-table-field" class="filter-table-field" hidden/.test(text), `${name} : le bloc de table est caché au départ`);
    ok(/id="tile-column-tables" class="filter-tables" role="group" aria-labelledby="tile-column-table-label"/.test(text), `${name} : les boutons forment un groupe étiqueté`);
    ok(/id="tile-column-table-note" class="tile-advice tile-link-note" role="status" aria-live="polite" hidden/.test(text), `${name} : la phrase est annoncée`);
    ok(text.indexOf('id="tile-column-table-field"') < text.indexOf('id="tile-column-pick"'), `${name} : la table se choisit avant la colonne`);
    ok(/data-i18n="tilePanel\.column\.table"/.test(text), `${name} : l'intitulé est traduit`);
  });
  ['tilePanel.column.table', 'tilePanel.column.tableLoading', 'tilePanel.column.tableScope', 'tilePanel.column.tableFailed', 'tilePanel.column.tableEmpty'].forEach((key) => {
    const entry = i18n.STRINGS[key];
    ok(entry && entry.fr && entry.en, `texte fr et en : ${key}`);
    if (key !== 'tilePanel.column.table') ok(/\{table\}/.test(entry.fr) && /\{table\}/.test(entry.en), `${key} : le nom de la table est dit dans les deux langues`);
  });
}

const src = {
  panel: read('js/main-panel.js'), session: read('js/main-session.js'), fields: read('js/main-fields.js'),
  html: read('index.html'), harness: read('dev-tests/harness.html')
};
wiringChecks(src);
console.log('OK câblage — boutons de table, lecture silencieuse, tuiles de la table choisie, aperçu avec SES lignes, choix oublié, textes fr/en');

const wiringMutants = [
  ['choisir une table ne vide pas le champ', 'panel', "    columnPickEl.value = '';\n    hideColumnResults();\n    renderColumnTables();", '    renderColumnTables();'],
  ['une autre table compte les tuiles de la table de travail', 'panel', 'adviceTables.tilesOf(tilesOfAllPages(state), table, false)', 'tilesOfWorkingTable(state)'],
  ['une autre table compte toutes les tuiles', 'panel', 'adviceTables.tilesOf(tilesOfAllPages(state), table, false)', 'tilesOfAllPages(state)'],
  ['une lecture périmée est écrite', 'panel', 'if (token !== columnTableToken || S.columnTable !== next) return;', ''],
  ['la fraîcheur ignore la table', 'panel', 'columnShown.table === ctx.table && ', ''],
  ['les résultats ne disent pas la table', 'panel', 'columnShown = { column, table: ctx.table, rows: ctx.rows, lang, tiles: ctx.tiles }', 'columnShown = { column, rows: ctx.rows, lang, tiles: ctx.tiles }'],
  ['le calcul ignore la table', 'panel', 'limit: 3, table: ctx.table, columnInfo: ctx.info })', 'limit: 3 })'],
  ['le calcul prête les types de la table de travail', 'panel', 'limit: 3, table: ctx.table, columnInfo: ctx.info })', 'limit: 3, table: ctx.table })'],
  ['l\'ouverture n\'oublie pas le choix', 'panel', 'resetColumnTable();\n    loadColumnTables();', 'loadColumnTables();'],
  ['la fermeture n\'oublie pas le choix', 'panel', 'tilePanel.hidden = true;\n    hideLinkNote();\n    resetColumnTable();', 'tilePanel.hidden = true;\n    hideLinkNote();'],
  ['les boutons avec une seule table', 'panel', 'columnTableNames.length < 2', 'columnTableNames.length < 1'],
  ['la table illisible sans phrase', 'panel', "failed: 'tilePanel.column.tableFailed'", "failed: 'tilePanel.column.tableScope'"],
  ['la table vide prise pour lisible', 'panel', 'const ok = Array.isArray(read.rows) && read.rows.length > 0;', 'const ok = Array.isArray(read.rows);'],
  ['les boutons refaits à chaque choix (focus perdu)', 'panel', 'if (key !== columnTablesShown) {', 'if (true) {'],
  ['les lignes de la table de travail pour l\'autre table', 'panel', 'rows: S.columnTableRows, info: S.columnTableInfo', 'rows: state.rows, info: S.columnTableInfo'],
  ['l\'aperçu avec les lignes de la table de travail', 'panel', "fillCards(columnListEl, result.items, ctx.rows, lang, 'data-column-add')", "fillCards(columnListEl, result.items, state.rows, lang, 'data-column-add')"],
  ['la lecture passe par le store', 'panel', 'const read = await readWithin(suggestionTable(next), SUGGESTION_READ_TIMEOUT_MS);', 'await ensureTableRows(next); const read = await readWithin(suggestionTable(next), SUGGESTION_READ_TIMEOUT_MS);'],
  ['la table de travail n\'est pas le choix par défaut', 'panel', 'const current = S.columnTable || workingTableOf(store.getState());', "const current = S.columnTable || '';"],
  ['les colonnes de l\'autre table avec une jointure', 'panel', 'pickableColumns(availableColumns(rows))', 'pickableColumns(rows)'],
  ['un changement de table de travail n\'oublie pas le choix', 'session', 'S.filterTable = \'\'; resetColumnTable(); store.setWorkingTable(tableId);', 'S.filterTable = \'\'; store.setWorkingTable(tableId);'],
  ['un rechargement n\'oublie pas le choix', 'session', 'suggestionTables.clear();\n    resetColumnTable();', 'suggestionTables.clear();'],
  ['les lignes de la table de travail écrasent le champ', 'fields', 'function fillColumnPick(rows, cols, choices) {\n    if (S.columnTable) return;', 'function fillColumnPick(rows, cols, choices) {'],
  ['la table se choisit après la colonne (balisage)', 'html', 'id="tile-column-table-field" class="filter-table-field" hidden', 'id="tile-column-table-field" class="filter-table-field"']
];
let wiringSeen = 0;
wiringMutants.forEach(([label, key, from, to]) => {
  assert.ok(src[key].includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans ${key}`);
  const mutated = Object.assign({}, src, { [key]: src[key].replace(from, to) });
  let caught = false;
  try { wiringChecks(mutated); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  wiringSeen += 1;
});
console.log(`OK versions fautives du câblage — ${wiringSeen} versions vues par les vérifications`);

// Hygiène : le calcul reste pur (pas de DOM, pas de Grist, pas de texte en dur dans les nouvelles lignes).
ok(!/document\.|window\.|grist\./.test(columnSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'js/advice-column.js reste pur (ni DOM ni Grist)');
console.log('\nOK — « Que faire avec cette colonne ? » choisit sa table : tous les essais passent');
