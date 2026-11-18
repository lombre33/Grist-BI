/*
 * Saisies, confirmations et messages : des fenêtres du kit commun des apps Grist Factory
 * (`kit/js/dialogs.js`) à la place de `window.prompt`, `window.confirm` et `window.alert`.
 *
 * Pourquoi : dans GFS, le widget tourne dans un cadre isolé (`sandbox="allow-scripts"`, sans
 * `allow-modals`) où ces trois fonctions du navigateur ne font RIEN — `prompt()` rend `null`,
 * `confirm()` rend `false`, `alert()` ne montre rien. Un message d'erreur ou une validation y était
 * donc silencieux, et « + Page »/« Sauvegarder la vue » ne faisaient rien (audit UI/UX du
 * 18/11/2026, voir HYPOTHESES.md). Le kit est déjà un sous-module de ce dépôt (consigne GFS 004) ;
 * ce fichier n'en importe que `Dialogs` (et sa feuille `kit/css/windows.css`, liée dans index.html).
 *
 *   GristBI.dialogs.prompt({ title, label?, value?, confirmLabel? }) -> Promise<string | null>
 *     (`null` : annulé ; `''` : champ laissé vide)
 *   GristBI.dialogs.confirm({ title, message?, confirmLabel?, danger? }) -> Promise<boolean>
 *   GristBI.dialogs.notice({ title?, message }) -> Promise<void>
 *
 * Toujours à appeler avec `await` (ou en ignorant la promesse pour un simple message) : la fenêtre
 * n'arrête pas le script comme la boîte du navigateur. Les libellés des boutons viennent de ce
 * widget (`GristBI.i18n`), jamais du kit — celui-ci n'a pas son propre dictionnaire ici.
 *
 * Chargé paresseusement par `GristBI.loader.module('kit-dialogs')` (js/loader.js : le même chargeur pour
 * `Ambiance.start()` dans js/main-core.js et pour js/duckdb-engine.js ; ce widget reste fait de scripts classiques). Si le kit est
 * absent (clone sans `git submodule update --init`) ou ne se charge pas, repli sur les fonctions du
 * navigateur — jamais une saisie perdue ni une exception : hors d'un cadre isolé elles marchent.
 */
(function (global) {
  'use strict';

  const GristBI = global.GristBI || (global.GristBI = {});

  // Le module du kit se demande par son NOM au chargeur unique (js/loader.js, table littérale dans js/modules.js) : aucune
  // adresse n'est construite ici (audit `gwaudit` C-EXFIL-06). Hors d'un navigateur (essais Node) ou sans chargeur : repli.
  let kitPromise = null;

  function loadKit() {
    if (!kitPromise) {
      kitPromise = (GristBI.loader
        ? GristBI.loader.module('kit-dialogs').then((m) => m.Dialogs)
        : Promise.resolve(null)
      ).catch((e) => {
        console.warn('[GristBI] fenêtres du kit indisponibles (kit/ absent ou erreur de chargement) — repli sur les boîtes du navigateur', e);
        return null;
      });
    }
    return kitPromise;
  }

  const t = (key) => (GristBI.i18n ? GristBI.i18n.t(key) : key);

  async function prompt(opts) {
    const Dialogs = await loadKit();
    if (!Dialogs) return global.prompt(opts.label || opts.title, opts.value == null ? '' : opts.value);
    return Dialogs.prompt({
      title: opts.title, label: opts.label, value: opts.value, placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel || t('dialog.confirm'), cancelLabel: t('dialog.cancel')
    });
  }

  async function confirm(opts) {
    const Dialogs = await loadKit();
    if (!Dialogs) return global.confirm(opts.message || opts.title);
    return Dialogs.confirm({
      title: opts.title, message: opts.message,
      confirmLabel: opts.confirmLabel || t('dialog.confirm'), cancelLabel: t('dialog.cancel'), danger: !!opts.danger
    });
  }

  async function notice(opts) {
    const Dialogs = await loadKit();
    if (!Dialogs) { global.alert(opts.message); return; }
    return Dialogs.notice({ title: opts.title || t('dialog.notice.title'), message: opts.message, closeLabel: t('dialog.close') });
  }

  GristBI.dialogs = { prompt, confirm, notice };
})(typeof self !== 'undefined' ? self : this);
