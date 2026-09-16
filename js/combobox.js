/*
 * Combobox réutilisable : un <input type="text"> à côté d'un <ul> masqué devient un sélecteur avec
 * autocomplétion (filtrage en tapant, navigation clavier, surlignage du texte tapé). Remplace les
 * <select> partout où l'utilisateur choisit une COLONNE (dimension, mesure, drill-down, filtre...) —
 * bien plus confortable qu'un menu déroulant natif dès qu'une vraie table Grist a des dizaines de
 * colonnes. Deux modes :
 *   - `strict: true` (défaut) : la valeur DOIT être l'une des options fournies (ou le "blank" si
 *     `blankLabel` est réglé) — comme un <select>. Une saisie invalide au blur/Escape revient à la
 *     dernière valeur valide.
 *   - `strict: false` : texte libre, la liste n'est qu'une SUGGESTION (utilisé pour les valeurs de
 *     filtre — voir js/main.js, barre de filtres avancés).
 * Logique de filtrage/surlignage pure (testable sous Node, comme data.js) ; câblage DOM séparé,
 * jamais appelé sous Node (pas de `document`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.combobox = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sous-chaîne insensible à la casse, ordre d'origine préservé (pas de tri alphabétique — l'appelant
  // choisit l'ordre via setOptions). Query vide -> tout matche (état initial du menu, avant saisie).
  function filterOptions(options, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return options.slice();
    return options.filter((o) => String(o).toLowerCase().includes(q));
  }

  // Découpe `text` en 3 segments autour de la PREMIÈRE occurrence de `query` (insensible à la casse),
  // pour surligner ce que l'utilisateur a tapé dans chaque suggestion. `match` vide si `query` est
  // vide ou ne matche pas `text` (le surlignage n'a alors pas de sens).
  function highlightMatch(text, query) {
    const s = String(text);
    const q = String(query || '').trim();
    if (!q) return { before: s, match: '', after: '' };
    const idx = s.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return { before: s, match: '', after: '' };
    return { before: s.slice(0, idx), match: s.slice(idx, idx + q.length), after: s.slice(idx + q.length) };
  }

  const MAX_VISIBLE_OPTIONS = 50;

  // Attache le comportement combobox à `inputEl`/`listEl` déjà présents dans le DOM (voir
  // index.html/harness.html : un <div class="combobox"> contenant l'input + le <ul>). Retourne
  // `inputEl` lui-même (même référence, enrichie de `setOptions`) : tout le reste du code continue
  // de lire/écrire `.value` et d'écouter `'change'` exactement comme sur un <select> classique.
  function attach(inputEl, listEl, config) {
    const opts = config || {};
    const strict = opts.strict !== false;
    const escapeHtml = (typeof root !== 'undefined' && root.GristBI && root.GristBI.data)
      ? root.GristBI.data.escapeHtml
      : (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let options = [];
    let blankLabel = opts.blankLabel || null;
    let matches = [];
    let activeIndex = -1;
    let lastValidValue = '';
    let currentQuery = '';

    function isValid(v) {
      return v === '' ? !!blankLabel : options.includes(v);
    }

    function closeList() {
      listEl.hidden = true;
      inputEl.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    function renderList() {
      const rows = [];
      if (blankLabel) rows.push(`<li class="combobox-option" data-value="" role="option">${escapeHtml(blankLabel)}</li>`);
      matches.slice(0, MAX_VISIBLE_OPTIONS).forEach((m) => {
        const h = highlightMatch(m, currentQuery);
        const html = `${escapeHtml(h.before)}${h.match ? `<mark>${escapeHtml(h.match)}</mark>` : ''}${escapeHtml(h.after)}`;
        rows.push(`<li class="combobox-option" data-value="${escapeHtml(m)}" role="option">${html}</li>`);
      });
      listEl.innerHTML = rows.join('');
      updateActiveHighlight();
    }

    function updateActiveHighlight() {
      const items = listEl.querySelectorAll('.combobox-option');
      items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
      if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function showList() {
      renderList();
      listEl.hidden = false;
      inputEl.setAttribute('aria-expanded', 'true');
    }

    // Ouverture PASSIVE (focus, ou clic sur un champ qui a déjà le focus) : montre TOUTES les
    // options (comme un <select> natif), quelle que soit la valeur déjà commitée — mais ne
    // présélectionne RIEN, même si le champ est déjà vide. L'utilisateur n'a encore rien tapé ; un
    // Entrée égaré (ex. en tabulant dans le formulaire) ne doit jamais modifier un champ déjà valide.
    function openPassive() {
      currentQuery = '';
      matches = filterOptions(options, '');
      if (!matches.length && !blankLabel) return;
      activeIndex = -1;
      showList();
    }

    // Ouverture ACTIVE (l'utilisateur tape, y compris pour vider le champ) : filtre sur ce qui est
    // tapé et présélectionne la meilleure correspondance, pour qu'Entrée fonctionne immédiatement
    // sans ArrowDown préalable — c'est l'usage principal (taper un nom de colonne puis valider).
    // Cas particulier : vider complètement le champ (currentQuery === '') présélectionne le "blank"
    // (`(aucun)`) s'il existe — un champ explicitement vidé PUIS validé doit se réinitialiser,
    // contrairement à l'ouverture passive ci-dessus où rien n'a été tapé.
    function openOnType() {
      currentQuery = inputEl.value;
      matches = filterOptions(options, currentQuery);
      const hasBlank = !!blankLabel;
      if (!matches.length && !hasBlank) { closeList(); return; }
      if (currentQuery === '' && hasBlank) activeIndex = 0;
      else if (matches.length) activeIndex = hasBlank ? 1 : 0;
      else activeIndex = -1;
      showList();
    }

    function commit(value) {
      inputEl.value = value;
      lastValidValue = value;
      closeList();
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function optionCount() {
      return (blankLabel ? 1 : 0) + Math.min(matches.length, MAX_VISIBLE_OPTIONS);
    }

    function valueAt(index) {
      if (blankLabel) {
        if (index === 0) return '';
        return matches[index - 1];
      }
      return matches[index];
    }

    // Focus (ou clic sur un champ déjà rempli) : sélectionne tout le texte (prêt à être remplacé en
    // tapant, affordance standard) et ouvre passivement (voir openPassive). Les deux écouteurs
    // (focus ET click) sont nécessaires : cliquer un champ qui a déjà le focus (ex. juste après
    // avoir validé une sélection) ne redéclenche PAS 'focus'.
    inputEl.addEventListener('focus', () => { inputEl.select(); openPassive(); });
    inputEl.addEventListener('click', () => { inputEl.select(); openPassive(); });
    inputEl.addEventListener('input', openOnType);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (listEl.hidden) { openOnType(); return; }
        activeIndex = Math.min(activeIndex + 1, optionCount() - 1);
        updateActiveHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (listEl.hidden) { openOnType(); return; }
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveHighlight();
      } else if (e.key === 'Enter') {
        if (!listEl.hidden && activeIndex >= 0) {
          e.preventDefault();
          commit(valueAt(activeIndex));
        } else if (!strict) {
          closeList();
        }
      } else if (e.key === 'Escape') {
        if (strict) inputEl.value = lastValidValue;
        closeList();
      }
    });

    // Empêche le blur de l'input quand on clique DANS la liste (sinon le blur se déclenche avant le
    // 'click' de l'option et referme/annule la sélection avant qu'elle ait pu être commitée).
    listEl.addEventListener('mousedown', (e) => e.preventDefault());
    listEl.addEventListener('click', (e) => {
      const li = e.target.closest('.combobox-option');
      if (!li) return;
      commit(li.dataset.value);
    });

    inputEl.addEventListener('blur', () => {
      if (strict && !isValid(inputEl.value)) inputEl.value = lastValidValue;
      else lastValidValue = inputEl.value;
      closeList();
    });

    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.setAttribute('autocomplete', 'off');
    listEl.setAttribute('role', 'listbox');

    // Remplace la liste d'options (comme `fillSelect` pour un <select>) : conserve la valeur
    // actuelle si elle reste valide, sinon revient au blank (si prévu) ou à la 1re option.
    inputEl.setOptions = function (newOptions, cfg) {
      options = (newOptions || []).slice();
      if (cfg && 'blankLabel' in cfg) blankLabel = cfg.blankLabel || null;
      if (blankLabel) inputEl.placeholder = blankLabel;
      if (!isValid(inputEl.value)) inputEl.value = blankLabel ? '' : (options[0] || '');
      lastValidValue = inputEl.value;
    };

    return inputEl;
  }

  return { filterOptions, highlightMatch, attach };
});
