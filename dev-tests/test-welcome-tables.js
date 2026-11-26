/*
 * L'écran d'accueil propose aussi les AUTRES tables du document (js/welcome.js + js/main-panel.js:welcomeOtherTables, lot 3B du chantier
 * « Colonnes de toutes les tables », 26/11/2026) :
 *
 *   node dev-tests/test-welcome-tables.js
 *
 * Quatre sortes d'essais :
 *  1. LA COLLE DE L'ACCUEIL, jouée sous un faux DOM (le vrai `js/welcome.js`, évalué dans un contexte `vm`) : les suggestions de la table de travail
 *     se dessinent d'abord, SANS attendre les autres tables ; celles des autres tables s'AJOUTENT à la suite (jamais avant, les cartes déjà dessinées
 *     ne sont jamais refaites), chacune dit sa table, son bouton aussi, son aperçu est dessiné avec SES lignes ; un clic pose la tuile qui porte
 *     `table` ; « Ajouter ces N » ne porte que sur les trois premières ; un résultat périmé (autres lignes, autre langue, accueil masqué) n'écrit rien ;
 *     une demande annulée se refait quand l'accueil revient avec les mêmes lignes, une demande reçue ne se refait pas ; un échec ou un résultat vide
 *     ne retire jamais les cartes ;
 *  2. LE CÂBLAGE lu dans les sources (`welcomeOtherTables` : aucune tuile à confronter, quatre propositions au plus, aperçu avec les lignes de la table,
 *     lecture silencieuse partagée avec « Pour compléter » ; `js/main-render.js` branche le rappel ; textes fr/en ; style) ;
 *  3. VERSIONS FAUTIVES : chacune des erreurs plausibles de `js/welcome.js` est vue par les vérifications du bloc 1 ;
 *  4. un tableau de bord qui n'a qu'UNE table se comporte comme avant (le rappel rend une liste vide : aucune carte de plus, aucun message).
 *
 * Le geste réel (un VRAI clic dans la vraie page, sous sa politique de sécurité, page directe et cadre isolé) se joue dans dev-tests/test-browser.js,
 * scénarios « accueil sur tout le document ».
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const i18n = require('../js/i18n.js');
const { read } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const same = (a, b, msg) => { checks += 1; assert.strictEqual(a, b, msg); };

// --------------------------------------------------------------------------------------------------------------------
// Un faux DOM : juste ce que `js/welcome.js` touche.
// --------------------------------------------------------------------------------------------------------------------
class FakeNode {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; }
    };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, evt) { (this.listeners[type] || []).forEach((fn) => fn(evt)); }
}

// `setHtml(el, html)` : les `<li class="…">…</li>` deviennent des nœuds (leur balisage reste lisible, `extra` dit s'ils sont repliés).
function fakeSetHtml(el, html) {
  el.children = [];
  const re = /<li class="([^"]*)">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html))) {
    const li = new FakeNode('li');
    li.cls = m[1];
    li.extra = /welcome-card-extra/.test(m[1]);
    li.html = m[2];
    li.parent = el;
    el.children.push(li);
  }
}

const IDS = ['welcome-suggestions', 'welcome-no-rows', 'welcome-suggestions-body', 'welcome-cards', 'welcome-add-all', 'welcome-more', 'welcome-import'];

// Monte le VRAI `js/welcome.js` sur ce faux DOM. `previews` note les lignes avec lesquelles chaque aperçu a été dessiné.
function mount(source, opts) {
  const nodes = {};
  IDS.forEach((id) => { nodes[id] = new FakeNode(id); });
  const document = { getElementById: (id) => nodes[id], createElement: () => new FakeNode('ul') };
  const warns = [];
  const previews = [];
  const world = { suggestions: [] };
  const G = {
    i18n,
    safeHtml: { setHtml: fakeSetHtml },
    advice: {
      suggestTiles: () => world.suggestions,
      previewFor: (tileData, rows) => { previews.push({ tileData, rows }); return null; }
    }
  };
  const self = { GristBI: G };
  vm.runInNewContext(source, { self, document, console: { warn: (...a) => warns.push(a.join(' ')), error() {}, log() {} }, Intl });
  const added = [];
  const calls = [];
  const cfg = {
    addTile: (tileData, index) => added.push({ tileData, index }),
    importPowerBi() {},
    otherTables: (state, lang, isStale) => new Promise((resolve, reject) => { calls.push({ state, lang, isStale, resolve, reject }); })
  };
  if (opts && opts.withoutOthers) delete cfg.otherTables;
  G.welcome.init(cfg);
  return { G, nodes, world, added, calls, warns, previews, welcome: G.welcome, cards: nodes['welcome-cards'] };
}

const mk = (n, extra) => Array.from({ length: n }, (_, i) => Object.assign({
  titleKey: 'welcome.title', reasonKey: 'welcome.subtitle', tileData: { type: 'bar', dimension: 'D' + i }
}, extra || {}));
const others = (table, n) => mk(n).map((s, i) => Object.assign(s, { table, tileData: { type: 'pie', dimension: 'O' + i, table }, rows: [{ marker: table }] }));
const stateOf = (rows, tiles) => ({ rows, tiles: tiles || [] });
const rowsOf = () => [{ a: 1 }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const WELCOME_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'welcome.js'), 'utf8');

// Tout ce que la colle doit tenir : rendu sur une copie du source (le vrai ou une version fautive).
async function glueChecks(source) {
  i18n.setLang('fr');
  // --- Les suggestions de la table de travail d'abord, sans attendre les autres tables --------------------------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(6);
    const rows = rowsOf();
    m.welcome.update(stateOf(rows), true, 'Ventes');
    same(m.cards.children.length, 6, 'les six suggestions de la table de travail sont dessinées tout de suite');
    same(m.calls.length, 1, 'les autres tables sont demandées une fois');
    ok(typeof m.calls[0].isStale === 'function' && m.calls[0].state.rows === rows && m.calls[0].lang === 'fr', 'avec l\'état, la langue et un test de péremption');
    ok(m.cards.children.slice(0, 3).every((li) => !li.extra) && m.cards.children.slice(3).every((li) => li.extra), 'trois cartes d\'emblée, les autres repliées');
    same(m.nodes['welcome-add-all'].textContent, 'Ajouter ces 3 visualisations', '« Ajouter ces 3 » avant l\'arrivée des autres tables');
    ok(m.nodes['welcome-more'].hidden === false, '« Voir d\'autres suggestions » existe déjà (les suggestions repliées de la table de travail)');
    const firstThree = m.cards.children.slice(0, 3);
    const sixth = m.cards.children[5];

    // --- Elles arrivent plus tard : ajoutées à la suite, jamais avant, les cartes déjà là ne sont pas refaites --------------------------------------
    m.calls[0].resolve(others('Clients', 2).concat(others('Activite', 1)));
    await tick();
    same(m.cards.children.length, 9, 'trois cartes d\'autres tables à la suite');
    ok(m.cards.children.slice(0, 3).every((li, i) => li === firstThree[i]), 'les trois premières cartes sont les MÊMES nœuds (jamais refaites)');
    ok(m.cards.children[5] === sixth, 'ni les suggestions repliées de la table de travail');
    ok(m.cards.children.slice(6).every((li) => li.extra), 'les cartes des autres tables sont repliées avec les autres suggestions');
    ok(/data-suggestion="6"/.test(m.cards.children[6].html) && /data-suggestion="8"/.test(m.cards.children[8].html), 'leur rang continue celui de la table de travail');
    ok(/Dans la table « Clients »/.test(m.cards.children[6].html) && /Dans la table « Activite »/.test(m.cards.children[8].html), 'chaque carte dit sa table');
    ok(!/welcome-card-table/.test(m.cards.children[0].html), 'une carte de la table de travail ne dit aucune table');
    ok(/aria-label="Ajouter la visualisation « Pour commencer » \(table « Clients »\)"/.test(m.cards.children[6].html), 'le bouton dit la table');
    ok(/aria-label="Ajouter la visualisation « Pour commencer »"/.test(m.cards.children[0].html), 'celui de la table de travail ne la dit pas');
    ok(m.previews.some((p) => Array.isArray(p.rows) && p.rows[0] && p.rows[0].marker === 'Clients'), 'l\'aperçu d\'une carte d\'une autre table est dessiné avec SES lignes');
    ok(m.previews.some((p) => p.rows === rows), 'celui de la table de travail avec les siennes');
    same(m.nodes['welcome-add-all'].textContent, 'Ajouter ces 3 visualisations', '« Ajouter ces N » ne compte que les trois premières');

    // --- Un clic sur une carte d'une autre table pose une tuile qui lit cette table ----------------------------------------------------------------
    const click = (index) => m.cards.fire('click', { target: { closest: () => ({ dataset: { suggestion: String(index) } }) } });
    click(7);
    same(m.added.length, 1, 'un clic = une tuile');
    same(m.added[0].tileData.table, 'Clients', 'qui lit la table de la carte');
    same(m.added[0].tileData.dimension, 'O1', 'et c\'est bien la tuile de CETTE carte');
    click(1);
    same(m.added[1].tileData.table, undefined, 'une carte de la table de travail pose une tuile sans champ table');
    m.nodes['welcome-add-all'].fire('click');
    same(m.added.length, 5, '« Ajouter ces N » pose les trois premières');
    ok(m.added.slice(2).every((a) => a.tileData.table === undefined), 'toutes de la table de travail');

    // --- Les mêmes lignes : rien ne se redemande, rien ne se redessine -------------------------------------------------------------------------------
    m.welcome.update(stateOf(rows), true, 'Ventes');
    m.welcome.update(stateOf(rows), true, 'Ventes');
    same(m.calls.length, 1, 'une demande reçue ne se refait pas pour les mêmes lignes');
    same(m.cards.children.length, 9, 'et rien ne se redessine');
    // --- Une autre langue ou d'autres lignes : tout se refait ---------------------------------------------------------------------------------------
    i18n.setLang('en');
    m.welcome.update(stateOf(rows), true, 'Ventes');
    same(m.calls.length, 2, 'une autre langue redemande les autres tables');
    same(m.calls[1].lang, 'en', 'dans la nouvelle langue');
    same(m.cards.children.length, 6, 'les cartes d\'avant (phrases de l\'ancienne langue) sont retirées');
    i18n.setLang('fr');
  }

  // --- Un résultat périmé n'écrit rien --------------------------------------------------------------------------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(4);
    const a = rowsOf();
    m.welcome.update(stateOf(a), true, 'Ventes');
    const b = rowsOf();
    m.welcome.update(stateOf(b), true, 'Ventes');
    same(m.calls.length, 2, 'd\'autres lignes redemandent les autres tables');
    m.calls[0].resolve(others('Vieux', 2));
    await tick();
    same(m.cards.children.length, 4, 'la réponse pour les anciennes lignes n\'écrit rien');
    ok(m.calls[0].isStale(), 'elle est déclarée périmée');
    ok(!m.calls[1].isStale(), 'celle des lignes actuelles ne l\'est pas');
    m.calls[1].resolve(others('Clients', 1));
    await tick();
    same(m.cards.children.length, 5, 'celle des lignes actuelles s\'ajoute');
  }

  // --- L'accueil masqué (une tuile posée) annule la demande ; il revient, elle se refait --------------------------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(4);
    const rows = rowsOf();
    m.welcome.update(stateOf(rows), true, 'Ventes');
    m.welcome.update(stateOf(rows, [{ id: 't1' }]), true, 'Ventes');
    ok(m.calls[0].isStale(), 'une tuile posée : la demande en vol est périmée');
    m.calls[0].resolve(others('Clients', 2));
    await tick();
    same(m.cards.children.length, 4, 'sa réponse n\'écrit rien');
    m.welcome.update(stateOf(rows), true, 'Ventes');
    same(m.calls.length, 2, 'l\'accueil revient avec les mêmes lignes : la demande annulée se refait');
    m.calls[1].resolve(others('Clients', 2));
    await tick();
    same(m.cards.children.length, 6, 'et sa réponse s\'ajoute');
    // Plus de table connectée : pareil.
    const m2 = mount(source);
    m2.world.suggestions = mk(4);
    const r2 = rowsOf();
    m2.welcome.update(stateOf(r2), true, 'Ventes');
    m2.welcome.update(stateOf(r2), false, 'Ventes');
    ok(m2.calls[0].isStale(), 'table non connectée : la demande est périmée');
  }

  // --- Table sans ligne : aucune demande ------------------------------------------------------------------------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(3);
    m.welcome.update(stateOf([]), true, 'Vide');
    same(m.calls.length, 0, 'une table sans ligne ne demande aucune autre table');
    ok(m.nodes['welcome-add-all'].hidden === true, 'et n\'affiche pas « Ajouter ces N »');
  }

  // --- Moins de trois suggestions : les autres tables remplissent le premier niveau et les boutons suivent -------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(1);
    m.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    ok(m.nodes['welcome-add-all'].hidden === true && m.nodes['welcome-more'].hidden === true, 'une seule suggestion : ni « Ajouter ces N » ni « Voir d\'autres »');
    m.calls[0].resolve(others('Clients', 2));
    await tick();
    same(m.cards.children.length, 3, 'trois cartes');
    ok(m.cards.children.every((li) => !li.extra), 'toutes d\'emblée (la table de travail en a moins de trois)');
    ok(m.nodes['welcome-add-all'].hidden === false && m.nodes['welcome-add-all'].textContent === 'Ajouter ces 3 visualisations', '« Ajouter ces 3 » apparaît');
    ok(m.nodes['welcome-more'].hidden === true, 'rien à déplier');
  }
  {
    // Trois suggestions : « Voir d'autres suggestions » naît de l'arrivée des autres tables.
    const m = mount(source);
    m.world.suggestions = mk(3);
    m.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    ok(m.nodes['welcome-more'].hidden === true, 'trois suggestions : rien à déplier');
    m.calls[0].resolve(others('Clients', 1));
    await tick();
    ok(m.nodes['welcome-more'].hidden === false, 'l\'arrivée d\'une autre table fait apparaître « Voir d\'autres suggestions »');
    ok(m.cards.children[3].extra, 'la carte est repliée');
  }
  {
    // Aucune suggestion pour la table de travail : le bloc se montre quand une autre table en apporte.
    const m = mount(source);
    m.world.suggestions = [];
    m.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    ok(m.nodes['welcome-suggestions-body'].hidden === true, 'aucune suggestion : le bloc est masqué');
    m.calls[0].resolve(others('Clients', 1));
    await tick();
    ok(m.nodes['welcome-suggestions-body'].hidden === false, 'une autre table en apporte : le bloc se montre');
  }

  // --- Un échec ou un résultat vide ne retire rien ; un résultat reçu ne se redemande pas -----------------------------------------------------------------
  {
    const m = mount(source);
    m.world.suggestions = mk(5);
    const rows = rowsOf();
    m.welcome.update(stateOf(rows), true, 'Ventes');
    m.calls[0].reject(new Error('lecture impossible'));
    await tick();
    same(m.cards.children.length, 5, 'un échec laisse les cartes de la table de travail');
    ok(m.warns.some((w) => /autres tables/.test(w)), 'et le dit en console (avertissement, jamais une erreur)');
    m.welcome.update(stateOf(rows), true, 'Ventes');
    same(m.calls.length, 1, 'un échec reçu ne se redemande pas à chaque rendu');
    const e = mount(source);
    e.world.suggestions = mk(5);
    e.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    e.calls[0].resolve([]);
    await tick();
    same(e.cards.children.length, 5, 'un résultat vide ne change rien');
    e.welcome.update(stateOf(e.calls[0].state.rows), true, 'Ventes');
    same(e.calls.length, 1, 'et ne se redemande pas');
    const n = mount(source);
    n.world.suggestions = mk(5);
    n.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    n.calls[0].resolve(null);
    await tick();
    same(n.cards.children.length, 5, 'un résultat périmé (null) ne change rien');
  }

  // --- Sans rappel `otherTables` (un autre hôte) : l'accueil marche comme avant ----------------------------------------------------------------------
  {
    const m = mount(source, { withoutOthers: true });
    m.world.suggestions = mk(4);
    m.welcome.update(stateOf(rowsOf()), true, 'Ventes');
    same(m.cards.children.length, 4, 'sans rappel : les suggestions de la table de travail seules');
    same(m.calls.length, 0, 'aucune demande');
  }
}

(async () => {
  await glueChecks(WELCOME_SOURCE);
  console.log(`OK colle de l'accueil — ${checks} vérifications : table de travail d'abord, autres tables à la suite (cartes déjà là jamais refaites), table dite, aperçu avec ses lignes, clic = tuile qui porte sa table, résultat périmé sans effet, demande annulée refaite, échec et vide sans effet`);

  // ------------------------------------------------------------------------------------------------------------------
  // 2. CÂBLAGE lu dans les sources
  // ------------------------------------------------------------------------------------------------------------------
  const panel = read('js', 'main-panel.js');
  const render = read('js', 'main-render.js');
  const css = read('css', 'style.css');
  const body = panel.slice(panel.indexOf('async function welcomeOtherTables('), panel.indexOf('// `afterPaint` (facultatif) : appelé une fois la liste dessinée'));
  ok(body.length > 150, 'welcomeOtherTables existe');
  ok(/profileOtherTables\(state, \[\], lang, stale\)/.test(body), 'aucune tuile à confronter : un tableau de bord vide');
  ok(/adviceTables\.merge\(got\.parts, \{ limit: WELCOME_OTHER_LIMIT \}\)/.test(body) && /const WELCOME_OTHER_LIMIT = 4;/.test(panel), 'quatre propositions au plus, fusionnées comme « Pour compléter »');
  ok(/item\.rows = got\.rowsOf\[item\.table\]/.test(body), 'chaque proposition porte les lignes de SA table (aperçu)');
  ok(/if \(got === null\) return null;/.test(body), 'un résultat périmé reste périmé');
  ok(/!state\.rows\.length\) return \[\]/.test(body), 'une table de travail sans ligne ne fait rien lire');
  ok(/welcomeOtherTables\s*\}\);/.test(panel) || /updatePanelTexts, welcomeOtherTables/.test(panel), 'exportée vers le fichier de l\'écran');
  ok(/readWithin\(suggestionTable\(name\), SUGGESTION_READ_TIMEOUT_MS\)/.test(panel), 'la lecture est la lecture silencieuse de « Pour compléter » (une lecture par table en tout)');
  ok(/otherTables: \(state, lang, isStale\) => parts\.welcomeOtherTables\(state, lang, isStale\)/.test(render), 'main-render.js branche le rappel de l\'accueil');
  ok(/G\.safeHtml\.setHtml\(holder,/.test(WELCOME_SOURCE) && !/\.innerHTML\s*=/.test(WELCOME_SOURCE), 'le balisage passe par safeHtml, jamais innerHTML');
  ok(/escapeHtml\(t\('welcome\.table', \{ table: s\.table \}\)\)/.test(WELCOME_SOURCE), 'le nom de la table est échappé');
  const i18nSource = read('js', 'i18n.js');
  ['welcome.table', 'welcome.addAriaTable'].forEach((k) => {
    const entry = new RegExp(`'${k.replace(/\./g, '\\.')}': \\{ fr: '([^']+)', en: '([^']+)' \\}`).exec(i18nSource);
    ok(entry && entry[1].indexOf('{table}') !== -1 && entry[2].indexOf('{table}') !== -1, `${k} : fr et en nomment la table`);
  });
  i18n.setLang('fr');
  same(i18n.t('welcome.table', { table: 'Clients' }), 'Dans la table « Clients »');
  same(i18n.t('welcome.addAriaTable', { title: 'Barres', table: 'Clients' }), 'Ajouter la visualisation « Barres » (table « Clients »)');
  i18n.setLang('en');
  same(i18n.t('welcome.table', { table: 'Clients' }), 'In the “Clients” table');
  same(i18n.t('welcome.addAriaTable', { title: 'Bars', table: 'Clients' }), 'Add the visualization “Bars” (“Clients” table)');
  i18n.setLang('fr');
  ok(/\.welcome-card-table\s*\{/.test(css), 'la ligne de la table est stylée');
  console.log('OK câblage — welcomeOtherTables (un tableau de bord vide, 4 au plus, lignes de la table), rappel branché, fr/en, style');

  // ------------------------------------------------------------------------------------------------------------------
  // 3. VERSIONS FAUTIVES : chacune doit être vue
  // ------------------------------------------------------------------------------------------------------------------
  const MUTANTS = [
    ['les rangs repartent de zéro (un clic poserait la mauvaise tuile)', 'const base = shown.suggestions.length;', 'const base = 0;'],
    ['une réponse périmée écrit quand même', "      if (isStale()) return;\n      shown.others = 'done';", "      shown.others = 'done';"],
    ["l'accueil masqué n'annule pas la demande", "if (!empty) { cancelOthers(); return; }", "if (!empty) { return; }"],
    ["une demande annulée ne se refait jamais", "if (shown.others === 'idle') loadOthers(state, lang);", ''],
    ["une demande reçue se redemande à chaque rendu", "      shown.others = 'done';\n      if (!Array.isArray(items)", "      shown.others = 'idle';\n      if (!Array.isArray(items)"],
    ["les boutons ne suivent pas l'arrivée des autres tables", "      refreshControls();\n    }).catch", "    }).catch"],
    ['la table de la carte pas dite', "${other ? `<p class=\"welcome-card-table\">${escapeHtml(t('welcome.table', { table: s.table }))}</p>` : ''}", ''],
    ['le bouton ne dit pas la table', "const addAria = other ? t('welcome.addAriaTable', { title, table: s.table }) : t('welcome.addAria', { title });", "const addAria = t('welcome.addAria', { title });"],
    ["l'aperçu avec les lignes de la table de travail", 'previewFor(s.tileData, Array.isArray(s.rows) ? s.rows : rows)', 'previewFor(s.tileData, rows)'],
    ['les cartes déjà dessinées sont refaites', 'while (holder.firstChild) cards.appendChild(holder.firstChild);', "G.safeHtml.setHtml(cards, shown.suggestions.map((s, i) => cardHtml(s, i, state.rows, lang)).join(''));"],
    ["« Ajouter ces N » porte sur toutes les suggestions", 'shown.suggestions.slice(0, FIRST_SUGGESTIONS).forEach', 'shown.suggestions.forEach'],
    ["l'accueil sans ligne demande quand même", "    if (noRows) {\n      cancelOthers();", "    if (noRows) {\n      loadOthers(state, lang);"],
    ["un échec se redemande à chaque rendu", "if (!isStale()) shown.others = 'done';", "if (!isStale()) shown.others = 'idle';"],
    ['les cartes des autres tables passent devant', "shown.suggestions = shown.suggestions.concat(items);", "shown.suggestions = items.concat(shown.suggestions);"],
    ["la langue ne redemande rien", "if (shown.rows === state.rows && shown.lang === lang) {", "if (shown.rows === state.rows) {"]
  ];
  let seen = 0;
  for (const [label, from, to] of MUTANTS) {
    assert.ok(WELCOME_SOURCE.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/welcome.js`);
    let caught = false;
    try { await glueChecks(WELCOME_SOURCE.replace(from, to)); } catch (e) { caught = true; if (process.env.SHOW_MUTANTS) console.log("  vue :", label, "<-", String(e.message).split("\n")[0].slice(0, 100)); }
    assert.ok(caught, `version fautive non vue : ${label}`);
    seen += 1;
  }
  console.log(`OK versions fautives — ${seen} versions de js/welcome.js vues par les vérifications`);
  console.log('\nOK — l\'accueil propose aussi les autres tables : tous les essais passent');
})().catch((e) => { console.error(e); process.exit(1); });
