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
- **Édition d'une tuile existante** : bouton crayon sur chaque tuile, pré-remplit le formulaire du
  haut (`startEditTile`/`stopEditTile` dans `js/main.js`, `store.updateTile` dans `js/state.js`),
  modifie la tuile **en place** (position dans la grille conservée) plutôt que supprimer+recréer.
  Annulée automatiquement si la tuile éditée est supprimée ou si on change de table pendant
  l'édition. Testé sous Node (`updateTile` — pas de doublon, position et champs non modifiés
  préservés) et avec Playwright (cycle complet : clic crayon → formulaire pré-rempli → soumission →
  tuile mise à jour sans doublon ni changement de position).
- **`ResizeObserver` sur `document.body`** en complément du `window.resize` existant : capte aussi
  un redimensionnement du conteneur de l'iframe du widget qui ne déclencherait pas forcément un
  `resize` de `window` (ouverture d'un panneau latéral Grist, colonne redimensionnée...). Coalescé
  via `requestAnimationFrame` pour éviter des rappels multiples pendant un redimensionnement continu.
- **Tri des tuiles par ordre d'apparition, pas alphabétique** (`js/data.js`, `groupByAggregate`) :
  un vrai bug repéré en relisant les captures d'écran précédentes — "Mois" triait Avril avant
  Janvier. Corrigé en préservant l'ordre de première apparition dans les données plutôt qu'un tri
  sur la valeur affichée. Testé sous Node avec des données volontairement non-alphabétiques.
- **Jeu de données de démo enrichi** : 12 mois (au lieu de 6) × 2 années (2025/2026, avec une
  croissance simulée +12 % en 2026) = 480 lignes (au lieu de 120), plus une colonne `Annee` et une
  5e tuile par défaut (« Montant par Année ») pour l'exploiter. Objectif double : donner du répondant
  à un futur drill-down temporel (Année > Mois), et avancer sur le point 2 ci-dessous (volume réel)
  — testé de bout en bout (480 lignes générées, ordre chronologique des mois correct, croissance
  2026 > 2025 visible sur la tuile Année, ~2s de génération dans le mock).

## Délibérément hors scope pour ce POC (pas juste "oublié")

- **Mesures façon DAX / time intelligence** (YTD, comparaison N-1...) : juste `sum/avg/count/min/max`
  ici. Un vrai langage de mesures est un projet à part entière — voir la discussion d'origine.
- **Drill-down hiérarchique**, **bookmarks/navigation multi-pages**, **mise en forme conditionnelle
  avancée**, **Q&A langage naturel / IA** : non tentés.
- **Moteur d'agrégation performant type DuckDB-WASM** : l'agrégation est un simple `Array.reduce`
  côté client (voir `js/data.js`). Suffisant pour 480 lignes (voir point 2 ci-dessous), pas
  benchmarké au-delà — piste sérieuse si la perf devient un problème réel sur un vrai document.
- **Glisser-déposer / redimensionnement des tuiles** : grille CSS statique (`auto-fill`), pas de
  réagencement manuel.
- **Filtres croisés simultanés** : un seul filtre actif à la fois (cliquer sur un 2e segment
  remplace le premier plutôt que de le cumuler) — un vrai dashboard Power BI permet plusieurs
  slicers actifs en même temps.

## Points à valider en conditions réelles (pas testables depuis ce sandbox)

1. **`grist.onRecords` avec de vraies données** : le mock ne renvoie qu'un seul jeu de lignes une
   fois au chargement. Le vrai widget doit être testé avec des mises à jour live de la table liée
   (édition, filtre Grist appliqué en amont, changement de sélection) pour confirmer que
   `onRecords` se redéclenche comme attendu et que le dashboard se met à jour sans état incohérent.
2. **Volume de données réel** : à partir de combien de lignes l'agrégation client devient-elle
   perceptible ? Le jeu de démo est passé de 120 à 480 lignes sans souci apparent (agrégation
   toujours instantanée en local), mais reste un volume modeste — pas de vraie réponse tant que ce
   n'est pas testé sur un document avec un volume représentatif de l'usage réel visé.
3. **[RÉSOLU] Chargement d'ECharts depuis un CDN externe** : risque flagué ici avant tout test réel
   (réseau de ce sandbox de dev bloquant les CDN, testé uniquement en local) — confirmé chez
   l'utilisateur du widget, avec la cause exacte cette fois : la console navigateur montrait
   `bloquée en raison d'un type MIME ("text/html") incorrect (X-Content-Type-Options: nosniff)` sur
   `cdnjs.cloudflare.com/.../echarts.min.js` — la requête recevait une page HTML (probablement un
   filtrage réseau institutionnel/proxy d'entreprise servant une page de blocage) au lieu du script,
   que le navigateur refuse d'exécuter à cause de `nosniff`. Symptôme observé : tuiles
   barres/camembert visuellement vides **alors que les données étaient bien chargées** (carte KPI
   correcte — elle ne dépend pas d'ECharts, contrairement aux tuiles graphiques). Un garde silencieux
   (`if (typeof echarts === 'undefined') return;`) masquait complètement le problème avant d'être
   corrigé pour afficher un diagnostic explicite (bandeau + message par tuile).
   **Corrigé définitivement en embarquant ECharts dans le repo** (`js/vendor/echarts/echarts.min.js`,
   Apache-2.0, licence incluse) plutôt qu'en cherchant un CDN alternatif qui aurait le même problème
   sur ce type de réseau — même stratégie que publipostageGrist pour ses gros fichiers (polices PDF).
   `dev-tests/harness.html` charge désormais ce même fichier local : la harness est enfin
   **entièrement représentative de la prod** sur ce point (avant, testée uniquement avec une copie
   npm locale non commitée, jamais avec le vrai chemin utilisé par `index.html`). Le bandeau/message
   de diagnostic reste en place en défense en profondeur (utile si le fichier venait à manquer pour
   une autre raison), mais ne devrait plus jamais se déclencher pour ECharts en usage normal.
4. **Table interne `BI_Dashboard_Config` dans un vrai document** : le mock simule
   `AddTable`/`AddRecord`/`UpdateRecord` en mémoire ; jamais exécuté contre un vrai
   `grist.docApi`. À vérifier : la table apparaît-elle de façon gênante dans les sélecteurs de
   table du document (comme déjà noté pour `Publipostage_*`) ? Le round-trip
   sauvegarde→rechargement fonctionne-t-il tel quel ?
5. **`grist.setOptions`/`grist.setOption`** comme alternative à la table interne : non testé ici
   (le widget sœur publipostageGrist ne l'utilise pas non plus — seulement `onOptions`/`getOptions`
   en lecture). Pourrait simplifier la persistance si cette API existe et fonctionne comme prévu ;
   à vérifier contre la doc Grist à jour avant de migrer dessus.
6. **Redimensionnement du widget dans la mise en page Grist** : un `ResizeObserver` sur
   `document.body` a été ajouté (voir plus haut) pour couvrir ce cas, mais un vrai redimensionnement
   du panneau Grist (ouverture d'un panneau latéral, colonne tirée à la souris...) n'a pas encore
   été testé en conditions réelles — seule la logique de coalescing a été vérifiée par lecture de
   code.
7. **[CONFIRMÉ EN RÉEL] Types de colonnes `Numeric`/`Int` dans `AddTable`** : `js/demo-data.js`
   déclare `Quantite` en `Int` et `Montant` en `Numeric`. Confirmé fonctionnel — la table
   `BI_Demo_Ventes` créée chez l'utilisateur montre ces deux colonnes correctement typées avec des
   valeurs numériques.
8. **[CONFIRMÉ EN RÉEL] ~240 actions (`AddRecord`/`RemoveRecord`) en un seul `applyUserActions()`**
   lors d'une régénération de données de démo : confirmé fonctionnel — 120 lignes créées sans erreur
   signalée par l'utilisateur (seul le rendu ECharts, point 3, posait problème).

## Prochaines étapes suggérées

1. ~~Installer ce widget dans un vrai document Grist de test~~ — fait ; ECharts vendorisé
   localement a résolu le seul problème remonté (point 3), confirmé fonctionnel par l'utilisateur.
2. Vérifier les points 1, 4 et 6 ci-dessus (nécessitent respectivement une mise à jour live de la
   table liée, un rechargement du widget pour confirmer la persistance de `BI_Dashboard_Config`, et
   un redimensionnement du panneau Grist).
3. Choisir la prochaine feature structurante — proposées côté discussion produit : filtres croisés
   simultanés (plusieurs slicers actifs à la fois), drill-down temporel (Année > Mois, la donnée de
   démo a maintenant les deux niveaux), ou mise en forme conditionnelle sur les cartes KPI
   (seuil vert/rouge, flèche de tendance). Chacune est un choix de conception à part entière, pas
   juste une ligne de code — à valider avant de s'y lancer plutôt que de trancher seul.
4. Si la perf devient un problème réel (point 2) : spike DuckDB-WASM avant d'aller plus loin sur
   les mesures.
