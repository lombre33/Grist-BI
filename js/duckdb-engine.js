/*
 * Moteur SQL DuckDB-WASM (fondation — voir ROADMAP.md Tier 2 : "remplace Array.reduce", la base
 * prévue pour les mesures façon DAX, le tableau croisé dynamique et le data blending qui suivront.
 * Chargement PARESSEUX uniquement : rien ici ne télécharge le binaire WASM (~34 Mo, voir
 * HYPOTHESES.md — un vrai moteur SQL complet compilé en WASM, pas une petite bibliothèque JS) tant
 * que `init()` n'a pas été appelée explicitement par une feature qui en a réellement besoin —
 * jamais au démarrage du widget (`bootstrap()` ne l'appelle pas). Les fichiers sont servis depuis
 * le même dépôt/la même origine que le reste du widget (jamais un CDN, même convention
 * qu'ECharts/SheetJS), donc AUCUN coût réseau tant qu'aucun code ne les demande explicitement.
 *
 * `groupByAggregate`/`aggregateSingle` reproduisent la même signature et les mêmes agrégateurs
 * (sum/avg/count/min/max) que leurs équivalents purs JS de js/data.js, vérifiés identiques sur les
 * colonnes numériques propres réellement utilisées par ce widget (Montant/Quantite...) — voir
 * HYPOTHESES.md pour les cas limites (colonne à valeurs mixtes texte/nombre) où le comportement
 * peut diverger subtilement entre les deux moteurs.
 *
 * Bundle "eh" uniquement (mono-thread, exceptions WASM) : pas de variante "coi" (multi-thread, qui
 * exige des en-têtes COOP/COEP non réglables sur une page statique GitHub Pages), pas de variante
 * "mvp" (redondante avec "eh", disponible dans tous les navigateurs évergreens visés par ce widget).
 *
 * Même séparation que js/combobox.js : `csvEscape`/`assertSafeIdentifier` sont de la logique pure
 * (aucune dépendance à `document`/WASM/Worker), testable sous Node comme data.js/state.js. Le
 * chargement/l'exécution SQL réels (`init`/`groupByAggregate`/`aggregateSingle`) ne fonctionnent
 * qu'en navigateur (Worker + WASM) — testés uniquement via Playwright, servis sur une vraie origine
 * http:// (voir TEST_PROTOCOL.md : l'import() dynamique de module ES qu'ils utilisent est bloqué
 * par CORS sur file://, contrairement aux scripts classiques du reste de ce projet).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(null);
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.duckdbEngine = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Capturé de façon SYNCHRONE au chargement de CE script (document.currentScript n'est fiable
  // qu'à l'exécution synchrone initiale, jamais dans du code asynchrone) : URL absolue du dossier
  // vendorisé, pour que les chemins restent corrects quel que soit le document HTML qui charge ce
  // script (index.html à la racine, dev-tests/harness.html dans un sous-dossier) sans avoir à
  // maintenir deux chemins relatifs différents comme pour les <script src="..."> classiques. `null`
  // sous Node (pas de `document`) : sans conséquence, `init()` n'y est jamais appelée.
  const VENDOR_BASE_URL = (root && typeof document !== 'undefined' && document.currentScript)
    ? new URL('vendor/duckdb/', document.currentScript.src).href
    : null;

  let _initPromise = null;
  let _db = null;
  let _tableCounter = 0;

  function assertSafeIdentifier(name) {
    if (typeof name !== 'string' || !name || name.includes('"')) {
      throw new Error(`[GristBI.duckdbEngine] nom de colonne invalide: ${JSON.stringify(name)}`);
    }
    return name;
  }

  // Mêmes agrégateurs que js/data.js:AGGREGATORS, traduits en SQL : `TRY_CAST(... AS DOUBLE)`
  // renvoie NULL (pas une erreur) sur une valeur non numérique, `COALESCE(..., 0)` reproduit le
  // `Number(v) || 0` de la version JS pour sum/avg. `avg` divise par COUNT(*) (toutes les lignes du
  // groupe), pas par le nombre de valeurs numériques valides — comme `sum/values.length` côté JS.
  const AGG_SQL = {
    sum: (col) => `SUM(COALESCE(TRY_CAST("${col}" AS DOUBLE), 0))`,
    avg: (col) => `SUM(COALESCE(TRY_CAST("${col}" AS DOUBLE), 0)) / COUNT(*)`,
    count: () => 'COUNT(*)',
    min: (col) => `MIN(TRY_CAST("${col}" AS DOUBLE))`,
    max: (col) => `MAX(TRY_CAST("${col}" AS DOUBLE))`
  };

  // Charge le module DuckDB-WASM + son worker + son binaire .wasm — mémoïsé : un seul chargement
  // par session de widget, tous les appels suivants (même concurrents) réutilisent la même
  // promesse/connexion déjà prête.
  async function init() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      const duckdb = await import(VENDOR_BASE_URL + 'duckdb-browser.mjs');
      const worker = await duckdb.createWorker(VENDOR_BASE_URL + 'duckdb-browser-eh.worker.js');
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(VENDOR_BASE_URL + 'duckdb-eh.wasm');
      _db = db;
      return db.connect();
    })();
    return _initPromise;
  }

  // CSV, PAS JSON : `read_json_auto`/`read_ndjson_auto` déclenchent le téléchargement de l'extension
  // "json" de DuckDB-WASM depuis `extensions.duckdb.org` au premier appel — un VRAI CDN externe
  // tiers (pas ce dépôt), contraire au principe "jamais de CDN externe" de ce projet, et un domaine
  // qu'un réseau restrictif pourrait tout aussi bien bloquer (même famille de risque que le CDN
  // ECharts bloqué documenté ailleurs dans ce projet — voir HYPOTHESES.md). `read_csv_auto` fait
  // partie du cœur de DuckDB (compilé dans le binaire .wasm vendorisé), aucun téléchargement
  // supplémentaire à l'exécution. Un champ contenant une virgule/un guillemet/un retour à la ligne
  // est entouré de guillemets (guillemets internes doublés), format CSV standard.
  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Charge `rows` comme une table temporaire, augmentée d'une colonne `__row_idx` (position
  // d'origine dans `rows`) : DuckDB ne garantit PAS que GROUP BY préserve l'ordre d'insertion, alors
  // que js/data.js:groupByAggregate le garantit explicitement (ordre de 1re apparition, pas
  // alphabétique — voir ses tests). `ORDER BY MIN("__row_idx")` à l'agrégation reproduit ce même
  // contrat plutôt que de dépendre d'un comportement d'implémentation non documenté.
  async function loadRowsAsTempTable(conn, rows) {
    const columns = Object.keys(rows[0]).concat('__row_idx');
    const lines = [columns.map(csvEscape).join(',')];
    rows.forEach((row, i) => {
      lines.push(columns.map((c) => csvEscape(c === '__row_idx' ? i : row[c])).join(','));
    });
    const tableName = `gristbi_rows_${_tableCounter++}`;
    const fileName = `${tableName}.csv`;
    await _db.registerFileBuffer(fileName, new TextEncoder().encode(lines.join('\n')));
    await conn.query(`CREATE TEMP TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${fileName}')`);
    return tableName;
  }

  function arrowTableToObjects(table) {
    const fields = table.schema.fields.map((f) => f.name);
    return table.toArray().map((row) => {
      const obj = {};
      for (const field of fields) obj[field] = row[field];
      return obj;
    });
  }

  // Équivalent SQL de js/data.js:groupByAggregate(rows, dimensionCol, measureCol, aggFn) — même
  // signature, même contrat de tri (1re apparition), mêmes agrégateurs. `rows` est rechargé à
  // chaque appel (comme la version JS, sans état caché) plutôt que de supposer une table déjà
  // enregistrée : plus simple et sans piège de fraîcheur, la table temporaire est de toute façon
  // supprimée juste après (voir `finally`).
  async function groupByAggregate(rows, dimensionCol, measureCol, aggFn) {
    assertSafeIdentifier(dimensionCol);
    assertSafeIdentifier(measureCol);
    if (!rows.length) return [];
    const agg = AGG_SQL[aggFn] || AGG_SQL.sum;
    const conn = await init();
    const tableName = await loadRowsAsTempTable(conn, rows);
    try {
      const result = await conn.query(
        `SELECT "${dimensionCol}" AS dimension, ${agg(measureCol)} AS value
         FROM "${tableName}"
         GROUP BY "${dimensionCol}"
         ORDER BY MIN("__row_idx")`
      );
      return arrowTableToObjects(result).map((r) => ({ dimension: r.dimension, value: Number(r.value) }));
    } finally {
      await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
    }
  }

  // Équivalent SQL de js/data.js:aggregateSingle(rows, measureCol, aggFn).
  async function aggregateSingle(rows, measureCol, aggFn) {
    assertSafeIdentifier(measureCol);
    if (!rows.length) return 0;
    const agg = AGG_SQL[aggFn] || AGG_SQL.sum;
    const conn = await init();
    const tableName = await loadRowsAsTempTable(conn, rows);
    try {
      const result = await conn.query(`SELECT ${agg(measureCol)} AS value FROM "${tableName}"`);
      const value = arrowTableToObjects(result)[0].value;
      return Number(value) || 0;
    } finally {
      await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
    }
  }

  // Vrai seulement APRÈS un premier appel réussi à init() (le module est chargé, une connexion
  // existe) — permet à une feature future de savoir si utiliser ce moteur coûterait un chargement
  // WASM immédiat ou réutiliserait une instance déjà prête, sans jamais déclencher ce chargement
  // elle-même (contrairement à un appel direct à `init()`).
  function isReady() {
    return _db !== null;
  }

  return { init, groupByAggregate, aggregateSingle, isReady, csvEscape, assertSafeIdentifier };
});
