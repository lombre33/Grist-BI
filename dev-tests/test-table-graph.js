/*
 * Les tables liées par une colonne Référence (chantier « colonnes de toutes les tables », lot 1a, 26/11/2026) : `js/table-graph.js` (routes, alias,
 * colonnes virtuelles, ajout et retrait d'une jointure, ce qui lit encore une jointure), `js/data.js:applyJoins` (plusieurs jointures d'affilée), le
 * champ `joins` de la configuration (`js/grist-api.js`), `store.setJoins` (`js/state.js`) et le câblage de `js/main-session.js`.
 * Lancer : node dev-tests/test-table-graph.js
 * Ce qui ne se joue QUE dans un navigateur (clic sur « Relier », liste « Tables liées », cadre isolé) est dans `dev-tests/test-browser.js`.
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const data = require('../js/data.js');
const i18n = require('../js/i18n.js');
const state = require('../js/state.js');
const { read, readMain, plain, loadApiWithFakeConfigTable } = require('./lib/helpers.js');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(plain(a), plain(b), msg); };

// Un document de démonstration : Ventes -> Clients -> Pays -> Continents ; Ventes -> Produits ; deux Références vers Personnes (Livreur, Vendeur) ;
// une Référence qui revient à la table de travail (Clients.Derniere), une liste (Clients.Amis), des pièces jointes, une table qui n'existe plus.
const SCHEMA = {
  tables: [
    { id: 'Ventes', columns: [
      { id: 'id', type: 'Int' }, { id: 'manualSort', type: 'ManualSortPos' },
      { id: 'Client', type: 'Ref:Clients' }, { id: 'Produit', type: 'Ref:Produits' },
      { id: 'Livreur', type: 'Ref:Personnes' }, { id: 'Vendeur', type: 'Ref:Personnes' },
      { id: 'Fantome', type: 'Ref:Disparue' }, { id: 'Tags', type: 'RefList:Produits' },
      { id: 'Montant', type: 'Numeric' }
    ] },
    { id: 'Clients', columns: [
      { id: 'id', type: 'Int' }, { id: 'Nom', type: 'Text' }, { id: 'Ville', type: 'Text' }, { id: 'Pays', type: 'Ref:Pays' },
      { id: 'Derniere', type: 'Ref:Ventes' }, { id: 'Amis', type: 'RefList:Clients' }, { id: 'Photo', type: 'Attachments' },
      { id: 'gristHelper_Display', type: 'Any' }
    ] },
    { id: 'Pays', columns: [{ id: 'id', type: 'Int' }, { id: 'Nom', type: 'Text' }, { id: 'Continent', type: 'Ref:Continents' }, { id: 'Capitale', type: 'Ref:Clients' }] },
    { id: 'Continents', columns: [{ id: 'id', type: 'Int' }, { id: 'Nom', type: 'Text' }] },
    { id: 'Produits', columns: [{ id: 'id', type: 'Int' }, { id: 'Libelle', type: 'Text' }, { id: 'Prix', type: 'Numeric' }] },
    { id: 'Personnes', columns: [{ id: 'id', type: 'Int' }, { id: 'Nom', type: 'Text' }] }
  ]
};

// ---- 1. Le module : les vérifications, rejouées ensuite sur des versions FAUTIVES --------------------------------------------------------------
function graphChecks(g) {
  const idx = g.indexSchema(SCHEMA);

  // Schéma : les entrées mal formées sont écartées, jamais une exception.
  eq(Array.from(g.indexSchema(null).keys()), [], 'schéma absent');
  eq(Array.from(g.indexSchema({ tables: [null, 3, 'x', {}, { id: '' }, { id: 'T', columns: [null, { id: 'a', type: 4 }, { id: 'a' }, { id: 'x'.repeat(200) }] }, { id: 'T', columns: 'x' }, { id: 'T' }] }).entries()),
    [['T', [{ id: 'a', type: '' }]]], 'tables et colonnes mal formées, doublons et noms trop longs écartés, 1re table gardée');

  // Table visée.
  eq([g.refTarget('Ref:Clients'), g.refTarget('RefList:Clients'), g.refTarget('Ref:'), g.refTarget('Text'), g.refTarget(null)], ['Clients', '', '', '', ''], 'une Référence simple seulement');

  // Routes : un saut dans l'ordre des colonnes, puis deux sauts ; jamais de retour, de liste, de table absente ni de 3e saut.
  const routes = g.routesFrom(idx, 'Ventes');
  eq(routes.map((r) => r.steps.map((s) => `${s.table}.${s.column}`).join('>')), [
    'Ventes.Client', 'Ventes.Produit', 'Ventes.Livreur', 'Ventes.Vendeur', 'Ventes.Client>Clients.Pays'
  ], 'un et deux sauts, pas de liste, pas de table absente, pas de retour à la table de travail, pas de 3e saut');
  eq(routes.map((r) => r.target), ['Clients', 'Produits', 'Personnes', 'Personnes', 'Pays'], 'les tables atteintes');
  ok(!routes.some((r) => r.target === 'Ventes'), 'jamais un retour à la table de travail (Clients.Derniere)');
  ok(!routes.some((r) => r.target === 'Continents'), 'jamais un 3e saut');
  ok(!routes.some((r) => r.target === 'Disparue'), 'une table absente du document ne mène nulle part');
  eq(g.routesFrom(idx, 'Absente'), [], 'table de travail inconnue : aucune route');
  eq(g.routesFrom(idx, 'Ventes', 1).map((r) => r.target), ['Clients', 'Produits', 'Personnes', 'Personnes'], 'un seul saut sur demande');
  // Jamais de cycle : Clients -> Pays -> Clients (Pays.Capitale) ne revient pas sur une table déjà traversée.
  eq(g.routesFrom(idx, 'Clients').map((r) => r.target), ['Pays', 'Ventes', 'Continents', 'Produits', 'Personnes', 'Personnes'], 'depuis Clients : Pays et Ventes (Clients.Derniere), puis leurs propres Références ; Pays.Capitale ne revient pas à Clients');
  ok(!g.routesFrom(idx, 'Clients').some((r) => r.steps.length === 2 && r.target === 'Clients'), 'jamais de retour à la table de départ');
  // Plafond de routes.
  const wide = { tables: [{ id: 'A', columns: Array.from({ length: 80 }, (_, i) => ({ id: 'c' + i, type: 'Ref:B' })) }, { id: 'B', columns: [] }] };
  eq(g.routesFrom(g.indexSchema(wide), 'A').length, 40, 'au plus 40 routes');

  // Alias : le nom de la table quand une seule route y mène ; sinon « Table (colonne) ». Stable une fois posé.
  const alone = g.virtualColumns(idx, 'Ventes', [], new Set());
  const byAlias = (list, alias) => list.filter((c) => c.alias === alias).map((c) => c.id);
  eq(byAlias(alone, 'Clients'), ['Clients.Nom', 'Clients.Ville'], 'une seule route vers Clients : l\'alias est le nom de la table');
  eq(byAlias(alone, 'Produits'), ['Produits.Libelle', 'Produits.Prix']);
  eq(byAlias(alone, 'Personnes (Livreur)'), ['Personnes (Livreur).Nom'], 'deux routes vers Personnes : l\'alias dit par où l\'on passe');
  eq(byAlias(alone, 'Personnes (Vendeur)'), ['Personnes (Vendeur).Nom']);
  eq(byAlias(alone, 'Pays'), ['Pays.Nom'], 'le 2e saut : Pays par Clients.Pays ; sa Référence Continent et sa liste ne sont jamais des colonnes');
  ok(!alone.some((c) => /\.(id|manualSort)$/.test(c.id) || /gristHelper_/.test(c.id)), 'ni numéro de ligne, ni colonne d\'aide');
  ok(!alone.some((c) => /^(Ref:|RefList:|Attachments)/.test(c.type)), 'ni Référence, ni liste, ni pièce jointe parmi les colonnes lues');
  ok(alone.every((c) => c.joined === false), 'rien n\'est joint au départ');
  eq(new Set(alone.map((c) => c.id)).size, alone.length, 'aucune colonne en double');
  const second = alone.find((c) => c.id === 'Pays.Nom');
  eq(g.joinsToAdd(second), [
    { alias: 'Clients', table: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' },
    { alias: 'Pays', table: 'Pays', primaryColumn: 'Clients.Pays', secondaryColumn: 'id' }
  ], 'choisir une colonne du 2e saut pose les deux jointures, dans l\'ordre, la 2e partant de la colonne de la 1re');

  // Une jointure déjà posée garde SON alias, et ce qu'elle apporte n'est plus « virtuel ».
  const clientsJoin = { alias: 'Clients', table: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' };
  const present = new Set(['Clients.Nom', 'Clients.Ville', 'Clients.Pays']);
  const afterOne = g.virtualColumns(idx, 'Ventes', [clientsJoin], present);
  ok(!afterOne.some((c) => c.alias === 'Clients'), 'les colonnes déjà dans les lignes ne sont plus proposées');
  const stillPays = afterOne.find((c) => c.id === 'Pays.Nom');
  eq(g.joinsToAdd(stillPays), [{ alias: 'Pays', table: 'Pays', primaryColumn: 'Clients.Pays', secondaryColumn: 'id' }], 'le 2e saut ne repose pas la 1re jointure');
  const livreur = { alias: 'Personnes', table: 'Personnes', primaryColumn: 'Livreur', secondaryColumn: 'id' };
  const frozen = g.virtualColumns(idx, 'Ventes', [livreur], new Set(['Personnes.Nom']));
  ok(!frozen.some((c) => c.alias === 'Personnes'), 'une jointure enregistrée sous le nom nu le garde : jamais renommée quand une 2e Référence apparaît');
  eq(byAlias(frozen, 'Personnes (Vendeur)'), ['Personnes (Vendeur).Nom'], 'la nouvelle route prend un nom qui dit d\'où elle vient');
  eq(frozen.find((c) => c.alias === 'Personnes (Vendeur)').joined, false);
  const joinedAll = g.virtualColumns(idx, 'Ventes', [clientsJoin], new Set()).find((c) => c.id === 'Clients.Ville');
  ok(joinedAll === undefined || joinedAll.joined === true, 'une colonne dont toute la route est jointe est dite jointe');
  eq(g.joinsToAdd(null), [], 'rien à poser sans colonne');
  eq(g.freshAlias('Clients', 'Client', new Set(['Clients', 'Clients (Client)']), true), 'Clients (Client) 2', 'alias pris : le suivant est numéroté');
  eq(g.freshAlias('Clients', 'Client', new Set(['Clients', 'Clients (Client)', 'Clients (Client) 2']), true), 'Clients (Client) 3', 'et ainsi de suite');
  eq(g.freshAlias('Clients', 'Client', ['Clients'], true), 'Clients (Client)', 'le nom nu est pris : « Table (colonne) »');
  eq(g.freshAlias('Clients', 'Client', [], false), 'Clients (Client)', 'plusieurs routes : jamais le nom nu');

  // Ajouter une jointure demandée de l'extérieur (« Relier la table… »).
  const added = g.addJoin([], null, 'Clients', 'Client');
  eq([added.added, added.join], [true, clientsJoin], 'nouvelle jointure sous le nom de la table');
  const again = g.addJoin(added.joins, null, 'Clients', 'Client');
  eq([again.added, again.join.alias], [false, 'Clients'], 'la même jointure n\'est jamais posée deux fois');
  ok(again.joins === added.joins, 'rien d\'ajouté : la même liste');
  const manual = { secondaryTableId: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' };
  eq(g.addJoin([], manual, 'Clients', 'Client').added, false, 'le réglage manuel équivalent compte comme une jointure');
  const clash = g.addJoin([], { secondaryTableId: 'Clients', primaryColumn: 'Autre', secondaryColumn: 'id' }, 'Clients', 'Client');
  eq([clash.added, clash.join.alias], [true, 'Clients (Client)'], 'un alias déjà pris par le réglage manuel : un autre nom, jamais deux jointures sous le même');
  const full = Array.from({ length: 12 }, (_, i) => ({ alias: 'T' + i, table: 'T' + i, primaryColumn: 'C' + i, secondaryColumn: 'id' }));
  eq(g.addJoin(full, null, 'Clients', 'Client').join, null, 'au plafond : rien n\'est ajouté');
  eq(g.addJoin(full, null, 'Clients', 'Client').added, false);

  // Retirer : les jointures qui en dépendent partent avec elle ; rien d'autre.
  const chain = [clientsJoin, { alias: 'Pays', table: 'Pays', primaryColumn: 'Clients.Pays', secondaryColumn: 'id' }, { alias: 'Produits', table: 'Produits', primaryColumn: 'Produit', secondaryColumn: 'id' }];
  eq(g.removeJoin(chain, 'Clients'), { joins: [chain[2]], removed: ['Clients', 'Pays'] }, 'retirer Clients retire Pays (qui part de Clients.Pays)');
  eq(g.removeJoin(chain, 'Pays'), { joins: [chain[0], chain[2]], removed: ['Pays'] }, 'retirer Pays laisse Clients');
  eq(g.removeJoin(chain, 'Inconnue'), { joins: chain, removed: [] }, 'alias inconnu : rien ne change');
  const deep = [clientsJoin, chain[1], { alias: 'Continents', table: 'Continents', primaryColumn: 'Pays.Continent', secondaryColumn: 'id' }];
  eq(g.removeJoin(deep, 'Clients').removed, ['Clients', 'Pays', 'Continents'], 'une chaîne entière part avec sa racine');
  eq(g.removeJoin(chain, 'Cli').removed, [], 'un alias est un nom entier, jamais un début de nom');

  // Ce qui lit encore une jointure.
  const columnsOf = (tile) => tile.cols || [];
  const st = {
    pages: [{ tiles: [{ id: 'a', cols: ['Clients.Ville', 'Montant'] }, { id: 'b', cols: ['Montant'] }, { id: 'c', cols: ['Pays.Nom'] }] }, { tiles: [{ id: 'd', cols: ['Clients.Nom'] }] }],
    activeFilters: [{ column: 'Clients.Ville' }, { column: 'Montant' }],
    advancedFilters: [{ column: 'Pays.Nom' }],
    bookmarks: [{ activeFilters: [{ column: 'Clients.Ville' }], advancedFilters: [] }, { activeFilters: [], advancedFilters: [{ column: 'Clients.Nom' }] }, { activeFilters: [{ column: 'Montant' }] }]
  };
  eq(g.usageOf(st, ['Clients'], columnsOf), { tiles: 2, filters: 1, bookmarks: 2 }, 'tuiles de toutes les pages, filtres croisés, filtres avancés, vues');
  eq(g.usageOf(st, ['Clients', 'Pays'], columnsOf), { tiles: 3, filters: 2, bookmarks: 2 }, 'plusieurs alias à la fois');
  eq(g.usageOf(st, ['Cli'], columnsOf), { tiles: 0, filters: 0, bookmarks: 0 }, 'un alias est un nom entier');
  eq(g.usageOf(null, ['Clients'], columnsOf), { tiles: 0, filters: 0, bookmarks: 0 }, 'état absent');
  eq(g.usageOf(st, 'Clients', columnsOf).tiles, 2, 'un seul alias en texte');
  eq(g.usageOf({ pages: [{ tiles: [null, 3, {}] }, null], activeFilters: [null, 4], bookmarks: [null] }, ['X'], columnsOf), { tiles: 0, filters: 0, bookmarks: 0 }, 'entrées mal formées');

  // Toutes les jointures : le réglage manuel d'abord ; un alias pris deux fois n'est lu qu'une fois.
  eq(g.allJoins(manual, [chain[0]]).map((j) => j.alias), ['Clients'], 'le réglage manuel et une jointure du même alias : la première gagne');
  eq(g.allJoins(manual, [chain[2]]).map((j) => j.alias), ['Clients', 'Produits'], 'le réglage manuel d\'abord');
  eq(g.allJoins(null, null), [], 'rien');
  eq(g.allJoins({ secondaryTableId: 3 }, [null, 4, { table: 'x' }]), [], 'entrées mal formées');
  eq(g.legacyJoin({ secondaryTableId: 'A', primaryColumn: 'b', secondaryColumn: 'c' }), { alias: 'A', table: 'A', primaryColumn: 'b', secondaryColumn: 'c' });
  eq(g.legacyJoin({ secondaryTableId: 'A', primaryColumn: '', secondaryColumn: 'c' }), null, 'un réglage manuel incomplet n\'est pas une jointure');
  eq(g.legacyJoin(null), null);

  // Nettoyer ce qu'une configuration contient.
  const raw = [chain[0], chain[0], { alias: 'X', table: 'Y', primaryColumn: 'c', secondaryColumn: 'id', extra: '<img src=x onerror=alert(1)>' }, null, 7, 'x', [],
    { alias: '', table: 'Y', primaryColumn: 'c', secondaryColumn: 'id' }, { alias: 'Z', table: 5, primaryColumn: 'c', secondaryColumn: 'id' },
    { alias: 'a'.repeat(161), table: 'Y', primaryColumn: 'c', secondaryColumn: 'id' }, { alias: 'Ctl\u0001', table: 'Y', primaryColumn: 'c', secondaryColumn: 'id' },
    { alias: 'Pays', table: 'Pays', primaryColumn: 'Clients.Pays', secondaryColumn: 'id' }];
  const clean = g.sanitizeJoins(raw, ['Reserve']);
  eq(clean.map((j) => j.alias), ['Clients', 'X', 'Pays'], 'doublon, entrées mal formées, noms vides, trop longs ou à caractères de contrôle écartés');
  eq(Object.keys(clean[1]), ['alias', 'table', 'primaryColumn', 'secondaryColumn'], 'forme fermée : un champ en plus n\'entre jamais');
  ok(clean[0] !== raw[0], 'des objets NEUFS : jamais l\'objet de la configuration');
  eq(g.sanitizeJoins([{ alias: 'Reserve', table: 'T', primaryColumn: 'c', secondaryColumn: 'id' }], ['Reserve']), [], 'un alias réservé (celui du réglage manuel) est refusé');
  eq(g.sanitizeJoins('x', []), [], 'pas une liste');
  eq(g.sanitizeJoins(Array.from({ length: 50 }, (_, i) => ({ alias: 'A' + i, table: 'T', primaryColumn: 'c', secondaryColumn: 'id' })), []).length, 12, 'au plus douze jointures');
  const proto = JSON.parse('[{"alias":"__proto__","table":"T","primaryColumn":"c","secondaryColumn":"id"}]');
  eq(g.sanitizeJoins(proto, []).map((j) => j.alias), ['__proto__'], 'un nom hostile reste un texte');
  ok(({}).alias === undefined, 'jamais de pollution du prototype');

  ok(g.sameJoins(chain, chain.slice()) && !g.sameJoins(chain, chain.slice(0, 2)) && !g.sameJoins(chain, [chain[0], chain[1], Object.assign({}, chain[2], { alias: 'P' })]), 'comparaison de deux listes');
  eq(g.findJoin(chain, { column: 'Pays', target: 'Pays' }, 'Clients'), chain[1], 'la jointure qui suit une étape');
  eq(g.findJoin(chain, { column: 'Pays', target: 'Pays' }, ''), null, 'depuis une autre colonne de départ : aucune');
}
graphChecks(require('../js/table-graph.js'));
console.log(`OK table-graph — schéma, routes (un et deux sauts, jamais de cycle ni de liste), alias stables, colonnes virtuelles, ajout, retrait en cascade, usage, nettoyage de la configuration (${checks} vérifications)`);

// ---- 2. Versions FAUTIVES : chacune doit être vue par les vérifications ---------------------------------------------------------------------
const graphSource = read('js', 'table-graph.js');
function loadGraph(source) {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}
const MUTANTS = [
  ['une liste de références suivie comme une Référence', "const m = /^Ref:(.+)$/.exec(typeof type === 'string' ? type : '');", "const m = /^Ref(?:List)?:(.+)$/.exec(typeof type === 'string' ? type : '');"],
  ['retour à une table déjà traversée', "|| node.visited.indexOf(target) !== -1) continue;", '|| false) continue;'],
  ['trois sauts', 'const MAX_HOPS = 2;', 'const MAX_HOPS = 3;'],
  ['plus de plafond de routes', 'const MAX_ROUTES = 40;', 'const MAX_ROUTES = 4000;'],
  ['le numéro de ligne proposé comme colonne', 'const HIDDEN_NAME = /^(id|manualSort|gristHelper_.*)$/;', 'const HIDDEN_NAME = /^$/;'],
  ['une Référence proposée comme colonne', 'const HIDDEN_TYPES = /^(Ref:|RefList:|Attachments$)/;', 'const HIDDEN_TYPES = /^(RefList:|Attachments$)/;'],
  ['un alias nu même quand deux routes mènent à la table', 'const alone = (typeof siblingsOf === \'function\' ? siblingsOf(step.target) : 1) <= 1;', 'const alone = true;'],
  ['la jointure déjà posée ignorée (alias renommé)', "return (joins || []).find((j) => j.table === step.target && j.primaryColumn === primary && j.secondaryColumn === 'id') || null;", 'return null;'],
  ['le 2e saut qui ne part pas du 1er', "const primaryColumn = fromAlias ? `${fromAlias}.${step.column}` : step.column;\n      const alone", "const primaryColumn = step.column;\n      const alone"],
  ['une jointure retirée sans ses dépendantes', 'if (j.primaryColumn.indexOf(`${a}.`) === 0) { gone.add(j.alias); grew = true; break; }', 'break;'],
  ['un début de nom pris pour un alias', 'column.indexOf(`${a}.`) === 0', 'column.indexOf(a) === 0'],
  ['un alias en double gardé', 'if (taken.has(j.alias)) continue;', ''],
  ['un alias réservé accepté', 'const taken = new Set(Array.isArray(reserved) ? reserved : []);', 'const taken = new Set();'],
  ['l\'objet de la configuration gardé tel quel', 'out.push({ alias: j.alias, table: j.table, primaryColumn: j.primaryColumn, secondaryColumn: j.secondaryColumn });', 'out.push(j);'],
  ['plus de plafond de jointures', 'if (out.length >= MAX_JOINS) break;', ''],
  ['le réglage manuel et une jointure de même alias lus tous deux', 'if (!isObject(j) || typeof j.alias !== \'string\' || seen.has(j.alias)) return;', 'if (!isObject(j) || typeof j.alias !== \'string\') return;'],
  ['la même jointure posée deux fois', 'if (existing) return { joins: joins || [], join: existing, added: false };', ''],
  ['un ajout au-delà du plafond', 'if (all.length >= MAX_JOINS) return { joins: joins || [], join: null, added: false };', ''],
  ['toutes les étapes reposées', 'steps.filter((s) => !s.joined)', 'steps'],
  ['les vues oubliées de l\'usage', 'out.bookmarks++;', 'out.bookmarks += 0;'],
  ['les filtres avancés oubliés de l\'usage', '+ (Array.isArray(s.advancedFilters) ? s.advancedFilters : []).filter(filterUses).length;', ';'],
  ['un réglage manuel incomplet pris pour une jointure', "if (!isObject(blend) || !validId(blend.secondaryTableId) || !validId(blend.primaryColumn) || !validId(blend.secondaryColumn)) return null;", 'if (!isObject(blend)) return null;'],
  ['un alias numéroté jamais atteint', "while (used.has(`${named} ${n}`)) n++;", ''],
  ['un nom trop long accepté', 'v.length <= MAX_ID_LENGTH &&', '']
];
let seen = 0;
MUTANTS.forEach(([label, from, to]) => {
  assert.ok(graphSource.includes(from), `version fautive « ${label} » : le texte à remplacer n'est plus dans js/table-graph.js`);
  const mutated = loadGraph(graphSource.replace(from, to));
  let caught = false;
  try { graphChecks(mutated); } catch (e) { caught = true; }
  assert.ok(caught, `version fautive non vue : ${label}`);
  seen += 1;
});
console.log(`OK table-graph — ${seen} versions fautives vues par les vérifications`);

// ---- 3. applyJoins : plusieurs jointures d'affilée, sans jamais multiplier les lignes --------------------------------------------------------
{
  const ventes = [
    { id: 1, Client: 1, Montant: 10 }, { id: 2, Client: 2, Montant: 20 }, { id: 3, Client: 1, Montant: 30 },
    { id: 4, Client: 0, Montant: 5 }, { id: 5, Client: 9, Montant: 7 }
  ];
  const clients = [{ id: 1, Nom: 'Ada', Pays: 1 }, { id: 2, Nom: 'Bob', Pays: 2 }];
  const pays = [{ id: 1, Nom: 'France' }, { id: 2, Nom: 'Chili' }];
  const produits = [{ id: 1, Libelle: 'Stylo' }];
  const joins = [
    { alias: 'Clients', table: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' },
    { alias: 'Pays', table: 'Pays', primaryColumn: 'Clients.Pays', secondaryColumn: 'id' }
  ];
  const res = data.applyJoins(ventes, joins, { Clients: clients, Pays: pays });
  eq(res.failed, [], 'tout a joint');
  eq(res.rows.length, ventes.length, 'autant de lignes qu\'avant : une Référence suivie ne multiplie rien');
  eq(res.rows.reduce((s, r) => s + r.Montant, 0), 72, 'mêmes totaux');
  eq(res.rows.map((r) => r['Pays.Nom']), ['France', 'Chili', 'France', null, null], 'le 2e saut part d\'une colonne du 1er ; une Référence vide ou orpheline donne un vide, jamais une autre ligne');
  eq(res.rows.map((r) => r['Clients.Nom']), ['Ada', 'Bob', 'Ada', null, null]);
  ok(ventes[0].Client === 1 && !('Clients.Nom' in ventes[0]), 'les lignes d\'origine ne sont pas modifiées');
  // Une table illisible n'en retire pas les autres ; la jointure qui en dépend est sautée aussi.
  const noClients = data.applyJoins(ventes, joins.concat([{ alias: 'Produits', table: 'Produits', primaryColumn: 'Client', secondaryColumn: 'id' }]), { Clients: null, Pays: pays, Produits: produits });
  eq(noClients.failed, ['Clients', 'Pays'], 'table illisible : sautée, et celle qui part d\'elle aussi (sa colonne de départ manque)');
  eq(noClients.rows.map((r) => r['Produits.Libelle']), ['Stylo', null, 'Stylo', null, null], 'les autres jointures s\'appliquent quand même');
  // Une table sans ligne apporte quand même ses colonnes.
  const empty = data.applyJoins(ventes, [joins[0]], { Clients: [] }, { Clients: ['Nom', 'Pays'] });
  eq(Object.keys(empty.rows[0]).filter((k) => k.indexOf('Clients.') === 0), ['Clients.Nom', 'Clients.Pays'], 'une table vide donne ses colonnes (listes de colonnes complètes), toutes vides');
  ok(empty.rows.every((r) => r['Clients.Nom'] === null), 'vides, jamais 0');
  // Aucune ligne de départ, aucune jointure, entrées hostiles.
  eq(data.applyJoins([], joins, { Clients: clients, Pays: pays }).rows, [], 'aucune ligne');
  eq(data.applyJoins(ventes, [], {}).rows, ventes, 'aucune jointure : les lignes elles-mêmes');
  assert.doesNotThrow(() => data.applyJoins(null, null, null), 'tout absent');
  eq(data.applyJoins(ventes, [{ alias: 'X', table: 'Z', primaryColumn: 'Client', secondaryColumn: 'id' }], {}).failed, ['X'], 'une table jamais lue est une jointure échouée');
  // Une colonne de départ absente (jointure d'une table qui n'existe plus dans les lignes) : sautée.
  eq(data.applyJoins(ventes, [{ alias: 'X', table: 'Clients', primaryColumn: 'Absente', secondaryColumn: 'id' }], { Clients: clients }).failed, ['X'], 'colonne de départ absente');
  console.log('OK applyJoins — deux sauts, mêmes lignes et mêmes totaux, référence vide ou orpheline = vide, table illisible sautée sans retirer les autres, table vide = ses colonnes');
}

// ---- 4. La configuration : le champ `joins` et l'ancien `blend`, relus tels quels ---------------------------------------------------------------
(async () => {
  const actions = [];
  const { api, cfg } = loadApiWithFakeConfigTable(data, i18n, actions);
  const pages = [{ id: 'page_default', name: 'Page 1', tiles: [] }];
  const stored = () => JSON.parse(cfg.ConfigJSON[cfg.ConfigJSON.length - 1]);
  const j1 = { alias: 'Clients', table: 'Clients', primaryColumn: 'Client', secondaryColumn: 'id' };

  eq(api.blankConfig().joins, [], 'rapport vierge : aucune jointure');
  eq((await api.loadConfig('T')).joins, [], 'document sans configuration');
  // Rien d'écrit sans jointure : une configuration d'avant reste identique octet pour octet.
  await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', {}, []);
  eq(Object.keys(stored()), ['pages', 'currentPageId', 'bookmarks', 'blend'], 'aucune clé joins sans jointure');
  await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', {}, undefined);
  ok(!('joins' in stored()), 'joins absent : rien d\'écrit');
  await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', {}, [j1]);
  eq(stored().joins, [j1], 'une jointure : écrite avec le rapport');
  eq((await api.loadConfig('T')).joins, [j1], 'relue');
  await api.saveConfig('T', pages, 'page_default', [], { secondaryTableId: 'Autre', primaryColumn: 'a', secondaryColumn: 'id' }, null, null, 'standard', {}, [j1]);
  eq([stored().blend.secondaryTableId, stored().joins.length], ['Autre', 1], 'le réglage manuel et les jointures se rangent côte à côte');
  const loaded = await api.loadConfig('T');
  eq([loaded.blend.secondaryTableId, loaded.joins.length], ['Autre', 1], 'et se relisent ensemble');
  await api.saveConfig('T', pages, 'page_default', [], null, null, null, 'standard', {}, []);
  ok(!('joins' in stored()), 'retirer la dernière jointure retire la clé');
  // Une ligne écrite par quelqu'un d'autre : relue comme une liste, nettoyée par l'appelant (js/main-session.js:switchTable).
  cfg.ConfigJSON[cfg.ConfigJSON.length - 1] = JSON.stringify({ pages, currentPageId: 'page_default', bookmarks: [], blend: null, joins: 'x' });
  eq((await api.loadConfig('T')).joins, [], 'joins qui n\'est pas une liste : aucune jointure');
  cfg.ConfigJSON[cfg.ConfigJSON.length - 1] = JSON.stringify([{ id: 't1', type: 'bar' }]);
  eq((await api.loadConfig('T')).joins, [], 'ancien format (tableau de tuiles) : aucune jointure');
  cfg.ConfigJSON[cfg.ConfigJSON.length - 1] = JSON.stringify({ tiles: [], bookmarks: [] });
  eq((await api.loadConfig('T')).joins, [], 'format intermédiaire : aucune jointure');
  console.log('OK configuration — joins écrit seulement s\'il y en a, relu, côte à côte avec blend, anciens formats et valeur hostile sans jointure');

  // Le schéma des liens, lu dans les tables système (vrai grist-api.js, faux `grist`).
  const { sandbox } = loadApiWithFakeConfigTable(data, i18n, []);
  const meta = {
    _grist_Tables: { id: [1, 2, 3, 4], tableId: ['Ventes', 'Clients', 'BI_Dashboard_Config', '_grist_Foo'] },
    _grist_Tables_column: {
      id: [1, 2, 3, 4, 5, 6],
      parentId: [1, 1, 2, 2, 3, 1],
      colId: ['Client', 'Montant', 'Nom', 'Pays', 'TableId', 'gristHelper_Display'],
      type: ['Ref:Clients', 'Numeric', 'Text', 'Ref:Pays', 'Text', 'Any']
    }
  };
  sandbox.grist.docApi.fetchTable = async (name) => { if (!meta[name]) throw new Error('inconnue'); return meta[name]; };
  const schema = await sandbox.GristBI.api.readLinkSchema();
  eq(schema, { tables: [
    { id: 'Ventes', columns: [{ id: 'Client', type: 'Ref:Clients' }, { id: 'Montant', type: 'Numeric' }] },
    { id: 'Clients', columns: [{ id: 'Nom', type: 'Text' }, { id: 'Pays', type: 'Ref:Pays' }] }
  ] }, 'tables du document seulement : ni les tables internes du widget, ni les tables système, ni les colonnes d\'aide');
  sandbox.grist.docApi.fetchTable = async () => { throw new Error('droits'); };
  eq(await sandbox.GristBI.api.readLinkSchema(), { tables: [] }, 'lecture impossible : aucun schéma, jamais une exception');
  console.log('OK schéma des liens — tables du document, types, colonnes d\'aide et tables internes écartées, échec sans exception');

  // ---- 5. Le store ------------------------------------------------------------------------------------------------------------------------
  {
    const store = state.createStore();
    eq(store.getState().joins, [], 'aucune jointure au départ');
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    store.setJoins([j1]);
    eq(store.getState().joins, [j1]);
    ok(calls === 1, 'les abonnés sont prévenus');
    store.setJoins('x');
    eq(store.getState().joins, [], 'ce qui n\'est pas une liste : aucune jointure');
    store.setJoins(null);
    eq(store.getState().joins, []);
    console.log('OK store — joins : vide au départ, notifié, valeur mal formée = aucune jointure');
  }

  // ---- 6. Le câblage ---------------------------------------------------------------------------------------------------------------------
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const harness = fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8');
    [[html, ''], [harness, '../']].forEach(([text, prefix]) => {
      const at = (n) => text.indexOf(`<script src="${prefix}js/${n}"></script>`);
      assert.ok(at('table-graph.js') > at('combobox.js') && at('table-graph.js') < at('state.js'), 'table-graph.js : après combobox.js, avant state.js');
      assert.ok(at('table-graph.js') < at('main-core.js'), 'et avant le démarrage de l\'interface');
      ['joins-bar', 'joins-list', 'joins-note'].forEach((id) => assert.ok(text.includes(`id="${id}"`), `#${id}`));
      assert.ok(/id="joins-bar"[^>]*edit-only[^>]*hidden|id="joins-bar"[^>]*hidden[^>]*edit-only|class="pop-group edit-only" hidden/.test(text) || /id="joins-bar" class="pop-group edit-only" hidden/.test(text), 'la liste est un bloc du mode Édition, masqué tant qu\'il n\'y a aucune jointure');
      assert.ok(/id="joins-note"[^>]*role="status"/.test(text), 'le refus est une zone de statut');
    });
    const main = readMain();
    const session = read('js', 'main-session.js');
    ok(/store\.setJoins\(GristBI\.tableGraph\.sanitizeJoins\(saved\.joins, currentBlend \? \[currentBlend\.secondaryTableId\] : \[\]\)\)/.test(main), 'le chargement d\'un rapport nettoie ses jointures (alias du réglage manuel réservé)');
    ok(/GristBI\.tableGraph\.allJoins\(blend, store\.getState\(\)\.joins\)/.test(main) && /GristBI\.data\.applyJoins\(/.test(main), 'applyBlend joue le réglage manuel puis les jointures');
    ok(/const seq = \+\+applySeq;/.test(main) && /if \(seq !== applySeq\) return;/.test(main), 'une réponse périmée n\'écrit rien');
    ok(/scheduleSave\(state\.pages, state\.currentPageId, state\.bookmarks, state\.blend, state\.dashStyle, state\.dashStyleOptions, state\.joins\)/.test(main) && /state\.joins !== lastRenderedJoins/.test(main), 'un changement de jointure planifie la sauvegarde');
    ok(/p\.dashStyleOptions, p\.joins\)/.test(main), 'la sauvegarde planifiée écrit les jointures capturées au moment du geste');
    ok(/joinTableCache\.clear\(\)/.test(session) && /joinTableCache\.delete\(tableId\)/.test(session), 'les tables jointes sont lues une fois, relues au rechargement et après un échec');
    ok(/await refreshLinkSchema\(tableId\)/.test(session), 'le schéma des liens est relu à chaque changement de table de travail');
    // Retirer une jointure encore lue : refusé, dit, rien ne change.
    ok(/GristBI\.tableGraph\.removeJoin\(state\.joins, alias\)/.test(session) && /GristBI\.tableGraph\.usageOf\(state, removal\.removed,/.test(session), 'le retrait passe par removeJoin et usageOf');
    ok(/if \(use\.tiles \|\| use\.filters \|\| use\.bookmarks\) \{\s*joinsNoteEl\.textContent = t\('joins\.inUse'/.test(session), 'une jointure encore lue par des tuiles, des filtres ou des vues est refusée, avec ce qui la lit');
    ok(/store\.setJoins\(removal\.joins\);\s*applyBlend\(currentBlend\);/.test(session), 'sinon : la liste change, les lignes sont refaites');
    ok(/const key = JSON\.stringify\(joins\) \+ '\|' \+ GristBI\.i18n\.getLang\(\);\s*if \(key === joinsShownKey\) return;/.test(session), 'la liste n\'est redessinée que si elle change');
    ok(/escapeHtml\(j\.alias\)/.test(session) && /escapeHtml\(t\('joins\.via'/.test(session), 'alias et colonne écrits échappés');
    ['joins.title', 'joins.via', 'joins.remove.aria', 'joins.remove.title', 'joins.inUse', 'joins.full'].forEach((k) => {
      assert.ok(i18n.STRINGS[k] && i18n.STRINGS[k].fr && i18n.STRINGS[k].en, `clé ${k} en fr et en`);
    });
    ['fr', 'en'].forEach((lang) => {
      i18n.setLang(lang);
      [['joins.via', { column: 'Client' }], ['joins.remove.aria', { alias: 'Clients' }], ['joins.inUse', { alias: 'Clients', tiles: 1, filters: 2, views: 0 }], ['joins.inUse', { alias: 'Clients', tiles: 2, filters: 1, views: 1 }], ['joins.full', { max: 12 }]].forEach(([k, vars]) => {
        const s = i18n.t(k, vars);
        assert.ok(s && !/[{}]|NaN|undefined/.test(s), `${lang} ${k} : « ${s} »`);
      });
    });
    i18n.setLang('fr');
    ok(/1 tuile,/.test(i18n.t('joins.inUse', { alias: 'C', tiles: 1, filters: 2, views: 0 })) && /2 tuiles,/.test(i18n.t('joins.inUse', { alias: 'C', tiles: 2, filters: 1, views: 1 })), 'les pluriels suivent le nombre');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
    ['.joins-item-name', '.joins-note'].forEach((sel) => assert.ok(css.indexOf(sel) !== -1, `style.css : ${sel}`));
    // Le module est pur : ni DOM, ni Grist, ni horloge, ni hasard, ni texte en dur.
    const code = graphSource.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
    ['document', 'window', 'grist.', 'localStorage', 'Date.now', 'new Date', 'Math.random', 'eval(', 'new Function', 'innerHTML', 'fetch('].forEach((bad) => assert.ok(code.indexOf(bad) === -1, `js/table-graph.js est pur : « ${bad} »`));
    assert.ok(!/[àâçéèêëîïôûùü]/i.test(code), 'aucune lettre accentuée hors des commentaires : pas de texte en dur');
    assert.ok(graphSource.split('\n').length <= 600, 'au plus 600 lignes');
    console.log('OK câblage — ordre des scripts, liste « Tables liées » (échappée, refus d\'un retrait encore lu), sauvegarde, schéma relu, clés fr/en et pluriels, fichier pur');
  }

  console.log(`\nOK — tables liées par les Références : tous les essais passent (${checks} vérifications)`);
})().catch((e) => { console.error(e); process.exit(1); });
