// Les palettes de couleurs d'un graphique. Mêmes teintes que celles de Grist BI (`js/data.js:PALETTES`, comparées par l'essai) : `standard` est la palette d'origine du tableau de bord et ne change jamais ;
// `okabe` est conçue pour le daltonisme ; `blue`, `orange`, `green`, `gray` sont des dégradés d'UNE teinte, du plus foncé au plus clair, pour des catégories ordonnées.
// Les noms que Publipostage+ accepte (19/11/2026) : `grist` (= standard) et `grist-<nom>` ; les noms nus de Grist BI (`okabe`, `blue`…) sont lus aussi. Un nom inconnu retombe sur `standard` : jamais un graphique sans couleur.
export const PALETTES = {
  standard: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  okabe: ['#0072b2', '#d55e00', '#009e73', '#e69f00', '#cc79a7', '#56b4e9'],
  blue: ['#002f63', '#004285', '#0856a6', '#236cc1', '#3f83d7', '#5d9be9', '#7db2f6'],
  orange: ['#511f00', '#6e2e01', '#8d3e03', '#ae4d05', '#d05e07', '#e47a3e', '#f49867'],
  green: ['#003c17', '#025222', '#04692e', '#04813a', '#2b974e', '#51ac69', '#75c186'],
  gray: ['#303030', '#434343', '#575757', '#6c6c6c', '#828282', '#989898', '#afafaf'],
};

const possede = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);

// Le nom de palette sans son préfixe : `grist` -> `standard`, `grist-okabe` -> `okabe`, `okabe` -> `okabe`.
function nomNu(nom) {
  if (typeof nom !== 'string') return 'standard';
  if (nom === 'grist') return 'standard';
  return nom.startsWith('grist-') ? nom.slice(6) : nom;
}

export function couleursDePalette(nom) {
  const nu = nomNu(nom);
  return possede(PALETTES, nu) ? PALETTES[nu] : PALETTES.standard;
}
