/*
 * Table de départ (26/11/2026, retour d'un utilisateur : « je suis obligé de changer de table pour accéder aux tableaux de bord pertinents »).
 * Avant : le widget s'ouvrait toujours sur la 1re table du document. Maintenant : la dernière table ouverte, sinon la table du rapport enregistré
 * le plus récemment, sinon la 1re (`GristBI.state.pickStartTable`/`latestReportTable`, `GristBI.api.latestReportTableId`, `js/main-session.js`).
 * Lancer : node dev-tests/test-start-table.js
 * Ce qui ne se joue QUE dans un navigateur (mémoire dans `localStorage`, cadre isolé, clic dans le sélecteur de table) est dans
 * `dev-tests/test-browser.js` (« table de départ »).
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const state = require('../js/state.js');
const data = require('../js/data.js');
const i18n = require('../js/i18n.js');
const { read, loadApiWithFakeConfigTable } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(a, b, msg); };

// ---- 1. pickStartTable + latestReportTable : le jeu de vérifications, rejoué ensuite sur des versions FAUTIVES ------------------------------------
function purChecks(mod) {
  const pick = mod.pickStartTable;
  const latest = mod.latestReportTable;
  const two = ['Alpha', 'Beta', 'Gamma'];

  // La mémoire passe avant tout, si la table existe encore dans ce document.
  eq(pick({ available: two, remembered: 'Beta', latest: 'Gamma' }), 'Beta', 'mémoire valable : elle gagne sur le rapport récent');
  eq(pick({ available: two, remembered: 'Zèbre', latest: 'Gamma' }), 'Gamma', 'mémoire d\'une table inconnue (autre document, table supprimée) : ignorée');
  eq(pick({ available: two, remembered: '', latest: 'Gamma' }), 'Gamma', 'pas de mémoire : le rapport le plus récent');
  eq(pick({ available: two, remembered: '', latest: 'Zèbre' }), 'Alpha', 'rapport récent sur une table disparue : la 1re table');
  eq(pick({ available: two }), 'Alpha', 'rien du tout : la 1re table, comme avant ce réglage');
  eq(pick({ available: two, remembered: 'beta' }), 'Alpha', 'la casse compte : « beta » n\'est pas « Beta »');
  eq(pick({ available: [], remembered: 'Beta', latest: 'Beta' }), '', 'aucune table : rien (l\'appelant dit « aucune table »)');
  eq(pick({}), '', 'options vides');
  eq(pick(), '', 'sans option');
  eq(pick({ available: 'Beta', remembered: 'Beta' }), '', 'une liste qui n\'en est pas une');
  eq(pick({ available: [null, 3, '', 'Beta'], remembered: 'Beta' }), 'Beta', 'les entrées qui ne sont pas des noms de table sont écartées');
  eq(pick({ available: [null, 3, '', 'Beta'] }), 'Beta', '… y compris pour la 1re table');
  eq(pick({ available: two, remembered: 7, latest: { toString: () => 'Beta' } }), 'Alpha', 'mémoire et rapport qui ne sont pas du texte : ignorés, jamais convertis');
  eq(pick({ available: ['__proto__', 'Beta'], remembered: 'constructor' }), '__proto__', 'un nom hostile n\'ouvre rien d\'inattendu (liste, pas dictionnaire)');

  // Le rapport enregistré le plus récent, parmi les tables du document.
  const entries = [
    { table: 'Alpha', modifiedAt: 1700000000, id: 1 },
    { table: 'Beta', modifiedAt: 1700005000, id: 2 },
    { table: 'Gamma', modifiedAt: 1700009000, id: 3 }
  ];
  eq(latest(entries, two), 'Gamma', 'le plus récent');
  eq(latest(entries, ['Alpha', 'Beta']), 'Beta', 'une table absente du document ne compte pas, même la plus récente');
  eq(latest(entries, []), '', 'aucune table : aucun rapport');
  eq(latest([], two), '', 'aucun rapport');
  eq(latest(null, two), '', 'entrées nulles');
  eq(latest(entries, null), '', 'liste de tables nulle');
  eq(latest([{ table: 'Alpha', modifiedAt: 5, id: 1 }, { table: 'Beta', modifiedAt: 5, id: 2 }], two), 'Beta', 'date égale : la ligne la plus récente (numéro le plus haut)');
  eq(latest([{ table: 'Beta', modifiedAt: 5, id: 9 }, { table: 'Alpha', modifiedAt: 5, id: 2 }], two), 'Beta', 'date égale : le numéro décide, pas l\'ordre du tableau');
  eq(latest([{ table: 'Alpha', modifiedAt: 100, id: 1 }, { table: 'Beta', modifiedAt: '', id: 2 }], two), 'Alpha', 'une date vide passe derrière une date');
  eq(latest([{ table: 'Alpha', modifiedAt: '', id: 1 }, { table: 'Beta', modifiedAt: '', id: 2 }], two), 'Beta', 'aucune date : la ligne la plus récente');
  eq(latest([{ table: 'Alpha', modifiedAt: 'hier', id: 1 }, { table: 'Beta', modifiedAt: NaN, id: 2 }, { table: 'Gamma', modifiedAt: -5, id: 3 }], two), 'Gamma', 'dates illisibles ou négatives : comme vides');
  eq(latest([{ table: 'Alpha', modifiedAt: '1700000500', id: 1 }, { table: 'Beta', modifiedAt: 1700000100, id: 2 }], two), 'Alpha', 'une date en texte numérique est lue');
  eq(latest([null, 7, 'x', {}, { table: 3, modifiedAt: 9, id: 1 }, { table: 'Alpha', modifiedAt: 1, id: 1 }], two), 'Alpha', 'entrées abîmées ignorées, jamais une exception');
  // Les entrées ne sont jamais modifiées.
  const frozen = Object.freeze(entries.map((e) => Object.freeze(Object.assign({}, e))));
  latest(frozen, Object.freeze(two.slice()));
  pick({ available: Object.freeze(two.slice()), remembered: 'Beta' });
}
purChecks(state);
console.log('OK pickStartTable / latestReportTable (' + checks + ' vérifications)');

// ---- 2. Des versions FAUTIVES de js/state.js doivent être vues par les mêmes vérifications ------------------------------------------------------
{
  const source = read('js', 'state.js');
  const mutate = (label, from, to) => {
    assert.ok(source.includes(from), 'mutation introuvable : ' + label);
    const mod = {};
    const box = { module: mod, self: {}, console };
    vm.runInNewContext(source.replace(from, to), box);
    const loaded = mod.exports || (box.self.GristBI && box.self.GristBI.state);
    assert.ok(loaded && loaded.pickStartTable, 'module muté non chargé : ' + label);
    let caught = false;
    try { purChecks(loaded); } catch (e) { caught = true; }
    ok(caught, 'FAUTE NON VUE : ' + label);
  };
  mutate('la mémoire passe avant même si la table n\'existe plus', "if (inList(available, o.remembered)) return o.remembered;", "if (o.remembered) return o.remembered;");
  mutate('le rapport récent passe avant la mémoire', "if (inList(available, o.remembered)) return o.remembered;\n    if (inList(available, o.latest)) return o.latest;", "if (inList(available, o.latest)) return o.latest;\n    if (inList(available, o.remembered)) return o.remembered;");
  mutate('rapport récent d\'une table disparue ouvert tel quel', "if (inList(available, o.latest)) return o.latest;", "if (o.latest) return o.latest;");
  mutate('le rapport le plus ANCIEN gagne', "when > best.when ||", "when < best.when ||");
  mutate('à date égale la ligne la plus ANCIENNE gagne', "row >= best.row", "row <= best.row");
  mutate('une table absente du document compte pour le rapport récent', "if (!entry || !inList(available, entry.table)) return;", "if (!entry) return;");
  mutate('une date illisible est prise pour la plus récente', "when = Number.isFinite(at) && at > 0 ? at : 0;", "when = Number.isFinite(at) ? at : Infinity;");
  mutate('aucune table : la mémoire est rendue quand même', "if (!available.length) return '';", "");
  console.log('OK 8 versions fautives de state.js vues par les vérifications');
}

// ---- 3. Le pont : GristBI.api.latestReportTableId lit BI_Dashboard_Config sans rien écrire -------------------------------------------------------
(async () => {
  const addReport = (cfg, table, modifiedAt, type) => {
    const id = cfg.id.length + 1;
    cfg.id.push(id);
    Object.keys(cfg).filter((k) => k !== 'id').forEach((k) => cfg[k].push(null));
    const at = (key) => cfg[key].length - 1;
    cfg.TableId[at('TableId')] = table;
    cfg.ConfigJSON[at('ConfigJSON')] = '{}';
    if (cfg.ModifiedAt) cfg.ModifiedAt[at('ModifiedAt')] = modifiedAt;
    if (cfg.ReportType) cfg.ReportType[at('ReportType')] = type === undefined ? 'rapport' : type;
    return id;
  };
  const fresh = () => {
    const actions = [];
    const env = loadApiWithFakeConfigTable(data, i18n, actions, 'en');
    return Object.assign(env, { actions });
  };
  const AVAILABLE = ['Alpha', 'Beta', 'Gamma'];

  {
    const env = fresh();
    addReport(env.cfg, 'Alpha', 1700000000);
    addReport(env.cfg, 'Gamma', 1700009000);
    addReport(env.cfg, 'Beta', 1700005000);
    addReport(env.cfg, 'Zèbre', 1800000000); // la plus récente, mais cette table n'existe plus dans le document
    eq(await env.api.latestReportTableId(AVAILABLE), 'Gamma', 'le rapport enregistré le plus récemment, parmi les tables du document');
    eq(env.actions.length, 0, 'lecture seule : aucune écriture');
  }
  {
    const env = fresh();
    addReport(env.cfg, 'Alpha', 1700000000);
    addReport(env.cfg, 'Beta', 1800000000, 'inconnu'); // un type que ce widget ne connaît pas : jamais pris
    eq(await env.api.latestReportTableId(AVAILABLE), 'Alpha', 'une ligne d\'un type inconnu ne désigne pas la table de départ');
  }
  {
    const env = fresh();
    addReport(env.cfg, 'Beta', 1700000000, ''); // ligne d'avant les types : un rapport
    eq(await env.api.latestReportTableId(AVAILABLE), 'Beta', 'un type vide est un rapport (documents d\'avant le réglage)');
  }
  {
    const env = fresh();
    eq(await env.api.latestReportTableId(AVAILABLE), '', 'aucun rapport enregistré : rien');
  }
  {
    // Le même document avec les noms d'AVANT la consigne 030 (Nom, TypeRapport, DateModif, ModifiePar) : la date se lit toujours.
    const actions = [];
    const env = loadApiWithFakeConfigTable(data, i18n, actions, 'fr');
    const id = env.cfg.id.length + 1;
    env.cfg.id.push(id); env.cfg.TableId.push('Beta'); env.cfg.ConfigJSON.push('{}'); env.cfg.DateModif.push(1700000000); env.cfg.TypeRapport.push('rapport'); env.cfg.Nom.push('x'); env.cfg.ModifiePar.push('');
    eq(await env.api.latestReportTableId(AVAILABLE), 'Beta', 'noms d\'avant : la date est lue sous DateModif');
    eq(actions.length, 0, 'noms d\'avant : toujours aucune écriture');
  }
  {
    // Un document sans BI_Dashboard_Config : on ne la crée JAMAIS pour poser la question.
    const env = fresh();
    env.sandbox.grist.docApi.listTables = async () => ['Alpha', 'Beta'];
    env.sandbox.grist.docApi.fetchTable = async () => { throw new Error('ne doit pas être lue'); };
    eq(await env.api.latestReportTableId(AVAILABLE), '', 'pas de table de configuration : rien, et elle n\'est pas lue');
    eq(env.actions.length, 0, 'pas de table de configuration : rien n\'est créé');
  }
  {
    // Une lecture qui échoue (droits, réseau) ne casse rien : la 1re table prendra le relais.
    const env = fresh();
    env.sandbox.grist.docApi.fetchTable = async () => { throw new Error('droits refusés'); };
    eq(await env.api.latestReportTableId(AVAILABLE), '', 'lecture impossible : rien, jamais une exception');
  }
  console.log('OK GristBI.api.latestReportTableId (' + checks + ' vérifications au total)');

  // ---- 4. Le câblage de js/main-session.js (la logique du navigateur est jouée par test-browser.js) --------------------------------------------
  const session = read('js', 'main-session.js');
  const code = session.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/tables\[0\]/.test(code), 'main-session.js : plus aucune « tables[0] » : toute ouverture passe par chooseStartTable');
  ok((code.match(/chooseStartTable\(/g) || []).length >= 4, 'chooseStartTable est appelée par connectToFirstTable, openBlankReport et openModelById (+ sa définition)');
  const fn = (name) => { const m = new RegExp('async function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n').exec(session); assert.ok(m, 'fonction introuvable : ' + name); return m[0]; };
  ok(/chooseStartTable\(tables\)/.test(fn('connectToFirstTable')), 'connectToFirstTable ouvre la table de départ');
  ok(/chooseStartTable\(tables\)/.test(fn('openBlankReport')), '« Nouveau » aussi');
  ok(/chooseStartTable\(names\)/.test(fn('openModelById')), 'un modèle cherche d\'abord sur la table de départ');
  const sw = fn('switchTable');
  ok(/if \(isNewTable\) \{[\s\S]*saveLastTable\(tableId\);[\s\S]*\n    \}\n    await applyBlend/.test(sw), 'switchTable mémorise la table, une fois le tableau de bord prêt, et seulement si la table change');
  ok(sw.indexOf('saveLastTable') > sw.indexOf('S.dashboardReady = true'), 'la table est mémorisée APRÈS le chargement du rapport (un échec ne la mémorise pas)');
  const load = /function loadLastTable\(\) \{[\s\S]*?\n  \}\n/.exec(session)[0];
  const save = /function saveLastTable\(tableId\) \{[\s\S]*?\n  \}\n/.exec(session)[0];
  ok(/try \{[\s\S]*typeof localStorage[\s\S]*catch/.test(load) && /try \{[\s\S]*typeof localStorage[\s\S]*catch/.test(save), 'le `typeof localStorage` est DANS le try (il lève dans un cadre isolé)');
  ok(/gfsLink\.hosted[\s\S]*storageGet\(LAST_TABLE_KEY\)/.test(load) && /gfsLink\.hosted[\s\S]*storageSet\(LAST_TABLE_KEY/.test(save), 'chez GFS la mémoire passe par GfsLink.storageGet/storageSet');
  ok((session.match(/'gristbi_last_table'/g) || []).length === 1, 'la clé de mémoire est écrite une seule fois');
  // La phrase du README (consigne GFS 028 : toute clé de localStorage nouvelle y est dite).
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  ok(readme.includes('gristbi_last_table'), 'README : la clé gristbi_last_table est dite dans « Sécurité et confidentialité »');
  ok(/last table|dernière table/i.test(readme.split('\n').filter((l) => l.includes('localStorage')).join('\n')), 'README : la phrase explique ce que la clé garde');

  console.log('OK câblage de main-session.js');
  console.log('\nTOUT PASSE (' + checks + ' vérifications) : table de départ');
})().catch((e) => { console.error(e); process.exit(1); });
