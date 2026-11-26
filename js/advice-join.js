/*
 * « Relier la table d'une colonne Référence » (niveau 3d des suggestions, 25/11/2026) : une colonne Référence de Grist (`Ref:Clients`) ne contient
 * que des NUMÉROS DE LIGNE de l'autre table ; on ne peut ni la sommer ni la lire sur un axe (js/advice.js lui donne le rôle `reference`). Ce module
 * dit quand relier la table visée vaut la peine, ce que la jointure apporterait (« analyser par Ville, Segment ») et comment la poser.
 * Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-join.js).
 *
 * La jointure elle-même est celle du data blending (js/data.js:blendRows, le LEFT JOIN `Référence -> id` : une ligne de la table de travail pour une
 * ligne de l'autre table, donc JAMAIS un comptage multiplié). Ce module ne la fait pas : il rend `join = { secondaryTableId, primaryColumn,
 * secondaryColumn: 'id' }`, que l'appelant pose avec `GristBI.tableGraph.addJoin` (js/table-graph.js : plusieurs jointures à la fois depuis le lot 1).
 *
 * Règles (chaque porte a sa faute volontaire dans l'essai) :
 *   - une jointure déjà posée sur CETTE colonne vers CETTE table n'est pas reproposée (`opts.joined`, ou l'ancien `opts.blend` unique) ; au-delà de
 *     `MAX_JOINS` jointures, plus rien n'est proposé ;
 *   - seule une référence SIMPLE (`Ref:`) est proposée, jamais une liste (`RefList:`) ni la table de travail elle-même ;
 *   - la jointure doit retrouver ses lignes : au moins 80 % des références renseignées visent une ligne qui existe (et au moins 10 renseignées) ;
 *   - elle doit APPORTER un axe : une colonne de l'autre table qui, une fois jointe, a de 2 à 30 valeurs (catégorie) ou de 31 à 60 (libellé, comme un
 *     nom de client) — jugé sur les valeurs jointes, jamais sur le nom de la colonne ; une colonne quasi unique par ligne n'apporte rien ;
 *   - au plus deux propositions, la plus riche (le plus d'axes, puis la mieux retrouvée) d'abord.
 *
 * AUCUN TEXTE EN DUR : clés i18n littérales + variables, traduites par l'appelant.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./advice.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceJoin = factory(root.GristBI.data, root.GristBI.advice);
  }
})(typeof self !== 'undefined' ? self : this, function (data, advice) {
  'use strict';

  const TITLE_KEY = 'advice.join.title';
  const REASON_KEY = 'advice.join.reason';

  const MIN_FILLED = 10;        // références renseignées pour juger la jointure
  const MIN_COVERAGE = 0.8;     // part des références renseignées qui visent une ligne existante
  const MAX_PROPOSALS = 2;
  const MAX_JOINS = 12;         // le même plafond que js/table-graph.js
  const MAX_TARGETS = 4;        // tables de l'autre côté lues (une lecture par table)
  const MAX_AXES = 3;           // axes nommés dans la phrase
  const EVAL_SAMPLE = 4000;     // lignes jointes pour juger ce que la jointure apporte
  const LABEL_MAX_DISTINCT = 60; // au-delà, un libellé ne se lit plus sur un axe
  const IDEAL_CATEGORIES = 6;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' && v !== '' ? v : '');
  // Les lignes qui sont bien des lignes (une cellule `null` ou un nombre au milieu d'un tableau ne fait jamais tomber le calcul).
  const usable = (rows) => (Array.isArray(rows) ? rows.filter(isObject) : []);
  const filledRef = (v) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== '0';

  // Les jointures déjà posées, sous la forme `[{ table, primaryColumn }]` : `opts.joined` (les `joins` du store : `{ table, primaryColumn }`) et l'ancienne
  // jointure manuelle unique `opts.blend` (`{ secondaryTableId, primaryColumn }`). Une entrée mal formée est ignorée.
  function joinedOf(o) {
    const out = [];
    (Array.isArray(o.joined) ? o.joined : []).forEach((j) => {
      if (isObject(j) && text(j.table) && text(j.primaryColumn)) out.push({ table: j.table, primaryColumn: j.primaryColumn });
    });
    if (isObject(o.blend) && text(o.blend.secondaryTableId) && text(o.blend.primaryColumn)) out.push({ table: o.blend.secondaryTableId, primaryColumn: o.blend.primaryColumn });
    return out;
  }

  // Les colonnes Référence SIMPLE de la table de travail : `[{ column, table, filled, distinct }]`, au plus une par couple (colonne, table).
  // Le type vient du type Grist réel (`columnInfo`, ou le registre de js/advice.js) : jamais deviné sur le nom. Une colonne déjà jointe vers sa table n'y est plus.
  function candidates(rows, opts) {
    const o = opts || {};
    const clean = usable(rows);
    if (!clean.length) return [];
    const joined = joinedOf(o);
    const found = [];
    advice.profileColumns(clean, undefined, o.columnInfo).forEach((p) => {
      const m = /^Ref:(.+)$/.exec(p.gristType || '');
      if (!m || p.role !== 'reference' || m[1] === o.currentTable) return;
      if (joined.some((j) => j.table === m[1] && j.primaryColumn === p.id)) return;
      found.push({ column: p.id, table: m[1], filled: p.filled, distinct: p.distinct });
    });
    return found;
  }

  // Les tables qu'il faut LIRE pour juger les candidats (au plus `MAX_TARGETS`, sans doublon, ordre des colonnes).
  function tablesToLoad(cands) {
    const seen = [];
    (cands || []).forEach((c) => { if (seen.indexOf(c.table) === -1) seen.push(c.table); });
    return seen.slice(0, MAX_TARGETS);
  }

  // Un échantillon RÉPARTI de `n` lignes (jamais les premières) : de quoi juger les valeurs jointes sans copier toute la table.
  function spread(rows, n) {
    if (rows.length <= n) return rows;
    const step = rows.length / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
    return out;
  }

  // Ce que la jointure apporterait : `{ ok: true, proposal }` ou `{ ok: false, why: 'empty' | 'sparse' | 'coverage' | 'gain' }`.
  function evaluate(allRows, candidate, allSecondary, opts) {
    const o = opts || {};
    const rows = usable(allRows);
    const secondaryRows = usable(allSecondary);
    if (!rows.length || !candidate || !secondaryRows.length) return { ok: false, why: 'empty' };
    const ids = new Set(secondaryRows.map((r) => String(r.id)));
    let filled = 0;
    let found = 0;
    rows.forEach((r) => {
      const v = r[candidate.column];
      if (!filledRef(v)) return;
      filled++;
      if (ids.has(String(v))) found++;
    });
    if (filled < MIN_FILLED) return { ok: false, why: 'sparse' };
    const coverage = found / filled;
    if (coverage < MIN_COVERAGE) return { ok: false, why: 'coverage', coverage };

    const sample = spread(rows, EVAL_SAMPLE);
    const blended = data.blendRows(sample, secondaryRows, candidate.column, 'id', candidate.table);
    const prefix = candidate.table + '.';
    const newIds = Object.keys(blended[0] || {}).filter((k) => k.indexOf(prefix) === 0);
    if (!newIds.length) return { ok: false, why: 'gain' };
    const axes = advice.profileColumns(blended, newIds, o.columnInfo).filter((p) => (
      p.role === 'category' && !p.yearLike
    ) || (p.role === 'highCardinality' && p.kind === 'text' && p.distinct <= LABEL_MAX_DISTINCT))
      .map((p) => ({ id: p.id, name: p.id.slice(prefix.length), distinct: p.distinct, label: p.role !== 'category' }))
      // Les vraies catégories d'abord (les plus proches d'un nombre lisible de barres), les libellés ensuite.
      .sort((a, b) => (a.label - b.label) || (Math.abs(a.distinct - IDEAL_CATEGORIES) - Math.abs(b.distinct - IDEAL_CATEGORIES)));
    if (!axes.length) return { ok: false, why: 'gain' };

    const named = axes.slice(0, MAX_AXES).map((a) => a.name);
    return {
      ok: true,
      proposal: {
        column: candidate.column,
        table: candidate.table,
        join: { secondaryTableId: candidate.table, primaryColumn: candidate.column, secondaryColumn: 'id' },
        coverage,
        axes,
        titleKey: TITLE_KEY,
        titleVars: { table: candidate.table },
        reasonKey: REASON_KEY,
        reasonVars: { column: candidate.column, table: candidate.table, axes: named.join(', '), n: axes.length }
      }
    };
  }

  // Les propositions : `{ proposals, reason }`. `secondary` = `{ [table]: lignes }` des tables lues (une table absente = non lue, pas de proposition).
  // `reason` : `'full'` quand le plafond de jointures est atteint (rien n'est proposé), `''` sinon.
  function propose(rows, secondary, opts) {
    const o = opts || {};
    if (joinedOf(o).length >= MAX_JOINS) return { proposals: [], reason: 'full' };
    const out = [];
    candidates(rows, o).forEach((c) => {
      const res = evaluate(rows, c, isObject(secondary) ? secondary[c.table] : null, o);
      if (res.ok) out.push(res.proposal);
    });
    out.sort((a, b) => (b.axes.length - a.axes.length) || (b.coverage - a.coverage));
    return { proposals: out.slice(0, MAX_PROPOSALS), reason: '' };
  }

  return { candidates, tablesToLoad, evaluate, propose, TITLE_KEY, REASON_KEY, MIN_COVERAGE, MIN_FILLED, MAX_PROPOSALS };
});
