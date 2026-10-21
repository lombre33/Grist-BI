/*
 * Glue vers l'API Grist Custom Widget. Patterns repris (et simplifiés) du widget
 * publipostageGrist du même auteur : grist.ready({requiredAccess:'full'}) et des tables internes
 * cachées (préfixe "BI_") pour la config/les commentaires/la détection d'auteur — même mécanisme que
 * Publipostage_Modeles/Publipostage_LiensTables, dont on sait qu'il fonctionne en Grist réel. Ce
 * widget ne crée en revanche AUCUNE table de données lui-même (demande explicite de l'utilisateur,
 * 2026-09-19 — voir CLAUDE.md §1/§7) : il se connecte à la table de travail de l'utilisateur, qu'il
 * s'agisse de la 1re table du document (connexion automatique au démarrage, voir main.js:bootstrap)
 * ou d'une autre table choisie via le sélecteur. Pas de dépendance à grist.onRecords()/la table
 * liée au widget dans la page (voir HYPOTHESES.md et main.js:bootstrap). Voir HYPOTHESES.md pour ce
 * qui reste à valider (ex. grist.setOptions() comme alternative plus simple à la table de config,
 * non testée ici).
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const CONFIG_TABLE = 'BI_Dashboard_Config';
  // Table dédiée aux commentaires collaboratifs (ROADMAP.md Tier 2, 2026-09-29) : 1 LIGNE PAR
  // COMMENTAIRE, plutôt qu'un champ de plus dans le blob JSON de BI_Dashboard_Config — ce blob est
  // une seule ligne par table de travail, donc deux commentaires ajoutés en même temps par deux
  // personnes s'écraseraient l'un l'autre (dernière écriture gagne). Une ligne par commentaire n'a
  // pas ce problème : deux `AddRecord` concurrents créent simplement deux lignes.
  const COMMENTS_TABLE = 'BI_Dashboard_Comments';
  const COMMENTS_COLUMNS = [
    { id: 'TableId', type: 'Text' }, // table de travail concernée, comme BI_Dashboard_Config
    { id: 'TileId', type: 'Text' }, // id de tuile déjà globalement unique dans ce widget (voir js/main.js)
    { id: 'Author', type: 'Text' }, // rempli par getCurrentUserEmail() quand possible, sinon saisi à la main (voir js/main.js)
    { id: 'Text', type: 'Text' },
    { id: 'CreatedAt', type: 'Text' } // ISO 8601, calculé en JS au moment de l'ajout
  ];
  // Table-sonde dédiée à UNE SEULE formule Grist (ROADMAP.md, "Identité de l'utilisateur courant",
  // pattern porté de publipostageGrist:getCurrentUserEmail()) — SEULE exception du projet à la règle
  // "jamais de langage de formule Grist" (voir CLAUDE.md §8) : il n'existe aucun autre moyen pour du
  // JS exécuté dans l'iframe du widget de connaître l'identité de l'utilisateur courant, alors que ce
  // moteur de formules tourne côté serveur Grist et y a accès (`user.Email`). Colonne dédiée plutôt
  // qu'ajoutée à BI_Dashboard_Comments : une formule Grist normale RECALCULE à chaque lecture par
  // N'IMPORTE QUEL viewer du document, donc une valeur ainsi posée sur une ligne de commentaire
  // existante changerait de signification au fil des ouvertures — inutilisable comme auteur figé.
  // Au lieu de ça, `getCurrentUserEmail()` (plus bas) ajoute une ligne, lit la valeur calculée pour
  // CET utilisateur juste après l'AddRecord qui déclenche son calcul, puis supprime aussitôt la ligne
  // (RemoveRecord) : seul le round-trip compte, jamais une valeur relue plus tard sur cette table.
  const USER_PROBE_TABLE = 'BI_Dashboard_UserProbe';
  const USER_PROBE_COLUMNS = [
    { id: 'Email', type: 'Text', isFormula: true, formula: 'user.Email' }
  ];
  // Nombre d'actions envoyées par appel à applyUserActions() lors d'une génération/suppression en
  // masse : un seul appel avec des dizaines de milliers d'actions est un pari risqué (timeout,
  // limite de payload côté Grist - aucune des deux non testée ici, voir HYPOTHESES.md) ; les
  // envoyer par lots donne aussi une progression visible à l'utilisateur plutôt qu'une attente
  // opaque.
  const ACTION_CHUNK_SIZE = 2000;

  let _rawTables = null;
  let _configRowIdByTable = {};

  // Ne s'appuie plus sur `grist.onRecords()`/la table liée au widget dans la page (voir
  // HYPOTHESES.md) : le dashboard se connecte directement, au démarrage, à la 1re table du document
  // (voir main.js:bootstrap et GristBI.api.listAvailableTables/loadTable plus bas) — même pattern
  // que publipostageGrist qui gère ses propres tables internes sans dépendre d'une sélection de
  // table faite par l'auteur de la page Grist, mais sans plus jamais créer lui-même de table de
  // données (demande explicite de l'utilisateur, 2026-09-19 — voir CLAUDE.md §1/§7, seules
  // BI_Dashboard_Config/BI_Dashboard_Comments/BI_Dashboard_UserProbe restent créées par ce widget).
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
  // la session (typiquement celui de `BI_Dashboard_Config`, juste après `grist.ready()` — le seul
  // moment où la négociation d'accès peut réellement être encore en cours ; générique par ordre
  // d'appel, pas câblé sur un nom de table précis) ; tous les contrôles suivants (ex.
  // `BI_Dashboard_Comments`, quelques instants plus tard) font confiance à un seul appel : le canal a
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
    // vient d'être définitivement désarmé, tout contrôle suivant de la session ferait confiance à ce
    // cache SANS le moindre nouvel appel réseau — le remettre à `null` force au moins UNE lecture
    // fraîche pour ce contrôle suivant plutôt que de réutiliser un résultat déjà connu comme
    // potentiellement obsolète. Ne résout pas le cas encore
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
  // problème que l'évolution de schéma d'une table interne de ce widget (voir `ensureColumnsUpToDate`
  // plus bas), mais réglée ici en JS pur puisque ConfigJSON est un blob texte, pas des colonnes
  // Grist typées.
  // `blend` (data blending multi-tables, voir GristBI.data.blendRows/js/main.js) suit exactement la
  // même convention de compatibilité ascendante que `bookmarks` : absent des 3 formats historiques
  // (antérieurs à cette feature), donc toujours `null` ("aucune jointure") tant que l'utilisateur
  // n'en a pas configuré une pour cette table.
  function singlePageConfig(tiles, bookmarks, blend) {
    const pageId = (GristBI.state && GristBI.state.DEFAULT_PAGE_ID) || 'page_default';
    return { pages: [{ id: pageId, name: 'Page 1', tiles: tiles || [] }], currentPageId: pageId, bookmarks: bookmarks || [], blend: blend || null };
  }

  function normalizeConfig(raw) {
    if (Array.isArray(raw)) return singlePageConfig(raw, [], null);
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.pages) && raw.pages.length) {
        const currentPageId = raw.pages.some((p) => p.id === raw.currentPageId) ? raw.currentPageId : raw.pages[0].id;
        return { pages: raw.pages, currentPageId, bookmarks: raw.bookmarks || [], blend: raw.blend || null };
      }
      return singlePageConfig(raw.tiles, raw.bookmarks, raw.blend);
    }
    return singlePageConfig([], [], null);
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
          catch (e) { return singlePageConfig([], [], null); }
        }
      }
    } catch (e) {
      console.warn('[GristBI] loadConfig: lecture impossible', e);
    }
    return singlePageConfig([], [], null);
  }

  async function saveConfig(tableId, pages, currentPageId, bookmarks, blend) {
    if (!tableId) return;
    await ensureConfigTableExists();
    const json = JSON.stringify({ pages, currentPageId, bookmarks: bookmarks || [], blend: blend || null });
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
  // Id des colonnes déclarées `Date` dans le schéma JS STATIQUE d'une table interne de ce widget
  // (aujourd'hui, seule `COMMENTS_COLUMNS` passe par `loadOrCreateTable`/ce chemin — voir plus bas ;
  // reste générique au cas où une future colonne de ce type s'ajouterait à une table interne) —
  // utilisable sans le moindre appel réseau supplémentaire. Voir `realDateColumnIds` plus bas pour la
  // version générale (n'importe quelle table du document, y compris la table de travail de
  // l'utilisateur, via les tables système Grist), dont le résultat est fusionné avec celui-ci partout
  // où `tableToRows` est appelé.
  function dateColumnIdsFrom(columns) {
    return columns.filter((c) => c.type === 'Date').map((c) => c.id);
  }

  // Lit le VRAI type de chaque colonne de `tableId` via les tables système Grist
  // (`_grist_Tables`/`_grist_Tables_column`) — contrairement à `dateColumnIdsFrom` ci-dessus (limité
  // au schéma JS statique d'une table interne de ce widget), fonctionne pour N'IMPORTE QUELLE table
  // du document, y compris la table de travail de l'utilisateur (voir `loadTable` plus bas, le
  // chemin par lequel ce widget se connecte désormais à TOUTE table, y compris la 1re table du
  // document au démarrage — voir main.js:bootstrap) : LE point aveugle réel relevé le 29/09/2026
  // (voir HYPOTHESES.md point 15/16 et CLAUDE.md §7 piège n°16) — Antoine choisira ses propres
  // tables, avec ses propres colonnes Date, jamais couvertes par un schéma statique de ce widget.
  // `_grist_Tables_column.parentId` relie
  // chaque ligne à la ligne de `_grist_Tables` dont l'`id` (l'id de ligne interne, PAS `tableId`)
  // correspond à la table visée — accessible avec l'accès `full` déjà demandé par ce widget (voir
  // §3 de CLAUDE.md), sans lecture supplémentaire à négocier ; simplement jamais tenté avant
  // aujourd'hui (voir la correction technique du 2026-09-15 dans ROADMAP.md, qui l'avait déjà
  // identifié comme possible). Un type `DateTime:<fuseau>` est traité comme `Date` (même
  // conversion en 'AAAA-MM-JJ', composante horaire perdue) : `parseDateValue` (js/data.js) ne sait
  // de toute façon gérer qu'une précision journalière, donc aucune perte de capacité réelle par
  // rapport à ce que le reste du widget sait déjà exploiter — traiter les deux séparément
  // n'apporterait rien tant que cette précision journalière reste la seule supportée. Repli sur un
  // tableau vide en cas d'échec (droits restreints, tables système absentes/renommées dans une
  // version de Grist future) plutôt que de faire planter tout le chargement du dashboard pour cette
  // lecture annexe — dans ce cas, seul le schéma JS statique (dateColumnIdsFrom) continue de
  // s'appliquer, exactement comme avant cette extension.
  async function realDateColumnIds(tableId) {
    try {
      const tablesMeta = await grist.docApi.fetchTable('_grist_Tables');
      const columnsMeta = await grist.docApi.fetchTable('_grist_Tables_column');
      const rowIdx = (tablesMeta.tableId || []).indexOf(tableId);
      if (rowIdx < 0) return [];
      const parentRowId = tablesMeta.id[rowIdx];
      const result = [];
      const n = (columnsMeta.id || []).length;
      for (let i = 0; i < n; i++) {
        const type = columnsMeta.type[i] || '';
        if (columnsMeta.parentId[i] === parentRowId && (type === 'Date' || type.startsWith('DateTime'))) {
          result.push(columnsMeta.colId[i]);
        }
      }
      return result;
    } catch (e) {
      console.warn(
        '[GristBI] lecture des vrais types de colonnes (_grist_Tables_column) impossible pour ' +
        `"${tableId}" — repli sur le schéma JS statique de ce widget uniquement pour la détection ` +
        'des colonnes Date', e
      );
      return [];
    }
  }

  // Fusionne les deux sources de détection de colonnes Date (schéma JS statique + lecture réelle
  // des tables système, voir les deux fonctions ci-dessus) — un `Set` élimine les doublons pour
  // BI_Dashboard_Comments (si une future colonne Date s'y ajoutait), où les deux sources
  // désigneraient alors normalement la même colonne.
  async function mergedDateColumnIds(tableId, columns) {
    return Array.from(new Set(dateColumnIdsFrom(columns).concat(await realDateColumnIds(tableId))));
  }

  // Colonnes de RÉFÉRENCE SIMPLE (`Ref:<AutreTable>`) de `tableId`, avec la table ciblée par chacune
  // — même mécanisme de lecture que `realDateColumnIds` ci-dessus (`_grist_Tables`/
  // `_grist_Tables_column`, déjà confirmé lisible avec l'accès `full` sur un vrai Grist le
  // 30/09/2026), réutilisé pour suggérer une clé de jointure de data blending (ROADMAP.md : "Auto-
  // détection des clés via Ref:/RefList: délibérément pas tentée dans ce premier jet... piste
  // future", voir aussi CLAUDE.md §6) plutôt que de laisser l'utilisateur deviner quelle colonne
  // réfère quelle table. **`RefList:` est délibérément EXCLUE** : une telle colonne porte une LISTE
  // d'ids, jamais une valeur scalaire — `GristBI.data.blendRows` ne fait qu'une égalité simple par
  // ligne, inadaptée à une liste (joindre dessus donnerait silencieusement une jointure toujours
  // fausse, jamais une vraie jointure 1-N). Le type d'une colonne Ref Grist encode directement la
  // table ciblée après le préfixe (`Ref:NomTable`), pas besoin d'un second aller-retour. Repli sur
  // `[]` en cas d'échec, même raison que `realDateColumnIds` (droits restreints, tables système
  // absentes/renommées) : la suggestion disparaît simplement, l'utilisateur choisit ses clés à la
  // main comme avant cette fonctionnalité.
  async function refColumnsForTable(tableId) {
    try {
      const tablesMeta = await grist.docApi.fetchTable('_grist_Tables');
      const columnsMeta = await grist.docApi.fetchTable('_grist_Tables_column');
      const rowIdx = (tablesMeta.tableId || []).indexOf(tableId);
      if (rowIdx < 0) return [];
      const parentRowId = tablesMeta.id[rowIdx];
      const result = [];
      const n = (columnsMeta.id || []).length;
      for (let i = 0; i < n; i++) {
        const type = columnsMeta.type[i] || '';
        if (columnsMeta.parentId[i] === parentRowId && type.startsWith('Ref:')) {
          result.push({ colId: columnsMeta.colId[i], targetTableId: type.slice('Ref:'.length) });
        }
      }
      return result;
    } catch (e) {
      console.warn(
        '[GristBI] lecture des colonnes de référence (_grist_Tables_column) impossible pour ' +
        `"${tableId}" — aucune clé de jointure ne sera suggérée pour le data blending`, e
      );
      return [];
    }
  }

  async function ensureColumnsUpToDate(tableId, columns, deriveMissingColumns, onProgress) {
    const table = await grist.docApi.fetchTable(tableId);
    const existingIds = new Set(Object.keys(table).filter((k) => k !== 'id'));
    const missingColumns = columns.filter((c) => !existingIds.has(c.id));
    if (!missingColumns.length) return;
    await grist.docApi.applyUserActions(missingColumns.map((c) => ['AddColumn', tableId, c.id, { type: c.type }]));
    const rows = GristBI.data.tableToRows(table, await mergedDateColumnIds(tableId, columns));
    const actions = rows.map((row, i) => {
      const derived = deriveMissingColumns(row);
      const fields = {};
      for (const c of missingColumns) fields[c.id] = derived[c.id];
      return ['UpdateRecord', tableId, table.id[i], fields];
    });
    await applyActionsInChunks('migrate', actions, onProgress);
  }

  // Se connecte à une table interne cachée (`BI_Dashboard_Config`/`BI_Dashboard_Comments`, voir leurs
  // appelants plus bas — JAMAIS la table de données de travail de l'utilisateur, voir CLAUDE.md
  // §1/§7) : la CRÉE et la REMPLIT seulement si elle n'existe pas encore ; si elle existe déjà,
  // complète seulement les colonnes manquantes (voir `ensureColumnsUpToDate`) sans jamais renvoyer
  // les lignes déjà présentes ni recréer la table.
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
  async function loadOrCreateTable(tableId, columns, buildRows, deriveMissingColumns, onProgress) {
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
    return { tableId, rows: GristBI.data.tableToRows(table, await mergedDateColumnIds(tableId, columns)), created: !alreadyExists };
  }

  // Même mécanisme idempotent que loadOrCreateTable (garde-fous anti-duplication inclus), mais SANS
  // aucune ligne de départ (`() => []` : une table de commentaires neuve doit rester vide) et sans
  // colonne dérivée à recalculer pour l'instant (`() => ({})` — à réviser le jour où une colonne
  // serait ajoutée à COMMENTS_COLUMNS). Cette table reste créée par ce widget (contrairement à la
  // table de données elle-même, voir CLAUDE.md §1/§7) : elle ne porte que les commentaires, jamais
  // les données de travail de l'utilisateur.
  function loadOrCreateComments(onProgress) {
    return loadOrCreateTable(COMMENTS_TABLE, COMMENTS_COLUMNS, () => [], () => ({}), onProgress);
  }

  // Mémorisée pour toute la session (comme les commentaires, voir main.js:bootstrap) : l'identité de
  // l'utilisateur courant ne change pas en cours de session, inutile de refaire ce round-trip à
  // chaque ouverture du panneau Commentaires. `null` = détection indisponible (widget ouvert hors
  // Grist, mock de dev-tests/ qui ne simule PAS le moteur de formules — voir grist-stub.js — droits
  // insuffisants pour créer BI_Dashboard_UserProbe, etc.) : main.js retombe alors sur la saisie
  // manuelle existante, inchangée.
  let _currentUserEmailPromise = null;

  // AddTable sur BI_Dashboard_UserProbe suit le MÊME garde-fou anti-collision que loadOrCreateTable
  // (tableExistsConfirmed + comparaison de l'actualTableId réellement créé) mais SANS jamais appeler
  // loadOrCreateTable lui-même : ce dernier recourt à ensureColumnsUpToDate/deriveMissingColumns pour
  // faire évoluer un schéma via de VRAIES valeurs calculées en JS puis écrites par UpdateRecord — un
  // mécanisme délibérément incompatible avec une colonne à formule Grist (voir le commentaire sur
  // USER_PROBE_COLUMNS plus haut), qu'il ne faut surtout pas laisser réécrire.
  async function ensureUserProbeTableExists() {
    if (await tableExistsConfirmed(USER_PROBE_TABLE)) return;
    const result = await grist.docApi.applyUserActions([['AddTable', USER_PROBE_TABLE, USER_PROBE_COLUMNS]]);
    const actualTableId = actualAddTableId(result);
    if (actualTableId && actualTableId !== USER_PROBE_TABLE) {
      // Même filet de sécurité que loadOrCreateTable : une collision prouve qu'un faux négatif a
      // échappé à tableExistsConfirmed — la table demandée existe déjà réellement, on l'utilise donc
      // telle quelle (son schéma est fixe et identique, et cette table ne porte aucune ligne à
      // perdre : seule son existence compte, voir getCurrentUserEmail plus bas).
      console.error(
        `[GristBI] AddTable("${USER_PROBE_TABLE}") a créé "${actualTableId}" à la place (collision de nom).`
      );
    }
    _rawTables = null;
  }

  // Table-sonde à formule déclenchée (voir USER_PROBE_COLUMNS ci-dessus) : AddRecord déclenche le
  // calcul de `user.Email` POUR L'UTILISATEUR COURANT, on relit la valeur fraîchement calculée via
  // fetchTable, puis on supprime la ligne (RemoveRecord — jamais utilisé ailleurs dans ce projet,
  // contrairement à RemoveTable qui reste délibérément évité partout, voir CLAUDE.md §3/§8 : ce verbe
  // porte ici sur une ligne de table éphémère que ce widget vient tout juste de créer lui-même, pas
  // sur une table ou une donnée de l'utilisateur). Repli sur `null` à la moindre étape en échec :
  // jamais de blocage de l'ajout de commentaire pour cette seule fonctionnalité annexe.
  async function getCurrentUserEmail() {
    if (_currentUserEmailPromise) return _currentUserEmailPromise;
    _currentUserEmailPromise = (async () => {
      try {
        await ensureUserProbeTableExists();
        const addResult = await grist.docApi.applyUserActions([['AddRecord', USER_PROBE_TABLE, null, {}]]);
        const rowId = addResult.retValues[0];
        const table = await grist.docApi.fetchTable(USER_PROBE_TABLE);
        const idx = table.id.indexOf(rowId);
        const email = idx === -1 ? null : (table.Email[idx] || null);
        await grist.docApi.applyUserActions([['RemoveRecord', USER_PROBE_TABLE, rowId]]);
        return email;
      } catch (e) {
        console.error(
          '[GristBI] échec de la détection automatique de l\'auteur courant (table-sonde ' +
          `${USER_PROBE_TABLE}) — repli sur la saisie manuelle du nom de l'auteur`, e
        );
        return null;
      }
    })();
    return _currentUserEmailPromise;
  }

  // Ajoute UN commentaire (AddRecord isolé, même pattern que saveConfig ci-dessus) — jamais par
  // lot, un commentaire est toujours un geste utilisateur unique, pas un remplissage en masse.
  // Renvoie la ligne complète (avec son id Grist réel) pour un ajout optimiste côté store
  // (js/state.js:addCommentLocal), sans re-fetch de toute la table à chaque commentaire.
  async function addComment(tableId, tileId, author, text) {
    const fields = { TableId: tableId, TileId: tileId, Author: author, Text: text, CreatedAt: new Date().toISOString() };
    const result = await grist.docApi.applyUserActions([['AddRecord', COMMENTS_TABLE, null, fields]]);
    return Object.assign({ id: result.retValues[0] }, fields);
  }

  // Toutes les tables du document, tables internes de ce widget exclues (jamais une donnée à
  // visualiser, ni une table de travail valide pour la connexion automatique du démarrage — voir
  // main.js:bootstrap, qui se connecte à la 1re table renvoyée ici) — pour le sélecteur de table
  // (voir main.js). `COMMENTS_TABLE` est exclue pour la même raison que `CONFIG_TABLE`/
  // `USER_PROBE_TABLE` : sans ce filtre, `BI_Dashboard_Comments` apparaîtrait dans la liste et
  // pourrait même être choisie comme 1re table au démarrage, le widget se connectant alors par
  // erreur à ses propres commentaires comme s'il s'agissait de données à visualiser. `_rawTables`
  // remis à `null` avant de relire : volontairement une lecture FRAÎCHE à chaque appel (pas de
  // cache ici, contrairement à `listAllTablesCached` utilisé ailleurs pour les vérifications
  // d'existence internes) — la liste proposée à l'utilisateur doit refléter les tables les plus
  // récentes du document, y compris une table créée dans Grist depuis le dernier chargement du
  // widget.
  async function listAvailableTables() {
    _rawTables = null;
    const tables = await listAllTablesCached();
    return tables
      .map((t) => (typeof t === 'string' ? t : t.id))
      .filter((id) => id !== CONFIG_TABLE && id !== USER_PROBE_TABLE && id !== COMMENTS_TABLE);
  }

  // Lit une table déjà existante (table de travail choisie via le sélecteur, voir main.js, OU la
  // 1re table du document connectée automatiquement au démarrage — voir main.js:bootstrap, depuis
  // que ce widget ne crée plus lui-même aucune table de données, CLAUDE.md §1/§7) — ne crée ni ne
  // remplit jamais rien : la table doit déjà exister (elle vient de `listAvailableTables`), sinon
  // `fetchTable` renverrait une table vide silencieusement. AUCUN schéma JS statique connu pour une
  // table arbitraire de l'utilisateur : `realDateColumnIds` (voir plus haut) est ici la SEULE source
  // possible de détection des colonnes Date — c'était, avant cette fonction, le point aveugle réel
  // relevé le 29/09/2026 (voir HYPOTHESES.md point 15/16) : une vraie colonne Date de la table
  // choisie par l'utilisateur restait mal classée par `inferColumnKind` (js/main.js), cassant
  // silencieusement le drill-down et les mesures façon DAX pour toute table sans schéma JS statique.
  async function loadTable(tableId) {
    const table = await grist.docApi.fetchTable(tableId);
    return { tableId, rows: GristBI.data.tableToRows(table, await realDateColumnIds(tableId)) };
  }

  GristBI.api = {
    init, loadConfig, saveConfig,
    listAvailableTables, loadTable, loadOrCreateComments, addComment, refColumnsForTable,
    getCurrentUserEmail
  };
})(window);
