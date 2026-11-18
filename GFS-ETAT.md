# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-18 (demande `pdfjs-dist` corrigée : GFS porte déjà cette bibliothèque en module ; ECharts 6.1.0 noté dans « Changements qui touchent GFS » ; consigne 016 faite ; consigne 017 lue, PAS faite (SheetJS : la dernière version est inatteignable d'ici, voir « Questions pour GFS »), `consignes/bi/INDEX.md` à `24d9993` ou plus récent). La
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
  - export Excel (`js/export.js:34`, `XLSX.utils.aoa_to_sheet`) : vérifié empiriquement avec le
    SheetJS vendorisé (`js/vendor/xlsx/xlsx.full.min.js`) — toute valeur venant de `tileExportSheet`/
    `rowsForTile` est typée `t:"s"` (texte) par `aoa_to_sheet`, jamais `t:"f"` (formule) ; une valeur
    commençant par `=`, `+`, `-` ou `@` est donc écrite comme du texte littéral dans le fichier .xlsx,
    jamais réinterprétée comme une formule à la réouverture — contrairement à un export CSV (sans
    information de type, où Excel devine le type à l'import), ce que ce dépôt ne produit pas.
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
- 013 · faite · `adc5c3d` · `index.html` et `dev-tests/harness.html`
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
- 017 · lue · **pas faite** (18/11/2026, rien n'est changé dans `js/vendor/xlsx/`) · SheetJS reste en **0.18.5**.
  **Ce qui bloque** : les versions corrigées ne sont qu'à `cdn.sheetjs.com`, et la politique réseau de
  l'environnement où cette app est développée REFUSE cet hôte (réponse 403 à la connexion ; `git.sheetjs.com` ne répond
  pas et `github.com/SheetJS` est refusé aussi). Le registre npm est joignable mais n'a que la 0.18.5
  (`dist-tags.latest`, relevé le 18/11). Je n'ai pas pris de copie « miroir » d'un tiers sur npm : sans pouvoir la
  comparer à l'archive officielle, ce serait changer de provenance pour un correctif de sécurité, sans que le porteur ait
  tranché. **Exposition relevée dans mon code** (la consigne demande de la confirmer) : `js/export.js` n'appelle que
  `XLSX.utils.book_new`, `aoa_to_sheet`, `book_append_sheet` et `XLSX.writeFile` ; aucun `XLSX.read`/`readFile` nulle part
  dans `js/` (hors `js/vendor/`), aucun format de cellule posé, aucune valeur de format venue d'un fichier. Les deux avis
  visent surtout la LECTURE d'un classeur (pollution de prototype, expression régulière sur les formats) : le chemin
  d'écriture de cette app, dont les données viennent de la table de la personne, ne les touche pas à ma lecture du code
  (à confirmer en lisant les avis, pas un audit). **Quatre issues, au choix du porteur** : (1) le porteur dépose
  l'archive de `cdn.sheetjs.com` (`dist/xlsx.full.min.js` + sa licence), je la vendorise au même nom et au même
  endroit, je rejoue l'export, et la 017 passe à « faite » ; (2) le porteur autorise `cdn.sheetjs.com` dans le réseau de
  l'environnement et une prochaine session le fait ; (3) passer à ExcelJS 4.4.0 (celle que GFS sert déjà à
  Publipostage+, sans avis publié, joignable sur npm) : réécriture de `js/export.js` (écriture asynchrone, tout le
  classeur reconstruit) — un chantier plus lourd que remplacer le fichier, donc proposé, pas choisi ; (4) attendre en
  0.18.5. **ECharts** (demandé par la 017) : **6.1.0 est fait**, commit `f6ca386` (fusionné dans `main` par la PR #60,
  `5d0da98`), `js/vendor/echarts/echarts.min.js` annonce `version:"6.1.0"` ; la 5.6.0 et son avis de niveau moyen
  (GHSA-fgmj-fm8m-jvvx) ne sont plus dans le dépôt. **pdfmake** : pas étudiée, laissée en 0.2.7.

## Changements qui touchent GFS
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
- **017 · SheetJS** : comment obtenir la dernière version ? `cdn.sheetjs.com` est refusé par la politique réseau
  de l'environnement de cette app (voir l'entrée 017 plus haut). Si GFS peut déposer l'archive (avec son empreinte
  SHA-256 relevée chez lui) ou si le porteur la fournit, je la vendorise tout de suite ; sinon le porteur choisit
  entre autoriser l'hôte, ExcelJS 4.4.0 ou attendre.

## Demandes à GFS
- **`modeles`** · `cf889aa` · `modeles/modeles.json` · mes modèles de départ pour « Depuis un modèle » :
  trois rapports (`vue-d-ensemble`, `evolution`, `repartition`), chacun avec sa vignette WebP à côté
  (`modeles/<id>.webp`). **`ouverture.modele`** : oui, cette app sait ouvrir un modèle (kit 0.24.0, `7aa030c`) ; un
  `id` inconnu ou un type refusé rend `{ ouvert: false }`. Aucune table créée, donc pas de `tables`. Même
  réserve que `vitrine` sur les images : prises avec le vrai `index.html` et le faux `window.grist` du dépôt,
  pas dans un vrai Grist (la consigne 016 demandait un vrai Grist). Si tu veux de vraies vignettes, dis-le : elles seront
  refaites sous les mêmes noms de fichier. Le commit `cf889aa` contient le catalogue, ses vignettes et le code qui
  les ouvre.
- **`vitrine`** · `16379d0` · `vitrine/vitrine.json` · description et trois captures pour la carte et
  la fiche. **Remplacement du 18/11/2026** (Antoine : les deux premières captures se ressemblaient) :
  les trois images sont refaites sous les MÊMES noms (`1.webp` 48 692, `2.webp` 47 250, `3.webp`
  56 654 octets, 960 × 600 ; SHA-256 commençant par 9476e14d87a0, 998720ff24a1, d395d517163b), une page et des
  types de tuile différents par scène : 1 = indicateurs avec tendance, courbe en aire, anneau, barres
  horizontales triées ; 2 = camembert, treemap en drill-down, tableau croisé, nuage de points, avec un
  filtre croisé actif ; 3 = cascade et mesures dans le temps. Dans `vitrine.json`, seules les
  légendes 1 et 3 changent (la 2 reste mot pour mot) ; la description est inchangée. Les images
  actuelles chez GFS (celles du `e06b239`) sont donc à remplacer, et les légendes 1 et 3 à
  redéclarer. Même réserve qu'avant : la consigne demandait des captures « prises dans un vrai Grist ». Le build d'un
  vrai Grist depuis les sources (`git clone` de `grist-core` + `yarn install`) a été refusé dans
  l'environnement de cette session et n'a pas été contourné. Les trois images montrent le VRAI
  `index.html` de ce dépôt, servi en HTTP local, avec le faux `window.grist` du dépôt
  (`dev-tests/grist-stub.js`, préchargé de 5 760 lignes) à la place de l'API Grist : l'interface est la
  même qu'en vrai (même document, même CSS), ce que ce montage ne prouve pas c'est `grist.docApi`.
  Si tu veux de vraies captures, dis-le et elles seront refaites sous les mêmes noms de fichier ; le
  détail de la méthode est dans HYPOTHESES.md (entrée « Vitrine de GFS »). **Reçue par la 015
  (17/11/2026) : GFS prend les captures telles quelles**, rien à refaire tant que GFS ne le demande pas.
- **`d3-cloud`** · version exacte **`2.0.0`** · remplace la demande `echarts-wordcloud` 2.1.0 d'un
  lot précédent (écartée sur demande d'Antoine : dépôt amont sans commit de code depuis fin 2022,
  voir l'historique de cette section dans git) · fonction concernée : `js/charts.js`
  (`placeWordCloud`/`loadD3Cloud`, tuile « Nuage de mots ») · usage en une phrase : calcule le
  PLACEMENT des mots d'un nuage de mots pour visualiser les mots-clés/auteurs les plus fréquents
  d'une colonne, comme le nuage de mots natif de Power BI.
  Choisie le 03/11/2026 : réécrite le 30/10/2026 (4 jours avant cette demande), zéro dépendance,
  tests + types + guide de migration, licence BSD-3-Clause.
  Détail technique pour le choix du build/CDN : **ESM uniquement depuis la 2.x, aucun build UMD**
  (retiré explicitement dans ce lot de version, voir son CHANGELOG — contrairement aux bibliothèques
  déjà demandées jusqu'ici) — `js/charts.js` fait un `import('d3-cloud')` (spécificateur NU, même
  mécanisme que `apache-arrow`/`flatbuffers`/`tslib` dans l'`importmap` d'`index.html`) : attend donc
  une entrée `"d3-cloud": "<url>"` dans cet importmap, pointant vers `build/d3-cloud.js` du paquet
  (champs `unpkg`/`jsdelivr` de son `package.json`, déjà prêt à l'emploi). Export par défaut = la
  classe `CloudLayout` (voir `index.d.ts` du paquet).
  d3-cloud ne fait QUE le placement (pas de rendu ni de clic/survol, contrairement à
  echarts-wordcloud) : ce dépôt dessine lui-même sur un `<canvas>` dédié
  (`drawWordCloud`/`hitTestWordCloud`), déjà vérifié avec un stub écrit à la main reproduisant
  l'API documentée (jamais le vrai paquet, non exécutable dans un navigateur depuis ce sandbox,
  même limite que pour les demandes précédentes de ce fichier).
- **`pdfjs-dist`** · version exacte **`6.5.438`** (dernière stable au moment de la demande,
  03/11/2026, vérifiée sur le registre npm) · fonction concernée : `js/pdf-text.js:extractTextFromPdf`,
  consommée ensuite par `js/keywords.js:extractKeywords` pour les mots-clés automatiques à l'ajout
  d'une publication · usage en une phrase : extraire le texte brut d'un PDF déposé en pièce jointe
  Grist, entièrement côté client, sans jamais envoyer le fichier à un service externe.
  **Correction du 18/11/2026** (relevé dans `lombre33/grist-widget-GFS`) : GFS porte DÉJÀ cette même
  version exacte (`pdfjs-dist` 6.5.438, bibliothèque `pdfjs` 1.0.0, forme `module`, vendorisée, avec son
  worker : `pdfjs-dist/build/pdf.min.mjs` et `pdf.worker.min.mjs`) pour l'extension `lecture-pdf` de
  Publipostage+. La demande se réduit donc à : déclarer une extension de Grist-BI qui s'appuie sur cette
  bibliothèque et dire comment l'app la reçoit. Le texte d'origine ci-dessous (un global
  `window.pdfjsLib`, build UMD) ne correspond PAS à ce que GFS fournit (ESM, pas de global) : à ne pas
  suivre. `js/pdf-text.js` sera adapté dès que la consigne de réponse dit la forme (spécificateur nu
  dans l'`importmap`, comme `d3-cloud`, ou autre) ; il n'est branché nulle part d'ici là. Même réserve
  que GFS le note lui-même : pdf.js 6 veut `Map.getOrInsertComputed` (Chrome/Edge 145, Firefox 144) ;
  sur un navigateur plus ancien l'app dira « mettez-le à jour », rien ne casse.
  (Texte d'origine du 03/11/2026 :) Détail technique pour le choix du build/CDN : le code attend un
  global `window.pdfjsLib` (build UMD classique, ex. `legacy/build/pdf.js` du paquet npm) ET un
  fichier worker séparé (`pdf.worker.js`/`.mjs`) — sans `pdfjsLib.GlobalWorkerOptions.workerSrc`
  configuré vers ce worker, PDF.js échoue silencieusement à l'exécution.
