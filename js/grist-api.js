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
  // Suffixée par un numéro de schéma : `ensureDemoTableExists` ne crée la table QUE si son nom
  // n'existe pas encore, elle ne migre jamais les colonnes d'une table déjà présente. Sans ce
  // suffixe, ajouter une colonne à GristBI.demoData.COLUMNS (ex. "Annee") casserait la génération
  // chez quiconque avait déjà une ancienne BI_Demo_Ventes dans son document (AddRecord échoue avec
  // "KeyError" sur la colonne manquante côté Grist) - vécu en pratique, pas juste théorique.
  // Incrémenter ce numéro à chaque changement de GristBI.demoData.COLUMNS plutôt que d'introduire
  // une logique de migration de schéma (AddColumn n'est pas un verbe éprouvé ici, voir HYPOTHESES.md).
  const DEMO_TABLE_SCHEMA_VERSION = 2;
  const DEMO_TABLE = 'BI_Demo_Ventes_v' + DEMO_TABLE_SCHEMA_VERSION;

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

  async function ensureDemoTableExists() {
    if (await tableExists(DEMO_TABLE)) return;
    await grist.docApi.applyUserActions([['AddTable', DEMO_TABLE, GristBI.demoData.COLUMNS]]);
    _rawTables.push(DEMO_TABLE);
  }

  // Vide la table de démo ligne par ligne (RemoveRecord, déjà validé côté publipostageGrist)
  // plutôt que RemoveTable+AddTable : évite d'introduire un verbe d'action non éprouvé ici.
  async function clearDemoTableRows() {
    const data = await grist.docApi.fetchTable(DEMO_TABLE);
    const ids = (data && data.id) || [];
    if (!ids.length) return;
    await grist.docApi.applyUserActions(ids.map((id) => ['RemoveRecord', DEMO_TABLE, id]));
  }

  // (Re)génère la table de démo avec un jeu de données neuf. N'affecte que BI_Demo_Ventes,
  // jamais la table liée réelle de l'utilisateur.
  async function generateDemoData() {
    await ensureDemoTableExists();
    await clearDemoTableRows();
    const rows = GristBI.demoData.buildSampleRows();
    const actions = rows.map((row) => {
      const fields = {};
      for (const col of GristBI.demoData.COLUMNS) fields[col.id] = row[col.id];
      return ['AddRecord', DEMO_TABLE, null, fields];
    });
    await grist.docApi.applyUserActions(actions);
    const table = await grist.docApi.fetchTable(DEMO_TABLE);
    return { tableId: DEMO_TABLE, rows: GristBI.data.tableToRows(table) };
  }

  GristBI.api = { init, loadConfig, saveConfig, generateDemoData };
})(window);
