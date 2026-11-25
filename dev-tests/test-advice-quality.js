/*
 * Le SCORE DE QUALITÉ des suggestions de tuiles (niveau 3d-3, 25/11/2026), rejoué sur les 20 tables du corpus :
 *
 *   node dev-tests/test-advice-quality.js
 *   ADVICE_QUALITY_JS=/chemin/vers/un/autre/js node dev-tests/test-advice-quality.js   (score une autre version du code, sans rien vérifier)
 *
 * Le score confronte ce que `advice.suggestTiles` propose à un ÉTALON écrit à la main (dev-tests/lib/advice-gold.js : ce qu'une personne qui connaît ses
 * données voudrait voir, et les absurdités à ne jamais proposer), voir dev-tests/lib/advice-score.js pour la formule. Quatre sortes d'essais :
 *  1. LE SCORE LUI-MÊME, sur des listes fabriquées à la main (rang, fenêtres, pondération, pénalités, diversité, explication, liste vide) : une note
 *     qu'on ne sait pas vérifier ne vaut rien ;
 *  2. L'ÉTALON : une table du corpus n'a pas d'étalon, ou l'inverse, ou une attente qui ne dit pas ce qu'elle cherche, et la base ne tient plus ;
 *  3. LA SENSIBILITÉ : un outil dégradé a une note plus basse (ordre inversé, types d'avant 2026 seulement, absurdité injectée, aucune suggestion) —
 *     sans quoi le score ne verrait jamais une régression ;
 *  4. LA BASE : aucune table ne descend sous la note mesurée le 25/11/2026, ni sa couverture après compléments (un cliquet : le score ne redescend pas
 *     en silence ; si une amélioration le fait monter, l'essai le dit et il faut relever la base).
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir HYPOTHESES.md, niveau 3d-3).
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const ALT = process.env.ADVICE_QUALITY_JS ? path.resolve(process.env.ADVICE_QUALITY_JS) : '';
const jsDir = ALT || path.join(ROOT, 'js');
const advice = require(path.join(jsDir, 'advice.js'));
let complete = null;
try { complete = require(path.join(jsDir, 'advice-complete.js')); } catch (e) { complete = null; }
const score = require('./lib/advice-score.js');
const gold = require('./lib/advice-gold.js');
const corpusLib = require('./lib/advice-corpus.js');

const corpus = corpusLib.build();
const pct = (x) => (x === null || x === undefined ? '   - ' : String(Math.round(x * 100)).padStart(3) + ' %');

function report(result, title) {
  console.log('\n' + title);
  console.log('  table          note  attentes  sûreté  diversité  explication  couverture');
  result.tables.forEach((t) => {
    const p = t.parts;
    console.log('  ' + t.name.padEnd(13) + String(t.score.toFixed(1)).padStart(6) + String(p.wants.toFixed(0)).padStart(8) + '/55' + String(p.safety).padStart(5) + '/20'
      + String(p.diversity).padStart(7) + '/15' + String(p.explanation.toFixed(0)).padStart(8) + '/10  ' + pct(t.coverage)
      + (t.hits.length ? '   !! ' + t.hits.join(' ; ') : '')
      + (t.wants.some((w) => w.credit < 1) ? '   · ' + t.wants.filter((w) => w.credit < 1).map((w) => w.id + ' (' + (w.rank ? 'rang ' + w.rank : 'absente') + ')').join(' ; ') : ''));
  });
  console.log('  MOYENNE        ' + result.mean.toFixed(1) + ' / 100   couverture après compléments : ' + pct(result.coverageMean));
}

const real = score.scoreCorpus({ advice, complete, corpus, gold });

if (ALT) { // une autre version du code : on la mesure, on ne la juge pas
  report(real, 'Score de ' + ALT);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. Le score lui-même, sur des listes fabriquées à la main
{
  const tile = (extra) => ({ type: 'bar', dimension: 'A', measure: 'M', aggFn: 'sum', ...extra });
  const s = (tileData, extra) => ({ tileData, intent: 'compare', insightKey: 'advice.insight.x', ...extra });

  // matches : égalité, « l'une de », expression régulière, fonction, présence, X par X, axes de radar
  assert.ok(score.matches(tile(), { type: 'bar' }));
  assert.ok(!score.matches(tile(), { type: 'pie' }));
  assert.ok(score.matches(tile(), { type: ['pie', 'bar'] }), '« l\'une de »');
  assert.ok(score.matches(tile({ dimension: 'Date.Mois' }), { dimension: /^Date\./ }), 'expression régulière');
  assert.ok(!score.matches(tile({ dimension: 5 }), { dimension: /^\d+$/ }), 'une expression régulière ne lit jamais un nombre (5 n\'est pas le texte « 5 »)');
  assert.ok(score.matches(tile(), { measure: (v) => v === 'M' }), 'fonction');
  assert.ok(score.matches(tile({ targetColumn: 'Objectif' }), { has: ['targetColumn'] }));
  assert.ok(!score.matches(tile({ targetColumn: '' }), { has: ['targetColumn'] }), 'une colonne vide n\'est pas présente');
  assert.ok(!score.matches(tile(), { has: ['targetColumn'] }));
  assert.ok(score.matches(tile({ dimension: 'X', measure: 'X' }), { same: true }));
  assert.ok(!score.matches(tile(), { same: true }));
  assert.ok(!score.matches(tile({ dimension: '', measure: '' }), { same: true }), 'deux vides ne sont pas « X par X »');
  assert.ok(score.matches({ type: 'radar', radarAxes: ['a', 'b', 'c'] }, { axes: [['a', 'b', 'z'], 2] }));
  assert.ok(!score.matches({ type: 'radar', radarAxes: ['a', 'x', 'c'] }, { axes: [['a', 'b', 'z'], 2] }), 'un seul axe de la liste');
  assert.ok(!score.matches({ type: 'radar' }, { axes: [['a'], 1] }), 'radar sans axes');
  assert.ok(score.matches(tile(), { any: [{ type: 'pie' }, { measure: 'M' }] }), '`any`');
  assert.ok(!score.matches(tile(), { any: [{ type: 'pie' }, { measure: 'Z' }] }));
  assert.ok(!score.matches(null, { type: 'bar' }) && !score.matches('x', { type: 'bar' }), 'une entrée qui n\'est pas une tuile ne remplit rien');
  assert.ok(!score.matches(tile(), { type: 'bar', id: 'libellé', weight: 3, dimension: 'Z' }), 'id et weight ne sont jamais des conditions, dimension en est une');
  assert.ok(score.matches(tile(), { type: 'bar', id: 'libellé', weight: 3 }), 'id et weight ne sont jamais des conditions');
  console.log('OK matches — égalité, « l\'une de », expression régulière, fonction, présence, X par X, axes, `any`, entrées hostiles');

  // rangs et fenêtres : 1er..3e = pleine part, 4e..9e = 70 %, au-delà ou absente = rien
  const fillers = (n) => Array.from({ length: n }, (_, i) => s(tile({ dimension: 'Z' + i, measure: 'Y' + i })));
  const at = (rank) => fillers(rank - 1).concat([s(tile({ type: 'pie' }))]);
  const want = { want: [{ id: 'camembert', type: 'pie' }], never: [] };
  const wantPoints = (list) => score.scoreTable(list, want, []).parts.wants;
  assert.strictEqual(score.rankOf(at(1), { type: 'pie' }), 1);
  assert.strictEqual(score.rankOf(at(7), { type: 'pie' }), 7);
  assert.strictEqual(score.rankOf(fillers(4), { type: 'pie' }), 0);
  [1, 2, 3].forEach((r) => assert.strictEqual(wantPoints(at(r)), 55, 'rang ' + r + ' : pleine part'));
  [4, 6, 9].forEach((r) => assert.ok(Math.abs(wantPoints(at(r)) - 55 * 0.7) < 1e-9, 'rang ' + r + ' : 70 %'));
  assert.strictEqual(wantPoints(at(10)), 0, 'au-delà du 9e rang : rien (seules neuf suggestions sont lues)');
  assert.strictEqual(wantPoints([]), 0, 'liste vide');
  assert.strictEqual(wantPoints(fillers(3)), 0, 'attente absente');
  console.log('OK fenêtres — rangs 1 à 3 pleine part, 4 à 9 à 70 %, 10 et absente à 0');

  // pondération : une attente de poids 3 pèse trois fois une attente de poids 1
  const weighted = { want: [{ id: 'a', type: 'pie', weight: 3 }, { id: 'b', type: 'line' }], never: [] };
  const onlyPie = score.scoreTable([s(tile({ type: 'pie' }))], weighted, []).parts.wants;
  const onlyLine = score.scoreTable([s(tile({ type: 'line' }))], weighted, []).parts.wants;
  assert.ok(Math.abs(onlyPie - 55 * 0.75) < 1e-9 && Math.abs(onlyLine - 55 * 0.25) < 1e-9, 'poids 3 : 75 %, poids 1 : 25 % : ' + onlyPie + ' / ' + onlyLine);
  const nowish = { want: [{ id: 'a', type: 'pie', weight: 0 }, { id: 'b', type: 'pie', weight: -2 }, { id: 'c', type: 'pie', weight: 'lourd' }], never: [] };
  assert.strictEqual(score.scoreTable([s(tile({ type: 'pie' }))], nowish, []).parts.wants, 55, 'un poids invalide vaut 1');
  assert.strictEqual(score.scoreTable([], { want: [], never: [] }, []).parts.wants, 55, 'aucune attente : rien à manquer');
  console.log('OK pondération — poids 3 contre 1, poids invalide = 1, aucune attente = pleine part');

  // sûreté : 10 points de moins par règle touchée, jamais sous 0, une règle touchée deux fois ne compte qu'une fois, regardée sur 9 suggestions
  const never = (...rules) => ({ want: [], never: rules });
  const bad = s(tile({ measure: 'Client' }));
  const safety = (list, rules, globals) => score.scoreTable(list, never(...rules), globals || []).parts.safety;
  assert.strictEqual(safety([s(tile())], [{ id: 'r', measure: 'Client' }]), 20);
  assert.strictEqual(safety([bad], [{ id: 'r', measure: 'Client' }]), 10);
  assert.strictEqual(safety([bad, bad], [{ id: 'r', measure: 'Client' }]), 10, 'une même règle touchée deux fois compte une fois');
  assert.strictEqual(safety([bad], [{ id: 'r', measure: 'Client' }, { id: 'r2', type: 'bar' }]), 0, 'deux règles : 0');
  assert.strictEqual(safety([bad], [{ id: 'r', measure: 'Client' }, { id: 'r2', type: 'bar' }, { id: 'r3', aggFn: 'sum' }]), 0, 'jamais sous 0');
  assert.strictEqual(safety([bad], [], [{ id: 'g', measure: 'Client' }]), 10, 'une règle universelle compte comme une autre');
  assert.strictEqual(safety(fillers(9).concat([bad]), [{ id: 'r', measure: 'Client' }]), 20, 'la 10e suggestion n\'est pas lue');
  assert.strictEqual(safety(fillers(8).concat([bad]), [{ id: 'r', measure: 'Client' }]), 10, 'la 9e l\'est');
  console.log('OK sûreté — 10 points par règle, une règle une fois, jamais sous 0, universelles, neuf suggestions lues');

  // diversité et explication : sur les TROIS premières seulement
  const intents = (...list) => list.map((intent) => s(tile(), { intent }));
  const div = (list) => score.scoreTable(list, { want: [], never: [] }, []).parts.diversity;
  assert.strictEqual(div(intents('a', 'b', 'c')), 15);
  assert.strictEqual(div(intents('a', 'b', 'a')), 9);
  assert.strictEqual(div(intents('a', 'a', 'a')), 0);
  assert.strictEqual(div(intents('a', 'a', 'a', 'b', 'c')), 0, 'la 4e et la 5e intention ne comptent pas');
  assert.strictEqual(div(intents('a', 'b')), 9, 'deux suggestions, deux intentions');
  assert.strictEqual(div([]), 0);
  assert.strictEqual(div([s(tile(), { intent: undefined }), s(tile(), { intent: undefined }), s(tile(), { intent: undefined })]), 0, 'sans intention : 0');
  const exp = (list) => score.scoreTable(list, { want: [], never: [] }, []).parts.explanation;
  assert.strictEqual(exp([s(tile()), s(tile()), s(tile())]), 10);
  assert.ok(Math.abs(exp([s(tile()), s(tile(), { insightKey: undefined }), s(tile())]) - 10 * 2 / 3) < 1e-9, 'deux sur trois');
  assert.strictEqual(exp([s(tile(), { insightKey: undefined }), s(tile(), { insightKey: undefined }), s(tile(), { insightKey: undefined })]), 0);
  assert.strictEqual(exp([s(tile(), { insightKey: undefined }), s(tile(), { insightKey: undefined }), s(tile(), { insightKey: undefined }), s(tile())]), 0, 'la 4e ne compte pas');
  assert.strictEqual(exp([]), 0);
  const total = score.scoreTable(intents('a', 'b', 'c'), { want: [{ id: 'x', type: 'bar' }], never: [] }, []);
  assert.ok(Math.abs(total.score - 100) < 1e-9, 'tout plein : 100 (' + total.score + ')');
  const sum = total.parts.wants + total.parts.safety + total.parts.diversity + total.parts.explanation;
  assert.ok(Math.abs(sum - total.score) < 1e-9, 'la note est la somme de ses parts');
  assert.strictEqual(score.POINTS.wants + score.POINTS.safety + score.POINTS.diversity + score.POINTS.explanation, 100, 'les parts font 100');
  console.log('OK diversité et explication — trois premières seulement, intentions, faits tirés des données ; la note est la somme de ses parts, de 0 à 100');

  // déterminisme : deux calculs, la même note
  const again = score.scoreCorpus({ advice, complete, corpus, gold });
  assert.deepStrictEqual(again.tables.map((t) => [t.name, t.score, t.coverage]), real.tables.map((t) => [t.name, t.score, t.coverage]), 'deux calculs, la même note');
  console.log('OK déterminisme — deux calculs du corpus donnent les mêmes notes');

  // couverture après compléments : on pose les trois premières, puis au plus cinq propositions
  let calls = 0;
  const fake = { complete: (rows, posed, opts) => { calls++; assert.strictEqual(opts.limit, 1); return { items: [{ tileData: tile({ type: 'line', dimension: 'D' + calls }) }] }; } };
  const set = { rows: [{ a: 1 }] };
  const three = [s(tile({ type: 'pie' })), s(tile()), s(tile())];
  const cov = score.coverageAfterCompletion(fake, set, three, { want: [{ id: 'p', type: 'pie' }, { id: 'l', type: 'line' }, { id: 'k', type: 'kpi' }] });
  assert.ok(Math.abs(cov - 2 / 3) < 1e-9, 'camembert posé, courbe ajoutée, chiffre clé jamais : 2 sur 3 (' + cov + ')');
  assert.strictEqual(calls, 5, 'cinq compléments au plus');
  assert.strictEqual(score.coverageAfterCompletion(null, set, three, { want: [] }), null, 'sans assistant : pas de couverture');
  const empty = { complete: () => ({ items: [] }) };
  assert.strictEqual(score.coverageAfterCompletion(empty, set, three, { want: [{ id: 'k', type: 'kpi' }] }), 0, 'rien à compléter : on s\'arrête');
  assert.strictEqual(score.coverageAfterCompletion(empty, set, three, { want: [{ id: 'p', type: 'pie' }] }), 1, 'ce que l\'accueil montre déjà compte');
  assert.strictEqual(score.coverageAfterCompletion(empty, set, three, { want: [] }), 1, 'aucune attente : tout est couvert');
  console.log('OK couverture — trois premières posées, cinq compléments au plus, arrêt quand la liste est vide, sans assistant = rien');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. L'étalon
{
  const names = corpus.map((set) => set.name);
  assert.deepStrictEqual(Object.keys(gold.GOLD).sort(), names.slice().sort(), 'une table du corpus sans étalon, ou un étalon sans table');
  assert.deepStrictEqual(Object.keys(gold.BASELINE).sort(), names.slice().sort(), 'une table du corpus sans base mesurée, ou une base sans table');
  const allowed = new Set(['id', 'weight', 'type', 'dimension', 'measure', 'aggFn', 'measureY', 'columnDimension', 'startColumn', 'endColumn', 'comboMode', 'targetColumn', 'has', 'axes', 'same', 'any']);
  const check = (spec, where) => {
    assert.ok(spec && typeof spec === 'object', where + ' : pas une condition');
    Object.keys(spec).forEach((k) => assert.ok(allowed.has(k), where + ' : clé « ' + k + ' » inconnue (une attente se décrit par les propriétés de la tuile, jamais par un titre ni un rang)'));
    if (spec.any) { assert.ok(Array.isArray(spec.any) && spec.any.length, where + ' : `any` vide'); spec.any.forEach((s, i) => check(s, where + '.any[' + i + ']')); return; }
    const conditions = Object.keys(spec).filter((k) => k !== 'id' && k !== 'weight');
    assert.ok(conditions.length, where + ' : aucune condition (elle serait toujours remplie)');
  };
  corpus.forEach((set) => {
    const g = gold.GOLD[set.name];
    assert.ok(Array.isArray(g.want) && g.want.length >= 2, set.name + ' : au moins deux attentes');
    assert.ok(Array.isArray(g.never), set.name + ' : `never` doit être une liste');
    const ids = new Set();
    g.want.concat(g.never).forEach((spec, i) => {
      check(spec, set.name + '[' + i + ']');
      assert.ok(typeof spec.id === 'string' && spec.id.length > 3, set.name + '[' + i + '] : libellé manquant');
      assert.ok(!ids.has(spec.id), set.name + ' : libellé en double « ' + spec.id + ' »');
      ids.add(spec.id);
    });
    // Les colonnes que l'étalon nomme existent dans la table : une faute de frappe rendrait l'attente impossible, ou une règle jamais touchée.
    const columns = new Set(Object.keys(set.rows[0] || {}));
    const named = [];
    const collect = (spec) => { if (spec.any) spec.any.forEach(collect); ['dimension', 'measure', 'measureY', 'columnDimension', 'startColumn', 'endColumn'].forEach((k) => { const v = spec[k]; (Array.isArray(v) ? v : [v]).forEach((x) => { if (typeof x === 'string') named.push(x); }); }); if (spec.axes) spec.axes[0].forEach((x) => named.push(x)); };
    g.want.concat(g.never).forEach(collect);
    named.forEach((c) => assert.ok(columns.has(c), set.name + ' : l\'étalon nomme « ' + c + ' », qui n\'est pas une colonne de la table'));
  });
  gold.GLOBAL_NEVER.forEach((rule, i) => check(rule, 'GLOBAL_NEVER[' + i + ']'));
  assert.ok(gold.SCORE_TOLERANCE > 0 && gold.SCORE_TOLERANCE <= 2, 'une tolérance de note raisonnable');
  console.log('OK étalon — ' + names.length + ' tables, ' + corpus.reduce((n, set) => n + gold.GOLD[set.name].want.length, 0) + ' attentes et ' + corpus.reduce((n, set) => n + gold.GOLD[set.name].never.length, 0) + ' règles, colonnes existantes, libellés uniques, aucune condition vide');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. La sensibilité : un outil dégradé a une note plus basse
{
  const run = (wrap, withComplete) => score.scoreCorpus({ advice: wrap, complete: withComplete ? complete : null, corpus, gold });
  const asked = (opts) => Object.assign({ limit: score.WINDOW_ALL }, opts);
  const degrade = (change) => ({ suggestTiles: (rows, columns, opts) => change(advice.suggestTiles(rows, columns, Object.assign({}, opts, { limit: 40 })), opts) });

  const reversed = run(degrade((list, opts) => list.slice(0, asked(opts).limit).reverse()));
  assert.ok(reversed.mean < real.mean - 4, 'ordre inversé : la note devait chuter d\'au moins 4 points (' + real.mean.toFixed(1) + ' -> ' + reversed.mean.toFixed(1) + ')');

  const OLD_TYPES = new Set(['bar', 'pie', 'line', 'kpi', 'scatter', 'treemap', 'pivot', 'gauge']);
  const basic = run(degrade((list, opts) => list.filter((s) => OLD_TYPES.has(s.type)).slice(0, asked(opts).limit)));
  assert.ok(basic.mean < real.mean - 5, 'les huit types d\'avant seulement : la note devait chuter d\'au moins 5 points (' + real.mean.toFixed(1) + ' -> ' + basic.mean.toFixed(1) + ')');
  // chaque table dont l'attente principale est un type spécialisé le perd
  ['projet', 'crm', 'ventes', 'resultat', 'parcours', 'activite', 'organisation', 'support'].forEach((name) => {
    const a = real.tables.find((t) => t.name === name).score;
    const b = basic.tables.find((t) => t.name === name).score;
    assert.ok(b < a - 4, name + ' : sans son type spécialisé la note devait chuter (' + a.toFixed(1) + ' -> ' + b.toFixed(1) + ')');
  });

  const absurd = { type: 'bar', dimension: 'id', measure: 'id', aggFn: 'sum', title: 'absurde' };
  const injected = run(degrade((list, opts) => [{ type: 'bar', tileData: absurd, intent: 'compare', insightKey: 'x' }].concat(list).slice(0, asked(opts).limit)));
  corpus.forEach((set) => {
    const a = real.tables.find((t) => t.name === set.name);
    const b = injected.tables.find((t) => t.name === set.name);
    assert.ok(b.hits.indexOf('X par X') !== -1 && b.hits.indexOf('numéro de ligne lu comme mesure') !== -1, set.name + ' : une absurdité injectée doit toucher les deux règles universelles');
    assert.ok(b.parts.safety <= Math.max(0, a.parts.safety - 10), set.name + ' : la sûreté devait perdre au moins 10 points (' + a.parts.safety + ' -> ' + b.parts.safety + ')');
  });

  const nothing = run(degrade(() => []));
  nothing.tables.forEach((t) => assert.ok(t.score <= 20, t.name + ' : aucune suggestion ne vaut au plus la sûreté (' + t.score + ')'));

  const blind = run(degrade((list, opts) => list.slice(0, asked(opts).limit).map((s) => Object.assign({}, s, { insightKey: undefined, intent: undefined }))));
  assert.ok(blind.mean < real.mean - 12, 'sans intention ni explication chiffrée la note devait chuter d\'au moins 12 points (' + real.mean.toFixed(1) + ' -> ' + blind.mean.toFixed(1) + ')');

  const noComplete = run(degrade((list, opts) => list.slice(0, asked(opts).limit)), false);
  assert.strictEqual(noComplete.coverageMean, null, 'sans assistant, pas de couverture');
  console.log('OK sensibilité — ordre inversé ' + real.mean.toFixed(1) + ' -> ' + reversed.mean.toFixed(1) + ', types d\'avant seulement -> ' + basic.mean.toFixed(1) + ', absurdité injectée : sûreté -10 sur ' + corpus.length + ' tables, aucune suggestion <= 20, sans intention ni explication -> ' + blind.mean.toFixed(1));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. La base : le cliquet
report(real, 'Score des suggestions de tuiles sur le corpus (base du 25/11/2026) :');
{
  const failures = [];
  const raised = [];
  real.tables.forEach((t) => {
    const base = gold.BASELINE[t.name];
    if (t.score < base.score - gold.SCORE_TOLERANCE) failures.push(t.name + ' : note ' + t.score.toFixed(1) + ' sous sa base ' + base.score + ' (tolérance ' + gold.SCORE_TOLERANCE + ')');
    if (t.coverage !== null && t.coverage < base.coverage - gold.COVERAGE_TOLERANCE) failures.push(t.name + ' : couverture ' + pct(t.coverage).trim() + ' sous sa base ' + pct(base.coverage).trim());
    if (t.score > base.score + gold.SCORE_TOLERANCE || (t.coverage !== null && t.coverage > base.coverage + gold.COVERAGE_TOLERANCE)) raised.push(t.name);
  });
  const baseMean = Object.keys(gold.BASELINE).reduce((sum, k) => sum + gold.BASELINE[k].score, 0) / Object.keys(gold.BASELINE).length;
  if (real.mean < baseMean - gold.SCORE_TOLERANCE) failures.push('moyenne ' + real.mean.toFixed(1) + ' sous sa base ' + baseMean.toFixed(1));
  assert.deepStrictEqual(failures, [], 'le score a baissé :\n  - ' + failures.join('\n  - '));
  if (raised.length) console.log('\n  À RELEVER : la note a MONTÉ pour ' + raised.join(', ') + ' — relever BASELINE dans dev-tests/lib/advice-gold.js pour que le cliquet la garde.');
  console.log('\nOK base — aucune table sous sa note mesurée le 25/11/2026 (moyenne ' + real.mean.toFixed(1) + ' / 100, couverture ' + pct(real.coverageMean).trim() + ')');
}

// Hygiène : le score ne dépend d'aucune bibliothèque, ne touche ni l'horloge ni le hasard.
{
  ['lib/advice-score.js', 'lib/advice-gold.js'].forEach((file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(!/Math\.random|Date\.now|new Date\(/.test(src), file + ' : le score doit être déterministe (ni hasard ni horloge)');
    assert.ok(!/require\((?!['"]\.)/.test(src), file + ' : aucune dépendance');
  });
  console.log('OK hygiène — score et étalon déterministes, sans dépendance');
}

console.log('\nOK — score de qualité des suggestions : tous les essais passent');
