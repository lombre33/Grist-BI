/*
 * Rendu des tuiles — nuage de mots (canvas maison, bibliothèque d3-cloud fournie par l extension de GFS).
 * Voir js/charts.js.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.chartParts;
  const {
    filterSelects, paletteColors, wordFrequency
  } = GristBI.data;
  const { t } = GristBI.i18n;
  const { bumpSeq, chartInstances, computeGroupBy, fmtFor, isStale, liveTile } = parts;
  // Définies dans un fichier chargé plus tard : liaison tardive, résolue à l'appel.
  const handleTileClick = (...args) => parts.handleTileClick(...args);

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
  // d3-cloud vient de GFS (consigne 019, 18/11/2026) : l'extension « Nuage de mots » (`nuage-de-mots`) que la personne ajoute dans
  // « Apps et extensions ». Ce dépôt n'en garde ni copie, ni import map, ni adresse : js/extensions.js lit `GfsLink.library('d3-cloud')`,
  // charge `src` par `<script type="module" integrity>` et rend la classe `CloudLayout` (`GfsPaquets['d3-cloud'].modules['d3-cloud'].default`).
  // Rend `null` sans l'extension (seule, ou pas encore ajoutée) : la tuile écrit alors son message, jamais une exception. Le résultat
  // « absente » n'est pas gardé : l'extension peut être ajoutée pendant que l'app est ouverte (js/main.js repeint alors les tuiles).
  async function loadD3Cloud() {
    return GristBI.extensions ? GristBI.extensions.load('nuage-de-mots') : null;
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

  const WORD_CLOUD_FONT = 'sans-serif';
 // police système, pas de police tierce (Manrope refusée
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
  function placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight, palette) {
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
        // messages "chart.wordCloudNeedsExtension"/"chart.wordCloudNeedsGfs" plus bas
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
        color: palette[i % palette.length],
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
      const live = liveTile(tileId);
      canvas.title = hit ? `${hit.text} (${fmtFor(live || {}, live && live.measure).format(hit.value)})` : '';
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
        // Le <canvas> (300 x 150 par défaut) poussait le message sous le bas de la tuile : tuile vide, sans explication.
        canvas.style.display = 'none';
        const old = el.querySelector('.tile-wordcloud-message');
        if (old) old.remove();
        const msg = document.createElement('p');
        msg.className = 'tile-wordcloud-message';
        msg.textContent = message;
        el.appendChild(msg);
      },
      render(words, cssWidth, cssHeight, split) {
        canvas.style.display = '';
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
      const hosted = GristBI.extensions && GristBI.extensions.stateOf('nuage-de-mots') === 'inactive';
      instance.showUnavailable(t(hosted ? 'chart.wordCloudNeedsExtension' : 'chart.wordCloudNeedsGfs'));
      return;
    }
    const CloudLayout = mod.default || mod.CloudLayout;

    if (!wordCloudAgg.length) {
      instance.render([], el.clientWidth || 1, el.clientHeight || 1, isSplit);
      return;
    }

    const activeOnThisDimension = state.activeFilters.find((f) => f.column === dimension);
    const dim = (d) => (activeOnThisDimension && !filterSelects(activeOnThisDimension, d) ? { opacity: 0.3 } : undefined);

    const cssWidth = el.clientWidth || 1;
    const cssHeight = el.clientHeight || 1;
    const placedWords = placeWordCloud(CloudLayout, wordCloudAgg, dim, cssWidth, cssHeight, paletteColors(tile.palette));
    if (isStale(tile.id, seq) || instance.isDisposed()) return; // rendu plus récent entre-temps
    instance.render(placedWords, cssWidth, cssHeight, isSplit);
  }

  Object.assign(parts, { renderWordCloud });
})(window);
