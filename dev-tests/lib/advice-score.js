/*
 * Le SCORE DE QUALITÉ des suggestions de tuiles (niveau 3d-3, 25/11/2026) : confronte ce que `advice.suggestTiles` propose pour chaque table du corpus
 * (dev-tests/lib/advice-corpus.js) à l'étalon écrit à la main (dev-tests/lib/advice-gold.js). Fonctions PURES, sans dépendance : l'appelant donne le
 * module d'avis (`advice`), le corpus et l'étalon, ce qui permet de rejouer le même score sur une autre version du code (voir test-advice-quality.js).
 *
 * Une note de 0 à 100 par table, quatre parts :
 *   - ATTENTES (55) : pour chaque attente de l'étalon, le rang de la première suggestion qui la remplit — pleine part dans les trois premières (ce
 *     qu'on voit d'emblée), 70 % entre le 4e et le 9e rang (derrière « Voir d'autres suggestions »), rien au-delà ; pondérées par `weight` ;
 *   - SÛRETÉ (20) : 10 points de moins par règle `never` (ou règle universelle) touchée par l'une des neuf premières suggestions ;
 *   - DIVERSITÉ (15) : intentions différentes dans les trois premières (trois : 15, deux : 9, une : 0) ;
 *   - EXPLICATION (10) : part des trois premières qui disent un FAIT tiré des données (`insightKey`) plutôt qu'une phrase générique.
 * Une seconde mesure, la COUVERTURE APRÈS COMPLÉMENTS : on pose les trois premières suggestions, puis jusqu'à cinq propositions de « Compléter ce
 * tableau de bord » ; part pondérée des attentes que ces tuiles remplissent (n'importe quel rang). Elle dit si l'assistant sait combler ce que l'accueil
 * n'a pas montré.
 */
'use strict';

const WINDOW_SHOWN = 3;       // suggestions visibles d'emblée
const WINDOW_ALL = 9;         // suggestions demandées (le reste est derrière « Voir d'autres suggestions »)
const BEYOND_CREDIT = 0.7;    // part d'une attente remplie entre le 4e et le 9e rang
const COMPLETION_STEPS = 5;
const POINTS = { wants: 55, safety: 20, diversity: 15, explanation: 10 };
const NEVER_PENALTY = 10;
const DIVERSITY_POINTS = { 3: 15, 2: 9, 1: 0 };

const RESERVED = new Set(['id', 'weight', 'any', 'has', 'same', 'axes']);

// Une valeur de tuile remplit-elle la condition ? (valeur, tableau « l'une de », expression régulière, fonction)
function valueMatches(cond, value) {
  if (Array.isArray(cond)) return cond.some((c) => valueMatches(c, value));
  if (cond instanceof RegExp) return typeof value === 'string' && cond.test(value);
  if (typeof cond === 'function') return !!cond(value);
  return value === cond;
}

// Une tuile (`tileData` d'une suggestion) remplit-elle une condition de l'étalon ?
function matches(tile, spec) {
  if (!tile || typeof tile !== 'object') return false;
  if (Array.isArray(spec.any)) return spec.any.some((s) => matches(tile, s));
  if (spec.same === true && !(tile.dimension && tile.dimension === tile.measure)) return false;
  if (Array.isArray(spec.has) && spec.has.some((k) => tile[k] === undefined || tile[k] === null || tile[k] === '')) return false;
  if (spec.axes) {
    const [list, k] = spec.axes;
    const axes = Array.isArray(tile.radarAxes) ? tile.radarAxes : [];
    if (axes.filter((a) => list.indexOf(a) !== -1).length < k) return false;
  }
  return Object.keys(spec).every((key) => RESERVED.has(key) || valueMatches(spec[key], tile[key]));
}

// Rang (à partir de 1) de la première suggestion de la liste qui remplit la condition, ou 0.
function rankOf(list, spec) {
  for (let i = 0; i < list.length; i++) if (matches(list[i].tileData || list[i], spec)) return i + 1;
  return 0;
}

const creditOf = (rank) => (rank >= 1 && rank <= WINDOW_SHOWN ? 1 : (rank > WINDOW_SHOWN && rank <= WINDOW_ALL ? BEYOND_CREDIT : 0));
const weightOf = (spec) => (typeof spec.weight === 'number' && spec.weight > 0 ? spec.weight : 1);

/**
 * La note d'UNE table. `list` = les suggestions (`advice.suggestTiles`, neuf au plus) ; `gold` = `{ want, never }` ; `globalNever` = règles universelles.
 * Rend `{ score, parts, wants: [{ id, rank, credit, weight }], hits: [id…] }`.
 */
function scoreTable(list, gold, globalNever) {
  const shown = (Array.isArray(list) ? list : []).slice(0, WINDOW_ALL);
  const wants = (gold.want || []).map((spec) => {
    const rank = rankOf(shown, spec);
    return { id: spec.id, rank, credit: creditOf(rank), weight: weightOf(spec) };
  });
  const totalWeight = wants.reduce((sum, w) => sum + w.weight, 0);
  const wantsPart = totalWeight ? POINTS.wants * wants.reduce((sum, w) => sum + w.credit * w.weight, 0) / totalWeight : POINTS.wants;

  const rules = (gold.never || []).concat(globalNever || []);
  const hits = rules.filter((rule) => shown.some((s) => matches(s.tileData || s, rule))).map((rule) => rule.id);
  const safetyPart = Math.max(0, POINTS.safety - NEVER_PENALTY * hits.length);

  const first = shown.slice(0, WINDOW_SHOWN);
  const intents = new Set(first.map((s) => s.intent).filter(Boolean));
  const diversityPart = first.length ? (DIVERSITY_POINTS[Math.min(3, intents.size)] || 0) : 0;
  const explained = first.filter((s) => !!s.insightKey).length;
  const explanationPart = first.length ? POINTS.explanation * explained / first.length : 0;

  const parts = { wants: wantsPart, safety: safetyPart, diversity: diversityPart, explanation: explanationPart };
  return { score: wantsPart + safetyPart + diversityPart + explanationPart, parts, wants, hits };
}

/**
 * Ce que l'assistant « Compléter » ajoute : on pose les trois premières suggestions puis jusqu'à `COMPLETION_STEPS` propositions (la première à
 * chaque tour) ; rend la part pondérée des attentes que les tuiles posées remplissent. `complete` = le module js/advice-complete.js (ou null).
 */
function coverageAfterCompletion(complete, set, list, gold, ask) {
  if (!complete || typeof complete.complete !== 'function') return null;
  const posed = list.slice(0, WINDOW_SHOWN).map((s) => s.tileData);
  for (let i = 0; i < COMPLETION_STEPS; i++) {
    const result = complete.complete(set.rows, posed, Object.assign({ limit: 1 }, ask || {}));
    const next = result && result.items && result.items[0];
    if (!next || !next.tileData) break;
    posed.push(next.tileData);
  }
  const wants = gold.want || [];
  const total = wants.reduce((sum, w) => sum + weightOf(w), 0);
  if (!total) return 1;
  const got = wants.reduce((sum, w) => sum + (posed.some((tile) => matches(tile, w)) ? weightOf(w) : 0), 0);
  return got / total;
}

/**
 * Le score de tout le corpus. `ctx` = `{ advice, complete?, corpus (la liste de `build()`), gold ({ GOLD, GLOBAL_NEVER }), options? }` ;
 * `options` est passé à `suggestTiles` en plus de `limit` et de `columnInfo`. Rend `{ tables: [{ name, … }], mean, coverageMean }`.
 */
function scoreCorpus(ctx) {
  const tables = ctx.corpus.map((set) => {
    const columnInfo = set.info || {};
    const ask = Object.assign({ limit: WINDOW_ALL, columnInfo }, ctx.options || {});
    const list = ctx.advice.suggestTiles(set.rows, undefined, ask);
    const gold = ctx.gold.GOLD[set.name];
    if (!gold) throw new Error('aucun étalon pour la table « ' + set.name + ' »');
    const result = scoreTable(list, gold, ctx.gold.GLOBAL_NEVER);
    const coverage = coverageAfterCompletion(ctx.complete, set, list, gold, { columnInfo });
    return Object.assign({ name: set.name, rows: set.rows.length, list, coverage }, result);
  });
  const mean = tables.reduce((sum, t) => sum + t.score, 0) / (tables.length || 1);
  const covered = tables.filter((t) => t.coverage !== null);
  const coverageMean = covered.length ? covered.reduce((sum, t) => sum + t.coverage, 0) / covered.length : null;
  return { tables, mean, coverageMean };
}

module.exports = { matches, rankOf, scoreTable, scoreCorpus, coverageAfterCompletion, POINTS, WINDOW_SHOWN, WINDOW_ALL, BEYOND_CREDIT, NEVER_PENALTY, COMPLETION_STEPS };
