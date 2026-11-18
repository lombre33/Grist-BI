/*
 * Export du dashboard en classeur Excel (.xlsx), via ExcelJS 4.4.0 embarqué localement
 * (js/vendor/exceljs/, MIT — même raisonnement que js/vendor/echarts/, voir index.html) plutôt
 * que chargé depuis un CDN externe.
 *
 * Le classeur REFLÈTE LE TABLEAU DE BORD (refonte du 18/11/2026, après le retour d'Antoine sur un
 * premier export fait de « 33 feuilles de chiffres bruts, aucun graphique », puis sur un deuxième où
 * « les tuiles sont les unes sous les autres » et les données éparpillées). Pour CHAQUE PAGE, dans
 * l'ordre des pages :
 *   - une feuille « tableau de bord » qui reprend la MISE EN PAGE de l'écran (la disposition de la page,
 *     son style) : une image par tuile — graphique, chiffre, tableau ou note —, la carte telle qu'on la
 *     voit, posée là où l'écran la met (`GristBI.layouts.slots`), avec les mêmes filtres croisés et le même
 *     drill-down qu'à l'écran ;
 *   - les DONNÉES de ses tuiles, regroupées dans une feuille de données (une par page, par défaut) où
 *     chaque tuile est un vrai TABLEAU EXCEL nommé (filtres, tri, tableau croisé dynamique en deux clics),
 *     avec des liens d'une feuille à l'autre.
 * Une note (tuile Texte) n'a pas de données : elle n'est que sur le tableau de bord.
 * La composition des blocs (données de chaque tuile, y compris le calcul des mesures temporelles
 * Cumul/YTD/N-1) est faite par GristBI.data.buildExportPagesAsync, testée sous Node
 * (dev-tests/test-data.js) avec un calcul de mesure factice injecté : ce fichier ne fait QUE fournir
 * le VRAI calcul DuckDB-WASM (GristBI.duckdbEngine, lui non testable sous Node — voir CLAUDE.md §5),
 * photographier les cartes et parler à `ExcelJS`. La mise en forme des cellules (`cellValue`) et
 * la construction du classeur (`buildWorkbook`) sont PURES vis-à-vis du DOM : ce fichier se charge
 * aussi sous Node (module.exports en bas) pour que dev-tests/test-data.js les exerce avec le vrai
 * paquet vendorisé. Ce qui reste hors Node : le chargement paresseux, la photographie des cartes
 * (ECharts et `GristBI.snapshot` dans un vrai navigateur) et le déclenchement du téléchargement (voir
 * HYPOTHESES.md pour ce qui reste à valider en conditions réelles Grist).
 *
 * Photographie des cartes : chaque tuile est reconstruite HORS ÉCRAN (`GristBI.buildTileElement`, le
 * même corps que l'aperçu du panneau), à la taille de sa place dans la mise en page, sous un
 * identifiant de copie — jamais l'instance affichée : l'écran n'est pas touché, et les tuiles des AUTRES
 * pages (qui n'ont plus d'élément ni d'instance quand on a changé de page) sortent comme celles de la
 * page courante. Même fonction de dessin que l'écran (GristBI.charts.renderTile), puis
 * `GristBI.snapshot.capture` (js/snapshot.js, celui du PDF et du PPTX) : ce que l'on voit dans Excel est
 * ce que le widget dessine, style global compris.
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

  // Mise en page des feuilles de données.
  const FIRST_COL_WIDTH = 30;           // 1re colonne : les libellés (catégories, mesures)
  const OTHER_COL_WIDTH = 16;
  const MIN_BLOCK_COLS = 4;             // largeur minimale du bandeau de titre d'un tableau
  const SHEET_ROW_BUDGET = 1000000;     // Excel s'arrête à 1 048 576 lignes : on garde de la marge
  const BORDER_ROWS_MAX = 2000;         // au-delà, seuls l'en-tête et les valeurs : un trait par cellule pèse
  const COLOR_TITLE_FILL = 'FFEEF1F6';
  const COLOR_HEADER_FILL = 'FFDDE3EC';
  const COLOR_BORDER = 'FFC9D0DB';
  const COLOR_MUTED = 'FF6B6A64';
  const COLOR_LINK = 'FF1F5FBF';

  // Photographie des tuiles (navigateur seulement).
  const CAPTURE_SCALE = 2;              // finesse des images (2 = écran dense)
  const CAPTURE_BATCH = 10;             // tuiles dessinées à la fois : borne la mémoire des canevas
  const ANIMATION_WAIT_MS = 3000;       // l'animation d'entrée d'ECharts dure ~1 s ; on n'attend jamais plus

  // Le chargement passe par le chargeur unique (js/loader.js) : ExcelJS est un fichier du MÊME site que la page.
  function loadScriptOnce(src) {
    return GristBI.loader.script({ src }).catch((cause) => {
      const e = new Error('Échec de chargement du script : ' + src);
      e.cause = cause;
      throw e;
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

  // Hauteur (en points) d'une ligne d'en-tête dont les noms peuvent passer à la ligne dans leur colonne (gras : ~15 % plus large).
  function headerRowHeight(header) {
    const lines = header.reduce((n, h, i) => {
      const width = (i === 0 ? FIRST_COL_WIDTH : OTHER_COL_WIDTH) * 0.85;
      return Math.max(n, Math.ceil(String(h === null || h === undefined ? '' : h).length / width));
    }, 1);
    return Math.min(409, Math.max(1, lines) * 15 + (lines > 1 ? 3 : 0));
  }

  // ---- Feuille « tableau de bord » ---------------------------------------------------------------------------------------------------
  // Une feuille par page qui REPREND LA MISE EN PAGE de l'écran : chaque tuile est une image (la carte telle qu'on la voit, voir
  // `captureDashboardImages`) posée à la place que lui donne `GristBI.layouts.slots`. La feuille est une grille de cases de 10 x 10 px
  // (colonnes étroites, lignes de 7,5 pt) pour que les positions en pixels deviennent des positions de cellules sans arrondi visible ; chaque
  // image est ANCRÉE par ses deux coins (`twoCell`) : même si un tableur mesure ses colonnes un peu autrement, elle reste dans ses cellules
  // et deux tuiles ne se recouvrent jamais. Les rangées du haut (titre, sous-titre, lien vers les données) sont plus hautes : les images
  // n'y sont pas, leurs ancres comptent des cellules.
  const DASH_UNIT = 10;                 // px par colonne et par ligne de la feuille
  const DASH_COL_WIDTH = 10 / 7;        // largeur d'une colonne de 10 px (caractères d'Excel, chiffre de 7 px)
  const DASH_ROW_PT = 7.5;              // 10 px
  const DASH_BANNER = [26, 16, 16, 8];  // hauteurs (pt) des rangées du haut : titre, sous-titre, lien, respiration
  const DASH_WIDTH = 1200;              // largeur (px) de la zone de travail dont on reprend la mise en page
  const DASH_MIN_GAP = 12;              // espace minimal entre deux tuiles (px)

  // Lien vers une autre feuille du classeur. PAS le « hyperlink » d'ExcelJS : il pose toujours une relation EXTERNE et, pour un lien interne,
  // un attribut `location` qui garde le « # » de tête — LibreOffice le relit comme « ouvrir le fichier, puis le fragment deux fois », et
  // aucun essai ne dit ce qu'en fait Excel. La formule `HYPERLINK("#'Feuille'!A1";…)` est la manière d'Excel lui-même ; son résultat est
  // fourni pour qu'un lecteur qui ne recalcule pas affiche déjà le texte. Seule formule du classeur : tout le reste est écrit en valeurs.
  function sheetLink(sheetName, text) {
    const target = "#'" + String(sheetName).replace(/'/g, "''") + "'!A1";
    const q = (str) => '"' + String(str).replace(/"/g, '""') + '"';
    return { formula: 'HYPERLINK(' + q(target) + ',' + q(text) + ')', result: String(text) };
  }

  function writeDashboardSheet(wb, ws, page, ctx) {
    const labels = ctx.labels;
    const slots = page.slots;
    const colCount = Math.max(1, Math.ceil(slots.width / DASH_UNIT));
    for (let col = 1; col <= colCount; col++) ws.getColumn(col).width = DASH_COL_WIDTH;
    DASH_BANNER.forEach((h, i) => { ws.getRow(i + 1).height = h; });
    const bannerRows = DASH_BANNER.length;
    const contentRows = Math.ceil(slots.height / DASH_UNIT) + 1;
    for (let r = bannerRows + 1; r <= bannerRows + contentRows; r++) ws.getRow(r).height = DASH_ROW_PT;

    ws.getCell(1, 1).value = cellValue(page.title === undefined ? page.name : page.title);
    ws.getCell(1, 1).font = { bold: true, size: 16 };
    const subtitle = typeof ctx.options.subtitle === 'function' ? ctx.options.subtitle(page) : null;
    if (subtitle) {
      ws.getCell(2, 1).value = cellValue(subtitle);
      ws.getCell(2, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
    }
    if (ctx.dataSheetNameOf(page)) {
      ws.getCell(3, 1).value = sheetLink(ctx.dataSheetNameOf(page), labels.toData);
      ws.getCell(3, 1).font = { underline: true, color: { argb: COLOR_LINK } };
    }

    for (const block of page.blocks) {
      const slot = slots.items[block.tileId];
      if (!slot) continue;
      const c0 = Math.round(slot.x / DASH_UNIT);
      const c1 = Math.min(colCount, Math.max(c0 + 1, Math.round((slot.x + slot.w) / DASH_UNIT)));
      const r0 = Math.round(slot.y / DASH_UNIT);
      const r1 = Math.max(r0 + 1, Math.round((slot.y + slot.h) / DASH_UNIT));
      if (block.image && block.image.base64) {
        const imageId = wb.addImage({ base64: String(block.image.base64).replace(/^data:image\/png;base64,/, ''), extension: 'png' });
        ws.addImage(imageId, { tl: { col: c0, row: bannerRows + r0 }, br: { col: c1, row: bannerRows + r1 }, editAs: 'twoCell' });
      } else {
        // Pas d'image (le dessin a échoué) : la case reste à sa place, dit pourquoi et pour qui, plutôt qu'un trou muet.
        const top = bannerRows + r0 + 1;
        const bottom = bannerRows + r1;
        ws.mergeCells(top, c0 + 1, bottom, c1);
        const cell = ws.getCell(top, c0 + 1);
        const title = typeof ctx.options.title === 'function' ? ctx.options.title(block) : block.name;
        cell.value = cellValue(String(title == null ? '' : title) + '\n' + labels.noImage);
        cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
        cell.font = { italic: true, color: { argb: COLOR_MUTED } };
        cell.border = thinBorder();
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TITLE_FILL } };
      }
    }
  }

  // ---- Feuilles de données : des TABLEAUX EXCEL nommés ------------------------------------------------------------------------------
  // Chaque tuile qui a des données devient un vrai tableau Excel (objet « Tableau » : nom, boutons de filtre, tri, tableau croisé dynamique
  // en deux clics) et non plus des cellules posées au hasard. Un tableau demande des noms de colonne uniques, non vides, en texte, et au
  // moins une ligne ; un nom de tableau valide, unique dans le classeur.

  // Noms de colonne d'un tableau : texte, jamais vide, uniques sans tenir compte de la casse (« Montant », « montant » -> « montant (2) »).
  function tableHeaders(header) {
    const used = new Set();
    return header.map((h, i) => {
      let name = String(h === null || h === undefined ? '' : h).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 255);
      if (!name) name = 'Colonne ' + (i + 1);
      let candidate = name;
      for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name + ' (' + n + ')';
      used.add(candidate.toLowerCase());
      return candidate;
    });
  }

  // Nom de tableau : « T03_Montant_par_region » (lettres, chiffres, soulignés ; le rang rend le nom unique, ce qui évite aussi qu'un nom
  // ressemble à une référence de cellule).
  function tableNameFor(seq, title) {
    const slug = String(title == null ? '' : title).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    return 'T' + String(seq).padStart(2, '0') + '_' + (slug || 'donnees');
  }

  // Nom de feuille Excel : 31 signes au plus, sans `: \ / ? * [ ]`, ni apostrophe au bord, unique sans tenir compte de la casse.
  function uniqueSheetName(base, used) {
    let name = String(base == null ? '' : base).replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    if (!name || name.toLowerCase() === 'history') name = 'Feuille';
    name = name.slice(0, 31).replace(/^'+|'+$/g, '').trim() || 'Feuille';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ' (' + n + ')';
      candidate = name.slice(0, 31 - suffix.length).trim() + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  // Regroupe les tuiles qui ont des données en feuilles : `perPage` (une feuille de données par page, les tableaux les uns sous les
  // autres), `perTile` (une feuille par tuile) ou `single` (une seule feuille pour tout le classeur). Une note (tuile Texte) n'a pas de
  // données : elle n'est que sur le tableau de bord.
  function dataGroups(pages, mode, ctx) {
    const entries = [];
    for (const page of pages) {
      for (const block of page.blocks) {
        if (block.kind === 'text' || !block.header || !block.header.length) continue;
        entries.push({ page, block });
      }
    }
    if (!entries.length) return [];
    const labels = ctx.labels;
    if (mode === 'single') return [{ key: 'single', base: labels.dataSheet, page: null, entries }];
    if (mode === 'perTile') {
      return entries.map((entry) => ({
        key: 'tile:' + entry.page.id + ':' + entry.block.tileId,
        base: ctx.titleOf(entry.block), page: entry.page, entries: [entry]
      }));
    }
    const groups = [];
    for (const page of pages) {
      const own = entries.filter((e) => e.page === page);
      if (own.length) groups.push({ key: 'page:' + page.id, base: page.title + ' - ' + labels.dataSuffix, page, entries: own });
    }
    return groups;
  }

  function writeDataSheet(ws, group, ctx, seqRef) {
    const labels = ctx.labels;
    const widest = group.entries.reduce((n, e) => Math.max(n, e.block.header.length), MIN_BLOCK_COLS);
    for (let col = 1; col <= widest; col++) ws.getColumn(col).width = col === 1 ? FIRST_COL_WIDTH : OTHER_COL_WIDTH;
    let r = 1;
    ws.getCell(r, 1).value = cellValue(group.page ? group.page.title : labels.dataSheet);
    ws.getCell(r, 1).font = { bold: true, size: 16 };
    ws.getRow(r).height = 24;
    r += 1;
    if (group.page && ctx.dashboardSheetNameOf(group.page)) {
      ws.getCell(r, 1).value = sheetLink(ctx.dashboardSheetNameOf(group.page), labels.toDashboard);
      ws.getCell(r, 1).font = { underline: true, color: { argb: COLOR_LINK } };
      r += 1;
    }
    r += 1;

    for (const entry of group.entries) {
      const { block, page } = entry;
      const header = block.header;
      const rows = block.rows || [];
      const needed = 2 + 1 + rows.length + 3;
      if (r + needed > SHEET_ROW_BUDGET) {
        ws.getCell(r, 1).value = cellValue(labels.cut);
        ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
        break;
      }
      const lastCol = Math.max(header.length, MIN_BLOCK_COLS);
      let title = ctx.titleOf(block);
      if (group.key === 'single') title = page.title + ' › ' + title;

      // Bandeau de titre.
      ws.getCell(r, 1).value = cellValue(title);
      ws.getCell(r, 1).font = { bold: true, size: 12 };
      ws.getRow(r).height = 20;
      fillRange(ws, r, 1, lastCol, COLOR_TITLE_FILL);
      r += 1;

      const names = tableHeaders(header);
      if (rows.length) {
        seqRef.n += 1;
        ws.addTable({
          name: tableNameFor(seqRef.n, ctx.titleOf(block)),
          ref: 'A' + r,
          headerRow: true,
          totalsRow: false,
          style: { theme: 'TableStyleLight1', showRowStripes: true },
          columns: names.map((name) => ({ name, filterButton: true })),
          rows: rows.map((row) => names.map((_, i) => cellValue(tidyNumber(row[i]))))
        });
      } else {
        names.forEach((name, i) => { ws.getCell(r, i + 1).value = cellValue(name); });
      }
      // Mise en forme (par-dessus le style du tableau, que tous les tableurs ne dessinent pas).
      const border = rows.length <= BORDER_ROWS_MAX;
      names.forEach((_, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_FILL } };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        cell.border = thinBorder();
      });
      ws.getRow(r).height = headerRowHeight(names);
      r += 1;
      for (const row of rows) {
        names.forEach((_, i) => {
          const cell = ws.getCell(r, i + 1);
          const value = cell.value;
          if (i > 0 && typeof value === 'number') cell.numFmt = numberFormatFor(value);
          else if (i === 0 && typeof value === 'number') cell.alignment = { horizontal: 'left' }; // un libellé (2022), pas une valeur
          else if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
          if (border) cell.border = thinBorder();
        });
        r += 1;
      }
      if (!rows.length) {
        ws.getCell(r, 1).value = cellValue(labels.noRows);
        ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
        r += 1;
      }
      if (block.truncated) {
        ws.getCell(r, 1).value = cellValue(labels.truncated(block.truncated));
        ws.getCell(r, 1).font = { italic: true, color: { argb: COLOR_MUTED } };
        r += 1;
      }
      r += 2; // deux lignes d'air avant le tableau suivant
    }
  }

  // Construit le classeur ExcelJS à partir des pages de GristBI.data.buildExportPagesAsync. Pour chaque page :
  //   - une feuille « tableau de bord » : les images des tuiles (`block.image`, déjà photographiées par `captureDashboardImages`) posées
  //     où les place `page.slots` (GristBI.layouts.slots) — la mise en page de l'écran ;
  //   - les données de ses tuiles en tableaux Excel nommés, dans une feuille de données (voir `opts.dataMode`).
  // `ExcelJSLib` est passé en paramètre (le global `ExcelJS` dans le navigateur, le paquet vendorisé sous Node) : cette fonction ne touche ni au
  // DOM ni au réseau. Une page sans `slots` n'a que ses données.
  // `opts.title(block)` = titre affiché d'une tuile (celui de l'écran, traduit), `opts.subtitle(page)` = ligne sous le titre de page,
  // `opts.dataMode` = 'perPage' (défaut) | 'perTile' | 'single', `opts.labels` = textes fixes (traduits par l'appelant) ; tous facultatifs.
  function buildWorkbook(ExcelJSLib, pages, opts) {
    const options = opts || {};
    const labels = Object.assign({
      noImage: 'Visuel indisponible pour cette tuile : ses données sont dans la feuille de données.',
      noRows: 'Aucune donnée pour cette tuile avec les filtres actuels.',
      truncated: (n) => '… ' + n + ' lignes de plus ne sont pas exportées',
      cut: 'Feuille pleine : les tableaux suivants ne sont pas exportés.',
      dataSuffix: 'données',
      dataSheet: 'Données',
      toData: 'Données de cette page ›',
      toDashboard: '‹ Tableau de bord'
    }, options.labels || {});
    const mode = options.dataMode === 'perTile' || options.dataMode === 'single' ? options.dataMode : 'perPage';
    const wb = new ExcelJSLib.Workbook();
    wb.creator = 'Grist BI';
    wb.lastModifiedBy = 'Grist BI';

    const titleOf = (block) => {
      const title = typeof options.title === 'function' ? options.title(block) : block.name;
      return String(title === undefined || title === null ? '' : title);
    };
    const used = new Set();
    // Les noms de feuille sont fixés AVANT l'écriture : un lien d'une feuille vers l'autre a besoin des deux.
    const dashboardNames = new Map();
    for (const page of pages) if (page.slots) dashboardNames.set(page, uniqueSheetName(page.name, used));
    const groups = dataGroups(pages, mode, { labels, titleOf });
    const dataNames = new Map();
    const dataNameOfPage = new Map();
    for (const group of groups) {
      const name = uniqueSheetName(group.base, used);
      dataNames.set(group, name);
      if (group.page && !dataNameOfPage.has(group.page)) dataNameOfPage.set(group.page, name);
    }
    const ctx = {
      options, labels, titleOf,
      dashboardSheetNameOf: (page) => dashboardNames.get(page) || null,
      dataSheetNameOf: (page) => dataNameOfPage.get(page) || null
    };

    const printSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    // Ordre des feuilles : le tableau de bord d'une page, puis ses données — ce qui va ensemble reste ensemble.
    const written = new Set();
    const writeGroup = (group, seqRef) => {
      if (written.has(group)) return;
      written.add(group);
      const ws = wb.addWorksheet(dataNames.get(group), {
        properties: { defaultRowHeight: 15 },
        views: [{ showGridLines: false }],
        pageSetup: Object.assign({}, printSetup, { orientation: 'portrait' })
      });
      writeDataSheet(ws, group, ctx, seqRef);
    };
    const seqRef = { n: 0 };
    for (const page of pages) {
      if (page.slots) {
        const ws = wb.addWorksheet(dashboardNames.get(page), {
          properties: { defaultRowHeight: DASH_ROW_PT },
          views: [{ showGridLines: false }],
          pageSetup: printSetup
        });
        writeDashboardSheet(wb, ws, page, ctx);
      }
      for (const group of groups) if (group.page === page) writeGroup(group, seqRef);
    }
    for (const group of groups) writeGroup(group, seqRef); // la feuille commune (`single`), qui n'appartient à aucune page
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

  // Une image PNG par TUILE — un chiffre, un tableau, une progression, une note comme un graphique —, sous la forme
  // `Map(tileId -> { base64 })` : la carte telle qu'on la voit à l'écran (même style, mêmes filtres croisés et drill-down), à la taille de sa
  // place dans la mise en page (`page.slots`, voir GristBI.layouts.slots). Chaque carte est reconstruite HORS ÉCRAN (`GristBI.buildTileElement`,
  // le même corps que l'aperçu du panneau), dessinée par la même fonction que l'écran (`GristBI.charts.renderTile`), puis photographiée par
  // `GristBI.snapshot.capture` (js/snapshot.js : les styles calculés recopiés, les graphiques remplacés par l'image haute résolution de leur
  // instance). Les tuiles des AUTRES pages n'ont plus d'élément ni d'instance (render() les libère au changement de page) : voilà pourquoi
  // on refait la carte plutôt que de photographier l'écran. Une tuile dont le dessin échoue n'a pas d'entrée : sa place le dit.
  // Jamais d'exception : une tuile ratée ne fait pas échouer tout le classeur.
  async function captureDashboardImages(pages, state) {
    const images = new Map();
    const jobs = [];
    for (const page of pages) {
      if (!page.slots) continue;
      for (const block of page.blocks) {
        const slot = page.slots.items[block.tileId];
        if (slot) jobs.push({ block, slot });
      }
    }
    if (!jobs.length || typeof document === 'undefined' || !GristBI.charts || !GristBI.snapshot || typeof GristBI.buildTileElement !== 'function') return images;

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Hors de la fenêtre mais MIS EN PAGE (jamais display:none : ECharts et la photographie mesurent leur conteneur).
    host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
    document.body.appendChild(host);
    let seq = 0;
    try {
      for (let i = 0; i < jobs.length; i += CAPTURE_BATCH) {
        const batch = jobs.slice(i, i + CAPTURE_BATCH).map((job) => {
          // Sous un identifiant de COPIE : jamais l'instance affichée, que `getOrCreateChartInstance` réutiliserait pour le même id.
          const cloneId = '__xl_' + (seq++);
          const tile = Object.assign({}, job.block.tile, { id: cloneId });
          const el = GristBI.buildTileElement(tile, { preview: true });
          el.style.cssText = 'width:' + Math.round(job.slot.w) + 'px;height:' + Math.round(job.slot.h) + 'px;margin:0;';
          host.appendChild(el);
          return { block: job.block, cloneId, tile, el };
        });
        await Promise.all(batch.map(async (item) => {
          try { await GristBI.charts.renderTile(item.tile, stateForClone(state, item.block.tile, item.cloneId), host); }
          catch (e) { console.warn('[GristBI] export Excel : tuile non dessinée', item.block.tileId, e); }
        }));
        if (typeof GristBI.charts.whenSettled === 'function') await GristBI.charts.whenSettled(15000);
        const live = batch.map((item) => GristBI.charts.getInstance(item.cloneId)).filter((inst) => inst && !inst.isDisposed());
        await waitForAnimations(live);
        for (const item of batch) {
          try {
            const shot = await GristBI.snapshot.capture(item.el, { pad: 0, scale: CAPTURE_SCALE, skipSettle: true });
            const dataUrl = shot.canvas.toDataURL('image/png');
            if (/^data:image\/png;base64,/.test(dataUrl)) images.set(item.block.tileId, { base64: dataUrl.replace(/^data:image\/png;base64,/, '') });
          } catch (e) {
            console.warn('[GristBI] export Excel : photo de la tuile impossible', item.block.tileId, e);
          }
        }
        for (const item of batch) { GristBI.charts.disposeTile(item.cloneId); item.el.remove(); }
      }
    } finally {
      for (const el of Array.from(host.children)) GristBI.charts.disposeTile(el.getAttribute('data-tile-id'));
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

  // Déclenche le téléchargement d'un classeur .xlsx : pour chaque page du dashboard (toutes les pages), une feuille « tableau de bord » qui
  // reprend la mise en page de l'écran (une image par tuile) et une feuille de données (un tableau Excel par tuile). Retourne `false` sans rien
  // déclencher s'il n'y a aucune tuile à exporter (à l'appelant de prévenir l'utilisateur, voir main.js) plutôt que de télécharger un classeur
  // vide qui n'apporterait rien. ASYNCHRONE (calcul des mesures temporelles, photo des tuiles) — à l'appelant d'attendre la promesse (main.js).
  async function exportDashboardToExcel(state) {
    await ensureExcelJsLoaded().catch(() => { /* le test ci-dessous produit le message existant */ });
    if (typeof ExcelJS === 'undefined') {
      throw new Error("ExcelJS indisponible (js/vendor/exceljs/exceljs.min.js ne s'est pas chargé) — voir le bandeau ECharts pour un diagnostic similaire.");
    }
    const pages = await GristBI.data.buildExportPagesAsync(state, computeMeasureSeries);
    if (!pages.length) return false;
    // La mise en page de CHAQUE page (son agencement, ses tuiles) sur une zone de travail de largeur fixe : le même fichier quelle que soit la
    // fenêtre du moment.
    for (const page of pages) page.slots = GristBI.layouts.slots(page.layout, page.blocks.map((b) => b.tile), DASH_WIDTH, { minGap: DASH_MIN_GAP });
    const images = await captureDashboardImages(pages, state);
    for (const page of pages) for (const block of page.blocks) if (images.has(block.tileId)) block.image = images.get(block.tileId);

    const t = GristBI.i18n.t;
    const locale = GristBI.i18n.getLang() === 'en' ? 'en-GB' : 'fr-FR';
    const filterCount = (state.activeFilters || []).length + (state.advancedFilters || []).length;
    const date = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    const wb = buildWorkbook(ExcelJS, pages, {
      title: displayTitle,
      subtitle: () => t('export.xlsx.subtitle', { date, rows: state.rows.length.toLocaleString(locale) }) + (filterCount ? ' · ' + t('export.xlsx.filters', { n: filterCount }) : ''),
      dataMode: 'perPage',
      labels: {
        noImage: t('export.xlsx.noImage'),
        noRows: t('export.xlsx.noRows'),
        truncated: (n) => t('export.xlsx.truncated', { n }),
        cut: t('export.xlsx.cut'),
        dataSuffix: t('export.xlsx.dataSuffix'),
        dataSheet: t('export.xlsx.dataSheet'),
        toData: t('export.xlsx.toData'),
        toDashboard: t('export.xlsx.toDashboard')
      }
    });
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: XLSX_MIME }), FILE_NAME);
    return true;
  }

  const api = { exportDashboardToExcel, buildWorkbook, sheetLink, cellValue, tidyNumber, numberFormatFor, tableHeaders, tableNameFor, uniqueSheetName, captureDashboardImages, stateForClone, DASH_UNIT, DASH_WIDTH };
  GristBI.exportExcel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
