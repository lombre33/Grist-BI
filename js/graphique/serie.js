// Les séries d'un graphique à catégories (barres, courbe, aire, secteurs) calculées à partir des lignes que l'hôte donne. Le calcul d'agrégat est celui de donnees.js (une cellule vide n'est jamais 0, l'ordre est
// celui de la première apparition) ; ici on range les points : une catégorie par valeur de la dimension, une série par mesure ou par valeur de la colonne « Séries », le tri choisi, et les colonnes dérivées d'une date.
// Une série sans valeur pour une catégorie y a `null` (un trou), jamais 0.
import { groupes, trierGroupes, trierParAbscisse, jour, MODES_DE_TRI } from './donnees.js';
import { AGREGAT_AUCUN, DERIVEES_DATE } from './formes.js';
import { nomDeSerie } from './textes.js';

const VIDE = '\u0000';
const cle = (valeur) => (valeur === null || valeur === undefined ? VIDE : String(valeur));
const nombreOuNull = (valeur) => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null);

// `Date.Annee`, `Date.Trimestre`, `Date.Mois` : une colonne dérivée d'une colonne de dates, recalculée ici (l'hôte ne donne que la colonne de dates).
function deriveeDe(id) {
  if (typeof id !== 'string') return null;
  const point = id.lastIndexOf('.');
  if (point < 0 || id.slice(0, point).includes('.')) return null;
  const partie = id.slice(point + 1);
  return DERIVEES_DATE.includes(partie) ? { base: id.slice(0, point), partie } : null;
}

function valeurDerivee(valeur, partie) {
  const date = jour(valeur);
  if (date === null) return null;
  const mois = Number(date.slice(5, 7));
  if (partie === 'Annee') return Number(date.slice(0, 4));
  if (partie === 'Trimestre') return `T${Math.floor((mois - 1) / 3) + 1}`;
  return date.slice(5, 7);
}

// Le genre d'une colonne pour trier une abscisse : l'année dérivée est un nombre, le trimestre et le mois se comparent comme du texte ; les autres sont ceux que l'hôte a dits (`any` sinon).
export function genreDe(id, genres) {
  const derivee = deriveeDe(id);
  if (derivee) return derivee.partie === 'Annee' ? 'number' : 'date';
  return genres.get(id) || 'any';
}

// Les lignes avec les colonnes dérivées demandées ajoutées. Sans dérivée, ce sont les MÊMES lignes (aucune copie) ; avec, une copie de chaque ligne au même rang (les rangs restent ceux de la source).
export function avecDerivees(lignes, colonnes) {
  const derivees = colonnes.map((id) => ({ id, derivee: deriveeDe(id) })).filter((c) => c.derivee);
  if (!derivees.length) return lignes;
  return lignes.map((ligne) => {
    const copie = { ...ligne };
    for (const { id, derivee } of derivees) copie[id] = valeurDerivee(ligne[derivee.base], derivee.partie);
    return copie;
  });
}

// Les séries demandées : la mesure de la définition, ou les `measures` de la version 2 (jusqu'à 8, chacune avec son agrégat, sa couleur et son type). Sans agrégat, la somme.
export function lesMesures(definition) {
  const base = definition.aggFn || 'sum';
  if (definition.measures && definition.measures.length) {
    return definition.measures.map((m) => ({ colonne: m.column, agregat: m.aggFn || base, couleur: m.color, type: m.type }));
  }
  return [{ colonne: definition.measure, agregat: base }];
}

// Les colonnes que le calcul lit dans les lignes.
export function colonnesLues(definition) {
  const colonnes = [definition.dimension, definition.seriesColumn, ...lesMesures(definition).map((m) => m.colonne)];
  return colonnes.filter((id) => typeof id === 'string' && id);
}

const total = (index, categorie) => {
  const valeurs = index.map((table) => table.get(cle(categorie)));
  if (valeurs.length === 1) return valeurs[0] === undefined ? null : valeurs[0];
  return valeurs.reduce((somme, v) => (nombreOuNull(v) === null ? somme : somme + v), 0);
};

// Aligne les séries sur les catégories (dans l'ordre d'apparition) puis applique le tri : « abscisse » suit l'ordre de l'axe quand il est ordonné, « valeur » trie sur le total des séries (la valeur de la série
// quand il n'y en a qu'une, les valeurs absentes en dernier), « libellé » par ordre naturel.
function assembler(categories, parSerie, mode, genre) {
  const index = parSerie.map((serie) => new Map(serie.points.map((p) => [cle(p.dimension), p.value])));
  let ordre = categories.map((_, i) => i);
  if (mode === 'axis') {
    ordre = trierParAbscisse(categories.map((dimension, i) => ({ dimension, i })), genre).map((p) => p.i);
  } else if (MODES_DE_TRI.includes(mode)) {
    ordre = trierGroupes(categories.map((dimension, i) => ({ dimension, i, value: total(index, dimension) })), mode).map((p) => p.i);
  }
  return {
    categories: ordre.map((i) => categories[i]),
    series: parSerie.map((serie, j) => ({
      name: serie.nom, couleur: serie.couleur, type: serie.type,
      values: ordre.map((i) => (index[j].has(cle(categories[i])) ? index[j].get(cle(categories[i])) : null)),
    })),
  };
}

// Un point par ligne (« aucun ») : les catégories sont les lignes, dans l'ordre (ou l'ordre de l'axe, ou le tri par valeur de la première mesure) ; `rangs[i]` est le rang de la ligne du point i.
function parLigne(definition, lignes, mesures, genre) {
  let points = lignes.map((ligne, rang) => ({ dimension: ligne[definition.dimension] ?? null, value: nombreOuNull(ligne[mesures[0].colonne]), rang }));
  if (definition.sortMode === 'axis') points = trierParAbscisse(points, genre);
  else points = trierGroupes(points, definition.sortMode);
  return {
    categories: points.map((p) => p.dimension),
    series: mesures.map((m, j) => ({ name: m.colonne, couleur: m.couleur, type: m.type, values: points.map((p) => (j === 0 ? p.value : nombreOuNull(lignes[p.rang][m.colonne]))) })),
    rangs: points.map((p) => [p.rang]),
  };
}

// Une série par valeur de la colonne « Séries » (ordre de première apparition), chacune agrégée sur ses seules lignes ; les catégories sont celles de TOUTES les lignes.
function decouper(definition, lignes, mesure, langue) {
  const parValeur = new Map();
  for (const ligne of lignes) {
    const valeur = ligne[definition.seriesColumn] ?? null;
    if (!parValeur.has(valeur)) parValeur.set(valeur, []);
    parValeur.get(valeur).push(ligne);
  }
  return Array.from(parValeur, ([valeur, sesLignes]) => ({
    nom: nomDeSerie(valeur, langue), points: groupes(sesLignes, definition.dimension, mesure.colonne, mesure.agregat),
  }));
}

// Barres, courbe, aire : `{ categories, series: [{ name, values, couleur?, type? }], rangs? }`. `lignes` est déjà passé par `avecDerivees`, `genres` est une Map colonne -> genre.
export function calculerCartesien(definition, lignes, genres, langue) {
  const mesures = lesMesures(definition);
  const genre = genreDe(definition.dimension, genres);
  if (mesures[0].agregat === AGREGAT_AUCUN) return parLigne(definition, lignes, mesures, genre);
  const categories = groupes(lignes, definition.dimension, mesures[0].colonne, mesures[0].agregat).map((p) => p.dimension);
  const parSerie = definition.seriesColumn
    ? decouper(definition, lignes, mesures[0], langue)
    : mesures.map((m) => ({ nom: m.colonne, couleur: m.couleur, type: m.type, points: groupes(lignes, definition.dimension, m.colonne, m.agregat) }));
  return assembler(categories, parSerie, definition.sortMode, genre);
}

// Secteurs et anneau : `{ categories, points: [{ dimension, value }], rangs? }`, triés comme les barres (par valeur ou libellé ; l'ordre de l'axe n'a pas de sens sur un cercle). Avec « aucun », chaque secteur est
// une ligne et `rangs[i]` est son rang dans `lignes`.
export function calculerSecteurs(definition, lignes) {
  const mesure = lesMesures(definition)[0];
  const parLigne = mesure.agregat === AGREGAT_AUCUN;
  const points = parLigne
    ? lignes.map((ligne, rang) => ({ dimension: ligne[definition.dimension] ?? null, value: nombreOuNull(ligne[mesure.colonne]), rang }))
    : groupes(lignes, definition.dimension, mesure.colonne, mesure.agregat);
  const tries = trierGroupes(points, definition.sortMode);
  return { categories: tries.map((p) => p.dimension), points: tries, rangs: parLigne ? tries.map((p) => [p.rang]) : undefined };
}

// Les rangs (dans `source.lignes`) que couvre une marque : le point d'une ligne en « aucun », sinon les lignes de la catégorie (et de la série quand une colonne découpe). Calculé à la demande, au clic.
export function rangsDeMarque(definition, lignes, calcul, indexCategorie, indexSerie, langue) {
  if (calcul.rangs) return calcul.rangs[indexCategorie] || [];
  const categorie = calcul.categories[indexCategorie];
  const serie = definition.seriesColumn && indexSerie !== undefined ? calcul.series[indexSerie].name : null;
  const rangs = [];
  lignes.forEach((ligne, rang) => {
    if (cle(ligne[definition.dimension]) !== cle(categorie)) return;
    if (serie !== null && nomDeSerie(ligne[definition.seriesColumn] ?? null, langue) !== serie) return;
    rangs.push(rang);
  });
  return rangs;
}
