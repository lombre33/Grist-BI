// Les quelques mots que le dessin écrit lui-même (pas ceux de l'hôte) et l'échappement du texte qui passe dans une infobulle. La langue est celle que l'hôte donne : le module ne la devine pas.
// Une langue inconnue retombe sur le français, jamais sur une clé affichée telle quelle.
const TEXTES = {
  fr: { total: 'Total', serieVide: '(vide)', categorieVide: '-' },
  en: { total: 'Total', serieVide: '(empty)', categorieVide: '-' },
};

export function texte(langue, cle) {
  const mots = TEXTES[langue] || TEXTES.fr;
  return mots[cle];
}

// Une valeur de cellule posée dans le HTML d'une infobulle ECharts : jamais telle quelle (un nom de catégorie est une donnée de la table).
export function echapper(valeur) {
  return String(valeur).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Le nom d'une catégorie ou d'une série tel qu'on l'écrit : une catégorie sans valeur est « - », une série sans valeur « (vide) ».
export function nomDeCategorie(valeur, langue) {
  return valeur === null || valeur === undefined || valeur === '' ? texte(langue, 'categorieVide') : String(valeur);
}
export function nomDeSerie(valeur, langue) {
  return valeur === null || valeur === undefined || valeur === '' ? texte(langue, 'serieVide') : String(valeur);
}
