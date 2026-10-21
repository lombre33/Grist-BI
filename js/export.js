/*
 * Export du dashboard en classeur Excel (.xlsx), via SheetJS embarqué localement
 * (js/vendor/xlsx/, Apache-2.0 — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe. La composition des feuilles (une par tuile, toutes pages
 * confondues) est déléguée à GristBI.data.buildWorkbookSheetsAsync, testée sous Node
 * (dev-tests/test-data.js) avec un calcul de mesure temporelle factice injecté : ce fichier ne
 * fait QUE fournir le VRAI calcul DuckDB-WASM (GristBI.duckdbEngine, lui non testable sous Node —
 * voir CLAUDE.md §5) et parler à `XLSX`, jamais testé ailleurs qu'en Playwright (voir
 * HYPOTHESES.md pour ce qui reste à valider en conditions réelles Grist).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

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
