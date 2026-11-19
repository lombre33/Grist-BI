// Le module graphique : ce que l'hôte importe. Un seul point d'entrée ; rien ici ne parle à Grist ni à la fenêtre (l'hôte donne les lignes, ECharts, la langue et le thème ; le module rend des définitions, des colonnes,
// des points, un dessin, une image PNG et un modèle de graphique Office). Premier lot dessiné : barres, courbe, aire, secteurs et anneau ; les autres formes rendent `dessin` (voir `FORMES_DESSINEES`).
// Voir GFS-ETAT.md, « Module graphique commun avec Publipostage+ ».
export { VERSION, FORMES, AGREGATS, AGREGAT_AUCUN, GENRES } from './formes.js';
export { lireDefinition, ecrireDefinition, CHAMPS_CONNUS, tuileVersDefinition, definitionVersTuile } from './definition.js';
export { colonnesDeDefinition, dependancesDeDefinition } from './colonnes.js';
export { agreger, groupes, trierParAbscisse, jour, texteDeCellule } from './donnees.js';
export { lireRapport } from './rapport.js';
export { creerGraphique } from './vue.js';
export { FORMES_DESSINEES, SEUILS_VOLUME } from './plan.js';
export { THEME_CLAIR } from './habillage.js';
export { PALETTES, couleursDePalette } from './palettes.js';
