# Hypothèses, scope et points à valider

Ce document existe pour que ce dépôt reste honnête sur ce qu'il démontre vraiment. À lire avant de
décider si ça vaut la peine de continuer.

## Objectif du POC

Vérifier qu'un widget custom Grist unique peut offrir un sous-ensemble ciblé de ce que Power BI a
et que Grist n'a pas nativement : **cross-filtering entre visuels au clic**, sans pouvoir piloter
d'autres widgets Grist (limite structurelle de l'API widget custom — un widget ne peut pas
déclencher d'action sur un widget voisin indépendant sur la même page). D'où le choix : tout vit
dans une seule instance de widget, avec ses propres tuiles internes.

## Ce qui est implémenté et testé dans ce commit

- **Agrégation/filtrage** (`js/data.js`) : fonctions pures, testées sous Node
  (`dev-tests/test-data.js`) — somme/moyenne/comptage/min/max, regroupement par dimension,
  filtrage par égalité.
- **État du dashboard** (`js/state.js`) : store pub/sub, toggle de filtre croisé (clic = active,
  reclic sur le même point = désactive, clic sur un autre point = remplace), ajout/suppression de
  tuile — testé sous Node.
- **Rendu + cross-filtering réel dans un navigateur** (`js/charts.js`, `js/main.js`) : testé avec
  Playwright + Chromium headless contre `dev-tests/harness.html` (voir ce fichier et
  `dev-tests/grist-stub.js`). Scénario : 3 tuiles (barres/camembert/KPI) sur les mêmes données,
  clic sur une barre → les autres tuiles se filtrent et le KPI change de valeur, reclic → le
  filtre est retiré et le KPI revient à sa valeur initiale. Screenshots générés pendant le
  développement (non commités, régénérables via le test).
- **Un vrai bug trouvé et corrigé grâce à ce test** : la première version de `main.js` faisait
  `tilesContainer.innerHTML = ''` puis reconstruisait toutes les tuiles à chaque changement d'état.
  Les instances ECharts sont mises en cache par id de tuile (`js/charts.js`) ; en détruisant le DOM
  à chaque rendu, une instance déjà créée se retrouvait attachée à un `<canvas>` détaché de la
  page (aucune erreur JS levée, juste un rendu invisible). Dès qu'il y avait plus d'une tuile — ce
  qu'un test manuel rapide n'aurait pas forcément couvert avant plusieurs allers-retours — plus
  rien ne s'affichait. Corrigé par une réconciliation DOM incrémentale (ajout/suppression ciblés,
  pas de destruction des tuiles inchangées). Sans le test Playwright multi-tuiles, ce bug serait
  probablement passé en l'état dans un premier essai réel.
- **Persistance de la config** (`js/grist-api.js`) : reprend le pattern déjà validé dans
  publipostageGrist (table interne créée à la volée via `AddTable`, puis
  `AddRecord`/`UpdateRecord`), plutôt qu'une API non testée ici. Le mock de `dev-tests/grist-stub.js`
  simule ces actions en mémoire pour vérifier le round-trip logique, mais **ne prouve pas** le
  comportement du vrai `grist.docApi` en document réel.
- **Génération de données de démo** (`js/demo-data.js`, `generateDemoData()` dans `js/grist-api.js`) :
  crée/vide/remplit une table `BI_Demo_Ventes` en n'utilisant que des verbes déjà éprouvés
  (`AddTable`, `AddRecord`, `RemoveRecord` — délibérément **pas** `BulkAddRecord`/`RemoveTable`,
  jamais utilisés côté publipostageGrist, donc non éprouvés ici ; voir point 7 ci-dessous). Testé de
  bout en bout avec Playwright contre le mock : génération (120 lignes, 4 tuiles auto-créées),
  cross-filtering sur les données générées, régénération (les tuiles construites par l'utilisateur
  sont conservées, seules les valeurs changent), retour à la table liée. **Deux vrais bugs trouvés
  et corrigés grâce à ce test** :
  1. `.demo-banner { display: flex }` avait la même spécificité CSS que la règle native
     `[hidden] { display: none }` et l'emportait (chargée après) : `.hidden = true` en JS n'avait
     plus aucun effet visuel sur cet élément précis — corrigé par une règle
     `.demo-banner[hidden] { display: none }` plus spécifique.
  2. Le filtre croisé actif restait affiché (et donc appliqué) après un changement de table
     (démo → table liée ou l'inverse), alors qu'il référence une colonne/valeur qui n'a plus de
     sens dans le nouveau contexte — corrigé en réinitialisant le filtre sur changement de table
     (mais pas sur simple régénération des données de la même table, où le garder est voulu).

## Délibérément hors scope pour ce POC (pas juste "oublié")

- **Mesures façon DAX / time intelligence** (YTD, comparaison N-1...) : juste `sum/avg/count/min/max`
  ici. Un vrai langage de mesures est un projet à part entière — voir la discussion d'origine.
- **Drill-down hiérarchique**, **bookmarks/navigation multi-pages**, **mise en forme conditionnelle
  avancée**, **Q&A langage naturel / IA** : non tentés.
- **Moteur d'agrégation performant type DuckDB-WASM** : l'agrégation est un simple `Array.reduce`
  côté client (voir `js/data.js`). Suffisant pour de petits jeux de données, pas benchmarké sur un
  gros volume — piste sérieuse si la perf devient un problème réel (point 4 ci-dessous).
- **Édition d'une tuile existante** (seulement ajout/suppression) — trivial à ajouter si le concept
  tient la route, pas fait ici pour rester sur le cœur (cross-filter + persistance).
- **Glisser-déposer / redimensionnement des tuiles** : grille CSS statique (`auto-fill`), pas de
  réagencement manuel.

## Points à valider en conditions réelles (pas testables depuis ce sandbox)

1. **`grist.onRecords` avec de vraies données** : le mock ne renvoie qu'un seul jeu de lignes une
   fois au chargement. Le vrai widget doit être testé avec des mises à jour live de la table liée
   (édition, filtre Grist appliqué en amont, changement de sélection) pour confirmer que
   `onRecords` se redéclenche comme attendu et que le dashboard se met à jour sans état incohérent.
2. **Volume de données réel** : à partir de combien de lignes l'agrégation client devient-elle
   perceptible ? Pas de réponse depuis ce POC (données d'exemple : 36 lignes) — à mesurer avec un
   vrai document avant de savoir si DuckDB-WASM (ou un pré-agrégat côté formules Grist) devient
   nécessaire.
3. **Chargement d'ECharts depuis `cdnjs.cloudflare.com`** : le réseau de ce sandbox de dev bloque
   les CDN (`cdnjs`, `jsdelivr`, `unpkg`) — seuls `npmjs.org`/`github.com` étaient joignables. Le
   rendu et le cross-filtering ont donc été testés avec une copie locale d'ECharts (installée via
   `npm install echarts` dans un dossier temporaire, jamais commitée), pas avec l'URL CDN réelle
   utilisée par `index.html`. publipostageGrist charge déjà des libs depuis `esm.sh`/`cdnjs` avec
   succès en usage réel, donc le risque semble faible, mais **le tout premier chargement du widget
   depuis GitHub Pages dans un vrai navigateur reste à vérifier** (pas de faux négatif possible
   depuis ici).
4. **Table interne `BI_Dashboard_Config` dans un vrai document** : le mock simule
   `AddTable`/`AddRecord`/`UpdateRecord` en mémoire ; jamais exécuté contre un vrai
   `grist.docApi`. À vérifier : la table apparaît-elle de façon gênante dans les sélecteurs de
   table du document (comme déjà noté pour `Publipostage_*`) ? Le round-trip
   sauvegarde→rechargement fonctionne-t-il tel quel ?
5. **`grist.setOptions`/`grist.setOption`** comme alternative à la table interne : non testé ici
   (le widget sœur publipostageGrist ne l'utilise pas non plus — seulement `onOptions`/`getOptions`
   en lecture). Pourrait simplifier la persistance si cette API existe et fonctionne comme prévu ;
   à vérifier contre la doc Grist à jour avant de migrer dessus.
6. **Redimensionnement du widget dans la mise en page Grist** : `resizeAll()` est appelé après
   chaque changement de tuiles, mais pas sur un `ResizeObserver` du widget lui-même — un
   redimensionnement du panneau Grist (pas juste un ajout/suppression de tuile) n'est pas testé.
7. **Types de colonnes `Numeric`/`Int` dans `AddTable`** : `js/demo-data.js` déclare `Quantite` en
   `Int` et `Montant` en `Numeric`. publipostageGrist n'a jamais utilisé que `Text` dans ses propres
   `AddTable` ; ces deux identifiants de type sont corrects dans le modèle de colonnes Grist à ma
   connaissance, mais **jamais exécutés contre un vrai document** — le mock accepte n'importe quelle
   chaîne sans validation. Si `AddTable` échoue en réel à cause du type, le bouton « Générer des
   données de démo » le signalera (une alerte, `applyUserActions` rejetterait la promesse) plutôt
   que de corrompre des données — mais ça vaut la peine de vérifier au premier essai.
8. **~240 actions (`AddRecord`/`RemoveRecord`) en un seul `applyUserActions()`** lors d'une
   régénération de données de démo (120 suppressions + 120 ajouts au pire cas) : chaque verbe est
   individuellement éprouvé, mais pas ce volume-là en un seul appel. Devrait bien se comporter
   (c'est l'usage normal de `applyUserActions` avec un tableau d'actions), à confirmer en réel —
   notamment le temps de réponse perçu en cliquant sur le bouton.

## Prochaines étapes suggérées

1. Installer ce widget dans un vrai document Grist de test, sur une table avec un volume réaliste.
2. Cliquer sur « Générer des données de démo » en tout premier, pour valider en une fois les points
   4, 7 et 8 (table interne, types de colonnes, volume d'actions) sans dépendre d'avoir préparé une
   table réelle au préalable.
3. Vérifier ensuite les points 1, 3, 6 ci-dessus (nécessitent une vraie table liée).
4. Si le concept tient la route : édition de tuile, un deuxième niveau de filtre simultané,
   `ResizeObserver` sur le conteneur racine.
5. Si la perf devient un problème réel (point 2) : spike DuckDB-WASM avant d'aller plus loin sur
   les mesures.
