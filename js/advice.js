/*
 * Conseil de visualisation et assistance au premier lancement (onboarding) : fonctions pures,
 * testables sous Node (voir dev-tests/test-data.js), sans DOM ni Grist — même convention que
 * js/pbix-layout.js et js/keywords.js. Ce module décide QUOI proposer à partir des données ; ce
 * sont js/main.js et index.html (écran d'accueil, étape « Choisir ») qui décident COMMENT l'afficher.
 *
 * AUCUN TEXTE EN DUR : toute suggestion ou tout conseil renvoie une clé i18n + ses variables
 * (`titleKey`/`titleVars`, `reasonKey`/`reasonVars`, `{ key, vars }`), que l'appelant traduit via
 * `GristBI.i18n.t(key, vars)` (clés `advice.*` de js/i18n.js — un test Node vérifie que chaque clé
 * citée ici existe bien en fr ET en anglais). Seule exception, `tileData.title` : un titre de tuile
 * est une chaîne persistée dans la configuration du tableau de bord, donc résolue à la création
 * (via `opts.t` si l'appelant le fournit, sinon un repli neutre fait des seuls noms de colonnes).
 *
 * Les données sont lues telles quelles (tableau de lignes `{colonne: valeur}` déjà enrichi par
 * js/main.js:withDateHierarchies, donc avec les colonnes dérivées `<date>.Annee/.Trimestre/.Mois`
 * quand le tableau a une colonne date) : ce module ne lit jamais le type Grist réel d'une colonne,
 * il l'infère des valeurs — comme js/main.js:inferColumnKind, dont `columnKind` ci-dessous est la
 * version « vote sur un échantillon » plutôt que « première valeur non vide ».
 *
 * Heuristiques volontairement prudentes : mieux vaut ne rien proposer qu'un graphique absurde. Tout
 * ce qui est deviné depuis le NOM d'une colonne (identifiant, jours/mois) reste un indice
 * supplémentaire, jamais la seule raison d'une décision, puisque les noms sont ceux de la personne.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./advice-insights.js'), require('./advice-types.js'));
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.advice = factory(root.GristBI.data, root.GristBI.adviceInsights, root.GristBI.adviceTypes);
  }
})(typeof self !== 'undefined' ? self : this, function (data, insights, types) {
  'use strict';

  // Lignes lues au plus pour profiler une colonne, et plafond du nombre de valeurs distinctes
  // retenues : un tableau de 47 000 lignes se profile en quelques millisecondes, mais rien ne sert
  // de construire un Set de plusieurs dizaines de milliers de chaînes pour apprendre qu'une colonne
  // est « presque unique ».
  const SCAN_LIMIT = 20000;
  // Échelles bornées qu'une colonne de « notes » peut avoir : un taux 0-1, un Likert 1-5 ou 1-7, une note sur 10 ou sur 20, un pourcentage.
  const SCORE_TOPS = [1, 5, 7, 10, 20, 100];
  const DISTINCT_CAP = 1000;
  const KIND_SAMPLE = 200;
  // Au-delà, une colonne texte n'est plus une « catégorie » raisonnable pour un graphique à barres.
  const MAX_CATEGORIES = 30;
  // Seuils de lisibilité (voir adviceForTile) — chiffres classiques de la littérature de dataviz :
  // un camembert se lit jusqu'à ~6-7 parts, un radar jusqu'à ~8 axes, des libellés de plus de ~14
  // caractères ne tiennent plus sous une barre verticale.
  const PIE_MAX_SLICES = 7;
  const RADAR_MAX_AXES = 8;
  // Rapport entre la plus grande et la plus petite moyenne de colonne, au-delà duquel un radar « colonnes » écrase ses petits axes.
  const RADAR_SCALE_RATIO = 20;
  const BAR_MAX_VERTICAL = 12;
  const FUNNEL_MAX_STAGES = 10;
  // Autant de séries que de couleurs de la palette du tableau de bord (js/charts.js:CATEGORICAL_PALETTE).
  const SERIES_MAX = 8;
  const SMALL_MULTIPLES_MAX_CATEGORIES = 24; // au-delà, les catégories d'un petit panneau (une cinquantaine de pixels de large) ne se lisent plus
  const LONG_LABEL = 14;

  // Même liste que js/data.js (GRIST_TECHNICAL_COLUMNS) : `manualSort` n'est jamais une donnée.
  const TECHNICAL_COLUMNS = ['id', 'manualSort'];
  const HIERARCHY_RE = /^(.+)\.(Annee|Trimestre|Mois)$/;

  // Tous les types de tuile que le formulaire sait créer (voir index.html, #tile-type).
  const TABLE_DEFAULT_COLUMNS = 6;
  // Au-delà, une carte de chaleur dans une tuile n'écrit plus rien dans ses cases (voir js/charts.js:renderHeatmap).
  const HEATMAP_MAX_AXIS = 24;
  const TILE_TYPES = ['bar', 'line', 'pie', 'treemap', 'funnel', 'scatter', 'waterfall', 'radar', 'wordcloud', 'kpi', 'gauge', 'pivot'];

  // « Quand l'utiliser » : une ligne par type pour l'étape « Choisir ». Littéraux (pas de clé
  // construite par concaténation) pour que le test de couverture i18n les retrouve par simple
  // recherche de texte dans ce fichier.
  const USE_KEYS = {
    bar: 'advice.use.bar',
    line: 'advice.use.line',
    combo: 'advice.use.combo',
    histogram: 'advice.use.histogram',
    box: 'advice.use.box',
    sankey: 'advice.use.sankey',
    calendar: 'advice.use.calendar',
    gantt: 'advice.use.gantt',
    pie: 'advice.use.pie',
    treemap: 'advice.use.treemap',
    sunburst: 'advice.use.sunburst',
    funnel: 'advice.use.funnel',
    scatter: 'advice.use.scatter',
    waterfall: 'advice.use.waterfall',
    radar: 'advice.use.radar',
    wordcloud: 'advice.use.wordcloud',
    kpi: 'advice.use.kpi',
    gauge: 'advice.use.gauge',
    pivot: 'advice.use.pivot',
    heatmap: 'advice.use.heatmap',
    // Hors TILE_TYPES : aucune agrégation (texte : aucune donnée ; table : les lignes telles quelles), donc ni
    // miniature ni avertissement ; seule la table préremplit ses colonnes (`defaultsForType`).
    table: 'advice.use.table',
    progress: 'advice.use.progress',
    text: 'advice.use.text'
  };

  // ---------------------------------------------------------------------------------------------
  // Profil des colonnes
  // ---------------------------------------------------------------------------------------------

  function isEmpty(v) { return v === null || v === undefined || v === ''; }

  // Les lignes à profiler : toutes jusqu'à SCAN_LIMIT, sinon un échantillon RÉPARTI sur toute la table (une ligne tous les
  // N), jamais les premières : une table triée par date n'a, dans ses 20 000 premières lignes, ni les dernières années ni les
  // catégories apparues plus tard (mesuré sur 300 000 lignes : 2 canaux vus sur 3, une seule année de dates sur six).
  function sampleOf(rows) {
    if (rows.length <= SCAN_LIMIT) return rows;
    const step = rows.length / SCAN_LIMIT;
    const out = new Array(SCAN_LIMIT);
    for (let i = 0; i < SCAN_LIMIT; i++) out[i] = rows[Math.floor(i * step)];
    return out;
  }

  // Type Grist RÉEL de chaque colonne de la table de travail, `{ colId: { type: 'Ref:Clients', widgetOptions: '<JSON>' } }`
  // (lu par js/main-session.js:refreshColumnFormats, la même lecture que le format des nombres, puis posé ici). Vide hors Grist ou
  // avant cette lecture : tout se déduit alors des seules valeurs, comme avant. Un `info` passé en argument prime sur ce registre
  // (les essais). Les valeurs seules ne distinguent pas une colonne Référence (un numéro de ligne) d'une colonne de nombres, ni
  // un code postal (texte) d'une quantité : le type Grist, lui, le dit.
  let columnInfoRegistry = {};
  function setColumnInfo(columns) { columnInfoRegistry = (columns && typeof columns === 'object') ? columns : {}; }
  function columnEntry(id, info) {
    const source = info || columnInfoRegistry;
    return (source && Object.prototype.hasOwnProperty.call(source, id) && source[id] && typeof source[id] === 'object') ? source[id] : null;
  }
  function gristTypeOf(id, info) {
    const entry = columnEntry(id, info);
    return entry && typeof entry.type === 'string' ? entry.type : '';
  }
  // Options d'affichage de la colonne (`widgetOptions` est un TEXTE JSON dans Grist), `{}` si illisible.
  function widgetOptionsOf(id, info) {
    const entry = columnEntry(id, info);
    if (!entry || typeof entry.widgetOptions !== 'string' || !entry.widgetOptions) return {};
    try {
      const parsed = JSON.parse(entry.widgetOptions);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  }

  // Nombre représenté par `v` (nombre, ou chaîne numérique que Grist renvoie parfois), sinon null.
  function numericValue(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Colonne qu'on MOYENNE d'ordinaire plutôt qu'on ne l'additionne (note, taux, pourcentage, âge…).
  // Simple indice tiré du nom, en français ou en anglais : la somme reste le choix par défaut, et la
  // personne garde la main sur l'agrégat dans le formulaire.
  // `SCORE_NAME_RE` = les mots d'une grandeur bornée (note, taux, avancement, probabilité…) ; `AVERAGE_NAME_RE` y ajoute ceux qu'on moyenne
  // sans qu'elle soit bornée (âge, moyenne) : jamais une « échelle » à reporter sur un radar, un âge de 77 ans n'est pas une note sur 100.
  const SCORE_WORDS = 'notes?|score|taux|rate|ratio|pct|percent|percentage|pourcentage|satisfaction|avancement|progress|progression|completion|probabilite|probabilité|probability|rating';
  const wordRe = (words) => new RegExp('(^|[^a-zà-ÿ])(' + words + ')([^a-zà-ÿ]|$)|%', 'i');
  const SCORE_NAME_RE = wordRe(SCORE_WORDS);
  const AVERAGE_NAME_RE = wordRe(SCORE_WORDS + '|moyenne|average|avg|age|âge');

  // Prix unitaire (Prix, PrixUnitaire, unit_price, Tarif, PU…) : un montant PAR unité, qu'on ne somme jamais (la somme des prix de
  // 5 000 lignes n'est rien) et qu'on ne choisit pas comme mesure vedette quand la table a aussi un vrai montant (Montant, Total, CA…).
  // Indice tiré du nom comme AVERAGE_NAME_RE (les valeurs seules ne distinguent pas un prix d'un montant) : le nom est coupé en mots
  // (camelCase, `_`, espaces) et un mot de montant (« Prix total ») annule l'indice. Seul le CLASSEMENT change : un prix reste mesure,
  // et s'il est la seule colonne numérique c'est lui qui est proposé (moyenne).
  const PRICE_WORDS = new Set(['prix', 'price', 'prices', 'tarif', 'tarifs', 'pu', 'puht', 'puttc']);
  const UNIT_WORDS = new Set(['unit', 'unite', 'unitaire', 'unitary']);
  const COST_WORDS = new Set(['cout', 'cost']);
  const AMOUNT_WORDS = new Set(['total', 'montant', 'amount', 'revenue', 'revenu', 'ca', 'chiffre', 'somme', 'sum', 'subtotal']);
  function nameWords(name) {
    return String(name == null ? '' : name)
      .replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, '$1 $2')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);
  }
  function isUnitPriceName(name) {
    const words = nameWords(name);
    if (words.some((w) => AMOUNT_WORDS.has(w))) return false;
    if (words.some((w) => PRICE_WORDS.has(w))) return true;
    return words.some((w) => UNIT_WORDS.has(w)) && words.some((w) => COST_WORDS.has(w));
  }
  // Pénalité de classement d'un prix unitaire parmi les mesures : assez forte pour passer derrière un montant qui aurait des
  // négatifs (retours, avoirs : -1 point) ou quelques cases vides, pas assez pour passer derrière une colonne ambiguë (petit entier).
  const UNIT_PRICE_RANK_PENALTY = 3;
  // Une note, un taux, un pourcentage (par le nom, par le format de la colonne Grist ou parce que plusieurs colonnes partagent la même
  // échelle bornée, voir markScores) se MOYENNE : la somme des notes de 90 élèves n'est pas une note.
  function aggFor(p) { return (p.score || p.percent || AVERAGE_NAME_RE.test(p.id) || isUnitPriceName(p.id)) ? 'avg' : 'sum'; }
  // Un agrégat dont les parts s'additionnent : un anneau, un treemap ou un soleil de moyennes n'est pas « un tout ».
  function additive(m) { return m.count || m.aggFn === 'sum'; }

  function looksLikeIdName(name) {
    return /(^|[^A-Za-z])(id|uuid|ref)([^A-Za-z]|$)/i.test(name) || /[a-z](Id|ID)$/.test(name);
  }

  // Valeurs qui se rangent d'elles-mêmes dans l'ordre du temps (mois, jours, trimestres, années,
  // dates ISO) : une colonne texte de ce genre se prête à une courbe, une colonne « Région » non.
  const MONTH_RE = /^(jan|janv|janvier|fév|fev|févr|fevr|février|fevrier|mar|mars|avr|avril|mai|juin|juil|juillet|aoû|aou|août|aout|sep|sept|septembre|oct|octobre|nov|novembre|déc|dec|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december|feb|apr|jun|jul|aug)\.?$/i;
  const WEEKDAY_RE = /^(lun|lundi|mar|mardi|mer|mercredi|jeu|jeudi|ven|vendredi|sam|samedi|dim|dimanche|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\.?$/i;
  const PERIOD_RE = /^(\d{4}([-/]\d{1,2}([-/]\d{1,2})?)?|[TQS][1-4]([ -]\d{4})?|\d{1,2})$/i;

  function timeLikeRatio(values) {
    let total = 0;
    let matching = 0;
    for (const v of values) {
      if (isEmpty(v)) continue;
      total++;
      const s = String(v).trim();
      if (MONTH_RE.test(s) || WEEKDAY_RE.test(s) || PERIOD_RE.test(s)) matching++;
    }
    return total ? matching / total : 0;
  }

  // Toutes les valeurs sont des nombres, années, dates ISO, « T1 »… : le tri par libellé de
  // js/data.js (nombres comparés comme nombres, le reste en ordre naturel) les range alors dans l'ordre
  // du temps. Faux pour des noms de mois (« Avril » < « Janvier ») : jamais proposé pour eux.
  function sortableByLabel(values) {
    let seen = 0;
    for (const v of values) {
      if (isEmpty(v)) continue;
      seen++;
      if (numericValue(v) === null && !PERIOD_RE.test(String(v).trim())) return false;
    }
    return seen > 0;
  }

  // 'date' | 'number' | 'text' d'après un VOTE sur les premières valeurs non vides (une colonne
  // numérique qui contient une cellule texte égarée reste « nombre » ; une colonne mixte à parts
  // égales devient « texte », le choix le plus sûr pour un graphique).
  function columnKind(sampleValues) {
    let sampled = 0;
    let dates = 0;
    let numbers = 0;
    for (const v of sampleValues) {
      sampled++;
      if (data.parseDateValue(v) != null) dates++;
      else if (numericValue(v) !== null) numbers++;
    }
    if (!sampled) return 'text';
    if (dates / sampled >= 0.9) return 'date';
    if (numbers / sampled >= 0.9) return 'number';
    return 'text';
  }

  function profileOne(rows, id, scanned, info) {
    const sample = [];
    const seen = new Set();
    let distinctCapped = false;
    let filled = 0;
    let listCells = 0;
    let min = Infinity;
    let max = -Infinity;
    let negatives = 0;
    let allInteger = true;
    let totalLen = 0;
    let maxLen = 0;
    for (let i = 0; i < scanned; i++) {
      const v = rows[i][id];
      if (isEmpty(v)) continue;
      filled++;
      if (Array.isArray(v)) listCells++; // liste de choix, de références, pièces jointes : `['L', …]`
      if (sample.length < KIND_SAMPLE) sample.push(v);
      if (!distinctCapped) {
        seen.add(String(v));
        if (seen.size >= DISTINCT_CAP) distinctCapped = true;
      }
      const n = numericValue(v);
      if (n !== null && data.parseDateValue(v) == null) {
        if (n < min) min = n;
        if (n > max) max = n;
        if (n < 0) negatives++;
        if (!Number.isInteger(n)) allInteger = false;
      }
      const len = String(v).length;
      totalLen += len;
      if (len > maxLen) maxLen = len;
    }
    const gristType = gristTypeOf(id, info);
    let kind = columnKind(sample);
    // Une colonne Texte ou Choix dont les valeurs ressemblent à des nombres (code postal, « 10 », « 20 ») n'est pas une mesure.
    if (kind === 'number' && (gristType === 'Text' || gristType === 'Choice')) kind = 'text';
    const options = widgetOptionsOf(id, info);
    return {
      id,
      kind,
      gristType,
      // Colonne de listes (`['L', …]`) : jamais une catégorie, chaque combinaison deviendrait une « valeur » (voir assignRole).
      listLike: filled > 0 && listCells / filled >= 0.5,
      // Format d'affichage que la personne a choisi dans Grist : un pourcentage se moyenne, une devise s'additionne.
      percent: options.numMode === 'percent',
      money: options.numMode === 'currency',
      role: null,
      // Texte dont les valeurs distinctes sont des mois, jours, trimestres… (voir timeLikeRatio).
      timeLike: kind === 'text' && seen.size >= 3 && timeLikeRatio(Array.from(seen)) >= 0.7,
      filled,
      total: scanned,
      emptyRatio: scanned ? 1 - filled / scanned : 0,
      distinct: seen.size,
      distinctCapped,
      min: kind === 'number' ? min : null,
      max: kind === 'number' ? max : null,
      negatives: kind === 'number' ? negatives : 0,
      allInteger: kind === 'number' ? allInteger : false,
      avgLen: filled ? totalLen / filled : 0,
      maxLen,
      yearLike: false,
      lowCardinality: false,
      ordinal: false
    };
  }

  // Rôle de chaque colonne dans un graphique :
  //  - 'time'      : colonne date ;
  //  - 'timePart'  : colonne dérivée `<date>.Annee/.Trimestre/.Mois` (js/data.js:deriveDateHierarchyColumns) ;
  //  - 'category'  : peu de valeurs différentes (2 à 30), prête à servir d'axe ou de légende ;
  //  - 'measure'   : nombre à agréger ;
  //  - 'identifier': clé quasi unique par ligne (numéro, courriel…), jamais un axe utile ;
  //  - 'freeText'  : texte long (commentaire…) ; 'highCardinality' : trop de valeurs pour un axe ;
  //  - 'constant'  : une seule valeur (ou colonne vide).
  function assignRole(p, byId) {
    const hierarchy = HIERARCHY_RE.exec(p.id);
    if (hierarchy && byId.has(hierarchy[1]) && byId.get(hierarchy[1]).kind === 'date') {
      p.role = 'timePart';
      p.base = hierarchy[1];
      p.part = hierarchy[2];
      return;
    }
    if (p.filled === 0 || p.distinct <= 1) { p.role = 'constant'; return; }
    // Colonne Référence : un NUMÉRO DE LIGNE d'une autre table, que ni additionner ni moyenner n'a de sens (« somme de Client »),
    // et dont les valeurs sont illisibles sur un axe. Colonne de listes : une « valeur » est une combinaison (`L,cadeau,bio`).
    if (/^Ref(List)?:/.test(p.gristType)) { p.role = 'reference'; return; }
    if (p.gristType === 'ChoiceList' || p.gristType === 'Attachments' || p.listLike) { p.role = 'list'; return; }
    if (p.kind === 'date') { p.role = 'time'; return; }
    if (p.kind === 'number') {
      if (p.allInteger && p.min >= 1800 && p.max <= 2200 && p.distinct <= 80) {
        p.role = 'category';
        p.yearLike = true;
        return;
      }
      const sequential = p.allInteger && p.distinct === p.filled && p.filled >= 8
        && (p.max - p.min + 1) <= 1.5 * p.filled;
      const namedId = looksLikeIdName(p.id) && p.allInteger && p.distinct >= 0.9 * p.filled;
      if (sequential || namedId) { p.role = 'identifier'; return; }
      // Petit entier peu varié (note de 1 à 5, nombre de personnes…) ou numéro dense répété sur de
      // nombreuses lignes (jour du mois 1-31, semaine, heure) : se range aussi bien en catégorie
      // qu'en mesure — proposé comme axe, jamais comme mesure vedette.
      const dense = p.min >= 0 && (p.max - p.min + 1) <= 31 && p.distinct <= 31 && p.filled >= 3 * p.distinct;
      if (p.allInteger && p.filled >= 10 && (p.distinct <= 7 || dense)) p.lowCardinality = true;
      // Numéro de jour/semaine/heure (nombreuses valeurs, mais denses) : encore moins une mesure.
      p.ordinal = p.lowCardinality && p.distinct > 7;
      p.role = 'measure';
      return;
    }
    if (p.distinct <= MAX_CATEGORIES) { p.role = 'category'; return; }
    if (p.avgLen > 40) { p.role = 'freeText'; return; }
    p.role = p.distinct >= 0.9 * p.filled ? 'identifier' : 'highCardinality';
  }

  // Les colonnes qui sont des NOTES (une échelle bornée qu'on moyenne, jamais qu'on additionne ni qu'on prend pour une catégorie) :
  // des entiers de 0 à 20 sont, selon la table, une note sur 20, le jour du mois, un nombre de personnes… Les valeurs seules ne le
  // disent pas ; trois indices le disent : le nom (note, taux, avancement…), le format de la colonne dans Grist (pourcentage) et,
  // surtout, ses SŒURS — plusieurs colonnes qui plafonnent toutes à 20 (Maths, Français, Anglais) sont une famille de notes. Les
  // tableaux de notes sont le cas d'usage du radar : sans cela, chaque colonne était rangée en « petit entier » (catégorie ET mesure),
  // additionnée, et le radar jamais proposé. Une échelle de 0-1 ou 0-100 n'est reconnue que par son nom ou son format (une quantité
  // de 1 à 98 y ressemble) ; 5, 7 et 10 demandent trois sœurs (une quantité de 1 à 5 est fréquente), 20 en demande deux.
  function scaleTopOf(p) {
    if (p.role !== 'measure' || p.kind !== 'number' || p.min < 0 || p.filled < 10 || p.distinct < 4) return 0;
    return SCORE_TOPS.find((top) => p.max <= top && p.max > top / 2) || 0;
  }

  function markScores(profiles) {
    const tops = new Map(profiles.map((p) => [p, scaleTopOf(p)]));
    const family = (top) => profiles.filter((q) => tops.get(q) === top).length;
    profiles.forEach((p) => {
      const top = tops.get(p);
      if (!top) return;
      const named = SCORE_NAME_RE.test(p.id) || p.percent;
      const siblings = family(top);
      const proven = named || (top === 20 ? siblings >= 2 : (top !== 1 && top !== 100 && siblings >= 3));
      if (!proven) return;
      p.score = true;
      p.scaleTop = top;
      p.lowCardinality = false;
      p.ordinal = false;
    });
  }

  // Profil de chaque colonne de `columnIds` (par défaut toutes celles de la 1re ligne, sauf `id`). `info` (facultatif) = le type
  // Grist de chaque colonne (voir setColumnInfo) ; sans lui, le registre posé par js/main-session.js.
  function profileColumns(rows, columnIds, info) {
    rows = Array.isArray(rows) ? rows : [];
    const ids = (columnIds || (rows.length ? Object.keys(rows[0]) : []))
      .filter((c) => TECHNICAL_COLUMNS.indexOf(c) === -1);
    const sample = sampleOf(rows);
    const profiles = ids.map((id) => profileOne(sample, id, sample.length, info));
    const byId = new Map(profiles.map((p) => [p.id, p]));
    profiles.forEach((p) => assignRole(p, byId));
    markScores(profiles);
    return profiles;
  }

  // ---------------------------------------------------------------------------------------------
  // Analyse : quelles colonnes jouent quel rôle
  // ---------------------------------------------------------------------------------------------

  // Ajustement du nombre de catégories à un graphique lisible : idéal entre 3 et 8, acceptable
  // jusqu'à 15 (barres horizontales), médiocre jusqu'à 30.
  function cardinalityFit(n) {
    if (n < 2) return -Infinity;
    if (n <= 8) return 1.5 - Math.abs(n - 5) * 0.05;
    if (n <= 15) return 1;
    if (n <= MAX_CATEGORIES) return 0;
    return -1;
  }

  function niceCeil(x) {
    if (!(x > 0)) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    return steps.find((s) => s >= m - 1e-9) * p;
  }

  // Axe temporel le plus parlant, ou null : la colonne `<date>.Annee` (avec drill-down
  // Trimestre/Mois/jour, exactement ce que le bouton « Détailler par Année… » du formulaire pose) quand
  // elle a au moins 3 années, sinon la date brute, sinon une colonne « année » numérique.
  function findTimeAxis(profiles, byId) {
    for (const p of profiles.filter((q) => q.role === 'time')) {
      const annee = byId.get(`${p.id}.Annee`);
      if (annee && annee.distinct >= 3) {
        const drill = [`${p.id}.Trimestre`, `${p.id}.Mois`].filter((c) => byId.has(c)).concat([p.id]);
        return { dimension: annee.id, drillDimensions: drill, base: p.id, granularity: 'year', numericKeys: true };
      }
      // Une seule année : les 12 mois forment bien une chronologie (avec plusieurs années, `.Mois` mélangerait les années) ; un clic
      // détaille par jour. Une courbe de plus de 300 jours additionnés au jour se lit moins bien que 12 points.
      const mois = byId.get(`${p.id}.Mois`);
      if (annee && annee.distinct === 1 && mois && mois.distinct >= 3) {
        return { dimension: mois.id, drillDimensions: [p.id], base: p.id, granularity: 'month' };
      }
      if (p.distinct >= 3) return { dimension: p.id, base: p.id, granularity: 'date' };
    }
    const year = profiles.find((p) => p.role === 'category' && p.yearLike && p.distinct >= 3);
    if (year) return { dimension: year.id, base: year.id, granularity: 'year', numericKeys: true };
    // Dernier recours : une colonne texte de mois/jours/trimestres. Son ordre d'apparition est pris
    // tel quel (`unchecked`) — on ne sait pas la trier par libellé (« Avril » < « Janvier »).
    const named = profiles.find((p) => p.role === 'category' && p.timeLike && p.distinct >= 3);
    return named ? { dimension: named.id, base: named.id, granularity: 'label', unchecked: true } : null;
  }

  function analyzeColumns(rows, columnIds, info) {
    const profiles = profileColumns(rows, columnIds, info);
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const order = new Map(profiles.map((p, i) => [p.id, i]));
    const byOrder = (a, b) => order.get(a.id) - order.get(b.id);

    // Mesures : vraies colonnes numériques d'abord (sans négatif, peu de cases vides), les petits
    // entiers ambigus en dernier, un prix unitaire derrière tout vrai montant ; l'ordre des colonnes départage (les chiffres clés sont d'ordinaire
    // à droite des axes, mais la première colonne numérique reste le meilleur pari).
    const measures = profiles
      .filter((p) => p.role === 'measure')
      .map((p) => ({ p, score: (p.lowCardinality ? (p.ordinal ? -2 : 0) : 10) + (p.negatives === 0 ? 1 : 0) - p.emptyRatio * 5 - (isUnitPriceName(p.id) ? UNIT_PRICE_RANK_PENALTY : 0) }))
      .sort((a, b) => (b.score - a.score) || byOrder(a.p, b.p))
      .map((x) => x.p);

    // Axes catégoriels : texte d'abord, puis petits entiers ; par proximité avec 5 catégories.
    const categories = profiles
      .filter((p) => (p.role === 'category' && !p.yearLike) || (p.role === 'measure' && p.lowCardinality && p.distinct >= 2))
      .map((p) => ({ p, score: cardinalityFit(p.distinct) - (p.kind === 'number' ? 1 : 0) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => (b.score - a.score) || byOrder(a.p, b.p))
      .map((x) => x.p);

    return {
      profiles,
      byId,
      measures,
      categories,
      time: findTimeAxis(profiles, byId),
      // Colonne dont on compte simplement les lignes quand il n'existe aucune vraie mesure.
      countColumn: (profiles.find((p) => p.role === 'identifier') || profiles[0] || {}).id || null
    };
  }

  // Les valeurs de `column` dans l'ordre de PREMIÈRE apparition (celui de groupByAggregate, voir
  // CLAUDE.md §7 piège n°14) sont-elles déjà croissantes ? Faux = une courbe ferait des allers-retours
  // au lieu de suivre le temps. Valeurs vides ignorées ; nombres comparés comme nombres, le reste
  // comme chaînes (les dates ISO, « T1 » et « 01 » se rangent correctement ainsi).
  function appearsAscending(rows, column) {
    const seen = new Set();
    let last = null;
    for (const row of rows) {
      const v = row[column];
      if (isEmpty(v) || seen.has(v)) continue;
      seen.add(v);
      if (last !== null) {
        const previousNumber = numericValue(last);
        const currentNumber = numericValue(v);
        const lower = (previousNumber !== null && currentNumber !== null) ? currentNumber < previousNumber : String(v) < String(last);
        if (lower) return false;
      }
      last = v;
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Tuiles suggérées
  // ---------------------------------------------------------------------------------------------

  // Titre du formulaire manuel (js/main.js) : « <mesure> par <dimension> » — repris ici à travers
  // `t` pour suivre la langue ; sans `t`, un repli sans mot de la langue.
  function resolveTitle(opts, key, vars, fallback) {
    return (opts && typeof opts.t === 'function') ? opts.t(key, vars) : fallback;
  }

  function measureOptions(ctx) {
    // Un numéro de mois, de semaine ou de jour (petit entier dense répété sur de nombreuses lignes) n'est pas une quantité : « Mois par
    // Poste » ou « Mois pèse 17 % du total » n'ont aucun sens. Il ne sert de mesure que s'il n'y a rien d'autre à mesurer.
    const real = ctx.measures.filter((p) => !p.ordinal);
    const options = (real.length ? real : ctx.measures).slice(0, 2).map((p) => ({ column: p.id, aggFn: aggFor(p), count: false, profile: p }));
    if (!options.length && ctx.countColumn) options.push({ column: ctx.countColumn, aggFn: 'count', count: true, profile: null });
    return options;
  }

  function nonNegative(m) { return m.count || (m.profile && m.profile.negatives === 0); }

  // L'intention d'une tuile : ce que la personne cherche à savoir. Sert d'étiquette sur la carte de suggestion et à varier les propositions.
  const INTENT_BY_TYPE = Object.assign({
    kpi: 'overview', line: 'trend', bar: 'compare', pie: 'share', treemap: 'share', scatter: 'relation', pivot: 'cross', radar: 'profile'
  }, types.INTENT_BY_TYPE);
  // Littéraux (et non construits par concaténation) pour que le test de couverture i18n les retrouve dans ce fichier.
  const INTENT_KEYS = {
    overview: 'advice.intent.overview',
    trend: 'advice.intent.trend',
    compare: 'advice.intent.compare',
    share: 'advice.intent.share',
    relation: 'advice.intent.relation',
    cross: 'advice.intent.cross',
    profile: 'advice.intent.profile',
    concentrate: 'advice.intent.concentrate',
    distribution: 'advice.intent.distribution',
    change: 'advice.intent.change',
    stages: 'advice.intent.stages',
    rhythm: 'advice.intent.rhythm',
    schedule: 'advice.intent.schedule',
    structure: 'advice.intent.structure',
    goal: 'advice.intent.goal'
  };

  function candidate(base) { return Object.assign({ dims: [], measures: [], intent: INTENT_BY_TYPE[base.type] || 'compare' }, base); }

  function buildCandidates(rows, ctx, opts) {
    const out = [];
    const measureOpts = measureOptions(ctx);
    if (!measureOpts.length) return out;
    const dimsCat = ctx.categories.slice(0, 3);
    const title = (m, dimension) => (m.count
      ? { key: 'advice.title.countBy', vars: { dimension }, fallback: dimension }
      : { key: 'advice.title.byDimension', vars: { measure: m.column, dimension }, fallback: `${m.column} / ${dimension}` });

    // 1. KPI : le total (avec tendance quand il existe au moins deux années).
    measureOpts.forEach((m, i) => {
      const trendDimension = (ctx.time && ctx.time.numericKeys && ctx.byId.get(ctx.time.dimension).distinct >= 2)
        ? ctx.time.dimension : undefined;
      const titleSpec = m.count
        ? { key: 'advice.title.countAll', vars: {}, fallback: m.column }
        : (m.aggFn === 'avg'
          ? { key: 'advice.title.average', vars: { measure: m.column }, fallback: m.column }
          : { key: 'advice.title.total', vars: { measure: m.column }, fallback: m.column });
      out.push(candidate({
        type: 'kpi',
        score: 7 + (trendDimension ? 1 : 0) - i * 0.8,
        measures: [m.column],
        tileData: Object.assign(
          { type: 'kpi', dimension: '', measure: m.column, aggFn: m.aggFn,
            title: resolveTitle(opts, titleSpec.key, titleSpec.vars, titleSpec.fallback) },
          trendDimension ? { trendDimension } : {}
        ),
        titleKey: titleSpec.key,
        titleVars: titleSpec.vars,
        reasonKey: trendDimension ? 'advice.reason.kpiTrend'
          : (m.count ? 'advice.reason.kpiCount' : (m.aggFn === 'avg' ? 'advice.reason.kpiAverage' : 'advice.reason.kpiTotal')),
        reasonVars: trendDimension ? { measure: m.column, dimension: trendDimension } : { measure: m.column }
      }));
    });

    // 2. Courbe dans le temps.
    if (ctx.time) {
      measureOpts.forEach((m, i) => {
        const ts = title(m, ctx.time.dimension);
        const sortable = !ctx.time.unchecked && sortableByLabel(sampleOf(rows).map((r) => r[ctx.time.dimension]));
        const ascending = !sortable || appearsAscending(rows, ctx.time.dimension);
        out.push(candidate({
          type: 'line',
          score: 9 - i * 0.8,
          dims: [ctx.time.dimension],
          measures: [m.column],
          tileData: Object.assign(
            { type: 'line', dimension: ctx.time.dimension, measure: m.column, aggFn: m.aggFn,
              title: resolveTitle(opts, ts.key, ts.vars, ts.fallback) },
            ctx.time.drillDimensions ? { drillDimensions: ctx.time.drillDimensions } : {},
            ascending ? {} : { sortMode: 'label' }
          ),
          titleKey: ts.key,
          titleVars: ts.vars,
          reasonKey: 'advice.reason.lineTime',
          reasonVars: { dimension: ctx.time.dimension }
        }));
      });
    }

    // 3. Comparaison de catégories (barres triées, horizontales si nombreuses ou à libellés longs).
    dimsCat.forEach((d) => {
      measureOpts.filter((m) => m.column !== d.id).forEach((m, i) => {
        const ts = title(m, d.id);
        // Axe qui a déjà son ordre (nombre, mois, trimestre) : on ne le retrie pas par valeur.
        const ordinal = d.kind === 'number' || d.timeLike;
        const horizontal = d.distinct >= 9 || (d.distinct >= 4 && d.maxLen > LONG_LABEL);
        out.push(candidate({
          type: 'bar',
          score: 8 + cardinalityFit(d.distinct) - i * 0.8 - (ordinal ? 1 : 0),
          dims: [d.id],
          measures: [m.column],
          tileData: Object.assign(
            { type: 'bar', dimension: d.id, measure: m.column, aggFn: m.aggFn,
              title: resolveTitle(opts, ts.key, ts.vars, ts.fallback) },
            ordinal ? {} : { sortMode: 'value-desc' },
            horizontal ? { horizontal: true } : {}
          ),
          titleKey: ts.key,
          titleVars: ts.vars,
          reasonKey: 'advice.reason.barCompare',
          reasonVars: { n: d.distinct, dimension: d.id }
        }));
      });
    });

    // 4. Part d'un tout : anneau, seulement quand peu de parts et aucune valeur négative.
    dimsCat.filter((d) => d.kind === 'text' && d.distinct >= 2 && d.distinct <= 6).forEach((d) => {
      measureOpts.filter((m) => nonNegative(m) && additive(m)).forEach((m, i) => {
        const ts = title(m, d.id);
        out.push(candidate({
          type: 'pie',
          score: 6.5 - i * 0.8,
          dims: [d.id],
          measures: [m.column],
          tileData: { type: 'pie', dimension: d.id, measure: m.column, aggFn: m.aggFn,
            title: resolveTitle(opts, ts.key, ts.vars, ts.fallback), donut: true, showPct: true, sortMode: 'value-desc' },
          titleKey: ts.key,
          titleVars: ts.vars,
          reasonKey: 'advice.reason.piePart',
          reasonVars: { n: d.distinct, dimension: d.id }
        }));
      });
    });

    // 5. Treemap : beaucoup de catégories positives, que des barres rendraient trop denses.
    ctx.categories.filter((d) => d.kind === 'text' && d.distinct >= 9 && d.distinct <= MAX_CATEGORIES).slice(0, 2).forEach((d) => {
      measureOpts.filter((m) => nonNegative(m) && additive(m)).slice(0, 1).forEach((m) => {
        const ts = title(m, d.id);
        out.push(candidate({
          type: 'treemap',
          score: 5,
          dims: [d.id],
          measures: [m.column],
          tileData: { type: 'treemap', dimension: d.id, measure: m.column, aggFn: m.aggFn,
            title: resolveTitle(opts, ts.key, ts.vars, ts.fallback) },
          titleKey: ts.key,
          titleVars: ts.vars,
          reasonKey: 'advice.reason.treemapShare',
          reasonVars: { n: d.distinct, dimension: d.id }
        }));
      });
    });

    // 6. Nuage de points : deux vraies mesures, un point par catégorie ou par individu.
    const numericMeasures = ctx.measures.filter((p) => !p.ordinal);
    const pointDims = ctx.profiles.filter((p) => (p.role === 'category' && !p.yearLike && p.distinct >= 5)
      || (p.role === 'highCardinality' && p.distinct <= 300) || (p.role === 'identifier' && p.kind === 'text' && p.distinct <= 300));
    if (numericMeasures.length >= 2 && pointDims.length) {
      const pointDimension = pointDims[0];
      const [x, y] = numericMeasures;
      out.push(candidate({
        type: 'scatter',
        score: 5.5,
        dims: [pointDimension.id],
        measures: [x.id, y.id],
        tileData: { type: 'scatter', dimension: pointDimension.id, measure: x.id, measureY: y.id, aggFn: (x.score || y.score) ? 'avg' : 'sum', // un seul agrégat pour X et Y : dès qu'une note est en jeu, des moyennes par point
          title: resolveTitle(opts, 'advice.title.scatter', { measure: x.id, measureY: y.id, dimension: pointDimension.id }, `${y.id} / ${x.id}`) },
        titleKey: 'advice.title.scatter',
        titleVars: { measure: x.id, measureY: y.id, dimension: pointDimension.id },
        reasonKey: 'advice.reason.scatterRelation',
        reasonVars: { measure: x.id, measureY: y.id }
      }));
    }

    // 7. Tableau croisé : deux axes catégoriels peu fournis.
    const smallDims = ctx.categories.filter((d) => d.kind === 'text' && d.distinct >= 2 && d.distinct <= 12);
    if (smallDims.length >= 2) {
      const [d1, d2] = smallDims;
      measureOpts.slice(0, 1).forEach((m) => {
        out.push(candidate({
          type: 'pivot',
          score: 5,
          dims: [d1.id, d2.id],
          measures: [m.column],
          tileData: { type: 'pivot', dimension: d1.id, columnDimension: d2.id, measure: m.column, aggFn: m.aggFn,
            title: resolveTitle(opts, 'advice.title.byTwoDimensions', { measure: m.column, dimension: d1.id, columnDimension: d2.id },
              `${m.column} / ${d1.id} × ${d2.id}`) },
          titleKey: 'advice.title.byTwoDimensions',
          titleVars: { measure: m.column, dimension: d1.id, columnDimension: d2.id },
          reasonKey: 'advice.reason.pivotCross',
          reasonVars: { dimension: d1.id, columnDimension: d2.id }
        }));
      });
    }

    // 8. Radar « compétences en colonnes » : au moins 3 mesures sur une échelle commune.
    const radarAxes = radarAxisColumns(ctx);
    if (radarAxes.length >= 3) {
      out.push(candidate({
        type: 'radar',
        score: 7.5,
        measures: radarAxes,
        tileData: { type: 'radar', radarAxisMode: 'columns', radarAxes, dimension: '', measure: radarAxes[0], aggFn: 'avg',
          title: resolveTitle(opts, 'advice.title.radar', { axes: radarAxes.join(', ') }, radarAxes.join(', ')) },
        titleKey: 'advice.title.radar',
        titleVars: { axes: radarAxes.join(', ') },
        reasonKey: 'advice.reason.radarSkills',
        reasonVars: { n: radarAxes.length }
      }));
    }

    // 9. Les types spécialisés (Pareto, barres + courbe, histogramme, boîtes, cascade, entonnoir, calendrier, planning, carte de chaleur,
    // soleil, objectif) : js/advice-types.js et les deux fichiers qu'il appelle.
    return dropSuperseded(out.concat(types.candidates(rows, ctx, opts, typeCore)));
  }

  // Une suggestion plus précise remplace celle qu'elle englobe : le chiffre clé AVEC son objectif prend la place des chiffres clés nus de la
  // mesure et de sa cible (le total de l'objectif n'apprend rien de plus) et des graphiques qui ne mettent face à face que ces deux colonnes
  // (barres + courbe, nuage de points : la progression les dit mieux), la carte de chaleur celle du tableau croisé des mêmes deux colonnes, et le
  // soleil celle du tableau croisé de deux colonnes emboîtées (région × département : chaque département n'a qu'une case, le tableau n'est
  // qu'une diagonale vide).
  function dropSuperseded(list) {
    const goals = list.filter((c) => c.type === 'kpi' && c.tileData.targetColumn);
    const crossed = list.filter((c) => c.type === 'heatmap' || c.type === 'sunburst').map((c) => c.dims.slice().sort().join('\u0001'));
    const onlyGoalColumns = (c) => goals.some((g) => c.measures.length === 2 && c.measures.every((m) => g.measures.indexOf(m) !== -1));
    return list.filter((c) => {
      if (c.type === 'kpi' && !c.tileData.targetColumn) return !goals.some((g) => g.measures.indexOf(c.tileData.measure) !== -1);
      if (c.type === 'pivot') return crossed.indexOf(c.dims.slice().sort().join('\u0001')) === -1;
      if (c.type === 'scatter' || (c.type === 'combo' && c.tileData.comboMode !== 'pareto')) return !onlyGoalColumns(c);
      return true;
    });
  }

  // Colonnes numériques qui ressemblent à des « compétences » : au moins 3, toutes entre 0 et 100,
  // d'amplitudes comparables (une note sur 20 et un chiffre d'affaires en millions ne se superposent
  // pas), au plus 8 pour rester lisibles.
  function radarAxisColumns(ctx) {
    // Une famille de notes (au moins 3 colonnes de la même échelle : Maths, Français, Anglais sur 20) est LE cas d'usage du radar ;
    // on prend la plus nombreuse, dans l'ordre des colonnes de la table.
    const families = new Map();
    ctx.profiles.filter((p) => p.score && p.scaleTop > 1).forEach((p) => families.set(p.scaleTop, (families.get(p.scaleTop) || []).concat(p)));
    let family = [];
    families.forEach((list) => { if (list.length > family.length) family = list; });
    if (family.length >= 3) return family.slice(0, RADAR_MAX_AXES).map((p) => p.id);
    const scored = ctx.measures.filter((p) => !p.lowCardinality && p.min >= 0 && p.max <= 100 && p.max > 0);
    if (scored.length < 3) return [];
    const top = Math.max.apply(null, scored.map((p) => p.max));
    const comparable = scored.filter((p) => p.max >= top / 5);
    return comparable.length >= 3 ? comparable.slice(0, RADAR_MAX_AXES).map((p) => p.id) : [];
  }

  // ---------------------------------------------------------------------------------------------
  // Intérêt tiré des DONNÉES, et explication chiffrée (niveau 2)
  // ---------------------------------------------------------------------------------------------

  // Le score fixe de chaque type est un a priori (une courbe vaut mieux qu'un tableau croisé) ; ce que montrent les données le
  // corrige : `score = a priori + SCORE_SPAN x (intérêt - SCORE_NEUTRAL)`, soit de -1,6 (graphique qui ne montre rien : barres
  // toutes égales, nuage sans lien) à +2,4 (très net). Un candidat dont on ne sait rien calculer garde son a priori.
  const SCORE_SPAN = 4;
  const SCORE_NEUTRAL = 0.4;
  // En dessous de cet intérêt, le graphique n'a « rien à montrer » (sa propre explication le dit) : il passe derrière tout ce qui a
  // un fait à raconter, même à fort a priori, et ne revient qu'à défaut d'autre chose.
  const DULL_INTEREST = 0.2;
  const DULL_PENALTY = 1.5;
  // Rapport entre le plus grand et le plus petit groupe à partir duquel on le dit (« 1,3 fois plus élevé ») ; en dessous, les groupes sont « proches ».
  const SPREAD_MIN_RATIO = 1.25;

  // Les groupes `dimension` x `mesure` (agrégat `aggFn`) sur les lignes qui servent aux chiffres (l'échantillon réparti, voir
  // sampleOf), calculés UNE fois par suggestTiles : une table de 300 000 lignes ne se regroupe pas trente fois.
  function groupsFor(ctx, dimension, measure, aggFn, sortMode) {
    if (!ctx.groupCache) ctx.groupCache = new Map();
    const key = [dimension, measure, aggFn, sortMode || ''].join('\u0001');
    if (!ctx.groupCache.has(key)) {
      const groups = data.groupByAggregate(ctx.insightRows, dimension, measure, aggFn);
      ctx.groupCache.set(key, sortMode ? data.sortGroups(groups, sortMode) : groups);
    }
    return ctx.groupCache.get(key);
  }

  // Valeur par CASE d'un tableau croisé (`[{ dimension: 'a × b', value }]`) : même agrégat que la tuile, une passe.
  function cellGroups(ctx, first, second, measure, aggFn) {
    const cells = new Map();
    for (const row of ctx.insightRows) {
      const a = row[first];
      const b = row[second];
      if (isEmpty(a) || isEmpty(b)) continue;
      const key = `${a} × ${b}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(row[measure]);
    }
    return Array.from(cells.entries()).map(([key, values]) => ({
      dimension: key,
      value: data.aggregateSingle(values.map((v) => ({ v })), 'v', aggFn)
    }));
  }

  const fmt = (x, ctx, digits) => insights.formatNumber(x, ctx.lang, digits);

  // Ce que js/advice-types.js reçoit de ce fichier (il ne l'importe pas : pas d'import circulaire) : les fonctions communes aux candidats.
  const typeCore = {
    candidate, resolveTitle, groupsFor, aggFor, fmt, sampleOf, appearsAscending, measureOptions,
    // Les valeurs par défaut d'un type (les mêmes que le formulaire), pour les colonnes de `ctx` : le planning y lit ses deux colonnes de dates.
    defaultsFor: (type, rows, ctx) => defaultsForType(type, rows, ctx.profiles.map((p) => p.id))
  };

  // Une explication « Nord pèse 42 % du total de Montant » : la part d'un groupe quand les valeurs s'additionnent.
  function shareReason(c, share, ctx, withTop3) {
    const count = !!c.countMeasure;
    const top3 = withTop3 && share.n >= 4 && share.top3Share < 0.995;
    if (top3) {
      return {
        key: count ? 'advice.insight.pieTopThreeCount' : 'advice.insight.pieTopThree',
        vars: { top: share.topName, pct: insights.percentOf(share.topShare), pct3: insights.percentOf(share.top3Share), measure: c.measures[0] }
      };
    }
    return {
      key: count ? 'advice.insight.topShareCount' : 'advice.insight.topShare',
      vars: { top: share.topName, pct: insights.percentOf(share.topShare), measure: c.measures[0] }
    };
  }

  // Remplit `c.facts` (les NOMBRES derrière l'explication, pour les essais et pour qui voudra les montrer autrement),
  // `c.interest` (0 à 1), `c.insight` (clé + variables de l'explication chiffrée) et ajuste `c.score`. Ne jette JAMAIS : un
  // calcul qui échoue laisse la suggestion avec son a priori et sa raison générique.
  function annotate(c, ctx) {
    try {
      const td = c.tileData;
      const aggFn = td.aggFn;
      const measure = td.measure;
      c.countMeasure = aggFn === 'count';
      const isAdditive = aggFn === 'sum' || aggFn === 'count';
      let facts = null;
      let note = null;
      let insight = null;

      if (c.type === 'kpi' && !types.handles(c)) {
        const trend = td.trendDimension ? data.computeTrend(ctx.insightRows, td.trendDimension, measure, aggFn) : null;
        if (trend) {
          facts = { deltaPct: trend.deltaPct, latestKey: trend.latestKey, previousKey: trend.previousKey };
          // Le chiffre clé est la base d'un tableau de bord : une évolution nulle ne le dégrade pas (note neutre au plus bas), une forte l'élève.
          note = SCORE_NEUTRAL + (1 - SCORE_NEUTRAL) * Math.min(1, Math.abs(trend.deltaPct) / 30);
          const pct = Math.round(Math.abs(trend.deltaPct));
          insight = {
            key: pct === 0 ? 'advice.insight.kpiFlat' : (trend.deltaPct > 0 ? 'advice.insight.kpiUp' : 'advice.insight.kpiDown'),
            vars: { measure, pct, latest: trend.latestKey, previous: trend.previousKey }
          };
        }
      } else if (c.type === 'line') {
        const groups = groupsFor(ctx, td.dimension, measure, aggFn, td.sortMode === 'label' ? 'label' : undefined);
        const trend = insights.trendStats(groups.map((g) => g.value));
        if (trend) {
          facts = { changePct: trend.changePct, direction: trend.direction, r2: trend.r2, n: trend.n, from: String(groups[0].dimension), to: String(groups[groups.length - 1].dimension) };
          note = insights.interest.trend(trend);
          if (trend.changePct !== null) {
            const pct = Math.round(Math.abs(trend.changePct));
            insight = {
              key: pct < 5 || trend.direction === 'flat' ? 'advice.insight.lineFlat' : (trend.direction === 'up' ? 'advice.insight.lineUp' : 'advice.insight.lineDown'),
              vars: { measure, pct, from: facts.from, to: facts.to }
            };
          }
        }
      } else if (c.type === 'bar' || c.type === 'pie' || c.type === 'treemap') {
        const groups = groupsFor(ctx, td.dimension, measure, aggFn);
        const share = isAdditive ? insights.shareStats(groups) : null;
        const spread = insights.spreadStats(groups);
        if (share || spread) {
          facts = {};
          if (share) Object.assign(facts, { topName: share.topName, topShare: share.topShare, top3Share: share.top3Share, n: share.n });
          if (spread) Object.assign(facts, { ratio: spread.ratio, cv: spread.cv, maxName: spread.maxName, minName: spread.minName });
          note = c.type === 'bar' ? insights.interest.compare(share, spread) : insights.interest.share(share);
          if (share && (c.type !== 'bar' || share.topShare >= Math.max(0.25, 1.5 * share.equalShare))) {
            insight = shareReason(c, share, ctx, c.type !== 'bar');
          } else if (spread && spread.ratio !== null && spread.ratio >= SPREAD_MIN_RATIO) {
            insight = { key: c.countMeasure ? 'advice.insight.spreadCount' : 'advice.insight.spread', vars: { measure, high: spread.maxName, low: spread.minName, ratio: fmt(spread.ratio, ctx, 1) } };
          } else if (c.type === 'bar' && spread && spread.ratio !== null) {
            // « Proches » seulement quand le rapport existe (la plus petite valeur est positive) : des groupes de signes mêlés (un poste de
            // recettes et un poste de dépenses) ne sont jamais « proches », ils n'ont simplement pas de rapport.
            insight = { key: 'advice.insight.flat', vars: { dimension: td.dimension, n: groups.length } };
          }
        }
      } else if (c.type === 'scatter') {
        const xs = groupsFor(ctx, td.dimension, measure, aggFn);
        const ys = new Map(groupsFor(ctx, td.dimension, td.measureY, aggFn).map((g) => [String(g.dimension), g.value]));
        const pairs = xs.filter((g) => ys.has(String(g.dimension)));
        const corr = insights.correlationStats(pairs.map((g) => g.value), pairs.map((g) => ys.get(String(g.dimension))));
        if (!corr) {
          note = 0.2; // trop peu de points pour établir un lien : l'a priori d'un nuage de points ne tient plus
        } else {
          facts = { r: corr.r, n: corr.n };
          note = insights.interest.relation(corr);
          const vars = { measure, measureY: td.measureY, r: insights.formatCorrelation(corr.r, ctx.lang) };
          insight = { key: corr.r >= 0.5 ? 'advice.insight.scatterUp' : (corr.r <= -0.5 ? 'advice.insight.scatterDown' : 'advice.insight.scatterWeak'), vars };
        }
      } else if (c.type === 'pivot') {
        const cells = cellGroups(ctx, td.dimension, td.columnDimension, measure, aggFn);
        const share = isAdditive ? insights.shareStats(cells) : null;
        const spread = insights.spreadStats(cells);
        if (share || spread) {
          facts = share ? { topCell: share.topName, topShare: share.topShare, cells: share.n } : { cells: spread.n, ratio: spread.ratio };
          note = share ? insights.interest.share(share) : insights.interest.compare(null, spread);
          if (share) insight = { key: c.countMeasure ? 'advice.insight.pivotTopCount' : 'advice.insight.pivotTop', vars: { cell: share.topName, pct: insights.percentOf(share.topShare), measure } };
          else if (spread.ratio !== null && spread.ratio >= SPREAD_MIN_RATIO) insight = { key: c.countMeasure ? 'advice.insight.spreadCount' : 'advice.insight.spread', vars: { measure, high: spread.maxName, low: spread.minName, ratio: fmt(spread.ratio, ctx, 1) } };
        }
      } else if (types.handles(c)) {
        const typed = types.annotate(c, ctx, typeCore);
        if (typed) { facts = typed.facts; note = typed.note; insight = typed.insight; }
      } else if (c.type === 'radar') {
        const axes = td.radarAxisMode === 'columns' ? (td.radarAxes || []) : [];
        const means = axes.map((col) => ({ dimension: col, value: data.aggregateSingle(ctx.insightRows, col, 'avg') }));
        const spread = insights.spreadStats(means);
        if (spread) {
          facts = { high: spread.maxName, low: spread.minName, ratio: spread.ratio, cv: spread.cv };
          note = insights.interest.profile(spread);
          insight = (spread.ratio !== null && spread.ratio < 1.15)
            ? { key: 'advice.insight.radarEven', vars: { n: spread.n } }
            : { key: 'advice.insight.radarProfile', vars: { high: spread.maxName, low: spread.minName, highValue: fmt(spread.maxValue, ctx, 1), lowValue: fmt(spread.minValue, ctx, 1) } };
        }
      }

      // Un prix unitaire n'est jamais le chiffre vedette (il se moyenne, il ne s'additionne pas) : il passe derrière tout vrai montant, quoi
      // que disent les données (bug réel n°47 : la barre « prix par produit » varie beaucoup, ce n'est pas pour autant le premier réflexe).
      // (Un histogramme ou des boîtes de prix, eux, n'agrègent rien : voir la répartition des prix est un usage normal.)
      if (measure && aggFn && isUnitPriceName(measure)) c.score -= UNIT_PRICE_RANK_PENALTY;
      if (facts) c.facts = facts;
      if (note !== null) {
        c.interest = Math.round(note * 1000) / 1000;
        c.score += SCORE_SPAN * (note - SCORE_NEUTRAL) - (note < DULL_INTEREST ? DULL_PENALTY : 0);
      }
      if (insight) c.insight = insight;
    } catch (e) { /* un chiffre qui échoue ne retire jamais une suggestion : elle garde son a priori */ }
    return c;
  }

  // Choisit `limit` suggestions variées : à score proche, un type, une dimension ou une mesure déjà
  // retenus pèsent contre un nouveau candidat — trois « barres par région » ne montrent rien de plus
  // qu'une seule. Une même INTENTION (comparer, répartir, suivre dans le temps…) pèse un peu aussi : la
  // personne veut voir trois choses différentes, pas trois réponses à la même question.
  function pickDiverse(candidates, limit) {
    const chosen = [];
    const pool = candidates.slice();
    while (chosen.length < limit && pool.length) {
      let best = -1;
      let bestScore = -Infinity;
      pool.forEach((c, i) => {
        let s = c.score;
        chosen.forEach((k) => {
          if (k.type === c.type) s -= 3;
          if (k.intent === c.intent) s -= 0.75;
          if (c.dims.some((d) => k.dims.indexOf(d) !== -1)) s -= 1.5;
          // Les MÊMES colonnes dites autrement (une barre et un anneau de « Salaire par Service », avec la même phrase) : la 2e n'apprend rien.
          if (c.dims.length && c.dims.length === k.dims.length && c.dims.every((d) => k.dims.indexOf(d) !== -1)
            && c.measures.length === k.measures.length && c.measures.every((m) => k.measures.indexOf(m) !== -1)) s -= 2.5;
          if (c.measures.some((m) => k.measures.indexOf(m) !== -1)) s -= 0.25;
        });
        if (s > bestScore) { bestScore = s; best = i; }
      });
      chosen.push(pool.splice(best, 1)[0]);
    }
    return chosen;
  }

  // Ce que le classement lit : profil des colonnes, échantillon réparti, langue. Partagé par `suggestTiles` et `suggestAround`. Rend `null` sans ligne
  // ni colonne exploitable.
  function prepareContext(rows, columnIds, opts) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const ctx = analyzeColumns(rows, columnIds, opts && opts.columnInfo);
    if (!ctx.profiles.length) return null;
    // Les chiffres (parts, tendance, corrélation…) se calculent sur l'échantillon réparti : ce sont des rapports, jamais des totaux.
    ctx.insightRows = sampleOf(rows);
    ctx.allRows = rows; // les calculs qui ne se tirent pas au sort (jours d'un calendrier) lisent toutes les lignes
    ctx.lang = (opts && opts.lang) === 'en' ? 'en' : 'fr';
    return ctx;
  }

  function toSuggestion(c) {
    return {
      type: c.type,
      dimension: c.tileData.dimension,
      measure: c.tileData.measure,
      aggFn: c.tileData.aggFn,
      tileData: c.tileData,
      intent: c.intent,
      intentKey: INTENT_KEYS[c.intent],
      score: Math.round(c.score * 100) / 100,
      interest: c.interest,
      facts: c.facts,
      // L'explication chiffrée quand les données en donnent une, sinon la raison générique du type.
      insightKey: c.insight ? c.insight.key : undefined,
      titleKey: c.titleKey,
      titleVars: c.titleVars,
      reasonKey: c.insight ? c.insight.key : c.reasonKey,
      reasonVars: c.insight ? c.insight.vars : c.reasonVars,
      baseReasonKey: c.reasonKey,
      baseReasonVars: c.reasonVars
    };
  }

  // Tuiles à proposer pour un tableau sans aucune tuile : `opts.limit` (3 par défaut), classées par
  // pertinence. Chaque élément porte `tileData` (à passer à `store.addTile` avec un `id`), un
  // `score` et les clés d'affichage de la carte : `titleKey/titleVars` et `reasonKey/reasonVars`.
  // `opts.t` (facultatif) résout le titre persisté de la tuile dans la langue courante.
  function suggestTiles(rows, columnIds, opts) {
    const ctx = prepareContext(rows, columnIds, opts);
    if (!ctx) return [];
    const limit = (opts && opts.limit) || 3;
    const candidates = buildCandidates(rows, ctx, opts).map((c) => annotate(c, ctx));
    return pickDiverse(candidates, limit).map(toSuggestion);
  }

  // « Que faire avec cette colonne ? » (js/advice-column.js) : le MÊME catalogue de tuiles, mais la colonne choisie passe en tête de son rôle —
  // première mesure, première catégorie, axe du temps — au lieu d'attendre qu'elle soit la mieux classée (le catalogue ne regarde que les deux
  // premières mesures et les trois premières catégories : une troisième colonne n'y paraissait jamais). Rend `{ profile, suggestions }` (TOUS les
  // candidats annotés, sans choix : c'est l'appelant qui écarte ceux qui ne lisent pas la colonne, les doublons, et qui choisit) ou `null`
  // (aucune ligne, colonne inconnue). Une colonne qui n'a aucun rôle graphique (identifiant, référence, liste, texte libre, constante) rend un profil
  // et la liste que le catalogue en tire telle quelle, souvent vide.
  function focusContext(ctx, p) {
    const first = (list) => [p].concat(list.filter((q) => q !== p));
    const focus = Object.assign({}, ctx);
    if (p.role === 'measure') {
      focus.measures = first(ctx.measures);
      if (ctx.categories.indexOf(p) !== -1) focus.categories = first(ctx.categories);
    } else if (p.role === 'category' && !p.yearLike) {
      focus.categories = first(ctx.categories);
    } else if (p.role === 'time' || (p.role === 'category' && p.yearLike)) {
      focus.time = findTimeAxis([p], ctx.byId);
    }
    return focus;
  }

  function suggestAround(rows, columnIds, column, opts) {
    const ctx = prepareContext(rows, columnIds, opts);
    const profile = ctx && ctx.byId.get(column);
    if (!profile) return null;
    const focus = focusContext(ctx, profile);
    const candidates = buildCandidates(rows, focus, opts).map((c) => annotate(c, focus));
    return { profile, suggestions: candidates.map(toSuggestion) };
  }

  // ---------------------------------------------------------------------------------------------
  // Valeurs proposées par défaut pour un type de tuile
  // ---------------------------------------------------------------------------------------------

  // Champs du formulaire à préremplir quand on choisit `type`, ou null si ce tableau n'a aucune
  // colonne. Jamais « Région / Région / Somme » : la dimension est une vraie catégorie, la mesure
  // une vraie colonne numérique, distinctes — ou un comptage de lignes s'il n'existe aucun nombre.
  function defaultsForType(type, rows, columnIds) {
    if (type === 'text') return {}; // une note n'a rien à préremplir
    // Table plate : les premières colonnes de la table (une table de travail en compte vite des dizaines : une
    // tuile de 224 px n'en montre que quelques-unes ; on en coche six, la personne ajoute ou retire).
    if (type === 'table') return { columns: (columnIds || []).filter((c) => c !== 'id').slice(0, TABLE_DEFAULT_COLUMNS) };
    const ctx = analyzeColumns(rows, columnIds);
    if (!ctx.profiles.length) return null;
    const measure = ctx.measures[0];
    const m = measure
      ? { column: measure.id, aggFn: aggFor(measure) }
      : { column: ctx.countColumn, aggFn: 'count' };
    const firstCat = ctx.categories[0];
    const anyColumn = ctx.profiles[0].id;
    const dimensionFallback = (firstCat && firstCat.id) || (ctx.time && ctx.time.dimension) || anyColumn;
    const out = { measure: m.column, aggFn: m.aggFn };

    switch (type) {
      case 'bar': {
        out.dimension = dimensionFallback;
        const dimensionProfile = ctx.byId.get(out.dimension);
        if (dimensionProfile && dimensionProfile.role === 'category' && dimensionProfile.kind === 'text' && !dimensionProfile.timeLike && dimensionProfile.distinct >= 5) out.sortMode = 'value-desc';
        if (dimensionProfile && (dimensionProfile.distinct >= 9 || (dimensionProfile.distinct >= 4 && dimensionProfile.maxLen > LONG_LABEL))) out.horizontal = true;
        break;
      }
      case 'line': {
        const time = ctx.time;
        out.dimension = time ? time.dimension : dimensionFallback;
        if (time && time.drillDimensions) out.drillDimensions = time.drillDimensions;
        if (time && !time.unchecked && sortableByLabel(sampleOf(rows).map((r) => r[time.dimension]))
          && !appearsAscending(rows, time.dimension)) out.sortMode = 'label';
        break;
      }
      case 'histogram': {
        // Une colonne numérique, de préférence une vraie mesure (pas un identifiant ni un rang) ; ni dimension ni agrégat.
        const real = ctx.measures.filter((p) => !p.ordinal);
        if (!(real[0] || measure)) return null;
        out.measure = (real[0] || measure).id;
        out.dimension = '';
        delete out.aggFn;
        break;
      }
      case 'box': {
        // Une vraie colonne numérique (valeurs brutes, jamais un agrégat) réparties entre quelques groupes : une catégorie de 2 à
        // BOX_MAX_GROUPS valeurs, de préférence avec assez de lignes par groupe pour que des quartiles aient un sens.
        const real = ctx.measures.filter((p) => !p.ordinal);
        if (!(real[0] || measure)) return null;
        out.measure = (real[0] || measure).id;
        const fit = ctx.categories.filter((d) => d.id !== out.measure && d.kind === 'text' && d.distinct >= 2 && d.distinct <= data.BOX_MAX_GROUPS);
        const roomy = fit.filter((d) => rows.length / d.distinct >= data.BOX_MIN_RELIABLE);
        out.dimension = ((roomy[0] || fit[0] || {}).id) || dimensionFallback;
        delete out.aggFn;
        break;
      }
      case 'calendar': {
        // Une vraie colonne de DATES (jamais une année ou un mois dérivés : une case = un jour), de préférence avec plusieurs jours distincts.
        const dates = ctx.profiles.filter((p) => p.role === 'time');
        const best = dates.find((p) => p.distinct >= 7) || dates[0];
        if (!best) return null;
        out.dimension = best.id;
        break;
      }
      case 'gantt': {
        // Deux vraies colonnes de DATES (début, fin) : la 1re est celle qui précède l'autre sur la majorité des lignes (jugé sur les VALEURS,
        // jamais sur le nom). Libellé = une colonne texte à une valeur (presque) par ligne, sinon la catégorie la plus variée ; couleur =
        // une petite catégorie (2 à 8 valeurs) différente du libellé. Ni mesure ni agrégat : une barre est une tâche, pas un total.
        const dates = ctx.profiles.filter((p) => p.role === 'time');
        if (dates.length < 2) return null;
        let [startCol, endCol] = dates;
        let earlier = 0;
        let later = 0;
        for (const r of sampleOf(rows)) {
          const startValue = r[startCol.id];
          const endValue = r[endCol.id];
          if (isEmpty(startValue) || isEmpty(endValue)) continue;
          if (String(startValue) < String(endValue)) earlier++; else if (String(startValue) > String(endValue)) later++;
        }
        if (later > earlier) [startCol, endCol] = [endCol, startCol];
        out.startColumn = startCol.id;
        out.endColumn = endCol.id;
        const texts = ctx.profiles.filter((p) => p.kind === 'text' && p.role !== 'constant' && p.role !== 'time');
        const taskLike = texts.filter((p) => p.role === 'identifier' || p.role === 'highCardinality');
        const label = taskLike[0] || [...texts].sort((a, b) => b.distinct - a.distinct)[0];
        out.dimension = label ? label.id : dimensionFallback;
        const status = ctx.categories.find((d) => d.kind === 'text' && d.id !== out.dimension && d.distinct >= 2 && d.distinct <= 8);
        if (status) out.seriesColumn = status.id;
        delete out.measure;
        delete out.aggFn;
        break;
      }
      case 'combo': {
        // Barres = la mesure principale ; courbe = une AUTRE vraie mesure s'il y en a une. Sinon (une seule
        // mesure) un Pareto, qui n'en demande pas d'autre : barres triées + part cumulée.
        out.dimension = dimensionFallback;
        const second = ctx.measures.filter((p) => !p.ordinal).find((p) => p.id !== out.measure);
        if (second) {
          out.measureY = second.id;
          if (aggFor(second) !== out.aggFn) out.aggFnY = aggFor(second);
        } else {
          out.comboMode = 'pareto';
          out.aggFn = measure ? 'sum' : 'count'; // un Pareto additionne : jamais une moyenne
        }
        break;
      }
      case 'pie': {
        const small = ctx.categories.find((d) => d.kind === 'text' && d.distinct >= 2 && d.distinct <= 6);
        out.dimension = (small && small.id) || dimensionFallback;
        out.donut = true;
        out.showPct = true;
        out.sortMode = 'value-desc';
        break;
      }
      case 'funnel': {
        // Peu d'étapes (3 à 8), triées par valeur : le sens habituel d'un entonnoir. Une dimension
        // qui se range d'elle-même (mois, périodes) garde l'ordre des données : ce sont des étapes.
        const stages = ctx.categories.find((d) => d.kind === 'text' && d.distinct >= 3 && d.distinct <= 8 && !d.timeLike);
        out.dimension = (stages && stages.id) || dimensionFallback;
        const dimensionColumn = ctx.byId.get(out.dimension);
        if (!(dimensionColumn && (dimensionColumn.timeLike || dimensionColumn.role === 'time' || dimensionColumn.role === 'timePart'))) out.sortMode = 'value-desc';
        break;
      }
      case 'treemap':
      case 'waterfall':
      case 'wordcloud':
      case 'progress': // une barre par catégorie : la même dimension qu'un treemap (l'objectif se saisit)
        out.dimension = dimensionFallback;
        if (type === 'wordcloud') {
          const text = ctx.profiles.find((p) => p.role === 'freeText') || ctx.profiles.find((p) => p.kind === 'text' && p.role !== 'constant');
          if (text) out.dimension = text.id;
          delete out.measure;
          delete out.aggFn;
          if (text && text.avgLen > 20) out.wordCloudSplit = true;
        } else if (type === 'waterfall' && ctx.time) {
          out.dimension = ctx.time.dimension;
        }
        break;
      case 'scatter': {
        const real = ctx.measures.filter((p) => !p.ordinal);
        out.measure = (real[0] || measure || {}).id || m.column;
        out.measureY = (real[1] || real[0] || measure || {}).id || m.column;
        out.aggFn = measure ? (((real[0] && real[0].score) || (real[1] && real[1].score)) ? 'avg' : 'sum') : 'count';
        const point = ctx.profiles.find((p) => (p.role === 'category' && !p.yearLike && p.distinct >= 5) || p.role === 'highCardinality');
        out.dimension = (point && point.id) || dimensionFallback;
        break;
      }
      case 'radar': {
        const axes = radarAxisColumns(ctx);
        if (axes.length >= 3) {
          out.radarAxisMode = 'columns';
          out.radarAxes = axes;
          out.dimension = '';
          out.measure = axes[0];
          out.aggFn = 'avg';
        } else {
          const small = ctx.categories.find((d) => d.distinct >= 3 && d.distinct <= RADAR_MAX_AXES);
          out.radarAxisMode = 'dimension';
          out.dimension = (small && small.id) || dimensionFallback;
          out.aggFn = measure ? 'avg' : 'count';
        }
        break;
      }
      case 'sunburst': {
        // Deux anneaux au moins : deux catégories (un soleil à un seul anneau n'est qu'un camembert). De préférence une VRAIE hiérarchie, jugée sur
        // les valeurs : chaque valeur de la colonne du dehors n'apparaît que sous UNE valeur de la colonne du centre (département dans région) ;
        // sinon les deux premières petites catégories. Toujours Somme (ou Comptage) : l'angle d'une part s'additionne.
        const small = ctx.categories.filter((d) => d.kind === 'text' && d.distinct >= 2 && d.distinct <= data.SUNBURST_MAX_CHILDREN);
        let pair = null;
        for (const parent of small) {
          for (const child of small) {
            if (parent.id === child.id || child.distinct <= parent.distinct) continue;
            const owners = new Map();
            let nested = true;
            for (const r of rows) {
              const childValue = r[child.id];
              const p = r[parent.id];
              if (childValue == null || childValue === '' || p == null || p === '') continue;
              const seen = owners.get(String(childValue));
              if (seen === undefined) owners.set(String(childValue), String(p));
              else if (seen !== String(p)) { nested = false; break; }
            }
            if (nested && !pair) pair = [parent.id, child.id];
          }
        }
        if (!pair && small.length >= 2) pair = [small[0].id, small[1].id];
        out.dimension = pair ? pair[0] : ((small[0] && small[0].id) || dimensionFallback);
        const other = pair ? pair[1] : ctx.categories.map((d) => d.id).find((id) => id !== out.dimension);
        if (other) out.drillDimensions = [other];
        out.aggFn = measure ? 'sum' : 'count';
        break;
      }
      case 'pivot':
      case 'heatmap':
      case 'sankey': {
        const small = ctx.categories.filter((d) => d.kind === 'text' && d.distinct >= 2 && d.distinct <= 12);
        out.dimension = (small[0] && small[0].id) || dimensionFallback;
        const other = (small[1] && small[1].id) || ctx.categories.map((d) => d.id).find((id) => id !== out.dimension);
        if (other) out.columnDimension = other;
        // Un flux s'additionne : jamais une moyenne, même si c'est l'agrégat habituel de cette colonne (une note).
        if (type === 'sankey') out.aggFn = measure ? 'sum' : 'count';
        break;
      }
      case 'kpi':
        out.dimension = '';
        if (ctx.time && ctx.time.numericKeys && ctx.byId.get(ctx.time.dimension).distinct >= 2) out.trendDimension = ctx.time.dimension;
        break;
      case 'gauge': {
        out.dimension = '';
        const value = data.aggregateSingle(rows, m.column, m.aggFn);
        out.gaugeMin = (measure && measure.negatives > 0) ? -niceCeil(Math.abs(measure.min)) : 0;
        out.gaugeMax = niceCeil(Math.max(value, 0) * 1.1);
        break;
      }
      default:
        return null;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Avertissements de lisibilité
  // ---------------------------------------------------------------------------------------------

  function round(x) { return Math.round(x * 100) / 100; }

  // Un conseil sur la tuile `tile` (existante ou brouillon du formulaire) pour les données `rows`,
  // ou null : `{ key, vars, level }` — `level` vaut 'warn' (le graphique est trompeur ou illisible)
  // ou 'tip' (il se lit mieux autrement). Un seul conseil, le plus important : l'interface n'a
  // jamais à arbitrer entre plusieurs. Évalué sur TOUTES les lignes, sans tenir compte des
  // filtres croisés actifs : un conseil qui apparaîtrait ou disparaîtrait à chaque clic sur une
  // autre tuile ne serait pas un conseil sur le graphique lui-même.
  function adviceForTile(tile, rows) {
    if (!tile || !tile.type || tile.type === 'text' || tile.type === 'table' || !Array.isArray(rows) || !rows.length) return null;
    const type = tile.type;
    const noDimension = type === 'kpi' || type === 'gauge' || (type === 'bar' && tile.measureMode && tile.measureMode !== 'brut')
      || (type === 'radar' && tile.radarAxisMode === 'columns');
    const hasDimension = !!tile.dimension && !noDimension;
    const dimProfile = hasDimension ? profileColumns(rows, [tile.dimension])[0] : null;
    const measureProfile = (tile.measure && tile.aggFn !== 'count') ? profileColumns(rows, [tile.measure])[0] : null;
    const warn = (key, vars) => ({ key, vars: vars || {}, level: 'warn' });
    const tip = (key, vars) => ({ key, vars: vars || {}, level: 'tip' });
    const agg = hasDimension && tile.measure
      ? data.groupByAggregate(rows, tile.dimension, tile.measure, tile.aggFn || 'sum')
      : [];
    const n = agg.length;
    const timeLike = !!dimProfile && (dimProfile.role === 'time' || dimProfile.role === 'timePart' || dimProfile.yearLike
      || (dimProfile.kind === 'number')
      || timeLikeRatio(agg.map((g) => g.dimension)) >= 0.7);

    // Graphiques trompeurs ou illisibles.
    if (type === 'pie') {
      if (agg.some((g) => g.value < 0)) return warn('advice.pie.negative');
      if (n > PIE_MAX_SLICES) return warn('advice.pie.tooManySlices', { n });
    }
    if (type === 'treemap' && agg.some((g) => g.value < 0)) return warn('advice.treemap.negative');
    if (type === 'histogram' && measureProfile && measureProfile.distinct < 5) return warn('advice.histogram.fewValues');
    if (type === 'box' && hasDimension && tile.measure) {
      // Trop de boîtes pour la largeur d'une tuile, ou trop peu de valeurs par boîte pour que des quartiles disent quelque chose.
      const stats = data.boxStatsByGroup(rows, tile.dimension, tile.measure).groups;
      if (stats.length > data.BOX_MAX_GROUPS) return warn('advice.box.tooManyGroups', { n: stats.length });
      if (stats.length && stats.every((g) => g.n < data.BOX_MIN_RELIABLE)) return warn('advice.box.fewValues');
    }
    if (type === 'heatmap' && tile.columnDimension) {
      // Une case lisible demande de la place : au-delà de ~24 lignes ou colonnes, plus de nombre dans la case, des libellés
      // masqués un sur deux — mieux vaut regrouper (par mois plutôt que par jour, par famille plutôt que par produit).
      const colCount = new Set(rows.map((r) => r[tile.columnDimension])).size;
      if (n > HEATMAP_MAX_AXIS || colCount > HEATMAP_MAX_AXIS) return warn('advice.heatmap.tooBig', { rows: n, columns: colCount });
    }
    if (type === 'calendar' && tile.dimension && tile.measure) {
      // Une case par jour : la colonne doit contenir de vraies dates, il en faut assez pour que le calendrier dise quelque chose,
      // et au-delà d'un an seule la dernière année est dessinée.
      const cal = data.calendarDays(rows, tile.dimension, tile.measure, tile.aggFn);
      if (!cal.total) return warn('advice.calendar.notDate', { dimension: tile.dimension });
      if (cal.total < 7) return warn('advice.calendar.fewDays', { n: cal.total });
      if (cal.hidden > 0) return tip('advice.calendar.truncated', { days: data.CALENDAR_MAX_DAYS, hidden: cal.hidden });
    }
    if (type === 'gantt' && tile.dimension && tile.startColumn && tile.endColumn) {
      // Une barre demande un début ET une fin valides, la fin ne précédant pas le début ; au-delà de quelques centaines de lignes la tuile
      // n'en dessine que les premières ; au-delà de la longueur de la palette, deux statuts partagent une couleur.
      const gt = data.ganttTasks(rows, tile.dimension, tile.startColumn, tile.endColumn, tile.seriesColumn);
      if (!gt.total) return warn('advice.gantt.noTask', { start: tile.startColumn, end: tile.endColumn });
      if (gt.statuses.length > data.paletteColors(tile.palette).length) return warn('advice.gantt.manyStatuses', { n: gt.statuses.length, max: data.paletteColors(tile.palette).length });
      if (gt.ignored > 0) return tip('advice.gantt.ignored', { n: gt.ignored });
      if (gt.hidden > 0) return tip('advice.gantt.truncated', { max: data.GANTT_MAX_ROWS, hidden: gt.hidden });
    }
    if (type === 'sankey' && tile.dimension && tile.columnDimension && tile.measure) {
      // Un flux s'additionne ; au-delà d'une quinzaine de nœuds ce n'est plus qu'un écheveau ; un flux nul ou négatif n'a pas d'épaisseur.
      if (tile.aggFn === 'avg' || tile.aggFn === 'min' || tile.aggFn === 'max') return warn('advice.sankey.notAdditive');
      const sk = data.sankeyFlows(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
      const nodes = sk.sources.length + sk.targets.length;
      if (nodes > data.SANKEY_MAX_NODES) return warn('advice.sankey.tooManyNodes', { nodes });
      if (sk.dropped > 0) return tip('advice.sankey.dropped', { n: sk.dropped });
    }
    if (type === 'sunburst' && tile.dimension) {
      // Un anneau additionne ses parts ; une valeur négative n'a pas d'angle ; au-delà de la palette, les couleurs des parts centrales se répètent ;
      // des anneaux au-delà du plafond ou des petites parts écartées ne se voient pas.
      if (tile.aggFn === 'avg' || tile.aggFn === 'min' || tile.aggFn === 'max') return warn('advice.sunburst.notAdditive');
      const levelsWanted = [tile.dimension].concat(data.tileDrillLevels(tile)).filter((c, i, all) => c && all.indexOf(c) === i);
      const sb = data.sunburstTree(rows, data.sunburstLevels(tile), tile.measure, tile.aggFn);
      if (sb.negative > 0) return warn('advice.sunburst.negative');
      if (levelsWanted.length > data.SUNBURST_MAX_LEVELS) return warn('advice.sunburst.tooManyLevels', { max: data.SUNBURST_MAX_LEVELS });
      const colors = data.paletteColors(tile.palette).length;
      if (sb.roots.length > colors) return tip('advice.sunburst.tooManyColors', { n: sb.roots.length, max: colors });
      if (sb.hidden > 0) return tip('advice.sunburst.hidden', { n: sb.hidden, max: data.SUNBURST_MAX_CHILDREN });
    }
    if (type === 'combo') {
      if (tile.comboMode === 'pareto') {
        if (tile.aggFn === 'avg' || tile.aggFn === 'min' || tile.aggFn === 'max') return warn('advice.combo.paretoAgg');
        if (agg.some((g) => g.value < 0)) return warn('advice.combo.paretoNegative');
      } else if (tile.measureY === tile.measure && (tile.aggFnY || tile.aggFn) === tile.aggFn) {
        return warn('advice.combo.sameSeries');
      }
      if (n > BAR_MAX_VERTICAL * 2) return warn('advice.combo.manyBars', { n });
    }
    if (type === 'funnel') {
      if (agg.some((g) => g.value < 0)) return warn('advice.funnel.negative');
      if (n > FUNNEL_MAX_STAGES) return warn('advice.funnel.tooManyStages', { n });
    }
    if (type === 'line' && hasDimension) {
      if (!timeLike) return warn('advice.line.notTime', { dimension: tile.dimension });
      if (tile.sortMode === 'value-desc' || tile.sortMode === 'value-asc') return warn('advice.line.valueSort');
    }
    if (type === 'scatter' && hasDimension) {
      // Bulles : la colonne de couleur ne peut pas être celle des points ; au-delà du nombre de couleurs de la palette elles se
      // répètent ; une taille nulle ou négative n'a pas d'aire (la bulle n'est pas dessinée).
      if (tile.seriesColumn) {
        if (tile.seriesColumn === tile.dimension) return warn('advice.bubble.sameAsDimension');
        const colors = new Set(rows.map((r) => r[tile.seriesColumn])).size;
        const cap = Math.min(SERIES_MAX, data.paletteColors(tile.palette).length);
        if (colors > cap) return warn('advice.bubble.tooManyColors', { n: colors, max: cap });
      }
      if (tile.measureSize) {
        const sizes = data.groupByAggregate(rows, tile.dimension, tile.measureSize, tile.aggFnSize || tile.aggFn || 'sum');
        const flat = sizes.filter((g) => { const v = typeof g.value === 'bigint' ? Number(g.value) : g.value; return !(Number.isFinite(v) && v > 0); }).length;
        if (flat) return warn('advice.bubble.sizeSign', { n: flat });
      }
    }
    if (data.isSeriesTile(tile)) {
      if (tile.seriesColumn === tile.dimension) return warn('advice.series.sameAsDimension');
      const seriesCount = new Set(rows.map((r) => r[tile.seriesColumn])).size;
      // Au-delà du nombre de couleurs de la palette choisie, ECharts reprend au début : deux séries
      // auraient la même couleur. Le plafond suit donc la palette (8 en Standard, 6 en Okabe-Ito…).
      const seriesCap = Math.min(SERIES_MAX, data.paletteColors(tile.palette).length);
      // Petits multiples : une couleur par série n'est plus le sujet (chaque série a son panneau) ; le plafond est le nombre de panneaux,
      // et des catégories trop nombreuses n'ont plus la place de se lire dans un panneau étroit.
      const small = data.isSmallMultiplesTile(tile);
      if (small && seriesCount > data.SMALL_MULTIPLES_MAX) return warn('advice.smallMultiples.tooMany', { n: seriesCount, max: data.SMALL_MULTIPLES_MAX });
      if (small && seriesCount < 2) return tip('advice.smallMultiples.single');
      if (small && n > SMALL_MULTIPLES_MAX_CATEGORIES) return tip('advice.smallMultiples.tooManyCategories', { n, max: SMALL_MULTIPLES_MAX_CATEGORIES });
      if (!small && seriesCount > seriesCap) return warn('advice.series.tooMany', { n: seriesCount, max: seriesCap });
      // Une pile additionne les hauteurs : sans sens pour une moyenne, un minimum ou un maximum.
      if (data.isStackedTile(tile) && (tile.aggFn === 'avg' || tile.aggFn === 'min' || tile.aggFn === 'max')) return warn('advice.stacked.notAdditive');
      // 100 % : une part n'a de sens que pour des valeurs positives (un total nul ou une pile qui descend sous zéro ne se lit pas en %).
      if (data.isStackedPercentTile(tile) && tile.aggFn === 'sum' && rows.some((r) => numericValue(r[tile.measure]) !== null && numericValue(r[tile.measure]) < 0)) return warn('advice.stackedPercent.negative');
    }
    // Palette choisie plus courte que le nombre de parts/étapes : la 1re couleur revient (et un camembert
    // fait se toucher la 1re et la dernière part). Seulement quand une palette a été choisie : le
    // comportement de la palette historique ne change pas.
    if (tile.palette && (type === 'pie' || type === 'funnel' || type === 'treemap')) {
      const colors = data.paletteColors(tile.palette).length;
      if (n > colors) return warn('advice.palette.tooFewColors', { n, max: colors });
    }
    if (type === 'radar') {
      const axes = tile.radarAxisMode === 'columns' ? (tile.radarAxes || []).length : n;
      if (axes > RADAR_MAX_AXES) return warn('advice.radar.tooManyAxes', { n: axes });
      // Mode colonnes : tous les axes partagent la MÊME échelle (voulu : une compétence notée sur 20 ne se compare qu'à une
      // autre notée sur 20). Des colonnes d'ordres de grandeur très différents (une quantité à 19 et un montant à 65 420)
      // écrasent alors les petites au centre : un avertissement plutôt qu'une normalisation qui fausserait la comparaison.
      if (tile.radarAxisMode === 'columns') {
        const means = (tile.radarAxes || []).filter(Boolean)
          .map((col) => ({ col, v: Math.abs(Number(data.aggregateSingle(rows, col, 'avg'))) }))
          .filter((m) => Number.isFinite(m.v) && m.v > 0);
        if (means.length > 1) {
          const small = means.reduce((a, b) => (b.v < a.v ? b : a));
          const big = means.reduce((a, b) => (b.v > a.v ? b : a));
          if (big.v / small.v >= RADAR_SCALE_RATIO) return warn('advice.radar.mixedScales', { small: small.col, big: big.col });
        }
      }
    }
    if (type === 'gauge' && tile.measure && Number.isFinite(tile.gaugeMin) && Number.isFinite(tile.gaugeMax)) {
      const value = data.aggregateSingle(rows, tile.measure, tile.aggFn || 'sum');
      if (value < tile.gaugeMin || value > tile.gaugeMax) {
        return warn('advice.gauge.outOfRange', { value: round(value), min: tile.gaugeMin, max: tile.gaugeMax });
      }
    }

    // Données incomplètes : la tuile n'en montre qu'une partie.
    const emptyColumn = [dimProfile, measureProfile].find((p) => p && p.emptyRatio > 0.5);
    if (emptyColumn) return warn('advice.data.mostlyEmpty', { column: emptyColumn.id, pct: Math.round(emptyColumn.emptyRatio * 100) });

    // Se lit mieux autrement.
    if ((type === 'line' || type === 'waterfall') && hasDimension && tile.sortMode !== 'label' && timeLike
      && sortableByLabel(agg.map((g) => g.dimension)) && !appearsAscending(rows, tile.dimension)) {
      return tip(type === 'line' ? 'advice.line.unordered' : 'advice.waterfall.unordered', { dimension: tile.dimension });
    }
    if (type === 'line' && hasDimension && n > 0 && n < 3) return tip('advice.line.fewPoints', { n });
    if (type === 'bar' && hasDimension && !tile.measureMode && !tile.horizontal) {
      if (n > BAR_MAX_VERTICAL) return tip('advice.bar.horizontal', { n });
      const longest = agg.reduce((m, g) => Math.max(m, String(g.dimension).length), 0);
      if (n >= 4 && longest > LONG_LABEL) return tip('advice.bar.longLabels', { maxLen: longest });
    }
    if ((type === 'bar' || type === 'pie') && hasDimension && !tile.sortMode && n >= 6 && !timeLike
      && !(tile.measureMode && tile.measureMode !== 'brut')) {
      return tip('advice.bar.unsorted');
    }
    return null;
  }

  // Pourquoi un type est inutilisable avec ces données (rien de plus parlant qu'un champ qui se
  // remplit tout seul d'une mauvaise colonne), ou null.
  function typeFit(type, ctx) {
    const hasMeasure = ctx.measures.length > 0;
    switch (type) {
      case 'scatter':
        return ctx.measures.filter((p) => !p.ordinal).length < 2 ? 'advice.fit.needTwoMeasures' : null;
      case 'pivot':
      case 'heatmap':
      case 'sankey':
      case 'sunburst':
        return ctx.categories.filter((d) => d.distinct >= 2).length < 2 ? 'advice.fit.needTwoDimensions' : null;
      case 'wordcloud':
        return ctx.profiles.some((p) => p.kind === 'text' && p.role !== 'constant') ? null : 'advice.fit.needText';
      case 'line':
        return ctx.time ? null : 'advice.fit.noTime';
      case 'calendar':
        return ctx.profiles.some((p) => p.role === 'time') ? null : 'advice.fit.noDate';
      case 'gantt':
        return ctx.profiles.filter((p) => p.role === 'time').length >= 2 ? null : 'advice.fit.noTwoDates';
      case 'kpi':
      case 'gauge':
      case 'histogram':
      case 'box':
        return hasMeasure ? null : 'advice.fit.noMeasure';
      default:
        return null;
    }
  }

  // Une ligne par type pour l'étape « Choisir » : l'avertissement que ce type provoquerait avec les
  // valeurs par défaut du tableau (voir defaultsForType), sinon la raison pour laquelle ces données ne
  // s'y prêtent pas, sinon la phrase générique « quand l'utiliser ». Toujours un objet, jamais null.
  function adviceForType(type, rows, columnIds) {
    const generic = { key: USE_KEYS[type] || USE_KEYS.bar, vars: {}, level: 'info' };
    if (type === 'text' || type === 'table') return generic;
    if (!USE_KEYS[type] || !Array.isArray(rows) || !rows.length) return generic;
    const ctx = analyzeColumns(rows, columnIds);
    if (!ctx.profiles.length) return generic;
    const unfit = typeFit(type, ctx);
    if (unfit) return { key: unfit, vars: {}, level: 'warn' };
    const defaults = defaultsForType(type, rows, columnIds);
    const warning = defaults ? adviceForTile(Object.assign({ type }, defaults), rows) : null;
    return warning || generic;
  }

  // ---------------------------------------------------------------------------------------------
  // Aperçu d'une suggestion
  // ---------------------------------------------------------------------------------------------

  // Plus grand nombre de points tracés dans une miniature : au-delà, on ne voit qu'une tendance.
  const PREVIEW_MAX_POINTS = 24;
  const PREVIEW_MAX_BARS = 6;

  function topShares(groups, max) {
    const positive = groups.filter((g) => Number.isFinite(g.value) && g.value > 0)
      .sort((a, b) => b.value - a.value).slice(0, max);
    const total = positive.reduce((sum, g) => sum + g.value, 0);
    return total > 0 ? positive.map((g) => g.value / total) : null;
  }

  function evenSample(values, max) {
    if (values.length <= max) return values;
    return Array.from({ length: max }, (_, i) => values[Math.round(i * (values.length - 1) / (max - 1))]);
  }

  // Miniature d'une tuile à partir des vraies données, SANS ECharts : des nombres normalisés (0 à 1)
  // qu'une fonction de dessin SVG (js/welcome.js:previewSvg) transforme en quelques traits. Une
  // vraie instance ECharts par carte d'accueil coûterait un graphique complet (et ses gestionnaires
  // de clic, branchés sur le store) pour une vignette de 120 pixels. `null` si le type n'a pas de
  // miniature ou si les données n'en donnent aucune.
  function previewFor(tileData, rows) {
    if (!tileData || !Array.isArray(rows) || !rows.length) return null;
    const type = tileData.type;
    const aggFn = tileData.aggFn || 'sum';
    const grouped = () => {
      const groups = data.groupByAggregate(rows, tileData.dimension, tileData.measure, aggFn);
      return data.isSortableTile(tileData) ? data.sortGroups(groups, tileData.sortMode) : groups;
    };
    switch (type) {
      case 'kpi': {
        const trend = tileData.trendDimension
          ? data.computeTrend(rows, tileData.trendDimension, tileData.measure, aggFn) : null;
        return { kind: 'value', value: data.aggregateSingle(rows, tileData.measure, aggFn), trendPct: trend ? trend.deltaPct : null };
      }
      case 'bar': {
        const values = grouped().slice(0, PREVIEW_MAX_BARS).map((g) => Math.abs(Number(g.value)) || 0);
        const top = Math.max.apply(null, values);
        return top > 0 ? { kind: 'bars', values: values.map((v) => v / top), horizontal: !!tileData.horizontal } : null;
      }
      case 'line': {
        const values = evenSample(grouped().map((g) => Number(g.value) || 0), PREVIEW_MAX_POINTS);
        if (values.length < 2) return null;
        const lo = Math.min.apply(null, values);
        const hi = Math.max.apply(null, values);
        return { kind: 'line', values: values.map((v) => (hi === lo ? 0.5 : (v - lo) / (hi - lo))), area: !!tileData.areaFill };
      }
      case 'pie': {
        const values = topShares(grouped(), PREVIEW_MAX_BARS);
        return values ? { kind: 'pie', values, donut: !!tileData.donut } : null;
      }
      case 'treemap': {
        const values = topShares(grouped(), PREVIEW_MAX_BARS);
        return values ? { kind: 'treemap', values } : null;
      }
      case 'funnel': {
        // Largeurs relatives à la plus large étape, dans l'ordre affiché (tri choisi ou ordre des données).
        const values = grouped().slice(0, PREVIEW_MAX_BARS).map((g) => Math.max(0, Number(g.value) || 0));
        const top = Math.max.apply(null, values);
        return (values.length >= 2 && top > 0) ? { kind: 'funnel', values: values.map((v) => v / top) } : null;
      }
      case 'scatter': {
        const xs = data.groupByAggregate(rows, tileData.dimension, tileData.measure, aggFn).map((g) => Number(g.value) || 0);
        const ys = data.groupByAggregate(rows, tileData.dimension, tileData.measureY, aggFn).map((g) => Number(g.value) || 0);
        const n = Math.min(xs.length, ys.length, 20);
        if (n < 2) return null;
        const norm = (arr) => {
          const lo = Math.min.apply(null, arr);
          const hi = Math.max.apply(null, arr);
          return arr.map((v) => (hi === lo ? 0.5 : (v - lo) / (hi - lo)));
        };
        const nx = norm(xs.slice(0, n));
        const ny = norm(ys.slice(0, n));
        return { kind: 'points', points: nx.map((x, i) => ({ x, y: ny[i] })) };
      }
      case 'radar': {
        const values = tileData.radarAxisMode === 'columns'
          ? (tileData.radarAxes || []).map((col) => data.aggregateSingle(rows, col, 'avg'))
          : grouped().map((g) => Number(g.value) || 0);
        const top = Math.max.apply(null, values.map(Math.abs));
        return (values.length >= 3 && top > 0) ? { kind: 'radar', values: values.map((v) => Math.abs(v) / top) } : null;
      }
      case 'gauge': {
        const value = data.aggregateSingle(rows, tileData.measure, aggFn);
        const span = tileData.gaugeMax - tileData.gaugeMin;
        return span > 0 ? { kind: 'gauge', ratio: Math.max(0, Math.min(1, (value - tileData.gaugeMin) / span)) } : null;
      }
      case 'pivot':
        return { kind: 'grid' };
      case 'heatmap':
        // Les vraies cases (la plus chaude se voit), sinon la trame d'un tableau.
        return types.previewFor(tileData, rows, typeCore) || { kind: 'grid' };
      default:
        // Pareto / barres + courbe, histogramme, boîtes, cascade, calendrier, planning, soleil, objectif : js/advice-types.js.
        return types.previewFor(tileData, rows, typeCore);
    }
  }

  return {
    TILE_TYPES, USE_KEYS, INTENT_KEYS, INTENT_BY_TYPE, previewFor, setColumnInfo,
    profileColumns, analyzeColumns, columnKind,
    suggestTiles, suggestAround, defaultsForType, adviceForTile, adviceForType,
    appearsAscending, isUnitPriceName, aggFor, HIERARCHY_RE
  };
});
