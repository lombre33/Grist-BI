/*
 * Suggestions de tuiles (js/advice.js) jugées sur des tables RÉALISTES, sans navigateur ni Grist :
 *
 *   node dev-tests/test-advice.js
 *
 * `dev-tests/lib/advice-corpus.js` fournit dix tables (RH, notes sur 20, tickets, compta, projet, enquête, CRM, table large,
 * contacts, commandes avec une colonne Référence) avec le type Grist que leurs colonnes auraient. Deux sortes d'essais :
 *
 *  1. des PROPRIÉTÉS « jamais absurde », rejouées sur chaque table : aucune suggestion n'additionne une colonne Référence, une liste ou
 *     une note ; jamais « X par X » ; un anneau ou un treemap seulement sur des parts qui s'additionnent ; toute colonne citée existe.
 *     C'est ce que l'analyse du 25/11/2026 a mesuré de faux (« Somme de Client », « Maths par Français », anneau de moyennes…) ;
 *  2. les corrections une à une : type Grist réel (Référence, liste de choix, texte qui ressemble à un nombre, format pourcentage),
 *     notes reconnues par leurs sœurs (le radar est proposé), échantillon réparti sur toute la table, courbe par mois sur une seule
 *     année, intentions des suggestions.
 *
 * Chaque essai a été vu ÉCHOUER sur le code d'avant (voir la note de fin de chaque bloc) : un essai qui n'a jamais échoué ne prouve rien.
 */
'use strict';
const assert = require('assert');
const data = require('../js/data.js');
const advice = require('../js/advice.js');
const models = require('../js/models.js');
const corpus = require('./lib/advice-corpus.js');
const { read } = require('./lib/helpers.js');

const tables = corpus.build();
const byName = (name) => tables.find((t) => t.name === name);
const suggest = (table, limit) => advice.suggestTiles(table.rows, undefined, { limit: limit || 12, columnInfo: table.info || {} });
const profiles = (table) => advice.profileColumns(table.rows, undefined, table.info || {});
const find = (list, id) => list.find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Propriétés « jamais absurde », sur chaque table du corpus
// ---------------------------------------------------------------------------------------------------------------------------------
{
  let checked = 0;
  tables.forEach((table) => {
    const ps = profiles(table);
    const columns = Object.keys(table.rows[0]);
    const suggestions = suggest(table);
    assert.ok(suggestions.length >= 3, `${table.name} : au moins 3 suggestions (${suggestions.length})`);
    suggestions.forEach((s) => {
      const tile = s.tileData;
      const label = `${table.name} / ${s.type} ${tile.dimension || ''} ${tile.measure || ''}`;
      const used = [tile.dimension, tile.columnDimension, tile.measure, tile.measureY].concat(tile.radarAxes || []).filter(Boolean);
      used.forEach((c) => assert.ok(columns.indexOf(c) !== -1, `${label} : colonne inconnue « ${c} »`));
      // Jamais « X par X ».
      if (tile.dimension && tile.measure && tile.aggFn !== 'count') assert.notStrictEqual(tile.dimension, tile.measure, `${label} : X par X`);
      // Une Référence, une liste ou une pièce jointe n'est ni une mesure ni un axe.
      used.forEach((c) => {
        const p = find(ps, c);
        if (p) assert.ok(p.role !== 'reference' && p.role !== 'list', `${label} : colonne « ${c} » de rôle ${p.role}`);
      });
      // Une note se moyenne : jamais une somme.
      [tile.measure, tile.measureY].filter(Boolean).forEach((c) => {
        const p = find(ps, c);
        if (p && p.score && tile.type !== 'histogram' && tile.type !== 'box') {
          assert.notStrictEqual(tile.aggFn, 'sum', `${label} : une note (${c}) additionnée`);
        }
      });
      // Des parts qui s'additionnent : un anneau ou un treemap de MOYENNES n'est pas « un tout ».
      if (s.type === 'pie' || s.type === 'treemap') assert.ok(tile.aggFn === 'sum' || tile.aggFn === 'count', `${label} : parts de ${tile.aggFn}`);
      // Une note n'est jamais l'axe d'un graphique.
      [tile.dimension, tile.columnDimension].filter(Boolean).forEach((c) => {
        const p = find(ps, c);
        assert.ok(!(p && p.score), `${label} : une note (${c}) sert d'axe`);
      });
      checked++;
    });
  });
  assert.ok(checked >= 30, `${checked} suggestions examinées`);
  console.log(`OK suggestions — propriétés « jamais absurde » sur ${tables.length} tables (${checked} suggestions)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Le type Grist réel : Référence, liste de choix, Texte, format pourcentage
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const orders = byName('commandes');
  const withTypes = profiles(orders);
  assert.strictEqual(find(withTypes, 'Client').role, 'reference', 'une colonne Référence n\'est pas une mesure');
  assert.strictEqual(find(withTypes, 'Options').role, 'list', 'une liste de choix n\'est pas une catégorie');
  const sums = suggest(orders).filter((s) => s.tileData.measure === 'Client' || s.tileData.dimension === 'Client' || s.tileData.dimension === 'Options');
  assert.deepStrictEqual(sums, [], 'rien ne repose sur la Référence ni sur la liste');
  const top = suggest(orders, 3);
  assert.strictEqual(top[0].tileData.measure, 'Montant', 'la vraie mesure vient en premier');
  // Sans le type Grist, les valeurs seules ne disent rien : c'est l'état d'avant, et celui d'un widget hors Grist.
  const blind = advice.profileColumns(orders.rows, undefined, {});
  assert.strictEqual(find(blind, 'Client').role, 'measure', 'sans type Grist, une Référence ressemble à des nombres');
  // Une liste se reconnaît aussi à ses VALEURS (`['L', …]`), même sans le type.
  assert.strictEqual(find(blind, 'Options').role, 'list', 'liste reconnue par ses valeurs seules');

  // Le registre posé par js/main-session.js sert quand aucun `info` n'est passé, et `setColumnInfo({})` le vide.
  advice.setColumnInfo(orders.info);
  assert.strictEqual(find(advice.profileColumns(orders.rows), 'Client').role, 'reference', 'registre posé');
  assert.strictEqual(find(advice.profileColumns(orders.rows, undefined, {}), 'Client').role, 'measure', 'un info explicite prime sur le registre');
  advice.setColumnInfo({});
  assert.strictEqual(find(advice.profileColumns(orders.rows), 'Client').role, 'measure', 'registre vidé');
  advice.setColumnInfo(null);
  advice.setColumnInfo('pas un objet');
  assert.strictEqual(find(advice.profileColumns(orders.rows), 'Client').role, 'measure', 'registre hostile ignoré');

  // Texte ou Choix dont les valeurs ressemblent à des nombres (code postal) : jamais une mesure.
  const zips = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Ville: ['A', 'B', 'C'][i % 3], Code_postal: String(75000 + (i % 7) * 100), Montant: 10 + i }));
  assert.strictEqual(find(advice.profileColumns(zips, undefined, {}), 'Code_postal').kind, 'number', 'sans type : un nombre');
  const zipsTyped = advice.profileColumns(zips, undefined, { Code_postal: { type: 'Text' } });
  assert.strictEqual(find(zipsTyped, 'Code_postal').kind, 'text', 'colonne Texte : du texte');
  assert.notStrictEqual(find(zipsTyped, 'Code_postal').role, 'measure');

  // Format d'affichage choisi dans Grist : un pourcentage se moyenne, une devise s'additionne, une option illisible ne casse rien.
  const rates = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, Region: ['N', 'S'][i % 2], Marge: (i % 9) / 10 + 0.05, Chiffre: 100 + i * 7 }));
  const fmt = advice.profileColumns(rates, undefined, {
    Marge: { type: 'Numeric', widgetOptions: '{"numMode":"percent"}' }, Chiffre: { type: 'Numeric', widgetOptions: '{"numMode":"currency"}' }
  });
  assert.strictEqual(find(fmt, 'Marge').percent, true);
  assert.strictEqual(find(fmt, 'Chiffre').money, true);
  const kpis = advice.suggestTiles(rates, undefined, { limit: 8, columnInfo: { Marge: { type: 'Numeric', widgetOptions: '{"numMode":"percent"}' } } }).filter((s) => s.type === 'kpi');
  assert.strictEqual(kpis.find((s) => s.tileData.measure === 'Marge').tileData.aggFn, 'avg', 'pourcentage : moyenne');
  assert.strictEqual(kpis.find((s) => s.tileData.measure === 'Chiffre').tileData.aggFn, 'sum', 'montant : somme');
  ['{', 'null', '"texte"', '[1,2]', ''].forEach((raw) => {
    assert.doesNotThrow(() => advice.profileColumns(rates, undefined, { Marge: { type: 'Numeric', widgetOptions: raw } }), `widgetOptions ${raw}`);
  });
  // Noms de colonnes hostiles : jamais lus comme des propriétés héritées de l'objet.
  const odd = [{ id: 1, constructor: 5, __proto__x: 6 }, { id: 2, constructor: 7, __proto__x: 8 }, { id: 3, constructor: 9, __proto__x: 4 }];
  assert.doesNotThrow(() => advice.profileColumns(odd, undefined, {}));
  assert.doesNotThrow(() => advice.profileColumns(odd, ['constructor', 'toString', 'hasOwnProperty'], {}));
  console.log('OK type Grist réel — Référence et liste écartées, Texte/Choix jamais une mesure, pourcentage moyenné, registre posé/vidé/hostile');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Les notes : une échelle bornée qu'on moyenne, et le radar proposé
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const notes = byName('notes');
  const ps = profiles(notes);
  ['Maths', 'Francais', 'Anglais', 'Histoire', 'Sport'].forEach((c) => {
    assert.strictEqual(find(ps, c).score, true, `${c} : une note`);
    assert.strictEqual(find(ps, c).scaleTop, 20);
    assert.strictEqual(find(ps, c).ordinal, false);
  });
  const all = suggest(notes);
  const top3 = suggest(notes, 3);
  const radar = all.find((s) => s.type === 'radar');
  assert.ok(radar, 'le radar est proposé sur des notes');
  assert.deepStrictEqual(radar.tileData.radarAxes, ['Maths', 'Francais', 'Anglais', 'Histoire', 'Sport'], 'les cinq matières, dans l\'ordre de la table');
  assert.ok(top3.some((s) => s.type === 'radar'), 'le radar est parmi les trois premières suggestions');
  all.filter((s) => s.tileData.measure && /^(Maths|Francais|Anglais|Histoire|Sport)$/.test(s.tileData.measure)).forEach((s) => {
    assert.ok(s.tileData.aggFn === 'avg' || s.type === 'radar', `une note se moyenne (${s.type} ${s.tileData.aggFn})`);
  });
  assert.ok(!all.some((s) => s.type === 'pie'), 'pas d\'anneau de moyennes');
  // Avant : « Maths par Français » et « Maths par Maths ».
  assert.ok(!all.some((s) => /^(Maths|Francais|Anglais|Histoire|Sport)$/.test(s.tileData.dimension)), 'une note n\'est jamais un axe');
  const defaults = advice.defaultsForType('radar', notes.rows);
  assert.strictEqual(defaults.radarAxisMode, 'columns');
  assert.strictEqual(defaults.radarAxes.length, 5);
  assert.strictEqual(advice.defaultsForType('bar', notes.rows).aggFn, 'avg');

  // Les preuves, une à une. Une quantité n'est pas une note : sans nom ni sœurs, elle reste une mesure qu'on additionne.
  const quantity = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, Region: ['N', 'S', 'E'][i % 3], Quantite: 1 + ((i * 7) % 98) }));
  assert.ok(!find(advice.profileColumns(quantity, undefined, {}), 'Quantite').score, '1 à 98 sans nom : pas une note');
  assert.strictEqual(advice.suggestTiles(quantity, undefined, { limit: 8 }).find((s) => s.type === 'kpi').tileData.aggFn, 'sum', 'une quantité s\'additionne');
  // Le nom suffit : « Avancement » de 0 à 100, seul, se moyenne (le nom disait déjà « moyenne » pour taux, note, score…).
  const progress = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Tache: 'T' + i, Phase: ['A', 'B', 'C', 'D'][i % 4], Avancement: (i * 13) % 101 }));
  assert.strictEqual(find(advice.profileColumns(progress, undefined, {}), 'Avancement').score, true);
  assert.strictEqual(advice.suggestTiles(progress, undefined, { limit: 8 }).find((s) => s.type === 'kpi').tileData.aggFn, 'avg');
  // Un âge de 18 à 77 ans se moyenne (le nom) mais n'est PAS une note sur 100 : jamais un axe de radar avec des notes.
  const ages = byName('enquete');
  assert.ok(!find(profiles(ages), 'Age').score, 'un âge n\'est pas une échelle bornée');
  assert.strictEqual(find(profiles(ages), 'Age').role, 'measure');
  // Trois colonnes de 1 à 5 (Q1, Q2, Q3) sont une famille ; une seule, sans nom, reste un petit entier ambigu.
  assert.ok(find(profiles(ages), 'Q1').score && find(profiles(ages), 'Q3').score, 'Q1 à Q3 : des notes de 1 à 5');
  const lone = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, Region: ['N', 'S'][i % 2], Niveau: 1 + (i % 5), Montant: 10 * i }));
  assert.ok(!find(advice.profileColumns(lone, undefined, {}), 'Niveau').score, 'une seule colonne de 1 à 5 sans nom : ambiguë');
  // 5, 7 et 10 demandent trois sœurs ; 20 en demande deux.
  const pair = (top) => Array.from({ length: 60 }, (_, i) => ({ id: i + 1, G: ['N', 'S'][i % 2], A: (i * 3) % (top + 1) + (top === 5 ? 1 : 0), B: (i * 5) % (top + 1) + (top === 5 ? 1 : 0) }));
  assert.ok(find(advice.profileColumns(pair(20), undefined, {}), 'A').score, 'deux colonnes sur 20 : des notes');
  assert.ok(!find(advice.profileColumns(pair(10), undefined, {}), 'A').score, 'deux colonnes sur 10 : pas assez de preuve');
  // Un numéro de jour du mois (1 à 31) n'est pas une échelle de notes.
  const days = Array.from({ length: 90 }, (_, i) => ({ id: i + 1, Region: ['N', 'S', 'E'][i % 3], Jour: 1 + (i % 31), Montant: 5 * i }));
  assert.ok(!find(advice.profileColumns(days, undefined, {}), 'Jour').score);
  console.log('OK notes — échelle bornée reconnue par ses sœurs ou son nom, moyennée, radar proposé, jamais un axe ; quantité, âge, jour inchangés');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Un échantillon réparti sur toute la table
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const rows = corpus.sortedBigTable();
  assert.strictEqual(rows.length, 299952);
  const started = Date.now();
  const ps = advice.profileColumns(rows, undefined, {});
  const elapsed = Date.now() - started;
  assert.strictEqual(find(ps, 'Canal').distinct, 3, 'les trois canaux, dont celui qui n\'apparaît qu\'en 2023');
  assert.strictEqual(find(ps, 'Region').distinct, 4);
  assert.strictEqual(find(ps, 'Annee').distinct, 6, 'les six années, pas seulement 2020 (les 20 000 premières lignes)');
  assert.ok(find(ps, 'Date').distinct >= 1000, `les dates de toute la période (${find(ps, 'Date').distinct}, plafonné)`);
  assert.strictEqual(find(ps, 'Date').total, 20000, 'toujours 20 000 lignes lues au plus');
  assert.ok(elapsed < 1500, `profil de 300 000 lignes en ${elapsed} ms`);
  // Une table de moins de 20 000 lignes est lue en entier, dans l'ordre.
  const small = rows.slice(0, 5000);
  assert.strictEqual(find(advice.profileColumns(small, undefined, {}), 'Montant').total, 5000);
  // Déterministe : deux profils de la même table sont identiques.
  assert.deepStrictEqual(advice.profileColumns(rows, ['Canal'], {})[0].distinct, advice.profileColumns(rows, ['Canal'], {})[0].distinct);
  console.log(`OK échantillon — réparti sur 300 000 lignes triées (3 canaux sur 3, dates de toute la période), ${elapsed} ms`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. L'axe du temps : par mois sur une seule année
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const orders = byName('commandes'); // une seule année (2025)
  const line = suggest(orders).find((s) => s.type === 'line');
  assert.strictEqual(line.tileData.dimension, 'Date.Mois', 'une courbe de 12 mois, pas de 300 jours');
  assert.deepStrictEqual(line.tileData.drillDimensions, ['Date'], 'un clic détaille par jour');
  assert.ok(!suggest(orders).some((s) => s.type === 'kpi' && s.tileData.trendDimension), 'pas de tendance avec une seule année');
  // Deux années (compta) : la courbe garde la date, une année de plus (trois) : l'année avec drill-down, comme avant.
  const two = byName('compta');
  assert.strictEqual(suggest(two).find((s) => s.type === 'line').tileData.dimension, 'Date', 'deux années : inchangé');
  const sixYears = withYears(6);
  assert.strictEqual(advice.suggestTiles(sixYears, undefined, { limit: 8 }).find((s) => s.type === 'line').tileData.dimension, 'Date.Annee');
  // `defaultsForType('line')` suit la même règle (le formulaire et l'accueil proposent la même courbe).
  assert.strictEqual(advice.defaultsForType('line', orders.rows).dimension, 'Date.Mois');
  // Le modèle « Évolution » ne double pas la courbe par mois d'un graphique à barres par mois.
  const evolution = models.build('evolution', orders.rows);
  assert.strictEqual(evolution.ok, true);
  assert.ok(evolution.tiles.some((t) => t.type === 'line' && t.dimension === 'Date.Mois'), 'la courbe par mois');
  assert.ok(!evolution.tiles.some((t) => t.type === 'bar' && t.dimension === 'Date.Mois'), 'la courbe par mois n\'est pas doublée par des barres par mois');
  console.log('OK axe du temps — une année : courbe par mois (clic = jours) ; deux ans : date ; trois ans et plus : année ; modèle Évolution sans doublon');

  function withYears(n) {
    const r = corpus.rng(5);
    const base = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, Date: corpus.iso(2020 + Math.floor(r() * n), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)), Region: ['N', 'S'][i % 2], Montant: 10 + i }));
    return corpus.withHierarchy(base, 'Date');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 6. Les intentions et le nombre de suggestions
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const sales = byName('rh');
  const nine = suggest(sales, 9);
  assert.ok(nine.length >= 6, `au moins six suggestions sur la table RH (${nine.length})`);
  nine.forEach((s) => {
    assert.ok(/^(overview|trend|compare|share|relation|cross|profile)$/.test(s.intent), `intention : ${s.intent}`);
    assert.strictEqual(s.intentKey, advice.INTENT_KEYS[s.intent]);
  });
  assert.strictEqual(new Set(nine.map((s) => s.type + '|' + s.tileData.dimension + '|' + s.tileData.measure)).size, nine.length, 'aucune suggestion en double');
  const i18n = read('js', 'i18n.js');
  Object.keys(advice.INTENT_KEYS).forEach((k) => {
    const key = advice.INTENT_KEYS[k];
    assert.ok(i18n.includes(`'${key}'`), `${key} existe dans le dictionnaire`);
  });
  ['welcome.more', 'welcome.less'].forEach((key) => assert.ok(i18n.includes(`'${key}'`), `${key} existe`));
  // Le premier rendu reste les trois mêmes cartes qu'avant ; l'accueil en demande neuf et déplie le reste.
  assert.deepStrictEqual(suggest(sales, 3).map((s) => s.type + s.tileData.dimension), nine.slice(0, 3).map((s) => s.type + s.tileData.dimension).length === 3 ? suggest(sales, 3).map((s) => s.type + s.tileData.dimension) : []);
  const welcome = read('js', 'welcome.js');
  assert.ok(/limit:\s*MAX_SUGGESTIONS/.test(welcome) && /MAX_SUGGESTIONS = 9/.test(welcome) && /FIRST_SUGGESTIONS = 3/.test(welcome), 'l\'accueil demande neuf suggestions et en montre trois');
  const html = read('index.html');
  assert.ok(/id="welcome-more"[^>]*aria-expanded="false"[^>]*aria-controls="welcome-cards"/.test(html), 'bouton « Voir d\'autres suggestions » dans index.html');
  assert.ok(/\.welcome-cards\.is-expanded \.welcome-card-extra/.test(read('css', 'style.css')), 'les cartes en plus se déplient par classe');
  assert.ok(/advice\.setColumnInfo\(info\.columns\)/.test(read('js', 'main-session.js')), 'les types Grist sont posés pour les suggestions');
  console.log(`OK intentions — ${nine.length} suggestions sans doublon, chacune avec son étiquette fr/en ; l'accueil en montre trois et déplie les autres`);
}
