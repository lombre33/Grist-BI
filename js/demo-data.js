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

  const COLUMNS = [
    { id: 'Region', type: 'Text' },
    { id: 'Produit', type: 'Text' },
    { id: 'Mois', type: 'Text' },
    { id: 'Quantite', type: 'Int' },
    { id: 'Montant', type: 'Numeric' }
  ];

  const REGIONS = ['Nord', 'Sud', 'Est', 'Ouest'];
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin'];

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

  function buildSampleRows() {
    const rows = [];
    for (const region of REGIONS) {
      for (const produit of PRODUITS) {
        for (const mois of MOIS) {
          const quantite = 3 + Math.round(Math.random() * 25);
          const prixUnitaire = PRIX_BASE[produit] * (0.9 + Math.random() * 0.3);
          rows.push({
            Region: region,
            Produit: produit,
            Mois: mois,
            Quantite: quantite,
            Montant: Math.round(quantite * prixUnitaire)
          });
        }
      }
    }
    return rows;
  }

  // Tuiles pré-configurées pour que "Générer des données de démo" montre immédiatement le
  // cross-filtering et les 3 types de tuile, sans que l'utilisateur ait à tout construire à la main.
  function defaultTiles() {
    return [
      { id: 'demo_bar_region', type: 'bar', dimension: 'Region', measure: 'Montant', aggFn: 'sum', title: 'Montant par Région' },
      { id: 'demo_pie_produit', type: 'pie', dimension: 'Produit', measure: 'Montant', aggFn: 'sum', title: 'Montant par Produit' },
      { id: 'demo_kpi_montant', type: 'kpi', measure: 'Montant', aggFn: 'sum', title: 'sum(Montant)' },
      { id: 'demo_bar_mois', type: 'bar', dimension: 'Mois', measure: 'Quantite', aggFn: 'avg', title: 'Quantite par Mois (moyenne)' }
    ];
  }

  return { COLUMNS, REGIONS, MOIS, PRODUITS, buildSampleRows, defaultTiles };
});
