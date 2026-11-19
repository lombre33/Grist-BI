// Le thème de l'hôte posé sur une option ECharts, juste avant de la dessiner : sans lui ECharts dessine tout en gris foncé et en fond clair (infobulle blanche, quadrillage blanc éclatant sur fond sombre,
// contour blanc autour des étiquettes de secteurs). C'est la dernière étape de Grist BI avant `setOption` (`finalizeOption`, js/charts-core.js), sans le style global des tuiles ni le radar.
// Le thème est celui que l'hôte donne : `{ texte, texteDiscret, fond, grille, police? }` en #rrggbb. Le module ne lit pas le CSS. Les réglages que la forme a déjà posés gagnent, jamais l'inverse.
export const THEME_CLAIR = { texte: '#0b0b0b', texteDiscret: '#52514e', fond: '#ffffff', grille: '#e1e0d9' };

// Le thème complété : une couleur manquante ou mal formée est celle du thème clair (un graphique n'a jamais de couleur « undefined »).
export function themeComplet(theme) {
  const sur = (cle) => (theme && typeof theme[cle] === 'string' && /^#[0-9a-f]{6}$/i.test(theme[cle]) ? theme[cle] : THEME_CLAIR[cle]);
  const sortie = { texte: sur('texte'), texteDiscret: sur('texteDiscret'), fond: sur('fond'), grille: sur('grille') };
  if (theme && typeof theme.police === 'string' && /^[\w \-,"']{1,80}$/.test(theme.police)) sortie.police = theme.police;
  return sortie;
}

// Un axe de catégories : peu de catégories gardent chacune leur place (nom tronqué par « … », aucun masqué) ; beaucoup, ECharts n'en montre qu'une sur k avec plus de place. Un axe de valeurs a un nombre
// raisonnable de graduations.
function dimensionnerAxe(axe, label, largeur, reserve) {
  const utile = Math.max(60, largeur - 70 - reserve);
  if (axe.type === 'category' && Array.isArray(axe.data) && axe.data.length && label.width == null) {
    const bande = Math.floor(utile / axe.data.length) - (reserve > 0 ? 3 : 6);
    if (axe.data.length <= 8 && bande >= 28) {
      label.width = Math.min(150, bande);
      if (label.interval == null) label.interval = 0;
    } else {
      label.width = 70;
    }
    label.overflow = 'truncate';
    label.ellipsis = '…';
    return {};
  }
  if (axe.type === 'value' && axe.splitNumber == null) return { splitNumber: Math.max(2, Math.min(6, Math.floor(utile / 64))) };
  return {};
}

function habillerAxe(axe, th, estX, option, largeur) {
  const un = (a) => {
    const label = { color: th.texteDiscret, hideOverlap: true, ...a.axisLabel };
    const sortie = {
      ...a,
      axisLine: { lineStyle: { color: th.texteDiscret }, ...a.axisLine },
      axisTick: { lineStyle: { color: th.texteDiscret }, ...a.axisTick },
      splitLine: { lineStyle: { color: th.grille }, ...a.splitLine },
      axisLabel: label,
    };
    if (estX && largeur) {
      // La marge réservée à droite (libellé d'une ligne de repère) rétrécit d'autant la zone de tracé.
      const droite = option.grid && !Array.isArray(option.grid) ? Number(option.grid.right) : NaN;
      Object.assign(sortie, dimensionnerAxe(a, label, largeur, Number.isFinite(droite) ? Math.max(0, droite - 16) : 0));
    }
    return sortie;
  };
  return Array.isArray(axe) ? axe.map(un) : un(axe);
}

// Habille `option` (modifiée sur place et rendue). `largeur` : celle du graphique en pixels (0 si inconnue).
export function habiller(option, theme, largeur) {
  const th = themeComplet(theme);
  if (th.police) option.textStyle = { fontFamily: th.police, ...option.textStyle };
  if (option.tooltip) {
    option.tooltip = {
      confine: true,
      backgroundColor: th.fond,
      borderColor: th.grille,
      textStyle: { color: th.texte, fontSize: 12 },
      extraCssText: 'max-width: 85%; white-space: normal; overflow-wrap: anywhere;',
      ...option.tooltip,
    };
  }
  if (option.legend) option.legend = { ...option.legend, textStyle: { color: th.texteDiscret, ...option.legend.textStyle } };
  if (option.xAxis) option.xAxis = habillerAxe(option.xAxis, th, true, option, largeur);
  if (option.yAxis) option.yAxis = habillerAxe(option.yAxis, th, false, option, largeur);
  if (Array.isArray(option.series)) {
    option.series = option.series.map((serie) => (serie && serie.type === 'pie'
      ? { ...serie, label: { color: th.texte, textBorderWidth: 0, ...serie.label } }
      : serie));
  }
  return option;
}
