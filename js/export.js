/*
 * Export du dashboard en classeur Excel (.xlsx), via ExcelJS 4.4.0 embarqué localement
 * (js/vendor/exceljs/, MIT — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe. La composition des feuilles (une par tuile, toutes pages
 * confondues) est déléguée à GristBI.data.buildWorkbookSheetsAsync, testée sous Node
 * (dev-tests/test-data.js) avec un calcul de mesure temporelle factice injecté : ce fichier ne
 * fait QUE fournir le VRAI calcul DuckDB-WASM (GristBI.duckdbEngine, lui non testable sous Node —
 * voir CLAUDE.md §5) et parler à `ExcelJS`. La mise en forme des cellules (`cellValue`) et la
 * construction du classeur (`buildWorkbook`) sont PURES vis-à-vis du DOM : ce fichier se charge
 * aussi sous Node (module.exports en bas) pour que dev-tests/test-data.js les exerce avec le vrai
 * paquet vendorisé. Ce qui reste hors Node : le chargement paresseux et le déclenchement du
 * téléchargement (voir HYPOTHESES.md pour ce qui reste à valider en conditions réelles Grist).
 *
 * Historique : SheetJS 0.18.5 jusqu'à la consigne GFS 017 (18/11/2026, deux avis de sécurité
 * publiés, dont les versions corrigées ne sont qu'à cdn.sheetjs.com) ; Antoine a choisi ExcelJS,
 * déjà celui de Publipostage+ (harmonisation des dépendances, même fichier, même empreinte).
 *
 * Consigne GFS 013 (10/11/2026), conservée : la bibliothèque (947 Ko) n'est pas une balise
 * statique d'index.html — elle ne sert qu'à CET export, donc chargée ici paresseusement au premier
 * appel, comme pdfmake/PptxGenJS (js/pdf-export.js/js/pptx-export.js), mais depuis la même origine
 * que le reste du widget plutôt qu'un CDN externe (aucune adresse nouvelle, aucun changement de
 * politique réseau).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Capturé de façon SYNCHRONE au chargement de CE script (document.currentScript n'est fiable
  // qu'à l'exécution synchrone initiale) : URL absolue d'ExcelJS, pour que le chemin reste correct
  // quel que soit le document HTML qui charge ce script (index.html à la racine, dev-tests/
  // harness.html dans un sous-dossier) — même technique que js/duckdb-engine.js:VENDOR_BASE_URL.
  // Vide hors navigateur (Node : les tests passent l'objet ExcelJS eux-mêmes).
  const EXCELJS_LIB_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    ? new URL('vendor/exceljs/exceljs.min.js', document.currentScript.src).href
    : '';
  let excelJsLibPromise = null;

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const FILE_NAME = 'dashboard-bi.xlsx';
  // Limite d'Excel : 32 767 caractères par cellule. ExcelJS n'y coupe rien (le classeur ouvrirait
  // alors avec un message de réparation) : on tronque nous-mêmes.
  const MAX_CELL_CHARS = 32767;

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Échec de chargement du script : ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureExcelJsLoaded() {
    if (typeof ExcelJS !== 'undefined') return Promise.resolve();
    if (!excelJsLibPromise) {
      excelJsLibPromise = loadScriptOnce(EXCELJS_LIB_URL).catch((e) => { excelJsLibPromise = null; throw e; });
    }
    return excelJsLibPromise;
  }

  // Valeur d'une cellule du classeur. Même contrat qu'avant avec SheetJS (`aoa_to_sheet`) : nombre,
  // texte, booléen, date, cellule VIDE pour null/undefined, cellule d'ERREUR pour un nombre non fini
  // (ExcelJS écrirait sinon `NaN` en clair dans le XML : Excel proposerait de « réparer » le fichier).
  // Tout objet ou tableau (liste de choix Grist, cellule d'erreur Grist `['E', …]`) devient son texte,
  // jamais l'objet lui-même : ExcelJS lit un objet comme une FORMULE, un lien ou du texte riche.
  // Un texte, lui, reste toujours du texte — même s'il commence par `=`, `+`, `-` ou `@` : ExcelJS ne
  // pose une formule que pour un objet `{ formula }`, jamais pour une chaîne (voir GFS-ETAT.md, 005).
  function cellValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return v;
      return { error: Number.isNaN(v) ? '#NUM!' : '#DIV/0!' };
    }
    if (typeof v === 'bigint') {
      // DuckDB-WASM rend un entier en BigInt (voir CLAUDE.md §7, piège n°23) ; Excel n'a que des doubles.
      return (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : String(v);
    }
    if (typeof v === 'boolean') return v;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const s = String(v);
    return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) : s;
  }

  // Construit le classeur ExcelJS à partir de feuilles `{ name, header, rows }` (celles de
  // GristBI.data.buildWorkbookSheets*) : une feuille par entrée, l'en-tête en première ligne.
  // `ExcelJSLib` est passé en paramètre (le global `ExcelJS` dans le navigateur, le paquet vendorisé
  // sous Node) : cette fonction ne touche ni au DOM ni au réseau.
  function buildWorkbook(ExcelJSLib, sheets) {
    const wb = new ExcelJSLib.Workbook();
    wb.creator = 'Grist BI';
    wb.lastModifiedBy = 'Grist BI';
    for (const sheet of sheets) {
      const ws = wb.addWorksheet(sheet.name);
      ws.addRow(sheet.header.map((h) => cellValue(h === null || h === undefined ? '' : String(h))));
      for (const row of sheet.rows) {
        const excelRow = ws.addRow(row.map(cellValue));
        // Une date reçoit un format de date lisible plutôt que le numéro de série brut.
        excelRow.eachCell((cell) => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm'; });
      }
    }
    return wb;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    // Dans le DOM le temps du clic synthétique : certains navigateurs ignorent un clic sur une
    // ancre détachée. Jamais vérifié en conditions réelles Grist/GFS (voir HYPOTHESES.md) : dans le
    // cadre isolé de GFS (`sandbox="allow-scripts"`), un téléchargement peut demander `allow-downloads`.
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
  }

  // Calcul réellement injecté dans buildWorkbookSheetsAsync pour une tuile Barres en mode mesure
  // (Cumul/YTD/N-1, voir js/data.js) : même appel que js/charts.js:renderMeasureChart, pour que
  // l'export contienne EXACTEMENT les mêmes valeurs que ce qui est affiché à l'écran.
  function computeMeasureSeries(tile, rows) {
    return GristBI.duckdbEngine.timeSeriesMeasures(rows, tile.dateColumn, tile.measure, tile.aggFn);
  }

  // Déclenche le téléchargement d'un classeur .xlsx, une feuille par tuile du dashboard (toutes
  // pages confondues). Retourne `false` sans rien déclencher s'il n'y a aucune tuile à exporter
  // (à l'appelant de prévenir l'utilisateur, voir main.js) plutôt que de télécharger un classeur
  // vide qui n'apporterait rien. ASYNCHRONE depuis l'ajout des vraies valeurs pour les tuiles en
  // mode mesure (voir buildWorkbookSheetsAsync) — à l'appelant d'attendre la promesse (main.js).
  async function exportDashboardToExcel(state) {
    await ensureExcelJsLoaded().catch(() => { /* le test ci-dessous produit le message existant */ });
    if (typeof ExcelJS === 'undefined') {
      throw new Error("ExcelJS indisponible (js/vendor/exceljs/exceljs.min.js ne s'est pas chargé) — voir le bandeau ECharts pour un diagnostic similaire.");
    }
    const sheets = await GristBI.data.buildWorkbookSheetsAsync(state, computeMeasureSeries);
    if (!sheets.length) return false;
    const wb = buildWorkbook(ExcelJS, sheets);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), FILE_NAME);
    return true;
  }

  const api = { exportDashboardToExcel, buildWorkbook, cellValue };
  GristBI.exportExcel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
