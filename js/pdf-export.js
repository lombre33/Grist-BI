/*
 * Export du dashboard en PDF vectoriel via pdfmake. À la différence d'ECharts/SheetJS/DuckDB-WASM
 * (vendorisés dans js/vendor/), pdfmake est chargé DEPUIS UN CDN EXTERNE — décision explicite
 * d'Antoine le 2026-09-29 (voir CLAUDE.md/ROADMAP.md), qui déroge à la règle habituelle de ce dépôt.
 * Même bibliothèque et même CDN que le widget frère publipostageGrist (js/pdf-export.js de ce
 * dépôt-là), pour rester cohérent entre projets plutôt que d'inventer un second motif de chargement.
 *
 * Contrairement à l'export Excel (js/export.js, GristBI.data.buildWorkbookSheets), qui recalcule
 * chaque tuile en pur JS et doit s'excuser explicitement pour une tuile en mode mesure DAX (calcul
 * ASYNCHRONE via DuckDB-WASM, incompatible avec un export synchrone) — cet export PDF capture
 * l'image de chaque graphique DÉJÀ RENDU à l'écran (GristBI.charts.getInstance(tile.id).getDataURL,
 * voir GristBI.data.tileExportKind) : comme la valeur est déjà calculée au moment du clic, ça marche
 * uniformément pour tous les types de tuile, y compris en mode Cumul/YTD/N-1.
 *
 * Périmètre de ce premier export (documenté dans HYPOTHESES.md) : seulement la page actuellement
 * affichée, pas toutes les pages du dashboard comme le fait l'export Excel.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Même version/CDN/hash SRI que publipostageGrist (js/pdf-export.js de ce dépôt-là, vérifié le
  // 2026-09-29). cdnjs.cloudflare.com reste bloqué par la politique réseau de ce sandbox (même
  // catégorie que le blocage CDN déjà rencontré pour ECharts), mais le hash de pdfmake.min.js a été
  // recoupé avec le paquet npm officiel de cette version (identique) et le chemin de succès complet
  // (chargement, rendu d'image, tableaux) vérifié en local avec cette copie — voir HYPOTHESES.md,
  // entrée "Export PDF du dashboard", pour le détail et ce qui reste réellement non testé (le hash de
  // vfs_fonts.min.js, la requête réseau réelle vers cdnjs). Recalculer ce hash si la version change :
  // `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
  const PDF_LIB_URLS = [
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js', integrity: 'sha384-VFQrHzqBh5qiJIU0uGU5CIW3+OWpdGGJM9LBnGbuIH2mkICcFZ7lPd/AAtI7SNf7' },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.min.js', integrity: 'sha384-dWs4+zGqy/KS6giKxiK+6iowhidQwjVFaiE1lMar36QwIulE44VyBSQp0brMCx4D' }
  ];
  let pdfLibsPromise = null;

  // Résolu au chargement, rejeté si le script ne charge pas (offline, CDN injoignable, hash SRI qui
  // ne correspond plus...) — l'appelant transforme ce rejet en message clair plutôt que de casser la
  // page ou de rester silencieux : c'est le prix d'un appel externe, exactement ce que vendoriser
  // aurait évité (voir CLAUDE.md).
  function loadScriptOnce(lib) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.src;
      s.integrity = lib.integrity;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Échec de chargement du script : ' + lib.src));
      document.head.appendChild(s);
    });
  }

  // Séquentiel (pas Promise.all) : vfs_fonts.min.js lit window.pdfMake.vfs à l'exécution, donc doit
  // s'exécuter après pdfmake.min.js.
  function ensurePdfLibsLoaded() {
    if (!pdfLibsPromise) {
      pdfLibsPromise = (async () => {
        for (const lib of PDF_LIB_URLS) await loadScriptOnce(lib);
      })().catch((e) => { pdfLibsPromise = null; throw e; });
    }
    return pdfLibsPromise;
  }

  // Un bloc de contenu pdfmake par tuile : titre + soit une image (graphique déjà rendu, capturé tel
  // qu'affiché), soit un tableau natif (pivot/KPI, voir GristBI.data.tileExportKind — ni l'un ni
  // l'autre n'a de graphique ECharts à capturer, et tileExportSheet leur donne déjà la bonne forme,
  // déjà testée pour l'export Excel).
  function tileToPdfBlocks(tile, state) {
    const title = { text: tile.title || `${tile.aggFn}(${tile.measure})`, style: 'tileTitle' };
    if (GristBI.data.tileExportKind(tile) === 'table') {
      const sheet = GristBI.data.tileExportSheet(tile, state);
      const body = [sheet.header].concat(sheet.rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell)))));
      return [title, { table: { widths: sheet.header.map(() => '*'), body }, margin: [0, 4, 0, 16] }];
    }
    const instance = GristBI.charts.getInstance(tile.id);
    if (!instance || instance.isDisposed()) {
      // Tuile jamais rendue dans cette session (ne devrait pas arriver pour la page courante,
      // affichée au moment du clic — voir render() dans main.js) : message explicite plutôt qu'une
      // exception qui interromprait tout l'export pour les autres tuiles.
      return [title, { text: GristBI.i18n.t('export.pdf.chartUnavailable'), italics: true, margin: [0, 4, 0, 16] }];
    }
    const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    return [title, { image: dataUrl, width: 480, margin: [0, 4, 0, 16] }];
  }

  // Retourne `false` sans rien déclencher si la page courante n'a aucune tuile (à l'appelant de
  // prévenir l'utilisateur, voir main.js) — même contrat que exportDashboardToExcel.
  async function exportDashboardToPdf(state) {
    const page = state.pages.find((p) => p.id === state.currentPageId) || state.pages[0];
    if (!page || !page.tiles.length) return false;
    await ensurePdfLibsLoaded();
    const content = [{ text: page.name, style: 'pageTitle' }]
      .concat(page.tiles.flatMap((tile) => tileToPdfBlocks(tile, state)));
    const docDefinition = {
      pageMargins: [32, 32, 32, 32],
      content,
      styles: {
        pageTitle: { fontSize: 16, bold: true, margin: [0, 0, 0, 12] },
        tileTitle: { fontSize: 11, bold: true }
      }
    };
    pdfMake.createPdf(docDefinition).download('dashboard-bi.pdf');
    return true;
  }

  GristBI.exportPdf = { exportDashboardToPdf };
})(window);
