/*
 * « Que faire avec cette colonne ? » (js/advice-column.js, niveau 3 des suggestions, 25/11/2026), jugé sur les tables du corpus
 * (dev-tests/lib/advice-corpus.js) et sur des tableaux fabriqués pour UN défaut :
 *
 *   node dev-tests/test-advice-column.js
 *
 * Sept sortes d'essais :
 *  1. COLONNES PROPOSÉES : `id` et les colonnes dérivées d'une date n'en font pas partie, une fausse dérivée (sans sa date) si ;
 *  2. RÔLES : chaque colonne reçoit la phrase de son rôle (mesure à additionner, à moyenner, note, numéro, catégorie, année, date, identifiant,
 *     référence, liste, texte libre, constante), jugée sur les VALEURS et le type Grist ;
 *  3. PROPRIÉTÉS « jamais absurde », rejouées sur chaque colonne de chaque table et sur trois tableaux de bord de départ : trois propositions au
 *     plus, TOUTES lisent la colonne (recalculé par une boucle indépendante), aucun doublon d'une tuile posée ni entre elles, une raison quand la
 *     liste est vide, le compte des tuiles qui la lisent déjà ;
 *  4. CAS FABRIQUÉS : la colonne passe en tête de son rôle (une 7e mesure, une 4e catégorie ne paraissaient jamais), une tuile terne reste
 *     une réponse, le manque est dit puis comblé, tout ce qui est déjà posé est dit « déjà dans le tableau de bord », à force d'ajouter la
 *     liste se vide ;
 *  5. ROBUSTESSE : entrées hostiles, tuiles intactes, déterminisme, phrases fr/en, 300 000 lignes ;
 *  6. HYGIÈNE du fichier ;
 *  7. CÂBLAGE : champ à autocomplétion, résultats, aucun nouvel appel perdu, ordre des scripts.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir la note « mutations » de HYPOTHESES.md, niveau 3c).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const advice = require('../js/advice.js');
const complete = require('../js/advice-complete.js');
const column = require('../js/advice-column.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');
const { readMain } = require('./lib/helpers.js');

const tables = corpus.build();
const table = (name) => tables.find((t) => t.name === name);
const prep = (t) => { advice.setColumnInfo(t.info || {}); return t; };
const describe = (t, tiles, col, opts) => { prep(t); return column.describe(t.rows, tiles, col, Object.assign({ lang: 'fr', columnInfo: t.info || {} }, opts || {})); };
const keysOf = (tile) => complete.questionKeys(tile);
const covers = (tileA, tileB) => { const b = keysOf(tileB); return b.length > 0 && keysOf(tileA).indexOf(b[0]) !== -1; };
const label = (s) => `${s.type}:${s.tileData.dimension || ''}/${s.tileData.measure || ''}`;
const idsOf = (t) => Object.keys(t.rows[0]);

// Recalcul INDÉPENDANT de « cette tuile lit-elle cette colonne » (écrit ici, pas lu du module).
const FIELDS = ['dimension', 'measure', 'measureY', 'measureSize', 'columnDimension', 'seriesColumn', 'targetColumn', 'startColumn', 'endColumn', 'dateColumn', 'radarEntityColumn', 'trendDimension'];
const LISTS = ['drillDimensions', 'radarAxes', 'columns'];
const reads = (tile, col) => {
  const cols = [];
  FIELDS.forEach((f) => { if (typeof tile[f] === 'string' && tile[f]) cols.push(tile[f]); });
  LISTS.forEach((f) => { if (Array.isArray(tile[f])) tile[f].forEach((c) => { if (typeof c === 'string' && c) cols.push(c); }); });
  const counting = tile.aggFn === 'count' && tile.measure && tile.measure !== tile.dimension;
  return cols.some((c) => !(counting && c === tile.measure) && (c === col || c.split('.')[0] === col));
};
const phrase = (key, vars, lang) => { i18n.setLang(lang); return i18n.t(key, vars); };
const clean = (s) => typeof s === 'string' && s.length > 0 && !/[{}]|NaN|undefined|null/.test(s);

// ---------------------------------------------------------------------------------------------------------------------
// 1. COLONNES PROPOSÉES
// ---------------------------------------------------------------------------------------------------------------------
{
  assert.deepStrictEqual(column.pickableColumns(['id', 'Date', 'Region', 'Date.Annee', 'Date.Trimestre', 'Date.Mois', 'Montant']), ['Date', 'Region', 'Montant'], 'ni id ni les dérivées d\'une date');
  assert.deepStrictEqual(column.pickableColumns(['Region', 'Plan.Annee', 'Plan.Mois']), ['Region', 'Plan.Annee', 'Plan.Mois'], 'une fausse dérivée (sa date n\'existe pas) reste une vraie colonne');
  assert.deepStrictEqual(column.pickableColumns(['A', '', 'A', null, 42, 'B']).filter((c) => c === 'B'), ['B'], 'entrées vides ignorées');
  assert.deepStrictEqual(column.pickableColumns(null), []);
  assert.deepStrictEqual(column.pickableColumns('Date'), []);
  tables.forEach((t) => {
    const picks = column.pickableColumns(idsOf(t));
    assert.ok(picks.length > 0, `${t.name} : des colonnes à choisir`);
    assert.ok(picks.every((c) => c !== 'id' && !/\.(Annee|Trimestre|Mois)$/.test(c) || idsOf(t).indexOf(c.split('.')[0]) === -1), `${t.name} : aucune dérivée`);
  });
  console.log('OK colonnes proposées — id et dérivées d\'une date exclues, fausse dérivée gardée, entrées hostiles');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. RÔLES
// ---------------------------------------------------------------------------------------------------------------------
{
  const role = (t, col) => describe(t, [], col).role;
  assert.strictEqual(role(table('rh'), 'Salaire'), 'measureSum');
  assert.strictEqual(role(table('rh'), 'Service'), 'category');
  assert.strictEqual(role(table('rh'), 'Embauche'), 'time');
  assert.strictEqual(role(table('rh'), 'Matricule'), 'identifier');
  assert.strictEqual(role(table('notes'), 'Maths'), 'score', 'une note sur 20 reconnue par ses sœurs');
  assert.strictEqual(describe(table('notes'), [], 'Maths').roleVars.top, 20, 'l\'échelle de la note est dite');
  assert.strictEqual(role(table('enquete'), 'Commentaire'), 'freeText');
  assert.strictEqual(role(table('contacts'), 'Tags'), 'list');
  assert.strictEqual(role(table('commandes'), 'Client'), 'reference', 'une colonne Référence est un numéro de ligne, pas une mesure');
  assert.strictEqual(role(table('commandes'), 'Options'), 'list');
  assert.strictEqual(role(table('commandes'), 'Date'), 'time');
  assert.strictEqual(role(table('ventes'), 'Client'), 'manyValues');
  assert.strictEqual(role(table('ventes'), 'Date.Mois'), 'timePart');
  assert.strictEqual(describe(table('ventes'), [], 'Date.Mois').roleVars.base, 'Date', 'une colonne dérivée dit de quelle date elle vient');
  // Une mesure qu'on moyenne : le nom (taux, note…) ou le format pourcentage de Grist, jamais la somme.
  const avg = { name: 'avg', rows: [], info: { Part: { type: 'Numeric', widgetOptions: JSON.stringify({ numMode: 'percent' }) } } };
  for (let i = 0; i < 40; i++) avg.rows.push({ id: i + 1, Part: 0.1 + (i % 9) * 0.07, Service: ['A', 'B', 'C'][i % 3], Prix_unitaire: 3.5 + (i % 7) * 1.25, Total: 100 + i * 13.5 });
  assert.strictEqual(role(avg, 'Part'), 'measureAvg', 'un pourcentage se moyenne');
  assert.strictEqual(role(avg, 'Prix_unitaire'), 'measureAvg', 'un prix unitaire se moyenne');
  assert.strictEqual(role(avg, 'Total'), 'measureSum');
  // Une colonne qui n'a qu'une valeur, un numéro de mois répété, une année.
  const odd = { name: 'odd', rows: [] };
  for (let i = 0; i < 60; i++) odd.rows.push({ id: i + 1, Fixe: 'x', Mois: (i % 12) + 1, Annee: 2020 + (i % 5), Montant: 100.5 + i * 3.25, Service: ['A', 'B', 'C', 'D'][i % 4] });
  assert.strictEqual(role(odd, 'Fixe'), 'constant');
  assert.strictEqual(role(odd, 'Mois'), 'ordinal', 'un numéro de mois n\'est pas une quantité');
  assert.strictEqual(role(odd, 'Annee'), 'year');
  // Chaque rôle a sa phrase, dans les deux langues, sans variable orpheline.
  Object.keys(column.ROLE_KEYS).forEach((r) => {
    const vars = { column: 'Col', n: 5, top: 20, base: 'Date' };
    ['fr', 'en'].forEach((lang) => assert.ok(clean(phrase(column.ROLE_KEYS[r], vars, lang)), `phrase du rôle ${r} (${lang})`));
    assert.ok(phrase(column.ROLE_KEYS[r], vars, 'fr').indexOf('Col') !== -1 || r === 'timePart', `la phrase du rôle ${r} nomme la colonne`);
  });
  i18n.setLang('fr');
  assert.strictEqual(phrase(column.USED_KEY, { n: 1 }, 'fr'), 'Déjà lue par 1 tuile du tableau de bord.');
  assert.strictEqual(phrase(column.USED_KEY, { n: 3 }, 'fr'), 'Déjà lue par 3 tuiles du tableau de bord.');
  assert.strictEqual(phrase(column.USED_KEY, { n: 1 }, 'en'), 'Already read by 1 tile on the dashboard.');
  assert.strictEqual(phrase(column.USED_KEY, { n: 2 }, 'en'), 'Already read by 2 tiles on the dashboard.');
  i18n.setLang('fr');
  console.log('OK rôles — 14 phrases fr/en (mesure à additionner ou moyenner, note, numéro, catégorie, année, date, identifiant, référence, liste, texte, constante, dérivée), jugés sur les valeurs et le type Grist');
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. PROPRIÉTÉS « jamais absurde » : chaque colonne de chaque table, trois tableaux de bord de départ
// ---------------------------------------------------------------------------------------------------------------------
{
  let cases = 0;
  let proposals = 0;
  let empties = 0;
  let lowest = Infinity;
  tables.forEach((t) => {
    prep(t);
    const first = advice.suggestTiles(t.rows, undefined, { limit: 3, lang: 'fr', columnInfo: t.info || {} }).map((s, i) => Object.assign({ id: `p${i}` }, s.tileData));
    const boards = [[], first.slice(0, 1), first];
    column.pickableColumns(idsOf(t)).forEach((col) => {
      boards.forEach((board, b) => {
        const r = describe(t, board, col);
        const where = `${t.name}.${col} (tableau ${b})`;
        cases++;
        assert.strictEqual(r.ok, true, `${where} : réponse`);
        assert.ok(r.items.length <= 3, `${where} : trois propositions au plus`);
        proposals += r.items.length;
        r.items.forEach((s) => {
          assert.ok(reads(s.tileData, col), `${where} : « ${label(s)} » lit la colonne`);
          board.forEach((posed) => assert.ok(!covers(posed, s.tileData), `${where} : « ${label(s)} » refait une tuile posée`));
          assert.ok(clean(phrase(s.titleKey, s.titleVars, 'fr')) && clean(phrase(s.reasonKey, s.reasonVars, 'fr')), `${where} : phrases fr`);
          assert.ok(clean(phrase(s.titleKey, s.titleVars, 'en')) && clean(phrase(s.reasonKey, s.reasonVars, 'en')), `${where} : phrases en`);
          if (s.gapKey) assert.ok(clean(phrase(s.gapKey, s.gapVars, 'fr')) && clean(phrase(s.gapKey, s.gapVars, 'en')), `${where} : manque dit`);
          assert.ok(s.completeScore >= 2, `${where} : jamais sous 2 points (${s.completeScore})`);
          lowest = Math.min(lowest, s.completeScore);
          assert.notStrictEqual(s.gapKey, complete.NEW_COLUMN_KEY, `${where} : la colonne est choisie, jamais « écartée »`);
          // Une colonne Référence ou de listes n'est jamais une mesure ni un axe.
          const info = (t.info || {})[col];
          if (info && (/^Ref(List)?:/.test(info.type) || info.type === 'ChoiceList')) assert.fail(`${where} : une colonne ${info.type} ne devrait rien proposer (${label(s)})`);
        });
        for (let i = 0; i < r.items.length; i++) for (let j = i + 1; j < r.items.length; j++) {
          assert.ok(!covers(r.items[i].tileData, r.items[j].tileData) && !covers(r.items[j].tileData, r.items[i].tileData), `${where} : « ${label(r.items[i])} » et « ${label(r.items[j])} » posent la même question`);
        }
        assert.strictEqual(r.emptyKey === '', r.items.length > 0, `${where} : une raison quand la liste est vide, aucune sinon`);
        if (r.emptyKey) { empties++; assert.ok(clean(phrase(r.emptyKey, {}, 'fr')) && clean(phrase(r.emptyKey, {}, 'en')), `${where} : raison fr/en`); }
        if (r.emptyKey === column.EMPTY_KEYS.covered) assert.ok(r.covered > 0 && board.length > 0, `${where} : « déjà couvert » seulement si une tuile pose la question`);
        assert.strictEqual(r.usedBy, board.filter((posed) => reads(posed, col)).length, `${where} : tuiles qui la lisent déjà`);
        assert.ok(clean(phrase(r.roleKey, r.roleVars, 'fr')) && clean(phrase(r.roleKey, r.roleVars, 'en')), `${where} : phrase du rôle`);
      });
    });
  });
  assert.ok(proposals > 300, `assez de propositions pour juger (${proposals})`);
  assert.ok(empties > 20, `assez de colonnes sans proposition pour juger leur raison (${empties})`);
  assert.ok(lowest < 4, `une colonne choisie garde des réponses modestes, sous le seuil de 4 points de « Compléter » (${lowest})`);
  console.log(`OK propriétés — ${cases} colonnes x tableaux de bord, ${proposals} propositions : toutes lisent la colonne, aucun doublon, raison quand vide, aucune Référence ni liste en axe, phrases fr/en`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. CAS FABRIQUÉS
// ---------------------------------------------------------------------------------------------------------------------
{
  // (a) La colonne passe en tête de son rôle : le catalogue ne regarde que les deux premières mesures et les trois premières catégories.
  const large = table('large');
  prep(large);
  const all = advice.suggestTiles(large.rows, undefined, { limit: 200, lang: 'fr', columnInfo: large.info || {} });
  assert.ok(!all.some((s) => reads(s.tileData, 'Metrique7')), 'sans la colonne en tête, la 7e mesure n\'est jamais lue (le défaut que le lot corrige)');
  const m7 = describe(large, [], 'Metrique7');
  assert.ok(m7.items.length >= 2 && m7.items.every((s) => reads(s.tileData, 'Metrique7')), `la 7e mesure a ses propositions (${m7.items.map(label).join(', ')})`);
  assert.ok(m7.items.some((s) => s.type === 'kpi'), 'le total de la mesure choisie est proposé');
  const rh = table('rh');
  prep(rh);
  const allRh = advice.suggestTiles(rh.rows, undefined, { limit: 200, lang: 'fr', columnInfo: rh.info || {} });
  assert.ok(!allRh.some((s) => reads(s.tileData, 'Sexe')), 'sans la colonne en tête, la 4e catégorie n\'est jamais lue');
  const sexe = describe(rh, [], 'Sexe');
  assert.ok(sexe.items.length >= 1 && sexe.items.every((s) => reads(s.tileData, 'Sexe')), 'la 4e catégorie a sa proposition');

  // (b) Une colonne de dates : la courbe dans le temps, par année, mois ou jour selon l'étendue ; le manque est dit puis comblé.
  const ventes = table('ventes');
  const bar = { id: 'b1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' };
  const date = describe(ventes, [bar], 'Date');
  assert.ok(date.items.some((s) => s.type === 'line' && s.gapKey === 'advice.gap.trend'), 'l\'évolution manquante est dite');
  const line = date.items.find((s) => s.type === 'line');
  const after = describe(ventes, [bar, Object.assign({ id: 'l1' }, line.tileData)], 'Date');
  assert.ok(!after.items.some((s) => s.gapKey === 'advice.gap.trend'), 'le manque est comblé : il n\'est plus dit');
  assert.ok(!after.items.some((s) => covers(line.tileData, s.tileData)), 'et la courbe n\'est plus reproposée');
  assert.strictEqual(after.usedBy, 1, 'la courbe lit la date');

  // (c) Une tuile terne reste une réponse quand la personne a posé la question (les données n'ont pas grand-chose à dire de Service).
  const service = describe(rh, [], 'Service');
  assert.ok(service.items.length >= 1, 'une colonne choisie a toujours une réponse quand une tuile la lit');
  assert.ok(service.items.every((s) => typeof s.interest !== 'number' || s.interest < complete.DULL_INTEREST), 'ici les données sont ternes (c\'est ce que le cas fabrique)');
  const generic = complete.complete(rh.rows, [], { lang: 'fr', limit: 3 });
  assert.ok(!generic.items.some((s) => reads(s.tileData, 'Service')), 'sans question posée, une tuile terne n\'est pas proposée');

  // (d) Rien d'utile à tracer : identifiant, texte libre, liste, référence, constante — une raison, jamais un silence.
  [[rh, 'Matricule'], [table('enquete'), 'Commentaire'], [table('contacts'), 'Tags'], [table('commandes'), 'Client'], [table('commandes'), 'Options']].forEach(([t, col]) => {
    const r = describe(t, [], col);
    assert.strictEqual(r.items.length, 0, `${t.name}.${col} : rien à proposer`);
    assert.strictEqual(r.emptyKey, column.EMPTY_KEYS.none, `${t.name}.${col} : la raison est dite`);
  });
  const odd = { name: 'odd', rows: [] };
  for (let i = 0; i < 60; i++) odd.rows.push({ id: i + 1, Fixe: 'x', Montant: 100.5 + i * 3.25, Service: ['A', 'B', 'C', 'D'][i % 4] });
  assert.strictEqual(describe(odd, [], 'Fixe').items.length, 0, 'une constante ne se compare à rien');

  // (e) À force d'ajouter la première proposition, la liste se vide : « tout est déjà dans le tableau de bord ».
  [['ventes', 'Montant'], ['ventes', 'Region'], ['rh', 'Salaire'], ['produits', 'Ventes'], ['organisation', 'Departement']].forEach(([name, col]) => {
    const t = table(name);
    const board = [];
    let guard = 0;
    for (; guard < 30; guard++) {
      const r = describe(t, board, col);
      if (!r.items.length) {
        assert.strictEqual(r.emptyKey, column.EMPTY_KEYS.covered, `${name}.${col} : vidée par les ajouts, la raison est « déjà posé »`);
        assert.ok(r.covered > 0, `${name}.${col} : des propositions écartées parce que posées`);
        break;
      }
      const pick = r.items[0];
      board.forEach((posed) => assert.ok(!covers(posed, pick.tileData), `${name}.${col} : une question reposée après ${board.length} ajouts`));
      board.push(Object.assign({ id: `a${guard}` }, pick.tileData));
    }
    assert.ok(guard > 0 && guard < 30, `${name}.${col} : la liste se vide (${guard} ajouts)`);
  });

  // (f) Les tuiles qui la lisent déjà : une note, un décompte et une colonne de l'autre côté ne comptent pas.
  const posed = [
    { id: 'u1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' },
    { id: 'u2', type: 'kpi', dimension: '', measure: 'Montant', aggFn: 'sum' },
    { id: 'u3', type: 'text', text: 'Montant' },
    { id: 'u4', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'count' },
    { id: 'u5', type: 'line', dimension: 'Date.Mois', measure: 'Montant', aggFn: 'sum' }
  ];
  assert.strictEqual(describe(ventes, posed, 'Montant').usedBy, 3, 'barre, chiffre clé, courbe : trois ; ni la note, ni le décompte');
  assert.strictEqual(describe(ventes, posed, 'Region').usedBy, 2, 'les deux barres (le décompte lit l\'axe)');
  assert.strictEqual(describe(ventes, posed, 'Date').usedBy, 1, 'une dérivée se lit sur sa date');
  console.log('OK cas fabriqués — colonne en tête de son rôle (7e mesure, 4e catégorie), manque dit puis comblé, tuile terne gardée quand on demande, rien à tracer = une raison, extinction par les ajouts, tuiles qui la lisent déjà');
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. ROBUSTESSE
// ---------------------------------------------------------------------------------------------------------------------
{
  const ventes = table('ventes');
  assert.deepStrictEqual(column.describe([], [], 'Region', {}), { ok: false, reason: 'rows' });
  assert.deepStrictEqual(column.describe(null, [], 'Region', {}), { ok: false, reason: 'rows' });
  assert.deepStrictEqual(column.describe(ventes.rows, [], 'Inconnue', {}), { ok: false, reason: 'column' });
  [undefined, null, '', 42, {}, ['Region']].forEach((c) => assert.strictEqual(column.describe(ventes.rows, [], c, {}).ok, false, `colonne ${JSON.stringify(c)} refusée`));
  const hostile = [null, undefined, 'bar', 7, [], { type: 'bar' }, { type: 'bar', dimension: 42, measure: ['x'] }, { type: 'text' }, { id: 'ok', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }];
  const before = JSON.stringify(hostile);
  const r = column.describe(ventes.rows, hostile, 'Region', { lang: 'fr' });
  assert.strictEqual(r.ok, true, 'tuiles hostiles : toujours une réponse');
  assert.strictEqual(JSON.stringify(hostile), before, 'les tuiles ne sont jamais modifiées');
  assert.ok(column.describe(ventes.rows, 'pas un tableau', 'Region').ok && column.describe(ventes.rows, undefined, 'Region').ok, 'tuiles absentes');
  assert.strictEqual(column.usedBy(null, 'Region'), 0);
  const a = column.describe(ventes.rows, [], 'Montant', { lang: 'fr' });
  const b = column.describe(ventes.rows, [], 'Montant', { lang: 'fr' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'déterministe');
  const empty = { name: 'vides', rows: [] };
  for (let i = 0; i < 40; i++) empty.rows.push({ id: i + 1, Vide: null, Texte: i % 2 ? '' : null, Montant: i % 3 ? 10.5 + i : null, Service: ['A', 'B'][i % 2] });
  ['Vide', 'Texte', 'Montant', 'Service'].forEach((c) => assert.strictEqual(describe(empty, [], c).ok, true, `cellules vides : ${c}`));
  assert.strictEqual(describe(empty, [], 'Vide').role, 'constant', 'une colonne entièrement vide n\'a qu\'une « valeur »');
  // 300 000 lignes triées par date : un profilage, jamais plus d'une seconde et demie.
  const big = corpus.sortedBigTable(300000);
  const rows = big.rows || big;
  const start = Date.now();
  const r2 = column.describe(rows, [], Object.keys(rows[0]).find((c) => c !== 'id'), { lang: 'fr' });
  const ms = Date.now() - start;
  assert.ok(r2.ok && ms < 1500, `300 000 lignes : ${ms} ms`);
  console.log(`OK robustesse — entrées hostiles, tuiles intactes, déterminisme, cellules vides, 300 000 lignes en ${ms} ms`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. HYGIÈNE
// ---------------------------------------------------------------------------------------------------------------------
{
  const file = path.join(__dirname, '..', 'js', 'advice-column.js');
  const source = fs.readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  assert.ok(source.split('\n').length <= 600, 'au plus 600 lignes');
  ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch('].forEach((bad) => assert.ok(code.indexOf(bad) === -1, `le fichier est pur : « ${bad} »`));
  assert.ok(!/[àâçéèêëîïôûùü]/i.test(code), 'aucune lettre accentuée hors des commentaires : pas de texte en dur');
  const used = new Set((code.match(/'advice\.column\.[A-Za-z.]+'/g) || []).map((k) => k.slice(1, -1)));
  used.forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, `clé citée et traduite : ${k}`));
  assert.strictEqual(used.size, Object.keys(column.ROLE_KEYS).length + 1 + Object.keys(column.EMPTY_KEYS).length, 'quatorze rôles, « déjà lue », deux raisons : tout cité en littéral');
  Object.keys(i18n.STRINGS).filter((k) => /^advice\.column\./.test(k)).forEach((k) => assert.ok(used.has(k), `clé définie et jamais utilisée : ${k}`));
  console.log(`OK hygiène — ${source.split('\n').length} lignes, pur, sans texte en dur, ${used.size} clés citées en littéral`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. CÂBLAGE
// ---------------------------------------------------------------------------------------------------------------------
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  ['tile-column', 'tile-column-pick', 'tile-column-profile', 'tile-column-used', 'tile-column-empty', 'tile-column-list', 'tile-column-live'].forEach((id) => {
    assert.ok(html.indexOf(`id="${id}"`) !== -1, `index.html : #${id}`);
    assert.ok(harness.indexOf(`id="${id}"`) !== -1, `harness.html : #${id}`);
  });
  assert.ok(/<details id="tile-column"(?![^>]*\bopen\b)/.test(html), 'le bloc est replié au départ');
  assert.ok(/<label for="tile-column-pick"/.test(html), 'le champ a son étiquette');
  assert.ok(/id="tile-column-pick" class="combobox-input"[\s\S]{0,200}<ul class="combobox-list" hidden>/.test(html), 'champ à autocomplétion (combobox) comme tous les sélecteurs de colonne');
  assert.ok(/id="tile-column-live"[^>]*role="status"/.test(html), 'l\'annonce est une zone de statut');
  assert.ok(/id="tile-column-empty"[^>]*\bhidden\b/.test(html), 'la raison est masquée au départ');
  const order = (text, prefix) => ['advice-complete.js', 'advice-column.js', 'welcome.js'].map((n) => text.indexOf(`<script src="${prefix}js/${n}"></script>`));
  [[html, ''], [harness, '../']].forEach(([text, prefix]) => {
    const [c, col, w] = order(text, prefix);
    assert.ok(c > 0 && col > c && w > col, 'advice-complete.js, puis advice-column.js, puis welcome.js');
  });
  const main = readMain();
  assert.ok(/GristBI\.adviceColumn\.describe\(/.test(main), 'le panneau appelle le module');
  assert.ok(/function renderColumnHelper\(/.test(main) && /function hideColumnResults\(/.test(main), 'fonctions du panneau');
  assert.ok(/columnPickEl\.addEventListener\('change', \(\) => \{ if \(!columnResultsAreFresh\(\)\) renderColumnHelper\(\); \}\)/.test(main), 'un événement change sans changement ne refait rien (le clic sur « Ajouter » ne se perd pas)');
  assert.ok(/columnShown = \{ column, rows: state\.rows, lang, tiles \}/.test(main) && /columnShown\.rows === state\.rows/.test(main) && /sameRefs\(columnShown\.tiles/.test(main), 'ce que les résultats ont lu : colonne, lignes, langue, tuiles');
  assert.ok(/token !== columnToken \|\| tilePanel\.hidden/.test(main), 'un calcul périmé ou un panneau refermé n\'écrit rien');
  assert.ok(/function renderColumnHelper\([\s\S]{0,1800}const tiles = tilesOfAllPages\(state\)/.test(main), 'toutes les pages du rapport comptent, pas la page courante');
  assert.ok(/fillCards\(tileCompleteListEl[^)]*\)/.test(main) && /fillCards\(columnListEl[^)]*\)/.test(main), 'les mêmes cartes que « Pour compléter »');
  assert.ok(/data-column-add/.test(main) && /flashTile\(id\)/.test(main), 'ajout, clignotement de la tuile posée');
  assert.ok(/columnPickEl\.value = '';\s*hideColumnResults\(\);/.test(main), 'ouverture du panneau : champ et résultats vidés');
  assert.ok(/hideCompletion\(\);\s*hideColumnResults\(\);\s*columnPickEl\.value = '';/.test(main), 'fermeture : résultats retirés et champ vidé');
  assert.ok(/if \(columnPickEl\.value\) renderColumnHelper\(\);/.test(main), 'changement de langue : phrases refaites');
  assert.ok(/pickableColumns\(cols\)/.test(main) && /columnHelperRows !== rows/.test(main), 'liste des colonnes remplie, choix périmé vidé au changement de table');
  assert.ok(/GristBI\.combobox\.attach/.test(main) && /targetColumnSelect, columnPickEl\]/.test(main), 'le champ est un combobox strict');
  ['tilePanel.column.title', 'tilePanel.column.label', 'tilePanel.column.placeholder', 'tilePanel.column.working', 'tilePanel.column.found'].forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, k));
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ['.tile-column', '.tile-column-profile', '.tile-column-used', '.tile-column-empty'].forEach((sel) => assert.ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  console.log('OK câblage — champ à autocomplétion, résultats, aucun clic perdu, ordre des scripts, ouverture / langue / fermeture / changement de table');
}

console.log('\nOK — « Que faire avec cette colonne ? » : tous les essais passent');
