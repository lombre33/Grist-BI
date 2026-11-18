/*
 * Agencement des tuiles d'une PAGE (demande d'Antoine, 18/11/2026 : « en plus des styles, on laisse le choix de l'arrangement, et ça reste
 * changeable sans souci pour chaque page »). Un réglage PAR PAGE (champ `layout` de la page dans `BI_Dashboard_Config`, écrit seulement s'il
 * diffère de `grid`), distinct du style global (js/styles.js, qui dit COMMENT s'habillent les cartes) : l'agencement dit OÙ elles se posent et
 * quel poids chacune a.
 *
 * Cinq entrées. `grid` = la grille de cartes d'origine, jamais modifiée, c'est le défaut. Les quatre autres posent les tuiles sur le fond de la
 * page, SANS carte, et les relient par la hiérarchie, un alignement commun et des lignes qui se remplissent :
 *  - `report`    (Rapport)  : rangée de chiffres puis deux graphiques par ligne, un filet fin au-dessus de chaque bloc ;
 *  - `board`     (Planche)  : UNE surface arrondie, bandeau de chiffres teinté, filets seulement entre les cellules ;
 *  - `spotlight` (Vedette)  : rangée de chiffres, un grand graphique (le premier en barres, courbe ou combo) à gauche, deux plus petits à côté,
 *                             le reste en lignes de trois ;
 *  - `rail`      (Rail)     : une colonne de chiffres et de jauges à gauche, les graphiques à droite, trois par ligne.
 * Règles tirées de la compétence `dataviz` : un seul chiffre phare (le premier), les autres plus petits ; une dernière ligne incomplète se
 * partage la largeur (jamais une case vide au bout) ; filets pleins d'un pixel, pas de boîtes.
 *
 * Pur JS, testable sous Node (UMD), sans DOM : `plan(layoutId, tiles)` rend, pour chaque tuile, son groupe, sa largeur (colonnes sur 12), sa
 * hauteur (rangées de `ROW_UNIT` px, FIXES : piège n°8, jamais une hauteur qui dépend du contenu du graphique) et, pour le Rail, sa colonne de
 * départ. `js/main.js:render()` pose ce plan en variables CSS (`--ls`, `--lc`, `--lr`) et réordonne les tuiles dans le DOM (l'ordre de
 * tabulation suit l'ordre visuel) ; `css/layouts.css` fait le reste. La règle, la même pour tous : l'ordre ENREGISTRÉ des tuiles (`page.tiles`)
 * ne change jamais ; seul l'ordre AFFICHÉ en dérive (les chiffres d'abord).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.layouts = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_LAYOUT = 'grid';
  // Même forme d'id que js/styles.js : un id bien formé mais inconnu (version future de ce widget) n'est jamais perdu à la sauvegarde.
  const LAYOUT_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const COLUMNS = 12;
  const ROW_UNIT = 28; // px : hauteur d'une rangée de la grille d'agencement (`--lu` dans css/layouts.css, un test Node compare les deux)

  const LAYOUTS = {
    grid: { id: 'grid', nameKey: 'layout.grid.name', descKey: 'layout.grid.desc', minWidth: 0 },
    report: { id: 'report', nameKey: 'layout.report.name', descKey: 'layout.report.desc', minWidth: 640 },
    board: { id: 'board', nameKey: 'layout.board.name', descKey: 'layout.board.desc', minWidth: 900 },
    spotlight: { id: 'spotlight', nameKey: 'layout.spotlight.name', descKey: 'layout.spotlight.desc', minWidth: 900 },
    rail: { id: 'rail', nameKey: 'layout.rail.name', descKey: 'layout.rail.desc', minWidth: 1040 }
  };
  const LAYOUT_IDS = ['grid', 'report', 'board', 'spotlight', 'rail'];

  // Types de tuile par rôle. Un chiffre (KPI) est une « figure » ; le Rail y ajoute la jauge (une valeur seule, elle aussi). La vedette de
  // l'agencement du même nom est le premier graphique de ces types : ceux qui se lisent sur toute une largeur.
  const FIGURE_TYPES = ['kpi'];
  const RAIL_TYPES = ['kpi', 'gauge'];
  const HERO_TYPES = ['bar', 'line', 'combo'];

  // Hauteurs, en rangées de ROW_UNIT px (28 px : 8 = 224 px, comme une tuile de la grille).
  const ROWS = {
    report: { figure: 8, chart: 10 },
    board: { figure: 8, chart: 9 },
    spotlight: { figure: 8, chart: 8, hero: 16 },
    // Rail : un chiffre avec objectif a une barre de plus (2 rangées de plus) ; la colonne est étroite, courbe et barre y passent dessous.
    rail: { figure: 7, figureGoal: 9, gauge: 9, chart: 9 }
  };

  // La tuile de chiffres porte-t-elle un objectif (barre de progression) ? Même règle que js/charts.js:renderKpi (colonne d'objectifs ou nombre fini).
  function hasGoal(tile) {
    if (!tile) return false;
    if (tile.targetColumn) return true;
    const v = tile.target;
    if (v == null || v === '') return false;
    return Number.isFinite(Number(v));
  }

  function isKnown(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LAYOUTS, id); }
  // Un id inconnu, absent ou hostile s'affiche en grille.
  function normalizeLayoutId(id) { return isKnown(id) ? id : DEFAULT_LAYOUT; }
  function isWellFormed(id) { return typeof id === 'string' && LAYOUT_ID.test(id); }
  // Ce qu'une page écrit dans sa configuration : rien pour la grille (une page d'avant ce réglage reste identique octet pour octet), l'id
  // sinon — un id bien formé mais inconnu est gardé tel quel (version future), un id mal formé n'est jamais écrit.
  function configValue(id) { return isWellFormed(id) && id !== DEFAULT_LAYOUT ? id : undefined; }

  // Largeur minimale (px) du conteneur à partir de laquelle l'agencement s'applique ; en dessous, la grille d'origine (un agencement en
  // 12 colonnes écraserait les graphiques). Les mêmes valeurs sont dans css/layouts.css (`@container`), un test Node les compare.
  function minWidthOf(id) { return LAYOUTS[normalizeLayoutId(id)].minWidth; }

  // Largeurs (en colonnes sur 12) de `n` éléments rangés `perRow` par ligne : les lignes pleines gardent 12/perRow, la dernière, incomplète,
  // se partage la largeur (5 éléments à 3 par ligne -> 4 4 4 puis 6 6 ; jamais une case vide au bout).
  function spansFor(n, perRow) {
    const out = [];
    const per = Math.max(1, perRow);
    for (let i = 0; i < n; i += per) {
      const count = Math.min(per, n - i);
      const span = Math.floor(COLUMNS / count);
      for (let k = 0; k < count; k++) out.push(span);
    }
    return out;
  }

  // Chiffres par ligne : jusqu'à 4 sur une seule ligne ; au-delà 3 (5 -> 3 + 2, 6 -> 3 + 3), puis 4 (7 -> 4 + 3).
  function figuresPerRow(n) {
    if (n <= 4) return Math.max(1, n);
    return n <= 6 ? 3 : 4;
  }

  // Colonne de départ de chaque élément quand `spans` se rangent de gauche à droite sur COLUMNS colonnes, à partir de la ligne `base`.
  function startsFor(spans, base) {
    const out = [];
    let used = 0;
    spans.forEach((span) => {
      if (used + span > COLUMNS) used = 0;
      out.push(base + used);
      used += span;
    });
    return out;
  }

  // Groupe d'une tuile dans l'agencement : 'figure' (rangée de chiffres), 'rail' (colonne de gauche du Rail) ou 'chart'. Sert à ranger les
  // chiffres d'abord ET à décider qui un clic sur ◀ / ▶ dépasse : une tuile ne passe que devant les tuiles de SON groupe (voir moveTarget).
  function groupOf(layoutId, tile) {
    const id = normalizeLayoutId(layoutId);
    const type = tile && tile.type;
    if (id === 'grid') return 'chart';
    if (id === 'rail') return RAIL_TYPES.includes(type) ? 'rail' : 'chart';
    return FIGURE_TYPES.includes(type) ? 'figure' : 'chart';
  }

  /*
   * Le plan d'un agencement : `null` pour la grille (rien n'est posé, la page s'affiche comme avant), sinon
   *   { id, hasRail, order: [id, ...], items: { [tileId]: { group, span, rows, start?, hero?, first? } } }
   * `tiles` = [{ id, type }, ...] dans l'ordre ENREGISTRÉ ; `order` est l'ordre AFFICHÉ (chiffres d'abord, puis la vedette, puis le reste, chaque
   * groupe gardant l'ordre enregistré). `span` en colonnes sur 12 ; `rows` en rangées de ROW_UNIT px ; `start` = ligne de grille de départ,
   * posée seulement quand le Rail la veut (les tuiles du Rail restent à la ligne 1, les graphiques commencent à la ligne 2 — ou 1 s'il n'y a
   * aucune tuile de rail, la colonne de gauche disparaissant alors) ; `first` = la première tuile de chiffres (le chiffre phare) ;
   * `hero` = la vedette de l'agencement Vedette.
   */
  function plan(layoutId, tiles) {
    const id = normalizeLayoutId(layoutId);
    if (id === 'grid') return null;
    const list = (Array.isArray(tiles) ? tiles : []).filter((t) => t && typeof t.id === 'string');
    const items = {};
    const order = [];
    const rows = ROWS[id];
    const groupOfTile = (t) => groupOf(id, t);
    const figures = list.filter((t) => groupOfTile(t) === 'figure' || groupOfTile(t) === 'rail');
    const charts = list.filter((t) => groupOfTile(t) === 'chart');

    if (id === 'rail') {
      const hasRail = figures.length > 0;
      let firstFigure = true;
      figures.forEach((t) => {
        const isGauge = t.type === 'gauge';
        items[t.id] = { group: 'rail', span: 1, rows: isGauge ? rows.gauge : (hasGoal(t) ? rows.figureGoal : rows.figure), start: 1 };
        if (!isGauge && firstFigure) { items[t.id].first = true; firstFigure = false; }
        order.push(t.id);
      });
      const spans = spansFor(charts.length, 3);
      const starts = startsFor(spans, hasRail ? 2 : 1);
      charts.forEach((t, i) => {
        items[t.id] = { group: 'chart', span: spans[i], rows: rows.chart, start: starts[i] };
        order.push(t.id);
      });
      return { id, hasRail, order, items };
    }

    // Report / Board / Spotlight : la rangée de chiffres, en haut, sur toute la largeur.
    const perRowFigures = figuresPerRow(figures.length);
    const figureSpans = spansFor(figures.length, perRowFigures);
    figures.forEach((t, i) => {
      items[t.id] = { group: 'figure', span: figureSpans[i], rows: rows.figure };
      if (i === 0) items[t.id].first = true;
      order.push(t.id);
    });

    if (id === 'spotlight') {
      const hero = charts.find((t) => HERO_TYPES.includes(t.type));
      const others = charts.filter((t) => t !== hero);
      if (hero) {
        const beside = others.slice(0, 2);
        const rest = others.slice(2);
        items[hero.id] = { group: 'chart', span: beside.length ? 8 : COLUMNS, rows: rows.hero, hero: true };
        order.push(hero.id);
        // Deux tuiles à côté de la vedette se partagent sa hauteur ; une seule la prend en entier.
        beside.forEach((t) => {
          items[t.id] = { group: 'chart', span: COLUMNS - 8, rows: beside.length === 2 ? rows.chart : rows.hero };
          order.push(t.id);
        });
        const restSpans = spansFor(rest.length, 3);
        rest.forEach((t, i) => {
          items[t.id] = { group: 'chart', span: restSpans[i], rows: rows.chart };
          order.push(t.id);
        });
      } else {
        const spans = spansFor(charts.length, 3);
        charts.forEach((t, i) => {
          items[t.id] = { group: 'chart', span: spans[i], rows: rows.chart };
          order.push(t.id);
        });
      }
      return { id, hasRail: false, order, items };
    }

    const perRow = id === 'report' ? 2 : 3;
    const spans = spansFor(charts.length, perRow);
    charts.forEach((t, i) => {
      items[t.id] = { group: 'chart', span: spans[i], rows: rows.chart };
      order.push(t.id);
    });
    return { id, hasRail: false, order, items };
  }

  // Les tuiles dans l'ordre AFFICHÉ (copie ; l'original n'est jamais trié en place). Grille : l'ordre enregistré.
  function displayOrder(layoutId, tiles) {
    const p = plan(layoutId, tiles);
    if (!p) return tiles.slice();
    const byId = new Map(tiles.map((t) => [t.id, t]));
    return p.order.map((tid) => byId.get(tid));
  }

  // Cible d'un clic sur ◀ (direction -1) ou ▶ (+1) : la tuile la plus proche dans cette direction QUI EST DU MÊME GROUPE (sinon, en
  // dépassant un chiffre, un graphique ne changerait rien à l'écran). `null` si aucune (bouton désactivé). Grille : la voisine.
  function moveTarget(layoutId, tiles, id, direction) {
    const idx = tiles.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const group = groupOf(layoutId, tiles[idx]);
    for (let i = idx + direction; i >= 0 && i < tiles.length; i += direction) {
      if (groupOf(layoutId, tiles[i]) === group) return tiles[i].id;
    }
    return null;
  }

  // Miniature d'un agencement pour le menu Réglages : des rectangles dans une boîte de 60 x 40, de quatre sortes — 'frame' (cellule à
  // contour), 'fill' (aplat léger), 'hero' (aplat d'accent : la vedette ou le chiffre phare), 'rule' (filet, hauteur nulle). Pur : les
  // formes sont testées (toutes dans la boîte, aucune ne déborde sur une autre), le dessin SVG est fait par js/main.js.
  const THUMB_W = 60;
  const THUMB_H = 40;
  function thumb(layoutId) {
    const id = normalizeLayoutId(layoutId);
    const r = (kind, x, y, w, h) => ({ kind, x, y, w, h });
    if (id === 'report') {
      return [
        r('rule', 2, 3, 27, 0), r('rule', 31, 3, 27, 0), r('hero', 2, 6, 14, 5), r('fill', 31, 6, 9, 5),
        r('rule', 2, 15, 27, 0), r('fill', 2, 18, 27, 8), r('rule', 31, 15, 27, 0), r('fill', 31, 18, 27, 8),
        r('rule', 2, 29, 27, 0), r('fill', 2, 32, 27, 6), r('rule', 31, 29, 27, 0), r('fill', 31, 32, 27, 6)
      ];
    }
    if (id === 'board') {
      return [
        r('frame', 2, 2, 56, 36), r('hero', 6, 5, 14, 5), r('fill', 33, 5, 10, 5),
        r('rule', 2, 13, 56, 0), r('rule', 20.7, 13, 0, 25), r('rule', 39.3, 13, 0, 25), r('rule', 2, 25.5, 56, 0),
        r('fill', 6, 16, 11, 6), r('fill', 25, 16, 11, 6), r('fill', 44, 16, 11, 6),
        r('fill', 6, 28.5, 11, 6), r('fill', 25, 28.5, 11, 6), r('fill', 44, 28.5, 11, 6)
      ];
    }
    if (id === 'spotlight') {
      return [
        r('rule', 2, 3, 56, 0), r('hero', 2, 5, 15, 5), r('fill', 22, 5, 10, 5), r('fill', 40, 5, 10, 5),
        r('hero', 2, 15, 36, 14), r('fill', 42, 15, 16, 6), r('fill', 42, 23, 16, 6),
        r('fill', 2, 32, 16, 6), r('fill', 22, 32, 16, 6), r('fill', 42, 32, 16, 6)
      ];
    }
    if (id === 'rail') {
      return [
        r('hero', 2, 3, 13, 7), r('fill', 2, 13, 13, 7), r('fill', 2, 23, 13, 12), r('rule', 17, 2, 0, 36),
        r('fill', 20, 3, 11, 14), r('fill', 34, 3, 11, 14), r('fill', 48, 3, 10, 14),
        r('fill', 20, 22, 11, 14), r('fill', 34, 22, 11, 14), r('fill', 48, 22, 10, 14)
      ];
    }
    // grid : quatre colonnes de cellules à contour
    const cells = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) cells.push(r('frame', 2 + col * 14.5, 3 + row * 12.3, 12.5, 10.3));
    }
    return cells;
  }

  return {
    DEFAULT_LAYOUT, LAYOUT_ID, LAYOUTS, LAYOUT_IDS, COLUMNS, ROW_UNIT, ROWS, THUMB_W, THUMB_H,
    FIGURE_TYPES, RAIL_TYPES, HERO_TYPES,
    isKnown, hasGoal, normalizeLayoutId, isWellFormed, configValue, minWidthOf,
    spansFor, figuresPerRow, startsFor, groupOf, plan, displayOrder, moveTarget, thumb
  };
});
