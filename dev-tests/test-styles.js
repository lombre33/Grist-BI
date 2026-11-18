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
 *  - le CSS : chaque style pose la liste COMPLÈTE de ses jetons dans un bloc clair ET un bloc sombre (un jeton oublié en sombre
 *    resterait clair : `:root[data-dash-style]` bat `:root`), contrastes AA des textes, jetons de `factory` = ceux du kit
 *    Grist Factory, pastille « Standard » = le rendu de css/style.css ;
 *  - le store (`setDashStyle`) et l'aller-retour de la configuration (`BI_Dashboard_Config`) : rien d'écrit pour Standard, anciens
 *    formats lus en Standard, valeur mal formée ignorée, id inconnu mais bien formé conservé ;
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

const NEW_STYLES = ['factory', 'fluid', 'dense', 'editorial'];
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
  for (const key of ['style.title', 'style.hint']) {
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
  console.log('OK styles — registre, clés fr/en, ids inconnus ou hostiles -> Standard, valeur écrite');

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
  console.log('OK styles — couleurs : lecture, mélange, teinte douce claire et sombre');

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

  // factory : barres arrondies en haut, axe des valeurs sans trait, quadrillage plein, infobulle arrondie.
  {
    const o = styles.applyToOption(barOption(5), styles.STYLES.factory, TH);
    assert.deepStrictEqual(o.series[0].itemStyle.borderRadius, [4, 4, 0, 0]);
    assert.strictEqual(o.series[0].barMaxWidth, 44);
    assert.strictEqual(o.yAxis.axisLine.show, false);
    assert.strictEqual(o.xAxis.axisLine.show, true);
    assert.strictEqual(o.yAxis.splitLine.show, true);
    assert.strictEqual(o.yAxis.splitLine.lineStyle.type, 'solid');
    assert.ok(/border-radius: 8px;$/.test(o.tooltip.extraCssText) && o.tooltip.extraCssText.startsWith('max-width: 85%'), o.tooltip.extraCssText);
    assert.strictEqual(o.series[0].label, undefined, 'factory n\'écrit pas de valeurs');
    assert.strictEqual(o.series[0].itemStyle.color, undefined, 'factory ne teinte pas');
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
    const dense = styles.applyToOption(makeCombo(), styles.STYLES.dense, TH);
    assert.strictEqual(dense.yAxis[1].splitLine.show, false, 'quadrillage que le rendu a masqué : reste masqué');
    assert.strictEqual(dense.yAxis[0].splitLine.show, true);

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
  // dense : barres droites, quadrillage et traits d'axe, graduations.
  {
    const o = styles.applyToOption(barOption(5), styles.STYLES.dense, TH);
    assert.strictEqual(o.series[0].itemStyle.borderRadius, undefined);
    assert.strictEqual(o.xAxis.axisLine.show, true);
    assert.strictEqual(o.yAxis.axisLine.show, true);
    assert.strictEqual(o.xAxis.axisTick.show, true);
    assert.strictEqual(o.yAxis.axisLabel.fontSize, 10.5);
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
    assert.strictEqual(o.series[0].smooth, true);
    assert.strictEqual(o.series[0].lineStyle.width, 3);
    assert.strictEqual(o.series[0].symbol, 'circle', 'repère gardé');
    assert.strictEqual(o.series[0].symbolSize, 8);
    assert.deepStrictEqual(o.series[0].itemStyle, { borderColor: '#ffffff', borderWidth: 2 });
    assert.strictEqual(o.series[0].areaStyle.opacity, 0.16);
    assert.strictEqual(o.series[1].areaStyle.opacity, 0.65, 'aire empilée : opacité du rendu gardée');
    const d = styles.applyToOption(lineOption([{ type: 'line', data: [1, 2, 3] }]), styles.STYLES.dense, TH);
    assert.strictEqual(d.series[0].smooth, undefined, 'dense ne lisse pas');
    assert.strictEqual(d.series[0].symbolSize, 5);
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

  for (const id of NEW_STYLES) {
    const light = tokenBlock(id, false);
    const dark = tokenBlock(id, true);
    assert.ok(light, `${id} : bloc clair`);
    assert.ok(dark, `${id} : bloc sombre`);
    assert.ok(light.selector.includes(`:root[data-dash-style="${id}"]`) && dark.selector.includes(`:root[data-dash-style="${id}"]`), `${id} : le même bloc sert la page et la pastille`);
    for (const t of COLOR_TOKENS.concat(SHAPE_TOKENS)) assert.ok(light.decls[t] !== undefined, `${id} : ${t} manque en clair`);
    // Un jeton de COULEUR posé en clair doit l'être en sombre aussi, sinon il resterait clair (`:root[data-dash-style]` bat `:root`).
    for (const t of COLOR_TOKENS) assert.ok(dark.decls[t] !== undefined, `${id} : ${t} manque en SOMBRE`);
    assert.ok(dark.decls['--dash-shadow'] !== undefined || /none|^0px?$/.test(light.decls['--dash-shadow']) || id === 'editorial', `${id} : ombres du mode sombre`);
    // Contrastes (WCAG AA : 4,5:1) des trois textes sur les trois fonds, dans chaque mode.
    for (const [mode, block] of [['clair', light], ['sombre', dark]]) {
      const tokens = Object.assign({}, mode === 'sombre' ? light.decls : {}, block.decls);
      for (const text of ['--text', '--text-secondary', '--text-muted']) {
        for (const bg of ['--surface', '--surface-sunken', '--bg']) {
          const ratio = wcag(hex(tokens[text]), hex(tokens[bg]));
          assert.ok(ratio >= 4.5, `${id} ${mode} : ${text} sur ${bg} = ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.ok(/--dash-bw:\s*2px 0 0 0/.test(tokenBlock('editorial', false).decls['--dash-bw'] ? `--dash-bw: ${tokenBlock('editorial', false).decls['--dash-bw']}` : ''), 'editorial : un filet en tête de carte seulement');

  // `factory` = les jetons du kit Grist Factory (kit/css/tokens.css), quand le sous-module est là.
  const kitPath = path.join(ROOT, 'kit', 'css', 'tokens.css');
  if (fs.existsSync(kitPath)) {
    const kit = parseCss(fs.readFileSync(kitPath, 'utf8'));
    const kitLight = kit.find((r) => r.media === null && r.selector === ':root');
    const kitDark = kit.find((r) => r.media === null && r.selector.startsWith(':root[data-theme="dark"]'));
    const map = { '--bg': '--bg', '--surface': '--surface', '--surface-sunken': '--surface-sunken', '--border': '--border', '--border-strong': '--border-strong', '--text': '--text', '--text-muted': '--text-muted', '--accent': '--accent' };
    for (const [token, kitToken] of Object.entries(map)) {
      assert.strictEqual(tokenBlock('factory', false).decls[token].toLowerCase(), kitLight.decls[kitToken].toLowerCase(), `factory clair ${token} = kit`);
      assert.strictEqual(tokenBlock('factory', true).decls[token].toLowerCase(), kitDark.decls[kitToken].toLowerCase(), `factory sombre ${token} = kit`);
    }
    console.log('OK styles — factory reprend les jetons de kit/css/tokens.css (clair et sombre)');
  } else {
    console.log('-- kit/ absent (sous-module non initialisé) : accord factory/kit non vérifié');
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
    // Et le Standard n'a AUCUNE règle sur la page : tout ce qui touche <html> passe par `[data-dash-style]`, que `standard` ne pose pas.
    const onPage = dashRules.filter((r) => r.selector.split(',').some((s) => /^:root(?!\[data-dash-style)/.test(s.trim()) && !s.includes('.style-swatch')));
    assert.deepStrictEqual(onPage.map((r) => r.selector), [], 'aucune règle de dash-styles.css hors `:root[data-dash-style…]`');
    assert.ok(!dashRules.some((r) => r.selector.includes('data-dash-style="standard"') && r.selector.includes(':root')), 'pas de règle :root pour standard');
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
      store.setDashStyle('dense');
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
    console.log('OK styles — store : défaut, notification, valeurs mal formées, id inconnu conservé, indépendant des vues');
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

    assert.strictEqual((await api.loadConfig('T')).style, 'standard', 'document sans configuration');
    assert.strictEqual(api.blankConfig().style, 'standard');

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
    row(JSON.stringify({ tiles: [], bookmarks: [], style: 'dense' }));
    assert.strictEqual((await api.loadConfig('T')).style, 'dense');
    row(JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], style: 'Pas valide !' }));
    assert.strictEqual((await api.loadConfig('T')).style, 'standard', 'config éditée à la main avec un style hostile : Standard');
    console.log('OK styles — configuration : Standard jamais écrit, aller-retour, id inconnu conservé, valeur hostile ignorée, anciens formats en Standard');
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
      assert.ok(/id="settings-style-section"[^>]*class="[^"]*edit-only|class="[^"]*edit-only[^"]*"[^>]*id="settings-style-section"/.test(html), `${file} : section réservée à l'Édition`);
    }
    const main = read('js', 'main.js');
    assert.ok(main.includes('GristBI.styles.apply(state.dashStyle)'), 'render() pose le style avant de dessiner les tuiles');
    assert.ok(main.includes('store.setDashStyle(saved.style)'), 'le chargement d\'un rapport pose son style');
    assert.ok(/scheduleSave\(state\.pages, state\.currentPageId, state\.bookmarks, state\.blend, state\.dashStyle\)/.test(main), 'un changement de style planifie la sauvegarde');
    assert.ok(main.includes('state.dashStyle !== lastRenderedDashStyle'), 'et il est détecté par render()');
    const charts = read('js', 'charts.js');
    assert.ok(charts.includes('GristBI.styles.applyToOption(option, GristBI.styles.current(), th)'), 'finalizeOption applique le style en dernier');
    console.log('OK styles — câblage : index.html et harnais (feuille, script, section Édition), render/chargement/sauvegarde, finalizeOption');
  }

  console.log('\nTous les tests du style global des tuiles sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
