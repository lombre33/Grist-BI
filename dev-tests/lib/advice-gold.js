/*
 * L'ÉTALON des suggestions de tuiles (niveau 3d-3, 25/11/2026) : pour chacune des 18 tables du corpus (dev-tests/lib/advice-corpus.js), ce qu'une
 * personne qui connaît ses données voudrait voir proposé (`want`) et ce qui serait une absurdité (`never`). Écrit À LA MAIN, d'après ce que chaque table
 * a été fabriquée pour montrer (voir le commentaire de chaque table du corpus) et d'après les défauts mesurés par l'analyse du 25/11/2026
 * (etudes/suggestions-tuiles-analyse-2026-11-25.md) : ce n'est PAS la sortie actuelle de l'outil recopiée. Une attente que l'outil ne remplit pas
 * aujourd'hui reste écrite (c'est un défaut connu, il fait baisser le score) ; on ne retire jamais une attente pour faire monter une note.
 *
 * Une attente décrit une tuile par ses propriétés (`type`, `dimension`, `measure`, `aggFn`…), jamais par son titre ni son rang :
 *   - une valeur : égalité ; un tableau : « l'une de » ; une expression régulière : `test` ; une fonction : `valeur => booléen` ;
 *   - `axes: [liste, k]` : au moins k des axes d'un radar sont dans la liste ;
 *   - `has: ['targetColumn']` : ces champs sont présents ; `same: true` : la dimension est la mesure (« X par X ») ;
 *   - `weight` (1 par défaut) : l'importance de l'attente dans la note.
 * Une règle `never` est touchée dès qu'une des neuf premières suggestions la remplit ; `any: [spec, …]` regroupe plusieurs façons de la remplir.
 *
 * Aucune dépendance, Node seulement ; jamais chargé par index.html. Lu par dev-tests/lib/advice-score.js et dev-tests/test-advice-quality.js.
 */
'use strict';

const GRADES = ['Maths', 'Francais', 'Anglais', 'Histoire', 'Sport'];
const SURVEY = ['Q1', 'Q2', 'Q3'];
const CHARTS_OF_SHARES = ['bar', 'pie', 'treemap'];
// Les types dont `dimension` est un AXE d'agrégation (un groupe = plusieurs lignes). Dans un nuage de points, `dimension` n'est que l'étiquette d'un
// point par ligne (« par Nom » : un point par personne) : un identifiant y est voulu, jamais une absurdité.
const AXIS_CHARTS = ['bar', 'pie', 'treemap', 'line', 'funnel', 'waterfall', 'radar', 'heatmap', 'sunburst', 'combo', 'box'];

const GOLD = {
  rh: {
    want: [
      { id: 'chiffre clé du salaire', type: 'kpi', measure: 'Salaire' },
      { id: 'évolution selon l\'embauche', type: 'line', dimension: /^Embauche\./ },
      { id: 'salaire par service ou poste', type: CHARTS_OF_SHARES, dimension: ['Service', 'Poste'], measure: 'Salaire' },
      { id: 'répartition du salaire', type: ['histogram', 'box'], measure: 'Salaire' }
    ],
    never: [{ id: 'identifiant lu comme mesure ou comme axe', any: [{ measure: 'Matricule' }, { type: AXIS_CHARTS, dimension: ['Matricule', 'Nom'] }] }]
  },
  notes: {
    want: [
      { id: 'radar des matières', type: 'radar', axes: [GRADES, 4], weight: 2 },
      { id: 'moyenne d\'une matière', type: 'kpi', measure: GRADES, aggFn: 'avg' },
      { id: 'moyenne par classe', type: ['bar', 'box'], dimension: 'Classe', measure: GRADES, aggFn: 'avg' },
      { id: 'répartition des notes', type: ['histogram', 'box'], measure: GRADES }
    ],
    never: [
      { id: 'notes additionnées', measure: GRADES, aggFn: 'sum' },
      { id: 'note lue comme catégorie', dimension: GRADES }
    ]
  },
  tickets: {
    want: [
      { id: 'nombre de tickets par statut ou priorité', type: ['bar', 'pie', 'funnel', 'treemap'], aggFn: 'count', dimension: ['Statut', 'Priorite'] },
      { id: 'évolution selon la création', type: 'line', dimension: /^Cree\./ },
      { id: 'satisfaction moyenne', type: ['kpi', 'bar', 'line'], measure: 'Satisfaction', aggFn: 'avg' },
      { id: 'répartition des durées', type: ['histogram', 'box'], measure: 'Duree_h' }
    ],
    never: [
      { id: 'satisfaction additionnée', measure: 'Satisfaction', aggFn: 'sum' },
      { id: 'numéro de ticket lu comme axe', type: AXIS_CHARTS, dimension: 'Ticket' }
    ]
  },
  compta: {
    want: [
      { id: 'chiffre clé du montant', type: 'kpi', measure: 'Montant' },
      { id: 'évolution du montant', type: 'line', dimension: /^Date/, measure: 'Montant' },
      { id: 'montant par catégorie', type: CHARTS_OF_SHARES, dimension: 'Categorie', measure: 'Montant' },
      { id: 'répartition des montants', type: ['histogram', 'box'], measure: 'Montant' }
    ],
    never: []
  },
  projet: {
    want: [
      { id: 'planning des tâches', type: 'gantt', dimension: 'Tache', startColumn: 'Debut', endColumn: 'Fin', weight: 2 },
      { id: 'avancement moyen', type: 'kpi', measure: 'Avancement', aggFn: 'avg' },
      { id: 'avancement moyen par statut ou responsable', type: ['bar', 'box'], dimension: ['Statut', 'Responsable'], measure: 'Avancement', aggFn: 'avg' }
    ],
    never: [{ id: 'avancement additionné', measure: 'Avancement', aggFn: 'sum' }]
  },
  enquete: {
    want: [
      { id: 'radar des questions', type: 'radar', axes: [SURVEY, 3], weight: 2 },
      { id: 'note moyenne d\'une question', type: 'kpi', measure: SURVEY, aggFn: 'avg' },
      { id: 'note moyenne par ville ou recommandation', type: ['bar', 'box'], dimension: ['Ville', 'Recommande'], measure: SURVEY, aggFn: 'avg' },
      { id: 'répartition des âges', type: ['histogram', 'box'], measure: 'Age' }
    ],
    never: [
      { id: 'notes additionnées', measure: SURVEY, aggFn: 'sum' },
      { id: 'numéro de répondant ou commentaire lu comme axe', type: AXIS_CHARTS, dimension: ['Repondant', 'Commentaire'] }
    ]
  },
  crm: {
    want: [
      { id: 'entonnoir des étapes', type: 'funnel', dimension: 'Etape', weight: 2 },
      { id: 'montant par commercial ou secteur', type: CHARTS_OF_SHARES, dimension: ['Commercial', 'Secteur'], measure: 'Montant', aggFn: 'sum' },
      { id: 'chiffre clé du montant', type: 'kpi', measure: 'Montant', aggFn: 'sum' }
    ],
    never: [{ id: 'probabilité additionnée', measure: 'Probabilite', aggFn: 'sum' }]
  },
  large: {
    want: [
      { id: 'chiffre clé d\'une métrique', type: 'kpi', measure: /^Metrique/ },
      { id: 'une métrique par groupe', type: CHARTS_OF_SHARES, dimension: 'Groupe', measure: /^Metrique/ },
      { id: 'répartition d\'une métrique', type: ['histogram', 'box'], measure: /^Metrique/ }
    ],
    never: [{ id: 'nom unique lu comme axe', type: AXIS_CHARTS, dimension: 'Nom' }]
  },
  contacts: {
    want: [
      { id: 'nombre de contacts par ville, état ou lettre d\'information', type: ['bar', 'pie'], aggFn: 'count', dimension: ['Ville', 'Actif', 'Newsletter'] },
      { id: 'nombre de contacts', type: 'kpi', aggFn: 'count' }
    ],
    never: [
      { id: 'courriel, nom ou liste de choix lus comme axe', type: AXIS_CHARTS, dimension: ['Email', 'Nom', 'Tags'] },
      { id: 'liste de choix lue comme mesure', measure: 'Tags' }
    ]
  },
  commandes: {
    want: [
      { id: 'chiffre clé du montant', type: 'kpi', measure: 'Montant' },
      { id: 'évolution du montant', type: 'line', dimension: /^Date/, measure: 'Montant' },
      { id: 'montant par statut ou livraison', type: CHARTS_OF_SHARES, dimension: ['Statut', 'Livree'], measure: 'Montant' },
      { id: 'répartition des montants', type: ['histogram', 'box'], measure: 'Montant' }
    ],
    never: [
      { id: 'référence lue comme mesure', measure: 'Client' },
      { id: 'référence ou liste de choix lues comme axe', type: AXIS_CHARTS, dimension: ['Client', 'Options'] },
      { id: 'liste de choix lue comme mesure', measure: 'Options' }
    ]
  },
  ventes: {
    want: [
      { id: 'Pareto des clients', type: 'combo', comboMode: 'pareto', dimension: 'Client', weight: 2 },
      { id: 'montant par région', type: CHARTS_OF_SHARES, dimension: 'Region', measure: 'Montant' },
      { id: 'répartition des montants', type: ['histogram', 'box'], measure: 'Montant' },
      { id: 'évolution du montant', type: 'line', dimension: /^Date/, measure: 'Montant' }
    ],
    never: []
  },
  resultat: {
    want: [
      { id: 'cascade des postes', type: 'waterfall', dimension: 'Poste', measure: 'Montant', weight: 2 },
      { id: 'résultat net', type: 'kpi', measure: 'Montant' },
      { id: 'montant par poste', type: 'bar', dimension: 'Poste', measure: 'Montant' }
    ],
    never: [{ id: 'parts d\'un total fait de signes opposés', type: ['pie', 'treemap', 'sunburst'], measure: 'Montant' }]
  },
  parcours: {
    want: [
      { id: 'entonnoir des étapes', type: 'funnel', dimension: 'Etape', weight: 2 },
      { id: 'visiteurs par canal', type: ['bar', 'pie', 'treemap'], dimension: 'Canal' },
      { id: 'nombre de visiteurs', type: 'kpi', aggFn: 'count' }
    ],
    never: []
  },
  produits: {
    want: [
      { id: 'lien entre ventes et marge', type: ['combo', 'scatter'], measure: 'Ventes', measureY: 'Marge', weight: 2 },
      { id: 'ventes par produit', type: CHARTS_OF_SHARES, dimension: 'Produit', measure: 'Ventes' },
      { id: 'chiffre clé des ventes', type: 'kpi', measure: 'Ventes' }
    ],
    never: []
  },
  activite: {
    want: [
      { id: 'calendrier de la durée', type: 'calendar', dimension: 'Date', weight: 2 },
      { id: 'durée par équipe ou type', type: CHARTS_OF_SHARES, dimension: ['Equipe', 'Type'], measure: 'Duree_h' },
      { id: 'évolution de la durée', type: 'line', dimension: /^Date/, measure: 'Duree_h' },
      { id: 'chiffre clé de la durée', type: 'kpi', measure: 'Duree_h' }
    ],
    never: []
  },
  objectifs: {
    want: [
      { id: 'réalisé face à l\'objectif', type: ['progress', 'kpi'], has: ['targetColumn'], measure: 'Realise', weight: 2 },
      { id: 'évolution du réalisé', type: 'line', dimension: 'Mois', measure: 'Realise' },
      { id: 'réalisé par commercial', type: ['bar', 'progress'], dimension: 'Commercial', measure: 'Realise' }
    ],
    never: []
  },
  organisation: {
    want: [
      { id: 'soleil région › département', type: 'sunburst', dimension: 'Region', weight: 2 },
      { id: 'budget par région ou département', type: CHARTS_OF_SHARES, dimension: ['Region', 'Departement'], measure: 'Budget' },
      { id: 'chiffre clé du budget', type: 'kpi', measure: 'Budget' }
    ],
    never: []
  },
  support: {
    want: [
      { id: 'carte de chaleur type × équipe', type: 'heatmap', dimension: ['Type', 'Equipe'], columnDimension: ['Type', 'Equipe'], weight: 2 },
      { id: 'nombre de tickets par type ou équipe', type: ['bar', 'pie', 'treemap'], dimension: ['Type', 'Equipe'] },
      { id: 'nombre de tickets', type: 'kpi' }
    ],
    never: []
  }
};

// Règles valables pour TOUTE table (une absurdité universelle) : « X par X » et le numéro de ligne lu comme mesure.
const GLOBAL_NEVER = [
  { id: 'X par X', same: true },
  { id: 'numéro de ligne lu comme mesure', measure: 'id' }
];

// La BASE mesurée le 25/11/2026 (niveaux 1 à 3d-2 en place) : la note de chaque table et sa couverture après compléments. Le corpus et l'outil sont
// déterministes, donc ces nombres se reproduisent à l'identique ; un essai échoue si une table descend de plus d'un point (ou de 5 points de couverture)
// sous sa base. Quand une amélioration FAIT monter une table, relever sa base ici (l'essai le dit) : le score ne doit jamais redescendre en silence.
const BASELINE = {
  rh: { score: 91.8, coverage: 0.75 }, notes: { score: 93.4, coverage: 1 }, tickets: { score: 74.7, coverage: 0.75 }, compta: { score: 92.5, coverage: 1 },
  projet: { score: 96.7, coverage: 1 }, enquete: { score: 86.8, coverage: 0.8 }, crm: { score: 96.7, coverage: 1 }, large: { score: 96.7, coverage: 1 },
  contacts: { score: 96.7, coverage: 1 }, commandes: { score: 92.5, coverage: 1 }, ventes: { score: 90.1, coverage: 0.8 }, resultat: { score: 75.8, coverage: 1 },
  parcours: { score: 92.5, coverage: 0.75 }, produits: { score: 88.4, coverage: 1 }, activite: { score: 93.4, coverage: 0.8 }, objectifs: { score: 100, coverage: 1 },
  organisation: { score: 88.4, coverage: 1 }, support: { score: 96.7, coverage: 1 }
};
const SCORE_TOLERANCE = 1;       // points de note qu'une table peut perdre avant l'échec
const COVERAGE_TOLERANCE = 0.05; // part de couverture qu'une table peut perdre avant l'échec

module.exports = { GOLD, GLOBAL_NEVER, BASELINE, SCORE_TOLERANCE, COVERAGE_TOLERANCE };
