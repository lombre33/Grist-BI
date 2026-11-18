/*
 * Photographie du tableau de bord (18/11/2026, correction des exports PDF/PPTX demandée par Antoine : « il faut garder le
 * côté tableau de bord, donc même visuel »). L'ancien export recomposait chaque tuile à part (titre + image ou tableau brut)
 * dans un document qui s'écoule : les cartes s'empilaient, un KPI devenait « 567.0545607638886 » et le style, la grille et la
 * disposition de la page n'existaient plus. Ici on prend la page TELLE QU'ELLE EST DESSINÉE : mêmes cartes, même style (Standard,
 * Fluide, Éditorial, Console, Verre dépoli), même disposition (Grille, Rapport, Planche, Vedette, Rail), toutes les tuiles
 * (KPI, table, tableau croisé, texte, progression, Gantt… comprises, sans les recoder une à une).
 *
 * Principe, sans aucune bibliothèque : le sous-arbre est cloné, chaque élément reçoit en ligne les styles CALCULÉS par le
 * navigateur (donc les `@container`, les variables CSS et le style global sont déjà résolus), puis le clone est dessiné par le
 * navigateur lui-même (SVG `<foreignObject>` -> image -> canvas). Deux écarts voulus avec l'écran :
 *  - les graphiques ECharts (des <canvas> que le clonage ne copie pas) sont remplacés par leur propre image haute résolution
 *    (`instance.getDataURL({pixelRatio})`), plus nette qu'une capture de l'écran ;
 *  - les boutons d'action des tuiles (`.tile-actions` : agrandir, commentaires, modifier…) et les barres de défilement ne sont
 *    pas dessinés : un PDF n'est pas une page interactive.
 * Limites connues (HYPOTHESES.md) : une tuile rognée à l'écran (un tableau qui déborde de sa carte) l'est aussi dans le fichier —
 * l'agrandir (bouton de la tuile) avant d'exporter la montre en entier ; le défilement interne d'une tuile n'est pas reproduit.
 *
 * Pur navigateur pour `capture` ; `pickScale`/`cleanXmlText` sont purs et testés sous Node.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Éléments qu'une photographie ne doit jamais copier.
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'iframe', 'object', 'embed', 'audio', 'video', 'dialog']);
  // Boutons d'action d'une tuile et tout ce qui est marqué comme interactif seulement.
  const DEFAULT_EXCLUDE = '.tile-actions, .tile-resize, [data-export-skip]';
  // Attributs d'un élément HTML qui servent encore dans l'image (tout le reste est retiré : la feuille de style n'existe pas là-bas).
  const KEEP_HTML_ATTRS = { img: ['src', 'width', 'height', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], col: ['span'], colgroup: ['span'] };

  // Échelle de rendu : celle demandée (2 = écran dense), réduite pour qu'un tableau de bord très haut ne dépasse jamais les limites d'un
  // canvas (côté et surface) — mieux vaut un fichier un peu moins net qu'un export qui échoue.
  function pickScale(width, height, wanted, maxSide, maxArea) {
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const want = wanted > 0 ? wanted : 2;
    return Math.min(want, (maxSide || 16000) / Math.max(w, h), Math.sqrt((maxArea || 30e6) / (w * h)));
  }

  // Un texte venu d'une cellule peut contenir un caractère interdit en XML (\u0008, \u0000…) ou un demi-couple de substitution :
  // l'image SVG ne se chargerait plus du tout. On les retire/remplace plutôt que de perdre toute la photographie.
  function cleanXmlText(text) {
    const s = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
    return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s;
  }

  // Valeurs par défaut d'une balise dans un document vierge : une propriété égale à son défaut n'est pas recopiée (un élément
  // passe de ~350 propriétés à ~25, donc une photographie de quelques centaines de Ko et non de dizaines de Mo). Retombe sur
  // « tout recopier » si le document vierge ne peut pas être créé.
  function createDefaultsProvider() {
    let frame = null;
    let frameDoc = null;
    let svgHost = null;
    const cache = new Map();
    function ensureFrame() {
      if (frameDoc) return true;
      try {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;visibility:hidden;pointer-events:none';
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.open();
        doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
        doc.close();
        svgHost = doc.createElementNS(SVG_NS, 'svg');
        doc.body.appendChild(svgHost);
        frameDoc = doc;
        return true;
      } catch (e) {
        frameDoc = null;
        return false;
      }
    }
    function defaultsFor(el) {
      const isSvg = el.namespaceURI === SVG_NS;
      const key = (isSvg ? 'svg:' : '') + el.localName;
      if (cache.has(key)) return cache.get(key);
      let map = null;
      if (ensureFrame()) {
        try {
          const probe = isSvg ? frameDoc.createElementNS(SVG_NS, el.localName) : frameDoc.createElement(el.localName);
          const parent = isSvg && el.localName !== 'svg' ? svgHost : frameDoc.body;
          parent.appendChild(probe);
          const cs = frame.contentWindow.getComputedStyle(probe);
          map = new Map();
          for (let i = 0; i < cs.length; i++) map.set(cs[i], cs.getPropertyValue(cs[i]));
          parent.removeChild(probe);
        } catch (e) { map = null; }
      }
      cache.set(key, map);
      return map;
    }
    function dispose() { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); frame = null; frameDoc = null; svgHost = null; }
    return { defaultsFor, dispose };
  }

  // Style calculé -> attribut `style` du clone, sans les propriétés qui valent déjà leur défaut.
  function inlineComputedStyle(clone, cs, defaults) {
    const parts = [];
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      const value = cs.getPropertyValue(name);
      if (defaults && defaults.get(name) === value) continue;
      parts.push(name + ':' + value);
    }
    clone.setAttribute('style', parts.join(';'));
  }

  function setStyle(clone, name, value) { clone.style.setProperty(name, value); }

  // Les <canvas> d'ECharts : pour chacun, l'élément qui le porte (le <div> que zrender crée dans le conteneur du graphique) et son
  // instance. Un <canvas> qui n'est pas ECharts (le nuage de mots) est recopié tel quel plus bas.
  function findChartHosts(root) {
    const hosts = new Map();
    if (!global.echarts || typeof global.echarts.getInstanceByDom !== 'function') return hosts;
    for (const canvas of root.querySelectorAll('canvas')) {
      const host = canvas.parentElement;
      if (!host || hosts.has(host)) continue;
      let instance = null;
      for (let node = host.parentElement, depth = 0; node && node !== root && depth < 3 && !instance; node = node.parentElement, depth++) {
        instance = global.echarts.getInstanceByDom(node);
      }
      if (instance && !(instance.isDisposed && instance.isDisposed())) hosts.set(host, instance);
    }
    return hosts;
  }

  function probeChart(instance) {
    try { return instance.getDataURL({ type: 'png', pixelRatio: 0.25, backgroundColor: 'rgba(0,0,0,0)' }); } catch (e) { return ''; }
  }

  // Attend que les graphiques aient fini de se dessiner : plus de « Calcul… » (agrégation DuckDB en cours), puis plus d'animation
  // d'entrée (deux vignettes successives identiques). Sans cela, un export lancé juste après un clic de filtre ou un changement de style
  // photographie des barres à moitié sorties. Borné : un graphique qui ne se stabilise jamais ne bloque pas l'export.
  async function settleCharts(hosts, maxMs) {
    const charts = GristBI.charts;
    if (charts && typeof charts.whenSettled === 'function') await charts.whenSettled(15000);
    const instances = Array.from(hosts.values());
    if (!instances.length) return true;
    const deadline = Date.now() + (maxMs || 4000);
    let previous = null;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const signature = instances.map(probeChart).join('|');
      if (signature === previous) return true;
      previous = signature;
      if (Date.now() > deadline) return false;
    }
  }

  // L'image haute résolution de chaque instance (`pixelRatio` = l'échelle de la photographie) : plus nette que le canvas de l'écran.
  function renderChartHosts(hosts, scale) {
    const rendered = new Map();
    for (const [host, instance] of hosts) {
      try {
        const url = instance.getDataURL({ type: 'png', pixelRatio: scale, backgroundColor: 'rgba(0,0,0,0)' });
        rendered.set(host, { url, width: host.clientWidth || instance.getWidth(), height: host.clientHeight || instance.getHeight() });
      } catch (e) { /* ce graphique reste vide dans la photographie, les autres tuiles sont sauvées */ }
    }
    return rendered;
  }

  function imageElement(doc, url, width, height) {
    const img = doc.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('width', String(Math.round(width)));
    img.setAttribute('height', String(Math.round(height)));
    img.setAttribute('style', 'display:block;width:' + width + 'px;height:' + height + 'px');
    return img;
  }

  function cloneTree(src, ctx) {
    const doc = src.ownerDocument;
    if (src.nodeType === 3) return doc.createTextNode(cleanXmlText(src.nodeValue));
    if (src.nodeType !== 1) return null;
    const tag = src.localName;
    if (SKIP_TAGS.has(tag)) return null;
    if (ctx.exclude && src.matches(ctx.exclude)) return null;
    const cs = global.getComputedStyle(src);
    if (cs.display === 'none') return null;

    const isSvg = src.namespaceURI === SVG_NS;
    // <canvas> qui n'est pas celui d'ECharts (nuage de mots) : son contenu, à sa résolution.
    if (tag === 'canvas') {
      let url = '';
      try { url = src.toDataURL('image/png'); } catch (e) { return null; }
      const w = src.clientWidth || src.width;
      const h = src.clientHeight || src.height;
      const img = imageElement(doc, url, w, h);
      inlineComputedStyle(img, cs, ctx.defaults.defaultsFor(doc.createElement('img')));
      setStyle(img, 'display', cs.display === 'inline' ? 'inline-block' : cs.display);
      setStyle(img, 'width', w + 'px');
      setStyle(img, 'height', h + 'px');
      return img;
    }

    const clone = src.cloneNode(false);
    // Attributs : la feuille de style n'existe pas dans l'image, donc ni classes ni ids ; un SVG garde sa géométrie.
    for (const attr of Array.from(clone.attributes)) {
      const name = attr.name;
      const keep = isSvg ? (name !== 'class' && name !== 'style' && name !== 'id' && !/^(data-|aria-|on)/i.test(name))
        : (KEEP_HTML_ATTRS[tag] || []).indexOf(name) !== -1;
      if (!keep) clone.removeAttribute(name);
      else if (isSvg || tag === 'img') clone.setAttribute(name, cleanXmlText(attr.value));
    }
    inlineComputedStyle(clone, cs, ctx.defaults.defaultsFor(src));

    // Barres de défilement : une photographie n'en dessine pas (le contenu rogné l'est comme à l'écran).
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') setStyle(clone, 'overflow-x', 'hidden');
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') setStyle(clone, 'overflow-y', 'hidden');

    // Zone d'un graphique ECharts : l'image de l'instance remplace le <canvas> (jamais copié).
    const chart = ctx.hosts.get(src);
    if (chart) {
      clone.appendChild(imageElement(doc, chart.url, chart.width, chart.height));
      return clone;
    }
    if (tag === 'textarea') clone.textContent = cleanXmlText(src.value);
    if (tag === 'input') clone.setAttribute('value', cleanXmlText(src.value));
    for (let child = src.firstChild; child; child = child.nextSibling) {
      const copy = cloneTree(child, ctx);
      if (copy) clone.appendChild(copy);
    }
    return clone;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image SVG illisible'));
      img.src = url;
    });
  }

  function isTainted(ctx2d) {
    try { ctx2d.getImageData(0, 0, 1, 1); return false; } catch (e) { return true; }
  }

  // Dessine le SVG dans un canvas. Adresse `data:` d'abord, `blob:` ensuite : dans Chromium une image `blob:` avec <foreignObject> SALIT
  // le canvas (toDataURL lèverait une erreur de sécurité) alors qu'une image `data:` ne le fait pas ; dans un autre navigateur ou un cadre
  // à origine opaque (celui de GFS) l'inverse est possible. Un canvas sali le reste pour toujours : un NOUVEAU canvas à chaque essai.
  async function paintSvg(svgText, width, height, scale) {
    let lastError = null;
    const attempts = [
      () => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText),
      () => URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    ];
    for (const makeUrl of attempts) {
      const url = makeUrl();
      try {
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const c2d = canvas.getContext('2d', { willReadFrequently: true });
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (isTainted(c2d)) throw new Error('canvas contaminé');
        return canvas;
      } catch (e) {
        lastError = e;
      } finally {
        if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url);
      }
    }
    throw lastError || new Error('photographie impossible');
  }

  function parseRgb(css) {
    const m = /rgba?\(([^)]+)\)/.exec(css || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function luminanceOf(rgb) {
    const linearize = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
  }

  // Fond de la page derrière les tuiles : celui de <body> (couleur + dégradé du style Verre dépoli), sinon celui de <html>, sinon
  // un fond qui contraste avec le texte (une ambiance de GFS peut laisser le fond transparent : jamais du texte blanc sur du blanc).
  function pageBackground() {
    const body = document.body;
    const html = document.documentElement;
    const textRgb = parseRgb(global.getComputedStyle(body).color) || { r: 0, g: 0, b: 0, a: 1 };
    let color = null;
    let image = 'none';
    for (const el of [body, html]) {
      const cs = global.getComputedStyle(el);
      const rgb = parseRgb(cs.backgroundColor);
      if (image === 'none' && cs.backgroundImage && cs.backgroundImage !== 'none') image = cs.backgroundImage;
      if (rgb && rgb.a > 0.99) { color = cs.backgroundColor; break; }
    }
    if (!color) color = luminanceOf(textRgb) > 0.5 ? '#1c1c1e' : '#ffffff';
    return { color, image, text: global.getComputedStyle(body).color };
  }

  // Photographie de `element` (le plus souvent `#workspace-main`) dans un canvas.
  //   options.scale     finesse voulue (2 par défaut), réduite si la page est très haute
  //   options.pad       marge autour des tuiles, en px (16 : celle de <body>)
  //   options.header    { node, height } : un bandeau déjà stylé en ligne, posé au-dessus des tuiles (titre de la page, filtres)
  //   options.exclude   sélecteur des éléments à ne pas dessiner (défaut : boutons d'action des tuiles)
  //   options.skipSettle  ne pas attendre la fin des calculs/animations (déjà attendue par une photographie précédente)
  // Rend { canvas, width, height, scale } (width/height en px CSS).
  async function capture(element, options) {
    const opts = options || {};
    const pad = opts.pad == null ? 16 : opts.pad;
    const rect = element.getBoundingClientRect();
    const innerW = Math.max(1, Math.ceil(rect.width));
    const innerH = Math.max(1, Math.ceil(rect.height));
    const headerH = opts.header ? opts.header.height : 0;
    const width = innerW + pad * 2;
    const height = headerH + innerH + pad * 2;
    const scale = pickScale(width, height, opts.scale, opts.maxSide, opts.maxArea);

    // La souris reste souvent sur une tuile (le bouton « Exporter » vient de se refermer dessus) : sa carte serait photographiée soulevée
    // (ombre de survol). Sans cible possible, le navigateur retire l'état :hover à l'image suivante, que l'attente ci-dessous laisse passer.
    const previousPointerEvents = element.style.pointerEvents;
    element.style.pointerEvents = 'none';
    let chartHosts;
    try {
      chartHosts = findChartHosts(element);
      if (!opts.skipSettle) await settleCharts(chartHosts, opts.settleMs);
    } catch (e) {
      element.style.pointerEvents = previousPointerEvents;
      throw e;
    }

    const bg = pageBackground();
    const defaults = createDefaultsProvider();
    let svgText;
    try {
      const ctx = { defaults, hosts: renderChartHosts(chartHosts, scale), exclude: opts.exclude === undefined ? DEFAULT_EXCLUDE : opts.exclude };
      const doc = element.ownerDocument;
      const inner = cloneTree(element, ctx);
      if (!inner) throw new Error('rien à photographier');
      setStyle(inner, 'width', innerW + 'px');
      setStyle(inner, 'height', innerH + 'px');
      setStyle(inner, 'margin', '0');
      setStyle(inner, 'position', 'relative');
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('style', [
        'box-sizing:border-box', 'position:relative', 'overflow:hidden',
        'width:' + width + 'px', 'height:' + height + 'px', 'padding:' + pad + 'px',
        'background-color:' + bg.color, 'background-image:' + bg.image, 'background-size:100% 100%',
        'color:' + bg.text, 'font-family:' + global.getComputedStyle(document.body).fontFamily,
        'font-size:13px', 'line-height:1.5', '-webkit-font-smoothing:antialiased'
      ].join(';'));
      if (opts.header && opts.header.node) wrapper.appendChild(opts.header.node);
      wrapper.appendChild(inner);
      const xhtml = new XMLSerializer().serializeToString(wrapper);
      svgText = '<svg xmlns="' + SVG_NS + '" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'
        + '<foreignObject x="0" y="0" width="100%" height="100%">' + xhtml + '</foreignObject></svg>';
    } finally {
      defaults.dispose();
      element.style.pointerEvents = previousPointerEvents;
    }
    const canvas = await paintSvg(svgText, width, height, scale);
    return { canvas, width, height, scale };
  }

  // ---- Page entière : bandeau (titre, jeu de données, filtres actifs) + tuiles ------------------------------------------------------

  function currentPageOf(state) {
    return state.pages.find((p) => p.id === state.currentPageId) || state.pages[0] || null;
  }

  function textOf(id) {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Filtres actifs tels que la barre les écrit (mêmes libellés, déjà traduits) + la vue sauvegardée suivie.
  function activeFilterLabels() {
    return Array.from(document.querySelectorAll('#filter-badges .filter-chip, #advanced-filter-badges .filter-chip'))
      .map((chip) => chip.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function styledDiv(css, text) {
    const div = document.createElement('div');
    div.setAttribute('style', css);
    if (text != null) div.textContent = cleanXmlText(text);
    return div;
  }

  // Bandeau au-dessus des tuiles : nom de la page, jeu de données et date, puis (seulement s'il y en a) la vue suivie et les filtres
  // actifs — un fichier exporté ne montre plus la barre de l'outil, il doit dire à quoi correspondent les chiffres. Tout est stylé en ligne :
  // ce nœud n'est pas passé par le clonage des styles calculés.
  function buildHeader(page, bg) {
    const t = GristBI.i18n.t;
    const lang = GristBI.i18n.getLang();
    const filters = activeFilterLabels();
    const viewChip = document.getElementById('view-chip');
    const viewName = viewChip && !viewChip.hidden ? textOf('view-chip-name') : '';
    const dataset = [textOf('data-pill-name'), textOf('row-count')].filter((x) => x && x !== '…').join(' · ');
    let date = '';
    try { date = new Date().toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { date = ''; }
    const lines = [];
    if (viewName) lines.push(t('views.chip.label') + ' : ' + viewName);
    if (filters.length) lines.push(t('export.header.filters') + ' : ' + filters.join(' · '));
    const rowH = 30;
    const lineH = 19;
    const height = rowH + lines.length * lineH + 12;
    const head = styledDiv('box-sizing:border-box;height:' + height + 'px;padding:0 2px 12px;overflow:hidden;color:' + bg.text, null);
    const top = styledDiv('display:flex;justify-content:space-between;align-items:baseline;gap:16px;height:' + rowH + 'px;line-height:' + rowH + 'px', null);
    top.appendChild(styledDiv('font-size:19px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0', page.name));
    top.appendChild(styledDiv('font-size:12px;opacity:0.7;white-space:nowrap;flex:none', [dataset, date].filter(Boolean).join(' · ')));
    head.appendChild(top);
    for (const line of lines) head.appendChild(styledDiv('font-size:12px;line-height:' + lineH + 'px;height:' + lineH + 'px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', line));
    return { node: head, height };
  }

  // La page affichée (la zone de travail : tuiles, tuiles agrandies, avec leur disposition et leur style) + son bandeau.
  async function capturePage(state, options) {
    const page = currentPageOf(state);
    const main = document.getElementById('workspace-main');
    if (!page || !main) throw new Error('page à photographier introuvable');
    const bg = pageBackground();
    const shot = await capture(main, Object.assign({ header: buildHeader(page, bg) }, options));
    return Object.assign({ pageName: page.name }, shot);
  }

  // Une tuile seule (la carte telle qu'à l'écran, marge comprise) : une diapositive par tuile dans le PPTX.
  async function captureTile(tileId, options) {
    const el = Array.from(document.querySelectorAll('#workspace-main .tile')).find((node) => node.getAttribute('data-tile-id') === String(tileId));
    if (!el) return null;
    return capture(el, Object.assign({ pad: 12 }, options));
  }

  // Un canvas -> Blob (PNG ou JPEG).
  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas vide'))), type, quality);
    });
  }

  // Téléchargement d'un fichier généré (même technique que js/export.js : ancre `download` dans le DOM le temps d'un clic synthétique ;
  // dans le cadre isolé de GFS, GFS déclare `allow-downloads`).
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }

  const api = { capture, capturePage, captureTile, canvasToBlob, downloadBlob, pickScale, cleanXmlText, pageBackground, currentPageOf, DEFAULT_EXCLUDE };
  GristBI.snapshot = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
