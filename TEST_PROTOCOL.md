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
- [x] `tableToRows` — format colonnaire → lignes ✅
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
- [x] `tileExportSheet` — bar (header/rows agrégés comme le rendu) ✅
- [x] `tileExportSheet` — kpi (repli du nom de feuille sur `aggFn(measure)` si `tile.title` absent) ✅
- [x] `tileExportSheet` — scatter (2 mesures alignées par nom de dimension, pas par index) ✅
- [x] `tileExportSheet` — tuile entièrement filtrée (0 ligne) → en-têtes présents, `rows: []` (pas planté, pas d'en-tête absent) ✅
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

- [x] Au démarrage, le sélecteur pointe sur `BI_StressTest` ; la table de config interne (`BI_Dashboard_Config`) n'apparaît JAMAIS dans la liste 🌐
- [x] `GristBI.api.listAvailableTables()` reflète TOUJOURS une table créée entre-temps (pas de cache figé), même sans repasser par le sélecteur UI 🌐
- [x] Se reconnecter à une autre table via le sélecteur recharge les lignes et démarre sur un dashboard VIDE (pas de `seedTiles` hors `BI_StressTest`), les tuiles de l'ancienne table disparaissent 🌐
- [x] Revenir sur une table déjà visitée restaure SA PROPRE configuration déjà sauvegardée (pages/tuiles), config par table 🌐
- [x] Une tuile ajoutée sur une table quelconque (pas seulement `BI_StressTest`) est bien persistée et retrouvée en y revenant 🌐
- [x] [BUG RÉEL #12 ci-dessous] Revenir sur une table déjà visitée après un changement de table restaure bien ses tuiles (pas une config vide à cause d'une sauvegarde perdue) 🌐
- [x] [BUG RÉEL #16 ci-dessous] Le sélecteur de table relit bien la liste à CHAQUE ouverture du menu (`beforeOpen`), pas seulement au démarrage/après un changement réussi : une table créée après le chargement du widget reste atteignable sans recharger la page 🌐

### `js/main.js` + `js/demo-data.js` — bouton "Restaurer les tuiles par défaut" (demande explicite de l'utilisateur, Playwright)

- [x] Caché tant que la page courante a déjà des tuiles (au démarrage, `BI_StressTest` a ses 4 tuiles de démo) 🌐
- [x] Apparaît une fois la page courante vidée, uniquement sur `BI_StressTest` (la seule table dont on connaît des tuiles par défaut) 🌐
- [x] Cliquer restaure exactement les tuiles de `defaultLargeTiles()` (mêmes id), ajoutées à la page COURANTE (`store.addTile`, pas un reset de tout le dashboard) 🌐
- [x] JAMAIS visible sur une table quelconque choisie via le sélecteur, même avec un dashboard vide (état normal pour ces tables, pas une anomalie) 🌐
- [x] La restauration est bien persistée (config sauvegardée), retrouvée en changeant de table puis en y revenant 🌐

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
(2026-09-16, demande explicite de l'utilisateur — voir HYPOTHESES.md) : `BI_StressTest` reste
désormais la SEULE table que ce widget crée. Les cas de test ci-dessous ont été retirés AVEC le code
qu'ils testaient, pas juste désactivés.

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

- [x] Première installation (aucune table) → création fraîche sous le nom FIXE (`BI_StressTest`, sans suffixe de version), toutes les colonnes présentes dès la génération 🌐
- [x] Rechargement avec un schéma déjà à jour → relecture simple, aucune action `AddColumn`/`UpdateRecord` déclenchée 🌐
- [x] Table déjà existante sous le nom fixe mais avec un schéma ANCIEN (colonne manquante) → `AddColumn` puis backfill exact des lignes déjà présentes via `UpdateRecord` (valeurs calculées par `deriveDateColumn`, PAS une formule Grist), aucune ligne perdue ni dupliquée, `result.created === false` 🌐
- [x] Ancien nom de table VERSIONNÉ (`BI_StressTest_v2`) existant, nom fixe absent → `RenameTable` vers le nom fixe, puis complétion du schéma comme ci-dessus ; UNE SEULE table dans le document au final (pas de doublon `_v2` + nom fixe) 🌐
- [ ] Deux anciens noms versionnés coexistant (`_v2` ET `_v1`) → seul le premier de `LEGACY_*_TABLE_NAMES` (le plus récent) est renommé, l'autre reste orphelin ⬜ (comportement voulu — un seul cas réel plausible en pratique, l'utilisateur n'aurait jamais eu qu'UNE version legacy à la fois vu le rythme de ce projet) — pas de cas Playwright dédié
- [ ] **[NON TESTABLE ICI]** `AddColumn`/`RenameTable` contre un vrai `grist.docApi` — le mock les simule de façon minimale (voir `grist-stub.js`), jamais vérifié en conditions réelles

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
- [ ] Redimensionnement réel du panneau Grist (ResizeObserver) ⬜ **[NON TESTABLE ICI]** — logique de coalescing vérifiée par lecture de code seulement
- [ ] `window.resize` classique (hors ResizeObserver) ⬜

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

## Cas explicitement NON testables depuis ce sandbox (voir `HYPOTHESES.md`)

- Round-trip réseau réel `applyUserActions`/`fetchTable` contre un vrai `grist.docApi` (latence, taille de payload, limites de débit).
- Lecture de `_grist_Tables`/`_grist_Tables_column` (types de colonnes réels) — le mock `grist-stub.js` ne simule pas les tables système de Grist.
- `getCurrentUserEmail`-style (probe table + formule déclenchée `user.Email`) — nécessite le moteur de formules Grist côté serveur, absent du mock.
- Redimensionnement réel du panneau/iframe Grist dans la mise en page du document.
- Comportement mobile réel (responsive du widget dans le Grist mobile).
