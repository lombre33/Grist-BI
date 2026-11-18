/*
 * Export du dashboard en classeur Excel (.xlsx), via ExcelJS 4.4.0 embarqué localement
 * (js/vendor/exceljs/, MIT — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe.
 *
 * Le classeur REFLÈTE LE TABLEAU DE BORD (refonte du 18/11/2026, après le retour d'Antoine sur un
 * premier export fait de « 33 feuilles de chiffres bruts, aucun graphique ») : UNE FEUILLE PAR PAGE,
 * dans l'ordre des pages, et dans chaque page UN BLOC PAR TUILE, dans l'ordre enregistré — le titre de
 * la tuile, son GRAPHIQUE EN IMAGE (PNG, tel que le widget le dessine) puis les DONNÉES qui le
 * dessinent, avec les mêmes filtres et le même drill-down qu'à l'écran. Une carte KPI, un tableau
 * croisé, une table plate, une progression ou un Gantt n'ont pas d'image : leur bloc est le tableau.
 * La composition des blocs (données de chaque tuile, y compris le calcul des mesures temporelles
 * Cumul/YTD/N-1) est faite par GristBI.data.buildExportPagesAsync, testée sous Node
 * (dev-tests/test-data.js) avec un calcul de mesure factice injecté : ce fichier ne fait QUE fournir
 * le VRAI calcul DuckDB-WASM (GristBI.duckdbEngine, lui non testable sous Node — voir CLAUDE.md §5),
 * photographier les graphiques et parler à `ExcelJS`. La mise en forme des cellules (`cellValue`) et
 * la construction du classeur (`buildWorkbook`) sont PURES vis-à-vis du DOM : ce fichier se charge
 * aussi sous Node (module.exports en bas) pour que dev-tests/test-data.js les exerce avec le vrai
 * paquet vendorisé. Ce qui reste hors Node : le chargement paresseux, la photographie des graphiques
 * (ECharts dans un vrai navigateur) et le déclenchement du téléchargement (voir HYPOTHESES.md pour ce
 * qui reste à valider en conditions réelles Grist).
 *
 * Photographie des graphiques : chaque tuile graphique est redessinée HORS ÉCRAN, à une taille fixe
 * (640 x 340 px, pixelRatio 2), sous un identifiant de copie — jamais l'instance affichée : l'écran n'est
 * pas touché, et les tuiles des AUTRES pages (qui n'ont plus d'instance quand on a changé de page) sortent
 * comme celles de la page courante. Même fonction de dessin que l'écran (GristBI.charts.renderTile) :
 * ce que l'on voit dans Excel est ce que le widget dessine, filtres croisés et drill-down compris.
 *
 * Historique : SheetJS 0.18.5 jusqu'à la consigne GFS 017 (18/11/2026, deux avis de sécurité
 * publiés, dont les versions corrigées ne sont qu'à cdn.sheetjs.com) ; Antoine a choisi ExcelJS,
 * déjà celui de Publipostage+ (harmonisation des dépendances, même fichier, même empreinte).
 *
 * Consigne GFS 013 (10/11/2026), conservée : la bibliothèque (947 Ko) n'est pas une balise
 * statique d'index.html — elle ne sert qu'à CET export, donc chargée ici paresseusement au premier
 * appel, comme pdfmake/PptxGenJS (js/pdf-export.js/js/pptx-export.js), mais depuis la même origine
 * que le reste du widget plutôt qu'un CDN externe (aucune adresse nouvelle, aucun changement de
 * politique réseau).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // Capturé de façon SYNCHRONE au chargement de CE script (document.currentScript n'est fiable
  // qu'à l'exécution synchrone initiale) : URL absolue d'ExcelJS, pour que le chemin reste correct
  // quel que soit le document HTML qui charge ce script (index.html à la racine, dev-tests/
  // harness.html dans un sous-dossier) — même technique que js/duckdb-engine.js:VENDOR_BASE_URL.
  // Vide hors navigateur (Node : les tests passent l'objet ExcelJS eux-mêmes).
  const EXCELJS_LIB_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
    ? new URL('vendor/exceljs/exceljs.min.js', document.currentScript.src).href
    : '';
  let excelJsLibPromise = null;

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const FILE_NAME = 'dashboard-bi.xlsx';
  // Limite d'Excel : 32 767 caractères par cellule. ExcelJS n'y coupe rien (le classeur ouvrirait
  // alors avec un message de réparation) : on tronque nous-mêmes.
  const MAX_CELL_CHARS = 32767;

  // Mise en page d'une feuille. Une ligne d'Excel fait 15 points = 20 px par défaut : c'est ce qui permet de réserver,
  // sous une image, exactement les lignes qu'elle recouvre.
  const ROW_PX = 20;
  const IMAGE_DISPLAY_W = 560;          // largeur de l'image dans la feuille (px)
  const FIRST_COL_WIDTH = 30;           // 1re colonne : les libellés (catégories, mesures)
  const OTHER_COL_WIDTH = 16;
  const MIN_BLOCK_COLS = 4;             // largeur minimale du bandeau de titre d'un bloc
  const TEXT_BLOCK_COLS = 6;            // une note (tuile Texte) s'étale sur six colonnes
  const SHEET_ROW_BUDGET = 1000000;     // Excel s'arrête à 1 048 576 lignes : on garde de la marge
  const BORDER_ROWS_MAX = 2000;         // au-delà, seuls l'en-tête et les valeurs : un trait par cellule pèse
  const COLOR_TITLE_FILL = 'FFEEF1F6';
  const COLOR_HEADER_FILL = 'FFDDE3EC';
  const COLOR_BORDER = 'FFC9D0DB';
  const COLOR_MUTED = 'FF6B6A64';

  // Photographie des graphiques (navigateur seulement).
  const CAPTURE_W = 640;
  const CAPTURE_H = 340;
  const CAPTURE_BATCH = 10;             // graphiques dessinés à la fois : borne la mémoire des canevas
  const ANIMATION_WAIT_MS = 3000;       // l'animation d'entrée d'ECharts dure ~1 s ; on n'attend jamais plus

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Échec de chargement du script : ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureExcelJsLoaded() {
    if (typeof ExcelJS !== 'undefined') return Promise.resolve();
    if (!excelJsLibPromise) {
      excelJsLibPromise = loadScriptOnce(EXCELJS_LIB_URL).catch((e) => { excelJsLibPromise = null; throw e; });
    }
    return excelJsLibPromise;
  }

  // Valeur d'une cellule du classeur. Même contrat qu'avant avec SheetJS (`aoa_to_sheet`) : nombre,
  // texte, booléen, date, cellule VIDE pour null/undefined, cellule d'ERREUR pour un nombre non fini
  // (ExcelJS écrirait sinon `NaN` en clair dans le XML : Excel proposerait de « réparer » le fichier).
  // Tout objet ou tableau (liste de choix Grist, cellule d'erreur Grist `['E', …]`) devient son texte,
  // jamais l'objet lui-même : ExcelJS lit un objet comme une FORMULE, un lien ou du texte riche.
  // Un texte, lui, reste toujours du texte — même s'il commence par `=`, `+`, `-` ou `@` : ExcelJS ne
  // pose une formule que pour un objet `{ formula }`, jamais pour une chaîne (voir GFS-ETAT.md, 005).
  function cellValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return v;
      return { error: Number.isNaN(v) ? '#NUM!' : '#DIV/0!' };
    }
    if (typeof v === 'bigint') {
      // DuckDB-WASM rend un entier en BigInt (voir CLAUDE.md §7, piège n°23) ; Excel n'a que des doubles.
      return (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : String(v);
    }
    if (typeof v === 'boolean') return v;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const s = String(v);
    return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) : s;
  }

  // Une somme de flottants s'écrit « 3266234.2699999986 » : ce bruit n'est pas une donnée. Six décimales le
  // ramènent à 3266234.27 sans rien perdre qu'un tableau de bord montre ; au-delà de 1e9 (où 1e6 x la valeur
  // approche la limite des entiers exacts d'un double) la valeur est laissée telle quelle.
  function tidyNumber(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e9) return v;
    const r = Math.round(v * 1e6) / 1e6;
    return Number.isFinite(r) ? r : v;
  }

  // Format d'affichage d'un nombre qui n'est pas un libellé : entier avec séparateur de milliers, sinon deux
  // décimales (jusqu'à quatre sous 1, pour qu'une moyenne de 0,0006 ne s'affiche pas « 0,00 »). Excel les écrit
  // avec les séparateurs de LA LANGUE de la personne qui ouvre le fichier.
  function numberFormatFor(v) {
    if (Number.isInteger(v)) return '#,##0';
    return Math.abs(v) < 1 ? '0.00##' : '#,##0.00';
  }

  // Un en-tête de colonne est TOUJOURS du texte (même « 2022 » : c'est un nom, pas une valeur).
  function headerText(h) {
    return cellValue(h === null || h === undefined ? '' : String(h));
  }

  function fillRange(ws, row, fromCol, toCol, argb) {
    for (let col = fromCol; col <= toCol; col++) {
      ws.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
  }

  function thinBorder() {
    const side = { style: 'thin', color: { argb: COLOR_BORDER } };
    return { top: side, left: side, bottom: side, right: side };
  }

  // Nombre de lignes de 20 px que recouvre une image de `height` px.
  function rowsCoveredBy(height) {
    return Math.max(1, Math.ceil(height / ROW_PX));
  }

  // Hauteur (en points) d'une cellule de texte étalée sur `chars` caractères de large : une ligne par retour
  // à la ligne, plus les retours automatiques estimés.
  function textRowHeight(text, chars) {
    const lines = String(text).split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
    return Math.min(409, Math.max(15, lines * 15)); // 409 pt : la hauteur maximale d'une ligne d'Excel
  }

  // Hauteur (en points) d'une ligne d'en-tête dont les noms peuvent passer à la ligne dans leur colonne (gras : ~15 % plus large).
  function headerRowHeight(header) {
    const lines = header.reduce((n, h, i) => {
      const width = (i === 0 ? FIRST_COL_WIDTH : OTHER_COL_WIDTH) * 0.85;
      return Math.max(n, Math.ceil(String(h === null || h === undefined ? '' : h).length / width));
    }, 1);
    return Math.min(409, Math.max(1, lines) * 15 + (lines > 1 ? 3 : 0));
  }

  // Construit le classeur ExcelJS à partir des pages de GristBI.data.buildExportPagesAsync : une feuille par
  // page, un bloc par tuile (`block.image` = `{ base64, width, height }`, l'image PNG déjà photographiée par
  // `captureTileImages`, ou absente). `ExcelJSLib` est passé en paramètre (le global `ExcelJS` dans le
  // navigateur, le paquet vendorisé sous Node) : cette fonction ne touche ni au DOM ni au réseau.
  // `opts.title(block)` = titre affiché d'une tuile (celui de l'écran, traduit), `opts.subtitle(page)` = ligne
  // sous le titre de page, `opts.labels` = textes fixes (traduits par l'appelant) ; tous facultatifs.
  function buildWorkbook(ExcelJSLib, pages, opts) {
    const options = opts || {};
    const labels = Object.assign({
      noImage: 'Graphique indisponible pour cette tuile : ses données sont ci-dessous.',
      truncated: (n) => '… ' + n + ' lignes de plus ne sont pas exportées',
      cut: 'Feuille pleine : les tuiles suivantes de cette page ne sont pas exportées.'
    }, options.labels || {});
    const wb = new ExcelJSLib.Workbook();
    wb.creator = 'Grist BI';
    wb.lastModifiedBy = 'Grist BI';
    for (const page of pages) {
      // Imprimable : toute la largeur de la page sur une feuille A4 (sinon un tableau large se coupe en deux pages à l'impression).
      const ws = wb.addWorksheet(page.name, {
        properties: { defaultRowHeight: 15 },
        views: [{ showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      const widestTable = page.blocks.reduce((n, b) => Math.max(n, (b.header || []).length), MIN_BLOCK_COLS);
      for (let col = 1; col <= widestTable; col++) ws.getColumn(col).width = col === 1 ? FIRST_COL_WIDTH : OTHER_COL_WIDTH;

      let r = 1;
      ws.getCell(r, 1).value = cellValue(page.title === undefined ? page.name : page.title);
      ws.getCell(r, 1).font = { bold: true, size: 16 };
      ws.getRow(r).height = 24;
      r += 1;
      const subtitle = typeof options.subtitle === 'function' ? options.subtitle(page) : null;
      if (subtitle) {
        ws.getCell(r, 1).value = cellValue(subtitle);
        ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
        r += 1;
      }
      r += 1;

      for (const block of page.blocks) {
        const header = block.header || [];
        const rows = block.rows || [];
        const image = block.image || null;
        const imageRows = image ? rowsCoveredBy(image.height) : 0;
        // Un bloc qui ne tiendrait plus dans la feuille n'est pas écrit à moitié : on le dit et on s'arrête.
        const needed = 2 + (image ? imageRows + 1 : 1) + rows.length + 3;
        if (r + needed > SHEET_ROW_BUDGET) {
          ws.getCell(r, 1).value = cellValue(labels.cut);
          ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
          break;
        }
        const lastCol = Math.max(header.length, MIN_BLOCK_COLS);
        const title = typeof options.title === 'function' ? options.title(block) : block.name;

        // Bandeau de titre.
        ws.getCell(r, 1).value = cellValue(title === undefined || title === null ? '' : String(title));
        ws.getCell(r, 1).font = { bold: true, size: 12 };
        ws.getRow(r).height = 20;
        fillRange(ws, r, 1, lastCol, COLOR_TITLE_FILL);
        r += 1;

        if (block.kind === 'text') {
          // Une note : le texte lui-même, étalé et à la ligne.
          const text = rows.length && rows[0].length ? String(rows[0][0] == null ? '' : rows[0][0]) : '';
          ws.mergeCells(r, 1, r, TEXT_BLOCK_COLS);
          const cell = ws.getCell(r, 1);
          cell.value = cellValue(text);
          cell.alignment = { wrapText: true, vertical: 'top' };
          let chars = FIRST_COL_WIDTH + OTHER_COL_WIDTH * (TEXT_BLOCK_COLS - 1);
          chars = Math.max(20, Math.floor(chars * 0.9));
          ws.getRow(r).height = textRowHeight(text, chars);
          r += 1 + 2;
          continue;
        }

        if (image) {
          const imageId = wb.addImage({ base64: String(image.base64).replace(/^data:image\/png;base64,/, ''), extension: 'png' });
          ws.addImage(imageId, { tl: { col: 0, row: r - 1 }, ext: { width: image.width, height: image.height }, editAs: 'oneCell' });
          r += imageRows + 1;
        } else if (block.kind === 'image') {
          ws.getCell(r, 1).value = cellValue(labels.noImage);
          ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
          r += 1;
        }

        // Les données : en-tête puis lignes. La 1re colonne est celle des libellés (catégories, mesures, années) :
        // jamais de séparateur de milliers sur « 2 022 ».
        const border = rows.length <= BORDER_ROWS_MAX;
        header.forEach((h, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = headerText(h);
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_FILL } };
          cell.alignment = { wrapText: true, vertical: 'middle' };
          cell.border = thinBorder();
        });
        // Hauteur EXPLICITE : une ligne d'en-tête à retour à la ligne que le tableur ajusterait seul décalerait toutes les lignes
        // d'en dessous APRÈS la pose des images (LibreOffice les place avant l'ajustement), et les images viendraient recouvrir
        // les titres des blocs suivants.
        ws.getRow(r).height = headerRowHeight(header);
        r += 1;
        for (const row of rows) {
          row.forEach((raw, i) => {
            const v = tidyNumber(raw);
            const cell = ws.getCell(r, i + 1);
            const value = cellValue(v);
            cell.value = value;
            if (i > 0 && typeof value === 'number') cell.numFmt = numberFormatFor(value);
            else if (i === 0 && typeof value === 'number') cell.alignment = { horizontal: 'left' }; // un libellé (2022), pas une valeur
            else if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
            if (border) cell.border = thinBorder();
          });
          r += 1;
        }
        if (block.truncated) {
          ws.getCell(r, 1).value = cellValue(labels.truncated(block.truncated));
          ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
          r += 1;
        }
        r += 2; // deux lignes d'air avant le bloc suivant
      }
    }
    return wb;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    // Dans le DOM le temps du clic synthétique : certains navigateurs ignorent un clic sur une
    // ancre détachée. Jamais vérifié en conditions réelles Grist/GFS (voir HYPOTHESES.md) : dans le
    // cadre isolé de GFS (`sandbox="allow-scripts"`), un téléchargement peut demander `allow-downloads`.
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }

  // Calcul réellement injecté dans buildExportPagesAsync pour une tuile Barres en mode mesure
  // (Cumul/YTD/N-1, voir js/data.js) : même appel que js/charts.js:renderMeasureChart, pour que
  // l'export contienne EXACTEMENT les mêmes valeurs que ce qui est affiché à l'écran.
  function computeMeasureSeries(tile, rows) {
    return GristBI.duckdbEngine.timeSeriesMeasures(rows, tile.dateColumn, tile.measure, tile.aggFn);
  }

  // ---- Photographie des graphiques (navigateur seulement) ---------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Une image par image d'écran écoulée : ECharts ne dessine qu'à la prochaine image. Repli sur un délai si la
  // page est masquée (requestAnimationFrame ne tourne alors pas) : on ne bloque jamais l'export.
  function nextFrame() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
      setTimeout(finish, 120);
    });
  }

  // Attend la fin de l'animation d'entrée des graphiques (sinon une barre est photographiée à mi-course).
  async function waitForAnimations(instances) {
    await nextFrame();
    await nextFrame();
    const deadline = Date.now() + ANIMATION_WAIT_MS;
    while (Date.now() < deadline) {
      const running = instances.some((inst) => {
        try {
          const zr = inst.getZr && inst.getZr();
          return zr && zr.animation && typeof zr.animation.isFinished === 'function' && !zr.animation.isFinished();
        } catch (e) { return false; }
      });
      if (!running) return;
      await sleep(50);
    }
  }

  // Couleur de fond de la photo : celle de la tuile à l'écran (le thème sombre garde ses textes clairs lisibles).
  function surfaceColor(host) {
    try {
      const cs = getComputedStyle(host);
      return cs.getPropertyValue('--dash-tile-surface').trim() || cs.getPropertyValue('--surface').trim() || '#ffffff';
    } catch (e) { return '#ffffff'; }
  }

  // L'état vu par la COPIE d'une tuile : un filtre croisé posé par la tuile elle-même ne la filtre pas (elle reste
  // cliquable sur tous ses segments), et son chemin de drill-down est le sien — le tout rattaché à l'id de la copie.
  function stateForClone(state, tile, cloneId) {
    const drillIns = Object.assign({}, state.drillIns || {});
    if (drillIns[tile.id]) drillIns[cloneId] = drillIns[tile.id];
    return Object.assign({}, state, {
      activeFilters: (state.activeFilters || []).map((f) => (f.sourceTileId === tile.id ? Object.assign({}, f, { sourceTileId: cloneId }) : f)),
      drillIns
    });
  }

  // Une image PNG (data URL) par tuile graphique, sous la forme `Map(tileId -> { base64, width, height })`. Une tuile dont
  // le dessin échoue, ou qui n'a rien à montrer (aucune ligne après les filtres), n'a pas d'entrée : son bloc n'a que ses
  // données et le dit (`labels.noImage`). Jamais d'exception : un graphique raté ne fait pas échouer tout le classeur.
  async function captureTileImages(pages, state) {
    const images = new Map();
    const blocks = [];
    for (const page of pages) for (const block of page.blocks) if (block.kind === 'image') blocks.push(block);
    if (!blocks.length || typeof document === 'undefined' || typeof echarts === 'undefined' || !GristBI.charts) return images;

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Hors de la fenêtre mais MIS EN PAGE (jamais display:none : ECharts mesure son conteneur).
    host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
    document.body.appendChild(host);
    const background = surfaceColor(host);
    let seq = 0;
    try {
      for (let i = 0; i < blocks.length; i += CAPTURE_BATCH) {
        const batch = blocks.slice(i, i + CAPTURE_BATCH).map((block) => {
          const cloneId = '__xl_' + (seq++);
          // Pas de classe `tile` : sa feuille de style impose une hauteur et un flux que la photo ne veut pas.
          const wrap = document.createElement('div');
          wrap.setAttribute('data-tile-id', cloneId);
          const el = document.createElement('div');
          el.className = 'tile-chart';
          el.style.cssText = 'width:' + CAPTURE_W + 'px;height:' + CAPTURE_H + 'px;';
          wrap.appendChild(el);
          host.appendChild(wrap);
          return { block, cloneId, wrap, tile: Object.assign({}, block.tile, { id: cloneId }) };
        });
        await Promise.all(batch.map(async (item) => {
          try { await GristBI.charts.renderTile(item.tile, stateForClone(state, item.block.tile, item.cloneId), host); }
          catch (e) { console.warn('[GristBI] export Excel : graphique non dessiné', item.block.tileId, e); }
        }));
        const live = batch.map((item) => GristBI.charts.getInstance(item.cloneId)).filter((inst) => inst && !inst.isDisposed());
        await waitForAnimations(live);
        for (const item of batch) {
          try {
            const inst = GristBI.charts.getInstance(item.cloneId);
            if (!inst || inst.isDisposed() || typeof inst.getDataURL !== 'function') continue;
            // Un graphique sans série (aucune donnée) est un cadre vide : mieux vaut dire « indisponible ».
            const option = typeof inst.getOption === 'function' ? inst.getOption() : null;
            if (option && !(option.series && option.series.length)) continue;
            let width = typeof inst.getWidth === 'function' ? inst.getWidth() : CAPTURE_W;
            let height = typeof inst.getHeight === 'function' ? inst.getHeight() : CAPTURE_H;
            let dataUrl;
            if (inst.isWordCloudCanvas) {
              // Le nuage de mots est un <canvas> maison (pas ECharts) : masqué quand l'extension de GFS manque (alors son bloc n'a
              // que ses données), transparent sinon — posé sur le fond de la tuile comme un graphique ECharts.
              const canvas = item.wrap.querySelector('canvas');
              if (!canvas || canvas.style.display === 'none' || !canvas.width || !canvas.height) continue;
              const flat = document.createElement('canvas');
              flat.width = canvas.width;
              flat.height = canvas.height;
              const g = flat.getContext('2d');
              g.fillStyle = background;
              g.fillRect(0, 0, flat.width, flat.height);
              g.drawImage(canvas, 0, 0);
              dataUrl = flat.toDataURL('image/png');
              width = canvas.width;
              height = canvas.height;
            } else {
              dataUrl = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: background });
            }
            if (!dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) continue;
            images.set(item.block.tileId, {
              base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
              width: IMAGE_DISPLAY_W,
              height: Math.max(1, Math.round(IMAGE_DISPLAY_W * height / Math.max(1, width)))
            });
          } catch (e) {
            console.warn('[GristBI] export Excel : photo du graphique impossible', item.block.tileId, e);
          }
        }
        for (const item of batch) { GristBI.charts.disposeTile(item.cloneId); item.wrap.remove(); }
      }
    } finally {
      for (const item of Array.from(host.children)) GristBI.charts.disposeTile(item.getAttribute('data-tile-id'));
      host.remove();
    }
    return images;
  }

  // Titre d'une tuile tel qu'on le lit à l'écran (traduit, titre automatique compris) ; repli sur le nom de l'export.
  function displayTitle(block) {
    try {
      const title = GristBI.i18n && block.tile ? GristBI.i18n.tileTitle(block.tile) : '';
      return title || block.name;
    } catch (e) { return block.name; }
  }

  // Déclenche le téléchargement d'un classeur .xlsx : une feuille par page du dashboard (toutes les pages), un bloc
  // par tuile (graphique en image + données). Retourne `false` sans rien déclencher s'il n'y a aucune tuile à
  // exporter (à l'appelant de prévenir l'utilisateur, voir main.js) plutôt que de télécharger un classeur vide qui
  // n'apporterait rien. ASYNCHRONE (calcul des mesures temporelles, photo des graphiques) — à l'appelant
  // d'attendre la promesse (main.js).
  async function exportDashboardToExcel(state) {
    await ensureExcelJsLoaded().catch(() => { /* le test ci-dessous produit le message existant */ });
    if (typeof ExcelJS === 'undefined') {
      throw new Error("ExcelJS indisponible (js/vendor/exceljs/exceljs.min.js ne s'est pas chargé) — voir le bandeau ECharts pour un diagnostic similaire.");
    }
    const pages = await GristBI.data.buildExportPagesAsync(state, computeMeasureSeries);
    if (!pages.length) return false;
    const images = await captureTileImages(pages, state);
    for (const page of pages) for (const block of page.blocks) if (images.has(block.tileId)) block.image = images.get(block.tileId);

    const t = GristBI.i18n.t;
    const filterCount = (state.activeFilters || []).length + (state.advancedFilters || []).length;
    const date = new Date().toLocaleDateString(GristBI.i18n.getLang() === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const wb = buildWorkbook(ExcelJS, pages, {
      title: displayTitle,
      subtitle: () => t('export.xlsx.subtitle', { date, rows: state.rows.length.toLocaleString(GristBI.i18n.getLang() === 'en' ? 'en-GB' : 'fr-FR') }) + (filterCount ? ' · ' + t('export.xlsx.filters', { n: filterCount }) : ''),
      labels: {
        noImage: t('export.xlsx.noImage'),
        truncated: (n) => t('export.xlsx.truncated', { n }),
        cut: t('export.xlsx.cut')
      }
    });
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), FILE_NAME);
    return true;
  }

  const api = { exportDashboardToExcel, buildWorkbook, cellValue, tidyNumber, numberFormatFor, captureTileImages, stateForClone };
  GristBI.exportExcel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
