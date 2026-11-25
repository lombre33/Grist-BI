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
const table = byName;
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
    // (Un histogramme ou des boîtes lisent les valeurs brutes : aucun agrégat, donc rien qu'on additionne.)
    assert.ok(s.tileData.aggFn === 'avg' || s.type === 'radar' || s.type === 'histogram' || s.type === 'box', `une note se moyenne (${s.type} ${s.tileData.aggFn})`);
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
    assert.ok(/^(overview|trend|compare|share|relation|cross|profile|concentrate|distribution|change|stages)$/.test(s.intent), `intention : ${s.intent}`);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// 7. Des chiffres tirés des DONNÉES : score, explication, justesse (niveau 2)
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const i18n = require('../js/i18n.js');
  const numberOf = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  // Recalculs INDÉPENDANTS de js/advice-insights.js : une boucle et un Map, rien d'autre.
  const groupTotals = (rows, dimension, measure, aggFn) => {
    const map = new Map();
    rows.forEach((r) => {
      const key = String(r[dimension]);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r[measure]);
    });
    return Array.from(map.entries()).map(([name, values]) => {
      const nums = values.map(numberOf).filter((v) => v !== null);
      const total = nums.reduce((a, b) => a + b, 0);
      return { name, value: aggFn === 'count' ? values.length : (aggFn === 'avg' ? total / nums.length : total) };
    });
  };
  const topShareOf = (groups) => {
    const total = groups.reduce((a, g) => a + g.value, 0);
    const top = groups.slice().sort((a, b) => b.value - a.value)[0];
    return { name: top.name, share: top.value / total };
  };
  const pearson = (xs, ys) => {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  const resolve = (s, lang) => { i18n.setLang(lang); return i18n.t(s.reasonKey, s.reasonVars); };

  // (a) Sur tout le corpus : chaque chiffre annoncé est celui qu'on retrouve en recalculant, chaque phrase se résout dans les deux
  //     langues sans variable orpheline, et aucun nombre n'est NaN ni infini.
  let facts = 0;
  tables.forEach((table) => {
    const rows = table.rows;
    suggest(table, 12).forEach((s) => {
      const label = `${table.name} / ${s.type} ${s.tileData.dimension || ''} ${s.tileData.measure || ''}`;
      ['fr', 'en'].forEach((lang) => {
        const text = resolve(s, lang);
        assert.ok(text && !/[{}]/.test(text) && !/undefined|NaN|null/.test(text), `${label} (${lang}) : phrase mal résolue « ${text} »`);
      });
      if (!s.facts) return;
      facts++;
      Object.keys(s.facts).forEach((k) => { if (typeof s.facts[k] === 'number') assert.ok(Number.isFinite(s.facts[k]), `${label} : ${k} n'est pas un nombre fini`); });
      const t = s.tileData;
      if ((s.type === 'bar' || s.type === 'pie' || s.type === 'treemap') && s.facts.topShare !== undefined) {
        const top = topShareOf(groupTotals(rows, t.dimension, t.measure, t.aggFn));
        assert.strictEqual(s.facts.topName, top.name, `${label} : plus gros groupe`);
        assert.ok(Math.abs(s.facts.topShare - top.share) < 1e-9, `${label} : part ${s.facts.topShare} au lieu de ${top.share}`);
        if (/topShare|pieTopThree/.test(s.reasonKey)) assert.strictEqual(s.reasonVars.pct, Math.round(top.share * 100), `${label} : pourcentage de la phrase`);
      }
      if (s.type === 'kpi' && s.facts.deltaPct !== undefined) {
        const trend = data.computeTrend(rows, t.trendDimension, t.measure, t.aggFn);
        assert.ok(Math.abs(s.facts.deltaPct - trend.deltaPct) < 1e-9, `${label} : tendance`);
        assert.strictEqual(s.reasonVars.pct, Math.round(Math.abs(trend.deltaPct)), `${label} : pourcentage de la phrase`);
      }
      if (s.type === 'scatter' && s.facts.r !== undefined) {
        const xs = groupTotals(rows, t.dimension, t.measure, t.aggFn);
        const ys = new Map(groupTotals(rows, t.dimension, t.measureY, t.aggFn).map((g) => [g.name, g.value]));
        const pairs = xs.filter((g) => ys.has(g.name));
        const r = pearson(pairs.map((g) => g.value), pairs.map((g) => ys.get(g.name)));
        assert.ok(Math.abs(s.facts.r - r) < 1e-9, `${label} : corrélation ${s.facts.r} au lieu de ${r}`);
      }
    });
  });
  assert.ok(facts >= 40, `des chiffres sur la plupart des suggestions du corpus (${facts})`);

  // (b) Un groupe dominant se dit avec SON pourcentage et passe devant des groupes égaux.
  const rowsOf = (spec) => { const out = []; spec.forEach(([region, canal, n, amount]) => { for (let i = 0; i < n; i++) out.push({ Region: region, Canal: canal, Montant: amount + (i % 7) }); }); return out; };
  // Region : 70 % des lignes au Nord ; Canal : parts égales. Même mesure, même volume.
  const unbalanced = rowsOf([['Nord', 'Web', 35, 100], ['Nord', 'Mag', 35, 100], ['Sud', 'Web', 10, 100], ['Est', 'Mag', 10, 100], ['Ouest', 'Web', 5, 100], ['Ouest', 'Mag', 5, 100]]);
  const resultB = advice.suggestTiles(unbalanced, undefined, { limit: 12, lang: 'fr' });
  const regionBar = resultB.find((s) => s.type === 'bar' && s.tileData.dimension === 'Region');
  const canalBar = resultB.find((s) => s.type === 'bar' && s.tileData.dimension === 'Canal');
  assert.ok(regionBar && canalBar, 'barres par Region et par Canal');
  assert.strictEqual(regionBar.insightKey, 'advice.insight.topShare');
  assert.strictEqual(regionBar.reasonVars.top, 'Nord');
  assert.ok(regionBar.reasonVars.pct >= 69 && regionBar.reasonVars.pct <= 71, `70 lignes sur 100 au Nord : ${regionBar.reasonVars.pct} %`);
  assert.strictEqual(regionBar.reasonVars.pct, Math.round(regionBar.facts.topShare * 100));
  assert.ok(regionBar.interest > 0.7, `groupe dominant : intérêt ${regionBar.interest}`);
  assert.ok(canalBar.interest < 0.2, `canaux égaux (50/50) : intérêt ${canalBar.interest}`);
  assert.strictEqual(canalBar.insightKey, 'advice.insight.flat', 'des groupes égaux le disent');
  assert.ok(regionBar.score > canalBar.score + 2, `le groupe dominant passe nettement devant (${regionBar.score} contre ${canalBar.score})`);
  assert.ok(resultB.indexOf(regionBar) < resultB.indexOf(canalBar), 'et se classe avant');

  // (c) Une tendance nette est dite avec son pourcentage ; une série plate est dite stable.
  const byYear = (values) => { const out = []; values.forEach((v, i) => { for (let k = 0; k < 5; k++) out.push({ Annee: 2020 + i, Produit: 'P' + (k % 3), Montant: v / 5 }); }); return out; };
  const growing = advice.suggestTiles(byYear([100, 150, 220, 300]), undefined, { limit: 12 }).find((s) => s.type === 'line');
  assert.ok(growing, 'une courbe par année');
  assert.strictEqual(growing.insightKey, 'advice.insight.lineUp');
  assert.strictEqual(growing.reasonVars.pct, 200, 'de 100 à 300 : +200 %');
  assert.strictEqual(growing.reasonVars.from, '2020');
  assert.strictEqual(growing.reasonVars.to, '2023');
  assert.ok(growing.interest > 0.9, `tendance nette : ${growing.interest}`);
  const steady = advice.suggestTiles(byYear([100, 101, 99, 100]), undefined, { limit: 12 }).find((s) => s.type === 'line');
  assert.strictEqual(steady.insightKey, 'advice.insight.lineFlat');
  assert.ok(steady.interest < 0.1, `série plate : ${steady.interest}`);
  assert.ok(growing.score > steady.score + 2, 'la courbe qui montre quelque chose passe devant la plate');
  const falling = advice.suggestTiles(byYear([300, 200, 120, 100]), undefined, { limit: 12 }).find((s) => s.type === 'line');
  assert.strictEqual(falling.insightKey, 'advice.insight.lineDown');
  assert.strictEqual(falling.reasonVars.pct, 67);

  // (d) Un lien net entre deux mesures est dit et monte ; un nuage sans lien baisse.
  const products = (qtyOf) => Array.from({ length: 14 }, (_, i) => ({ Produit: 'P' + i, Prix: 10 + i * 7, Quantite: qtyOf(i), Famille: 'F' + (i % 2) }));
  const linked = advice.suggestTiles(products((i) => 5 + (10 + i * 7) * 2), undefined, { limit: 12 }).find((s) => s.type === 'scatter');
  assert.ok(linked, 'un nuage de points sur 14 produits');
  assert.strictEqual(linked.insightKey, 'advice.insight.scatterUp');
  assert.ok(linked.facts.r > 0.999 && linked.interest > 0.99, `lien parfait : r = ${linked.facts.r}`);
  const noise = [3, 91, 12, 77, 45, 8, 60, 22, 99, 31, 54, 17, 83, 40];
  const unlinked = advice.suggestTiles(products((i) => noise[i]), undefined, { limit: 12 }).find((s) => s.type === 'scatter');
  assert.ok(unlinked.interest < 0.45, `peu de lien : r = ${unlinked.facts.r}`);
  assert.ok(linked.score > unlinked.score + 1.5, 'le nuage qui montre un lien passe devant');
  const inverse = advice.suggestTiles(products((i) => 500 - (10 + i * 7) * 3), undefined, { limit: 12 }).find((s) => s.type === 'scatter');
  assert.strictEqual(inverse.insightKey, 'advice.insight.scatterDown');

  // (e) Le séparateur décimal suit la langue ; la phrase aussi.
  const ratioRows = [['A', 100], ['B', 230], ['C', 200]].reduce((acc, [region, amount]) => acc.concat(Array.from({ length: 10 }, () => ({ Region: region, Canal: 'x', Montant: amount }))), []);
  const fr = advice.suggestTiles(ratioRows, undefined, { limit: 12, lang: 'fr' }).find((s) => s.insightKey === 'advice.insight.spread');
  const en = advice.suggestTiles(ratioRows, undefined, { limit: 12, lang: 'en' }).find((s) => s.insightKey === 'advice.insight.spread');
  assert.strictEqual(fr.reasonVars.ratio, '2,3');
  assert.strictEqual(en.reasonVars.ratio, '2.3');
  assert.ok(/fois plus élevé/.test(resolve(fr, 'fr')) && /times higher/.test(resolve(en, 'en')));

  // (f) Une table de comptage dit « lignes », jamais le nom d'une colonne qu'on ne somme pas.
  const counts = advice.suggestTiles(table('contacts').rows, undefined, { limit: 12, columnInfo: table('contacts').info });
  const countBar = counts.find((s) => s.type === 'bar' && s.tileData.aggFn === 'count' && s.facts && s.facts.ratio >= 1.25);
  assert.ok(countBar, 'des barres de comptage avec un écart');
  assert.strictEqual(countBar.insightKey, 'advice.insight.spreadCount');
  assert.ok(!/Nom\b/.test(resolve(countBar, 'fr')), 'la phrase ne cite pas la colonne qui sert à compter');

  // (g) Sur 300 000 lignes les parts sont celles de l'échantillon réparti : à moins de 2 points de la vérité, et vite.
  const big = corpus.sortedBigTable();
  const started = Date.now();
  const bigResult = advice.suggestTiles(big, undefined, { limit: 12 });
  const elapsed = Date.now() - started;
  const canal = bigResult.find((s) => (s.type === 'bar' || s.type === 'pie') && s.tileData.dimension === 'Canal' && s.facts && s.facts.topShare !== undefined);
  assert.ok(canal, 'une part par Canal sur 300 000 lignes');
  const exact = topShareOf(groupTotals(big, 'Canal', canal.tileData.measure, canal.tileData.aggFn));
  assert.strictEqual(canal.facts.topName, exact.name);
  assert.ok(Math.abs(canal.facts.topShare - exact.share) < 0.02, `part sur échantillon ${canal.facts.topShare} contre ${exact.share}`);
  assert.ok(elapsed < 2500, `300 000 lignes en ${elapsed} ms (moins de 2,5 s)`);

  // (h) Des cellules vides sont ignorées (jamais comptées pour 0) et un échec de calcul ne retire jamais une suggestion.
  const holes = unbalanced.map((r, i) => (i % 4 === 0 ? Object.assign({}, r, { Montant: null }) : r));
  const holeResult = advice.suggestTiles(holes, undefined, { limit: 12 });
  holeResult.forEach((s) => { if (s.facts) Object.keys(s.facts).forEach((k) => { if (typeof s.facts[k] === 'number') assert.ok(Number.isFinite(s.facts[k])); }); });
  assert.ok(holeResult.length >= 3, 'des cellules vides ne vident pas les suggestions');
  const allNull = unbalanced.map((r) => Object.assign({}, r, { Montant: null }));
  assert.ok(advice.suggestTiles(allNull, undefined, { limit: 12 }).length >= 1, 'une mesure entièrement vide ne fait rien planter');

  i18n.setLang('fr');
  console.log(`OK chiffres — ${facts} suggestions du corpus recalculées à la main (parts, tendances, corrélations), phrases résolues fr/en ; dominant, tendance, lien : dits et classés ; décimale suivant la langue ; 300 000 lignes en ${elapsed} ms`);
}
