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
  - **Auto-détection des clés de jointure via `Ref:` : FAIT le 2026-10-21** (à l'origine notée
    « délibérément pas tentée dans ce premier jet » — ce POC ne lisait pas encore les vrais types de
    colonnes Grist au moment du data blending initial ; corrigé depuis par `realDateColumnIds`
    (PR #17, 29/09) pour les dates, et par l'entrée dédiée ci-dessous pour les clés de jointure). Voir
    la nouvelle entrée "Clés de jointure suggérées" plus bas pour le détail complet.
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

- **Clés de jointure suggérées pour le data blending** (`js/grist-api.js:refColumnsForTable`,
  `js/main.js:suggestBlendJoinColumns`, 2026-10-21, Tier 2 ROADMAP.md — demande d'Antoine du
  2026-10-21) : en choisissant une table secondaire, le widget propose désormais automatiquement la
  paire de clés si une colonne `Ref:` relie les deux tables, au lieu de laisser l'utilisateur deviner
  laquelle de ses colonnes numériques est en réalité une référence Grist.
  - **Même mécanisme de lecture que `realDateColumnIds`** (`_grist_Tables`/`_grist_Tables_column`,
    déjà confirmé lisible avec l'accès `full` sur un vrai Grist le 30/09/2026) : `refColumnsForTable`
    renvoie, pour une table donnée, chaque colonne de type `Ref:<AutreTable>` avec la table qu'elle
    cible. Repli sur `[]` en cas d'échec (droits restreints, tables système absentes), comme pour la
    détection des colonnes Date — la suggestion disparaît simplement, rien ne casse.
  - **`RefList:` délibérément EXCLUE** : une telle colonne porte une LISTE d'ids, jamais une valeur
    scalaire — `blendRows` ne fait qu'une égalité simple par ligne, inadaptée à une liste (joindre
    dessus donnerait une correspondance silencieusement toujours fausse). `type.startsWith('Ref:')`
    suffit à l'exclure sans logique dédiée : le 4e caractère d'un type `RefList:...` (`L`) ne
    correspond jamais au `:` attendu à cette position pour un simple `Ref:`.
  - **Priorité PRINCIPALE → SECONDAIRE, puis repli SECONDAIRE → PRINCIPALE** : le cas le plus
    fréquent est d'enrichir la table de travail avec une table de référence (ex. `Ventes.VilleRef`
    → `Villes.id`) ; la relation inverse (une colonne `Ref:` côté table SECONDAIRE pointant vers la
    PRINCIPALE) reste couverte en repli, avec `primaryColumn: 'id'`.
  - **Respecte une clé principale déjà choisie à la main** : le listener de changement de table
    secondaire préserve délibérément `blendPrimaryColumnInput.value` d'un choix précédent (voir le
    commentaire déjà en place avant cette fonctionnalité) — la suggestion ne touche alors QUE la clé
    secondaire, et seulement si cette colonne principale référence bien la nouvelle table secondaire ;
    sinon, aucune suggestion n'est faite (l'utilisateur garde la main entière, comme avant).
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), avec deux tables mock entièrement préremplies via `window.__gristStubPreseed`
    (`Ventes` avec une colonne `VilleRef` de type `Ref:Villes`, `Villes` avec `Nom`/`Population`), y
    compris leurs métadonnées système (`_grist_Tables`/`_grist_Tables_column`) : en basculant la
    table de travail sur `Ventes` puis en choisissant `Villes` comme table secondaire, les deux
    comboboxes de clé se remplissent automatiquement à `VilleRef`/`id`, `state.blend` reflète cette
    paire, et la jointure produit bien `Villes.Nom`/`Villes.Population` pour chaque ligne. Repli
    confirmé en basculant ensuite la table secondaire vers `BI_StressTest` (aucune relation `Ref:`
    connue) : la clé principale déjà choisie (`VilleRef`) est conservée telle quelle (convention
    existante), la clé secondaire reste vide, et `state.blend` redevient `null` (jointure incomplète)
    — comportement identique à celui d'avant cette fonctionnalité. **Jamais testé dans un vrai
    document Grist** (voir §8 de CLAUDE.md) : la forme exacte d'un type `Ref:` réel
    (`_grist_Tables_column.type`) est affirmée par analogie avec `realDateColumnIds`, déjà vérifié
    contre un vrai Grist pour les colonnes Date/DateTime, mais jamais spécifiquement pour `Ref:`.

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

- **Modale de détail** (substitut du drillthrough Power BI, `js/main.js:openDetailModal`/
  `closeDetailModal`/`renderDetailModal`, `#detail-modal` dans `index.html`/`dev-tests/harness.html`,
  2026-10-21, Tier 2 ROADMAP.md — demande d'Antoine du 2026-10-21, « afficher les lignes derrière un
  point ou une barre cliquée ») : bouton "Détail" (icône loupe, `.tile-detail`) ajouté dans l'en-tête
  de CHAQUE tuile (kpi/gauge/pivot compris, pas seulement bar/pie/treemap/scatter), à côté du bouton
  Commentaires déjà existant — même gabarit `.settings-modal` que les panneaux Réglages/Commentaires
  (élargi en CSS, `.detail-modal-content`), même convention d'ouverture/fermeture (`hidden` natif,
  pas de fermeture au clic sur le fond).
  - **Lignes affichées = `GristBI.data.rowsForTile(tile, state)`**, exactement le même pipeline de
    filtrage que le rendu ECharts/l'export Excel (cross-filtres des AUTRES tuiles, filtres avancés,
    propre chemin de drill-down de la tuile) — PAS seulement le segment précis cliqué : la tuile a
    déjà été affinée par filtre/drill avant que l'utilisateur ne clique "Détail", le detail modal
    montre donc "ce que cette tuile affiche en ce moment", cohérent avec ce qui est déjà à l'écran.
  - **Colonnes = `Object.keys(rows[0])`**, même convention que `availableColumns()` (js/main.js) :
    inclut les colonnes dérivées (ex. `Date.Annee`/`Date.Trimestre`/`Date.Mois`) et les colonnes de
    data blending (`<table>.<colonne>`) si présentes, puisqu'elles font partie de la forme réelle de
    la ligne.
  - **Plafonné à 500 lignes affichées** (`DETAIL_MODAL_MAX_ROWS`), avec un message de troncature
    explicite pointant vers l'export Excel pour tout voir d'un coup — un tableau HTML de 47 040
    lignes sans pagination serait un coût DOM inutile pour une modale d'inspection ponctuelle (même
    préoccupation que `.tile-chart { overflow: auto }` pour le tableau croisé).
  - **Live, pas un instantané figé à l'ouverture** : `render()` rappelle `renderDetailModal()` à
    chaque changement d'état (même mécanisme que `renderCommentsModal()` déjà en place pour le
    panneau Commentaires), qui relit `store.getState()` et retrouve la tuile par id à chaque appel
    (repli silencieux — ferme la modale — si la tuile a été supprimée entre-temps, même garde que le
    gestionnaire de clic générique de `js/charts.js`).
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local : bouton visible sur la 1re tuile par défaut, clic → modale
    visible avec titre "Détail — 47040 lignes" (aucun filtre actif), tableau de 500 lignes/12
    colonnes (8 colonnes déclarées de `BI_StressTest` + 3 colonnes dérivées Année/Trimestre/Mois +
    `id`), message de troncature "Affichage des 500 premières lignes sur 47040." affiché. Fermeture
    via le bouton confirmée. Un cross-filtre posé sur une AUTRE tuile PENDANT que la modale de la 1re
    tuile est fermée, puis rouverte, fait bien tomber le compte à 9408 lignes — confirme le bon
    pipeline de filtrage. Bascule de langue (fr → en, modale laissée ouverte entre temps) confirme la
    retraduction réactive du titre ("Detail — 9408 rows", pluriel anglais correct). **Mise à jour en
    direct SANS fermer/rouvrir la modale** : tentée en re-cliquant la même part de camembert pour
    retirer le filtre pendant que la modale reste ouverte — non concluante en Playwright (clic
    répété sur un camembert plein, dont le centre géométrique est un point dégénéré commun à toutes
    les parts ; `activeFilters` lu directement via `window.GristBI.store.getState()` est resté
    identique aux deux clics, donc le 2e clic n'a tout simplement pas été pris en compte comme un
    nouveau toggle — même famille de flakiness déjà documentée pour les clics sur un nuage de points,
    voir TEST_PROTOCOL.md, pas un bug produit). Le mécanisme lui-même (rappel systématique de
    `renderDetailModal()` depuis `render()`) est garanti par construction, identique à celui déjà
    éprouvé pour `renderCommentsModal()` — pas re-testé au pixel près pour cette raison. **Jamais
    testé dans un vrai document Grist** (voir §8 de CLAUDE.md).

- **Commentaires collaboratifs** (`js/grist-api.js:loadOrCreateComments`/`addComment`,
  `js/data.js:commentsForTile`, `js/state.js:comments`/`setComments`/`addCommentLocal`,
  2026-09-29, Tier 2 ROADMAP.md) : 3e table interne créée par ce widget,
  `BI_Dashboard_Comments`, une ligne par commentaire — décision produit posée à Antoine via une
  carte de décision (nouvelle table vs champ JSON dans `BI_Dashboard_Config`), avec la nouvelle
  table recommandée pour éviter l'écrasement de commentaires ajoutés en même temps par deux
  personnes (le blob JSON n'a qu'une ligne par table de travail). **Antoine a répondu à la carte de
  décision le 30/09/2026 en choisissant « Nouvelle table »** — la fusion (tenue en attente de cette
  réponse par demande explicite du coordinateur du projet, 29/09/2026 ~22h27, une nouvelle table
  apparaissant dans son document étant un choix de produit qu'il devait voir avant qu'il soit acté)
  a suivi : **PR #15 fusionnée sur `main` le 30/09/2026**, sans changement de conception puisque la
  PR construisait déjà sur l'option qu'il a choisie.
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
  - **Attribution auteur EN SAISIE MANUELLE dans ce premier jet.** Le nom saisi est mémorisé en
    `localStorage` (`gristbi_comment_author`, même garde `typeof localStorage !== 'undefined'` +
    repli silencieux que `gristbi_lang`, voir `js/i18n.js`) pour ne pas le retaper à chaque
    commentaire — persistance vérifiée en Playwright à travers un rechargement complet de page.
    **Remplacée depuis par une reconnaissance automatique quand c'est possible (21/10/2026)** : voir
    la nouvelle entrée "Auteur des commentaires reconnu automatiquement" plus bas pour le détail
    complet. Ce repli en saisie manuelle reste le comportement exact de ce premier jet dès que la
    détection automatique échoue.
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

- **Auteur des commentaires reconnu automatiquement** (`js/grist-api.js:getCurrentUserEmail`,
  2026-10-21, Tier 2 ROADMAP.md, "features visibles restantes") : remplace la saisie manuelle de
  l'entrée "Commentaires collaboratifs" ci-dessus par le pattern `getCurrentUserEmail()` déjà décrit
  comme "confirmé faisable" (porté de `publipostageGrist`, voir l'entrée "Correction technique
  importante (2026-09-15)" plus haut et ROADMAP.md) — SEULE feature de ce projet à utiliser le
  langage de formules Grist (CLAUDE.md §8), SEULE exception délibérée, documentée comme telle
  partout où cette règle est énoncée.
  - **Mécanisme retenu : une 4e table interne dédiée, `BI_Dashboard_UserProbe`**, PAS une colonne
    ajoutée directement à `BI_Dashboard_Comments`, bien que le coordinateur du projet ait
    initialement suggéré cette 2e option pour éviter "une table de plus". Raison technique du choix
    inverse : une formule Grist normale RECALCULE sa valeur à chaque lecture, par N'IMPORTE QUEL
    viewer du document qui ouvre `fetchTable` sur cette table — une colonne `Email` posée directement
    sur une ligne de commentaire déjà existante changerait donc de signification à chaque nouvelle
    ouverture du document par quelqu'un d'autre, inutilisable comme auteur figé à la création. La
    table dédiée contourne entièrement ce problème SANS avoir besoin des réglages avancés de
    recalcul de Grist (`recalcWhen`/`recalcDeps`, propres aux "formules déclenchées" permanentes,
    jamais nécessaires ici) : une ligne y est ajoutée, sa valeur calculée est lue IMMÉDIATEMENT après
    l'`AddRecord` qui déclenche son calcul (donc pour l'utilisateur courant, à cet instant précis),
    puis la ligne est aussitôt supprimée — seul ce round-trip compte, la table ne conserve jamais
    aucune valeur entre deux appels. Recherché et écarté en cours de session : une piste explorée via
    le code source de `gristlabs/grist-core` (mentions de `recalcWhen: "never"/"allupdates"/""` et de
    `recalcDeps` pour les formules dites "déclenchées" permanentes) se serait révélée une complexité
    inutile pour ce besoin précis — une formule Grist ORDINAIRE (`isFormula: true, formula:
    'user.Email'`, sans aucun réglage de recalcul particulier) suffit entièrement dès lors qu'on ne
    relit sa valeur qu'une seule fois, juste après l'avoir déclenchée.
  - **Schéma** : `USER_PROBE_COLUMNS = [{ id: 'Email', type: 'Text', isFormula: true, formula:
    'user.Email' }]`. Créée de façon idempotente comme les 3 autres tables internes
    (`tableExistsConfirmed` + comparaison de l'`actualTableId` réellement créé par `AddTable`, même
    garde-fou anti-collision que `loadOrCreateTable`, CLAUDE.md §3/§7) mais SANS passer par
    `loadOrCreateTable` elle-même : cette dernière recourt à `ensureColumnsUpToDate`/
    `deriveMissingColumns` pour faire évoluer un schéma via de VRAIES valeurs calculées en JS puis
    écrites par `UpdateRecord` — mécanisme délibérément incompatible avec une colonne à formule
    Grist, qu'il ne faut surtout pas laisser réécrire. `ensureUserProbeTableExists` (dédiée,
    `js/grist-api.js`) reproduit seulement la partie création/garde-fou anti-collision, jamais le
    remplissage ni le backfill de colonnes.
  - **`RemoveRecord` utilisé pour la première fois par le CODE de ce widget** (déjà mocké dans
    `dev-tests/grist-stub.js` depuis l'origine, mais jamais exercé par `js/grist-api.js` avant cette
    feature) — portée volontairement limitée à une ligne de table-sonde éphémère que ce widget vient
    de créer lui-même l'instant d'avant, jamais à une table ou à une donnée appartenant à
    l'utilisateur : ne change rien à la règle "jamais `RemoveTable`" (CLAUDE.md §3/§8, verbe distinct,
    toujours évité).
  - **Mémorisée pour toute la session** (`_currentUserEmailPromise`, `js/grist-api.js`) comme les
    commentaires eux-mêmes (`js/main.js:bootstrap`) : l'identité ne change pas en cours de route,
    inutile de refaire ce round-trip (AddTable éventuel + AddRecord + fetchTable + RemoveRecord) à
    chaque ouverture du panneau Commentaires. Appelée une seule fois au bootstrap, dans son propre
    `try/catch` séparé de celui des commentaires (même raison : un échec ici — widget ouvert hors
    Grist, droits insuffisants, mock sans moteur de formules — ne doit jamais empêcher l'affichage du
    dashboard lui-même).
  - **UI (`js/main.js:openCommentsModal`)** : si la détection a abouti (`detectedUserEmail`
    non `null`), le champ `#comment-author` est pré-rempli avec l'email détecté et VERROUILLÉ
    (`readOnly = true`, fond grisé via `.comment-form input[readonly]`, voir `css/style.css`) —
    cohérence garantie avec la véritable identité Grist plutôt qu'un nom retapé/modifiable à la main.
    Sinon (repli), comportement STRICTEMENT inchangé par rapport au premier jet : champ éditable,
    pré-rempli depuis `localStorage`, mémorisé à nouveau après chaque ajout. Un auteur auto-détecté
    n'est PAS sauvegardé dans `localStorage` (inutile : il n'a jamais été retapé à la main, et
    `detectedUserEmail` reste disponible pour toute la session de toute façon). Infobulle
    bilingue (`data-i18n-title="comments.author.autoTitle"`) sur le champ dans les deux cas,
    expliquant la détection automatique quand elle fonctionne.
  - **Exclue du sélecteur de table** (`listAvailableTables`, `js/grist-api.js`) comme
    `BI_Dashboard_Config` : une table-sonde à une seule colonne formule n'a aucun sens comme table de
    travail à visualiser. `BI_Dashboard_Comments`, elle, n'était déjà PAS exclue avant cette feature
    (lacune préexistante, non corrigée ici — hors périmètre de cette PR, voir le code de
    `listAvailableTables` pour l'état exact).
  - **Testé en Playwright** contre `dev-tests/grist-stub.js` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local : `getCurrentUserEmail()` renvoie `null` contre ce mock — **ce
    mock ne simule PAS le moteur de formules Grist** (`cloneColumnar`/`AddRecord` : une colonne
    `isFormula` déclarée à la création reste un tableau vide, jamais recalculée, voir
    `dev-tests/grist-stub.js`), donc CE scénario est exactement "détection indisponible", vérifié
    comme tel : la table `BI_Dashboard_UserProbe` est bien créée (une seule fois, confirmé par un 2e
    appel qui réutilise la promesse mémorisée sans créer de 2e table ni ajouter/retirer de 2e ligne),
    le round-trip `AddRecord`/`fetchTable`/`RemoveRecord` ne lève aucune exception, et le panneau
    Commentaires retombe bien sur le champ éditable + la mémorisation `localStorage` existante (ajout
    d'un commentaire par ce chemin de repli vérifié bout en bout). Vérifié aussi que `index.html`
    (import map distinct de `dev-tests/harness.html`, voir CLAUDE.md §4 et piège historique #18)
    continue de charger sans erreur après ce changement (attribut `data-i18n-title` ajouté sur
    `#comment-author`).
  - **Jamais testé dans un vrai document Grist** (voir §8/§9 de CLAUDE.md) : c'est, de toutes les
    features de ce dépôt, celle dont le chemin PRINCIPAL (la détection réussissant réellement, pas
    son repli) est structurellement le MOINS vérifiable depuis ce sandbox — ni `dev-tests/
    grist-stub.js` ni aucun autre mock de ce dépôt ne simule le moteur de formules Grist ni
    l'identité utilisateur côté serveur. Le format exact de `user.Email` (une adresse email simple ?
    une chaîne vide pour un utilisateur anonyme/non connecté ? une exception plutôt qu'une valeur
    dans ce cas ?) et le comportement réel d'un `RemoveRecord` juste après un `AddRecord` dans le
    même document (latence de propagation ? confirmation immédiate ?) restent entièrement à
    confirmer sur un vrai Grist — un premier clic réel sur le bouton Commentaires d'Antoine reste
    l'unique vérification qui manque pour cette feature précise.

- **Tuiles "Cascade (waterfall)" et "Radar"** (`js/charts.js:renderChart`, `js/data.js:waterfallSeries`,
  2026-10-21, Tier 2 ROADMAP.md, "features visibles restantes" — dernière de la liste, faible
  valeur) : les 2 derniers types de tuile listés dans ROADMAP.md comme non faits. Les deux
  réutilisent EXACTEMENT les mêmes champs de formulaire que bar/pie/treemap (dimension/mesure/
  aggFn) — aucun nouveau champ, aucune nouvelle table Grist, aucun nouveau test de schéma.
  - **Waterfall** : pas de série ECharts native pour ce type (confirmé — ECharts 5.6.0 vendorisé
    dans ce dépôt n'en propose aucune). Simulation standard, documentée par ECharts lui-même pour ce
    cas : 2 séries de barres EMPILÉES (`stack: 'waterfall'`) — une invisible (`base`, la partie du
    cumul déjà atteinte avant cette catégorie, `itemStyle: {color: 'transparent'}`,
    `tooltip: {show: false}`) portant une partie VISIBLE scindée en deux séries nommées (`rise` pour
    une valeur positive, `fall` pour une valeur négative, afin que la légende distingue Hausse/
    Baisse par de VRAIS noms de série plutôt qu'une seule couleur ambiguë). Couleurs reprises de
    `CATEGORICAL_PALETTE` (déjà validée colorblind-safe par la skill *dataviz* de ce projet, jamais
    de nouvelle couleur inventée pour cette feature) : vert (`#1baf7a`, index 2) pour la hausse,
    rouge (`#e34948`, index 7) pour la baisse.
    - **Calcul extrait dans `js/data.js` (PUR, testable sous Node)**, pas directement dans
      `js/charts.js` (DOM-dépendant) : `waterfallSeries(agg)` prend le MÊME tableau
      `[{dimension, value}, ...]` que produit déjà `groupByAggregate` (voir bar/pie/treemap), JAMAIS
      retrié (piège n°14, CLAUDE.md §7 — l'ordre d'apparition reste la source de vérité), et renvoie
      `{base, rise, fall}`. `js/charts.js` ne fait plus que construire l'option ECharts à partir de
      ce résultat, même séparation de responsabilités que `measureSeriesForTile`/`renderMeasureChart`
      (voir plus haut dans ce document).
    - **Reste cliquable pour le drill-down/cross-filter EXACTEMENT comme "bar"**, sans aucune
      adaptation du gestionnaire de clic générique (`js/charts.js:getOrCreateChartInstance`) : l'axe
      X reste catégoriel (`xAxis: {type: 'category', data: agg.map(d => d.dimension)}`), donc
      `params.name` au clic est TOUJOURS le nom de la catégorie cliquée, quelle que soit la série
      empilée visée (y compris un clic sur la partie invisible `base`, qui reste cliquable — seul son
      tooltip est supprimé, pas sa capacité à recevoir un clic). Vérifié en Playwright (voir plus
      bas) : un clic sur la 1re barre pose bien un cross-filter `Region=Nord`, identique à une tuile
      "bar" sur les mêmes données.
  - **Radar** : UNE SEULE série/un seul "polygone" couvrant TOUTES les valeurs de la dimension à la
    fois (un axe/indicateur par valeur de la dimension), PAS le radar classique Power BI (plusieurs
    MESURES en axes, pour comparer quelques entités) — ce 2e modèle a été écarté : confirmé qu'aucun
    jeu de données démonstratif de ce dépôt (`BI_StressTest` : Région/Produit/Année/Mois/Quantité/
    Montant) n'a assez de colonnes NUMÉRIQUES indépendantes pour en faire un radar multi-mesures
    démonstratif, exactement la limite déjà pressentie dans ROADMAP.md avant cette session. Même
    `max`/`min` PARTAGÉS par tous les axes (pas un max par axe, qui normaliserait chaque axe à 100%
    de sa propre valeur et rendrait toute comparaison de hauteur entre axes trompeuse) —
    `maxVal = Math.max(0, ...values)`, `minVal = Math.min(0, ...values)` (ce dernier pour couvrir une
    mesure pouvant être négative, qu'un radar ECharts ne gère pas bien avec un `min` implicite à 0).
    - **Limite technique assumée et documentée, pas une omission** : le clic ECharts sur un radar ne
      distingue PAS quel axe/indicateur a été visé — `params.name` au clic est le nom du SEUL item de
      `series[0].data` (ici `tile.measure`), jamais le nom d'un axe précis. Driller/filtrer sur cette
      valeur serait un filtre posé par erreur sur un nom de mesure, pas une vraie valeur de dimension
      — un vrai bug silencieux du genre que ce projet documente abondamment comme piège (voir
      CLAUDE.md §7). Corrigé par 2 gardes explicites plutôt que de laisser cette incohérence passer
      silencieusement :
      1. `js/charts.js:getOrCreateChartInstance` — `if (currentTile.type === 'radar') return;` dans
         le gestionnaire de clic générique, AVANT toute tentative de drill/cross-filter (même famille
         de garde que celui déjà existant pour une tuile Barres en mode mesure temporelle).
      2. `js/main.js:supportsDrillDown('radar')` renvoie `false` (comme `'pivot'`) : le formulaire
         masque entièrement la configuration du drill-down pour ce type (`drillField`/
         `addDrillLevelBtn`/`drillCrossFilterField`), pour ne jamais laisser l'utilisateur configurer
         des niveaux qui ne se déclencheraient jamais au clic. `updateFormFieldsForType`/
         `updateDrillLevelsUI` ont été réécrits pour appeler `supportsDrillDown(type)` au lieu de
         dupliquer `type === 'pivot'` à 2 endroits séparés (nettoyage mineur, même occasion).
  - **Aucun changement nécessaire côté export** (`js/data.js:tileExportSheet`/`tileExportKind`,
    `js/pdf-export.js`/`js/pptx-export.js`/`js/export.js`) : les deux nouveaux types tombent déjà
    dans la branche par défaut de `tileExportSheet` (`[dimension, measure]`, comme bar/pie/treemap,
    AUCUN cas spécial écrit pour eux), et `tileExportKind` renvoie déjà 'image' par défaut pour tout
    type hors kpi/pivot — vérifié par lecture de code, aucune branche de ces fichiers ne mentionne
    `tile.type` d'une façon qui les exclurait.
  - **Testé sous Node** (`dev-tests/test-data.js`) : `data.waterfallSeries` — cumul correct sur un
    mélange hausse/baisse/zéro dans l'ordre d'apparition (`[+10, -4, 0, +7]` → `base=[0,6,6,6]`,
    `rise=[10,0,0,7]`, `fall=[0,4,0,0]`), agrégat vide → 3 tableaux vides sans exception.
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local : les 2 types apparaissent dans le sélecteur, une tuile de chaque
    se crée et se rend (canvas ECharts non vide, aucune erreur JS) ; `#tile-drill-field` masqué pour
    radar, visible pour bar (confirmant `supportsDrillDown`) ; un clic PRÉCIS (coordonnées calculées
    via `echarts.convertToPixel`, pas une position devinée — **piège de méthodologie de test trouvé
    ET corrigé en cours de vérification** : la tuile nouvellement ajoutée se trouve tout en bas de la
    page, hors du viewport Playwright par défaut, un premier essai de clic à des coordonnées non
    scrollées dans la vue n'atteignait donc RIEN de réel côté navigateur — `element.scrollIntoView()`
    avant de mesurer `getBoundingClientRect()` a corrigé le script de test lui-même, pas le produit ;
    confirmé en isolant la technique sur une tuile "bar" déjà existante, qui fonctionnait déjà avant
    ce correctif de script) sur la 1re barre d'une tuile waterfall pose bien un cross-filter
    `Region=Nord` (identique à "bar") ; le même clic au centre d'une tuile radar NE pose AUCUN filtre
    supplémentaire (garde confirmée). Vérifié aussi que `index.html` (import map distinct de
    `dev-tests/harness.html`, piège historique #18) continue de charger sans erreur après l'ajout des
    2 nouvelles options du sélecteur de type.
  - **Jamais testé dans un vrai document Grist** (voir §8/§9 de CLAUDE.md), comme tout rendu ECharts
    de ce projet — aucun point aveugle SPÉCIFIQUE à ces 2 types au-delà de ce qui s'applique déjà à
    bar/pie/treemap/scatter.

- **Export Excel des tuiles en mode mesure (Cumul/YTD/N-1) — vraies valeurs (2026-10-21, Tier 2
  ROADMAP.md)** : jusqu'ici, `GristBI.data.tileExportSheet` remplaçait une tuile Barres en mode
  mesure par un texte explicite ("Export non disponible…", voir l'entrée "Export PDF du dashboard"
  plus haut) plutôt que les vraies valeurs — le calcul réel (`GristBI.duckdbEngine.timeSeriesMeasures`)
  est ASYNCHRONE, incompatible avec cette fonction volontairement pure/synchrone (testable sous
  Node). Contrairement à l'export PDF/PPTX (qui contourne ce mur en capturant l'image déjà rendue),
  l'export Excel a besoin des VRAIES données tabulaires, pas d'une image — il n'y a pas de
  contournement équivalent.
  - **Mécanisme retenu** : deux nouvelles fonctions dans `js/data.js`, `measureExportSheet(tile,
    state, computeMeasureSeries)` et `buildWorkbookSheetsAsync(state, computeMeasureSeries)`,
    variantes async de `tileExportSheet`/`buildWorkbookSheets` (gardées inchangées, toujours
    utilisées par `js/pdf-export.js`/`js/pptx-export.js` pour kpi/pivot, qui ne passent jamais par
    le cas mesure — `tileExportKind` route toujours une tuile Barres vers 'image'). Seule UNE tuile
    en mode mesure déclenche `computeMeasureSeries` ; toutes les autres tuiles du classeur restent
    calculées par le chemin pur/synchrone existant, inchangé.
  - **`computeMeasureSeries` est INJECTÉ par l'appelant** (`js/export.js`, qui fournit
    `(tile, rows) => GristBI.duckdbEngine.timeSeriesMeasures(rows, tile.dateColumn, tile.measure,
    tile.aggFn)` — même appel que `js/charts.js:renderMeasureChart`, pour garantir que l'export
    contient EXACTEMENT les valeurs affichées à l'écran) plutôt qu'importé directement dans
    `js/data.js` : ce module reste sans dépendance à un autre module GristBI (voir son en-tête),
    donc testable sous Node avec une fonction factice, sans jamais toucher à DuckDB-WASM (dont
    l'exécution réelle nécessite un navigateur, voir CLAUDE.md §5). Un échec du calcul (DuckDB
    indisponible, erreur SQL) retombe sur un message explicite PAR TUILE (`measureExportSheet`
    attrape l'erreur) plutôt que de faire échouer tout le classeur.
  - `js/export.js:exportDashboardToExcel` et le gestionnaire de clic (`js/main.js`) sont devenus
    `async`/`await` en conséquence — seul changement de surface côté appelant, le reste de l'UI
    (alerte si classeur vide, message d'erreur générique) est inchangé.
  - **Testé sous Node** (`dev-tests/test-data.js`) : `measureExportSheet` pour les modes `ytd` (1
    colonne) et `yoy` (2 colonnes, `previousYear` manquant -> chaîne vide dans la cellule plutôt que
    `null`) avec un `computeMeasureSeries` factice (Promise résolue avec un `timeSeries` écrit à la
    main) ; le cas d'échec (`computeMeasureSeries` qui rejette) ; `buildWorkbookSheetsAsync` sur un
    classeur mixte (une tuile normale + une tuile mesure) vérifiant que seule la tuile mesure
    déclenche l'injection, l'autre restant calculée à l'identique de `buildWorkbookSheets`.
  - **Testé en Playwright contre un vrai navigateur** (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local (`dev-tests/harness.html`, donc le vrai `js/duckdb-engine.js`
    s'exécute, pas un mock) : tuile Barres en mode YTD sur la colonne `Date`/mesure `Montant` des
    47 040 lignes réelles de `BI_StressTest`, export cliqué, fichier `.xlsx` réellement téléchargé
    relu côté Node (SheetJS vendorisé, `XLSX.read` sur le buffer) — la feuille de cette tuile
    contient 84 lignes (7 ans × 12 mois, cohérent avec la vérification à l'écran de la feature DAX
    d'origine, voir plus haut) et uniquement des valeurs YTD numériques finies, strictement
    croissantes à l'intérieur d'une même année puis qui repartent plus bas en janvier (comportement
    YTD attendu) — plus aucun message "non disponible" dans ce classeur. Pas testé : les modes
    `cumulative`/`yoy` en conditions réelles de navigateur (seulement sous Node avec un
    `computeMeasureSeries` factice) — jugé suffisant, `measureSeriesForTile` (qui produit les deux
    autres formes) est déjà testé exhaustivement sous Node par ailleurs (voir plus haut dans ce
    document), et `ytd` exerce le même chemin DuckDB réel que les deux autres modes.

- **Moteur DuckDB-WASM étendu à TOUTE agrégation, pas seulement les mesures façon DAX (2026-10-21,
  Tier 2 ROADMAP.md, valeur Haute)** : jusqu'ici, `js/duckdb-engine.js` (`groupByAggregate`/
  `aggregateSingle`, posés le 2026-09-16) n'était réellement consommé que par
  `timeSeriesMeasures` (mesures DAX, voir plus haut) — la "fondation" posée restait, pour le reste
  du rendu (bar/pie/treemap/scatter/kpi/gauge/pivot), une API inutilisée : `js/charts.js` calculait
  toujours en JS pur (`Array.reduce`, via `js/data.js:groupByAggregate`/`aggregateSingle`/
  `pivotTable`), exactement ce que ROADMAP.md citait comme objectif Tier 2 ("remplace Array.reduce")
  sans encore être fait.
  - **Nouvelle fonction** `GristBI.duckdbEngine.pivotTable(rows, rowDim, colDim, measureCol, aggFn)`
    — équivalent SQL de `js/data.js:pivotTable` (même contrat : `rowKeys`/`colKeys` dans l'ordre de
    1re apparition, cellule `null` plutôt que `0` à une intersection sans donnée, totaux calculés en
    ré-agrégeant les lignes brutes, jamais en recombinant des cellules déjà agrégées). 4 requêtes
    séparées sur la même table temporaire (ordre+totaux lignes, ordre+totaux colonnes, cellules,
    total général) plutôt qu'une seule combinée par `UNION` : `rowDim`/`colDim` peuvent être de
    types SQL différents (texte vs nombre), qu'une `UNION` obligerait à forcer vers un type commun
    pour rien — 4 petits aller-retours restent négligeables face au coût fixe du moteur lui-même.
  - **`js/charts.js` choisit automatiquement le moteur selon le volume** : `DUCKDB_ROW_THRESHOLD`
    (5000 lignes, valeur choisie empiriquement — pas une recommandation DuckDB officielle, pensée
    pour rester nettement sous le volume de `BI_StressTest`, ~47 000 lignes, tout en laissant les
    dashboards habituels, bien plus petits, sur le chemin JS synchrone existant) décide, pour
    `groupByAggregate`/`aggregateSingle`/`pivotTable`, d'appeler `GristBI.duckdbEngine` plutôt que
    `js/data.js`. **Sous le seuil : AUCUN changement de comportement** — toujours synchrone, comme
    avant cette feature. Un échec du calcul DuckDB (chargement WASM, erreur SQL) retombe
    silencieusement sur le calcul JS (`console.warn`), jamais une tuile cassée.
  - **Toutes les fonctions de rendu de `js/charts.js` sont devenues `async`** (`renderKpi`/
    `renderGauge`/`renderChart`/`renderPivot`, en plus de `renderMeasureChart` qui l'était déjà) —
    changement structurel le plus risqué de cette feature. Le compteur de rendu périmé
    (`measureRenderSeq`, qui ne protégeait jusqu'ici que `renderMeasureChart`) a été généralisé en
    `renderSeq`/`bumpSeq`/`isStale`, PARTAGÉ par tuile entre TOUTES les fonctions de rendu plutôt
    qu'un compteur par fonction : si une tuile change de TYPE (ex. Barres -> KPI) pendant qu'un
    calcul DuckDB du rendu précédent est encore en vol, ce résultat périmé doit être abandonné lui
    aussi, pas seulement un résultat périmé du même type de rendu. KPI (valeur + tendance) et
    scatter (mesure X + mesure Y) lancent leurs 2 calculs indépendants en parallèle (`Promise.all`)
    plutôt qu'en séquence, pour ne payer qu'une fois la latence du plus lent des deux. Un indicateur
    de chargement ECharts (`showLoading`/`hideLoading`, même mécanisme que `renderMeasureChart`) est
    affiché UNIQUEMENT quand ce rendu précis dépasse le seuil — jamais pour les dashboards habituels.
    `js/data.js:computeTrend` a été factorisé en `trendFromGroups` (logique de comparaison pure,
    réutilisable sur un résultat de groupement obtenu par N'IMPORTE QUEL moteur) + `computeTrend`
    (wrapper JS inchangé, pour ne pas casser sa suite de tests existante) — `js/charts.js` réutilise
    `trendFromGroups` dans son propre `computeTrendAsync`.
  - **Testé en navigateur réel** (script ad hoc Playwright, non committé, voir §5 de CLAUDE.md),
    servi en HTTP local (`dev-tests/harness.html`, vrai DuckDB-WASM, pas un mock) :
    - Les 3 fonctions DuckDB patchées pour compter leurs appels réels : confirmé qu'elles sont
      effectivement invoquées pour les 7 types de tuile (bar/pie/treemap/scatter/kpi/gauge/pivot)
      sur les 47 040 lignes de `BI_StressTest` (largement au-dessus du seuil), et confirmé qu'AUCUN
      appel DuckDB supplémentaire n'a lieu quand un filtre (`Mois='Janvier'`, 3 920 lignes) fait
      repasser une tuile SOUS le seuil en une seule étape.
    - Comparaison directe DuckDB vs JS pur sur les lignes réelles : `groupByAggregate` (bar,
      Region/Montant/sum), `aggregateSingle` (kpi, Montant/avg) et surtout `pivotTable` (nouveau) —
      mêmes `rowKeys`/`colKeys`, même `grandTotal`, et TOUTES les cellules identiques une par une
      (pas seulement les totaux/clés), valeurs exactes confirmées par la sortie du script
      (`grandTotal` DuckDB = `grandTotal` JS = 10841219 sur ce jeu de données).
    - Stabilité de l'instance ECharts à travers plusieurs re-rendus asynchrones successifs d'une
      même tuile (toujours au-dessus du seuil) : même instance, jamais disposée, `showLoading()`
      bien appelé pendant le calcul — le gestionnaire de clic déjà câblé par
      `getOrCreateChartInstance` reste donc attaché, cette fonction elle-même n'ayant pas été
      modifiée par cette feature.
    - **Non reproduit en conditions réelles** : un échec du calcul DuckDB lui-même (nécessiterait de
      faire échouer le chargement WASM, non simulé ici) — seulement vérifié par relecture du code
      (`try`/`catch` présent autour de chaque appel). Le gain de PERFORMANCE chiffré (DuckDB vs JS
      sur ce volume ou un volume encore plus grand) n'a pas non plus été mesuré : cette session a
      vérifié la CORRECTION des valeurs et le bon déclenchement du seuil, pas le temps de calcul —
      voir TEST_PROTOCOL.md.
  - **[BUG RÉEL trouvé en relecture, avant tout commit]** `renderGauge`/`renderChart` ne levaient
    `hideLoading()` que `if (usingDuckDb)` — où `usingDuckDb` est réévalué à CHAQUE appel à partir du
    nombre de lignes de CET appel précis. Scénario concret : un 1er rendu d'une tuile AU-DESSUS du
    seuil affiche le masque (`showLoading`) puis attend un calcul SQL réel ; avant qu'il ne se
    termine, un filtre fait retomber cette MÊME tuile SOUS le seuil — le 2e rendu (le gagnant, via
    `isStale`) a alors son PROPRE `usingDuckDb` à `false` et ne lève donc pas le masque, tandis que le
    1er rendu, devenu périmé, retourne avant même d'atteindre sa propre ligne `hideLoading()`. Aucun
    des deux appels ne lève jamais le masque : il reste affiché indéfiniment au-dessus d'un graphique
    pourtant à jour, jusqu'à ce qu'un futur rendu de cette tuile repasse par hasard au-dessus du
    seuil et se termine sans être lui-même invalidé. Corrigé en rendant `hideLoading()`
    INCONDITIONNEL après le contrôle `isStale`/`isDisposed()` dans les deux fonctions (ECharts
    documente `hideLoading()` comme sans effet si aucun masque n'est affiché — `renderMeasureChart`,
    seul chemin async préexistant à cette feature, le fait déjà ainsi sans condition). **Non
    reproduit de façon fiable par un test Playwright chronométré** : plusieurs tentatives (deux
    `toggleFilter` synchrones consécutifs pour la même tuile, y compris avec un délai artificiel
    injecté dans `GristBI.duckdbEngine.groupByAggregate`) n'ont pas permis d'isoler un cas où les deux
    rendus candidats s'enchaînent de façon suffisamment déterministe dans ce navigateur headless pour
    observer directement le masque bloqué — la preuve retenue est la relecture du code (chemin
    d'exécution tracé ligne à ligne, aucune autre ligne du fichier n'appelle `hideLoading()` sur cette
    instance, vérifié par recherche dans tout `js/`), pas une capture d'écran d'un masque réellement
    bloqué. À revérifier manuellement dans un vrai navigateur si un masque de chargement semble
    "collé" sur une tuile après un filtrage rapide.

- **Retrait du code de création de table de données (`BI_StressTest`)** (2026-10-21, demande
  explicite de l'utilisateur formulée le 2026-09-19 dans un autre fil — voir CLAUDE.md §1/§3/§7/§8).
  - **Pourquoi** : ce POC avait été conçu, par commodité de démonstration, pour créer et remplir
    lui-même sa table de travail (`BI_StressTest`, ~47 040 lignes) au premier démarrage. L'utilisateur
    n'en a plus besoin — dans un usage réel, le widget doit se connecter à une table QUE l'UTILISATEUR
    possède déjà dans son document, jamais créer la sienne.
  - **Retiré de `js/grist-api.js`** : les constantes `STRESS_TABLE`/`LEGACY_STRESS_TABLE_NAMES`, la
    fonction `loadOrCreateStressData` et tout le mécanisme de migration de nom legacy
    (`migrateLegacyTableName`, qui n'existait que pour renommer un ancien `BI_StressTest_v1`/`_v2`
    vers le nom fixe — sans raison d'être une fois la table elle-même retirée). `loadOrCreateTable`
    perd son paramètre `legacyNames`, devenu inutile (son seul autre appelant, `loadOrCreateComments`,
    l'appelait déjà avec `[]`). `listAvailableTables()` exclut désormais aussi `BI_Dashboard_Comments`
    de la liste (en plus de `BI_Dashboard_Config`/`BI_Dashboard_UserProbe`, déjà exclues) — **bug
    trouvé en relecture avant ce commit** : sans ce 3e filtre, `BI_Dashboard_Comments` pouvait
    apparaître dans le sélecteur de table ET être choisie par erreur comme 1re table au démarrage
    (voir plus bas), le widget se connectant alors à ses propres commentaires comme s'il s'agissait
    de données à visualiser.
  - **Retiré de `js/main.js`** : `defaultTableId`, le bouton "Restaurer les tuiles par défaut"
    (`restoreDefaultTilesBtn`, et son écouteur de clic), le paramètre `seedTiles` de `switchTable`
    (plus aucun jeu de tuiles par défaut connu d'une table). `bootstrap()` ne passe plus par
    `loadOrCreateStressData` : il appelle `GristBI.api.listAvailableTables()` et se connecte à la
    1re table renvoyée (`GristBI.api.loadTable`, simple lecture, jamais de création) ; si la liste
    est vide, affiche `status.noTables` dans le bandeau plutôt que de créer quoi que ce soit. `render()`
    affiche désormais ce même message (plutôt que "0 ligne(s)") tant qu'aucune table n'est connectée
    (`currentTableId` nul) — pour qu'un changement de langue en cours d'état "pas de table" ne
    bascule pas à tort sur un faux "0 ligne(s)".
  - **Retiré de `index.html`/`dev-tests/harness.html`** : le bouton "Restaurer les tuiles par
    défaut" dans `#empty-state`, et le `<script src="js/demo-data.js">` lui-même — ce fichier n'est
    plus utilisé par AUCUN code chargé dans le navigateur (vérifié par recherche de `GristBI.demoData`
    dans tout `js/` : plus aucune référence hors `dev-tests/test-data.js`, qui le `require()`
    directement sous Node). `js/demo-data.js` reste dans le dépôt comme fixture de test Node pure
    (génération/cohérence du jeu de données, dérivation de `Date`) — jamais chargé en production.
  - **i18n** (`js/i18n.js`) : retrait des clés devenues orphelines (`emptyState.restoreDefaults`,
    `status.migrating`/`status.creating`/`status.progress`, qui ne servaient qu'à la barre de
    progression de remplissage de `BI_StressTest`) ; ajout de `status.noTables` (fr/en).
  - **Testé sous Node** (`dev-tests/test-data.js`) : aucun changement de comportement attendu côté
    `js/data.js`/`js/state.js`/`js/demo-data.js` (ce dernier reste exercé tel quel comme fixture) —
    suite rejouée verte après ce retrait.
  - **Testé en navigateur réel** (`dev-tests/harness.html`, servi en HTTP local, mock
    `grist-stub.js`) :
    - Ce harnais préremplit désormais le mock avec une petite table `Ventes` de démonstration
      (`window.__gristStubPreseed`, 8 lignes) : au chargement, le widget s'y connecte automatiquement
      sans la créer (confirmé : aucun appel `AddTable` observé pour `Ventes`), le sélecteur de table
      la propose, et `BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe` restent
      absentes de cette liste.
    - Document SANS préremplissage (`__gristStubPreseed` non défini) : le bandeau affiche bien le
      message "Aucune table dans ce document…" (`status.noTables`) au lieu de créer une table ; en
      ajoutant ensuite une table via le mock (simulant l'utilisateur qui en crée une dans Grist) et en
      ouvrant le sélecteur, elle apparaît et peut être choisie SANS recharger la page — confirme que
      `beforeOpen: refreshTablePicker` (relecture fraîche, déjà existant) couvre bien ce cas.
    - `BI_Dashboard_Comments`/`BI_Dashboard_UserProbe` : toujours créées sans erreur au bootstrap
      (confirmé par les appels `AddTable` observés, un par table, aucun pour la table de travail
      elle-même) — ces deux tables internes continuent d'être créées par le même `loadOrCreateTable`
      (désormais sans paramètre `legacyNames`). Le flux complet (ajout d'un commentaire, détection
      réelle de l'auteur) n'a pas été rejoué dans cette vérification ciblée, mais son code n'a subi
      aucune modification par ce retrait.
  - **Non vérifié depuis cette session** : le comportement réel sur un vrai document Grist qui
    possédait déjà une table `BI_StressTest` créée par une version antérieure de ce widget — elle
    n'est plus jamais recréée ni migrée (le mécanisme de migration de nom a été retiré avec elle),
    mais elle n'est pas non plus supprimée automatiquement (`RemoveTable` toujours jamais utilisé,
    voir CLAUDE.md §8) : une table orpheline resterait visible dans le document, et apparaîtrait
    désormais dans le sélecteur de table comme n'importe quelle autre table de l'utilisateur
    (plus aucun traitement spécial), ce qui est le comportement attendu mais n'a pas pu être
    confirmé contre un vrai document portant déjà cette table.

- **Radar — mode "compétences en colonnes" (2026-11-02)**, suite à une idée du forum Grist relayée
  par le porteur (entretiens d'orientation, ~400 élèves, compétences déjà en colonnes plutôt qu'en
  lignes — https://forum.grist.libre.sh/t/2196) : un radar peut désormais tirer ses axes de
  plusieurs colonnes numériques choisies (`tile.radarAxisMode === 'columns'`, `tile.radarAxes`),
  en plus du mode "dimension" classique (une seule colonne catégorielle groupée, comportement
  historique inchangé — c'est toujours le mode par défaut pour une tuile sans `radarAxisMode`).
  - **Formulaire** (`js/main.js`) : nouveau champ "Axes du radar" (`#tile-radar-mode`, select
    dimension/columns, visible seulement pour `type === 'radar'`) qui bascule entre les champs
    dimension/mesure/agrégat existants (mode "dimension") et un nouveau sélecteur dynamique "Axes
    (colonnes numériques)" (`#tile-radar-axes`, même pattern "+ Axe" que les niveaux de drill-down —
    `createRadarAxisSelect`/`radarAxisSelects`/`MAX_RADAR_AXES = 8`), limité aux colonnes classées
    "nombre" par `inferColumnKind` (`numericColumns`). Mesure/agrégat masqués en mode "columns" (la
    valeur de chaque axe est TOUJOURS une moyenne de la colonne sur le groupe, pas un agrégat
    configurable — une seule option sensée pour des notes/scores, pas besoin d'un sélecteur de plus).
    Garde-fou identique au drill-down : une même colonne ne peut pas être choisie deux fois comme
    axe (`tileForm.alert.radarAxesDuplicate`).
  - **Rendu** (`js/charts.js:renderChart`) : en mode "columns", `computeGroupBy` (dimension/mesure
    classiques) n'est PAS appelé (`tile.dimension`/`tile.measure` ne sont pas renseignés dans ce
    mode) — à la place, une moyenne par colonne choisie via `computeAggregateSingle` (donc routée
    vers DuckDB-WASM au-delà du seuil comme toute autre agrégation, voir CLAUDE.md §2/§6), les N
    appels lancés en parallèle comme pour les deux mesures de "scatter". Même max/min PARTAGÉ entre
    tous les axes qu'en mode "dimension" (raison inchangée, voir le commentaire déjà présent dans
    `renderChart`).
  - **Export Excel** (`js/data.js:tileExportSheet`) : nouvelle branche dédiée AVANT le calcul de
    `currentDimension` (qui vaudrait `undefined` en mode "columns", un radar n'ayant de toute façon
    jamais de drill-down) — un en-tête = les colonnes choisies, une seule ligne = la moyenne de
    chaque colonne sur les lignes visibles (`aggregateSingle(rows, col, 'avg')`, jamais DuckDB : même
    choix que le reste de cette fonction, volontairement pure/synchrone). Le mode "dimension" continue
    de tomber dans la branche générique existante, AUCUN changement de comportement pour lui.
  - **Testé sous Node** (`dev-tests/test-data.js`) : `tileExportSheet` en mode "columns" (moyenne
    correcte par colonne, en-tête = les colonnes) et en mode "dimension"/classique (inchangé, même
    fixture que le test `tileExportSheet` existant pour bar/pie/treemap).
  - **Testé en navigateur réel** (`dev-tests/harness.html`, servi en HTTP local via Playwright, mock
    `grist-stub.js`, table `Ventes` préremplie à 8 lignes/2 colonnes numériques Montant/Quantite —
    voir l'entrée juste au-dessus) : bascule du formulaire dimension ↔ columns (champs
    mesure/agrégat qui se masquent/réapparaissent correctement), ajout dynamique d'un 2e axe via
    "+ Axe", soumission, rendu d'une tuile radar à 2 axes (Quantite/Montant) sans erreur console ;
    PUIS un 2e radar en mode "dimension" classique (Region/Montant/Somme) soumis juste après dans la
    même session de formulaire, pour confirmer l'absence de régression — les deux tuiles
    coexistent et se rendent correctement (capture d'écran vérifiée). **[BUG RÉEL trouvé en testant
    ce harnais]** : `dev-tests/harness.html` duplique entièrement le DOM du formulaire d'ajout de
    tuile plutôt que de charger `index.html` (voir CLAUDE.md §4, "même DOM" y est trompeur — c'est
    une COPIE manuelle, pas un partage) — les nouveaux champs ajoutés à `index.html` seul
    (`#tile-radar-mode-field`, `#tile-radar-axes-field`, les id `#tile-measure-field`/
    `#tile-agg-field`) étaient absents du harnais, provoquant un `TypeError` au chargement
    (`addRadarAxisBtn.addEventListener` sur `null`) qui cassait silencieusement TOUT le reste de
    l'initialisation de `js/main.js` (plus aucun champ du formulaire ne répondait). Corrigé en
    répliquant les mêmes 3 modifications dans `dev-tests/harness.html`. Un rappel direct de la note
    déjà présente en mémoire de projet : "le harnais ne prouve pas que `index.html` charge — le
    vérifier lui-même".
  - **Non testé** : rendu au-delà du seuil DuckDB (`DUCKDB_ROW_THRESHOLD = 5000`) pour le mode
    "columns" — la table de démonstration du harnais n'a que 8 lignes ; le chemin DuckDB
    (`computeAggregateSingle`) est le même que celui déjà exercé par les autres types de tuile
    au-delà du seuil, mais pas revérifié spécifiquement pour ce nouvel appelant.

- **Radar — comparaison élève/moyenne du groupe filtré (2026-11-02)**, même fil du forum que
  l'entrée ci-dessus (https://forum.grist.libre.sh/t/2196, « superposer élève et moyenne de
  classe ») : un radar (mode "columns" OU mode "dimension" classique) peut désormais superposer le
  polygone d'UNE entité précise (`tile.radarEntityColumn`/`tile.radarEntityValue`, ex. une ligne
  "Eleve = Dupont") à celui du groupe entier actuellement filtré pour la tuile (case "Comparer
  aussi à la moyenne du groupe filtré", `tile.radarCompareAverage`), en 2 séries ECharts avec
  légende. Sans entité choisie, comportement rigoureusement inchangé (une seule série, comme avant
  cette feature) — vérifié par relecture des branches de repli (`hasRadarEntity` à `false` dans
  `js/charts.js`/`js/data.js` retombe sur le code déjà existant, pas une nouvelle branche parallèle).
  - **Formulaire** (`js/main.js`) : 2 nouveaux comboboxes "Comparer une valeur (colonne)"
    (`#tile-radar-entity-column`, toutes colonnes, pas seulement numériques) et "Valeur à comparer"
    (`#tile-radar-entity-value`, valeurs distinctes de la colonne choisie via
    `GristBI.data.distinctColumnValues`, recalculées à chaque changement de colonne) + une case à
    cocher "Comparer aussi à la moyenne du groupe filtré" (`#tile-radar-compare-average`) — tous les
    3 visibles pour `type === 'radar'` dans les DEUX modes d'axes, masqués sinon. La case n'a d'effet
    que si une entité est choisie (sinon elle est ignorée silencieusement, pas de validation
    bloquante côté formulaire : une case cochée sans entité ne casse rien, elle ne fait juste rien).
  - **Rendu** (`js/charts.js:renderChart`) : les lignes de l'entité sont isolées PARMI les lignes déjà
    filtrées pour la tuile (`rows.filter(r => sameValue(r[tile.radarEntityColumn], tile.radarEntityValue))`
    — donc après cross-filtres/filtres avancés/drill-down, jamais avant), avec `sameValue` comme
    partout où une valeur de formulaire (string) est comparée à une valeur de ligne (voir piège n°7,
    CLAUDE.md §7). En mode "columns", la valeur de l'entité par axe est sa propre moyenne sur CES
    lignes (`computeAggregateSingle(radarEntityRows, col, 'avg')` — une moyenne même si l'entité n'a
    qu'une seule ligne, pour rester cohérent avec la moyenne du groupe). En mode "dimension", l'axe
    list AUTORITATIVE reste celle du groupe entier (`agg`, jamais celle, potentiellement plus
    courte, de l'entité) ; les valeurs de l'entité sont reprojetées sur cette liste par nom via une
    `Map`, un axe que l'entité n'a pas étant comblé à `0` plutôt que de raccourcir le polygone ou de
    planter (ex. un élève sans note dans une matière). Libellé de la série "groupe" : "Moyenne du
    groupe" (`chart.radar.groupAverage`, nouvelle clé i18n) en mode "columns" où il n'y a pas de nom
    de mesure unique à réutiliser ; `tile.measure` en mode "dimension" (identique au libellé déjà
    utilisé AVANT cette feature pour l'unique série d'un radar classique — choix délibéré de ne pas
    renommer un libellé existant). Une valeur d'entité orpheline (absente des lignes filtrées, ex.
    élève retiré par un cross-filtre) retombe silencieusement sur le rendu SANS entité (une seule
    série, celle du groupe) — jamais un polygone vide ni une erreur.
  - **Export Excel** (`js/data.js:tileExportSheet`) : même logique dupliquée en pur/synchrone
    (jamais DuckDB, cohérent avec le reste de cette fonction) — 1 ligne par série plutôt que la ligne
    unique existante, colonne "Série" en tête (nom de l'entité, puis "Moyenne" si la case est
    cochée), 0 en comblement pour un axe manquant côté entité en mode "dimension", même repli
    silencieux sur le format SANS entité pour une valeur orpheline.
  - **Testé sous Node** (`dev-tests/test-data.js`, 5 nouveaux cas) : mode "columns" avec entité
    seule, mode "columns" avec entité + moyenne, mode "dimension" avec entité + moyenne (axes =
    valeurs du groupe, pas le nom de la colonne dimension — erreur commise puis corrigée en écrivant
    ce test, voir le calcul à la main refait depuis la fixture), mode "dimension" avec une entité à
    qui il manque un axe (comblé à 0, sans ligne "Moyenne" puisque la case n'était pas cochée dans ce
    cas), et une valeur d'entité orpheline (repli identique au rendu sans entité). Les 82 lignes `OK`
    passent, aucune régression sur les tests déjà existants.
  - **Testé en navigateur réel** (`dev-tests/harness.html`, Playwright, jeu de données préremplifié
    via `window.__gristStubPreseed` — PAS le mock par défaut de 8 lignes, bien plus réaliste : 400
    "élèves" avec 5 colonnes de compétence numériques + une colonne "Classe" à 2 valeurs, directement
    inspiré du cas du forum) : (1) tuile radar "columns" à 5 axes avec entité "Eleve 042" + case
    "moyenne" cochée → 2 séries rendues, légende correcte, pentagone cohérent (l'élève proche du
    centre sur un axe, au-dessus de la moyenne sur un autre) ; (2) tuile radar "dimension" classique
    (Classe/Communication/Moyenne) avec entité "Eleve 007" + case cochée → 2 séries rendues
    (dégénéré visuellement avec seulement 2 valeurs de Classe, normal pour ce mode, pas un bug de
    cette feature) ; (3) édition de la 1re tuile → les 3 nouveaux champs (mode, colonne entité,
    valeur entité, case moyenne) correctement préremplis par `startEditTile`. **Zéro erreur
    console** sur l'ensemble du flux, y compris sur `index.html` lui-même testé séparément hors du
    harnais (voir l'entrée ci-dessous sur ce point précis) — confirme que la leçon du bug du
    harnais trouvé lors de la feature précédente (ci-dessus) n'a pas été reproduite ici : les mêmes
    3 nouveaux champs HTML ont été répliqués dans `dev-tests/harness.html` dans le MÊME changement
    que `index.html`, diffés immédiatement (`diff` de la section `<form id="add-tile-form">`,
    "IDENTIQUE") avant toute autre étape.
  - **`index.html` vérifié séparément de `dev-tests/harness.html`** (nouveau script Playwright ad
    hoc, chargement direct de `http://localhost:8923/index.html`, PAS le mock) : les 7 ids de champ
    radar (`tile-radar-mode-field`, `tile-radar-axes-field`, `tile-radar-entity-column-field`,
    `tile-radar-entity-value-field`, `tile-radar-compare-average-field`, `tile-measure-field`,
    `tile-agg-field`) sont bien présents dans le DOM statique, et aucune erreur de type
    `TypeError`/`addEventListener sur null` (la signature du bug ci-dessus) n'apparaît — seules des
    erreurs ATTENDUES et déjà documentées (`grist is not defined`, `ERR_TUNNEL_CONNECTION_FAILED`),
    puisque `grist-plugin-api.js` réel ne peut par construction pas fonctionner hors d'un vrai
    iframe Grist dans ce sandbox (voir CLAUDE.md §4, §9).
  - **Non testé** : rendu au-delà du seuil DuckDB pour cette feature spécifiquement (même limite que
    l'entrée ci-dessus — 400 lignes reste sous `DUCKDB_ROW_THRESHOLD = 5000`, le chemin DuckDB de
    `computeAggregateSingle` est générique et déjà exercé ailleurs, mais pas par CET appelant
    précis) ; le comportement réel d'un très grand nombre de valeurs distinctes dans le sélecteur
    "Valeur à comparer" (combobox non virtualisé) sur un vrai document à plusieurs milliers de
    lignes.

- **Nuage de mots (2026-11-03)**, suite à une capture Power BI partagée par Antoine (mots-clés/auteurs
  de publications, taille = fréquence, rotation, couleurs variées). Nouveau type de tuile
  (`js/charts.js`, série ECharts `type: 'wordCloud'`), deux modes (`tile.wordCloudSplit`, case à
  cocher du formulaire) :
  - **"Une entrée par ligne"** (défaut) : chaque valeur de la dimension est UN mot, taille = compte ou
    mesure choisie — `js/data.js:wordFrequency` délègue alors STRICTEMENT à `groupByAggregate`
    (même chemin de code que "bar", vérifié par un test Node qui compare les deux résultats avec
    `assert.deepStrictEqual`). Cliquable comme bar/pie (cross-filter/drill-down), puisque chaque mot
    correspond exactement à une valeur de colonne.
  - **"Découpage de cellule"** : une colonne comme Keywords, avec plusieurs mots-clés dans une même
    cellule (séparés par virgule/espace/autre ponctuation), fréquence cumulée sur TOUTES les lignes
    (`wordFrequency(rows, column, true)`, tokenisation par regex Unicode `[^\p{L}\p{N}'-]+`,
    insensible à la casse, graphie de la 1re occurrence conservée, mots d'1 caractère ignorés).
    Mesure/agrégat masqués dans le formulaire (n'ont pas de sens ici, voir `isWordCloudSplitMode`).
    **Clic neutralisé pour ce mode précisément** : un mot issu du découpage (ex. "génétique") ne
    correspond à AUCUNE valeur de colonne exacte (la cellule d'origine vaut "génétique, cohorte,
    adolescent") — un filtre par égalité stricte sur ce mot viderait silencieusement la tuile plutôt
    que de filtrer quoi que ce soit de cohérent (le widget n'a pas de filtre de clic de type
    "contient"). Même traitement que le clic neutralisé sur un radar (guard dans
    `getOrCreateChartInstance`, js/charts.js).
  - **Changement de bibliothèque le même jour (03/11/2026, 2e lot)** : la bibliothèque
    `echarts-wordcloud` choisie dans le 1er lot (voir ci-dessus, paquet npm officiel
    `ecomfe/echarts-wordcloud`) a été écartée après qu'Antoine a demandé de vérifier s'il existait
    une lib plus récente/mieux maintenue — son dépôt amont n'a plus reçu de commit de code depuis
    2022-11-24. Recherche faite (registre npm + GitHub, dates de publication réelles comparées) :
    `d3-cloud` (`jasondavies/d3-cloud`) a publié une réécriture complète (2.0.0, ESM-only, zéro
    dépendance, tests + types + guide de migration, licence BSD-3-Clause) le **2026-10-30, soit 4
    jours avant cette vérification** — nettement le candidat le mieux maintenu des options
    comparées (`wordcloud`/wordcloud2.js : dernière version 2024-11-14 ; `chartjs-chart-wordcloud` :
    nécessite Chart.js, un second moteur de graphiques pour ce seul type de tuile, écarté pour cette
    raison architecturale plutôt que pour sa maintenance). Soumis à Antoine par une carte de
    décision (3 options, dont "garder echarts-wordcloud") : il a choisi d3-cloud.
  - **Contrepartie assumée de ce choix** : contrairement à `echarts-wordcloud`, `d3-cloud` ne fait
    QUE le calcul de placement des mots (voir son README : "your application renders the results
    with canvas, SVG, or another renderer") — ni rendu ni détection de clic/survol intégrés. Ce
    dépôt dessine donc lui-même sur un `<canvas>` dédié par tuile (`js/charts.js:drawWordCloud`,
    `getOrCreateWordCloudCanvas`) et fait sa propre détection de clic/survol
    (`hitTestWordCloud` — inverse la rotation appliquée au dessin pour ramener le point cliqué dans
    le repère local, non tourné, du mot) : nettement plus de code que pour les autres types de
    tuile, qui délèguent tout cela à ECharts. La logique de clic (drill-down vs filtre croisé,
    exclusions radar/mesure DAX/découpage de cellule) a été extraite dans `handleTileClick`,
    partagée par le gestionnaire de clic ECharts générique ET le `<canvas>` du nuage de mots — pas
    de duplication entre les deux chemins.
  - **Dépend toujours d'une bibliothèque demandée à GFS plutôt que vendorisée/chargée en CDN par
    l'app elle-même** (même protocole que le 1er lot, voir `GFS-ETAT.md` "Demandes à GFS" — demande
    mise à jour, pas dupliquée) : `d3-cloud` 2.0.0, dont le build navigateur (`build/d3-cloud.js`,
    champs `unpkg`/`jsdelivr` de son `package.json`) est un module ES **sans aucun build UMD** (ce
    lot de version l'a explicitement retiré, voir son CHANGELOG) — `js/charts.js` en fait un
    `import('d3-cloud')` (spécificateur NU, même mécanisme déjà utilisé par ce dépôt pour
    `apache-arrow`/`flatbuffers`/`tslib` via l'`importmap` d'`index.html`), absent de cet importmap
    tant que GFS n'a pas ajouté l'entrée correspondante. Sans elle, l'import échoue IMMÉDIATEMENT
    (spécificateur non résolu, aucune requête réseau — contrairement à `typeof
    global['echarts-wordcloud'] === 'undefined'` qui vérifiait un global après chargement) ;
    l'échec est intercepté (mémoïsé, comme `GristBI.duckdbEngine.init()`) pour afficher le même
    message explicite qu'avant (`chart.wordCloudUnavailable`) plutôt qu'une exception non gérée.
  - **Testé sous Node** (`dev-tests/test-data.js`, inchangé par ce 2e lot) : `wordFrequency` dans ses
    deux modes (égalité avec `groupByAggregate` en mode "une entrée par ligne" ; comptage/casse/
    graphie/mots courts ignorés en mode "découpage de cellule"), et `tileExportSheet` pour les deux
    modes — ce lot ne touche que le RENDU (`js/charts.js`), jamais `js/data.js`. Suite complète
    toujours verte après ce changement.
  - **Testé en navigateur réel avec un STUB écrit à la main** (`dev-tests/harness.html`, Playwright,
    servi en HTTP) — jamais le vrai paquet `d3-cloud`, dont l'exécution dans un navigateur a été
    refusée par le classificateur de sécurité de cette session cloud ("Code from External", même
    garde-fou que pour l'extension DuckDB-WASM tierce de l'import PBIX et qu'`echarts-wordcloud`
    dans le 1er lot) : un petit module ES, écrit par cette session, reproduisant l'API documentée de
    `d3-cloud` 2.0.0 (`index.d.ts` du paquet — constructeur `CloudLayout`, `.size()`/`.overflow()`
    chaînables, `.getSprite()`/`.place()` avec un placement déterministe en grille plutôt que le
    vrai algorithme de packing), injecté via une entrée temporaire d'`importmap` sur une copie
    jetable de `harness.html` (jamais committée, supprimée après coup — `git status` revérifié
    propre). Confirmé avec ce stub : le canvas contient bien des pixels non blancs après rendu (le
    texte est dessiné) ; `getInstance(tileId).getDataURL()` renvoie un PNG valide (compatibilité
    avec `js/pdf-export.js`/`js/pptx-export.js`, inchangés) ; un clic sur un mot placé pose
    correctement un filtre croisé (`{column, value, sourceTileId}` dans le store) ; le survol remplit
    `canvas.title` avec "mot (valeur)" et bascule le curseur en `pointer` ; en basculant la MÊME
    tuile en mode "découpage de cellule" (via édition), le même clic ne pose plus aucun filtre et le
    curseur reste `default` — la neutralisation du clic fonctionne pour le `<canvas>` maison comme
    elle fonctionnait pour la série ECharts du 1er lot. Également vérifié (sans stub, juste le
    message de repli puisque la lib reste indisponible) : le champ "Découper chaque cellule…"
    apparaît/disparaît toujours correctement ; une tuile des deux modes se crée sans erreur ; le
    message `chart.wordCloudUnavailable` s'affiche bien ; un redimensionnement de fenêtre
    (`resize()`) et une bascule de type de tuile dans les deux sens (nuage de mots ↔ barres, exerçant
    `dispose()` sur l'ancienne instance avant de créer la nouvelle, canvas ↔ ECharts et
    inversement) ne produisent aucune exception ; **zéro erreur console/exception JS imputable à
    cette feature** sur l'ensemble de ces scénarios. Non-régression vérifiée sur bar/pie/kpi/
    treemap/scatter/radar (création + clic → filtre croisé toujours posé) : l'extraction de
    `handleTileClick` n'a rien changé au comportement de ces types. **Un bug PRÉEXISTANT, sans
    rapport avec ce changement**, a été repéré au passage et confirmé comme tel en le reproduisant
    identique sur le code d'avant ce lot (`git stash`) : un clic sur une tuile camembert déclenche
    parfois `TypeError: Cannot set properties of null (setting 'innerHTML')` dans le code interne
    d'ECharts (`_showTooltipContent`), probablement un artefact du rendu headless Playwright sur la
    tooltip native d'ECharts — hors périmètre de ce lot, non corrigé ici.
    `index.html`/`dev-tests/harness.html` revérifiés IDENTIQUES sur toute la section
    `<form id="add-tile-form">` (inchangée par ce 2e lot, qui ne touche que `js/charts.js`/
    `css/style.css`).
  - **Non vérifié, et volontairement pas tenté dans ce sandbox** : le comportement RÉEL de l'algorithme
    de packing de `d3-cloud` (disposition, densité, cas où des mots ne peuvent pas être placés) —
    seul le CODE de ce dépôt qui l'appelle a été vérifié, via le stub ci-dessus, pas la bibliothèque
    elle-même. La correction de ce point reviendra naturellement une fois que GFS aura ajouté la
    bibliothèque (son propre processus de vérification, `TESTER-AVEC-GFS.md`, couvre justement ce
    cas). Également non vérifié, inchangé depuis le 1er lot : le volume réel au-delà de quelques mots
    (lisibilité/chevauchement à l'échelle d'une vraie colonne Keywords — la détection de collision de
    `d3-cloud` en mode `overflow(false)` laissera simplement tomber les mots qui ne tiennent pas,
    repli silencieux déjà codé dans `placeWordCloud`, mais jamais vu en vrai), et le comportement du
    mode "découpage de cellule" sur une colonne Reference/numérique (cas limite non prévu par le
    formulaire, qui n'exclut pas ces types de colonne pour ce champ). Nouveau point non vérifié
    propre au `<canvas>` maison : l'exactitude pixel près de la détection de clic/survol
    (`hitTestWordCloud` utilise une boîte englobante approximée depuis la ligne de base de la police,
    pas le contour exact du glyphe — approximatif par nature, comme la détection de clic
    d'`echarts-wordcloud` ne l'était pas non plus de façon garantie, mais jamais mesuré contre un
    rendu réel faute de pouvoir exécuter la bibliothèque, voir plus haut).

- **Mots-clés automatiques sur les publications (chantier en cours, démarré 03/11/2026)** — suite
  à la demande d'Antoine du fil "Recherche sémantique sur publications" (21/10 : rester
  zéro-backend ; 02/11 : mots-clés manuels ET automatiques à l'ajout d'un document, pour indexer
  richement) :
  - `js/keywords.js` : extraction de mots-clés façon RAKE (Rose et al., 2010 — degree/freq,
    phrases candidates coupées aux mots vides/ponctuation, PAS à un simple espace). Tokenisation
    via `Intl.Segmenter` natif (vérifié sous Node 22 et dans les navigateurs cibles) plutôt qu'une
    bibliothèque comme `wink-nlp` envisagée au départ : une fois la contrainte GFS posée par
    Antoine le 03/11 ("sûre/documentée/maintenue", voir GFS-ETAT.md), éviter une
    dépendance quand une API native suffit est strictement mieux. **100% JS vanilla, zéro nouvelle
    dépendance pour ce module**, testé sous Node (`dev-tests/test-data.js`) : phrase multi-mots
    mieux classée qu'un mot isolé, ex-aequo départagé par l'ordre de première apparition (jamais
    alphabétique, même prudence que le piège n°14 du CLAUDE.md), découpage défensif des phrases
    candidates trop longues (`maxPhraseWords`, garde-fou contre un texte sans aucun mot vide sur
    une longue plage — ex. tableau mal extrait d'un PDF).
  - `js/pdf-text.js` : extraction du texte d'un PDF (pièce jointe Grist) pour alimenter
    `keywords.js`. Codé CONTRE l'API de PDF.js (`window.pdfjsLib`) sans jamais la charger ni la
    référencer dans `index.html`/l'import map — `isAvailable()` renvoie `false` et
    `extractTextFromPdf` rejette avec un code clair (`PDFJS_NOT_AVAILABLE`) tant que GFS n'a pas
    traité la demande (voir GFS-ETAT.md, section "Demandes à GFS"). Fonctions pures de jointure
    (`joinTextItems`/`joinPages`) testées sous Node ; le reste (chargement réel d'un PDF) a besoin
    d'un vrai PDF.js, donc d'un navigateur — même limite que le moteur SQL de `duckdb-engine.js`.
  - **Mise à jour du 18/11/2026 — branché (consigne GFS 019, fil « Recherche sémantique sur publications »)**.
    Antoine a confirmé : 100 000 publications et plus, des PDF déposés dans une colonne pièce jointe de Grist, aucun
    backlog (« Pas de publication pour le moment »), zéro back-end, mots-clés saisis à la main ET automatiques.
    Ce qui existe : menu Données > « Mots-clés des publications » (mode Édition, `js/keywords-panel.js`).
    - **Le choix du déclenchement** : un geste de la personne, jamais à l'ajout d'une ligne. Le widget n'a pas de
      moyen d'écouter « un document vient d'être déposé » quand il est fermé (pas de back-end, pas de `onRecords`),
      et il n'écrit rien dans la table de la personne sans l'avoir dit : la fenêtre choisit la source (le PDF joint, ou
      une colonne de texte : titre, résumé), la colonne qui reçoit les mots-clés (existante, ou nouvelle
      `Mots_cles_auto` créée APRÈS une fenêtre de confirmation qui dit le nombre de lignes et la colonne), une colonne
      facultative de mots saisis à la main (jamais répétés dans l'automatique), le nombre de mots et la langue. Une
      cellule déjà remplie n'est jamais touchée ; relancer le travail ne fait donc que compléter (les nouvelles lignes).
    - **L'algorithme** (`js/keywords.js:extractKeywords`, zéro dépendance, `Intl.Segmenter`) : RAKE ne suffit pas pour
      un texte long (il classe d'abord les phrases candidates les plus longues, « méthode proposée consiste à… » devient
      un mot-clé). Il reste (`rakeKeywords`, utile à un titre ou un résumé court) mais l'extraction principale
      classe des unités de 1 à 3 mots par **récurrence** : une expression qui revient (`activité physique`,
      `perovskite solar cells`) passe devant une expression rare, un mot seul demande deux occurrences (sauf sur un
      texte très court), les composés à trait d'union restent un seul mot (`mots-clés`), l'élision française
      (`l'apprentissage`) et le possessif anglais (`model's`) sont retirés, une ligne vide coupe une expression, une
      unité contenue dans une unité retenue de fréquence comparable n'est pas répétée. Les ex-aequo suivent l'ordre
      de première apparition (jamais l'ordre alphabétique, piège n°14). Mesuré à la main sur des textes français et
      anglais réalistes (articles de santé publique, d'énergie, de linguistique) : les expressions retenues sont celles
      qu'un lecteur retiendrait ; ce n'est PAS une mesure sur un vrai corpus de chercheurs, et un texte dont les mots
      importants ne reviennent jamais donnera peu de mots-clés (voulu : mieux vaut peu que du bruit).
      **Texte court (18/11/2026, essai sur le jeu d'essai du pas-à-pas)** : un résumé de 40 mots rendait onze mots-clés
      dont une queue de bruit (« jour, hausse, personnes, atteignent »). Le nombre de mots-clés est donc plafonné à un
      pour cinq mots utiles (au moins 3, jamais plus que `maxKeywords`) : un résumé en rend 3 à 4, les termes gardés
      sont ceux de tête (rien ne change dans leur ordre), un texte de 100 mots utiles ou plus n'est pas touché. Le
      1/5 est un réglage d'après quelques textes, pas une mesure sur un corpus.
    - **La lecture du PDF** (`js/pdf-text.js:readPdf`) : pdf.js vient de GFS (extension `mots-cles-pdf`, voir
      GFS-ETAT.md), jamais d'une balise ni d'un CDN de ce dépôt. Page par page, en rendant la main entre deux pages
      (pdf.js tourne dans la page, pas dans un vrai `Worker`, dans le cadre isolé de GFS) : au plus 88 ms de gel mesurés
      sur cinq PDF en page directe (le cadre isolé a été essayé, mais son gel n'a pas été mesuré cette fois). Plafonds : 80 pages et 400 000 signes par PDF, trois
      pièces jointes par ligne, 80 Mo par fichier ; un fichier qui n'est pas un PDF (image) est ignoré, un PDF scanné
      (aucun texte) est compté « sans texte lisible », jamais un mot-clé inventé.
    - **L'écriture** : par lots de 20 lignes (un seul `applyUserActions`, une action `UpdateRecord` par ligne) ; une
      erreur sur une ligne (PDF corrompu, pièce jointe introuvable) est comptée et listée, le travail continue ; un
      refus d'écriture arrête tout ; « Arrêter » écrit ce qui est déjà prêt puis s'arrête.
    - **Essais** : Node (`dev-tests/test-data.js` : plan des lignes, `keywordsForTask`, `runJob`, `readPdf`, pont Grist
      avec un faux `fetch`, qualité de l'extraction, câblage de la fenêtre) ; navigateur avec **le vrai fichier
      `pdfjs.js` de GFS et de vrais PDF** (page directe ET `<iframe sandbox="allow-scripts">`), un faux GFS
      (`hosted`, `library`, `onExtensions`, `install`) qui ajoute puis retire l'extension pendant que la fenêtre est
      ouverte (l'option PDF se dégrise, puis se regrise, sans rouvrir) ; l'app seule (grisée, « Comment l'avoir »,
      colonne de texte qui marche) ; GFS sans `jeton` (refus clair AVANT toute écriture, aucune colonne créée) ; anglais.
    - **Mesuré par GFS dans un vrai Grist 1.7.19 avec cette app** (consigne GFS 022, 18/11/2026, `labo/run-bi-jeton.mjs`, 14 vérifications sur 14) :
      (1) la réponse de `getAccessToken({ readOnly: true })` est `{ token, baseUrl, ttlMsecs }` ; (2) `GET <baseUrl>/attachments/<id>/download?auth=<jeton>`
      rend les octets du PDF joint octet pour octet depuis le cadre isolé (origine « null »), sans autre réglage ; un numéro absent lève `ATTACHMENT_HTTP` 404 ;
      (3) `AddColumn` rend le vrai identifiant (`MotsCles2` quand `MotsCles` est pris), `writeColumnValues` n'écrit que dans cette colonne ; (6) **dans GFS**,
      `jeton` est déclarée en lecture seule et `ecrit: ["*"]` couvrait déjà la table que la personne choisit (`ModifyColumn` reste refusé : sans effet ici) — les deux demandes
      de GFS-ETAT.md sont sorties.
    - **Non vérifié** (le faux `window.grist` de `dev-tests/` ne le prouve pas, et GFS n'a pas joué mon écran) : la fenêtre « Mots-clés des publications » elle-même dans le vrai GFS
      (clics, confirmation, bilan) et l'extension `mots-cles-pdf` grisée puis dégrisée à l'écran ; (4) le comportement sur de VRAIS PDF de chercheurs
      (colonnes multiples, en-têtes et pieds de page répétés qui peuvent gonfler un mot récurrent, formules, PDF
      protégés) ; (5) le temps pour 100 000 lignes (lecture séquentielle, un PDF après l'autre : à mesurer, la fenêtre
      permet d'arrêter et de reprendre, les lignes faites ne sont pas refaites).
    - **Limites connues** : une ligne dont le PDF est un scan (ou ne se lit pas) est réessayée à chaque lancement (pas de
      mémoire « déjà essayé » : ajouterait une colonne ou un état à tenir, à décider avec Antoine si les scans
      sont nombreux) ; le français et l'anglais seulement (la langue se devine, ou se choisit) ; aucune recherche n'est
      encore faite SUR ces mots-clés (la colonne est filtrable comme toute colonne ; un champ de recherche plein texte
      sur l'index est la suite logique, avec DuckDB-WASM déjà vendorisé).

- **Ambiance de GFS (04/11/2026, consigne GFS 004)** — GFS (Grist Factory Suite, l'hébergeur commun
  en préparation pour plusieurs apps Grist d'Antoine, voir `lombre33/grist-widget-GFS`) propose cinq
  ambiances (Grist Factory, Pop, Papier, Brut, Néon) et la couleur libre de la personne, un seul
  choix pour GFS et pour toutes ses apps. Ce widget référence désormais le **kit commun des apps
  Grist Factory** (`lombre33/grist-factory-kit`, dépôt public, GPL 3.0) en **sous-module Git**
  (`kit/`, pointant sur `db14544`, Kit 0.7.0, ≥ `8afa569` demandé par la consigne) et appelle
  `Ambiance.start()` (`kit/js/ambiance.js`) au tout début de `js/main.js` (avant tout rendu), via un
  `import()` dynamique résolu contre `document.currentScript.src` — même mécanisme déjà utilisé
  pour charger un module ES depuis un script classique que `js/duckdb-engine.js`
  (`VENDOR_BASE_URL`) et `js/charts.js:loadD3Cloud` (spécificateur nu résolu par l'import map),
  jamais un `<script type="module">` séparé dans `index.html`. Grist-BI n'a pas son propre lien
  avec GFS (contrairement à Publipostage+) : `Ambiance.start()` démarre donc le lien du kit
  lui-même (`kit/js/gfs-link.js`), qui ne fait RIEN hors de GFS (`kit/js/host.js:hostContract` :
  pas de `gfs=<n>` dans l'adresse) — aucun risque pour ce widget utilisé seul, comme aujourd'hui.
  - `css/style.css` renomme ses jetons de couleur/forme existants vers ceux de la charte GFS (voir
    le commentaire d'en-tête du fichier et `kit/js/ambiance-message.js:COLOR_TOKENS`/
    `SHAPE_TOKENS`) : `--bg`, `--surface`, `--surface-sunken`, `--border`, `--border-strong`,
    `--text`, `--text-muted`, `--accent`, `--on-accent`, `--accent-solid`/`--accent-solid-hover`/
    `--accent-ink`/`--accent-soft`/`--accent-soft-border` (ces cinq derniers posés par une
    ambiance avec leur propre valeur — voir le JSON d'exemple du kit, qui leur donne des couleurs
    distinctes de `--accent`, pas nécessairement égales ; les valeurs par défaut de ce widget,
    elles, les dérivent de `--accent` par `color-mix()` puisqu'il n'a qu'une seule teinte
    d'accent), `--radius-sm`/`-md`/`-pill` (déjà nommés à l'identique avant ce lot), `--bw`
    (largeur de trait, nouveau, câblé sur les conteneurs structurants : `.tile`, le formulaire
    d'ajout de tuile, la barre de filtres avancés, `.combobox-list`, les boutons, les champs,
    le sélecteur de vues sauvegardées), `--shadow-ctl`/`-panel`/`-float` (renommage par rôle de
    `--shadow-xs`/`-sm`/`-md`), `--font-ui` (toute l'interface) et `--font-head`/`--font-label`
    (+ `--fw-head`/`--fs-head`/`--ls-head`/`--tt-head`/`--ls-label`, avec repli explicite
    `var(--token, valeur d'origine)` : titre du bandeau, titres de fenêtre, libellés en
    majuscules), `--fill`/`--fill-hover` (bouton plein, `--accent-solid`[-hover] par défaut, un
    dégradé chez Pop), `--wash`/`--wash-size` (décor de fond, posé en `background-image` sur
    `body`, `none` par défaut). **Hors ambiance, volontairement** (règle 15 du guide des apps
    GFS) : les graphiques (palette du tableau de bord), les couleurs d'état (`--good`,
    `--critical`, `--warning-*`, `.warning-banner`) et `--text-secondary` (une 3e nuance de gris
    propre à ce widget, sans équivalent dans les jetons de la charte).
  - **Testé** : script Playwright ponctuel (non committé, voir CLAUDE.md §5) contre un
    `http-server` local — `index.html` et `dev-tests/harness.html` chargent sans avertissement
    `ambiance`/`kit` ; en clair et en sombre, hors ambiance, les couleurs restent celles par
    défaut de ce widget ; en appliquant directement le message d'exemple réel du kit
    (`kit/test/ambiance-exemple.json`, l'ambiance "Pop") via `kit/js/ambiance-message.js`
    (`normalizeAmbiance`) et `kit/js/ambiance-pose.js` (`paintAmbiance`) sur `document.
    documentElement` d'`index.html`, le fond de page, le fond d'une carte (`.add-tile-form`) et le
    fond d'un bouton plein (`#submit-tile`, qui devient le dégradé `--fill` de Pop) changent tous
    les trois, puis reviennent EXACTEMENT à leurs valeurs d'avant en reposant `null` — le scénario
    même que la consigne GFS 004 demande de vérifier.
  - **Non testé/non vérifiable depuis ce sandbox** : un vrai message d'ambiance envoyé par un vrai
    GFS (seul le message d'exemple statique du kit a été rejoué, jamais le protocole
    `postMessage`/`contexte` réel d'un hébergeur GFS, qui n'existe pas encore en production) ; que
    GitHub Pages serve bien les fichiers du sous-module `kit/` sur le site publié de ce widget
    (documentation GitHub elle-même dit que oui pour un sous-module public en `https://`, vérifiée
    par GFS le 14/10/2026, et déjà le cas en production pour Form+/Automation+/Publipostage+ qui
    font de même — mais jamais revérifié spécifiquement pour Grist-BI depuis ce sandbox, qui ne
    peut pas joindre `*.github.io`) ; le rendu réel des cinq ambiances (seule "Pop" a été essayée,
    faute d'un second fichier d'exemple dans le kit) ; la transition CSS de 0,12 s sur les boutons
    pendant un changement d'ambiance en direct (mesurée seulement après coup, jamais en mouvement).
- **Vitrine de GFS (consigne 014, 17/11/2026)** : `vitrine/` (`vitrine.json` + `1.webp`/`2.webp`/
  `3.webp`, 960 × 600, de 42 à 56 Ko) alimente la carte et la fiche de cette app dans la fenêtre
  « Apps et extensions » de GFS. Aucun code n'a changé : un dossier de fichiers que seul GFS lit
  (jamais `index.html`).
  - **Les captures n'ont PAS été prises dans un vrai Grist** (la consigne le demandait) : le build de
    `grist-core` (`git clone` + `yarn install`), qui avait passé les 19/09, 29/09 et 16/11, a été refusé
    ce jour-là par le classifieur de l'environnement de la session, et n'a pas été contourné. Elles
    montrent le VRAI `index.html` servi en HTTP local, dont le script
    `https://docs.getgrist.com/grist-plugin-api.js` est remplacé (interception de requête Playwright)
    par `dev-tests/grist-stub.js`, le faux `window.grist` du dépôt, prérempli via
    `window.__gristStubPreseed` (5 760 lignes, `BI_Dashboard_Config` avec 3 pages, commentaires, et
    `_grist_Tables_column` qui déclare `Date` comme colonne `Date`, pour que le drill-down temporel
    marche). Le widget seul (fenêtre de 960 × 600, ni barre du navigateur ni cadre de Grist), en clair,
    rendu à ×2 puis réduit en Lanczos à 960 × 600 et encodé en WebP. L'interface est celle que verrait
    un vrai Grist (même document, même CSS) ; ce que ce montage ne prouve toujours pas, c'est le
    comportement de `grist.docApi` (voir « Points à valider en conditions réelles »). Si GFS exige
    de vraies captures, il suffit de refaire les trois fichiers sous les mêmes noms.
  - **Jeu de données** : dérivé de la démo vendeur v2 (`Demo-vendeur-Grist-BI-v2.grist`, dossier
    partagé du projet) avec ces retouches, propres à la vitrine : les 6 noms de commerciaux deviennent
    6 segments clients (« Grands comptes », « PME »…), les auteurs de commentaires deviennent des
    équipes (aucun nom de personne dans les images), les quantités sont pondérées par produit (sinon le
    nuage de points est une colonne verticale), la jauge passe en dernière tuile (sa taille de 270 px la
    rend peu lisible) et les titres de tuile sont raccourcis pour ne pas finir en « … ».
    Scènes (reprises le 18/11/2026, voir plus bas) : (1) page « Vue d'ensemble » au repos, avec les
    types ajoutés par la PR #53 (courbe en aire, anneau avec %, barres horizontales triées) ; (2) page
    « Segments & canaux » : clic sur une part du camembert (filtre croisé, les autres parts
    s'estompent) puis sur « Nord » dans le treemap (drill-down, fil d'Ariane) ; (3) page « Analyse
    avancée » (cascade, N-1, YTD, cumul). Les scripts de prise de vue ne sont pas committés (même
    règle que toute la suite Playwright de ce dépôt, voir CLAUDE.md §5) : ils sont dans le dossier
    partagé du projet, `demos/vitrine-gfs/`.
  - **Reprise du 18/11/2026 (Antoine : « les deux premières images se ressemblent »)** : les trois
    captures sont refaites, sous les mêmes noms, depuis `main` à `5a64945` (PR #53 comprise). Avant,
    les scènes 1 et 2 montraient la même page de barres et de camemberts, filtrée ou non. Maintenant
    chaque scène a sa page et ses types de tuile : 1 = indicateurs avec tendance, courbe en aire,
    anneau, barres horizontales ; 2 = camembert, treemap, tableau croisé, nuage de points, filtre
    croisé et drill-down en cours ; 3 = cascade et mesures dans le temps. Retouches de données en plus
    des précédentes : une saisonnalité par mois (creux d'été, pic de fin d'année, sinon la courbe par
    mois est plate), 3 pages réécrites à la main plutôt que réordonnées (`prep2.py`). Légendes 1 et 3
    changées dans `vitrine.json` (la 2 reste vraie), description inchangée.
  - **Constats vus en passant, non corrigés (hors périmètre de la consigne)** : la jauge à 270 px de
    large a ses graduations et son aiguille qui se chevauchent ; le radar coupe l'étiquette du haut et
    celle du bas ; le titre de la tuile KPI déborde de quelques pixels à gauche quand la grille passe à
    4 colonnes (fenêtre de 1 200 px) ; ECharts lève `Cannot read properties of null (reading
    'offsetWidth')` dans l'info-bulle (`_updatePosition`), et `Cannot set properties of null (setting
    'innerHTML')` (`setContent`, vue le 18/11 au clic sur le treemap), quand un drill-down redessine un
    graphique sous le pointeur (même cause, bénin en apparence, pas investigué).

- **Courbe / aire, anneau, barres horizontales, tri (18/11/2026)** : issus de la comparaison avec
  l'« Assistant Data Visualisation » de la DRANE d'Orléans-Tours (`gristgouv/drane-orleans-tours-grist-widgets`,
  fichier `d3js-assistant.html`, étude `etudes/comparaison-assistant-dataviz-drane-2026-11-18.md` dans le
  dossier partagé du projet) et de la Phase A de l'étude du 03/11. Aucune nouvelle bibliothèque : séries
  ECharts `line`/`pie`/`bar` déjà vendorisées, donc aucune demande à GFS.
  - **Code** : `tile.type === 'line'` (nouveau, même formulaire que `bar`), `tile.areaFill` (aire),
    `tile.donut`/`tile.showPct` (camembert), `tile.horizontal` (barres), `tile.sortMode`
    (`'value-desc'`/`'value-asc'`/`'label'`, absent = ordre des données). Les cinq champs sont mis à
    `undefined` quand ils ne s'appliquent pas (même règle que les autres champs propres à un type, voir
    `js/main.js`, submit), donc changer le type d'une tuile éditée les efface.
  - **Tri = étape séparée** (`GristBI.data.sortGroups`, `isSortableTile`) : `groupByAggregate` garde son
    contrat d'ordre d'apparition (CLAUDE.md §7, piège n°14). Triables : barres (hors mode mesure
    temporelle), courbe/aire, camembert. Jamais cascade (l'ordre EST le sens du cumul), treemap, radar,
    nuage de mots. Valeurs absentes (`null`/`NaN`, ex. `min` d'un groupe vide) toujours en dernier.
    Tri « Libellé » = tri naturel (`Intl` `numeric`) : « T2 » avant « T10 », années numériques dans l'ordre.
    L'export Excel (`tileExportSheet`) applique le même tri : le fichier suit l'ordre affiché.
  - **Décisions de rendu** : barres horizontales avec axe des catégories INVERSÉ (la 1re catégorie, ou la
    plus grande avec « Valeur décroissante », est en haut) et libellés tronqués à 110 px avec le nom complet
    en info-bulle ; anneau = rayon `['40%','65%']` ; pourcentages sur DEUX lignes (« nom » puis « 12,5 % »,
    format français comme `formatNumber`) — une version à une ligne « nom : 12.5 % » a été essayée d'abord et
    tronquait justement le pourcentage dans une tuile de 270 px (vu sur capture, pas par un test de code).
  - **Vérifié** : `node dev-tests/test-data.js` (tri, valeurs absentes, types triables, export Excel dans
    l'ordre trié, `donutChart` Power BI) et, contre le VRAI `index.html` servi en HTTP local avec
    `dev-tests/grist-stub.js` (même montage que la vitrine, jamais un vrai Grist), 42 contrôles : visibilité
    des options pour chacun des 11 types (y compris barres en mode mesure : masquées), 6 tuiles ajoutées par
    le formulaire sans option fantôme, options ECharts réellement construites, clics SOURIS réels sur un point
    de courbe et sur une barre horizontale (filtre croisé sur la bonne valeur, re-clic le retire), édition qui
    pré-remplit puis efface une option décochée, barres → treemap qui efface `horizontal`/`sortMode`, textes
    en anglais, hauteur de tuile stable sur 10 échantillons avec redimensionnement, aucun canvas qui déborde.
  - **Piège de test noté** : dès qu'un filtre croisé est posé, la barre de badges de filtres décale TOUTE la
    mise en page vers le bas — un clic de souris à des coordonnées calculées avant le filtre rate sa cible
    (le re-clic « ne retirait pas le filtre » : c'était le test, pas l'application). Toujours recalculer les
    coordonnées avant chaque clic.
  - **Constat inchangé, déjà noté plus haut (vitrine)** : ECharts lève `Cannot read properties of null
    (reading 'offsetWidth')` dans l'info-bulle à chaque clic sur un graphique qui se redessine sous le
    pointeur. Reproduit à l'identique sur `origin/main` (worktree séparé) avec une simple tuile barres : pas
    introduit par cette fonctionnalité, ni investigué ici.
  - **Hors périmètre, volontairement** : courbe/aire en mode mesure (Cumul/YTD/N-1, toujours réservé à
    `bar`) ; plusieurs séries (courbes multiples, barres empilées/groupées) ; import Power BI de
    `lineChart`/`areaChart` (jamais essayé sur un vrai fichier, et leur rôle « légende/série » pourrait être
    pris pour la catégorie par `dimensionFields[0]`) ; tri sur la cascade. Une courbe SANS tri garde l'ordre
    des données : sur une table non chronologique, la courbe saute d'une année à l'autre — le tri
    « Libellé » règle le cas, mais rien ne le propose encore automatiquement (piste pour le futur assistant
    de choix de graphique).

- **Conseil de visualisation et suggestions de tuiles — module `js/advice.js` (18/11/2026, PR 2a de
  l'onboarding)** : suite de la comparaison avec l'assistant de la DRANE (recommandation R4 de
  `etudes/comparaison-assistant-dataviz-drane-2026-11-18.md`) et demande d'Antoine « un chantier sur
  l'onboarding et le conseil à la data viz ». Cette PR ne livre QUE le module de décision, pur et sans
  interface ; l'écran d'accueil et l'étape « Choisir » (PR 2b) viennent ensuite, après la refonte de la
  barre d'outils du fil UI/UX (pas de conflit sur `index.html`/`js/main.js`).
  - **Contrat** (convenu avec le fil UI/UX) : AUCUN texte en dur — chaque suggestion ou conseil renvoie des
    clés i18n et leurs variables. `suggestTiles(rows, columns, {limit = 3, t})` → liste classée de
    `{ type, dimension, measure, aggFn, tileData, score, titleKey, titleVars, reasonKey, reasonVars }`
    (`tileData` est prêt pour `store.addTile` avec un `id`). `defaultsForType(type, rows, columns)` → champs
    du formulaire à préremplir (ou `null`). `adviceForTile(tile, rows)` → `{ key, vars, level }` ou `null`
    (`level` = `'warn'` : graphique trompeur ou illisible ; `'tip'` : se lit mieux autrement).
    `adviceForType(type, rows, columns)` → toujours un objet : l'avertissement du type avec ses valeurs par
    défaut, sinon pourquoi les données ne s'y prêtent pas (`advice.fit.*`), sinon la ligne « quand
    l'utiliser » (`advice.use.*`, `level: 'info'`). Seule exception au « zéro texte » : `tileData.title`,
    chaîne persistée dans la configuration, résolue via `opts.t` (repli neutre fait de noms de colonnes sans
    `t`).
  - **Heuristiques** — rôle de chaque colonne déduit des VALEURS (vote sur 200 cellules, jamais la seule
    première valeur), le nom n'étant qu'un indice supplémentaire : date, `<date>.Annee/.Trimestre/.Mois`
    (colonnes dérivées de `withDateHierarchies`), catégorie (2 à 30 valeurs), mesure, identifiant (entiers
    consécutifs uniques, ou texte quasi unique au-delà de 30 valeurs), texte libre, constante. Une colonne
    d'entiers entre 1800 et 2200 est une ANNÉE (axe, jamais une mesure à additionner) ; un petit entier
    répété (note de 1 à 5) ou un numéro dense (jour du mois) reste utilisable comme axe mais n'est jamais la
    mesure vedette. Suggestions variées : à score proche, un type, une dimension ou une mesure déjà retenus
    pèsent contre le candidat suivant (3 « barres par région » n'apprennent rien de plus qu'une). Sans
    colonne numérique : comptage de lignes. Colonnes dont le nom évoque une note, un taux ou un âge : agrégat
    « Moyenne » plutôt que « Somme » (indice de nom fr/en, la personne garde la main).
  - **Seuils de lisibilité** : camembert > 7 parts ou valeur négative ; radar > 8 axes ; barres verticales
    > 12 catégories, ou libellés de plus de 14 caractères avec au moins 4 catégories ; courbe sur un axe
    sans ordre naturel, avec moins de 3 points, ou triée par valeur ; jauge dont la valeur actuelle sort de
    l'échelle ; colonne vide à plus de 50 %. Évalués sur TOUTES les lignes, sans tenir compte des filtres
    croisés (un conseil qui apparaîtrait à chaque clic sur une autre tuile ne serait pas un conseil sur le
    graphique).
  - **Piège évité** : des noms de mois (« Avril » < « Janvier ») ne se rangent PAS par tri de libellé. Le
    conseil « triez par libellé » (et le `sortMode: 'label'` posé d'office sur une courbe suggérée) ne
    s'applique donc qu'à des nombres, années, dates ISO et trimestres (`sortableByLabel`) ; des mois en
    texte gardent l'ordre des données et ne déclenchent jamais « cette courbe n'a pas d'ordre naturel ».
  - **Vérifié** : `node dev-tests/test-data.js` (rôles de colonnes, 3 types différents sur le banc de
    47 040 lignes, anneau écarté avec une valeur négative, comptage sans colonne numérique, radar « notes
    en colonnes » sans jamais mêler un chiffre d'affaires, dates en désordre → courbe triée, chaque
    suggestion s'ajoute au store et s'agrège sur les vraies données, un test par avertissement ET par
    absence d'avertissement, aucun conseil sur les tuiles de démonstration, entrées gelées jamais mutées,
    49 clés `advice.*` toutes définies, toutes utilisées, mêmes variables en fr et en anglais, aucune
    `{variable}` orpheline une fois traduites) et, contre le VRAI `index.html` servi en HTTP local avec
    `dev-tests/grist-stub.js` : `GristBI.advice` chargé, 3 suggestions cohérentes (courbe `Date.Annee` avec
    drill-down Trimestre/Mois/jour, KPI avec tendance). Durée : ~25 ms de profilage pour 47 040 lignes
    (limité aux 20 000 premières lignes par colonne).

- **Écran d'accueil à suggestions — `js/welcome.js` (18/11/2026, PR 2b de l'onboarding)** : branche
  `js/advice.js` sur `#welcome`, l'écran d'un tableau de bord sans tuile. Périmètre convenu avec le fil
  UI/UX (qui refond la barre d'outils et le formulaire) : CETTE PR ne livre que les cartes d'accueil ; le
  fil UI/UX branche lui-même `adviceForType` (étape « Choisir »), `defaultsForType` (préremplissage),
  `adviceForTile` (`#tile-advice`) et le bouton « Créer une visualisation » (`#welcome-add`) dans son
  lot 2, parce que c'est son formulaire. D'où : le bouton « Créer une visualisation » prévu au départ a
  été RETIRÉ de cette PR (deux boutons pour la même action n'auraient pas survécu à la fusion).
  - **Cartes** : jusqu'à 3 (`suggestTiles`), chacune avec une miniature SVG de 120 × 64, un titre, la raison
    (clé `advice.reason.*`) et « Ajouter ». « Ajouter » pose exactement `tileData` (titre résolu dans la
    langue courante, enregistré tel quel dans la configuration comme n'importe quel titre saisi) avec un
    identifiant de tuile neuf. « Ajouter ces N visualisations » pose toutes les cartes affichées en un coup.
    Les tuiles posées sont des tuiles ordinaires : modifiables, supprimables, exportables.
  - **Miniature sans ECharts** : `advice.previewFor(tileData, rows)` agrège sur les VRAIES lignes (mêmes
    `groupByAggregate`/`sortGroups`/`computeTrend` que la tuile) et renvoie des nombres normalisés ;
    `welcome.previewSvg` les dessine en quelques traits (barres, courbe/aire, anneau/camembert, treemap,
    nombre avec tendance, nuage de points, radar, jauge, grille). Une vraie instance ECharts par carte
    aurait coûté un graphique complet (plus ses gestionnaires de clic branchés sur le store) pour une
    vignette. `previewFor` renvoie `null` plutôt que de dessiner faux : barres toutes nulles, courbe à moins
    de 2 points, radar à moins de 3 axes, jauge sans étendue, type inconnu.
  - **Quand l'accueil s'affiche** : mode Édition ET table connectée avec sa configuration chargée
    (`dashboardReady`, même règle que la pastille — piège n°19-b) ET aucune tuile sur la page. Supprimer
    la dernière tuile le fait revenir ; en Lecture il disparaît et l'indication de lecture reste. Table
    sans ligne : message explicite (`welcome.emptyTable`) à la place des cartes — jamais de suggestion
    inventée sur du vide ; « Importer un fichier Power BI… » reste proposé.
  - **Coût** : les suggestions ne sont recalculées que si la référence de `state.rows` ou la langue change
    (`render()` est appelé à chaque clic de filtre ailleurs ; relancer le profilage d'une grosse table
    à chaque fois se verrait). Vérifié : les éléments de carte sont conservés tant que ni la table ni la
    langue ne changent.
  - **Piège évité (test)** : le Playwright de cette PR a d'abord échoué sur « accueil invisible » alors que
    le code était juste — le mode (Lecture/Édition) est posé par `autoMode()` UNE FOIS la configuration
    chargée, donc un test qui bascule trop tôt inverse le mode. Attendre que l'accueil soit visible avant
    d'agir, ne cliquer sur « Édition » que si le mode est encore « Lecture ». Idem : une fenêtre en
    `position: fixed` a `offsetParent === null` même quand elle est visible — tester `hidden` et
    `getComputedStyle().display`, pas `offsetParent`.
  - **Vérifié** : `node dev-tests/test-data.js` (une miniature finie et sans `NaN` pour chaque type suggéré
    sur le banc de 47 040 lignes ; barres horizontales triées et normalisées ; parts de camembert de somme 1 ;
    jauge bornée à 1 ; `null` pour tableau vide, type inconnu, jauge sans étendue, radar à 2 axes, barres
    nulles ; flèche ▲/▼ selon le signe, nombre « 3,7 k » en français / « 3.7K » en anglais) ; contre le VRAI
    `index.html` servi en HTTP local avec `dev-tests/grist-stub.js` : 15 contrôles — accueil visible en
    Édition, 3 cartes (Montant par Region, Montant par Date.Annee, Total Montant), « Ajouter » pose
    la bonne tuile, accueil masqué puis de retour après suppression, « Ajouter ces 3 » = 3 tuiles de types
    distincts qui se rendent toutes, aucune erreur JS, masqué en Lecture, textes anglais, bascule de langue
    à chaud, « Importer Power BI » ouvre la fenêtre, table vide, éléments conservés. Captures regardées
    (français, anglais, table vide, tuiles posées).
  - **Reste non vérifié** : un VRAI document Grist (colonnes `Date` en secondes, `Reference`, très grandes
    tables — le profilage porte sur les 20 000 premières lignes) ; mobile ; lecteurs d'écran (les miniatures
    sont `aria-hidden`, le titre et la raison portent le sens, le bouton « Ajouter » nomme la visualisation
    via `aria-label`).
  - **Non vérifié / limites** : jamais essayé sur un VRAI document Grist (vraies colonnes `Date` renvoyées
    en secondes — la conversion en `AAAA-MM-JJ` précède ce module, voir CLAUDE.md §7 piège n°16 — vraies
    colonnes `Reference`, tables de milliers de colonnes) ; les seuils (7 parts, 8 axes, 14 caractères) sont
    des conventions de la littérature de visualisation, pas mesurées sur les utilisateurs de ce widget ; les
    indices de nom (note/taux/âge, id) ne connaissent que le français et l'anglais ; une colonne numérique
    qui est en réalité un code (code postal sans zéro initial) sera prise pour une mesure.

- **Premier lancement : fenêtres du kit, état de connexion, titres traduits, contrastes** (18/11/2026,
  lot 0 de l'audit UI/UX en vue de l'alpha — `js/dialogs.js`, `js/main.js`, `js/i18n.js`,
  `css/style.css`) : constats de l'audit, vérifiés contre le vrai `index.html` servi en HTTP avec
  `dev-tests/grist-stub.js`, dans une page directe ET dans un `<iframe sandbox="allow-scripts">` (le
  cadre de GFS, sans `allow-modals`).
  - **`prompt`/`confirm`/`alert` ne font rien dans un cadre sans `allow-modals`** : « + Page »,
    renommer/supprimer une page, « Sauvegarder la vue actuelle » ne faisaient RIEN (le `prompt()`
    rend `null`, rien n'est créé), et les 20 messages de validation/d'erreur étaient silencieux.
    Remplacés par `GristBI.dialogs.prompt/confirm/notice` (`js/dialogs.js`), qui charge
    `kit/js/dialogs.js` par `import()` dynamique (même mécanisme qu'`Ambiance.start()`) et lie
    `kit/css/windows.css`. Les libellés des boutons sont TOUJOURS passés (dictionnaire de ce
    widget) : le kit n'a pas de dictionnaire ici et n'en a pas besoin. `kit/css/tokens.css` n'est
    PAS chargé (il redéfinirait les couleurs du widget) : les 5 jetons que lit `windows.css`
    (`--pp-scrim`, `--z-window`, `--z-dialog`, `--danger-ink`, `--danger-soft`) sont définis dans
    `css/style.css`, clair et sombre. Repli sur les boîtes du navigateur si le kit ne se charge pas
    (clone sans `git submodule update --init`).
  - **« Aucune table dans ce document » pendant tout le chargement** : le texte s'affichait avant que
    la liste des tables ait été lue. Un état de connexion explicite (`connecting`/`noTables`/
    `failed`, `main.js:connectionState`) le remplace ; l'état vide MASQUE son conseil au lieu de
    l'écraser (l'ancien `textContent` détruisait son `<span>` pour de bon : le conseil ne revenait
    plus après une première table). Un échec propose « Réessayer » (`connectToFirstTable`).
  - **Titres de tuile traduits** : un titre auto-composé (« Montant par Région ») restait dans la langue
    de sa création. Il est stocké avec `titleKey`/`titleVars` (`main.js:autoTileTitle`) et résolu à
    l'affichage par `i18n.tileTitle` ; `tile.title` reste écrit en clair (repli, ancienne config,
    import Power BI, `js/advice.js` qui pose la même paire de champs). **Limite** : les exports
    (Excel, PDF, PPTX) lisent toujours `tile.title`, donc la langue de création — `js/data.js` reste
    pur, sans dépendance à `i18n.js`.
  - **Contrastes AA** : texte discret `#898781` (3,5:1) → `#6b6a64` clair (5,3:1) / `#9b9992` sombre ;
    accent en texte (`--accent-ink`) et en aplat (`--accent-solid`) dérivés de `--accent` par
    `color-mix` avec `--text` (donc toujours cohérents avec une ambiance GFS) ; texte de succès
    `--good-ink` (la tendance KPI en hausse faisait 3,3:1). Mesures par calcul de luminance WCAG,
    jamais à l'œil.
  - **Champs hors `.field`** : sélecteur de table et jointure n'avaient aucune bordure (`.combobox-input`
    n'était stylé que sous `.field`) ; règle générique ajoutée.
  - **Non vérifié** : dans un VRAI GFS (cadre réel, vrai chargement de `kit/` depuis GitHub Pages) et un
    vrai Grist — le cadre isolé ci-dessus est une simulation (`sandbox="allow-scripts"`), pas leur
    hébergeur ; le rendu des fenêtres a été vu en clair et en sombre mais jamais sous une ambiance
    GFS choisie.

- **Barre unique, menus, pastilles de filtre, modes Lecture/Édition** (18/11/2026, lot 1 de l'audit
  UI/UX en vue de l'alpha — `index.html`, `js/appbar.js`, `js/main.js`, `css/style.css`) : l'audit
  mesurait 24 contrôles permanents sur 7 bandes de même poids, et une 1re tuile à y = 431 / 521 /
  583 / 921 px pour 1220 / 900 / 600 / 420 px de large. Mesures de la nouvelle disposition (vrai
  `index.html`, tableau de démonstration à 9 tuiles) : barre de 48 px sur une ligne, **1re tuile à
  y ≤ 80 en Lecture (95 avec des filtres actifs)** à 1000 × 600 ; à 700 et 420 px la barre tient en
  73–75 px (2 lignes : outils, puis onglets), jamais de défilement horizontal de la page.
  - **Structure** : une barre — pastille « Données » (table + nombre de lignes, ouvre le sélecteur
    de table, la jointure et l'import Power BI), onglets de page, boutons Filtre / Vues / Exporter
    (menus), « Modifier / Terminer », thème, pastille Alpha, logo Grist Factory (conservé, décision
    d'Antoine du 29/09). Le badge « POC » devient « Alpha » (« Harnais local » dans le harnais).
  - **Lecture / Édition** (`body[data-mode]`, `.edit-only`/`.read-only`) : Lecture par défaut ; à
    chaque changement de table, Lecture si une page a des tuiles, Édition sinon. **Non persisté** :
    revenir dans le widget rouvre en Lecture, c'est voulu pour une alpha (l'écran d'un lecteur de
    tableau de bord n'est pas celui d'un auteur) ; à reconsidérer si Antoine préfère mémoriser.
  - **Menus** (`js/appbar.js`) : un panneau ouvert à la fois, Échap (focus rendu au bouton), clic
    ailleurs ou sortie du focus (Tab) les ferment, placés en `position: fixed` et rabattus dans le
    cadre (le panneau Grist peut ne faire que 700 × 400). Fonctions pures (`placePopover`,
    `tabKeyTarget`, `menuKeyTarget`) testées sous Node.
  - **Pastilles de filtre** : les filtres croisés (clic dans un graphique) et avancés
    (Filtre → menu) sont visibles en permanence sous la barre, un clic sur la pastille retire ce
    filtre ; avant, ils n'étaient lisibles que dans la barre de filtres avancés ou en cliquant
    sur un graphique.
  - **Harnais** : `dev-tests/harness.html` n'est plus une copie faite à la main mais REGÉNÉRÉ par
    `node dev-tests/sync-harness.js` ; `test-data.js` échoue s'il diverge d'`index.html` (bug réel
    n°27 de `TEST_PROTOCOL.md`).
  - **Largeurs réduites, par paliers** (les onglets de page sont la navigation, ils gardent au moins
    150 px ; c'est le reste qui s'allège) : ≤ 1100 px la pastille Alpha et le compteur de lignes
    disparaissent ; ≤ 900 px les libellés des boutons aussi (leur nom reste dans `aria-label`/`title`) ;
    ≤ 760 px les onglets passent sur une 2e ligne défilable ; ≤ 560 px le libellé « Terminer »
    disparaît (le nom accessible reste). Corrigé après la 1re version : à 800 px les onglets de page
    avaient une largeur de 0 (ils cédaient seuls de la place) et le nom de la table était rogné à
    « V. » à 1000 px — mesuré sur captures, pas à l'œil. La pastille « Alpha » n'est donc visible qu'au-delà
    de 1100 px ; le panneau de Grist fait souvent moins.
  - **Limites** : (1) les captures de la vitrine GFS (`vitrine/*.webp`) montrent l'ANCIENNE interface
    et sont à refaire avant de les republier ; (2) le panneau latéral « Ajouter une visualisation »
    (lot 2) n'est pas encore là : le formulaire d'ajout est celui d'avant, simplement masqué en
    Lecture ; (3) rien n'a été vu sous une ambiance GFS choisie sur la nouvelle barre, ni dans un
    vrai Grist ; (4) clavier réel et lecteur d'écran non essayés (rôles ARIA et ordre de tabulation
    vérifiés par script seulement).

- **Panneau latéral « Ajouter une visualisation » (Choisir → Régler), conseil branché, formulaires réparés dans
  GFS** (18/11/2026, lot 2 de l'audit UI/UX en vue de l'alpha — `index.html`, `js/main.js`, `js/i18n.js`,
  `css/style.css`) : l'audit reprochait au formulaire d'ajout de s'ouvrir au-dessus des tuiles (une bande de
  ~15 champs qui repousse le tableau de bord), de montrer tous les champs de tous les types, de valider par
  fenêtres de message et de ne donner aucune idée du résultat avant d'ajouter.
  - **Disposition** : `#tile-panel` est dans le flux (jamais `position: fixed`, pour ne rien recouvrir dans un panneau
    Grist étroit) : à droite des tuiles à partir de 900 px (grille `minmax(0,1fr) 400px`, panneau collant sous la
    barre, dont la hauteur est lue dans `--chrome-h`), au-dessus des tuiles en dessous. Bouton « Ajouter » dans la
    barre, Édition seulement ; « Modifier » sur une tuile ouvre directement l'étape « Régler ».
  - **Choisir** : 11 cartes de type à l'époque, 12 avec l'entonnoir (icône, nom, ligne de conseil `advice.adviceForType` calculée sur les VRAIES
    données : « idéal jusqu'à une douzaine de barres », etc.). **Régler** : seuls les champs essentiels du type
    sont affichés, préremplis par `advice.defaultsForType` (dimension et mesure différentes, jauge min/max…) ; le
    reste est dans « Options avancées » (replié) ; titre facultatif (placeholder = titre automatique, vidé =
    retour au titre automatique).
  - **Aperçu vivant** : la tuile en cours de saisie est rendue pour de bon par `charts.renderTile` dans le panneau
    (même code que le tableau de bord, donc ce que l'on voit est ce que l'on obtient), sur un id réservé
    `__preview__`, sans clic possible (un clic dans l'aperçu ne pose aucun filtre croisé), libéré à la fermeture.
    Formulaire invalide → pas d'aperçu, message « Complétez… ».
  - **Conseil** : `advice.adviceForTile` (anneau > 7 parts, radar > 8 axes, courbe sans ordre naturel…) sous les
    champs, en `warn` ou `tip`. Les cartes d'accueil de la PR 2b (`js/welcome.js`) sont inchangées ; `#welcome-add`
    ouvre le panneau.
  - **Validation en ligne** : plus de fenêtre de message ; `readTileForm` pose `aria-invalid`/`aria-describedby` et
    un message sous le champ fautif (`tileForm.error.*`, bilingue), qui disparaît dès que le champ est corrigé.
    Cas vérifiés : tableau croisé avec la même colonne en lignes et en colonnes, jauge Min > Max.
  - **Bug réel n°33, trouvé en testant le panneau dans un cadre isolé** : dans `sandbox="allow-scripts"` (GFS), sans
    `allow-forms`, l'événement `submit` n'est jamais émis — « Ajouter la tuile » ne faisait donc RIEN dans GFS, et
    pareil pour les filtres avancés et les commentaires. Reproduit sur le code déjà fusionné (9 tuiles avant, 9
    après), corrigé par `bindFormSubmit` (clic sur un bouton `type="button"` + Entrée dans un champ texte), vu
    ensuite dans un cadre isolé pour les trois formulaires.
  - **Non vérifié** : (1) rien n'a été vu dans un VRAI GFS ni dans un vrai Grist (cadre isolé simulé seulement) ;
    (2) clavier réel et lecteur d'écran sur le panneau : ordre de tabulation, `aria-describedby` et focus
    vérifiés par script seulement ; (3) l'aperçu recalcule à chaque changement de champ : sur un très gros tableau
    (au-delà du seuil DuckDB), la latence réelle n'a pas été mesurée ; (4) les captures de la vitrine GFS
    (`vitrine/*.webp`) montrent l'ANCIENNE interface et restent à refaire ; (5) les nouveaux types du fil « ECharts 6 »
    (entonnoir, séries, empilé, palette) ne sont pas dans les cartes : ils les ajouteront eux-mêmes via `TYPE_CARDS`.

- **Montée d'ECharts de la 5.6.0 à la 6.1.0** (18/11/2026, demande d'Antoine : « la dernière version la plus stable » ;
  `js/vendor/echarts/`, `js/charts.js`) : `npm view echarts` donne `latest` = 6.1.0 (19/05/2026, pas de 6.2) ; le tarball
  `echarts@6.1.0` a été téléchargé, son intégrité `sha512` contrôlée contre le registre, et `dist/echarts.min.js` (1 121 883
  octets, + 91 Ko) posé avec `LICENSE` et `NOTICE`. **Pas une demande à GFS** : ECharts est ce dont l'app ne peut pas se
  passer pour tourner seule (protocole « Demander à GFS », étape 1) — voir `GFS-ETAT.md`, « Changements qui touchent GFS ».
  - **Ce que le guide de migration annonce** (page « v6 upgrade guide » + notes de la 6.1.0, lues mais pas rejouées une à
    une) : nouveau thème par défaut (palette, positions, tailles), anti-débordement/anti-chevauchement des noms d'axes
    activés, héritage `rich` -> texte simple. Notre code fixe déjà la palette (`CATEGORICAL_PALETTE`) et la position de
    chaque légende (`top: 0`), et `containLabel` marche toujours : rien de ce côté n'a bougé. Les ruptures de la 6.1.0
    (`valueFormatter`, `axis.startValue`, barres qui ne débordent plus de la grille) ne concernent aucun réglage de ce dépôt.
  - **Trois écarts de rendu trouvés EN COMPARANT les 12 types côte à côte (5.x puis 6.1.0, même jeu de 576 lignes)** :
    (1) **treemap** : la v6 remplace le cadre par défaut 80 % × 80 % centré par des marges fixes (gauche/droite 20 px,
    haut/bas 50 px) : 62 px de haut dans une tuile de 224 px, quatre rectangles en bandeau — corrigé par un cadre explicite
    (`left/right/top/bottom: 8`), la treemap occupe maintenant plus de place qu'avant ; (2) **camembert/anneau** : trait
    d'étiquette `length2` 15 -> 30 px, donc « Widget B » tronqué en « Widge… » — corrigé (`labelLine: { length: 15, length2: 15 }`) ;
    (3) **radar** : rayon par défaut 75 % -> 50 % (polygone minuscule) mais noms d'axes désormais entiers et non coupés
    (en v5 ils étaient grisés et rognés en haut/en bas) — rayon explicite 62 %.
  - **Bug réel trouvé au passage (pas dû à la v6)** : un radar sans aucun axe (filtre qui ne laisse aucune ligne, ou
    colonnes pas encore choisies en mode « compétences en colonnes ») lève `Cannot read properties of undefined (reading
    'push')` dans ECharts 5 comme 6, hors du rendu async, tuile restée vide sans message. Gardé : tuile vide, aucune
    exception (`js/charts.js`, branche radar).
  - **Vérifié (Playwright, Chromium, vrai `index.html`/harnais + `dev-tests/grist-stub.js`)** : `echarts.version` = 6.1.0
    (la v5 vendorisée annonçait 5.5.1 alors que son bundle était la 5.6.0) ; 12 types de tuile rendus sans aucun message
    de console ; `getDataURL({pixelRatio: 2, backgroundColor})` rend un PNG (exports PDF/PPTX) ; clic souris réel sur
    secteur, rectangle de treemap, point de nuage de points (filtre croisé) et barre (drill-down) ; info-bulle d'une barre ;
    radar vidé par un filtre. **Non vérifié** : le nuage de mots (n'utilise pas ECharts, rendu toujours en attente de
    d3-cloud chez GFS) ; les tuiles en mode mesure DuckDB (cumul/YTD/N-1) sous la v6 (même API `showLoading`/`bar`, mais
    pas rejouées : le harnais n'a pas de colonne date) ; le thème sombre ; un vrai Grist ou un vrai GFS.

- **Entonnoir (funnel)** (18/11/2026, fil « Passer à ECharts 6 et ajouter 4 graphiques », 1re des 4 fonctionnalités ;
  `js/charts.js`, `js/data.js`, `js/advice.js`, `js/welcome.js`, `js/pbix-layout.js`, `js/main.js`, `index.html`,
  `js/i18n.js`) : reproche de l'étude de Publipostage+. Nouveau type `funnel`, mêmes champs que le camembert (une
  dimension, une mesure, un agrégat, drill-down, filtre croisé au clic sur une étape). Aucune nouvelle bibliothèque.
  - **Ordre des étapes** : la série ECharts est en `sort: 'none'` — le `'descending'` par défaut d'ECharts remettrait à
    plat un parcours que la table range déjà dans l'ordre (Visite, Inscription, Achat). L'ordre vient donc de
    `tile.sortMode` (l'entonnoir est « triable » comme un camembert : `SORTABLE_TILE_TYPES`), valeur décroissante
    proposée par défaut (`advice.defaultsForType`) SAUF sur une dimension qui se range d'elle-même (mois, périodes),
    où l'ordre des données est conservé. L'export Excel applique le même tri (`tileExportSheet`).
  - **Rendu** : cadre explicite (`left/right/top/bottom: 8`, `width: '55%'`, `minSize: '8%'`), libellés « nom · valeur
    compacte » à DROITE en texte foncé — « inside » donnait du blanc sur jaune, illisible, et se coupait sur les dernières
    étapes ; info-bulle : valeur + « x % de la 1re étape » (le pourcentage est relatif à la 1re étape AFFICHÉE, donc à
    l'ordre choisi).
  - **Conseil** (`advice.js`) : valeurs négatives -> avertissement (un entonnoir ne les représente pas) ; plus de 10 étapes
    -> avertissement. Pas de suggestion automatique sur l'accueil (`suggestTiles`) : un entonnoir n'a de sens que sur des
    étapes, que le profilage des colonnes ne sait pas reconnaître. Carte « Choisir », icône, miniature d'accueil (bandes
    centrées de largeur proportionnelle) et ligne « quand l'utiliser » ajoutées.
  - **Import Power BI** : le visuel `funnel` (une catégorie + une mesure) est mappé sur la même forme que `pieChart`/
    `treemap` (`VISUAL_TYPE_TO_TILE_TYPE`). **Jamais essayé sur un vrai fichier .pbix** (même réserve que les autres
    correspondances).
  - **Testé** : Node (`dev-tests/test-data.js`) — tri/ordre des données/export, mapping Power BI (avec et sans la colonne),
    défauts, avertissements, carte, miniature et SVG ; Playwright (vrai `index.html` + `dev-tests/grist-stub.js`) —
    carte « Entonnoir » dans le panneau avec sa ligne de conseil, valeurs préremplies (dimension `Etape`, mesure
    `Personnes`, tri valeur décroissante), champ Tri visible et pas Horizontal/Anneau, aperçu vivant (canvas), ajout,
    clic souris réel sur la 2e étape -> filtre croisé, édition (valeurs reprises), libellé anglais « Funnel », aucun
    message de console. **Non vérifié** : un vrai Grist / GFS ; l'aspect avec des étapes très inégales (une étape 50 fois
    plus petite que la 1re est réduite à `minSize` 8 %, donc plus large que sa valeur — choix de lisibilité) ; le thème
    sombre.
- **Séries multiples** (18/11/2026, fil « Passer à ECharts 6 et ajouter 4 graphiques », 2e des 4 fonctionnalités ;
  `js/data.js`, `js/charts.js`, `js/advice.js`, `js/main.js`, `index.html`, `js/i18n.js`) : reproche de l'étude de
  Publipostage+. Champ optionnel `tile.seriesColumn` (« Séries (une par valeur) », dans « Options avancées ») : une série
  par valeur distincte de cette colonne, sur le même axe de catégories (`tile.dimension`). Aucune nouvelle bibliothèque.
  - **Types concernés** : barres (hors mode mesure temporelle Cumul/YTD/N-1, qui ont déjà leur propre notion de séries) et
    courbe/aire — `data.isSeriesTile`. Camembert, treemap, entonnoir, cascade, radar, nuage de points, KPI, jauge, tableau
    croisé : une seule série par nature, le champ est masqué. Un champ laissé sur un type qui ne le gère pas est ignoré à la
    lecture du formulaire (`readTileForm`) et au rendu (`isSeriesTile`).
  - **Trois étapes pures et séparées** : `splitBySeries` (une série par valeur, ordre de PREMIÈRE APPARITION — piège n°14 ;
    une cellule vide devient « (vide) »), un `groupByAggregate` PAR série (JS pur ou DuckDB selon le volume, comme pour une
    tuile simple : `charts.js:computeSeriesGroups`), puis `assembleSeries` qui aligne les séries sur les catégories.
    Une catégorie absente d'une série vaut `null` (un TROU, jamais 0 : ce n'est pas la même information — barre absente,
    rupture de la courbe, cellule vide dans l'export Excel).
  - **Tri** : `sortMode` trie les CATÉGORIES sur le total de leurs valeurs toutes séries confondues (pour une moyenne :
    somme des moyennes — un simple critère d'ordre, jamais une valeur affichée). Les valeurs suivent leur catégorie dans
    chaque série.
  - **Interaction** : un clic sur une barre ou un point d'UNE série filtre sur la CATÉGORIE (colonne `dimension`), pas sur la
    série — même geste que sans série. Filtrer aussi sur la série serait un choix de produit à part, non fait.
  - **Conseil** (`advice.series.*`) : plus de 8 séries -> avertissement (légende illisible, couleurs répétées) ; colonne
    Séries = dimension -> avertissement (chaque catégorie n'aurait qu'une série) ; la validation du formulaire refuse en
    plus ce second cas (`tileForm.error.seriesSameAsDimension`, sous le champ).
  - **Export Excel** : une colonne par série (en-tête = valeur de la série), mêmes catégories et même ordre que l'écran ;
    sans colonne Séries l'export historique (2 colonnes) est INCHANGÉ.
  - **Testé** : Node — `isSeriesTile` (types et modes), `splitBySeries`, `assembleSeries` (trous `null`, tri sur total,
    ordre d'apparition, entrées non mutées, aucune catégorie), export Excel (en-têtes, trous vides, tri, filtre croisé qui
    retire une série), avertissements du conseil ; Playwright (vrai `index.html` + `dev-tests/grist-stub.js`) — champ visible
    pour barres et courbe seulement (et masqué pour pie/funnel/treemap/waterfall/radar/kpi), choix par le vrai combobox,
    aperçu vivant avec légende, erreur série = dimension affichée sous le champ (le `<details>` s'ouvre), ajout, titre
    auto « Montant par Region et Produit », 3 séries et trou `null` dans les données ECharts, clic souris réel sur une barre
    de chaque série -> bon filtre de catégorie, édition (valeur reprise), retrait de la série -> retour à une seule série,
    courbe+aire, libellé anglais, aucun message de console ; **DuckDB réel** (table de 6 050 lignes, au-delà de
    `DUCKDB_ROW_THRESHOLD`, moteur chargé) : séries, catégories, trous et tri identiques à la référence JS pure — **mais
    avec une dimension TEXTE seulement** (Region). Le cas d'une dimension ENTIÈRE (une année) n'était pas couvert et cachait
    un vrai bug, trouvé ensuite par un autre fil et corrigé dans la PR #65 : DuckDB rend un entier en BigInt (`2022n`),
    le JS pur en nombre, et `assembleSeries` comparait les clés avec un `Map` — toute la série tombait à « pas de
    valeur » (aire plate à 0, sans erreur). Clés désormais comparées en texte (`sameValue`, piège n°7).
    **Non vérifié** : un vrai Grist / GFS ; une série par DuckDB sur plusieurs dizaines de milliers de lignes (une requête
    par série : coût non mesuré) ; plus de 8 séries à l'écran ; l'aire non empilée de plusieurs séries se recouvre (voir
    le suivant « empilé ») ; thème sombre.
- **Empilé (barres et aire)** (18/11/2026, fil « Passer à ECharts 6 et ajouter 4 graphiques », 3e des 4 fonctionnalités ;
  `js/data.js`, `js/charts.js`, `js/advice.js`, `js/main.js`, `index.html`, `js/i18n.js`) : case « Empiler les séries »
  (`tile.stacked`) qui superpose les séries au lieu de les mettre côte à côte. Aucune nouvelle bibliothèque.
  - **Quand** (`data.isStackedTile`) : seulement avec une colonne Séries (sinon une seule série, rien à empiler), pour les
    BARRES (verticales ou horizontales) et l'AIRE (courbe + `areaFill`). Une courbe sans remplissage empilée serait une
    courbe cumulée — un autre graphique, que personne ne lit comme tel : la case est masquée dans ce cas et, si l'indicateur
    traînait sur la tuile, il est ignoré au rendu. Le formulaire écrit `stacked` à `undefined` dès qu'une des conditions
    manque (série retirée, Aire décochée).
  - **Rendu** : toutes les séries partagent la pile ECharts `'total'`. Aire empilée à opacité 0,65 (à 0,25, deux bandes
    voisines se confondent) ; aire non empilée toujours 0,25. Info-bulle sur l'axe avec une ligne **Total** (la seule chose
    qu'on ne lit pas sur la hauteur d'une pile), noms de séries échappés.
  - **Combinaison absente** : barres -> `null` conservé (aucune barre) ; aire -> **0** (un `null` rompt la bande de TOUTES
    les séries au-dessus dans ECharts). Conséquence visible : dans une aire empilée, l'info-bulle affiche 0 là où une
    barre affiche « – » ; le total est juste dans les deux cas.
  - **Export Excel** : inchangé (l'empilement est purement visuel) — la feuille d'une tuile empilée est celle de la même
    tuile non empilée (testé).
  - **Conseil** : moyenne, minimum ou maximum empilés -> avertissement (`advice.stacked.notAdditive` : le total d'une pile
    n'a pas de sens pour ces agrégats) ; somme et comptage non. Valeurs négatives : non traitées à part (ECharts les empile
    de l'autre côté de l'axe, c'est le comportement attendu d'une pile « signée »).
  - **Pas de « 100 % empilé »** (parts relatives) : non demandé, hors de cette PR.
  - **Testé** : Node — `isStackedTile` (types, horizontal, mode mesure, absence de série), export Excel inchangé,
    avertissements (avg/min/max oui ; sum/count, non empilé, courbe sans aire non) ; Playwright (vrai `index.html` +
    `dev-tests/grist-stub.js`) — case masquée sans série, visible avec série pour les barres, masquée pour une courbe
    jusqu'à ce que « Aire » soit cochée, retrait de la série la masque ; aperçu vivant empilé ; ajout ; `stack: 'total'` sur
    les 3 séries ; trou d'une barre `null`, trou d'une aire 0 ; info-bulle réelle « Sud · Widget A : 441 · Widget B : 516 ·
    Widget C : 591 · Total : 1 548 » (441 + 516 + 591) ; clic souris réel -> filtre sur la catégorie ; Aire décochée ->
    plus de pile ; édition (case reprise) ; libellé anglais ; aucun message de console. **Non vérifié** : un vrai Grist /
    GFS ; l'aspect avec plusieurs valeurs négatives ; plus de 8 séries empilées ; thème sombre.
- **Choix de palette** (18/11/2026, fil « Passer à ECharts 6 et ajouter 4 graphiques », 4e et dernière des 4
  fonctionnalités ; `js/data.js`, `js/charts.js`, `js/advice.js`, `js/main.js`, `index.html`, `css/style.css`,
  `js/i18n.js`) : liste « Palette de couleurs » (`tile.palette`, Options avancées) avec des pastilles sous la liste.
  Aucune nouvelle bibliothèque.
  - **Six palettes** (`data.js:PALETTES`) : `standard` (la palette HISTORIQUE, 8 teintes, **inchangée** : une tuile sans choix
    reste identique — testé octet pour octet), `okabe` (Okabe-Ito, 6 teintes), et quatre dégradés d'UNE teinte `blue`/`orange`/
    `green`/`gray` (7 pas, du FONCÉ au CLAIR : la 1re série, ou l'unique couleur d'une barre simple, est la plus lisible).
    `standard` n'est jamais écrit sur la tuile (`tile.palette` absent) ; une clé inconnue (config d'une version future) retombe
    sur `standard` (`paletteColors`, y compris `constructor`/`__proto__`).
  - **Validation** (validateur de la skill dataviz, surfaces `#fcfcfb` ET `#ffffff`, mode clair — les graphiques restent sur
    fond clair, une ambiance GFS ne les recolore pas) : `okabe` — les 6 teintes sont dans la bande de luminosité, CVD ΔE 9,6
    entre voisines (cible >= 8), normal 20,0 ; le jaune `#f0e442` et le noir de la palette d'origine SORTENT de la bande
    (jaune ~1,2:1 sur blanc) et ont été retirés, d'où 6 teintes et non 8 ; ordre choisi parmi trois ordres, seul celui-ci passe
    le CVD >= 8 ; passe aussi `--pairs all` (nuage de points, treemap). **Réserve de contraste** (même que la Standard) :
    `#e69f00`, `#56b4e9` (et `#cc79a7`, 2,98:1 sur `#fcfcfb`) sont sous 3:1 sur la surface — les marques doivent rester
    doublées d'une étiquette, d'une info-bulle ou de la vue Détail, jamais lues à la seule couleur. Dégradés : vérifications « ordinales » (luminosité monotone, écart >= 0,06 entre pas voisins, pas le plus
    clair >= 2:1) ; 8 pas ne passaient PAS l'écart (0,058), d'où 7 pas ; le vert a dû s'arrêter plus foncé (1,95:1 sinon). Le
    validateur n'est pas dans le dépôt : `dev-tests/test-data.js` rejoue ses vérifications de rampe/bande (OKLab, WCAG) pour
    qu'une retouche à la main ne les casse pas.
  - **Quels types** (`supportsPalette`) : barres, courbe/aire, camembert, entonnoir, treemap, nuage de points, radar, jauge, nuage
    de mots. **Pas** la cascade (vert = hausse, rouge = baisse : un sens, pas une identité de série), le KPI ni le tableau
    croisé ; les indicateurs de chargement gardent aussi la couleur historique.
  - **Dégradés = catégories ordonnées** : sur des séries SANS ordre, deux pas voisins du foncé se distinguent mal (visible sur
    barres à plusieurs séries en dégradé bleu) — dit dans le libellé de la liste. L'écart entre pas voisins est celui de
    la skill (0,06), pas davantage.
  - **Conseil** : le plafond de séries (`advice.series.tooMany`, maintenant avec `{max}`) suit le nombre de couleurs de la palette
    (8 en Standard, 6 en Okabe-Ito, 7 en dégradé) ; camembert/entonnoir/treemap avec PLUS de valeurs que la palette choisie ->
    `advice.palette.tooFewColors` (la 1re couleur revient, et un camembert fait se toucher la 1re et la dernière part). Cet
    avertissement n'existe QUE quand une palette a été choisie : le comportement de la palette historique ne change pas
    (un treemap de 9 éléments en Standard repart aussi sur la 1re couleur, sans conseil — constat, pas traité ici).
  - **Miniatures de l'accueil** (`js/welcome.js`) : gardent leur copie de la palette Standard (les suggestions n'ont pas de
    palette choisie) ; un test Node lit le source et échoue si la copie diverge de `PALETTES.standard`.
  - **Exports** : PDF/PPTX capturent l'image déjà rendue (donc la palette choisie) ; Excel n'a pas de couleur.
  - **Testé** : Node — repli, types, rampes (luminosité/écart/contraste), Okabe dans la bande, copie de `welcome.js`,
    plafonds du conseil ; Playwright (vrai `index.html` + `dev-tests/grist-stub.js`) — liste visible pour 8 types sur 10
    (masquée pour cascade et KPI), pastilles = couleurs de la palette (8, puis 6), aperçu vivant, ajout, `tile.palette`
    écrit, **pixels du canvas** : les 4 parts d'un anneau portent bien 4 des 6 couleurs Okabe, édition (valeur reprise), retour
    à Standard -> propriété non écrite, 9 types avec le dégradé bleu rendus sans erreur (cascade restée vert/rouge), clé
    inconnue -> Standard, libellés anglais. **Non vérifié** : un vrai Grist / GFS ; lecture au vidéoprojecteur ou à
    l'impression noir et blanc du dégradé gris ; thème sombre (les graphiques n'en ont pas) ; plus de 8 séries.

- **Retours d'Antoine sur la nouvelle interface, 1re série (18/11/2026)** — `js/grist-api.js`, `js/main.js`,
  `js/appbar.js`, `js/charts.js`, `index.html`, `css/style.css`. Huit retours ; ce lot en traite six, les deux
  autres (suivi d'une vue sauvegardée, zoom d'une tuile sur place) ont leur PR.
  - **« E,NameError » dans le champ Auteur d'un commentaire** (bug réel n°35) : la colonne `Email` de la
    table-sonde `BI_Dashboard_UserProbe` était créée comme formule ORDINAIRE (`isFormula: true`). Or `user` n'existe
    que dans une formule DÉCLENCHÉE (`isFormula: false` + `formula`) et dans les règles d'accès : dans un vrai
    document la cellule valait `NameError`, que `fetchTable` rend sous la forme `['E', 'NameError']`, affichée telle
    quelle (`String(['E','NameError'])` = « E,NameError ») dans un champ verrouillé. Le mock ne simulait pas le moteur
    de formules, donc rien ne l'avait vu (voir CLAUDE.md §3 : « jamais testé en réel »). Corrigé en trois couches :
    (1) la colonne est créée en formule déclenchée ; (2) `validEmailOrNull` : seule une chaîne qui ressemble à une
    adresse devient un auteur, jamais un tableau d'erreur ni un nombre ; (3) les documents qui ont déjà l'ancienne
    colonne sont réparés — cellule en erreur → UN `ModifyColumn` (`isFormula: false`, `formula: 'user.Email'`) puis
    une relecture, une seule fois par session ; si Grist refuse, repli sur la saisie manuelle, sans exception. Le champ
    a aussi une étiquette visible (« Auteur », « Commentaire ») et, quand l'adresse est reconnue, une note
    « Reconnu depuis votre compte Grist ».
    - **Non vérifié** : (a) que `ModifyColumn` convertisse bien l'ancienne colonne dans un vrai Grist (le test Node
      simule la réponse de l'API, pas le moteur) ; (b) que `user.Email` soit rempli pour un utilisateur connecté
      appelant `applyUserActions` depuis un widget — c'est le pari initial du projet, jamais confirmé ; (c) le cas
      d'un visiteur anonyme (adresse vide) retombe sur la saisie manuelle, c'est voulu. À confirmer en rouvrant un
      commentaire dans le vrai document d'Antoine (`console` : `[GristBI] réparation de la colonne Email…` si la
      réparation échoue).
  - **Menu Filtre refait pour la souris** (retours 2 et 5) : il s'ouvrait avec le focus dans un combobox, donc avec
    la liste des colonnes déjà dépliée et rognée par le panneau. Désormais deux étapes sans aucun combobox :
    (1) la liste de TOUTES les colonnes, visibles et cliquables, avec un badge de type (Aa / 123 / 31) et une
    recherche ; (2) le réglage pour la colonne cliquée (plage, dates, ou valeurs). Les valeurs du filtre texte sont
    des boutons cliquables sous le champ (jusqu'à 40, « N autres valeurs » au-delà ; un clic pose le filtre « contient »
    tout de suite, un morceau de texte tapé filtre la liste). Les erreurs de saisie s'affichent sous les champs, plus
    dans une fenêtre. Chaque ouverture revient au 1er écran (`GristBI.appbar.onOpen`). Clavier : ↓ ↑ entre la
    recherche et les colonnes (ou les valeurs), Entrée dans la recherche ouvre la 1re colonne trouvée, Échap ferme.
    **Limite** : la liste des valeurs est plafonnée à 500 valeurs distinctes (`distinctColumnValues`), comme avant.
  - **« Effacer les filtres »** (retour 1) : un vrai bouton (`.btn-secondary.btn-chip`, icône ×) au lieu d'un lien souligné.
  - **Roue crantée** (retour 6) : l'icône de Réglages était un soleil (cercle + 8 rayons). Remplacée par la roue de
    Publipostage+ (`css/toolbar-v2.css`, `#v2-btn-settings`), tracée sur une grille de 24.
  - **Infobulle du radar hors de la carte** (retour 7, bug réel n°36) : reproduit — la bulle d'un radar de 224 px de
    haut se posait à x = −66 px (hors de l'écran à gauche), à 72 px au-dessus de la tuile. `confine: true` est posé sur
    TOUTES les bulles juste avant `setOption` (`confineTooltip`), et celle du radar est formatée (une ligne par axe,
    nombres au format français ; avant : « 8.504166666666666 »).
  - **Non vérifié** : rien n'a été vu dans un vrai Grist ni un vrai GFS ; clavier réel et lecteur d'écran non essayés.

- **Retours d'Antoine sur la nouvelle interface, 2e partie : suivi d'une vue sauvegardée (18/11/2026, point 4)** — `js/state.js`,
  `js/main.js`, `index.html`, `css/style.css`, `js/i18n.js`. Demande : « quand une vue filtrée est activée, un meilleur suivi, pour
  savoir que c'est une vue déjà sauvegardée ». Avant : un `<select>` qui appliquait la vue au choix puis oubliait laquelle (son
  commentaire de code disait même « ne reflète PAS si les filtres correspondent encore à la vue : simplification délibérée »).
  - **Ce qui change** : (1) le menu Vues est une LISTE de lignes cliquables (plus de liste déroulante), la vue suivie est cochée
    avec « vue active » ou « modifiée » ; (2) le bouton Vues de la barre affiche le nom de la vue suivie, avec un point
    d'avertissement quand elle est modifiée (sous 900 px le libellé disparaît, le signet plein et le point restent, le nom complet
    est dans `aria-label`/`title`) ; (3) une pastille en tête des pastilles de filtre : « Vue **Région Nord** *modifiée*
    Mettre à jour ✕ » ; (4) « Mettre à jour « X » » (menu) ou « Mettre à jour » (pastille) remplace le contenu de la vue par les
    filtres actuels ; « Sauvegarder comme nouvelle vue » en crée une autre ; la croix de la pastille quitte la vue SANS toucher
    aux filtres ; (5) supprimer une vue demande confirmation (fenêtre du kit) — avant, un clic suffisait.
  - **Choix de modèle** : « modifiée » est DÉRIVÉ (`sameSnapshot` compare les filtres croisés, les filtres avancés et les
    chemins de drill-down à ceux de la vue), pas un drapeau posé à chaque action : défaire la modification redonne « non
    modifiée », et aucune action de l'interface ne peut l'oublier. L'ordre des filtres ne compte pas (cliquer A puis B ou B puis A =
    même vue), un chemin de drill-down vide équivaut à aucune entrée, une vue d'avant les filtres avancés (champ absent) vaut
    « aucun filtre avancé ». Les pages, les tuiles et la jointure ne font pas partie d'une vue (comme avant).
  - **Volontairement PAS fait** : (a) le suivi n'est pas persisté — les filtres ne le sont pas non plus, donc au rechargement du
    widget il n'y a rien à suivre ; (b) pas de reconnaissance automatique (poser à la main les mêmes filtres qu'une vue
    n'« active » pas cette vue : le suivi suit un geste explicite) ; (c) pas de renommage d'une vue (la supprimer et la
    recréer) ; (d) « Effacer les filtres » quitte aussi la vue (page blanche) alors que retirer UNE pastille de filtre la laisse
    « modifiée ». Une vue vide (aucun filtre) est valide : la rangée de pastilles reste alors visible tant qu'elle est suivie.
  - **Aussi corrigé en passant** (bug réel n°37) : sous 900 px les boutons Filtre / Vues / Exporter n'avaient plus aucun nom
    accessible (libellé masqué, icône décorative, ni `aria-label` ni `title`) ; ils en ont un maintenant.
  - **Testé** : Node (`sameSnapshot` ; état : sauvegarder/appliquer/mettre à jour/quitter/supprimer/changer de table, « modifiée »
    qui revient à faux quand on défait, vue ancienne sans filtres avancés) ; Playwright contre le vrai `index.html` +
    `dev-tests/grist-stub.js`, page directe, `<iframe sandbox="allow-scripts">`, anglais, 700 px de large, et la démo à 4 vues.
    **Non vérifié** : un vrai Grist / GFS ; lecteur d'écran réel ; l'annonce vocale du passage à « modifiée » (pas de zone
    `aria-live`).

- **Retours d'Antoine sur la nouvelle interface, 3e partie : agrandir une tuile sur place (18/11/2026, point 8)** — `js/state.js`,
  `js/main.js`, `index.html`, `css/style.css`, `js/i18n.js`. Demande : « zoomer sur une tuile, qu'elle s'affiche en grand en un
  clic, mais pas en popup : définir dynamiquement une zone où se mettent en grand la ou les tuiles choisies, les autres en
  dessous ».
  - **Ce qui est fait** : chaque tuile a un bouton « Agrandir » (⤢, en Lecture comme en Édition ; il devient « Réduire » une fois la
    tuile agrandie). La tuile quitte la grille et s'affiche dans une zone au-dessus d'elle, dans le même flux (pas une fenêtre,
    rien ne se superpose : filtres croisés, drill-down, commentaires, détail restent utilisables). Plusieurs tuiles peuvent être
    agrandies : une seule prend toute la largeur, deux ou plus se partagent la ligne tant que chacune garde ~440 px. Une barre
    « N tuiles agrandies » + « Tout réduire » coiffe la zone. Les autres tuiles restent dessous, dans leur ordre d'origine ; une
    tuile réduite retrouve exactement sa place. Hauteur d'une tuile agrandie : 62 % de la hauteur du widget, bornée entre 340 et
    680 px ; une carte KPI agrandie montre un chiffre jusqu'à 84 px.
  - **Choix techniques** : la tuile est DÉPLACÉE dans le DOM, pas recréée — la même instance ECharts continue (vérifié : même
    objet, non détruit) et `resizeAll()` lui donne sa nouvelle taille ; c'est ce qui évite le piège n°6 (instance détachée).
    Conséquence : les tuiles vivent dans deux conteneurs, donc le rendu passe par leur parent commun (`#workspace-main`). La
    hauteur reste FIXE (piège n°8), simplement plus grande. Le déplacement ◂ ▸ est masqué dans la zone (l'ordre est celui de la
    grille).
  - **Volontairement PAS fait** : (a) l'agrandissement n'est pas persisté (confort de lecture, pas une mise en page : comme les
    filtres et les vues actives, il disparaît au rechargement) ; (b) pas de plein écran ni de fenêtre ; (c) pas de redimensionnement
    à la souris ni de zone « à définir » à la main — la zone est celle qui se forme d'elle-même avec les tuiles choisies ; (d) pas de
    raccourci clavier dédié (le bouton est atteignable au clavier) ; (e) PDF/PPTX/Excel exportent comme avant, un graphique agrandi
    est simplement capturé à sa taille du moment.
  - **Testé** : Node (état : plusieurs tuiles, ordre d'affichage, toggle, tout réduire, suppression, multi-pages, `setPages`, aucune
    nouvelle référence de `pages`) ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe,
    `<iframe sandbox="allow-scripts">`, anglais à 1300 px, 420 px : zone au-dessus de la grille, largeur pleine, même instance
    ECharts redimensionnée, canvas contenu dans la tuile, hauteur stable sur 1,7 s, clic sur une barre agrandie = filtre croisé,
    deux tuiles côte à côte, retour à la taille d'origine, KPI, pages, Édition (déplacer masqué, supprimer une tuile agrandie),
    panneau d'ajout ouvert (la zone ne passe pas dessous). **Non vérifié** : un vrai Grist / GFS ; un très grand nombre de
    tuiles agrandies ; un très petit widget (< 400 px de haut : la hauteur plancher de 340 px y dépasse la fenêtre, la page défile).

- **Modèles de rapport pour « Nouveau > Depuis un modèle » de GFS** (18/11/2026, fil « Appliquer la nouvelle consigne GFS »,
  consigne 016, facultative) :
  - **Ce qu'est un modèle ici** : un rapport de départ (une page de tuiles) posé sur une table que la personne a DÉJÀ — jamais une
    table créée. Trois modèles : `vue-d-ensemble` (2 chiffres clés avec tendance, aire dans le temps, barres, anneau),
    `evolution` (chiffre clé, aire, aire empilée par catégorie, barres par mois `<date>.Mois`), `repartition` (barres sur deux
    dimensions différentes, anneau, treemap s'il y a au moins 9 valeurs, tableau croisé). Chaque modèle est défini par des RÔLES
    (une date, des catégories, une mesure) que `advice.analyzeColumns` lit dans les VALEURS, et pioche ses tuiles parmi
    `advice.suggestTiles` : mêmes heuristiques que l'écran d'accueil, aucune copie à tenir à jour. Choix de produit : pas de
    `tables: true` (la règle « aucune table de données » ne bouge pas, voir CLAUDE.md §8) ; un modèle qui crée des tables, avec
    des données d'exemple, serait une décision à part d'Antoine.
  - **Quelle table** : `openModelById` essaie d'abord la table déjà connectée, puis les autres dans l'ordre de GFS (8 au plus,
    pour ne pas relire un gros document entier pour un clic), et prend la première où `models.build` réussit. `vue-d-ensemble` et
    `repartition` veulent une colonne de catégories ; `evolution` veut une date (ou une année). Sans mesure, on compte les lignes.
  - **Contrat d'ouverture** (contrats GFS 5.4, point 13) : un modèle s'ouvre NON enregistré (jeton `'new'`, comme « Nouveau » : rien
    n'est écrit avant un geste de la personne) ; un `id` inconnu, un type autre que `rapport` ou aucune table qui convienne rendent
    `{ ouvert: false }` (une fenêtre dit pourquoi, le rapport affiché ne change pas), JAMAIS un rapport vierge à la place. À
    l'ouverture initiale (`bootstrap`), un modèle qui ne s'ouvre pas laisse l'app démarrer comme d'habitude sur la première table
    avec son rapport enregistré — pas un rapport vierge qui ferait croire que le modèle s'est ouvert.
  - **Kit 0.9.0 -> 0.24.0** (`7aa030c`) : seul `kit/js/gfs-link.js` change parmi les fichiers que cette app importe (`ambiance.js`,
    `dialogs.js`, `windows.css` identiques entre les deux commits, vérifié par `git diff`) ; les ajouts sont facultatifs (correcteurs,
    copies, `attach`, `onDelete`…), `modele` est le seul qui nous concerne.
  - **Bug réel trouvé en route** : une aire empilée par année restait PLATE À 0 au-delà de 5 000 lignes (BigInt de DuckDB contre
    nombre du JS pur dans `assembleSeries`) — PR #65, voir TEST_PROTOCOL.md n°34.
  - **Testé** : Node — `models.build` sur le jeu de test (vraies colonnes, agrégats valides, fr/en, sans `id`), contenu de chaque
    modèle, tables sans date / sans catégorie / vide / `id` inconnu (`__proto__` compris), résultats indépendants d'un appel à
    l'autre, clés i18n `models.*` fr/en à variables identiques, `modeles/modeles.json` contre les règles de GFS (id, 60/140 signes,
    étiquettes bilingues, WebP 240 × 320 ≤ 12 Ko, aucune vignette orpheline, aucun `tables`/`extensions`) et correspondance exacte
    avec les modèles du code ; Playwright — le vrai `index.html` dans un `<iframe sandbox="allow-scripts">` servi par un FAUX GFS
    parent qui répond `contexte` et envoie `ouvrir` avec le vrai kit 0.24.0 (9 scénarios : ouverture initiale avec `modele`, rien
    d'écrit avant un geste puis UNE ligne avec les 5 tuiles, `ouvrir` d'un second modèle sans seconde ligne, `id` inconnu et type
    `document` -> `{ ouvert: false }` écran inchangé, « Nouveau » toujours vierge, table de nombres seulement -> `{ ouvert: false }`
    + message, ouverture initiale d'un `id` inconnu, anglais). **Non vérifié** : le vrai GFS (la fenêtre « Depuis un modèle », le
    clic « Créer », la copie du catalogue par `outils/modeles.mjs`) ; un vrai Grist ; les modèles sur des tables réelles variées
    (testés sur le jeu de ventes de test et une table de nombres). **Limites** : les titres reprennent les noms de colonnes
    (`Montant par Date.Annee`) comme les suggestions de l'accueil ; les vignettes sont des captures du vrai `index.html` avec le
    faux Grist du dépôt (même réserve que `vitrine/`), sur un jeu de ventes d'exemple sans nom de personne.

### Lisibilité des valeurs sur les tuiles — lot 1 : format des nombres (18/11/2026)

Demande d'Antoine : « un petit souci d'UI, peux-tu faire un audit de ce qu'affichent les cartes et si les valeurs sont bien lisibles à chaque fois ? », puis « par défaut les chiffres ont beaucoup de chiffres significatifs — avoir un réglage et une option "comme dans la colonne" » (avec la capture d'une infobulle de treemap : « 600,688.2299999992 »).

**Audit (rendu réel du `index.html` avec le faux Grist du dépôt, 96 lignes puis 6 000 ; clair, sombre, fr/en)** : constats sur les valeurs et leurs formats.
1. Trois formats pour une même valeur : `fr-FR` à 2 décimales (KPI, radar, entonnoir, empilé, nuage de points, tableau croisé), compact à 1 décimale (axes), et celui d'ECharts par défaut — anglais, sans limite de décimales — pour les infobulles de barre, courbe, camembert, anneau, treemap et cascade (« 1,542,980.8799999997 », « 0.20472679998130852 »).
2. La langue de l'interface n'était pas suivie : en anglais, KPI et tableau croisé restaient en « 6 280 280,22 ».
3. Variation KPI : « 1.5% » (point décimal) au milieu d'une interface française.
4. Une valeur minuscule disparaissait : moyenne de 0,0006 -> « 0 » (carte KPI) ; axe de 0,0001 à 0,0007 -> sept « 0 » ; graduations de 0,05 d'écart -> « 0,1 » « 0,1 ».
5. Cascade : l'infobulle listait aussi l'autre série à 0 (« Baisse 0 » sur une hausse) et la valeur non formatée.
Autres constats (jauge, KPI de très grands nombres, libellés longs, thème sombre, nuage de mots) : traités dans les lots suivants.

**Fait** : `js/format.js` (voir CLAUDE.md §2) — un formateur par tuile, trois modes (`auto` par défaut, `custom`, `column` ; ces deux derniers n'ont pas encore de réglage dans le panneau, lot suivant), `valueFormatter`/`formatter` sur toutes les infobulles, `axis` à 3 chiffres significatifs, variation en % aux séparateurs de la langue ; `js/charts.js` n'a plus aucun `Intl.NumberFormat`/`toFixed` (un test Node le vérifie). Choix de l'Automatique : entiers dès 1 000 (« 3 266 234 » au lieu de « 3 266 234,27 »), compact dès 10^12 (« 5,43 Bn », 13 chiffres ne se lisent plus).

**Vérifié** : Node (`test-data.js`, 7 blocs) ; navigateur, vrai `index.html` + faux Grist, 17 types de tuile en français, anglais et thème sombre, puis 6 000 lignes (DuckDB, valeurs `BigInt`). **Non vérifié** : tout ce qui touche un vrai Grist (aucun document réel ouvert depuis cette session).

### Lisibilité des valeurs sur les tuiles — lot 2 : jauge et carte KPI (18/11/2026)

Point de départ : la capture d'une jauge illisible envoyée par Antoine (graduations qui se chevauchent, aiguille sur les libellés, grande valeur qui sort sous la jauge).

**Cause** : une jauge ECharts avec ses réglages par défaut (arc de 270°, 5 libellés et 5 traits dans l'arc, aiguille) dans une zone d'environ 316 x 162 px ; l'ancien correctif (4 divisions au lieu de 10, voir TEST_PROTOCOL.md) ne suffisait plus une fois la jauge aussi petite, et la valeur centrale restait à 18 px quelle que soit sa longueur.

**Fait** : jauge en demi-cercle (`GristBI.format.gaugeLayout`, pur) : arc en haut, bornes min/max sous les extrémités, aiguille de 74 % du rayon (jamais sur l'anneau), valeur sous le moyeu ; police de la valeur réduite jusqu'à tenir, puis format compact ; géométrie recalculée au redimensionnement (`__refit`) ; sans borne haute, un « beau » nombre (`niceCeil`) ; couleurs lues sur les jetons CSS. Carte KPI : la police se réduit pour que la valeur tienne dans la tuile (`container-type: inline-size`, `cqw`).

**Choix assumé, puis revu le jour même** : plus de graduations intermédiaires DANS l'arc (seulement le minimum et le maximum) — sur une tuile de 250 px, des graduations lisibles n'ont pas de place dans l'arc. Antoine a regardé les captures « après » et a demandé de les rajouter, « peut-être à l'extérieur » : voir « Jauge : graduations à l'extérieur de l'arc » plus bas.

**Vérifié** : voir TEST_PROTOCOL.md (tailles normale, étroite, agrandie, thème sombre). **Non vérifié** : rendu dans un vrai Grist/GFS ; lecteur d'écran sur la jauge (aucun libellé accessible n'a été ajouté).

### Lisibilité des valeurs sur les tuiles — lot 3 : réglage « Format des nombres » et « Comme dans la colonne » (18/11/2026)

Demande d'Antoine : « par défaut les chiffres ont beaucoup de chiffres significatifs » (infobulle de treemap « 600,688.2299999992 ») ; il veut un réglage, et une option « comme dans la colonne » qui reprend le formatage de la colonne Grist. Le défaut lui-même avait été corrigé au lot 1 (Automatique) ; ce lot ajoute le réglage.

**Fait** : champ « Format des nombres » dans « Options avancées » du panneau (tous les types qui montrent un nombre, `data.supportsNumberFormat` : liste `NUMBER_FORMAT_TILE_TYPES`, à compléter pour tout nouveau type) avec trois choix : **Automatique** (défaut, jamais écrit dans la configuration), **Comme dans la colonne**, **Personnalisé** (décimales 0 à 6 ou « selon la valeur » + notation compacte). L'aperçu vivant suit le réglage ; une ligne d'explication dit ce que donnerait « Comme dans la colonne » pour la mesure choisie (`format.columnModeState` : `ok` / `none` / `unknown` / `count`). La configuration porte `tile.numberFormat = {mode: 'column'}` ou `{mode: 'custom', decimals, notation}`. Lecture des options : `GristBI.api.readColumnFormats(tableId)` (`js/grist-api.js`) lit le type et `widgetOptions` de chaque colonne dans `_grist_Tables_column` et `documentSettings` dans `_grist_DocInfo` ; `js/main.js:refreshColumnFormats` l'appelle à chaque `switchTable` (registre vidé au changement de table, pour qu'une colonne de même nom d'une autre table ne reprenne pas son format) puis `GristBI.format.setColumnInfo`.

**Choix assumés** : (1) « Comme dans la colonne » reprend aussi la **locale du document** (séparateurs de Grist) et non celle de l'interface — c'est ce que « comme dans la colonne » veut dire ; Automatique et Personnalisé suivent la langue de l'interface. (2) Une colonne sans réglage de décimales dans Grist reste en Automatique (sinon Grist afficherait jusqu'à 10 décimales, le défaut que ce lot corrige) ; ses autres options (devise, %) sont reprises. (3) Un comptage n'a jamais le format d'une colonne. (4) Une mesure fusionnée par data blending (`Table.colonne`), une colonne dérivée (`Date.Annee`) ou une table sans lecture possible : Automatique, sans erreur. (5) Les libellés d'axe restent compacts (3 chiffres significatifs) quel que soit le mode : la précision se lit dans l'infobulle et la valeur. (6) La table plate (autre fil, `format.cellNumber`) a le même champ : « Comme dans la colonne » y donne à CHAQUE colonne numérique son propre format (vérifié : « 100 000,23 € », « 10 », « 10,0 % » sur trois colonnes), « Personnalisé » s'applique à toutes.

**Non vérifié** : la forme exacte de `_grist_Tables_column.widgetOptions` et de `_grist_DocInfo.documentSettings` dans un vrai Grist (JSON texte, clés `numMode`/`currency`/`decimals`/`maxDecimals`/`numSign`, `locale`/`currency`) est celle de la documentation et du comportement connu du moteur, jamais confirmée sur un document ouvert ; le mock (`dev-tests/grist-stub.js`) a reçu `widgetOptions` et `_grist_DocInfo` d'après cette même hypothèse. À confirmer à la console d'un vrai widget : `JSON.stringify(await grist.docApi.fetchTable('_grist_DocInfo'))` et `fetchTable('_grist_Tables_column')`. Si la forme diffère, la lecture retombe sur Automatique sans erreur (vérifié contre un mock qui lève).

### Tuiles usuelles des outils BI — lot 1, tuile Texte (18/11/2026)

Étude de départ : `etudes/tuiles-usuelles-dashboard-2026-11-18.md` (fil « Lister les tuiles usuelles de
dashboard »), dont Antoine a demandé de coder les lots 1 puis 2 à la suite, une PR par fonctionnalité, le format
des nombres étant laissé au fil « Rendre les valeurs lisibles sur chaque tuile » (déjà fusionné).

- **Ce que c'est** : type `text`, une note SANS donnée (titre de page, mode d'emploi, source, légende), ni dimension ni
  mesure ni agrégat ; non filtrable, non cliquable, sans « Détail ».
- **Sécurité** : le widget tourne en accès `full`, un texte saisi ne doit JAMAIS devenir du HTML brut.
  `GristBI.data.renderTextHtml` échappe d'abord (`escapeHtml`) puis ajoute une liste fermée de balises
  (`h3`, `h4`, `p`, `ul`/`li`, `strong`, `br`) à partir de quatre repères : `# ` (titre), `## ` (sous-titre),
  `- ` ou `* ` (liste), `**gras**` ; une ligne vide sépare les paragraphes. `<img onerror>` et `<script>` saisis
  s'affichent comme du texte, vérifié dans l'aperçu et dans la tuile. Plafond de 2 000 signes (`TEXT_TILE_MAX`).
- **Exports** : Excel sans feuille pour une note (une note n'est pas un tableau ; `tileExportSheet` rend quand même une feuille
  d'une cellule si on l'appelle sur elle), PDF et PPTX avec le texte brut (`plainTextOf`, « - » -> « • »).
- **Conseil/accueil** : `'text'` est volontairement HORS de `advice.TILE_TYPES` (ce sont les types qui agrègent une colonne) ;
  la carte de type a sa ligne d'usage (`USE_KEYS.text`), `adviceForTile('text')` rend `null`, `suggestTiles` n'en propose jamais.
- **Testé** : Node (`dev-tests/test-data.js`, bloc « tuile Texte ») ; Playwright contre le vrai `index.html` +
  `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">` (clics réels : Ajouter > carte Texte > saisie >
  « Ajouter la visualisation » ; `submit` ne part jamais dans ce cadre, c'est `bindFormSubmit`). **Pas testé dans un vrai
  Grist ni dans un vrai GFS.**

- **Export Excel : ExcelJS 4.4.0 à la place de SheetJS 0.18.5** (18/11/2026, fil « Appliquer la nouvelle consigne GFS », consigne 017) :
  - **Pourquoi** : SheetJS 0.18.5 a deux avis publiés (pollution de prototype GHSA-4r6h-8v6p-xvw6, expression régulière CVE-2024-22363) dont les
    versions corrigées ne sont qu'à `cdn.sheetjs.com`, REFUSÉ par la politique réseau de l'environnement de développement (403 ; `git.sheetjs.com` injoignable,
    `github.com/SheetJS` refusé ; npm n'a que la 0.18.5). La 017 proposait ExcelJS 4.4.0 (sans avis, celui de Publipostage+) en alternative « que le porteur
    tranche » : Antoine a choisi ExcelJS le 18/11 « pour harmoniser les dépendances ». Aucun miroir tiers de SheetJS sur npm n'a été pris.
  - **Provenance** : `npm pack exceljs@4.4.0`, intégrité de l'archive (`sha512-XctvKaEM…`) = celle du registre ; `dist/exceljs.min.js` (947 702 octets) a la MÊME
    empreinte SHA-384 (`Pqp51FUN2/…`) et est identique octet pour octet à la copie que GFS vendorise (`prototype/vendor/exceljs/4.4.0/`, son catalogue) ; un test Node
    refait le calcul. `js/vendor/exceljs/{exceljs.min.js,LICENSE}` (MIT) ; `js/vendor/xlsx/` supprimé. Les licences des paquets que ce bundle embarque (archiver,
    jszip, saxes, dayjs, uuid…) n'ont pas été relues une à une ; la copie de GFS pour la même version ne porte, elle aussi, que la licence MIT d'ExcelJS (`LICENCES.txt` chez lui).
  - **Changement de poids** : 881 727 -> 947 702 octets (+ 65 975, soit ~64 Kio) ; toujours chargé AU PREMIER EXPORT seulement (consigne 013 conservée) : vérifié
    dans un navigateur, aucune requête vers lui avant le clic, une seule après.
  - **Ce qui a changé dans `js/export.js`** : `cellValue` (nombre fini / texte / booléen / date / cellule vide pour null / cellule d'ERREUR `#NUM!`/`#DIV/0!`
    pour un nombre non fini — ExcelJS écrirait sinon `NaN` en clair et Excel proposerait de « réparer » le classeur —, BigInt -> nombre si sûr sinon texte,
    tout objet/tableau -> texte, texte plafonné à 32 767 signes), `buildWorkbook(ExcelJS, sheets)` (pur, testé sous Node avec le vrai paquet), téléchargement
    par `Blob` + ancre `download` (ce que faisait `XLSX.writeFile`). Auteur du classeur : « Grist BI ». **Les feuilles et leurs valeurs ne changent pas** : même
    `GristBI.data.buildWorkbookSheetsAsync`.
  - **Bug trouvé en route (latent avec SheetJS aussi)** : `sanitizeSheetName` ne comparait pas les noms sans tenir compte des majuscules — deux tuiles « Ventes »
    et « ventes » donnaient deux feuilles « identiques » pour Excel (ExcelJS lève `Worksheet name already exists`, SheetJS levait déjà son équivalent) ; une
    apostrophe en début/fin de nom et le nom réservé « History » faisaient lever ExcelJS. Corrigé (unicité insensible à la casse, apostrophes retirées, « History »
    évité) avec ses tests.
  - **Texte qui ressemble à une formule** (réponse à la consigne 005, voir GFS-ETAT.md) : revérifié avec ExcelJS — `=SUM(A1)`, `+cmd|x`, `@x` sont écrits comme chaînes
    partagées, 0 balise `<f>` dans le XML du classeur ; ExcelJS ne pose une formule que pour un OBJET `{ formula }`, que `cellValue` ne laisse jamais passer.
  - **Testé** : Node (le vrai paquet vendorisé : cellules, relecture, XML, noms de feuille, chaîne `buildWorkbookSheetsAsync` -> classeur) + Playwright contre le
    vrai `index.html` et le faux Grist : clic sur « Exporter en Excel » -> téléchargement `dashboard-bi.xlsx` (11 Ko), relu : une feuille par tuile (texte exclu),
    la tuile YTD (DuckDB) avec ses 60 vraies valeurs, chargement paresseux. **Cadre isolé** : dans un `<iframe sandbox="allow-scripts">` SEUL aucun téléchargement ne
    part (Chromium), avant (SheetJS, même constat sur `origin/main`) comme après ; avec `allow-downloads` il part. Le cadre de GFS déclare
    `allow-scripts allow-forms allow-popups allow-modals allow-downloads` (`prototype/js/broker/frames.js:8`, `docs/cahier-des-charges-gfs.md:185`, lus) : le
    téléchargement devrait donc partir dans GFS, **non rejoué dans le vrai GFS**. **Non vérifié** : un vrai Grist ; l'ouverture du classeur dans Excel/LibreOffice
    (relu seulement par ExcelJS et par inspection du XML) ; les exports PDF/PPTX dans un cadre sans `allow-downloads` (même mécanisme, non essayé).

### Tuiles usuelles des outils BI — lot 1, table plate (18/11/2026)

- **Ce que c'est** : type `table`, `tile.columns` (au moins une) = les colonnes cochées dans le formulaire, dans l'ordre des
  flèches ▲▼ ; une ligne par ligne de la table de travail après les mêmes filtres que le bouton « Détail » (`rowsForTile`) ;
  aucune agrégation, ni dimension, ni mesure.
- **Tri** : un clic sur l'en-tête (croissant, décroissant, ordre d'origine) est un état de LECTURE, gardé par id de tuile dans
  `js/charts.js` et jamais écrit dans la configuration : une personne qui lit le tableau de bord ne modifie pas la tuile des
  autres, comme pour le chemin de drill-down. Il s'applique à TOUTES les lignes avant la coupe d'affichage (500).
- **Choix de format des nombres** : Automatique = la donnée brute (`GristBI.format.cellNumber`), parce que le format Automatique
  des chiffres clés (« 2 024 », milliers dès 1 000) serait faux pour une année, un code postal ou un identifiant. Un format
  choisi pour la tuile (`custom`, ou « comme dans la colonne ») s'applique, avec le lot du fil « valeurs lisibles ».
- **Pas de cross-filtre au clic d'une ligne** (décision de départ, à rouvrir si Antoine le veut) : une ligne n'est pas une catégorie,
  et un clic de cellule qui poserait un filtre `=` sur n'importe quelle colonne numérique serait surprenant ; le filtre avancé couvre
  ce besoin.
- **Exports** : Excel jusqu'à 100 000 lignes dans l'ordre des colonnes de la tuile ; PDF 200 lignes, PowerPoint 12 (une
  diapositive), avec une ligne « … N lignes de plus (voir l'export Excel) ».
- **Bug réel trouvé en chemin** (voir TEST_PROTOCOL.md n°41, CLAUDE.md §7 n°24) : changer le TYPE d'une tuile en édition gardait
  l'élément DOM de l'ancien type. Corrigé pour tous les types (`render()` recrée l'élément quand `dataset.tileType` diffère).
- **Testé** : Node (bloc « tuile Table » de `dev-tests/test-data.js`) ; Playwright contre le vrai `index.html` + `grist-stub.js`,
  page directe et `<iframe sandbox="allow-scripts">` (clics réels : carte Table, cases, flèches, tri, plafond à 1 200 lignes,
  édition, Excel, anglais). **Pas testé dans un vrai Grist ni un vrai GFS ; types Grist exotiques (Attachments, Reference
  résolue, ChoiceList) vus seulement par leur forme supposée** (`cellText`).

### Lisibilité des valeurs sur les tuiles — lot 4 : thème sombre, infobulles, libellés (18/11/2026)

Dernier lot de l'audit : tout ce qui, hors des nombres eux-mêmes, rendait une tuile peu lisible. Constats faits sur le jeu d'audit (tuiles de ~330 px, libellés de 44 caractères, 24 catégories) en clair, en sombre et en anglais.

**Cause commune** : `js/charts.js` ne donnait à ECharts que des couleurs de série ; tout le reste (quadrillage, traits d'axe, fond et texte de l'infobulle, contour des étiquettes de camembert/entonnoir, bandes du radar) venait du thème clair d'ECharts, blanc éclatant sur fond sombre, et les libellés longs n'étaient jamais bornés à la place disponible.

**Fait** (`js/charts.js:finalizeOption`, appelée avant chaque `setOption`) : infobulle aux jetons CSS, 12 px, qui se replie (85 % de la tuile au plus) ; quadrillage, traits et libellés d'axe aux jetons ; libellés de catégorie tronqués à la largeur d'une catégorie (tous visibles jusqu'à 8 catégories, sinon un sur k avec plus de place) ; graduations de l'axe horizontal en nombre raisonnable (6 au plus, moins en étroit) ; camembert/entonnoir sans contour blanc, entonnoir en deux lignes (nom tronqué, valeur toujours visible) ; radar aux jetons, noms d'axe tronqués à un tiers de la tuile ; nuage de mots : le message « indisponible » n'était qu'en bas d'un `<canvas>` de 150 px, tuile vide. `js/main.js:watchChartTheme` refait un rendu quand les jetons lus changent (système clair/sombre, ambiance de GFS posée sur `<html>`), par comparaison d'une signature, jamais à chaque mutation de `<html>` (`--chrome-h` y est réécrit en continu).

**Choix assumés** : (1) Radar « colonnes » : l'échelle reste PARTAGÉE par tous les axes (voulu : des compétences notées sur 20 ne se comparent qu'entre elles) ; des colonnes d'ordres de grandeur très différents (rapport de 20 ou plus entre les moyennes) reçoivent un avertissement (`advice.radar.mixedScales`) au lieu d'une normalisation par axe qui rendrait toute comparaison trompeuse. (2) Avec beaucoup de catégories, le nom d'un axe est tronqué à 70 px et ECharts n'en affiche qu'un sur k : la solution est « Barres horizontales » (déjà conseillée), pas de réduire la police. (3) Un camembert de 24 parts reste illisible par nature : le conseil existant (au-delà de 7 parts) le dit.

**Vérifié** : voir TEST_PROTOCOL.md. **Non vérifié** : rendu dans un vrai Grist/GFS (ambiance réelle du kit : seul le même mécanisme, un jeton posé sur `<html>` par le CSSOM, a été reproduit) ; lecteur d'écran sur les graphiques.

### Tuiles usuelles des outils BI — lot 1, KPI enrichi et tuile Progression (18/11/2026)

- **Carte KPI** (rien ne change pour une carte existante : tout est facultatif) : `tile.kpiSparkline` (case « Tracer la courbe de la tendance »,
  visible seulement avec une dimension « Tendance vs »), `tile.target` (valeur saisie) ou `tile.targetColumn` (colonne agrégée par le même
  agrégat que la mesure, prioritaire), `tile.goodPct`/`tile.warnPct` (écrits seulement s'ils diffèrent de 90/60). La courbe est un SVG maison, pas une
  instance ECharts (rien à disposer) ; ses points sont les groupes de la dimension de tendance (années triées, sinon ordre des données).
  Le calcul des groupes est partagé avec le delta (un seul `computeGroupBy`, DuckDB au-delà de 5 000 lignes). L'ajustement de police de la valeur
  (`--kpi-chars`, lot jauge/KPI de l'autre fil) est conservé tel quel.
- **Tuile Progression** (`type: 'progress'`) : dimension + mesure + agrégat, objectif commun OU colonne d'objectifs agrégée PAR catégorie (une catégorie
  sans objectif n'a pas de barre, « – »). Un objectif nul ou négatif est refusé (division par zéro, « % atteint » inversé). Cliquable comme une barre de
  graphique (filtre croisé, re-clic = retire, les autres lignes s'estompent) ; pas de drill-down, pas de tri (l'ordre des données).
- **Couleurs** : jamais seules (le pourcentage est écrit à côté, la barre porte `role="progressbar"` et un nom accessible) ; vert/orange/rouge = couleurs
  d'état du widget (`--good`, nouveau `--caution`, `--critical`), jamais celles d'une ambiance GFS.
- **Pas fait, à décider** : « objectif qui baisse = mieux » (coûts, délais : 120 % est mauvais), objectif par période sur la courbe, courbe lissée (lot 2).
- **Testé** : Node (bloc « objectif KPI, courbe, Progression » : niveaux et bornes, flottants, `BigInt`, lignes par catégorie, géométrie SVG, exports) ;
  Playwright contre le vrai `index.html` + `grist-stub.js`, page directe (formulaire, validations, aperçu, clic/clavier, édition, anglais, Excel) et
  `<iframe sandbox="allow-scripts">`, y compris 6 000 lignes servies avec CORS (DuckDB réel : valeurs `BigInt`). **Pas testé dans un vrai Grist ni un vrai
  GFS.**

### Tuiles usuelles des outils BI — lot 2, combo barres + courbe à double axe (18/11/2026)

- **Tuile « Barres + courbe »** (`type: 'combo'`, PR 4 du plan de l'étude, §4.2) : une dimension, des barres (axe de gauche, `measure`/`aggFn`) et une courbe
  (axe de droite). Deux modes (`tile.comboMode`) : « autre mesure » (défaut, absent de la configuration) = `measureY` + `aggFnY` (écrit seulement s'il diffère de
  `aggFn`) ; `'pareto'` = barres du plus grand au plus petit et courbe = part CUMULÉE du total en % sur un axe fixe 0-100 avec un repère pointillé à 80 %.
- **Décisions** : Pareto = pas de seconde mesure (elle se déduit des barres), pas de tri réglable (l'ordre fait la méthode), les valeurs négatives ou absentes
  comptent pour 0 dans la part (conseil `advice.combo.paretoNegative`), dernier point exactement 100, une moyenne/min/max est signalée (`paretoAgg` : ça ne se
  cumule pas). Pas de colonne Séries ni d'empilé sur un combo (deux axes + séries multiples = illisible dans 270 px). Légende = noms de colonnes seuls (« Montant »,
  « Quantité ») ; l'agrégat n'y est ajouté que si les deux séries portent la même colonne. Clic sur n'importe quelle série = drill-down / filtre croisé de la
  catégorie (gestionnaire générique).
- **Pas fait, à décider** : courbe sur l'axe de gauche (un seul axe), seuil Pareto réglable (80 % fixe), deuxième courbe, barres empilées + courbe.
- **Testé** : Node (bloc « combo barres + courbe » : Pareto, alignement par nom avec `BigInt`, tri, export, valeurs par défaut, conseil, i18n) ; Playwright contre le
  vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">` (carte, formulaire prérempli, ordre des champs, clic sur une barre, passage
  en Pareto et retour, erreur sous le champ, 6 000 lignes servies avec CORS : DuckDB réel), anglais. **Pas testé dans un vrai Grist ni un vrai GFS.**

### Audit `gwaudit` — lot 3 : revue des `innerHTML` et correction de l'injection par l'identifiant de tuile (18/11/2026)

- **Pourquoi** : la règle C-XSS-01 de l'outil (`innerHTML` dynamique) ne dit pas si un cas est exploitable ; elle demande une revue. Les 24 endroits du code de ce dépôt qui
  écrivent du balisage à partir d'une donnée ont été lus un à un (filtres, onglets de pages, pastilles, liste des vues, en-tête de tuile, commentaires, fenêtre de détail,
  imports Power BI/CSV, sélecteur de colonnes, tuile Texte, table plate, pivot, fil d'Ariane, carte d'accueil, liste du combobox). Toute **valeur de cellule** et tout **nom**
  (colonne, page, vue, titre) passe déjà par `escapeHtml`, qui échappe `& < > " '`. **Un seul cas exploitable** : l'identifiant d'une tuile.
- **Bug réel n°45** (voir TEST_PROTOCOL.md n°45) : `data-tile-id="${tile.id}"` (`js/main.js:buildTileElement`) et ~14 sélecteurs `[data-tile-id="${tile.id}"]` (`js/charts.js`) recevaient un
  id relu tel quel de `BI_Dashboard_Config`. Une ligne de configuration écrite par quelqu'un d'autre (un rapport partagé : consignes GFS 005 et 012) pouvait donc exécuter du
  script dans le widget, qui a l'accès `full`. **Reproduit avant correction** avec une ligne hostile préremplie dans le faux Grist (`window.__xss = 1`, deux nœuds injectés).
- **Correctif** : `js/state.js:sanitizePages` (appelé par `store.setPages`, le seul chemin par lequel une configuration entre dans l'état) remplace tout caractère hors
  `[A-Za-z0-9_-]` d'un id de tuile par `_`, donne un suffixe aux doublons, écarte une « tuile » qui n'est pas un objet et tolère une page sans `tiles`. Les ids que ce widget
  fabrique (`tile_…`, `page_default`, `__preview__`, `stress_…`) ne changent pas : la MÊME référence est rendue, donc aucune sauvegarde au chargement (garde-fou GFS 009).
  En plus : `escapeHtml(tile.id)` dans le balisage, et `escapeHtml` sur les valeurs formatées du pivot (défense en profondeur ; un format de colonne ne produit que des chiffres).
- **Décision à laquelle on est arrivé** : on n'assainit PAS les ids de pages ni de vues : ils étaient déjà échappés partout où ils sont écrits et ne servent jamais de sélecteur.
  Les filtres, drill-downs et vues qui citaient l'ancien id d'une tuile renommée deviennent orphelins (ils ne ciblent plus rien) : c'est voulu, un id forgé n'est pas un id légitime.
- **Pas fait** : les sélecteurs de `js/charts.js` restent des gabarits `[data-tile-id="${tile.id}"]` (un id ajouté par `addTile` avec un caractère hostile les ferait lever) ; aucun code
  de ce widget n'en produit, seules les configurations relues passent par `setPages`. Les passer à `CSS.escape` serait une défense de plus.
- **Testé** : Node (`dev-tests/test-data.js`) ; Playwright contre `dev-tests/harness.html` (ligne `BI_Dashboard_Config` hostile, avant/après) et contre `index.html` (aucune erreur au
  chargement). **Pas testé dans un vrai Grist ni un vrai GFS.**

### Correctifs avant l'alpha — carte KPI sans objectif (18/11/2026)

- **Défaut** : sous toute carte KPI sans objectif s'affichait une piste grise vide (8 px de `.goal-bar` + ligne de texte vide). Cause : `.tile-kpi-goal { display: flex }`
  bat `[hidden]` (piège n°10) alors que le rendu cache bien l'élément. Vu en préparant les captures du brouillon d'annonce forum, pas rapporté par un utilisateur (bug réel n°46, TEST_PROTOCOL.md).
- **Correctif** : `.tile-kpi-goal[hidden] { display: none; }`. Même défaut possible sur tout élément qui cumule un `display` de feuille et `hidden` posé par le JS :
  `.tile-kpi-spark` (sans `display` propre) n'est pas concerné ; le bloc de test ne vérifie que ces deux-là, pas un balayage général de la feuille.
- **Testé** : Node (règle présente, piste créée cachée, `renderKpi` la cache/montre) ; Playwright contre le vrai `index.html` + `grist-stub.js` SANS le correctif injecté
  dans les captures. **Pas testé dans un vrai Grist.**

### Correctifs avant l'alpha — « Nuage de mots » plus proposé sans d3-cloud (18/11/2026)

> **Remplacé le 18/11/2026 par la consigne GFS 019 (section suivante) :** la carte n'est plus retirée mais GRISÉE, et d3-cloud ne vient plus de l'importmap mais de GFS. `importMapHas` et `isWordCloudAvailable` n'existent plus.

- **Pourquoi** : la carte « Nuage de mots » de « Ajouter une visualisation » créait une tuile qui n'affichait que « indisponible pour le moment » (d3-cloud attend GFS,
  GFS-ETAT.md). Pour l'alpha standalone, on ne propose pas un type qui ne marche pas.
- **Comment** : `GristBI.charts.isWordCloudAvailable()` lit l'`importmap` d'index.html (`GristBI.data.importMapHas`, pure) : sans entrée `d3-cloud`, le navigateur
  rejetterait de toute façon `import('d3-cloud')` sur-le-champ, la réponse est donc la même sans rien charger. `renderTypeCards` (js/main.js) retire alors la carte ;
  **ajouter `d3-cloud` à l'importmap suffit à la faire revenir** (rien d'autre à changer, hormis le test « index.html : d3-cloud pas encore déclaré »).
- **Gardé volontairement** : la carte reste visible quand on modifie une tuile Nuage de mots déjà enregistrée (« Changer de type » la montre cochée) ; le `<select>`
  caché garde l'option (relecture d'une tuile enregistrée) ; une tuile déjà enregistrée garde son message « indisponible » ; `advice.js` ne propose jamais de nuage de
  mots à l'accueil (`suggestTiles`). Un appel direct à `GristBI.openTilePanel({ type: 'wordcloud' })` n'est pas bloqué.
- **Testé** : Node (`importMapHas` : présent/absent/illisible, câblage lu dans la source, importmap réel d'index.html) ; Playwright contre le vrai `index.html` +
  `grist-stub.js` : 15 cartes sans d3-cloud, 16 avec une entrée d'importmap ajoutée à la volée, carte conservée en modifiant une tuile Nuage de mots. **Pas testé dans un vrai Grist.**

### Extensions de GFS — « Nuage de mots » grisé et branché sur d3-cloud de GFS (consigne 019, 18/11/2026)

- **Ce que GFS a fait** (consigne 019) : `d3-cloud` (2.0.0, ESM seul) est dans sa liste en forme `module`, servi par GFS seul ; deux extensions de Grist-BI sont déclarées dans son manifeste, `nuage-de-mots` et
  `mots-cles-pdf` (pdf.js, la même copie que Publipostage+). L'app les reçoit par `GfsLink.library(id)` = `{ src, integrite, forme: 'module' }` ou `null`, charge `src` par `<script type="module" integrity
  crossorigin="anonymous">` et lit `GfsPaquets['d3-cloud'].modules['d3-cloud'].default` (la classe `CloudLayout`). Plus d'`import('d3-cloud')`, plus d'entrée d'importmap (il n'y en avait pas).
- **Ce qui est fait ici** : `js/extensions.js` (UMD, chargé entre `data.js` et `charts.js`) : `stateFor`/`stateOf` (`standalone` = app seule, `inactive` = dans GFS sans l'extension, `active`), `moduleFrom`,
  `load(id)` (null sans l'extension, même si son fichier est déjà en mémoire : une extension RETIRÉE en cours de route se grise comme au démarrage suivant), `requestInstall(id)` (`GfsLink.install` quand
  hébergée, `'standalone'` sinon : l'appelant montre la fenêtre du grisé), `attach(promesse du lien)` et `onChange` (réveillé quand GFS a répondu ET à chaque événement `extensions`, jamais en app seule).
  `js/charts.js:loadD3Cloud` = `GristBI.extensions.load('nuage-de-mots')`. `js/main.js` : la carte « Nuage de mots » reste dans « Ajouter une visualisation », **grisée** (`aria-disabled`,
  `.type-card-locked`, trait en tirets, jamais d'opacité) avec « Pas encore : extension « Nuage de mots » à ajouter » (dans GFS) ou « Pas encore : disponible dans Grist Factory Suite » (seule) ;
  un clic ne choisit pas le type : dans GFS il appelle `GfsLink.install('nuage-de-mots')` (la fenêtre « Apps et extensions » s'ouvre sur sa ligne), seule il ouvre la fenêtre du grisé du guide (section 5,
  `ext.standalone.*`). Un changement d'état repeint toutes les tuiles et refait les cartes. Une tuile enregistrée sans l'extension écrit `chart.wordCloudNeedsExtension` / `chart.wordCloudNeedsGfs`.
  `importMapHas` (js/data.js) et `isWordCloudAvailable` (js/charts.js) sont supprimés.
- **Vérifié l'API 2.x** : `placeWordCloud` utilise `new CloudLayout().size([w, h]).overflow(false)`, `layout.getSprite(texte, { size, font, padding, rotate })` et `layout.place(sprite)`, les mots du plus grand au
  plus petit : exactement la suite que la consigne décrit (jamais l'ancienne `cloud().words().on('end').start()`). Joué cette fois avec le VRAI paquet (voir « Testé »).
- **Testé** : Node (`dev-tests/test-data.js`, bloc « Extensions de GFS ») : états (seule, hébergée sans, avec, source sans empreinte, extension inconnue), `moduleFrom`, `load` avec un faux `document` (balise
  `type=module`, `src`, `integrity`, `crossOrigin='anonymous'`, pas de deuxième balise, rien chargé sans extension), événement `extensions`, retrait, `requestInstall` (install appelé, annulation sans exception,
  seule -> `'standalone'`), câblage lu dans les sources (aucune carte retirée, importmap sans bibliothèque d'extension, aucune adresse en dur). Playwright : le vrai `index.html` dans un
  `<iframe sandbox="allow-scripts">` servi par un FAUX GFS parent qui parle le vrai kit 0.24.0 (contexte avec `extensions`/`bibliotheques`, appel `installer`, événement `extensions`), avec le **VRAI d3-cloud 2.0.0**
  (tarball npm, intégrité sha512 comparée à celle du registre) assemblé en fichier de forme `module` comme la consigne le décrit : app seule (carte grisée, fenêtre du grisé), dans GFS sans l'extension (carte grisée,
  appel `installer { extension: 'nuage-de-mots' }`, tuile enregistrée = message), l'extension ajoutée SANS rechargement (carte dégrisée, tuile repeinte : 68 000 px encrés), retirée (message de retour),
  extension déjà active au contexte (nuage de 250 x 162 px dessiné). Aucune erreur de console, aucune politique de contenu touchée.
- **Pas vérifié** : le fichier `d3-cloud` de GFS lui-même (fixture à moi, assemblée d'après la description de la consigne ; les octets, l'empreinte et l'adresse réels sont ceux de GFS), la fenêtre « Apps et extensions »
  de GFS, un vrai Grist. **Le texte de la fenêtre du grisé** est celui du guide (section 5, « proposition ») moins l'adresse de GFS : le guide ne donne pas d'adresse définitive et dit lui-même que les mots exacts du
  panneau de Grist restent à relever dans un vrai Grist (question posée à GFS dans `GFS-ETAT.md`). **`mots-cles-pdf` n'est PAS branché** : `js/pdf-text.js`/`js/keywords.js` ne sont chargés par aucune page ; c'est
  le fil « Recherche sémantique sur publications » qui les branche (il reçoit pdf.js par `GristBI.extensions.load('mots-cles-pdf')` ; pdf.js tourne DANS la page : lire les pages une à une, en rendant la main).

### Tuiles usuelles des outils BI — lot 2, histogramme (18/11/2026)

- **Tuile « Histogramme »** (`type: 'histogram'`, PR 5 du plan de l'étude, §4.3) : la répartition d'UNE colonne numérique (`tile.measure`) en classes de même largeur,
  un nombre de lignes par classe. Ni dimension ni agrégat (la tuile compte des lignes) ; `tile.bins` facultatif (vide = automatique).
- **Classes** : nombre automatique par la règle de Sturges (log2(n) + 1, entre 5 et 20) ; largeur ARRONDIE à 1, 2 ou 5 x 10^n (des classes 0-5, 5-10 plutôt que 0-4,76) — un
  nombre de classes saisi est donc indicatif, borné à 2-60 ; une colonne d'entiers n'a jamais de classe plus étroite que 1 ; classe [bas ; haut[, la dernière fermée à
  droite ; valeurs vides, texte et booléens ignorés (jamais comptés comme 0). Les lignes ignorées ne sont pas affichées (le total des barres peut être inférieur au nombre de
  lignes) : à décider si une mention est utile.
- **Écart avec l'étude** : le plan disait « `floor((x-min)/pas)` côté DuckDB au-delà de 5 000 lignes ». Fait en JS pur à tout volume : un seul passage sur les lignes coûte
  moins que la sérialisation CSV vers DuckDB (et évite le piège des `BigInt`) ; testé à 6 000 lignes.
- **Filtre croisé par plage** : un clic sur une classe pose un filtre `range` (`store.toggleRangeFilter`), borne haute exclue sauf dernière classe ; la même classe le retire, une autre le
  remplace, un filtre d'égalité sur la colonne est remplacé. L'histogramme reste affiché en entier (classe cliquée en couleur, les autres estompées), les autres tuiles sont filtrées ;
  la pastille dit « Montant : de 80 à moins de 100 ». **Correction au passage** : `matchesFilter('range')` prenait une cellule vide pour 0 ; elle ne passe plus jamais une plage
  (change aussi les filtres avancés de plage : une ligne sans valeur n'est plus retenue par « de -5 à 5 »).
- **Grille stable** : les classes viennent de TOUTES les lignes, les comptes des lignes visibles ; filtrer ailleurs fait rétrécir les barres sans déplacer l'axe.
- **Pas fait, à décider** : courbe de densité, classes de largeur inégale, bornes saisies à la main, choix d'afficher la part en % plutôt que le nombre, colonne de dates (classes
  de temps : ce sera la tuile Calendrier).
- **Testé** : Node (bloc « histogramme » : pas ronds, bornes sur 4 jeux de données dont flottants et négatifs, cohérence classe/filtre, store, export, conseil, i18n) ; Playwright contre
  le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">` (formulaire, clic sur une classe, effet sur une tuile Barres, re-clic, filtre d'une autre
  tuile, édition, valeur invalide, 6 000 lignes servies avec CORS). **Pas testé dans un vrai Grist ni un vrai GFS.**


### Correctifs avant l'alpha — l'assistant préfère un montant à un prix unitaire (18/11/2026)

- **Défaut** (bug réel n°47, TEST_PROTOCOL.md) : sur la table de démo, les cartes d'accueil, le préremplissage du formulaire et le KPI prenaient `PrixUnitaire` en somme au
  lieu de `Montant`. Cause : le classement des mesures de `js/advice.js:analyzeColumns` ne regarde que les valeurs (type, négatifs, cases vides) puis l'ordre des colonnes.
- **Décision** : un nom de colonne dit « prix par unité » (`isUnitPriceName` : Prix, PrixUnitaire, unit_price, Tarif, PU, Prix HT, Prix de vente, Coût unitaire…) -> -3 points
  de classement ET moyenne au lieu de somme (`aggFor`). Un mot de montant dans le nom (« Prix total », « Montant ») annule l'indice. Même famille que `AVERAGE_NAME_RE`
  (note, taux…) : un indice tiré du nom, jamais une certitude ; la personne garde la main dans le formulaire.
- **Ce qui ne change pas** : un prix reste une mesure (seul, il est proposé, en moyenne) ; une quantité garde son rang (« Quantité » avant « Montant » si elle vient
  en premier et n'est pas un petit entier ambigu) — on ne préfère PAS un montant à tout, seulement à un prix par unité.
- **Pas fait, à décider** : repérer un montant par son nom (bonus à Montant/Total/CA) ; repérer `Montant ≈ Quantité × Prix` dans les valeurs ; autres noms de prix
  (langues autres que fr/en).
- **Testé** : Node (noms reconnus/épargnés, ordre des mesures pour 4 ordres de colonnes, montant à retours/cases vides, « Prix total », prix seul moyenné, suggestions et
  préremplissage) ; Playwright contre le vrai `index.html` + `grist-stub.js` sur la démo v3 anonymisée. **Pas testé dans un vrai Grist.**

### Correctifs avant l'alpha — onglets de page rognés avec une vue suivie (18/11/2026)

- **Défaut** (bug réel n°51, TEST_PROTOCOL.md) : quand une vue est suivie, son nom s'écrit dans le bouton Vues (186 px au lieu de 52). Les onglets de page sont le seul élément de la barre qui
  rétrécit : « Segments » était coupé à 1100 et 1200 px (3 pages), et réduit à une lettre avec 4 pages. En plus, le fondu de bord qui dit « il y a d'autres onglets » restait faux, car
  `renderPageTabs` le calculait AVANT que `renderBookmarks` ne pose le nom de la vue.
- **Décision** : les onglets sont la navigation, le reste de la barre s'allège avant eux. Deux paliers, essayés dans l'ordre : (1) le nom de la vue disparaît du bouton (rien n'est perdu : la
  pastille « Vue » de la rangée des filtres, le point « modifiée » du bouton et son nom accessible le disent aussi) ; (2) les libellés des boutons disparaissent (icônes seules, comme sous 900 px),
  seulement si les onglets tiennent alors. Un palier qui ne suffit pas est abandonné : avec beaucoup de pages les boutons gardent leur texte et les onglets défilent, avec le fondu, maintenant juste.
  Le choix est une fonction pure (`GristBI.appbar.fitTabsLevel`) qui part toujours de la barre complète : le résultat ne dépend que des largeurs, jamais de l'état précédent (pas de
  clignotement entre deux paliers).
- **Mesuré** (démo v3, vue « Focus En ligne » suivie) : onglets entiers à 1000, 1100, 1200 et 1400 px, en Lecture comme en Édition, en français comme en anglais, y compris en redimensionnant
  la fenêtre en direct ; le nom de la vue revient à 1400 px. Cas qui reste rogné, mais signalé par le fondu : 4 pages en mode Édition à 1200 px (231 px de place pour 431).
- **Correction du lendemain même** (bug réel n°52) : la première version ramenait l'onglet actif dans la vue par `scrollIntoView`, appelé à chaque redimensionnement ; il fait aussi défiler la page, et la barre étant collante, une capture pleine page laissait la page 232 px plus bas. `revealActiveTab` fait défiler la liste d'onglets seule (`scrollLeft`).
- **Pas fait, à décider** : un menu « … » pour les pages en trop (comme les onglets d'un navigateur) ; réduire la pastille de la table connectée (223 px à 1200 px) avant les libellés.
- **Testé** : Node (paliers, 2 x 41 besoins de largeur, ordre dans `render()`) ; Playwright contre le vrai `index.html` + `grist-stub.js`. **Pas testé dans un vrai Grist** (la largeur réelle du
  panneau d'un widget Grist n'est pas celle d'une fenêtre : le redimensionnement passe par l'événement `resize` de l'iframe, supposé).

### Correctifs avant l'alpha — légende du radar (18/11/2026)

- **Défaut** (bug réel n°50, TEST_PROTOCOL.md) : un radar à deux séries (élève et moyenne du groupe) a une légende ; dans une tuile normale (zone de dessin 283 x 162 px) elle recouvrait
  le nom de l'axe du haut et le polygone était minuscule. Vu en préparant les captures de l'annonce forum (qui utilisaient la tuile agrandie pour l'éviter).
- **Décision** : même méthode que la jauge, une géométrie pure en pixels (`GristBI.format.radarLayout`) plutôt qu'un réglage en pourcentages qu'ECharts ne sait pas tenir : la légende
  prend une bande de 24 px en haut, le polygone se centre dans le reste, son rayon laisse 8 px + 16 px pour le nom de l'axe du haut (sous la légende) et celui du bas. Le polygone d'une
  tuile normale passe de 50 à 45 px de rayon (il ne peut pas être plus grand si le nom de l'axe du haut doit tenir sous la légende), celui d'une tuile agrandie ne change pas
  (plafond historique de 62 %). La légende devient compacte et défilante (`type: 'scroll'`) : un nom d'élève long se parcourt par flèches au lieu de recouvrir le polygone.
- **Ce qui ne change pas** : un radar à une seule série n'a pas de légende et garde son réglage d'origine (centre 50 %, rayon 62 %).
- **Pas fait, à décider** : afficher le nom de l'élève tronqué par « … » plutôt que coupé net par le défilement ; une tuile de moins de 150 px de haut (non proposée par l'interface).
- **Testé** : Node (bloc « radar avec légende ») ; Playwright contre le vrai `index.html` + `grist-stub.js` sur le radar d'orientation de démo (400 élèves) : tuile normale, agrandie, réduite
  (le centre et le rayon suivent), tuile étroite avec un nom d'élève très long. **Pas testé dans un vrai Grist.**

### Correctifs avant l'alpha — noms d'axe du radar coupés par le bord de la tuile (18/11/2026)

- **Défaut** (bug réel n°53, TEST_PROTOCOL.md), vu en reprenant les captures du forum avec les nouveaux styles : sur le radar « CA par produit » (8 axes, tuile de 330 x 190), le nom de
  l'axe de GAUCHE, « Montre Connectée », avait sa première lettre coupée par le bord de la tuile. Il était déjà là sur les captures précédentes (Standard : « Montre Connect… » avec le « M »
  rogné) ; je ne l'avais pas vu. La règle d'origine tronquait tout nom d'axe à un tiers de la largeur de la tuile (`0,34 x largeur / 6,8` signes), quelle que soit la PLACE réelle : le sommet le
  plus à gauche d'un polygone de 62 % laisse, entre lui et le bord, un peu moins du tiers de la tuile (165 - 59 - 15 = 91 px sur 330 px), moins que ce que la règle autorisait (112 px).
- **Décision** : `GristBI.format.radarNameRoom(w, h, hasLegend, index, count)` (pure, testée) donne la place en pixels de chaque nom : un axe du HAUT ou du BAS est centré sur son sommet (presque
  toute la largeur), un axe de côté est posé à côté de son sommet et n'a que la place entre le polygone (rayon de `radarLayout` avec légende, 62 % du demi-côté sans légende) et le bord, écart de
  15 px (celui d'ECharts) ou de `radarLayout`. `js/charts.js:finalizeOption` coupe chaque nom à cette place, MESURÉE en pixels (`measureText`, 12 px par défaut), et relit la taille de l'instance à
  chaque appel : une tuile agrandie donne plus de place. Conséquence assumée : un nom long de côté est tronqué avec « … » (« Montre Conne… ») au lieu d'être coupé net ; en bas ou en haut il a plus de place.
- **Testé** : Node (bloc « radarNameRoom » : 7 tailles de zone, avec et sans légende, 3 à 12 axes, place bornée, le nom posé à côté de son sommet reste dans la tuile, l'ancien cas de 330 x 190) ;
  Playwright contre le vrai `index.html` + `grist-stub.js` : radar « CA par produit » en Console et en Standard (nom entier visible), radar d'orientation avec légende. **Pas testé dans un vrai Grist.**

### Vitrine GFS refaite avec les styles et les dispositions (18/11/2026)

- **Demande d'Antoine** : « refaire des screen pour le message du forum et les captures GFS en utilisant les styles différents ». Les trois images de `vitrine/` (remplacées une première fois le 18/11 pour la PR #53) montraient
  encore l'interface d'AVANT la refonte (barre de menus, panneau « Ajouter », styles, dispositions) : la « Limite » notée en tête de ce journal est donc levée. Mêmes noms (`1.webp`, `2.webp`, `3.webp`), mêmes 960 x 600,
  49 976 / 52 954 / 54 370 octets (WebP qualité 92 à 96, méthode 6), données du jeu d'exemple anonymisé (aucun nom de personne ; les commentaires sont de groupes). Prises depuis `main` à `29b7cbd` (styles #113, Soleil #112
  et noms d'axe du radar #114 compris).
- **Choix** : 1 = « Verre dépoli » + disposition « Planche » (vue d'ensemble : chiffres, jauge, barres, aire empilée) ; 2 = « Éditorial » en grille, clic sur « Nord » puis 2025 (filtre croisé : puces de filtre, barres non retenues grisées, drill-down
  de l'année vers le trimestre) ; 3 = « Console » (toujours sombre, page « Analyse avancée »). L'éditorial et la console ont été préférés au verre et au fluide pour le filtre croisé : en pastel, une barre à 0,3 d'opacité se distingue à peine de
  ses voisines. La tuile « Aire empilée » est retirée de la scène 2 (une aire filtrée sur une seule année n'a qu'un point) ; c'est un réglage de la capture, pas un défaut à corriger.
- **Retouches de cadrage** : 960 px de large (la barre perd ses libellés, mais on ne la voit pas : la capture démarre sous elle), image coupée à la tuile, jamais mise à l'échelle ; la scène 2 démarre juste sous la barre pour ne pas montrer le bas de ses boutons.
- **Réserve inchangée** : le vrai `index.html` + le faux Grist du dépôt, PAS un vrai Grist ; l'interface est celle qu'on verrait, le comportement de `grist.docApi` n'est pas prouvé. Les scripts de prise de vue ne sont pas committés (même règle que toute la suite
  Playwright) ; ils sont dans le dossier partagé du projet (`forum/captures-scripts/`). Il reste à GFS de recopier `vitrine/` chez lui (voir `GFS-ETAT.md`).

### Jauge : graduations à l'extérieur de l'arc (18/11/2026)

Point de départ : sur la capture « après » du lot 2 de l'audit de lisibilité, Antoine remarque que la jauge « semble perdre les graduations intermédiaires » et propose de les rajouter, « peut-être à l'extérieur ».

**Fait** : un trait de 4 à 8 px puis un libellé, SOUS FORME DE `graphic` ECharts, hors de l'arc (jamais dedans : c'est là qu'elles se chevauchaient entre elles et avec l'aiguille). Les valeurs sont des multiples d'un pas rond (1, 2, 2,5, 5 x 10^k : « 1 M, 2 M, 3 M » plutôt que « 825,5 k, 1,65 M »), jamais à moins de 8 % d'une extrémité (`GristBI.format.gaugeTicks`), libellées par `fmt.axis` comme les bornes (donc au format de la tuile, 3 chiffres significatifs, thème clair/sombre, fr/en). Leur place est réservée AVANT de dimensionner l'arc (`gaugeLayout(w, h, ticks)` : plus grand rayon pour lequel le libellé le plus haut et le plus déporté restent dans la zone, par dichotomie) : l'arc rétrécit d'environ 20 % (rayon 113 -> 87 px dans une tuile de 250 px) ; `gaugeTickBudget(r)` fixe le nombre maximal (0 sous 46 px, 5 au plus), et `gaugeOption` en retire (moins, puis aucune) plutôt que de faire descendre l'arc sous 72 % de sa taille sans graduations ou de laisser un libellé sortir de la tuile (`overflow`). `gaugeTickPlacement` (pure) donne le trait, l'ancre et l'alignement de chaque repère : charts.js et les tests partagent donc la même géométrie.

**Vérifié** : Node (valeurs rondes sur 10 plages x 5 plafonds, jamais plus que demandé, jamais -0 ni bruit de flottant, 7 tailles de tuile x 4 plages x 3 plafonds : libellés dans la zone, au-dessus de la ligne de base, hors de l'arc, sans recouvrement entre voisins, l'arc ne grandit jamais ; sans graduation la géométrie est exactement celle d'avant) ; rendu réel dans `index.html`/harnais : six jauges (somme, négative, 0-100, sans borne, valeurs minuscules, années) en clair, en sombre + anglais, à 340 px, agrandie. **Non vérifié** : rendu dans un vrai Grist/GFS. **Limite connue** (traitée ensuite, voir « Échelles d'entiers jamais compactées ») : une jauge dont les bornes sont des années (1990-2030) affichait « 2 k, 2,01 k, 2,02 k » parce que `axis` est compact dès 1 000.

### Échelles d'entiers jamais compactées : années, colonnes entières (18/11/2026)

Point de départ : la limite notée à la fin du lot « graduations de la jauge » (bornes 1990-2030 -> « 2 k, 2,01 k »), reprise sur consigne du coordinateur : « une valeur qui ressemble à une année, ou une colonne entière sans format, ne doit pas être compactée ».

**Cause** : `axis` est toujours compact (3 chiffres significatifs, `k`/`M` dès 1 000) — voulu pour les axes de valeurs d'ECharts, qui partent de 0 (vérifié : `scale: true` n'est utilisé nulle part, une échelle de 1990 à 2030 n'existe donc pas sur un axe ECharts) mais faux pour une échelle dont les bornes sont des années ou de petits entiers.

**Règle** (`GristBI.format.plainScale(lo, hi)`, pure) : une ÉCHELLE dont les deux bouts sont des entiers de moins de 5 chiffres (|valeur| < 10 000) s'écrit en toutes lettres : « 1990, 2000, 2010 », « 0, 1000, 2000, 3000 ». Le compact ne gagne que deux caractères sous 10 000 et fait perdre la lecture exacte ; au-delà (« 3,3 M ») il reste. **La décision porte sur l'échelle entière, jamais sur une valeur isolée** : sur un même axe « 1000 » à côté de « 1,5 k » se lirait comme deux unités. Pas de test « ressemble à une année » : la règle des 5 chiffres couvre les années (1000-9999) ET les colonnes entières sans format, sans seuil arbitraire. `f.forScale(lo, hi)` rend `{ axis, format }` : entiers sans compact ni séparateur de milliers (une année n'est jamais « 2 010 »), un non-entier garde `axis` (jamais arrondi à l'entier) ; `format` ne change que pour l'Automatique (devise, pourcentage, décimales choisies, parenthèses : inchangés).

**Branché** : jauge (bornes, graduations ET valeur lues sur la même échelle) et histogramme (les bornes de classes forment une échelle : « 1995 – 2000 » et plus « 2 k… »).

**Corrigé au passage** : les libellés de classes d'un histogramme (« 1998 – 2003 », deux nombres) étaient tronqués par `finalizeOption` à la largeur d'une barre (« 199… »), quel que soit le format ; ils ont maintenant une largeur fixée à 84 px, ECharts omet ceux qui se touchent.

**Non traité, volontairement** : une valeur isolée (carte KPI, infobulle) qui ressemble à une année reste « 2 010 » en Automatique — impossible de distinguer une année d'un compte à partir d'un seul nombre ; le réglage « Format des nombres » de la tuile (Comme dans la colonne, ou Personnalisé sans séparateur) existe pour ce cas. **Non vérifié** : rendu dans un vrai Grist/GFS.

### Tuiles usuelles des outils BI — lot 2, carte de chaleur et tableau croisé coloré (18/11/2026)

- **Tuile « Carte de chaleur »** (`type: 'heatmap'`, PR 6 du plan de l'étude, §4.5) : le MÊME calcul que le tableau croisé (`pivotTable`, DuckDB au-delà de 5 000 lignes), dessiné en
  cases colorées plutôt qu'en chiffres. Mêmes champs (dimension lignes, dimension colonnes, mesure, agrégat), même clic (filtre sur la ligne ET la colonne), pas de drill-down.
- **Couleur** : un dégradé séquentiel d'une seule teinte (`tile.palette` : bleu / orange / vert / gris ; « Standard » et « Okabe-Ito » donnent le bleu, dit sous la liste), 4 arrêts
  (blanc teinté, puis trois crans des dégradés déjà validés de `PALETTES`). Jamais l'arc-en-ciel. Légende continue sous la carte (bornes min et max, au format de la mesure).
  Une intersection sans donnée reste vide (pas la couleur du minimum) ; toutes les valeurs égales -> couleur du milieu.
- **Nombre dans la case** seulement quand elle mesure au moins 40 x 17 px (une tuile standard de 24 cases n'en écrit pas, la tuile agrandie oui) ; sinon dans l'infobulle. Texte noir pur
  ou blanc par case (contraste >= 4,5:1 sur toute la rampe : `#1a1a1a` tombait à 4,2:1 au pire cas, noir pur à 4,6:1).
- **Clic** : écart avec le tableau croisé existant, volontaire — deux `toggleFilter` consécutifs lèvent le filtre de la LIGNE quand on clique une autre case de la même ligne. La carte
  passe par `cellFilterToggles` (une case déjà sélectionnée retire ses deux filtres, sinon seuls ceux qui manquent sont posés). Le tableau croisé garde son comportement d'origine : à
  décider s'il doit adopter le même (changement visible pour qui s'en sert déjà).
- **Tableau croisé coloré** (`tile.pivotHeat`) : case à cocher « Colorer les cellules selon leur valeur » ; fond des cellules de DONNÉES seulement (ni totaux ni cases vides, un total
  écraserait l'échelle), même rampe, même texte noir/blanc, le nombre reste écrit. Sélection et survol deviennent des contours (le fond posé en ligne écrase ceux de la feuille).
  Une tuile sans la case garde exactement son rendu d'avant.
- **Pas fait, à décider** : échelle divergente (valeurs négatives autour d'un zéro), échelle par ligne ou par colonne, légende cliquable, étiquettes d'axe de toutes les cases quand
  elles sont étroites (ECharts en masque un libellé sur deux), carte « jour × heure » directe depuis une colonne de dates (ce sera la tuile Calendrier), couleur dans l'export
  Excel (la grille y est celle du tableau croisé, sans mise en forme).
- **Testé** : Node (bloc « carte de chaleur » : rampes, luminance monotone, contraste du texte balayé sur toute la rampe, grille, cellule sans valeur, `cellFilterToggles` + store, export,
  défauts, conseil, i18n, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">` (formulaire, pixel de chaque case lu
  dans le graphique = couleur calculée à 0 près, clic de case, 2e clic sur la même ligne, 3e clic qui retire, tableau croisé coloré, contour de la cellule active, retour au rendu
  d'avant, édition, thème sombre, 6 000 lignes servies avec CORS). **Pas testé dans un vrai Grist ni un vrai GFS.**

### Tuiles usuelles des outils BI — lot 2, ligne de repère (18/11/2026)

- **Option « Ligne de repère »** (`tile.refLine`, PR 7a du plan, §4.7) sur les **barres** (hors mode mesure temporelle) et la **courbe/aire** : un trait pointillé à une valeur, avec son libellé
  (« Moyenne 12,4 k » ou « Objectif 100 k », au format de la mesure). Deux genres : `average` = moyenne des valeurs AFFICHÉES (une par catégorie, après tri, drill-down et filtres croisés :
  elle bouge quand on filtre ailleurs) ; `value` = un objectif saisi (`tile.refValue`, zéro et négatifs admis ; sans nombre valide, le formulaire refuse et une configuration relue sans
  valeur ne trace rien).
- **Séries multiples et pile** : le repère se calcule sur la valeur agrégée par catégorie (le total pour une somme), pas par série — sur une pile, c'est la hauteur de la pile qui se compare
  à l'objectif. Pour une moyenne (`aggFn: 'avg'`) c'est donc la moyenne des moyennes de catégorie : à décider si on veut mieux.
- **Pas fait, à décider** : une ligne par série, une 2e ligne (objectif ET moyenne), repère sur le combo, l'histogramme ou la tuile Barres en mode mesure, une zone d'objectif (bande), un repère
  tiré d'une colonne (la Progression et la carte KPI ont déjà `targetColumn`), la médiane ; le repère n'est pas exporté dans Excel (le fichier garde les valeurs seules).
- **Testé** : Node (bloc « ligne de repère » : types, genre tracé, objectif invalide, moyenne avec vides/`BigInt`/chaînes, store, export inchangé, i18n, câblage) ; Playwright contre le vrai
  `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">` (formulaire : champ de valeur seulement pour « Valeur fixe », erreur sous le champ, relecture à l'édition ;
  objectif hors de la plage des données = axe élargi et ligne dans le cadre ; barres horizontales, courbe, pile, repère négatif, objectif invalide, camembert sans ligne ; moyenne qui suit un filtre croisé).
  **Pas testé dans un vrai Grist ni un vrai GFS.**

### Tuiles usuelles des outils BI — lot 2, étiquettes de valeur, courbe lissée, 100 % empilé (18/11/2026)

- **Trois options d'affichage** (PR 7b du plan, §4.7), dans « Options avancées », sans nouveau type de tuile :
  - **Écrire les valeurs sur le graphique** (`tile.valueLabels`, barres hors mode mesure et courbe/aire) : au-dessus de la barre ou du point, à droite d'une barre horizontale, dans le segment d'une
    pile (texte noir ou blanc selon la couleur de la série) ; compactes (`1,5 k`), les étiquettes qui se recouvrent sont masquées (pas de nombre illisible), une valeur absente ou nulle d'une pile n'écrit rien.
  - **Tracé de la courbe** (`tile.lineShape`, courbe/aire) : droit (défaut), lissé (`smooth: 0.35`, volontairement discret) ou en escalier centré (`step: 'middle'` : chaque valeur couvre sa catégorie).
  - **En 100 %** (`tile.stackPercent`, barres ou aire empilées avec une colonne Séries) : chaque catégorie ramenée à ses parts, axe 0-100 %, infobulle « Série : 25 % (1 000) » + total brut.
- **Choix à confirmer** : le lissage peut dessiner des valeurs qui n'existent pas (passer sous zéro) — pas de conseil automatique pour l'instant ; l'escalier est « centré » (autres choix : avant/après) ;
  la ligne de repère est **désactivée en 100 %** (l'axe est en parts) ; des valeurs négatives dans une pile 100 % donnent le conseil `advice.stackedPercent.negative`, pas de correction automatique.
- **Pas fait, à décider** : étiquettes sur le combo, l'histogramme, la cascade ; position d'étiquette au choix ; étiquettes en % ET en valeur ; zoom sur une période (curseur sous la courbe — l'étude demande de
  le tester avec le filtre croisé avant de le promettre : laissé de côté volontairement) ; une option « Pile » à 100 % pour les barres horizontales a le même rendu (axe X en %), à regarder dans un vrai GFS.
- **Testé** : Node (bloc « options d'affichage » : tracé, types, `isStackedPercentTile`, `shareOfTotal`/`stackShares` — colonnes à 100, absents, négatifs, `BigInt`, longueurs inégales —, export inchangé, conseil,
  i18n, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 120 et 6 000 lignes (formulaire : champs visibles selon les cases, repère
  masqué en 100 %, édition qui relit les trois options, décocher « Empiler » efface le 100 % ; pile à 100 sur chaque catégorie, valeurs brutes gardées, infobulle, aire 100 %, camembert et forme inconnue sans effet).
  **Pas testé dans un vrai Grist ni un vrai GFS.**

### Tuiles usuelles des outils BI — lot 3, boîte à moustaches (18/11/2026)

- **Ce qui est livré** (PR 8 du plan, §5.1 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : un type `box` (« Boîte à moustaches »). Une boîte par valeur de la dimension, sur les valeurs BRUTES de la colonne
  numérique (jamais un agrégat : pas de champ Agrégat, pas de drill-down). Médiane, quartiles, moustaches et valeurs aberrantes tracées une à une (cercles creux). Clic sur une boîte ou une aberrante = filtre d'égalité
  sur le groupe (la tuile reste entière, les autres groupes s'estompent, comme une barre).
- **Choix de calcul** : quantiles par interpolation linéaire (« type 7 » : `QUARTILE.INC` d'Excel, `quantile_cont` de DuckDB, numpy par défaut) — une médiane de notes d'effectif pair est la moyenne des deux du milieu.
  Moustaches de Tukey (1,5 x l'écart interquartile) : un groupe dont presque toutes les valeurs sont égales a donc un écart nul et déclare toute autre valeur aberrante, ce qui est le comportement habituel mais peut
  surprendre. **Calcul en JS pur à tout volume**, pas de DuckDB : il faut les valeurs de chaque ligne côté JS de toute façon (le tri par groupe), 500 000 lignes prennent ~200 ms ; une requête DuckDB (`quantile_cont`)
  demanderait de sérialiser les lignes vers le moteur pour un gain nul. À reconsidérer seulement si un document dépasse plusieurs millions de lignes.
- **Plafond de points tracés** : 60 aberrantes par groupe (les plus éloignées de la médiane), le compte exact reste dans l'infobulle (« 157 valeurs aberrantes ») ; sans plafond, une colonne à queue lourde sur
  47 000 lignes tracerait des milliers de cercles. Valeurs vides, booléennes, textes et NaN : ignorés (jamais 0) ; un groupe sans aucune valeur numérique n'a pas de boîte (la tuile n'affiche rien pour lui, sans
  le dire — à décider : une pastille « n groupes sans valeur »).
- **Conseils** (`js/advice.js`) : plus de 24 groupes (boîtes trop fines), ou aucun groupe de plus de 4 valeurs (des quartiles sur si peu de points disent peu) ; valeurs par défaut du formulaire = une vraie mesure +
  une catégorie de 2 à 24 valeurs, de préférence avec au moins 5 lignes par groupe. Jamais proposé à l'écran d'accueil (ce n'est pas une première visualisation).
- **Pas fait, à décider** : boîte horizontale, groupes triés par médiane, moyenne marquée d'un point, boîte « cassée » (encoches), violon, deuxième dimension (boîtes groupées), clic sur une valeur aberrante pour
  filtrer cette seule ligne (aujourd'hui : filtre du groupe), export Excel des valeurs aberrantes une à une (aujourd'hui leur nombre ; la table plate les liste).
- **Testé** : Node (bloc « boîte à moustaches » : quantiles contre des valeurs calculées à la main et contre un second calcul indépendant sur un jeu pseudo-aléatoire, moustaches, aberrantes basses et hautes, valeurs
  identiques, une seule valeur, `BigInt`, plafond, entrées vides, store, export, défauts, conseils, i18n, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET
  `<iframe sandbox="allow-scripts">`, 220 et 6 000 lignes (formulaire : champ Agrégat masqué, libellé « Colonne numérique », préremplissage, tuile enregistrée sans agrégat ; option ECharts = calcul pur ; **pixel de
  la médiane lu dans le graphique = couleur de palette**, intérieur teinté, fond au-dessus de la moustache ; clic réel sur une boîte = filtre + autres groupes à 0,3 + tuile source entière, 2e clic = filtre retiré,
  clic réel sur une aberrante = filtre du bon groupe ; filtre d'une autre tuile = boîtes recalculées ; feuille Excel ; barres -> boîte -> barres sans reliquat ; tuile sans valeur numérique = message ; thème
  sombre). **Pas testé dans un vrai Grist ni un vrai GFS.**

### Style global des tuiles — cinq entrées, un réglage du tableau de bord (18/11/2026 ; Grist Factory et Classique dense remplacés ensuite, voir plus bas)

Point de départ : Antoine, avec la capture d'un tableau de bord fluide/moderne : « un paramètre pour changer le style global des cartes, avec plusieurs options, notamment une plus proche de la DA de Grist Factory, une fluide/moderne comme le screen... 4 DA différentes qui affectent toutes les cartes ».

**Fait** : un réglage du TABLEAU DE BORD (Réglages > « Style des tuiles », visible en Édition seulement), enregistré dans `BI_Dashboard_Config` avec le reste du rapport (champ `style`, écrit seulement s'il diffère de `standard` : une configuration d'avant ce réglage reste identique octet pour octet, un id inconnu mais bien formé traverse la sauvegarde, une valeur mal formée est ignorée). Cinq entrées : **Standard** (le rendu d'origine, jamais modifié, défaut), **Grist Factory** (jetons de `kit/css/tokens.css`, un seul bleu d'accent, coins de 8 px ; pas de Manrope, décision d'Antoine), **Fluide** (cartes très arrondies, ombres douces, gros chiffres, barres pastel en pilule avec la valeur au bout et sans axe des valeurs, courbes plus épaisses à repères cerclés), **Classique dense** (façon Power BI : coins presque droits, bordures fines, texte compact, quadrillage et traits d'axe), **Éditorial** (fond papier, un filet en tête de carte, titres et chiffres à empattements, quadrillage en tirets). Deux couches : `css/dash-styles.css` (jetons `--dash-*` + couleurs de la charte, un bloc clair et un bloc sombre par style, lus aussi par les graphiques via `chartTheme()`) et `js/styles.js:applyToOption`, une passe appelée EN DERNIER par `finalizeOption` (barres arrondies, valeurs au bout des barres, quadrillage, tracé des courbes, bord des parts, infobulle). Le style ne change JAMAIS la forme d'une courbe (lissé, escalier ou droit restent le choix de la tuile, `tile.lineShape` : un lissage dessine des valeurs qui n'existent pas, piège n°33) et ne retire pas les étiquettes de valeur qu'une tuile a réglées elle-même (`tile.valueLabels` gagne sur celles du style). La palette reste celle de la tuile (`tile.palette`) : le style la transforme (pastel d'une couleur unique) sans la remplacer ; les formats de nombres sont ceux de la tuile (les valeurs au bout des barres réutilisent le formateur d'axe) ; les couleurs d'état et les couleurs des séries ne sont jamais redites.

**Choix à connaître** : (1) « Standard » et « Grist Factory » se ressemblent à dessein de loin (même famille sobre) ; Grist Factory se reconnaît à ses jetons (gris bleuté, accent bleu unique, ombre nette) et à ses barres arrondies. (2) Une **ambiance de GFS** pose ses jetons en ligne sur `<html>` : ils l'emportent sur les couleurs d'un style (comme sur celles du rendu standard) ; le style garde alors sa géométrie, ses ombres, sa densité et le traitement de ses graphiques. (3) Une carte au repos garde sa hauteur FIXE (224 px, piège n°8) quel que soit le style : le chiffre KPI se règle par `--kpi-max`, jamais par une hauteur. (4) Le style n'est PAS dans une vue sauvegardée (un bookmark ne porte que filtres, page, drill-down) : c'est un réglage du rapport.

**Vérifié** : Node (`dev-tests/test-styles.js`) — registre et clés fr/en, ids hostiles (clés de prototype comprises) -> Standard, passe ECharts de chaque style (Standard strictement intact ; palette, couleur du rendu, écart de l'histogramme, quadrillage masqué du combo, empilé et plusieurs séries respectés ; graphique sans axe ni série sans erreur), teinte douce sur carte claire ET sombre, CSS parsé (tous les jetons de couleur présents en clair ET en sombre, contrastes AA des trois textes sur les trois fonds, `factory` = `kit/css/tokens.css`, pastille Standard = `css/style.css`, aucune hauteur ni `min-height`), store (notification, valeurs mal formées, indépendance des vues), aller-retour de configuration par le vrai `js/grist-api.js` avec un faux `grist` (3 anciens formats + JSON invalide lus en Standard). Navigateur (Playwright, Chromium, `index.html` + `dev-tests/grist-stub.js`) — cinq styles x clair/sombre sur une table de démonstration (barres, horizontales, courbe, aire, camembert, anneau, KPI, jauge, treemap, entonnoir, radar, table), tuile agrandie, menu Réglages (cartes de choix, `aria-checked`, persistance après rechargement avec la ligne de configuration préremplie), et **dans un `<iframe sandbox="allow-scripts">`** (pièges n°17/20 : le choix se pose et se sauvegarde sans `submit` ni boîte de dialogue). Bugs de mon propre code trouvés et corrigés au passage : barres pastel marine invisibles sur carte sombre ; débordement de la première carte KPI en Fluide ; fenêtre Réglages rognée sur une fenêtre courte (maintenant défilable).

**Non vérifié** : rendu dans un vrai Grist/GFS (aucun accès) ; interaction réelle avec une ambiance GFS choisie (testée seulement en posant des jetons en ligne à la main) ; exports PDF/PPTX avec le vrai CDN (cdnjs est bloqué ici) — ils capturent l'image du graphique déjà rendu, donc ils suivent le style, mais n'ont pas été rejoués ; en thème sombre ils gardent le fond clair déjà connu, comme avant ce réglage. **Limite connue** : seules les tuiles ECharts, le KPI, la progression, la table et le texte suivent le style ; le pivot HTML reprend les jetons de couleur mais pas la forme des graphiques (il n'en a pas).

### Style global des tuiles — retours d'Antoine : Console, Verre dépoli et deux options pour tous les styles (18/11/2026)

Retour d'Antoine sur la 1re livraison : « Standard, Fluide, Édito : ok. Les deux autres ne sont pas assez démarqués, proposer d'autres [styles], inspirés de dashboards existants. Et prévoir une option pour que les tuiles n'aient plus de bordure apparente, et une autre pour faire un tableau de bord plus uni (quelques options valables pour tous les styles). »

**Fait** : (1) **Grist Factory** et **Classique dense** sont retirés (une configuration qui les porte s'affiche en Standard et garde l'id à la sauvegarde) ; remplacés par **Console** (toujours sombre, clair ou sombre côté système ; filets fins, titres en petites capitales, chiffres à chasse fixe en couleur d'accent, barres fines à dégradé, courbes qui luisent, aire qui s'efface vers le bas, quadrillage en pointillés — inspiré de la façon dont les consoles de supervision type Grafana ou Datadog présentent leurs panneaux) et **Verre dépoli** (fond dégradé fixe à trois halos, cartes translucides `backdrop-filter: blur`, rayons de 22 px, barres en pilule à dégradé, points cerclés — inspiré des interfaces « glassmorphism »). Ces inspirations viennent de MA connaissance de ces familles de rendu, pas d'une capture ni d'un outil ouvert : aucun nom, logo ni charte n'est repris. (2) **Deux options pour tous les styles, Standard compris** (Réglages > « Options (tous les styles) », champ `styleOptions` de la configuration, écrit seulement s'il en faut un) : **Tuiles sans bordure apparente** (le trait devient transparent, la tuile garde sa taille ; Standard garde une ombre discrète pour qu'on distingue encore la carte) et **Tableau de bord uni**.

**Choix à connaître** : (1) j'ai lu « plus uni » comme **une seule surface** : les tuiles prennent le fond de la page, sans ombre ni coins arrondis, et se touchent, avec un trait unique entre deux voisines tant que les bordures sont affichées (cochée avec « sans bordure », la page devient un aplat sans aucune séparation). L'autre lecture possible — des graphiques d'une seule couleur — n'est PAS faite. (2) Console reste sombre même quand le système est en thème clair : c'est voulu (un tableau de bord de supervision n'a pas de variante claire), au prix d'un widget sombre dans une page Grist claire. (3) Une palette de tuile qui commence par une teinte très foncée (le début d'une palette séquentielle bleue) est éclaircie sur carte sombre pour les barres à dégradé : sans cela elle disparaît ; le Standard, lui, n'y touche pas (comportement d'avant). (4) Le trait d'une tuile « sans bordure » est rendu TRANSPARENT et non supprimé : un `border: 0` changerait la taille de la tuile et provoquerait un redimensionnement des graphiques sans raison.

**Vérifié** : Node (`dev-tests/test-styles.js`) — registre (5 ids, `factory`/`dense` inconnus, clés fr/en des options), attributs de `<html>` avec un faux document, normalisation des options (valeurs héritées, mal typées, clés inconnues), dégradés (couleur de la série, horizontal/vertical, plusieurs séries, jamais sur une pile ni sur une couleur illisible, éclaircissement sur carte sombre mais jamais sur carte claire), halo et aire en dégradé, CSS parsé (`console` : un bloc, `color-scheme: dark`, jetons « sombres seulement » identiques à ceux de `style.css`, texte du bouton plein sur l'accent >= 4,5:1 ; verre : `--surface` opaque, textes >= 4,5:1 sur la PIRE carte — ce test a trouvé un gris trop sombre en verre sombre, corrigé —, aucun `backdrop-filter` sur la barre ; options : le trait seulement transparent, marge négative compensée par le remplissage de la grille, aucune hauteur), store (référence neuve seulement si le contenu change), configuration par le vrai `grist-api.js` (rien d'écrit tant qu'aucune option, anciens formats et lignes hostiles lus sans option, `factory`/`dense` conservés à la sauvegarde), câblage. Navigateur (Playwright, Chromium, `index.html` + faux Grist) — Console et Verre en clair et en sombre sur 4 pages de tuiles (barres, horizontales, courbes, aire, anneaux, KPI, jauge, treemap, cascade, radar, tableau croisé, combo, histogramme), options seules et combinées sur Standard, Fluide, Éditorial, Console et Verre, tuile agrandie et panneau d'ajout en « uni », menu Réglages (clair et sombre : cartes, cases, persistance de la ligne de configuration, retour au Standard qui efface les clés), et **dans un `<iframe sandbox="allow-scripts">`** (le choix et les cases se posent et se sauvegardent). Bugs de mon propre code trouvés et corrigés au passage : toutes les pastilles du menu prenaient le décor du verre (jeton hérité de `<html>`) ; barres marine invisibles sur carte sombre.

**Non vérifié** : rendu dans un vrai Grist/GFS ; interaction avec une VRAIE ambiance GFS (ses jetons en ligne gagnent sur les couleurs d'un style — pour Console et Verre, un accent ou un fond d'ambiance sur le décor propre à ces styles peut détonner) ; `backdrop-filter` dans le navigateur d'un vrai Grist (supporté par les navigateurs récents, mais pas rejoué sur un vieux) ; exports PDF/PPTX avec le vrai CDN (une carte de verre y devient un fond uni, les graphiques gardent leur dégradé).

### Disposition de la page — Rapport, Planche, Vedette, Rail, au choix PAGE PAR PAGE (18/11/2026)

Point de départ : Antoine, sur les deux options « sans bordure » et « tableau de bord uni » du lot précédent : « pas convaincu pour les options macro d'agencement du dashboard ; essaie de comprendre le
problème et d'imaginer plusieurs formats de dashboard ; j'imagine une version sur un fond uni qui paraisse bien plus liée ; 3 à 4 propositions », puis « c'est un enjeu d'UI/UX, hésite pas à utiliser des
compétences dédiées », puis « pourquoi pas tous ? en plus des styles, on laisse le choix de l'arrangement, avec 3 à 4 options, et ça reste changeable sans souci pour chaque page ? ».

**Diagnostic** (ce que j'en ai compris) : une grille de cartes identiques ne relie rien — chaque carte est une boîte, toutes pèsent autant, l'œil n'a ni entrée ni parcours, et « sans bordure » ou « uni »
ne change que le trait, pas la hiérarchie. Un tableau de bord qui paraît « lié » donne un poids différent aux chiffres (en tête, un seul chiffre phare), aligne tout sur une même grille, remplit ses lignes
(jamais une case vide au bout) et remplace les boîtes par des filets ou une seule surface. Principes tirés de la compétence `dataviz` : un chiffre phare unique (>= 48 px, chiffres proportionnels), libellés
de chiffre en minuscules, filets pleins d'un pixel, dernière ligne incomplète = elle se partage la largeur. Les quatre propositions ont d'abord été rendues dans le vrai widget (captures dans
`/mnt/project-files/agencements-tuiles/`), avant d'être codées.

**Fait** : un réglage PAR PAGE (Réglages > « Disposition de la page », visible en Lecture COMME en Édition — premier jet réservé à l'Édition, corrigé le jour même sur retour d'Antoine : « il faut que le menu de réglage soit commun en mode édition et lecture » ; le style des tuiles de même ; indication qui nomme la page), enregistré avec la page dans `BI_Dashboard_Config` (champ `layout`, écrit
seulement s'il diffère de `grid` : une page d'avant ce réglage reste identique octet pour octet). Cinq entrées : **Grille** (la grille de cartes d'origine, défaut, rien n'est posé), **Rapport** (sans cartes ;
chiffres en tête, deux graphiques par ligne, filet fin au-dessus de chaque bloc), **Planche** (une seule surface arrondie, bandeau de chiffres teinté, filets seulement entre les cellules), **Vedette** (chiffres,
un grand graphique — le premier en barres, courbe ou combo —, deux plus petits à côté, le reste par trois) et **Rail** (colonne de chiffres et de jauges à gauche, graphiques à droite, trois par ligne). Le
module pur `js/layouts.js` calcule un PLAN (largeur sur 12 colonnes, hauteur en rangées fixes de 28 px, groupe, colonne de départ du Rail) ; `js/main.js:render()` le pose en variables CSS et réordonne le DOM
(les chiffres d'abord : l'ordre de tabulation suit l'écran) ; `css/layouts.css` le dessine. L'ordre ENREGISTRÉ des tuiles ne change jamais ; les flèches ◀ ▶ échangent une tuile avec la plus proche du même
groupe. Les deux options du lot précédent ne valent plus que pour la Grille (leurs cases sont sous le choix de disposition).

**Choix à connaître** : (1) **Seuils de largeur** : un agencement ne s'applique qu'au-dessus de 640 px (Rapport), 900 px (Planche, Vedette) ou 1 040 px (Rail) de largeur de la ZONE de travail (conteneur CSS,
pas la fenêtre : le panneau « Ajouter » en retire 400 px) ; en dessous, la grille d'origine reprend, plutôt que d'écraser des graphiques. Ces seuils sont MON choix, non mesuré sur un vrai Grist (largeur
réelle d'un widget dans une page Grist à confirmer). (2) **Vedette** : la vedette est le premier graphique en barres, courbe ou combo (les types qui se lisent sur toute une largeur) ; sans un tel graphique,
pas de vedette, trois par ligne. (3) **Rail** : la colonne de gauche prend les chiffres ET les jauges ; sans aucune de ces tuiles, elle disparaît et les graphiques partent de la colonne 1. (4) Les chiffres
passent devant les graphiques dans les quatre dispositions, même rangés après dans la page ; seul l'ordre affiché change. (5) **Boutons des tuiles** : en lecture à la souris, ils passent par-dessus le titre au
survol seulement ; en Édition et sur écran tactile, ils restent en flux (dans le Rail, le titre prend alors sa ligne). (6) Chaque disposition garde les couleurs, les polices et le traitement des graphiques du style
choisi (Fluide, Éditorial, Console, Verre dépoli) mais redessine le cadre de la tuile ; les contrastes du verre n'ont pas été recalculés pour du texte posé DIRECTEMENT sur le dégradé (le test de contraste du
style vise sa pire carte translucide, donc ce cas est couvert par construction, mais non mesuré à part). (7) Une disposition n'est PAS dans une vue sauvegardée (un bookmark ne porte que filtres, page, drill-down).

**Vérifié** : Node (`dev-tests/test-layouts.js`, 9 blocs) — registre, seuils et clés fr/en ; ids inconnus ou hostiles (clés de prototype comprises) -> grille ; `spansFor` : toute ligne pleine pour 0 à 14 éléments
et 1 à 4 par ligne ; plan de chaque disposition sur le rapport de démonstration (11 tuiles) et pour toutes les combinaisons de 0 à 13 chiffres x 0 à 14 graphiques (aucun trou, hauteurs entières et bornées,
chaque tuile une seule fois) ; vedette seule / à deux / absente, Rail avec et sans colonne, objectif (colonne, nombre fini, texte refusé) ; entrées bizarres sans exception, 1 000 tuiles dans le temps imparti ;
ordre affiché (copie) et cible des flèches ; miniatures (dans la boîte, sans recouvrement) ; store (par page, la grille retire le champ, refus des ids mal formés, id futur gardé, configuration hostile assainie,
même référence quand rien ne change) ; aller-retour de la configuration par le vrai `js/grist-api.js` avec un faux `grist` ; CSS parsé (trois seuils `@container` = `minWidthOf`, `--lu` = 28 px, rangées
fixes, jamais de `min-height`, règles communes de 640 et de 900 px identiques, tuile sans ombre ni verre, boutons par-dessus le titre au survol seulement, contrastes AA du texte atténué sur le fond teinté dans les
deux thèmes) ; câblage d'`index.html` et du harnais. Navigateur (Playwright, Chromium, `index.html` + `dev-tests/grist-stub.js`, rapport de démonstration de 4 pages et 5 760 lignes) : les quatre dispositions x
clair/sombre (Standard) puis Console, Éditorial, Fluide et Verre dépoli ; largeurs de fenêtre 560 / 700 / 880 / 960 / 1 100 / 1 280 px (colonnes de la grille lues : 1, 2, 3 puis 12 ; Rail à 13 colonnes dès
1 040 px de zone), aucun défilement horizontal ; **stabilité des hauteurs** (8 échantillons sur 3 s par disposition, identiques) ; survol et mode Édition (boutons, flèches désactivées au bon endroit,
échange dans la Vedette) ; une page par disposition (Rapport / Rail / Grille / Vedette) retrouvée en changeant de page, **aucune erreur console** ; enregistrement vérifié dans `BI_Dashboard_Config` ; tuile
agrandie dans le Rail ; panneau « Ajouter » ouvert (zone de 832 px : la Planche retombe en grille) ; cadre `<iframe sandbox="allow-scripts">` (clic réel sur une carte de disposition : `data-layout` posé,
enregistré). Trois défauts trouvés ainsi et corrigés : une carte de chiffres avec objectif rognée dans la colonne étroite du Rail (7 rangées -> 9), un chiffre de 56 px qui réduisait la courbe à un point dans une
colonne de 300 px (plafond `56cqw`), et le titre du Rail rogné par sept boutons en Édition (titre sur sa ligne).

**Retours d'Antoine du 18/11/2026, après la fusion (corrigés dans la foulée)** : (1) « je ne vois pas les options dans réglages » : en Lecture la fenêtre Réglages ne montrait que Langue et Crédits (Style et Disposition étaient réservés à l'Édition) ; **le menu est désormais identique en Lecture et en Édition**. (2) « le menu est super étroit, plutôt un rectangle à l'horizontale » : la fenêtre passe de 420 px à 960 px au plus (cadre moins 32 px) ; cinq cartes de style puis cinq cartes de disposition EN LIGNE dès 900 px de large (trois dès 600 px, deux en dessous, une dès 440 px), les deux options de la Grille côte à côte, Langue et Crédits sur deux colonnes en bas (Langue a changé de place : elle est passée de la tête au pied de la fenêtre). Mesuré dans un `<iframe sandbox="allow-scripts">` : 1 200 px -> 960 x 776 (défile de 72 px), 760 px -> cartes sur 2 rangées, 500 et 380 px -> 3 puis 5 rangées, aucun défilement horizontal, clair et sombre. (3) « uni » + « sans bordure » dessinait encore l'ombre des tuiles (« des sortes d'ombres dessinent les carrés ») : les règles de l'ombre de « sans bordure » (`:not([data-dash-style])` et `[data-dash-style]`, spécificité 0,4,0) battaient celle d'« uni » (0,3,0) ; une règle combinée plus spécifique donne le dernier mot à « uni » (aucune ombre, au repos, au survol, agrandie, pour les cinq styles, clair et sombre — `box-shadow` calculé lu dans le navigateur). Le test rejoue la cascade sur les règles du fichier (`test-styles.js`) et échoue sans le correctif.

 ; interaction avec une VRAIE ambiance GFS ; comportement tactile réel (règle
`@media (hover: none)` écrite et relue, jamais rejouée sur un écran tactile) ; `:has()` (utilisé pour réserver la place du badge de commentaires) sur un vieux navigateur : sans lui, le badge peut recouvrir la fin
d'un long titre ; exports PDF/PPTX (ils capturent l'image du graphique déjà rendu, indépendante de la disposition). **Limite connue** : Planche et Vedette n'ont pas de variante à deux colonnes pour la zone
intermédiaire (640-900 px) : elles retombent sur la grille ; la Vedette ne choisit pas elle-même sa vedette (le premier graphique éligible), un réglage par tuile serait un lot à part.

### Tuiles usuelles des outils BI — lot 3, flux (Sankey) (18/11/2026)

- **Ce qui est livré** (PR 9 du plan, §5.2 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : un type `sankey` (« Flux (Sankey) »). Deux colonnes catégorielles (source à gauche, cible à droite) et une mesure ;
  chaque lien a l'épaisseur de la mesure agrégée (Somme ou Comptage) pour SA paire source -> cible. Un clic sur un nœud = filtre d'égalité sur sa colonne (les autres nœuds, et les liens qui n'y passent pas,
  s'estompent) ; un clic sur un lien = filtre source ET cible (comme une case de la carte de chaleur, `cellFilterToggles`). La tuile reste entière sur son propre filtre. Pas de drill-down, de tri, de séries ni de repère.
- **Choix** : graphe BIPARTI (source à gauche, cible à droite), pas un Sankey à plusieurs étapes. Une valeur qui figure des deux côtés (« Web » en source et en cible) donne deux nœuds, ce qui évite tout cycle
  (ECharts refuse un graphe cyclique) ; un parcours en plusieurs étapes (A -> B -> C) demanderait de choisir l'ordre des colonnes et un empilement de paires, à décider si le besoin se présente. **Calcul en JS pur à
  tout volume** (une passe, groupement par paire ; pas de DuckDB, comme l'histogramme et la boîte).
- **Plafonds et écarts** : 60 liens tracés au plus (les plus gros ; la tuile écrit « 60 flux les plus importants sur 144 » et l'export Excel garde toutes les paires, négatives comprises) ; un flux nul, négatif ou
  absent n'a pas d'épaisseur et n'est pas tracé (conseil « n flux nuls ou négatifs n'apparaissent pas ») ; lignes sans source ou sans cible ignorées. Conseil au-delà de 15 nœuds (écheveau) et pour une moyenne/min/max
  (un flux s'additionne ; le préremplissage du formulaire force Somme ou Comptage).
- **Pas fait, à décider** : Sankey à plus de deux colonnes (étapes), tri des nœuds (ECharts les ordonne pour limiter les croisements), déplacement des nœuds à la souris (`draggable: false`, un déplacement ne
  s'enregistre pas), choix de la couleur d'un lien par la cible, regroupement des petits flux en « Autres ».
- **Testé** : Node (bloc « flux (Sankey) » : pair par paire, somme/comptage/moyenne, flux écartés et ignorés, `pairs` pour l'export, même valeur des deux côtés = deux ensembles, types mêlés et `BigInt`, plafond et
  ordre, store (nœud, lien, retrait, suppression de la tuile), export, défauts, conseils, i18n, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`,
  220 et 6 000 lignes (formulaire : libellés « Source » / « Cible », 2e dimension obligatoire et différente, message propre ; option ECharts = calcul pur ; **clic réel de souris sur un nœud puis sur un lien**,
  atténuation des autres, retrait au 2e clic ; filtre d'une autre tuile = flux recalculés ; feuille Excel ; barres -> flux -> barres sans reliquat ; flux sans valeur positive = message ; thème sombre).
  **Pas testé dans un vrai Grist ni un vrai GFS.**

### Ligne de repère : libellé hors de la zone de tracé (18/11/2026)

Constat (en testant le style global des tuiles) : sur une courbe ou des barres verticales, le libellé « Moyenne 653 247 » / « Objectif 900 000 » était posé DANS la zone de tracé, au bout du trait (`insideEndTop`), avec un fond opaque : il cachait la fin de la courbe (les deux derniers points d'une série qui monte) et le haut de la dernière barre ou sa valeur. Même défaut en Standard.

**Fait** : le libellé va à droite de la zone de tracé, sur deux lignes (nom puis valeur), sans rien recouvrir. `GristBI.format.refLabelLayout` (pur) en donne la taille (11 px, réduite jusqu'à 9 px, puis tronquée) et la marge à réserver, plafonnée à ~22 % de la largeur de la tuile ; `addRefLine` la prend sur une COPIE de la grille et `finalizeOption` la retranche de la zone de tracé pour tailler les noms de catégorie. Barres horizontales (trait vertical, libellé en haut) : inchangé.

**Contrepartie assumée** : la zone de tracé perd 45 à 60 px de large ; dans une tuile de 270 px avec 3-4 catégories, un nom long est tronqué (« Bouti… », « Ou… ») alors qu'il tenait avant. À 340 px et plus, tout tient. **Vérifié** : Node (`refLabelLayout` sur 5 largeurs x 5 libellés : marge <= 22 %, texte contenu, taille, troncature) ; rendu réel dans `index.html` + faux Grist, tuiles de 270, 300 et 350 px, clair et sombre, Standard/Fluide/Classique/Éditorial. **Non vérifié** : un vrai Grist.

### Tuiles usuelles des outils BI — lot 3, bulles (18/11/2026)

- **Ce qui est livré** (PR 10 du plan, §5.5 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : le nuage de points devient aussi un graphique à bulles. Deux options facultatives, indépendantes : « Taille des bulles »
  (une 3e mesure, avec son propre agrégat : le prix est une moyenne, le chiffre d'affaires une somme) et « Couleur » (la colonne « Séries » du formulaire, une couleur et une entrée de légende par valeur). Sans
  elles, la tuile est exactement le nuage de points d'avant (même option ECharts, même export). Clic sur une bulle = filtre d'égalité sur la dimension (ou drill-down, comme avant).
- **Choix** : l'aire de la bulle suit la valeur (diamètre ~ racine carrée), échelle commune à toutes les couleurs, diamètre maximal = 18 % de la plus petite côté de la tuile (18 à 56 px) ; une taille nulle ou négative n'est
  pas dessinée (conseil `advice.bubble.sizeSign`). La couleur se calcule PAR couleur : si une même valeur de la dimension figure dans deux couleurs, elle donne deux bulles (une par couleur), pas une couleur arbitraire
  (« la première » ou « la plus fréquente »). Une colonne de couleur qui dépend de la dimension (produit -> gamme) donne donc exactement la maquette de l'étude. Réutilise `tile.seriesColumn` mais PAS `isSeriesTile`
  (voir piège n°37). Calcul en JS ou DuckDB (au-delà de 5 000 lignes), comme le nuage de points.
- **Pas fait, à décider** : nuage de points LIGNE PAR LIGNE (R6 de l'étude DRANE du 18/11, toujours ouvert : aujourd'hui une bulle = une valeur de la dimension, agrégée), légende de taille (aujourd'hui seulement l'infobulle),
  taille minimale réglable, couleur par une mesure (dégradé), étiquettes de nom sur les bulles, axes qui ne partent pas de zéro (le comportement d'origine du nuage de points est conservé : les deux axes incluent 0).
- **Conseils** : colonne de couleur = colonne des points, plus de couleurs que la palette n'en a (8 en Standard), tailles nulles ou négatives écartées.
- **Testé** : Node (bloc « bulles » : diamètres à aire proportionnelle, plancher, tailles sans aire, `BigInt`, alignement par nom, mesure absente, point sans X ou Y, export simple / taille / couleur, conseils, i18n, câblage) ;
  Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 480 et 6 000 lignes (formulaire : champ de taille, agrégat de la taille seulement quand une taille est choisie,
  libellé « Couleur », tuile enregistrée avec ses 3 mesures et la couleur ; option ECharts = calcul pur sur chaque couleur, **aire ~ taille**, diamètre maximal attendu ; **infobulle survolée** (texte, taille nommée, aucune
  injection par un nom de valeur) ; **clic réel de souris sur une bulle libre** = filtre, autres bulles à 0,3, 2e clic = filtre retiré ; agrandissement = bulle maximale plus grosse ; filtre d'une autre tuile = tailles
  recalculées ; feuille Excel ; taille négative = bulle absente + conseil ; nuage de points simple inchangé ; nuage de points -> barres -> bulles sans reliquat ; aucune erreur console). **Pas testé dans un vrai Grist ni un
  vrai GFS.**

### Tuiles usuelles des outils BI — lot 3, calendrier (18/11/2026)

- **Ce qui est livré** (PR 11 du plan, §5.6 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : un type `calendar` (« Calendrier (activité par jour) »). Une colonne de DATES + une mesure et son agrégat ; une case par
  jour, semaines en colonnes, lundi en haut, mois en en-tête, même rampe de couleur que la carte de chaleur avec sa légende. Comptage = nombre de lignes par jour (« activité »), Somme = un montant par jour. Clic sur un
  jour = filtre d'égalité sur la colonne de dates (la tuile reste entière, les autres jours s'estompent, 2e clic = filtre retiré). Pas de drill-down.
- **Choix** : fenêtre d'UN an (les 366 derniers jours depuis le dernier jour qui a une valeur) : au-delà, les cases deviendraient des points de 3 px ; les jours plus anciens sont comptés (« n plus anciens restent dans
  l'export »), jamais perdus. Un jour sans ligne garde la trame neutre : « aucune ligne » n'est pas « la valeur la plus basse ». Composant `calendar` d'ECharts (et pas une grille HTML) : même thème, infobulle et
  légende que la carte de chaleur, rien à réécrire. Calcul en JS pur à tout volume (une passe, un agrégat par jour). Le formulaire refuse une colonne qui n'est pas de dates (format AAAA-MM-JJ, celui de toutes les
  colonnes Date du widget).
- **Pas fait, à décider** : plusieurs années côte à côte (une bande par année), choix du premier jour de la semaine, case carrée (les cases s'étirent avec la tuile), plage réglable, regroupement par semaine ou par
  mois, clic-glisser pour filtrer une période (aujourd'hui un jour à la fois ; le filtre « plage de dates » du menu Filtre existe), jours fériés.
- **Conseils** : colonne sans date valide, moins d'une semaine de données, plus d'un an (la dernière année seulement). Jamais proposé à l'écran d'accueil.
- **Testé** : Node (bloc « calendrier » : décalage de jours, agrégation par jour pour les 5 agrégats, tri, dates invalides ignorées, fenêtre d'un an et plafonds, trou != 0, store, export, défauts, conseils, i18n
  dont 7 jours et 12 mois par langue, câblage dont l'absence de composant `calendar` dans l'état vide) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`,
  400 et 6 000 lignes, clair et sombre (formulaire : libellé « Colonne de dates », champs masqués, colonne non date refusée, préremplissage ; option ECharts = calcul pur, plage de mois entiers ; **pixel** de la case du
  maximum = dernier arrêt de la rampe, **pixel** d'un jour sans ligne = hors rampe ; infobulle survolée ; **clic réel de souris** sur un jour = filtre, autres jours à 0,3, tuile entière, 2e clic = filtre retiré, clic sur
  un jour sans ligne = rien ; filtre d'une autre tuile = jours recalculés ; agrandissement = cases plus larges ; feuille Excel ; 500 jours = 366 dessinés + 500 exportés + conseil ; aucune date = message ; calendrier ->
  barres -> calendrier ; valeurs toutes égales ; aucune erreur console). **Pas testé dans un vrai Grist ni un vrai GFS.**

### Tuiles usuelles des outils BI — lot 3, Gantt (18/11/2026)

- **Ce qui est livré** (PR 12 du plan, §5.7 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : un type `gantt` (« Gantt (planning de tâches) »). Trois colonnes : le libellé de la tâche (`dimension`),
  son début et sa fin (`startColumn`, `endColumn`, deux colonnes de DATES au format ISO), et une colonne de couleur facultative (`seriesColumn`, un statut). Une ligne de la table = une tâche = une barre, triée par
  date de début ; ni mesure ni agrégat, ni format de nombre. Axe du temps commun en pourcentages de la largeur (mois, lundis ou jours selon la durée, au plus 8 graduations, moins dans une tuile étroite), année dans le
  coin de l'axe, repère rouge « aujourd'hui » quand il tombe dans la période. Clic sur une tâche = filtre d'égalité sur son libellé, clic sur une pastille de la légende = filtre sur le statut (la tuile reste entière, le
  reste s'estompe, 2e clic = retiré ; Entrée et Espace aussi). Pas de drill-down, pas de tri.
- **Choix** : HTML/CSS dans `.tile-chart` (comme la Progression) plutôt qu'ECharts : texte sélectionnable, libellés à gauche toujours lisibles, défilement natif d'une longue liste, aucune instance à disposer ; les
  barres sont posées en `left`/`width` en % de l'axe, donc elles suivent l'agrandissement d'une tuile sans calcul. Une ligne dont le début ou la fin n'est pas une date valide, ou dont la fin précède le début, n'a PAS de
  barre (une tâche « en cours » sans date de fin ne se dessine pas : on n'invente pas sa durée) : elle est comptée dans une note sous la liste. Une tâche d'un jour occupe une case de jour entière (fin incluse). 200 tâches
  dessinées au plus (« 200 premières tâches sur 6 012 »), les statuts et leurs couleurs étant calculés sur TOUTES les tâches valides (une couleur ne change pas quand le plafond coupe) ; l'export Excel (et PDF/PPTX, en tableau
  natif) garde toutes les tâches. La légende est collante en bas de la tuile (elle reste visible quand la liste défile) ; chaque graduation est rognée à sa case, jamais posée sur sa voisine. La couleur ne porte jamais seule
  l'information : la légende nomme chaque statut et l'infobulle de la ligne le répète.
- **Pas fait, à décider** : dépendances entre tâches (flèches), jalons (losanges), regroupement par projet / ressource (lignes de titre), glisser une barre pour changer une date (le widget n'écrit jamais dans la table de
  travail), zoom sur une période, avancement (% réalisé) dans la barre, week-ends grisés, plusieurs barres par ligne.
- **Conseils** : aucune barre dessinable (« début » et « fin » sans dates valides), plus de statuts que de couleurs dans la palette, lignes écartées, plus de 200 tâches. Défauts : les deux premières vraies colonnes de dates, la
  1re étant celle qui précède l'autre sur la majorité des lignes (jugé sur les valeurs), libellé = colonne d'identifiants, couleur = petite catégorie. Jamais proposé à l'écran d'accueil.
- **Testé** : Node (bloc « gantt » : tri stable, lignes écartées de 5 sortes, statuts dans l'ordre de la table, plafond, axe (mois, lundis, jours, budget, graduation de début), géométrie d'une tâche d'un jour,
  aujourd'hui dans/hors de l'axe, store, export, défauts à colonnes inversées, conseils, i18n avec pluriels, câblage dont l'échappement de chaque chaîne saisie) ; Playwright contre le vrai `index.html` + `grist-stub.js`,
  page directe ET `<iframe sandbox="allow-scripts">`, 14 et 6 014 lignes, clair et sombre (formulaire, validation, géométrie des barres mesurée au pixel contre le calcul pur, couleurs, graduations sans recouvrement,
  légende visible, **clic réel de souris** sur une tâche et sur une pastille, clavier, filtre d'une autre tuile, repère « aujourd'hui », agrandissement, export, plafond, injection de balisage dans un libellé et un statut,
  aucune tâche, gantt -> barres -> gantt, édition). Le style global (glass, console…) a été regardé sur capture : en verre, l'axe et la légende collants gardent un fond opaque (une bande pâle sur la carte translucide).
  **Pas testé dans un vrai Grist ni un vrai GFS.**

### Tuiles usuelles des outils BI — lot 3, petits multiples (18/11/2026)

- **Ce qui est livré** (PR 13 du plan, §5.8 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : une OPTION des barres et de la courbe/aire, pas un type — la case « Un petit graphique par série (même échelle pour tous) »,
  visible dès qu'une colonne « Séries » est choisie. Au lieu de superposer les séries (une couleur chacune sur un seul graphique), un petit graphique par valeur de la colonne, rangés en grille, tous sur les mêmes catégories
  ET sur la même échelle des valeurs (sinon un petit panneau ressemblerait à un grand). Le titre du panneau est le nom de la série. Les calculs sont ceux des séries multiples (un `groupByAggregate` par série, DuckDB au-delà de
  5 000 lignes) ; seule la mise en page change. Clic sur une barre ou un point = drill-down ou filtre de la catégorie, comme un graphique unique ; les catégories non retenues s'estompent dans TOUS les panneaux.
- **Choix** : UNE instance ECharts à N grilles (plutôt que N instances) : un seul rendu, un seul gestionnaire de clic, le style global des tuiles et le thème s'appliquent par `finalizeOption`/`styles.applyToOption`
  sans écrire rien de plus. La géométrie est en pixels (`smallMultiplesGrid`) et `instance.__refit` la recalcule au redimensionnement. Échelle commune de 0 au plus haut, pas rond, 2 à 4 intervalles, la plus serrée possible
  (`smallMultiplesRange`) ; graduations des valeurs sur la 1re colonne seulement, noms des catégories sous le dernier panneau de chaque colonne, et retirés quand chacun aurait moins de 24 px (l'infobulle les donne).
  Empilé, 100 %, barres horizontales, ligne de repère et étiquettes de valeur sont ignorés tant que la case est cochée (le formulaire les masque, `readTileForm` écarte leur valeur) mais jamais effacés de la tuile. Au plus
  12 panneaux (« Les 12 premières séries sur 14 » + avertissement) ; l'export Excel garde toutes les séries et est identique à celui des séries superposées.
- **Pas fait, à décider** : échelles propres à chaque panneau (case « échelles indépendantes » : utile quand les ordres de grandeur divergent, mais trompeur par défaut), petits multiples sur d'autres types (camembert, nuage de
  points, carte de chaleur), choix du nombre de colonnes, panneau « Total » en tête, tri des panneaux par valeur.
- **Conseils** : plus de 12 séries (remplace l'avertissement de couleurs, qui n'a plus de sens), une seule série, plus de 24 catégories (illisibles dans un petit panneau). Jamais proposé à l'écran d'accueil ni préremplit.
- **Testé** : Node (bloc « petits multiples » : prédicats, empilé/repère/étiquettes ignorés puis restitués en décochant, plafond de panneaux, échelle commune pour 19 maxima de 0,07 à 1 234 567, grille sans recouvrement pour
  10 tailles, export identique, conseils, i18n, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 60 et 6 060 lignes, clair et sombre (formulaire : case
  masquée sans Séries, champs exclus masqués, tuile enregistrée sans pile ni barres horizontales ; option = calcul pur ; géométrie dans la tuile sans recouvrement ; **clic réel de souris** sur une barre d'un panneau,
  infobulle limitée à la série survolée, estompage dans tous les panneaux, 2e clic = retiré ; agrandissement = panneaux plus grands puis retour exact ; courbe en aire lissée ; décocher = graphique unique sans refit ;
  14 séries = 12 panneaux + note + conseil ; nom de série hostile (`<img onerror>`) sans HTML injecté ; les quatre styles globaux ; export).
- **Constat visuel** : avec 12 panneaux dans une tuile de 224 px, les barres sont fines mais lisibles et l'échelle commune montre aussitôt quelles séries dominent ; dans un panneau étroit ECharts n'écrit qu'un nom
  de catégorie sur deux et tronque les autres (« Ch… » pour Charlie), et sous 24 px par nom ils sont retirés (l'infobulle les donne). Rendu dans un vrai Grist / GFS : non testé ici.

### Tuiles usuelles des outils BI — lot 3, soleil (18/11/2026)

- **Ce qui est livré** (PR 14 du plan, §5.3 de `etudes/tuiles-usuelles-dashboard-2026-11-18.md`) : un nouveau type « Soleil (anneaux hiérarchiques) » (`type: 'sunburst'`). L'anneau central est `tile.dimension`, les anneaux suivants sont la
  liste « Anneaux suivants » (`tile.drillDimensions`, la même liste de niveaux que pour un camembert, mais ici TOUS se dessinent à la fois et il n'y a PAS de drill-down). Une part d'un anneau est une valeur de sa colonne DANS la part
  de l'anneau d'en dessous ; son angle est la somme (ou le comptage) de ses lignes. Un clic sur une part pose le filtre de CHAQUE anneau jusqu'à elle (un seul filtre par colonne, comme ailleurs) ; remonter (clic sur un anneau plus
  intérieur de la même branche) retire les anneaux plus profonds, un 2e clic sur la même part retire tout ; les parts hors sélection s'estompent. Tri (valeur ou nom, dans chaque anneau), palette et format de nombre comme les
  autres tuiles. Jamais proposé à l'écran d'accueil.
- **Choix** : (1) Somme ou Comptage SEULEMENT (une moyenne ne se répartit pas en sous-parts : le formulaire la refuse, un ancien réglage est lu comme une somme et le conseil le dit) ; (2) au plus 4 anneaux (centre + 3) et 15 parts par part
  parente (les plus grandes), au-delà les petites parts sont comptées (note + conseil) et leur place reste un VIDE dans l'anneau (le parent garde sa vraie taille : un parent rétréci aux seuls enfants dessinés mentirait) ; (3) une
  ligne sans valeur au 1er anneau est ignorée, sans valeur plus profond elle s'arrête à l'anneau d'avant (sa valeur reste dans la part parente) ; (4) une part de taille nulle ou négative n'a pas d'angle : non dessinée, signalée,
  mais gardée dans l'export Excel (une ligne par part où des lignes s'arrêtent, la somme des lignes de l'export est celle des lignes retenues) ; (5) la couleur d'une racine vient de la palette, ses descendants s'éclaircissent
  vers la couleur de la carte ; (6) le survol n'estompe rien (`emphasis.focus: 'none'` : l'estompage par défaut d'ECharts ressemblait à un filtre) ; (7) pas de fil d'Ariane « cliquer pour détailler » ; (8) « + Niveau » du formulaire
  s'arrête à 3 anneaux supplémentaires et la case « filtre croisé » du drill-down est masquée.
- **Valeurs par défaut** : deux catégories de 2 à 15 valeurs, de préférence une VRAIE hiérarchie jugée sur les valeurs (chaque valeur de la colonne du dehors n'apparaît que sous une valeur de la colonne du centre), sinon les deux
  premières ; Somme (Comptage sans mesure).
- **Pas fait, à décider** : zoom sur une part (clic = recentrer l'arbre sur elle, comme `nodeClick: 'rootToNode'` d'ECharts) — écarté, un clic filtre déjà ; part « Autres » regroupant les petites parts écartées ; anneaux au-delà
  de 4 ; clic sur le centre pour tout retirer.
- **Conseils** : moyenne/min/max (avertissement), valeurs négatives (avertissement), plus de 4 anneaux (avertissement), plus de parts centrales que de couleurs (conseil), petites parts écartées (conseil).
- **Testé** : Node (bloc « soleil » : niveaux, arbre — valeurs, ignorées, écartées, négatives, somme de l'export —, comptage, BigInt et chaînes numériques, plafond et tri, filtres de chaque anneau dont l'enchaînement de clics sur le
  vrai store, part retenue, types, export, défauts, conseils, i18n fr/en et pluriels, câblage) ; Playwright contre le vrai `index.html` + `grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 20 et 6 020 lignes,
  clair et sombre (formulaire : anneaux et libellés, moyenne refusée, colonne en double refusée, enregistrement — le plafond de « + Niveau » n'est lu que dans les sources ; option = calcul pur à tous les anneaux ; **clics réels de souris** sur une part de chaque anneau : filtres posés,
  remontée, 2e clic, voisin de la même branche, estompage ; infobulle ; agrandissement = anneaux plus grands ; tri ; comptage ; conseils ; changement de type et retour ; édition ; 20 produits sous une région = 15 + note +
  conseil ; noms hostiles `<img onerror>` sans HTML injecté ; les quatre styles globaux ; export).
- **Constat visuel** : dans une tuile de 224 px le soleil est petit (~65 px de rayon à trois anneaux, en sombre comme en clair) : les noms ne tiennent que sur les grandes parts et l'infobulle donne le reste ; agrandir la tuile suffit (rayon x3).
  Avec beaucoup de petites parts sous une même part (20 produits), les noms se tassent (« Nor… ») : c'est l'avertissement « plus de 15 » qui le dit. Rendu dans un vrai Grist / GFS : non testé ici.

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
- **Hiérarchies non temporelles suggérées AUTOMATIQUEMENT** (ex. Pays > Région > Ville, un clic qui
  préremplirait les niveaux tout seul) : le drill-down hiérarchique automatique (voir l'entrée
  dédiée plus haut) ne couvre QUE les colonnes classées "date" par `inferColumnKind` — non tenté
  pour le reste, comme prévu explicitement par ROADMAP.md ("une suggestion à confirmer, jamais une
  config silencieuse"), faute d'un signal fiable (pas de lecture du vrai type Grist, pas de
  métadonnées de relation entre colonnes dans ce POC). **Ne pas confondre avec la configuration
  MANUELLE d'une telle hiérarchie (via "+ Niveau"), qui fonctionne déjà — voir l'entrée dédiée
  ci-dessous, ajoutée le 2026-10-21.**

- **Drill-down hiérarchique NON temporel, configuré manuellement** (ex. Région > Produit > Année,
  type "Pays > Région > Ville" demandé par Antoine le 2026-10-21, ROADMAP.md Tier 2) : vérifié que
  ceci fonctionnait déjà SANS AUCUN changement de code, avant d'écrire la moindre ligne. Preuve :
  - `js/data.js:tileDrillLevels`/`currentDimension` et `js/state.js:drillInto`/`drillUp` ne lisent
    que `tile.drillDimensions` (un tableau de noms de colonnes) — aucun des deux n'appelle
    `inferColumnKind` ni n'inspecte autrement le type d'une colonne. Seule la fonctionnalité
    SÉPARÉE "Détailler par Année/Trimestre/Mois/Jour" (`#tile-suggest-date-hierarchy`, voir
    l'entrée "Drill-down hiérarchique automatique" ci-dessus) est restreinte aux colonnes date —
    elle ne fait que PRÉREMPLIR le même tableau `drillDimensions` générique, via `setDrillLevels`.
  - Le formulaire de tuile (`js/main.js`) expose déjà un bouton "+ Niveau" (`#tile-drill-add-level`,
    livré avec #14 lors de la généralisation "à N niveaux", voir le commentaire de
    `createDrillLevelSelect`) qui ajoute un combobox de PLUS, rempli avec `availableColumns(rows)` —
    c'est-à-dire absolument toutes les colonnes, catégorielles comprises, jusqu'à
    `MAX_DRILL_LEVELS = 5`. Les tests Node existants du drill-down (`dev-tests/test-data.js`,
    section "state: drill-down multi-niveaux") utilisaient déjà des noms de colonnes génériques
    (`'Mois'`, `'Semaine'`) sans jamais passer par `deriveDateHierarchyColumns` — un premier indice
    déjà présent avant cette session, mais jamais vérifié explicitement avec une hiérarchie
    PUREMENT catégorielle ni avec un vrai clic navigateur.
  - **Testé sous Node** (nouveau bloc `dev-tests/test-data.js`, juste après le test de
    `data.tileDrillLevels`) : tuile `dimension: 'Region'`, `drillDimensions: ['Produit', 'Annee']`
    (mélange catégoriel + numérique, aucune colonne dérivée de date) ; `rowsForTile` +
    `groupByAggregate` au niveau racine, puis après `drillInto('Region', 'Nord')` (niveau Produit),
    puis après `drillInto('Produit', 'Casque audio')` (niveau Année) — les trois niveaux
    d'agrégation obtenus correspondent exactement aux lignes attendues à la main.
  - **Testé en Playwright** contre `dev-tests/harness.html` (script ad hoc, non committé, voir §5 de
    CLAUDE.md), servi en HTTP local : formulaire rempli à la main (dimension `Region`, niveau 1
    `Produit` via le combobox déjà présent au chargement, "+ Niveau" cliqué pour ajouter un niveau 2
    `Annee`), tuile "Barres" soumise sur `Montant`/somme. Un clic réel sur une barre de la tuile
    nouvellement créée a bien fait apparaître le fil d'Ariane `Region ▸ Sud · Produit` (dimension
    affichée passée de `Region` à `Produit`, exactement comme pour une hiérarchie temporelle) ; un
    clic sur le lien racine du fil d'Ariane (`data-depth="0"`) a bien fait remonter à la racine
    (`Region (cliquer pour détailler par Produit)`). Confirme que `getOrCreateChartInstance`
    (gestionnaire de clic générique, `js/charts.js`) ne traite pas non plus différemment un niveau
    catégoriel d'un niveau temporel.
  - **Conclusion** : la demande d'Antoine du 2026-10-21 ("hiérarchies de colonnes catégorielles
    définies par l'utilisateur, par exemple Pays > Région > Ville, en plus des hiérarchies
    temporelles") était déjà satisfaite par le Tier 1 "Drill-down manuel N niveaux" (✅ fait
    2026-09-15) — aucune tuile n'a besoin d'une colonne date pour avoir un drill-down à plusieurs
    niveaux. Seul un éventuel bouton de SUGGESTION en un clic pour un enchaînement catégoriel
    connu à l'avance (ex. mémoriser qu'une telle liste de colonnes forme toujours "Pays > Région >
    Ville" pour ne plus avoir à les re-choisir à chaque tuile) resterait à faire si souhaité — non
    demandé explicitement, donc non tenté ici (voir CLAUDE.md : ne pas construire au-delà de ce qui
    est demandé).

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
    réelles Grist** : l'export (voir `js/export.js` ; `XLSX.writeFile` avant le 18/11/2026) crée un Blob + une ancre `<a download>`
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
    **Le format lui-même est désormais pris en charge — voir le point 15 ci-dessous** : un nombre
    (secondes epoch UTC) est reconverti en chaîne ISO à la lecture, donc `TRY_CAST(... AS
    DATE)`/`parseDateValue` reçoivent bien le format attendu — pour la table de travail
    (`BI_StressTest`) ET, depuis le correctif généralisé du même jour (PR #17), pour une table
    arbitraire choisie via le sélecteur de table (lecture des vrais types via `_grist_Tables_column`).
15. **Vérification du format réel de l'API Grist pour trois points précis, demandée le 29/09/2026
    après la livraison du drill-down et des commentaires collaboratifs** (la campagne réelle du
    19/09/2026, §"Validé en conditions réelles" plus haut dans ce document, avait testé le volume,
    l'idempotence, l'export et le redimensionnement, mais jamais le format des valeurs Date/Reference
    ni la collision `AddTable` sur une table créée depuis) :
    - **Colonnes `Date`/`DateTime` en nombre (secondes epoch UTC), pas en chaîne ISO** — voir CLAUDE.md
      §7 piège n°16 pour le diagnostic complet. Directement pertinent : la colonne `Date` de
      `BI_StressTest` (`js/demo-data.js:COLUMNS_LARGE`) est réellement typée `Date` côté Grist.
      **Corrigé** : `GristBI.data.tableToRows(table, dateColumnIds)` (nouveau 2e paramètre optionnel,
      `js/data.js`) reconvertit en 'AAAA-MM-JJ' toute valeur numérique d'une colonne listée dans
      `dateColumnIds` — jamais une conversion aveugle par valeur (une vraie mesure numérique qui
      tomberait par coïncidence dans une plage plausible d'epoch n'est jamais touchée, seul l'id de
      colonne compte). Appelé depuis `js/grist-api.js` (`dateColumnIdsFrom(columns)`, calculé à
      partir du schéma JS connu de ce widget) dans `loadOrCreateTable`/`ensureColumnsUpToDate` — donc
      pour `BI_StressTest` ET `BI_Dashboard_Comments`, les deux seules tables dont ce widget connaît
      le schéma à l'avance. **Généralisé le même jour (PR #17), à la demande du coordinateur du
      projet** : le cas laissé ouvert par le premier correctif était en réalité le cas PRINCIPAL, pas
      un cas limite — Antoine choisit ses propres tables via le sélecteur, avec ses propres colonnes
      Date, jamais couvertes par un schéma JS statique. `grist-api.js:realDateColumnIds(tableId)` lit
      le VRAI type de chaque colonne via les tables système Grist (`_grist_Tables`/
      `_grist_Tables_column`, accessible avec l'accès `full` déjà demandé — voir CLAUDE.md §6,
      correction technique du 2026-09-15, qui avait déjà identifié cette lecture comme possible,
      jamais faite avant ce jour) : couvre désormais `loadTable()` (sélecteur de table, data
      blending) aussi, plus seulement les deux tables au schéma JS connu. Une heuristique sur la
      seule valeur (plage plausible d'epoch, sans lecture de métadonnées) avait été envisagée pour le
      premier correctif et jugée trop fragile (risque de faux positif sur une vraie mesure numérique)
      — la lecture des vrais types s'est révélée une solution plus propre, sans ce risque, une fois
      relevé que l'accès `full` déjà demandé par ce widget suffisait à la rendre possible sans
      négociation d'accès supplémentaire. Repli sur `[]` (comportement du premier correctif) si
      cette lecture échoue — droits restreints, ou tables système absentes/renommées dans une future
      version de Grist : dans ce cas, seul le schéma JS statique continue de couvrir
      `BI_StressTest`/`BI_Dashboard_Comments`, sans crash.
      - **Testé sous Node** (`dev-tests/test-data.js`) : `tableToRows`/`epochSecondsToIsoDate`, y
        compris le cas adversarial d'une mesure numérique dont la valeur coïncide avec un epoch
        plausible sur une colonne NON listée dans `dateColumnIds` (doit rester un nombre, jamais
        convertie).
      - **Fidélité du mock améliorée** (`dev-tests/grist-stub.js`) : une colonne déclarée `Date` (via
        `AddTable`/`AddColumn`) est désormais sérialisée en nombre par `AddRecord`/`UpdateRecord`,
        comme le ferait réellement Grist — avant ce correctif, le mock renvoyait fidèlement la chaîne
        ISO écrite par le widget, donc AUCUN test de ce dépôt n'aurait pu détecter cette régression.
        Ce point rejoint la même leçon méthodologique que le bug `manualSort` (piège n°4 de
        TEST_PROTOCOL.md) : un mock qui ne reproduit pas un comportement réel du moteur masque
        silencieusement toute régression sur ce point.
      - **Testé sous Playwright** (bout en bout, mock fidèle) : `grist.docApi.fetchTable` renvoie bien
        un nombre pour `Date` ; les lignes reconstituées en mémoire (`GristBI.store.getState().rows`)
        ont bien `Date` en chaîne ISO ; le bouton de suggestion de hiérarchie de drill-down (PR #14,
        n'apparaît QUE pour une colonne classée "date" par `inferColumnKind`) réapparaît correctement
        pour la colonne `Date` malgré son format brut numérique — preuve bout en bout que le correctif
        couvre bien le chemin réellement utilisé par le widget, pas seulement la fonction isolée.
      - **Généralisation (PR #17) testée sous Playwright** : une table arbitraire ("VentesRegion",
        jamais connue du schéma JS statique de ce widget), choisie via `#table-select`, avec une
        colonne `DateVente` réellement typée `Date` uniquement dans les métadonnées système
        (`_grist_Tables`/`_grist_Tables_column` simulées par le mock) — la valeur est bien convertie
        en ISO, le bouton de suggestion de hiérarchie apparaît pour `DateVente`, et les colonnes
        dérivées Année/Trimestre/Mois (PR #14) se calculent correctement dessus, malgré l'absence
        totale de schéma statique pour cette table. Vérifié aussi : `_grist_Tables`/
        `_grist_Tables_column` n'apparaissent jamais dans `listTables()` (pas de fuite dans le
        sélecteur), et un échec de cette lecture (droits restreints simulés) se replie proprement sur
        le schéma JS statique pour `BI_StressTest`, sans crash.
      - **Non vérifié depuis cette session** : le format exact affirmé ici (secondes depuis l'epoch
        UTC pour `Date`) et la forme exacte de `_grist_Tables_column` (`parentId`/`colId`/`type`,
        `DateTime:<fuseau>`) viennent de la documentation/du comportement connu du moteur Grist, pas
        d'un nouvel aller-retour contre un vrai document Grist ouvert pendant cette investigation (la
        campagne du 19/09/2026 ne l'avait pas testé non plus, voir plus haut). Une vérification à la
        console d'un vrai widget (`JSON.stringify(await grist.docApi.fetchTable('_grist_Tables_column'))`)
        reste le seul point de confirmation manquant. Une colonne `DateTime:<fuseau>` est désormais
        traitée comme `Date` par `realDateColumnIds` (même conversion en 'AAAA-MM-JJ', composante
        horaire perdue — `parseDateValue` ne sait de toute façon gérer qu'une précision journalière) ;
        `dateColumnIdsFrom` (schéma JS statique) reste volontairement limité à `Date` seul, aucune
        colonne de ce projet n'utilisant `DateTime`.
    - **Colonnes `Ref:` (référence) renvoyées en id brut** — déjà couvert, sans changement de code
      nécessaire : voir l'entrée du 2026-09-15 sur `blendJoinColumns()`/l'ajout de `id` comme clé de
      jointure sélectionnable (§ data blending, plus haut dans ce document). Le mécanisme retenu à
      l'époque est délibérément agnostique de la forme réelle que Grist choisit de renvoyer (id brut
      ou texte résolu) : `id` couvre le premier cas, n'importe quelle colonne texte ordinaire couvre
      le second — donc peu importe laquelle des deux formes le moteur Grist réel utilise
      effectivement, déjà documenté comme "non-vérifiable depuis ce sandbox" à l'époque et toujours
      dans cet état, sans que cela bloque la fonctionnalité.
    - **Collision `AddTable` sur `BI_Dashboard_Comments` (table de la #15, jamais exercée avant ce
      jour)** : `loadOrCreateTable` (le mécanisme idempotent + son filet de sécurité anti-collision,
      voir CLAUDE.md §3/§7 piège n°1) est PARTAGÉ, verbatim, sans aucune branche spécifique à une
      table — déjà utilisé et vérifié pour `BI_StressTest`/`BI_Dashboard_Config`. **Testé sous
      Playwright** : reconnexion à un document où `BI_Dashboard_Comments` contient déjà un commentaire
      d'une session précédente (`__gristStubPreseed`) — le commentaire est relu sans perte ni
      duplication, aucune table `BI_Dashboard_Comments2` orpheline n'apparaît, aucun crash JS pendant
      tout le bootstrap. **Le filet de sécurité anti-collision `AddTable` lui-même (le cas où
      `tableExistsConfirmed` se trompe malgré son budget d'attente) n'a volontairement pas été
      rejoué spécifiquement pour les commentaires** : le forcer artificiellement via
      `__gristStubCollideOnAddTable` sans données réelles préexistantes sous ce nom fait planter
      `ensureColumnsUpToDate`/`AddColumn` du mock (`t` vaut alors `undefined`) — un vrai moteur Grist
      ne collisionnerait jamais sans données réelles déjà présentes sous ce nom, donc ce scénario
      artificiel ne correspond à aucun cas réel possible ; le reproduire fidèlement demanderait de
      fausser `listTables()` (`__gristStubRaceCalls`) au moment précis du contrôle des commentaires
      SANS fausser celui de `BI_StressTest` (contrôlé juste avant, dans le même budget de garde) —
      jugé disproportionné pour un mécanisme déjà prouvé correct par le partage de code avec les deux
      autres tables, plutôt qu'une lacune réelle laissée sans réponse.

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
