/*
 * Colonnes des tables liées dans les listes de choix (chantier « colonnes de toutes les tables », lot 1b, 26/11/2026) : la combobox sait ranger ses options
 * sous un intitulé de groupe et attendre une préparation (`prepare`) avant d'écrire une valeur et d'émettre `change` (`js/combobox.js`), les listes du
 * formulaire reçoivent les colonnes des tables liées (`js/main-fields.js:columnOptions`) et choisir l'une d'elles pose la jointure d'abord
 * (`js/main-session.js:ensureColumnJoined`). Lancer : node dev-tests/test-linked-columns.js
 * Le rangement par table (`groupColumns`, `kindOfType`) est essayé dans `dev-tests/test-table-graph.js` ; les VRAIS gestes (frappe, Entrée, clic) dans Chromium :
 * `dev-tests/test-browser.js` (étape 9, page directe ET cadre isolé). Ici : la combobox sous un faux DOM, ses versions fautives, et le câblage.
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const i18n = require('../js/i18n.js');
const { read, readMain } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(a, b, msg); };
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- Un faux DOM, juste ce que la combobox touche ---------------------------------------------------------------------------------------------
function unescape(text) { return text.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

function makeEl() {
  const listeners = {};
  const attrs = {};
  const el = {
    value: '', placeholder: '', hidden: false, html: '', attrs,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent(ev) { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; },
    fire(type, props) {
      const ev = Object.assign({ type, prevented: false, preventDefault() { ev.prevented = true; } }, props);
      (listeners[type] || []).slice().forEach((fn) => fn(ev));
      return ev;
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
    select() {},
    querySelectorAll(selector) {
      if (selector !== '.combobox-option') return [];
      const found = [];
      const re = /<li class="(combobox-option[^"]*)"([^>]*)>/g;
      let m;
      while ((m = re.exec(el.html))) {
        const value = /data-value="([^"]*)"/.exec(m[2]);
        found.push({ dataset: { value: value ? unescape(value[1]) : undefined }, classList: { toggle() {}, contains: (c) => m[1].split(' ').indexOf(c) !== -1 }, scrollIntoView() {} });
      }
      return found;
    },
    optionHtml() { return el.html.split('<li ').slice(1).map((s) => '<li ' + s); }
  };
  return el;
}

function loadCombobox(source) {
  const errors = [];
  const sandbox = { console: { error: (...a) => errors.push(a.join(' ')), warn() {}, log() {} }, Event, setTimeout, Promise };
  sandbox.self = sandbox;
  sandbox.GristBI = { safeHtml: { setHtml(el, html) { el.html = html; } } };
  vm.runInNewContext(source, sandbox);
  return Object.assign({}, sandbox.GristBI.combobox, { errors });
}

// ---- Les vérifications, rejouées ensuite sur des versions FAUTIVES -----------------------------------------------------------------------------
function comboChecks(combobox) {
  const setup = (options, setCfg, attachCfg) => {
    const input = makeEl();
    const list = makeEl();
    list.hidden = true;
    const changes = [];
    input.addEventListener('change', () => changes.push(input.value));
    combobox.attach(input, list, attachCfg || {});
    input.setOptions(options, setCfg);
    return { input, list, changes };
  };
  const ventes = (v) => ({ value: v, label: v, group: 'Ventes' });
  const OPTIONS = [ventes('Region'), ventes('Montant'),
    { value: 'Clients.Ville', label: 'Ville', group: 'Clients' }, { value: 'Clients.Nom', label: 'Nom', group: 'Clients' },
    { value: 'Personnes.Equipe', label: 'Equipe', group: 'Personnes', pending: true, title: 'Relie la table « Personnes »' }];

  // 1. Des chaînes seules : la liste d'avant, octet pour octet.
  {
    const { input, list, changes } = setup(['Region', 'Montant']);
    input.fire('focus');
    eq(list.html, '<li class="combobox-option" data-value="Region" role="option">Region</li><li class="combobox-option" data-value="Montant" role="option">Montant</li>', 'chaînes seules : le balisage d\'avant');
    ok(list.hidden === false && !list.html.includes('combobox-group'), 'aucun intitulé de groupe sans groupe');
    input.fire('keydown', { key: 'ArrowDown' });
    input.fire('keydown', { key: 'Enter' });
    eq(changes, ['Region'], 'flèche bas puis Entrée : la 1re option');
    const objects = setup([{ value: 'a', label: 'A' }, { value: 'b' }]);
    objects.input.fire('focus');
    eq(objects.list.optionHtml().map((r) => r.replace(/<[^>]+>/g, '')), ['A', 'b'], 'des options-objets sans groupe : aucun intitulé, libellé ou valeur');
    ok(!objects.list.html.includes('combobox-group') && !objects.list.html.includes('combobox-option-grouped'), 'ni intitulé ni retrait sans groupe');
    const blank = setup(['a', 'b'], { blankLabel: '(aucun)' });
    blank.input.fire('focus');
    ok(blank.list.html.indexOf('<li class="combobox-option" data-value="" role="option">(aucun)</li>') === 0, 'l\'option « (aucun) » reste la première');
    const many = setup(Array.from({ length: 80 }, (_, i) => 'c' + i));
    many.input.fire('focus');
    eq(many.list.querySelectorAll('.combobox-option').length, 50, 'une liste simple s\'arrête à 50 options');
  }

  // 2. Des options rangées par table : un intitulé par groupe, la colonne seule dessous, jamais l'intitulé compté comme une option.
  {
    const { input, list, changes } = setup(OPTIONS);
    input.fire('focus');
    const rows = list.optionHtml();
    eq(rows.filter((r) => r.includes('combobox-group')).map((r) => r.replace(/<[^>]+>/g, '')), ['Ventes', 'Clients', 'Personnes'], 'un intitulé par table, dans l\'ordre');
    ok(rows.filter((r) => r.includes('combobox-group')).every((r) => /role="presentation"/.test(r) && !/data-value/.test(r)), 'un intitulé n\'est ni une option ni une valeur');
    eq(list.querySelectorAll('.combobox-option').length, 5, 'cinq options, intitulés non comptés');
    const ville = rows.find((r) => r.includes('data-value="Clients.Ville"'));
    ok(/>Ville<\/li>$/.test(ville), 'sous son intitulé : la colonne seule');
    ok(/aria-label="Clients\.Ville"/.test(ville) && /title="Clients\.Ville"/.test(ville), 'nom accessible et infobulle : la colonne entière');
    ok(/combobox-option-grouped/.test(ville) && !/combobox-option-pending/.test(ville), 'rangée (retrait) mais pas « en attente »');
    const equipe = rows.find((r) => r.includes('data-value="Personnes.Equipe"'));
    ok(/combobox-option-pending/.test(equipe) && /title="Relie la table « Personnes »"/.test(equipe), 'une colonne à relier : marquée, avec son infobulle');
    ok(!/aria-label=/.test(rows.find((r) => r.includes('data-value="Region"'))), 'une colonne de la table de travail (libellé = valeur) : pas de nom accessible en double');
    // Le clavier ne voit que les options : flèche bas x3 depuis l'ouverture = la 3e option (Clients.Ville), jamais un intitulé.
    input.fire('keydown', { key: 'ArrowDown' });
    input.fire('keydown', { key: 'ArrowDown' });
    input.fire('keydown', { key: 'ArrowDown' });
    input.fire('keydown', { key: 'Enter' });
    eq(changes, ['Clients.Ville'], 'la navigation clavier saute les intitulés');
  }

  // 3. Chercher : par la colonne (surlignée dans son libellé) ET par l'intitulé de la table ; un groupe sans résultat n'a pas d'intitulé.
  {
    const byGroup = setup(OPTIONS);
    byGroup.input.value = 'clients';
    byGroup.input.fire('input');
    eq(byGroup.list.optionHtml().map((r) => r.replace(/<[^>]+>/g, '')), ['Clients', 'Ville', 'Nom'], 'taper le nom de la table montre ses colonnes sous son seul intitulé');
    const byHome = setup(OPTIONS);
    byHome.input.value = 'ventes';
    byHome.input.fire('input');
    eq(byHome.list.optionHtml().map((r) => r.replace(/<[^>]+>/g, '')), ['Ventes', 'Region', 'Montant'], 'taper le nom de la table de travail montre ses colonnes (la valeur ne porte pas son nom)');
    const byColumn = setup(OPTIONS);
    byColumn.input.value = 'equipe';
    byColumn.input.fire('input');
    ok(/<mark>Equipe<\/mark>/.test(byColumn.list.html) && byColumn.list.optionHtml().length === 2, 'la colonne cherchée est surlignée dans son libellé, avec son intitulé');
    byColumn.input.fire('keydown', { key: 'Enter' });
    ok(byColumn.input.attrs['aria-busy'] === undefined && byColumn.changes.length === 1 && byColumn.changes[0] === 'Personnes.Equipe', 'sans `prepare`, une colonne « en attente » se choisit comme les autres');
    const none = setup(OPTIONS);
    none.input.value = 'zzz';
    none.input.fire('input');
    ok(none.list.hidden === true, 'aucune correspondance : liste fermée');
    eq(combobox.filterOptions(OPTIONS, 'personnes').map((o) => o.value), ['Personnes.Equipe'], 'filterOptions : par intitulé');
    eq(combobox.filterOptions(['a', 'b'], 'a'), ['a'], 'filterOptions : chaînes comme avant');
  }

  // 4. Mode strict : une valeur d'option, quelle que soit sa forme.
  {
    const { input } = setup(OPTIONS);
    input.value = 'Personnes.Equipe';
    input.fire('blur');
    eq(input.value, 'Personnes.Equipe', 'une valeur d\'option groupée reste valide');
    input.setOptions(OPTIONS);
    eq(input.value, 'Personnes.Equipe', 'rechargée avec les mêmes options : la valeur reste');
    input.value = 'Inconnue';
    input.fire('blur');
    eq(input.value, 'Personnes.Equipe', 'une valeur qui n\'est pas une option revient à la dernière valeur valide');
    input.setOptions([ventes('Region')]);
    eq(input.value, 'Region', 'une valeur qui n\'existe plus : la 1re option, comme un <select>');
    const grouped = setup(Array.from({ length: 260 }, (_, i) => ({ value: 'T.c' + i, label: 'c' + i, group: i < 130 ? 'A' : 'B' })));
    grouped.input.fire('focus');
    eq(grouped.list.querySelectorAll('.combobox-option').length, 200, 'une liste rangée par table montre jusqu\'à 200 options');
  }

  // 5. Choisir une colonne « en attente » : `prepare` d'abord, `change` ensuite.
  {
    const calls = [];
    let release;
    const prepare = (value, option) => { calls.push([value, option.group, option.pending]); return new Promise((resolve) => { release = resolve; }); };
    const { input, list, changes } = setup(OPTIONS, undefined, { prepare });
    input.setOptions(OPTIONS);
    input.value = 'Region';
    input.fire('blur');
    input.fire('focus');
    list.fire('click', { target: { closest: () => ({ dataset: { value: 'Personnes.Equipe' } }) } });
    eq(calls, [['Personnes.Equipe', 'Personnes', true]], '`prepare` reçoit la valeur et l\'option');
    eq(changes, [], 'pas de « change » tant que la préparation dure');
    ok(input.value === 'Personnes.Equipe' && input.attrs['aria-busy'] === 'true' && list.hidden === true, 'le champ montre le choix, « occupé », liste fermée');
    release(true);
    return tick().then(() => {
      eq(changes, ['Personnes.Equipe'], 'préparation réussie : un seul « change », avec la valeur');
      ok(input.attrs['aria-busy'] === undefined, 'plus « occupé »');
    });
  }
}

// Les scénarios asynchrones (ils attendent des promesses) : chacun rend sa promesse.
async function asyncChecks(combobox) {
  const OPTIONS = [{ value: 'Region', label: 'Region', group: 'Ventes' }, { value: 'Clients.Ville', label: 'Ville', group: 'Clients' },
    { value: 'Personnes.Equipe', label: 'Equipe', group: 'Personnes', pending: true }, { value: 'Personnes.Prenom', label: 'Prenom', group: 'Personnes', pending: true }];
  const fresh = (prepare) => {
    const input = makeEl();
    const list = makeEl();
    list.hidden = true;
    const changes = [];
    input.addEventListener('change', () => changes.push(input.value));
    combobox.attach(input, list, { prepare });
    input.setOptions(OPTIONS);
    input.value = 'Region';
    input.fire('blur');
    const pick = (value) => list.fire('click', { target: { closest: () => ({ dataset: { value } }) } });
    return { input, list, changes, pick };
  };
  const errorsBefore = () => combobox.errors.length;

  // Refus (`false`) : le champ revient à sa valeur d'avant, aucun « change ».
  {
    const s = fresh(() => Promise.resolve(false));
    s.pick('Personnes.Equipe');
    await tick();
    eq([s.input.value, s.changes, s.input.attrs['aria-busy']], ['Region', [], undefined], 'préparation refusée : valeur d\'avant, aucun change, plus occupé');
    s.input.fire('blur');
    eq(s.input.value, 'Region', 'et la valeur refusée ne revient pas au blur');
  }
  // Erreur : même chose, et l'erreur est écrite dans la console.
  {
    const before = errorsBefore();
    const s = fresh(() => Promise.reject(new Error('boum')));
    s.pick('Personnes.Equipe');
    await tick();
    eq([s.input.value, s.changes], ['Region', []], 'préparation en erreur : valeur d\'avant, aucun change');
    ok(combobox.errors.length === before + 1, 'l\'erreur est écrite dans la console');
    const thrown = fresh(() => { throw new Error('sync'); });
    thrown.pick('Personnes.Equipe');
    await tick();
    eq([thrown.input.value, thrown.changes], ['Region', []], 'préparation qui lève tout de suite : même chose');
  }
  // Un blur pendant la préparation ne fige pas la valeur refusée.
  {
    let release;
    const s = fresh(() => new Promise((resolve) => { release = resolve; }));
    s.pick('Personnes.Equipe');
    s.input.fire('blur');
    release(false);
    await tick();
    s.input.fire('blur');
    eq([s.input.value, s.changes], ['Region', []], 'blur pendant la préparation puis refus : valeur d\'avant');
  }
  // Une colonne de la table de travail ou d'une table déjà jointe n'attend rien.
  {
    let called = 0;
    const s = fresh(() => { called += 1; return Promise.resolve(true); });
    s.pick('Clients.Ville');
    eq([s.changes, called], [['Clients.Ville'], 0], 'une colonne déjà dans les lignes : « change » tout de suite, `prepare` jamais appelée');
  }
  // Un choix plus récent l'emporte sur une préparation encore en cours.
  {
    const releases = [];
    const s = fresh(() => new Promise((resolve) => releases.push(resolve)));
    s.pick('Personnes.Equipe');
    s.pick('Clients.Ville');
    releases[0](true);
    await tick();
    eq([s.changes, s.input.value], [['Clients.Ville'], 'Clients.Ville'], 'la préparation en retard n\'écrit rien après un choix plus récent');
    const t = fresh(() => new Promise((resolve) => releases.push(resolve)));
    t.pick('Personnes.Equipe');
    t.pick('Personnes.Prenom');
    releases[releases.length - 2](true);
    releases[releases.length - 1](true);
    await tick();
    eq([t.changes, t.input.value], [['Personnes.Prenom'], 'Personnes.Prenom'], 'deux choix à relier de suite : seul le dernier compte');
  }
}

(async () => {
  const comboSource = read('js', 'combobox.js');
  await comboChecks(loadCombobox(comboSource));
  await asyncChecks(loadCombobox(comboSource));
  console.log(`OK combobox — chaînes seules comme avant, intitulés de groupe (jamais comptés comme options), recherche par colonne et par table, mode strict, plafond de 200, préparation avant « change » (réussite, refus, erreur, blur, choix plus récent) (${checks} vérifications)`);

  // ---- Versions FAUTIVES de la combobox : chacune doit être vue ---------------------------------------------------------------------------------
  const MUTANTS = [
    ['la préparation ignorée', "if (!option || !option.pending || typeof opts.prepare !== 'function') { finish(value); return; }", 'if (true) { finish(value); return; }'],
    ['« change » émis avant la fin de la préparation', 'const previous = lastValidValue;', 'const previous = lastValidValue; finish(value);'],
    ['un refus qui laisse le choix en place', 'if (ok === false) revert(); else finish(value);', 'finish(value);'],
    ['une erreur de préparation qui laisse le choix en place', 'if (token === commitToken) revert();', ''],
    ['une préparation en retard qui écrit quand même', 'if (token !== commitToken) return;', ''],
    ['aucun intitulé de groupe', 'if (m.group && m.group !== lastGroup) rows.push(', 'if (false) rows.push('],
    ['un intitulé répété devant chaque option', 'if (m.group && m.group !== lastGroup) rows.push(', 'if (m.group) rows.push('],
    ['un intitulé compté comme une option', '<li class="combobox-group" role="presentation">', '<li class="combobox-option combobox-group" role="presentation">'],
    ['50 options même rangées par table', 'return grouped ? MAX_VISIBLE_GROUPED : MAX_VISIBLE_OPTIONS;', 'return MAX_VISIBLE_OPTIONS;'],
    ['la validité cherchée dans les options brutes', "return v === '' ? !!blankLabel : optionByValue.has(v);", "return v === '' ? !!blankLabel : options.includes(v);"],
    ['le champ reste « occupé »', "inputEl.removeAttribute('aria-busy');\n      inputEl.value = value;", 'inputEl.value = value;'],
    ['la valeur entière écrite sous l\'intitulé', 'const h = highlightMatch(m.label, currentQuery);', 'const h = highlightMatch(m.value, currentQuery);'],
    ['l\'intitulé n\'est pas cherchable', "return typeof option === 'string' ? option : `${option.value} ${option.group || ''}`;", "return typeof option === 'string' ? option : option.value;"],
    ['une colonne à relier non marquée', "${m.pending ? ' combobox-option-pending' : ''}", "${''}"],
    ['aucun nom accessible complet', 'const label = m.label !== m.value ?', 'const label = false ?'],
    ['un retrait de groupe sur une liste simple', "${m.group ? ' combobox-option-grouped' : ''}", "${' combobox-option-grouped'}"],
    ['une option sans groupe qui prend un intitulé vide', "group: o.group ? String(o.group) : ''", "group: o.group ? String(o.group) : ' '"]
  ];
  let seen = 0;
  for (const [label, from, to] of MUTANTS) {
    assert.ok(comboSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/combobox.js`);
    const mutated = loadCombobox(comboSource.replace(from, to));
    let caught = false;
    try { await comboChecks(mutated); await asyncChecks(mutated); } catch (e) { caught = true; }
    assert.ok(caught, `version fautive non vue : ${label}`);
    seen += 1;
  }
  console.log(`OK combobox — ${seen} versions fautives vues par les vérifications`);

  // ---- Le câblage -------------------------------------------------------------------------------------------------------------------------------
  const main = readMain();
  const fields = read('js', 'main-fields.js');
  const form = read('js', 'main-form.js');
  const session = read('js', 'main-session.js');
  const panel = read('js', 'main-panel.js');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

  // Chaque combobox de colonne passe `prepare` ; les listes de VALEURS (valeurs d'une colonne choisie) n'en proposent jamais.
  ok(/\.forEach\(\(input\) => \{\s*GristBI\.combobox\.attach\(input, input\.nextElementSibling, \{ strict: true, prepare: ensureColumnJoined \}\);/.test(fields), 'les champs de colonne du formulaire passent `prepare`');
  ok(/GristBI\.combobox\.attach\(input, list, \{ strict: true, blankLabel: t\('tileForm\.none\.m'\), prepare: ensureColumnJoined \}\)/.test(fields), 'les niveaux de drill-down aussi');
  ok(/GristBI\.combobox\.attach\(input, list, \{ strict: true, prepare: ensureColumnJoined \}\)/.test(fields), 'les axes du radar aussi');
  ok(/const ensureColumnJoined = \(\.\.\.args\) => parts\.ensureColumnJoined\(\.\.\.args\);/.test(fields), '`ensureColumnJoined` vient de main-session.js par liaison tardive');
  ok(/Object\.assign\(parts, \{\s*connectToFirstTable, ensureColumnJoined,/.test(session), '...et y est déposée');
  // Les listes sont remplies par `columnOptions`, jamais par la liste brute des colonnes des lignes.
  ok(/const choices = columnOptions\(rows\);/.test(fields) && /const numChoices = columnOptions\(rows, 'number'\);/.test(fields), 'refreshColumnSelects remplit toutes les listes par columnOptions');
  ['dimensionSelect', 'columnDimensionSelect', 'startColumnSelect', 'endColumnSelect', 'measureSelect', 'measureYSelect', 'dateColumnSelect'].forEach((name) => {
    ok(new RegExp(`fillCombobox\\(${name}, choices\\)`).test(fields), `${name} reçoit les colonnes des tables liées`);
  });
  ['seriesSelect', 'measureSizeSelect', 'trendDimensionSelect', 'radarEntityColumnSelect'].forEach((name) => {
    ok(new RegExp(`fillCombobox\\(${name}, choices, \\{ blankLabel`).test(fields), `${name} reçoit les colonnes des tables liées`);
  });
  ok(/fillCombobox\(targetColumnSelect, numChoices, \{ blankLabel/.test(fields) && /S\.radarAxisSelects\.forEach\(\(select\) => fillCombobox\(select, numChoices\)\)/.test(fields), 'les listes de NOMBRES (objectif, axes du radar) ne reçoivent que des colonnes liées numériques');
  ok(/S\.drillLevelSelects\.forEach\(\(select\) => fillCombobox\(select, choices,/.test(fields), 'les niveaux de drill-down existants aussi');
  ok(/fillCombobox\(select, columnOptions\(store\.getState\(\)\.rows\), \{ blankLabel: t\('tileForm\.none\.m'\) \}\)/.test(fields) && /fillCombobox\(select, columnOptions\(store\.getState\(\)\.rows, 'number'\)\)/.test(fields), '« + Niveau » et « + Axe » créent leurs listes avec les mêmes options');
  ok(/const cols = columnOptions\(store\.getState\(\)\.rows\);/.test(form) && /const cols = columnOptions\(store\.getState\(\)\.rows, 'number'\);/.test(form), 'les niveaux et axes créés à l\'édition d\'une tuile aussi');
  ok(!/fillCombobox\(\w+, (availableColumns|numericColumns)\(/.test(main), 'plus aucune liste de choix de colonne remplie sans les colonnes des tables liées');
  // Les colonnes d'une table liée : schéma lu, jointures de l'état (réglage manuel compris), genre d'après le type pour les listes de nombres.
  ok(/graph\.allJoins\(state\.blend, state\.joins\)/.test(fields) && /graph\.virtualColumns\(S\.linkSchema, S\.currentTableId, joins, Object\.keys\(rows\[0\]\)\)/.test(fields), 'columnOptions lit les jointures posées (réglage manuel compris) et les colonnes des lignes');
  ok(/if \(!graph \|\| !rows\.length\) return plain;/.test(fields), 'sans ligne, aucune colonne liée n\'est proposée (comme les colonnes de la table de travail)');
  ok(/if \(kind\) virtual = virtual\.filter\(\(v\) => graph\.kindOfType\(v\.type\) === kind\);/.test(fields), 'une liste de nombres ne reçoit que des colonnes numériques d\'après leur type Grist');
  ok(/graph\.groupColumns\(plain, virtual, joins, S\.currentTableId \|\| ''\)/.test(fields) && /t\('joins\.pick\.hint', \{ table: o\.table \}\)/.test(fields), 'rangées par table, avec l\'infobulle « relie la table… »');
  // Choisir une colonne liée : jointures posées, lignes refaites, retrait si la colonne n'y est pas, phrase.
  ok(/graph\.virtualColumns\(S\.linkSchema, S\.currentTableId, all, Object\.keys\(state\.rows\[0\]\)\)\.find\(\(v\) => v\.id === id\)/.test(session), 'ensureColumnJoined retrouve la colonne d\'après le schéma d\'AUJOURD\'HUI (jamais une liste gardée)');
  ok(/const toAdd = graph\.joinsToAdd\(virtual\);/.test(session) && /store\.setJoins\(\(state\.joins \|\| \[\]\)\.concat\(toAdd\)\);/.test(session), 'les jointures de la route s\'ajoutent aux autres (jamais ne les remplacent)');
  ok(/all\.length \+ toAdd\.length > graph\.MAX_JOINS/.test(session) && /showError\(t\('joins\.full'/.test(session), 'au plafond de jointures : refusé en le disant');
  ok(/await applyBlend\(currentBlend\);\s*\}\s*if \(hasColumn\(\)\) \{/.test(session) && /for \(let attempt = 0; attempt < 3 && !hasColumn\(\); attempt\+\+\)/.test(session), 'les lignes sont refaites, jusqu\'à trois essais (une demande abandonnée par une autre est rattrapée)');
  ok(/added\.forEach\(\(alias\) => \{ joins = graph\.removeJoin\(joins, alias\)\.joins; \}\);\s*store\.setJoins\(joins\);\s*await applyBlend\(currentBlend\);\s*\}\s*return false;/.test(session), 'sans la colonne : les jointures posées pour CE choix sont retirées et le choix refusé');
  ok(/noteEl\.textContent = t\('joins\.pick\.done', \{ tables: added\.join\(', '\) \}\);\s*noteEl\.hidden = false;/.test(session), 'la phrase dit quelle table vient d\'être reliée, là où l\'appelant la veut');
  ok(/async function ensureColumnJoined\(id\) \{ return joinColumn\(id, tileLinkNoteEl\); \}/.test(session) && /async function joinColumn\(id, noteEl\)/.test(session), 'ensureColumnJoined (le `prepare` des combobox) écrit la phrase du panneau d\'ajout ; joinColumn fait le travail pour tous');
  // ---- Lot 1c : menu Filtre, « Que faire avec cette colonne ? », cases de la table plate ----
  const filters = read('js', 'main-filters.js');
  ok(/const joinColumn = \(\.\.\.args\) => parts\.joinColumn\(\.\.\.args\);/.test(filters), 'menu Filtre : joinColumn vient de main-session.js par liaison tardive');
  ok(/connectToFirstTable, ensureColumnJoined, joinColumn,/.test(session), 'main-session.js dépose joinColumn');
  ok(/filterColumns = columnOptions\(rows\)\.map\(/.test(filters) && !/availableColumns\(rows\)\.map\(\(id\) => \(\{ id, kind/.test(filters), 'menu Filtre : la liste des colonnes vient de columnOptions (celles des tables liées comprises)');
  ok(/kind: o\.pending \? \(o\.kind \|\| 'text'\) : inferColumnKind\(o\.value, rows\)/.test(filters), 'menu Filtre : le genre d\'une colonne à relier vient de son TYPE Grist, celui des autres des lignes');
  ok(/filter-column-group" role="presentation"/.test(filters) && /\$\{c\.id\} \$\{c\.group\}/.test(filters), 'menu Filtre : un intitulé par table (jamais un bouton) ; la recherche porte aussi sur la table');
  ok(/data-pending="1"/.test(filters) && /t\('filters\.column\.ariaLinked'/.test(filters) && /t\('joins\.pick\.hint'/.test(filters), 'menu Filtre : une colonne à relier a son marquage, son nom accessible et son infobulle');
  ok(/if \(!entry \|\| !entry\.pending\) \{ selectFilterColumn\(columnId\); return; \}/.test(filters) && /ok = await joinColumn\(columnId, filterLinkNoteEl\)/.test(filters), 'menu Filtre : une colonne à relier pose la jointure AVANT l\'étape 2');
  ok(/if \(ok && filterColumns\.some\(\(c\) => c\.id === columnId && !c\.pending\)\) \{ selectFilterColumn\(columnId\); return; \}/.test(filters), 'menu Filtre : l\'étape 2 seulement si la colonne est bien dans les lignes jointes');
  ok(/if \(filterJoining\) return;/.test(filters) && /filterJoining = false;/.test(filters), 'menu Filtre : un seul choix à la fois');
  ok(/if \(btn\) pickFilterColumn\(btn\.dataset\.column, btn\);/.test(filters) && /if \(first\) pickFilterColumn\(first\.dataset\.column, first\);/.test(filters), 'menu Filtre : le clic ET Entrée dans la recherche passent par pickFilterColumn');
  ok(/hideFilterLinkNote\(\);\s*refreshFilterColumnList\(\);/.test(filters) && /filterBackBtn\.addEventListener\('click', \(\) => \{ hideFilterLinkNote\(\);/.test(filters), 'menu Filtre : la phrase est retirée à chaque ouverture et au retour aux colonnes');
  ok(/const pickable = choices\.filter\(\(o\) => \(typeof o === 'string' \? pickableIds\.has\(o\) : o\.pending \|\| pickableIds\.has\(o\.value\)\)\);/.test(fields) && /fillCombobox\(columnPickEl, pickable\);/.test(fields), '« Que faire avec cette colonne ? » : les colonnes à relier sont proposées avec celles de la table (sans les dérivées d\'une date)');
  ok(/S\.columnsPickerPending = choices\.filter\(\(o\) => typeof o === 'object' && o\.pending\);\s*refreshColumnsPicker\(cols\);/.test(fields), 'table plate : les colonnes à relier sont celles de columnOptions');
  ok(/function columnRows\(\) \{ return Array\.from\(tileColumnsList\.querySelectorAll\('li\[data-col\]:not\(\[data-pending\]\)'\)\); \}/.test(fields) && /function readColumnsOrder\(\) \{ return columnRows\(\)/.test(fields) && /return columnRows\(\)\.filter\(\(li\) => li\.querySelector\('input'\)\.checked\)/.test(fields), 'table plate : ni intitulé ni colonne à relier ne compte comme colonne de la liste');
  ok(/li\.dataset\.pending = '1';/.test(fields) && /head\.className = 'col-group';/.test(fields) && /t\('tileForm\.columns\.pending'/.test(fields), 'table plate : les colonnes à relier ont leur intitulé de table, leur marquage et leur nom accessible');
  ok(/e\.target\.closest\('li\[data-pending\]'\)/.test(form) && /ok = await joinColumn\(col, tileLinkNoteEl\)/.test(form), 'table plate : cocher une colonne à relier pose la jointure (phrase du panneau d\'ajout)');
  ok(/joined\.querySelector\('input'\)\.checked = true;/.test(form) && /still\.querySelector\('input'\)\.checked = false;/.test(form), 'table plate : réussite = la colonne prend sa place cochée ; échec = la case se décoche');
  ok(/const joinColumn = \(\.\.\.args\) => parts\.joinColumn\(\.\.\.args\);/.test(form) && /tileColumnsList, tileLinkNoteEl,/.test(form), 'table plate : joinColumn par liaison tardive, la phrase du panneau');
  for (const [text, label] of [[fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), 'index.html'], [fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8'), 'harness.html']]) {
    ok(/<p id="filter-link-note" class="tile-advice tile-link-note" role="status" aria-live="polite" hidden><\/p>/.test(text), `${label} : la phrase du menu Filtre est une zone de statut, masquée au départ`);
  }
  ['.filter-column-group', '.filter-column-grouped', '.columns-list li.col-group'].forEach((sel) => ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  ok(/filterLinkNoteEl = document\.getElementById\('filter-link-note'\)/.test(read('js', 'main-core.js')), 'main-core.js : la référence de la phrase du menu Filtre');
  ['tileForm.columns.pending', 'filters.column.ariaLinked'].forEach((key) => ok(i18n.STRINGS[key] && i18n.STRINGS[key].fr && i18n.STRINGS[key].en, `clé ${key} en fr et en`));
  ['fr', 'en'].forEach((lang) => {
    i18n.setLang(lang);
    [['tileForm.columns.pending', { column: 'Clients.Ville', table: 'Clients' }], ['filters.column.ariaLinked', { name: 'Clients.Ville', kind: 'texte', table: 'Clients' }]].forEach(([key, vars]) => {
      const text = i18n.t(key, vars);
      assert.ok(text && !/[{}]|NaN|undefined/.test(text) && /Clients/.test(text), `${lang} ${key} : « ${text} »`);
      checks += 1;
    });
  });
  i18n.setLang('fr');

  // La phrase : un seul panneau, jamais gardée d'un panneau à l'autre.
  ok(/hideLinkNote\(\);\s*renderTypeCards\(\);/.test(panel) && /tilePanel\.hidden = true;\s*hideLinkNote\(\);/.test(panel), 'la phrase est retirée à l\'ouverture et à la fermeture du panneau');
  for (const [text, label] of [[fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), 'index.html'], [fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8'), 'harness.html']]) {
    ok(/<p id="tile-link-note" class="tile-advice tile-link-note" role="status" aria-live="polite" hidden><\/p>/.test(text), `${label} : la phrase est une zone de statut, masquée au départ`);
  }
  ['.combobox-group', '.combobox-option-grouped'].forEach((sel) => ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  ok(!/\.combobox-group[^{]*\{[^}]*cursor: pointer/.test(css), 'un intitulé ne se survole pas comme une option');
  ['joins.pick.hint', 'joins.pick.done'].forEach((key) => ok(i18n.STRINGS[key] && i18n.STRINGS[key].fr && i18n.STRINGS[key].en, `clé ${key} en fr et en`));
  ['fr', 'en'].forEach((lang) => {
    i18n.setLang(lang);
    [['joins.pick.hint', { table: 'Clients' }], ['joins.pick.done', { tables: 'Clients, Pays' }]].forEach(([key, vars]) => {
      const text = i18n.t(key, vars);
      assert.ok(text && !/[{}]|NaN|undefined/.test(text), `${lang} ${key} : « ${text} »`);
      checks += 1;
    });
  });
  i18n.setLang('fr');
  ok(/Clients, Pays/.test(i18n.t('joins.pick.done', { tables: 'Clients, Pays' })) && /Clients/.test(i18n.t('joins.pick.hint', { table: 'Clients' })), 'les phrases nomment les tables');
  // Le combobox reste pur côté logique (aucun texte en dur ni accès à Grist).
  const code = comboSource.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  ['grist.', 'localStorage', 'fetch(', 'eval(', 'new Function', 'innerHTML'].forEach((bad) => ok(code.indexOf(bad) === -1, `js/combobox.js : « ${bad} »`));
  console.log('OK câblage — `prepare` sur tous les champs de colonne, listes remplies par columnOptions (nombres seulement pour les listes de nombres), jointures posées puis retirées sans la colonne, phrase, clés fr/en, styles');
  console.log(`\nOK — colonnes des tables liées dans les listes de choix : tous les essais passent (${checks} vérifications)`);
})().catch((e) => { console.error(e); process.exit(1); });
