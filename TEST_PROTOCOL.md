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

### `js/demo-data.js` (Node, `dev-tests/test-data.js`)

- [x] `buildSampleRows` — nombre de lignes exact (produit cartésien des dimensions) ✅
- [x] `buildSampleRows` — toutes colonnes présentes, Quantite/Montant positifs et finis ✅
- [x] `buildSampleRows` — croissance 2026 > 2025 cohérente malgré l'aléatoire (moyenne, pas ligne à ligne) ✅
- [x] `defaultTiles` — chaque tuile référence des colonnes qui existent réellement dans `buildSampleRows` ✅
- [x] `defaultTiles` — au moins une tuile démontre le drill-down à 2 niveaux ✅
- [x] `defaultTiles` — au moins une tuile démontre la tendance KPI ✅
- [x] `defaultTiles` — au moins une tuile démontre `drillCrossFilter` ✅
- [x] `buildLargeSampleRows` — volume exact (~47 040), colonnes complètes, valeurs positives ✅
- [x] `buildLargeSampleRows` — perf de génération + 3 agrégations/filtrages combinés (garde-fou généreux, pas un budget de perf précis) ✅
- [x] `defaultLargeTiles` — mêmes vérifications que `defaultTiles` ✅

### `js/grist-api.js` (Playwright contre `dev-tests/grist-stub.js` — mock en mémoire, PAS un vrai `grist.docApi`)

- [x] `loadOrCreateTable` — première connexion crée la table + remplit (progression affichée) 🌐
- [x] `loadOrCreateTable` — deuxième connexion à une table déjà créée ne renvoie AUCUNE action `AddRecord`/`RemoveRecord` [comportement demandé explicitement par l'utilisateur] 🌐
- [x] `loadOrCreateTable` — deuxième connexion renvoie des valeurs IDENTIQUES (pas régénérées) 🌐
- [x] `applyActionsInChunks` — découpage en lots de 2000, progression appelée après chaque lot 🌐
- [x] `loadConfig`/`saveConfig` — round-trip complet (tuiles réordonnées + bookmark) via appel direct à `loadConfig()` (pas de `page.reload()`, le mock n'a pas de stockage hors mémoire JS) 🌐
- [x] `normalizeConfig` — ancien format tableau brut `[tiles]` lu correctement ⬜ (logique couverte, pas de cas Playwright dédié)
- [x] `normalizeConfig` — nouveau format `{tiles, bookmarks}` lu correctement 🌐
- [ ] `saveConfig` — deux sauvegardes rapprochées (debounce 600ms) ne créent pas deux lignes `AddRecord` pour la même table ⬜
- [ ] **[NON TESTABLE ICI]** round-trip réseau réel de `applyUserActions` contre un vrai `grist.docApi` (latence, taille de payload) — voir `HYPOTHESES.md` point 10
- [ ] **[NON TESTABLE ICI]** lecture de `_grist_Tables`/`_grist_Tables_column` (types de colonnes réels) contre un vrai document — le mock ne simule pas ces tables système

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

### CSS — classe de bug à systématiquement re-vérifier

- [x] `.field[hidden]` masque réellement l'élément (pas seulement `display:flex` de `.field` qui gagne à spécificité égale) [BUG RÉEL, trouvé 2 fois sur des champs différents] ✅ (règle en place)
- [ ] `.demo-banner[hidden]` — obsolète depuis le retrait du bandeau démo, à retirer de cette checklist si le sélecteur est un jour supprimé du CSS
- [ ] **Règle générale à vérifier pour tout NOUVEAU sélecteur avec `hidden`** : si le sélecteur porte `display: <autre chose que none>` sans variante `[hidden]`, il faut la règle `[hidden]{display:none}` explicite — ajouter un test Playwright `isHidden()` pour tout nouveau champ conditionnel

## Bugs réels déjà trouvés (liste de non-régression — ne jamais retirer une entrée)

1. **Instances ECharts détachées** — `innerHTML=''` puis reconstruction totale à chaque rendu détachait les instances ECharts en cache d'un `<canvas>` retiré du DOM (rendu invisible, aucune erreur JS). Corrigé par réconciliation DOM incrémentale.
2. **`.demo-banner[hidden]`** — `display:flex` d'une règle auteur l'emportait sur `[hidden]{display:none}` de la feuille navigateur, à spécificité égale, car chargée après. Corrigé par une règle plus spécifique.
3. **Filtre croisé orphelin après changement de table** — un filtre actif référençant une colonne/valeur du dataset précédent restait affiché après bascule démo ↔ table liée (obsolète depuis le passage à une table de travail unique, mais le principe — nettoyer l'état lié à un contexte qui change — reste valable pour toute future feature de changement de contexte).
4. **`sameValue` / coercion de type** — `groupByAggregate`/`applyFilters` comparaient avec `===` ; `params.name` d'ECharts est toujours une chaîne, donc un clic sur une dimension numérique (`Annee`) filtrait silencieusement toutes les lignes. Corrigé par une comparaison `String(a) === String(b)`.
5. **`KeyError 'Annee'`** [remonté par l'utilisateur en réel] — la table de démo n'était créée QUE si son nom n'existait pas encore ; un ancien schéma sans la colonne `Annee` faisait échouer `AddRecord`. Corrigé par un versionnage du nom de table (`*_SCHEMA_VERSION`).
6. **`.field[hidden]`** — même famille de bug que #2, retrouvé sur un NOUVEAU champ (`tile-drill-crossfilter-field`) alors que le bug #2 avait déjà été "corrigé" ailleurs — preuve que ce type de bug CSS doit être vérifié à chaque nouveau champ conditionnel, pas juste corrigé une fois.
7. **Filtres croisés/état de drill orphelins** — `removeTile`/`updateTile` ne nettoyaient pas les filtres croisés (`toggleFilter` ou `drillCrossFilter`) posés par la tuile supprimée/éditée. Corrigé en même temps que l'ajout de `drillCrossFilter`, avant qu'un utilisateur ne le rencontre en réel.
8. **Libellés d'axe Y tronqués sur de grandes valeurs** [BUG RÉEL trouvé en capturant un screenshot pendant la passe de design] — sur le jeu de test de charge (valeurs ~2,7M), ECharts réservait une marge gauche estimée AVANT de connaître la largeur réelle du texte produit par un `axisLabel.formatter` personnalisé (format compact) ; l'estimation était trop courte, une partie du texte se dessinait hors du canvas et disparaissait silencieusement (aucune erreur JS, juste des libellés du type "000" au lieu de "2,7 M"). Corrigé par `grid: { containLabel: true }`, qui force ECharts à recalculer la marge à partir du texte réellement rendu plutôt que d'une estimation.

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
