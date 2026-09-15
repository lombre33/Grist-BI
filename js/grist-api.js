/*
 * Glue vers l'API Grist Custom Widget. Patterns repris (et simplifiés) du widget
 * publipostageGrist du même auteur : grist.ready({requiredAccess:'full'}), grist.onRecords()
 * pour la table liée, et une table interne cachée (préfixe "BI_") pour persister la config —
 * même mécanisme que Publipostage_Modeles/Publipostage_LiensTables, dont on sait qu'il fonctionne
 * en Grist réel. Voir HYPOTHESES.md pour ce qui reste à valider (ex. grist.setOptions() comme
 * alternative plus simple, non testée ici).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const CONFIG_TABLE = 'BI_Dashboard_Config';
  // Suffixée par un numéro de schéma : `loadOrCreateTable` ne crée la table QUE si son nom
  // n'existe pas encore, elle ne migre jamais les colonnes d'une table déjà présente. Sans ce
  // suffixe, ajouter une colonne à GristBI.demoData.COLUMNS (ex. "Annee") casserait la génération
  // chez quiconque avait déjà une ancienne BI_Demo_Ventes dans son document (AddRecord échoue avec
  // "KeyError" sur la colonne manquante côté Grist) - vécu en pratique, pas juste théorique.
  // Incrémenter ce numéro à chaque changement de GristBI.demoData.COLUMNS plutôt que d'introduire
  // une logique de migration de schéma (AddColumn n'est pas un verbe éprouvé ici, voir HYPOTHESES.md).
  const DEMO_TABLE_SCHEMA_VERSION = 3; // v3 : ajout de la colonne Semaine (drill-down à 2 niveaux)
  const DEMO_TABLE = 'BI_Demo_Ventes_v' + DEMO_TABLE_SCHEMA_VERSION;
  // Table séparée pour le test de charge (gros volume) : même schéma de colonnes que DEMO_TABLE
  // (voir GristBI.demoData.COLUMNS, partagé), mais un nom et un cycle de vie indépendants pour ne
  // jamais interférer avec la démo "rapide" ci-dessus.
  const STRESS_TABLE_SCHEMA_VERSION = 1;
  const STRESS_TABLE = 'BI_StressTest_v' + STRESS_TABLE_SCHEMA_VERSION;
  // Nombre d'actions envoyées par appel à applyUserActions() lors d'une génération/suppression en
  // masse : un seul appel avec des dizaines de milliers d'actions est un pari risqué (timeout,
  // limite de payload côté Grist - aucune des deux non testée ici, voir HYPOTHESES.md) ; les
  // envoyer par lots donne aussi une progression visible à l'utilisateur plutôt qu'une attente
  // opaque.
  const ACTION_CHUNK_SIZE = 2000;

  let _rawTables = null;
  let _configRowIdByTable = {};

  async function init(handlers) {
    if (typeof grist === 'undefined') {
      console.warn('[GristBI] grist-plugin-api.js indisponible (widget ouvert hors Grist ?).');
      return;
    }
    try {
      grist.ready({ requiredAccess: 'full' });
    } catch (e) {
      console.error('[GristBI] grist.ready() a échoué', e);
    }
    grist.onRecords((records, mappings) => {
      const tableId = (mappings && mappings.tableId) || null;
      handlers.onRows(records || [], tableId);
    });
  }

  async function listAllTablesCached() {
    if (!_rawTables) _rawTables = (await grist.docApi.listTables()) || [];
    return _rawTables;
  }

  async function ensureConfigTableExists() {
    const tables = await listAllTablesCached();
    const exists = tables.some((t) => (typeof t === 'string' ? t : t.id) === CONFIG_TABLE);
    if (exists) return;
    await grist.docApi.applyUserActions([
      ['AddTable', CONFIG_TABLE, [
        { id: 'TableId', type: 'Text' },
        { id: 'ConfigJSON', type: 'Text' }
      ]]
    ]);
    _rawTables.push(CONFIG_TABLE);
  }

  // Le format sauvegardé a changé (voir ci-dessous) : normalise l'ancien format (un simple tableau
  // de tuiles, avant l'ajout des bookmarks) aussi bien que le nouveau `{tiles, bookmarks}`, pour ne
  // pas casser la lecture d'une config déjà sauvegardée par une version antérieure du widget - même
  // classe de problème que le schéma de BI_Demo_Ventes (voir DEMO_TABLE_SCHEMA_VERSION), mais réglée
  // ici en JS pur puisque ConfigJSON est un blob texte, pas des colonnes Grist typées.
  function normalizeConfig(raw) {
    if (Array.isArray(raw)) return { tiles: raw, bookmarks: [] };
    if (raw && typeof raw === 'object') return { tiles: raw.tiles || [], bookmarks: raw.bookmarks || [] };
    return { tiles: [], bookmarks: [] };
  }

  async function loadConfig(tableId) {
    try {
      await ensureConfigTableExists();
      const data = await grist.docApi.fetchTable(CONFIG_TABLE);
      const ids = (data && data.id) || [];
      for (let i = 0; i < ids.length; i++) {
        if (data.TableId[i] === tableId) {
          _configRowIdByTable[tableId] = ids[i];
          try { return normalizeConfig(JSON.parse(data.ConfigJSON[i] || '[]')); }
          catch (e) { return { tiles: [], bookmarks: [] }; }
        }
      }
    } catch (e) {
      console.warn('[GristBI] loadConfig: lecture impossible', e);
    }
    return { tiles: [], bookmarks: [] };
  }

  async function saveConfig(tableId, tiles, bookmarks) {
    if (!tableId) return;
    await ensureConfigTableExists();
    const json = JSON.stringify({ tiles, bookmarks: bookmarks || [] });
    let rowId = _configRowIdByTable[tableId];
    if (!rowId) {
      // Config jamais sauvegardée depuis le chargement du widget : revérifie qu'une ligne
      // n'existe pas déjà côté doc (créée par une session précédente) avant d'en ajouter une.
      const data = await grist.docApi.fetchTable(CONFIG_TABLE);
      const ids = (data && data.id) || [];
      for (let i = 0; i < ids.length; i++) {
        if (data.TableId[i] === tableId) rowId = ids[i];
      }
    }
    if (rowId) {
      await grist.docApi.applyUserActions([['UpdateRecord', CONFIG_TABLE, rowId, { ConfigJSON: json }]]);
    } else {
      const result = await grist.docApi.applyUserActions([
        ['AddRecord', CONFIG_TABLE, null, { TableId: tableId, ConfigJSON: json }]
      ]);
      rowId = result.retValues[0];
    }
    _configRowIdByTable[tableId] = rowId;
  }

  async function tableExists(tableId) {
    const tables = await listAllTablesCached();
    return tables.some((t) => (typeof t === 'string' ? t : t.id) === tableId);
  }

  async function ensureTableExists(tableId, columns) {
    if (await tableExists(tableId)) return;
    await grist.docApi.applyUserActions([['AddTable', tableId, columns]]);
    _rawTables.push(tableId);
  }

  // Envoie `actions` par lots de `ACTION_CHUNK_SIZE` plutôt qu'en un seul appel géant - voir la
  // justification au niveau d'ACTION_CHUNK_SIZE. `onProgress(phase, sent, total)` est appelé après
  // chaque lot (facultatif), pour afficher une progression réelle plutôt qu'un bouton figé.
  async function applyActionsInChunks(phase, actions, onProgress) {
    for (let i = 0; i < actions.length; i += ACTION_CHUNK_SIZE) {
      const chunk = actions.slice(i, i + ACTION_CHUNK_SIZE);
      await grist.docApi.applyUserActions(chunk);
      if (onProgress) onProgress(phase, Math.min(i + ACTION_CHUNK_SIZE, actions.length), actions.length);
    }
  }

  async function fillTable(tableId, rows, columns, onProgress) {
    const actions = rows.map((row) => {
      const fields = {};
      for (const col of columns) fields[col.id] = row[col.id];
      return ['AddRecord', tableId, null, fields];
    });
    await applyActionsInChunks('fill', actions, onProgress);
  }

  // Se connecte à une table de données de démo/test de charge : la CRÉE et la REMPLIT seulement
  // si elle n'existe pas encore, sinon se contente de la relire telle quelle. Volontairement
  // idempotent — cliquer plusieurs fois sur "Générer" ne doit pas renvoyer des dizaines de milliers
  // de lignes à Grist à chaque fois une fois que la table existe déjà. Si le jeu de données doit
  // changer plus tard, le mécanisme est une nouvelle version de schéma (voir
  // DEMO_TABLE_SCHEMA_VERSION/STRESS_TABLE_SCHEMA_VERSION plus haut : une table du nom courant
  // n'existe pas encore -> génération fraîche), pas une régénération en place.
  async function loadOrCreateTable(tableId, columns, buildRows, onProgress) {
    const alreadyExists = await tableExists(tableId);
    await ensureTableExists(tableId, columns);
    if (!alreadyExists) await fillTable(tableId, buildRows(), columns, onProgress);
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table), created: !alreadyExists };
  }

  function loadOrCreateDemoData(onProgress) {
    return loadOrCreateTable(DEMO_TABLE, GristBI.demoData.COLUMNS, GristBI.demoData.buildSampleRows, onProgress);
  }

  function loadOrCreateStressData(onProgress) {
    return loadOrCreateTable(STRESS_TABLE, GristBI.demoData.COLUMNS_LARGE, GristBI.demoData.buildLargeSampleRows, onProgress);
  }

  GristBI.api = { init, loadConfig, saveConfig, loadOrCreateDemoData, loadOrCreateStressData };
})(window);
