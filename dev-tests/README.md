# Tests locaux (hors Grist)

## Logique pure (Node, aucune dépendance)

```
node dev-tests/test-data.js
```

Teste `js/data.js` (agrégations, filtrage), `js/state.js` (store, toggle de filtre croisé,
ajout/suppression de tuile) et `js/demo-data.js` (jeu de données de démo, cohérence avec les tuiles
par défaut) sans navigateur ni API Grist.

## Harness visuelle (navigateur, sans document Grist)

`dev-tests/harness.html` charge les mêmes fichiers `index.html`/`css`/`js` que le widget réel, mais
remplace `grist-plugin-api.js` par `grist-stub.js` : un faux `window.grist` qui sert un jeu de
données d'exemple pour la "table liée" (36 lignes : Région × Produit × Mois) et simule
`docApi.listTables` / `fetchTable` / `applyUserActions` (`AddTable`/`AddRecord`/`UpdateRecord`/
`RemoveRecord` — assez pour que `BI_Dashboard_Config` et `BI_Demo_Ventes` fonctionnent en mémoire,
sans persister sur disque).

Ouvrir `dev-tests/harness.html` directement dans un navigateur (double-clic, ou `python3 -m
http.server` depuis la racine du repo puis naviguer dessus) : pas de build, pas de serveur requis.

**Ce que ce mock NE prouve PAS** : le comportement réel de `grist.onRecords`/`grist.docApi` dans un
vrai document Grist (voir `HYPOTHESES.md` à la racine — c'est explicitement un point à valider), ni
le chargement effectif d'ECharts depuis `cdnjs.cloudflare.com` (réseau bloqué dans le sandbox où ce
POC a été développé — testé localement avec une copie npm d'ECharts, jamais commitée ici).
