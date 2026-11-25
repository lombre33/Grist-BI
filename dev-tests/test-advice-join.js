/*
 * « Relier la table d'une colonne Référence » (js/advice-join.js, niveau 3d des suggestions, 25/11/2026), jugé sur la table `commandes` du corpus
 * (dev-tests/lib/advice-corpus.js : une colonne `Client` de type `Ref:Clients`) et sur des tableaux fabriqués pour UN défaut :
 *
 *   node dev-tests/test-advice-join.js
 *
 * Huit sortes d'essais :
 *  1. CANDIDATES : seule une référence SIMPLE du type Grist réel (`Ref:`) est candidate — jamais une liste, la table elle-même, une colonne
 *     constante, ni une colonne numérique qui s'appelle « Client » sans en avoir le type ;
 *  2. PROPOSITION : la jointure rendue (`Client -> id`), la couverture, les axes apportés et leur nombre de valeurs RECALCULÉS par une boucle
 *     indépendante, leur ordre (catégories d'abord, les plus lisibles en tête), la phrase ;
 *  3. PORTES : couverture (0,8 passe, 0,7 non), références renseignées (10 passent, 9 non), une référence vide ne compte pas contre la jointure, aucun
 *     axe apporté, jointure déjà posée, autre table non lue, au plus deux propositions ;
 *  4. LA JOINTURE NE MULTIPLIE RIEN : autant de lignes, mêmes totaux, la bonne ville sur chaque ligne ;
 *  5. CE QUE ÇA CHANGE : avant la jointure aucune suggestion ne lit `Client` ; après, des suggestions « par Ville / par Segment » existent ;
 *  6. ROBUSTESSE : entrées hostiles, entrées intactes, déterminisme, 300 000 lignes ;
 *  7. HYGIÈNE du fichier ;
 *  8. CÂBLAGE : bloc du panneau, ordre des scripts, ouverture / langue / fermeture, jointure posée par `linkTable`.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir la note « mutations » de HYPOTHESES.md, niveau 3d).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const data = require('../js/data.js');
const advice = require('../js/advice.js');
const join = require('../js/advice-join.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');
const { readMain } = require('./lib/helpers.js');

const tables = corpus.build();
const orders = tables.find((t) => t.name === 'commandes');
const INFO = orders.info;
advice.setColumnInfo({});

const VILLES = ['Lyon', 'Nantes', 'Lille', 'Brest', 'Metz', 'Dijon'];
const SEGMENTS = ['Pro', 'Particulier', 'Public'];
const pad = (n) => String(n).padStart(2, '0');
// La table Clients : numéro de ligne (`id`), un nom unique, une ville (6), un segment (3), un courriel unique, un nombre à virgule.
const clientsTable = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, Nom: 'Client ' + pad(i + 1), Ville: VILLES[i % 6], Segment: SEGMENTS[i % 3], Email: `c${i + 1}@exemple.fr`, Remise: (i % 5) * 2.5
}));
const clients = clientsTable(40);
const opts = (extra) => Object.assign({ currentTable: 'Commandes', columnInfo: INFO }, extra || {});
// `n` lignes de commandes dont la colonne `Client` (Ref:Clients) vaut `ref(i)`.
const orderRows = (n, ref) => Array.from({ length: n }, (_, i) => ({ id: i + 1, Client: ref(i), Montant: 10 + (i % 17) * 3.5, Statut: ['Nouvelle', 'Payée', 'Expédiée'][i % 3] }));
const orderInfo = { Client: { type: 'Ref:Clients' } };

// ---------------------------------------------------------------------------------------------------------------------
// 1. CANDIDATES
// ---------------------------------------------------------------------------------------------------------------------
{
  const cands = join.candidates(orders.rows, opts());
  assert.strictEqual(cands.length, 1, 'une seule référence dans les commandes');
  const distinct = new Set(orders.rows.map((r) => String(r.Client))).size;
  assert.deepStrictEqual(cands[0], { column: 'Client', table: 'Clients', filled: orders.rows.length, distinct }, 'colonne, table visée, lignes renseignées, valeurs distinctes (recalculées)');
  // Aucune autre table du corpus n'a de colonne Référence : jamais un candidat.
  tables.filter((t) => t.name !== 'commandes').forEach((t) => assert.deepStrictEqual(join.candidates(t.rows, { columnInfo: t.info || {} }), [], `${t.name} : aucune référence, aucun candidat`));
  // Une liste de références n'a pas de numéro de ligne unique à rejoindre.
  assert.deepStrictEqual(join.candidates(orders.rows, opts({ columnInfo: { Client: { type: 'RefList:Clients' } } })), [], 'RefList : jamais');
  // La table elle-même : une auto-référence ne se « relie » pas à soi.
  assert.deepStrictEqual(join.candidates(orders.rows, opts({ currentTable: 'Clients' })), [], 'la table de travail elle-même : jamais');
  // Une seule valeur : rien à gagner (rôle constant).
  const constant = orderRows(40, () => 7);
  assert.deepStrictEqual(join.candidates(constant, { columnInfo: orderInfo }), [], 'colonne constante : jamais');
  // Sans le type Grist, « Client » n'est qu'une colonne de nombres : jamais devinée sur le nom.
  assert.deepStrictEqual(join.candidates(orders.rows, { currentTable: 'Commandes', columnInfo: {} }), [], 'le type Grist fait foi, pas le nom');
  assert.deepStrictEqual(join.candidates([], opts()), [], 'aucune ligne');
  assert.deepStrictEqual(join.tablesToLoad([{ table: 'A' }, { table: 'B' }, { table: 'A' }]), ['A', 'B'], 'une lecture par table, sans doublon');
  assert.strictEqual(join.tablesToLoad(Array.from({ length: 9 }, (_, i) => ({ table: 'T' + i }))).length, 4, 'au plus quatre tables lues');
  console.log('OK candidates — Ref: seulement (ni liste, ni la table elle-même, ni constante, ni nom sans type), une lecture par table, quatre au plus');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. PROPOSITION
// ---------------------------------------------------------------------------------------------------------------------
{
  const res = join.propose(orders.rows, { Clients: clients }, opts());
  assert.strictEqual(res.reason, '');
  assert.strictEqual(res.proposals.length, 1, 'une proposition');
  const p = res.proposals[0];
  assert.deepStrictEqual(p.join, { secondaryTableId: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' }, 'la jointure est « Référence -> numéro de ligne »');
  assert.strictEqual(p.coverage, 1, 'toutes les références retrouvent une ligne');
  // Les axes, recalculés : valeurs distinctes de chaque colonne de Clients vues à travers les commandes.
  const byId = new Map(clients.map((c) => [String(c.id), c]));
  const seen = (col) => new Set(orders.rows.map((r) => byId.get(String(r.Client))[col])).size;
  const byName = Object.fromEntries(p.axes.map((a) => [a.name, a]));
  assert.strictEqual(byName.Ville.distinct, seen('Ville'), 'Ville : valeurs recalculées');
  assert.strictEqual(byName.Segment.distinct, seen('Segment'), 'Segment : valeurs recalculées');
  assert.strictEqual(byName.Nom.distinct, seen('Nom'), 'Nom : valeurs recalculées');
  assert.strictEqual(byName.Ville.label, false, 'six villes : une catégorie');
  assert.strictEqual(byName.Nom.label, true, 'quarante noms : un libellé (lisible en barres horizontales, pas une catégorie)');
  assert.ok(!byName.Remise, 'un nombre n\'est pas un axe');
  // L'ordre : les catégories d'abord, la plus proche de six barres en tête ; les libellés ensuite.
  const names = p.axes.map((a) => a.name);
  assert.ok(names.indexOf('Ville') < names.indexOf('Segment') && names.indexOf('Segment') < names.indexOf('Nom'), `catégories lisibles d'abord : ${names}`);
  assert.strictEqual(p.axes[0].id, 'Clients.Ville', 'l\'identifiant d\'un axe est celui de la colonne jointe');
  assert.strictEqual(p.reasonVars.axes, names.slice(0, 3).join(', '), 'la phrase nomme trois axes au plus');
  assert.strictEqual(p.reasonVars.n, p.axes.length);
  assert.deepStrictEqual(p.titleVars, { table: 'Clients' });
  assert.strictEqual(p.titleKey, 'advice.join.title');
  assert.strictEqual(p.reasonKey, 'advice.join.reason');
  // Deux références : les deux sont proposées, la plus riche d'abord ; une troisième n'ajoute rien (deux au plus).
  const people = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, Nom: 'P' + pad(i + 1), Equipe: ['A', 'B', 'C', 'D'][i % 4] }));
  const rows2 = orderRows(300, (i) => 1 + (i * 7) % 40).map((r, i) => Object.assign(r, { Livreur: 1 + (i * 5) % 30, Autre: 1 + (i * 3) % 30 }));
  const info2 = { Client: { type: 'Ref:Clients' }, Livreur: { type: 'Ref:Personnel' }, Autre: { type: 'Ref:Equipes' } };
  const equipes = people.map((r) => ({ id: r.id, Nom: r.Nom, Zone: ['N', 'S'][r.id % 2] }));
  const res2 = join.propose(rows2, { Clients: clients, Personnel: people, Equipes: equipes }, { currentTable: 'Commandes', columnInfo: info2 });
  assert.strictEqual(res2.proposals.length, 2, 'au plus deux propositions');
  assert.ok(res2.proposals[0].axes.length >= res2.proposals[1].axes.length, 'la plus riche d\'abord');
  assert.strictEqual(res2.proposals[0].table, 'Clients', 'Clients apporte trois axes, Personnel et Equipes deux et un : Clients passe devant');
  // L'ordre des propositions ne dépend pas de l'ordre des colonnes : la plus riche (Clients, quatre axes) passe devant même quand sa colonne vient après.
  const rows3 = rows2.map((r) => ({ id: r.id, Livreur: r.Livreur, Client: r.Client, Montant: r.Montant }));
  const res3 = join.propose(rows3, { Clients: clients, Personnel: people }, { currentTable: 'Commandes', columnInfo: info2 });
  assert.deepStrictEqual(res3.proposals.map((q) => q.table), ['Clients', 'Personnel'], 'la plus riche d\'abord, quel que soit l\'ordre des colonnes');
  // Une table non lue n'est pas jugée.
  assert.deepStrictEqual(join.propose(orders.rows, { Autre: clients }, opts()).proposals, [], 'une autre table lue n\'est jamais prise pour celle de la référence');
  assert.deepStrictEqual(join.propose(orders.rows, {}, opts()).proposals, [], 'table non lue : rien');
  assert.deepStrictEqual(join.propose(orders.rows, { Clients: null }, opts()).proposals, [], 'table illisible : rien');
  console.log(`OK proposition — jointure Client -> id, couverture 1, axes ${names.join(' / ')} recalculés, deux propositions au plus`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. PORTES
// ---------------------------------------------------------------------------------------------------------------------
{
  const evalOn = (rows, secondary, extra) => join.evaluate(rows, { column: 'Client', table: 'Clients' }, secondary, Object.assign({ columnInfo: orderInfo }, extra || {}));
  const ten = clientsTable(10);
  // Couverture : 8 références sur 10 retrouvent une ligne = 0,8, la limite passe ; 7 sur 10 = 0,7, non.
  const cov = (found) => orderRows(100, (i) => (i % 10 < found ? 1 + (i % 10) : 20 + (i % 10)));
  const ok8 = evalOn(cov(8), ten);
  assert.ok(ok8.ok && Math.abs(ok8.proposal.coverage - 0.8) < 1e-9, 'couverture 0,8 : proposée');
  const no7 = evalOn(cov(7), ten);
  assert.ok(!no7.ok && no7.why === 'coverage', 'couverture 0,7 : refusée, pour la bonne raison');
  assert.ok(!evalOn(cov(0), ten).ok, 'aucune référence retrouvée : refusée');
  // Références renseignées : une référence vide (0, null, chaîne vide) n'est pas contre la jointure, mais 9 renseignées ne suffisent pas.
  const sparse = (filled) => orderRows(100, (i) => (i < filled ? 1 + (i % 10) : (i % 3 === 0 ? 0 : (i % 3 === 1 ? null : ''))));
  assert.ok(evalOn(sparse(10), ten).ok, '10 références renseignées : jugées');
  const few = evalOn(sparse(9), ten);
  assert.ok(!few.ok && few.why === 'sparse', '9 références renseignées : trop peu');
  assert.ok(evalOn(orderRows(100, (i) => (i % 2 ? 0 : 1 + (i % 10))), ten).ok, 'la moitié des références vides ne compte pas contre la jointure');
  // Aucun axe : une table dont chaque colonne est unique par ligne n'apporte rien de lisible.
  const unique = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, Nom: 'N' + i, Email: `e${i}@x.fr`, Code: 'C' + (1000 + i) }));
  const many = orderRows(900, (i) => 1 + (i % 400));
  const noGain = evalOn(many, unique);
  assert.ok(!noGain.ok && noGain.why === 'gain', 'des colonnes quasi uniques : aucun axe apporté');
  // Un nom partagé par très peu de lignes mais en grand nombre (plus de 60 valeurs) n'est pas un axe non plus.
  const sixty = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, Nom: 'N' + i }));
  assert.ok(!evalOn(orderRows(900, (i) => 1 + (i % 80)), sixty).ok, '80 libellés : trop pour un axe');
  assert.ok(evalOn(orderRows(900, (i) => 1 + (i % 60)), sixty.slice(0, 60)).ok, '60 libellés : encore lisibles');
  // Une année saisie comme catégorie n'est pas l'axe qu'on cherche.
  const years = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, Annee: 2015 + (i % 4) }));
  assert.ok(!evalOn(orderRows(100, (i) => 1 + (i % 10)), years).ok, 'une année ne justifie pas une jointure');
  // Table vide ou absente.
  assert.ok(!evalOn(orders.rows, []).ok && !evalOn(orders.rows, null).ok, 'table vide ou absente');
  // Une jointure déjà posée : rien n'est proposé (le store n'en porte qu'une).
  const blocked = join.propose(orders.rows, { Clients: clients }, opts({ blend: { secondaryTableId: 'Autre', primaryColumn: 'Statut', secondaryColumn: 'id' } }));
  assert.deepStrictEqual(blocked, { proposals: [], reason: 'blend' }, 'une jointure existe : aucune proposition, raison dite');
  console.log('OK portes — couverture 0,8 / 0,7, 10 / 9 références, références vides, axes (60 / 80 libellés, quasi uniques, année), jointure déjà posée');
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. LA JOINTURE NE MULTIPLIE RIEN
// ---------------------------------------------------------------------------------------------------------------------
{
  const p = join.propose(orders.rows, { Clients: clients }, opts()).proposals[0];
  const blended = data.blendRows(orders.rows, clients, p.join.primaryColumn, p.join.secondaryColumn, p.join.secondaryTableId);
  assert.strictEqual(blended.length, orders.rows.length, 'autant de lignes que de commandes');
  const total = (rows) => rows.reduce((s, r) => s + r.Montant, 0);
  assert.strictEqual(total(blended), total(orders.rows), 'mêmes totaux : un client = une ligne, jamais deux');
  const byId = new Map(clients.map((c) => [String(c.id), c]));
  assert.ok(blended.every((r) => r['Clients.Ville'] === byId.get(String(r.Client)).Ville), 'la bonne ville sur chaque ligne');
  console.log('OK jointure — autant de lignes, mêmes totaux, la bonne ville sur chaque commande');
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. CE QUE ÇA CHANGE
// ---------------------------------------------------------------------------------------------------------------------
{
  const readsDimension = (s, col) => [s.tileData.dimension, s.tileData.columnDimension, s.tileData.seriesColumn].indexOf(col) !== -1;
  advice.setColumnInfo(INFO);
  const before = advice.suggestTiles(orders.rows, undefined, { limit: 80, lang: 'fr', columnInfo: INFO });
  assert.ok(before.length > 0 && before.every((s) => !readsDimension(s, 'Client') && s.tileData.measure !== 'Client'), 'avant : jamais le numéro de client comme axe ou comme mesure');
  assert.ok(before.every((s) => !readsDimension(s, 'Clients.Ville') && !readsDimension(s, 'Clients.Segment')), 'avant : aucun axe de la table liée');
  const p = join.propose(orders.rows, { Clients: clients }, opts()).proposals[0];
  const blended = data.blendRows(orders.rows, clients, p.join.primaryColumn, p.join.secondaryColumn, p.join.secondaryTableId);
  const after = advice.suggestTiles(blended, undefined, { limit: 80, lang: 'fr', columnInfo: INFO });
  const byVille = after.filter((s) => readsDimension(s, 'Clients.Ville'));
  const bySegment = after.filter((s) => readsDimension(s, 'Clients.Segment'));
  assert.ok(byVille.length > 0 && bySegment.length > 0, `après : des suggestions « par Ville » (${byVille.length}) et « par Segment » (${bySegment.length})`);
  assert.ok(after.every((s) => !readsDimension(s, 'Client') && s.tileData.measure !== 'Client'), 'après : le numéro de client reste exclu');
  advice.setColumnInfo({});
  console.log(`OK effet — avant : aucune suggestion par ville ; après la jointure : ${byVille.length} par Ville, ${bySegment.length} par Segment`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. ROBUSTESSE
// ---------------------------------------------------------------------------------------------------------------------
{
  [null, undefined, 'x', 3, {}, [], [null], [1, 2], [{}], [{ Client: 'a' }]].forEach((bad) => {
    assert.doesNotThrow(() => join.candidates(bad, opts()), 'candidates(' + JSON.stringify(bad) + ')');
    assert.doesNotThrow(() => join.propose(bad, { Clients: bad }, opts()), 'propose(' + JSON.stringify(bad) + ')');
    assert.doesNotThrow(() => join.propose(orders.rows, { Clients: bad }, opts()), 'secondaire hostile ' + JSON.stringify(bad));
  });
  assert.doesNotThrow(() => join.propose(orders.rows, 'x', opts()) && join.propose(orders.rows, null, null) && join.propose(orders.rows, { Clients: clients }, { blend: 3 }), 'options hostiles');
  const hostile = [{ id: 1, Nom: 'a' }, null, 5, { id: NaN, Nom: 'b' }, { Nom: 'c' }];
  assert.doesNotThrow(() => join.propose(orders.rows, { Clients: hostile }, opts()), 'lignes de l\'autre table hostiles');
  // Les entrées ne sont jamais modifiées.
  const rowsCopy = JSON.stringify(orders.rows);
  const clientsCopy = JSON.stringify(clients);
  join.propose(orders.rows, { Clients: clients }, opts());
  assert.strictEqual(JSON.stringify(orders.rows), rowsCopy, 'lignes intactes');
  assert.strictEqual(JSON.stringify(clients), clientsCopy, 'table liée intacte');
  // Déterminisme.
  assert.deepStrictEqual(join.propose(orders.rows, { Clients: clients }, opts()), join.propose(orders.rows, { Clients: clients }, opts()), 'même entrée, même réponse');
  // Phrases : fr et en, sans variable orpheline ni NaN.
  const p = join.propose(orders.rows, { Clients: clients }, opts()).proposals[0];
  ['fr', 'en'].forEach((lang) => {
    i18n.setLang(lang);
    [[p.titleKey, p.titleVars], [p.reasonKey, p.reasonVars]].forEach(([key, vars]) => {
      const s = i18n.t(key, vars);
      assert.ok(s && !/[{}]|NaN|undefined/.test(s), `${lang} ${key} : « ${s} »`);
    });
  });
  assert.ok(/Ville/.test(i18n.t(p.reasonKey, p.reasonVars)) && /Clients/.test(i18n.t(p.titleKey, p.titleVars)), 'la phrase nomme la table et les axes');
  i18n.setLang('fr');
  // 300 000 lignes : un parcours de couverture et un échantillon réparti, jamais une copie de toute la table.
  const big = Array.from({ length: 300000 }, (_, i) => ({ id: i + 1, Client: 1 + (i % 40), Montant: i % 977 }));
  const start = Date.now();
  const res = join.propose(big, { Clients: clients }, { currentTable: 'Commandes', columnInfo: orderInfo });
  const ms = Date.now() - start;
  assert.ok(res.proposals.length === 1 && ms < 1500, `300 000 lignes : ${ms} ms`);
  console.log(`OK robustesse — entrées hostiles, entrées intactes, déterminisme, phrases fr/en, 300 000 lignes en ${ms} ms`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. HYGIÈNE
// ---------------------------------------------------------------------------------------------------------------------
{
  const file = path.join(__dirname, '..', 'js', 'advice-join.js');
  const source = fs.readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  assert.ok(source.split('\n').length <= 600, 'au plus 600 lignes');
  ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch('].forEach((bad) => assert.ok(code.indexOf(bad) === -1, `le fichier est pur : « ${bad} »`));
  assert.ok(!/[àâçéèêëîïôûùü]/i.test(code), 'aucune lettre accentuée hors des commentaires : pas de texte en dur');
  const used = new Set((code.match(/'advice\.join\.[A-Za-z.]+'/g) || []).map((k) => k.slice(1, -1)));
  assert.deepStrictEqual(Array.from(used).sort(), ['advice.join.reason', 'advice.join.title'], 'deux clés citées en littéral');
  used.forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, `clé citée et traduite : ${k}`));
  Object.keys(i18n.STRINGS).filter((k) => /^advice\.join\./.test(k)).forEach((k) => assert.ok(used.has(k), `clé définie et jamais utilisée : ${k}`));
  console.log(`OK hygiène — ${source.split('\n').length} lignes, pur, sans texte en dur, ${used.size} clés citées en littéral`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. CÂBLAGE
// ---------------------------------------------------------------------------------------------------------------------
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  ['tile-join', 'tile-join-title', 'tile-join-lead', 'tile-join-list', 'tile-join-done'].forEach((id) => {
    assert.ok(html.indexOf(`id="${id}"`) !== -1, `index.html : #${id}`);
    assert.ok(harness.indexOf(`id="${id}"`) !== -1, `harness.html : #${id}`);
  });
  assert.ok(/<section id="tile-join"[^>]*aria-labelledby="tile-join-title"[^>]*\bhidden\b/.test(html), 'le bloc est une section nommée, masquée au départ');
  assert.ok(/id="tile-join-done"[^>]*role="status"/.test(html), 'la confirmation est une zone de statut');
  const order = (text, prefix) => ['advice-column.js', 'advice-join.js', 'welcome.js'].map((n) => text.indexOf(`<script src="${prefix}js/${n}"></script>`));
  [[html, ''], [harness, '../']].forEach(([text, prefix]) => {
    const [c, j, w] = order(text, prefix);
    assert.ok(c > 0 && j > c && w > j, 'advice-column.js, puis advice-join.js, puis welcome.js');
  });
  const main = readMain();
  assert.ok(/GristBI\.adviceJoin\.candidates\(/.test(main) && /GristBI\.adviceJoin\.propose\(/.test(main) && /GristBI\.adviceJoin\.tablesToLoad\(/.test(main), 'le panneau appelle le module');
  assert.ok(/function renderJoin\(/.test(main) && /function hideJoin\(/.test(main), 'fonctions du panneau');
  assert.ok(/token !== joinToken \|\| tilePanel\.hidden \|\| store\.getState\(\)\.rows !== state\.rows/.test(main), 'une lecture revenue trop tard (panneau fermé, lignes changées) n\'écrit rien');
  assert.ok(/GristBI\.api\.loadTable\(table\)\.then\(\(res\) => \[table, res && res\.rows\], \(\) => \[table, null\]\)/.test(main), 'une table illisible ne bloque pas les autres');
  assert.ok(/if \(state\.blend\) \{/.test(main), 'une jointure en place : plus rien à proposer');
  assert.ok(/joinShown\.rows === state\.rows && joinShown\.lang === lang/.test(main), 'mêmes lignes et même langue : rien n\'est relu');
  assert.ok(/renderCompletion\(\)[\s\S]{0,60}renderJoin\(\);\s*(?:renderPages\(\);\s*)?columnPickEl\.value = '';/.test(main), 'ouverture du panneau : les propositions se calculent');
  assert.ok(/renderCompletion\(\);\s*renderJoin\(\);\s*(?:renderPages\(\);\s*)?if \(columnPickEl\.value\) renderColumnHelper\(\);/.test(main), 'changement de langue : phrases refaites');
  assert.ok(/hideCompletion\(\);\s*hideJoin\(\);\s*(?:hidePages\(\);\s*)?hideColumnResults\(\);/.test(main), 'fermeture : propositions et confirmation retirées');
  assert.ok(/linkTable\(item\.join\)\.then\(/.test(main) && /joinDone = \{ table: item\.table, axes: item\.reasonVars\.axes \}/.test(main), 'un clic pose la jointure puis dit ce qu\'elle apporte');
  assert.ok(/linkTable\(item\.join\)\.then\([\s\S]{0,900}renderCompletion\(\(\) => \{[^}]*tileCompleteListEl\.querySelector\('button\[data-complete\]'\)/.test(main), 'les suggestions se recalculent sur les lignes jointes, le focus ne se perd pas');
  assert.ok(/async function linkTable\(join\)/.test(main) && /linkTable, refreshTablePicker/.test(main), 'linkTable est déposée pour le panneau');
  const link = main.slice(main.indexOf('async function linkTable(join)'));
  assert.ok(/store\.setBlend\(currentBlend\);\s*refreshBlendPicker\(\);\s*await applyBlend\(currentBlend\);/.test(link), 'même chemin que « Joindre une autre table » : store, champs du menu Données, applyBlend');
  assert.ok(/if \(!joined\) \{\s*currentBlend = null;\s*store\.setBlend\(null\);/.test(link), 'une jointure qui n\'a pas eu lieu est retirée aussitôt');
  assert.ok(/data-join="\$\{i\}"/.test(main) && /tilePanel\.join\.add\b/.test(main), 'bouton « Relier » par carte');
  ['tilePanel.join.title', 'tilePanel.join.lead', 'tilePanel.join.add', 'tilePanel.join.addAria', 'tilePanel.join.done'].forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, k));
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ['.join-card', '.tile-join-done'].forEach((sel) => assert.ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  console.log('OK câblage — bloc du panneau, ordre des scripts, ouverture / langue / fermeture, jointure posée par linkTable puis annulée si elle échoue');
}

console.log('\nOK — « Relier la table d\'une colonne Référence » : tous les essais passent');
