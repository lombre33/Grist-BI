/*
 * « Compléter ce tableau de bord » (js/advice-complete.js, niveau 3 des suggestions, 25/11/2026), jugé sur les tables du corpus
 * (dev-tests/lib/advice-corpus.js) et sur des tableaux de bord fabriqués pour UN défaut :
 *
 *   node dev-tests/test-advice-complete.js
 *
 * Sept sortes d'essais :
 *  1. QUESTIONS : deux tuiles qui posent la même question partagent une clé (même mesure et même axe en barres puis en anneau, le même
 *     croisement en tableau croisé puis en carte de chaleur, un chiffre avec objectif qui dit aussi le chiffre nu) et jamais une clé
 *     quand la question change (autre agrégat, autre mesure, autre série) ;
 *  2. INTENTIONS : ce que dit une tuile déjà posée (une barre dont l'axe est du temps montre une évolution, un Pareto une concentration) ;
 *  3. PROPRIÉTÉS « jamais absurde », rejouées sur chaque table et sur trois tableaux de bord de départ : aucun doublon (ni avec le tableau
 *     de bord ni entre les propositions), des colonnes qui existent, un manque DIT seulement s'il est réel, des colonnes écartées
 *     recalculées par une boucle indépendante ;
 *  4. EXTINCTION : à force d'ajouter la première proposition la liste se vide, sans doublon, et les manques ne font que diminuer ;
 *  5. CAS FABRIQUÉS : une évolution manquante est dite puis cesse de l'être, une colonne écartée est nommée, un tableau de bord vide ou
 *     fait d'une note n'a ni manque ni colonne écartée ;
 *  6. ROBUSTESSE : entrées hostiles, phrases fr/en sans variable orpheline, 300 000 lignes, hygiène du fichier ;
 *  7. CÂBLAGE : panneau, éléments, clés i18n, ordre des scripts.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir la note « mutations » de HYPOTHESES.md, niveau 3).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const advice = require('../js/advice.js');
const complete = require('../js/advice-complete.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');
const { readMain } = require('./lib/helpers.js');

const tables = corpus.build();
const table = (name) => tables.find((t) => t.name === name);
const prep = (t) => { advice.setColumnInfo(t.info || {}); return t; };
const run = (t, tiles, opts) => { prep(t); return complete.complete(t.rows, tiles, Object.assign({ lang: 'fr', columnInfo: t.info || {} }, opts || {})); };
const suggest = (t, limit) => { prep(t); return advice.suggestTiles(t.rows, undefined, { limit, lang: 'fr', columnInfo: t.info || {} }); };
const keysOf = (tile) => complete.questionKeys(tile);
// `a` (une tuile posée) couvre-t-elle la question que pose `b` (une suggestion) ? La première clé de `b` doit être l'une des clés de `a`.
const covers = (tileA, tileB) => { const b = keysOf(tileB); return b.length > 0 && keysOf(tileA).indexOf(b[0]) !== -1; };
const label = (s) => `${s.type}:${s.tileData ? s.tileData.dimension || '' : s.dimension || ''}/${s.tileData ? s.tileData.measure || '' : s.measure || ''}`;

// ---------------------------------------------------------------------------------------------------------------------
// 1. QUESTIONS : ce qui est « la même chose » et ce qui ne l'est pas
// ---------------------------------------------------------------------------------------------------------------------
{
  const bar = { type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  // Mêmes colonnes dites autrement : une barre, un anneau, un treemap, une courbe, un entonnoir de la même mesure et du même axe.
  ['pie', 'treemap', 'line', 'funnel'].forEach((type) => assert.ok(covers(bar, Object.assign({}, bar, { type })), `${type} dit la même chose qu'une barre`));
  // Une autre question : autre agrégat, autre mesure, autre axe, une série de plus.
  assert.ok(!covers(bar, Object.assign({}, bar, { aggFn: 'avg' })), 'une moyenne n\'est pas une somme');
  assert.ok(!covers(bar, Object.assign({}, bar, { measure: 'Quantite' })), 'autre mesure');
  assert.ok(!covers(bar, Object.assign({}, bar, { dimension: 'Produit' })), 'autre axe');
  assert.ok(!covers(bar, Object.assign({}, bar, { seriesColumn: 'Produit' })), 'une série de plus change la question');
  // Compter des lignes ne dépend d'aucune colonne : la colonne comptée n'est qu'un nom.
  const countA = { type: 'bar', dimension: 'Region', measure: 'id', aggFn: 'count' };
  const countB = { type: 'pie', dimension: 'Region', measure: 'Produit', aggFn: 'count' };
  assert.ok(covers(countA, countB), 'compter les lignes par région, quelle que soit la colonne comptée');
  // Un croisement : tableau croisé, carte de chaleur, flux et soleil sur les mêmes colonnes, dans n'importe quel ordre.
  const pivot = { type: 'pivot', dimension: 'Region', columnDimension: 'Produit', measure: 'Montant', aggFn: 'sum' };
  assert.ok(covers(pivot, { type: 'heatmap', dimension: 'Produit', columnDimension: 'Region', measure: 'Montant', aggFn: 'sum' }), 'ordre des colonnes indifférent');
  assert.ok(covers(pivot, { type: 'sankey', dimension: 'Region', columnDimension: 'Produit', measure: 'Montant', aggFn: 'sum' }));
  assert.ok(covers(pivot, { type: 'sunburst', dimension: 'Region', drillDimensions: ['Produit'], measure: 'Montant', aggFn: 'sum' }));
  assert.ok(!covers(pivot, { type: 'heatmap', dimension: 'Region', columnDimension: 'Mois', measure: 'Montant', aggFn: 'sum' }), 'un autre croisement');
  // Le chiffre clé : avec son objectif il dit aussi le chiffre nu ; le chiffre nu ne dit pas l'objectif.
  const kpi = { type: 'kpi', measure: 'Montant', aggFn: 'sum' };
  const goalKpi = Object.assign({}, kpi, { targetColumn: 'Objectif' });
  assert.ok(covers(goalKpi, kpi), 'un chiffre avec objectif couvre le chiffre nu');
  assert.ok(!covers(kpi, goalKpi), 'un chiffre nu ne couvre pas le chiffre avec objectif');
  assert.ok(covers(kpi, { type: 'gauge', measure: 'Montant', aggFn: 'sum', gaugeMin: 0, gaugeMax: 9 }), 'une jauge de la même valeur');
  assert.ok(!covers(kpi, Object.assign({}, kpi, { measure: 'Quantite' })));
  // Relation : l'ordre des deux mesures est indifférent ; un Pareto n'est pas une barre.
  const scatter = { type: 'scatter', dimension: 'Client', measure: 'Prix', measureY: 'Ventes', aggFn: 'sum' };
  assert.ok(covers(scatter, { type: 'combo', dimension: 'Client', measure: 'Ventes', measureY: 'Prix', aggFn: 'sum' }), 'deux mesures, dans un ordre ou dans l\'autre');
  const pareto = { type: 'combo', comboMode: 'pareto', dimension: 'Client', measure: 'Montant', aggFn: 'sum' };
  assert.ok(!covers(pareto, { type: 'bar', dimension: 'Client', measure: 'Montant', aggFn: 'sum' }), 'un Pareto lit la concentration, une barre compare');
  assert.ok(!covers({ type: 'waterfall', dimension: 'Poste', measure: 'Montant', aggFn: 'sum' }, { type: 'bar', dimension: 'Poste', measure: 'Montant', aggFn: 'sum' }), 'une cascade décompose, une barre compare');
  assert.ok(!covers({ type: 'histogram', measure: 'Montant' }, { type: 'box', measure: 'Montant', dimension: 'Region' }), 'une distribution d\'ensemble n\'est pas une distribution par groupe');
  // Ce qui n'a pas de clé : une note, un type inconnu, une entrée qui n'est pas une tuile.
  assert.deepStrictEqual(keysOf({ type: 'text', text: 'Bonjour' }), []);
  assert.deepStrictEqual(keysOf({ type: 'inconnu' }), []);
  assert.deepStrictEqual(keysOf(null), []);
  assert.deepStrictEqual(keysOf('texte'), []);
  console.log('OK questions — barre/anneau/courbe confondus, agrégat, mesure, axe et série distincts, comptage sans colonne, croisements sans ordre, chiffre avec objectif, relation, Pareto, cascade');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. INTENTIONS : ce que dit une tuile déjà posée
// ---------------------------------------------------------------------------------------------------------------------
{
  const ctx = (() => { const t = prep(table('ventes')); return advice.analyzeColumns(t.rows, undefined, t.info || {}); })();
  const of = (tile) => complete.intentsOfTile(tile, ctx);
  assert.deepStrictEqual(of({ type: 'kpi', measure: 'Montant', aggFn: 'sum' }), ['overview']);
  assert.deepStrictEqual(of({ type: 'kpi', measure: 'Montant', aggFn: 'sum', targetColumn: 'Objectif' }), ['overview', 'goal'], 'un chiffre avec objectif sert aussi l\'objectif');
  assert.deepStrictEqual(of({ type: 'kpi', measure: 'Montant', aggFn: 'sum', target: 1000 }), ['overview', 'goal']);
  assert.deepStrictEqual(of({ type: 'line', dimension: 'Date.Mois', measure: 'Montant' }), ['trend']);
  assert.deepStrictEqual(of({ type: 'bar', dimension: 'Region', measure: 'Montant' }), ['compare']);
  assert.deepStrictEqual(of({ type: 'bar', dimension: 'Date', measure: 'Montant' }), ['trend'], 'une barre dont l\'axe est une date montre une évolution');
  assert.deepStrictEqual(of({ type: 'bar', dimension: 'Date.Mois', measure: 'Montant' }), ['trend'], 'une colonne dérivée se lit sur sa date');
  assert.deepStrictEqual(of({ type: 'combo', comboMode: 'pareto', dimension: 'Client', measure: 'Montant' }), ['concentrate']);
  assert.deepStrictEqual(of({ type: 'combo', dimension: 'Client', measure: 'Montant', measureY: 'Prix' }), ['relation']);
  const expected = { pie: 'share', treemap: 'share', scatter: 'relation', pivot: 'cross', heatmap: 'cross', radar: 'profile', histogram: 'distribution', box: 'distribution', waterfall: 'change', funnel: 'stages', calendar: 'rhythm', gantt: 'schedule', sunburst: 'structure', progress: 'goal' };
  Object.keys(expected).forEach((type) => assert.deepStrictEqual(of({ type }), [expected[type]], type));
  assert.deepStrictEqual(of({ type: 'text', text: 'x' }), [], 'une note ne dit rien des données');
  assert.deepStrictEqual(of(null), []);
  assert.deepStrictEqual(of({ type: 'inconnu' }), []);
  console.log('OK intentions — chiffre clé, objectif, évolution par barre sur une date, Pareto, relation, une intention par type, rien pour une note');
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. PROPRIÉTÉS rejouées sur chaque table du corpus et trois tableaux de bord de départ
// ---------------------------------------------------------------------------------------------------------------------
// Les colonnes d'une tuile, relues SANS le module : les mêmes champs, une boucle à soi.
const FIELDS = ['dimension', 'measure', 'measureY', 'measureSize', 'columnDimension', 'seriesColumn', 'targetColumn', 'startColumn', 'endColumn', 'dateColumn', 'radarEntityColumn', 'trendDimension', 'drillDimension'];
const LISTS = ['drillDimensions', 'radarAxes', 'columns'];
const columnsRead = (tile) => {
  const out = new Set();
  FIELDS.forEach((f) => { if (typeof tile[f] === 'string' && tile[f]) out.add(tile[f]); });
  LISTS.forEach((f) => { (tile[f] || []).forEach((c) => out.add(c)); });
  return out;
};
const baseColumn = (c) => (c.indexOf('.') > 0 ? c.slice(0, c.indexOf('.')) : c);

const propertyChecks = { tables: 0, boards: 0, items: 0 };
tables.forEach((t) => {
  prep(t);
  const allColumns = new Set(Object.keys(t.rows[0]));
  const profiles = advice.analyzeColumns(t.rows, undefined, t.info || {}).profiles;
  const meaningful = profiles.filter((p) => (p.role === 'measure' && !p.ordinal) || p.role === 'category' || p.role === 'time').map((p) => p.id);
  [1, 2, 3].forEach((k) => {
    const board = suggest(t, k).map((s) => s.tileData);
    const r = run(t, board);
    propertyChecks.boards++;
    assert.ok(r.items.length <= 3, `${t.name}/${k} : au plus trois cartes`);
    const taken = new Set();
    board.forEach((tile) => keysOf(tile).forEach((key) => taken.add(key)));
    const read = new Set();
    board.forEach((tile) => columnsRead(tile).forEach((c) => { read.add(c); read.add(baseColumn(c)); }));
    // Colonnes écartées : recalculées par une boucle indépendante.
    assert.deepStrictEqual(r.unused.slice().sort(), meaningful.filter((c) => !read.has(c)).sort(), `${t.name}/${k} : colonnes écartées`);
    r.items.forEach((item) => {
      propertyChecks.items++;
      const ks = keysOf(item.tileData);
      assert.ok(!ks.length || !taken.has(ks[0]), `${t.name}/${k} : « ${label(item)} » repose une question déjà posée (${ks})`);
      ks.forEach((key) => taken.add(key));
      columnsRead(item.tileData).forEach((c) => assert.ok(allColumns.has(c) || allColumns.has(baseColumn(c)) || (c === item.tileData.measure && item.tileData.aggFn === 'count'), `${t.name}/${k} : la colonne « ${c} » n'existe pas`));
      // Jamais un reste de liste : le seuil est un nombre écrit ici, pas la constante du module (qu'une faute pourrait abaisser).
      assert.ok(item.completeScore >= 4, `${t.name}/${k} : « ${label(item)} » sous le seuil (${item.completeScore})`);
      assert.ok(!(typeof item.interest === 'number' && item.interest < complete.DULL_INTEREST), `${t.name}/${k} : « ${label(item)} » n'a rien à montrer`);
      assert.ok(typeof item.titleKey === 'string' && typeof item.reasonKey === 'string', `${t.name}/${k} : titre et raison`);
      // Un manque n'est DIT que s'il est réel : aucune tuile du tableau de bord ne sert cette intention, et la phrase est celle de l'intention.
      if (item.gapIntent) {
        assert.strictEqual(item.gapKey, complete.GAP_KEYS[item.gapIntent], `${t.name}/${k} : phrase du manque`);
        assert.ok(r.missing.indexOf(item.gapIntent) !== -1, `${t.name}/${k} : le manque « ${item.gapIntent} » est annoncé`);
      }
      // Une colonne « nouvelle » n'est lue par aucune tuile du tableau de bord.
      item.newColumns.forEach((c) => assert.ok(!read.has(c), `${t.name}/${k} : « ${c} » est déjà lue`));
    });
    // Les manques sont des intentions que des tuiles existantes ne servent pas : jamais une intention d'une tuile du tableau de bord.
    const ctx = advice.analyzeColumns(t.rows, undefined, t.info || {});
    const served = new Set();
    board.forEach((tile) => complete.intentsOfTile(tile, ctx).forEach((i) => served.add(i)));
    r.missing.forEach((i) => assert.ok(!served.has(i), `${t.name}/${k} : « ${i} » est annoncé manquant alors qu'une tuile le sert`));
  });
  propertyChecks.tables++;
});
console.log(`OK propriétés — ${propertyChecks.tables} tables x 3 tableaux de bord (${propertyChecks.boards}), ${propertyChecks.items} propositions : aucun doublon, colonnes existantes, manques réels, colonnes écartées recalculées, jamais sous le seuil`);

// ---------------------------------------------------------------------------------------------------------------------
// 4. EXTINCTION : à force d'ajouter, la liste se vide, sans jamais reposer une question
// ---------------------------------------------------------------------------------------------------------------------
{
  let steps = 0;
  tables.forEach((t) => {
    const board = suggest(t, 1).map((s) => s.tileData);
    const asked = new Set();
    board.forEach((tile) => keysOf(tile).forEach((k) => asked.add(k)));
    let previousMissing = null;
    let guard = 0;
    for (;;) {
      assert.ok(guard++ < 60, `${t.name} : la liste ne se vide pas`);
      const r = run(t, board, { limit: 1 });
      if (previousMissing) r.missing.forEach((i) => assert.ok(previousMissing.indexOf(i) !== -1, `${t.name} : le manque « ${i} » est réapparu`));
      previousMissing = r.missing;
      if (!r.items.length) break;
      const keys = keysOf(r.items[0].tileData);
      assert.ok(!keys.length || !asked.has(keys[0]), `${t.name} : « ${label(r.items[0])} » est reproposée`);
      keys.forEach((k) => asked.add(k));
      board.push(r.items[0].tileData);
      steps++;
    }
    const last = run(t, board);
    assert.deepStrictEqual(last.items, [], `${t.name} : plus rien à proposer`);
  });
  console.log(`OK extinction — ${tables.length} tables, ${steps} ajouts successifs, jamais une question reposée, les manques ne reviennent pas`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. CAS FABRIQUÉS
// ---------------------------------------------------------------------------------------------------------------------
{
  // Un manque est dit, puis cesse de l'être : objectifs a une vraie évolution (Réalisé par mois).
  const t = table('objectifs');
  const board = [{ type: 'bar', dimension: 'Commercial', measure: 'Realise', aggFn: 'sum' }, { type: 'kpi', measure: 'Realise', aggFn: 'sum' }];
  const before = run(t, board);
  assert.ok(before.missing.indexOf('trend') !== -1, 'l\'évolution manque');
  const trend = before.items.find((i) => i.gapIntent === 'trend');
  assert.ok(trend && trend.type === 'line' && trend.tileData.measure === 'Realise', 'la courbe du réalisé par mois est proposée pour combler l\'évolution');
  assert.strictEqual(trend.gapKey, 'advice.gap.trend');
  i18n.setLang('fr');
  assert.strictEqual(i18n.t(trend.gapKey, trend.gapVars), 'Rien ne montre encore l’évolution dans le temps.');
  const after = run(t, board.concat([trend.tileData]));
  assert.ok(after.missing.indexOf('trend') === -1, 'l\'évolution ne manque plus');
  assert.ok(!after.items.some((i) => i.gapIntent === 'trend'), 'plus aucun manque d\'évolution dit');
  // Une barre dont l'axe est le temps sert déjà l'évolution : pas de manque non plus.
  const withBar = run(t, board.concat([{ type: 'bar', dimension: 'Mois', measure: 'Realise', aggFn: 'sum' }]));
  assert.ok(withBar.missing.indexOf('trend') === -1, 'une barre par mois montre l\'évolution');

  // Une colonne écartée est nommée quand la tuile n'a pas d'autre manque à combler.
  const crmTable = table('crm');
  const some = run(crmTable, [{ type: 'bar', dimension: 'Secteur', measure: 'Montant', aggFn: 'sum' }, { type: 'kpi', measure: 'Montant', aggFn: 'sum' }, { type: 'funnel', dimension: 'Etape', measure: 'Opportunite', aggFn: 'count' }]);
  assert.deepStrictEqual(some.unused.slice().sort(), ['Commercial', 'Probabilite'], `Commercial et Probabilite sont écartées, Secteur, Etape et Montant sont lues : ${some.unused}`);
  const ventes = table('ventes');
  const dated = run(ventes, [{ type: 'line', dimension: 'Date.Mois', measure: 'Montant', aggFn: 'sum' }]);
  assert.deepStrictEqual(dated.unused, ['Region'], 'Date.Mois lit la colonne Date : seule Region est écartée');
  assert.ok(run(ventes, [{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }]).unused.indexOf('Date') !== -1, 'sans courbe par date, la date est écartée');

  // Un tableau de bord vide ou fait d'une note : aucune comparaison à faire, les meilleures suggestions seules.
  const empty = run(ventes, []);
  const noteOnly = run(ventes, [{ type: 'text', text: 'Bonjour' }]);
  assert.deepStrictEqual(empty.missing, []); assert.deepStrictEqual(empty.unused, []);
  assert.deepStrictEqual(noteOnly.missing, []); assert.deepStrictEqual(noteOnly.unused, []);
  assert.ok(empty.items.length >= 1 && empty.items.every((i) => !i.gapKey && i.newColumns.length === 0), 'ni manque ni colonne écartée sur un tableau de bord vide');
  assert.deepStrictEqual(empty.items.map(label), noteOnly.items.map(label), 'une note ne compte pas comme une tuile');
  // Sans aucune ligne ou sans tuiles lisibles : une réponse vide, jamais une exception.
  assert.deepStrictEqual(complete.complete([], [{ type: 'kpi' }]).items, []);
  assert.deepStrictEqual(complete.complete(undefined, undefined).items, []);

  // Une tuile qui lit une colonne du tableau de bord via la 2e colonne (série, croisement) compte comme lue.
  const crm = table('crm');
  const seen = run(crm, [{ type: 'pivot', dimension: 'Secteur', columnDimension: 'Etape', measure: 'Montant', aggFn: 'sum' }]);
  assert.ok(seen.unused.indexOf('Secteur') === -1 && seen.unused.indexOf('Etape') === -1, 'les deux axes d\'un tableau croisé sont lus');

  // Un manque réel passe devant une tuile plus forte qui n'en comble aucun : sur les produits (barres + chiffre clé posés), la meilleure suggestion
  // ouverte par sa seule note est une barre de la marge, la carte retenue en premier comble pourtant un manque (la distribution).
  const produits = table('produits');
  const board2 = [{ type: 'bar', dimension: 'Produit', measure: 'Ventes', aggFn: 'sum' }, { type: 'kpi', measure: 'Ventes', aggFn: 'sum' }];
  const open = suggest(produits, 80).filter((s) => !board2.some((tile) => covers(tile, s.tileData)) && !(typeof s.interest === 'number' && s.interest < 0.2));
  const strongest = open.slice().sort((a, b) => b.score - a.score)[0];
  const [first] = run(produits, board2, { limit: 1 }).items;
  assert.ok(first && first.gapIntent, 'la 1re carte comble un manque');
  assert.ok(strongest.score > first.score + 0.5 && label(strongest) !== label(first), `une tuile plus forte (${label(strongest)} ${strongest.score}) passe derrière « ${label(first)} » ${first.score} qui comble un manque`);

  // Trois cartes ne servent jamais trois fois la même intention ni ne répètent un type quand d'autres existent.
  const org = run(table('organisation'), [{ type: 'bar', dimension: 'Departement', measure: 'Budget', aggFn: 'sum' }]);
  const intents = org.items.map((i) => i.gapIntent).filter(Boolean);
  assert.strictEqual(new Set(intents).size, intents.length, `chaque manque une fois : ${intents}`);
  console.log('OK cas fabriqués — évolution dite puis comblée (courbe ou barre par mois), colonne écartée nommée, dérivée lue sur sa date, tableau de bord vide ou fait d\'une note, axes d\'un croisement lus');
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. ROBUSTESSE
// ---------------------------------------------------------------------------------------------------------------------
{
  const t = table('ventes');
  // Entrées hostiles : jamais d'exception, la même réponse qu'un tableau de bord sans ces entrées.
  const hostile = [null, undefined, 'texte', 42, [], [1, 2], { type: 123 }, { type: 'bar', dimension: { a: 1 }, measure: ['x'] }, { type: 'pie', drillDimensions: 'Region' },
    { type: 'radar', radarAxes: { 0: 'Montant' } }, { type: 'bar', dimension: 'Colonne qui n\'existe pas', measure: 'Autre', aggFn: 'sum' }, JSON.parse('{"type":"bar","__proto__":{"dimension":"Region"}}')];
  const baseline = run(t, [{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }]);
  const noisy = run(t, hostile.concat([{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }]));
  assert.ok(noisy.items.length >= 1);
  assert.doesNotThrow(() => run(t, hostile));
  assert.doesNotThrow(() => complete.complete(t.rows, 'pas un tableau'));
  assert.ok(baseline.items.length >= 1);
  // Déterministe : deux appels, la même liste.
  assert.deepStrictEqual(run(t, [{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }]).items.map(label), baseline.items.map(label));
  // Le tableau de bord de l'appelant n'est pas modifié.
  const board = [{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }];
  const frozen = JSON.stringify(board);
  run(t, board);
  assert.strictEqual(JSON.stringify(board), frozen, 'les tuiles ne sont jamais modifiées');

  // Phrases : chaque intention et la colonne écartée se résolvent en fr et en anglais, sans variable orpheline.
  ['fr', 'en'].forEach((lang) => {
    i18n.setLang(lang);
    Object.keys(complete.GAP_KEYS).forEach((intent) => {
      const text = i18n.t(complete.GAP_KEYS[intent], {});
      assert.ok(text && text !== complete.GAP_KEYS[intent] && text.indexOf('{') === -1, `${lang} ${intent} : « ${text} »`);
    });
    const col = i18n.t(complete.NEW_COLUMN_KEY, { column: 'Marge' });
    assert.ok(col.indexOf('Marge') !== -1 && col.indexOf('{') === -1, `${lang} colonne écartée : « ${col} »`);
  });
  i18n.setLang('fr');
  Object.keys(advice.INTENT_KEYS).forEach((intent) => assert.ok(complete.GAP_KEYS[intent], `chaque intention de js/advice.js a sa phrase de manque : ${intent}`));
  // Une carte en anglais : la raison chiffrée est en anglais, le manque aussi.
  const en = run(t, [{ type: 'kpi', measure: 'Montant', aggFn: 'sum' }], { lang: 'en' });
  assert.ok(en.items.some((i) => i.gapKey), 'au moins un manque à dire');
  en.items.forEach((i) => {
    i18n.setLang('en');
    const reasonEn = i18n.t(i.reasonKey, i.reasonVars); const gapEn = i.gapKey ? i18n.t(i.gapKey, i.gapVars) : '';
    i18n.setLang('fr');
    const gapFr = i.gapKey ? i18n.t(i.gapKey, i.gapVars) : '';
    assert.ok(reasonEn && reasonEn.indexOf('{') === -1, `raison en anglais : ${reasonEn}`);
    assert.ok(!i.gapKey || (gapEn.indexOf('{') === -1 && gapEn !== gapFr), `manque traduit : ${gapEn} / ${gapFr}`);
  });
  console.log('OK robustesse — entrées hostiles, déterminisme, tuiles intactes, 15 phrases de manque fr/en, une phrase par intention de js/advice.js');
}

{
  // 300 000 lignes triées par date : la même durée que les suggestions seules (un profilage), jamais plus d'une seconde et demie.
  const big = corpus.sortedBigTable(300000);
  const rows = big.rows || big;
  const first = advice.suggestTiles(rows, undefined, { limit: 2, lang: 'fr' }).map((s) => s.tileData);
  const start = Date.now();
  const r = complete.complete(rows, first, { lang: 'fr' });
  const ms = Date.now() - start;
  assert.ok(ms < 1500, `300 000 lignes : ${ms} ms`);
  assert.ok(Array.isArray(r.items));
  console.log(`OK volume — 300 000 lignes en ${ms} ms`);
}

{
  // Hygiène : pur (ni DOM, ni Grist, ni horloge, ni hasard), sous 600 lignes, aucun texte français en dur, les clés citées en littéral.
  const file = path.join(__dirname, '..', 'js', 'advice-complete.js');
  const source = fs.readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  assert.ok(source.split('\n').length <= 600, 'au plus 600 lignes');
  ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch('].forEach((bad) => assert.ok(code.indexOf(bad) === -1, `le fichier est pur : « ${bad} »`));
  assert.ok(!/[àâçéèêëîïôûùü]/i.test(code), 'aucune lettre accentuée hors des commentaires : pas de texte en dur');
  const used = new Set((code.match(/'advice\.[A-Za-z]+\.[A-Za-z]+'/g) || []).map((k) => k.slice(1, -1)));
  used.forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, `clé citée et traduite : ${k}`));
  assert.strictEqual(used.size, Object.keys(complete.GAP_KEYS).length + 1, 'quinze phrases de manque et la colonne écartée, citées en littéral');
  Object.keys(i18n.STRINGS).filter((k) => /^advice\.(gap|complete)\./.test(k)).forEach((k) => assert.ok(used.has(k), `clé définie et jamais utilisée : ${k}`));
  console.log(`OK hygiène — ${source.split('\n').length} lignes, pur, sans texte en dur, ${used.size} clés citées en littéral`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. CÂBLAGE : panneau, éléments, clés i18n, ordre des scripts
// ---------------------------------------------------------------------------------------------------------------------
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  ['tile-complete', 'tile-complete-title', 'tile-complete-list', 'tile-complete-live'].forEach((id) => {
    assert.ok(html.indexOf(`id="${id}"`) !== -1, `index.html : #${id}`);
    assert.ok(harness.indexOf(`id="${id}"`) !== -1, `harness.html : #${id}`);
  });
  assert.ok(/id="tile-complete"[^>]*\bhidden\b/.test(html), 'la section est masquée au départ');
  assert.ok(/id="tile-complete-live"[^>]*role="status"/.test(html), 'l\'annonce est une zone de statut');
  const order = (text, prefix) => ['advice.js', 'advice-complete.js', 'welcome.js'].map((n) => text.indexOf(`<script src="${prefix}js/${n}"></script>`));
  [[html, ''], [harness, '../']].forEach(([text, prefix]) => {
    const [a, c, w] = order(text, prefix);
    assert.ok(a > 0 && c > a && w > c, 'advice.js, puis advice-complete.js, puis welcome.js');
  });
  const main = readMain();
  assert.ok(/GristBI\.adviceComplete\.complete\(/.test(main), 'le panneau appelle le module');
  assert.ok(/function renderCompletion\(/.test(main) && /renderTypeCards\(\);\s*renderCompletion\(\);/.test(main), 'rempli à l\'ouverture du panneau et au changement de langue');
  assert.ok((main.match(/renderCompletion\(/g) || []).length >= 4, 'ouverture, changement de langue, ajout d\'une carte, définition');
  assert.ok(/hideCompletion\(\);\s*workspaceEl\.classList\.remove\('panel-open'\)/.test(main), 'masquée et annulée à la fermeture du panneau');
  assert.ok(/S\.editingTileId \|\| !tiles\.length \|\| !state\.rows\.length/.test(main), 'ni en modification d\'une tuile, ni sans tuile, ni sans ligne');
  assert.ok(/state\.pages\.reduce\(/.test(main), 'toutes les pages comptent');
  assert.ok(/data-complete=/.test(main) && /flashTile\(id\)/.test(main) && /tilePanel\.complete\.added/.test(main), 'ajout, clignotement de la tuile posée, annonce');
  assert.ok(/token !== completionToken \|\| tilePanel\.hidden/.test(main), 'un calcul périmé ou un panneau refermé n\'écrit rien');
  ['tilePanel.complete.title', 'tilePanel.complete.lead', 'tilePanel.complete.added'].forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, k));
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ['.tile-complete', '.complete-card', '.complete-card-gap', '.complete-preview'].forEach((sel) => assert.ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  console.log('OK câblage — panneau, quatre éléments, ordre des scripts, appels à l\'ouverture / langue / fermeture / ajout, clés et styles');
}

console.log('\nOK — « Compléter ce tableau de bord » : tous les essais passent');
