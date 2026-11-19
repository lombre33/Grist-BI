// La lecture d'un rapport de Grist BI, tel que l'hôte le trouve dans la table `BI_Dashboard_Config` (colonne `ConfigJSON`, un texte) : pages, tuiles, et pour chaque tuile sa définition ou la raison pour
// laquelle elle est grisée. C'est la SEULE lecture de ce texte hors de Grist BI : il a trois formes historiques (un tableau de tuiles, `{ tiles }`, puis `{ pages, currentPageId }`) et une autre app ne doit pas
// les relire. Le texte est NON FIABLE (la ligne a pu être écrite par une autre personne du document) : il est analysé, jamais exécuté, aucun objet reçu n'est copié tel quel, les identifiants sont ramenés à
// `[A-Za-z0-9_-]` et uniques, les tailles bornées. Un changement de forme de `ConfigJSON` (ou de la table, ou d'une de ses colonnes) se dit à GFS dans « Changements qui touchent GFS » : ce fichier fait foi.
import { lireDefinition } from './definition.js';
import { dependancesDeDefinition } from './colonnes.js';

const MAX_CONFIG = 4000000;     // caractères du texte de configuration
const MAX_PAGES = 50;
const MAX_TUILES = 300;         // tuiles de tout le rapport, pages confondues
const MAX_NOM = 120;
const MAX_TABLE = 200;
const DISPOSITION = /^[a-z][a-z0-9-]{0,31}$/;
const INTERDITS = /[^A-Za-z0-9_-]/g;

const estObjet = (valeur) => valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur);
const nomDe = (valeur, repli) => (typeof valeur === 'string' && valeur.trim() ? valeur.trim().slice(0, MAX_NOM) : repli);

// Un identifiant sûr et unique dans `pris` : le texte ou le nombre reçu avec les caractères interdits remplacés, `base` s'il n'y a rien, un suffixe `_2`, `_3`… s'il est déjà pris.
function identifiantUnique(brut, base, pris) {
  let id = (typeof brut === 'string' || typeof brut === 'number') ? String(brut).replace(INTERDITS, '_') : '';
  if (!id) id = base;
  if (pris.has(id)) {
    let n = 2;
    while (pris.has(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }
  pris.add(id);
  return id;
}

// Les pages brutes d'un `ConfigJSON` lu, quelle que soit sa forme historique : `{ pages: [{ id?, name?, layout?, tiles }], currentPageId? }`. Les deux formes d'avant les pages n'ont qu'une page,
// que Grist BI nomme `page_default` / « Page 1 » : même identifiant ici, pour qu'un rapport relu par l'hôte et par Grist BI désigne la même page.
const PAGE_UNIQUE = (tuiles) => ({ id: 'page_default', name: 'Page 1', tiles: tuiles });
function pagesBrutes(brut) {
  if (Array.isArray(brut)) return { pages: [PAGE_UNIQUE(brut)], courante: null, jointure: false };
  if (!estObjet(brut)) return { pages: [PAGE_UNIQUE([])], courante: null, jointure: false };
  const jointure = !!brut.blend;
  const lues = Array.isArray(brut.pages) ? brut.pages.filter(estObjet) : [];
  if (lues.length) return { pages: lues, courante: brut.currentPageId, jointure };
  return { pages: [PAGE_UNIQUE(Array.isArray(brut.tiles) ? brut.tiles : [])], courante: null, jointure };
}

// Une tuile : sa définition lue, grisée si elle dépend d'une autre table (jointure) ou si elle est refusée (forme ou version à venir, agrégat inconnu…). Une grisée garde sa raison, jamais un dessin faux.
function lireTuile(brute, id) {
  const lue = lireDefinition(brute);
  if (!lue.ok) return { id, definition: null, grisee: lue.champ === undefined ? { raison: lue.raison } : { raison: lue.raison, champ: lue.champ } };
  const { jointures } = dependancesDeDefinition(lue.definition);
  if (jointures.length) return { id, definition: lue.definition, grisee: { raison: 'jointure', colonnes: jointures } };
  return { id, definition: lue.definition, grisee: null };
}

// Les pages lues avec leurs tuiles : au plus 50 pages et 300 tuiles (`tronque` le dit), identifiants uniques dans tout le rapport.
function lirePages(brutes) {
  const idsPages = new Set();
  const idsTuiles = new Set();
  const correspondance = new Map();
  let nombre = 0;
  let tronque = brutes.length > MAX_PAGES;
  const pages = brutes.slice(0, MAX_PAGES).map((page, rang) => {
    const id = identifiantUnique(page.id, 'page', idsPages);
    if (page.id !== undefined && !correspondance.has(page.id)) correspondance.set(page.id, id);
    const tuilesBrutes = Array.isArray(page.tiles) ? page.tiles : [];
    const gardees = tuilesBrutes.slice(0, Math.max(0, MAX_TUILES - nombre));
    if (gardees.length < tuilesBrutes.length) tronque = true;
    nombre += gardees.length;
    const tuiles = gardees.map((tuile) => lireTuile(tuile, identifiantUnique(estObjet(tuile) ? tuile.id : undefined, 'tile', idsTuiles)));
    const resultat = { id, nom: nomDe(page.name, `Page ${rang + 1}`), tuiles };
    if (typeof page.layout === 'string' && DISPOSITION.test(page.layout) && page.layout !== 'grid') resultat.disposition = page.layout;
    return resultat;
  });
  return { pages, correspondance, tronque };
}

// Lit une ligne de rapport `{ id?, table?, config }` (celle que l'hôte lit dans `BI_Dashboard_Config` : `config` est le texte NON LU de `ConfigJSON`). Rend
// `{ ok: true, table, pages: [{ id, nom, disposition?, tuiles: [{ id, definition, grisee }] }], pageCourante, jointure, tronque }` ou `{ ok: false, raison }` (`invalide`, `taille`, `json`).
// `grisee` vaut `null` pour une tuile qui se dessine, sinon `{ raison, champ?, colonnes? }` ; `jointure` dit que le rapport a une jointure de tables configurée (celle-ci n'est pas lue).
export function lireRapport(ligne) {
  const texte = typeof ligne === 'string' ? ligne : (estObjet(ligne) ? ligne.config : undefined);
  if (typeof texte !== 'string' || !texte.trim()) return { ok: false, raison: 'invalide' };
  if (texte.length > MAX_CONFIG) return { ok: false, raison: 'taille' };
  let brut;
  try { brut = JSON.parse(texte); } catch (erreur) { return { ok: false, raison: 'json' }; }
  const { pages: brutes, courante, jointure } = pagesBrutes(brut);
  const { pages, correspondance, tronque } = lirePages(brutes);
  const table = estObjet(ligne) && typeof ligne.table === 'string' && ligne.table && ligne.table.length <= MAX_TABLE ? ligne.table : null;
  const pageCourante = (correspondance.get(courante) || (pages[0] && pages[0].id)) || null;
  return { ok: true, table, pages, pageCourante, jointure, tronque };
}
