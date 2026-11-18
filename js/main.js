/*
 * Bootstrap de l'UI : formulaire d'ajout/édition de tuile, rendu de la grille et des filtres
 * croisés actifs, câblage store <-> GristBI.api (connexion à la table de travail + persistance
 * config). Le widget se connecte automatiquement à la 1re table du document au démarrage (voir
 * bootstrap() ci-dessous) plutôt que d'attendre un clic ou une table liée dans la page.
 *
 * Ce fichier est le POINT D'ENTRÉE : démarrage (`bootstrap`), langue, thème des graphiques, style et disposition
 * des tuiles. Le reste est coupé par responsabilité et se charge AVANT lui, dans l'ordre : main-core.js (socle),
 * main-fields.js, main-form.js (formulaire de tuile), main-panel.js, main-filters.js, main-dialogs.js,
 * main-render.js (rendu de la page), main-session.js (table de travail, sauvegarde). Ils partagent
 * GristBI.mainParts (interne : ne pas s'en servir ailleurs) ; `mainParts.S` porte l'état modifiable partagé.
 */
(function (global) {
  'use strict';
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.mainParts;
  const S = parts.S;
  const { t } = GristBI.i18n;
  const {
    connectToFirstTable, layoutHintEl, layoutOptionsEl, openBlankReport, openModelById, openReportById,
    refreshBlendPicker, refreshColumnSelects, refreshTilePanelTexts, render, setConnectionState, store,
    styleOptionsEl, updateFormFieldsForType
  } = parts;
  Object.assign(parts, {
    refreshLayoutOptions, refreshStyleOptions
  });
 // cartes de choix du style des tuiles, voir renderStyleOptions
  const styleExtraInputs = { hideBorders: document.getElementById('settings-opt-hideBorders'), uniform: document.getElementById('settings-opt-uniform') };

  // La barre collante change de hauteur (2 lignes en étroit, rangée de pastilles de filtre) : le
  // panneau collant et les ancres de défilement en ont besoin (`--chrome-h`, voir css/style.css).
  const chromeEl = document.getElementById('chrome');

  function syncChromeHeight() {
    document.documentElement.style.setProperty('--chrome-h', `${Math.round(chromeEl.getBoundingClientRect().height)}px`);
  }

  syncChromeHeight();

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncChromeHeight).observe(chromeEl);

  window.addEventListener('resize', () => GristBI.charts.resizeAll());

  // `window`.resize ne se déclenche pas forcément de façon fiable quand c'est le panneau Grist
  // hébergeant l'iframe du widget qui change de taille (ouverture d'un panneau latéral, colonne
  // redimensionnée...) plutôt que la fenêtre du navigateur elle-même. ResizeObserver observe
  // directement la boîte du conteneur, donc capte aussi ce cas.
  if (typeof ResizeObserver !== 'undefined') {
    let resizeRaf = null;
    const observer = new ResizeObserver(() => {
      // Coalesce : ResizeObserver peut déclencher plusieurs callbacks par frame pendant un
      // redimensionnement continu ; un seul resizeAll() par frame suffit.
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        GristBI.charts.resizeAll();
      });
    });
    observer.observe(document.body);
  }

  // Premier rendu explicite, synchrone, AVANT que bootstrap() (plus bas, jamais attendu ici) n'ait pu
  // résoudre quoi que ce soit : `store.subscribe` seul ne peint rien tant qu'aucune mutation d'état
  // n'a eu lieu, or un document SANS aucune table utilisateur ne déclenche jamais switchTable() — la
  // seule mutation d'état qui ferait naturellement tourner `render()` ailleurs (ex. store.setPages()
  // dans switchTable). Sans cet appel, `status.noTables`/setTableDependentControlsEnabled restaient
  // inertes indéfiniment dans ce cas précis : le DOM gardait tel quel le HTML statique de départ
  // (formulaire d'ajout de tuile pleinement interactif mais inopérant) — repéré lors de l'audit UX du
  // 21/10/2026 en testant un document réellement vide. Repeint sans effet de bord dans le cas normal
  // (une table est trouvée) : switchTable() déclenchera de toute façon ses propres rendus juste après.
  render(store.getState());

  async function bootstrap() {
    await GristBI.api.init();
    setConnectionState('connecting');

    // Consigne GFS 007, point 3 : si GFS demande d'ouvrir un rapport précis (ou un départ vierge,
    // "Nouveau"), ce départ remplace la connexion automatique habituelle ci-dessous - jamais
    // l'inverse. `opening()` reste `null` hors GFS, et dans GFS tant qu'aucune route précise n'est
    // donnée : dans les deux cas, tout ce qui suivait déjà cette ligne avant cette consigne reste
    // inchangé (branche `else`).
    const linkedGfs = await S.gfsLinkReady;
    let opening = null;
    if (linkedGfs && linkedGfs.hosted) {
      await linkedGfs.ready;
      opening = linkedGfs.opening();
    }

    if (opening && opening.fichier) {
      try {
        await openReportById(opening.fichier.id);
      } catch (e) {
        console.error('[GristBI] échec de l\'ouverture du rapport demandé par GFS', e);
        setConnectionState('failed');
      }
    } else if (opening && opening.modele) {
      // Consigne GFS 016 : le modèle choisi dans GFS démarre l'app. S'il ne s'ouvre pas (id inconnu,
      // aucune table qui convienne), la raison est dite dans une fenêtre (openModelById) et l'app
      // démarre comme d'habitude sur la première table, avec son rapport déjà enregistré — jamais
      // un rapport vierge qui ferait croire que le modèle s'est ouvert.
      if (!(await openModelById(opening.modele.id, opening.type))) await connectToFirstTable();
    } else if (opening) {
      await openBlankReport(); // gère déjà son propre try/catch
    } else {
      await connectToFirstTable();
    }
    // Table dédiée, indépendante de la table de travail (voir js/state.js:comments) : chargée UNE
    // SEULE fois par session, jamais rechargée à un changement de table (switchTable) — dans un
    // try/catch séparé pour qu'un échec ici (ex. table de commentaires non créable) n'empêche
    // jamais l'affichage du dashboard lui-même, la vraie raison d'être du widget.
    try {
      const { rows: commentRows } = await GristBI.api.loadOrCreateComments();
      store.setComments(commentRows);
    } catch (e) {
      console.error('[GristBI] échec de la connexion à la table de commentaires collaboratifs (BI_Dashboard_Comments) — les commentaires resteront indisponibles pour cette session', e);
    }
    // Détection de l'auteur courant (table-sonde BI_Dashboard_UserProbe, voir js/grist-api.js) :
    // UNE SEULE fois par session, comme les commentaires ci-dessus — l'identité ne change pas en
    // cours de route. `detectedUserEmail` reste à `null` (repli sur la saisie manuelle inchangée,
    // voir openCommentsModal) si cette détection échoue pour n'importe quelle raison (widget hors
    // Grist, mock de dev-tests/ qui ne simule pas le moteur de formules, droits insuffisants...) —
    // try/catch séparé pour la même raison que les commentaires : jamais bloquant pour le dashboard.
    try {
      S.detectedUserEmail = await GristBI.api.getCurrentUserEmail();
    } catch (e) {
      console.error('[GristBI] échec de la détection automatique de l\'auteur courant — repli sur la saisie manuelle', e);
    }
  }

  // Sélecteur de langue (panneau Réglages, radio-boutons fr/en) : persisté par GristBI.i18n
  // (localStorage). Même placement de référence que Publipostage+ (js/settings.js de ce widget
  // frère) — une langue choisie une fois n'a pas besoin d'une place permanente dans le bandeau, qui
  // porte déjà les exports, Réglages et le logo (demande du coordinateur du 29/09/2026, après un
  // premier jet en bouton de bandeau). onChange (voir js/i18n.js) couvre tout ce qu'aucun attribut
  // data-i18n-* ne peut porter parce que ça dépend d'un autre état que la langue : le libellé
  // Dimension/Mesure selon le type de tuile choisi (updateFormFieldsForType) et le texte du bouton
  // Ajouter/Modifier selon le mode édition (submitTileBtn) — puis un render() complet pour tout le
  // reste (tuiles, badges, pages).
  const langRadios = Array.from(document.querySelectorAll('input[name="settings-lang"]'));

  function refreshLangRadios() {
    const lang = GristBI.i18n.getLang();
    langRadios.forEach((r) => { r.checked = (r.value === lang); });
  }

  langRadios.forEach((radio) => {
    radio.addEventListener('change', () => { if (radio.checked) GristBI.i18n.setLang(radio.value); });
  });

  GristBI.i18n.onChange(() => {
    refreshLangRadios();
    // Rafraîchit aussi le blankLabel "(aucun)"/"(none)" des comboboxes optionnelles (drill-down,
    // Tendance vs) : c'est `Combobox.setOptions` (js/combobox.js) qui l'écrit dans `.placeholder`
    // au moment de l'appel, jamais relu automatiquement — sans ce rappel, le placeholder resterait
    // figé dans l'ancienne langue après un changement, contrairement au reste du formulaire.
    // `setOptions` en mode strict garde la valeur déjà choisie si elle reste valide (voir
    // combobox.js), donc sans effet de bord sur une tuile en cours d'édition.
    refreshColumnSelects(store.getState().rows);
    // Même raison, pour le blankLabel "(aucune)"/"(none)" des 3 comboboxes de data blending — sans
    // toucher au reste : refreshBlendPicker() ne fait que reposer les options/valeurs déjà connues
    // (currentBlend/currentPrimaryRows inchangés), ne relance aucune jointure.
    refreshBlendPicker();
    updateFormFieldsForType();
    refreshTilePanelTexts();
    render(store.getState());
  });

  // Thème des graphiques (audit de lisibilité, lot 4) : `js/charts.js` lit les jetons de couleur de la page à CHAQUE
  // rendu (infobulle, quadrillage, texte), mais rien ne relançait un rendu quand ils changent — passage clair/sombre du
  // système, ambiance de GFS posée sur <html> par le CSSOM. On compare une signature des jetons lus (jamais un rendu à
  // chaque mutation de <html> : `--chrome-h` y est réécrit à chaque redimensionnement de la barre).
  (function watchChartTheme() {
    const TOKENS = ['--text', '--text-secondary', '--text-muted', '--surface', '--dash-tile-surface', '--border', '--border-strong'];
    const signature = () => {
      const cs = getComputedStyle(document.documentElement);
      return TOKENS.map((n) => cs.getPropertyValue(n).trim()).join('|');
    };
    let last = signature();
    let timer = null;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = signature();
        if (now === last) return;
        last = now;
        render(store.getState());
      }, 120);
    };
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', check); else if (mq.addListener) mq.addListener(check);
    } catch (e) { /* pas de matchMedia (hors navigateur) : seul l'observateur ci-dessous reste */ }
    try {
      new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    } catch (e) { /* idem */ }
  })();

  // Consigne GFS 007, point 3 : dans GFS, `gristbi_lang` passe par `GfsLink.storageSet` plutôt que
  // `localStorage`, peu fiable dans le sous-cadre isolé de GFS — `GristBI.i18n.setLang` essaie
  // quand même `localStorage` de son côté (voir js/i18n.js), sans effet dans ce cas, harmless. La
  // LANGUE elle-même (quel fr/en est actif) reste pilotée par GFS via `GfsLink.onLanguage`
  // (ci-dessus, tête de fichier) : ceci n'est qu'une sauvegarde de secours, jamais la source de
  // vérité tant que ce widget est hébergé.
  GristBI.i18n.onChange((lang) => { if (S.gfsLink && S.gfsLink.hosted) S.gfsLink.storageSet('gristbi_lang', lang); });

  refreshLangRadios();

  // Style global des tuiles (js/styles.js, css/dash-styles.css) : une carte par style dans le menu Réglages, construites d'après
  // le registre pour qu'un style ajouté y apparaisse sans toucher au HTML. Le texte vient de `data-i18n` (résolu par
  // `applyTranslations()` à chaque rendu, donc il suit un changement de langue) ; la pastille est un aperçu fait des MÊMES jetons CSS
  // que les tuiles (`.style-swatch[data-dash-style]`), jamais une image. Choisir un style passe par le store : `render()` pose le
  // style, redessine toutes les tuiles et planifie la sauvegarde dans la configuration du tableau de bord.
  function renderStyleOptions() {
    if (!styleOptionsEl) return;
    styleOptionsEl.textContent = '';
    GristBI.styles.STYLE_IDS.forEach((id) => {
      const style = GristBI.styles.STYLES[id];
      const label = document.createElement('label');
      label.className = 'style-option';
      label.dataset.styleId = id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'settings-style';
      input.value = id;
      input.addEventListener('change', () => { if (input.checked) store.setDashStyle(id); });
      const swatch = document.createElement('span');
      swatch.className = 'style-swatch';
      swatch.setAttribute('data-dash-style', id);
      swatch.setAttribute('aria-hidden', 'true');
      const card = document.createElement('span');
      card.className = 'sw-card';
      const title = document.createElement('span');
      title.className = 'sw-title';
      const bars = document.createElement('span');
      bars.className = 'sw-bars';
      for (let i = 0; i < 4; i++) bars.appendChild(document.createElement('i'));
      card.append(title, bars);
      swatch.appendChild(card);
      const name = document.createElement('span');
      name.className = 'style-option-name';
      name.setAttribute('data-i18n', style.nameKey);
      name.textContent = t(style.nameKey);
      const desc = document.createElement('span');
      desc.className = 'style-option-desc';
      desc.setAttribute('data-i18n', style.descKey);
      desc.textContent = t(style.descKey);
      label.append(input, swatch, name, desc);
      styleOptionsEl.appendChild(label);
    });
    refreshStyleOptions(store.getState().dashStyle, store.getState().dashStyleOptions);
  }

  // Coche la carte du style en vigueur (un id inconnu de ce widget s'affiche, et se coche, en Standard).
  function refreshStyleOptions(dashStyle, dashStyleOptions) {
    if (!styleOptionsEl) return;
    const opts = dashStyleOptions || {};
    Object.keys(styleExtraInputs).forEach((key) => {
      const input = styleExtraInputs[key];
      if (input && input.checked !== !!opts[key]) input.checked = !!opts[key];
    });
    const current = GristBI.styles.normalizeStyleId(dashStyle);
    styleOptionsEl.querySelectorAll('.style-option').forEach((label) => {
      const selected = label.dataset.styleId === current;
      label.classList.toggle('is-selected', selected);
      const input = label.querySelector('input');
      if (input && input.checked !== selected) input.checked = selected;
    });
  }

  // Options valables pour tous les styles (cases sous les cartes de style) : tout-ou-rien chacune, passent par le store comme le style.
  Object.keys(styleExtraInputs).forEach((key) => {
    const input = styleExtraInputs[key];
    if (!input) return;
    input.addEventListener('change', () => store.setDashStyleOptions(Object.assign({}, store.getState().dashStyleOptions, { [key]: input.checked })));
  });

  renderStyleOptions();

  // Disposition de la PAGE courante (js/layouts.js, css/layouts.css) : une carte par agencement dans le menu Réglages, construites d'après le
  // registre. La miniature est un petit SVG fait des formes de `GristBI.layouts.thumb` (testées sous Node), coloré par les mêmes jetons que
  // la page ; le texte vient de `data-i18n`. Choisir un agencement passe par le store (`setPageLayout`, pour LA page affichée) : `render()` pose le
  // plan, redessine et planifie la sauvegarde, comme pour le style. Le réglage suit la page : changer d'onglet recoche la carte de cette page.
  function renderLayoutOptions() {
    if (!layoutOptionsEl) return;
    layoutOptionsEl.textContent = '';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    GristBI.layouts.LAYOUT_IDS.forEach((id) => {
      const layout = GristBI.layouts.LAYOUTS[id];
      const label = document.createElement('label');
      label.className = 'style-option layout-option';
      label.dataset.layoutId = id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'settings-layout';
      input.value = id;
      input.addEventListener('change', () => { if (input.checked) store.setPageLayout(store.getState().currentPageId, id); });
      const swatch = document.createElement('span');
      swatch.className = 'layout-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${GristBI.layouts.THUMB_W} ${GristBI.layouts.THUMB_H}`);
      svg.setAttribute('focusable', 'false');
      GristBI.layouts.thumb(id).forEach((shape) => {
        const node = document.createElementNS(SVG_NS, shape.kind === 'rule' ? 'line' : 'rect');
        if (shape.kind === 'rule') {
          node.setAttribute('x1', shape.x); node.setAttribute('y1', shape.y);
          node.setAttribute('x2', shape.x + shape.w); node.setAttribute('y2', shape.y + shape.h);
        } else {
          node.setAttribute('x', shape.x); node.setAttribute('y', shape.y);
          node.setAttribute('width', shape.w); node.setAttribute('height', shape.h);
          node.setAttribute('rx', shape.kind === 'frame' ? '2' : '1');
        }
        node.setAttribute('class', 'lt-' + shape.kind);
        svg.appendChild(node);
      });
      swatch.appendChild(svg);
      const name = document.createElement('span');
      name.className = 'style-option-name';
      name.setAttribute('data-i18n', layout.nameKey);
      name.textContent = t(layout.nameKey);
      const desc = document.createElement('span');
      desc.className = 'style-option-desc';
      desc.setAttribute('data-i18n', layout.descKey);
      desc.textContent = t(layout.descKey);
      label.append(input, swatch, name, desc);
      layoutOptionsEl.appendChild(label);
    });
    refreshLayoutOptions(store.getState());
  }

  // Coche la carte de l'agencement de la page affichée (un id inconnu de ce widget s'affiche, et se coche, en Grille) et nomme la page.
  function refreshLayoutOptions(state) {
    if (!layoutOptionsEl) return;
    const page = state.pages.find((p) => p.id === state.currentPageId) || state.pages[0];
    if (layoutHintEl) {
      const hint = t('layout.hint', { page: page ? page.name : '' });
      if (layoutHintEl.textContent !== hint) layoutHintEl.textContent = hint;
    }
    const current = GristBI.layouts.normalizeLayoutId(state.pageLayout);
    layoutOptionsEl.querySelectorAll('.layout-option').forEach((label) => {
      const selected = label.dataset.layoutId === current;
      label.classList.toggle('is-selected', selected);
      const input = label.querySelector('input');
      if (input && input.checked !== selected) input.checked = selected;
    });
  }

  renderLayoutOptions();

  bootstrap();
})(window);
