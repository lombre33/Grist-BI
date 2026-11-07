# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-07 (consigne 010 faite, `consignes/bi/INDEX.md` à `7577d58`).

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

## Changements qui touchent GFS
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

## Questions pour GFS
- aucune

## Demandes à GFS
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
  Détail technique pour le choix du build/CDN : le code attend un global `window.pdfjsLib` (build
  UMD classique, ex. `legacy/build/pdf.js` du paquet npm) ET un fichier worker séparé
  (`pdf.worker.js`/`.mjs`) — sans `pdfjsLib.GlobalWorkerOptions.workerSrc` configuré vers ce worker,
  PDF.js échoue silencieusement à l'exécution ; à couvrir dans la consigne de réponse.
