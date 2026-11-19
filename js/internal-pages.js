/*
 * Rangement des PAGES des tables internes de ce widget (demande d'Antoine, 19/11/2026, pour la bêta : « avoir les tables plutôt sous une
 * table principale pour ne pas avoir tout ça qui se suit et qui gêne, et fermer par défaut »).
 *
 * Pourquoi : `AddTable` (js/grist-api.js) fait créer à Grist, pour CHAQUE table, une page de plus au bout de la liste de gauche
 * (`sandbox/grist/useractions.py:doAddView`, vérifié sur un vrai Grist : `retValues[0].views` rend la vue créée, et une ligne de
 * `_grist_Pages` est ajoutée à l'indentation 0). Les trois tables internes (`BI_Dashboard_Config`, `BI_Dashboard_Comments`,
 * `BI_Dashboard_UserProbe`) s'intercalent donc entre les vraies pages du document. Ce module calcule les actions qui les rangent en
 * SOUS-PAGES d'une page « parente », REPLIÉE par défaut. Rien n'est supprimé ni renommé : les tables restent aussi dans « Données brutes ».
 *
 * Ce que Grist permet (lu dans grist-core, `app/client/models/TreeModel.ts` et `entities/PageRec.ts`, puis rejoué dans un vrai Grist) :
 *  - l'arbre des pages est la table `_grist_Pages`, triée par `pagePos` ; une page est l'enfant de la page précédente qui a une
 *    `indentation` plus faible (le client ramène lui-même toute indentation à « au plus +1 par ligne », `fixIndents`) ;
 *  - un `pagePos` égal à celui d'une autre page insère AVANT elle (colonne `PositionNumber`), `null` ajoute à la fin : c'est ce que fait
 *    le glisser-déposer du client (`TreeNodeRecord.insertBefore`) ; plusieurs lignes d'un même `BulkUpdateRecord` visant la même position
 *    gardent leur ordre ; ce module préfère pourtant des positions explicites (voir `plan`, course avec `AddTable`) ;
 *  - « replié par défaut » est `{"collapsed": true}` dans `_grist_Pages.options` de la page PARENTE (Grist 1.7.0 et suivants, `PageRec.
 *    isCollapsedByDefault` ; une version plus ancienne l'ignore et montre les sous-pages dépliées, sans rien casser).
 *  Le widget ne peut PAS passer par `grist.setOption` pour retenir quoi que ce soit : une option posée ainsi n'est qu'un état de la
 *  session, jamais enregistré tant que la personne n'a pas cliqué « Enregistrer » dans le menu de la section (`customValue`).
 *
 * Règles (toutes testées, `dev-tests/test-internal-pages.js`) :
 *  1. UNE SEULE FOIS par page : une page rangée reçoit `{"gristBiInternal": true}` dans ses `options` et n'est plus JAMAIS touchée —
 *     si la personne la sort ensuite du groupe, elle reste où elle l'a mise. Une page neuve (table qui vient d'être créée) n'a pas la
 *     marque : elle est rangée au prochain appel. Le calcul est donc idempotent (rien à faire = aucune action).
 *  2. Le parent, dans l'ordre : le parent d'un groupe DÉJÀ formé (une page marquée avec une indentation > 0) ; sinon la page qui contient
 *     CE widget (ses sections `custom` dont l'adresse est la sienne : `customView.url` ou `customView.widgetDef.url`, comparées sans
 *     requête, sans `index.html` final, sans barre finale ; la première par position si plusieurs) ; sinon, en dernier recours — dans GFS
 *     le cadre n'a pas l'adresse que Grist connaît — la page de `BI_Dashboard_Config`, qui devient le « dossier ». Jamais une page de table
 *     interne comme parent d'une AUTRE sauf ce dernier recours.
 *  3. « Replié » n'est posé que sur un parent SANS enfant jusque-là et sans état `collapsed` explicite : on ne cache jamais les sous-pages
 *     de la personne ni ne défait son choix.
 *  4. Une page qui a déjà des sous-pages part AVEC elles (comme le client) ; une page qui contient le parent n'est pas déplacée.
 *
 * Pur JS, testable sous Node (UMD), sans DOM ni Grist : `plan({ tables, pages, sections, selfUrl })` reçoit les tables telles que
 * `fetchTable` les rend (colonnes) et renvoie les actions utilisateur à appliquer. `js/grist-api.js:organizeInternalPages` lit, applique,
 * et attrape toute erreur (droits insuffisants, GFS qui refuse l'écriture des tables système) sans jamais gêner le reste du widget.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.internalPages = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Dans l'ordre où elles s'affichent sous le parent (même ordre que leur création usuelle).
  const INTERNAL_TABLE_IDS = ['BI_Dashboard_Config', 'BI_Dashboard_Comments', 'BI_Dashboard_UserProbe'];
  const MARK_KEY = 'gristBiInternal';
  const PAGES_TABLE = '_grist_Pages';

  // `fetchTable` rend des colonnes ({id: [...], viewRef: [...]}) : en lignes, sans jamais lever sur une table absente ou mal formée.
  function rows(columnar) {
    if (!columnar || typeof columnar !== 'object' || !Array.isArray(columnar.id)) return [];
    const keys = Object.keys(columnar).filter((k) => Array.isArray(columnar[k]));
    return columnar.id.map((id, i) => {
      const row = { id };
      for (const k of keys) if (k !== 'id') row[k] = columnar[k][i];
      return row;
    });
  }

  // Un objet JSON, ou `{}` pour tout le reste (texte vide, invalide, tableau, nombre...) : une cellule de `options` écrite par quelqu'un
  // d'autre ne doit jamais faire échouer le rangement.
  function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  // `hôte/chemin` sans protocole, requête, ancre, `index.html` final ni barre finale ; '' si ce n'est pas une adresse http(s).
  function normalizeWidgetUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    let url;
    try {
      url = new URL(value.trim());
    } catch (e) {
      return '';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const path = url.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
    return url.host.toLowerCase() + path;
  }

  // Les adresses sous lesquelles Grist connaît le widget d'une section : celle saisie (« Custom URL ») et celle du manifeste d'un widget
  // de la galerie. `customView` est un texte JSON dans le JSON de `options` (forme écrite par Grist) ; un objet est aussi accepté.
  function widgetUrlsOf(section) {
    const options = parseJsonObject(section && section.options);
    const customView = parseJsonObject(options.customView);
    const def = parseJsonObject(customView.widgetDef);
    return [customView.url, def.url].map(normalizeWidgetUrl).filter(Boolean);
  }

  function toInteger(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  // Les pages dans l'ordre de l'arbre, avec l'indentation effective : comme `fixIndents` du client, la première est à 0 et chaque ligne
  // a au plus une indentation de plus que la précédente (une indentation incohérente en base ne casse donc pas le calcul).
  function treeOf(pagesColumnar) {
    const list = rows(pagesColumnar)
      .map((r) => ({
        id: Number(r.id),
        viewRef: Number(r.viewRef),
        pagePos: Number(r.pagePos),
        indentation: toInteger(r.indentation),
        options: typeof r.options === 'string' ? r.options : ''
      }))
      .filter((p) => Number.isFinite(p.id) && Number.isFinite(p.pagePos))
      .sort((a, b) => a.pagePos - b.pagePos || a.id - b.id);
    let maxNext = 0;
    for (const p of list) {
      p.level = Math.min(maxNext, p.indentation);
      maxNext = p.level + 1;
    }
    return list;
  }

  const isMarked = (page) => parseJsonObject(page.options)[MARK_KEY] === true;

  // Les pages des tables internes : une par table qui a encore sa page (`_grist_Tables.primaryViewId` = la vue de la page).
  function internalPagesOf(tablesColumnar, tree, tableIds) {
    const primaryViewOf = {};
    for (const t of rows(tablesColumnar)) primaryViewOf[t.tableId] = Number(t.primaryViewId);
    const found = [];
    for (const tableId of tableIds) {
      const view = primaryViewOf[tableId];
      const page = view > 0 ? tree.find((p) => p.viewRef === view) : null;
      if (page) found.push({ tableId, page });
    }
    return found;
  }

  // La page de l'arbre qui contient une section `custom` de CE widget (première par position), hors pages de tables internes.
  function hostPageOf(sectionsColumnar, tree, selfUrl, excludedIds) {
    const self = normalizeWidgetUrl(selfUrl);
    if (!self) return null;
    const viewsWithWidget = new Set();
    for (const s of rows(sectionsColumnar)) {
      if (s.parentKey === 'custom' && widgetUrlsOf(s).includes(self)) viewsWithWidget.add(Number(s.parentId));
    }
    return tree.find((p) => viewsWithWidget.has(p.viewRef) && !excludedIds.has(p.id)) || null;
  }

  // Le parent d'un groupe déjà formé : la page précédente d'indentation plus faible, pour la première page marquée qui n'est pas à la racine.
  function groupParentOf(tree, internal) {
    for (const { page } of internal) {
      if (!isMarked(page) || page.level === 0) continue;
      const index = tree.indexOf(page);
      for (let i = index - 1; i >= 0; i--) if (tree[i].level < page.level) return tree[i];
    }
    return null;
  }

  const withOptions = (page, patch) => JSON.stringify({ ...parseJsonObject(page.options), ...patch });

  /*
   * `plan({ tables, pages, sections, selfUrl, internalTableIds? })` -> { actions, parent, how, nested, marked, collapsed }
   *  - `actions` : les actions utilisateur Grist à appliquer d'un seul appel (tableau vide = rien à ranger) ;
   *  - `parent` : l'id (ligne de `_grist_Pages`) de la page parente retenue, `null` si aucune ;
   *  - `how` : 'group' (groupe déjà formé), 'dashboard' (la page de ce widget) ou 'config' (dernier recours) ;
   *  - `nested` / `marked` : les pages déplacées / marquées ; `collapsed` : le parent est replié par ce plan.
   */
  function plan(input) {
    const none = { actions: [], parent: null, how: null, nested: [], marked: [], collapsed: false };
    const source = input || {};
    const tableIds = Array.isArray(source.internalTableIds) && source.internalTableIds.length ? source.internalTableIds : INTERNAL_TABLE_IDS;
    const tree = treeOf(source.pages);
    if (!tree.length) return none;
    const internal = internalPagesOf(source.tables, tree, tableIds);
    if (!internal.length) return none;
    const internalIds = new Set(internal.map((it) => it.page.id));

    // 1. Le parent.
    let parent = groupParentOf(tree, internal);
    let how = parent ? 'group' : null;
    if (!parent) {
      parent = hostPageOf(source.sections, tree, source.selfUrl, internalIds);
      how = parent ? 'dashboard' : null;
    }
    if (!parent) {
      const config = internal.find((it) => it.tableId === tableIds[0]);
      parent = config ? config.page : null;
      how = parent ? 'config' : null;
    }
    if (!parent) return none;

    // 2. Ce qui reste à ranger : les pages internes encore sans marque ; le parent lui-même (dossier de dernier recours) est seulement marqué.
    const pending = internal.map((it) => it.page).filter((p) => !isMarked(p));
    if (!pending.length) return none;

    const parentIndex = tree.indexOf(parent);
    let subtreeEnd = parentIndex + 1;
    while (subtreeEnd < tree.length && tree[subtreeEnd].level > parent.level) subtreeEnd++;
    const hadChildren = subtreeEnd > parentIndex + 1;

    const markOnly = []; // déjà sous le parent, ou le parent lui-même : seulement marquées
    const blocks = []; // à déplacer : la page et ses sous-pages
    for (const page of pending) {
      const index = tree.indexOf(page);
      if (page === parent || (index > parentIndex && index < subtreeEnd)) {
        markOnly.push(page);
        continue;
      }
      let end = index + 1;
      while (end < tree.length && tree[end].level > page.level) end++;
      const block = tree.slice(index, end);
      if (block.includes(parent)) continue; // le parent est DANS cette page : jamais la déplacer dans elle-même
      blocks.push(block);
    }

    // Rien à ranger tant que le seul candidat est le dossier lui-même (dernier recours) : on n'écrit pas dans le document pour rien ; la
    // marque et l'état replié viendront avec la première page qui s'y range.
    if (!blocks.length && markOnly.every((p) => p === parent)) return { ...none, parent: parent.id, how };

    const moving = new Set(blocks.flat().map((p) => p.id));
    // Insérer AVANT la première page qui suit le sous-arbre du parent et ne part pas elle-même ; sinon à la fin (`null`).
    let before = null;
    for (let i = subtreeEnd; i < tree.length; i++) {
      if (!moving.has(tree[i].id)) {
        before = tree[i];
        break;
      }
    }

    const actions = [];
    if (blocks.length) {
      // Des positions EXPLICITES, réparties entre la dernière page du sous-arbre du parent et la page qui le suit (ou « + 1 » à la fin),
      // plutôt que « insérer avant X » ou `null` (= à la fin) : entre la lecture de l'arbre et l'application, `AddTable` peut avoir ajouté
      // la page d'une AUTRE table interne au bout de la liste (le widget en crée trois d'affilée au démarrage). Avec `null`, nos pages
      // passaient APRÈS elle et prenaient son indentation pour parent — constaté dans un vrai Grist (Comments rangée sous UserProbe). Une
      // position fixée dans l'intervalle reste devant, quoi qu'il arrive au bout de la liste.
      const records = blocks.flat();
      const lower = tree[subtreeEnd - 1].pagePos;
      const upper = before ? before.pagePos : lower + 1;
      const roomy = upper - lower > 1e-9;
      const ids = [];
      const levels = [];
      const positions = [];
      let rank = 0;
      for (const block of blocks) {
        for (const page of block) {
          rank++;
          ids.push(page.id);
          levels.push(parent.level + 1 + (page.level - block[0].level));
          positions.push(roomy ? lower + ((upper - lower) * rank) / (records.length + 1) : before ? before.pagePos : null);
        }
      }
      actions.push(['BulkUpdateRecord', PAGES_TABLE, ids, { indentation: levels, pagePos: positions }]);
    }

    // Les marques (une page rangée n'est plus jamais touchée) et, pour un parent neuf, l'état replié : une seule écriture de `options`.
    const collapse = !hadChildren && !('collapsed' in parseJsonObject(parent.options));
    const marked = [...blocks.map((b) => b[0]), ...markOnly];
    const patches = new Map(marked.map((page) => [page.id, { page, patch: { [MARK_KEY]: true } }]));
    if (collapse) {
      const entry = patches.get(parent.id) || { page: parent, patch: {} };
      entry.patch = { ...entry.patch, collapsed: true };
      patches.set(parent.id, entry);
    }
    const entries = [...patches.values()];
    actions.push(['BulkUpdateRecord', PAGES_TABLE, entries.map((e) => e.page.id), { options: entries.map((e) => withOptions(e.page, e.patch)) }]);

    return { actions, parent: parent.id, how, nested: blocks.map((b) => b[0].id), marked: marked.map((p) => p.id), collapsed: collapse };
  }

  return { INTERNAL_TABLE_IDS, MARK_KEY, plan, rows, parseJsonObject, normalizeWidgetUrl, widgetUrlsOf, treeOf };
});
