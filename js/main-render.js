/*
 * Bootstrap de l'UI — rendu de la page : mode Lecture/Édition, état de la connexion, grille de tuiles (`render`),
 * onglets de pages, pastilles de filtres, vues sauvegardées, exports et ajout de page. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { escapeHtml } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    addPageBtn, addTileForm, advancedFilterBadgesEl, advancedFilterForm, blendPrimaryColumnInput,
    blendSecondaryColumnInput, blendSecondaryTableInput, chipsRowEl, clearFilterBtn, closeTilePanel, dataPillNameEl,
    echartsWarning, emptyState, emptyStateHintEl, emptyStateReadHintEl, emptyStateStatusEl, exportExcelBtn,
    exportPdfBtn, exportPptxBtn, exportToggleBtn, filterBadgesEl, filterCountEl, filterToggleBtn, flashTile,
    focusGridEl, focusLabelEl, focusResetBtn, focusZoneEl, genTileId, icon, modeToggleBtn, modeToggleLabelEl,
    openCommentsModal, openDetailModal, pageTabsEl, renderCommentsModal, renderDetailModal, renderTimeEl,
    retryConnectBtn, rowCountEl, saveBookmarkBtn, showError, showNotice, startEditTile, store, tilesContainer,
    updateBookmarkBtn, viewChipEl, viewChipLeaveBtn, viewChipModifiedEl, viewChipNameEl, viewChipUpdateBtn,
    viewsActiveDotEl, viewsActiveNameEl, viewsEmptyEl, viewsListEl, viewsToggleBtn, welcomeAddBtn, welcomeEl,
    workspaceMainEl
  } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const refreshLayoutOptions = (...args) => parts.refreshLayoutOptions(...args);
  const refreshStyleOptions = (...args) => parts.refreshStyleOptions(...args);
  const scheduleSave = (...args) => parts.scheduleSave(...args);
  Object.assign(parts, {
    autoMode, buildTileElement, render, renderConnectionStatus, setConnectionState, setMode
  });
 // { tableId, reportId, authorLabel, pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions } en attente d'écriture, voir flushPendingSave()
  let lastRenderedPages = null;
 // référence, pour ne pas re-sauvegarder la config à chaque rafraîchissement de données
  let lastRenderedCurrentPageId = null;
 // idem, côté page active (changer de page se sauvegarde aussi)
  let lastRenderedBookmarks = null;
 // idem, côté bookmarks
  let lastRenderedBlend = null;
 // idem, côté jointure de data blending (voir applyBlend/commitBlendFromForm)
  let lastRenderedDashStyle = 'standard';
 // idem, côté style global des tuiles (js/styles.js) — le Standard est ce que le chargement pose par défaut
  let lastRenderedDashStyleOptions = store.getState().dashStyleOptions;
 // idem, côté options d'affichage globales (une référence : le store n'en crée une neuve que si elles changent)
  // Consigne GFS 009 : levé par switchTable pendant qu'il CHARGE un rapport (pages/bookmarks/blend
  // posés depuis BI_Dashboard_Config ou depuis un départ vierge), jamais pendant un geste réel de la
  // personne — voir render() et switchTable plus bas.
  S.suppressNextSave = false;

  // Cartes de suggestion de l'écran d'accueil (js/welcome.js, décisions de js/advice.js) : seulement des
  // rappels ici, pour que ce fichier-là ne connaisse ni le store ni le formulaire. Le bouton « Créer une
  // visualisation » de l'accueil n'est pas ici : il appartient à la refonte de l'interface (lot 2).
  GristBI.welcome.init({
    addTile: (tileData, index) => store.addTile(Object.assign({ id: genTileId(index) }, tileData)),
    importPowerBi: () => document.getElementById('open-pbix-import').click()
  });

  // Si le <script> ECharts (js/vendor/echarts/, voir index.html) n'a pas pu se charger, les tuiles
  // barres/camembert resteraient vides SANS AUCUNE erreur visible — seules les cartes KPI
  // fonctionneraient (elles ne dépendent pas d'ECharts). Signal explicite plutôt que de laisser
  // deviner via la console. Défense en profondeur : ECharts étant maintenant embarqué localement
  // (plus de dépendance CDN), ce cas ne devrait plus se produire en usage normal.
  if (typeof echarts === 'undefined') {
    console.error('[GristBI] `echarts` est indéfini : js/vendor/echarts/echarts.min.js ne s\'est probablement pas chargé.');
    echartsWarning.hidden = false;
  }

  // Export Excel grisé pour l'ALPHA (19/11/2026, demande d'Antoine : « on garde export Excel pour la bêta »). Le bouton du menu Exporter est grisé
  // dans index.html (« bientôt disponible ») ; ce drapeau le garde fermé quand une table se connecte (setTableDependentControlsEnabled) et coupe son
  // écouteur. TOUT le code de l'export est conservé (js/export.js, GristBI.exportExcel, ses tests) : remettre à `true` ET retirer `disabled
  // aria-disabled` de #export-excel dans index.html (avec la mention) pour la bêta. PDF et PPTX restent ouverts.
  const EXCEL_EXPORT_AVAILABLE = false;

  // Désactive les contrôles qui n'ont de sens qu'avec une table de travail connectée (formulaire
  // d'ajout de tuile, filtre avancé, data blending, vues sauvegardées/exports, +Page) tant que
  // `currentTableId` reste `null` (document sans aucune table utilisateur, voir bootstrap()) —
  // repéré lors de l'audit UX du 21/10/2026 : ces contrôles restaient auparavant pleinement
  // interactifs (bouton "+ Ajouter la tuile" bleu, premier plan) mais totalement inopérants dans cet
  // état (voir addTileForm submit, `if (!measure...) return;`), sans le moindre retour pour
  // l'utilisateur — seul le message `status.noTables`, discret dans le bandeau du haut, expliquait
  // pourquoi. Le sélecteur de table principal (`tableSelectInput`) reste volontairement actif : c'est
  // la seule échappatoire utile dans cet état. Les boutons de la liste des vues ne sont pas listés
  // ici : ils sont reconstruits par renderBookmarks() à chaque rendu, et le menu Vues lui-même ne
  // s'ouvre pas tant que `viewsToggleBtn` est désactivé.
  function setTableDependentControlsEnabled(enabled) {
    for (const form of [addTileForm, advancedFilterForm]) {
      form.querySelectorAll('input, select, button, textarea').forEach((el) => { el.disabled = !enabled; });
    }
    for (const el of [saveBookmarkBtn, exportExcelBtn, exportPdfBtn, exportPptxBtn, addPageBtn,
                       filterToggleBtn, viewsToggleBtn, exportToggleBtn, modeToggleBtn,
                       blendSecondaryTableInput, blendPrimaryColumnInput, blendSecondaryColumnInput]) {
      el.disabled = !enabled;
    }
    // Export Excel grisé pour l'alpha (voir EXCEL_EXPORT_AVAILABLE) : la connexion d'une table ne le rouvre jamais.
    if (!EXCEL_EXPORT_AVAILABLE) exportExcelBtn.disabled = true;
  }

  // Mode Lecture / Édition (audit UI/UX du 18/11/2026) : `body[data-mode]` masque en lecture tout ce
  // qui sert à CONSTRUIRE le tableau de bord (`.edit-only` : formulaire d'ajout, « + » des pages,
  // déplacer/modifier/supprimer une tuile, jointure, import). Pas persisté : à chaque connexion à une
  // table, un tableau de bord qui a déjà des tuiles s'ouvre en lecture, un tableau vide en édition ;
  // le bouton de la barre bascule ensuite à la main. Au démarrage (rien de connecté) : lecture, pour
  // ne pas montrer un formulaire inutilisable le temps du chargement.
  S.mode = 'read';

  function applyMode() {
    document.body.dataset.mode = S.mode;
    const editing = S.mode === 'edit';
    modeToggleBtn.setAttribute('aria-pressed', String(editing));
    const label = t(editing ? 'mode.done' : 'mode.edit');
    modeToggleLabelEl.textContent = label;
    // Écran très étroit : le libellé visible disparaît (css), le nom accessible reste.
    modeToggleBtn.setAttribute('aria-label', label);
  }

  function setMode(next) {
    S.mode = next === 'edit' ? 'edit' : 'read';
    if (S.mode === 'read') closeTilePanel(false); // on ne laisse ni panneau ouvert ni édition en cours derrière un mode qui les masque
    GristBI.appbar.closePopovers();
    applyMode();
    fitPageTabs(); // le mode Édition ajoute des boutons à la barre
  }

  function autoMode() {
    const hasTiles = store.getState().pages.some((p) => p.tiles && p.tiles.length > 0);
    setMode(hasTiles ? 'read' : 'edit');
  }

  // État de la connexion aux données, distinct de « une table est connectée » : tant que le
  // démarrage n'a rien tranché, l'écran dit « Connexion… » — jamais « Aucune table dans ce
  // document » avant que la liste des tables ait été lue (audit UI/UX du 18/11/2026 : ce message
  // trompeur s'affichait pendant tout le chargement). 'connecting' | 'noTables' | 'failed' ; sans
  // objet dès qu'une table est connectée (`currentTableId`).
  S.connectionState = 'connecting';

  // Vrai une fois la configuration de la table lue (switchTable) : `currentTableId` est posé AVANT cette
  // lecture, qui peut durer une dizaine de secondes sur un document neuf (création de
  // BI_Dashboard_Config, voir `tableExistsConfirmed`) — pendant ce temps « 0 ligne » et « Ce tableau de
  // bord est vide » seraient faux, la table n'est pas encore prête.
  S.dashboardReady = false;

  function connectionMessage() {
    if (S.connectionState === 'noTables') return t('status.noTables');
    if (S.connectionState === 'failed') return t('status.connectionFailed');
    return t('status.connecting');
  }

  // Texte COURT de la pastille « Données » tant qu'aucune table n'est connectée (la phrase complète
  // ci-dessus va dans l'état vide, assez large pour elle).
  function connectionShortMessage() {
    if (S.connectionState === 'noTables') return t('status.noTables.short');
    if (S.connectionState === 'failed') return t('status.failed.short');
    return t('status.connecting');
  }

  // `currentTableId` reste `null` tant qu'aucune table n'a pu être rejointe : un rendu déclenché
  // dans cet état (ex. un changement de langue) ne doit jamais écraser le message de connexion par
  // « 0 ligne », qui donnerait à tort l'impression qu'une table vide est connectée. Le même message
  // remplace aussi le conseil habituel de l'état vide (« Ajoutez-une tuile… », trompeur ici puisque
  // le formulaire est désactivé, voir setTableDependentControlsEnabled), bien plus visible que le
  // seul badge du bandeau ; un échec y propose « Réessayer ». Le conseil est MASQUÉ plutôt que
  // remplacé (le `textContent` de l'ancien code détruisait son <span> à jamais : une fois une
  // première table connectée, le conseil ne revenait plus).
  function renderConnectionStatus(state) {
    const connected = Boolean(S.currentTableId) && S.dashboardReady;
    dataPillNameEl.textContent = S.currentTableId ? S.currentTableId : connectionShortMessage();
    rowCountEl.textContent = connected ? t('status.rowCount', { n: state.rows.length }) : '';
    emptyStateHintEl.hidden = !connected;
    emptyStateReadHintEl.hidden = !connected;
    emptyStateStatusEl.hidden = connected;
    emptyStateStatusEl.textContent = connected ? '' : connectionMessage();
    retryConnectBtn.hidden = connected || S.connectionState !== 'failed';
    welcomeAddBtn.hidden = !connected;
  }

  function setConnectionState(next) {
    S.connectionState = next;
    renderConnectionStatus(store.getState());
  }

  // Pose le plan d'agencement d'UNE tuile (js/layouts.js:plan) : variables CSS lues par css/layouts.css (`--ls` colonnes, `--lr` rangées,
  // `--lc` colonne de départ du Rail), groupe et classes de repère. `item` absent (grille) = tout retirer, la tuile redevient ce qu'elle était.
  function applyTileLayout(el, item) {
    if (!item) {
      el.style.removeProperty('--ls');
      el.style.removeProperty('--lr');
      el.style.removeProperty('--lc');
      delete el.dataset.layoutGroup;
      el.classList.remove('layout-hero', 'layout-first');
      return;
    }
    el.style.setProperty('--ls', String(item.span));
    el.style.setProperty('--lr', String(item.rows));
    if (item.start) el.style.setProperty('--lc', String(item.start)); else el.style.removeProperty('--lc');
    el.dataset.layoutGroup = item.group;
    el.classList.toggle('layout-hero', !!item.hero);
    el.classList.toggle('layout-first', !!item.first);
  }

  function render(state) {
    // Style global des tuiles (js/styles.js) : posé AVANT les rendus ci-dessous, que js/charts.js lit à chaque tuile
    // (`GristBI.styles.current()`) — un changement de style repasse donc par ce `render()` complet, sans rien d'autre à rafraîchir.
    GristBI.styles.apply(state.dashStyle);
    GristBI.styles.applyOptions(state.dashStyleOptions);
    refreshStyleOptions(state.dashStyle, state.dashStyleOptions);
    // Balaie tout le document pour les attributs data-i18n-* (voir js/i18n.js) à CHAQUE rendu, pas
    // seulement au changement de langue : les boutons d'en-tête de tuile (buildTileElement) sont mis
    // en cache et jamais reconstruits tant que la tuile existe (voir juste en dessous), donc un
    // changement de langue seul ne les régénérerait pas — applyTranslations() les retrouve par leurs
    // attributs data-i18n-aria/-title et les corrige même sans reconstruction, même principe que la
    // relecture d'état en direct plutôt que capturée (voir js/charts.js).
    GristBI.i18n.applyTranslations();

    // Réconciliation incrémentale plutôt que innerHTML='' + reconstruction : une instance ECharts
    // reste attachée à SON élément .tile-chart tant que la tuile existe, sinon setOption() continue
    // de s'exécuter sur un canvas détaché du DOM (rendu invisible bien qu'aucune erreur ne soit levée).
    // Les tuiles vivent dans la grille OU dans la zone d'agrandissement : les deux sont relues.
    const existingEls = new Map(
      Array.from(tilesContainer.children).concat(Array.from(focusGridEl.children)).map((el) => [el.dataset.tileId, el])
    );
    const nextIds = new Set(state.tiles.map((t) => t.id));
    const zoomedIds = new Set(state.zoomedTileIds);
    // Agencement de la page (js/layouts.js) : un plan par page, posé en variables CSS sur chaque tuile. L'ordre ENREGISTRÉ (`state.tiles`) ne
    // change jamais ; seul l'ordre AFFICHÉ en dérive (les chiffres d'abord) et c'est lui qu'on pose dans le DOM, pour que la tabulation suive l'écran.
    const layoutId = GristBI.layouts.normalizeLayoutId(state.pageLayout);
    const layoutPlan = GristBI.layouts.plan(layoutId, state.tiles);
    const displayTiles = layoutPlan ? GristBI.layouts.displayOrder(layoutId, state.tiles) : state.tiles;
    if (layoutPlan) tilesContainer.dataset.layout = layoutId; else delete tilesContainer.dataset.layout;
    if (layoutPlan && layoutPlan.hasRail) tilesContainer.dataset.hasRail = ''; else delete tilesContainer.dataset.hasRail;
    refreshLayoutOptions(state);

    for (const [id, el] of existingEls) {
      if (!nextIds.has(id)) {
        GristBI.charts.disposeTile(id);
        el.remove();
        existingEls.delete(id);
      }
    }

    // Une tuile agrandie est DÉPLACÉE dans la zone d'agrandissement, jamais recréée : son élément (donc
    // son graphique ECharts, piège n°6) reste le même, seule sa place dans le DOM change — et
    // `resizeAll()` plus bas lui donne sa nouvelle taille. Chaque conteneur garde l'ordre d'affichage des
    // tuiles ; on ne touche au DOM que si la place est mauvaise (avant : un déplacement à chaque rendu).
    let previousGridEl = null;
    let previousFocusEl = null;
    displayTiles.forEach((tile) => {
      let el = existingEls.get(tile.id);
      // Une tuile dont le TYPE a changé (Modifier > Changer de type) ne peut pas garder son élément : le balisage
      // (KPI, texte, graphique), la classe `tile-<type>` et l'instance ECharts attachée sont ceux de l'ancien type
      // (un graphique ne se dessinerait plus, un bouton Détail resterait masqué...). On le recrée.
      if (el && el.dataset.tileType !== tile.type) {
        GristBI.charts.disposeTile(tile.id);
        el.remove();
        existingEls.delete(tile.id);
        el = null;
      }
      if (!el) {
        el = buildTileElement(tile);
        existingEls.set(tile.id, el);
      }
      const isZoomed = zoomedIds.has(tile.id);
      const target = isZoomed ? focusGridEl : tilesContainer;
      const previousEl = isZoomed ? previousFocusEl : previousGridEl;
      if (el.parentElement !== target || el.previousElementSibling !== previousEl) {
        if (previousEl) previousEl.after(el); else target.prepend(el);
      }
      if (isZoomed) previousFocusEl = el; else previousGridEl = el;
      el.classList.toggle('tile-zoomed', isZoomed);
      applyTileLayout(el, layoutPlan && layoutPlan.items[tile.id]);
      const zoomBtn = el.querySelector('.tile-zoom');
      if (zoomBtn) {
        const zoomKey = isZoomed ? 'tile.unzoom' : 'tile.zoom';
        zoomBtn.setAttribute('aria-pressed', String(isZoomed));
        zoomBtn.setAttribute('aria-label', t(zoomKey + '.aria'));
        zoomBtn.title = t(zoomKey + '.title');
      }
      // Recalculé à chaque rendu (pas seulement à la création) : la position d'une tuile change
      // quand une autre est ajoutée/supprimée/déplacée autour d'elle.
      // Titre rafraîchi à chaque rendu : suit un changement de langue (titre auto-composé, voir
      // i18n.js:tileTitle) comme une modification de la tuile (l'élément est mis en cache).
      const titleEl = el.querySelector('.tile-title');
      if (titleEl) {
        const titleText = GristBI.i18n.tileTitle(tile);
        if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
        titleEl.title = titleText;
      }
      const moveLeftBtn = el.querySelector('.tile-move-left');
      const moveRightBtn = el.querySelector('.tile-move-right');
      // Dans un agencement, une tuile ne dépasse que celles de son groupe (js/layouts.js:moveTarget) : sinon rien ne changerait à l'écran.
      if (moveLeftBtn) moveLeftBtn.disabled = GristBI.layouts.moveTarget(layoutId, state.tiles, tile.id, -1) === null;
      if (moveRightBtn) moveRightBtn.disabled = GristBI.layouts.moveTarget(layoutId, state.tiles, tile.id, 1) === null;
      // Badge de compte sur le bouton "Commentaires" : recalculé à chaque rendu (comme
      // moveLeftBtn/moveRightBtn ci-dessus), jamais seulement à la création de la tuile — un
      // commentaire peut être ajouté alors que la tuile est déjà affichée depuis longtemps.
      const commentsCountEl = el.querySelector('.tile-comments-count');
      if (commentsCountEl) {
        const n = GristBI.data.commentsForTile(state.comments, tile.id).length;
        commentsCountEl.hidden = n === 0;
        commentsCountEl.parentElement.classList.toggle('has-comments', n > 0);
        commentsCountEl.textContent = n > 99 ? '99+' : String(n);
      }
    });

    focusZoneEl.hidden = zoomedIds.size === 0;
    focusLabelEl.textContent = t('zoom.count', { n: zoomedIds.size });
    emptyState.hidden = state.tiles.length > 0;
    welcomeEl.hidden = state.tiles.length > 0;
    GristBI.welcome.update(state, Boolean(S.currentTableId) && S.dashboardReady, S.currentTableId);
    // Temps de rendu affiché dans le bandeau : utile pour repérer à l'œil un ralentissement sur une
    // table de travail à fort volume, sans devoir ouvrir les DevTools à chaque fois.
    const renderStart = performance.now();
    for (const tile of state.tiles) GristBI.charts.renderTile(tile, state, workspaceMainEl);
    // Le nombre de tuiles change la largeur de chaque colonne de la grille CSS ; ECharts ne
    // réagit pas seul à un redimensionnement de son conteneur (pas d'observer par défaut).
    GristBI.charts.resizeAll();
    if (renderTimeEl) {
      const ms = Math.round(performance.now() - renderStart);
      renderTimeEl.textContent = state.tiles.length ? t('status.renderTime', { ms }) : '';
    }

    renderPageTabs(state.pages, state.currentPageId);
    renderFilterBadges(state.activeFilters);
    renderAdvancedFilterBadges(state.advancedFilters);
    renderFilterSummary(state.activeFilters.length + state.advancedFilters.length, Boolean(state.activeBookmarkId));
    applyMode();
    setTableDependentControlsEnabled(Boolean(S.currentTableId) && S.dashboardReady);
    renderBookmarks(state);
    renderConnectionStatus(state);
    fitPageTabs();

    // `pages`/`currentPageId`/`bookmarks` ne changent de référence/valeur que via leurs actions
    // dédiées (state.js) : un rendu déclenché par un simple rafraîchissement de données (setRows) ne
    // doit pas re-déclencher une écriture dans le document Grist (évite de polluer l'historique à
    // chaque édition externe). Changer de page ne modifie QUE currentPageId (référence de `pages`
    // inchangée) mais mérite quand même d'être sauvegardé, comme la page active dans Power BI.
    if (state.pages !== lastRenderedPages || state.currentPageId !== lastRenderedCurrentPageId ||
        state.bookmarks !== lastRenderedBookmarks || state.blend !== lastRenderedBlend || state.dashStyle !== lastRenderedDashStyle ||
        state.dashStyleOptions !== lastRenderedDashStyleOptions) {
      lastRenderedPages = state.pages;
      lastRenderedCurrentPageId = state.currentPageId;
      lastRenderedBookmarks = state.bookmarks;
      lastRenderedBlend = state.blend;
      lastRenderedDashStyle = state.dashStyle;
      lastRenderedDashStyleOptions = state.dashStyleOptions;
      // Consigne GFS 009 : pendant que switchTable CHARGE un rapport (même vierge, "Nouveau" dans
      // GFS), ce bloc s'exécute une fois par store.set* (jusqu'à 3 fois, un par champ chargé) sans
      // qu'aucun geste de la personne n'ait eu lieu — lastRendered* est quand même mis à jour
      // ci-dessus (pour ne pas se retrouver désynchronisé au prochain geste réel), mais aucune
      // sauvegarde n'est planifiée tant que switchTable n'a pas fini de poser son chargement.
      if (!S.suppressNextSave) scheduleSave(state.pages, state.currentPageId, state.bookmarks, state.blend, state.dashStyle, state.dashStyleOptions);
    }
    // Tient la liste du panneau Commentaires à jour s'il est ouvert (ajout d'un commentaire,
    // changement de langue...) sans avoir à le refermer/rouvrir — no-op si fermé
    // (commentsModalTileId à null, voir sa définition).
    renderCommentsModal();
    // Même principe pour la modale de détail : un filtre posé/levé pendant qu'elle est ouverte doit
    // se refléter dans les lignes affichées, pas seulement au prochain clic sur le bouton Détail.
    renderDetailModal();
  }

  // Une page ne se supprime jamais toute seule (state.js:removePage refuse de vider la dernière),
  // donc pas besoin de gérer un état "aucune page" ici. Onglets d'un `tablist` ARIA (audit UI/UX du
  // 18/11/2026) : `role="tab"` + `aria-selected`, un seul onglet dans l'ordre de tabulation
  // (`tabindex` itinérant), flèches ← → / Début / Fin pour passer d'une page à l'autre
  // (`GristBI.appbar.tabKeyTarget`, testé sous Node). Renommer (double-clic) et supprimer (croix de
  // l'onglet actif, seulement s'il y a plus d'une page) ne sont offerts qu'en mode Édition ; la croix
  // est un 2e bouton à côté de l'onglet, jamais un contrôle imbriqué dans un bouton.
  function updateTabsOverflow() {
    pageTabsEl.classList.toggle('overflows', pageTabsEl.scrollWidth > pageTabsEl.clientWidth + 1);
  }

  // Les onglets sont la navigation : le reste de la barre s'allège avant qu'un onglet ne soit rogné (bug réel n°51 : « Segments » coupé à
  // 1100 et 1200 px dès qu'une vue était suivie ; avec 4 pages, réduit à une lettre). Deux paliers, essayés dans l'ordre à partir de la
  // barre complète, et gardés seulement s'ils servent :
  // 1. `bar-names-hidden` : le nom de la vue suivie écrit dans le bouton Vues (un rappel : la pastille « Vue » de la rangée des filtres et
  //    le nom accessible du bouton le disent aussi) ;
  // 2. `bar-labels-hidden` : les libellés des boutons (icônes seules, comme au-dessous de 900 px) — SEULEMENT si les onglets tiennent alors ;
  //    sinon (beaucoup de pages) les boutons gardent leur texte et les onglets défilent, avec le fondu de bord (`overflows`).
  // À rappeler après tout ce qui change la largeur de la barre : `render()` en dernier (le nom de la vue est posé APRÈS le rendu des onglets,
  // d'où le fondu qui restait faux), le changement de mode ou de langue, la taille de la fenêtre, et un ResizeObserver en filet de sécurité.
  const appbarEl = document.getElementById('appbar');

  const tabsClipped = () => pageTabsEl.scrollWidth > pageTabsEl.clientWidth + 1;

  function fitPageTabs() {
    if (appbarEl) {
      GristBI.appbar.fitTabsLevel(tabsClipped, (level) => {
        appbarEl.classList.toggle('bar-names-hidden', level === 1);
        appbarEl.classList.toggle('bar-labels-hidden', level === 2);
      }, !viewsActiveNameEl.hidden);
    }
    updateTabsOverflow();
    revealActiveTab();
  }

  // L'onglet actif doit rester visible dans une liste qui défile (la largeur disponible vient peut-être de changer). On fait défiler la LISTE
  // des onglets seulement, jamais `scrollIntoView` : il fait aussi défiler la page, et la barre étant collante (`sticky`), un redimensionnement
  // de la fenêtre emportait la page plus bas (bug réel n°52, vu en prenant des captures pleine page).
  function revealActiveTab() {
    const tab = pageTabsEl.querySelector('.page-tab-group.active');
    if (!tab) return;
    const box = pageTabsEl.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left < box.left) pageTabsEl.scrollLeft -= box.left - at.left;
    else if (at.right > box.right) pageTabsEl.scrollLeft += at.right - box.right;
  }

  window.addEventListener('resize', fitPageTabs);

  // Différé d'une image : modifier la barre dans le rappel d'un ResizeObserver qui l'observe ferait « loop completed with undelivered notifications ».
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(fitPageTabs)).observe(pageTabsEl);

  let restoreTabFocus = false;
 // le rendu qui suit une flèche doit rendre le focus à l'onglet actif
  function renderPageTabs(pages, currentPageId) {
    GristBI.safeHtml.setHtml(pageTabsEl, pages.map((p) => {
      const active = p.id === currentPageId;
      const removeBtn = active && pages.length > 1
        ? `<button type="button" class="page-tab-remove edit-only" data-page-id="${escapeHtml(p.id)}" title="${escapeHtml(t('pages.remove.title'))}" aria-label="${escapeHtml(t('pages.remove.title'))}">${icon('close')}</button>`
        : '';
      return `<span class="page-tab-group${active ? ' active' : ''}"><button type="button" class="page-tab${active ? ' active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-page-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>${removeBtn}</span>`;
    }).join(''));
    const tabs = Array.from(pageTabsEl.querySelectorAll('.page-tab'));
    tabs.forEach((tab, index) => {
      const pageId = tab.dataset.pageId;
      tab.addEventListener('click', () => store.setCurrentPage(pageId));
      tab.addEventListener('keydown', (e) => {
        const target = GristBI.appbar.tabKeyTarget(e.key, index, tabs.length);
        if (target == null) return;
        e.preventDefault();
        restoreTabFocus = true;
        store.setCurrentPage(tabs[target].dataset.pageId);
      });
      tab.addEventListener('dblclick', async () => {
        if (S.mode !== 'edit') return;
        const page = pages.find((p) => p.id === pageId);
        const answer = await GristBI.dialogs.prompt({
          title: t('pages.rename.title'), label: t('pages.rename.prompt'),
          value: page ? page.name : '', confirmLabel: t('pages.rename.confirm')
        });
        const name = (answer || '').trim();
        if (name) store.renamePage(pageId, name);
      });
    });
    const activeTab = pageTabsEl.querySelector('.page-tab.active');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (restoreTabFocus) {
      restoreTabFocus = false;
      if (activeTab) activeTab.focus();
    }
    for (const removeBtn of pageTabsEl.querySelectorAll('.page-tab-remove')) {
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pageId = removeBtn.dataset.pageId;
        const page = pages.find((p) => p.id === pageId);
        const ok = await GristBI.dialogs.confirm({
          title: t('pages.remove.dialogTitle'), message: t('pages.remove.confirm', { name: page ? page.name : '' }),
          confirmLabel: t('pages.remove.confirmLabel'), danger: true
        });
        if (ok) store.removePage(pageId);
      });
    }
  }

  // Un badge par filtre actif (plusieurs colonnes peuvent être filtrées en même temps), chacun
  // avec son propre bouton de suppression, + le bouton "Effacer les filtres" global reste utile
  // dès qu'il y en a 2+.
  function renderFilterBadges(activeFilters) {
    GristBI.safeHtml.setHtml(filterBadgesEl, activeFilters.map((f) => `
      <span class="filter-chip">
        ${f.type && f.type !== 'eq' ? escapeHtml(describeAdvancedFilter(f)) : `${escapeHtml(f.column)} = ${escapeHtml(String(f.value))}`}
        <button type="button" class="filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="${escapeHtml(t('filters.remove.aria'))}">${icon('close')}</button>
      </span>
    `).join(''));
    for (const btn of filterBadgesEl.querySelectorAll('.filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearFilter(btn.dataset.column));
    }
  }

  // Rangée de pastilles sous la barre (visible seulement avec au moins un filtre, croisé ou avancé),
  // « Effacer les filtres » (les deux familles) et compteur sur le bouton « Filtre ».
  // La rangée reste visible tant qu'une vue sauvegardée est suivie, même sans aucun filtre (la vue
  // peut être « modifiée » justement parce qu'on les a tous levés).
  function renderFilterSummary(total, viewTracked) {
    chipsRowEl.hidden = total === 0 && !viewTracked;
    clearFilterBtn.hidden = total === 0;
    filterCountEl.hidden = total === 0;
    filterCountEl.textContent = String(total);
  }

  // Mêmes clés que les options du <select> "Période" du formulaire de filtre avancé (voir
  // index.html/harness.html, filters.relative.*) — un seul texte traduit pour les deux.
  const RELATIVE_DATE_KEYS = {
    last7d: 'filters.relative.last7d', last30d: 'filters.relative.last30d', thisMonth: 'filters.relative.thisMonth',
    thisYear: 'filters.relative.thisYear', last12m: 'filters.relative.last12m'
  };

  // Libellé lisible d'un filtre avancé pour son badge (voir GristBI.data.matchesFilter pour la
  // sémantique de chaque type). Une plage/plage de dates avec une seule borne renseignée l'affiche
  // sans l'autre plutôt que "… – " ou "de … à undefined".
  function describeAdvancedFilter(f) {
    switch (f.type) {
      case 'range': {
        // Classe d'histogramme : borne haute exclue (voir data.js:matchesFilter, `maxExclusive`).
        if (f.min != null && f.max != null && f.maxExclusive) return t('filters.rangeExclusive', { column: f.column, min: f.min, max: f.max });
        if (f.min != null && f.max != null) return `${f.column} : ${f.min} – ${f.max}`;
        if (f.min != null) return `${f.column} ≥ ${f.min}`;
        if (f.max != null) return `${f.column} ≤ ${f.max}`;
        return `${f.column} : ${t('filters.emptyRange')}`;
      }
      case 'dateRange': {
        if (f.start && f.end) return `${f.column} : ${f.start} → ${f.end}`;
        if (f.start) return `${f.column} ≥ ${f.start}`;
        if (f.end) return `${f.column} ≤ ${f.end}`;
        return `${f.column} : ${t('filters.emptyRange')}`;
      }
      case 'relativeDate':
        return `${f.column} : ${RELATIVE_DATE_KEYS[f.preset] ? t(RELATIVE_DATE_KEYS[f.preset]) : f.preset}`;
      case 'contains':
        return `${f.column} ${t('filters.contains')} "${f.query}"`;
      default:
        return `${f.column} : ${f.type}`;
    }
  }

  // Filtres avancés (barre dédiée, pas un clic sur une tuile) : mêmes badges que les filtres
  // croisés, mais retirés via clearAdvancedFilter et sans bouton "Effacer les filtres" partagé (une
  // barre de filtres avancés vide se contente de n'afficher aucun badge).
  function renderAdvancedFilterBadges(advancedFilters) {
    GristBI.safeHtml.setHtml(advancedFilterBadgesEl, advancedFilters.map((f) => `
      <span class="filter-chip">
        ${escapeHtml(describeAdvancedFilter(f))}
        <button type="button" class="advanced-filter-chip-remove" data-column="${escapeHtml(f.column)}" aria-label="${escapeHtml(t('filters.remove.aria'))}">${icon('close')}</button>
      </span>
    `).join(''));
    for (const btn of advancedFilterBadgesEl.querySelectorAll('.advanced-filter-chip-remove')) {
      btn.addEventListener('click', () => store.clearAdvancedFilter(btn.dataset.column));
    }
  }

  // Menu Vues + suivi de la vue active (retours d'Antoine du 18/11/2026, point 4). Avant : un <select>
  // qui appliquait la vue au choix mais n'indiquait ni laquelle on regardait, ni si les filtres s'en
  // étaient écartés. Maintenant : la liste des vues (la vue suivie cochée, « modifiée » si besoin,
  // une croix par vue), le nom de la vue suivie sur le bouton de la barre (+ un point quand elle est
  // modifiée) et une pastille sous la barre pour la mettre à jour ou la quitter. Les écouteurs sont
  // posés une fois sur la liste (délégation) : elle est reconstruite à chaque rendu.
  function renderBookmarks(state) {
    const bookmarks = state.bookmarks;
    const active = bookmarks.find((b) => b.id === state.activeBookmarkId) || null;
    const modified = Boolean(active) && state.activeBookmarkModified;

    GristBI.safeHtml.setHtml(viewsListEl, bookmarks.map((b) => {
      const isActive = active && b.id === active.id;
      return `<li class="views-item${isActive ? ' views-item-active' : ''}">
        <button type="button" class="views-item-apply" data-id="${escapeHtml(b.id)}"${isActive ? ' aria-current="true"' : ''}
                aria-label="${escapeHtml(t('views.apply.aria', { name: b.name }))}">
          <svg class="icon icon-check views-item-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7"/></svg>
          <span class="views-item-name">${escapeHtml(b.name)}</span>
          ${isActive ? `<span class="views-item-badge${modified ? ' is-modified' : ''}">${escapeHtml(t(modified ? 'views.modified' : 'views.current'))}</span>` : ''}
        </button>
        <button type="button" class="views-item-delete" data-id="${escapeHtml(b.id)}"
                aria-label="${escapeHtml(t('views.delete.aria', { name: b.name }))}" title="${escapeHtml(t('views.delete.title'))}">
          <svg class="icon icon-close" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </li>`;
    }).join(''));
    viewsEmptyEl.hidden = bookmarks.length > 0;

    updateBookmarkBtn.hidden = !modified;
    if (modified) updateBookmarkBtn.textContent = t('views.update', { name: active.name });
    saveBookmarkBtn.textContent = t(active ? 'views.saveNew' : 'bookmarks.save');

    viewsActiveNameEl.hidden = !active;
    viewsActiveNameEl.textContent = active ? active.name : '';
    viewsActiveDotEl.hidden = !modified;
    viewsToggleBtn.dataset.viewActive = active ? 'true' : 'false';
    const toggleName = active ? t(modified ? 'views.toggle.ariaModified' : 'views.toggle.aria', { name: active.name }) : t('bar.views');
    viewsToggleBtn.setAttribute('aria-label', toggleName);
    viewsToggleBtn.title = toggleName;

    viewChipEl.hidden = !active;
    viewChipEl.dataset.modified = modified ? 'true' : 'false';
    viewChipNameEl.textContent = active ? active.name : '';
    viewChipModifiedEl.hidden = !modified;
    viewChipUpdateBtn.hidden = !modified;
  }

  // `opts.preview` : version de l'aperçu du panneau latéral — même corps (c'est ce que cherchent les
  // fonctions de rendu de js/charts.js), mais sans les boutons d'action ni les écouteurs du store.
  function buildTileElement(tile, opts) {
    const preview = Boolean(opts && opts.preview);
    const el = document.createElement('div');
    el.className = `tile tile-${tile.type}`;
    el.dataset.tileId = tile.id;
    el.dataset.tileType = tile.type;
    // data-i18n-aria/-title (en plus du texte déjà traduit ci-dessous) : cette tuile est mise en
    // cache et jamais reconstruite tant qu'elle existe (voir render()), donc un changement de
    // langue seul ne repasserait jamais ici — c'est GristBI.i18n.applyTranslations(), appelé à
    // chaque render(), qui retrouve ces boutons par leurs attributs et les corrige sans
    // reconstruction (voir le commentaire en tête de render()).
    const header = `<div class="tile-header"><span class="tile-title" title="${escapeHtml(GristBI.i18n.tileTitle(tile))}">${escapeHtml(GristBI.i18n.tileTitle(tile))}</span>
        ${preview ? '' : `<span class="tile-actions">
          <button class="tile-move-left edit-only" type="button" data-i18n-aria="tile.moveLeft" data-i18n-title="tile.moveLeft" aria-label="${escapeHtml(t('tile.moveLeft'))}" title="${escapeHtml(t('tile.moveLeft'))}">${icon('chevronLeft')}</button>
          <button class="tile-move-right edit-only" type="button" data-i18n-aria="tile.moveRight" data-i18n-title="tile.moveRight" aria-label="${escapeHtml(t('tile.moveRight'))}" title="${escapeHtml(t('tile.moveRight'))}">${icon('chevronRight')}</button>
          <button class="tile-edit edit-only" type="button" data-i18n-aria="tile.edit.aria" data-i18n-title="tile.edit.title" aria-label="${escapeHtml(t('tile.edit.aria'))}" title="${escapeHtml(t('tile.edit.title'))}">${icon('edit')}</button>
          <button class="tile-zoom" type="button" aria-pressed="false" aria-label="${escapeHtml(t('tile.zoom.aria'))}" title="${escapeHtml(t('tile.zoom.title'))}">${icon('expand')}${icon('collapse')}</button>
          <button class="tile-comments" type="button" data-i18n-aria="tile.comments.aria" data-i18n-title="tile.comments.title" aria-label="${escapeHtml(t('tile.comments.aria'))}" title="${escapeHtml(t('tile.comments.title'))}">${icon('comment')}<span class="tile-comments-count" hidden></span></button>
          <button class="tile-detail" type="button" data-i18n-aria="tile.detail.aria" data-i18n-title="tile.detail.title" aria-label="${escapeHtml(t('tile.detail.aria'))}" title="${escapeHtml(t('tile.detail.title'))}">${icon('search')}</button>
          <button class="tile-remove edit-only" type="button" data-i18n-aria="tile.remove.aria" data-i18n-title="tile.remove.title" aria-label="${escapeHtml(t('tile.remove.aria'))}" title="${escapeHtml(t('tile.remove.title'))}">${icon('close')}</button>
        </span>`}</div>`;
    GristBI.safeHtml.setHtml(el, tile.type === 'text'
      ? `${header}
         <div class="tile-text-body"></div>`
      : tile.type === 'kpi'
      ? `${header}
         <div class="tile-kpi">
           <span class="tile-kpi-value">-</span>
           <span class="tile-kpi-label">${escapeHtml(tile.aggFn)}(${escapeHtml(tile.measure)})</span>
           <span class="tile-kpi-trend" hidden></span>
           <div class="tile-kpi-spark" hidden></div>
           <div class="tile-kpi-goal" hidden>
             <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="goal-fill"></span></div>
             <div class="goal-text"><span class="goal-pct"></span><span class="goal-target"></span></div>
           </div>
         </div>`
      : `${header}
         <div class="tile-breadcrumb" data-tile-id="${escapeHtml(tile.id)}" hidden></div>
         <div class="tile-chart" data-tile-id="${escapeHtml(tile.id)}"></div>`);
    if (preview) return el;
    el.querySelector('.tile-remove').addEventListener('click', () => {
      if (tile.id === S.editingTileId) closeTilePanel(false); // formulaire en cours d'édition sur une tuile qui disparaît
      store.removeTile(tile.id);
    });
    // Toujours la tuile VIVE du store, jamais l'objet capturé à la création de cet élément (mis en
    // cache et jamais reconstruit, voir render()) : après une modification, ce dernier serait périmé
    // (le formulaire d'édition rechargerait les anciennes valeurs).
    const liveTile = () => store.getState().tiles.find((x) => x.id === tile.id) || tile;
    el.querySelector('.tile-edit').addEventListener('click', () => startEditTile(liveTile()));
    // Agrandir/réduire : le rendu suivant déplace la tuile ; on la ramène ensuite à l'écran, la zone
    // d'agrandissement étant au-dessus de ce que la personne regardait peut-être.
    el.querySelector('.tile-zoom').addEventListener('click', () => { store.toggleZoom(tile.id); flashTile(tile.id); });
    el.querySelector('.tile-comments').addEventListener('click', () => openCommentsModal(liveTile()));
    el.querySelector('.tile-detail').addEventListener('click', () => openDetailModal(liveTile()));
    // L'état est relu au clic (piège n°18), jamais figé à la création de la tuile : la page change d'agencement sans que la tuile soit recréée.
    const moveBy = (direction) => {
      const live = store.getState();
      const target = GristBI.layouts.moveTarget(live.pageLayout, live.tiles, tile.id, direction);
      if (target !== null) store.moveTile(tile.id, direction, target);
    };
    el.querySelector('.tile-move-left').addEventListener('click', () => moveBy(-1));
    el.querySelector('.tile-move-right').addEventListener('click', () => moveBy(1));
    return el;
  }
  // Pour js/export.js : la carte d'une tuile (sans ses boutons) reconstruite hors écran, pour photographier TOUTES les pages de l'export Excel.
  GristBI.buildTileElement = buildTileElement;

  viewsListEl.addEventListener('click', async (e) => {
    const applyBtn = e.target.closest('.views-item-apply');
    const deleteBtn = e.target.closest('.views-item-delete');
    if (applyBtn) {
      store.applyBookmark(applyBtn.dataset.id);
      GristBI.appbar.closePopovers();
    } else if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const bm = store.getState().bookmarks.find((b) => b.id === id);
      if (!bm) return;
      const ok = await GristBI.dialogs.confirm({
        title: t('views.delete.dialogTitle'), message: t('views.delete.confirm', { name: bm.name }),
        confirmLabel: t('views.delete.confirmLabel'), danger: true
      });
      if (ok) store.removeBookmark(id);
    }
  });

  updateBookmarkBtn.addEventListener('click', () => {
    const id = store.getState().activeBookmarkId;
    if (id) store.updateBookmark(id);
  });

  viewChipUpdateBtn.addEventListener('click', () => {
    const id = store.getState().activeBookmarkId;
    if (id) store.updateBookmark(id);
  });

  viewChipLeaveBtn.addEventListener('click', () => store.leaveBookmark());

  saveBookmarkBtn.addEventListener('click', async () => {
    const answer = await GristBI.dialogs.prompt({
      title: t('bookmarks.save.title'), label: t('bookmarks.save.prompt'), confirmLabel: t('bookmarks.save.confirm')
    });
    const name = (answer || '').trim();
    if (!name) return; // annulé ou vide
    store.saveBookmark('bm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name);
  });

  // Une feuille par PAGE, toutes les pages (voir GristBI.data.buildExportPagesAsync), et dans chaque page un bloc par tuile :
  // son graphique en image puis ses données, déjà agrégées/filtrées EXACTEMENT comme à l'écran (rowsForTile est la même fonction
  // que charts.js), y compris pour une tuile en mode mesure (Cumul/YTD/N-1) calculée via DuckDB-WASM (voir js/export.js).
  // Les graphiques sont redessinés hors écran puis photographiés (quelques secondes pour un grand tableau de bord) : le bouton
  // est fermé pendant ce temps et le bandeau le dit, sinon un second clic lancerait un second export. Jamais vérifié en
  // conditions réelles Grist que le téléchargement se déclenche bien depuis l'iframe du widget (voir HYPOTHESES.md) —
  // fonctionne dans ce harness et un navigateur standard, l'iframe n'étant pas sandboxée (voir ROADMAP.md).
  exportExcelBtn.addEventListener('click', async () => {
    if (!EXCEL_EXPORT_AVAILABLE || exportExcelBtn.dataset.busy) return;
    exportExcelBtn.dataset.busy = '1';
    exportExcelBtn.disabled = true;
    if (renderTimeEl) renderTimeEl.textContent = t('export.xlsx.preparing');
    try {
      const exported = await GristBI.exportExcel.exportDashboardToExcel(store.getState());
      if (!exported) showNotice(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export Excel', e);
      showError(t('export.failed'));
    } finally {
      delete exportExcelBtn.dataset.busy;
      exportExcelBtn.disabled = !EXCEL_EXPORT_AVAILABLE || !(Boolean(S.currentTableId) && S.dashboardReady);
      if (renderTimeEl && renderTimeEl.textContent === t('export.xlsx.preparing')) renderTimeEl.textContent = '';
    }
  });

  // PDF et PPTX : seulement la page actuellement affichée (voir js/pdf-export.js, js/pptx-export.js), pas toutes les pages comme l'export Excel ; la page
  // est photographiée telle qu'elle est dessinée (js/snapshot.js), ce qui prend une à quelques secondes : le bouton est fermé pendant ce temps (sinon un
  // second clic lancerait un second export), puis rendu dans l'état que setTableDependentControlsEnabled lui donne.
  async function runPageExport(btn, run, failureMessage) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    try {
      const exported = await run(store.getState());
      if (!exported) showNotice(t('export.none'));
    } catch (e) {
      console.error('[GristBI] échec de l\'export', e);
      showError(failureMessage(e));
    } finally {
      delete btn.dataset.busy;
      btn.disabled = !(Boolean(S.currentTableId) && S.dashboardReady);
    }
  }

  exportPdfBtn.addEventListener('click', () => runPageExport(exportPdfBtn,
    (state) => GristBI.exportPdf.exportDashboardToPdf(state), () => t('export.pdf.failed')));

  // PptxGenJS est chargé à la demande (js/pptx-export.js) : seul un échec de CE chargement parle de connexion.
  exportPptxBtn.addEventListener('click', () => runPageExport(exportPptxBtn,
    (state) => GristBI.exportPptx.exportDashboardToPptx(state),
    (e) => t(e && e.code === GristBI.exportPptx.LOAD_ERROR_CODE ? 'export.pptx.networkError' : 'export.pptx.failed')));

  addPageBtn.addEventListener('click', async () => {
    const answer = await GristBI.dialogs.prompt({
      title: t('pages.new.title'), label: t('pages.new.prompt'),
      value: `Page ${store.getState().pages.length + 1}`, confirmLabel: t('pages.new.confirm')
    });
    const name = (answer || '').trim();
    if (name) store.addPage(name);
  });

  // « Effacer les filtres » repart d'une page blanche : on quitte aussi la vue suivie (en premier,
  // pour qu'un rendu intermédiaire ne l'affiche pas « modifiée » une fraction de seconde).
  focusResetBtn.addEventListener('click', () => store.clearZoom());

  clearFilterBtn.addEventListener('click', () => { store.leaveBookmark(); store.clearFilter(); store.clearAdvancedFilter(); });

  modeToggleBtn.addEventListener('click', () => setMode(S.mode === 'edit' ? 'read' : 'edit'));
})(window);
