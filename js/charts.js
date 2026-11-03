/*
 * Rendu des tuiles (bar/pie/kpi/gauge/treemap/scatter/waterfall/radar) avec ECharts : filtres
 * croisés multiples, tendance KPI, et drill-down multi-niveaux (voir GristBI.data.tileDrillLevels)
 * avec fil d'Ariane. Dépend du global `echarts` (js/vendor/echarts/, voir index.html) et de
 * GristBI.data/GristBI.store.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const {
    groupByAggregate, sameValue, aggregateSingle, pivotTable, trendFromGroups, measureSeriesForTile,
    waterfallSeries, escapeHtml, tileDrillLevels, currentDimension, rowsForTile, wordFrequency
  } = GristBI.data;
  const { t } = GristBI.i18n;

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

  // Même logique de comparaison que GristBI.data.computeTrend (trendFromGroups, partagée), mais sur
  // un groupByAggregate passé par computeGroupBy ci-dessus — donc lui aussi sur DuckDB au-delà du
  // seuil, plutôt que de rester bloqué sur la version JS pour cette seule partie du rendu KPI.
  async function computeTrendAsync(rows, trendDimension, measureCol, aggFn) {
    if (!trendDimension) return null;
    return trendFromGroups(await computeGroupBy(rows, trendDimension, measureCol, aggFn));
  }

  // Palette catégorielle validée colorblind-safe (skill dataviz de ce projet,
  // references/palette.md — worst adjacent CVD ΔE 9.1 clair, OKLab, cible ≥8 — ordre figé, jamais
  // cyclé au hasard). Camembert : ECharts assigne une couleur par part dans cet ordre. Barres :
  // une seule série -> une seule couleur (le 1er slot, l'accent bleu) plutôt qu'une couleur par
  // catégorie, redondant avec les libellés déjà présents sur l'axe.
  const CATEGORICAL_PALETTE = [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'
  ];

  // `containLabel: true` : sans ça, ECharts réserve une marge estimée AVANT de savoir combien de
  // place le formatter compact va réellement prendre (variable selon la valeur : "0" vs "2,7 M")
  // — l'estimation était trop courte, dessinant une partie du texte hors du canvas (silencieusement
  // coupé, pas d'erreur, voir HYPOTHESES.md). Partagé par tout axe numérique (bar, scatter, mesures
  // temporelles) — pas seulement le cas où le bug a été trouvé la première fois.
  const numericGrid = { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 };

  function renderTile(tile, state, container) {
    // Filtrage délégué à GristBI.data.rowsForTile (source de vérité partagée avec l'export Excel,
    // voir data.js) : une tuile qui EST la source d'un filtre croisé s'affiche non filtrée SUR CE
    // FILTRE LÀ (pour rester cliquable sur tous ses segments) ; elle reçoit quand même les filtres
    // posés par d'AUTRES tuiles ainsi que les filtres avancés (qui s'appliquent à toutes les tuiles
    // sans exception, `sourceTileId` n'a jamais de sens pour eux) et son propre drill-down.
    const drillPath = (state.drillIns && state.drillIns[tile.id]) || [];
    const rows = rowsForTile(tile, state);

    if (tile.type === 'kpi') {
      renderKpi(tile, rows, container);
    } else if (tile.type === 'gauge') {
      renderGauge(tile, rows, container);
    } else if (tile.type === 'pivot') {
      renderPivot(tile, rows, state, container);
    } else if (tile.type === 'bar' && tile.measureMode && tile.measureMode !== 'brut') {
      renderMeasureChart(tile, rows, container);
    } else {
      renderChart(tile, rows, state, container, drillPath);
    }
  }

  // ASYNCHRONE depuis que la valeur/la tendance peuvent passer par DuckDB-WASM au-delà du seuil
  // (voir computeAggregateSingle/computeTrendAsync) — les deux calculs sont indépendants (une
  // tuile KPI n'a qu'une seule mesure mais potentiellement une dimension de tendance différente),
  // lancés en parallèle plutôt qu'en séquence pour ne payer qu'une seule fois la latence du plus
  // lent des deux. Sous le seuil (l'immense majorité des dashboards), les deux résolvent sur le
  // même tick et rien ne change visuellement par rapport à l'ancien comportement synchrone.
  async function renderKpi(tile, rows, container) {
    const seq = bumpSeq(tile.id);
    const [value, trend] = await Promise.all([
      computeAggregateSingle(rows, tile.measure, tile.aggFn),
      computeTrendAsync(rows, tile.trendDimension, tile.measure, tile.aggFn)
    ]);
    if (isStale(tile.id, seq)) return; // rendu plus récent pour cette tuile entre-temps

    const valueEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-value`);
    if (!valueEl) return;
    valueEl.textContent = formatNumber(value);

    const trendEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-trend`);
    if (!trendEl) return;
    if (!trend) {
      trendEl.hidden = true;
      return;
    }
    const isUp = trend.deltaPct >= 0;
    trendEl.hidden = false;
    trendEl.className = `tile-kpi-trend ${isUp ? 'trend-up' : 'trend-down'}`;
    trendEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(trend.deltaPct).toFixed(1)}% vs ${trend.previousKey}`;
  }

  // Une jauge est sémantiquement proche d'une carte KPI (une seule valeur agrégée, pas de
  // dimension) : réutilise aggregateSingle telle quelle. Rendue via ECharts (contrairement à la
  // carte KPI, en texte pur) pour l'aiguille/le cadran, donc utilise .tile-chart comme bar/pie.
  // Pas de dimension -> pas de gestionnaire de clic (rien à filtrer/détailler par segment).
  async function renderGauge(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      el.textContent = t('chart.unavailable');
      return;
    }
    let instance = chartInstances.get(tile.id);
    if (!instance || instance.isDisposed()) {
      instance = echarts.init(el);
      chartInstances.set(tile.id, instance);
    }
    const seq = bumpSeq(tile.id);
    const usingDuckDb = rows.length >= DUCKDB_ROW_THRESHOLD;
    if (usingDuckDb) instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });
    const value = await computeAggregateSingle(rows, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq) || instance.isDisposed()) return;
    // Inconditionnel (pas `if (usingDuckDb)`) : CE rendu-ci peut être sous le seuil (donc ne pas
    // avoir affiché son propre masque) alors qu'un rendu précédent pour CETTE MÊME tuile, lui
    // au-dessus du seuil, l'avait affiché puis a été invalidé par ce rendu-ci avant d'atteindre son
    // propre hideLoading() (voir isStale ci-dessus) — sans cet appel inconditionnel, un filtre qui
    // fait repasser une tuile sous le seuil pendant qu'un calcul DuckDB est encore en vol pour elle
    // laisserait le masque de chargement bloqué indéfiniment sur un graphique pourtant à jour.
    // hideLoading() est documenté comme sans effet si aucun masque n'est affiché.
    instance.hideLoading();
    const min = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    const max = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : Math.max(value * 1.5, 1);
    instance.setOption({
      series: [{
        type: 'gauge',
        min,
        max,
        // splitNumber par défaut d'ECharts (10, donc 11 libellés) se chevauche systématiquement à
        // la taille d'une tuile [BUG RÉEL trouvé en capturant un screenshot] : 4 divisions (5
        // libellés : min, 1/4, 1/2, 3/4, max) restent lisibles à n'importe quelle taille de jauge.
        splitNumber: 4,
        itemStyle: { color: CATEGORICAL_PALETTE[0] },
        progress: { show: true, width: 12 },
        axisLine: { lineStyle: { width: 12 } },
        axisTick: { show: false },
        splitLine: { length: 12 },
        axisLabel: { distance: 14, fontSize: 10, formatter: formatCompactNumber },
        pointer: { show: true },
        title: { show: false },
        detail: { valueAnimation: true, formatter: (v) => formatNumber(v), fontSize: 18, offsetCenter: [0, '70%'] },
        data: [{ value }]
      }]
    }, true);
  }

  // Logique de clic (drill-down vs filtre croisé) PARTAGÉE par l'instance ECharts générique
  // (getOrCreateChartInstance, bar/pie/treemap/scatter/waterfall/radar/nuage de mots en mode "une
  // entrée par ligne") et le <canvas> maison du nuage de mots en mode découpage
  // (getOrCreateWordCloudCanvas, voir renderWordCloud — depuis le 03/11/2026, d3-cloud ne fait que
  // le placement, pas le clic). Ne PAS capturer `tile` du rendu courant dans une closure : un appel
  // peut arriver bien après le rendu qui l'a câblé (édition de tuile, drill-down — voir
  // HYPOTHESES.md) ; on relit l'état vivant à chaque clic, en ne fixant que l'id de la tuile (stable
  // tout au long de sa vie).
  function handleTileClick(tileId, name) {
    const liveState = GristBI.store.getState();
    const currentTile = liveState.tiles.find((t) => t.id === tileId);
    if (!currentTile) return; // tuile supprimée entre-temps
    // Mode mesure temporelle (voir renderMeasureChart) : un point est un mois CALCULÉ (bucket
    // DuckDB), pas une vraie valeur de la dimension d'origine — rien de cohérent à filtrer/driller.
    if (currentTile.type === 'bar' && currentTile.measureMode && currentTile.measureMode !== 'brut') return;
    // Radar (voir renderChart) : une seule série/un seul "polygone" couvrant TOUTES les valeurs de
    // la dimension à la fois (un axe par valeur) — le nom reçu au clic est alors celui de CE
    // polygone (tile.measure), jamais celui d'un axe précis cliqué individuellement. ECharts ne
    // distingue pas l'axe survolé/cliqué au clic sur un radar (seulement au survol, dans le
    // tooltip) : aucune valeur de dimension cohérente à driller/filtrer ici, contrairement à
    // bar/pie/treemap/scatter/waterfall qui restent tous sur un axe catégoriel classique. Repli
    // silencieux (aucune action) plutôt qu'un filtre posé par erreur sur "tile.measure".
    if (currentTile.type === 'radar') return;
    // Nuage de mots en mode "découpage de cellule" : un mot issu du découpage d'une cellule (ex.
    // "génétique") n'est jamais une valeur de colonne telle quelle (la cellule d'origine vaut
    // "génétique, cohorte, adolescent") — un filtre par égalité stricte sur ce mot
    // (toggleFilter/matchesFilter, type 'eq') ne correspondrait à AUCUNE ligne, vidant
    // silencieusement la tuile au clic plutôt que de filtrer quoi que ce soit de cohérent. Ce
    // widget n'a pas de filtre de type "contient" branché sur le clic (seulement sur le champ de
    // recherche texte des filtres avancés, voir matchesFilter) : repli silencieux (aucune action),
    // même traitement que le radar ci-dessus. En pratique, le <canvas> du nuage de mots neutralise
    // déjà lui-même le clic dans ce mode (voir getOrCreateWordCloudCanvas) — ce garde-fou reste ici
    // par cohérence/défense en profondeur, inchangé depuis la version ECharts de ce code.
    if (currentTile.type === 'wordcloud' && currentTile.wordCloudSplit) return;
    const livePath = (liveState.drillIns && liveState.drillIns[currentTile.id]) || [];
    const dim = currentDimension(currentTile, livePath);
    const levels = tileDrillLevels(currentTile);
    if (livePath.length < levels.length) {
      GristBI.store.drillInto(currentTile.id, dim, name);
    } else {
      GristBI.store.toggleFilter(dim, name, currentTile.id);
    }
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
    instance.on('click', (params) => handleTileClick(tileId, params.name));
    return instance;
  }

  // === Nuage de mots (d3-cloud) ==============================================================
  // Choix du 03/11/2026 (remplace echarts-wordcloud, écarté par Antoine pour défaut de maintenance
  // — dépôt amont sans commit de code depuis fin 2022, voir GFS-ETAT.md et HYPOTHESES.md) :
  // d3-cloud 2.0.0, réécrit le 30/10/2026, zéro dépendance, publié avec tests + types + guide de
  // migration. Contrepartie assumée : d3-cloud ne fait QUE le calcul de placement des mots (voir
  // son README, "your application renders the results with canvas, SVG, or another renderer") —
  // ni rendu ni détection de clic/survol intégrés, contrairement à echarts-wordcloud qui les aurait
  // obtenus gratuitement d'ECharts. Ce widget dessine donc lui-même sur un <canvas> dédié
  // (getOrCreateWordCloudCanvas) et fait sa propre détection de clic/survol (hitTestWordCloud) —
  // bien plus de code que les autres types de tuile, qui délèguent tout cela à ECharts.
  //
  // Chargement paresseux via import() dynamique d'un spécificateur NU ("d3-cloud"), résolu par
  // l'`importmap` d'index.html (voir js/vendor/apache-arrow, flatbuffers, tslib pour le même
  // mécanisme) — absent de cet importmap tant que GFS n'a pas ajouté la bibliothèque (voir
  // GFS-ETAT.md "Demandes à GFS", protocole du 03/11/2026 : plus aucune lib chargée en dur par
  // l'app elle-même). Sans entrée dans l'importmap, le navigateur rejette IMMÉDIATEMENT cet
  // import() (spécificateur non résolu) — aucune requête réseau, donc rien à voir avec le piège
  // silencieux `typeof echarts === 'undefined'` (CLAUDE.md §7 n°4) : ici l'échec est explicite
  // (promesse rejetée), juste intercepté pour afficher le même message qu'avant plutôt que de
  // laisser une exception non gérée remonter jusqu'au rendu de la tuile.
  let _d3CloudPromise = null;
  function loadD3Cloud() {
    if (!_d3CloudPromise) {
      _d3CloudPromise = import('d3-cloud').catch((e) => {
        console.warn('[GristBI] d3-cloud indisponible (bibliothèque pas encore fournie par GFS)', e);
        return null;
      });
    }
    return _d3CloudPromise;
  }

  // Même plage que l'ancien `sizeRange: [14, 48]` d'echarts-wordcloud.
  function wordCloudSizeFor(value, minV, maxV) {
    if (maxV === minV) return 28; // toutes les valeurs égales : taille médiane plutôt qu'une
      // division par zéro
    return 14 + ((value - minV) / (maxV - minV)) * (48 - 14);
  }

  // Même esprit que l'ancien `rotationRange: [-45, 45]` / `rotationStep: 15`, mais assignée par
  // index plutôt qu'aléatoirement : un mot garde le même angle à chaque re-rendu (filtre, resize),
  // pas de scintillement visuel — même principe déjà appliqué à la couleur par index ci-dessous.
  const WORD_CLOUD_ROTATIONS = [-45, -30, -15, 0, 15, 30, 45];
  const WORD_CLOUD_FONT = 'sans-serif'; // police système, pas de police tierce (Manrope refusée
    // par Antoine le 29/09/2026, CLAUDE.md §8 — vaut pour tout le chrome ET les graphiques)

  // Calcule le placement des mots via d3-cloud (bibliothèque de LAYOUT seule, voir plus haut) :
  // les plus grands d'abord pour que `place()` remplisse mieux l'espace (recommandation de son
  // README), un sprite préparé puis placé par mot (API par classe de d3-cloud 2.x — voir son
  // MIGRATING.md pour la différence avec l'ancienne API événementielle 1.x). `dim` reproduit
  // exactement l'estompage de filtre croisé des autres types de tuile (voir renderChart) :
  // inchangé depuis la version ECharts de ce code, y compris pour le mode découpage (un filtre
  // posé sur CETTE colonne depuis une AUTRE tuile ne correspondra jamais à un mot découpé via
  // `sameValue`, donc tout le nuage s'estompe uniformément dans ce cas précis — déjà le
  // comportement de la version fusionnée dans la PR #38, pas un changement introduit ici).
  function placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight) {
    const values = wordCloudAgg.map((d) => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const layout = new CloudLayout().size([cssWidth, cssHeight]).overflow(false);
    const measureCtx = document.createElement('canvas').getContext('2d');
    const sorted = wordCloudAgg.slice().sort((a, b) => b.value - a.value);
    const placed = [];
    sorted.forEach((d, i) => {
      const size = wordCloudSizeFor(d.value, minV, maxV);
      const rotate = WORD_CLOUD_ROTATIONS[i % WORD_CLOUD_ROTATIONS.length];
      const sprite = layout.getSprite(String(d.dimension), { size, font: WORD_CLOUD_FONT, padding: 2, rotate });
      if (!sprite) return; // taille <1px : ne devrait jamais arriver (un comptage vaut toujours
        // au moins 1, voir wordFrequency/groupByAggregate), repli silencieux par cohérence
      const word = layout.place(sprite);
      if (!word) return; // n'a pas pu être placé dans l'espace disponible (trop de mots/trop
        // grands pour cette tuile) : nuage incomplet plutôt qu'une erreur JS, même esprit que le
        // message "chart.wordCloudUnavailable" plus bas
      const style = dim(d.dimension);
      measureCtx.font = `${word.size}px ${WORD_CLOUD_FONT}`;
      placed.push({
        text: word.text,
        value: d.value,
        x: word.x,
        y: word.y,
        rotate: word.rotate,
        size: word.size,
        width: measureCtx.measureText(word.text).width,
        color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
        opacity: style ? style.opacity : 1
      });
    });
    return placed;
  }

  // Dessine les mots déjà placés (coordonnées centrées sur [0,0], voir le README de d3-cloud,
  // section "Rendering Placed Words") sur un canvas dimensionné en pixels CSS × devicePixelRatio
  // (texte net sur les écrans à forte densité — même raison que `pixelRatio: 2` passé à
  // `instance.getDataURL` pour les exports PDF/PPTX des autres types de tuile, voir plus bas).
  function drawWordCloud(canvas, placedWords, cssWidth, cssHeight) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    canvas.height = Math.max(1, Math.round(cssHeight * ratio));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Fond blanc explicite : cohérent avec le fond des autres tuiles ET nécessaire pour un export
    // PNG lisible (canvas.toDataURL ne compose pas sur un fond — un PNG transparent serait illisible
    // sur fond sombre dans certains lecteurs/diapositives, contrairement à l'ancien
    // `backgroundColor: '#ffffff'` passé à ECharts pour les autres types de tuile).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    placedWords.forEach((w) => {
      ctx.save();
      ctx.globalAlpha = w.opacity;
      ctx.translate(cssWidth / 2 + w.x, cssHeight / 2 + w.y);
      ctx.rotate((w.rotate * Math.PI) / 180);
      ctx.font = `${w.size}px ${WORD_CLOUD_FONT}`;
      ctx.fillStyle = w.color;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
    });
  }

  // Détection de clic/survol : inverse exactement la transformation appliquée au dessin (translation
  // au centre du mot puis rotation) pour ramener le point cliqué dans le repère LOCAL, non tourné,
  // du mot — où sa boîte englobante (largeur mesurée au placement, hauteur approximée depuis la
  // ligne de base comme une ascendante/descendante de police classique) est un simple rectangle
  // aligné aux axes. Approximatif par nature (pas le contour exact du glyphe, comme la détection de
  // clic native d'echarts-wordcloud ne l'était pas non plus) : suffisant pour un clic/survol, pas
  // pour un rendu.
  function hitTestWordCloud(placedWords, x, y) {
    const rad = Math.PI / 180;
    for (let i = placedWords.length - 1; i >= 0; i -= 1) {
      const w = placedWords[i];
      const dx = x - w.x;
      const dy = y - w.y;
      const angle = -w.rotate * rad;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (localX >= -w.width / 2 && localX <= w.width / 2 && localY >= -w.size * 0.8 && localY <= w.size * 0.3) {
        return w;
      }
    }
    return null;
  }

  // Crée (ou réutilise) le <canvas> dédié au nuage de mots d'une tuile. Objet adapté au même
  // contrat minimal qu'une instance ECharts partout ailleurs dans ce fichier
  // (isDisposed/dispose/resize/getDataURL, voir resizeAll/disposeTile/js/pdf-export.js/
  // js/pptx-export.js) et mis en cache dans la MÊME Map (`chartInstances`, marquée
  // `isWordCloudCanvas`) : aucun de ces appelants n'a besoin de savoir qu'il ne s'agit pas d'ECharts
  // pour cette tuile précise.
  function getOrCreateWordCloudCanvas(tileId, el) {
    const existing = chartInstances.get(tileId);
    if (existing && existing.isWordCloudCanvas && !existing.isDisposed()) return existing;
    // Une instance ECharts peut être restée en cache pour cette tuile si son type vient de changer
    // (un autre type -> nuage de mots) : jamais mélanger les deux mondes (voir le symétrique dans
    // renderChart pour le sens inverse).
    if (existing && !existing.isDisposed()) existing.dispose();
    el.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.className = 'tile-wordcloud-canvas';
    el.appendChild(canvas);
    let disposed = false;
    let placedWords = [];
    let isSplit = false;

    function hitAt(evt) {
      const rect = canvas.getBoundingClientRect();
      return hitTestWordCloud(placedWords, evt.clientX - rect.left - rect.width / 2, evt.clientY - rect.top - rect.height / 2);
    }

    canvas.addEventListener('mousemove', (evt) => {
      const hit = hitAt(evt);
      canvas.title = hit ? `${hit.text} (${formatNumber(hit.value)})` : '';
      canvas.style.cursor = hit && !isSplit ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', (evt) => {
      if (isSplit) return; // voir handleTileClick : un mot découpé ne correspond à aucune valeur
        // de colonne exacte, rien de cohérent à filtrer/driller
      const hit = hitAt(evt);
      if (hit) handleTileClick(tileId, hit.text);
    });

    const instance = {
      isWordCloudCanvas: true,
      isDisposed: () => disposed,
      dispose() { disposed = true; canvas.remove(); },
      resize() {
        // Redessine à la taille ACTUELLE du conteneur à partir du placement déjà calculé, sans
        // relancer tout le layout d3-cloud à chaque redimensionnement continu de fenêtre (déjà
        // debounced côté main.js) : un léger décalage du placement par rapport à la nouvelle taille
        // est accepté (POC) — le prochain rendu complet (filtre, drill-down...) recalculera de toute
        // façon le placement pour la taille alors en vigueur.
        if (!placedWords.length) return;
        drawWordCloud(canvas, placedWords, el.clientWidth || 1, el.clientHeight || 1);
      },
      getDataURL() { return canvas.toDataURL('image/png'); }, // voir js/pdf-export.js/js/pptx-export.js
      showUnavailable(message) {
        placedWords = [];
        const old = el.querySelector('.tile-wordcloud-message');
        if (old) old.remove();
        const msg = document.createElement('p');
        msg.className = 'tile-wordcloud-message';
        msg.textContent = message;
        el.appendChild(msg);
      },
      render(words, cssWidth, cssHeight, split) {
        const old = el.querySelector('.tile-wordcloud-message');
        if (old) old.remove();
        placedWords = words;
        isSplit = split;
        drawWordCloud(canvas, words, cssWidth, cssHeight);
      }
    };
    chartInstances.set(tileId, instance);
    return instance;
  }

  // Point d'entrée du rendu "Nuage de mots" (voir renderChart, qui y redirige avant toute logique
  // ECharts). Reprend les deux modes existants (tile.wordCloudSplit, voir js/data.js:
  // wordFrequency) à l'identique de la version ECharts fusionnée dans la PR #38 : le mode
  // "découpage de cellule" reste pur JS quel que soit le volume de lignes (même raisonnement que le
  // data blending, `blendRows` — voir ROADMAP.md : "n'en dépend toujours pas").
  async function renderWordCloud(tile, rows, state, el) {
    const seq = bumpSeq(tile.id);
    const instance = getOrCreateWordCloudCanvas(tile.id, el);
    const dimension = tile.dimension;
    const isSplit = !!tile.wordCloudSplit;
    const wordCloudAgg = isSplit ? wordFrequency(rows, dimension, true) : await computeGroupBy(rows, dimension, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps

    const mod = await loadD3Cloud();
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé pendant le chargement de la lib
    if (!mod) {
      instance.showUnavailable(t('chart.wordCloudUnavailable'));
      return;
    }
    const CloudLayout = mod.default || mod.CloudLayout;

    if (!wordCloudAgg.length) {
      instance.render([], el.clientWidth || 1, el.clientHeight || 1, isSplit);
      return;
    }

    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    const dim = (d) => (activeOnThisDimension && !sameValue(activeOnThisDimension.value, d) ? { opacity: 0.3 } : undefined);

    const cssWidth = el.clientWidth || 1;
    const cssHeight = el.clientHeight || 1;
    const placedWords = placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps
    instance.render(placedWords, cssWidth, cssHeight, isSplit);
  }
  // ============================================================================================

  // Tableau croisé dynamique : rendu en table HTML plutôt qu'en graphique ECharts (aucune série
  // ECharts adaptée à une grille lignes × colonnes, voir ROADMAP.md). Pas de gestion d'instance
  // ECharts à mettre en cache ici : l'intégralité de la table est reconstruite à chaque rendu
  // (comme buildTileElement/render() le fait déjà pour tout le DOM des tuiles), donc pas de risque
  // de closure figée sur un ancien état (voir la remarque sur renderChart plus haut) — les
  // gestionnaires de clic posés ci-dessous lisent `tile`/`state` du rendu COURANT à chaque fois.
  //
  // Cross-filtering à deux dimensions indépendantes plutôt qu'un mécanisme dédié : un clic sur une
  // cellule de donnée pose/retire un filtre sur la dimension LIGNE et un filtre sur la dimension
  // COLONNE (deux appels à `toggleFilter`, déjà cumulatifs par colonne — voir state.js), un clic sur
  // un en-tête de ligne/colonne ne pose/retire que le filtre correspondant à CETTE dimension. Reclic
  // sur la même cellule retire les deux (toggleFilter est déjà idempotent par colonne). Les totaux
  // (ligne/colonne/général) ne sont jamais cliquables : ce sont des agrégats, pas un point de donnée.
  async function renderPivot(tile, rows, state, container) {
    const seq = bumpSeq(tile.id);
    const pivot = await computePivot(rows, tile.dimension, tile.columnDimension, tile.measure, tile.aggFn);
    if (isStale(tile.id, seq)) return; // rendu plus récent pour cette tuile entre-temps
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (!pivot.rowKeys.length || !pivot.colKeys.length) {
      el.innerHTML = '<p class="pivot-empty">Aucune donnée à afficher.</p>';
      return;
    }
    const rowFilter = state.activeFilters.find((f) => f.column === tile.dimension);
    const colFilter = state.activeFilters.find((f) => f.column === tile.columnDimension);
    const fmt = (v) => (v == null ? '–' : formatNumber(v));

    const headCells = pivot.colKeys.map((ck) => {
      const active = colFilter && sameValue(colFilter.value, ck);
      const dimmed = colFilter && !active;
      const cls = `pivot-col-header${active ? ' pivot-active' : ''}${dimmed ? ' pivot-dimmed' : ''}`;
      return `<th class="${cls}" data-axis="col" data-value="${escapeHtml(String(ck))}">${escapeHtml(String(ck))}</th>`;
    }).join('');

    const bodyRows = pivot.rowKeys.map((rk, ri) => {
      const rowActive = rowFilter && sameValue(rowFilter.value, rk);
      const rowDimmed = rowFilter && !rowActive;
      const rowHeaderCls = `pivot-row-header${rowActive ? ' pivot-active' : ''}${rowDimmed ? ' pivot-dimmed' : ''}`;
      const cells = pivot.cells[ri].map((v, ci) => {
        const ck = pivot.colKeys[ci];
        const colActive = colFilter && sameValue(colFilter.value, ck);
        const colDimmed = colFilter && !colActive;
        const cellActive = rowActive && colActive;
        const cellDimmed = !cellActive && (rowDimmed || colDimmed);
        const cls = `pivot-cell${cellActive ? ' pivot-active' : ''}${cellDimmed ? ' pivot-dimmed' : ''}${v == null ? ' pivot-cell-empty' : ''}`;
        return `<td class="${cls}" data-axis="cell" data-row="${escapeHtml(String(rk))}" data-col="${escapeHtml(String(ck))}">${fmt(v)}</td>`;
      }).join('');
      return `<tr>
        <th class="${rowHeaderCls}" data-axis="row" data-value="${escapeHtml(String(rk))}">${escapeHtml(String(rk))}</th>
        ${cells}
        <td class="pivot-cell pivot-total-cell">${fmt(pivot.rowTotals[ri])}</td>
      </tr>`;
    }).join('');

    const totalLabel = escapeHtml(t('chart.pivot.total'));
    const totalRow = `<tr class="pivot-total-row">
      <th class="pivot-row-header pivot-total-label">${totalLabel}</th>
      ${pivot.colTotals.map((v) => `<td class="pivot-cell pivot-total-cell">${fmt(v)}</td>`).join('')}
      <td class="pivot-cell pivot-total-cell pivot-grand-total">${fmt(pivot.grandTotal)}</td>
    </tr>`;

    el.innerHTML = `<table class="pivot-table">
      <thead><tr><th class="pivot-corner"></th>${headCells}<th class="pivot-col-header pivot-total-label">${totalLabel}</th></tr></thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>`;

    el.querySelectorAll('th[data-axis="row"]').forEach((th) => {
      th.addEventListener('click', () => GristBI.store.toggleFilter(tile.dimension, th.dataset.value, tile.id));
    });
    el.querySelectorAll('th[data-axis="col"]').forEach((th) => {
      th.addEventListener('click', () => GristBI.store.toggleFilter(tile.columnDimension, th.dataset.value, tile.id));
    });
    el.querySelectorAll('td[data-axis="cell"]').forEach((td) => {
      if (td.classList.contains('pivot-cell-empty')) return; // rien à filtrer sur une intersection sans donnée
      td.addEventListener('click', () => {
        GristBI.store.toggleFilter(tile.dimension, td.dataset.row, tile.id);
        GristBI.store.toggleFilter(tile.columnDimension, td.dataset.col, tile.id);
      });
    });
  }

  // ASYNCHRONE depuis que l'agrégation peut passer par DuckDB-WASM au-delà du seuil (voir
  // computeGroupBy) : récupère/crée l'instance ECharts et affiche le fil d'Ariane IMMÉDIATEMENT
  // (ni l'un ni l'autre ne dépend du calcul), bascule l'instance en "chargement" seulement si ce
  // rendu-ci va effectivement utiliser DuckDB (jamais pour les dashboards habituels, bien plus
  // petits que le seuil — zéro changement visuel pour eux), puis attend l'agrégation avant de
  // construire les séries ECharts, exactement comme renderMeasureChart le fait déjà pour les
  // mesures temporelles.
  async function renderChart(tile, rows, state, container, drillPath) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    renderBreadcrumb(tile, drillPath, container);

    // Nuage de mots : chemin de rendu entièrement séparé depuis le 03/11/2026 (passage à d3-cloud,
    // voir renderWordCloud ci-dessous et la discussion avec Antoine ce jour-là) — PAS une instance
    // ECharts, donc rien du reste de cette fonction (getOrCreateChartInstance, l'option ECharts
    // construite plus bas, instance.setOption) ne s'applique à ce type de tuile.
    if (tile.type === 'wordcloud') {
      return renderWordCloud(tile, rows, state, el);
    }
    // Une instance "nuage de mots" (canvas maison, voir getOrCreateWordCloudCanvas) peut être
    // restée en cache pour cette tuile si son type vient de changer (nuage de mots -> un autre
    // type) : jamais la laisser traîner pour qu'ECharts réutilise le même <canvas> à sa place.
    const staleWordCloud = chartInstances.get(tile.id);
    if (staleWordCloud && staleWordCloud.isWordCloudCanvas && !staleWordCloud.isDisposed()) {
      staleWordCloud.dispose();
      chartInstances.delete(tile.id);
    }

    if (typeof echarts === 'undefined') {
      // Pas d'erreur JS ici : sans ce message, la tuile resterait juste vide sans indice (voir le
      // bandeau #echarts-warning dans main.js pour le diagnostic complet).
      el.textContent = t('chart.unavailable');
      return;
    }

    const dimension = currentDimension(tile, drillPath);
    const instance = getOrCreateChartInstance(tile.id, el);

    // Radar "compétences en colonnes" (tile.radarAxisMode === 'columns', voir ROADMAP.md : demande
    // du forum Grist, un radar à partir de plusieurs colonnes numériques plutôt que d'une seule
    // dimension catégorielle) : `tile.dimension`/`tile.measure` ne sont pas renseignés dans ce mode
    // (voir js/main.js, champs masqués), donc computeGroupBy ci-dessous n'a rien de cohérent à
    // regrouper — un axe par colonne choisie, valeur = moyenne de cette colonne sur `rows`.
    const isRadarColumns = tile.type === 'radar' && tile.radarAxisMode === 'columns';
    const radarAxesColumns = isRadarColumns ? (tile.radarAxes || []).filter(Boolean) : [];
    // Comparaison élève/moyenne du groupe filtré (ROADMAP.md, demande du forum Grist) : valable dans
    // les DEUX modes d'axes du radar. `radarEntityRows` reste `null` hors radar/sans comparaison
    // choisie — `hasRadarEntity` distingue "pas de comparaison" de "comparaison choisie mais aucune
    // ligne ne correspond" (valeur orpheline après un changement de table, par ex.), qui retombe
    // silencieusement sur l'affichage normal plutôt que sur une tuile vide.
    const radarEntityRows = (tile.type === 'radar' && tile.radarEntityColumn && tile.radarEntityValue)
      ? rows.filter((r) => sameValue(r[tile.radarEntityColumn], tile.radarEntityValue))
      : null;
    const hasRadarEntity = !!(radarEntityRows && radarEntityRows.length);

    const seq = bumpSeq(tile.id);
    const usingDuckDb = rows.length >= DUCKDB_ROW_THRESHOLD;
    if (usingDuckDb) instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });
    // scatter a besoin de deux agrégations indépendantes (mesures X/Y) : lancées en parallèle, pas
    // en séquence, pour ne payer qu'une seule fois la latence du plus lent des deux chargements
    // DuckDB — même raisonnement que renderKpi (valeur + tendance). Radar "colonnes" : une moyenne
    // par axe, lancées en parallèle elles aussi, même raison. Radar + comparaison : la série de
    // l'entité comparée (ses propres lignes seulement) est elle aussi calculée en parallèle du
    // reste plutôt qu'après coup.
    const [agg, aggY, radarColumnValues, radarEntityColumnValues, radarEntityAgg] = await Promise.all([
      isRadarColumns ? Promise.resolve(null) : computeGroupBy(rows, dimension, tile.measure, tile.aggFn),
      tile.type === 'scatter' ? computeGroupBy(rows, dimension, tile.measureY, tile.aggFn) : Promise.resolve(null),
      isRadarColumns ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(rows, col, 'avg'))) : Promise.resolve(null),
      (isRadarColumns && hasRadarEntity) ? Promise.all(radarAxesColumns.map((col) => computeAggregateSingle(radarEntityRows, col, 'avg'))) : Promise.resolve(null),
      (!isRadarColumns && tile.type === 'radar' && hasRadarEntity) ? computeGroupBy(radarEntityRows, dimension, tile.measure, tile.aggFn) : Promise.resolve(null)
    ]);
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps
    // Inconditionnel, même raison que renderGauge ci-dessus : un rendu qui repasse sous le seuil
    // pendant qu'un rendu précédent (au-dessus du seuil) pour cette même tuile est encore en vol
    // doit quand même lever le masque que CE DERNIER a affiché, même si CE rendu-ci (le gagnant)
    // n'utilise pas DuckDB lui-même — sinon le masque reste bloqué indéfiniment.
    instance.hideLoading();

    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    // sameValue (pas !==) : le filtre stocke souvent params.name (toujours une chaîne ECharts),
    // à comparer à `d` qui garde le type d'origine de la donnée (ex. Annee=2025, un nombre).
    const dim = (d) => (activeOnThisDimension && !sameValue(activeOnThisDimension.value, d)
      ? { opacity: 0.3 }
      : undefined);

    let option;
    if (tile.type === 'pie') {
      option = {
        color: CATEGORICAL_PALETTE,
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie',
          radius: '65%',
          data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'treemap') {
      option = {
        color: CATEGORICAL_PALETTE,
        tooltip: { trigger: 'item' },
        series: [{
          type: 'treemap',
          roam: false,
          // Version PLATE délibérément (voir ROADMAP.md) : un seul niveau de rectangles, pas de
          // hiérarchie imbriquée. `nodeClick: false` désactive le zoom-sur-clic natif d'ECharts
          // (pensé pour une hiérarchie à plusieurs niveaux) pour laisser le clic au gestionnaire
          // générique ci-dessus (drill-down/cross-filter), sans comportement concurrent.
          nodeClick: false,
          breadcrumb: { show: false },
          data: agg.map((d) => ({ name: d.dimension, value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    } else if (tile.type === 'scatter') {
      // Version agrégée (pas ligne-à-ligne) : un point par valeur de la dimension, ses coordonnées
      // X/Y sont les agrégats de deux mesures DIFFÉRENTES sur ce même groupe. Les deux appels à
      // computeGroupBy (ci-dessus, en parallèle) portent sur le même `rows`/`dimension`, donc le
      // même ensemble de groupes, mais on associe par NOM de dimension (Map) plutôt que par index
      // pour rester correct même si l'ordre venait à diverger un jour entre les deux appels.
      const aggYByDimension = new Map(aggY.map((d) => [d.dimension, d.value]));
      option = {
        color: CATEGORICAL_PALETTE,
        grid: numericGrid,
        tooltip: {
          trigger: 'item',
          formatter: (params) => `${escapeHtml(String(params.name))}<br/>`
            + `${escapeHtml(tile.measure)} : ${formatNumber(params.value[0])}<br/>`
            + `${escapeHtml(tile.measureY)} : ${formatNumber(params.value[1])}`
        },
        xAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        series: [{
          type: 'scatter',
          symbolSize: 14,
          // `name` explicite : contrairement à bar (axe catégoriel, ECharts déduit params.name de
          // l'index sur l'axe), scatter a deux axes numériques -> rien n'associe un point à sa
          // catégorie sans ce champ, et le gestionnaire de clic générique deviendrait muet
          // (params.name undefined, drill/cross-filter sur une valeur "undefined").
          data: agg.map((d) => ({
            name: d.dimension,
            value: [d.value, aggYByDimension.get(d.dimension)],
            itemStyle: dim(d.dimension)
          }))
        }]
      };
    } else if (tile.type === 'waterfall') {
      // Pas de série ECharts native "waterfall" (voir ROADMAP.md) : simulation standard par 2
      // séries de barres empilées — une invisible (`base`, la partie du cumul déjà atteinte avant
      // cette catégorie) portant la vraie partie visible (`rise`/`fall` selon le signe), comme
      // documenté par ECharts lui-même pour ce type de graphique. Reste sur le MÊME
      // dimension/measure/aggFn que "bar" (aucun nouveau champ de formulaire) : seul l'empilement
      // cumulatif change, pas la donnée sous-jacente — même `agg` que la branche "bar" ci-dessous.
      // xAxis reste catégoriel -> params.name (clic) est TOUJOURS la catégorie, quelle que soit la
      // série cliquée (y compris la base invisible) : le gestionnaire générique de clic
      // (getOrCreateChartInstance) fonctionne donc ici SANS aucune adaptation, contrairement au
      // radar ci-dessous.
      const { base, rise, fall } = waterfallSeries(agg);
      option = {
        color: CATEGORICAL_PALETTE,
        grid: { ...numericGrid, top: 40 },
        legend: { top: 0, data: [t('chart.waterfall.increase'), t('chart.waterfall.decrease')] },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
        yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        series: [
          {
            name: t('chart.waterfall.base'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: 'transparent' },
            tooltip: { show: false },
            data: base.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          },
          {
            name: t('chart.waterfall.increase'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: CATEGORICAL_PALETTE[2] },
            data: rise.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          },
          {
            name: t('chart.waterfall.decrease'),
            type: 'bar',
            stack: 'waterfall',
            itemStyle: { color: CATEGORICAL_PALETTE[7] },
            data: fall.map((v, i) => ({ value: v, itemStyle: dim(agg[i].dimension) }))
          }
        ]
      };
    } else if (tile.type === 'radar') {
      // Radar à une ou DEUX séries (un ou deux "polygones"). Deux façons d'obtenir ses axes
      // (tile.radarAxisMode, voir ROADMAP.md) :
      // - 'dimension' (par défaut, comportement historique) : un axe par valeur de la dimension —
      //   plutôt que le radar classique Power BI (plusieurs mesures en axes pour comparer quelques
      //   entités), qui ne collait à aucun jeu de données démonstratif disponible au moment du
      //   premier jet (voir HYPOTHESES.md).
      // - 'columns' (compétences en colonnes, demande du forum Grist — entretiens d'orientation :
      //   compétences déjà en colonnes, une ligne par élève) : un axe par colonne numérique choisie
      //   (tile.radarAxes), valeur = moyenne de cette colonne sur `rows` (radarColumnValues
      //   ci-dessus, déjà calculé en tenant compte du seuil DuckDB).
      const axisNames = isRadarColumns ? radarAxesColumns : agg.map((d) => String(d.dimension));
      const groupValues = isRadarColumns ? radarColumnValues : agg.map((d) => d.value);
      // Étiquette de la série "groupe" : `tile.measure` en mode dimension (inchangé, même valeur
      // qu'avant la comparaison élève/moyenne ci-dessous) ; en mode colonnes, `tile.title` tant
      // qu'aucune comparaison n'est affichée (comportement du premier jet de ce mode, inchangé),
      // sinon un libellé explicite ("Moyenne du groupe") pour la distinguer de la série élève.
      const groupLabel = isRadarColumns ? (hasRadarEntity ? t('chart.radar.groupAverage') : tile.title) : tile.measure;

      // Comparaison élève/moyenne du groupe filtré (tile.radarEntityColumn/radarEntityValue/
      // radarCompareAverage, voir ROADMAP.md) : une 2e série avec les mêmes axes, calculée sur les
      // seules lignes de l'élève choisi. En mode dimension, ses propres valeurs peuvent ne pas
      // couvrir tous les axes du groupe (ex. une note manquante pour une matière) — complétées à 0
      // par nom d'axe plutôt que de décaler les valeurs par position.
      let series;
      if (hasRadarEntity) {
        const entityValues = isRadarColumns
          ? radarEntityColumnValues
          : (() => {
              const byName = new Map(radarEntityAgg.map((d) => [String(d.dimension), d.value]));
              return axisNames.map((name) => (byName.has(name) ? byName.get(name) : 0));
            })();
        const entitySeries = { name: String(tile.radarEntityValue), value: entityValues };
        series = tile.radarCompareAverage ? [entitySeries, { name: groupLabel, value: groupValues }] : [entitySeries];
      } else {
        series = [{ name: groupLabel, value: groupValues }];
      }

      // Même max/min PARTAGÉ par tous les axes ET toutes les séries affichées (pas un max par axe,
      // qui normaliserait chaque axe à 100% et rendrait toute comparaison de hauteur trompeuse, ni
      // un max par série, qui rendrait la comparaison élève/moyenne elle-même trompeuse) ; `min`
      // partagé aussi, pour les mesures pouvant être négatives.
      const allValues = series.reduce((acc, s) => acc.concat(s.value), []);
      const maxVal = Math.max(0, ...allValues);
      const minVal = Math.min(0, ...allValues);
      option = {
        color: CATEGORICAL_PALETTE,
        tooltip: { trigger: 'item' },
        legend: series.length > 1 ? { top: 0, data: series.map((s) => s.name) } : undefined,
        radar: {
          indicator: axisNames.map((name) => ({ name: String(name), max: maxVal || 1, min: minVal }))
        },
        series: [{
          type: 'radar',
          data: series
        }]
      };
    } else {
      // bar (par défaut)
      option = {
        color: CATEGORICAL_PALETTE,
        grid: numericGrid,
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: agg.map((d) => d.dimension) },
        yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
        series: [{
          type: 'bar',
          data: agg.map((d) => ({ value: d.value, itemStyle: dim(d.dimension) }))
        }]
      };
    }
    instance.setOption(option, true);
  }

  // Tuile bar avec un mode de calcul temporel ('cumulative'/'ytd'/'yoy', voir ROADMAP.md "Mesures
  // façon DAX simplifié") : contrairement à toutes les autres tuiles, ce chemin de rendu est
  // ASYNCHRONE (le calcul passe par GristBI.duckdbEngine.timeSeriesMeasures, une vraie requête SQL
  // DuckDB-WASM) — la seule tuile de ce widget dont le rendu ne se termine pas de façon synchrone
  // dans le même tick que l'appel à renderTile. Pas de dimension/drill-down ici : l'axe est TOUJOURS
  // le mois calculé depuis `tile.dateColumn` (voir data.js:measureSeriesForTile), donc le fil
  // d'Ariane est masqué comme pour KPI/gauge.
  async function renderMeasureChart(tile, rows, container) {
    const breadcrumbEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (breadcrumbEl) breadcrumbEl.hidden = true;
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    if (typeof echarts === 'undefined') {
      el.textContent = t('chart.unavailable');
      return;
    }
    const instance = getOrCreateChartInstance(tile.id, el);

    // Capturé AVANT l'attente asynchrone : seul le dernier appel lancé pour CETTE tuile doit
    // appliquer son résultat (voir la doc de renderSeq plus haut) — un filtre posé, une tuile
    // éditée/supprimée pendant le calcul SQL ne doivent pas faire apparaître un résultat périmé.
    const seq = bumpSeq(tile.id);
    instance.showLoading('default', { text: t('chart.computing'), color: CATEGORICAL_PALETTE[0], maskColor: 'rgba(255, 255, 255, 0.6)' });

    let timeSeries;
    try {
      timeSeries = await GristBI.duckdbEngine.timeSeriesMeasures(rows, tile.dateColumn, tile.measure, tile.aggFn);
    } catch (e) {
      console.error('[GristBI] échec du calcul de la mesure temporelle (DuckDB)', e);
      if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé/tuile supprimée entre-temps
      instance.hideLoading();
      const freshEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
      if (freshEl) freshEl.textContent = t('chart.measureFailed');
      return;
    }
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // périmé/tuile supprimée entre-temps
    instance.hideLoading();

    const { categories, series } = measureSeriesForTile(tile.measureMode, timeSeries);
    const option = {
      color: CATEGORICAL_PALETTE,
      grid: { ...numericGrid, top: series.length > 1 ? 40 : numericGrid.top },
      legend: series.length > 1 ? { top: 0 } : undefined,
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value', axisLabel: { formatter: formatCompactNumber } },
      series: series.map((s) => ({ type: 'bar', name: s.label, data: s.data }))
    };
    instance.setOption(option, true);
  }

  // Fil d'Ariane : la dimension racine (cliquable dès qu'on a drillé, pour tout remonter) puis un
  // segment par niveau franchi (chacun cliquable pour remonter jusqu'à CE niveau, sauf le dernier).
  function renderBreadcrumb(tile, drillPath, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-breadcrumb`);
    if (!el) return;
    const levels = tileDrillLevels(tile);
    if (!levels.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!drillPath.length) {
      el.innerHTML = `<span>${escapeHtml(tile.dimension)}</span>
        <span class="breadcrumb-hint">${escapeHtml(t('chart.breadcrumb.hint', { column: levels[0] }))}</span>`;
      return;
    }
    const rootCrumb = `<button type="button" class="breadcrumb-link" data-depth="0">${escapeHtml(tile.dimension)}</button>`;
    const pathCrumbs = drillPath.map((step, i) => {
      const depth = i + 1;
      const label = `${escapeHtml(String(step.value))} · ${escapeHtml(levels[i])}`;
      return depth === drillPath.length ? `<span>${label}</span>`
        : `<button type="button" class="breadcrumb-link" data-depth="${depth}">${label}</button>`;
    });
    el.innerHTML = [rootCrumb].concat(pathCrumbs).join(' <span class="breadcrumb-sep">▸</span> ');
    el.querySelectorAll('.breadcrumb-link').forEach((btn) => {
      btn.addEventListener('click', () => GristBI.store.drillUp(tile.id, Number(btn.dataset.depth)));
    });
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
  }

  // Format compact ("2,7 M", "150 k") pour les libellés d'AXE seulement (pas les cartes KPI ni les
  // info-bulles, qui gardent la précision exacte). [BUG RÉEL trouvé en capturant la première version
  // de cette passe de design] sur le jeu de test de charge, les valeurs à 7 chiffres (~2 700 000)
  // dépassaient la largeur d'axe disponible dans une tuile ; ECharts repliait le libellé sur 2
  // lignes et la partie haute sortait du cadre visible, n'affichant plus que "000" empilés.
  const compactNumberFormatter = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  function formatCompactNumber(n) {
    return compactNumberFormatter.format(n);
  }

  function resizeAll() { chartInstances.forEach((inst) => !inst.isDisposed() && inst.resize()); }

  function disposeTile(tileId) {
    const inst = chartInstances.get(tileId);
    if (inst) { inst.dispose(); chartInstances.delete(tileId); }
    renderSeq.delete(tileId);
  }

  // Exposé uniquement pour dev-tests/ (calcul de coordonnées pixel précises dans le test Playwright
  // via convertToPixel) - ne pas s'appuyer dessus pour de la logique applicative.
  function getInstance(tileId) { return chartInstances.get(tileId) || null; }

  GristBI.charts = { renderTile, resizeAll, disposeTile, getInstance };
})(window);
