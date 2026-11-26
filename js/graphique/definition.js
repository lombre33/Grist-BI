// La définition d'un graphique : lire (jamais faire confiance au texte reçu), écrire, et passer d'une tuile de Grist BI à une définition et retour. Une tuile enregistrée dans la configuration d'un rapport EST déjà
// une définition (mêmes noms, aucune migration) : la version 2 la contient et y ajoute trois choses, `v` (la version), `aggFn: 'none'` (« aucun », voir donnees.js) et `measures` (plusieurs mesures, une couleur et un
// type par série ; jamais avec `seriesColumn`, qui découpe UNE mesure en une série par valeur d'une colonne). Ce qui est lu vient d'une ligne qu'une autre personne du document a pu écrire : chaque champ est
// vérifié un par un, ce qui n'est pas connu est écarté (et dit dans `ignores`), et rien n'est jamais écrit comme du balisage par ce module.
import { VERSION, FORMES, AGREGATS_PERMIS, FERMES, D_AFFICHAGE, TYPES_SERIE } from './formes.js';

const MAX_TEXTE = 200;          // un identifiant de colonne, un titre, une valeur choisie
const MAX_NOTE = 10000;         // le texte d'une tuile Texte
const MAX_MESURES = 8;          // les séries d'un graphique à plusieurs mesures
const MAX_NIVEAUX = 8;          // les niveaux de drill-down
const MAX_AXES = 24;            // les axes d'un radar « colonnes »
const MAX_COLONNES = 60;        // les colonnes d'une table plate
const MAX_VARIABLES = 20;       // les variables d'un titre composé
const COULEUR = /^#[0-9a-fA-F]{6}$/;
const IDENTIFIANT_SUR = /^[a-z][a-z0-9-]{0,31}$/;

const CHAMPS_TEXTE = [
  'dimension', 'measure', 'measureY', 'measureSize', 'columnDimension', 'seriesColumn', 'targetColumn', 'startColumn', 'endColumn', 'dateColumn',
  'radarEntityColumn', 'radarEntityValue', 'trendDimension', 'drillDimension', 'title', 'titleKey',
  // La table que lit la tuile quand ce n'est pas celle du rapport (Grist BI, 26/11/2026) : lue et gardée, jamais utilisée ici — c'est l'hôte qui donne les lignes.
  'table',
];
const CHAMPS_AGREGAT = ['aggFn', 'aggFnY', 'aggFnSize'];
const CHAMPS_BOOLEENS = [
  'horizontal', 'areaFill', 'stacked', 'stackPercent', 'smallMultiples', 'valueLabels', 'donut', 'showPct', 'pivotHeat', 'kpiSparkline', 'wordCloudSplit',
  'drillCrossFilter', 'radarCompareAverage',
  // `total` (nouveau) : une dernière marche de cascade qui va de zéro au cumul final.
  'total',
];
const CHAMPS_NOMBRES = ['refValue', 'target', 'goodPct', 'warnPct', 'gaugeMin', 'gaugeMax', 'bins'];
const CHAMPS_LISTES = [['drillDimensions', MAX_NIVEAUX], ['radarAxes', MAX_AXES], ['columns', MAX_COLONNES]];

// Tout ce que ce module sait lire. Une clé d'une tuile qui n'y est pas (un champ d'une version à venir, un champ de la page) est écartée ET dite dans `ignores` ; `id` est celui de la tuile dans son rapport.
const CONNUS = new Set([
  'id', 'v', 'type', 'numberFormat', 'titleVars', 'text', 'measures', 'palette', ...CHAMPS_TEXTE, ...CHAMPS_AGREGAT, ...CHAMPS_BOOLEENS, ...CHAMPS_NOMBRES,
  ...CHAMPS_LISTES.map(([champ]) => champ), ...Object.keys(FERMES), ...Object.keys(D_AFFICHAGE),
]);

// Les champs que ce module lit, pour un hôte ou un essai qui veut savoir si une clé d'une tuile est portée (voir `ignores`).
export const CHAMPS_CONNUS = Array.from(CONNUS);

const estTexte = (valeur, max = MAX_TEXTE) => typeof valeur === 'string' && valeur !== '' && valeur.length <= max;
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const estObjet = (valeur) => valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur);
const possede = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);
const refus = (raison, champ) => (champ === undefined ? { ok: false, raison } : { ok: false, raison, champ });

// Les champs de texte (colonnes, titre) : un texte non vide de 200 caractères au plus, sinon écarté.
function lireTextes(brut, definition, ignores) {
  for (const champ of CHAMPS_TEXTE) {
    if (!possede(brut, champ)) continue;
    if (estTexte(brut[champ])) definition[champ] = brut[champ]; else ignores.push(champ);
  }
}

// Les agrégats : une valeur inconnue (celle d'une version à venir) n'est PAS lue comme une somme, la définition est refusée.
function lireAgregats(brut, definition) {
  for (const champ of CHAMPS_AGREGAT) {
    if (!possede(brut, champ) || brut[champ] === undefined) continue;
    if (!AGREGATS_PERMIS.includes(brut[champ])) return refus('agregat', champ);
    definition[champ] = brut[champ];
  }
  return null;
}

// Les réglages à choix fermé : ceux qui changent le calcul refusent la définition, ceux d'aspect s'écartent seuls.
function lireChoix(brut, definition, ignores) {
  for (const [champ, permis] of Object.entries(FERMES)) {
    if (!possede(brut, champ) || brut[champ] === undefined) continue;
    if (!permis.includes(brut[champ])) return refus('valeur', champ);
    definition[champ] = brut[champ];
  }
  for (const [champ, permis] of Object.entries(D_AFFICHAGE)) {
    if (!possede(brut, champ) || brut[champ] === undefined) continue;
    if (permis.includes(brut[champ])) definition[champ] = brut[champ]; else ignores.push(champ);
  }
  if (possede(brut, 'palette')) {
    if (typeof brut.palette === 'string' && IDENTIFIANT_SUR.test(brut.palette)) definition.palette = brut.palette; else ignores.push('palette');
  }
  return null;
}

// Les cases à cocher (vrai ou faux, pas autre chose), les nombres (finis), le texte d'une tuile Texte.
function lireSimples(brut, definition, ignores) {
  for (const champ of CHAMPS_BOOLEENS) {
    if (!possede(brut, champ)) continue;
    if (typeof brut[champ] === 'boolean') definition[champ] = brut[champ]; else ignores.push(champ);
  }
  for (const champ of CHAMPS_NOMBRES) {
    if (!possede(brut, champ)) continue;
    if (estNombre(brut[champ])) definition[champ] = brut[champ]; else ignores.push(champ);
  }
  if (possede(brut, 'text')) {
    if (typeof brut.text === 'string' && brut.text.length <= MAX_NOTE) definition.text = brut.text; else ignores.push('text');
  }
}

// Les listes de colonnes (niveaux de drill-down, axes du radar, colonnes d'une table) : des textes valides, `max` au plus, l'ordre gardé.
function lireListes(brut, definition, ignores) {
  for (const [champ, max] of CHAMPS_LISTES) {
    if (!possede(brut, champ)) continue;
    if (!Array.isArray(brut[champ])) { ignores.push(champ); continue; }
    const valeurs = brut[champ].filter((v) => estTexte(v)).slice(0, max);
    if (valeurs.length) definition[champ] = valeurs;
    if (valeurs.length !== brut[champ].length) ignores.push(champ);
  }
}

// Le format des nombres : `{ mode: 'auto' | 'custom' | 'column', decimals?, notation? }`, rien d'autre ; un format inconnu est écarté (Automatique).
function lireFormatNombres(brut, definition, ignores) {
  if (!possede(brut, 'numberFormat')) return;
  const f = brut.numberFormat;
  if (!estObjet(f) || !['auto', 'custom', 'column'].includes(f.mode)) { ignores.push('numberFormat'); return; }
  if (f.mode !== 'custom') { definition.numberFormat = { mode: f.mode }; return; }
  const decimals = Number.isInteger(f.decimals) && f.decimals >= 0 && f.decimals <= 6 ? f.decimals : 'auto';
  definition.numberFormat = { mode: 'custom', decimals, notation: f.notation === 'compact' ? 'compact' : 'standard' };
}

// Les variables d'un titre composé (`titleVars`) : des textes et des nombres seulement, jamais un objet.
function lireVariables(brut, definition, ignores) {
  if (!possede(brut, 'titleVars')) return;
  if (!estObjet(brut.titleVars)) { ignores.push('titleVars'); return; }
  const variables = {};
  for (const [cle, valeur] of Object.entries(brut.titleVars).slice(0, MAX_VARIABLES)) {
    if (IDENTIFIANT_SUR.test(cle.toLowerCase()) && cle !== '__proto__' && ((typeof valeur === 'string' && valeur.length <= MAX_TEXTE) || estNombre(valeur))) variables[cle] = valeur;
  }
  if (Object.keys(variables).length) definition.titleVars = variables;
}

// Une série de `measures` : { column, aggFn?, color?, type? }. Sans colonne valide elle est écartée ; une couleur ou un type invalide sont écartés seuls.
function lireSerie(brute, ignores) {
  if (!estObjet(brute) || !estTexte(brute.column)) return { serie: null };
  const serie = { column: brute.column };
  if (possede(brute, 'aggFn') && brute.aggFn !== undefined) {
    if (!AGREGATS_PERMIS.includes(brute.aggFn)) return { echec: refus('agregat', 'measures') };
    serie.aggFn = brute.aggFn;
  }
  if (typeof brute.color === 'string' && COULEUR.test(brute.color)) serie.color = brute.color.toLowerCase(); else if (possede(brute, 'color')) ignores.push('measures.color');
  if (TYPES_SERIE.includes(brute.type)) serie.type = brute.type; else if (possede(brute, 'type')) ignores.push('measures.type');
  return { serie };
}

// Plusieurs mesures ou une colonne qui découpe : jamais les deux (deux façons d'obtenir des séries qui ne se combinent pas).
function lireMesures(brut, definition, ignores) {
  if (!possede(brut, 'measures')) return null;
  if (!Array.isArray(brut.measures)) { ignores.push('measures'); return null; }
  const series = [];
  for (const brute of brut.measures.slice(0, MAX_MESURES)) {
    const { serie, echec } = lireSerie(brute, ignores);
    if (echec) return echec;
    if (serie) series.push(serie);
  }
  if (series.length && definition.seriesColumn) return refus('series', 'measures');
  if (series.length) definition.measures = series;
  if (series.length !== brut.measures.length) ignores.push('measures');
  return null;
}

// Lit une définition (ou une tuile enregistrée, qui en est une). Rend `{ ok: true, definition, ignores }` ou `{ ok: false, raison, champ? }` : `invalide` (pas un objet), `v1` (le format que Publipostage+ n'a jamais écrit dans un
// document : refusé, jamais lu), `version` (écrite par une version plus récente du module), `forme` (forme inconnue), `agregat`, `valeur`, `series`. Une définition refusée s'affiche grisée avec sa raison, jamais mal dessinée.
export function lireDefinition(brut) {
  if (!estObjet(brut)) return refus('invalide');
  if (possede(brut, 'v')) {
    if (brut.v === 1) return refus('v1');
    if (!Number.isInteger(brut.v) || brut.v < 1) return refus('invalide');
    if (brut.v > VERSION) return refus('version');
  }
  if (!FORMES.includes(brut.type)) return refus('forme');
  const definition = { v: VERSION, type: brut.type };
  const ignores = [];
  lireTextes(brut, definition, ignores);
  const echec = lireAgregats(brut, definition) || lireChoix(brut, definition, ignores);
  if (echec) return echec;
  lireSimples(brut, definition, ignores);
  lireListes(brut, definition, ignores);
  lireFormatNombres(brut, definition, ignores);
  lireVariables(brut, definition, ignores);
  const echecMesures = lireMesures(brut, definition, ignores);
  for (const cle of Object.keys(brut)) if (!CONNUS.has(cle)) ignores.push(cle);
  return echecMesures || { ok: true, definition, ignores };
}

// Ce qu'on enregistre : l'objet que `JSON.stringify` écrit, dans l'ordre où la définition a été lue. Une définition déjà lue se réécrit à l'identique ; rien n'est ajouté tant que la personne n'a rien réglé.
export function ecrireDefinition(definition) {
  const lue = lireDefinition(definition);
  return lue.ok ? lue.definition : null;
}

// Une tuile de Grist BI (avec son `id`, ses champs de présentation de page) vers une définition : l'`id` appartient au rapport, pas à la définition.
export function tuileVersDefinition(tuile) {
  return lireDefinition(tuile);
}

const CARACTERES_INTERDITS = /[^A-Za-z0-9_-]/g;
// Une définition vers une tuile à poser dans un rapport sous l'identifiant `id` : mêmes noms, sans `v`, l'identifiant ramené à `[A-Za-z0-9_-]` comme le fait le magasin de Grist BI (jamais un identifiant
// avec guillemet ou chevron : il finit dans un attribut du DOM).
export function definitionVersTuile(definition, id) {
  const lue = lireDefinition(definition);
  if (!lue.ok) return lue;
  const { v, ...tuile } = lue.definition;
  const sur = (typeof id === 'string' || typeof id === 'number') ? String(id).replace(CARACTERES_INTERDITS, '_') : '';
  return { ok: true, tuile: { id: sur || 'tile', ...tuile }, ignores: lue.ignores };
}
