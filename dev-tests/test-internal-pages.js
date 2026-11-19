/*
 * Rangement des pages des tables internes (js/internal-pages.js + js/grist-api.js:organizeInternalPages) — sans navigateur ni Grist :
 *
 *   node dev-tests/test-internal-pages.js
 *
 * Un « moteur » minimal, écrit ici, applique les actions comme Grist le fait pour `_grist_Pages` (positions explicites, `null` = à la fin)
 * et relit l'ARBRE comme le client (indentation ramenée à « au plus +1 par ligne ») : les essais jugent l'arbre qu'on verrait dans la
 * liste de gauche, jamais des nombres de position. Ce que ça garde :
 *  - le cas de la capture d'Antoine (Config, Comments, page du widget, UserProbe) -> les trois sous la page du widget, repliée ;
 *  - l'idempotence, et le geste de la personne : une page rangée puis sortie à la main n'est JAMAIS reprise ;
 *  - la COURSE réelle (vue dans un vrai Grist) : `AddTable` ajoute la page d'une autre table interne entre la lecture de l'arbre et
 *    l'application du plan — Comments se retrouvait rangée sous UserProbe ;
 *  - le choix du parent : groupe déjà formé, page de CE widget (adresses sans requête / `index.html` / barre finale, `widgetDef.url`),
 *    dernier recours = page de BI_Dashboard_Config ; jamais de page interne comme parent d'une autre hors de ce dernier recours ;
 *  - « replié » seulement sur un parent sans enfant et sans état explicite, `options` des autres clés conservées, JSON hostile toléré ;
 *  - une page qui a des sous-pages part avec elles ; une page qui contient le parent ne bouge pas ;
 *  - le vrai js/grist-api.js sur le faux Grist du harnais : appels sérialisés, erreurs attrapées (un seul avertissement), et les trois
 *    créations de table (Config, Comments, UserProbe) qui déclenchent le rangement.
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { read, plain } = require('./lib/helpers.js');
const P = require('../js/internal-pages.js');

const CONFIG = 'BI_Dashboard_Config';
const COMMENTS = 'BI_Dashboard_Comments';
const PROBE = 'BI_Dashboard_UserProbe';
const SELF = 'https://grist-factory.github.io/grist-widget-grist-BI/index.html?access=full&readonly=false';
const WIDGET_SECTION = (url) => JSON.stringify({ customView: JSON.stringify({ mode: 'url', url, access: 'full' }) });

// --- Un petit monde : des pages décrites en clair -> les tables telles que `fetchTable` les rend --------------------------------------
// page = { name, level, table?: l'id de la table dont c'est la page, widget?: l'adresse du widget posé sur cette page, options?: texte }
function world(spec) {
  const tables = { id: [], tableId: [], primaryViewId: [] };
  const pages = { id: [], viewRef: [], indentation: [], pagePos: [], shareRef: [], options: [] };
  const sections = { id: [], parentId: [], parentKey: [], options: [] };
  spec.forEach((p, i) => {
    const view = 100 + i;
    pages.id.push(i + 1); pages.viewRef.push(view); pages.indentation.push(p.level || 0); pages.pagePos.push(i + 1);
    pages.shareRef.push(0); pages.options.push(p.options || '');
    tables.id.push(i + 1); tables.tableId.push(p.table || 'T_' + p.name); tables.primaryViewId.push(p.widget ? 0 : view);
    if (p.widget) {
      sections.id.push(500 + i); sections.parentId.push(view); sections.parentKey.push('custom');
      sections.options.push(typeof p.widget === 'string' ? WIDGET_SECTION(p.widget) : JSON.stringify(p.widget));
    }
  });
  const names = spec.map((p) => p.name);
  return { tables, pages, sections, names, selfUrl: SELF };
}

// Ce que fait Grist d'un `BulkUpdateRecord` sur `_grist_Pages` (positions explicites ; `null` = après toutes les autres).
function applyActions(w, actions) {
  for (const a of actions) {
    assert.strictEqual(a[0], 'BulkUpdateRecord');
    assert.strictEqual(a[1], '_grist_Pages');
    const [, , ids, cols] = a;
    for (const k of Object.keys(cols)) assert.strictEqual(cols[k].length, ids.length, `${k} : une valeur par ligne`);
    ids.forEach((id, n) => {
      const i = w.pages.id.indexOf(id);
      assert.ok(i >= 0, `page ${id} connue`);
      for (const k of Object.keys(cols)) {
        let v = cols[k][n];
        if (k === 'pagePos' && v === null) v = Math.max(...w.pages.pagePos) + 1;
        w.pages[k][i] = v;
      }
    });
  }
}

// Ajoute, comme `AddTable`, la page d'une table : à la fin, indentation 0.
function addTablePage(w, name, tableId) {
  const id = Math.max(0, ...w.pages.id) + 1;
  const view = 1000 + id;
  w.pages.id.push(id); w.pages.viewRef.push(view); w.pages.indentation.push(0); w.pages.pagePos.push(Math.max(...w.pages.pagePos) + 1);
  w.pages.shareRef.push(0); w.pages.options.push('');
  w.tables.id.push(id); w.tables.tableId.push(tableId); w.tables.primaryViewId.push(view);
  w.names[id - 1] = name;
  return id;
}

// L'arbre vu du client : [{ name, level }] dans l'ordre d'affichage, indentation ramenée à « +1 au plus ».
function tree(w) {
  const rows = w.pages.id.map((id, i) => ({ id, pos: w.pages.pagePos[i], ind: w.pages.indentation[i], name: w.names[id - 1] }));
  rows.sort((a, b) => a.pos - b.pos);
  let max = 0;
  return rows.map((r) => { const level = Math.min(max, r.ind); max = level + 1; return { name: r.name, level }; });
}
const shape = (w) => tree(w).map((r) => '  '.repeat(r.level) + r.name).join('\n');
const optionsOf = (w, name) => JSON.parse(w.pages.options[w.names.indexOf(name)] || '{}');
const plan = (w, extra) => P.plan({ tables: w.tables, pages: w.pages, sections: w.sections, selfUrl: w.selfUrl, ...extra });
const settle = (w, extra) => { const r = plan(w, extra); applyActions(w, r.actions); return r; };

// Les mêmes pages que la capture d'Antoine (19/11/2026) : les trois tables internes s'intercalent autour de la page du widget.
const antoine = () => world([
  { name: 'Table1', table: 'Table1' }, { name: 'Config', table: CONFIG }, { name: 'Comments', table: COMMENTS },
  { name: 'Dashboard', widget: SELF.split('?')[0] }, { name: 'Probe', table: PROBE }
]);

(async () => {
  // --- 1. La capture d'Antoine ---------------------------------------------------------------------------------------------------------
  {
    const w = antoine();
    const r = settle(w);
    assert.strictEqual(r.how, 'dashboard');
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config\n  Comments\n  Probe', 'les trois sous la page du widget, dans l\'ordre des tables');
    assert.deepStrictEqual(optionsOf(w, 'Dashboard'), { collapsed: true }, 'le parent est replié par défaut');
    for (const n of ['Config', 'Comments', 'Probe']) assert.deepStrictEqual(optionsOf(w, n), { [P.MARK_KEY]: true }, `${n} marquée`);
    assert.deepStrictEqual(optionsOf(w, 'Table1'), {}, 'une page de la personne n\'est pas touchée');
    assert.strictEqual(r.collapsed, true);
    assert.deepStrictEqual(r.nested.length, 3);
    // Idempotent : rien de plus à faire.
    const again = plan(w);
    assert.deepStrictEqual(again.actions, [], 'deuxième passage : aucune action');
    console.log('OK rangement — la capture d\'Antoine : Config, Comments, Probe sous la page du widget, repliée, puis plus rien à faire');
  }

  // --- 2. Un document neuf : les trois tables arrivent l'une après l'autre -------------------------------------------------------------
  {
    const w = world([{ name: 'Table1', table: 'Table1' }, { name: 'Dashboard', widget: SELF.split('?')[0] }]);
    assert.deepStrictEqual(plan(w).actions, [], 'aucune table interne : rien à faire');
    addTablePage(w, 'Config', CONFIG);
    const first = settle(w);
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config');
    assert.deepStrictEqual(optionsOf(w, 'Dashboard'), { collapsed: true });
    addTablePage(w, 'Comments', COMMENTS);
    const second = settle(w);
    assert.ok(!second.actions.some((a) => a[2].includes(2)), 'le parent (déjà replié) n\'est plus touché : ses options ne sont pas réécrites');
    assert.strictEqual(second.collapsed, false);
    addTablePage(w, 'Probe', PROBE);
    settle(w);
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config\n  Comments\n  Probe');
    assert.deepStrictEqual(plan(w).actions, []);
    // Une page de la personne ajoutée APRÈS : elle reste à la racine, à la fin ; rien n'est repris.
    const mine = Math.max(...w.pages.id) + 1;
    w.pages.id.push(mine); w.pages.viewRef.push(9999); w.pages.indentation.push(0); w.pages.pagePos.push(Math.max(...w.pages.pagePos) + 1); w.pages.shareRef.push(0); w.pages.options.push('');
    w.names[mine - 1] = 'Ma page';
    assert.deepStrictEqual(plan(w).actions, []);
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config\n  Comments\n  Probe\nMa page');
    console.log('OK rangement — document neuf : chaque table rangée à sa création, repli posé une seule fois, la page de la personne laissée à la racine');
  }

  // --- 3. La course réelle : une page apparaît entre la lecture et l'application ------------------------------------------------------
  {
    // Vu dans un vrai Grist : le plan de Comments (positions « à la fin ») était appliqué APRÈS que AddTable ait ajouté la page de UserProbe ;
    // Comments se retrouvait juste derrière elle, avec son indentation pour parent.
    const w = world([{ name: 'Table1', table: 'Table1' }, { name: 'Dashboard', widget: SELF.split('?')[0] }]);
    addTablePage(w, 'Config', CONFIG);
    settle(w);
    addTablePage(w, 'Comments', COMMENTS);
    const stale = plan(w); // lu AVANT l'arrivée de Probe
    addTablePage(w, 'Probe', PROBE); // AddTable s'applique entre la lecture et l'écriture
    applyActions(w, stale.actions);
    settle(w); // le plan de Probe passe ensuite, sur un arbre relu
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config\n  Comments\n  Probe', 'aucune page rangée sous une autre page interne');
    assert.ok(tree(w).every((r) => r.level <= 1), 'jamais plus d\'un niveau');
    // Même chose quand la page du widget est la dernière de la liste et que deux tables arrivent d'un coup.
    const v = world([{ name: 'Dashboard', widget: SELF.split('?')[0] }]);
    addTablePage(v, 'Config', CONFIG);
    addTablePage(v, 'Comments', COMMENTS);
    const early = plan(v);
    addTablePage(v, 'Probe', PROBE);
    applyActions(v, early.actions);
    settle(v);
    assert.strictEqual(shape(v), 'Dashboard\n  Config\n  Comments\n  Probe');
    console.log('OK rangement — course avec AddTable : une page ajoutée entre la lecture et l\'application ne renverse pas le rangement');
  }

  // --- 4. Le geste de la personne est respecté ---------------------------------------------------------------------------------------
  {
    const w = antoine();
    settle(w);
    const comments = w.names.indexOf('Comments');
    w.pages.indentation[comments] = 0; // la personne sort Comments du groupe
    assert.deepStrictEqual(plan(w).actions, [], 'une page rangée puis sortie à la main n\'est jamais reprise');
    const config = w.names.indexOf('Config');
    w.pages.pagePos[config] = 0; w.pages.indentation[config] = 0; // et déplace Config tout en haut
    assert.deepStrictEqual(plan(w).actions, []);
    // Une page marquée par une version précédente, même hors du groupe : jamais touchée non plus.
    const x = world([{ name: 'Dashboard', widget: SELF.split('?')[0] }, { name: 'Config', table: CONFIG, options: JSON.stringify({ [P.MARK_KEY]: true }) }]);
    assert.deepStrictEqual(plan(x).actions, []);
    console.log('OK rangement — la page sortie du groupe, ou déplacée, par la personne n\'est jamais reprise');
  }

  // --- 5. Le parent : l'adresse du widget --------------------------------------------------------------------------------------------
  {
    const parentOf = (w) => { const r = plan(w); return { how: r.how, parent: r.parent && w.names[r.parent - 1] }; };
    const mk = (url, self) => { const w = world([{ name: 'Config', table: CONFIG }, { name: 'Page A', widget: url }, { name: 'Page B' }]); w.selfUrl = self; return w; };
    const base = 'https://grist-factory.github.io/grist-widget-grist-BI/';
    assert.deepStrictEqual(parentOf(mk(base, SELF)), { how: 'dashboard', parent: 'Page A' }, 'adresse saisie avec barre finale, cadre sur index.html?access=…');
    assert.deepStrictEqual(parentOf(mk(base + 'index.html', base + '?access=full')), { how: 'dashboard', parent: 'Page A' });
    assert.deepStrictEqual(parentOf(mk('HTTPS://Grist-Factory.GitHub.io/grist-widget-grist-BI', SELF)), { how: 'dashboard', parent: 'Page A' }, 'hôte sans casse, sans barre finale');
    assert.deepStrictEqual(parentOf(mk(base + '?v=2#top', SELF)), { how: 'dashboard', parent: 'Page A' }, 'requête et ancre ignorées');
    assert.deepStrictEqual(parentOf(mk('http://grist-factory.github.io/grist-widget-grist-BI/', SELF)), { how: 'dashboard', parent: 'Page A' }, 'http ou https');
    // Widget de la galerie : l'adresse est dans le manifeste (`widgetDef.url`), `customView` peut aussi être un objet.
    assert.deepStrictEqual(parentOf(mk({ customView: { widgetId: 'x', widgetDef: { url: base } } }, SELF)), { how: 'dashboard', parent: 'Page A' });
    assert.deepStrictEqual(parentOf(mk({ customView: JSON.stringify({ widgetId: 'x', widgetDef: { url: base } }) }, SELF)), { how: 'dashboard', parent: 'Page A' });
    // Une autre adresse, un autre chemin ou aucune adresse : dernier recours, la page de BI_Dashboard_Config.
    for (const [url, self] of [['https://autre.example/widget/', SELF], [base + 'sous-dossier/', SELF], [base, ''], [base, 'about:blank'], ['', SELF], ['pas une adresse', SELF]]) {
      assert.deepStrictEqual(parentOf(mk(url, self)), { how: 'config', parent: 'Config' }, `repli : ${url} / ${self}`);
    }
    // Deux pages portent le widget : la première de l'arbre ; une page de table interne ne compte jamais comme page du widget.
    const two = world([{ name: 'Intro' }, { name: 'Second', widget: base }, { name: 'First', widget: base }, { name: 'Config', table: CONFIG }]);
    two.pages.pagePos[2] = 0.5; // « First » passe devant
    assert.strictEqual(parentOf(two).parent, 'First');
    const onInternal = world([{ name: 'Config', table: CONFIG, widget: base }, { name: 'Comments', table: COMMENTS }]);
    onInternal.tables.primaryViewId[0] = onInternal.pages.viewRef[0]; // la page de Config porte aussi une section du widget
    assert.strictEqual(parentOf(onInternal).how, 'config', 'jamais une page interne comme « page du widget »');
    console.log('OK rangement — parent : adresse du widget (barre, index.html, requête, casse, widgetDef.url, objet), plusieurs pages, repli');
  }

  // --- 6. Dernier recours : la page de BI_Dashboard_Config devient le dossier ------------------------------------------------------------
  {
    const w = world([{ name: 'Table1', table: 'Table1' }, { name: 'Config', table: CONFIG }, { name: 'Comments', table: COMMENTS }, { name: 'Probe', table: PROBE }]);
    w.selfUrl = ''; // dans GFS, le cadre n'a pas l'adresse que Grist connaît
    const r = settle(w);
    assert.strictEqual(r.how, 'config');
    assert.strictEqual(shape(w), 'Table1\nConfig\n  Comments\n  Probe');
    assert.deepStrictEqual(optionsOf(w, 'Config'), { [P.MARK_KEY]: true, collapsed: true }, 'le dossier est marqué ET replié');
    assert.deepStrictEqual(plan(w).actions, []);
    // Config seule : rien à écrire (pas d'écriture pour rien) ; Comments arrive ensuite : rangée sous Config, repli posé alors.
    const solo = world([{ name: 'Table1', table: 'Table1' }, { name: 'Config', table: CONFIG }]);
    solo.selfUrl = '';
    const alone = plan(solo);
    assert.deepStrictEqual(alone.actions, [], 'le dossier seul : aucune action');
    assert.strictEqual(alone.parent, solo.pages.id[1]);
    addTablePage(solo, 'Comments', COMMENTS);
    settle(solo);
    assert.strictEqual(shape(solo), 'Table1\nConfig\n  Comments');
    assert.deepStrictEqual(optionsOf(solo, 'Config'), { [P.MARK_KEY]: true, collapsed: true });
    // Sans page de Config (supprimée, ou pas encore créée) et sans page du widget : aucun parent, rien n'est déplacé.
    const noConfig = world([{ name: 'Table1', table: 'Table1' }, { name: 'Comments', table: COMMENTS }, { name: 'Probe', table: PROBE }]);
    noConfig.selfUrl = '';
    const none = plan(noConfig);
    assert.deepStrictEqual([none.actions, none.parent, none.how], [[], null, null]);
    console.log('OK rangement — dernier recours : Config devient le dossier replié, jamais d\'écriture pour une seule page, aucun parent sans Config');
  }

  // --- 7. Un groupe déjà formé garde son parent (même si le widget ne se reconnaît plus) -------------------------------------------------
  {
    const w = world([{ name: 'Table1', table: 'Table1' }, { name: 'Dashboard', widget: SELF.split('?')[0] }]);
    addTablePage(w, 'Config', CONFIG);
    addTablePage(w, 'Comments', COMMENTS);
    settle(w);
    addTablePage(w, 'Probe', PROBE);
    w.selfUrl = ''; // une autre session, depuis GFS : le widget ne retrouve plus sa page
    const r = settle(w);
    assert.strictEqual(r.how, 'group');
    assert.strictEqual(shape(w), 'Table1\nDashboard\n  Config\n  Comments\n  Probe', 'rejoint le groupe existant au lieu d\'un 2e niveau sous Config');
    console.log('OK rangement — un groupe déjà formé garde son parent d\'une session à l\'autre');
  }

  // --- 8. « Replié » : seulement quand il n'y a rien à cacher ni de choix explicite ------------------------------------------------------
  {
    const dash = SELF.split('?')[0];
    // Le parent a déjà une sous-page de la personne : elle reste visible, rien n'est replié.
    const kids = world([{ name: 'Dashboard', widget: dash }, { name: 'Mon détail', level: 1 }, { name: 'Config', table: CONFIG }, { name: 'Comments', table: COMMENTS }]);
    settle(kids);
    assert.strictEqual(shape(kids), 'Dashboard\n  Mon détail\n  Config\n  Comments');
    assert.deepStrictEqual(optionsOf(kids, 'Dashboard'), {}, 'les sous-pages de la personne ne sont pas cachées');
    // État explicite (même « déplié ») : jamais défait. Les autres clés des options sont conservées.
    for (const [before, expected] of [
      [JSON.stringify({ collapsed: false }), { collapsed: false }],
      [JSON.stringify({ collapsed: true }), { collapsed: true }],
      [JSON.stringify({ autre: 1 }), { autre: 1, collapsed: true }],
      ['', { collapsed: true }],
      ['pas du json', { collapsed: true }],
      ['[1,2]', { collapsed: true }],
      ['42', { collapsed: true }],
      ['null', { collapsed: true }]
    ]) {
      const w = world([{ name: 'Dashboard', widget: dash, options: before }, { name: 'Config', table: CONFIG }]);
      settle(w);
      assert.deepStrictEqual(optionsOf(w, 'Dashboard'), expected, `options « ${before} »`);
      assert.strictEqual(shape(w), 'Dashboard\n  Config');
    }
    // Les options d'une page interne (une clé de plus ou du JSON hostile) ne gênent pas la marque.
    const odd = world([{ name: 'Dashboard', widget: dash }, { name: 'Config', table: CONFIG, options: JSON.stringify({ icon: 'x' }) }, { name: 'Comments', table: COMMENTS, options: '{pas du json' }]);
    settle(odd);
    assert.deepStrictEqual(optionsOf(odd, 'Config'), { icon: 'x', [P.MARK_KEY]: true });
    assert.deepStrictEqual(optionsOf(odd, 'Comments'), { [P.MARK_KEY]: true });
    console.log('OK rangement — replié seulement sans enfant ni état explicite ; autres clés conservées ; JSON hostile toléré');
  }

  // --- 9. Sous-pages qui suivent, page qui contient le parent --------------------------------------------------------------------------
  {
    const dash = SELF.split('?')[0];
    // Config a une sous-page de la personne : elles partent ensemble, la hiérarchie relative est gardée.
    const w = world([{ name: 'Config', table: CONFIG }, { name: 'Détail de config', level: 1 }, { name: 'Sous-détail', level: 2 }, { name: 'Dashboard', widget: dash }, { name: 'Comments', table: COMMENTS }]);
    settle(w);
    assert.strictEqual(shape(w), 'Dashboard\n  Config\n    Détail de config\n      Sous-détail\n  Comments');
    // Le parent est DANS la page interne (Dashboard rangé sous Config par la personne) : on ne la déplace pas dans elle-même.
    const cycle = world([{ name: 'Config', table: CONFIG }, { name: 'Dashboard', level: 1, widget: dash }, { name: 'Comments', table: COMMENTS }]);
    const r = settle(cycle);
    assert.strictEqual(shape(cycle), 'Config\n  Dashboard\n    Comments', 'seule Comments est rangée ; Config (qui contient le parent) ne bouge pas');
    assert.ok(!r.nested.includes(cycle.pages.id[0]) && !r.marked.includes(cycle.pages.id[0]));
    // Une page interne déjà DANS le sous-arbre du parent est seulement marquée, pas déplacée.
    const inside = world([{ name: 'Dashboard', widget: dash }, { name: 'Comments', table: COMMENTS, level: 1 }, { name: 'Perso', level: 1 }]);
    const marked = plan(inside);
    assert.ok(!marked.nested.length && marked.marked.length === 1 && marked.actions.length === 1, 'marquée sur place');
    assert.strictEqual(marked.actions[0][3].options.length, 1);
    applyActions(inside, marked.actions);
    assert.strictEqual(shape(inside), 'Dashboard\n  Comments\n  Perso');
    console.log('OK rangement — une page part avec ses sous-pages ; celle qui contient le parent ne bouge pas ; celle déjà dessous est seulement marquée');
  }

  // --- 10. Tolérance aux tables mal formées ----------------------------------------------------------------------------------------------
  {
    for (const bad of [undefined, null, {}, { id: [] }, { id: 'x' }, [], 'texte', 42]) {
      assert.deepStrictEqual(P.plan({ tables: bad, pages: bad, sections: bad, selfUrl: SELF }).actions, [], `entrée ${JSON.stringify(bad)}`);
    }
    assert.deepStrictEqual(P.plan().actions, []);
    assert.deepStrictEqual(P.plan({}).actions, []);
    // Une table interne sans page (page supprimée) : ignorée ; une vue 0 ou inconnue aussi.
    const w = world([{ name: 'Dashboard', widget: SELF.split('?')[0] }, { name: 'Config', table: CONFIG }]);
    w.tables.primaryViewId[1] = 0;
    assert.deepStrictEqual(plan(w).actions, []);
    w.tables.primaryViewId[1] = 77777;
    assert.deepStrictEqual(plan(w).actions, []);
    // Tables sans la colonne `primaryViewId` (document trop ancien, mock de test) : rien, sans lever.
    const old = antoine();
    delete old.tables.primaryViewId;
    assert.deepStrictEqual(plan(old).actions, []);
    // Lignes de pages inutilisables : écartées (position non numérique), le reste est rangé.
    const messy = antoine();
    messy.pages.id.push(99); messy.pages.viewRef.push(1); messy.pages.indentation.push(0); messy.pages.pagePos.push('x'); messy.pages.shareRef.push(0); messy.pages.options.push('');
    assert.strictEqual(plan(messy).actions.length, 2);
    // Une indentation incohérente en base (saut de deux crans, négative, texte) est ramenée comme le fait le client.
    const crooked = world([{ name: 'Dashboard', widget: SELF.split('?')[0] }, { name: 'Config', table: CONFIG, level: 3 }, { name: 'Comments', table: COMMENTS, level: -2 }]);
    crooked.pages.indentation[2] = 'abc';
    settle(crooked);
    assert.strictEqual(shape(crooked), 'Dashboard\n  Config\n  Comments');
    // Positions égales (base abîmée) : on retombe sur « avant la page suivante » sans NaN ni intervalle vide.
    const ties = world([{ name: 'Dashboard', widget: SELF.split('?')[0] }, { name: 'Config', table: CONFIG }, { name: 'Zeta' }]);
    ties.pages.pagePos[1] = 1; ties.pages.pagePos[2] = 1;
    const tied = plan(ties);
    for (const v of tied.actions[0][3].pagePos) assert.ok(v === null || Number.isFinite(v));
    console.log('OK rangement — entrées absentes, mal formées, vue manquante, indentation incohérente, positions égales : jamais d\'exception ni de NaN');
  }

  // --- 11. Forme des actions ---------------------------------------------------------------------------------------------------------------
  {
    const w = antoine();
    const r = plan(w);
    assert.strictEqual(r.actions.length, 2);
    const [moves, opts] = r.actions;
    assert.deepStrictEqual(moves.slice(0, 2), ['BulkUpdateRecord', '_grist_Pages']);
    assert.deepStrictEqual(Object.keys(moves[3]).sort(), ['indentation', 'pagePos']);
    assert.deepStrictEqual(Object.keys(opts[3]), ['options']);
    JSON.stringify(r.actions); // sérialisable
    for (const v of moves[3].pagePos) assert.ok(v > 4 && v < 5, 'entre la page du widget et la page suivante (ou +1 à la fin)');
    assert.deepStrictEqual([...moves[3].pagePos].sort((a, b) => a - b), moves[3].pagePos, 'positions croissantes : l\'ordre des tables est gardé');
    assert.ok(new Set(moves[3].pagePos).size === moves[3].pagePos.length, 'positions distinctes');
    assert.ok(opts[3].options.every((o) => typeof o === 'string' && JSON.parse(o)), 'options : du JSON texte');
    // Le plan ne modifie pas ses entrées.
    const before = JSON.stringify([w.tables, w.pages, w.sections]);
    plan(w);
    assert.strictEqual(JSON.stringify([w.tables, w.pages, w.sections]), before);
    // Adresses : exposées pour les essais, jamais d'exception.
    assert.strictEqual(P.normalizeWidgetUrl('https://A.b/c/d/index.html?x#y'), 'a.b/c/d');
    assert.strictEqual(P.normalizeWidgetUrl('https://a.b/'), 'a.b');
    for (const bad of [undefined, null, 5, '', '   ', 'a.b/c', 'javascript:alert(1)', 'file:///x', 'data:text/html,x', 'ftp://a.b/c']) assert.strictEqual(P.normalizeWidgetUrl(bad), '', String(bad));
    console.log('OK rangement — forme des actions (deux écritures, positions croissantes et distinctes, options en JSON texte, entrées intactes), adresses');
  }

  // --- 12. Le vrai js/grist-api.js sur le faux Grist du harnais -------------------------------------------------------------------------
  {
    const data = require('../js/data.js');
    const i18n = require('../js/i18n.js');
    function boot(withPlan = true) {
      const warnings = [];
      const sandbox = { console: { error() {}, log() {}, warn: (...a) => warnings.push(a.join(' ')) }, setTimeout: (fn) => { fn(); return 0; }, URL, location: { href: SELF } };
      sandbox.window = sandbox;
      vm.runInNewContext(read('dev-tests', 'grist-stub.js'), sandbox);
      sandbox.GristBI = { data, i18n, state: { DEFAULT_PAGE_ID: 'page_default' } };
      if (withPlan) vm.runInNewContext(read('js', 'internal-pages.js'), sandbox);
      vm.runInNewContext(read('js', 'grist-api.js'), sandbox);
      return { sandbox, api: sandbox.GristBI.api, warnings };
    }
    const fetch = async (sb, t) => plain(await sb.grist.docApi.fetchTable(t));
    const treeOfStub = async (sb) => {
      const pages = await sb.grist.docApi.fetchTable('_grist_Pages');
      const views = await sb.grist.docApi.fetchTable('_grist_Views');
      const rows = pages.id.map((id, i) => ({ pos: pages.pagePos[i], ind: pages.indentation[i], name: views.name[views.id.indexOf(pages.viewRef[i])] })).sort((a, b) => a.pos - b.pos);
      let max = 0;
      return rows.map((r) => { const level = Math.min(max, r.ind); max = level + 1; return '  '.repeat(level) + r.name; }).join('\n');
    };

    // Les trois créations rangent leur page (le faux Grist ne contient pas la page du widget : dernier recours, Config en dossier).
    {
      const { sandbox, api, warnings } = boot();
      await sandbox.grist.docApi.applyUserActions([['AddTable', 'Ventes', [{ id: 'A', type: 'Text' }]]]);
      await api.loadConfig('Ventes'); // crée BI_Dashboard_Config -> premier rangement
      await api.organizeInternalPages();
      assert.strictEqual(await treeOfStub(sandbox), 'Ventes\n' + CONFIG, 'Config seule : rien à ranger');
      await api.loadOrCreateComments(); // crée BI_Dashboard_Comments -> rangée sous Config
      await api.organizeInternalPages();
      assert.strictEqual(await treeOfStub(sandbox), `Ventes\n${CONFIG}\n  ${COMMENTS}`, 'loadOrCreateComments range sa page');
      await api.getCurrentUserEmail(); // crée BI_Dashboard_UserProbe (la détection de l'auteur échoue sans moteur de formules : sans importance)
      await api.organizeInternalPages();
      assert.strictEqual(await treeOfStub(sandbox), `Ventes\n${CONFIG}\n  ${COMMENTS}\n  ${PROBE}`, 'ensureUserProbeTableExists range sa page');
      const pages = await fetch(sandbox, '_grist_Pages');
      const config = pages.id[pages.options.findIndex((o) => o.includes('collapsed'))];
      assert.ok(config, 'le dossier est replié');
      assert.deepStrictEqual(warnings, [], 'aucun avertissement');
      // Une fois rangé, le rangement ne réécrit plus rien (relancer ne change aucune ligne).
      const snapshot = JSON.stringify(await fetch(sandbox, '_grist_Pages'));
      await api.organizeInternalPages(); await api.organizeInternalPages();
      assert.strictEqual(JSON.stringify(await fetch(sandbox, '_grist_Pages')), snapshot);
    }

    // Appels concurrents : sérialisés (le 2e lit ce que le 1er a écrit) -> exactement un jeu d'écritures.
    {
      const { sandbox, api } = boot();
      await sandbox.grist.docApi.applyUserActions([['AddTable', 'Ventes', [{ id: 'A', type: 'Text' }]], ['AddTable', CONFIG, [{ id: 'TableId', type: 'Text' }]], ['AddTable', COMMENTS, [{ id: 'TableId', type: 'Text' }]]]);
      const sent = [];
      const real = sandbox.grist.docApi.applyUserActions;
      sandbox.grist.docApi.applyUserActions = async (a) => { sent.push(a); return real(a); };
      const results = await Promise.all([api.organizeInternalPages(), api.organizeInternalPages(), api.organizeInternalPages()]);
      assert.strictEqual(sent.length, 1, 'trois appels simultanés : une seule application');
      assert.ok(results[0].actions.length === 2 && results[1].actions.length === 0 && results[2].actions.length === 0);
      assert.strictEqual(await treeOfStub(sandbox), `Ventes\n${CONFIG}\n  ${COMMENTS}`);
    }

    // Erreurs : jamais d'exception, un seul avertissement par session, le widget continue.
    {
      const { sandbox, api, warnings } = boot();
      await sandbox.grist.docApi.applyUserActions([['AddTable', CONFIG, [{ id: 'TableId', type: 'Text' }]], ['AddTable', COMMENTS, [{ id: 'TableId', type: 'Text' }]]]);
      const realFetch = sandbox.grist.docApi.fetchTable;
      sandbox.grist.docApi.fetchTable = async (t) => { if (t === '_grist_Pages') throw new Error('GFS_REFUSE : table système'); return realFetch(t); };
      for (let i = 0; i < 3; i++) assert.strictEqual(await api.organizeInternalPages(), null);
      assert.strictEqual(warnings.length, 1, 'un seul avertissement');
      assert.ok(/Rangement des pages/.test(warnings[0]) && /GFS_REFUSE/.test(warnings[0]));
      sandbox.grist.docApi.fetchTable = realFetch;
      const realApply = sandbox.grist.docApi.applyUserActions;
      sandbox.grist.docApi.applyUserActions = async () => { throw new Error('lecture seule'); };
      assert.strictEqual(await api.organizeInternalPages(), null, 'écriture refusée : null, pas d\'exception');
      assert.strictEqual(warnings.length, 1);
      sandbox.grist.docApi.applyUserActions = realApply;
      const ok = await api.organizeInternalPages(); // une session suivante, avec des droits : rangé, rien n'avait été marqué
      assert.ok(ok && ok.actions.length === 2, 'un refus ne marque rien : le rangement se fera à la prochaine session');
    }

    // Module absent (page ouverte sans js/internal-pages.js) : null, aucun appel à Grist, aucun avertissement.
    {
      const { sandbox, api, warnings } = boot(false);
      let calls = 0;
      const realFetch = sandbox.grist.docApi.fetchTable;
      sandbox.grist.docApi.fetchTable = async (t) => { calls++; return realFetch(t); };
      assert.strictEqual(await api.organizeInternalPages(), null);
      assert.strictEqual(calls, 0);
      assert.deepStrictEqual(warnings, []);
    }
    console.log('OK rangement — vrai grist-api.js sur le faux Grist : les trois créations rangent, appels sérialisés, erreurs attrapées (un avertissement), module absent toléré');
  }

  // --- 13. Câblage ------------------------------------------------------------------------------------------------------------------------
  {
    for (const [file, prefix] of [['index.html', ''], ['dev-tests/harness.html', '../']]) {
      const html = read(...file.split('/'));
      const a = html.indexOf(`<script src="${prefix}js/internal-pages.js">`);
      const b = html.indexOf(`<script src="${prefix}js/grist-api.js">`);
      assert.ok(a > 0 && b > a, `${file} : js/internal-pages.js se charge avant js/grist-api.js`);
    }
    const api = read('js', 'grist-api.js');
    assert.strictEqual((api.match(/organizeInternalPages\(\);/g) || []).length, 3, 'trois appels : création de Config, démarrage (Comments), création de la sonde');
    assert.ok(/AddTable', USER_PROBE_TABLE[\s\S]{0,900}organizeInternalPages\(\);/.test(api), 'après la création de la sonde');
    assert.ok(/async function loadOrCreateComments[\s\S]{0,700}organizeInternalPages\(\);/.test(api), 'au démarrage, via loadOrCreateComments');
    assert.ok(/_rawTables\.push\(CONFIG_TABLE\);\s*organizeInternalPages\(\);/.test(api), 'après la création de Config');
    // Aucune écriture de `_grist_Pages` ailleurs que par les actions du module, et jamais `setOption` (non enregistré tant que la personne ne sauvegarde pas).
    const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/setOption/.test(codeOnly(api) + codeOnly(read('js', 'internal-pages.js'))), 'jamais grist.setOption/setOptions pour retenir quoi que ce soit');
    assert.ok(!/RemoveRecord|RemoveTable|RemoveView|RenameTable/.test(read('js', 'internal-pages.js')), 'le module ne supprime ni ne renomme rien');
    assert.ok(Object.keys(require('../js/internal-pages.js')).includes('plan'));
    assert.deepStrictEqual(P.INTERNAL_TABLE_IDS, [CONFIG, COMMENTS, PROBE]);
    // Les trois noms de table sont ceux de js/grist-api.js (jamais deux listes qui divergent).
    for (const id of P.INTERNAL_TABLE_IDS) assert.ok(api.includes(`'${id}'`), `${id} existe dans grist-api.js`);
    console.log('OK rangement — câblage : ordre des scripts, les trois appels, jamais setOption ni suppression');
  }

  console.log('\nTous les tests du rangement des pages internes sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
