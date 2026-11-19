/*
 * Essai de NON-RÉGRESSION dans un vrai navigateur : le VRAI `index.html`, avec sa politique de sécurité du contenu, démarre-t-il ?
 *
 * Pourquoi cet essai existe (19/11/2026) : la politique ajoutée le 18/11 (`'unsafe-eval'` absent) a empêché `grist-plugin-api.js` de
 * s'exécuter (le fichier que Grist sert utilise `eval`) : `grist` restait indéfini et le widget ne démarrait pas dans un vrai Grist.
 * Aucun essai ne le voyait : les essais Node lisent le TEXTE de la politique (celui-ci exigeait même l'absence de `'unsafe-eval'`), et
 * les passes navigateur d'alors posaient un faux `grist` qui n'utilise pas `eval`. Cet essai charge `index.html` (pas le harnais), sert
 * à sa place du `grist-plugin-api.js` qui passe par `eval` (ou le vrai fichier, voir plus bas), et échoue sur :
 *  - toute violation de la politique (`securitypolicyviolation`), toute erreur de console (`EvalError` comprise), toute exception de page ;
 *  - toute requête qui échoue (sauf une réponse que la PAGE annule en cours de route, voir `isPageCancel`), toute réponse 4xx/5xx (un sous-module `kit/` vide en donne trois) ;
 *  - toute requête vers un autre site que `docs.getgrist.com` (l'API Grist) : rien d'autre ne doit sortir ;
 *  - `grist` indéfini, aucune ligne chargée, une tuile qui ne se dessine pas, DuckDB, ExcelJS ou les fenêtres du kit qui ne se chargent pas.
 * Il joue deux fois : en page directe puis dans un `<iframe sandbox="allow-scripts allow-downloads">` (le cadre de Grist et de GFS).
 * Il se prouve aussi capable d'échouer : une copie d'`index.html` SANS `'unsafe-eval'` doit être refusée par la même vérification.
 *
 * Lancer (Playwright et Chromium requis ; aucune dépendance ajoutée au dépôt) :
 *     NODE_PATH=$(npm root -g) node dev-tests/test-browser.js
 * Pour jouer le VRAI fichier de Grist : l'enregistrer (curl https://docs.getgrist.com/grist-plugin-api.js) puis
 *     GRIST_PLUGIN_API_FILE=/chemin/grist-plugin-api.js NODE_PATH=$(npm root -g) node dev-tests/test-browser.js
 * (le vrai fichier ne pose pas `window.grist` de lui-même sans hôte : il est chargé AVANT le faux `grist` qui le remplace, voir `gristApiBody`).
 * Sortie 0 = tout passe ; 1 = un défaut ; 2 = Playwright ou Chromium introuvable (ce n'est PAS un succès).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright introuvable. Lancer avec NODE_PATH=$(npm root -g) (Playwright global) ; voir dev-tests/README.md.');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain',
};
const STUB = fs.readFileSync(path.join(__dirname, 'grist-stub.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * Ce que le navigateur reçoit pour `https://docs.getgrist.com/grist-plugin-api.js`. Le vrai fichier est un bundle webpack qui passe par
 * `eval` (c'est ce qui a cassé le 18/11) : on en imite la forme, le faux `grist` (dev-tests/grist-stub.js) étant lui-même exécuté PAR
 * `eval` et `Function`. Avec GRIST_PLUGIN_API_FILE, le vrai fichier est servi d'abord, puis le faux `grist` pose la table de démonstration
 * (hors d'un hôte Grist le vrai fichier n'a personne à qui parler).
 */
function gristApiBody() {
  const real = process.env.GRIST_PLUGIN_API_FILE ? fs.readFileSync(process.env.GRIST_PLUGIN_API_FILE, 'utf8') : '';
  return real + '\n;(function () {\n'
    + '  var root = Function("return this")();\n'
    + '  (0, eval)(' + JSON.stringify(STUB) + ');\n'
    + '  if (!root.grist) throw new Error("grist-plugin-api factice : grist absent");\n'
    + '})();\n';
}

/** Une table `Ventes` (4 régions x 3 produits x 3 mois) au format colonnaire de `fetchTable`. */
function salesTable() {
  const table = { id: [], Region: [], Produit: [], Mois: [], Quantite: [], Montant: [] };
  let n = 0;
  for (const region of ['Nord', 'Sud', 'Est', 'Ouest']) {
    for (const produit of ['Widget A', 'Widget B', 'Widget C']) {
      for (const mois of ['Janvier', 'Février', 'Mars']) {
        n += 1;
        table.id.push(n);
        table.Region.push(region);
        table.Produit.push(produit);
        table.Mois.push(mois);
        table.Quantite.push(2 + (n * 7) % 19);
        table.Montant.push(300 + (n * 137) % 1700);
      }
    }
  }
  return table;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (pathname === '/__frame.html') {
        res.writeHead(200, Object.assign({ 'content-type': TYPES['.html'] }, headers));
        res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="app" sandbox="allow-scripts allow-downloads" src="/index.html" style="width:1280px;height:900px;border:0"></iframe>');
        return;
      }
      if (pathname === '/__strict.html') { // index.html SANS 'unsafe-eval' : sert à prouver que la vérification sait échouer
        res.writeHead(200, Object.assign({ 'content-type': TYPES['.html'] }, headers));
        res.end(INDEX.replace("'unsafe-eval' ", ''));
        return;
      }
      const file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, headers);
        res.end('not found');
        return;
      }
      res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, headers));
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Une requête qui « échoue » n'est pas toujours une panne. `net::ERR_ABORTED` avec une réponse déjà reçue veut dire que la PAGE a fermé
 * le flux avant sa fin (lecteur annulé) : DuckDB-WASM lit son binaire (34 Mo) par `fetch` -> `pipeThrough` -> `WebAssembly.instantiateStreaming`
 * et V8 peut lâcher le flux dès que le module est compilé, avant d'avoir lu le marqueur de fin. Selon la machine (vu sur Windows, Chromium 1243 :
 * un seul GET de `duckdb-eh.wasm`, annulé ~0,4 s plus tard, alors que DuckDB répond) l'annulation tombe avant ou après la fin du flux : un faux
 * défaut une fois sur deux. Une vraie panne reste un défaut : réponse jamais arrivée (connexion refusée, coupée), blocage par la politique
 * (`net::ERR_BLOCKED_BY_CSP`, et la violation est relevée à part), 4xx/5xx (relevés par l'événement `response`). Et si la ressource manque
 * vraiment, les vérifications de ce qu'elle porte (DuckDB, ExcelJS, kit, tuiles) échouent à leur tour.
 */
function isPageCancel(errorText, wasAnswered) {
  return errorText === 'net::ERR_ABORTED' && wasAnswered === true;
}

/** Joue une page et rend la liste des défauts (vide = tout va bien) et un résumé de ce qui a été vérifié. */
async function scenario(browser, origin, { name, url, framed }) {
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Le widget ne crée aucune table de données : il se connecte à la 1re table du document, qu'il faut donc poser (faux `grist`, préremplissage).
  await context.addInitScript((table) => { window.__gristStubPreseed = { Ventes: table }; }, salesTable());
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error('[CSP] ' + e.violatedDirective + ' bloqué : ' + (e.blockedURI || e.sample || ''));
    });
  });
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') {
      route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    } else {
      problems.push('requête vers un autre site : ' + u.origin + u.pathname);
      route.abort();
    }
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console : ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  const answered = new WeakSet(); // requêtes dont la réponse est arrivée (l'événement `response` précède toujours `requestfailed`)
  const notes = []; // réponses annulées par la page : relevées, jamais comptées comme un défaut (voir `isPageCancel`)
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') return;
    const text = (r.failure() && r.failure().errorText) || 'cause inconnue';
    const where = r.url().replace(origin, '');
    if (isPageCancel(text, answered.has(r))) notes.push('réponse annulée par la page : ' + where);
    else problems.push('requête échouée : ' + where + ' (' + text + ')');
  });
  page.on('response', (r) => {
    answered.add(r.request());
    if (r.status() >= 400) problems.push('réponse ' + r.status() + ' : ' + r.url().replace(origin, ''));
  });
  const verified = [];
  try {
    await page.goto(origin + url, { waitUntil: 'load' });
    let frame = page.mainFrame();
    if (framed) {
      await page.waitForSelector('#app');
      frame = await (await page.$('#app')).contentFrame();
    }
    // 1. L'API de Grist s'est exécutée et le widget s'est connecté à la table de démonstration.
    const started = await frame.waitForFunction(
      () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0,
      null, { timeout: 25000 }
    ).then(() => true, () => false);
    if (!started) {
      const state = await frame.evaluate(() => ({
        grist: typeof window.grist,
        gristbi: typeof window.GristBI,
        rows: window.GristBI && GristBI.store ? GristBI.store.getState().rows.length : null,
      }));
      problems.push('le widget ne démarre pas : ' + JSON.stringify(state));
      return { problems, verified };
    }
    verified.push('démarrage (grist défini, table connectée)');

    // 2. Quatre types de tuile se dessinent (ECharts, HTML, table) sous la politique.
    await frame.evaluate(async () => {
      const tile = (id, type, extra) => Object.assign({ id, type, title: id, dimension: 'Region', measure: 'Montant', aggFn: 'sum' }, extra);
      [tile('t-bar', 'bar'), tile('t-pie', 'pie'), tile('t-kpi', 'kpi', { dimension: undefined }), tile('t-table', 'table', { columns: ['Region', 'Produit', 'Montant'] })]
        .forEach((t) => GristBI.store.addTile(t));
      await new Promise((r) => setTimeout(r, 300));
      await GristBI.charts.whenSettled();
    });
    await frame.waitForTimeout(800);
    const drawn = await frame.evaluate(() => ({
      tiles: document.querySelectorAll('.tile').length,
      canvases: document.querySelectorAll('.tile canvas').length,
      tableRows: document.querySelectorAll('.tile table tr').length,
    }));
    if (drawn.tiles < 4) problems.push('tuiles posées : ' + drawn.tiles + ' au lieu de 4');
    if (drawn.canvases < 2) problems.push('graphiques dessinés : ' + drawn.canvases + ' au lieu de 2 (barres et camembert)');
    if (drawn.tableRows < 2) problems.push('table plate sans ligne');
    verified.push(drawn.tiles + ' tuiles, ' + drawn.canvases + ' graphiques');

    // 3. Ce que la politique pourrait refuser sans bruit : DuckDB (wasm + Worker blob:), ExcelJS (chargeur), fenêtres du kit.
    const loaded = await frame.evaluate(async () => {
      const out = {};
      try {
        await GristBI.duckdbEngine.init();
        const groups = await GristBI.duckdbEngine.groupByAggregate(GristBI.store.getState().rows, 'Region', 'Montant', 'sum');
        out.duckdb = groups.length;
      } catch (e) { out.duckdbError = String((e && e.message) || e).slice(0, 200); }
      try {
        await GristBI.loader.script({ src: 'js/vendor/exceljs/exceljs.min.js' });
        out.exceljs = typeof window.ExcelJS;
      } catch (e) { out.exceljsError = String((e && e.message) || e).slice(0, 200); }
      try {
        out.kit = typeof (await GristBI.loader.module('kit-dialogs'));
      } catch (e) { out.kitError = String((e && e.message) || e).slice(0, 200); }
      return out;
    });
    if (loaded.duckdb !== 4) problems.push('DuckDB : ' + (loaded.duckdbError || 'groupes ' + loaded.duckdb));
    else verified.push('DuckDB');
    if (loaded.exceljs !== 'object') problems.push('ExcelJS : ' + (loaded.exceljsError || loaded.exceljs));
    else verified.push('ExcelJS');
    if (loaded.kit !== 'object') problems.push('kit/ (fenêtres, `git submodule update --init`) : ' + (loaded.kitError || loaded.kit));
    else verified.push('kit');

    // 4. Le cas qui a donné un faux défaut sur Windows : une réponse que la page annule en cours de route. Rejoué ici à coup sûr, sur toute
    // machine, pour prouver que le gestionnaire la relève (note) sans la compter comme une panne.
    const notesBefore = notes.length;
    await frame.evaluate(async () => {
      const reader = (await fetch('js/vendor/duckdb/duckdb-eh.wasm')).body.getReader();
      await reader.read();
      await reader.cancel();
    });
    await frame.waitForTimeout(300);
    if (notes.length === notesBefore) problems.push('contrôle de l\'annulation : une réponse annulée par la page n\'a pas été relevée comme telle');
    else verified.push('réponse annulée tolérée');
    await frame.waitForTimeout(200);
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, verified, notes };
}

(async () => {
  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  } catch (e) {
    console.error('Chromium introuvable : ' + e.message.split('\n')[0]);
    server.close();
    process.exit(2);
  }
  let failed = false;
  const report = (label, result) => {
    if (result.problems.length) {
      failed = true;
      console.error('ÉCHEC : ' + label);
      for (const p of [...new Set(result.problems)]) console.error('   - ' + p);
    } else {
      console.log('OK : ' + label + ' : ' + result.verified.join(', ') + ' ; 0 erreur, 0 violation, 0 requête hors site');
      const notes = [...new Set(result.notes || [])];
      if (notes.length) console.log('   remarque (pas un défaut) : ' + notes.join(' ; '));
    }
  };
  // Le tri des requêtes échouées sait-il encore voir une vraie panne ? Seule une annulation PAR LA PAGE, réponse reçue, est tolérée.
  const tri = [
    ['net::ERR_ABORTED', true, true], ['net::ERR_ABORTED', false, false], ['net::ERR_BLOCKED_BY_CSP', true, false],
    ['net::ERR_CONNECTION_REFUSED', false, false], ['net::ERR_CONNECTION_RESET', true, false], ['net::ERR_FILE_NOT_FOUND', false, false],
  ];
  const mauvais = tri.filter(([text, answered, expected]) => isPageCancel(text, answered) !== expected);
  if (mauvais.length) { failed = true; console.error('ÉCHEC : tri des requêtes échouées : ' + JSON.stringify(mauvais)); }
  else console.log('OK : tri des requêtes échouées : seule une annulation par la page, réponse reçue, est tolérée (' + tri.length + ' cas)');
  try {
    report('page directe', await scenario(browser, origin, { name: 'direct', url: '/index.html', framed: false }));
    report('cadre isolé (sandbox="allow-scripts allow-downloads")', await scenario(browser, origin, { name: 'cadre', url: '/__frame.html', framed: true }));

    // La vérification sait-elle échouer ? Sans 'unsafe-eval', l'API de Grist ne s'exécute pas : elle DOIT le dire.
    const strict = await scenario(browser, origin, { name: 'strict', url: '/__strict.html', framed: false });
    const sees = strict.problems.some((p) => /EvalError|eval|unsafe-eval|script-src/i.test(p)) && strict.problems.some((p) => /ne démarre pas|grist/.test(p));
    if (sees) console.log('OK : contrôle négatif : sans \'unsafe-eval\' la vérification échoue bien (' + strict.problems.length + ' défauts relevés)');
    else { failed = true; console.error('ÉCHEC : contrôle négatif : une page sans \'unsafe-eval\' n\'a pas été refusée, la vérification ne voit plus rien :\n   - ' + strict.problems.join('\n   - ')); }
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
})();
