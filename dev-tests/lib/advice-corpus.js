/*
 * Jeux de données de RÉFÉRENCE pour juger les suggestions de tuiles (js/advice.js) : dix tables réalistes, déterministes (un
 * générateur pseudo-aléatoire à graine fixe, jamais `Math.random`), chacune avec le type Grist que ses colonnes auraient (`info`, la
 * forme que lit `advice.setColumnInfo`) quand il change quelque chose. Ce sont les tables sur lesquelles l'analyse du 25/11/2026 a
 * mesuré les défauts de l'outil (Référence additionnée, notes sur 20 additionnées, liste de choix en « combinaisons », échantillon de
 * tête…) : tout essai qui juge « ce que l'outil propose » part d'ici. Aucune dépendance, Node seulement ; jamais chargé par index.html.
 */
'use strict';
const data = require('../../js/data.js');

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Le tableau tel que le widget le montre à l'outil : les colonnes dérivées d'une date (Annee, Trimestre, Mois) y sont déjà.
const withHierarchy = (rows, dateColumn) => data.deriveDateHierarchyColumns(rows, dateColumn);

function build() {
  const sets = [];
  const add = (name, rows, extra) => sets.push(Object.assign({ name, rows }, extra || {}));

  { // Ressources humaines : une date d'embauche, un salaire, un booléen.
    const r = rng(11); const pick = (a) => a[Math.floor(r() * a.length)];
    add('rh', withHierarchy(Array.from({ length: 240 }, (_, i) => ({
      id: i + 1, Matricule: 1000 + i, Nom: 'Nom' + i, Service: pick(['Compta', 'RH', 'IT', 'Ventes', 'Logistique']),
      Poste: pick(['Analyste', 'Manager', 'Technicien', 'Assistant']),
      Embauche: iso(2015 + Math.floor(r() * 10), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      Salaire: Math.round(28000 + r() * 40000), Anciennete: Math.round(r() * 20), Temps_plein: r() > 0.2, Sexe: pick(['F', 'H'])
    })), 'Embauche'), { info: { Service: { type: 'Choice' }, Salaire: { type: 'Numeric', widgetOptions: '{"numMode":"currency","currency":"EUR"}' }, Temps_plein: { type: 'Bool' }, Embauche: { type: 'Date' } } });
  }
  { // Notes sur 20 : cinq matières, la même échelle (le cas d'usage du radar).
    const r = rng(12); const pick = (a) => a[Math.floor(r() * a.length)];
    add('notes', Array.from({ length: 90 }, (_, i) => ({
      id: i + 1, Eleve: 'Eleve' + i, Classe: pick(['3A', '3B', '3C']), Maths: Math.round(r() * 20), Francais: Math.round(r() * 20),
      Anglais: Math.round(r() * 20), Histoire: Math.round(r() * 20), Sport: Math.round(r() * 20)
    })));
  }
  { // Tickets : statut, priorité, deux dates, une durée, une satisfaction de 1 à 5.
    const r = rng(13); const pick = (a) => a[Math.floor(r() * a.length)];
    add('tickets', withHierarchy(Array.from({ length: 800 }, (_, i) => {
      const m = 1 + Math.floor(r() * 10); const d = 1 + Math.floor(r() * 28);
      return { id: i + 1, Ticket: 'T-' + i, Statut: pick(['Ouvert', 'En cours', 'Résolu', 'Fermé']), Priorite: pick(['Basse', 'Moyenne', 'Haute', 'Critique']),
        Cree: iso(2025, m, d), Cloture: iso(2025, m + 1, d), Assigne: pick(['Alice', 'Bob', 'Chloé', 'David', 'Emma', 'Farid']),
        Duree_h: Math.round(r() * 72), Satisfaction: 1 + Math.floor(r() * 5) };
    }), 'Cree'));
  }
  { // Comptabilité : des montants positifs ET négatifs par catégorie, sur deux années.
    const r = rng(14); const pick = (a) => a[Math.floor(r() * a.length)];
    add('compta', withHierarchy(Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1, Date: iso(2024 + Math.floor(r() * 2), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      Categorie: pick(['Loyer', 'Salaires', 'Achats', 'Ventes', 'Impôts', 'Divers']), Montant: Math.round((r() - 0.4) * 5000), Compte: pick(['Banque', 'Caisse'])
    })), 'Date'));
  }
  { // Projet : des tâches avec un début, une fin, un statut, un avancement en %.
    const r = rng(15); const pick = (a) => a[Math.floor(r() * a.length)];
    add('projet', Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, Tache: 'Tâche ' + i, Responsable: pick(['A', 'B', 'C']), Debut: iso(2025, 1 + Math.floor(r() * 8), 1 + Math.floor(r() * 25)),
      Fin: iso(2025, 9 + Math.floor(r() * 3), 1 + Math.floor(r() * 25)), Statut: pick(['À faire', 'En cours', 'Terminé']),
      Avancement: Math.round(r() * 100), Budget: Math.round(r() * 20000)
    })));
  }
  { // Enquête : un âge, des questions notées de 1 à 5, un oui/non, un commentaire libre.
    const r = rng(16); const pick = (a) => a[Math.floor(r() * a.length)];
    add('enquete', Array.from({ length: 300 }, (_, i) => ({
      id: i + 1, Repondant: i + 1, Age: 18 + Math.floor(r() * 60),
      Ville: pick(['Paris', 'Lyon', 'Nantes', 'Lille', 'Bordeaux', 'Toulouse', 'Rennes', 'Nice', 'Brest', 'Tours', 'Dijon', 'Metz']),
      Q1: 1 + Math.floor(r() * 5), Q2: 1 + Math.floor(r() * 5), Q3: 1 + Math.floor(r() * 5), Recommande: pick(['Oui', 'Non']),
      Commentaire: 'Ceci est un commentaire assez long pour être du texte libre ' + i
    })));
  }
  { // Pipeline commercial : des étapes ordonnées, un montant, une probabilité en pourcentage.
    const r = rng(17); const pick = (a) => a[Math.floor(r() * a.length)];
    add('crm', Array.from({ length: 500 }, (_, i) => ({
      id: i + 1, Opportunite: 'Opp' + i, Etape: pick(['Prospect', 'Qualifié', 'Proposition', 'Négociation', 'Gagné']), Commercial: pick(['X', 'Y', 'Z', 'W']),
      Montant: Math.round(r() * 100000), Probabilite: pick([10, 25, 50, 75, 100]), Secteur: pick(['Banque', 'Industrie', 'Santé', 'Éducation', 'Public'])
    })));
  }
  { // Table large : douze métriques sans lien de nom entre elles.
    const r = rng(18); const pick = (a) => a[Math.floor(r() * a.length)];
    add('large', Array.from({ length: 150 }, (_, i) => {
      const row = { id: i + 1, Nom: 'N' + i, Groupe: pick(['G1', 'G2', 'G3', 'G4']) };
      for (let k = 1; k <= 12; k++) row['Metrique' + k] = Math.round(r() * 1000);
      return row;
    }));
  }
  { // Contacts : des booléens et une colonne de listes (`['L', …]`, telle que Grist rend une liste de choix).
    const r = rng(19); const pick = (a) => a[Math.floor(r() * a.length)];
    add('contacts', Array.from({ length: 120 }, (_, i) => ({
      id: i + 1, Nom: 'P' + i, Email: `p${i}@ex.org`, Ville: pick(['A', 'B', 'C', 'D']), Actif: r() > 0.3, Newsletter: r() > 0.5, Tags: ['L', pick(['x', 'y']), pick(['z', 'w'])]
    })), { info: { Actif: { type: 'Bool' }, Newsletter: { type: 'Bool' }, Tags: { type: 'ChoiceList' } } });
  }
  { // Commandes : une colonne RÉFÉRENCE (un numéro de ligne de la table Clients), une liste de choix, un statut, une seule année.
    const r = rng(20); const pick = (a) => a[Math.floor(r() * a.length)];
    add('commandes', withHierarchy(Array.from({ length: 600 }, (_, i) => ({
      id: i + 1, Date: iso(2025, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)), Client: 1 + Math.floor(r() * 40),
      Statut: pick(['Nouvelle', 'Payée', 'Expédiée', 'Annulée']), Montant: Math.round(20 + r() * 900), Remise_pct: pick([0, 5, 10, 15]), Livree: r() > 0.2,
      Options: ['L', pick(['cadeau', 'express']), pick(['bio', 'fragile'])]
    })), 'Date'), {
      info: {
        Client: { type: 'Ref:Clients' }, Options: { type: 'ChoiceList' }, Statut: { type: 'Choice' }, Livree: { type: 'Bool' }, Date: { type: 'Date' },
        Montant: { type: 'Numeric', widgetOptions: '{"numMode":"currency","currency":"EUR"}' }
      }
    });
  }
  return sets;
}

// Une table TRIÉE par date de 300 000 lignes sur six ans, dont une catégorie (Canal) n'apparaît qu'à partir de 2023 : les 20 000
// premières lignes ne la montrent pas toutes. Coûteuse : n'est construite que sur demande.
function sortedBigTable() {
  const r = rng(21); const pick = (a) => a[Math.floor(r() * a.length)];
  const rows = [];
  for (let y = 2020; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let k = 0; k < 4166; k++) {
        rows.push({
          id: rows.length + 1, Date: iso(y, m, 1 + (k % 28)), Annee: y, Region: pick(['N', 'S', 'E', 'O']), Montant: Math.round(r() * 500),
          Canal: y >= 2023 ? pick(['Web', 'App', 'Magasin']) : pick(['Magasin', 'Magasin', 'Web'])
        });
      }
    }
  }
  return rows;
}

module.exports = { build, sortedBigTable, rng, iso, withHierarchy };
