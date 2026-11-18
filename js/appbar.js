/*
 * Barre unique du widget (audit UI/UX du 18/11/2026, lot 1) : les menus déroulants (Données, Filtre,
 * Vues, Exporter), la navigation au clavier des onglets de page et des menus. Aucune logique métier
 * ici — js/main.js garde les données, les filtres, les modes Lecture/Édition ; ce fichier ne connaît
 * que des éléments marqués dans index.html :
 *
 *   <button data-popover="mon-panneau" aria-expanded="false" aria-haspopup="…">   le bouton
 *   <div id="mon-panneau" class="popover" hidden>…</div>                          le panneau
 *   n'importe quel élément du panneau avec `data-close-popover` : le referme au clic.
 *
 * Un seul panneau ouvert à la fois. Il se ferme : à Échap (le focus revient sur son bouton), à un
 * clic ailleurs, quand le focus sort (Tab), quand on en ouvre un autre. Placé en `position: fixed`
 * sous son bouton, rabattu dans le cadre du widget (le panneau de Grist peut ne faire que 700 × 400).
 *
 * UMD comme js/data.js : les fonctions pures (`placePopover`, `tabKeyTarget`, `menuKeyTarget`, `fitTabsLevel`) se
 * testent sous Node (dev-tests/test-data.js) ; le câblage DOM n'a lieu que dans un navigateur.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(null);
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.appbar = factory(typeof document !== 'undefined' ? document : null);
  }
})(typeof self !== 'undefined' ? self : this, function (doc) {
  'use strict';

  // --- Fonctions pures ---

  // Position d'un panneau sous son bouton. `anchor` : { left, right, bottom } du bouton ;
  // `size` : { width } du panneau ; `viewport` : { width, height } du cadre. Le bord gauche du panneau
  // s'aligne sur celui du bouton ; s'il déborde à droite, c'est son bord droit qui s'aligne sur le
  // bouton ; dans tous les cas il reste à `margin` px des bords. La hauteur maximale ne descend jamais
  // sous 120 px (le panneau défile alors, plutôt que d'être rogné).
  function placePopover(anchor, size, viewport, gap, margin) {
    const g = gap == null ? 6 : gap;
    const m = margin == null ? 8 : margin;
    let left = anchor.left;
    if (left + size.width > viewport.width - m) left = anchor.right - size.width;
    left = Math.max(m, Math.min(left, viewport.width - size.width - m));
    const top = anchor.bottom + g;
    const maxHeight = Math.max(120, viewport.height - top - m);
    return { left, top, maxHeight };
  }

  // Onglet visé par une touche de flèche (bascule circulaire), ou `null` si la touche n'est pas gérée.
  // Même modèle que la navigation d'un tablist ARIA : ← → déplacent, Début/Fin sautent aux extrémités.
  function tabKeyTarget(key, index, count) {
    if (!(count > 0)) return null;
    switch (key) {
      case 'ArrowRight': return (index + 1) % count;
      case 'ArrowLeft': return (index - 1 + count) % count;
      case 'Home': return 0;
      case 'End': return count - 1;
      default: return null;
    }
  }

  // Paliers d'allègement de la barre pour que les onglets de page (la navigation) ne soient pas rognés — essayés dans l'ordre, à partir de
  // la barre complète (palier 0) : 1 = sans le nom de la vue suivie dans le bouton Vues (seulement s'il est affiché : `hasViewName`),
  // 2 = sans les libellés des boutons. Un palier n'est GARDÉ que s'il sert : le palier 2 est abandonné (retour au palier précédent) si les
  // onglets sont encore rognés (beaucoup de pages : les boutons gardent leur texte et les onglets défilent). `clipped()` mesure la barre
  // telle qu'elle est (DOM), `setLevel(n)` pose les classes ; la fonction rend le palier final. Pure : le DOM n'est jamais touché ici.
  function fitTabsLevel(clipped, setLevel, hasViewName) {
    setLevel(0);
    if (!clipped()) return 0;
    let level = 0;
    if (hasViewName) {
      level = 1;
      setLevel(1);
      if (!clipped()) return 1;
    }
    setLevel(2);
    if (!clipped()) return 2;
    setLevel(level);
    return level;
  }

  // Même chose pour un menu vertical : ↑ ↓, Début/Fin. Depuis « aucun élément actif » (`index` -1),
  // ↓ va au premier et ↑ au dernier.
  function menuKeyTarget(key, index, count) {
    if (!(count > 0)) return null;
    switch (key) {
      case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
      case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
      case 'Home': return 0;
      case 'End': return count - 1;
      default: return null;
    }
  }

  // --- Câblage DOM ---

  let openState = null; // { toggle, panel } du panneau actuellement ouvert

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function place() {
    if (!openState) return;
    const { toggle, panel } = openState;
    const r = toggle.getBoundingClientRect();
    const win = doc.defaultView;
    const spot = placePopover(
      { left: r.left, right: r.right, bottom: r.bottom },
      { width: panel.offsetWidth },
      { width: win.innerWidth, height: win.innerHeight }
    );
    panel.style.left = spot.left + 'px';
    panel.style.top = spot.top + 'px';
    panel.style.maxHeight = spot.maxHeight + 'px';
  }

  // Rappels appelés à l'ouverture d'un panneau (après `hidden = false`, AVANT que le focus soit donné) :
  // le menu Filtre y remet son 1er écran, pour que le champ `data-autofocus` soit déjà visible.
  const openHooks = {};
  function onOpen(panelId, fn) { openHooks[panelId] = fn; }

  function closePopovers(returnFocus) {
    if (!openState) return;
    const { toggle, panel } = openState;
    openState = null;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  }

  function openPopover(toggle) {
    const panel = doc.getElementById(toggle.dataset.popover);
    if (!panel) return;
    closePopovers(false);
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    openState = { toggle, panel };
    if (openHooks[panel.id]) openHooks[panel.id]();
    place();
    // Le focus va : à l'élément marqué `data-autofocus` (le champ qu'on veut remplir tout de suite),
    // sinon au 1er élément d'un menu (role="menu"), sinon au panneau lui-même — jamais d'office dans
    // un champ à liste déroulante (un combobox ouvre sa liste au focus : le panneau « Données »
    // s'ouvrirait avec la liste des tables déjà dépliée par-dessus).
    const target = panel.querySelector('[data-autofocus]')
      || (panel.getAttribute('role') === 'menu' ? panel.querySelector('[role="menuitem"]:not([disabled])') : null)
      || panel;
    target.focus();
  }

  function onToggleClick(e) {
    const toggle = e.currentTarget;
    if (toggle.disabled) return;
    if (openState && openState.toggle === toggle) closePopovers(false);
    else openPopover(toggle);
  }

  function onDocumentPointerDown(e) {
    if (!openState) return;
    if (openState.panel.contains(e.target) || openState.toggle.contains(e.target)) return;
    closePopovers(false);
  }

  function onDocumentKeyDown(e) {
    if (!openState) return;
    if (e.key === 'Escape') {
      // Un combobox ouvert dans le panneau consomme d'abord Échap pour fermer sa liste (voir
      // js/combobox.js) : on ne ferme le panneau que si la liste n'était pas ouverte. Ce gestionnaire
      // est enregistré en phase de capture, donc il lit l'état AVANT que le combobox ne la ferme.
      const list = openState.panel.querySelector('.combobox-list:not([hidden])');
      if (list) return;
      e.preventDefault();
      closePopovers(true);
      return;
    }
    if (openState.panel.getAttribute('role') === 'menu') {
      const items = Array.from(openState.panel.querySelectorAll('[role="menuitem"]:not([disabled])'));
      const target = menuKeyTarget(e.key, items.indexOf(doc.activeElement), items.length);
      if (target != null) { e.preventDefault(); items[target].focus(); }
    }
  }

  function onDocumentFocusIn(e) {
    if (!openState) return;
    if (openState.panel.contains(e.target) || openState.toggle.contains(e.target)) return;
    closePopovers(false);
  }

  function onPanelClick(e) {
    if (e.target.closest && e.target.closest('[data-close-popover]')) closePopovers(false);
  }

  function init() {
    if (!doc) return;
    doc.querySelectorAll('[data-popover]').forEach((toggle) => {
      toggle.addEventListener('click', onToggleClick);
      const panel = doc.getElementById(toggle.dataset.popover);
      if (panel) { panel.tabIndex = -1; panel.addEventListener('click', onPanelClick); }
    });
    doc.addEventListener('pointerdown', onDocumentPointerDown, true);
    // En phase de CAPTURE : ce test lit l'état AVANT que le combobox ait fermé sa liste (voir plus haut).
    doc.addEventListener('keydown', onDocumentKeyDown, true);
    doc.addEventListener('focusin', onDocumentFocusIn);
    doc.defaultView.addEventListener('resize', place);
  }

  if (doc) init();

  return { placePopover, tabKeyTarget, menuKeyTarget, fitTabsLevel, init, onOpen, closePopovers: () => closePopovers(false), isOpen: () => !!openState };
});
