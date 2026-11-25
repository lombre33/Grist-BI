/*
 * « Ajouter une page entière » (niveau 3d-2 des suggestions, 25/11/2026) : les modèles de rapport de js/models.js (vue d'ensemble, évolution,
 * répartition) servent aussi de PROPOSITIONS pour un tableau de bord déjà commencé. Une page n'est proposée que si elle apporte au moins trois
 * visualisations que les tuiles déjà posées (toutes pages) ne montrent pas encore ; elle ne contient QUE celles-là, jamais une question déjà
 * posée. Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-pages.js).
 *
 * Rien n'est recalculé ici : les tuiles sont celles de `models.build` (donc de js/advice.js:suggestTiles), la règle « question déjà posée » est celle
 * de js/advice-complete.js (`questionKeys` / `isAsked`), la page est posée par l'appelant (`store.addPage` puis `store.addTile`).
 *
 * Portes (chacune a sa faute volontaire dans l'essai) :
 *   - un tableau de bord VIDE n'a rien à compléter (c'est l'écran d'accueil qui propose) : aucune proposition ;
 *   - le modèle doit être constructible sur ces données (une date pour « évolution », une catégorie pour les autres) ;
 *   - au moins `MIN_NEW` = 3 visualisations nouvelles, et au moins la moitié de celles du modèle ;
 *   - une page qui porte déjà le même nom n'est pas reproposée (la personne l'a déjà posée ou renommée à la main) ;
 *   - deux visualisations de la même page qui posent la même question n'en font qu'une (une barre et un anneau de la même mesure par la même colonne) ;
 *   - deux propositions au plus, la plus fournie d'abord (à égalité, l'ordre des modèles).
 * Une fois la page posée, ses visualisations sont des tuiles posées : la même proposition ne revient pas (aucune nouvelle visualisation).
 *
 * AUCUN TEXTE EN DUR : clés i18n littérales + variables, traduites par l'appelant. Les titres des visualisations sont ceux que `opts.t` a déjà
 * résolus dans js/advice.js ; le nom de la page est celui du modèle (`models.page.*`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./advice.js'), require('./advice-complete.js'), require('./models.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.advicePages = factory(root.GristBI.advice, root.GristBI.adviceComplete, root.GristBI.models);
  }
})(typeof self !== 'undefined' ? self : this, function (advice, complete, models) {
  'use strict';

  const TITLE_KEY = 'advice.pages.title';
  // Une phrase par modèle : ce que la page fait VOIR (un modèle ajouté plus tard sans phrase n'est jamais proposé).
  const REASON_KEYS = {
    'vue-d-ensemble': 'advice.pages.reason.overview',
    evolution: 'advice.pages.reason.evolution',
    repartition: 'advice.pages.reason.breakdown'
  };

  const MIN_NEW = 3;          // visualisations nouvelles pour qu'une page vaille d'être ajoutée
  const MIN_SHARE = 0.5;      // part minimale de celles du modèle
  const MAX_PROPOSALS = 2;
  const MAX_TITLES = 3;       // titres cités dans la phrase (la suite est un point de suspension)

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' && v !== '' ? v : '');
  // Deux noms de page se comparent sans tenir compte des accents, des majuscules ni des espaces de bord.
  const sameName = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  // `rows` = les lignes telles que le widget les montre (colonnes dérivées d'une date comprises), `tiles` = les tuiles de TOUTES les pages,
  // `pages` = les pages du rapport (`[{ name }]`). `opts` : `t`, `lang`, `columnInfo` (comme js/advice.js), `columnIds` (facultatif).
  // Rend `{ proposals, reason }` : `reason` = `'rows'` (aucune ligne), `'empty'` (aucune tuile posée), sinon `''`.
  // Une proposition : `{ model, order, pageName, tiles, total, titleKey, titleVars, reasonKey, reasonVars }` — `tiles` = les visualisations
  // NOUVELLES (sans `id`, prêtes pour `store.addTile` une fois un id posé), `total` = celles du modèle entier.
  function propose(rows, tiles, pages, opts) {
    const o = opts || {};
    if (!Array.isArray(rows)) return { proposals: [], reason: 'rows' };
    // Une ligne qui n'en est pas une (`null`, un nombre) ne fait jamais tomber le profilage ; le tableau n'est copié que s'il y en a une.
    if (!rows.every(isObject)) rows = rows.filter(isObject);
    if (!rows.length) return { proposals: [], reason: 'rows' };
    const existing = (Array.isArray(tiles) ? tiles : []).filter((tile) => isObject(tile) && text(tile.type) && tile.type !== 'text');
    if (!existing.length) return { proposals: [], reason: 'empty' };
    const ctx = advice.analyzeColumns(rows, o.columnIds, o.columnInfo);
    if (!ctx.profiles.length) return { proposals: [], reason: 'rows' };
    // UN profilage pour les trois modèles (models.build le relit sinon à chaque fois).
    const pool = advice.suggestTiles(rows, o.columnIds, { limit: models.POOL, t: o.t, lang: o.lang, columnInfo: o.columnInfo });

    const asked = new Set();
    existing.forEach((tile) => complete.questionKeys(tile).forEach((k) => asked.add(k)));
    const taken = new Set((Array.isArray(pages) ? pages : []).map((p) => sameName(isObject(p) ? p.name : '')));

    const out = [];
    models.ids().forEach((id, order) => {
      const reasonKey = REASON_KEYS[id];
      if (!reasonKey) return;
      const built = models.build(id, rows, o.columnIds, { t: o.t, ctx, pool });
      if (!built.ok || taken.has(sameName(built.pageName))) return;
      const seen = new Set(asked);
      const fresh = [];
      built.tiles.forEach((tile) => {
        if (complete.isAsked(tile, seen)) return;
        fresh.push(tile);
        complete.questionKeys(tile).forEach((k) => seen.add(k));
      });
      if (fresh.length < Math.max(MIN_NEW, Math.ceil(built.tiles.length * MIN_SHARE))) return;
      const titles = fresh.slice(0, MAX_TITLES).map((tile) => text(tile.title) || tile.type).join(', ') + (fresh.length > MAX_TITLES ? '…' : '');
      out.push({
        model: id,
        order,
        pageName: built.pageName,
        tiles: fresh,
        total: built.tiles.length,
        titleKey: TITLE_KEY,
        titleVars: { page: built.pageName },
        reasonKey,
        reasonVars: { n: fresh.length, page: built.pageName, titles }
      });
    });
    out.sort((a, b) => (b.tiles.length - a.tiles.length) || (a.order - b.order));
    return { proposals: out.slice(0, MAX_PROPOSALS), reason: '' };
  }

  return { propose, TITLE_KEY, REASON_KEYS, MIN_NEW, MIN_SHARE, MAX_PROPOSALS, MAX_TITLES };
});
