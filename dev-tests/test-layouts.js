/*
 * Agencement d'une page (js/layouts.js, css/layouts.css) — logique pure, sans navigateur :
 *
 *   node dev-tests/test-layouts.js
 *
 * Ce que ça garde, et qu'un essai à l'écran ne voit pas toujours :
 *  - le registre (ids, seuils de largeur, clés i18n fr/en), les ids inconnus ou hostiles qui retombent sur la grille ;
 *  - le plan : largeurs qui remplissent TOUJOURS la ligne (jamais une case vide au bout), chiffres d'abord, vedette, Rail avec ou sans
 *    colonne de gauche, hauteurs fixes (jamais mesurées), tous les effectifs de 0 à 14 graphiques et de 0 à 13 chiffres ;
 *  - l'ordre affiché (copie, jamais un tri en place) et la cible des flèches ◀ ▶ (une tuile ne dépasse que celles de son groupe) ;
 *  - les miniatures du menu Réglages (dans la boîte, sans recouvrement) ;
 *  - le store : réglage PAR PAGE, la grille n'écrit rien, un id mal formé refusé, un id inconnu mais bien formé gardé, une configuration
 *    hostile assainie par `setPages` (même référence quand rien ne change : sinon une sauvegarde partirait à chaque chargement) ;
 *  - l'aller-retour de la configuration par le vrai js/grist-api.js (faux `grist`) : le champ `layout` d'une page revient tel quel, une
 *    page en grille n'en porte aucun ;
 *  - le CSS : les trois seuils `@container` = `minWidthOf`, `--lu` = ROW_UNIT, les règles communes de Rapport (≥ 640) et de Planche/Vedette
 *    (≥ 900) identiques à un sélecteur près, hauteurs jamais en `auto` sur la grille, contrastes AA des textes de la Planche ;
 *  - le câblage de index.html / harness.html et de js/main.js.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const layouts = require('../js/layouts.js');
const styles = require('../js/styles.js');
const i18n = require('../js/i18n.js');
const data = require('../js/data.js');
const { createStore } = require('../js/state.js');

const NEW_LAYOUTS = ['report', 'board', 'spotlight', 'rail'];
const plain = (x) => JSON.parse(JSON.stringify(x)); // les objets d'un contexte vm n'ont pas le prototype d'ici

// Les 11 tuiles du rapport de démonstration (un chiffre avec objectif, un sans, une jauge, des graphiques, une note, une progression).
const DEMO = [
  { id: 'k1', type: 'kpi', target: 3500000 }, { id: 'k2', type: 'kpi' }, { id: 'g1', type: 'gauge' },
  { id: 'b1', type: 'bar' }, { id: 'l1', type: 'line' }, { id: 'b2', type: 'bar' },
  { id: 'p1', type: 'pie' }, { id: 'p2', type: 'pie' }, { id: 't1', type: 'treemap' },
  { id: 'x1', type: 'text' }, { id: 'r1', type: 'progress' }
];
const mk = (types) => types.map((type, i) => ({ id: `${type}${i}`, type }));

(async () => {
  // --- 1. Registre ----------------------------------------------------------------------------------------------------------
  assert.deepStrictEqual(layouts.LAYOUT_IDS, ['grid'].concat(NEW_LAYOUTS));
  assert.strictEqual(layouts.DEFAULT_LAYOUT, 'grid');
  assert.deepStrictEqual(Object.keys(layouts.LAYOUTS), layouts.LAYOUT_IDS);
  assert.deepStrictEqual(layouts.LAYOUT_IDS.map((id) => layouts.minWidthOf(id)), [0, 640, 900, 900, 1040]);
  assert.strictEqual(layouts.ROW_UNIT, 28);
  for (const id of layouts.LAYOUT_IDS) {
    const l = layouts.LAYOUTS[id];
    assert.strictEqual(l.id, id);
    assert.strictEqual(l.nameKey, `layout.${id}.name`);
    assert.strictEqual(l.descKey, `layout.${id}.desc`);
    for (const lang of ['fr', 'en']) {
      i18n.setLang(lang);
      for (const key of [l.nameKey, l.descKey]) assert.ok(i18n.t(key) && i18n.t(key) !== key, `clé ${key} absente en ${lang}`);
    }
  }
  for (const key of ['layout.title', 'layout.hint', 'style.options.title']) {
    for (const lang of ['fr', 'en']) { i18n.setLang(lang); assert.ok(i18n.t(key, { page: 'P' }) && i18n.t(key) !== key, `${key} en ${lang}`); }
  }
  i18n.setLang('fr');
  assert.ok(i18n.t('layout.hint', { page: 'Ventes' }).includes('Ventes'), 'l\'indication nomme la page');
  assert.ok(i18n.t('style.options.title').includes('Grille'), 'les deux options valent pour la grille');
  // Ids inconnus, absents ou hostiles -> grille ; jamais d'accès au prototype.
  for (const bad of [undefined, null, '', 'nope', 'Report', 'report ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 42, {}, [], 'x"><img src=x onerror=1>']) {
    assert.strictEqual(layouts.normalizeLayoutId(bad), 'grid', `normalizeLayoutId(${JSON.stringify(bad)})`);
    assert.strictEqual(layouts.isKnown(bad), false);
  }
  assert.strictEqual(layouts.normalizeLayoutId('rail'), 'rail');
  assert.strictEqual(layouts.minWidthOf('inconnu'), 0, 'id inconnu : la grille, donc aucun seuil');
  // Ce qu'une page écrit : rien pour la grille, l'id sinon ; bien formé mais inconnu gardé (version future) ; mal formé jamais.
  assert.strictEqual(layouts.configValue('grid'), undefined);
  assert.strictEqual(layouts.configValue(undefined), undefined);
  assert.strictEqual(layouts.configValue('rail'), 'rail');
  assert.strictEqual(layouts.configValue('mosaic-2'), 'mosaic-2', 'id bien formé d\'une version future');
  for (const bad of ['', 'Rail', '1rail', 'a'.repeat(33), 'x"y', '<b>', null, 3]) assert.strictEqual(layouts.configValue(bad), undefined, JSON.stringify(bad));
  console.log('OK agencements — registre : ids, seuils 0/640/900/900/1040, i18n fr/en, ids inconnus ou hostiles -> grille, valeur de configuration');

  // --- 2. Largeurs : la ligne se remplit toujours ---------------------------------------------------------------------------
  for (let per = 1; per <= 4; per++) {
    for (let n = 0; n <= 14; n++) {
      const spans = layouts.spansFor(n, per);
      assert.strictEqual(spans.length, n);
      for (let i = 0; i < n; i += per) {
        const row = spans.slice(i, i + per);
        assert.ok(row.every((s) => s === row[0]), `largeurs égales dans une ligne (n=${n}, ${per}/ligne)`);
        assert.ok(row.reduce((a, b) => a + b, 0) <= layouts.COLUMNS);
        assert.ok(row[0] * row.length >= layouts.COLUMNS - (layouts.COLUMNS % row.length) && layouts.COLUMNS - row[0] * row.length < row.length, `ligne remplie (n=${n}, ${per}/ligne) : ${row}`);
      }
    }
  }
  assert.deepStrictEqual(layouts.spansFor(5, 3), [4, 4, 4, 6, 6], '5 à 3 par ligne : 4 4 4 puis 6 6');
  assert.deepStrictEqual(layouts.spansFor(7, 2), [6, 6, 6, 6, 6, 6, 12], 'le dernier graphique seul prend la ligne');
  assert.deepStrictEqual(layouts.spansFor(1, 3), [12]);
  assert.deepStrictEqual(layouts.spansFor(0, 3), []);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 13].map(layouts.figuresPerRow), [1, 2, 3, 4, 3, 3, 4, 4, 4, 4]);
  assert.deepStrictEqual(layouts.startsFor([4, 4, 4, 6, 6], 2), [2, 6, 10, 2, 8], 'départs : la ligne recommence à la base');
  assert.deepStrictEqual(layouts.startsFor([12], 1), [1]);
  console.log('OK agencements — largeurs : toutes les lignes pleines (0 à 14 éléments, 1 à 4 par ligne), la dernière se partage, départs du Rail');

  // --- 3. Plan -------------------------------------------------------------------------------------------------------------
  assert.strictEqual(layouts.plan('grid', DEMO), null, 'grille : rien n\'est posé');
  assert.strictEqual(layouts.plan('inconnu', DEMO), null);
  assert.strictEqual(layouts.plan(undefined, DEMO), null);
  const spansOf = (p, ids) => ids.map((id) => p.items[id].span);
  {
    const p = layouts.plan('report', DEMO);
    assert.strictEqual(p.id, 'report');
    assert.strictEqual(p.hasRail, false);
    assert.deepStrictEqual(p.order, ['k1', 'k2', 'g1', 'b1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1'], 'chiffres d\'abord, puis l\'ordre enregistré');
    assert.deepStrictEqual(spansOf(p, ['k1', 'k2']), [6, 6], 'deux chiffres : la moitié chacun');
    assert.deepStrictEqual(spansOf(p, ['g1', 'b1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1']), [6, 6, 6, 6, 6, 6, 6, 6, 12], 'deux graphiques par ligne, le dernier seul prend la ligne');
    assert.strictEqual(p.items.k1.first, true, 'le premier chiffre est le chiffre phare');
    assert.ok(!p.items.k2.first && !p.items.g1.first);
    assert.deepStrictEqual([p.items.k1.rows, p.items.g1.rows], [8, 10]);
    assert.ok(Object.values(p.items).every((it) => it.start === undefined), 'Rapport : aucune colonne de départ imposée');
  }
  {
    const p = layouts.plan('board', DEMO);
    assert.deepStrictEqual(spansOf(p, ['g1', 'b1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1']), [4, 4, 4, 4, 4, 4, 4, 4, 4], 'trois par ligne : 9 graphiques = 3 lignes pleines');
    assert.deepStrictEqual([p.items.k1.rows, p.items.g1.rows], [8, 9]);
    const six = layouts.plan('board', mk(['kpi', 'kpi', 'kpi', 'kpi', 'kpi', 'kpi', 'kpi']));
    assert.deepStrictEqual(Object.values(six.items).map((it) => it.span), [3, 3, 3, 3, 4, 4, 4], '7 chiffres : 4 puis 3, le dernier rang se partage');
    const five = layouts.plan('board', mk(['kpi', 'kpi', 'kpi', 'kpi', 'kpi']));
    assert.deepStrictEqual(Object.values(five.items).map((it) => it.span), [4, 4, 4, 6, 6], '5 chiffres : 3 puis 2');
  }
  {
    const p = layouts.plan('spotlight', DEMO);
    assert.deepStrictEqual(p.order, ['k1', 'k2', 'b1', 'g1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1'], 'chiffres, la vedette (1er graphique en barres), puis les deux à côté, puis le reste');
    assert.strictEqual(p.items.b1.hero, true);
    assert.deepStrictEqual([p.items.b1.span, p.items.b1.rows], [8, 16], 'vedette : 8 colonnes, 16 rangées');
    assert.deepStrictEqual([p.items.g1.span, p.items.g1.rows, p.items.l1.span, p.items.l1.rows], [4, 8, 4, 8], 'deux tuiles à côté se partagent la hauteur de la vedette');
    assert.deepStrictEqual(spansOf(p, ['b2', 'p1', 'p2', 't1', 'x1', 'r1']), [4, 4, 4, 4, 4, 4], 'le reste : trois par ligne');
    assert.deepStrictEqual(spansOf(p, ['k1', 'k2']), [6, 6]);
    // Une seule tuile à côté : elle prend les 16 rangées. Aucune : la vedette prend toute la largeur.
    const one = layouts.plan('spotlight', mk(['kpi', 'bar', 'pie']));
    assert.deepStrictEqual([one.items.bar1.span, one.items.bar1.rows, one.items.pie2.span, one.items.pie2.rows], [8, 16, 4, 16]);
    const alone = layouts.plan('spotlight', mk(['kpi', 'line']));
    assert.deepStrictEqual([alone.items.line1.span, alone.items.line1.rows, alone.items.line1.hero], [12, 16, true]);
    // Sans graphique en barres, courbe ou combo : pas de vedette, trois par ligne.
    const none = layouts.plan('spotlight', mk(['kpi', 'pie', 'treemap', 'funnel', 'scatter']));
    assert.ok(Object.values(none.items).every((it) => !it.hero));
    assert.deepStrictEqual(['pie1', 'treemap2', 'funnel3', 'scatter4'].map((id) => none.items[id].span), [4, 4, 4, 12], '4 graphiques à 3 par ligne : 3 puis 1 qui prend la ligne');
    assert.strictEqual(layouts.plan('spotlight', mk(['combo', 'bar'])).items.combo0.hero, true, 'le combo peut être la vedette');
    assert.strictEqual(layouts.plan('spotlight', mk(['pie', 'bar', 'line'])).items.bar1.hero, true, 'la PREMIÈRE du bon type');
  }
  {
    const p = layouts.plan('rail', DEMO);
    assert.strictEqual(p.hasRail, true);
    assert.deepStrictEqual(p.order.slice(0, 3), ['k1', 'k2', 'g1'], 'la colonne de gauche d\'abord : chiffres et jauge');
    assert.deepStrictEqual(['k1', 'k2', 'g1'].map((id) => p.items[id].group), ['rail', 'rail', 'rail']);
    assert.deepStrictEqual(['k1', 'k2', 'g1'].map((id) => p.items[id].start), [1, 1, 1]);
    assert.deepStrictEqual(['k1', 'k2', 'g1'].map((id) => p.items[id].span), [1, 1, 1]);
    // Un chiffre avec objectif a une barre de plus : 2 rangées de plus ; la jauge garde sa hauteur.
    assert.deepStrictEqual(['k1', 'k2', 'g1'].map((id) => p.items[id].rows), [9, 7, 9]);
    assert.strictEqual(p.items.k1.first, true);
    assert.ok(!p.items.g1.first, 'une jauge n\'est jamais le chiffre phare');
    assert.deepStrictEqual(['b1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1'].map((id) => p.items[id].start), [2, 6, 10, 2, 6, 10, 2, 8], 'les graphiques commencent à la colonne 2, après le rail');
    assert.deepStrictEqual(['b1', 'l1', 'b2', 'p1', 'p2', 't1', 'x1', 'r1'].map((id) => p.items[id].span), [4, 4, 4, 4, 4, 4, 6, 6]);
    // Sans tuile de chiffres ni jauge : plus de colonne de gauche, les graphiques partent de la colonne 1.
    const bare = layouts.plan('rail', mk(['bar', 'pie', 'line', 'treemap']));
    assert.strictEqual(bare.hasRail, false);
    assert.deepStrictEqual(['bar0', 'pie1', 'line2', 'treemap3'].map((id) => bare.items[id].start), [1, 5, 9, 1]);
    assert.deepStrictEqual(['bar0', 'pie1', 'line2', 'treemap3'].map((id) => bare.items[id].span), [4, 4, 4, 12]);
    // Une seule jauge suffit à faire un rail ; la première jauge n'est jamais « first ».
    const gauge = layouts.plan('rail', mk(['gauge', 'bar']));
    assert.strictEqual(gauge.hasRail, true);
    assert.ok(!gauge.items.gauge0.first);
    // Objectif : colonne d'objectifs OU nombre fini (même règle que le rendu), jamais un texte ou NaN.
    assert.strictEqual(layouts.hasGoal({ type: 'kpi', targetColumn: 'Objectif' }), true);
    assert.strictEqual(layouts.hasGoal({ type: 'kpi', target: 0 }), true, 'un objectif nul est un objectif (le rendu le traite à part)');
    assert.strictEqual(layouts.hasGoal({ type: 'kpi', target: '12 000' }), false);
    assert.strictEqual(layouts.hasGoal({ type: 'kpi', target: '' }), false);
    assert.strictEqual(layouts.hasGoal({ type: 'kpi', target: null }), false);
    assert.strictEqual(layouts.hasGoal({ type: 'kpi' }), false);
    assert.strictEqual(layouts.hasGoal(null), false);
  }
  // Tous les effectifs : chaque graphique reçoit une largeur, une hauteur fixe et un seul groupe ; aucune ligne de graphiques ne laisse de trou.
  for (const id of NEW_LAYOUTS) {
    for (let figures = 0; figures <= 13; figures += (figures < 8 ? 1 : 5)) {
      for (let charts = 0; charts <= 14; charts++) {
        const tiles = mk([].concat(Array(figures).fill('kpi'), Array(charts).fill('pie')));
        const p = layouts.plan(id, tiles);
        const label = `${id} ${figures} chiffres + ${charts} graphiques`;
        assert.strictEqual(p.order.length, tiles.length, label);
        assert.strictEqual(new Set(p.order).size, tiles.length, `${label} : chaque tuile une fois`);
        for (const t of tiles) {
          const it = p.items[t.id];
          assert.ok(it, `${label} : ${t.id} sans plan`);
          assert.ok(Number.isInteger(it.span) && it.span >= 1 && it.span <= layouts.COLUMNS, `${label} : span ${it.span}`);
          assert.ok(Number.isInteger(it.rows) && it.rows >= 4 && it.rows <= 20, `${label} : rows ${it.rows} (hauteur fixe, jamais mesurée)`);
          assert.ok(['figure', 'rail', 'chart'].includes(it.group));
        }
        if (id !== 'rail') {
          // Les lignes d'un même groupe se remplissent : on range les largeurs et chaque ligne fait 12.
          for (const group of ['figure', 'chart']) {
            let used = 0;
            let rows = 0;
            p.order.map((tid) => p.items[tid]).filter((it) => it.group === group && !it.hero).forEach((it) => {
              if (group === 'chart' && id === 'spotlight') return;
              used += it.span;
              if (used === layouts.COLUMNS) { used = 0; rows++; }
              else assert.ok(used < layouts.COLUMNS, `${label} : une ligne de ${group} déborde`);
            });
            if (!(group === 'chart' && id === 'spotlight')) assert.strictEqual(used, 0, `${label} : la dernière ligne de ${group} laisse un trou`);
          }
        } else {
          let used = 0;
          p.order.map((tid) => p.items[tid]).filter((it) => it.group === 'chart').forEach((it) => {
            used += it.span;
            if (used === layouts.COLUMNS) used = 0;
            else assert.ok(used < layouts.COLUMNS, `${label} : une ligne du Rail déborde`);
          });
          assert.strictEqual(used, 0, `${label} : la dernière ligne du Rail laisse un trou`);
          assert.strictEqual(p.hasRail, figures > 0, label);
        }
      }
    }
  }
  // Entrées bizarres : aucune exception.
  for (const id of NEW_LAYOUTS) {
    for (const tiles of [undefined, null, [], [null], [{}], [{ id: 5, type: 'bar' }], [{ id: 'a' }], 'abc', [{ id: 'a', type: null }, { id: 'b', type: {} }]]) {
      assert.doesNotThrow(() => layouts.plan(id, tiles), `${id} ${JSON.stringify(tiles)}`);
    }
    assert.deepStrictEqual(layouts.plan(id, []).order, []);
  }
  // Volume : 1 000 tuiles en moins de 100 ms (le plan est recalculé à chaque rendu).
  {
    const big = mk(Array.from({ length: 1000 }, (_, i) => (i % 5 === 0 ? 'kpi' : i % 7 === 0 ? 'gauge' : 'bar')));
    const t0 = Date.now();
    for (const id of NEW_LAYOUTS) layouts.plan(id, big);
    assert.ok(Date.now() - t0 < 400, `plan sur 1 000 tuiles x 4 agencements : ${Date.now() - t0} ms`);
  }
  console.log('OK agencements — plan : démonstration (Rapport, Planche, Vedette, Rail), vedette seule/à deux/absente, Rail avec/sans colonne, objectif, 0-13 chiffres x 0-14 graphiques sans trou, entrées bizarres, 1 000 tuiles');

  // --- 4. Ordre affiché et flèches ----------------------------------------------------------------------------------------
  {
    const stored = DEMO.map((t) => t.id);
    const copy = plain(DEMO);
    assert.deepStrictEqual(layouts.displayOrder('grid', DEMO).map((t) => t.id), stored, 'grille : l\'ordre enregistré');
    assert.notStrictEqual(layouts.displayOrder('grid', DEMO), DEMO, 'une copie');
    const spot = layouts.displayOrder('spotlight', DEMO);
    assert.deepStrictEqual(spot.map((t) => t.id), layouts.plan('spotlight', DEMO).order);
    assert.deepStrictEqual(plain(DEMO), copy, 'l\'ordre enregistré n\'est jamais trié en place');
    assert.ok(spot.every((t, i) => t === DEMO.find((d) => d.id === spot[i].id)), 'les mêmes objets, pas des copies');
    // Les chiffres passent devant, même rangés après des graphiques dans la page.
    const late = [{ id: 'a', type: 'bar' }, { id: 'b', type: 'kpi' }, { id: 'c', type: 'pie' }, { id: 'd', type: 'kpi' }];
    assert.deepStrictEqual(layouts.displayOrder('report', late).map((t) => t.id), ['b', 'd', 'a', 'c']);
    assert.deepStrictEqual(layouts.displayOrder('rail', [{ id: 'a', type: 'bar' }, { id: 'g', type: 'gauge' }, { id: 'k', type: 'kpi' }]).map((t) => t.id), ['g', 'k', 'a'], 'Rail : la jauge est dans la colonne de gauche');
    // ◀ ▶ : la voisine en grille ; en agencement, la plus proche du MÊME groupe.
    assert.strictEqual(layouts.moveTarget('grid', late, 'a', 1), 'b');
    assert.strictEqual(layouts.moveTarget('grid', late, 'a', -1), null);
    assert.strictEqual(layouts.moveTarget('report', late, 'b', 1), 'd', 'un chiffre dépasse la tuile de graphique qui le sépare du suivant');
    assert.strictEqual(layouts.moveTarget('report', late, 'b', -1), null, 'le 1er chiffre ne recule pas devant un graphique');
    assert.strictEqual(layouts.moveTarget('report', late, 'a', 1), 'c', 'un graphique dépasse le chiffre qui le sépare du suivant');
    assert.strictEqual(layouts.moveTarget('report', late, 'c', 1), null);
    assert.strictEqual(layouts.moveTarget('report', late, 'd', 1), null);
    assert.strictEqual(layouts.moveTarget('rail', [{ id: 'a', type: 'bar' }, { id: 'g', type: 'gauge' }, { id: 'k', type: 'kpi' }], 'g', 1), 'k', 'jauge et chiffre : même colonne de gauche');
    assert.strictEqual(layouts.moveTarget('report', late, 'inconnu', 1), null);
    assert.strictEqual(layouts.moveTarget('report', [], 'a', 1), null);
  }
  console.log('OK agencements — ordre affiché (copie, chiffres d\'abord, Rail) et cible des flèches (même groupe)');

  // --- 5. Miniatures ------------------------------------------------------------------------------------------------------
  for (const id of layouts.LAYOUT_IDS) {
    const shapes = layouts.thumb(id);
    assert.ok(shapes.length >= 6, `${id} : miniature`);
    for (const s of shapes) {
      assert.ok(['frame', 'fill', 'hero', 'rule'].includes(s.kind), `${id} : sorte ${s.kind}`);
      assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= layouts.THUMB_W && s.y + s.h <= layouts.THUMB_H, `${id} : ${JSON.stringify(s)} dans la boîte`);
      assert.ok(Number.isFinite(s.x + s.y + s.w + s.h), `${id} : nombres finis`);
      if (s.kind === 'rule') assert.ok(s.w === 0 || s.h === 0, `${id} : un filet est une ligne`);
      else assert.ok(s.w > 0 && s.h > 0, `${id} : une forme a une surface`);
    }
    const blocks = shapes.filter((s) => s.kind === 'fill' || s.kind === 'hero');
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]; const b = blocks[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `${id} : deux formes se recouvrent ${JSON.stringify(a)} ${JSON.stringify(b)}`);
      }
    }
    assert.strictEqual(shapes.some((s) => s.kind === 'hero'), id !== 'grid', `${id} : le chiffre phare/la vedette est en accent (sauf la grille)`);
  }
  assert.ok(layouts.thumb('grid').every((s) => s.kind === 'frame'), 'la grille : des cases à contour');
  assert.deepStrictEqual(layouts.thumb('inconnu'), layouts.thumb('grid'));
  console.log('OK agencements — miniatures : dans la boîte 60 x 40, sans recouvrement, accent sur le chiffre phare');

  // --- 6. Store : réglage par page ------------------------------------------------------------------------------------------
  {
    const store = createStore();
    store.setPages([
      { id: 'p1', name: 'A', tiles: [{ id: 't1', type: 'kpi' }, { id: 't2', type: 'bar' }, { id: 't3', type: 'pie' }] },
      { id: 'p2', name: 'B', tiles: [{ id: 'u1', type: 'bar' }] }
    ], 'p1');
    let calls = 0;
    store.subscribe(() => { calls++; });
    assert.strictEqual(store.getState().pageLayout, 'grid', 'défaut : grille');
    const pages0 = store.getState().pages;
    store.setPageLayout('p1', 'grid');
    assert.strictEqual(store.getState().pages, pages0, 'grille déjà en place : aucune nouvelle référence');
    assert.strictEqual(calls, 0, 'ni notification');
    store.setPageLayout('p1', 'report');
    assert.strictEqual(store.getState().pageLayout, 'report');
    assert.strictEqual(calls, 1);
    assert.notStrictEqual(store.getState().pages, pages0, 'nouvelle référence : la page sera enregistrée');
    assert.strictEqual(store.getState().pages[0].layout, 'report');
    assert.ok(!('layout' in store.getState().pages[1]), 'l\'autre page n\'est pas touchée');
    const p2ref = store.getState().pages[1];
    store.setPageLayout('p1', 'report');
    assert.strictEqual(calls, 1, 'même valeur : rien');
    // Par page : l'autre page garde la sienne, changer de page change l'agencement lu.
    store.setPageLayout('p2', 'rail');
    assert.strictEqual(store.getState().pages[0].layout, 'report');
    assert.strictEqual(store.getState().pages[1].layout, 'rail');
    assert.strictEqual(store.getState().pageLayout, 'report', 'la page courante reste la 1re');
    store.setCurrentPage('p2');
    assert.strictEqual(store.getState().pageLayout, 'rail');
    store.setCurrentPage('p1');
    assert.strictEqual(store.getState().pageLayout, 'report');
    assert.notStrictEqual(store.getState().pages[1], p2ref);
    // Retour à la grille : le champ disparaît (une page d'avant ce réglage reste identique octet pour octet).
    store.setPageLayout('p1', 'grid');
    assert.ok(!('layout' in store.getState().pages[0]), 'grille : champ retiré');
    store.setPageLayout('p2', null);
    assert.ok(!('layout' in store.getState().pages[1]), 'null : la grille');
    assert.strictEqual(JSON.stringify(store.getState().pages), JSON.stringify([
      { id: 'p1', name: 'A', tiles: [{ id: 't1', type: 'kpi' }, { id: 't2', type: 'bar' }, { id: 't3', type: 'pie' }] },
      { id: 'p2', name: 'B', tiles: [{ id: 'u1', type: 'bar' }] }
    ]), 'octet pour octet comme avant ce réglage');
    // Refus : id mal formé, page inconnue ; id bien formé mais inconnu gardé (version future).
    const before = store.getState().pages;
    for (const bad of ['', 'Rail', 'x"><img src=x onerror=1>', '1a', 'a'.repeat(40), 5, {}, []]) store.setPageLayout('p1', bad);
    store.setPageLayout('absente', 'rail');
    assert.strictEqual(store.getState().pages, before, 'rien d\'accepté');
    store.setPageLayout('p1', 'mosaic-2');
    assert.strictEqual(store.getState().pages[0].layout, 'mosaic-2', 'id bien formé d\'une version future : gardé');
    assert.strictEqual(layouts.normalizeLayoutId(store.getState().pageLayout), 'grid', 'mais affiché en grille');
    // Indépendant du style, des vues, des filtres.
    store.setPageLayout('p1', 'board');
    store.setDashStyle('glass');
    assert.strictEqual(store.getState().pageLayout, 'board');
    assert.strictEqual(store.getState().dashStyle, 'glass');
    // Flèches : échange avec une cible précise (un groupe), voisine sans cible.
    store.setPageLayout('p1', 'report');
    store.setPages([{ id: 'p1', name: 'A', tiles: [{ id: 'a', type: 'bar' }, { id: 'b', type: 'kpi' }, { id: 'c', type: 'pie' }, { id: 'd', type: 'kpi' }] }], 'p1');
    store.moveTile('b', 1, 'd');
    assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['a', 'd', 'c', 'b'], 'échange avec la cible');
    store.moveTile('a', 1, 'c');
    assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['c', 'd', 'a', 'b']);
    const keep = store.getState().tiles;
    store.moveTile('a', 1, 'b'); // b est après a : cible valide
    assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['c', 'd', 'b', 'a']);
    store.moveTile('c', -1, 'a'); // cible du mauvais côté : refusée
    store.moveTile('c', 1, 'inconnue');
    store.moveTile('inconnue', 1, 'a');
    assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['c', 'd', 'b', 'a'], 'cibles invalides : rien');
    store.moveTile('d', -1);
    assert.deepStrictEqual(store.getState().tiles.map((t) => t.id), ['d', 'c', 'b', 'a'], 'sans cible : la voisine, comme avant');
    assert.notStrictEqual(store.getState().tiles, keep);
  }
  // setPages assainit une configuration hostile ; même référence quand tout va bien (sinon une sauvegarde partirait à chaque chargement).
  {
    const store = createStore();
    const good = [{ id: 'p1', name: 'A', layout: 'report', tiles: [{ id: 't1', type: 'bar' }] }, { id: 'p2', name: 'B', tiles: [] }];
    store.setPages(good, 'p1');
    assert.strictEqual(store.getState().pages, good, 'configuration saine : la même référence');
    assert.strictEqual(store.getState().pageLayout, 'report');
    for (const bad of ['x"><img src=x onerror=alert(1)>', '', 'Rail', 7, null, {}, ['rail'], 'a'.repeat(33), '<script>']) {
      const hostile = [{ id: 'p1', name: 'A', layout: bad, tiles: [{ id: 't1', type: 'bar' }] }];
      store.setPages(hostile, 'p1');
      assert.ok(!('layout' in store.getState().pages[0]), `layout hostile ${JSON.stringify(bad)} retiré`);
      assert.strictEqual(store.getState().pageLayout, 'grid');
      assert.ok('layout' in hostile[0], 'la configuration d\'origine n\'est pas modifiée en place');
    }
    const future = [{ id: 'p1', name: 'A', layout: 'mosaic-2', tiles: [] }];
    store.setPages(future, 'p1');
    assert.strictEqual(store.getState().pages, future, 'id bien formé d\'une version future : gardé, même référence');
  }
  console.log('OK agencements — store : par page, grille = aucun champ (octet pour octet), refus des ids mal formés, id futur gardé, configuration hostile assainie, flèches avec cible');

  // --- 7. Configuration : aller-retour par grist-api.js (vrai module, faux `grist`) --------------------------------------------
  {
    const source = read('js', 'grist-api.js');
    const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; } };
    sandbox.window = sandbox;
    sandbox.GristBI = { data, i18n, state: { DEFAULT_PAGE_ID: 'page_default' } };
    const cfg = { id: [], TableId: [], ConfigJSON: [], Nom: [], TypeRapport: [], DateModif: [], ModifiePar: [] };
    sandbox.grist = { docApi: {
      listTables: async () => ['BI_Dashboard_Config'],
      fetchTable: async () => JSON.parse(JSON.stringify(cfg)),
      applyUserActions: async (list) => {
        const out = { retValues: [] };
        list.forEach((a) => {
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
    const stored = () => JSON.parse(cfg.ConfigJSON[cfg.ConfigJSON.length - 1]);
    const pages = [
      { id: 'page_default', name: 'Vue d\'ensemble', layout: 'report', tiles: [{ id: 't1', type: 'kpi' }] },
      { id: 'p2', name: 'Analyse', layout: 'rail', tiles: [{ id: 't2', type: 'bar' }] },
      { id: 'p3', name: 'Grille', tiles: [{ id: 't3', type: 'pie' }] }
    ];
    await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard');
    assert.deepStrictEqual(stored().pages.map((p) => p.layout), ['report', 'rail', undefined], 'le champ layout est enregistré avec la page');
    assert.ok(!('layout' in stored().pages[2]), 'une page en grille n\'écrit rien');
    const loaded = plain(await api.loadConfig('T'));
    assert.deepStrictEqual(loaded.pages.map((p) => p.layout), ['report', 'rail', undefined], 'relu tel quel');
    assert.deepStrictEqual(loaded.pages.map((p) => p.tiles.length), [1, 1, 1], 'les tuiles ne bougent pas');
    // Une configuration d'avant ce réglage se relit sans champ layout ; les anciens formats aussi.
    cfg.ConfigJSON[cfg.ConfigJSON.length - 1] = JSON.stringify({ pages: [{ id: 'page_default', name: 'P', tiles: [{ id: 'a', type: 'bar' }] }], currentPageId: 'page_default', bookmarks: [] });
    const old = plain(await api.loadConfig('T'));
    assert.ok(!('layout' in old.pages[0]));
    cfg.ConfigJSON[cfg.ConfigJSON.length - 1] = JSON.stringify([{ id: 'a', type: 'bar' }]);
    assert.ok(!('layout' in plain(await api.loadConfig('T')).pages[0]), 'tableau brut de tuiles (très ancien format)');
    // Le store qui reçoit cette configuration en tire le même agencement (le chemin réel : loadConfig -> setPages).
    const store = createStore();
    store.setPages(loaded.pages, loaded.currentPageId);
    assert.strictEqual(store.getState().pageLayout, 'report');
    store.setCurrentPage('p2');
    assert.strictEqual(store.getState().pageLayout, 'rail');
    store.setCurrentPage('p3');
    assert.strictEqual(store.getState().pageLayout, 'grid');
  }
  console.log('OK agencements — configuration : champ layout écrit avec la page, relu, rien pour la grille, anciens formats sans champ, chemin loadConfig -> setPages');

  // --- 8. CSS -------------------------------------------------------------------------------------------------------------
  const css = read('css', 'layouts.css');
  function parseCss(src) {
    const text = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    (function walk(body, ctx) {
      let i = 0;
      while (i < body.length) {
        const open = body.indexOf('{', i);
        if (open === -1) break;
        const head = body.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < body.length && depth > 0) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++; }
        const inner = body.slice(open + 1, j - 1);
        if (head.startsWith('@container') || head.startsWith('@media')) walk(inner, ctx.concat(head.replace(/\s+/g, ' ')));
        else if (!head.startsWith('@')) {
          const decls = {};
          inner.split(';').forEach((d) => { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
          rules.push({ ctx, selector: head.replace(/\s+/g, ' '), decls });
        }
        i = j;
      }
    })(text, []);
    return rules;
  }
  const rules = parseCss(css);
  assert.ok(rules.length > 40, `${rules.length} règles lues`);
  const inContainer = (px) => rules.filter((r) => r.ctx[0] === `@container ws (min-width: ${px}px)`);
  // Seuils : un bloc par valeur de `minWidthOf`, et rien en dehors des blocs sauf le conteneur et les cartes du menu.
  const thresholds = [...new Set(rules.map((r) => r.ctx[0]).filter(Boolean))].sort();
  assert.deepStrictEqual(thresholds, ['@container ws (min-width: 1040px)', '@container ws (min-width: 640px)', '@container ws (min-width: 900px)'].sort(), 'trois seuils');
  const widthsInJs = [...new Set(layouts.LAYOUT_IDS.map((id) => layouts.minWidthOf(id)).filter(Boolean))].sort((a, b) => a - b);
  assert.deepStrictEqual(widthsInJs, [640, 900, 1040], 'les seuils de js/layouts.js');
  const blockFor = { report: 640, board: 900, spotlight: 900, rail: 1040 };
  for (const id of NEW_LAYOUTS) {
    assert.strictEqual(layouts.minWidthOf(id), blockFor[id], `${id} : seuil du CSS = seuil du JS`);
    const own = inContainer(blockFor[id]).filter((r) => r.selector.includes(`[data-layout="${id}"]`));
    assert.ok(own.length >= 3, `${id} : des règles dans son bloc (${own.length})`);
    for (const px of [640, 900, 1040]) {
      if (px === blockFor[id]) continue;
      const stray = inContainer(px).filter((r) => r.selector.includes(`[data-layout="${id}"]`) && !r.selector.includes(',') && !/:is\(/.test(r.selector));
      assert.deepStrictEqual(stray.map((r) => r.selector), [], `${id} : aucune règle propre dans le bloc ${px}`);
    }
  }
  const outside = rules.filter((r) => r.ctx.length === 0).map((r) => r.selector);
  assert.deepStrictEqual(outside, ['.workspace-main', '.layout-swatch', '.layout-swatch svg', '.layout-swatch .lt-frame', '.layout-swatch .lt-fill', '.layout-swatch .lt-hero', '.layout-swatch .lt-rule'], 'hors des blocs : le conteneur et les miniatures');
  assert.strictEqual(rules.find((r) => r.selector === '.workspace-main').decls.container, 'ws / inline-size', 'la zone de travail est le conteneur interrogé');
  // Aucun agencement ne s'applique sans le garde du bloc : toute règle `#tiles[data-layout…` est dans un @container.
  for (const r of rules) if (r.selector.includes('data-layout')) assert.ok(r.ctx.some((c) => c.startsWith('@container ws')), `${r.selector} : hors @container`);
  // --lu = ROW_UNIT et rangées fixes.
  for (const px of [640, 900, 1040]) {
    const grids = inContainer(px).filter((r) => r.decls['grid-auto-rows']);
    assert.ok(grids.length >= 1, `${px} : une grille à rangées fixes`);
    for (const g of grids) {
      assert.strictEqual(g.decls['grid-auto-rows'], 'var(--lu)');
      assert.strictEqual(g.decls['--lu'], `${layouts.ROW_UNIT}px`, `${g.selector} : --lu = ROW_UNIT`);
      assert.strictEqual(g.decls.display, 'grid');
      assert.strictEqual(g.decls['grid-template-columns'] && /repeat\(12, minmax\(0, 1fr\)\)|252px repeat\(12, minmax\(0, 1fr\)\)/.test(g.decls['grid-template-columns']), true, `${g.selector} : 12 colonnes`);
    }
  }
  // Hauteur d'une tuile : jamais une valeur liée au contenu autre que `auto` dans une grille à rangées fixes, jamais de min-height.
  for (const r of rules) {
    if (r.decls['min-height']) assert.fail(`${r.selector} : min-height (piège n°8)`);
    if (r.decls.height && r.selector.includes('> .tile') && !r.selector.includes('.tile-')) assert.strictEqual(r.decls.height, 'auto', `${r.selector} : la grille donne la hauteur`);
    if (r.decls['grid-row']) assert.ok(/^span (var\(--lr, \d+\)|calc\(var\(--lr, \d+\) \+ 1\))$/.test(r.decls['grid-row']), `${r.selector} : grid-row = ${r.decls['grid-row']}`);
  }
  // Les valeurs viennent des variables posées par le rendu, jamais d'un nombre en dur (un style en ligne les battrait).
  for (const r of rules.filter((x) => x.decls['grid-column'])) assert.ok(/var\(--ls, \d+\)/.test(r.decls['grid-column']), `${r.selector} : ${r.decls['grid-column']}`);
  assert.ok(rules.some((r) => r.decls['grid-column'] && r.decls['grid-column'].includes('var(--lc, auto)')), 'le Rail lit sa colonne de départ');
  // Les règles communes de Rapport (≥ 640) et de Planche/Vedette (≥ 900) sont les mêmes à un sélecteur près : une feuille sans préprocesseur ne
  // peut pas donner deux seuils à une même règle, la copie est donc gardée à l'identique par ce test.
  {
    const norm = (r) => `${r.ctx.slice(1).join(' | ')} ${r.selector.replace(/#tiles:is\(\[data-layout="report"\]\)/g, '#tiles:is(L)').replace(/#tiles:is\(\[data-layout="board"\], \[data-layout="spotlight"\]\)/g, '#tiles:is(L)')} {${JSON.stringify(r.decls)}}`;
    const common = (px) => inContainer(px).filter((r) => r.selector.includes('#tiles:is(')).map(norm);
    const a = common(640);
    const b = common(900);
    assert.ok(a.length >= 15, `${a.length} règles communes`);
    assert.deepStrictEqual(a, b, 'les règles communes du bloc 640 et du bloc 900 sont identiques');
    // Les sélecteurs bruts sont bien ceux attendus (sinon la normalisation ci-dessus ne prouverait rien).
    assert.ok(inContainer(640).filter((r) => r.selector.includes('#tiles:is(')).every((r) => r.selector.includes('#tiles:is([data-layout="report"])')));
    assert.ok(inContainer(900).filter((r) => r.selector.includes('#tiles:is(')).every((r) => r.selector.includes('#tiles:is([data-layout="board"], [data-layout="spotlight"])')));
  }
  // Un agencement redessine la tuile : il l'emporte sur le style global (sélecteur à identifiant) et ses deux options, qui ne valent que
  // pour la grille ; il ne pose ni ombre ni verre sur une tuile (la Planche en met UNE sur sa surface).
  const baseTile = rules.filter((x) => /^#tiles/.test(x.selector) && x.selector.endsWith('> .tile') && x.decls['grid-column']); // la règle de base de chaque bloc
  assert.strictEqual(baseTile.length, 3, 'une règle de base par bloc (640, 900, 1040)');
  for (const r of baseTile) {
    assert.strictEqual(r.decls['box-shadow'], 'none', `${r.selector} : pas d'ombre de carte`);
    assert.strictEqual(r.decls.background, 'transparent');
    assert.strictEqual(r.decls['backdrop-filter'], 'none', `${r.selector} : pas de verre par tuile`);
  }
  const board = rules.find((r) => r.selector === '#tiles[data-layout="board"]');
  assert.ok(board.decls['border-radius'] && board.decls.overflow === 'hidden', 'la Planche est UNE surface arrondie, rognée');
  assert.strictEqual(board.decls.gap, '0');
  // Les boutons d'une tuile : par-dessus le titre en lecture à la souris seulement ; en flux en Édition et au toucher.
  assert.ok(rules.some((r) => r.ctx.some((c) => c === '@media (hover: hover)') && r.selector.includes('.tile-actions') && r.decls.position === 'absolute'), 'boutons par-dessus le titre au survol');
  assert.ok(rules.filter((r) => r.selector.includes('.tile-actions') && r.decls.position === 'absolute').every((r) => r.selector.startsWith('body:not([data-mode="edit"])') && r.ctx.includes('@media (hover: hover)')), 'jamais par-dessus en Édition ni sans survol');
  // Contrastes AA des textes de la Planche : titre de chiffre (muted) sur le fond teinté, dans les deux thèmes de css/style.css.
  {
    const base = parseCss(read('css', 'style.css'));
    const light = base.find((r) => r.selector === ':root' && r.ctx.length === 0);
    const dark = base.find((r) => r.ctx.length === 1 && r.ctx[0] === '@media (prefers-color-scheme: dark)' && /^:root/.test(r.selector) && r.decls['--surface-sunken']);
    assert.ok(light && dark, 'jetons clair et sombre de css/style.css');
    for (const [name, tokens] of [['clair', light.decls], ['sombre', Object.assign({}, light.decls, dark.decls)]]) {
      for (const [fg, bg] of [['--text-muted', '--surface-sunken'], ['--text', '--surface-sunken'], ['--text', '--surface'], ['--text-muted', '--surface']]) {
        const ratio = styles.contrastRatio(tokens[fg], tokens[bg]);
        assert.ok(ratio >= 4.5, `${name} : ${fg} sur ${bg} = ${ratio.toFixed(2)}`);
      }
    }
  }
  console.log('OK agencements — CSS : trois seuils = js/layouts.js, --lu = 28 px, rangées fixes, jamais de min-height, règles communes 640/900 identiques, pas d\'ombre de carte, boutons au survol seulement, contrastes AA');

  // --- 9. Câblage ---------------------------------------------------------------------------------------------------------
  {
    const main = read('js', 'main.js');
    for (const [file, prefix] of [['index.html', ''], [path.join('dev-tests', 'harness.html'), '../']]) {
      const html = read(file);
      assert.ok(html.includes(`<link rel="stylesheet" href="${prefix}css/layouts.css"`), `${file} : feuille des agencements`);
      assert.ok(html.indexOf('css/layouts.css') > html.indexOf('css/dash-styles.css'), `${file} : layouts.css APRÈS dash-styles.css`);
      assert.ok(html.includes(`<script src="${prefix}js/layouts.js"></script>`), `${file} : script`);
      const order = ['js/styles.js', 'js/layouts.js', 'js/charts.js'].map((s) => html.indexOf(s));
      assert.ok(order[0] < order[1] && order[1] < order[2], `${file} : layouts.js après styles.js et avant charts.js`);
      for (const id of ['settings-layout-section', 'settings-layout-hint', 'settings-layout-options']) assert.ok(html.includes(`id="${id}"`), `${file} : ${id}`);
      assert.ok(/<div class="settings-section" id="settings-layout-section">/.test(html), `${file} : section visible en Lecture comme en Édition (même menu Réglages)`);
      assert.ok(!/<[^>]*edit-only[^>]*>/.test(html.slice(html.indexOf('id="settings-modal"'), html.indexOf('settings.credits.title'))), `${file} : aucune partie de Langue / Style / Disposition n'est réservée à l'Édition`);
      assert.ok(html.indexOf('settings-layout-section') > html.indexOf('settings-style-section') && html.indexOf('settings-layout-section') < html.indexOf('settings.credits.title'), `${file} : Disposition entre Style et Crédits`);
      assert.ok(html.indexOf('settings-opt-uniform') > html.indexOf('settings-layout-section'), `${file} : les options de la grille suivent le choix de disposition`);
    }
    for (const needle of [
      'GristBI.layouts.plan(layoutId, state.tiles)',
      'GristBI.layouts.displayOrder(layoutId, state.tiles)',
      'GristBI.layouts.moveTarget(',
      'store.setPageLayout(store.getState().currentPageId, id)',
      'tilesContainer.dataset.layout',
      'refreshLayoutOptions(state)'
    ]) assert.ok(main.includes(needle), `main.js : ${needle}`);
    const dashCss = read('css', 'dash-styles.css');
    assert.ok(!dashCss.includes('data-layout'), 'dash-styles.css ne connaît pas les agencements');
    // Rien du plan n'est écrit en style ligne sauf les trois variables.
    const apply = main.slice(main.indexOf('function applyTileLayout'), main.indexOf('function applyTileLayout') + 1600);
    for (const v of ['--ls', '--lr', '--lc']) assert.ok(apply.includes(v), `applyTileLayout pose ${v}`);
    assert.ok(!/style\.(gridColumn|gridRow|height|width)/.test(apply), 'applyTileLayout ne pose aucun grid-column/height en ligne');
  }
  console.log('OK agencements — câblage : index.html et harnais (feuille après dash-styles, script avant charts, section Édition), render, flèches, sélecteur');

  console.log('\nTous les tests des agencements de page sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
