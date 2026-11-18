/*
 * Fenêtre « Mots-clés des publications » (menu Données, mode Édition) : le branchement DOM + Grist de
 * la logique pure de js/publications.js, du RAKE de js/keywords.js et de la lecture de PDF de
 * js/pdf-text.js. Consigne GFS 019 (18/11/2026), demande d'Antoine du 02/11/2026 : des mots-clés
 * saisis à la main ET extraits automatiquement par un algorithme intégré, sans serveur.
 *
 * Ce fichier ne connaît ni le store ni les tuiles : `js/main.js` lui donne `init({ getTableId,
 * reloadTable })` — la table de travail courante et de quoi relire la table après une écriture.
 * L'état de l'extension PDF vient de `GristBI.extensions` (js/extensions.js), comme pour « Nuage de
 * mots » : ni lien avec GFS, ni adresse de bibliothèque ici.
 *
 * Ce que la personne voit, dans l'ordre : la source du texte (le PDF joint, ou une colonne de texte),
 * la colonne qui reçoit les mots-clés (une existante, ou une nouvelle créée après confirmation), une
 * colonne facultative de mots saisis à la main (jamais répétés dans l'automatique), puis « Extraire ».
 * AVANT d'écrire quoi que ce soit, une fenêtre de confirmation dit combien de lignes et dans quelle
 * colonne. Une cellule déjà remplie n'est jamais touchée (voir publications.js:planRows).
 *
 * « Grisé, jamais masqué » (consigne 019, point 4) : sans l'extension `mots-cles-pdf` de GFS, l'option
 * « le PDF joint » reste visible mais grisée avec sa raison ; dans GFS le bouton « Ajouter
 * l'extension » ouvre la fenêtre d'installation (`GristBI.extensions.requestInstall`), hors GFS il ouvre
 * l'explication de la section 5 du guide des apps (la même que « Nuage de mots »). L'option « une colonne de texte » marche partout, sans extension :
 * elle n'a besoin d'aucune bibliothèque.
 *
 * Tout ce qui parle à Grist ici n'a été exercé que contre le faux `window.grist` de dev-tests/ : voir
 * HYPOTHESES.md (jeton de lecture, adresse de téléchargement d'une pièce jointe, `AddColumn`).
 */
(function (global) {
  'use strict';
  if (typeof document === 'undefined') return; // Node : rien à brancher, la logique est dans publications.js

  const GristBI = global.GristBI || (global.GristBI = {});
  const EXTENSION_ID = 'mots-cles-pdf';
  const NEW_COLUMN = '__new__';
  const LOG_LINES = 6;

  let hooks = null;
  let el = null;
  let state = null; // { tableId, columns, choices, table }
  let job = null; // { controller } pendant un travail

  const t = (key, vars) => GristBI.i18n.t(key, vars);

  function byId(id) { return document.getElementById(id); }

  function collectElements() {
    el = {
      openBtn: byId('open-keywords'), modal: byId('keywords-modal'), closeBtn: byId('keywords-close'),
      noTable: byId('keywords-no-table'), body: byId('keywords-body'),
      kindPdf: byId('keywords-kind-pdf'), kindText: byId('keywords-kind-text'), pdfNeeds: byId('keywords-pdf-needs'), pdfAdd: byId('keywords-pdf-add'),
      sourceLabel: byId('keywords-source-label'), source: byId('keywords-source-column'), sourceEmpty: byId('keywords-source-empty'),
      target: byId('keywords-target-column'), manual: byId('keywords-manual-column'), max: byId('keywords-max'), lang: byId('keywords-lang'),
      plan: byId('keywords-plan'), error: byId('keywords-error'), progress: byId('keywords-progress'), status: byId('keywords-status'), log: byId('keywords-log'),
      start: byId('keywords-start'), stop: byId('keywords-stop')
    };
    return Object.values(el).every(Boolean);
  }

  // ---------------------------------------------------------------------------------------------
  // État de l'extension PDF
  // ---------------------------------------------------------------------------------------------

  // Le texte d'un PDF se lit quand GFS donne la bibliothèque : `GristBI.extensions.stateOf` dit `active`
  // (hébergé ET extension ajoutée), `inactive` (hébergé, pas ajoutée) ou `standalone` (app seule).
  function pdfState() { return GristBI.extensions.stateOf(EXTENSION_ID); }
  function pdfAvailable() { return pdfState() === 'active'; }

  // Charge pdf.js (jamais d'exception : `null` si l'extension a été retirée ou si le fichier est refusé).
  async function ensurePdfjs() {
    const mod = await GristBI.extensions.load(EXTENSION_ID);
    if (!mod || !GristBI.pdfText.isAvailable()) throw new Error(t('keywords.error.pdfjsMissing'));
  }

  // ---------------------------------------------------------------------------------------------
  // Remplissage des listes
  // ---------------------------------------------------------------------------------------------

  function kind() { return el.kindText.checked ? 'text' : 'pdf'; }

  function setOptions(select, options, selected) {
    select.innerHTML = '';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.append(opt);
    }
    if (selected != null && options.some((o) => o.value === selected)) select.value = selected;
  }

  const AUTO_NAME = /mots?[-_ ]?cl[eé]s?.*auto|auto.*mots?[-_ ]?cl[eé]s?|keywords?.*auto|auto.*keywords?/i;
  const MANUAL_NAME = /mots?[-_ ]?cl[eé]s?|keywords?/i;

  // `prefer.target` : la colonne à sélectionner d'office (celle qu'un travail vient de créer) ; sinon la sélection
  // courante est gardée tant qu'elle existe encore.
  function fillColumnLists(prefer) {
    const { choices, columns } = state;
    const k = kind();
    const sources = k === 'pdf' ? choices.pdfSource : choices.textSource;
    setOptions(el.source, sources.map((id) => ({ value: id, label: id })), el.source.value);
    el.sourceLabel.textContent = t(k === 'pdf' ? 'keywords.source.pdfColumn' : 'keywords.source.textColumn');
    const emptyKey = k === 'pdf' ? 'keywords.noColumns.pdf' : 'keywords.noColumns.text';
    el.sourceEmpty.textContent = sources.length ? '' : t(emptyKey);
    el.sourceEmpty.hidden = sources.length > 0;
    el.source.disabled = sources.length === 0;

    // Cible : jamais la colonne source. Une colonne « mots-clés automatiques » déjà là est proposée d'abord.
    const newName = GristBI.publications.freshColumnName(Object.keys(columns));
    const targets = choices.target.filter((id) => id !== el.source.value);
    const previous = prefer && prefer.target ? prefer.target : el.target.value;
    setOptions(el.target, targets.map((id) => ({ value: id, label: id })).concat([{ value: NEW_COLUMN, label: t('keywords.target.new', { name: newName }) }]), previous);
    if (!previous || !el.target.querySelector(`option[value="${CSS.escape(previous)}"]`)) {
      const auto = targets.find((id) => AUTO_NAME.test(id));
      el.target.value = auto || NEW_COLUMN;
    }

    // Mots saisis à la main (facultatif) : une colonne dont le nom ressemble à « mots-clés » est proposée.
    const manuals = choices.manual.filter((id) => id !== el.source.value && id !== el.target.value);
    const prevManual = el.manual.value;
    setOptions(el.manual, [{ value: '', label: t('keywords.manual.none') }].concat(manuals.map((id) => ({ value: id, label: id }))), prevManual);
    if (prevManual == null || prevManual === '') {
      const guess = manuals.find((id) => MANUAL_NAME.test(id) && !AUTO_NAME.test(id));
      if (guess && !el.manual.dataset.touched) el.manual.value = guess;
    }
  }

  function updateKindUi() {
    const available = pdfAvailable();
    el.kindPdf.disabled = !available;
    el.kindPdf.closest('.keywords-radio').classList.toggle('is-disabled', !available);
    el.pdfNeeds.hidden = available;
    if (!available && el.kindPdf.checked) el.kindText.checked = true;
    // Dans GFS : ajouter l'extension. Seule : « Comment l'avoir » (la fenêtre du grisé du guide, section 5).
    el.pdfAdd.textContent = t(pdfState() === 'inactive' ? 'keywords.needsGfs.add' : 'keywords.needsGfs.how');
    el.pdfAdd.dataset.hosted = pdfState() === 'inactive' ? '1' : '';
  }

  function currentSpec() {
    const targetIsNew = el.target.value === NEW_COLUMN;
    return {
      kind: kind(),
      sourceColumn: el.source.value,
      targetColumn: targetIsNew ? null : el.target.value,
      targetIsNew,
      manualColumn: el.manual.value || null
    };
  }

  function updatePlan() {
    el.error.hidden = true;
    if (!state || job) return;
    const spec = currentSpec();
    const sourceOk = !!spec.sourceColumn && (spec.kind === 'text' || pdfAvailable());
    if (!sourceOk) {
      el.plan.textContent = '';
      el.start.disabled = true;
      return;
    }
    const plan = GristBI.publications.planRows(state.table, spec);
    state.plan = plan;
    if (plan.todo.length === 0) {
      el.plan.textContent = t('keywords.plan.none');
    } else {
      const parts = [];
      if (plan.filled) parts.push(t('keywords.plan.filled', { n: plan.filled }));
      if (plan.noSource) parts.push(t('keywords.plan.noSource', { n: plan.noSource }));
      el.plan.textContent = t('keywords.plan', { todo: plan.todo.length, total: plan.total }) + (parts.length ? ' ' + parts.join(', ') + '.' : '');
    }
    el.start.disabled = plan.todo.length === 0;
  }

  async function loadState() {
    const tableId = hooks.getTableId();
    if (!tableId) { state = null; return false; }
    const [info, table] = await Promise.all([GristBI.api.readColumnFormats(tableId), GristBI.api.fetchRawTable(tableId)]);
    state = { tableId, columns: info.columns, choices: GristBI.publications.columnChoices(info.columns), table, plan: null };
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Ouverture, fermeture
  // ---------------------------------------------------------------------------------------------

  async function open() {
    if (!el) return;
    el.status.textContent = '';
    el.log.hidden = true;
    el.log.innerHTML = '';
    el.progress.hidden = true;
    el.error.hidden = true;
    el.modal.hidden = false;
    GristBI.i18n.applyTranslations && GristBI.i18n.applyTranslations();
    const ok = await loadState().catch((e) => { console.warn('[GristBI] mots-clés : table illisible', e); return false; });
    el.noTable.hidden = ok;
    el.body.hidden = !ok;
    if (!ok) return;
    updateKindUi();
    if (!el.kindPdf.checked && !el.kindText.checked) {
      (pdfAvailable() && state.choices.pdfSource.length ? el.kindPdf : el.kindText).checked = true;
    }
    delete el.manual.dataset.touched;
    el.manual.value = '';
    el.target.innerHTML = ''; // à chaque ouverture, la colonne proposée est recalculée (celle qui existe déjà passe avant « nouvelle »)
    fillColumnLists();
    updatePlan();
    el.start.focus({ preventScroll: true });
  }

  function close() {
    if (job) job.controller.abort(); // le lot déjà prêt est écrit, le reste attend la prochaine fois
    el.modal.hidden = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Travail
  // ---------------------------------------------------------------------------------------------

  function showError(message) {
    el.error.textContent = message;
    el.error.hidden = false;
  }

  function setRunning(running) {
    for (const node of [el.kindPdf, el.kindText, el.source, el.target, el.manual, el.max, el.lang]) node.disabled = running;
    el.start.hidden = running;
    el.stop.hidden = !running;
    el.progress.hidden = !running;
    if (!running) {
      // Rend aux listes leur état normal (l'extension PDF peut avoir changé, la table aussi).
      updateKindUi();
      if (state) fillColumnLists();
    }
  }

  function pushLog(line) {
    el.log.hidden = false;
    const li = document.createElement('li');
    li.textContent = line;
    el.log.append(li);
    while (el.log.children.length > LOG_LINES) el.log.firstChild.remove();
    el.log.scrollTop = el.log.scrollHeight;
  }

  function summary(result) {
    const lines = [t('keywords.done.written', { n: result.written })];
    if (result.noText) lines.push(t('keywords.done.noText', { n: result.noText }));
    if (result.noPdf) lines.push(t('keywords.done.noPdf', { n: result.noPdf }));
    if (result.noKeywords) lines.push(t('keywords.done.noKeywords', { n: result.noKeywords }));
    if (result.errors) {
      const sample = result.errorSamples[0];
      lines.push(t('keywords.done.errors', { n: result.errors, sample: sample ? `${sample.id} : ${sample.message}` : '' }));
    }
    if (result.cancelled) lines.push(t('keywords.done.cancelled'));
    return lines.join('\n');
  }

  async function start() {
    if (job || !state || !state.plan) return;
    const spec = currentSpec();
    const plan = state.plan;
    if (!plan.todo.length) return;
    el.error.hidden = true;

    // 1. Ce dont l'extraction a besoin, vérifié AVANT de poser une question ou d'écrire quoi que ce soit.
    if (spec.kind === 'pdf') {
      try { await ensurePdfjs(); } catch (e) { showError(t('keywords.error.pdfjs', { message: e.message || String(e) })); return; }
      const access = await GristBI.api.checkAttachmentAccess();
      if (!access.ok) { showError(t('keywords.error.token', { message: access.message })); return; }
    }

    // 2. Une écriture dans la table de la personne : elle la confirme en voyant la colonne et le nombre de lignes.
    const newName = spec.targetIsNew ? GristBI.publications.freshColumnName(Object.keys(state.columns)) : null;
    const columnName = spec.targetIsNew ? newName : spec.targetColumn;
    const message = t('keywords.confirm.message', { todo: plan.todo.length, column: columnName, table: state.tableId })
      + (spec.targetIsNew ? t('keywords.confirm.newColumn') : '');
    const ok = await GristBI.dialogs.confirm({ title: t('keywords.confirm.title'), message, confirmLabel: t('keywords.confirm.ok') });
    if (!ok) return;

    // 3. La colonne, si elle est nouvelle.
    const tableId = state.tableId;
    let targetColumn = spec.targetColumn;
    if (spec.targetIsNew) {
      try { targetColumn = await GristBI.api.addTextColumn(tableId, newName); }
      catch (e) { showError(t('keywords.error.column', { name: newName, message: e.message || String(e) })); return; }
    }

    // 4. Le travail, ligne après ligne.
    const controller = new AbortController();
    job = { controller };
    setRunning(true);
    el.log.innerHTML = '';
    el.log.hidden = true;
    el.status.textContent = '';
    el.progress.max = plan.todo.length;
    el.progress.value = 0;
    const maxKeywords = Math.min(40, Math.max(3, parseInt(el.max.value, 10) || GristBI.publications.DEFAULT_MAX_KEYWORDS));
    const deps = {
      fetchPdf: (id) => GristBI.api.getAttachmentBytes(id),
      isPdf: GristBI.pdfText.isPdfBytes,
      extractText: async (buffer, o) => (await GristBI.pdfText.readPdf(buffer, o)).text,
      extractKeywords: GristBI.keywords.extractKeywords,
      write: (entries) => GristBI.api.writeColumnValues(tableId, targetColumn, entries)
    };
    let result;
    try {
      result = await GristBI.publications.runJob(plan.todo, deps, {
        kind: spec.kind, maxKeywords, lang: el.lang.value, signal: controller.signal,
        onProgress: ({ index, total }) => {
          el.progress.value = index;
          el.status.textContent = index < total ? t('keywords.progress', { n: index + 1, total }) : '';
        },
        onRow: (row) => {
          if (row.status === 'ok') pushLog(t('keywords.sample', { id: row.id, words: row.keywords.slice(0, 5).join(', ') }));
          else if (row.status === 'error') pushLog(t('keywords.sample', { id: row.id, words: row.message }));
        }
      });
    } finally {
      job = null;
      setRunning(false);
    }

    el.progress.hidden = true;
    el.status.textContent = summary(result);
    if (result.writeFailed) showError(t('keywords.error.write', { message: result.writeFailed }));

    // 5. Ce qui a été écrit doit se voir : le tableau de bord relit la table, la fenêtre recalcule ce qui reste.
    try {
      if (result.written > 0 && hooks.reloadTable) await hooks.reloadTable();
      if (hooks.getTableId() === tableId) { await loadState(); fillColumnLists({ target: targetColumn }); updatePlan(); }
    } catch (e) {
      console.warn('[GristBI] mots-clés : relecture de la table impossible après l\'écriture', e);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // L'extension PDF grisée : installer dans GFS, ou expliquer hors GFS
  // ---------------------------------------------------------------------------------------------

  async function onAddExtension() {
    const result = await GristBI.extensions.requestInstall(EXTENSION_ID);
    if (result === 'standalone') {
      await GristBI.dialogs.notice({
        title: t('ext.standalone.title'),
        message: t('ext.standalone.body', { feature: t('keywords.source.pdf'), extension: t('ext.name.' + EXTENSION_ID) })
      });
    }
    // Dans GFS, l'ajout arrive par l'événement `extensions` : `onChange` (ci-dessous) repeint la fenêtre.
  }

  function init(h) {
    hooks = h;
    if (!collectElements()) return;
    el.openBtn.addEventListener('click', open);
    el.closeBtn.addEventListener('click', close);
    el.start.addEventListener('click', start);
    el.stop.addEventListener('click', () => { if (job) job.controller.abort(); });
    el.pdfAdd.addEventListener('click', onAddExtension);
    for (const node of [el.kindPdf, el.kindText]) node.addEventListener('change', () => { if (state) { fillColumnLists(); updatePlan(); } });
    for (const node of [el.source, el.target]) node.addEventListener('change', () => { if (state) { fillColumnLists(); updatePlan(); } });
    el.manual.addEventListener('change', () => { el.manual.dataset.touched = '1'; if (state) { fillColumnLists(); updatePlan(); } });
    // GFS prévient quand une extension est ajoutée ou retirée pendant que l'app est ouverte (et répond après
    // le chargement : avant, tout paraît « pas encore ») : `js/extensions.js` rappelle alors la fenêtre.
    GristBI.extensions.onChange(() => { if (!el.modal.hidden) { updateKindUi(); if (state) { fillColumnLists(); updatePlan(); } } });
    GristBI.i18n.onChange(() => { if (!el.modal.hidden && state) { updateKindUi(); fillColumnLists(); updatePlan(); } });
  }

  GristBI.keywordsPanel = { init, open, close };
})(typeof self !== 'undefined' ? self : this);
