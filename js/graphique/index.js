// Le module graphique : ce que l'hôte importe. Un seul point d'entrée ; rien ici ne parle à Grist ni à la fenêtre (l'hôte donne les lignes, le module rend des définitions, des colonnes et des points).
// Cette première version ne dessine pas encore : elle fixe la définition (lecture, écriture, version), les colonnes qu'une définition demande, le calcul des points (dont « aucun »), la lecture d'un
// rapport de Grist BI. Le dessin partagé et le volet viennent après (voir GFS-ETAT.md, « Module graphique commun »).
export { VERSION, FORMES, AGREGATS, AGREGAT_AUCUN, GENRES } from './formes.js';
export { lireDefinition, ecrireDefinition, CHAMPS_CONNUS, tuileVersDefinition, definitionVersTuile } from './definition.js';
export { colonnesDeDefinition, dependancesDeDefinition } from './colonnes.js';
export { agreger, groupes, trierParAbscisse, jour, texteDeCellule } from './donnees.js';
export { lireRapport } from './rapport.js';
