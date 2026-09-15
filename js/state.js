/*
 * État du dashboard : liste des tuiles configurées, filtres croisés actifs, état de drill-down
 * par tuile, abonnement pub/sub. Pur JS, pas de dépendance DOM/Grist — testable sous Node comme
 * data.js.
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
    let tiles = []; // { id, type: 'bar'|'pie'|'kpi', title, dimension, measure, aggFn, drillDimension?, trendDimension? }
    let activeFilters = []; // [{ column, value, sourceTileId }, ...] — au plus un filtre par colonne
    let drillIns = {}; // tileId -> { column, value } | absent (absent = niveau racine, pas drillé)
    let bookmarks = []; // [{ id, name, activeFilters, drillIns }, ...] — vues sauvegardées (voir saveBookmark)
    const listeners = new Set();

    function getState() { return { rows, tiles, activeFilters, drillIns, bookmarks }; }
    function notify() { listeners.forEach((fn) => fn(getState())); }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    function setRows(newRows) { rows = newRows || []; notify(); }
    function setTiles(newTiles) { tiles = newTiles || []; notify(); }
    function addTile(tile) { tiles = tiles.concat([tile]); notify(); }

    function removeTile(id) {
      tiles = tiles.filter((t) => t.id !== id);
      if (id in drillIns) { drillIns = Object.assign({}, drillIns); delete drillIns[id]; }
      notify();
    }

    // Remplace une tuile existante en place (même id, mêmes voisines) plutôt que
    // supprimer+ajouter : garde sa position dans la grille.
    function updateTile(id, patch) {
      tiles = tiles.map((t) => (t.id === id ? Object.assign({}, t, patch) : t));
      notify();
    }

    // Déplace une tuile d'un cran (direction: -1 = plus tôt, +1 = plus tard) dans l'ordre
    // d'affichage. No-op silencieux si déjà en bout de liste (les boutons ◂/▸ sont désactivés côté
    // UI dans ce cas, mais la fonction reste sûre si appelée directement).
    function moveTile(id, direction) {
      const idx = tiles.findIndex((t) => t.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= tiles.length) return;
      const next = tiles.slice();
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      tiles = next;
      notify();
    }

    // Clic sur un segment : (dé)active un filtre croisé sur sa colonne, appliqué à toutes les
    // AUTRES tuiles (voir charts.js). Reclic sur le même segment = retire ce filtre. Clic sur un
    // autre segment de la MÊME colonne = le remplace (un seul filtre par colonne : cliquer une
    // autre valeur d'une dimension n'a pas de sens en cumulé). Clic sur une colonne DIFFÉRENTE =
    // s'ajoute aux filtres déjà actifs (cumul façon slicers Power BI).
    function toggleFilter(column, value, sourceTileId) {
      const idx = activeFilters.findIndex((f) => f.column === column);
      if (idx >= 0 && activeFilters[idx].value === value) {
        activeFilters = activeFilters.filter((_, i) => i !== idx);
      } else if (idx >= 0) {
        activeFilters = activeFilters.map((f, i) => (i === idx ? { column, value, sourceTileId } : f));
      } else {
        activeFilters = activeFilters.concat([{ column, value, sourceTileId }]);
      }
      notify();
    }

    // Sans argument : efface tous les filtres. Avec une colonne : efface seulement celui-là.
    function clearFilter(column) {
      activeFilters = column ? activeFilters.filter((f) => f.column !== column) : [];
      notify();
    }

    // Drill-down : approfondit une tuile qui déclare un `drillDimension` sur la valeur cliquée au
    // niveau racine. Un seul niveau de profondeur (pas de hiérarchie arbitraire - hors scope, voir
    // HYPOTHESES.md).
    function drillInto(tileId, column, value) {
      drillIns = Object.assign({}, drillIns, { [tileId]: { column, value } });
      notify();
    }

    function drillUp(tileId) {
      if (!(tileId in drillIns)) return;
      drillIns = Object.assign({}, drillIns);
      delete drillIns[tileId];
      notify();
    }

    function setBookmarks(newBookmarks) { bookmarks = newBookmarks || []; notify(); }

    // Capture l'état interactif COURANT (filtres croisés + drill-down par tuile), PAS les tuiles
    // elles-mêmes (déjà persistées séparément, voir js/grist-api.js) : une vue Power BI-like sur
    // laquelle revenir en un clic, sans reconstruire les filtres à la main.
    function saveBookmark(id, name) {
      bookmarks = bookmarks.concat([{ id, name, activeFilters, drillIns }]);
      notify();
    }

    function applyBookmark(id) {
      const bm = bookmarks.find((b) => b.id === id);
      if (!bm) return;
      activeFilters = bm.activeFilters;
      drillIns = bm.drillIns;
      notify();
    }

    function removeBookmark(id) {
      bookmarks = bookmarks.filter((b) => b.id !== id);
      notify();
    }

    return {
      getState, subscribe, setRows, setTiles, addTile, removeTile, updateTile, moveTile,
      toggleFilter, clearFilter, drillInto, drillUp,
      setBookmarks, saveBookmark, applyBookmark, removeBookmark
    };
  }

  return { createStore };
});
