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
      if (pathname === '/__host.html') { // un faux GFS : une page parente qui écoute les messages de son cadre ; `?gfs=0` dans l'adresse du cadre = « GFS héberge l'app » (kit/js/host.js)
        const query = new URL(req.url, 'http://x').searchParams;
        const app = /^\/[A-Za-z0-9_./-]+\.html$/.test(query.get('app') || '') ? query.get('app') : '/index.html';
        res.writeHead(200, Object.assign({ 'content-type': TYPES['.html'] }, headers));
        res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><script>window.__messages = [];'
          + 'addEventListener("message", function (e) { window.__messages.push({ fromApp: e.source === document.getElementById("app").contentWindow, data: e.data }); });</script>'
          + '<iframe id="app" sandbox="allow-scripts allow-downloads" src="' + app + (query.has('gfs') ? '?gfs=' + encodeURIComponent(query.get('gfs')) : '') + '" style="width:1280px;height:900px;border:0"></iframe>');
        return;
      }
      if (pathname === '/__norelay.html') { // index.html SANS la ligne du relais S8 : prouve que la vérification du relais sait échouer
        res.writeHead(200, Object.assign({ 'content-type': TYPES['.html'] }, headers));
        res.end(INDEX.replace('<script type="module" src="js/relais-securite.js"></script>', ''));
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

    // 5. Le panneau « Ajouter une visualisation » (niveau 3 des suggestions) dans la vraie page, sous sa politique, avec de vrais clics : la liste
    // « Pour compléter ce tableau de bord » apparaît après le calcul différé, les types qu'elle utilise portent le badge « Recommandé » (jamais une
    // carte grisée), « Ajouter » pose UNE tuile, la liste se recalcule et le focus reste dans le panneau, l'annonce est écrite.
    await frame.evaluate(() => {
      if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click();
      GristBI.openTilePanel({ step: 'choose' });
    });
    const listed = await frame.waitForSelector('#tile-complete-list button[data-complete]', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
    if (!listed) problems.push('« Pour compléter » : aucune carte affichée après l\'ouverture du panneau');
    else {
      const before = await frame.evaluate(() => ({
        tiles: GristBI.store.getState().tiles.length,
        cards: document.querySelectorAll('#tile-complete-list .complete-card').length,
        badges: Array.from(document.querySelectorAll('.type-card-badge')).map((b) => ({ type: b.parentElement.dataset.type, text: b.textContent, disabled: b.parentElement.getAttribute('aria-disabled') === 'true', title: b.parentElement.title })),
        offList: Array.from(document.querySelectorAll('.type-card-recommended')).filter((c) => !c.querySelector('.type-card-badge')).length,
      }));
      if (before.cards < 1 || before.cards > 3) problems.push('« Pour compléter » : ' + before.cards + ' cartes (1 à 3 attendues)');
      if (!before.badges.length) problems.push('badge « Recommandé » : aucun type recommandé alors que la liste propose des tuiles');
      if (before.badges.some((b) => !b.text || b.disabled || !b.title)) problems.push('badge « Recommandé » : texte, raison en infobulle ou carte grisée : ' + JSON.stringify(before.badges));
      if (before.offList) problems.push('badge « Recommandé » : une carte porte la classe sans la pastille');
      await frame.click('#tile-complete-list button[data-complete="0"]');
      await frame.waitForFunction((n) => GristBI.store.getState().tiles.length === n + 1, before.tiles, { timeout: 5000 }).catch(() => {});
      await frame.waitForTimeout(600);
      const after = await frame.evaluate(() => {
        const active = document.activeElement;
        return {
          tiles: GristBI.store.getState().tiles.length,
          live: document.getElementById('tile-complete-live').textContent,
          focusInPanel: !!(active && active.closest && active.closest('#tile-panel')),
          focusTag: active ? active.tagName : '',
        };
      });
      if (after.tiles !== before.tiles + 1) problems.push('« Ajouter » : ' + before.tiles + ' -> ' + after.tiles + ' tuiles (une seule attendue)');
      if (!after.live) problems.push('« Ajouter » : aucune annonce écrite');
      if (!after.focusInPanel || after.focusTag === 'BODY') problems.push('« Ajouter » : le focus a quitté le panneau (' + after.focusTag + ')');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      const closed = await frame.evaluate(() => ({ hidden: document.getElementById('tile-complete').hidden, badges: document.querySelectorAll('.type-card-badge').length }));
      if (!closed.hidden || closed.badges) problems.push('panneau fermé : la liste ou des badges restent (' + JSON.stringify(closed) + ')');
      if (!problems.some((p) => /Pour compléter|Recommandé|Ajouter|panneau fermé/.test(p))) verified.push('panneau « Compléter » : liste, ' + before.badges.length + ' badges, un ajout, focus, fermeture');
    }
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, verified, notes };
}

/**
 * Le relais S8 (consigne GFS 026) dans la vraie page, sous sa vraie politique, dans le cadre isolé : une page parente fait le faux GFS et
 * écoute. `hosted` = `?gfs=0` dans l'adresse du cadre. Rend ce que le parent a reçu du cadre ; l'appelant juge. Ce qui est provoqué : un
 * `fetch` et une image vers `http://exemple.test/…?secret=…`, que `connect-src` et `img-src` refusent (`https:` n'est ouvert que pour
 * `connect-src`, d'où `http:`) ; la requête ne sort jamais de la page, et l'adresse complète ne doit JAMAIS arriver au parent.
 */
async function relayScenario(browser, origin, { app, hosted, expectRelay }) {
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((table) => { window.__gristStubPreseed = { Ventes: table }; }, salesTable());
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') {
      route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    } else {
      problems.push('une requête vers ' + u.hostname + ' est sortie de la page : la politique devait la bloquer');
      route.abort();
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  let messages = [];
  try {
    await page.goto(origin + '/__host.html?app=' + encodeURIComponent(app) + (hosted ? '&gfs=0' : ''), { waitUntil: 'load' });
    const frame = await (await page.$('#app')).contentFrame();
    await frame.waitForFunction(() => typeof window.GristBI === 'object' && GristBI.loader, null, { timeout: 25000 });
    const relayed = await page.waitForFunction(
      () => window.__messages.some((m) => m.data && m.data.nom === 'securite' && m.data.args && m.data.args.quoi === 'relais'),
      null, { timeout: expectRelay ? 15000 : 2500 }
    ).then(() => true, () => false);
    if (relayed !== expectRelay) problems.push('relais « actif » ' + (relayed ? 'reçu' : 'absent') + ', attendu ' + (expectRelay ? 'reçu' : 'absent'));
    await frame.evaluate(() => {
      fetch('http://exemple.test/x?secret=1').catch(() => {});
      const img = new Image();
      img.src = 'http://exemple.test/i.png?secret=2';
    });
    await page.waitForTimeout(expectRelay ? 1500 : 800);
    messages = await page.evaluate(() => window.__messages.filter((m) => m.fromApp).map((m) => m.data));
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, messages };
}

/**
 * La fenêtre commune de mise à jour des noms (consigne GFS 030) dans la vraie page, sous sa vraie politique, avec le vrai kit : un document aux
 * noms d'AVANT (`Nom`, `TypeRapport`, `DateModif`, `ModifiePar`) et un rapport enregistré. `mode` :
 *  - `owner`  : Grist répond 200 à `GET /webhooks` (la preuve du propriétaire) -> la fenêtre s'ouvre, on la joue (Mettre à jour, Continuer) ; ensuite les
 *               noms sont anglais, le rapport s'ouvre, une modification s'écrit sous les noms anglais ;
 *  - `guest`  : 403 -> aucune fenêtre, le document n'est pas touché, le rapport s'ouvre sur les anciens noms, une modification s'écrit sous les anciens noms
 *               et AUCUNE colonne anglaise n'apparaît ;
 *  - `hosted` : hébergé par un faux GFS (`?gfs=0`) qui ne dit pas le rôle -> aucune fenêtre, et AUCUN appel à `/webhooks` (jamais de jeton d'écriture dans GFS).
 * `framed` : dans un `<iframe sandbox="allow-scripts allow-downloads">`.
 */
async function namesScenario(browser, origin, { mode, framed }) {
  const problems = [];
  const verified = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((table) => {
    const report = { pages: [{ id: 'p1', name: 'Page', tiles: [{ id: 't1', type: 'bar', title: 'Montant par région', dimension: 'Region', measure: 'Montant', aggFn: 'sum' }] }], currentPageId: 'p1' };
    const config = ['TableId', 'ConfigJSON', 'Nom', 'TypeRapport', 'DateModif', 'ModifiePar'];
    const meta = { id: [1, 2], tableId: ['Ventes', 'BI_Dashboard_Config'] };
    const columns = { id: [], parentId: [], colId: [], type: [], widgetOptions: [] };
    const add = (parent, ids) => ids.forEach((colId) => { columns.id.push(columns.id.length + 1); columns.parentId.push(parent); columns.colId.push(colId); columns.type.push('Text'); columns.widgetOptions.push(''); });
    add(1, ['Region', 'Produit', 'Mois', 'Quantite', 'Montant']);
    add(2, config);
    window.__gristStubPreseed = {
      Ventes: table,
      BI_Dashboard_Config: { id: [1], TableId: ['Ventes'], ConfigJSON: [JSON.stringify(report)], Nom: ['Rapport d\'avant'], TypeRapport: ['rapport'], DateModif: [1700000000], ModifiePar: ['ancien@exemple.fr'] },
      _grist_Tables: meta, _grist_Tables_column: columns
    };
  }, salesTable());
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => { console.error('[CSP] ' + e.violatedDirective + ' bloqué : ' + (e.blockedURI || e.sample || '')); });
  });
  let probes = 0;
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    else { problems.push('requête vers un autre site : ' + u.origin + u.pathname); route.abort(); }
  });
  // La preuve du moteur de partage : 200 pour un propriétaire, 403 pour tout autre.
  await context.route('**/_stub/api/docs/stub/webhooks**', (route) => {
    probes++;
    route.fulfill({ status: mode === 'owner' ? 200 : 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: mode === 'owner' ? '{"webhooks":[]}' : '{"error":"No owner access"}' });
  });
  const page = await context.newPage();
  const expected403 = (text) => mode !== 'owner' && /webhooks|403/.test(text); // le navigateur journalise lui-même un 403 comme une erreur de console
  page.on('console', (m) => { if (m.type() === 'error' && !expected403(m.text())) problems.push('console : ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') return;
    const text = (r.failure() && r.failure().errorText) || 'cause inconnue';
    if (text !== 'net::ERR_ABORTED') problems.push('requête échouée : ' + r.url().replace(origin, '') + ' (' + text + ')');
  });
  page.on('response', (r) => { if (r.status() >= 400 && !(r.url().includes('/webhooks') && r.status() === 403)) problems.push('réponse ' + r.status() + ' : ' + r.url().replace(origin, '')); });
  try {
    const url = mode === 'hosted' ? '/__host.html?app=%2Findex.html&gfs=0' : framed ? '/__frame.html' : '/index.html';
    await page.goto(origin + url, { waitUntil: 'load' });
    const frame = framed || mode === 'hosted' ? await (await page.waitForSelector('#app')).contentFrame() : page.mainFrame();
    const columnsNow = () => frame.evaluate(async () => Array.from(Object.keys(await grist.docApi.fetchTable('BI_Dashboard_Config'))).filter((k) => k !== 'id' && k !== 'manualSort'));
    const FRENCH = ['TableId', 'ConfigJSON', 'Nom', 'TypeRapport', 'DateModif', 'ModifiePar'];
    const ENGLISH = ['TableId', 'ConfigJSON', 'Name', 'ReportType', 'ModifiedAt', 'ModifiedBy'];
    const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    await frame.waitForFunction(() => typeof window.GristBI === 'object' && GristBI.api && typeof window.grist === 'object', null, { timeout: 25000 });

    if (mode === 'owner') {
      const modal = await frame.waitForSelector('#nu-modal', { state: 'visible', timeout: 25000 }).catch(() => null);
      if (!modal) { problems.push('propriétaire prouvé : la fenêtre de mise à jour des noms ne s\'est pas ouverte'); return { problems, verified }; }
      const text = await modal.innerText();
      if (!/quelques secondes/.test(text) || !/Mettre à jour/.test(text)) problems.push('la fenêtre ne dit pas « quelques secondes » / « Mettre à jour » : ' + text.slice(0, 200));
      const rowsBefore = await frame.evaluate(() => GristBI.store.getState().rows.length);
      if (rowsBefore) problems.push('le tableau de bord a lu une table avant la fin de la fenêtre (bloquante)');
      if (!sameList(await columnsNow(), FRENCH)) problems.push('les colonnes ont changé AVANT le clic : ' + JSON.stringify(await columnsNow()));
      await frame.click('#nu-modal button:has-text("Mettre à jour")');
      await frame.waitForSelector('#nu-modal :text("Terminé")', { timeout: 15000 });
      await frame.click('#nu-modal button:has-text("Continuer")');
      await frame.waitForSelector('#nu-modal', { state: 'detached', timeout: 5000 }).catch(() => problems.push('la fenêtre ne se ferme pas après « Continuer »'));
      verified.push('fenêtre ouverte (propriétaire prouvé par 200), quatre colonnes renommées en un lot, « Terminé », fermée');
    } else {
      await frame.waitForTimeout(mode === 'hosted' ? 6500 : 1500); // hébergé : le faux GFS ne répond pas au contexte, le lien attend ses 5 secondes
    }

    await frame.waitForFunction(() => GristBI.store && GristBI.store.getState().rows.length > 0, null, { timeout: 30000 });
    if (await frame.$('#nu-modal')) problems.push(mode + ' : une fenêtre de mise à jour est ouverte alors qu\'elle ne devait pas l\'être');
    await frame.waitForFunction(() => GristBI.store.getState().tiles.some((t) => t.id === 't1'), null, { timeout: 15000 }).catch(() => problems.push('le rapport enregistré ne s\'est pas ouvert (tuile t1 absente)'));
    await frame.evaluate(async () => { await GristBI.charts.whenSettled(); });
    verified.push('rapport enregistré ouvert');

    // Une modification s'écrit sous les noms que le document a, sans jamais recréer l'autre jeu.
    await frame.evaluate(() => GristBI.store.updateTile('t1', { title: 'Montant par région (modifié)' }));
    // L'enregistrement est différé (600 ms) : on relit la table jusqu'à ce que la modification y soit, ou on le dit.
    let saved = false;
    for (let i = 0; i < 40 && !saved; i++) {
      await frame.waitForTimeout(250);
      saved = await frame.evaluate(async () => (await grist.docApi.fetchTable('BI_Dashboard_Config')).ConfigJSON[0].includes('(modifié)'));
    }
    if (!saved) problems.push('la modification n\'a pas été enregistrée');
    const after = await columnsNow();
    const expectedColumns = mode === 'owner' ? ENGLISH : FRENCH;
    if (!sameList(after, expectedColumns)) problems.push(mode + ' : colonnes ' + JSON.stringify(after) + ', attendu ' + JSON.stringify(expectedColumns));
    const row = await frame.evaluate(async () => { const t = await grist.docApi.fetchTable('BI_Dashboard_Config'); return { rows: t.id.length, name: t.Name ? t.Name[0] : t.Nom[0], type: t.ReportType ? t.ReportType[0] : t.TypeRapport[0], at: t.ModifiedAt ? t.ModifiedAt[0] : t.DateModif[0] }; });
    if (row.rows !== 1) problems.push(mode + ' : ' + row.rows + ' lignes de configuration, attendu 1 (aucune ligne perdue ni dupliquée)');
    if (row.name !== 'Rapport d\'avant' || row.type !== 'rapport') problems.push(mode + ' : nom ou type du rapport changé : ' + JSON.stringify(row));
    if (!(row.at > 1700000000)) problems.push(mode + ' : la date de modification n\'a pas été écrite : ' + row.at);
    verified.push(mode === 'owner' ? 'une modification s\'écrit sous Name/ModifiedAt, nom et type du rapport intacts' : 'une modification s\'écrit sous les anciens noms, aucune colonne anglaise');
    if (mode === 'hosted' && probes) problems.push('hébergé : ' + probes + ' appel(s) à /webhooks — dans GFS, jamais de jeton d\'écriture');
    if (mode === 'owner' && probes !== 1) problems.push('propriétaire : ' + probes + ' appel(s) à /webhooks, attendu 1');
    if (mode === 'guest' && probes !== 1) problems.push('autre personne : ' + probes + ' appel(s) à /webhooks, attendu 1');
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, verified };
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
  const report = (label, result, options) => {
    if (result.problems.length) {
      failed = true;
      console.error('ÉCHEC : ' + label);
      for (const p of [...new Set(result.problems)]) console.error('   - ' + p);
    } else {
      console.log('OK : ' + label + ' : ' + result.verified.join(', ') + (options && options.violations ? ' ; ' + options.violations + ' ; 0 requête hors site' : ' ; 0 erreur, 0 violation, 0 requête hors site'));
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

    // Règle S8 : le relais des appels bloqués. Hébergée : « relais actif » puis, pour ce que la politique bloque, l'HÔTE seul. Seule : rien. Sans la ligne : rien.
    const relayText = (r) => JSON.stringify(r.messages);
    const hostedRun = await relayScenario(browser, origin, { app: '/index.html', hosted: true, expectRelay: true });
    const blocked = hostedRun.messages.filter((m) => m.nom === 'securite' && m.args && m.args.quoi === 'bloque');
    const connect = blocked.find((m) => m.args.directive === 'connect-src' && m.args.cible === 'exemple.test');
    const image = blocked.find((m) => m.args.directive === 'img-src' && m.args.cible === 'exemple.test');
    if (!connect) hostedRun.problems.push('aucun « bloqué » connect-src / exemple.test reçu : ' + relayText(hostedRun).slice(0, 400));
    if (!image) hostedRun.problems.push('aucun « bloqué » img-src / exemple.test reçu : ' + relayText(hostedRun).slice(0, 400));
    if (/secret|\/x\b|i\.png|http:/.test(relayText(hostedRun))) hostedRun.problems.push('le chemin, les paramètres ou l\'adresse entière sont partis : ' + relayText(hostedRun).slice(0, 400));
    report('relais S8, hébergée par un faux GFS (`?gfs=0`, cadre isolé)', Object.assign(hostedRun, { verified: ['« relais actif » reçu', 'connect-src et img-src bloqués relayés avec « exemple.test » seul (ni chemin, ni paramètre)'] }), { violations: 'les deux appels provoqués sont bloqués' });
    const aloneRun = await relayScenario(browser, origin, { app: '/index.html', hosted: false, expectRelay: false });
    if (aloneRun.messages.length) aloneRun.problems.push('seule (sans `gfs=`), la page a écrit à son parent : ' + relayText(aloneRun).slice(0, 300));
    report('relais S8, app seule', Object.assign(aloneRun, { verified: ['aucun message au parent'] }), { violations: 'bloquées sans rien dire' });
    const noRelayRun = await relayScenario(browser, origin, { app: '/__norelay.html', hosted: true, expectRelay: false });
    if (noRelayRun.messages.some((m) => m.nom === 'securite')) noRelayRun.problems.push('sans la ligne du relais, un message `securite` est parti : ' + relayText(noRelayRun).slice(0, 300));
    report('contrôle négatif : sans la ligne du relais, hébergée, GFS ne reçoit rien', Object.assign(noRelayRun, { verified: ['aucun « relais actif », aucun « bloqué »'] }), { violations: 'bloquées sans rien dire' });

    // Consigne GFS 030 : la fenêtre commune de mise à jour des noms (vrai kit), propriétaire / autre personne / hébergé par un faux GFS.
    report('mise à jour des noms, propriétaire (page directe)', await namesScenario(browser, origin, { mode: 'owner', framed: false }), { violations: '1 preuve /webhooks' });
    report('mise à jour des noms, propriétaire (cadre isolé)', await namesScenario(browser, origin, { mode: 'owner', framed: true }), { violations: '1 preuve /webhooks' });
    report('mise à jour des noms, autre personne (403, cadre isolé) : aucune fenêtre', await namesScenario(browser, origin, { mode: 'guest', framed: true }), { violations: '1 preuve /webhooks refusée' });
    report('mise à jour des noms, hébergé par un faux GFS qui ne dit pas le rôle : aucune fenêtre, aucun jeton', await namesScenario(browser, origin, { mode: 'hosted', framed: true }), { violations: '0 appel /webhooks' });

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
