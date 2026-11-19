// Ce que l'hôte appelle : `creerGraphique({ echarts, langue, theme })` rend `{ formes, monter, image, modeleOffice }`. ECharts, la langue et le thème viennent de l'hôte ; le module ne lit ni la page, ni Grist, ni le CSS.
//  - `monter(element, { definition, source })` -> `{ ok, vue }` : dessine dans `element` ; la vue sait `mettre`, `surMarque`, `redimensionner`, `image`, `modeleOffice`, `detruire`.
//  - `image(definition, source, { largeur, hauteur, ratio, element, theme?, langue? })` -> `{ ok, url, largeur, hauteur, ratio }` : le PNG, dessiné dans un élément DÉTACHÉ que l'hôte donne, jamais gardé.
//  - `modeleOffice(definition, source, { langue? })` -> `{ ok, modele }` : le modèle neutre d'un graphique Word, PowerPoint ou Excel.
// Un refus a toujours la forme `{ ok: false, raison }` avec un code stable (`dessin`, `invalide`, `v1`, `colonne`, `moteur`, `vide`, `volume`, `element`) : l'hôte grise avec son texte, le module n'écrit pas de message.
import { FORMES_DESSINEES, preparer, rangsDeLaMarque } from './plan.js';
import { construireOption } from './option.js';
import { modeleOffice } from './office.js';
import { THEME_CLAIR, themeComplet } from './habillage.js';

const LANGUES = ['fr', 'en'];
const TAILLE = { largeur: 480, hauteur: 300, ratio: 2, min: 16, max: 4000, ratioMax: 4, surface: 40e6 };
const langueSure = (langue) => (LANGUES.includes(langue) ? langue : 'fr');
const moteurUtilisable = (echarts) => !!echarts && typeof echarts.init === 'function';
const refus = (raison, details) => ({ ok: false, raison, ...details });
const possede = (objet, cle) => !!objet && Object.prototype.hasOwnProperty.call(objet, cle);

function toilesDe(element) {
  return element && typeof element.querySelectorAll === 'function' ? Array.from(element.querySelectorAll('canvas')) : [];
}

// Libère l'instance et ramène ses toiles à zéro : un navigateur garde la mémoire d'une toile tant que quelqu'un la référence, et 500 images de suite en gardent des centaines de mégaoctets.
function liberer(instance, toiles) {
  try { if (instance && typeof instance.dispose === 'function') instance.dispose(); } catch (erreur) { /* l'instance est déjà perdue */ }
  for (const toile of toiles) { toile.width = 0; toile.height = 0; }
}

// Le PNG d'une instance. `renderToCanvas` rend la toile elle-même (qu'on ramène à zéro après lecture) ; sans lui, `getDataURL`.
function pngDe(instance, ratio, fond, ramener) {
  const options = { pixelRatio: ratio, backgroundColor: fond };
  if (ramener && typeof instance.renderToCanvas === 'function') {
    const toile = instance.renderToCanvas(options);
    const url = toile.toDataURL('image/png');
    toile.width = 0;
    toile.height = 0;
    return url;
  }
  return instance.getDataURL({ type: 'png', ...options });
}

// La taille d'une image demandée : celle de l'hôte, ou les valeurs par défaut ; `null` si elle n'est pas raisonnable (non entière, hors bornes, surface trop grande pour une toile).
function tailleDemandee(options) {
  const lire = (cle, defaut) => (options[cle] === undefined ? defaut : options[cle]);
  const largeur = lire('largeur', TAILLE.largeur);
  const hauteur = lire('hauteur', TAILLE.hauteur);
  const ratio = lire('ratio', TAILLE.ratio);
  const entier = (n) => Number.isInteger(n) && n >= TAILLE.min && n <= TAILLE.max;
  if (!entier(largeur) || !entier(hauteur) || !Number.isFinite(ratio) || ratio < 1 || ratio > TAILLE.ratioMax) return null;
  return largeur * hauteur * ratio * ratio <= TAILLE.surface ? { largeur, hauteur, ratio } : null;
}

// Les mentions d'un plan réussi que l'hôte doit pouvoir lire : ce qui n'est pas dessiné, l'échantillon.
function mentions(plan) {
  const sortie = { nonDessines: plan.nonDessines };
  if (plan.echantillon) sortie.echantillon = plan.echantillon;
  return sortie;
}

// L'image hors écran : dessine dans `element`, lit le PNG, libère. Rien n'est gardé entre deux appels. Un seul dessin à la fois : l'hôte les enchaîne.
function imageHorsEcran(base, definition, source, options) {
  if (!moteurUtilisable(base.echarts)) return refus('moteur');
  const demande = options && typeof options === 'object' ? options : {};
  const taille = tailleDemandee(demande);
  if (!taille) return refus('invalide', { detail: 'taille' });
  if (!demande.element || typeof demande.element !== 'object') return refus('element');
  const theme = themeComplet(demande.theme || THEME_CLAIR);
  const plan = preparer(definition, source, langueSure(demande.langue || base.langue));
  if (!plan.ok) return plan;
  let instance = null;
  let toiles = [];
  try {
    instance = base.echarts.init(demande.element, null, { renderer: 'canvas', width: taille.largeur, height: taille.hauteur, devicePixelRatio: taille.ratio });
    instance.setOption(construireOption(plan, { theme, largeur: taille.largeur, animer: false }), true);
    toiles = toilesDe(demande.element);
    return { ok: true, url: pngDe(instance, taille.ratio, theme.fond, true), ...taille, ...mentions(plan) };
  } catch (erreur) {
    return refus('moteur', { detail: String(erreur && erreur.message) });
  } finally {
    liberer(instance, toiles);
  }
}

// --- La vue montée dans un élément ---------------------------------------------------------------------------------------

// Les entrées d'une vue, pour savoir si un `mettre` change quelque chose : comparées par RÉFÉRENCE, jamais par contenu (une grande source ne se compare pas à chaque appel). Quand les lignes changent,
// l'hôte passe un nouveau tableau.
function entrees(etat) {
  const source = etat.source || {};
  return [etat.definition, etat.source, source.lignes, source.colonnes, source.reglages, etat.themeBrut, etat.langue];
}
const memesEntrees = (a, b) => a.length === b.length && a.every((valeur, i) => valeur === b[i]);

function reponseDe(plan) {
  return plan.ok ? { ok: true, ...mentions(plan) } : plan;
}

// Dessine (ou redessine) l'état courant. Un refus efface le graphique : un ancien dessin ne reste jamais sous un nouveau refus.
function dessiner(etat) {
  const plan = preparer(etat.definition, etat.source, etat.langue);
  etat.plan = plan;
  if (!plan.ok) {
    etat.instance.clear();
    return plan;
  }
  etat.largeur = etat.instance.getWidth();
  etat.instance.setOption(construireOption(plan, { theme: etat.theme, largeur: etat.largeur, animer: true }), true);
  return plan;
}

function surClic(etat, params) {
  if (!etat.plan || !etat.plan.ok || params.componentType !== 'series') return;
  const rangs = rangsDeLaMarque(etat.plan, params.dataIndex, params.seriesIndex);
  const marque = { rangs, categorie: etat.plan.calcul.categories[params.dataIndex], valeur: params.value };
  if (etat.plan.definition.seriesColumn) marque.serie = params.seriesName;
  etat.abonnes.slice().forEach((rappel) => rappel(marque));
}

function creerVue(etat) {
  const detruite = () => (etat.instance ? null : refus('invalide', { detail: 'detruite' }));
  return {
    mettre(changements) {
      const gele = detruite();
      if (gele) return gele;
      const avant = entrees(etat);
      const c = changements && typeof changements === 'object' ? changements : {};
      if (possede(c, 'definition')) etat.definition = c.definition;
      if (possede(c, 'source')) etat.source = c.source;
      if (possede(c, 'langue')) etat.langue = langueSure(c.langue);
      if (possede(c, 'theme')) { etat.themeBrut = c.theme; etat.theme = themeComplet(c.theme); }
      return memesEntrees(avant, entrees(etat)) ? reponseDe(etat.plan) : reponseDe(dessiner(etat));
    },
    surMarque(rappel) {
      if (typeof rappel !== 'function') return () => {};
      etat.abonnes.push(rappel);
      return () => { etat.abonnes = etat.abonnes.filter((r) => r !== rappel); };
    },
    redimensionner() {
      const gele = detruite();
      if (gele) return gele;
      etat.instance.resize();
      // La largeur entre dans l'option (largeur d'un nom de catégorie) : un changement de largeur la reconstruit.
      if (etat.plan && etat.plan.ok && etat.instance.getWidth() !== etat.largeur) dessiner(etat);
      return { ok: true };
    },
    image(options) {
      const gele = detruite();
      if (gele) return gele;
      if (!etat.plan || !etat.plan.ok) return etat.plan;
      const ratio = options && Number.isFinite(options.ratio) && options.ratio >= 1 && options.ratio <= TAILLE.ratioMax ? options.ratio : TAILLE.ratio;
      const url = pngDe(etat.instance, ratio, etat.theme.fond, false);
      return { ok: true, url, largeur: etat.instance.getWidth(), hauteur: etat.instance.getHeight(), ratio };
    },
    modeleOffice() {
      return modeleOffice(etat.definition, etat.source, etat.langue);
    },
    detruire() {
      if (!etat.instance) return { ok: true };
      etat.instance.off('click');
      liberer(etat.instance, toilesDe(etat.element));
      Object.assign(etat, { instance: null, plan: null, source: null, definition: null, abonnes: [] });
      return { ok: true };
    },
  };
}

function monter(base, element, parametres) {
  if (!moteurUtilisable(base.echarts)) return refus('moteur');
  if (!element || typeof element !== 'object') return refus('element');
  const p = parametres && typeof parametres === 'object' ? parametres : {};
  const themeBrut = p.theme || base.themeBrut;
  const etat = {
    element, definition: p.definition, source: p.source, langue: langueSure(p.langue || base.langue),
    themeBrut, theme: themeComplet(themeBrut), plan: null, instance: null, abonnes: [], largeur: 0,
  };
  const plan = preparer(etat.definition, etat.source, etat.langue);
  if (!plan.ok) return plan;
  try {
    etat.instance = base.echarts.init(element, null, { renderer: 'canvas' });
    etat.instance.on('click', (params) => surClic(etat, params));
    dessiner(etat);
  } catch (erreur) {
    liberer(etat.instance, toilesDe(element));
    return refus('moteur', { detail: String(erreur && erreur.message) });
  }
  return { ok: true, vue: creerVue(etat), ...mentions(etat.plan) };
}

export function creerGraphique(reglages) {
  const r = reglages && typeof reglages === 'object' ? reglages : {};
  const base = { echarts: r.echarts, langue: langueSure(r.langue), themeBrut: r.theme, theme: themeComplet(r.theme) };
  return {
    formes: FORMES_DESSINEES.slice(),
    monter: (element, parametres) => monter(base, element, parametres),
    image: (definition, source, options) => imageHorsEcran(base, definition, source, options),
    modeleOffice: (definition, source, options) => modeleOffice(definition, source, langueSure((options && options.langue) || base.langue)),
  };
}
