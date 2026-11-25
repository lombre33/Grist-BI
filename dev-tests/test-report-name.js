/*
 * Nommer et renommer un rapport depuis le widget (25/11/2026) — sans navigateur ni vrai Grist :
 *   node dev-tests/test-report-name.js
 *
 *  - `normalizeReportName` : espaces repliés, caractères de contrôle retirés, plafond en CARACTÈRES (un emoji n'est jamais coupé), rien qui ne soit un texte ;
 *  - le vrai `js/grist-api.js` sur un faux document, dans les trois états des noms de colonnes (anglais, d'avant la consigne GFS 030, les deux jeux) :
 *      · nommer un rapport pas encore enregistré écrit sa ligne avec CE nom (colonne `Name` ou `Nom`), `ReportType` posé, jamais un nom déjà pris ;
 *      · renommer un rapport enregistré n'écrit que son nom (+ date, auteur, et `ReportType` s'il manquait) : `ConfigJSON` n'est jamais touché, aucune colonne n'est créée ;
 *      · refus : nom vide, nom pris par une AUTRE ligne (sans tenir compte de la casse), ligne disparue, ligne d'un autre `ReportType` ; son propre nom (même autrement écrit) reste permis ;
 *      · un renommage fait ailleurs (l'explorateur de GFS) est relu avant d'écrire, et le nom connu se remet à jour ;
 *      · un nom de colonne changé dans un autre onglet pendant la session est rattrapé UNE fois ;
 *  - garde-fous des sources : le bouton du nom, ses textes fr/en, son câblage (barre, rendu, session), l'écriture du nom seulement dans `js/grist-api.js`.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadApiWithFakeConfigTable, readMain } = require('./lib/helpers.js');
const data = require('../js/data.js');
const i18n = require('../js/i18n.js');

const same = (a, b, message) => assert.deepStrictEqual(a, b, message);
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

(async () => {
  const makeApi = (names, actions) => loadApiWithFakeConfigTable(data, i18n, actions, names);
  const seed = (cfg, rows) => rows.forEach((row) => {
    cfg.id.push(cfg.id.length + 1);
    Object.keys(cfg).filter((k) => k !== 'id').forEach((k) => cfg[k].push(row[k] !== undefined ? row[k] : ''));
  });
  const save = (api, id, name, table = 'Ventes') => api.saveConfig(table, [{ id: 'p1', name: 'P', tiles: [] }], 'p1', [], null, id, 'moi@exemple.fr', 'standard', {}, name);
  const json = (n) => JSON.stringify({ pages: [{ id: 'p1', name: 'Page ' + n, tiles: [] }], currentPageId: 'p1' });
  // Les trois états : [libellé, jeu de noms du faux document, colonne du nom, colonne de la date, colonne du type, colonne de l'auteur]
  const SETS = [
    ['anglais', 'en', 'Name', 'ModifiedAt', 'ReportType', 'ModifiedBy'],
    ['d\'avant (alpha)', 'fr', 'Nom', 'DateModif', 'TypeRapport', 'ModifiePar'],
    ['les deux jeux', 'both', 'Name', 'ModifiedAt', 'ReportType', 'ModifiedBy']
  ];

  // --- 1. normalizeReportName ---------------------------------------------------------------------------------------------------------------------------
  {
    const { api } = makeApi('en');
    const n = api.normalizeReportName;
    assert.strictEqual(n('  Chiffres   2026  '), 'Chiffres 2026', 'espaces repliés et rognés');
    assert.strictEqual(n('a\tb\nc\u0000d\u007fe'), 'a b c d e', 'caractères de contrôle remplacés par une espace');
    assert.strictEqual(n('   '), '');
    assert.strictEqual(n(''), '');
    for (const notText of [null, undefined, 12, {}, [], true]) assert.strictEqual(n(notText), '', `${JSON.stringify(notText)} n'est pas un nom`);
    assert.strictEqual(n('x'.repeat(500)).length, api.REPORT_NAME_MAX, 'plafonné');
    const emoji = n('é'.repeat(api.REPORT_NAME_MAX - 1) + '😀😀😀');
    assert.strictEqual(Array.from(emoji).length, api.REPORT_NAME_MAX, 'plafond en caractères');
    assert.ok(!/[\ud800-\udbff]$/.test(emoji), 'jamais un emoji coupé en deux');
    console.log('OK nom — normalisation : espaces, contrôle, plafond en caractères, entrées qui ne sont pas du texte');
  }

  // --- 2. nommer un rapport pas encore enregistré --------------------------------------------------------------------------------------------------------
  for (const [label, names, nameCol, , typeCol] of SETS) {
    const actions = [];
    const { api, cfg } = makeApi(names, actions);
    seed(cfg, [{ TableId: 'Autre', ConfigJSON: json(0), [nameCol]: 'Déjà là', [typeCol]: 'rapport' }]);
    assert.strictEqual(api.reportRowIdFor('Ventes', 'new'), null, 'un rapport neuf n\'a pas de ligne');
    const id = await save(api, 'new', '  Chiffres   2026 ');
    assert.strictEqual(id, 2);
    assert.strictEqual(cfg[nameCol][1], 'Chiffres 2026', `${label} : écrit sous \`${nameCol}\`, normalisé`);
    assert.strictEqual(cfg[typeCol][1], 'rapport', `${label} : ReportType posé avec le nom`);
    assert.strictEqual(api.reportNameOf(id), 'Chiffres 2026', `${label} : le nom connu est celui qu'on a choisi`);
    assert.strictEqual(api.reportRowIdFor('Ventes', id), id);
    assert.ok(!actions.some((a) => a[0] === 'AddColumn'), `${label} : aucune colonne créée`);
    // sans nom demandé : le nom par défaut, jamais un nom déjà pris
    const other = await save(api, 'new', undefined, 'Troisieme');
    assert.ok(cfg[nameCol][other - 1] && cfg[nameCol][other - 1] !== 'Chiffres 2026', `${label} : sans nom choisi, le nom par défaut`);
    // un nom pris : refusé, aucune ligne de plus
    const before = cfg.id.length;
    await assert.rejects(() => save(api, 'new', 'DÉJÀ LÀ', 'Quatrieme'), (e) => e.code === 'NAME_TAKEN', `${label} : nom pris (casse ignorée) refusé`);
    assert.strictEqual(cfg.id.length, before, `${label} : rien n'est écrit quand le nom est pris`);
    // la suggestion évite les noms pris
    cfg[nameCol][0] = 'Rapport BI 1';
    cfg[nameCol][2] = 'Rapport BI 2';
    assert.strictEqual(await api.suggestReportName(), 'Rapport BI 3', `${label} : la suggestion évite les noms déjà portés (1 et 2 sont pris)`);
  }
  console.log('OK nom — nommer un rapport neuf : la ligne naît avec CE nom (Name, Nom ou les deux jeux), type posé, nom pris refusé sans rien écrire, suggestion libre');

  // --- 3. renommer un rapport enregistré -----------------------------------------------------------------------------------------------------------------
  for (const [label, names, nameCol, dateCol, typeCol, authorCol] of SETS) {
    const actions = [];
    const { api, cfg } = makeApi(names, actions);
    seed(cfg, [
      { TableId: 'Ventes', ConfigJSON: json(1), [nameCol]: 'Ventes', [typeCol]: 'rapport', [dateCol]: 5, [authorCol]: 'a@b.fr' },
      { TableId: 'Achats', ConfigJSON: json(2), [nameCol]: 'Achats', [typeCol]: 'rapport', [dateCol]: 5 }
    ]);
    await api.loadConfigById(1);
    const jsonBefore = cfg.ConfigJSON.slice();
    actions.length = 0;
    const written = await api.renameReport(1, '  Bilan   commercial ', 'moi@exemple.fr');
    assert.strictEqual(written, 'Bilan commercial');
    assert.strictEqual(cfg[nameCol][0], 'Bilan commercial', `${label} : le nom est écrit sous \`${nameCol}\``);
    assert.ok(cfg[dateCol][0] > 5 && cfg[authorCol][0] === 'moi@exemple.fr', `${label} : date et auteur de la modification`);
    same(cfg.ConfigJSON, jsonBefore, `${label} : ConfigJSON n'est jamais touché`);
    assert.strictEqual(cfg[nameCol][1], 'Achats', `${label} : l'autre rapport n'est pas touché`);
    same(actions.map((a) => a[0]), ['UpdateRecord'], `${label} : une seule écriture, sur une ligne`);
    same(Object.keys(actions[0][3]).sort(), [authorCol, dateCol, nameCol].sort(), `${label} : seuls le nom, la date et l'auteur sont écrits`);
    assert.strictEqual(api.reportNameOf(1), 'Bilan commercial', `${label} : le nom connu suit`);
    assert.strictEqual((await api.loadConfigById(1)).name, 'Bilan commercial', `${label} : la réouverture relit le nouveau nom`);
    // son propre nom, autrement écrit : permis ; le même nom : aucune écriture
    assert.strictEqual(await api.renameReport(1, 'BILAN COMMERCIAL', 'moi@exemple.fr'), 'BILAN COMMERCIAL');
    assert.strictEqual(cfg[nameCol][0], 'BILAN COMMERCIAL', `${label} : changer la casse de son propre nom est permis`);
    actions.length = 0;
    await api.renameReport(1, 'BILAN COMMERCIAL', 'moi@exemple.fr');
    assert.strictEqual(actions.length, 0, `${label} : le même nom n'écrit rien`);
    // refus
    await assert.rejects(() => api.renameReport(1, 'achats'), (e) => e.code === 'NAME_TAKEN', `${label} : nom d'un AUTRE rapport (casse ignorée)`);
    await assert.rejects(() => api.renameReport(1, '   '), (e) => e.code === 'NAME_EMPTY');
    await assert.rejects(() => api.renameReport(99, 'Neuf'), (e) => e.code === 'NOT_FOUND', `${label} : ligne disparue`);
    cfg[typeCol][1] = 'formulaire';
    await assert.rejects(() => api.renameReport(2, 'Autre nom'), (e) => e.code === 'FOREIGN_TYPE', `${label} : un type que ce widget ne connaît pas n'est pas renommé`);
    assert.strictEqual(cfg[nameCol][1], 'Achats', `${label} : la ligne d'un autre type est intacte`);
    assert.strictEqual(cfg[nameCol][0], 'BILAN COMMERCIAL', `${label} : aucun refus n'a écrit quoi que ce soit`);
    assert.ok(!actions.some((a) => a[0] === 'AddColumn' || a[0] === 'AddTable' || a[0] === 'RenameColumn'), `${label} : aucune colonne ni table touchée`);
  }
  console.log('OK nom — renommer : seul le nom (+ date, auteur) est écrit, ConfigJSON intact, refus du vide, d\'un nom pris, d\'une ligne disparue ou d\'un autre type');

  // --- 4. une ligne d'avant la consigne GFS 007 (ni nom ni type) ------------------------------------------------------------------------------------------
  {
    const { api, cfg } = makeApi('en');
    seed(cfg, [{ TableId: 'Ventes', ConfigJSON: json(1) }]);
    await api.loadConfigById(1);
    assert.strictEqual(api.reportNameOf(1), '', 'jamais nommée : pas de nom');
    await api.renameReport(1, 'Enfin nommé');
    assert.strictEqual(cfg.Name[0], 'Enfin nommé');
    assert.strictEqual(cfg.ReportType[0], 'rapport', 'une ligne sans type reçoit `rapport` avec son nom, comme à sa première sauvegarde');
    console.log('OK nom — une ligne d\'avant la consigne 007 reçoit son nom et son type');
  }

  // --- 5. hors GFS : la ligne connue de la table, sinon rien ------------------------------------------------------------------------------------------------
  {
    const { api, cfg } = makeApi('en');
    assert.strictEqual(api.reportRowIdFor('Ventes', null), null, 'table sans ligne : pas encore enregistré');
    seed(cfg, [{ TableId: 'Ventes', ConfigJSON: json(1), Name: 'Hors GFS', ReportType: 'rapport' }]);
    assert.strictEqual(api.reportRowIdFor('Ventes', null), null, 'tant que la ligne n\'a pas été lue, elle n\'est pas connue');
    await api.loadConfig('Ventes');
    assert.strictEqual(api.reportRowIdFor('Ventes', null), 1, 'après lecture : la ligne de cette table');
    assert.strictEqual(api.reportNameOf(1), 'Hors GFS', 'et son nom, sans appel de plus');
    assert.strictEqual(api.reportRowIdFor('Ventes', 'new'), null, 'un rapport neuf n\'est jamais confondu avec la ligne de la table');
    assert.strictEqual(api.reportRowIdFor('Ventes', 7), 7);
    assert.strictEqual(api.reportNameOf(null), '');
    assert.strictEqual(api.reportNameOf(404), '');
    console.log('OK nom — ligne du rapport affiché : id de GFS, sinon la ligne connue de la table, un rapport neuf jamais confondu avec elle');
  }

  // --- 6. un renommage fait ailleurs (explorateur de GFS) ---------------------------------------------------------------------------------------------------
  for (const [label, names, nameCol, , typeCol] of SETS) {
    const { api, cfg } = makeApi(names);
    seed(cfg, [{ TableId: 'Ventes', ConfigJSON: json(1), [nameCol]: 'Avant', [typeCol]: 'rapport' }, { TableId: 'Autre', ConfigJSON: json(2), [nameCol]: 'Autre', [typeCol]: 'rapport' }]);
    await api.loadConfigById(1);
    assert.strictEqual(api.reportNameOf(1), 'Avant');
    cfg[nameCol][0] = 'Renommé par GFS';
    assert.strictEqual(api.reportNameOf(1), 'Avant', `${label} : le nom connu ne change pas tout seul`);
    assert.strictEqual(await api.readReportName(1), 'Renommé par GFS', `${label} : la relecture donne le nom d'aujourd'hui`);
    assert.strictEqual(api.reportNameOf(1), 'Renommé par GFS', `${label} : et remet le nom connu à jour`);
    // une sauvegarde de contenu ne remplace jamais ce nom
    await save(api, 1);
    assert.strictEqual(cfg[nameCol][0], 'Renommé par GFS', `${label} : sauvegarder le contenu n'écrase pas un nom changé ailleurs`);
    // le nom pris est jugé sur la table d'AUJOURD'HUI : un autre l'a pris entre-temps
    cfg[nameCol][1] = 'Libre hier';
    await assert.rejects(() => api.renameReport(1, 'libre hier'), (e) => e.code === 'NAME_TAKEN', `${label} : nom pris entre-temps, refusé`);
    assert.strictEqual(await api.readReportName(404), '', `${label} : ligne disparue : ''`);
  }
  console.log('OK nom — un renommage fait ailleurs est relu avant d\'écrire, la sauvegarde du contenu ne l\'écrase pas');

  // --- 7. un nom de colonne changé dans un autre onglet : rattrapé UNE fois -------------------------------------------------------------------------------------
  {
    const { api, cfg, renameColumn } = makeApi('fr');
    seed(cfg, [{ TableId: 'Ventes', ConfigJSON: json(1), Nom: 'Ventes', TypeRapport: 'rapport', DateModif: 5, ModifiePar: 'a@b.fr' }]);
    await api.loadConfigById(1); // la page lit les noms d'avant…
    ['Nom:Name', 'TypeRapport:ReportType', 'DateModif:ModifiedAt', 'ModifiePar:ModifiedBy'].forEach((p) => renameColumn(...p.split(':'))); // …un autre onglet les passe à l'anglais
    await api.renameReport(1, 'Après la mise à jour');
    assert.strictEqual(cfg.Name[0], 'Après la mise à jour', 'les noms sont relus et l\'écriture recommencée une fois');
    assert.ok(!('Nom' in cfg), 'aucune colonne française recréée');
    console.log('OK nom — un nom de colonne changé dans un autre onglet est rattrapé une fois');
  }

  // --- 8. garde-fous des sources --------------------------------------------------------------------------------------------------------------------------
  {
    const index = read('index.html');
    const harness = read('dev-tests', 'harness.html');
    for (const [label, html] of [['index.html', index], ['harness.html', harness]]) {
      assert.ok(/<button id="report-name" type="button" class="report-name" hidden>/.test(html), `${label} : le bouton du nom du rapport, masqué tant qu'aucune table n'est connectée`);
      assert.ok(/id="report-name-text"/.test(html) && /report-name-edit edit-only/.test(html), `${label} : le texte du nom et le crayon (Édition seulement)`);
    }
    assert.ok(index.indexOf('id="report-name"') < index.indexOf('id="data-pill"'), 'le nom du rapport est en tête de la barre, avant la pastille de la table');
    // Textes : chaque clé existe dans les deux langues, et la fenêtre s'appelle de deux façons (nommer / renommer)
    const keys = ['report.name.untitled', 'report.name.aria', 'report.rename.aria', 'report.name.ariaUntitled', 'report.rename.hint', 'report.name.hint', 'report.rename.title', 'report.name.title',
      'report.rename.label', 'report.rename.confirm', 'report.name.confirm', 'report.rename.empty', 'report.rename.taken', 'report.rename.failed'];
    for (const lang of ['fr', 'en']) {
      i18n.setLang(lang);
      for (const key of keys) assert.ok(i18n.t(key, { name: 'X' }) && i18n.t(key, { name: 'X' }) !== key, `${lang} : ${key}`);
    }
    i18n.setLang('fr');
    assert.ok(/X/.test(i18n.t('report.rename.aria', { name: 'X' })), 'le nom accessible dit le nom');
    // Câblage
    const main = readMain();
    assert.ok(/reportNameBtn\.addEventListener\('click', renameCurrentReport\)/.test(main), 'le clic ouvre la fenêtre');
    assert.ok(/if \(S\.mode !== 'edit' \|\| !S\.currentTableId \|\| !S\.dashboardReady \|\| renamingReport\) return;/.test(main), 'renommer : Édition seulement, table connectée, une fenêtre à la fois');
    assert.ok(/reportNameBtn\.disabled = !editing;/.test(main), 'en Lecture le bouton n\'est que le nom (inactif)');
    assert.ok(/renderConnectionStatus\(state\);\s*fitPageTabs\(\);/.test(main) || /renderBookmarks\(state\);\s*renderConnectionStatus\(state\);\s*fitPageTabs\(\);/.test(main), 'render() remet le nom à jour puis ajuste la barre');
    assert.ok(/applyMode\(\);[\s\S]{0,40}renderReportName\(\)|renderReportName\(\); \/\/ le bouton du nom/.test(main), 'le changement de mode réactive ou désactive le bouton');
    assert.ok(/if \(p\.tableId === S\.currentTableId\) refreshReportName\(\);/.test(main), 'une sauvegarde qui donne son nom au rapport le montre aussitôt');
    assert.ok(/S\.dashboardReady = true;\s*refreshReportName\(\);/.test(main), 'ouvrir un rapport montre son nom');
    assert.ok(/e\.code === 'NAME_TAKEN'/.test(main) && /continue; \}/.test(main), 'un nom pris est dit, puis la fenêtre revient avec ce qui a été tapé');
    // Le nom ne s'écrit que dans js/grist-api.js (et jamais sous un nom de colonne en dur dans l'interface)
    const others = ['js/main-session.js', 'js/main-render.js', 'js/main-core.js', 'js/main-form.js', 'js/main.js'].map((f) => read(f)).join('\n');
    assert.ok(!/'UpdateRecord', CONFIG|BI_Dashboard_Config/.test(others.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'l\'interface n\'écrit rien elle-même dans BI_Dashboard_Config : tout passe par GristBI.api');
    // La feuille de style : le bouton a une règle [hidden] explicite (piège n°10), et la barre étroite garde l'icône
    const css = read('css', 'style.css');
    assert.ok(/\.report-name\[hidden\] \{ display: none; \}/.test(css), 'règle [hidden] explicite (une règle d\'auteur display:inline-flex bat [hidden])');
    assert.ok(/\.appbar\.bar-report-compact \.report-name-text, \.appbar\.bar-report-compact \.report-name-edit \{ display: none; \}/.test(css), 'barre étroite : il reste l\'icône');
    assert.ok(/barOverflows/.test(main) && /bar-report-compact/.test(main), 'la barre qui déborde allège ses libellés puis le texte du nom');
    console.log('OK nom — sources : bouton en tête de la barre, textes fr/en, câblage, jamais d\'écriture hors de GristBI.api, règles de la feuille de style');
  }

  console.log('\nTous les essais du nom du rapport sont passés.');
})().catch((error) => { console.error(error); process.exit(1); });
