/*
 * « Que faire avec cette colonne ? » (niveau 3 de l'intelligence des suggestions, 25/11/2026) : la personne choisit UNE colonne, on lui dit ce
 * qu'elle est (une mesure à additionner, une note à moyenner, une catégorie de N valeurs, une date, un identifiant…) et on lui propose jusqu'à
 * trois tuiles qui la lisent. Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-column.js).
 *
 * Tout le classement est celui de « Compléter ce tableau de bord » (js/advice-complete.js, option `column`) : les propositions viennent du MÊME
 * catalogue (js/advice.js:suggestAround met la colonne en tête de son rôle), jamais un doublon d'une tuile déjà posée, avec le manque qu'elles
 * comblent. Ce fichier ajoute ce que la question demande de plus :
 *   - le RÔLE de la colonne en une phrase (`advice.column.role.*`), déduit des VALEURS et du type Grist, jamais du seul nom ;
 *   - combien de tuiles du tableau de bord la lisent déjà ;
 *   - quand rien ne ressort, POURQUOI (tout est déjà posé, ou aucune tuile ne s'impose), jamais un silence.
 *
 * AUCUN TEXTE EN DUR : clés i18n littérales + variables, traduites par l'appelant.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./advice.js'), require('./advice-complete.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceColumn = factory(root.GristBI.advice, root.GristBI.adviceComplete);
  }
})(typeof self !== 'undefined' ? self : this, function (advice, complete) {
  'use strict';

  // Une phrase par rôle (littéraux : le test de couverture i18n les lit ici).
  const ROLE_KEYS = {
    measureSum: 'advice.column.role.measureSum',
    measureAvg: 'advice.column.role.measureAvg',
    score: 'advice.column.role.score',
    ordinal: 'advice.column.role.ordinal',
    category: 'advice.column.role.category',
    year: 'advice.column.role.year',
    time: 'advice.column.role.time',
    identifier: 'advice.column.role.identifier',
    manyValues: 'advice.column.role.manyValues',
    freeText: 'advice.column.role.freeText',
    reference: 'advice.column.role.reference',
    list: 'advice.column.role.list',
    constant: 'advice.column.role.constant',
    timePart: 'advice.column.role.timePart'
  };
  const USED_KEY = 'advice.column.used';
  const EMPTY_KEYS = { covered: 'advice.column.empty.covered', none: 'advice.column.empty.none' };

  const DEFAULT_LIMIT = 3;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' && v !== '' ? v : '');

  // Le rôle (clé de ROLE_KEYS) d'un profil de js/advice.js:profileColumns.
  function roleOf(p) {
    switch (p.role) {
      case 'measure':
        // Une note a une échelle qu'on peut dire (« sur 20 ») ; un pourcentage ou une échelle de 0 à 1 se moyenne, sans « note sur 1 ».
        if (p.score && !p.percent && p.scaleTop > 1) return 'score';
        if (p.ordinal) return 'ordinal';
        return advice.aggFor(p) === 'avg' ? 'measureAvg' : 'measureSum';
      case 'category': return p.yearLike ? 'year' : 'category';
      case 'time': return 'time';
      case 'identifier': return 'identifier';
      case 'highCardinality': return 'manyValues';
      case 'freeText': return 'freeText';
      case 'reference': return 'reference';
      case 'list': return 'list';
      case 'timePart': return 'timePart';
      default: return 'constant';
    }
  }

  // Les colonnes qu'on propose de choisir : celles de la table, sauf `id` et les colonnes DÉRIVÉES d'une date (`Date.Annee`, `.Trimestre`, `.Mois`,
  // que le widget ajoute lui-même : choisir `Date` les couvre toutes). Une colonne dont le nom ressemble à une dérivation mais dont la date
  // n'existe pas reste une vraie colonne.
  function pickableColumns(columnIds) {
    const ids = (Array.isArray(columnIds) ? columnIds : []).filter((c) => text(c) && c !== 'id');
    const present = new Set(ids);
    return ids.filter((c) => {
      const derived = advice.HIERARCHY_RE.exec(c);
      return !(derived && present.has(derived[1]));
    });
  }

  // Combien de tuiles posées (toutes pages, hors notes) lisent `column`.
  function usedBy(tiles, column) {
    return (Array.isArray(tiles) ? tiles : []).filter((t) => isObject(t) && t.type !== 'text' && complete.readsColumn(t, column)).length;
  }

  // Ce qu'on peut faire de `column` : `{ ok: true, column, role, roleKey, roleVars, usedBy, items, covered, missing, emptyKey }` ou
  // `{ ok: false, reason: 'rows' | 'column' }` (aucune ligne, colonne inconnue). `items` = les propositions de js/advice-complete.js (trois au plus),
  // `covered` = celles que le tableau de bord montre déjà, `emptyKey` = pourquoi la liste est vide (`''` quand elle ne l'est pas).
  // `opts.table` (lot 3C, 26/11/2026) : les lignes sont celles d'une AUTRE table que la table de travail — l'appelant ne passe alors que les tuiles
  // qui lisent cette table (`js/advice-tables.js:tilesOf`), les types Grist de SES colonnes (ou rien : jamais le registre de la table de travail,
  // qui dirait qu'une colonne de même nom est une Référence) et chaque proposition rend `table` + `tileData.table`, comme `completeTable` le fait.
  function describe(rows, tiles, column, opts) {
    const o = opts || {};
    if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: 'rows' };
    const other = text(o.table);
    const columnInfo = other ? (o.columnInfo || {}) : o.columnInfo;
    const profile = advice.profileColumns(rows, undefined, columnInfo).find((p) => p.id === column);
    if (!profile) return { ok: false, reason: 'column' };
    const role = roleOf(profile);
    const result = complete.complete(rows, tiles, { column, t: o.t, lang: o.lang, columnInfo, limit: o.limit > 0 ? o.limit : DEFAULT_LIMIT });
    const items = other
      ? result.items.map((item) => Object.assign({}, item, { table: other, tileData: isObject(item.tileData) ? Object.assign({}, item.tileData, { table: other }) : item.tileData }))
      : result.items;
    return {
      ok: true,
      column,
      role,
      roleKey: ROLE_KEYS[role],
      roleVars: { column, n: profile.distinct, top: profile.scaleTop || 0, base: profile.base || '' },
      usedBy: usedBy(tiles, column),
      items,
      covered: result.covered,
      missing: result.missing,
      emptyKey: items.length ? '' : (result.covered > 0 ? EMPTY_KEYS.covered : EMPTY_KEYS.none)
    };
  }

  return { describe, pickableColumns, roleOf, usedBy, ROLE_KEYS, USED_KEY, EMPTY_KEYS };
});
