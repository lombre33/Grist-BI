/*
 * Essai de `js/safe-html.js` (audit `gwaudit`, C-XSS-01) : la politique de la liste blanche (pure, sans DOM) et les garde-fous
 * des sources — plus aucune écriture de balisage dynamique hors de ce module, y compris dans ECharts. Node pur, aucune dépendance.
 * Lancer avec : node dev-tests/test-safe-html.js
 *
 * La RECONSTRUCTION de l'arbre touche le DOM et se vérifie dans un navigateur : ouvrir `dev-tests/safe-html-test.html`
 * (double-clic ; le titre de l'onglet dit OK ou ÉCHEC) — la batterie de cas est `dev-tests/safe-html-cases.js`.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const safe = require('../js/safe-html.js');
const cases = require('./safe-html-cases.js');

// --- Balises ---
{
  ['div', 'span', 'table', 'td', 'button', 'input', 'li', 'mark', 'code', 'h3', 'br'].forEach((t) => assert.ok(safe.isAllowedTag('html', t), t));
  ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'img', 'a', 'template', 'noscript', 'textarea', 'select', 'video', 'details', 'math'].forEach((t) => assert.ok(!safe.isAllowedTag('html', t), t + ' refusée'));
  ['svg', 'path', 'circle', 'polyline', 'rect', 'text', 'g', 'linearGradient'].forEach((t) => assert.ok(safe.isAllowedTag('svg', t), t));
  ['script', 'use', 'foreignObject', 'image', 'animate', 'set', 'a', 'style', 'iframe', 'animateTransform'].forEach((t) => assert.ok(!safe.isAllowedTag('svg', t), 'svg:' + t + ' refusée'));
  assert.ok(safe.isAllowedTag('html', 'DIV') && safe.isAllowedTag('html', 'TaBlE'), 'comparaison sans la casse');
  console.log('OK safe-html — liste de balises (HTML et SVG)');
}

// --- Attributs ---
{
  const v = (ns, tag, name, value) => safe.attributeValue(ns, tag, name, value);
  assert.strictEqual(v('html', 'div', 'class', 'tile kpi-card is-active'), 'tile kpi-card is-active');
  assert.strictEqual(v('html', 'div', 'class', 'a" onmouseover="x'), null, 'une classe ne contient ni guillemet ni signe égal');
  assert.strictEqual(v('html', 'div', 'onclick', 'x'), null);
  assert.strictEqual(v('html', 'div', 'OnFocus', 'x'), null, 'gestionnaire refusé quelle que soit la casse');
  assert.strictEqual(v('html', 'svg', 'onload', 'x'), null);
  ['href', 'src', 'action', 'formaction', 'srcdoc', 'xlink:href', 'id', 'name', 'for', 'autofocus', 'target', 'rel', 'accesskey', 'contenteditable', 'draggable'].forEach((name) => {
    assert.strictEqual(v('html', 'button', name, 'x'), null, name + ' retiré');
  });
  assert.strictEqual(v('html', 'div', 'role', 'progressbar'), 'progressbar');
  assert.strictEqual(v('html', 'div', 'role', 'a b'), null);
  assert.strictEqual(v('html', 'div', 'tabindex', '-1'), '-1');
  assert.strictEqual(v('html', 'div', 'tabindex', 'javascript:1'), null);
  assert.strictEqual(v('html', 'div', 'aria-label', 'Retirer <b>'), 'Retirer <b>', 'une valeur d\'attribut est du texte, jamais interprétée');
  assert.strictEqual(v('html', 'div', 'aria-', 'x'), null);
  assert.strictEqual(v('html', 'div', 'data-value', 'Nord'), 'Nord');
  assert.strictEqual(v('html', 'div', 'data-', 'x'), null);
  assert.strictEqual(v('html', 'div', 'data-x"y', 'x'), null);
  assert.strictEqual(v('html', 'input', 'type', 'checkbox'), 'checkbox');
  assert.strictEqual(v('html', 'input', 'type', 'password'), null, 'jamais de champ de mot de passe');
  assert.strictEqual(v('html', 'input', 'type', 'file'), null);
  assert.strictEqual(v('html', 'button', 'type', 'button'), 'button');
  assert.strictEqual(v('html', 'th', 'scope', 'col'), 'col');
  assert.strictEqual(v('html', 'td', 'colspan', '3'), '3');
  assert.strictEqual(v('html', 'td', 'colspan', '3x'), null);
  assert.strictEqual(v('html', 'td', 'scope', 'col'), null, 'scope n\'existe que sur th');
  // SVG : présentation seulement, jamais de lien.
  assert.strictEqual(v('svg', 'svg', 'viewBox', '0 0 24 24'), '0 0 24 24');
  assert.strictEqual(v('svg', 'svg', 'preserveAspectRatio', 'none'), 'none');
  assert.strictEqual(v('svg', 'path', 'd', 'M0 0L5 5z'), 'M0 0L5 5z');
  assert.strictEqual(v('svg', 'path', 'href', '//x'), null);
  assert.strictEqual(v('svg', 'path', 'xlink:href', 'javascript:alert(1)'), null);
  assert.strictEqual(v('svg', 'rect', 'fill', 'url(#grad)'), 'url(#grad)', 'un dégradé local reste permis');
  assert.strictEqual(v('svg', 'rect', 'fill', 'url(//evil.invalid/a.svg#g)'), null);
  assert.strictEqual(v('svg', 'rect', 'fill', 'url(data:image/svg+xml,x)'), null);
  assert.strictEqual(v('svg', 'rect', 'fill', 'javascript:alert(1)'), null);
  assert.strictEqual(v('svg', 'text', 'font-size', '26'), '26');
  assert.ok(safe.isSafeSvgValue('M0 0 '.repeat(500)) && !safe.isSafeSvgValue('x'.repeat(20001)), 'un tracé long passe, un texte démesuré non');
  console.log('OK safe-html — attributs : gestionnaires, liens, id/name, champs, SVG');
}

// --- Style en ligne ---
{
  const c = safe.cleanStyle;
  assert.strictEqual(c('width:50%;background:#abc'), 'width:50%;background:#abc');
  assert.strictEqual(c('margin:0px 0 0;line-height:1;'), 'margin:0px 0 0;line-height:1', 'le style des infobulles d\'ECharts passe tel quel');
  assert.strictEqual(c('display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:#5470c6;'), 'display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:#5470c6');
  assert.strictEqual(c('float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900'), 'float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900');
  assert.strictEqual(c('--ls: 6; --lr:4'), '--ls:6;--lr:4', 'variables CSS de la disposition');
  assert.strictEqual(c('COLOR : Red ; Width:10px'), 'color:Red;width:10px', 'noms de propriété normalisés en minuscules');
  assert.strictEqual(c('background:url(//evil.invalid/p.png);color:red'), 'color:red');
  assert.strictEqual(c('background:URL( "x" )'), '');
  assert.strictEqual(c('background:\\75rl(x)'), '', 'jamais d\'échappement');
  assert.strictEqual(c('width:expression(alert(1))'), '');
  assert.strictEqual(c('background:javascript:alert(1)'), '');
  assert.strictEqual(c('behavior:url(x.htc);-moz-binding:url(x);color:blue'), 'color:blue');
  assert.strictEqual(c('position:fixed;top:0'), 'top:0', 'pas de position fixe');
  assert.strictEqual(c('position:sticky'), '');
  assert.strictEqual(c('position:absolute;left:10%'), 'position:absolute;left:10%');
  assert.strictEqual(c('z-index:9999999;color:red'), 'color:red', 'pas de z-index');
  assert.strictEqual(c('cursor:pointer;pointer-events:none;color:red'), 'color:red');
  assert.strictEqual(c('/* x */ color:red'), 'color:red');
  assert.strictEqual(c('@import url(x); color:red'), 'color:red');
  assert.strictEqual(c('transform:rotate(45deg)'), 'transform:rotate(45deg)');
  assert.strictEqual(c('transform:matrix(1,0,0,1,0,0) url(x)'), '');
  assert.strictEqual(c('font-family:\'Helvetica Neue\',sans-serif'), 'font-family:\'Helvetica Neue\',sans-serif');
  assert.strictEqual(c('color:red<script>'), '');
  assert.strictEqual(c(''), '');
  assert.strictEqual(c('color'), '');
  assert.strictEqual(c('width:' + '9'.repeat(300)), '', 'valeur démesurée');
  console.log('OK safe-html — style en ligne : propriétés permises, rien qui charge ou exécute, pas de position fixe');
}

// --- La batterie du navigateur est complète ---
{
  assert.ok(cases.HOSTILE.length >= 30, 'au moins 30 charges hostiles : ' + cases.HOSTILE.length);
  assert.ok(cases.LEGITIMATE.length >= 10, 'au moins 10 gabarits légitimes : ' + cases.LEGITIMATE.length);
  const names = cases.HOSTILE.concat(cases.LEGITIMATE).map((c) => c.name);
  assert.strictEqual(new Set(names).size, names.length, 'noms de cas uniques');
  const must = ['onerror', 'onload', 'javascript:', 'foreignObject', 'mglyph', 'noscript', 'expression', 'fixed', 'srcdoc', 'xlink:href', 'iframe'];
  must.forEach((frag) => assert.ok(cases.HOSTILE.some((c) => (c.html + c.name).includes(frag)), 'une charge couvre ' + frag));
  assert.ok(/safe-html-cases\.js/.test(read('dev-tests/safe-html-test.html')) && /safe-html\.js/.test(read('dev-tests/safe-html-test.html')));
  console.log('OK safe-html — batterie du navigateur : ' + cases.HOSTILE.length + ' charges hostiles, ' + cases.LEGITIMATE.length + ' gabarits légitimes (dev-tests/safe-html-test.html)');
}

// --- Plus aucune écriture de balisage hors de ce module (C-XSS-01) ---
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  const files = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js') && f !== 'safe-html.js');
  const offenders = [];
  files.forEach((f) => {
    strip(read('js/' + f)).split('\n').forEach((line, i) => {
      const write = /\.(innerHTML|outerHTML)\s*(\+?)=(?!=)\s*(.*)$/.exec(line);
      // Seul `= ''` (vider l'élément) reste permis : il n'écrit aucun balisage.
      if (write && (write[2] || !/^(''|""|``|null)\s*[;,)}]/.test(write[3]))) offenders.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 90));
      if (/insertAdjacentHTML|createContextualFragment|document\.write/.test(line)) offenders.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 90));
    });
  });
  assert.deepStrictEqual(offenders, [], 'balisage écrit hors de GristBI.safeHtml.setHtml :\n' + offenders.join('\n'));
  // ECharts : ses sept affectations passent par la même fonction (js/vendor/SOURCES.md, modification 3).
  const patch = require('./patch-echarts.js');
  const echarts = fs.readFileSync(patch.FILE, 'utf8');
  assert.ok((echarts.match(/__gristBiSetHtml\(/g) || []).length >= 8, 'une définition et sept appels dans echarts.min.js');
  assert.deepStrictEqual(patch.remaining(echarts), []);
  // La fonction d'ECharts n'écrit JAMAIS de balisage si le module manque : du texte.
  assert.ok(/else e\.textContent=String\(/.test(echarts.slice(0, 600)), 'repli en texte seul');
  // Le module est le tout premier script de la page (i18n.js écrit déjà du balisage au chargement).
  const order = (rel) => { const h = read(rel); return h.indexOf('safe-html.js') > -1 && h.indexOf('safe-html.js') < h.indexOf('i18n.js'); };
  assert.ok(order('index.html') && order('dev-tests/harness.html'), 'safe-html.js se charge avant i18n.js (index.html et harnais)');
  console.log('OK safe-html — plus aucun innerHTML/outerHTML/insertAdjacentHTML/document.write dynamique dans js/ ni dans ECharts, module chargé en premier');
}

console.log('\nTous les essais de safe-html sont passés.');
