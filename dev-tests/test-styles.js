/*
 * Style global des tuiles (js/styles.js, css/dash-styles.css) — logique pure, sans navigateur :
 *
 *   node dev-tests/test-styles.js
 *
 * Ce que ça garde, et qu'un essai à l'écran ne voit pas toujours :
 *  - le registre (ids, clés i18n fr/en), les ids inconnus ou hostiles qui retombent sur Standard ;
 *  - la passe sur les options ECharts (`applyToOption`) : Standard intact, barres/courbes/parts/axes de chaque style, ce qu'elle
 *    NE touche PAS (palette choisie, couleur posée par le rendu, écart d'un histogramme, quadrillage masqué du combo) ;
 *  - la teinte douce d'une couleur unique, y compris sur carte sombre (une palette qui commence par un bleu marine y disparaissait) ;
 *  - les dégradés de `console` et `glass` (barres, aire, halo des courbes) : couleur de la série, jamais sur une pile, jamais sur une
 *    couleur illisible, éclaircie sur carte sombre (une palette qui commence par un bleu marine y disparaîtrait) ;
 *  - le CSS : chaque style pose la liste COMPLÈTE de ses jetons dans un bloc clair ET un bloc sombre (un jeton oublié en sombre
 *    resterait clair : `:root[data-dash-style]` bat `:root`) — sauf `console`, toujours sombre : UN bloc, qui reprend aussi les jetons
 *    que css/style.css ne pose que sous `prefers-color-scheme: dark` ; contrastes AA des textes (le verre : contre sa pire carte
 *    translucide), pastille « Standard » = le rendu de css/style.css, aucun `backdrop-filter` sur la barre collante ;
 *  - les OPTIONS valables pour tous les styles (tuiles sans bordure, tableau de bord uni) : registre, état, attributs de <html>, règles
 *    CSS, store, configuration (champ `styleOptions` écrit seulement s'il en faut un) ;
 *  - le store (`setDashStyle`, `setDashStyleOptions`) et l'aller-retour de la configuration (`BI_Dashboard_Config`) : rien d'écrit pour
 *    Standard, anciens formats lus en Standard, valeur mal formée ignorée, id inconnu mais bien formé conservé (`factory` et `dense`,
 *    retirés le 18/11/2026, s'affichent en Standard sans être effacés) ;
 *  - le câblage de index.html/harness.html.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const styles = require('../js/styles.js');
const i18n = require('../js/i18n.js');
const data = require('../js/data.js');
const { createStore } = require('../js/state.js');

const NEW_STYLES = ['fluid', 'editorial', 'console', 'glass'];
const ALWAYS_DARK = ['console']; // un seul bloc de jetons, sombre quelle que soit la préférence du système
const ALL = ['standard'].concat(NEW_STYLES);

(async () => {
  // --- 1. Registre ----------------------------------------------------------------------------------------------------------
  assert.deepStrictEqual(styles.STYLE_IDS, ALL);
  assert.strictEqual(styles.DEFAULT_STYLE, 'standard');
  assert.strictEqual(styles.STYLES.standard.chart, null, 'Standard ne règle rien');
  for (const id of ALL) {
    const s = styles.STYLES[id];
    assert.strictEqual(s.id, id);
    for (const key of [s.nameKey, s.descKey]) {
      for (const lang of ['fr', 'en']) {
        i18n.setLang(lang);
        const text = i18n.t(key);
        assert.ok(text && text !== key, `clé i18n ${key} absente en ${lang}`);
      }
    }
  }
  i18n.setLang('fr');
  for (const key of ['style.title', 'style.hint', 'style.options.title', 'style.option.hideBorders', 'style.option.hideBorders.desc', 'style.option.uniform', 'style.option.uniform.desc']) {
    for (const lang of ['fr', 'en']) { i18n.setLang(lang); assert.ok(i18n.t(key) && i18n.t(key) !== key, `${key} en ${lang}`); }
  }
  i18n.setLang('fr');
  assert.strictEqual(i18n.t('style.title'), 'Style des tuiles');
  assert.strictEqual(styles.normalizeStyleId('fluid'), 'fluid');
  // Un id inconnu, absent ou hostile (clé de prototype comprise) s'affiche en Standard.
  for (const bad of ['zzz', '', null, undefined, 12, {}, ['fluid'], 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'Fluid', 'fluid ']) {
    assert.strictEqual(styles.normalizeStyleId(bad), 'standard', `id ${JSON.stringify(bad)}`);
    assert.strictEqual(styles.isKnown(bad), false);
  }
  assert.strictEqual(styles.get('zzz'), styles.STYLES.standard);
  // Valeur à écrire : rien pour Standard ou un id inconnu (une config sans choix reste identique).
  assert.strictEqual(styles.configValue('standard'), undefined);
  assert.strictEqual(styles.configValue('zzz'), undefined);
  assert.strictEqual(styles.configValue('editorial'), 'editorial');
  // apply() sans document (Node) : tient le style courant, dit s'il a changé.
  assert.strictEqual(styles.apply('fluid'), true);
  assert.strictEqual(styles.currentId(), 'fluid');
  assert.strictEqual(styles.current(), styles.STYLES.fluid);
  assert.strictEqual(styles.apply('fluid'), false);
  assert.strictEqual(styles.apply('zzz'), true);
  assert.strictEqual(styles.currentId(), 'standard');
  // `factory` et `dense` (remplacés le 18/11/2026 par `console` et `glass`) ne sont plus des styles : une configuration qui les porte
  // s'affiche en Standard (et l'id traverse la sauvegarde, voir la section Configuration).
  for (const removed of ['factory', 'dense']) {
    assert.strictEqual(styles.isKnown(removed), false);
    assert.strictEqual(styles.normalizeStyleId(removed), 'standard');
    assert.strictEqual(styles.configValue(removed), undefined);
    assert.ok(!(`style.${removed}.name` in i18n.STRINGS), `${removed} : clé i18n retirée`);
  }
  // Avec un document simulé : `apply` pose `data-dash-style` (rien pour Standard) et `applyOptions` un attribut par option cochée.
  {
    const attrs = {};
    global.document = { documentElement: {
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
      removeAttribute: (k) => { delete attrs[k]; }, hasAttribute: (k) => k in attrs
    } };
    try {
      styles.apply('glass');
      assert.deepStrictEqual(attrs, { 'data-dash-style': 'glass' });
      styles.apply('standard');
      assert.deepStrictEqual(attrs, {}, 'Standard : aucun attribut');
      assert.strictEqual(styles.applyOptions({ hideBorders: true }), true);
      assert.deepStrictEqual(attrs, { 'data-dash-borders': 'none' });
      assert.strictEqual(styles.applyOptions({ hideBorders: true }), false, 'même valeur : rien ne change');
      assert.strictEqual(styles.applyOptions({ hideBorders: true, uniform: true }), true);
      assert.deepStrictEqual(attrs, { 'data-dash-borders': 'none', 'data-dash-uniform': 'true' });
      styles.apply('console');
      assert.strictEqual(attrs['data-dash-style'], 'console', 'les options ne dépendent pas du style');
      assert.strictEqual(styles.applyOptions({ uniform: true }), true);
      assert.deepStrictEqual(attrs, { 'data-dash-style': 'console', 'data-dash-uniform': 'true' }, 'une option décochée retire son attribut');
      assert.strictEqual(styles.applyOptions(undefined), true);
      assert.deepStrictEqual(attrs, { 'data-dash-style': 'console' });
      assert.deepStrictEqual(styles.currentOptions(), {});
    } finally { delete global.document; styles.apply('standard'); styles.applyOptions({}); }
  }
  // Options : seules les valeurs `true` des deux clés connues sont retenues, rien d'autre ne passe.
  assert.deepStrictEqual(styles.OPTION_KEYS, ['hideBorders', 'uniform']);
  for (const [raw, expected] of [
    [undefined, {}], [null, {}], [[], {}], ['hideBorders', {}], [12, {}], [{}, {}],
    [{ hideBorders: true }, { hideBorders: true }], [{ uniform: true, hideBorders: true }, { hideBorders: true, uniform: true }],
    [{ hideBorders: 'true', uniform: 1 }, {}], [{ hideBorders: false, uniform: false }, {}],
    [{ hideBorders: true, evil: true, __proto__: { uniform: true } }, { hideBorders: true }], [{ constructor: true }, {}]
  ]) assert.deepStrictEqual(styles.normalizeOptions(raw), expected, JSON.stringify(raw));
  assert.strictEqual(styles.optionsConfigValue({}), undefined, 'aucune option : rien à écrire');
  assert.strictEqual(styles.optionsConfigValue({ hideBorders: false }), undefined);
  assert.deepStrictEqual(styles.optionsConfigValue({ uniform: true, junk: 1 }), { uniform: true });
  assert.strictEqual(styles.sameOptions({ uniform: true }, { uniform: true, hideBorders: false }), true);
  assert.strictEqual(styles.sameOptions({ uniform: true }, {}), false);
  console.log('OK styles — registre, clés fr/en, ids inconnus ou hostiles -> Standard, valeur écrite, factory/dense retirés, attributs de <html>, options');

  // --- 2. Couleurs ----------------------------------------------------------------------------------------------------------
  assert.deepStrictEqual(styles.parseColor('#2a78d6'), [42, 120, 214]);
  assert.deepStrictEqual(styles.parseColor('#fff'), [255, 255, 255]);
  assert.deepStrictEqual(styles.parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.deepStrictEqual(styles.parseColor('rgba(10 20 30 / 50%)'), [10, 20, 30]);
  for (const bad of ['', 'red', 'var(--x)', 'color-mix(in srgb, red, blue)', null, 5]) assert.strictEqual(styles.parseColor(bad), null);
  assert.strictEqual(styles.mixColors('#000000', '#ffffff', 0.5), '#808080');
  assert.strictEqual(styles.mixColors('#2a78d6', '#ffffff', 0), '#2a78d6');
  assert.strictEqual(styles.mixColors('#2a78d6', '#ffffff', 1), '#ffffff');
  assert.strictEqual(styles.mixColors('var(--x)', '#ffffff', 0.5), 'var(--x)', 'couleur illisible gardée telle quelle');
  assert.strictEqual(styles.mixColors('#2a78d6', '#ffffff', 7), '#ffffff', 'part bornée à 1');
  assert.ok(styles.luminance('#ffffff') > 0.99 && styles.luminance('#000000') === 0 && styles.luminance('x') === null);
  const wcag = (a, b) => { const [l1, l2] = [styles.luminance(a), styles.luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  // Teinte douce : pastel sur carte claire ; sur carte SOMBRE la barre s'éclaircit au lieu de disparaître.
  const fluidSoft = styles.STYLES.fluid.chart.soft;
  const lightTh = { surface: '#ffffff', text: '#131a2b' };
  const darkTh = { surface: '#171b25', text: '#eef1f8' };
  assert.strictEqual(styles.softColor('#2a78d6', fluidSoft, lightTh), '#95bceb');
  for (const base of ['#2a78d6', '#002f63', '#04813a', '#303030']) {
    const soft = styles.softColor(base, fluidSoft, darkTh);
    assert.ok(wcag(soft, darkTh.surface) >= 2, `barre ${base} -> ${soft} lisible sur carte sombre (${wcag(soft, darkTh.surface).toFixed(2)}:1)`);
    assert.ok(styles.luminance(soft) > styles.luminance(base), 'éclaircie sur fond sombre');
  }
  // Éditorial : vers l'encre (texte), dans les deux modes.
  const edSoft = styles.STYLES.editorial.chart.soft;
  assert.ok(styles.luminance(styles.softColor('#2a78d6', edSoft, { surface: '#f8f6f1', text: '#1d1c1a' })) < styles.luminance('#2a78d6'));
  assert.strictEqual(styles.softColor('#2a78d6', null, lightTh), '#2a78d6');
  // Dégradés (console, verre) : `rgba()` de la couleur de la série, objet linéaire simple (aucune classe ECharts), null si illisible.
  assert.strictEqual(styles.withAlpha('#2a78d6', 0.5), 'rgba(42, 120, 214, 0.5)');
  assert.strictEqual(styles.withAlpha('#2a78d6', 7), 'rgba(42, 120, 214, 1)', 'opacité bornée');
  assert.strictEqual(styles.withAlpha('var(--x)', 0.5), null);
  assert.deepStrictEqual(styles.fadeGradient('#2a78d6', 1, 0.4, 'down'), {
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [{ offset: 0, color: 'rgba(42, 120, 214, 1)' }, { offset: 1, color: 'rgba(42, 120, 214, 0.4)' }]
  });
  assert.deepStrictEqual(styles.fadeGradient('#2a78d6', 0.4, 1, 'right').x2, 1);
  assert.strictEqual(styles.fadeGradient('red', 1, 0.4, 'down'), null);
  // Lisibilité sur carte SOMBRE : une couleur trop foncée s'éclaircit vers le texte jusqu'à 3:1 ; claire ou lisible : intacte.
  const consoleTh = { surface: '#121722', text: '#e6edf6' };
  for (const base of ['#002f63', '#303030', '#511f00', '#003c17']) {
    const lifted = styles.legibleOnSurface(base, consoleTh, 3);
    assert.ok(styles.contrastRatio(lifted, consoleTh.surface) >= 3, `${base} -> ${lifted}`);
    assert.ok(styles.luminance(lifted) > styles.luminance(base));
  }
  assert.strictEqual(styles.legibleOnSurface('#2a78d6', consoleTh, 3), '#2a78d6', 'déjà lisible : intacte');
  assert.strictEqual(styles.legibleOnSurface('#002f63', { surface: '#ffffff', text: '#000000' }, 3), '#002f63', 'carte claire : jamais touchée');
  assert.strictEqual(styles.legibleOnSurface('var(--x)', consoleTh, 3), 'var(--x)');
  assert.strictEqual(styles.legibleOnSurface('#002f63', {}, 3), '#002f63');
  console.log('OK styles — couleurs : lecture, mélange, teinte douce claire et sombre, dégradés, lisibilité sur carte sombre');

  // --- 3. La passe sur les options ECharts ----------------------------------------------------------------------------------
  const TH = { text: '#131a2b', surface: '#ffffff', muted: '#586381' };
  const axisFmt = (v) => `${Math.round(v / 1000)} k`;
  const catAxis = (n) => ({ type: 'category', data: Array.from({ length: n }, (_, i) => `c${i}`) });
  const valAxis = () => ({ type: 'value', axisLabel: { formatter: axisFmt } });
  const barOption = (n, extra = {}) => ({
    color: ['#2a78d6', '#eb6834'],
    grid: { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 },
    tooltip: { trigger: 'axis', extraCssText: 'max-width: 85%; white-space: normal;' },
    xAxis: catAxis(n), yAxis: valAxis(),
    series: [{ type: 'bar', data: Array.from({ length: n }, (_, i) => ({ value: (i + 1) * 1000 })) }],
    ...extra
  });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const strip = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? '[fn]' : v));

  // Standard : l'option sort STRICTEMENT identique (même objet, rien de touché).
  {
    const o = barOption(5);
    const before = strip(o);
    assert.strictEqual(styles.applyToOption(o, styles.STYLES.standard, TH), o);
    assert.strictEqual(strip(o), before);
    assert.strictEqual(styles.applyToOption(o, null, TH), o);
    assert.strictEqual(styles.applyToOption(null, styles.STYLES.fluid, TH), null);
  }

  // console : petites barres à dégradé (plein au bout, 45 % à la base), quadrillage en pointillés, axe des valeurs sans trait, infobulle presque droite.
  {
    const o = styles.applyToOption(barOption(5), styles.STYLES.console, TH);
    const sr = o.series[0];
    assert.deepStrictEqual(sr.itemStyle.borderRadius, [2, 2, 0, 0]);
    assert.strictEqual(sr.barMaxWidth, 26);
    assert.deepStrictEqual(sr.itemStyle.color, styles.fadeGradient('#2a78d6', 1, 0.45, 'down'), 'dégradé de la couleur de la 1re série de la palette');
    assert.strictEqual(o.yAxis.axisLine.show, false);
    assert.strictEqual(o.xAxis.axisLine.show, true);
    assert.strictEqual(o.yAxis.splitLine.show, true);
    assert.strictEqual(o.yAxis.splitLine.lineStyle.type, 'dotted');
    assert.ok(/border-radius: 3px;$/.test(o.tooltip.extraCssText) && o.tooltip.extraCssText.startsWith('max-width: 85%'), o.tooltip.extraCssText);
    assert.strictEqual(sr.label, undefined, 'console n\'écrit pas de valeurs');
    assert.strictEqual(o.yAxis.axisLabel.fontSize, 10);
  }
  // Dégradés de barres : horizontales (base à gauche), plusieurs séries (une couleur chacune), carte sombre (couleur éclaircie).
  {
    const h = styles.applyToOption({ ...barOption(4), xAxis: valAxis(), yAxis: { ...catAxis(4), inverse: true } }, styles.STYLES.glass, TH);
    const g = h.series[0].itemStyle.color;
    assert.strictEqual(g.x2, 1);
    assert.strictEqual(g.y2, 0);
    assert.strictEqual(g.colorStops[0].color, 'rgba(42, 120, 214, 0.55)', 'base (gauche) estompée');
    assert.strictEqual(g.colorStops[1].color, 'rgba(42, 120, 214, 1)', 'bout (droite) plein');
    assert.deepStrictEqual(h.series[0].itemStyle.borderRadius, [10, 10, 10, 10], 'pilule');

    const two = barOption(5, { series: [{ type: 'bar', name: 'A', data: [1, 2, 3, 4, 5] }, { type: 'bar', name: 'B', data: [2, 3, 4, 5, 6] }] });
    const m = styles.applyToOption(two, styles.STYLES.console, TH);
    assert.strictEqual(m.series[0].itemStyle.color.colorStops[0].color, 'rgba(42, 120, 214, 1)');
    assert.strictEqual(m.series[1].itemStyle.color.colorStops[0].color, 'rgba(235, 104, 52, 1)', 'chaque série garde SA couleur de palette');

    const dark = styles.applyToOption(barOption(5, { color: ['#002f63'] }), styles.STYLES.console, { surface: '#121722', text: '#e6edf6' });
    const base = dark.series[0].itemStyle.color.colorStops[0].color;
    const rgb = base.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(styles.contrastRatio(`#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`, '#121722') >= 3, 'palette marine éclaircie sur carte sombre');
    const light = styles.applyToOption(barOption(5, { color: ['#002f63'] }), styles.STYLES.console, TH);
    assert.strictEqual(light.series[0].itemStyle.color.colorStops[0].color, 'rgba(0, 47, 99, 1)', 'carte claire : couleur de la palette intacte');
  }
  // Ce que les dégradés ne font PAS : pile (le dégradé couperait chaque segment), couleur posée par le rendu (chaîne ou dégradé),
  // couleur illisible, estompage par donnée.
  for (const id of ['console', 'glass']) {
    const stacked = styles.applyToOption(barOption(5, { series: [{ type: 'bar', stack: 'total', data: [1, 2, 3, 4, 5] }, { type: 'bar', stack: 'total', data: [2, 3, 4, 5, 6] }] }), styles.STYLES[id], TH);
    assert.ok(stacked.series.every((x) => x.itemStyle.color === undefined && x.itemStyle.borderRadius === undefined), `${id} : empilé, ni dégradé ni arrondi`);
    const own = barOption(5);
    own.series[0].itemStyle = { color: '#123456' };
    assert.strictEqual(styles.applyToOption(own, styles.STYLES[id], TH).series[0].itemStyle.color.colorStops[0].color, 'rgba(18, 52, 86, 1)', `${id} : le dégradé part de la couleur posée par le rendu`);
    const grad = barOption(5);
    const posed = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] };
    grad.series[0].itemStyle = { color: posed };
    assert.strictEqual(styles.applyToOption(grad, styles.STYLES[id], TH).series[0].itemStyle.color, posed, `${id} : un dégradé déjà posé est respecté`);
    const css = barOption(5, { color: ['var(--accent)'] });
    assert.strictEqual(styles.applyToOption(css, styles.STYLES[id], TH).series[0].itemStyle.color, undefined, `${id} : couleur illisible -> rien de posé`);
    const dim = barOption(3);
    dim.series[0].data = [{ value: 1, itemStyle: { opacity: 0.3 } }, { value: 2 }, { value: 3 }];
    const d = styles.applyToOption(dim, styles.STYLES[id], TH);
    assert.strictEqual(d.series[0].data[0].itemStyle.opacity, 0.3, `${id} : estompage par donnée gardé`);
    assert.strictEqual(d.series[0].label, undefined, `${id} : pas de valeurs ajoutées`);
  }

  // fluid, barres verticales : valeurs au bout des barres (formateur d'axe de la tuile), axe des valeurs masqué, teinte douce.
  {
    const o = styles.applyToOption(barOption(5), styles.STYLES.fluid, TH);
    const sr = o.series[0];
    assert.deepStrictEqual(sr.itemStyle.borderRadius, [8, 8, 0, 0]);
    assert.strictEqual(sr.label.show, true);
    assert.strictEqual(sr.label.position, 'top');
    assert.strictEqual(sr.label.formatter({ value: 5000 }), '5 k', 'formateur d\'axe de la tuile réutilisé');
    assert.strictEqual(sr.label.formatter({ value: null }), '');
    assert.strictEqual(sr.itemStyle.color, '#95bceb', 'couleur unique -> pastel');
    assert.strictEqual(sr.emphasis.itemStyle.color, '#2a78d6', 'couleur pleine au survol');
    assert.strictEqual(o.yAxis.axisLabel.show, false);
    assert.strictEqual(o.yAxis.splitLine.show, false);
    assert.strictEqual(o.xAxis.axisLine.show, false);
    assert.ok(o.grid.top >= 28);
    assert.strictEqual(sr.barCategoryGap, '42%');
  }
  // fluid, horizontal : pilule, valeur à droite, de la place à droite.
  {
    const o = styles.applyToOption({ ...barOption(4), xAxis: valAxis(), yAxis: { ...catAxis(4), inverse: true } }, styles.STYLES.fluid, TH);
    assert.deepStrictEqual(o.series[0].itemStyle.borderRadius, [8, 8, 8, 8]);
    assert.strictEqual(o.series[0].label.position, 'right');
    assert.ok(o.grid.right >= 56);
    assert.strictEqual(o.xAxis.axisLabel.show, false, 'l\'axe des valeurs est l\'axe horizontal');
    assert.notStrictEqual(o.yAxis.axisLabel && o.yAxis.axisLabel.show, false, 'l\'axe des catégories garde ses libellés');
  }
  // Ce que fluid ne fait PAS : trop de barres, plusieurs séries, empilé, histogramme, combo, mesure déjà colorée.
  {
    const many = styles.applyToOption(barOption(40), styles.STYLES.fluid, TH);
    assert.strictEqual(many.series[0].label, undefined, '> 14 barres : pas de valeurs');
    assert.notStrictEqual(many.yAxis.axisLabel.show, false, '... et l\'axe des valeurs reste');

    const two = barOption(5, { series: [{ type: 'bar', name: 'A', data: [1, 2, 3, 4, 5] }, { type: 'bar', name: 'B', data: [2, 3, 4, 5, 6] }] });
    const m = styles.applyToOption(two, styles.STYLES.fluid, TH);
    assert.ok(m.series.every((s) => s.label === undefined && s.itemStyle.color === undefined), 'plusieurs séries : couleurs de la palette, pas de valeurs');
    assert.notStrictEqual(m.yAxis.axisLabel.show, false);

    const stacked = barOption(5, { series: [{ type: 'bar', stack: 'total', data: [1, 2, 3, 4, 5] }, { type: 'bar', stack: 'total', data: [2, 3, 4, 5, 6] }] });
    const s = styles.applyToOption(stacked, styles.STYLES.fluid, TH);
    assert.ok(s.series.every((x) => x.itemStyle.borderRadius === undefined && x.label === undefined), 'empilé : aucun arrondi au milieu d\'une pile');

    const hist = barOption(10, { series: [{ type: 'bar', barCategoryGap: '8%', data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }] });
    const h = styles.applyToOption(hist, styles.STYLES.fluid, TH);
    assert.strictEqual(h.series[0].barCategoryGap, '8%', 'classes contiguës de l\'histogramme gardées');
    assert.strictEqual(h.series[0].label, undefined);

    const makeCombo = () => barOption(5, {
      yAxis: [valAxis(), { type: 'value', splitLine: { show: false }, axisLabel: { formatter: axisFmt } }],
      series: [{ type: 'bar', yAxisIndex: 0, data: [1, 2, 3, 4, 5] }, { type: 'line', yAxisIndex: 1, data: [1, 2, 3, 4, 5] }]
    });
    const c = styles.applyToOption(makeCombo(), styles.STYLES.fluid, TH);
    assert.strictEqual(c.series[0].label, undefined, 'combo : pas de valeurs sur les barres (la courbe y est)');
    assert.strictEqual(c.series[0].itemStyle.color, undefined);
    const cons = styles.applyToOption(makeCombo(), styles.STYLES.console, TH);
    assert.strictEqual(cons.yAxis[1].splitLine.show, false, 'quadrillage que le rendu a masqué : reste masqué');
    assert.strictEqual(cons.yAxis[0].splitLine.show, true);
    assert.strictEqual(cons.series[1].lineStyle.shadowBlur, 8, 'la courbe du combo garde son halo');
    assert.ok(cons.series[0].itemStyle.color && cons.series[0].itemStyle.color.type === 'linear', 'barres du combo en dégradé');

    // Ligne de repère (markLine) : le style n'ajoute pas de valeurs au bout des barres et garde l'axe qu'elle se lit contre.
    const ref = barOption(5);
    ref.series[0].markLine = { data: [{ yAxis: 3000 }] };
    const r = styles.applyToOption(ref, styles.STYLES.fluid, TH);
    assert.strictEqual(r.series[0].label, undefined, 'ligne de repère : pas de valeurs ajoutées par le style');
    assert.notStrictEqual(r.yAxis.axisLabel.show, false, '... et l\'axe des valeurs reste');
    assert.deepStrictEqual(r.series[0].itemStyle.borderRadius, [8, 8, 0, 0], '... mais barres arrondies et pastel');
    // Étiquettes réglées par la tuile (`tile.valueLabels`) : gardées telles quelles, le style ne les remplace pas.
    const tileLabels = barOption(5);
    tileLabels.series[0].label = { show: true, position: 'top', fontSize: 10, formatter: () => 'x' };
    const tl = styles.applyToOption(tileLabels, styles.STYLES.fluid, TH);
    assert.strictEqual(tl.series[0].label.fontSize, 10);
    assert.strictEqual(tl.series[0].label.formatter({ value: 1 }), 'x');

    const own = barOption(5);
    own.series[0].itemStyle = { color: '#123456' };
    assert.strictEqual(styles.applyToOption(own, styles.STYLES.fluid, TH).series[0].itemStyle.color, '#123456', 'couleur posée par le rendu respectée');
    // Cellules déjà estompées (filtre croisé) : l'estompage par donnée n'est pas écrasé.
    const dimmed = barOption(3);
    dimmed.series[0].data = [{ value: 1, itemStyle: { opacity: 0.3 } }, { value: 2 }, { value: 3 }];
    assert.strictEqual(styles.applyToOption(dimmed, styles.STYLES.fluid, TH).series[0].data[0].itemStyle.opacity, 0.3);
  }
  // La palette de la tuile n'est jamais remplacée.
  for (const id of NEW_STYLES) {
    const o = barOption(5);
    o.color = data.paletteColors('okabe');
    styles.applyToOption(o, styles.STYLES[id], TH);
    assert.deepStrictEqual(o.color, data.paletteColors('okabe'), `${id} : palette de la tuile intacte`);
  }
  // glass : barres en pilule, quadrillage en pointillés, aucun trait d'axe, repère de légende rond, infobulle très arrondie.
  {
    const o = styles.applyToOption(barOption(5, { legend: { top: 0 } }), styles.STYLES.glass, TH);
    assert.deepStrictEqual(o.series[0].itemStyle.borderRadius, [10, 10, 0, 0], 'verticales : seul le haut est arrondi');
    assert.strictEqual(o.series[0].barMaxWidth, 34);
    assert.strictEqual(o.xAxis.axisLine.show, false);
    assert.strictEqual(o.yAxis.axisLine.show, false);
    assert.strictEqual(o.yAxis.splitLine.lineStyle.type, 'dotted');
    assert.strictEqual(o.legend.icon, 'circle');
    assert.ok(/border-radius: 14px;$/.test(o.tooltip.extraCssText));
  }
  // editorial : quadrillage en tirets, barres fines teintées d'encre.
  {
    const o = styles.applyToOption(barOption(5), styles.STYLES.editorial, TH);
    assert.strictEqual(o.yAxis.splitLine.lineStyle.type, 'dashed');
    assert.strictEqual(o.series[0].barMaxWidth, 20);
    assert.notStrictEqual(o.series[0].itemStyle.color, '#2a78d6');
    assert.ok(styles.luminance(o.series[0].itemStyle.color) < styles.luminance('#2a78d6'), 'barre assombrie vers l\'encre');
  }
  // Courbes : tracé, repères (jamais masqués : un point cliquable sert au filtre croisé), aire non empilée seulement.
  {
    const lineOption = (series) => ({ color: ['#2a78d6'], xAxis: catAxis(3), yAxis: valAxis(), series });
    const o = styles.applyToOption(lineOption([
      { type: 'line', symbolSize: 8, areaStyle: { opacity: 0.25 }, data: [1, 2, 3] },
      { type: 'line', stack: 'total', areaStyle: { opacity: 0.65 }, data: [1, 2, 3] }
    ]), styles.STYLES.fluid, TH);
    assert.strictEqual(o.series[0].smooth, undefined, 'le style ne change jamais la forme du tracé');
    assert.strictEqual(o.series[0].lineStyle.width, 3);
    assert.strictEqual(o.series[0].symbol, 'circle', 'repère gardé');
    assert.strictEqual(o.series[0].symbolSize, 8);
    assert.deepStrictEqual(o.series[0].itemStyle, { borderColor: '#ffffff', borderWidth: 2 });
    assert.strictEqual(o.series[0].areaStyle.opacity, 0.16);
    assert.strictEqual(o.series[1].areaStyle.opacity, 0.65, 'aire empilée : opacité du rendu gardée');
    // Forme choisie par la tuile (`tile.lineShape` : lissé 0,35 ou escalier) : intacte quel que soit le style.
    for (const id of NEW_STYLES) {
      const shaped = styles.applyToOption(lineOption([{ type: 'line', smooth: 0.35, data: [1, 2, 3] }, { type: 'line', step: 'middle', data: [1, 2, 3] }, { type: 'line', data: [1, 2, 3] }]), styles.STYLES[id], TH);
      assert.strictEqual(shaped.series[0].smooth, 0.35, `${id} : lissage de la tuile gardé`);
      assert.strictEqual(shaped.series[1].step, 'middle', `${id} : escalier de la tuile gardé`);
      assert.ok(shaped.series[1].smooth === undefined && shaped.series[2].smooth === undefined && shaped.series[2].step === undefined, `${id} : jamais de forme ajoutée`);
    }
    const c = styles.applyToOption(lineOption([{ type: 'line', data: [1, 2, 3] }]), styles.STYLES.console, TH);
    assert.strictEqual(c.series[0].symbolSize, 5);
    assert.strictEqual(c.series[0].lineStyle.width, 1.8);
    assert.strictEqual(c.series[0].lineStyle.shadowBlur, 8, 'halo de la couleur de la courbe');
    assert.strictEqual(c.series[0].lineStyle.shadowColor, 'rgba(42, 120, 214, 0.55)');
    assert.strictEqual(c.series[0].areaStyle, undefined, 'pas d\'aire là où la tuile n\'en veut pas');
    // Aire non empilée : dégradé de la couleur de la courbe (opacité 1 : le dégradé porte la transparence) ; empilée : intacte.
    for (const id of ['console', 'glass']) {
      const a = styles.applyToOption(lineOption([
        { type: 'line', areaStyle: { opacity: 0.25 }, data: [1, 2, 3] },
        { type: 'line', stack: 'total', areaStyle: { opacity: 0.65 }, data: [1, 2, 3] }
      ]), styles.STYLES[id], TH);
      assert.strictEqual(a.series[0].areaStyle.color.type, 'linear', `${id} : aire en dégradé`);
      assert.strictEqual(a.series[0].areaStyle.opacity, 1);
      assert.deepStrictEqual(a.series[0].areaStyle.color, styles.fadeGradient('#2a78d6', styles.STYLES[id].chart.areaGradient.from, styles.STYLES[id].chart.areaGradient.to, 'down'));
      assert.deepStrictEqual(a.series[1].areaStyle, { opacity: 0.65 }, `${id} : aire empilée intacte`);
      assert.strictEqual(a.series[1].lineStyle.shadowBlur, undefined, `${id} : pas de halo sur une pile`);
      assert.strictEqual(a.series[0].smooth, undefined);
    }
    assert.strictEqual(styles.applyToOption(lineOption([{ type: 'line', data: [1] }]), styles.STYLES.glass, TH).series[0].lineStyle.shadowBlur, undefined, 'le verre n\'a pas de halo');
    const noColor = styles.applyToOption({ xAxis: catAxis(2), yAxis: valAxis(), series: [{ type: 'line', areaStyle: { opacity: 0.25 }, data: [1, 2] }] }, styles.STYLES.console, TH);
    assert.deepStrictEqual(noColor.series[0].areaStyle, { opacity: 0.25 }, 'sans couleur lisible : aire du rendu gardée');
  }
  // Parts : couleur de la carte entre les parts (jamais du blanc en dur), arrondis, entonnoir sans rayon, carte proportionnelle avec écart.
  {
    const dark = { text: '#eef1f8', surface: '#171b25' };
    const o = styles.applyToOption({ series: [{ type: 'pie', data: [] }, { type: 'funnel', data: [] }, { type: 'treemap', data: [] }] }, styles.STYLES.fluid, dark);
    assert.strictEqual(o.series[0].itemStyle.borderColor, '#171b25');
    assert.strictEqual(o.series[0].itemStyle.borderWidth, 3);
    assert.strictEqual(o.series[0].itemStyle.borderRadius, 5);
    assert.strictEqual(o.series[1].itemStyle.borderRadius, undefined);
    assert.strictEqual(o.series[1].itemStyle.borderWidth, 3);
    assert.strictEqual(o.series[2].itemStyle.gapWidth, 3);
    assert.strictEqual(o.series[2].itemStyle.borderWidth, undefined);
  }
  // Légende : repère de la forme du style, sans écraser un réglage du rendu.
  {
    const o = styles.applyToOption(barOption(5, { legend: { top: 0 } }), styles.STYLES.fluid, TH);
    assert.strictEqual(o.legend.icon, 'circle');
    assert.strictEqual(o.legend.top, 0);
    const keep = styles.applyToOption(barOption(5, { legend: { icon: 'diamond' } }), styles.STYLES.fluid, TH);
    assert.strictEqual(keep.legend.icon, 'diamond');
  }
  // Un graphique sans axes ni séries (radar sans donnée, message « aucune valeur ») ne fait pas lever la passe.
  for (const id of NEW_STYLES) {
    for (const o of [{}, { series: [] }, { series: [{ type: 'radar' }] }, { title: { text: 'x' }, series: [], xAxis: { show: false }, yAxis: { show: false } }, { series: { type: 'bar' } }]) {
      assert.doesNotThrow(() => styles.applyToOption(clone(o), styles.STYLES[id], TH), `${id} ${JSON.stringify(o)}`);
    }
  }
  console.log('OK styles — passe ECharts : Standard intact, barres/valeurs/courbes/parts/axes de chaque style, rien d\'écrasé (palette, couleur du rendu, histogramme, combo)');

  // --- 4. CSS : jetons clair/sombre complets, contrastes, accord avec le kit et avec le rendu standard -------------------------
  function parseCss(css) {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    (function walk(src, media) {
      let i = 0;
      while (i < src.length) {
        const open = src.indexOf('{', i);
        if (open === -1) break;
        const head = src.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
        const body = src.slice(open + 1, j - 1);
        if (head.startsWith('@media')) walk(body, head);
        else if (!head.startsWith('@')) {
          const decls = {};
          body.split(';').forEach((d) => { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
          rules.push({ media, selector: head.replace(/\s+/g, ' '), decls });
        }
        i = j;
      }
    })(text, null);
    return rules;
  }
  const dashRules = parseCss(read('css', 'dash-styles.css'));
  const DARK = '@media (prefers-color-scheme: dark)';
  const tokenBlock = (id, dark) => dashRules.find((r) => (dark ? r.media === DARK : r.media === null)
    && r.selector.includes(`.style-swatch[data-dash-style="${id}"]`));
  const COLOR_TOKENS = ['--bg', '--surface', '--surface-sunken', '--border', '--border-strong', '--text', '--text-secondary', '--text-muted', '--accent'];
  const SHAPE_TOKENS = ['--dash-radius', '--dash-gap', '--dash-pad', '--dash-bw', '--dash-shadow', '--dash-shadow-hover', '--dash-title-font', '--dash-title-size',
    '--dash-title-weight', '--dash-kpi-font', '--dash-kpi-max', '--dash-kpi-weight', '--dash-bar', '--dash-bar-radius'];
  const hex = (v) => { assert.ok(/^#[0-9a-f]{6}$/i.test(v), `couleur « ${v} » attendue en #rrggbb`); return v; };

  const wcagSafe = (fg, bg) => wcag(hex(fg), hex(bg));
  for (const id of NEW_STYLES) {
    const light = tokenBlock(id, false);
    const dark = tokenBlock(id, true);
    const alwaysDark = ALWAYS_DARK.includes(id);
    assert.ok(light, `${id} : bloc de jetons`);
    assert.ok(light.selector.includes(`:root[data-dash-style="${id}"]`) && light.selector.includes(`.style-swatch[data-dash-style="${id}"]`), `${id} : le même bloc sert la page et la pastille`);
    for (const t of COLOR_TOKENS.concat(SHAPE_TOKENS)) assert.ok(light.decls[t] !== undefined, `${id} : ${t} manque`);
    if (alwaysDark) {
      // Toujours sombre : UN seul bloc (une variante sombre serait morte), et `color-scheme: dark`.
      assert.strictEqual(dark, undefined, `${id} : toujours sombre, pas de bloc @media dark`);
      assert.strictEqual(light.decls['color-scheme'], 'dark', `${id} : color-scheme: dark`);
    } else {
      assert.ok(dark, `${id} : bloc sombre`);
      assert.ok(dark.selector.includes(`:root[data-dash-style="${id}"]`) && dark.selector.includes(`.style-swatch[data-dash-style="${id}"]`), `${id} : le même bloc sombre sert la page et la pastille`);
      // Un jeton de COULEUR posé en clair doit l'être en sombre aussi, sinon il resterait clair (`:root[data-dash-style]` bat `:root`).
      for (const t of COLOR_TOKENS) assert.ok(dark.decls[t] !== undefined, `${id} : ${t} manque en SOMBRE`);
      assert.ok(dark.decls['--dash-shadow'] !== undefined || /none|^0px?$/.test(light.decls['--dash-shadow']) || id === 'editorial', `${id} : ombres du mode sombre`);
    }
    // Contrastes (WCAG AA : 4,5:1) des trois textes sur les trois fonds, dans chaque mode que le style peut montrer.
    for (const [mode, block] of (alwaysDark ? [['sombre', light]] : [['clair', light], ['sombre', dark]])) {
      const tokens = Object.assign({}, mode === 'sombre' && !alwaysDark ? light.decls : {}, block.decls);
      for (const text of ['--text', '--text-secondary', '--text-muted']) {
        for (const bg of ['--surface', '--surface-sunken', '--bg']) {
          const ratio = wcagSafe(tokens[text], tokens[bg]);
          assert.ok(ratio >= 4.5, `${id} ${mode} : ${text} sur ${bg} = ${ratio.toFixed(2)}:1`);
        }
      }
      // L'accent sert de texte (onglet actif, lien) : lisible sur la carte ; le texte d'un bouton plein sur l'accent aussi.
      assert.ok(wcagSafe(tokens['--accent'], tokens['--surface']) >= 3, `${id} ${mode} : accent sur la carte (${wcagSafe(tokens['--accent'], tokens['--surface']).toFixed(2)}:1)`);
    }
  }
  assert.ok(/--dash-bw:\s*2px 0 0 0/.test(tokenBlock('editorial', false).decls['--dash-bw'] ? `--dash-bw: ${tokenBlock('editorial', false).decls['--dash-bw']}` : ''), 'editorial : un filet en tête de carte seulement');

  // Console, toujours sombre : reprend les jetons que css/style.css ne définit que SOUS `prefers-color-scheme: dark`, avec les mêmes valeurs.
  {
    const base = parseCss(read('css', 'style.css'));
    const baseDark = base.find((r) => r.media === DARK && r.selector === ':root');
    const cons = tokenBlock('console', false);
    for (const t of ['--accent-soft', '--good-ink', '--critical', '--pp-scrim', '--danger-ink', '--danger-soft', '--warning-bg', '--warning-text', '--warning-border']) {
      assert.ok(baseDark.decls[t] !== undefined, `style.css sombre pose ${t}`);
      assert.strictEqual(cons.decls[t], baseDark.decls[t], `console : ${t} = celui du mode sombre de style.css`);
    }
    const solid = styles.mixColors(cons.decls['--accent'], cons.decls['--text'], 0.08); // --accent-solid de style.css : 92 % d'accent, 8 % de texte
    assert.ok(wcagSafe(cons.decls['--on-accent'], solid) >= 4.5, `console : texte d'un bouton plein = ${wcagSafe(cons.decls['--on-accent'], solid).toFixed(2)}:1`);
    assert.ok(dashRules.some((r) => r.selector === ':root[data-dash-style="console"] .warning-banner' && r.decls.color), 'console : bannière d\'erreur sombre');
    // Les pastilles du menu restent sombres même quand la page est en thème clair (un seul bloc, jamais d'écart).
    assert.ok(!dashRules.some((r) => r.media === DARK && r.selector.includes('"console"')), 'console : aucune règle @media dark');
  }

  // Verre : `--surface` reste OPAQUE (graphiques, menus, fenêtres) ; le fond translucide est `--dash-card-bg`, que seule la tuile consomme.
  // Les textes doivent rester lisibles sur la PIRE carte : le fond de la page sous la carte translucide, avec chaque halo à pleine intensité.
  {
    const blend = (top, bottomRgb) => {
      const m = top.match(/rgba?\(([^)]+)\)/)[1].split(',').map((v) => Number(v.trim()));
      const a = m.length > 3 ? m[3] : 1;
      return [0, 1, 2].map((i) => Math.round(m[i] * a + bottomRgb[i] * (1 - a)));
    };
    const hexToRgb = (h) => styles.parseColor(h);
    const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    for (const dark of [false, true]) {
      const b = tokenBlock('glass', dark);
      const t = Object.assign({}, dark ? tokenBlock('glass', false).decls : {}, b.decls);
      assert.ok(/^#[0-9a-f]{6}$/i.test(t['--surface']), `glass ${dark ? 'sombre' : 'clair'} : --surface opaque`);
      assert.ok(/^rgba\(/.test(t['--dash-card-bg']), 'glass : fond de carte translucide');
      assert.ok(/blur\(/.test(t['--dash-backdrop']), 'glass : verre dépoli');
      const halos = (t['--dash-page-bg'].match(/rgba\([^)]+\)/g) || []);
      assert.strictEqual(halos.length, 3, 'glass : trois halos de couleur');
      for (const halo of halos.concat([null])) {
        const page = halo ? blend(halo, hexToRgb(t['--bg'])) : hexToRgb(t['--bg']);
        const card = toHex(blend(t['--dash-card-bg'], page));
        for (const text of ['--text', '--text-secondary', '--text-muted']) {
          const ratio = wcagSafe(t[text], card);
          assert.ok(ratio >= 4.5, `glass ${dark ? 'sombre' : 'clair'} : ${text} sur la pire carte ${card} (halo ${halo}) = ${ratio.toFixed(2)}:1`);
        }
      }
    }
    // Pas de `backdrop-filter` sur la barre collante : il en ferait le bloc conteneur des menus `position: fixed` (js/appbar.js).
    for (const r of dashRules.filter((x) => x.selector.includes('.chrome'))) {
      assert.ok(r.decls['backdrop-filter'] === undefined && r.decls['-webkit-backdrop-filter'] === undefined, `${r.selector} : pas de backdrop-filter`);
    }
    // Les jetons que seuls certains styles posent s'héritent de <html> : la pastille les remet à zéro (sinon le verre teinterait toutes les pastilles).
    const sw = dashRules.find((r) => r.selector === '.style-swatch');
    assert.ok(sw && sw.decls['--dash-card-bg'] && sw.decls['--dash-swatch-bg'] === 'none', 'pastille : remise à zéro des jetons optionnels');
    // Le décor de la page et celui de la barre collante sont le MÊME dégradé fixe (sinon une marche visible à la jonction).
    const decor = dashRules.find((r) => r.selector.includes(':root[data-dash-style="glass"] body') && r.selector.includes('.chrome'));
    assert.ok(decor && decor.decls['background-image'] === 'var(--dash-page-bg)' && decor.decls['background-attachment'] === 'fixed');
  }

  // La pastille « Standard » montre le rendu de css/style.css.
  {
    const base = parseCss(read('css', 'style.css'));
    const rootLight = base.find((r) => r.media === null && r.selector === ':root');
    const swatchLight = tokenBlock('standard', false);
    for (const t of ['--bg', '--surface', '--text', '--text-muted']) assert.strictEqual(swatchLight.decls[t], rootLight.decls[t], `pastille Standard ${t}`);
    assert.strictEqual(swatchLight.decls['--border'], rootLight.decls['--border']);
    const baseDark = base.find((r) => r.media === DARK && r.selector === ':root');
    const swatchDark = tokenBlock('standard', true);
    for (const t of ['--bg', '--surface', '--text', '--text-muted']) assert.strictEqual(swatchDark.decls[t], baseDark.decls[t], `pastille Standard sombre ${t}`);
    // Et le Standard n'a AUCUNE règle sur la page : tout ce qui touche <html> passe par `[data-dash-style]`, que `standard` ne pose pas —
    // sauf les deux OPTIONS (`[data-dash-borders]`, `[data-dash-uniform]`), qui valent aussi pour lui mais n'agissent que si elles sont cochées.
    const onPage = dashRules.filter((r) => r.selector.split(',').some((s) => {
      const sel = s.trim();
      return /^:root/.test(sel) && !sel.startsWith(':root[data-dash-style') && !/^:root\[data-dash-(borders|uniform)/.test(sel) && !sel.includes('.style-swatch');
    }));
    assert.deepStrictEqual(onPage.map((r) => r.selector), [], 'aucune règle de dash-styles.css hors `:root[data-dash-style…]` ni options');
    assert.ok(!dashRules.some((r) => r.selector.includes('data-dash-style="standard"') && r.selector.includes(':root')), 'pas de règle :root pour standard');
  }
  // Options : tuiles sans bordure (le trait devient transparent, la tuile garde sa taille) et tableau de bord uni (traits partagés).
  {
    const rule = (sel, media = null) => dashRules.find((r) => r.media === media && r.selector.split(',').map((x) => x.trim()).includes(sel));
    const nb = rule(':root[data-dash-borders="none"] .tile');
    assert.ok(nb && nb.decls['border-color'] === 'transparent', 'sans bordure : trait transparent');
    assert.ok(rule(':root[data-dash-borders="none"] .tile.tile-zoomed').decls['border-color'] === 'transparent', 'sans bordure : aussi quand la tuile est agrandie');
    for (const r of dashRules.filter((x) => x.selector.includes('data-dash-borders'))) {
      for (const bad of ['border', 'border-width', 'border-style', 'padding', 'margin', 'height', 'min-height', 'width']) {
        assert.strictEqual(r.decls[bad], undefined, `${r.selector} : ne touche pas à ${bad} (la tuile garde sa taille, le graphique n'est pas redimensionné pour rien)`);
      }
    }
    assert.ok(rule(':root[data-dash-borders="none"]:not([data-dash-style]) .tile').decls['box-shadow'], 'Standard sans bordure : ombre discrète pour distinguer la carte');
    assert.ok(rule(':root[data-dash-borders="none"][data-dash-style] .tile').decls['box-shadow'].includes('--dash-shadow-nb'), 'styles : ombre `--dash-shadow-nb` sinon la leur');
    assert.ok(tokenBlock('glass', false).decls['--dash-shadow-nb'] && !/inset/.test(tokenBlock('glass', false).decls['--dash-shadow-nb']), 'verre sans bordure : sans le filet lumineux intérieur');
    const uni = rule(':root[data-dash-uniform] .tile');
    assert.strictEqual(uni.decls.margin, '-1px 0 0 -1px', 'uni : un seul filet entre deux tuiles (marge négative)');
    assert.strictEqual(uni.decls.background, 'transparent');
    assert.strictEqual(uni.decls['border-radius'], '0');
    assert.strictEqual(uni.decls['box-shadow'], 'none');
    assert.strictEqual(uni.decls['--surface'], 'var(--dash-tile-surface)', 'uni : --surface redevient le fond de la page dans une tuile');
    assert.strictEqual(uni.decls['backdrop-filter'], 'none', 'uni : pas de verre');
    const grid = rule(':root[data-dash-uniform] .tiles');
    assert.strictEqual(grid.decls.gap, '0');
    assert.strictEqual(grid.decls.padding, '1px 0 0 1px', 'le remplissage de la grille compense la marge négative des tuiles');
    assert.ok(rule(':root[data-dash-uniform] .tiles-focus-grid'), 'uni : la zone des tuiles agrandies aussi');
    assert.strictEqual(rule(':root[data-dash-uniform]').decls['--dash-tile-surface'], 'var(--bg)');
    assert.ok(read('js', 'charts.js').includes("cssVar('--dash-tile-surface', '') || cssVar('--surface'"), 'chartTheme lit le fond réel de la tuile (uni)');
    assert.ok(read('js', 'main.js').includes("'--dash-tile-surface'"), 'watchChartTheme suit ce jeton');
    // Aucune option ne fixe de hauteur : piège n°8.
    for (const r of dashRules.filter((x) => x.selector.includes('data-dash-uniform'))) assert.strictEqual(r.decls.height, undefined, r.selector);
  }
  // « Sans bordure » + « uni » : la règle GAGNANTE de l'ombre d'une tuile est `none`, au repos, au survol et agrandie, pour chaque style (retour
  // d'Antoine du 18/11/2026 : « ce n'est toujours pas uni, des sortes d'ombres dessinent les carrés » — les règles de l'ombre de « sans bordure »
  // sont plus spécifiques que celle d'« uni » et la battaient). On rejoue la cascade : sélecteurs de la forme `:root` + [attr] / :not([attr]) +
  // ` .tile` (+ `.tile-zoomed` / `:hover`), spécificité = nombre de jetons, à égalité la règle écrite en dernier.
  {
    const parts = (sel) => {
      const m = /^(:root(?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*) (\.tile(?:\.tile-zoomed)?(?::hover)?)$/.exec(sel.trim());
      if (!m) return null;
      const conds = (m[1].slice(':root'.length).match(/:not\(\[[^\]]+\]\)|\[[^\]]+\]/g) || []);
      return { conds, tail: m[2] };
    };
    const winner = (attrs, zoomed, hover) => {
      let best = null;
      dashRules.forEach((r, order) => {
        if (r.media !== null || r.decls['box-shadow'] === undefined) return;
        for (const sel of r.selector.split(',')) {
          const p = parts(sel);
          if (!p) continue;
          const ok = p.conds.every((c) => {
            const neg = c.startsWith(':not(');
            const inner = neg ? c.slice(5, -1) : c;
            const mm = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(inner);
            const has = Object.prototype.hasOwnProperty.call(attrs, mm[1]) && (mm[2] === undefined || attrs[mm[1]] === mm[2]);
            return neg ? !has : has;
          });
          if (!ok) continue;
          if (p.tail.includes('.tile-zoomed') && !zoomed) continue;
          if (p.tail.includes(':hover') && !hover) continue;
          const spec = 1 + p.conds.length + 1 + (p.tail.includes('.tile-zoomed') ? 1 : 0) + (p.tail.includes(':hover') ? 1 : 0);
          if (!best || spec > best.spec || (spec === best.spec && order >= best.order)) best = { spec, order, value: r.decls['box-shadow'] };
        }
      });
      return best && best.value;
    };
    for (const style of [null, 'fluid', 'editorial', 'console', 'glass']) {
      const attrs = { 'data-dash-borders': 'none', 'data-dash-uniform': 'true' };
      if (style) attrs['data-dash-style'] = style;
      for (const [zoomed, hover] of [[false, false], [false, true], [true, false], [true, true]]) {
        assert.strictEqual(winner(attrs, zoomed, hover), 'none', `uni + sans bordure (${style || 'standard'}${zoomed ? ', agrandie' : ''}${hover ? ', survol' : ''}) : aucune ombre autour de la tuile`);
      }
    }
    // Le rejeu voit bien la règle qui posait le défaut : « sans bordure » seul garde son ombre.
    assert.notStrictEqual(winner({ 'data-dash-borders': 'none' }, false, false), 'none', 'sans bordure seul : ombre discrète conservée (Standard)');
    assert.notStrictEqual(winner({ 'data-dash-borders': 'none', 'data-dash-style': 'fluid' }, false, false), 'none', 'sans bordure seul : l\'ombre du style conservée');
    assert.strictEqual(winner({ 'data-dash-uniform': 'true' }, false, false), 'none', 'uni seul : aucune ombre');
  }
  // Les règles de tuile gardent `.tile.tile-zoomed` plus précis que les règles génériques : hauteur et police de l'agrandissement.
  {
    const css = read('css', 'dash-styles.css');
    assert.ok(/\.tile:not\(\.tile-zoomed\) \.tile-header/.test(css), 'titre : police propre hors agrandissement');
    assert.ok(!/\.tile\s*\{[^}]*\bheight\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'jamais de hauteur de tuile ici (piège n°8)');
    assert.ok(!/min-height/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'jamais de min-height');
  }
  console.log('OK styles — CSS : jetons complets en clair ET sombre, textes AA, pastille Standard = rendu standard, aucune règle sur la page en Standard');

  // --- 5. Store : setDashStyle ----------------------------------------------------------------------------------------------
  {
    const store = createStore();
    assert.strictEqual(store.getState().dashStyle, 'standard');
    let notified = 0;
    store.subscribe(() => notified++);
    store.setDashStyle('fluid');
    assert.strictEqual(store.getState().dashStyle, 'fluid');
    assert.strictEqual(notified, 1);
    store.setDashStyle('fluid');
    assert.strictEqual(notified, 1, 'même valeur : aucune notification, donc aucun rendu ni sauvegarde');
    // Mal formé -> Standard ; bien formé mais inconnu (version future) -> gardé tel quel (la sauvegarde ne le perd pas).
    for (const bad of ['', 'Fluid', 'a b', '1abc', 12, null, undefined, {}, 'x'.repeat(40), '<img>']) {
      store.setDashStyle('glass');
      store.setDashStyle(bad);
      assert.strictEqual(store.getState().dashStyle, 'standard', `valeur ${JSON.stringify(bad)}`);
    }
    store.setDashStyle('neon');
    assert.strictEqual(store.getState().dashStyle, 'neon');
    assert.strictEqual(styles.normalizeStyleId(store.getState().dashStyle), 'standard', 'un id inconnu s\'affiche en Standard');
    // Réglage du tableau de bord : ni une vue sauvegardée, ni une page, ni un filtre n'y touchent.
    store.setDashStyle('editorial');
    store.saveBookmark('b1', 'Vue');
    store.applyBookmark('b1');
    store.addPage('p2', 'Page 2');
    store.setCurrentPage('p2');
    store.toggleFilter('Region', 'Nord', 't1');
    store.clearFilter();
    assert.strictEqual(store.getState().dashStyle, 'editorial');
    const bm = store.getState().bookmarks[0];
    assert.ok(!('dashStyle' in bm) && !('style' in bm), 'une vue sauvegardée ne porte pas le style');
    // Options d'affichage : objet vide par défaut, une référence NEUVE à chaque changement (render() les compare par référence pour décider
    // d'une sauvegarde), aucune notification si rien ne change, seules les valeurs `true` des clés connues retenues.
    const opts = createStore();
    let n = 0;
    opts.subscribe(() => n++);
    const initial = opts.getState().dashStyleOptions;
    assert.deepStrictEqual(initial, {});
    opts.setDashStyleOptions({ hideBorders: true });
    assert.deepStrictEqual(opts.getState().dashStyleOptions, { hideBorders: true });
    assert.strictEqual(n, 1);
    const first = opts.getState().dashStyleOptions;
    opts.setDashStyleOptions({ hideBorders: true });
    opts.setDashStyleOptions({ hideBorders: true, uniform: false, evil: true });
    assert.strictEqual(n, 1, 'même contenu : aucune notification, donc aucune sauvegarde');
    assert.strictEqual(opts.getState().dashStyleOptions, first, 'même référence tant que rien ne change');
    opts.setDashStyleOptions({ hideBorders: true, uniform: true });
    assert.deepStrictEqual(opts.getState().dashStyleOptions, { hideBorders: true, uniform: true });
    assert.notStrictEqual(opts.getState().dashStyleOptions, first, 'référence neuve au changement');
    assert.strictEqual(n, 2);
    for (const bad of [null, undefined, 'uniform', 12, [], { uniform: 'true' }, { uniform: 1 }, { __proto__: { uniform: true } }]) {
      opts.setDashStyleOptions({ uniform: true });
      opts.setDashStyleOptions(bad);
      assert.deepStrictEqual(opts.getState().dashStyleOptions, {}, `valeur ${JSON.stringify(bad)}`);
    }
    // Indépendantes du style, des vues et des pages ; une vue sauvegardée ne les porte pas.
    opts.setDashStyleOptions({ uniform: true });
    opts.setDashStyle('console');
    opts.setDashStyle('standard');
    opts.saveBookmark('b1', 'Vue');
    opts.applyBookmark('b1');
    opts.addPage('p2', 'Page 2');
    opts.setCurrentPage('p2');
    assert.deepStrictEqual(opts.getState().dashStyleOptions, { uniform: true });
    assert.ok(!('dashStyleOptions' in opts.getState().bookmarks[0]) && !('styleOptions' in opts.getState().bookmarks[0]));
    console.log('OK styles — store : défaut, notification, valeurs mal formées, id inconnu conservé, indépendant des vues, options (référence neuve, rien si inchangé)');
  }

  // --- 6. Configuration : aller-retour par grist-api.js (vrai module, faux `grist`) ---------------------------------------------
  {
    const source = read('js', 'grist-api.js');
    const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; } };
    sandbox.window = sandbox;
    sandbox.GristBI = { data, i18n, state: { DEFAULT_PAGE_ID: 'page_default' } };
    const cfg = { id: [], TableId: [], ConfigJSON: [], Nom: [], TypeRapport: [], DateModif: [], ModifiePar: [] };
    const actions = [];
    sandbox.grist = { docApi: {
      listTables: async () => ['BI_Dashboard_Config'],
      fetchTable: async () => JSON.parse(JSON.stringify(cfg)),
      applyUserActions: async (list) => {
        const out = { retValues: [] };
        list.forEach((a) => {
          actions.push(a);
          if (a[0] === 'AddRecord') {
            const id = cfg.id.length + 1;
            cfg.id.push(id);
            Object.keys(cfg).filter((k) => k !== 'id').forEach((k) => cfg[k].push(a[3][k] !== undefined ? a[3][k] : ''));
            out.retValues.push(id);
          } else if (a[0] === 'UpdateRecord') {
            const i = cfg.id.indexOf(a[2]);
            Object.keys(a[3]).forEach((k) => { cfg[k][i] = a[3][k]; });
            out.retValues.push(null);
          } else out.retValues.push(null);
        });
        return out;
      }
    } };
    vm.runInNewContext(source, sandbox);
    const api = sandbox.GristBI.api;
    const pages = [{ id: 'page_default', name: 'Page 1', tiles: [{ id: 't1', type: 'bar' }] }];
    const stored = () => JSON.parse(cfg.ConfigJSON[cfg.ConfigJSON.length - 1]);
    const plain = (x) => JSON.parse(JSON.stringify(x)); // les objets d'un contexte vm n'ont pas le prototype d'ici

    assert.strictEqual((await api.loadConfig('T')).style, 'standard', 'document sans configuration');
    assert.strictEqual(api.blankConfig().style, 'standard');
    assert.deepStrictEqual(plain(api.blankConfig().styleOptions), {}, 'rapport vierge : aucune option');
    assert.deepStrictEqual(plain((await api.loadConfig('T')).styleOptions), {});

    // Standard : rien d'écrit — une configuration sans choix reste identique à celle d'avant ce réglage.
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard');
    assert.ok(!('style' in stored()), 'Standard : aucune clé style');
    assert.deepStrictEqual(Object.keys(stored()), ['pages', 'currentPageId', 'bookmarks', 'blend']);
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, undefined);
    assert.ok(!('style' in stored()), 'style absent : Standard');

    // Un style choisi est écrit, relu, puis effacé par le retour au Standard.
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'fluid');
    assert.strictEqual(stored().style, 'fluid');
    assert.strictEqual((await api.loadConfig('T')).style, 'fluid');
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard');
    assert.ok(!('style' in stored()), 'retour au Standard : la clé disparaît');
    assert.strictEqual((await api.loadConfig('T')).style, 'standard');

    // Un id bien formé mais inconnu de ce widget (version future) traverse l'aller-retour ; un texte mal formé est ignoré.
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'neon');
    assert.strictEqual((await api.loadConfig('T')).style, 'neon');
    for (const bad of ['Fluid', 'a b', '<img src=x>', 12, {}, ['fluid'], 'x'.repeat(40)]) {
      await api.saveConfig('T', pages, 'page_default', [], null, null, null, bad);
      assert.ok(!('style' in stored()), `valeur ${JSON.stringify(bad)} non écrite`);
    }

    // Les trois formats historiques (tableau de tuiles, { tiles, bookmarks }, pages sans style) se lisent en Standard.
    const row = (json) => { cfg.ConfigJSON[0] = json; };
    for (const legacy of [
      JSON.stringify([{ id: 't1', type: 'bar' }]),
      JSON.stringify({ tiles: [{ id: 't1' }], bookmarks: [] }),
      JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], blend: null }),
      '{ce n\'est pas du JSON', ''
    ]) {
      row(legacy);
      const loaded = await api.loadConfig('T');
      assert.strictEqual(loaded.style, 'standard', `ancien format ${legacy.slice(0, 30)}`);
      assert.ok(loaded.pages.length >= 1);
    }
    // Un style lu d'une ligne (y compris sans pages : ancien format + style) ne casse pas la lecture.
    row(JSON.stringify({ tiles: [], bookmarks: [], style: 'neon' }));
    assert.strictEqual((await api.loadConfig('T')).style, 'neon');
    // Un style RETIRÉ (`factory`, `dense`, 18/11/2026) est un id bien formé que ce widget ne connaît plus : il s'affiche en Standard SANS
    // être effacé — la sauvegarde suivante le réécrit tel quel (pas de perte silencieuse du choix fait par une version précédente).
    for (const removed of ['factory', 'dense']) {
      row(JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], style: removed }));
      const loaded = await api.loadConfig('T');
      assert.strictEqual(loaded.style, removed);
      assert.strictEqual(styles.normalizeStyleId(loaded.style), 'standard', `${removed} : affiché en Standard`);
      await api.saveConfig('T', pages, 'page_default', [], null, null, null, loaded.style);
      assert.strictEqual(stored().style, removed, `${removed} : conservé à la sauvegarde`);
    }
    row(JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], style: 'Pas valide !' }));
    assert.strictEqual((await api.loadConfig('T')).style, 'standard', 'config éditée à la main avec un style hostile : Standard');

    // Options d'affichage (`styleOptions`) : le champ n'existe que si une option est cochée, ne contient que celles-là, se relit à l'identique.
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', {});
    assert.deepStrictEqual(Object.keys(stored()), ['pages', 'currentPageId', 'bookmarks', 'blend'], 'aucune option : configuration identique à celle d\'avant');
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', { hideBorders: false, uniform: false });
    assert.ok(!('styleOptions' in stored()), 'options décochées : rien d\'écrit');
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', { uniform: true, evil: true, hideBorders: 'oui' });
    assert.deepStrictEqual(stored().styleOptions, { uniform: true }, 'seule la valeur true d\'une clé connue est écrite');
    assert.deepStrictEqual(Object.keys(stored()), ['pages', 'currentPageId', 'bookmarks', 'blend', 'styleOptions'], 'Standard + option : pas de clé style');
    assert.deepStrictEqual(plain((await api.loadConfig('T')).styleOptions), { uniform: true });
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'glass', { hideBorders: true, uniform: true });
    assert.strictEqual(stored().style, 'glass');
    assert.deepStrictEqual(stored().styleOptions, { hideBorders: true, uniform: true });
    const both = await api.loadConfig('T');
    assert.strictEqual(both.style, 'glass');
    assert.deepStrictEqual(plain(both.styleOptions), { hideBorders: true, uniform: true });
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard');
    assert.ok(!('styleOptions' in stored()), 'sans le paramètre : rien d\'écrit');
    // Lecture : anciens formats et lignes éditées à la main -> aucune option ; une valeur hostile n'entre jamais dans l'état.
    for (const raw of [
      JSON.stringify([{ id: 't1' }]), JSON.stringify({ tiles: [], bookmarks: [] }), JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [] }),
      JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], styleOptions: 'uniform' }),
      JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], styleOptions: ['uniform'] }),
      JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], styleOptions: { uniform: 'true', hideBorders: 1 } }),
      JSON.stringify({ tiles: [], styleOptions: null }), '{pas du json'
    ]) {
      row(raw);
      assert.deepStrictEqual(plain((await api.loadConfig('T')).styleOptions), {}, raw.slice(0, 50));
    }
    row(JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], styleOptions: { hideBorders: true, evil: true, '__proto__': { uniform: true } } }));
    assert.deepStrictEqual(plain((await api.loadConfig('T')).styleOptions), { hideBorders: true }, 'clé inconnue ignorée');
    row(JSON.stringify({ tiles: [], bookmarks: [], styleOptions: { uniform: true } }));
    assert.deepStrictEqual(plain((await api.loadConfig('T')).styleOptions), { uniform: true }, 'ancien format + options');
    console.log('OK styles — configuration : Standard jamais écrit, aller-retour, id inconnu conservé (factory/dense compris), valeur hostile ignorée, anciens formats en Standard, styleOptions écrit seulement s\'il en faut un');
  }

  // --- 7. Câblage : index.html et harnais -------------------------------------------------------------------------------------
  {
    for (const [file, prefix] of [['index.html', ''], [path.join('dev-tests', 'harness.html'), '../']]) {
      const html = read(file);
      assert.ok(html.includes(`<link rel="stylesheet" href="${prefix}css/dash-styles.css"`), `${file} : feuille de styles`);
      const css = html.indexOf('css/style.css');
      assert.ok(css !== -1 && css < html.indexOf('css/dash-styles.css'), `${file} : dash-styles.css APRÈS style.css`);
      const tag = html.indexOf(`<script src="${prefix}js/styles.js"></script>`);
      assert.ok(tag !== -1, `${file} : script js/styles.js`);
      const scriptAt = (name) => html.indexOf(`<script src="${prefix}js/${name}"></script>`);
      assert.ok(scriptAt('charts.js') > tag && scriptAt('main.js') > tag, `${file} : styles.js chargé avant charts.js et main.js`);
      assert.ok(html.includes('id="settings-style-options"'), `${file} : conteneur des cartes de style`);
      assert.ok(/<div class="settings-section" id="settings-style-section">/.test(html) && !/id="settings-style-section"[^>]*edit-only/.test(html), `${file} : section visible en Lecture comme en Édition (même menu Réglages)`);
    }
    const main = read('js', 'main.js');
    assert.ok(main.includes('GristBI.styles.apply(state.dashStyle)'), 'render() pose le style avant de dessiner les tuiles');
    assert.ok(main.includes('store.setDashStyle(saved.style)'), 'le chargement d\'un rapport pose son style');
    assert.ok(/scheduleSave\(state\.pages, state\.currentPageId, state\.bookmarks, state\.blend, state\.dashStyle, state\.dashStyleOptions\)/.test(main), 'un changement de style ou d\'option planifie la sauvegarde');
    assert.ok(main.includes('state.dashStyle !== lastRenderedDashStyle'), 'et un changement de style est détecté par render()');
    assert.ok(main.includes('GristBI.styles.applyOptions(state.dashStyleOptions)'), 'render() pose les options avant de dessiner les tuiles');
    assert.ok(main.includes('state.dashStyleOptions !== lastRenderedDashStyleOptions'), 'et un changement d\'option est détecté par render()');
    assert.ok(main.includes('store.setDashStyleOptions(saved.styleOptions)'), 'le chargement d\'un rapport pose ses options (absentes d\'un ancien rapport : aucune)');
    assert.ok(/p\.authorLabel, p\.dashStyle, p\.dashStyleOptions\)/.test(main), 'la sauvegarde planifiée écrit les options capturées au moment du geste');
    // Les cases à cocher : dans les Réglages (section Édition), liées au store.
    for (const file of ['index.html', path.join('dev-tests', 'harness.html')]) {
      const html = read(file);
      for (const id of ['settings-opt-hideBorders', 'settings-opt-uniform']) assert.ok(html.includes(`<input type="checkbox" id="${id}">`), `${file} : case ${id}`);
      assert.ok(html.indexOf('settings-opt-uniform') > html.indexOf('id="settings-style-section"') && html.indexOf('settings-opt-uniform') < html.indexOf('settings.credits.title'), `${file} : les options (désormais sous le choix de disposition, dont elles ne valent que pour la grille) précèdent les Crédits`);
    }
    assert.ok(/store\.setDashStyleOptions\(Object\.assign\(\{\}, store\.getState\(\)\.dashStyleOptions, \{ \[key\]: input\.checked \}\)\)/.test(main), 'une case coche/décoche son option dans le store');
    // Les trois listes de clés (js/styles.js, js/state.js, js/grist-api.js) ne doivent jamais diverger.
    const keysIn = (file, name) => JSON.parse(read('js', file).match(new RegExp(`${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
    assert.deepStrictEqual(keysIn('state.js', 'DASH_STYLE_OPTION_KEYS'), styles.OPTION_KEYS);
    assert.deepStrictEqual(keysIn('grist-api.js', 'STYLE_OPTION_KEYS'), styles.OPTION_KEYS);
    const charts = read('js', 'charts.js');
    assert.ok(charts.includes('GristBI.styles.applyToOption(option, GristBI.styles.current(), th)'), 'finalizeOption applique le style en dernier');
    console.log('OK styles — câblage : index.html et harnais (feuille, script, section Édition), render/chargement/sauvegarde, finalizeOption');
  }

  console.log('\nTous les tests du style global des tuiles sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
