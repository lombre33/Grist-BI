/*
 * Style global des tuiles (demande d'Antoine, 18/11/2026) : UN réglage au niveau du TABLEAU DE BORD, enregistré dans sa
 * configuration (`BI_Dashboard_Config`, champ `style`), qui change l'apparence de TOUTES les tuiles d'un coup — cartes (CSS)
 * ET graphiques (options ECharts). Cinq entrées : `standard` (le rendu d'origine, jamais modifié, c'est le défaut) puis quatre
 * directions artistiques : `factory` (la charte Grist Factory), `fluid` (fluide/moderne), `dense` (classique façon Power BI) et
 * `editorial` (sobre, façon rapport imprimé).
 *
 * Pur JS, testable sous Node (UMD), sans dépendance : trois choses seulement.
 *  1. Le REGISTRE (`STYLES`) : id, clés i18n du nom et de la description, et `chart` = les réglages que la passe sur les options
 *     ECharts sait lire (rayon des barres, valeurs au bout des barres, quadrillage, tracé des courbes...). `chart: null` = rien.
 *  2. `applyToOption(option, style, th)` : la passe qui s'ajoute à `js/charts.js:finalizeOption` et retouche l'option ECharts d'une
 *     tuile APRÈS tous les réglages du rendu — jamais avant, jamais dans chaque fonction de rendu (un nouveau type de tuile en profite
 *     sans rien écrire). Elle ne touche ni aux données, ni aux formats de nombres (elle réutilise le formateur d'axe de la tuile), ni
 *     à la palette : la palette reste celle que la tuile a choisie (`tile.palette`), le style ne fait que la TRANSFORMER (teinte pastel
 *     d'une couleur unique, bord des parts).
 *  3. `apply(id)` : pose `data-dash-style` sur `<html>` (aucun attribut pour `standard`) ; `css/dash-styles.css` lit cet attribut.
 *
 * Les COULEURS et la géométrie des cartes vivent dans `css/dash-styles.css` (jetons `--dash-*` + les jetons de couleur de la
 * charte), pas ici : les graphiques lisent les mêmes jetons par `chartTheme()` (js/charts.js), donc cartes et graphiques ne peuvent
 * pas diverger. Une ambiance de GFS (jetons posés EN LIGNE sur `<html>`) l'emporte sur les couleurs du style, comme sur celles du
 * rendu standard : le style garde alors sa géométrie (rayons, ombres, densité) et son traitement des graphiques.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.styles = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_STYLE = 'standard';

  // Réglages `chart` (tous facultatifs ; absent = on ne touche pas à ce point) :
  //  barRadius        rayon (px) des extrémités des barres, sauf barres empilées/cascade (un trait arrondi au milieu d'une pile se lit mal)
  //  barPill          barres horizontales arrondies aux DEUX bouts (pilule) ; verticales : seul le haut
  //  barMaxWidth      épaisseur maximale d'une barre (px)
  //  barGap           écart entre catégories (`barCategoryGap`), sauf si le rendu en a déjà posé un (histogramme : classes contiguës)
  //  barLabels        la valeur au bout de chaque barre, quand il n'y a qu'une série, pas de ligne de repère et pas plus de `barLabelsMax` barres ; l'axe des
  //                   valeurs, devenu redondant, est alors masqué
  //  soft             { amount, toward, darkToward?, darkAmount? } : une couleur UNIQUE (barres d'une seule série) est mélangée à `surface`
  //                   ou `text` (sur carte sombre : `darkToward`/`darkAmount`, voir softColor) ; la couleur pleine revient au survol
  //  grid             quadrillage de l'axe des valeurs : 'solid' | 'dashed' | 'none'
  //  axisLine         { category, value } : trait d'axe affiché ou non
  //  axisTick         graduations (petits traits) de l'axe des catégories
  //  labelSize        taille (px) des libellés d'axe
  //  lineWidth        épaisseur des courbes (JAMAIS leur forme : lissé/escalier est un choix de la tuile, `tile.lineShape`, et un lissage dessine
  //                   des valeurs qui n'existent pas) ; symbol/symbolSize repère de chaque point (jamais masqué : un
  //                   point cliquable sert au filtre croisé et au drill-down) ; symbolRing anneau de la couleur de la carte autour
  //  areaOpacity      opacité d'une aire non empilée
  //  sliceGap         trait (px) de la couleur de la carte entre les parts d'un camembert, d'un entonnoir ou d'une carte proportionnelle
  //  sliceRadius      rayon (px) des coins des parts (camembert, carte proportionnelle)
  //  legendIcon       forme du repère de légende
  //  tooltipRadius    rayon (px) des coins de l'infobulle
  const STYLES = {
    standard: { id: 'standard', chart: null },
    factory: {
      id: 'factory',
      chart: {
        barRadius: 4, barMaxWidth: 44, grid: 'solid',
        axisLine: { category: true, value: false }, axisTick: false,
        lineWidth: 2.4, symbol: 'circle', symbolSize: 7,
        sliceGap: 2, sliceRadius: 4, legendIcon: 'roundRect', tooltipRadius: 8
      }
    },
    fluid: {
      id: 'fluid',
      chart: {
        barRadius: 8, barPill: true, barMaxWidth: 46, barGap: '42%',
        barLabels: true, barLabelsMax: 14,
        soft: { amount: 0.5, toward: 'surface', darkToward: 'text', darkAmount: 0.3 },
        grid: 'none', axisLine: { category: false, value: false }, axisTick: false, labelSize: 11,
        lineWidth: 3, symbol: 'circle', symbolSize: 8, symbolRing: 2, areaOpacity: 0.16,
        sliceGap: 3, sliceRadius: 5, legendIcon: 'circle', tooltipRadius: 12
      }
    },
    dense: {
      id: 'dense',
      chart: {
        barMaxWidth: 60, barGap: '30%', grid: 'solid',
        axisLine: { category: true, value: true }, axisTick: true, labelSize: 10.5,
        lineWidth: 1.8, symbol: 'circle', symbolSize: 5,
        sliceGap: 1, legendIcon: 'rect', tooltipRadius: 2
      }
    },
    editorial: {
      id: 'editorial',
      chart: {
        barMaxWidth: 20, barGap: '55%',
        soft: { amount: 0.3, toward: 'text' },
        grid: 'dashed', axisLine: { category: true, value: false }, axisTick: false,
        lineWidth: 1.6, symbol: 'circle', symbolSize: 5, areaOpacity: 0.12,
        sliceGap: 2, legendIcon: 'rect', tooltipRadius: 0
      }
    }
  };
  const STYLE_IDS = Object.keys(STYLES);
  STYLE_IDS.forEach((id) => { STYLES[id].nameKey = `style.${id}.name`; STYLES[id].descKey = `style.${id}.desc`; });

  function isKnown(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(STYLES, id); }
  // Un id inconnu (configuration d'une version future, ligne éditée à la main) s'affiche en Standard : jamais de tuile sans style.
  function normalizeStyleId(id) { return isKnown(id) ? id : DEFAULT_STYLE; }
  function get(id) { return STYLES[normalizeStyleId(id)]; }
  // Valeur à ÉCRIRE dans la configuration : rien pour le Standard (une configuration d'avant ce réglage reste identique octet pour octet).
  function configValue(id) { return isKnown(id) && id !== DEFAULT_STYLE ? id : undefined; }

  let currentStyleId = DEFAULT_STYLE;
  function current() { return STYLES[currentStyleId]; }
  function currentId() { return currentStyleId; }

  // Pose le style sur la page : `data-dash-style` sur <html> (rien pour Standard, donc aucune règle de css/dash-styles.css ne
  // s'applique). Rend vrai si le style a changé. Sans document (Node), ne tient que le style courant.
  function apply(id) {
    const next = normalizeStyleId(id);
    const changed = next !== currentStyleId;
    currentStyleId = next;
    if (typeof document !== 'undefined' && document.documentElement) {
      const el = document.documentElement;
      if (next === DEFAULT_STYLE) { if (el.hasAttribute('data-dash-style')) el.removeAttribute('data-dash-style'); }
      else if (el.getAttribute('data-dash-style') !== next) el.setAttribute('data-dash-style', next);
    }
    return changed;
  }

  // --- Couleurs : mélange de deux couleurs (teinte pastel d'une couleur unique) ---------------------------------------------
  // Lit `#rgb`, `#rrggbb` et `rgb()/rgba()` ; tout le reste (var(), color-mix(), nom) -> null et la couleur d'origine est gardée.
  function parseColor(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(s);
    if (m) return [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
    return null;
  }
  function toHex(rgb) { return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`; }
  // `amount` (0..1) de `toward` mélangé à `color`. 0 -> `color`, 1 -> `toward`.
  function mixColors(color, toward, amount) {
    const a = parseColor(color);
    const b = parseColor(toward);
    if (!a || !b) return color;
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    return toHex(a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)));
  }
  // Luminance relative (0 noir .. 1 blanc) d'une couleur lisible par `parseColor` ; null sinon.
  function luminance(input) {
    const rgb = parseColor(input);
    if (!rgb) return null;
    const lin = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  // Teinte douce d'une couleur UNIQUE. Une teinte « vers la couleur de la carte » donne un pastel sur une carte claire mais, sur une
  // carte SOMBRE, une barre qui disparaît dans le fond (une palette qui commence par un bleu marine y devenait invisible) : sur fond
  // sombre `soft.darkToward`/`soft.darkAmount` éclaircissent la couleur au lieu de l'assombrir.
  function softColor(color, soft, th) {
    if (!soft || !th) return color;
    const lum = luminance(th.surface);
    const dark = lum !== null && lum < 0.2;
    const toward = (dark ? (soft.darkToward || soft.toward) : soft.toward) === 'text' ? th.text : th.surface;
    return mixColors(color, toward, dark && soft.darkAmount != null ? soft.darkAmount : soft.amount);
  }

  // --- La passe sur l'option ECharts -----------------------------------------------------------------------------------------
  function seriesList(option) {
    if (Array.isArray(option.series)) return option.series;
    return option.series ? [option.series] : [];
  }
  function isHorizontal(option) {
    const y = option.yAxis;
    return !!y && !Array.isArray(y) && y.type === 'category';
  }
  function categoryAxis(option) {
    const pick = (a) => (a && !Array.isArray(a) && a.type === 'category' ? a : null);
    return pick(option.xAxis) || pick(option.yAxis);
  }
  function valueAxis(option) {
    const pick = (a) => (a && !Array.isArray(a) && a.type === 'value' ? a : null);
    return isHorizontal(option) ? pick(option.xAxis) : pick(option.yAxis);
  }

  function styleBars(option, c, th, state) {
    const bars = seriesList(option).filter((s) => s && s.type === 'bar');
    if (!bars.length) return;
    const horizontal = isHorizontal(option);
    const stacked = bars.some((s) => s.stack);
    const alone = bars.length === seriesList(option).length && bars.length === 1 && !stacked; // une seule série, rien d'autre sur le graphique
    const base = Array.isArray(option.color) ? option.color[0] : null;
    const cat = categoryAxis(option);
    const count = cat && Array.isArray(cat.data) ? cat.data.length : 0;
    const contiguous = bars.some((s) => s.barCategoryGap != null); // histogramme : le rendu a décidé de l'écart
    // Une ligne de repère (moyenne, objectif) se lit CONTRE l'axe des valeurs et son libellé recouvre les valeurs du bout des barres :
    // le style n'écrit alors pas de valeurs et laisse l'axe (celles que la tuile a réglées elle-même, `tile.valueLabels`, restent).
    const hasRef = seriesList(option).some((s) => s && s.markLine);
    const labels = !!c.barLabels && alone && !contiguous && !hasRef && count > 0 && count <= (c.barLabelsMax || 12);
    const valAx = valueAxis(option);
    const fmt = valAx && valAx.axisLabel && typeof valAx.axisLabel.formatter === 'function' ? valAx.axisLabel.formatter : null;

    bars.forEach((sr) => {
      const itemStyle = Object.assign({}, sr.itemStyle);
      if (c.barRadius && !sr.stack) {
        const r = c.barRadius;
        itemStyle.borderRadius = horizontal ? (c.barPill ? [r, r, r, r] : [0, r, r, 0]) : [r, r, 0, 0];
      }
      if (alone && c.soft && base && !itemStyle.color) {
        itemStyle.color = softColor(base, c.soft, th);
        sr.emphasis = Object.assign({}, sr.emphasis, { itemStyle: Object.assign({ color: base }, sr.emphasis && sr.emphasis.itemStyle) });
      }
      sr.itemStyle = itemStyle;
      if (c.barMaxWidth && sr.barMaxWidth == null) sr.barMaxWidth = c.barMaxWidth;
      if (c.barGap && sr.barCategoryGap == null) sr.barCategoryGap = c.barGap;
      if (labels) {
        sr.label = Object.assign({
          show: true,
          position: horizontal ? 'right' : 'top',
          color: th.text,
          fontSize: 11,
          fontWeight: 600,
          formatter: (p) => {
            const v = p && p.value;
            if (v === null || v === undefined || v === '') return '';
            return fmt ? fmt(v) : String(v);
          }
        }, sr.label);
        sr.labelLayout = Object.assign({ hideOverlap: true }, sr.labelLayout);
      }
    });
    if (labels) {
      state.valueLabels = true;
      // Les libellés de série ne comptent pas dans `containLabel` : on laisse de la place au bout des barres.
      if (horizontal) option.grid = Object.assign({}, option.grid, { right: Math.max((option.grid && option.grid.right) || 0, 56) });
      else option.grid = Object.assign({}, option.grid, { top: Math.max((option.grid && option.grid.top) || 0, 28) });
    }
  }

  function styleLines(option, c, th) {
    seriesList(option).forEach((sr) => {
      if (!sr || sr.type !== 'line') return;
      if (c.lineWidth) sr.lineStyle = Object.assign({ width: c.lineWidth }, sr.lineStyle);
      if (c.symbol) sr.symbol = c.symbol;
      if (c.symbolSize) sr.symbolSize = c.symbolSize;
      if (c.symbolRing && th.surface) sr.itemStyle = Object.assign({ borderColor: th.surface, borderWidth: c.symbolRing }, sr.itemStyle);
      if (c.areaOpacity != null && sr.areaStyle && !sr.stack) sr.areaStyle = Object.assign({}, sr.areaStyle, { opacity: c.areaOpacity });
    });
  }

  function styleSlices(option, c, th) {
    seriesList(option).forEach((sr, i, list) => {
      if (!sr || !(sr.type === 'pie' || sr.type === 'funnel' || sr.type === 'treemap')) return;
      const extra = {};
      if (c.sliceGap && th.surface) {
        extra.borderColor = th.surface;
        if (sr.type === 'treemap') extra.gapWidth = c.sliceGap; else extra.borderWidth = c.sliceGap;
      }
      if (c.sliceRadius && sr.type !== 'funnel') extra.borderRadius = c.sliceRadius;
      if (Object.keys(extra).length) list[i] = Object.assign({}, sr, { itemStyle: Object.assign({}, sr.itemStyle, extra) });
    });
  }

  function styleAxes(option, c, state) {
    const restyle = (axis) => {
      if (!axis || typeof axis !== 'object') return axis;
      const out = Object.assign({}, axis);
      const isCategory = axis.type === 'category';
      const isValue = axis.type === 'value';
      if (c.axisLine && (isCategory || isValue)) out.axisLine = Object.assign({}, out.axisLine, { show: isCategory ? !!c.axisLine.category : !!c.axisLine.value });
      if (c.axisTick != null && isCategory) out.axisTick = Object.assign({}, out.axisTick, { show: !!c.axisTick });
      if (c.labelSize) out.axisLabel = Object.assign({}, out.axisLabel, { fontSize: c.labelSize });
      if (isValue && c.grid) {
        // Un quadrillage que le rendu a lui-même masqué (axe de droite du combo) le reste.
        const hiddenByRender = axis.splitLine && axis.splitLine.show === false;
        if (!hiddenByRender) {
          if (c.grid === 'none') out.splitLine = Object.assign({}, out.splitLine, { show: false });
          else out.splitLine = Object.assign({}, out.splitLine, { show: true, lineStyle: Object.assign({}, out.splitLine && out.splitLine.lineStyle, { type: c.grid === 'dashed' ? 'dashed' : 'solid' }) });
        }
      }
      if (isValue && state.valueLabels) {
        // Les valeurs sont écrites au bout des barres : l'axe des valeurs n'apporte plus rien.
        out.axisLabel = Object.assign({}, out.axisLabel, { show: false });
        out.axisLine = Object.assign({}, out.axisLine, { show: false });
        out.axisTick = Object.assign({}, out.axisTick, { show: false });
      }
      return out;
    };
    ['xAxis', 'yAxis'].forEach((key) => {
      const ax = option[key];
      if (!ax) return;
      option[key] = Array.isArray(ax) ? ax.map(restyle) : restyle(ax);
    });
  }

  // Retouche `option` (ECharts) selon `style` et rend la même option. `th` : les couleurs de la page lues par js/charts.js:chartTheme
  // ({ text, surface, ... }). Sans réglage `chart` (Standard) : option rendue telle quelle, pas une copie, pas une propriété touchée.
  function applyToOption(option, style, th) {
    const c = style && style.chart;
    if (!option || !c) return option;
    const theme = th || {};
    const state = { valueLabels: false };
    styleBars(option, c, theme, state); // d'abord : décide si l'axe des valeurs disparaît
    styleLines(option, c, theme);
    styleSlices(option, c, theme);
    styleAxes(option, c, state);
    if (option.legend && c.legendIcon) option.legend = Object.assign({ icon: c.legendIcon, itemWidth: 10, itemHeight: 10 }, option.legend);
    if (option.tooltip && c.tooltipRadius != null) {
      const css = typeof option.tooltip.extraCssText === 'string' ? option.tooltip.extraCssText.trim() : '';
      const sep = css && !css.endsWith(';') ? ';' : '';
      option.tooltip = Object.assign({}, option.tooltip, { extraCssText: `${css}${sep} border-radius: ${c.tooltipRadius}px;`.trim() });
    }
    return option;
  }

  return {
    DEFAULT_STYLE, STYLES, STYLE_IDS, isKnown, normalizeStyleId, get, configValue,
    current, currentId, apply,
    parseColor, luminance, mixColors, softColor, applyToOption
  };
});
