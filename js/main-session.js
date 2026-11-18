/*
 * Bootstrap de l'UI — session : sauvegarde différée de la configuration, table de travail (changement, jointure,
 * rechargement), ouverture d'un rapport ou d'un modèle. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { t } = GristBI.i18n;
  const {
    autoMode, availableColumns, blendJoinColumns, blendPrimaryColumnInput, blendSecondaryColumnInput,
    blendSecondaryTableInput, closeTilePanel, currentReportAuthorLabel, fillCombobox, genTileId, refreshColumnSelects,
    render, renderConnectionStatus, retryConnectBtn, setConnectionState, sharedReadOnlyWarning, showError, showNotice,
    store, tableSelectInput, withDateHierarchies
  } = parts;
  Object.assign(parts, {
    connectToFirstTable, flushPendingSave, openBlankReport, openModelById, openReportById, refreshBlendPicker,
    refreshTablePicker, reloadWorkingTable, scheduleSave, switchTable
  });

  // Rapport actuellement ouvert, au sens de la consigne GFS 007 point 2/3 : une LIGNE précise de
  // BI_Dashboard_Config (un `id` Grist), jamais un `TableId` seul (plusieurs rapports peuvent
  // partager la même table de travail). `null` = comportement HISTORIQUE (hors GFS, ou table
  // choisie via le sélecteur) : GristBI.api.saveConfig retombe alors sur "la première ligne qui
  // porte ce TableId", exactement comme avant cette consigne. Le jeton `'new'` marque un rapport
  // vierge ("Nouveau" dans GFS) dont la ligne n'existe pas encore : voir openBlankReport/
  // scheduleSave plus bas pour comment il se résout en un vrai id à la première sauvegarde.
  let currentReportId = null;
 // voir renderDetailModal : au-delà, l'export Excel reste la voie pour tout voir
  let saveTimer = null;

  let pendingSave = null;

  // Lignes BRUTES (non jointes) de la table de travail PRINCIPALE, tenues à jour par switchTable —
  // c'est TOUJOURS depuis celles-ci que la jointure de data blending est recalculée (voir
  // applyBlend), jamais depuis store.getState().rows qui peut déjà porter les colonnes préfixées
  // d'une jointure précédente : rejoindre des lignes déjà jointes les préfixerait une seconde fois.
  let currentPrimaryRows = [];

  // { secondaryTableId, primaryColumn, secondaryColumn } de la table de travail courante, ou null
  // (aucune jointure) — miroir de currentTableId, tenu à jour par switchTable/commitBlendFromForm.
  let currentBlend = null;

  // Menu Filtre (retour d'Antoine du 18/11/2026) : la colonne se choisit dans une LISTE visible et
  // cliquable, et les valeurs du filtre texte sont une liste cliquable sous le champ — plus aucun
  // combobox (sa liste s'ouvrait au focus et débordait du panneau). Voir renderFilterColumns /
  // refreshFilterValues plus bas.

  // Sélecteur de TABLE (pas une colonne, mais même composant/mêmes raisons : autocomplétion,
  // simple et efficace) — voir refreshTablePicker()/le listener 'change' plus bas. `beforeOpen`
  // relit la liste des tables à CHAQUE ouverture du menu (pas seulement au démarrage/après un
  // changement de table réussi comme le fait refreshTablePicker par ailleurs) : une table créée
  // dans Grist après le chargement du widget doit rester atteignable sans recharger la page
  // [DÉFAUT RÉEL, voir HYPOTHESES.md].
  GristBI.combobox.attach(tableSelectInput, tableSelectInput.nextElementSibling, { strict: true, beforeOpen: refreshTablePicker });

  // Data blending multi-tables (ROADMAP.md Tier 2) : trois comboboxes de plus, même composant/même
  // raisonnement que le sélecteur de table ci-dessus. Les 3 ont un `blankLabel` "(aucune)" — pas
  // seulement la table secondaire : un blend est TOUT ou RIEN (voir commitBlendFromForm), donc les
  // 3 champs doivent pouvoir représenter "pas encore choisi"/"jointure retirée" de façon valide,
  // même convention que les champs de drill-down/Tendance optionnels (blankLabel "(aucun)"/
  // "(aucune)"). Attention : `fillCombobox` réinitialise le blankLabel à CHAQUE appel (voir sa
  // définition plus bas) — tout rafraîchissement de ces 2 derniers champs doit donc toujours
  // repasser `{ blankLabel: t('blend.none') }`, jamais l'omettre. `beforeOpen` relit toujours à la
  // demande, jamais un instantané : une table créée dans Grist entre-temps doit rester atteignable,
  // comme pour le sélecteur de table principal.
  GristBI.combobox.attach(blendSecondaryTableInput, blendSecondaryTableInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'), beforeOpen: refreshSecondaryTablePicker
  });

  GristBI.combobox.attach(blendPrimaryColumnInput, blendPrimaryColumnInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'),
    beforeOpen: () => fillCombobox(blendPrimaryColumnInput, blendJoinColumns(currentPrimaryRows), { blankLabel: t('blend.none') })
  });

  GristBI.combobox.attach(blendSecondaryColumnInput, blendSecondaryColumnInput.nextElementSibling, {
    strict: true, blankLabel: t('blend.none'), beforeOpen: refreshBlendSecondaryColumnPicker
  });

  // `tableId` capturé À L'APPEL (pas relu dans le setTimeout) : sans ça, changer de table pendant
  // les 600ms de debounce fait s'exécuter la sauvegarde sous le tableId de la table SUIVANTE (bug
  // réel trouvé en testant le sélecteur de table — voir flushPendingSave()/HYPOTHESES.md). Même
  // raison pour `reportId`/`authorLabel` (consigne GFS 007) : capturés ici, jamais relus plus tard
  // dans le setTimeout.
  function scheduleSave(pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions) {
    if (!S.currentTableId) return;
    clearTimeout(saveTimer);
    pendingSave = { tableId: S.currentTableId, reportId: currentReportId, authorLabel: currentReportAuthorLabel(), pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions };
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const p = pendingSave;
      pendingSave = null;
      runPendingSave(p);
    }, 600);
  }

  // Partagé par scheduleSave/flushPendingSave : écrit `p` puis, si c'était la toute première
  // sauvegarde d'un rapport vierge ("Nouveau" dans GFS, voir openBlankReport plus bas), adopte
  // l'id réel que Grist vient d'assigner comme `currentReportId` — sinon les sauvegardes SUIVANTES
  // recréeraient chacune une nouvelle ligne au lieu de mettre à jour celle-ci (consigne GFS 007,
  // point 2/3). Cette promotion ne s'applique que si `currentReportId` porte ENCORE le jeton
  // `'new'` : un changement de table/rapport pendant l'écriture (rare, mais possible) l'aurait déjà
  // remplacé, et l'écraser ici serait une course perdante sur l'état affiché à l'écran.
  function runPendingSave(p) {
    return GristBI.api.saveConfig(p.tableId, p.pages, p.currentPageId, p.bookmarks, p.blend, p.reportId, p.authorLabel, p.dashStyle, p.dashStyleOptions).then((rowId) => {
      if (p.reportId === 'new' && currentReportId === 'new') currentReportId = rowId;
    }).catch((e) => {
      console.error('[GristBI] échec de sauvegarde de la config', e);
      // Consigne GFS 012 : une fois « Partager » activé sur BI_Dashboard_Config, Grist refuse
      // cette écriture pour qui n'a accès à cette ligne qu'en lecture — jamais corrigé par un
      // réessai (le droit ne change pas tout seul), donc on se contente de le dire une fois
      // plutôt que de rejouer l'échec en boucle à chaque frappe (`scheduleSave` redéclenche ce
      // catch toutes les 600ms tant que la personne modifie le rapport).
      if (GristBI.data.isAccessRuleRefusal(e)) sharedReadOnlyWarning.hidden = false;
    });
  }

  // Écrit IMMÉDIATEMENT une sauvegarde encore en attente (debounce de scheduleSave), au lieu
  // d'attendre les 600ms. Indispensable avant de changer de table : `switchTable` va lui-même
  // déclencher un rendu (chargement de la config de la table suivante), donc un nouvel appel à
  // scheduleSave qui réutilise le même `saveTimer` — sans ce flush, ce nouvel appel annule
  // silencieusement la sauvegarde en attente de l'ANCIENNE table (`clearTimeout`), qui perd
  // alors sa configuration jamais écrite dans Grist.
  function flushPendingSave() {
    if (!pendingSave) return Promise.resolve();
    clearTimeout(saveTimer);
    saveTimer = null;
    const p = pendingSave;
    pendingSave = null;
    return runPendingSave(p);
  }

  // Rejoint `currentPrimaryRows` (TOUJOURS les lignes brutes de la table principale, jamais des
  // lignes déjà jointes, voir la déclaration de `currentPrimaryRows` plus haut) avec la table
  // secondaire de `blend`, si elle est complètement configurée (les 3 champs remplis — un blend
  // partiel équivaut à "aucune jointure", plus simple et plus sûr qu'un état intermédiaire à moitié
  // appliqué). `withDateHierarchies` (voir plus haut) enrichit ensuite systématiquement le résultat,
  // qu'une jointure ait eu lieu ou non — jamais sauté, y compris sans blend, sinon la hiérarchie
  // Année/Trimestre/Mois de la table de travail principale elle-même ne serait jamais dérivée.
  // Pousse toujours le résultat dans le store, y compris `blend == null` : c'est l'unique point
  // d'entrée qui alimente `refreshColumnSelects`/`store.setRows` après le chargement initial, pour
  // que ces deux appels ne soient jamais dupliqués/oubliés à un site d'appel.
  async function applyBlend(blend) {
    if (!blend || !blend.secondaryTableId || !blend.primaryColumn || !blend.secondaryColumn) {
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
      return;
    }
    try {
      const { rows: secondaryRows } = await GristBI.api.loadTable(blend.secondaryTableId);
      const merged = GristBI.data.blendRows(currentPrimaryRows, secondaryRows, blend.primaryColumn, blend.secondaryColumn, blend.secondaryTableId);
      const rows = withDateHierarchies(merged);
      refreshColumnSelects(rows);
      store.setRows(rows);
    } catch (e) {
      console.error('[GristBI] échec de la jointure avec la table secondaire', e);
      showError(t('blend.failed', { table: blend.secondaryTableId }));
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
    }
  }

  // Relit la table de travail dans Grist après une écriture faite par ce widget (mots-clés des publications) : les
  // tuiles et les filtres voient tout de suite la colonne remplie. Même chemin que le chargement (`currentPrimaryRows`
  // puis `applyBlend`) ; abandonné si la personne a changé de table pendant la lecture. Un échec ne casse rien :
  // les données écrites sont dans Grist, un rechargement du widget les montrera.
  async function reloadWorkingTable() {
    const tableId = S.currentTableId;
    if (!tableId) return;
    const { rows } = await GristBI.api.loadTable(tableId);
    if (tableId !== S.currentTableId) return;
    currentPrimaryRows = rows;
    await refreshColumnFormats(tableId, false);
    await applyBlend(currentBlend);
  }

  // Bascule l'affichage sur `tableId`/`rows`. Met TOUJOURS à jour `currentPrimaryRows` (même hors
  // changement de table : un futur rafraîchissement de la même table doit rejoindre les lignes
  // FRAÎCHES, pas rejouer la jointure sur un instantané périmé) puis délègue à `applyBlend` le
  // rafraîchissement des sélecteurs de colonne et `store.setRows` — jamais fait ici directement,
  // pour ne pas contourner la jointure en cours.
  // `report` (consigne GFS 007, point 2/3), optionnel : `{ id, config }` quand GFS a demandé
  // d'ouvrir UN rapport précis ou un départ vierge ("Nouveau", `id: 'new'`) plutôt que la
  // convention historique "la config déjà sauvegardée pour cette table" - voir openReportById/
  // openBlankReport plus bas. Sa seule présence force une (re)prise en compte même si `tableId` ne
  // change pas (un deuxième rapport sur la MÊME table de travail doit quand même recharger ses
  // propres pages/bookmarks/blend, jamais ceux du rapport précédent).
  // Format des colonnes de la table de travail (type + options d'affichage Grist), pour « Comme dans la colonne »
  // (js/format.js:setColumnInfo). Lu à CHAQUE changement/rechargement de table ; vidé avant, pour que le format d'une
  // colonne de l'ancienne table ne s'applique jamais à une colonne de même nom d'une autre. Un échec de lecture
  // laisse le registre vide (Automatique partout) sans jamais bloquer l'affichage.
  async function refreshColumnFormats(tableId, clearFirst) {
    if (clearFirst) GristBI.format.setColumnInfo({}, null);
    if (!GristBI.api.readColumnFormats) return;
    try {
      const info = await GristBI.api.readColumnFormats(tableId);
      if (tableId !== S.currentTableId) return; // l'utilisateur a changé de table pendant la lecture
      GristBI.format.setColumnInfo(info.columns, info.docSettings);
    } catch (e) {
      console.warn('[GristBI] format des colonnes illisible, format des nombres Automatique', e);
    }
  }

  async function switchTable(tableId, rows, report) {
    await flushPendingSave();
    const isNewTable = tableId !== S.currentTableId || Boolean(report);
    S.currentTableId = tableId;
    currentPrimaryRows = rows;
    await refreshColumnFormats(tableId, isNewTable);
    if (isNewTable) {
      S.dashboardReady = false;
      S.connectionState = 'connecting';
      renderConnectionStatus(store.getState());
      store.clearFilter();
      store.clearAdvancedFilter();
      closeTilePanel(false); // le panneau (colonnes, édition en cours) référence l'ancienne table
      const saved = report ? report.config : await GristBI.api.loadConfig(tableId);
      currentReportId = report ? report.id : null;
      // Consigne GFS 009 : CHARGER un rapport (y compris vierge, "Nouveau" dans GFS) ne doit jamais,
      // par lui-même, planifier une sauvegarde — seul un geste réel de la personne doit écrire une
      // ligne dans BI_Dashboard_Config. render() (plus haut) compare state.pages/bookmarks/blend à
      // lastRendered* (par référence) pour décider s'il y a eu un geste ; sans garde, les trois
      // notify() ci-dessous (un par store.set*) feraient chacun passer ce test, et planifieraient
      // une sauvegarde dès le chargement. `suppressNextSave` reste levé pendant tout le bloc
      // (synchrone, aucun `await` entre les trois appels) : render() met quand même lastRendered* à
      // jour à chaque notify (pour ne pas se retrouver désynchronisé), mais sans planifier de
      // sauvegarde tant que le drapeau est levé. Un changement réel ultérieur de la personne arrive
      // hors de ce bloc, drapeau baissé, et continue d'être détecté et sauvegardé normalement.
      // Consigne GFS 010 : `try…finally` plutôt qu'un simple "levé puis baissé" - `render()` tourne
      // à chaque `store.set*` et peut lever (tuile qu'il ne sait pas dessiner, configuration abîmée) ;
      // sans `finally`, une exception laisserait le drapeau levé pour le reste de la session, et plus
      // aucun geste réel de la personne ne se sauvegarderait ensuite, sans message. `notify()`
      // (js/state.js) ne rattrape rien lui-même : seul ce `finally` referme le trou.
      S.suppressNextSave = true;
      try {
        store.setPages(saved.pages, saved.currentPageId);
        store.setBookmarks(saved.bookmarks);
        currentBlend = saved.blend;
        store.setBlend(currentBlend);
        store.setDashStyle(saved.style); // absent d'une configuration d'avant ce réglage -> Standard
        store.setDashStyleOptions(saved.styleOptions); // idem : aucune option cochée
      } finally {
        S.suppressNextSave = false;
      }
      S.dashboardReady = true;
      autoMode();
      refreshBlendPicker();
    }
    await applyBlend(currentBlend);
  }

  // Ouvre le rapport `reportId` (une ligne de BI_Dashboard_Config, voir GristBI.api.loadConfigById)
  // - ce que GFS demande via GfsLink.opening()/onOpen (consigne 007, point 3 ; `reportId` y est
  // toujours du TEXTE, voir kit/js/gfs-link.js:normalizeOpening). Rien à recharger si c'est déjà ce
  // rapport qui est affiché (comparé en texte : `currentReportId` devient un NOMBRE une fois un
  // rapport ouvert, voir switchTable/GristBI.api.loadConfigById).
  async function openReportById(reportId) {
    if (String(currentReportId) === String(reportId)) return;
    await flushPendingSave();
    const report = await GristBI.api.loadConfigById(reportId);
    if (!report) {
      console.error(`[GristBI] rapport "${reportId}" introuvable, ou d'un type inconnu pour ce widget - affichage inchangé`);
      return;
    }
    const { rows } = await GristBI.api.loadTable(report.tableId);
    await switchTable(report.tableId, rows, { id: report.id, config: report.config });
    await refreshTablePicker();
  }

  // "Nouveau" dans GFS (consigne 007, point 3 : GfsLink.opening()/onOpen avec `fichier` null) :
  // l'écran de départ habituel (connexion à la 1re table du document, comme bootstrap() plus bas),
  // mais avec un dashboard VIERGE plutôt que la config déjà sauvegardée pour cette table - sa
  // propre ligne de BI_Dashboard_Config ne s'écrit qu'au premier enregistrement (jeton `'new'`, vu
  // par scheduleSave/runPendingSave), jamais ici : « Nouveau » n'écrit rien par lui-même.
  async function openBlankReport() {
    await flushPendingSave();
    try {
      const tables = await GristBI.api.listAvailableTables();
      if (!tables.length) { setConnectionState('noTables'); return; }
      const tableId = tables[0];
      const { rows } = await GristBI.api.loadTable(tableId);
      await switchTable(tableId, rows, { id: 'new', config: GristBI.api.blankConfig() });
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec du départ vierge ("Nouveau" dans GFS)', e);
      setConnectionState('failed');
    }
  }

  // Plafond de tables lues pour trouver celle qui convient à un modèle : sur un gros document, relire
  // toutes les tables pour un seul clic serait long ; la table déjà connectée passe d'abord.
  const MODEL_TABLE_SCAN_LIMIT = 8;

  // « Nouveau > Depuis un modèle » dans GFS (consigne 016, contrats 5.4 point 13 ; `GfsLink.opening()`/
  // `onOpen` avec `modele: { id }`) : un rapport de départ NON enregistré, fait d'après le modèle `id`
  // (js/models.js) sur la première table du document qui a ce qu'il lui faut (une date, des
  // catégories…). Comme openBlankReport, rien n'est écrit ici : la ligne de BI_Dashboard_Config ne naît
  // qu'au premier geste de la personne (jeton `'new'`, voir switchTable/scheduleSave) ; ce modèle ne
  // crée AUCUNE table (CLAUDE.md §8). Rend `true` si le modèle est ouvert, sinon `false` après avoir
  // dit pourquoi dans une fenêtre — jamais un rapport vierge à la place, et rien n'est changé à
  // l'écran : le rapport en cours reste affiché.
  async function openModelById(modelId, type) {
    await flushPendingSave();
    if (!GristBI.models.has(modelId) || (type && type !== GristBI.models.REPORT_TYPE)) {
      console.error(`[GristBI] modèle "${modelId}" inconnu de cette version, ou de type "${type}" : rien n'est ouvert`);
      showNotice(t('models.unknown'));
      return false;
    }
    try {
      const names = await GristBI.api.listAvailableTables();
      if (!names.length) { showNotice(t('models.noTables')); return false; }
      const ordered = (S.currentTableId && names.indexOf(S.currentTableId) !== -1)
        ? [S.currentTableId].concat(names.filter((n) => n !== S.currentTableId)) : names;
      let firstMissing = null;
      for (const tableId of ordered.slice(0, MODEL_TABLE_SCAN_LIMIT)) {
        const { rows } = await GristBI.api.loadTable(tableId);
        const enriched = withDateHierarchies(rows);
        const built = GristBI.models.build(modelId, enriched, availableColumns(enriched), { t });
        if (!built.ok) { if (!firstMissing) firstMissing = built.missing; continue; }
        const config = GristBI.api.blankConfig();
        config.pages = [{ id: config.currentPageId, name: built.pageName,
          tiles: built.tiles.map((tile, i) => Object.assign({ id: genTileId(i) }, tile)) }];
        await switchTable(tableId, rows, { id: 'new', config });
        await refreshTablePicker();
        return true;
      }
      const needs = (firstMissing && firstMissing.length ? firstMissing : ['data'])
        .map((role) => t('models.need.' + role)).join(' ' + t('models.needAnd') + ' ');
      showNotice(t('models.noFit', { needs }));
      return false;
    } catch (e) {
      console.error(`[GristBI] échec de l'ouverture du modèle "${modelId}"`, e);
      showNotice(t('models.failed'));
      return false;
    }
  }

  GristBI.openModel = openModelById;
 // essais navigateur (dev-tests/) : même chemin que `onOpen`

  store.subscribe(render);

  // Liste les tables du document dans le sélecteur (voir GristBI.api.listAvailableTables — relit
  // TOUJOURS à la demande, jamais un cache, pour refléter une table créée dans Grist entre-temps) et
  // remet la valeur sur `currentTableId`. Rechargée après chaque changement de table réussi, pas
  // seulement au démarrage : la table qu'on vient de rejoindre doit rester sélectionnée à l'écran.
  async function refreshTablePicker() {
    try {
      const tables = await GristBI.api.listAvailableTables();
      fillCombobox(tableSelectInput, tables);
      tableSelectInput.value = S.currentTableId;
    } catch (e) {
      console.error('[GristBI] échec du chargement de la liste des tables', e);
    }
  }

  // Table secondaire du data blending : mêmes tables que le sélecteur principal ci-dessus, MOINS la
  // table de travail courante elle-même (se joindre à soi-même n'a pas de sens dans ce premier jet).
  async function refreshSecondaryTablePicker() {
    try {
      const tables = (await GristBI.api.listAvailableTables()).filter((id) => id !== S.currentTableId);
      fillCombobox(blendSecondaryTableInput, tables, { blankLabel: t('blend.none') });
    } catch (e) {
      console.error('[GristBI] échec du chargement de la liste des tables (blending)', e);
    }
  }

  // Colonnes de la table secondaire ACTUELLEMENT choisie dans le combobox (pas celle de `currentBlend`
  // — l'utilisateur a pu changer la table secondaire sans encore valider les clés) : relue à chaque
  // ouverture du combobox de clé secondaire, jamais mise en cache, même raison que
  // `refreshTablePicker`/`refreshSecondaryTablePicker`.
  async function refreshBlendSecondaryColumnPicker() {
    const secondaryTableId = blendSecondaryTableInput.value;
    if (!secondaryTableId) { fillCombobox(blendSecondaryColumnInput, [], { blankLabel: t('blend.none') }); return; }
    try {
      const { rows: secondaryRows } = await GristBI.api.loadTable(secondaryTableId);
      fillCombobox(blendSecondaryColumnInput, blendJoinColumns(secondaryRows), { blankLabel: t('blend.none') });
    } catch (e) {
      console.error('[GristBI] échec du chargement des colonnes de la table secondaire', e);
      fillCombobox(blendSecondaryColumnInput, [], { blankLabel: t('blend.none') });
    }
  }

  // Remet les 3 comboboxes de blending sur `currentBlend` (après un changement de table, voir
  // switchTable) — même idiome que `refreshTablePicker` (`fillCombobox` puis affectation directe de
  // `.value`, PAS via `setOptions`, voir js/combobox.js) : la valeur choisie faisant partie des
  // options qui viennent d'être posées, `isValid()` la reconnaîtra dès la première interaction.
  function refreshBlendPicker() {
    blendSecondaryTableInput.value = (currentBlend && currentBlend.secondaryTableId) || '';
    fillCombobox(blendPrimaryColumnInput, blendJoinColumns(currentPrimaryRows), { blankLabel: t('blend.none') });
    blendPrimaryColumnInput.value = (currentBlend && currentBlend.primaryColumn) || '';
    refreshBlendSecondaryColumnPicker().then(() => {
      blendSecondaryColumnInput.value = (currentBlend && currentBlend.secondaryColumn) || '';
    });
  }

  // Relit les 3 comboboxes de blending et applique/persiste le résultat — appelé par les 3
  // écouteurs 'change' ci-dessous. Un blend INCOMPLET (au moins un des 3 champs encore vide) équivaut
  // à "aucune jointure" (voir applyBlend) : plus simple à raisonner qu'un état à moitié configuré, et
  // ça laisse l'utilisateur choisir les 3 champs dans n'importe quel ordre sans jamais déclencher une
  // jointure invalide entre-temps.
  function commitBlendFromForm() {
    const secondaryTableId = blendSecondaryTableInput.value;
    const primaryColumn = blendPrimaryColumnInput.value;
    const secondaryColumn = blendSecondaryColumnInput.value;
    currentBlend = (secondaryTableId && primaryColumn && secondaryColumn)
      ? { secondaryTableId, primaryColumn, secondaryColumn }
      : null;
    store.setBlend(currentBlend);
    applyBlend(currentBlend);
  }

  // Suggère une paire de clés de jointure à partir des colonnes de référence Grist RÉELLES
  // (`Ref:`, jamais `RefList:` — voir GristBI.api.refColumnsForTable) plutôt que de laisser
  // l'utilisateur deviner quelle colonne numérique réfère quelle table (ROADMAP.md : piste notée
  // comme "pas tentée dans ce premier jet" au moment du data blending initial). Respecte un choix
  // DÉJÀ fait côté table principale (`currentPrimaryColumn`, voir le commentaire du listener de
  // changement de table secondaire ci-dessous, qui le préserve délibérément) : dans ce cas, ne
  // suggère QUE la clé secondaire, et seulement si cette colonne réfère bien la nouvelle table
  // secondaire — jamais une suggestion qui contredirait un choix explicite déjà en place. Sinon,
  // cherche d'abord une référence PRINCIPALE -> SECONDAIRE (cas le plus courant : enrichir la table
  // de travail avec une table de référence), puis seulement à défaut l'inverse (SECONDAIRE ->
  // PRINCIPALE). Renvoie `null` si aucune référence ne relie les deux tables — l'utilisateur choisit
  // alors ses clés à la main, exactement comme avant cette fonctionnalité.
  async function suggestBlendJoinColumns(secondaryTableId, currentPrimaryColumn) {
    if (!secondaryTableId) return null;
    const [primaryRefCols, secondaryRefCols] = await Promise.all([
      GristBI.api.refColumnsForTable(S.currentTableId),
      GristBI.api.refColumnsForTable(secondaryTableId)
    ]);
    if (currentPrimaryColumn) {
      const stillValid = primaryRefCols.some((c) => c.colId === currentPrimaryColumn && c.targetTableId === secondaryTableId);
      return stillValid ? { primaryColumn: currentPrimaryColumn, secondaryColumn: 'id' } : null;
    }
    const primaryMatch = primaryRefCols.find((c) => c.targetTableId === secondaryTableId);
    if (primaryMatch) return { primaryColumn: primaryMatch.colId, secondaryColumn: 'id' };
    const secondaryMatch = secondaryRefCols.find((c) => c.targetTableId === S.currentTableId);
    if (secondaryMatch) return { primaryColumn: 'id', secondaryColumn: secondaryMatch.colId };
    return null;
  }

  blendSecondaryTableInput.addEventListener('change', () => {
    // Changer de table secondaire invalide les clés déjà choisies (colonnes d'une autre table) :
    // on ne garde QUE la clé côté table principale, jamais la clé secondaire de l'ancien choix.
    blendSecondaryColumnInput.value = '';
    const secondaryTableId = blendSecondaryTableInput.value;
    const keptPrimaryColumn = blendPrimaryColumnInput.value;
    refreshBlendSecondaryColumnPicker().then(() => suggestBlendJoinColumns(secondaryTableId, keptPrimaryColumn)).then((suggestion) => {
      if (suggestion) {
        blendPrimaryColumnInput.value = suggestion.primaryColumn;
        blendSecondaryColumnInput.value = suggestion.secondaryColumn;
      }
      commitBlendFromForm();
    });
  });

  blendPrimaryColumnInput.addEventListener('change', commitBlendFromForm);

  blendSecondaryColumnInput.addEventListener('change', commitBlendFromForm);

  // Reconnexion à une AUTRE table du document, choisie via le sélecteur. Ne crée/ne remplit jamais
  // rien (`GristBI.api.loadTable`, la table choisie existe forcément déjà — elle vient de
  // `listAvailableTables`) et ne préconfigure aucune tuile : une table quelconque du document
  // démarre sur un dashboard VIDE à construire soi-même, exactement comme la 1re table connectée
  // automatiquement au démarrage (voir bootstrap plus bas) — ce widget ne connaît plus aucun jeu de
  // tuiles par défaut depuis qu'il ne crée plus lui-même de table de données (CLAUDE.md §1/§7).
  tableSelectInput.addEventListener('change', async () => {
    const tableId = tableSelectInput.value;
    if (!tableId) return;
    try {
      const { rows } = await GristBI.api.loadTable(tableId);
      await switchTable(tableId, rows);
      await refreshTablePicker();
    } catch (e) {
      console.error('[GristBI] échec de la connexion à la table choisie', e);
      showError(t('table.connectFailed', { table: tableId }));
      tableSelectInput.value = S.currentTableId; // revient sur la table encore effectivement active
    }
  });

  // Connexion automatique, au démarrage, à la 1re table du document (voir
  // GristBI.api.listAvailableTables ci-dessus) — plus de table de données par défaut créée par ce
  // widget depuis que la table de test de charge (`BI_StressTest`) a été retirée (demande explicite
  // de l'utilisateur, 2026-09-19, voir CLAUDE.md §1/§7) : le dashboard démarre VIDE sur cette 1re
  // table, exactement comme une reconnexion manuelle via le sélecteur (`tableSelectInput` ci-dessus)
  // — aucune tuile pré-configurée à poser, ce widget ne connaît plus le schéma d'aucune table à
  // l'avance. Si le document ne contient encore AUCUNE table (hors tables internes de ce widget),
  // il n'y a rien à connecter automatiquement (voir `status.noTables`) : l'utilisateur peut créer
  // une table dans Grist puis la choisir via le sélecteur ci-dessus SANS recharger le widget — son
  // `beforeOpen` (`refreshTablePicker`) relit toujours la liste à la demande, jamais un instantané.
  // Connexion automatique à la 1re table du document (voir plus haut) — extraite de bootstrap()
  // pour que le bouton « Réessayer » de l'état vide (échec de connexion) la rejoue telle quelle.
  async function connectToFirstTable() {
    setConnectionState('connecting');
    try {
      const tables = await GristBI.api.listAvailableTables();
      if (tables.length) {
        const tableId = tables[0];
        const { rows } = await GristBI.api.loadTable(tableId);
        await switchTable(tableId, rows);
        await refreshTablePicker();
      } else {
        setConnectionState('noTables');
      }
    } catch (e) {
      console.error('[GristBI] échec de la connexion automatique à la 1re table du document', e);
      setConnectionState('failed');
    }
  }

  retryConnectBtn.addEventListener('click', connectToFirstTable);
})(window);
