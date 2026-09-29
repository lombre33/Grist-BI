/*
 * Export du dashboard en PPTX via PptxGenJS. Même architecture que l'export PDF (js/pdf-export.js) :
 * chargé DEPUIS UN CDN EXTERNE — dérogation d'Antoine du 2026-09-29 (voir CLAUDE.md/ROADMAP.md),
 * pas vendorisé dans js/vendor/ ; une image capturée par tuile-graphique déjà rendue
 * (GristBI.charts.getInstance(tile.id).getDataURL()) plutôt qu'un recalcul qui buterait sur le mur
 * asynchrone des mesures DAX (voir js/pdf-export.js, même raisonnement) ; les tuiles pivot/KPI
 * réutilisent GristBI.data.tileExportSheet (déjà testé pour l'export Excel) sous forme de tableau
 * natif plutôt qu'une image.
 *
 * Contrairement au PDF (un seul document qui s'écoule), une diapositive est un canevas fixe : une
 * diapositive par tuile (titre + image ou tableau pleine page) plutôt qu'une grille façon écran, pour
 * éviter la logique d'ajustement automatique d'une mise en page à plusieurs tuiles par diapositive —
 * périmètre documenté dans HYPOTHESES.md, comme pour le PDF (page actuellement affichée seulement).
 *
 * À la différence de pdfmake (2 scripts : la bibliothèque + les polices vfs_fonts), PptxGenJS 4.0.1
 * n'a besoin que d'UN SEUL script : `dist/pptxgen.bundle.js` embarque JSZip (dont il dépend) et
 * expose `window.PptxGenJS` ET `window.JSZip` une fois chargé (vérifié en le chargeant dans un vrai
 * navigateur, voir HYPOTHESES.md).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Version/hash calculés en local à partir du paquet npm officiel `pptxgenjs@4.0.1`
  // (`dist/pptxgen.bundle.js`, voir HYPOTHESES.md pour la méthode) — CONTRAIREMENT à pdfmake
  // (js/pdf-export.js), aucun widget frère ne charge déjà cette bibliothèque depuis cdnjs en
  // conditions réelles : cette URL suit la convention connue de cdnjs
  // (ajax/libs/<nom>/<version>/<fichier>, même nom de fichier que dans le paquet npm) mais n'a
  // encore jamais été confirmée joignable — à vérifier en priorité par Antoine dans un vrai
  // navigateur. Recalculer ce hash si la version change :
  // `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
  const PPTX_LIB_URL = {
    src: 'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/4.0.1/pptxgen.bundle.js',
    integrity: 'sha384-qb0Xhi7LLYpvW1HCK6oMrmDLSY9sy7vwm6ZlV6KjtrlL9yg30+YN4neTwnmX+Kp8'
  };
  let pptxLibPromise = null;

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

  function ensurePptxLibLoaded() {
    if (!pptxLibPromise) {
      pptxLibPromise = loadScriptOnce(PPTX_LIB_URL).catch((e) => { pptxLibPromise = null; throw e; });
    }
    return pptxLibPromise;
  }

  // Tableau natif PptxGenJS (pivot/KPI, voir GristBI.data.tileExportKind) : réutilise directement
  // tileExportSheet (déjà testé pour l'export Excel), avec l'en-tête en gras comme seule mise en
  // forme — pas de fusion de cellules ni de largeurs calculées, laissées à l'ajustement automatique
  // de PptxGenJS pour ce premier jet.
  function addTableSlide(pptx, tile, state) {
    const sheet = GristBI.data.tileExportSheet(tile, state);
    const headerRow = sheet.header.map((cell) => ({ text: String(cell == null ? '' : cell), options: { bold: true, fill: { color: 'F0F0F0' } } }));
    const bodyRows = sheet.rows.map((row) => row.map((cell) => ({ text: String(cell == null ? '' : cell) })));
    const slide = pptx.addSlide();
    slide.addText(tile.title || `${tile.aggFn}(${tile.measure})`, { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 18, bold: true });
    slide.addTable([headerRow].concat(bodyRows), { x: 0.4, y: 1.0, w: 9.2, fontSize: 11, autoPage: false });
  }

  // Image du graphique déjà rendu (voir en-tête de fichier) — même contrat que
  // GristBI.exportPdf.tileToPdfBlocks : un message explicite plutôt qu'une exception si la tuile n'a
  // jamais été affichée dans cette session.
  function addImageSlide(pptx, tile) {
    const slide = pptx.addSlide();
    slide.addText(tile.title || `${tile.aggFn}(${tile.measure})`, { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 18, bold: true });
    const instance = GristBI.charts.getInstance(tile.id);
    if (!instance || instance.isDisposed()) {
      slide.addText(GristBI.i18n.t('export.pptx.chartUnavailable'), { x: 0.4, y: 1.0, w: 9.2, h: 0.5, fontSize: 12, italic: true });
      return;
    }
    const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    slide.addImage({ data: dataUrl, x: 0.7, y: 1.0, w: 8.6, h: 5.0, sizing: { type: 'contain', w: 8.6, h: 5.0 } });
  }

  // Retourne `false` sans rien déclencher si la page courante n'a aucune tuile — même contrat que
  // GristBI.exportPdf.exportDashboardToPdf / exportDashboardToExcel.
  async function exportDashboardToPptx(state) {
    const page = state.pages.find((p) => p.id === state.currentPageId) || state.pages[0];
    if (!page || !page.tiles.length) return false;
    await ensurePptxLibLoaded();
    const pptx = new PptxGenJS();
    const titleSlide = pptx.addSlide();
    titleSlide.addText(page.name, { x: 0.4, y: 2.3, w: 9.2, h: 1, fontSize: 28, bold: true, align: 'center' });
    for (const tile of page.tiles) {
      if (GristBI.data.tileExportKind(tile) === 'table') addTableSlide(pptx, tile, state);
      else addImageSlide(pptx, tile);
    }
    await pptx.writeFile({ fileName: 'dashboard-bi.pptx' });
    return true;
  }

  GristBI.exportPptx = { exportDashboardToPptx };
})(window);
