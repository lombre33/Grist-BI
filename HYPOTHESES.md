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
- **Filtres croisés simultanés** (`js/state.js` : `activeFilters[]` au lieu d'un `activeFilter`
  unique) : cliquer sur des segments de colonnes différentes cumule les filtres (ET), cliquer sur
  un autre segment de la MÊME colonne remplace son filtre, recliquer le retire. Un badge par filtre
  actif, chacun avec son propre bouton de suppression, + « Effacer les filtres » pour tout retirer
  d'un coup. `js/data.js:applyFilters` prend maintenant un tableau plutôt qu'un filtre unique.
- **Mise en forme conditionnelle sur les cartes KPI** (`js/data.js:computeTrend`) : une tuile KPI
  peut déclarer un `trendDimension` (ex. `Annee`) ; la tuile compare alors l'agrégat du groupe le
  plus récent au précédent et affiche un delta en % avec une flèche verte/rouge. Ignore les
  dimensions non numériques et les cas à moins de 2 groupes plutôt que d'afficher un delta absurde.
- **Drill-down (un niveau)** : une tuile bar/pie peut déclarer un `drillDimension` — cliquer sur un
  segment au niveau racine "descend" dans cette dimension pour CETTE tuile (fil d'Ariane cliquable
  pour remonter), sans poser de filtre croisé global sur les autres tuiles. Volontairement limité à
  un seul niveau (pas de hiérarchie arbitraire) : au-delà, c'est un projet à part entière.
- **Deux vrais bugs trouvés et corrigés grâce aux tests de ces trois features** :
  1. `groupByAggregate`/`applyFilters` comparaient les valeurs avec `===`. Un clic ECharts
     (`params.name`) est **toujours une chaîne**, même pour une dimension numérique comme `Annee` —
     `"2025" === 2025` est `false`, donc le drill-down par Année filtrait silencieusement *toutes*
     les lignes (tuile vide, aucune erreur). Corrigé par `data.js:sameValue` (comparaison via
     `String(a) === String(b)`), utilisée à la fois par `applyFilters` et par la mise en surbrillance
     des segments dans `charts.js`.
  2. **[remonté par l'utilisateur, en réel]** `Échec de la génération des données de démo :
     [Sandbox] KeyError 'Annee'`. Cause : `ensureDemoTableExists()` ne crée la table QUE si son nom
     n'existe pas encore — quiconque avait déjà généré la démo avec une version antérieure du widget
     (avant l'ajout de la colonne `Annee`) avait une table `BI_Demo_Ventes` avec l'ancien schéma ;
     `AddRecord` échouait alors côté Grist en tentant d'écrire dans une colonne qui n'existait pas
     réellement. Corrigé en suffixant le nom de la table par un numéro de schéma
     (`DEMO_TABLE_SCHEMA_VERSION` dans `js/grist-api.js`, actuellement `BI_Demo_Ventes_v2`) plutôt
     qu'en ajoutant une logique de migration de colonnes (`AddColumn` n'est pas un verbe éprouvé
     ici) : une ancienne table incompatible est simplement abandonnée (l'utilisateur peut la
     supprimer à la main), une nouvelle est créée avec le schéma courant. Le nom affiché dans le
     bandeau « Mode démo » est maintenant lu dynamiquement plutôt que codé en dur dans le HTML, pour
     ne plus jamais désynchroniser affichage et réalité.
- **Réorganisation des tuiles** (`store.moveTile(id, ±1)`) : boutons ◂/▸ sur chaque tuile,
  désactivés en bout de liste. Testé sous Node (no-op sûr en bout de liste / id inconnu) et avec
  Playwright (déplacement réel, ordre vérifié).
- **Vues sauvegardées (bookmarks)** (`store.saveBookmark`/`applyBookmark`/`removeBookmark`) :
  capturent `activeFilters`+`drillIns` sous un nom, PAS les tuiles (déjà persistées séparément).
  A fait évoluer le format de `ConfigJSON` dans `BI_Dashboard_Config` : `[tuiles]` (tableau brut) →
  `{tiles, bookmarks}` (objet). `grist-api.js:normalizeConfig` gère les deux formats en lecture,
  pour ne pas casser une config déjà sauvegardée par une version antérieure du widget — même classe
  de problème que le schéma de `BI_Demo_Ventes`, réglée différemment ici puisque `ConfigJSON` est un
  blob JSON que je contrôle entièrement (pas de colonnes Grist typées à migrer). Testé sous Node
  (round-trip save/restore, y compris suppression d'un bookmark) et avec Playwright : sauvegarde
  d'une vue avec filtre + drill-down actifs, effacement de l'état courant, restauration via le menu,
  et vérification du round-trip `loadConfig()` (tuiles réordonnées + bookmark) sans passer par un
  vrai rechargement de page (le mock `grist-stub.js` n'a pas de stockage hors mémoire JS — un
  `page.reload()` y perdrait tout, y compris la table de démo elle-même ; appeler `loadConfig()`
  directement teste le même chemin de code sans ce faux négatif).
- **Drill-down à 2 niveaux au-delà de la dimension racine** (`tile.drillDimensions: [niveau1,
  niveau2]`, ex. Année > Mois > Semaine) : `state.js:drillIns` est passé d'un simple
  `{column,value}` à un chemin (tableau), `drillInto` empile, `drillUp(tileId, depth)` remonte à
  une profondeur donnée (fil d'Ariane à plusieurs segments cliquables). Compat conservée avec
  l'ancien format à 1 niveau (`tile.drillDimension`, une chaîne) via `data.js:tileDrillLevels`, pour
  ne pas faire disparaître silencieusement le drill-down d'une tuile déjà sauvegardée. Testé sous
  Node (empilage, remontée partielle, nettoyage) et avec Playwright (3 niveaux réels : clic niveau
  racine → Mois, clic → Semaine, clic au niveau le plus profond → redevient un cross-filter normal
  plutôt que d'essayer un 4e niveau inexistant ; remontée partielle via un segment intermédiaire du
  fil d'Ariane).
- **Jeu de données "test de charge"** (`js/demo-data.js:buildLargeSampleRows`,
  `js/grist-api.js:generateStressData` → renommé `loadOrCreateStressData`, voir plus bas) : ~47 040
  lignes (4 régions × 5 produits × 7 années × 12 mois × 28 jours), table séparée
  (`BI_StressTest_v1`) pour ne jamais perturber la démo rapide. Objectif : répondre concrètement au
  point 2 ci-dessous plutôt que de le laisser en suspens indéfiniment.
  - **Envoi par lots** (`grist-api.js:applyActionsInChunks`, 2000 actions/appel) plutôt qu'un seul
    `applyUserActions()` géant avec ~47 000 actions : un appel unique aussi gros est un pari risqué
    (timeout, limite de payload côté Grist — aucune des deux vérifiable depuis ce sandbox), et le
    découpage donne une progression réelle affichée sur le bouton plutôt qu'une attente opaque.
    Réutilisé aussi pour la démo rapide (chunk assez grand pour que son faible volume tienne en un
    seul lot — aucun changement de comportement observable pour elle, juste un chemin de code commun).
  - **Résultats de perf mesurés** (Node + Chromium headless, PAS un vrai document Grist) : génération
    des 47 040 lignes en ~30ms, 3 agrégations/filtrages combinés en ~30ms (`dev-tests/test-data.js`),
    rendu complet des 4 tuiles en 35-60ms dans le navigateur (`#render-time`, ajouté au bandeau pour
    que ce genre de mesure reste visible sans DevTools). **L'agrégation côté client n'est donc
    manifestement pas le goulot à ce volume** — reste à savoir si l'envoi réseau réel vers Grist (le
    round-trip `applyUserActions`, jamais mesuré ici) pose problème, lui.
- **Connexion idempotente aux tables de démo/test de charge** (`grist-api.js:loadOrCreateTable`,
  utilisé par `loadOrCreateDemoData`/`loadOrCreateStressData` — renommées depuis
  `generateDemoData`/`generateStressData`) : un clic ne (re)crée les lignes QUE si la table n'existe
  pas encore ; si elle existe déjà, se contente de la relire. Change délibérément le comportement
  précédent ("régénérer garde les tuiles, redonne des valeurs neuves") suite à un retour direct :
  renvoyer ~47 000 lignes à Grist à chaque clic de test est un gâchis, surtout si le round-trip
  réseau réel s'avère lent (point juste au-dessus). Si le jeu de données doit changer, le mécanisme
  reste un bump de `DEMO_TABLE_SCHEMA_VERSION`/`STRESS_TABLE_SCHEMA_VERSION` (nouvelle table
  fraîche), pas une régénération en place — plus d'option de régénération manuelle dans l'UI.
  Testé avec Playwright : première connexion crée la table (progression affichée, valeurs
  aléatoires) ; en espionnant `applyUserActions`, une deuxième connexion à la table déjà créée
  n'envoie **aucune** action `AddRecord`/`RemoveRecord` et renvoie des valeurs **identiques** (pas
  régénérées), la rendant nettement plus rapide qu'une création initiale.
- **Cross-filtering PENDANT le drill-down, réglable PAR TUILE** (`tile.drillCrossFilter`,
  `state.js:syncDrillCrossFilters`) : suite à un retour utilisateur (« le drill-down sur 'Montant
  par Année' ne met pas à jour le filtre des autres cartes en passant d'une année à l'autre »),
  vérifié en isolant le calcul (voir plus bas) que le **filtrage était correct** — le comportement
  d'origine (drill-down purement local à la tuile cliquée, cross-filter des AUTRES tuiles
  seulement au niveau le plus profond) est un choix assumé qui reproduit la distinction drill-down
  / cross-filter de Power BI (drill-down sur UN visuel n'y filtre pas non plus automatiquement les
  autres). Pour laisser le choix plutôt que trancher unilatéralement dans un sens ou l'autre, ce
  comportement est maintenant réglable **par tuile** (case à cocher dans le formulaire, visible dès
  qu'un drill-down niveau 1 est choisi) : une tuile avec `drillCrossFilter: true` ajoute, à CHAQUE
  niveau franchi (pas seulement le plus profond), un filtre croisé sur les autres tuiles pour la
  valeur cliquée — `activeFilters` gagne des entrées taguées `fromDrill: true` reconstruites
  entièrement à partir du chemin de drill courant à chaque `drillInto`/`drillUp` (plutôt que
  modifiées une à une), pour rester synchronisées sans risque de désync entre les deux actions.
  Tuile de démo « Montant par Année » activée par défaut pour démontrer la fonctionnalité
  immédiatement. Testé sous Node (empilage/remontée des filtres croisés en fonction du chemin,
  tuile sans `drillCrossFilter` inchangée) et avec Playwright (KPI et tuile Région réagissent bien
  au drill sur Année, badges cumulés Annee+Mois au niveau 2, tout disparaît en remontant à la
  racine, cases à cocher visible/cachée selon le niveau 1 choisi, préremplissage correct à
  l'édition, désactivation effective après édition).
  - **Deux corrections annexes découvertes en implémentant ce réglage** :
    1. `removeTile`/`updateTile` ne nettoyaient pas les filtres croisés (`toggleFilter` ou
       désormais `drillCrossFilter`) posés par une tuile supprimée ou dont le drill-down change de
       forme via édition — un filtre pouvait rester actif sans plus aucune tuile source pour le
       faire évoluer ou le lever, ou référencer un niveau qui n'existe plus (sans fil d'Ariane pour
       le signaler, puisque `tileDrillLevels` serait vide). `removeTile` retire maintenant tout
       filtre `sourceTileId === id` ; `updateTile` réinitialise le drill-down en cours dès que le
       patch touche `drillDimensions` (le formulaire d'édition envoie toujours ce champ, donc
       chaque édition remet la tuile éditée à sa racine).
    2. **[Troisième vrai bug trouvé grâce aux tests, même famille que `.demo-banner[hidden]`
       ci-dessus]** `.field { display: flex }` a la même spécificité CSS que la règle native
       `[hidden] { display: none }` — mais l'emporte cette fois-ci non pas parce qu'elle est
       chargée après (comme pour `.demo-banner`), mais parce qu'une règle AUTEUR l'emporte
       *toujours* sur une règle NAVIGATEUR à spécificité égale, quel que soit l'ordre. Résultat :
       `.hidden = true` en JS sur `dimensionField`/`drillField`/`drillField2`/`trendField` (et
       désormais le nouveau champ cross-filter) n'avait **aucun effet visuel** — le champ restait
       affiché, alors qu'aucun test précédent ne vérifiait la visibilité RÉELLE (seulement l'état
       JS ou les valeurs soumises). Repéré uniquement parce que le test Playwright de cette feature
       vérifie explicitement `isHidden()`/`isVisible()`. Corrigé par `.field[hidden] { display:
       none; }`, qui gagne en spécificité (classe + attribut) plutôt qu'en misant sur l'ordre de
       chargement.
- **Connexion automatique à une table de travail unique, sans bouton** (`main.js:bootstrap`) :
  suite à un retour utilisateur (« quand j'arrive sur la page le widget n'a plus de donnée par
  défaut, il faudrait le plug sur la plage de donnée du stress test par défaut, et on y touche
  plus, ça devient sa table par défaut »), le widget se connecte désormais tout seul, au
  chargement, à la table de test de charge (`BI_StressTest_v1`, ~47 040 lignes) via
  `loadOrCreateStressData()` — plus besoin de cliquer sur un bouton pour avoir un dashboard à
  tester. Les boutons « 🎲 Données de démo »/« 🔥 Gros jeu de données » et le bandeau « Mode démo /
  Revenir à la table liée » ont été retirés de l'UI (`index.html`, `dev-tests/harness.html`,
  `js/main.js`) : il n'y a plus qu'UNE table de travail, plus de bascule entre plusieurs sources.
  `js/grist-api.js:init()` n'appelle donc plus `grist.onRecords()` (la table liée au widget dans
  la page Grist n'est plus consultée du tout pour l'instant — voir point 1 ci-dessous, désormais
  obsolète). Si le schéma doit se complexifier plus tard (colonnes en plus), le mécanisme déjà en
  place suffit sans repasser par un bouton : bumper `STRESS_TABLE_SCHEMA_VERSION`
  (`js/grist-api.js`) crée automatiquement une table fraîche au chargement suivant (même logique
  que `DEMO_TABLE_SCHEMA_VERSION`, voir plus haut) ; un bouton manuel resterait facile à ajouter en
  plus si un déclenchement explicite (sans recharger la page) s'avère utile un jour. Le jeu de
  données de démo « rapide » (`BI_Demo_Ventes_v3`, `loadOrCreateDemoData`, 1920 lignes) reste dans
  le code et testé sous Node, mais n'est plus atteignable depuis l'UI — délibérément conservé
  plutôt que supprimé, au cas où un jeu de données plus petit redevienne utile pour un test rapide.
  Testé avec Playwright : premier chargement de page connecte automatiquement les ~47 040 lignes
  et les 4 tuiles par défaut sans aucun clic, les boutons de génération et le bandeau démo ont bien
  disparu du DOM, et un second appel direct à `loadOrCreateStressData()` (simulant un rechargement
  de page une fois la table déjà créée) ne renvoie aucune donnée à Grist (0 action `AddRecord`).
- **Drill-down manuel à N niveaux** (`js/main.js`, premier item de `ROADMAP.md` Tier 1) : les 2
  `<select>` fixes du formulaire sont remplacés par une UI répétable (bouton « + Niveau »), créant
  dynamiquement un `<select>` par niveau au-delà de la dimension racine, plafonnée à
  `MAX_DRILL_LEVELS = 5` (garde-fou d'ergonomie, pas une limite technique). Effort effectivement
  faible comme prévu par la recherche de faisabilité : `data.js`/`state.js`/`charts.js` géraient
  déjà un tableau `drillDimensions` de longueur arbitraire, seul le formulaire figeait ça à 2
  champs. Ajout au passage d'un garde-fou qui n'existait pas avant (repéré en généralisant à N
  niveaux) : une même colonne ne peut plus apparaître deux fois dans le chemin de drill, ni
  reprendre la dimension racine de la tuile — alerte explicite plutôt qu'une hiérarchie silencieuse
  et incohérente. Testé avec Playwright : progression du bouton « + Niveau » (caché tant que le
  niveau courant est vide, disparaît au plafond), tuile à 4 niveaux persistée et rechargée
  correctement dans le bon ordre à l'édition, garde-fou anti-doublon déclenche bien une alerte et
  n'enregistre pas la tuile, vider le niveau 1 retire en cascade tous les niveaux suivants et
  décoche `drillCrossFilter`.

## Délibérément hors scope pour ce POC (pas juste "oublié")

- **Mesures façon DAX / time intelligence** (YTD, comparaison N-1...) : juste `sum/avg/count/min/max`
  + une tendance simple à 2 groupes (voir `computeTrend`) ici. Un vrai langage de mesures est un
  projet à part entière — voir la discussion d'origine.
- **Mise en forme conditionnelle avancée** (data bars, échelle de couleurs sur les tuiles
  barres/camembert, pas seulement sur les cartes KPI) : non tentée.
- **Q&A langage naturel / IA** : non tenté, hors de portée d'un POC.
- **Moteur d'agrégation performant type DuckDB-WASM** : l'agrégation est un simple `Array.reduce`
  côté client (voir `js/data.js`). Testé jusqu'à 47 040 lignes en local (génération + 3
  agrégations/filtrages combinés en ~30ms, voir plus haut) — **pas de signe que ce soit nécessaire
  à ce volume**. Reste une piste si le round-trip réseau réel vers Grist (jamais mesuré) s'avère
  être le vrai goulot, pas l'agrégation elle-même.
- **Redimensionnement des tuiles** (largeur/hauteur individuelle) : grille CSS statique
  (`auto-fill`), seul l'ORDRE des tuiles est modifiable (`store.moveTile`, voir plus haut).
- **Bookmarks partagés entre tuiles/pages, navigation multi-pages** : les vues sauvegardées
  (voir plus haut) sont un mécanisme volontairement simple (filtres + drill-down d'UN dashboard),
  pas un système de navigation entre plusieurs pages/dashboards.

## Points à valider en conditions réelles (pas testables depuis ce sandbox)

1. **[DEVENU SANS OBJET POUR L'INSTANT] `grist.onRecords`/la table liée au widget dans la page** :
   ce point supposait que le dashboard afficherait la table réellement liée au widget dans la page
   Grist. Suite au passage à une connexion automatique à `BI_StressTest_v1` comme UNIQUE table de
   travail (voir plus haut), `js/grist-api.js:init()` n'appelle plus `grist.onRecords()` du tout —
   la table liée au widget dans la page (s'il y en a une) n'est plus consultée. Ce point ne
   redeviendra pertinent que si/quand le widget doit à nouveau afficher les vraies données d'un
   document plutôt que son jeu de test fixe ; à ce moment-là il faudra réintroduire `onRecords` et
   retester ce qu'il décrivait à l'origine (mises à jour live, filtre Grist en amont...).
2. **[PARTIELLEMENT RÉPONDU en local, pas encore en réel] Volume de données réel** : à partir de
   combien de lignes l'agrégation client devient-elle perceptible ? Réponse empirique obtenue via le
   jeu de données "test de charge" (~47 040 lignes, voir plus haut) : génération + agrégation en
   ~30ms côté Node, rendu des 4 tuiles en 35-60ms dans Chromium headless — **l'agrégation
   `Array.reduce` côté client n'est manifestement pas le goulot à ce volume**, en tout cas pas dans
   ce sandbox. Ce que ça ne répond PAS : (a) le round-trip réseau réel de `applyUserActions` pour
   envoyer ~47 000 lignes vers un vrai `grist.docApi` (le mock n'a aucune latence réseau) — c'est
   précisément ce que l'envoi par lots (`ACTION_CHUNK_SIZE`, voir plus haut) doit rendre supportable
   si c'est lent, mais ce n'est vérifiable qu'en conditions réelles ; (b) la performance sur un volume
   encore plus grand (centaines de milliers de lignes) ou sur du matériel utilisateur plus modeste
   que ce sandbox de dev.
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
   sauvegarde→rechargement fonctionne-t-il tel quel avec le nouveau format `{tiles, bookmarks}`
   (testé contre le mock via un appel direct à `loadConfig()`, jamais contre un vrai document) ?
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
   déclare `Quantite` en `Int` et `Montant` en `Numeric`. Confirmé fonctionnel — la table de démo
   créée chez l'utilisateur montre ces deux colonnes correctement typées avec des valeurs numériques.
8. **[CONFIRMÉ EN RÉEL, sur un volume désormais dépassé] ~240 actions (`AddRecord`/`RemoveRecord`)
   en un seul `applyUserActions()`** : confirmé fonctionnel à l'époque du jeu de démo à 120 lignes.
   Le jeu de démo actuel (1920 lignes) et le jeu de charge (~47 040 lignes) passent maintenant par
   l'envoi en lots (`applyActionsInChunks`, voir point 10 ci-dessous) plutôt qu'un unique appel géant
   — cette confirmation initiale ne couvre donc plus le chemin de code réellement utilisé aujourd'hui.
9. **Table de démo suffixée par un numéro de schéma** (`BI_Demo_Ventes_v3`) : corrige le bug KeyError
   remonté (voir plus haut), mais laisse une table `BI_Demo_Ventes`/`BI_Demo_Ventes_v2` orpheline
   dans le document de l'utilisateur (ancien schéma, plus jamais utilisée). Pas grave en soi (juste
   une table à supprimer à la main s'il le souhaite), mais à surveiller si le schéma doit encore
   évoluer : chaque bump laisse une table de plus derrière lui. S'applique désormais aussi à
   `BI_StressTest_v1`, qui est LA table concernée en pratique puisque `BI_Demo_Ventes_v3` n'est
   plus créée automatiquement (voir plus haut : plus de bouton pour la déclencher).
10. **Envoi par lots et connexion idempotente, jamais exécutés contre un vrai `grist.docApi`** :
    `applyActionsInChunks` (2000 actions/appel) et `loadOrCreateTable` (ne renvoie les ~47 000 lignes
    du jeu de charge qu'une seule fois, se contente de relire la table ensuite — voir plus haut) ne
    sont validés que contre le mock en mémoire, qui n'a ni latence réseau ni limite de payload. À
    vérifier en réel : le découpage en lots de 2000 suffit-il à éviter un timeout/une erreur de
    payload sur la création initiale des ~47 000 lignes ? La reconnexion (relecture seule, sans
    envoi) est-elle bien quasi instantanée sur un vrai document, comme observé dans le mock ?

## Prochaines étapes suggérées

1. ~~Installer ce widget dans un vrai document Grist de test~~ — fait ; ECharts vendorisé
   localement a résolu le premier problème remonté (point 3), confirmé fonctionnel par l'utilisateur.
2. ~~Générer les données de démo~~ — fait, a remonté un vrai bug (point 9, KeyError sur schéma
   obsolète) corrigé et confirmé recorrigé côté utilisateur.
3. **Priorité haute** : ouvrir le widget dans un vrai document Grist et vérifier que la connexion
   automatique à `BI_StressTest_v1` (voir plus haut) se déroule bien de bout en bout dès le premier
   chargement — création initiale des ~47 040 lignes (le découpage en lots tient-il la route sur le
   réseau réel ?), puis rechargements suivants (la reconnexion sans renvoi de données reste-t-elle
   quasi instantanée, comme observé dans le mock ? point 10). C'est la seule façon de vraiment
   trancher le point 2 (l'agrégation elle-même est déjà innocentée en local).
4. Tester en conditions réelles, sur cette même table : filtres simultanés, tendance KPI,
   drill-down (y compris le 2e niveau et le cross-filtering par tuile), réorganisation des tuiles,
   et **surtout** les vues sauvegardées (nouveau format de `ConfigJSON` jamais exécuté contre un
   vrai document — point 4 des points à valider) — tout testé ici via Playwright contre le mock
   uniquement.
5. Vérifier le point 6 ci-dessus (redimensionnement du panneau Grist). Le point 1 (table liée /
   `onRecords`) est pour l'instant sans objet (voir plus haut) — à reprendre seulement si le widget
   doit un jour revenir à afficher les vraies données d'un document plutôt que sa table de travail
   fixe.
6. Si le round-trip réseau réel s'avère être le vrai goulot (et pas l'agrégation, voir point 2) :
   reconsidérer DuckDB-WASM n'aiderait pas dans ce cas précis (c'est un problème d'I/O, pas de calcul)
   — plutôt regarder du côté d'une pagination/chargement progressif des lignes.
