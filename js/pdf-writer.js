/*
 * Écriture d'un PDF « une image par page », sans aucune bibliothèque (18/11/2026, correction de l'export PDF).
 *
 * L'export PDF photographie désormais la page du tableau de bord telle qu'elle est dessinée (js/snapshot.js) : le fichier n'est plus un
 * document qui s'écoule (ce que faisait pdfmake) mais une ou plusieurs pages qui portent chacune UNE image. Ce format tient en quelques
 * dizaines de lignes — page, image, table des références — et supprime la dernière dépendance externe de l'export PDF (pdfmake et ses
 * polices vfs_fonts, 2 Mo chargés depuis cdnjs à chaque export, qu'un proxy peut bloquer comme il a déjà bloqué ECharts).
 *
 * Pur et testé sous Node (poppler relit le résultat) : `buildPdf`, `rgbaToRgb`, `pageSizeFor`, `pdfTextString`.
 * La compression de l'image (CompressionStream) et le téléchargement sont dans js/pdf-export.js : ils ont besoin du navigateur.
 */
(function (global) {
  'use strict';

  const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
  const A4_LANDSCAPE_WIDTH_PT = 842;
  // Limite d'un PDF (spécification, annexe C) : 14 400 unités par côté.
  const MAX_PAGE_PT = 14400;

  function ascii(text) {
    if (encoder) return encoder.encode(text);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  // Taille de la page en points : toujours la largeur d'un A4 paysage (la page s'imprime à l'échelle sans réglage), la hauteur suit le
  // rapport de l'image — une page de tableau de bord = une page du PDF, comme l'export PDF d'un rapport Power BI. Une image très haute
  // est ramenée sous la limite du format plutôt que refusée.
  function pageSizeFor(pxWidth, pxHeight) {
    const w = Math.max(1, Number(pxWidth) || 1);
    const h = Math.max(1, Number(pxHeight) || 1);
    let width = A4_LANDSCAPE_WIDTH_PT;
    let height = width * h / w;
    if (height > MAX_PAGE_PT) { width = width * MAX_PAGE_PT / height; height = MAX_PAGE_PT; }
    return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
  }

  // Texte d'un champ du dictionnaire d'informations : UTF-16BE avec marque d'ordre (ce qui rend « Équipe & canaux » lisible partout).
  function pdfTextString(text) {
    const s = String(text == null ? '' : text);
    let hex = 'FEFF';
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    return '<' + hex + '>';
  }

  function pdfDate(date) {
    const when = date instanceof Date && !isNaN(date) ? date : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'D:' + when.getUTCFullYear() + p(when.getUTCMonth() + 1) + p(when.getUTCDate()) + p(when.getUTCHours()) + p(when.getUTCMinutes()) + p(when.getUTCSeconds()) + 'Z';
  }

  // Pixels RGBA d'un canvas (ImageData.data) -> RGB sans transparence, 3 octets par pixel : ce que PDF attend pour /DeviceRGB.
  function rgbaToRgb(rgba) {
    const pixels = Math.floor(rgba.length / 4);
    const out = new Uint8Array(pixels * 3);
    for (let i = 0, j = 0, k = 0; i < pixels; i++, j += 4, k += 3) {
      out[k] = rgba[j];
      out[k + 1] = rgba[j + 1];
      out[k + 2] = rgba[j + 2];
    }
    return out;
  }

  // pages : [{ width, height }  (points), image : { width, height (pixels), filter: 'FlateDecode' | 'DCTDecode', data: Uint8Array } }]
  // info  : { title, author, subject, creator, created }
  // Rend un Uint8Array : le fichier PDF entier.
  function buildPdf(pages, info) {
    if (!Array.isArray(pages) || !pages.length) throw new Error('buildPdf : au moins une page');
    const meta = info || {};
    const parts = [];
    const offsets = [];
    let length = 0;
    function push(bytes) { parts.push(bytes); length += bytes.length; }
    function pushText(text) { push(ascii(text)); }
    // Numérotation : 1 catalogue, 2 liste des pages, 3 informations, puis trois objets par page (page, contenu, image).
    const firstPageObject = 4;
    const objectCount = 3 + pages.length * 3;
    function beginObject(n) { offsets[n] = length; pushText(n + ' 0 obj\n'); }
    function endObject() { pushText('endobj\n'); }

    pushText('%PDF-1.4\n');
    // Quatre octets > 127 : les outils reconnaissent un fichier qui contient des données binaires.
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    beginObject(1);
    pushText('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObject();

    beginObject(2);
    const kids = pages.map((_, i) => (firstPageObject + i * 3) + ' 0 R').join(' ');
    pushText('<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>\n');
    endObject();

    beginObject(3);
    const infoFields = ['/Producer ' + pdfTextString('Grist BI'), '/CreationDate (' + pdfDate(meta.created) + ')'];
    if (meta.title) infoFields.push('/Title ' + pdfTextString(meta.title));
    if (meta.author) infoFields.push('/Author ' + pdfTextString(meta.author));
    if (meta.subject) infoFields.push('/Subject ' + pdfTextString(meta.subject));
    if (meta.creator) infoFields.push('/Creator ' + pdfTextString(meta.creator));
    pushText('<< ' + infoFields.join(' ') + ' >>\n');
    endObject();

    pages.forEach((page, i) => {
      const pageObj = firstPageObject + i * 3;
      const contentObj = pageObj + 1;
      const imageObj = pageObj + 2;
      const image = page.image;
      const w = page.width;
      const h = page.height;

      beginObject(pageObj);
      pushText('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 ' + imageObj + ' 0 R >> >> /Contents ' + contentObj + ' 0 R >>\n');
      endObject();

      const content = ascii('q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q\n');
      beginObject(contentObj);
      pushText('<< /Length ' + content.length + ' >>\nstream\n');
      push(content);
      pushText('endstream\n');
      endObject();

      beginObject(imageObj);
      pushText('<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height
        + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' + image.filter + ' /Length ' + image.data.length + ' >>\nstream\n');
      push(image.data);
      pushText('\nendstream\n');
      endObject();
    });

    const xrefOffset = length;
    pushText('xref\n0 ' + (objectCount + 1) + '\n');
    pushText('0000000000 65535 f \n');
    for (let n = 1; n <= objectCount; n++) pushText(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
    pushText('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }

  const api = { buildPdf, rgbaToRgb, pageSizeFor, pdfTextString, A4_LANDSCAPE_WIDTH_PT, MAX_PAGE_PT };
  const GristBI = global.GristBI || (global.GristBI = {});
  GristBI.pdfWriter = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
