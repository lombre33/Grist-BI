// L'option ECharts d'un camembert ou d'un anneau, comme celle de Grist BI (js/charts.js) : un cercle plein de rayon 65 %, un anneau de 40 à 65 %, le trait d'étiquette court (ECharts 6 l'a doublé et tronquait
// les noms), et, avec `showPct`, le nom puis la part sur DEUX lignes (une seule ligne était tronquée par des points de suspension et la part disparaissait).
import { nomDeCategorie } from './textes.js';

// `points` : [{ dimension, value }] déjà triés. `contexte` : { formateurs, palette, langue }.
export function optionSecteurs(definition, points, contexte) {
  const formateur = contexte.formateurs[0];
  return {
    color: contexte.palette,
    tooltip: { trigger: 'item', valueFormatter: (v) => formateur.format(v) || '–' },
    series: [{
      type: 'pie',
      radius: definition.donut ? ['40%', '65%'] : '65%',
      labelLine: { length: 15, length2: 15 },
      ...(definition.showPct ? { percentPrecision: 1, label: { formatter: (p) => `${p.name}\n${formateur.percent(p.percent)}` } } : {}),
      data: points.map((p) => ({ name: nomDeCategorie(p.dimension, contexte.langue), value: p.value })),
    }],
  };
}
