/*
 * Applique à js/vendor/echarts/echarts.min.js (copie de dist/echarts.min.js du paquet npm `echarts`) les deux seules
 * modifications que ce dépôt y fait — voir js/vendor/SOURCES.md, « Modifications » :
 *   1. le repli `new Function("return (" + json + ");")()` de l'analyse d'un GeoJSON (ECharts ne s'en sert que si `JSON.parse`
 *      n'existe pas) devient `JSON.parse(json)` : plus aucune compilation de code à la volée ;
 *   2. une ligne d'en-tête qui dit ce qu'est le fichier (nom, version, licence, origine), pour qu'un outil d'audit ou une personne
 *      qui ouvre le fichier minifié sache d'où il vient.
 * À rejouer après chaque mise à jour d'ECharts, une fois le nouveau fichier copié : `node dev-tests/patch-echarts.js`.
 * Idempotent : sur un fichier déjà modifié, ne change rien et le dit. Sans argument, écrit dans le fichier ; avec `--check`,
 * ne fait que vérifier (code de sortie 1 si une modification manque).
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'js', 'vendor', 'echarts', 'echarts.min.js');
const GEOJSON_FALLBACK = /"undefined"!=typeof JSON&&JSON\.parse\?JSON\.parse\((\w+)\):new Function\("return \("\+\1\+"\);"\)\(\)/g;
const HEADER_MARK = '/*! Apache ECharts ';

function patch(source) {
  let out = source;
  const found = out.match(GEOJSON_FALLBACK) || [];
  if (found.length > 1) throw new Error('plusieurs repli `new Function` reconnus (' + found.length + ') : à examiner à la main');
  out = out.replace(GEOJSON_FALLBACK, 'JSON.parse($1)');
  if (!out.startsWith(HEADER_MARK)) {
    const version = (out.match(/\.version="(\d+\.\d+\.\d+)"/) || [])[1];
    if (!version) throw new Error('version d\'ECharts introuvable dans le fichier');
    out = HEADER_MARK + version + ' | Apache-2.0 | copie de dist/echarts.min.js du paquet npm echarts@' + version +
      ', deux modifications (voir js/vendor/SOURCES.md) | https://echarts.apache.org */\n' + out;
  }
  return out;
}

function remaining(source) {
  const problems = [];
  if (/new Function\(/.test(source)) problems.push('`new Function(` est encore dans le fichier');
  if (!source.startsWith(HEADER_MARK)) problems.push('l\'en-tête d\'origine manque');
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
