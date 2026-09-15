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

  function applyFilter(rows, filter) {
    if (!filter) return rows;
    return rows.filter((r) => r[filter.column] === filter.value);
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

  return { tableToRows, applyFilter, groupByAggregate, aggregateSingle, AGGREGATORS };
});
