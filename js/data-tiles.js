/*
 * Calculs purs des types de tuile récents : histogramme, calendrier, Gantt, boîte à moustaches, flux (Sankey),
 * carte de chaleur / tableau croisé coloré, soleil et petits multiples. Aucune dépendance au DOM ni à l'API Grist,
 * testable sous Node (voir dev-tests/test-data.js).
 *
 * Ce fichier est la suite de js/data.js (coupé en deux le 18/11/2026 pour que chacun reste lisible d'une traite) : il
 * reçoit de js/data.js les fonctions communes dont il se sert (`core`) et lui rend les siennes, qui rejoignent l'API
 * publique `GristBI.data` sans changer de nom. Sous Node, js/data.js le charge tout seul ; dans un navigateur,
 * index.html le charge JUSTE APRÈS js/data.js (avant tout script qui lit `GristBI.data`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.data.extend(factory);
  }
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const {
    AGGREGATORS, MS_PER_DAY, PALETTES, aggregateSingle, filterSelects, finiteOrNull, isSeriesTile, parseDateValue, sameValue, sortGroups, tileDrillLevels
  } = core;

  // --- Histogramme (`type: 'histogram'`) ------------------------------------------------------------
  // Distribution d'UNE colonne numérique en classes de même largeur : combien de lignes par tranche de valeurs. Pas de
  // dimension ni d'agrégat (on compte des lignes). Calcul en JS pur à tout volume : une seule passe sur les lignes, bien
  // moins coûteuse que la sérialisation vers DuckDB (voir HYPOTHESES.md).
  //   - la GRILLE des classes vient de TOUTES les lignes (`allRows`), les comptes des lignes visibles (`rows`, après les
  //     filtres des autres tuiles) : l'axe ne bouge pas quand on filtre ailleurs, les barres rétrécissent ;
  //   - bornes « rondes » (1, 2 ou 5 x 10^n) : des classes 0-5, 5-10 plutôt que 0-4,76 ; un nombre de classes demandé est
  //     donc indicatif ; une colonne d'entiers n'a jamais de classe plus étroite que 1 (classes vides en alternance sinon) ;
  //   - classe [bas ; haut[, la dernière aussi fermée à droite (le maximum y entre) ; valeurs vides ou non numériques
  //     ignorées (jamais comptées comme 0) ;
  //   - un clic pose un filtre `range` (`histogramFilter`) dont la borne haute est EXCLUE, sauf pour la dernière classe.
  const HISTOGRAM_AUTO_MIN = 5;
  const HISTOGRAM_AUTO_MAX = 20;
  const HISTOGRAM_MAX_BINS = 60;

  // Pas « rond » le plus proche de `raw` (> 0) : 1, 2, 5 ou 10 fois une puissance de 10.
  function niceStep(raw) {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const exp = Math.floor(Math.log10(raw));
    const base = Math.pow(10, exp);
    const ratio = raw / base;
    const nice = ratio < 1.5 ? 1 : (ratio < 3 ? 2 : (ratio < 7 ? 5 : 10));
    return nice * base;
  }

  function roundTo(x, decimals) {
    const m = Math.pow(10, decimals);
    return Math.round(x * m) / m;
  }

  // Nombres exploitables d'une colonne : ni vide, ni booléen, ni texte non numérique ; `ignored` = lignes laissées de côté.
  function numericValues(rows, column) {
    const values = [];
    let ignored = 0;
    (rows || []).forEach((r) => {
      const v = r[column];
      if (v == null || v === '' || typeof v === 'boolean') { ignored++; return; }
      const n = typeof v === 'bigint' ? Number(v) : Number(v);
      if (Number.isFinite(n)) values.push(n); else ignored++;
    });
    return { values, ignored };
  }

  // Classes d'un histogramme : `{ bins: [{lo, hi, count, last}], step, total, ignored }`. `requested` = nombre de classes
  // voulu (entier, 2 à HISTOGRAM_MAX_BINS), absent = automatique (Sturges : log2(n) + 1, entre 5 et 20).
  function histogramBins(allRows, rows, column, requested) {
    const all = numericValues(allRows, column).values;
    if (!all.length) return { bins: [], step: 0, total: 0, ignored: numericValues(rows, column).ignored };
    let min = Infinity;
    let max = -Infinity;
    let integer = true;
    all.forEach((v) => { if (v < min) min = v; if (v > max) max = v; if (integer && !Number.isInteger(v)) integer = false; });
    const shown = numericValues(rows, column);
    // Une seule valeur distincte : une seule classe, fermée des deux côtés.
    if (min === max) {
      const count = shown.values.filter((v) => v === min).length;
      return { bins: [{ lo: min, hi: max, count, last: true }], step: 0, total: shown.values.length, ignored: shown.ignored };
    }
    const wanted = Number.isFinite(Number(requested)) && Number(requested) >= 2
      ? Math.min(HISTOGRAM_MAX_BINS, Math.round(Number(requested)))
      : Math.max(HISTOGRAM_AUTO_MIN, Math.min(HISTOGRAM_AUTO_MAX, Math.ceil(Math.log2(all.length)) + 1));
    let step = niceStep((max - min) / wanted);
    if (integer && step < 1) step = 1;
    const countFor = (st) => Math.max(1, Math.ceil((max - Math.floor(min / st) * st) / st - 1e-9));
    let n = countFor(step);
    while (n > HISTOGRAM_MAX_BINS) { step = niceStep(step * 1.5); n = countFor(step); }
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const start = roundTo(Math.floor(min / step) * step, decimals);
    // Bornes ARRONDIES une fois, puis utilisées pour compter ET pour filtrer : la classe affichée contient exactement
    // les lignes que son filtre `range` retient (jamais un écart dû au bruit de flottant, 0,1 + 0,2).
    const edges = [];
    for (let i = 0; i <= n; i++) edges.push(roundTo(start + i * step, decimals));
    const counts = new Array(n).fill(0);
    shown.values.forEach((v) => {
      let i = Math.floor((v - start) / step);
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      while (i > 0 && v < edges[i]) i--;
      while (i < n - 1 && v >= edges[i + 1]) i++;
      counts[i]++;
    });
    return {
      bins: counts.map((count, i) => ({ lo: edges[i], hi: edges[i + 1], count, last: i === n - 1 })),
      step,
      total: shown.values.length,
      ignored: shown.ignored
    };
  }

  // Filtre `range` d'une classe (voir matchesFilter) : borne haute exclue, sauf la dernière classe.
  function histogramFilter(bin) {
    return bin.last ? { type: 'range', min: bin.lo, max: bin.hi } : { type: 'range', min: bin.lo, max: bin.hi, maxExclusive: true };
  }

  // Vrai si `filter` (le filtre croisé posé par CET histogramme) est exactement celui de la classe `bin`.
  function histogramBinIsActive(filter, bin) {
    return !!filter && filter.type === 'range' && Number(filter.min) === bin.lo && Number(filter.max) === bin.hi
      && !!filter.maxExclusive === !bin.last;
  }

  // --- Calendrier (`type: 'calendar'`) ---------------------------------------------------------------------
  // Une case par JOUR, colorée selon la valeur agrégée de ce jour : `tile.dimension` = une colonne de DATES (format ISO
  // 'AAAA-MM-JJ', celui de toutes les colonnes Date de ce widget), `tile.measure` + `tile.aggFn` (Comptage = lignes par jour). Un
  // jour sans ligne n'a PAS de case colorée (jamais « la plus petite valeur »). Un calendrier lisible tient sur une année :
  // au-delà, seuls les CALENDAR_MAX_DAYS derniers jours (depuis le dernier jour qui a une valeur) sont dessinés, le reste est compté.
  // JS pur à tout volume : une passe pour ranger les lignes par jour, puis un agrégat par jour.
  const CALENDAR_MAX_DAYS = 366;

  function isoDayShift(iso, days) {
    const t = parseDateValue(iso);
    return t === null ? null : new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
  }

  // Rend `{ days: [{date, value}], from, to, ignored, hidden, total }` : `days` triés par date, seulement les jours avec une valeur
  // numérique ; `ignored` = lignes dont la cellule n'est pas une date ISO valide ; `hidden` = jours (avec valeur) plus anciens que la
  // fenêtre affichée ; `total` = jours avec une valeur avant ce plafond ; `from`/`to` = premier et dernier jour dessinés (null si aucun).
  function calendarDays(rows, dateColumn, measureColumn, aggFn, maxDays) {
    const byDay = new Map();
    let ignored = 0;
    for (const row of rows || []) {
      const day = row[dateColumn];
      if (parseDateValue(day) === null) { ignored++; continue; }
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(row);
    }
    const all = [];
    Array.from(byDay.keys()).sort().forEach((day) => {
      const raw = aggregateSingle(byDay.get(day), measureColumn, aggFn);
      const value = typeof raw === 'bigint' ? Number(raw) : raw;
      if (Number.isFinite(value)) all.push({ date: day, value });
    });
    if (!all.length) return { days: [], from: null, to: null, ignored, hidden: 0, total: 0 };
    const last = all[all.length - 1].date;
    const cap = maxDays === Infinity ? Infinity : (Number.isInteger(maxDays) && maxDays > 0 ? maxDays : CALENDAR_MAX_DAYS);
    const days = cap === Infinity ? all : all.filter((d) => d.date >= isoDayShift(last, -(cap - 1)));
    return { days, from: days[0].date, to: last, ignored, hidden: all.length - days.length, total: all.length };
  }

  // --- Gantt / planning (`type: 'gantt'`) -------------------------------------------------------------------
  // Une LIGNE par ligne de la table : `tile.dimension` = le libellé de la tâche, `tile.startColumn` et `tile.endColumn` = deux
  // colonnes de DATES (format ISO), `tile.seriesColumn` = une couleur par valeur (un statut), facultatif. Pas d'agrégat ni de mesure :
  // une barre est une tâche telle que la table la décrit. Une ligne dont le début ou la fin n'est pas une date valide, ou dont la fin
  // précède le début, n'a pas de barre (une tâche « en cours » sans fin ne se dessine pas : on n'invente pas sa durée) ; elle est
  // comptée dans `ignored`. Triées par date de début (ordre stable : à début égal, l'ordre de la table). Au plus GANTT_MAX_ROWS lignes
  // dessinées (`hidden` compte le reste). JS pur à tout volume : une passe puis un tri.
  const GANTT_MAX_ROWS = 200;

  // Rend `{ tasks: [{label, start, end, status}], statuses, ignored, hidden, total, min, max }` : `tasks` = les lignes retenues
  // (début/fin au format ISO, `status` seulement avec une colonne de couleur, '' pour une cellule vide), `statuses` = les valeurs de
  // couleur dans l'ordre d'apparition dans la TABLE (sur toutes les tâches valides : les couleurs ne bougent pas avec le plafond),
  // `total` = tâches valides avant le plafond, `min`/`max` = premier début et dernière fin des tâches retenues (null si aucune).
  function ganttTasks(rows, labelColumn, startColumn, endColumn, colorColumn, maxTasks) {
    const valid = [];
    const statuses = [];
    const seen = new Set();
    let ignored = 0;
    for (const row of rows || []) {
      const start = row[startColumn];
      const end = row[endColumn];
      const startMs = parseDateValue(start);
      const endMs = parseDateValue(end);
      if (startMs === null || endMs === null || endMs < startMs) { ignored++; continue; }
      const label = row[labelColumn];
      const task = { label: label === null || label === undefined ? '' : String(label), start, end };
      if (colorColumn) {
        const cell = row[colorColumn];
        task.status = cell === null || cell === undefined ? '' : String(cell);
        if (!seen.has(task.status)) { seen.add(task.status); statuses.push(task.status); }
      }
      valid.push(task);
    }
    valid.sort((a, b) => (a.start < b.start ? -1 : (a.start > b.start ? 1 : 0))); // dates ISO : l'ordre alphabétique est l'ordre du calendrier ; tri stable
    const cap = maxTasks === Infinity ? Infinity : (Number.isInteger(maxTasks) && maxTasks > 0 ? maxTasks : GANTT_MAX_ROWS);
    const tasks = cap === Infinity ? valid : valid.slice(0, cap);
    if (!tasks.length) return { tasks, statuses, ignored, hidden: 0, total: valid.length, min: null, max: null };
    const max = tasks.reduce((m, task) => (task.end > m ? task.end : m), tasks[0].end);
    return { tasks, statuses, ignored, hidden: valid.length - tasks.length, total: valid.length, min: tasks[0].start, max };
  }

  // Graduations de l'axe du temps : `[{pct, kind, year, month, day}]` (`pct` de 0 à 1 le long de l'axe ; `month` de 0 à 11). Mois au-delà de
  // 60 jours, lundis au-delà de 10 jours, sinon chaque jour ; au plus `maxTicks` (GANTT_MAX_TICKS par défaut : on en saute une sur deux,
  // trois…, selon la largeur dont dispose l'axe), plus une graduation au tout début quand la 1re tombe loin du bord (le premier mois
  // commence au milieu : sans elle, rien ne le nomme).
  const GANTT_MAX_TICKS = 8;
  function ganttTicks(minMs, maxMs, maxTicks) {
    const span = maxMs - minMs + MS_PER_DAY;
    const days = Math.round(span / MS_PER_DAY);
    const kind = days > 60 ? 'month' : (days > 10 ? 'week' : 'day');
    const at = (ms) => {
      const tickDate = new Date(ms);
      return { pct: (ms - minMs) / span, kind, year: tickDate.getUTCFullYear(), month: tickDate.getUTCMonth(), day: tickDate.getUTCDate() };
    };
    const ticks = [];
    if (kind === 'month') {
      const first = new Date(minMs);
      let y = first.getUTCFullYear();
      let m = first.getUTCMonth() + (first.getUTCDate() > 1 ? 1 : 0);
      for (let ms = Date.UTC(y, m, 1); ms <= maxMs; ms = Date.UTC(y, ++m, 1)) ticks.push(at(ms));
    } else {
      for (let ms = minMs; ms <= maxMs; ms += MS_PER_DAY) {
        if (kind === 'day' || new Date(ms).getUTCDay() === 1) ticks.push(at(ms));
      }
    }
    const budget = Number.isInteger(maxTicks) && maxTicks >= 1 ? Math.min(maxTicks, GANTT_MAX_TICKS) : GANTT_MAX_TICKS;
    const step = Math.max(1, Math.ceil(ticks.length / budget));
    const kept = ticks.filter((_, i) => i % step === 0);
    if (!kept.length || kept[0].pct > 0.2) kept.unshift(at(minMs));
    return kept;
  }

  // Géométrie du dessin à partir de `ganttTasks` : chaque barre reçoit `left`/`width` en fraction de l'axe (une tâche d'un jour occupe
  // UNE case de jour entière : fin incluse), `today` = position (0 à 1, milieu de la case du jour) ou null si aujourd'hui sort de
  // l'axe ; `nowMs` est un paramètre (jamais l'horloge en dur) pour rester testable.
  function ganttLayout(res, nowMs, maxTicks) {
    if (!res.tasks.length) return Object.assign({}, res, { bars: [], ticks: [], today: null });
    const minMs = parseDateValue(res.min);
    const maxMs = parseDateValue(res.max);
    const span = maxMs - minMs + MS_PER_DAY;
    const bars = res.tasks.map((task) => {
      const s = parseDateValue(task.start);
      const e = parseDateValue(task.end);
      return Object.assign({}, task, { left: (s - minMs) / span, width: (e - s + MS_PER_DAY) / span });
    });
    const dayStart = Number.isFinite(nowMs) ? nowMs - (((nowMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) : NaN;
    const inside = Number.isFinite(dayStart) && dayStart >= minMs && dayStart <= maxMs;
    return Object.assign({}, res, { bars, ticks: ganttTicks(minMs, maxMs, maxTicks), today: inside ? (dayStart - minMs + MS_PER_DAY / 2) / span : null });
  }

  // --- Boîte à moustaches (`type: 'box'`) ----------------------------------------------------------
  // Distribution d'UNE colonne numérique PAR GROUPE (valeurs de `tile.dimension`) : médiane, quartiles, moustaches et valeurs
  // aberrantes — notes par classe, délais par service. Il faut les valeurs BRUTES de chaque ligne, jamais un agrégat : c'est
  // pourquoi ce type n'a ni agrégat ni mode « mesure ». Calcul en JS pur à tout volume (une passe, un tri par groupe), comme
  // l'histogramme : pas de sérialisation vers DuckDB (voir HYPOTHESES.md).
  //   - quantiles par interpolation linéaire entre les deux valeurs voisines (« type 7 » : QUARTILE.INC d'Excel, `quantile_cont`
  //     de DuckDB, numpy par défaut) — la médiane d'un nombre pair de notes est la moyenne des deux du milieu ;
  //   - moustaches de Tukey : la plus petite et la plus grande valeur comprises dans [Q1 - 1,5 x EIQ ; Q3 + 1,5 x EIQ] ;
  //     au-delà, une valeur aberrante (tracée seule, jamais absorbée dans la moustache) ;
  //   - une valeur vide, booléenne ou non numérique est ignorée (jamais comptée comme 0) ; un groupe sans aucune valeur
  //     numérique n'a pas de boîte ; les groupes gardent leur ordre de première apparition (comme `groupByAggregate`) ;
  //   - un groupe de moins de BOX_MIN_RELIABLE valeurs a des quartiles peu parlants : la boîte est tracée, l'effectif est dans
  //     l'infobulle et js/advice.js prévient.
  const BOX_MAX_OUTLIERS = 60; // valeurs aberrantes TRACÉES par groupe (le compte, lui, est toujours exact)
  const BOX_MIN_RELIABLE = 5;
  const BOX_MAX_GROUPS = 24; // au-delà, des boîtes de quelques pixels : js/advice.js conseille de regrouper

  // Quantile `p` (0 à 1) d'un tableau TRIÉ par ordre croissant, interpolation linéaire ; null si le tableau est vide.
  function quantileSorted(sorted, p) {
    const n = sorted.length;
    if (!n) return null;
    if (n === 1) return sorted[0];
    const h = (n - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  }

  // Une entrée par groupe : { dimension (valeur d'origine), name (texte), n, min, max, q1, median, q3, low, high, outliers,
  // outlierCount } ; `low`/`high` = bouts des moustaches, `outliers` = au plus `maxOutliers` valeurs aberrantes (les plus
  // éloignées de la médiane, rangées par ordre croissant), `outlierCount` = leur nombre réel. `ignored` = lignes laissées de côté.
  function boxStatsByGroup(rows, dimension, measure, maxOutliers) {
    const cap = Number.isFinite(maxOutliers) && maxOutliers >= 0 ? Math.floor(maxOutliers) : BOX_MAX_OUTLIERS;
    const byGroup = new Map();
    let ignored = 0;
    for (const row of (rows || [])) {
      const v = row[measure];
      if (v == null || v === '' || typeof v === 'boolean') { ignored++; continue; }
      const x = Number(v); // un BigInt (DuckDB) devient un nombre
      if (!Number.isFinite(x)) { ignored++; continue; }
      const key = row[dimension];
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(x);
    }
    const groups = [];
    byGroup.forEach((values, key) => {
      values.sort((a, b) => a - b);
      const q1 = quantileSorted(values, 0.25);
      const median = quantileSorted(values, 0.5);
      const q3 = quantileSorted(values, 0.75);
      const reach = 1.5 * (q3 - q1);
      const fenceLo = q1 - reach;
      const fenceHi = q3 + reach;
      let low = Infinity;
      let high = -Infinity;
      const outside = [];
      values.forEach((v) => {
        if (v < fenceLo || v > fenceHi) outside.push(v);
        else { if (v < low) low = v; if (v > high) high = v; }
      });
      // Toutes les valeurs hors barrières : impossible (la médiane est toujours dedans), mais jamais d'infini en sortie.
      if (!Number.isFinite(low)) { low = median; high = median; }
      const drawn = outside.length > cap
        ? outside.slice().sort((a, b) => Math.abs(b - median) - Math.abs(a - median)).slice(0, cap).sort((a, b) => a - b)
        : outside;
      groups.push({
        dimension: key, name: String(key), n: values.length, min: values[0], max: values[values.length - 1],
        q1, median, q3, low, high, outliers: drawn, outlierCount: outside.length
      });
    });
    return { groups, ignored };
  }

  // --- Flux (`type: 'sankey'`) -----------------------------------------------------------------------
  // Deux colonnes (source = `tile.dimension`, cible = `tile.columnDimension`) + une mesure : combien passe de chaque source vers
  // chaque cible (canal -> statut, origine -> destination). Calcul en JS pur à tout volume : une passe, un groupement par PAIRE
  // (jamais la matrice sources x cibles du tableau croisé, qui serait énorme sur deux colonnes à forte cardinalité).
  //   - la source et la cible sont DEUX ensembles de nœuds distincts, même quand une valeur figure des deux côtés (une ville
  //     d'origine ET de destination = deux nœuds, un à gauche, un à droite) : un Sankey à deux colonnes ne peut donc JAMAIS
  //     contenir de cycle (A -> B et B -> A, que ECharts refuse), il n'y a rien à détecter ; un flux de A vers A reste un flux ;
  //   - un flux n'a de hauteur que s'il est POSITIF : un flux nul, négatif ou non numérique n'est pas dessiné (`dropped`, et le
  //     conseil le dit) mais reste dans `pairs`, que l'export Excel écrit en entier ;
  //   - une ligne sans source ou sans cible n'a pas de flux (`ignored`) ; l'ordre est celui de première apparition ;
  //   - `topFlows` limite ce qui est DESSINÉ (SANKEY_MAX_LINKS, les plus gros, dans l'ordre d'origine) : au-delà, le diagramme n'est
  //     plus qu'un écheveau ; le nombre de nœuds lisibles (SANKEY_MAX_NODES) est une limite de conseil, pas de dessin.
  const SANKEY_MAX_NODES = 15;
  const SANKEY_MAX_LINKS = 60;

  function sankeyFlows(rows, sourceColumn, targetColumn, measureColumn, aggFn) {
    const aggregator = AGGREGATORS[aggFn] || AGGREGATORS.sum;
    const byPair = new Map();
    let ignored = 0;
    for (const row of (rows || [])) {
      const s = row[sourceColumn];
      const t = row[targetColumn];
      if (s == null || s === '' || t == null || t === '') { ignored++; continue; }
      const key = String(s) + '\u0000' + String(t);
      let entry = byPair.get(key);
      if (!entry) { entry = { source: String(s), target: String(t), values: [] }; byPair.set(key, entry); }
      entry.values.push(row[measureColumn]);
    }
    const pairs = [];
    const flows = [];
    let dropped = 0;
    byPair.forEach((e) => {
      const value = Number(aggregator(e.values));
      if (!Number.isFinite(value)) { dropped++; return; }
      pairs.push({ source: e.source, target: e.target, value });
      if (value > 0) flows.push({ source: e.source, target: e.target, value }); else dropped++;
    });
    const sources = Array.from(new Set(flows.map((f) => f.source)));
    const targets = Array.from(new Set(flows.map((f) => f.target)));
    return { flows, pairs, sources, targets, total: flows.reduce((a, f) => a + f.value, 0), dropped, ignored };
  }

  // Les `max` plus gros flux, rangés dans leur ordre d'origine (à valeur égale, les premiers).
  function topFlows(flows, max) {
    const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : SANKEY_MAX_LINKS;
    if (flows.length <= limit) return flows;
    const keep = new Set(flows.map((f, i) => ({ i, v: f.value })).sort((a, b) => (b.v - a.v) || (a.i - b.i)).slice(0, limit).map((x) => x.i));
    return flows.filter((f, i) => keep.has(i));
  }

  // --- Carte de chaleur et tableau croisé coloré (`type: 'heatmap'`, `tile.pivotHeat`) ---------------
  // Une valeur -> une couleur d'un DÉGRADÉ SÉQUENTIEL d'une seule teinte (jamais l'arc-en-ciel) : clair = petit, foncé = grand. Les
  // rampes reprennent les dégradés validés de PALETTES (bleu, orange, vert, gris), précédés d'un blanc teinté pour que la plus petite
  // valeur ne soit pas déjà « chaude » ; une palette catégorielle (standard, Okabe-Ito) n'est pas un dégradé : le bleu la remplace.
  // La couleur du TEXTE est choisie pour le meilleur contraste avec le fond de la cellule (blanc ou noir) : un nombre ne
  // devient jamais illisible. La couleur n'est jamais seule : le nombre reste écrit dans la cellule (tableau croisé) ou au survol.
  const HEAT_RAMPS = {
    blue: ['#eef4fc', PALETTES.blue[5], PALETTES.blue[3], PALETTES.blue[0]],
    orange: ['#fdf3ec', PALETTES.orange[5], PALETTES.orange[3], PALETTES.orange[0]],
    green: ['#eef8f0', PALETTES.green[5], PALETTES.green[3], PALETTES.green[0]],
    gray: ['#f4f4f4', PALETTES.gray[5], PALETTES.gray[3], PALETTES.gray[0]]
  };
  function heatStops(paletteKey) {
    return Object.prototype.hasOwnProperty.call(HEAT_RAMPS, paletteKey) ? HEAT_RAMPS[paletteKey] : HEAT_RAMPS.blue;
  }
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
  }
  // Couleur à la position `t` (0 = premier arrêt, 1 = dernier), arrêts régulièrement espacés, interpolation linéaire en RVB — la
  // même que celle d'ECharts pour `visualMap.inRange.color` : la légende de la carte de chaleur et les couleurs calculées ici concordent.
  function heatColor(t, stops) {
    const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const fraction = x - i;
    const lowerRgb = hexToRgb(stops[i]);
    const upperRgb = hexToRgb(stops[i + 1]);
    return rgbToHex(lowerRgb.map((c, k) => c + (upperRgb[k] - c) * fraction));
  }
  function relativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const HEAT_TEXT_DARK = '#000000'; // noir pur : avec un gris plus doux, le pire cas (fond de luminance moyenne) tombe sous 4,5:1 (4,2 avec #1a1a1a)
  const HEAT_TEXT_LIGHT = '#ffffff';
  // Texte blanc ou noir : celui des deux qui contraste le plus avec `bgHex` (rapport WCAG).
  function heatTextColor(bgHex) {
    const l = relativeLuminance(bgHex);
    const contrastLight = 1.05 / (l + 0.05);
    const contrastDark = (l + 0.05) / (relativeLuminance(HEAT_TEXT_DARK) + 0.05);
    return contrastDark >= contrastLight ? HEAT_TEXT_DARK : HEAT_TEXT_LIGHT;
  }
  // Bornes des valeurs d'une grille (matrice de lignes, cellules `null` possibles) ; `null` si aucune valeur numérique.
  function heatRange(matrix) {
    let min = Infinity;
    let max = -Infinity;
    (matrix || []).forEach((line) => (line || []).forEach((v) => {
      const n = v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
      if (Number.isFinite(n)) { if (n < min) min = n; if (n > max) max = n; }
    }));
    return min <= max ? { min, max } : null;
  }
  // Fond et texte de chaque cellule d'une grille : `{bg, fg}` ou `null` (cellule sans valeur : aucune couleur, jamais « la plus claire »).
  // Toutes les valeurs égales : couleur du milieu de la rampe.
  function heatCellColors(matrix, stops) {
    const range = heatRange(matrix);
    return (matrix || []).map((line) => (line || []).map((v) => {
      const n = v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
      if (!range || !Number.isFinite(n)) return null;
      const t = range.max === range.min ? 0.5 : (n - range.min) / (range.max - range.min);
      const bg = heatColor(t, stops);
      return { bg, fg: heatTextColor(bg) };
    }));
  }
  // --- Soleil (`type: 'sunburst'`) -------------------------------------------------------------------------------------------------
  // Une répartition HIÉRARCHIQUE en anneaux concentriques : l'anneau central est `tile.dimension`, les suivants sont les niveaux de la liste
  // « drill-down » de la tuile (`tile.drillDimensions`, la même liste que pour un camembert, mais ici tous les niveaux se voient à la fois :
  // pas de drill-down, un clic filtre). Une part d'un anneau est une valeur de sa colonne DANS la part de l'anneau d'en dessous. L'angle d'une
  // part est une quantité qui s'ADDITIONNE (somme ou comptage) : un anneau n'a pas de sens pour une moyenne, un minimum ou un maximum (la valeur
  // d'une part ne serait pas la somme de ses sous-parts) ; le formulaire les refuse, et `sunburstTree` les lit comme une somme si une ancienne
  // configuration les porte (conseil `advice.sunburst.notAdditive`).
  const SUNBURST_MAX_LEVELS = 4; // au-delà, les anneaux du dehors sont des fils illisibles dans une tuile
  const SUNBURST_MAX_CHILDREN = 15; // parts dessinées par part parente : les plus grandes ; le reste est compté (`hidden`) et laisse un vide honnête

  // Colonnes des anneaux, du centre vers l'extérieur : la dimension puis les niveaux, sans doublon (une colonne qui revient ne ferait que
  // répéter son anneau) ni valeur vide, au plus SUNBURST_MAX_LEVELS.
  function sunburstLevels(tile) {
    const out = [];
    if (!tile) return out;
    for (const levelColumn of [tile.dimension].concat(tileDrillLevels(tile))) {
      if (typeof levelColumn === 'string' && levelColumn && out.indexOf(levelColumn) === -1) out.push(levelColumn);
    }
    return out.slice(0, SUNBURST_MAX_LEVELS);
  }

  // Arbre des parts : `sunburstTree(lignes, colonnes, mesure, agrégat, tri?, maxEnfants?)` ->
  //   { roots, levels, depth, nodes, total, ignored, dropped, hidden, negative, paths }
  // - `roots` : `[{ name, column, path, value, children }]`, `path` = les valeurs de la racine jusqu'à cette part (de quoi poser les filtres d'un
  //   clic) et `value` = la TAILLE dessinée = la part propre de la part (lignes qui s'y arrêtent, jamais négative) + la taille de ses enfants ;
  //   avec des valeurs toutes positives c'est exactement le total de la part. Une part ne dépasse jamais ses enfants : l'angle d'un parent vaut
  //   toujours la somme des angles de ses enfants plus sa part propre (le vide d'un parent plus grand que ses enfants est donc honnête).
  // - une ligne sans valeur au 1er anneau est ignorée (`ignored`) ; sans valeur à un anneau plus profond, elle s'arrête à l'anneau d'avant
  //   (sa valeur reste dans la part parente, qui garde un vide face aux sous-parts manquantes) ;
  // - une part de taille nulle (valeurs négatives ou absentes) n'est pas dessinée (`dropped`, `negative` compte les parts à total négatif) ;
  // - au plus `maxEnfants` parts (les plus grandes) par part parente, le reste dans `hidden` ; ordre : celui d'apparition, ou `tri` (`sortGroups`) ;
  // - `paths` : une entrée par part où des lignes s'arrêtent, `{ path, value }` avec la valeur PROPRE (somme ou comptage, négatifs compris) :
  //   leur somme est le total des lignes retenues, pour l'export (rien n'est compté deux fois, rien n'est plafonné).
  // Agrégat : `count` (ou aucune mesure) compte les lignes ; tout autre agrégat est lu comme une somme. Cellules de mesure vides/textuelles
  // = 0 ; `BigInt` et chaînes numériques acceptés. Valeur du niveau en `String()` (DuckDB et les cellules numériques rendent des types variés).
  function sunburstTree(rows, levels, measureColumn, aggFn, sortMode, maxChildren) {
    const cols = [];
    for (const drillColumn of levels || []) if (typeof drillColumn === 'string' && drillColumn && cols.indexOf(drillColumn) === -1) cols.push(drillColumn);
    cols.splice(SUNBURST_MAX_LEVELS);
    const cap = Number.isInteger(maxChildren) && maxChildren > 0 ? maxChildren : SUNBURST_MAX_CHILDREN;
    const counting = aggFn === 'count' || !measureColumn;
    const empty = (v) => v == null || v === '';
    const top = { kids: new Map() };
    let ignored = 0;
    for (const row of rows || []) {
      if (!cols.length || empty(row[cols[0]])) { ignored++; continue; }
      let node = top;
      let path = [];
      for (let depthIndex = 0; depthIndex < cols.length; depthIndex++) {
        const cell = row[cols[depthIndex]];
        if (empty(cell)) break;
        const name = String(cell);
        let child = node.kids.get(name);
        if (!child) { child = { name, column: cols[depthIndex], path: path.concat([name]), own: 0, ownCount: 0, kids: new Map() }; node.kids.set(name, child); }
        node = child;
        path = child.path;
      }
      node.ownCount += 1;
      node.own += counting ? 1 : (finiteOrNull(row[measureColumn]) || 0);
    }
    let dropped = 0;
    let hidden = 0;
    let negative = 0;
    let nodes = 0;
    let depth = 0;
    const paths = [];
    // Passe 1 : taille de chaque part (ses enfants d'abord) et liste d'export, dans l'ordre d'apparition.
    const measure = (node) => {
      if (node.ownCount > 0) paths.push({ path: node.path, value: node.own });
      let total = node.own;
      let size = Math.max(node.own, 0);
      node.children = [];
      node.kids.forEach((kid) => {
        const k = measure(kid);
        total += k.total;
        if (k.size > 0) { size += k.size; node.children.push(kid); } else dropped++;
      });
      node.total = total;
      node.size = size;
      if (total < 0 || node.own < 0) negative++;
      return node;
    };
    top.children = [];
    top.kids.forEach((kid) => { const k = measure(kid); if (k.size > 0) top.children.push(kid); else dropped++; });
    // Passe 2 : les plus grandes parts d'abord retenues (à taille égale, les premières), puis rangées dans l'ordre voulu ; une part nulle n'existe pas.
    const shape = (list, level) => {
      let kept = list;
      if (list.length > cap) {
        const keep = new Set(list.map((n, i) => ({ i, v: n.size })).sort((a, b) => (b.v - a.v) || (a.i - b.i)).slice(0, cap).map((x) => x.i));
        kept = list.filter((n, i) => keep.has(i));
        hidden += list.length - kept.length;
      }
      const ordered = sortMode ? sortGroups(kept.map((n) => ({ dimension: n.name, value: n.size, node: n })), sortMode).map((g) => g.node) : kept;
      return ordered.map((n) => {
        nodes++;
        if (level > depth) depth = level;
        return { name: n.name, column: n.column, path: n.path, value: n.size, children: shape(n.children, level + 1) };
      });
    };
    const roots = shape(top.children, 1);
    return { roots, levels: cols, depth, nodes, total: roots.reduce((a, r) => a + r.value, 0), ignored, dropped, hidden, negative, paths };
  }

  // Filtres à poser pour un clic sur la part `values` (les valeurs de la racine jusqu'à elle, `columns` = les colonnes de TOUS les anneaux) :
  // `[{ column, value }]`, à passer UN PAR UN à `toggleFilter` (qui pose, remplace ou retire). Deux appels aveugles lèveraient le filtre déjà posé
  // d'un anneau commun au 2e clic dans la même branche (comme `cellFilterToggles`, piège n°31). Règles : pose la valeur de chaque anneau jusqu'à
  // la part (sauf celui qui l'a déjà), retire les filtres de cette tuile sur les anneaux PLUS PROFONDS (on remonte d'un niveau) ; si l'état est
  // déjà exactement celui-là, retire tout (2e clic). Les filtres posés par une AUTRE tuile ne sont jamais retirés par un clic ici.
  function sunburstFilterToggles(activeFilters, columns, values, tileId) {
    const filters = Array.isArray(activeFilters) ? activeFilters : [];
    const cols = columns || [];
    const vals = (values || []).map((v) => String(v));
    const eq = (f) => f.type == null || f.type === 'eq';
    const current = (col) => filters.find((f) => f.column === col);
    const wanted = vals.map((value, i) => ({ column: cols[i], value })).filter((w) => w.column);
    const already = (w) => { const existingFilter = current(w.column); return !!existingFilter && eq(existingFilter) && sameValue(existingFilter.value, w.value); };
    const deeper = cols.slice(wanted.length).map((col) => current(col)).filter((f) => f && f.sourceTileId === tileId);
    if (wanted.length && wanted.every(already) && !deeper.length) return wanted;
    const out = wanted.filter((w) => !already(w));
    deeper.forEach((f) => out.push({ column: f.column, value: f.value }));
    return out;
  }

  // Une part est-elle retenue par les filtres posés sur les colonnes de ses anneaux (la sienne et celles de ses parents) ? Un filtre sur un anneau
  // plus profond ne concerne pas ses parents (ils contiennent la part retenue) : `path` ne couvre que les anneaux jusqu'à la part.
  function sunburstNodeSelected(activeFilters, columns, path) {
    for (let i = 0; i < (path || []).length; i++) {
      const ringFilter = (activeFilters || []).find((x) => x.column === (columns || [])[i]);
      if (ringFilter && !filterSelects(ringFilter, path[i])) return false;
    }
    return true;
  }

  // --- Petits multiples (`tile.smallMultiples`, barres ou courbe avec une colonne Séries) -----------------------------------------
  // Au lieu de SUPERPOSER les séries (une couleur chacune sur un même graphique), un petit graphique par valeur de la colonne Séries, tous
  // sur la MÊME échelle (sans quoi un petit panneau ressemblerait à un grand) et sur les mêmes catégories. Les calculs sont ceux des séries
  // multiples (`computeSeriesGroups`/`assembleSeries`) : seul l'affichage change. Ni empilé, ni barres horizontales, ni ligne de repère,
  // ni étiquettes de valeur : un panneau est trop petit pour les porter (le formulaire les masque, le rendu les ignore).
  const SMALL_MULTIPLES_MAX = 12;
  function isSmallMultiplesTile(tile) { return !!tile && tile.smallMultiples === true && isSeriesTile(tile); }

  // Panneaux : une entrée par série (`[{name, values}]`, résultat d'`assembleSeries`), au plus `max` (SMALL_MULTIPLES_MAX par défaut) ;
  // `hidden` compte les suivantes, jamais perdues sans le dire.
  function smallMultiplesPanels(series, max) {
    const cap = Number.isInteger(max) && max > 0 ? max : SMALL_MULTIPLES_MAX;
    const list = Array.isArray(series) ? series : [];
    return { panels: list.slice(0, cap), hidden: Math.max(0, list.length - cap) };
  }

  // Grille de panneaux dans une zone de `width` x `height` pixels : `{ cols, rows, plotW, plotH, xs, ys, titleH }` où `xs[c]` est le bord
  // gauche de la colonne c et `ys[r]` le HAUT DE LA ZONE DE TRACÉ de la ligne r (le titre du panneau est au-dessus, sur `titleH`). `left` et
  // `bottom` réservent la place des graduations (axe des valeurs à gauche, des catégories sous la dernière ligne). Le nombre de colonnes est
  // celui qui donne la plus grande zone de tracé d'un rapport 1,6:1 (une grille de 4 panneaux dans une tuile de 270 x 180 px = 2 x 2 ; 12
  // panneaux = 4 x 3) ; à égalité, le moins de cases vides. Zone absente ou nulle : une grille carrée.
  function smallMultiplesGrid(count, width, height, opts) {
    const o = Object.assign({ left: 40, bottom: 20, right: 8, titleH: 16, gapX: 8, gapY: 10 }, opts);
    const n = Math.max(1, Math.floor(count) || 1);
    const build = (cols) => {
      const rows = Math.ceil(n / cols);
      const plotW = Math.max(1, (width - o.left - o.right - (cols - 1) * o.gapX) / cols);
      const plotH = Math.max(1, (height - o.bottom - rows * o.titleH - (rows - 1) * o.gapY) / rows);
      const xs = []; for (let colIndex = 0; colIndex < cols; colIndex++) xs.push(o.left + colIndex * (plotW + o.gapX));
      const ys = []; for (let r = 0; r < rows; r++) ys.push(r * (o.titleH + plotH + o.gapY) + o.titleH);
      return { cols, rows, plotW, plotH, xs, ys, titleH: o.titleH, empty: cols * rows - n };
    };
    let best = null;
    if (!(width > 0) || !(height > 0)) {
      const squareCols = Math.ceil(Math.sqrt(n));
      best = build(squareCols);
    } else {
      for (let cols = 1; cols <= n; cols++) {
        const g = build(cols);
        const score = Math.min(g.plotW / 1.6, g.plotH);
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && g.empty < best.empty)) best = Object.assign(g, { score });
      }
    }
    delete best.score; delete best.empty;
    return best;
  }

  // Échelle COMMUNE de tous les panneaux : de 0 (ou du plus bas négatif) au plus haut, bornes arrondies sur un pas rond (1, 2, 2,5 ou 5 x 10^n ;
  // le 2,5 seulement s'il tombe sur un entier) avec 2 à `maxIntervals` intervalles (4 par défaut). Parmi les pas possibles, celui qui
  // laisse l'échelle la plus SERRÉE (un maximum de 6 021 s'arrête à 7 500, pas à 10 000 : la plus haute barre remplit les quatre cinquièmes
  // du panneau), à égalité le plus grand pas (moins de traits). Valeurs vides, texte et booléens ignorés ; rien de fini : 0 à 1.
  function smallMultiplesRange(panels, maxIntervals) {
    const cap = Number.isInteger(maxIntervals) && maxIntervals >= 1 ? maxIntervals : 4;
    let lo = 0;
    let hi = 0;
    for (const panel of panels || []) {
      for (const v of (panel && panel.values) || []) {
        const n = finiteOrNull(typeof v === 'bigint' ? Number(v) : v);
        if (n === null) continue;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    if (hi === lo) return { min: 0, max: 1, step: 0.5 };
    const span = hi - lo;
    const e0 = Math.floor(Math.log10(span / cap));
    let best = null;
    for (let e = e0 - 1; e <= e0 + 1; e++) {
      for (const m of [1, 2, 2.5, 5, 10]) {
        const step = roundTo(m * Math.pow(10, e), 10);
        if (m === 2.5 && !Number.isInteger(step)) continue;
        const firstTick = Math.floor(lo / step + 1e-9);
        const lastTick = Math.ceil(hi / step - 1e-9);
        const intervals = lastTick - firstTick;
        if (intervals < Math.min(2, cap) || intervals > cap) continue; // au moins deux intervalles : une échelle « 0 et 100 » seule ne se lit pas
        const extent = intervals * step;
        if (!best || extent < best.extent - 1e-9 || (Math.abs(extent - best.extent) <= 1e-9 && step > best.step)) best = { extent, step, a: firstTick, b: lastTick };
      }
    }
    if (!best) { const step = niceStep(span / cap); return { min: roundTo(Math.floor(lo / step + 1e-9) * step, 10), max: roundTo(Math.ceil(hi / step - 1e-9) * step, 10), step }; }
    return { min: roundTo(best.a * best.step, 10), max: roundTo(best.b * best.step, 10), step: best.step };
  }

  // Lignes de `rows` rangées par valeur de `seriesColumn` : `[{ key, name, rows }]`. `name` est le

  return {
    calendarDays, isoDayShift, CALENDAR_MAX_DAYS, ganttTasks, ganttTicks, ganttLayout, GANTT_MAX_ROWS,
    GANTT_MAX_TICKS, sunburstLevels, sunburstTree, sunburstFilterToggles, sunburstNodeSelected,
    SUNBURST_MAX_LEVELS, SUNBURST_MAX_CHILDREN, isSmallMultiplesTile, smallMultiplesPanels, smallMultiplesGrid,
    smallMultiplesRange, SMALL_MULTIPLES_MAX, niceStep, histogramBins, histogramFilter, histogramBinIsActive,
    HISTOGRAM_MAX_BINS, boxStatsByGroup, quantileSorted, BOX_MAX_OUTLIERS, BOX_MIN_RELIABLE, BOX_MAX_GROUPS,
    sankeyFlows, topFlows, SANKEY_MAX_NODES, SANKEY_MAX_LINKS, HEAT_RAMPS, heatStops, heatColor, heatTextColor,
    heatRange, heatCellColors
  };
});
