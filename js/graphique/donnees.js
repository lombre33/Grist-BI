// Le calcul des points d'un graphique à partir des lignes que l'hôte donne. Trois règles que le moteur d'origine de Grist BI ne tient pas, et que ce module tient :
//  1. « aucun » est un chemin à part : un point par ligne, dans l'ordre des lignes, doublons gardés, chaque point portant l'identifiant de sa ligne (de quoi relier un point à sa ligne). Un agrégat inconnu
//     LÈVE une erreur au lieu d'être lu comme une somme sans rien dire.
//  2. Une cellule vide, en erreur ou qui n'est pas un nombre (`null`, comme l'hôte la donne) n'est jamais lue comme 0 : la moyenne, le minimum et le maximum l'ignorent (celui d'origine la comptait pour 0 et
//     tirait la moyenne vers le bas). Sans aucune valeur, ils valent `null` (pas de point), jamais 0. La somme de rien reste 0 et un comptage compte les LIGNES du groupe.
//  3. L'ordre est celui de la première apparition dans les lignes, jamais alphabétique (« Avril » ne passe pas avant « Janvier »).
import { AGREGATS, AGREGAT_AUCUN } from './formes.js';

const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);

// Agrège `valeurs` (les cellules d'un groupe) avec `agregat`. `count` compte les cellules (les lignes du groupe) ; les autres ne lisent que les nombres.
export function agreger(valeurs, agregat) {
  if (!AGREGATS.includes(agregat)) throw new RangeError(`agrégat inconnu : ${agregat}`);
  if (agregat === 'count') return valeurs.length;
  const nombres = valeurs.filter(estNombre);
  if (agregat === 'sum') return nombres.reduce((total, v) => total + v, 0);
  if (!nombres.length) return null;
  if (agregat === 'avg') return nombres.reduce((total, v) => total + v, 0) / nombres.length;
  return nombres.reduce((retenu, v) => (agregat === 'min' ? Math.min(retenu, v) : Math.max(retenu, v)));
}

// Les points `{ dimension, value }` d'un graphique à catégories : une catégorie par valeur de `dimension`, ou un point par ligne avec « aucun » (`{ dimension, value, ligne }`).
// Une ligne sans valeur dans `dimension` forme la catégorie `null` (le dessin la nomme « - » comme le graphique de la page).
export function groupes(lignes, dimension, mesure, agregat) {
  if (agregat === AGREGAT_AUCUN) {
    return lignes.map((ligne) => ({ dimension: ligne[dimension] ?? null, value: estNombre(ligne[mesure]) ? ligne[mesure] : null, ligne: ligne.id }));
  }
  if (!AGREGATS.includes(agregat)) throw new RangeError(`agrégat inconnu : ${agregat}`);
  const parCategorie = new Map();
  for (const ligne of lignes) {
    const cle = ligne[dimension] ?? null;
    if (!parCategorie.has(cle)) parCategorie.set(cle, []);
    parCategorie.get(cle).push(ligne[mesure]);
  }
  return Array.from(parCategorie, ([cle, valeurs]) => ({ dimension: cle, value: agreger(valeurs, agregat) }));
}

// Le tri « par abscisse » (`sortMode: 'axis'`) : quand l'axe est ordonné (genre `number` ou `date`) les points suivent l'ordre de l'axe ; un axe de texte garde l'ordre des lignes, qui est celui que la
// personne a voulu (les mois d'une année). Les dates `AAAA-MM-JJ` se comparent comme du texte. Les points sans abscisse vont à la fin ; le tri est stable ; la liste d'origine n'est pas modifiée.
export function trierParAbscisse(points, genre) {
  if (genre !== 'number' && genre !== 'date') return points;
  const rang = (a, b) => {
    if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
  };
  return points.map((point, index) => ({ point, index }))
    .sort((x, y) => rang(x.point.dimension, y.point.dimension) || x.index - y.index)
    .map(({ point }) => point);
}

// Les modes de tri par valeur ou par libellé (`sortMode`) ; `axis` (par abscisse) est `trierParAbscisse`.
export const MODES_DE_TRI = ['value-desc', 'value-asc', 'label'];

function comparerLibelles(a, b) {
  if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) return a - b;
  // `numeric` : « 2 » avant « 10 », « T2 » avant « T10 » ; `sensitivity: 'base'` ignore casse et accents.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Trie des points `{ dimension, value }` par valeur (décroissante ou croissante) ou par libellé ; un autre mode rend les points tels quels. Jamais en place. Une valeur absente va toujours en dernier,
// quel que soit le sens : elle n'est ni la plus grande ni la plus petite.
export function trierGroupes(points, mode) {
  if (!MODES_DE_TRI.includes(mode)) return points;
  const copie = points.slice();
  if (mode === 'label') return copie.sort((x, y) => comparerLibelles(x.dimension, y.dimension));
  const sens = mode === 'value-desc' ? -1 : 1;
  const absente = (v) => v === null || v === undefined || Number.isNaN(v);
  return copie.sort((x, y) => {
    if (absente(x.value) || absente(y.value)) return (absente(x.value) ? 1 : 0) - (absente(y.value) ? 1 : 0);
    return sens * (x.value - y.value);
  });
}

// Une date lue de l'hôte, ramenée au JOUR `AAAA-MM-JJ` : une date reste telle quelle, une date et heure (`AAAA-MM-JJTHH:MM:SS`, l'heure du mur de la colonne) perd son heure, rien d'autre n'est une date.
// Le dessin de Grist BI regroupe, trie et filtre par jour : l'heure n'est lue nulle part.
export function jour(valeur) {
  if (typeof valeur !== 'string') return null;
  const lu = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2})?$/.exec(valeur);
  if (!lu) return null;
  const date = new Date(Date.UTC(Number(lu[1]), Number(lu[2]) - 1, Number(lu[3])));
  const bon = date.getUTCFullYear() === Number(lu[1]) && date.getUTCMonth() === Number(lu[2]) - 1 && date.getUTCDate() === Number(lu[3]);
  return bon ? `${lu[1]}-${lu[2]}-${lu[3]}` : null;
}

// Le texte d'une cellule. Une liste est un tableau de valeurs, rien d'autre : le premier élément n'est JAMAIS une marque (la liste `['L', 'M']` de deux choix « L » et « M » se lit « L, M », là où
// le lecteur de cellules d'origine prenait « L » pour la marque de liste de Grist et répondait « M »). Une cellule vide est le texte vide.
export function texteDeCellule(valeur) {
  if (valeur === null || valeur === undefined) return '';
  if (Array.isArray(valeur)) return valeur.map(texteDeCellule).join(', ');
  if (typeof valeur === 'object') return '';
  return String(valeur);
}
