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
    filterTextInput, filterValueList, filterValueMore, filterValuesHint, inferColumnKind, store
  } = parts;
  Object.assign(parts, {
    renderFilterColumns, updateAdvancedFilterFieldsForColumn
  });

  const FILTER_VALUES_SHOWN = 40;
 // au-delà : « N autres valeurs », on affine en tapant
  let filterColumns = [];
 // [{ id, kind }] — colonnes proposées par l'étape 1
  let filterValuesPool = [];
 // valeurs distinctes de la colonne choisie (filtre texte)

  const KIND_BADGES = { text: 'Aa', number: '123', date: '31' };

  function renderFilterColumns(rows) {
    rows = rows || store.getState().rows;
    filterColumns = availableColumns(rows).map((id) => ({ id, kind: inferColumnKind(id, rows) }));
    // La colonne choisie a disparu (changement de table) : retour à l'étape 1.
    if (filterColumnSelect.value && !filterColumns.some((c) => c.id === filterColumnSelect.value)) {
      filterColumnSelect.value = '';
      showFilterStep('columns');
    }
    refreshFilterColumnList();
  }

  function refreshFilterColumnList() {
    const q = filterColumnSearch.value.trim().toLowerCase();
    const shown = q ? filterColumns.filter((c) => c.id.toLowerCase().includes(q)) : filterColumns;
    GristBI.safeHtml.setHtml(filterColumnList, shown.map((c) => {
      const kind = t('filters.kind.' + c.kind);
      return `<li><button type="button" class="filter-column-item" data-column="${escapeHtml(c.id)}" aria-label="${escapeHtml(t('filters.column.aria', { name: c.id, kind }))}">`
        + `<span class="kind-badge kind-${c.kind}" aria-hidden="true">${KIND_BADGES[c.kind]}</span>`
        + `<span class="filter-column-label">${escapeHtml(c.id)}</span></button></li>`;
    }).join(''));
    filterColumnEmpty.hidden = shown.length > 0;
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
    filterColumnNameEl.textContent = columnId;
    const kind = (filterColumns.find((c) => c.id === columnId) || {}).kind || 'text';
    filterColumnNameEl.dataset.kind = kind;
    filterTextInput.value = '';
    updateAdvancedFilterFieldsForColumn();
    showFilterStep('form');
    // Focus sur le 1er champ utile (pas un combobox, voir CLAUDE.md §7 piège n°19) ; sinon le bouton « Retour ».
    const first = kind === 'number' ? filterMinInput : kind === 'date' ? (filterDateModeField.hidden ? filterBackBtn : filterDateModeSelect) : filterTextInput;
    first.focus({ preventScroll: true });
  }

  // Remet le menu sur son 1er écran : appelé à CHAQUE ouverture (js/appbar.js:onOpen).
  function resetFilterPopover() {
    filterColumnSearch.value = '';
    filterColumnSelect.value = '';
    refreshFilterColumnList();
    showFilterStep('columns');
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
    rows = rows || store.getState().rows;
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
    if (btn) selectFilterColumn(btn.dataset.column);
  });

  filterColumnSearch.addEventListener('input', refreshFilterColumnList);

  filterColumnSearch.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      const first = filterColumnList.querySelector('.filter-column-item');
      if (first) selectFilterColumn(first.dataset.column);
    } else listArrowNav(evt, filterColumnList, null);
  });

  filterColumnList.addEventListener('keydown', (evt) => listArrowNav(evt, filterColumnList, filterColumnSearch));

  filterBackBtn.addEventListener('click', () => { showFilterStep('columns'); filterColumnSearch.focus({ preventScroll: true }); });

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
    const kind = inferColumnKind(column);
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
