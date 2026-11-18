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
    let f = intlCache.get(key);
    if (!f) { f = new Intl.NumberFormat(locale, options); intlCache.set(key, f); }
    return f;
  }

  // Règle d'Automatique, par magnitude de la valeur (voir l'en-tête).
  function autoOptions(n) {
    const a = Math.abs(n);
    if (a === 0 || a >= 1000) return { maximumFractionDigits: 0 };
    if (a >= 100) return { maximumFractionDigits: 1 };
    if (a >= 0.1) return { maximumFractionDigits: 2 };
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
      const d = spec.decimals;
      const decimals = (Number.isInteger(d) && d >= 0 && d <= MAX_CUSTOM_DECIMALS) ? d : 'auto';
      return { mode: 'custom', decimals, notation: spec.notation === 'compact' ? 'compact' : 'standard' };
    }
    return { mode: spec.mode };
  }

  // ctx : { lang, column?: { type, widgetOptions }, docSettings?: { locale, currency } }
  function resolveStyle(spec, ctx) {
    const c = ctx || {};
    const s = normalizeSpec(spec);
    const uiLocale = localeForLang(c.lang);
    if (s.mode === 'column' && c.column) return styleFromColumn(c.column, c.docSettings, c.lang);
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

    return { format, axis, percent, style: st };
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
    let f = formatterCache.get(key);
    if (!f) {
      f = makeFormatter(resolveStyle(spec, { lang, column: useColumn ? columnRegistry[columnId] : null, docSettings: docSettingsRegistry }));
      formatterCache.set(key, f);
    }
    return f;
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
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function gaugeLayout(w, h) {
    const PAD = 6;
    const fMax = clamp(0.17 * h, 14, 56);
    const below = 14 + 1.25 * fMax; // place sous l'axe : valeur (+ bornes, à côté)
    const r = Math.max(30, Math.min(w / 2 - 12, h - PAD - below));
    return {
      cx: w / 2,
      cy: PAD + r,
      r,
      ringW: clamp(r * 0.13, 8, 26),
      labelFont: clamp(r * 0.11, 10, 16),
      valueMaxFont: clamp(r * 0.27, 14, 56),
      valueMinFont: 11,
      valueMaxWidth: 1.4 * r,
      below
    };
  }

  // Plus grande taille de police (entre `minFont` et `maxFont`) qui tient en `maxWidth` pixels ; `measure(texte, taille)`
  // rend la largeur du texte (canvas dans le navigateur, estimation dans les tests).
  function fitFont(text, maxWidth, maxFont, minFont, measure) {
    let size = maxFont;
    const wide = measure(text, size);
    if (wide > maxWidth) size = Math.max(minFont, Math.floor((size * maxWidth) / wide));
    return size;
  }

  return {
    niceCeil, gaugeLayout, fitFont,
    MODES, MAX_CUSTOM_DECIMALS, localeForLang, normalizeSpec, parseWidgetOptions, parseDocSettings,
    styleFromColumn, resolveStyle, makeFormatter, forTile, setColumnInfo, getColumnInfo, getDocSettings, columnModeState
  };
});
