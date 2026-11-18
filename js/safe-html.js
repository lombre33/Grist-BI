/*
 * Écriture de HTML dans le DOM : UN SEUL endroit, avec une liste blanche (audit `gwaudit`, règle C-XSS-01, 18/11/2026).
 *
 * Le widget fabrique du balisage à partir de gabarits (`escapeHtml` sur toute valeur qui vient d'une cellule, d'un nom de
 * colonne ou de la configuration) et l'écrit dans la page. Ces gabarits sont corrects aujourd'hui ; ce module est le
 * SECOND mur : si l'un d'eux oubliait un jour d'échapper une valeur, ou si un gabarit futur le faisait, rien de dangereux
 * n'arrive dans la page. `GristBI.safeHtml.setHtml(el, html)` remplace donc `el.innerHTML = html` partout (le code de
 * ce dépôt ET les sept affectations d'ECharts, voir dev-tests/patch-echarts.js).
 *
 * Comment : le texte est analysé par `DOMParser` (document inerte : aucun script ne s'y exécute, aucune image ne s'y charge),
 * puis un NOUVEL arbre est reconstruit dans la page, nœud par nœud, avec seulement les balises et attributs de la liste
 * blanche ci-dessous. Rien n'est jamais re-sérialisé puis ré-analysé (c'est ce qui rend possibles les attaques par
 * mutation) et aucun nœud de l'arbre analysé n'est déplacé tel quel.
 *
 * Ce que la liste blanche refuse, volontairement : `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`,
 * `form`, `img`, `a` (le widget n'a ni lien ni image dans ses gabarits) ; tout attribut `on…` ; `href`, `src`, `action` ;
 * `id`, `name` et `for` (ils shadowent des propriétés de `window`/`document`) ; en SVG `use`, `foreignObject`, `image`,
 * `animate*` et `set` ; dans un style, tout ce qui charge ou exécute (`url(`, `expression`, `@import`…) et `position: fixed`.
 * Pour ajouter une balise ou un attribut à un gabarit : l'ajouter à la liste ci-dessous ET à `dev-tests/test-safe-html.js`.
 *
 * Pur JS pour la politique (testée sous Node : `dev-tests/test-safe-html.js`) ; la reconstruction touche le DOM et se
 * vérifie dans un navigateur : `dev-tests/safe-html-test.html` (double-clic), qui rejoue une batterie de charges hostiles.
 */
(function (root, factory) {
  const api = factory();
  const GristBI = root.GristBI || (root.GristBI = {});
  GristBI.safeHtml = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NS_HTML = 'http://www.w3.org/1999/xhtml';
  const NS_SVG = 'http://www.w3.org/2000/svg';

  // --- Balises ---------------------------------------------------------------------------------
  const HTML_TAGS = new Set([
    'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'em', 'strong', 'u', 'small', 'sub', 'sup', 'mark', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'button', 'input', 'label',
  ]);
  const SVG_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan',
    'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title', 'desc',
  ]);

  // --- Attributs -------------------------------------------------------------------------------
  const TEXT_MAX = 1000;
  const GLOBAL_ATTRIBUTES = {
    'class': (v) => /^[\w\s:.\-]{0,300}$/.test(v),
    'title': (v) => v.length <= 500,
    'role': (v) => /^[a-z-]{1,30}$/.test(v),
    'tabindex': (v) => /^-?\d{1,3}$/.test(v),
    'hidden': () => true,
    'lang': (v) => /^[A-Za-z-]{1,12}$/.test(v),
    'dir': (v) => /^(ltr|rtl|auto)$/.test(v),
  };
  const HTML_TAG_ATTRIBUTES = {
    button: { 'type': (v) => /^(button|submit|reset)$/.test(v), 'disabled': () => true, 'value': (v) => v.length <= TEXT_MAX },
    input: {
      'type': (v) => /^(checkbox|radio|text|number|search)$/.test(v), 'checked': () => true, 'disabled': () => true, 'readonly': () => true,
      'value': (v) => v.length <= TEXT_MAX, 'min': (v) => /^-?[\d.]{1,20}$/.test(v), 'max': (v) => /^-?[\d.]{1,20}$/.test(v),
      'step': (v) => /^[\d.]{1,20}$/.test(v), 'placeholder': (v) => v.length <= 200,
    },
    td: { 'colspan': (v) => /^\d{1,3}$/.test(v), 'rowspan': (v) => /^\d{1,3}$/.test(v) },
    th: { 'colspan': (v) => /^\d{1,3}$/.test(v), 'rowspan': (v) => /^\d{1,3}$/.test(v), 'scope': (v) => /^(col|row|colgroup|rowgroup)$/.test(v) },
    col: { 'span': (v) => /^\d{1,3}$/.test(v) },
    colgroup: { 'span': (v) => /^\d{1,3}$/.test(v) },
    ol: { 'start': (v) => /^-?\d{1,6}$/.test(v) },
  };
  // Attributs de présentation SVG, comparés sans la casse (`viewBox` s'écrit avec une majuscule). Aucun lien (`href`).
  const SVG_ATTRIBUTES = new Set([
    'viewbox', 'preserveaspectratio', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'opacity', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'font-size', 'font-weight', 'font-family', 'text-anchor',
    'dominant-baseline', 'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'focusable',
  ]);
  const SVG_VALUE_MAX = 20000;

  /** Valeur d'attribut SVG : jamais de balisage, jamais de schéma exécutable ; `url(...)` seulement vers un fragment local. */
  function isSafeSvgValue(value) {
    if (value.length > SVG_VALUE_MAX) return false;
    if (/[<>\\]/.test(value)) return false;
    if (/javascript:|vbscript:|data:|expression\s*\(/i.test(value)) return false;
    const urls = value.match(/url\s*\(\s*[^)]*\)/gi) || [];
    return urls.every((u) => /^url\s*\(\s*['"]?#[\w-]+['"]?\s*\)$/i.test(u));
  }

  // --- Style en ligne ---------------------------------------------------------------------------
  const STYLE_PROPERTIES = new Set([
    'color', 'background', 'background-color', 'opacity', 'visibility',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style', 'border-radius',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-collapse', 'border-spacing',
    'box-shadow', 'text-shadow', 'box-sizing',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'display', 'float', 'clear', 'position', 'left', 'top', 'right', 'bottom', 'overflow', 'overflow-x', 'overflow-y', 'vertical-align', 'transform',
    'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap', 'gap', 'row-gap', 'column-gap', 'align-items', 'align-self', 'justify-content',
    'font', 'font-size', 'font-weight', 'font-style', 'font-family', 'font-variant-numeric', 'line-height', 'letter-spacing',
    'text-align', 'text-decoration', 'text-overflow', 'text-transform', 'white-space', 'word-break', 'list-style-type',
  ]);
  const STYLE_VALUE_MAX = 200;
  const STYLE_FORBIDDEN = /url\s*\(|expression|javascript|vbscript|behavior|binding|@|\\|<|>|\/\*|image-set|attr\s*\(|element\s*\(|cross-fade|paint\s*\(|src\s*\(|-webkit-|-moz-/i;
  const STYLE_CHARS = /^[\w\s#%.,()+\-*/'"!]*$/;
  const TRANSFORM_VALUE = /^(\s*(rotate|translate[XY]?|scale[XY]?)\(\s*[-+\d.]+[a-z%]*(\s*,\s*[-+\d.]+[a-z%]*)?\s*\)\s*)+$/i;

  function isAllowedStyleProperty(property) {
    return STYLE_PROPERTIES.has(property) || /^--[a-z0-9-]{1,40}$/.test(property);
  }

  function isSafeStyleValue(property, value) {
    if (!value || value.length > STYLE_VALUE_MAX) return false;
    if (STYLE_FORBIDDEN.test(value) || !STYLE_CHARS.test(value)) return false;
    if (property === 'position') return /^(static|relative|absolute)$/i.test(value);
    if (property === 'transform') return TRANSFORM_VALUE.test(value);
    return true;
  }

  /** Le texte d'un attribut `style` réduit aux déclarations permises ('' si aucune). */
  function cleanStyle(text) {
    const source = String(text).replace(/\/\*[\s\S]*?\*\//g, ' ');
    const kept = [];
    source.split(';').forEach((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 1) return;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (isAllowedStyleProperty(property) && isSafeStyleValue(property, value)) kept.push(property + ':' + value);
    });
    return kept.join(';');
  }

  // --- Décision pour un attribut -----------------------------------------------------------------
  /**
   * Ce que devient l'attribut `name="value"` d'un élément : sa valeur à écrire, ou `null` s'il est retiré.
   * `namespace` : 'html' | 'svg'.
   */
  function attributeValue(namespace, tag, name, value) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) return null;
    if (lower === 'style') { const css = cleanStyle(value); return css || null; }
    if (lower === 'class' || lower === 'role' || lower === 'tabindex' || lower === 'hidden' || lower === 'title' || lower === 'lang' || lower === 'dir') {
      return GLOBAL_ATTRIBUTES[lower](value) ? value : null;
    }
    if (/^aria-[a-z]{1,30}$/.test(lower)) return value.length <= 500 ? value : null;
    if (/^data-[a-z0-9_.:-]{1,60}$/.test(lower)) return value.length <= TEXT_MAX ? value : null;
    if (namespace === 'svg') return SVG_ATTRIBUTES.has(lower) && isSafeSvgValue(value) ? value : null;
    const perTag = HTML_TAG_ATTRIBUTES[tag];
    return perTag && perTag[lower] && perTag[lower](value) ? value : null;
  }

  function isAllowedTag(namespace, localName) {
    const lower = localName.toLowerCase();
    return namespace === 'svg' ? SVG_TAGS.has(lower) : HTML_TAGS.has(lower);
  }

  // --- Reconstruction -----------------------------------------------------------------------------
  const MAX_NODES = 250000;

  /** Copie dans `target` (un document de la page) les enfants de `source` (un nœud du document inerte) qui passent la liste blanche. */
  function copyChildren(source, destination, targetDocument) {
    const stack = [{ source, destination }];
    let budget = MAX_NODES;
    while (stack.length && budget > 0) {
      const frame = stack.pop();
      for (let node = frame.source.firstChild; node && budget > 0; node = node.nextSibling) {
        budget--;
        if (node.nodeType === 3) { frame.destination.appendChild(targetDocument.createTextNode(node.data)); continue; }
        if (node.nodeType !== 1) continue; // commentaires, instructions : jamais recopiés
        const namespace = node.namespaceURI === NS_SVG ? 'svg' : node.namespaceURI === NS_HTML ? 'html' : '';
        if (!namespace || !isAllowedTag(namespace, node.localName)) continue; // la balise ET ce qu'elle contient disparaissent
        const copy = namespace === 'svg' ? targetDocument.createElementNS(NS_SVG, node.localName) : targetDocument.createElement(node.localName);
        for (let i = 0; i < node.attributes.length; i++) {
          const attribute = node.attributes[i];
          const kept = attributeValue(namespace, node.localName.toLowerCase(), attribute.name, attribute.value);
          if (kept !== null) copy.setAttribute(attribute.name, kept);
        }
        frame.destination.appendChild(copy);
        stack.push({ source: node, destination: copy });
      }
    }
  }

  /** Le balisage `html`, assaini, en fragment du document `targetDocument` (celui de la page par défaut). */
  function fragment(html, targetDocument, contextNamespace) {
    const documentTarget = targetDocument || document;
    const out = documentTarget.createDocumentFragment();
    const text = html === null || html === undefined ? '' : String(html);
    if (!text) return out;
    const inSvg = contextNamespace === NS_SVG;
    const parsed = new DOMParser().parseFromString('<!doctype html><body>' + (inSvg ? '<svg>' + text + '</svg>' : text), 'text/html');
    const start = inSvg ? parsed.body.firstChild : parsed.body;
    if (start) copyChildren(start, out, documentTarget);
    return out;
  }

  /** Remplace le contenu de `element` par `html` assaini (le remplaçant de `element.innerHTML = html`). */
  function setHtml(element, html) {
    const built = fragment(html, element.ownerDocument, element.namespaceURI);
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(built);
  }

  return {
    setHtml,
    fragment,
    cleanStyle,
    attributeValue,
    isAllowedTag,
    isAllowedStyleProperty,
    isSafeStyleValue,
    isSafeSvgValue,
    HTML_TAGS: Array.from(HTML_TAGS),
    SVG_TAGS: Array.from(SVG_TAGS),
    STYLE_PROPERTIES: Array.from(STYLE_PROPERTIES),
  };
});
