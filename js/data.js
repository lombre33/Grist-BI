/*
 * Fonctions pures d'agrégation et de filtrage. Aucune dépendance au DOM ni à l'API Grist :
 * testables directement sous Node (voir dev-tests/test-data.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.data = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Colonnes que Grist ajoute lui-même à toute table (jamais demandées via AddColumn côté widget) et
  // que `fetchTable()` renvoie donc mêlées aux vraies colonnes du document : `manualSort` (position
  // flottante utilisée pour le glisser-déposer manuel des lignes) est de celles-là. [BUG RÉEL,
  // confirmé en conditions réelles Grist — voir TEST_PROTOCOL.md #19] Sans ce filtre, `manualSort`
  // apparaissait dans les sélecteurs Dimension/Mesure/Filtre du formulaire d'ajout de tuile, et s'y
  // retrouvait même pré-sélectionnée par défaut (1re colonne de la liste). Le mock `grist-stub.js` ne
  // la simulait pas, donc aucun test ne l'exerçait avant.
  const GRIST_TECHNICAL_COLUMNS = new Set(['manualSort']);

  // Une colonne Grist réellement typée `Date`/`DateTime` renvoie sa valeur, via `fetchTable()`, en
  // nombre de secondes depuis l'epoch UTC (minuit pour `Date`) — PAS la chaîne ISO 'AAAA-MM-JJ' que
  // ce widget écrit lui-même via AddRecord (voir js/demo-data.js:deriveDateColumn) et que le reste du
  // code (parseDateValue, inferColumnKind dans main.js) suppose partout en entrée. Sans conversion,
  // une vraie colonne Date (comme `Date` de BI_StressTest, `{id:'Date', type:'Date'}` dans
  // js/demo-data.js:COLUMNS_LARGE) serait classée "nombre" par inferColumnKind au lieu de "date" —
  // cassant silencieusement le drill-down hiérarchique automatique (js/main.js:withDateHierarchies)
  // et le sélecteur de colonne date des mesures façon DAX. [Point relevé le 29/09/2026 en vérifiant
  // le format réel de l'API Grist après la livraison du drill-down — voir HYPOTHESES.md : la
  // campagne en conditions réelles du 19/09/2026 n'avait testé ni le format Date, ni le format
  // Reference, seulement le round-trip volumétrique/l'idempotence/l'export.] Cette conversion ne
  // s'applique QUE si l'appelant connaît le type réel de la colonne (voir `dateColumnIds` plus bas) —
  // sans lecture de `_grist_Tables_column`, ce widget n'a cette information que pour les colonnes de
  // sa PROPRE table de travail (voir grist-api.js:loadOrCreateTable), jamais pour une table
  // quelconque choisie via le sélecteur de table (voir loadTable) : ce cas reste un point ouvert,
  // documenté dans HYPOTHESES.md plutôt que traité par une heuristique fragile sur la seule valeur.
  function epochSecondsToIsoDate(seconds) {
    const d = new Date(seconds * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // grist.docApi.fetchTable() renvoie un format colonnaire ({id:[...], ColA:[...], ...}) ;
  // grist.onRecords() renvoie déjà des objets-lignes. On garde ce convertisseur pour le premier cas
  // (utilisé par grist-api.js pour lire la table de config interne et la table de travail).
  // `dateColumnIds` (optionnel, tableau/Set d'id de colonnes) : voir epochSecondsToIsoDate ci-dessus —
  // seules ces colonnes voient leur valeur numérique convertie en chaîne ISO, jamais une conversion
  // globale par valeur (une vraie mesure numérique ne doit jamais être touchée).
  function tableToRows(table, dateColumnIds) {
    const keys = Object.keys(table || {}).filter((k) => k !== 'id' && !GRIST_TECHNICAL_COLUMNS.has(k));
    const dateKeys = dateColumnIds ? new Set(dateColumnIds) : null;
    const n = (table && table.id ? table.id.length : 0);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = { id: table.id[i] };
      for (const k of keys) {
        const v = table[k][i];
        row[k] = (dateKeys && dateKeys.has(k) && typeof v === 'number' && Number.isFinite(v))
          ? epochSecondsToIsoDate(v)
          : v;
      }
      rows.push(row);
    }
    return rows;
  }

  // `filters`: [{column, value}, ...] appliqués en ET (une ligne doit matcher TOUS les filtres).
  // Au plus un filtre par colonne dans l'usage réel (voir state.js:toggleFilter) mais cette
  // fonction ne le suppose pas — elle applique simplement tout ce qu'on lui passe.
  //
  // Comparaison en chaîne (sameValue) plutôt que ===: `value` vient souvent d'un clic ECharts
  // (`params.name`), TOUJOURS une chaîne même pour une dimension numérique (ex. Annee=2025) — une
  // comparaison stricte contre le nombre 2025 de la ligne échouerait alors silencieusement et
  // filtrerait toutes les lignes (vécu en pratique avec le drill-down par Année, pas théorique).
  function sameValue(a, b) { return String(a) === String(b); }

  // Parse une date au format ISO 'AAAA-MM-JJ' (seul format utilisé par ce POC, voir
  // GristBI.demoData:isoDate) en timestamp minuit UTC, ou `null` si la valeur n'est pas une date
  // valide dans ce format — plutôt que de tenter `new Date(x)` sur n'importe quelle chaîne, ce qui
  // accepterait aussi des formats ambigus (MM/JJ/AAAA vs JJ/MM/AAAA) selon le moteur JS.
  function parseDateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const t = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(t) ? t : null;
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Presets pour le filtre "dates relatives" (Roadmap Tier 1) : chacun calcule sa plage [début, fin]
  // en millisecondes à partir de `now` (paramètre plutôt que `Date.now()` en dur, pour rester
  // testable sous Node sans dépendre de l'horloge réelle). Bornes inclusives des deux côtés.
  const RELATIVE_DATE_PRESETS = {
    last7d: (now) => [now - 6 * MS_PER_DAY, now],
    last30d: (now) => [now - 29 * MS_PER_DAY, now],
    thisMonth: (now) => {
      const d = new Date(now);
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
      return [start, end];
    },
    thisYear: (now) => {
      const d = new Date(now);
      return [Date.UTC(d.getUTCFullYear(), 0, 1), Date.UTC(d.getUTCFullYear(), 11, 31)];
    },
    last12m: (now) => [now - 364 * MS_PER_DAY, now]
  };

  function relativeDateRange(preset, now) {
    const fn = RELATIVE_DATE_PRESETS[preset];
    return fn ? fn(now == null ? Date.now() : now) : null;
  }

  // Une ligne matche un filtre selon son `type` (par défaut 'eq', le comportement historique posé
  // par un clic ECharts — voir state.js:toggleFilter/drillInto). Chaque type ignore silencieusement
  // (ne matche jamais) une valeur qu'il ne sait pas interpréter (ex. 'range' sur une colonne texte)
  // plutôt que de lever une erreur — un mauvais choix de colonne dans le formulaire de filtre avancé
  // doit juste vider le résultat, pas casser le rendu du dashboard.
  function matchesFilter(rowValue, filter) {
    switch (filter.type) {
      case 'range': {
        // Une cellule vide n'est pas 0 (`Number(null)` et `Number('')` valent 0) : elle ne passe jamais une plage.
        if (rowValue == null || rowValue === '') return false;
        const num = Number(rowValue);
        if (!Number.isFinite(num)) return false;
        if (filter.min != null && num < filter.min) return false;
        // `maxExclusive` : borne haute EXCLUE (classe [a ; b[ d'un histogramme, voir histogramBins) — sans quoi une valeur
        // pile sur la borne appartiendrait aux deux classes voisines. Absent = borne incluse (filtres avancés).
        if (filter.max != null && (filter.maxExclusive ? num >= filter.max : num > filter.max)) return false;
        return true;
      }
      case 'dateRange': {
        const t = parseDateValue(rowValue);
        if (t == null) return false;
        if (filter.start && t < parseDateValue(filter.start)) return false;
        if (filter.end && t > parseDateValue(filter.end)) return false;
        return true;
      }
      case 'relativeDate': {
        const t = parseDateValue(rowValue);
        if (t == null) return false;
        const range = relativeDateRange(filter.preset, filter.now);
        return !!range && t >= range[0] && t <= range[1];
      }
      case 'contains':
        return String(rowValue).toLowerCase().includes(String(filter.query || '').toLowerCase());
      default: // 'eq'
        return sameValue(rowValue, filter.value);
    }
  }

  // Vrai si le filtre actif `filter` (croisé : égalité, ou plage posée par un histogramme) retient la valeur `value` d'une
  // catégorie : sert à estomper les catégories NON retenues. Pour l'égalité, c'est `sameValue` comme avant.
  function filterSelects(filter, value) {
    if (!filter) return false;
    return filter.type && filter.type !== 'eq' ? matchesFilter(value, filter) : sameValue(filter.value, value);
  }

  function applyFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter((row) => filters.every((f) => matchesFilter(row[f.column], f)));
  }

  const AGGREGATORS = {
    sum: (values) => values.reduce((acc, v) => acc + (Number(v) || 0), 0),
    avg: (values) => (values.length ? AGGREGATORS.sum(values) / values.length : 0),
    count: (values) => values.length,
    min: (values) => (values.length ? Math.min.apply(null, values.map(Number)) : 0),
    max: (values) => (values.length ? Math.max.apply(null, values.map(Number)) : 0)
  };

  // Regroupe `rows` par `dimensionCol` et agrège `measureCol` avec `aggFn` ("sum"|"avg"|"count"|"min"|"max").
  function groupByAggregate(rows, dimensionCol, measureCol, aggFn) {
    const groups = new Map();
    for (const row of rows) {
      const key = row[dimensionCol];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row[measureCol]);
    }
    // Ordre de première apparition dans `rows` (celui du Map), PAS un tri alphabétique : pour une
    // dimension comme "Mois", trier "Avril" < "Janvier" < "Mai" casserait l'ordre chronologique.
    // L'appelant qui veut un ordre précis (chronologique, custom...) doit trier `rows` en amont.
    const aggregator = AGGREGATORS[aggFn] || AGGREGATORS.sum;
    return Array.from(groups.entries())
      .map(([key, values]) => ({ dimension: key, value: aggregator(values) }));
  }

  function aggregateSingle(rows, measureCol, aggFn) {
    const aggregator = AGGREGATORS[aggFn] || AGGREGATORS.sum;
    return aggregator(rows.map((r) => r[measureCol]));
  }

  // Fréquence des mots d'une colonne texte pour la tuile "Nuage de mots" — deux modes
  // (`tile.wordCloudSplit`, voir js/main.js) :
  //  - `splitCells` falsy (défaut) : une entrée par ligne, la cellule entière est UN mot (ex. une
  //    colonne Auteurs où chaque ligne porte déjà un seul nom) — strictement équivalent à
  //    `groupByAggregate(rows, column, measureCol, aggFn)`, exposé ici pour que l'appelant n'ait
  //    pas à choisir entre deux fonctions selon le mode de la tuile.
  //  - `splitCells` vrai : la cellule est découpée en plusieurs mots (ex. une colonne Keywords
  //    "génétique, cohorte, adolescent") et chaque mot obtenu compte pour lui-même, cumulé sur
  //    TOUTES les lignes. `measureCol`/`aggFn` sont ignorés dans ce mode : pondérer un mot
  //    individuel par une mesure portée par sa ligne n'aurait pas de sens univoque dès qu'une
  //    cellule contient plusieurs mots — seul le compte d'occurrences est utilisé. Comptage
  //    insensible à la casse (une cellule "Santé" et une cellule "santé" sont le même mot), la
  //    graphie affichée est celle de la première occurrence rencontrée. Pas d'ordre de première
  //    apparition imposé ici (contrairement à `groupByAggregate`) : le rendu nuage de mots trie par
  //    fréquence, pas par ordre d'apparition — à la charge de l'appelant.
  function wordFrequency(rows, column, splitCells, measureCol, aggFn) {
    if (!splitCells) return groupByAggregate(rows, column, measureCol, aggFn);
    const counts = new Map(); // mot en minuscule -> { label, count }
    for (const row of (rows || [])) {
      const raw = row[column];
      if (raw == null || raw === '') continue;
      const tokens = String(raw).split(/[^\p{L}\p{N}'-]+/u).filter((w) => w.length >= 2);
      for (const token of tokens) {
        const key = token.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { label: token, count: 1 });
      }
    }
    return Array.from(counts.values()).map((e) => ({ dimension: e.label, value: e.count }));
  }

  // Tableau croisé dynamique : regroupe `rows` par DEUX dimensions (`rowDim` en lignes, `colDim` en
  // colonnes) plutôt qu'une seule (voir groupByAggregate) et agrège `measureCol` à chaque
  // intersection. `rowKeys`/`colKeys` dans l'ordre de première apparition (même convention que
  // groupByAggregate/distinctColumnValues, pas alphabétique). `cells[i][j]` vaut `null` (pas un 0)
  // quand aucune ligne ne correspond à cette intersection précise — distinction importante pour un
  // agrégat comme "moyenne" ou "min", où 0 serait une vraie valeur alors que `null` veut dire
  // "aucune donnée". Les totaux de ligne/colonne/général sont calculés en agrégeant DIRECTEMENT
  // l'ensemble des lignes concernées (ignorant l'autre dimension), PAS en recombinant les valeurs
  // déjà agrégées des cellules affichées : recombiner fonctionnerait pour "somme" mais serait FAUX
  // pour "moyenne"/"min"/"max" (la moyenne des moyennes par colonne n'est pas la moyenne globale de
  // la ligne dès que les colonnes n'ont pas le même nombre de lignes).
  function pivotTable(rows, rowDim, colDim, measureCol, aggFn) {
    const aggregator = AGGREGATORS[aggFn] || AGGREGATORS.sum;
    const rowKeys = [];
    const rowKeysSeen = new Set();
    const colKeys = [];
    const colKeysSeen = new Set();
    const cellValues = new Map(); // `${rowKey}\u0000${colKey}` -> [measureValue, ...]
    const rowValues = new Map(); // rowKey -> [measureValue, ...] (toutes colonnes confondues)
    const colValues = new Map(); // colKey -> [measureValue, ...] (toutes lignes confondues)
    const allValues = [];
    for (const row of rows) {
      const rk = row[rowDim];
      const ck = row[colDim];
      const v = row[measureCol];
      if (!rowKeysSeen.has(rk)) { rowKeysSeen.add(rk); rowKeys.push(rk); }
      if (!colKeysSeen.has(ck)) { colKeysSeen.add(ck); colKeys.push(ck); }
      const cellKey = rk + '\u0000' + ck;
      if (!cellValues.has(cellKey)) cellValues.set(cellKey, []);
      cellValues.get(cellKey).push(v);
      if (!rowValues.has(rk)) rowValues.set(rk, []);
      rowValues.get(rk).push(v);
      if (!colValues.has(ck)) colValues.set(ck, []);
      colValues.get(ck).push(v);
      allValues.push(v);
    }
    const cells = rowKeys.map((rk) => colKeys.map((ck) => {
      const values = cellValues.get(rk + '\u0000' + ck);
      return values ? aggregator(values) : null;
    }));
    const rowTotals = rowKeys.map((rk) => aggregator(rowValues.get(rk)));
    const colTotals = colKeys.map((ck) => aggregator(colValues.get(ck)));
    const grandTotal = aggregator(allValues);
    return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
  }

  // Valeurs distinctes (converties en chaîne) présentes dans `column`, dans l'ordre de première
  // apparition (même convention que groupByAggregate — pas de tri alphabétique, qui casserait un
  // ordre chronologique comme les mois). Sert à SUGGÉRER des valeurs dans la barre de filtres
  // avancés (voir js/main.js) : `null`/`undefined`/`''` ignorés (rien à suggérer), et un plafond
  // `max` pour rester utilisable même sur une colonne quasi unique (ex. Montant sur ~47 000 lignes)
  // sans construire une liste de dizaines de milliers d'entrées pour rien.
  function distinctColumnValues(rows, column, max) {
    const limit = max || 500;
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const v = row[column];
      if (v === null || v === undefined || v === '') continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Cœur de computeTrend, extrait pour être réutilisable sur un résultat de groupByAggregate déjà
  // obtenu PAR N'IMPORTE QUEL MOYEN (JS pur ci-dessous, ou DuckDB-WASM côté js/charts.js pour un
  // gros volume — voir computeGroupBy dans js/charts.js) : ne garde que les groupes dont la clé est
  // numérique (ex. Annee=2025/2026 ; une dimension texte comme "Mois" est ignorée plutôt que de
  // produire un delta absurde), et compare les deux plus grandes clés numériques trouvées. Retourne
  // null si la comparaison n'a pas de sens ici (moins de 2 groupes numériques présents - ex. déjà
  // filtré sur une seule période - ou groupe précédent nul).
  function trendFromGroups(groups) {
    const numericGroups = groups
      .map((g) => ({ key: Number(g.dimension), value: g.value }))
      .filter((g) => Number.isFinite(g.key))
      .sort((a, b) => b.key - a.key);
    if (numericGroups.length < 2) return null;
    const [latest, previous] = numericGroups;
    if (!previous.value) return null; // évite une division par zéro / un delta infini
    return {
      latestKey: latest.key,
      previousKey: previous.key,
      deltaPct: ((latest.value - previous.value) / previous.value) * 100
    };
  }

  // Tendance d'une carte KPI vs la période précédente : regroupe `rows` par `trendDimension` en JS
  // pur (voir trendFromGroups ci-dessus pour la logique de comparaison elle-même, partagée avec le
  // chemin DuckDB de js/charts.js pour un gros volume).
  function computeTrend(rows, trendDimension, measureCol, aggFn) {
    if (!trendDimension) return null;
    return trendFromGroups(groupByAggregate(rows, trendDimension, measureCol, aggFn));
  }

  // Libellé d'axe pour une période 'AAAA-MM-JJ' renvoyée par
  // GristBI.duckdbEngine.timeSeriesMeasures (toujours le 1er du mois, voir sa doc) : 'AAAA-MM'
  // seulement, format non ambigu/triable, sans dépendre d'une table de noms de mois localisés.
  function periodLabel(period) {
    return typeof period === 'string' ? period.slice(0, 7) : String(period);
  }

  // Transforme le résultat de GristBI.duckdbEngine.timeSeriesMeasures en catégories/séries
  // affichables, selon le mode choisi pour la tuile ('cumulative'/'ytd'/'yoy'). Pure (aucune
  // dépendance ECharts) pour rester testable sous Node comme le reste de ce module — charts.js ne
  // fait plus que mapper `series` sur des séries ECharts. 'yoy' (comparaison N-1) est la seule à
  // produire 2 séries ; `previousYear` peut contenir des `null` (pas de données l'année précédente
  // pour ce mois, voir timeSeriesMeasures) — laissés tels quels, ECharts affiche un trou plutôt
  // qu'un zéro trompeur.
  function measureSeriesForTile(measureMode, timeSeries) {
    const categories = timeSeries.map((r) => periodLabel(r.period));
    if (measureMode === 'ytd') {
      return { categories, series: [{ label: 'Cumul annuel (YTD)', data: timeSeries.map((r) => r.ytd) }] };
    }
    if (measureMode === 'yoy') {
      return {
        categories,
        series: [
          { label: 'Valeur', data: timeSeries.map((r) => r.value) },
          { label: 'N-1', data: timeSeries.map((r) => r.previousYear) }
        ]
      };
    }
    return { categories, series: [{ label: 'Cumul', data: timeSeries.map((r) => r.cumulative) }] }; // 'cumulative' par défaut
  }

  // Décompose un agrégat (même forme que groupByAggregate : [{dimension, value}, ...], DÉJÀ dans
  // l'ordre voulu — jamais retrié ici, voir piège n°14 CLAUDE.md §7) en 3 séries empilables pour
  // simuler une tuile "waterfall" avec 2 séries de barres ECharts (aucune série native pour ce
  // type, voir ROADMAP.md) : `base` (la partie du cumul déjà atteinte avant cette catégorie,
  // invisible à l'écran), `rise` (hauteur visible pour une valeur positive) et `fall` (hauteur
  // visible, toujours positive, pour une valeur négative — la couleur distingue hausse/baisse, pas
  // le signe de la donnée empilée). Pure/synchrone, testable sous Node (voir js/charts.js pour le
  // câblage ECharts, DOM-dépendant lui).
  function waterfallSeries(agg) {
    let running = 0;
    const base = [];
    const rise = [];
    const fall = [];
    agg.forEach((d) => {
      const start = running;
      const end = running + d.value;
      base.push(Math.min(start, end));
      rise.push(d.value >= 0 ? d.value : 0);
      fall.push(d.value < 0 ? -d.value : 0);
      running = end;
    });
    return { base, rise, fall };
  }

  // Tri d'AFFICHAGE optionnel d'un agrégat (`tile.sortMode`, voir js/main.js:updateFormFieldsForType),
  // pour les seuls types dont l'ordre des catégories n'a pas de sens propre : Barres (hors mode
  // mesure temporelle, dont l'axe est un mois calculé), Courbe/Aire, Camembert et Entonnoir. Jamais pour
  // Cascade (l'ordre EST le sens du cumul), Treemap, Radar ni Nuage de mots.
  // `groupByAggregate` garde son contrat (ordre d'apparition, piège n°14 CLAUDE.md §7) : le tri est
  // une étape SÉPARÉE appliquée après, jamais fusionnée dedans, et sans `sortMode` (ou avec une
  // valeur inconnue, ex. une tuile sauvegardée par une version future) l'agrégat revient inchangé.
  // Partagée par le rendu (js/charts.js) et l'export Excel (tileExportSheet) : ce qui est exporté
  // doit rester dans l'ordre affiché à l'écran.
  const SORT_MODES = ['value-desc', 'value-asc', 'label'];
  // Entonnoir : `sort: 'none'` côté ECharts (js/charts.js), c'est ce tri-ci qui décide de l'ordre des
  // étapes — « Ordre des données » reste donc possible pour un parcours dont les étapes sont déjà
  // rangées dans la table (Visite, Inscription, Achat).
  const SORTABLE_TILE_TYPES = ['bar', 'line', 'pie', 'funnel', 'combo'];

  function isSortableTile(tile) {
    if (!tile || SORTABLE_TILE_TYPES.indexOf(tile.type) === -1) return false;
    // Pareto : l'ordre est celui de la méthode (du plus grand au plus petit), jamais un réglage.
    if (tile.type === 'combo' && tile.comboMode === 'pareto') return false;
    return !(tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut');
  }

  function compareLabels(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) return a - b;
    // `numeric: true` : "2" avant "10", "T2" avant "T10" ; `sensitivity: 'base'` ignore casse/accents.
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function sortGroups(agg, mode) {
    if (SORT_MODES.indexOf(mode) === -1) return agg;
    const copy = agg.slice(); // jamais de tri en place : `agg` peut être réutilisé tel quel ailleurs
    if (mode === 'label') return copy.sort((x, y) => compareLabels(x.dimension, y.dimension));
    const direction = mode === 'value-desc' ? -1 : 1;
    const isMissing = (v) => v == null || Number.isNaN(v);
    return copy.sort((x, y) => {
      // Valeur absente (min/max sur un groupe sans valeur numérique) toujours en dernier, quel que
      // soit le sens du tri : ni "la plus grande" ni "la plus petite", juste sans valeur à comparer.
      if (isMissing(x.value) || isMissing(y.value)) return (isMissing(x.value) ? 1 : 0) - (isMissing(y.value) ? 1 : 0);
      return direction * (x.value - y.value);
    });
  }

  // --- Séries multiples (`tile.seriesColumn`, barres/courbe/aire) --------------------------------
  // Une série par valeur distincte de la colonne « Séries », sur le même axe des catégories
  // (`tile.dimension`). Trois étapes pures, séparées pour que le rendu puisse faire passer CHAQUE
  // série par DuckDB (js/charts.js:computeSeriesGroups) sans que ce fichier ne connaisse le moteur :
  // `splitBySeries` (une série par valeur, ordre de première apparition — piège n°14), puis un
  // `groupByAggregate` par série (JS ou DuckDB), puis `assembleSeries` qui aligne les séries sur les
  // catégories. La colonne « Séries » ne concerne que les barres (hors mode mesure temporelle) et la
  // courbe/aire : le camembert, le treemap, l'entonnoir… n'ont qu'UNE série par nature.
  function isSeriesTile(tile) {
    if (!tile || !tile.seriesColumn) return false;
    if (tile.type === 'line') return true;
    return tile.type === 'bar' && !(tile.measureMode && tile.measureMode !== 'brut');
  }

  // --- Combo barres + courbe (`type: 'combo'`, double axe) ---------------------------------------
  // Deux lectures d'une même catégorie : des barres (axe de gauche, `measure`/`aggFn`) et une courbe (axe de
  // droite). Deux modes :
  //   - 'measure' (défaut) : la courbe est une AUTRE mesure (`measureY`, `aggFnY`, par défaut l'agrégat des
  //     barres), p. ex. le montant en barres et le nombre de commandes en courbe ;
  //   - 'pareto' : barres triées du plus grand au plus petit, courbe = part CUMULÉE du total en % (0 à 100),
  //     qui répond à « quelles catégories font 80 % du total ? ». Pas de seconde mesure.
  // Fonctions pures : le rendu (js/charts.js) y passe des groupes obtenus par JS ou par DuckDB.
  function comboModeOf(tile) {
    return tile && tile.comboMode === 'pareto' ? 'pareto' : 'measure';
  }

  // `groups` = [{dimension, value}] dans l'ordre d'apparition. Rend les groupes TRIÉS par valeur décroissante
  // (copie, jamais en place) et la part cumulée de chacun en % du total. Une valeur négative ou absente compte
  // pour 0 : une part de total n'a de sens que pour des quantités positives. Total nul -> parts à 0, jamais NaN.
  // Le dernier point vaut 100 exactement (sinon 99,99999999999999 s'afficherait « 100,0 % » sans l'être).
  function paretoSeries(groups) {
    const sorted = sortGroups(groups || [], 'value-desc');
    const part = (d) => { const v = Number(d.value); return Number.isFinite(v) && v > 0 ? v : 0; };
    const total = sorted.reduce((sum, d) => sum + part(d), 0);
    let running = 0;
    const cumulative = sorted.map((d, i) => {
      running += part(d);
      if (!(total > 0)) return 0;
      return i === sorted.length - 1 ? 100 : (running * 100) / total;
    });
    return { groups: sorted, cumulative, total };
  }

  // Aligne la courbe sur les barres PAR NOM de catégorie (jamais par position : les deux agrégations peuvent ne
  // pas couvrir les mêmes catégories — DuckDB rend aussi des BigInt, d'où `String`). Rend ce que le rendu et
  // l'export affichent : `categories`, `bars`, `line` (null là où la courbe n'a pas de valeur : trou, jamais 0).
  function comboSeries(tile, groups, groupsY) {
    if (comboModeOf(tile) === 'pareto') {
      const p = paretoSeries(groups);
      return { mode: 'pareto', categories: p.groups.map((d) => d.dimension), bars: p.groups.map((d) => d.value), line: p.cumulative, total: p.total };
    }
    const byName = new Map((groupsY || []).map((d) => [String(d.dimension), d.value]));
    return {
      mode: 'measure',
      categories: groups.map((d) => d.dimension),
      bars: groups.map((d) => d.value),
      line: groups.map((d) => (byName.has(String(d.dimension)) ? byName.get(String(d.dimension)) : null)),
      total: null
    };
  }

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
    const f = raw / base;
    const nice = f < 1.5 ? 1 : (f < 3 ? 2 : (f < 7 ? 5 : 10));
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

  // --- Palettes de couleurs (`tile.palette`) -----------------------------------------------------
  // Six palettes au choix par tuile ; `standard` est la palette historique du tableau de bord (elle ne
  // change JAMAIS : une tuile sans `palette` doit rester identique). Toutes ont été passées au
  // validateur de la skill dataviz du projet, surface #fcfcfb ET #ffffff (HYPOTHESES.md) :
  //   - `standard` : 8 teintes catégorielles, CVD ΔE 9,1 entre voisines (cible >= 8) ;
  //   - `okabe`    : Okabe-Ito (conçue pour le daltonisme), 6 teintes DANS la bande de luminosité
  //     (le jaune et le noir de la palette d'origine en sortent), CVD ΔE 9,6 entre voisines ;
  //   - `blue`/`orange`/`green`/`gray` : dégradés d'UNE teinte, 7 pas du FONCÉ au CLAIR (la 1re
  //     série, ou l'unique couleur d'une barre simple, est la plus lisible), écart de luminosité
  //     >= 0,06 entre pas voisins, pas le plus clair >= 2:1 sur la surface. Pour des catégories
  //     ORDONNÉES (étapes, tranches d'âge, paliers) — pas pour des séries sans ordre.
  // Tableau trop court pour le nombre de séries/parts : ECharts reprend au début (js/advice.js le dit).
  const PALETTES = {
    standard: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    okabe: ['#0072b2', '#d55e00', '#009e73', '#e69f00', '#cc79a7', '#56b4e9'],
    blue: ['#002f63', '#004285', '#0856a6', '#236cc1', '#3f83d7', '#5d9be9', '#7db2f6'],
    orange: ['#511f00', '#6e2e01', '#8d3e03', '#ae4d05', '#d05e07', '#e47a3e', '#f49867'],
    green: ['#003c17', '#025222', '#04692e', '#04813a', '#2b974e', '#51ac69', '#75c186'],
    gray: ['#303030', '#434343', '#575757', '#6c6c6c', '#828282', '#989898', '#afafaf']
  };
  const PALETTE_KEYS = Object.keys(PALETTES);
  // Une clé inconnue (config d'une version future, tuile importée) retombe sur `standard` : jamais de
  // tuile sans couleur. `hasOwnProperty` : une clé comme « constructor » n'est pas une palette.
  function paletteColors(key) {
    return Object.prototype.hasOwnProperty.call(PALETTES, key) ? PALETTES[key] : PALETTES.standard;
  }
  // Types dont les couleurs viennent de la palette. Hors liste : la cascade (vert = hausse, rouge =
  // baisse : un sens, pas une identité), le KPI et le tableau croisé (aucune couleur de série).
  const PALETTE_TILE_TYPES = ['bar', 'line', 'pie', 'funnel', 'treemap', 'scatter', 'radar', 'gauge', 'wordcloud', 'combo', 'histogram'];
  function supportsPalette(tile) {
    return !!tile && PALETTE_TILE_TYPES.indexOf(tile.type) !== -1;
  }

  // Types qui AFFICHENT une valeur numérique (donc concernés par `tile.numberFormat`, voir js/format.js) :
  // tout type de tuile nouveau qui montre un nombre s'ajoute ici, pour que le champ « Format des nombres »
  // du panneau apparaisse. Le nuage de mots n'y est que pour la valeur de son infobulle ; la table plate l'applique à chacune de ses colonnes numériques (`format.cellNumber`).
  const NUMBER_FORMAT_TILE_TYPES = ['kpi', 'gauge', 'bar', 'line', 'pie', 'funnel', 'treemap', 'waterfall', 'radar', 'scatter', 'pivot', 'wordcloud', 'table', 'progress', 'combo', 'histogram'];
  function supportsNumberFormat(tile) {
    return !!tile && NUMBER_FORMAT_TILE_TYPES.indexOf(tile.type) !== -1;
  }

  // Empilé (`tile.stacked`) : séries superposées au lieu de côte à côte. Seulement avec une colonne
  // Séries, et pour les barres ou l'AIRE (courbe + `areaFill`) : une courbe sans remplissage empilée
  // serait une courbe cumulée — un autre graphique, que personne ne lit comme tel.
  function isStackedTile(tile) {
    if (!tile || !tile.stacked || !isSeriesTile(tile)) return false;
    return tile.type === 'bar' || (tile.type === 'line' && !!tile.areaFill);
  }

  // Lignes de `rows` rangées par valeur de `seriesColumn` : `[{ key, name, rows }]`. `name` est le
  // libellé affiché (la valeur en texte, ou `emptyLabel` pour une cellule vide).
  function splitBySeries(rows, seriesColumn, emptyLabel) {
    const bySeries = new Map();
    for (const row of rows) {
      const key = row[seriesColumn];
      if (!bySeries.has(key)) bySeries.set(key, []);
      bySeries.get(key).push(row);
    }
    return Array.from(bySeries.entries()).map(([key, groupRows]) => ({
      key,
      name: (key === null || key === undefined || key === '') ? (emptyLabel || '(vide)') : String(key),
      rows: groupRows
    }));
  }

  // Aligne les séries sur `categories` (les valeurs de la dimension, DÉJÀ dans l'ordre d'apparition
  // des lignes) : `perSeries` = `[{ name, groups }]` où `groups` est un `groupByAggregate` de CETTE
  // série. Une catégorie absente d'une série vaut `null` (un trou, jamais 0 : ce n'est pas la même
  // information). `sortMode` (même vocabulaire que sortGroups) trie les catégories sur le TOTAL de
  // leurs valeurs toutes séries confondues — pour une moyenne, c'est la somme des moyennes, un simple
  // critère d'ordre et non une valeur affichée. Rend `{ categories, series: [{ name, values }] }`.
  function assembleSeries(categories, perSeries, sortMode) {
    // Clés comparées en TEXTE (même règle que sameValue, piège n°7) : les catégories viennent du
    // groupement de TOUTES les lignes, les séries de celui de leurs lignes seules — or l'un peut passer
    // par DuckDB-WASM (au-delà de DUCKDB_ROW_THRESHOLD, js/charts.js) et l'autre par le JS pur, et
    // DuckDB rend une dimension entière (une année) en BigInt (2022n) là où le JS rend 2022 : un `Map`
    // comparant 2022n et 2022 ne les confond jamais, et toute la série tombait à « pas de valeur » (une
    // aire empilée par année plate à 0 sur un tableau de plus de 5 000 lignes). Un `null` garde sa
    // propre clé, jamais celle de la chaîne « null ».
    const keyOf = (v) => (v === null || v === undefined ? '\u0000' : String(v));
    const lookups = perSeries.map((s) => new Map(s.groups.map((g) => [keyOf(g.dimension), g.value])));
    let order = categories.map((_, i) => i);
    if (SORT_MODES.indexOf(sortMode) !== -1) {
      const totals = categories.map((category, index) => ({
        dimension: category,
        index,
        value: lookups.reduce((sum, lookup) => {
          const v = lookup.get(keyOf(category));
          return Number.isFinite(v) ? sum + v : sum;
        }, 0)
      }));
      order = sortGroups(totals, sortMode).map((g) => g.index);
    }
    return {
      categories: order.map((i) => categories[i]),
      series: perSeries.map((s, j) => ({
        name: s.name,
        values: order.map((i) => (lookups[j].has(keyOf(categories[i])) ? lookups[j].get(keyOf(categories[i])) : null))
      }))
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Niveaux de drill-down d'une tuile, au-delà de sa dimension racine (`tile.dimension`) : jusqu'à
  // 2 niveaux supplémentaires (`tile.drillDimensions`). Compatible avec l'ancien format à un seul
  // niveau (`tile.drillDimension`, une chaîne) pour ne pas faire disparaître silencieusement le
  // drill-down d'une tuile déjà sauvegardée par une version antérieure du widget.
  function tileDrillLevels(tile) {
    if (Array.isArray(tile.drillDimensions) && tile.drillDimensions.length) return tile.drillDimensions;
    if (tile.drillDimension) return [tile.drillDimension];
    return [];
  }

  // Dimension actuellement affichée par une tuile bar/pie/treemap/scatter : sa dimension racine si
  // `drillPath` est vide, sinon le niveau correspondant à la profondeur atteinte (voir
  // state.js:drillInto/drillUp). Partagée entre le rendu (charts.js) et l'export Excel
  // (buildWorkbookSheets ci-dessous) : les deux doivent afficher/exporter le même niveau de détail.
  function currentDimension(tile, drillPath) {
    if (!drillPath || !drillPath.length) return tile.dimension;
    const levels = tileDrillLevels(tile);
    return levels[drillPath.length - 1] || tile.dimension;
  }

  // Lignes visibles pour `tile` compte tenu de l'état interactif courant : filtres croisés posés
  // par les AUTRES tuiles (`tile` reste non filtrée sur SON PROPRE filtre pour rester cliquable sur
  // tous ses segments, voir charts.js), filtres avancés (s'appliquent à toutes les tuiles sans
  // exception), et son propre chemin de drill-down. Seule source de vérité pour cette composition de
  // filtres, réutilisée par charts.js (rendu) ET l'export Excel (buildWorkbookSheets) : ce que
  // l'utilisateur exporte doit correspondre exactement à ce qu'il voit à l'écran.
  function rowsForTile(tile, state) {
    const filtersFromOtherTiles = state.activeFilters.filter((f) => f.sourceTileId !== tile.id);
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    return applyFilters(state.rows, filtersFromOtherTiles.concat(state.advancedFilters || []).concat(drillPath));
  }

  // ---- Tuile Texte (type 'text') ----------------------------------------------------------------
  // Texte libre d'un tableau de bord : titre de section, consigne de lecture, source, date de mise à jour.
  // Aucune donnée, aucune mesure. SÉCURITÉ : ce widget a l'accès `full` au document, et le texte saisi par
  // une personne est relu et affiché chez chaque lecteur du tableau de bord — jamais d'HTML brut. Tout est
  // ÉCHAPPÉ d'abord (escapeHtml), puis seuls quatre repères simples deviennent des balises FIXES :
  // `# titre`, `## sous-titre`, `- élément de liste`, `**gras**`. Pas de lien (à vérifier d'abord dans le cadre
  // isolé de GFS, qui n'autorise que les scripts). Plafond de longueur : TEXT_TILE_MAX caractères.
  const TEXT_TILE_MAX = 2000;
  function textLines(text) {
    return String(text == null ? '' : text).slice(0, TEXT_TILE_MAX).replace(/\r\n?/g, '\n').split('\n');
  }
  function renderTextHtml(text) {
    const inline = (s) => escapeHtml(s).replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    const out = [];
    let para = [];
    let list = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list.length) { out.push('<ul>' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>'); list = []; } };
    textLines(text).forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) { flushPara(); flushList(); }
      else if ((m = /^(#{1,2})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const h = m[1].length + 2; out.push('<h' + h + '>' + inline(m[2]) + '</h' + h + '>'); }
      else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flushPara(); list.push(inline(m[1])); }
      else { flushList(); para.push(inline(line)); }
    });
    flushPara();
    flushList();
    return out.join('');
  }
  // Le même texte sans repères, pour les exports (PDF, PowerPoint, Excel).
  function plainTextOf(text) {
    return textLines(text)
      .map((l) => l.replace(/^\s*#{1,2}\s+/, '').replace(/^\s*[-*]\s+/, '• ').replace(/\*\*([^*]+?)\*\*/g, '$1'))
      .join('\n').trim();
  }

  // ---- Objectif et progression (carte KPI avec objectif, tuile « Progression ») ---------------------------------
  // Un objectif (valeur saisie `tile.target`, ou colonne `tile.targetColumn` agrégée comme la mesure) donne un
  // pourcentage atteint et un NIVEAU : `good` à partir de `goodPct`, `warn` à partir de `warnPct`, sinon `bad`
  // (seuils réglables par tuile, 90 % et 60 % par défaut). Pur JS : les couleurs sont dans css/style.css.
  const DEFAULT_GOOD_PCT = 90;
  const DEFAULT_WARN_PCT = 60;
  function finiteNumber(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // `pct` n'est pas plafonné (104 % se dit), `fill` l'est (la barre ne dépasse pas la piste). Un objectif nul,
  // négatif ou absent n'a pas de sens (division par zéro, « % atteint » inversé) : null.
  function targetProgress(value, target, goodPct, warnPct) {
    const v = finiteNumber(value);
    const g = finiteNumber(target);
    if (v == null || g == null || g <= 0) return null;
    const good = finiteNumber(goodPct) != null ? Number(goodPct) : DEFAULT_GOOD_PCT;
    const warn = finiteNumber(warnPct) != null ? Number(warnPct) : DEFAULT_WARN_PCT;
    const pct = (v * 100) / g; // v*100 d'abord : 58/100*100 vaut 57,99999999999999
    return { pct, fill: Math.min(1, Math.max(0, pct / 100)), level: pct >= good ? 'good' : (pct >= warn ? 'warn' : 'bad') };
  }
  // Une ligne par catégorie : valeur, objectif (de la colonne d'objectifs agrégée par catégorie, sinon la valeur
  // saisie, la même pour toutes), progression. `targetGroups` : mêmes catégories, agrégées sur la colonne d'objectifs.
  function progressRows(valueGroups, targetGroups, fixedTarget, goodPct, warnPct) {
    const byKey = new Map();
    (targetGroups || []).forEach((g) => byKey.set(String(g.dimension), g.value));
    return valueGroups.map((g) => {
      const target = targetGroups ? (byKey.has(String(g.dimension)) ? byKey.get(String(g.dimension)) : null) : fixedTarget;
      const prog = targetProgress(g.value, target, goodPct, warnPct);
      return { key: g.dimension, value: g.value, target: finiteNumber(target), pct: prog ? prog.pct : null, fill: prog ? prog.fill : 0, level: prog ? prog.level : null };
    });
  }

  // Courbe de tendance d'une carte KPI : valeurs des groupes de `trendDimension`, dans l'ordre croissant quand
  // TOUTES les clés sont numériques (années), sinon dans l'ordre d'apparition des données (mois, dates).
  function sparklineValues(groups) {
    const list = (groups || []).filter((g) => finiteNumber(g.value) != null);
    const numeric = list.length > 0 && list.every((g) => finiteNumber(g.dimension) != null);
    const ordered = numeric ? list.slice().sort((a, b) => Number(a.dimension) - Number(b.dimension)) : list;
    return ordered.map((g) => Number(g.value));
  }
  // Tracé SVG (viewBox 0 0 100 30) d'une série : `line`, `area` (fermée vers le bas), dernier point en % de la
  // largeur/hauteur (`last`, pour un point HTML qui ne se déforme pas avec `preserveAspectRatio="none"`).
  // Moins de deux valeurs : null. Série plate : trait au milieu.
  function sparklineGeometry(values, width, height, pad) {
    const w = width || 100;
    const h = height || 30;
    const p = pad == null ? 3 : pad;
    const vs = (values || []).filter((v) => Number.isFinite(v));
    if (vs.length < 2) return null;
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min;
    const pts = vs.map((v, i) => [
      (i / (vs.length - 1)) * w,
      span === 0 ? h / 2 : h - p - ((v - min) / span) * (h - 2 * p)
    ]);
    const r = (n) => Math.round(n * 100) / 100;
    const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${r(pt[0])} ${r(pt[1])}`).join(' ');
    const last = pts[pts.length - 1];
    return { line, area: `${line} L${w} ${h} L0 ${h} Z`, last: { x: r((last[0] / w) * 100), y: r((last[1] / h) * 100) } };
  }

  // ---- Table plate (type 'table') -----------------------------------------------------------------
  // Une liste de colonnes choisies (`tile.columns`, dans l'ordre voulu), une ligne par ligne de la table de
  // travail, après les filtres (mêmes lignes que le bouton « Détail », `rowsForTile`). Aucune agrégation : c'est
  // la donnée telle quelle. Pur JS ici ; le DOM (en-têtes triables, plafond d'affichage) est dans js/charts.js.
  const TABLE_TILE_MAX_ROWS = 500;        // lignes AFFICHÉES (un tableau HTML sans pagination au-delà ne se lit plus)
  const TABLE_EXPORT_MAX_ROWS = 100000;   // lignes d'une feuille Excel (la limite d'Excel est à 1 048 576)

  // Colonnes à afficher : celles de `tile.columns` qui existent encore dans les lignes (une colonne supprimée ou
  // renommée dans Grist ne casse pas la tuile, elle disparaît). Sans ligne, on ne peut rien vérifier : la liste
  // choisie est rendue telle quelle pour garder les en-têtes d'une table filtrée à vide.
  function tableColumnsOf(tile, rows) {
    const wanted = (tile && Array.isArray(tile.columns)) ? tile.columns.filter((c) => typeof c === 'string' && c) : [];
    if (!rows || !rows.length) return wanted;
    return wanted.filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
  }

  function isEmptyCell(v) { return v == null || v === ''; }

  // Texte d'une cellule NON numérique : vide pour null, liste de choix Grist (['L', 'a', 'b']) lue comme
  // « a, b », jamais « [object Object] ». Les nombres passent par GristBI.format (js/charts.js).
  function cellText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return (v[0] === 'L' ? v.slice(1) : v).map(cellText).join(', ');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } }
    return String(v);
  }

  // Ordre de deux cellules : nombres comme des nombres, le reste comme du texte avec les nombres « naturels »
  // (« Lot 2 » avant « Lot 10 »), sans tenir compte de la casse. Les dates `AAAA-MM-JJ` se trient telles quelles.
  function compareCells(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : (a > b ? 1 : 0);
    return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // Copie triée (le tableau d'origine, partagé avec toutes les tuiles, n'est jamais modifié). Les cellules vides
  // vont TOUJOURS à la fin, dans les deux sens. Tri stable. `dir` autre que 'asc'/'desc' : ordre d'origine.
  function sortRowsBy(rows, column, dir) {
    if (!column || (dir !== 'asc' && dir !== 'desc')) return rows;
    const sign = dir === 'desc' ? -1 : 1;
    return rows.slice().sort((r1, r2) => {
      const a = r1[column];
      const b = r2[column];
      const ae = isEmptyCell(a);
      const be = isEmptyCell(b);
      if (ae || be) return ae === be ? 0 : (ae ? 1 : -1);
      return sign * compareCells(a, b);
    });
  }

  // Déplace `id` de `delta` rangs (-1 = vers le haut) dans la liste ordonnée `order`, sans sortir de ses bornes.
  // Renvoie une copie ; une valeur absente ou un déplacement impossible rendent la même liste.
  function moveInOrder(order, id, delta) {
    const list = order.slice();
    const i = list.indexOf(id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= list.length) return list;
    list.splice(j, 0, list.splice(i, 1)[0]);
    return list;
  }

  // Cycle du clic sur un en-tête : croissant -> décroissant -> ordre d'origine.
  function nextSortDir(current) { return current === 'asc' ? 'desc' : (current === 'desc' ? null : 'asc'); }

  // Feuille d'export : mêmes colonnes et même ordre que la tuile, valeurs brutes (un nombre reste un nombre dans
  // Excel). `maxRows` borne la feuille (PDF et PowerPoint n'ont pas la place d'un classeur) ; `truncated` dit combien
  // de lignes ont été laissées de côté.
  function tableSheet(tile, rows, maxRows) {
    const columns = tableColumnsOf(tile, rows);
    const limit = Number.isFinite(maxRows) ? maxRows : TABLE_EXPORT_MAX_ROWS;
    const shown = rows.slice(0, limit);
    return {
      name: tile.title || 'Table',
      header: columns,
      rows: shown.map((r) => columns.map((c) => (typeof r[c] === 'number' || typeof r[c] === 'boolean' ? r[c] : cellText(r[c])))),
      truncated: Math.max(0, rows.length - shown.length)
    };
  }

  // Comment une tuile doit être représentée dans un export visuel (PDF/PPT, voir js/pdf-export.js) :
  // 'image' pour toute tuile rendue par une instance ECharts déjà en cache (bar y compris en mode
  // mesure DAX, pie, treemap, scatter, gauge — voir GristBI.charts.getInstance), capturée telle
  // qu'affichée à l'écran plutôt que recalculée (contourne le calcul ASYNCHRONE des mesures DAX,
  // contrairement à tileExportSheet qui doit s'en excuser explicitement pour rester synchrone) ;
  // 'table' pour le pivot (déjà une table HTML, pas de graphique) et le KPI (texte simple, pas de
  // graphique) — ces deux réutilisent directement tileExportSheet, déjà correct pour eux.
  function tileExportKind(tile) {
    if (tile.type === 'text') return 'text'; // ni graphique ni tableau : le texte lui-même
    return (tile.type === 'kpi' || tile.type === 'pivot' || tile.type === 'table' || tile.type === 'progress') ? 'table' : 'image';
  }

  // Représentation tabulaire d'une tuile pour l'export Excel : mêmes agrégats que le rendu
  // (aggregateSingle pour kpi/gauge, groupByAggregate pour bar/pie/treemap, les deux mesures pour
  // scatter), mais en lignes de tableau plutôt qu'en graphique. `header`/`rows` plutôt qu'un tableau
  // d'objets : contrôle explicite des en-têtes même quand `rows` est vide (aucune ligne visible
  // après filtrage), ce qu'un export à partir d'objets (`json_to_sheet([])` de SheetJS, par exemple) ne permettrait pas (pas d'en-tête sans
  // au moins un objet pour les déduire).
  function tileExportSheet(tile, state, maxRows) {
    // Tuile Texte : aucune donnée. Les classeurs Excel l'ignorent (voir buildWorkbookSheets), mais un appel
    // direct reste sûr plutôt que de produire « undefined(undefined) ».
    if (tile.type === 'text') return { name: tile.title || 'Texte', header: ['Texte'], rows: [[plainTextOf(tile.text)]] };
    const rows = rowsForTile(tile, state);
    if (tile.type === 'table') return tableSheet(tile, rows, maxRows);
    const title = tile.title || `${tile.aggFn}(${tile.measure})`;
    if (tile.type === 'progress') {
      const valueGroups = groupByAggregate(rows, tile.dimension, tile.measure, tile.aggFn);
      const targetGroups = tile.targetColumn ? groupByAggregate(rows, tile.dimension, tile.targetColumn, tile.aggFn) : null;
      return {
        name: title,
        header: [tile.dimension, 'Valeur', 'Objectif', '% de l’objectif'],
        rows: progressRows(valueGroups, targetGroups, tile.target, tile.goodPct, tile.warnPct)
          .map((r) => [r.key, r.value, r.target == null ? '' : r.target, r.pct == null ? '' : Math.round(r.pct * 10) / 10])
      };
    }
    if (tile.type === 'kpi' || tile.type === 'gauge') {
      const value = aggregateSingle(rows, tile.measure, tile.aggFn);
      const row = [`${tile.aggFn}(${tile.measure})`, value];
      // Carte KPI avec objectif : l'objectif et le % atteint suivent la valeur (rien de plus sans objectif).
      if (tile.type === 'kpi' && (tile.targetColumn || tile.target != null)) {
        const target = tile.targetColumn ? aggregateSingle(rows, tile.targetColumn, tile.aggFn) : tile.target;
        const prog = targetProgress(value, target, tile.goodPct, tile.warnPct);
        return { name: title, header: ['Mesure', 'Valeur', 'Objectif', '% de l’objectif'], rows: [row.concat([finiteNumber(target) == null ? '' : finiteNumber(target), prog ? Math.round(prog.pct * 10) / 10 : ''])] };
      }
      return { name: title, header: ['Mesure', 'Valeur'], rows: [row] };
    }
    if (tile.type === 'pivot') {
      // Même grille que le rendu (js/charts.js:renderPivot) : une ligne "Total" et une colonne
      // "Total" ajoutées à la fin, cellule vide (pas 0) quand pivotTable renvoie `null` (aucune
      // ligne à cette intersection) — cohérent avec l'affichage "–" du rendu.
      const pivot = pivotTable(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
      const header = [tile.dimension].concat(pivot.colKeys.map(String), ['Total']);
      const bodyRows = pivot.rowKeys.map((rk, i) => [rk]
        .concat(pivot.cells[i].map((v) => (v == null ? '' : v)))
        .concat([pivot.rowTotals[i]]));
      bodyRows.push(['Total'].concat(pivot.colTotals, [pivot.grandTotal]));
      return { name: title, header, rows: bodyRows };
    }
    // Mode de calcul temporel (voir GristBI.duckdbEngine.timeSeriesMeasures) : ce calcul est
    // ASYNCHRONE (une vraie requête SQL DuckDB-WASM), alors que cette fonction est volontairement
    // PURE/synchrone (testable sous Node, voir plus haut) — impossible de produire les vraies
    // valeurs Cumul/YTD/N-1 ici. Un appel direct et synchrone sur une tuile en mode mesure (plus
    // aucun dans ce dépôt depuis que `buildWorkbookSheetsAsync` ci-dessous gère ce cas à part, mais
    // gardé pour tout futur appelant direct) retombe donc sur ce texte explicite plutôt qu'un export
    // silencieusement incohérent (sans cette branche, `dimension` serait vide et produirait une
    // seule ligne "undefined" trompeuse au lieu des vraies valeurs affichées à l'écran).
    if (tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut') {
      return { name: title, header: ['Info'], rows: [['Export non disponible pour les tuiles avec un mode de calcul temporel (Cumul/YTD/N-1) — voir GristBI.data.buildWorkbookSheetsAsync.']] };
    }
    // Comparaison élève/moyenne du groupe filtré (tile.radarEntityColumn/radarEntityValue/
    // radarCompareAverage, voir js/charts.js) : lignes de l'entité choisie, calculées une seule fois
    // ici puisque les deux modes d'axes du radar ci-dessous en ont besoin. `null` (pas juste un
    // tableau vide) distingue "aucune comparaison choisie" de "comparaison choisie mais aucune ligne
    // ne correspond" (valeur orpheline après un changement de table) — dans les deux cas, pas de
    // 2e ligne, mais le sens diffère pour un futur lecteur de ce code.
    const radarEntityRows = (tile.type === 'radar' && tile.radarEntityColumn && tile.radarEntityValue)
      ? rows.filter((r) => sameValue(r[tile.radarEntityColumn], tile.radarEntityValue))
      : null;
    const hasRadarEntity = !!(radarEntityRows && radarEntityRows.length);
    // Radar "compétences en colonnes" (tile.radarAxisMode === 'columns', voir js/charts.js) : les
    // axes sont des colonnes choisies, pas une dimension catégorielle groupée — une colonne par axe.
    // AVANT `currentDimension` ci-dessous : un radar n'a jamais de drill-down (voir
    // supportsDrillDown côté js/main.js), donc `tile.dimension` resterait `undefined` dans ce mode.
    if (tile.type === 'radar' && tile.radarAxisMode === 'columns') {
      const axesColumns = (tile.radarAxes || []).filter(Boolean);
      // Sans comparaison : une seule ligne (la moyenne de chaque colonne sur `rows`), EXACTEMENT le
      // format du premier jet de ce mode (pas de colonne "Série" en plus) — comportement inchangé.
      if (!hasRadarEntity) {
        return { name: title, header: axesColumns, rows: [axesColumns.map((col) => aggregateSingle(rows, col, 'avg'))] };
      }
      const exportRows = [[String(tile.radarEntityValue)].concat(axesColumns.map((col) => aggregateSingle(radarEntityRows, col, 'avg')))];
      if (tile.radarCompareAverage) {
        exportRows.push(['Moyenne'].concat(axesColumns.map((col) => aggregateSingle(rows, col, 'avg'))));
      }
      return { name: title, header: ['Série'].concat(axesColumns), rows: exportRows };
    }
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    const dimension = currentDimension(tile, drillPath);
    if (tile.type === 'scatter') {
      const aggX = groupByAggregate(rows, dimension, tile.measure, tile.aggFn);
      const yByDimension = new Map(groupByAggregate(rows, dimension, tile.measureY, tile.aggFn).map((d) => [d.dimension, d.value]));
      return {
        name: title,
        header: [dimension, tile.measure, tile.measureY],
        rows: aggX.map((d) => [d.dimension, d.value, yByDimension.get(d.dimension)])
      };
    }
    // Radar "dimension" (classique) + comparaison active : même principe que ci-dessus, mais les
    // axes viennent du groupement par dimension plutôt que de colonnes choisies. `groupAgg` sert
    // deux fois (liste des axes ET valeurs de la série "Moyenne"), son ordre définissant celui des
    // deux — jamais recalculé séparément. Sans comparaison (`!hasRadarEntity`), tombe directement
    // dans la branche générique ci-dessous, comportement inchangé pour toute tuile radar classique.
    if (tile.type === 'radar' && hasRadarEntity) {
      const groupAgg = groupByAggregate(rows, dimension, tile.measure, tile.aggFn);
      const axisNames = groupAgg.map((d) => String(d.dimension));
      const entityByName = new Map(groupByAggregate(radarEntityRows, dimension, tile.measure, tile.aggFn).map((d) => [String(d.dimension), d.value]));
      const exportRows = [[String(tile.radarEntityValue)].concat(axisNames.map((name) => (entityByName.has(name) ? entityByName.get(name) : 0)))];
      if (tile.radarCompareAverage) {
        exportRows.push(['Moyenne'].concat(groupAgg.map((d) => d.value)));
      }
      return { name: title, header: ['Série'].concat(axisNames), rows: exportRows };
    }
    // Nuage de mots en mode "découpage de cellule" (tile.wordCloudSplit, voir js/charts.js) :
    // fréquence de mots, pas un groupement par dimension — `groupByAggregate` ci-dessous ne
    // conviendrait pas (il grouperait des cellules entières, jamais découpées). Trié par fréquence
    // décroissante pour l'export, comme le nuage de mots affiché à l'écran met en avant les mots les
    // plus fréquents en premier (pas un ordre de première apparition, qui n'aurait aucun sens ici).
    // En-tête 'Occurrences' en dur (pas de clé i18n) : même convention que 'Mesure'/'Valeur'/'Total'
    // plus haut dans cette fonction — contenu généré, hors périmètre i18n (voir js/i18n.js).
    if (tile.type === 'wordcloud' && tile.wordCloudSplit) {
      const freq = wordFrequency(rows, dimension, true).slice().sort((a, b) => b.value - a.value);
      return { name: title, header: [dimension, 'Occurrences'], rows: freq.map((d) => [d.dimension, d.value]) };
    }
    // Combo barres + courbe : le même alignement que le rendu (`comboSeries`), pour que le fichier montre ce qui
    // est affiché — barres, puis la 2e mesure OU la part cumulée en % (Pareto, en nombre de 0 à 100).
    if (tile.type === 'combo') {
      const barsAgg = groupByAggregate(rows, dimension, tile.measure, tile.aggFn);
      const lineAgg = comboModeOf(tile) === 'pareto' ? null : groupByAggregate(rows, dimension, tile.measureY, tile.aggFnY || tile.aggFn);
      const combo = comboSeries(tile, isSortableTile(tile) ? sortGroups(barsAgg, tile.sortMode) : barsAgg, lineAgg);
      const lineHeader = combo.mode === 'pareto' ? '% cumulé' : tile.measureY;
      return {
        name: title,
        header: [dimension, tile.measure, lineHeader],
        rows: combo.categories.map((c, i) => [c, combo.bars[i], combo.line[i] == null ? '' : combo.line[i]])
      };
    }
    // Histogramme : une ligne par classe (mêmes classes et mêmes comptes que l'écran). En-têtes en dur, comme les autres
    // exports (contenu généré, hors i18n) ; la borne haute est exclue sauf pour la dernière classe.
    if (tile.type === 'histogram') {
      const hist = histogramBins(state.rows, rows, tile.measure, tile.bins);
      return { name: title, header: [tile.measure + ' : borne basse', 'borne haute', 'Lignes'], rows: hist.bins.map((b) => [b.lo, b.hi, b.count]) };
    }
    // Séries multiples (barres/courbe/aire avec `seriesColumn`) : une colonne par série, dans le même
    // ordre de catégories que le rendu ; une cellule vide (pas 0) là où la série n'a aucune ligne.
    if (isSeriesTile(tile)) {
      const categories = groupByAggregate(rows, dimension, tile.measure, tile.aggFn).map((d) => d.dimension);
      const perSeries = splitBySeries(rows, tile.seriesColumn).map((sr) => ({
        name: sr.name, groups: groupByAggregate(sr.rows, dimension, tile.measure, tile.aggFn)
      }));
      const assembled = assembleSeries(categories, perSeries, tile.sortMode);
      return {
        name: title,
        header: [dimension].concat(assembled.series.map((sr) => sr.name)),
        rows: assembled.categories.map((c, i) => [c].concat(assembled.series.map((sr) => (sr.values[i] == null ? '' : sr.values[i]))))
      };
    }
    // Même tri que le rendu (js/charts.js:renderChart) : jamais appliqué à un type non triable.
    const agg = sortGroups(groupByAggregate(rows, dimension, tile.measure, tile.aggFn), isSortableTile(tile) ? tile.sortMode : undefined);
    return { name: title, header: [dimension, tile.measure], rows: agg.map((d) => [d.dimension, d.value]) };
  }

  // Un nom de feuille Excel ne peut pas dépasser 31 caractères, ne peut pas contenir
  // `: \ / ? * [ ]`, ne peut ni commencer ni finir par une apostrophe, ne peut pas être « History »
  // (réservé) et doit être unique dans le classeur SANS tenir compte des majuscules (« Ventes » et
  // « ventes » sont le même nom pour Excel ; ExcelJS lève une erreur sinon, et SheetJS le faisait
  // déjà). Deux tuiles peuvent avoir le même titre. `usedNames` est un Set mutable rempli au fil des
  // appels (un par tuile exportée) pour garantir l'unicité sur tout le classeur, pas seulement dans
  // une page.
  const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;
  function sheetNameBase(name) {
    const cleaned = String(name || 'Feuille').replace(INVALID_SHEET_CHARS, ' ').trim().replace(/^'+/, '').trim();
    // Couper à 31 peut laisser une apostrophe ou une espace en bout : nettoyer APRÈS la coupe.
    return (cleaned.slice(0, 31).replace(/'+$/, '').trim()) || 'Feuille';
  }
  function sanitizeSheetName(name, usedNames) {
    const base = sheetNameBase(name);
    const taken = (candidate) => {
      const key = candidate.toLowerCase();
      if (key === 'history') return true;
      for (const used of usedNames) if (used.toLowerCase() === key) return true;
      return false;
    };
    let candidate = base;
    let n = 2;
    while (taken(candidate)) {
      const suffix = ` (${n})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
      n++;
    }
    usedNames.add(candidate);
    return candidate;
  }

  // Une feuille par tuile, toutes pages confondues (pas seulement la page courante : exporter le
  // dashboard entier, pas juste ce qui est affiché à l'écran à cet instant précis). Le nom de page
  // préfixe le titre de la tuile seulement s'il y a plusieurs pages (sinon inutile, voir
  // sanitizeSheetName pour la troncature/l'unicité qui s'appliquent après ce préfixage).
  function buildWorkbookSheets(state) {
    const usedNames = new Set();
    const sheets = [];
    const multiPage = state.pages.length > 1;
    for (const page of state.pages) {
      for (const tile of page.tiles) {
        if (tile.type === 'text') continue; // une note n'est pas une donnée : pas de feuille Excel
        const sheet = tileExportSheet(tile, state);
        const label = multiPage ? `${page.name} - ${sheet.name}` : sheet.name;
        sheets.push({ name: sanitizeSheetName(label, usedNames), header: sheet.header, rows: sheet.rows });
      }
    }
    return sheets;
  }

  // Variante async de tileExportSheet, pour UNE tuile Barres en mode de calcul temporel
  // (Cumul/YTD/N-1) : contrairement au reste de ce fichier (volontairement pur/synchrone), ce cas
  // a besoin d'une vraie requête SQL DuckDB-WASM (voir GristBI.duckdbEngine.timeSeriesMeasures) —
  // c'était la limite assumée documentée plus haut (tileExportSheet renvoyait un texte explicite à
  // la place des valeurs). `computeMeasureSeries(tile, rows)` est INJECTÉ par l'appelant (voir
  // buildWorkbookSheetsAsync ci-dessous) plutôt qu'importé directement ici : ce module reste sans
  // dépendance à un autre module GristBI (voir l'en-tête de ce fichier), donc testable sous Node
  // avec une fonction de calcul factice (voir dev-tests/test-data.js), au lieu d'exiger un vrai
  // navigateur pour tester la composition header/rows elle-même. Même mise en forme que
  // measureSeriesForTile/renderMeasureChart (js/charts.js) : une colonne "Période" puis une colonne
  // par série (Cumul, ou Valeur+N-1 pour 'yoy'), valeur manquante (N-1 sans donnée) en chaîne vide
  // plutôt que `null` dans la cellule Excel — même convention que pivotTable/tileExportSheet
  // ci-dessus pour "aucune donnée". Un échec du calcul (DuckDB indisponible, erreur SQL) retombe
  // sur un message explicite PAR TUILE plutôt que de faire échouer tout le classeur — les autres
  // feuilles du classeur restent exportées normalement.
  async function measureExportSheet(tile, state, computeMeasureSeries) {
    const rows = rowsForTile(tile, state);
    const title = tile.title || `${tile.aggFn}(${tile.measure})`;
    try {
      const timeSeries = await computeMeasureSeries(tile, rows);
      const { categories, series } = measureSeriesForTile(tile.measureMode, timeSeries);
      const header = ['Période'].concat(series.map((s) => s.label));
      const bodyRows = categories.map((cat, i) => [cat].concat(series.map((s) => (s.data[i] == null ? '' : s.data[i]))));
      return { name: title, header, rows: bodyRows };
    } catch (e) {
      return { name: title, header: ['Info'], rows: [['Échec du calcul de la mesure temporelle (Cumul/YTD/N-1) — voir la console du navigateur.']] };
    }
  }

  // Variante async de buildWorkbookSheets : même composition (une feuille par tuile, toutes pages
  // confondues, même préfixage/troncature de nom via sanitizeSheetName), mais route une tuile
  // Barres en mode de calcul temporel vers measureExportSheet (ci-dessus) au lieu du texte
  // explicite de tileExportSheet — c'est la fonction que js/export.js doit appeler pour que
  // l'export Excel contienne les vraies valeurs Cumul/YTD/N-1, pas seulement un message.
  // `computeMeasureSeries` (même contrat que pour measureExportSheet) n'est appelé QUE pour les
  // tuiles qui en ont réellement besoin — toutes les autres tuiles restent calculées de façon pure
  // et synchrone via tileExportSheet, aucun changement de comportement pour elles.
  async function buildWorkbookSheetsAsync(state, computeMeasureSeries) {
    const usedNames = new Set();
    const sheets = [];
    const multiPage = state.pages.length > 1;
    for (const page of state.pages) {
      for (const tile of page.tiles) {
        if (tile.type === 'text') continue; // idem buildWorkbookSheets
        const isTemporalMeasure = tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut';
        const sheet = isTemporalMeasure
          ? await measureExportSheet(tile, state, computeMeasureSeries)
          : tileExportSheet(tile, state);
        const label = multiPage ? `${page.name} - ${sheet.name}` : sheet.name;
        sheets.push({ name: sanitizeSheetName(label, usedNames), header: sheet.header, rows: sheet.rows });
      }
    }
    return sheets;
  }

  // Data blending multi-tables (ROADMAP.md Tier 2) : LEFT JOIN en JS pur entre `primaryRows` (table
  // de travail courante) et `secondaryRows` (table secondaire choisie via le sélecteur, voir
  // js/main.js), sur `primaryJoinCol`/`secondaryJoinCol`. Chaque colonne de la table secondaire est
  // reportée préfixée `${secondaryTableId}.` pour ne jamais entrer en collision avec une colonne de
  // la table principale (même homonyme). En JS pur plutôt que via DuckDB-WASM
  // (js/duckdb-engine.js) : un enrichissement de lignes avant tout calcul n'est pas une agrégation —
  // pas de coût de chargement WASM à payer pour ça, et ça reste testable sous Node comme le reste de
  // ce fichier (voir dev-tests/test-data.js).
  //
  // Comparaison de clé via `sameValue` (String(a) === String(b), voir plus haut) : même
  // justification que pour un clic ECharts — une clé de jointure numérique côté Grist (ex. un
  // identifiant) peut arriver en nombre d'un côté et en chaîne de l'autre.
  //
  // Toute ligne principale garde EXACTEMENT le même jeu de colonnes secondaires que les autres,
  // qu'une correspondance ait été trouvée ou non (valeurs à `null` sinon) : `availableColumns()`
  // (js/main.js) ne lit que `rows[0]` pour peupler les sélecteurs de colonne, donc une forme de
  // ligne qui varierait selon le résultat du match rendrait les colonnes secondaires invisibles dès
  // que la toute première ligne ne matche pas.
  function blendRows(primaryRows, secondaryRows, primaryJoinCol, secondaryJoinCol, secondaryTableId) {
    const secondaryCols = (secondaryRows && secondaryRows.length)
      ? Object.keys(secondaryRows[0]).filter((k) => k !== 'id')
      : [];
    const bySecondaryKey = new Map();
    // Dernière ligne gagne en cas de clé dupliquée côté secondaire (LEFT JOIN 1-n non géré ici :
    // limite connue documentée dans HYPOTHESES.md — un vrai blending 1-n demanderait d'agréger la
    // table secondaire au préalable, hors périmètre de ce premier jet).
    (secondaryRows || []).forEach((row) => { bySecondaryKey.set(String(row[secondaryJoinCol]), row); });
    return (primaryRows || []).map((row) => {
      const match = bySecondaryKey.get(String(row[primaryJoinCol]));
      const merged = Object.assign({}, row);
      secondaryCols.forEach((col) => { merged[`${secondaryTableId}.${col}`] = match ? match[col] : null; });
      return merged;
    });
  }

  // Drill-down hiérarchique automatique (ROADMAP.md Tier 2) : dérive Année/Trimestre/Mois à partir
  // d'UNE colonne Date déjà présente dans les lignes (`dateColumn`, format AAAA-MM-JJ, voir
  // `parseDateValue`). Le niveau "Jour" n'est PAS dérivé séparément — la colonne Date d'origine
  // (déjà une chaîne unique par jour) sert elle-même de dernier niveau, voir js/main.js
  // (suggestion de hiérarchie sur le formulaire de tuile, jamais silencieuse : ROADMAP.md dit
  // explicitement "reste une suggestion à confirmer").
  //
  // Trimestre/Mois en `T1`.."T4"/`01`.."12", SANS préfixer l'année : une fois drillé dans une Année
  // donnée, `GristBI.data.rowsForTile` a déjà filtré les lignes sur cette année (chaque niveau du
  // chemin de drill s'applique en filtre AND, voir `rowsForTile`/`drillInto` dans js/state.js) —
  // `T1`/`01` restent donc sans ambiguïté au niveau où ils sont group-by, pas besoin d'un préfixe
  // qui alourdirait l'affichage.
  //
  // Colonnes dérivées TOUJOURS EN PLUS de `dateColumn` (jamais un remplacement), nommées
  // `${dateColumn}.Annee`/`.Trimestre`/`.Mois` (même convention de préfixe que `blendRows` pour les
  // colonnes secondaires) : une ligne dont `dateColumn` ne parse pas comme date reçoit `null` pour
  // les 3, jamais une clé absente (même raison que `blendRows` : `availableColumns()`, js/main.js,
  // ne lit que `rows[0]` pour peupler les sélecteurs de colonne).
  //
  // Pas de niveau "Pays > Région > Ville" ou autre hiérarchie non temporelle : ROADMAP.md le dit
  // explicitement non fiable sans un type Grist dédié, contrairement à une colonne Date — resterait
  // une pure suggestion de nom de colonne à deviner, hors périmètre de ce premier jet.
  function deriveDateHierarchyColumns(rows, dateColumn) {
    const anneeKey = `${dateColumn}.Annee`;
    const trimestreKey = `${dateColumn}.Trimestre`;
    const moisKey = `${dateColumn}.Mois`;
    return (rows || []).map((row) => {
      const ms = parseDateValue(row[dateColumn]);
      if (ms == null) return Object.assign({}, row, { [anneeKey]: null, [trimestreKey]: null, [moisKey]: null });
      const d = new Date(ms);
      const month = d.getUTCMonth(); // 0-11
      return Object.assign({}, row, {
        [anneeKey]: d.getUTCFullYear(),
        [trimestreKey]: `T${Math.floor(month / 3) + 1}`,
        [moisKey]: String(month + 1).padStart(2, '0')
      });
    });
  }

  // Commentaires d'une tuile donnée (comparaison sur `TileId`, pas `TableId` : les id de tuile
  // sont déjà globalement uniques dans ce widget — voir `Date.now()`+aléatoire en js/main.js —
  // donc pas besoin de connaître la table de travail courante pour filtrer). Triés du plus ancien
  // au plus récent : `fetchTable` ne garantit pas de renvoyer les lignes dans l'ordre d'insertion
  // (même prudence que pour `groupByAggregate`, voir CLAUDE.md §7 piège n°14) — `CreatedAt` est un
  // ISO 8601, donc comparable directement en chaîne.
  function commentsForTile(comments, tileId) {
    return (comments || [])
      .filter((c) => c.TileId === tileId)
      .slice()
      .sort((a, b) => (a.CreatedAt < b.CreatedAt ? -1 : a.CreatedAt > b.CreatedAt ? 1 : 0));
  }

  // Consigne GFS 012 : une fois « Partager » activé sur `BI_Dashboard_Config` (la table que le
  // manifeste de ce widget déclare comme ses « fichiers »), Grist refuse l'`UpdateRecord`/
  // `AddRecord` d'une ligne que la personne ne fait que lire, avec un message dont le texte réel
  // contient toujours « access rules » (ex. « Blocked by row update access rules »). Détecté ici
  // en JS pur, testable sous Node (voir dev-tests/test-data.js), pour que `js/main.js` distingue ce
  // refus précis — qui ne se corrigera jamais tout seul (jamais de réessai) — d'un échec réseau
  // quelconque, et le dise clairement plutôt que de laisser la sauvegarde disparaître en silence
  // dans la seule console (voir js/main.js:runPendingSave).
  function isAccessRuleRefusal(error) {
    const text = (error && typeof error.message === 'string') ? error.message : String(error || '');
    return /blocked by[^]*access rules/i.test(text);
  }

  // Un module ES « optionnel » (d3-cloud, pas encore fourni par GFS) est-il déclaré dans l'`importmap` de la page ? `text` est le
  // contenu JSON de la balise `<script type="importmap">`. Sans entrée, `import('d3-cloud')` est rejeté sur-le-champ par le
  // navigateur (spécificateur non résolu) : la réponse est donc la même que celle de l'import, sans le tenter ni toucher au réseau.
  // Illisible/absent -> false (jamais d'exception : appelé au dessin d'une carte).
  function importMapHas(text, specifier) {
    try {
      const map = JSON.parse(text);
      const imports = map && map.imports;
      return Boolean(imports && typeof imports === 'object' && typeof imports[specifier] === 'string' && imports[specifier]);
    } catch (e) {
      return false;
    }
  }

  return {
    importMapHas, tableToRows, epochSecondsToIsoDate, applyFilters, matchesFilter, sameValue, parseDateValue,
    relativeDateRange, RELATIVE_DATE_PRESETS, groupByAggregate, aggregateSingle, wordFrequency, pivotTable,
    distinctColumnValues, computeTrend, trendFromGroups, periodLabel, measureSeriesForTile,
    waterfallSeries, sortGroups, isSortableTile, isSeriesTile, comboModeOf, paretoSeries, comboSeries, niceStep, histogramBins, histogramFilter, histogramBinIsActive, HISTOGRAM_MAX_BINS, filterSelects, isStackedTile, splitBySeries, assembleSeries, PALETTES, PALETTE_KEYS, paletteColors, supportsPalette, supportsNumberFormat, NUMBER_FORMAT_TILE_TYPES, escapeHtml,
    tileDrillLevels, currentDimension, rowsForTile, tileExportSheet, tileExportKind, renderTextHtml, plainTextOf, TEXT_TILE_MAX,
    DEFAULT_GOOD_PCT, DEFAULT_WARN_PCT, targetProgress, progressRows, sparklineValues, sparklineGeometry,
    TABLE_TILE_MAX_ROWS, TABLE_EXPORT_MAX_ROWS, tableColumnsOf, cellText, compareCells, sortRowsBy, moveInOrder, nextSortDir, tableSheet,
    sanitizeSheetName, buildWorkbookSheets, measureExportSheet, buildWorkbookSheetsAsync,
    blendRows, deriveDateHierarchyColumns, commentsForTile, isAccessRuleRefusal, AGGREGATORS
  };
});
