/*
 * Les tables du document et les liens que leurs colonnes RÉFÉRENCE tracent entre elles (chantier « colonnes de toutes les tables », lot 1,
 * 26/11/2026, demande d'Antoine : se passer du choix d'une table, comme Publipostage+). Pur JS, sans DOM ni Grist, testable sous Node
 * (dev-tests/test-table-graph.js).
 *
 * Une colonne `Ref:Clients` de `Ventes` ne contient que le numéro de ligne d'UN client : suivre ce lien ne multiplie jamais les lignes (une ligne de
 * `Ventes` pour une ligne de `Clients`, c'est le `Référence -> id` de js/data.js:blendRows). On ne suit donc QUE ce sens-là, jamais l'inverse
 * (« les commandes d'un client » = plusieurs lignes, le lot 4) ni une liste de références (`RefList:`).
 *
 * Trois notions :
 *   - une ROUTE : le chemin de la table de travail à une autre table, en 1 ou 2 sauts de Référence (`Ventes.Client -> Clients`, puis
 *     `Clients.Pays -> Pays`). Jamais de cycle, jamais un retour à la table de travail ;
 *   - une JOINTURE `{ alias, table, primaryColumn, secondaryColumn: 'id' }` : ce qu'on enregistre avec le rapport (champ `joins` de
 *     BI_Dashboard_Config). `alias` préfixe les colonnes jointes (`Clients.Ville`) ; `primaryColumn` est une colonne des lignes DÉJÀ jointes
 *     avant elle (la table de travail, ou `Clients.Pays` pour le 2e saut) ;
 *   - une COLONNE VIRTUELLE : une colonne d'une table atteignable que les lignes n'ont pas encore ; la choisir pose les jointures de sa route.
 *
 * Le NOM d'une jointure (`alias`) ne change jamais une fois enregistré : des tuiles enregistrées lisent `Clients.Ville`. Un alias se choisit donc
 * UNE fois, à la création : la table elle-même (`Clients`) tant qu'une seule route y mène, sinon `Personnes (Livreur)` pour dire laquelle — et une
 * jointure déjà posée garde son nom même si une 2e Référence vers la même table apparaît ensuite dans le document.
 *
 * AUCUN TEXTE EN DUR : seulement des identifiants de table et de colonne.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.tableGraph = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_HOPS = 2;           // sauts de Référence suivis (Ventes -> Clients -> Pays)
  const MAX_ROUTES = 40;        // routes gardées (un document très relié ne noie pas les listes)
  const MAX_JOINS = 12;         // jointures enregistrées avec un rapport
  const MAX_ID_LENGTH = 160;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const validId = (v) => typeof v === 'string' && v !== '' && v.length <= MAX_ID_LENGTH && !/[\u0000-\u001f]/.test(v);

  // Colonnes qu'on ne propose jamais comme colonne d'une table liée : un numéro de ligne n'est pas une information (on le suit, on ne le lit pas),
  // une liste de références ou des pièces jointes n'ont pas de valeur unique par ligne, une colonne d'aide de Grist n'est pas à la personne.
  const HIDDEN_TYPES = /^(Ref:|RefList:|Attachments$)/;
  const HIDDEN_NAME = /^(id|manualSort|gristHelper_.*)$/;

  /**
   * `schema` = `{ tables: [{ id, columns: [{ id, type }] }] }` (js/grist-api.js:readSchema) -> `Map(tableId -> [{ id, type }])`.
   * Une table ou une colonne mal formée est ignorée : jamais une exception.
   */
  function indexSchema(schema) {
    const out = new Map();
    const list = isObject(schema) && Array.isArray(schema.tables) ? schema.tables : [];
    list.forEach((t) => {
      if (!isObject(t) || !validId(t.id) || out.has(t.id)) return;
      const seen = new Set();
      const columns = [];
      (Array.isArray(t.columns) ? t.columns : []).forEach((c) => {
        if (!isObject(c) || !validId(c.id) || seen.has(c.id)) return;
        seen.add(c.id);
        columns.push({ id: c.id, type: typeof c.type === 'string' ? c.type : '' });
      });
      out.set(t.id, columns);
    });
    return out;
  }

  // La table visée par une Référence SIMPLE (`Ref:Clients` -> `Clients`), `''` sinon (jamais `RefList:`).
  function refTarget(type) {
    const m = /^Ref:(.+)$/.exec(typeof type === 'string' ? type : '');
    return m ? m[1] : '';
  }

  /**
   * Les routes (1 à `maxHops` sauts) de `workingTable` vers les autres tables : `[{ target, steps: [{ table, column, target }] }]`, les routes à un
   * saut d'abord (dans l'ordre des colonnes), puis celles à deux sauts. Une table déjà traversée, et la table de travail, ne reviennent jamais ;
   * une table absente du document ne mène nulle part.
   */
  function routesFrom(schema, workingTable, maxHops) {
    const tables = schema instanceof Map ? schema : indexSchema(schema);
    const limit = maxHops > 0 ? Math.min(maxHops, MAX_HOPS) : MAX_HOPS;
    const routes = [];
    if (!tables.has(workingTable)) return routes;
    let frontier = [{ at: workingTable, steps: [], visited: [workingTable] }];
    for (let hop = 1; hop <= limit && routes.length < MAX_ROUTES; hop++) {
      const next = [];
      for (const node of frontier) {
        for (const col of tables.get(node.at) || []) {
          const target = refTarget(col.type);
          if (!target || !tables.has(target) || node.visited.indexOf(target) !== -1) continue;
          const steps = node.steps.concat([{ table: node.at, column: col.id, target }]);
          routes.push({ target, steps });
          next.push({ at: target, steps, visited: node.visited.concat([target]) });
          if (routes.length >= MAX_ROUTES) return routes;
        }
      }
      frontier = next;
    }
    return routes;
  }

  // Une jointure enregistrée par l'ancien réglage « Joindre une autre table » du menu Données (`blend`) est une jointure comme les autres.
  function legacyJoin(blend) {
    if (!isObject(blend) || !validId(blend.secondaryTableId) || !validId(blend.primaryColumn) || !validId(blend.secondaryColumn)) return null;
    return { alias: blend.secondaryTableId, table: blend.secondaryTableId, primaryColumn: blend.primaryColumn, secondaryColumn: blend.secondaryColumn };
  }

  // Toutes les jointures à jouer, dans l'ordre : le réglage manuel d'abord, puis celles qui viennent des Références. Deux jointures qui porteraient le
  // même alias (une configuration qui en a deux, ou le réglage manuel posé APRÈS une jointure de même nom) écraseraient leurs colonnes l'une l'autre :
  // la première gagne, la seconde est ignorée (jamais lue en silence à moitié).
  function allJoins(blend, joins) {
    const first = legacyJoin(blend);
    const seen = new Set();
    const out = [];
    (first ? [first] : []).concat(Array.isArray(joins) ? joins : []).forEach((j) => {
      if (!isObject(j) || typeof j.alias !== 'string' || seen.has(j.alias)) return;
      seen.add(j.alias);
      out.push(j);
    });
    return out;
  }

  /**
   * Nettoie les jointures lues d'une configuration (une ligne que quelqu'un d'autre a pu écrire) : une forme fermée, des textes courts, au plus
   * `MAX_JOINS`, un alias unique et jamais l'un des `reserved`. Rend un tableau NEUF de jointures NEUVES (jamais un objet de l'entrée).
   */
  function sanitizeJoins(raw, reserved) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    const taken = new Set(Array.isArray(reserved) ? reserved : []);
    for (const j of raw) {
      if (out.length >= MAX_JOINS) break;
      if (!isObject(j) || !validId(j.alias) || !validId(j.table) || !validId(j.primaryColumn) || !validId(j.secondaryColumn)) continue;
      if (taken.has(j.alias)) continue;
      taken.add(j.alias);
      out.push({ alias: j.alias, table: j.table, primaryColumn: j.primaryColumn, secondaryColumn: j.secondaryColumn });
    }
    return out;
  }

  function sameJoins(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((j, i) => j.alias === b[i].alias && j.table === b[i].table && j.primaryColumn === b[i].primaryColumn && j.secondaryColumn === b[i].secondaryColumn);
  }

  // La jointure déjà posée qui suit cette étape (même table visée, même colonne de départ) : `null` s'il n'y en a pas.
  function findJoin(joins, step, fromAlias) {
    const primary = fromAlias ? `${fromAlias}.${step.column}` : step.column;
    return (joins || []).find((j) => j.table === step.target && j.primaryColumn === primary && j.secondaryColumn === 'id') || null;
  }

  // Un alias libre : `table`, sinon `table (colonne)`, sinon `table (colonne) 2`…
  function freshAlias(table, via, taken, preferPlain) {
    const used = taken instanceof Set ? taken : new Set(taken || []);
    const plain = table;
    if (preferPlain && !used.has(plain)) return plain;
    const named = `${table} (${via})`;
    if (!used.has(named)) return named;
    let n = 2;
    while (used.has(`${named} ${n}`)) n++;
    return `${named} ${n}`;
  }

  /**
   * Résout une route face aux jointures déjà posées : pour chaque saut, soit la jointure existante, soit celle qu'il faudrait poser (avec son
   * alias). `siblingsOf(table)` = nombre de routes distinctes qui mènent à cette table : plus d'une, et l'alias dit par où l'on passe
   * (`Personnes (Livreur)`) au lieu de prendre le nom nu, que les tuiles enregistrées ne pourraient plus distinguer.
   */
  function resolveRoute(route, joins, siblingsOf) {
    const steps = [];
    const taken = new Set((joins || []).map((j) => j.alias));
    let fromAlias = '';
    route.steps.forEach((step) => {
      const existing = findJoin(joins, step, fromAlias);
      if (existing) {
        steps.push({ step, join: existing, alias: existing.alias, joined: true });
        fromAlias = existing.alias;
        return;
      }
      const primaryColumn = fromAlias ? `${fromAlias}.${step.column}` : step.column;
      const alone = (typeof siblingsOf === 'function' ? siblingsOf(step.target) : 1) <= 1;
      const alias = freshAlias(step.target, primaryColumn, taken, alone);
      taken.add(alias);
      steps.push({ step, join: { alias, table: step.target, primaryColumn, secondaryColumn: 'id' }, alias, joined: false });
      fromAlias = alias;
    });
    return steps;
  }

  const routeKey = (route) => route.steps.map((s) => `${s.table}.${s.column}`).join('>');

  /**
   * Les colonnes que la personne peut choisir dans les tables liées et que les lignes n'ont PAS encore : `[{ id, column, table, alias, type,
   * route }]` (`id` = `alias.colonne`, ce que les tuiles enregistrent). `present` = les colonnes des lignes actuelles (déjà jointes : pas virtuelles).
   * `joins` doit contenir TOUTES les jointures posées, le réglage manuel compris (`allJoins`).
   */
  function virtualColumns(schema, workingTable, joins, present) {
    const tables = schema instanceof Map ? schema : indexSchema(schema);
    const routes = routesFrom(tables, workingTable);
    const have = present instanceof Set ? present : new Set(present || []);
    const perTarget = new Map();
    routes.forEach((r) => perTarget.set(r.target, (perTarget.get(r.target) || 0) + 1));
    const siblingsOf = (table) => perTarget.get(table) || 0;
    const out = [];
    const ids = new Set();
    routes.forEach((route) => {
      const resolved = resolveRoute(route, joins, siblingsOf);
      const last = resolved[resolved.length - 1];
      (tables.get(route.target) || []).forEach((col) => {
        if (HIDDEN_NAME.test(col.id) || HIDDEN_TYPES.test(col.type)) return;
        const id = `${last.alias}.${col.id}`;
        if (have.has(id) || ids.has(id)) return;
        ids.add(id);
        out.push({ id, column: col.id, table: route.target, alias: last.alias, type: col.type, route: routeKey(route), joined: resolved.every((s) => s.joined), steps: resolved });
      });
    });
    return out;
  }

  /**
   * Les jointures à poser pour qu'une colonne virtuelle existe : celles de sa route qui ne sont pas encore là, dans l'ordre (le 2e saut part d'une
   * colonne du 1er). Vide si la route est déjà entièrement jointe.
   */
  function joinsToAdd(virtual) {
    return virtual && Array.isArray(virtual.steps) ? virtual.steps.filter((s) => !s.joined).map((s) => Object.assign({}, s.join)) : [];
  }

  /**
   * Ajoute une jointure demandée de l'extérieur (« Relier la table… » de js/advice-join.js, qui ne connaît que la table et la colonne) : la jointure
   * existante si elle y est déjà, sinon une nouvelle sous un alias libre (`join` vaut `null` au-delà de `MAX_JOINS`). Rend `{ joins, join, added }` — `joins`
   * est la liste d'entrée elle-même quand rien n'est ajouté.
   */
  function addJoin(joins, blend, table, primaryColumn) {
    const all = allJoins(blend, joins);
    const existing = all.find((j) => j.table === table && j.primaryColumn === primaryColumn && j.secondaryColumn === 'id');
    if (existing) return { joins: joins || [], join: existing, added: false };
    if (all.length >= MAX_JOINS) return { joins: joins || [], join: null, added: false };
    const alias = freshAlias(table, primaryColumn, new Set(all.map((j) => j.alias)), true);
    const join = { alias, table, primaryColumn, secondaryColumn: 'id' };
    return { joins: (joins || []).concat([join]), join, added: true };
  }

  /**
   * Retire la jointure `alias` et celles qui en dépendent (le 2e saut part d'une colonne du 1er : `Clients.Pays`). Rend `{ joins, removed }`.
   */
  function removeJoin(joins, alias) {
    const gone = new Set([alias]);
    let grew = true;
    while (grew) {
      grew = false;
      (joins || []).forEach((j) => {
        if (gone.has(j.alias)) return;
        for (const a of gone) { if (j.primaryColumn.indexOf(`${a}.`) === 0) { gone.add(j.alias); grew = true; break; } }
      });
    }
    const kept = (joins || []).filter((j) => !gone.has(j.alias));
    return { joins: kept, removed: (joins || []).filter((j) => gone.has(j.alias)).map((j) => j.alias) };
  }

  /**
   * Ce qui lit encore les colonnes de `alias` (ou des jointures qui en dépendent) : `{ tiles, filters, bookmarks }` (nombres). Une jointure
   * qu'on retire sous des tuiles ou des filtres qui la lisent les viderait (un filtre sur une colonne absente retire toutes les lignes) : l'appelant
   * refuse tant que ce n'est pas 0. `columnsOf(tile)` = js/advice-complete.js:columnsOfTile.
   */
  function usageOf(state, aliases, columnsOf) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    const uses = (column) => typeof column === 'string' && list.some((a) => column.indexOf(`${a}.`) === 0);
    const out = { tiles: 0, filters: 0, bookmarks: 0 };
    const s = isObject(state) ? state : {};
    (Array.isArray(s.pages) ? s.pages : []).forEach((page) => {
      (page && Array.isArray(page.tiles) ? page.tiles : []).forEach((tile) => {
        if (isObject(tile) && (columnsOf ? columnsOf(tile) : []).some(uses)) out.tiles++;
      });
    });
    const filterUses = (f) => isObject(f) && uses(f.column);
    out.filters = (Array.isArray(s.activeFilters) ? s.activeFilters : []).filter(filterUses).length
      + (Array.isArray(s.advancedFilters) ? s.advancedFilters : []).filter(filterUses).length;
    (Array.isArray(s.bookmarks) ? s.bookmarks : []).forEach((b) => {
      if (!isObject(b)) return;
      if ((Array.isArray(b.activeFilters) ? b.activeFilters : []).some(filterUses) || (Array.isArray(b.advancedFilters) ? b.advancedFilters : []).some(filterUses)) out.bookmarks++;
    });
    return out;
  }

  return {
    indexSchema, refTarget, routesFrom, legacyJoin, allJoins, sanitizeJoins, sameJoins, findJoin, freshAlias, resolveRoute, virtualColumns, joinsToAdd,
    addJoin, removeJoin, usageOf, MAX_HOPS, MAX_ROUTES, MAX_JOINS
  };
});
