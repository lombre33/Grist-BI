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

  // { id, type: 'bar'|'pie'|'kpi'|'gauge'|'treemap'|'scatter', title, dimension, measure, aggFn,
  //   drillDimensions?, drillCrossFilter?, trendDimension?, measureY?, gaugeMin?, gaugeMax? }
  const DEFAULT_PAGE_ID = 'page_default';

  function createStore() {
    let rows = [];
    // pages: [{ id, name, tiles: [...] }, ...] — un dashboard multi-pages est un tableau de pages,
    // chacune avec ses propres tuiles ; activeFilters/drillIns restent GLOBAUX (pas par page,
    // décision produit délibérée : garder un mécanisme unique de cross-filtering plutôt que le
    // dupliquer par page — voir HYPOTHESES.md/ROADMAP.md pour la discussion). Toujours au moins
    // une page (jamais de tableau vide).
    let pages = [{ id: DEFAULT_PAGE_ID, name: 'Page 1', tiles: [] }];
    let currentPageId = pages[0].id;
    let activeFilters = []; // [{ column, value, sourceTileId, fromDrill? }, ...] — au plus un filtre par colonne
    let drillIns = {}; // tileId -> [{ column, value }, ...] — chemin de drill-down, [] ou absent = niveau racine
    let bookmarks = []; // [{ id, name, activeFilters, drillIns }, ...] — vues sauvegardées (voir saveBookmark)
    const listeners = new Set();

    function currentPage() { return pages.find((p) => p.id === currentPageId) || pages[0]; }

    // `tiles` dérivé de la page courante : expose la MÊME forme qu'avant les pages, pour que
    // main.js/charts.js (render, renderTile, le gestionnaire de clic...) n'aient rien à changer -
    // ils ne voient jamais que "les tuiles à afficher maintenant", peu importe combien de pages
    // existent. Un effet de bord utile : changer de page retire du DOM les tuiles de l'ancienne
    // page (elles disparaissent de `state.tiles`), donc la réconciliation DOM déjà en place dans
    // main.js:render() détruit leurs instances ECharts automatiquement, sans code dédié.
    function getState() {
      return { rows, pages, currentPageId, tiles: currentPage().tiles, activeFilters, drillIns, bookmarks };
    }
    function notify() { listeners.forEach((fn) => fn(getState())); }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    function setRows(newRows) { rows = newRows || []; notify(); }

    function replaceCurrentPageTiles(newTiles) {
      pages = pages.map((p) => (p.id === currentPageId ? Object.assign({}, p, { tiles: newTiles }) : p));
    }

    // Charge un dashboard multi-pages complet (au chargement d'une table, voir grist-api.js) :
    // remplace TOUTES les pages d'un coup, contrairement à addTile/updateTile/... qui n'agissent
    // que sur la page courante.
    function setPages(newPages, newCurrentPageId) {
      pages = (newPages && newPages.length) ? newPages : [{ id: DEFAULT_PAGE_ID, name: 'Page 1', tiles: [] }];
      currentPageId = (newCurrentPageId && pages.some((p) => p.id === newCurrentPageId)) ? newCurrentPageId : pages[0].id;
      notify();
    }

    function setCurrentPage(pageId) {
      if (!pages.some((p) => p.id === pageId)) return;
      currentPageId = pageId;
      notify();
    }

    function addPage(name) {
      const id = 'page_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      pages = pages.concat([{ id, name, tiles: [] }]);
      currentPageId = id; // navigue directement vers la page qu'on vient de créer
      notify();
      return id;
    }

    function renamePage(pageId, name) {
      pages = pages.map((p) => (p.id === pageId ? Object.assign({}, p, { name }) : p));
      notify();
    }

    // Toujours garder au moins une page (no-op sûr si on tente de supprimer la dernière). Nettoie
    // aussi drillIns/activeFilters des tuiles qui disparaissent avec la page — même principe que
    // removeTile, pour ne pas laisser un filtre orphelin sans plus aucune tuile source.
    function removePage(pageId) {
      if (pages.length <= 1) return;
      const removedPage = pages.find((p) => p.id === pageId);
      if (!removedPage) return;
      pages = pages.filter((p) => p.id !== pageId);
      if (currentPageId === pageId) currentPageId = pages[0].id;
      const removedTileIds = new Set(removedPage.tiles.map((t) => t.id));
      if (removedTileIds.size) {
        drillIns = Object.assign({}, drillIns);
        removedTileIds.forEach((id) => { delete drillIns[id]; });
        activeFilters = activeFilters.filter((f) => !removedTileIds.has(f.sourceTileId));
      }
      notify();
    }

    function addTile(tile) { replaceCurrentPageTiles(currentPage().tiles.concat([tile])); notify(); }

    function removeTile(id) {
      replaceCurrentPageTiles(currentPage().tiles.filter((t) => t.id !== id));
      if (id in drillIns) { drillIns = Object.assign({}, drillIns); delete drillIns[id]; }
      // Retire aussi tout filtre croisé (toggleFilter OU drill-cross-filter, voir
      // syncDrillCrossFilters) provenant de la tuile supprimée : sinon il reste actif, affiché,
      // mais sans plus aucune tuile source pour le faire évoluer ou le lever.
      if (activeFilters.some((f) => f.sourceTileId === id)) {
        activeFilters = activeFilters.filter((f) => f.sourceTileId !== id);
      }
      notify();
    }

    // Remplace une tuile existante en place (même id, mêmes voisines) plutôt que
    // supprimer+ajouter : garde sa position dans la grille.
    function updateTile(id, patch) {
      replaceCurrentPageTiles(currentPage().tiles.map((t) => (t.id === id ? Object.assign({}, t, patch) : t)));
      // Une édition touchant le drill-down invalide le chemin de drill-down EN COURS pour cette
      // tuile : le garder référencerait potentiellement des niveaux qui n'ont plus cours (ex.
      // drill-down retiré via le formulaire), avec un filtre invisible sur ses propres données —
      // pas de fil d'Ariane pour le signaler puisque `tileDrillLevels` serait vide. Remise à la
      // racine à chaque édition plutôt que de tenter un diff ancien/nouveau schéma.
      if ('drillDimensions' in patch && id in drillIns) {
        drillIns = Object.assign({}, drillIns);
        delete drillIns[id];
      }
      syncDrillCrossFilters(id);
      notify();
    }

    // Déplace une tuile d'un cran (direction: -1 = plus tôt, +1 = plus tard) dans l'ordre
    // d'affichage, au sein de la page courante. No-op silencieux si déjà en bout de liste (les
    // boutons ◂/▸ sont désactivés côté UI dans ce cas, mais la fonction reste sûre si appelée
    // directement).
    function moveTile(id, direction) {
      const tiles = currentPage().tiles;
      const idx = tiles.findIndex((t) => t.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= tiles.length) return;
      const next = tiles.slice();
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      replaceCurrentPageTiles(next);
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

    // Une tuile avec `drillCrossFilter: true` (case à cocher dans son formulaire, voir main.js)
    // filtre aussi les AUTRES tuiles à chaque niveau franchi, pas seulement au niveau le plus
    // profond (comportement par défaut, voir toggleFilter dans charts.js). Reconstruit entièrement
    // les entrées `fromDrill` de cette tuile à partir de son chemin courant plutôt que de les faire
    // évoluer une à une : plus simple et sans risque de désynchronisation entre drillUp/drillInto.
    // `fromDrill` distingue ces entrées d'un éventuel filtre posé par toggleFilter depuis la MÊME
    // tuile (clic au niveau le plus profond), pour ne pas les effacer l'une l'autre par erreur.
    function syncDrillCrossFilters(tileId) {
      activeFilters = activeFilters.filter((f) => !(f.sourceTileId === tileId && f.fromDrill));
      const tile = currentPage().tiles.find((t) => t.id === tileId);
      if (!tile || !tile.drillCrossFilter) return;
      const path = drillIns[tileId] || [];
      if (!path.length) return;
      activeFilters = activeFilters.concat(
        path.map((step) => ({ column: step.column, value: step.value, sourceTileId: tileId, fromDrill: true }))
      );
    }

    // Drill-down : approfondit une tuile qui déclare des `drillDimensions` d'un cran (empile sur le
    // chemin déjà parcouru — voir GristBI.data.tileDrillLevels pour la liste des niveaux possibles
    // d'une tuile, jusqu'à 2 au-delà de sa dimension racine).
    function drillInto(tileId, column, value) {
      const path = drillIns[tileId] || [];
      drillIns = Object.assign({}, drillIns, { [tileId]: path.concat([{ column, value }]) });
      syncDrillCrossFilters(tileId);
      notify();
    }

    // Remonte au niveau `depth` du chemin de drill-down (0 = racine, retire tout ; 1 = garde le 1er
    // cran seulement, etc.). Sans argument : remonte complètement (comportement historique).
    function drillUp(tileId, depth) {
      const path = drillIns[tileId];
      if (!path || !path.length) return;
      const targetDepth = depth || 0;
      if (targetDepth >= path.length) return; // déjà à ce niveau ou plus profond -> no-op
      drillIns = Object.assign({}, drillIns);
      if (targetDepth === 0) delete drillIns[tileId];
      else drillIns[tileId] = path.slice(0, targetDepth);
      syncDrillCrossFilters(tileId);
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
      getState, subscribe, setRows,
      setPages, setCurrentPage, addPage, renamePage, removePage,
      addTile, removeTile, updateTile, moveTile,
      toggleFilter, clearFilter, drillInto, drillUp,
      setBookmarks, saveBookmark, applyBookmark, removeBookmark
    };
  }

  return { createStore, DEFAULT_PAGE_ID };
});
