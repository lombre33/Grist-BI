# Grist BI Dashboard (POC)

**Brouillon / preuve de concept — pas prêt pour un usage réel.** Widget personnalisé
[Grist](https://www.getgrist.com/) explorant un dashboard "façon Power BI" à l'intérieur d'un seul
widget : plusieurs tuiles (graphiques + cartes KPI) lisant la même table liée, avec un
**cross-filtering** au clic entre tuiles (cliquer sur une barre/un secteur filtre les autres tuiles,
recliquer retire le filtre — comme un slicer Power BI).

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
- **Drill-down** : une tuile barres/camembert peut déclarer une sous-dimension (ex. Année → Mois) ;
  cliquer un segment au niveau racine détaille cette tuile-là, avec un fil d'Ariane pour remonter.
- **Vues sauvegardées (bookmarks)** : « ★ Sauvegarder la vue actuelle » capture les filtres croisés
  et l'état de drill-down courants sous un nom ; les retrouver dans le menu déroulant les réapplique
  en un clic. Ne capture pas les tuiles elles-mêmes (déjà persistées à part).
- Persistance de la configuration du dashboard (tuiles + vues sauvegardées) dans le document Grist
  (par table liée), donc conservée entre deux ouvertures du widget.
- **Génération de données de démo** : bouton « 🎲 Générer des données de démo » — crée (ou
  régénère) une table avec 480 lignes de données de vente cohérentes (Région × Produit × Année ×
  Mois, montants = quantité × prix unitaire du produit, +12 % de croissance simulée en 2026) et 5
  tuiles pré-configurées (dont une avec drill-down et une avec tendance), pour tester le dashboard
  sans avoir à préparer une table soi-même. N'affecte jamais la table liée au widget dans la page.
  Un bandeau « Revenir à la table liée » permet de repasser sur les vraies données à tout moment ;
  régénérer ne perd pas les tuiles déjà construites, seulement les valeurs.

## Installation dans Grist

1. Publier ce dépôt en page statique (GitHub Pages : Settings → Pages → Deploy from branch → `main`
   / racine), comme pour publipostageGrist.
2. Dans une page Grist, ajouter un widget personnalisé, coller l'URL GitHub Pages. Lier le widget à
   une table (n'importe laquelle, même vide) est nécessaire pour l'ajout du widget, mais **pas**
   pour tester les fonctionnalités : cliquer sur « Générer des données de démo » suffit.
3. Accepter la demande d'accès du widget au chargement (voir *Sécurité et permissions* ci-dessous).
4. Cliquer sur « 🎲 Générer des données de démo » pour un dashboard fonctionnel immédiatement, ou
   ajouter des tuiles à la main via le formulaire en haut du widget.

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

Deux allers-retours avec un usage réel, deux vrais bugs remontés et corrigés : un souci de
chargement d'ECharts sur réseau filtré (HYPOTHESES.md point 3), puis un `KeyError` de génération de
données de démo dû à un schéma de table obsolète (point 9). Depuis : édition et réorganisation de
tuile, `ResizeObserver`, tri chronologique, jeu de données enrichi (480 lignes, 2 ans), filtres
croisés cumulables, tendance KPI, drill-down, vues sauvegardées. Voir HYPOTHESES.md pour la liste
des points encore à valider.

## Licence

MIT pour le code de ce dépôt. `js/vendor/echarts/` contient [Apache ECharts](https://echarts.apache.org/)
embarqué tel quel (Apache-2.0, licence incluse dans ce dossier).
