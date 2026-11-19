// Les mots du module graphique : les formes qu'il sait tracer, les agrégats (dont « aucun »), les genres de colonne que l'hôte lui donne, et les valeurs permises de chaque réglage à choix fermé.
// Rien d'autre ici : pas de calcul, pas de lecture. Les noms de champ sont ceux de Grist BI (une tuile enregistrée est déjà une définition) ; ce qui s'y ajoute en version 2 est dit dans definition.js.

// La version de la définition que ce module écrit. Une définition sans `v` est celle d'une tuile de Grist BI d'avant le module : elle se lit telle quelle (la version 2 la contient).
export const VERSION = 2;

// Les 23 formes de Grist BI, dans l'ordre de ses cartes de choix. Une forme qui n'est pas dans cette liste (celle d'une version à venir) n'est jamais lue comme des barres : la définition est grisée.
export const FORMES = [
  'bar', 'histogram', 'box', 'line', 'combo', 'pie', 'treemap', 'sunburst', 'funnel', 'sankey', 'calendar', 'gantt',
  'scatter', 'waterfall', 'radar', 'wordcloud', 'kpi', 'gauge', 'progress', 'pivot', 'heatmap', 'table', 'text',
];

// « aucun » : un point par ligne, dans l'ordre des lignes, doublons gardés. C'est un chemin de calcul à part (donnees.js), jamais une valeur de plus que l'on lirait comme une somme.
export const AGREGAT_AUCUN = 'none';
export const AGREGATS = ['sum', 'avg', 'count', 'min', 'max'];
export const AGREGATS_PERMIS = [...AGREGATS, AGREGAT_AUCUN];

// Ce que l'hôte dit d'une colonne : `any` = une colonne à formule sans type, `other` = rien à tracer (pièces jointes).
export const GENRES = ['text', 'number', 'bool', 'date', 'list', 'any', 'other'];

// Réglages à choix fermé. Ceux de `FERMES` changent ce que la tuile calcule : une valeur inconnue (version à venir) grise la définition. Ceux de `D_AFFICHAGE` ne changent que l'aspect : une valeur inconnue est écartée.
export const FERMES = {
  measureMode: ['brut', 'cumulative', 'ytd', 'yoy'],
  comboMode: ['pareto'],
  radarAxisMode: ['columns', 'dimension'],
};
export const D_AFFICHAGE = {
  // `axis` (nouveau) : trier par abscisse quand l'axe est ordonné (nombre, date), garder l'ordre des lignes sinon ; l'hôte donne le genre de la colonne, le dessin décide.
  sortMode: ['value-desc', 'value-asc', 'label', 'axis'],
  refLine: ['average', 'value'],
  lineShape: ['smooth', 'step'],
};

// Le type d'une série quand une tuile mêle barres et courbe (`measures[].type`).
export const TYPES_SERIE = ['bar', 'line'];

// Les colonnes que l'on dérive d'une colonne de dates (drill-down hiérarchique) : `<colonne>.Annee`, `.Trimestre`, `.Mois`. Un identifiant de colonne Grist n'a jamais de point : tout point est une dérivée ou une jointure.
export const DERIVEES_DATE = ['Annee', 'Trimestre', 'Mois'];
