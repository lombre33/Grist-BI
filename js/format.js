/*
 * Format des nombres affichés sur les tuiles (KPI, jauge, infobulles, étiquettes, tableau croisé,
 * libellés d'axe) : UN SEUL endroit, pur JS, testable sous Node (dev-tests/test-data.js), sans DOM ni
 * Grist — comme js/data.js. js/charts.js n'a plus aucun `Intl.NumberFormat` en dur.
 *
 * Pourquoi un module : avant lui, la langue était figée sur `fr-FR`, trois formats coexistaient
 * (complet à 2 décimales, compact à 1 décimale, et celui d'ECharts par défaut — « 1,542,980.8799999997 »
 * en infobulle de barre/courbe/camembert/treemap/cascade) et une valeur minuscule (0,0006) s'affichait
 * « 0 » (audit de lisibilité du 18/11/2026).
 *
 * Trois modes par tuile (`tile.numberFormat`, absent = Automatique) :
 *  - `auto` (défaut) : séparateurs de la LANGUE de l'interface (fr -> « 3 266 234 », en -> « 3,266,234 ») et
 *    peu de chiffres significatifs : entiers dès 1 000, 1 décimale de 100 à 1 000, 2 décimales de 0,1 à 100,
 *    puis 2 chiffres significatifs (« 0,00062 ») ; compact (« 1,5 Bn ») dès 10^12.
 *  - `custom` : `{ mode: 'custom', decimals: 'auto' | 0..6, notation: 'standard' | 'compact' }` ; un nombre
 *    de décimales est FIXE (« 3 266 234,27 »).
 *  - `column` : reprend les options de la colonne dans Grist (`widgetOptions` de `_grist_Tables_column` :
 *    `numMode` currency/decimal/percent/scientific, `currency`, `decimals` = minimum, `maxDecimals`,
 *    `numSign` = parenthèses) et la langue du DOCUMENT (`locale` des réglages du document). Une colonne
 *    sans aucune option de décimales n'a rien à reprendre : même rendu qu'Automatique.
 *
 * Les libellés d'AXE (`axis`) restent toujours compacts (3 chiffres significatifs : « 0,05 », « 1,5 M ») quel
 * que soit le mode — un axe en notation complète déborderait de la tuile (bug réel du 1er passage de design,
 * voir HYPOTHESES.md) — mais suivent la langue du mode.
 *
 * Ce que ce module ne prouve pas : la forme exacte de `widgetOptions` et des réglages du document dans un
 * VRAI Grist n'a été vérifiée que contre la documentation/le comportement connu du moteur, pas contre un
 * document réel (voir HYPOTHESES.md).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.format = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOCALE_BY_LANG = { fr: 'fr-FR', en: 'en-US' };
  const MODES = ['auto', 'custom', 'column'];
  const MAX_CUSTOM_DECIMALS = 6;
  // Au-delà, même un entier complet ne se lit plus (13 chiffres et plus) : l'Automatique passe en compact.
  const AUTO_COMPACT_FROM = 1e12;

  function localeForLang(lang) { return LOCALE_BY_LANG[lang] || LOCALE_BY_LANG.fr; }

  // Une locale de document Grist est un BCP-47 ('fr-FR', 'en-US', 'de-CH'...). Une valeur que le navigateur
  // ne sait pas formater ne doit jamais faire lever le rendu : repli sur la langue de l'interface.
  function usableLocale(locale, fallback) {
    if (typeof locale !== 'string' || !locale) return fallback;
    try { return new Intl.NumberFormat(locale).resolvedOptions().locale; } catch (e) { return fallback; }
  }

  // Nombre propre : une somme de flottants traîne du bruit (« 1542980.8799999997 »), qui ressort dès qu'on
  // demande beaucoup de décimales. 14 chiffres significatifs restent sous la précision d'un double (~15,9).
  function cleanFloat(n) {
    return Number.isInteger(n) ? n : Number(n.toPrecision(14));
  }

  // Valeur reçue (nombre, BigInt de DuckDB au-delà de 5 000 lignes, chaîne numérique) -> nombre fini ou null.
  function toNumber(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Les `Intl.NumberFormat` coûtent cher à construire (un tableau croisé en formate des centaines) : mis en cache
  // par jeu d'options.
  const intlCache = new Map();
  function intl(locale, options) {
    const key = `${locale}|${JSON.stringify(options)}`;
    let cachedIntl = intlCache.get(key);
    if (!cachedIntl) { cachedIntl = new Intl.NumberFormat(locale, options); intlCache.set(key, cachedIntl); }
    return cachedIntl;
  }

  // Une échelle de valeurs (jauge, classes d'un histogramme) dont les deux bouts sont des ENTIERS de moins de 5 chiffres
  // s'écrit en toutes lettres : « 1990, 2000, 2010 » (des années), « 0, 1000, 2000, 3000 » (une colonne entière sans
  // format), pas « 1,99 k, 2 k, 2,01 k ». En dessous de 10 000, le compact ne gagne que deux caractères et fait perdre
  // la lecture exacte ; au-delà (« 3,3 M ») il est indispensable. La décision porte sur L'ÉCHELLE ENTIÈRE, jamais sur une
  // valeur isolée : sur un même axe, « 1000 » à côté de « 1,5 k » se lirait comme deux unités différentes.
  const PLAIN_SCALE_BELOW = 10000;
  function plainScale(lo, hi) {
    const lowValue = toNumber(lo);
    const highValue = toNumber(hi);
    return lowValue != null && highValue != null && Number.isInteger(lowValue) && Number.isInteger(highValue) && Math.max(Math.abs(lowValue), Math.abs(highValue)) < PLAIN_SCALE_BELOW;
  }

  // Règle d'Automatique, par magnitude de la valeur (voir l'en-tête).
  function autoOptions(n) {
    const magnitude = Math.abs(n);
    if (magnitude === 0 || magnitude >= 1000) return { maximumFractionDigits: 0 };
    if (magnitude >= 100) return { maximumFractionDigits: 1 };
    if (magnitude >= 0.1) return { maximumFractionDigits: 2 };
    return { maximumSignificantDigits: 2 };
  }

  // --- Lecture des options d'une colonne Grist -------------------------------------------------

  // `widgetOptions` arrive en chaîne JSON depuis `_grist_Tables_column` (vide pour une colonne sans réglage).
  function parseWidgetOptions(raw) {
    if (raw && typeof raw === 'object') return Array.isArray(raw) ? {} : raw;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { return {}; }
  }

  // Réglages du document (`documentSettings` de `_grist_DocInfo`, JSON) : `{ locale, currency }` ou null.
  function parseDocSettings(raw) {
    const o = parseWidgetOptions(raw);
    const out = {};
    if (typeof o.locale === 'string' && o.locale) out.locale = o.locale;
    if (typeof o.currency === 'string' && o.currency) out.currency = o.currency;
    return (out.locale || out.currency) ? out : null;
  }

  function isIntegerOption(v) { return Number.isInteger(v) && v >= 0 && v <= 20; }

  // Options d'une colonne -> « style » prêt à formater. `null` si la colonne n'est pas numérique.
  function styleFromColumn(column, docSettings, lang) {
    const uiLocale = localeForLang(lang);
    const locale = usableLocale(docSettings && docSettings.locale, uiLocale);
    const base = { locale, kind: 'decimal', useAuto: true, autoCompact: true, minFD: 0, maxFD: 0, notation: 'standard', parens: false, currency: null };
    if (!column || !['Numeric', 'Int', 'Any'].includes(column.type)) return base;
    const o = parseWidgetOptions(column.widgetOptions);
    if (o.numSign === 'parens') base.parens = true;
    const hasMin = isIntegerOption(o.decimals);
    const hasMax = isIntegerOption(o.maxDecimals);
    const currencyCode = (typeof o.currency === 'string' && o.currency) || (docSettings && docSettings.currency) || null;
    if (o.numMode === 'currency' && currencyCode) {
      base.kind = 'currency';
      base.currency = currencyCode;
      // Sans réglage de décimales : celles de la devise (2 pour l'euro, 0 pour le yen), jamais l'Automatique.
      base.useAuto = false;
      if (hasMin || hasMax) {
        base.minFD = hasMin ? o.decimals : 0;
        base.maxFD = hasMax ? Math.max(o.maxDecimals, base.minFD) : Math.max(base.minFD, 2);
      } else {
        base.minFD = null; base.maxFD = null; // laissés à Intl
      }
    } else if (o.numMode === 'percent') {
      base.kind = 'percent';
      base.useAuto = !(hasMin || hasMax);
      base.minFD = hasMin ? o.decimals : 0;
      base.maxFD = hasMax ? Math.max(o.maxDecimals, base.minFD) : Math.max(base.minFD, 10);
    } else if (o.numMode === 'scientific') {
      base.kind = 'decimal';
      base.notation = 'scientific';
      base.useAuto = false;
      base.minFD = hasMin ? o.decimals : 0;
      base.maxFD = hasMax ? Math.max(o.maxDecimals, base.minFD) : Math.max(base.minFD, 3);
    } else if (hasMin || hasMax) {
      // `decimals` = minimum affiché, `maxDecimals` = plafond (10 par défaut dans Grist).
      base.useAuto = false;
      base.minFD = hasMin ? o.decimals : 0;
      base.maxFD = hasMax ? Math.max(o.maxDecimals, base.minFD) : Math.max(base.minFD, 10);
    }
    return base;
  }

  // --- Spécification de tuile -> style ----------------------------------------------------------

  function normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object' || !MODES.includes(spec.mode)) return { mode: 'auto' };
    if (spec.mode === 'custom') {
      const requestedDecimals = spec.decimals;
      const decimals = (Number.isInteger(requestedDecimals) && requestedDecimals >= 0 && requestedDecimals <= MAX_CUSTOM_DECIMALS) ? requestedDecimals : 'auto';
      return { mode: 'custom', decimals, notation: spec.notation === 'compact' ? 'compact' : 'standard' };
    }
    return { mode: spec.mode };
  }

  // ctx : { lang, column?: { type, widgetOptions }, docSettings?: { locale, currency } }
  function resolveStyle(spec, ctx) {
    const context = ctx || {};
    const s = normalizeSpec(spec);
    const uiLocale = localeForLang(context.lang);
    if (s.mode === 'column' && context.column) return styleFromColumn(context.column, context.docSettings, context.lang);
    if (s.mode === 'custom') {
      return {
        locale: uiLocale, kind: 'decimal', currency: null, parens: false,
        notation: s.notation, useAuto: s.decimals === 'auto',
        minFD: s.decimals === 'auto' ? 0 : s.decimals, maxFD: s.decimals === 'auto' ? 0 : s.decimals
      };
    }
    // `auto`, ou `column` sans colonne connue (mesure fusionnée par data blending, table non lue...)
    return { locale: uiLocale, kind: 'decimal', currency: null, parens: false, notation: 'standard', useAuto: true, minFD: 0, maxFD: 0, autoCompact: true };
  }

  // --- Formatage ---------------------------------------------------------------------------------

  function makeFormatter(style) {
    const st = style || resolveStyle(null, {});

    function formatPositive(a) {
      const n = cleanFloat(a);
      if (st.kind === 'percent') {
        const pct = n * 100;
        const opts = st.useAuto ? { style: 'percent', maximumFractionDigits: Math.abs(pct) >= 100 ? 0 : 1 }
          : { style: 'percent', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD };
        return intl(st.locale, opts).format(n);
      }
      if (st.kind === 'currency') {
        const opts = { style: 'currency', currency: st.currency };
        if (st.minFD != null) { opts.minimumFractionDigits = st.minFD; opts.maximumFractionDigits = st.maxFD; }
        if (st.notation === 'compact') opts.notation = 'compact';
        return intl(st.locale, opts).format(n);
      }
      if (st.notation === 'scientific') {
        return intl(st.locale, { notation: 'scientific', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
      }
      if (st.notation === 'compact') {
        // Compact : 3 chiffres significatifs, ou le nombre de décimales demandé quand il est fixé.
        const opts = st.useAuto ? { notation: 'compact', maximumSignificantDigits: 3 }
          : { notation: 'compact', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD };
        return intl(st.locale, opts).format(n);
      }
      if (st.useAuto) {
        if (st.autoCompact && n >= AUTO_COMPACT_FROM) return intl(st.locale, { notation: 'compact', maximumSignificantDigits: 3 }).format(n);
        return intl(st.locale, autoOptions(n)).format(n);
      }
      return intl(st.locale, { minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
    }

    // Valeur complète (KPI, infobulles, tableau croisé). `null`/NaN -> chaîne vide : l'appelant choisit son tiret.
    function format(v) {
      const n = toNumber(v);
      if (n == null) return '';
      if (n < 0) {
        const body = formatPositive(-n);
        // « -0 » après arrondi (-0,001 sur 0 décimale) : aucun chiffre non nul, le signe n'apporte rien.
        if (!/[1-9]/.test(body)) return body;
        return st.parens ? `(${body})` : `-${body}`;
      }
      return formatPositive(n);
    }

    // Libellé d'AXE : toujours compact, jamais deux graduations voisines identiques (« 0,1 » « 0,1 »).
    function axis(v) {
      const n = toNumber(v);
      if (n == null) return '';
      if (st.kind === 'percent') return intl(st.locale, { style: 'percent', maximumSignificantDigits: 3 }).format(cleanFloat(n));
      return intl(st.locale, { notation: 'compact', maximumSignificantDigits: 3 }).format(cleanFloat(n));
    }

    // Variation en % (déjà exprimée en pour cent : 1,5 signifie 1,5 %). Un décimal, séparateurs de la langue.
    function percent(v) {
      const n = toNumber(v);
      if (n == null) return '';
      return intl(st.locale, { style: 'percent', maximumFractionDigits: 1 }).format(cleanFloat(n) / 100);
    }

    // Libellés d'une ÉCHELLE connue de `lo` à `hi` (graduations d'une jauge, bornes de classes d'un histogramme) :
    // ceux de `axis`/`format`, sauf pour une échelle entière de moins de 5 chiffres (voir `plainScale`) dont les
    // entiers s'écrivent en toutes lettres, sans compact ni séparateur de milliers (une année n'est jamais « 2 010 »).
    // Un pourcentage, une devise ou des décimales choisies gardent leur format ; un non-entier garde `axis`.
    function forScale(lo, hi) {
      if (st.kind === 'percent' || !plainScale(lo, hi)) return { axis, format };
      const whole = (n) => intl(st.locale, { useGrouping: false, maximumFractionDigits: 0 }).format(n === 0 ? 0 : n);
      // `format` : Automatique seulement (des décimales choisies, une devise, des parenthèses restent telles quelles).
      const plainFormat = st.kind === 'decimal' && st.notation === 'standard' && st.useAuto && !st.parens;
      return {
        axis: (v) => { const n = toNumber(v); return n != null && Number.isInteger(n) ? whole(n) : axis(v); },
        format: (v) => {
          const n = toNumber(v);
          if (!plainFormat || n == null || Math.abs(n) < 1000) return format(v);
          return intl(st.locale, Object.assign({ useGrouping: false }, autoOptions(n))).format(cleanFloat(n));
        }
      };
    }

    return { format, axis, percent, forScale, style: st };
  }

  // --- Registre des colonnes de la table de travail ----------------------------------------------
  // Alimenté par js/main.js après lecture de `_grist_Tables_column` / `_grist_DocInfo` (voir
  // js/grist-api.js:readColumnFormats) ; vide tant qu'on ne les a pas lues (widget hors Grist, droits
  // insuffisants) — le mode « comme dans la colonne » retombe alors sur l'Automatique.
  let columnRegistry = {};
  let docSettingsRegistry = null;
  let registryVersion = 0;

  function setColumnInfo(columns, docSettings) {
    columnRegistry = (columns && typeof columns === 'object') ? columns : {};
    docSettingsRegistry = docSettings || null;
    registryVersion += 1;
  }
  function getColumnInfo(columnId) { return columnRegistry[columnId] || null; }

  // Ce que « Comme dans la colonne » donnerait pour `columnId` — sert à l'explication affichée sous le réglage :
  // 'count' (un comptage n'est la valeur d'aucune colonne), 'unknown' (colonne absente du registre : calculée,
  // fusionnée, lecture impossible, ou non numérique), 'none' (colonne connue mais sans décimales ni mode
  // monétaire/pourcentage/scientifique réglés : rendu Automatique), 'ok' (au moins un réglage repris).
  function columnModeState(tile, columnId) {
    if (tile && tile.aggFn === 'count') return 'count';
    const col = columnRegistry[columnId];
    if (!col || !['Numeric', 'Int', 'Any'].includes(col.type)) return 'unknown';
    const o = parseWidgetOptions(col.widgetOptions);
    const hasMode = typeof o.numMode === 'string' && o.numMode !== '' && o.numMode !== 'decimal';
    return (hasMode || isIntegerOption(o.decimals) || isIntegerOption(o.maxDecimals)) ? 'ok' : 'none';
  }
  function getDocSettings() { return docSettingsRegistry; }

  const formatterCache = new Map();
  let cachedVersion = -1;

  // Formateur pour la valeur d'une tuile : `columnId` est la colonne dont vient la valeur (la mesure, ou l'axe
  // d'un radar « colonnes »). Un comptage n'est la valeur d'AUCUNE colonne : jamais le format de la colonne.
  function forTile(tile, columnId, lang) {
    if (cachedVersion !== registryVersion) { formatterCache.clear(); cachedVersion = registryVersion; }
    const spec = normalizeSpec(tile && tile.numberFormat);
    const useColumn = spec.mode === 'column' && !(tile && tile.aggFn === 'count') && columnRegistry[columnId];
    const key = `${lang}|${JSON.stringify(spec)}|${useColumn ? columnId : ''}`;
    let cachedFormatter = formatterCache.get(key);
    if (!cachedFormatter) {
      cachedFormatter = makeFormatter(resolveStyle(spec, { lang, column: useColumn ? columnRegistry[columnId] : null, docSettings: docSettingsRegistry }));
      formatterCache.set(key, cachedFormatter);
    }
    return cachedFormatter;
  }

  // Texte d'un nombre dans une TABLE PLATE (tuile `table`) : la donnée telle quelle, pas un chiffre clé. Automatique =
  // les chiffres de la colonne, sans séparateur de milliers (une année reste « 2024 », un code « 75012 », jamais
  // « 2 024 » ni « 75 012 ») et sans bruit de flottant ; décimales à la virgule ou au point selon la langue. Un format
  // CHOISI (`custom`, ou `column` = celui de la colonne dans Grist) s'applique comme partout ailleurs.
  function cellNumber(tile, columnId, v, lang) {
    const n = toNumber(v);
    if (n == null) return '';
    const spec = normalizeSpec(tile && tile.numberFormat);
    if (spec.mode !== 'auto') {
      const formatted = forTile(tile, columnId, lang).format(n);
      if (formatted) return formatted;
    }
    return intl(localeForLang(lang), { useGrouping: false, maximumFractionDigits: 10 }).format(n === 0 ? 0 : cleanFloat(n));
  }

  // --- Échelle et géométrie de la jauge (pures : testées sous Node, ECharts n'y est pour rien) ------------

  // Plus petit « beau » nombre (1, 1,2, 1,5, 2, 2,5, 3, 4, 5, 6, 8 x 10^k) supérieur ou égal à `x` : borne haute d'une
  // jauge importée sans borne (le libellé de fin d'échelle est affiché, « 4 M » se lit, « 3 919 480 » non).
  const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  function niceCeil(x) {
    const v = toNumber(x);
    if (v == null || v <= 0) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / base;
    const step = NICE_STEPS.find((c) => c >= m - 1e-12) || 10;
    return Number((step * base).toPrecision(12));
  }

  // Jauge en demi-cercle dans une zone de w x h pixels : l'arc en haut, les deux bornes juste sous ses extrémités,
  // la valeur sous le moyeu de l'aiguille — chaque élément dans SA bande, donc rien ne se chevauche, quelle que soit la
  // taille de la tuile (avant : 270° d'arc, 5 graduations DANS l'arc, aiguille par-dessus, valeur qui débordait).
  //
  // `ticks` (facultatif) = les graduations intermédiaires, À L'EXTÉRIEUR de l'arc (un petit trait puis le libellé) :
  // `[{ frac, w10 }]`, `frac` = position entre 0 et 1 sur l'échelle, `w10` = largeur du libellé à 10 px. Elles
  // prennent leur place AVANT que l'arc ne soit dimensionné : le plus grand rayon pour lequel le libellé le plus haut
  // reste dans la zone en haut et le plus déporté reste dans la zone sur les côtés (recherche par dichotomie : les deux
  // conditions ne font que se durcir quand le rayon grandit). `overflow` = même au rayon minimum ça ne tient pas ; à
  // l'appelant de renoncer aux graduations plutôt que de les laisser sortir de la tuile.
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function gaugeLayout(w, h, ticks) {
    const PAD = 6;
    const fMax = clamp(0.17 * h, 14, 56);
    const below = 14 + 1.25 * fMax; // place sous l'axe : valeur (+ bornes, à côté)
    const rMax = Math.max(30, Math.min(w / 2 - 12, h - PAD - below));
    const list = Array.isArray(ticks) ? ticks : [];
    // Taille du trait, écart au libellé et place que prennent les libellés en haut et sur les côtés pour un rayon r.
    const outer = (r) => {
      const font = clamp(r * 0.1, 10, 13);
      const len = clamp(r * 0.05, 4, 8);
      const gap = 3;
      const off = 2 + len + gap; // du bord de l'arc au point d'ancrage du libellé
      const R = r + off;
      let top = 0;
      let side = 0;
      for (const t of list) {
        const tickAngle = Math.PI * (1 - t.frac);
        const cosine = Math.abs(Math.cos(tickAngle));
        const sn = Math.sin(tickAngle);
        const tw = t.w10 * font / 10;
        top = Math.max(top, R * sn + (sn > 0.6 ? 1.25 : 0.65) * font - r);
        side = Math.max(side, R * cosine + (cosine > 0.35 ? tw : tw / 2) - r);
      }
      return { top: Math.max(0, top), side: Math.max(0, side), font, len, gap, off };
    };
    const fits = (r) => { const o = outer(r); return r + o.top <= h - PAD - below && r + o.side <= w / 2 - 12; };
    let r = rMax;
    let overflow = false;
    if (list.length && !fits(rMax)) {
      if (!fits(30)) {
        r = 30;
        overflow = true;
      } else {
        let lo = 30;
        let hi = rMax;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid; else hi = mid;
        }
        r = lo;
      }
    }
    const o = outer(r);
    return {
      cx: w / 2,
      cy: PAD + (list.length ? o.top : 0) + r,
      r,
      ringW: clamp(r * 0.13, 8, 26),
      labelFont: clamp(r * 0.11, 10, 16),
      valueMaxFont: clamp(r * 0.27, 14, 56),
      valueMinFont: 11,
      valueMaxWidth: 1.4 * r,
      below,
      tick: { font: o.font, len: o.len, gap: o.gap, off: o.off },
      overflow
    };
  }

  // Graduations intermédiaires d'une jauge de `min` à `max` : des multiples d'un pas « rond » (1, 2, 2,5, 5 x 10^k),
  // au plus `maxCount`, jamais à moins de 8 % d'une extrémité (le libellé de la borne est juste en dessous, et l'arc
  // y est presque vertical). Le plus petit pas qui respecte `maxCount` : le plus de repères lisibles possible, des
  // valeurs qu'on lit (« 1 M, 2 M, 3 M ») plutôt que des quarts de l'échelle (« 825,5 k, 1,65 M »).
  const GAUGE_TICK_EDGE = 0.08;
  function gaugeTicks(min, max, maxCount) {
    const lo = toNumber(min);
    const hi = toNumber(max);
    const cap = Math.floor(maxCount);
    if (lo == null || hi == null || !(hi > lo) || !(cap >= 1)) return [];
    const range = hi - lo;
    const inside = (step) => {
      const out = [];
      for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
        const v = Number((k * step).toPrecision(12));
        const tickFraction = (v - lo) / range;
        if (tickFraction > GAUGE_TICK_EDGE && tickFraction < 1 - GAUGE_TICK_EDGE) out.push(v === 0 ? 0 : v);
        if (out.length > cap + 40) break; // pas bien trop fin : inutile de continuer à compter
      }
      return out;
    };
    let base = Math.pow(10, Math.floor(Math.log10(range / 20)));
    for (let i = 0; i < 40; i++, base *= 10) {
      for (const m of [1, 2, 2.5, 5]) {
        const found = inside(m * base);
        if (found.length <= cap) return found;
      }
    }
    return [];
  }

  // Où dessiner la graduation de position `frac` (0 à 1) d'une jauge de géométrie `L` (celle de gaugeLayout) : le trait
  // (x1,y1 -> x2,y2, juste au-delà de l'arc) puis le point d'ancrage du libellé et son alignement — vers l'extérieur :
  // à droite d'un repère de droite, à gauche d'un repère de gauche, au-dessus d'un repère du haut.
  function gaugeTickPlacement(L, frac) {
    const placeAngle = Math.PI * (1 - frac);
    const placeCosine = Math.cos(placeAngle);
    const sn = Math.sin(placeAngle);
    const r1 = L.r + 2;
    const r2 = r1 + L.tick.len;
    const rl = L.r + L.tick.off;
    return {
      x1: L.cx + r1 * placeCosine, y1: L.cy - r1 * sn,
      x2: L.cx + r2 * placeCosine, y2: L.cy - r2 * sn,
      x: L.cx + rl * placeCosine, y: L.cy - rl * sn,
      align: placeCosine > 0.35 ? 'left' : placeCosine < -0.35 ? 'right' : 'center',
      valign: sn > 0.6 ? 'bottom' : 'middle'
    };
  }

  // Nombre maximal de graduations pour un arc de rayon r (en pixels) : aucune sous 46 px (un arc minuscule n'a de
  // place que pour ses bornes), de plus en plus quand l'arc grandit, 5 au plus.
  function gaugeTickBudget(r) {
    return r >= 130 ? 5 : r >= 90 ? 4 : r >= 60 ? 3 : r >= 46 ? 1 : 0;
  }

  // Radar dans une zone de w x h pixels. Quand il y a une légende (deux séries : élève et moyenne du groupe), elle prend une bande
  // en haut ; le polygone se centre dans la place RESTANTE, et son rayon laisse de quoi écrire le nom de l'axe du haut sous la
  // légende et celui du bas au-dessus du bord (avant : centre à 50 % de la tuile, donc dans une tuile de 224 px la légende
  // recouvrait le nom de l'axe du haut). Le rayon ne dépasse jamais 62 % du demi-côté (la valeur historique, voir js/charts.js).
  // `gap` = écart entre le bout d'un axe et son nom, à poser sur `radar.axisNameGap`.
  const RADAR_LEGEND_H = 24;
  const RADAR_NAME_GAP = 8;
  const RADAR_NAME_H = 16;
  function radarLayout(w, h, hasLegend) {
    const legendH = hasLegend ? RADAR_LEGEND_H : 0;
    const availH = Math.max(0, h - legendH);
    const room = availH / 2 - RADAR_NAME_GAP - RADAR_NAME_H;
    const r = Math.max(20, Math.min(0.62 * Math.min(w, h) / 2, room));
    return { cx: w / 2, cy: legendH + availH / 2, r, gap: RADAR_NAME_GAP, nameH: RADAR_NAME_H, legendH };
  }

  // Place (px) dont dispose le nom du `index`-ième axe d'un radar de `count` axes dans une tuile de `w` x `h` : un nom d'axe ne doit jamais
  // sortir de la tuile. Les axes sont répartis dans le sens horaire, le 1er en haut ; le nom d'un axe du haut ou du bas est CENTRÉ sur son
  // sommet (il a presque toute la largeur), celui d'un axe de côté est posé À CÔTÉ du sommet, du côté du bord (il n'a que la place entre
  // le polygone et le bord : le sommet le plus à gauche ou à droite d'un polygone de 62 % de la tuile en laisse à peine plus du quart).
  // Ancienne règle (un tiers de la largeur, quelle que soit la place) : « Montre Connectée » sortait de la tuile à gauche, sa première
  // lettre coupée (retour sur les captures du forum, 18/11/2026). Sans légende le rayon est celui d'ECharts (62 % du demi-côté), l'écart
  // celui d'ECharts (15 px) ; avec une légende ce sont ceux de `radarLayout`.
  const RADAR_RADIUS_SHARE = 0.62;
  const RADAR_DEFAULT_NAME_GAP = 15;
  const RADAR_NAME_EDGE = 3;
  function radarNameRoom(w, h, hasLegend, index, count) {
    const n = Math.max(1, Math.floor(count) || 1);
    const i = Math.max(0, Math.floor(index) || 0);
    let r;
    let gap;
    if (hasLegend) { const L = radarLayout(w, h, true); r = L.r; gap = L.gap; }
    else { r = RADAR_RADIUS_SHARE * Math.min(w, h) / 2; gap = RADAR_DEFAULT_NAME_GAP; }
    const s = Math.abs(Math.sin((2 * Math.PI * i) / n));
    if (s < 0.1) return Math.max(24, Math.floor(w - 2 * RADAR_NAME_EDGE - 2 * r * s));
    return Math.max(24, Math.floor(w / 2 - s * (r + gap) - RADAR_NAME_EDGE));
  }

  // Plus grande taille de police (entre `minFont` et `maxFont`) qui tient en `maxWidth` pixels ; `measure(texte, taille)`
  // rend la largeur du texte (canvas dans le navigateur, estimation dans les tests).
  function fitFont(text, maxWidth, maxFont, minFont, measure) {
    let size = maxFont;
    const wide = measure(text, size);
    if (wide > maxWidth) size = Math.max(minFont, Math.floor((size * maxWidth) / wide));
    return size;
  }

  // Libellé d'une ligne de repère (moyenne, objectif) tracée HORIZONTALEMENT (barres verticales, courbe) : il va HORS de la zone de tracé,
  // à droite du trait, sur autant de lignes que `lines` (« Moyenne » puis « 816 559 »). À l'intérieur, au bout du trait, il se posait
  // sur la fin de la courbe et sur la dernière barre : avec son fond opaque il cachait justement les points les plus récents, ceux qu'on
  // compare à la moyenne. `reserve` = marge à laisser à droite de la grille (le libellé n'entre pas dans `containLabel`) ; `font` se réduit
  // (jusqu'à `REF_LABEL_MIN_FONT`) pour que la marge ne dépasse guère un cinquième de la tuile (22 %) ; si le texte reste trop large à la taille
  // minimale, `width` demande à ECharts de le tronquer plutôt que de le laisser sortir de la tuile. `measure(texte, taille)` rend la
  // largeur du texte (canvas dans le navigateur, estimation dans les tests).
  const REF_LABEL_FONT = 11;
  const REF_LABEL_MIN_FONT = 9;
  const REF_LABEL_PAD_X = 3; // marge intérieure gauche/droite du libellé (fond opaque)
  const REF_LABEL_GAP = 5; // écart entre le bout du trait et le libellé
  const REF_LABEL_EDGE = 2; // marge de sécurité contre le bord de la tuile
  const REF_LABEL_MAX_SHARE = 0.22;
  function refLabelLayout(lines, containerWidth, measure) {
    const list = (Array.isArray(lines) ? lines : [lines]).map((l) => String(l == null ? '' : l));
    const longest = list.reduce((a, b) => (measure(b, REF_LABEL_FONT) > measure(a, REF_LABEL_FONT) ? b : a), '');
    const maxText = Math.max(30, Math.floor((containerWidth || 0) * REF_LABEL_MAX_SHARE) - 2 * REF_LABEL_PAD_X - REF_LABEL_GAP - REF_LABEL_EDGE);
    const font = fitFont(longest, maxText, REF_LABEL_FONT, REF_LABEL_MIN_FONT, measure);
    const wide = Math.ceil(list.reduce((m, l) => Math.max(m, measure(l, font)), 0));
    const truncated = wide > maxText;
    const textW = truncated ? maxText : wide;
    return {
      font,
      width: truncated ? maxText : null,
      reserve: textW + 2 * REF_LABEL_PAD_X + REF_LABEL_GAP + REF_LABEL_EDGE,
      text: list.join('\n')
    };
  }

  return {
    niceCeil, plainScale, refLabelLayout, gaugeLayout, gaugeTicks, gaugeTickBudget, gaugeTickPlacement, radarLayout, radarNameRoom, fitFont, cellNumber,
    MODES, MAX_CUSTOM_DECIMALS, localeForLang, normalizeSpec, parseWidgetOptions, parseDocSettings,
    styleFromColumn, resolveStyle, makeFormatter, forTile, setColumnInfo, getColumnInfo, getDocSettings, columnModeState
  };
});
