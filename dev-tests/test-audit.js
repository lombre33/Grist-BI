/*
 * Garde-fous issus de l'audit `gwaudit` (voir AUDIT-GW.md) : ce que l'outil mesure et que la prochaine modification
 * peut défaire sans que rien d'autre ne le dise. Node pur, aucune dépendance. Lancer avec : node dev-tests/test-audit.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const html = read('index.html');

// --- index.html : étiquettes des champs, intitulés des boutons, un seul repère `main` (F-RGAA-04/05, D-RGAA) ---

/** Les balises ouvrantes `<nom ...>` d'un fichier HTML, avec leur position (les attributs sur plusieurs lignes comptent). */
function openingTags(source, name) {
  const re = new RegExp('<' + name + '(\\s[^>]*)?>', 'gi');
  const found = [];
  let m;
  while ((m = re.exec(source))) found.push({ text: m[0], index: m.index, end: m.index + m[0].length });
  return found;
}
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : undefined; };
const filled = (v) => typeof v === 'string' && v.trim() !== '';

// Les <label>…</label> (champ placé DANS une étiquette) et les `for` des étiquettes.
const labelRanges = [];
{
  const re = /<label(\s[^>]*)?>[\s\S]*?<\/label>/gi;
  let m;
  while ((m = re.exec(html))) labelRanges.push([m.index, m.index + m[0].length]);
}
const labelFor = new Set(openingTags(html, 'label').map((t) => attr(t.text, 'for')).filter(Boolean));

const NO_LABEL_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image']);
const unlabelled = [...openingTags(html, 'input'), ...openingTags(html, 'select'), ...openingTags(html, 'textarea')].filter((t) => {
  const type = (attr(t.text, 'type') || '').toLowerCase();
  if (NO_LABEL_TYPES.has(type)) return false;
  if (filled(attr(t.text, 'aria-label')) || filled(attr(t.text, 'title')) || filled(attr(t.text, 'aria-labelledby'))) return false;
  if (labelFor.has(attr(t.text, 'id'))) return false;
  return !labelRanges.some(([a, b]) => t.index > a && t.index < b);
});
assert.deepStrictEqual(unlabelled.map((t) => t.text), [], 'chaque champ de index.html a une étiquette (label for, aria-label, title ou dans un label)');

// Un bouton vide dans index.html (`<button …></button>`) n'a pas d'intitulé tant que le script ne l'a pas rempli : on lui en donne un de départ.
const emptyButtons = [];
{
  const re = /<button(\s[^>]*)?>\s*<\/button>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!filled(attr(m[0], 'aria-label')) && !filled(attr(m[0], 'title'))) emptyButtons.push(m[0]);
  }
}
assert.deepStrictEqual(emptyButtons, [], 'aucun bouton sans intitulé dans index.html');

const mains = openingTags(html, 'main');
assert.strictEqual(mains.length, 1, 'un seul <main>');
assert.strictEqual(attr(mains[0].text, 'role'), undefined, '<main> garde son rôle natif');
assert.ok(/<div id="tiles"[^>]*role="tabpanel"/.test(html), '#tiles est le panneau des onglets de page, sur un <div>');
assert.ok(/<\/main>/.test(html), '<main> est refermé');
console.log('OK index.html — champs étiquetés, boutons nommés, un seul <main>');

// --- SECURITY.md : où signaler une vulnérabilité (F-GUIDE-02) ---
assert.ok(fs.existsSync(path.join(root, 'SECURITY.md')), 'SECURITY.md existe');
assert.ok(/Report a vulnerability/.test(read('SECURITY.md')) && /vdp\.numerique\.gouv\.fr/.test(read('SECURITY.md')));
console.log('OK SECURITY.md');

// --- js/vendor/SOURCES.md : ce que dit le tableau est ce que contient le dépôt (E-DEP-02) ---
{
  const sources = read('js/vendor/SOURCES.md');
  const rows = sources.split('\n').filter((l) => /^\|\s*`[a-z@-]+\/`\s*\|/.test(l));
  assert.ok(rows.length >= 8, 'le tableau liste les bibliothèques : ' + rows.length);
  let checked = 0;
  rows.forEach((line) => {
    const cells = line.split('|').map((c) => c.trim().replace(/`/g, ''));
    const dir = cells[1];
    const file = cells[5];
    const sha = (cells[6].match(/^[0-9a-f]{64}/) || [])[0];   // « (modifié) » peut suivre l'empreinte
    assert.ok(sha, 'empreinte entière pour ' + dir + file);
    // `dist/echarts.min.js` du paquet npm est rangé à plat : on cherche le nom du fichier sous le dossier de la bibliothèque.
    const base = path.posix.basename(file);
    const candidates = [path.join(root, 'js/vendor', dir, file), path.join(root, 'js/vendor', dir, base)];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) return;   // bibliothèque retirée depuis : la ligne est à enlever, pas un échec ici
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(found)).digest('hex'), sha, 'js/vendor/' + dir + ' ' + base + ' : empreinte différente de SOURCES.md');
    checked++;
  });
  assert.ok(checked >= 6, 'au moins six fichiers vérifiés : ' + checked);
  console.log('OK js/vendor/SOURCES.md — ' + checked + ' empreintes');
}

// --- Code tiers sans compilation de code à la volée (C-XSS-03, bloquant pour l'outil) ---
{
  const arrowValid = read('js/vendor/apache-arrow/builder/valid.mjs');
  const echarts = require('./patch-echarts.js');
  assert.ok(!/new Function\(|[^.\w]Function\(/.test(arrowValid.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'apache-arrow/builder/valid.mjs : aucun constructeur Function dans le code');
  assert.deepStrictEqual(echarts.remaining(fs.readFileSync(echarts.FILE, 'utf8')), [], 'echarts.min.js : modifications en place (node dev-tests/patch-echarts.js)');
  // Le correctif d'ECharts est idempotent et ne touche pas un fichier déjà modifié.
  const once = fs.readFileSync(echarts.FILE, 'utf8');
  assert.strictEqual(echarts.patch(once), once);
  // Et il fait ce qu'il dit sur le motif d'origine.
  const sample = 'x._geoJSON=j(i=e)?"undefined"!=typeof JSON&&JSON.parse?JSON.parse(i):new Function("return ("+i+");")():i;t.version="9.9.9"';
  assert.ok(/JSON\.parse\(i\):i;t\.version/.test(echarts.patch(sample)) && !/new Function/.test(echarts.patch(sample)));
  assert.ok(echarts.patch(sample).startsWith('/*! Apache ECharts 9.9.9 '));
  console.log('OK code tiers — ni new Function dans valid.mjs ni dans echarts.min.js, correctif d\'ECharts idempotent');
}

// --- Apache Arrow : isValid() garde le contrat de l'original (module ES : import dynamique) ---
(async () => {
  const { pathToFileURL } = require('url');
  const { createIsValidFunction } = await import(pathToFileURL(path.join(root, 'js/vendor/apache-arrow/builder/valid.mjs')).href);
  const all = createIsValidFunction([null, 'N/A', NaN, 0, 10n, undefined]);
  assert.deepStrictEqual([null, 'N/A', NaN, 0, -0, 10n, undefined].map((x) => all(x)), [false, false, false, false, false, false, false]);
  assert.deepStrictEqual([1, 'n/a', '', 11n, false, {}, 'null'].map((x) => all(x)), [true, true, true, true, true, true, true]);
  assert.strictEqual(createIsValidFunction([])('x'), true);
  assert.strictEqual(createIsValidFunction(undefined)(null), true);
  assert.strictEqual(createIsValidFunction([NaN])(NaN), false);
  assert.strictEqual(createIsValidFunction([NaN])(0), true);
  console.log('OK apache-arrow createIsValidFunction — valeurs nulles, NaN, 0/-0, bigint, listes vides');
  console.log('\nTous les garde-fous de l\'audit gwaudit sont passés.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
