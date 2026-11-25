/*
 * « Ajouter une page entière » (js/advice-pages.js, niveau 3d-2 des suggestions, 25/11/2026), jugé sur les 19 tables du corpus
 * (dev-tests/lib/advice-corpus.js) et sur des tableaux fabriqués pour UN défaut :
 *
 *   node dev-tests/test-advice-pages.js
 *
 * Huit sortes d'essais :
 *  1. ÉLIGIBILITÉ : un tableau de bord vide ou une note seule n'ont rien à compléter, « évolution » seulement avec une date, jamais sans ligne ;
 *  2. JUSTESSE : sur 19 tables x 3 tableaux de bord de départ, aucune visualisation proposée ne pose une question déjà posée (ni avec le tableau de
 *     bord, ni avec une autre de la même page — recalculé par une boucle indépendante de `questionKeys`), au moins trois, des visualisations du
 *     modèle dans son ordre, deux propositions au plus, la plus fournie d'abord ;
 *  3. PORTES : trois visualisations nouvelles passent, deux non ; la moitié du modèle (un modèle de huit tuiles en exige quatre) ; le nom d'une page
 *     déjà posée (sans tenir compte des accents ni de la casse) ; un modèle sans phrase n'est jamais proposé ;
 *  4. EXTINCTION : à force de poser les pages proposées la liste se vide en trois pages au plus, sans jamais reposer une question ;
 *  5. UN SEUL PROFILAGE : trois modèles, un seul `suggestTiles` ; `models.build` rend la même chose avec ou sans contexte partagé ;
 *  6. PHRASES : fr/en sans variable orpheline, les titres cités (trois au plus, puis « … »), le nom de la page ;
 *  7. ROBUSTESSE : entrées hostiles, entrées gelées (jamais modifiées), déterminisme, 300 000 lignes ; HYGIÈNE du fichier ;
 *  8. CÂBLAGE du panneau (index.html, harnais, ordre des scripts, ouverture / langue / fermeture, les trois chemins d'ajout, le clic).
 *
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir HYPOTHESES.md, niveau 3d-2).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const advice = require('../js/advice.js');
const complete = require('../js/advice-complete.js');
const models = require('../js/models.js');
const pages = require('../js/advice-pages.js');
const i18n = require('../js/i18n.js');
const corpus = require('./lib/advice-corpus.js');
const { readMain } = require('./lib/helpers.js');

const tables = corpus.build();
const t = (key, vars) => i18n.t(key, vars);
i18n.setLang('fr');

// La clé d'une « question » recalculée ICI, sans `questionKeys` : barres / courbe / anneau / treemap / entonnoir d'une même mesure, d'un même axe et d'un
// même agrégat sont UNE question ; un chiffre clé, une autre. Les autres types ne sont pas comparés (aucun doublon à y chercher dans les modèles).
const plainKey = (tile) => {
  const agg = tile.aggFn || 'sum';
  const measure = agg === 'count' ? '*' : tile.measure;
  if (['bar', 'line', 'pie', 'treemap', 'funnel'].indexOf(tile.type) !== -1) return ['ranked', tile.dimension, measure, agg, tile.seriesColumn || ''].join('|');
  if (tile.type === 'kpi') return ['value', measure, agg].join('|');
  return null;
};
const propose = (table, tiles, pageList, extra) => {
  advice.setColumnInfo(table.info || {});
  return pages.propose(table.rows, tiles, pageList || [{ name: 'Page 1' }], Object.assign({ t, lang: 'fr', columnInfo: table.info }, extra || {}));
};
// Trois tableaux de bord de départ par table : la meilleure suggestion seule ; les trois premières ; la page « vue d'ensemble » du modèle déjà posée.
const startsOf = (table) => {
  advice.setColumnInfo(table.info || {});
  const list = advice.suggestTiles(table.rows, undefined, { limit: 3, t, lang: 'fr', columnInfo: table.info });
  const asTile = (s, i) => Object.assign({ id: 's' + i }, s.tileData);
  const starts = [list.slice(0, 1).map(asTile), list.map(asTile)];
  const built = models.build('vue-d-ensemble', table.rows, undefined, { t });
  starts.push(built.ok ? built.tiles.map((tile, i) => Object.assign({ id: 'm' + i }, tile)) : []);
  return starts.filter((s) => s.length);
};

// ---------------------------------------------------------------------------------------------------------------------
// 1. ÉLIGIBILITÉ
// ---------------------------------------------------------------------------------------------------------------------
{
  const ventes = tables.find((x) => x.name === 'ventes');
  assert.deepStrictEqual(propose(ventes, []).proposals, [], 'un tableau de bord vide ne se complète pas');
  assert.strictEqual(propose(ventes, []).reason, 'empty');
  assert.strictEqual(propose(ventes, [{ id: 'n', type: 'text', text: 'Une note' }]).reason, 'empty', 'une note seule n\'est pas une visualisation posée');
  assert.strictEqual(pages.propose([], [{ id: 'a', type: 'kpi', measure: 'Montant', aggFn: 'sum' }], [], { t }).reason, 'rows', 'aucune ligne');
  assert.deepStrictEqual(pages.propose([], [{ id: 'a', type: 'kpi' }], [], { t }).proposals, []);
  // Un histogramme : une question qu'aucun des trois modèles ne pose (un chiffre clé ou une barre y retirerait une visualisation nouvelle).
  const one = [{ id: 'a', type: 'histogram', measure: 'Montant', title: 'Répartition' }];
  const withDate = propose(ventes, one);
  assert.ok(withDate.proposals.length >= 1, 'un tableau de bord commencé reçoit une proposition');
  // « évolution » demande une date : jamais sur une table qui n'en a pas.
  const noDate = tables.filter((x) => !models.build('evolution', x.rows, undefined, { t }).ok);
  assert.ok(noDate.length >= 5, 'le corpus a des tables sans axe temporel : ' + noDate.length);
  noDate.forEach((table) => {
    startsOf(table).forEach((start) => assert.ok(!propose(table, start).proposals.some((p) => p.model === 'evolution'), `${table.name} : pas d'évolution sans date`));
  });
  // Une table dont aucun modèle n'est constructible (ni catégorie, ni date : une mesure seule) n'a aucune proposition.
  const flat = { name: 'plat', rows: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Montant: 10 + (i % 9) * 2.5 })) };
  assert.ok(models.ids().every((id) => !models.build(id, flat.rows, undefined, { t }).ok), 'la table plate n\'a aucun modèle constructible');
  assert.deepStrictEqual(propose(flat, one).proposals, [], 'aucun modèle constructible : aucune proposition');
  console.log(`OK éligibilité — vide / note seule / aucune ligne = rien, évolution seulement avec une date (${noDate.length} tables sans), une table plate n'a aucune page`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. JUSTESSE
// ---------------------------------------------------------------------------------------------------------------------
let totalProposals = 0;
let totalChecks = 0;
{
  tables.forEach((table) => {
    startsOf(table).forEach((start, si) => {
      const res = propose(table, start);
      assert.ok(res.proposals.length <= pages.MAX_PROPOSALS, `${table.name}/${si} : deux propositions au plus`);
      const keys = Object.keys(table.rows[0]);
      const existing = new Set(start.map(plainKey).filter(Boolean));
      res.proposals.forEach((p, pi) => {
        totalProposals++;
        assert.ok(p.tiles.length >= pages.MIN_NEW, `${table.name}/${si}/${p.model} : au moins ${pages.MIN_NEW} visualisations nouvelles (${p.tiles.length})`);
        assert.ok(p.tiles.length <= p.total, 'jamais plus que le modèle');
        assert.ok(p.tiles.length * 2 >= p.total, `${table.name}/${p.model} : au moins la moitié du modèle`);
        // Les visualisations sont celles du modèle, dans son ordre.
        const built = models.build(p.model, table.rows, undefined, { t });
        assert.ok(built.ok && built.pageName === p.pageName, `${table.name}/${p.model} : le modèle est constructible, même nom de page`);
        let at = -1;
        p.tiles.forEach((tile) => {
          const idx = built.tiles.findIndex((b, i) => i > at && JSON.stringify(b) === JSON.stringify(tile));
          assert.ok(idx > at, `${table.name}/${p.model} : « ${tile.title} » est une visualisation du modèle, dans l'ordre`);
          at = idx;
          assert.ok(!('id' in tile), 'sans id : la page est posée par l\'appelant');
          assert.ok(tile.title, 'un titre');
          [tile.dimension, tile.measure, tile.seriesColumn].filter(Boolean).forEach((c) => assert.ok(keys.indexOf(c) !== -1, `${table.name}/${p.model} : la colonne « ${c} » existe`));
        });
        // Aucune question déjà posée, ni deux fois la même dans la page.
        const seen = new Set(existing);
        p.tiles.forEach((tile) => {
          const k = plainKey(tile);
          totalChecks++;
          if (!k) return;
          assert.ok(!seen.has(k), `${table.name}/${si}/${p.model} : « ${tile.title} » pose une question déjà posée (${k})`);
          seen.add(k);
        });
        assert.strictEqual(p.reasonVars.n, p.tiles.length, 'la phrase compte les visualisations NOUVELLES');
        assert.strictEqual(p.titleVars.page, p.pageName);
        if (pi > 0) {
          const prev = res.proposals[pi - 1];
          assert.ok(prev.tiles.length > p.tiles.length || (prev.tiles.length === p.tiles.length && prev.order < p.order), `${table.name}/${si} : la plus fournie d'abord`);
        }
      });
    });
  });
  assert.ok(totalProposals >= 25, 'le corpus produit de vraies propositions : ' + totalProposals);
  console.log(`OK justesse — 19 tables x 3 tableaux de bord de départ, ${totalProposals} propositions, ${totalChecks} visualisations vérifiées : aucune question déjà posée, ni deux fois la même, dans l'ordre du modèle`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. PORTES
// ---------------------------------------------------------------------------------------------------------------------
{
  const ventes = tables.find((x) => x.name === 'ventes');
  const tickets = tables.find((x) => x.name === 'tickets');
  advice.setColumnInfo(tickets.info || {});
  const base = [{ id: 'a', type: 'histogram', measure: 'Montant', title: 'Répartition' }]; // aucune question des modèles
  // Trois visualisations nouvelles passent, deux non : on pose une partie du modèle « évolution » de ventes (3 tuiles) comme déjà posée.
  const evo = models.build('evolution', ventes.rows, undefined, { t });
  assert.ok(evo.ok && evo.tiles.length === 3, 'ventes : évolution à trois visualisations');
  const asPosed = (tiles) => tiles.map((tile, i) => Object.assign({ id: 'p' + i }, tile));
  assert.ok(propose(ventes, base).proposals.some((p) => p.model === 'evolution' && p.tiles.length === 3), 'trois nouvelles : la page est proposée');
  assert.ok(!propose(ventes, base.concat(asPosed(evo.tiles.slice(0, 1)))).proposals.some((p) => p.model === 'evolution'), 'deux nouvelles : pas de page');
  assert.ok(!propose(ventes, base.concat(asPosed(evo.tiles))).proposals.some((p) => p.model === 'evolution'), 'tout est déjà posé : pas de page');
  // La page ne contient QUE ce qui est nouveau.
  const tickEvo = models.build('evolution', tickets.rows, undefined, { t });
  const partial = propose(tickets, asPosed(tickEvo.tiles.slice(0, 1)).concat(base));
  const evoProposal = partial.proposals.find((p) => p.model === 'evolution');
  if (evoProposal) assert.ok(evoProposal.tiles.length < tickEvo.tiles.length, 'ce qui est déjà posé n\'est pas répété dans la page');
  // Le nom d'une page déjà posée (accents et casse indifférents).
  ['Évolution', 'evolution', ' ÉVOLUTION '].forEach((name) => {
    assert.ok(!propose(ventes, base, [{ name }]).proposals.some((p) => p.model === 'evolution'), `page « ${name} » déjà posée`);
  });
  assert.ok(propose(ventes, base, [{ name: 'Évolutions du marché' }]).proposals.some((p) => p.model === 'evolution'), 'un autre nom ne bloque rien');
  // La moitié du modèle : un modèle de huit tuiles en exige quatre (aucun modèle réel n'est assez grand pour que la règle morde).
  models.MODELS.grand = { pageKey: 'models.page.overview', needs: ['category'], required: 'bar', slots: [
    { type: 'kpi', n: 2 }, { type: 'bar', n: 2, dim: 'plain' }, { type: 'pie', n: 1, dim: 'plain' }, { type: 'treemap', n: 1, dim: 'plain' }, { type: 'pivot', n: 1, dim: 'plain' }, { type: 'line', n: 1 }
  ] };
  pages.REASON_KEYS.grand = 'advice.pages.reason.overview';
  try {
    const table = tickets;
    const big = models.build('grand', table.rows, undefined, { t });
    assert.ok(big.ok && big.tiles.length >= 7, 'modèle fabriqué : ' + (big.tiles && big.tiles.length) + ' tuiles');
    // 3 visualisations nouvelles sur 7 ou 8 : sous la moitié, pas de page ; avec 4 nouvelles, la page passe.
    const keep = (n) => asPosed(big.tiles.slice(0, big.tiles.length - n));
    const grandOf = (posed) => propose(table, posed, [{ name: 'Page 1' }]).proposals.find((p) => p.model === 'grand');
    assert.ok(!grandOf(keep(3).concat(base)), 'trois nouvelles sur ' + big.tiles.length + ' : moins de la moitié');
    assert.ok(grandOf(keep(Math.ceil(big.tiles.length / 2)).concat(base)), 'la moitié : la page passe');
    // Un modèle sans phrase n'est jamais proposé.
    delete pages.REASON_KEYS.grand;
    assert.ok(!propose(table, base).proposals.some((p) => p.model === 'grand'), 'un modèle sans phrase n\'est jamais proposé');
  } finally {
    delete models.MODELS.grand;
    delete pages.REASON_KEYS.grand;
  }
  // Chaque modèle réel a sa phrase.
  models.ids().forEach((id) => assert.ok(pages.REASON_KEYS[id] && i18n.STRINGS[pages.REASON_KEYS[id]], `phrase du modèle ${id}`));
  // Deux visualisations de la même page qui posent la même question n'en font qu'une : une table à UNE seule catégorie.
  {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, Region: ['Nord', 'Sud', 'Est'][i % 3], Montant: 100 + (i % 7) * 13.5, Qte: 1.5 + (i % 5) }));
    const res = pages.propose(rows, [{ id: 'a', type: 'histogram', measure: 'Montant', title: 'Répartition' }], [{ name: 'Page 1' }], { t });
    assert.ok(res.proposals.length >= 1, 'la table à une catégorie reçoit au moins une page');
    res.proposals.forEach((p) => {
      const keys = p.tiles.map(plainKey).filter(Boolean);
      assert.strictEqual(new Set(keys).size, keys.length, `${p.model} : jamais deux fois la même question dans la page`);
    });
  }
  console.log('OK portes — 3 nouvelles passent / 2 non, tout posé = rien, seulement le nouveau, nom déjà posé (accents, casse), moitié du modèle, modèle sans phrase, pas de doublon dans la page');
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. EXTINCTION
// ---------------------------------------------------------------------------------------------------------------------
{
  let steps = 0;
  tables.forEach((table) => {
    startsOf(table).forEach((start, si) => {
      const posedTiles = start.slice();
      const posedPages = [{ name: 'Page 1' }];
      const proposedModels = [];
      for (let guard = 0; guard < 6; guard++) {
        const res = propose(table, posedTiles, posedPages);
        if (!res.proposals.length) break;
        const first = res.proposals[0];
        assert.ok(proposedModels.indexOf(first.model) === -1, `${table.name}/${si} : le modèle ${first.model} est reproposé après avoir été posé`);
        proposedModels.push(first.model);
        posedPages.push({ name: first.pageName });
        first.tiles.forEach((tile, i) => posedTiles.push(Object.assign({ id: `x${guard}_${i}` }, tile)));
        steps++;
      }
      assert.ok(proposedModels.length <= models.ids().length, `${table.name}/${si} : au plus ${models.ids().length} pages`);
      assert.deepStrictEqual(propose(table, posedTiles, posedPages).proposals, [], `${table.name}/${si} : la liste est vide à la fin`);
      // Même sans que le NOM de la page ait été posé (la personne l'a renommée), les visualisations posées suffisent à éteindre la proposition.
      const renamed = propose(table, posedTiles, [{ name: 'Mon tableau' }]);
      assert.deepStrictEqual(renamed.proposals, [], `${table.name}/${si} : les visualisations posées suffisent, même sous un autre nom`);
    });
  });
  assert.ok(steps >= 15, 'le corpus a de quoi poser des pages : ' + steps);
  console.log(`OK extinction — ${steps} pages posées d'affilée, jamais un modèle reproposé, liste vide à la fin, même si la page est renommée`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. UN SEUL PROFILAGE
// ---------------------------------------------------------------------------------------------------------------------
{
  const ventes = tables.find((x) => x.name === 'ventes');
  const original = advice.suggestTiles;
  let calls = 0;
  advice.suggestTiles = function () { calls++; return original.apply(this, arguments); };
  try {
    const res = propose(ventes, [{ id: 'a', type: 'histogram', measure: 'Montant', title: 'Répartition' }]);
    assert.ok(res.proposals.length >= 1);
    assert.strictEqual(calls, 1, 'trois modèles : un seul suggestTiles (' + calls + ')');
  } finally { advice.suggestTiles = original; }
  // `models.build` avec contexte et pool partagés rend EXACTEMENT ce qu'il rend seul.
  let compared = 0;
  tables.forEach((table) => {
    advice.setColumnInfo(table.info || {});
    const ctx = advice.analyzeColumns(table.rows, undefined, table.info);
    const pool = advice.suggestTiles(table.rows, undefined, { limit: models.POOL, t, lang: 'fr', columnInfo: table.info });
    const frozen = JSON.stringify(pool);
    models.ids().forEach((id) => {
      assert.deepStrictEqual(models.build(id, table.rows, undefined, { t, ctx, pool }), models.build(id, table.rows, undefined, { t }), `${table.name}/${id} : même résultat avec le contexte partagé`);
      compared++;
    });
    assert.strictEqual(JSON.stringify(pool), frozen, `${table.name} : le pool partagé n'est jamais modifié`);
  });
  console.log(`OK profilage — trois modèles, un seul suggestTiles ; ${compared} constructions identiques avec ou sans contexte partagé, pool intact`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. PHRASES
// ---------------------------------------------------------------------------------------------------------------------
{
  let phrases = 0;
  let withEllipsis = 0;
  let withoutEllipsis = 0;
  ['fr', 'en'].forEach((lang) => {
    i18n.setLang(lang);
    tables.forEach((table) => {
      advice.setColumnInfo(table.info || {});
      const tl = (k, v) => i18n.t(k, v);
      const start = advice.suggestTiles(table.rows, undefined, { limit: 1, t: tl, lang, columnInfo: table.info }).map((s) => Object.assign({ id: 'a' }, s.tileData));
      if (!start.length) return;
      pages.propose(table.rows, start, [{ name: 'Page 1' }], { t: tl, lang, columnInfo: table.info }).proposals.forEach((p) => {
        [[p.titleKey, p.titleVars], [p.reasonKey, p.reasonVars]].forEach(([key, vars]) => {
          const s = i18n.t(key, vars);
          assert.ok(s && !/[{}]|NaN|undefined/.test(s), `${lang} ${table.name} ${key} : « ${s} »`);
          phrases++;
        });
        assert.ok(i18n.t(p.titleKey, p.titleVars).indexOf(p.pageName) !== -1, 'le titre nomme la page');
        const shown = p.reasonVars.titles.split(', ');
        const cut = p.tiles.length > pages.MAX_TITLES;
        assert.strictEqual(p.reasonVars.titles.endsWith('…'), cut, `${table.name}/${p.model} : « … » seulement quand des titres sont omis (${p.tiles.length} visualisations)`);
        assert.ok(shown.length <= pages.MAX_TITLES + 0 && p.tiles.slice(0, pages.MAX_TITLES).every((tile) => p.reasonVars.titles.indexOf(tile.title) !== -1), 'les premiers titres sont cités');
        if (cut) withEllipsis++; else withoutEllipsis++;
        assert.ok(!/\.…|…\./.test(i18n.t(p.reasonKey, p.reasonVars)), 'jamais « …. »');
      });
    });
  });
  i18n.setLang('fr');
  assert.ok(withEllipsis > 0 && withoutEllipsis > 0, 'les deux cas sont joués : ' + withEllipsis + ' / ' + withoutEllipsis);
  console.log(`OK phrases — ${phrases} phrases fr/en sans variable orpheline, titres cités trois au plus (${withEllipsis} avec « … », ${withoutEllipsis} sans)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. ROBUSTESSE ET HYGIÈNE
// ---------------------------------------------------------------------------------------------------------------------
{
  const ventes = tables.find((x) => x.name === 'ventes');
  const base = [{ id: 'a', type: 'kpi', measure: 'Montant', aggFn: 'sum' }];
  [null, undefined, 'x', 3, {}, [], [null], [1, 2], [{}]].forEach((bad) => {
    assert.doesNotThrow(() => pages.propose(bad, base, [], { t }), 'lignes ' + JSON.stringify(bad));
    assert.doesNotThrow(() => pages.propose(ventes.rows, bad, [], { t }), 'tuiles ' + JSON.stringify(bad));
    assert.doesNotThrow(() => pages.propose(ventes.rows, base, bad, { t }), 'pages ' + JSON.stringify(bad));
  });
  assert.doesNotThrow(() => pages.propose(ventes.rows, [null, 5, 'x', { type: 'kpi' }, { id: 'b' }], [null, 3, { name: 5 }, {}], { t }), 'éléments hostiles');
  assert.doesNotThrow(() => pages.propose(ventes.rows, base, [], null) && pages.propose(ventes.rows, base, [], 'x'), 'options hostiles');
  // Les entrées sont gelées en profondeur : propose ne modifie rien.
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; };
  const rows = deepFreeze(JSON.parse(JSON.stringify(ventes.rows)));
  const tilesFrozen = deepFreeze(JSON.parse(JSON.stringify(base)));
  const pagesFrozen = deepFreeze([{ name: 'Page 1', tiles: [] }]);
  assert.doesNotThrow(() => pages.propose(rows, tilesFrozen, pagesFrozen, { t }), 'entrées gelées');
  // Déterminisme.
  assert.deepStrictEqual(propose(ventes, base), propose(ventes, base), 'même entrée, même réponse');
  // 300 000 lignes.
  const big = corpus.sortedBigTable();
  const bigRows = big.rows || big;
  advice.setColumnInfo({});
  const start = Date.now();
  const res = pages.propose(bigRows, [{ id: 'a', type: 'histogram', measure: 'Montant', title: 'Répartition' }], [{ name: 'Page 1' }], { t });
  const ms = Date.now() - start;
  assert.ok(bigRows.length >= 290000 && ms < 3000, `${bigRows.length} lignes : ${ms} ms`);
  assert.ok(res.proposals.length >= 1, 'la grosse table reçoit une proposition');
  // Hygiène du fichier.
  const file = path.join(__dirname, '..', 'js', 'advice-pages.js');
  const source = fs.readFileSync(file, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  assert.ok(source.split('\n').length <= 600, 'au plus 600 lignes');
  ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch('].forEach((bad) => assert.ok(code.indexOf(bad) === -1, `le fichier est pur : « ${bad} »`));
  assert.ok(!/[àâçéèêëîïôûùü]/i.test(code), 'aucune lettre accentuée hors des commentaires : pas de texte en dur');
  const used = new Set((code.match(/'advice\.pages\.[A-Za-z.]+'/g) || []).map((k) => k.slice(1, -1)));
  assert.deepStrictEqual(Array.from(used).sort(), ['advice.pages.reason.breakdown', 'advice.pages.reason.evolution', 'advice.pages.reason.overview', 'advice.pages.title'], 'quatre clés citées en littéral');
  used.forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, `clé citée et traduite : ${k}`));
  Object.keys(i18n.STRINGS).filter((k) => /^advice\.pages\./.test(k)).forEach((k) => assert.ok(used.has(k), `clé définie et jamais utilisée : ${k}`));
  console.log(`OK robustesse — entrées hostiles, entrées gelées, déterminisme, ${bigRows.length} lignes en ${ms} ms ; hygiène : ${source.split('\n').length} lignes, pur, sans texte en dur, ${used.size} clés citées en littéral`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. CÂBLAGE
// ---------------------------------------------------------------------------------------------------------------------
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
  ['tile-pages', 'tile-pages-title', 'tile-pages-list', 'tile-pages-live'].forEach((id) => {
    assert.ok(html.indexOf(`id="${id}"`) !== -1, `index.html : #${id}`);
    assert.ok(harness.indexOf(`id="${id}"`) !== -1, `harness.html : #${id}`);
  });
  assert.ok(/<section id="tile-pages"[^>]*aria-labelledby="tile-pages-title"[^>]*\bhidden\b/.test(html), 'le bloc est une section nommée, masquée au départ');
  assert.ok(/id="tile-pages-live"[^>]*role="status"/.test(html), 'l\'annonce est une zone de statut');
  assert.ok(html.indexOf('id="tile-complete"') < html.indexOf('id="tile-pages"') && html.indexOf('id="tile-pages"') < html.indexOf('id="tile-column"'), 'après « Pour compléter », avant « Que faire avec cette colonne ? »');
  [[html, ''], [harness, '../']].forEach(([text, prefix]) => {
    const at = (n) => text.indexOf(`<script src="${prefix}js/${n}"></script>`);
    assert.ok(at('advice-complete.js') > 0 && at('models.js') > at('advice-complete.js') && at('advice-pages.js') > at('models.js'), 'advice-pages.js se charge après advice-complete.js et models.js (il les lit au chargement)');
    assert.ok(at('advice-pages.js') < at('combobox.js'), 'avant les scripts de l\'interface');
  });
  const main = readMain();
  assert.ok(/GristBI\.advicePages\.propose\(/.test(main), 'le panneau appelle le module');
  assert.ok(/function renderPages\(/.test(main) && /function hidePages\(/.test(main) && /function paintPages\(/.test(main), 'fonctions du panneau');
  assert.ok(/!tiles\.length\) \{ hidePages\(\)/.test(main), 'aucune tuile posée : rien (c\'est l\'écran d\'accueil qui propose)');
  assert.ok(/token !== pagesToken \|\| tilePanel\.hidden/.test(main), 'un calcul périmé ou un panneau refermé n\'écrit rien');
  assert.ok(/pagesShown\.rows === state\.rows && pagesShown\.lang === lang && pagesShown\.names === names && sameRefs\(pagesShown\.tiles, tiles\)/.test(main), 'rien ne se refait si lignes, langue, noms de page et tuiles sont les mêmes ; sinon la liste se recalcule');
  assert.ok(/GristBI\.advicePages\.propose\(state\.rows, tiles, state\.pages, \{ t, lang \}\)/.test(main) && /function tilesOfAllPages|const tilesOfAllPages/.test(main), 'toutes les pages comptent');
  assert.ok(/renderJoin\(\);\s*renderPages\(\);\s*columnPickEl\.value = '';/.test(main), 'ouverture du panneau : les pages se calculent');
  assert.ok(/renderJoin\(\);\s*renderPages\(\);\s*if \(columnPickEl\.value\) renderColumnHelper\(\);/.test(main), 'changement de langue : phrases refaites');
  assert.ok(/hideJoin\(\);\s*hidePages\(\);\s*hideColumnResults\(\);/.test(main), 'fermeture : propositions retirées');
  // Le clic : la page est créée PUIS ses visualisations y sont posées, l'annonce est écrite, la liste se recalcule, le focus reste dans le panneau.
  const click = main.slice(main.indexOf("tilePagesListEl.addEventListener('click'"));
  assert.ok(/store\.addPage\(item\.pageName\);\s*item\.tiles\.forEach\(\(tile, i\) => store\.addTile\(Object\.assign\(\{ id: genTileId\(i\) \}, tile\)\)\);/.test(click), 'la page est créée, puis ses visualisations posées avec un id neuf chacune');
  assert.ok(/tilePagesLiveEl\.textContent = t\('tilePanel\.pages\.added'/.test(click), 'annonce');
  assert.ok(/renderCompletion\(\);\s*renderPages\(\(\) => \{[^}]*querySelector\('button\[data-page\]'\)[^}]*\.focus\(\{ preventScroll: true \}\)/.test(click), 'listes recalculées, focus rendu APRÈS le dessin');
  // Les trois chemins d'ajout d'une tuile recalculent les pages proposées (une tuile posée peut éteindre une proposition).
  assert.ok(/store\.addTile\(Object\.assign\(\{ id \}, item\.tileData\)\);\s*flashTile\(id\);\s*tileCompleteLiveEl\.textContent[^;]*;\s*renderPages\(\);/.test(main), 'ajout depuis « Pour compléter » : les pages se recalculent');
  assert.ok(/linkTable\(item\.join\)\.then\([\s\S]{0,900}renderJoin\(\);\s*renderPages\(\);/.test(main), 'jointure posée : les pages se recalculent sur les lignes jointes');
  assert.ok(/flashTile\(id\);[^]{0,200}renderCompletion\(\);\s*renderPages\(\);\s*renderColumnHelper\(/.test(main), 'ajout depuis « Que faire avec cette colonne ? » : « Pour compléter » et les pages se recalculent');
  assert.ok(/data-page="\$\{i\}"/.test(main) && /tilePanel\.pages\.add\b/.test(main) && /page-card-types/.test(main), 'bouton « Ajouter la page » et rangée d\'icônes par carte');
  ['tilePanel.pages.title', 'tilePanel.pages.lead', 'tilePanel.pages.add', 'tilePanel.pages.addAria', 'tilePanel.pages.added'].forEach((k) => assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, k));
  const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'main-core.js'), 'utf8');
  assert.ok(/tilePagesEl, tilePagesListEl, tilePagesLiveEl/.test(core), 'références du DOM déposées pour le panneau');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ['.page-card', '.page-card-types', '.page-card-type'].forEach((sel) => assert.ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
  console.log('OK câblage — bloc du panneau, ordre des scripts, ouverture / langue / fermeture, le clic (page puis visualisations), les trois chemins d\'ajout');
}

console.log('\nOK — « Ajouter une page entière » : tous les essais passent');
