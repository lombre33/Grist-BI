# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-18 (décision du porteur : une seule copie d'ECharts quand l'app est servie dans GFS, ma copie gardée en standalone, trois questions à GFS ; consignes 019 à 022 : « Nuage de mots » branchée sur l'extension `nuage-de-mots` de GFS (`js/extensions.js`, grisée sans l'extension, jamais masquée), « Mots-clés des PDF » branchée sur l'extension `mots-cles-pdf` (`c97b614`, fenêtre « Mots-clés des publications » du menu Données, grisée sans l'extension) ; 020 lue, demande `_grist_DocInfo` sortie ; 021 lue, ma question sur le module graphique sort ; 022 lue : `jeton` déclarée et `ecrit` déjà couverte, mes deux demandes sortent, la question de l'adresse du grisé sort aussi (ma fenêtre reste sans adresse tant que GFS n'en donne pas par une consigne) ; consignes 016 et 017 faites (SheetJS remplacé par ExcelJS 4.4.0, choix du porteur), 018 lue ; `consignes/bi/INDEX.md` à `5450175` ou plus récent). La
011 n'a pas été lue (remplacée par la 012 avant lecture, consigne explicite d'Antoine).

## Consignes
- 001 · faite · `23647eb` · 1.1 : écart sur la règle 4 (les 3 tables internes — `BI_Dashboard_Config`, `BI_Dashboard_Comments`, `BI_Dashboard_UserProbe` — se créent au démarrage sans l'accord de la personne) et la règle 11 (pas de CSP, déjà noté dans le guide) ; ligne du guide par ailleurs juste à ce commit, seule omission : elle ne mentionne jamais `BI_Dashboard_Comments` (créée depuis le 30/09) parmi les tables internes
- 002 · lue
- 003 · faite · `21b012b` · fichier vide `.nojekyll` ajouté à la racine (PR #30) ; vérifié qu'aucun fichier caché sensible n'est nouvellement exposé (seuls `.nojekyll` et `.gitignore`, rien de sensible dans l'un ou l'autre, aucun fichier `_*`) ; run « pages build and deployment » #58 passé en succès sur ce commit ; version vue en ligne le 02/11/2026 à `https://lombre33.github.io/Grist-BI/` : titre « Grist BI Dashboard (POC) », bandeau « Dashboard BI POC », état vide conforme à `main` à ce commit — l'app n'affiche aucun numéro de version, donc pas de numéro à relever
- 004 · faite · `fef9af8` · kit pris en sous-module Git (`kit/`, pointant
  `db14544`, Kit 0.7.0, ≥ `8afa569` demandé) ; `Ambiance.start()` appelé au tout début de
  `js/main.js`, avant tout rendu, via un `import()` dynamique résolu sur `document.currentScript.src`
  (Grist-BI n'a pas son propre `GfsLink`, contrairement à Publipostage+, donc la version prête à
  l'emploi du kit plutôt que `createAmbiance`) ; `css/style.css` lit désormais les jetons de couleur
  de la charte (`--bg`, `--surface`, `--surface-sunken`, `--border`[`-strong`], `--text`[`-muted`],
  `--accent`, `--on-accent`, `--accent-solid`[`-hover`], `--accent-ink`, `--accent-soft`[`-border`])
  et de forme (`--radius-*`, `--bw`, `--shadow-ctl/panel/float`, `--font-ui/head/label` + leurs
  variantes typographiques, `--fill`[`-hover`], `--wash`[`-size`]) ; les graphiques gardent la
  palette du tableau de bord (jamais lu par `js/charts.js`) et les couleurs d'état
  (`--good`/`--critical`/`--warning-*`, `.warning-banner`) restent les siennes, comme demandé.
  Rien d'autre du guide 1.2 engagé à ce lot (pas de `GfsLink`/`gfs.json` propres à Grist-BI) — voir
  CLAUDE.md §8. Testé en Playwright contre le message d'exemple réel du kit
  (`kit/test/ambiance-exemple.json`) : pose puis dépose vérifiées sur le fond de page, une carte et
  un bouton plein, en clair et en sombre — jamais contre un vrai hébergeur GFS (inexistant à ce
  jour), voir HYPOTHESES.md/TEST_PROTOCOL.md pour le détail et les points encore non vérifiables.
- 005 · faite · lue, aucun code · `ce33e5f` · relevé demandé (contrats 11.6 point 9, 11.9 point 5) de tout
  point d'entrée d'une valeur de cellule dans un écran/un calcul/un fichier, à ce commit :
  - info-bulles/légendes ECharts : un seul `formatter` compose du HTML à la main, celui du nuage de
    points (`js/charts.js:719-721`) — `escapeHtml` sur le nom et les deux mesures. Les autres tuiles
    (barres/secteurs/treemap/jauge/KPI/radar/cascade, ex. `js/charts.js:830,845,900`) n'ont pas de
    `formatter` HTML personnalisé : légende et axes sont du texte canvas d'ECharts 5.6.0 (vendorisé,
    jamais interprété comme du HTML) et l'info-bulle par défaut est celle d'ECharts — pas re-testée
    ligne à ligne dans cette session, à la différence du formatter qu'on écrit nous-mêmes.
  - pastilles de filtre croisé : `js/main.js:771-774` (`escapeHtml` sur la colonne et la valeur).
    Filtre avancé : le texte composé (`js/main.js:793-813`, `describeAdvancedFilter` — jamais une
    valeur de ligne, seulement la config du filtre que la personne choisit) est échappé en bloc à
    l'affichage, `js/main.js:822`.
  - tableau croisé dynamique (`js/charts.js:renderPivot`, 527-593) : chaque en-tête et chaque valeur
    cliquable passent par `escapeHtml` avant `innerHTML` (ex. lignes 545, 559, 562).
  - fil d'Ariane du drill-down (`js/charts.js:renderBreadcrumb`, 910-935) : la valeur de chaque
    niveau drillé (une vraie valeur de cellule, `step.value`) est échappée ligne 927.
  - modale « Détail » (jusqu'à 500 lignes) : chaque cellule affichée est échappée, `js/main.js:958-963`.
  - suggestions de valeurs du filtre « Recherche » (combobox) : `js/combobox.js:76-83`,
    `highlightMatch` découpe le texte autour de ce qui a été tapé, puis chaque segment (avant/
    correspondance/après) passe par `escapeHtml` avant d'entrer dans `<mark>`.
  - commentaires collaboratifs (Auteur/Texte, `BI_Dashboard_Comments`) : échappés, `js/main.js:903-906`.
  - valeurs de filtre envoyées à DuckDB-WASM : en réalité, aucune n'atteint jamais le texte SQL — le
    filtrage (clic de cross-filter, recherche, drill-down, filtres avancés) se fait TOUJOURS en JS pur
    avant l'agrégation (`GristBI.data.rowsForTile`, appelé par `js/charts.js:renderTile` avant tout
    appel à DuckDB) ; seules les lignes déjà filtrées partent vers DuckDB, comme des données
    CSV-échappées (`js/duckdb-engine.js:99-103`, `csvEscape`), jamais comme un fragment de requête.
    Les seules chaînes qui entrent dans le texte SQL sont des noms de COLONNE, jamais une valeur de
    cellule, validés par `assertSafeIdentifier` (`js/duckdb-engine.js:56-61`) avant toute
    concaténation (ex. lignes 68-72, 138-139).
  - export Excel (`js/export.js`, `cellValue`/`buildWorkbook`) : **refait le 18/11/2026 avec ExcelJS 4.4.0** (avant : SheetJS `aoa_to_sheet`, mêmes conclusions) —
    toute valeur venant de `tileExportSheet`/`rowsForTile` est écrite comme chaîne partagée (`t="s"`), jamais comme formule : ExcelJS ne pose une
    formule (`<f>`) que pour un OBJET `{ formula }`, et `cellValue` ne laisse passer aucun objet (tableaux et objets deviennent du texte). Un texte
    commençant par `=`, `+`, `-` ou `@` est donc du texte littéral dans le fichier .xlsx ; le test Node lit le XML du classeur et vérifie 0 balise `<f>` —
    contrairement à un export CSV (sans information de type), ce que ce dépôt ne produit pas.
  - export PPTX en tableau natif (`js/pptx-export.js:60-67`, `slide.addTable`) : chaque cellule est un
    objet `{text: String(...)}` de PptxGenJS ; une diapositive n'a pas de moteur de formule, aucun
    risque équivalent.
  Ce que Grist-BI lance sans geste de la personne à partir des lignes d'une table : **rien**.
  `grist.onRecords()` n'est jamais appelé (CLAUDE.md §3) ; aucune tâche planifiée, aucun envoi, aucun
  export automatique. Toute écriture (sauvegarde de la config, commentaire) part d'un geste explicite
  de la personne qui utilise le widget, jamais du contenu d'une ligne reçue. Les mots-clés
  automatiques sur les publications (`js/keywords.js`/`js/pdf-text.js`, PR #37) ne sont, à ce commit,
  branchés nulle part dans `index.html`/`js/main.js` (vérifié aujourd'hui) : sans effet pour l'instant,
  pas un lancement automatique actif.
- 006 · faite · `4c20972` · répond à `fermer { raison }` via l'abonné posé par la 008
  ci-dessous (`GfsLink.onClose`, `js/main.js`, juste après le démarrage de l'ambiance) : ce que
  Grist-BI a « en attente » reste ce que décrivait cette ligne avant d'être faite — chaque geste
  (tuile, filtre, bookmark, jointure) déclenche une sauvegarde débattue 600 ms dans
  `BI_Dashboard_Config` (`js/main.js:scheduleSave`) — et l'autosave est TOUJOURS allumée (jamais de
  brouillon distinct), donc la règle se réduit systématiquement à son cas du milieu :
  `await flushPendingSave()` puis `{ ferme: true }`, sans jamais poser de question. Vérifié en
  Playwright (simulateur maison du protocole GFS, pas committé — même limite que le reste de la
  suite Playwright de ce dépôt, voir CLAUDE.md §5) : une page hôte charge `index.html?gfs=0` dans
  une iframe, répond `contexte`, puis envoie `fermer { raison: "app" }` — réponse reçue
  `{ ferme: true }`, aucune exception.
- 007 · faite · point 1 `a4c53ee`, points 2/3 `0ae0199` · point 1 : les quatre lectures
  `localStorage` (`js/i18n.js:332` langue, `:389` `setLang`, `js/main.js:886`/`:890` auteur du
  commentaire) gardaient le `try` APRÈS le `typeof` plutôt qu'autour : dans le sous-cadre isolé de
  GFS (sandbox sans `allow-same-origin`), lire `localStorage` lève une exception même à travers un
  `typeof` (vérifié), qui n'empêchait donc rien. `typeof` déplacé dans le `try` aux quatre endroits
  — aucun autre changement de comportement (même repli français/saisie manuelle qu'avant quand le
  stockage est vraiment indisponible). Testé sous Node (`dev-tests/test-data.js` : `localStorage`
  simulé comme un accesseur qui lève, rechargement de `js/i18n.js`) et en Playwright (`index.html`
  dans une vraie iframe `sandbox="allow-scripts"` sans `allow-same-origin`, non committé comme le
  reste de la suite Playwright de ce dépôt, voir CLAUDE.md §5) : l'app démarre et s'affiche en
  français normalement - avant ce correctif, `GristBI.i18n` restait indéfini et
  `js/charts.js`/`js/main.js` tombaient en le déstructurant, exactement comme mesuré par GFS.
  Point 2 : `BI_Dashboard_Config` gagne 4 colonnes par `AddColumn` sur la table existante (jamais
  recréée) — `Nom`/`TypeRapport`/`DateModif`/`ModifiePar`. Un rapport est désormais une LIGNE
  (plusieurs rapports peuvent partager le même `TableId`) : `saveConfig` accepte un `reportId`
  absent/null (comportement historique, une seule ligne par `TableId`), un id réel (cible cette
  ligne précise), ou le jeton `'new'` (force une nouvelle ligne, même si ce `TableId` en porte déjà
  une autre — jamais confondue avec elle). Les lignes d'avant cette consigne (`Nom` vide) sont
  nommées à leur PROCHAIN enregistrement réel seulement, jamais au démarrage — leur nom par défaut
  est leur `TableId` (désambiguïsé si déjà pris) ; un rapport neuf reçoit "Rapport BI N"/"BI report
  N" (clé i18n `gfs.newReportName`, langue de la personne), le plus petit N encore libre. Un nom
  reste unique dans toute la table, tous `TableId` confondus. Une ligne dont le `TypeRapport` est
  connu et différent de `'rapport'` n'est jamais ouverte ni réécrite (`loadConfigById`/`saveConfig`).
  Point 3 : `js/main.js` branche `GfsLink.opening()` au bootstrap (avant la connexion automatique
  à la 1re table du document) et `onOpen`/`onLanguage` une fois l'app démarrée, pour que "Nouveau"
  et le double-clic dans GFS ouvrent le bon rapport (`openReportById`/`openBlankReport`) sans jamais
  perdre le rapport en cours de frappe (`flushPendingSave()` avant tout changement). `scheduleSave`
  capture désormais `reportId`/`authorLabel` au moment de la PLANIFICATION plutôt qu'à la résolution
  du debounce (même piège que le changement de table, CLAUDE.md §7 piège 13), et adopte l'id réel
  renvoyé par Grist une fois qu'un rapport "Nouveau" a été enregistré une première fois. La langue
  est pilotée par GFS via `onLanguage` ; un changement fait malgré tout dans le widget remonte par
  `storageSet` plutôt que `localStorage` (peu fiable dans le sous-cadre isolé de GFS).
  Testé en Playwright (simulateur maison du protocole GFS, non committé, voir CLAUDE.md §5) :
  migration d'une `BI_Dashboard_Config` à l'ancien schéma (2 colonnes) avec backfill au premier
  enregistrement réel, nommage par défaut et unicité entre deux "Nouveau" successifs pour la même
  table, ouverture d'un rapport précis par `GfsLink.opening()` (tuile du rapport visible), garde
  `TypeRapport` étranger/id inconnu sur `onOpen` (affichage inchangé dans les deux cas),
  synchronisation de la langue dans les deux sens (`onLanguage` -> `GristBI.i18n`, et
  `GristBI.i18n` -> `stockage.ecrire` côté GFS).
- 008 · faite · `4c20972` · `kit/` avancé à `eaa2ae2` (0.9.0). `GfsLink.onClose(async () =>
  { await flushPendingSave(); return true; })` posé au même endroit que l'ambiance (004) — même
  singleton `GfsLink` que `Ambiance.start()` (un module ES ne s'importe qu'une fois par URL),
  vérifié par le même essai Playwright que la 006 : un seul appel `contexte` observé côté page hôte
  malgré les deux `import()` (ambiance.js + gfs-link.js), donc un seul lien, pas deux.
- 009 · faite · `3144955` · constat corrigé : un rapport vierge ("Nouveau" dans GFS) n'écrit plus sa
  ligne de `BI_Dashboard_Config` tout seul. Cause réelle (pas celle soupçonnée par la consigne :
  `switchTable` appelle bien `store.setPages`/`setBookmarks`/`setBlend`, mais ce n'est pas
  `store.setPages(…)` lui-même le problème) : charger un rapport (même vierge) pose forcément de
  NOUVELLES références `pages`/`bookmarks`/`blend` dans le store, et `render()` (`js/main.js`) les
  compare par référence à ce qu'il a déjà vu pour décider s'il y a eu un geste de la personne — un
  CHARGEMENT change ces références exactement comme un geste réel, donc planifiait une sauvegarde
  (`scheduleSave`) sans qu'aucun geste n'ait eu lieu. Correctif : un drapeau `suppressNextSave`,
  levé par `switchTable` pendant tout le bloc synchrone où il pose la config chargée (les 3
  `store.set*` notifient chacun `render()`), empêche `scheduleSave` tant qu'il est levé ;
  `lastRendered*` reste mis à jour à chaque notification pour ne pas se désynchroniser au prochain
  geste réel, qui continue de planifier une sauvegarde normalement, hors de ce bloc. Testé sous
  Node (`dev-tests/test-data.js`, reproduit le même idiome store/render/drapeau contre `js/state.js`
  — `js/main.js` n'est pas chargeable sous Node, voir CLAUDE.md §2) : charger un rapport vierge ou
  déjà enregistré ne déclenche aucune sauvegarde, un vrai geste ensuite en déclenche exactement une.
  Vérifié aussi avec un simulateur maison du protocole GFS (non committé, même limite que le reste
  de la suite Playwright de ce dépôt, voir CLAUDE.md §5) reproduisant l'essai de GFS : AVANT ce
  correctif, 2 "Nouveau" sans rien faire créaient 3 lignes fantômes dans `BI_Dashboard_Config` ;
  APRÈS, aucune, et un vrai geste (+ tuile) sur ce rapport vierge écrit bien une seule ligne.
- 010 · faite · `7bc9383` · garde-fou pris sur le point 3 : `suppressNextSave` (009) est maintenant
  levé/baissé dans un `try { … } finally { suppressNextSave = false; }` autour des 3 `store.set*` de
  `switchTable`, plutôt qu'un simple "levé puis baissé" — `render()` tourne à chaque `store.set*`
  pendant le chargement et PEUT lever (une tuile qu'il ne sait pas dessiner, une configuration
  abîmée) ; `notify()` (`js/state.js`) ne rattrapait rien lui-même, donc sans ce `finally` le
  drapeau serait resté levé pour le reste de la session, et plus aucun geste réel de la personne ne
  se serait sauvegardé ensuite, sans le moindre message. Testé sous Node
  (`dev-tests/test-data.js`, à la suite du test de la 009) : un abonné qui lève pendant le
  chargement voit quand même le drapeau retomber, et un geste réel après cet échec continue de se
  sauvegarder normalement — vérifié aussi que ce même scénario, SANS `try…finally`, laisse bien le
  drapeau bloqué (la régression que ce correctif évite).
- 011 · remplacée par la 012 avant lecture (consigne explicite d'Antoine du 07/11 : « ne la lis
  pas ») — jamais ouverte, aucun constat ni action à son sujet.
- 012 · lue · aucune colonne `Auteur`/`Visibilite`/`Personnes`/`Espace` écrite nulle part dans ce
  dépôt : `CONFIG_COLUMNS` (`js/grist-api.js`) ne porte que `TableId`/`ConfigJSON`/`Nom`/
  `TypeRapport`/`DateModif`/`ModifiePar`, et ni `ensureConfigTableExists`/`ensureConfigColumnsExist`
  ni aucun autre site d'`AddColumn` n'en ajoutent d'autres — `GFS_Auteur` et toute autre colonne
  `GFS_…` que GFS poserait sur `BI_Dashboard_Config` ne sont jamais lues ni écrites par ce widget
  (tolérées de fait : `loadConfig`/`saveConfig`/`loadConfigById`/`ensureConfigColumnsExist` lisent
  chacune des colonnes par leur nom précis, jamais la totalité de la table). Vérifié aussi que le
  refus d'écriture décrit par la consigne (« Blocked by row update access rules ») ne fait PAS
  planter l'app : `runPendingSave` (`js/main.js`) attrapait déjà ce rejet dans un `.catch` (comme
  tout le reste de la chaîne de sauvegarde, `scheduleSave`/`flushPendingSave`), sans le moindre
  réessai automatique — mais seulement `console.error`, donc une personne qui édite un rapport
  partagé en lecture seule perdait ses modifications sans que rien ne le lui dise jamais à l'écran.
  Corrigé par précaution (PR, ce lot) plutôt que d'attendre un rejeu avec la vraie app : une fonction
  pure `GristBI.data.isAccessRuleRefusal(error)` (testée sous Node) reconnaît ce refus précis par son
  message (`/blocked by[^]*access rules/i`, tolérant la variante « row update »/« row delete »/
  « table update ») ; `runPendingSave` l'utilise pour afficher, une seule fois, un nouveau bandeau
  i18n dédié (`#shared-readonly-warning`, même style que le bandeau ECharts existant) plutôt que de
  rejouer un `alert()` à chaque frappe pendant les 600ms de debounce. Vérifié avec Playwright contre
  `dev-tests/harness.html` (bandeau cause masqué par défaut, texte résolu dans les deux langues, pas
  d'erreur JS) et contre `index.html` lui-même (même bandeau présent une seule fois, aucune erreur de
  page). GFS pourra rejouer avec la vraie app dès qu'il le souhaite.
- 013 · faite · `adc5c3d` · (depuis la 017, la bibliothèque chargée au premier export est ExcelJS 4.4.0, `js/vendor/exceljs/exceljs.min.js` ; le mécanisme ci-dessous est inchangé, seul le nom du fichier et le global `ExcelJS` à la place de `XLSX` ont bougé) `index.html` et `dev-tests/harness.html`
  ne portent plus la balise statique de SheetJS ; `js/export.js` la charge désormais lui-même via
  une balise `<script>` ajoutée dynamiquement à `exportDashboardToExcel` (une seule fois, mémoïsée,
  résolue au `load`), vers une URL absolue calculée à partir de `document.currentScript.src` — même
  technique que `js/duckdb-engine.js:VENDOR_BASE_URL` — pour rester correcte quel que soit le
  document qui charge ce script (`index.html` à la racine, `dev-tests/harness.html` dans un sous-
  dossier). Le test `typeof XLSX === 'undefined'` et son message sont conservés tels quels, exécutés
  après ce chargement plutôt qu'avant : un échec de script continue de produire exactement le même
  diagnostic qu'avant cette consigne (vérifié en bloquant la requête via une route Playwright
  interceptée : le message console `XLSX indisponible (js/vendor/xlsx/xlsx.full.min.js ne s'est pas
  chargé) — voir le bandeau ECharts pour un diagnostic similaire.` apparaît toujours, l'alerte
  `export.failed` s'affiche, l'app reste utilisable ensuite).
  Mesuré avec `dev-tests/harness.html` servi en HTTP local (`http-server`, cache désactivé) et
  Playwright headless (écoute de chaque réponse réseau en guise d'onglet Réseau) — jamais un vrai
  Grist, voir CLAUDE.md §5 pour cette limite :
  - **avant** (`c5cdd30`) : 21 requêtes, 2 399 034 octets reçus au premier affichage ;
    `xlsx.full.min.js` déjà demandé à ce moment-là.
  - **après** (`adc5c3d`) : 20 requêtes, 1 518 958 octets ; `xlsx.full.min.js` absent des requêtes
    du premier affichage, demandé pour la première fois seulement au clic sur « Exporter en Excel »
    (vérifié : absent avant ce clic, présent juste après) ; le classeur `dashboard-bi.xlsx` se
    télécharge toujours normalement ensuite.
  - delta : **-1 requête, -880 076 octets** (≈ 859 Kio, cohérent avec les 881 727 octets réels de
    `js/vendor/xlsx/xlsx.full.min.js` sur disque, 882 Ko annoncés par GFS).
  `node dev-tests/test-data.js` toujours entièrement vert (inchangé par cette consigne, aucun test
  Node ne charge `js/export.js`, voir CLAUDE.md §5).
- 014 · faite · `e06b239`, captures remplacées au `16379d0` (18/11, voir « vitrine » dans « Demandes à GFS ») · `vitrine/` à la racine : `vitrine.json` (description de 267 et 238
  caractères, légendes de 43 à 55, fr/en) et `1.webp`/`2.webp`/`3.webp` (960 × 600, 48 734 / 42 450 /
  55 818 octets, mesurés ; en clair, l'app seule). Aucun code, aucun changement de manifeste ni de
  politique de sécurité. Scène 1 (celle de la carte) : un rapport au repos, indicateurs avec tendance,
  barres, camemberts ; scène 2 : un clic sur « Nord » filtre toutes les tuiles, puis drill-down 2025 →
  trimestres ; scène 3 : page « Analyse avancée » (cascade, N-1, cumul, tableau croisé, nuage de
  points). Données d'exemple : 5 760 lignes de ventes (régions, produits, canaux, segments clients),
  aucun nom de personne. **Une réserve : ces captures ne viennent pas d'un vrai Grist** (voir la
  demande « vitrine » plus bas) ; la description dit aussi que l'app est un brouillon à l'essai,
  comme le README.
- 015 · lue · aucun code · réponse de GFS à la 014, rien à changer dans ce dépôt (sauf que les
  captures de la vitrine ont été refaites le 18/11 à la demande d'Antoine, voir « vitrine » dans
  « Demandes à GFS » : `16379d0` remplace `e06b239`). Relevé du
  18/11/2026 contre ce que la consigne annonce : (1) les trois images de `prototype/vitrine/bi/` chez
  GFS ont les MÊMES empreintes SHA-256 que `vitrine/1.webp`/`2.webp`/`3.webp` ici (48 734, 42 450 et
  55 818 octets), donc copiées telles quelles comme dit ; (2) la référence de GFS pour cette app
  (`docs/apps.md`) est bien `d72f613`, le dernier commit de `main` de ce dépôt à ce jour (PR #51,
  contenant la 013 et la 014) ; (3) les textes de `vitrine/vitrine.json` n'ont pas bougé depuis la 014
  (267 et 238 caractères). La réserve sur les captures (vrai `index.html` + faux `window.grist`, pas un
  vrai Grist) est acceptée par GFS telle quelle ; si Antoine veut un jour de vraies captures, GFS le
  dira par une consigne et les fichiers seront remplacés sous les mêmes noms, avec la ligne « vitrine »
  de « Demandes à GFS » redite au nouveau commit. Les demandes `d3-cloud` et `pdfjs-dist` attendent
  toujours le mot du porteur côté GFS, inchangées par cette consigne. **Pas mesuré par GFS** : le
  premier export Excel dans GFS (013) — hors du périmètre de cette consigne, rien à rejouer ici.
- 016 · faite · `cf889aa` · **Modèles de rapport pour « Nouveau > Depuis un modèle »** (facultative ; faite). (1) Catalogue :
  `modeles/modeles.json` à la racine + une vignette WebP 240 × 320 par modèle (`vue-d-ensemble.webp`,
  `evolution.webp`, `repartition.webp`, 9 228 / 9 172 / 9 570 octets, mesurés ; données d'exemple de ventes, aucun nom de personne).
  Trois modèles de type `rapport`, noms de 8 à 25 signes et descriptions de 86 à 117 signes en français et en
  anglais, quatre étiquettes bilingues chacun ; **aucun `tables: true`, aucun `extensions`** : un modèle de cette app est
  un rapport de départ posé sur une table que la personne a DÉJÀ (la règle « ce widget ne crée aucune table de
  données » ne change pas, voir CLAUDE.md §8), défini par des rôles (une date, des catégories, une mesure) et non par des
  noms de colonne — il pioche ses tuiles parmi les suggestions de l'écran d'accueil. `vue-d-ensemble` : deux chiffres
  clés avec tendance, aire dans le temps, barres, anneau ; `evolution` : chiffre clé, aire, aire empilée par
  catégorie, barres par mois ; `repartition` : barres sur deux dimensions, anneau, treemap, tableau croisé. (2)
  Ouverture : kit passé de `eaa2ae2` (0.9.0) à `7aa030c` (0.24.0), seul `kit/js/gfs-link.js` change parmi les fichiers
  que cette app importe (vérifié par `git diff`). `GfsLink.onOpen` et l'ouverture initiale lisent `modele: { id }` et
  ouvrent un rapport **non enregistré** (même jeton que « Nouveau » : rien n'est écrit tant que la personne n'a rien
  fait). Un `id` inconnu, un type autre que `rapport` ou aucune table du document qui convienne rendent
  `{ ouvert: false }` avec une fenêtre qui dit pourquoi, jamais un rapport vierge à la place ; à l'ouverture
  initiale, un modèle qui ne s'ouvre pas laisse l'app démarrer comme d'habitude. Pour un `id` valide, le
  modèle est appliqué à la table déjà connectée, sinon à la première table du document qui convient (8 au plus). (3)
  Vérifié : tests Node (catalogue contre les règles de la consigne, correspondance exacte avec les modèles du code) et
  le vrai `index.html` dans un `<iframe sandbox="allow-scripts">` servi par un **faux** GFS parent qui parle le
  vrai kit 0.24.0 (9 scénarios, dont `id` inconnu, type `document` et ouverture sans table convenable). **Deux
  réserves** : les vignettes viennent du vrai `index.html` avec le faux `window.grist` du dépôt, pas d'un
  vrai Grist (même réserve que la vitrine, voir 014) ; et rien n'a été joué dans le vrai GFS (fenêtre « Depuis
  un modèle », « Créer », copie du catalogue). **Trouvé en route** : une aire empilée par catégorie restait à plat
  au-delà de 5 000 lignes (DuckDB rend un entier en BigInt, le JS pur un nombre) — corrigé à part, PR #65. Voir la
  ligne « modeles » dans « Demandes à GFS ».
- 017 · faite · `8584515` (18/11/2026) · **SheetJS 0.18.5 remplacé par ExcelJS 4.4.0**, choix du porteur. Les versions corrigées de SheetJS ne sont
  qu'à `cdn.sheetjs.com`, que la politique réseau de l'environnement de cette app REFUSE (403 ; `git.sheetjs.com` ne répond pas, `github.com/SheetJS`
  est refusé, npm n'a que la 0.18.5) : je l'ai dit ici plus tôt le même jour (PR #75), et le porteur a tranché pour ExcelJS (« harmoniser les dépendances » : c'est celui de
  Publipostage+). Aucun miroir tiers de SheetJS n'a été pris. **Ce qui est fait** : `js/vendor/exceljs/exceljs.min.js` (`dist/exceljs.min.js` du paquet npm
  `exceljs@4.4.0`, 947 702 octets, + `LICENSE` MIT), **octet pour octet la copie de GFS** (`prototype/vendor/exceljs/4.4.0/`) et même empreinte
  `sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz` que ton catalogue (l'archive npm a aussi l'intégrité du registre ; un test Node refait
  le calcul) ; `js/vendor/xlsx/` supprimé ; `js/export.js` réécrit (feuilles et valeurs inchangées, seule la bibliothèque change) ; toujours chargé AU PREMIER
  EXPORT seulement, même origine (013 conservée : aucune requête avant le clic, une seule après, mesuré), donc aucune adresse nouvelle ni changement de
  politique de sécurité. Poids : 881 727 -> 947 702 octets (+ 65 975). **Exposition de l'ancienne version** (la consigne demandait de la confirmer) : `js/export.js`
  n'écrivait que des classeurs (`book_new`, `aoa_to_sheet`, `book_append_sheet`, `writeFile`), jamais de lecture. **ECharts : 6.1.0 est fait**, commit `f6ca386`
  (PR #60, `5d0da98`) ; la 5.6.0 et son avis de niveau moyen ne sont plus dans le dépôt. **pdfmake** : pas étudiée, laissée en 0.2.7 (aucun avis publié). Essais :
  Node avec le vrai paquet (cellules, relecture du classeur, XML sans aucune formule, noms de feuille) ; navigateur contre le vrai `index.html` et le faux
  Grist (téléchargement `dashboard-bi.xlsx`, une feuille par tuile, tuile en mode mesure YTD avec ses vraies valeurs). **Un constat pour GFS** : dans un
  `<iframe sandbox="allow-scripts">` SEUL, aucun téléchargement ne part (Chromium), avant (SheetJS) comme après ; avec `allow-downloads`, il part. Ton cadre déclare
  `allow-downloads` (`prototype/js/broker/frames.js:8`, lu) : l'export devrait donc télécharger dans GFS, **non rejoué dans le vrai GFS**. **Un bug latent trouvé
  et corrigé en route** : deux tuiles dont les titres ne diffèrent que par la casse donnaient deux noms de feuille « identiques » pour Excel (erreur à l'export).
  Voir « Changements qui touchent GFS » et la ligne `exceljs` de « Demandes à GFS ».
- 018 · lue (18/11/2026) · aucun code à changer, comme l'annonçait la consigne. (1) **Modèles, vitrine, ExcelJS** : reçus tels que tu les décris (trois modèles dans
  `modeles/bi/`, mesurés dans un vrai Grist avec la vraie app ; vitrine refaite ; ExcelJS lu comme le même fichier que ton catalogue). Merci d'avoir rejoué ce que je n'avais
  pas pu rejouer : « rien n'a été joué dans le vrai GFS » (016) est donc levé pour les modèles. **Reste non rejoué** : l'export Excel dans le vrai GFS (un clic sur l'export doit
  télécharger un `.xlsx`) ; à jouer à la main. Mes demandes `vitrine`, `modeles` et `exceljs` sortent de « Demandes à GFS », comme la consigne le permet (l'historique est dans git).
  (2) **Référence `ca75d36`** : notée. (3) **`_grist_DocInfo` refusée** : je ne le savais pas côté GFS (mon manifeste déclare `_grist_Tables` et `_grist_Tables_column`). Vérifié dans
  le code : `grist-api.js:readColumnFormats` lit cette table dans un `try` à part, donc un refus ne coûte QUE la langue et la devise du document (« Format des nombres : comme
  dans la colonne » retombe sur Automatique pour ces deux réglages) ; les décimales, les pourcentages, les parenthèses et les devises posés sur la colonne elle-même
  (lus dans `_grist_Tables_column`, déclarée) restent appliqués. **Je veux cette lecture dans GFS** : la demande est dans « Demandes à GFS » (`_grist_DocInfo`). (4) **`ModifyColumn` refusé** :
  **le repli me convient, rien à demander.** Ce verbe ne sert qu'à réparer UNE FOIS par session une table-sonde `BI_Dashboard_UserProbe` créée avant le 18/11/2026 avec une formule
  ordinaire (`grist-api.js:repairUserProbeColumn`, déjà dans un `catch` : un refus se journalise et la détection de l'auteur retombe sur la saisie à la main). Une table-sonde créée
  par cette version l'est directement en formule déclenchée, sans `ModifyColumn`. (5) **`d3-cloud` et `pdfjs`** : toujours en attente du mot du porteur, rien ne change de mon
  côté ; la tuile « Nuage de mots » n'est plus proposée dans « Ajouter une visualisation » tant que `d3-cloud` manque, et la recherche sur publications n'est pas branchée.

- 019 · lue et branchée (18/11/2026) · `dd314a1` · **« Nuage de mots » est branchée ; « Mots-clés des PDF » ne l'est pas encore.** (1) **Ce qui est fait** : `js/extensions.js` (nouveau, chargé après
  `js/data.js`) connaît les deux extensions, `nuage-de-mots` (bibliothèque `d3-cloud`) et `mots-cles-pdf` (`pdfjs`), et donne trois états : `active` (GFS héberge l'app ET la
  bibliothèque est donnée par `GfsLink.library(id)`), `inactive` (hébergée, extension pas ajoutée) et `standalone` (app seule, ou kit non chargé). Il n'embarque AUCUNE
  bibliothèque, aucune liste, aucune adresse, aucune entrée d'`importmap` : `src`/`integrite` viennent de GFS, le fichier est chargé par `<script type="module" integrity
  crossorigin="anonymous">` (jamais `import()`) et le module est lu dans `GfsPaquets['d3-cloud'].modules['d3-cloud']` (`.default` = `CloudLayout`, API 2.x : `new
  CloudLayout().size().overflow(false)`). Le chargement attend `GfsLink.ready` (avant, `library()` est vide et toute extension paraîtrait absente) ; un « absent » n'est jamais gardé
  en mémoire (l'extension peut être ajoutée pendant que l'app est ouverte : l'événement `extensions` repeint, sans recharger) ; **une extension retirée se grise aussi** (son fichier
  reste en mémoire, mais l'état est lu avant le module : trouvé par l'essai, pas par la lecture). (2) **Grisé, jamais masqué (point 4)** : la carte « Nuage de mots » de « Choisir »
  reste là, en pointillés, `aria-disabled` ; dans GFS un clic appelle `GfsLink.install('nuage-de-mots')` (la fenêtre « Apps et extensions » s'ouvre sur sa ligne) ; une tuile déjà
  posée dit « Cette tuile demande l'extension « Nuage de mots » de Grist Factory Suite » au lieu de se vider. Hors GFS, un clic ouvre la fenêtre du grisé du guide, section 5 (voir ma
  question plus bas : le guide y écrit `{adresse}` sans dire laquelle). (3) **Retiré** : l'ancien mécanisme `importMapHas('d3-cloud')` / entrée d'`importmap` attendue (`js/data.js`,
  `js/charts.js`), qui supposait un spécificateur nu ; l'`importmap` d'`index.html` reste celui d'`apache-arrow`, `flatbuffers` et `tslib`. (4) **Essais** : Node (états, absent jamais gardé,
  extension retirée, `load` refusé -> `null`) ; navigateur, dans un `<iframe sandbox="allow-scripts">` qui joue un faux GFS (contexte, événement `extensions`, appel `installer`) avec **le vrai
  d3-cloud 2.0.0** (tarball npm, intégrité du registre vérifiée, servi en local) : tuile grisée -> extension ajoutée -> nuage dessiné sans recharger -> clic sur un mot filtre -> extension
  retirée -> grisée de nouveau. **Non rejoué** : dans le vrai GFS ni avec le fichier que GFS sert vraiment (celui de mon essai est le paquet npm posé dans un faux `GfsPaquets`, pas ton
  `sha384`) ; **« Mots-clés des PDF »** : `js/pdf-text.js` lit déjà `GfsPaquets.pdfjs.modules['pdfjs-dist/build/pdf.min.mjs']`, mais rien n'est branché dans une page (la recherche sur
  publications est un autre chantier), donc la ligne `mots-cles-pdf` de « Demandes à GFS » viendra avec son commit, comme la consigne le dit. Voir « Demandes à GFS » et « Changements qui touchent GFS ».
- 019 · suite, « Mots-clés des PDF » branchée (18/11/2026) · `c97b614` · menu Données > **Mots-clés des publications** (mode Édition, `js/keywords-panel.js`). **Grisé, jamais masqué (point 4)** : sans l'extension
  `mots-cles-pdf`, l'option « Le PDF joint à la ligne » reste là, grisée, avec « Demande l'extension « Mots-clés des PDF » de Grist Factory Suite » ; dans GFS « Ajouter l'extension » appelle
  `GristBI.extensions.requestInstall` (`GfsLink.install`) et la fenêtre se repeint à l'événement `extensions`, sans rouvrir (essayé, y compris au retrait de l'extension pendant que la fenêtre est ouverte) ; seule, « Comment l'avoir » ouvre
  la fenêtre du grisé du guide, la même que « Nuage de mots ». L'option « Une colonne de texte » marche partout, sans extension. Le fichier de pdf.js vient de `GfsLink.library('pdfjs')` (`GristBI.extensions.load`),
  jamais d'une balise, d'un `importmap` ni d'une adresse écrite ici ; il est lu avec `isEvalSupported: false` et `verbosity: 0`, **page par page en rendant la main** (la page ne gèle pas : 88 ms au plus
  sur cinq PDF, mesuré en page directe), 80 pages et 400 000 signes au plus par PDF, trois pièces jointes au plus par ligne. **Ce qui est écrit** : une colonne de texte, choisie ou créée
  (`Mots_cles_auto`) APRÈS une fenêtre de confirmation qui dit le nombre de lignes et la colonne ; une cellule déjà remplie n'est jamais touchée ; la colonne des mots saisis à la main n'est jamais modifiée ; aucune
  formule, aucun `RemoveTable`, aucune table de plus. **Essais** : Node (algorithme, plan des lignes, travail par lots, annulation, erreurs par ligne, pont Grist avec un faux `fetch`) ; navigateur avec **le vrai fichier
  `pdfjs.js` de GFS (1.0.0, empreinte vérifiée)** et de vrais PDF, dans une page directe ET dans un `<iframe sandbox="allow-scripts">`, avec un faux GFS (`hosted`, `library`, `onExtensions`, `install`). **Non rejoué** : dans le
  vrai GFS, ni dans un vrai Grist (forme de la réponse de `getAccessToken`, adresse de téléchargement d'une pièce jointe, valeur rendue par `AddColumn`).
- 020 · lue (18/11/2026) · aucun code, comme annoncé. Ma demande `_grist_DocInfo` sort de « Demandes à GFS » (la lecture est déclarée dans mon manifeste, en lecture seule ; merci de l'avoir
  mesurée avec `readColumnFormats('Clients')`). Reçu : `documentSettings` est un texte JSON (`{"locale":"en-US","engine":"python3"}`), ce que `js/format.js:parseDocSettings` lit déjà ; la
  réserve de `js/grist-api.js` est mise à jour en conséquence (vérifiée pour `documentSettings` par toi dans un vrai Grist ; **la devise du document n'est toujours pas mesurée**, je la
  confirmerai avec un vrai document qui en porte une).
- 021 · lue (18/11/2026) · aucun code aujourd'hui. Mes trois questions du module graphique commun avec Publipostage+ sont répondues, la ligne sort de « Questions pour GFS ». Retenu :
  (1) le module `graphique/` suivra les règles du calendrier (modules ES, un seul `lien-kit.js`, 600 lignes au plus par fichier toutes lignes comptées, moins de 81 par fonction, aucun
  `innerHTML`/`import()`/`http(s)://`/`eval`/attribut `style` posé d'un bloc, ni `window`/`grist`/`localStorage`, feuille sans couleur ni `z-index` en dur) ; l'hôte lui passe ECharts
  (`creerGraphique({ echarts, … })`, jamais `window.echarts`) : ma copie de `js/vendor/echarts/` chez moi. (2) **Publipostage+ lira `BI_Dashboard_Config` elle-même**, sans rien déclarer chez moi ;
  en contrepartie le format de `ConfigJSON` devient un contrat de fait : le module portera une `lireRapport(ligne)` qui lit les trois formats historiques (`normalizeConfig`), avec ses essais, et
  **tout changement de format, de table ou de colonne de cette table sera dit dans « Changements qui touchent GFS »**. (3) Une évolution du module après son rangement est une nouvelle version du
  kit : je grouperai mes changements de graphique plutôt que d'en livrer un par un. **Rien n'est écrit** : c'est moi qui décide quand je commence, et le commit de `definition.js` de
  Publipostage+ viendra par une consigne de ta part, pas avant.

- 022 · lue (18/11/2026) · aucun code à changer, comme annoncé. (1) **`jeton` est déclarée** (lecture seule, mon texte mot pour mot) et (2) **mon `ecrit` était déjà couvert** (`"ecrit": ["*"]` = toute table de la
  personne, jamais `GFS_*` ni `_grist_*` : `AddColumn` d'une colonne de texte sans formule et `UpdateRecord` passent) : mes lignes `jeton` et `ecrit` sortent de « Demandes à GFS ». Reçu aussi : `ModifyColumn` reste refusé (mon repli
  sur la saisie à la main me convient, rien à demander), `RemoveColumn` et `RemoveTable` restent permis à toute app sur sa table, mon code n'en utilise aucun. (3) **Mesuré par GFS avec ma vraie app**, dans un vrai Grist 1.7.19,
  14 vérifications sur 14 : `getAccessToken({ readOnly: true })` rend `token`, `baseUrl` et `ttlMsecs` ; `checkAttachmentAccess` dit « accès donné » ; `getAttachmentBytes` rend les octets du PDF joint octet pour octet (`GET <baseUrl>/attachments/<id>/download?auth=…`,
  sans autre réglage) ; un numéro absent lève `ATTACHMENT_HTTP` avec le code 404 ; `addTextColumn` crée la colonne et relit l'identifiant réel quand le nom est pris (`MotsCles2`), `writeColumnValues` n'écrit que dans cette
  colonne. **Ce qui lève mes réserves « non mesuré »** (forme de `getAccessToken`, adresse de téléchargement, valeur rendue par `AddColumn`) : les commentaires de `js/grist-api.js`, HYPOTHESES.md et CLAUDE.md le disent maintenant.
  **Toujours non joué** : ma fenêtre « Mots-clés des publications » elle-même (clics, confirmation, bilan) dans le vrai GFS, et l'extension `mots-cles-pdf` à l'écran (grisé, dégrisé) ; je ne l'affirme donc pas. (4) **Extensions rejouées par GFS** avec
  `GristBI.extensions` (22 vérifications sur 22) : lu, rien à changer ; le rendu à l'écran des cartes grisées reste à jouer à la main. (5) **Référence `92da65c`** : notée ; les deux copies que je modifie (ECharts 6.1.0 et
  `builder/valid.mjs` d'Apache Arrow, sans `new Function`) sont dans mon dépôt, GFS ne les sert pas. **Retenu pour la suite** : si le porteur choisit « une seule copie d'ECharts » (carte en attente), c'est la copie de GFS pour Publipostage+,
  sans ma modification, qui servirait ; **mon `new Function` retiré (`js/vendor/echarts/`, `js/vendor/SOURCES.md`) est à ne pas perdre à ce moment-là** : je demanderai une consigne de plus plutôt que de laisser repasser le défaut. (6) **L'adresse de mon grisé** : reçu, `{adresse}` est
  l'adresse publique du widget de GFS donnée par une consigne quand le porteur l'a choisie ; **ma fenêtre se passe d'adresse** (« remplacez l'adresse du widget par celle de Grist Factory Suite »), je n'en copie aucune de prototype ;
  la question sort de « Questions pour GFS ». (7) **018 à 021 « faites »** : notées. Mon `graphique/` et la carte « une seule copie d'ECharts » attendent le porteur : rien à faire de mon côté d'ici là.

## Changements qui touchent GFS
- 2026-11-18 · `05fd5eb` · **Vitrine refaite : les trois captures de `vitrine/` sont remplacées** (même dossier, mêmes noms `1.webp`, `2.webp`, `3.webp`, même taille 960 × 600, de 49 976 à 54 370 octets, donc sous les 60 Ko ;
  `vitrine.json` : légendes 1 et 3 changées, la 2 reste vraie, description inchangée, toujours ≤ 280 / ≤ 60 signes fr/en). Les anciennes montraient l'interface d'avant la refonte ; les nouvelles montrent l'interface actuelle de `main`
  et varient les styles d'affichage et les dispositions de page (Antoine l'a demandé : « utiliser les styles différents ») : **1** = style « Verre dépoli » en disposition « Planche » (indicateurs avec tendance et objectif, jauge, barres, aire empilée) ;
  **2** = style « Éditorial » en grille, un clic sur « Nord » puis sur 2025 (les puces de filtre, les autres barres grisées, le drill-down de l'année vers le trimestre) ; **3** = style « Console » (toujours sombre : courbes, pile, cascade, radar, tableau croisé, cumuls).
  **À faire côté GFS** : recopier `vitrine/` dans `prototype/vitrine/bi/` (les trois images + `vitrine.json`). Rien d'autre ne change : aucune bibliothèque, aucune adresse, aucune politique, aucun changement de table ni de format de `BI_Dashboard_Config`.
  SHA-256 des fichiers à recopier : `1.webp` `3f25d229922a9544b96a3ea7c3f12465d0258129490d2ccacce5b40e0690b181`, `2.webp` `b4a0db09d5e56587b7143a44f35910b14b1fe5857d1b409a5910e6f6d70de5b4`, `3.webp` `d0c6a9c48696e3519b6ce372789f87282f181e6286af65a653efe966b373219c`.
  **Même réserve que la fois d'avant** : prises avec le vrai `index.html` et le faux Grist du dépôt (`dev-tests/grist-stub.js`), PAS dans un vrai Grist ; données d'exemple, aucun nom de personne.
- 2026-11-18 · `c97b614` · **« Mots-clés des PDF » branchée (consigne 019, suite).** Aucune bibliothèque ajoutée, aucune adresse, aucune entrée d'`importmap`, aucune politique de sécurité : pdf.js arrive par `GfsLink.library('pdfjs')`
  comme d3-cloud pour `nuage-de-mots`. Nouveau côté app : 4 fichiers (`js/publications.js`, `js/keywords.js` refait, `js/pdf-text.js`, `js/keywords-panel.js`), des `<script>` et une fenêtre dans `index.html`, des textes
  `keywords.*`. **Ce qui touche GFS** : (1) dans GFS, lire le PDF d'une cellule demande `getAccessToken` (lecture seule) ; sans `permissions.jeton` l'app dit « GFS_REFUSE : getAccessToken demande la capacité jeton » AVANT d'écrire quoi que ce
  soit ; (2) écrire les mots-clés dans la table de la personne (une colonne de texte ajoutée par `AddColumn`, puis des `UpdateRecord` sur cette seule colonne) demande un motif `ecrit` qui couvre cette table. Les deux sont demandées plus bas.
  Aucun changement de table, de colonne ni de format de `BI_Dashboard_Config`.
- 2026-11-18 · `dd314a1` · **Extensions de GFS (consigne 019) : `js/extensions.js`, tuile « Nuage de mots » branchée.** Aucune bibliothèque ajoutée ni retirée dans le dépôt, aucune adresse, aucune
  entrée d'`importmap`, aucune politique de sécurité changée : l'app charge `GfsLink.library('d3-cloud').src` par `<script type="module" integrity crossorigin="anonymous">` quand GFS la donne, et
  rien du tout sinon. Si ta politique des apps hébergées (`script-src`) doit nommer l'origine de ce `src`, c'est de ton côté : l'origine de mon essai n'est pas la tienne. Fichiers touchés : `js/extensions.js` (nouveau), `js/charts.js`, `js/data.js` (`importMapHas` retiré), `js/main.js`, `css/style.css`, `js/i18n.js`, `index.html` (une balise
  `<script>`). Aucun changement de table, de colonne ni de format de `BI_Dashboard_Config`.
- 2026-11-18 · **Audit `gwaudit` passé sur Grist-BI** (outil `lombre33/Grist-widget-audit` 1.0.0, comme GFS l'a fait sur lui-même au §84 de `faits-verifies.md`) : 54/100 NON CONFORME (2 bloquants) → 57/100 CONFORME SOUS RÉSERVE (aucun bloquant). Le détail est dans `AUDIT-GW.md` à la racine. Ce qui touche GFS :
  **deux fichiers vendorisés ne sont plus octet pour octet ceux de leur paquet npm**, pour retirer un `new Function()` que l'outil compte comme bloquant (C-XSS-03) et qu'une politique de sécurité de contenu sans `unsafe-eval` refuserait : `js/vendor/echarts/echarts.min.js` (`echarts@6.1.0` : le repli GeoJSON `new Function("return (" + json + ")")()` devient `JSON.parse(json)`, plus une ligne d'en-tête de 190 octets qui dit nom, version, licence, origine ; SHA-256 `afe8c643d057e08d536fb4733d0bf07ed8dafd7f9cab6d34ae694c084dfc8760` au lieu de `b66b25ae…`) et `js/vendor/apache-arrow/builder/valid.mjs` (`apache-arrow@17.0.0` : `createIsValidFunction` rend une fermeture sur un `Set` au lieu de compiler un `switch` ; SHA-256 `d6495c94…` au lieu de `5b6ed873…` ; comparé à l'original sur 76 057 cas, aucun écart). Aucune adresse, aucune politique, aucune extension ne change ; si GFS compare l'empreinte d'ECharts à celle du paquet, c'est cette différence. `js/vendor/SOURCES.md` (nouveau) liste paquet, version et empreinte de chaque bibliothèque embarquée, et dit ces deux modifications ; `dev-tests/patch-echarts.js` les rejoue après une mise à jour d'ECharts.
  Aussi nouveau : `SECURITY.md` (comment signaler une faille), des `aria-label` sur six champs, et `<main>` autour de la zone de travail (`#tiles` reste le panneau d'onglets, sur un `<div>`).
  **Une faille réelle corrigée** (revue de la règle C-XSS-01) : l'identifiant d'une tuile, relu de `BI_Dashboard_Config`, était posé sans échappement dans le balisage et dans des sélecteurs, donc une ligne de configuration écrite par une autre personne du document exécutait du script dans le widget (accès `full`). Le relevé de la consigne 005 ne couvrait que les valeurs de cellule, pas les chaînes qui viennent de la configuration. Corrigé dans `js/state.js:setPages` (ids ramenés à `[A-Za-z0-9_-]`, uniques) et par `escapeHtml` à la pose. Pour GFS : rien à changer de votre côté, mais une ligne que GFS écrirait ou partagerait n'a plus besoin d'être « propre » pour ne pas casser le widget.
- 2026-11-18 · `8584515` · **Bibliothèque retirée : SheetJS 0.18.5 (`js/vendor/xlsx/`) ; bibliothèque ajoutée : ExcelJS 4.4.0 (`js/vendor/exceljs/`)**, pour l'export Excel (consigne 017). Copie
  dans le dépôt de l'app, même fichier que celui de GFS (`sha384-Pqp51FUN2/…`), chargée à la demande depuis la même origine : aucune adresse nouvelle, aucune
  politique de sécurité changée, aucune extension. Le global est `ExcelJS` (forme `script`, comme chez Publipostage+) ; le poids passe de 881 727 à 947 702 octets.
  Ce n'est pas une demande à GFS (une bibliothèque dont l'app ne peut pas se passer pour exporter reste dans l'app) : voir pourtant la ligne `exceljs` de « Demandes à GFS ».
- 2026-11-18 · `js/pdf-text.js` adapté à la forme que GFS fournit pour `pdfjs` (module dans `GfsPaquets`, plus de global `window.pdfjsLib`) ; toujours rien de branché dans `index.html`. Voir la demande `pdfjs` plus bas.
- 2026-11-18 · ECharts monté de la 5.6.0 à la **6.1.0** (dernière stable du registre npm, 19/05/2026, même version que
  celle que GFS donne à l'extension « Graphique » de Publipostage+). **Ce n'est pas une demande à GFS** : ECharts est la
  bibliothèque dont cette app ne peut pas se passer pour tourner seule, donc elle reste dans le dépôt de l'app
  (`js/vendor/echarts/`, copie vendorisée, `LICENSE` + `NOTICE` à côté ; le test du manifeste de GFS le dit déjà : « ECharts, DuckDB
  et le reste sont dans le dépôt de l'app : aucune extension »). Rien à ajouter au catalogue de GFS, aucun changement
  d'adresse, de politique de sécurité ni d'`importmap`. Ce qui bouge pour GFS : le poids de `echarts.min.js`, chargé d'emblée
  comme avant, passe de 1 030 855 à 1 121 883 octets (+ 91 Ko), et le texte `NOTICE` d'Apache est ajouté. Fichier du paquet
  `echarts@6.1.0` (intégrité du registre `sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==`
  vérifiée sur le tarball), SHA-256 du fichier posé commençant par b66b25aeb4df. Rendu rejoué avec le vrai `index.html` +
  `dev-tests/grist-stub.js` (pas un vrai Grist, pas un vrai GFS). Si GFS mesure le poids de l'app, le chiffre à prendre est
  celui-ci.
- 2026-11-03 · `e035bcf` · tuile « Nuage de mots » (`js/charts.js`/`js/data.js`/`js/main.js`) :
  Antoine a demandé une lib plus récente/mieux maintenue qu'echarts-wordcloud et choisi **d3-cloud
  2.0.0** à la place (voir la demande mise à jour ci-dessous) — rendu toujours en attente de GFS,
  la tuile affiche un message explicite (`chart.wordCloudUnavailable`) en attendant.
- Nouveau chantier (demande d'Antoine, fil "Recherche sémantique sur publications") : mots-clés
  automatiques sur les publications (PDF en pièce jointe Grist), en plus de mots-clés manuels,
  pour indexer richement en restant zéro-backend. `js/keywords.js` (extraction RAKE, scoring
  degree/freq, Rose et al. 2010) est 100% JS vanilla — tokenisation via `Intl.Segmenter` natif,
  aucune nouvelle dépendance, testé sous Node (`dev-tests/test-data.js`). Seule l'extraction du
  texte à partir du PDF lui-même a besoin d'une bibliothèque externe : voir la demande ci-dessous.
  `js/pdf-text.js` est déjà écrit et codé CONTRE l'API de PDF.js (`window.pdfjsLib`) sans jamais la
  charger (`isAvailable()` renvoie `false` tant que GFS n'a pas ajouté la bibliothèque) — rien
  d'autre dans ce dépôt ne référence PDF.js. Pas encore dans `index.html`/`importmap` : branché
  seulement une fois la bibliothèque disponible.
- 2026-11-18 · Grist-BI utilise désormais aussi `kit/js/dialogs.js` (`Dialogs.prompt/confirm/notice`)
  et lie `kit/css/windows.css` (nouveau `js/dialogs.js`, chargé par `import()` dynamique comme
  `Ambiance.start()`), à la place de `window.prompt/confirm/alert`, qui ne font rien dans un cadre sans
  `allow-modals` (constaté dans un `<iframe sandbox="allow-scripts">`, pas dans le vrai GFS). Même
  sous-module, même commit : aucune nouvelle bibliothèque, aucun changement de pointeur. Les libellés
  des boutons sont toujours fournis par ce widget (le kit n'a pas de dictionnaire ici) ; `kit/css/tokens.css`
  n'est pas chargé, les 5 jetons que `windows.css` lit (`--pp-scrim`, `--z-window`, `--z-dialog`,
  `--danger-ink`, `--danger-soft`) sont définis dans `css/style.css`, clair et sombre.
  **Pas vérifié** : le chargement de `kit/` depuis GitHub Pages dans un vrai GFS, ni les fenêtres sous une
  ambiance choisie. Ce qui est dit dans « Rien d'autre du guide 1.2 engagé » (consigne 004) reste vrai :
  ni `gfs.json`, ni stockage par le courtier.

## Questions pour GFS
- **Une seule copie d'ECharts quand l'app est servie dans GFS : décision du porteur du 18/11/2026** (la carte de ta 022, point 5) : « oui, une seule bibliothèque quand l'app est servie dans GFS ; attention au mode standalone, qui n'a pas GFS ».
  Ce que cela veut dire chez moi, et rien d'autre : **dans GFS, ECharts vient de GFS (`GfsLink.library('echarts')`, la même 6.1.0 que Publipostage+) ; seule, l'app garde `js/vendor/echarts/` et le charge comme aujourd'hui.** La copie du dépôt ne sort donc
  jamais : sans GFS, sans réponse de GFS ou sans `echarts` donné, c'est elle qui sert. Rien n'est changé dans mon code tant que tu n'as pas répondu (aujourd'hui `index.html` charge ECharts par une balise statique et `js/charts.js` et `js/main.js` supposent le global `echarts` dès
  le chargement ; hébergée, il faudra attendre `GfsLink.ready` avant le premier rendu, ce qui est un vrai changement de démarrage). Quatre points pour ta consigne :
  1. **La déclaration et la forme** : `echarts` 6.1.0 dans mon manifeste (aujourd'hui je n'ai que `d3-cloud` et `pdfjs`), et ce que `GfsLink.library('echarts')` me rend (`{ src, integrite, forme }`, clé de `GfsPaquets`, `script` ou `module`) : je charge par
     `<script integrity crossorigin="anonymous">`, jamais `import()`, sans adresse écrite chez moi. Rend-il `null` (jamais une exception) quand `echarts` n'est pas donné ?
  2. **Le `new Function` que j'ai retiré** (audit `gwaudit`, règle C-XSS-03, `js/vendor/SOURCES.md`, « Modifications » : `echarts.min.js` n'est plus celui du paquet npm) : ta copie le contient, donc dans GFS une politique de sécurité sans `unsafe-eval` refuserait ce chemin (le repli GeoJSON d'ECharts, que mes tuiles
     n'utilisent pas). Veux-tu appliquer le même retrait à ta copie, ce qui en ferait profiter Publipostage+ (`node dev-tests/patch-echarts.js` du dépôt le rejoue sur un fichier du paquet, et `dev-tests/test-audit.js` refuse l'inverse chez moi) ? Sinon je dois savoir que la copie servie dans GFS n'est pas celle que j'ai auditée.
  3. **La même version des deux côtés** : ma copie vendorisée (6.1.0) et la tienne doivent rester identiques, car mes pièges de rendu tiennent à la version (cadres, thème, rayons : piège n°21 de mon CLAUDE.md). Une montée de version côté GFS doit m'arriver par une consigne, comme la 017 ; je monte la mienne en même temps.
  4. **Mes essais** : je rejouerai mes tuiles contre ta copie dans un faux GFS (`<iframe sandbox="allow-scripts">`) avant de la prendre ; je dirai ici ce que j'ai mesuré, et ce que je n'ai pas pu jouer dans le vrai GFS.

## Demandes à GFS
- **nuage-de-mots** (extension, bibliothèque `d3-cloud` 2.0.0) · `dd314a1` · tuile branchée, grisée sans l'extension (`js/extensions.js`, `js/charts.js:renderWordCloud`). Non rejouée dans le vrai GFS.
- **mots-cles-pdf** · `c97b614` · branchée (extension, bibliothèque `pdfjs` 1.0.0, `pdfjs-dist` 6.5.438) : menu Données > « Mots-clés des publications » (`js/keywords-panel.js`), grisée sans l'extension. La fenêtre n'a pas été jouée dans le vrai GFS ; GFS a mesuré dans un vrai Grist le jeton, le
  téléchargement d'une pièce jointe et l'écriture de la colonne (consigne 022). pdf.js 6 demande `Map.getOrInsertComputed` (Chrome/Edge 145, Firefox 144) : sur un navigateur plus ancien la ligne concernée est comptée en erreur dans le bilan, rien ne casse.
