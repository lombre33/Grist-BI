/*
 * Génération du jeu de données de la table de travail du widget ("Ventes", ~47 040 lignes,
 * BI_StressTest, voir grist-api.js) : colonnes + lignes avec des valeurs qui se tiennent (prix de
 * base par produit, quantités et montants cohérents entre eux), pour pouvoir tester les tuiles/le
 * cross-filtering sans dépendre d'une vraie table Grist. Pur JS, testable sous Node comme
 * data.js/state.js — aucune dépendance à `grist`/au DOM. Anciennement aussi une table de démo
 * "rapide" séparée (BI_Demo_Ventes) : retirée (demande explicite de l'utilisateur, code mort en
 * dehors des tests) — BI_StressTest est désormais la SEULE table que ce widget crée, et le sera
 * pour tout futur ajout de colonne (AddColumn sur cette même table, voir deriveDateColumn/
 * ensureColumnsUpToDate, jamais une nouvelle table).
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

  // `Date` (ISO 'AAAA-MM-JJ', dérivée de Annee/Mois/Jour ci-dessous) : c'est la SEULE colonne
  // réellement de type date de ce POC — Annee/Mois/Jour existent séparément pour démontrer le
  // drill-down hiérarchique, mais aucune ne peut porter un filtre "plage de dates" ou "dates
  // relatives" à elle seule (Roadmap Tier 1, filtres avancés). Ajoutée en plus de ces colonnes
  // plutôt qu'à leur place pour ne rien casser des tuiles/tests déjà construits dessus.
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDate(annee, moisIndex, jour) { return `${annee}-${pad2(moisIndex + 1)}-${pad2(jour)}`; }

  // Calcule la colonne Date à partir des colonnes DÉJÀ présentes sur une ligne EXISTANTE (Annee/Mois/
  // Jour) — réutilisé quand une colonne s'ajoute à `BI_StressTest` alors qu'elle existe déjà dans le
  // document (voir grist-api.js:ensureColumnsUpToDate) : plutôt que de recréer la table sous un
  // nouveau nom à chaque évolution de schéma (ou une nouvelle table), on ajoute la colonne manquante
  // (AddColumn) puis on remplit les lignes déjà présentes avec de VRAIES valeurs calculées ici, pas
  // une formule Grist (demande explicite de l'utilisateur — ce projet n'utilise nulle part le
  // langage de formules Grist). Seule la table de test de charge existe désormais (voir
  // ROADMAP.md/HYPOTHESES.md : l'ancienne table de démo "rapide" a été retirée), donc une seule
  // forme de ligne à gérer.
  function deriveDateColumn(row) {
    return { Date: isoDate(row.Annee, MOIS.indexOf(row.Mois), row.Jour) };
  }

  const REGIONS = ['Nord', 'Sud', 'Est', 'Ouest'];
  const MOIS = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];

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

  // --- Jeu de données "test de charge" : SEULE table de travail du widget (BI_StressTest, voir
  // grist-api.js). Volume important délibéré (voir HYPOTHESES.md pour l'objectif : mesurer où
  // l'agrégation client et l'envoi d'actions Grist commencent à peiner).
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
  // Simplification délibérée : 28 jours fixes par mois, pas un vrai calendrier - suffisant pour un
  // test de charge, inutile de gérer les mois à 30/31 jours ou février.
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
    REGIONS, MOIS, PRODUITS,
    COLUMNS_LARGE, ANNEES_LARGE, JOURS_PAR_MOIS, buildLargeSampleRows, defaultLargeTiles,
    deriveDateColumn
  };
});
