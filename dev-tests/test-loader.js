/*
 * Essais du chargeur unique de code (js/loader.js + js/modules.js), audit `gwaudit` axe C — règles C-EXFIL-05 (un `<script>`
 * créé à l'exécution), C-EXFIL-06 (un `import()` dont l'adresse est calculée), C-XSS-02 (`document.write`) et C-EXFIL-02 (une
 * requête vers une adresse calculée) :
 *  - la politique (`planScript`) : https seulement hors du site de la page, empreinte obligatoire pour un autre site, hôte de la
 *    liste, jamais d'identifiant dans l'adresse, empreinte mal formée refusée ;
 *  - la création de l'élément (faux document) et l'enregistrement des modules (nom inconnu refusé, module absent = échec immédiat) ;
 *  - les garde-fous des sources : UN SEUL `createElement('script')` (loader.js), UN SEUL fichier qui contient des `import()`
 *    (modules.js, chemins littéraux), plus de `document.write` ni de `window.open` à arguments dans ECharts ;
 *  - ce que la mesure dans Chromium a montré, rejouable à la main (voir dev-tests/README.md) : un `import()` relatif écrit dans un
 *    SCRIPT CLASSIQUE n'a pas d'adresse de base dans un cadre `sandbox="allow-scripts"`, d'où `js/modules.js` en module ES.
 * `node dev-tests/test-loader.js`
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const loader = require('../js/loader.js');
const BASE = 'https://widget.example/app/index.html';
const SHA384 = 'sha384-' + 'Zm9v'.repeat(16);
const SHA256 = 'sha256-' + 'Zm9v'.repeat(10) + 'Zm8=';
const SHA512 = 'sha512-' + 'Zm9v'.repeat(21) + 'Zg==';

const refusedWith = (fn, pattern, why) => assert.throws(fn, (e) => e.code === 'LOADER_REFUSED' && pattern.test(e.message), why);

// --- Politique ------------------------------------------------------------------------------------------------------------
{
  const same = loader.planScript({ src: 'js/vendor/exceljs/exceljs.min.js' }, BASE);
  assert.deepStrictEqual({ ...same }, { url: 'https://widget.example/app/js/vendor/exceljs/exceljs.min.js', integrity: '', crossOrigin: false }, 'un fichier du site de la page : aucune empreinte exigée, aucun crossorigin (comportement d\'avant)');
  const sameWithHash = loader.planScript({ src: '/lib/a.js', integrity: SHA384 }, BASE);
  assert.strictEqual(sameWithHash.crossOrigin, true, 'une empreinte demande toujours crossorigin (SRI)');

  const other = loader.planScript({ src: 'https://cdn.jsdelivr.net/npm/x@1.0.0/x.js', integrity: SHA384, hosts: ['cdn.jsdelivr.net'] }, BASE);
  assert.deepStrictEqual({ ...other }, { url: 'https://cdn.jsdelivr.net/npm/x@1.0.0/x.js', integrity: SHA384, crossOrigin: true });
  for (const good of [SHA256, SHA512, SHA384 + ' ' + SHA512]) assert.strictEqual(loader.planScript({ src: 'https://a.example/x.js', integrity: good }, BASE).integrity, good, 'sha256, sha384, sha512 et plusieurs empreintes');

  refusedWith(() => loader.planScript({ src: 'https://a.example/x.js' }, BASE), /empreinte/, 'un autre site sans empreinte');
  refusedWith(() => loader.planScript({ src: 'http://a.example/x.js', integrity: SHA384 }, BASE), /https/, 'http hors de la machine locale');
  refusedWith(() => loader.planScript({ src: 'javascript:alert(1)', integrity: SHA384 }, BASE), /https/, 'javascript:');
  refusedWith(() => loader.planScript({ src: 'data:text/javascript,alert(1)', integrity: SHA384 }, BASE), /https/, 'data:');
  refusedWith(() => loader.planScript({ src: 'blob:https://widget.example/uuid', integrity: SHA384 }, BASE), /https/, 'blob:');
  refusedWith(() => loader.planScript({ src: 'https://user:pass@a.example/x.js', integrity: SHA384 }, BASE), /identifiant/, 'identifiant dans l\'adresse');
  refusedWith(() => loader.planScript({ src: 'https://evil.example/x.js', integrity: SHA384, hosts: ['cdn.jsdelivr.net'] }, BASE), /Hôte non prévu/, 'hôte hors de la liste');
  assert.ok(loader.planScript({ src: 'js/a.js', hosts: ['cdn.jsdelivr.net'] }, BASE), 'la liste d\'hôtes ne concerne pas un fichier du site de la page');
  for (const bad of ['sha384-AAAA', 'md5-' + 'Zm9v'.repeat(8), SHA384.slice(0, -1), SHA384 + 'A', 'sha384' + 'Zm9v'.repeat(16), ' not-a-hash ']) {
    refusedWith(() => loader.planScript({ src: 'js/a.js', integrity: bad }, BASE), /mal formée/, 'empreinte mal formée refusée même pour le site de la page : ' + bad);
  }
  for (const nothing of [null, undefined, {}, { src: '' }, { src: 5 }]) refusedWith(() => loader.planScript(nothing, BASE), /Aucune adresse/, 'aucune adresse');
  assert.ok(loader.planScript({ src: 'http://127.0.0.1:8123/x.js' }, BASE), 'la machine locale en http : essais navigateur');
  assert.ok(loader.planScript({ src: 'http://localhost:8123/x.js' }, BASE));
  // une page ouverte en file:// (harnais en double-clic) : ses propres fichiers
  assert.ok(loader.planScript({ src: '../js/vendor/exceljs/exceljs.min.js' }, 'file:///work/dev-tests/harness.html'));
  refusedWith(() => loader.planScript({ src: 'https://a.example/x.js' }, 'file:///work/dev-tests/harness.html'), /empreinte/);

  // les deux sources réelles du dépôt passent la politique telle qu'elles sont écrites
  const pptx = require('../js/pptx-export.js');
  assert.ok(loader.planScript({ src: pptx.PPTX_LIB_URL.src, integrity: pptx.PPTX_LIB_URL.integrity, hosts: ['cdn.jsdelivr.net'], referrer: 'no-referrer' }, BASE), 'PptxGenJS : jsDelivr + empreinte');
  console.log('OK loader — politique : https hors du site, empreinte obligatoire pour un autre site et jamais mal formée, hôtes permis, aucun identifiant, javascript:/data:/blob: refusés');
}

// --- L'élément <script> et le registre des modules (faux document) ----------------------------------------------------------
(async () => {
  function fakeDocument(state) {
    const appended = [];
    const listeners = {};
    return {
      appended, listeners,
      baseURI: BASE,
      readyState: state || 'complete',
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      createElement: (tag) => ({ tag }),
      head: { appendChild(el) { appended.push(el); } }
    };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  {
    const doc = fakeDocument();
    const l = loader.create({ document: doc });
    const done = l.script({ src: 'https://gfs.example/lib/pdfjs.js', integrity: SHA384, module: true });
    assert.strictEqual(doc.appended.length, 1);
    const el = doc.appended[0];
    assert.deepStrictEqual({ tag: el.tag, type: el.type, src: el.src, integrity: el.integrity, crossOrigin: el.crossOrigin, referrerPolicy: el.referrerPolicy },
      { tag: 'script', type: 'module', src: 'https://gfs.example/lib/pdfjs.js', integrity: SHA384, crossOrigin: 'anonymous', referrerPolicy: undefined }, 'module + empreinte + crossorigin ; aucun Referer demandé = rien posé');
    el.onload();
    await done;

    const failing = l.script({ src: 'https://gfs.example/lib/x.js', integrity: SHA384, referrer: 'no-referrer' });
    const el2 = doc.appended[1];
    assert.strictEqual(el2.referrerPolicy, 'no-referrer');
    assert.strictEqual(el2.type, undefined, 'script classique par défaut');
    el2.onerror();
    await assert.rejects(failing, (e) => e.code === 'LOADER_FAILED' && /gfs\.example/.test(e.message));

    const sameSite = l.script({ src: 'js/vendor/exceljs/exceljs.min.js' });
    const el3 = doc.appended[2];
    assert.strictEqual(el3.crossOrigin, undefined, 'un fichier du site de la page : pas de crossorigin');
    assert.strictEqual(el3.integrity, undefined);
    el3.onload();
    await sameSite;

    const before = doc.appended.length;
    await assert.rejects(l.script({ src: 'http://a.example/x.js', integrity: SHA384 }), (e) => e.code === 'LOADER_REFUSED');
    assert.strictEqual(doc.appended.length, before, 'une adresse refusée n\'ajoute aucun élément à la page');
    await assert.rejects(loader.script({ src: 'js/a.js' }), (e) => e.code === 'LOADER_FAILED', 'hors navigateur : refus propre');
    console.log('OK loader — l\'élément <script> : type, empreinte, crossorigin, Referer ; refus sans rien ajouter à la page');
  }

  {
    // les modules : un nom, jamais une adresse
    const doc = fakeDocument();
    const l = loader.create({ document: doc });
    const seen = [];
    l.register({ 'kit-dialogs': async () => { seen.push('dialogs'); return { Dialogs: 1 }; }, duckdb: () => ({ ok: true }) });
    l.register({ 'kit-dialogs': () => { throw new Error('une 2e table ne remplace pas la 1re'); } });
    assert.deepStrictEqual(await l.module('kit-dialogs'), { Dialogs: 1 });
    assert.deepStrictEqual(seen, ['dialogs']);
    await assert.rejects(l.module('https://evil.example/x.mjs'), (e) => e.code === 'LOADER_REFUSED' && /Module non prévu/.test(e.message), 'une adresse n\'est pas un nom');
    await assert.rejects(l.module('../kit/js/dialogs.js'), (e) => e.code === 'LOADER_REFUSED');
    await assert.rejects(l.module('constructor'), (e) => e.code === 'LOADER_REFUSED', 'pas de nom pris dans Object.prototype');
    await assert.rejects(l.module('__proto__'), (e) => e.code === 'LOADER_REFUSED');
    await tick();
    assert.deepStrictEqual(await l.module('duckdb'), { ok: true }, 'la table enregistrée avant la fin du chargement reste valable après');

    // modules.js ne s'est pas chargé (page en file://, fichier absent) : échec immédiat, pas une attente sans fin
    const lateDoc = fakeDocument('loading');
    const late = loader.create({ document: lateDoc });
    const waiting = late.module('kit-dialogs');
    lateDoc.listeners.DOMContentLoaded.forEach((fn) => fn());
    await assert.rejects(waiting, (e) => e.code === 'LOADER_FAILED' && /modules\.js/.test(e.message));
    await assert.rejects(late.module('duckdb'), (e) => e.code === 'LOADER_FAILED', 'et les demandes suivantes aussi');
    // ... mais enregistré avant DOMContentLoaded (le cas normal : les modules s'exécutent avant l'événement) : tout marche
    const okDoc = fakeDocument('loading');
    const ok = loader.create({ document: okDoc });
    const early = ok.module('duckdb');
    ok.register({ duckdb: () => 'chargé' });
    okDoc.listeners.DOMContentLoaded.forEach((fn) => fn());
    assert.strictEqual(await early, 'chargé');
    await tick();
    assert.strictEqual(await ok.module('duckdb'), 'chargé');
    await assert.rejects(loader.module('duckdb'), (e) => e.code === 'LOADER_FAILED', 'hors navigateur : refus propre');
    console.log('OK loader — modules : par nom seulement, table posée une fois, échec immédiat si js/modules.js manque, rien d\'attendu pour toujours');
  }

  // --- Garde-fous des sources ------------------------------------------------------------------------------------------------
  {
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:\\'"`])\/\/.*$/gm, '$1');
    const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
    const withScriptElement = [];
    const withDynamicImport = [];
    for (const f of jsFiles) {
      const code = stripComments(read('js/' + f));
      if (/createElement\(\s*['"`]script['"`]\s*\)/.test(code)) withScriptElement.push(f);
      if (/\bimport\s*\(/.test(code)) withDynamicImport.push(f);
      assert.ok(!/importScripts\s*\(|new\s+Worker\s*\(|new\s+SharedWorker\s*\(|\beval\s*\(|new\s+Function\s*\(/.test(code), f + ' : ni worker, ni eval, ni new Function');
      assert.ok(!/document\.write(ln)?\s*\(/.test(code), f + ' : pas de document.write');
    }
    assert.deepStrictEqual(withScriptElement, ['loader.js'], 'UN SEUL createElement(\'script\') dans le dépôt : le chargeur');
    assert.deepStrictEqual(withDynamicImport, ['modules.js'], 'UN SEUL fichier fait des import() : js/modules.js');

    // modules.js : des chemins littéraux, une ligne par module permis, des fichiers qui existent
    const modules = stripComments(read('js/modules.js'));
    const entries = Array.from(modules.matchAll(/'([a-z-]+)': \(\) => import\('(\.\.?\/[A-Za-z0-9_./-]+\.m?js)'\)/g)).map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(entries.map((e) => e[0]), ['kit-ambiance', 'kit-gfs-link', 'kit-dialogs', 'duckdb']);
    assert.strictEqual((modules.match(/\bimport\(/g) || []).length, entries.length, 'tous les import() de modules.js sont des chemins littéraux');
    for (const [name, rel] of entries) {
      assert.ok(!/(https?:|\/\/)/.test(rel), name + ' : un chemin du dépôt, jamais une adresse');
      if (name === 'duckdb') assert.ok(fs.existsSync(path.join(ROOT, 'js', rel)), name + ' : le fichier existe');
    }
    // ceux qui demandent un module le font par son NOM
    for (const [file, name] of [['js/dialogs.js', 'kit-dialogs'], ['js/main-core.js', 'kit-ambiance'], ['js/main-core.js', 'kit-gfs-link'], ['js/duckdb-engine.js', 'duckdb']]) {
      assert.ok(new RegExp(`loader\\.module\\('${name}'\\)`).test(read(file)), file + ' demande ' + name + ' par son nom');
    }
    for (const file of ['js/export.js', 'js/pptx-export.js', 'js/pdf-text.js', 'js/extensions.js']) {
      assert.ok(/GristBI\.loader\.script\(/.test(read(file)), file + ' charge par le chargeur unique');
    }

    // index.html et le harnais : le chargeur avant tout appelant, le module ES déclaré, jamais de balise <script> écrite en dur vers un CDN
    for (const f of ['index.html', 'dev-tests/harness.html']) {
      const html = read(f);
      const tag = (name) => html.search(new RegExp('<script src="(\\.\\./)?js/' + name.replace('.', '\\.') + '"></script>'));
      assert.ok(tag('safe-html.js') >= 0 && tag('safe-html.js') < tag('loader.js') && tag('loader.js') < tag('i18n.js'), f + ' : safe-html, puis le chargeur, puis le reste');
      assert.ok(/<script type="module" src="(\.\.\/)?js\/modules\.js"><\/script>/.test(html), f + ' : js/modules.js déclaré en module ES');
      // Règle S8 de GFS (consigne 026) : le relais des appels bloqués démarre AVANT js/modules.js, en module ES à part (si kit/ manque, seul lui échoue)
      const relay = html.search(/<script type="module" src="(\.\.\/)?js\/relais-securite\.js"><\/script>/);
      const entry = html.search(/<script type="module" src="(\.\.\/)?js\/modules\.js"><\/script>/);
      assert.ok(relay >= 0 && relay < entry, f + ' : js/relais-securite.js déclaré en module ES avant js/modules.js');
      assert.strictEqual((html.match(/<script type="module"/g) || []).length, 2, f + ' : deux modules ES seulement (le relais, puis js/modules.js)');
      for (const caller of ['dialogs.js', 'duckdb-engine.js', 'main-core.js', 'export.js', 'pptx-export.js', 'pdf-text.js', 'extensions.js']) {
        assert.ok(tag(caller) > tag('loader.js'), f + ' : le chargeur précède ' + caller);
      }
    }

    // Le relais de la règle S8 : une ligne, l'import du kit, rien d'autre (ni import() ni chargeur), et le fichier du kit existe
    const relayCode = stripComments(read('js/relais-securite.js')).trim();
    assert.strictEqual(relayCode, "import '../kit/js/violations-start.js';", 'js/relais-securite.js : l\'import du relais du kit, et rien d\'autre');
    assert.ok(fs.existsSync(path.join(ROOT, 'kit/js/violations-start.js')), 'kit/js/violations-start.js existe (kit 0.25.0 ou après ; git submodule update --init)');
    console.log('OK loader — relais S8 : js/relais-securite.js importe kit/js/violations-start.js avant js/modules.js, dans index.html et le harnais');

    // ECharts : plus de document.write, plus d'open() à arguments, un lien javascript: ou data: n'est plus ouvert
    const echarts = read('js/vendor/echarts/echarts.min.js');
    assert.ok(!/document\.write\(|\.write\(/.test(echarts), 'echarts : aucun document.write');
    assert.ok(!/\.open\([^)]/.test(echarts), 'echarts : aucun open() à arguments (window.open(lien, cible), document.open(type, mode))');
    const windowOpen = echarts.match(/function [\w$]+\(([\w$]+),([\w$]+)\)\{if\(!\/\^https\?:\\\/\\\/\/i\.test\(String\(\1\)\)\)return;var [\w$]+=window\.open\(\);[^}]*\}/);
    assert.ok(windowOpen, 'windowOpen d\'ECharts : http(s) seulement');
    const opened = [];
    const sandbox = { String, window: { open() { const w = { opener: 1, location: {} }; opened.push(w); return w; } } };
    const windowOpenFn = vm.runInNewContext('(' + windowOpen[0] + ')', sandbox);
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'JAVASCRIPT:1', '//evil.example', '', null, undefined, 'file:///etc/passwd']) windowOpenFn(bad, '_self');
    assert.strictEqual(opened.length, 0, 'javascript:, data:, file:, adresse relative ou vide : aucune fenêtre');
    windowOpenFn('https://echarts.apache.org/', '_blank');
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].opener, null, 'opener coupé');
    assert.strictEqual(opened[0].location.href, 'https://echarts.apache.org/');
    windowOpenFn('http://example.org/', 'mon-cadre');
    assert.strictEqual(opened.length, 2, 'une cible nommée ouvre un nouvel onglet, ne détourne pas le widget');
    assert.deepStrictEqual(require('./patch-echarts.js').remaining(echarts), []);
    console.log('OK loader — sources : un seul createElement(\'script\'), un seul fichier d\'import(), chemins littéraux, ECharts sans document.write ni open() à arguments, liens javascript:/data: refusés');
  }

  console.log('\nTous les essais du chargeur sont passés.');
})().catch((e) => { console.error(e); process.exit(1); });
