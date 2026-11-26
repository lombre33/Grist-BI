/*
 * Les suggestions sur TOUT le document (lot 3 du chantier « Colonnes de toutes les tables », 26/11/2026) : « Pour compléter ce tableau de bord »
 * ne regarde plus seulement la table de travail, mais aussi les autres tables du document (au plus `MAX_TABLES` profilées). Pur JS, sans DOM
 * ni Grist, testable sous Node (dev-tests/test-advice-tables.js).
 *
 * Ce fichier n'invente aucun classement : chaque table est jugée PAR `js/advice-complete.js` (même profilage, mêmes portes, mêmes doublons, mêmes
 * manques), avec SES propres tuiles posées — une tuile qui lit `Clients` ne répond jamais à une question de `Ventes`, même si les deux tables ont
 * une colonne `Nom`. Il ne fait que (1) choisir quelles tables regarder (`pickTables`), (2) juger une table (`completeTable`) et (3) FUSIONNER
 * les résultats (`merge`) : une file par table, dont l'ordre interne ne change jamais, et à chaque pas la meilleure tête de file.
 *
 * Règles de la fusion (chacune a sa faute volontaire dans l'essai) :
 *   - une seule table en jeu : le résultat est EXACTEMENT celui de `complete` (rien n'est reclassé, rien n'est pénalisé deux fois) ;
 *   - à note égale, la table de travail passe devant, puis l'ordre des tables ;
 *   - un type déjà retenu depuis une AUTRE table pèse `SAME_TYPE_PENALTY` (comme dans `complete`, qui le fait déjà au sein d'une table) ;
 *   - au plus `MAX_PER_OTHER_TABLE` propositions d'une même autre table (une petite table de référence ne prend pas toute la liste) ;
 *   - jamais sous `MIN_SCORE` : mieux vaut moins de cartes.
 * Une proposition d'une AUTRE table porte `table` (son nom) et `tileData.table` : la tuile posée la lira ; celle de la table de travail a
 * `table: ''` et un `tileData` inchangé (jamais de champ `table` pour la table de travail, comme partout dans ce widget).
 *
 * AUCUN TEXTE EN DUR : les phrases sont celles de `js/advice-complete.js` ; l'appelant écrit le nom de la table.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./advice-complete.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceTables = factory(root.GristBI.adviceComplete);
  }
})(typeof self !== 'undefined' ? self : this, function (adviceComplete) {
  'use strict';

  const MAX_TABLES = 8;            // la table de travail + au plus 7 autres : chaque table lue coûte une lecture et un profilage
  const PER_TABLE = 3;             // propositions gardées de chaque table avant la fusion
  const MAX_PER_OTHER_TABLE = 2;   // au plus deux propositions d'une même autre table dans la liste finale
  const SAME_TYPE_PENALTY = 2;     // un type déjà retenu depuis une autre table (celui de js/advice-complete.js, entre tables)
  const DEFAULT_LIMIT = 3;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' && v !== '' ? v : '');
  const scored = (item) => isObject(item) && Number.isFinite(item.completeScore); // une proposition sans note n'est jamais retenue

  // Les tuiles qui lisent la table `id` : celles qui la nomment, et — pour la table de travail — celles qui n'en nomment aucune.
  function tilesOf(tiles, id, working) {
    return (Array.isArray(tiles) ? tiles : []).filter((tile) => {
      if (!isObject(tile)) return false;
      const own = text(tile.table);
      return working ? (!own || own === id) : own === id;
    });
  }

  // Les autres tables à profiler, dans l'ordre où elles méritent la lecture : celles que des tuiles lisent déjà (la personne s'y intéresse, et
  // leurs lignes sont souvent déjà là), puis celles que la table de travail vise par une colonne Référence (`linked`), puis les autres dans
  // l'ordre du document. Sans doublon, jamais la table de travail, au plus `MAX_TABLES - 1`. Une entrée qui n'est pas un nom est ignorée.
  function pickTables(names, working, tiles, linked) {
    const available = (Array.isArray(names) ? names : []).filter((n) => text(n) && n !== working);
    const known = new Set(available);
    const out = [];
    const take = (n) => { if (known.has(n) && out.indexOf(n) === -1) out.push(n); };
    (Array.isArray(tiles) ? tiles : []).forEach((tile) => { if (isObject(tile)) take(text(tile.table)); });
    (Array.isArray(linked) ? linked : []).forEach(take);
    available.forEach(take);
    return out.slice(0, MAX_TABLES - 1);
  }

  // Juge UNE table : `table` = { id, rows, columnInfo?, working? } ; `tiles` = TOUTES les tuiles du rapport (ce fichier retient celles de cette table).
  // Rend `{ id, working, result, items }` : `result` est ce que rend `complete` (items, missing, unused, covered), `items` ses propositions marquées.
  function completeTable(table, tiles, opts) {
    const o = opts || {};
    const working = !!(table && table.working);
    const id = table && typeof table.id === 'string' ? table.id : '';
    const empty = { items: [], missing: [], unused: [], covered: 0 };
    if (!table || !Array.isArray(table.rows) || !table.rows.length) return { id, working, result: empty, items: [] };
    let result;
    try {
      result = adviceComplete.complete(table.rows, tilesOf(tiles, id, working), {
        // La table de travail lit le registre des types Grist posé par le widget (`undefined`) ; une AUTRE table donne les siens, ou aucun (`{}`) :
        // jamais le registre de la table de travail, qui dirait qu'une colonne de même nom est une Référence.
        t: o.t, lang: o.lang, columnInfo: working ? table.columnInfo : (table.columnInfo || {}), limit: o.perTable > 0 ? o.perTable : PER_TABLE
      });
    } catch (e) {
      // Une table dont les lignes font échouer le profilage ne retire jamais les propositions des autres.
      return { id, working, result: empty, items: [], failed: true };
    }
    const items = result.items.map((item) => Object.assign({}, item, {
      table: working ? '' : id,
      tileData: working || !isObject(item.tileData) ? item.tileData : Object.assign({}, item.tileData, { table: id })
    }));
    return { id, working, result, items };
  }

  // Fusionne les résultats de `completeTable` (la table de travail d'abord dans la liste). Une file par table, dans son ordre ; à chaque pas la
  // meilleure TÊTE de file, avec le malus d'un type déjà retenu depuis une autre table.
  function merge(parts, opts) {
    const o = opts || {};
    const limit = o.limit > 0 ? o.limit : DEFAULT_LIMIT;
    const queues = (Array.isArray(parts) ? parts : []).filter(isObject).map((p, order) => ({ id: p.id, working: p.working, order, items: (Array.isArray(p.items) ? p.items : []).filter(scored), taken: 0 }));
    const chosen = [];
    const typeFrom = []; // { type, id } des propositions retenues
    while (chosen.length < limit) {
      let best = null;
      queues.forEach((q) => {
        if (!q.items.length || (!q.working && q.taken >= MAX_PER_OTHER_TABLE)) return;
        const head = q.items[0];
        const elsewhere = typeFrom.some((c) => c.type === head.type && c.id !== q.id);
        const score = head.completeScore - (elsewhere ? SAME_TYPE_PENALTY : 0);
        const better = !best || score > best.score || (score === best.score && (q.working && !best.q.working));
        if (better) best = { q, score };
      });
      if (!best || best.score < adviceComplete.MIN_SCORE) break;
      const item = best.q.items.shift();
      best.q.taken += 1;
      chosen.push(item);
      typeFrom.push({ type: item.type, id: best.q.id });
    }
    return chosen;
  }

  // Tout d'un coup (essais, petites tables) : `tables` = [{ id, rows, columnInfo?, working? }], la table de travail comprise.
  function completeAcross(tables, tiles, opts) {
    const parts = (Array.isArray(tables) ? tables : []).map((table) => completeTable(table, tiles, opts));
    const perTable = {};
    parts.forEach((p) => { perTable[p.id] = p.result; });
    return { items: merge(parts, opts), perTable };
  }

  return { pickTables, completeTable, merge, completeAcross, tilesOf, MAX_TABLES, PER_TABLE, MAX_PER_OTHER_TABLE, SAME_TYPE_PENALTY };
});
