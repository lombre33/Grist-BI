// Les colonnes qu'une définition demande, avec le genre que chacune doit pouvoir porter : ce que l'hôte passe à son remappage (`[{ id, libelle?, genre? }]`) pour retrouver, dans une autre table du
// document, les colonnes d'un graphique importé. Le `genre` est celui qu'un NOMBRE à mesurer ou une DATE exigent ; une colonne de catégories se contente de `text`, que tout genre peut porter. Les colonnes
// dérivées d'une date (`Date.Annee`, `.Trimestre`, `.Mois`) sont recalculées par le module : seule leur colonne de dates est demandée. Une colonne d'une AUTRE table (`Clients.Nom`, une jointure) ne se
// retrouve pas dans la table de travail : elle est dite à part, pour que l'hôte grise le graphique avec sa raison au lieu de lui chercher une colonne qui n'y est pas.
import { DERIVEES_DATE } from './formes.js';
import { lireDefinition } from './definition.js';

const SPECIFIQUES = ['date', 'number', 'bool', 'list'];

// Les champs qui portent UNE colonne, avec son genre. Le genre des mesures dépend de l'agrégat : compter des lignes ne demande aucun genre (n'importe quelle colonne ou aucune).
const CHAMPS_CATEGORIE = ['dimension', 'columnDimension', 'seriesColumn', 'radarEntityColumn', 'trendDimension', 'drillDimension'];
const CHAMPS_DATE = ['startColumn', 'endColumn', 'dateColumn'];

// Le genre demandé pour la mesure `champ` : rien quand on compte des lignes, `number` sinon (somme, moyenne, min, max, et « aucun » : un point par ligne se trace sur un nombre).
function genreDeMesure(definition, champ) {
  const agregat = champ === 'measureY' ? (definition.aggFnY || definition.aggFn) : champ === 'measureSize' ? (definition.aggFnSize || definition.aggFn) : definition.aggFn;
  return agregat === 'count' ? undefined : 'number';
}

// Les demandes `{ colonne, genre? }` d'une définition, dans l'ordre où la forme les lit. `text` n'est pas une demande de genre : toute colonne convient à une catégorie.
function demandes(definition) {
  const liste = [];
  const ajoute = (colonne, genre) => { if (typeof colonne === 'string' && colonne) liste.push({ colonne, genre }); };
  const type = definition.type;
  if (type === 'text') return liste;
  if (type === 'table') { (definition.columns || []).forEach((c) => ajoute(c)); return liste; }
  // Le calendrier trace une colonne de dates ; les autres formes prennent une catégorie.
  CHAMPS_CATEGORIE.forEach((champ) => ajoute(definition[champ], champ === 'dimension' && type === 'calendar' ? 'date' : undefined));
  CHAMPS_DATE.forEach((champ) => ajoute(definition[champ], 'date'));
  (definition.drillDimensions || []).forEach((c) => ajoute(c));
  ['measure', 'measureY', 'measureSize'].forEach((champ) => ajoute(definition[champ], genreDeMesure(definition, champ)));
  ajoute(definition.targetColumn, 'number');
  (definition.radarAxes || []).forEach((c) => ajoute(c, 'number'));
  (definition.measures || []).forEach((m) => ajoute(m.column, (m.aggFn || definition.aggFn) === 'count' ? undefined : 'number'));
  return liste;
}

// Une colonne dérivée (`Date.Annee`) ou une jointure (`Clients.Nom`) ? Un identifiant de colonne n'a jamais de point : le point dit l'une des deux.
function analyser(colonne) {
  const point = colonne.lastIndexOf('.');
  if (point < 0) return { source: colonne };
  const base = colonne.slice(0, point);
  if (!base.includes('.') && DERIVEES_DATE.includes(colonne.slice(point + 1))) return { source: base, derivee: true };
  return { jointure: true };
}

// Deux demandes sur la même colonne : le genre le plus précis gagne (une colonne à la fois en abscisse et en date de mesure se demande `date`), le premier dans l'ordre des champs à égalité.
function fusionner(actuel, nouveau) {
  if (!actuel) return nouveau;
  if (SPECIFIQUES.includes(actuel)) return actuel;
  return nouveau || actuel;
}

// Les colonnes de la table de travail que la définition demande, et les colonnes qui n'en sont pas (jointures).
// `definition` peut être une définition lue ou le texte brut d'une tuile : elle est lue d'abord, une définition refusée ne demande rien.
export function dependancesDeDefinition(definition) {
  const lue = lireDefinition(definition);
  if (!lue.ok) return { colonnes: [], jointures: [], ok: false, raison: lue.raison };
  const genres = new Map();
  const jointures = [];
  for (const { colonne, genre } of demandes(lue.definition)) {
    const lecture = analyser(colonne);
    if (lecture.jointure) { if (!jointures.includes(colonne)) jointures.push(colonne); continue; }
    // Une dérivée se lit sur sa colonne de dates, quel que soit le genre demandé de la dérivée.
    genres.set(lecture.source, fusionner(genres.get(lecture.source), lecture.derivee ? 'date' : genre));
  }
  const colonnes = Array.from(genres, ([id, genre]) => (genre ? { id, genre } : { id }));
  return { ok: true, colonnes, jointures };
}

// La liste que l'hôte attend : `[{ id, libelle?, genre? }]`. Le module ne connaît pas le libellé d'une colonne (une définition n'écrit que des identifiants) : l'hôte retrouve aussi par identifiant sans
// accents ni casse, ce qui couvre les identifiants que Grist tire des libellés (« Date d'envoi » → `Date_d_envoi`).
export function colonnesDeDefinition(definition) {
  return dependancesDeDefinition(definition).colonnes;
}
