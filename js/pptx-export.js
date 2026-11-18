/*
 * Export du tableau de bord en PPTX via PptxGenJS (refait le 18/11/2026, demande d'Antoine : « même visuel » que le tableau de bord).
 *
 * Deux défauts réels corrigés :
 *  1. PptxGenJS n'a JAMAIS pu se charger : l'adresse choisie le 29/09/2026 (cdnjs.cloudflare.com/ajax/libs/pptxgenjs/4.0.1/...) n'existe pas —
 *     cdnjs n'héberge pas cette bibliothèque (404 pour toute version et toute casse, mesuré le 18/11/2026 depuis le navigateur d'Antoine), et
 *     le message « vérifiez votre connexion » accusait le réseau. Le même fichier (4.0.1, 460 889 octets, même empreinte SRI) est servi
 *     par jsDelivr, qui publie tel quel le paquet npm : seule l'adresse change.
 *  2. Une diapositive par tuile avec des tableaux en nombres bruts (« 567.0545607638886 ») ne ressemblait pas au tableau de bord.
 *
 * Maintenant : diapositive 1 = la page du tableau de bord telle qu'elle est dessinée (js/snapshot.js : même grille, disposition et style),
 * puis une diapositive par tuile (la carte telle qu'à l'écran, KPI, table, tableau croisé et texte compris). Des images, pas des objets
 * PowerPoint modifiables : c'est ce qui garantit le même visuel.
 *
 * Périmètre : la page actuellement affichée seulement (comme le PDF) ; PptxGenJS est chargé à la demande depuis un CDN externe (dérogation
 * d'Antoine du 29/09/2026 : pas de vendorisation), avec une version figée et une empreinte SRI.
 *
 * Reste à confirmer dans un vrai Grist : le chargement depuis jsDelivr et le téléchargement du .pptx depuis le cadre isolé de GFS (essayés avec
 * la vraie bibliothèque servie localement à la place de l'adresse du CDN, dans une page directe et dans un <iframe sandbox>).
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});

  // Mesuré le 18/11/2026 depuis le navigateur d'Antoine : jsDelivr et unpkg servent ce fichier avec exactement cette empreinte, calculée
  // aussi sur le paquet npm officiel `pptxgenjs@4.0.1` (`dist/pptxgen.bundle.js`, qui embarque JSZip et expose `window.PptxGenJS`).
  // Recalculer l'empreinte si la version change : `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
  const PPTX_LIB_URL = {
    src: 'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js',
    integrity: 'sha384-qb0Xhi7LLYpvW1HCK6oMrmDLSY9sy7vwm6ZlV6KjtrlL9yg30+YN4neTwnmX+Kp8'
  };
  const FILE_NAME = 'dashboard-bi.pptx';
  // Marque l'erreur « la bibliothèque n'a pas pu être chargée » (réseau, pare-feu, empreinte SRI qui ne correspond plus) : js/main.js ne l'annonce
  // comme un problème de connexion que pour elle, et dit simplement « échec » pour toute autre erreur.
  const LOAD_ERROR_CODE = 'PPTX_LIB_LOAD';
  let pptxLibPromise = null;

  // Le chargement passe par le chargeur unique (js/loader.js) : https seulement, l'hôte de la liste, l'empreinte posée sur l'élément
  // (le navigateur refuse un fichier modifié), aucun `Referer` envoyé au CDN. Toute erreur (refus avant chargement comme échec du
  // réseau) porte le code `PPTX_LIB_LOAD` : c'est celui que `js/main.js` sait annoncer.
  const PPTX_LIB_HOSTS = ['cdn.jsdelivr.net'];

  function loadScriptOnce(lib) {
    return GristBI.loader.script({ src: lib.src, integrity: lib.integrity, hosts: PPTX_LIB_HOSTS, referrer: 'no-referrer' }).catch((cause) => {
      const e = new Error('Échec de chargement du script : ' + lib.src);
      e.code = LOAD_ERROR_CODE;
      e.cause = cause;
      throw e;
    });
  }

  function ensurePptxLibLoaded() {
    if (typeof global.PptxGenJS === 'function') return Promise.resolve();
    if (!pptxLibPromise) {
      pptxLibPromise = loadScriptOnce(PPTX_LIB_URL).catch((e) => { pptxLibPromise = null; throw e; });
    }
    return pptxLibPromise;
  }

  // Diapositive large 16:9 (13,333 x 7,5 pouces), marge de 0,3 pouce.
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;
  const MARGIN = 0.3;
  const CSS_DPI = 96;
  const MAX_ZOOM = 3;

  // Place une image de `pxWidth` x `pxHeight` px CSS dans la diapositive, centrée : la plus grande possible sans sortir des marges, mais jamais à
  // plus de trois fois sa taille naturelle (une tuile est photographiée à l'échelle 3 ; au-delà elle serait floue). Rend { x, y, w, h } en pouces.
  function fitInSlide(pxWidth, pxHeight) {
    const w = Math.max(1, Number(pxWidth) || 1);
    const h = Math.max(1, Number(pxHeight) || 1);
    const k = Math.min((SLIDE_W - MARGIN * 2) / w, (SLIDE_H - MARGIN * 2) / h, MAX_ZOOM / CSS_DPI);
    const width = w * k;
    const height = h * k;
    return { x: (SLIDE_W - width) / 2, y: (SLIDE_H - height) / 2, w: width, h: height };
  }

  // Couleur (RRGGBB) du coin de l'image : le fond de la diapositive la prolonge, sans bande d'une autre teinte autour de l'image.
  function cornerColor(canvas) {
    try {
      const px = canvas.getContext('2d').getImageData(1, 1, 1, 1).data;
      return [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    } catch (e) { return 'FFFFFF'; }
  }

  function addPictureSlide(pptx, shot, altText) {
    const slide = pptx.addSlide();
    slide.background = { color: cornerColor(shot.canvas) };
    const box = fitInSlide(shot.width, shot.height);
    slide.addImage({ data: shot.canvas.toDataURL('image/png'), x: box.x, y: box.y, w: box.w, h: box.h, altText: altText || '' });
  }

  // Retourne `false` sans rien déclencher si la page courante n'a aucune tuile — même contrat que exportDashboardToPdf / exportDashboardToExcel.
  async function exportDashboardToPptx(state) {
    const page = GristBI.snapshot.currentPageOf(state);
    if (!page || !page.tiles.length) return false;
    await ensurePptxLibLoaded();
    const pageShot = await GristBI.snapshot.capturePage(state, { scale: 2 });
    const pptx = new global.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = page.name;
    addPictureSlide(pptx, pageShot, page.name);
    for (const tile of page.tiles) {
      // Les graphiques viennent d'être attendus par la photographie de la page : pas de nouvelle attente par tuile.
      const shot = await GristBI.snapshot.captureTile(tile.id, { scale: MAX_ZOOM, skipSettle: true });
      if (shot) addPictureSlide(pptx, shot, GristBI.i18n.tileTitle(tile));
    }
    const blob = await pptx.write({ outputType: 'blob' });
    GristBI.snapshot.downloadBlob(blob, FILE_NAME);
    return true;
  }

  const api = { exportDashboardToPptx, fitInSlide, PPTX_LIB_URL, LOAD_ERROR_CODE };
  GristBI.exportPptx = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
