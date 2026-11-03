/*
 * Extraction du texte d'un PDF (déposé en pièce jointe Grist) pour alimenter l'extraction de
 * mots-clés (js/keywords.js). Nécessite PDF.js, qui n'est PAS ajouté par ce module ni par aucun
 * autre fichier de ce dépôt : depuis la décision d'Antoine du 2026-11-03 (fil "Importer des
 * fichiers Power BI"), toute bibliothèque passe par GFS (lombre33/grist-widget-GFS), qui vérifie
 * seul qu'elle est sûre/documentée/maintenue puis l'ajoute lui-même (balise CDN, hash SRI ou
 * vendoring, CSP). Ce fichier est donc écrit CONTRE L'API DE PDF.js sans jamais la charger : tant
 * que GFS n'a pas traité la demande inscrite dans GFS-ETAT.md (section "Demandes à GFS", id
 * `pdfjs-dist`), `window.pdfjsLib` est absent et `isAvailable()` renvoie false — jamais un échec
 * silencieux, voir `extractTextFromPdf`.
 *
 * `joinTextItems` est pure et testable sous Node (dev-tests/test-data.js) ; le reste a besoin d'un
 * vrai `window.pdfjsLib` donc d'un navigateur, comme le moteur SQL de duckdb-engine.js.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  function isAvailable() {
    return typeof global !== 'undefined' && !!global.pdfjsLib;
  }

  // `getTextContent()` de PDF.js renvoie `{ items: [{ str, hasEOL, ... }, ...] }` par page : on
  // rejoint les items d'une page par un espace, et les pages entre elles par un saut de ligne (une
  // phrase ne doit jamais fusionner la fin d'une page et le début de la suivante sans séparateur,
  // sinon RAKE verrait un seul mot-valise aux deux bouts de page).
  function joinTextItems(items) {
    return (items || []).map((it) => (it && it.str != null ? it.str : '')).join(' ');
  }

  function joinPages(pageTexts) {
    return (pageTexts || []).join('\n');
  }

  /**
   * Extrait tout le texte d'un PDF à partir de son contenu binaire (ArrayBuffer, tel que renvoyé par
   * le téléchargement d'une pièce jointe Grist — voir grist-api.js). Rejette avec une erreur claire
   * et son `code` si PDF.js n'est pas (encore) disponible, plutôt que de planter plus loin sans
   * explication — c'est le prix d'une dépendance externe, même gérée par GFS (voir CLAUDE.md §8).
   */
  async function extractTextFromPdf(arrayBuffer) {
    if (!isAvailable()) {
      const err = new Error('PDF.js non disponible : extraction de texte PDF désactivée tant que GFS n\'a pas ajouté la bibliothèque (voir GFS-ETAT.md).');
      err.code = 'PDFJS_NOT_AVAILABLE';
      throw err;
    }
    const doc = await global.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageTexts = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      pageTexts.push(joinTextItems(content.items));
    }
    return joinPages(pageTexts);
  }

  GristBI.pdfText = { isAvailable, extractTextFromPdf, joinTextItems, joinPages };

  if (typeof module === 'object' && module.exports) {
    module.exports = GristBI.pdfText;
  }
})(typeof self !== 'undefined' ? self : this);
