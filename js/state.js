/*
 * État du dashboard : liste des tuiles configurées, filtre croisé actif, abonnement pub/sub.
 * Pur JS, pas de dépendance DOM/Grist — testable sous Node comme data.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.state = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createStore() {
    let rows = [];
    let tiles = []; // { id, type: 'bar'|'pie'|'kpi', title, dimension, measure, aggFn }
    let activeFilter = null; // { column, value, sourceTileId } | null
    const listeners = new Set();

    function getState() { return { rows, tiles, activeFilter }; }
    function notify() { listeners.forEach((fn) => fn(getState())); }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    function setRows(newRows) { rows = newRows || []; notify(); }
    function setTiles(newTiles) { tiles = newTiles || []; notify(); }
    function addTile(tile) { tiles = tiles.concat([tile]); notify(); }
    function removeTile(id) { tiles = tiles.filter((t) => t.id !== id); notify(); }

    // Clic sur une tuile : (dé)active un filtre croisé appliqué à toutes les AUTRES tuiles.
    // Cliquer deux fois sur le même segment retire le filtre (toggle), comme les slicers Power BI.
    function toggleFilter(column, value, sourceTileId) {
      if (activeFilter && activeFilter.column === column && activeFilter.value === value) {
        activeFilter = null;
      } else {
        activeFilter = { column, value, sourceTileId };
      }
      notify();
    }

    function clearFilter() { activeFilter = null; notify(); }

    return { getState, subscribe, setRows, setTiles, addTile, removeTile, toggleFilter, clearFilter };
  }

  return { createStore };
});
