# Roadmap — vers un outil BI complet (inspiré Power BI / DigDash)

Ce document trace la feuille de route pour faire évoluer ce widget d'un POC de cross-filtering vers
un outil BI plus complet, priorisée par valeur ajoutée ET par risque de faisabilité dans
l'architecture d'un widget custom Grist (JS statique, sans backend à soi). Recherche initiale menée
le 2026-09-15 (10 agents : lecture du dépôt, lecture du code source de Grist sur GitHub
`gristlabs/grist-core`, doc officielle Grist, catalogues Power BI/DigDash). Mise à jour le même jour
suite à une correction technique importante (voir ci-dessous).

## Correction technique importante (2026-09-15, après vérification dans publipostageGrist)

La recherche initiale affirmait que « le widget n'a jamais un accès vérifié aux vrais types de
colonnes Grist (Date, Ref...) » et « aucune méthode confirmée ne donne l'identité de l'utilisateur
courant ». **Ces deux affirmations sont fausses** — vérifié en lisant le code réel de
`publipostageGrist` (widget frère du même auteur, audité, en production) :

- **Types de colonnes réels** : `js/grist-api.js:refreshColumnTypes()` de publipostageGrist lit les
  tables internes de métadonnées `_grist_Tables` et `_grist_Tables_column` via le même
  `grist.docApi.fetchTable()` déjà utilisé partout ailleurs (ce sont des tables Grist normales,
  accessibles comme n'importe quelle autre avec l'accès `full`). `colsMeta.type[i]` donne le vrai
  type Grist de chaque colonne : `Text`, `Numeric`, `Int`, `Date`, `DateTime`, `Ref:NomTable`,
  `RefList:NomTable`, `Choice`... Utilisé en prod pour détecter automatiquement les colonnes Date
  (formatage) et les colonnes Référence (libellé spécial), voir `js/variables.js:270-275` et
  `:365-371` de publipostageGrist.
- **Identité de l'utilisateur courant** : `js/grist-api.js:getCurrentUserEmail()` de
  publipostageGrist utilise un contournement astucieux mais entièrement basé sur des verbes déjà
  prouvés : une table interne cachée (`Publipostage_UserProbe`) avec une colonne à **formule
  déclenchée** dont la formule est `user.Email` (le langage de formules Grist, qui tourne côté
  serveur, a accès à l'identité de l'utilisateur courant). Le widget fait un `AddRecord` (ce qui
  déclenche le calcul de la formule pour CET utilisateur), relit la ligne via `fetchTable`/
  `fetchRowById`, récupère la valeur calculée, puis supprime la ligne (`RemoveRecord`). Aucun
  nouveau verbe, juste un round-trip intelligent sur des verbes déjà éprouvés dans ce POC.

**Conséquence sur la roadmap ci-dessous** : plusieurs items reclassés (voir notes 🔧 dans les
tableaux). Le pattern `_grist_Tables_column` + le pattern "probe table à formule déclenchée" sont
réutilisables tels quels dans `grist-bi` et valent la peine d'être portés tôt, car ils débloquent/
fiabilisent plusieurs autres features.

## Réponses aux deux questions directes posées

### "Drill-down → système hiérarchique automatique ou manuel, c'est faisable ?"

- **Manuel à N niveaux (au-delà des 2 actuels) : oui, risque faible.** `data.js`/`state.js`/
  `charts.js` sont déjà génériques (`tileDrillLevels`, `drillInto`, `drillUp`, `renderBreadcrumb`
  n'ont aucune limite à 2 codée en dur) — seul le formulaire (`js/main.js`, 2 `<select>` fixes) fige
  ça à 2. Étendre = UI répétable, zéro changement moteur.
- **Automatique (détection sans configuration) : oui, plus fiable que prévu depuis la correction
  ci-dessus.** Avec les vrais types de colonnes (`_grist_Tables_column`), on peut détecter fiablement
  une colonne `Date`/`DateTime` et proposer Année > Trimestre > Mois > Jour calculé depuis la vraie
  date (pas une heuristique de nom fragile). Reste risqué pour des hiérarchies non temporelles
  (Pays > Région > Ville) où il n'y a pas de type Grist dédié — là, l'heuristique de nom/dépendance
  fonctionnelle reste nécessaire et doit rester une **suggestion à confirmer**, pas une
  configuration automatique invisible.
- **Drillthrough façon Power BI (clic → page dédiée) : bloquant.** Aucun verbe Grist ne permet à un
  widget de piloter la navigation de page de l'app hôte. Substitut faisable : une modale/tiroir de
  détail dans la même page.

### "C'est quoi un vrai moteur BI ?"

Le cœur logiciel — distinct de l'affichage — qui stocke, indexe et interroge les données de façon
optimisée, avec des garanties qu'un script applicatif n'a pas :

| Composant | Rôle | Ce que ce POC a à la place |
|---|---|---|
| Moteur columnar en mémoire (VertiPaq, QIX, Hyper) | Agrège des millions de lignes en ms via compression colonne (dictionary encoding, RLE) | `Array.reduce` sur un tableau JS brut, non compressé |
| Langage de mesures (DAX) | Recalcule une mesure selon le contexte de filtre actif (context transition) | Une fonction `computeTrend` figée sur 2 groupes |
| Modèle sémantique / relations | Jointures 1-N/N-N, cardinalités, hiérarchies gérées nativement | Aucune notion de relation entre tables |
| Cubes OLAP | Pré-agrégations optimisées pour drill-down/roll-up instantané | Chaque clic relance un scan complet côté client |
| Row-Level Security au niveau moteur | Filtre vérifié là où personne ne peut le contourner | Rien — tout filtrage serait du JS visible/modifiable via devtools |
| Rafraîchissement incrémental, ETL versionné, optimiseur | Ne retraite que le delta, plan d'exécution, cache | Rien de tout ça |

Exemples de vrais moteurs : VertiPaq (Power BI), QIX (Qlik), Hyper (Tableau), moteur in-memory
DigDash Enterprise, et côté embarquable open-source **DuckDB** — la piste la plus réaliste pour ce
widget (voir Tier 2).

## Les limites structurelles (vérifiées dans le code source de Grist)

- **Le widget peut faire des appels réseau sortants** (iframe non sandboxée, pas de CSP imposée par
  Grist) — DuckDB-WASM, export PDF/Excel, appels API externes sont *possibles* techniquement.
- **Le widget n'a et n'aura jamais de backend/cron à lui.** C'est LA limite qui revient dans
  presque tous les blocages : pas d'exécution hors d'un onglet ouvert, pas de secret protégeable
  (toute clé API dans le JS est visible via les devtools).
- **`requiredAccess` n'a que 3 paliers** (none / read_table / full) — pas de granularité ligne.

**Conséquence** : Row-Level Security *réelle*, alertes email/SMS, rafraîchissement programmé, Q&A
IA générative *sécurisée*, embedding live hors Grist, app mobile dédiée — aucun n'est réalisable en
restant un widget JS statique. Pas un manque d'effort : la définition même du modèle "widget custom
Grist". Les avoir vraiment nécessite un service externe séparé (backend + cron), un choix de projet
à trancher consciemment.

## Roadmap priorisée

### Tier 1 — Gains rapides (haute valeur, risque faible/moyen, dans l'architecture actuelle) — ✅ TERMINÉ (2026-09-16)

| Feature | Valeur | Risque | Statut |
|---|---|---|---|
| Drill-down manuel N niveaux | Moyenne | Faible | ✅ fait (2026-09-15) |
| **Refonte visuelle (design system sobre/épuré)** | Haute (transversale — sert toutes les features suivantes) | Faible | ✅ fait (2026-09-15) — insérée en étape intermédiaire à la demande de l'utilisateur |
| Jauge (gauge) | Moyenne | Faible | ✅ fait (2026-09-16) |
| Treemap (plat) | Moyenne | Faible | ✅ fait (2026-09-16) |
| Scatter (version agrégée) | Haute | Moyen | ✅ fait (2026-09-16) |
| Dashboards multi-pages | Haute | Faible | ✅ fait (2026-09-16) |
| Filtres avancés (plage de dates, dates relatives, recherche) | Haute | Moyen | ✅ fait (2026-09-16) |
| Export Excel | Haute | Moyen | ✅ fait (2026-09-16) |

### Tier 1.5 — Améliorations UX demandées après le Tier 1 — ✅ TERMINÉ (2026-09-16)

Pas dans la roadmap initiale : demande directe de l'utilisateur après la fin du Tier 1.

| Feature | Valeur | Risque | Statut |
|---|---|---|---|
| Combobox réutilisable (autocomplétion) | Haute (transversale) | Faible | ✅ fait (2026-09-16) |
| Migrer les sélecteurs de colonne (dimension/mesure/drill-down/filtre) vers Combobox | Haute | Faible | ✅ fait (2026-09-16) |
| Sélecteur de table (reconnexion à une table Grist au choix, pas seulement BI_StressTest) | Haute | Moyen *(généralise `switchTable`, déjà conçue pour ça)* | ✅ fait (2026-09-16) |
| Autocomplétion des VALEURS dans la barre de filtres avancés (champ "Recherche", mode texte libre) | Moyenne | Faible | ✅ fait (2026-09-16) — périmètre réduit au champ texte "Recherche" (voir HYPOTHESES.md : min/max/date gardés natifs, meilleure UX que du texte libre pour ces cas) |
| Retirer la table de démo "rapide" (`BI_Demo_Ventes`) — plus jamais qu'UNE SEULE table créée par le widget | Haute | Faible | ✅ fait (2026-09-16) — demande explicite de l'utilisateur, code mort en dehors des tests |
| Bouton "Restaurer les tuiles par défaut" (dashboard vide sur `BI_StressTest`) | Moyenne | Faible | ✅ fait (2026-09-16) |

### Tier 2 — Chantiers structurants, toujours sans backend

| Feature | Valeur | Risque | Note |
|---|---|---|---|
| Moteur DuckDB-WASM (remplace Array.reduce) | Haute | Moyen | Fondation pour mesures/pivot/blending ensuite |
| Mesures façon DAX simplifié (YTD, N-1, cumul) | Haute | Élevé | Un sous-ensemble ciblé, pas un DAX complet |
| Tableau croisé dynamique (pivot) | Critique | Moyen | 0% de réutilisation ECharts, plus gros volume de code |
| Data blending multi-tables (même document Grist) | Haute | Élevé | 🔧 Moins risqué que prévu : les colonnes `Ref:`/`RefList:` (via `_grist_Tables_column`) encodent déjà les relations — auto-détection des clés de jointure possible. Contredit toujours le choix récent de désactiver `onRecords`, décision produit à retrancher |
| Export PDF/PPT | Haute | Moyen | jsPDF/pptxgenjs, jamais testé en conditions réelles Grist |
| Drill-down hiérarchique automatique | Moyenne | Moyen *(révisé, était Élevé)* | 🔧 Fiable pour les hiérarchies temporelles (colonne `Date`/`DateTime` détectée via le vrai type) ; reste une suggestion à confirmer pour le reste |
| Commentaires collaboratifs | Moyenne | Moyen | 🔧 Attribution auteur automatique maintenant confirmée faisable (pattern `getCurrentUserEmail`) — passer à 1 table = 1 ligne par commentaire (le blob JSON actuel écraserait les commentaires concurrents) |
| Waterfall, Radar | Faible/Moyenne | Moyen | Pas de série ECharts native pour waterfall ; peu de colonnes numériques dans les jeux actuels pour un radar démonstratif |

### Tier 3 — Faisable seulement en sortant du widget (nouveau projet d'infra)

| Feature | Valeur | Ce qu'il faut en vrai |
|---|---|---|
| Alertes email/SMS | Haute | Service externe planifié, interrogeant l'API REST Grist |
| Rafraîchissement programmé réel | Haute | Idem, cron externe |
| Q&A IA générative | Haute | Proxy backend pour protéger la clé LLM (repli sans backend : mini-parseur mots-clés) |
| Embedding live hors Grist | Haute | `docApi` ne fonctionne QUE dans la page Grist |
| App mobile dédiée | Faible | Nouveau produit ; l'adaptation responsive du widget existant reste Tier 1 |
| **Audit des usages** | Haute | 🔧 Révisé : identité utilisateur maintenant fiable (pattern probe-table), donc plus "best effort" que vraiment bloqué — reste limité par la couverture partielle (rien vu hors du widget) et l'absence d'immuabilité du log (table Grist normale, modifiable) |

### Tier 4 — Structurellement bloqué, à ne jamais promettre tel quel

- **Row-Level Security réelle** — l'identité utilisateur est maintenant accessible (voir correction
  ci-dessus), mais ça ne change rien au blocage de fond : l'iframe n'est pas sandboxée et TOUTES les
  données sont déjà chargées en mémoire navigateur avant tout filtrage possible — cosmétique au
  mieux. La vraie solution reste les Access Rules natives de Grist (hors du code du widget).
- **Permissions différenciées par tuile** — 🔧 l'identité étant fiable, l'attribution PAR PROFIL
  devient crédible, mais reste de la personnalisation d'affichage, pas une vraie confidentialité
  (mêmes données déjà en mémoire).
- **Carte géographique générique** — faisable seulement en sacrifiant la généricité (géographie
  câblée en dur).
- **Diagramme de Gantt, graphe réseau** — pas bloqué techniquement mais aucune valeur avec le cas
  d'usage "ventes" actuel.

## Process

- Ce document est mis à jour à chaque changement de priorité ou nouvelle découverte technique
  (comme la correction du 2026-09-15 ci-dessus).
- Voir `TEST_PROTOCOL.md` pour le protocole de test associé à chaque feature de cette roadmap.
- Voir `HYPOTHESES.md` pour le détail technique de ce qui est déjà implémenté et testé.
