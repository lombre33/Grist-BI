/*
 * Export du dashboard en classeur Excel (.xlsx), via SheetJS embarqué localement
 * (js/vendor/xlsx/, Apache-2.0 — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe. La composition des feuilles (une par tuile, toutes pages
 * confondues) est déléguée à GristBI.data.buildWorkbookSheets, pure et testée sous Node
 * (dev-tests/test-data.js) : ce fichier ne fait QUE parler à `XLSX`, jamais testé ailleurs qu'en
 * Playwright (voir HYPOTHESES.md pour ce qui reste à valider en conditions réelles Grist).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Déclenche le téléchargement d'un classeur .xlsx, une feuille par tuile du dashboard (toutes
  // pages confondues). Retourne `false` sans rien déclencher s'il n'y a aucune tuile à exporter
  // (à l'appelant de prévenir l'utilisateur, voir main.js) plutôt que de télécharger un classeur
  // vide qui n'apporterait rien.
  function exportDashboardToExcel(state) {
    if (typeof XLSX === 'undefined') {
      throw new Error("XLSX indisponible (js/vendor/xlsx/xlsx.full.min.js ne s'est pas chargé) — voir le bandeau ECharts pour un diagnostic similaire.");
    }
    const sheets = GristBI.data.buildWorkbookSheets(state);
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
