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
