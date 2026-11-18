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
  // Style global des tuiles (voir `dashStyle` dans createStore) : même forme d'id que js/styles.js.
  const DEFAULT_DASH_STYLE = 'standard';
  const DASH_STYLE_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const DASH_STYLE_OPTION_KEYS = ['hideBorders', 'uniform']; // les mêmes que js/styles.js:OPTION_KEYS (un test Node le vérifie)
  // Agencement d'une PAGE (js/layouts.js) : même forme d'id que le style. Absent = la grille d'origine ; jamais écrit pour elle.
  const PAGE_LAYOUT_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const DEFAULT_PAGE_LAYOUT = 'grid';

  // Un id de tuile est lu depuis la configuration (`BI_Dashboard_Config`, une ligne que d'autres
  // personnes du document peuvent avoir écrite : consigne GFS 005) puis reposé dans du balisage
  // (`data-tile-id="…"`) et dans des sélecteurs CSS (`[data-tile-id="…"]`). Un id forgé comme
  // `x"><img src=x onerror=…>` exécutait donc du script dans le widget (accès `full`) : trouvé par la
  // revue C-XSS-01 de l'audit gwaudit, 18/11/2026 (HYPOTHESES.md, bug réel n°37). Les ids que ce widget
  // fabrique lui-même (`tile_…`, `page_…`, `bm_…`, `stress_…`, `__preview__`) n'ont que lettres, chiffres,
  // `_` et `-` : tout autre caractère d'un id relu devient `_`.
  const UNSAFE_ID_CHARS = /[^A-Za-z0-9_-]/g;

  // `used` : ids déjà pris (ils sont uniques dans tout le rapport, pages confondues). Un id vide, absent,
  // qui n'est ni un texte ni un nombre, ou déjà pris reçoit un suffixe numérique : jamais deux tuiles
  // sous le même id (le DOM et les caches de rendu sont indexés par id).
  function safeTileId(raw, used) {
    let id = (typeof raw === 'string' || typeof raw === 'number') ? String(raw).replace(UNSAFE_ID_CHARS, '_') : '';
    if (!id) id = 'tile';
    if (used.has(id)) {
      let n = 2;
      while (used.has(id + '_' + n)) n++;
      id = id + '_' + n;
    }
    used.add(id);
    return id;
  }

  // Rend des pages dont toutes les tuiles ont un id sûr et unique. Rend la MÊME référence quand rien ne
  // change (le cas de toute configuration écrite par ce widget) : `main.js:render()` compare `state.pages`
  // par référence pour décider d'une sauvegarde, une copie à chaque chargement en déclencherait une.
  function sanitizePages(pages) {
    const used = new Set();
    let changed = false;
    const out = pages.map((page) => {
      const tiles = Array.isArray(page && page.tiles) ? page.tiles : [];
      let pageChanged = !Array.isArray(page && page.tiles);
      // `layout` vient de la configuration comme les ids de tuile : seul un id bien formé est gardé (il finit dans un attribut du DOM).
      const badLayout = page && typeof page === 'object' && 'layout' in page && !(typeof page.layout === 'string' && PAGE_LAYOUT_ID.test(page.layout));
      if (badLayout) pageChanged = true;
      const safeTiles = tiles.map((tile) => {
        if (!tile || typeof tile !== 'object') { pageChanged = true; return null; }
        const id = safeTileId(tile.id, used);
        if (id === tile.id) return tile;
        pageChanged = true;
        return Object.assign({}, tile, { id });
      }).filter(Boolean);
      if (!pageChanged && safeTiles.length === tiles.length) return page;
      changed = true;
      const fixed = Object.assign({}, page, { tiles: safeTiles });
      if (badLayout) delete fixed.layout;
      return fixed;
    });
    return changed ? out : pages;
  }

  // Sérialisation JSON à clés triées : deux objets de même contenu donnent la même chaîne, quel que
  // soit l'ordre dans lequel leurs clés ont été posées.
  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).filter((k) => value[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  // Forme canonique de l'état interactif d'une vue (filtres croisés + filtres avancés + chemins de
  // drill-down) : l'ordre des filtres ne compte pas (cliquer A puis B ou B puis A est la même vue),
  // un chemin de drill-down vide équivaut à aucune entrée, et une vue sauvegardée avant l'ajout des
  // filtres avancés (pas de champ) équivaut à « aucun filtre avancé » — même repli que applyBookmark.
  function canonicalSnapshot(snap) {
    const byKey = (list) => (list || []).map(stableStringify).sort();
    const drills = {};
    for (const tileId of Object.keys((snap && snap.drillIns) || {})) {
      const path = snap.drillIns[tileId];
      if (path && path.length) drills[tileId] = path;
    }
    return stableStringify({
      activeFilters: byKey(snap && snap.activeFilters),
      advancedFilters: byKey(snap && snap.advancedFilters),
      drillIns: drills
    });
  }

  // Vrai si les deux états interactifs sont les mêmes (voir canonicalSnapshot). Pur, testé sous Node.
  function sameSnapshot(a, b) { return canonicalSnapshot(a) === canonicalSnapshot(b); }

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
    // [{ column, type: 'range'|'dateRange'|'relativeDate'|'contains', ... }, ...] — au plus un par
    // colonne, comme activeFilters, mais posés depuis la barre de filtres avancés (pas un clic sur
    // une tuile) : jamais de sourceTileId, s'appliquent donc à TOUTES les tuiles sans exception
    // (voir charts.js). GLOBAUX entre pages, comme activeFilters/drillIns (même décision produit,
    // voir HYPOTHESES.md/ROADMAP.md).
    let advancedFilters = [];
    let drillIns = {}; // tileId -> [{ column, value }, ...] — chemin de drill-down, [] ou absent = niveau racine
    let bookmarks = []; // [{ id, name, activeFilters, advancedFilters, drillIns }, ...] — vues sauvegardées (voir saveBookmark)
    // Id de la vue sauvegardée que la personne est en train de suivre (retours d'Antoine du 18/11/2026,
    // point 4), ou null : posé par applyBookmark/saveBookmark/updateBookmark, levé par leaveBookmark,
    // la suppression de cette vue ou un changement de table (setBookmarks). SESSION SEULEMENT, jamais
    // persisté : les filtres eux-mêmes ne le sont pas, donc au rechargement il n'y a plus rien à suivre.
    // Que les filtres actuels s'écartent ensuite de la vue (« modifiée ») se DÉRIVE de l'état, voir
    // activeBookmarkModified dans getState — jamais un second indicateur à tenir à jour.
    let activeBookmarkId = null;
    // Tuiles « agrandies » (retours d'Antoine du 18/11/2026, point 8) : ids des tuiles posées dans la zone
    // d'agrandissement au-dessus de la grille, plusieurs possibles. SESSION SEULEMENT, jamais persisté
    // (c'est un confort de lecture, pas une mise en page : l'ordre des tuiles ne change pas), global à
    // toutes les pages — la liste mémorise donc aussi les tuiles des autres pages, et `getState`
    // n'expose que celles de la page courante, dans l'ordre d'affichage des tuiles.
    let zoomedTileIds = [];
    // { secondaryTableId, primaryColumn, secondaryColumn } ou null (aucune jointure) — data blending
    // multi-tables (voir GristBI.data.blendRows/js/main.js) : propre à la table de travail
    // courante, comme bookmarks/pages, persisté avec elles dans BI_Dashboard_Config.
    let blend = null;
    // Style global des tuiles (js/styles.js, css/dash-styles.css) : l'id d'une direction artistique, `'standard'` sans choix. Un
    // réglage du tableau de bord (persisté avec `pages`/`bookmarks`/`blend` dans BI_Dashboard_Config), jamais d'une vue sauvegardée :
    // changer de vue ne change pas l'apparence. Une valeur qui n'a pas la forme d'un id (configuration éditée à la main) vaut
    // `'standard'` ; un id bien formé mais INCONNU de ce widget (version future) est gardé tel quel — js/styles.js l'affiche en
    // Standard sans l'effacer, une sauvegarde ne perd donc pas le choix fait ailleurs.
    let dashStyle = DEFAULT_DASH_STYLE;
    // Options valables pour TOUS les styles (js/styles.js:normalizeOptions) : `{ hideBorders?: true, uniform?: true }`, enregistrées avec
    // le style dans BI_Dashboard_Config. Un objet NEUF à chaque changement seulement (`render()` compare des références pour décider
    // d'une sauvegarde), jamais modifié sur place ; vide tant qu'aucune option n'est cochée.
    let dashStyleOptions = {};
    // [{ id, TableId, TileId, Author, Text, CreatedAt }, ...] — commentaires collaboratifs (voir
    // ROADMAP.md Tier 2), TOUJOURS chargés dans leur ENTIER depuis leur propre table Grist
    // dédiée (BI_Dashboard_Comments, js/grist-api.js), jamais filtrés par table de travail au
    // chargement (voir GristBI.data.commentsForTile pour le filtrage par tuile à l'affichage) —
    // même convention que BI_Dashboard_Config, qui contient aussi les lignes de TOUTES les tables
    // de travail jamais utilisées. Contrairement à `blend`/`bookmarks`/`pages`, PAS persisté dans
    // ConfigJSON : cette table dédiée existe justement pour éviter le blob JSON partagé qui
    // écraserait des commentaires ajoutés en même temps par deux personnes.
    let comments = [];
    const listeners = new Set();

    function currentPage() { return pages.find((p) => p.id === currentPageId) || pages[0]; }

    // `tiles` dérivé de la page courante : expose la MÊME forme qu'avant les pages, pour que
    // main.js/charts.js (render, renderTile, le gestionnaire de clic...) n'aient rien à changer -
    // ils ne voient jamais que "les tuiles à afficher maintenant", peu importe combien de pages
    // existent. Un effet de bord utile : changer de page retire du DOM les tuiles de l'ancienne
    // page (elles disparaissent de `state.tiles`), donc la réconciliation DOM déjà en place dans
    // main.js:render() détruit leurs instances ECharts automatiquement, sans code dédié.
    function getState() {
      // `activeBookmarkId` : la vue suivie (null si aucune) ; `activeBookmarkModified` : les filtres
      // ou drill-downs actuels ne sont plus ceux de cette vue (voir activeBookmarkId plus haut).
      const active = activeBookmarkId && bookmarks.find((b) => b.id === activeBookmarkId);
      return {
        rows, pages, currentPageId, tiles: currentPage().tiles, pageLayout: currentPage().layout || DEFAULT_PAGE_LAYOUT, activeFilters, advancedFilters, drillIns, bookmarks, blend, dashStyle, dashStyleOptions, comments,
        zoomedTileIds: currentPage().tiles.map((t) => t.id).filter((id) => zoomedTileIds.includes(id)),
        activeBookmarkId: active ? active.id : null,
        activeBookmarkModified: active ? !sameSnapshot(active, { activeFilters, advancedFilters, drillIns }) : false
      };
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
      pages = (newPages && newPages.length) ? sanitizePages(newPages) : [{ id: DEFAULT_PAGE_ID, name: 'Page 1', tiles: [] }];
      currentPageId = (newCurrentPageId && pages.some((p) => p.id === newCurrentPageId)) ? newCurrentPageId : pages[0].id;
      // Un autre rapport / une autre table n'a plus les mêmes tuiles : seules celles qui existent
      // encore restent agrandies (aucune, dans la pratique, les ids de tuile étant uniques).
      zoomedTileIds = zoomedTileIds.filter((id) => pages.some((p) => p.tiles.some((t) => t.id === id)));
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

    // Agencement d'une page (js/layouts.js) : un réglage PAR PAGE, enregistré avec elle. La grille d'origine n'écrit RIEN (le champ est retiré :
    // une page d'avant ce réglage reste identique octet pour octet) ; un id mal formé est refusé ; un id bien formé mais inconnu de ce widget
    // (version future) est gardé tel quel. Aucune nouvelle référence si rien ne change : main.js:render() y verrait une sauvegarde à faire.
    function setPageLayout(pageId, layoutId) {
      const id = layoutId == null ? DEFAULT_PAGE_LAYOUT : layoutId;
      if (typeof id !== 'string' || !PAGE_LAYOUT_ID.test(id)) return;
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;
      if ((page.layout || DEFAULT_PAGE_LAYOUT) === id) return;
      pages = pages.map((p) => {
        if (p.id !== pageId) return p;
        const next = Object.assign({}, p);
        if (id === DEFAULT_PAGE_LAYOUT) delete next.layout; else next.layout = id;
        return next;
      });
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
        zoomedTileIds = zoomedTileIds.filter((id) => !removedTileIds.has(id));
        drillIns = Object.assign({}, drillIns);
        removedTileIds.forEach((id) => { delete drillIns[id]; });
        activeFilters = activeFilters.filter((f) => !removedTileIds.has(f.sourceTileId));
      }
      notify();
    }

    function addTile(tile) { replaceCurrentPageTiles(currentPage().tiles.concat([tile])); notify(); }

    function removeTile(id) {
      replaceCurrentPageTiles(currentPage().tiles.filter((t) => t.id !== id));
      zoomedTileIds = zoomedTileIds.filter((z) => z !== id);
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

    // Agrandit / réduit une tuile de la page courante (no-op si l'id n'y est pas). Plusieurs tuiles
    // peuvent être agrandies en même temps ; `clearZoom` les réduit toutes. Pas persisté (voir
    // zoomedTileIds). Une nouvelle référence de `pages` n'est PAS créée : main.js n'y voit donc aucun
    // changement à sauvegarder dans BI_Dashboard_Config.
    function toggleZoom(id) {
      if (!currentPage().tiles.some((t) => t.id === id)) return;
      zoomedTileIds = zoomedTileIds.includes(id) ? zoomedTileIds.filter((z) => z !== id) : zoomedTileIds.concat([id]);
      notify();
    }

    function clearZoom() {
      if (!zoomedTileIds.length) return;
      zoomedTileIds = [];
      notify();
    }

    // Déplace une tuile d'un cran (direction: -1 = plus tôt, +1 = plus tard) dans l'ordre
    // d'affichage, au sein de la page courante. No-op silencieux si déjà en bout de liste (les
    // boutons ◂/▸ sont désactivés côté UI dans ce cas, mais la fonction reste sûre si appelée
    // directement).
    // `targetId` (facultatif) : l'id de la tuile avec laquelle échanger, quand ce n'est pas la voisine directe — dans un agencement
    // (js/layouts.js:moveTarget), une tuile ne dépasse que les tuiles de son groupe, sinon rien ne changerait à l'écran. Sans lui : la voisine.
    function moveTile(id, direction, targetId) {
      const tiles = currentPage().tiles;
      const idx = tiles.findIndex((t) => t.id === id);
      let target = idx + direction;
      if (targetId != null) {
        target = tiles.findIndex((t) => t.id === targetId);
        if (target < 0 || (direction < 0 ? target >= idx : target <= idx)) return;
      }
      if (idx < 0 || target < 0 || target >= tiles.length) return;
      const next = tiles.slice();
      const swapped = next[idx];
      next[idx] = next[target];
      next[target] = swapped;
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

    // Filtre croisé par PLAGE (clic sur une classe d'histogramme) : même place que toggleFilter dans `activeFilters` (au plus un
    // par colonne, `sourceTileId` = la tuile qui le pose, donc elle reste affichée en entier), mais de type `range`
    // (`{type:'range', min, max, maxExclusive?}`, voir data.js:matchesFilter). Cliquer la MÊME plage retire le filtre ; une
    // autre plage (ou un filtre d'égalité posé sur cette colonne) la remplace.
    function toggleRangeFilter(column, range, sourceTileId) {
      const idx = activeFilters.findIndex((f) => f.column === column);
      const filter = { column, type: 'range', min: range.min, max: range.max, sourceTileId };
      if (range.maxExclusive) filter.maxExclusive = true;
      const same = idx >= 0 && activeFilters[idx].type === 'range' && activeFilters[idx].min === filter.min
        && activeFilters[idx].max === filter.max && !!activeFilters[idx].maxExclusive === !!filter.maxExclusive;
      if (same) activeFilters = activeFilters.filter((_, i) => i !== idx);
      else if (idx >= 0) activeFilters = activeFilters.map((f, i) => (i === idx ? filter : f));
      else activeFilters = activeFilters.concat([filter]);
      notify();
    }

    // Sans argument : efface tous les filtres. Avec une colonne : efface seulement celui-là.
    function clearFilter(column) {
      activeFilters = column ? activeFilters.filter((f) => f.column !== column) : [];
      notify();
    }

    // Pose/remplace le filtre avancé sur `column` (barre de filtres, PAS un clic sur une tuile) :
    // au plus un par colonne, comme toggleFilter — poser un nouveau filtre sur une colonne déjà
    // filtrée remplace l'ancien plutôt que de les cumuler (ex. changer les bornes d'une plage plutôt
    // que d'en ajouter une seconde qui ne matcherait jamais rien en ET avec la première).
    // `filter`: `{type: 'range'|'dateRange'|'relativeDate'|'contains', ...}` (voir data.js:matchesFilter).
    function setAdvancedFilter(column, filter) {
      const withoutThisColumn = advancedFilters.filter((f) => f.column !== column);
      advancedFilters = withoutThisColumn.concat([Object.assign({ column }, filter)]);
      notify();
    }

    // Sans argument : efface tous les filtres avancés. Avec une colonne : efface seulement celui-là.
    function clearAdvancedFilter(column) {
      advancedFilters = column ? advancedFilters.filter((f) => f.column !== column) : [];
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

    function setBookmarks(newBookmarks) { bookmarks = newBookmarks || []; activeBookmarkId = null; notify(); }

    function setBlend(newBlend) { blend = newBlend || null; notify(); }

    function setDashStyle(id) {
      const next = (typeof id === 'string' && DASH_STYLE_ID.test(id)) ? id : DEFAULT_DASH_STYLE;
      if (next === dashStyle) return;
      dashStyle = next;
      notify();
    }

    // Remplace les options d'affichage globales. Seule une valeur `true` est retenue (une clé inconnue ou un autre type s'efface :
    // jamais de réglage mal formé dans l'état) ; aucune notification si rien ne change.
    function setDashStyleOptions(opts) {
      const next = {};
      if (opts && typeof opts === 'object' && !Array.isArray(opts)) DASH_STYLE_OPTION_KEYS.forEach((k) => { if (Object.prototype.hasOwnProperty.call(opts, k) && opts[k] === true) next[k] = true; });
      if (DASH_STYLE_OPTION_KEYS.every((k) => !!next[k] === !!dashStyleOptions[k])) return;
      dashStyleOptions = next;
      notify();
    }

    // Remplace TOUS les commentaires connus (relecture complète de BI_Dashboard_Comments, voir
    // js/grist-api.js:loadOrCreateComments) — appelé au chargement d'une table de travail, jamais
    // par tuile individuellement.
    function setComments(newComments) { comments = newComments || []; notify(); }

    // Ajout optimiste d'UN commentaire déjà écrit côté Grist (voir js/grist-api.js:addComment, qui
    // renvoie la ligne complète avec son id réel) — évite un aller-retour réseau supplémentaire
    // pour relire toute la table après un simple ajout.
    function addCommentLocal(comment) { comments = comments.concat([comment]); notify(); }

    // Capture l'état interactif COURANT (filtres croisés + filtres avancés + drill-down par tuile),
    // PAS les tuiles elles-mêmes (déjà persistées séparément, voir js/grist-api.js) : une vue
    // Power BI-like sur laquelle revenir en un clic, sans reconstruire les filtres à la main.
    function saveBookmark(id, name) {
      bookmarks = bookmarks.concat([{ id, name, activeFilters, advancedFilters, drillIns }]);
      activeBookmarkId = id; // la vue qu'on vient de sauvegarder est celle qu'on regarde
      notify();
    }

    function applyBookmark(id) {
      const bm = bookmarks.find((b) => b.id === id);
      if (!bm) return;
      activeFilters = bm.activeFilters;
      // `|| []` : un bookmark sauvegardé avant l'ajout des filtres avancés n'a pas ce champ —
      // le restaurer comme "aucun filtre avancé" plutôt que `undefined` (compat ascendante).
      advancedFilters = bm.advancedFilters || [];
      drillIns = bm.drillIns || {};
      activeBookmarkId = id;
      notify();
    }

    // « Mettre à jour la vue » : remplace le contenu d'une vue déjà sauvegardée par l'état actuel
    // (même id, même nom) — la vue redevient « telle que sauvegardée ». Nouvelle référence de
    // `bookmarks` : main.js y voit un changement à persister.
    function updateBookmark(id) {
      if (!bookmarks.some((b) => b.id === id)) return;
      bookmarks = bookmarks.map((b) => (b.id === id ? { id: b.id, name: b.name, activeFilters, advancedFilters, drillIns } : b));
      activeBookmarkId = id;
      notify();
    }

    // Cesse de suivre la vue sans toucher aux filtres : ils restent posés, simplement plus rattachés
    // à une vue sauvegardée.
    function leaveBookmark() {
      if (activeBookmarkId === null) return;
      activeBookmarkId = null;
      notify();
    }

    function removeBookmark(id) {
      bookmarks = bookmarks.filter((b) => b.id !== id);
      if (activeBookmarkId === id) activeBookmarkId = null;
      notify();
    }

    return {
      getState, subscribe, setRows,
      setPages, setCurrentPage, addPage, renamePage, removePage,
      addTile, removeTile, updateTile, moveTile, setPageLayout,
      toggleFilter, toggleRangeFilter, clearFilter, setAdvancedFilter, clearAdvancedFilter, drillInto, drillUp,
      setBookmarks, saveBookmark, applyBookmark, updateBookmark, leaveBookmark, removeBookmark, setBlend, setDashStyle, setDashStyleOptions,
      toggleZoom, clearZoom,
      setComments, addCommentLocal
    };
  }

  return { createStore, sameSnapshot, sanitizePages, safeTileId, DEFAULT_PAGE_ID };
});
