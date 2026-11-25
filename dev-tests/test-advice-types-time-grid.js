/*
 * Suggestions des types du niveau 2c (js/advice-types-time.js : calendrier, planning ; js/advice-types-grid.js : carte de chaleur, soleil,
 * progression, chiffre clé avec objectif), jugées sur les tables du corpus (dev-tests/lib/advice-corpus.js) et sur des tables fabriquées
 * pour un seul défaut :
 *
 *   node dev-tests/test-advice-types-time-grid.js
 *
 * Six sortes d'essais, comme pour le niveau 2b (dev-tests/test-advice-types.js) :
 *  1. ÉLIGIBILITÉ : chaque type n'est proposé que quand les données ont un fait à dire. Les cas qui doivent passer ET les faux positifs
 *     qu'on a vus ou qu'on peut craindre : un calendrier sur du hasard ou un pic isolé, un planning sur une naissance et une embauche, une
 *     carte de chaleur sur deux colonnes sans lien (ou emboîtées), un soleil sans hiérarchie, une « cible » qui n'en est pas une ;
 *  2. JUSTESSE : chaque chiffre annoncé est recalculé par une boucle INDÉPENDANTE de js/advice-insights.js (Date natif, Map, tris) ;
 *  3. PHRASES : chacune se résout en français et en anglais, sans variable orpheline ni NaN, avec le bon jour et le bon pourcentage ;
 *  4. CLASSEMENT : ce qui montre un fait net passe devant ce qui n'en montre pas ;
 *  5. MINIATURES : chaque forme se dessine, dans [0 ; 1], sans NaN ;
 *  6. ROBUSTESSE : cellules vides, dates illisibles, 300 000 lignes, un générateur qui lève, hygiène des fichiers.
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir la note « mutations » de HYPOTHESES.md, niveau 2c).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const advice = require('../js/advice.js');
const insights = require('../js/advice-insights.js');
const types = require('../js/advice-types.js');
const timeTypes = require('../js/advice-types-time.js');
const gridTypes = require('../js/advice-types-grid.js');
const welcome = require('../js/welcome.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');

const tables = corpus.build();
const table = (name) => tables.find((t) => t.name === name);
const NEW_TYPES = ['calendar', 'gantt', 'heatmap', 'sunburst', 'progress'];
const isNew = (s) => NEW_TYPES.indexOf(s.type) !== -1 || (s.type === 'kpi' && !!s.tileData.targetColumn);
const suggest = (rowsOrTable, opts) => {
  const t = Array.isArray(rowsOrTable) ? { rows: rowsOrTable, info: {} } : rowsOrTable;
  advice.setColumnInfo(t.info || {});
  return advice.suggestTiles(t.rows, undefined, Object.assign({ limit: 40, lang: 'fr', columnInfo: t.info || {} }, opts || {}));
};
const of = (list, type) => list.filter((s) => s.type === type);
const goalKpi = (list) => list.filter((s) => s.type === 'kpi' && s.tileData.targetColumn);
const plainKpi = (list) => list.filter((s) => s.type === 'kpi' && !s.tileData.targetColumn);
const resolve = (s, lang) => { i18n.setLang(lang); const text = i18n.t(s.reasonKey, s.reasonVars); i18n.setLang('fr'); return text; };
const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) <= eps, `${label} : ${a} au lieu de ${b}`);

// Recalculs INDÉPENDANTS : le Date natif, des Map, des tris — rien de js/advice-insights.js.
const utcDay = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const isoOfDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = dimanche
const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); const pos = (s.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
const sumBy = (rows, key, valueOf) => { const m = new Map(); rows.forEach((r) => { const k = String(r[key]); m.set(k, (m.get(k) || 0) + valueOf(r)); }); return m; };
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Tables fabriquées : une activité par jour sur 2025 (le nombre de lignes de chaque jour dépend du jour de la semaine, plus ou moins de bruit).
const dailyRows = (seed, base, noise, options) => {
  const o = options || {};
  const r = corpus.rng(seed);
  const first = Date.UTC(2025, 0, 1) / 86400000;
  const rows = [];
  for (let d = 0; d < 365; d++) {
    const wd = weekdayOf(isoOfDay(first + d));
    const count = o.heavy ? Math.round(base[wd] * (0.1 + 6 * Math.pow(r(), 3))) : base[wd] + Math.floor(r() * (noise + 1));
    for (let k = 0; k < count; k++) rows.push({ id: rows.length + 1, Date: isoOfDay(first + d), Equipe: ['A', 'B', 'C'][Math.floor(r() * 3)], Duree_h: Math.round((1 + r() * 3) * 100) / 100 });
    if (o.spikeDay === d) rows.push({ id: rows.length + 1, Date: isoOfDay(first + d), Equipe: 'A', Duree_h: 5000.5 });
  }
  return rows;
};
// Une table de deux colonnes A et B tirée d'une loi conjointe (poids marginaux pa, pb ; `w(i, j)` multiplie la case i, j) ; les chiffres d'un croisement.
const drawCross = (seed, n, pa, pb, w) => {
  const r = corpus.rng(seed);
  const cells = []; let tot = 0;
  pa.forEach((x, i) => pb.forEach((y, j) => { const v = x * y * w(i, j); cells.push([i, j, v]); tot += v; }));
  const cum = []; let acc = 0;
  cells.forEach((e) => { acc += e[2] / tot; cum.push(acc); });
  return Array.from({ length: n }, (_, k) => { const u = r(); let idx = cum.findIndex((x) => u <= x); if (idx < 0) idx = cells.length - 1; return { id: k + 1, A: 'a' + cells[idx][0], B: 'b' + cells[idx][1], V: 'v' + k }; });
};
const crossStatsOf = (rows) => {
  const m = new Map();
  rows.forEach((x) => { const k = x.A + '\u0001' + x.B; m.set(k, (m.get(k) || 0) + 1); });
  return insights.heatLiftStats(Array.from(m.entries()).map(([k, v]) => ({ row: k.split('\u0001')[0], col: k.split('\u0001')[1], value: v })), rows.length);
};
const DATE_INFO = { Date: { type: 'Date' } };
const withDate = (rows) => ({ rows, info: DATE_INFO });

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Éligibilité : proposé quand les données le justifient, jamais sinon
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Calendrier : l'activité de 2025 (chargée en semaine, le mardi en tête, rien le dimanche).
  const act = suggest(table('activite'));
  const cal = of(act, 'calendar');
  assert.strictEqual(cal.length, 1, 'un calendrier sur l\'activité');
  assert.deepStrictEqual([cal[0].tileData.dimension, cal[0].tileData.measure, cal[0].tileData.aggFn], ['Date', 'Duree_h', 'sum']);
  assert.strictEqual(cal[0].intent, 'rhythm');
  assert.strictEqual(cal[0].titleKey, 'tileTitle.calendar');
  assert.strictEqual(cal[0].insightKey, 'advice.insight.calWeekday');
  // Sans mesure, le calendrier compte les lignes (« Interventions par jour »).
  const noMeasure = table('activite').rows.map((r) => ({ id: r.id, Date: r.Date, Equipe: r.Equipe, Type: r.Type }));
  const calCount = of(suggest(withDate(noMeasure)), 'calendar');
  assert.strictEqual(calCount.length, 1, 'un calendrier de comptage');
  assert.strictEqual(calCount[0].tileData.aggFn, 'count');
  assert.strictEqual(calCount[0].titleKey, 'advice.title.calendarCount');
  // Aucun calendrier ailleurs : des dates, mais aucun rythme (ou trop peu de jours).
  tables.filter((t) => t.name !== 'activite').forEach((t) => assert.strictEqual(of(suggest(t), 'calendar').length, 0, `${t.name} : pas de calendrier`));
  // Le hasard n'est pas un rythme : une valeur par jour, tirée au sort ; tous les jours pareils ; un pic isolé.
  const r0 = corpus.rng(11);
  const noise = Array.from({ length: 365 }, (_, d) => ({ id: d + 1, Date: isoOfDay(Date.UTC(2025, 0, 1) / 86400000 + d), Equipe: 'A', Duree_h: Math.round((50 + r0() * 100) * 100) / 100 }));
  assert.strictEqual(of(suggest(withDate(noise)), 'calendar').length, 0, 'une valeur au hasard chaque jour : aucun rythme');
  assert.strictEqual(of(suggest(withDate(dailyRows(3, [5, 5, 5, 5, 5, 5, 5], 3))), 'calendar').length, 0, 'autant chaque jour de la semaine : aucun rythme');
  assert.strictEqual(of(suggest(withDate(dailyRows(4, [5, 5, 5, 5, 5, 5, 5], 0, { spikeDay: 100 }))), 'calendar').length, 0, 'un seul pic énorme : ce n\'est pas un rythme');
  // Le tirage de 20 000 lignes ne doit jamais décider : 28 000 jours d'une ligne chacun, tous pareils ; un pas de 1,4 retirerait toujours les mêmes
  // jours de la semaine et ferait paraître un rythme (une semaine à jours vides) qui n'existe pas. Le calendrier se calcule sur TOUTES les lignes.
  const day0 = Date.UTC(1950, 0, 1) / 86400000;
  const flatLong = Array.from({ length: 28000 }, (_, i) => ({ id: i + 1, Date: isoOfDay(day0 + i), Equipe: ['A', 'B', 'C'][i % 3], Duree_h: 10.5 }));
  assert.strictEqual(of(suggest(withDate(flatLong)), 'calendar').length, 0, 'un jour = une ligne, tous pareils : aucun rythme, même si le tirage retire des jours');
  // Moins de 60 jours : une courbe suffit.
  assert.strictEqual(of(suggest(withDate(dailyRows(1, [0, 10, 3, 3, 3, 3, 3], 3).filter((r) => r.Date < '2025-02-15'))), 'calendar').length, 0, 'moins de 60 jours');
  // Un rythme faible mais réel passe (et se classe moins haut : voir le bloc 4).
  assert.strictEqual(of(suggest(withDate(dailyRows(1, [6, 6, 12, 6, 6, 6, 6], 0, { heavy: true }))), 'calendar').length, 1, 'un rythme faible mais net du mardi');

  // Planning : le projet (40 tâches, Debut et Fin, un responsable pour la couleur).
  const gantt = of(suggest(table('projet')), 'gantt');
  assert.strictEqual(gantt.length, 1, 'un planning sur le projet');
  // La couleur d'un planning : le STATUT (le nom « Statut » passe devant « Responsable », js/advice-names.js), ce qu'on lit d'abord sur un planning.
  assert.deepStrictEqual([gantt[0].tileData.dimension, gantt[0].tileData.startColumn, gantt[0].tileData.endColumn, gantt[0].tileData.seriesColumn], ['Tache', 'Debut', 'Fin', 'Statut']);
  assert.strictEqual(gantt[0].intent, 'schedule');
  assert.strictEqual(gantt[0].titleKey, 'tileTitle.gantt');
  // Jamais : 800 tickets (trop de tâches), des dates de naissance et d'embauche, une table sans deux dates.
  tables.filter((t) => t.name !== 'projet').forEach((t) => assert.strictEqual(of(suggest(t), 'gantt').length, 0, `${t.name} : pas de planning`));
  const isoPlus = (base, n) => isoOfDay(utcDay(base) + n);
  const people = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Nom: 'P' + i, Naissance: isoPlus('1970-01-05', i * 97), Embauche: isoPlus('2005-02-10', i * 61) }));
  assert.strictEqual(of(suggest(people), 'gantt').length, 0, 'naissance et embauche ne sont pas un début et une fin');
  const tasks = (n, build) => Array.from({ length: n }, (_, i) => build(i));
  const englishTasks = tasks(20, (i) => ({ id: i + 1, Task: 'Task ' + i, Owner: ['Ann', 'Bob', 'Cy'][i % 3], Start: isoPlus('2025-03-01', i * 3), End: isoPlus('2025-03-01', i * 3 + 10 + (i % 5) * 4) }));
  const en = of(suggest(englishTasks), 'gantt');
  assert.strictEqual(en.length, 1, 'des colonnes Start / End en anglais');
  assert.deepStrictEqual([en[0].tileData.startColumn, en[0].tileData.endColumn], ['Start', 'End']);
  assert.strictEqual(of(suggest(tasks(80, (i) => ({ id: i + 1, Task: 'Task ' + i, Start: isoPlus('2025-03-01', i), End: isoPlus('2025-03-01', i + 9) }))), 'gantt').length, 0, 'plus de 60 tâches : trop pour un planning');
  assert.strictEqual(of(suggest(tasks(2, (i) => ({ id: i + 1, Task: 'Task ' + i, Start: isoPlus('2025-03-01', i), End: isoPlus('2025-03-01', i + 30) }))), 'gantt').length, 0, 'moins de 3 tâches');
  assert.strictEqual(of(suggest(tasks(20, (i) => ({ id: i + 1, Task: 'Task ' + i, Start: isoPlus('2025-03-01', i % 3), End: isoPlus('2025-03-01', (i % 3) + 1) }))), 'gantt').length, 0, 'étendue de moins d\'une semaine');
  const inverted = tasks(20, (i) => ({ id: i + 1, Task: 'Task ' + i, Start: isoPlus('2025-03-01', i * 3), End: i % 3 === 0 ? isoPlus('2025-03-01', i * 3 - 5) : isoPlus('2025-03-01', i * 3 + 10) }));
  assert.strictEqual(of(suggest(inverted), 'gantt').length, 0, 'plus d\'un cinquième de lignes à fin avant le début : les dates ne sont pas un planning');

  // Objectif : les commerciaux (Realise et Objectif), un chiffre clé AVEC sa cible plutôt que le chiffre nu.
  const obj = suggest(table('objectifs'));
  assert.strictEqual(of(obj, 'progress').length, 1, 'une progression par commercial');
  const prog = of(obj, 'progress')[0];
  assert.deepStrictEqual([prog.tileData.dimension, prog.tileData.measure, prog.tileData.targetColumn, prog.tileData.aggFn], ['Commercial', 'Realise', 'Objectif', 'sum']);
  assert.strictEqual(prog.intent, 'goal');
  assert.strictEqual(goalKpi(obj).length, 1, 'un chiffre clé avec son objectif');
  assert.deepStrictEqual([goalKpi(obj)[0].tileData.measure, goalKpi(obj)[0].tileData.targetColumn, goalKpi(obj)[0].intent], ['Realise', 'Objectif', 'goal']);
  assert.ok(!plainKpi(obj).some((s) => s.tileData.measure === 'Realise' || s.tileData.measure === 'Objectif'), 'le chiffre nu du réalisé et celui de l\'objectif sont remplacés par le chiffre avec sa cible');
  assert.ok(!obj.some((s) => (s.type === 'scatter' || s.type === 'combo') && s.tileData.measure && s.tileData.measureY && [s.tileData.measure, s.tileData.measureY].sort().join() === 'Objectif,Realise'), 'pas de nuage ou de double axe réalisé contre objectif : la progression le dit mieux');
  tables.filter((t) => t.name !== 'objectifs').forEach((t) => { const s = suggest(t); assert.strictEqual(of(s, 'progress').length + goalKpi(s).length, 0, `${t.name} : aucun objectif`); });
  // Le NOM décide : un budget, un prévu ou un plan n'est pas une cible (un coût plus haut que son budget n'est pas « atteint »).
  const named = (target) => Array.from({ length: 96 }, (_, i) => ({ id: i + 1, Equipe: ['A', 'B', 'C', 'D'][i % 4], Mois: 1 + (i % 12) + 0.25, Depense: 1000.5 + (i % 7) * 31.5, [target]: 1100.5 + (i % 5) * 29.5 }));
  ['Budget', 'Prevu', 'Plan', 'Previsionnel'].forEach((name) => { const s = suggest(named(name)); assert.strictEqual(of(s, 'progress').length + goalKpi(s).length, 0, `« ${name} » n'est pas une cible`); });
  ['Objectif', 'Cible', 'Target', 'Quota', 'Goal'].forEach((name) => { const s = suggest(named(name)); assert.strictEqual(of(s, 'progress').length, 1, `« ${name} » est une cible`); assert.strictEqual(of(s, 'progress')[0].tileData.targetColumn, name); });
  // Une atteinte absurde (une cible cent fois plus grande) n'est pas la cible de cette mesure.
  const absurd = named('Objectif').map((r) => Object.assign({}, r, { Objectif: r.Objectif * 100 }));
  assert.strictEqual(of(suggest(absurd), 'progress').length + goalKpi(suggest(absurd)).length, 0, 'atteinte de 1 % : pas la cible de cette mesure');
  // Deux mesures plausibles : la cible est celle de la plus proche (le réalisé à 97 %), pas de la première colonne venue (un coût à 45 %).
  const twoMeasures = named('Objectif').map((r, i) => ({ id: r.id, Equipe: r.Equipe, Cout: Math.round(r.Objectif * 0.45 * 100) / 100 + i * 0.01, Realise: Math.round(r.Objectif * 0.97 * 100) / 100 + i * 0.013, Objectif: r.Objectif }));
  assert.strictEqual(of(suggest(twoMeasures), 'progress')[0].tileData.measure, 'Realise', 'la mesure de la cible est celle dont l\'atteinte est la plus proche de 100 %');
  assert.strictEqual(goalKpi(suggest(twoMeasures))[0].tileData.measure, 'Realise');
  // Un numéro de mois qui précède le vrai réalisé dans la table n'est jamais la mesure de la cible (atteinte de 0,6 %).
  const monthFirst = of(suggest(named('Objectif')), 'progress')[0];
  assert.strictEqual(monthFirst.tileData.measure, 'Depense', 'la colonne Mois (atteinte absurde) est écartée au profit de la dépense');
  // Un objectif à moins de 30 lignes renseignées est trop mince.
  const thin = named('Objectif').map((r, i) => (i < 20 ? r : Object.assign({}, r, { Objectif: null })));
  assert.strictEqual(of(suggest(thin), 'progress').length, 0, 'moins de 30 objectifs renseignés');

  // Soleil : l'organisation (départements dans régions), jamais sur des colonnes qui ne s'emboîtent pas.
  const org = suggest(table('organisation'));
  const sun = of(org, 'sunburst');
  assert.strictEqual(sun.length, 1, 'un soleil région > département');
  assert.deepStrictEqual([sun[0].tileData.dimension, sun[0].tileData.drillDimensions, sun[0].tileData.measure, sun[0].tileData.aggFn], ['Region', ['Departement'], 'Budget', 'sum']);
  assert.strictEqual(sun[0].intent, 'structure');
  assert.strictEqual(sun[0].titleKey, 'tileTitle.sunburst');
  assert.ok(!org.some((s) => s.type === 'pivot' && [s.tileData.dimension, s.tileData.columnDimension].sort().join() === 'Departement,Region'), 'le tableau croisé de deux colonnes emboîtées est remplacé par le soleil');
  assert.strictEqual(of(org, 'heatmap').length, 0, 'jamais une carte de chaleur de deux colonnes emboîtées (une seule case par ligne)');
  tables.filter((t) => t.name !== 'organisation').forEach((t) => assert.strictEqual(of(suggest(t), 'sunburst').length, 0, `${t.name} : pas de soleil (aucune hiérarchie)`));
  // Un département par région n'est pas une hiérarchie : autant de valeurs des deux côtés.
  const oneToOne = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, Region: 'R' + (i % 4), Departement: 'D' + (i % 4), Budget: 100.5 + (i % 9) * 7.5 }));
  assert.strictEqual(of(suggest(oneToOne), 'sunburst').length, 0, 'un enfant par parent : pas de hiérarchie');
  // Trop peu de lignes par sous-valeur : l'emboîtement serait un hasard.
  const sparse = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, Region: 'R' + (i % 3), Departement: 'D' + i, Budget: 100.5 + i * 7.5 }));
  assert.strictEqual(of(suggest(sparse), 'sunburst').length, 0, 'une ligne par sous-valeur : trop mince');

  // Carte de chaleur : le support (Delta traite deux fois plus d'incidents), jamais sur des colonnes sans lien.
  const sup = suggest(table('support'));
  const heat = of(sup, 'heatmap');
  assert.strictEqual(heat.length, 1, 'une carte de chaleur type × équipe');
  assert.deepStrictEqual([heat[0].tileData.dimension, heat[0].tileData.columnDimension, heat[0].tileData.aggFn], ['Type', 'Equipe', 'count']);
  assert.strictEqual(heat[0].intent, 'cross');
  assert.strictEqual(heat[0].titleKey, 'advice.title.countByTwo');
  assert.ok(!sup.some((s) => s.type === 'pivot' && [s.tileData.dimension, s.tileData.columnDimension].sort().join() === 'Equipe,Type'), 'la carte de chaleur remplace le tableau croisé des mêmes colonnes');
  tables.filter((t) => t.name !== 'support').forEach((t) => assert.strictEqual(of(suggest(t), 'heatmap').length, 0, `${t.name} : pas de carte de chaleur (aucune case ne ressort)`));
  const r1 = corpus.rng(31);
  const independent = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, A: 'a' + Math.floor(r1() * 4), B: 'b' + Math.floor(r1() * 5), V: 'v' + i }));
  assert.strictEqual(of(suggest(independent), 'heatmap').length, 0, 'deux colonnes sans lien : le hasard ne fait pas une case chaude');
  // Quelques dizaines de lignes tirées au sort montrent toujours une case « chaude » (2 lignes au lieu de 1 attendue) : seul le khi-deux la refuse.
  const r3 = corpus.rng(33);
  const small = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, A: 'a' + Math.floor(r3() * 4), B: 'b' + Math.floor(r3() * 5), V: 'v' + i }));
  const smallCells = new Map();
  small.forEach((r) => { const k = r.A + '\u0001' + r.B; smallCells.set(k, (smallCells.get(k) || 0) + 1); });
  const smallStats = insights.heatLiftStats(Array.from(smallCells.entries()).map(([k, v]) => ({ row: k.split('\u0001')[0], col: k.split('\u0001')[1], value: v })), small.length);
  assert.ok(smallStats.maxLift >= gridTypes.HEAT_MIN_LIFT && smallStats.cellShare >= gridTypes.HEAT_MIN_CELL_SHARE && smallStats.v >= gridTypes.HEAT_MIN_V, `une case « chaude » par hasard : lift ${smallStats.maxLift.toFixed(2)}, part ${smallStats.cellShare.toFixed(3)}, V ${smallStats.v.toFixed(2)}`);
  assert.strictEqual(smallStats.significant, false, 'mais ce n\'est pas significatif');
  assert.strictEqual(of(suggest(small), 'heatmap').length, 0, '60 lignes au hasard : aucune carte de chaleur');
  // Chaque porte isolée : un lien significatif et ample dont la case reste sous 1,5 fois l'attendu (une diagonale un peu plus haute) ; une case à
  // 1,7 fois l'attendu dont le lien d'ensemble est infime (V sous 0,1 sur dix valeurs de chaque côté).
  const diag = drawCross(62, 3000, [1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3], (i, j) => (i === j ? 1.5 : 1));
  const diagStats = crossStatsOf(diag);
  assert.ok(diagStats.significant && diagStats.v >= gridTypes.HEAT_MIN_V && diagStats.cellShare >= gridTypes.HEAT_MIN_CELL_SHARE && diagStats.maxLift < gridTypes.HEAT_MIN_LIFT,
    `seule la case trop tiède l'écarte : lift ${diagStats.maxLift.toFixed(2)}, V ${diagStats.v.toFixed(3)}`);
  assert.strictEqual(of(suggest(diag), 'heatmap').length, 0, 'aucune case à 1,5 fois l\'attendu : rien à montrer');
  const wide = [0.2].concat(Array(9).fill(0.8 / 9));
  const lone = drawCross(61, 20000, wide, wide, (i, j) => (i === 0 && j === 0 ? 3 : 1));
  const loneStats = crossStatsOf(lone);
  assert.ok(loneStats.significant && loneStats.maxLift >= gridTypes.HEAT_MIN_LIFT && loneStats.cellShare >= gridTypes.HEAT_MIN_CELL_SHARE && loneStats.v < gridTypes.HEAT_MIN_V,
    `seul le lien d'ensemble infime l'écarte : lift ${loneStats.maxLift.toFixed(2)}, V ${loneStats.v.toFixed(3)}`);
  assert.strictEqual(of(suggest(lone), 'heatmap').length, 0, 'un lien d\'ensemble infime : pas de carte de chaleur');
  // Un lien faible mais « significatif » sur beaucoup de lignes ne se voit pas : la case ne dépasse pas l'attendu de moitié.
  const r2 = corpus.rng(32);
  const weak = Array.from({ length: 6000 }, (_, i) => {
    const a = Math.floor(r2() * 3); let b = Math.floor(r2() * 3);
    if (a === 0 && r2() < 0.18) b = 0;
    return { id: i + 1, A: 'a' + a, B: 'b' + b, V: 'v' + i };
  });
  const weakCells = new Map();
  weak.forEach((r) => { const k = r.A + '\u0001' + r.B; weakCells.set(k, (weakCells.get(k) || 0) + 1); });
  const weakStats = insights.heatLiftStats(Array.from(weakCells.entries()).map(([k, v]) => ({ row: k.split('\u0001')[0], col: k.split('\u0001')[1], value: v })), weak.length);
  assert.ok(weakStats.significant, `ce lien-ci est « significatif » (khi-deux ${weakStats.chi2.toFixed(1)}) : c'est l'ampleur qui l'écarte`);
  assert.ok(weakStats.maxLift < 1.5 || weakStats.v < 0.1, `lift ${weakStats.maxLift.toFixed(2)}, V ${weakStats.v.toFixed(3)}`);
  assert.strictEqual(of(suggest(weak), 'heatmap').length, 0, 'un lien faible, même significatif, n\'est pas proposé');
  console.log('OK éligibilité — calendrier, planning, objectif, soleil et carte de chaleur : proposés sur les tables qui les justifient, jamais sur les autres (hasard, pic isolé, naissance/embauche, budget, emboîtement)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Justesse : les chiffres annoncés sont ceux qu'on retrouve en recalculant
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Calendrier (activité) : somme par jour, puis moyenne par jour de la semaine sur la période, rapport de corrélation.
  const act = table('activite');
  const c = of(suggest(act), 'calendar')[0];
  const perDay = new Map();
  act.rows.forEach((r) => perDay.set(r.Date, (perDay.get(r.Date) || 0) + r.Duree_h));
  const dates = Array.from(perDay.keys()).sort();
  const first = utcDay(dates[0]); const last = utcDay(dates[dates.length - 1]);
  const sums = [0, 0, 0, 0, 0, 0, 0]; const occurrences = [0, 0, 0, 0, 0, 0, 0];
  perDay.forEach((v, date) => { sums[weekdayOf(date)] += v; });
  for (let n = first; n <= last; n++) occurrences[weekdayOf(isoOfDay(n))]++;
  const means = sums.map((v, i) => v / occurrences[i]);
  const total = means.reduce((a, b) => a + b, 0);
  let best = 0; let worst = 0;
  means.forEach((m, i) => { if (m > means[best]) best = i; if (m < means[worst]) worst = i; });
  assert.strictEqual(c.facts.days, perDay.size);
  assert.strictEqual(c.facts.bestDay, best); assert.strictEqual(c.facts.worstDay, worst);
  assert.strictEqual(best, 2, 'le mardi est le jour le plus chargé'); assert.strictEqual(worst, 0, 'et le dimanche, vide');
  near(c.facts.bestShare, means[best] / total, 1e-9, 'part du jour le plus chargé');
  assert.strictEqual(c.facts.worstShare, 0); assert.strictEqual(c.facts.emptyWorst, true);
  // eta2 : variation entre jours de la semaine / variation totale, sur tous les jours de la période (un jour sans ligne vaut 0).
  const series = []; for (let n = first; n <= last; n++) series.push([weekdayOf(isoOfDay(n)), perDay.get(isoOfDay(n)) || 0]);
  const grand = series.reduce((a, e) => a + e[1], 0) / series.length;
  const ssTotal = series.reduce((a, e) => a + (e[1] - grand) ** 2, 0);
  const byWd = [0, 1, 2, 3, 4, 5, 6].map((w) => series.filter((e) => e[0] === w).map((e) => e[1]));
  const ssBetween = byWd.reduce((a, xs) => a + (xs.length ? xs.length * (xs.reduce((p, q) => p + q, 0) / xs.length - grand) ** 2 : 0), 0);
  near(c.facts.eta2, ssBetween / ssTotal, 1e-9, 'rapport de corrélation');
  const peak = dates.reduce((a, d) => (perDay.get(d) > perDay.get(a) ? d : a), dates[0]);
  assert.strictEqual(c.facts.peakDate, peak);
  assert.strictEqual(c.reasonVars.best, 'mardi'); assert.strictEqual(c.reasonVars.worst, 'dimanche');
  assert.strictEqual(c.reasonVars.pct, Math.round(means[best] / total * 100)); assert.strictEqual(c.reasonVars.pct2, 0);
  assert.ok(/mardi/.test(resolve(c, 'fr')) && /Tuesday/.test(resolve(suggest(act, { lang: 'en' }).find((s) => s.type === 'calendar'), 'en')), 'le jour s\'écrit dans la langue');

  // Planning (projet) : étendue, tâche la plus longue, médiane et nombre de tâches en même temps, par balayage jour par jour.
  const projet = table('projet');
  const g = of(suggest(projet), 'gantt')[0];
  const valid = projet.rows.filter((r) => utcDay(r.Fin) >= utcDay(r.Debut)).map((r) => ({ name: r.Tache, s: utcDay(r.Debut), e: utcDay(r.Fin) }));
  const minS = Math.min.apply(null, valid.map((t) => t.s)); const maxE = Math.max.apply(null, valid.map((t) => t.e));
  const durations = valid.map((t) => t.e - t.s + 1);
  let overlap = 0; for (let day = minS; day <= maxE; day++) overlap = Math.max(overlap, valid.filter((t) => t.s <= day && day <= t.e).length);
  assert.strictEqual(g.facts.tasks, valid.length);
  assert.strictEqual(g.facts.spanDays, maxE - minS + 1);
  assert.strictEqual(g.facts.longestDays, Math.max.apply(null, durations));
  assert.ok(valid.filter((t) => t.e - t.s + 1 === g.facts.longestDays).map((t) => t.name).includes(g.facts.longest), 'la plus longue tâche est nommée');
  assert.strictEqual(g.facts.medianDays, quantile(durations, 0.5));
  assert.strictEqual(g.facts.overlap, overlap, 'tâches en même temps au plus');
  assert.strictEqual(g.insightKey, overlap >= 3 && overlap / valid.length >= 0.3 ? 'advice.insight.ganttOverlap' : 'advice.insight.ganttSpan');
  assert.strictEqual(g.reasonVars.n, valid.length); assert.strictEqual(g.reasonVars.days, maxE - minS + 1); assert.strictEqual(g.reasonVars.k, overlap);

  // Carte de chaleur (support) : attendu, lift, part de la case, V de Cramér sur la table complète (600 lignes, tout est dans l'échantillon).
  const sup = table('support');
  const h = of(suggest(sup), 'heatmap')[0];
  const cell = new Map(); const rowTotal = new Map(); const colTotal = new Map();
  sup.rows.forEach((r) => { const k = r.Type + '\u0001' + r.Equipe; cell.set(k, (cell.get(k) || 0) + 1); rowTotal.set(r.Type, (rowTotal.get(r.Type) || 0) + 1); colTotal.set(r.Equipe, (colTotal.get(r.Equipe) || 0) + 1); });
  const N = sup.rows.length;
  let top = null; let chi2 = 0;
  rowTotal.forEach((rt, row) => colTotal.forEach((ct, col) => {
    const expected = rt * ct / N; const observed = cell.get(row + '\u0001' + col) || 0;
    chi2 += (observed - expected) ** 2 / expected;
    if (observed > 0 && expected / N >= 0.02 && (!top || observed / expected > top.lift)) top = { row, col, lift: observed / expected, share: observed / N };
  }));
  const cramer = Math.sqrt(chi2 / N / (Math.min(rowTotal.size, colTotal.size) - 1));
  assert.deepStrictEqual([h.facts.row, h.facts.col], [top.row, top.col]);
  assert.strictEqual(top.row, 'Incident'); assert.strictEqual(top.col, 'Delta');
  near(h.facts.lift, top.lift, 1e-9, 'lift'); near(h.facts.cellShare, top.share, 1e-9, 'part de la case'); near(h.facts.v, cramer, 1e-9, 'V de Cramér');
  assert.deepStrictEqual([h.facts.rows, h.facts.cols], [rowTotal.size, colTotal.size]);
  assert.strictEqual(h.reasonVars.pct, Math.round(top.share * 100));
  assert.strictEqual(h.reasonVars.lift, insights.formatNumber(top.lift, 'fr', 1), 'un lift à la virgule française');
  assert.strictEqual(suggest(sup, { lang: 'en' }).find((s) => s.type === 'heatmap').reasonVars.lift, insights.formatNumber(top.lift, 'en', 1), 'et au point anglais');

  // Soleil (organisation) : plus grosse région, plus gros département dans elle.
  const org = table('organisation');
  const s = of(suggest(org), 'sunburst')[0];
  const byRegion = sumBy(org.rows, 'Region', (r) => r.Budget);
  const totalBudget = Array.from(byRegion.values()).reduce((a, b) => a + b, 0);
  const topRegion = Array.from(byRegion.entries()).sort((a, b) => b[1] - a[1])[0];
  const inTop = sumBy(org.rows.filter((r) => r.Region === topRegion[0]), 'Departement', (r) => r.Budget);
  const topDep = Array.from(inTop.entries()).sort((a, b) => b[1] - a[1])[0];
  assert.strictEqual(s.facts.top, topRegion[0]); assert.strictEqual(topRegion[0], 'Nord');
  near(s.facts.topShare, topRegion[1] / totalBudget, 1e-9, 'part de la région');
  assert.strictEqual(s.facts.topChild, topDep[0]); assert.strictEqual(topDep[0], 'Lille');
  near(s.facts.topChildShare, topDep[1] / topRegion[1], 1e-9, 'part du département dans sa région');
  assert.deepStrictEqual([s.facts.parents, s.facts.parts], [byRegion.size, new Set(org.rows.map((r) => r.Departement)).size]);
  assert.strictEqual(s.insightKey, 'advice.insight.hierTop');
  assert.strictEqual(s.reasonVars.pct, Math.round(topRegion[1] / totalBudget * 100)); assert.strictEqual(s.reasonVars.pct2, Math.round(topDep[1] / topRegion[1] * 100));

  // Objectif (objectifs) : réalisé et cible par commercial, atteinte globale, en retard et en avance.
  const objs = table('objectifs');
  const real = sumBy(objs.rows, 'Commercial', (r) => r.Realise); const goal = sumBy(objs.rows, 'Commercial', (r) => r.Objectif);
  const pcts = Array.from(real.keys()).map((k) => ({ name: k, pct: real.get(k) / goal.get(k) * 100 }));
  const low = pcts.reduce((a, b) => (b.pct < a.pct ? b : a)); const high = pcts.reduce((a, b) => (b.pct > a.pct ? b : a));
  const p = of(suggest(objs), 'progress')[0];
  near(p.facts.overall, Array.from(real.values()).reduce((a, b) => a + b, 0) / Array.from(goal.values()).reduce((a, b) => a + b, 0), 1e-9, 'atteinte globale');
  assert.deepStrictEqual([p.facts.low, p.facts.high], [low.name, high.name]); assert.strictEqual(low.name, 'Anne');
  near(p.facts.lowPct, low.pct, 1e-9, 'pourcentage du plus en retard'); near(p.facts.highPct, high.pct, 1e-9, 'pourcentage du plus avancé');
  assert.strictEqual(p.facts.behind, pcts.filter((x) => x.pct < 90).length); assert.strictEqual(p.facts.ahead, pcts.filter((x) => x.pct >= 100).length);
  assert.strictEqual(p.facts.n, pcts.length);
  assert.strictEqual(p.insightKey, 'advice.insight.progressBehind');
  assert.deepStrictEqual([p.reasonVars.low, p.reasonVars.pct, p.reasonVars.behind, p.reasonVars.n], [low.name, Math.round(low.pct), pcts.filter((x) => x.pct < 90).length, pcts.length]);
  const k = goalKpi(suggest(objs))[0];
  const totalReal = objs.rows.reduce((a, r) => a + r.Realise, 0); const totalGoal = objs.rows.reduce((a, r) => a + r.Objectif, 0);
  near(k.facts.reach, totalReal / totalGoal, 1e-9, 'atteinte du chiffre clé'); near(k.facts.value, totalReal, 1e-6, 'réalisé'); near(k.facts.goal, totalGoal, 1e-6, 'objectif');
  assert.strictEqual(k.insightKey, totalReal / totalGoal >= 1 ? 'advice.insight.goalMet' : 'advice.insight.goalShort');
  assert.strictEqual(k.reasonVars.pct, totalReal / totalGoal < 1 ? Math.min(99, Math.round(totalReal / totalGoal * 100)) : Math.round(totalReal / totalGoal * 100));
  // Un objectif manqué se dit « manqué », avec la cible écrite ; atteint, il se dit atteint.
  const missed = table('objectifs').rows.map((r) => Object.assign({}, r, { Realise: r.Realise * 0.5 }));
  const km = goalKpi(suggest(missed))[0];
  assert.strictEqual(km.insightKey, 'advice.insight.goalShort');
  // Presque atteint (99,6 %) : « n'atteint que 99 % », jamais « 100 % » avec la phrase d'un échec.
  const almost = goalKpi(suggest(table('objectifs').rows.map((r) => Object.assign({}, r, { Realise: r.Objectif * 0.996 + 0.01 }))))[0];
  assert.strictEqual(almost.insightKey, 'advice.insight.goalShort');
  assert.ok(almost.facts.reach > 0.995 && almost.facts.reach < 1 && almost.reasonVars.pct === 99, `99,6 % s'écrit 99, pas ${almost.reasonVars.pct}`);
  assert.ok(km.facts.reach < 0.6 && /5\d %/.test(resolve(km, 'fr')) && /objectif/.test(resolve(km, 'fr')), resolve(km, 'fr'));
  console.log('OK justesse — calendrier (moyennes par jour, eta2), planning (étendue, plus longue, médiane, chevauchement), carte de chaleur (lift, V de Cramér), soleil, progression et chiffre clé : chaque chiffre recalculé à la main');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Phrases : fr/en résolues, sans variable orpheline
// ---------------------------------------------------------------------------------------------------------------------------------
{
  let checked = 0;
  const keys = new Set();
  tables.forEach((t) => ['fr', 'en'].forEach((lang) => suggest(t, { lang }).filter(isNew).forEach((s) => {
    const text = resolve(s, lang);
    assert.ok(text && !/[{}]/.test(text) && !/undefined|NaN|null|Infinity/.test(text), `${t.name} / ${s.type} (${lang}) : phrase mal résolue « ${text} »`);
    if (s.facts) Object.keys(s.facts).forEach((key) => { if (typeof s.facts[key] === 'number') assert.ok(Number.isFinite(s.facts[key]), `${t.name} / ${s.type} : ${key} fini`); });
    keys.add(s.insightKey || s.reasonKey);
    if (lang === 'fr') checked++;
  })));
  assert.ok(checked >= 6, `${checked} suggestions de ces types sur le corpus`);
  ['advice.insight.calWeekday', 'advice.insight.ganttOverlap', 'advice.insight.heatHot', 'advice.insight.hierTop', 'advice.insight.progressBehind'].forEach((key) => assert.ok(keys.has(key), `le corpus produit la phrase ${key}`));
  // Chaque clé citée par les deux fichiers existe en français ET en anglais, et se résout avec des variables types.
  const vars = { dimension: 'Date', best: 'mardi', pct: 26, worst: 'dimanche', pct2: 0, start: 'Debut', end: 'Fin', n: 40, days: 323, name: 'Tâche 24', d: 289, k: 5,
    row: 'Incident', col: 'Delta', lift: '2,0', top: 'Nord', child: 'Lille', low: 'Anne', high: 'Hugo', behind: 3, measure: 'Montant', goal: '1 200', target: 'Objectif',
    columnDimension: 'Equipe', levels: 'Region › Departement' };
  const sources = ['advice-types-time.js', 'advice-types-grid.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n');
  const cited = new Set((sources.match(/'advice\.(insight|reason|title)\.[A-Za-z]+'/g) || []).map((x) => x.slice(1, -1)));
  assert.ok(cited.size >= 15, `${cited.size} clés citées`);
  cited.forEach((key) => {
    assert.ok(i18n.STRINGS[key] && i18n.STRINGS[key].fr && i18n.STRINGS[key].en, `traduction fr ET en : ${key}`);
    ['fr', 'en'].forEach((lang) => { i18n.setLang(lang); const text = i18n.t(key, vars); assert.ok(!/[{}]/.test(text), `${key} (${lang}) : variable non résolue dans « ${text} »`); });
  });
  i18n.setLang('fr');
  (sources.match(/'tileTitle\.[A-Za-z]+'/g) || []).forEach((x) => assert.ok(i18n.STRINGS[x.slice(1, -1)], `titre de tuile : ${x}`));
  ['rhythm', 'schedule', 'structure', 'goal'].forEach((intent) => {
    assert.strictEqual(advice.INTENT_KEYS[intent], 'advice.intent.' + intent);
    assert.ok(i18n.STRINGS['advice.intent.' + intent].fr && i18n.STRINGS['advice.intent.' + intent].en);
  });
  assert.strictEqual(advice.INTENT_KEYS.cross, 'advice.intent.cross', 'la carte de chaleur garde l\'intention du tableau croisé');
  console.log(`OK phrases — ${checked} suggestions du corpus et ${cited.size} clés résolues en français et en anglais, sans variable orpheline ni NaN, jours nommés dans la langue`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Classement : le fait net passe devant le fait mince
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Un rythme net (activité) passe devant un rythme faible.
  const strong = of(suggest(table('activite')), 'calendar')[0];
  const weakCal = of(suggest(withDate(dailyRows(1, [6, 6, 12, 6, 6, 6, 6], 0, { heavy: true }))), 'calendar')[0];
  assert.ok(strong.interest > weakCal.interest + 0.3 && strong.score > weakCal.score + 1, `rythme net ${strong.interest} / ${strong.score} contre faible ${weakCal.interest} / ${weakCal.score}`);
  assert.ok(weakCal.facts.eta2 >= timeTypes.CALENDAR_MIN_ETA2 && weakCal.facts.eta2 < 0.2, `le rythme faible tient à ${weakCal.facts.eta2}`);
  // Un planning où tout se chevauche passe devant des tâches bout à bout.
  const isoPlus = (base, n) => isoOfDay(utcDay(base) + n);
  const make = (step) => Array.from({ length: 20 }, (_, i) => ({ id: i + 1, Task: 'Task ' + i, Start: isoPlus('2025-03-01', i * step), End: isoPlus('2025-03-01', i * step + 9) }));
  const parallel = of(suggest(make(1)), 'gantt')[0]; const chain = of(suggest(make(10)), 'gantt')[0];
  assert.ok(parallel && chain, 'les deux plannings sont proposés');
  assert.ok(parallel.facts.overlap >= 5 && chain.facts.overlap === 1, `en parallèle ${parallel.facts.overlap}, bout à bout ${chain.facts.overlap}`);
  assert.ok(parallel.interest > chain.interest + 0.2, `${parallel.interest} contre ${chain.interest}`);
  assert.strictEqual(chain.insightKey, 'advice.insight.ganttSpan'); assert.strictEqual(parallel.insightKey, 'advice.insight.ganttOverlap');
  // Une case chaude franche passe devant une case à peine plus haute que l'attendu.
  const cross = (hot) => { const r = corpus.rng(41); return Array.from({ length: 1200 }, (_, i) => { const a = Math.floor(r() * 4); let b = Math.floor(r() * 4); if (a === 1 && r() < hot) b = 2; return { id: i + 1, A: 'a' + a, B: 'b' + b, V: 'v' + i }; }); };
  const sharp = of(suggest(cross(0.7)), 'heatmap')[0]; const soft = of(suggest(cross(0.45)), 'heatmap')[0];
  assert.ok(sharp && soft, 'les deux croisements ressortent');
  assert.ok(sharp.facts.lift > soft.facts.lift && sharp.interest > soft.interest, `lift ${sharp.facts.lift} / ${sharp.interest} contre ${soft.facts.lift} / ${soft.interest}`);
  // Un objectif manqué ou dépassé de loin se dit (intérêt haut) ; un objectif tout juste atteint ne dit presque rien.
  const objs = table('objectifs');
  const even = objs.rows.map((r) => Object.assign({}, r, { Realise: r.Objectif }));
  const evenKpi = goalKpi(suggest(even))[0]; const missedKpi = goalKpi(suggest(objs.rows.map((r) => Object.assign({}, r, { Realise: r.Realise * 0.6 }))))[0];
  assert.ok(evenKpi.interest < 0.45 && missedKpi.interest > evenKpi.interest + 0.3, `atteint ${evenKpi.interest} contre manqué ${missedKpi.interest}`);
  const allMet = of(suggest(even), 'progress')[0];
  assert.ok(!allMet || allMet.interest < 0.45, 'des objectifs tous atteints : peu à montrer dans une progression');
  // Le chiffre clé avec objectif passe devant tous les chiffres clés nus de la table ; la progression devant les barres du même réalisé.
  const list = suggest(objs);
  const kpiGoal = goalKpi(list)[0];
  assert.ok(list.indexOf(kpiGoal) < list.indexOf(of(list, 'histogram')[0]), 'le chiffre avec sa cible passe devant un histogramme');
  assert.ok(of(list, 'progress')[0].score > of(list, 'treemap')[0].score && of(list, 'progress')[0].score > of(list, 'pivot')[0].score, 'la progression passe devant les tableaux et treemaps');
  // Un soleil net passe devant un soleil à parts égales.
  const tree = (skew) => { const r = corpus.rng(51); const t = { N: ['n1', 'n2', 'n3'], S: ['s1', 's2', 's3'], E: ['e1', 'e2', 'e3'], O: ['o1', 'o2', 'o3'] }; return Array.from({ length: 800 }, (_, i) => { const reg = Object.keys(t)[Math.floor(r() * 4)]; return { id: i + 1, Region: reg, Dep: t[reg][Math.floor(r() * 3)], Budget: Math.round((100 + r() * 100) * (reg === 'N' ? skew : 1) * 100) / 100 }; }); };
  const sunSharp = of(suggest(tree(6)), 'sunburst')[0]; const sunEven = of(suggest(tree(1)), 'sunburst')[0];
  assert.ok(sunSharp && sunEven && sunSharp.interest > sunEven.interest + 0.2, `${sunSharp && sunSharp.interest} contre ${sunEven && sunEven.interest}`);
  assert.strictEqual(sunEven.insightKey, 'advice.insight.hierTop');
  console.log('OK classement — rythme net devant rythme faible, parallèle devant bout à bout, case chaude franche devant case tiède, objectif manqué devant objectif juste atteint, soleil net devant soleil égal');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. Miniatures
// ---------------------------------------------------------------------------------------------------------------------------------
{
  const unit = (pv, kind) => {
    const numbers = [];
    (function walk(v) { if (typeof v === 'number') numbers.push(v); else if (v && typeof v === 'object') Object.keys(v).forEach((x) => walk(v[x])); })(pv);
    assert.ok(numbers.length > 0, `${kind} : des valeurs à dessiner`);
    numbers.forEach((n) => assert.ok(Number.isFinite(n) && n >= -1e-9 && n <= 1 + 1e-9, `${kind} : valeur hors de [0 ; 1] : ${n}`));
  };
  const preview = (name, type, kind) => {
    const t = table(name);
    const s = of(suggest(t), type)[0];
    const pv = advice.previewFor(s.tileData, t.rows);
    assert.ok(pv && pv.kind === kind, `${type} : miniature ${kind} (${pv && pv.kind})`);
    unit(pv, kind);
    const svg = welcome.previewSvg(pv, { lang: 'fr' });
    assert.ok(svg.startsWith('<svg') && !/NaN|undefined|Infinity/.test(svg), `${kind} : SVG sain`);
    return pv;
  };
  const cal = preview('activite', 'calendar', 'calendar');
  assert.strictEqual(cal.weeks.length, 12); cal.weeks.forEach((w) => assert.strictEqual(w.length, 7, 'sept jours par semaine'));
  assert.ok(cal.weeks.some((w) => w.some((v) => v === null)), 'un jour sans ligne reste vide (le dimanche)');
  assert.ok(cal.weeks.every((w) => w[6] === null), 'tous les dimanches sont vides');
  assert.ok(Math.max.apply(null, [].concat.apply([], cal.weeks).filter((v) => v !== null)) === 1, 'le plus gros jour est plein');
  const gantt = preview('projet', 'gantt', 'gantt');
  assert.ok(gantt.bars.length >= 2 && gantt.bars.length <= 6);
  gantt.bars.forEach((b) => assert.ok(b.left + b.width <= 1 + 1e-9, 'la barre reste dans le cadre'));
  const heat = preview('support', 'heatmap', 'heat');
  assert.ok(heat.rows.length >= 2 && heat.rows.every((r) => r.length === heat.rows[0].length), 'grille régulière');
  const rings = preview('organisation', 'sunburst', 'rings');
  assert.ok(rings.parents.length >= 2);
  assert.ok(rings.parents.reduce((a, p) => a + p.share, 0) <= 1 + 1e-9, 'les parts du centre ne dépassent pas le tout');
  rings.parents.forEach((p) => assert.ok(p.children.reduce((a, x) => a + x, 0) <= p.share + 1e-9, 'les sous-parts tiennent dans leur part'));
  const progress = preview('objectifs', 'progress', 'progress');
  progress.rows.forEach((r) => assert.ok(['good', 'warn', 'bad'].includes(r.level), `niveau ${r.level}`));
  assert.ok(progress.rows.some((r) => r.level === 'bad') && progress.rows.some((r) => r.level === 'good'), 'les commerciaux en retard et en avance se voient');
  // La carte d'objectif n'a de miniature que si l'objectif est nommé ; sans lui, une progression n'est pas une miniature de ce module.
  assert.strictEqual(advice.previewFor({ type: 'progress', dimension: 'Commercial', measure: 'Realise', aggFn: 'sum' }, table('objectifs').rows), null);
  assert.strictEqual(advice.previewFor({ type: 'calendar', dimension: 'Date', measure: 'Duree_h', aggFn: 'sum' }, [{ Date: 'pas une date', Duree_h: 3 }]), null, 'aucun jour valide = pas de miniature');
  assert.strictEqual(advice.previewFor({ type: 'gantt', dimension: 'Tache', startColumn: 'Debut', endColumn: 'Fin' }, [{ Tache: 'A', Debut: '2025-01-01', Fin: '2025-01-09' }]), null, 'une seule tâche = pas de miniature');
  console.log('OK miniatures — calendrier, planning, carte de chaleur, soleil et progression se dessinent dans [0 ; 1], sans NaN, avec leurs vides');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 6. Robustesse et hygiène
// ---------------------------------------------------------------------------------------------------------------------------------
{
  // Cellules vides : ignorées, jamais comptées pour 0 ; mesure entièrement vide ; dates illisibles.
  const act = table('activite');
  const holes = act.rows.map((r, i) => (i % 4 === 0 ? Object.assign({}, r, { Duree_h: null }) : r));
  const withHoles = suggest({ rows: holes, info: act.info });
  assert.strictEqual(of(withHoles, 'calendar').length, 1, 'des cellules vides ne retirent pas le calendrier');
  const emptyMeasure = act.rows.map((r) => Object.assign({}, r, { Duree_h: null }));
  assert.doesNotThrow(() => suggest({ rows: emptyMeasure, info: act.info }), 'une mesure entièrement vide');
  const garbage = act.rows.map((r) => Object.assign({}, r, { Date: 'jamais' }));
  assert.doesNotThrow(() => suggest({ rows: garbage, info: {} }), 'des dates illisibles');
  assert.strictEqual(of(suggest({ rows: garbage, info: {} }), 'calendar').length, 0, 'des dates illisibles ne font pas un calendrier');
  const gaps = table('projet').rows.map((r, i) => (i % 2 === 0 ? Object.assign({}, r, { Fin: null }) : r));
  assert.strictEqual(of(suggest(gaps), 'gantt').length, 0, 'la moitié des tâches sans fin : pas de planning');
  const noTarget = table('objectifs').rows.map((r) => Object.assign({}, r, { Objectif: null }));
  assert.doesNotThrow(() => suggest(noTarget), 'des objectifs vides');
  assert.strictEqual(of(suggest(noTarget), 'progress').length + goalKpi(suggest(noTarget)).length, 0, 'des objectifs vides ne font pas une progression');
  assert.doesNotThrow(() => suggest([]), 'aucune ligne');

  // 300 000 lignes triées par date : rapide ; le calendrier se calcule sur TOUTES les lignes (jamais l'échantillon, qui ferait paraître des jours vides).
  const big = corpus.sortedBigTable();
  const started = Date.now();
  const bigResult = suggest({ rows: big, info: DATE_INFO }, { limit: 40 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `300 000 lignes en ${elapsed} ms (moins de 4 s)`);
  assert.strictEqual(of(bigResult, 'calendar').length, 0, 'jours 1 à 28 de chaque mois, tous pareils : aucun rythme, et aucun faux jour vide dû à l\'échantillon');
  assert.strictEqual(of(bigResult, 'gantt').length + of(bigResult, 'heatmap').length + of(bigResult, 'sunburst').length, 0, 'aucun fait à dire sur ces colonnes');
  // Une table de 47 040 lignes réparties sur chaque jour (le jeu de charge de l'alpha) : aucun calendrier non plus.
  const dense = []; for (let d = 0; d < 1680; d++) for (let k = 0; k < 28; k++) dense.push({ id: dense.length + 1, Date: isoOfDay(Date.UTC(2020, 0, 1) / 86400000 + d), Region: ['N', 'S', 'E', 'O'][k % 4], Montant: 100.5 + (k % 7) * 3.5 });
  assert.strictEqual(of(suggest({ rows: dense, info: DATE_INFO }), 'calendar').length, 0, '28 lignes chaque jour : aucun rythme');

  // Un générateur qui lève ne retire rien aux autres ; un autre type n'est pas annoté ; une entrée vide n'a pas de miniature.
  const rows = table('support').rows;
  advice.setColumnInfo({});
  const ctx = advice.analyzeColumns(rows); ctx.insightRows = rows; ctx.lang = 'fr'; ctx.allRows = rows;
  const throwing = { candidate: () => { throw new Error('boum'); }, resolveTitle: () => '', groupsFor: () => { throw new Error('boum'); }, aggFor: () => 'sum', fmt: () => '', sampleOf: (r) => r,
    appearsAscending: () => true, measureOptions: () => { throw new Error('boum'); }, defaultsFor: () => { throw new Error('boum'); } };
  assert.deepStrictEqual(timeTypes.candidates(rows, ctx, {}, throwing), [], 'chaque générateur du temps est isolé');
  assert.deepStrictEqual(gridTypes.candidates(rows, ctx, {}, throwing), [], 'chaque générateur de la grille est isolé');
  assert.strictEqual(timeTypes.annotate({ type: 'bar', tileData: {} }, ctx, throwing), null); assert.strictEqual(gridTypes.annotate({ type: 'bar', tileData: {} }, ctx, throwing), null);
  assert.strictEqual(gridTypes.annotate({ type: 'kpi', tileData: { measure: 'x' } }, ctx, throwing), null, 'un chiffre clé sans cible n\'est pas annoté ici');
  assert.strictEqual(types.handles({ type: 'kpi', tileData: { targetColumn: 'Objectif' } }), true); assert.strictEqual(types.handles({ type: 'kpi', tileData: {} }), false);
  assert.strictEqual(timeTypes.previewFor(null, rows), null); assert.strictEqual(gridTypes.previewFor({ type: 'heatmap' }, []), null);
  assert.strictEqual(gridTypes.previewFor({ type: 'heatmap', dimension: 'Absente', columnDimension: 'Aussi', measure: 'x', aggFn: 'count' }, rows, { sampleOf: (r) => r }), null, 'colonnes absentes');

  // Déterministe : mêmes entrées, mêmes suggestions, même ordre.
  const a = suggest(table('objectifs')).map((s) => s.type + s.tileData.dimension + s.score).join('|');
  const b = suggest(table('objectifs')).map((s) => s.type + s.tileData.dimension + s.score).join('|');
  assert.strictEqual(a, b, 'déterministe');

  // Hygiène des deux fichiers : aucun accès au navigateur, aucune horloge, aucun import circulaire, aucun texte en dur, moins de 600 lignes.
  ['advice-types-time.js', 'advice-types-grid.js'].forEach((file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/require\(['"]\.\/advice\.js['"]\)/.test(code) && !/require\(['"]\.\/advice-types\.js['"]\)/.test(code) && !/GristBI\.advice\b(?!Types|Insights)/.test(code), `${file} : pas d'import circulaire`);
    ['document', 'window', 'localStorage', 'fetch(', 'eval(', 'Function(', 'Math.random', 'Date.now', 'new Date'].forEach((w) => assert.ok(!code.includes(w), `${file} : jamais ${w}`));
    const strings = (code.match(/'[^'\n]*'/g) || []).map((x) => x.slice(1, -1)).filter((x) => /[A-Za-zÀ-ÿ]{4,} [A-Za-zÀ-ÿ]{3,}/.test(x));
    assert.deepStrictEqual(strings.filter((x) => !/^(advice|tileTitle)\./.test(x) && !/^[a-z-]+$/.test(x)), [], `${file} : aucun texte lisible en dur, que des clés i18n`);
    assert.ok(source.split('\n').length < 600, `${file} : moins de 600 lignes`);
  });
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  const order = (html, prefix) => ['advice-names.js', 'advice-insights.js', 'advice-types-time.js', 'advice-types-grid.js', 'advice-types.js', 'advice.js'].map((n) => html.indexOf(`<script src="${prefix}js/${n}"></script>`));
  [[indexHtml, ''], [harness, '../']].forEach(([html, prefix]) => {
    const at = order(html, prefix);
    assert.ok(at.every((x) => x > 0), `les six scripts sont chargés (${prefix || 'index'}) : ${at}`);
    assert.deepStrictEqual(at.slice().sort((x, y) => x - y), at, 'ordre de chargement : noms, insights, temps, grille, types, advice');
  });
  console.log(`OK robustesse — cellules vides, dates illisibles, 300 000 lignes en ${elapsed} ms, générateurs isolés, déterministe, fichiers purs sans texte en dur`);
}

console.log('Tous les essais des types du temps et de la grille (niveau 2c) sont passés.');
