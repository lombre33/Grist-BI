/*
 * Essais du module graphique commun (js/graphique/, sur main du dépôt de dev, absent de l'alpha publiée : pas encore branché à l'interface, voir GFS-ETAT.md « Module graphique commun avec Publipostage+ ») :
 *  - HYGIÈNE : les règles que GFS applique au module du calendrier du kit et a dites s'appliquer à celui-ci (consigne 021) — modules ES par chemins relatifs, ni `import()` ni adresse,
 *    ni HTML par chaîne, ni `eval`, ni `window`/`grist`/stockage, 600 lignes au plus par fichier, moins de 81 par fonction ;
 *  - la définition v2 (lecture défensive, version, agrégat « aucun » et agrégat inconnu REFUSÉ, `measures` / `seriesColumn` exclusifs, aller-retour) et sa couverture de TOUS les champs que
 *    le formulaire de Grist BI écrit (extraits de js/main-form.js : un champ ajouté au formulaire sans l'être ici fait échouer cet essai) ;
 *  - les colonnes qu'une définition demande (dérivées d'une date, jointures, genres) ;
 *  - le calcul des points : « aucun », nulls jamais lus comme 0, ordre d'apparition, listes dont le premier élément est « L », dates avec heure ;
 *  - la lecture d'un rapport (les trois formes historiques, comparée au VRAI `js/grist-api.js`).
 * `node dev-tests/test-graphique.js`
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { read, loadApiWithFakeConfigTable } = require('./lib/helpers.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'js', 'graphique');
const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.js')).map((f) => ({ file: `js/graphique/${f}`, text: fs.readFileSync(path.join(DOSSIER, f), 'utf8') }));

// Le code sans ses commentaires ni ses chaînes : ce que les règles visent (une chaîne qui cite `innerHTML` pour l'interdire n'est pas un emploi). Même fonction que kit/test/sources.mjs.
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

// Les fonctions du code et leur longueur en lignes (de la ligne de `function` à la ligne de son `}`) : on cherche chaque `function nom(` et chaque flèche à corps de bloc `=> {`, on saute les
// parenthèses des paramètres, puis on apparie les accolades. Le code est déjà sans chaînes ni commentaires.
function longueursDeFonctions(source) {
  const sortie = [];
  const motif = /\bfunction\b[^(]*\(|=>\s*\{/g;
  let trouve;
  while ((trouve = motif.exec(source))) {
    let i = trouve.index + trouve[0].length;
    if (!trouve[0].endsWith('{')) {
      let profondeur = 1;
      while (i < source.length && profondeur > 0) { if (source[i] === '(') profondeur++; else if (source[i] === ')') profondeur--; i++; }
      i = source.indexOf('{', i);
      if (i < 0) continue;
    } else i -= 1;
    let accolades = 0;
    let j = i;
    do { if (source[j] === '{') accolades++; else if (source[j] === '}') accolades--; j++; } while (j < source.length && accolades > 0);
    const debut = source.slice(0, trouve.index).split('\n').length;
    const fin = source.slice(0, j).split('\n').length;
    sortie.push({ debut, lignes: fin - debut + 1, entete: trouve[0].slice(0, 40) });
  }
  return sortie;
}

(async () => {
  const m = await import(pathToFileURL(path.join(DOSSIER, 'index.js')).href);
  const data = require('../js/data.js');
  const i18n = require('../js/i18n.js');

  // --- Hygiène ------------------------------------------------------------------------------------------------------------
  {
    assert.ok(fichiers.length >= 6, `${fichiers.length} fichiers dans js/graphique/`);
    const connus = new Set(fichiers.map((f) => f.file));
    for (const { file, text } of fichiers) {
      assert.match(text, /^\/\/ \S/, `${file} : commentaire de tête`);
      for (const [, cible] of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)) {
        assert.match(cible, /^\.\/[a-z0-9-]+\.js$/, `${file} importe ${cible}`);
        assert.ok(connus.has(`js/graphique/${cible.slice(2)}`), `${file} importe ${cible}, qui n'existe pas dans le module`);
      }
      const corps = code(text);
      assert.doesNotMatch(corps, /\bimport\s*\(|\brequire\s*\(|https?:\/\//, `${file} : import dynamique, require ou adresse`);
      assert.doesNotMatch(corps, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, `${file} : HTML par chaîne`);
      assert.doesNotMatch(corps, /\beval\s*\(|new Function\s*\(/, `${file} : eval`);
      assert.doesNotMatch(corps, /\.setAttribute\(\s*'style'|\.style\.cssText|\.style\s*=\s/, `${file} : attribut style`);
      assert.doesNotMatch(corps, /\bgrist\b|\bwindow\b|\bparent\b|\bpostMessage\b|\bdocument\b|\bonmessage\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, `${file} : parle à Grist, à la fenêtre ou au stockage`);
      assert.doesNotMatch(corps, /console\.(log|debug|info|trace|dir)\b/, `${file} : console`);
      assert.doesNotMatch(corps, /\b(Antoine|Camille|Alex|Claude)\b/, `${file} : un prénom dans le code`);
      assert.ok(text.split('\n').length <= 600, `${file} : ${text.split('\n').length} lignes (600 au plus)`);
      for (const f of longueursDeFonctions(corps)) assert.ok(f.lignes < 81, `${file}:${f.debut} ${f.entete} fait ${f.lignes} lignes (moins de 81)`);
    }
    // Le détecteur de longueur voit bien une longue fonction (sinon l'essai ci-dessus ne prouverait rien).
    const longue = `function a() {\n${'  x();\n'.repeat(90)}}\n`;
    assert.strictEqual(longueursDeFonctions(longue)[0].lignes, 92, 'le mesureur compte les lignes d\'une fonction');
    assert.strictEqual(longueursDeFonctions('const f = (a) => {\n  return a;\n};\n')[0].lignes, 3, 'et celles d\'une flèche à corps de bloc');
    console.log(`OK hygiène — ${fichiers.length} fichiers : imports relatifs, rien d'externe, 600 lignes et 80 par fonction`);
  }

  // --- La définition ---------------------------------------------------------------------------------------------------------
  {
    const tuile = { id: 'tile_1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par région', titleKey: 'tile.title.measureByDim', titleVars: { measure: 'Montant', dimension: 'Region' }, sortMode: 'value-desc', palette: 'okabe', numberFormat: { mode: 'custom', decimals: 1, notation: 'compact' }, horizontal: true };
    const lue = m.lireDefinition(tuile);
    assert.strictEqual(lue.ok, true);
    assert.strictEqual(lue.definition.v, 2, 'version 2');
    assert.ok(!('id' in lue.definition), 'l\'id appartient au rapport, pas à la définition');
    assert.deepStrictEqual(lue.ignores, [], 'une tuile de Grist BI se lit sans rien perdre');
    const retour = m.definitionVersTuile(lue.definition, 'tile_1');
    assert.deepStrictEqual(retour.tuile, tuile, 'aller-retour : la tuile revient identique (version retirée, id remis)');
    assert.deepStrictEqual(m.ecrireDefinition(lue.definition), lue.definition, 'une définition lue se réécrit à l\'identique');
    assert.strictEqual(JSON.stringify(m.ecrireDefinition(tuile)), JSON.stringify(m.ecrireDefinition(m.ecrireDefinition(tuile))), 'écrire est idempotent');
    assert.strictEqual(m.ecrireDefinition({ type: 'inconnue' }), null);

    // Chaque forme de Grist BI est reconnue ; une forme à venir ne devient JAMAIS des barres.
    assert.strictEqual(m.FORMES.length, 23);
    for (const type of m.FORMES) assert.strictEqual(m.lireDefinition({ type }).ok, true, type);
    for (const bad of [{ type: 'hexagon' }, { type: '' }, { type: undefined }, {}, { type: ['bar'] }]) assert.deepStrictEqual(m.lireDefinition(bad), { ok: false, raison: 'forme' }, JSON.stringify(bad));
    for (const bad of [null, undefined, 'bar', 42, [], [{ type: 'bar' }]]) assert.deepStrictEqual(m.lireDefinition(bad), { ok: false, raison: 'invalide' }, String(bad));

    // La version : plus récente = grisée avec sa raison, jamais mal dessinée ; une `v: 1` est refusée (Publipostage+ n'en a jamais écrit dans un document).
    assert.deepStrictEqual(m.lireDefinition({ v: 3, type: 'bar' }), { ok: false, raison: 'version' });
    assert.deepStrictEqual(m.lireDefinition({ v: 1, kind: 'bar' }), { ok: false, raison: 'v1' });
    for (const v of [0, -1, 2.5, '2', null]) assert.deepStrictEqual(m.lireDefinition({ v, type: 'bar' }), { ok: false, raison: 'invalide' }, `v = ${JSON.stringify(v)}`);
    assert.strictEqual(m.lireDefinition({ v: 2, type: 'bar' }).ok, true);

    // « aucun » est un agrégat à part ; un agrégat inconnu n'est PAS lu comme une somme.
    assert.strictEqual(m.lireDefinition({ type: 'bar', aggFn: 'none' }).definition.aggFn, 'none');
    for (const aggFn of ['sum', 'avg', 'count', 'min', 'max']) assert.strictEqual(m.lireDefinition({ type: 'bar', aggFn }).definition.aggFn, aggFn);
    for (const aggFn of ['median', 'SUM', '', 7, true]) assert.deepStrictEqual(m.lireDefinition({ type: 'bar', aggFn }), { ok: false, raison: 'agregat', champ: 'aggFn' }, `aggFn = ${JSON.stringify(aggFn)}`);
    assert.deepStrictEqual(m.lireDefinition({ type: 'combo', aggFnY: 'median' }), { ok: false, raison: 'agregat', champ: 'aggFnY' });
    assert.strictEqual(m.lireDefinition({ type: 'bar', aggFn: undefined }).ok, true, 'un agrégat absent (types sans agrégat) est permis');

    // Les réglages qui changent le calcul refusent ; ceux d'aspect s'écartent.
    assert.deepStrictEqual(m.lireDefinition({ type: 'bar', measureMode: 'quantum' }), { ok: false, raison: 'valeur', champ: 'measureMode' });
    for (const measureMode of m.lireDefinition ? ['brut', 'cumulative', 'ytd', 'yoy'] : []) assert.strictEqual(m.lireDefinition({ type: 'bar', measureMode }).ok, true, measureMode);
    const aspect = m.lireDefinition({ type: 'line', sortMode: 'chaos', lineShape: 'zigzag', refLine: 'median', palette: 'Bad Palette!' });
    assert.strictEqual(aspect.ok, true);
    assert.deepStrictEqual(aspect.ignores.sort(), ['lineShape', 'palette', 'refLine', 'sortMode']);
    assert.strictEqual(m.lireDefinition({ type: 'bar', sortMode: 'axis' }).definition.sortMode, 'axis', '« axis » : tri par abscisse (nouveau en v2)');

    // Mesures et série : jamais les deux.
    const deux = m.lireDefinition({ type: 'bar', seriesColumn: 'Produit', measures: [{ column: 'Montant' }] });
    assert.deepStrictEqual(deux, { ok: false, raison: 'series', champ: 'measures' });
    const mesures = m.lireDefinition({ type: 'bar', aggFn: 'none', measures: [{ column: 'A', color: '#AABBCC', type: 'line', aggFn: 'sum' }, { column: 'B', color: 'rouge', type: 'area' }, { nom: 'sans colonne' }, 'texte'] });
    assert.strictEqual(mesures.ok, true);
    assert.deepStrictEqual(mesures.definition.measures, [{ column: 'A', aggFn: 'sum', color: '#aabbcc', type: 'line' }, { column: 'B' }], 'couleur en minuscules, couleur et type invalides écartés, entrées sans colonne écartées');
    assert.ok(mesures.ignores.includes('measures'), 'les mesures écartées sont dites');
    assert.strictEqual(m.lireDefinition({ type: 'bar', measures: Array.from({ length: 12 }, (_, i) => ({ column: `C${i}` })) }).definition.measures.length, 8, '8 séries au plus (comme Publipostage+)');
    assert.deepStrictEqual(m.lireDefinition({ type: 'bar', measures: [{ column: 'A', aggFn: 'median' }] }), { ok: false, raison: 'agregat', champ: 'measures' });

    // Entrée hostile : une configuration est écrite par n'importe qui dans le document.
    const hostile = JSON.parse('{"type":"bar","__proto__":{"polluted":true},"constructor":{"x":1},"dimension":"x\\"><img src=x onerror=alert(1)>","measure":' + JSON.stringify('M'.repeat(300)) + ',"title":{"a":1},"horizontal":"oui","bins":"12","drillDimensions":["A",5,null,"B"],"radarAxes":"A","numberFormat":{"mode":"evil"},"titleVars":{"__proto__":"x","ok":"y","obj":{"a":1},"n":3}}');
    const lueHostile = m.lireDefinition(hostile);
    assert.strictEqual(lueHostile.ok, true);
    const d = lueHostile.definition;
    assert.strictEqual({}.polluted, undefined, 'aucune pollution du prototype');
    assert.ok(!('measure' in d) && !('title' in d) && !('horizontal' in d) && !('bins' in d) && !('numberFormat' in d) && !('radarAxes' in d), 'trop long, mauvais type : écartés');
    assert.deepStrictEqual(d.drillDimensions, ['A', 'B']);
    assert.deepStrictEqual(d.titleVars, { ok: 'y', n: 3 });
    assert.strictEqual(d.dimension, 'x"><img src=x onerror=alert(1)>', 'le texte d\'une colonne est gardé tel quel : c\'est à celui qui l\'écrit dans une page de l\'échapper');
    assert.ok(lueHostile.ignores.includes('constructor'), 'une clé inconnue est dite');
    assert.strictEqual(m.definitionVersTuile({ type: 'bar' }, 'x"><img src=x onerror=1>').tuile.id, 'x___img_src_x_onerror_1_', 'l\'id d\'une tuile ne porte jamais de guillemet ni de chevron');
    assert.strictEqual(m.definitionVersTuile({ type: 'bar' }, '').tuile.id, 'tile');
    assert.deepStrictEqual(m.definitionVersTuile({ type: 'zzz' }, 'a'), { ok: false, raison: 'forme' });

    // Tous les champs que le formulaire écrit sont portés : extraits de main-form.js (un champ de plus au formulaire sans l'être ici fait échouer).
    const formulaire = read('js', 'main-form.js');
    const initiaux = /const tileData = \{ ([^}]+) \};/.exec(formulaire)[1].split(',').map((s) => s.trim());
    const posés = Array.from(formulaire.matchAll(/tileData\.([A-Za-z]+) =/g), (r) => r[1]);
    const champs = new Set([...initiaux, ...posés]);
    assert.ok(champs.size > 50, `${champs.size} champs extraits du formulaire`);
    const manquants = [...champs].filter((c) => !m.CHAMPS_CONNUS.includes(c));
    assert.deepStrictEqual(manquants, [], 'champs du formulaire que le module ne lit pas');
    // Les tuiles réelles (jeu de test de charge) se lisent sans rien perdre.
    for (const t of require('../js/demo-data.js').defaultLargeTiles()) {
      const l = m.lireDefinition(t);
      assert.strictEqual(l.ok, true, t.id);
      assert.deepStrictEqual(l.ignores, [], `${t.id} : rien perdu`);
      assert.deepStrictEqual(m.definitionVersTuile(l.definition, t.id).tuile, t, `${t.id} : aller-retour`);
    }
    console.log('OK définition — version, « aucun », agrégat inconnu refusé, séries exclusives, entrée hostile, tous les champs du formulaire portés');
  }

  // --- Les colonnes d'une définition -------------------------------------------------------------------------------------------
  {
    const col = (definition) => m.colonnesDeDefinition(definition);
    assert.deepStrictEqual(col({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }), [{ id: 'Region' }, { id: 'Montant', genre: 'number' }], 'catégorie sans genre exigé, mesure numérique');
    assert.deepStrictEqual(col({ type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'count' }), [{ id: 'Region' }, { id: 'Montant' }], 'compter des lignes : aucune exigence sur la colonne');
    assert.deepStrictEqual(col({ type: 'bar', dimension: 'Region', aggFn: 'none', measure: 'Montant' }), [{ id: 'Region' }, { id: 'Montant', genre: 'number' }], '« aucun » : un point par ligne, sur un nombre');
    assert.deepStrictEqual(col({ type: 'bar', dimension: 'Date.Annee', drillDimensions: ['Date.Trimestre', 'Date.Mois'], measure: 'Montant', aggFn: 'sum' }), [{ id: 'Date', genre: 'date' }, { id: 'Montant', genre: 'number' }], 'les dérivées d\'une date se lisent sur la date, une seule fois');
    assert.deepStrictEqual(col({ type: 'bar', dimension: 'Date', measure: 'Montant', aggFn: 'sum', measureMode: 'ytd', dateColumn: 'Date' }), [{ id: 'Date', genre: 'date' }, { id: 'Montant', genre: 'number' }], 'une colonne demandée deux fois : le genre précis gagne');
    assert.deepStrictEqual(col({ type: 'calendar', dimension: 'Jour', measure: 'Montant', aggFn: 'sum' }), [{ id: 'Jour', genre: 'date' }, { id: 'Montant', genre: 'number' }], 'le calendrier demande une date');
    assert.deepStrictEqual(col({ type: 'gantt', dimension: 'Tache', startColumn: 'Debut', endColumn: 'Fin', seriesColumn: 'Statut' }), [{ id: 'Tache' }, { id: 'Statut' }, { id: 'Debut', genre: 'date' }, { id: 'Fin', genre: 'date' }]);
    assert.deepStrictEqual(col({ type: 'pivot', dimension: 'A', columnDimension: 'B', measure: 'M', aggFn: 'sum' }), [{ id: 'A' }, { id: 'B' }, { id: 'M', genre: 'number' }]);
    assert.deepStrictEqual(col({ type: 'combo', dimension: 'A', measure: 'M', aggFn: 'sum', measureY: 'N', aggFnY: 'count' }), [{ id: 'A' }, { id: 'M', genre: 'number' }, { id: 'N' }], 'l\'agrégat de la courbe décide de la 2e mesure');
    assert.deepStrictEqual(col({ type: 'scatter', dimension: 'P', measure: 'X', measureY: 'Y', measureSize: 'S', aggFn: 'avg', aggFnSize: 'count' }), [{ id: 'P' }, { id: 'X', genre: 'number' }, { id: 'Y', genre: 'number' }, { id: 'S' }]);
    assert.deepStrictEqual(col({ type: 'kpi', measure: 'M', aggFn: 'sum', trendDimension: 'Annee', targetColumn: 'Obj' }), [{ id: 'Annee' }, { id: 'M', genre: 'number' }, { id: 'Obj', genre: 'number' }]);
    assert.deepStrictEqual(col({ type: 'radar', radarAxisMode: 'columns', radarAxes: ['Maths', 'Francais'], radarEntityColumn: 'Eleve' }), [{ id: 'Eleve' }, { id: 'Maths', genre: 'number' }, { id: 'Francais', genre: 'number' }]);
    assert.deepStrictEqual(col({ type: 'table', columns: ['A', 'B', 'A'] }), [{ id: 'A' }, { id: 'B' }], 'table plate : les colonnes cochées, sans doublon, sans exigence');
    assert.deepStrictEqual(col({ type: 'text', text: '# Titre', dimension: 'ignoré' }), [], 'une note ne demande aucune colonne');
    assert.deepStrictEqual(col({ type: 'bar', aggFn: 'none', dimension: 'D', measures: [{ column: 'A' }, { column: 'B', aggFn: 'count' }] }), [{ id: 'D' }, { id: 'A', genre: 'number' }, { id: 'B' }], 'plusieurs mesures');
    // Une jointure n'est pas une colonne de la table de travail : dite à part.
    const jointure = m.dependancesDeDefinition({ type: 'bar', dimension: 'Clients.Nom', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Region' });
    assert.deepStrictEqual(jointure, { ok: true, colonnes: [{ id: 'Region' }, { id: 'Montant', genre: 'number' }], jointures: ['Clients.Nom'] });
    assert.deepStrictEqual(m.dependancesDeDefinition({ type: 'bar', dimension: 'Clients.Date.Annee' }).jointures, ['Clients.Date.Annee'], 'la dérivée d\'une colonne jointe est une jointure');
    assert.deepStrictEqual(m.dependancesDeDefinition({ type: 'bar', dimension: 'Clients.Nom' }).colonnes, []);
    // Une définition refusée ne demande rien (et le dit).
    assert.deepStrictEqual(m.dependancesDeDefinition({ type: 'hexagon', dimension: 'A' }), { colonnes: [], jointures: [], ok: false, raison: 'forme' });
    assert.deepStrictEqual(m.colonnesDeDefinition(null), []);
    // Le rendu est exactement la forme que `matchColumns` de Publipostage+ attend : { id, libelle?, genre? } avec les genres de l'hôte.
    for (const colonne of col({ type: 'bar', dimension: 'Date.Annee', measure: 'M', aggFn: 'sum' })) {
      assert.ok(Object.keys(colonne).every((k) => ['id', 'libelle', 'genre'].includes(k)));
      if (colonne.genre) assert.ok(m.GENRES.includes(colonne.genre));
    }
    console.log('OK colonnes — genres par rôle, dérivées de date ramenées à leur date, jointures dites à part, doublons fusionnés');
  }

  // --- Le calcul des points ------------------------------------------------------------------------------------------------------
  {
    const lignes = [
      { id: 1, r: 'Nord', m: 10 }, { id: 2, r: 'Sud', m: 4 }, { id: 3, r: 'Nord', m: null }, { id: 4, r: null, m: 6 }, { id: 5, r: 'Sud', m: null }, { id: 6, r: 'Nord', m: 20 },
    ];
    // « aucun » : un point par ligne, dans l'ordre, doublons gardés, avec l'identifiant de la ligne.
    assert.deepStrictEqual(m.groupes(lignes, 'r', 'm', 'none'), [
      { dimension: 'Nord', value: 10, ligne: 1 }, { dimension: 'Sud', value: 4, ligne: 2 }, { dimension: 'Nord', value: null, ligne: 3 },
      { dimension: null, value: 6, ligne: 4 }, { dimension: 'Sud', value: null, ligne: 5 }, { dimension: 'Nord', value: 20, ligne: 6 },
    ]);
    assert.strictEqual(m.groupes(lignes, 'r', 'm', 'none').length, lignes.length);
    assert.deepStrictEqual(m.groupes([], 'r', 'm', 'none'), []);
    // Les autres agrégats : ordre de première apparition ; les nulls ne sont JAMAIS des zéros.
    const par = (agregat) => Object.fromEntries(m.groupes(lignes, 'r', 'm', agregat).map((g) => [String(g.dimension), g.value]));
    assert.deepStrictEqual(m.groupes(lignes, 'r', 'm', 'sum').map((g) => g.dimension), ['Nord', 'Sud', null], 'ordre d\'apparition, la catégorie vide en dernier là où elle est apparue');
    assert.deepStrictEqual(par('sum'), { Nord: 30, Sud: 4, null: 6 });
    assert.deepStrictEqual(par('avg'), { Nord: 15, Sud: 4, null: 6 }, 'moyenne de 10 et 20 : le null n\'est pas un 0 (l\'ancien moteur donnait 10)');
    assert.deepStrictEqual(par('min'), { Nord: 10, Sud: 4, null: 6 }, 'minimum : le null n\'est pas un 0 (l\'ancien moteur donnait 0)');
    assert.deepStrictEqual(par('max'), { Nord: 20, Sud: 4, null: 6 });
    assert.deepStrictEqual(par('count'), { Nord: 3, Sud: 2, null: 1 }, 'un comptage compte les LIGNES du groupe');
    // Aucune valeur : moyenne, minimum, maximum = null (pas de point), somme = 0 ; jamais un faux 0 pour un minimum.
    const vides = [{ id: 1, r: 'A', m: null }, { id: 2, r: 'A', m: 'texte' }];
    for (const a of ['avg', 'min', 'max']) assert.strictEqual(m.groupes(vides, 'r', 'm', a)[0].value, null, a);
    assert.strictEqual(m.groupes(vides, 'r', 'm', 'sum')[0].value, 0);
    assert.strictEqual(m.agreger([], 'sum'), 0);
    assert.strictEqual(m.agreger([3, 'x', NaN, Infinity, 5], 'sum'), 8, 'texte, NaN et infini ne sont pas des nombres');
    // Un agrégat inconnu LÈVE, il n'est pas lu comme une somme.
    assert.throws(() => m.groupes(lignes, 'r', 'm', 'median'), RangeError);
    assert.throws(() => m.agreger([1], 'SUM'), RangeError);
    assert.throws(() => m.groupes(lignes, 'r', 'm', undefined), RangeError);
    // Comparaison avec le moteur d'origine : même résultat quand il n'y a aucune cellule vide (aucune régression pour des données pleines).
    const pleines = [{ id: 1, r: 'B', m: 3 }, { id: 2, r: 'A', m: 5 }, { id: 3, r: 'B', m: 7 }, { id: 4, r: 'C', m: 1 }];
    for (const a of ['sum', 'avg', 'count', 'min', 'max']) assert.deepStrictEqual(m.groupes(pleines, 'r', 'm', a), data.groupByAggregate(pleines, 'r', 'm', a), `${a} : identique à js/data.js sans cellule vide`);
    // Et le constat : l'ancien moteur lit un null comme 0.
    assert.strictEqual(data.groupByAggregate(lignes, 'r', 'm', 'min')[0].value, 0, 'constat : js/data.js — minimum de [10, null, 20] = 0');
    assert.strictEqual(data.groupByAggregate(lignes, 'r', 'm', 'avg')[0].value, 10, 'constat : js/data.js — moyenne de [10, null, 20] = 10');

    // Tri par abscisse : axe ordonné trié, texte laissé dans l'ordre des lignes ; stable ; vides à la fin ; sans toucher à l'entrée.
    const points = [{ dimension: 10, value: 1 }, { dimension: 2, value: 2 }, { dimension: null, value: 3 }, { dimension: 10, value: 4 }, { dimension: 1, value: 5 }];
    const copie = JSON.stringify(points);
    assert.deepStrictEqual(m.trierParAbscisse(points, 'number').map((p) => p.value), [5, 2, 1, 4, 3], 'nombres : 1, 2, 10 (pas « 10 » avant « 2 »), doublons dans l\'ordre, vide en dernier');
    assert.strictEqual(JSON.stringify(points), copie, 'la liste d\'entrée n\'est pas modifiée');
    const dates = [{ dimension: '2026-03-01' }, { dimension: '2025-12-31' }, { dimension: '2026-01-15' }];
    assert.deepStrictEqual(m.trierParAbscisse(dates, 'date').map((p) => p.dimension), ['2025-12-31', '2026-01-15', '2026-03-01']);
    const mois = [{ dimension: 'Avril' }, { dimension: 'Janvier' }];
    assert.strictEqual(m.trierParAbscisse(mois, 'text'), mois, 'un axe de texte garde l\'ordre des lignes (« Avril » ne passe pas avant « Janvier »)');

    // Ce que Publipostage+ donne : une date avec heure se lit au jour ; une liste dont le 1er élément est « L » n'est pas une marque.
    assert.strictEqual(m.jour('2026-03-04'), '2026-03-04');
    assert.strictEqual(m.jour('2026-03-04T10:20:30'), '2026-03-04');
    for (const bad of ['2026-02-30', '2026-13-01', '04/03/2026', '2026-03-04T10:20', '2026-03-04 10:20:30', 1772582400, null, undefined, '', '2026-3-4']) assert.strictEqual(m.jour(bad), null, String(bad));
    assert.strictEqual(m.jour('2024-02-29'), '2024-02-29', 'année bissextile');
    assert.strictEqual(m.jour('2025-02-29'), null);
    assert.strictEqual(data.parseDateValue('2026-03-04T10:20:30'), null, 'constat : js/data.js ne lit pas une date avec heure');
    assert.strictEqual(m.texteDeCellule(['L', 'M']), 'L, M');
    assert.strictEqual(data.cellText(['L', 'M']), 'M', 'constat : js/data.js lit « L » comme la marque de liste de Grist et perd le choix « L »');
    assert.strictEqual(m.texteDeCellule(['a', 'b']), 'a, b');
    assert.strictEqual(m.texteDeCellule(['L', 'a', 'b']), 'L, a, b', 'la marque de Grist n\'existe plus : l\'hôte donne des valeurs');
    assert.strictEqual(m.texteDeCellule([]), '');
    assert.strictEqual(m.texteDeCellule(null), '');
    assert.strictEqual(m.texteDeCellule(3), '3');
    assert.strictEqual(m.texteDeCellule(false), 'false');
    assert.strictEqual(m.texteDeCellule({ a: 1 }), '');
    console.log('OK points — « aucun » (un point par ligne), nulls jamais lus comme 0, agrégat inconnu refusé, tri par abscisse, jour d\'une date avec heure, liste « L »');
  }

  // --- Un rapport ----------------------------------------------------------------------------------------------------------------
  {
    const tuiles = [
      { id: 't1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par région' },
      { id: 't2', type: 'kpi', measure: 'Montant', aggFn: 'sum', trendDimension: 'Annee' },
    ];
    const formats = {
      tableau: JSON.stringify(tuiles),
      intermediaire: JSON.stringify({ tiles: tuiles, bookmarks: [] }),
      courant: JSON.stringify({ pages: [{ id: 'p1', name: 'Ventes', tiles: [tuiles[0]], layout: 'report' }, { id: 'p2', name: 'Détail', tiles: [tuiles[1]] }], currentPageId: 'p2', bookmarks: [], blend: null }),
    };
    // Comparé au VRAI js/grist-api.js (`normalizeConfig` via `loadConfig`) : mêmes pages, mêmes tuiles, même page courante.
    for (const [nom, texte] of Object.entries(formats)) {
      const { api, cfg } = loadApiWithFakeConfigTable(data, i18n);
      cfg.id.push(1); cfg.TableId.push('Ventes'); cfg.ConfigJSON.push(texte);
      const alpha = JSON.parse(JSON.stringify(await api.loadConfig('Ventes'))); // copie : `api` vit dans un autre contexte (`vm`), ses tableaux n'ont pas notre prototype
      const lu = m.lireRapport({ id: 1, table: 'Ventes', config: texte, tableExists: true });
      assert.strictEqual(lu.ok, true, nom);
      assert.strictEqual(lu.table, 'Ventes');
      assert.deepStrictEqual(lu.pages.map((p) => p.id), alpha.pages.map((p) => p.id), `${nom} : ids de pages`);
      assert.deepStrictEqual(lu.pages.map((p) => p.nom), alpha.pages.map((p) => p.name), `${nom} : noms de pages`);
      assert.deepStrictEqual(lu.pages.map((p) => p.tuiles.map((t) => t.id)), alpha.pages.map((p) => p.tiles.map((t) => t.id)), `${nom} : ids de tuiles`);
      assert.strictEqual(lu.pageCourante, alpha.currentPageId, `${nom} : page courante`);
      lu.pages.forEach((p, i) => p.tuiles.forEach((t, j) => {
        assert.strictEqual(t.grisee, null, `${nom} : ${t.id} se dessine`);
        assert.deepStrictEqual(m.definitionVersTuile(t.definition, t.id).tuile, alpha.pages[i].tiles[j], `${nom} : la tuile ${t.id} revient identique à celle d'alpha`);
      }));
    }
    assert.strictEqual(m.lireRapport({ config: formats.courant }).pages[0].disposition, 'report', 'la disposition de la page est portée');
    assert.strictEqual(m.lireRapport({ config: formats.courant }).pages[1].disposition, undefined, 'la grille n\'écrit rien');
    assert.strictEqual(m.lireRapport({ config: formats.courant }).table, null, 'sans table donnée, null');
    assert.strictEqual(m.lireRapport(formats.tableau).ok, true, 'le texte seul se lit aussi');

    // Illisible : une raison, jamais une exception.
    assert.deepStrictEqual(m.lireRapport({ config: '{pas du json' }), { ok: false, raison: 'json' });
    for (const config of [undefined, null, '', '   ', 5, {}]) assert.deepStrictEqual(m.lireRapport({ config }), { ok: false, raison: 'invalide' }, JSON.stringify(config));
    assert.deepStrictEqual(m.lireRapport(null), { ok: false, raison: 'invalide' });
    assert.deepStrictEqual(m.lireRapport({ config: ' '.repeat(10) + '['.repeat(4000001) }), { ok: false, raison: 'taille' });
    assert.strictEqual(m.lireRapport({ config: '7' }).pages[0].tuiles.length, 0, 'une valeur sans forme de rapport = un rapport vide, comme alpha');
    assert.strictEqual(m.lireRapport({ config: '{"pages":[]}' }).pages.length, 1, 'des pages vides = une page vide');

    // Tuiles grisées avec leur raison, jamais mal dessinées.
    const grisees = m.lireRapport({ config: JSON.stringify([
      { id: 'a', type: 'hologramme' }, { id: 'b', type: 'bar', v: 9 }, { id: 'c', type: 'bar', aggFn: 'median' },
      { id: 'd', type: 'bar', dimension: 'Clients.Nom', measure: 'Montant', aggFn: 'sum' }, 'texte', null, { id: 'e', type: 'bar', dimension: 'Region' },
    ]) });
    const par = grisees.pages[0].tuiles;
    assert.deepStrictEqual(par.map((t) => t.grisee && t.grisee.raison), ['forme', 'version', 'agregat', 'jointure', 'invalide', 'invalide', null]);
    assert.deepStrictEqual(par[3].grisee.colonnes, ['Clients.Nom'], 'une jointure dit ses colonnes');
    assert.ok(par[3].definition, 'une tuile à jointure garde sa définition (grisée, pas perdue)');
    assert.strictEqual(par[0].definition, null);

    // Identifiants sûrs et uniques, tailles bornées, rien de copié tel quel.
    const hostile = m.lireRapport({ table: 'T', config: JSON.stringify({ pages: [
      { id: 'p"><b>', name: '<script>x</script>'.repeat(20), tiles: [{ id: 'a"><img src=x onerror=1>', type: 'bar' }, { id: 'a"><img src=x onerror=1>', type: 'bar' }, { type: 'bar' }, { id: 12, type: 'bar' }, { id: '__proto__', type: 'bar' }] },
      { id: 'p"><b>', tiles: 'pas une liste' }, 'pas une page', { id: 'p3', name: '', tiles: [], layout: 'x"><y', blend: 1 },
    ], currentPageId: 'p"><b>' }) });
    assert.strictEqual(hostile.ok, true);
    const idsTuiles = hostile.pages.flatMap((p) => p.tuiles.map((t) => t.id));
    assert.deepStrictEqual(idsTuiles, ['a___img_src_x_onerror_1_', 'a___img_src_x_onerror_1__2', 'tile', '12', '__proto__']);
    assert.ok(new Set(idsTuiles).size === idsTuiles.length, 'ids de tuile uniques');
    assert.ok(hostile.pages.every((p) => /^[A-Za-z0-9_-]+$/.test(p.id)), 'ids de page sûrs');
    assert.deepStrictEqual(hostile.pages.map((p) => p.id), ['p___b_', 'p___b__2', 'p3']);
    assert.strictEqual(hostile.pages[0].nom.length, 120, 'nom de page borné');
    assert.strictEqual(hostile.pages[2].nom, 'Page 3', 'un nom vide devient « Page n »');
    assert.strictEqual(hostile.pages[2].disposition, undefined, 'une disposition mal formée est écartée');
    assert.strictEqual(hostile.pageCourante, 'p___b_', 'la page courante est la PREMIÈRE page de cet id (comme alpha)');
    assert.strictEqual(({}).polluted, undefined);

    // Les bornes : 50 pages, 300 tuiles.
    const beaucoup = m.lireRapport({ config: JSON.stringify({ pages: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, tiles: Array.from({ length: 10 }, (__, j) => ({ id: `t${i}_${j}`, type: 'bar' })) })) }) });
    assert.strictEqual(beaucoup.pages.length, 50);
    assert.strictEqual(beaucoup.pages.reduce((n, p) => n + p.tuiles.length, 0), 300);
    assert.strictEqual(beaucoup.tronque, true);
    assert.strictEqual(m.lireRapport({ config: formats.courant }).tronque, false);
    assert.strictEqual(m.lireRapport({ config: JSON.stringify({ tiles: [], blend: { table: 'X' } }) }).jointure, true, 'une jointure configurée est dite (elle n\'est pas lue)');
    console.log('OK rapport — trois formes historiques comme alpha, tuiles grisées avec leur raison, ids sûrs et uniques, bornes');
  }

  console.log('\nTous les essais du module graphique sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
