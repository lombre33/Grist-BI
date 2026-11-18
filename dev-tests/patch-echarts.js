/*
 * Applique à js/vendor/echarts/echarts.min.js (copie de dist/echarts.min.js du paquet npm `echarts`) les seules
 * modifications que ce dépôt y fait — voir js/vendor/SOURCES.md, « Modifications » :
 *   1. le repli `new Function("return (" + json + ");")()` de l'analyse d'un GeoJSON (ECharts ne s'en sert que si `JSON.parse`
 *      n'existe pas) devient `JSON.parse(json)` : plus aucune compilation de code à la volée ;
 *   2. une ligne d'en-tête qui dit ce qu'est le fichier (nom, version, licence, origine), pour qu'un outil d'audit ou une personne
 *      qui ouvre le fichier minifié sache d'où il vient ;
 *   3. les sept affectations `élément.innerHTML = texte` (l'infobulle HTML, plus le SVG et la boîte « données » de la barre
 *      d'outils, que ce widget n'emploie pas) passent par `__gristBiSetHtml(élément, texte)`, une fonction posée en tête du
 *      fichier qui confie le texte à `GristBI.safeHtml.setHtml` (js/safe-html.js : liste blanche de balises, d'attributs et de
 *      styles) ; si ce module manque, le texte est écrit TEL QUEL comme texte, jamais comme balisage.
 * À rejouer après chaque mise à jour d'ECharts, une fois le nouveau fichier copié : `node dev-tests/patch-echarts.js`.
 * Idempotent : sur un fichier déjà modifié, ne change rien et le dit. Sans argument, écrit dans le fichier ; avec `--check`,
 * ne fait que vérifier (code de sortie 1 si une modification manque).
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'js', 'vendor', 'echarts', 'echarts.min.js');
const GEOJSON_FALLBACK = /"undefined"!=typeof JSON&&JSON\.parse\?JSON\.parse\((\w+)\):new Function\("return \("\+\1\+"\);"\)\(\)/g;
const HEADER_MARK = '/*! Apache ECharts ';
const SET_HTML = '__gristBiSetHtml';
const SET_HTML_DEFINITION = 'function ' + SET_HTML + '(e,h){var g=typeof window!="undefined"&&window.GristBI,s=g&&g.safeHtml;if(s)s.setHtml(e,h);else e.textContent=String(h==null?"":h)}\n';
// Les affectations d'ECharts, reconnues par leur voisinage (les noms de variables changent d'une version à l'autre : `\w+`).
const HTML_SINKS = [
  [/([\w.]+)\.getSvgRoot\(\)\.innerHTML=(\w+),/g, SET_HTML + '($1.getSvgRoot(),$2),'],
  [/(\w+)\.innerHTML=(\w+\[0\]\|\|\w+\.get\("title"\)),/g, SET_HTML + '($1,$2),'],
  [/\?(\w+)\.innerHTML=(\w+):(\w+)\(\2\)&&/g, '?' + SET_HTML + '($1,$2):$3($2)&&'],
  [/(\w+)\.innerHTML=(\w+\[1\]),(\w+)\.innerHTML=(\w+\[2\]),/g, SET_HTML + '($1,$2),' + SET_HTML + '($3,$4),'],
  [/\)(\w+)\.innerHTML=(\w+)\+(\w+);else if\(/g, ')' + SET_HTML + '($1,$2+$3);else if('],
  [/(\w+)\.innerHTML=(\w+),(\w+)\.appendChild\(\1\)/g, SET_HTML + '($1,$2),$3.appendChild($1)'],
];

function patch(source) {
  let out = source;
  const found = out.match(GEOJSON_FALLBACK) || [];
  if (found.length > 1) throw new Error('plusieurs repli `new Function` reconnus (' + found.length + ') : à examiner à la main');
  out = out.replace(GEOJSON_FALLBACK, 'JSON.parse($1)');
  // Les affectations de HTML : chaque motif est cherché dans la version d'origine ; ce qui n'est pas reconnu reste en place
  // et `remaining()` le dit (une autre version d'ECharts peut avoir d'autres noms).
  HTML_SINKS.forEach(([pattern, replacement]) => { out = out.replace(pattern, replacement); });
  const header = out.startsWith(HEADER_MARK) ? out.slice(0, out.indexOf('\n') + 1) : '';
  if (!header) {
    const version = (out.match(/\.version="(\d+\.\d+\.\d+)"/) || [])[1];
    if (!version) throw new Error('version d\'ECharts introuvable dans le fichier');
    out = HEADER_MARK + version + ' | Apache-2.0 | copie de dist/echarts.min.js du paquet npm echarts@' + version +
      ', trois modifications (voir js/vendor/SOURCES.md) | https://echarts.apache.org */\n' + out;
  } else if (/deux modifications/.test(header)) {
    out = header.replace('deux modifications', 'trois modifications') + out.slice(header.length);
  }
  // La fonction qui reçoit les sept affectations, juste sous l'en-tête (une seule fois), seulement si le fichier en appelle une.
  if (out.indexOf(SET_HTML + '(') !== -1 && out.indexOf('function ' + SET_HTML + '(') === -1) {
    const lineEnd = out.indexOf('\n') + 1;
    out = out.slice(0, lineEnd) + SET_HTML_DEFINITION + out.slice(lineEnd);
  }
  return out;
}

function remaining(source) {
  const problems = [];
  if (/new Function\(/.test(source)) problems.push('`new Function(` est encore dans le fichier');
  if (!source.startsWith(HEADER_MARK)) problems.push('l\'en-tête d\'origine manque');
  const rawSinks = (source.match(/\.innerHTML=(?!"")(?!null[,;)}])/g) || []).length;
  if (rawSinks) problems.push(rawSinks + ' affectation(s) `.innerHTML=` hors de ' + SET_HTML + ' (un motif de HTML_SINKS ne reconnaît plus le code)');
  if (source.indexOf(SET_HTML + '(') === -1 || source.indexOf('function ' + SET_HTML + '(') === -1) problems.push(SET_HTML + ' n\'est pas définie ou pas appelée');
  return problems;
}

module.exports = { patch, remaining, FILE };

if (require.main === module) {
  const source = fs.readFileSync(FILE, 'utf8');
  if (process.argv.includes('--check')) {
    const problems = remaining(source);
    console.log(problems.length ? 'À modifier : ' + problems.join(' ; ') : 'echarts.min.js : modifications en place.');
    process.exitCode = problems.length ? 1 : 0;
  } else {
    const patched = patch(source);
    if (patched === source) console.log('echarts.min.js : déjà modifié, rien à faire.');
    else { fs.writeFileSync(FILE, patched); console.log('echarts.min.js : modifié (' + (patched.length - source.length) + ' octets de différence).'); }
    const problems = remaining(patched);
    if (problems.length) { console.error('Reste : ' + problems.join(' ; ')); process.exitCode = 1; }
  }
}
