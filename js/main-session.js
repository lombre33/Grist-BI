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
    blendSecondaryTableInput, joinsBarEl, joinsListEl, joinsNoteEl, tileLinkNoteEl, closeTilePanel, currentReportAuthorLabel, fillCombobox, genTileId, refreshColumnSelects,
    render, renderConnectionStatus, retryConnectBtn, setConnectionState, sharedReadOnlyWarning, showError, showNotice,
    store, tableSelectInput, withDateHierarchies
  } = parts;
  const { escapeHtml } = GristBI.data;
  Object.assign(parts, {
    connectToFirstTable, ensureColumnJoined, joinColumn, flushPendingSave, offerMergeConfigNames, openBlankReport, openModelById, openReportById, refreshBlendPicker,
    linkTable, refreshTablePicker, reloadWorkingTable, runNamesUpdate, scheduleSave, switchTable, ensureTileTables, ensureAllTileTables, ensureTableRows, loadTileTable
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
  let reloadAsked = false; // le message « Rechargez la page » (noms changés dans un autre onglet) ne s'affiche qu'une fois par ouverture

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
  function scheduleSave(pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions, joins) {
    if (!S.currentTableId) return;
    clearTimeout(saveTimer);
    pendingSave = { tableId: S.currentTableId, reportId: currentReportId, authorLabel: currentReportAuthorLabel(), pages, currentPageId, bookmarks, blend, dashStyle, dashStyleOptions, joins };
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
    return GristBI.api.saveConfig(p.tableId, p.pages, p.currentPageId, p.bookmarks, p.blend, p.reportId, p.authorLabel, p.dashStyle, p.dashStyleOptions, p.joins).then((rowId) => {
      if (p.reportId === 'new' && currentReportId === 'new') currentReportId = rowId;
    }).catch((e) => {
      console.error('[GristBI] échec de sauvegarde de la config', e);
      // Consigne GFS 030, point 4f : un nom a changé dans un autre onglet pendant que celui-ci restait ouvert. `saveConfig` a déjà relu les noms et recommencé UNE fois
      // (`writeConfig`) : si l'erreur est encore là, on ne réécrit rien de plus et on dit de recharger — jamais une écriture muette qui recréerait les anciennes colonnes.
      if (GristBI.api.isNameError(e)) {
        if (!reloadAsked) { reloadAsked = true; showError(t('configNames.reload')); } // une seule fois : chaque frappe replanifie une sauvegarde
        return;
      }
      // Consigne GFS 012 : une fois « Partager » activé sur BI_Dashboard_Config, Grist refuse
      // cette écriture pour qui n'a accès à cette ligne qu'en lecture — jamais corrigé par un
      // réessai (le droit ne change pas tout seul), donc on se contente de le dire une fois
      // plutôt que de rejouer l'échec en boucle à chaque frappe (`scheduleSave` redéclenche ce
      // catch toutes les 600ms tant que la personne modifie le rapport).
      if (GristBI.data.isAccessRuleRefusal(e)) sharedReadOnlyWarning.hidden = false;
    });
  }

  // La fenêtre commune de mise à jour des noms du kit (consigne GFS 030, points 4b/4c/4d) : au démarrage, AVANT de lire BI_Dashboard_Config. Rien à renommer (document déjà
  // en anglais, ou neuf) : on ne charge même pas le kit. Sinon `NamesUpdate.run` décide : propriétaire prouvé -> la fenêtre (bloquante, un seul lot), tous les autres cas -> le widget
  // continue sur les noms que le document a (`js/config-names.js` les lit tous), sans rien montrer ni rien renommer. Jamais lancée une seconde fois dans la session, jamais
  // bloquante pour le tableau de bord : tout échec (kit absent, schéma illisible…) est attrapé et le widget démarre quand même, sur les noms du document.
  // La preuve du propriétaire : dans GFS, `contexte.role.proprietaire` si le lien l'expose (le kit 0.29.1 ne garde pas encore `role` : alors `null`, donc « non », aucune fenêtre dans GFS) ;
  // seul, la preuve du moteur de partage (`GET /webhooks`, `GristBI.api.documentOwnerProof`).
  let namesUpdateRan = false;
  async function runNamesUpdate(link) {
    if (namesUpdateRan) return { state: 'none' };
    namesUpdateRan = true;
    try {
      const schema = await GristBI.api.readDocumentSchema();
      if (!GristBI.configNames.renamePlan(schema).length) return { state: 'none' };
      const [{ NamesUpdate }, { I18n }] = await Promise.all([GristBI.loader.module('kit-names-update'), GristBI.loader.module('kit-i18n')]);
      I18n.setLanguage(GristBI.i18n.getLang());
      const hosted = Boolean(link && link.hosted);
      const context = () => (hosted && link.context && link.context()) || null;
      const port = GristBI.api.namesPort({
        hosted,
        hostedOwner: () => {
          const role = context() && context().role;
          return role && typeof role.proprietaire === 'boolean' ? role.proprietaire : null;
        },
        readOnly: () => Boolean(context() && context().lectureSeule)
      });
      return await NamesUpdate.run({ port, plan: GristBI.configNames.renamePlan, appName: 'Grist-BI' });
    } catch (e) {
      console.warn('[GristBI] mise à jour des noms indisponible — le widget continue sur les noms du document', e);
      return { state: 'skipped' };
    } finally {
      GristBI.api.afterNamesUpdate();
    }
  }

  // « Réunir » (point 4c) : un document qui porte les DEUX jeux de noms n'est jamais renommé ; s'il reste des valeurs sous l'ancien nom que le nouveau n'a pas, on le dit et on ne
  // copie QU'APRÈS la confirmation de la personne. Une seule demande par ouverture, jamais en lecture seule (rien ne s'écrirait), jamais si le widget ne trouve rien à copier.
  async function offerMergeConfigNames(link) {
    try {
      const context = link && link.hosted && link.context ? link.context() : null;
      if (context && context.lectureSeule) return false;
      const status = await GristBI.api.configNamesStatus();
      if (!status.both.length || !status.cells) return false;
      const ok = await GristBI.dialogs.confirm({
        title: t('namesMerge.title'),
        message: t('namesMerge.message', { cells: status.cells }),
        confirmLabel: t('namesMerge.confirm')
      });
      if (!ok) return false;
      await GristBI.api.mergeConfigNames();
      showNotice(t('namesMerge.done'));
      return true;
    } catch (e) {
      console.error('[GristBI] « Réunir » les deux jeux de noms a échoué — les rapports restent lisibles sous leurs noms', e);
      showError(t('namesMerge.failed'));
      return false;
    }
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

  // Rejoint `currentPrimaryRows` (TOUJOURS les lignes brutes de la table de travail PRINCIPALE, jamais des
  // lignes déjà jointes, voir la déclaration de `currentPrimaryRows` plus haut) avec les tables jointes : le
  // réglage manuel `blend` (« Joindre une autre table », s'il est complètement configuré — les 3 champs
  // remplis, un blend partiel équivaut à "aucune jointure", plus simple et plus sûr qu'un état intermédiaire
  // à moitié appliqué) puis les jointures des colonnes Référence (`store.getState().joins`, js/table-graph.js :
  // une table liée par UNE Référence, jusqu'à deux sauts, toujours un LEFT JOIN sur `id`). Chaque table jointe
  // est lue UNE fois (`loadJoinTable`) ; une table illisible n'en retire pas les autres (`applyJoins`). `withDateHierarchies` (voir plus haut)
  // enrichit ensuite systématiquement le résultat, qu'une jointure ait eu lieu ou non — jamais sauté, y compris
  // sans jointure, sinon la hiérarchie Année/Trimestre/Mois de la table de travail principale elle-même ne
  // serait jamais dérivée.
  // Pousse toujours le résultat dans le store, y compris sans aucune jointure : c'est l'unique point
  // d'entrée qui alimente `refreshColumnSelects`/`store.setRows` après le chargement initial, pour
  // que ces deux appels ne soient jamais dupliqués/oubliés à un site d'appel. Une réponse devenue périmée
  // (une jointure posée entre-temps) n'écrit rien : seule la dernière demande compte (`applySeq`).
  let applySeq = 0;
  async function applyBlend(blend) {
    const seq = ++applySeq;
    const all = GristBI.tableGraph.allJoins(blend, store.getState().joins);
    if (!all.length) {
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
      return;
    }
    try {
      const tables = Array.from(new Set(all.map((j) => j.table)));
      const loaded = await Promise.all(tables.map(loadJoinTable));
      if (seq !== applySeq) return;
      const tableRows = {};
      tables.forEach((id, i) => { tableRows[id] = loaded[i]; });
      const { rows: merged, failed } = GristBI.data.applyJoins(currentPrimaryRows, all, tableRows, columnsOfTables(tables));
      if (failed.length) showError(t('blend.failed', { table: failed.join(', ') }));
      const rows = withDateHierarchies(merged);
      refreshColumnSelects(rows);
      store.setRows(rows);
    } catch (e) {
      console.error('[GristBI] échec de la jointure avec la table secondaire', e);
      if (seq !== applySeq) return;
      showError(t('blend.failed', { table: all.map((j) => j.alias).join(', ') }));
      const rows = withDateHierarchies(currentPrimaryRows);
      refreshColumnSelects(rows);
      store.setRows(rows);
    }
  }

  // Les lignes d'une table jointe, lues UNE fois tant qu'on reste sur la même table de travail (poser une 2e jointure ne relit pas la 1re) ;
  // vidées au changement de table, au rechargement, et à chaque geste sur « Joindre une autre table ». Une table illisible (règle d'accès,
  // table disparue) vaut `null` et n'est pas gardée : la prochaine demande la relira.
  const joinTableCache = new Map();
  function loadJoinTable(tableId) {
    if (!joinTableCache.has(tableId)) {
      joinTableCache.set(tableId, GristBI.api.loadTable(tableId).then((res) => res.rows, (e) => {
        joinTableCache.delete(tableId);
        console.error(`[GristBI] table jointe "${tableId}" illisible`, e);
        return null;
      }));
    }
    return joinTableCache.get(tableId);
  }

  // Les autres tables que lisent des tuiles (`tile.table`, lot 2 de « colonnes de toutes les tables », 26/11/2026). Chaque table est lue UNE fois
  // par rapport ouvert, à la demande : dès qu'une tuile de la page affichée la nomme (`ensureTileTables`, appelée par `render()`). Les lignes
  // vont dans le store (`setTableRows`) : un tableau, ou `null` quand la table est illisible — la tuile le dit par son badge, et il n'y a pas
  // de nouvel essai avant un rechargement (sinon `render()` relirait sans fin une table qu'une règle d'accès interdit). Une réponse qui arrive
  // après un changement de table de travail n'écrit rien (`epoch`). Seules les tables que `listAvailableTables` rend sont lues : ni une
  // table système (`_grist_*`), ni une table interne de ce widget, ni un nom forgé dans une configuration.
  const tileTablesAsked = new Map(); // table -> la promesse de sa lecture (la même pour tous ceux qui l'attendent : le formulaire de tuile aussi)
  async function loadTileTable(table, epoch) {
    let rows = null;
    try {
      const available = await GristBI.api.listAvailableTables();
      if (available.indexOf(table) === -1) throw new Error(`"${table}" n'est pas une table du document`);
      const res = await GristBI.api.loadTable(table);
      rows = withDateHierarchies(res.rows);
    } catch (e) {
      console.error(`[GristBI] table "${table}" illisible pour une tuile`, e);
      rows = null;
    }
    if (store.getState().workingTable !== epoch) return; // une autre table de travail est ouverte entre-temps
    if (rows === null) showError(t('tileTable.failed', { table }));
    store.setTableRows(table, rows);
  }

  // Lit la table `table` si elle ne l'est pas encore (une seule lecture, quel que soit le nombre de demandeurs) ; la promesse rendue se termine quand
  // les lignes — ou l'échec — sont dans le store.
  function ensureTableRows(table) {
    const state = store.getState();
    if (GristBI.data.tableRowsStatus(state, table) !== 'loading') return Promise.resolve();
    if (!tileTablesAsked.has(table)) tileTablesAsked.set(table, loadTileTable(table, state.workingTable));
    return tileTablesAsked.get(table);
  }

  // Toutes les tables que lisent les tuiles du rapport, toutes pages comprises (un export les veut toutes) : se termine quand chacune est lue ou
  // en échec.
  function ensureAllTileTables() {
    const state = store.getState();
    const tables = new Set();
    state.pages.forEach((page) => (page.tiles || []).forEach((tile) => {
      const table = GristBI.data.tileTable(tile, state);
      if (table) tables.add(table);
    }));
    return Promise.all(Array.from(tables).map(ensureTableRows));
  }

  // Demande les tables des tuiles de la page affichée qui n'ont pas encore été lues. Sans effet pendant le chargement d'un rapport (les tuiles
  // de l'ancien rapport ne doivent rien faire lire) : `switchTable` la rappelle une fois le rapport prêt.
  function ensureTileTables(state) {
    if (!S.dashboardReady || !state.workingTable) return;
    state.tiles.forEach((tile) => {
      const table = GristBI.data.tileTable(tile, state);
      if (table) ensureTableRows(table);
    });
  }

  // Les colonnes de chaque table jointe d'après le schéma des liens, pour qu'une table SANS ligne apporte quand même les siennes (les lignes seules
  // ne les disent pas) ; rien tant que le schéma n'est pas lu.
  function columnsOfTables(tables) {
    const out = {};
    if (!(S.linkSchema instanceof Map)) return out;
    tables.forEach((id) => { if (S.linkSchema.has(id)) out[id] = S.linkSchema.get(id).map((c) => c.id).filter((c) => c !== 'manualSort' && !/^gristHelper_/.test(c)); });
    return out;
  }

  // Le schéma des LIENS du document (types des colonnes, Références), relu à chaque changement de table de travail ; vide si la lecture échoue
  // (le widget marche alors comme avant : aucune colonne d'une autre table n'est proposée).
  async function refreshLinkSchema(tableId) {
    S.linkSchema = null;
    try {
      const schema = await GristBI.api.readLinkSchema();
      if (tableId !== S.currentTableId) return;
      S.linkSchema = GristBI.tableGraph.indexSchema(schema);
    } catch (e) {
      console.warn('[GristBI] schéma des liens illisible', e);
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
    joinTableCache.clear();
    await refreshColumnFormats(tableId, false);
    await applyBlend(currentBlend);
    // Les tuiles qui lisent une autre table la redemandent (les données ont pu changer).
    tileTablesAsked.clear();
    store.clearTableRows();
    ensureTileTables(store.getState());
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
    if (clearFirst) { GristBI.format.setColumnInfo({}, null); if (GristBI.advice) GristBI.advice.setColumnInfo({}); }
    if (!GristBI.api.readColumnFormats) return;
    try {
      const info = await GristBI.api.readColumnFormats(tableId);
      if (tableId !== S.currentTableId) return; // l'utilisateur a changé de table pendant la lecture
      GristBI.format.setColumnInfo(info.columns, info.docSettings);
      // Les mêmes types Grist servent aux suggestions (js/advice.js) : une colonne Référence n'est jamais une mesure.
      if (GristBI.advice) GristBI.advice.setColumnInfo(info.columns);
    } catch (e) {
      console.warn('[GristBI] format des colonnes illisible, format des nombres Automatique', e);
    }
  }

  async function switchTable(tableId, rows, report) {
    await flushPendingSave();
    const isNewTable = tableId !== S.currentTableId || Boolean(report);
    S.currentTableId = tableId;
    currentPrimaryRows = rows;
    if (isNewTable) joinTableCache.clear();
    if (isNewTable) { tileTablesAsked.clear(); S.formTable = ''; store.setWorkingTable(tableId); } // les autres tables lues appartenaient à l'autre rapport
    await refreshColumnFormats(tableId, isNewTable);
    if (isNewTable) await refreshLinkSchema(tableId);
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
        // Les jointures des Références sont lues d'une ligne que d'autres personnes ont pu écrire : formes et alias contrôlés avant d'entrer dans l'état.
        store.setJoins(GristBI.tableGraph.sanitizeJoins(saved.joins, currentBlend ? [currentBlend.secondaryTableId] : []));
        store.setDashStyle(saved.style); // absent d'une configuration d'avant ce réglage -> Standard
        store.setDashStyleOptions(saved.styleOptions); // idem : aucune option cochée
      } finally {
        S.suppressNextSave = false;
      }
      S.dashboardReady = true;
      ensureTileTables(store.getState()); // les tuiles du rapport qui lisent une autre table
      autoMode();
      refreshBlendPicker();
      saveLastTable(tableId); // la prochaine ouverture du widget reprend cette table (chooseStartTable)
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
      const tableId = await chooseStartTable(tables);
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
      const first = (S.currentTableId && names.indexOf(S.currentTableId) !== -1) ? S.currentTableId : await chooseStartTable(names);
      const ordered = [first].concat(names.filter((n) => n !== first));
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

  // « Tables liées » (menu Données) : les jointures posées depuis les colonnes Référence (js/table-graph.js), une ligne chacune avec la colonne qui
  // les porte et une croix pour la retirer. Retirer une jointure que des tuiles, des filtres ou des vues lisent encore les viderait (un filtre sur une
  // colonne absente retire TOUTES les lignes) : la croix est refusée, avec ce qui la lit. Une jointure dont dépend une autre (le 2e saut d'une route)
  // part avec elle. Redessinée seulement quand la liste change.
  let joinsShownKey = null;
  function renderJoinsList(state) {
    const joins = state.joins || [];
    const key = JSON.stringify(joins) + '|' + GristBI.i18n.getLang();
    if (key === joinsShownKey) return;
    joinsShownKey = key;
    joinsNoteEl.textContent = '';
    joinsBarEl.hidden = joins.length === 0;
    GristBI.safeHtml.setHtml(joinsListEl, joins.map((j) => `<li class="views-item joins-item">
        <span class="views-item-name joins-item-name">${escapeHtml(j.alias)}<small class="joins-item-via"> ${escapeHtml(t('joins.via', { column: j.primaryColumn }))}</small></span>
        <button type="button" class="views-item-delete" data-alias="${escapeHtml(j.alias)}"
                aria-label="${escapeHtml(t('joins.remove.aria', { alias: j.alias }))}" title="${escapeHtml(t('joins.remove.title'))}">
          <svg class="icon icon-close" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </li>`).join(''));
  }
  store.subscribe(renderJoinsList);

  joinsListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.views-item-delete');
    if (!btn) return;
    const alias = btn.dataset.alias;
    const state = store.getState();
    const removal = GristBI.tableGraph.removeJoin(state.joins, alias);
    if (!removal.removed.length) return;
    const use = GristBI.tableGraph.usageOf(state, removal.removed, GristBI.adviceComplete && GristBI.adviceComplete.columnsOfTile);
    if (use.tiles || use.filters || use.bookmarks) {
      joinsNoteEl.textContent = t('joins.inUse', { alias, tiles: use.tiles, filters: use.filters, views: use.bookmarks });
      return;
    }
    joinsNoteEl.textContent = '';
    store.setJoins(removal.joins);
    applyBlend(currentBlend);
  });

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
    joinTableCache.clear();
    applyBlend(currentBlend);
  }

  // Pose la jointure PROPOSÉE par le panneau (js/advice-join.js : `{ secondaryTableId, primaryColumn, secondaryColumn: 'id' }`, une colonne Référence
  // jointe sur le numéro de ligne de l'autre table) : elle s'AJOUTE aux jointures des Références (`store.setJoins`, js/table-graph.js:addJoin — sous un
  // alias libre, la table elle-même quand c'est possible), puis `applyBlend`. Le réglage manuel « Joindre une autre table » n'est plus écrasé : plusieurs
  // tables peuvent être reliées. Rend `true` quand les colonnes de l'autre table sont bien dans les lignes ; sinon la jointure est retirée aussitôt
  // (`applyBlend` a déjà dit l'échec) : jamais une jointure annoncée qui n'a pas eu lieu.
  async function linkTable(join) {
    joinTableCache.clear();
    const added = GristBI.tableGraph.addJoin(store.getState().joins, currentBlend, join.secondaryTableId, join.primaryColumn);
    if (!added.join) { showError(t('joins.full', { max: GristBI.tableGraph.MAX_JOINS })); return false; }
    if (added.added) store.setJoins(added.joins);
    await applyBlend(currentBlend);
    const first = store.getState().rows[0] || {};
    const prefix = added.join.alias + '.';
    const joined = Object.keys(first).some((k) => k.indexOf(prefix) === 0);
    if (!joined && added.added) store.setJoins(GristBI.tableGraph.removeJoin(store.getState().joins, added.join.alias).joins);
    return joined;
  }

  // Choisir, dans une liste de colonnes, celle d'une table LIÉE que les lignes n'ont pas encore (js/main-fields.js:columnOptions, option `pending`
  // du combobox) : pose les jointures de sa route (la table visée, et celle d'avant pour un 2e saut), relit les lignes (`applyBlend`) puis rend `true`
  // quand la colonne y est — le combobox n'émet son `change` qu'ensuite, donc tout ce qui lit les lignes la voit. Sans la colonne (table illisible,
  // plafond de jointures, schéma changé entre-temps) les jointures posées par CE choix sont retirées aussitôt et le choix est annulé : jamais une
  // jointure annoncée qui n'a pas eu lieu (même règle que `linkTable` ; `applyBlend` dit lui-même l'échec d'une table illisible). Trois essais au plus :
  // deux choix qui se suivent font abandonner le premier `applyBlend` (`applySeq`), le suivant le rattrape. La personne est prévenue (`#tile-link-note`)
  // de la table reliée et de l'endroit où la délier. `joinColumn` fait le travail et écrit la phrase dans `noteEl` (le panneau d'ajout, le menu Filtre ou
  // le formulaire de la table plate la placent chacun chez eux) ; `ensureColumnJoined` est le `prepare` des combobox du panneau, qui n'ont que celle-là.
  async function ensureColumnJoined(id) { return joinColumn(id, tileLinkNoteEl); }

  async function joinColumn(id, noteEl) {
    const graph = GristBI.tableGraph;
    const hasColumn = () => { const first = store.getState().rows[0]; return !!first && Object.prototype.hasOwnProperty.call(first, id); };
    const added = [];
    for (let attempt = 0; attempt < 3 && !hasColumn(); attempt++) {
      const state = store.getState();
      if (!state.rows.length || !(S.linkSchema instanceof Map)) break;
      const all = graph.allJoins(state.blend, state.joins);
      const virtual = graph.virtualColumns(S.linkSchema, S.currentTableId, all, Object.keys(state.rows[0])).find((v) => v.id === id);
      if (!virtual) break;
      const toAdd = graph.joinsToAdd(virtual);
      if (toAdd.length) {
        if (all.length + toAdd.length > graph.MAX_JOINS) { showError(t('joins.full', { max: graph.MAX_JOINS })); break; }
        store.setJoins((state.joins || []).concat(toAdd));
        toAdd.forEach((j) => added.push(j.alias));
      }
      await applyBlend(currentBlend);
    }
    if (hasColumn()) {
      if (added.length && noteEl) {
        noteEl.textContent = t('joins.pick.done', { tables: added.join(', ') });
        noteEl.hidden = false;
      }
      return true;
    }
    if (added.length) {
      let joins = store.getState().joins;
      added.forEach((alias) => { joins = graph.removeJoin(joins, alias).joins; });
      store.setJoins(joins);
      await applyBlend(currentBlend);
    }
    return false;
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

  // Dernière table ouverte, mémorisée d'une session à l'autre comme le nom d'auteur des commentaires (js/main-dialogs.js:loadSavedCommentAuthor) :
  // chez GFS quand il héberge le widget (`GfsLink.storageGet`/`storageSet`, le cadre isolé n'a pas de stockage fiable), sinon dans
  // `localStorage`, `typeof` DANS le `try` (il lève dans un cadre isolé). Sans mémoire disponible, `chooseStartTable` retombe sur le rapport
  // le plus récent : jamais une erreur. La clé est la même pour tous les documents du widget, d'où la validation dans `pickStartTable`
  // (une table inconnue du document est ignorée). Retour d'un utilisateur, 26/11/2026 : le widget s'ouvrait toujours sur la 1re table.
  const LAST_TABLE_KEY = 'gristbi_last_table';
  function loadLastTable() {
    try {
      if (S.gfsLink && S.gfsLink.hosted) return S.gfsLink.storageGet(LAST_TABLE_KEY) || '';
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem(LAST_TABLE_KEY) || '';
    } catch (e) { return ''; }
  }
  function saveLastTable(tableId) {
    try {
      if (S.gfsLink && S.gfsLink.hosted) { S.gfsLink.storageSet(LAST_TABLE_KEY, tableId); return; }
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LAST_TABLE_KEY, tableId);
    } catch (e) { /* stockage indisponible : sans conséquence, le rapport le plus récent prendra le relais */ }
  }

  // Table sur laquelle s'ouvrir quand rien ne l'impose : la dernière ouverte, sinon celle du rapport enregistré le plus récemment, sinon la
  // première (`GristBI.state.pickStartTable`, pur et testé). `tables` vient de `listAvailableTables`, déjà lue : jamais vide ici.
  async function chooseStartTable(tables) {
    const remembered = loadLastTable();
    // La lecture de BI_Dashboard_Config ne sert que sans mémoire valable : inutile de la faire sinon.
    const latest = tables.indexOf(remembered) !== -1 ? '' : await GristBI.api.latestReportTableId(tables);
    return GristBI.state.pickStartTable({ available: tables, remembered, latest });
  }

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
  // Connexion automatique à la table de départ (voir `chooseStartTable` ci-dessus ; la 1re table du document seulement faute de mémoire et de rapport
  // enregistré — d'où le nom d'origine, gardé : bootstrap() et la lecture de `dev-tests/test-config-names.js` le citent) — extraite de bootstrap()
  // pour que le bouton « Réessayer » de l'état vide (échec de connexion) la rejoue telle quelle.
  async function connectToFirstTable() {
    setConnectionState('connecting');
    try {
      const tables = await GristBI.api.listAvailableTables();
      if (tables.length) {
        const tableId = await chooseStartTable(tables);
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
