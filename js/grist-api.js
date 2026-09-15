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

  async function loadConfig(tableId) {
    try {
      await ensureConfigTableExists();
      const data = await grist.docApi.fetchTable(CONFIG_TABLE);
      const ids = (data && data.id) || [];
      for (let i = 0; i < ids.length; i++) {
        if (data.TableId[i] === tableId) {
          _configRowIdByTable[tableId] = ids[i];
          try { return JSON.parse(data.ConfigJSON[i] || '[]'); } catch (e) { return []; }
        }
      }
    } catch (e) {
      console.warn('[GristBI] loadConfig: lecture impossible', e);
    }
    return [];
  }

  async function saveConfig(tableId, tiles) {
    if (!tableId) return;
    await ensureConfigTableExists();
    const json = JSON.stringify(tiles);
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

  GristBI.api = { init, loadConfig, saveConfig };
})(window);
