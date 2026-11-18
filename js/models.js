/*
 * Modèles de rapport (consigne GFS 016, « Nouveau > Depuis un modèle ») : fonctions pures, testables
 * sous Node (voir dev-tests/test-data.js), sans DOM ni Grist — même convention que js/advice.js,
 * dont ce module dépend uniquement (`suggestTiles`/`analyzeColumns`).
 *
 * Un MODÈLE, ici, est un rapport de départ : une page de tuiles prête à l'emploi, posée sur UNE
 * table que la personne a déjà dans son document. Il ne crée jamais de table (le catalogue de
 * `modeles/modeles.json` ne porte donc jamais `tables: true`, voir CLAUDE.md §8) et ne code aucun nom
 * de colonne : il dit seulement quels RÔLES il attend (une date, une catégorie, une mesure), que
 * `advice.analyzeColumns` reconnaît dans les VALEURS de n'importe quelle table. Chaque modèle choisit
 * ses tuiles parmi `advice.suggestTiles` — les mêmes heuristiques (vraie mesure, anneau seulement
 * sans valeur négative, courbe seulement avec un axe temporel…) que l'écran d'accueil, jamais une
 * seconde copie à tenir à jour.
 *
 * AUCUN TEXTE EN DUR : les noms de page et titres propres à un modèle sont des clés i18n `models.*`
 * résolues par `opts.t` (comme `advice.suggestTiles`) ; le nom/la description que GFS affiche vivent
 * dans `modeles/modeles.json`, en français et en anglais.
 *
 * Contrat d'ouverture (contrats GFS 5.4, point 13) tenu par js/main.js:openModelById, pas ici : un `id`
 * inconnu, un type refusé ou une table qui ne convient pas ne rendent JAMAIS un rapport vierge à la
 * place — `build` rend `{ ok: false, missing }` et l'appelant répond `{ ouvert: false }`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./advice.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.models = factory(root.GristBI.advice);
  }
})(typeof self !== 'undefined' ? self : this, function (advice) {
  'use strict';

  // Le type de rapport du manifeste de GFS (`actions.ouvrir`) : celui des entrées du catalogue.
  const REPORT_TYPE = 'rapport';

  // Combien de suggestions demander à advice.suggestTiles : toutes (il y en a rarement plus d'une
  // vingtaine), pour que chaque modèle puisse piocher SON type de tuile dans l'ordre de pertinence.
  const POOL = 60;

  // Au moins ce nombre de tuiles pour que le résultat soit un rapport, pas une tuile seule.
  const MIN_TILES = 2;

  // Un modèle = `pageKey` (nom de la page, clé i18n), `needs` (rôle sans lequel il n'a pas de sens :
  // 'category' = une colonne de catégories, 'time' = un axe temporel), `required` (type de tuile
  // sans lequel il n'a pas de sens) et `slots` : les tuiles, dans l'ordre d'affichage, chacune étant
  // « les n premières suggestions de ce type » (+ `patch`, un changement de tuile propre au modèle).
  // `fresh` (facultatif) n'accepte qu'une dimension qu'AUCUNE tuile déjà posée n'utilise (la seconde
  // barre d'un modèle de répartition : « par région » après « par produit », pas deux fois « par
  // produit » avec une autre mesure) ; sans lui, une dimension déjà utilisée passe seulement après
  // les neuves.
  // `seasonal` (facultatif) : barres par MOIS de l'année (la saisonnalité), sur la colonne dérivée
  // `<date>.Mois` (js/data.js:deriveDateHierarchyColumns, valeurs '01'..'12' triées par libellé) quand
  // le tableau a une date ; sinon, la meilleure barre de temps que advice.suggestTiles propose.
  // `dim` (facultatif) restreint la dimension de la tuile : 'plain' = une vraie catégorie (jamais une
  // année, un mois ou la date elle-même, qui ont leurs propres tuiles), 'time' = seulement une
  // dimension de temps (les barres par mois d'un modèle d'évolution : la saisonnalité).
  // L'ordre de `slots` est celui de la page : chiffres clés d'abord.
  const MODELS = {
    'vue-d-ensemble': {
      pageKey: 'models.page.overview',
      needs: ['category'],
      required: 'bar',
      slots: [
        { type: 'kpi', n: 2 },
        { type: 'line', n: 1, patch: { areaFill: true } },
        { type: 'bar', n: 1, dim: 'plain' },
        { type: 'pie', n: 1, dim: 'plain' }
      ]
    },
    evolution: {
      pageKey: 'models.page.evolution',
      needs: ['time'],
      required: 'line',
      slots: [
        { type: 'kpi', n: 1 },
        { type: 'line', n: 1, patch: { areaFill: true } },
        { type: 'line', n: 1, series: true },
        { type: 'bar', n: 1, dim: 'time', seasonal: true }
      ]
    },
    repartition: {
      pageKey: 'models.page.breakdown',
      needs: ['category'],
      required: 'bar',
      slots: [
        { type: 'bar', n: 1, dim: 'plain' },
        { type: 'bar', n: 1, dim: 'plain', fresh: true },
        { type: 'pie', n: 1, dim: 'plain' },
        { type: 'treemap', n: 1, dim: 'plain' },
        { type: 'pivot', n: 1, dim: 'plain' }
      ]
    }
  };

  function ids() { return Object.keys(MODELS); }
  function has(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MODELS, id); }

  // Les rôles que `needs` demande et que ce tableau n'a pas : `[]` = rien ne manque. Une table sans
  // aucune ligne n'a ni catégorie ni axe : elle rend `['data']`, jamais un rapport à vide.
  function missingRoles(model, ctx, rows) {
    if (!rows.length || !ctx.profiles.length) return ['data'];
    const missing = [];
    model.needs.forEach((role) => {
      if (role === 'time' && !ctx.time) missing.push('time');
      if (role === 'category' && !ctx.categories.length) missing.push('category');
    });
    return missing;
  }

  // Cette colonne est-elle une dimension de TEMPS (date, année, trimestre, mois — dérivés ou non) ?
  function isTimeDimension(ctx, column) {
    const p = ctx.byId && ctx.byId.get(column);
    if (ctx.time && (column === ctx.time.dimension || column === ctx.time.base)) return true;
    return Boolean(p) && (p.role === 'timePart' || p.role === 'time' || p.timeLike === true || p.yearLike === true);
  }

  // Colonne de séries pour la courbe d'« évolution » : une vraie catégorie TEXTE de 2 à 6 valeurs (les
  // couleurs de la palette ne vont pas au-delà de 8 séries, et au-delà de 6 la lecture se perd), jamais
  // la colonne qui sert déjà d'axe.
  function seriesColumnFor(ctx, tile) {
    const taken = [tile.dimension, tile.measure];
    return ctx.categories.find((p) => p.kind === 'text' && p.distinct >= 2 && p.distinct <= 6 && taken.indexOf(p.id) === -1) || null;
  }

  // Tuiles du modèle `id` pour ce tableau. `rows` = les lignes déjà enrichies des colonnes dérivées
  // (js/main.js:withDateHierarchies), `columnIds` = ses colonnes (par défaut celles de la 1re ligne).
  // `opts.t` résout les titres persistés et le nom de page dans la langue courante.
  // Rend `{ ok: true, pageName, tiles }` (tuiles SANS `id`, prêtes pour `store.addTile` une fois un id
  // posé) ou `{ ok: false, missing }` : `missing` ∈ 'data' | 'time' | 'category' — de quoi dire à la
  // personne ce qui manque (clés `models.need.*`). `{ ok: false, unknown: true }` pour un `id` inconnu.
  function build(id, rows, columnIds, opts) {
    if (!has(id)) return { ok: false, unknown: true, missing: [] };
    const model = MODELS[id];
    rows = Array.isArray(rows) ? rows : [];
    const t = (opts && typeof opts.t === 'function') ? opts.t : null;
    const ctx = advice.analyzeColumns(rows, columnIds);
    const missing = missingRoles(model, ctx, rows);
    if (missing.length) return { ok: false, missing };

    const pool = advice.suggestTiles(rows, columnIds, { limit: POOL, t: t || undefined });
    const used = new Set();
    const tiles = [];
    model.slots.forEach((slot) => {
      if (slot.series) {
        // Même courbe que la première du modèle (même axe, même mesure), mais une série par valeur
        // d'une catégorie. Sans catégorie qui s'y prête, cette tuile n'existe pas : la dupliquer
        // telle quelle n'apprendrait rien.
        const base = tiles.find((tile) => tile.type === slot.type);
        const series = base && seriesColumnFor(ctx, base);
        if (!series) return;
        const profile = ctx.byId && ctx.byId.get(base.measure);
        const tile = Object.assign({}, base, {
          seriesColumn: series.id,
          areaFill: true,
          // Empilé seulement sans valeur négative : une aire empilée de signes mêlés se lit mal.
          stacked: !profile || profile.negatives === 0
        });
        tile.title = t ? t('models.title.seriesBy', { measure: base.measure, series: series.id }) : `${base.measure} / ${series.id}`;
        tiles.push(tile);
        return;
      }
      if (slot.seasonal) {
        const line = tiles.find((tile) => tile.type === 'line');
        const monthColumn = line && ctx.time && ctx.byId.has(`${ctx.time.base}.Mois`) ? `${ctx.time.base}.Mois` : null;
        if (monthColumn) {
          const vars = { measure: line.measure, dimension: monthColumn };
          tiles.push({
            type: 'bar', dimension: monthColumn, measure: line.measure, aggFn: line.aggFn, sortMode: 'label',
            title: t ? t('advice.title.byDimension', vars) : `${line.measure} / ${monthColumn}`
          });
          return;
        }
      }
      const fits = (s) => {
        if (s.type !== slot.type || used.has(s)) return false;
        const dims = [s.tileData.dimension, s.tileData.columnDimension].filter(Boolean);
        if (slot.dim === 'plain') return !dims.some((d) => isTimeDimension(ctx, d));
        if (slot.dim === 'time') return dims.length > 0 && dims.every((d) => isTimeDimension(ctx, d));
        return true;
      };
      const dimsOf = (s) => [s.tileData.dimension, s.tileData.columnDimension].filter(Boolean);
      const seen = new Set();
      tiles.forEach((tile) => [tile.dimension, tile.columnDimension].filter(Boolean).forEach((d) => seen.add(d)));
      const isFresh = (s) => !dimsOf(s).some((d) => seen.has(d));
      let candidates = pool.filter(fits);
      candidates = slot.fresh
        ? candidates.filter(isFresh)
        : candidates.filter(isFresh).concat(candidates.filter((s) => !isFresh(s)));
      candidates.slice(0, slot.n).forEach((s) => {
        used.add(s);
        // Copie : le modèle ne modifie jamais la suggestion de advice.js.
        tiles.push(Object.assign({}, s.tileData, slot.patch || {}));
      });
    });

    if (tiles.length < MIN_TILES || !tiles.some((tile) => tile.type === model.required)) {
      // Les rôles étaient là mais les heuristiques n'ont rien de lisible à proposer (ex. aucune
      // vraie mesure ni colonne à compter) : dit comme « il manque des données ».
      return { ok: false, missing: ['data'] };
    }
    return { ok: true, pageName: t ? t(model.pageKey) : id, tiles };
  }

  return { REPORT_TYPE, MODELS, ids, has, build };
});
