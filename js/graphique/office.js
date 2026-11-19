// Le modèle neutre qu'un hôte transforme en graphique Word, PowerPoint ou Excel : les catégories, les séries et leur couleur, sans rien d'ECharts. Il sort du MÊME plan que le dessin (mêmes catégories, même
// ordre, mêmes séries) : le graphique Office et l'aperçu ne peuvent pas se contredire. `format.nombre` est le code de format d'Excel écrit tel quel (jamais tronqué), absent quand le réglage n'a pas
// d'équivalent (Automatique, compact, scientifique) : l'hôte garde alors le sien.
import { SANS_OFFICE, preparer } from './plan.js';
import { estEmpile } from './option-cartesien.js';
import { formatOffice } from './nombres.js';
import { nomDeCategorie } from './textes.js';

function typeOffice(definition) {
  if (definition.type === 'pie') return definition.donut ? 'donut' : 'pie';
  if (definition.type === 'line') return definition.areaFill ? 'area' : 'line';
  return 'bar';
}

function seriesDuModele(plan, type) {
  const couleurs = plan.palette;
  if (type === 'pie' || type === 'donut') {
    // Un secteur par catégorie : une seule série, une couleur par secteur (`couleurs`, dans l'ordre des catégories).
    const valeurs = plan.calcul.points.map((p) => p.value);
    return [{ nom: plan.definition.measure || '', valeurs, couleur: couleurs[0], couleurs: valeurs.map((_, i) => couleurs[i % couleurs.length]) }];
  }
  const base = plan.definition.type === 'line' ? 'line' : 'bar';
  return plan.calcul.series.map((serie, i) => {
    const sortie = { nom: serie.name, valeurs: serie.values, couleur: serie.couleur || couleurs[i % couleurs.length] };
    if (serie.type && serie.type !== base) sortie.trace = serie.type;
    return sortie;
  });
}

// Le modèle Office d'une définition et d'une source. `{ ok: true, modele, nonDessines?, echantillon? }` ou le refus du plan ; `image-seule` quand la forme n'a pas d'équivalent Office.
export function modeleOffice(definition, source, langue) {
  const plan = preparer(definition, source, langue);
  if (!plan.ok) {
    const type = definition && definition.type;
    return plan.raison === 'dessin' && SANS_OFFICE.includes(type) ? { ok: false, raison: 'image-seule' } : plan;
  }
  const type = typeOffice(plan.definition);
  const modele = {
    type,
    categories: plan.calcul.categories.map((c) => nomDeCategorie(c, langue)),
    series: seriesDuModele(plan, type),
  };
  if (plan.definition.title) modele.titre = plan.definition.title;
  if (type !== 'pie' && type !== 'donut' && estEmpile(plan.definition, plan.calcul)) modele.empile = true;
  if (plan.definition.type === 'bar' && plan.definition.horizontal) modele.horizontal = true;
  const code = formatOffice(plan.formateurs[0].style);
  if (code) modele.format = { nombre: code };
  const sortie = { ok: true, modele, nonDessines: plan.nonDessines };
  if (plan.echantillon) sortie.echantillon = plan.echantillon;
  return sortie;
}
