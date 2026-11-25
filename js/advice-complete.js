/*
 * « Compléter ce tableau de bord » (niveau 3 de l'intelligence des suggestions, 25/11/2026) : à partir des tuiles DÉJÀ posées, quelles tuiles
 * apporteraient quelque chose de nouveau ? Pur JS, sans DOM ni Grist, testable sous Node (dev-tests/test-advice-complete.js).
 *
 * `js/advice.js:suggestTiles` dit ce que les DONNÉES ont à raconter ; ce fichier le confronte à ce que le tableau de bord RACONTE DÉJÀ :
 *   1. DOUBLONS : une tuile qui pose la même question qu'une tuile existante n'apprend rien (même mesure et même axe en barres puis en
 *      anneau, le même croisement en tableau croisé puis en carte de chaleur…) : elle n'est jamais proposée (`questionKeys`) ;
 *   2. MANQUES : chaque tuile répond à une intention (l'évolution, la répartition, la relation, la concentration…, voir
 *      js/advice.js:INTENT_BY_TYPE). Une intention que les données permettent et qu'aucune tuile ne sert passe devant (`GAP_BONUS`) et la
 *      carte le dit : « Rien ne montre encore l'évolution dans le temps » ;
 *   3. COLONNES ÉCARTÉES : une vraie colonne (mesure, catégorie, date) qu'aucune tuile ne lit est une raison de plus (`NEW_COLUMN_BONUS`).
 * La sélection est GLOUTONNE : chaque tuile retenue change l'état (son intention est servie, ses colonnes lues, sa question posée) avant le
 * choix de la suivante, donc trois cartes ne servent jamais trois fois la même intention ni ne répètent un type.
 *
 * AUCUN TEXTE EN DUR : clés i18n littérales (`advice.gap.*`, `advice.complete.newColumn`) + variables, traduites par l'appelant. Un
 * tableau de bord sans aucune tuile n'est pas l'affaire de ce fichier (c'est l'écran d'accueil, js/welcome.js) : il rend alors les
 * meilleures suggestions, sans manque ni colonne écartée.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./advice.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceComplete = factory(root.GristBI.advice);
  }
})(typeof self !== 'undefined' ? self : this, function (advice) {
  'use strict';

  // Les colonnes qu'une tuile lit (champs à une colonne, puis listes de colonnes). Une valeur qui n'est pas du texte est ignorée.
  const COLUMN_FIELDS = [
    'dimension', 'measure', 'measureY', 'measureSize', 'columnDimension', 'seriesColumn', 'targetColumn', 'startColumn', 'endColumn',
    'dateColumn', 'radarEntityColumn', 'trendDimension', 'drillDimension'
  ];
  const COLUMN_LISTS = ['drillDimensions', 'radarAxes', 'columns'];

  // Les intentions qu'une tuile absente peut combler, chacune avec la phrase qui le dit (littéraux : le test de couverture i18n les lit ici).
  const GAP_KEYS = {
    overview: 'advice.gap.overview',
    trend: 'advice.gap.trend',
    compare: 'advice.gap.compare',
    share: 'advice.gap.share',
    relation: 'advice.gap.relation',
    cross: 'advice.gap.cross',
    profile: 'advice.gap.profile',
    concentrate: 'advice.gap.concentrate',
    distribution: 'advice.gap.distribution',
    change: 'advice.gap.change',
    stages: 'advice.gap.stages',
    rhythm: 'advice.gap.rhythm',
    schedule: 'advice.gap.schedule',
    structure: 'advice.gap.structure',
    goal: 'advice.gap.goal'
  };
  const NEW_COLUMN_KEY = 'advice.complete.newColumn';

  const GAP_BONUS = 1.5;          // une intention qu'aucune tuile ne sert encore
  const NEW_COLUMN_BONUS = 0.6;   // par colonne qu'aucune tuile ne lit (au plus MAX_NEW_COLUMNS comptées)
  const MAX_NEW_COLUMNS = 2;
  const SERVED_TWICE_PENALTY = 0.75; // une intention déjà servie par deux tuiles au moins
  const SAME_TYPE_PENALTY = 2;    // un type déjà retenu dans cette liste
  const DULL_INTEREST = 0.2;      // en dessous : les données n'ont « rien à montrer » avec cette tuile, elle ne complète rien
  const MIN_SCORE = 4;            // un reste de liste (note d'avant bonus et pénalités) sous ce seuil n'est pas proposé : mieux vaut moins de cartes
  const CANDIDATE_LIMIT = 80;
  const DEFAULT_LIMIT = 3;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' && v !== '' ? v : '');
  // `Date.Mois` se lit sur la colonne `Date` : la dérivation (js/data.js:deriveDateHierarchyColumns) n'est pas une colonne de plus.
  const baseOf = (id) => { const i = id.indexOf('.'); return i > 0 ? id.slice(0, i) : id; };

  function columnsOfTile(tile) {
    const out = [];
    if (!isObject(tile)) return out;
    COLUMN_FIELDS.forEach((f) => { if (text(tile[f])) out.push(tile[f]); });
    COLUMN_LISTS.forEach((f) => { if (Array.isArray(tile[f])) tile[f].forEach((c) => { if (text(c)) out.push(c); }); });
    return out;
  }

  // Les questions qu'une tuile POSÉE couvre, sous une ou plusieurs clés — la PREMIÈRE est celle qu'elle pose elle-même, les suivantes celles
  // qu'elle dit en plus : une suggestion est un doublon quand sa première clé est couverte (`isAsked`), jamais quand elle ne partage qu'une clé
  // secondaire (le chiffre avec son objectif couvre le chiffre nu, pas l'inverse). Compter des lignes (`count`) ne dépend d'aucune colonne :
  // la colonne comptée n'est qu'un nom.
  function questionKeys(tile) {
    if (!isObject(tile) || !text(tile.type)) return [];
    const type = tile.type;
    const agg = text(tile.aggFn) || 'sum';
    const measure = (m, a) => (a === 'count' ? '*' : (text(m) || '?'));
    const dim = text(tile.dimension);
    const series = text(tile.seriesColumn);
    switch (type) {
      case 'bar': case 'line': case 'pie': case 'treemap': case 'funnel':
        return [`ranked|${dim}|${measure(tile.measure, agg)}|${agg}|${series}`];
      case 'kpi': case 'gauge': {
        const base = `value|${measure(tile.measure, agg)}|${agg}|`;
        // Un chiffre avec son objectif dit aussi ce que dit le chiffre nu ; l'inverse est faux.
        return text(tile.targetColumn) || Number.isFinite(tile.target) ? [base + (text(tile.targetColumn) || 'fixed'), base] : [base];
      }
      case 'pivot': case 'heatmap': case 'sankey': case 'sunburst': {
        const dims = [dim, text(tile.columnDimension)].concat(type === 'sunburst' && Array.isArray(tile.drillDimensions) ? tile.drillDimensions.filter(text) : []).filter(Boolean);
        return [`cross|${Array.from(new Set(dims)).sort().join('+')}|${measure(tile.measure, agg)}|${agg}`];
      }
      case 'scatter':
        return [`relation|${[text(tile.measure), text(tile.measureY)].sort().join('+')}|${dim}`];
      case 'combo':
        return tile.comboMode === 'pareto'
          ? [`pareto|${dim}|${measure(tile.measure, agg)}|${agg}`]
          : [`relation|${[text(tile.measure), text(tile.measureY)].sort().join('+')}|${dim}`];
      case 'histogram': return [`hist|${text(tile.measure)}`];
      case 'box': return [`box|${text(tile.measure)}|${dim}`];
      case 'waterfall': return [`waterfall|${dim}|${measure(tile.measure, agg)}|${agg}`];
      case 'calendar': return [`calendar|${dim}`];
      case 'gantt': return [`gantt|${text(tile.startColumn)}|${text(tile.endColumn)}`];
      case 'progress': return [`progress|${dim}|${measure(tile.measure, agg)}|${agg}`];
      case 'radar': return [`radar|${dim}|${(Array.isArray(tile.radarAxes) ? tile.radarAxes.filter(text).slice().sort().join('+') : '')}|${text(tile.radarEntityColumn)}`];
      default: return [];
    }
  }

  // Cette suggestion pose-t-elle une question qu'une tuile couvre déjà ? (Un type sans clé n'est jamais un doublon.)
  const isAsked = (tile, asked) => { const keys = questionKeys(tile); return keys.length > 0 && asked.has(keys[0]); };

  // Ce que dit déjà une tuile posée : une ou deux intentions. Une barre dont l'axe est du temps montre une évolution.
  function intentsOfTile(tile, ctx) {
    if (!isObject(tile) || !text(tile.type)) return [];
    const type = tile.type;
    if (type === 'kpi') return (text(tile.targetColumn) || Number.isFinite(tile.target)) ? ['overview', 'goal'] : ['overview'];
    if (type === 'gauge') return ['overview'];
    if (type === 'combo') return [tile.comboMode === 'pareto' ? 'concentrate' : 'relation'];
    if (type === 'bar') {
      const dim = text(tile.dimension);
      const p = ctx && (ctx.byId.get(dim) || ctx.byId.get(baseOf(dim)));
      const timeLike = !!p && (p.role === 'time' || p.role === 'timePart' || p.yearLike || p.timeLike);
      return [timeLike ? 'trend' : 'compare'];
    }
    const intent = advice.INTENT_BY_TYPE[type];
    return intent ? [intent] : [];
  }

  // Les intentions qu'une SUGGESTION servirait : celle que js/advice.js lui donne, puis celles que dirait la même tuile une fois posée (un chiffre
  // avec objectif sert aussi « le chiffre clé » ; une barre dont l'axe est du temps montre l'évolution, pas une comparaison).
  function intentsOfSuggestion(s, ctx) {
    const posed = intentsOfTile(s.tileData, ctx);
    const first = s.type === 'bar' && posed.length ? posed[0] : s.intent;
    return Array.from(new Set([first].concat(posed))).filter((i) => GAP_KEYS[i]);
  }

  // Les colonnes qui valent d'être lues par une tuile : de vraies mesures, des catégories, des dates — jamais un identifiant, une référence, une
  // liste, du texte libre, une constante, un numéro de mois ou de jour.
  function meaningfulColumns(ctx) {
    return ctx.profiles
      .filter((p) => (p.role === 'measure' && !p.ordinal) || p.role === 'category' || p.role === 'time')
      .map((p) => p.id);
  }

  // Complète `tiles` (les tuiles déjà posées, toutes pages) avec ce que `rows` permettent encore. Rend
  // `{ items, missing, unused, covered }` : `items` = les suggestions retenues (celles de js/advice.js:suggestTiles, plus `gapIntent`/`gapKey`
  // quand elles comblent une intention, `newColumns` les colonnes qu'elles font lire pour la 1re fois, `completeScore`) ; `missing` = les
  // intentions que les données permettent et qu'aucune tuile ne sert ; `unused` = les vraies colonnes qu'aucune tuile ne lit ; `covered` =
  // les suggestions écartées parce qu'une tuile pose déjà leur question.
  function complete(rows, tiles, opts) {
    const o = opts || {};
    const limit = o.limit > 0 ? o.limit : DEFAULT_LIMIT;
    const empty = { items: [], missing: [], unused: [], covered: 0 };
    if (!Array.isArray(rows) || !rows.length) return empty;
    const existing = (Array.isArray(tiles) ? tiles : []).filter((t) => isObject(t) && text(t.type) && t.type !== 'text');
    const ctx = advice.analyzeColumns(rows, undefined, o.columnInfo);
    if (!ctx.profiles.length) return empty;
    const suggestions = advice.suggestTiles(rows, undefined, { t: o.t, lang: o.lang, columnInfo: o.columnInfo, limit: CANDIDATE_LIMIT });

    const asked = new Set();
    const served = new Map(); // intention -> nombre de tuiles qui la servent
    const read = new Set();   // colonnes lues (et leur colonne de base)
    const state = { add(tile) {
      questionKeys(tile).forEach((k) => asked.add(k));
      intentsOfTile(tile, ctx).forEach((i) => served.set(i, (served.get(i) || 0) + 1));
      columnsOfTile(tile).forEach((c) => { read.add(c); read.add(baseOf(c)); });
    } };
    existing.forEach((t) => state.add(t));

    const fresh = suggestions.filter((s) => !(typeof s.interest === 'number' && s.interest < DULL_INTEREST));
    const open = fresh.filter((s) => !isAsked(s.tileData, asked));
    const covered = fresh.length - open.length;
    const meaningful = meaningfulColumns(ctx);
    const unused = existing.length ? meaningful.filter((c) => !read.has(c)) : [];
    const missing = existing.length
      ? Array.from(new Set([].concat(...open.map((s) => intentsOfSuggestion(s, ctx))))).filter((i) => !served.has(i))
      : [];

    const newColumnsOf = (s) => {
      if (!existing.length) return [];
      const out = [];
      columnsOfTile(s.tileData).forEach((c) => {
        const base = baseOf(c);
        if (meaningful.indexOf(base) !== -1 && !read.has(c) && !read.has(base) && out.indexOf(base) === -1) out.push(base);
      });
      return out;
    };

    const items = [];
    const left = open.slice();
    const typesChosen = new Set();
    while (items.length < limit && left.length) {
      let best = -1;
      let bestScore = -Infinity;
      let bestInfo = null;
      left.forEach((s, i) => {
        if (isAsked(s.tileData, asked)) return; // une tuile retenue vient de poser cette question
        const intents = intentsOfSuggestion(s, ctx);
        const gap = existing.length ? (intents.find((i) => !served.has(i)) || null) : null;
        const newColumns = newColumnsOf(s);
        let score = s.score;
        if (gap) score += GAP_BONUS;
        else if (intents.length && intents.every((i) => (served.get(i) || 0) >= 2)) score -= SERVED_TWICE_PENALTY;
        score += NEW_COLUMN_BONUS * Math.min(MAX_NEW_COLUMNS, newColumns.length);
        if (typesChosen.has(s.type)) score -= SAME_TYPE_PENALTY;
        if (score > bestScore) { bestScore = score; best = i; bestInfo = { gap, newColumns }; }
      });
      if (best < 0 || bestScore < MIN_SCORE) break;
      const s = left.splice(best, 1)[0];
      const item = Object.assign({}, s, {
        completeScore: Math.round(bestScore * 100) / 100,
        newColumns: bestInfo.newColumns
      });
      if (bestInfo.gap) { item.gapIntent = bestInfo.gap; item.gapKey = GAP_KEYS[bestInfo.gap]; item.gapVars = {}; }
      else if (bestInfo.newColumns.length) { item.gapKey = NEW_COLUMN_KEY; item.gapVars = { column: bestInfo.newColumns[0] }; }
      items.push(item);
      typesChosen.add(s.type);
      state.add(s.tileData);
    }
    return { items, missing, unused, covered };
  }

  return { complete, questionKeys, intentsOfTile, columnsOfTile, meaningfulColumns, intentsOfSuggestion, GAP_KEYS, NEW_COLUMN_KEY, GAP_BONUS, NEW_COLUMN_BONUS, DULL_INTEREST, MIN_SCORE };
});
