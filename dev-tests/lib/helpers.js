/*
 * Aides communes aux essais Node de `dev-tests/` (test-layouts.js, test-styles.js) : ce que les deux fichiers
 * recopiaient jusqu'ici à l'identique — lecture d'un fichier du dépôt, lecteur de règles CSS, et le vrai
 * `js/grist-api.js` branché sur un faux `grist` qui tient la table `BI_Dashboard_Config` en mémoire.
 * Aucune dépendance, Node seulement ; jamais chargé par `index.html`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// `js/charts.js` est le point d'entrée d'une famille de fichiers (le rendu des tuiles est coupé par responsabilité, voir son
// en-tête) : un essai qui lit « le code du rendu » lit les cinq, dans l'ordre de chargement de `index.html`.
const CHARTS_FILES = ['charts-core.js', 'charts-cards.js', 'charts-cloud.js', 'charts-extra.js', 'charts.js'];
const readCharts = () => CHARTS_FILES.map((f) => read('js', f)).join('\n');

// Les objets d'un contexte vm n'ont pas le prototype d'ici : une copie JSON les rend comparables à `deepStrictEqual`.
const plain = (x) => JSON.parse(JSON.stringify(x));

/**
 * Lit une feuille de style en une liste de règles `{ ctx, media, selector, decls }`.
 * `ctx` = les têtes des blocs `@container`/`@media` qui l'enveloppent, du plus extérieur au plus intérieur ;
 * `media` = la tête du bloc `@media` qui l'enveloppe, ou `null`.
 */
function parseCssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  (function walk(src, ctx) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open === -1) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const inner = src.slice(open + 1, j - 1);
      if (head.startsWith('@container') || head.startsWith('@media')) walk(inner, ctx.concat(head.replace(/\s+/g, ' ')));
      else if (!head.startsWith('@')) {
        const decls = {};
        inner.split(';').forEach((d) => { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
        const media = ctx.filter((c) => c.startsWith('@media')).pop() || null;
        rules.push({ ctx, media, selector: head.replace(/\s+/g, ' '), decls });
      }
      i = j;
    }
  })(text, []);
  return rules;
}

/**
 * Charge le VRAI `js/grist-api.js` dans un contexte vm avec un faux `grist` dont la table de configuration vit en mémoire
 * (`cfg`, colonnes de `BI_Dashboard_Config`). `actions`, s'il est donné, reçoit chaque action envoyée à `applyUserActions`.
 * Rend `{ api, cfg }`.
 */
function loadApiWithFakeConfigTable(data, i18n, actions) {
  const sandbox = { console: { error() {}, log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; } };
  sandbox.window = sandbox;
  sandbox.GristBI = { data, i18n, state: { DEFAULT_PAGE_ID: 'page_default' } };
  const cfg = { id: [], TableId: [], ConfigJSON: [], Nom: [], TypeRapport: [], DateModif: [], ModifiePar: [] };
  sandbox.grist = { docApi: {
    listTables: async () => ['BI_Dashboard_Config'],
    fetchTable: async () => plain(cfg),
    applyUserActions: async (list) => {
      const out = { retValues: [] };
      list.forEach((a) => {
        if (actions) actions.push(a);
        if (a[0] === 'AddRecord') {
          const id = cfg.id.length + 1;
          cfg.id.push(id);
          Object.keys(cfg).filter((k) => k !== 'id').forEach((k) => cfg[k].push(a[3][k] !== undefined ? a[3][k] : ''));
          out.retValues.push(id);
        } else if (a[0] === 'UpdateRecord') {
          const i = cfg.id.indexOf(a[2]);
          Object.keys(a[3]).forEach((k) => { cfg[k][i] = a[3][k]; });
          out.retValues.push(null);
        } else out.retValues.push(null);
      });
      return out;
    }
  } };
  vm.runInNewContext(read('js', 'grist-api.js'), sandbox);
  return { api: sandbox.GristBI.api, cfg };
}

module.exports = { ROOT, read, readCharts, CHARTS_FILES, plain, parseCssRules, loadApiWithFakeConfigTable };
