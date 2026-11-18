/*
 * Extraction du texte d'un PDF (déposé en pièce jointe Grist) pour alimenter l'extraction de
 * mots-clés (js/keywords.js). Nécessite PDF.js, qui n'est PAS ajouté par ce module ni par aucun
 * autre fichier de ce dépôt : depuis la décision d'Antoine du 2026-11-03, toute bibliothèque passe
 * par GFS (lombre33/grist-widget-GFS), qui l'ajoute lui-même (copie vendorisée, empreinte, CSP).
 * Ce fichier est écrit CONTRE ce que GFS fournit pour `pdfjs` (relevé le 2026-11-18 : bibliothèque
 * `pdfjs` 1.0.0, forme `module`, pdfjs-dist 6.5.438) : GFS donne à l'app `{ src, integrite, forme }`
 * (`contexte.bibliotheques.pdfjs`), l'app charge `src` par `<script type="module" integrity
 * crossorigin="anonymous">` (jamais `import()`), et le module est alors posé dans
 * `globalThis.GfsPaquets.pdfjs.modules['pdfjs-dist/build/pdf.min.mjs']` (le worker est dans le même
 * fichier). `loadLibrary(source)` fait ce chargement quand l'appelant lui donne la source ; tant
 * qu'elle n'existe pas, `isAvailable()` renvoie false — jamais un échec silencieux.
 *
 * `joinTextItems`/`joinPages`/`libraryFrom` sont pures et testables sous Node
 * (dev-tests/test-data.js) ; le chargement réel a besoin d'un navigateur et de GFS, comme le moteur
 * SQL de duckdb-engine.js.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const MODULE_KEY = 'pdfjs-dist/build/pdf.min.mjs';

  // Le module pdf.js posé par GFS dans `GfsPaquets`, ou null. Relu à chaque appel (jamais figé).
  function libraryFrom(scope) {
    const set = scope && scope.GfsPaquets && scope.GfsPaquets.pdfjs;
    return (set && set.modules && set.modules[MODULE_KEY]) || null;
  }

  function isAvailable() {
    return !!libraryFrom(globalThis);
  }

  // Charge pdf.js par la source que GFS donne (`{ src, integrite }`). Rend le module ou rejette avec
  // un message clair (réseau, politique de sécurité, empreinte, fichier qui ne pose pas GfsPaquets.pdfjs).
  function loadLibrary(source) {
    const ready = libraryFrom(globalThis);
    if (ready) return Promise.resolve(ready);
    if (!source || !source.src || !source.integrite) {
      const err = new Error('GFS ne donne pas pdf.js : l\'extension n\'est pas active (voir GFS-ETAT.md).');
      err.code = 'PDFJS_NOT_AVAILABLE';
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = source.src;
      script.integrity = source.integrite;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const lib = libraryFrom(globalThis);
        if (lib) resolve(lib);
        else reject(new Error('Le fichier est chargé mais ne pose pas GfsPaquets.pdfjs.'));
      };
      script.onerror = () => reject(new Error('Le navigateur a refusé le script pdf.js (politique de sécurité, réseau ou empreinte).'));
      document.head.append(script);
    });
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
    const pdfjs = libraryFrom(globalThis);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, verbosity: 0 }).promise;
    const pageTexts = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      pageTexts.push(joinTextItems(content.items));
    }
    return joinPages(pageTexts);
  }

  GristBI.pdfText = { isAvailable, loadLibrary, libraryFrom, extractTextFromPdf, joinTextItems, joinPages };

  if (typeof module === 'object' && module.exports) {
    module.exports = GristBI.pdfText;
  }
})(typeof self !== 'undefined' ? self : this);
