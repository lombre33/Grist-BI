# Tests locaux (hors Grist)

## Logique pure (Node, aucune dépendance)

```
node dev-tests/test-data.js
```

Teste `js/data.js` (agrégations, filtrage, tendance, échappement HTML), `js/state.js` (store :
filtres croisés cumulables, drill-down, réorganisation, bookmarks, ajout/suppression/édition de
tuile) et `js/demo-data.js` (jeu de données de démo, cohérence avec les tuiles par défaut) sans
navigateur ni API Grist.

## Harness visuelle (navigateur, sans document Grist)

`dev-tests/harness.html` charge les mêmes fichiers `index.html`/`css`/`js` que le widget réel
(y compris `js/vendor/echarts/echarts.min.js` — ECharts est embarqué dans le repo, plus de CDN
externe), mais remplace `grist-plugin-api.js` par `grist-stub.js` : un faux `window.grist` qui sert
un jeu de données d'exemple pour la "table liée" (36 lignes : Région × Produit × Mois) et simule
`docApi.listTables` / `fetchTable` / `applyUserActions` (`AddTable`/`AddRecord`/`UpdateRecord`/
`RemoveRecord` — assez pour que `BI_Dashboard_Config` et la table de démo (`BI_Demo_Ventes_v2`,
voir `DEMO_TABLE_SCHEMA_VERSION` dans `js/grist-api.js`) fonctionnent en mémoire, sans persister sur
disque — un `page.reload()` y perdrait donc tout, contrairement à un vrai document Grist).

Ouvrir `dev-tests/harness.html` directement dans un navigateur (double-clic, ou `python3 -m
http.server` depuis la racine du repo puis naviguer dessus) : pas de build, pas de serveur requis.

**Ce que ce mock NE prouve PAS** : le comportement réel de `grist.onRecords`/`grist.docApi` dans un
vrai document Grist, en particulier la persistance à travers un vrai rechargement de page (voir
`HYPOTHESES.md` à la racine, points 1 et 4 — explicitement des points à valider).
