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

/**
 * `Ventes` avec une colonne Référence `Client` (type Grist `Ref:Clients` : un numéro de ligne de `Clients`) et la table `Clients` qu'elle vise, avec les
 * métadonnées de leurs colonnes (`_grist_Tables`, `_grist_Tables_column`) : c'est par elles que le widget connaît le VRAI type d'une colonne.
 */
function joinFixture() {
  const ventes = salesTable();
  ventes.Client = ventes.id.map((id) => 1 + (id % 6));
  ventes.Vendeur = ventes.id.map((id) => 1 + ((id * 5) % 6)); // une 2e Référence, vers une 2e table : plusieurs tables peuvent être liées
  const clients = {
    id: [1, 2, 3, 4, 5, 6],
    Nom: ['Atelier Nord', 'Boutique Sud', 'Cave Est', 'Dépôt Ouest', 'Epicerie Lac', 'Ferme Haute'],
    Ville: ['Lyon', 'Nantes', 'Lille', 'Lyon', 'Nantes', 'Lille'],
    Segment: ['Pro', 'Particulier', 'Pro', 'Public', 'Particulier', 'Public']
  };
  const personnes = {
    id: [1, 2, 3, 4, 5, 6],
    Prenom: ['Ada', 'Bruno', 'Chloé', 'Dario', 'Eva', 'Farid'],
    Equipe: ['Alpha', 'Beta', 'Gamma', 'Alpha', 'Beta', 'Gamma']
  };
  const meta = { id: [1, 2, 3], tableId: ['Ventes', 'Clients', 'Personnes'] };
  const columns = { id: [], parentId: [], colId: [], type: [], widgetOptions: [] };
  const add = (parent, list) => list.forEach(([colId, type]) => { columns.id.push(columns.id.length + 1); columns.parentId.push(parent); columns.colId.push(colId); columns.type.push(type); columns.widgetOptions.push(''); });
  add(1, [['Region', 'Text'], ['Produit', 'Text'], ['Mois', 'Text'], ['Quantite', 'Numeric'], ['Montant', 'Numeric'], ['Client', 'Ref:Clients'], ['Vendeur', 'Ref:Personnes']]);
  add(2, [['Nom', 'Text'], ['Ville', 'Text'], ['Segment', 'Text']]);
  add(3, [['Prenom', 'Text'], ['Equipe', 'Text']]);
  return { Ventes: ventes, Clients: clients, Personnes: personnes, _grist_Tables: meta, _grist_Tables_column: columns };
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
  await context.addInitScript((fixture) => { window.__gristStubPreseed = fixture; }, joinFixture());
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
  const tolerated = []; // erreurs de console ATTENDUES (une table illisible provoquée par l'essai), posées par l'étape qui les provoque
  page.on('console', (m) => { if (m.type() === 'error' && !tolerated.some((re) => re.test(m.text()))) problems.push('console : ' + m.text().slice(0, 240)); });
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

    // 5. « Que faire avec cette colonne ? » (niveau 3 des suggestions), dans la vraie page, sous sa politique, avec de VRAIS gestes : le bloc se
    // déplie, la colonne se choisit dans le champ à autocomplétion (frappe + Entrée), la phrase du rôle et des cartes apparaissent, un clic de souris
    // sur « Ajouter » pose UNE tuile (le navigateur déclenche un 2e `change` à la perte du focus : refaire la liste à ce moment retirait le bouton
    // entre le bouton enfoncé et relâché, le clic se perdait — défaut trouvé par ce pas), la liste se recalcule, le focus reste dans le panneau.
    // `Mois` n'est lue par aucune des quatre tuiles posées plus haut : des propositions existent.
    await frame.evaluate(() => {
      if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click();
      GristBI.openTilePanel({ step: 'choose' });
    });
    await frame.click('#tile-column > summary');
    await frame.click('#tile-column-pick');
    await page.keyboard.type('Moi');
    await page.keyboard.press('Enter');
    const picked = await frame.waitForSelector('#tile-column-list button[data-column-add]', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
    if (!picked) problems.push('« Que faire avec cette colonne ? » : aucune carte après le choix de « Mois »');
    else {
      const first = await frame.evaluate(() => ({
        value: document.getElementById('tile-column-pick').value,
        profile: document.getElementById('tile-column-profile').textContent,
        cards: document.querySelectorAll('#tile-column-list .complete-card').length,
        live: document.getElementById('tile-column-live').textContent,
        tiles: GristBI.store.getState().tiles.length,
      }));
      if (first.value !== 'Mois') problems.push('« Que faire avec cette colonne ? » : le champ vaut « ' + first.value + ' » au lieu de « Mois »');
      if (!/Mois/.test(first.profile)) problems.push('« Que faire avec cette colonne ? » : la phrase du rôle ne nomme pas la colonne : « ' + first.profile + ' »');
      if (first.cards < 1 || first.cards > 3) problems.push('« Que faire avec cette colonne ? » : ' + first.cards + ' cartes (1 à 3 attendues)');
      if (!first.live) problems.push('« Que faire avec cette colonne ? » : aucune annonce écrite');
      await frame.click('#tile-column-list button[data-column-add="0"]');
      await frame.waitForFunction((n) => GristBI.store.getState().tiles.length === n + 1, first.tiles, { timeout: 5000 }).catch(() => {});
      await frame.waitForTimeout(700);
      const second = await frame.evaluate(() => {
        const active = document.activeElement;
        return {
          tiles: GristBI.store.getState().tiles.length,
          used: document.getElementById('tile-column-used').textContent,
          cards: document.querySelectorAll('#tile-column-list .complete-card').length,
          focusInPanel: !!(active && active.closest && active.closest('#tile-panel')),
          focusTag: active ? active.tagName : '',
        };
      });
      if (second.tiles !== first.tiles + 1) problems.push('« Que faire avec cette colonne ? » : « Ajouter » ' + first.tiles + ' -> ' + second.tiles + ' tuiles (une seule attendue ; un clic perdu ?)');
      if (!/1/.test(second.used)) problems.push('« Que faire avec cette colonne ? » : la tuile posée n\'est pas comptée (« ' + second.used + ' »)');
      if (!second.focusInPanel || second.focusTag === 'BODY') problems.push('« Que faire avec cette colonne ? » : le focus a quitté le panneau (' + second.focusTag + ')');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      const closed = await frame.evaluate(() => ({ value: document.getElementById('tile-column-pick').value, cards: document.querySelectorAll('#tile-column-list .complete-card').length, profile: document.getElementById('tile-column-profile').textContent }));
      if (closed.value || closed.cards || closed.profile) problems.push('panneau fermé : le choix de colonne et ses résultats restent (' + JSON.stringify(closed) + ')');
      if (!problems.some((p) => /Que faire|panneau fermé/.test(p))) verified.push('« Que faire avec cette colonne ? » : choix, phrase, ' + first.cards + ' cartes, un clic réel = une tuile, focus, fermeture');
    }

    // 6. Le panneau « Ajouter une visualisation » (niveau 3 des suggestions) dans la vraie page, sous sa politique, avec de vrais clics : la liste
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

    // 7. « Analyser par nom plutôt que par numéro » (niveau 3d, puis lot 1 « colonnes de toutes les tables ») : `Ventes.Client` (`Ref:Clients`) et
    // `Ventes.Vendeur` (`Ref:Personnes`) sont des colonnes Référence ; le panneau propose de relier `Clients` ET `Personnes` (il lit les autres tables, d'où
    // l'attente), un VRAI clic sur « Relier » pose une jointure qui S'AJOUTE aux autres (store.joins, colonnes `Clients.*` dans les lignes, mêmes lignes), la
    // phrase de confirmation prend la place de la carte posée, le focus reste dans le panneau, la jointure est ENREGISTRÉE avec le rapport et listée dans
    // « Tables liées » du menu Données ; une 2e jointure s'ajoute sans défaire la 1re ; retirer une jointure que des tuiles lisent est REFUSÉ (rien ne
    // change, la raison est dite), retirer une jointure inutilisée marche et retire ses colonnes ; à la réouverture il n'y a plus rien à proposer.
    await frame.evaluate(() => {
      if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click();
      GristBI.openTilePanel({ step: 'choose' });
    });
    const offered = await frame.waitForSelector('#tile-join-list button[data-join]', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
    if (!offered) problems.push('« Analyser par nom » : aucune proposition de jointure après l\'ouverture du panneau');
    else {
      await frame.waitForTimeout(500); // les deux tables sont lues : les deux cartes sont posées d'un coup
      const first = await frame.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#tile-join-list .complete-card'));
        return {
          title: document.getElementById('tile-join-title').textContent,
          cards: cards.length,
          buttons: cards.map((c) => c.querySelector('button[data-join]').textContent),
          index: cards.findIndex((c) => /Clients/.test(c.querySelector('button[data-join]').textContent)),
          reason: (cards.find((c) => /Clients/.test(c.querySelector('button[data-join]').textContent)) || cards[0]).querySelector('.complete-card-reason').textContent,
          joins: GristBI.store.getState().joins.length,
          blend: GristBI.store.getState().blend,
          joined: 'Clients.Ville' in (GristBI.store.getState().rows[0] || {}),
          rows: GristBI.store.getState().rows.length,
        };
      });
      if (first.cards !== 2) problems.push('« Analyser par nom » : ' + first.cards + ' cartes au lieu de deux (Clients et Personnes) : ' + first.buttons.join(' / '));
      if (first.index < 0 || !/Ville/.test(first.reason) || !/Client/.test(first.reason)) problems.push('« Analyser par nom » : la carte ne nomme pas la table, la colonne et les axes : « ' + first.buttons.join(' / ') + ' » / « ' + first.reason + ' »');
      if (first.blend || first.joins || first.joined) problems.push('« Analyser par nom » : une jointure existe avant le clic');
      await frame.click('#tile-join-list button[data-join="' + Math.max(0, first.index) + '"]');
      const linked = await frame.waitForFunction(() => GristBI.store.getState().joins.length === 1 && 'Clients.Ville' in (GristBI.store.getState().rows[0] || {}), null, { timeout: 8000 }).then(() => true, () => false);
      if (!linked) problems.push('« Analyser par nom » : un clic sur « Relier » n\'a pas posé la jointure (un clic perdu ?)');
      await frame.waitForTimeout(700);
      const second = await frame.evaluate(() => {
        const active = document.activeElement;
        const done = document.getElementById('tile-join-done');
        const state = GristBI.store.getState();
        return {
          blend: state.blend,
          joins: state.joins,
          rows: state.rows.length,
          keys: Object.keys(state.rows[0] || {}).filter((k) => k.indexOf('Clients.') === 0),
          cards: Array.from(document.querySelectorAll('#tile-join-list .complete-card button[data-join]')).map((b) => b.textContent),
          sectionHidden: document.getElementById('tile-join').hidden,
          done: done.textContent,
          doneHidden: done.hidden,
          listed: Array.from(document.querySelectorAll('#joins-list .joins-item')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
          barHidden: document.getElementById('joins-bar').hidden,
          focusInPanel: !!(active && active.closest && active.closest('#tile-panel')),
          focusTag: active ? active.tagName : '',
        };
      });
      const wanted = JSON.stringify([{ alias: 'Clients', table: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' }]);
      if (JSON.stringify(second.joins) !== wanted) problems.push('« Analyser par nom » : jointures posées ' + JSON.stringify(second.joins) + ' au lieu de ' + wanted);
      if (second.blend) problems.push('« Analyser par nom » : le réglage manuel « Joindre une autre table » a été écrasé/rempli (' + JSON.stringify(second.blend) + ')');
      if (second.rows !== first.rows) problems.push('« Analyser par nom » : ' + first.rows + ' lignes avant, ' + second.rows + ' après (une jointure ne multiplie rien)');
      if (['Clients.Nom', 'Clients.Ville', 'Clients.Segment'].some((k) => second.keys.indexOf(k) === -1)) problems.push('« Analyser par nom » : colonnes jointes manquantes : ' + second.keys.join(', '));
      if (second.cards.length !== 1 || !/Personnes/.test(second.cards[0]) || second.sectionHidden || second.doneHidden || !/Clients/.test(second.done)) problems.push('« Analyser par nom » : la confirmation (Clients) et la carte restante (Personnes) ne sont pas là : ' + JSON.stringify({ cards: second.cards, sectionHidden: second.sectionHidden, done: second.done }));
      if (second.barHidden || second.listed.length !== 1 || !/Clients/.test(second.listed[0]) || !/Client/.test(second.listed[0])) problems.push('« Analyser par nom » : « Tables liées » du menu Données ne liste pas la jointure : ' + JSON.stringify(second.listed));
      if (!second.focusInPanel || second.focusTag === 'BODY') problems.push('« Analyser par nom » : le focus a quitté le panneau (' + second.focusTag + ')');
      // Enregistrée avec le rapport (écriture différée de 600 ms) : on relit la table de configuration jusqu'à y trouver la jointure.
      let saved = false;
      for (let i = 0; i < 20 && !saved; i++) {
        saved = await frame.evaluate(async () => {
          const t = await grist.docApi.fetchTable('BI_Dashboard_Config');
          return (t.ConfigJSON || []).some((j) => /"joins":\[\{"alias":"Clients","table":"Clients","primaryColumn":"Client","secondaryColumn":"id"\}\]/.test(j));
        }).catch(() => false);
        if (!saved) await frame.waitForTimeout(300);
      }
      if (!saved) problems.push('« Analyser par nom » : la jointure n\'est pas enregistrée avec le rapport (champ joins)');
      // Une 2e jointure s'AJOUTE : Personnes, sans défaire Clients.
      await frame.click('#tile-join-list button[data-join="0"]');
      const both = await frame.waitForFunction(() => GristBI.store.getState().joins.length === 2 && 'Personnes.Equipe' in (GristBI.store.getState().rows[0] || {}) && 'Clients.Ville' in (GristBI.store.getState().rows[0] || {}), null, { timeout: 8000 }).then(() => true, () => false);
      if (!both) problems.push('« Analyser par nom » : la 2e jointure (Personnes) n\'a pas été ajoutée à la 1re');
      await frame.waitForTimeout(700);
      const third = await frame.evaluate(() => ({
        rows: GristBI.store.getState().rows.length,
        cards: document.querySelectorAll('#tile-join-list .complete-card').length,
        done: document.getElementById('tile-join-done').textContent,
        listed: document.querySelectorAll('#joins-list .joins-item').length,
        focusInPanel: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tile-panel')),
      }));
      if (third.rows !== first.rows) problems.push('« Analyser par nom » : ' + third.rows + ' lignes après la 2e jointure au lieu de ' + first.rows);
      if (third.cards || !/Personnes/.test(third.done) || third.listed !== 2) problems.push('« Analyser par nom » : après la 2e jointure : ' + JSON.stringify(third));
      if (!third.focusInPanel) problems.push('« Analyser par nom » : le focus a quitté le panneau après la 2e jointure');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      const closed = await frame.evaluate(() => ({ hidden: document.getElementById('tile-join').hidden, done: document.getElementById('tile-join-done').textContent, cards: document.querySelectorAll('#tile-join-list .complete-card').length }));
      if (!closed.hidden || closed.done || closed.cards) problems.push('panneau fermé : les cartes de jointure ou leur confirmation restent (' + JSON.stringify(closed) + ')');
      await frame.evaluate(() => GristBI.openTilePanel({ step: 'choose' }));
      await frame.waitForTimeout(500);
      const reopened = await frame.evaluate(() => ({ hidden: document.getElementById('tile-join').hidden, cards: document.querySelectorAll('#tile-join-list .complete-card').length }));
      if (!reopened.hidden || reopened.cards) problems.push('panneau rouvert : les deux tables sont déjà jointes, rien ne doit être reproposé (' + JSON.stringify(reopened) + ')');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      // Retirer une jointure : refusé tant qu'une tuile la lit, accepté sinon. Un VRAI clic sur la croix, dans le menu Données.
      await frame.evaluate(() => {
        GristBI.store.addTile({ id: 'seed-join', type: 'bar', title: 'Par ville', dimension: 'Clients.Ville', measure: 'Montant', aggFn: 'sum' });
        document.getElementById('data-pill').click();
      });
      await frame.waitForSelector('#joins-list .views-item-delete[data-alias="Clients"]', { state: 'visible', timeout: 5000 }).catch(() => {});
      await frame.click('#joins-list .views-item-delete[data-alias="Clients"]');
      await frame.waitForTimeout(500);
      const refused = await frame.evaluate(() => ({ joins: GristBI.store.getState().joins.map((j) => j.alias), note: document.getElementById('joins-note').textContent, joined: 'Clients.Ville' in (GristBI.store.getState().rows[0] || {}) }));
      if (refused.joins.join() !== 'Clients,Personnes' || !refused.joined) problems.push('« Tables liées » : retirer Clients, que la tuile « Par ville » lit, n\'a pas été refusé (' + JSON.stringify(refused) + ')');
      if (!/Clients/.test(refused.note) || !/1 tuile/.test(refused.note)) problems.push('« Tables liées » : le refus ne dit pas ce qui lit la jointure : « ' + refused.note + ' »');
      await frame.click('#joins-list .views-item-delete[data-alias="Personnes"]');
      const removed = await frame.waitForFunction(() => GristBI.store.getState().joins.length === 1 && !('Personnes.Equipe' in (GristBI.store.getState().rows[0] || {})), null, { timeout: 8000 }).then(() => true, () => false);
      if (!removed) problems.push('« Tables liées » : retirer Personnes (lue par personne) n\'a pas retiré la jointure et ses colonnes');
      const after = await frame.evaluate(() => ({ joins: GristBI.store.getState().joins.map((j) => j.alias), note: document.getElementById('joins-note').textContent, ville: 'Clients.Ville' in (GristBI.store.getState().rows[0] || {}), listed: document.querySelectorAll('#joins-list .joins-item').length }));
      if (after.joins.join() !== 'Clients' || !after.ville || after.listed !== 1 || after.note) problems.push('« Tables liées » : après le retrait de Personnes : ' + JSON.stringify(after));
      await frame.evaluate(() => {
        GristBI.store.removeTile('seed-join');
        document.getElementById('data-pill').click();
      });
      if (!problems.some((p) => /Analyser par nom|panneau rouvert|jointure|Tables liées/.test(p))) verified.push('« Analyser par nom » + « Tables liées » : deux propositions, un clic réel = une jointure qui s\'ajoute (lignes ' + first.rows + ', colonnes Clients.*), enregistrée, listée, retrait refusé quand une tuile la lit, accepté sinon, focus, rien de reproposé');
    }

    // 8. « Ajouter une page entière » (niveau 3d-2) : à partir d'UNE seule tuile posée (un histogramme de `Quantite`, qui ne répond à aucune question
    // des modèles), le panneau propose des pages de modèle ; un VRAI clic sur « Ajouter la page » crée la page ET ses visualisations (au moins trois,
    // sans doublon), la personne arrive sur la nouvelle page, l'annonce est écrite, le focus reste dans le panneau, et la page posée n'est pas reproposée.
    await frame.evaluate(() => {
      if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click();
      GristBI.closeTilePanel(false);
      const store = GristBI.store;
      store.getState().tiles.slice().forEach((tile) => store.removeTile(tile.id));
      store.addTile({ id: 'seed-hist', type: 'histogram', title: 'Quantités', measure: 'Quantite' });
      GristBI.openTilePanel({ step: 'choose' });
    });
    const pageOffered = await frame.waitForSelector('#tile-pages-list button[data-page]', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
    if (!pageOffered) problems.push('« Ajouter une page entière » : aucune page proposée à partir d\'une seule tuile posée');
    else {
      const first = await frame.evaluate(() => ({
        pages: GristBI.store.getState().pages.length,
        names: Array.from(document.querySelectorAll('#tile-pages-list .complete-card-title')).map((el) => el.textContent),
        cards: document.querySelectorAll('#tile-pages-list .page-card').length,
        reason: document.querySelector('#tile-pages-list .complete-card-reason').textContent,
        button: document.querySelector('#tile-pages-list button[data-page]').textContent,
        glyphs: document.querySelectorAll('#tile-pages-list .page-card')[0].querySelectorAll('.page-card-type').length,
      }));
      if (first.cards < 1 || first.cards > 2) problems.push('« Ajouter une page entière » : ' + first.cards + ' cartes (1 ou 2 attendues)');
      if (first.glyphs < 3) problems.push('« Ajouter une page entière » : ' + first.glyphs + ' pictogrammes de visualisation (3 au moins attendus)');
      if (!first.reason || /\{|\}|undefined|NaN/.test(first.reason)) problems.push('« Ajouter une page entière » : phrase absente ou mal résolue : « ' + first.reason + ' »');
      await frame.click('#tile-pages-list button[data-page="0"]');
      const created = await frame.waitForFunction((n) => GristBI.store.getState().pages.length === n + 1, first.pages, { timeout: 5000 }).then(() => true, () => false);
      if (!created) problems.push('« Ajouter une page entière » : un clic sur « Ajouter la page » n\'a pas créé la page (un clic perdu ?)');
      await frame.waitForTimeout(700);
      const second = await frame.evaluate(() => {
        const state = GristBI.store.getState();
        const active = document.activeElement;
        return {
          pages: state.pages.length,
          current: (state.pages.find((p) => p.id === state.currentPageId) || {}).name,
          tiles: state.tiles.length,
          types: state.tiles.map((tile) => tile.type),
          ids: state.tiles.map((tile) => tile.id),
          live: document.getElementById('tile-pages-live').textContent,
          names: Array.from(document.querySelectorAll('#tile-pages-list .complete-card-title')).map((el) => el.textContent),
          focusInPanel: !!(active && active.closest && active.closest('#tile-panel')),
          focusTag: active ? active.tagName : '',
        };
      });
      if (second.pages !== first.pages + 1) problems.push('« Ajouter une page entière » : ' + first.pages + ' -> ' + second.pages + ' pages (une seule attendue)');
      if (second.tiles < 3) problems.push('« Ajouter une page entière » : ' + second.tiles + ' visualisations sur la nouvelle page (3 au moins attendues)');
      if (new Set(second.ids).size !== second.ids.length) problems.push('« Ajouter une page entière » : identifiants de tuile en double : ' + second.ids.join(', '));
      if (second.types.indexOf('text') !== -1) problems.push('« Ajouter une page entière » : une note s\'est glissée dans la page');
      if (!second.live || !second.live.includes(second.current || '?')) problems.push('« Ajouter une page entière » : annonce absente ou sans le nom de la page (« ' + second.live + ' » / page « ' + second.current + ' »)');
      if (!second.focusInPanel || second.focusTag === 'BODY') problems.push('« Ajouter une page entière » : le focus a quitté le panneau (' + second.focusTag + ')');
      if (second.names.some((name) => name === first.names[0])) problems.push('« Ajouter une page entière » : la page posée est reproposée (« ' + first.names[0] + ' »)');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      const closed = await frame.evaluate(() => ({ hidden: document.getElementById('tile-pages').hidden, cards: document.querySelectorAll('#tile-pages-list .page-card').length }));
      if (!closed.hidden || closed.cards) problems.push('panneau fermé : les cartes de pages restent (' + JSON.stringify(closed) + ')');
      if (!problems.some((p) => /page entière|panneau fermé/.test(p))) verified.push('« Ajouter une page entière » : ' + first.cards + ' propositions, un clic réel = page « ' + second.current + ' » + ' + second.tiles + ' visualisations, annonce, focus, fermeture');
    }

    // 9. Lot 1b « colonnes de toutes les tables » : les listes de colonnes du formulaire portent aussi celles des tables LIÉES, rangées par table.
    // Après l'étape 7, `Clients` est jointe (ses colonnes sont dans les lignes) et `Personnes` ne l'est pas (`Ventes.Vendeur` est une Référence vers elle).
    // 9a. Les intitulés : la table de travail, puis `Clients` (colonnes sans « en attente »), puis `Personnes` (colonnes à relier d'abord).
    // 9b. Une table illisible : choisir sa colonne (frappe + Entrée, VRAIS gestes) dit l'échec, retire la jointure posée pour ce choix, rend au champ sa
    //     valeur d'avant et n'émet AUCUN `change`. 9c. La table lisible : même geste = la jointure est posée, les lignes refaites, et le `change` ne part
    //     qu'ENSUITE (la colonne est déjà dans les lignes) ; la phrase le dit ; la liste ne la propose plus « à relier » ; la tuile enregistrée se dessine.
    {
    await frame.evaluate(() => {
      if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click();
      GristBI.closeTilePanel(false);
      GristBI.openTilePanel({ type: 'bar' });
      window.__picks = [];
      const input = document.getElementById('tile-dimension');
      input.addEventListener('change', () => window.__picks.push({
        value: input.value, has: 'Personnes.Equipe' in (GristBI.store.getState().rows[0] || {}) || 'Personnes.Prenom' in (GristBI.store.getState().rows[0] || {}), joins: GristBI.store.getState().joins.length
      }));
    });
    const listOf = () => frame.evaluate(() => {
      const ul = document.getElementById('tile-dimension').nextElementSibling;
      return {
        hidden: ul.hidden,
        groups: Array.from(ul.querySelectorAll('.combobox-group')).map((li) => li.textContent),
        options: Array.from(ul.querySelectorAll('.combobox-option')).map((li) => ({ value: li.dataset.value, text: li.textContent, pending: li.classList.contains('combobox-option-pending') }))
      };
    });
    await frame.click('#tile-dimension');
    const listed = await listOf();
    const optionOf = (list, value) => list.options.find((o) => o.value === value);
    if (listed.hidden) problems.push('colonnes liées : la liste ne s\'ouvre pas au clic');
    if (listed.groups.join('|') !== 'Ventes|Clients|Personnes') problems.push('colonnes liées : intitulés « ' + listed.groups.join(' | ') + ' » au lieu de « Ventes | Clients | Personnes »');
    const ville = optionOf(listed, 'Clients.Ville');
    const equipe = optionOf(listed, 'Personnes.Equipe');
    if (!ville || ville.text !== 'Ville' || ville.pending) problems.push('colonnes liées : « Clients.Ville » (table déjà jointe) : ' + JSON.stringify(ville));
    if (!equipe || equipe.text !== 'Equipe' || !equipe.pending) problems.push('colonnes liées : « Personnes.Equipe » (table à relier) : ' + JSON.stringify(equipe));
    if (!optionOf(listed, 'Region') || optionOf(listed, 'Region').pending) problems.push('colonnes liées : la colonne de la table de travail « Region » manque ou attend une jointure');
    if (listed.options.some((o) => /\.(id|manualSort)$/.test(o.value))) problems.push('colonnes liées : un numéro de ligne est proposé comme colonne');

    // 9b. Table illisible.
    tolerated.push(/table jointe "Personnes" illisible/, /échec de la jointure/);
    // Les lignes d'une table jointe sont gardées en mémoire (étape 7 : Personnes l'a été) : on vide cette mémoire, puis on rend la table illisible.
    await frame.evaluate(async () => { await GristBI.mainParts.reloadWorkingTable(); window.__gristStubFailTables = ['Personnes']; });
    const before = await frame.evaluate(() => ({ value: document.getElementById('tile-dimension').value, joins: GristBI.store.getState().joins.map((j) => j.alias) }));
    await frame.press('#tile-dimension', 'Control+A');
    await frame.type('#tile-dimension', 'personnes.prenom');
    await frame.press('#tile-dimension', 'Enter');
    await frame.waitForSelector('#pp-dialog-modal', { state: 'visible', timeout: 8000 }).catch(() => {});
    await frame.waitForFunction(() => !document.getElementById('tile-dimension').hasAttribute('aria-busy'), null, { timeout: 8000 }).catch(() => {});
    const failed = await frame.evaluate(() => ({
      value: document.getElementById('tile-dimension').value,
      busy: document.getElementById('tile-dimension').hasAttribute('aria-busy'),
      joins: GristBI.store.getState().joins.map((j) => j.alias),
      linked: 'Personnes.Prenom' in (GristBI.store.getState().rows[0] || {}),
      picks: window.__picks.length,
      note: document.getElementById('tile-link-note').hidden,
      dialog: !!document.getElementById('pp-dialog-modal') && !document.getElementById('pp-dialog-modal').hidden
    }));
    if (failed.picks !== 0) problems.push('colonnes liées : une table illisible a quand même émis ' + failed.picks + ' « change »');
    if (failed.value !== before.value) problems.push('colonnes liées : après l\'échec le champ vaut « ' + failed.value + ' » au lieu de « ' + before.value + ' »');
    if (failed.busy) problems.push('colonnes liées : le champ reste « occupé » après l\'échec');
    if (failed.joins.join() !== before.joins.join() || failed.linked) problems.push('colonnes liées : la jointure posée pour ce choix n\'a pas été retirée (' + failed.joins.join() + ')');
    if (!failed.note) problems.push('colonnes liées : la phrase « table reliée » est affichée alors que rien n\'a été relié');
    if (!failed.dialog) problems.push('colonnes liées : l\'échec de la jointure n\'est pas dit à la personne');
    await frame.press('body', 'Escape').catch(() => {});
    await frame.evaluate(() => { window.__gristStubFailTables = []; });

    // 9c. Table lisible : la jointure est posée AVANT le `change`.
    await frame.click('#tile-dimension');
    await frame.press('#tile-dimension', 'Control+A');
    await frame.type('#tile-dimension', 'personnes.eq');
    await frame.press('#tile-dimension', 'Enter');
    const picked = await frame.waitForFunction(() => window.__picks.length === 1 && 'Personnes.Equipe' in (GristBI.store.getState().rows[0] || {}), null, { timeout: 8000 }).then(() => true, () => false);
    if (!picked) problems.push('colonnes liées : choisir « Personnes.Equipe » n\'a pas posé la jointure ni émis de « change »');
    await frame.waitForTimeout(300);
    const done = await frame.evaluate(() => ({
      picks: window.__picks,
      value: document.getElementById('tile-dimension').value,
      busy: document.getElementById('tile-dimension').hasAttribute('aria-busy'),
      joins: GristBI.store.getState().joins.map((j) => j.alias),
      note: document.getElementById('tile-link-note').hidden ? '' : document.getElementById('tile-link-note').textContent,
      rows: GristBI.store.getState().rows.length
    }));
    if (done.picks.length !== 1 || done.picks[0].value !== 'Personnes.Equipe' || !done.picks[0].has || done.picks[0].joins !== 2) problems.push('colonnes liées : « change » = ' + JSON.stringify(done.picks) + ' (un seul attendu, après la jointure)');
    if (done.value !== 'Personnes.Equipe' || done.busy) problems.push('colonnes liées : le champ vaut « ' + done.value + ' »' + (done.busy ? ' et reste occupé' : ''));
    if (done.joins.join() !== 'Clients,Personnes') problems.push('colonnes liées : jointures « ' + done.joins.join() + ' » au lieu de « Clients,Personnes »');
    if (!/Personnes/.test(done.note)) problems.push('colonnes liées : la phrase « table reliée » est absente ou ne nomme pas la table : « ' + done.note + ' »');
    await frame.click('#tile-dimension'); // rouvre la liste : elle est refaite d'après les options d'AUJOURD'HUI (la jointure posée), jamais celle de la frappe d'avant
    const again = await listOf();
    if (again.options.some((o) => o.pending && /^Personnes\./.test(o.value)) || !optionOf(again, 'Personnes.Prenom')) problems.push('colonnes liées : une fois reliée, Personnes est encore proposée « à relier » ou a disparu : ' + JSON.stringify(again.options.filter((o) => /^Personnes\./.test(o.value))));
    await frame.press('#tile-dimension', 'Escape');
    await frame.click('#submit-tile');
    const drawnTile = await frame.waitForFunction(() => GristBI.store.getState().tiles.some((tile) => tile.dimension === 'Personnes.Equipe'), null, { timeout: 8000 }).then(() => true, () => false);
    if (!drawnTile) problems.push('colonnes liées : la tuile par « Personnes.Equipe » n\'a pas été ajoutée');
    else {
      await frame.waitForTimeout(900);
      const chart = await frame.evaluate(async () => {
        await GristBI.charts.whenSettled();
        const tile = GristBI.store.getState().tiles.find((tl) => tl.dimension === 'Personnes.Equipe');
        const el = document.querySelector('.tile[data-tile-id="' + tile.id + '"] .tile-chart');
        const inst = el && window.echarts ? echarts.getInstanceByDom(el) : null;
        const opt = inst ? inst.getOption() : null;
        const names = opt ? [].concat((opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [], (opt.yAxis && opt.yAxis[0] && opt.yAxis[0].data) || []).map(String).sort() : null;
        return { names };
      });
      if (!chart.names || chart.names.join() !== 'Alpha,Beta,Gamma') problems.push('colonnes liées : la tuile ne montre pas les équipes de Personnes : ' + JSON.stringify(chart.names));
    }
    if (!problems.some((p) => /colonnes liées/.test(p))) verified.push('colonnes liées : listes rangées par table, table illisible = choix annulé sans « change » ni jointure, table lisible = jointure posée AVANT le « change », tuile par « Personnes.Equipe » dessinée');
    }

    // 10. Lot 1c « colonnes de toutes les tables » : le menu Filtre, « Que faire avec cette colonne ? » et les cases de la table plate portent aussi les
    // colonnes des tables LIÉES. Chaque sous-pas repart d'une page neuve (aucune jointure : `Clients` et `Personnes` sont toutes deux « à relier »).
    {
    const restart = async () => {
      await page.reload({ waitUntil: 'load' });
      frame = page.mainFrame();
      if (framed) { await page.waitForSelector('#app'); frame = await (await page.$('#app')).contentFrame(); }
      await frame.waitForFunction(
        () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0 && GristBI.mainParts && GristBI.mainParts.S.linkSchema instanceof Map,
        null, { timeout: 25000 }
      );
      await frame.evaluate(() => { if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click(); });
    };
    const joinsOf = () => frame.evaluate(() => GristBI.store.getState().joins.map((j) => j.alias));
    const closeDialog = async () => {
      await frame.waitForSelector('#pp-dialog-modal', { state: 'visible', timeout: 8000 }).catch(() => {});
      await frame.press('body', 'Escape').catch(() => {});
      await frame.waitForFunction(() => { const d = document.getElementById('pp-dialog-modal'); return !d || d.hidden; }, null, { timeout: 4000 }).catch(() => {});
    };

    // 10a à 10d. Le menu Filtre.
    await restart();
    const filterState = () => frame.evaluate(() => ({
      groups: Array.from(document.querySelectorAll('#filter-column-list .filter-column-group')).map((li) => li.textContent),
      items: Array.from(document.querySelectorAll('#filter-column-list .filter-column-item')).map((b) => ({
        column: b.dataset.column, label: b.querySelector('.filter-column-label').textContent, pending: b.dataset.pending === '1', kind: b.querySelector('.kind-badge').textContent, aria: b.getAttribute('aria-label') || '', busy: b.hasAttribute('aria-busy')
      })),
      form: !document.getElementById('advanced-filter-form').hidden,
      name: document.getElementById('filter-column-name').textContent,
      note: document.getElementById('filter-link-note').hidden ? '' : document.getElementById('filter-link-note').textContent,
      popover: !document.getElementById('filter-popover').hidden
    }));
    await frame.click('#filter-toggle');
    await frame.waitForSelector('#filter-column-list .filter-column-item', { state: 'visible', timeout: 8000 });
    const f0 = await filterState();
    const itemOf = (st, column) => st.items.find((i) => i.column === column);
    if (f0.groups.join('|') !== 'Ventes|Clients|Personnes') problems.push('menu Filtre : intitulés « ' + f0.groups.join(' | ') + ' » au lieu de « Ventes | Clients | Personnes »');
    const nom = itemOf(f0, 'Clients.Nom');
    const equipe0 = itemOf(f0, 'Personnes.Equipe');
    if (!nom || nom.label !== 'Nom' || !nom.pending || nom.kind !== 'Aa' || !/Clients/.test(nom.aria)) problems.push('menu Filtre : « Clients.Nom » : ' + JSON.stringify(nom));
    if (!equipe0 || equipe0.label !== 'Equipe' || !equipe0.pending) problems.push('menu Filtre : « Personnes.Equipe » : ' + JSON.stringify(equipe0));
    if (!itemOf(f0, 'Region') || itemOf(f0, 'Region').pending || itemOf(f0, 'Region').label !== 'Region') problems.push('menu Filtre : « Region » (table de travail) : ' + JSON.stringify(itemOf(f0, 'Region')));
    if (f0.items.some((i) => /\.(id|manualSort)$/.test(i.column))) problems.push('menu Filtre : un numéro de ligne est proposé comme colonne');
    // La recherche porte aussi sur le nom de la table.
    await frame.fill('#filter-column-search', 'personnes');
    const f1 = await filterState();
    if (f1.groups.join('|') !== 'Personnes' || !f1.items.length || f1.items.some((i) => i.column.indexOf('Personnes.') !== 0)) problems.push('menu Filtre : la recherche « personnes » montre ' + JSON.stringify(f1.groups) + ' / ' + f1.items.map((i) => i.column).join(','));
    // 10b. Table illisible : un VRAI clic ne passe pas à l'étape 2, ne joint rien, dit l'échec ; la liste reste là.
    await frame.evaluate(async () => { await GristBI.mainParts.reloadWorkingTable(); window.__gristStubFailTables = ['Personnes']; });
    await frame.click('#filter-column-list [data-column="Personnes.Prenom"]');
    await closeDialog();
    const f2 = await frame.evaluate(() => ({
      form: !document.getElementById('advanced-filter-form').hidden,
      note: document.getElementById('filter-link-note').hidden,
      busy: !!document.querySelector('#filter-column-list [aria-busy]'),
      linked: 'Personnes.Prenom' in (GristBI.store.getState().rows[0] || {}),
      joins: GristBI.store.getState().joins.length
    }));
    if (f2.form) problems.push('menu Filtre : une table illisible a quand même ouvert le réglage du filtre');
    if (!f2.note) problems.push('menu Filtre : la phrase « table reliée » est affichée alors que rien n\'a été relié');
    if (f2.busy) problems.push('menu Filtre : une colonne reste « occupée » après l\'échec');
    if (f2.linked || f2.joins) problems.push('menu Filtre : la jointure posée pour ce choix n\'a pas été retirée (' + f2.joins + ')');
    await frame.evaluate(() => { window.__gristStubFailTables = []; });
    // 10c. Table lisible : le même clic pose la jointure, passe à l'étape 2 sur les lignes jointes, dit la table reliée, propose les valeurs.
    if (await frame.evaluate(() => document.getElementById('filter-popover').hidden)) await frame.click('#filter-toggle');
    await frame.fill('#filter-column-search', 'personnes.eq');
    await frame.click('#filter-column-list [data-column="Personnes.Equipe"]');
    const stepTwo = await frame.waitForFunction(() => !document.getElementById('advanced-filter-form').hidden && GristBI.store.getState().joins.length === 1, null, { timeout: 8000 }).then(() => true, () => false);
    if (!stepTwo) problems.push('menu Filtre : choisir « Personnes.Equipe » n\'a pas posé la jointure ni ouvert le réglage du filtre');
    const f3 = await frame.evaluate(() => ({
      name: document.getElementById('filter-column-name').textContent,
      note: document.getElementById('filter-link-note').hidden ? '' : document.getElementById('filter-link-note').textContent,
      values: Array.from(document.querySelectorAll('#filter-value-list .filter-value-item')).map((b) => b.textContent).sort(),
      joins: GristBI.store.getState().joins.map((j) => j.alias),
      rows: GristBI.store.getState().rows.length
    }));
    if (f3.name !== 'Personnes.Equipe') problems.push('menu Filtre : colonne du réglage « ' + f3.name + ' »');
    if (!/Personnes/.test(f3.note)) problems.push('menu Filtre : la phrase « table reliée » est absente ou ne nomme pas la table : « ' + f3.note + ' »');
    if (f3.values.join() !== 'Alpha,Beta,Gamma') problems.push('menu Filtre : valeurs proposées « ' + f3.values.join() + ' » au lieu de « Alpha,Beta,Gamma »');
    if (f3.joins.join() !== 'Personnes') problems.push('menu Filtre : jointures « ' + f3.joins.join() + ' »');
    await frame.click('#filter-value-list [data-value="Alpha"]');
    const f4 = await frame.evaluate(() => {
      const state = GristBI.store.getState();
      const kept = GristBI.data.applyFilters(state.rows, state.advancedFilters);
      return { filters: state.advancedFilters.map((f) => f.column), total: state.rows.length, kept: kept.length, allAlpha: kept.every((r) => r['Personnes.Equipe'] === 'Alpha') };
    });
    if (f4.filters.join() !== 'Personnes.Equipe') problems.push('menu Filtre : filtres posés « ' + f4.filters.join() + ' »');
    if (!f4.kept || f4.kept >= f4.total || !f4.allAlpha) problems.push('menu Filtre : le filtre sur « Personnes.Equipe » retient ' + f4.kept + ' lignes sur ' + f4.total + (f4.allAlpha ? '' : ' (pas toutes Alpha)'));
    // Rouvert, le menu repart de son 1er écran : plus de phrase.
    await frame.evaluate(() => { document.getElementById('filter-toggle').click(); document.getElementById('filter-toggle').click(); });
    const f5 = await filterState();
    if (f5.note) problems.push('menu Filtre : la phrase « table reliée » reste au menu rouvert : « ' + f5.note + ' »');
    if (!problems.some((p) => /menu Filtre/.test(p))) verified.push('menu Filtre : colonnes rangées par table (recherche par table comprise), table illisible = rien choisi ni joint, table lisible = jointure posée puis réglage sur les lignes jointes, valeurs proposées, filtre posé (' + f4.kept + ' lignes sur ' + f4.total + ')');

    // 10d. « Que faire avec cette colonne ? » : une colonne d'une table liée se choisit comme les autres ; la jointure est posée avant la question.
    await restart();
    await frame.evaluate(() => { GristBI.closeTilePanel(false); GristBI.openTilePanel({ step: 'choose' }); });
    await frame.click('#tile-column > summary');
    await frame.click('#tile-column-pick');
    const colList = await frame.evaluate(() => {
      const ul = document.getElementById('tile-column-pick').nextElementSibling;
      return { groups: Array.from(ul.querySelectorAll('.combobox-group')).map((li) => li.textContent), pending: Array.from(ul.querySelectorAll('.combobox-option-pending')).map((li) => li.dataset.value) };
    });
    if (colList.groups.join('|') !== 'Ventes|Clients|Personnes') problems.push('« Que faire avec cette colonne ? » : intitulés « ' + colList.groups.join(' | ') + ' »');
    if (colList.pending.indexOf('Clients.Ville') === -1) problems.push('« Que faire avec cette colonne ? » : « Clients.Ville » n\'est pas proposée (' + colList.pending.join(',') + ')');
    await page.keyboard.type('clients.vil');
    await page.keyboard.press('Enter');
    const asked = await frame.waitForSelector('#tile-column-list button[data-column-add]', { state: 'visible', timeout: 10000 }).then(() => true, () => false);
    if (!asked) problems.push('« Que faire avec cette colonne ? » : aucune carte après le choix de « Clients.Ville »');
    else {
      const c1 = await frame.evaluate(() => ({
        value: document.getElementById('tile-column-pick').value,
        profile: document.getElementById('tile-column-profile').textContent,
        cards: document.querySelectorAll('#tile-column-list .complete-card').length,
        joins: GristBI.store.getState().joins.map((j) => j.alias),
        note: document.getElementById('tile-link-note').hidden ? '' : document.getElementById('tile-link-note').textContent,
        tiles: GristBI.store.getState().tiles.length
      }));
      if (c1.value !== 'Clients.Ville') problems.push('« Que faire avec cette colonne ? » : le champ vaut « ' + c1.value + ' »');
      if (c1.joins.join() !== 'Clients') problems.push('« Que faire avec cette colonne ? » : jointures « ' + c1.joins.join() + ' » au lieu de « Clients »');
      if (!/Clients\.Ville/.test(c1.profile)) problems.push('« Que faire avec cette colonne ? » : la phrase du rôle ne nomme pas la colonne : « ' + c1.profile + ' »');
      if (c1.cards < 1 || c1.cards > 3) problems.push('« Que faire avec cette colonne ? » : ' + c1.cards + ' cartes (1 à 3 attendues)');
      if (!/Clients/.test(c1.note)) problems.push('« Que faire avec cette colonne ? » : la phrase « table reliée » est absente : « ' + c1.note + ' »');
      await frame.click('#tile-column-list button[data-column-add="0"]');
      await frame.waitForFunction((n) => GristBI.store.getState().tiles.length === n + 1, c1.tiles, { timeout: 5000 }).catch(() => {});
      const c2 = await frame.evaluate(() => {
        const state = GristBI.store.getState();
        return { tiles: state.tiles.length, reads: state.tiles.length ? JSON.stringify(state.tiles[state.tiles.length - 1]).indexOf('Clients.Ville') !== -1 : false, joins: state.joins.length };
      });
      if (c2.tiles !== c1.tiles + 1) problems.push('« Que faire avec cette colonne ? » : « Ajouter » ' + c1.tiles + ' -> ' + c2.tiles + ' tuiles');
      else if (!c2.reads || c2.joins !== 1) problems.push('« Que faire avec cette colonne ? » : la tuile posée ne lit pas « Clients.Ville » ou la jointure a disparu (' + JSON.stringify(c2) + ')');
      if (!problems.some((p) => /Que faire/.test(p))) verified.push('« Que faire avec cette colonne ? » sur une table liée : intitulés, jointure posée au choix, phrase du rôle, ' + c1.cards + ' cartes, la tuile posée lit « Clients.Ville »');
    }

    // 10e. Table plate : les colonnes des tables liées se cochent à la suite de la liste ; cocher pose la jointure, la colonne prend sa place, cochée.
    await restart();
    await frame.evaluate(() => { GristBI.closeTilePanel(false); GristBI.openTilePanel({ type: 'table' }); });
    const plate = () => frame.evaluate(() => ({
      groups: Array.from(document.querySelectorAll('#tile-columns li.col-group')).map((li) => li.textContent),
      pending: Array.from(document.querySelectorAll('#tile-columns li[data-pending]')).map((li) => li.dataset.col),
      checkedReal: Array.from(document.querySelectorAll('#tile-columns li[data-col]:not([data-pending])')).filter((li) => li.querySelector('input').checked).map((li) => li.dataset.col),
      all: Array.from(document.querySelectorAll('#tile-columns li[data-col]:not([data-pending])')).map((li) => li.dataset.col),
      pickerRead: GristBI.mainParts.readColumnsPicker(),
      joins: GristBI.store.getState().joins.map((j) => j.alias),
      note: document.getElementById('tile-link-note').hidden ? '' : document.getElementById('tile-link-note').textContent
    }));
    const p0 = await plate();
    if (p0.groups.join('|') !== 'Clients|Personnes') problems.push('table plate : intitulés « ' + p0.groups.join(' | ') + ' » au lieu de « Clients | Personnes »');
    if (p0.pending.join() !== 'Clients.Nom,Clients.Ville,Clients.Segment,Personnes.Prenom,Personnes.Equipe') problems.push('table plate : colonnes à relier « ' + p0.pending.join() + ' »');
    if (p0.pickerRead.some((c) => /\./.test(c)) || p0.all.some((c) => /^(Clients|Personnes)\./.test(c))) problems.push('table plate : une colonne à relier a été prise pour une colonne de la table : ' + JSON.stringify(p0.pickerRead));
    // Table illisible : la case se décoche, rien n'est joint.
    await frame.evaluate(async () => { await GristBI.mainParts.reloadWorkingTable(); window.__gristStubFailTables = ['Personnes']; });
    await frame.click('#tile-columns li[data-col="Personnes.Prenom"] input');
    await closeDialog();
    await frame.waitForFunction(() => !document.querySelector('#tile-columns [aria-busy]'), null, { timeout: 8000 }).catch(() => {});
    const p1 = await frame.evaluate(() => {
      const li = document.querySelector('#tile-columns li[data-col="Personnes.Prenom"]');
      return { exists: !!li, pending: li ? li.hasAttribute('data-pending') : null, checked: li ? li.querySelector('input').checked : null, joins: GristBI.store.getState().joins.length };
    });
    if (!p1.exists || !p1.pending || p1.checked || p1.joins) problems.push('table plate : une table illisible laisse la case cochée ou une jointure : ' + JSON.stringify(p1));
    await frame.evaluate(() => { window.__gristStubFailTables = []; });
    // Un schéma qui ne connaît plus la table (changé entre l'ouverture de la liste et la case) : aucune jointure n'est tentée, donc AUCUNE liste refaite —
    // c'est le gestionnaire de la case qui doit la décocher.
    await frame.evaluate(() => { window.__savedSchema = GristBI.mainParts.S.linkSchema; GristBI.mainParts.S.linkSchema = new Map(); });
    await frame.click('#tile-columns li[data-col="Personnes.Equipe"] input');
    await frame.waitForFunction(() => !document.querySelector('#tile-columns [aria-busy]'), null, { timeout: 8000 }).catch(() => {});
    const p1b = await frame.evaluate(() => {
      const li = document.querySelector('#tile-columns li[data-col="Personnes.Equipe"]');
      GristBI.mainParts.S.linkSchema = window.__savedSchema;
      return { exists: !!li, pending: li ? li.hasAttribute('data-pending') : null, checked: li ? li.querySelector('input').checked : null, busy: li ? li.hasAttribute('aria-busy') : null, joins: GristBI.store.getState().joins.length };
    });
    if (!p1b.exists || !p1b.pending || p1b.checked || p1b.busy || p1b.joins) problems.push('table plate : un schéma qui ne connaît plus la table laisse la case cochée, occupée ou une jointure : ' + JSON.stringify(p1b));
    // Table lisible : la case cochée devient la colonne de la liste, cochée, avec le focus ; la jointure est posée ; la phrase le dit.
    await frame.click('#tile-columns li[data-col="Clients.Ville"] input');
    const placed = await frame.waitForSelector('#tile-columns li[data-col="Clients.Ville"]:not([data-pending]) input:checked', { timeout: 8000 }).then(() => true, () => false);
    if (!placed) problems.push('table plate : cocher « Clients.Ville » ne l\'a pas placée dans la liste, cochée');
    else {
      const p2 = await plate();
      const focus = await frame.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest('li') ? a.closest('li').dataset.col : (a ? a.tagName : ''); });
      if (p2.joins.join() !== 'Clients') problems.push('table plate : jointures « ' + p2.joins.join() + ' » au lieu de « Clients »');
      if (p2.checkedReal.indexOf('Clients.Ville') === -1 || p2.pickerRead.indexOf('Clients.Ville') === -1) problems.push('table plate : « Clients.Ville » n\'est pas lue comme colonne cochée : ' + JSON.stringify(p2.pickerRead));
      if (p2.pending.some((c) => /^Clients\./.test(c)) || p2.pending.join() !== 'Personnes.Prenom,Personnes.Equipe') problems.push('table plate : encore à relier « ' + p2.pending.join() + ' »');
      if (!/Clients/.test(p2.note)) problems.push('table plate : la phrase « table reliée » est absente : « ' + p2.note + ' »');
      if (focus !== 'Clients.Ville') problems.push('table plate : le focus est sur « ' + focus + ' » au lieu de la case « Clients.Ville »');
      await frame.click('#submit-tile');
      const made = await frame.waitForFunction(() => GristBI.store.getState().tiles.some((tl) => tl.type === 'table' && (tl.columns || []).indexOf('Clients.Ville') !== -1), null, { timeout: 8000 }).then(() => true, () => false);
      if (!made) problems.push('table plate : la tuile ajoutée ne porte pas « Clients.Ville » parmi ses colonnes');
      else {
        await frame.waitForTimeout(500);
        const header = await frame.evaluate(async () => {
          await GristBI.charts.whenSettled();
          const tile = GristBI.store.getState().tiles.find((tl) => tl.type === 'table');
          const el = document.querySelector('.tile[data-tile-id="' + tile.id + '"]');
          return el ? el.textContent.indexOf('Clients.Ville') !== -1 && /Lyon|Nantes|Lille/.test(el.textContent) : false;
        });
        if (!header) problems.push('table plate : la tuile n\'affiche pas la colonne « Clients.Ville » et ses villes');
      }
    }
    if (!problems.some((p) => /table plate/.test(p))) verified.push('table plate : colonnes liées à la suite de la liste, table illisible = case décochée sans jointure, table lisible = jointure posée et colonne cochée à sa place (focus, phrase), tuile qui affiche les villes');
    }

    // 11. Lot 2 « colonnes de toutes les tables » : une visualisation garde sa table. Le champ « Table » du formulaire, les colonnes de l'autre table (et
    // elles seules), la tuile qui lit `Clients` (badge, graphique), un filtre qui ne sort pas de sa table, une table illisible.
    {
    const restartFresh = async () => {
      await page.reload({ waitUntil: 'load' });
      frame = page.mainFrame();
      if (framed) { await page.waitForSelector('#app'); frame = await (await page.$('#app')).contentFrame(); }
      await frame.waitForFunction(
        () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0 && GristBI.mainParts && GristBI.mainParts.S.linkSchema instanceof Map,
        null, { timeout: 25000 }
      );
      await frame.evaluate(() => { if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click(); });
    };
    const closeDialogLater = async () => {
      await frame.waitForSelector('#pp-dialog-modal', { state: 'visible', timeout: 8000 }).catch(() => {});
      await frame.click('#pp-dialog-modal button:has-text("Fermer")', { timeout: 3000 }).catch(() => frame.press('body', 'Escape').catch(() => {}));
      await frame.waitForFunction(() => { const d = document.getElementById('pp-dialog-modal'); return !d || d.hidden; }, null, { timeout: 4000 }).catch(() => {});
    };
    await restartFresh();
    await frame.evaluate(() => {
      GristBI.store.addTile({ id: 'v1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
      GristBI.closeTilePanel(false);
      GristBI.openTilePanel({ type: 'bar' });
    });
    const fieldShown = await frame.waitForFunction(() => !document.getElementById('tile-table-field').hidden, null, { timeout: 8000 }).then(() => true, () => false);
    if (!fieldShown) problems.push('une tuile, sa table : le champ « Table » ne se montre pas alors que le document compte trois tables');
    const tf0 = await frame.evaluate(() => ({
      value: document.getElementById('tile-table').value,
      note: document.getElementById('tile-table-note').hidden,
      formTable: GristBI.mainParts.S.formTable
    }));
    if (tf0.value !== 'Ventes' || !tf0.note || tf0.formTable !== '') problems.push('une tuile, sa table : au départ le champ vaut « ' + tf0.value + ' » (attendu Ventes), note ' + (tf0.note ? 'masquée' : 'visible') + ', table du formulaire « ' + tf0.formTable + ' »');
    await frame.click('#tile-table');
    const tableList = await frame.evaluate(() => Array.from(document.getElementById('tile-table').nextElementSibling.querySelectorAll('.combobox-option')).map((li) => li.dataset.value).sort());
    if (tableList.join() !== 'Clients,Personnes,Ventes') problems.push('une tuile, sa table : les tables proposées sont « ' + tableList.join() + ' » au lieu de « Clients,Personnes,Ventes » (jamais une table interne ni système)');
    await frame.press('#tile-table', 'Control+A');
    await frame.type('#tile-table', 'clients');
    await frame.press('#tile-table', 'Enter');
    const switched = await frame.waitForFunction(() => GristBI.mainParts.S.formTable === 'Clients' && Array.isArray(GristBI.store.getState().tableRows.Clients), null, { timeout: 8000 }).then(() => true, () => false);
    if (!switched) problems.push('une tuile, sa table : choisir « Clients » n\'a pas lu cette table ni changé celle du formulaire');
    await frame.waitForTimeout(300);
    await frame.click('#tile-dimension');
    const dimOptions = await frame.evaluate(() => {
      const ul = document.getElementById('tile-dimension').nextElementSibling;
      return { values: Array.from(ul.querySelectorAll('.combobox-option')).map((li) => li.dataset.value), groups: ul.querySelectorAll('.combobox-group').length, note: document.getElementById('tile-table-note').hidden ? '' : document.getElementById('tile-table-note').textContent };
    });
    if (dimOptions.values.join() !== 'Nom,Ville,Segment') problems.push('une tuile, sa table : les colonnes proposées sont « ' + dimOptions.values.join() + ' » au lieu de celles de Clients (Nom,Ville,Segment)');
    if (dimOptions.groups) problems.push('une tuile, sa table : une autre table n\'a pas de jointures, aucun intitulé de table n\'est attendu dans la liste');
    if (!/Clients/.test(dimOptions.note)) problems.push('une tuile, sa table : la phrase sous le champ ne nomme pas la table : « ' + dimOptions.note + ' »');
    await frame.press('#tile-dimension', 'Control+A');
    await frame.type('#tile-dimension', 'ville');
    await frame.press('#tile-dimension', 'Enter');
    await frame.click('#tile-measure');
    await frame.press('#tile-measure', 'Control+A');
    await frame.type('#tile-measure', 'nom');
    await frame.press('#tile-measure', 'Enter');
    await frame.selectOption('#tile-agg', 'count');
    await frame.click('#submit-tile');
    const added = await frame.waitForFunction(() => GristBI.store.getState().tiles.some((tl) => tl.table === 'Clients' && tl.dimension === 'Ville'), null, { timeout: 8000 }).then(() => true, () => false);
    if (!added) problems.push('une tuile, sa table : la tuile par « Ville » n\'a pas été ajoutée avec `table: "Clients"`');
    else {
      await frame.waitForTimeout(900);
      const clientsTile = await frame.evaluate(async () => {
        await GristBI.charts.whenSettled();
        const tile = GristBI.store.getState().tiles.find((tl) => tl.table === 'Clients');
        const el = document.querySelector('.tile[data-tile-id="' + tile.id + '"]');
        const badge = el.querySelector('.tile-table');
        const chartEl = el.querySelector('.tile-chart');
        const inst = chartEl && window.echarts ? echarts.getInstanceByDom(chartEl) : null;
        const opt = inst ? inst.getOption() : null;
        const names = opt ? [].concat((opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || []).map(String).sort() : null;
        const values = opt && opt.series && opt.series[0] ? opt.series[0].data.map((d) => (d && typeof d === 'object' ? d.value : d)) : null;
        const other = document.querySelector('.tile[data-tile-id="v1"] .tile-table');
        return { id: tile.id, badge: badge && !badge.hidden ? badge.textContent : '', otherBadge: other ? !other.hidden : null, names, values, formTable: GristBI.mainParts.S.formTable, panel: document.getElementById('tile-panel').hidden };
      });
      if (clientsTile.badge !== 'Clients') problems.push('une tuile, sa table : le badge de la tuile vaut « ' + clientsTile.badge + ' » au lieu de « Clients »');
      if (clientsTile.otherBadge) problems.push('une tuile, sa table : la tuile de la table de travail porte un badge de table');
      if (!clientsTile.names || clientsTile.names.join() !== 'Lille,Lyon,Nantes') problems.push('une tuile, sa table : le graphique montre « ' + JSON.stringify(clientsTile.names) + ' » au lieu des villes de Clients');
      if (!clientsTile.values || clientsTile.values.join() !== '2,2,2') problems.push('une tuile, sa table : les valeurs sont « ' + JSON.stringify(clientsTile.values) + ' » (attendu 2 clients par ville)');
      if (!clientsTile.panel || clientsTile.formTable !== '') problems.push('une tuile, sa table : après l\'ajout le panneau est ' + (clientsTile.panel ? 'fermé' : 'ouvert') + ' et la table du formulaire « ' + clientsTile.formTable + ' »');

      await frame.evaluate(() => GristBI.store.addTile({ id: 'c2', type: 'bar', dimension: 'Segment', measure: 'Nom', aggFn: 'count', table: 'Clients' }));
      // Un filtre croisé posé sur Clients ne sort pas de Clients, et celui des ventes ne vide pas Clients (qui n'a pas de colonne « Region »).
      const barPoint = (tileId, category, value) => frame.evaluate(({ tileId: id, category: cat, value: val }) => {
        const el = document.querySelector('.tile[data-tile-id="' + id + '"] .tile-chart');
        const inst = echarts.getInstanceByDom(el);
        const [x, y] = inst.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [cat, val]);
        return { x, y };
      }, { tileId, category, value });
      const lyon = await barPoint(clientsTile.id, 'Lyon', 1);
      await frame.click('.tile[data-tile-id="' + clientsTile.id + '"] .tile-chart', { position: lyon });
      const f1 = await frame.waitForFunction(() => GristBI.store.getState().activeFilters.length === 1, null, { timeout: 5000 }).then(() => true, () => false);
      const afterClients = await frame.evaluate(() => {
        const st = GristBI.store.getState();
        const v1 = st.tiles.find((tl) => tl.id === 'v1');
        const clients = st.tiles.find((tl) => tl.id === 'c2');
        return {
          filters: st.activeFilters,
          ventesRows: GristBI.data.rowsForTile(v1, st).length,
          clientsRows: GristBI.data.rowsForTile(clients, st).length,
          chip: (document.getElementById('chips-row') || document.body).textContent
        };
      });
      if (!f1 || afterClients.filters[0].column !== 'Ville' || afterClients.filters[0].value !== 'Lyon' || afterClients.filters[0].table !== 'Clients') problems.push('une tuile, sa table : un clic sur « Lyon » pose ' + JSON.stringify(afterClients.filters) + ' (attendu un filtre de la table Clients)');
      if (afterClients.ventesRows !== 36) problems.push('une tuile, sa table : un filtre posé sur Clients touche les ventes (' + afterClients.ventesRows + ' lignes au lieu de 36)');
      if (!/Clients ›/.test(afterClients.chip)) problems.push('une tuile, sa table : la pastille du filtre ne nomme pas sa table : « ' + afterClients.chip.replace(/\s+/g, ' ').slice(0, 120) + ' »');
      const nord = await barPoint('v1', 'Nord', 100);
      await frame.click('.tile[data-tile-id="v1"] .tile-chart', { position: nord });
      const f2 = await frame.waitForFunction(() => GristBI.store.getState().activeFilters.length === 2, null, { timeout: 5000 }).then(() => true, () => false);
      const afterVentes = await frame.evaluate(async () => {
        await GristBI.charts.whenSettled();
        const st = GristBI.store.getState();
        const clients = st.tiles.find((tl) => tl.id === 'c2');
        return { filters: st.activeFilters.map((f) => f.column + '=' + f.value + (f.table ? '@' + f.table : '')), clientsRows: GristBI.data.rowsForTile(clients, st).length, ventesRows: GristBI.data.rowsForTile(st.tiles.find((tl) => tl.id === 'v1'), st).length };
      });
      if (!f2 || afterVentes.filters.join() !== 'Ville=Lyon@Clients,Region=Nord') problems.push('une tuile, sa table : les deux filtres attendus (Clients puis ventes) sont « ' + afterVentes.filters.join() + ' »');
      if (afterClients.clientsRows !== 2) problems.push('une tuile, sa table : le filtre « Ville = Lyon » ne retient pas 2 clients pour une autre tuile de Clients (' + afterClients.clientsRows + ' lignes)');
      if (afterVentes.clientsRows !== 2) problems.push('une tuile, sa table : le filtre « Region = Nord » des ventes a changé les lignes de Clients (' + afterVentes.clientsRows + ' au lieu de 2 : Lyon seulement)');
      // La croix de la pastille retire le filtre de SA table, pas celui du même nom d'une autre.
      await frame.click('.filter-chip-remove[data-table="Clients"]');
      const afterRemove = await frame.evaluate(() => GristBI.store.getState().activeFilters.map((f) => f.column + (f.table ? '@' + f.table : '')));
      if (afterRemove.join() !== 'Region') problems.push('une tuile, sa table : la croix de la pastille « Clients » laisse « ' + afterRemove.join() + ' » (attendu Region seul)');
      await frame.evaluate(() => GristBI.store.clearFilter());

      // Modifier la tuile : le formulaire reprend sa table et ses colonnes.
      await frame.evaluate((id) => { document.querySelector('.tile[data-tile-id="' + id + '"] .tile-edit').click(); }, clientsTile.id);
      await frame.waitForFunction(() => !document.getElementById('tile-panel').hidden && GristBI.mainParts.S.editingTileId, null, { timeout: 8000 }).catch(() => {});
      await frame.waitForTimeout(400);
      const edit = await frame.evaluate(() => ({
        formTable: GristBI.mainParts.S.formTable, tableValue: document.getElementById('tile-table').value, dimension: document.getElementById('tile-dimension').value,
        measure: document.getElementById('tile-measure').value, agg: document.getElementById('tile-agg').value
      }));
      if (edit.formTable !== 'Clients' || edit.tableValue !== 'Clients' || edit.dimension !== 'Ville' || edit.measure !== 'Nom' || edit.agg !== 'count') problems.push('une tuile, sa table : modifier la tuile ouvre ' + JSON.stringify(edit) + ' (attendu Clients / Ville / Nom / count)');
      // Revenir à la table de travail : la tuile ne porte plus de `table`, ses colonnes sont à refaire.
      await frame.click('#tile-table');
      await frame.press('#tile-table', 'Control+A');
      await frame.type('#tile-table', 'ventes');
      await frame.press('#tile-table', 'Enter');
      await frame.waitForFunction(() => GristBI.mainParts.S.formTable === '', null, { timeout: 5000 }).catch(() => {});
      await frame.waitForTimeout(300);
      const back = await frame.evaluate(() => ({ editing: GristBI.mainParts.S.editingTileId, formTable: GristBI.mainParts.S.formTable, dimension: document.getElementById('tile-dimension').value, note: document.getElementById('tile-table-note').hidden }));
      if (back.formTable !== '' || back.dimension !== 'Region' || !back.note) problems.push('une tuile, sa table : revenir à la table de travail laisse ' + JSON.stringify(back));
      await frame.evaluate(() => GristBI.closeTilePanel(false));
    }

    // 11b. Une table illisible : la tuile dit « illisible » (badge ⚠, message, zéro ligne) sans toucher aux autres ni relire en boucle.
    tolerated.push(/illisible pour une tuile/, /Table illisible|n'est pas lue/);
    await restartFresh();
    // Un rapport vide lit déjà les autres tables en silence au démarrage (l'accueil, lot 3B) et garde leurs lignes : la table est donc rendue
    // illisible AVANT de vider cette mémoire (`reloadWorkingTable`), sinon la tuile reprendrait les lignes lues quand elle l'était encore.
    await frame.evaluate(async () => { window.__gristStubFailTables = ['Clients']; await GristBI.mainParts.reloadWorkingTable(); });
    await frame.evaluate(() => {
      GristBI.store.addTile({ id: 'v1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
      GristBI.store.addTile({ id: 'c1', type: 'bar', dimension: 'Ville', measure: 'Nom', aggFn: 'count', table: 'Clients' });
    });
    await frame.waitForFunction(() => GristBI.store.getState().tableRows.Clients === null, null, { timeout: 8000 }).catch(() => {});
    await frame.waitForTimeout(500);
    const bad = await frame.evaluate(async () => {
      await GristBI.charts.whenSettled();
      const st = GristBI.store.getState();
      const badge = document.querySelector('.tile[data-tile-id="c1"] .tile-table');
      const dialog = document.getElementById('pp-dialog-modal');
      return {
        status: GristBI.data.tableRowsStatus(st, 'Clients'),
        badge: badge && !badge.hidden ? badge.textContent : '',
        state: badge ? badge.dataset.state : '',
        rows: GristBI.data.rowsForTile(st.tiles.find((tl) => tl.id === 'c1'), st).length,
        ventesRows: GristBI.data.rowsForTile(st.tiles.find((tl) => tl.id === 'v1'), st).length
      };
    });
    if (bad.status !== 'failed' || !/Clients/.test(bad.badge) || !/⚠/.test(bad.badge) || bad.state !== 'failed') problems.push('table illisible : état « ' + bad.status + ' », badge « ' + bad.badge + ' » (' + bad.state + ')');
    if (bad.rows !== 0 || bad.ventesRows !== 36) problems.push('table illisible : ' + bad.rows + ' ligne(s) pour la tuile (attendu 0), ' + bad.ventesRows + ' pour les ventes (attendu 36)');
    await closeDialogLater();
    // Aucun nouvel essai tant qu'on ne recharge pas : un rendu de plus ne relit pas la table.
    await frame.evaluate(() => GristBI.store.updateTile('v1', { title: 'autre' }));
    await frame.waitForTimeout(400);
    const stillFailed = await frame.evaluate(() => GristBI.store.getState().tableRows.Clients === null);
    if (!stillFailed) problems.push('table illisible : un rendu de plus a relu la table');
    // Le formulaire refuse d'écrire une tuile sur une table qu'il ne peut pas lire.
    await frame.evaluate(() => { GristBI.closeTilePanel(false); GristBI.openTilePanel({ type: 'bar' }); });
    await frame.waitForFunction(() => !document.getElementById('tile-table-field').hidden, null, { timeout: 8000 }).catch(() => {});
    await frame.click('#tile-table');
    await frame.press('#tile-table', 'Control+A');
    await frame.type('#tile-table', 'clients');
    await frame.press('#tile-table', 'Enter');
    await frame.waitForTimeout(500);
    await frame.click('#submit-tile');
    await frame.waitForTimeout(300);
    const refused = await frame.evaluate(() => ({ tiles: GristBI.store.getState().tiles.length, error: Array.from(document.querySelectorAll('#add-tile-form .field-error')).map((n) => n.textContent).join('|'), note: document.getElementById('tile-table-note').textContent }));
    if (refused.tiles !== 2) problems.push('table illisible : le formulaire a ajouté une tuile sur une table qu\'il ne lit pas (' + refused.tiles + ' tuiles)');
    if (!/Clients/.test(refused.error)) problems.push('table illisible : aucun message sous le champ « Table » : ' + JSON.stringify(refused));
    if (!/Clients/.test(refused.note)) problems.push('table illisible : la phrase sous le champ ne dit pas que la table est illisible : ' + JSON.stringify(refused));
    await frame.evaluate(() => { window.__gristStubFailTables = []; GristBI.closeTilePanel(false); });
    if (!problems.some((p) => /une tuile, sa table|table illisible/.test(p))) verified.push('une tuile, sa table : champ « Table » (trois tables, aucune interne), colonnes de Clients seules, badge, graphique des villes, filtres qui ne sortent pas de leur table (pastille, croix), modification, retour à la table de travail ; table illisible = badge ⚠, zéro ligne, aucun nouvel essai, formulaire refusé');
    }

    // 12. Lot 2 (suite) : le menu Filtre choisit la TABLE du filtre par des boutons (jamais une liste déroulante). Un VRAI clic sur « Clients » donne ses colonnes et
    // elles seules, le filtre posé porte `table`, ne touche que les visualisations de Clients, et le menu repart de la table de travail à chaque ouverture.
    {
    const restartMenu = async () => {
      await page.reload({ waitUntil: 'load' });
      frame = page.mainFrame();
      if (framed) { await page.waitForSelector('#app'); frame = await (await page.$('#app')).contentFrame(); }
      await frame.waitForFunction(
        () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0 && GristBI.mainParts && GristBI.mainParts.S.linkSchema instanceof Map,
        null, { timeout: 25000 }
      );
      await frame.evaluate(() => { if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click(); });
    };
    const closeNotice = async () => {
      await frame.waitForSelector('#pp-dialog-modal', { state: 'visible', timeout: 8000 }).catch(() => {});
      await frame.click('#pp-dialog-modal button:has-text("Fermer")', { timeout: 3000 }).catch(() => frame.press('body', 'Escape').catch(() => {}));
      await frame.waitForFunction(() => { const d = document.getElementById('pp-dialog-modal'); return !d || d.hidden; }, null, { timeout: 4000 }).catch(() => {});
    };
    const menuState = () => frame.evaluate(() => ({
      field: !document.getElementById('filter-table-field').hidden,
      pills: Array.from(document.querySelectorAll('#filter-tables .filter-table-btn')).map((b) => b.dataset.table + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')),
      note: document.getElementById('filter-table-note').hidden ? '' : document.getElementById('filter-table-note').textContent,
      groups: Array.from(document.querySelectorAll('#filter-column-list .filter-column-group')).map((li) => li.textContent),
      columns: Array.from(document.querySelectorAll('#filter-column-list .filter-column-item')).map((b) => b.dataset.column),
      pending: document.querySelectorAll('#filter-column-list [data-pending]').length,
      empty: !document.getElementById('filter-column-empty').hidden,
      combobox: document.querySelectorAll('#filter-popover .combobox-list').length,
      form: !document.getElementById('advanced-filter-form').hidden,
      name: document.getElementById('filter-column-name').textContent,
      filterTable: GristBI.mainParts.S.filterTable
    }));
    // Ouvre le menu Filtre s'il est fermé (un second clic le refermerait).
    const openFilterMenu = async () => {
      if (await frame.evaluate(() => document.getElementById('filter-popover').hidden)) await frame.click('#filter-toggle');
      await frame.waitForFunction(() => !document.getElementById('filter-popover').hidden, null, { timeout: 5000 }).catch(() => {});
    };
    // Ferme puis rouvre le menu : c'est l'ouverture qui le remet sur son premier écran.
    const reopenFilterMenu = async () => {
      if (!(await frame.evaluate(() => document.getElementById('filter-popover').hidden))) await frame.click('#filter-toggle');
      await frame.waitForFunction(() => document.getElementById('filter-popover').hidden, null, { timeout: 5000 }).catch(() => {});
      await openFilterMenu();
    };

    await restartMenu();
    await frame.evaluate(() => {
      GristBI.store.addTile({ id: 'v1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
      GristBI.store.addTile({ id: 'c2', type: 'bar', dimension: 'Ville', measure: 'Nom', aggFn: 'count', table: 'Clients' });
      GristBI.store.addTile({ id: 'c3', type: 'bar', dimension: 'Segment', measure: 'Nom', aggFn: 'count', table: 'Clients' });
    });
    await frame.waitForFunction(() => Array.isArray(GristBI.store.getState().tableRows.Clients), null, { timeout: 8000 }).catch(() => {});
    await openFilterMenu();
    await frame.waitForFunction(() => !document.getElementById('filter-table-field').hidden && document.querySelectorAll('#filter-tables .filter-table-btn').length === 3, null, { timeout: 8000 }).catch(() => {});
    const m0 = await menuState();
    if (!m0.field || m0.pills.join() !== 'Ventes*,Clients,Personnes') problems.push('menu Filtre, tables : boutons « ' + m0.pills.join() + ' » (attendu Ventes*,Clients,Personnes, l\'ordre du document : trois tables, la table de travail choisie)');
    if (m0.note) problems.push('menu Filtre, tables : une phrase de table s\'affiche pour la table de travail : « ' + m0.note + ' »');
    if (m0.combobox) problems.push('menu Filtre, tables : une liste déroulante (' + m0.combobox + ') dans le menu Filtre');
    if (m0.groups.join('|') !== 'Ventes|Clients|Personnes') problems.push('menu Filtre, tables : la table de travail garde ses intitulés de tables liées (« ' + m0.groups.join(' | ') + ' »)');
    // Un VRAI clic sur le bouton « Clients ».
    await frame.click('#filter-tables [data-table="Clients"]');
    await frame.waitForFunction(() => GristBI.mainParts.S.filterTable === 'Clients' && document.querySelectorAll('#filter-column-list .filter-column-item').length === 3, null, { timeout: 8000 }).catch(() => {});
    const m1 = await menuState();
    if (m1.pills.join() !== 'Ventes,Clients*,Personnes') problems.push('menu Filtre, tables : après le clic les boutons sont « ' + m1.pills.join() + ' »');
    if (m1.columns.join() !== 'Nom,Ville,Segment') problems.push('menu Filtre, tables : colonnes de Clients « ' + m1.columns.join() + ' » au lieu de Nom,Ville,Segment');
    if (m1.pending || m1.groups.length) problems.push('menu Filtre, tables : une autre table n\'a pas de jointure ni d\'intitulé (' + m1.pending + ' à relier, ' + m1.groups.length + ' intitulé(s))');
    if (!/Clients/.test(m1.note)) problems.push('menu Filtre, tables : la phrase de la table ne la nomme pas : « ' + m1.note + ' »');
    // Un clic sur la colonne : l'étape 2 dit « Clients › Ville » et propose les villes de Clients (pas celles d'un autre jeu de lignes).
    await frame.click('#filter-column-list [data-column="Ville"]');
    const opened = await frame.waitForFunction(() => !document.getElementById('advanced-filter-form').hidden, null, { timeout: 5000 }).then(() => true, () => false);
    if (!opened) problems.push('menu Filtre, tables : le clic sur « Ville » n\'a pas ouvert le réglage du filtre');
    const step2 = await frame.evaluate(() => ({
      name: document.getElementById('filter-column-name').textContent,
      values: Array.from(document.querySelectorAll('#filter-value-list .filter-value-item')).map((b) => b.textContent).sort()
    }));
    if (step2.name !== 'Clients › Ville') problems.push('menu Filtre, tables : l\'étape 2 s\'intitule « ' + step2.name + ' » (attendu « Clients › Ville »)');
    if (step2.values.join() !== 'Lille,Lyon,Nantes') problems.push('menu Filtre, tables : valeurs proposées « ' + step2.values.join() + ' » au lieu des villes de Clients');
    await frame.click('#filter-value-list [data-value="Lyon"]');
    await frame.waitForFunction(() => GristBI.store.getState().advancedFilters.length === 1, null, { timeout: 5000 }).catch(() => {});
    await frame.waitForTimeout(300);
    const posed = await frame.evaluate(async () => {
      await GristBI.charts.whenSettled();
      const st = GristBI.store.getState();
      const rowsOf = (id) => GristBI.data.rowsForTile(st.tiles.find((tl) => tl.id === id), st).length;
      return {
        filters: st.advancedFilters.map((f) => f.column + ':' + f.type + ':' + (f.query || '') + (f.table ? '@' + f.table : '')),
        ventes: rowsOf('v1'), villes: rowsOf('c2'), segments: rowsOf('c3'),
        chip: document.getElementById('advanced-filter-badges').textContent.replace(/\s+/g, ' ').trim()
      };
    });
    if (posed.filters.join() !== 'Ville:contains:Lyon@Clients') problems.push('menu Filtre, tables : le filtre posé est « ' + posed.filters.join() + ' » (attendu un filtre « contient Lyon » de la table Clients)');
    if (posed.ventes !== 36) problems.push('menu Filtre, tables : un filtre de Clients touche les ventes (' + posed.ventes + ' lignes au lieu de 36)');
    if (posed.villes !== 2 || posed.segments !== 2) problems.push('menu Filtre, tables : le filtre ne retient pas 2 clients pour les deux visualisations de Clients (' + posed.villes + ' et ' + posed.segments + ')');
    if (!/Clients ›/.test(posed.chip)) problems.push('menu Filtre, tables : la pastille ne nomme pas la table : « ' + posed.chip + ' »');
    // Rouvert, le menu repart de la table de travail.
    await reopenFilterMenu();
    await frame.waitForFunction(() => GristBI.mainParts.S.filterTable === '' && document.querySelectorAll('#filter-tables .filter-table-btn').length === 3, null, { timeout: 5000 }).catch(() => {});
    const m3 = await menuState();
    if (m3.filterTable !== '' || m3.pills.join() !== 'Ventes*,Clients,Personnes' || m3.note || m3.form) problems.push('menu Filtre, tables : le menu rouvert garde le choix précédent : ' + JSON.stringify({ filterTable: m3.filterTable, pills: m3.pills, note: m3.note, form: m3.form }));
    // La croix de la pastille retire le filtre de Clients.
    await frame.evaluate(() => GristBI.store.clearAdvancedFilter('Ville', 'Clients'));
    if (await frame.evaluate(() => GristBI.store.getState().advancedFilters.length)) problems.push('menu Filtre, tables : le filtre de Clients n\'a pas été retiré par `clearAdvancedFilter(colonne, table)`');

    // 12b. Une table illisible : le bouton reste, la phrase le dit, aucune colonne n'est proposée, la table de travail revient à la réouverture.
    tolerated.push(/illisible pour une tuile/, /Table illisible|n'est pas lue/, /illisible \(menu Filtre\)/);
    await restartMenu();
    // Même raison qu'en 11b : l'accueil a déjà lu `Personnes` en silence, on vide cette mémoire une fois la table rendue illisible.
    await frame.evaluate(async () => { window.__gristStubFailTables = ['Personnes']; await GristBI.mainParts.reloadWorkingTable(); });
    await openFilterMenu();
    await frame.waitForFunction(() => document.querySelectorAll('#filter-tables .filter-table-btn').length === 3, null, { timeout: 8000 }).catch(() => {});
    await frame.click('#filter-tables [data-table="Personnes"]');
    await frame.waitForFunction(() => GristBI.store.getState().tableRows.Personnes === null, null, { timeout: 8000 }).catch(() => {});
    await closeNotice();
    const m4 = await menuState();
    if (m4.pills.join() !== 'Ventes,Clients,Personnes*') problems.push('menu Filtre, table illisible : boutons « ' + m4.pills.join() + ' »');
    if (m4.columns.length || m4.empty) problems.push('menu Filtre, table illisible : ' + m4.columns.length + ' colonne(s) proposée(s) et « aucune colonne ne correspond » ' + (m4.empty ? 'affiché' : 'masqué') + ' (attendu 0 colonne, la phrase de la table à la place)');
    if (!/Personnes/.test(m4.note)) problems.push('menu Filtre, table illisible : la phrase ne nomme pas la table : « ' + m4.note + ' »');
    await frame.evaluate(() => { window.__gristStubFailTables = []; });
    await reopenFilterMenu();
    await frame.waitForFunction(() => GristBI.mainParts.S.filterTable === '' && document.querySelectorAll('#filter-column-list .filter-column-item').length > 3, null, { timeout: 5000 }).catch(() => {});
    const m5 = await menuState();
    if (m5.filterTable !== '' || m5.pills.join() !== 'Ventes*,Clients,Personnes' || m5.columns.indexOf('Region') === -1 || m5.note) problems.push('menu Filtre, table illisible : la réouverture ne revient pas à la table de travail : ' + JSON.stringify({ filterTable: m5.filterTable, pills: m5.pills, note: m5.note, columns: m5.columns.length }));
    if (!problems.some((p) => /menu Filtre, (tables|table illisible)/.test(p))) verified.push('menu Filtre, table du filtre : boutons (jamais une liste déroulante), un clic donne les colonnes de Clients seules, « Clients › Ville », valeurs des villes de Clients, filtre « contient Lyon » de la table Clients qui ne touche que ses visualisations (ventes inchangées), pastille, réouverture sur la table de travail ; table illisible = phrase, aucune colonne, retour à la table de travail');
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

/**
 * Un document à trois tables (`Alpha`, `Beta`, `Gamma`, dans cet ordre) dont `reports` = [[table, date de modification]] ont un rapport enregistré dans
 * BI_Dashboard_Config (noms anglais, rien à renommer) : chaque rapport porte une tuile `t_<table>`, ce qui dit lequel s'est ouvert.
 */
function startFixture(reports) {
  const meta = { id: [1, 2, 3, 4], tableId: ['Alpha', 'Beta', 'Gamma', 'BI_Dashboard_Config'] };
  const columns = { id: [], parentId: [], colId: [], type: [], widgetOptions: [] };
  const add = (parent, ids) => ids.forEach((colId) => { columns.id.push(columns.id.length + 1); columns.parentId.push(parent); columns.colId.push(colId); columns.type.push('Text'); columns.widgetOptions.push(''); });
  [1, 2, 3].forEach((parent) => add(parent, ['Region', 'Produit', 'Mois', 'Quantite', 'Montant']));
  add(4, ['TableId', 'ConfigJSON', 'Name', 'ReportType', 'ModifiedAt', 'ModifiedBy']);
  const config = { id: [], TableId: [], ConfigJSON: [], Name: [], ReportType: [], ModifiedAt: [], ModifiedBy: [] };
  reports.forEach(([table, at], i) => {
    const report = { pages: [{ id: 'p_' + table, name: 'Page ' + table, tiles: [{ id: 't_' + table, type: 'bar', title: 'Montant par région ' + table, dimension: 'Region', measure: 'Montant', aggFn: 'sum' }] }], currentPageId: 'p_' + table };
    config.id.push(i + 1); config.TableId.push(table); config.ConfigJSON.push(JSON.stringify(report)); config.Name.push('Rapport ' + table);
    config.ReportType.push('rapport'); config.ModifiedAt.push(at); config.ModifiedBy.push('');
  });
  return { Alpha: salesTable(), Beta: salesTable(), Gamma: salesTable(), BI_Dashboard_Config: config, _grist_Tables: meta, _grist_Tables_column: columns };
}

/**
 * La table de départ (26/11/2026, retour d'un utilisateur : « je suis obligé de changer de table pour accéder aux tableaux de bord
 * pertinents ») dans la vraie page : le widget s'ouvre sur la dernière table ouverte, sinon sur celle du rapport enregistré le plus récemment,
 * sinon sur la 1re. Le document : Alpha (aucun rapport), Beta (rapport de 2023), Gamma (rapport de 2024, le plus récent).
 *  - `direct` : (1) rien en mémoire -> Gamma (rapport le plus récent, sa tuile est là) ; (2) choisir Alpha dans le sélecteur de la barre (vrais gestes),
 *    la table est mémorisée, une page rechargée s'ouvre sur Alpha ; (3) une mémoire d'une table inconnue du document est ignorée -> Gamma ;
 *  - `framed` : dans un `<iframe sandbox="allow-scripts allow-downloads">` (cadre de Grist et de GFS) où `localStorage` LÈVE : aucune erreur, le rapport
 *    le plus récent prend le relais, avant comme après un changement de table ;
 *  - `empty` : aucun rapport enregistré, aucune mémoire -> la 1re table, comme avant ce réglage.
 */
async function startScenario(browser, origin, { mode }) {
  const problems = [];
  const verified = [];
  const reports = mode === 'empty' ? [] : [['Beta', 1700000000], ['Gamma', 1750000000]];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((fixture) => { window.__gristStubPreseed = fixture; }, startFixture(reports));
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    else { problems.push('requête vers un autre site : ' + u.origin + u.pathname); route.abort(); }
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console : ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') return;
    const text = (r.failure() && r.failure().errorText) || 'cause inconnue';
    if (text !== 'net::ERR_ABORTED') problems.push('requête échouée : ' + r.url().replace(origin, '') + ' (' + text + ')');
  });
  page.on('response', (r) => { if (r.status() >= 400) problems.push('réponse ' + r.status() + ' : ' + r.url().replace(origin, '')); });
  const frameOf = async () => (mode === 'framed' ? (await (await page.waitForSelector('#app')).contentFrame()) : page.mainFrame());
  // La table ouverte : le sélecteur de la barre, une fois le rapport chargé et les lignes là ; les tuiles dites par leur id.
  const opened = async (frame) => {
    await frame.waitForFunction(() => typeof window.GristBI === 'object' && GristBI.store && GristBI.store.getState().rows.length > 0
      && document.getElementById('table-select').value !== '', null, { timeout: 30000 });
    await frame.waitForTimeout(400); // le rapport de la table est posé juste avant les lignes : on laisse le rendu se stabiliser
    return frame.evaluate(() => ({ table: document.getElementById('table-select').value, tiles: GristBI.store.getState().tiles.map((t) => t.id) }));
  };
  const expectOpened = (got, table, label) => {
    if (got.table !== table) problems.push(label + ' : table ouverte « ' + got.table + ' », attendu « ' + table + ' »');
    const wantTiles = reports.some(([t]) => t === table) ? ['t_' + table] : [];
    if (JSON.stringify(got.tiles) !== JSON.stringify(wantTiles)) problems.push(label + ' : tuiles ' + JSON.stringify(got.tiles) + ', attendu ' + JSON.stringify(wantTiles) + ' (le rapport de cette table)');
  };
  // Choisir une autre table comme une personne : menu Données, champ « Table de travail », frappe, Entrée.
  const pickTable = async (frame, name) => {
    await frame.click('#data-pill');
    await frame.click('#table-select');
    await frame.fill('#table-select', name);
    await frame.press('#table-select', 'Enter');
    await frame.waitForFunction((n) => document.getElementById('table-select').value === n && GristBI.store.getState().rows.length > 0, name, { timeout: 15000 });
    await frame.waitForTimeout(600);
  };
  const memory = (frame) => frame.evaluate(() => { try { return localStorage.getItem('gristbi_last_table'); } catch (e) { return 'LÈVE'; } });
  try {
    await page.goto(origin + (mode === 'framed' ? '/__frame.html' : '/index.html'), { waitUntil: 'load' });
    let frame = await frameOf();
    if (mode === 'empty') {
      expectOpened(await opened(frame), 'Alpha', 'sans rapport ni mémoire');
      verified.push('aucun rapport, aucune mémoire : la 1re table (Alpha), comme avant');
    } else if (mode === 'direct') {
      expectOpened(await opened(frame), 'Gamma', 'rien en mémoire');
      verified.push('rien en mémoire : Gamma, la table du rapport enregistré le plus récemment (sa tuile est là)');
      await pickTable(frame, 'Alpha');
      expectOpened(await opened(frame), 'Alpha', 'après le choix de la table');
      const kept = await memory(frame);
      if (kept !== 'Alpha') problems.push('la table choisie n\'est pas mémorisée : gristbi_last_table = ' + JSON.stringify(kept));
      await page.reload({ waitUntil: 'load' });
      frame = await frameOf();
      expectOpened(await opened(frame), 'Alpha', 'page rechargée après le choix d\'Alpha');
      verified.push('Alpha choisie dans le sélecteur, mémorisée ; la page rechargée s\'ouvre sur Alpha (pas sur Gamma, malgré son rapport plus récent)');
      await frame.evaluate(() => localStorage.setItem('gristbi_last_table', 'Zèbre'));
      await page.reload({ waitUntil: 'load' });
      frame = await frameOf();
      expectOpened(await opened(frame), 'Gamma', 'mémoire d\'une table inconnue du document');
      verified.push('une mémoire d\'une table inconnue de ce document est ignorée (retour au rapport le plus récent)');
    } else {
      const throws = await frame.evaluate(() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } });
      if (!throws) problems.push('le cadre isolé laisse lire localStorage : l\'essai ne prouve plus rien sur le repli');
      expectOpened(await opened(frame), 'Gamma', 'cadre isolé, rien en mémoire');
      await pickTable(frame, 'Alpha');
      expectOpened(await opened(frame), 'Alpha', 'cadre isolé, après le choix de la table');
      await page.reload({ waitUntil: 'load' });
      frame = await frameOf();
      expectOpened(await opened(frame), 'Gamma', 'cadre isolé, page rechargée (aucune mémoire possible)');
      verified.push('localStorage lève dans le cadre : aucune erreur, Gamma (rapport le plus récent) avant comme après le choix d\'Alpha');
    }
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, verified };
}

/** Le document du lot 3 (suggestions sur tout le document) : `Ventes` (36 lignes) et `Activite` (60 lignes : équipe, statut, durée, coût), avec les types Grist de leurs colonnes. */
function suggestFixture() {
  const activite = { id: [], Equipe: [], Statut: [], Duree_h: [], Cout: [] };
  const equipes = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  const statuts = ['Terminé', 'En cours', 'À faire'];
  for (let i = 1; i <= 60; i++) {
    activite.id.push(i);
    activite.Equipe.push(equipes[i % 4]);
    activite.Statut.push(statuts[(i * 7) % 3]);
    activite.Duree_h.push(1 + ((i * 13) % 17) + (i % 4) * 3);
    activite.Cout.push(100 + ((i * 37) % 400) + (i % 4) * 150);
  }
  const meta = { id: [1, 2], tableId: ['Ventes', 'Activite'] };
  const columns = { id: [], parentId: [], colId: [], type: [], widgetOptions: [] };
  const add = (parent, list) => list.forEach(([colId, type]) => { columns.id.push(columns.id.length + 1); columns.parentId.push(parent); columns.colId.push(colId); columns.type.push(type); columns.widgetOptions.push(''); });
  add(1, [['Region', 'Text'], ['Produit', 'Text'], ['Mois', 'Text'], ['Quantite', 'Numeric'], ['Montant', 'Numeric']]);
  add(2, [['Equipe', 'Text'], ['Statut', 'Text'], ['Duree_h', 'Numeric'], ['Cout', 'Numeric']]);
  return { Ventes: salesTable(), Activite: activite, _grist_Tables: meta, _grist_Tables_column: columns };
}

/**
 * Les suggestions sur TOUT le document (lot 3A, 26/11/2026) dans la vraie page, sous sa politique, avec de VRAIS gestes. Le document : `Ventes` (table de
 * travail) et `Activite`. Les questions de `Ventes` sont d'abord épuisées par des tuiles (la boucle d'extinction de `js/advice-complete.js`), de sorte que
 * toute proposition affichée vienne d'une AUTRE table :
 *  - « Pour compléter » propose des tuiles d'`Activite`, chacune dit sa table (carte et bouton), aperçu dessiné avec les lignes d'`Activite` ;
 *  - cette lecture est SILENCIEUSE : `Activite` n'entre pas dans le store (aucun redessin de toutes les tuiles) tant que rien ne la demande à l'écran ;
 *  - aucun badge « Recommandé » (il dit « ce type convient à CETTE table ») ;
 *  - un VRAI clic sur « Ajouter » pose UNE tuile qui porte `table: 'Activite'`, lit les lignes déjà lues (UNE seule lecture de la table en tout), son badge
 *    de table s'affiche, la liste se recalcule, le focus reste dans le panneau ;
 *  - une table illisible n'est pas proposée et ne bloque rien (avertissement en console, jamais d'erreur).
 */
async function suggestScenario(browser, origin, { framed }) {
  const problems = [];
  const verified = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((fixture) => { window.__gristStubPreseed = fixture; }, suggestFixture());
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    else { problems.push('requête vers un autre site : ' + u.origin + u.pathname); route.abort(); }
  });
  const page = await context.newPage();
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console : ' + m.text().slice(0, 240));
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') return;
    const text = (r.failure() && r.failure().errorText) || 'cause inconnue';
    if (text !== 'net::ERR_ABORTED') problems.push('requête échouée : ' + r.url().replace(origin, '') + ' (' + text + ')');
  });
  page.on('response', (r) => { if (r.status() >= 400) problems.push('réponse ' + r.status() + ' : ' + r.url().replace(origin, '')); });
  let frame;
  const start = async (failTables) => {
    if (failTables) await context.addInitScript((names) => { window.__gristStubFailTables = names; }, failTables);
    await page.goto(origin + (framed ? '/__frame.html' : '/index.html'), { waitUntil: 'load' });
    frame = page.mainFrame();
    if (framed) { await page.waitForSelector('#app'); frame = await (await page.$('#app')).contentFrame(); }
    await frame.waitForFunction(
      () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0 && GristBI.mainParts && GristBI.mainParts.S.linkSchema instanceof Map,
      null, { timeout: 25000 }
    );
    await frame.evaluate(() => { if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click(); });
  };
  const cardsOf = () => frame.evaluate(() => Array.from(document.querySelectorAll('#tile-complete-list .complete-card')).map((li) => ({
    table: (li.querySelector('.complete-card-table') || {}).textContent || '',
    title: li.querySelector('.complete-card-title').textContent,
    aria: li.querySelector('button').getAttribute('aria-label') || '',
    preview: !!li.querySelector('.complete-preview svg') && li.querySelector('.complete-preview svg').children.length > 0
  })));
  try {
    await start();
    // Les questions de `Ventes` épuisées : la même boucle que l'essai Node d'extinction, avec la vraie page.
    const saturated = await frame.evaluate(() => {
      const t = GristBI.i18n.t;
      const lang = GristBI.i18n.getLang();
      let guard = 0;
      for (;;) {
        const st = GristBI.store.getState();
        const res = GristBI.adviceComplete.complete(st.rows, st.tiles, { t, lang, limit: 3 });
        if (!res.items.length || guard >= 40) return { left: res.items.length, tiles: st.tiles.length };
        guard += 1;
        GristBI.store.addTile(Object.assign({ id: 'sat' + guard }, res.items[0].tileData));
      }
    });
    if (saturated.left !== 0 || saturated.tiles < 3) problems.push('préparation : les questions de Ventes ne sont pas épuisées (' + JSON.stringify(saturated) + ')');
    await frame.waitForTimeout(500);
    // Les lectures sont comptées par le faux Grist (`window.__gristStubFetches`) depuis le chargement : l'accueil (rapport vide au départ) lit déjà les autres tables en silence.
    await frame.evaluate(() => GristBI.openTilePanel({ step: 'choose' }));
    const listed = await frame.waitForSelector('#tile-complete-list button[data-complete]', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (!listed) problems.push('autres tables : aucune carte après l\'ouverture du panneau alors que `Activite` a des questions à poser');
    else {
      const cards = await cardsOf();
      const side = await frame.evaluate(() => ({
        badges: document.querySelectorAll('.type-card-badge').length,
        read: Array.isArray(GristBI.store.getState().tableRows.Activite),
        loads: (window.__gristStubFetches || {}).Activite || 0,
        tiles: GristBI.store.getState().tiles.length
      }));
      if (cards.length < 1 || cards.length > 3) problems.push('autres tables : ' + cards.length + ' cartes (1 à 3 attendues)');
      cards.forEach((c) => {
        if (!/Activite/.test(c.table)) problems.push('autres tables : une carte ne dit pas sa table : ' + JSON.stringify(c));
        if (!/Activite/.test(c.aria)) problems.push('autres tables : le bouton « Ajouter » ne dit pas la table : « ' + c.aria + ' »');
        if (!c.preview) problems.push('autres tables : l\'aperçu d\'une carte est vide : « ' + c.title + ' »');
      });
      if (side.badges) problems.push('autres tables : ' + side.badges + ' badge(s) « Recommandé » alors que toutes les propositions viennent d\'une autre table');
      if (side.read) problems.push('autres tables : la lecture silencieuse d\'`Activite` est entrée dans le store (elle redessinerait toutes les tuiles)');
      if (side.loads !== 1) problems.push('autres tables : `Activite` lue ' + side.loads + ' fois pour les propositions (une seule attendue)');
      const firstTitle = cards.length ? cards[0].title : '';
      // Un VRAI clic sur « Ajouter ».
      await frame.click('#tile-complete-list button[data-complete="0"]');
      await frame.waitForFunction((n) => GristBI.store.getState().tiles.length === n + 1, side.tiles, { timeout: 5000 }).catch(() => {});
      await frame.waitForFunction(() => Array.isArray(GristBI.store.getState().tableRows.Activite), null, { timeout: 8000 }).catch(() => {});
      await frame.waitForTimeout(700);
      const after = await frame.evaluate(() => {
        const st = GristBI.store.getState();
        const added = st.tiles.filter((tl) => tl.table === 'Activite');
        const active = document.activeElement;
        const el = added[0] ? document.querySelector('.tile[data-tile-id="' + added[0].id + '"]') : null;
        const badge = el && el.querySelector('.tile-table');
        return {
          tiles: st.tiles.length, added: added.length, read: Array.isArray(st.tableRows.Activite), loads: (window.__gristStubFetches || {}).Activite || 0,
          badge: badge && !badge.hidden ? badge.textContent : '', rows: added[0] ? GristBI.data.rowsForTile(added[0], st).length : -1,
          live: document.getElementById('tile-complete-live').textContent,
          focusInPanel: !!(active && active.closest && active.closest('#tile-panel')), focusTag: active ? active.tagName : ''
        };
      });
      if (after.tiles !== side.tiles + 1 || after.added !== 1) problems.push('autres tables : « Ajouter » ' + side.tiles + ' -> ' + after.tiles + ' tuiles, ' + after.added + ' lisant Activite (une seule attendue)');
      if (!after.read || after.rows !== 60) problems.push('autres tables : la tuile posée ne lit pas les 60 lignes d\'Activite (lues : ' + after.read + ', lignes : ' + after.rows + ')');
      if (after.loads !== 1) problems.push('autres tables : `Activite` lue ' + after.loads + ' fois en tout (la tuile devait réutiliser les lignes déjà lues)');
      if (!/Activite/.test(after.badge)) problems.push('autres tables : le badge de table de la tuile posée est « ' + after.badge + ' »');
      if (!after.live) problems.push('autres tables : aucune annonce écrite');
      if (!after.focusInPanel || after.focusTag === 'BODY') problems.push('autres tables : le focus a quitté le panneau (' + after.focusTag + ')');
      const again = await cardsOf();
      if (again.some((c) => c.title === firstTitle && /Activite/.test(c.table))) problems.push('autres tables : la tuile posée est reproposée (« ' + firstTitle + ' »)');
      await frame.evaluate(() => GristBI.closeTilePanel(false));
      const closed = await frame.evaluate(() => ({ hidden: document.getElementById('tile-complete').hidden, cards: document.querySelectorAll('#tile-complete-list .complete-card').length }));
      if (!closed.hidden || closed.cards) problems.push('panneau fermé : la liste reste (' + JSON.stringify(closed) + ')');
      if (!problems.length) verified.push('« Pour compléter » sur tout le document : ' + cards.length + ' cartes d\'Activite (table dite, aperçu, aucun badge), lecture silencieuse (hors du store, 1 lecture), un clic réel = une tuile qui lit Activite, badge de table, focus, fermeture');
    }

    // Une table illisible : elle n'est pas proposée, le panneau marche comme avant, un avertissement (jamais une erreur) le dit.
    await start(['Activite']);
    await frame.evaluate(() => {
      GristBI.store.addTile({ id: 'v1', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum' });
      GristBI.openTilePanel({ step: 'choose' });
    });
    const listed2 = await frame.waitForSelector('#tile-complete-list button[data-complete]', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (!listed2) problems.push('table illisible : plus aucune carte (les propositions de Ventes devaient rester)');
    else {
      const cards2 = await cardsOf();
      if (cards2.some((c) => c.table)) problems.push('table illisible : une carte vient d\'une autre table : ' + JSON.stringify(cards2.filter((c) => c.table)));
      await frame.waitForTimeout(300);
      if (!warnings.some((w) => /illisible pour les suggestions/.test(w))) problems.push('table illisible : aucun avertissement « illisible pour les suggestions » en console');
      if (!problems.some((p) => /table illisible/.test(p))) verified.push('table illisible : pas proposée, les propositions de Ventes restent (' + cards2.length + '), un avertissement en console');
    }
  } catch (e) {
    problems.push('essai interrompu : ' + String((e && e.message) || e).slice(0, 240));
  } finally {
    await context.close();
  }
  return { problems, verified };
}

/**
 * L'écran d'accueil sur TOUT le document (lot 3B, 26/11/2026), dans la vraie page, sous sa politique, avec de VRAIS gestes. Le document est celui du lot 3A
 * (`Ventes`, table de travail, et `Activite`) ; le rapport est VIDE, donc l'accueil se montre :
 *  - les trois premières cartes sont celles de la table de travail, inchangées (ce que `advice.suggestTiles` rend), sans nom de table ;
 *  - les suggestions d'`Activite` s'ajoutent À LA SUITE, repliées avec les autres suggestions (invisibles tant qu'on ne déplie pas), chacune dit sa table
 *    (carte et bouton) et dessine son aperçu avec les lignes d'`Activite` ;
 *  - la lecture est SILENCIEUSE (`Activite` n'entre pas dans le store) et unique ;
 *  - « Voir d'autres suggestions » les montre ; un VRAI clic sur « Ajouter » d'une carte d'`Activite` pose UNE tuile qui lit `Activite` (60 lignes, badge de
 *    table), l'accueil se masque, la table n'est toujours lue qu'une fois ;
 *  - une table illisible n'est pas proposée et ne retire rien (avertissement en console, jamais une erreur).
 */
async function welcomeScenario(browser, origin, { framed }) {
  const problems = [];
  const verified = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((fixture) => { window.__gristStubPreseed = fixture; }, suggestFixture());
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'docs.getgrist.com' && u.pathname === '/grist-plugin-api.js') route.fulfill({ status: 200, contentType: 'text/javascript', body: gristApiBody() });
    else { problems.push('requête vers un autre site : ' + u.origin + u.pathname); route.abort(); }
  });
  const page = await context.newPage();
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console : ' + m.text().slice(0, 240));
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => problems.push('exception de page : ' + String(e.message || e).slice(0, 240)));
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') return;
    const text = (r.failure() && r.failure().errorText) || 'cause inconnue';
    if (text !== 'net::ERR_ABORTED') problems.push('requête échouée : ' + r.url().replace(origin, '') + ' (' + text + ')');
  });
  page.on('response', (r) => { if (r.status() >= 400) problems.push('réponse ' + r.status() + ' : ' + r.url().replace(origin, '')); });
  let frame;
  const start = async (failTables) => {
    if (failTables) await context.addInitScript((names) => { window.__gristStubFailTables = names; }, failTables);
    await page.goto(origin + (framed ? '/__frame.html' : '/index.html'), { waitUntil: 'load' });
    frame = page.mainFrame();
    if (framed) { await page.waitForSelector('#app'); frame = await (await page.$('#app')).contentFrame(); }
    await frame.waitForFunction(
      () => typeof window.grist === 'object' && window.GristBI && GristBI.store && GristBI.store.getState().rows.length > 0 && GristBI.mainParts && GristBI.mainParts.S.dashboardReady,
      null, { timeout: 25000 }
    );
    await frame.evaluate(() => { if (document.body.dataset.mode !== 'edit') document.getElementById('mode-toggle').click(); });
  };
  const cardsOf = () => frame.evaluate(() => Array.from(document.querySelectorAll('#welcome-cards .welcome-card')).map((li, i) => ({
    i,
    extra: li.classList.contains('welcome-card-extra'),
    shown: li.getClientRects().length > 0,
    table: (li.querySelector('.welcome-card-table') || {}).textContent || '',
    title: li.querySelector('.welcome-card-title').textContent,
    aria: li.querySelector('button').getAttribute('aria-label') || '',
    preview: !!li.querySelector('.welcome-preview svg') && li.querySelector('.welcome-preview svg').children.length > 0
  })));
  try {
    await start();
    const arrived = await frame.waitForSelector('#welcome-cards .welcome-card-table', { state: 'attached', timeout: 20000 }).then(() => true, () => false);
    if (!arrived) problems.push('accueil : aucune carte d\'une autre table après le chargement (Activite a des suggestions)');
    else {
      const cards = await cardsOf();
      const expected = await frame.evaluate(() => {
        const st = GristBI.store.getState();
        return GristBI.advice.suggestTiles(st.rows, undefined, { t: GristBI.i18n.t, lang: GristBI.i18n.getLang(), limit: 9 })
          .map((s) => GristBI.i18n.t(s.titleKey, s.titleVars));
      });
      const working = cards.filter((c) => !c.table);
      const others = cards.filter((c) => c.table);
      if (working.length !== expected.length || working.some((c, i) => c.title !== expected[i])) problems.push('accueil : les cartes de la table de travail ont changé : ' + JSON.stringify(working.map((c) => c.title)) + ' au lieu de ' + JSON.stringify(expected));
      if (cards.slice(0, working.length).some((c) => c.table)) problems.push('accueil : une carte d\'une autre table passe devant celles de la table de travail');
      if (working.slice(0, 3).some((c) => c.extra || !c.shown)) problems.push('accueil : les trois premières cartes ne sont pas visibles d\'emblée');
      if (!others.length || others.length > 4) problems.push('accueil : ' + others.length + ' cartes d\'une autre table (1 à 4 attendues)');
      others.forEach((c) => {
        if (!/Activite/.test(c.table)) problems.push('accueil : une carte ne dit pas sa table : ' + JSON.stringify(c));
        if (!/Activite/.test(c.aria)) problems.push('accueil : le bouton « Ajouter » ne dit pas la table : « ' + c.aria + ' »');
        if (!c.preview) problems.push('accueil : l\'aperçu d\'une carte d\'Activite est vide : « ' + c.title + ' »');
        if (!c.extra || c.shown) problems.push('accueil : une carte d\'une autre table est visible avant le dépli (' + JSON.stringify({ extra: c.extra, shown: c.shown }) + ')');
      });
      const side = await frame.evaluate(() => ({
        read: Array.isArray(GristBI.store.getState().tableRows.Activite),
        loads: (window.__gristStubFetches || {}).Activite || 0,
        tiles: GristBI.store.getState().tiles.length,
        more: !document.getElementById('welcome-more').hidden
      }));
      if (side.read) problems.push('accueil : la lecture silencieuse d\'Activite est entrée dans le store (elle redessinerait toutes les tuiles)');
      if (side.loads !== 1) problems.push('accueil : Activite lue ' + side.loads + ' fois pour l\'accueil (une seule attendue)');
      if (side.tiles) problems.push('accueil : une tuile posée sans geste (' + side.tiles + ')');
      if (!side.more) problems.push('accueil : « Voir d\'autres suggestions » absent');
      // Déplier, puis un VRAI clic sur « Ajouter » d'une carte d'Activite.
      await frame.click('#welcome-more');
      const unfolded = await cardsOf();
      if (unfolded.filter((c) => c.table).some((c) => !c.shown)) problems.push('accueil : une carte d\'Activite reste invisible après « Voir d\'autres suggestions »');
      const target = unfolded.find((c) => c.table);
      await frame.click('#welcome-cards button[data-suggestion="' + target.i + '"]');
      await frame.waitForFunction(() => GristBI.store.getState().tiles.length === 1, null, { timeout: 5000 }).catch(() => {});
      await frame.waitForFunction(() => Array.isArray(GristBI.store.getState().tableRows.Activite), null, { timeout: 8000 }).catch(() => {});
      await frame.waitForTimeout(700);
      const after = await frame.evaluate(() => {
        const st = GristBI.store.getState();
        const el = st.tiles[0] ? document.querySelector('.tile[data-tile-id="' + st.tiles[0].id + '"]') : null;
        const badge = el && el.querySelector('.tile-table');
        return {
          tiles: st.tiles.length, table: st.tiles[0] ? st.tiles[0].table : null, read: Array.isArray(st.tableRows.Activite),
          rows: st.tiles[0] ? GristBI.data.rowsForTile(st.tiles[0], st).length : -1,
          loads: (window.__gristStubFetches || {}).Activite || 0,
          badge: badge && !badge.hidden ? badge.textContent : '', welcomeHidden: document.getElementById('welcome').hidden
        };
      });
      if (after.tiles !== 1 || after.table !== 'Activite') problems.push('accueil : un clic sur « Ajouter » a posé ' + after.tiles + ' tuile(s), table « ' + after.table + ' » (une tuile qui lit Activite attendue)');
      if (!after.read || after.rows !== 60) problems.push('accueil : la tuile posée ne lit pas les 60 lignes d\'Activite (lues : ' + after.read + ', lignes : ' + after.rows + ')');
      if (after.loads !== 1) problems.push('accueil : Activite lue ' + after.loads + ' fois en tout (la tuile devait réutiliser les lignes déjà lues)');
      if (!/Activite/.test(after.badge)) problems.push('accueil : le badge de table de la tuile posée est « ' + after.badge + ' »');
      if (!after.welcomeHidden) problems.push('accueil : toujours affiché une fois une tuile posée');
      if (!problems.length) verified.push('accueil sur tout le document : ' + working.length + ' cartes de la table de travail inchangées, ' + others.length + ' d\'Activite à la suite (repliées, table dite, aperçu), lecture silencieuse (hors du store, 1 lecture), un clic réel = une tuile qui lit Activite, accueil masqué');
    }

    // Une table illisible : elle n'est pas proposée, l'accueil marche comme avant, un avertissement (jamais une erreur) le dit.
    const warnedBefore = warnings.length;
    await start(['Activite']);
    await frame.waitForSelector('#welcome-cards .welcome-card', { state: 'attached', timeout: 15000 });
    await frame.waitForTimeout(1500);
    const cards2 = await cardsOf();
    if (!cards2.length) problems.push('table illisible : plus aucune carte (celles de la table de travail devaient rester)');
    if (cards2.some((c) => c.table)) problems.push('table illisible : une carte vient d\'une autre table : ' + JSON.stringify(cards2.filter((c) => c.table)));
    if (!warnings.slice(warnedBefore).some((w) => /illisible pour les suggestions/.test(w))) problems.push('table illisible : aucun avertissement « illisible pour les suggestions » en console');
    if (!problems.some((p) => /table illisible/.test(p))) verified.push('table illisible : pas proposée, les ' + cards2.length + ' cartes de la table de travail restent, un avertissement en console');
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
    // `TEST_BROWSER_ONLY=suggest` : seulement les scénarios des suggestions sur tout le document, pour travailler leur étape. Jamais pour fusionner.
    if (process.env.TEST_BROWSER_ONLY === 'suggest') {
      report('suggestions sur tout le document (page directe)', await suggestScenario(browser, origin, { framed: false }), { violations: 'aucune erreur de console' });
      report('suggestions sur tout le document (cadre isolé)', await suggestScenario(browser, origin, { framed: true }), { violations: 'aucune erreur de console' });
      report('accueil sur tout le document (page directe)', await welcomeScenario(browser, origin, { framed: false }), { violations: 'aucune erreur de console' });
      report('accueil sur tout le document (cadre isolé)', await welcomeScenario(browser, origin, { framed: true }), { violations: 'aucune erreur de console' });
      await browser.close(); server.close(); process.exit(failed ? 1 : 0);
    }
    report('page directe', await scenario(browser, origin, { name: 'direct', url: '/index.html', framed: false }));
    report('cadre isolé (sandbox="allow-scripts allow-downloads")', await scenario(browser, origin, { name: 'cadre', url: '/__frame.html', framed: true }));
    // `TEST_BROWSER_QUICK=1` : seulement les deux scénarios ci-dessus (page directe, cadre isolé), pour travailler une étape sans rejouer le reste. Jamais pour fusionner.
    if (process.env.TEST_BROWSER_QUICK) { await browser.close(); server.close(); process.exit(failed ? 1 : 0); }

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

    // La table de départ (26/11/2026) : dernière table ouverte, sinon rapport le plus récent, sinon la 1re.
    report('table de départ (page directe) : rapport le plus récent, choix mémorisé, mémoire inconnue ignorée', await startScenario(browser, origin, { mode: 'direct' }), { violations: 'aucune erreur de console' });
    report('table de départ (cadre isolé, localStorage interdit) : le rapport le plus récent prend le relais', await startScenario(browser, origin, { mode: 'framed' }), { violations: 'aucune erreur de console' });
    report('table de départ (aucun rapport) : la 1re table, comme avant', await startScenario(browser, origin, { mode: 'empty' }), { violations: 'aucune erreur de console' });

    // Les suggestions sur tout le document (lot 3A, 26/11/2026) : « Pour compléter » propose aussi les tuiles des autres tables.
    report('suggestions sur tout le document (page directe) : cartes d\'une autre table, lecture silencieuse, un clic réel', await suggestScenario(browser, origin, { framed: false }), { violations: 'aucune erreur de console' });
    report('suggestions sur tout le document (cadre isolé)', await suggestScenario(browser, origin, { framed: true }), { violations: 'aucune erreur de console' });

    // L'accueil sur tout le document (lot 3B, 26/11/2026) : les suggestions des autres tables s'ajoutent à la suite de celles de la table de travail.
    report('accueil sur tout le document (page directe) : cartes d\'une autre table repliées, lecture silencieuse, un clic réel', await welcomeScenario(browser, origin, { framed: false }), { violations: 'aucune erreur de console' });
    report('accueil sur tout le document (cadre isolé)', await welcomeScenario(browser, origin, { framed: true }), { violations: 'aucune erreur de console' });

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
