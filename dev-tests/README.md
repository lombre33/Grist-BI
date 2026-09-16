# Tests locaux (hors Grist)

## Logique pure (Node, aucune dépendance)

```
node dev-tests/test-data.js
```

Teste `js/data.js` (agrégations, filtrage, tendance, échappement HTML), `js/state.js` (store :
filtres croisés cumulables, drill-down, réorganisation, bookmarks, ajout/suppression/édition de
tuile), `js/demo-data.js` (jeu de données de test de charge, cohérence avec les tuiles par défaut),
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
Le widget se connecte automatiquement à sa table de test de charge au démarrage (`BI_StressTest`,
~47 040 lignes, voir `js/grist-api.js`), pas de "table liée" figée.

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
