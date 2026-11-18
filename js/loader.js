/*
 * Chargeur unique de code (audit `gwaudit`, axe C, règles C-EXFIL-05 et C-EXFIL-06, 18/11/2026).
 *
 * Avant ce fichier, huit endroits du widget chargeaient du code à l'exécution, chacun à sa façon :
 * quatre `createElement('script')` (ExcelJS, PptxGenJS, pdf.js, les extensions de GFS) et quatre
 * `import()` d'un module dont l'adresse était calculée (le kit de GFS, DuckDB-WASM). Un code qui se
 * charge ne se lisait donc nulle part en entier, et chaque site avait ses propres vérifications.
 * Désormais deux portes, et rien d'autre :
 *
 *  1. `GristBI.loader.module(nom)` — un module ES. Les modules que le widget peut charger sont écrits
 *     UNE FOIS, en chemins littéraux (`import('../kit/js/dialogs.js')`), dans `js/modules.js`, que
 *     `index.html` déclare en `<script type="module">`. Pourquoi pas un `import()` littéral dans
 *     chaque fichier : dans le cadre isolé de GFS (`sandbox="allow-scripts"`, origine opaque) un
 *     `import()` écrit dans un SCRIPT CLASSIQUE n'a pas d'adresse de base (« The base URL is about:blank
 *     because import() is called from a CORS-cross-origin script », mesuré dans Chromium) ; écrit dans
 *     un MODULE, il se résout normalement. `modules.js` s'enregistre ici (`register`), les appelants
 *     demandent par nom : un nom inconnu est refusé, aucune adresse n'est jamais construite.
 *  2. `GristBI.loader.script({ src, integrity?, module?, hosts?, referrer? })` — un fichier de code par
 *     élément `<script>`. C'est le SEUL `createElement('script')` du dépôt. Il refuse avant de
 *     charger : une adresse qui n'est pas `https:` (sauf celle de la page elle-même, ou une adresse
 *     de la machine locale), qui porte un identifiant ou un mot de passe, un hôte hors de la liste
 *     `hosts` quand l'appelant en donne une, et TOUT fichier d'un autre site que la page sans
 *     empreinte `integrity` bien formée (sha256/384/512 en base 64) — l'empreinte est posée sur
 *     l'élément, le navigateur refuse alors un fichier modifié.
 *
 * Ce fichier ne CONNAÎT aucune bibliothèque : chaque appelant garde son adresse et son empreinte (la
 * liste lisible est dans le README, « Ce que le widget charge à la demande »). Pur et testable sous
 * Node (`planScript`) ; la création de l'élément ne s'exécute que dans un navigateur.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const api = factory(null);
    api.create = factory; // pour les essais : un chargeur branché sur un faux document
    module.exports = api;
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.loader = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Une empreinte de ressource (SRI) : l'algorithme, un tiret, le condensat en base 64 de la bonne longueur.
  const INTEGRITY_ITEM = /^(?:sha256-[A-Za-z0-9+/]{43}=|sha384-[A-Za-z0-9+/]{64}|sha512-[A-Za-z0-9+/]{86}==)$/;
  const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  function refused(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  // Empreinte normalisée (« sha384-… sha512-… »), '' si absente ; lève si une valeur est donnée MAL formée
  // (un navigateur ignorerait en silence une empreinte invalide et chargerait quand même).
  function integrityOf(value) {
    if (value === undefined || value === null || value === '') return '';
    const items = String(value).trim().split(/\s+/);
    if (!items.every((item) => INTEGRITY_ITEM.test(item))) {
      throw refused('LOADER_REFUSED', 'Empreinte `integrity` mal formée : le fichier n\'est pas chargé.');
    }
    return items.join(' ');
  }

  /**
   * Ce que le chargeur accepte, sans rien charger : `{ url, integrity, crossOrigin }` ou une erreur
   * `LOADER_REFUSED`. `base` est l'adresse de la page (`document.baseURI`) : un fichier de SON site
   * n'a pas besoin d'empreinte, tout autre site si.
   */
  function planScript(spec, base) {
    if (!spec || typeof spec.src !== 'string' || !spec.src) {
      throw refused('LOADER_REFUSED', 'Aucune adresse de script donnée.');
    }
    let url;
    let page = null;
    try {
      url = new URL(spec.src, base);
      page = base ? new URL(base) : null;
    } catch (e) {
      throw refused('LOADER_REFUSED', 'Adresse de script invalide : ' + spec.src);
    }
    if (url.username || url.password) {
      throw refused('LOADER_REFUSED', 'Une adresse de script ne porte ni identifiant ni mot de passe.');
    }
    // `blob:` prend l'origine de la page qui l'a fabriqué, `data:` et `javascript:` n'ont pas d'adresse à vérifier : aucun n'est une source de code.
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'file:') {
      throw refused('LOADER_REFUSED', 'Un script se charge en https seulement : ' + url.protocol);
    }
    const sameSite = !!page && (page.protocol === 'file:' ? url.protocol === 'file:' : url.origin === page.origin);
    const loopback = LOOPBACK_HOSTS.includes(url.hostname);
    if (!sameSite && url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
      throw refused('LOADER_REFUSED', 'Un script d\'un autre site se charge en https seulement : ' + url.protocol);
    }
    if (!sameSite && Array.isArray(spec.hosts) && !spec.hosts.includes(url.hostname)) {
      throw refused('LOADER_REFUSED', 'Hôte non prévu pour ce script : ' + url.hostname);
    }
    const integrity = integrityOf(spec.integrity);
    if (!sameSite && !integrity && !loopback) {
      throw refused('LOADER_REFUSED', 'Un script d\'un autre site se charge avec une empreinte `integrity` : ' + url.hostname);
    }
    return { url: url.href, integrity, crossOrigin: !!integrity || !sameSite };
  }

  // Le SEUL `createElement('script')` du dépôt. Résout quand le fichier est chargé et exécuté ; rejette
  // avec `LOADER_REFUSED` (refusé avant tout chargement) ou `LOADER_FAILED` (réseau, empreinte, politique).
  function script(spec) {
    return new Promise((resolve, reject) => {
      if (!root || !root.document) { reject(refused('LOADER_FAILED', 'Aucun document : pas de chargement possible.')); return; }
      let plan;
      try {
        plan = planScript(spec, root.document.baseURI);
      } catch (e) {
        reject(e);
        return;
      }
      const el = root.document.createElement('script');
      if (spec.module) el.type = 'module';
      el.src = plan.url;
      if (plan.integrity) el.integrity = plan.integrity;
      if (plan.crossOrigin) el.crossOrigin = 'anonymous';
      if (spec.referrer) el.referrerPolicy = spec.referrer;
      el.onload = () => resolve();
      el.onerror = () => reject(refused('LOADER_FAILED', 'Le navigateur n\'a pas chargé le script : ' + plan.url));
      root.document.head.appendChild(el);
    });
  }

  // --- Modules ES --------------------------------------------------------------------------------
  // `js/modules.js` (un `<script type="module">`, différé) dépose ici sa table { nom: () => import('chemin littéral') }.
  // Les scripts différés s'exécutent AVANT `DOMContentLoaded` : si la table n'est pas là à ce moment-là, le module
  // ES n'a pas pu se charger (page ouverte en `file://`, fichier absent) et chaque demande échoue tout de suite,
  // au lieu d'attendre pour toujours — les appelants ont tous un repli.
  let table = null;
  let settle = null;
  const tableReady = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  tableReady.catch(() => {}); // un rejet que personne n'attend n'est pas une erreur non gérée

  function register(entries) {
    if (table) return; // une seule fois : la table de `js/modules.js` ne se remplace pas
    table = Object.freeze(Object.assign(Object.create(null), entries));
    settle.resolve(table);
  }

  function giveUpIfMissing() {
    if (!table) settle.reject(refused('LOADER_FAILED', 'js/modules.js ne s\'est pas chargé (module ES refusé ou absent).'));
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => setTimeout(giveUpIfMissing, 0));
    } else {
      setTimeout(giveUpIfMissing, 0);
    }
  } else {
    settle.reject(refused('LOADER_FAILED', 'Aucun document : pas de module ES.'));
  }

  // Le module ES de ce nom (l'objet que `import()` rend), ou une erreur : nom inconnu, fichier absent.
  function moduleByName(name) {
    return tableReady.then((entries) => {
      const load = entries[name];
      if (typeof load !== 'function') throw refused('LOADER_REFUSED', 'Module non prévu : ' + String(name));
      return load();
    });
  }

  return { planScript, integrityOf, script, register, module: moduleByName };
});
