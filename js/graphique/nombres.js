// Le format des nombres d'un graphique : valeur complète (infobulle, étiquette), libellé d'axe compact et variation en %. Même règles que `js/format.js` de Grist BI, que l'essai compare valeur par valeur ;
// la différence est la source des réglages d'une colonne : ici elle vient de `source.colonnes[].format` et de `source.reglages` (que l'hôte lit dans Grist), jamais d'un registre global.
// Trois modes, comme `numberFormat` de la définition : `auto` (les séparateurs de la LANGUE de l'hôte, peu de chiffres significatifs), `custom` (décimales fixes, compact ou non) et `column`
// (« comme dans la colonne » : `numMode`, `currency`, `decimals`, `maxDecimals`, `numSign`). Sans réglage de colonne ou sans colonne connue, `column` rend l'Automatique.
const LOCALES = { fr: 'fr-FR', en: 'en-US' };
const COMPACT_A_PARTIR_DE = 1e12;
const GENRES_NOMBRE = ['number', 'any'];
const cache = new Map();

function intl(locale, options) {
  const cle = `${locale}|${JSON.stringify(options)}`;
  if (!cache.has(cle)) cache.set(cle, new Intl.NumberFormat(locale, options));
  return cache.get(cle);
}

// Un nombre fini, ou `null` : une cellule vide, un texte ou un NaN n'est jamais lu comme 0.
function nombre(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

// Une somme de flottants traîne du bruit (« 1542980.8799999997 ») : 14 chiffres significatifs restent sous la précision d'un double.
const propre = (n) => (Number.isInteger(n) ? n : Number(n.toPrecision(14)));

// Une locale que le navigateur ne sait pas formater ne doit jamais faire lever le dessin : retour à la langue de l'hôte.
function localeUtilisable(locale, repli) {
  if (typeof locale !== 'string' || !locale) return repli;
  try { return new Intl.NumberFormat(locale).resolvedOptions().locale; } catch (erreur) { return repli; }
}

const entierOption = (v) => Number.isInteger(v) && v >= 0 && v <= 20;

// L'Automatique, par magnitude : entiers dès 1 000, une décimale de 100 à 1 000, deux de 0,1 à 100, puis deux chiffres significatifs.
function optionsAuto(n) {
  const grandeur = Math.abs(n);
  if (grandeur === 0 || grandeur >= 1000) return { maximumFractionDigits: 0 };
  if (grandeur >= 100) return { maximumFractionDigits: 1 };
  if (grandeur >= 0.1) return { maximumFractionDigits: 2 };
  return { maximumSignificantDigits: 2 };
}

const STYLE_AUTO = { kind: 'decimal', useAuto: true, autoCompact: true, minFD: 0, maxFD: 0, notation: 'standard', parens: false, currency: null };

// Les réglages d'une colonne -> un style prêt à formater. `decimals` n'est qu'un MINIMUM et `maxDecimals` vaut 10 par défaut dans Grist : une colonne sans aucun réglage de décimales rend l'Automatique.
function styleDeColonne(colonne, reglages, locale) {
  const base = { ...STYLE_AUTO, locale };
  if (!colonne || !GENRES_NOMBRE.includes(colonne.genre)) return base;
  const o = colonne.format && typeof colonne.format === 'object' ? colonne.format : {};
  if (o.numSign === 'parens') base.parens = true;
  const aMin = entierOption(o.decimals);
  const aMax = entierOption(o.maxDecimals);
  const min = aMin ? o.decimals : 0;
  const code = (typeof o.currency === 'string' && o.currency) || (reglages && reglages.currency) || null;
  if (o.numMode === 'currency' && code) {
    Object.assign(base, { kind: 'currency', currency: code, useAuto: false, minFD: null, maxFD: null });
    if (aMin || aMax) { base.minFD = min; base.maxFD = aMax ? Math.max(o.maxDecimals, min) : Math.max(min, 2); }
  } else if (o.numMode === 'percent') {
    Object.assign(base, { kind: 'percent', useAuto: !(aMin || aMax), minFD: min, maxFD: aMax ? Math.max(o.maxDecimals, min) : Math.max(min, 10) });
  } else if (o.numMode === 'scientific') {
    Object.assign(base, { notation: 'scientific', useAuto: false, minFD: min, maxFD: aMax ? Math.max(o.maxDecimals, min) : Math.max(min, 3) });
  } else if (aMin || aMax) {
    Object.assign(base, { useAuto: false, minFD: min, maxFD: aMax ? Math.max(o.maxDecimals, min) : Math.max(min, 10) });
  }
  return base;
}

// Le réglage de la définition, ramené à une forme sûre : un mode inconnu est l'Automatique.
function normaliser(spec) {
  if (!spec || typeof spec !== 'object' || !['auto', 'custom', 'column'].includes(spec.mode)) return { mode: 'auto' };
  if (spec.mode !== 'custom') return { mode: spec.mode };
  const decimales = Number.isInteger(spec.decimals) && spec.decimals >= 0 && spec.decimals <= 6 ? spec.decimals : 'auto';
  return { mode: 'custom', decimals: decimales, notation: spec.notation === 'compact' ? 'compact' : 'standard' };
}

function resoudre(spec, langue, colonne, reglages) {
  const locale = LOCALES[langue] || LOCALES.fr;
  if (spec.mode === 'column' && colonne) return styleDeColonne(colonne, reglages, localeUtilisable(reglages && reglages.locale, locale));
  if (spec.mode === 'custom') {
    const auto = spec.decimals === 'auto';
    return { locale, kind: 'decimal', currency: null, parens: false, notation: spec.notation, useAuto: auto, minFD: auto ? 0 : spec.decimals, maxFD: auto ? 0 : spec.decimals };
  }
  return { ...STYLE_AUTO, locale };
}

// Le texte d'un nombre positif selon le style.
function formaterPositif(st, a) {
  const n = propre(a);
  if (st.kind === 'percent') {
    const pct = n * 100;
    return intl(st.locale, st.useAuto ? { style: 'percent', maximumFractionDigits: Math.abs(pct) >= 100 ? 0 : 1 } : { style: 'percent', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
  }
  if (st.kind === 'currency') {
    const options = { style: 'currency', currency: st.currency };
    if (st.minFD != null) { options.minimumFractionDigits = st.minFD; options.maximumFractionDigits = st.maxFD; }
    if (st.notation === 'compact') options.notation = 'compact';
    return intl(st.locale, options).format(n);
  }
  if (st.notation === 'scientific') return intl(st.locale, { notation: 'scientific', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
  if (st.notation === 'compact') {
    return intl(st.locale, st.useAuto ? { notation: 'compact', maximumSignificantDigits: 3 } : { notation: 'compact', minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
  }
  if (st.useAuto) {
    if (st.autoCompact && n >= COMPACT_A_PARTIR_DE) return intl(st.locale, { notation: 'compact', maximumSignificantDigits: 3 }).format(n);
    return intl(st.locale, optionsAuto(n)).format(n);
  }
  return intl(st.locale, { minimumFractionDigits: st.minFD, maximumFractionDigits: st.maxFD }).format(n);
}

// Les trois formateurs d'un style. `format` : la valeur complète (`''` sans valeur : l'appelant choisit son tiret) ; `axis` : compact, 3 chiffres significatifs, jamais deux graduations voisines
// identiques ; `percent` : une variation DÉJÀ en pour cent (1,5 veut dire 1,5 %).
export function creerFormateur(st) {
  const format = (valeur) => {
    const n = nombre(valeur);
    if (n === null) return '';
    if (n >= 0) return formaterPositif(st, n);
    const corps = formaterPositif(st, -n);
    // « -0 » après arrondi : aucun chiffre non nul, le signe n'apporte rien.
    if (!/[1-9]/.test(corps)) return corps;
    return st.parens ? `(${corps})` : `-${corps}`;
  };
  const axis = (valeur) => {
    const n = nombre(valeur);
    if (n === null) return '';
    const options = st.kind === 'percent' ? { style: 'percent', maximumSignificantDigits: 3 } : { notation: 'compact', maximumSignificantDigits: 3 };
    return intl(st.locale, options).format(propre(n));
  };
  const percent = (valeur) => {
    const n = nombre(valeur);
    return n === null ? '' : intl(st.locale, { style: 'percent', maximumFractionDigits: 1 }).format(propre(n) / 100);
  };
  return { format, axis, percent, style: st };
}

// Le formateur de la valeur d'une colonne (`colonneId`) pour une définition : un comptage n'est la valeur d'AUCUNE colonne, il n'a jamais le format de celle-ci.
export function formateurDe(definition, colonneId, source, langue) {
  const spec = normaliser(definition && definition.numberFormat);
  const colonnes = (source && source.colonnes) || [];
  const colonne = spec.mode === 'column' && !(definition && definition.aggFn === 'count') ? colonnes.find((c) => c.id === colonneId) : null;
  return creerFormateur(resoudre(spec, langue, colonne, source && source.reglages));
}

// Le format que Word, PowerPoint et Excel écrivent pour ce style, ou `undefined` quand il n'a pas d'équivalent (Automatique, compact, scientifique : l'hôte garde alors le sien). Jamais tronqué.
export function formatOffice(st) {
  if (!st || st.useAuto || st.notation !== 'standard') return undefined;
  const min = st.minFD == null ? 2 : st.minFD;
  const max = st.maxFD == null ? 2 : Math.min(st.maxFD, 10);
  const decimales = max > 0 ? `.${'0'.repeat(min)}${'#'.repeat(Math.max(0, max - min))}` : '';
  if (st.kind === 'percent') return `0${decimales}%`;
  const corps = `#,##0${decimales}`;
  const avecDevise = st.kind === 'currency' ? `${corps} "${st.currency}"` : corps;
  return st.parens ? `${avecDevise};(${avecDevise})` : avecDevise;
}
