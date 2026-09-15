# Grist BI Dashboard (POC)

**Brouillon / preuve de concept — pas prêt pour un usage réel.** Widget personnalisé
[Grist](https://www.getgrist.com/) explorant un dashboard "façon Power BI" à l'intérieur d'un seul
widget : plusieurs tuiles (graphiques + cartes KPI) lisant la même table, avec un
**cross-filtering** au clic entre tuiles (cliquer sur une barre/un secteur filtre les autres tuiles,
recliquer retire le filtre — comme un slicer Power BI). Le widget se connecte automatiquement, au
chargement, à sa propre table de travail (un gros jeu de données de test, voir plus bas) : pas de
bouton à cliquer ni de table à lier soi-même pour avoir un dashboard fonctionnel tout de suite.

Ce projet fait suite à une discussion sur ce que Power BI a que Grist n'a pas nativement
(cross-filtering entre visuels, mesures agrégées, mise en forme conditionnelle, etc.) — voir
[HYPOTHESES.md](./HYPOTHESES.md) pour le détail de ce qui est démontré ici, ce qui est
délibérément hors scope, et ce qui reste à valider en conditions réelles.

Architecture reprise du widget [publipostageGrist](https://github.com/lombre33/publipostagegrist)
du même auteur : page statique unique, **aucune étape de build**, config du dashboard stockée dans
une table Grist interne cachée (`BI_Dashboard_Config`). ECharts (la bibliothèque de graphiques) est
embarqué directement dans le repo (`js/vendor/echarts/`, Apache-2.0) plutôt que chargé depuis un
CDN externe — un réseau qui filtre `cdnjs.cloudflare.com` (proxy d'entreprise/institution, etc.)
laisserait sinon les tuiles graphiques vides sans erreur explicite.

## Fonctionnalités du POC

- 3 types de tuiles : barres, camembert, carte KPI. Ajout, édition (bouton crayon) et
  **réorganisation** (◂ ▸, modifie l'ordre sans perdre les autres réglages de la tuile).
- Constructeur de tuile simple : dimension + mesure + agrégat (somme/moyenne/comptage/min/max) —
  volontairement **pas** un langage de mesures façon DAX (voir HYPOTHESES.md, point 1).
- **Filtres croisés cumulables** : cliquer sur un segment filtre les autres tuiles ; cliquer sur une
  colonne différente cumule (ET) ; recliquer ou fermer un badge retire juste ce filtre-là.
- **Tendance sur les cartes KPI** : une tuile KPI peut comparer sa valeur à la période précédente
  (ex. Année) — delta en %, flèche verte/rouge.
- **Drill-down à N niveaux** : une tuile barres/camembert peut déclarer autant de sous-dimensions
  que voulu (jusqu'à 5, garde-fou d'ergonomie) via un bouton « + Niveau » dans son formulaire (ex.
  Année → Mois → Jour → Région) ; cliquer un segment détaille progressivement cette tuile-là, avec
  un fil d'Ariane cliquable à plusieurs segments pour remonter à un niveau donné. Au niveau le plus
  profond, cliquer redevient un filtre croisé normal plutôt que de tenter un niveau supplémentaire.
  Une même colonne ne peut pas apparaître deux fois dans le chemin (ni reprendre la dimension
  racine) — une alerte le signale plutôt que de créer une hiérarchie incohérente. Par défaut,
  détailler UNE tuile ne touche pas aux autres (comme le drill-down dans Power BI, qui ne
  cross-filtre pas non plus automatiquement les autres visuels) — activable **par tuile** via la
  case « Filtrer aussi les autres cartes en détaillant » dans son formulaire : chaque niveau franchi
  filtre alors aussi les autres cartes, pas seulement le niveau le plus profond.
- **Vues sauvegardées (bookmarks)** : « ★ Sauvegarder la vue actuelle » capture les filtres croisés
  et l'état de drill-down courants sous un nom ; les retrouver dans le menu déroulant les réapplique
  en un clic. Ne capture pas les tuiles elles-mêmes (déjà persistées à part).
- Persistance de la configuration du dashboard (tuiles + vues sauvegardées) dans le document Grist
  (par table liée), donc conservée entre deux ouvertures du widget.
- **Table de travail par défaut, connectée automatiquement** : au chargement, le widget se connecte
  tout seul (`js/main.js:bootstrap`) à sa table de test de charge (`BI_StressTest_v1`, ~47 040
  lignes : 4 régions × 5 produits × 7 années × 12 mois × 28 jours) avec 4 tuiles pré-configurées
  (dont une avec drill-down à 2 niveaux et cross-filtering activé). Si la table n'existe pas encore
  dans le document, elle est créée et remplie (avec une progression affichée) ; si elle existe
  déjà, le widget se contente de la relire — **aucune donnée n'est renvoyée à Grist au
  rechargement suivant**. C'est désormais LA table de travail du widget (plus de bascule vers une
  autre table). L'envoi initial se fait par lots de 2000 actions plutôt qu'en un seul appel géant.
  Mesures locales : génération + agrégation en ~30ms, rendu des tuiles en 35-60ms (affiché dans le
  bandeau, `#render-time`) — voir HYPOTHESES.md pour le détail et ce qui reste à confirmer en
  conditions réelles (round-trip réseau vers un vrai document). Si le schéma doit se complexifier
  plus tard (colonnes en plus), bumper `STRESS_TABLE_SCHEMA_VERSION` (`js/grist-api.js`) suffit :
  une table fraîche est créée automatiquement au chargement suivant, sans bouton à remettre.

## Installation dans Grist

1. Publier ce dépôt en page statique (GitHub Pages : Settings → Pages → Deploy from branch → `main`
   / racine), comme pour publipostageGrist.
2. Dans une page Grist, ajouter un widget personnalisé, coller l'URL GitHub Pages. Lier le widget à
   une table (n'importe laquelle, même vide) est nécessaire pour l'ajout du widget, mais le widget
   n'en tient pas compte : il se connecte tout seul à sa propre table de travail (voir plus haut).
3. Accepter la demande d'accès du widget au chargement (voir *Sécurité et permissions* ci-dessous) :
   le dashboard se construit alors automatiquement, sans autre action.

## Sécurité et permissions

`requiredAccess: 'full'` — même justification que publipostageGrist : la création/lecture de la
table interne `BI_Dashboard_Config` (config du dashboard) nécessite un accès complet au document,
l'API widget Grist ne proposant pas de niveau intermédiaire entre "une seule table en lecture" et
"accès complet". Comme pour l'autre widget, la restriction fine des données doit se faire via les
**Règles d'accès** natives de Grist, pas dans la configuration du widget.

## Tests

- `node dev-tests/test-data.js` — logique pure (agrégation, filtrage, store), sans navigateur.
- `dev-tests/harness.html` — rendu visuel dans un navigateur avec un faux `window.grist` et des
  données d'exemple, sans document Grist réel. Détails dans `dev-tests/README.md`.

Voir HYPOTHESES.md pour ce qui a été (et n'a pas pu être) testé en conditions réelles avant ce
premier commit.

## État du projet

Deux allers-retours avec un usage réel, quatre vrais bugs remontés/trouvés et corrigés : un souci de
chargement d'ECharts sur réseau filtré (HYPOTHESES.md point 3), un `KeyError` de génération de
données de démo dû à un schéma de table obsolète (point 9), un bug CSS où plusieurs champs du
formulaire de tuile (`.hidden = true` en JS) ne se masquaient en réalité jamais à l'écran, et des
libellés d'axe tronqués sur de grandes valeurs (marge ECharts mal estimée) — les deux derniers
repérés uniquement en vérifiant le rendu réel (visibilité/capture d'écran), jamais via une simple
absence d'erreur JS. Depuis : édition et réorganisation de
tuile, `ResizeObserver`, tri chronologique, filtres croisés cumulables, tendance KPI, vues
sauvegardées, drill-down étendu à N niveaux (avec cross-filtering optionnel PAR TUILE à chaque
niveau franchi), un jeu de données "test de charge" (~47 040 lignes) avec envoi par lots, une
connexion **idempotente** aux tables générées (un clic/chargement ne renvoie les données à Grist
que si la table n'existe pas encore), le passage à une **connexion automatique** à cette table
comme UNIQUE table de travail au démarrage (plus de boutons « Générer », plus de bascule
démo/table liée — voir HYPOTHESES.md), et une **refonte visuelle sobre et épurée** (palette
catégorielle validée colorblind-safe, ombres douces, typographie affinée) qui a aussi révélé un
quatrième vrai bug (libellés d'axe tronqués sur de grandes valeurs, aucune erreur JS — repéré
uniquement en regardant un screenshot). Une [ROADMAP.md](./ROADMAP.md) priorisée (valeur x risque de
faisabilité) trace la suite vers un outil BI plus complet, avec un [TEST_PROTOCOL.md](./TEST_PROTOCOL.md)
associé qui grandit à chaque nouvelle feature. Voir HYPOTHESES.md pour la liste des points encore à
valider, notamment la validation en conditions réelles du round-trip réseau sur le gros volume dès
le premier chargement.

## Licence

MIT pour le code de ce dépôt. `js/vendor/echarts/` contient [Apache ECharts](https://echarts.apache.org/)
embarqué tel quel (Apache-2.0, licence incluse dans ce dossier).
