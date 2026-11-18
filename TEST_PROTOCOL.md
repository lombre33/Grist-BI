# Protocole de test unitaire — exhaustif et vivant

## Principe

Ce document catalogue TOUS les cas de test connus pour ce widget, module par module. Il grandit à
chaque nouvelle feature — c'est voulu, pas un problème : la checklist devient plus longue avec le
temps, exactement comme le logiciel devient plus riche.

**Process** :
1. **À chaque ajout de feature** : les cas de test associés sont ajoutés à ce document (section
   correspondante, ou nouvelle section), qu'ils soient déjà automatisés ou non.
2. **Automatisation** : dès que raisonnable, chaque cas coché ✅ ci-dessous a une assertion réelle
   dans `dev-tests/test-data.js` (logique pure, Node) ou un scénario Playwright documenté (rendu
   navigateur). Un cas marqué ⬜ est documenté mais pas encore automatisé.
3. **Exécution** : `node dev-tests/test-data.js` (+ la suite Playwright quand elle existe) est
   lancé de temps en temps — pas obligatoirement à chaque feature — typiquement avant un commit qui
   touche plusieurs modules, ou après une période de développement dense.
4. **Régression** : toute case cochée [BUG RÉEL] provient d'un bug qui a vraiment existé en prod ou
   en dev — ne JAMAIS la retirer même si le code correspondant est refactoré, seulement l'adapter.

## Checklist méthodologique — à appliquer à CHAQUE nouvelle feature

Ces catégories ont directement permis de trouver les bugs réels listés plus bas. Avant de considérer
une feature "testée", vérifier qu'on s'est posé chacune de ces questions :

- [ ] **Cas nominal** : le chemin heureux fonctionne avec des données représentatives.
- [ ] **Données vides/zéro** : tableau vide, 0 ligne, mesure à 0, aucun résultat après filtrage.
- [ ] **Valeurs limites** : min/max, négatif, très grand nombre, une seule catégorie, un seul groupe.
- [ ] **Coercion de type** : une valeur numérique comparée à une chaîne (ex. clic ECharts =
  `params.name` toujours string) — utiliser `sameValue`, jamais `===` nu, sur toute nouvelle
  comparaison de valeur de donnée.
- [ ] **Ordre non trivial** : les données ne sont volontairement PAS dans l'ordre alphabétique dans
  le test, pour ne pas masquer un tri implicite par coïncidence.
- [ ] **Combinaison avec les features existantes** : la nouvelle feature interagit-elle avec le
  cross-filtering, le drill-down, les bookmarks, les tuiles KPI ? Tester au moins une combinaison
  réaliste, pas seulement la feature isolée.
- [ ] **Round-trip de persistance** : si la feature ajoute un champ sauvegardé, vérifier qu'il
  survit à un save/load (`loadConfig`/`saveConfig`), et que l'ANCIEN format (sans ce champ) reste
  lisible sans erreur (rétrocompatibilité).
- [ ] **Idempotence** : une action répétée (clic deux fois, rechargement) ne duplique/ne renvoie
  rien à Grist si l'état est déjà correct.
- [ ] **Nettoyage à la suppression/édition** : supprimer ou éditer l'élément qui a produit cet état
  (tuile, filtre, bookmark) ne laisse pas de référence fantôme ailleurs dans le store.
- [ ] **Visibilité RÉELLE, pas juste l'état JS** : tout champ conditionnellement masqué
  (`.hidden = true/false`) doit être vérifié avec `isHidden()`/`isVisible()` en Playwright, PAS
  seulement en lisant la propriété JS — une règle CSS peut silencieusement annuler le masquage
  (voir [BUG RÉEL] `.field[hidden]` ci-dessous).
- [ ] **Closure figée** : tout gestionnaire d'événement créé une seule fois (cache d'instance,
  callback enregistré au montage) doit relire l'état vivant du store à chaque déclenchement, pas
  capturer une référence au moment de sa création (voir [BUG RÉEL] closure ECharts ci-dessous).
- [ ] **Réel vs mock** : si le cas dépend du vrai `grist.docApi` (timing réseau, comportement Grist
  réel), le noter explicitement comme non vérifiable depuis le mock (`dev-tests/grist-stub.js`) et
  le lister dans `HYPOTHESES.md` plutôt que de le considérer "testé".
- [ ] **Rendu visuel réel, pas juste "ça ne plante pas"** : pour tout ce qui touche à l'affichage
  d'un graphique (nouveau type de tuile, changement de palette/format d'axe, volume de données plus
  grand), prendre une capture d'écran Playwright et la regarder — un test qui vérifie seulement
  l'absence d'erreur JS peut laisser passer un rendu visuellement cassé (voir [BUG RÉEL] libellés
  d'axe tronqués ci-dessous, détecté uniquement en regardant une capture, aucune erreur JS levée).
- [ ] **Stabilité dans le temps, pas juste un instant T** : pour tout ce qui touche à la mise en page
  d'une tuile contenant un graphique ECharts (CSS flex/grid autour de `.tile-chart`, tout ce qui
  déclenche `resizeAll()`), mesurer sa hauteur/largeur réelle à PLUSIEURS instants successifs (pas
  juste une fois après le rendu), pour détecter une boucle de rétroaction resize↔layout qui grandit
  ou rétrécit progressivement — invisible sur un seul screenshot statique OU une seule lecture d'état
  (voir [BUG RÉEL] tuiles qui s'étirent à l'infini ci-dessous, repéré uniquement en comparant la
  hauteur sur 8 échantillons dans le temps).

## Catalogue exhaustif par module

### `js/data.js` — fonctions pures (Node, `dev-tests/test-data.js`)

- [x] `groupByAggregate` — sum ✅
- [x] `groupByAggregate` — avg ✅
- [x] `groupByAggregate` — count ✅
- [x] `groupByAggregate` — min/max ⬜ (agrégateurs testés individuellement ailleurs, pas via groupByAggregate)
- [x] `groupByAggregate` — préserve l'ordre de première apparition, PAS alphabétique [BUG RÉEL : "Mois" triait Avril avant Janvier] ✅
- [x] `applyFilters` — un seul filtre ✅
- [x] `applyFilters` — AND entre plusieurs filtres (aucune ligne ne matche tous) ✅
- [x] `applyFilters` — tableau vide / null → toutes les lignes ✅
- [x] `sameValue` — nombre vs chaîne équivalente (`2025` vs `'2025'`) [BUG RÉEL : clic ECharts toujours string, filtrait tout silencieusement] ✅
- [x] `sameValue` — valeurs différentes → false ✅
- [x] `computeTrend` — delta % correct sur 2 groupes numériques ✅
- [x] `computeTrend` — dimension null → null (pas de tendance) ✅
- [x] `computeTrend` — 1 seul groupe → null (pas un delta absurde) ✅
- [x] `computeTrend` — dimension non numérique (texte) → null ✅
- [ ] `computeTrend` — plus de 2 groupes (doit comparer les 2 plus récents seulement) ⬜
- [ ] `computeTrend` — valeurs négatives (delta négatif correctement signé) ⬜
- [x] `escapeHtml` — `<script>&"'` échappé ✅
- [x] `aggregateSingle` — sum/max ✅
- [ ] `aggregateSingle` — avg/count/min ⬜
- [x] `pivotTable` — sum : ordre de 1re apparition (lignes ET colonnes, pas alphabétique), cellule sans donnée à une intersection → `null` (pas `0`), totaux ligne/colonne/général corrects ✅
- [x] `pivotTable` — avg : totaux calculés en ré-agrégeant les lignes réelles, PAS en recombinant les cellules déjà agrégées (cas construit où moyenne-des-cellules ≠ vraie moyenne) ✅
- [x] `pivotTable` — jeu de données vide → structure vide (`rowKeys`/`colKeys`/`cells` à `[]`, `grandTotal: 0`), pas de plantage ✅
- [ ] `pivotTable` — min/max (mêmes agrégateurs que `aggregateSingle`/`groupByAggregate`, mêmes chemins de code, pas de cas dédié) ⬜
- [x] `tableToRows` — format colonnaire → lignes ✅
- [x] `tableToRows` — exclut les colonnes techniques ajoutées par Grist lui-même (`manualSort`) [BUG RÉEL #19 ci-dessous] ✅
- [x] `tileDrillLevels` — nouveau format tableau ✅
- [x] `tileDrillLevels` — ancien format chaîne unique (compat) ✅
- [x] `tileDrillLevels` — tuile sans drill-down → `[]` ✅
- [x] `matchesFilter`/`applyFilters` — type `range` : bornes min/max chacune optionnelle indépendamment, valeur non numérique jamais matchée ✅
- [x] `matchesFilter`/`applyFilters` — type `dateRange` : bornes `start`/`end` inclusives des deux côtés, chacune optionnelle indépendamment ✅
- [x] `matchesFilter`/`applyFilters` — type `relativeDate` : preset connu calcule la bonne plage, preset inconnu → aucune ligne ne matche (pas d'erreur) ✅
- [x] `matchesFilter`/`applyFilters` — type `contains` : insensible à la casse, chaîne de recherche vide matche tout ✅
- [x] `matchesFilter`/`applyFilters` — un filtre "eq" (clic) et des filtres avancés typés combinés en ET dans la même liste ✅
- [x] `parseDateValue` — format ISO valide → timestamp, format non-ISO (ex. `JJ/MM/AAAA`) → `null` plutôt que mal interprété, chaîne non-date → `null` ✅
- [x] `relativeDateRange` — `now` explicite plutôt que l'horloge réelle (testable sous Node), preset inconnu → `null` ✅
- [ ] `matchesFilter` — type `range`/`dateRange` avec `min > max` ou `start > end` (bornes incohérentes) — non gardé dans `data.js` lui-même (le formulaire de `main.js` empêche de le soumettre, mais la fonction pure ne le revalide pas) ⬜
- [x] `currentDimension` — dimension racine si `drillPath` vide/`undefined`, sinon le niveau correspondant à la profondeur atteinte ✅
- [x] `rowsForTile` — la tuile SOURCE d'un filtre croisé ne le subit pas elle-même (reste cliquable sur tous ses segments), une AUTRE tuile le subit ✅
- [x] `rowsForTile` — les filtres avancés s'appliquent à TOUTES les tuiles sans exception, y compris la source d'un filtre croisé ✅
- [x] `rowsForTile` — le drill-down propre à la tuile s'applique même pour la tuile source d'un filtre croisé ✅
- [x] Drill-down hiérarchique NON temporel (Région > Produit > Année, colonnes catégorielles et
  numérique mélangées, aucune colonne dérivée de date) — `currentDimension`/`groupByAggregate` sur
  3 niveaux successifs renvoient l'agrégat attendu à chaque profondeur ✅ ; clic réel niveau 1 et
  remontée via le fil d'Ariane contre `dev-tests/harness.html` 🌐 (script ad hoc, non committé —
  voir HYPOTHESES.md, entrée du 2026-10-21)
- [x] `tileExportSheet` — bar (header/rows agrégés comme le rendu) ✅
- [x] `tileExportSheet` — kpi (repli du nom de feuille sur `aggFn(measure)` si `tile.title` absent) ✅
- [x] `tileExportSheet` — scatter (2 mesures alignées par nom de dimension, pas par index) ✅
- [x] `tileExportSheet` — tuile entièrement filtrée (0 ligne) → en-têtes présents, `rows: []` (pas planté, pas d'en-tête absent) ✅
- [x] `tileExportSheet` — pivot (grille + ligne/colonne "Total", cellule sans donnée exportée en chaîne vide plutôt que `0`) ✅
- [ ] `tileExportSheet` — gauge, treemap ⬜ (mêmes chemins de code que kpi/bar respectivement, pas de cas Playwright/Node dédié)
- [x] `sanitizeSheetName` — caractères interdits Excel (`: \ / ? * [ ]`) remplacés par des espaces ✅
- [x] `sanitizeSheetName` — troncature à 31 caractères ✅
- [x] `sanitizeSheetName` — collision de nom → suffixe `" (n)"`, jamais un nom dupliqué dans le classeur ✅
- [x] `buildWorkbookSheets` — une seule page → pas de préfixe de nom de page ✅
- [x] `buildWorkbookSheets` — plusieurs pages → préfixe `"NomPage - "` sur chaque feuille, toutes pages confondues dans le même classeur ✅

### `js/state.js` — store pub/sub (Node, `dev-tests/test-data.js`)

- [x] `toggleFilter` — activation ✅
- [x] `toggleFilter` — reclic même valeur → désactive ✅
- [x] `toggleFilter` — clic autre valeur même colonne → remplace ✅
- [x] `toggleFilter` — clic colonne différente → cumule (ET) ✅
- [x] `clearFilter(column)` — efface un seul filtre ✅
- [x] `clearFilter()` — efface tout ✅
- [x] `drillInto`/`drillUp` — empilage multi-niveaux ✅
- [x] `drillInto`/`drillUp` — remontée à une profondeur partielle ✅
- [x] `drillInto`/`drillUp` — remontée complète (sans argument) ✅
- [x] `drillUp` — no-op si déjà à la racine (pas d'erreur) ✅
- [x] `drillInto`/`drillUp` avec `drillCrossFilter: true` — filtre croisé synchronisé au chemin ✅
- [x] `drillInto`/`drillUp` avec `drillCrossFilter: false` — aucun filtre croisé posé ✅
- [x] `removeTile` — nettoie `drillIns` de la tuile supprimée ✅
- [x] `removeTile` — nettoie les filtres croisés (toggle + drill) posés par la tuile supprimée [BUG RÉEL potentiel évité] ✅
- [x] `updateTile` — édition en place, position conservée, champs non modifiés préservés ✅
- [x] `updateTile` — réinitialise le drill-down en cours quand `drillDimensions` change [BUG RÉEL potentiel évité : filtre fantôme sans fil d'Ariane pour le signaler] ✅
- [x] `addTile`/`removeTile` — pas de doublon, tuile voisine inchangée ✅
- [x] `moveTile` — déplacement réel, ordre vérifié ✅
- [x] `moveTile` — no-op en bout de liste (les deux extrémités) ✅
- [x] `moveTile` — no-op id inconnu (pas d'erreur) ✅
- [x] `saveBookmark`/`applyBookmark` — capture activeFilters+drillIns, PAS les tuiles ✅
- [x] `removeBookmark` — puis `applyBookmark` sur id supprimé → no-op ✅
- [ ] Deux bookmarks avec le même nom (doublon de libellé, pas d'id) ⬜
- [ ] `applyBookmark` pendant qu'une tuile référencée par le bookmark n'existe plus (tuile supprimée depuis) ⬜
- [x] `addTile`/`removeTile`/`updateTile`/`moveTile` n'agissent que sur `currentPage().tiles`, les autres pages restent intactes ✅
- [x] `addPage` — navigue automatiquement vers la page créée, celle-ci démarre sans tuile ✅
- [x] `setCurrentPage` — id inconnu → no-op (pas d'erreur, pas de changement de `currentPageId`) ✅
- [x] `renamePage` — renomme la bonne page, ne touche pas aux autres ✅
- [x] `removePage` — nettoie `drillIns`/`activeFilters` des tuiles de la page supprimée, bascule `currentPageId` sur une page restante si c'était la page courante ✅
- [x] `removePage` — garde-fou : jamais de tableau de pages vide (no-op sur la dernière page restante) ✅
- [x] `activeFilters`/`drillIns` restent GLOBAUX au changement de page (décision produit délibérée, voir HYPOTHESES.md) ✅
- [x] `setPages` — charge un tableau de pages complet + `currentPageId`, avec repli sur la première page si le `currentPageId` fourni ne correspond à aucune page ✅
- [x] `setPages` — un tableau de pages vide retombe sur une page par défaut (jamais zéro page) ✅
- [x] `setAdvancedFilter` — pose un filtre avec son `type` + champs spécifiques, au plus un par colonne ✅
- [x] `setAdvancedFilter` — reposer sur la MÊME colonne remplace l'ancien plutôt que de le cumuler ✅
- [x] `setAdvancedFilter` — colonnes différentes se cumulent (ET) ✅
- [x] `clearAdvancedFilter(column)` — retire seulement celui-là ✅
- [x] `clearAdvancedFilter()` — sans argument, retire tout ✅
- [x] `saveBookmark`/`applyBookmark` capturent `advancedFilters` au même titre que `activeFilters`/`drillIns` ✅
- [x] `applyBookmark` sur un bookmark sans champ `advancedFilters` (sauvegardé avant cette feature) → restaure `[]`, pas `undefined` [compat ascendante] ✅

### `js/combobox.js` (Node pour la logique pure, Playwright pour le câblage DOM — demande explicite de l'utilisateur : autocomplétion partout où l'on choisit une colonne)

- [x] `filterOptions` — sous-chaîne insensible à la casse, ordre d'origine préservé (pas alphabétique) ✅
- [x] `filterOptions` — query vide → toutes les options (état du menu à l'ouverture avant saisie) ✅
- [x] `filterOptions` — espaces superflus dans la query ignorés (`trim()`) ✅
- [x] `filterOptions` — aucune option ne matche → tableau vide ✅
- [x] `highlightMatch` — découpe correcte autour de la 1re occurrence, insensible à la casse mais la casse D'ORIGINE du texte est conservée dans `match` ✅
- [x] `highlightMatch` — query vide/sans match → `match` vide (pas de surlignage) ✅
- [x] `attach` — focus (ou clic sur un champ déjà rempli) ouvre le menu avec TOUTES les options, blank en premier si prévu 🌐
- [x] `attach` — cliquer un champ qui a DÉJÀ le focus (juste après une sélection) rouvre bien le menu [le seul écouteur `focus` ne suffit pas, `click` est nécessaire en plus — un focus déjà là ne redéclenche pas l'événement `focus`] 🌐
- [x] `attach` — taper filtre la liste ET surligne (`<mark>`) le texte tapé dans chaque suggestion 🌐
- [x] `attach` — `ArrowDown`/`ArrowUp` déplacent la sélection active, `Enter` commite et déclenche un vrai événement `'change'` (compatible `addEventListener('change', ...)` existant) 🌐
- [x] `attach` — cliquer une option (souris) commite aussi, sans perdre le clic à cause d'un `blur` prématuré (`mousedown` sur la liste en `preventDefault`) 🌐
- [x] `attach` mode strict — saisie invalide au `blur` → revient à la dernière valeur valide ✅ [ne PAS laisser une colonne inexistante comme valeur, contrairement à un texte libre] 🌐
- [x] `attach` mode strict — `Escape` revient aussi à la dernière valeur valide, sans perdre le focus 🌐
- [x] `attach` mode strict — sélectionner l'option "blank" donne une valeur `''` (chaîne vide), PAS le texte du `blankLabel` affiché (le label n'est qu'un `placeholder`, pas une vraie option textuelle) 🌐
- [x] `attach` mode texte libre (`strict:false`) — accepte une saisie absente de la liste de suggestions, aucune correction forcée au blur 🌐
- [x] `setOptions` — ne plante jamais même si la valeur courante n'existe plus dans la nouvelle liste ✅
- [ ] Plus de `MAX_VISIBLE_OPTIONS` (50) suggestions simultanément — troncature silencieuse, pas de message "+N de plus" ; à revoir si un vrai document Grist a des colonnes avec des centaines de valeurs distinctes (autocomplétion de valeurs, voir plus bas) ⬜
- [x] Taper un nom de colonne EXACT puis Entrée SANS `ArrowDown` préalable commite bien le 1er vrai résultat [BUG RÉEL trouvé en migrant le formulaire réel, absent des tests du composant isolé — voir HYPOTHESES.md] 🌐
- [x] Vider un champ (texte tapé ramené à `''`) puis Entrée commite le "blank", quand `blankLabel` existe 🌐
- [x] Ouverture PASSIVE (focus ou clic, sans frappe) sur un champ déjà rempli ne présélectionne rien — un Entrée immédiatement après ne doit JAMAIS modifier la valeur déjà là 🌐

### `js/main.js` — migration des sélecteurs de colonne vers Combobox (Roadmap Tier 1.5, Playwright)

- [x] Créer une tuile en tapant dimension + mesure via le combobox réel (clic, texte, Entrée) — pas seulement en isolation, dans le VRAI formulaire 🌐
- [x] 3 comboboxes indépendants dans le même formulaire (scatter : dimension/mesure/mesureY) ne se marchent pas dessus (état, listes déroulantes, focus) 🌐
- [x] Drill-down à 2+ niveaux via les comboboxes dynamiques ("+ Niveau"), valeurs correctement capturées dans `drillDimensions` 🌐
- [x] Édition de tuile : les comboboxes se préremplissent avec la bonne valeur ET raffichent TOUTES les options à la réouverture (pas seulement celles qui matchent la valeur déjà là) 🌐
- [x] Barre de filtres avancés : choisir la colonne via le combobox déclenche bien la bascule des champs selon le type inféré (numérique/date/texte), comme avant avec le `<select>` 🌐
- [x] `createDrillLevelSelect`/`truncateDrillLevelsAfter` retirent le wrapper `.combobox` ENTIER (`input.parentElement`), pas l'input seul — sinon un wrapper vide reste orphelin dans le DOM à chaque niveau de drill retiré ✅ (vérifié par relecture du code, pas de test dédié à l'absence d'orphelin DOM)

### `js/grist-api.js` + `js/main.js` — sélecteur de table (Roadmap Tier 1.5, Playwright contre `dev-tests/grist-stub.js`)

**Retrait de `BI_StressTest` (2026-10-21)** : le widget ne crée plus aucune table de données (voir
HYPOTHESES.md/CLAUDE.md §1/§3/§7/§8) — au démarrage, il se connecte désormais en LECTURE SIMPLE à la
1re table renvoyée par `listAvailableTables()`, jamais créée. Les 2 premiers cas ci-dessous sont
adaptés en conséquence ; les suivants (persistance par table, cas `[BUG RÉEL]`) restent inchangés,
`BI_StressTest` n'y étant qu'un exemple de table parmi d'autres.

- [x] Au démarrage, le widget se connecte à la 1re table renvoyée par `listAvailableTables()`,
  sans jamais la créer (`loadTable`, simple lecture) ; les 3 tables internes
  (`BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe`) n'apparaissent JAMAIS dans
  cette liste ni dans le sélecteur — **correctif apporté avec ce retrait** : `BI_Dashboard_Comments`
  manquait du filtre d'exclusion de `listAvailableTables()` (seules Config/UserProbe l'étaient),
  pouvant la faire apparaître dans le sélecteur et même être choisie par erreur comme 1re table au
  démarrage 🌐
- [x] Aucune table dans le document (hors tables internes) → bandeau affiche `status.noTables`
  (message explicite, pas un plantage ni une table créée) ; une table ajoutée ensuite dans Grist est
  atteignable via le sélecteur sans recharger la page (`beforeOpen: refreshTablePicker`, déjà
  existant) 🌐
- [x] `GristBI.api.listAvailableTables()` reflète TOUJOURS une table créée entre-temps (pas de cache figé), même sans repasser par le sélecteur UI 🌐
- [x] Se reconnecter à une autre table via le sélecteur recharge les lignes et démarre sur un dashboard VIDE (plus aucune table n'a de `seedTiles`, retrait du bouton "Restaurer les tuiles par défaut" ci-dessous), les tuiles de l'ancienne table disparaissent 🌐
- [x] Revenir sur une table déjà visitée restaure SA PROPRE configuration déjà sauvegardée (pages/tuiles), config par table 🌐
- [x] Une tuile ajoutée sur une table quelconque est bien persistée et retrouvée en y revenant 🌐
- [x] [BUG RÉEL #12 ci-dessous] Revenir sur une table déjà visitée après un changement de table restaure bien ses tuiles (pas une config vide à cause d'une sauvegarde perdue) 🌐
- [x] [BUG RÉEL #16 ci-dessous] Le sélecteur de table relit bien la liste à CHAQUE ouverture du menu (`beforeOpen`), pas seulement au démarrage/après un changement réussi : une table créée après le chargement du widget reste atteignable sans recharger la page 🌐

### `js/main.js` + `js/demo-data.js` — bouton "Restaurer les tuiles par défaut" (RETIRÉ 2026-10-21)

Bouton retiré avec le reste du code de création de `BI_StressTest` (demande explicite de
l'utilisateur formulée le 2026-09-19, voir HYPOTHESES.md/CLAUDE.md §1/§7/§8) : confirmé par relecture
du diff, son seul usage était de réinjecter `GristBI.demoData.defaultLargeTiles()` (les 4 tuiles de
démo de `BI_StressTest`) — `seedTiles` n'était jamais passé pour aucune autre table. Plus aucune
table n'a de jeu de tuiles par défaut connu du widget, donc plus de bouton pour les restaurer. Les
cas de test ci-dessous ont été retirés AVEC le code qu'ils testaient, pas juste désactivés (même
traitement que la table de démo "rapide" retirée le 2026-09-16, voir plus bas) :
caché tant que la page courante a des tuiles, apparition uniquement sur `BI_StressTest` une fois sa
page vidée, clic réinjectant exactement `defaultLargeTiles()` sur la page courante, jamais visible
sur une autre table, restauration persistée.

### `js/duckdb-engine.js` — fondation moteur SQL DuckDB-WASM (Roadmap Tier 2, Node pour la logique pure, Playwright pour le chargement/SQL réels)

Servi via un petit serveur HTTP local (`http.createServer`, sans dépendance ajoutée), PAS `file://` :
`import()` dynamique de module ES (utilisé pour charger `duckdb-browser.mjs`) est bloqué par CORS
sur une origine `file://` (`"null"`), contrairement aux scripts classiques du reste de ce projet.

- [x] `csvEscape` — virgule/guillemet/retour à la ligne échappés (guillemets internes doublés), `null`/`undefined` -> chaîne vide ✅
- [x] `assertSafeIdentifier` — rejette un nom de colonne contenant un guillemet, une chaîne vide, ou une valeur non-chaîne ✅
- [x] Chargement PARESSEUX : `isReady()` reste `false` et AUCUNE requête réseau ne part tant qu'aucun appel explicite (`init`/`groupByAggregate`/`aggregateSingle`) n'a eu lieu — vérifié en interceptant toutes les requêtes de la page 🌐
- [x] `groupByAggregate` — résultats identiques à `js/data.js:groupByAggregate` sur le jeu de test de charge réel (47 040 lignes), 8 combinaisons dimension/mesure/agrégat couvrant sum/avg/count/min/max 🌐
- [x] `aggregateSingle` — résultats identiques à `js/data.js:aggregateSingle`, mêmes 5 agrégateurs 🌐
- [x] [BUG RÉEL, voir HYPOTHESES.md] AUCUNE requête vers un domaine externe (ex. `extensions.duckdb.org`, l'extension JSON de DuckDB) même APRÈS un usage réel du moteur, pas seulement à l'état initial — régression directe du piège JSON→CSV trouvé en développant cette fondation 🌐
- [x] Garde-fou injection SQL : un nom de colonne contenant un guillemet est rejeté avant construction de la requête, pas inséré tel quel 🌐
- [ ] **[NON TESTABLE ICI]** Comportement réel depuis GitHub Pages (types MIME `.wasm`/`.mjs`, absence de blocage réseau) et à l'intérieur d'une vraie iframe de widget Grist — voir HYPOTHESES.md, point 14 des validations réelles
- [x] Consommation réelle par une feature Tier 2 : mesures façon DAX (Cumul/YTD/N-1, voir la sous-section dédiée ci-dessous) puis, depuis le 2026-10-21, TOUTE tuile au-delà d'un seuil de volume (bar/pie/treemap/scatter/kpi/gauge/pivot, voir la sous-section dédiée plus bas) — le data blending (`blendRows`) reste le seul calcul de ce widget délibérément sans dépendance à ce moteur
- [x] `pivotTable` (nouveau 2026-10-21) — résultats identiques à `js/data.js:pivotTable` sur le jeu de test de charge réel (47 040 lignes) : mêmes `rowKeys`/`colKeys` (ordre de 1re apparition), même `grandTotal`, et TOUTES les cellules identiques une par une (pas seulement les totaux) 🌐

### `js/duckdb-engine.js` + `js/data.js` + `js/charts.js` + `js/main.js` — mesures façon DAX simplifié : Cumul/YTD/Comparaison N-1 (Roadmap Tier 2, Node pour la logique pure, Playwright pour le SQL/le formulaire/le rendu réels)

1re feature à consommer réellement le moteur DuckDB-WASM (voir HYPOTHESES.md). Même contrainte de
service HTTP local que la section précédente (`import()` dynamique bloqué par CORS sur `file://`).

- [x] `duckdbEngine.timeSeriesMeasures` — bucket mensuel correct (2 lignes du même mois agrégées) 🌐
- [x] `duckdbEngine.timeSeriesMeasures` — `cumulative` : somme courante correcte, y compris avec une valeur NÉGATIVE (redescend, pas de plancher à 0) 🌐
- [x] `duckdbEngine.timeSeriesMeasures` — `ytd` : repart de zéro à chaque nouvelle année, `cumulative` lui continue de monter sur la même ligne 🌐
- [x] `duckdbEngine.timeSeriesMeasures` — `previousYear` : `null` pour la 1re année de la série (pas de comparaison possible) ✅ (vérifié aussi sous Node via `measureSeriesForTile`, voir plus bas)
- [x] [garde-fou vérifié, pas un bug réel] `duckdbEngine.timeSeriesMeasures` — `previousYear` retrouve le bon mois via une auto-jointure sur la période même avec un MOIS MANQUANT dans la série (contrairement à un `LAG` à distance de ligne fixe, qui déraperait silencieusement) 🌐
- [x] `duckdbEngine.timeSeriesMeasures` — une ligne dont la colonne date ne parse pas (`TRY_CAST` échoue) est ignorée silencieusement, pas une exception ni une ligne "Invalid Date" 🌐
- [x] `duckdbEngine.timeSeriesMeasures` — tableau `rows` vide -> `[]`, aucun appel SQL déclenché (même contrat que `groupByAggregate`/`aggregateSingle`) ✅
- [x] `duckdbEngine.timeSeriesMeasures` — aucune requête réseau externe pendant l'exécution (même garde que `groupByAggregate`/`aggregateSingle`) 🌐
- [x] `data.periodLabel` — `'AAAA-MM-JJ'` -> `'AAAA-MM'`, valeur inattendue -> `String(valeur)` plutôt qu'une exception ✅
- [x] `data.measureSeriesForTile` — mode `'cumulative'`/`'ytd'` : 1 série avec le bon champ sélectionné ✅
- [x] `data.measureSeriesForTile` — mode `'yoy'` : 2 séries ("Valeur"/"N-1"), les `null` de `previousYear` sont préservés (pas convertis en 0, qui laisserait croire à une vraie valeur nulle) ✅
- [x] `data.measureSeriesForTile` — résultat vide -> catégories/séries vides, pas d'exception ✅
- [x] `data.tileExportSheet` — tuile Barres en mode mesure, appelée directement (hors `buildWorkbookSheetsAsync`) -> texte explicite ("Export non disponible…") plutôt qu'une ligne "undefined" trompeuse (reste volontairement pure/synchrone, voir HYPOTHESES.md) ✅
- [x] `data.measureExportSheet(tile, state, computeMeasureSeries)` — mode `ytd` : 1 colonne de valeur ; mode `yoy` : 2 colonnes (Valeur/N-1), N-1 manquant -> chaîne vide dans la cellule Excel (pas `null`) ; `computeMeasureSeries` FACTICE sous Node (pas de vrai DuckDB, voir CLAUDE.md §5) ✅
- [x] `data.measureExportSheet` — `computeMeasureSeries` qui rejette (DuckDB indisponible/erreur SQL) -> feuille avec message explicite PAR TUILE, pas un plantage de tout le classeur ✅
- [x] `data.buildWorkbookSheetsAsync(state, computeMeasureSeries)` — seule une tuile Barres en mode mesure passe par `computeMeasureSeries` injecté, toutes les autres tuiles restent calculées via `tileExportSheet` (chemin pur/synchrone inchangé), même préfixage de page que `buildWorkbookSheets` ✅
- [x] **Export Excel réel, tuile YTD contre les 47 040 lignes de `BI_StressTest`** (2026-10-21) : classeur téléchargé relu (SheetJS côté Node), feuille de la tuile mesure contient 84 lignes (7 ans × 12 mois, comme la vérification à l'écran de la feature DAX ci-dessus), toutes les valeurs YTD sont des nombres finis, plus aucun message "non disponible" — vraies valeurs DuckDB-WASM, pas un repli 🌐
- [x] Formulaire : champ "Mode" visible uniquement pour le type "Barres" (masqué en changeant vers KPI), champ "Colonne date" visible uniquement quand le mode n'est pas "Brut" 🌐
- [x] Formulaire : passer le mode à un mode non-Brut masque Dimension/Drill-down (`formHasNoDimension`, même traitement que KPI/jauge) 🌐
- [x] Formulaire : soumission bloquée avec une alerte si un mode non-Brut est choisi sans "Colonne date" ✅ (vérifié par relecture du code, garde symétrique à `isScatter && !measureYSelect.value`, pas de cas Playwright dédié)
- [x] Création réelle d'une tuile Cumul via le formulaire (combobox "Colonne date" = `Date`, mesure = `Montant`, agrégat = somme) contre les 47 040 lignes réelles de `BI_StressTest` : 84 points (7 ans × 12 mois), série strictement croissante (`Montant` toujours positif dans ce jeu de test), dernier point = somme totale (`aggregateSingle`) 🌐
- [x] Édition de cette même tuile Cumul -> YTD : les données affichées changent bien (pas un flash de l'ancien résultat cumulatif pendant le calcul asynchrone), repart nettement plus bas au changement d'année 🌐
- [x] Édition YTD -> Comparaison N-1 : 2 séries avec légende, `previousYear` au 13e point égale exactement la valeur brute du 1er point (décalage d'un an vérifié sur le vrai jeu de données, pas seulement le jeu synthétique) 🌐
- [x] Clic sur une tuile en mode mesure : aucun filtre croisé posé (un point est un mois calculé, pas une vraie valeur de dimension) 🌐
- [x] [BUG POTENTIEL évité, repéré en écrivant ce test AVANT qu'un utilisateur ne le remonte] Édition de cette MÊME tuile de Comparaison N-1 vers "Brut" : redevient cliquable et pose bien un cross-filter — vérifie que l'instance ECharts partagée entre les deux chemins de rendu (`getOrCreateChartInstance`) n'est pas restée bloquée avec un gestionnaire de clic jamais câblé 🌐
- [x] Régression : une tuile Barres normale (jamais passée par le mode mesure) fonctionne toujours à l'identique après la factorisation de la création d'instance ECharts/le déplacement de `numericGrid` en portée module 🌐
- [x] Round-trip de persistance : `measureMode`/`dateColumn` survivent à `saveConfig`/`loadConfig` ; une tuile Barres SANS ces champs (format d'avant cette feature) reste lue correctement (compat ascendante) 🌐
- [x] `buildWorkbookSheetsAsync` + génération XLSX réelle (SheetJS) contient les vraies valeurs Cumul/YTD/N-1 pour une tuile en mode mesure dans le classeur, pas seulement sans plantage (voir l'entrée dédiée 2026-10-21 plus haut) 🌐
- [ ] **[NON TESTABLE ICI]** `tile.dateColumn` contre une vraie colonne Grist de type `Date`/`DateTime` natif (format réellement renvoyé par `fetchTable` jamais confirmé ici, voir HYPOTHESES.md point 14d) — ce POC ne teste que le format ISO `AAAA-MM-JJ` de son propre jeu de données
- [ ] Granularité jour/trimestre/année configurable, fenêtre glissante (ex. "12 derniers mois") — délibérément HORS PÉRIMÈTRE, granularité mensuelle fixée en v1 (voir HYPOTHESES.md/ROADMAP.md) ⬜

### `js/duckdb-engine.js` + `js/charts.js` — DuckDB-WASM pour TOUTE agrégation au-delà d'un seuil (Roadmap Tier 2, Node pour la logique pure, Playwright pour le seuil/le rendu réels)

Même contrainte de service HTTP local que les deux sections précédentes. Seuil : `DUCKDB_ROW_THRESHOLD`
(5000 lignes) dans `js/charts.js`, délibérément choisi empiriquement, pas une recommandation DuckDB
officielle — voir sa doc dans le code.

- [x] Sous le seuil (jeu de données < 5000 lignes) : AUCUN appel à `GristBI.duckdbEngine` depuis `js/charts.js`, quel que soit le type de tuile — vérifié en patchant les 3 fonctions du moteur et en comptant les appels réels avant/après un filtre qui fait repasser une tuile sous le seuil 🌐
- [x] Au-dessus du seuil (47 040 lignes réelles de `BI_StressTest`) : `GristBI.duckdbEngine.groupByAggregate`/`aggregateSingle`/`pivotTable` RÉELLEMENT appelés (compteur instrumenté) pour les 7 types de tuile (bar/pie/treemap/scatter/kpi/gauge/pivot) 🌐
- [x] Valeurs identiques au chemin JS pur sur les mêmes lignes réelles : `groupByAggregate` (bar/pie), `aggregateSingle` (kpi/gauge), `pivotTable` cellule par cellule (pas seulement les totaux) — voir aussi l'entrée dédiée de `js/duckdb-engine.js` plus haut 🌐
- [x] KPI : valeur ET tendance (`computeTrendAsync`/`trendFromGroups`) lancées en parallèle (`Promise.all`), pas en séquence — vérifié par relecture du code (pas de test de latence dédié, le gain n'est mesurable qu'en conditions réseau réelles) ✅
- [x] Scatter : les deux agrégations (mesure X/mesure Y) lancées en parallèle, même raisonnement ✅
- [x] Instance ECharts partagée (`getOrCreateChartInstance`) reste la MÊME à travers plusieurs re-rendus asynchrones successifs d'une tuile au-dessus du seuil (pas de dispose+recréation implicite qui perdrait le gestionnaire de clic déjà câblé) — instance non disposée, `showLoading`/`hideLoading` appelés pendant le calcul 🌐
- [x] Un compteur de rendu PARTAGÉ par tuile (`renderSeq`/`bumpSeq`/`isStale`, pas un par fonction de rendu) : si une tuile change de type (ex. Barres -> KPI) pendant qu'un calcul DuckDB du type précédent est encore en vol, ce résultat périmé est bien abandonné — vérifié par relecture du code (le même mécanisme protégeait déjà `renderMeasureChart` avant cette extension, voir plus haut) ✅
- [x] Échec du calcul DuckDB (import rejeté/erreur SQL) au-dessus du seuil : repli silencieux sur le calcul JS pur (`console.warn`, pas de tuile cassée) — vérifié par relecture du code (`try`/`catch` autour de chaque appel `GristBI.duckdbEngine.*` dans `computeGroupBy`/`computeAggregateSingle`/`computePivot`), pas reproduit en conditions réelles (nécessiterait de faire échouer le chargement WASM lui-même, non simulé ici) ⬜
- [x] [BUG RÉEL ci-dessous, trouvé en relecture avant commit] `renderGauge`/`renderChart` : masque de chargement ECharts (`showLoading`/`hideLoading`) jamais bloqué même quand une tuile repasse SOUS le seuil pendant qu'un calcul DuckDB AU-DESSUS du seuil est encore en vol pour cette même tuile — `hideLoading()` rendu inconditionnel (après le contrôle `isStale`/`isDisposed()`) plutôt que gardé derrière le `usingDuckDb` de CE SEUL appel. Vérifié par relecture du code (chemin d'exécution tracé, aucun autre appel à `hideLoading()` sur cette instance ailleurs dans `js/`) ✅ — PAS reproduit par un test Playwright chronométré malgré plusieurs tentatives (délai artificiel injecté dans `GristBI.duckdbEngine.groupByAggregate`, deux rendus synchrones consécutifs pour la même tuile) : le navigateur headless n'a pas permis d'isoler de façon fiable la fenêtre de course nécessaire ⬜ — voir HYPOTHESES.md pour le détail
- [ ] **[NON TESTABLE ICI]** Gain de performance réel chiffré DuckDB vs JS pur sur un volume encore plus grand que 47 040 lignes, ou sur un réseau/matériel représentatif d'un vrai poste utilisateur — ce sandbox ne mesure que la correction des valeurs, pas le temps de calcul

### `js/data.js` + `js/combobox.js` + `js/main.js` — autocomplétion des VALEURS dans la barre de filtres avancés (Roadmap Tier 1.5, Node + Playwright)

- [x] `distinctColumnValues` — ordre de 1re apparition (pas alphabétique), conversion en chaîne, `null`/`undefined`/`''` ignorés, dédupliqué, plafonné (`max`), tableau vide en entrée ✅
- [x] Colonne texte sélectionnée dans le filtre avancé -> le champ "Recherche" propose les valeurs réellement présentes dans CETTE colonne, dans l'ordre de 1re apparition 🌐
- [x] ArrowDown puis Entrée remplit le champ avec la suggestion surlignée SANS soumettre le formulaire (l'utilisateur peut encore ajuster) 🌐
- [x] Un Entrée NU (texte déjà tapé, aucune suggestion surlignée) soumet directement le formulaire — comportement natif normal pour un champ dans ce `<form>`, cohérent avec min/max/date, pas un cas particulier pour "Recherche" 🌐
- [x] Une sous-chaîne libre qui ne correspond à AUCUNE valeur exacte (ex. "cam" pour "Webcam HD") : filtrage/surlignage des suggestions par sous-chaîne, ET survit au blur sans être corrigée (mode `strict: false`) 🌐
- [x] [BUG RÉEL #13 ci-dessous] Changer de colonne de filtre (donc rafraîchir les suggestions via `setOptions`) ne doit jamais écraser une saisie libre déjà en place, même hors-liste 🌐
- [x] Soumission réelle (bouton "+ Filtre") d'un filtre `contains` par sous-chaîne : effet réel sur les lignes visibles des tuiles 🌐
- [x] [BUG RÉEL #15 ci-dessous] Changer de TABLE rafraîchit bien les suggestions sur les lignes de la NOUVELLE table, pas un cycle de retard sur l'ancienne 🌐
- [x] [BUG RÉEL #14 ci-dessous] `updateAdvancedFilterFieldsForColumn` appelée comme callback direct d'un `addEventListener('change', ...)` ne reçoit jamais l'`Event` à la place de son paramètre `rows` optionnel ✅ (vérifié par relecture du code + absence d'erreur "rows is not iterable" sur toute la suite Playwright)
- [x] [BUG RÉEL #16 ci-dessous, partagé avec le sélecteur de table] Entrée sur une saisie combobox STRICTE sans aucune correspondance ne doit JAMAIS laisser fuiter un évènement `change` natif du navigateur avec la valeur brute invalide 🌐 (`combobox-test.js`, via un compteur `strictChangeCount`)
- [ ] Autocomplétion des valeurs pour les champs min/max (numérique) et date (plage/relative) — délibérément HORS PÉRIMÈTRE, voir HYPOTHESES.md/ROADMAP.md (native déjà meilleure UX pour ces cas) ⬜

### `js/demo-data.js` (Node, `dev-tests/test-data.js`)

Table de démo "rapide" (`buildSampleRows`/`defaultTiles`/`COLUMNS`/`ANNEES`/`SEMAINES`) retirée
(2026-09-16, demande explicite de l'utilisateur — voir HYPOTHESES.md) : `BI_StressTest` restait
alors la SEULE table que ce widget créait. **Depuis le 2026-10-21, ce widget ne crée plus AUCUNE
table de données** (`BI_StressTest` elle-même a été retirée de la production, voir plus haut/plus
bas) — `js/demo-data.js` ne reste que comme fixture de test Node pure, jamais chargée par
`index.html`/`dev-tests/harness.html`. Les cas de test ci-dessous restent valides TELS QUELS : ils
exercent les fonctions pures du fichier (`buildLargeSampleRows`/`defaultLargeTiles`/
`deriveDateColumn`), inchangées par ce retrait, seulement depuis `dev-tests/test-data.js` plutôt que
depuis le widget réel.

- [x] `buildLargeSampleRows` — volume exact (~47 040), colonnes complètes, valeurs positives ✅
- [x] `buildLargeSampleRows` — perf de génération + 3 agrégations/filtrages combinés (garde-fou généreux, pas un budget de perf précis) ✅
- [x] `defaultLargeTiles` — chaque tuile référence des colonnes qui existent réellement dans `buildLargeSampleRows`, au moins une démontre le drill-down à 2 niveaux/la tendance KPI/`drillCrossFilter` ✅
- [x] `deriveDateColumn` — cohérent avec la colonne `Date` générée directement par `buildLargeSampleRows` (pas deux implémentations divergentes) ✅

### `js/grist-api.js` (Playwright contre `dev-tests/grist-stub.js` — mock en mémoire, PAS un vrai `grist.docApi`)

- [x] `loadOrCreateTable` — première connexion crée la table + remplit (progression affichée) 🌐
- [x] `loadOrCreateTable` — deuxième connexion à une table déjà créée ne renvoie AUCUNE action `AddRecord`/`RemoveRecord` [comportement demandé explicitement par l'utilisateur] 🌐
- [x] `loadOrCreateTable` — deuxième connexion renvoie des valeurs IDENTIQUES (pas régénérées) 🌐
- [x] `applyActionsInChunks` — découpage en lots de 2000, progression appelée après chaque lot 🌐
- [x] `loadConfig`/`saveConfig` — round-trip complet (tuiles réordonnées + bookmark) via appel direct à `loadConfig()` (pas de `page.reload()`, le mock n'a pas de stockage hors mémoire JS) 🌐
- [x] `normalizeConfig` — ancien format tableau brut `[tiles]` lu correctement, reconstitué en une page unique 🌐 (écrit directement dans `BI_Dashboard_Config` puis relu via `loadConfig()`)
- [x] `normalizeConfig` — format intermédiaire `{tiles, bookmarks}` (avant les pages) lu correctement, tuiles + bookmarks conservés 🌐
- [x] `normalizeConfig` — format courant `{pages, currentPageId, bookmarks}` round-trippé sans perte via `saveConfig`/`loadConfig` 🌐
- [x] `normalizeConfig` — `currentPageId` sauvegardé ne correspondant à aucune page → repli sur la première page ✅ (Node, via `setPages` qui partage la même logique de repli)
- [ ] `saveConfig` — deux sauvegardes rapprochées (debounce 600ms) ne créent pas deux lignes `AddRecord` pour la même table ⬜
- [ ] **[NON TESTABLE ICI]** round-trip réseau réel de `applyUserActions` contre un vrai `grist.docApi` (latence, taille de payload) — voir `HYPOTHESES.md` point 10
- [ ] **[NON TESTABLE ICI]** lecture de `_grist_Tables`/`_grist_Tables_column` (types de colonnes réels) contre un vrai document — le mock ne simule pas ces tables système

### `js/grist-api.js` — évolution de schéma SANS nouvelle table (`schema-migration-test.js`, Playwright, mock étendu avec `AddColumn`/`RenameTable`)

**Historique, scénario de création/renommage RETIRÉ (2026-10-21)** : ces cas documentaient
`loadOrCreateStressData` (création fraîche de `BI_StressTest`) et `migrateLegacyTableName`
(renommage d'un ancien `BI_StressTest_v1`/`_v2` legacy) — les deux ont été retirés avec le reste du
code de création de table de données (voir plus haut). **Ne pas confondre avec `normalizeConfig`**
(section précédente, round-trip des 3 formats historiques de `BI_Dashboard_Config`) : c'est un
mécanisme totalement distinct, qui lui n'a PAS été touché par ce retrait — un document avec un
ancien format de configuration continue de se charger sans perte. Le mécanisme `ensureColumnsUpToDate`
+ `AddColumn` + backfill JS, lui, reste bien vivant : il continue de s'appliquer aux 3 tables
internes que ce widget crée encore (`BI_Dashboard_Config`/`BI_Dashboard_Comments`/
`BI_Dashboard_UserProbe`), seul le scénario "table de données versionnée" ci-dessous a disparu avec
`BI_StressTest` :
- [x] Première installation (aucune table) → création fraîche sous le nom FIXE (`BI_StressTest`, sans suffixe de version), toutes les colonnes présentes dès la génération 🌐
- [x] Rechargement avec un schéma déjà à jour → relecture simple, aucune action `AddColumn`/`UpdateRecord` déclenchée 🌐
- [x] Table déjà existante sous le nom fixe mais avec un schéma ANCIEN (colonne manquante) → `AddColumn` puis backfill exact des lignes déjà présentes via `UpdateRecord` (valeurs calculées par `deriveDateColumn`, PAS une formule Grist), aucune ligne perdue ni dupliquée, `result.created === false` 🌐
- [x] Ancien nom de table VERSIONNÉ (`BI_StressTest_v2`) existant, nom fixe absent → `RenameTable` vers le nom fixe, puis complétion du schéma comme ci-dessus ; UNE SEULE table dans le document au final (pas de doublon `_v2` + nom fixe) 🌐
- [ ] Deux anciens noms versionnés coexistant (`_v2` ET `_v1`) → seul le premier de `LEGACY_*_TABLE_NAMES` (le plus récent) est renommé, l'autre reste orphelin ⬜ (comportement voulu — un seul cas réel plausible en pratique, l'utilisateur n'aurait jamais eu qu'UNE version legacy à la fois vu le rythme de ce projet) — pas de cas Playwright dédié
- [ ] **[NON TESTABLE ICI]** `AddColumn`/`RenameTable` contre un vrai `grist.docApi` — le mock les simule de façon minimale (voir `grist-stub.js`), jamais vérifié en conditions réelles

### `js/grist-api.js` — course au démarrage entre `grist.ready()` et le 1er `docApi` (`table-race-test.js`, Playwright, mock étendu avec `__gristStubRaceCalls`/`__gristStubPreseed`/`__gristStubCollideOnAddTable`/`__gristStubCollideOnRenameTable`)

Matrice à **10 scénarios** (correctif v2, après qu'un premier correctif à délai fixe de 500ms se soit
révélé insuffisant en conditions réelles — bug remonté DEUX FOIS par l'utilisateur ; affinée ensuite
par une revue adversariale via le Workflow tool, demande explicite de l'utilisateur de croiser
davantage de scénarios — voir HYPOTHESES.md) :

**Statut après le retrait de `BI_StressTest` (2026-10-21)** — ces entrées `[BUG RÉEL]` ne sont PAS
supprimées (règle du projet, voir le process en tête de ce fichier), mais leur code sous-jacent a
en partie changé : les DEUX mécanismes de garde (`tableExistsConfirmed`, et la comparaison du
`table_id` réel après `AddTable`) sont toujours bien vivants et exercés — ils protègent désormais la
création de `BI_Dashboard_Config`/`BI_Dashboard_Comments`/`BI_Dashboard_UserProbe` plutôt que celle
de `BI_StressTest`, qui n'existe plus. Seul le scénario 7/10, qui portait spécifiquement sur le
contrôle interne de `migrateLegacyTableName`, documente un mécanisme qui n'existe plus du tout
(fonction retirée avec `BI_StressTest`) — gardé tel quel comme trace du bug réel trouvé à l'époque,
plus rejouable depuis ce retrait.

- [x] 1/10 Session sans course simulée : création normale d'une table qui n'existe pas encore, `created: true`, volume exact 🌐
- [x] 2/10 Course résolue au 1er essai de rattrapage (~300ms) sur une table qui existe DÉJÀ (préremplie via `__gristStubPreseed`) : `created: false`, AUCUNE duplication 🌐
- [x] 3/10 Course résolue à un essai INTERMÉDIAIRE (~2,1s, 3 échecs avant succès) : toujours `created: false`, AUCUNE duplication 🌐
- [x] 4/10 Budget d'attente ENTIÈREMENT épuisé (~9,3s, 6 échecs) mais la table est réellement neuve : création normale, pas de blocage infini 🌐
- [x] [BUG RÉEL — le plus significatif de ce correctif] 5/10 PIRE CAS : budget épuisé ET la table existe VRAIMENT (collision naturelle sur `AddTable`, détectée par défaut depuis la revue adversariale) → le garde-fou principal échoue, mais le filet de sécurité INDÉPENDANT (comparaison du `table_id` réellement renvoyé par `AddTable`, voir HYPOTHESES.md/`pick_table_ident`) empêche toute duplication : 47040 lignes exactement (pas 94080), table fantôme créée mais laissée VIDE, `console.error` explicite loggé, table fantôme visible mais non supprimée (`RemoveTable` jamais utilisé dans ce projet) 🌐
- [x] 6/10 Même filet de sécurité, isolé sur `BI_Dashboard_Config` (indépendamment de la table de données) : la config réelle préexistante reste lisible/correcte malgré la collision 🌐
- [x] [2e BUG RÉEL, trouvé en construisant cette matrice] 7/10 Course sur le contrôle interne (non protégé auparavant) de `migrateLegacyTableName`, avec `__gristStubRaceCalls = 6` calibré pour épuiser EXACTEMENT le budget du 1er contrôle (ni plus ni moins — la valeur qui distingue le correctif `_rawTables = null` sur épuisement, ajouté suite à la revue adversariale, d'un simple oubli) : une table sous un nom LEGACY (`BI_StressTest_v2`) doit toujours être correctement renommée 🌐
- [x] 8/10 Idempotence sur 3 rechargements successifs avec des profils de course variés (aucune course / résolue tôt / résolue tard) : le nombre de lignes ne croît JAMAIS 🌐
- [x] 9/10 Chemin normal (pas de course) : coût du garde-fou reste NUL, les deux contrôles d'existence combinés (`BI_StressTest` + `BI_Dashboard_Config`) restent sous 1000ms 🌐
- [x] [3e BUG RÉEL, trouvé par la revue adversariale, pas par l'utilisateur] 10/10 Collision `RenameTable` (le même mécanisme de suffixage silencieux que `AddTable`, mais sans retour exploitable pour le détecter aussi déterministement — voir HYPOTHESES.md) : filet de sécurité en CONSTAT (nouveau contrôle post-renommage + `console.error` explicite), pas en prévention — le déclencheur réel (vraie concurrence à deux acteurs) est assumé plutôt que reproduit (structurellement impossible à simuler dans une seule page séquentielle), via un nouveau hook `__gristStubCollideOnRenameTable` forçant directement la collision pour vérifier le mécanisme de détection 🌐
- [x] **Vérifié positivement scénario par scénario** : `git stash` isolant temporairement l'ancien `js/grist-api.js`/`grist-stub.js` (état du premier correctif, délai fixe 500ms, pas de détection de collision, `migrateLegacyTableName` non protégé) — 6 des 9 scénarios de la matrice initiale (3, 4, 5, 6, 7, 8) échouaient bien contre cet ancien code ; puis, après la revue adversariale, vérification CIBLÉE des deux mécanismes ajoutés (reversion manuelle temporaire de chaque ligne, pas un `git stash` complet) : le scénario 7/10 (calibré à `raceCalls=6`) échoue bien sans `_rawTables = null` sur épuisement, et le scénario 10/10 échoue bien sans le contrôle post-`RenameTable`
- [ ] **[NON TESTABLE ICI]** Le timing réel de la négociation d'accès Grist (postMessage asynchrone) — la simulation est déterministe (compteur d'appels), pas basée sur un vrai délai réseau à rater
- [ ] **[NON TESTABLE ICI, limite résiduelle documentée]** Une négociation d'accès dépassant même le budget renforcé de ~9,3s COMBINÉE à la présence d'une table sous un ancien nom versionné — le seul cas restant non couvert par aucun filet de sécurité (voir HYPOTHESES.md, point 13bis)
- [ ] **[HORS PÉRIMÈTRE, documenté plutôt que testé]** `AddColumn` exposé à la même classe de collision qu'`AddTable`/`RenameTable` (conséquence bien moindre : colonne orpheline, pas duplication de lignes) ; vraie concurrence à deux onglets/sessions sur `saveConfig`/`AddColumn`/`RenameTable` (classe de problème différente de la course de négociation au démarrage ciblée ici, nécessiterait une vraie synchronisation multi-session) ; `listTables()`/`fetchTable()`/`applyUserActions()` qui REJETTERAIENT plutôt que de renvoyer une liste vide (déjà sûr par construction : remonte au `try/catch` de `bootstrap()`, échec visible plutôt que duplication silencieuse) — voir HYPOTHESES.md pour le détail de chaque décision

### `js/charts.js` + `js/main.js` — rendu navigateur (Playwright contre `dev-tests/harness.html`)

- [x] Rendu initial : 3 tuiles (barres/camembert/KPI) sur les mêmes données 🌐
- [x] Cross-filtering au clic : les autres tuiles se filtrent, le KPI change de valeur 🌐
- [x] Reclic : le filtre est retiré, le KPI revient à sa valeur initiale 🌐
- [x] Réconciliation DOM incrémentale : pas de perte d'instance ECharts au changement d'état [BUG RÉEL : `innerHTML=''` détachait les instances ECharts en cache] 🌐
- [x] Drill-down 3 niveaux réels (clic niveau racine → niveau 1 → niveau 2) 🌐
- [x] Au niveau le plus profond, cliquer devient un cross-filter (pas un 4e niveau) 🌐
- [x] Remontée partielle via un segment intermédiaire du fil d'Ariane 🌐
- [x] Closure vivante : le gestionnaire de clic relit l'état du store à chaque clic, pas une référence figée à la création de l'instance [BUG RÉEL potentiel : édition de tuile ou drill-down après création de l'instance ECharts] 🌐
- [x] Édition de tuile : formulaire pré-rempli, soumission met à jour sans doublon ni changement de position 🌐
- [x] Réorganisation (◂/▸) : ordre vérifié, boutons désactivés en bout de liste 🌐
- [x] Bookmarks : sauvegarde avec filtre+drill actifs, effacement, restauration via le menu 🌐
- [x] Visibilité réelle des champs conditionnels du formulaire (`isHidden()`, pas juste `.hidden`) [BUG RÉEL : `.field[hidden]` annulé par une règle `display:flex` d'égale spécificité, 2 occurrences distinctes du même bug] 🌐
- [x] Connexion automatique au chargement (bootstrap), sans clic 🌐
- [x] Aucun bouton "Générer" dans le DOM après le retrait de l'UI 🌐
- [x] `drillCrossFilter` : KPI et tuile Région réagissent au drill d'une autre tuile 🌐
- [x] `drillCrossFilter` : badges cumulés à 2 niveaux (ex. Annee + Mois) 🌐
- [x] `drillCrossFilter` : tout disparaît en remontant à la racine 🌐
- [x] `drillCrossFilter` : case à cocher visible seulement si niveau 1 choisi, préremplie à l'édition 🌐
- [x] `drillCrossFilter` : décochée + sauvegardée → drill-down redevient purement local 🌐
- [ ] Stress dataset (~47 040 lignes) : cross-filtering reste correct à ce volume ⬜ (couvert par un script scratch non maintenu, à réintégrer si le volume redevient un point de risque)
- [x] Modale de détail (substitut du drillthrough) : bouton "Détail" visible sur chaque tuile, clic → lignes de `rowsForTile` affichées (titre avec le bon compte), tableau plafonné à 500 lignes + message de troncature au-delà, fermeture via le bouton 🌐
- [x] Modale de détail : compte de lignes correct après un cross-filtre posé sur une AUTRE tuile (fermée puis rouverte) 🌐
- [x] Modale de détail : titre retraduit après bascule de langue fr/en (pluriel correct des deux côtés) 🌐
- [ ] Modale de détail : mise à jour EN DIRECT (sans fermer/rouvrir) quand un filtre change pendant qu'elle est ouverte ⬜ — garanti par construction (même rappel systématique `render() → renderDetailModal()` que pour `renderCommentsModal()`, déjà éprouvé), tentative Playwright non concluante (flakiness du clic répété sur un camembert plein, voir HYPOTHESES.md)
- [x] Clés de jointure suggérées (data blending) : table secondaire reliée par une vraie colonne `Ref:` → les 2 comboboxes de clé se préremplissent automatiquement, jointure appliquée avec les bonnes colonnes secondaires 🌐
- [x] Clés de jointure suggérées : une clé principale déjà choisie à la main est conservée au changement de table secondaire (jamais écrasée par la suggestion) 🌐
- [x] Clés de jointure suggérées : repli sans suggestion (clés vides, `state.blend` à `null`) quand la table secondaire choisie n'a aucune relation `Ref:` connue avec la table principale 🌐
- [x] Auteur des commentaires reconnu automatiquement : table-sonde `BI_Dashboard_UserProbe` créée une seule fois (2e appel réutilise la promesse mémorisée, pas de 2e table), round-trip `AddRecord`/`fetchTable`/`RemoveRecord` sans exception 🌐
- [x] Auteur des commentaires : repli sur la saisie manuelle + mémorisation `localStorage` inchangés quand la détection échoue (systématique contre ce mock, qui ne simule pas le moteur de formules Grist) 🌐
- [x] Auteur des commentaires : `index.html` (import map distinct de `dev-tests/harness.html`, piège historique #18) continue de charger sans erreur après ce changement 🌐
- [ ] Auteur des commentaires : chemin de détection RÉUSSIE (`user.Email` réellement résolu par le moteur de formules Grist) ⬜ **[NON TESTABLE ICI]** — aucun mock de ce dépôt ne simule le moteur de formules Grist ni l'identité utilisateur côté serveur, voir HYPOTHESES.md
- [x] Tuile Waterfall : création + rendu (canvas non vide), clic sur la 1re barre pose un cross-filter identique à une tuile "bar" sur les mêmes données 🌐
- [x] Tuile Radar : création + rendu (canvas non vide), clic au centre NE pose AUCUN filtre (garde explicite, voir HYPOTHESES.md) 🌐
- [x] Radar : `#tile-drill-field` masqué dans le formulaire (`supportsDrillDown`), contrairement à bar/waterfall où il reste visible 🌐
- [x] Radar "compétences en colonnes" (`tile.radarAxisMode === 'columns'`) : `#tile-radar-mode` bascule `#tile-dimension-field`/`#tile-measure-field`/`#tile-agg-field` (mode "dimension") contre `#tile-radar-axes-field` (mode "columns") ; "+ Axe" apparaît seulement une fois le dernier axe rempli, limité à `MAX_RADAR_AXES` 🌐
- [x] Radar "compétences en colonnes" : `#tile-radar-axes` ne propose que des colonnes numériques (`numericColumns`/`inferColumnKind`) ; une même colonne choisie deux fois comme axe est bloquée à la soumission (`tileForm.alert.radarAxesDuplicate`) ✅
- [x] Radar "compétences en colonnes" : rendu d'un radar à N axes = la moyenne de chaque colonne choisie sur les lignes visibles (pas une agrégation configurable), soumis à côté d'un 2e radar en mode "dimension" classique dans la même session de formulaire sans régression sur ce dernier 🌐
- [x] `tileExportSheet` en mode "columns" : en-tête = les colonnes choisies, une seule ligne = la moyenne de chaque colonne ; mode "dimension" inchangé (même branche générique qu'avant) ✅
- [ ] Radar "compétences en colonnes" au-delà du seuil DuckDB (`DUCKDB_ROW_THRESHOLD`) ⬜ **[NON TESTABLE ICI]** — la table de démonstration du harnais n'a que 8 lignes, voir HYPOTHESES.md
- [x] Radar — comparaison élève/moyenne (`tile.radarEntityColumn`/`tile.radarEntityValue`) : les 3 nouveaux champs (`#tile-radar-entity-column`, `#tile-radar-entity-value`, `#tile-radar-compare-average`) visibles pour `type === 'radar'` dans les deux modes d'axes, masqués sinon ; la liste de valeurs de `#tile-radar-entity-value` se recalcule à chaque changement de `#tile-radar-entity-column` 🌐
- [x] Radar — comparaison élève/moyenne, mode "columns" : entité seule (1 série) et entité + case "moyenne" cochée (2 séries, légende "Eleve X" / "Moyenne du groupe"), rendu sur un jeu de données réaliste (400 lignes, 5 colonnes de compétence, préremplifié via `__gristStubPreseed`, pas le mock par défaut à 8 lignes) 🌐
- [x] Radar — comparaison élève/moyenne, mode "dimension" classique : mêmes 2 séries, l'axe list vient du GROUPE entier (jamais de l'entité) ; un axe que l'entité n'a pas est comblé à 0 ✅
- [x] Radar — comparaison élève/moyenne : une valeur d'entité orpheline (absente des lignes filtrées pour la tuile) retombe silencieusement sur le rendu SANS entité, jamais une erreur ni un polygone vide ✅
- [x] Radar — comparaison élève/moyenne : édition d'une tuile existante (`startEditTile`) préremplit correctement les 3 nouveaux champs 🌐
- [x] `tileExportSheet` radar avec entité (modes "columns" et "dimension") : 1 ligne par série, colonne "Série" en tête, même comblement à 0/repli orphelin qu'au rendu écran ✅
- [x] `index.html` vérifié séparément de `dev-tests/harness.html` après cette feature (chargement direct, hors mock) : les 7 ids de champ radar présents dans le DOM, aucune erreur structurelle de type bug #27 ci-dessous 🌐
- [ ] Redimensionnement réel du panneau Grist (ResizeObserver) ⬜ **[NON TESTABLE ICI]** — logique de coalescing vérifiée par lecture de code seulement
- [ ] `window.resize` classique (hors ResizeObserver) ⬜
- [x] [BUG RÉEL #17 ci-dessous] Aucun canvas ECharts ne déborde sous sa carte `.tile` (comparaison `getBoundingClientRect()`, pas une inspection visuelle), à l'état initial ET sur une tuile drillée avec fil d'Ariane à 2 niveaux réellement affiché (pire cas) 🌐

### `js/main.js` — formulaire de drill-down à N niveaux (Roadmap Tier 1, Playwright)

- [x] 1 seul niveau affiché au départ, bouton "+ Niveau" caché tant que le niveau 1 est vide 🌐
- [x] Remplir le niveau 1 → le bouton "+ Niveau" apparaît 🌐
- [x] Cliquer "+ Niveau" ajoute un select supplémentaire à chaque clic (testé jusqu'à 4 niveaux) 🌐
- [x] Plafond `MAX_DRILL_LEVELS` (5) atteint → le bouton "+ Niveau" disparaît 🌐
- [x] Une tuile créée avec 4 niveaux persiste bien `drillDimensions` dans cet ordre exact 🌐
- [x] Éditer cette tuile pré-remplit exactement le bon nombre de `<select>` avec les bonnes valeurs, dans l'ordre 🌐
- [x] Garde-fou : la dimension racine réutilisée comme niveau de drill déclenche une alerte, la tuile n'est PAS créée [BUG POTENTIEL évité, repéré en généralisant à N niveaux] 🌐
- [x] Vider le niveau 1 → décoche `drillCrossFilter` ET retire tous les niveaux suivants (cascade) 🌐
- [ ] Deux niveaux de drill (hors racine) avec la même colonne (ex. niveau 2 = niveau 4) → même garde-fou anti-doublon ⬜ (couvert par construction via `new Set(allDims).size !== allDims.length`, pas de cas Playwright dédié à ce sous-cas précis)
- [ ] Basculer le type de tuile vers "kpi" avec des niveaux de drill déjà configurés → `drillField` se cache, `drillDimensions` repart à `undefined` à la soumission ⬜

### `js/charts.js` + `js/main.js` — jauge, treemap, scatter (Roadmap Tier 1, Playwright)

- [x] Jauge : champs dimension/drill-down cachés (comme KPI), champs min/max visibles 🌐
- [x] Jauge : `aggregateSingle` réutilisée telle quelle, valeur agrégée positive affichée 🌐
- [x] Jauge : garde-fou min/max — `max <= min` déclenche une alerte, aucune tuile créée 🌐
- [x] Jauge : `splitNumber: 4` (5 graduations) plutôt que le défaut ECharts (11) [BUG RÉEL trouvé en capturant un screenshot : graduations qui se chevauchaient à la taille d'une tuile] 🌐
- [x] Treemap : version plate, une tuile par valeur de dimension, aucun asset externe requis 🌐
- [x] Treemap : `nodeClick: false` — le clic déclenche le gestionnaire générique (cross-filter/drill), pas le zoom natif d'ECharts pensé pour une hiérarchie multi-niveaux 🌐
- [x] Treemap : cliquer un rectangle cross-filtre bien les autres tuiles (KPI) 🌐
- [x] Scatter : libellé du champ mesure change en "Mesure X", champ "Mesure Y" apparaît 🌐
- [x] Scatter : deux `groupByAggregate` (une mesure par axe) associés par NOM de dimension (Map), pas par index 🌐
- [x] Scatter : chaque point porte un `name` explicite (contrairement à bar, l'axe est numérique des deux côtés — sans `name`, `params.name` serait `undefined` au clic) 🌐
- [x] Scatter : cliquer un point cross-filtre les autres tuiles ET pose le bon badge (`Produit = ...`) 🌐
- [ ] Jauge/treemap/scatter dans une tuile éditée (préremplissage du formulaire) ⬜ (préremplissage générique déjà couvert pour dimension/mesure/agrégat communs à tous les types ; pas de cas dédié pour measureY/gaugeMin/gaugeMax en édition)
- [ ] Treemap/scatter avec drill-down configuré (le mécanisme est générique, jamais testé explicitement sur ces 2 nouveaux types) ⬜

### `js/charts.js` + `js/main.js` — tableau croisé dynamique (pivot) (Roadmap Tier 2, Playwright)

- [x] Sélectionner le type "Tableau croisé" → libellé "Dimension (lignes)", champ "Dimension (colonnes)" visible, drill-down/tendance/mesure Y cachés (visibilité RÉELLE via `isHidden()`, pas juste l'état JS — voir la classe de bug `.field[hidden]`) 🌐
- [x] Garde-fou : dimension lignes = dimension colonnes → `alert`, AUCUNE tuile créée (nombre de tuiles inchangé après la tentative) 🌐
- [x] Création réelle d'une tuile pivot → une table HTML (`.pivot-table`) apparaît dans la tuile, avec une ligne et une colonne "Total" 🌐
- [x] Clic sur une cellule de donnée → exactement 2 filtres actifs (ligne + colonne, badges vérifiés) ; reclic sur la MÊME cellule → les 2 retirés (idempotence, comme bar/pie) 🌐
- [x] Clic sur un en-tête de ligne cross-filtre bien une AUTRE tuile (valeur du KPI vérifiée changer) 🌐
- [x] La tuile pivot source d'un filtre reste elle-même non filtrée sur son propre clic (toutes ses lignes/colonnes restent affichées, reste cliquable partout) — `rowsForTile` générique, aucun code dédié 🌐
- [x] Édition d'une tuile pivot → les deux champs de dimension (lignes/colonnes) se pré-remplissent correctement, le champ colonnes reste visible 🌐
- [x] Export Excel ne plante pas avec une tuile pivot dans le dashboard (déclenchement du téléchargement vérifié) 🌐
- [x] Stabilité dans le temps (voir la checklist méthodologique plus haut) : hauteur de la tuile pivot mesurée sur 6 échantillons successifs, aucune dérive (contrairement au bug réel #10 sur les tuiles ECharts) 🌐
- [ ] Cellule sans donnée (`.pivot-cell-empty`, "–" affiché) : vérifié uniquement sous Node (`pivotTable` → `null`) — pas encore rejoué en Playwright avec un jeu de données réellement lacunaire (le jeu de test de charge est un produit cartésien complet Region×Produit, donc aucune cellule vide n'apparaît avec les dimensions utilisées dans la validation manuelle) ⬜
- [ ] Deux tuiles pivot simultanées avec des filtres croisés qui se chevauchent (une pivot cross-filtre une autre pivot) ⬜ — comportement attendu par construction (mêmes primitives `toggleFilter`/`rowsForTile` que tout le reste), pas de cas dédié
- [ ] Script Playwright de cette validation non committé (voir `dev-tests/README.md` — convention de ce projet : seule `dev-tests/test-data.js` est un test de régression permanent, les scripts Playwright créés pendant le développement restent en scratch, comme pour `js/duckdb-engine.js`) ⬜

### `js/main.js` + `js/state.js` — dashboards multi-pages (Roadmap Tier 1, Playwright)

- [x] Démarrage : un seul onglet "Page 1", actif, aucun bouton de suppression tant qu'il n'y a qu'une page 🌐
- [x] « + Page » (prompt du nom) → nouvel onglet, navigation automatique dessus, zone de tuiles vide (`#empty-state` visible) 🌐
- [x] Ajouter une tuile sur la page 2 puis revenir sur la page 1 restaure EXACTEMENT les tuiles d'origine de la page 1, sans celle de la page 2 🌐
- [x] Filtre croisé posé sur la page 1 reste actif après bascule vers la page 2 (comportement global attendu, pas un bug) 🌐
- [x] Double-clic sur un onglet → `prompt()` de renommage → nom mis à jour dans l'onglet 🌐
- [x] Bouton `×` de suppression visible UNIQUEMENT sur l'onglet actif, et seulement s'il y a plus d'une page 🌐
- [x] Suppression d'une page (avec `confirm()` accepté) → bascule sur la page restante avec ses tuiles d'origine, `×` disparaît quand il ne reste qu'une page 🌐
- [x] Persistance : après le debounce de `scheduleSave` (600ms), `BI_Dashboard_Config` contient bien `{pages, currentPageId, bookmarks}` (nouveau format), pas l'ancien `{tiles, bookmarks}` 🌐
- [ ] Renommer/supprimer une page pendant qu'une tuile de cette page est en cours d'édition dans le formulaire ⬜ (cas non couvert : `editingTileId` n'est réinitialisé que sur `removeTile`/changement de table, pas sur `removePage`)
- [ ] Bookmarks (filtres/drill sauvegardés) restaurés après changement de page — cohérent avec le caractère global des filtres, mais jamais testé explicitement en combinant page + bookmark ⬜

### `js/main.js` — barre de filtres avancés (Roadmap Tier 1, Playwright)

- [x] Colonne numérique choisie → champ plage min/max visible, tout le reste caché 🌐
- [x] Colonne `Date` choisie → sélecteur de mode visible ("Plage de dates" par défaut) 🌐
- [x] Mode "Plage de dates" → champs Du/au visibles, "Période relative" caché 🌐
- [x] Rebasculer le mode vers "Période relative" → champ preset visible, Du/au caché 🌐
- [x] Colonne texte choisie → champ recherche visible, tout le reste caché 🌐
- [x] Poser un filtre range → badge affiché avec les bonnes bornes, formulaire vidé après ajout 🌐
- [x] Poser un filtre dateRange puis un filtre relativeDate sur la MÊME colonne → remplace (1 seul badge pour cette colonne), pas de cumul 🌐
- [x] Un filtre sur une colonne différente s'ajoute (cumul, badges multiples) 🌐
- [x] Retirer un filtre via son badge (`×`) change réellement l'agrégat affiché par les tuiles (pas seulement l'état du store) 🌐
- [x] Les filtres avancés NE sont PAS dans la config persistée (`{pages, currentPageId, bookmarks}`, pas de champ `advancedFilters`) — vérifié en lisant directement la table de config mockée 🌐
- [x] Un bookmark capture le filtre avancé courant et le restaure après un `clearAdvancedFilter()` 🌐
- [ ] Changer de TABLE (bootstrap une 2e fois) vide bien les filtres avancés (`store.clearAdvancedFilter()` dans `switchTable`) ⬜ **[NON TESTABLE ICI]** — un seul chargement de table par session dans ce POC (voir HYPOTHESES.md), jamais de vrai changement de table à tester
- [ ] Deux filtres avancés dont un devient incohérent après édition manuelle du formulaire (ex. `min`/`max` inversés sans repasser par la validation du formulaire) ⬜ — voir aussi la limite notée dans `matchesFilter` plus haut

### `js/export.js` — export Excel (Roadmap Tier 1, Playwright)

- [x] Cliquer « Exporter en Excel » déclenche un vrai téléchargement (`page.waitForEvent('download')`), nom de fichier `dashboard-bi.xlsx` 🌐
- [x] **Le fichier .xlsx réellement téléchargé est relu** (SheetJS côté Node sur le buffer, pas juste l'appel JS) et son contenu (noms de feuilles + cellules) comparé exactement à `buildWorkbookSheets` calculé côté navigateur au même instant 🌐
- [x] Le nombre de feuilles correspond au nombre de tuiles (4 tuiles pré-configurées → 4 feuilles) 🌐
- [x] Un filtre avancé actif au moment de l'export se reflète dans le fichier téléchargé (pas les données brutes) 🌐
- [x] Aucune tuile → une alerte ("Aucune tuile à exporter"), AUCUN téléchargement ne se déclenche (vérifié en garantissant l'absence de l'événement `download`, pas juste l'absence d'erreur) 🌐
- [ ] Plusieurs pages → préfixe de nom de page sur chaque feuille, feuilles de TOUTES les pages présentes dans le même classeur (couvert côté Node via `buildWorkbookSheets`, pas encore rejoué en Playwright avec de vraies pages + export combinés) ⬜
- [ ] Deux tuiles avec le même titre → noms de feuilles dédupliqués avec suffixe `" (2)"` (couvert côté Node via `sanitizeSheetName`, pas de cas Playwright dédié avec de vraies tuiles dupliquées) ⬜
- [ ] **[NON TESTABLE ICI]** Déclenchement du téléchargement depuis l'intérieur d'une VRAIE iframe de widget Grist (pas juste une page top-level Chromium headless) — voir HYPOTHESES.md, point 11

### `js/i18n.js` — bilingue fr/en, mécanisme `data-i18n` (cadrage d'identité Grist Factory, Node pour le dictionnaire/`t()`, Playwright pour le câblage DOM)

Même mécanisme que `publipostageGrist/js/i18n.js`. Voir HYPOTHESES.md pour le détail des deux
pièges trouvés (boutons de tuile mis en cache, `blankLabel` de combobox non relu) et du périmètre
délibérément laissé de côté (contenu généré par `js/data.js`/`js/demo-data.js`).

- [x] Chaque clé de `STRINGS` porte une traduction fr ET en non vide (117 clés) ✅
- [x] `t(key, vars)` — substitution de `{var}`, pluriel `{n|singulier|pluriel}` conforme à `Intl.PluralRules` en fr (0 et 1 au singulier) ET en (seul 1 au singulier) ✅
- [x] `t()`/`getLang()`/`setLang()` fonctionnent sous Node sans DOM ni `localStorage` (repli silencieux, pas d'exception) ✅
- [x] Clé inconnue → avertit en console ET renvoie la clé elle-même (pas de plantage, pas de chaîne vide silencieuse) ✅
- [x] Bascule fr/en via les radio-boutons du panneau Réglages (`input[name="settings-lang"]`) retraduit tout le formulaire statique (labels, options, placeholders) 🌐
- [x] Les radio-boutons Langue reflètent la langue courante à l'ouverture du panneau (celle persistée en `localStorage`, pas un état figé au chargement de la page) 🌐
- [x] [BUG RÉEL, voir HYPOTHESES.md] Les boutons d'action d'une tuile déjà affichée (déplacer/modifier/supprimer) se retraduisent SANS reconstruction de la tuile (mise en cache par `render()`) grâce à `data-i18n-aria`/`data-i18n-title` + `applyTranslations()` rappelé à chaque rendu 🌐
- [x] [BUG RÉEL, voir HYPOTHESES.md] Le `blankLabel` "(aucun)"/"(none)" des comboboxes optionnelles (drill-down, Tendance vs) se retraduit à la bascule de langue (`refreshColumnSelects` rappelé dans l'abonné `onChange`) 🌐
- [x] Une valeur déjà choisie dans un combobox (ex. Dimension = Region) survit à la bascule de langue, pas réinitialisée 🌐
- [x] Le `<code>` imbriqué dans le bandeau d'avertissement ECharts (`data-i18n-html`) reste un vrai élément DOM après traduction, pas juste du texte échappé 🌐
- [x] Le `<span>` de la case « Filtrer aussi les autres cartes en détaillant » se retraduit SANS supprimer la case à cocher imbriquée dans le même `<label>` 🌐
- [x] La langue choisie survit à un rechargement de page (`localStorage.gristbi_lang`) 🌐
- [x] Alerte de validation de formulaire (ex. "dimensions lignes/colonnes du tableau croisé doivent être différentes") traduite selon la langue active au moment du clic 🌐
- [x] En-têtes "Total" du tableau croisé traduits (mêmes clés que le rendu à l'écran) 🌐
- [ ] **[NON TESTABLE ICI]** Comportement réel à l'intérieur d'une vraie iframe de widget Grist (`localStorage` scindé par origine notamment) — jamais vérifié en conditions réelles Grist, voir HYPOTHESES.md

### `kit/js/ambiance.js` + `js/main.js` + `css/style.css` — ambiance de GFS (consigne GFS 004, 04/11/2026, Playwright contre le message d'exemple du kit `kit/test/ambiance-exemple.json`, jamais un vrai hébergeur GFS)

- [x] `kit/` (sous-module Git) présent après `git submodule update --init` ; `Ambiance.start()` posé par `js/main.js` avant tout rendu ✅ (lecture de code)
- [x] `index.html` seul (hors GFS) : aucun avertissement/erreur lié à `ambiance`/`kit/` en console, couleurs par défaut de ce widget inchangées 🌐
- [x] `dev-tests/harness.html` (un sous-dossier, chemin résolu différemment via `document.currentScript.src`) : même absence d'avertissement 🌐
- [x] Message d'exemple réel du kit (`kit/test/ambiance-exemple.json`, ambiance "Pop") posé directement via `kit/js/ambiance-message.js:normalizeAmbiance` + `kit/js/ambiance-pose.js:paintAmbiance` sur `index.html` : le fond de page, le fond d'une carte (`.add-tile-form`) et le fond d'un bouton plein (`#submit-tile`, qui devient le dégradé `--fill` de Pop) changent tous les trois 🌐
- [x] Retour à `null` (équivalent d'une perte de connexion GFS) : les trois reviennent EXACTEMENT aux valeurs d'avant — pas de jeton orphelin laissé posé 🌐
- [x] Même scénario en `prefers-color-scheme: dark` : aucune régression du rendu sombre existant (fond/bouton inchangés hors ambiance) 🌐
- [ ] **[NON TESTABLE ICI]** Un vrai message d'ambiance envoyé par un vrai hébergeur GFS (protocole `postMessage`/`contexte` réel, pas le fichier d'exemple statique du kit) — voir HYPOTHESES.md
- [ ] **[NON TESTABLE ICI]** Le rendu réel des 4 autres ambiances (Grist Factory, Papier, Brut, Néon) et de la couleur libre — seul le fichier d'exemple "Pop" existe dans le kit
- [ ] **[NON TESTABLE ICI]** Que GitHub Pages serve bien `kit/` (sous-module) sur le site publié de ce widget précisément — ce sandbox ne peut pas joindre `*.github.io`, voir HYPOTHESES.md

### `js/data.js` + `js/charts.js` + `js/main.js` — courbe/aire, anneau, barres horizontales, tri (18/11/2026, Node pour le tri pur, Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `sortGroups` : valeur décroissante/croissante, valeurs absentes (`null`/`NaN`) toujours en dernier quel que soit le sens, tri « Libellé » naturel (« T2 » avant « T10 », nombres dans l'ordre numérique) ✅
- [x] `sortGroups` sans mode / mode vide / mode inconnu : l'agrégat revient TEL QUEL (même référence), jamais de tri en place ✅
- [x] `isSortableTile` : barres (hors mode mesure temporelle), courbe/aire, camembert seulement — cascade, treemap, radar, nuage de mots, KPI, jauge, nuage de points, tableau croisé jamais ✅
- [x] `tileExportSheet` : l'export Excel applique le même tri (barres, courbe, camembert) et ignore un `sortMode` qui traîne sur une cascade ; une courbe sans option exporte comme des barres ✅
- [x] `suggestTiles` : `donutChart` → camembert avec `donut: true`, `pieChart` sans le drapeau ✅
- [x] Visibilité des 5 nouvelles options (tri, horizontal, aire, anneau, pourcentages) pour chacun des 11 types, barres en mode mesure comprises (toutes masquées) — mesurée par `offsetParent`/`getComputedStyle`, pas seulement `.hidden` 🌐
- [x] Ajout par le vrai formulaire de 6 tuiles : options enregistrées, aucune option fantôme sur les tuiles ajoutées sans (le formulaire garde ses valeurs d'une tuile à l'autre : le test remet explicitement le tri à « Ordre des données ») 🌐
- [x] Options ECharts réellement construites : axes inversés/permutés des barres horizontales, ordre trié, `areaStyle` de l'aire, rayon `['40%','65%']` de l'anneau, étiquette « nom » + « 12,5 % » 🌐
- [x] Clic SOURIS réel sur un point de courbe et sur une barre horizontale : filtre croisé sur la bonne valeur ; re-clic le retire (coordonnées RECALCULÉES : la barre de badges de filtre décale la mise en page) 🌐
- [x] Édition : pré-remplissage des options, décocher « Anneau » l'efface sans toucher « Pourcentages » ; barres → treemap efface `horizontal`/`sortMode` 🌐
- [x] Textes anglais du type et des 5 options ; hauteur de tuile stable (10 échantillons avec redimensionnement) ; aucun canvas ne déborde 🌐
- [ ] **[NON TESTABLE ICI]** Rendu dans un vrai Grist (iframe de widget) ; courbe sur une VRAIE colonne `Date` (le test utilise une année numérique) ; import Power BI d'un `lineChart`/`areaChart` (non branché)

### `js/advice.js` — suggestions de tuiles, valeurs par défaut, avertissements (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js` pour le chargement)

- [x] Rôle des colonnes : région/produit catégories, année (2020-2026) catégorie et non mesure, date → temps, colonnes dérivées `.Annee/.Trimestre` → parties de temps, jour du mois → ordinal ✅
- [x] Identifiant (entiers consécutifs uniques, texte à 40 valeurs toutes différentes) ≠ mesure entière non consécutive (salaire) ≠ constante ≠ texte libre ✅
- [x] Type d'une colonne par VOTE : une cellule texte égarée dans 20 nombres ne change pas le type ; moitié texte → texte ✅
- [x] `suggestTiles` : tableau vide/absent → `[]` ; 3 par défaut, `limit` respecté ; trois TYPES différents sur le banc de 47 040 lignes ; vraies colonnes, dimension ≠ mesure ; courbe sur `Date.Annee` avec le même drill-down que « Détailler par Année… » ; KPI avec tendance ✅
- [x] Sans date : barres + KPI + anneau ; une valeur négative écarte l'anneau ; colonne « note »/« moyenne » → agrégat `avg` ; aucune colonne numérique → comptage de lignes ✅
- [x] Radar « compétences en colonnes » proposé pour des notes sur une échelle commune, jamais mêlé à un chiffre d'affaires ✅
- [x] Chaque suggestion s'ajoute au store et s'agrège sur les vraies données (agrégat fini, ≥ 2 groupes) ✅
- [x] Dates dans le désordre : courbe suggérée avec `sortMode: 'label'`, ordre chronologique vérifié via `sortGroups` ✅
- [x] `defaultsForType` : jamais dimension = mesure ; anneau sur ≤ 6 parts ; jauge dont le maximum est juste au-dessus de la valeur ; pivot sur deux dimensions différentes ; type inconnu / tableau vide → `null` ; une seule colonne → repli en comptage ✅
- [x] `adviceForTile` : un test PAR avertissement (anneau > 7 parts / négatif, treemap négatif, barres > 12 / libellés longs / non triées, courbe sans ordre naturel / dates en désordre / triée par valeur / 2 points, cascade non chronologique, radar > 8 axes, jauge hors échelle, mesure vide à 70 %) ET par absence d'avertissement (barres négatives, mois en texte, tri déjà posé, horizontales déjà posées, KPI) ✅
- [x] Aucun conseil sur les tuiles de démonstration du banc d'essai ; entrées gelées (`Object.freeze`) jamais mutées ✅
- [x] `adviceForType` : jamais `null` ; indisponibilité (`advice.fit.noTime`/`needTwoMeasures`/`needTwoDimensions`/`noMeasure`/`needText`) ; ligne générique pour un type inconnu ou sans données ✅
- [x] i18n : toute clé `advice.*` citée par le module existe, toute clé du dictionnaire est utilisée (pas de clé morte), mêmes variables en fr et en anglais, aucune `{variable}` orpheline une fois résolue dans les DEUX langues ✅
- [x] `GristBI.advice` réellement chargé par le vrai `index.html` (script tag) et suggestions cohérentes sur la table du faux Grist 🌐
- [ ] **[NON TESTABLE ICI]** Données d'un VRAI document Grist (colonnes `Date` en secondes, `Reference`, très larges tables) ⬜ ; seuils de lisibilité jamais confrontés à de vrais utilisateurs ⬜

### `js/welcome.js` + `advice.previewFor` — écran d'accueil à suggestions (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `previewFor` : une miniature finie (aucun `NaN`/`Infinity`) pour chaque type suggéré sur le banc de 47 040 lignes ; barres horizontales normalisées (max = 1) et triées ; courbe `areaFill` → `area` ; anneau → `donut` ; parts de camembert de somme 1 ; jauge bornée à 1 ; pivot → grille ✅
- [x] `previewFor` renvoie `null` (plutôt que de dessiner faux) : tableau vide, tuile `null`, type inconnu, jauge sans étendue, radar à 2 axes, barres toutes nulles ✅
- [x] `previewSvg` : `null`/type inconnu → chaîne vide ; KPI : ▲ si hausse, ▼ si baisse, aucune flèche sans tendance ; nombre selon la langue (« 3,7 k » fr / « 3.7K » en) ✅
- [x] Accueil visible en Édition sur une table connectée sans tuile ; 3 cartes avec miniature, titre et raison ; bouton « Ajouter ces 3 visualisations » 🌐
- [x] « Ajouter » pose exactement la tuile de la carte (titre persisté résolu, id neuf) ; l'accueil disparaît ; il REVIENT après suppression de la dernière tuile 🌐
- [x] « Ajouter ces 3 » : 3 tuiles de types distincts, ids uniques, TOUTES se rendent (canvas ou valeur de KPI) ; aucune erreur JS 🌐
- [x] Mode Lecture : suggestions masquées, indication de lecture visible 🌐 ; textes anglais ; bascule de langue à chaud retraduit les cartes 🌐
- [x] « Importer un fichier Power BI… » ouvre la fenêtre d'import (test sur `hidden` + `display`, pas `offsetParent` : fenêtre `position: fixed`) 🌐
- [x] Table sans ligne : message `welcome.emptyTable`, aucune carte, pas de « Ajouter ces N », import toujours proposé, aucun bouton « Créer une visualisation » 🌐
- [x] Éléments de carte conservés tant que la table et la langue sont inchangées (pas de profilage à chaque rendu) 🌐
- [x] Captures regardées (fr, en, table vide, tuiles posées) 🌐
- [ ] **[NON TESTABLE ICI]** VRAI document Grist (dates en secondes, `Reference`, grandes tables) ⬜ ; mobile ⬜ ; lecteur d'écran réel ⬜

### `js/dialogs.js` + connexion + titres traduits (18/11/2026, Node pour `tileTitle`, Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] « + Page » ouvre une fenêtre de saisie (titre « Nouvelle page », boutons Annuler / Créer la page) et crée l'onglet ; annuler ne crée rien ✅ 🌐 (dans un cadre sans `allow-modals`)
- [x] Renommer par double-clic ; supprimer : Annuler conserve la page, confirmer la supprime ✅ 🌐
- [x] « Sauvegarder la vue actuelle » : saisie validée → vue ajoutée à la liste ; saisie annulée → aucune vue ✅ 🌐
- [x] Validation refusée (jauge Min > Max) : fenêtre de message avec le texte traduit, AUCUNE tuile ajoutée, zéro boîte native ouverte ✅ 🌐
- [x] Aucune exception ni message console pendant ces parcours ✅ 🌐
- [x] Connexion lente (2,5 s sur `listTables`) : jamais « Aucune table » pendant l'attente, « Connexion… » seulement ✅ 🌐
- [x] Document sans table : message visible, conseil masqué, pas de « Réessayer » ✅ 🌐
- [x] Échec de lecture des tables : message d'échec + « Réessayer » ; après rétablissement, le bouton disparaît, la table se connecte et le conseil est de nouveau affiché ✅ 🌐
- [x] Titre de tuile : « Montant par Region » → « Montant by Region » en anglais et retour ; infobulle (`title`) du titre ✅ 🌐
- [x] `i18n.tileTitle` : clé connue / sans clé / clé inconnue / tuile vide / `null`, fr et en ✅ (Node)
- [x] Fenêtre de saisie rendue en sombre et de message en clair, relues à l'écran ✅ 🌐
- [ ] **[NON TESTABLE ICI]** Vrai GFS (chargement de `kit/` depuis GitHub Pages, fenêtres sous une ambiance choisie) ⬜ ; vrai Grist ⬜

### `js/appbar.js` + `js/main.js` + `index.html` + `css/style.css` — barre unique, menus, pastilles de filtre, modes Lecture/Édition (18/11/2026, lot 1 de l'audit UI/UX, Node pour les fonctions pures, Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Mode Lecture par défaut sur un tableau déjà garni : barre sur UNE ligne (≤ 56 px), 1re tuile visible sans défiler à 1000 × 600 (y ≤ 80), formulaire d'ajout, « + » des pages, croix de page, boutons déplacer/modifier/supprimer, jointure et import Power BI MASQUÉS ✅ 🌐
- [x] « Modifier » → mode Édition (libellé « Terminer », `aria-pressed`), tout ce qui précède visible ; retour en Lecture ✅ 🌐
- [x] Mode auto à chaque changement de table : Lecture si une page a des tuiles, Édition sinon (table connectée sans tuile → formulaire + conseil d'ajout ; en Lecture, le conseil de lecture remplace celui d'ajout) ✅ 🌐
- [x] Menus Données / Filtre / Vues / Exporter : `aria-expanded`, un seul ouvert à la fois, Échap le ferme ET rend le focus au bouton, clic ailleurs le ferme, panneau toujours dans la fenêtre (420 px) ✅ 🌐
- [x] Échap avec la liste d'un combobox ouverte dans un panneau : ferme d'abord la liste, pas le panneau ✅ 🌐
- [x] Pastille Données : « Connexion… » → nom de table + compteur ; « Aucune table » / « Connexion impossible » ; jamais « connectée avec 0 ligne » pendant la création de la configuration (`dashboardReady`) ✅ 🌐
- [x] Rangée de pastilles de filtre : une pastille par filtre croisé et par filtre avancé, compteur du bouton « Filtre », retrait d'une pastille, « Tout effacer » efface les deux familles ; 1re tuile à y ≈ 95 avec filtres actifs ✅ 🌐
- [x] Onglets de page : `role="tablist"`, ← → Début Fin circulaires (tabindex itinérant), défilement horizontal avec fondu quand ils débordent, double-clic (Édition seulement) renomme ✅ 🌐
- [x] Largeurs 700 et 420 : aucun défilement horizontal de la page, libellés de boutons masqués, barre ≤ 75 px, nom de table lisible (compteur de lignes masqué sous 560 px) ✅ 🌐
- [x] Aucune boîte native, aucune erreur console sur tout le parcours (dans un cadre `sandbox="allow-scripts"`) ✅ 🌐
- [x] Rendu clair ET sombre des panneaux relu à l'écran (aucune ambiance GFS choisie) ✅ 🌐
- [x] `placePopover` (cas nominal, rabattement à droite, marge à gauche, hauteur mini 120 px), `tabKeyTarget`, `menuKeyTarget` ✅ (Node)
- [x] `dev-tests/harness.html` identique à `index.html` (au badge près) — `sync-harness.isInSync()` ✅ (Node)
- [ ] **[NON TESTABLE ICI]** Clavier réel + lecteur d'écran sur les menus et les onglets ⬜ ; vrai GFS (ambiance choisie sur le chrome) ⬜ ; vrai Grist ⬜
- Piège de test : les scripts Playwright écrits AVANT ce lot cherchent des éléments désormais masqués en Lecture (« + », « Sauvegarder la vue »). Passer en Édition (`#mode-toggle`) avant, ouvrir le menu Vues avant de cliquer « Sauvegarder », et attendre `state: 'attached'` (pas « visible ») sur `#row-count`, masqué sous 560 px.

### `js/main.js` + `index.html` + `css/style.css` — panneau « Ajouter une visualisation », validation en ligne, formulaires dans GFS (18/11/2026, lot 2 de l'audit UI/UX, Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Lecture : bouton « Ajouter » et panneau masqués ; Édition : bouton visible, panneau fermé au départ, `aria-expanded` 🌐
- [x] Ouverture : étape « Choisir » seule visible, 12 cartes (11 + l'entonnoir du lot ECharts) avec nom et ligne de conseil (`advice.adviceForType`), focus dans le panneau 🌐
- [x] « Régler » (Barres) : dimension et mesure préremplies ET différentes, options avancées repliées, champ « Type » brut non affiché, aperçu rendu (canvas ECharts), placeholder du titre = titre automatique 🌐
- [x] Un clic dans l'aperçu ne pose aucun filtre croisé 🌐
- [x] Ajouter : +1 tuile, panneau fermé, titre personnalisé conservé, tuile qui clignote, focus rendu au bouton « Ajouter » 🌐
- [x] Validation en ligne (tableau croisé avec la même colonne en lignes et colonnes ; jauge Min > Max) : aucune tuile ajoutée, message sous le champ, `aria-invalid` + `aria-describedby`, focus sur le champ fautif, aucune fenêtre de message, aperçu masqué, erreur retirée dès la correction 🌐
- [x] Échap ferme le panneau et rend le focus ; retour en Lecture ferme le panneau 🌐
- [x] Modifier une tuile : ouvre à l'étape « Régler », titre « Modifier », bouton « Enregistrer », titre personnalisé prérempli, titre automatique → champ vide ; titre vidé → retour au titre automatique ; même nombre de tuiles 🌐
- [x] EN : titre du panneau, cartes et lignes de conseil traduits 🌐
- [x] Aucune boîte native, aucune erreur console sur tout le parcours 🌐
- [x] 700 px : panneau AU-DESSUS des tuiles, aucun défilement horizontal ; 1000 px et 1300 px : panneau à droite des tuiles, sous la barre 🌐
- [x] **Formulaires dans le cadre isolé de GFS** (ajout de tuile, filtre avancé, commentaire ; clic ET Entrée ; page directe ET `<iframe sandbox="allow-scripts">`) — voir bug n°33 ✅ 🌐
- [x] Écran d'accueil (cartes de suggestion de la PR 2b) + `#welcome-add` : le bouton ouvre le panneau ; capture relue 🌐
- [ ] **[NON TESTABLE ICI]** Vrai GFS ⬜ ; vrai Grist ⬜ ; clavier réel/lecteur d'écran ⬜ ; latence de l'aperçu sur un très gros tableau ⬜
- Pièges de test : (1) un combobox STRICT ne peut pas être vidé (le blur remet la dernière valeur valide) : pour obtenir une erreur de validation, choisir deux valeurs incompatibles (même dimension en lignes/colonnes, jauge Min > Max) plutôt que vider un champ ; (2) attendre `state: 'attached'` sur `#row-count`, masqué sous 1100 px ; (3) toujours rejouer dans un cadre `sandbox="allow-scripts"` : un test en page directe ne voit ni les formulaires morts ni les boîtes natives muettes.

### `js/vendor/echarts/` + `js/charts.js` — montée d'ECharts 5.x -> 6.1.0 (18/11/2026, Playwright contre le harnais servi en HTTP + `dev-tests/grist-stub.js`)

- [x] `echarts.version` lue dans la page = `6.1.0` (la v5 vendorisée répondait 5.5.1 : ne pas s'y fier pour savoir ce qui est chargé) 🌐
- [x] Les 12 types de tuile (barres, barres horizontales triées, courbe, aire, camembert, anneau %, treemap, nuage de points, cascade, radar, jauge, KPI) rendus sur 576 lignes : aucun message `error`/`warning`/`pageerror` ; capture avant/après de CHAQUE tuile comparée à l'écran (c'est ainsi que le treemap en bandeau, les noms « Widge… » du camembert et le petit radar ont été vus) 🌐
- [x] ⚠ Attendre `GristBI.store.getState().rows.length > 0` AVANT d'ajouter les tuiles (~10 s) : sinon elles se rendent sans donnée, la comparaison ne prouve rien et le radar vide lève une exception
- [x] `getInstance(id).getDataURL({ pixelRatio: 2, backgroundColor: '#fff' })` rend un PNG (chemin des exports PDF/PPTX) 🌐
- [x] Clic souris RÉEL (coordonnées calculées avec `convertToPixel` / `getItemLayout`, valeurs DANS l'échelle réelle de l'axe) : secteur de camembert, rectangle de treemap et point de nuage de points posent le bon filtre croisé ; une barre avec `drillDimensions` descend d'un niveau 🌐
- [x] Info-bulle au survol d'une barre : « Sud 2 400 » 🌐
- [x] Radar dont un filtre vide toutes les lignes : aucune exception, instance sans série (avant : `reading 'push'`, v5 comme v6) 🌐
- [ ] **[NON TESTÉ ICI]** tuiles en mode mesure DuckDB (cumul/YTD/N-1) sous la v6 ; thème sombre ; nuage de mots ; vrai Grist / vrai GFS

### `js/charts.js` + `js/data.js` + `js/advice.js` + `js/welcome.js` + `js/pbix-layout.js` — entonnoir (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `isSortableTile` : l'entonnoir est triable (`sort: 'none'` côté ECharts, c'est `sortMode` qui ordonne) ; `tileExportSheet` : valeur décroissante OU ordre des données, `tileExportKind` = image ✅
- [x] `advice.defaultsForType('funnel')` : dimension à 3-8 valeurs, tri valeur décroissante ; sur des mois, ordre des données conservé ✅
- [x] `advice.adviceForTile` : valeurs négatives et plus de 10 étapes -> avertissement (`advice.funnel.*`), un entonnoir normal -> aucun ; `adviceForType` rend toujours une ligne ✅
- [x] `previewFor('funnel')` : largeurs relatives à la plus large étape dans l'ordre affiché, `null` pour une seule étape ; `previewSvg` : une bande par étape, aucun `NaN` ✅
- [x] `pbixLayout` : le visuel `funnel` devient une tuile `funnel` ; colonne absente -> `tileData: null` ✅
- [x] Panneau : carte « Entonnoir » + ligne de conseil ; préremplissage ; champ Tri visible, Horizontal/Anneau masqués ; aperçu vivant ; ajout ; édition 🌐
- [x] Clic souris RÉEL sur une étape (coordonnées lues dans `getItemLayout(i).points`) : filtre croisé sur la bonne étape 🌐
- [x] Libellé anglais du type ; aucun message de console 🌐
- [ ] **[NON TESTABLE ICI]** un vrai fichier .pbix avec un `funnel` ; vrai Grist / GFS ; thème sombre ; étapes très inégales (`minSize` 8 %)

### `js/data.js` + `js/charts.js` + `js/advice.js` + panneau — séries multiples (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `isSeriesTile` : barres brutes et courbe/aire OUI ; barres en mode mesure, camembert, entonnoir, treemap, cascade, radar, nuage de points, KPI, jauge, tableau croisé, nuage de mots NON ; colonne vide/absente NON ✅
- [x] `splitBySeries` : ordre de première apparition, cellule vide ET `null` sous « (vide) », valeur numérique -> libellé texte, aucune ligne -> aucune série ✅
- [x] `assembleSeries` : catégorie absente = `null` (pas 0) ; tri `value-desc` / `label` sur le TOTAL des séries, valeurs suivant leur catégorie ; mode inconnu = ordre d'apparition ; entrées jamais mutées ; aucune catégorie -> structure vide valide ✅
- [x] `tileExportSheet` : une colonne par série, trou = cellule vide, même ordre que l'écran ; sans série, export historique inchangé ; un filtre croisé retire la série qui n'a plus de ligne ✅
- [x] `advice.adviceForTile` : plus de 8 séries / série = dimension -> avertissement ; sans série ou avec 3 séries -> aucun avertissement de série ✅
- [x] Clés i18n `advice.series.*`, `tileForm.series.label`, `tileForm.error.seriesSameAsDimension`, `chart.series.empty`, `tileTitle.measureByDimensionSeries` définies fr/en, variables identiques ✅
- [x] Panneau : champ visible pour barres et courbe, masqué pour les 6 autres types testés ; choix par le vrai combobox ; aperçu vivant avec légende ; erreur « série = dimension » sous le champ ; ajout ; édition (valeur reprise) ; retrait de la série ; libellé anglais 🌐
- [x] Rendu : 3 séries ECharts, légende `scroll`, trou `null` pour la combinaison absente (barre absente / rupture de la courbe), courbe+aire 🌐
- [x] Clic souris RÉEL (`getItemLayout` de chaque série) : le filtre porte sur la catégorie, quelle que soit la série cliquée 🌐
- [x] ⚠ DuckDB RÉEL : table de 6 050 lignes (> `DUCKDB_ROW_THRESHOLD`), moteur chargé (`duckdbEngine.isReady()`), séries/catégories/trous/tri identiques à la référence JS pure (`tileExportSheet`) 🌐 — à rejouer si `computeSeriesGroups` change. ⚠ Le rejouer AVEC UNE DIMENSION ENTIÈRE (une année) ET une dimension texte : DuckDB rend un entier en BigInt (`2022n`), le JS pur en nombre ; un `Map`, un `===` ou un `indexOf` entre les deux ne les confond jamais, sans erreur (bug réel de la PR #65, raté par un test sur une dimension texte seule)
- [ ] **[NON TESTABLE ICI]** vrai Grist / GFS ; une requête DuckDB par série sur de très gros volumes (coût) ; plus de 8 séries ; thème sombre

### `js/data.js` + `js/charts.js` + `js/advice.js` + panneau — empilé (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `isStackedTile` : barres (même horizontales) et aire (courbe + `areaFill`) avec une colonne Séries OUI ; courbe sans remplissage, sans série, `stacked` faux/absent, barres en mode mesure, pie/funnel/treemap/waterfall/radar/scatter/kpi/gauge/pivot NON ✅
- [x] `tileExportSheet` d'une tuile empilée = celle de la même tuile non empilée ✅
- [x] `advice.adviceForTile` : empilé + avg/min/max -> `advice.stacked.notAdditive` ; sum/count, non empilé, courbe sans aire -> pas cet avertissement ✅
- [x] Panneau : case masquée sans série, visible avec série (barres), masquée pour une courbe tant que « Aire » n'est pas cochée, masquée de nouveau quand la série est retirée ; aperçu vivant empilé ; ajout ; édition (case reprise) ; libellé anglais 🌐
- [x] Rendu : `stack: 'total'` sur chaque série ; barre absente = `null`, aire absente = 0 ; opacité d'aire 0,65 empilée / 0,25 sinon ; Aire décochée -> plus de pile 🌐
- [x] Info-bulle RÉELLE (souris sur une barre) : une ligne par série + `Total` = somme exacte 🌐
- [x] Clic souris RÉEL sur une barre empilée : filtre sur la catégorie 🌐
- [ ] **[NON TESTABLE ICI]** vrai Grist / GFS ; plusieurs valeurs négatives ; plus de 8 séries empilées ; thème sombre

### `js/data.js` + `js/charts.js` + `js/advice.js` + panneau — choix de palette (18/11/2026, Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] `PALETTES.standard` = la palette historique, octet pour octet (une tuile sans choix ne change JAMAIS) ✅
- [x] `js/welcome.js:PALETTE` (copie pour les miniatures) = `PALETTES.standard` : le test lit le source de `welcome.js` ✅
- [x] `paletteColors` : `undefined`/`null`/`''`/clé inconnue/`constructor`/`__proto__`/`toString`/nombre -> standard ✅ ; `supportsPalette` : 9 types oui, cascade/KPI/tableau croisé non ✅
- [x] Palettes : hex `#rrggbb` en minuscules, aucun doublon ; dégradés : écart de luminosité OKLab >= 0,06 entre pas voisins (du foncé au clair), pas le plus clair >= 2:1 sur `#fcfcfb` ET `#ffffff` ; Okabe-Ito : 6 teintes dans la bande 0,43-0,77 ✅
- [x] `advice` : plafond de séries = nombre de couleurs de la palette (8 / 6 Okabe / 7 dégradé), `{max}` dans le message ; camembert/entonnoir/treemap en palette trop courte -> `advice.palette.tooFewColors`, jamais sans palette choisie ✅
- [x] Panneau : liste visible pour bar/line/pie/funnel/treemap/scatter/radar/gauge, masquée pour cascade/KPI ; pastilles = couleurs de la palette ; aperçu vivant ; édition (valeur reprise) ; retour à Standard -> `tile.palette` non écrite ; libellés anglais 🌐
- [x] ⚠ Rendu RÉEL : lire les PIXELS du canvas (`getImageData`), pas seulement `getOption().color` — les 4 parts d'un anneau Okabe portent 4 des 6 couleurs ; 9 types avec un dégradé rendus sans erreur ; la cascade reste vert/rouge ; clé de palette inconnue -> couleurs Standard 🌐
- [ ] **[NON TESTABLE ICI]** vrai Grist / GFS ; impression noir et blanc réelle du dégradé gris ; plus de 8 séries

### `js/grist-api.js` + `js/main.js` + `js/appbar.js` + `js/charts.js` — retours d'Antoine, 1re série (18/11/2026 ; Node avec un faux `grist` dans un contexte `vm` ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] `getCurrentUserEmail` : adresse lue du 1er coup → rien n'est modifié, la ligne de sonde est supprimée ✅ (Node)
- [x] Table-sonde à créer : colonne `Email` en formule DÉCLENCHÉE (`isFormula: false`, `formula: 'user.Email'`) ✅ (Node)
- [x] Ancienne colonne en erreur (`['E','NameError']`) : `ModifyColumn` une fois, relecture, l'adresse sort ✅ (Node)
- [x] Erreur persistante, `ModifyColumn` refusé, valeurs vides/anonymes/non-adresses : `null`, jamais une valeur d'erreur, jamais plus d'une réparation par session, aucune réparation hors cellule en erreur ✅ (Node)
- [x] Fenêtre de commentaire dans le cadre isolé, 4 variantes de sonde (adresse, réparable, erreur, anonyme) : étiquette « Auteur » visible, jamais « E,NameError », champ verrouillé + note seulement quand l'adresse est reconnue 🌐
- [x] Menu Filtre, 1er écran : aucune liste déroulante, focus dans la recherche (pas un combobox), les 13 colonnes listées, liste contenue dans le menu sans le faire défiler, recherche « date » / sans résultat 🌐
- [x] Menu Filtre, 2e écran : plage Min/Max, focus sur « Min », erreur en ligne sans fenêtre (menu reste ouvert, erreur retirée à la saisie), « Ajouter le filtre » → menu fermé + pastille, réouverture = 1er écran 🌐
- [x] Filtre texte : valeurs cliquables (4 régions), saisie « o » filtre la liste, un clic sur « Nord » pose le filtre et ferme le menu 🌐
- [x] Clavier : « ← Colonnes », ↓ depuis la recherche, ↑ depuis la 1re colonne, Entrée dans la recherche, Échap 🌐
- [x] « Effacer les filtres » : bordure, fond, ni souligné ni lien, icône 🌐
- [x] Icône Réglages : viewBox 24, un tracé long + le cercle central (roue crantée), vue à l'écran 🌐
- [x] Infobulle du radar : tout le rectangle de la bulle DANS la tuile (mesuré), nombres au format français 🌐 (script ad hoc)
- [ ] **[NON TESTABLE ICI]** `ModifyColumn` sur une vraie colonne formule + `user.Email` réel ⬜ ; clavier réel/lecteur d'écran ⬜ ; vrai GFS/Grist ⬜
- Pièges de test : (1) le mock ne simule pas le moteur de formules — pour tester la sonde, envelopper `fetchTable`/`applyUserActions` du mock (option `stubPatch` de l'environnement de test, ajoutée en fin de `grist-stub.js` servi) ; (2) un objet créé dans un contexte `vm` n'a pas le prototype du contexte principal : comparer par `JSON.stringify`, pas `deepStrictEqual` ; (3) donner un `setTimeout` immédiat au contexte `vm` pour passer le garde de course de 9 s sans attendre ; (4) pour mesurer une bulle ECharts, chercher le `div` en `position: absolute; z-index: 9999999`, sa `visibility` bascule à `hidden` entre deux survols.

### `js/state.js` + `js/main.js` + `index.html` + `css/style.css` — suivi de la vue sauvegardée active (retours d'Antoine, 18/11/2026, point 4 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe, `<iframe sandbox="allow-scripts">`, anglais, 700 px)

- [x] `sameSnapshot` : ordre des filtres et des clés indifférent, chemin de drill-down vide = aucune entrée, `advancedFilters` absent = `[]`, valeur ou drill-down différent = autre vue ✅ (Node)
- [x] Suivi : rien au départ ; sauvegarder → vue suivie non modifiée ; filtre croisé / avancé / drill-down de plus → modifiée ; DÉFAIRE → non modifiée (dérivé, pas collant) ✅ (Node)
- [x] `updateBookmark` : même id et nom, contenu remplacé, nouvelle référence de `bookmarks` (donc sauvegarde planifiée), id inconnu = no-op ; `leaveBookmark` : filtres conservés ✅ (Node)
- [x] `applyBookmark` rend la vue active, id inconnu = no-op ; vue vide valide (modifiée dès qu'on pose un filtre) ; supprimer la vue suivie libère le suivi, une autre non ; `setBookmarks` (changement de table) le lève ; vue d'avant les filtres avancés ✅ (Node)
- [x] Menu Vues : plus de `<select>`, message « aucune vue » quand la liste est vide, liste de lignes (une seule `aria-current`), vue suivie cochée avec « vue active » puis « modifiée » 🌐
- [x] Bouton de la barre : nom de la vue, point seulement si modifiée, signet plein (`data-view-active`), nom accessible mentionnant la vue ; à 700 px nom masqué mais point et nom accessible conservés 🌐
- [x] Pastille : nom, « modifiée » + « Mettre à jour » seulement si modifiée, tient dans la rangée à 700 px, rangée visible même sans aucun filtre tant que la vue est suivie 🌐
- [x] « Mettre à jour » du menu ET de la pastille (2 filtres puis 1) ; clic sur une ligne : applique, ferme le menu, restaure la vue telle que sauvegardée ; croix de la pastille : suivi levé, filtre conservé ; « Effacer les filtres » : filtres ET suivi levés 🌐
- [x] Suppression : fenêtre de confirmation du kit (aucune boîte native), annuler conserve, confirmer supprime et libère le suivi ; Tab atteint lignes et croix 🌐
- [x] Même parcours en anglais ; démo à 4 vues (liste, appliquer « Focus canal En ligne », modifier, re-cliquer pour revenir) ; aucune erreur de console 🌐
- [ ] **[NON TESTABLE ICI]** vrai Grist / GFS ⬜ ; lecteur d'écran réel (pas de zone `aria-live` sur « modifiée ») ⬜
- Pièges de test : (1) la démo (`demo/preseed.json`) contient DÉJÀ 4 vues : un test « liste vide » doit partir d'une copie dont `bookmarks` est vidé ; (2) dans le cadre isolé la langue ne peut pas être forcée par `localStorage` (origine opaque) : tester l'anglais en page directe ; (3) le libellé du compteur de lignes dépend de la langue (`ligne`/`row`) : ne pas s'en servir comme signal de chargement en dur ; (4) cliquer dans la fenêtre de confirmation compte comme un clic hors du menu, qui se referme.

### `js/state.js` + `js/main.js` + `index.html` + `css/style.css` — agrandir une tuile sur place (retours d'Antoine, 18/11/2026, point 8 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe, `<iframe sandbox="allow-scripts">`, anglais à 1300 px, 420 px)

- [x] État : plusieurs tuiles agrandies exposées dans l'ordre d'AFFICHAGE, toggle, id inconnu = no-op, aucune nouvelle référence de `pages` (rien à persister), `clearZoom` sans effet ne notifie pas ✅ (Node)
- [x] Nettoyage : supprimer une tuile / une page / `setPages` retirent les ids disparus, une tuile recréée n'est pas agrandie ; multi-pages : agrandissement mémorisé par tuile, `getState` n'expose que la page courante ✅ (Node)
- [x] Bouton Agrandir sur chaque tuile : `aria-pressed`, nom accessible qui change (Agrandir / Réduire), une seule icône visible 🌐
- [x] Zone : masquée au départ, au-DESSUS de la grille, pleine largeur pour une tuile, côte à côte pour deux, libellé au pluriel, ordre d'affichage conservé, tuiles de la grille inchangées et dans le même ordre 🌐
- [x] MÊME instance ECharts (non détruite) déplacée et redimensionnée (largeur ×1,5 au moins), canvas contenu dans la tuile, hauteur stable sur 5 mesures espacées de 350 ms (piège n°8), retour à la taille d'origine à la réduction 🌐
- [x] Un clic sur une barre de la tuile AGRANDIE pose un filtre croisé ; carte KPI agrandie : chiffre ≥ 1,4× plus grand 🌐
- [x] « Tout réduire », réduction par le bouton de la tuile, changement de page (zone masquée puis retrouvée), Édition (déplacer masqué, modifier/supprimer disponibles, supprimer une tuile agrandie), panneau d'ajout ouvert (la zone reste dans la colonne de gauche), 420 px sans défilement horizontal, aucune erreur de console 🌐
- [ ] **[NON TESTABLE ICI]** vrai Grist / GFS ⬜ ; widget de moins de 400 px de haut ⬜
- Pièges de test : (1) `locator.evaluate(fn, arg)` passe l'ÉLÉMENT en 1er paramètre, l'argument en 2e (`(el, id) => …`) — un `(id) => …` reçoit le `<body>` et `getInstance` rend `null` sans erreur claire ; (2) la démo au-delà de 5 000 lignes passe par DuckDB : les valeurs et les catégories sont des `BigInt` (`JSON.stringify` et `convertToPixel` échouent) — viser une barre par son INDICE (`[0, v/2]`) et stringifier ; (3) `innerText` rend le texte APRÈS `text-transform` (« 1 TUILE AGRANDIE ») ; (4) la 1re version de `.tile-zoomed` perdait contre `.tile { height: 224px }` (même spécificité, `.tile` défini plus bas) : sélecteur `.tile.tile-zoomed`, attrapé par la mesure de hauteur, jamais « à l'œil ».

### `js/models.js` + `modeles/` + `js/main.js:openModelById` — modèles de « Nouveau > Depuis un modèle » (consigne GFS 016, 18/11/2026, Node ; Playwright contre le vrai `index.html` dans un `<iframe sandbox="allow-scripts">` servi par un FAUX GFS parent, avec le vrai kit 0.24.0)

- [x] `models.build` sur le jeu de test pour les 3 modèles, fr ET en : de 3 à 6 tuiles, vraies colonnes, agrégat valide par tuile, tuiles sans `id`, ajout au store ✅
- [x] Contenu : vue d'ensemble = KPI, KPI, aire, barres, anneau (aucune dimension de temps dans les barres/anneau) ; évolution = KPI avec tendance, aire, aire empilée par catégorie (même axe, même mesure, reconnue par `isStackedTile`), barres par mois ; répartition = deux barres sur deux dimensions différentes, aucune dimension de temps ✅
- [x] Cas limites : sans date -> évolution refuse (`missing: ['time']`), vue d'ensemble reste possible sans courbe ; nombres seuls -> `['category']` ; table vide/`undefined` -> `['data']` ; `id` inconnu, `__proto__`, `toString` -> `unknown` ; textes seuls -> comptage de lignes ✅
- [x] Deux appels de suite ne partagent aucun objet (un modèle ne modifie jamais les suggestions) ; sans `opts.t` aucun mot de français dans un titre ✅
- [x] Clés `models.*` citées par le code : toutes définies fr/en, mêmes variables, aucune définie sans être utilisée ✅
- [x] `modeles/modeles.json` : règles de GFS (id `[a-z0-9][a-z0-9._-]{0,63}` unique, type `rapport`, nom ≤ 60 et description ≤ 140 fr/en, étiquettes bilingues, WebP 240 × 320 ≤ 12 Ko lu dans l'en-tête du fichier, aucune vignette orpheline), ni `tables` ni `extensions`, correspondance exacte avec `models.ids()` ✅
- [x] Câblage lu dans la source : `onOpen` lit `modele` et ne retombe jamais sur le départ vierge, `bootstrap` a sa branche avant « Nouveau », `openModelById` ne mentionne pas `createTableFromRows`, `index.html` charge `js/models.js` après `js/advice.js` ✅
- [x] 🌐 Faux GFS parent (`<iframe sandbox="allow-scripts">`, contexte `{ ouverture: { raison: 'modele', modele: { id } } }`, appel `ouvrir`) : ouverture initiale -> 5 tuiles, **0 ligne** dans `BI_Dashboard_Config` ; un geste (nouvelle page) -> **1 ligne** avec les tuiles du modèle ; `ouvrir` d'un autre modèle -> `{ ouvert: true }`, pas de seconde ligne ; `id` inconnu et type `document` -> `{ ouvert: false }`, écran inchangé ; « Nouveau » sans modèle -> toujours vierge ; table de nombres seulement -> `{ ouvert: false }` + message « colonne de catégories » ; ouverture initiale d'un `id` inconnu -> démarrage ordinaire (table connectée, rien d'écrit) + message ; page anglaise ✅
- [x] ⚠ Le rendu RÉEL de l'aire empilée du modèle « Évolution » : lire les valeurs de `getOption().series` (pas seulement la légende) — c'est ce qui a révélé le bug n°34 ✅
- [ ] **[NON TESTABLE ICI]** le vrai GFS (fenêtre « Depuis un modèle », « Créer », copie du catalogue) ; un vrai Grist ; des tables réelles variées

### `js/format.js` + `js/charts.js` — format des nombres des tuiles (audit de lisibilité, 18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

Jeu d'audit (scratchpad, non committé) : une tuile par type et par cas limite (somme énorme, moyenne minuscule, comptage, libellés longs, 24 catégories, négatifs) sur une table de 96 lignes, puis 6 000 lignes pour DuckDB. Captures avant/après dans le dossier du projet (`audits/`).

- [x] Automatique : entiers dès 1 000, 1 décimale de 100 à 1 000, 2 décimales de 0,1 à 100, 2 chiffres significatifs sous 0,1, compact dès 10^12 ; séparateurs fr/en ✅
- [x] `-0` jamais affiché ; `null`/`NaN`/`undefined` -> chaîne vide ; chaîne numérique et `BigInt` acceptés ✅
- [x] Axes : graduations toutes distinctes (0 -> 0,3 par 0,05 ; 0 -> 0,0007 par 0,0001) ✅
- [x] Personnalisé : décimales fixes (zéros conservés), notation compacte, bruit de flottant absent, spécification invalide -> Automatique ✅
- [x] Comme dans la colonne (fonction pure seulement à ce stade) : devise, décimales min/max, %, scientifique, parenthèses, locale du document, JSON invalide, colonne absente/non numérique, comptage ✅
- [x] Chaque infobulle (barre, courbe, aire, camembert, anneau, treemap, entonnoir, cascade, radar, nuage de points, empilé) affiche le format de la langue, jamais « 1,542,980.8799999997 » 🌐
- [x] KPI : variation en % aux séparateurs de la langue (« 12,8 % » / « 12.8% ») ; valeur minuscule lisible (« 0,00056 ») 🌐
- [x] 6 000 lignes (DuckDB, `BigInt`) : KPI, infobulle de barre, libellé d'axe formatés 🌐
- [ ] Lecture des options de colonne dans un vrai Grist ⬜ **[NON TESTABLE ICI]** (réglage de tuile et lecture de `_grist_Tables_column` : voir le lot 3 ci-dessous, vérifié contre le mock seulement)

### `js/format.js` + `js/charts.js` + `css/style.css` — jauge et carte KPI (audit de lisibilité, lot 2, 18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`)

- [x] Jauge : arc, bornes, aiguille et valeur sans aucun chevauchement à 316 x 162 px (tuile normale), ~300 px (viewport de 330 px), agrandie, en thème sombre 🌐
- [x] Jauge : valeur de 20 caractères réduite pour tenir, valeur supérieure au maximum (aiguille bloquée au bout, arc plein), valeur négative, borne basse négative, comptage, ratio 0-1 🌐
- [x] Jauge : géométrie qui suit l'agrandissement de la tuile (`resizeAll` -> `__refit`) 🌐
- [x] Carte KPI : valeur courte à 30 px, valeur de 20 caractères réduite à ~20 px sans sortir de la tuile, valeur agrandie jusqu'à 84 px 🌐
- [x] `niceCeil`, `gaugeLayout` (arc, bornes et valeur dans la zone à 7 tailles), `fitFont` ✅
- [x] Échelles d'entiers : `plainScale` (années, 0-3000, 9999 oui ; 10 000, 3,27 M, bouts décimaux ou absents non), `forScale` (« 2010 » jamais « 2,01 k » ni « 2 010 », « -0 » jamais, grande échelle inchangée, un non-entier garde `axis`, devise/pourcentage/décimales choisies conservés, BigInt) ✅ ; jauge sur 1990-2030 et 0-5000, histogramme d'une colonne d'années, libellés de classes lisibles (« 1995 – 2000 ») 🌐
- [x] Jauge, graduations extérieures : `gaugeTicks` (valeurs rondes, jamais aux extrémités ni plus que demandé, sans -0 ni bruit de flottant), `gaugeLayout` avec graduations (libellés dans la zone, au-dessus de la ligne de base, hors de l'arc, sans recouvrement ; 7 tailles x 4 plages x 3 plafonds), `overflow` sur une zone minuscule, géométrie inchangée sans graduation ✅ ; rendu clair/sombre/anglais, 340 px, agrandie 🌐
- [ ] Rendu dans un vrai Grist ⬜ **[NON TESTABLE ICI]**

### `js/format.js` + `js/grist-api.js` + `js/main.js` + `index.html` — réglage « Format des nombres » et « Comme dans la colonne » (audit de lisibilité, lot 3, 18/11/2026 ; Node ; Playwright contre `dev-tests/harness.html` et le vrai `index.html` + faux Grist avec `widgetOptions`)

- [x] `supportsNumberFormat` (types concernés, type inconnu, `null`) ✅
- [x] `columnModeState` : `ok` (devise, décimales), `none` (mode « decimal » sans décimales, `widgetOptions` vide), `unknown` (colonne absente ou non numérique), `count` ✅
- [x] La même valeur dans les trois modes (Automatique entier dès 1 000, Comme dans la colonne en euros, Personnalisé 2 décimales fixes / compact 1 décimale) ✅
- [x] `readColumnFormats` : colonnes de LA bonne table seulement, colonnes d'aide exclues, réglages du document ; table inconnue, tables système illisibles (avertissement, pas d'exception), `_grist_DocInfo` illisible, `widgetOptions` absent, `documentSettings` vide/invalide ✅ (faux `grist` dans un `vm`)
- [x] Panneau : ajouter une carte en « Comme dans la colonne » (KPI « 2 748 150,84 € »), la rouvrir (le formulaire relit le mode), passer en Personnalisé 0 décimale compact (« 3 M »), revenir en Automatique (la clé disparaît de la configuration) 🌐
- [x] Infobulles de barres dans les trois modes (« 581 482 » / « 581 482,16 € » / « 581 482,2 »), KPI pourcentage (« 17,15 % »), entier (« 186 »), comptage jamais formaté comme la colonne (« 12 ») 🌐
- [x] Langue anglaise : Automatique aux séparateurs anglais (« 2,748,151 »), mode colonne aux séparateurs de la locale du document 🌐
- [x] Le vrai `index.html` charge sans erreur (champ présent, aucune erreur de console) 🌐
- [x] Table plate : le champ apparaît, « Comme dans la colonne » donne « 100 000,23 € » / « 10 » / « 10,0 % » à trois colonnes de formats différents, ligne d'explication « chaque colonne numérique… » 🌐
- [x] Champ « Format des nombres » dans `<iframe sandbox="allow-scripts">` (serveur avec CORS, sinon le kit est bloqué) : bloc Personnalisé affiché, ajout d'une carte, `numberFormat` écrit, KPI « 9 350,000 » 🌐 (sans préremplissage `widgetOptions` : seul le réglage Personnalisé y est rejoué)
- [ ] Lecture de `_grist_Tables_column.widgetOptions` / `_grist_DocInfo.documentSettings` dans un vrai Grist ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + `js/advice.js` + panneau — tuile Texte (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] `renderTextHtml` : `<script>`, `<img onerror>`, `&`, guillemets échappés ; seules `h3 h4 p ul li strong br` apparaissent ✅
- [x] Repères : `# ` / `## ` / `- ` / `* ` / `**gras**`, ligne vide = paragraphe, retour à la ligne simple = `<br>` ; texte vide/`null`/non-chaîne -> chaîne vide ✅
- [x] Plafond `TEXT_TILE_MAX` (2 000 signes) ✅ ; `plainTextOf` sans repères ✅
- [x] Exports : `tileExportKind` = `text`, absente du classeur Excel (sync et async), feuille d'une cellule si demandée ✅
- [x] i18n fr/en (type, champ, aide, erreur, titre auto), ligne d'usage du type, aucun conseil de tuile ✅
- [x] Panneau : champs de données masqués, texte vide -> erreur sous le champ sans tuile ajoutée, HTML hostile jamais exécuté (aperçu et tuile), bouton Détail masqué, édition recharge le texte, titre anglais « Text » 🌐
- [x] `<iframe sandbox="allow-scripts">` : parcours au clic (Ajouter > carte Texte > saisie > bouton), aucune erreur ni boîte de dialogue 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/export.js` + `js/vendor/exceljs/` + `sanitizeSheetName` — export Excel avec ExcelJS 4.4.0 (consigne GFS 017, 18/11/2026 ; Node avec le VRAI paquet vendorisé, Playwright contre `index.html`)

- [x] Empreinte SHA-384 de `js/vendor/exceljs/exceljs.min.js` = celle du catalogue de GFS (`Pqp51FUN2/…`) ; `LICENSE` à côté ; `js/vendor/xlsx/` absent ; aucun `XLSX.` dans `js/export.js` ; aucune balise `<script>` d'ExcelJS ou de SheetJS dans `index.html` ✅
- [x] `cellValue` : nombre (0 compris), texte (vide compris), booléen, `null`/`undefined` -> vide, `NaN`/`±Infinity` -> cellule d'erreur, BigInt sûr -> nombre, BigInt > 2^53 -> texte, tableau -> texte (jamais l'objet), date invalide -> vide, texte > 32 767 -> plafonné ✅
- [x] Classeur écrit puis relu par ExcelJS : noms de feuille, en-tête, types de cellule (`ValueType`), date, feuille vide (en-tête seul) ; **XML inspecté** (lecteur de zip par le répertoire central) : 0 `<f>`, `t="e"` pour NaN, aucun `NaN`/`Infinity` en clair, texte `=SUM(A1)` en chaîne partagée ✅
- [x] `sanitizeSheetName` : unicité SANS tenir compte de la casse (« Ventes »/« ventes »/« VENTES » -> `Ventes`, `ventes (2)`, `VENTES (3)`), apostrophe en début/fin (y compris laissée par la coupe à 31), « History »/« history », nom vide ou d'espaces, caractères interdits ; tous acceptés par `addWorksheet` ✅ (mutation vérifiée : la comparaison sensible à la casse fait échouer le test)
- [x] Chaîne complète sans DOM : état réel -> `buildWorkbookSheetsAsync` -> `buildWorkbook` -> `writeBuffer` -> relecture (valeurs d'une barre agrégée, d'un KPI ; tuile Texte exclue ; préfixe de page) ✅
- [x] 🌐 Navigateur (`index.html` + faux Grist, 5 760 lignes) : aucune requête vers ExcelJS avant le clic, une après ; téléchargement `dashboard-bi.xlsx` ; relu : une feuille par tuile (aire, séries, barres par mois, KPI), tuile en mode mesure YTD avec ses 60 valeurs DuckDB, tuile Texte exclue ; aucune erreur de page ✅
- [x] 🌐 `<iframe sandbox="allow-scripts">` : AUCUN téléchargement (comme avec SheetJS sur `origin/main`) ; `sandbox="allow-scripts allow-downloads"` : téléchargement reçu ✅ — constat, pas un défaut de l'app ; le cadre de GFS déclare `allow-downloads` (lu)
- [ ] **[NON TESTABLE ICI]** le vrai GFS (le téléchargement dans son cadre), un vrai Grist, l'ouverture du `.xlsx` dans Excel/LibreOffice, les exports PDF/PPTX dans un cadre sans `allow-downloads`

### `js/data.js` + `js/format.js` + `js/charts.js` + panneau — table plate (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Colonnes : celles de `tile.columns` qui existent encore, dans l'ordre choisi ; sans ligne, la liste choisie telle quelle ✅
- [x] Tri : nombres numériques, texte « naturel » (Lot 2 avant Lot 10) sans casse, dates, vides TOUJOURS à la fin, stable, `BigInt`, copie (le tableau partagé n'est jamais trié) ✅
- [x] Cycle d'en-tête croissant -> décroissant -> origine (`aria-sort`, focus gardé sur l'en-tête), tri non enregistré dans la configuration 🌐
- [x] Nombres Automatique = donnée (2024, 1542980,88 / 1542980.88, `-0`, `BigInt`), format choisi respecté ✅
- [x] Formulaire : champs de données masqués, tout décoché -> erreur sous la liste sans tuile ajoutée, flèches ▲▼ (focus gardé, bornes désactivées), aperçu vivant, édition recharge l'ordre et les cases 🌐
- [x] Filtre croisé d'une autre tuile : les lignes suivent ; 1 200 lignes -> 500 affichées + message de troncature ; retour à 8 lignes 🌐
- [x] Exports : feuille Excel avec les colonnes dans l'ordre, `maxRows`/`truncated` pour PDF/PPTX ✅ (CDN pdfmake/PptxGenJS non joignable ici : seuls les blocs sont testés) ⬜
- [x] **[BUG RÉEL n°41]** Barres -> Table -> Barres par « Changer de type » : l'élément est recréé, la table s'affiche, le graphique revient avec un canvas non vide 🌐
- [x] `<iframe sandbox="allow-scripts">` : parcours au clic, aucune erreur ni boîte de dialogue 🌐
- [ ] Rendu avec de vrais types Grist (ChoiceList, Reference, Attachments) ⬜ **[NON TESTABLE ICI]**

### `js/charts.js` + `js/main.js` + `js/advice.js` + `css/style.css` — thème sombre, infobulles, libellés, nuage de mots (audit de lisibilité, lot 4, 18/11/2026 ; Node ; Playwright contre `dev-tests/harness.html` et le vrai `index.html`)

- [x] Thème sombre : quadrillage et traits d'axe aux jetons (plus de blanc éclatant), infobulle sombre, étiquettes de camembert/entonnoir sans contour, bandes du radar supprimées, traits d'entonnoir aux jetons — 12 types de tuile, avant/après 🌐
- [x] Infobulle : « Tablette Graphique Professionnelle 12 pouces » se replie au lieu d'occuper toute la tuile ; 12 px ; radar, entonnoir, camembert, barres 🌐
- [x] Barres de 6 catégories à libellés longs : six libellés tronqués (« Tab… », « Cla… »), plus un seul libellé coupé à gauche ; 24 catégories : un libellé sur k ; barres horizontales : graduations « 0, 300 k, 600 k, 900 k, 1,2 M » (« 200 k400 k600 k » collés avant) 🌐
- [x] Entonnoir : nom tronqué + valeur sur la 2e ligne, plus de libellé coupé à droite ; radar à noms de 44 caractères : noms tronqués, aucun coupé par le bord de la tuile 🌐
- [x] Nuage de mots sans d3-cloud : le message « indisponible » est lisible au centre de la tuile ✅🌐
- [x] Nuage de mots sans d3-cloud : aucune carte « Nuage de mots » dans « Ajouter une visualisation » (15 cartes) ; avec une entrée `d3-cloud` dans l'importmap, la carte revient (16) ; en modifiant une tuile Nuage de mots enregistrée, « Changer de type » la montre ; `importMapHas` rend `false` sur un JSON illisible, vide ou sans `imports` ✅🌐 — **remplacé le 18/11/2026 par les lignes « Extensions de GFS » ci-dessous (la carte est grisée, plus retirée)**
- [x] Extensions de GFS : `js/extensions.js` — état seule / hébergée sans l'extension / avec elle, source sans empreinte ou extension inconnue = jamais « active » ✅
- [x] Extensions de GFS : `load` n'ajoute AUCUNE balise sans l'extension ; avec elle, une seule `<script type="module" integrity crossorigin="anonymous">` ; extension retirée en cours de route = null même fichier déjà chargé ✅
- [x] Extensions de GFS : `requestInstall` appelle `GfsLink.install` (annulation sans exception), seule rend `standalone` ✅
- [x] « Nuage de mots » grisé dans l'app seule : carte `aria-disabled`, « Pas encore : disponible dans Grist Factory Suite », clic = fenêtre du grisé, l'étape « Choisir » reste ; aucun autre type grisé 🌐
- [x] « Nuage de mots » dans un faux GFS (`<iframe sandbox="allow-scripts">`, kit 0.24.0, vrai d3-cloud 2.0.0) : grisé « extension à ajouter », clic = appel `installer`, extension ajoutée sans rechargement -> carte dégrisée + tuile enregistrée repeinte, retrait -> message de retour 🌐
- [x] Rendu repris au changement de thème : `emulateMedia({colorScheme: 'dark'})` puis jeton `--surface` posé par le CSSOM -> quadrillage, fond d'infobulle et texte changent ; réécrire `--chrome-h` ne relance AUCUN rendu (compteur de `setOption`) 🌐
- [x] Avertissement radar « colonnes » : Quantité 19 / Marge 0,2 / Montant 65 000 -> `advice.radar.mixedScales` (colonnes citées) ; compétences sur 20, un seul axe, colonne vide : rien ✅
- [x] Le vrai `index.html` charge sans erreur ; 6 000 lignes (DuckDB, `BigInt`) : KPI, infobulle et axe inchangés 🌐
- [ ] Ambiance réelle de GFS (jetons posés par le kit) ⬜ **[NON TESTABLE ICI]**
- [ ] Rendu dans un vrai Grist ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — KPI avec objectif et courbe, tuile Progression (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Niveaux : seuil lui-même atteint, 59,9 -> rouge, dépassement (104 %) avec barre plafonnée, valeur négative -> barre vide, seuils réglables ✅
- [x] Objectif nul / négatif / absent / valeur vide -> rien (jamais de division par zéro) ; `58/100*100` sans bruit de flottant ; `BigInt` ✅
- [x] Lignes de Progression : objectif commun, colonne agrégée par catégorie, catégorie sans objectif sans barre ✅
- [x] Courbe : années triées, texte dans l'ordre des données, nulls ignorés, moins de 2 points -> rien, série plate au milieu, tracé exact ✅
- [x] Exports : Progression et KPI avec objectif en tables (Objectif, % de l'objectif), KPI sans objectif inchangée ✅
- [x] Formulaire : champs d'objectif sur KPI et Progression seulement, case courbe visible seulement avec une dimension de tendance, objectif <= 0 refusé, objectif obligatoire pour la Progression, seuil orange >= vert refusé, seuils par défaut non écrits 🌐
- [x] Rendu : 80 % orange / 100 % vert, texte « 80 % de l'objectif » + « objectif 11 688 », courbe à 2 tracés + point final, clic et clavier = filtre croisé, re-clic le retire, anglais 🌐
- [x] 6 000 lignes (DuckDB, `BigInt`) dans un cadre isolé : valeur 60 000, 600 % partout, aucune erreur 🌐 (le serveur de test doit envoyer les en-têtes CORS : un module ES chargé depuis une origine `null` est refusé sans eux)
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — combo barres + courbe, Pareto (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Pareto : tri décroissant sans toucher aux groupes d'origine, parts cumulées, 3 × 1/3 -> dernier point exactement 100, négatif/absent compté pour 0, total nul -> 0 (jamais NaN), liste vide/null ✅
- [x] Alignement de la courbe PAR NOM (catégorie absente -> `null`, catégorie `BigInt` face à un nombre), sans 2e agrégation -> courbe vide sans exception ✅
- [x] Tri réglable seulement hors Pareto ; palette et format des nombres oui ; colonne Séries non ✅
- [x] Export Excel : mêmes valeurs et même ordre que l'écran (2e mesure alignée / `% cumulé`), Pareto trié quoi que dise `sortMode` ✅ ; PDF/PPTX = image du graphique ⬜ (CDN non joignable ici)
- [x] Valeurs par défaut : 2 vraies mesures -> courbe sur la 2e ; une seule -> Pareto en Somme ; conseils (Pareto sur une moyenne, négatifs, courbe identique aux barres) ✅
- [x] Formulaire : champs (mode, mesure de la courbe, agrégat de la courbe) visibles selon le mode, ordre barres > agrégat > courbe > agrégat de la courbe, ordre historique du nuage de points et des barres retrouvé en changeant de type, libellés en anglais, erreur sous le champ si la courbe n'a pas de mesure 🌐
- [x] Rendu : 2 axes Y, 2 séries, légende, clic sur une barre = filtre croisé (autres catégories à 0,3), Pareto : axe droit 0-100, cumul croissant terminé à 100, repère à 80 %, retour en mode mesure 🌐
- [x] 6 000 lignes (DuckDB) dans un cadre isolé : barres et courbe alignées, aucun trou, aucune erreur 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/state.js` + `js/charts.js` + panneau — histogramme, filtre par plage (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Pas ronds (1, 2, 5 x 10^n) ; 10 notes sur 20 -> [0;5[ [5;10[ [10;15[ [15;20] avec 5 et 20 aux bons endroits ; chaque ligne dans une seule classe ✅
- [x] Vides, texte, booléens ignorés (jamais 0), `BigInt` accepté, texte numérique « 6 » accepté ; aucune valeur numérique -> aucune classe ; une seule valeur distincte -> une classe fermée ✅
- [x] Entiers : pas plus étroit que 1 ; décimales : bornes 0 / 0,2 / … / 1 sans bruit de flottant ; nombre de classes demandé indicatif, 1 ou texte -> automatique, plafond 60 ✅
- [x] Grille tirée de toutes les lignes, comptes sur les lignes visibles ✅
- [x] **Cohérence classe <-> filtre** : pour 4 jeux pseudo-aléatoires (décimaux, entiers, grands nombres, négatifs), le filtre de chaque classe retient exactement son compte ✅
- [x] `matchesFilter('range')` : cellule vide jamais prise pour 0, `maxExclusive` ; `filterSelects` (égalité à types mêlés, plage) ✅
- [x] Store : clic de classe = filtre `range` croisé, même classe = retrait, autre classe = remplacement, égalité <-> plage, tuile source affichée en entier, suppression de la tuile lève son filtre ✅
- [x] Export Excel : mêmes classes et comptes que l'écran, filtres des autres tuiles appliqués, grille inchangée ✅
- [x] Formulaire : dimension et agrégat masqués, classes visibles, colonne préremplie, valeur < 2 refusée avec message sous le champ, relecture à l'édition, champ vidé -> automatique 🌐
- [x] Rendu : classe cliquée en couleur / autres à 0,3 ; pastille « de 80 à moins de 100 » ; tuile Barres filtrée sur les seules lignes de la classe (somme vérifiée) ; re-clic le retire ; filtre d'une autre tuile : axe stable, comptes en baisse 🌐
- [x] 6 000 lignes dans un cadre isolé : somme des classes = lignes non vides, aucune erreur 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — carte de chaleur et tableau croisé coloré (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Rampes : 4 arrêts hex, luminance strictement décroissante, arrêts 2-4 = crans de `PALETTES` ; `standard`/`okabe`/inconnue/`constructor`/`__proto__` -> bleu ✅
- [x] `heatColor` : bornes exactes, interpolation, hors bornes et NaN ramenés dans [0 ; 1], luminance monotone sur 41 points de chaque rampe ✅
- [x] **Contraste du texte** : sur 101 couleurs de chacune des 4 rampes, noir ou blanc, jamais sous 4,5:1, toujours le meilleur des deux ✅ (le pire cas a fait passer `#1a1a1a` à `#000000`)
- [x] Grille : bornes (null, vide, booléen, texte ignorés), cellule sans valeur -> `null`, valeurs toutes égales -> milieu, négatifs, `BigInt` sans erreur ✅
- [x] `cellFilterToggles` : rien posé, case déjà sélectionnée, autre case de la même ligne, autre ligne, filtre de plage ; rejoué contre le vrai store (3 clics) ✅
- [x] Export Excel = la grille du tableau croisé (cases vides vides, Total) ; `tileExportKind` carte = `image`, tableau croisé coloré = `table` ✅
- [x] Formulaire : libellé « Dimension (lignes) », 2 dimensions + mesure + agrégat + palette + format visibles, tri/séries/classes masqués, dégradé de 4 pastilles + indice sous la palette, défauts remplis (deux catégories différentes) 🌐
- [x] Rendu : série `heatmap`, 46 cases pour 48 intersections (2 sans donnée absentes), légende aux bornes, **pixel de chaque case lu dans le graphique = couleur calculée (écart 0)** 🌐
- [x] Clic : filtre ligne + colonne, une seule case en couleur pleine (les autres à 0,3), autre case de la même ligne = la ligne reste, même case = les deux filtres retirés 🌐
- [x] Tableau croisé coloré : case à cocher visible, palette cachée tant qu'elle est décochée, une cellule colorée par case de données, 0 sur les cases vides et les totaux, texte noir/blanc, contour de la cellule active, décocher -> plus aucun `style` 🌐
- [x] Édition d'une carte : formulaire relu (type, dimensions, palette) ; thème sombre : légende, axes et cases lisibles 🌐
- [x] 6 000 lignes (DuckDB) dans un cadre isolé : mêmes cases, aucune erreur 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — ligne de repère (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] Types : barres (brut ou sans mode) et courbe oui ; mode mesure temporelle, camembert, KPI, combo, histogramme, carte de chaleur, tableau croisé, radar non ✅
- [x] Genre tracé : moyenne (sans `refValue`), valeur (0 valide, chaîne numérique), refus de `NaN`/`Infinity`/booléen/texte/vide, clés piégées (`constructor`, `__proto__`) ✅
- [x] Moyenne des valeurs affichées : vides jamais comptés comme 0, vrai 0 compté, négatifs, `BigInt`, aucune valeur -> pas de ligne ✅
- [x] Store : champs gardés puis effacés ; export Excel identique avec ou sans repère ✅
- [x] Formulaire : champ « Valeur de la ligne » seulement pour « Valeur fixe », erreur sous le champ sans nombre (le champ s'ouvre dans « Options avancées »), relecture à l'édition 🌐
- [x] Rendu : objectif 9 000 dans une tuile de barres (ligne dans le cadre) ; **objectif hors plage = axe élargi** ; barres horizontales (trait vertical, libellé en haut) ; courbe ; pile ; repère négatif ; objectif invalide et camembert sans ligne ; moyenne qui change après un filtre croisé 🌐
- [x] Libellé d'un trait horizontal hors de la zone de tracé (18/11/2026) : Node `refLabelLayout` (5 largeurs x 5 libellés : marge <= 22 % de la tuile, texte contenu, police 11 -> 9 px, troncature en dernier recours, entrées vides) ✅ ; 🌐 courbe qui monte (la fin reste visible, avant : cachée par le fond du libellé), barres verticales (valeur de la dernière barre lisible), tuiles de 270/300/350 px, clair et sombre, 4 styles ; contrepartie : noms de catégorie plus tronqués à 270 px ✅ ; ⬜ jamais dans un vrai Grist
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — étiquettes de valeur, courbe lissée, 100 % empilé (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)

- [x] `lineShapeOf` : `smooth`/`step` seulement pour une courbe ; `straight`, `constructor`, `__proto__`, nombre, `null` -> droit ✅
- [x] `supportsValueLabels` = barres hors mode mesure + courbe ; `isStackedPercentTile` : pile barres/aire seulement, ignoré sans « Empiler », sans Séries, en mode mesure ✅
- [x] `shareOfTotal`/`stackShares` : somme 100 (flottants compris), absent reste absent, total nul ou négatif -> aucune part, `BigInt`, texte numérique, longueurs inégales, vide/`undefined` ✅
- [x] Export Excel identique avec ou sans les trois options ✅ ; conseil `stackedPercent.negative` (et `stacked.notAdditive` qui prime) ✅
- [x] Formulaire : « En 100 % » seulement une fois « Empiler » coché, tracé de la courbe seulement pour une courbe, étiquettes pour barres et courbe, **ligne de repère masquée en 100 %**, édition qui relit les trois options, décocher « Empiler » efface le 100 % 🌐
- [x] Rendu : pile à 100 sur chaque catégorie, axe 0-100, valeurs brutes dans `data.raw`, infobulle « 25 % (1 000) » + total, aire 100 %, étiquettes dans les segments / au-dessus / à droite, lissé, escalier, camembert et forme inconnue sans effet 🌐
- [x] 6 000 lignes (DuckDB) dans un cadre isolé : mêmes réglages, aucune erreur 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/data.js` + `js/charts.js` + panneau — boîte à moustaches (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 220 et 6 000 lignes)

- [x] `quantileSorted` : vide, une valeur, effectif pair (médiane = moyenne des deux du milieu), impair, `p` hors [0 ; 1] borné ✅
- [x] `boxStatsByGroup` : quartiles contre des valeurs calculées à la main (`[2,4,4,4,5,5,7,9,100]` -> 4 / 5 / 7, 100 aberrante) ET contre un second calcul indépendant sur 300 lignes pseudo-aléatoires (3 groupes) ✅
- [x] Moustache = la valeur extrême qui reste dans les barrières (pas la barrière) ; aberrantes basses ET hautes ; valeurs identiques ; une seule valeur ; EIQ nul = toute autre valeur aberrante ✅
- [x] Ignorés sans devenir 0 : `null`, texte, chaîne vide, booléen, `NaN` ; `BigInt` et chaîne numérique acceptés ; groupe sans valeur numérique sans boîte ; ordre de première apparition ; `undefined`/vide sans exception ✅
- [x] Plafond de points tracés : les plus éloignées gardées, ordre croissant, `outlierCount` exact, plafond par défaut, plafond 0 ✅
- [x] Store : clic = filtre d'égalité du groupe, tuile source entière, autres tuiles filtrées, même groupe = retiré, suppression de la tuile = filtre levé ✅
- [x] Export Excel : une ligne par groupe, filtre d'une autre tuile appliqué, aucune ligne = en-têtes seuls ; `tileExportKind` = `image` ✅
- [x] Types : palette et format oui ; tri, séries, ligne de repère, étiquettes non ✅ ; défauts (vraie mesure, catégorie de peu de groupes, pas d'agrégat), `noMeasure`, conseils `tooManyGroups` / `fewValues`, jamais à l'accueil, i18n fr/en (pluriels) ✅
- [x] Formulaire : champ Agrégat masqué, libellé « Colonne numérique », préremplissage distinct, tuile enregistrée sans `aggFn` ni drill-down, titre `tileTitle.box` 🌐
- [x] Rendu : séries `boxplot` + `scatter`, valeurs = calcul pur, **pixel de la médiane = couleur de palette**, intérieur teinté, fond au-dessus de la moustache 🌐 ; thème sombre lisible 🌐
- [x] Clic réel : boîte = filtre + autres groupes à 0,3 + tuile source entière ; 2e clic (position relue : la rangée de pastilles décale la tuile) = filtre retiré ; **clic sur une valeur aberrante = filtre du bon groupe** (rang `value[0]`, pas `dataIndex`) 🌐
- [x] Filtre d'une autre tuile : boîtes recalculées ; barres -> boîte -> barres sans reliquat (`dataset.tileType`) ; tuile sans valeur numérique = message ; aucune erreur console 🌐
- [x] 6 000 lignes, page directe ET cadre isolé : mêmes vérifications, 157 aberrantes tracées (plafond 60 par groupe) 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**

### `js/styles.js` + `css/dash-styles.css` + `js/state.js` + `js/grist-api.js` + `js/main.js` — style global des tuiles (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)
- [x] ✅ Registre : cinq ids, clés `style.<id>.name/desc` présentes en fr ET en anglais ; id inconnu, vide, non chaîne ou clé de prototype (`constructor`, `__proto__`) -> Standard ; `configValue` n'écrit rien pour Standard
- [x] ✅ Passe ECharts : Standard rend le MÊME objet, rien de touché ; barres (rayon, pilule horizontale, valeurs au bout avec le formateur d'axe de la tuile, jamais au-delà de 14 barres, jamais avec plusieurs séries/empilé/combo/histogramme) ; courbes (lissage, repères gardés, aire non empilée seulement) ; parts (couleur de la carte, jamais du blanc en dur) ; palette de la tuile jamais remplacée ; options vides ou sans axe sans erreur
- [x] ✅ Couleurs : lecture `#rgb`/`#rrggbb`/`rgb()`, `var()` gardé tel quel, teinte douce lisible sur carte sombre pour 4 couleurs de départ dont un bleu marine
- [x] ✅ CSS : pour chaque style, tous les jetons de couleur en clair ET en sombre (un jeton oublié en sombre resterait clair), textes >= 4,5:1 sur les 3 fonds, (les jetons de `factory` identiques au kit : retirés avec ce style) pastille Standard identique à `css/style.css`, aucune règle sur la page pour Standard, aucune hauteur de tuile ni `min-height`
- [x] ✅ Store/configuration : `setDashStyle` (valeur identique : aucune notification donc aucune sauvegarde), valeurs mal formées -> Standard, id inconnu bien formé conservé ; aller-retour par le vrai `grist-api.js` ; anciens formats lus en Standard ; style hostile d'une ligne éditée à la main -> Standard
- [x] 🌐 Cinq styles x clair/sombre sur les types de tuile (barres, horizontales, courbe, aire, camembert, anneau, KPI, jauge, treemap, entonnoir, radar, table), tuile agrandie ; menu Réglages (cartes, `aria-checked`, rien en Lecture) ; persistance après rechargement avec la ligne `BI_Dashboard_Config` préremplie ; changement de style = rendu des graphiques ET sauvegarde, dans un cadre `sandbox="allow-scripts"`
- [x] ✅ (2e lot, Console/Verre/options) Registre : `factory` et `dense` retirés (inconnus -> Standard, id conservé à la sauvegarde) ; dégradés (couleur de la série, sens, plusieurs séries, jamais sur pile ni sur couleur illisible ni sur un dégradé déjà posé, éclaircissement sur carte sombre seulement) ; halo et aire en dégradé (jamais sur une pile) ; `console` = UN bloc de jetons + `color-scheme: dark` + jetons « sombres seulement » de `style.css` ; verre : `--surface` opaque et textes AA contre la PIRE carte translucide, aucun `backdrop-filter` sur `.chrome`, pastille qui remet à zéro les jetons hérités ; options : attributs de `<html>`, valeurs héritées/mal typées ignorées, trait seulement transparent, marge négative compensée, `styleOptions` écrit seulement s'il en faut un, store (référence neuve seulement si changement)
- [x] 🌐 (2e lot) Console et Verre x clair/sombre sur 4 pages de tuiles ; options seules et combinées sur les 5 styles ; tuile agrandie et panneau d'ajout en « uni » ; menu Réglages en clair et en sombre (pastilles propres, cases, persistance, retour au Standard efface les clés) ; cadre `sandbox="allow-scripts"` (choix d'un style ET case cochée)
- [ ] ⬜ Jamais rejoué : interaction avec une VRAIE ambiance GFS, exports PDF/PPTX avec le CDN, rendu dans un vrai Grist, `backdrop-filter` sur un vieux navigateur
- **Piège de test** : le mode Édition (qui montre le réglage) n'est posé qu'après le chargement de la configuration (~9 s, garde `tableExistsConfirmed`) ; un test qui bascule trop tôt voit le réglage disparaître. Attendre `document.body.dataset.mode === 'edit'`.

### `js/layouts.js` + `css/layouts.css` + `js/state.js` + `js/grist-api.js` + `js/main.js` — disposition de la page, réglée par page (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`)
- [x] ✅ Registre : cinq ids, seuils 0/640/900/900/1040, clés `layout.<id>.name/desc` + `layout.title/hint` en fr ET en anglais ; id inconnu, vide, non chaîne ou clé de prototype -> grille ; `configValue` n'écrit rien pour la grille, garde un id futur bien formé
- [x] ✅ `spansFor` / `figuresPerRow` / `startsFor` : toute ligne pleine pour 0 à 14 éléments et 1 à 4 par ligne, la dernière se partage la largeur, jamais une case vide
- [x] ✅ Plan : démonstration (11 tuiles) pour les quatre dispositions ; toutes les combinaisons 0-13 chiffres x 0-14 graphiques sans trou ; vedette seule / à deux / absente ; Rail avec et sans colonne de gauche ; hauteur d'un chiffre avec objectif ; entrées bizarres sans exception ; 1 000 tuiles
- [x] ✅ Ordre affiché (copie, jamais un tri en place, mêmes objets) ; cible des flèches (même groupe, voisine en grille) ; miniatures dans la boîte 60 x 40 et sans recouvrement
- [x] ✅ Store : réglage par page (l'autre page intacte), la grille retire le champ (JSON identique octet pour octet à l'ancien), id mal formé / page inconnue refusés, id futur gardé et affiché en grille, aucune nouvelle référence si rien ne change ; `moveTile` avec cible ; `setPages` assainit un `layout` hostile (9 valeurs) sans toucher l'original
- [x] ✅ Configuration : aller-retour par le vrai `grist-api.js` (faux `grist`) ; ancien format sans champ ; chemin `loadConfig` -> `setPages` -> `pageLayout` par page
- [x] ✅ CSS : trois seuils `@container` = `minWidthOf` ; `--lu` = 28 px ; rangées fixes ; aucun `min-height` ; règles communes 640 / 900 identiques ; règle de base de chaque bloc sans ombre ni verre ; boutons par-dessus le titre seulement en lecture au survol ; contrastes AA (`--text-muted` sur `--surface-sunken`) clair et sombre ; `dash-styles.css` ignore `data-layout`
- [x] 🌐 Quatre dispositions x clair/sombre (Standard) ; Console, Éditorial, Fluide, Verre dépoli ; fenêtre de 560 / 700 / 880 / 960 / 1 100 / 1 280 px (colonnes lues : grille aux petites largeurs, 12 ou 13 colonnes ensuite, aucun défilement horizontal) ; **hauteurs stables dans le temps** (8 échantillons sur 3 s) ; panneau « Ajouter » ouvert (zone rétrécie : repli sur la grille)
- [x] 🌐 **[BUG RÉEL] Réglages en Lecture** (retour d'Antoine, 18/11/2026) : en mode Lecture la fenêtre Réglages ne montrait que Langue et Crédits (Style et Disposition étaient `.edit-only`) et les réglages paraissaient absents ; le menu est maintenant identique dans les deux modes — Lecture : sections Style et Disposition visibles, un clic sur une carte change la disposition de la page et le champ `layout` est enregistré ; Node : aucune section de la fenêtre n'est `edit-only`
- [x] 🌐 **[BUG RÉEL] Fenêtre Réglages trop étroite** (retour d'Antoine, 18/11/2026 : « super étroit, plutôt un rectangle à l'horizontale ») : 420 px de large, tout en colonne ; maintenant 960 px au plus, cartes de style et de disposition en ligne (5 dès 900 px, 3 dès 600 px, 2, puis 1 dès 440 px), options de la Grille côte à côte, Langue et Crédits sur deux colonnes ; mesuré à 1 200 / 760 / 500 / 380 px de large, clair et sombre, cadre isolé : cartes comptées par rangée, aucun défilement horizontal, un clic sur une carte de disposition et de style en Lecture, une langue changée
- [x] 🌐 **[BUG RÉEL] « Uni » + « sans bordure » gardait une ombre** (retour d'Antoine, 18/11/2026) : les règles d'ombre de « sans bordure » (plus spécifiques) battaient « uni » ; Node : cascade rejouée sur le CSS (règle gagnante = `none` au repos / survol / agrandie pour Standard et chaque style ; « sans bordure » seul garde son ombre) ; navigateur : `box-shadow` calculé `none` pour les cinq styles, clair et sombre, trait transparent, coins à 0
- [x] 🌐 Mode Édition : boutons en flux, flèches ◀ ▶ désactivées au bon endroit et échange dans le groupe ; survol en lecture (boutons par-dessus le titre) ; tuile agrandie ; une disposition par page retrouvée en changeant de page ; champ `layout` présent dans `BI_Dashboard_Config` ; cadre `sandbox="allow-scripts"` (clic réel sur une carte) ; aucune erreur console
- [ ] ⬜ Jamais rejoué : rendu dans un vrai Grist / GFS, largeur réelle d'une zone de widget, écran tactile (`@media (hover: none)`), `:has()` sur un vieux navigateur, vraie ambiance GFS
- **Piège de test** : le harnais (`dev-tests/harness.html`) a son propre jeu de données (« Ventes », 8 lignes) : pour un cadre isolé avec les données de démonstration, servir `index.html` avec la route du faux `grist` (comme `lib.js` du scratchpad). La feuille `css/layouts.css` de l'en-tête du harnais s'ajoute à la main : `sync-harness.js` ne régénère que le corps. Attendre ~2,5 s après un changement de thème avant une capture (rendu des graphiques refait).

### `js/data.js` + `js/charts.js` + panneau — flux (Sankey) (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 220 et 6 000 lignes)

- [x] `sankeyFlows` : une valeur par paire dans l'ordre de première apparition, somme / comptage / agrégat inconnu = somme ; flux nuls ou négatifs écartés du tracé mais comptés (`dropped`) et gardés dans `pairs` ; lignes sans source ou sans cible ignorées ✅
- [x] Une même valeur des deux côtés (`A -> B`, `B -> A`, `A -> A`) = deux ensembles distincts, jamais de cycle ; `1` et `"1"` = même source ; `BigInt` et chaîne numérique acceptés ; entrées vides sans exception ✅
- [x] `topFlows` : sous le plafond = la même liste, sinon les plus gros dans l'ordre d'origine (égalités : les premiers), plafond 0, plafond par défaut ✅
- [x] Store : nœud = filtre de sa colonne, lien = source ET cible, même lien = les deux retirés, tuile source entière, suppression de la tuile = filtres levés ✅
- [x] Export Excel : une ligne par paire (négatives comprises), filtre d'une autre tuile appliqué, aucune ligne = en-têtes seuls ; `tileExportKind` = `image` ✅
- [x] Types : palette et format oui ; tri, séries, ligne de repère, étiquettes non ✅ ; défauts (deux catégories distinctes, Somme jamais Moyenne, Comptage sans mesure), `needTwoDimensions`, conseils `notAdditive` / `tooManyNodes` / `dropped`, jamais à l'accueil, i18n fr/en ✅
- [x] Formulaire : libellés « Source » / « Cible », 2e dimension obligatoire et différente avec messages propres au flux, titre `tileTitle.sankey`, pas de drill-down 🌐
- [x] Rendu : option ECharts `sankey` = calcul pur, marges des libellés qui suivent l'agrandissement de la tuile 🌐 ; thème sombre lisible 🌐 ; infobulle (nœud et lien, noms échappés, valeur au format de la mesure + part) vérifiée par la lecture des sources seulement ✅, jamais survolée dans un navigateur ⬜
- [x] Clic réel de souris : nœud = filtre de sa colonne ; lien = filtre source ET cible (mise en page lue dans `getItemLayout`, décalages `sy`/`ty` relatifs au nœud) ; 2e clic = filtre retiré ; autres éléments à 0,3 ; tuile source entière 🌐
- [x] Filtre d'une autre tuile : flux recalculés ; barres -> flux -> barres sans reliquat (`dataset.tileType`) ; flux sans valeur positive = message ; plafond de liens tracés + mention ; aucune erreur console 🌐
- [x] 6 000 lignes, page directe ET cadre isolé : mêmes vérifications 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : l'animation d'entrée du Sankey dure plus d'une seconde, les libellés paraissent rognés tant qu'elle n'est pas finie ; attendre ≥ 2,5 s avant une capture.

### `js/data.js` + `js/charts.js` + panneau — bulles (nuage de points + taille + couleur, 18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 480 et 6 000 lignes)

- [x] `bubbleDiameters` : l'aire (pas le diamètre) suit la valeur, plancher, maximum invalide, plancher au-dessus du maximum, taille nulle / négative / absente / `BigInt` ✅
- [x] `bubblePoints` : alignement par NOM (`2n` et `2`), mesure absente = `null` jamais 0, point sans X ou Y écarté et compté, sans taille = pas de champ `size`, entrées vides ✅
- [x] `isBubbleTile` / `isColorSplitTile` ; `isSeriesTile` et `isStackedTile` restent faux pour un nuage de points ✅
- [x] Export Excel : nuage simple inchangé ; + taille (agrégat propre) ; + couleur (colonne « série », un jeu de points par couleur) ; aucune ligne = en-têtes seuls ✅
- [x] Conseils : colonne de couleur = colonne des points, trop de couleurs, tailles sans aire, rien pour un graphique sain, colonnes absentes sans exception ✅ ; i18n fr/en ✅
- [x] Formulaire : champ de taille, agrégat de la taille visible seulement avec une taille, libellé « Couleur », tuile enregistrée avec `measureSize`/`aggFnSize`/`seriesColumn` et le titre `tileTitle.bubble` 🌐
- [x] Rendu : une série par couleur = calcul pur, **aire ~ taille**, diamètre maximal attendu, légende ; infobulle survolée (taille nommée, noms échappés) 🌐
- [x] **Clic réel de souris sur une bulle libre** = filtre ; autres bulles à 0,3 ; 2e clic = filtre retiré 🌐 ; agrandissement = bulle maximale plus grosse (`__refit`) 🌐
- [x] Filtre d'une autre tuile : tailles recalculées ; taille négative = bulle absente + conseil ; nuage de points simple inchangé ; nuage de points -> barres -> bulles sans reliquat ; aucune erreur console 🌐
- [x] 6 000 lignes (DuckDB), page directe ET cadre isolé : mêmes vérifications 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]** ; thème sombre non rejoué pour cette tuile ⬜
- **Piège de test** : les grosses bulles se chevauchent ; viser le centre d'une bulle recouverte par une autre clique sur la voisine. Choisir une bulle dont le centre est libre.

### `js/data.js` + `js/charts.js` + panneau — calendrier (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 400 et 6 000 lignes, clair et sombre)

- [x] `isoDayShift` : fins de mois, année bissextile, décalage nul, entrée invalide ✅
- [x] `calendarDays` : valeur par jour pour les 5 agrégats (+ inconnu = somme), jours triés, plusieurs lignes le même jour, dates invalides / nulles / nombres ignorées et comptées, aucune date = aucun jour, entrées vides ✅
- [x] Fenêtre d'un an : 366 jours dessinés, `hidden`/`total` exacts, plafond réglé / invalide / `Infinity` ; un trou n'est pas un jour à 0 ✅
- [x] Store : clic = filtre d'égalité du jour, tuile source entière, autres tuiles filtrées, même jour = retiré, suppression de la tuile = filtre levé ✅
- [x] Export Excel : un jour par ligne, tous les jours (au-delà de l'année aussi), filtre d'une autre tuile appliqué, aucune ligne = en-têtes seuls ; `tileExportKind` = `image` ✅
- [x] Types : palette et format oui ; tri, séries, repère, étiquettes non ✅ ; défauts (vraie colonne de dates, Somme ou Comptage), `noDate`, conseils `notDate` / `fewDays` / `truncated`, jamais à l'accueil, i18n fr/en (7 jours, 12 mois) ✅
- [x] Formulaire : libellé « Colonne de dates », colonne de regroupement / drill-down / tri / séries masqués, colonne qui n'est pas de dates refusée avec son message, préremplissage, tuile enregistrée sans drill-down 🌐
- [x] Rendu : série `heatmap` en `calendar` = calcul pur, plage = mois entiers, lundi en premier, légende = min / max ; **pixel de la case du maximum = dernier arrêt de la rampe, pixel d'un jour sans ligne hors rampe** 🌐 ; thème sombre 🌐
- [x] Infobulle survolée (« mercredi 9 avril 2025 » + valeur) ; **clic réel de souris** sur un jour = filtre, autres jours à 0,3, tuile source entière, 2e clic = retiré, clic sur un jour sans ligne = aucun filtre 🌐
- [x] Filtre d'une autre tuile : jours recalculés ; agrandissement = cases plus larges ; 500 jours = 366 dessinés + 500 exportés + conseil ; aucune date valide = message (sans exception ECharts) ; calendrier -> barres -> calendrier ; valeurs toutes égales ; aucune erreur console 🌐
- [x] 6 000 lignes, page directe ET cadre isolé : mêmes vérifications 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : un `setOption` avec `calendar` mais sans `range` lève dans ECharts ; l'état vide ne doit pas écrire de composant `calendar`.

### `js/keywords.js` + `js/pdf-text.js` + `js/publications.js` + `js/keywords-panel.js` + `js/grist-api.js` — mots-clés des publications (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, vrai `pdfjs.js` de GFS, vrais PDF)

- [x] `extractKeywords` : textes français et anglais réalistes (les expressions qui reviennent passent devant les rares), composé à trait d'union gardé, élision et possessif retirés, ligne vide = coupure, unité contenue non répétée, ex-aequo par ordre d'apparition (jamais alphabétique), texte vide / sans mot utile = aucun mot-clé ; texte court plafonné à un mot-clé pour cinq mots utiles (3 au moins, `maxKeywords` au plus), texte long inchangé ; `rakeKeywords` garde son comportement (découpage des phrases trop longues) ✅
- [x] `publications` : `attachmentIds` (`['L', 1, 2]`, liste nue, nombre seul, texte JSON, doublons, non-entiers), `columnChoices` (source PDF = colonnes de pièces jointes, source texte, sortie = colonnes de texte, mots saisis = texte / choix), `freshColumnName` (casse ignorée, `_2`…), `planRows` (cellule de sortie remplie jamais touchée, ligne sans source écartée, trois pièces jointes au plus) ✅
- [x] `keywordsForTask` : PDF lu, image ignorée (pas un PDF), PDF scanné = `noText`, mots saisis à la main exclus, aucun mot utile = `noKeywords` ✅ ; `runJob` : lots, erreur par ligne sans arrêt, refus d'écriture = arrêt, annulation écrit ce qui est prêt, source texte ✅
- [x] `pdfText.readPdf` : page par page, plafonds de pages et de signes, annulation, document libéré à la fin ET en cas d'erreur, `isPdfBytes` ✅
- [x] `grist-api` (faux `grist` et `fetch` dans un `vm`) : jeton en lecture seule mis en cache, adresse de téléchargement, 404, trop lourde, jeton expiré (une reprise), `addTextColumn` (jamais de formule, colId réellement rendu), `writeColumnValues` (un `UpdateRecord` par ligne, un seul `applyUserActions`), refus clair sans `jeton` ✅
- [x] Câblage : chaque id cherché par le panneau existe dans `index.html`, ordre des scripts (`extensions.js` avant le panneau), aucun `<form>` dans la fenêtre (piège n°20), aucune boîte native, textes fr/en, bouton réservé à l'Édition, aucune bibliothèque PDF dans la page, le panneau ne parle pas directement à GFS ✅
- [x] **Grisé, jamais masqué** : app seule (option PDF grisée, « Comment l'avoir » ouvre la fenêtre du grisé, la colonne de texte marche sans extension) ; hébergé sans l'extension (« Ajouter l'extension » appelle l'installation, la fenêtre se dégrise SANS rouvrir quand l'extension arrive, se regrise quand elle est retirée) 🌐
- [x] Travail réel avec le vrai pdf.js de GFS : trois lignes remplies, un scan « sans texte lisible », une ligne « sans PDF », mots saisis à la main inchangés, plus long gel de la page 88 ms, relecture de la table de travail (le tableau de bord voit la colonne) 🌐 ; **page directe ET cadre isolé** 🌐
- [x] GFS sans la capacité `jeton` : refus clair AVANT toute écriture, aucune colonne créée 🌐 ; anglais 🌐
- [ ] Un vrai Grist (réponse de `getAccessToken`, adresse de téléchargement d'une pièce jointe, `AddColumn`), un vrai GFS (capacités `jeton` et `ecrit` déclarées), de vrais PDF de chercheurs, 100 000 lignes ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : le faux GFS doit rendre un `integrite` égal au `sha384` du vrai fichier (le navigateur refuse sinon le `<script type="module">`) ; la fenêtre ne se repeint qu'à l'événement `extensions` (`GristBI.extensions.onChange`), jamais en relisant le lien.

### `js/data.js` + `js/charts.js` + panneau — Gantt (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 14 et 6 014 lignes, clair et sombre)

- [x] `ganttTasks` : tri par début (stable à début égal), fin avant début / fin absente / date illisible / nombre / date non ISO écartées et comptées, tâche d'un jour valide, libellé et statut vides, statuts dans l'ordre de la table et sur TOUTES les tâches valides, plafond (réglé, invalide, `Infinity`), `min`/`max`, entrées vides ✅
- [x] `ganttTicks` : mois / lundis / jours selon la durée, au plus 8, budget réglé (invalide = défaut), graduation de début seulement si la 1re est loin du bord, croissantes dans [0, 1) ✅ ; `ganttLayout` : `left`/`width` en fraction de l'axe, tâche d'un jour = une case, aujourd'hui dans l'axe (milieu de la case) / hors axe / NaN / jours limites ✅
- [x] Store : clic = filtre d'égalité du libellé, tuile source entière, autres tuiles filtrées, même valeur = retiré, suppression de la tuile = filtre levé ✅
- [x] Export Excel : une ligne par tâche dessinable, TOUTES (au-delà du plafond), triées, colonne de couleur seulement si choisie, filtre d'une autre tuile appliqué, aucune ligne = en-têtes seuls ; `tileExportKind` = `table` ✅
- [x] Types : palette oui, format de nombre non ; tri, séries de barres, repère, étiquettes non ✅ ; défauts (colonnes de dates dans l'ordre inverse de la table, libellé, statut), `noTwoDates`, conseils `noTask` / `manyStatuses` / `ignored` / `truncated`, jamais à l'accueil, i18n fr/en avec pluriels ✅
- [x] Câblage lu dans les sources : carte / option / icône, pas de drill-down, deux champs de colonne comboboxes, validation début et fin, ni mesure exigée ni écrite, dispatch, **chaque chaîne saisie échappée** (libellé, statut, infobulle), couleurs en ligne = palette seulement ✅
- [x] Formulaire : libellés, champs masqués (mesure, agrégat, drill-down, tri, 2e dimension), préremplissage, fin vide / colonne non date refusées avec leur message, tuile enregistrée sans mesure ni agrégat, édition qui recharge début / fin / statut 🌐
- [x] Rendu : lignes dans l'ordre du calcul pur, **géométrie des barres mesurée contre `ganttLayout`** (gauche, largeur), couleur par statut = palette, pastilles = statuts de la table, note des lignes écartées, graduations sans recouvrement, légende visible dans la tuile, année dans le coin de l'axe 🌐 ; thème sombre (axe collant = fond de la tuile) 🌐
- [x] **Clic réel de souris** sur une tâche = filtre (autres lignes estompées, tuile entière, 2e clic = retiré), Entrée sur une ligne focalisée, clic sur une pastille = filtre du statut (autres pastilles estompées) 🌐 ; filtre d'une autre tuile = seules les tâches retenues 🌐
- [x] Repère « aujourd'hui » à la position du calcul pur ; agrandissement = lignes plus hautes ; 260 tâches = 200 lignes + note + conseil + 260 exportées ; libellé et statut hostiles (`<img onerror>`) = texte, jamais du balisage, clic = filtre du texte exact ; aucune tâche = message + conseil ; gantt -> barres -> gantt (plus de balisage Gantt sur des barres) ; aucune erreur console 🌐
- [x] 6 014 lignes (au-delà du plafond), page directe ET cadre isolé : mêmes vérifications 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : les comboboxes du formulaire n'offrent que les colonnes du harnais au moment du chargement (Region, Produit, Mois, Quantite, Montant) : un essai qui remplace les lignes par d'autres noms de colonnes ne peut pas les choisir en tapant (le mode strict les refuse). Réutiliser ces noms, `Mois` et `Quantite` portant des dates ISO.

### `js/data.js` + `js/charts.js` + panneau — Petits multiples (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 60 et 6 060 lignes, clair et sombre)

- [x] `isSmallMultiplesTile` : barres brutes ou courbe + colonne Séries + `true` exact ; faux sans Séries, en mode mesure, sur un autre type, pour `'true'` ✅
- [x] Empilé / 100 % / repère / étiquettes ignorés quand la case est cochée, et BIEN restitués en la décochant (rien n'est effacé de la tuile) ✅ ; `refLineValue` = null
- [x] `smallMultiplesPanels` : 12 au plus, les premières, le reste compté ✅ ; `smallMultiplesRange` : 0 au plus haut, négatifs, 2 à 4 intervalles entiers et la plus haute valeur ≥ 50 % de l'échelle pour 19 maxima, vides/texte/BigInt ignorés, rien = 0 à 1 ✅ ; `smallMultiplesGrid` : colonnes selon la forme de la tuile, dans la tuile, sans recouvrement (titres compris), marges réservées, zone nulle sans exception
- [x] Export Excel identique à celui des mêmes séries superposées ✅ ; conseils (> 12 séries remplace celui des couleurs, une série, > 24 catégories, cas sain = rien, colonnes absentes sans exception) ✅ ; i18n fr/en ✅ ; câblage lu dans les sources (case, champs masqués, `readTileForm`, chaîne de `renderChart`, `__refit`, aucun HTML dans le nom de série) ✅
- [x] Formulaire : case absente sans Séries, présente avec ; cochée = pile / barres horizontales / étiquettes / repère masqués ; tuile enregistrée avec `smallMultiples: true` et SANS `stacked`/`horizontal` bien qu'ils aient été cochés ; édition relit la case 🌐
- [x] Option ECharts = calcul pur : un panneau, un titre, un jeu d'axes et une couleur par région, valeurs exactes dans l'ordre des catégories de la tuile, MÊMES `min`/`max`/`interval` partout, graduations des valeurs en 1re colonne seulement, catégories sous le dernier panneau de chaque colonne, aucune légende 🌐
- [x] Géométrie : chaque panneau dans la tuile, assez grand pour se lire, aucun recouvrement 🌐 ; agrandir = panneaux plus larges (`__refit`) et retour exact à la taille d'origine 🌐
- [x] **Clic réel de souris** sur une barre du 4e panneau (pixel par `convertToPixel`) : filtre de la catégorie, TOUS les panneaux estompent les autres catégories, tuile source entière, 2e clic = retiré 🌐 ; infobulle = catégorie + série survolée seulement, jamais les autres régions 🌐
- [x] Courbe en aire lissée : 4 séries `line` avec `smooth` et `areaStyle` 🌐 ; décocher : 1 grille, 4 séries, `__refit` indéfini, pile restituée ; recocher avec `stacked` resté dans la tuile : aucune pile 🌐
- [x] 14 séries = 12 panneaux + note « Les 12 premières séries sur 14 » + conseil `tooMany` 🌐 ; nom de série hostile (`<img onerror>`) : aucune balise injectée dans l'infobulle, rien exécuté 🌐
- [x] Quatre styles globaux (fluide, éditorial, console, verre) : toujours 4 panneaux, sans erreur ; captures relues 🌐 ; 6 060 lignes (DuckDB), page directe ET cadre isolé : mêmes vérifications 🌐
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : l'ordre des catégories suit le tri de la tuile, pas l'ordre d'apparition des lignes : un essai qui compare les valeurs lit les catégories de l'option. Un clic réel vise `instance.convertToPixel({ xAxisIndex: i, yAxisIndex: i }, [catégorie, valeur])` du bon panneau (rangés par colonne puis rangée).

### `js/data.js` + `js/charts.js` + panneau — Soleil (18/11/2026 ; Node ; Playwright contre le vrai `index.html` + `dev-tests/grist-stub.js`, page directe ET `<iframe sandbox="allow-scripts">`, 20 et 6 020 lignes, clair et sombre)

- [x] `sunburstLevels` : dimension + liste, sans doublon ni vide, 4 au plus ✅ ; `sunburstTree` : valeur d'une part = part propre + enfants, vide honnête d'un parent plus grand que ses enfants, ligne sans 1er anneau ignorée, part négative/absente non dessinée (comptée) ✅
- [x] La somme de l'export (`paths`) = la somme des lignes retenues, négatives comprises, sans rien plafonner ✅ ; comptage (négatives comprises), moyenne/min/max d'une ancienne configuration lus comme une somme, `BigInt` et chaînes numériques, cellules vides/texte pour 0 ✅
- [x] Plafond de 15 parts par part parente (les plus grandes restent, le parent GARDE sa taille) ✅ ; tri (valeur croissante/décroissante, nom), ordre d'apparition par défaut ✅ ; valeurs de niveau comparées en `String()` ✅
- [x] `sunburstFilterToggles` : pose chaque anneau, 2e clic = tout retiré, voisin de la même branche = seul l'anneau qui change bouge (jamais le filtre commun levé), remonter retire les anneaux plus profonds, filtre d'une AUTRE tuile jamais touché, filtre de plage non confondu ✅ ; enchaînement de 9 clics sur le vrai store ✅
- [x] `sunburstNodeSelected` : un filtre sur un anneau plus profond ne concerne pas les parents ✅ ; export Excel (une ligne par part où des lignes s'arrêtent, anneaux vides complétés, filtres d'une autre tuile appliqués, aucune ligne = en-têtes seuls) ✅
- [x] Valeurs par défaut : vraie hiérarchie jugée sur les valeurs (jamais le nom), sinon deux premières catégories, Somme/Comptage ✅ ; conseils (moyenne/min/max, négatives, > 4 anneaux, couleurs, petites parts écartées, cas sain = rien, colonnes absentes sans exception) ✅ ; i18n fr/en et pluriels ✅
- [x] Formulaire : libellés « Anneau central » / « Anneaux suivants », drill-down et case croisée masqués, tri/palette/format visibles, **moyenne refusée sous le champ Agrégat**, **colonne en double refusée**, tuile enregistrée avec ses anneaux, titre `Mesure : A › B › C` 🌐 ; édition relit la liste ✅ 🌐
- [x] Option ECharts = calcul pur : mêmes chemins et valeurs à tous les anneaux, `nodeClick: false`, `emphasis.focus: 'none'` 🌐 ; pas de fil d'Ariane de drill-down 🌐
- [x] **Clics réels de souris** (angle et rayon moyens de `getItemLayout`) : anneau central → filtre `Region` ; anneau 2 → `Region` + `Produit` ; voisin de la même branche → `Produit` remplacé, `Region` gardé ; remonter → anneau profond retiré ; 2e clic → tout retiré ; anneau 3 → trois filtres ; estompage exact de chaque part 🌐
- [x] Infobulle (chemin, valeur, part du total) ; agrandir = rayon x3 et retour ; changer de type (treemap) puis revenir : l'élément est recréé et le soleil se redessine 🌐 ; tri et comptage 🌐
- [x] 20 produits sous une région : 15 + note « 5 petites parts non dessinées » + conseil ; noms hostiles (`<img onerror>`, `"><b id=pwn>`) : infobulle en texte, aucune balise injectée, rien exécuté 🌐 ; quatre styles globaux sans erreur, captures relues 🌐 ; 6 020 lignes (DuckDB), page directe ET cadre isolé 🌐
- [ ] Plafond de « + Niveau » à 3 anneaux supplémentaires et message `sunburstTooManyRings` ⬜ (câblage lu dans les sources par le test Node, jamais joué dans le navigateur)
- [ ] Rendu dans un vrai Grist / un vrai GFS ⬜ **[NON TESTABLE ICI]**
- **Piège de test** : `getData().getRawDataItem(i)` rend aussi la racine virtuelle, sans `path` : chercher une part par son chemin en tolérant l'absence. Un test d'estompage lit `itemStyle.opacity` de l'option (1 ou 0,3), pas un pixel.

### CSS — classe de bug à systématiquement re-vérifier

- [x] `.field[hidden]` masque réellement l'élément (pas seulement `display:flex` de `.field` qui gagne à spécificité égale) [BUG RÉEL, trouvé 2 fois sur des champs différents] ✅ (règle en place)
- [ ] `.demo-banner[hidden]` — obsolète depuis le retrait du bandeau démo, à retirer de cette checklist si le sélecteur est un jour supprimé du CSS
- [ ] **Règle générale à vérifier pour tout NOUVEAU sélecteur avec `hidden`** : si le sélecteur porte `display: <autre chose que none>` sans variante `[hidden]`, il faut la règle `[hidden]{display:none}` explicite — ajouter un test Playwright `isHidden()` pour tout nouveau champ conditionnel
- [x] `.tile` a une hauteur FIXE (`height`, pas `min-height`) tant qu'un descendant a `flex:1` géré par `resizeAll()`/ECharts [BUG RÉEL : boucle resize↔layout, tuiles qui grandissaient à l'infini] ✅ (règle en place, testée sur 8 cycles de resize consécutifs)
- [ ] **Règle générale pour tout NOUVEAU conteneur de graphique ECharts** : si son parent utilise `flex:1`/`fr` (grid) sans hauteur explicite sur un ancêtre, mesurer sa hauteur sur plusieurs cycles de resize avant de considérer la mise en page correcte — pas seulement au premier rendu

## Bugs réels déjà trouvés (liste de non-régression — ne jamais retirer une entrée)

1. **Instances ECharts détachées** — `innerHTML=''` puis reconstruction totale à chaque rendu détachait les instances ECharts en cache d'un `<canvas>` retiré du DOM (rendu invisible, aucune erreur JS). Corrigé par réconciliation DOM incrémentale.
2. **`.demo-banner[hidden]`** — `display:flex` d'une règle auteur l'emportait sur `[hidden]{display:none}` de la feuille navigateur, à spécificité égale, car chargée après. Corrigé par une règle plus spécifique.
3. **Filtre croisé orphelin après changement de table** — un filtre actif référençant une colonne/valeur du dataset précédent restait affiché après bascule démo ↔ table liée (obsolète depuis le passage à une table de travail unique, mais le principe — nettoyer l'état lié à un contexte qui change — reste valable pour toute future feature de changement de contexte).
4. **`sameValue` / coercion de type** — `groupByAggregate`/`applyFilters` comparaient avec `===` ; `params.name` d'ECharts est toujours une chaîne, donc un clic sur une dimension numérique (`Annee`) filtrait silencieusement toutes les lignes. Corrigé par une comparaison `String(a) === String(b)`.
5. **`KeyError 'Annee'`** [remonté par l'utilisateur en réel] — la table de démo n'était créée QUE si son nom n'existait pas encore ; un ancien schéma sans la colonne `Annee` faisait échouer `AddRecord`. Corrigé par un versionnage du nom de table (`*_SCHEMA_VERSION`).
6. **`.field[hidden]`** — même famille de bug que #2, retrouvé sur un NOUVEAU champ (`tile-drill-crossfilter-field`) alors que le bug #2 avait déjà été "corrigé" ailleurs — preuve que ce type de bug CSS doit être vérifié à chaque nouveau champ conditionnel, pas juste corrigé une fois.
7. **Filtres croisés/état de drill orphelins** — `removeTile`/`updateTile` ne nettoyaient pas les filtres croisés (`toggleFilter` ou `drillCrossFilter`) posés par la tuile supprimée/éditée. Corrigé en même temps que l'ajout de `drillCrossFilter`, avant qu'un utilisateur ne le rencontre en réel.
8. **Libellés d'axe Y tronqués sur de grandes valeurs** [BUG RÉEL trouvé en capturant un screenshot pendant la passe de design] — sur le jeu de test de charge (valeurs ~2,7M), ECharts réservait une marge gauche estimée AVANT de connaître la largeur réelle du texte produit par un `axisLabel.formatter` personnalisé (format compact) ; l'estimation était trop courte, une partie du texte se dessinait hors du canvas et disparaissait silencieusement (aucune erreur JS, juste des libellés du type "000" au lieu de "2,7 M"). Corrigé par `grid: { containLabel: true }`, qui force ECharts à recalculer la marge à partir du texte réellement rendu plutôt que d'une estimation.
9. **Graduations de jauge chevauchées** [BUG RÉEL trouvé en capturant un screenshot en ajoutant le type "gauge"] — le `splitNumber` par défaut d'ECharts (10, donc 11 libellés) produisait des graduations illisibles, superposées, à la taille d'une tuile normale. Corrigé par `splitNumber: 4` (5 libellés espacés). Même famille que le bug #8 : un réglage ECharts par défaut, pensé pour un espace plus grand qu'une tuile de dashboard, doit être revu explicitement pour CHAQUE nouveau type de série ECharts introduit, pas seulement testé "ça s'affiche sans erreur".
10. **Tuiles qui s'étirent à l'infini vers le bas** [BUG RÉEL remonté par l'utilisateur en réel] — `.tile` n'avait qu'un `min-height` (pas de hauteur fixe) alors que `.tile-chart` en dessous a `flex:1` : le `ResizeObserver` sur `document.body` (voir `main.js`) redéclenchait `resizeAll()` en boucle, chaque cycle mesurant un conteneur dont la taille dépendait CIRCULAIREMENT du graphique ECharts qu'il contient (`flex:1` sans base de calcul stable) — croissance monotone d'environ 20-25px par cycle, sans jamais se stabiliser, et sans la moindre erreur JS. Repéré en mesurant la hauteur réelle des tuiles sur plusieurs cycles de resize consécutifs (jamais visible via une simple absence d'erreur, ni même sur un seul screenshot statique — il fallait comparer plusieurs instants). Corrigé par une hauteur FIXE sur `.tile` (`height: 224px` plutôt que `min-height: 224px`), qui casse la dépendance circulaire. Même famille de leçon que les bugs #8/#9 : un réglage de layout qui semble correct sur un rendu statique unique peut cacher une boucle de rétroaction qui ne se révèle qu'en observant plusieurs instants dans le temps.
11. **Combobox : taper puis Entrée sans `ArrowDown` préalable ne commitait rien** [BUG RÉEL trouvé en migrant le formulaire réel vers Combobox, absent des tests du composant isolé] — après une frappe, aucune option n'était présélectionnée (`activeIndex` restait à `-1`), donc la condition de commit sur `Enter` (`activeIndex >= 0`) échouait silencieusement alors que c'est l'usage le PLUS courant (taper un nom de colonne, valider). Les tests du composant en isolation testaient la frappe ET la navigation clavier séparément, jamais les deux combinées dans cet ordre précis. Corrigé en distinguant une ouverture PASSIVE (focus/clic, rien présélectionné) d'une ouverture ACTIVE (frappe réelle, 1er résultat présélectionné). Seul un test d'INTÉGRATION dans le vrai formulaire l'a révélé — leçon reconduite du bug #6 (closure figée) : tester un composant isolément, aussi rigoureusement soit-il, ne remplace pas un test dans son contexte réel d'usage.
12. **Revenir sur une table déjà visitée perdait sa configuration (tuiles envolées)** [BUG RÉEL trouvé en testant le sélecteur de table] — `scheduleSave` (`main.js`) utilise un seul timer partagé (`saveTimer`, débounce 600ms) et relisait `currentTableId` — une variable de fermeture — au moment où le timer se déclenche, pas au moment où il est programmé. Or `switchTable` déclenche elle-même un rendu (chargement de la config de la table suivante), donc un nouvel appel à `scheduleSave` qui annule (`clearTimeout`) la sauvegarde encore en attente de l'ANCIENNE table avant qu'elle ait jamais été écrite dans Grist. Invisible tant qu'une seule table existait par session — le bug ne pouvait se manifester qu'en changeant RÉELLEMENT de table, ce que ce widget ne faisait pas avant le sélecteur de table. Corrigé par `flushPendingSave()` : la sauvegarde en attente capture désormais son `tableId` dans un objet dédié (pas juste la closure), et `switchTable` l'écrit IMMÉDIATEMENT en tout premier, avant de toucher `currentTableId`, plutôt que de risquer qu'elle soit annulée par le débounce. Même famille de leçon que le bug #10 : une race condition qui ne se révèle qu'en exerçant un scénario multi-étapes dans le temps, jamais visible sur un seul appel isolé.
13. **`combobox.js:setOptions()` écrasait une saisie libre hors-liste même en mode `strict: false`** [BUG RÉEL trouvé en développant l'autocomplétion des valeurs de filtre] — `setOptions()` revenait systématiquement au blank/à la 1re option quand la valeur courante n'était pas dans la nouvelle liste d'options, SANS jamais vérifier le mode `strict`. Invisible jusque-là car aucun champ `strict: false` n'existait encore en production ; rafraîchir les suggestions d'un champ de recherche texte libre (ex. changer de colonne de filtre) aurait donc effacé une recherche déjà tapée par l'utilisateur, à l'encontre même de la définition de "texte libre". Corrigé : la correction automatique ne s'applique qu'en mode strict.
14. **Un `addEventListener('change', fn)` passe l'`Event` en argument, qui satisfaisait silencieusement un nouveau paramètre optionnel** [BUG RÉEL trouvé en développant l'autocomplétion des valeurs de filtre] — `updateAdvancedFilterFieldsForColumn(rows)` a été rendue capable de recevoir `rows` explicitement (pour corriger le bug #15 ci-dessous), mais restait câblée directement comme callback de deux `addEventListener('change', ...)`. Le navigateur passe l'`Event` en 1er argument à tout callback d'évènement, qui a satisfait silencieusement le paramètre `rows` (`rows = rows || store.getState().rows` ne retombe jamais sur le repli face à un objet "truthy") — `distinctColumnValues(event, column)` plantait alors avec "rows is not iterable". Corrigé en enveloppant les deux `addEventListener` dans une flèche sans argument. Leçon générale : donner un paramètre optionnel à une fonction déjà utilisée telle quelle comme callback d'évènement DOM est un piège classique, à vérifier systématiquement.
15. **Staleness d'un cycle des lignes lors d'un changement de table (type de colonne + suggestions de valeurs calculés sur l'ANCIENNE table)** [BUG RÉEL trouvé en développant l'autocomplétion des valeurs de filtre] — `inferColumnKind`/`updateAdvancedFilterFieldsForColumn` lisaient `store.getState().rows`, mais `switchTable` appelle `refreshColumnSelects(rows)` AVANT `store.setRows(rows)` : pendant un cycle, le type de colonne inféré et les valeurs suggérées portaient sur les lignes de l'ancienne table, pas la nouvelle. Corrigé en faisant transiter `rows` explicitement depuis `refreshColumnSelects(rows)` (qui les reçoit déjà fraîches en paramètre) plutôt que de les relire dans le store à un moment où elles ne le sont pas encore.
16. **[Le plus significatif de cette feature, pas spécifique à elle] Entrée sur une saisie combobox STRICTE sans AUCUNE correspondance laissait fuiter l'évènement `change` NATIF du navigateur avec le texte brut non validé** — la branche "rien à faire" du `keydown` Entrée (mode strict, aucune option ne matche) ne faisait qu'un simple retour sans jamais appeler `e.preventDefault()`, contrairement à la branche `commit()`. Le navigateur, constatant que la valeur a changé depuis le focus et qu'Entrée a été pressée, déclenche alors LUI-MÊME un évènement `change` natif portant la valeur brute/invalide — qui remonte et atteint tout listener `change` externe exactement comme une vraie sélection validée, contournant complètement `commit()`/toute la validation stricte. Trouvé en tapant le nom d'une table inexistante dans le sélecteur de table puis Entrée : ça déclenchait quand même une tentative de connexion à cette table (`switchTable` appelé avec 0 ligne). Corrigé en ajoutant `e.preventDefault()` dans ce cas aussi. **Conséquence directe, révélée par ce fix** : `table-picker-test.js` (déjà committé pour la Task #9) s'est mis à échouer — sa capacité à switcher vers une table fraîchement créée ne fonctionnait EN RÉALITÉ que grâce à cette fuite d'évènement, `refreshTablePicker()` ne se relançant qu'au démarrage/après un changement réussi, jamais à l'ouverture du menu. Une table créée après le démarrage du widget était donc VRAIMENT inatteignable via le sélecteur sans recharger la page — un vrai défaut produit, pas un détail de test. Corrigé proprement par un hook `beforeOpen` sur `Combobox.attach()` (attendu avant l'ouverture passive), câblé sur `#table-select` avec `refreshTablePicker`. Leçon : corriger un bug de validation peut légitimement révéler qu'une autre feature, déjà "verte", ne fonctionnait que PARCE QUE ce bug existait — la reconfirmer entièrement après le fix n'est pas optionnel.
17. **Les éléments graphiques débordaient sous les cartes** [BUG RÉEL remonté par l'utilisateur en réel] — `.tile-chart { flex: 1; min-height: 180px; }` : ce `min-height` datait d'avant le passage de `.tile` à une hauteur FIXE (224px, voir bug #10) et n'avait jamais été retiré. Une fois `.tile` fixée, l'espace RÉELLEMENT disponible pour `.tile-chart` (224px moins padding/en-tête/fil d'Ariane) pouvait descendre sous 180px — le `min-height` forçait alors `.tile-chart` (et le canvas ECharts dedans) à dépasser le bas de la carte, jusqu'à ~22px de débordement mesuré sur une tuile drillée (fil d'Ariane à 2 niveaux, moins d'espace vertical restant). Invisible sur les captures d'écran précédentes du design system (débordement discret, ~6px sur les tuiles non drillées) mais bien réel. Repéré en mesurant `canvas.getBoundingClientRect().bottom` contre `tile.getBoundingClientRect().bottom` plutôt qu'en jugeant "ça a l'air correct" visuellement. Corrigé en retirant simplement le `min-height` : `flex: 1` seul suffit à occuper tout l'espace restant dans un conteneur flex à hauteur FIXE, sans jamais déborder (flex-shrink par défaut). Même famille de leçon que le bug #10 : un réglage de layout qui datait d'avant un changement structurel (ici le passage à une hauteur fixe) doit être ré-audité à ce moment-là, pas seulement testé isolément.
18. **[Le plus grave trouvé à ce jour, risque de perte/duplication de données réelles] Une table pouvait être recréée/remplie une 2e fois à chaque réouverture du widget, alors qu'elle existait déjà dans le document réel** [BUG RÉEL remonté par l'utilisateur : "le widget regénère encore une table"] — `grist.ready()` ne renvoie PAS de promesse ; la vraie négociation d'accès avec l'hôte Grist se termine de façon ASYNCHRONE, après que `ready()` a déjà rendu la main à l'appelant (confirmé contre le code source de `grist-plugin-api.ts`). `bootstrap()` (`main.js`) enchaînait pourtant IMMÉDIATEMENT sur `grist.docApi.listTables()` sans le moindre délai — un appel parti avant la fin de cette négociation pouvait renvoyer une liste incomplète/vide, faisant croire à tort qu'une table n'existait pas encore. Un faux négatif ici déclenchait `AddTable` + le remplissage complet (`fillTable`) sur une table DÉJÀ existante. Jamais reproduit dans ce sandbox avant ce fix (le mock `grist-stub.js` est synchrone, sans vraie négociation réseau à rater — la seule raison pour laquelle ce bug n'avait jamais été détecté par les tests précédents malgré une couverture Playwright déjà large). Corrigé par `tableExistsConfirmed()` (`js/grist-api.js`) : avant de conclure qu'une table n'existe VRAIMENT pas, on revérifie une seconde fois après un court délai (500ms) avec une lecture fraîche — mais seulement pour le TOUT PREMIER contrôle d'existence de la session (`_raceGuardArmed`), pas à chaque appel, sinon chaque réouverture du widget payait inutilement ~1000ms de plus (2 contrôles : `BI_StressTest` puis `BI_Dashboard_Config`) même hors de toute course réelle — un 1er coût de mise au point : une version antérieure de ce correctif appliquait la revérification à CHAQUE contrôle et cassait plusieurs tests à cause du délai cumulé (voir la note "fragilité de test" plus bas si ça se reproduit). Simulé de façon déterministe via `window.__gristStubRaceCalls`/`window.__gristStubPreseed` (`dev-tests/grist-stub.js`, ajoutés spécifiquement pour ce bug) plutôt qu'un vrai timing réseau à rater dans les tests (source de flakiness). **Leçon indépendante trouvée en même temps** : `grist.docApi.listTables()` renvoie en réalité un tableau de CHAÎNES (`string[]`, vérifié contre le code source réel), pas des objets `{id}` — le mock renvoyait des objets depuis le début du projet, donc AUCUN test précédent n'a jamais exercé la branche `typeof t === 'string'` du code défensif qui gère les deux formes ; corrigé dans le mock pour refléter la vraie forme.
19. **`manualSort` (colonne technique Grist) fuitait dans les sélecteurs Dimension/Mesure/Filtre du
    formulaire d'ajout de tuile** [BUG RÉEL remonté en conditions réelles Grist, absent de ce
    sandbox jusqu'ici] — Grist ajoute lui-même une colonne `manualSort` (position flottante pour le
    glisser-déposer manuel des lignes) à TOUTE table, sans qu'elle soit jamais demandée via
    `AddColumn` côté widget ; `grist.docApi.fetchTable()` la renvoie mêlée aux vraies colonnes du
    document. `GristBI.data.tableToRows()` (utilisée pour charger la table de travail) n'excluait
    que `id`, pas cette colonne technique, qui se retrouvait donc listée — et même pré-sélectionnée
    par défaut (1re colonne) — dans les sélecteurs Dimension/Mesure/Filtre avancé du formulaire.
    Invisible dans ce sandbox car `dev-tests/grist-stub.js` ne simulait pas cette colonne. Corrigé
    par un filtre explicite (`GRIST_TECHNICAL_COLUMNS`) dans `tableToRows()`, et le mock étendu pour
    simuler `manualSort` sur `AddTable`/`AddRecord` afin que le correctif soit réellement exercé par
    les tests (`node dev-tests/test-data.js`). Même famille de leçon que le bug #15 (forme réelle de
    l'API mal reflétée par le mock) : une colonne/un format que Grist ajoute lui-même, jamais demandé
    explicitement par ce widget, ne peut être découvert qu'en conditions réelles tant que le mock ne
    le simule pas.
20. **`.advanced-filter-chip-remove` (bouton de suppression d'un badge de filtre avancé) n'avait
    AUCUNE règle CSS propre** [BUG RÉEL, trouvé en passant en revue le formulaire de filtres pour la
    passe de sobriété/intuitivité] — contrairement à `.filter-chip-remove` (filtres croisés), ce
    bouton s'affichait avec le style par défaut du navigateur à l'intérieur d'un `.filter-chip`
    sinon entièrement stylé. Invisible tant qu'aucun filtre avancé n'avait jamais été posé lors d'une
    revue visuelle. Corrigé en partageant les styles de `.filter-chip-remove`.
21. **Les boutons d'action d'une tuile déjà affichée ne se seraient jamais retraduits à un
    changement de langue** [BUG RÉEL, trouvé en développant le bilingue fr/en (`js/i18n.js`)] —
    `js/main.js:buildTileElement` construit les boutons déplacer/modifier/supprimer d'une tuile
    UNE SEULE FOIS via `innerHTML`, avec leur `title`/`aria-label` figés au moment de la création ;
    `render()` réutilise ensuite cet élément mis en cache tant que la tuile existe (voir le bug #1,
    même mécanisme de cache), sans jamais rappeler `buildTileElement`. Un changement de langue
    (`GristBI.i18n.setLang`) n'exécute PAS ce chemin de construction — seule une nouvelle tuile
    l'aurait fait passer par la bonne langue, laissant les tuiles déjà affichées bloquées dans la
    langue du chargement de la page. Corrigé en donnant à ces boutons À LA FOIS le texte déjà
    traduit à la création ET les attributs `data-i18n-aria`/`data-i18n-title` correspondants, puis
    en appelant `GristBI.i18n.applyTranslations()` (qui retrouve tout élément portant ces attributs,
    sans reconstruction) à CHAQUE `render()`, pas seulement à la création. Vérifié en Playwright :
    créer une tuile, changer de langue, relire le `title` du bouton "déplacer" sans avoir retiré ni
    recréé la tuile entre-temps.
22. **Le texte de substitution "(aucun)"/"(none)" d'un combobox optionnel restait figé dans
    l'ancienne langue après un changement de langue** [BUG RÉEL, trouvé en développant le bilingue
    fr/en (`js/i18n.js`)] — `Combobox.setOptions(options, {blankLabel})` (`js/combobox.js`) écrit
    `blankLabel` dans `inputEl.placeholder` uniquement AU MOMENT de l'appel ; les champs Drill-down
    et Tendance vs ne rappellent `setOptions` qu'à des moments qui n'ont rien à voir avec la langue
    (changement de table, ajout d'un niveau de drill). `GristBI.i18n.setLang` seul ne les aurait
    donc jamais retouchés, contrairement au reste du formulaire (labels/options via `data-i18n`).
    Corrigé en rappelant `refreshColumnSelects(store.getState().rows)` dans l'abonné
    `GristBI.i18n.onChange` de `js/main.js` — `setOptions` en mode strict préserve la valeur déjà
    choisie si elle reste valide (voir `js/combobox.js`), donc sans effet de bord sur une tuile en
    cours d'édition. Vérifié en Playwright : choisir une dimension de drill-down, changer de langue,
    vérifier à la fois que le placeholder a changé ET que la valeur choisie est intacte.
23. **Masque de chargement ECharts potentiellement bloqué indéfiniment** [BUG RÉEL trouvé en
    relecture de code, AVANT tout commit, pendant l'extension de DuckDB-WASM à toutes les
    agrégations (Roadmap Tier 2)] — `renderGauge`/`renderChart` (`js/charts.js`) ne levaient
    `hideLoading()` que `if (usingDuckDb)`, où `usingDuckDb` est réévalué à CHAQUE appel à partir du
    nombre de lignes de CET appel précis, pas de l'appel qui a réellement affiché le masque. Scénario
    concret : un 1er rendu d'une tuile AU-DESSUS du seuil (`DUCKDB_ROW_THRESHOLD`) affiche le masque
    puis attend un calcul SQL réel ; AVANT qu'il ne se termine, un filtre fait retomber cette MÊME
    tuile SOUS le seuil — le 2e rendu (le gagnant, via le contrôle `isStale`) a alors son PROPRE
    `usingDuckDb` à `false` et ne lève donc pas le masque, tandis que le 1er rendu, devenu périmé,
    retourne via son contrôle `isStale` AVANT même d'atteindre sa propre ligne `hideLoading()`. Aucun
    des deux appels ne lève donc jamais le masque, qui reste affiché indéfiniment au-dessus d'un
    graphique pourtant à jour. Corrigé en rendant `hideLoading()` INCONDITIONNEL (après le contrôle
    `isStale`/`isDisposed()`) dans les deux fonctions — ECharts documente `hideLoading()` comme sans
    effet si aucun masque n'est affiché, et `renderMeasureChart` (seul chemin de rendu async
    préexistant à cette feature) le faisait déjà ainsi sans condition, ce qui a servi de référence
    pour corriger les deux nouveaux chemins. **PAS reproduit par un test Playwright chronométré**
    malgré plusieurs tentatives (deux rendus synchrones consécutifs pour la même tuile avec des
    volumes de part et d'autre du seuil, y compris avec un délai artificiel injecté directement dans
    `GristBI.duckdbEngine.groupByAggregate`) — la preuve retenue est la relecture du code (chemin
    d'exécution tracé ligne à ligne, recherche confirmant qu'aucune autre ligne de `js/` n'appelle
    `hideLoading()` sur cette instance), pas une capture d'un masque réellement bloqué. Leçon : un
    garde conditionné sur une variable recalculée à CHAQUE appel («  `usingDuckDb` de CE rendu ») ne
    protège que CE rendu, jamais l'état laissé par un rendu précédent devenu périmé entre-temps — pour
    une ressource à deux états (afficher/masquer), le nettoyage doit être inconditionnel, pas
    symétrique à la condition qui a déclenché l'affichage.

24. **`.tile-comments`/`.tile-detail` affichés avec le style par défaut du navigateur (bordure
    carrée, fond blanc) au lieu des icônes sobres du reste de la rangée d'actions** [BUG RÉEL, trouvé
    lors de l'audit UX/UI du 21/10/2026, en capturant un screenshot d'une tuile] — le sélecteur CSS de
    base (`.tile-move-left, .tile-move-right, .tile-edit, .tile-remove { background:none; border:none;
    padding:4px 5px; border-radius:var(--radius-sm); ... }`) n'avait jamais été étendu aux boutons
    "Commentaires" (PR #15, 2026-09-30) ni "Détail" (PR #22, 2026-10-21) au moment de leur ajout — tous
    deux ne portaient QUE des règles `:hover`/accessoires (`.tile-comments { position: relative; }`
    pour le badge de compte), jamais le reset de base. Invisible sans capture d'écran : ces deux
    boutons restaient entièrement cliquables/fonctionnels, seul leur HABILLAGE différait visuellement
    du reste de la rangée (bordure carrée du navigateur au lieu d'un bouton plat arrondi). Corrigé en
    ajoutant `.tile-comments, .tile-detail` au sélecteur de base et à la règle `:hover` partagée.
25. **Formulaire d'ajout de tuile et barres dépendantes (filtre avancé, data blending, vues
    sauvegardées/exports, +Page) pleinement interactifs mais totalement inopérants sur un document
    SANS AUCUNE table utilisateur** [BUG RÉEL, trouvé lors de l'audit UX/UI du 21/10/2026, en testant
    un document réellement vide après le retrait de la création automatique de `BI_StressTest`
    (2026-10-21, voir l'entrée "bouton Restaurer les tuiles par défaut" ci-dessus)] — dans cet état,
    `currentTableId` reste `null` et le bouton "+ Ajouter la tuile" (bleu, premier plan) ne fait RIEN
    au clic (`addTileForm` submit : `if (!measure...) return;`), sans le moindre retour pour
    l'utilisateur ; seul le message `status.noTables`, discret dans le badge du bandeau du haut,
    expliquait pourquoi. Plus subtil : `store.subscribe(render)` seul ne peint RIEN tant qu'aucune
    mutation d'état n'a eu lieu, or un document sans table ne déclenche jamais `switchTable()` (la
    seule mutation qui ferait tourner `render()` ailleurs) — sans un premier rendu explicite, le DOM
    restait figé sur le HTML statique de départ indéfiniment, pas seulement un court instant. Corrigé
    par `setTableDependentControlsEnabled(enabled)` (désactive formulaire d'ajout de tuile + filtre
    avancé + data blending + vues sauvegardées/exports + "+Page", rappelée à chaque `render()`), un
    message centré reprenant `status.noTables` à la place du conseil habituel "Ajoutez-en une
    ci-dessus" (trompeur ici), et un appel explicite `render(store.getState())` juste après
    `store.subscribe(render)` pour peindre cet état dès le chargement, avant même que `bootstrap()`
    (jamais attendu à cet endroit) n'ait pu résoudre quoi que ce soit. Complété par
    `.btn-primary:disabled`/`.btn-tiny:disabled { opacity: 0.5; ... }` (manquants : seul
    `.btn-secondary:disabled` existait), sans quoi le bouton "+ Ajouter la tuile" désactivé restait
    visuellement aussi vif qu'actif (`opacity:1`, `cursor:pointer`) malgré son inertie réelle.
26. **[Même famille que le bug #18, nouvelle variante] `_rawTables.push(...)` sur `null` pouvait faire
    planter la création de `BI_Dashboard_Config`/`BI_Dashboard_Comments` au tout premier contrôle
    d'existence RÉEL de la session, ET deux appels concurrents à `ensureConfigTableExists()` pouvaient
    chacun lancer leur propre `AddTable` pour la même table** [BUG RÉEL, trouvé lors de l'audit UX/UI
    du 21/10/2026, en testant un document réellement vide de bout en bout avec `node_modules/playwright`
    contre `dev-tests/harness.html`] — deux défauts distincts, découverts l'un après l'autre sur le
    même chemin de code :
    (a) `tableExistsConfirmed()` (`js/grist-api.js`) remet délibérément `_rawTables` à `null` quand son
    budget de nouvelles tentatives s'épuise sans jamais avoir trouvé la table (pour forcer une lecture
    fraîche au contrôle SUIVANT, voir le bug #18) — mais `loadOrCreateTable`/`ensureConfigTableExists`
    faisaient `_rawTables.push(tableId)` SANS GARDE juste après une création réussie, supposant à tort
    que `_rawTables` était toujours un tableau à ce stade. Sur un document VRAIMENT neuf, le tout
    premier contrôle d'existence de la session (`_raceGuardArmed` encore `true`) épuise justement ce
    budget avant de conclure que la table n'existe pas — `BI_Dashboard_Config` (`ensureConfigTableExists`,
    appelée par `loadConfig`/`switchTable`) et `BI_Dashboard_Comments` (`loadOrCreateComments`, appelée
    par `bootstrap()` quand aucune table utilisateur n'existe, le seul cas où `BI_Dashboard_Config`
    n'est PAS déjà chargée avant et n'a donc pas pu "amorcer" `_rawTables`) tombaient toutes les deux
    dans ce cas. Résultat observé : `TypeError: Cannot read properties of null (reading 'push')`,
    rattrapée par le `try/catch` de `loadConfig`/`bootstrap()` (jamais bloquant pour le tableau de bord
    lui-même) mais empêchant `fillTable()`/la mise à jour locale du cache de s'exécuter. Corrigé par
    `if (_rawTables) _rawTables.push(tableId)` aux deux sites d'appel — une prochaine lecture
    (`listAllTablesCached`) refera de toute façon un appel réseau frais qui trouvera la table tout
    juste créée ; reconstruire un tableau tronqué ici aurait remplacé ce futur appel réseau par un
    cache incomplet, pire que ne rien faire.
    (b) Repéré en creusant POURQUOI ce crash n'apparaissait que de façon non déterministe d'un run à
    l'autre : `main.js:switchTable` appelle `store.clearFilter()`/`store.clearAdvancedFilter()` AVANT
    `loadConfig(tableId)`, alors que `currentTableId` est déjà posé — ces deux mutations déclenchent
    déjà un `render()` (abonné via `store.subscribe`) qui peut programmer une sauvegarde
    (`scheduleSave`, le filtre est vide donc en général un no-op, SAUF si une référence d'état a déjà
    changé entre temps). Son debounce (600ms) peut retomber PENDANT que le tout premier
    `tableExistsConfirmed('BI_Dashboard_Config')` de `loadConfig` est encore en train de réessayer
    (budget ~9,3s) : `saveConfig` appelle alors elle aussi `ensureConfigTableExists()`, un DEUXIÈME
    appel CONCURRENT pour la MÊME table pendant que le premier est encore en cours, chacun pouvant
    lancer son propre `AddTable('BI_Dashboard_Config', ...)` en parallèle — un risque de table orpheline
    dupliquée (le filet anti-collision de `AddTable` détecte bien la 2e tentative après coup, mais le
    principe même de deux créations concurrentes pour une table censée être unique par session est le
    vrai défaut). Corrigé en reprenant EXACTEMENT le mécanisme déjà utilisé par `getCurrentUserEmail()`
    (promesse mémorisée pour toute la session, `_currentUserEmailPromise`) : `ensureConfigTableExists()`
    mémorise désormais `_configTableExistsPromise` et la renvoie telle quelle à tout appel
    concurrent/suivant plutôt que de relancer son propre `AddTable`. Vérifié en Playwright contre
    `dev-tests/harness.html` (préremplissage d'une seule table utilisateur, document sans
    `BI_Dashboard_Config` préexistant) : avant le correctif, le crash et le double `AddTable` étaient
    reproductibles selon le timing exact (non déterministe d'un run à l'autre) ; après le correctif,
    le tableau de bord se stabilise de façon fiable, sans erreur console, après le budget de nouvelles
    tentatives (~9,3s, comportement attendu et déjà documenté par le bug #18 — pas quelque chose à
    "accélérer", seulement à sécuriser). Script Playwright ad hoc, non committé (voir §5 de CLAUDE.md).
27. **`dev-tests/harness.html` duplique entièrement le DOM du formulaire d'ajout de tuile plutôt que de
    charger `index.html`** [BUG RÉEL, trouvé en testant le radar "compétences en colonnes" du
    2026-11-02 dans le harnais] — CLAUDE.md §4 décrit le harnais comme chargeant "exactement les
    mêmes fichiers applicatifs" qu'`index.html` ("même DOM, même CSS, même chaîne de scripts JS"),
    une formulation qui laisse penser à un DOM PARTAGÉ alors qu'il s'agit en réalité d'une copie
    manuelle maintenue en parallèle. 3 champs ajoutés à `index.html` seul pour cette feature
    (`#tile-radar-mode-field`, `#tile-radar-axes-field`, les id `#tile-measure-field`/
    `#tile-agg-field` posés sur des `<div class="field">` jusque-là anonymes) étaient absents du
    harnais — `js/main.js` faisait alors `document.getElementById('tile-radar-axes-add')
    .addEventListener(...)` sur `null`, un `TypeError` qui interrompait l'exécution de TOUT le reste
    du script d'initialisation (aucun champ du formulaire ne répondait plus du tout, pas seulement
    les nouveaux). Corrigé en répliquant les 3 mêmes modifications dans `dev-tests/harness.html`.
    Leçon directement actionnable, déjà présente en mémoire de projet mais reconfirmée ici : toute
    modification de `index.html` qui touche à un id référencé par `js/main.js` doit être répliquée
    dans `dev-tests/harness.html` dans le MÊME changement, et vérifiée en ouvrant RÉELLEMENT le
    harnais (pas seulement `index.html`) — un test Node (`test-data.js`) ne peut pas détecter ce
    genre de désynchronisation puisqu'il ne charge aucun DOM.

28. **`prompt`/`confirm`/`alert` muets dans le cadre isolé de GFS : « + Page » et « Sauvegarder la vue » ne faisaient rien, les messages de validation/d'erreur étaient invisibles** [BUG RÉEL, trouvé lors de l'audit UI/UX du 18/11/2026 en chargeant `index.html` dans un `<iframe sandbox="allow-scripts">`] — sans `allow-modals`, `prompt()` rend `null` (le `|| ''` suivant donnait un nom vide, ignoré), `confirm()` rend `false` et `alert()` n'affiche rien, sans exception (au mieux un avertissement dans la console). Un test dans une page directe (harnais, Playwright par défaut) les voit pourtant fonctionner. Corrigé par `js/dialogs.js` (fenêtres du kit) ; test : parcours complet dans un cadre `sandbox="allow-scripts"`. Leçon : tout test d'une interaction qui passe par une API du navigateur soumise à permission doit aussi tourner dans un cadre sandboxé comme celui de l'hôte.
29. **Une tuile modifiée gardait l'ancien titre dans son en-tête, et un 2e clic sur « Modifier » rechargeait les anciennes valeurs** [BUG RÉEL, trouvé en testant les titres traduits ; reproduit contre `main` avant correction] — `buildTileElement(tile)` capturait l'objet `tile` de sa création dans les écouteurs, et l'élément est mis en cache (voir piège n°6 de CLAUDE.md) donc jamais reconstruit : après `store.updateTile`, l'en-tête n'était jamais réécrit et `startEditTile(tile)` rechargeait la version d'origine dans le formulaire. Même famille que le bug #12 (état figé dans une closure). Corrigé : les écouteurs relisent la tuile vive (`store.getState().tiles`) et `render()` réécrit le titre à chaque passage. Test : modifier une mesure, relire l'en-tête, rouvrir « Modifier » et relire le champ.
30. **« Aucune table dans ce document » affiché pendant tout le chargement, puis conseil de l'état vide perdu à vie** [BUG RÉEL, trouvé lors de l'audit UI/UX du 18/11/2026] — `render()` écrivait `status.noTables` dès que `currentTableId` était `null`, c'est-à-dire AVANT que `bootstrap()` ait fini de lire les tables ; et il le faisait par `emptyState.textContent = …`, qui supprimait le `<span data-i18n-html>` du conseil (même famille que le piège n°6 : reconstruire un DOM plutôt que le masquer). Corrigé par un état de connexion explicite et deux éléments distincts (conseil / statut) dont un seul est visible. Test : connexion ralentie, document sans table, échec puis « Réessayer ».
31. **Pastille « connectée » avec « 0 ligne » pendant que la configuration se crée** [BUG RÉEL, trouvé en écrivant le test de la pastille Données, lot 1 du 18/11/2026] — la table était déclarée connectée dès la lecture de ses lignes ; or sur un document neuf, créer `BI_Dashboard_Config` peut durer ~9 s (garde de course `tableExistsConfirmed`, voir CLAUDE.md §3) et pendant ce temps l'écran affichait la pastille et le conseil d'une table vide. Corrigé par `dashboardReady` : la table n'est « prête » qu'une fois sa configuration chargée. Test : `preseed-blank` (table sans configuration), attendre le compteur de lignes.
32. **Échap devait être pressé deux fois pour fermer le panneau « Données »** [BUG RÉEL, trouvé au 1er essai du menu, lot 1 du 18/11/2026] — l'ouverture donnait le focus au 1er champ, le sélecteur de table, dont le combobox ouvre sa liste au focus : le 1er Échap fermait la liste, le 2e le panneau. Corrigé : le focus va au panneau (ou à l'élément `data-autofocus`, ou au 1er `menuitem` d'un `role="menu"`), jamais d'office dans un combobox ; l'écouteur d'Échap est en phase de CAPTURE pour lire l'état de la liste avant que le combobox ne la ferme. Même famille que le piège n°11 de CLAUDE.md (clavier + combobox).
33. **« Ajouter la tuile », filtres avancés et commentaires ne faisaient RIEN dans le cadre isolé de GFS** [BUG RÉEL, trouvé en testant le panneau du lot 2 dans un `<iframe sandbox="allow-scripts">`, 18/11/2026] — le cadre n'a pas `allow-forms` : le navigateur journalise « Blocked form submission » et n'émet aucun événement `submit`, donc tout code branché sur `submit` est mort (même famille que le n°28 : `prompt`/`confirm` muets sans `allow-modals`). Les tests en page directe passaient. Reproduit sur le code fusionné du lot 1 via un worktree (9 tuiles avant, 9 après). Corrigé par `js/main.js:bindFormSubmit` (bouton `type="button"` + Entrée dans un champ texte) appliqué aux trois formulaires. Test : `t7-panel.js` / `t8-forms-frame.js` du scratchpad (non committés, voir ci-dessus), clic ET Entrée, page directe ET cadre isolé. Règle : tout nouveau formulaire passe par `bindFormSubmit`, tout nouveau test d'interface se rejoue dans un cadre isolé.
34. **Une aire empilée par année restait plate à 0 au-delà de 5 000 lignes** [BUG RÉEL, trouvé en ouvrant le modèle « Évolution » sur 5 760 lignes, consigne GFS 016, 18/11/2026] — `assembleSeries` (`js/data.js`) rangeait les séries dans un `Map` par dimension, puis cherchait chaque catégorie : or les catégories viennent du groupement de TOUTES les lignes (au-dessus de `DUCKDB_ROW_THRESHOLD`, donc par DuckDB-WASM, qui rend une dimension entière en BigInt, `2022n`) et chaque série de celui de SES lignes (sous le seuil, donc en JS pur, `2022`) ; `Map` ne confond jamais `2022n` et `2022`, toutes les séries tombaient à « pas de valeur » (légende juste, aucune erreur en console, aire à plat sur 0). Les tests Node d'origine n'avaient que des clés texte ; seul le rendu d'une table de plus de 5 000 lignes mélange les deux moteurs. Corrigé (PR #65) : clés comparées en texte, `null` gardant sa propre clé ; test Node `assembleSeries` avec catégories BigInt, séries en nombre, cas inverse, chaîne `'2022'` et `null` contre `'null'`. À re-vérifier à chaque nouvel endroit qui compare des dimensions venues des DEUX moteurs (`Map`, `===`, `indexOf`) : `String(a) === String(b)` (`sameValue`).

35. **« E,NameError » affiché comme auteur d'un commentaire** [BUG RÉEL, remonté par Antoine dans un vrai Grist, 18/11/2026] — la colonne de la table-sonde `BI_Dashboard_UserProbe` était une formule ordinaire ; `user` n'existe que dans une formule déclenchée, la cellule valait `NameError` et `fetchTable` la rend `['E','NameError']`, affiché tel quel dans un champ verrouillé (donc impossible à corriger à la main). Le mock ne simule pas le moteur de formules : invisible jusque-là. Corrigé : colonne déclenchée, validation de l'adresse, réparation des anciens documents (`ModifyColumn`). Test : `test-data.js` (faux `grist` dans un `vm`, 6 scénarios, mutation vérifiée : le test échoue sur l'ancien code).
36. **Infobulle du radar posée hors de la carte, jusque hors de l'écran** [BUG RÉEL, remonté par Antoine, 18/11/2026] — sans `confine`, ECharts place la bulle à côté du point survolé ; pour un radar de 224 px de haut elle sortait à x = −66 px et 72 px au-dessus de la tuile, avec des nombres bruts (« 8.504166666666666 »). Corrigé : `confineTooltip` sur toutes les options + formateur de radar. Test : survol de 5 points d'un radar, rectangle de la bulle comparé à celui de la tuile.
37. **Boutons Filtre / Vues / Exporter sans aucun nom accessible sous 900 px** [BUG RÉEL, trouvé en réécrivant le bouton Vues, 18/11/2026] — sous 900 px le libellé (`.bar-label`) passe en `display: none` et l'icône est décorative (`aria-hidden`) : le bouton n'avait ni nom ni infobulle pour un lecteur d'écran. Corrigé : `aria-label` (traduit) sur les trois ; le bouton Vues y met en plus la vue suivie et son état. Test : `t10-views.js` (nom accessible lu à 700 px).
38. **Infobulles en format anglais avec le bruit de flottant, langue de l'interface ignorée** [BUG RÉEL, remonté par Antoine sur un treemap, « 600,688.2299999992 », puis confirmé sur barres/courbe/camembert/cascade par l'audit de lisibilité du 18/11/2026] — `js/charts.js` ne formatait que KPI/radar/entonnoir/empilé/nuage de points (`fr-FR` figé, quelle que soit la langue), les infobulles par défaut d'ECharts affichaient la valeur brute (« 1,542,980.8799999997 », « 0.20472679998130852 »). Corrigé par `js/format.js` : un formateur par tuile, séparateurs de la langue, `valueFormatter` sur toutes les infobulles, Cascade avec une seule ligne signée (« Hausse : 172 597 » au lieu de « Baisse 0 » en plus). Test : `test-data.js` (module de format, absence de `Intl.NumberFormat`/`toFixed` dans `js/charts.js`) + survol de chaque type de tuile dans le vrai `index.html` (clair, sombre, fr/en, 6 000 lignes pour DuckDB/BigInt).
39. **Une valeur minuscule s'affichait « 0 » et des graduations d'axe se répétaient** [BUG RÉEL, audit de lisibilité du 18/11/2026] — la moyenne de 0,0006 d'une carte KPI valait « 0 » (2 décimales maximum, quelle que soit la valeur) ; l'axe d'une barre de 0,0001 à 0,0007 affichait sept fois « 0 », et 0,05 d'écart donnait « 0,1 » « 0,1 » (compact à 1 décimale). Corrigé : Automatique = 2 chiffres significatifs sous 0,1, `axis` à 3 chiffres significatifs. Test : `test-data.js` (graduations 0 -> 0,3 par 0,05 et 0 -> 0,0007 par 0,0001 toutes distinctes ; 0,000618 -> « 0,00062 »).
40. **Jauge illisible : libellés superposés, aiguille sur les libellés, valeur qui déborde** [BUG RÉEL, remonté par Antoine avec une capture, 18/11/2026] — arc de 270° d'environ 60 px de rayon portant 5 libellés et 5 traits, aiguille de 75 % du rayon par-dessus, valeur de 18 px fixes sous l'arc (« 3 266 234,27 » plus large que la jauge, coupée à gauche pour « -725 150,73 »). Reproduit à l'identique sur le jeu d'audit (clair, sombre, anglais). Corrigé : demi-cercle à géométrie calculée (`gaugeLayout`), bornes sous l'arc, valeur ajustée, `__refit` au redimensionnement. Test : `test-data.js` (invariants de géométrie sur 7 tailles de tuile, `niceCeil`, `fitFont`, câblage) + rendu aux tailles normale, étroite (330 px), agrandie, thème sombre, valeur de 20 caractères.
41. **Une tuile dont le type change en édition gardait l'élément (balisage, classe, instance ECharts) de l'ancien type** [BUG RÉEL, trouvé en testant la table plate dans un `<iframe sandbox="allow-scripts">`, 18/11/2026] — Modifier > Changer de type > Table sur une tuile Barres affichait bien la table, mais l'élément restait `tile-bar` et son instance ECharts restait attachée au conteneur dont le contenu venait d'être remplacé : le retour à un graphique se rattachait à un canvas détaché (vide, sans erreur) ; une tuile Texte devenue graphique n'avait plus de `.tile-chart`. Corrigé : `render()` compare `el.dataset.tileType` à `tile.type` et recrée l'élément. Test : bloc « tuile Table » de `dev-tests/test-data.js` (garde lue dans la source) + Playwright (Barres -> Table -> Barres, canvas non vide).
42. **Graphiques illisibles en thème sombre : quadrillage blanc, infobulle blanche, contour blanc autour des étiquettes** [BUG RÉEL, trouvé par l'audit de lisibilité du 18/11/2026] — `js/charts.js` ne fixait que les couleurs de série ; tout le reste venait du thème clair d'ECharts (quadrillage #E0E6F1, traits d'axe, fond d'infobulle, contour de texte blanc des étiquettes de camembert/entonnoir, bandes claires du radar). Corrigé par `finalizeOption` (jetons CSS) et `watchChartTheme` (rendu repris au changement de thème). Test : `test-data.js` (câblage) + captures des 12 types en sombre + changement de thème à chaud.
43. **Libellés d'axe coupés ou masqués, infobulle de la largeur d'une tuile** [BUG RÉEL, trouvé par l'audit de lisibilité du 18/11/2026] — le 1er libellé de « Tablette Graphique Professionnelle 12 pouces » sortait de la tuile à gauche et les 5 autres disparaissaient (intervalle automatique), « 200 k400 k600 k » se collaient sur une barre horizontale, un libellé d'entonnoir était coupé à droite, une infobulle d'un seul bloc de 300 px couvrait tout le graphique. Corrigé : libellés tronqués à la largeur d'une catégorie, graduations bornées, entonnoir en deux lignes, infobulle repliée. Test : captures avant/après à 330 px de large.
44. **Tuile Nuage de mots vide, sans explication, quand d3-cloud manque** [BUG RÉEL, trouvé par l'audit de lisibilité du 18/11/2026] — le message « indisponible » était ajouté sous un `<canvas>` de 150 px de haut dans une tuile de 224 px qui défile : invisible. Corrigé : le canvas est masqué tant que le message s'affiche. Test : tuile sans module `d3-cloud`.
45. **Une ligne de `BI_Dashboard_Config` pouvait exécuter du script dans le widget par l'identifiant d'une tuile** [BUG RÉEL, trouvé par la revue C-XSS-01 de l'audit `gwaudit`, 18/11/2026 ; prouvé dans Chromium avant correction] — `buildTileElement` (`js/main.js`) écrivait `data-tile-id="${tile.id}"` sans échappement et `js/charts.js` pose le même id dans ~14 sélecteurs CSS ; l'id d'une tuile vient de la configuration, qu'une autre personne du document peut avoir écrite (consigne GFS 005). Un id `x"><img src=x onerror=…>` exécutait le script (accès `full` : lecture et écriture de tout le document) et faisait lever « is not a valid selector » à chaque rendu. Le relevé de la consigne 005 ne couvrait que les valeurs de cellule : une chaîne qui vient de la configuration est une entrée tout aussi peu fiable. Corrigé à deux endroits : `store.setPages` (`js/state.js:sanitizePages`) ramène tout id relu à `[A-Za-z0-9_-]`, unique dans le rapport (même référence rendue quand rien ne change, donc aucune sauvegarde au chargement), et le balisage échappe (`escapeHtml(tile.id)`, valeurs du pivot comprises). Tests : Node (`dev-tests/test-data.js`, blocs « ids de tuile relus » et « défense en profondeur ») ; Playwright contre `dev-tests/harness.html` avec une VRAIE ligne `BI_Dashboard_Config` hostile préremplie (`__gristStubPreseed`) : **avant** `window.__xss = 1`, 2 nœuds injectés, 7 erreurs de page ; **après** 0, 0, aucune, les trois tuiles se dessinent. À rejouer pour tout nouvel endroit où une chaîne de la configuration (id, titre, nom de page ou de vue) est posée dans `innerHTML`, un attribut ou un sélecteur.
46. **Piste grise vide sous toute carte KPI sans objectif** [BUG RÉEL, vu en préparant les captures de l'annonce forum, 18/11/2026] — `.tile-kpi-goal { display: flex }` (css/style.css) bat l'attribut `[hidden]` (piège n°10 de CLAUDE.md), alors que `renderKpi` pose `goalEl.hidden = true` quand la carte n'a ni `target` ni `targetColumn` : la barre `.goal-bar` (fond gris) restait dessinée sous la valeur, sans texte. Quatrième cas du piège n°10. Corrigé par `.tile-kpi-goal[hidden] { display: none; }`. Test : `dev-tests/test-data.js` (bloc « Carte KPI sans objectif » : la règle existe, la piste naît cachée, `renderKpi` la cache/montre) + Playwright contre le vrai `index.html` SANS correctif injecté (KPI sans objectif : `display: none`, hauteur 0 ; KPI avec objectif : `display: flex`, 28 px).
47. **L'assistant de démarrage proposait PrixUnitaire (additionné) plutôt que Montant** [BUG RÉEL, vu en préparant les captures de l'annonce forum, 18/11/2026] — `js/advice.js:analyzeColumns` classait les mesures par score de valeurs puis par ordre des colonnes : sur la table de démo (`Quantite`, `PrixUnitaire`, `Montant`, `Objectif`), toutes les cartes d'accueil, le préremplissage « Barres » et le KPI prenaient `PrixUnitaire` en SOMME (la somme des prix de 5 760 lignes n'est rien). Les valeurs seules ne distinguent pas un prix d'un montant : indice tiré du nom (`isUnitPriceName`, mots coupés en camelCase/`_`/espaces/accents ; « Prix total », « Montant » ne sont pas des prix) -> pénalité de classement (3 points : derrière un montant à retours ou cases vides, pas derrière un petit entier ambigu) ET moyenne plutôt que somme (`aggFor`). Un prix reste mesure : seul, il est proposé, moyenné. Test : `dev-tests/test-data.js` (bloc « Assistant de démarrage », 4 ordres de colonnes, montant à négatifs, à cases vides, « Prix total », prix seul) + Playwright sur la démo v3 (avant : `PrixUnitaire` somme x3 ; après : `Montant` somme x3).
48. **Jauge : plus aucune graduation intermédiaire** [retour d'Antoine sur les captures du lot 2, 18/11/2026] — pour éviter le chevauchement DANS l'arc, le lot 2 n'avait gardé que les bornes ; l'échelle devenait illisible (aucun repère entre « 0 » et « 3,27 M »). Corrigé : graduations rondes à l'EXTÉRIEUR de l'arc, place réservée avant de dimensionner l'arc, retirées plutôt que de faire trop rétrécir l'arc ou de sortir de la tuile. Test : `test-data.js` (voir « Jauge, graduations extérieures ») + captures à 4 conditions. Leçon : un correctif qui supprime une information pour régler un chevauchement doit être relu comme une perte, pas seulement comme un succès visuel.
49. **Années compactées sur une jauge et un histogramme (« 2 k, 2,01 k », « 199… »)** [BUG RÉEL, relevé en revoyant les captures de la jauge, 18/11/2026] — `axis` compact dès 1 000 écrivait des bornes de 1990 à 2030 « 1,99 k, 2 k, 2,01 k, 2,02 k, 2,03 k » ; les classes d'un histogramme d'années étaient en plus tronquées à la largeur d'une barre (« 199… »). Corrigé : une échelle d'entiers de moins de 5 chiffres s'écrit en toutes lettres (`plainScale`/`forScale`), libellés de classes de largeur fixée. Test : `test-data.js` + captures (jauge années, jauge entiers, histogramme d'années et de montants). Leçon : une décision de format se prend sur l'échelle entière, jamais valeur par valeur.
50. **Radar avec légende : la légende « Élève / Moyenne du groupe » recouvrait le nom de l'axe du haut** [BUG RÉEL, vu en préparant les captures de l'annonce forum, 18/11/2026] — dans une tuile normale (zone de dessin 283 x 162 px) le radar de comparaison élève/moyenne gardait son centre à 50 % et son rayon à 62 % : le nom de l'axe du haut (« Lecture ») tombait sous la légende, posée en haut sur deux entrées de 25 px de symbole, et le polygone restait minuscule ; la capture du forum passait par la tuile agrandie pour s'en cacher. `GristBI.format.radarLayout(w, h, hasLegend)` (pure) réserve la bande de la légende (24 px), centre le polygone dans la place restante et borne le rayon pour que le nom de l'axe du haut commence sous la légende et celui du bas finisse dans la zone ; `finalizeOption` pose centre/rayon/`axisNameGap` en pixels quand il y a une légende (`instance.__refit` les recalcule au redimensionnement : tuile agrandie puis réduite) ; la légende est compacte (symboles 14 x 8, police 11) et défilante (`type: 'scroll'` : « Élève 042 — Dupont-Martin Jean-Baptiste » se parcourt par flèches au lieu de passer à la ligne sur le polygone). Correction annexe : `finalizeOption` remplaçait `legend.textStyle` entière au lieu de la fusionner (une légende qui règle sa police perdait la couleur du thème). Sans légende (une seule série) : réglage d'origine inchangé. Test : `dev-tests/test-data.js` (bloc « radar avec légende » : 9 tailles de zone, nom de l'axe du haut sous la bande de la légende, nom du bas dans la zone, rayon jamais au-dessus de 62 %, ancienne géométrie qui se chevauchait, câblage) + Playwright sur le radar d'orientation de démo (400 élèves) : tuile normale, agrandie, réduite, tuile de 298 px avec un nom d'élève de 38 signes.
51. **Onglets de page rognés quand le bouton Vues porte le nom de la vue suivie** [BUG RÉEL, vu en préparant les captures de l'annonce forum, 18/11/2026] — suivre une vue (« Focus En ligne ») écrit son nom dans le bouton Vues (186 px au lieu de 52) : les onglets, seul élément de la barre qui rétrécit, perdaient jusqu'à 70 px et « Segments » était coupé à 1100 et 1200 px ; avec 4 pages il restait une lettre. Deuxième défaut : le fondu de bord (`.overflows`) qui signale des onglets cachés restait FAUX, parce que `renderPageTabs` le mesurait AVANT `renderBookmarks` (qui pose le nom de la vue) — onglet coupé net, rien pour dire qu'il y en a d'autres ; même chose au passage en mode Édition (boutons en plus). `GristBI.appbar.fitTabsLevel` (pure) choisit de combien alléger la barre, à partir de la barre complète : palier 1 = sans le nom de la vue dans le bouton (la pastille « Vue » de la rangée des filtres et le nom accessible du bouton le disent aussi), palier 2 = sans les libellés des boutons (comme au-dessous de 900 px), GARDÉ seulement si les onglets tiennent alors (beaucoup de pages : les boutons gardent leur texte, les onglets défilent avec le fondu, désormais juste). `js/main.js:fitPageTabs` l'applique à la fin de `render()`, au changement de mode, au redimensionnement et par un ResizeObserver différé d'une image (jamais dans son propre rappel : « loop completed with undelivered notifications »). Test : `dev-tests/test-data.js` (bloc « Onglets de page rognés » : 5 scénarios de largeur, palier jamais gardé en vain, état final = palier rendu sur 2 x 41 besoins, ordre dans `render()`, câblage ; échoue sans le correctif) + Playwright sur la démo v3 (3 et 4 pages, fr/en, vue suivie) à 900, 1000, 1100, 1200, 1400 px, redimensionnement en direct, bascule Lecture/Édition : onglets entiers partout sauf 4 pages en Édition à 1200 px (231 px pour 431), où le fondu le dit.
52. **Un redimensionnement de la fenêtre faisait défiler la page (`scrollIntoView` de l'onglet actif)** [BUG RÉEL, introduit par la correction n°51 et vu par moi en reprenant les captures de l'annonce forum, 18/11/2026] — `fitPageTabs` rappelait `activeTab.scrollIntoView()` à chaque redimensionnement ; `scrollIntoView` fait aussi défiler le document et la barre est collante : une capture pleine page (qui redimensionne la fenêtre) laissait la page 232 px plus bas, la barre au milieu de l'image. Corrigé par `revealActiveTab` (défilement de la LISTE d'onglets seulement : `scrollLeft`). Test : `dev-tests/test-data.js` (`fitPageTabs` sans `scrollIntoView`, `revealActiveTab`) + Playwright : défilement de la page avant/après une capture pleine page (avant : 0 -> 232, après : 0 -> 0), onglet actif toujours entier en réduisant la fenêtre de 1400 à 800 px avec 4 pages en Édition. Leçon : un test de mise en page qui ne regarde que la largeur des onglets ne voit pas un effet de bord sur la page ; mesurer aussi `window.scrollY`.

53. **Le nom de l'axe de gauche d'un radar sortait de la tuile (première lettre coupée)** [BUG RÉEL, vu en reprenant les captures du forum et de la vitrine avec les nouveaux styles, 18/11/2026] — `finalizeOption` tronquait chaque nom d'axe à un tiers de la largeur de la tuile, sans regarder la place réelle entre le polygone et le bord : sur une tuile de 330 x 190 à 8 axes, « Montre Connectée » (axe de gauche) commençait à -15 px et perdait son « M », avec le style Standard comme avec Console. Corrigé par `GristBI.format.radarNameRoom` (place par axe : centré en haut et en bas, entre le polygone et le bord sur les côtés) et une coupe mesurée en pixels dans `js/charts.js`. Test : `dev-tests/test-data.js` (bloc « radarNameRoom ») + Playwright (radar de l'onglet « Analyse avancée » en Console, radar d'orientation à deux séries). Leçon : une capture déjà « validée » peut porter un défaut que seule une relecture de zones précises (les bords de chaque tuile) montre ; en reprenant des captures, regarder les bords et les coins de CHAQUE tuile, pas seulement l'ensemble.

## Fragilité de test connue (PAS un bug produit — investiguée en profondeur, à ne pas re-diagnostiquer)

En rejouant la suite Playwright existante pendant le développement des filtres avancés, le script
`new-tile-types.js` (scratch, hors `dev-tests/`) a échoué de façon intermittente (~50% des essais)
sur SA propre assertion "cliquer un point du scatter doit cross-filtrer le KPI", alors qu'il passait
de façon fiable sur les commits précédents. Diagnostic complet (bissection par `git worktree` sur 3
commits, comparaison des positions pixel exactes, appel direct de `store.toggleFilter` en
contournant le clic physique) :

- Le store/rendu ne sont PAS en cause : appeler `store.toggleFilter` directement (sans passer par un
  clic Playwright) produit toujours le bon résultat, à 100%.
- La taille/position du conteneur `.tile-chart` et les positions pixel calculées par
  `convertToPixel` sont QUASI IDENTIQUES avant/après le travail sur les filtres avancés — pas un
  problème de mise en page causé par la nouvelle barre de filtres.
- La cause réelle : "Casque audio" et "Webcam HD" (2 des 5 produits de démo) ont des `Montant`
  agrégés proches (~1,2-1,4M, contre 0,8M/2,1M/5,2M pour les 3 autres) — sur un axe Y compressé dans
  une tuile de ~140px de haut, leurs points ne sont séparés que d'environ 5px, alors que le rayon par
  défaut d'un symbole ECharts (`symbolSize` par défaut, ~10px de diamètre) dépasse largement cet
  écart. Cliquer au centre EXACT du point "Casque audio" tombe alors à la limite du disque de
  "Webcam HD" (dessiné par-dessus, donc gagnant du hit-test) — un cas limite au pixel près, sensible
  à l'anti-aliasing/l'arrondi flottant du moteur de rendu, donc non déterministe d'une exécution à
  l'autre.
- **Ce n'est pas une régression de ce POC** : les données sont générées aléatoirement à chaque
  chargement (pas de seed), donc CE cas limite existait déjà avant les filtres avancés — il n'a
  simplement pas été tiré par le hasard lors des exécutions précédentes. Un vrai utilisateur cliquant
  sur un point qu'il voit clairement à l'écran ne rencontre pas ce problème ; deux points qui se
  chevauchent visuellement à l'écran sont de toute façon ambigus au clic, quel que soit l'outil BI.
- **Aucun changement de code applicatif fait suite à ce diagnostic** — noté ici pour ne pas
  re-invalider une session future à re-diagnostiquer le même faux signal. Si ce script scratch est
  un jour promu dans `dev-tests/`, son assertion scatter devrait cliquer sur un point choisi pour
  être géométriquement isolé (ex. le point avec le Montant le plus extrême), pas sur l'index 0 fixe.

## Design system (`css/style.css`, passe du 2026-09-15)

Pas des "tests" au sens classique (rien à automatiser côté assertions), mais une checklist de
vérification visuelle à refaire à chaque évolution notable du CSS ou d'un nouveau type de tuile :

- [x] Palette catégorielle validée colorblind-safe (skill `dataviz`, `references/palette.md`) —
  vérifiée via `scripts/validate_palette.js` avant intégration (worst adjacent CVD ΔE 9.1 clair,
  cible ≥8), pas choisie à l'œil. Utilisée à la fois dans `css/style.css` (tokens `--accent`, etc.)
  et `js/charts.js` (`CATEGORICAL_PALETTE`, camembert coloré par part, barres en une seule teinte
  cohérente avec l'accent puisque l'axe porte déjà l'identité des catégories).
- [x] Mode clair ET sombre passés en revue par capture d'écran (pas juste `prefers-color-scheme`
  déclaré dans le CSS sans jamais être regardé) 🌐
- [x] Formulaire en mode édition capturé (pas seulement l'état par défaut) — vérifie que les boutons
  "Modifier la tuile"/"Annuler" et les états actifs restent lisibles 🌐
- [x] Aucun sélecteur fonctionnel (id/classe lu par `js/*.js` ou les scripts Playwright) renommé —
  uniquement des valeurs de style affinées ; vérifié en rejouant toute la suite Playwright existante
  après la refonte (0 régression) 🌐
- [ ] Redimensionnement réel du panneau Grist avec le nouveau CSS ⬜ **[NON TESTABLE ICI]**, même
  limite que pour `ResizeObserver` plus haut.

### Icônes SVG (passe sobriété/intuitivité, 2026-09-29)

Remplacement des glyphes texte/emoji (◂ ▸ ✎ ✓ &times; ⚠️) par des icônes SVG en trait dessinées à la
main (`js/main.js:ICON_PATHS`, `stroke="currentColor"`) — mêmes contraintes que le reste du projet :
zéro dépendance tierce, rien à vendoriser.

- [x] Icônes visibles et correctement centrées en thème clair ET sombre (captures d'écran Playwright
  contre `dev-tests/harness.html`) 🌐
- [x] La couleur dynamique existante (survol, tuile en cours d'édition) continue de s'appliquer sans
  changement JS — `currentColor` hérite automatiquement de la couleur du bouton parent 🌐
- [x] `manualSort` absent des listes Dimension/Mesure/Filtre avancé après le correctif du bug #19,
  vérifié en ouvrant réellement chaque combobox (pas seulement le test Node) 🌐
- [x] Aucun sélecteur fonctionnel renommé (mêmes id/classes qu'avant, seul le contenu HTML des
  boutons change) — vérifié en rejouant `node dev-tests/test-data.js` (aucune assertion ne dépend du
  contenu de ces boutons) ✅

### Panneau Réglages / Crédits / logo / licence GPL v3 (2026-09-29)

Bouton « Réglages » (`#open-settings`) + logo Grist Factory dans `.topbar-info`, ouvrant un panneau
« Crédits » (`#settings-modal`, Auteur/Site/Licence/Bio) — voir HYPOTHESES.md pour le détail des 3
décisions d'Antoine (logo/Crédits/GPL accepté, Manrope refusé, bilingue déplacé vers un fil dédié).

- [x] Logo et bouton Réglages visibles, en dernier dans `.topbar-info` (aucun contrôle existant
  déplacé) 🌐
- [x] Clic sur Réglages ouvre le panneau (`hidden` retiré, `display:flex` effectif) 🌐
- [x] Clic sur Fermer masque le panneau (`hidden` réappliqué) 🌐
- [x] Clic sur le fond de l'overlay NE ferme PAS le panneau (même convention que
  `publipostageGrist`, vérifié explicitement plutôt que supposé) 🌐
- [x] Lien Licence pointe vers `github.com/lombre33/Grist-BI/blob/main/LICENSE` et affiche
  « GNU GPL v3.0 » 🌐
- [x] Couleurs correctes en thème sombre (`prefers-color-scheme: dark`) — vérifié par lecture des
  styles calculés ET échantillonnage de pixels sur la capture d'écran (fond de carte `#1a1a19`,
  texte quasi blanc `rgb(222,222,222)`), pas seulement à l'œil sur la vignette : une première lecture
  visuelle de la capture avait semblé montrer une carte claire, contredite par les valeurs réelles —
  piège méthodologique à garder en tête (juger une image sombre par un aperçu compressé peut tromper
  l'œil, revérifier par les pixels/valeurs calculées en cas de doute) 🌐
- [x] `node dev-tests/test-data.js` toujours vert après ce lot (aucune fonction pure touchée) ✅
- [ ] Rendu dans une vraie iframe Grist ⬜ **[NON TESTABLE ICI]**

## Cas explicitement NON testables depuis ce sandbox (voir `HYPOTHESES.md`)

- Round-trip réseau réel `applyUserActions`/`fetchTable` contre un vrai `grist.docApi` (latence, taille de payload, limites de débit).
- Lecture de `_grist_Tables`/`_grist_Tables_column` (types de colonnes réels) — le mock `grist-stub.js` ne simule pas les tables système de Grist.
- `getCurrentUserEmail()` (`js/grist-api.js`, table-sonde `BI_Dashboard_UserProbe` + formule Grist déclenchée `user.Email`, implémentée le 2026-10-21 pour l'attribution automatique des commentaires) — le chemin de détection RÉUSSIE nécessite le moteur de formules Grist côté serveur et une vraie identité utilisateur, absents du mock ; seul le repli (détection échouée → saisie manuelle) est vérifiable ici.
- Redimensionnement réel du panneau/iframe Grist dans la mise en page du document.
- Comportement mobile réel (responsive du widget dans le Grist mobile).
