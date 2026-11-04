# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-04, au commit `EN_COURS` (relevé 005, état de la 006).

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
- 005 · faite · lue, aucun code · `EN_COURS` · relevé demandé (contrats 11.6 point 9, 11.9 point 5) de tout
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
- 006 · lue · laissée à faire : répondre à `fermer { raison }` a besoin d'un point d'entrée dans le
  lien avec GFS que Grist-BI utilise — celui du kit (`kit/js/gfs-link.js`, Grist-BI n'a pas le sien,
  voir 004) — et ce point d'entrée n'existe pas encore, même au dernier commit amont du kit
  (`336baf4`, Kit 0.8.0, vérifié aujourd'hui, un cran après `db14544` pris ici) : `receiveCall` n'y
  reconnaît que `ouvrir` et répond `GFS_INCONNU` à tout le reste, et `GfsLink` (gelé par
  `Object.freeze`) n'offre pas de `onClose` équivalent à `onOpen`. Pas un désaccord avec la consigne :
  une dépendance sur le kit (dépôt séparé), pas sur ce dépôt — vérifié que les deux autres apps qui
  utilisent elles aussi la version prête à l'emploi du kit (Automation+, Tuesday ; même consigne
  aujourd'hui) sont elles aussi encore « à faire » ; seule Publipostage+ (son propre `js/gfs-link.js`)
  peut la coder sans attendre le kit. Ce que Grist-BI a « en attente » : chaque geste (tuile, filtre,
  bookmark, jointure) déclenche une sauvegarde débattue 600 ms dans `BI_Dashboard_Config`
  (`js/main.js:scheduleSave`, ligne 1648) ; `flushPendingSave()` (ligne 1668) écrit tout de suite ce
  qui attend et rend une promesse qui ne se résout qu'une fois l'écriture terminée — exactement la
  réponse « enregistrement automatique allumé » du point 2 de la consigne (jamais de brouillon
  distinct dans ce widget, donc jamais la question Enregistrer/Abandonner/Annuler). Dès que le kit
  expose un point d'entrée pour `fermer`, il restera à y brancher `await flushPendingSave()` puis
  `{ ferme: true }`.

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
