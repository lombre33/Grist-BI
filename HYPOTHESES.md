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
- **Migration de tous les sélecteurs de colonne vers Combobox** (`index.html`, `dev-tests/harness.html`,
  `js/main.js`) : dimension, mesure, mesure Y, tendance KPI, les N niveaux de drill-down (créés
  dynamiquement) et la colonne du filtre avancé passent tous du `<select>` au Combobox — plus aucun
  sélecteur brut pour une colonne dans ce widget.
  - **`fillSelect` renommée `fillCombobox`**, devenue une simple délégation à
    `input.setOptions(...)` : tous les sites d'appel existants (`refreshColumnSelects`, le
    préremplissage en édition, l'ajout de niveaux de drill) n'ont pas eu besoin de changer leur
    LOGIQUE, seulement leur type d'entrée.
  - **`createDrillLevelSelect`** construit maintenant un wrapper `<div class="combobox">` + `<input>`
    + `<ul>` plutôt qu'un `<select>` nu, et retourne l'`<input>` (comme avant) — `input.parentElement`
    est le wrapper à insérer dans le DOM. `truncateDrillLevelsAfter` retire `.parentElement` (le
    wrapper entier), pas l'input seul, sinon un `<div class="combobox">` vide serait resté orphelin
    dans le DOM à chaque niveau retiré.
  - **[BUG RÉEL trouvé en migrant, pas en testant le composant isolément]** Taper un nom de colonne
    puis appuyer directement sur Entrée (sans `ArrowDown` préalable) ne commitait RIEN : aucune
    option n'était présélectionnée après une frappe, donc `activeIndex` restait à `-1` et la
    condition de commit (`activeIndex >= 0`) échouait silencieusement. Or c'est l'usage le PLUS
    courant d'un combobox (taper, valider), jamais exercé par les tests du composant en isolation
    (`combobox-test.js` testait la navigation clavier ET la frappe, mais jamais les deux combinées
    dans cet ordre précis). Corrigé en distinguant deux façons d'ouvrir la liste :
    `openPassive()` (focus/clic, rien présélectionné, pour ne jamais modifier un champ déjà valide
    sur un Entrée égaré) et `openOnType()` (frappe réelle, présélectionne le 1er vrai résultat — ou
    le "blank" si le champ est explicitement vidé, pour que vider un niveau de drill-down puis
    valider fonctionne aussi). Seul un test d'INTÉGRATION dans le vrai formulaire
    (`combobox-integration-test.js` : créer une tuile en tapant dimension+mesure puis Entrée) a
    révélé ce bug — les tests du composant isolé, aussi complets soient-ils, ne remplacent pas un
    test dans son contexte réel d'usage.
  - Testé : Playwright (`combobox-integration-test.js` : tuile créée en tapant dimension/mesure via
    le vrai formulaire, 3 comboboxes indépendants dans le même formulaire scatter sans interférence,
    drill-down à 2 niveaux via comboboxes dynamiques, préremplissage en édition + réouverture avec
    toutes les options, filtre avancé dont le combobox de colonne déclenche bien le bon type de
    champ) + 2 nouveaux cas ajoutés à `combobox-test.js` après la découverte du bug ci-dessus (vider
    un champ puis Entrée commite le blank ; ouverture passive sans frappe ne présélectionne rien) +
    capture d'écran clair/sombre du formulaire réel avec le menu ouvert.
- **Sélecteur de table** (`js/grist-api.js`, `js/main.js`, `index.html`, `dev-tests/harness.html`,
  `css/style.css`) : le widget peut désormais se reconnecter à N'IMPORTE QUELLE table du document
  Grist, pas seulement `BI_StressTest`, via un Combobox `.table-bar` en haut du dashboard.
  - **`GristBI.api.listAvailableTables()`** relit TOUJOURS la liste fraîche du document (jamais de
    cache) — filtre juste la table de config interne (`BI_Dashboard_Config`). **`loadTable(tableId)`**
    ne fait qu'un `fetchTable` (pas de création/remplissage : contrairement à
    `loadOrCreateDemoData`/`loadOrCreateStressData`, la table choisie existe forcément déjà, elle
    vient de `listAvailableTables()`).
  - **`switchTable(tableId, rows, { seedTiles })`** (déjà présente, conçue générique dès le départ —
    voir commentaire historique dans `main.js`) est maintenant réellement appelée plusieurs fois par
    session, pas juste une fois au démarrage. Une table choisie manuellement ne reçoit PAS de
    `seedTiles` (dashboard vide à construire), contrairement à `BI_StressTest` qui garde ses 4 tuiles
    de démo par défaut — décision utilisateur ("Colonnes + choix de la table").
  - **`refreshTablePicker()`** ne recharge la liste qu'au démarrage et après un changement de table
    RÉUSSI, pas à chaque ouverture du menu déroulant : éviter un aller-retour réseau à chaque simple
    clic dans le champ. Conséquence assumée et documentée : une table créée dans Grist entre deux
    ouvertures du menu n'apparaît qu'après le prochain changement de table effectif (vérifié dans
    `table-picker-test.js` en appelant `listAvailableTables()` directement plutôt que de s'attendre
    à un rafraîchissement automatique du menu).
  - **[BUG RÉEL trouvé en testant le retour sur une table déjà visitée]** Revenir sur `BI_StressTest`
    après être passé par une autre table perdait ses 4 tuiles (config vide relue). Cause : `scheduleSave`
    utilise UN SEUL timer partagé (`saveTimer`, débounce 600ms) et relit `currentTableId` — une
    variable de fermeture — au moment où le timer se déclenche, pas au moment où il est programmé.
    `switchTable` déclenche elle-même un rendu (chargement de la config de la table suivante), donc un
    nouvel appel à `scheduleSave` qui fait `clearTimeout(saveTimer)` : la sauvegarde en attente de
    l'ANCIENNE table est silencieusement annulée avant d'avoir jamais été écrite dans Grist. Invisible
    tant qu'une seule table existait par session (le bug ne peut se manifester qu'en changeant
    RÉELLEMENT de table, ce que ce widget ne faisait pas avant cette feature). Corrigé par
    `flushPendingSave()` : `scheduleSave` capture désormais `tableId` dans l'objet `pendingSave` (pas
    juste dans la closure), et `switchTable` appelle `await flushPendingSave()` en tout premier, avant
    de toucher `currentTableId` — la sauvegarde en attente de la table qu'on quitte est écrite
    IMMÉDIATEMENT plutôt que d'attendre (et de risquer d'être annulée par) les 600ms de débounce.
  - Testé : Playwright (`table-picker-test.js`, 5 scénarios : sélection de `BI_StressTest` au
    démarrage + table de config exclue de la liste, `listAvailableTables()` reflète une table créée
    entre-temps, reconnexion à une autre table — lignes rechargées, dashboard vide, tuiles de
    l'ancienne table disparues —, retour sur une table déjà visitée restaure SA configuration propre,
    une tuile ajoutée sur une table quelconque est bien persistée et retrouvée en y revenant) +
    régression complète (`dev-tests/test-data.js` + les 8 autres suites Playwright existantes,
    aucune n'a été affectée par le fix `flushPendingSave`) + capture d'écran clair/sombre du menu
    ouvert avec deux tables listées.
- **Autocomplétion des VALEURS dans la barre de filtres avancés** (`js/data.js`, `js/combobox.js`,
  `js/main.js`, `index.html`, `dev-tests/harness.html`) : demande explicite de l'utilisateur
  ("Colonnes ET valeurs" pour l'autocomplétion des filtres). Périmètre réduit, délibérément, au seul
  champ "Recherche" (`#filter-text`, filtre `contains`) plutôt qu'aux 5 champs min/max/date évoqués
  initialement dans la description de la tâche : pour min/max, une colonne quasi unique (ex. Montant
  sur ~47 000 lignes) ne bénéficierait pas plus de suggestions qu'un `<input type="number">` natif,
  qui garde en plus son clavier numérique dédié ; pour les dates, le sélecteur natif du navigateur
  (calendrier) est déjà une bien meilleure UX qu'une liste de ~47 000 jours quasi tous différents.
  Décision de conception assumée, pas un oubli — facile à étendre plus tard si demandé.
  - **`GristBI.data.distinctColumnValues(rows, column, max)`** (nouvelle fonction pure, testée sous
    Node) : valeurs distinctes d'une colonne, converties en chaîne, dans l'ordre de 1re apparition
    (même convention que `groupByAggregate` — pas de tri alphabétique), `null`/`undefined`/`''`
    ignorés, plafonnées à `max` (500 par défaut) pour rester utilisable même sur une colonne
    quasi unique.
  - **`#filter-text` en mode `strict: false`** : la liste n'est qu'une SUGGESTION, jamais une
    contrainte — taper "cam" pour chercher "contient cam" (sous-chaîne de "Webcam HD") doit rester
    possible même si "cam" seul n'est la valeur exacte d'aucune ligne.
  - **[BUG RÉEL #1 — `setOptions()` écrasait une saisie libre hors-liste]** `setOptions()` corrigeait
    systématiquement une valeur invalide vers le blank/la 1re option, **même en mode `strict: false`**
    — jamais remarqué avant car aucun champ non strict n'existait encore en production. Rafraîchir
    les suggestions (ex. changer de colonne de filtre) aurait donc effacé une recherche texte libre
    déjà tapée par l'utilisateur. Corrigé : `setOptions()` ne corrige la valeur que si `strict` est
    vrai.
  - **[BUG RÉEL #2 — l'Event du `change` listener satisfaisait silencieusement le nouveau paramètre
    `rows`]** `updateAdvancedFilterFieldsForColumn(rows)` a été rendue capable de recevoir `rows` en
    argument (pour corriger une staleness lors d'un changement de table, voir plus bas), mais restait
    câblée directement via `filterColumnSelect.addEventListener('change', updateAdvancedFilterFieldsForColumn)`
    — un `addEventListener` passe l'`Event` en 1er argument, qui satisfaisait silencieusement le
    paramètre `rows` (`rows = rows || store.getState().rows` ne retombe jamais sur le repli, l'Event
    étant "truthy") ; `distinctColumnValues(event, column)` plantait alors sur un Event non itérable.
    Corrigé en enveloppant l'appel dans une flèche (`() => updateAdvancedFilterFieldsForColumn()`)
    pour les deux `addEventListener` concernés.
  - **[BUG RÉEL #3 — staleness d'un cycle des lignes lors d'un changement de table]**
    `inferColumnKind`/`updateAdvancedFilterFieldsForColumn` lisaient `store.getState().rows`, mais
    `switchTable` appelle `refreshColumnSelects(rows)` **avant** `store.setRows(rows)` — un
    changement de table calculait donc le type de colonne et les suggestions de valeurs sur les
    lignes de l'ANCIENNE table pendant un cycle. Corrigé en faisant transiter `rows` explicitement
    depuis `refreshColumnSelects(rows)` (qui les a déjà, fraîches) plutôt que de les relire dans le
    store à un moment où elles ne le sont pas encore.
  - **[BUG RÉEL #4 — le plus significatif, pas spécifique à cette feature] Entrée sur une saisie
    strictement invalide (aucune correspondance) laissait fuiter l'évènement `change` NATIF du
    navigateur avec le texte brut non validé.** En ajoutant `openOnType()` qui ne présélectionne
    JAMAIS en mode `strict: false` (voir juste en dessous), il est apparu qu'un Entrée strict sans
    AUCUNE correspondance ne faisait qu'`return` sans jamais appeler `e.preventDefault()` — ce que
    seule la branche `commit()` faisait jusque-là. Résultat : le navigateur, constatant que la valeur
    de l'`<input>` a changé depuis le focus et qu'Entrée a été pressée, déclenche lui-même un
    évènement `change` natif AVEC LE TEXTE BRUT/INVALIDE, qui remonte (bubbles) et atteint tout
    listener `change` externe exactement comme une vraie sélection — court-circuitant complètement
    `commit()` et toute la validation stricte. Trouvé concrètement en tapant le nom d'une table qui
    n'existe pas encore dans le sélecteur de table (`#table-select`) et en pressant Entrée : ça
    déclenchait quand même une tentative de connexion à cette table inexistante
    (`switchTable('BI_Demo_Ventes', [])`, 0 ligne). Corrigé en ajoutant un `e.preventDefault()`
    explicite dans le cas strict-sans-correspondance aussi. Régression ajoutée à
    `combobox-test.js` (via `strictChangeCount`, un compteur d'évènements `change` observés).
  - **[Conséquence du bug #4 — révélait un vrai trou d'UX du sélecteur de table, déjà committé pour
    la Task #9]** Une fois le bug #4 corrigé, `table-picker-test.js` s'est mis à ÉCHOUER : sa
    capacité à "switcher" vers une table fraîchement créée (`BI_Demo_Ventes`) ne fonctionnait EN
    RÉALITÉ que grâce au bug #4 (la fuite d'évènement `change` natif laissait passer un nom de table
    tapé alors qu'il n'était pas encore dans la liste connue du sélecteur, `refreshTablePicker()` ne
    se relançant qu'au démarrage/après un changement réussi, jamais à l'ouverture du menu). Sans ce
    bug, une table créée après le démarrage du widget restait donc INATTEIGNABLE via le sélecteur
    tant qu'on ne rechargeait pas la page — un vrai défaut, pas juste un détail de test. Corrigé
    proprement en ajoutant un hook optionnel **`beforeOpen`** à `Combobox.attach()` : si fourni, il
    est attendu (`await`) avant d'afficher la liste à l'ouverture PASSIVE (focus/clic) — pas
    seulement au montage. `#table-select` est maintenant attaché avec `beforeOpen: refreshTablePicker`
    : la liste des tables se relit à CHAQUE ouverture du menu, garantissant qu'une table créée
    entre-temps reste toujours atteignable sans recharger le widget.
  - Testé : Node (`distinctColumnValues`, 6 assertions : ordre de 1re apparition, conversion en
    chaîne, valeurs vides ignorées, dédupliqué, plafonné, tableau vide) + Playwright
    (`filter-value-autocomplete-test.js`, 7 scénarios : suggestions = valeurs réelles dans l'ordre de
    1re apparition, ArrowDown+Entrée remplit sans soumettre, un Entrée nu soumet le formulaire comme
    les autres champs de la barre, sous-chaîne libre survit au blur + filtrage par sous-chaîne,
    changer de colonne ne corrige/écrase jamais une saisie libre, soumission réelle via le bouton
    "+ Filtre" avec effet sur les tuiles, changement de table rafraîchit bien les suggestions sur les
    lignes de la NOUVELLE table) + régression complète (`combobox-test.js` avec le nouveau cas
    `strictChangeCount`, `table-picker-test.js` re-vérifié après le fix `beforeOpen`, les 9 autres
    suites Playwright existantes, `dev-tests/test-data.js`) + capture d'écran clair/sombre montrant
    "cam" suggérant "Webcam HD" en surlignant la sous-chaîne tapée.
- **Retrait de la table de démo "rapide" (`BI_Demo_Ventes`)** (`js/grist-api.js`, `js/demo-data.js`,
  `dev-tests/test-data.js`) : demande explicite de l'utilisateur ("le widget a encore créé une
  nouvelle table... il faut retirer ce code on en a plus besoin"). `GristBI.api.loadOrCreateDemoData()`
  existait encore dans la surface PUBLIQUE de l'API (exposée sur `GristBI.api`) alors qu'aucun bouton
  ni aucun appel du produit ne s'en servait plus depuis le passage à la connexion automatique unique à
  `BI_StressTest` (voir plus haut, "connexion automatique") — seuls MES scripts de test l'appelaient
  encore, pour se fabriquer une 2e table à des fins de test du sélecteur de table. Du code mort côté
  produit, mais qui restait un risque réel : n'importe qui (y compris moi dans une future session)
  pouvait encore l'invoquer et créer une table supplémentaire dans le document de l'utilisateur.
  - Retiré : `DEMO_TABLE`/`LEGACY_DEMO_TABLE_NAMES` (grist-api.js), `loadOrCreateDemoData`, et côté
    demo-data.js tout ce qui n'était utile qu'à cette table (`COLUMNS`, `ANNEES`, `SEMAINES`,
    `buildSampleRows`, `defaultTiles`) — mais PAS `REGIONS`/`MOIS`/`PRODUITS`/`PRIX_BASE`, partagés
    avec la table de test de charge qui reste la SEULE table du widget. `deriveDateColumn` simplifiée
    (une seule forme de ligne à gérer désormais, `Jour` — plus de branche `Semaine` morte).
  - **`ensureColumnsUpToDate`/`migrateLegacyTableName` restent INTACTS** : la clarification de
    l'utilisateur ("sauf si à un moment on veut rajouter une date ou autre, et dans tous les cas ça
    sera dans une table dédiée et pas une nouvelle") confirme que ce mécanisme — ajouter une colonne
    à `BI_StressTest` déjà existante plutôt que de recréer une table — reste la seule façon prévue de
    faire évoluer le schéma à l'avenir, pour cette table déjà dédiée à cet effet.
  - Testé : `dev-tests/test-data.js` mis à jour (tests `buildSampleRows`/`defaultTiles` retirés avec
    le code qu'ils testaient ; test `deriveDateColumn` simplifié à la seule forme restante) +
    régression complète (12 suites Playwright, aucune ne créait cette table via du code produit —
    seuls mes scripts de test l'utilisaient directement, adaptés pour créer leur propre 2e table de
    test via le mock `grist.docApi.applyUserActions` plutôt que via une fonction produit vouée à
    disparaître, voir `create-mock-table.js` dans le scratchpad).
- **Bouton "Restaurer les tuiles par défaut"** (`index.html`, `dev-tests/harness.html`,
  `css/style.css`, `js/main.js`) : demande explicite de l'utilisateur ("j'ai l'impression que je
  n'ai plus de carte par défaut... peux-tu remettre quelques cartes par défaut ?"). Plutôt que
  d'essayer de corriger à distance une configuration sauvegardée dans le document Grist RÉEL de
  l'utilisateur (inaccessible depuis cette session — ni identifiants ni accès à son document), un
  bouton en libre-service : visible dans `#empty-state` uniquement quand (a) la page courante est
  vide ET (b) la table active est `BI_StressTest` — la SEULE table pour laquelle ce widget connaît
  des tuiles toutes faites (`GristBI.demoData.defaultLargeTiles()`). Un clic ajoute ces 4 tuiles à
  la page courante (`store.addTile`, pas `store.setPages`) : ne touche JAMAIS aux autres pages d'un
  dashboard multi-pages, contrairement à un reset complet qui aurait pu effacer un travail existant
  sur une autre page.
  - **`defaultTableId`** (nouvelle variable module de `main.js`) capture l'id réel retourné par
    `loadOrCreateStressData()` au bootstrap plutôt que de coder en dur la chaîne `'BI_StressTest'`
    dans `main.js` — cette chaîne reste la propriété de `grist-api.js`.
  - Le bouton n'apparaît JAMAIS sur une table quelconque choisie via le sélecteur : un dashboard vide
    y est un état NORMAL et voulu (voir le sélecteur de table plus haut : pas de `seedTiles` hors
    `BI_StressTest`), pas une anomalie à corriger — on ne connaît pas de tuiles par défaut sensées
    pour une table dont on ignore tout du contenu.
  - Testé : Playwright (`restore-default-tiles-test.js`, 5 scénarios : bouton caché tant que des
    tuiles existent, apparaît une fois la page vidée sur `BI_StressTest`, clic restaure exactement
    les 4 tuiles de `defaultLargeTiles()`, JAMAIS visible sur une autre table même vide, la
    restauration est bien persistée en y revenant) + capture d'écran clair/sombre de l'état vide
    avec le bouton visible.
- **Les éléments graphiques débordaient sous les cartes** (`css/style.css`) [BUG RÉEL remonté par
  l'utilisateur en réel : "les éléments graphique dépasse par le bas des cartes au lieu de rester
  dans les cartes"] — `.tile-chart { flex: 1; min-height: 180px; }` : ce `min-height` datait d'AVANT
  le passage de `.tile` à une hauteur FIXE (224px, correctif de la boucle resize↔layout documenté
  plus haut) et n'avait jamais été révisé à ce moment-là. Une fois `.tile` fixée à 224px, l'espace
  RÉELLEMENT disponible pour `.tile-chart` (224px moins padding/en-tête/fil d'Ariane) pouvait
  descendre sous 180px selon le contenu de la tuile — le `min-height` forçait alors `.tile-chart` (et
  le canvas ECharts qu'il contient) à occuper plus d'espace que ce qu'il restait, débordant du bas de
  la carte. Mesuré précisément (`canvas.getBoundingClientRect().bottom` contre
  `.tile.getBoundingClientRect().bottom`) : ~6px sur une tuile "au repos" (juste l'en-tête), jusqu'à
  ~22px sur une tuile drillée avec un fil d'Ariane à 2 niveaux réellement affiché (encore moins
  d'espace vertical disponible). Discret sur les captures d'écran précédentes de ce projet (6px passe
  facilement inaperçu), mais bien réel et cumulatif avec le nombre de niveaux de drill.
  - Corrigé en retirant simplement le `min-height` : `.tile` étant un conteneur flex COLONNE à
    hauteur FIXE, `flex: 1` seul sur `.tile-chart` suffit à occuper exactement tout l'espace restant
    après l'en-tête/le fil d'Ariane, sans jamais déborder (flex-shrink par défaut). Aucune autre
    logique à changer : `resizeAll()`/ECharts se redimensionnent déjà correctement au conteneur réel.
  - Même famille de leçon que le bug de croissance infinie (voir plus haut) : un réglage de layout
    devenu incohérent avec un changement structurel ultérieur (ici, `min-height` laissé après le
    passage de `.tile` à une hauteur fixe) doit être ré-audité AU MOMENT de ce changement, pas laissé
    en place parce que "ça avait l'air correct" sur les captures d'écran de l'époque.
  - Testé : Playwright (`tile-height-stability-test.js`, étendu) — aucun canvas ne déborde de sa
    carte à l'état initial (toutes les tuiles) ET sur une tuile drillée avec fil d'Ariane à 2 niveaux
    réellement affiché (pire cas mesuré manuellement avant le fix, ~22px) ; l'assertion de stabilité
    existante (hauteur invariante sur 8 cycles de resize) est conservée, seule l'ancienne assertion
    "180px partout" (devenue fausse par construction : la hauteur dépend maintenant de l'espace
    réellement disponible par tuile, pas d'un plancher uniforme) a été remplacée par la vérification
    de non-débordement, qui est la propriété qui compte réellement ici + capture d'écran clair/sombre
    avant/après montrant les libellés d'axe désormais bien contenus dans la carte.
- **Course au démarrage entre `grist.ready()` et le 1er appel `docApi` — risque de duplication de
  données réelles** (`js/grist-api.js`, `dev-tests/grist-stub.js`) [LE BUG LE PLUS GRAVE trouvé à ce
  jour dans ce projet — remonté par l'utilisateur : "le widget regénère encore une table ... pourquoi
  elle se lance encore ?"]. Diagnostic mené SANS accès à un vrai document Grist (rien dans ce sandbox
  ne peut le reproduire directement) : d'abord clarifié avec l'utilisateur (AskUserQuestion) ce qu'il
  observait précisément — une barre de progression "Création… X%" complète, pas juste un message de
  connexion, et confirmé qu'il testait bien la version déployée après un rechargement complet (pas un
  problème de cache navigateur/GitHub Pages).
  - **Cause racine** : `grist.ready()` ne renvoie PAS de promesse (vérifié contre le code source
    TypeScript réel de `grist-plugin-api.ts` — `WebFetch`/`WebSearch`, `support.getgrist.com` étant
    bloqué par le proxy réseau de ce sandbox, le dépôt GitHub `gristlabs/grist-core` a servi de
    source). La vraie négociation d'accès avec l'hôte Grist (un `postMessage` asynchrone,
    `rpc.sendReadyMessage()`) se termine APRÈS que `ready()` a déjà rendu la main à l'appelant.
    `bootstrap()` (`main.js`) enchaînait pourtant IMMÉDIATEMENT sur `grist.docApi.listTables()` sans
    le moindre délai — un appel parti avant la fin de cette négociation peut renvoyer une liste
    incomplète/vide, faisant croire à tort qu'une table n'existe pas encore. Comparé au widget frère
    `publipostageGrist` du même auteur (cité en tête de `grist-api.js` comme "dont on sait qu'il
    fonctionne en Grist réel") : celui-ci a naturellement plus de temps entre `ready()` et son premier
    VRAI appel `docApi`, car son flux attend `Editor.init()` (travail asynchrone indépendant) et son
    interaction principale part d'un message ENTRANT (`onRecord`, dont la seule réception prouve déjà
    que le canal est vivant) plutôt que d'un appel sortant immédiat — ce widget-ci n'a jamais eu cet
    amortisseur naturel, `bootstrap()` fonçant droit sur `listTables()`.
  - **Conséquence si non corrigée** : un faux négatif déclenche `AddTable` + le remplissage complet
    (`fillTable`) sur une table qui existe DÉJÀ — un rechargement du widget pouvait donc dupliquer les
    ~47 040 lignes de `BI_StressTest` dans le document RÉEL de l'utilisateur, potentiellement à
    CHAQUE réouverture. Jamais reproduit dans ce sandbox avant ce correctif : le mock `grist-stub.js`
    est entièrement synchrone (pas de vraie négociation réseau à rater), donc aucun des tests
    Playwright précédents — pourtant une couverture déjà large — n'a jamais pu exercer ce chemin.
  - **Correctif** : `tableExistsConfirmed()` — avant de conclure qu'une table n'existe VRAIMENT pas
    (et donc avant toute action destructrice de création), une seconde lecture FRAÎCHE (cache vidé)
    après un court délai (500ms), plutôt que de faire confiance à la toute première réponse. Limité au
    TOUT PREMIER contrôle d'existence de la session (`_raceGuardArmed`, une variable de fermeture qui
    se désarme après le premier appel) : une première version de ce correctif appliquait la
    revérification à CHAQUE contrôle d'existence (`BI_StressTest` PUIS `BI_Dashboard_Config`
    quelques instants plus tard) et cassait plusieurs tests existants (`multi-page-test.js`,
    `export-excel-test.js`, ...) à cause du délai cumulé (~1000ms) qui faisait courir les tests en
    avance sur le seeding réel des tuiles par défaut — corrigé en ne gardant la revérification QUE
    pour le 1er appel de la session, le seul moment où la négociation d'accès peut réellement être
    encore en cours (tout appel `docApi` réussi ultérieur prouve déjà que le canal est vivant).
    `loadOrCreateTable` calcule désormais `alreadyExists` UNE SEULE fois (via `tableExistsConfirmed`)
    et le réutilise pour LES DEUX décisions (créer la table ET la remplir), au lieu de deux
    vérifications séparées (`ensureTableExists` a été fusionnée dans `loadOrCreateTable`) qui
    pouvaient en théorie se contredire à des instants différents.
  - **Découverte indépendante en cours de route** : `grist.docApi.listTables()` renvoie en réalité un
    tableau de CHAÎNES (`Promise<string[]>`, vérifié contre le code source réel), pas des objets
    `{id}` — le mock `grist-stub.js` renvoyait des objets `{id}` depuis le tout début du projet, donc
    AUCUN test Playwright précédent n'a jamais exercé la branche `typeof t === 'string'` du code
    défensif qui gère les deux formes (`(typeof t === 'string' ? t : t.id)`, présent dans le code
    depuis le début). Cette branche s'est avérée correcte une fois vérifiée, mais c'était un angle
    mort de couverture jamais remarqué avant cet incident. Corrigé dans le mock pour refléter la
    vraie forme de l'API — tous les tests existants ont été revérifiés après ce changement.
  - **Simulation déterministe pour les tests** (`dev-tests/grist-stub.js`) : `window.__gristStubRaceCalls`
    (compteur d'appels, pas un vrai délai réseau — déterministe, aucune flakiness liée au timing réel
    d'un test) fait renvoyer `[]` à `listTables()` pour les N premiers appels, simulant le faux négatif
    sans dépendre d'une vraie course réseau à gagner/perdre dans un test automatisé.
    `window.__gristStubPreseed` (injecté via `page.addInitScript()`, donc AVANT que `grist-stub.js` ne
    s'exécute) simule un document qui a DÉJÀ ces tables d'une session widget précédente — le seul
    contexte où un faux négatif a un sens (sur une table qui vient tout juste d'être créée dans LA
    session courante, il n'y a rien à "retrouver"). **[BUG DE TEST trouvé en écrivant ce test]** :
    `grist-stub.js` réinitialisait inconditionnellement `window.__gristStubRaceCalls = 0` à son
    chargement, écrasant SILENCIEUSEMENT la valeur armée par `page.addInitScript()` avant même que le
    script ne s'exécute — la simulation de course était donc totalement inopérante, et le test
    "passait" indépendamment de la présence du correctif (il ne vérifiait littéralement rien).
    Découvert en vérifiant explicitement que le test échoue SANS le correctif (`git stash` isolant
    temporairement `js/grist-api.js` à son état pré-correctif) avant de le considérer comme fiable —
    exactement la méthode qui a permis de repérer que la simulation ne s'armait pas : le test passait
    aussi bien AVEC que SANS le correctif, un signal fort qu'il ne testait rien de significatif.
    Corrigé (`if (typeof window.__gristStubRaceCalls !== 'number') window.__gristStubRaceCalls = 0;`),
    puis reconfirmé que le test échoue bien sans le correctif ET passe avec.
  - Testé : Playwright (`table-race-test.js`, 3 scénarios : session sans course = création normale ;
    session avec course simulée sur une table déjà existante = PAS de recréation, PAS de duplication
    de lignes ; sans course réelle, le rattrapage ne coûte jamais plus d'un délai par session) +
    vérifié positivement (le test échoue bien sans le correctif, via `git stash`) + régression
    complète (`dev-tests/test-data.js` + les 12 autres suites Playwright existantes, aucune affectée
    par le passage du mock à la vraie forme `string[]` sauf `schema-migration-test.js` dont
    l'assertion `.map(t => t.id)` a été corrigée en conséquence).
  - **Reste À VALIDER en conditions réelles** (voir aussi la section dédiée plus bas) : le délai de
    500ms est un choix pragmatique, jamais calibré contre le vrai timing de négociation d'accès Grist
    — une négociation anormalement lente (réseau très dégradé) pourrait en théorie excéder ce délai et
    laisser le faux négatif se reproduire malgré le correctif. Pas de mécanisme de retry illimité par
    prudence (éviter qu'un widget bloqué sur un problème de connexion réessaie indéfiniment).
  - **[EXACTEMENT CE QUI ÉTAIT REDOUTÉ CI-DESSUS S'EST PRODUIT]** L'utilisateur a remonté le MÊME bug
    une seconde fois après ce premier correctif, sur GitHub Pages avec un rechargement franc (donc pas
    un problème de cache navigateur/CDN) : la barre de progression "Création…" s'est de nouveau
    affichée en entier sur une table qui existait déjà réellement. Voir l'entrée "Correctif v2"
    ci-dessous.
- **Correctif v2 de la course au démarrage — budget d'attente renforcé + filet de sécurité indépendant
  basé sur la collision `AddTable`** (`js/grist-api.js`) [BUG RÉEL remonté DEUX FOIS par
  l'utilisateur — voir l'entrée précédente pour le premier correctif, insuffisant en conditions
  réelles].
  - **Diagnostic** : le délai fixe de 500ms (un seul essai de rattrapage) du premier correctif s'est
    révélé insuffisant — la vraie négociation d'accès avec l'hôte Grist peut visiblement dépasser
    500ms selon le réseau/la charge du document réel (jamais mesuré précisément : ce sandbox ne peut
    reproduire un vrai aller-retour réseau avec l'hôte Grist, seulement le simuler via
    `window.__gristStubRaceCalls`).
  - **Recherche de source primaire (avant de corriger)** : plutôt que d'augmenter le délai au hasard,
    vérifié contre le code source réel de `gristlabs/grist-core` (via `WebFetch`, `support.getgrist.com`
    étant bloqué par le proxy réseau de ce sandbox) s'il existe un signal EXPOSÉ et fiable de fin de
    négociation, plutôt qu'une valeur de délai devinée :
    - `grist-plugin-api.ts` : la promesse interne `_initialization`/`_setInitialized` existe bel et
      bien, mais elle n'est utilisée QUE par `getSelectedTableId()` (liée à la sélection de table dans
      la page hôte, sans rapport avec `docApi`) — aucune fonction exportée de `docApi`
      (`listTables`/`fetchTable`/`applyUserActions`) n'attend cette promesse en interne. Confirmé :
      il n'existe AUCUNE API exposée qu'un auteur de widget pourrait attendre pour savoir avec
      certitude que la négociation est terminée — une stratégie à base de délai/retry reste
      nécessaire, il n'y a pas de meilleure option côté client.
    - `sandbox/grist/useractions.py` (le moteur de données, PAS le SDK JS) : `AddTable` appelle
      `identifiers.pick_table_ident(table_id, avoid=self._engine.tables.keys())` — **le moteur Grist
      ne lève JAMAIS d'erreur quand `table_id` existe déjà : il suffixe silencieusement l'id
      réellement créé pour éviter la collision** (ex. `BI_StressTest` → `BI_StressTest2`), et
      `doAddTable` renvoie `{id, table_id, columns}` où `table_id` est cet id RÉEL (potentiellement
      différent de celui demandé). C'est cette découverte qui a permis le filet de sécurité
      indépendant ci-dessous — sans cette recherche de source primaire, la seule option restante
      aurait été d'augmenter encore le délai au hasard, sans jamais être VRAIMENT sûr.
  - **Correctif, partie 1 — budget d'attente renforcé** : `tableExistsConfirmed` retente maintenant
    avec un délai CROISSANT (`RACE_GUARD_RETRY_DELAYS_MS = [300, 600, 1200, 2400, 4800]`, ~9,3s au
    total dans le pire cas) au lieu d'un unique délai fixe de 500ms. Toujours limité au tout premier
    contrôle d'existence de la session (`_raceGuardArmed`, inchangé). Compromis délibérément prudent :
    une table réellement neuve ne paie cette rallonge qu'UNE SEULE fois dans toute la vie du document
    (coût mineur : un peu plus de "Connexion…" affiché), alors qu'un faux négatif coûte potentiellement
    des dizaines de milliers de lignes dupliquées dans le document réel de l'utilisateur.
  - **Correctif, partie 2 — filet de sécurité INDÉPENDANT, la vraie nouveauté de ce correctif** :
    même si le budget d'attente ci-dessus s'avère malgré tout insuffisant (négociation anormalement
    longue, au-delà de ~9,3s), `loadOrCreateTable` et `ensureConfigTableExists` comparent désormais
    systématiquement le `table_id` RÉELLEMENT renvoyé par `AddTable` (voir `actualAddTableId`) au
    `tableId` demandé. S'ils diffèrent, c'est la preuve DÉTERMINISTE (pas une heuristique de timing)
    qu'un faux négatif a échappé au garde-fou anti-course : le code abandonne IMMÉDIATEMENT tout
    remplissage de la table nouvellement créée (fantôme, vide, sans rapport avec les vraies données),
    logue un `console.error` explicite, et retombe sur le chemin "la table existe déjà" — garanti sans
    duplication, quel que soit le délai que la négociation d'accès a réellement pris. La table fantôme
    vide reste orpheline dans le document (jamais nettoyée via `RemoveTable`, verbe délibérément jamais
    utilisé dans ce projet — voir plus haut dans ce fichier — un orphelin visible et inoffensif est
    préférable à un verbe de suppression jamais éprouvé dans le chemin de code le plus critique du
    widget côté sécurité des données). Ce filet de sécurité rend le correctif robuste par CONSTRUCTION
    plutôt que par un choix de délai, aussi généreux soit-il — le budget d'attente réduit juste la
    fréquence à laquelle ce filet doit intervenir en pratique.
  - **[3e BUG RÉEL, trouvé en construisant la matrice de tests croisés de ce correctif, pas remonté par
    l'utilisateur]** `migrateLegacyTableName` (renomme un ancien nom de table versionné vers le nom fixe
    actuel si besoin) faisait ses propres contrôles d'existence via le `tableExists` simple, SANS AUCUNE
    protection anti-course, dans EXACTEMENT la même fenêtre de risque, juste AVANT le garde-fou
    principal. L'ancien raisonnement documenté à côté de cette fonction ("un faux négatif ici mène au
    pire à une tentative de RENOMMAGE inutile, pas à une duplication de données") ne couvrait que le cas
    où c'est `tableId` (le nom fixe) qui est faussement vu comme absent. Il manquait le cas inverse : si
    c'est le NOM LEGACY qui est faussement vu comme absent (alors qu'il existe réellement, avec ses
    propres dizaines de milliers de lignes) pendant que `tableId` est authentiquement absent, le
    renommage nécessaire est purement et simplement SAUTÉ — la table legacy reste orpheline sous son
    ancien nom, et `loadOrCreateTable` (juste après) crée et remplit un `tableId` tout neuf de zéro :
    deux tables contenant chacune le jeu de données complet. Ce n'est pas une "duplication" au sens
    strict (pas la MÊME table qui grossit), mais la même conséquence concrète pour l'utilisateur
    (données dupliquées dans le document, table orpheline à gérer manuellement). Corrigé en réutilisant
    `tableExistsConfirmed` pour ces deux contrôles aussi (le contrôle du nom fixe devient alors le tout
    premier de la session, consommant le budget renforcé ; les contrôles suivants — noms legacy, puis
    le contrôle principal de `loadOrCreateTable` — réutilisent un canal déjà prouvé actif, comme prévu
    par la conception de `_raceGuardArmed`). `tableExists` (la fonction simple, non protégée) est
    devenue totalement inutilisée après ce changement et a été supprimée.
  - **Simulation étendue pour les tests** (`dev-tests/grist-stub.js`) : `AddTable` renvoie maintenant
    un `retValues[0]` réaliste (`{id, table_id, columns}`, comme le vrai moteur) au lieu de `null`.
    `window.__gristStubCollideOnAddTable` (un tableId, ou `true`) simule la collision silencieuse
    décrite ci-dessus : au prochain `AddTable` visant ce tableId, le mock crée la table sous un id
    suffixé (`${tableId}2`, `${tableId}3`, ...) SANS toucher à la table existante — consommé une seule
    fois (remis à `null` après usage), comme `__gristStubRaceCalls`.
  - **Testé** : `table-race-test.js` étendu de 3 à **9 scénarios** croisant systématiquement course
    (résolue tôt / tardivement / budget entièrement épuisé) × existence réelle de la table (neuve /
    déjà là) × collision `AddTable` (sur `BI_StressTest` ET isolément sur `BI_Dashboard_Config`) ×
    renommage legacy sous course × idempotence sur plusieurs rechargements successifs × coût nul du
    chemin normal. **Vérifié positivement scénario par scénario** : `git stash` isolant temporairement
    l'ancien `js/grist-api.js`/`grist-stub.js` — 6 des 9 scénarios échouent bien contre l'ancien code
    (les 3 qui passent aussi bien avant qu'après sont les scénarios qui ne sollicitent pas les
    mécanismes ajoutés par ce correctif : 1er essai résolu tôt, chemin normal sans course, et la toute
    première connexion sans rien de préexistant) avant de repasser au vert une fois le correctif
    restauré — même méthode que le premier correctif, appliquée cette fois à TOUTE la matrice plutôt
    qu'à un seul scénario. Non-régression complète : `dev-tests/test-data.js` + les 13 autres suites
    Playwright existantes (dont `duckdb-engine-test.js`), toutes encore vertes après ce changement.
  - **Reste une limite THÉORIQUE résiduelle, documentée plutôt que corrigée** (jugée acceptable) :
    `migrateLegacyTableName` peut encore, dans un cas EXTRÊME (négociation d'accès qui ne se termine
    toujours pas après les ~9,3s de budget déjà généreux), rater un renommage legacy — contrairement au
    chemin principal `BI_StressTest`/`BI_Dashboard_Config`, ce cas précis n'est pas protégé par le
    filet de sécurité basé sur la collision `AddTable` (`AddTable('BI_StressTest', ...)` ne rencontre
    alors aucune collision, puisque ce nom exact n'existe réellement pas — seul le nom legacy existe).
    Nécessiterait un réseau anormalement dégradé ET la présence d'une table sous un ancien nom versionné
    (situation déjà rare, seulement pertinente pour une installation antérieure à l'adoption du nom
    fixe) pour se manifester. Non corrigé plus avant : le coût d'ajouter une troisième couche de
    protection pour un cas nécessitant DEUX conditions rares simultanées n'a pas semblé justifié face à
    la complexité ajoutée — mais documenté ici explicitement plutôt que laissé silencieux.
  - **Revue adversariale du correctif v2 via le Workflow tool** (4 agents en parallèle, chacun avec un
    angle différent — arithmétique du retry, exhaustivité de la détection de collision, vraie
    concurrence multi-onglets, réalisme de la matrice de tests — puis vérification adversariale
    indépendante de chaque signalement, demande explicite de l'utilisateur : "croiser vraiment tous
    les scénarios avec des vérifications"). 15 signalements, tous confirmés "réels" par la passe de
    vérification, mais qui se sont avérés recouvrir en pratique un petit nombre de mécanismes
    distincts une fois regroupés :
    - **Mécanisme réellement nouveau et corrigé** : `_rawTables` pouvait rester positionné sur le
      dernier tableau lu (potentiellement encore contaminé par la course) après épuisement du budget
      de `tableExistsConfirmed`, sans jamais être explicitement vidé — un contrôle suivant (ex. le nom
      legacy) réutilisait alors ce cache SANS le moindre nouvel appel réseau, ratant une lecture
      fraîche à laquelle il aurait pourtant droit si la négociation venait tout juste de se terminer.
      Corrigé (`_rawTables = null` sur épuisement). Referme la fenêtre pour le cas où la négociation se
      termine PENDANT le contrôle suivant ; ne résout PAS le cas encore plus extrême déjà documenté
      juste au-dessus (négociation dépassant la totalité du budget) — aucun mécanisme à délai borné ne
      peut couvrir un délai réseau non borné, ce n'est pas un oubli mais une limite de nature
      différente. Vérifié via `git stash` ciblé (juste cette ligne) : le scénario 7/10 de
      `table-race-test.js` (course EXACTEMENT calibrée pour épuiser le budget du 1er contrôle, ni plus
      ni moins) échoue bien sans cette ligne et passe avec.
    - **Même mécanisme de collision silencieuse que `AddTable`, mais sur `RenameTable`** : le moteur
      Grist réel applique la MÊME logique d'unicité (`identifiers.pick_table_ident`, vérifié cette fois
      contre `sandbox/grist/useractions.py:_updateTableRecords`, le gestionnaire réel de
      `RenameTable`) à la destination d'un renommage — mais `RenameTable` ne renvoie RIEN
      d'exploitable (`retValues` vaut `None` côté moteur, contrairement à `{id, table_id, columns}`
      pour `AddTable`), donc impossible de le détecter aussi déterministement. Ajouté un CONSTAT après
      coup (nouveau contrôle `tableExistsConfirmed(tableId)` juste après le `RenameTable`, avec
      `console.error` explicite si le nom attendu n'est toujours pas là) — une détection, pas une
      prévention : si la collision se produit, les données de la table legacy sont déjà renommées sous
      un id imprévisible avant qu'on puisse s'en apercevoir. Le déclencheur réel exige qu'un second
      acteur crée `tableId` entre le contrôle de `migrateLegacyTableName` et son appel `RenameTable` —
      une VRAIE concurrence à deux acteurs (voir plus bas), structurellement impossible à simuler dans
      une seule page Playwright séquentielle : le scénario 10/10 force donc directement la collision
      via un nouveau hook de mock (`__gristStubCollideOnRenameTable`) pour vérifier le MÉCANISME de
      détection en assumant le déclencheur plutôt qu'en le reproduisant — vérifié qu'il échoue bien
      sans le nouveau contrôle (`git stash` ciblé) et détecte bien la collision avec.
    - **Mock `AddTable` rendu réaliste par défaut** : la simulation de collision n'était auparavant
      déclenchée que sur demande explicite (`__gristStubCollideOnAddTable`) — un signalement a
      justement noté que cela laissait n'importe quel AUTRE test futur créant une table déjà existante
      passer complètement à côté de ce filet de sécurité, contrairement au vrai moteur qui suffixe
      TOUJOURS, inconditionnellement. Le mock détecte désormais la collision dès que le tableId visé
      existe déjà réellement dans son état interne (typiquement via `__gristStubPreseed`), le hook
      manuel restant disponible pour FORCER une collision artificielle sur un nom qui n'entrerait
      sinon pas en collision. A permis de simplifier les scénarios 5/10 et 6/10 (plus besoin de forcer
      la collision manuellement, elle découle naturellement de l'état préseedé — plus fidèle au
      comportement réel).
    - **Signalements jugés RÉELS mais explicitement écartés de ce correctif (scope volontairement
      limité)**, documentés ici pour ne pas être perdus :
      - `AddColumn` (`ensureColumnsUpToDate`) est exposé à la même classe de risque de collision que
        `AddTable`/`RenameTable`, mais la conséquence est un simple ajout de colonne orpheline (dérive
        de schéma), pas une duplication de lignes — bien moins grave, et nécessite la même précondition
        de vraie concurrence multi-acteurs que ci-dessus. Non traité ici.
      - **Vraie concurrence à deux onglets/deux sessions du widget sur le MÊME document réel** (pas la
        course de négociation au démarrage que ce correctif cible) : `saveConfig` peut créer deux
        lignes `AddRecord` concurrentes pour le même `tableId` dans `BI_Dashboard_Config` (une
        config/dashboard silencieusement perdue), et `AddColumn`/`RenameTable` peuvent aussi y être
        exposés. C'est une classe de problème DIFFÉRENTE et structurellement plus difficile (nécessite
        une vraie synchronisation multi-session, pas juste un budget d'attente plus généreux) que celle
        remontée par l'utilisateur (course contre `grist.ready()` dans une SEULE session) — jugée hors
        du périmètre de ce correctif, mais notée ici comme piste future si des utilisateurs multiples
        éditent effectivement le même document simultanément avec ce widget ouvert.
      - `grist.docApi.listTables()`/`fetchTable()`/`applyUserActions()` REJETANT (levant une erreur)
        plutôt que renvoyant une liste vide pendant la fenêtre de course n'est testé nulle part. Analysé
        comme déjà "sûr" par construction plutôt que corrigé : une telle rejection remonterait
        jusqu'au `try/catch` de `bootstrap()` (`main.js`), qui affiche déjà "Échec de la connexion aux
        données" plutôt que de risquer une duplication silencieuse — un échec visible, pas une
        corruption invisible, donc pas la même urgence que le bug initialement remonté.
- **Fondation moteur SQL DuckDB-WASM** (`js/duckdb-engine.js`, `js/vendor/duckdb/`,
  `js/vendor/apache-arrow/`, `js/vendor/flatbuffers/`, `js/vendor/tslib/`) — Roadmap Tier 2, décidé
  avec l'utilisateur (choix explicite parmi les chantiers Tier 2 listés, PR séparée plutôt qu'un
  push direct sur `main` comme jusqu'ici, sur sa demande).
  - **Poids réel découvert en récupérant le paquet officiel, PAS anticipé par le simple libellé du
    ROADMAP** : le binaire `.wasm` de DuckDB fait à lui seul ~34 Mo (un vrai moteur SQL complet —
    parseur, planificateur, exécuteur — compilé en WASM, pas une petite bibliothèque JS comme
    ECharts ~1 Mo déjà vendorisé). Confirmé explicitement avec l'utilisateur avant de vendoriser quoi
    que ce soit (AskUserQuestion) : chargement PARESSEUX retenu plutôt qu'un chargement bloquant au
    démarrage — rien dans `bootstrap()` (`main.js`) n'appelle `GristBI.duckdbEngine.init()`, seule
    une future feature qui en a RÉELLEMENT besoin (mesures/pivot/blending) le fera. Puisque les
    fichiers sont servis depuis la même origine que le reste du widget (GitHub Pages, pas un CDN),
    aucun octet n'est téléchargé tant qu'aucun code n'appelle explicitement le moteur — confirmé par
    un test dédié qui intercepte toutes les requêtes réseau et vérifie qu'aucune ne part avant un
    premier appel explicite.
  - **Bundle "eh" uniquement** (mono-thread, exceptions WASM) : pas "coi" (multi-thread, exigerait
    des en-têtes COOP/COEP non réglables sur une page statique GitHub Pages), pas "mvp" (redondant,
    "eh" est disponible dans tous les navigateurs évergreens visés par ce widget).
  - **[PIÈGE RÉEL trouvé en développant, pas juste une difficulté de packaging]** Le bundle ESM
    officiel de DuckDB-WASM (`duckdb-browser.mjs`) importe `"apache-arrow"` par un spécificateur NU,
    qui n'existe pas nativement dans un navigateur sans bundler — resolu via une `<script
    type="importmap">` pointant vers une copie d'`apache-arrow` vendorisée localement (son propre
    arbre `.mjs`, ~1 Mo, imports relatifs uniquement une fois `bin/`/les fichiers spécifiques à Node
    exclus), qui a elle-même révélé des dépendances transitives à vendoriser en cascade
    (`flatbuffers` pour le format IPC Arrow, puis `tslib` pour les fonctions utilitaires TypeScript
    compilées) — jamais un CDN externe (`unpkg`/`jsdelivr`, bloqués par la politique de ce projet ET
    par le proxy réseau de ce sandbox), cohérent avec ECharts/SheetJS déjà embarqués de la même façon.
  - **[BUG RÉEL le plus significatif de cette fondation, trouvé en testant réellement une requête,
    pas en lisant la documentation]** Le plan initial utilisait `read_json_auto`/`read_ndjson_auto`
    pour charger les lignes (format naturel pour des objets JS) — au premier appel RÉEL, DuckDB-WASM
    déclenche le TÉLÉCHARGEMENT DYNAMIQUE de l'extension "json" depuis `extensions.duckdb.org`, un
    VRAI serveur tiers externe, exactement le genre de dépendance à un CDN externe que ce projet
    évite partout ailleurs (et qu'un réseau restrictif pourrait tout aussi bien bloquer — même
    famille de risque que le CDN ECharts bloqué documenté plus haut dans ce fichier). Repéré
    uniquement en observant une vraie requête réseau échouer dans ce sandbox (`net::ERR_TUNNEL_
    CONNECTION_FAILED` vers `extensions.duckdb.org`), jamais visible en lisant la seule API TypeScript.
    Corrigé en remplaçant JSON par CSV (`read_csv_auto`, sérialisation maison avec échappement
    standard des virgules/guillemets/retours à la ligne) : le support CSV fait partie du CŒUR de
    DuckDB, déjà compilé dans le binaire `.wasm` vendorisé, aucun téléchargement supplémentaire à
    l'exécution — vérifié explicitement par un test qui intercepte toutes les requêtes et confirme
    qu'aucune ne sort vers un autre domaine que celui du widget, même après un usage RÉEL du moteur
    (pas seulement à l'état initial, qui aurait pu masquer un appel déclenché uniquement à l'usage).
  - **Ordre de regroupement (`GROUP BY`)** : DuckDB ne garantit PAS de préserver l'ordre d'insertion,
    alors que `js/data.js:groupByAggregate` le garantit explicitement (1re apparition, pas
    alphabétique — voir ses propres tests). Reproduit en ajoutant une colonne `__row_idx` (position
    d'origine) à chaque chargement, puis `ORDER BY MIN("__row_idx")` à l'agrégation — un contrat
    explicite plutôt qu'une dépendance à un comportement d'implémentation non documenté qui pourrait
    changer entre deux versions de DuckDB-WASM.
  - **Testé en navigateur réel (Playwright), PAS sous Node** : `import()` dynamique de module ES est
    bloqué par CORS sur `file://` (origine `"null"`) — contrairement à tous les scripts classiques du
    reste de ce projet (`<script src="...">`, jamais de module ES ailleurs), qui n'en ont pas besoin
    et fonctionnent très bien via `file://`. Le test dédié sert donc le dépôt via un petit serveur
    HTTP local (`http.createServer` de Node, sans dépendance ajoutée) plutôt que `file://`, une
    première dans ce projet — voir TEST_PROTOCOL.md. `csvEscape`/`assertSafeIdentifier` (logique pure,
    aucune dépendance à `document`/WASM/Worker) restent testés sous Node comme le reste, même
    séparation que `js/combobox.js` entre logique pure et câblage DOM/navigateur.
  - **Équivalence vérifiée avec `js/data.js`, pas juste "ça tourne sans erreur"** : `groupByAggregate`
    et `aggregateSingle` comparés RÉSULTAT PAR RÉSULTAT à leurs équivalents purs JS, sur les 47 040
    lignes réelles du jeu de test de charge, pour les 5 agrégateurs (sum/avg/count/min/max) et
    plusieurs combinaisons dimension/mesure — identiques (aux arrondis de précision flottante près
    entre `SUM(DOUBLE)` SQL et `reduce` JS, négligeables). **Limite assumée, pas vérifiée** : cette
    équivalence porte sur les colonnes numériques PROPRES réellement utilisées par ce widget
    (Montant/Quantite...) ; une colonne à valeurs mixtes texte/nombre pourrait diverger subtilement
    entre `TRY_CAST(... AS DOUBLE)` (SQL, renvoie NULL sur échec) et `Number(v)` (JS, renvoie NaN sur
    échec, propagé différemment selon l'agrégateur) — jamais un cas réel dans ce widget à ce jour, pas
    vérifié pour autant.
  - **Coût réel mesuré, pas juste supposé rapide parce que "c'est du SQL compilé"** : sur les 47 040
    lignes réelles, chaque appel `groupByAggregate`/`aggregateSingle` RECHARGE les lignes dans une
    table temporaire (sérialisation CSV + transfert vers le Worker + `CREATE TABLE` + la requête +
    `DROP TABLE`) — sensiblement PLUS LENT que l'agrégation JS pure actuelle sur ce même volume
    (dizaines de centaines de ms par appel ici, contre ~20-30ms pour `Array.reduce` mesuré ailleurs
    dans ce fichier). Attendu et assumé pour une fondation stateless qui reproduit fidèlement le
    contrat de `js/data.js` (pas d'état caché entre deux appels) : la valeur de ce moteur n'est pas
    de battre `Array.reduce` sur une agrégation simple isolée, mais de permettre des requêtes SQL
    que `Array.reduce` ne peut pas exprimer du tout (fenêtres pour YTD/N-1, pivot, jointures pour le
    data blending) — les features Tier 2 qui consommeront réellement ce moteur. Une feature qui
    enchaîne PLUSIEURS requêtes sur les MÊMES lignes (ex. un pivot qui recalcule à chaque interaction)
    voudra probablement garder une table chargée entre les appels plutôt que la recharger à chaque
    fois — laissé à cette feature future plutôt que d'ajouter cette gestion d'état ici sans un
    consommateur réel pour la dimensionner correctement.
  - Testé : Node (`csvEscape`/`assertSafeIdentifier`, logique pure) + Playwright, servi en HTTP local
    (chargement paresseux vérifié — aucune requête avant un premier appel explicite ; résultats
    identiques à `js/data.js` sur 8 combinaisons `groupByAggregate` + 5 `aggregateSingle`, jeu de
    47 040 lignes réel ; aucune requête réseau externe même après usage réel, régression directe du
    piège de l'extension JSON ci-dessus ; garde-fou contre l'injection SQL sur un nom de colonne) +
    régression complète (`dev-tests/test-data.js` + les 13 autres suites Playwright existantes,
    aucune affectée).
- **Mesures façon DAX simplifié — Cumul / YTD / Comparaison N-1** (`js/duckdb-engine.js`,
  `js/data.js`, `js/charts.js`, `js/main.js`, Roadmap Tier 2, demande explicite de l'utilisateur :
  "les mesures simplifiées façon DAX... c'est-à-dire YTD, N-1 et cumul") — **1re feature à consommer
  réellement le moteur DuckDB-WASM** (posé le 2026-09-16, inutilisé jusqu'ici) :
  - **`GristBI.duckdbEngine.timeSeriesMeasures(rows, dateCol, measureCol, aggFn)`** : bucket MENSUEL
    fixe (pas configurable en v1, sous-ensemble ciblé assumé — voir ROADMAP.md) sur une vraie colonne
    Date choisie explicitement par l'utilisateur (`TRY_CAST(... AS DATE)`, pas de détection
    automatique du type comme `inferColumnKind` ailleurs dans ce projet), puis calcule en UNE requête
    SQL les 3 variantes via des fonctions FENÊTRÉES : `cumulative` = `SUM() OVER (ORDER BY période
    ROWS UNBOUNDED PRECEDING)` ; `ytd` = la même somme mais `PARTITION BY` l'année (repart à zéro à
    chaque nouvelle année, équivalent simplifié de `TOTALYTD`/`DATESYTD`) ; `previousYear` = une
    AUTO-JOINTURE sur le mois décalé d'exactement un an (`period - INTERVAL '1 year'`), PAS un
    `LAG(12)` à distance de ligne fixe — un `LAG` déraperait silencieusement sur un mois manquant
    (ex. après un filtre), l'auto-jointure retrouve le bon mois même avec un trou (même raisonnement
    que `data.js:computeTrend`, qui compare des CLÉS de période, jamais une distance de lignes).
    C'est précisément la valeur ajoutée de consommer ce moteur plutôt que `js/data.js` : une somme
    fenêtrée SQL exprime "recalculer une mesure selon un contexte de filtre temporel" en une requête
    déclarative (voir ROADMAP.md, tableau "C'est quoi un vrai moteur BI ?"), ce qu'`Array.reduce` ne
    fait pas nativement.
  - **`GristBI.data.measureSeriesForTile(measureMode, timeSeries)`** : transforme pure (testable sous
    Node) le résultat SQL en catégories/séries affichables selon le mode ('cumulative'/'ytd' → 1
    série, 'yoy' → 2 séries "Valeur"/"N-1") — charts.js ne fait plus que mapper `series` sur des
    séries ECharts, la logique de sélection de champ reste testée sans navigateur.
  - **Intégration UI** : nouveau champ "Mode" (Brut/Cumul/YTD/Comparaison N-1) sur une tuile "Barres"
    uniquement — pie/treemap/scatter/kpi/gauge ne sont pas concernés (pas de notion d'axe temporel
    ordonné pour un camembert/treemap, KPI/gauge n'ont qu'une seule valeur). Un mode non-Brut masque
    Dimension/Drill-down (comme KPI/jauge, voir `formHasNoDimension`) et affiche à la place "Colonne
    date" (combobox comme tous les autres champs de colonne de ce projet) : l'axe X est TOUJOURS le
    mois calculé depuis cette colonne, jamais la dimension choisie ailleurs.
  - **Rendu ASYNCHRONE, une première dans ce widget** : contrairement à TOUTES les autres tuiles
    (rendu synchrone, `Array.reduce` ou SQL non fenêtré), `renderMeasureChart` attend une vraie
    requête SQL DuckDB-WASM avant d'appeler `setOption`. Deux garde-fous ajoutés pour cette
    nouveauté :
    1. **Course entre rendus** (`measureRenderSeq`, un compteur par tuile) : un nouveau rendu (filtre
       posé, tuile éditée/supprimée) peut démarrer avant qu'un calcul SQL précédent n'ait fini — seul
       le résultat du DERNIER appel lancé pour une tuile s'applique, un résultat périmé qui revient
       après est silencieusement abandonné (vérifié en repassant Cumul → YTD → Comparaison N-1 en
       édition rapide, jamais de flash de l'ancien résultat).
    2. **Instance ECharts partagée entre les deux chemins de rendu** (`getOrCreateChartInstance`,
       factorisée hors de `renderChart`) : une tuile peut passer de Brut à un mode mesure (et
       inversement) au fil des éditions ; sans cette factorisation, le gestionnaire de clic n'aurait
       été attaché QUE par le chemin ayant créé l'instance en premier — repéré en écrivant le test
       Playwright de bascule aller-retour (voir plus bas), pas remonté par l'utilisateur.
  - **Pas de clic exploitable sur une tuile en mode mesure** : un point de la série est un mois
    CALCULÉ par DuckDB (bucket), pas une vraie valeur de la dimension d'origine — le gestionnaire de
    clic partagé se relit à l'état vivant de la tuile (même pattern que le reste de ce fichier) et
    ne fait rien pour ce cas plutôt que de poser un cross-filter/drill-down incohérent.
  - **Export Excel** : `tileExportSheet`/`buildWorkbookSheets` (`js/data.js`) sont volontairement
    PURES/synchrones (testées sous Node) — les rendre asynchrones pour cette seule feature aurait
    changé la signature de toute la chaîne d'export pour un unique consommateur. Une tuile en mode
    mesure exporte donc un texte explicite ("Export non disponible...") plutôt qu'une ligne
    "undefined" trompeuse (sans ce cas particulier, `dimension` vide aurait produit un seul groupe
    non significatif) — limite assumée et documentée, pas silencieuse.
  - Testé : Node (`data.periodLabel`/`data.measureSeriesForTile` sur un résultat synthétique
    volontairement non trivial — valeurs négatives, `previousYear: null` pour la 1re année, ordre non
    trivial ; `tileExportSheet` sur une tuile en mode mesure) + Playwright, servi en HTTP local comme
    le reste de ce qui touche DuckDB : (a) arithmétique SQL vérifiée à la main sur un jeu déterministe
    avec un mois manquant en 2026 (vérifie l'auto-jointure plutôt qu'un LAG) et une ligne de date
    invalide (ignorée) ; (b) aucune requête réseau externe pendant `timeSeriesMeasures` (même garde
    que `groupByAggregate`/`aggregateSingle`) ; (c) contre le VRAI formulaire (`dev-tests/harness.html`,
    47 040 lignes réelles de `BI_StressTest`) : visibilité des champs selon le type/mode, création
    d'une tuile Cumul (84 points = 7 ans × 12 mois, strictement croissante car `Montant` est toujours
    positif dans ce jeu de test, dernier point = somme totale via `aggregateSingle`), clic sans effet
    en mode mesure, édition Cumul → YTD (repart bien à zéro à chaque année) → Comparaison N-1 (2
    séries, décalage d'exactement un an vérifié contre la valeur brute), puis retour à Brut sur la
    MÊME tuile (redevient cliquable, prouve l'absence de handler figé) ; (d) régression : une tuile
    Barres normale (jamais passée par le mode mesure) fonctionne toujours à l'identique ; (e)
    round-trip `saveConfig`/`loadConfig` (measureMode/dateColumn survivent, une tuile Barres SANS ces
    champs — format existant — reste correcte) ; (f) `buildWorkbookSheets` + génération XLSX réelle
    (SheetJS) ne plantent pas avec une tuile en mode mesure. Aucun bug produit trouvé sur le calcul
    SQL lui-même (juste 2 erreurs dans le script de test ad hoc, corrigées avant validation finale) ;
    le bug réel de handler de clic figé (point 2 des garde-fous ci-dessus) a été anticipé et corrigé
    AVANT le test, pas découvert par lui — noté ici pour la même raison que les autres bugs de ce
    fichier : la classe de bug ("closure figée sur une instance mise en cache", déjà documentée
    ailleurs dans ce fichier pour le gestionnaire de clic d'origine) est directement réutilisable pour
    la prochaine feature qui ajoute un 2e chemin de rendu vers une même instance ECharts.

- **Tableau croisé dynamique (pivot)** (`js/data.js:pivotTable`, `js/charts.js:renderPivot`,
  `js/main.js`, Roadmap Tier 2, demande d'Antoine — priorité "critique" de la roadmap) :
  - **Rendu en table HTML plutôt qu'en série ECharts** (comme prévu dans ROADMAP.md, "0% de
    réutilisation ECharts") : `renderPivot` construit directement le `innerHTML` de `.tile-chart`
    (réutilisé tel quel — `overflow: auto` ajouté à cette règle CSS pour qu'une grille plus grande
    que la tuile défile plutôt que de déborder visuellement, contrairement à un canvas ECharts qui
    se redimensionne toujours pile à son conteneur). Aucune instance à mettre en cache dans
    `chartInstances` : toute la table est reconstruite à chaque rendu, comme le reste du DOM des
    tuiles (voir `main.js:render()`), donc pas de risque de closure figée sur un ancien état
    (contrairement au gestionnaire de clic ECharts, voir plus haut) — les gestionnaires de clic
    posés à chaque rendu lisent `tile`/`state` du passage COURANT.
  - **PAS de dépendance au moteur DuckDB-WASM** (`js/duckdb-engine.js`, voir plus haut) malgré sa
    fondation posée précisément pour "mesures/pivot/blending" : `pivotTable` reste un simple
    `Array`/`Map` en JS, cohérent avec `groupByAggregate` (même volume testé, ~47 040 lignes, sans
    signe de ralentissement — voir "Délibérément hors scope" ci-dessous sur ce choix pour
    `groupByAggregate`). Le moteur SQL reste donc TOUJOURS sans consommateur réel à ce stade.
  - **Deux dimensions indépendantes** (lignes + colonnes, nouveau champ `tile.columnDimension` dans
    le formulaire, visible seulement pour ce type) plutôt qu'un système de hiérarchie : chaque
    intersection (ligne, colonne) est agrégée en appliquant `aggFn` aux lignes qui matchent LES
    DEUX clés. **Piège explicitement évité** : les totaux de ligne/colonne/général ne sont PAS
    recalculés en recombinant les valeurs déjà agrégées des cellules affichées (ça fonctionnerait
    pour "somme" mais serait FAUX pour "moyenne"/"min"/"max" dès que les colonnes n'ont pas le même
    nombre de lignes — la moyenne des moyennes n'est pas la moyenne globale) : chaque total est
    calculé en ré-agrégeant DIRECTEMENT l'ensemble des lignes concernées, en ignorant l'autre
    dimension. Vérifié explicitement sous Node avec un cas où moyenne-des-cellules et vraie moyenne
    divergent (voir `dev-tests/test-data.js`).
  - **Cellule sans donnée = `null`, jamais `0`** : une intersection (ligne, colonne) sans aucune
    ligne correspondante (cas réaliste dès que les deux dimensions ne sont pas un produit cartésien
    complet, contrairement au jeu de test de charge qui l'est) renvoie `null` côté `pivotTable`,
    affiché "–" côté rendu et exporté en chaîne vide (pas `0`) côté Excel — distinction importante
    pour "moyenne"/"min"/"max", où 0 serait une vraie valeur alors que `null` veut dire "aucune
    donnée". Ces cellules ne sont délibérément PAS cliquables (`.pivot-cell-empty`, aucun
    gestionnaire de clic posé) : rien à filtrer sur une intersection qui n'existe pas.
  - **Cross-filtering réutilisant `toggleFilter` tel quel, sans toucher à `state.js`** : un clic sur
    une CELLULE de donnée pose/retire DEUX filtres indépendants (un sur la dimension ligne, un sur
    la colonne — deux appels successifs à `store.toggleFilter`, déjà cumulatifs par colonne) ; un
    clic sur un EN-TÊTE de ligne/colonne ne pose/retire que le filtre de CETTE dimension seule. La
    tuile source du filtre reste elle-même non filtrée sur son propre clic (`rowsForTile`
    générique, comme bar/pie/treemap — aucun code spécifique au pivot nécessaire ici). Les totaux
    (ligne/colonne/général) ne sont jamais cliquables : ce sont des agrégats, pas un point de
    donnée. Choix délibéré de faire deux appels `toggleFilter` (donc deux rendus) plutôt qu'un
    mécanisme de pose atomique à deux colonnes : plus simple, cohérent avec le modèle de filtre
    existant, coût de double-rendu négligeable en pratique.
  - **Pas de drill-down** (`supportsDrillDown(type)` dans `main.js` exclut désormais explicitement
    `pivot`, en plus de kpi/gauge) : les deux dimensions du pivot sont déjà affichées
    SIMULTANÉMENT dans la grille, contrairement à bar/pie/treemap/scatter qui n'en ont qu'une —
    "détailler" n'a pas le même sens ici. Garde-fou ajouté au passage : les champs de niveaux de
    drill restant dans le DOM (juste masqués) auraient sinon pu injecter un `drillDimensions`
    fantôme sur une tuile pivot si le formulaire avait gardé un ancien type sélectionné juste avant
    — `drillDimensions` est maintenant calculé via `supportsDrillDown(type)`, pas le `hasDimension`
    plus large déjà utilisé pour la validation du champ dimension.
  - **Garde-fou dimension lignes = dimension colonnes** : refusé explicitement (`alert`, tuile non
    créée) plutôt que silencieusement accepté — un pivot d'une colonne contre elle-même n'a pas de
    sens (chaque ligne n'aurait qu'une seule cellule non vide, la diagonale).
  - Testé : Node (`dev-tests/test-data.js` — `pivotTable` : ordre de 1re apparition pour les DEUX
    dimensions comme `groupByAggregate`/pas alphabétique, cellule sans donnée -> `null`, totaux
    corrects pour "somme" ET "moyenne" avec un cas où moyenne-des-cellules diverge de la vraie
    moyenne, jeu de données vide -> structure vide sans planter ; `tileExportSheet`/
    `buildWorkbookSheets` pour le type pivot, grille + ligne/colonne "Total", cellule vide exportée
    en chaîne vide) + validation Playwright ad-hoc contre `dev-tests/harness.html` (non committée,
    voir `dev-tests/README.md` sur la convention de ce projet pour les scripts Playwright créés
    pendant le développement) : bascule des champs du formulaire pour le type pivot (visibilité
    RÉELLE via `isHidden`, pas juste l'état JS), garde-fou lignes=colonnes refusé sans créer de
    tuile, rendu réel de la grille avec ligne/colonne Total, clic sur une cellule -> exactement 2
    filtres actifs, reclic -> les 2 retirés (idempotence), clic sur un en-tête de ligne cross-filtre
    bien une AUTRE tuile (KPI vérifié changer de valeur), la tuile pivot reste non filtrée sur son
    propre clic, édition de tuile pré-remplit les deux champs de dimension, export Excel ne plante
    pas avec une tuile pivot dans le dashboard, hauteur de la tuile stable sur 6 mesures successives
    (pas de boucle resize↔layout, voir la checklist méthodologique de TEST_PROTOCOL.md). Aucun bug
    produit trouvé pendant cette validation — contrairement à plusieurs features précédentes de ce
    fichier, aucune anomalie de rendu/visibilité/stabilité n'est apparue ici.

- **Colonne technique Grist `manualSort` filtrée des sélecteurs + icônes SVG (2026-09-29)** :
  suite à l'audit UI/UX du projet (comparaison au cadrage d'identité visuelle `Grist Factory` de
  `publipostageGrist`) et à un test en conditions réelles Grist qui avait remonté ce défaut :
  - **`manualSort` fuitait dans les sélecteurs Dimension/Mesure/Filtre du formulaire d'ajout de
    tuile** [BUG RÉEL, voir TEST_PROTOCOL.md #19]. Grist ajoute cette colonne (position flottante,
    glisser-déposer manuel des lignes) à TOUTE table qu'il crée, sans qu'elle soit jamais demandée
    via `AddColumn` côté widget — `fetchTable()` la renvoie mêlée aux vraies colonnes du document.
    `GristBI.data.tableToRows()` n'excluait que `id`. Invisible dans ce sandbox car
    `dev-tests/grist-stub.js` ne simulait pas cette colonne (ni sur `AddTable`, ni sur `AddRecord`) —
    corrigé des deux côtés : un filtre explicite (`GRIST_TECHNICAL_COLUMNS`) dans `tableToRows()`,
    et le mock étendu pour que le correctif soit réellement exercé par `node dev-tests/test-data.js`
    plutôt que de rester une hypothèse jamais vérifiée par les tests.
  - **Icônes de chrome** : les glyphes texte/emoji (chevrons, crayon, coche, `&times;`, ⚠️) utilisés
    pour les actions de tuile (déplacer/modifier/supprimer), la fermeture d'onglet/de badge de
    filtre et le bandeau d'avertissement ECharts remplacés par des SVG en trait dessinés à la main
    (`js/main.js:ICON_PATHS`/`icon()`), `stroke="currentColor"` — cohérent avec la règle « icônes en
    contour, jamais d'emoji/police d'icônes » du cadrage d'identité `Grist Factory`, sans ajouter la
    moindre dépendance tierce ni asset à vendoriser. Testé visuellement (captures d'écran Playwright
    contre `dev-tests/harness.html`) en thème clair, sombre, et en mode édition de tuile : la couleur
    dynamique déjà en place (survol, tuile en cours d'édition) continue de s'appliquer sans le
    moindre changement JS grâce à `currentColor`.
  - **`.advanced-filter-chip-remove` n'avait aucune règle CSS propre** [BUG RÉEL, voir
    TEST_PROTOCOL.md #20] — contrairement à son équivalent `.filter-chip-remove` des filtres
    croisés, ce bouton s'affichait avec le style par défaut du navigateur. Invisible tant qu'aucun
    filtre avancé n'avait été posé lors d'une revue visuelle. Corrigé en partageant les styles de
    `.filter-chip-remove`.
  - **Volontairement laissé de côté à ce stade** (nécessite un arbitrage ou un asset d'Antoine, pas
    une "correction" au sens de ce lot) : logo/panneau Crédits/licence GPL v3 (rattachement à
    l'organisation GitHub `grist-factory` non tranché, asset du logo à obtenir), police Manrope
    (nouvelle dépendance tierce, même vendorisée, hors du périmètre "corrections + sobriété" sans
    accord explicite), et le bilingue fr/en systématique (`data-i18n`) — chantier à part entière vu
    son volume, pas une correction ponctuelle. **Tranché le même jour** (voir l'entrée dédiée plus
    bas) : logo/Crédits/GPL implémentés, Manrope refusé, bilingue déplacé vers un fil dédié.

- **Export PDF du dashboard** (`js/pdf-export.js`, 2026-09-29, Tier 2 ROADMAP.md) : un premier
  export visuel, limité à la page actuellement affichée. Choix de conception délibéré, différent de
  l'export Excel (`js/export.js`) : plutôt que recalculer chaque tuile en pur JS
  (`GristBI.data.tileExportSheet`), ce qui butait sur un mur pour les tuiles en mode mesure DAX
  (calcul ASYNCHRONE via DuckDB-WASM, incompatible avec la contrainte "synchrone, testable sous
  Node" de l'export Excel — voir plus haut, message d'excuse au lieu des valeurs), cet export
  **capture l'image de chaque graphique déjà rendu à l'écran**
  (`GristBI.charts.getInstance(tile.id).getDataURL()`) : comme la valeur est déjà calculée au moment
  du clic, ça marche uniformément pour TOUS les types de tuile, y compris Cumul/YTD/N-1 — aucun
  message d'excuse nécessaire pour cet export-là. Le pivot (table HTML) et le KPI (texte) n'ont pas
  de graphique ECharts à capturer ; ils réutilisent directement `tileExportSheet` (déjà testé) sous
  forme de tableau natif pdfmake. Nouvelle fonction pure `GristBI.data.tileExportKind(tile)` (image
  vs table selon le type), testée sous Node (`dev-tests/test-data.js`).
  - **Dérogation actée par Antoine (2026-09-29)** à la règle "tout vendorisé" du projet : pdfmake
    (et PptxGenJS, pour le PPTX à venir dans une PR séparée) sont chargés depuis
    `cdnjs.cloudflare.com` à la demande (au premier clic sur "Exporter en PDF", pas au chargement de
    la page), pas vendorisés dans `js/vendor/` — voir CLAUDE.md §8. Même bibliothèque, même CDN,
    mêmes version/hash SRI que le widget frère `publipostageGrist` (son `js/pdf-export.js`, vérifié
    en le lisant directement), pour rester cohérent entre les deux projets plutôt que d'inventer un
    second motif de chargement.
  - **Testé** : `tileExportKind` sous Node (les 47+ tests de `test-data.js`, tous verts). Le
    branchement du bouton (visible, clic déclenche bien une tentative de chargement du script CDN,
    échec réseau traité par un message CLAIR à l'utilisateur plutôt qu'une page cassée ou un échec
    silencieux — exigence explicite de la dérogation ci-dessus) vérifié par Playwright contre
    `dev-tests/harness.html` : le CDN `cdnjs.cloudflare.com` est bloqué par la politique réseau de
    CE sandbox (`ERR_TUNNEL_CONNECTION_FAILED`, même catégorie que le blocage Docker Hub documenté
    dans la mémoire du projet), ce qui a permis de vérifier RÉELLEMENT ce chemin d'échec plutôt que
    de le supposer correct. L'export Excel reste fonctionnel après cet échec (pas de corruption
    d'état partagé).
  - **Chemin de succès vérifié localement (2026-09-29)**, en contournant UNIQUEMENT le blocage réseau
    du sandbox, jamais le code livré : `cdnjs.cloudflare.com` reste injoignable ici, mais
    `registry.npmjs.org` (hors de la politique réseau qui bloque cdnjs) l'est — le paquet npm
    `pdfmake@0.2.7` en a été téléchargé, et `build/pdfmake.min.js` qu'il contient a un hash SHA-384
    **identique** à celui codé en dur dans `js/pdf-export.js` (donc, très probablement, le même
    fichier que sert cdnjs pour cette version). Une copie de ce fichier a servi à un test Playwright
    contre `dev-tests/harness.html` (requêtes vers cdnjs interceptées et redirigées vers cette copie
    locale, jamais vers le vrai `js/pdf-export.js` livré, qui garde son URL cdnjs inchangée) : de
    vraies tuiles (bar, KPI, tableau croisé, mesures YTD et N-1) sur des données réalistes (2688
    lignes, dates réelles sur 2 ans) ont produit un vrai PDF de 3 pages, inspecté avec `pdfjs-dist` —
    6 images de graphique correctement dimensionnées (544×~300px, ni vides ni dégénérées), le tableau
    croisé et le KPI affichant les mêmes totaux agrégés (582882, cohérents entre eux), pagination
    automatique correcte. `vfs_fonts.js` du paquet npm n'est pas minifié (hash différent de la
    version cdnjs, mêmes données de police) : le test a désactivé l'attribut `integrity` du
    `<script>` injecté, UNIQUEMENT pour ce test, jamais dans `js/pdf-export.js`.
  - **Ce qui reste réellement non vérifié depuis ce projet** : le chargement RÉSEAU réel depuis
    `cdnjs.cloudflare.com` (ce sandbox le bloque toujours, `ERR_TUNNEL_CONNECTION_FAILED`) et le hash
    SRI de `vfs_fonts.min.js` codé dans `js/pdf-export.js` (non recalculable ici, cdnjs ne servant
    qu'une version minifiée introuvable sur npm) — risque jugé faible vu la correspondance exacte déjà
    confirmée pour `pdfmake.min.js`, mais un premier essai bouton "Exporter en PDF" dans un vrai
    navigateur reste la seule vérification qui couvre aussi ce dernier point.
  - **Hors scope de ce premier export** (documenté, pas oublié) : les autres pages du dashboard
    (seulement la page affichée). Le PPTX (PptxGenJS) est désormais une fonctionnalité séparée, voir
    l'entrée juste au-dessous.
  - **Mise à jour i18n (PR #8, bilingue fr/en)** : le message d'échec réseau et le message
    "graphique indisponible" ci-dessus sont passés de l'objet `STRINGS` figé en français à
    `GristBI.i18n.t('export.pdf.networkError')`/`t('export.pdf.chartUnavailable')`, résolus au
    moment de l'affichage (donc dans la langue active à cet instant, pas celle du chargement de la
    page) — même chose pour le PPTX (`export.pptx.*`, voir l'entrée juste au-dessous). `js/data.js`
    reste volontairement hors i18n (titres de tuile auto-composés) ; `js/pdf-export.js`/
    `js/pptx-export.js`, eux, dépendent déjà du DOM et n'ont donc pas cette contrainte de pureté.

- **Export PPTX du dashboard** (`js/pptx-export.js`, 2026-09-29, Tier 2 ROADMAP.md) : même
  architecture que l'export PDF ci-dessus (voir cette entrée pour le choix de conception détaillé) —
  une diapositive par tuile plutôt qu'un document qui s'écoule, image capturée
  (`GristBI.charts.getInstance(tile.id).getDataURL()`) pour les tuiles-graphique, `slide.addTable`
  avec les données de `GristBI.data.tileExportSheet` (déjà testées) pour pivot/KPI.
  - **Dérogation CDN** : même dérogation d'Antoine que pdfmake (voir CLAUDE.md §8). PptxGenJS 4.0.1
    n'a besoin que d'UN SEUL script (`dist/pptxgen.bundle.js`, qui embarque JSZip et expose à la fois
    `window.PptxGenJS` et `window.JSZip`) — contrairement à pdfmake qui en a deux. **Différence
    importante avec pdfmake** : aucun widget frère (`publipostageGrist`, `SlidesPlus`) ne charge
    encore réellement PptxGenJS depuis un CDN en conditions réelles — `SlidesPlus/DEPENDENCIES.md`
    ne fait que documenter le choix (version 4.0.1, MIT), jamais implémenté là-bas. L'URL
    `cdnjs.cloudflare.com/ajax/libs/pptxgenjs/4.0.1/pptxgen.bundle.js` suit la convention connue de
    cdnjs (même nom de fichier que dans le paquet npm) mais **n'a aucun précédent déjà fonctionnel à
    copier**, contrairement à pdfmake — à vérifier en priorité par Antoine.
  - **Chemin de succès vérifié localement (2026-09-29)**, même méthode que pour pdfmake : le paquet
    npm officiel `pptxgenjs@4.0.1` (`registry.npmjs.org`, hors du blocage réseau qui vise cdnjs) a
    été téléchargé ; son `dist/pptxgen.bundle.js` a un hash SHA-384 codé en dur dans
    `js/pptx-export.js`, chargé dans un vrai navigateur (Playwright) pour confirmer qu'il expose bien
    `window.PptxGenJS`/`window.JSZip` (vérifié — pas une simple lecture statique du bundle). Une
    copie de ce fichier a servi à un test Playwright complet contre `dev-tests/harness.html`
    (requête cdnjs interceptée et redirigée vers cette copie locale, jamais vers l'URL codée dans le
    fichier livré) : les mêmes tuiles réalistes que pour le test PDF (bar, KPI, tableau croisé,
    mesures YTD et N-1, données réelles sur 2 ans) ont produit un vrai fichier `.pptx` de 197 Ko,
    inspecté en décompressant son XML OOXML — 10 diapositives (1 titre + 9 tuiles), 6 images PNG
    correctement dimensionnées (544×~300px, ni vides ni dégénérées), le tableau croisé et le KPI
    affichant le même total agrégé (cohérents entre eux), exactement comme pour le PDF.
  - **Ce qui reste réellement non vérifié depuis ce projet** : contrairement à pdfmake, RIEN ne
    confirme encore que `cdnjs.cloudflare.com` sert effectivement PptxGenJS à cette URL précise (ce
    sandbox bloque cdnjs pour toute bibliothèque, donc impossible à tester ici) — seul le contenu du
    fichier et son comportement une fois chargé ont pu être vérifiés, via la copie npm. Le tout
    premier clic sur "Exporter en PPTX" dans un vrai navigateur reste nécessaire pour confirmer que
    cette URL cdnjs existe réellement.
  - **Testé** : bascule fr/en en direct du libellé du bouton et des deux messages d'erreur
    (`export.pptx.networkError`/`export.pptx.chartUnavailable`), vérifiée via
    `GristBI.i18n.setLang('en')` dans le même test Playwright.
  - **Hors scope** : les autres pages du dashboard (seulement la page affichée), comme pour le PDF.

- **Logo Grist Factory + panneau Crédits + licence GPL v3.0 (2026-09-29)** : les 3 points d'identité
  laissés de côté par le lot précédent (voir juste au-dessus), tranchés par Antoine via 3 cartes de
  décision séparées dans le fil « Audit UI/UX » — Manrope refusé (chrome inchangé, police système),
  bilingue fr/en accepté mais déplacé vers un fil dédié (chantier séparé, pas traité ici), logo +
  Crédits + GPL accepté et implémenté :
  - **Logo** : Antoine a fourni le fichier (avatar `Grist Factory`, JPEG 1024×1024) directement dans
    le fil. Redimensionné/compressé en local (Pillow, `LANCZOS`) à 60×60, ~1,3 Ko — même gabarit que
    l'asset `img/grist-factory-logo.jpg` du widget frère `publipostageGrist` (60×60 fichier, 20×20
    affiché, cercle `border-radius:50%`, `opacity:.85`). Affiché à 18×18 dans `.topbar-info`, juste
    à droite du bouton Réglages, en dernier dans le flux (non-régression : ne déplace aucun contrôle
    existant).
  - **Panneau Crédits** : ce widget n'a pas de panneau Réglages multi-onglets comme
    `publipostageGrist` (langue/thème/marges) — juste le strict nécessaire demandé : un bouton
    Réglages (`#open-settings`) ouvre directement le panneau Crédits (`#settings-modal`), sans
    onglets puisque c'est son seul contenu. Même convention d'ouverture/fermeture que
    `publipostageGrist` (`hidden` natif, pas de fermeture au clic sur le fond — vérifié dans
    `js/settings.js` de ce dépôt frère avant de la reproduire). `[hidden]` redéclaré explicitement
    sur `.settings-modal` (piège n°10 de CLAUDE.md §7 : une règle d'auteur `display:flex` bat
    toujours `[hidden]{display:none}` à spécificité égale). Libellés (Auteur/Site/Licence/Bio)
    regroupés dans un seul bloc `<dl>` plutôt qu'éparpillés, à la demande du coordinateur, pour
    rester faciles à brancher sur le futur mécanisme `data-i18n` du fil « Bilingue fr/en » sans
    avoir à les retrouver dans tout le DOM.
    - Bio réécrite spécifiquement pour ce widget (pas copiée telle quelle depuis
      `publipostageGrist`, dont le cadrage dit explicitement que ce texte est un brouillon de Claude
      "à reformuler par Antoine, ne pas dupliquer sur un autre widget sans le lui faire valider") —
      à faire valider par Antoine comme sur le widget frère.
    - Lien Licence pointé vers `github.com/lombre33/Grist-BI/blob/main/LICENSE` (dépôt personnel
      actuel), PAS vers une organisation `grist-factory` qui n'existe pas encore pour ce dépôt — le
      rattachement à cette organisation reste non tranché (voir §1 de CLAUDE.md) ; à corriger le
      jour où ce rattachement est décidé.
  - **Licence GPL v3.0** : `LICENSE` remplacé par le texte GPLv3 officiel complet, copié tel quel
    depuis `publipostageGrist/LICENSE` (verbatim FSF, appendice "how to apply" non rempli — même
    choix que le widget frère, qui ne le remplit pas non plus). `README.md` et `CLAUDE.md` mis à
    jour (MIT → GPL v3.0, avec la date du changement).
  - **Testé** : `node dev-tests/test-data.js` toujours vert (aucune fonction pure touchée par ce
    lot). Panneau Crédits + logo + ouverture/fermeture du bouton Réglages vérifiés visuellement par
    Playwright contre `dev-tests/harness.html`, thème clair et sombre (les tokens CSS existants
    suffisent, aucune règle dédiée au thème sombre nécessaire).
  - **Jamais vérifié en conditions réelles Grist** : rendu du panneau dans l'iframe réelle du widget,
    respect du logo/asset par la politique de contenu de Grist (aucune raison de penser que non,
    mais pas confirmé).

- **Bilingue fr/en (`data-i18n`) — fondation (2026-09-29)** : chantier laissé de côté par le lot
  ci-dessus, repris séparément suite au cadrage d'identité `Grist Factory` (« Chaque chaîne
  d'interface visible passe par un attribut data-i18n... »). Nouveau module `js/i18n.js`, même
  mécanisme que `publipostageGrist/js/i18n.js` (dictionnaire `STRINGS` fr/en, `t(key, vars)` avec
  substitution de variables et pluriel via `Intl.PluralRules`, attributs `data-i18n`/
  `data-i18n-html`/`data-i18n-title`/`data-i18n-aria`/`data-i18n-placeholder` résolus par
  `applyTranslations()`), chargé en tout premier (`index.html`/`harness.html`). Langue choisie via
  deux radio-boutons dans le panneau Réglages (`input[name="settings-lang"]`), persistée en
  `localStorage` (`gristbi_lang`). Premier jet en bouton de bandeau (`#lang-toggle`) — déplacé le
  29/09/2026, une fois le panneau Réglages disponible (PR #7), pour s'aligner sur le placement de
  référence de `publipostageGrist/js/settings.js` : la langue s'y choisit une fois puis reste
  mémorisée, pas besoin d'une place permanente dans un bandeau qui porte déjà les exports, Réglages
  et le logo (demande explicite du coordinateur, relayant le cadrage d'identité).
  - **117 clés** couvrant la chrome statique de `index.html`/`harness.html` (bandeau, sélecteur de
    table, pages, vues sauvegardées, filtres avancés, formulaire d'ajout/édition de tuile, état
    vide, panneau Réglages/Langue/Crédits) et les chaînes générées côté JS (`js/main.js` :
    alertes/confirmations/invites, badges de filtre, onglets de page, boutons d'action de tuile ;
    `js/charts.js` : bandeau ECharts indisponible, jauge de calcul, en-têtes « Total » du tableau
    croisé, indice de fil d'Ariane). D'abord complétée à 115 lors de la fusion de `main` du
    29/09/2026 (panneau Réglages/Crédits + bouton « Exporter en PDF » ajoutés entre-temps par les
    fils « Audit UI/UX » et « Ce qui reste à faire »), puis à 117 le même jour en déplaçant la
    langue du bandeau vers les Réglages (`lang.toggle.aria` retirée, `settings.language.title/fr/en`
    ajoutées).
  - **Piège trouvé en testant** : les boutons d'action d'une tuile (déplacer/modifier/supprimer,
    `js/main.js:buildTileElement`) sont mis en cache et jamais reconstruits tant que la tuile
    existe (voir `render()`) — un changement de langue seul ne les aurait donc jamais retraduits.
    Corrigé en leur donnant AUSSI les attributs `data-i18n-aria`/`data-i18n-title` (en plus du texte
    déjà traduit à la création) et en appelant `GristBI.i18n.applyTranslations()` à chaque
    `render()`, qui les retrouve et les corrige sans reconstruction — vérifié en Playwright contre
    `dev-tests/harness.html` (titre `title`/`aria-label` d'un bouton de tuile déjà affiché change
    bien après bascule de langue, sans recharger la page).
  - **Deuxième piège du même genre** : le `blankLabel` "(aucun)"/"(none)" des comboboxes
    optionnelles (drill-down, Tendance vs) est écrit dans `.placeholder` par `Combobox.setOptions`
    (`js/combobox.js`) au moment de l'appel, jamais relu automatiquement — restait figé dans
    l'ancienne langue après un changement tant que `refreshColumnSelects()` n'était pas rappelé.
    Corrigé en le rappelant dans l'abonné `GristBI.i18n.onChange` de `js/main.js` ; `setOptions` en
    mode strict garde la valeur déjà choisie si elle reste valide, donc sans effet de bord sur une
    tuile en cours d'édition (vérifié en Playwright : une dimension déjà choisie survit à la
    bascule de langue).
  - **Case à cocher imbriquée dans un `<label>`** (« Filtrer aussi les autres cartes en
    détaillant ») : `data-i18n` directement sur le `<label>` aurait écrasé le `<input
    type="checkbox">` imbriqué via `el.textContent = ...` (`applyTranslations` remplace tout le
    contenu texte de l'élément ciblé) — évité en mettant l'attribut sur un `<span>` enveloppant
    seulement le texte, vérifié en Playwright (la case à cocher reste présente et fonctionnelle
    après plusieurs bascules de langue).
  - **Périmètre délibérément laissé de côté** (documenté en tête de `js/i18n.js`) : le CONTENU
    généré à partir de noms de colonnes reste tel quel — titres de tuile auto-composés (ex.
    « Montant par Région », `js/main.js`, `js/demo-data.js`), en-têtes de feuille Excel et libellés
    de série temporelle (« Cumul », « Valeur », « N-1 », `js/data.js`). `js/data.js` reste
    volontairement sans dépendance au DOM ni à `js/i18n.js` pour rester pur et testable sous Node
    (voir §3 de CLAUDE.md) ; l'étendre à l'i18n serait un chantier à part, pas cette fondation.
  - **Testé** : complétude du dictionnaire (chaque clé a fr ET en, non vides), `t()`/`getLang()`/
    `setLang()` sans DOM ni `localStorage`, substitution de variables et pluriel fr/en — sous Node
    (`node dev-tests/test-data.js`). Bascule de langue, persistance après rechargement, préservation
    du `<code>` imbriqué dans le bandeau ECharts, traduction d'une alerte, tableau croisé — en
    Playwright contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de CLAUDE.md).
    **Jamais testé dans un vrai document Grist** (voir §8 de CLAUDE.md sur cette distinction
    permanente).

- **Data blending multi-tables** (`js/data.js:blendRows`, 2026-09-29, Tier 2 ROADMAP.md) : LEFT JOIN
  entre la table de travail courante et une seconde table du document, choisie via un nouveau
  sélecteur (`#blend-secondary-table`, à côté du sélecteur de table principal) et deux clés de
  jointure (`#blend-primary-column`/`#blend-secondary-column`, une colonne de chaque côté). Chaque
  colonne de la table secondaire est reportée préfixée `<secondaryTableId>.<colonne>` (ex.
  `Villes.Population`) pour ne jamais entrer en collision avec une colonne homonyme de la table
  principale.
  - **En JS pur, PAS via DuckDB-WASM (`js/duckdb-engine.js`)** : la note de ROADMAP.md envisageait
    ce moteur, mais enrichir des lignes avant tout calcul n'est pas une agrégation — un simple
    hash-join (`Map` indexée par la clé secondaire, comme `sameValue` le fait déjà pour un clic
    ECharts : comparaison en chaîne, pas en type strict) évite le coût de chargement WASM pour ça et
    reste testable sous Node comme le reste de `js/data.js`, contrairement à
    `groupByAggregate`/`timeSeriesMeasures` qui ont besoin d'un vrai navigateur.
  - **Note corrigée par rapport à ROADMAP.md** : la note « contredit le choix récent de désactiver
    `onRecords` » s'est révélée être une erreur de documentation, pas un vrai obstacle — se
    connecter à une SECONDE table choisie explicitement par l'utilisateur passe par
    `GristBI.api.listAvailableTables()`/`loadTable()` (le même mécanisme déjà utilisé par le
    sélecteur de table principal), jamais par `grist.onRecords()` (qui concerne uniquement la table
    liée à la page hôte, un mécanisme différent et délibérément abandonné, voir §3 de CLAUDE.md).
    Corrigé dans ROADMAP.md.
  - **`id` proposable comme clé de jointure (correctif du même jour, remonté par le coordinateur du
    projet)** : `availableColumns()` (`js/main.js`) exclut `id` de tous les sélecteurs de colonne
    (identifiant interne Grist, jamais une vraie colonne à afficher) — mais c'est justement la clé
    qu'il faut pouvoir choisir côté table SECONDAIRE pour joindre sur une vraie colonne de référence
    Grist (`Ref:`) : ce POC ne lisant pas les vrais types de colonnes (§6 de CLAUDE.md), une colonne
    `Ref:Villes` n'est vue par ce widget que comme une colonne numérique contenant l'id de ligne de
    la table référencée — sans `id` disponible côté secondaire, une jointure via une vraie relation
    Grist aurait été impossible depuis l'UI (bien que `blendRows` lui-même l'ait toujours supporté,
    puisqu'il ne fait aucune hypothèse sur le nom de la colonne de clé). Corrigé par
    `blendJoinColumns()` (`['id'].concat(availableColumns(rows))`), utilisé UNIQUEMENT par les deux
    comboboxes de clé de jointure — jamais par les autres sélecteurs de colonne (dimension/mesure/
    filtre), où afficher l'id interne n'aurait toujours aucun sens. Proposé aussi côté table
    PRINCIPALE par symétrie (une référence peut pointer dans l'autre sens). **Ce qui reste
    non-vérifiable depuis ce sandbox** : si une vraie colonne `Ref:` de Grist renvoie l'id brut de la
    ligne référencée ou son texte résolu dépend du contexte (piège déjà noté pour ce projet, jamais
    élucidé faute d'un vrai document Grist) — mais peu importe laquelle des deux formes Grist choisit
    réellement, le sélecteur de clé couvre maintenant les deux cas : `id` pour un id brut, n'importe
    quelle colonne texte ordinaire pour une valeur déjà résolue.
  - **Testé sous Playwright (ajout au script ad hoc existant)** : une troisième table mock
    (`Commandes`, avec une colonne `VilleId` simulant une vraie colonne de référence — des id de
    ligne bruts, pas des noms de région lisibles) jointe contre `Villes` via `VilleId` ↔ `id` :
    confirme que `id` apparaît bien dans la liste déroulante de la clé secondaire et que la jointure
    produit les bonnes valeurs de population pour chaque client, y compris avec deux clients
    référençant la même ville (id dupliqué côté table PRINCIPALE, ce qui est un cas normal, à ne pas
    confondre avec la limite du n°1-n décrite plus haut qui concerne une clé dupliquée côté
    SECONDAIRE).
  - **Forme de ligne toujours identique, matché ou pas** : une ligne principale sans correspondance
    reçoit les colonnes secondaires à `null`, jamais absentes — `availableColumns()` (`js/main.js`)
    ne lit que `rows[0]` pour peupler les sélecteurs de colonne du formulaire de tuile ; une forme de
    ligne qui varierait selon le résultat du match aurait rendu les colonnes secondaires invisibles
    dès que la première ligne ne matche pas (piège trouvé en écrivant le test Node correspondant,
    avant même d'atteindre le navigateur).
  - **Limite connue** : une clé dupliquée côté table secondaire ne fait PAS un vrai LEFT JOIN 1-n —
    la dernière ligne trouvée gagne (voir le test Node dédié). Un vrai blending 1-n demanderait
    d'agréger la table secondaire au préalable ; hors périmètre de ce premier jet, à documenter
    comme piste future plutôt qu'à deviner l'intention de l'utilisateur.
  - **Persistance** : `blend` (`{secondaryTableId, primaryColumn, secondaryColumn}` ou `null`) suit
    exactement la même convention que `bookmarks`/`pages` dans `BI_Dashboard_Config`
    (`js/grist-api.js:singlePageConfig`/`normalizeConfig`/`loadConfig`/`saveConfig`) — propre à
    chaque table de travail, absent des formats historiques donc toujours `null` par défaut (compat
    ascendante). Un blend incomplet (au moins un des 3 champs encore vide) équivaut à "aucune
    jointure", plus simple à raisonner qu'un état à moitié configuré et ça laisse l'utilisateur
    choisir les 3 champs dans n'importe quel ordre.
  - **Auto-détection des clés de jointure (`Ref:`/`RefList:` via `_grist_Tables_column`)
    délibérément pas tentée dans ce premier jet** : ce POC ne lit toujours pas les vrais types de
    colonnes Grist (voir §6 de CLAUDE.md, correction technique du 2026-09-15) ; un sélecteur manuel
    à 3 champs est plus simple, moins risqué et testable sans dépendre d'une API interne Grist
    jamais encore exercée dans ce dépôt. Piste future à documenter dans ROADMAP.md, pas à deviner.
  - **Testé sous Node** (`dev-tests/test-data.js`) : cas nominal (2 tables, clé texte), ligne sans
    correspondance (colonnes secondaires à `null`, forme de ligne préservée), table secondaire vide
    (identité), table principale vide, comparaison de clé insensible au type (nombre vs chaîne, côté
    primaire et secondaire), clé secondaire dupliquée (dernière ligne gagne) ; `state.setBlend`
    (défaut `null`, mise à jour, retrait, repli `undefined` → `null` comme `setBookmarks`).
  - **Testé en Playwright** contre `dev-tests/harness.html`, avec une SECONDE table mock ajoutée via
    `window.__gristStubPreseed` (`Villes` : 4 régions, une colonne `Population`) — script ad hoc, non
    committé (voir §5 de CLAUDE.md) : les 3 comboboxes pilotées comme un vrai clic/frappe clavier
    utilisateur (pas les globaux `GristBI` directement), jointure appliquée avec les bonnes valeurs
    par région, colonne jointe automatiquement proposée au sélecteur de mesure du formulaire de
    tuile (confirme qu'aucun changement n'était nécessaire dans `charts.js`/`data.js`/les exports),
    retrait de la jointure (retour à "(aucune)") qui fait disparaître les colonnes jointes, ET
    persistance à travers un changement de table de travail (configurer la jointure sur
    `BI_StressTest`, basculer sur `Villes` — aucune jointure sauvegardée pour elle — puis revenir sur
    `BI_StressTest` : la jointure et les 3 comboboxes sont restaurées à l'identique depuis
    `BI_Dashboard_Config`). **Jamais testé dans un vrai document Grist** (voir §8 de CLAUDE.md).

- **Drill-down hiérarchique automatique** (`js/data.js:deriveDateHierarchyColumns`, `js/main.js`,
  2026-09-29, Tier 2 ROADMAP.md) : périmètre volontairement limité aux hiérarchies TEMPORELLES,
  comme prévu par la note de ROADMAP.md qui exclut explicitement les hiérarchies non temporelles
  (Pays > Région > Ville) d'une "config silencieuse".
  - **Deux mécanismes distincts, à ne pas confondre** : (1) la DÉRIVATION des colonnes
    `<col>.Annee`/`<col>.Trimestre`/`<col>.Mois` est automatique et sans confirmation — appliquée à
    CHAQUE colonne classée "date" par `inferColumnKind`, via `withDateHierarchies` (`js/main.js`),
    appelée depuis `applyBlend` juste avant `refreshColumnSelects`/`store.setRows` (même choke point
    que le data blending, réutilisé tel quel). (2) le CHOIX d'utiliser cette hiérarchie pour une
    tuile donnée reste une suggestion à confirmer d'un clic (bouton "Détailler par
    Année/Trimestre/Mois/Jour", `#tile-suggest-date-hierarchy`) — jamais appliqué automatiquement à
    une tuile existante ni à une nouvelle tuile sans ce clic explicite.
  - **Pas une lecture du vrai type Grist** (`_grist_Tables_column`), malgré une note antérieure de
    ROADMAP.md qui le supposait — corrigée dans ROADMAP.md, même type de correction que celle déjà
    faite pour le data blending. `inferColumnKind` reste l'heuristique existante (échantillonne une
    valeur réelle, teste `GristBI.data.parseDateValue`), ce POC ne lit toujours pas
    `_grist_Tables_column`.
  - **Jour n'est pas dérivé** : la colonne de date d'origine (ex. `Date`, format AAAA-MM-JJ) sert de
    dernier niveau de drill — dériver un 4e niveau identique à la donnée source n'aurait aucune
    valeur. `deriveDateHierarchyColumns` ne produit donc que 3 clés, jamais 4.
  - **Trimestre/Mois volontairement SANS préfixe d'année** (`"T1".."T4"`, `"01".."12"`, jamais
    `"2026-T1"`) : lu dans `js/data.js:rowsForTile`, qui applique TOUS les niveaux de drill déjà
    choisis comme filtres AND avant d'agréger le niveau courant — une fois entré dans une Année
    donnée, le niveau Trimestre ne voit plus que les lignes de cette année, donc "T1" y est déjà sans
    ambiguïté. Un préfixe aurait été un travail inutile.
  - **Toujours les 3 clés, jamais conditionnelles** : une valeur de date non parseable produit les 3
    clés à `null` plutôt que de les omettre — même raison que pour `blendRows`
    (`availableColumns()` ne lit que `rows[0]`, une forme de ligne qui varie casserait les
    sélecteurs de colonne dès que la première ligne serait invalide).
  - **Visibilité du bouton** (`updateSuggestDateHierarchyVisibility`, `js/main.js`) : caché si
    aucune dimension choisie, si la dimension n'est pas classée "date" par `inferColumnKind`, ou si
    le type de tuile n'a pas de notion de drill-down (KPI/jauge/mode mesure temporel via
    `formHasNoDimension`, pivot). Recalculée à trois endroits : au changement de dimension (nouveau
    listener), à la fin de `refreshColumnSelects` (changement de table), et dans
    `updateFormFieldsForType` (changement de type de tuile) — même redondance déjà en place pour
    `updateDrillLevelsUI`.
  - **`setDrillLevels(levels)` extrait** de la boucle qui préremplissait les niveaux de drill en
    édition de tuile (`startEditTile`) — réutilisé par le clic du bouton de suggestion pour remplir
    les niveaux 2 et 3 (Trimestre/Mois) sans que l'utilisateur clique "+ Niveau" à la main. Le clic
    bascule aussi `dimensionSelect.value` sur `<col>.Annee` : ne soumet pas le formulaire, laisse
    l'utilisateur ajuster avant de valider comme pour tout autre choix.
  - **Testé sous Node** (`dev-tests/test-data.js`) : cas nominal (3 dates réparties sur les 4
    trimestres, colonnes dérivées vérifiées valeur par valeur), valeur non parseable (colonnes
    dérivées à `null`, jamais absentes), tableau vide (identité).
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local (pas `file://`, voir §4 de CLAUDE.md) : bouton caché avant tout
    choix de dimension et pour une dimension texte (`Region`), visible pour une dimension classée
    date (`Date`) ; clic → dimension basculée sur `Date.Annee`, niveaux de drill préremplis
    `["Date.Trimestre", "Date.Mois", "Date"]`, bouton re-caché après (`Date.Annee` n'est plus classé
    "date") ; tuile ajoutée et rendue sans erreur JS. **Drill réel confirmé de bout en bout** en
    cliquant successivement sur la 1re barre du graphique (pixel calculé via
    `chart.convertToPixel`, pas une position devinée à l'écran) : `Date.Annee ▸ 2020` →
    `Date.Trimestre ▸ T1` → `Date.Mois ▸ 01` → prêt à drill sur `Date` (le fil d'Ariane affiche
    correctement la chaîne complète à chaque étape, avec des sous-ensembles de catégories de plus en
    plus restreints — 4 trimestres puis seulement 3 mois affichés, cohérent avec le filtrage en
    cascade). **Jamais testé dans un vrai document Grist** (voir §8 de CLAUDE.md).

- **Commentaires collaboratifs** (`js/grist-api.js:loadOrCreateComments`/`addComment`,
  `js/data.js:commentsForTile`, `js/state.js:comments`/`setComments`/`addCommentLocal`,
  2026-09-29, Tier 2 ROADMAP.md) : 3e table interne créée par ce widget,
  `BI_Dashboard_Comments`, une ligne par commentaire — décision produit posée à Antoine via une
  carte de décision (nouvelle table vs champ JSON dans `BI_Dashboard_Config`), avec la nouvelle
  table recommandée pour éviter l'écrasement de commentaires ajoutés en même temps par deux
  personnes (le blob JSON n'a qu'une ligne par table de travail). **PR ouverte sur cette base, mais
  la FUSION est tenue en attente de sa réponse** (demande explicite du coordinateur du projet,
  29/09/2026 ~22h27) : une nouvelle table qui apparaîtrait dans son document est un choix de
  produit qu'il doit voir avant qu'il soit acté, pas seulement une préférence d'implémentation.
  - **Même mécanisme idempotent que `BI_StressTest`/`BI_Dashboard_Config`** (`loadOrCreateTable`,
    garde-fous anti-duplication inclus, voir CLAUDE.md §3/§7), mais SANS aucune ligne de départ
    (`buildRows` renvoie toujours `[]`, contrairement au jeu de données de démo) — colonnes
    `TableId`/`TileId`/`Author`/`Text`/`CreatedAt`, toutes `Text`.
  - **Chargée UNE SEULE fois par session, au bootstrap** (`store.setComments`), PAS à chaque
    changement de table de travail (`switchTable`) contrairement à `blend`/`bookmarks`/`pages` :
    les commentaires ne sont pas structurés PAR table de travail dans ce widget, un id de tuile est
    déjà globalement unique (`Date.now()` + suffixe aléatoire, voir `js/main.js`) — filtrer par
    `TileId` (`GristBI.data.commentsForTile`) suffit donc à retrouver les bons commentaires quelle
    que soit la table de travail active, sans avoir besoin de connaître `TableId` pour ça. La
    colonne `TableId` existe malgré tout sur chaque ligne, pour qu'un humain lisant la table brute
    dans Grist puisse identifier la table de travail concernée sans remonter par l'id de tuile.
  - **Attribution auteur EN SAISIE MANUELLE dans ce premier jet, PAS le pattern
    `getCurrentUserEmail`** (table-sonde à formule Grist déclenchée, voir l'entrée "Correction
    technique importante (2026-09-15)" plus haut et ROADMAP.md) : ce mécanisme reste "confirmé
    faisable" mais volontairement non tenté ici — jamais utilisé dans ce dépôt (`RemoveRecord`
    n'apparaît nulle part ailleurs), et c'est la SEULE exception envisagée dans tout ce projet à la
    règle "aucune formule Grist" (CLAUDE.md §8), un changement d'architecture qui mérite sa propre
    PR et sa propre discussion plutôt que d'être mélangé silencieusement à cette fonctionnalité.
    Le nom saisi est mémorisé en `localStorage` (`gristbi_comment_author`, même garde
    `typeof localStorage !== 'undefined'` + repli silencieux que `gristbi_lang`, voir
    `js/i18n.js`) pour ne pas le retaper à chaque commentaire — persistance vérifiée en Playwright
    à travers un rechargement complet de page.
  - **Ajout optimiste, pas de re-fetch** : `addComment` (`js/grist-api.js`) renvoie la ligne
    complète (avec l'id Grist réel du nouveau commentaire) directement depuis la réponse
    d'`AddRecord`, `store.addCommentLocal` l'ajoute au tableau déjà en mémoire — jamais besoin de
    relire toute la table de commentaires après un ajout.
  - **UI** : bouton "Commentaires" sur chaque tuile (`.tile-actions`, entre Modifier et Supprimer),
    avec un badge de compte recalculé À CHAQUE `render()` (comme `moveLeftBtn`/`moveRightBtn`, pas
    seulement à la création de la tuile — un commentaire peut être ajouté tuile déjà affichée
    depuis longtemps). Panneau singleton calqué sur `#settings-modal` (même convention
    hidden natif + `[hidden]{display:none}` explicite, piège n°10 CLAUDE.md §7 ; pas de fermeture
    au clic sur le fond), réutilisé pour la tuile cliquée plutôt qu'un panneau par tuile — son
    contenu (titre de tuile, liste) est reconstruit à chaque ouverture et tenu à jour en direct
    tant qu'il reste ouvert (`renderCommentsModal`, appelée depuis `render()`, donc aussi après un
    changement de langue).
  - **Testé sous Node** (`dev-tests/test-data.js`) : `commentsForTile` (filtre par `TileId` — pas
    `TableId` — tri chronologique sur `CreatedAt` malgré un ordre de départ différent, tuile
    inconnue, tableau de commentaires vide/absent) ; `state.setComments`/`addCommentLocal`
    (défaut `[]`, chargement complet, ajout optimiste sans perdre les commentaires déjà chargés,
    repli `undefined` → `[]` comme `setBookmarks`/`setBlend`).
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5
    de CLAUDE.md), servi en HTTP local : badge caché sans commentaire, panneau affichant le bon
    titre de tuile, message "aucun commentaire" affiché puis masqué après le premier ajout, champ
    texte vidé mais auteur conservé entre deux ajouts consécutifs, badge de compte mis à jour même
    panneau ouvert, commentaires toujours présents après fermeture/réouverture du panneau (état en
    mémoire du store, pas relu depuis Grist), **aucune fuite entre tuiles** (une 2e tuile affiche 0
    commentaire alors que la 1re en a 2, confirmant le filtrage par `TileId`), nom d'auteur
    mémorisé après un rechargement complet de la page (`localStorage`, alors que les commentaires
    eux-mêmes ne survivent pas au rechargement dans ce mock sans persistance, comme attendu — voir
    CLAUDE.md §4). **Jamais testé dans un vrai document Grist** (voir §8 de CLAUDE.md) : en
    particulier, la création réelle d'une 3e table interne (`AddTable`) n'a jamais été exercée
    contre le vrai moteur Grist pour CETTE table précise (seulement `BI_StressTest`/
    `BI_Dashboard_Config`, voir "Validé en conditions réelles" plus loin) — même mécanisme
    générique, mais jamais essayé pour un 3e appelant.

## Délibérément hors scope pour ce POC (pas juste "oublié")

- **Mesures façon DAX / time intelligence AU-DELÀ du sous-ensemble ciblé** (voir l'entrée dédiée
  plus haut pour ce qui EST fait : Cumul/YTD/Comparaison N-1, granularité mensuelle fixe, sur une
  tuile Barres) : pas de granularité jour/trimestre/année configurable, pas de fenêtre glissante
  (ex. "12 derniers mois"), pas de mesures composables entre elles (un vrai DAX permet d'enchaîner
  des transformations de contexte de filtre) — un vrai langage de mesures reste un projet à part
  entière.
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
- **Hiérarchies non temporelles suggérées automatiquement** (ex. Pays > Région > Ville) : le
  drill-down hiérarchique automatique (voir l'entrée dédiée plus haut) ne couvre QUE les colonnes
  classées "date" par `inferColumnKind` — non tenté pour le reste, comme prévu explicitement par
  ROADMAP.md ("une suggestion à confirmer, jamais une config silencieuse"), faute d'un signal fiable
  (pas de lecture du vrai type Grist, pas de métadonnées de relation entre colonnes dans ce POC).

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
13. **[PRIORITÉ HAUTE, révisé après le correctif v2] Le budget d'attente de `tableExistsConfirmed`
    (~9,3s au total, voir "Correctif v2" plus haut) n'a toujours pas été calibré contre le vrai timing
    de la négociation d'accès `grist.ready()`** — la première version de ce point (délai fixe de
    500ms) s'est avérée insuffisante en pratique (bug remonté une seconde fois par l'utilisateur),
    d'où le passage à un budget ~18× plus généreux. Reste jamais mesuré contre un vrai document Grist
    (ce sandbox ne peut simuler qu'un faux négatif DÉTERMINISTE via `__gristStubRaceCalls`, pas le vrai
    délai réseau qui le cause). Risque résiduel nettement réduit par rapport à la v1 grâce au filet de
    sécurité indépendant (détection de la collision `AddTable`, voir plus haut) qui garantit l'absence
    de duplication même si ce budget s'avérait ENCORE insuffisant — mais à vérifier en réel malgré tout,
    idéalement en observant le widget se reconnecter plusieurs fois de suite à un document où
    `BI_StressTest` existe déjà : (a) le correctif empêche-t-il bien toute duplication de lignes en
    pratique ; (b) le `console.error` de collision apparaît-il un jour dans la console de
    l'utilisateur (signe que même ce budget renforcé a été dépassé — auquel cas l'augmenter encore,
    le coût ne se payant qu'une fois par session) ; (c) une table fantôme orpheline
    (`BI_StressTest2`, etc.) apparaît-elle un jour dans son document (signe du même dépassement, à
    supprimer manuellement).
13bis. **[Limite résiduelle documentée, pas corrigée — voir "Correctif v2" plus haut]**
    `migrateLegacyTableName` reste, dans un cas extrême (négociation encore plus longue que le budget
    de 13. ET présence d'une table sous un ancien nom versionné), non couvert par le filet de sécurité
    basé sur la collision `AddTable` — contrairement au chemin principal `BI_StressTest`, un renommage
    legacy manqué ne produit PAS de collision détectable (le nom fixe demandé n'existe alors
    réellement pas). Nécessite deux conditions rares simultanées pour se manifester ; jugé acceptable
    tel quel plutôt que d'ajouter une troisième couche de protection.
14. **DuckDB-WASM (`js/duckdb-engine.js`) jamais exécuté dans un vrai document Grist ni depuis
    GitHub Pages** : vérifié uniquement dans ce sandbox (Chromium/Playwright, servi par un petit
    serveur HTTP local). Une feature réelle le consomme désormais (mesures façon DAX, voir plus
    haut), donc ce point devient concrètement pertinent, pas seulement théorique. À vérifier en réel :
    (a) le téléchargement du binaire `.wasm` (~34 Mo) se comporte-t-il correctement depuis GitHub
    Pages (types MIME corrects pour `.wasm`/`.mjs`, pas de blocage similaire à celui déjà rencontré
    avec le CDN ECharts) ; (b) le `Worker` créé par `createWorker()` fonctionne-t-il sans restriction
    particulière à l'intérieur de l'iframe (non-sandboxée, voir ROADMAP.md) d'un widget Grist réel ;
    (c) le poids du téléchargement (une fois, la première fois qu'une feature l'utilise, mis en cache
    navigateur ensuite) reste-t-il acceptable en pratique pour un utilisateur sur une connexion lente ;
    (d) **spécifique aux mesures YTD/N-1/cumul** : `tile.dateColumn` doit être une vraie colonne Date
    au sens de ce POC (format ISO `AAAA-MM-JJ`, seul format reconnu par `TRY_CAST(... AS DATE)` côté
    DuckDB comme par `parseDateValue` côté JS) — jamais vérifié contre une colonne Grist de type
    `Date`/`DateTime` natif dans un vrai document (ce POC lit les valeurs telles que
    `fetchTable`/`onRecords` les renvoie, sans lecture des vrais types Grist `_grist_Tables_column`,
    voir la correction technique du 2026-09-15 dans ROADMAP.md) : le format exact renvoyé pour une
    colonne `Date` Grist réelle (chaîne ISO ? timestamp Unix ? autre ?) n'est pas confirmé ici.

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
