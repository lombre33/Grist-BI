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
du même auteur : page statique unique, **aucune étape de build**, dépendances chargées en CDN,
config du dashboard stockée dans une table Grist interne cachée (`BI_Dashboard_Config`).

## Fonctionnalités du POC

- 3 types de tuiles : barres, camembert, carte KPI.
- Constructeur de tuile simple : dimension + mesure + agrégat (somme/moyenne/comptage/min/max) —
  volontairement **pas** un langage de mesures façon DAX (voir HYPOTHESES.md, point 1).
- Cross-filtering au clic entre tuiles, un seul filtre actif à la fois.
- Persistance de la configuration du dashboard dans le document Grist (par table liée), donc
  conservée entre deux ouvertures du widget.
- **Génération de données de démo** : bouton « 🎲 Générer des données de démo » — crée (ou
  régénère) une table `BI_Demo_Ventes` avec 120 lignes de données de vente cohérentes (Région ×
  Produit × Mois, montants = quantité × prix unitaire du produit) et 4 tuiles pré-configurées, pour
  tester le dashboard sans avoir à préparer une table soi-même. N'affecte jamais la table liée au
  widget dans la page. Un bandeau « Revenir à la table liée » permet de repasser sur les vraies
  données à tout moment ; régénérer ne perd pas les tuiles déjà construites, seulement les valeurs.

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

Brouillon initial. Non testé dans un vrai document Grist. Voir HYPOTHESES.md pour la liste des
points à valider avant tout usage au-delà de l'exploration.

## Licence

MIT.
