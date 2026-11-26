/*
 * Bootstrap de l'UI — menu Filtre : choix de la colonne, valeurs cliquables, filtres avancés. Voir js/main.js.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const { escapeHtml } = GristBI.data;
  const { t } = GristBI.i18n;
  const {
    advancedFilterForm, availableColumns, bindFormSubmit, filterBackBtn, filterColumnEmpty, filterColumnList,
    filterColumnNameEl, filterColumnSearch, filterColumnSelect, filterDateEndInput, filterDateModeField,
    filterDateModeSelect, filterDateRangeField, filterDateStartInput, filterErrorEl, filterMaxInput, filterMinInput,
    filterNumberField, filterRelativeDateField, filterRelativePresetSelect, filterStepColumns, filterTextField,
    columnOptions, filterLinkNoteEl, filterTableField, filterTableNoteEl, filterTablesEl, filterTextInput, filterValueList, filterValueMore,
    filterValuesHint, inferColumnKind, store
  } = parts;
  const S = parts.S;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const joinColumn = (...args) => parts.joinColumn(...args);
  const ensureTableRows = (...args) => parts.ensureTableRows(...args);
  Object.assign(parts, {
    renderFilterColumns, updateAdvancedFilterFieldsForColumn
  });

  // La table sur laquelle porte le filtre en cours de réglage (lot 2 de « Colonnes de toutes les tables », 26/11/2026) : '' = la table de travail.
  // Un autre choix donne les colonnes de CETTE table (sans jointure : elle n'a que les siennes) et un filtre qui porte `table` — il ne touche que les
  // visualisations qui lisent cette table. Remis à '' à chaque ouverture du menu et à chaque changement de table de travail.
  S.filterTable = '';
  let filterTableNames = []; // les tables du document, relues à chaque ouverture du menu
  let filterTableToken = 0; // le dernier choix de table compte (la lecture d'une table peut arriver après un autre clic)

  // Les lignes sur lesquelles se règle le filtre : celles de la table de travail, ou celles de l'autre table choisie (`[]` tant qu'elle n'est pas lue).
  function filterRows() {
    const state = store.getState();
    if (!S.filterTable) return state.rows;
    const rows = state.tableRows[S.filterTable];
    return Array.isArray(rows) ? rows : [];
  }

  const FILTER_VALUES_SHOWN = 40;
 // au-delà : « N autres valeurs », on affine en tapant
  let filterColumns = [];
 // [{ id, kind, label, group, pending, table }] — colonnes proposées par l'étape 1 (celles des lignes, puis celles des tables liées
 // qu'on n'a pas encore jointes : `pending`, choisir l'une d'elles pose la jointure d'abord)
  let filterValuesPool = [];
 // valeurs distinctes de la colonne choisie (filtre texte)

  const KIND_BADGES = { text: 'Aa', number: '123', date: '31' };

  function renderFilterColumns(rows) {
    rows = S.filterTable ? filterRows() : (rows || store.getState().rows);
    // Une seule table en jeu : les colonnes seules, comme avant. Sinon rangées par table (js/main-fields.js:columnOptions), celles à relier en dernier.
    // Une autre table que celle de travail : ses colonnes seules (`plainOnly`), quand elle est lue.
    filterColumns = columnOptions(rows, undefined, !!S.filterTable).map((o) => (typeof o === 'string'
      ? { id: o, kind: inferColumnKind(o, rows), label: o, group: '' }
      : { id: o.value, kind: o.pending ? (o.kind || 'text') : inferColumnKind(o.value, rows), label: o.label, group: o.group, pending: !!o.pending, table: o.table }));
    // La colonne choisie a disparu (changement de table) : retour à l'étape 1.
    if (filterColumnSelect.value && !filterColumns.some((c) => c.id === filterColumnSelect.value)) {
      filterColumnSelect.value = '';
      showFilterStep('columns');
    }
    refreshFilterColumnList();
  }

  function refreshFilterColumnList() {
    const q = filterColumnSearch.value.trim().toLowerCase();
    // On cherche aussi par table : « clients » montre ses colonnes (comme la liste déroulante des champs du formulaire).
    const shown = q ? filterColumns.filter((c) => `${c.id} ${c.group}`.toLowerCase().includes(q)) : filterColumns;
    let lastGroup = '';
    GristBI.safeHtml.setHtml(filterColumnList, shown.map((c) => {
      const kind = t('filters.kind.' + c.kind);
      let head = '';
      if (c.group && c.group !== lastGroup) head = `<li class="filter-column-group" role="presentation">${escapeHtml(c.group)}</li>`;
      lastGroup = c.group;
      const aria = c.pending ? t('filters.column.ariaLinked', { name: c.id, kind, table: c.table || c.group }) : t('filters.column.aria', { name: c.id, kind });
      const title = c.pending ? ` title="${escapeHtml(t('joins.pick.hint', { table: c.table || c.group }))}"` : '';
      return `${head}<li><button type="button" class="filter-column-item${c.pending ? ' filter-column-pending' : ''}${c.group ? ' filter-column-grouped' : ''}" data-column="${escapeHtml(c.id)}"${c.pending ? ' data-pending="1"' : ''}${title} aria-label="${escapeHtml(aria)}">`
        + `<span class="kind-badge kind-${c.kind}" aria-hidden="true">${KIND_BADGES[c.kind]}</span>`
        + `<span class="filter-column-label">${escapeHtml(c.label)}</span></button></li>`;
    }).join(''));
    // Une table pas encore lue, ou illisible, n'a pas de colonne à montrer : la phrase de la table le dit, pas « aucune colonne ne correspond ».
    filterColumnEmpty.hidden = shown.length > 0 || (!!S.filterTable && GristBI.data.tableRowsStatus(store.getState(), S.filterTable) !== 'ready');
  }

  // Les boutons de table (au moins deux tables dans le document) et la phrase de la table choisie.
  function renderFilterTables() {
    const working = store.getState().workingTable;
    const current = S.filterTable || working;
    filterTableField.hidden = filterTableNames.length < 2;
    GristBI.safeHtml.setHtml(filterTablesEl, filterTableNames.map((name) => (
      `<button type="button" class="filter-table-btn" data-table="${escapeHtml(name)}" aria-pressed="${name === current ? 'true' : 'false'}">${escapeHtml(name)}</button>`
    )).join(''));
    updateFilterTableNote();
  }

  function updateFilterTableNote() {
    const table = S.filterTable;
    let key = '';
    if (table) {
      const status = GristBI.data.tableRowsStatus(store.getState(), table);
      key = status === 'failed' ? 'filters.table.failed' : (status === 'loading' ? 'filters.table.loading' : 'filters.table.scope');
    }
    filterTableNoteEl.hidden = !key;
    filterTableNoteEl.textContent = key ? t(key, { table }) : '';
  }

  async function loadFilterTables() {
    let tables = [];
    try { tables = await GristBI.api.listAvailableTables(); } catch (e) { console.error('[GristBI] liste des tables illisible (menu Filtre)', e); }
    filterTableNames = tables;
    renderFilterTables();
  }

  // Un clic sur un bouton de table : les colonnes de cette table (lue à la demande), le dernier choix compte.
  async function chooseFilterTable(table) {
    const next = table && table !== store.getState().workingTable ? table : '';
    if (next === S.filterTable) return;
    const token = ++filterTableToken;
    S.filterTable = next;
    filterColumnSearch.value = '';
    filterColumnSelect.value = '';
    renderFilterTables();
    renderFilterColumns();
    if (next) await ensureTableRows(next);
    if (token !== filterTableToken || S.filterTable !== next) return;
    updateFilterTableNote();
    renderFilterColumns();
  }

  function showFilterStep(step) {
    const columns = step === 'columns';
    filterStepColumns.hidden = !columns;
    advancedFilterForm.hidden = columns;
    showFilterError(null);
  }

  // Étape 2 : réglage du filtre pour la colonne cliquée.
  function selectFilterColumn(columnId) {
    filterColumnSelect.value = columnId;
    filterColumnNameEl.textContent = S.filterTable ? `${S.filterTable} › ${columnId}` : columnId;
    const kind = (filterColumns.find((c) => c.id === columnId) || {}).kind || 'text';
    filterColumnNameEl.dataset.kind = kind;
    filterTextInput.value = '';
    updateAdvancedFilterFieldsForColumn();
    showFilterStep('form');
    // Focus sur le 1er champ utile (pas un combobox, voir CLAUDE.md §7 piège n°19) ; sinon le bouton « Retour ».
    const first = kind === 'number' ? filterMinInput : kind === 'date' ? (filterDateModeField.hidden ? filterBackBtn : filterDateModeSelect) : filterTextInput;
    first.focus({ preventScroll: true });
  }

  // Un clic (ou Entrée) sur une colonne de la liste. Une colonne d'une table LIÉE pas encore jointe pose la jointure d'abord (js/main-session.js:joinColumn),
  // puis passe à l'étape 2 sur les lignes jointes ; si la jointure n'a pas lieu, la liste reste ouverte, rien n'est choisi. Un seul choix à la fois.
  let filterJoining = false;
  async function pickFilterColumn(columnId, button) {
    const entry = filterColumns.find((c) => c.id === columnId);
    if (!entry || !entry.pending) { selectFilterColumn(columnId); return; }
    if (filterJoining) return;
    filterJoining = true;
    if (button) button.setAttribute('aria-busy', 'true');
    let ok = false;
    try { ok = await joinColumn(columnId, filterLinkNoteEl); } catch (err) { console.error('[GristBI] choix d\'une colonne liée impossible', err); }
    filterJoining = false;
    if (ok && filterColumns.some((c) => c.id === columnId && !c.pending)) { selectFilterColumn(columnId); return; }
    filterColumnSearch.focus({ preventScroll: true });
  }

  // Remet le menu sur son 1er écran : appelé à CHAQUE ouverture (js/appbar.js:onOpen).
  function resetFilterPopover() {
    filterColumnSearch.value = '';
    filterColumnSelect.value = '';
    hideFilterLinkNote();
    if (S.filterTable) { filterTableToken += 1; S.filterTable = ''; renderFilterColumns(); }
    renderFilterTables();
    loadFilterTables();
    refreshFilterColumnList();
    showFilterStep('columns');
  }

  function hideFilterLinkNote() {
    filterLinkNoteEl.hidden = true;
    filterLinkNoteEl.textContent = '';
  }

  // Valeurs cliquables du filtre texte, filtrées par ce qui est tapé dans le champ.
  function refreshFilterValues() {
    const q = filterTextInput.value.trim().toLowerCase();
    const pool = q ? filterValuesPool.filter((v) => v.toLowerCase().includes(q)) : filterValuesPool;
    const shown = pool.slice(0, FILTER_VALUES_SHOWN);
    GristBI.safeHtml.setHtml(filterValueList, shown.map((v) => `<li><button type="button" class="filter-value-item" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button></li>`).join(''));
    filterValueList.hidden = shown.length === 0;
    filterValuesHint.hidden = filterValuesPool.length === 0;
    const more = pool.length - shown.length;
    filterValueMore.hidden = more <= 0;
    if (more > 0) filterValueMore.textContent = t('filters.values.more', { n: more });
  }

  function showFilterError(key) {
    filterErrorEl.hidden = !key;
    filterErrorEl.textContent = key ? t(key) : '';
  }

  // Flèches ↑ ↓ dans une liste de boutons (colonnes / valeurs) ; ↑ depuis le 1er élément rend le champ de recherche.
  function listArrowNav(evt, listEl, backTo) {
    if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return;
    const items = Array.from(listEl.querySelectorAll('button'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (evt.key === 'ArrowDown') next = items[i + 1] || (i === -1 ? items[0] : null);
    else if (i > 0) next = items[i - 1];
    else if (i === 0 && backTo) next = backTo;
    if (next) { evt.preventDefault(); next.focus(); }
  }

  // Bascule les champs du formulaire de filtre avancé selon le "type" inféré de la colonne
  // choisie : plage min/max (numérique), plage de dates OU période relative au choix (date, via
  // `#filter-date-mode`), recherche texte (tout le reste). Même pattern que
  // `updateFormFieldsForType` pour le formulaire de tuile. `rows` optionnel : passé explicitement
  // par `refreshColumnSelects` (table qui vient de changer — `store.getState().rows` n'est mis à
  // jour qu'APRÈS refreshColumnSelects dans switchTable, donc serait encore celui de l'ANCIENNE
  // table à cet instant précis) ; sinon (changement de colonne/mode par l'utilisateur, table déjà
  // stable) repli sur `store.getState().rows`, à jour dans ce cas.
  function updateAdvancedFilterFieldsForColumn(rows) {
    rows = S.filterTable ? filterRows() : (rows || store.getState().rows);
    const column = filterColumnSelect.value;
    const kind = column ? inferColumnKind(column, rows) : 'text';
    filterNumberField.hidden = kind !== 'number';
    filterDateModeField.hidden = kind !== 'date';
    filterTextField.hidden = kind !== 'text';
    if (kind === 'date') {
      const mode = filterDateModeSelect.value;
      filterDateRangeField.hidden = mode !== 'dateRange';
      filterRelativeDateField.hidden = mode !== 'relativeDate';
    } else {
      filterDateRangeField.hidden = true;
      filterRelativeDateField.hidden = true;
    }
    // Valeurs réellement présentes dans la colonne choisie, juste des SUGGESTIONS (voir l'attach
    // en `strict: false` plus haut) — uniquement pour la recherche texte : pour une colonne
    // numérique quasi unique (ex. Montant), la liste des valeurs distinctes n'aiderait pas plus
    // qu'un champ nombre natif, qui garde en plus son clavier numérique dédié ; idem pour les
    // dates, où le sélecteur natif du navigateur est déjà une meilleure UX qu'une liste de ~47 000
    // jours quasi tous différents. Décision de périmètre documentée dans HYPOTHESES.md.
    filterValuesPool = kind === 'text' && column ? GristBI.data.distinctColumnValues(rows, column) : [];
    refreshFilterValues();
  }

  // Appelées SANS argument (via une flèche plutôt qu'en passant la fonction directement en callback)
  // : un `addEventListener` passe l'Event en 1er argument, qui satisferait silencieusement le
  // paramètre optionnel `rows` de `updateAdvancedFilterFieldsForColumn` à sa place (`rows` vaudrait
  // l'Event, pas les lignes) — `distinctColumnValues` plante alors sur un Event non itérable [DÉFAUT
  // RÉEL trouvé en testant l'autocomplétion des valeurs, voir HYPOTHESES.md/TEST_PROTOCOL.md].
  filterDateModeSelect.addEventListener('change', () => updateAdvancedFilterFieldsForColumn());

  // Menu Filtre : clic sur une colonne, recherche de colonne, retour, valeurs cliquables.
  GristBI.appbar.onOpen('filter-popover', resetFilterPopover);

  filterColumnList.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-column-item');
    if (btn) pickFilterColumn(btn.dataset.column, btn);
  });

  filterColumnSearch.addEventListener('input', refreshFilterColumnList);

  filterTablesEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-table-btn');
    if (btn) chooseFilterTable(btn.dataset.table);
  });

  filterColumnSearch.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      const first = filterColumnList.querySelector('.filter-column-item');
      if (first) pickFilterColumn(first.dataset.column, first);
    } else listArrowNav(evt, filterColumnList, null);
  });

  filterColumnList.addEventListener('keydown', (evt) => listArrowNav(evt, filterColumnList, filterColumnSearch));

  filterBackBtn.addEventListener('click', () => { hideFilterLinkNote(); showFilterStep('columns'); filterColumnSearch.focus({ preventScroll: true }); });

  filterTextInput.addEventListener('input', () => { refreshFilterValues(); showFilterError(null); });

  filterTextInput.addEventListener('keydown', (evt) => {
    // Entrée dans le champ est gérée par bindFormSubmit ; ↓ descend dans les valeurs proposées.
    if (evt.key === 'ArrowDown') listArrowNav(evt, filterValueList, null);
  });

  filterValueList.addEventListener('keydown', (evt) => listArrowNav(evt, filterValueList, filterTextInput));

  // Une valeur cliquée pose le filtre tout de suite (« contient » cette valeur) : un clic, pas deux.
  filterValueList.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-value-item');
    if (!btn) return;
    filterTextInput.value = btn.dataset.value;
    submitAdvancedFilter();
  });

  [filterMinInput, filterMaxInput, filterDateStartInput, filterDateEndInput].forEach((el) => el.addEventListener('input', () => showFilterError(null)));

  function submitAdvancedFilter() {
    const column = filterColumnSelect.value;
    if (!column) return;
    const kind = inferColumnKind(column, filterRows());
    let filter;
    if (kind === 'number') {
      const min = filterMinInput.value === '' ? null : parseFloat(filterMinInput.value);
      const max = filterMaxInput.value === '' ? null : parseFloat(filterMaxInput.value);
      if (min == null && max == null) { showFilterError('filters.minBoundRequired'); filterMinInput.focus(); return; }
      if (min != null && max != null && max < min) { showFilterError('filters.maxGteMin'); filterMaxInput.focus(); return; }
      filter = { type: 'range', min, max };
    } else if (kind === 'date') {
      if (filterDateModeSelect.value === 'relativeDate') {
        filter = { type: 'relativeDate', preset: filterRelativePresetSelect.value };
      } else {
        const start = filterDateStartInput.value || null;
        const end = filterDateEndInput.value || null;
        if (!start && !end) { showFilterError('filters.dateBoundRequired'); filterDateStartInput.focus(); return; }
        if (start && end && end < start) { showFilterError('filters.endAfterStart'); filterDateEndInput.focus(); return; }
        filter = { type: 'dateRange', start, end };
      }
    } else {
      const query = filterTextInput.value.trim();
      if (!query) { showFilterError('filters.textRequired'); filterTextInput.focus(); return; }
      filter = { type: 'contains', query };
    }
    // Une autre table que celle de travail : le filtre le dit (`table`) et ne touche que les visualisations qui la lisent.
    if (S.filterTable) filter.table = S.filterTable;
    store.setAdvancedFilter(column, filter);
    // Formulaire remis à zéro après ajout (contrairement au formulaire de tuile, qui reste
    // pré-rempli en mode édition) : un filtre avancé n'a pas de mode édition, juste
    // ajout/remplacement par colonne (voir setAdvancedFilter) et suppression via son badge.
    filterMinInput.value = '';
    filterMaxInput.value = '';
    filterDateStartInput.value = '';
    filterDateEndInput.value = '';
    filterTextInput.value = '';
    showFilterError(null);
    GristBI.appbar.closePopovers(); // le filtre est posé : sa pastille apparaît sous la barre
    resetFilterPopover(); // prêt pour le prochain filtre : 1er écran
  }

  bindFormSubmit(advancedFilterForm, submitAdvancedFilter);
})(window);
