/*
 * Extensions de GFS (consigne 019, 18/11/2026) : ce que cette app reçoit de GFS quand la personne
 * a ajouté une extension de Grist-BI dans « Apps et extensions » — aujourd'hui « Nuage de mots »
 * (`nuage-de-mots`, bibliothèque d3-cloud) ; « Mots-clés des PDF » (`mots-cles-pdf`, pdf.js) est
 * déclarée ici pour le même état, mais son chargement reste dans js/pdf-text.js.
 *
 * Ce fichier ne garde AUCUNE bibliothèque (ni liste, ni import map, ni adresse de CDN : règle 9 du
 * guide des apps) : il lit ce que `GfsLink.library(id)` rend (`{ src, integrite, forme: 'module' }`,
 * ou `null` quand l'extension n'est pas ajoutée), charge `src` par `<script type="module"
 * integrity crossorigin="anonymous">` (jamais `import()`) et lit le module que le fichier pose
 * lui-même dans `globalThis.GfsPaquets[<paquet>].modules[<module>]`.
 *
 * Trois états par extension, dits par `stateOf` :
 *   - `active`     : GFS héberge l'app ET la bibliothèque est donnée ;
 *   - `inactive`   : GFS héberge l'app, la personne n'a pas ajouté l'extension (un clic appelle
 *                    `GfsLink.install`, qui ouvre la fenêtre « Apps et extensions » sur sa ligne) ;
 *   - `standalone` : l'app tourne seule (ou le kit n'a pas chargé) : un clic ouvre la fenêtre du
 *                    grisé du guide (section 5), jamais un échec silencieux.
 * Une fonction d'extension est GRISÉE, jamais masquée (consigne 019, point 4).
 *
 * `attach(promesse)` reçoit la promesse du lien de js/main.js (jamais rejetée : `null` hors GFS) ;
 * tout le reste est pur ou ne lit que le lien reçu, donc testable sous Node avec un faux lien.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  // id d'extension -> la bibliothèque de GFS qui la porte et le module que son fichier pose.
  const EXTENSIONS = {
    'nuage-de-mots': { library: 'd3-cloud', pkg: 'd3-cloud', moduleKey: 'd3-cloud' },
    'mots-cles-pdf': { library: 'pdfjs', pkg: 'pdfjs', moduleKey: 'pdfjs-dist/build/pdf.min.mjs' }
  };

  let link = null; // le lien du kit, une fois résolu ; null seule ou tant qu'il n'est pas prêt
  let attached = Promise.resolve(null);
  const listeners = new Set();

  function notify() {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch (e) { console.warn('[GristBI] abonné aux extensions en échec', e); }
    }
  }

  // Pure : état d'une extension d'après un lien (ou null).
  function stateFor(theLink, extensionId) {
    const def = EXTENSIONS[extensionId];
    if (!def || !theLink || !theLink.hosted) return 'standalone';
    const source = theLink.library(def.library);
    return source && source.src && source.integrite ? 'active' : 'inactive';
  }

  // Pure : le module déjà posé par GFS dans `scope.GfsPaquets`, ou null. Relu à chaque appel.
  function moduleFrom(scope, extensionId) {
    const def = EXTENSIONS[extensionId];
    const set = def && scope && scope.GfsPaquets && scope.GfsPaquets[def.pkg];
    return (set && set.modules && set.modules[def.moduleKey]) || null;
  }

  function stateOf(extensionId) { return stateFor(link, extensionId); }

  // Rend le module de l'extension, ou null (extension absente, fichier refusé : un `console.warn`,
  // jamais une exception qui remonterait jusqu'au rendu d'une tuile). Une réponse « absente » n'est
  // JAMAIS gardée : l'extension peut être ajoutée pendant que l'app est ouverte.
  const loading = new Map();
  async function load(extensionId) {
    await attached;
    // D'abord l'état : une extension RETIRÉE pendant que l'app est ouverte reste en mémoire (son fichier est déjà chargé), mais n'est
    // plus donnée par GFS — la fonction se grise comme au démarrage suivant, jamais à moitié.
    if (stateOf(extensionId) !== 'active') return null;
    const ready = moduleFrom(globalThis, extensionId);
    if (ready) return ready;
    const def = EXTENSIONS[extensionId];
    const source = link.library(def.library);
    if (!loading.has(extensionId)) {
      // Chargeur unique (js/loader.js) : module ES, empreinte posée sur l'élément, https seulement hors du site de la page.
      const p = GristBI.loader.script({ src: source.src, integrity: source.integrite, module: true }).then(() => {
        const mod = moduleFrom(globalThis, extensionId);
        if (!mod) console.warn(`[GristBI] ${def.library} : le fichier est chargé mais ne pose pas GfsPaquets.${def.pkg}`);
        return mod;
      }, () => {
        console.warn(`[GristBI] ${def.library} : le navigateur a refusé le script (politique de sécurité, réseau, empreinte ou adresse)`);
        return null;
      });
      loading.set(extensionId, p);
      p.then(() => loading.delete(extensionId));
    }
    return loading.get(extensionId);
  }

  // Un clic sur une fonction grisée. Hébergée : la fenêtre « Apps et extensions » de GFS s'ouvre sur
  // la ligne de l'extension (`GfsLink.install`), qui rend les extensions actives après le choix de la
  // personne ; l'événement `extensions` suit, et `onChange` repeint. Seule : la fenêtre du grisé
  // (guide des apps, section 5), que l'appelant montre (`'standalone'` rendu ici).
  async function requestInstall(extensionId) {
    const state = stateOf(extensionId);
    if (state !== 'inactive') return state;
    try { await link.install(extensionId); } catch (e) { console.warn('[GristBI] installation de l\'extension refusée ou annulée', e); }
    return 'inactive';
  }

  // `promesse` : celle de js/main.js (le lien du kit, ou null). On attend aussi que GFS ait répondu
  // (`link.ready`) : avant, `library()` est vide et toute extension paraîtrait « pas encore ».
  function attach(promesse) {
    attached = Promise.resolve(promesse).then(async (theLink) => {
      link = theLink || null;
      if (link && link.ready) { try { await link.ready; } catch (e) { /* GFS muet : la suite le dira */ } }
      // Seule, rien ne peut changer (tout reste `standalone`) : aucun abonné à réveiller.
      if (link && link.hosted) { link.onExtensions(notify); notify(); }
      return link;
    }).catch(() => null);
    return attached;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = { EXTENSIONS, stateFor, moduleFrom, stateOf, load, requestInstall, attach, onChange };
  GristBI.extensions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
