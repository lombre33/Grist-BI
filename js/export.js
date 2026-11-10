/*
 * Export du dashboard en classeur Excel (.xlsx), via SheetJS embarqué localement
 * (js/vendor/xlsx/, Apache-2.0 — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe. La composition des feuilles (une par tuile, toutes pages
 * confondues) est déléguée à GristBI.data.buildWorkbookSheetsAsync, testée sous Node
 * (dev-tests/test-data.js) avec un calcul de mesure temporelle factice injecté : ce fichier ne
 * fait QUE fournir le VRAI calcul DuckDB-WASM (GristBI.duckdbEngine, lui non testable sous Node —
 * voir CLAUDE.md §5) et parler à `XLSX`, jamais testé ailleurs qu'en Playwright (voir
 * HYPOTHESES.md pour ce qui reste à valider en conditions réelles Grist).
 *
 * Consigne GFS 013 (10/11/2026) : SheetJS (882 Ko) n'est plus une balise statique d'index.html —
 * il ne sert qu'à CET export, donc chargé ici paresseusement au premier appel, comme pdfmake/
 * PptxGenJS (js/pdf-export.js/js/pptx-export.js), mais depuis la même origine que le reste du
 * widget plutôt qu'un CDN externe (aucune adresse nouvelle, aucun changement de politique réseau).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Capturé de façon SYNCHRONE au chargement de CE script (document.currentScript n'est fiable
  // qu'à l'exécution synchrone initiale) : URL absolue de SheetJS, pour que le chemin reste correct
  // quel que soit le document HTML qui charge ce script (index.html à la racine, dev-tests/
  // harness.html dans un sous-dossier) — même technique que js/duckdb-engine.js:VENDOR_BASE_URL.
  const XLSX_LIB_URL = new URL('vendor/xlsx/xlsx.full.min.js', document.currentScript.src).href;
  let xlsxLibPromise = null;

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Échec de chargement du script : ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureXlsxLibLoaded() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (!xlsxLibPromise) {
      xlsxLibPromise = loadScriptOnce(XLSX_LIB_URL).catch((e) => { xlsxLibPromise = null; throw e; });
    }
    return xlsxLibPromise;
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
    await ensureXlsxLibLoaded().catch(() => { /* le test ci-dessous produit le message existant */ });
    if (typeof XLSX === 'undefined') {
      throw new Error("XLSX indisponible (js/vendor/xlsx/xlsx.full.min.js ne s'est pas chargé) — voir le bandeau ECharts pour un diagnostic similaire.");
    }
    const sheets = await GristBI.data.buildWorkbookSheetsAsync(state, computeMeasureSeries);
    if (!sheets.length) return false;
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet([sheet.header].concat(sheet.rows));
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }
    // XLSX.writeFile gère lui-même la création du Blob + l'ancre de téléchargement + le clic
    // synthétique — possible ici car l'iframe du widget n'est PAS sandboxée (voir ROADMAP.md,
    // limites structurelles), jamais vérifié en conditions réelles Grist (voir HYPOTHESES.md).
    XLSX.writeFile(wb, 'dashboard-bi.xlsx');
    return true;
  }

  GristBI.exportExcel = { exportDashboardToExcel };
})(window);
