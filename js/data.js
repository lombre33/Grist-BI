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

  // grist.docApi.fetchTable() renvoie un format colonnaire ({id:[...], ColA:[...], ...}) ;
  // grist.onRecords() renvoie déjà des objets-lignes. On garde ce convertisseur pour le premier cas
  // (utilisé par grist-api.js pour lire la table de config interne).
  function tableToRows(table) {
    const keys = Object.keys(table || {}).filter((k) => k !== 'id');
    const n = (table && table.id ? table.id.length : 0);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = { id: table.id[i] };
      for (const k of keys) row[k] = table[k][i];
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

  function applyFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter((row) => filters.every((f) => sameValue(row[f.column], f.value)));
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

  // Tendance d'une carte KPI vs la période précédente : regroupe `rows` par `trendDimension`, ne
  // garde que les groupes dont la clé est numérique (ex. Annee=2025/2026 ; une dimension texte
  // comme "Mois" est ignorée plutôt que de produire un delta absurde), et compare les deux plus
  // grandes clés numériques trouvées. Retourne null si la comparaison n'a pas de sens ici (moins de
  // 2 groupes numériques présents - ex. déjà filtré sur une seule période - ou groupe précédent nul).
  function computeTrend(rows, trendDimension, measureCol, aggFn) {
    if (!trendDimension) return null;
    const groups = groupByAggregate(rows, trendDimension, measureCol, aggFn)
      .map((g) => ({ key: Number(g.dimension), value: g.value }))
      .filter((g) => Number.isFinite(g.key))
      .sort((a, b) => b.key - a.key);
    if (groups.length < 2) return null;
    const [latest, previous] = groups;
    if (!previous.value) return null; // évite une division par zéro / un delta infini
    return {
      latestKey: latest.key,
      previousKey: previous.key,
      deltaPct: ((latest.value - previous.value) / previous.value) * 100
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

  return {
    tableToRows, applyFilters, sameValue, groupByAggregate, aggregateSingle, computeTrend,
    escapeHtml, tileDrillLevels, AGGREGATORS
  };
});
