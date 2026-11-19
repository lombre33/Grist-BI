// La lecture d'un graphique de Publipostage+ (sa définition « v1 » : `{ v, kind, table, label, values, stack, horizontal, total, max, title, palette, colors, labels, mix }`) en définition v2. Ce n'est
// pas une copie champ à champ : la v1 trace une ligne = un point, la v2 sait agréger, et une même valeur de `kind` ne se lit pas pareil selon la forme. D'après chart-make.js de Publipostage+ (à confirmer par
// un essai côté Publipostage+, comme le dit le contrat) : barres, nuage, radar et cascade se lisent « aucun » ; courbe et aire « aucun » avec le tri par abscisse (`sortMode: 'axis'`, la v1 trie les nombres
// et les dates) ; secteurs, anneau et entonnoir additionnent les lignes de même étiquette (`sum`, ou `count` sans colonne de valeurs). La table (`table`) reste à l'hôte : elle est rendue à part.
// La jauge n'a pas d'équivalent : la v1 trace UNE JAUGE PAR LIGNE (douze au plus, une valeur pleine commune), la forme `gauge` de Grist BI une seule valeur agrégée. Elle est refusée (`jauge`) plutôt que
// devinée : voir la question posée à Publipostage+.
import { lireDefinition } from './definition.js';

const MAX_TEXTE_V1 = 4000;      // la taille que Publipostage+ accepte pour le texte d'une définition
const FORMES_V1 = ['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'radar', 'funnel', 'waterfall', 'gauge'];
const PARTS = ['pie', 'donut', 'funnel'];
// La forme de Grist BI qui trace chaque forme de la v1 (l'aire est une courbe remplie, l'anneau un secteur évidé).
const TYPE_DE_FORME = { bar: 'bar', line: 'line', area: 'line', scatter: 'scatter', pie: 'pie', donut: 'pie', radar: 'radar', funnel: 'funnel', waterfall: 'waterfall' };
const estObjet = (valeur) => valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur);
const possede = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);

// Les jeux de couleurs de Publipostage+ : le sien « standard » est celui de Grist (dix couleurs), qui n'est pas le « standard » de Grist BI (huit) ; les autres ont des noms qui existent déjà chez Grist BI
// avec d'autres couleurs (`blue`, `gray`). On garde donc les siens sous un nom à eux : `grist` pour le défaut, `grist-<nom>` pour les quatre autres. Noms provisoires, à fixer avec Publipostage+.
function paletteDe(palette) {
  if (typeof palette !== 'string' || palette === 'standard' || !['blue', 'warm', 'cool', 'gray'].includes(palette)) return 'grist';
  return `grist-${palette}`;
}

// Les séries : une `measures` par colonne à tracer, avec sa couleur (`colors[colonne]`) et son type quand il diffère de celui de la forme (`mix[colonne]`). La v1 les garde par identifiant de colonne.
function seriesDe(brut, valeurs) {
  const couleurs = estObjet(brut.colors) ? brut.colors : {};
  const types = estObjet(brut.mix) ? brut.mix : {};
  return valeurs.map((colonne) => {
    const serie = { column: colonne };
    if (possede(couleurs, colonne)) serie.color = couleurs[colonne];
    if (possede(types, colonne)) serie.type = types[colonne];
    return serie;
  });
}

// Les colonnes de valeurs de la v1 : au plus 8 identifiants, comme elle les borne.
const valeursDe = (brut) => (Array.isArray(brut.values) ? brut.values.filter((v) => typeof v === 'string' && v).slice(0, 8) : []);

// La mesure d'une forme à catégories : une seule colonne sans réglage de série → `measure` (comme une tuile de Grist BI) ; plusieurs, ou une couleur ou un type posés → `measures`.
function poserMesures(definition, brut, valeurs) {
  const series = seriesDe(brut, valeurs);
  const reglee = series.some((s) => s.color || s.type);
  if (series.length === 1 && !reglee) definition.measure = series[0].column;
  else if (series.length) definition.measures = series;
}

// Le nuage de points : l'étiquette est l'abscisse (la colonne X), chaque colonne de valeurs un nuage. Une colonne → `measureY` ; plusieurs → `measures` (les Y), `measure` restant le X.
function poserNuage(definition, brut, valeurs) {
  definition.measure = brut.label;
  const series = seriesDe(brut, valeurs);
  if (series.length === 1 && !series[0].color) definition.measureY = series[0].column;
  else if (series.length) definition.measures = series;
}

// Traduit un objet v1 déjà vérifié en tuile. La table n'en fait pas partie.
function traduire(brut, valeurs) {
  const forme = brut.kind;
  const definition = { type: TYPE_DE_FORME[forme], dimension: brut.label };
  if (PARTS.includes(forme)) {
    definition.aggFn = valeurs.length ? 'sum' : 'count';
    if (valeurs.length) definition.measure = valeurs[0];
    if (forme === 'donut') definition.donut = true;
  } else if (forme === 'scatter') {
    delete definition.dimension;
    definition.aggFn = 'none';
    poserNuage(definition, brut, valeurs);
  } else {
    definition.aggFn = 'none';
    poserMesures(definition, brut, valeurs);
    if (forme === 'radar') definition.radarAxisMode = 'dimension';
    if (forme === 'waterfall' && brut.total === true) definition.total = true;
  }
  if (forme === 'line' || forme === 'area') definition.sortMode = 'axis';
  if (forme === 'area') definition.areaFill = true;
  if (brut.stack === true && (forme === 'bar' || forme === 'area')) definition.stacked = true;
  if (brut.horizontal === true && forme === 'bar') definition.horizontal = true;
  if (brut.labels === true) definition.valueLabels = true;
  if (typeof brut.title === 'string' && brut.title.trim()) definition.title = brut.title.trim();
  if (possede(brut, 'palette')) definition.palette = paletteDe(brut.palette);
  return definition;
}

// Lit une définition v1 de Publipostage+ (un objet, ou le texte JSON de son attribut `data-chart-spec`) et rend `{ ok: true, definition, table, ignores }` (`table` = celle que la v1 nommait, que l'hôte
// résout) ou `{ ok: false, raison }` : `invalide`, `version` (une v1 écrite par une version plus récente), `forme` (forme inconnue), `jauge` (voir l'en-tête), et les raisons de `lireDefinition`.
export function lireV1(brut) {
  let spec = brut;
  if (typeof brut === 'string') {
    if (!brut || brut.length > MAX_TEXTE_V1) return { ok: false, raison: 'invalide' };
    try { spec = JSON.parse(brut); } catch (erreur) { return { ok: false, raison: 'invalide' }; }
  }
  if (!estObjet(spec) || typeof spec.label !== 'string' || !spec.label || typeof spec.table !== 'string' || !spec.table) return { ok: false, raison: 'invalide' };
  if (possede(spec, 'v') && spec.v !== 1) return { ok: false, raison: typeof spec.v === 'number' && spec.v > 1 ? 'version' : 'invalide' };
  if (!FORMES_V1.includes(spec.kind)) return { ok: false, raison: 'forme' };
  if (spec.kind === 'gauge') return { ok: false, raison: 'jauge' };
  const lue = lireDefinition(traduire(spec, valeursDe(spec)));
  return lue.ok ? { ok: true, definition: lue.definition, table: spec.table, ignores: lue.ignores } : lue;
}
