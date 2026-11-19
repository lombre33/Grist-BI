/*
 * Essais du DESSIN du module graphique commun (js/graphique/ : formats de nombres, palettes, séries, option ECharts, image hors écran, modèle Office, vue montée). Sans navigateur : ECharts est
 * remplacé par un faux qui note ce qu'on lui demande (init, setOption, dispose, toiles) ; la comparaison pixel à pixel avec le dessin de Grist BI est dans dev-tests/test-graphique-navigateur.js.
 *  - palettes et formats de nombres COMPARÉS à ceux de Grist BI (js/data.js, js/format.js) sur une grille de valeurs et de réglages ;
 *  - séries : ordre d'apparition, tris, séries découpées, « aucun », trous jamais 0, colonnes dérivées d'une date ;
 *  - option ECharts : ce que chaque forme pose (légende, pile, escalier, anneau, parts), le thème, l'échappement des noms ;
 *  - refus à codes stables (dessin, invalide, v1, colonne, vide, volume, moteur, element) et leur ordre ;
 *  - image hors écran : taille, libération de l'instance ET des toiles, élément réutilisable, panne du moteur ;
 *  - vue : `mettre` à arguments identiques ne redessine rien, refus efface, clic -> rangs de la source (échantillon compris), `detruire` idempotent ;
 *  - modèle Office : types, pile, format Excel écrit tel quel, `image-seule`.
 * `node dev-tests/test-graphique-dessin.js`
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const DOSSIER = path.join(__dirname, '..', 'js', 'graphique');
const charger = (nom) => import(pathToFileURL(path.join(DOSSIER, nom)).href);

// --- Un faux ECharts : il note, il ne dessine pas ----------------------------------------------------------------------------------
function fauxElement() {
  return { canvases: [{ width: 640, height: 400 }, { width: 640, height: 400 }], querySelectorAll(sel) { return sel === 'canvas' ? this.canvases : []; } };
}
function fauxEcharts(options = {}) {
  const journal = { inits: [], instances: [], rendus: [] };
  const echarts = {
    journal,
    init(element, theme, opts) {
      if (options.initEchoue) throw new Error('init refusé');
      if (element.instance) throw new Error('instance déjà initialisée sur cet élément');
      const i = {
        element, opts, option: null, options: [], disposes: 0, clears: 0, resizes: 0, handlers: {}, largeur: (opts && opts.width) || 500, hauteur: (opts && opts.height) || 300,
        setOption(o, sans) { if (options.setOptionEchoue) throw new Error('setOption refusé'); this.option = o; this.options.push([o, sans]); },
        clear() { this.clears += 1; this.option = null; },
        dispose() { this.disposes += 1; element.instance = null; },
        on(nom, f) { this.handlers[nom] = f; },
        off(nom) { delete this.handlers[nom]; },
        resize() { this.resizes += 1; },
        getWidth() { return this.largeur; },
        getHeight() { return this.hauteur; },
        getDataURL(o) { this.dernierGetDataURL = o; return 'data:image/png;base64,ECRAN'; },
        renderToCanvas(o) { const toile = { width: 100, height: 100, options: o, toDataURL: (type) => `data:${type};base64,TOILE` }; journal.rendus.push(toile); return toile; },
      };
      element.instance = i;
      journal.inits.push(i);
      journal.instances.push(i);
      return i;
    },
  };
  return echarts;
}

const LIGNES = [
  { Region: 'Nord', Mois: 'Jan', Annee: 2023, Produit: 'A', Montant: 100, Date: '2023-01-15' },
  { Region: 'Nord', Mois: 'Fev', Annee: 2023, Produit: 'B', Montant: 50, Date: '2023-02-10' },
  { Region: 'Sud', Mois: 'Jan', Annee: 2024, Produit: 'A', Montant: 300, Date: '2024-01-05' },
  { Region: 'Sud', Mois: 'Fev', Annee: 2024, Produit: 'B', Montant: 20, Date: '2024-03-20' },
  { Region: 'Est', Mois: 'Jan', Annee: 2024, Produit: 'A', Montant: null, Date: '2024-04-02' },
];
const COLONNES = [
  { id: 'Region', genre: 'text' }, { id: 'Mois', genre: 'text' }, { id: 'Annee', genre: 'number' }, { id: 'Produit', genre: 'text' },
  { id: 'Montant', genre: 'number' }, { id: 'Date', genre: 'date' },
];
const source = (lignes = LIGNES, extra = {}) => ({ lignes, colonnes: COLONNES, reglages: { locale: 'fr-FR', currency: 'EUR' }, ...extra });
const barres = (extra = {}) => ({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', ...extra });

(async () => {
  const m = await import(pathToFileURL(path.join(DOSSIER, 'index.js')).href);
  const { couleursDePalette, PALETTES } = await charger('palettes.js');
  const { creerFormateur, formateurDe, formatOffice } = await charger('nombres.js');
  const { preparer, SEUILS_VOLUME } = await charger('plan.js');
  const { construireOption } = await charger('option.js');
  const { calculerCartesien, avecDerivees } = await charger('serie.js');
  const { THEME_CLAIR, themeComplet } = await charger('habillage.js');
  const data = require('../js/data.js');
  const format = require('../js/format.js');
  const theme = THEME_CLAIR;

  // --- Palettes --------------------------------------------------------------------------------------------------------------
  {
    assert.deepStrictEqual(PALETTES, JSON.parse(JSON.stringify(data.PALETTES)), 'les palettes du module sont celles de Grist BI');
    assert.deepStrictEqual(couleursDePalette('grist'), data.PALETTES.standard, '`grist` = standard');
    assert.deepStrictEqual(couleursDePalette('grist-okabe'), data.PALETTES.okabe, '`grist-<nom>`');
    assert.deepStrictEqual(couleursDePalette('green'), data.PALETTES.green, 'un nom nu de Grist BI se lit aussi');
    for (const inconnu of ['rose', undefined, null, 42, '__proto__', 'constructor', 'grist-']) assert.deepStrictEqual(couleursDePalette(inconnu), data.PALETTES.standard, `inconnue : ${String(inconnu)} -> standard`);
    console.log('OK palettes — identiques à js/data.js, `grist`/`grist-<nom>`, inconnues et pièges de prototype -> standard');
  }

  // --- Formats de nombres : comparés à js/format.js ---------------------------------------------------------------------------------
  {
    const valeurs = [0, 1, 7, 42, 99.5, 100, 123.456, 999.9, 1000, 1234.5678, 12345.678, 1542980.8799999997, 9.99e11, 1e12, 3.2e13, 0.5, 0.05, 0.0006, 0.000123, -3, -1234.5, -0.0001, null, undefined, '', 'abc', NaN, 12n];
    const reglages = [
      { mode: 'auto' }, undefined, { mode: 'inconnu' },
      { mode: 'custom', decimals: 'auto', notation: 'standard' }, { mode: 'custom', decimals: 0, notation: 'standard' }, { mode: 'custom', decimals: 2, notation: 'standard' },
      { mode: 'custom', decimals: 1, notation: 'compact' }, { mode: 'custom', decimals: 'auto', notation: 'compact' }, { mode: 'custom', decimals: 9, notation: 'standard' },
      { mode: 'column' },
    ];
    const colonnesFormat = [
      null, {}, { decimals: 2 }, { decimals: 1, maxDecimals: 3 }, { maxDecimals: 4 }, { numMode: 'currency', currency: 'USD' }, { numMode: 'currency' }, { numMode: 'currency', currency: 'EUR', decimals: 0 },
      { numMode: 'percent' }, { numMode: 'percent', decimals: 1 }, { numMode: 'scientific' }, { numMode: 'scientific', decimals: 2 }, { decimals: 2, numSign: 'parens' }, { numMode: 'decimal' },
    ];
    let compares = 0;
    for (const langue of ['fr', 'en']) {
      for (const reglage of reglages) {
        for (const f of colonnesFormat) {
          const col = f === null ? null : { type: 'Numeric', widgetOptions: JSON.stringify(f) };
          format.setColumnInfo(col ? { Montant: col } : {}, { locale: 'fr-FR', currency: 'EUR' });
          const attendu = format.forTile({ numberFormat: reglage, aggFn: 'sum' }, 'Montant', langue);
          const src = { colonnes: f === null ? [] : [{ id: 'Montant', genre: 'number', format: f }], reglages: { locale: 'fr-FR', currency: 'EUR' } };
          const obtenu = formateurDe({ numberFormat: reglage, aggFn: 'sum' }, 'Montant', src, langue);
          for (const v of valeurs) {
            for (const nom of ['format', 'axis', 'percent']) {
              assert.strictEqual(obtenu[nom](v), nom === 'format' && v === 12n ? attendu[nom](v) : attendu[nom](v), `${nom}(${String(v)}) ${langue} ${JSON.stringify(reglage)} ${JSON.stringify(f)}`);
              compares += 1;
            }
          }
        }
      }
    }
    // Un comptage n'a jamais le format de la colonne ; une locale inutilisable retombe sur la langue.
    format.setColumnInfo({ Montant: { type: 'Numeric', widgetOptions: JSON.stringify({ numMode: 'currency', currency: 'EUR' }) } }, null);
    const comptage = formateurDe({ numberFormat: { mode: 'column' }, aggFn: 'count' }, 'Montant', { colonnes: [{ id: 'Montant', genre: 'number', format: { numMode: 'currency', currency: 'EUR' } }] }, 'fr');
    assert.strictEqual(comptage.format(1234), format.forTile({ numberFormat: { mode: 'column' }, aggFn: 'count' }, 'Montant', 'fr').format(1234), 'un comptage ne prend pas le format de la colonne');
    assert.doesNotThrow(() => formateurDe({ numberFormat: { mode: 'column' } }, 'Montant', { colonnes: [{ id: 'Montant', genre: 'number', format: { numMode: 'currency', currency: 'EUR' } }], reglages: { locale: 'xx-INCONNUE-zz' } }, 'fr').format(12));
    assert.doesNotThrow(() => formateurDe({ numberFormat: { mode: 'column' } }, 'Montant', { colonnes: [{ id: 'Montant', genre: 'text', format: { numMode: 'currency' } }] }, 'fr').format(12), 'colonne de texte : Automatique');
    // Format Office : écrit tel quel, jamais tronqué ; rien quand il n'a pas d'équivalent.
    const code = (f, spec) => formatOffice(formateurDe({ numberFormat: spec || { mode: 'column' } }, 'Montant', { colonnes: [{ id: 'Montant', genre: 'number', format: f }], reglages: {} }, 'fr').style);
    assert.strictEqual(code({ numMode: 'currency', currency: 'EUR', decimals: 2 }), '#,##0.00 "EUR"');
    assert.strictEqual(code({ numMode: 'percent', decimals: 1, maxDecimals: 1 }), '0.0%');
    assert.strictEqual(code({ numMode: 'percent', decimals: 1 }), '0.0#########%', 'sans plafond de décimales Grist en accepte 10 : le format Excel dit la même chose, sans tronquer');
    assert.strictEqual(code({ decimals: 2, maxDecimals: 4 }), '#,##0.00##');
    assert.strictEqual(code({ decimals: 2, maxDecimals: 2, numSign: 'parens' }), '#,##0.00;(#,##0.00)');
    assert.strictEqual(code({}), undefined, 'Automatique : pas de format');
    assert.strictEqual(code({ numMode: 'scientific' }), undefined, 'scientifique : pas d\'équivalent');
    assert.strictEqual(code({}, { mode: 'custom', decimals: 1, notation: 'compact' }), undefined, 'compact : pas d\'équivalent');
    assert.strictEqual(code({}, { mode: 'custom', decimals: 3, notation: 'standard' }), '#,##0.000');
    console.log(`OK nombres — ${compares} formats comparés à js/format.js (auto, personnalisé, comme la colonne ; fr/en ; BigInt, vides, texte), un comptage sans format de colonne, format Office`);
  }

  // --- Séries ----------------------------------------------------------------------------------------------------------------
  {
    const genres = new Map(COLONNES.map((c) => [c.id, c.genre]));
    const un = (def, lignes = LIGNES) => calculerCartesien(m.lireDefinition(def).definition, avecDerivees(lignes, ['Region', 'Montant']), genres, 'fr');
    const base = un(barres());
    assert.deepStrictEqual(base.categories, ['Nord', 'Sud', 'Est'], 'ordre de première apparition');
    assert.deepStrictEqual(base.series[0].values, [150, 320, 0], 'somme ; la somme de rien vaut 0');
    const parGroupes = data.groupByAggregate(LIGNES.filter((l) => l.Montant !== null), 'Region', 'Montant', 'sum');
    assert.deepStrictEqual(parGroupes.map((g) => g.value), [150, 320], 'même résultat que groupByAggregate sans cellule vide');
    assert.deepStrictEqual(un(barres({ aggFn: 'avg' })).series[0].values, [75, 160, null], 'moyenne : une catégorie sans valeur est un trou, jamais 0');
    assert.deepStrictEqual(un(barres({ aggFn: 'count' })).series[0].values, [2, 2, 1], 'compter les lignes');
    assert.deepStrictEqual(un(barres({ sortMode: 'value-desc' })).categories, ['Sud', 'Nord', 'Est']);
    assert.deepStrictEqual(un(barres({ sortMode: 'value-asc' })).categories, ['Est', 'Nord', 'Sud']);
    assert.deepStrictEqual(un(barres({ sortMode: 'label' })).categories, ['Est', 'Nord', 'Sud']);
    assert.deepStrictEqual(un(barres({ aggFn: 'avg', sortMode: 'value-desc' })).categories, ['Sud', 'Nord', 'Est'], 'une valeur absente va toujours en dernier');
    assert.deepStrictEqual(un(barres({ dimension: 'Annee', sortMode: 'axis' })).categories, [2023, 2024], 'par abscisse : un nombre se trie comme un nombre');
    assert.deepStrictEqual(un(barres({ dimension: 'Mois', sortMode: 'axis' })).categories, ['Jan', 'Fev'], 'par abscisse : un axe de texte garde l\'ordre des lignes');
    // Séries découpées par une colonne.
    const serie = un(barres({ seriesColumn: 'Produit' }));
    assert.deepStrictEqual(serie.series.map((s) => s.name), ['A', 'B']);
    assert.deepStrictEqual(serie.series[0].values, [100, 300, 0], 'série A : Nord 100, Sud 300, Est 0 (une ligne vide)');
    assert.deepStrictEqual(serie.series[1].values, [50, 20, null], 'série B : pas de ligne en Est -> trou, pas 0');
    // Plusieurs mesures, couleur et type par série.
    const multi = un({ type: 'bar', dimension: 'Region', aggFn: 'sum', measures: [{ column: 'Montant' }, { column: 'Annee', aggFn: 'max', color: '#112233', type: 'line' }] });
    assert.deepStrictEqual(multi.series.map((s) => [s.name, s.couleur, s.type]), [['Montant', undefined, undefined], ['Annee', '#112233', 'line']]);
    assert.deepStrictEqual(multi.series[1].values, [2023, 2024, 2024]);
    // « aucun » : un point par ligne, doublons gardés, rangs.
    const aucun = un({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'none' });
    assert.strictEqual(aucun.categories.length, 5, 'une catégorie par ligne');
    assert.deepStrictEqual(aucun.series[0].values, [100, 50, 300, 20, null]);
    assert.deepStrictEqual(aucun.rangs, [[0], [1], [2], [3], [4]]);
    const triees = un({ type: 'line', dimension: 'Date', measure: 'Montant', aggFn: 'none', sortMode: 'axis' }, [LIGNES[3], LIGNES[0], LIGNES[2]]);
    assert.deepStrictEqual(triees.categories, ['2023-01-15', '2024-01-05', '2024-03-20'], 'dates triées par abscisse');
    assert.deepStrictEqual(triees.rangs, [[1], [2], [0]], 'le rang de chaque point reste celui de sa ligne');
    // Colonnes dérivées d'une date.
    const derivee = calculerCartesien(m.lireDefinition(barres({ dimension: 'Date.Annee', sortMode: 'axis' })).definition, avecDerivees(LIGNES, ['Date.Annee', 'Montant']), genres, 'fr');
    assert.deepStrictEqual(derivee.categories, [2023, 2024]);
    assert.deepStrictEqual(derivee.series[0].values, [150, 320]);
    assert.strictEqual(avecDerivees(LIGNES, ['Region']), LIGNES, 'sans dérivée : les mêmes lignes, aucune copie');
    const trimestres = avecDerivees([{ D: '2024-05-17T10:00:00' }, { D: 'pas une date' }, { D: null }], ['D.Trimestre']).map((l) => l['D.Trimestre']);
    assert.deepStrictEqual(trimestres, ['T2', null, null], 'trimestre d\'une date avec heure ; une cellule qui n\'est pas une date -> null');
    console.log('OK séries — apparition, tris (valeur, libellé, abscisse), séries découpées, plusieurs mesures, « aucun » et rangs, dérivées de date, trous jamais 0');
  }

  // --- Option ECharts --------------------------------------------------------------------------------------------------------
  {
    const plan = (def, src = source()) => { const p = preparer(def, src, 'fr'); assert.strictEqual(p.ok, true, JSON.stringify(p)); return p; };
    const opt = (def, extra = {}) => construireOption(plan(def), { theme, largeur: 480, animer: true, ...extra });
    const simple = opt(barres());
    assert.strictEqual(simple.series.length, 1);
    assert.strictEqual(simple.series[0].type, 'bar');
    assert.deepStrictEqual(simple.xAxis.data, ['Nord', 'Sud', 'Est']);
    assert.strictEqual(simple.legend, undefined, 'une série : pas de légende');
    assert.deepStrictEqual(simple.color, data.PALETTES.standard);
    assert.strictEqual(simple.tooltip.trigger, 'axis');
    format.setColumnInfo({}, null);
    const reference = format.forTile({ aggFn: 'sum' }, 'Montant', 'fr');
    assert.strictEqual(simple.tooltip.valueFormatter(1542980.88), reference.format(1542980.88), 'infobulle au format complet de la langue');
    assert.ok(/^1\s542\s981$/.test(simple.tooltip.valueFormatter(1542980.88)), 'séparateurs français (espaces insécables), pas de bruit de flottant');
    assert.strictEqual(simple.tooltip.valueFormatter(null), '–', 'une valeur absente est un tiret, jamais 0');
    assert.strictEqual(simple.yAxis.axisLabel.formatter(1500000), reference.axis(1500000), 'graduations compactes');
    assert.ok(/^1,5\s*M$/.test(simple.yAxis.axisLabel.formatter(1500000)), simple.yAxis.axisLabel.formatter(1500000));
    assert.strictEqual(simple.tooltip.backgroundColor, theme.fond);
    assert.strictEqual(simple.tooltip.textStyle.color, theme.texte);
    assert.strictEqual(simple.yAxis.splitLine.lineStyle.color, theme.grille);
    assert.strictEqual(simple.yAxis.axisLabel.color, theme.texteDiscret);
    assert.strictEqual(simple.animation, undefined, 'à l\'écran, l\'animation d\'ECharts');
    assert.strictEqual(opt(barres(), { animer: false }).animation, false, 'image : jamais animée');
    // Un thème sombre de l'hôte.
    const sombre = opt(barres(), { theme: { texte: '#ffffff', texteDiscret: '#aaaaaa', fond: '#101010', grille: '#333333', police: 'Inter, sans-serif' } });
    assert.strictEqual(sombre.tooltip.backgroundColor, '#101010');
    assert.strictEqual(sombre.xAxis.axisLine.lineStyle.color, '#aaaaaa');
    assert.strictEqual(sombre.textStyle.fontFamily, 'Inter, sans-serif');
    assert.strictEqual(themeComplet({ texte: 'rouge', fond: '#12', police: '<x>' }).texte, THEME_CLAIR.texte, 'une couleur mal formée retombe sur le thème clair');
    assert.strictEqual(themeComplet({ police: 'a'.repeat(200) }).police, undefined, 'une police qui n\'est pas un nom de police est écartée');
    // Plusieurs séries : légende défilante, marge haute.
    const deux = opt(barres({ seriesColumn: 'Produit' }));
    assert.strictEqual(deux.legend.type, 'scroll');
    assert.strictEqual(deux.grid.top, 40);
    assert.deepStrictEqual(deux.series.map((s) => s.name), ['A', 'B']);
    assert.strictEqual(deux.series[0].stack, undefined, 'pas empilé sans la case');
    // Empilé : pile, trou -> 0, total dans l'infobulle, noms échappés.
    const pile = opt(barres({ seriesColumn: 'Produit', stacked: true }));
    assert.deepStrictEqual(pile.series.map((s) => s.stack), ['total', 'total']);
    assert.deepStrictEqual(pile.series[1].data, [50, 20, 0], 'dans une pile un trou vaut 0 (sinon la bande des séries du dessus est rompue)');
    const bulle = pile.tooltip.formatter([{ marker: '●', seriesName: '<b>x</b>', value: 70, axisValueLabel: '<i>Nord</i>' }, { marker: '●', seriesName: 'B', value: 30, axisValueLabel: '<i>Nord</i>' }]);
    assert.ok(bulle.includes('Total : 100') && bulle.includes('&lt;b&gt;x&lt;/b&gt;') && bulle.includes('&lt;i&gt;Nord&lt;/i&gt;') && !bulle.includes('<b>x</b>'), bulle);
    assert.strictEqual(opt(barres({ stacked: true })).series[0].stack, undefined, 'empiler une seule série n\'a pas de sens');
    // Barres horizontales : catégories en y, de haut en bas.
    const horizontal = opt(barres({ horizontal: true }));
    assert.strictEqual(horizontal.yAxis.type, 'category');
    assert.strictEqual(horizontal.yAxis.inverse, true);
    assert.strictEqual(horizontal.xAxis.type, 'value');
    // Courbe : lissée, escalier, aire.
    const courbe = opt({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum', lineShape: 'smooth' });
    assert.strictEqual(courbe.series[0].type, 'line');
    assert.strictEqual(courbe.series[0].smooth, 0.35);
    assert.strictEqual(courbe.series[0].symbolSize, 8);
    assert.strictEqual(opt({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum', lineShape: 'step' }).series[0].step, 'middle');
    assert.strictEqual(opt({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum', areaFill: true }).series[0].areaStyle.opacity, 0.25);
    const airePile = opt({ type: 'line', dimension: 'Region', seriesColumn: 'Produit', measure: 'Montant', aggFn: 'sum', areaFill: true, stacked: true });
    assert.strictEqual(airePile.series[0].areaStyle.opacity, 0.65);
    assert.strictEqual(airePile.series[0].stack, 'total');
    assert.strictEqual(opt({ type: 'line', dimension: 'Region', seriesColumn: 'Produit', measure: 'Montant', aggFn: 'sum', stacked: true }).series[0].stack, undefined, 'une courbe sans remplissage n\'est jamais empilée');
    // Mesure de type « courbe » dans un graphique en barres : ni pile ni remplissage.
    const combine = opt({ type: 'bar', dimension: 'Region', aggFn: 'sum', stacked: true, measures: [{ column: 'Montant' }, { column: 'Annee', aggFn: 'max', type: 'line', color: '#ff0000' }] });
    assert.deepStrictEqual(combine.series.map((s) => s.type), ['bar', 'line']);
    assert.deepStrictEqual(combine.series.map((s) => s.stack), ['total', undefined], 'seules les barres entrent dans la pile ; la courbe passe par-dessus, sans pile ni remplissage');
    assert.strictEqual(combine.series[1].areaStyle, undefined);
    assert.strictEqual(combine.color[1], '#ff0000', 'la couleur d\'une mesure prend la place de sa série');
    // Secteurs.
    const camembert = opt({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
    assert.strictEqual(camembert.series[0].radius, '65%');
    assert.deepStrictEqual(camembert.series[0].data, [{ name: 'Nord', value: 150 }, { name: 'Sud', value: 320 }, { name: 'Est', value: 0 }]);
    assert.deepStrictEqual(camembert.series[0].labelLine, { length: 15, length2: 15 });
    assert.strictEqual(camembert.series[0].label.color, theme.texte);
    assert.strictEqual(camembert.series[0].label.textBorderWidth, 0, 'jamais de contour blanc sur un fond sombre');
    const anneau = opt({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum', donut: true, showPct: true });
    assert.deepStrictEqual(anneau.series[0].radius, ['40%', '65%']);
    assert.strictEqual(anneau.series[0].label.formatter({ name: 'Nord', percent: 31.9 }), `Nord\n${reference.percent(31.9)}`, 'nom puis part sur deux lignes, au format de la langue');
    assert.ok(/^Nord\n31,9\s*%$/.test(anneau.series[0].label.formatter({ name: 'Nord', percent: 31.9 })));
    assert.strictEqual(anneau.tooltip.trigger, 'item');
    console.log('OK option — barres, séries, pile (total, échappement), horizontal, courbe, aire, mesure en courbe, secteurs et anneau, thème de l\'hôte, jamais animée en image');
  }

  // --- Refus à codes stables ---------------------------------------------------------------------------------------------------
  {
    const refus = (def, src = source(), langue = 'fr') => preparer(def, src, langue);
    assert.strictEqual(refus(null).raison, 'invalide');
    assert.strictEqual(refus({ v: 1, type: 'bar' }).raison, 'v1');
    assert.strictEqual(refus({ v: 3, type: 'bar' }).raison, 'invalide');
    assert.strictEqual(refus({ v: 3, type: 'bar' }).detail, 'version');
    assert.strictEqual(refus(barres({ aggFn: 'median' })).raison, 'invalide', 'agrégat inconnu : jamais lu comme une somme');
    assert.deepStrictEqual(refus({ type: 'waterfall', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }), { ok: false, raison: 'dessin', detail: 'forme', forme: 'waterfall' }, 'forme pas encore dessinée');
    assert.strictEqual(refus({ type: 'hologramme' }).raison, 'dessin', 'forme inconnue');
    assert.deepStrictEqual(refus(barres({ measureMode: 'ytd' })), { ok: false, raison: 'dessin', detail: 'reglage', champ: 'measureMode' }, 'ce qui change le sens n\'est pas dessiné de travers');
    assert.strictEqual(refus(barres({ stacked: true, stackPercent: true })).champ, 'stackPercent');
    assert.strictEqual(refus(barres({ seriesColumn: 'Produit', smallMultiples: true })).champ, 'smallMultiples');
    assert.strictEqual(refus({ type: 'bar', measure: 'Montant', aggFn: 'sum' }).champ, 'dimension');
    assert.strictEqual(refus({ type: 'bar', dimension: 'Region', aggFn: 'sum' }).champ, 'measure');
    assert.strictEqual(refus({ type: 'bar', dimension: 'Region', aggFn: 'count' }).ok, true, 'compter les lignes n\'exige aucune mesure');
    assert.strictEqual(refus(barres(), { lignes: [], colonnes: COLONNES }).raison, 'vide', 'aucune ligne : jamais un cadre blanc');
    assert.strictEqual(refus(barres(), null).raison, 'invalide');
    assert.strictEqual(refus(barres(), { lignes: 'x' }).raison, 'invalide');
    assert.deepStrictEqual(refus(barres({ dimension: 'Inconnue' })), { ok: false, raison: 'colonne', colonne: 'Inconnue', detail: 'absente' });
    assert.deepStrictEqual(refus(barres({ measure: 'Region' })), { ok: false, raison: 'colonne', colonne: 'Region', detail: 'genre' }, 'sommer du texte ne donne pas 0 en silence');
    assert.strictEqual(refus(barres({ measure: 'Region', aggFn: 'count' })).ok, true, 'compter n\'exige pas de nombre');
    assert.deepStrictEqual(refus(barres({ dimension: 'Clients.Nom' })), { ok: false, raison: 'colonne', colonne: 'Clients.Nom', detail: 'jointure' });
    assert.strictEqual(refus(barres({ dimension: 'Date.Annee' })).ok, true, 'une dérivée se lit sur sa colonne de dates');
    assert.strictEqual(refus(barres({ dimension: 'Region.Annee' })).raison, 'colonne', 'une dérivée dont la colonne n\'est pas une date');
    assert.deepStrictEqual(refus(barres(), { lignes: LIGNES }).ok, true, 'colonnes facultatif : la première ligne dit ce qui existe');
    assert.strictEqual(refus(barres({ dimension: 'Zzz' }), { lignes: LIGNES }).raison, 'colonne');
    assert.strictEqual(refus(barres({ measure: 'Region' }), { lignes: LIGNES }).ok, true, 'sans colonnes, pas de contrôle de genre (le calcul ignore ce qui n\'est pas un nombre)');
    // Le volume.
    const avant = { ...SEUILS_VOLUME };
    try {
      SEUILS_VOLUME.plafond = 4;
      assert.deepStrictEqual(refus(barres()), { ok: false, raison: 'volume', detail: 'lignes', nombre: 5, plafond: 4 });
      SEUILS_VOLUME.plafond = 1000;
      SEUILS_VOLUME.echantillon = 3;
      const lignes = Array.from({ length: 10 }, (_, i) => ({ Region: `R${i}`, Montant: i, Date: `2024-01-${String(i + 1).padStart(2, '0')}` }));
      const echantillonne = refus({ type: 'line', dimension: 'Date', measure: 'Montant', aggFn: 'none' }, { lignes });
      assert.deepStrictEqual(echantillonne.echantillon, { sur: 10, tires: 3 }, 'l\'échantillon est DIT');
      assert.deepStrictEqual(echantillonne.ordre, [0, 5, 9], 'régulier, premier et dernier compris');
      assert.strictEqual(refus(barres(), { lignes }).echantillon, undefined, 'une agrégation n\'est jamais échantillonnée : le coût suit les catégories');
      assert.strictEqual(refus({ type: 'line', dimension: 'Date', measure: 'Montant', aggFn: 'none' }, { lignes: lignes.slice(0, 3) }).echantillon, undefined, 'sous le seuil : tout est tracé');
      // Trop de catégories ou de parts : refus, jamais un éditeur figé.
      SEUILS_VOLUME.echantillon = 1000;
      SEUILS_VOLUME.categories = 4;
      assert.deepStrictEqual(refus(barres({ dimension: 'Region' }), { lignes }), { ok: false, raison: 'volume', detail: 'categories', nombre: 10, plafond: 4 });
      assert.strictEqual(refus({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }, { lignes }).ok, true, 'un camembert a son propre plafond');
      SEUILS_VOLUME.secteurs = 9;
      assert.deepStrictEqual(refus({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }, { lignes }), { ok: false, raison: 'volume', detail: 'secteurs', nombre: 10, plafond: 9 });
      SEUILS_VOLUME.categories = 50000;
    } finally { Object.assign(SEUILS_VOLUME, avant); }
    assert.deepStrictEqual(refus(barres({ refLine: 'average', valueLabels: true })).nonDessines, ['refLine', 'valueLabels'], 'les réglages d\'aspect pas encore dessinés sont dits');
    assert.deepStrictEqual(refus(barres()).nonDessines, []);
    console.log('OK refus — codes stables (dessin, invalide, v1, colonne, vide, volume), genres, jointures, dérivées, échantillon dit, réglages non dessinés dits');
  }

  // --- Image hors écran ----------------------------------------------------------------------------------------------------------
  {
    const echarts = fauxEcharts();
    const g = m.creerGraphique({ echarts, langue: 'fr', theme: { texte: '#ffffff', texteDiscret: '#aaaaaa', fond: '#000000', grille: '#333333' } });
    assert.deepStrictEqual(g.formes, ['bar', 'line', 'pie']);
    const element = fauxElement();
    const toiles = element.canvases.slice();
    const r = g.image(barres(), source(), { largeur: 480, hauteur: 300, ratio: 3, element });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.url, 'data:image/png;base64,TOILE');
    assert.deepStrictEqual([r.largeur, r.hauteur, r.ratio], [480, 300, 3]);
    const instance = echarts.journal.instances[0];
    assert.deepStrictEqual(instance.opts, { renderer: 'canvas', width: 480, height: 300, devicePixelRatio: 3 }, 'taille donnée à ECharts : un élément détaché n\'a pas de taille');
    assert.strictEqual(instance.option.animation, false);
    assert.strictEqual(instance.disposes, 1, 'l\'instance est libérée');
    assert.ok(toiles.every((t) => t.width === 0 && t.height === 0), 'les toiles de l\'instance sont ramenées à zéro');
    assert.ok(echarts.journal.rendus.every((t) => t.width === 0 && t.height === 0), 'la toile du PNG aussi');
    assert.deepStrictEqual([echarts.journal.rendus[0].options.pixelRatio, echarts.journal.rendus[0].options.backgroundColor], [3, '#ffffff'], 'l\'image prend le thème CLAIR, jamais celui de l\'écran, et son fond');
    // Le thème de l'image, quand l'hôte le donne ; l'élément se réutilise (jeté ou non).
    const r2 = g.image(barres(), source(), { largeur: 200, hauteur: 100, ratio: 1, element, theme: { texte: '#111111', texteDiscret: '#222222', fond: '#fafafa', grille: '#dddddd' } });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(echarts.journal.rendus[1].options.backgroundColor, '#fafafa');
    // Défauts de taille et repli sans renderToCanvas.
    const sans = fauxEcharts();
    const initSans = sans.init;
    sans.init = (...a) => { const i = initSans(...a); delete i.renderToCanvas; return i; };
    const r3 = m.creerGraphique({ echarts: sans }).image(barres(), source(), { element: fauxElement() });
    assert.deepStrictEqual([r3.ok, r3.url, r3.largeur, r3.hauteur, r3.ratio], [true, 'data:image/png;base64,ECRAN', 480, 300, 2], 'sans renderToCanvas : getDataURL ; tailles par défaut');
    assert.strictEqual(sans.journal.instances[0].dernierGetDataURL.backgroundColor, '#ffffff');
    // Refus : rien n'est initialisé quand le plan est refusé ; l'élément manque ; la taille est déraisonnable ; le moteur manque ou échoue.
    const compte = echarts.journal.inits.length;
    assert.strictEqual(g.image(barres(), source([]), { element: fauxElement() }).raison, 'vide');
    assert.strictEqual(g.image({ type: 'treemap' }, source(), { element: fauxElement() }).raison, 'dessin');
    assert.strictEqual(echarts.journal.inits.length, compte, 'un plan refusé ne crée aucune instance');
    assert.strictEqual(g.image(barres(), source(), {}).raison, 'element');
    assert.strictEqual(g.image(barres(), source()).raison, 'element');
    for (const taille of [{ largeur: 0 }, { largeur: 10 }, { largeur: 5000 }, { hauteur: 1.5 }, { ratio: 0 }, { ratio: 9 }, { largeur: 4000, hauteur: 4000, ratio: 4 }, { largeur: '480' }, { ratio: NaN }]) {
      assert.deepStrictEqual(g.image(barres(), source(), { element: fauxElement(), ...taille }), { ok: false, raison: 'invalide', detail: 'taille' }, JSON.stringify(taille));
    }
    assert.strictEqual(m.creerGraphique({}).image(barres(), source(), { element: fauxElement() }).raison, 'moteur');
    assert.strictEqual(m.creerGraphique({ echarts: {} }).image(barres(), source(), { element: fauxElement() }).raison, 'moteur');
    const panne = fauxEcharts({ initEchoue: true });
    assert.strictEqual(m.creerGraphique({ echarts: panne }).image(barres(), source(), { element: fauxElement() }).raison, 'moteur');
    // Une panne en cours de dessin libère quand même : 500 appels de suite ne fuient pas.
    const cassee = fauxEcharts({ setOptionEchoue: true });
    const elementCasse = fauxElement();
    const echec = m.creerGraphique({ echarts: cassee }).image(barres(), source(), { element: elementCasse });
    assert.deepStrictEqual([echec.ok, echec.raison, cassee.journal.instances[0].disposes], [false, 'moteur', 1], 'setOption lève : l\'instance est libérée');
    assert.strictEqual(elementCasse.instance, null);
    const serie = fauxEcharts();
    const gs = m.creerGraphique({ echarts: serie });
    for (let i = 0; i < 500; i += 1) assert.strictEqual(gs.image(barres(), source(), { element: fauxElement() }).ok, true);
    assert.strictEqual(serie.journal.instances.length, 500);
    assert.ok(serie.journal.instances.every((i) => i.disposes === 1), '500 images : chaque instance libérée une fois, aucune gardée');
    // Les mentions : échantillon et réglages non dessinés arrivent avec l'image.
    assert.deepStrictEqual(g.image(barres({ refLine: 'average' }), source(), { element: fauxElement() }).nonDessines, ['refLine']);
    console.log('OK image() — PNG au thème clair, taille donnée, instance ET toiles libérées (même en panne, 500 appels), élément réutilisable, refus sans instance, tailles déraisonnables refusées');
  }

  // --- La vue montée --------------------------------------------------------------------------------------------------------------
  {
    const echarts = fauxEcharts();
    const g = m.creerGraphique({ echarts, langue: 'fr' });
    const element = fauxElement();
    assert.strictEqual(g.monter(element, { definition: barres(), source: source([]) }).raison, 'vide');
    assert.strictEqual(echarts.journal.inits.length, 0, 'un refus ne crée aucune instance');
    assert.strictEqual(g.monter(null, { definition: barres(), source: source() }).raison, 'element');
    assert.strictEqual(m.creerGraphique({}).monter(element, { definition: barres(), source: source() }).raison, 'moteur');
    const echecInit = m.creerGraphique({ echarts: fauxEcharts({ initEchoue: true }) }).monter(element, { definition: barres(), source: source() });
    assert.strictEqual(echecInit.raison, 'moteur');
    const monte = g.monter(element, { definition: barres(), source: source() });
    assert.strictEqual(monte.ok, true);
    const { vue } = monte;
    const instance = echarts.journal.instances[0];
    assert.strictEqual(instance.options.length, 1);
    assert.strictEqual(instance.options[0][1], true, 'setOption remplace (notMerge)');
    // `mettre` à arguments identiques ne redessine rien ; une nouvelle référence redessine.
    const def = barres();
    const src = source();
    assert.strictEqual(vue.mettre({ definition: def, source: src }).ok, true);
    const apres = instance.options.length;
    assert.strictEqual(vue.mettre({ definition: def, source: src }).ok, true);
    assert.strictEqual(vue.mettre({}).ok, true);
    assert.strictEqual(vue.mettre().ok, true);
    assert.strictEqual(instance.options.length, apres, 'arguments identiques : rien n\'est redessiné');
    vue.mettre({ source: { ...src, lignes: src.lignes.slice() } });
    assert.strictEqual(instance.options.length, apres + 1, 'un nouveau tableau de lignes redessine');
    vue.mettre({ theme: { texte: '#ffffff', texteDiscret: '#aaaaaa', fond: '#000000', grille: '#333333' } });
    assert.strictEqual(instance.option.tooltip.backgroundColor, '#000000', 'le thème change');
    vue.mettre({ langue: 'en' });
    assert.strictEqual(instance.options.length, apres + 3);
    // Un refus efface le dessin.
    const cascade = { type: 'waterfall' };
    const refuse = vue.mettre({ definition: cascade });
    assert.strictEqual(refuse.raison, 'dessin');
    assert.strictEqual(instance.clears, 1);
    assert.strictEqual(instance.option, null, 'jamais un ancien dessin sous un refus');
    assert.strictEqual(vue.mettre({ definition: cascade }).raison, 'dessin', 'le même refus se répète sans effacer de nouveau');
    assert.strictEqual(instance.clears, 1);
    assert.strictEqual(vue.mettre({ definition: barres() }).ok, true);
    assert.ok(instance.option, 'redessiné après un refus');
    // Un clic donne les rangs de LA SOURCE.
    const recus = [];
    const arreter = vue.surMarque((marque) => recus.push(marque));
    vue.mettre({ definition: barres({ seriesColumn: 'Produit' }) });
    instance.handlers.click({ componentType: 'series', dataIndex: 1, seriesIndex: 1, seriesName: 'B', value: 20 });
    assert.deepStrictEqual(recus.pop(), { rangs: [3], categorie: 'Sud', valeur: 20, serie: 'B' }, 'catégorie Sud, série B : la ligne 3');
    vue.mettre({ definition: barres() });
    instance.handlers.click({ componentType: 'series', dataIndex: 0, seriesIndex: 0, value: 150 });
    assert.deepStrictEqual(recus.pop(), { rangs: [0, 1], categorie: 'Nord', valeur: 150 }, 'toutes les lignes de la catégorie');
    instance.handlers.click({ componentType: 'title' });
    assert.strictEqual(recus.length, 0, 'un clic hors d\'une marque n\'est pas une marque');
    arreter();
    instance.handlers.click({ componentType: 'series', dataIndex: 0, seriesIndex: 0, value: 150 });
    assert.strictEqual(recus.length, 0, 'se désabonner');
    assert.strictEqual(typeof vue.surMarque(null), 'function');
    // Rangs d'une courbe « un point par ligne » échantillonnée : ceux de la source.
    const avantSeuil = { ...SEUILS_VOLUME };
    try {
      SEUILS_VOLUME.echantillon = 3;
      const lignes = Array.from({ length: 10 }, (_, i) => ({ Region: `R${i}`, Montant: i, Date: `2024-01-${String(i + 1).padStart(2, '0')}` }));
      const el2 = fauxElement();
      const e2 = fauxEcharts();
      const { vue: v2, echantillon } = m.creerGraphique({ echarts: e2 }).monter(el2, { definition: { type: 'line', dimension: 'Date', measure: 'Montant', aggFn: 'none' }, source: { lignes } });
      assert.deepStrictEqual(echantillon, { sur: 10, tires: 3 });
      const suite = [];
      v2.surMarque((marque) => suite.push(marque.rangs));
      e2.journal.instances[0].handlers.click({ componentType: 'series', dataIndex: 1, seriesIndex: 0, value: 5 });
      assert.deepStrictEqual(suite, [[5]], 'la 2e marque de l\'échantillon est la ligne 5 de la source');
      v2.detruire();
    } finally { Object.assign(SEUILS_VOLUME, avantSeuil); }
    // Redimensionner, image de l'écran, modèle, destruction.
    assert.strictEqual(vue.redimensionner().ok, true);
    assert.strictEqual(instance.resizes, 1);
    const avantLargeur = instance.options.length;
    instance.largeur = 800;
    vue.redimensionner();
    assert.strictEqual(instance.options.length, avantLargeur + 1, 'un changement de largeur reconstruit l\'option (largeur des noms de catégorie)');
    const png = vue.image({ ratio: 3 });
    assert.deepStrictEqual([png.ok, png.url, png.largeur, png.hauteur, png.ratio], [true, 'data:image/png;base64,ECRAN', 800, 300, 3]);
    assert.strictEqual(vue.image().ratio, 2);
    assert.strictEqual(vue.modeleOffice().modele.type, 'bar');
    assert.deepStrictEqual(vue.detruire(), { ok: true });
    assert.strictEqual(instance.disposes, 1);
    assert.ok(element.canvases.every((t) => t.width === 0 && t.height === 0), 'toiles à zéro à la destruction');
    assert.deepStrictEqual(vue.detruire(), { ok: true }, 'idempotent');
    assert.strictEqual(instance.disposes, 1);
    for (const appel of [() => vue.mettre({ source: src }), () => vue.redimensionner(), () => vue.image()]) assert.deepStrictEqual(appel(), { ok: false, raison: 'invalide', detail: 'detruite' });
    assert.strictEqual(instance.handlers.click, undefined, 'plus d\'écouteur');
    // Une vue qui refuse dès le montage, puis qui reçoit des lignes.
    console.log('OK vue — monter (refus sans instance), mettre identique = rien, nouvelle référence = redessin, refus efface, clic -> rangs de la source (échantillon compris), redimensionner, image, destruction idempotente');
  }

  // --- Modèle Office ---------------------------------------------------------------------------------------------------------
  {
    const g = m.creerGraphique({ echarts: fauxEcharts(), langue: 'fr' });
    const office = (def, src = source(), options) => g.modeleOffice(def, src, options);
    const b = office(barres({ title: 'Montant par région', sortMode: 'value-desc' }));
    assert.strictEqual(b.ok, true);
    assert.deepStrictEqual(b.modele, { type: 'bar', titre: 'Montant par région', categories: ['Sud', 'Nord', 'Est'], series: [{ nom: 'Montant', valeurs: [320, 150, 0], couleur: data.PALETTES.standard[0] }] });
    assert.deepStrictEqual(b.nonDessines, []);
    const p = office(barres({ seriesColumn: 'Produit', stacked: true, horizontal: true, palette: 'grist-okabe' }));
    assert.strictEqual(p.modele.empile, true);
    assert.strictEqual(p.modele.horizontal, true);
    assert.deepStrictEqual(p.modele.series.map((s) => [s.nom, s.couleur]), [['A', data.PALETTES.okabe[0]], ['B', data.PALETTES.okabe[1]]]);
    assert.deepStrictEqual(p.modele.series[1].valeurs, [50, 20, null], 'un trou reste null dans le modèle');
    assert.strictEqual(office(barres({ stacked: true })).modele.empile, undefined, 'une série : pas empilé');
    assert.strictEqual(office({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum' }).modele.type, 'line');
    assert.strictEqual(office({ type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum', areaFill: true }).modele.type, 'area');
    const mixte = office({ type: 'bar', dimension: 'Region', aggFn: 'sum', measures: [{ column: 'Montant' }, { column: 'Annee', aggFn: 'max', type: 'line', color: '#ff0000' }] });
    assert.deepStrictEqual(mixte.modele.series.map((s) => [s.couleur, s.trace]), [[data.PALETTES.standard[0], undefined], ['#ff0000', 'line']], 'une série en courbe dans un graphique en barres porte `trace`');
    const camembert = office({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
    assert.strictEqual(camembert.modele.type, 'pie');
    assert.deepStrictEqual(camembert.modele.series[0].valeurs, [150, 320, 0]);
    assert.deepStrictEqual(camembert.modele.series[0].couleurs, data.PALETTES.standard.slice(0, 3), 'une couleur par secteur');
    assert.strictEqual(office({ type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum', donut: true }).modele.type, 'donut');
    // Format Excel tel quel, absent sans réglage de colonne.
    const devise = office(barres({ numberFormat: { mode: 'column' } }), { ...source(), colonnes: COLONNES.map((c) => (c.id === 'Montant' ? { ...c, format: { numMode: 'currency', currency: 'EUR', decimals: 2 } } : c)) });
    assert.deepStrictEqual(devise.modele.format, { nombre: '#,##0.00 "EUR"' });
    assert.strictEqual(office(barres({ numberFormat: { mode: 'column' } })).modele.format, undefined, 'sans réglage de colonne : absent');
    assert.strictEqual(b.modele.format, undefined);
    // Pas de plafond de catégories dans le module.
    const beaucoup = Array.from({ length: 3000 }, (_, i) => ({ Region: `R${i}`, Montant: i }));
    assert.strictEqual(office(barres(), { lignes: beaucoup }).modele.categories.length, 3000);
    // Sans équivalent Office : image seule ; pas encore dessiné : dessin ; refus du plan sinon.
    for (const forme of ['treemap', 'sunburst', 'sankey', 'calendar', 'gantt', 'wordcloud', 'kpi', 'gauge', 'progress', 'pivot', 'heatmap', 'table', 'text', 'box']) assert.deepStrictEqual(office({ type: forme }), { ok: false, raison: 'image-seule' }, forme);
    for (const forme of ['waterfall', 'funnel', 'scatter', 'radar', 'combo', 'histogram']) assert.strictEqual(office({ type: forme }).raison, 'dessin', forme);
    assert.strictEqual(office(barres(), source([])).raison, 'vide');
    assert.strictEqual(office(barres({ dimension: 'Zzz' })).raison, 'colonne');
    assert.strictEqual(office({ v: 1, type: 'bar' }).raison, 'v1');
    assert.strictEqual(office(barres(), source(), { langue: 'en' }).ok, true);
    // Le modèle sort du MÊME plan que le dessin : mêmes catégories, même ordre.
    const echarts = fauxEcharts();
    const def = barres({ sortMode: 'value-asc', seriesColumn: 'Produit' });
    const dessine = m.creerGraphique({ echarts }).monter(fauxElement(), { definition: def, source: source() });
    assert.deepStrictEqual(echarts.journal.instances[0].option.xAxis.data, office(def).modele.categories, 'l\'aperçu et le graphique Office ne peuvent pas se contredire');
    assert.strictEqual(dessine.ok, true);
    console.log('OK modèle Office — types, pile, horizontal, série en courbe, couleur par secteur, format Excel tel quel, image-seule, mêmes catégories que le dessin');
  }

  console.log('\nTous les essais du dessin du module graphique sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
