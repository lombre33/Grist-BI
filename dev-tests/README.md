# Tests locaux (hors Grist)

## Logique pure (Node, aucune dépendance)

```
node dev-tests/test-data.js
```

Teste `js/data.js` (agrégations, filtrage, tendance, échappement HTML), `js/state.js` (store :
filtres croisés cumulables, drill-down, réorganisation, bookmarks, ajout/suppression/édition de
tuile), `js/demo-data.js` (jeu de données de test de charge, cohérence avec les tuiles par défaut —
fixture de test Node pure, plus chargée par `index.html`/`dev-tests/harness.html`, voir plus bas),
`js/combobox.js` (filtrage/surlignage) et `js/duckdb-engine.js` (échappement CSV/validation des
noms de colonne — la logique pure seulement, voir plus bas pour le moteur SQL réel) sans navigateur
ni API Grist.

## Garde-fous de l'audit `gwaudit` (Node, aucune dépendance)

```
node dev-tests/test-audit.js
```

Ce que l'outil d'audit mesure et qu'une modification peut défaire sans bruit (voir `AUDIT-GW.md`) : chaque champ de
`index.html` a une étiquette, aucun bouton n'est vide, un seul `<main>`, `SECURITY.md` existe, et `js/vendor/SOURCES.md` dit
vrai (empreintes SHA-256 des bibliothèques embarquées).

## Style global des tuiles (Node, aucune dépendance)

```
node dev-tests/test-styles.js
```

`js/styles.js` (registre, passe sur les options ECharts de chaque style, dégradés, couleurs, options d'affichage), `css/dash-styles.css`
(jetons complets en clair et en sombre — un seul bloc pour `console`, toujours sombre —, contrastes, le verre contre sa pire carte
translucide, règles des deux options), le réglage du store (style et options), l'aller-retour de la configuration par le vrai
`js/grist-api.js` (faux `grist`) et le câblage d'`index.html`/`harness.html`. Le rendu à l'écran (cartes, graphiques,
menu Réglages, cadre isolé) se rejoue dans un navigateur : voir `HYPOTHESES.md`.

## Dispositions de page (Node, aucune dépendance)

```
node dev-tests/test-layouts.js
```

`js/layouts.js` (registre et seuils de largeur, largeurs qui remplissent toujours la ligne, plan de chaque disposition pour 0 à 13 chiffres et
0 à 14 graphiques, vedette, Rail avec ou sans colonne de gauche, ordre affiché, cible des flèches ◀ ▶, miniatures), le réglage PAR PAGE du store
(`setPageLayout`, configuration hostile assainie par `setPages`), l'aller-retour de la configuration par le vrai `js/grist-api.js` (faux `grist`),
`css/layouts.css` (trois seuils `@container` égaux à `minWidthOf`, `--lu` = 28 px, règles communes de 640 et de 900 px identiques, jamais de
`min-height`, contrastes AA) et le câblage d'`index.html`/`harness.html`. Le rendu à l'écran (les quatre dispositions en clair et en sombre, avec
chaque style, les seuils de largeur, la stabilité des hauteurs, le mode Édition, la tuile agrandie, le cadre isolé) se rejoue dans un navigateur :
voir `HYPOTHESES.md`. Une feuille `harness.html` à jour demande aussi son `<link>` dans l'en-tête (`sync-harness.js` ne régénère que le corps).

## Harness visuelle (navigateur, sans document Grist)

`dev-tests/harness.html` charge les mêmes fichiers `index.html`/`css`/`js` que le widget réel
(y compris `js/vendor/echarts/echarts.min.js` — ECharts est embarqué dans le repo, plus de CDN
externe), mais remplace `grist-plugin-api.js` par `grist-stub.js` : un faux `window.grist` qui
simule `docApi.listTables` / `fetchTable` / `applyUserActions`
(`AddTable`/`AddRecord`/`UpdateRecord`/`RemoveRecord`/`AddColumn`/`RenameTable`) en mémoire, sans
persister sur disque — un `page.reload()` y perd donc tout, contrairement à un vrai document Grist.
Le widget se connecte automatiquement à la 1re table du document au démarrage (voir
`js/grist-api.js:listAvailableTables`/`js/main.js:bootstrap`) — il ne crée plus lui-même aucune
table de données (retrait de `BI_StressTest`, 2026-10-21, voir CLAUDE.md §1/§3/§7/§8), pas de
"table liée" figée. Ce harnais préremplit le mock avec une petite table `Ventes` de démonstration
(`window.__gristStubPreseed` en tête de `harness.html`) pour qu'un simple double-clic affiche un
dashboard non vide ; pour un volume réaliste (~47 000 lignes), préremplir soi-même via
`js/demo-data.js` dans un script Playwright ad hoc (voir plus bas).

Deux ajouts du faux Grist pour « Mots-clés des publications » (18/11/2026) : `getAccessToken(options)` rend
`{token, baseUrl: <origine de la page>/_stub/api/docs/stub, ttlMsecs, readOnly}` (ou lève une erreur si
`window.__gristStubNoToken` est posé, pour jouer « GFS sans la capacité `jeton` »), et `AddColumn` rend `{colRef, colId}`.
Rien de cela ne prouve la forme réelle de la réponse de Grist (HYPOTHESES.md). L'essai navigateur de cette fenêtre
(scripts Playwright non committés, comme les autres) sert le dépôt par un petit serveur HTTP qui répond aussi aux
téléchargements `/_stub/api/docs/stub/attachments/<id>/download` avec de vrais PDF (reportlab) et au fichier
`prototype/vendor/pdfjs/1.0.0/pdfjs.js` de GFS (son `integrity` sert à `attach` d'un faux lien :
`GristBI.extensions.attach(Promise.resolve({ hosted: true, ready, library, onExtensions, install }))`) ; pour que le cadre
`sandbox="allow-scripts"` (origine `null`) joigne `127.0.0.1`, lancer Chromium avec
`--disable-features=PrivateNetworkAccessForNavigations,PrivateNetworkAccessForWorkers,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks`.

Ouvrir `dev-tests/harness.html` directement dans un navigateur (double-clic) : pas de build, pas de
serveur requis pour l'essentiel des tests. **Exception : `js/duckdb-engine.js`** (moteur SQL
DuckDB-WASM, voir ROADMAP.md Tier 2) utilise `import()` dynamique de module ES, bloqué par CORS sur
`file://` (origine `"null"`) — les tests qui l'exercent réellement (`duckdb-engine-test.js`, dans le
scratchpad de développement, pas committé ici) servent le dépôt via un petit serveur HTTP local
(`http.createServer` de Node, sans dépendance) plutôt que `file://`. Rien de spécifique n'est requis
pour l'usage normal du widget : ce moteur est chargé PARESSEUX (jamais au démarrage), voir sa
documentation en tête de fichier.

**Ce que ce mock NE prouve PAS** : le comportement réel de `grist.docApi` dans un vrai document
Grist (voir `HYPOTHESES.md` à la racine, section "Points à valider en conditions réelles").
