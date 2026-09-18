/*
 * Glue vers l'API Grist Custom Widget. Patterns repris (et simplifiés) du widget
 * publipostageGrist du même auteur : grist.ready({requiredAccess:'full'}) et des tables internes
 * cachées (préfixe "BI_") pour les données ET la config — même mécanisme que
 * Publipostage_Modeles/Publipostage_LiensTables, dont on sait qu'il fonctionne en Grist réel. Pas
 * de dépendance à grist.onRecords()/la table liée au widget dans la page (voir HYPOTHESES.md et
 * main.js:bootstrap). Voir HYPOTHESES.md pour ce qui reste à valider (ex. grist.setOptions() comme
 * alternative plus simple à la table de config, non testée ici).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const CONFIG_TABLE = 'BI_Dashboard_Config';
  // Nom FIXE, plus jamais suffixé par un numéro de schéma (demande explicite de l'utilisateur : une
  // SEULE table de test traverse toute la vie du widget, jamais une nouvelle table pour un
  // changement de schéma). Si `GristBI.demoData.COLUMNS_LARGE` gagne une colonne, `ensureColumnsUpToDate`
  // (plus bas) ajoute cette colonne à la table déjà présente (`AddColumn`) et remplit les lignes déjà
  // là avec de vraies valeurs calculées côté JS (`GristBI.demoData.deriveDateColumn`, PAS une formule
  // Grist) — ce mécanisme reste la SEULE façon prévue de faire évoluer le schéma, y compris pour un
  // futur ajout de colonne : jamais une table supplémentaire.
  const STRESS_TABLE = 'BI_StressTest';
  // Anciens noms suffixés par un numéro de version, créés par une version antérieure de ce widget
  // avant l'adoption d'un nom fixe ci-dessus — voir `migrateLegacyTableName` : si l'un de ces noms
  // existe encore et que le nom fixe n'existe pas, on le RENOMME (`RenameTable`) plutôt que de
  // laisser une table orpheline en plus dans le document.
  const LEGACY_STRESS_TABLE_NAMES = ['BI_StressTest_v2', 'BI_StressTest_v1'];
  // Nombre d'actions envoyées par appel à applyUserActions() lors d'une génération/suppression en
  // masse : un seul appel avec des dizaines de milliers d'actions est un pari risqué (timeout,
  // limite de payload côté Grist - aucune des deux non testée ici, voir HYPOTHESES.md) ; les
  // envoyer par lots donne aussi une progression visible à l'utilisateur plutôt qu'une attente
  // opaque.
  const ACTION_CHUNK_SIZE = 2000;

  let _rawTables = null;
  let _configRowIdByTable = {};

  // Ne s'appuie plus sur `grist.onRecords()`/la table liée au widget dans la page (voir
  // HYPOTHESES.md) : le dashboard se connecte directement à sa propre table de test de charge au
  // démarrage (voir main.js), même pattern que publipostageGrist qui gère ses propres tables
  // internes sans dépendre d'une sélection de table faite par l'auteur de la page Grist.
  async function init() {
    if (typeof grist === 'undefined') {
      console.warn('[GristBI] grist-plugin-api.js indisponible (widget ouvert hors Grist ?).');
      return;
    }
    try {
      grist.ready({ requiredAccess: 'full' });
    } catch (e) {
      console.error('[GristBI] grist.ready() a échoué', e);
    }
  }

  async function listAllTablesCached() {
    if (!_rawTables) _rawTables = (await grist.docApi.listTables()) || [];
    return _rawTables;
  }

  function tableExistsIn(tables, tableId) {
    return tables.some((t) => (typeof t === 'string' ? t : t.id) === tableId);
  }

  // [BUG RÉEL remonté par l'utilisateur : une table se "regénérait" (barre de progression "Création…"
  // complète) à chaque réouverture du widget, alors qu'elle existait déjà dans le document réel.]
  // `grist.ready()` ne renvoie PAS de promesse (voir la doc de l'API Grist) : la vraie négociation
  // d'accès avec l'hôte se termine de façon asynchrone, APRÈS que `ready()` a déjà rendu la main.
  // `bootstrap()` (main.js) enchaîne pourtant IMMÉDIATEMENT sur `listTables()` sans le moindre délai
  // — si cet appel part avant la fin de cette négociation, il peut renvoyer une liste incomplète/vide,
  // faisant croire à tort qu'une table n'existe pas encore. Un faux négatif ici déclenche `AddTable` +
  // le remplissage complet (`fillTable`), dupliquant potentiellement des dizaines de milliers de
  // lignes dans le document de l'utilisateur À CHAQUE rechargement du widget.
  // Avant de conclure qu'une table n'existe VRAIMENT pas (et donc avant toute action destructrice de
  // création), on revérifie plusieurs fois avec une lecture FRAÎCHE (pas le cache potentiellement pris
  // trop tôt) plutôt que de faire confiance à la toute première réponse.
  // [CORRECTIF v2, bug remonté À NOUVEAU par l'utilisateur après un premier correctif à délai unique
  // de 500ms : insuffisant en conditions réelles — la négociation d'accès peut visiblement dépasser
  // 500ms selon le réseau/la charge du document Grist réel (jamais mesuré précisément ici, voir
  // HYPOTHESES.md : ce sandbox ne peut pas reproduire un vrai aller-retour réseau avec l'hôte Grist)].
  // Plusieurs tentatives à délai CROISSANT plutôt qu'un unique essai : le budget total (~9,3s dans le
  // pire cas, RACE_GUARD_RETRY_DELAYS_MS) est délibérément généreux — une table réellement neuve
  // n'attend cette rallonge qu'une seule fois dans toute la vie du document (coût mineur : un peu plus
  // de "Connexion…" affiché), alors qu'un faux négatif coûte potentiellement des dizaines de milliers
  // de lignes dupliquées. Un second filet de sécurité INDÉPENDANT (voir `loadOrCreateTable` plus bas)
  // neutralise même le cas où CE budget s'avérerait malgré tout insuffisant.
  // `_raceGuardArmed` : cette revérification ne s'applique qu'au TOUT PREMIER contrôle d'existence de
  // la session (celui de `BI_StressTest`, juste après `grist.ready()` — le seul moment où la
  // négociation d'accès peut réellement être encore en cours) ; tous les contrôles suivants (ex.
  // `BI_Dashboard_Config`, quelques instants plus tard) font confiance à un seul appel : le canal a
  // déjà forcément été prouvé actif par au moins un aller-retour réussi entre-temps. Sans ce
  // désarmement, chaque contrôle paierait le budget complet même sans le moindre risque de course.
  const RACE_GUARD_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800];
  let _raceGuardArmed = true;
  async function tableExistsConfirmed(tableId) {
    const guardThisCall = _raceGuardArmed;
    _raceGuardArmed = false;
    if (tableExistsIn(await listAllTablesCached(), tableId)) return true;
    if (!guardThisCall) return false;
    for (const delay of RACE_GUARD_RETRY_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      _rawTables = null;
      if (tableExistsIn(await listAllTablesCached(), tableId)) return true;
    }
    // [Trouvé par une revue adversariale du correctif ci-dessus, pas par l'utilisateur] Si le budget
    // s'épuise SANS jamais avoir trouvé `tableId`, `_rawTables` reste ici sur le dernier tableau lu
    // pendant la boucle — qui peut lui-même être encore contaminé par la course si la négociation
    // d'accès n'a TOUJOURS pas fini au bout de ce budget déjà généreux (~9,3s). Comme `_raceGuardArmed`
    // vient d'être définitivement désarmé, tout contrôle suivant de la session (ex. le nom LEGACY dans
    // `migrateLegacyTableName`) ferait confiance à ce cache SANS le moindre nouvel appel réseau — le
    // remettre à `null` force au moins UNE lecture fraîche pour ce contrôle suivant plutôt que de
    // réutiliser un résultat déjà connu comme potentiellement obsolète. Ne résout pas le cas encore
    // plus extrême où la négociation dépasse la totalité du budget (voir HYPOTHESES.md, point 13bis :
    // aucun mécanisme à délai borné ne peut couvrir un délai réseau non borné), mais referme la fenêtre
    // pour le cas, bien plus probable, où la négociation se termine PENDANT ce contrôle suivant.
    _rawTables = null;
    return false;
  }

  // Extrait le `table_id` RÉELLEMENT assigné par un `AddTable` depuis son retour
  // (`applyUserActions` renvoie `{retValues: [{id, table_id, columns}]}` pour cette action précise
  // — vérifié contre le moteur Grist réel, voir HYPOTHESES.md). Peut différer du `tableId` demandé :
  // voir `loadOrCreateTable`/`ensureConfigTableExists` plus bas pour pourquoi c'est important.
  function actualAddTableId(applyResult) {
    const rv = applyResult && applyResult.retValues && applyResult.retValues[0];
    return (rv && rv.table_id) || null;
  }

  async function ensureConfigTableExists() {
    if (await tableExistsConfirmed(CONFIG_TABLE)) return;
    const result = await grist.docApi.applyUserActions([
      ['AddTable', CONFIG_TABLE, [
        { id: 'TableId', type: 'Text' },
        { id: 'ConfigJSON', type: 'Text' }
      ]]
    ]);
    // [Filet de sécurité, voir loadOrCreateTable plus bas pour la version complète/documentée de ce
    // mécanisme] Si Grist a silencieusement suffixé le nom (collision malgré tableExistsConfirmed),
    // la table de config réelle préexistante reste "BI_Dashboard_Config" — loadConfig/saveConfig la
    // relisent toujours directement par ce nom, donc aucune perte de données ; on évite juste de
    // mettre en cache le mauvais id.
    const actualTableId = actualAddTableId(result);
    if (actualTableId && actualTableId !== CONFIG_TABLE) {
      console.error(
        `[GristBI] AddTable("${CONFIG_TABLE}") a créé "${actualTableId}" à la place (collision de nom : ` +
        'la table existait déjà malgré la vérification). Table vide orpheline à supprimer manuellement ' +
        'dans Grist si besoin — aucune donnée de config perdue ni dupliquée.'
      );
      _rawTables = null;
      return;
    }
    _rawTables.push(CONFIG_TABLE);
  }

  // Le format sauvegardé a changé deux fois (voir ci-dessous) : normalise le plus ancien (un simple
  // tableau de tuiles, avant l'ajout des bookmarks), l'intermédiaire (`{tiles, bookmarks}`, avant
  // les pages) et le format courant (`{pages, currentPageId, bookmarks}`), pour ne pas casser la
  // lecture d'une config déjà sauvegardée par une version antérieure du widget - même classe de
  // problème que l'évolution de schéma de `BI_StressTest` (voir `ensureColumnsUpToDate` plus bas),
  // mais réglée ici en JS pur puisque ConfigJSON est un blob texte, pas des colonnes Grist typées.
  function singlePageConfig(tiles, bookmarks) {
    const pageId = (GristBI.state && GristBI.state.DEFAULT_PAGE_ID) || 'page_default';
    return { pages: [{ id: pageId, name: 'Page 1', tiles: tiles || [] }], currentPageId: pageId, bookmarks: bookmarks || [] };
  }

  function normalizeConfig(raw) {
    if (Array.isArray(raw)) return singlePageConfig(raw, []);
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.pages) && raw.pages.length) {
        const currentPageId = raw.pages.some((p) => p.id === raw.currentPageId) ? raw.currentPageId : raw.pages[0].id;
        return { pages: raw.pages, currentPageId, bookmarks: raw.bookmarks || [] };
      }
      return singlePageConfig(raw.tiles, raw.bookmarks);
    }
    return singlePageConfig([], []);
  }

  async function loadConfig(tableId) {
    try {
      await ensureConfigTableExists();
      const data = await grist.docApi.fetchTable(CONFIG_TABLE);
      const ids = (data && data.id) || [];
      for (let i = 0; i < ids.length; i++) {
        if (data.TableId[i] === tableId) {
          _configRowIdByTable[tableId] = ids[i];
          try { return normalizeConfig(JSON.parse(data.ConfigJSON[i] || '[]')); }
          catch (e) { return singlePageConfig([], []); }
        }
      }
    } catch (e) {
      console.warn('[GristBI] loadConfig: lecture impossible', e);
    }
    return singlePageConfig([], []);
  }

  async function saveConfig(tableId, pages, currentPageId, bookmarks) {
    if (!tableId) return;
    await ensureConfigTableExists();
    const json = JSON.stringify({ pages, currentPageId, bookmarks: bookmarks || [] });
    let rowId = _configRowIdByTable[tableId];
    if (!rowId) {
      // Config jamais sauvegardée depuis le chargement du widget : revérifie qu'une ligne
      // n'existe pas déjà côté doc (créée par une session précédente) avant d'en ajouter une.
      const data = await grist.docApi.fetchTable(CONFIG_TABLE);
      const ids = (data && data.id) || [];
      for (let i = 0; i < ids.length; i++) {
        if (data.TableId[i] === tableId) rowId = ids[i];
      }
    }
    if (rowId) {
      await grist.docApi.applyUserActions([['UpdateRecord', CONFIG_TABLE, rowId, { ConfigJSON: json }]]);
    } else {
      const result = await grist.docApi.applyUserActions([
        ['AddRecord', CONFIG_TABLE, null, { TableId: tableId, ConfigJSON: json }]
      ]);
      rowId = result.retValues[0];
    }
    _configRowIdByTable[tableId] = rowId;
  }

  // Si `tableId` (le nom fixe courant) n'existe pas encore mais qu'un ancien nom versionné existe
  // (voir LEGACY_*_TABLE_NAMES), le renomme plutôt que de laisser une table orpheline en plus dans
  // le document. `RenameTable` est un verbe déjà vérifié (voir ROADMAP.md). No-op si `tableId`
  // existe déjà, ou si aucun ancien nom n'est présent (première installation : rien à migrer).
  // [BUG TROUVÉ en construisant la matrice de tests croisés du garde-fou anti-course, voir
  // HYPOTHESES.md] Cette fonction s'exécute AVANT `tableExistsConfirmed` dans `loadOrCreateTable`,
  // dans exactement la même fenêtre de course que celle documentée plus haut. L'ancien raisonnement
  // ("un faux négatif ici mène au pire à un RENOMMAGE inutile, pas à une duplication") ne couvrait que
  // le cas où c'est `tableId` qui est faussement vu comme absent. Il manquait le cas inverse : si
  // c'est le NOM LEGACY qui est faussement vu comme absent (alors que lui EXISTE réellement, avec ses
  // propres dizaines de milliers de lignes) pendant que `tableId` est authentiquement absent, le
  // renommage nécessaire est purement et simplement SAUTÉ — la table legacy reste orpheline sous son
  // ancien nom, et `loadOrCreateTable` (juste après) crée et remplit un `tableId` tout neuf de zéro :
  // deux tables contenant chacune le jeu de données complet, sans qu'aucune des deux n'ait été
  // "doublée" au sens strict, mais avec la même conséquence concrète pour l'utilisateur. D'où
  // `tableExistsConfirmed` ici aussi (au lieu du simple `tableExists` non protégé) : ce sera alors le
  // tout premier contrôle d'existence de la session à consommer le budget d'attente généreux (voir sa
  // documentation) — `loadOrCreateTable` juste après réutilise un canal déjà prouvé actif, comme prévu.
  // [Trouvé par une revue adversariale du correctif de course ci-dessus, pas par l'utilisateur]
  // `RenameTable` passe par EXACTEMENT le même mécanisme d'unicité que `AddTable`
  // (`identifiers.pick_table_ident`, vérifié contre le moteur Grist réel — `sandbox/grist/
  // useractions.py:_updateTableRecords`) : si `tableId` (la destination) existe déjà réellement au
  // moment de l'appel, Grist ne lève PAS d'erreur, il suffixe silencieusement le nom réellement
  // utilisé. Contrairement à `AddTable`, `RenameTable` ne renvoie AUCUNE info exploitable
  // (`retValues` vaut `None` côté moteur) : impossible de détecter cette collision aussi
  // déterministement qu'avec `actualAddTableId`. On se contente donc de CONSTATER après coup, avec un
  // contrôle frais, que `tableId` existe désormais bien sous le nom exact attendu, et de le signaler
  // bruyamment sinon plutôt que de continuer en silence sur une hypothèse fausse — même philosophie
  // que le filet de sécurité `AddTable` (un échec visible vaut mieux qu'une corruption silencieuse),
  // en reconnaissant que cette détection est un CONSTAT, pas une prévention : si la collision se
  // produit, les données de `legacyName` sont déjà renommées sous un id imprévisible avant qu'on ne
  // puisse s'en apercevoir. Nécessite un second acteur réellement concurrent créant `tableId` dans la
  // fenêtre entre le contrôle ci-dessus et cet appel — une classe de course différente (deux onglets
  // simultanés) de celle que ce correctif cible principalement (délai de négociation à l'ouverture),
  // volontairement pas traitée plus en profondeur ici (voir HYPOTHESES.md).
  async function migrateLegacyTableName(tableId, legacyNames) {
    if (await tableExistsConfirmed(tableId)) return;
    for (const legacyName of legacyNames) {
      if (await tableExistsConfirmed(legacyName)) {
        await grist.docApi.applyUserActions([['RenameTable', legacyName, tableId]]);
        _rawTables = null; // le cache de listTables() doit être relu après un renommage
        if (!(await tableExistsConfirmed(tableId))) {
          console.error(
            `[GristBI] RenameTable("${legacyName}" -> "${tableId}") n'a pas abouti au nom attendu ` +
            '(collision de nom probable : une autre table utilisait déjà ce nom au moment du ' +
            `renommage). Les données de "${legacyName}" ont probablement été renommées sous un id ` +
            'différent et imprévisible — vérifier manuellement les tables du document dans Grist.'
          );
        }
        return;
      }
    }
  }

  // Envoie `actions` par lots de `ACTION_CHUNK_SIZE` plutôt qu'en un seul appel géant - voir la
  // justification au niveau d'ACTION_CHUNK_SIZE. `onProgress(phase, sent, total)` est appelé après
  // chaque lot (facultatif), pour afficher une progression réelle plutôt qu'un bouton figé.
  async function applyActionsInChunks(phase, actions, onProgress) {
    for (let i = 0; i < actions.length; i += ACTION_CHUNK_SIZE) {
      const chunk = actions.slice(i, i + ACTION_CHUNK_SIZE);
      await grist.docApi.applyUserActions(chunk);
      if (onProgress) onProgress(phase, Math.min(i + ACTION_CHUNK_SIZE, actions.length), actions.length);
    }
  }

  async function fillTable(tableId, rows, columns, onProgress) {
    const actions = rows.map((row) => {
      const fields = {};
      for (const col of columns) fields[col.id] = row[col.id];
      return ['AddRecord', tableId, null, fields];
    });
    await applyActionsInChunks('fill', actions, onProgress);
  }

  // Ajoute à `tableId` (déjà existante) les colonnes de `columns` qui lui manquent encore
  // (`AddColumn`), puis remplit leur valeur pour les lignes déjà présentes avec de VRAIES valeurs
  // calculées par `deriveMissingColumns(row)` et envoyées explicitement via `UpdateRecord` (comme
  // `fillTable` envoie ses `AddRecord`) — PAS une formule Grist : ce projet n'utilise nulle part le
  // langage de formules Grist, cohérent avec le reste du schéma (demande explicite de l'utilisateur,
  // qui a aussi demandé à ne plus jamais recréer de table pour un changement de schéma : ce
  // mécanisme d'ajout de colonne en place remplace définitivement la logique de versionnage de nom
  // de table utilisée avant). No-op si aucune colonne ne manque.
  async function ensureColumnsUpToDate(tableId, columns, deriveMissingColumns, onProgress) {
    const table = await grist.docApi.fetchTable(tableId);
    const existingIds = new Set(Object.keys(table).filter((k) => k !== 'id'));
    const missingColumns = columns.filter((c) => !existingIds.has(c.id));
    if (!missingColumns.length) return;
    await grist.docApi.applyUserActions(missingColumns.map((c) => ['AddColumn', tableId, c.id, { type: c.type }]));
    const rows = GristBI.data.tableToRows(table);
    const actions = rows.map((row, i) => {
      const derived = deriveMissingColumns(row);
      const fields = {};
      for (const c of missingColumns) fields[c.id] = derived[c.id];
      return ['UpdateRecord', tableId, table.id[i], fields];
    });
    await applyActionsInChunks('migrate', actions, onProgress);
  }

  // Se connecte à la table de données de test de charge : la CRÉE et la REMPLIT seulement si elle
  // n'existe pas encore ; si elle existe déjà, complète seulement les colonnes manquantes (voir
  // `ensureColumnsUpToDate`) sans jamais renvoyer les lignes déjà présentes ni recréer la table.
  // Volontairement idempotent : un rechargement du widget ne doit pas renvoyer des dizaines de
  // milliers de lignes à Grist à chaque fois une fois que la table existe déjà. `alreadyExists` est
  // calculé UNE SEULE fois via `tableExistsConfirmed` (voir sa documentation, budget d'attente
  // renforcé) et réutilisé pour LES DEUX décisions (créer la table ET la remplir) — deux vérifications
  // séparées à des instants différents pourraient en théorie se contredire l'une l'autre selon l'état
  // de la négociation d'accès avec Grist, ce qui a été la source du bug initial.
  //
  // [Filet de sécurité INDÉPENDANT du garde-fou anti-course ci-dessus, ajouté après que le bug a été
  // remonté À NOUVEAU malgré un premier correctif : même si `tableExistsConfirmed` se trompe malgré
  // son budget d'attente généreux, `AddTable` sur un `tableId` qui existe DÉJÀ réellement ne lève
  // JAMAIS d'erreur côté moteur Grist — il suffixe silencieusement l'id réellement créé
  // (`pick_table_ident`, vérifié contre le moteur Grist réel, voir HYPOTHESES.md) pour éviter la
  // collision. `applyUserActions` renvoie ce `table_id` réel dans sa réponse : on le compare
  // systématiquement au `tableId` demandé. S'ils diffèrent, la preuve est faite qu'un faux négatif a
  // échappé au garde-fou anti-course — on abandonne IMMÉDIATEMENT tout remplissage (la table
  // nouvellement créée est fantôme, vide, sans rapport avec les vraies données) et on retombe sur le
  // chemin "la table existe déjà", garanti sans duplication. La table fantôme vide reste orpheline
  // dans le document (jamais nettoyée via un `RemoveTable` : verbe délibérément jamais utilisé dans ce
  // projet, voir HYPOTHESES.md — un orphelin visible et inoffensif est préférable à un verbe de
  // suppression jamais éprouvé dans le chemin de code le plus critique du widget côté sécurité des
  // données).
  async function loadOrCreateTable(tableId, legacyNames, columns, buildRows, deriveMissingColumns, onProgress) {
    await migrateLegacyTableName(tableId, legacyNames);
    let alreadyExists = await tableExistsConfirmed(tableId);
    if (!alreadyExists) {
      const result = await grist.docApi.applyUserActions([['AddTable', tableId, columns]]);
      const actualTableId = actualAddTableId(result);
      if (actualTableId && actualTableId !== tableId) {
        console.error(
          `[GristBI] AddTable("${tableId}") a créé "${actualTableId}" à la place (collision de nom : ` +
          'la table existait déjà malgré la vérification). Table vide orpheline à supprimer ' +
          `manuellement dans Grist si besoin — les données de "${tableId}" n'ont PAS été dupliquées.`
        );
        _rawTables = null;
        alreadyExists = true;
      } else {
        _rawTables.push(tableId);
        await fillTable(tableId, buildRows(), columns, onProgress);
      }
    }
    if (alreadyExists) {
      await ensureColumnsUpToDate(tableId, columns, deriveMissingColumns, onProgress);
    }
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table), created: !alreadyExists };
  }

  function loadOrCreateStressData(onProgress) {
    return loadOrCreateTable(
      STRESS_TABLE, LEGACY_STRESS_TABLE_NAMES, GristBI.demoData.COLUMNS_LARGE,
      GristBI.demoData.buildLargeSampleRows, GristBI.demoData.deriveDateColumn, onProgress
    );
  }

  // Toutes les tables du document, table de config interne exclue (jamais une donnée à visualiser)
  // — pour le sélecteur de table (voir main.js). `_rawTables` remis à `null` avant de relire :
  // volontairement une lecture FRAÎCHE à chaque appel (pas de cache ici, contrairement à
  // `listAllTablesCached` utilisé ailleurs pour les vérifications d'existence internes) — la liste
  // proposée à l'utilisateur doit refléter les tables les plus récentes du document, y compris une
  // table créée dans Grist depuis le dernier chargement du widget.
  async function listAvailableTables() {
    _rawTables = null;
    const tables = await listAllTablesCached();
    return tables
      .map((t) => (typeof t === 'string' ? t : t.id))
      .filter((id) => id !== CONFIG_TABLE);
  }

  // Lit une table déjà existante (choisie via le sélecteur de table, voir main.js) — contrairement
  // à `loadOrCreateTable`, ne crée ni ne remplit jamais rien : la table doit déjà exister (elle vient
  // de `listAvailableTables`), sinon `fetchTable` renverrait une table vide silencieusement.
  async function loadTable(tableId) {
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table) };
  }

  GristBI.api = {
    init, loadConfig, saveConfig, loadOrCreateStressData,
    listAvailableTables, loadTable
  };
})(window);
