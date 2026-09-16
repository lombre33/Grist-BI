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
  était à l'origine un bump de `DEMO_TABLE_SCHEMA_VERSION`/`STRESS_TABLE_SCHEMA_VERSION` (nouvelle
  table fraîche) — **remplacé depuis par `ensureColumnsUpToDate`/`AddColumn` sur la table existante,
  voir l'entrée "Changement de politique" plus bas : ces deux constantes n'existent plus** — mais le
  principe "pas de régénération en place des lignes déjà là, plus d'option de régénération manuelle
  dans l'UI" reste vrai.
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
  chargement, à la table de test de charge (`BI_StressTest`, ~47 040 lignes) via
  `loadOrCreateStressData()` — plus besoin de cliquer sur un bouton pour avoir un dashboard à
  tester. Les boutons « 🎲 Données de démo »/« 🔥 Gros jeu de données » et le bandeau « Mode démo /
  Revenir à la table liée » ont été retirés de l'UI (`index.html`, `dev-tests/harness.html`,
  `js/main.js`) : il n'y a plus qu'UNE table de travail, plus de bascule entre plusieurs sources.
  `js/grist-api.js:init()` n'appelle donc plus `grist.onRecords()` (la table liée au widget dans
  la page Grist n'est plus consultée du tout pour l'instant — voir point 1 ci-dessous, désormais
  obsolète). Si le schéma doit se complexifier plus tard (colonnes en plus), le mécanisme déjà en
  place suffit sans repasser par un bouton : `ensureColumnsUpToDate` (`js/grist-api.js`) ajoute la
  colonne manquante à la table déjà présente et la remplit pour les lignes déjà là au chargement
  suivant — **le nom de la table ne change plus jamais** (voir l'entrée "Changement de politique"
  plus bas, qui remplace le mécanisme de bump de version de schéma décrit ici à l'origine) ; un
  bouton manuel resterait facile à ajouter en plus si un déclenchement explicite (sans recharger la
  page) s'avère utile un jour. Le jeu de données de démo « rapide » (`BI_Demo_Ventes`,
  `loadOrCreateDemoData`, 1920 lignes) reste dans
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
- **Refonte visuelle sobre/épurée** (`css/style.css`, insérée en étape intermédiaire à la demande de
  l'utilisateur entre deux features du Tier 1) : nouveau système de tokens (encre primaire/
  secondaire, surfaces, ombres douces, rayons cohérents) basé sur la **palette catégorielle validée
  colorblind-safe** du skill `dataviz` de ce projet (`references/palette.md` — worst adjacent CVD
  ΔE 9.1 clair/8.4 sombre, OKLab, cible ≥8 — vérifié via `scripts/validate_palette.js`, pas choisi
  à l'œil), réutilisée à la fois dans le CSS (tokens `--accent` etc.) et dans `js/charts.js`
  (`CATEGORICAL_PALETTE` : camembert coloré par part, barres en une seule teinte cohérente avec
  l'accent puisque l'axe porte déjà l'identité des catégories — mettre une couleur par barre aurait
  été redondant). Aucun sélecteur fonctionnel (id/classe lu par `js/*.js` ou les scripts Playwright)
  renommé — uniquement des valeurs de style affinées, vérifié en rejouant toute la suite Playwright
  existante après la refonte (0 régression). Nettoyage au passage des emoji décoratifs de la barre
  de bookmarks (📌/🗑/★), remplacés par du texte simple, plus sobre. `.demo-banner` fusionnée dans
  `.warning-banner` (son seul consommateur restant depuis le retrait du bandeau "mode démo").
  - **[BUG RÉEL trouvé en capturant un screenshot pendant cette passe]** Sur le jeu de test de
    charge (~2,7M par région), les libellés de l'axe Y s'affichaient tronqués (`"000"` au lieu de
    `"2,7 M"`) : ECharts réserve une marge gauche ESTIMÉE avant de connaître la largeur réelle du
    texte produit par un `axisLabel.formatter` personnalisé — l'estimation était trop courte, une
    partie du texte se dessinait hors du canvas et disparaissait silencieusement (**aucune erreur
    JS levée** — seul un screenshot regardé a permis de le voir). Corrigé par
    `grid: { containLabel: true }`, qui force ECharts à recalculer la marge à partir du texte
    réellement rendu. Au passage, ajout d'un format compact (`formatCompactNumber`, "2,7 M"/"150 k")
    sur les libellés d'axe SEULEMENT (pas les cartes KPI ni les info-bulles, qui gardent la
    précision exacte) — plus lisible, et ce qui a permis de révéler le bug en premier lieu
    puisqu'avant lui les nombres bruts à 7 chiffres débordaient encore plus largement, juste d'une
    façon moins visible (retour à la ligne au lieu d'un simple décalage).
- **Trois nouveaux types de tuiles : jauge, treemap, nuage de points (scatter)** (`js/charts.js`,
  `js/main.js`, Roadmap Tier 1) :
  - **Jauge** : sémantiquement proche d'une carte KPI (pas de dimension, une seule valeur agrégée —
    réutilise `aggregateSingle` telle quelle), mais rendue via une série ECharts `gauge` plutôt qu'en
    texte pur. Deux nouveaux champs de tuile persistés, `gaugeMin`/`gaugeMax` (nombres, saisis dans le
    formulaire), avec garde-fou (`max > min`, sinon alerte et la tuile n'est pas créée). Pas de
    gestionnaire de clic (rien à filtrer/détailler sur une seule valeur).
  - **Treemap** : version **plate** délibérément (voir ROADMAP.md) — dimension + mesure + agrégat,
    quasi identique au camembert (même palette catégorielle, même fonction `dim()` d'opacité pour le
    cross-filtering). `nodeClick: false` désactive le zoom-sur-clic natif d'ECharts (pensé pour une
    hiérarchie à plusieurs niveaux, pas notre cas plat) pour laisser le clic au gestionnaire
    générique existant (drill-down/cross-filter), sans comportement concurrent. Drill-down
    disponible comme sur bar/pie (mécanisme générique, aucun code spécifique au treemap requis).
  - **Nuage de points (scatter), version agrégée** : PAS ligne-à-ligne (aurait cassé le modèle
    d'agrégation partagé par toutes les tuiles et jamais été mesuré en performance à l'échelle de
    ~47 000 lignes, voir ROADMAP.md) — un point par valeur de la dimension, ses coordonnées X/Y sont
    les agrégats de DEUX mesures différentes (`tile.measure` et le nouveau `tile.measureY`) sur ce
    même groupe. Les deux `groupByAggregate` sont associés par NOM de dimension (une `Map`), pas par
    index, pour rester corrects même si l'ordre venait à diverger entre les deux appels. Le
    formulaire relabellise dynamiquement "Mesure" en "Mesure X" et affiche un nouveau champ
    "Mesure Y" quand ce type est sélectionné.
  - **Deux vrais bugs trouvés en capturant des screenshots en ajoutant ces types** (même famille que
    le bug précédent : un réglage ECharts pensé pour un espace plus grand qu'une tuile de dashboard
    doit être revu explicitement pour chaque nouveau type de série, pas seulement "testé sans
    erreur JS") :
    1. Les graduations de la jauge se chevauchaient (le `splitNumber` par défaut d'ECharts, 10,
       produit 11 libellés — illisible à la taille d'une tuile). Corrigé par `splitNumber: 4`.
    2. Un point de scatter sans `name` explicite aurait rendu le gestionnaire de clic générique muet
       (`params.name` undefined, drill/cross-filter sur une valeur "undefined") : contrairement à
       bar (axe catégoriel, ECharts déduit `params.name` de l'index sur l'axe), scatter a deux axes
       numériques — rien n'associe un point à sa catégorie sans ce champ. Repéré et corrigé avant
       même d'atteindre l'étape du screenshot, en relisant le code par analogie avec pie/treemap qui
       fixent déjà `name` explicitement.
  - Testé avec Playwright : jauge (champs cachés/visibles selon type, garde-fou min/max, valeur
    agrégée affichée), treemap (rendu plat, cross-filtering au clic sur un rectangle), scatter
    (relabellisation du champ mesure, 2e mesure obligatoire, cross-filtering au clic sur un point
    avec le bon badge de filtre). Tuiles par défaut (`demoData.js`) délibérément PAS étendues pour
    démontrer ces 3 nouveaux types (éviter un dashboard par défaut toujours plus long) — à tester en
    ajoutant une tuile via le formulaire.
- **Dashboards multi-pages** (`js/state.js`, `js/grist-api.js`, `js/main.js`, Roadmap Tier 1) :
  - `state.js` passe d'un `tiles` plat à `pages: [{ id, name, tiles }]` + `currentPageId`.
    `getState()` continue d'exposer `tiles` (dérivé de `currentPage().tiles`) EN PLUS de `pages`, en
    lecture seule côté consommateur : `main.js`/`charts.js` (render, renderTile, gestionnaire de
    clic, drill-down, cross-filtering...) n'ont **aucun changement** à faire — ils continuent de ne
    voir "que les tuiles à afficher maintenant", peu importe le nombre de pages. Effet de bord
    gratuit : changer de page retire du DOM les tuiles de l'ancienne page (elles disparaissent de
    `state.tiles`), donc la réconciliation DOM déjà en place dans `main.js:render()` détruit leurs
    instances ECharts automatiquement, sans code dédié pour le nettoyage à la navigation.
  - **Décision produit délibérée : `activeFilters`/`drillIns` restent GLOBAUX, pas par page.**
    Alternative envisagée (les dupliquer par page) rejetée pour la v1 : plus de code, deux
    mécanismes de cross-filtering à maintenir en synchronisation, pour un bénéfice pas démontré —
    aucune des demandes utilisateur n'appelait spécifiquement des filtres cloisonnés par page.
    Documenté et **testé explicitement** (`dev-tests/test-data.js` + Playwright) : un filtre posé
    sur la page 1 reste visible et actif après bascule vers la page 2. Vérifiable/réversible plus
    tard si le besoin apparaît (structure `activeFilters`/`drillIns` déjà indexée par `sourceTileId`/
    `tileId`, un filtrage par page se limiterait techniquement à croiser avec `page.tiles`).
  - `removePage` nettoie `drillIns`/`activeFilters` des tuiles qui disparaissent avec leur page —
    même principe que `removeTile` (déjà existant), pour ne pas laisser un filtre orphelin sans plus
    aucune tuile source pour le faire évoluer ou le lever. Garde-fou : jamais de tableau de pages
    vide (`removePage` sur la dernière page restante est un no-op silencieux, comme les boutons
    ◂/▸ en bout de liste).
  - **Persistance** : `js/grist-api.js` a déjà changé de format DEUX fois avant cette feature (un
    tableau nu de tuiles, puis `{tiles, bookmarks}`) — même mécanique de compatibilité ascendante
    reconduite pour le format courant `{pages, currentPageId, bookmarks}` : `normalizeConfig()`
    détecte les 3 formes possibles d'un `ConfigJSON` existant et les convertit toutes vers la forme
    courante, y compris un `currentPageId` sauvegardé qui ne correspondrait plus à aucune page
    (repli sur la première page plutôt qu'un écran vide). Testé en Playwright en écrivant directement
    les 2 anciens formats dans la table de config mockée puis en relisant via `loadConfig()`.
  - **UI** : barre d'onglets sobre (`.pages-bar`/`.page-tab`, cohérente avec la refonte visuelle),
    un bouton « + Page » (nomme via `prompt()`, même pattern que "Sauvegarder la vue"), double-clic
    sur un onglet pour le renommer, bouton `×` de suppression affiché **uniquement sur l'onglet
    actif** quand il y a plus d'une page (jamais sur les onglets inactifs, pour ne pas encombrer -
    et il ne servirait à rien sur l'onglet inactif puisqu'on ne peut de toute façon pas supprimer
    la dernière page). `confirm()` avant suppression (une page emporte toutes ses tuiles avec elle,
    contrairement à la suppression d'une seule tuile qui ne demande pas confirmation).
  - Testé : Node (`dev-tests/test-data.js`, isolation des tuiles par page, filtres globaux,
    `removePage`/garde-fou dernière page, `setPages`/repli `currentPageId` invalide) + Playwright
    (navigation complète onglets/ajout/renommage/suppression, filtres croisés vérifiés globaux au
    changement de page, persistance au nouveau format vérifiée en lisant directement la table de
    config mockée, compatibilité ascendante des 2 anciens formats). Aucun bug produit trouvé sur
    cette feature (contrairement aux 3 précédentes) — hypothèse : moins de rendu ECharts
    spécifique en jeu, la feature touche surtout de la gestion d'état déjà bien couverte par les
    tests existants.
- **Filtres avancés : plage numérique, plage de dates, dates relatives, recherche texte**
  (`js/data.js`, `js/state.js`, `js/main.js`, Roadmap Tier 1) :
  - **Généralisation du modèle de filtre** plutôt qu'un mécanisme séparé : `data.js:applyFilters`
    déléguait déjà tout le matching à une seule fonction (`sameValue`) — remplacée par
    `matchesFilter(rowValue, filter)`, un `switch` sur `filter.type` (`range`/`dateRange`/
    `relativeDate`/`contains`, défaut `'eq'` = comportement historique du clic ECharts). Les
    filtres croisés (`activeFilters`, posés par un clic) et les nouveaux filtres avancés
    (`advancedFilters`, posés depuis une barre dédiée) sont simplement concaténés dans la même
    liste passée à `applyFilters` (voir `charts.js:renderTile`) — aucune duplication de logique de
    filtrage entre les deux mécanismes.
  - **Colonne `Date` ajoutée aux jeux de données** (`js/demo-data.js`, ISO `AAAA-MM-JJ`, dérivée de
    Annee/Mois/Semaine ou Jour) : c'est la SEULE colonne réellement de type date de ce POC —
    Annee/Mois/Semaine/Jour existent séparément pour démontrer le drill-down hiérarchique, mais
    aucune ne peut porter un filtre "plage de dates" à elle seule (une année seule ou un jour du
    mois sans le mois n'a pas de sens comme date). Bump de `DEMO_TABLE_SCHEMA_VERSION` (3→4) et
    `STRESS_TABLE_SCHEMA_VERSION` (1→2), même mécanique que les schémas précédents.
  - **Détection du "type" d'une colonne par inspection de la donnée réelle**, PAS par son nom
    (heuristique fragile) : `main.js:inferColumnKind` regarde une valeur échantillon de la colonne
    choisie — `GristBI.data.parseDateValue` reconnaît le format ISO utilisé ici, sinon `typeof
    === 'number'` (ou une chaîne numérique). Correction technique du 2026-09-15 : ce POC n'a
    toujours pas de lecture des vrais types Grist (`_grist_Tables_column`, voir ROADMAP.md), donc
    cette inspection par valeur est le même principe que la détection Date/Numeric de
    publipostageGrist, appliqué à défaut de la vraie source de vérité.
  - **UI** : une seule barre de filtre (pas un formulaire par type) qui bascule ses champs visibles
    selon le type inféré de la colonne choisie (plage min/max ; mode "plage de dates" OU "période
    relative" au choix pour une colonne Date ; recherche texte sinon) — même pattern que
    `updateFormFieldsForType` du formulaire de tuile. Un seul filtre par colonne (comme
    `toggleFilter`) : reposer un filtre sur une colonne déjà filtrée REMPLACE l'ancien (ex.
    rebasculer "plage de dates" vers "période relative" sur la même colonne), plusieurs colonnes se
    cumulent en ET.
  - **Portée délibérée** : `advancedFilters` est GLOBAL (comme `activeFilters`/`drillIns`, même
    décision produit que pour les pages) et s'applique à TOUTES les tuiles sans exception — pas de
    notion de "tuile source" exemptée comme pour un clic de cross-filtering (`sourceTileId` n'a pas
    de sens ici). Capturé par les bookmarks (comme `activeFilters`/`drillIns`), avec repli sur `[]`
    pour un bookmark sauvegardé avant cette feature. **Non persisté** dans la config du dashboard
    (comme `activeFilters`/`drillIns` déjà avant) : un filtre avancé est un état interactif de
    session, pas une configuration de tuile — seul un bookmark le fait survivre.
  - **Presets "dates relatives"** (`RELATIVE_DATE_PRESETS` dans `data.js`) calculés par rapport à
    un `now` PASSÉ EN PARAMÈTRE (pas `Date.now()` en dur) pour rester testable sous Node sans
    dépendre de l'horloge réelle.
  - Testé : Node (`dev-tests/test-data.js` — `matchesFilter`/`applyFilters` pour les 4 nouveaux
    types dont bornes optionnelles indépendamment, format de date non-ISO refusé plutôt que mal
    interprété, combinaison filtre "eq" + filtres avancés en ET ; `state.js` — remplacement par
    colonne, cumul multi-colonnes, capture/restauration par bookmark avec compat ascendante) +
    Playwright (bascule des champs du formulaire selon le type inféré, les 4 types posés puis
    retirés via leur badge, effet réel vérifié sur l'agrégat d'une tuile après retrait d'un filtre,
    non-présence dans la config persistée, capture par bookmark) + captures d'écran clair/sombre.
    Aucun bug produit trouvé sur cette feature.
- **Export Excel du dashboard** (`js/vendor/xlsx/`, `js/export.js`, `js/data.js`, Roadmap Tier 1) :
  - **SheetJS (`xlsx`, npm `xlsx@0.18.5`, Apache-2.0) embarqué localement**, même raisonnement que
    `js/vendor/echarts/` (voir README.md) : pas de dépendance à un CDN externe. Build `xlsx.full.min.js`
    choisie (UMD, expose `window.XLSX`) plutôt que `xlsx.mini.min.js` (plus légère mais sans certains
    formats de lecture — sans intérêt ici puisque ce POC n'écrit QUE des `.xlsx`, jamais n'en relit).
  - **Refactor pour éliminer la duplication rendu/export** : la composition de filtres qui vivait en
    ligne dans `charts.js:renderTile` (filtres croisés des autres tuiles + filtres avancés +
    drill-down) est devenue `GristBI.data.rowsForTile(tile, state)`, et `currentDimension` (dimension
    actuellement affichée compte tenu du drill-down) a migré de `charts.js` vers `data.js` — les deux
    étaient déjà PURES (aucune dépendance DOM/ECharts), seulement mal placées dans un module
    browser-only. Résultat : une SEULE source de vérité pour "que voit l'utilisateur pour cette
    tuile", partagée par le rendu ET l'export, testable sous Node (alors que `charts.js` ne l'est
    pas, voir TEST_PROTOCOL.md). Ce que l'utilisateur exporte correspond ainsi exactement, et
    automatiquement, à ce qu'il voit à l'écran (mêmes filtres croisés, mêmes filtres avancés, même
    niveau de drill-down par tuile) sans code dédié à synchroniser les deux.
  - **`GristBI.data.tileExportSheet(tile, state)`** : une feuille par tuile, agrégée EXACTEMENT
    comme le rendu (`aggregateSingle` pour kpi/gauge, `groupByAggregate` pour bar/pie/treemap, les
    deux mesures alignées par nom de dimension pour scatter — même technique que le rendu scatter,
    voir plus haut). Retourne `{header, rows}` plutôt qu'un tableau d'objets : contrôle explicite de
    l'en-tête même quand `rows` est vide (tuile entièrement filtrée), ce que
    `XLSX.utils.json_to_sheet([])` ne permettrait pas (pas d'objet pour déduire les colonnes).
  - **`GristBI.data.buildWorkbookSheets(state)`** : une feuille par tuile, TOUTES PAGES confondues
    (pas seulement la page actuellement affichée — exporter le dashboard entier a plus de valeur
    qu'exporter un instantané d'écran) ; le nom de page préfixe le titre de la tuile seulement s'il y
    a plusieurs pages. `sanitizeSheetName` applique les contraintes Excel (31 caractères max,
    caractères `: \ / ? * [ ]` interdits, unicité dans le classeur) avec un suffixe `" (n)"` en cas de
    collision après troncature/nettoyage — deux tuiles peuvent parfaitement partager le même titre.
  - **`js/export.js`** ne fait QUE parler à `XLSX` (construction du classeur + `XLSX.writeFile`, qui
    gère lui-même Blob + ancre de téléchargement + clic synthétique) : aucune logique testable sous
    Node n'y réside, conformément à la même séparation que `grist-api.js`/`charts.js` (browser-only,
    Playwright uniquement). `XLSX.writeFile` fonctionne car l'iframe du widget N'EST PAS sandboxée
    (voir ROADMAP.md, limites structurelles) — **jamais vérifié en conditions réelles Grist** que le
    téléchargement se déclenche bien depuis l'iframe (voir "Points à valider" plus bas).
  - Testé : Node (`tileExportSheet` pour bar/kpi/scatter + cas d'une tuile vidée par un filtre,
    `sanitizeSheetName` pour les 3 contraintes Excel, `buildWorkbookSheets` pour le préfixage
    conditionnel par page) + Playwright — celui-ci va jusqu'à **relire le fichier .xlsx réellement
    téléchargé** (`page.waitForEvent('download')` + SheetJS côté Node sur le buffer téléchargé) et
    comparer son contenu exact à `buildWorkbookSheets` calculé côté navigateur au même instant, y
    compris avec un filtre avancé actif (l'export reflète bien les données filtrées, pas les données
    brutes) et le cas "aucune tuile" (alerte, aucun téléchargement déclenché). Aucun bug produit
    trouvé sur cette feature — une limitation d'outillage notée en marge : la build "browser" de
    SheetJS neutralise volontairement `require('fs')`, donc `XLSX.readFile()` échoue sous Node
    (`Cannot access file`) ; le test lit le fichier via `fs.readFileSync` puis `XLSX.read(buffer,
    {type:'buffer'})`, pas une limite du widget lui-même.
- **[BUG RÉEL remonté par l'utilisateur en réel] Tuiles qui s'étirent à l'infini vers le bas**
  (`css/style.css:.tile`) :
  - **Symptôme** : après le chargement (ou l'ajout d'une nouvelle tuile), les tuiles contenant un
    graphique ECharts grandissaient continuellement vers le bas, sans jamais se stabiliser — aucune
    erreur JS, aucun message dans la console.
  - **Cause** : `.tile` n'avait qu'un `min-height: 224px` (hauteur dérivée du contenu), tandis que
    `.tile-chart` (le conteneur du graphique) a `flex: 1` (grandit pour occuper l'espace disponible).
    Sans hauteur FIXE sur `.tile`, la taille de `.tile-chart` dépend circulairement du graphique
    qu'il contient. Le `ResizeObserver` posé sur `document.body` (voir `main.js`, pensé pour capter
    un redimensionnement du panneau Grist hébergeant l'iframe) redéclenche `resizeAll()` à chaque
    changement de mise en page ; chaque cycle de `chart.resize()` mesurait alors un conteneur
    légèrement plus grand qu'au cycle précédent, dans une boucle de rétroaction qui ne convergeait
    jamais (~20-25px de plus toutes les quelques centaines de ms).
  - **Diagnostic** : impossible à voir sur un screenshot unique (l'état à l'instant T semble normal)
    ni via l'absence d'erreur JS. Repéré en mesurant la hauteur réelle de `.tile-chart` à PLUSIEURS
    instants successifs via Playwright (`getBoundingClientRect().height` échantillonnée toutes les
    ~300-400ms sur plusieurs secondes) — la seule méthode qui révèle une boucle de rétroaction dans
    le temps. Nouvelle catégorie ajoutée à la checklist méthodologique de TEST_PROTOCOL.md :
    "Stabilité dans le temps, pas juste un instant T".
  - **Correction** : `.tile` passe de `min-height: 224px` à `height: 224px` (hauteur fixe). Casse la
    dépendance circulaire : `flex: 1` a désormais une base de calcul stable, indépendante du contenu
    qu'ECharts y dessine. Vérifié sur 8 cycles de resize consécutifs (~2s) : hauteur parfaitement
    stable à 180px (le plancher de `.tile-chart`) après le fix, contre une croissance continue avant.
  - Testé : Playwright dédié (`tile-height-stability-test.js`), ajouté comme garde de non-régression
    permanente pour cette classe de bug (toute future tuile avec un graphique ECharts dans un
    conteneur `flex`/`grid` sans hauteur explicite sur un ancêtre y est exposée).
- **Changement de politique : plus JAMAIS de nouvelle table pour un changement de schéma**
  (`js/grist-api.js`, demande explicite de l'utilisateur) :
  - **Ce qui a motivé le changement** : l'ajout de la colonne `Date` (filtres avancés, voir plus
    haut) avait suivi l'ancien mécanisme — bump de `STRESS_TABLE_SCHEMA_VERSION`/
    `DEMO_TABLE_SCHEMA_VERSION`, nouvelle table `BI_StressTest_v2`/`BI_Demo_Ventes_v4` créée à côté
    de `_v1`/`_v3`. L'utilisateur a fait remarquer à raison que ce n'était pas nécessaire : `AddColumn`
    est un verbe Grist déjà vérifié comme fiable (voir ROADMAP.md, liste des verbes prouvés) —
    l'ancien commentaire "AddColumn n'est pas un verbe éprouvé ICI" ne voulait dire que "jamais
    utilisé dans ce codebase", pas "non fiable dans Grist". Consigne reçue : une seule table de test
    traverse toute la vie du widget ; si une colonne manque, on l'ajoute à la table existante.
  - **Nouveau mécanisme** : les noms de table sont désormais FIXES (`BI_Demo_Ventes`,
    `BI_StressTest`, plus de suffixe `_v1`/`_v2`...). `ensureColumnsUpToDate(tableId, columns,
    deriveMissingColumns, onProgress)` compare les colonnes attendues à celles réellement présentes
    dans la table (`fetchTable`), ajoute les manquantes (`AddColumn`) puis les remplit pour les
    lignes déjà là avec de VRAIES valeurs calculées côté JS et envoyées explicitement
    (`UpdateRecord`, comme `fillTable` envoie ses `AddRecord`) — **PAS une formule Grist** (question
    posée explicitement par l'utilisateur : la réponse est qu'une formule n'a jamais été
    nécessaire, seulement suggérée à tort comme option ; ce projet n'utilise nulle part le langage
    de formules Grist, cohérence délibérée). `GristBI.demoData.deriveDateColumn(row)` calcule la
    valeur dérivée (ici `Date`) à partir des colonnes déjà présentes sur une ligne EXISTANTE
    (Annee/Mois + Semaine ou Jour selon la table), réutilisable pour n'importe quelle future colonne
    dérivable de la même façon.
  - **Nettoyage des tables déjà créées par erreur** : `migrateLegacyTableName(tableId, legacyNames)`
    détecte si un ancien nom versionné (`BI_StressTest_v2`, `BI_StressTest_v1`,
    `BI_Demo_Ventes_v4`...) existe encore alors que le nom fixe n'existe pas, et le RENOMME
    (`RenameTable`, verbe déjà vérifié) plutôt que de laisser une table orpheline en plus — corrige
    directement les deux tables `_v2`/`_v4` créées par erreur dans les deux commits précédant celui-ci.
  - **`dev-tests/grist-stub.js`** étendu pour supporter `AddColumn` (ajoute la colonne, remplie de
    `null` pour les lignes déjà présentes, comme le ferait Grist) et `RenameTable` (déplace la
    table interne d'une clé à l'autre) — nécessaires pour tester ce mécanisme sans vrai document.
  - Testé : Node (`deriveDateColumn` pour les deux formes de table, Semaine et Jour, cohérent avec
    la génération directe) + Playwright dédié (`schema-migration-test.js`, 3 scénarios : 1re
    installation avec toutes les colonnes dès la génération ; table déjà existante avec un schéma
    ancien → `AddColumn` + backfill exact par `UpdateRecord`, aucune ligne perdue/dupliquée, aucune
    nouvelle table ; ancien nom versionné → renommage vers le nom fixe, une seule table au final
    dans le document). Un vrai bug a été trouvé pendant l'écriture de CE test (pas dans le produit) :
    la page de test Playwright n'avait pas de `<meta charset="UTF-8">`, ce qui corrompait les noms de
    mois accentués (`Décembre` lu comme `DÃ©cembre`) — `index.html`/`harness.html` déclarent bien ce
    charset, seule la page de test jetable en manquait.
- **Composant Combobox réutilisable (autocomplétion)** (`js/combobox.js`, demande explicite de
  l'utilisateur : "partout où l'on fait référence à une colonne cela puisse être un choix de
  l'utilisateur avec autocomplétion") :
  - **Décision d'implémentation** : combobox JS maison plutôt que `<input>` + `<datalist>` natif
    (option plus simple envisagée puis écartée par l'utilisateur) — plus de contrôle sur le style
    (cohérent pixel-perfect avec le design system sobre déjà en place) et le comportement (résultat
    identique quel que soit le navigateur, contrairement à `<datalist>` dont le rendu/filtrage varie
    réellement d'un moteur à l'autre).
  - **Deux modes** : `strict: true` (défaut, pour choisir une COLONNE) — la valeur doit être l'une
    des options fournies, une saisie invalide au blur/Escape revient à la dernière valeur valide,
    comme un `<select>`. `strict: false` (pour une VALEUR de filtre, voir plus bas) — texte libre,
    la liste n'est qu'une suggestion, aucune correction forcée.
  - **`attach(inputEl, listEl, config)` retourne `inputEl` lui-même**, enrichi d'une méthode
    `setOptions()` : tout le reste du code continue de lire/écrire `.value` et d'écouter `'change'`
    exactement comme sur un `<select>` classique — migrer un champ existant ne demande de changer
    QUE son balisage HTML (un `<select>` devient un `<div class="combobox">` avec `<input>` +
    `<ul>`), pas les lectures/écritures de valeur déjà présentes dans `main.js`.
  - **Le "blank" (ex. "(aucun)" pour un niveau de drill-down optionnel) n'est PAS un texte
    sélectionnable** dont la valeur serait la chaîne `"(aucun)"` (ce qui casserait tous les tests de
    vérité `if (dimension)` existants) : c'est un `placeholder` HTML natif (affiché en grisé quand le
    champ est vide) + une entrée de menu dédiée qui, sélectionnée, remet `.value` à `''` — valeur et
    texte affiché restent alors toujours identiques, aucune correspondance value↔label à maintenir
    séparément.
  - **[BUG RÉEL trouvé en Playwright avant même d'exister ailleurs]** : cliquer un champ qui a DÉJÀ
    le focus (juste après avoir validé une sélection, par exemple) ne redéclenchait pas le menu — un
    seul écouteur `'focus'` ne suffit pas, car le navigateur ne redéclenche PAS l'événement `focus`
    sur un élément qui l'a déjà. Corrigé en ajoutant aussi un écouteur `'click'` appelant la même
    logique d'ouverture. Repéré uniquement en testant le scénario réaliste "commiter une valeur PUIS
    recliquer pour en choisir une autre", pas en testant chaque interaction isolément.
  - Testé : Node (`filterOptions`/`highlightMatch`, logique de correspondance/surlignage pure) +
    Playwright (`combobox-test.js`, 9 scénarios sur une page de test dédiée : ouverture au focus ET
    au clic, filtrage + surlignage en tapant, navigation clavier complète, sélection souris, les deux
    reprises en mode strict (blur/Escape), sélection du blank, mode texte libre, `setOptions()` sans
    valeur courante valide) + captures d'écran clair/sombre.

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
11. **Déclenchement du téléchargement Excel depuis l'iframe du widget, jamais vérifié en conditions
    réelles Grist** : `XLSX.writeFile` (voir `js/export.js`) crée un Blob + une ancre `<a download>`
    + un clic synthétique, qui fonctionne dans Chromium headless (Playwright, voir plus haut) et
    repose sur le fait, vérifié dans le code source de Grist, que l'iframe d'un widget custom n'est
    PAS sandboxée (voir ROADMAP.md). Reste non vérifié dans un vrai navigateur à l'intérieur d'un vrai
    document Grist : (a) le téléchargement se déclenche-t-il sans prompt de confirmation bloquant
    inattendu (certains navigateurs demandent une confirmation pour un téléchargement initié depuis un
    iframe tiers) ; (b) le nom de fichier (`dashboard-bi.xlsx`) et l'emplacement de téléchargement se
    comportent-ils comme dans un onglet normal.
12. **`AddColumn`/`RenameTable` contre un vrai `grist.docApi`, jamais exécutés en conditions
    réelles** : le nouveau mécanisme d'évolution de schéma (`ensureColumnsUpToDate`/
    `migrateLegacyTableName`, voir plus haut) repose sur ces deux verbes, considérés fiables d'après
    la lecture du code source de Grist (voir ROADMAP.md) mais jamais exercés contre un vrai document
    dans ce projet — seulement contre le mock (`dev-tests/grist-stub.js`, étendu pour l'occasion, qui
    ne simule que le strict nécessaire). À vérifier en réel : `AddColumn` sur une table de plusieurs
    dizaines de milliers de lignes se comporte-t-il comme attendu (colonne vide plutôt qu'une erreur
    de volume) ; `RenameTable` préserve-t-il bien les données/lignes existantes.

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
