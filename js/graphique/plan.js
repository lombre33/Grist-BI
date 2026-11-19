// Tout ce qui précède le dessin : vérifier la définition et la source, échantillonner si le volume l'exige, calculer les séries et les formateurs. Le dessin à l'écran, l'image hors écran et le modèle Office
// partent du MÊME plan : un PNG, un aperçu et un graphique PowerPoint montrent les mêmes catégories dans le même ordre. Un plan refusé rend `{ ok: false, raison, ... }` avec les codes que l'hôte grise :
// `dessin` (forme ou réglage pas encore dessiné), `invalide`, `v1`, `colonne` (avec `colonne`), `vide`, `volume`. Jamais un dessin faux à la place d'un refus.
import { lireDefinition } from './definition.js';
import { dependancesDeDefinition } from './colonnes.js';
import { AGREGAT_AUCUN } from './formes.js';
import { jour } from './donnees.js';
import { avecDerivees, calculerCartesien, calculerSecteurs, lesMesures, colonnesLues, rangsDeMarque } from './serie.js';
import { couleursDePalette } from './palettes.js';
import { formateurDe } from './nombres.js';

// Les formes dessinées par cette version ; les autres rendent `dessin`, une à une au fil des lots.
export const FORMES_DESSINEES = ['bar', 'line', 'pie'];

// Les formes qu'Office ne sait pas tracer : leur modèle rend `image-seule` (le PNG reste possible quand la forme est dessinée).
export const SANS_OFFICE = ['treemap', 'sunburst', 'sankey', 'calendar', 'gantt', 'wordcloud', 'kpi', 'gauge', 'progress', 'pivot', 'heatmap', 'table', 'text', 'box'];

// Les seuils de volume, fixés par les mesures de dev-tests/test-graphique-navigateur.js (MESURES=1, Chromium, voir HYPOTHESES.md), pas par intuition :
//  - `echantillon` : un graphique « un point par ligne » (agrégat « aucun ») ne trace qu'un point sur k au-delà (dit dans la réponse). 5 000 points : image en 86 ms ; 20 000 : 616 ms.
//  - `categories` : barres, courbe, aire. Le coût suit les catégories : 5 000 en 80 ms, 50 000 en 590 ms. Au-delà, le dessin est refusé (`volume`) au lieu de figer l'éditeur.
//  - `secteurs` : un camembert se dessine en temps QUADRATIQUE (placement des étiquettes) : 5 000 parts en 0,46 s, 20 000 en 8 s, 50 000 en 49 s ; 2 000 parts en ~0,1 s.
//  - `plafond` : le nombre de lignes de la source (1 000 000, le double du pire cas annoncé de 500 000) ; 500 000 lignes agrégées : 75 à 500 ms selon la forme.
export const SEUILS_VOLUME = { echantillon: 5000, categories: 50000, secteurs: 2000, plafond: 1000000 };

// Les réglages d'aspect que ce lot ne dessine pas encore (ils ne changent pas ce que les barres disent, seulement ce qu'on y ajoute) : dits dans `nonDessines`.
const ASPECT_NON_DESSINE = ['refLine', 'refValue', 'valueLabels'];

const SANS_GENRE = new Set(['any']);
const refus = (raison, details) => ({ ok: false, raison, ...details });

// La raison d'un refus de lecture, dans les codes de l'hôte : `v1` et `dessin` (forme inconnue) gardent leur nom ; le reste est `invalide` avec la raison précise en `detail`.
function refusDeLecture(lue) {
  if (lue.raison === 'v1') return refus('v1');
  if (lue.raison === 'forme') return refus('dessin', { detail: 'forme' });
  return refus('invalide', { detail: lue.raison, ...(lue.champ ? { champ: lue.champ } : {}) });
}

// Ce qui change le SENS du graphique (cumul, année précédente, 100 %, petits multiples) n'est pas dessiné par ce lot : le refus vaut mieux qu'un graphique qui dit autre chose.
function refusDeSens(definition) {
  if (definition.measureMode && definition.measureMode !== 'brut') return 'measureMode';
  if (definition.type !== 'pie' && definition.stacked && definition.stackPercent) return 'stackPercent';
  if (definition.type !== 'pie' && definition.smallMultiples && definition.seriesColumn) return 'smallMultiples';
  return null;
}

function nonDessines(definition) {
  if (definition.type === 'pie') return [];
  const liste = ASPECT_NON_DESSINE.filter((champ) => definition[champ] !== undefined && definition[champ] !== false);
  if (lesMesures(definition)[0].agregat === AGREGAT_AUCUN && definition.seriesColumn) liste.push('seriesColumn');
  return liste;
}

// Le sous-ensemble de la définition que le dessin lit : les colonnes demandées sont celles-là, pas celles d'un champ oublié d'une forme précédente.
function restreinte(definition) {
  const { v, type, dimension, seriesColumn, measure, aggFn, measures } = definition;
  const sortie = { v, type, dimension, seriesColumn, measure, aggFn, measures };
  Object.keys(sortie).forEach((cle) => { if (sortie[cle] === undefined) delete sortie[cle]; });
  return sortie;
}

function genreAccepte(demande, reel) {
  return !demande || SANS_GENRE.has(reel) || reel === demande;
}

// Les colonnes demandées existent-elles dans la source, avec un genre qui convient ? `source.colonnes` est facultatif : sans lui, la première ligne dit quelles colonnes existent.
function verifierColonnes(definition, source) {
  const dependances = dependancesDeDefinition(restreinte(definition));
  if (dependances.jointures.length) return refus('colonne', { colonne: dependances.jointures[0], detail: 'jointure' });
  const colonnes = Array.isArray(source.colonnes) && source.colonnes.length ? source.colonnes : null;
  const genres = new Map((colonnes || []).map((c) => [c.id, c.genre]));
  for (const demande of dependances.colonnes) {
    const presente = colonnes ? genres.has(demande.id) : Object.prototype.hasOwnProperty.call(source.lignes[0], demande.id);
    if (!presente) return refus('colonne', { colonne: demande.id, detail: 'absente' });
    if (colonnes && !genreAccepte(demande.genre, genres.get(demande.id))) return refus('colonne', { colonne: demande.id, detail: 'genre' });
  }
  return { ok: true, genres };
}

// Une dimension est obligatoire ; une mesure l'est sauf pour compter des lignes.
function verifierChamps(definition) {
  if (typeof definition.dimension !== 'string') return refus('invalide', { detail: 'champ', champ: 'dimension' });
  const manque = lesMesures(definition).find((m) => m.agregat !== 'count' && typeof m.colonne !== 'string');
  return manque ? refus('invalide', { detail: 'champ', champ: 'measure' }) : null;
}

// « Un point par ligne » au-delà du seuil : un point sur k, régulièrement, premier et dernier compris ; rend les rangs gardés (dans la source) ou `null` sans échantillon.
function rangsEchantillon(nombre) {
  if (nombre <= SEUILS_VOLUME.echantillon) return null;
  const garde = SEUILS_VOLUME.echantillon;
  const rangs = [];
  for (let i = 0; i < garde; i += 1) rangs.push(Math.round((i * (nombre - 1)) / (garde - 1)));
  return rangs;
}

// Sans `source.colonnes`, le genre de la dimension se lit sur ses valeurs (200 au plus) : des nombres se trient comme des nombres, des dates `AAAA-MM-JJ` comme des dates, le reste garde l'ordre des lignes.
function genreInfere(lignes, id) {
  let genre = null;
  let vus = 0;
  for (let i = 0; i < lignes.length && vus < 200; i += 1) {
    const valeur = lignes[i][id];
    if (valeur === null || valeur === undefined) continue;
    vus += 1;
    const lu = typeof valeur === 'number' ? 'number' : (jour(valeur) !== null && /^\d{4}-\d{2}-\d{2}/.test(valeur) ? 'date' : 'text');
    if (genre !== null && genre !== lu) return 'any';
    genre = lu;
  }
  return genre || 'any';
}

// Trop de catégories (ou de parts) pour dessiner sans figer l'éditeur : refus `volume`, avec le nombre et le plafond.
function refusDeVolume(definition, calcul) {
  const pie = definition.type === 'pie';
  const plafond = pie ? SEUILS_VOLUME.secteurs : SEUILS_VOLUME.categories;
  return calcul.categories.length > plafond ? refus('volume', { detail: pie ? 'secteurs' : 'categories', nombre: calcul.categories.length, plafond }) : null;
}

function calculer(definition, lignes, genres, langue) {
  return definition.type === 'pie' ? calculerSecteurs(definition, lignes) : calculerCartesien(definition, lignes, genres, langue);
}

// Le plan d'un dessin. `source` : { lignes, colonnes?, reglages? } ; `langue` : 'fr' | 'en'.
export function preparer(brute, source, langue) {
  const lue = lireDefinition(brute);
  if (!lue.ok) return refusDeLecture(lue);
  const definition = lue.definition;
  if (!FORMES_DESSINEES.includes(definition.type)) return refus('dessin', { detail: 'forme', forme: definition.type });
  const sens = refusDeSens(definition);
  if (sens) return refus('dessin', { detail: 'reglage', champ: sens });
  const champs = verifierChamps(definition);
  if (champs) return champs;
  if (!source || !Array.isArray(source.lignes)) return refus('invalide', { detail: 'source' });
  if (!source.lignes.length) return refus('vide');
  if (source.lignes.length > SEUILS_VOLUME.plafond) return refus('volume', { detail: 'lignes', nombre: source.lignes.length, plafond: SEUILS_VOLUME.plafond });
  const verifiees = verifierColonnes(definition, source);
  if (!verifiees.ok) return verifiees;
  const parLigne = lesMesures(definition)[0].agregat === AGREGAT_AUCUN;
  const ordre = parLigne ? rangsEchantillon(source.lignes.length) : null;
  const lignes = avecDerivees(ordre ? ordre.map((rang) => source.lignes[rang]) : source.lignes, colonnesLues(definition));
  const genres = verifiees.genres.size ? verifiees.genres : new Map([[definition.dimension, genreInfere(lignes, definition.dimension)]]);
  const calcul = calculer(definition, lignes, genres, langue);
  const trop = refusDeVolume(definition, calcul);
  if (trop) return trop;
  const formateurs = lesMesures(definition).map((m) => formateurDe({ ...definition, aggFn: m.agregat }, m.colonne, source, langue));
  const sortie = {
    ok: true, definition, langue, calcul, formateurs, lignes, ordre,
    palette: couleursDePalette(definition.palette),
    nonDessines: nonDessines(definition),
    ignores: lue.ignores,
  };
  if (ordre) sortie.echantillon = { sur: source.lignes.length, tires: ordre.length };
  return sortie;
}

// Les rangs (dans `source.lignes`) des lignes qu'une marque couvre : la catégorie `indexCategorie` et, quand une colonne découpe en séries, la série `indexSerie`. Avec un échantillon, les rangs de l'échantillon
// sont ramenés à ceux de la source.
export function rangsDeLaMarque(plan, indexCategorie, indexSerie) {
  const rangs = rangsDeMarque(plan.definition, plan.lignes, plan.calcul, indexCategorie, indexSerie, plan.langue);
  return plan.ordre ? rangs.map((rang) => plan.ordre[rang]) : rangs;
}
