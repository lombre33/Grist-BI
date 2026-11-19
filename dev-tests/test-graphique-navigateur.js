/*
 * Le dessin du module graphique (js/graphique/) dans un VRAI navigateur, face à celui de Grist BI :
 *  - PARITÉ : les mêmes tuiles (barres, barres horizontales, séries, pile, courbe, aire, lissée, camembert, anneau) dessinées par Grist BI (`GristBI.charts.renderTile`, le harnais de dev-tests/)
 *    et par `graphique.image()` à la même taille, au même thème, avec le vrai ECharts du dépôt ; les pixels sont comparés (tolérance par canal, part de pixels différents bornée) et les écarts
 *    d'option réellement voulus sont listés ;
 *  - CHARGE : 500 appels de suite à `image()` sur 20 lignes (temps par appel, mémoire du tas avant/après, toiles encore vivantes) ;
 *  - VOLUME (MESURES=1 seulement, plus long) : une table entière à 5 000, 50 000 et 500 000 lignes, pour chaque forme du premier lot — les chiffres que HYPOTHESES.md rapporte.
 * Lancer (Playwright et Chromium requis, aucune dépendance ajoutée) : NODE_PATH=$(npm root -g) node dev-tests/test-graphique-navigateur.js   (MESURES=1 pour les mesures de volume)
 * Sortie 0 = tout passe ; 1 = un défaut ; 2 = Playwright ou Chromium introuvable (ce n'est PAS un succès).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright introuvable. Lancer avec NODE_PATH=$(npm root -g) ; voir dev-tests/README.md.');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const MESURES = process.env.MESURES === '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const N_PARITE = 3000;
const N_DUCKDB = 8000;

// Une table `Ventes` déterministe (même résultat à chaque lancement) au format colonnaire de `fetchTable`.
function tableVentes(n) {
  const regions = ['Nord', 'Sud', 'Est', 'Ouest', 'Centre', 'Antilles'];
  const produits = ['Widget A', 'Widget B', 'Widget C', 'Widget D'];
  const mois = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const t = { id: [], Region: [], Produit: [], Mois: [], Annee: [], Quantite: [], Montant: [], Date: [] };
  for (let i = 0; i < n; i += 1) {
    t.id.push(i + 1);
    t.Region.push(regions[(i * 7) % regions.length]);
    t.Produit.push(produits[(i * 5 + Math.floor(i / 11)) % produits.length]);
    t.Mois.push(mois[i % 12]);
    t.Annee.push(2022 + (Math.floor(i / 12) % 3));
    t.Quantite.push(1 + ((i * 13) % 37));
    t.Montant.push(Math.round((100 + ((i * 7919) % 9000) + (i % 12) * 150) * 100) / 100);
    t.Date.push(`${2022 + (Math.floor(i / 12) % 3)}-${String((i % 12) + 1).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  }
  return t;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('absent'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
      // Le harnais prérempli lui-même sa table (8 lignes) : ici la table est celle de l'essai, posée avant tout script de la page.
      if (url === '/dev-tests/harness.html') { res.end(fs.readFileSync(file, 'utf8').replace('window.__gristStubPreseed = {', 'window.__gristStubPreseedHarnais = {')); return; }
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const TUILES = [
  ['barres, somme par région, tri décroissant', { type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', sortMode: 'value-desc' }],
  ['barres, moyenne par produit', { type: 'bar', dimension: 'Produit', measure: 'Montant', aggFn: 'avg' }],
  ['barres horizontales, comptage par région', { type: 'bar', dimension: 'Region', aggFn: 'count', horizontal: true }],
  ['barres, une série par produit', { type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Produit' }],
  ['barres empilées par mois', { type: 'bar', dimension: 'Mois', measure: 'Quantite', aggFn: 'sum', seriesColumn: 'Produit', stacked: true }],
  ['courbe par mois', { type: 'line', dimension: 'Mois', measure: 'Montant', aggFn: 'sum' }],
  ['aire empilée par année et région', { type: 'line', dimension: 'Annee', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Region', areaFill: true, stacked: true }],
  ['courbe lissée par année', { type: 'line', dimension: 'Annee', measure: 'Montant', aggFn: 'avg', lineShape: 'smooth' }],
  ['camembert par région', { type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }],
  ['anneau avec parts par produit', { type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum', donut: true, showPct: true }],
];

// Ce que la page exécute : tout y vit (le module, ECharts, le harnais de Grist BI).
const DANS_LA_PAGE = {};
DANS_LA_PAGE.comparer = async function comparer(def, taille) {
    const g = await import('/js/graphique/index.js');
    const lignes = window.GristBI.store.getState().rows;
    const theme0 = window.GristBI.chartParts.chartTheme();
    const sur = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 1, 1); x.fillStyle = css; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return `#${[0, 1, 2].map((i) => d[i].toString(16).padStart(2, '0')).join('')}`; };
    const theme = { texte: sur(theme0.text), texteDiscret: sur(theme0.muted), fond: sur(theme0.surface), grille: sur(theme0.grid) };
    const hote = document.createElement('div');
    hote.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
    document.body.appendChild(hote);
    const id = `__cmp_${Math.random().toString(36).slice(2, 8)}`;
    const tuile = { id, title: 't', ...def };
    const el = window.GristBI.buildTileElement(tuile, { preview: true });
    el.style.cssText = `width:${taille.largeur}px;height:${taille.hauteur}px;margin:0;`;
    hote.appendChild(el);
    await window.GristBI.charts.renderTile(tuile, window.GristBI.store.getState(), hote);
    await window.GristBI.charts.whenSettled(15000);
    const inst = window.GristBI.charts.getInstance(id);
    for (let i = 0; i < 100 && !inst.getZr().animation.isFinished(); i += 1) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = inst.getWidth();
    const h = inst.getHeight();
    const urlBI = inst.getDataURL({ type: 'png', pixelRatio: 1, backgroundColor: theme.fond });
    const optionBI = inst.getOption();
    const element = document.createElement('div');
    const r = g.creerGraphique({ echarts: window.echarts, langue: 'fr' }).image(def, { lignes }, { largeur: w, hauteur: h, ratio: 1, element, theme });
    const optionModule = (() => { // le même dessin, gardé pour lire l'option sans l'image
      const e2 = document.createElement('div'); e2.style.cssText = `width:${w}px;height:${h}px`; document.body.appendChild(e2);
      const v = g.creerGraphique({ echarts: window.echarts, langue: 'fr' }).monter(e2, { definition: def, source: { lignes }, theme });
      const o = v.ok ? window.echarts.getInstanceByDom(e2).getOption() : null;
      if (v.ok) v.vue.detruire();
      e2.remove();
      return o;
    })();
    const charger = (url) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('image illisible')); i.src = url; });
    let comparaison = { ok: false, raison: r.raison || 'sans image' };
    if (r.ok) {
      const [a, b] = await Promise.all([charger(urlBI), charger(r.url)]);
      const lire = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
      const A = lire(a);
      const B = lire(b);
      let differents = 0;
      let pires = 0;
      if (A.width === B.width && A.height === B.height) {
        for (let i = 0; i < A.data.length; i += 4) {
          const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
          if (d > 24) differents += 1;
          if (d > 96) pires += 1;
        }
      }
      comparaison = { ok: true, tailleBI: [A.width, A.height], tailleModule: [B.width, B.height], pixels: A.width * A.height, differents, pires, urlBI, urlModule: r.url };
    }
    window.GristBI.charts.disposeTile(id);
    hote.remove();
    const resume = (o) => (o ? { series: (o.series || []).map((s) => ({ type: s.type, name: s.name, stack: s.stack, data: (s.data || []).map((d) => (d && typeof d === 'object' && !Array.isArray(d) ? d.value : d)) })), x: o.xAxis && o.xAxis[0] && o.xAxis[0].data, y: o.yAxis && o.yAxis[0] && o.yAxis[0].data } : null);
    return { comparaison, optionBI: resume(optionBI), optionModule: resume(optionModule) };
};

// 500 images de suite sur 20 lignes : temps par appel, tas JS, nœuds du document, écouteurs, taille des PNG. Le tas est mesuré après ramasse-miettes forcé (`--js-flags=--expose-gc`).
DANS_LA_PAGE.charge = async function charge(n, ratio) {
  const g = await import('/js/graphique/index.js');
  const graphique = g.creerGraphique({ echarts: window.echarts, langue: 'fr' });
  const regions = ['Nord', 'Sud', 'Est', 'Ouest', 'Centre'];
  const lignes = Array.from({ length: 20 }, (_, i) => ({ Region: regions[i % regions.length], Mois: `M${i % 6}`, Montant: 100 + i * 37, Quantite: i + 1 }));
  const def = { type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Mois', stacked: true };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const ramasser = async () => { for (let i = 0; i < 3; i += 1) { if (window.gc) window.gc(); await dormir(60); } };
  await ramasser();
  const avant = performance.memory.usedJSHeapSize;
  const durees = [];
  let echecs = 0;
  let octets = 0;
  for (let i = 0; i < n; i += 1) {
    const element = document.createElement('div');
    const t = performance.now();
    const r = graphique.image(def, { lignes }, { largeur: 480, hauteur: 300, ratio, element });
    durees.push(performance.now() - t);
    if (!r.ok) echecs += 1; else octets += r.url.length;
  }
  await ramasser();
  const apres = performance.memory.usedJSHeapSize;
  durees.sort((a, b) => a - b);
  const somme = durees.reduce((a, b) => a + b, 0);
  return { n, echecs, mediane: durees[Math.floor(n / 2)], p95: durees[Math.floor(n * 0.95)], max: durees[n - 1], moyenne: somme / n, total: somme, tasAvant: avant, tasApres: apres, octetsMoyens: octets / n };
};

// Une table entière : le temps de l'image, du montage, du modèle Office et le tas, par forme.
DANS_LA_PAGE.volume = async function volume(n, formes) {
  const g = await import('/js/graphique/index.js');
  const graphique = g.creerGraphique({ echarts: window.echarts, langue: 'fr' });
  const regions = ['Nord', 'Sud', 'Est', 'Ouest', 'Centre', 'Antilles'];
  const produits = ['Widget A', 'Widget B', 'Widget C', 'Widget D'];
  const lignes = new Array(n);
  for (let i = 0; i < n; i += 1) {
    lignes[i] = { Region: regions[(i * 7) % 6], Produit: produits[(i * 5 + Math.floor(i / 11)) % 4], Mois: `M${i % 12}`, Annee: 2022 + (Math.floor(i / 12) % 3), Quantite: 1 + ((i * 13) % 37), Montant: 100 + ((i * 7919) % 9000), Client: `C${i % 5000}`, Ref: `R${i}`, Date: `${2022 + (Math.floor(i / 12) % 3)}-${String((i % 12) + 1).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` };
  }
  const colonnes = [['Region', 'text'], ['Produit', 'text'], ['Mois', 'text'], ['Annee', 'number'], ['Quantite', 'number'], ['Montant', 'number'], ['Client', 'text'], ['Ref', 'text'], ['Date', 'date']].map(([id, genre]) => ({ id, genre }));
  const source = { lignes, colonnes };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const resultats = [];
  for (const [nom, def] of formes) {
    if (window.gc) { window.gc(); await dormir(40); }
    const tas0 = performance.memory.usedJSHeapSize;
    const element = document.createElement('div');
    const t0 = performance.now();
    const r = graphique.image(def, source, { largeur: 480, hauteur: 300, ratio: 2, element });
    const image = performance.now() - t0;
    const t1 = performance.now();
    const o = graphique.modeleOffice(def, source);
    const office = performance.now() - t1;
    const hote = document.createElement('div');
    hote.style.cssText = 'position:fixed;left:-20000px;top:0;width:480px;height:300px';
    document.body.appendChild(hote);
    const t2 = performance.now();
    const m = graphique.monter(hote, { definition: def, source });
    const monter = performance.now() - t2;
    if (m.ok) m.vue.detruire();
    hote.remove();
    resultats.push({ nom, n, ok: r.ok, raison: r.raison, echantillon: r.echantillon || null, image, office, officeOk: o.ok, categories: o.ok ? o.modele.categories.length : null, monter, tasDelta: performance.memory.usedJSHeapSize - tas0 });
  }
  return resultats;
};

const TOLERANCE = 0.001; // part de pixels qui diffèrent de plus de 24 par canal : le texte de la légende (jeton `secondary` de Grist BI, `texteDiscret` ici) en est la seule cause connue

// Charge la page du harnais de Grist BI avec une table de `n` lignes et attend qu'elle soit lue (une dizaine de secondes : la garde de course d'`AddTable`).
async function ouvrirHarnais(navigateur, base, n, erreurs) {
  const context = await navigateur.newContext({ viewport: { width: 1300, height: 900 } });
  await context.addInitScript((table) => { window.__gristStubPreseed = { Ventes: table }; }, tableVentes(n));
  await context.addInitScript(`window.__dessin = { ${Object.entries(DANS_LA_PAGE).map(([nom, f]) => `${nom}: ${f.toString()}`).join(', ')} };`);
  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(`console : ${m.text()}`); });
  await page.goto(`${base}/dev-tests/harness.html`);
  await page.waitForFunction((attendu) => window.GristBI && window.GristBI.store.getState().rows.length === attendu, n, { timeout: 90000 });
  return page;
}

async function parite(page, tuiles, titre, echecs) {
  for (const [nom, def] of tuiles) {
    const r = await page.evaluate(({ d }) => window.__dessin.comparer(d, { largeur: 480, hauteur: 300 }), { d: def });
    const c = r.comparaison;
    const part = c.ok ? c.differents / c.pixels : 1;
    const bon = c.ok && part <= TOLERANCE && c.pires === 0 && JSON.stringify(c.tailleBI) === JSON.stringify(c.tailleModule);
    console.log(`${bon ? 'OK ' : 'ÉCHEC'} parité (${titre}) — ${nom} : ${c.ok ? `${c.differents} pixels sur ${c.pixels} diffèrent (${(part * 100).toFixed(3)} %), ${c.pires} très différents` : c.raison}`);
    if (!bon) {
      echecs.push(`${titre} / ${nom}`);
      if (c.ok) {
        const base = `/tmp/parite-${nom.replace(/\W+/g, '_')}`;
        fs.writeFileSync(`${base}-bi.png`, Buffer.from(c.urlBI.split(',')[1], 'base64'));
        fs.writeFileSync(`${base}-module.png`, Buffer.from(c.urlModule.split(',')[1], 'base64'));
        console.error(JSON.stringify(r.optionBI).slice(0, 500), '\n', JSON.stringify(r.optionModule).slice(0, 500));
      }
    }
  }
}

// Mémoire résidente des processus de rendu de Chromium (Ko), ou `null` si `ps` n'existe pas (Windows) : les toiles d'une image ne sont pas dans le tas JS, c'est ici qu'une fuite se verrait.
function rssRendu() {
  try {
    const sortie = require('child_process').execSync("ps -eo rss=,args= | grep -E 'chrom.*--type=renderer' | grep -v grep", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return sortie.split('\n').filter(Boolean).reduce((somme, ligne) => somme + (parseInt(ligne.trim(), 10) || 0), 0);
  } catch (e) { return null; }
}

const mo = (octets) => `${(octets / 1048576).toFixed(1)} Mo`;
const ms = (x) => `${x.toFixed(1)} ms`;

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  let navigateur;
  try { navigateur = await chromium.launch({ args: ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'] }); } catch (e) {
    console.error(`Chromium introuvable : ${e.message}`);
    server.close();
    process.exit(2);
  }
  const echecs = [];
  const erreurs = [];
  try {
    // Parité sous le seuil de DuckDB (calcul en JS pur des deux côtés), puis au-dessus (Grist BI agrège avec DuckDB-WASM, le module en JS pur).
    const page = await ouvrirHarnais(navigateur, base, N_PARITE, erreurs);
    await parite(page, TUILES, `${N_PARITE} lignes, JS`, echecs);
    const rss0 = rssRendu();
    const charge = await page.evaluate(() => window.__dessin.charge(500, 3));
    const rss1 = rssRendu();
    console.log(`${charge.echecs === 0 ? 'OK ' : 'ÉCHEC'} charge — 500 appels de image() sur 20 lignes (480 x 300, ratio 3) : médiane ${ms(charge.mediane)}, p95 ${ms(charge.p95)}, max ${ms(charge.max)}, total ${(charge.total / 1000).toFixed(1)} s ; tas JS ${mo(charge.tasAvant)} -> ${mo(charge.tasApres)} ; PNG ${(charge.octetsMoyens / 1024).toFixed(0)} Ko en moyenne ; mémoire des processus de rendu ${rss0 === null ? 'non mesurée' : `${mo(rss0 * 1024)} -> ${mo(rss1 * 1024)}`} ; échecs ${charge.echecs}`);
    // 500 toiles de 1 440 x 900 pixels gardées en vie pèseraient 2,5 Go : le seuil (300 Mo) sépare nettement une libération d'une fuite.
    if (rss0 !== null && (rss1 - rss0) * 1024 > 300 * 1048576) echecs.push(`charge : la mémoire de rendu a grossi de ${mo((rss1 - rss0) * 1024)}`);
    if (charge.echecs) echecs.push('charge : des appels ont échoué');
    if (charge.tasApres - charge.tasAvant > 8 * 1048576) echecs.push(`charge : le tas a grossi de ${mo(charge.tasApres - charge.tasAvant)}`);
    if (MESURES) {
      const formes = [
        ['barres, somme par région', { type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }],
        ['barres empilées, séries par produit, 12 mois', { type: 'bar', dimension: 'Mois', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Produit', stacked: true }],
        ['barres par client (5 000 catégories)', { type: 'bar', dimension: 'Client', measure: 'Montant', aggFn: 'sum', sortMode: 'value-desc' }],
        ['courbe par date, un point par ligne', { type: 'line', dimension: 'Date', measure: 'Montant', aggFn: 'none', sortMode: 'axis' }],
        ['aire empilée par année et région', { type: 'line', dimension: 'Date.Annee', measure: 'Montant', aggFn: 'sum', seriesColumn: 'Region', areaFill: true, stacked: true, sortMode: 'axis' }],
        ['barres, une catégorie par ligne (identifiants uniques)', { type: 'bar', dimension: 'Ref', measure: 'Montant', aggFn: 'sum' }],
        ['camembert, une part par ligne (identifiants uniques)', { type: 'pie', dimension: 'Ref', measure: 'Montant', aggFn: 'sum' }],
        ['camembert par région', { type: 'pie', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }],
      ];
      // Une catégorie par ligne : dessinée jusqu'aux plafonds de `SEUILS_VOLUME`, refusée (`volume`) au-delà, vite — c'est ce que la mesure vérifie à 500 000 lignes.
      for (const n of (process.env.TAILLES || '5000,20000,50000,500000').split(',').map(Number)) {
        const lignes = await page.evaluate(({ nn, f }) => window.__dessin.volume(nn, f), { nn: n, f: formes });
        for (const r of lignes) console.log(`MESURE ${String(n).padStart(6)} lignes — ${r.nom} : image ${ms(r.image)}, montage ${ms(r.monter)}, modèle Office ${ms(r.office)} (${r.categories === null ? '-' : r.categories} catégories), tas ${mo(r.tasDelta)}, ${r.ok ? 'ok' : `refus ${r.raison}`}${r.echantillon ? `, échantillon ${r.echantillon.tires}/${r.echantillon.sur}` : ''}`);
      }
    }
    await page.context().close();
    // Au-dessus du seuil de DuckDB (5 000 lignes) : Grist BI passe par le moteur SQL, le module reste en JS pur ; les images doivent être les mêmes.
    const grand = await ouvrirHarnais(navigateur, base, N_DUCKDB, erreurs);
    await parite(grand, TUILES.filter((_, i) => [0, 3, 4, 5, 6, 8].includes(i)), `${N_DUCKDB} lignes, DuckDB côté Grist BI`, echecs);
    await grand.context().close();
    if (erreurs.length) { echecs.push(`erreurs de page : ${erreurs.slice(0, 3).join(' | ')}`); console.error(erreurs.join('\n')); }
  } finally {
    await navigateur.close();
    server.close();
  }
  if (echecs.length) { console.error(`\n${echecs.length} défaut(s) : ${echecs.join(' ; ')}`); process.exit(1); }
  console.log('\nTous les essais du dessin dans le navigateur sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
