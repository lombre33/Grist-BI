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
 * Une option est une chaîne, ou un objet `{ value, label?, group?, pending?, title? }` : `group` range les
 * options sous un intitulé (les colonnes de chaque table liée, voir js/table-graph.js:groupColumns), `label`
 * est ce qu'on lit dans la liste quand il diffère de la valeur (la colonne seule sous l'intitulé de sa
 * table), `pending` dit que la valeur n'existe pas encore (une colonne d'une table qu'il faut d'abord
 * relier) : le choix passe alors par `config.prepare(valeur, option)`, attendue AVANT d'écrire la valeur et
 * d'émettre `change` (`false` ou un refus = le choix est annulé, le champ revient à sa valeur d'avant).
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
  // Une option objet se retrouve par sa valeur ET par l'intitulé de son groupe (taper « clients » montre les colonnes de cette table).
  function searchText(option) {
    return typeof option === 'string' ? option : `${option.value} ${option.group || ''}`;
  }

  function filterOptions(options, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return options.slice();
    return options.filter((o) => searchText(o).toLowerCase().includes(q));
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
  // Une liste rangée par table porte plus de colonnes (celles de la table de travail, puis celles des tables liées) : un plafond de 50 en
  // cacherait des groupes entiers sans que taper ne soit nécessaire pour s'en douter.
  const MAX_VISIBLE_GROUPED = 200;

  // Une option, toujours sous la forme d'un objet : `{ value, label, group, pending, title }`.
  function normalizeOption(o) {
    if (o && typeof o === 'object') {
      return {
        value: String(o.value), label: o.label != null ? String(o.label) : String(o.value), group: o.group ? String(o.group) : '',
        pending: o.pending === true, title: o.title ? String(o.title) : ''
      };
    }
    return { value: String(o), label: String(o), group: '', pending: false, title: '' };
  }

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
    let optionByValue = new Map();
    let grouped = false;
    let blankLabel = opts.blankLabel || null;
    let matches = [];
    let activeIndex = -1;
    let lastValidValue = '';
    let currentQuery = '';

    function isValid(v) {
      return v === '' ? !!blankLabel : optionByValue.has(v);
    }

    function visibleMax() { return grouped ? MAX_VISIBLE_GROUPED : MAX_VISIBLE_OPTIONS; }

    function closeList() {
      listEl.hidden = true;
      inputEl.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    function renderList() {
      const rows = [];
      if (blankLabel) rows.push(`<li class="combobox-option" data-value="" role="option">${escapeHtml(blankLabel)}</li>`);
      let lastGroup = null;
      matches.slice(0, visibleMax()).forEach((m) => {
        // Un intitulé de groupe n'est pas une option : classe à part, jamais compté par la navigation clavier (`.combobox-option` seulement).
        if (m.group && m.group !== lastGroup) rows.push(`<li class="combobox-group" role="presentation">${escapeHtml(m.group)}</li>`);
        lastGroup = m.group;
        const h = highlightMatch(m.label, currentQuery);
        const html = `${escapeHtml(h.before)}${h.match ? `<mark>${escapeHtml(h.match)}</mark>` : ''}${escapeHtml(h.after)}`;
        const label = m.label !== m.value ? ` aria-label="${escapeHtml(m.value)}"` : '';
        const title = m.title || (m.label !== m.value ? m.value : '');
        rows.push(`<li class="combobox-option${m.group ? ' combobox-option-grouped' : ''}${m.pending ? ' combobox-option-pending' : ''}" data-value="${escapeHtml(m.value)}" role="option"${label}${title ? ` title="${escapeHtml(title)}"` : ''}>${html}</li>`);
      });
      GristBI.safeHtml.setHtml(listEl, rows.join(''));
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
    // `config.beforeOpen`, si fourni, est attendu avant d'afficher la liste : sert à une source
    // d'options EXTERNE et changeante (ex. le sélecteur de table, voir js/main.js) qui doit relire
    // l'état le plus frais possible à l'ouverture plutôt qu'un instantané figé depuis le dernier
    // `setOptions()` explicite — sans ça, une option ajoutée depuis (une table créée dans Grist
    // entre-temps) reste invisible/inatteignable tant que ce rafraîchissement explicite n'a pas eu
    // lieu ailleurs [DÉFAUT RÉEL trouvé en testant l'autocomplétion des valeurs de filtre : après avoir
    // corrigé la fuite d'évènement 'change' natif ci-dessous, taper le nom d'une table fraîchement
    // créée mais jamais encore "vue" par ce combobox ne matchait plus RIEN du tout].
    async function openPassive() {
      if (opts.beforeOpen) {
        try { await opts.beforeOpen(); } catch (e) { /* liste peut-être obsolète, mieux que rien */ }
      }
      currentQuery = '';
      matches = filterOptions(options, '');
      if (!matches.length && !blankLabel) return;
      activeIndex = -1;
      showList();
    }

    // Ouverture ACTIVE (l'utilisateur tape, y compris pour vider le champ) : filtre sur ce qui est
    // tapé. En mode STRICT, présélectionne la meilleure correspondance pour qu'Entrée fonctionne
    // immédiatement sans ArrowDown préalable — c'est l'usage principal (taper un nom de colonne puis
    // valider). Cas particulier : vider complètement le champ (currentQuery === '') présélectionne
    // le "blank" (`(aucun)`) s'il existe — un champ explicitement vidé PUIS validé doit se
    // réinitialiser, contrairement à l'ouverture passive ci-dessus où rien n'a été tapé.
    // En mode NON STRICT (texte libre, ex. recherche "contient"), ne présélectionne JAMAIS : une
    // suggestion qui matche ce qui est tapé reste une suggestion, pas un remplacement automatique —
    // Entrée doit valider ce qui est RÉELLEMENT tapé (ex. "cam"), pas le compléter silencieusement
    // vers "Webcam HD" juste parce qu'une seule suggestion matche. L'utilisateur choisit une
    // suggestion explicitement (clic, ou ArrowDown puis Entrée), jamais par un Entrée nu.
    function openOnType() {
      currentQuery = inputEl.value;
      matches = filterOptions(options, currentQuery);
      const hasBlank = !!blankLabel;
      if (!matches.length && !hasBlank) { closeList(); return; }
      if (!strict) activeIndex = -1;
      else if (currentQuery === '' && hasBlank) activeIndex = 0;
      else if (matches.length) activeIndex = hasBlank ? 1 : 0;
      else activeIndex = -1;
      showList();
    }

    function finish(value) {
      inputEl.removeAttribute('aria-busy');
      inputEl.value = value;
      lastValidValue = value;
      closeList();
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Le choix d'une valeur qui n'existe pas encore (`pending`) attend `config.prepare` : le champ montre déjà la valeur choisie (`aria-busy`), mais
    // aucun `change` ne part avant que la préparation soit finie. Un refus ou une erreur rend au champ sa valeur d'avant, sans `change`.
    let commitToken = 0;
    function commit(value) {
      const token = ++commitToken; // un choix plus récent l'emporte sur une préparation encore en cours
      const option = optionByValue.get(value);
      if (!option || !option.pending || typeof opts.prepare !== 'function') { finish(value); return; }
      const previous = lastValidValue;
      inputEl.value = value;
      inputEl.setAttribute('aria-busy', 'true');
      closeList();
      const revert = () => {
        inputEl.removeAttribute('aria-busy');
        inputEl.value = previous;
        lastValidValue = previous;
      };
      let outcome;
      try { outcome = Promise.resolve(opts.prepare(value, option)); } catch (e) { outcome = Promise.reject(e); }
      outcome.then((ok) => {
        if (token !== commitToken) return;
        if (ok === false) revert(); else finish(value);
      }, (e) => {
        console.error('[GristBI] choix d\'une colonne liée impossible', e);
        if (token === commitToken) revert();
      });
    }

    function optionCount() {
      return (blankLabel ? 1 : 0) + Math.min(matches.length, visibleMax());
    }

    function valueAt(index) {
      if (blankLabel) {
        if (index === 0) return '';
        return matches[index - 1].value;
      }
      return matches[index].value;
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
        } else {
          // Mode strict, aucune correspondance valide à commiter : `e.preventDefault()` est
          // indispensable ICI aussi, pas seulement dans la branche `commit()` ci-dessus. Sans lui,
          // le NAVIGATEUR déclenche son PROPRE évènement 'change' natif (texte modifié depuis le
          // focus + Entrée pressée) avec la valeur brute/invalide tapée — un évènement qui court-
          // circuite complètement `commit()`/la validation ci-dessus, et que tout code qui écoute
          // 'change' sur ce champ (ex. le sélecteur de table) reçoit comme si c'était une vraie
          // sélection. [DÉFAUT RÉEL trouvé en testant l'autocomplétion des valeurs de filtre : taper le
          // nom d'une table qui n'existe pas encore puis Entrée déclenchait quand même une tentative
          // de connexion à cette table inexistante.] La révision au blur (`isValid`, plus bas) reste
          // le filet de sécurité pour une saisie laissée telle quelle sans jamais presser Entrée.
          e.preventDefault();
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

    // Remplace la liste d'options (comme `fillSelect` pour un <select>) : en mode strict, conserve
    // la valeur actuelle si elle reste valide, sinon revient au blank (si prévu) ou à la 1re
    // option — comme un <select>. En mode `strict: false` (valeurs de filtre, texte libre), la
    // valeur tapée par l'utilisateur n'est PAS une "option" à valider : une liste de suggestions
    // qui se rafraîchit (ex. changement de colonne filtrée) ne doit jamais écraser un texte de
    // recherche déjà saisi, même s'il ne correspond littéralement à aucune valeur connue (c'est
    // justement le cas d'usage d'une recherche "contient" par sous-chaîne).
    inputEl.setOptions = function (newOptions, cfg) {
      options = (newOptions || []).map(normalizeOption);
      optionByValue = new Map(options.map((o) => [o.value, o]));
      grouped = options.some((o) => o.group);
      if (cfg && 'blankLabel' in cfg) blankLabel = cfg.blankLabel || null;
      if (blankLabel) inputEl.placeholder = blankLabel;
      // `keepEmpty` : un champ vide le reste (« Que faire avec cette colonne ? » n'a pas de choix par défaut : la 1re colonne n'y est pas une réponse).
      if (strict && !isValid(inputEl.value)) {
        const stayEmpty = !!blankLabel || (!!(cfg && cfg.keepEmpty) && inputEl.value === '');
        inputEl.value = stayEmpty ? '' : (options[0] ? options[0].value : '');
      }
      lastValidValue = inputEl.value;
    };

    return inputEl;
  }

  return { filterOptions, highlightMatch, normalizeOption, attach };
});
