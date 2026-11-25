/*
 * Les DEUX jeux de noms des colonnes de `BI_Dashboard_Config` (consigne GFS 030, 25/11/2026 : « tout en anglais partout, aucun document perdu,
 * pas de table de plus », GFS lit les deux jeux sans date de fin). Les documents déjà en service ont les noms d'avant (`Nom`, `TypeRapport`,
 * `DateModif`, `ModifiePar`) ; ce widget écrit désormais `Name`, `ReportType`, `ModifiedAt`, `ModifiedBy`, et la fenêtre commune de mise à jour
 * des noms du kit (`kit/js/names-update/`, voir `js/main-session.js:runNamesUpdate`) passe un document de l'un à l'autre, sur place et un seul lot.
 * Tant qu'un document n'a pas été mis à jour (personne qui n'est pas propriétaire, fenêtre refusée, lecture seule), le widget continue SUR LES NOMS
 * QUE LE DOCUMENT A : il les lit tous, colonne par colonne, jamais par jeu.
 *
 * Ce module est PUR (UMD, testable sous Node), sans DOM ni Grist :
 *  - `resolve(ids)` : pour chacune des quatre colonnes logiques (`name`, `reportType`, `modifiedAt`, `modifiedBy`), quels noms le document porte (le
 *    nouveau d'abord, puis l'ancien), lequel on écrit (le premier présent ; le nouveau s'il n'y en a aucun) et si la colonne manque tout à fait ;
 *  - `cell`/`values` : la valeur d'une cellule (le premier nom NON VIDE, nouveau d'abord : un document qui porte les deux jeux se lit réuni) ;
 *  - `fieldsFor(cols, valeurs)` : les champs d'un `AddRecord`/`UpdateRecord` sous les noms que le document a maintenant ;
 *  - `renamePlan(schema)` : le lot `RenameColumn` de la fenêtre commune, d'après les noms que le document a MAINTENANT (un autre onglet a pu passer
 *    avant : le kit le rappelle sur un schéma relu juste avant d'envoyer). Une colonne dont les DEUX noms existent n'est jamais renommée (Grist
 *    ajouterait « 2 » au nom pris, faits vérifiés de GFS 158) : c'est le cas « les deux jeux », réuni par `mergePlan` après confirmation ;
 *  - `isNameError(erreur)` : une écriture a-t-elle échoué parce qu'un nom a disparu entre-temps (un renommage venu d'un autre onglet) ?
 *
 * Ce que ce module NE fait PAS : aucune écriture, aucune création de colonne (c'est `js/grist-api.js`), aucune détection de Sync+ (c'est le kit :
 * `outcome.held`). Seule `BI_Dashboard_Config` porte des noms français : les colonnes de `BI_Dashboard_Comments` (`TableId`, `TileId`, `Author`,
 * `Text`, `CreatedAt`) et de `BI_Dashboard_UserProbe` (`Email`) sont déjà anglaises, et aucune table n'est renommée.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.configNames = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG_TABLE = 'BI_Dashboard_Config';
  // Colonne logique -> [nom d'aujourd'hui (anglais), nom d'avant (français)]. L'ordre est celui de la préférence : on lit et on écrit le premier présent.
  const NAMES = {
    name: ['Name', 'Nom'], // nom du rapport (affiché et renommable dans l'explorateur de GFS et dans ce widget)
    reportType: ['ReportType', 'TypeRapport'], // toujours 'rapport' pour les lignes posées par ce widget (la VALEUR ne change pas)
    modifiedAt: ['ModifiedAt', 'DateModif'], // secondes depuis l'epoch UTC (DateTime)
    modifiedBy: ['ModifiedBy', 'ModifiePar'] // adresse détectée, ou « Nom <adresse> »
  };
  const KEYS = Object.keys(NAMES);
  const lower = (value) => String(value == null ? '' : value).toLowerCase();

  // Les noms du document -> pour chaque colonne logique : { ids (ceux que le document porte, nouveau d'abord, avec LEUR casse), write (celui qu'on écrit),
  // present (le document en porte au moins un), both (il porte les deux jeux) }. Grist ne distingue pas les capitales : tout se compare en minuscules.
  function resolve(columnIds) {
    const byLower = new Map((columnIds || []).map((id) => [lower(id), id]));
    const out = {};
    for (const key of KEYS) {
      const ids = NAMES[key].filter((name) => byLower.has(lower(name))).map((name) => byLower.get(lower(name)));
      out[key] = { ids, write: ids.length ? ids[0] : NAMES[key][0], present: ids.length > 0, both: ids.length > 1 };
    }
    return out;
  }

  const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0);

  // La valeur de la ligne `index` : le premier nom non vide, le nouveau d'abord. `table` = ce que `fetchTable` rend (colonnes).
  function cell(table, cols, key, index) {
    for (const id of cols[key].ids) {
      const column = table && table[id];
      if (column && !isEmpty(column[index])) return column[index];
    }
    return '';
  }

  // Toutes les valeurs non vides de la colonne logique, dans l'ordre des lignes (les deux jeux réunis) : de quoi proposer un nom qui n'est pris par personne.
  function values(table, cols, key) {
    const count = ((table && table.id) || []).length;
    const out = [];
    for (let i = 0; i < count; i++) {
      const value = cell(table, cols, key, i);
      if (value !== '') out.push(value);
    }
    return out;
  }

  // Les champs d'une écriture, sous les noms que le document a maintenant. `logical` : { name, reportType, modifiedAt, modifiedBy, ConfigJSON, TableId… } ; une
  // clé logique est écrite sous `cols[clé].write`, toute autre clé (`TableId`, `ConfigJSON`) telle quelle.
  function fieldsFor(cols, logical) {
    const out = {};
    for (const key of Object.keys(logical)) {
      if (logical[key] === undefined) continue;
      out[Object.hasOwn(cols, key) ? cols[key].write : key] = logical[key];
    }
    return out;
  }

  // Les colonnes de `AddTable`/`AddColumn` d'aujourd'hui : TableId, ConfigJSON, puis les quatre noms anglais (types comme avant le passage à l'anglais).
  const TYPES = { name: 'Text', reportType: 'Text', modifiedAt: 'DateTime', modifiedBy: 'Text' };
  function newColumns() {
    return [{ id: 'TableId', type: 'Text' }, { id: 'ConfigJSON', type: 'Text' }]
      .concat(KEYS.map((key) => ({ id: NAMES[key][0], type: TYPES[key] })));
  }

  function configEntry(schema) {
    const tables = (schema && schema.tables) || {};
    const id = Object.keys(tables).find((table) => lower(table) === lower(CONFIG_TABLE));
    return id === undefined ? null : { id, columns: tables[id] || [] };
  }

  // Le lot de la fenêtre commune : un `RenameColumn` par colonne dont seul l'ancien nom existe. Rien à faire -> [].
  function renamePlan(schema) {
    const entry = configEntry(schema);
    if (!entry) return [];
    const cols = resolve(entry.columns);
    const actions = [];
    for (const key of KEYS) {
      const [fresh, old] = NAMES[key];
      const have = new Set(cols[key].ids.map(lower));
      if (have.has(lower(old)) && !have.has(lower(fresh))) {
        actions.push(['RenameColumn', entry.id, cols[key].ids.find((id) => lower(id) === lower(old)), fresh]);
      }
    }
    return actions;
  }

  // Les colonnes qui portent les DEUX jeux (« Réunir », avec confirmation) : leurs clés logiques.
  function bothSets(schema) {
    const entry = configEntry(schema);
    if (!entry) return [];
    const cols = resolve(entry.columns);
    return KEYS.filter((key) => cols[key].both);
  }

  // « Réunir » : pour chaque colonne logique qui porte les deux jeux, les valeurs de l'ancien nom copiées dans le nouveau là où celui-ci est VIDE (jamais l'inverse,
  // jamais écraser une valeur). Rend les actions (un BulkUpdateRecord par colonne qui en a besoin) ; l'ancienne colonne reste en place : ce widget ne supprime jamais
  // de colonne, et GFS lit les deux jeux. `table` = `fetchTable(CONFIG_TABLE)`.
  function mergePlan(table, columnIds) {
    const cols = resolve(columnIds || Object.keys(table || {}).filter((id) => id !== 'id'));
    const rowIds = (table && table.id) || [];
    const actions = [];
    for (const key of KEYS) {
      if (!cols[key].both) continue;
      const [fresh, old] = cols[key].ids;
      const ids = [];
      const vals = [];
      rowIds.forEach((rowId, i) => {
        if (isEmpty(table[fresh] && table[fresh][i]) && !isEmpty(table[old] && table[old][i])) { ids.push(rowId); vals.push(table[old][i]); }
      });
      if (ids.length) actions.push(['BulkUpdateRecord', CONFIG_TABLE, ids, { [fresh]: vals }]);
    }
    return actions;
  }

  // Une écriture refusée parce qu'un nom a disparu (« table introuvable », « colonne introuvable », un renommage passé dans un autre onglet) ? Le texte exact de
  // Grist n'a pas été relevé sur un vrai document : on reconnaît large (français, anglais, `KeyError` du moteur Python) plutôt que de rater le cas.
  const NAME_ERROR = /introuvable|not found|invalid column|invalid table|unknown (column|table)|no such (column|table)|does not exist|keyerror/i;
  function isNameError(error) {
    const text = String((error && (error.message || error.error || error)) || '');
    return NAME_ERROR.test(text);
  }

  return { CONFIG_TABLE, NAMES, KEYS, resolve, cell, values, fieldsFor, newColumns, renamePlan, bothSets, mergePlan, isNameError };
});
