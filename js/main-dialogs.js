/*
 * Bootstrap de l'UI — fenêtres : commentaires, détail d'une tuile, import Power BI et CSV, réglages. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { escapeHtml } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    availableColumns, bindFormSubmit, commentAuthorInput, commentAuthorNote, commentForm, commentTextInput,
    commentsCloseBtn, commentsEmptyEl, commentsListEl, commentsModal, commentsModalTileEl, csvImportColumnsEl,
    csvImportConfirmEl, csvImportConfirmNoBtn, csvImportConfirmTextEl, csvImportConfirmYesBtn, csvImportCreateBtn,
    csvImportFileInput, csvImportPreviewEl, csvImportStatusEl, csvImportTableNameInput, detailCloseBtn, detailModal,
    detailModalEmptyEl, detailModalTableWrapEl, detailModalTitleEl, detailModalTruncatedEl, genTileId,
    openPbixImportBtn, pbixImportCloseBtn, pbixImportCreateBtn, pbixImportFileInput, pbixImportModal,
    pbixImportResultsEl, pbixImportStatusEl, settingsBtn, settingsCloseBtn, settingsModal, showError, showNotice,
    store
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const refreshTablePicker = (...args) => parts.refreshTablePicker(...args);
  const reloadWorkingTable = (...args) => parts.reloadWorkingTable(...args);
  const switchTable = (...args) => parts.switchTable(...args);
  Object.assign(parts, {
    currentReportAuthorLabel, openCommentsModal, openDetailModal, renderCommentsModal, renderDetailModal
  });

  S.currentTableId = null;

  let commentsModalTileId = null;
 // tuile actuellement affichée dans #comments-modal, ou null si fermé
  // Email de l'utilisateur courant, détecté UNE SEULE fois au bootstrap via la table-sonde
  // BI_Dashboard_UserProbe (GristBI.api.getCurrentUserEmail(), js/grist-api.js) — `null` tant que la
  // détection n'a pas abouti (mock de dev-tests/, widget hors Grist, droits insuffisants...), auquel
  // cas openCommentsModal retombe sur la saisie manuelle existante (loadSavedCommentAuthor).
  S.detectedUserEmail = null;

  let detailModalTileId = null;
 // tuile actuellement affichée dans #detail-modal, ou null si fermé
  const DETAIL_MODAL_MAX_ROWS = 500;

  // Nom saisi une fois, mémorisé d'une session à l'autre comme la langue — pas la peine de le
  // retaper à chaque commentaire. Dans GFS (consigne 007, point 3), passe par
  // `GfsLink.storageGet`/`storageSet` (contrats 5.3) plutôt que `localStorage`, peu fiable dans le
  // sous-cadre isolé de GFS (voir gfsLink/gfsLinkReady en tête de fichier) ; hors GFS, ou si le
  // lien n'a pas pu se charger, retombe sur `localStorage` — comportement d'avant cette consigne.
  // Le `typeof` reste DANS le `try` (consigne GFS 007, point 1) : dans ce cadre isolé, lire
  // `localStorage` lève une exception même à travers un `typeof`, elle n'est jamais simplement
  // absente comme sous Node.
  function loadSavedCommentAuthor() {
    if (S.gfsLink && S.gfsLink.hosted) return S.gfsLink.storageGet('gristbi_comment_author') || '';
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem('gristbi_comment_author') || '';
    } catch (e) { return ''; }
  }

  function saveCommentAuthor(author) {
    if (S.gfsLink && S.gfsLink.hosted) { S.gfsLink.storageSet('gristbi_comment_author', author); return; }
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('gristbi_comment_author', author);
    } catch (e) { /* stockage indisponible (cadre isolé compris) - sans conséquence, juste à retaper la prochaine fois */ }
  }

  // "Rapport modifié par" (consigne GFS 007, point 2, colonne ModifiePar) : MÊME précédence que le
  // champ Auteur du formulaire de commentaire ci-dessus (openCommentsModal) - l'adresse détectée
  // automatiquement (table-sonde BI_Dashboard_UserProbe, voir bootstrap()) quand elle est connue,
  // sinon le nom mémorisé pour les commentaires, sinon `null` (saveConfig laisse alors la colonne
  // telle qu'elle est plutôt que d'y écrire une chaîne vide). La consigne évoque aussi "Nom
  // <adresse>" comme Publipostage+ ; non reproduit ici, faute d'un moyen de connaître à la fois un
  // NOM et une adresse dans ce widget — detectedUserEmail et loadSavedCommentAuthor() sont déjà
  // deux sources ALTERNATIVES nulle part combinées ailleurs dans ce fichier (voir
  // openCommentsModal), jamais les deux à la fois.
  function currentReportAuthorLabel() {
    if (S.detectedUserEmail) return S.detectedUserEmail;
    return loadSavedCommentAuthor() || null;
  }

  // Reconstruit la liste de commentaires affichée dans #comments-modal pour `commentsModalTileId`
  // — relit TOUJOURS l'état vivant du store (comme le gestionnaire de clic générique de
  // js/charts.js), jamais une variable capturée au moment de l'ouverture, pour qu'un ajout de
  // commentaire (ou un changement de langue, voir GristBI.i18n.onChange plus bas) mette la liste à
  // jour sans avoir à refermer/rouvrir le panneau.
  function renderCommentsModal() {
    if (!commentsModalTileId) return;
    const comments = GristBI.data.commentsForTile(store.getState().comments, commentsModalTileId);
    const locale = GristBI.i18n.getLang() === 'en' ? 'en-US' : 'fr-FR';
    GristBI.safeHtml.setHtml(commentsListEl, comments.map((c) => `
      <li class="comment-item">
        <div class="comment-meta"><strong>${escapeHtml(c.Author)}</strong><span class="comment-date">${escapeHtml(new Date(c.CreatedAt).toLocaleString(locale))}</span></div>
        <p class="comment-text">${escapeHtml(c.Text)}</p>
      </li>`).join(''));
    commentsEmptyEl.hidden = comments.length > 0;
  }

  function openCommentsModal(tile) {
    commentsModalTileId = tile.id;
    commentsModalTileEl.textContent = GristBI.i18n.tileTitle(tile);
    // Auteur reconnu automatiquement quand la détection a abouti (voir detectedUserEmail
    // ci-dessus) : champ pré-rempli et verrouillé, cohérence garantie avec la véritable identité
    // Grist plutôt qu'un nom retapé/modifiable. Repli IDENTIQUE à avant cette fonctionnalité sinon.
    if (S.detectedUserEmail) {
      commentAuthorInput.value = S.detectedUserEmail;
      commentAuthorInput.readOnly = true;
    } else {
      commentAuthorInput.value = loadSavedCommentAuthor();
      commentAuthorInput.readOnly = false;
    }
    commentAuthorNote.hidden = !S.detectedUserEmail;
    commentTextInput.value = '';
    renderCommentsModal();
    commentsModal.hidden = false;
    commentTextInput.focus();
  }

  function closeCommentsModal() {
    commentsModal.hidden = true;
    commentsModalTileId = null;
  }

  // Modale de détail (substitut du drillthrough, voir index.html/ROADMAP.md) : affiche les lignes
  // BRUTES actuellement reçues par la tuile (GristBI.data.rowsForTile, même filtrage que le rendu
  // ECharts/l'export Excel — cross-filtres des AUTRES tuiles, filtres avancés, et le propre chemin
  // de drill-down de la tuile), pas seulement le segment cliqué : l'utilisateur a déjà affiné sa
  // vue en filtrant/drillant avant de vouloir le détail. Relit l'état vivant à chaque rendu (comme
  // renderCommentsModal) plutôt qu'un instantané figé à l'ouverture, pour rester cohérente si un
  // filtre est posé/levé pendant qu'elle est ouverte. Colonnes = `Object.keys(rows[0])`, même
  // convention que `availableColumns()` (js/main.js) : la 1re ligne représente la forme commune.
  // Plafonnée à DETAIL_MODAL_MAX_ROWS lignes affichées (une table de travail à fort volume peut en
  // compter des dizaines de milliers) — un tableau HTML de cette taille sans pagination serait un
  // coût DOM inutile pour une modale d'inspection ; l'export Excel reste la voie pour tout voir d'un coup.
  function renderDetailModal() {
    if (!detailModalTileId) return;
    const state = store.getState();
    const tile = state.tiles.find((tl) => tl.id === detailModalTileId);
    if (!tile) { closeDetailModal(); return; } // tuile supprimée entre-temps (voir charts.js, même garde)

    const rows = GristBI.data.rowsForTile(tile, state);
    detailModalTitleEl.textContent = t('detail.modal.title', { n: rows.length });
    detailModalEmptyEl.hidden = rows.length > 0;

    const shown = rows.slice(0, DETAIL_MODAL_MAX_ROWS);
    if (!shown.length) {
      detailModalTableWrapEl.innerHTML = '';
    } else {
      const columns = Object.keys(shown[0]);
      const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const body = shown.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c] == null ? '' : row[c])}</td>`).join('')}</tr>`).join('');
      GristBI.safeHtml.setHtml(detailModalTableWrapEl, `<table class="detail-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
    }

    detailModalTruncatedEl.hidden = rows.length <= DETAIL_MODAL_MAX_ROWS;
    if (rows.length > DETAIL_MODAL_MAX_ROWS) {
      detailModalTruncatedEl.textContent = t('detail.modal.truncated', { shown: shown.length, total: rows.length });
    }
  }

  function openDetailModal(tile) {
    detailModalTileId = tile.id;
    renderDetailModal();
    detailModal.hidden = false;
  }

  function closeDetailModal() {
    detailModal.hidden = true;
    detailModalTileId = null;
  }

  // --- Import de la MISE EN PAGE d'un fichier Power BI (.pbix/.pbit) --------------------------
  // Partie pure (parsing ZIP, décodage Report/Layout, extraction des visuels, correspondance de
  // colonnes) dans js/pbix-layout.js, testée sous Node — tout ce qui suit est la glue navigateur
  // (lecture de fichier, DOM), jamais testée sous Node pour cette raison (voir TEST_PROTOCOL.md).
  // Importe UNIQUEMENT la mise en page (quels visuels, quel type, quelles colonnes) vers des
  // tuiles sur la table de travail DÉJÀ connectée — jamais les données du fichier Power BI, jamais
  // de table créée par ce chemin (voir CLAUDE.md, étude de faisabilité du 2026-11-03 : le format de
  // stockage des données, VertiPaq, est propriétaire et non documenté officiellement).
  let pbixImportSuggestions = [];
 // dernière liste affichée dans la modale, relue par "Créer les tuiles sélectionnées"

  // Décompresse une entrée ZIP DEFLATE via l'API navigateur native (`DecompressionStream`), sans la
  // moindre nouvelle dépendance — disponible dans tous les navigateurs évergreens visés par ce
  // widget (Chrome/Edge 80+, Firefox 97+, Safari 16.4+). Seule l'entrée Report/Layout (quelques Ko
  // à dizaines de Ko) passe par ici ; `DataModel`, bien plus gros, est stocké NON compressé au
  // niveau ZIP (voir l'en-tête de js/pbix-layout.js) et n'est de toute façon jamais lu par ce
  // chemin.
  async function inflateRawBrowser(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Un visuel sans tuile équivalente n'arrive déjà plus jusqu'ici (GristBI.pbixLayout.suggestTiles
  // filtre sur les types reconnus) : une suggestion affichée ici est donc toujours soit prête à
  // créer (`tileData` rempli), soit bloquée UNIQUEMENT par des colonnes introuvables
  // (`missingFields` forcément non vide dans ce cas, voir js/pbix-layout.js).
  function renderPbixImportResults() {
    GristBI.safeHtml.setHtml(pbixImportResultsEl, pbixImportSuggestions.map((s, i) => {
      const disabled = !s.tileData;
      const meta = disabled
        ? t('pbixImport.missingColumns', { columns: s.missingFields.join(', ') })
        : s.visual.visualType;
      return `<li class="pbix-import-result${disabled ? ' pbix-import-result-disabled' : ''}">
        <label>
          <input type="checkbox" data-pbix-index="${i}" ${disabled ? 'disabled' : 'checked'} />
          <span>
            <span class="pbix-import-result-title">${escapeHtml(s.title)}</span><br>
            <span class="pbix-import-result-meta">${escapeHtml(meta)}</span>
          </span>
        </label>
      </li>`;
    }).join(''));
    pbixImportCreateBtn.hidden = !pbixImportSuggestions.some((s) => s.tileData);
  }

  async function handlePbixImportFile(file) {
    pbixImportSuggestions = [];
    pbixImportResultsEl.innerHTML = '';
    pbixImportCreateBtn.hidden = true;
    if (!file) { pbixImportStatusEl.textContent = ''; return; }
    pbixImportStatusEl.textContent = t('pbixImport.reading');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = GristBI.pbixLayout.parseZipCentralDirectory(buf);
      const layoutEntry = entries.find((e) => e.name === 'Report/Layout');
      if (!layoutEntry) { pbixImportStatusEl.textContent = t('pbixImport.noLayout'); return; }
      const layoutBytes = await GristBI.pbixLayout.readZipEntryBytes(buf, layoutEntry, inflateRawBrowser);
      const layoutJson = GristBI.pbixLayout.decodeLayoutJson(layoutBytes);
      const visuals = GristBI.pbixLayout.extractVisuals(layoutJson);
      pbixImportSuggestions = GristBI.pbixLayout.suggestTiles(visuals, availableColumns(store.getState().rows));
      if (!pbixImportSuggestions.length) { pbixImportStatusEl.textContent = t('pbixImport.noVisual'); return; }
      const n = pbixImportSuggestions.filter((s) => s.tileData).length;
      pbixImportStatusEl.textContent = t('pbixImport.found', { n, total: pbixImportSuggestions.length });
      renderPbixImportResults();
    } catch (e) {
      console.error('[GristBI] échec de la lecture du fichier Power BI', e);
      pbixImportStatusEl.textContent = t('pbixImport.readFailed');
    }
  }

  function handlePbixImportCreate() {
    const checked = pbixImportResultsEl.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
    let created = 0;
    checked.forEach((cb) => {
      const suggestion = pbixImportSuggestions[Number(cb.dataset.pbixIndex)];
      if (!suggestion || !suggestion.tileData) return;
      store.addTile(Object.assign({ id: genTileId(created) }, suggestion.tileData));
      created++;
    });
    pbixImportStatusEl.textContent = t('pbixImport.created', { n: created });
    pbixImportSuggestions = [];
    pbixImportResultsEl.innerHTML = '';
    pbixImportCreateBtn.hidden = true;
    pbixImportFileInput.value = '';
  }

  // --- Import des DONNÉES d'un CSV exporté depuis Power BI --------------------------------------
  // Complète l'import de mise en page ci-dessus : js/csv-import.js (pur, testé Node) détecte le
  // délimiteur/les types de colonnes et convertit déjà les valeurs — tout ce qui suit est la glue
  // navigateur (lecture de fichier, DOM, création de la table dans Grist), jamais testée sous Node
  // pour cette raison, même convention que le reste de cette modale. Contrairement à l'import de
  // mise en page ci-dessus, CE chemin crée une VRAIE table de données dans le document —
  // exception ponctuelle à la règle habituelle "ce widget ne crée aucune table de données"
  // (CLAUDE.md §1/§3/§7/§8), accordée par Antoine le 03/11/2026 spécifiquement pour l'import Power
  // BI, et gardée derrière une pop-up de confirmation explicite (voir handleCsvImportConfirmYes)
  // avant le moindre AddTable.
  let csvImportParsed = null;
 // { columns, rows, rowCount } de la dernière lecture réussie
  let csvImportPendingTableName = null;
 // nom proposé à l'utilisateur sur la pop-up de confirmation

  function renderCsvImportColumns(columns) {
    GristBI.safeHtml.setHtml(csvImportColumnsEl, columns.map((c) => `
      <li class="csv-import-column">
        <span class="csv-import-col-label">${escapeHtml(c.label)}</span>
        <span class="csv-import-col-type">${escapeHtml(c.type)}</span>
      </li>
    `).join(''));
  }

  // Nom de table proposé par défaut (modifiable avant confirmation) : nom de fichier sans
  // extension, assaini en identifiant Grist valide — même règles que
  // GristBI.csvImport.sanitizeColumnId (lettre/underscore en tête, puis lettres/chiffres/
  // underscores), jamais vide.
  function suggestTableNameFromFile(file) {
    const base = file.name.replace(/\.csv$/i, '').trim();
    const sanitized = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Import';
    return /^[0-9]/.test(sanitized) ? 'T_' + sanitized : sanitized;
  }

  async function handleCsvImportFile(file) {
    csvImportParsed = null;
    csvImportPreviewEl.hidden = true;
    csvImportConfirmEl.hidden = true;
    if (!file) { csvImportStatusEl.textContent = ''; return; }
    csvImportStatusEl.textContent = t('pbixImport.csvReading');
    try {
      const text = await file.text();
      const parsed = GristBI.csvImport.parseCsvFile(text);
      if (!parsed.rowCount || !parsed.columns.length) {
        csvImportStatusEl.textContent = t('pbixImport.csvEmpty');
        return;
      }
      csvImportParsed = parsed;
      csvImportTableNameInput.value = suggestTableNameFromFile(file);
      renderCsvImportColumns(parsed.columns);
      csvImportStatusEl.textContent = t('pbixImport.csvFound', { columns: parsed.columns.length, rows: parsed.rowCount });
      csvImportPreviewEl.hidden = false;
    } catch (e) {
      console.error('[GristBI] échec de la lecture du fichier CSV', e);
      csvImportStatusEl.textContent = t('pbixImport.csvReadFailed');
    }
  }

  // Ouvre la pop-up de confirmation (jamais d'AddTable direct depuis "Créer la table" — voir
  // l'en-tête de cette section) avec le nom de table et le volume EXACTS qui seront créés.
  function handleCsvImportCreateClick() {
    if (!csvImportParsed) return;
    const tableName = csvImportTableNameInput.value.trim();
    if (!tableName) { showNotice(t('pbixImport.csvNameRequired')); return; }
    csvImportPendingTableName = tableName;
    csvImportConfirmTextEl.textContent = t('pbixImport.csvConfirmText', {
      table: tableName, columns: csvImportParsed.columns.length, rows: csvImportParsed.rowCount
    });
    csvImportConfirmEl.hidden = false;
  }

  function handleCsvImportConfirmNo() {
    csvImportConfirmEl.hidden = true;
    csvImportPendingTableName = null;
  }

  // Seul chemin qui appelle réellement GristBI.api.createTableFromRows (AddTable) — après ce
  // dernier clic explicite de confirmation. Reconnecte ensuite le widget à la table créée (comme
  // un changement manuel via le sélecteur, voir switchTable) puis, si un .pbix a déjà été lu dans
  // cette même ouverture de la modale (pbixImportSuggestions non vide, mise en page pas encore
  // créée), ré-essaie immédiatement la correspondance de colonnes : le CSV vient du MÊME fichier
  // Power BI que ce .pbix, ses en-têtes de colonnes portent donc vraisemblablement les mêmes noms,
  // sans que l'utilisateur ait à relire son .pbix une seconde fois.
  async function handleCsvImportConfirmYes() {
    if (!csvImportParsed || !csvImportPendingTableName) return;
    csvImportConfirmEl.hidden = true;
    csvImportCreateBtn.disabled = true;
    csvImportStatusEl.textContent = t('pbixImport.csvCreating');
    try {
      const actualTableId = await GristBI.api.createTableFromRows(
        csvImportPendingTableName, csvImportParsed.columns, csvImportParsed.rows,
        (phase, sent, total) => { csvImportStatusEl.textContent = t('pbixImport.csvCreatingProgress', { sent, total }); }
      );
      const rowCount = csvImportParsed.rowCount;
      csvImportStatusEl.textContent = t('pbixImport.csvCreated', { table: actualTableId, rows: rowCount });
      const { rows } = await GristBI.api.loadTable(actualTableId);
      await switchTable(actualTableId, rows);
      await refreshTablePicker();
      if (pbixImportSuggestions.length) {
        pbixImportSuggestions = GristBI.pbixLayout.suggestTiles(
          pbixImportSuggestions.map((s) => s.visual), availableColumns(rows)
        );
        renderPbixImportResults();
      }
      csvImportParsed = null;
      csvImportPendingTableName = null;
      csvImportPreviewEl.hidden = true;
      csvImportFileInput.value = '';
    } catch (e) {
      console.error('[GristBI] échec de la création de la table depuis le CSV importé', e);
      csvImportStatusEl.textContent = t('pbixImport.csvCreateFailed');
    } finally {
      csvImportCreateBtn.disabled = false;
    }
  }

  // Même convention d'ouverture/fermeture que Publipostage+ (js/settings.js de ce widget frère) :
  // `hidden` natif, pas de fermeture au clic sur le fond — un clic accidentel sur l'overlay pendant
  // la lecture des Crédits ne doit pas fermer le panneau.
  if (settingsBtn && settingsModal && settingsCloseBtn) {
    settingsBtn.addEventListener('click', () => { settingsModal.hidden = false; });
    settingsCloseBtn.addEventListener('click', () => { settingsModal.hidden = true; });
  }

  // Panneau Commentaires : même convention hidden natif/pas de fermeture au clic sur le fond que
  // #settings-modal ci-dessus (voir openCommentsModal/closeCommentsModal plus haut pour l'ouverture,
  // déclenchée depuis le bouton de CHAQUE tuile, pas un bouton de bandeau unique).
  if (commentsCloseBtn) commentsCloseBtn.addEventListener('click', closeCommentsModal);

  if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetailModal);

  // Panneau Import Power BI : même convention hidden natif/pas de fermeture au clic sur le fond
  // que les autres modales ci-dessus. Réinitialisé à chaque ouverture (pas de résultat d'un import
  // précédent qui traîne si l'utilisateur change de fichier ou rouvre le panneau).
  // Mots-clés des publications (menu Données, consigne GFS 019) : tout le branchement vit dans js/keywords-panel.js,
  // qui ne reçoit d'ici que la table de travail courante et de quoi relire la table après une écriture (l'état de
  // l'extension `mots-cles-pdf` vient de GristBI.extensions, comme pour « Nuage de mots »).
  if (GristBI.keywordsPanel) {
    GristBI.keywordsPanel.init({
      getTableId: () => S.currentTableId,
      reloadTable: reloadWorkingTable
    });
  }

  if (openPbixImportBtn && pbixImportModal && pbixImportCloseBtn) {
    openPbixImportBtn.addEventListener('click', () => {
      pbixImportSuggestions = [];
      pbixImportResultsEl.innerHTML = '';
      pbixImportStatusEl.textContent = '';
      pbixImportCreateBtn.hidden = true;
      pbixImportFileInput.value = '';
      csvImportParsed = null;
      csvImportPendingTableName = null;
      csvImportStatusEl.textContent = '';
      csvImportPreviewEl.hidden = true;
      csvImportConfirmEl.hidden = true;
      csvImportFileInput.value = '';
      pbixImportModal.hidden = false;
    });
    pbixImportCloseBtn.addEventListener('click', () => { pbixImportModal.hidden = true; });
  }

  if (pbixImportFileInput) {
    pbixImportFileInput.addEventListener('change', () => handlePbixImportFile(pbixImportFileInput.files[0]));
  }

  if (pbixImportCreateBtn) pbixImportCreateBtn.addEventListener('click', handlePbixImportCreate);

  if (csvImportFileInput) {
    csvImportFileInput.addEventListener('change', () => handleCsvImportFile(csvImportFileInput.files[0]));
  }

  if (csvImportCreateBtn) csvImportCreateBtn.addEventListener('click', handleCsvImportCreateClick);

  if (csvImportConfirmYesBtn) csvImportConfirmYesBtn.addEventListener('click', handleCsvImportConfirmYes);

  if (csvImportConfirmNoBtn) csvImportConfirmNoBtn.addEventListener('click', handleCsvImportConfirmNo);

  // Ajout d'un commentaire : AddRecord côté Grist (js/grist-api.js:addComment), puis ajout
  // optimiste côté store (pas de re-fetch de toute la table) — la liste affichée se remet à jour
  // via renderCommentsModal(), appelée depuis render() (voir plus haut) puisque addCommentLocal
  // déclenche notify(). Le nom est mémorisé pour la prochaine fois, le texte est vidé mais le
  // panneau reste ouvert (plusieurs commentaires à la suite sans le rouvrir).
  if (commentForm) {
    async function submitComment() {
      if (!commentsModalTileId) return;
      const author = commentAuthorInput.value.trim();
      const text = commentTextInput.value.trim();
      if (!author || !text) return;
      // Pas la peine de mémoriser en localStorage un auteur qui n'a jamais été retapé à la main
      // (voir openCommentsModal) : ça resterait un nom figé par la détection automatique d'une
      // session passée, jamais relu tant que detectedUserEmail reste disponible de toute façon.
      if (!S.detectedUserEmail) saveCommentAuthor(author);
      try {
        const comment = await GristBI.api.addComment(S.currentTableId, commentsModalTileId, author, text);
        store.addCommentLocal(comment);
        commentTextInput.value = '';
        commentTextInput.focus();
      } catch (e) {
        console.error('[GristBI] échec de l\'ajout du commentaire', e);
        showError(t('comments.addFailed'));
      }
    }
    bindFormSubmit(commentForm, submitComment);
  }
})(window);
