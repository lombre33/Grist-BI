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
  // rejoint les items d'une page par un espace, et les pages entre elles par une LIGNE VIDE (une
  // phrase ne doit jamais fusionner la fin d'une page et le début de la suivante : un simple saut de
  // ligne est neutre pour js/keywords.js, qui n'y verrait qu'un espace, alors qu'une ligne vide coupe).
  function joinTextItems(items) {
    return (items || []).map((it) => (it && it.str != null ? it.str : '')).join(' ');
  }

  function joinPages(pageTexts) {
    return (pageTexts || []).join('\n\n');
  }

  // Un PDF commence par `%PDF-` dans ses 1024 premiers octets (la règle que GFS applique aussi avant
  // d'envoyer un PDF). Sert à écarter, dans une cellule « Pièces jointes », une image ou un document
  // Word sans le confier à PDF.js.
  function isPdfBytes(arrayBuffer) {
    if (!arrayBuffer || !arrayBuffer.byteLength) return false;
    const head = new Uint8Array(arrayBuffer, 0, Math.min(1024, arrayBuffer.byteLength));
    const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    for (let i = 0; i + marker.length <= head.length; i++) {
      let hit = true;
      for (let j = 0; j < marker.length; j++) if (head[i + j] !== marker[j]) { hit = false; break; }
      if (hit) return true;
    }
    return false;
  }

  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * Lit le texte d'un PDF à partir de son contenu binaire (ArrayBuffer, tel que renvoyé par le
   * téléchargement d'une pièce jointe Grist — voir grist-api.js). Rejette avec une erreur claire et
   * son `code` si PDF.js n'est pas (encore) disponible, plutôt que de planter plus loin sans
   * explication — c'est le prix d'une dépendance externe, même gérée par GFS (voir CLAUDE.md §8).
   *
   * Les pages sont lues UNE À UNE, en rendant la main au navigateur entre deux (consigne GFS 019,
   * point 5 : PDF.js tourne dans la page, un cadre isolé ne peut pas créer de vrai `Worker`, donc une
   * lecture d'un seul tenant figerait l'interface). Options :
   *   maxPages  pages lues au plus (défaut 80 : un mémoire de 300 pages n'a pas besoin d'être lu en
   *             entier pour en tirer ses mots-clés, et la lecture reste de l'ordre de la seconde)
   *   maxChars  caractères gardés au plus (défaut 400 000)
   *   signal    AbortSignal : la lecture s'arrête entre deux pages et rend le texte déjà lu
   *   yieldNow  rend la main entre deux pages (défaut `setTimeout 0`, remplaçable pour les tests)
   * Rend `{ text, pages, readPages, truncated }`.
   */
  async function readPdf(arrayBuffer, options) {
    if (!isAvailable()) {
      const err = new Error('PDF.js non disponible : extraction de texte PDF désactivée tant que GFS n\'a pas ajouté la bibliothèque (voir GFS-ETAT.md).');
      err.code = 'PDFJS_NOT_AVAILABLE';
      throw err;
    }
    const opts = options || {};
    const maxPages = opts.maxPages || 80;
    const maxChars = opts.maxChars || 400000;
    const yieldNow = opts.yieldNow || yieldToBrowser;
    const pdfjs = libraryFrom(globalThis);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, verbosity: 0 }).promise;
    try {
      const pageTexts = [];
      let chars = 0;
      let truncated = false;
      const last = Math.min(doc.numPages, maxPages);
      for (let pageNum = 1; pageNum <= last; pageNum++) {
        if (opts.signal && opts.signal.aborted) { truncated = true; break; }
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const text = joinTextItems(content.items);
        if (typeof page.cleanup === 'function') page.cleanup();
        pageTexts.push(text);
        chars += text.length;
        if (chars >= maxChars) { truncated = pageNum < doc.numPages; break; }
        await yieldNow();
      }
      if (doc.numPages > last && !truncated) truncated = true;
      const joined = joinPages(pageTexts);
      return { text: joined.length > maxChars ? joined.slice(0, maxChars) : joined, pages: doc.numPages, readPages: pageTexts.length, truncated };
    } finally {
      if (typeof doc.destroy === 'function') { try { await doc.destroy(); } catch (e) { /* rien à libérer de plus */ } }
    }
  }

  // Tout le texte d'un PDF, sans le détail de `readPdf` (forme d'origine de ce module).
  async function extractTextFromPdf(arrayBuffer, options) {
    return (await readPdf(arrayBuffer, options)).text;
  }

  GristBI.pdfText = { isAvailable, loadLibrary, libraryFrom, isPdfBytes, readPdf, extractTextFromPdf, joinTextItems, joinPages };

  if (typeof module === 'object' && module.exports) {
    module.exports = GristBI.pdfText;
  }
})(typeof self !== 'undefined' ? self : this);
