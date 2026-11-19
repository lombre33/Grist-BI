// L'option ECharts complète d'un plan : la forme (barres, courbe, aire, secteurs) puis l'habillage du thème. L'écran et l'image hors écran appellent la même fonction : seule `animer` les distingue
// (une image ne s'anime pas : elle serait prise à mi-course).
import { optionCartesienne } from './option-cartesien.js';
import { optionSecteurs } from './option-secteurs.js';
import { habiller } from './habillage.js';

// `options` : { theme, largeur (pixels, 0 si inconnue), animer }.
export function construireOption(plan, options) {
  const contexte = { formateurs: plan.formateurs, palette: plan.palette, langue: plan.langue };
  const option = plan.definition.type === 'pie'
    ? optionSecteurs(plan.definition, plan.calcul.points, contexte)
    : optionCartesienne(plan.definition, plan.calcul, contexte);
  if (!options.animer) option.animation = false;
  return habiller(option, options.theme, options.largeur || 0);
}
