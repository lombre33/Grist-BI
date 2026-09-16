/*
 * Jeu de données de démonstration ("Ventes") : colonnes + génération de lignes avec des valeurs
 * qui se tiennent (prix de base par produit, quantités et montants cohérents entre eux), pour
 * pouvoir tester les tuiles/le cross-filtering sans dépendre d'une vraie table Grist. Pur JS,
 * testable sous Node comme data.js/state.js — aucune dépendance à `grist`/au DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.demoData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // `Date` (ISO 'AAAA-MM-JJ', dérivée de Annee/Mois/Semaine ou Jour ci-dessous) : c'est la SEULE
  // colonne réellement de type date de ce POC — Annee/Mois/Semaine/Jour existent séparément pour
  // démontrer le drill-down hiérarchique, mais aucune ne peut porter un filtre "plage de dates" ou
  // "dates relatives" à elle seule (Roadmap Tier 1, filtres avancés). Ajoutée en plus de ces
  // colonnes plutôt qu'à leur place pour ne rien casser des tuiles/tests déjà construits dessus.
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDate(annee, moisIndex, jour) { return `${annee}-${pad2(moisIndex + 1)}-${pad2(jour)}`; }

  const COLUMNS = [
    { id: 'Region', type: 'Text' },
    { id: 'Produit', type: 'Text' },
    { id: 'Annee', type: 'Int' },
    { id: 'Mois', type: 'Text' },
    { id: 'Semaine', type: 'Int' },
    { id: 'Date', type: 'Date' },
    { id: 'Quantite', type: 'Int' },
    { id: 'Montant', type: 'Numeric' }
  ];

  const REGIONS = ['Nord', 'Sud', 'Est', 'Ouest'];
  const ANNEES = [2025, 2026];
  const MOIS = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  // Simplification délibérée (pas un vrai calendrier ISO) : 4 semaines par mois, suffisant pour
  // démontrer un 3e niveau de drill-down (Année > Mois > Semaine) sans la complexité d'un vrai
  // découpage calendaire (nombre de semaines variable par mois, à cheval sur deux mois...).
  const SEMAINES = [1, 2, 3, 4];

  // Prix de base par produit, pour que Montant = Quantite x prix (+/-10%) ait un sens, plutôt que
  // des chiffres purement aléatoires sans rapport entre les colonnes.
  const PRIX_BASE = {
    'Casque audio': 60,
    'Clavier mécanique': 90,
    'Souris sans fil': 35,
    'Écran 27"': 220,
    'Webcam HD': 50
  };
  const PRODUITS = Object.keys(PRIX_BASE);

  // Facteur de croissance annuelle (2026 vs 2025) : simple mais donne une vraie tendance à observer
  // en comparant Annee d'une tuile à l'autre, sans implémenter de comparaison de périodes dédiée.
  const CROISSANCE_ANNUELLE = { 2025: 1, 2026: 1.12 };

  function buildSampleRows() {
    const rows = [];
    for (const region of REGIONS) {
      for (const produit of PRODUITS) {
        for (const annee of ANNEES) {
          for (const mois of MOIS) {
            for (const semaine of SEMAINES) {
              // ~1/4 de l'ancienne plage mensuelle (3-28) par semaine, pour garder des totaux
              // mensuels d'un ordre de grandeur comparable à avant l'ajout de ce niveau.
              const quantite = Math.round((1 + Math.random() * 7) * CROISSANCE_ANNUELLE[annee]);
              const prixUnitaire = PRIX_BASE[produit] * (0.9 + Math.random() * 0.3);
              // Pas de vrai jour du mois ici (seulement 4 "semaines") : approximé par le 1er jour de
              // chaque semaine (1, 8, 15, 22) — toujours <= 28, valide pour n'importe quel mois réel.
              const jour = 1 + (semaine - 1) * 7;
              rows.push({
                Region: region,
                Produit: produit,
                Annee: annee,
                Mois: mois,
                Semaine: semaine,
                Date: isoDate(annee, MOIS.indexOf(mois), jour),
                Quantite: quantite,
                Montant: Math.round(quantite * prixUnitaire)
              });
            }
          }
        }
      }
    }
    return rows;
  }

  // Tuiles pré-configurées pour que "Générer des données de démo" montre immédiatement le
  // cross-filtering, le drill-down et la tendance KPI, sans que l'utilisateur ait à tout construire
  // à la main.
  function defaultTiles() {
    return [
      { id: 'demo_bar_region', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par Région' },
      { id: 'demo_pie_produit', type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum', title: 'Montant par Produit' },
      { id: 'demo_kpi_montant', type: 'kpi', measure: 'Montant', aggFn: 'sum', trendDimension: 'Annee', title: 'sum(Montant)' },
      { id: 'demo_bar_mois', type: 'bar', dimension: 'Mois', measure: 'Quantite', aggFn: 'avg', title: 'Quantite par Mois (moyenne)' },
      {
        id: 'demo_bar_annee', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois', 'Semaine'],
        drillCrossFilter: true, measure: 'Montant', aggFn: 'sum', title: 'Montant par Année'
      }
    ];
  }

  // --- Jeu de données "test de charge" : même principe, volume bien plus grand (voir HYPOTHESES.md
  // pour l'objectif : mesurer où l'agrégation client et l'envoi d'actions Grist commencent à peiner).
  // Colonnes distinctes (COLUMNS_LARGE) car "Jour" remplace "Semaine" - reprendre le même Semaine
  // pour un si grand nombre de lignes n'aurait rien changé pour évaluer le volume, autant montrer
  // un 3e niveau de granularité différent (Année > Mois > Jour plutôt que > Semaine).
  const COLUMNS_LARGE = [
    { id: 'Region', type: 'Text' },
    { id: 'Produit', type: 'Text' },
    { id: 'Annee', type: 'Int' },
    { id: 'Mois', type: 'Text' },
    { id: 'Jour', type: 'Int' },
    { id: 'Date', type: 'Date' },
    { id: 'Quantite', type: 'Int' },
    { id: 'Montant', type: 'Numeric' }
  ];

  const ANNEES_LARGE = [2020, 2021, 2022, 2023, 2024, 2025, 2026]; // 7 ans, pour un vrai volume
  // Simplification délibérée (comme SEMAINES) : 28 jours fixes par mois, pas un vrai calendrier -
  // suffisant pour un test de charge, inutile de gérer les mois à 30/31 jours ou février.
  const JOURS_PAR_MOIS = 28;

  function buildLargeSampleRows() {
    const rows = [];
    for (const region of REGIONS) {
      for (const produit of PRODUITS) {
        for (let anneeIndex = 0; anneeIndex < ANNEES_LARGE.length; anneeIndex++) {
          const annee = ANNEES_LARGE[anneeIndex];
          const croissance = Math.pow(1.06, anneeIndex); // +6 %/an composé depuis la 1re année
          for (const mois of MOIS) {
            for (let jour = 1; jour <= JOURS_PAR_MOIS; jour++) {
              const quantite = Math.max(1, Math.round((0.5 + Math.random() * 3) * croissance));
              const prixUnitaire = PRIX_BASE[produit] * (0.9 + Math.random() * 0.3);
              rows.push({
                Region: region,
                Produit: produit,
                Annee: annee,
                Mois: mois,
                Jour: jour,
                Date: isoDate(annee, MOIS.indexOf(mois), jour),
                Quantite: quantite,
                Montant: Math.round(quantite * prixUnitaire)
              });
            }
          }
        }
      }
    }
    return rows;
  }

  function defaultLargeTiles() {
    return [
      { id: 'stress_bar_region', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par Région' },
      { id: 'stress_pie_produit', type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum', title: 'Montant par Produit' },
      { id: 'stress_kpi_montant', type: 'kpi', measure: 'Montant', aggFn: 'sum', trendDimension: 'Annee', title: 'sum(Montant)' },
      {
        id: 'stress_bar_annee', type: 'bar', dimension: 'Annee', drillDimensions: ['Mois', 'Jour'],
        drillCrossFilter: true, measure: 'Montant', aggFn: 'sum', title: 'Montant par Année'
      }
    ];
  }

  return {
    COLUMNS, REGIONS, ANNEES, MOIS, SEMAINES, PRODUITS, buildSampleRows, defaultTiles,
    COLUMNS_LARGE, ANNEES_LARGE, JOURS_PAR_MOIS, buildLargeSampleRows, defaultLargeTiles
  };
});
