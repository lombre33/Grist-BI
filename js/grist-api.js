/*
 * Glue vers l'API Grist Custom Widget. Patterns repris (et simplifiés) du widget
 * publipostageGrist du même auteur : grist.ready({requiredAccess:'full'}) et des tables internes
 * cachées (préfixe "BI_") pour les données ET la config — même mécanisme que
 * Publipostage_Modeles/Publipostage_LiensTables, dont on sait qu'il fonctionne en Grist réel. Pas
 * de dépendance à grist.onRecords()/la table liée au widget dans la page (voir HYPOTHESES.md et
 * main.js:bootstrap). Voir HYPOTHESES.md pour ce qui reste à valider (ex. grist.setOptions() comme
 * alternative plus simple à la table de config, non testée ici).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const CONFIG_TABLE = 'BI_Dashboard_Config';
  // Nom FIXE, plus jamais suffixé par un numéro de schéma (demande explicite de l'utilisateur : une
  // SEULE table de test traverse toute la vie du widget, jamais une nouvelle table pour un
  // changement de schéma). Si `GristBI.demoData.COLUMNS_LARGE` gagne une colonne, `ensureColumnsUpToDate`
  // (plus bas) ajoute cette colonne à la table déjà présente (`AddColumn`) et remplit les lignes déjà
  // là avec de vraies valeurs calculées côté JS (`GristBI.demoData.deriveDateColumn`, PAS une formule
  // Grist) — ce mécanisme reste la SEULE façon prévue de faire évoluer le schéma, y compris pour un
  // futur ajout de colonne : jamais une table supplémentaire.
  const STRESS_TABLE = 'BI_StressTest';
  // Anciens noms suffixés par un numéro de version, créés par une version antérieure de ce widget
  // avant l'adoption d'un nom fixe ci-dessus — voir `migrateLegacyTableName` : si l'un de ces noms
  // existe encore et que le nom fixe n'existe pas, on le RENOMME (`RenameTable`) plutôt que de
  // laisser une table orpheline en plus dans le document.
  const LEGACY_STRESS_TABLE_NAMES = ['BI_StressTest_v2', 'BI_StressTest_v1'];
  // Nombre d'actions envoyées par appel à applyUserActions() lors d'une génération/suppression en
  // masse : un seul appel avec des dizaines de milliers d'actions est un pari risqué (timeout,
  // limite de payload côté Grist - aucune des deux non testée ici, voir HYPOTHESES.md) ; les
  // envoyer par lots donne aussi une progression visible à l'utilisateur plutôt qu'une attente
  // opaque.
  const ACTION_CHUNK_SIZE = 2000;

  let _rawTables = null;
  let _configRowIdByTable = {};

  // Ne s'appuie plus sur `grist.onRecords()`/la table liée au widget dans la page (voir
  // HYPOTHESES.md) : le dashboard se connecte directement à sa propre table de test de charge au
  // démarrage (voir main.js), même pattern que publipostageGrist qui gère ses propres tables
  // internes sans dépendre d'une sélection de table faite par l'auteur de la page Grist.
  async function init() {
    if (typeof grist === 'undefined') {
      console.warn('[GristBI] grist-plugin-api.js indisponible (widget ouvert hors Grist ?).');
      return;
    }
    try {
      grist.ready({ requiredAccess: 'full' });
    } catch (e) {
      console.error('[GristBI] grist.ready() a échoué', e);
    }
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

  // Le format sauvegardé a changé deux fois (voir ci-dessous) : normalise le plus ancien (un simple
  // tableau de tuiles, avant l'ajout des bookmarks), l'intermédiaire (`{tiles, bookmarks}`, avant
  // les pages) et le format courant (`{pages, currentPageId, bookmarks}`), pour ne pas casser la
  // lecture d'une config déjà sauvegardée par une version antérieure du widget - même classe de
  // problème que l'évolution de schéma de `BI_StressTest` (voir `ensureColumnsUpToDate` plus bas),
  // mais réglée ici en JS pur puisque ConfigJSON est un blob texte, pas des colonnes Grist typées.
  function singlePageConfig(tiles, bookmarks) {
    const pageId = (GristBI.state && GristBI.state.DEFAULT_PAGE_ID) || 'page_default';
    return { pages: [{ id: pageId, name: 'Page 1', tiles: tiles || [] }], currentPageId: pageId, bookmarks: bookmarks || [] };
  }

  function normalizeConfig(raw) {
    if (Array.isArray(raw)) return singlePageConfig(raw, []);
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.pages) && raw.pages.length) {
        const currentPageId = raw.pages.some((p) => p.id === raw.currentPageId) ? raw.currentPageId : raw.pages[0].id;
        return { pages: raw.pages, currentPageId, bookmarks: raw.bookmarks || [] };
      }
      return singlePageConfig(raw.tiles, raw.bookmarks);
    }
    return singlePageConfig([], []);
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
          catch (e) { return singlePageConfig([], []); }
        }
      }
    } catch (e) {
      console.warn('[GristBI] loadConfig: lecture impossible', e);
    }
    return singlePageConfig([], []);
  }

  async function saveConfig(tableId, pages, currentPageId, bookmarks) {
    if (!tableId) return;
    await ensureConfigTableExists();
    const json = JSON.stringify({ pages, currentPageId, bookmarks: bookmarks || [] });
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

  // Si `tableId` (le nom fixe courant) n'existe pas encore mais qu'un ancien nom versionné existe
  // (voir LEGACY_*_TABLE_NAMES), le renomme plutôt que de laisser une table orpheline en plus dans
  // le document. `RenameTable` est un verbe déjà vérifié (voir ROADMAP.md). No-op si `tableId`
  // existe déjà, ou si aucun ancien nom n'est présent (première installation : rien à migrer).
  async function migrateLegacyTableName(tableId, legacyNames) {
    if (await tableExists(tableId)) return;
    for (const legacyName of legacyNames) {
      if (await tableExists(legacyName)) {
        await grist.docApi.applyUserActions([['RenameTable', legacyName, tableId]]);
        _rawTables = null; // le cache de listTables() doit être relu après un renommage
        return;
      }
    }
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

  // Ajoute à `tableId` (déjà existante) les colonnes de `columns` qui lui manquent encore
  // (`AddColumn`), puis remplit leur valeur pour les lignes déjà présentes avec de VRAIES valeurs
  // calculées par `deriveMissingColumns(row)` et envoyées explicitement via `UpdateRecord` (comme
  // `fillTable` envoie ses `AddRecord`) — PAS une formule Grist : ce projet n'utilise nulle part le
  // langage de formules Grist, cohérent avec le reste du schéma (demande explicite de l'utilisateur,
  // qui a aussi demandé à ne plus jamais recréer de table pour un changement de schéma : ce
  // mécanisme d'ajout de colonne en place remplace définitivement la logique de versionnage de nom
  // de table utilisée avant). No-op si aucune colonne ne manque.
  async function ensureColumnsUpToDate(tableId, columns, deriveMissingColumns, onProgress) {
    const table = await grist.docApi.fetchTable(tableId);
    const existingIds = new Set(Object.keys(table).filter((k) => k !== 'id'));
    const missingColumns = columns.filter((c) => !existingIds.has(c.id));
    if (!missingColumns.length) return;
    await grist.docApi.applyUserActions(missingColumns.map((c) => ['AddColumn', tableId, c.id, { type: c.type }]));
    const rows = GristBI.data.tableToRows(table);
    const actions = rows.map((row, i) => {
      const derived = deriveMissingColumns(row);
      const fields = {};
      for (const c of missingColumns) fields[c.id] = derived[c.id];
      return ['UpdateRecord', tableId, table.id[i], fields];
    });
    await applyActionsInChunks('migrate', actions, onProgress);
  }

  // Se connecte à la table de données de test de charge : la CRÉE et la REMPLIT seulement si elle
  // n'existe pas encore ; si elle existe déjà, complète seulement les colonnes manquantes (voir
  // `ensureColumnsUpToDate`) sans jamais renvoyer les lignes déjà présentes ni recréer la table.
  // Volontairement idempotent : un rechargement du widget ne doit pas renvoyer des dizaines de
  // milliers de lignes à Grist à chaque fois une fois que la table existe déjà.
  async function loadOrCreateTable(tableId, legacyNames, columns, buildRows, deriveMissingColumns, onProgress) {
    await migrateLegacyTableName(tableId, legacyNames);
    const alreadyExists = await tableExists(tableId);
    await ensureTableExists(tableId, columns);
    if (!alreadyExists) {
      await fillTable(tableId, buildRows(), columns, onProgress);
    } else {
      await ensureColumnsUpToDate(tableId, columns, deriveMissingColumns, onProgress);
    }
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table), created: !alreadyExists };
  }

  function loadOrCreateStressData(onProgress) {
    return loadOrCreateTable(
      STRESS_TABLE, LEGACY_STRESS_TABLE_NAMES, GristBI.demoData.COLUMNS_LARGE,
      GristBI.demoData.buildLargeSampleRows, GristBI.demoData.deriveDateColumn, onProgress
    );
  }

  // Toutes les tables du document, table de config interne exclue (jamais une donnée à visualiser)
  // — pour le sélecteur de table (voir main.js). `_rawTables` remis à `null` avant de relire :
  // volontairement une lecture FRAÎCHE à chaque appel (pas de cache ici, contrairement à
  // `listAllTablesCached` utilisé ailleurs pour les vérifications d'existence internes) — la liste
  // proposée à l'utilisateur doit refléter les tables les plus récentes du document, y compris une
  // table créée dans Grist depuis le dernier chargement du widget.
  async function listAvailableTables() {
    _rawTables = null;
    const tables = await listAllTablesCached();
    return tables
      .map((t) => (typeof t === 'string' ? t : t.id))
      .filter((id) => id !== CONFIG_TABLE);
  }

  // Lit une table déjà existante (choisie via le sélecteur de table, voir main.js) — contrairement
  // à `loadOrCreateTable`, ne crée ni ne remplit jamais rien : la table doit déjà exister (elle vient
  // de `listAvailableTables`), sinon `fetchTable` renverrait une table vide silencieusement.
  async function loadTable(tableId) {
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table) };
  }

  GristBI.api = {
    init, loadConfig, saveConfig, loadOrCreateStressData,
    listAvailableTables, loadTable
  };
})(window);
