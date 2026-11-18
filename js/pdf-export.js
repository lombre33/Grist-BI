/*
 * Export du tableau de bord en PDF (refait le 18/11/2026, demande d'Antoine : « il faut garder le côté tableau de bord, donc même visuel »).
 *
 * Avant : pdfmake (chargé depuis cdnjs) recomposait chaque tuile à part dans un document qui s'écoule — les cartes s'empilaient sur trois
 * pages A4, un KPI devenait « 567.0545607638886 », un tableau croisé débordait de la page et le style comme la disposition de la page
 * (Grille, Rapport, Planche, Vedette, Rail ; Standard, Fluide, Éditorial, Console, Verre dépoli) disparaissaient.
 * Maintenant : la page affichée est photographiée telle qu'elle est dessinée (js/snapshot.js) et chaque page du tableau de bord donne UNE
 * page du PDF, à la largeur d'un A4 paysage, avec son bandeau (nom de la page, jeu de données, date, vue suivie et filtres actifs).
 * Aucune bibliothèque : le fichier est écrit par js/pdf-writer.js, l'image compressée par `CompressionStream` (JPEG sinon).
 *
 * Périmètre : la page actuellement affichée seulement (comme avant) ; l'image est celle de l'écran — une tuile rognée à l'écran l'est aussi
 * dans le fichier, l'agrandir (bouton de la tuile) avant d'exporter la montre en entier. Texte non sélectionnable (c'est une image).
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});

  const FILE_NAME = 'dashboard-bi.pdf';

  // Flux zlib (ce que PDF appelle FlateDecode) ; `null` si le navigateur n'a pas CompressionStream (Safari avant 16.4, Firefox avant 113).
  async function deflate(bytes) {
    if (typeof CompressionStream !== 'function' || typeof Response !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // L'image d'une page : RGB compressé sans perte ; à défaut, un JPEG de haute qualité.
  async function pageImage(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const compressed = await deflate(GristBI.pdfWriter.rgbaToRgb(rgba));
    if (compressed) return { width, height, filter: 'FlateDecode', data: compressed };
    const blob = await GristBI.snapshot.canvasToBlob(canvas, 'image/jpeg', 0.95);
    return { width, height, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) };
  }

  // Retourne `false` sans rien déclencher si la page courante n'a aucune tuile (à l'appelant de prévenir l'utilisateur, voir main.js) —
  // même contrat que exportDashboardToExcel.
  async function exportDashboardToPdf(state) {
    const page = GristBI.snapshot.currentPageOf(state);
    if (!page || !page.tiles.length) return false;
    const shot = await GristBI.snapshot.capturePage(state, { scale: 2 });
    const image = await pageImage(shot.canvas);
    const size = GristBI.pdfWriter.pageSizeFor(shot.width, shot.height);
    const bytes = GristBI.pdfWriter.buildPdf(
      [{ width: size.width, height: size.height, image }],
      { title: page.name, creator: 'Grist BI', created: new Date() }
    );
    GristBI.snapshot.downloadBlob(new Blob([bytes], { type: 'application/pdf' }), FILE_NAME);
    return true;
  }

  GristBI.exportPdf = { exportDashboardToPdf };
})(window);
