/*
 * Rendu des tuiles — socle commun (dessin ECharts, mise en cache des instances, calculs d agrégation
 * avec repli JS, thème, finalisation des options). Voir js/charts.js pour le point d entrée.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.chartParts || (GristBI.chartParts = {});
  const {
    groupByAggregate, aggregateSingle, pivotTable, splitBySeries, PALETTES
  } = GristBI.data;
  const { t } = GristBI.i18n;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const handleTileClick = (...args) => parts.handleTileClick(...args);

  // Format des nombres : un formateur PAR TUILE (`tile.numberFormat`, défaut Automatique), pour la colonne dont
  // vient la valeur — voir js/format.js. `format` = valeur complète (KPI, infobulle, tableau croisé), `axis` =
  // libellé d'axe compact, `percent` = variation/part en %. La langue est relue à chaque rendu (un changement
  // de langue relance render(), js/main.js).
  function fmtFor(tile, columnId) {
    return GristBI.format.forTile(tile, columnId, GristBI.i18n.getLang());
  }

  // Tuile VIVANTE par id : un écouteur posé une fois (nuage de mots) ne doit pas figer l'objet `tile` de
  // sa création (CLAUDE.md §7 n°18).
  function liveTile(tileId) {
    const live = GristBI.store.getState().tiles.find((tl) => tl.id === tileId);
    return live || null;
  }

  const chartInstances = new Map();

  // Numéro de rendu en cours par tuile, PARTAGÉ par tous les chemins de rendu asynchrones
  // (renderKpi/renderGauge/renderChart/renderPivot/renderMeasureChart, voir computeGroupBy et
  // consorts plus bas) : un calcul SQL DuckDB est asynchrone, un nouveau rendu (filtre, édition,
  // suppression, ou même un changement de type de rendu pour la MÊME tuile) peut démarrer avant
  // qu'un précédent n'ait fini — seul le résultat du DERNIER appel lancé pour une tuile donnée doit
  // s'appliquer, les autres sont silencieusement abandonnés à leur retour. Un seul compteur par
  // tuile (pas un par fonction de rendu) : si une tuile passe de "Barres" à "KPI" entre-temps, le
  // calcul KPI qui démarre invalide aussi un calcul Barres encore en vol pour cette même tuile.
  const renderSeq = new Map();

  function bumpSeq(tileId) {
    const seq = (renderSeq.get(tileId) || 0) + 1;
    renderSeq.set(tileId, seq);
    return seq;
  }

  function isStale(tileId, seq) {
    return renderSeq.get(tileId) !== seq;
  }

  // Volume à partir duquel une agrégation passe par une vraie requête SQL DuckDB-WASM plutôt que
  // par la version JS pure de js/data.js (ROADMAP.md Tier 2 : "Moteur DuckDB-WASM, remplace
  // Array.reduce"). En-dessous, le coût FIXE du moteur (sérialisation CSV des lignes, chargement
  // paresseux du binaire ~34 Mo au tout premier appel, aller-retour avec le Worker) dépasse
  // largement ce qu'`Array.reduce` coûte déjà pour un petit tableau — valeur choisie empiriquement
  // (pas une recommandation DuckDB officielle) pour rester nettement sous le volume de la table de
  // test de charge de ce projet (~47 000 lignes, voir HYPOTHESES.md) tout en laissant les dashboards
  // habituels, bien plus petits, sur le chemin JS synchrone existant — AUCUN changement de
  // comportement pour eux. Un échec du chargement/calcul DuckDB (réseau, navigateur trop ancien)
  // retombe silencieusement sur la version JS plutôt que de casser le rendu — même philosophie que
  // le bandeau d'avertissement ECharts (`typeof echarts === 'undefined'`) plus bas dans ce fichier.
  const DUCKDB_ROW_THRESHOLD = 5000;

  async function computeGroupBy(rows, dimensionCol, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.groupByAggregate(rows, dimensionCol, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour cette agrégation, repli sur le calcul JS', e); }
    }
    return groupByAggregate(rows, dimensionCol, measureCol, aggFn);
  }

  // Séries multiples (`tile.seriesColumn`) : une agrégation par série, chacune sur SES lignes — donc
  // chacune au-dessus du seuil DuckDB seulement si elle le mérite — lancées en parallèle (même
  // raisonnement que le nuage de points : une seule latence DuckDB à payer). Le résultat est aligné
  // sur les catégories par `GristBI.data.assembleSeries` (js/data.js).
  async function computeSeriesGroups(rows, dimensionCol, seriesColumn, measureCol, aggFn) {
    return Promise.all(splitBySeries(rows, seriesColumn, t('chart.series.empty')).map(async (sr) => ({
      name: sr.name, groups: await computeGroupBy(sr.rows, dimensionCol, measureCol, aggFn)
    })));
  }

  // Bulles avec une colonne de couleur (`tile.seriesColumn` d'un nuage de points) : pour chaque valeur de la colonne, les groupes
  // X, Y et taille de SES lignes, en parallèle (une seule latence DuckDB à payer, comme computeSeriesGroups).
  async function computeScatterSplit(rows, dimensionCol, tile) {
    return Promise.all(splitBySeries(rows, tile.seriesColumn, t('chart.series.empty')).map(async (sr) => {
      const [gx, gy, gs] = await Promise.all([
        computeGroupBy(sr.rows, dimensionCol, tile.measure, tile.aggFn),
        computeGroupBy(sr.rows, dimensionCol, tile.measureY, tile.aggFn),
        tile.measureSize ? computeGroupBy(sr.rows, dimensionCol, tile.measureSize, tile.aggFnSize || tile.aggFn) : Promise.resolve(null)
      ]);
      return { name: sr.name, gx, gy, gs };
    }));
  }

  async function computeAggregateSingle(rows, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.aggregateSingle(rows, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour cette agrégation, repli sur le calcul JS', e); }
    }
    return aggregateSingle(rows, measureCol, aggFn);
  }

  async function computePivot(rows, rowDim, colDim, measureCol, aggFn) {
    if (rows.length >= DUCKDB_ROW_THRESHOLD) {
      try { return await GristBI.duckdbEngine.pivotTable(rows, rowDim, colDim, measureCol, aggFn); }
      catch (e) { console.warn('[GristBI] DuckDB indisponible pour ce tableau croisé, repli sur le calcul JS', e); }
    }
    return pivotTable(rows, rowDim, colDim, measureCol, aggFn);
  }

  // Palette catégorielle validée colorblind-safe (skill dataviz de ce projet,
  // references/palette.md — worst adjacent CVD ΔE 9.1 clair, OKLab, cible ≥8 — ordre figé, jamais
  // cyclé au hasard). Camembert : ECharts assigne une couleur par part dans cet ordre. Barres :
  // une seule série -> une seule couleur (le 1er slot, l'accent bleu) plutôt qu'une couleur par
  // catégorie, redondant avec les libellés déjà présents sur l'axe.
  // Elle vit désormais dans GristBI.data.PALETTES.standard (avec les autres palettes au choix, voir
  // `tile.palette` et paletteColors) ; cette constante reste la couleur des éléments qui n'ont PAS à
  // suivre le choix : indicateur de chargement, hausse/baisse de la cascade (vert/rouge = un sens).
  const CATEGORICAL_PALETTE = PALETTES.standard;

  // `containLabel: true` : sans ça, ECharts réserve une marge estimée AVANT de savoir combien de
  // place le formatter compact va réellement prendre (variable selon la valeur : "0" vs "2,7 M")
  // — l'estimation était trop courte, dessinant une partie du texte hors du canvas (silencieusement
  // coupé, pas d'erreur, voir HYPOTHESES.md). Partagé par tout axe numérique (bar, scatter, mesures
  // temporelles) — pas seulement le cas où le bug a été trouvé la première fois.
  const numericGrid = { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 };

  // Texte d'un canvas hors écran pour MESURER une chaîne (ajustement de la valeur centrale de la jauge).
  let _measureCtx = null;

  function measureText(text, size, weight, family) {
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = `${weight} ${size}px ${family}`;
    return _measureCtx.measureText(text).width;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Couleurs lues sur les jetons CSS de la page (clair/sombre, ambiance GFS) : ECharts ne les lit pas tout seul, il
  // dessine en gris foncé sur n'importe quel fond. Relues à chaque rendu : un changement de thème est repris au
  // prochain rendu sans rien recréer.
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function chartTheme() {
    let font = 'sans-serif';
    try { font = getComputedStyle(document.body).fontFamily || font; } catch (e) { /* hors navigateur */ }
    return {
      text: cssVar('--text', '#0b0b0b'),
      secondary: cssVar('--text-secondary', '#52514e'),
      muted: cssVar('--text-muted', '#6b6a64'),
      // `--dash-tile-surface` : le fond réel d'une tuile quand le tableau de bord est « uni » (css/dash-styles.css : celui de la page,
      // pas celui d'une carte) ; absent sinon, et c'est `--surface`.
      surface: cssVar('--dash-tile-surface', '') || cssVar('--surface', '#fcfcfb'),
      line: cssVar('--border-strong', '#e1e0d9'), // cadre de l'infobulle
      grid: cssVar('--border', 'rgba(11, 11, 11, 0.10)'), // quadrillage, discret sur fond clair comme sombre
      track: 'rgba(128, 128, 128, 0.22)', // visible sur fond clair comme sombre
      font
    };
  }

  // Instance ECharts partagée par renderChart/renderMeasureChart pour une même tuile : une tuile
  // peut passer de l'un à l'autre au fil des éditions (mode mesure activé/désactivé), il ne faut
  // donc PAS que le gestionnaire de clic ne soit attaché que par un seul des deux chemins de rendu
  // — sinon une tuile d'abord créée en mode mesure, puis éditée pour repasser en "Brut", garderait
  // une instance déjà en cache sans aucun clic câblé (le `if (!instance...)` de création ne se
  // redéclencherait jamais).
  function getOrCreateChartInstance(tileId, el) {
    let instance = chartInstances.get(tileId);
    if (instance && !instance.isDisposed()) return instance;
    instance = echarts.init(el);
    chartInstances.set(tileId, instance);
    trackLoading(instance);
    instance.on('click', (params) => handleTileClick(tileId, params.name, params));
    return instance;
  }

  // Instances qui affichent « Calcul… » (agrégation DuckDB en cours) : l'export (js/snapshot.js, js/pdf-export.js) attend qu'il n'y en
  // ait plus avant de photographier la page, sinon le fichier garde le masque de chargement à la place du graphique.
  const loadingInstances = new Set();

  function trackLoading(instance) {
    const show = instance.showLoading.bind(instance);
    const hide = instance.hideLoading.bind(instance);
    instance.showLoading = (...args) => { loadingInstances.add(instance); return show(...args); };
    instance.hideLoading = (...args) => { loadingInstances.delete(instance); return hide(...args); };
  }

  // Rendus asynchrones encore en vol (agrégation DuckDB d'une carte KPI, d'un tableau croisé, d'un graphique…) : un KPI ou un tableau
  // croisé n'a pas d'instance ECharts, donc pas de « Calcul… » à suivre — mais il écrit « – » tant que sa valeur n'est pas arrivée.
  const pendingRenders = new Set();

  function trackPending(promise) {
    if (!promise || typeof promise.then !== 'function') return;
    pendingRenders.add(promise);
    const done = () => { pendingRenders.delete(promise); };
    promise.then(done, done);
  }

  // Résout `true` quand plus aucun graphique ne calcule, `false` si `timeoutMs` (15 s par défaut) est dépassé.
  function whenSettled(timeoutMs) {
    const limit = Date.now() + (timeoutMs || 15000);
    return new Promise((resolve) => {
      const check = () => {
        for (const inst of Array.from(loadingInstances)) if (inst.isDisposed()) loadingInstances.delete(inst);
        if (loadingInstances.size === 0 && pendingRenders.size === 0) resolve(true);
        else if (Date.now() > limit) resolve(false);
        else setTimeout(check, 100);
      };
      check();
    });
  }

  // Bulle d'info toujours DANS la zone du graphique (`confine`) : sans ça, ECharts la posait à côté du
  // point survolé, donc hors de la carte — jusqu'à sortir de l'écran à gauche pour un radar (retour
  // d'Antoine du 18/11/2026).
  function confineTooltip(option) {
    if (option && option.tooltip) option.tooltip = Object.assign({ confine: true }, option.tooltip);
  }

  // Dernière étape de TOUT graphique ECharts, juste avant `setOption` (audit de lisibilité, lot 4, 18/11/2026) : le
  // thème de la page (clair/sombre/ambiance, jetons CSS) et la lisibilité des libellés. Les réglages DÉJÀ posés par un
  // type de tuile gagnent (`Object.assign(défauts, existant)`), jamais l'inverse.
  // - infobulle : fond et texte des jetons (ECharts la dessinait blanche sur fond sombre), 12 px, retour à la ligne
  //   (« Tablette Graphique Professionnelle 12 pouces » tenait sur toute la largeur de la tuile) ;
  // - axes : quadrillage et traits des jetons (ECharts les dessine en #E0E6F1 / gris foncé, blancs éclatants sur fond
  //   sombre), libellés qui se chevauchent masqués, libellés de catégorie TRONQUÉS à la largeur d'une catégorie (le 1er
  //   de « Tablette Graphique Professionnelle 12 pouces » sortait de la tuile à gauche, les autres disparaissaient),
  //   graduations de l'axe horizontal en nombre raisonnable (« 200 k400 k600 k » collés dans une barre horizontale) ;
  // - camembert/entonnoir : texte aux jetons, sans le contour blanc qu'ECharts leur met (illisible sur fond sombre) ;
  // - radar : noms d'axes, cercles et bandes des jetons (les bandes claires par défaut éclairent un fond sombre).
  function finalizeOption(option, instance) {
    if (!option) return option;
    confineTooltip(option);
    const th = chartTheme();
    const width = (instance && typeof instance.getWidth === 'function') ? instance.getWidth() : 0;
    if (option.tooltip) {
      option.tooltip = Object.assign({
        backgroundColor: th.surface,
        borderColor: th.line,
        textStyle: { color: th.text, fontSize: 12 },
        extraCssText: 'max-width: 85%; white-space: normal; overflow-wrap: anywhere;'
      }, option.tooltip);
    }
    if (option.legend) option.legend = Object.assign({}, option.legend, { textStyle: Object.assign({ color: th.secondary }, option.legend.textStyle) });
    // Légende de dégradé (carte de chaleur) : ses libellés aux jetons, sinon noirs sur fond sombre.
    if (option.visualMap && !Array.isArray(option.visualMap)) {
      option.visualMap = Object.assign({}, option.visualMap, { textStyle: Object.assign({ color: th.muted }, option.visualMap.textStyle) });
    }
    const styleAxis = (axis, isX) => {
      if (!axis) return axis;
      const one = (a) => {
        const label = Object.assign({ color: th.muted, hideOverlap: true }, a.axisLabel);
        const out = Object.assign({}, a, {
          axisLine: Object.assign({ lineStyle: { color: th.muted } }, a.axisLine),
          axisTick: Object.assign({ lineStyle: { color: th.muted } }, a.axisTick),
          splitLine: Object.assign({ lineStyle: { color: th.grid } }, a.splitLine),
          axisLabel: label
        });
        if (isX && width) {
          // La marge réservée à droite (libellé d'une ligne de repère) rétrécit d'autant la zone de tracé.
          const gridRight = option.grid && !Array.isArray(option.grid) ? Number(option.grid.right) : NaN;
          const reserved = Number.isFinite(gridRight) ? Math.max(0, gridRight - 16) : 0;
          const plotW = Math.max(60, width - 70 - reserved);
          if (a.type === 'category' && Array.isArray(a.data) && a.data.length && label.width == null) {
            // Peu de catégories : chacune garde sa place (largeur d'une catégorie moins une marge, nom tronqué par « … »,
            // aucun libellé masqué). Beaucoup de catégories : ECharts n'en montre qu'une sur k (intervalle automatique),
            // chacune avec plus de place.
            // 6 px d'air entre deux noms ; 3 seulement quand la zone de tracé a déjà perdu sa marge de droite (libellé d'une ligne de repère).
            const band = Math.floor(plotW / a.data.length) - (reserved > 0 ? 3 : 6);
            if (a.data.length <= 8 && band >= 28) {
              label.width = Math.min(150, band);
              if (label.interval == null) label.interval = 0;
            } else {
              label.width = 70;
            }
            label.overflow = 'truncate';
            label.ellipsis = '…';
          } else if (a.type === 'value' && a.splitNumber == null) {
            out.splitNumber = Math.max(2, Math.min(6, Math.floor(plotW / 64)));
          }
        }
        return out;
      };
      return Array.isArray(axis) ? axis.map(one) : one(axis);
    };
    if (option.xAxis) option.xAxis = styleAxis(option.xAxis, true);
    if (option.yAxis) option.yAxis = styleAxis(option.yAxis, false);
    if (Array.isArray(option.series)) {
      option.series.forEach((sr, i) => {
        if (sr && (sr.type === 'pie' || sr.type === 'funnel')) {
          option.series[i] = Object.assign({}, sr, {
            label: Object.assign({ color: th.text, textBorderWidth: 0 }, sr.label),
            // Traits entre les étapes de l'entonnoir : le blanc par défaut d'ECharts éclaire un fond sombre.
            ...(sr.type === 'funnel' ? { itemStyle: Object.assign({ borderColor: th.surface, borderWidth: 1 }, sr.itemStyle) } : {})
          });
        }
      });
    }
    if (option.radar) {
      // Avec une légende, le polygone se place dans la place qu'elle laisse (centre et rayon en PIXELS, comme la jauge : ils ne
      // suivent donc pas un redimensionnement, `__refit` les recalcule — voir resizeAll). Sans légende : réglage d'origine (62 %).
      const placeRadar = () => {
        const h = instance.getHeight();
        const w = instance.getWidth();
        if (!w || !h) return null;
        const L = GristBI.format.radarLayout(w, h, true);
        return { center: [L.cx, L.cy], radius: L.r, axisNameGap: L.gap };
      };
      const placed = (instance && option.legend && typeof instance.getHeight === 'function') ? placeRadar() : null;
      if (instance) {
        instance.__refit = placed ? () => { const p = placeRadar(); if (p) instance.setOption({ radar: p }); } : undefined;
      }
      option.radar = Object.assign({}, option.radar, placed || {}, {
        // Noms d'axe tronqués à la PLACE qu'a chacun dans la tuile (`GristBI.format.radarNameRoom` : un nom de côté n'a que l'espace entre le
        // polygone et le bord ; `overflow` n'agit pas sur les noms d'axe d'un radar, on coupe nous-mêmes) : « Station d'accueil USB-C »
        // sortait de la carte à droite, « Montre Connectée » à gauche. La taille de la tuile est relue à chaque appel (agrandissement).
        axisName: Object.assign({
          color: th.muted,
          formatter: (name) => {
            const text = String(name == null ? '' : name);
            const w = instance && typeof instance.getWidth === 'function' ? instance.getWidth() : 0;
            const h = instance && typeof instance.getHeight === 'function' ? instance.getHeight() : 0;
            const names = (option.radar.indicator || []).map((ind) => ind && ind.name);
            if (!w || !h || !names.length) {
              const max = Math.max(8, Math.floor((width || 330) * 0.34 / 6.8));
              return text.length > max ? `${text.slice(0, max - 1)}…` : text;
            }
            const font = (option.radar.axisName && option.radar.axisName.fontSize) || 12;
            const room = GristBI.format.radarNameRoom(w, h, !!option.legend, Math.max(0, names.indexOf(text)), names.length);
            if (measureText(text, font, 400, th.font) <= room) return text;
            let k = text.length - 1;
            while (k > 1 && measureText(`${text.slice(0, k)}…`, font, 400, th.font) > room) k -= 1;
            return `${text.slice(0, Math.max(1, k))}…`;
          }
        }, option.radar.axisName),
        axisLine: Object.assign({ lineStyle: { color: th.grid } }, option.radar.axisLine),
        splitLine: Object.assign({ lineStyle: { color: th.grid } }, option.radar.splitLine),
        splitArea: Object.assign({ show: false }, option.radar.splitArea)
      });
    }
    // Style global des tuiles (js/styles.js) : en DERNIER, après tous les réglages ci-dessus et ceux du rendu — barres arrondies,
    // valeurs au bout des barres, quadrillage, tracé des courbes. Standard : option rendue telle quelle. La palette de la tuile
    // n'est jamais remplacée, seulement transformée (teinte d'une couleur unique).
    if (GristBI.styles) GristBI.styles.applyToOption(option, GristBI.styles.current(), th);
    return option;
  }

  Object.assign(parts, { CATEGORICAL_PALETTE, DUCKDB_ROW_THRESHOLD, bumpSeq, chartInstances, chartTheme, clamp, computeAggregateSingle, computeGroupBy, computePivot, computeScatterSplit, computeSeriesGroups, finalizeOption, fmtFor, getOrCreateChartInstance, isStale, liveTile, loadingInstances, measureText, numericGrid, renderSeq, trackLoading, trackPending, whenSettled });
})(window);
