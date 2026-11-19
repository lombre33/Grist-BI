// L'option ECharts des barres, de la courbe et de l'aire, à partir des séries calculées (serie.js). Même construction que `renderChart` de Grist BI (js/charts.js) pour ces trois formes, que l'essai compare
// pixel par pixel : axe de catégories, axe de valeurs au libellé compact, infobulle d'axe au format complet, légende défilante dès qu'il y a plusieurs séries, barres horizontales (catégories de haut en bas),
// empilé (infobulle avec le total), courbe lissée ou en escalier, aire (plus opaque quand elle est empilée).
import { echapper, nomDeCategorie, texte } from './textes.js';

const GRILLE = { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 };

// Empilé : seulement avec plusieurs séries, et pour les barres ou l'AIRE (une courbe sans remplissage empilée serait une courbe cumulée, un autre graphique).
export function estEmpile(definition, calcul) {
  if (!definition.stacked || calcul.series.length < 2) return false;
  return definition.type === 'bar' || (definition.type === 'line' && !!definition.areaFill);
}

// Les couleurs de séries : celles de la palette dans l'ordre ; la couleur d'une mesure (`measures[].color`) prend la place de sa série.
function couleurs(calcul, palette) {
  if (!calcul.series.some((s) => s.couleur)) return palette;
  return calcul.series.map((s, i) => s.couleur || palette[i % palette.length]);
}

// L'infobulle d'une pile : une ligne par série puis le TOTAL de la catégorie, la seule chose qu'on ne lit pas sur la hauteur d'une pile. Les noms sont des données de la table : échappés.
function infobulleEmpilee(formateur, langue) {
  return {
    trigger: 'axis',
    formatter: (parametres) => {
      const liste = Array.isArray(parametres) ? parametres : [parametres];
      if (!liste.length) return '';
      let somme = 0;
      const lignes = liste.map((p) => {
        const v = Number(p.value);
        if (Number.isFinite(v)) somme += v;
        return `${p.marker}${echapper(p.seriesName)} : ${Number.isFinite(v) ? formateur.format(v) : '–'}`;
      });
      const tete = echapper(liste[0].axisValueLabel != null ? liste[0].axisValueLabel : liste[0].name);
      return `${tete}<br/>${lignes.join('<br/>')}<br/><b>${echapper(texte(langue, 'total'))} : ${formateur.format(somme)}</b>`;
    },
  };
}

function formeDeCourbe(definition) {
  if (definition.type !== 'line') return {};
  if (definition.lineShape === 'smooth') return { smooth: 0.35 };
  return definition.lineShape === 'step' ? { step: 'middle' } : {};
}

// Une série ECharts. Une courbe d'un graphique en barres (mesure de type « courbe ») n'est ni empilée ni remplie. Une valeur absente d'une pile vaut 0 : ECharts empile sur la valeur de la série du dessous,
// et un `null` y romprait la bande de TOUTES les séries au-dessus.
function serieEcharts(definition, serie, empile, formateur) {
  const base = definition.type === 'line' ? 'line' : 'bar';
  const type = serie.type || base;
  const sortie = { type, name: serie.name, data: serie.values.map((v) => (empile && v === null ? 0 : v)) };
  if (formateur) sortie.tooltip = { valueFormatter: (v) => formateur.format(v) || '–' };
  if (type === 'line') {
    Object.assign(sortie, { symbolSize: 8 }, definition.type === 'line' ? formeDeCourbe(definition) : {});
    if (definition.type === 'line' && definition.areaFill) sortie.areaStyle = { opacity: empile ? 0.65 : 0.25 };
  }
  if (empile && type === base) sortie.stack = 'total';
  return sortie;
}

// `contexte` : { formateurs: [un par mesure], palette, langue }. Rend l'option, pas encore habillée du thème (habillage.js).
export function optionCartesienne(definition, calcul, contexte) {
  const formateur = contexte.formateurs[0];
  const plusieurs = calcul.series.length > 1;
  const empile = estEmpile(definition, calcul);
  const noms = calcul.categories.map((c) => nomDeCategorie(c, contexte.langue));
  const valeurs = { type: 'value', axisLabel: { formatter: formateur.axis } };
  const horizontal = definition.type === 'bar' && !!definition.horizontal;
  const categories = horizontal
    ? { type: 'category', inverse: true, data: noms, axisLabel: { width: 110, overflow: 'truncate' } }
    : { type: 'category', data: noms };
  const parMesure = contexte.formateurs.length > 1;
  return {
    color: couleurs(calcul, contexte.palette),
    grid: plusieurs ? { ...GRILLE, top: 40 } : GRILLE,
    legend: plusieurs ? { top: 0, type: 'scroll' } : undefined,
    tooltip: empile ? infobulleEmpilee(formateur, contexte.langue) : { trigger: 'axis', valueFormatter: (v) => formateur.format(v) || '–' },
    ...(horizontal ? { xAxis: valeurs, yAxis: categories } : { xAxis: categories, yAxis: valeurs }),
    series: calcul.series.map((serie, i) => serieEcharts(definition, serie, empile, parMesure ? contexte.formateurs[i] : null)),
  };
}
