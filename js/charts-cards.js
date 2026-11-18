/*
 * Rendu des tuiles — cartes et tables : texte, table plate, carte KPI, progression, Gantt, jauge,
 * tableau croisé (HTML/CSS, ou ECharts pour la jauge). Voir js/charts.js.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});
  const parts = GristBI.chartParts;
  const {
    trendFromGroups, targetProgress, progressRows, sparklineValues, sparklineGeometry, ganttTasks, ganttLayout, filterSelects, heatStops, heatCellColors, paletteColors, escapeHtml, rowsForTile
  } = GristBI.data;
  const { t } = GristBI.i18n;
  const { CATEGORICAL_PALETTE, DUCKDB_ROW_THRESHOLD, bumpSeq, chartInstances, chartTheme, clamp, computeAggregateSingle, computeGroupBy, computePivot, fmtFor, isStale, liveTile, measureText, trackLoading } = parts;

  // Tuile Texte : aucune donnée, aucune instance ECharts (donc rien à disposer ni à redimensionner). Le contenu
  // n'est reconstruit que s'il change : la tuile est mise en cache et re-rendue à chaque render() (js/main.js).
  // `renderTextHtml` échappe tout (js/data.js) : jamais d'HTML saisi par une personne dans le DOM.
  function renderText(tile, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-text-body`);
    if (!el) return;
    const html = GristBI.data.renderTextHtml(tile.text);
    if (el.dataset.html !== html) { GristBI.safeHtml.setHtml(el, html); el.dataset.html = html; }
  }

  // Table plate (type 'table') : une table HTML dans `.tile-chart` (comme le tableau croisé), colonnes choisies dans
  // l'ordre voulu, lignes telles qu'elles arrivent après les filtres. Le TRI d'un clic sur l'en-tête est un état de
  // lecture, jamais enregistré dans la configuration : une personne qui lit le tableau de bord le change sans le
  // modifier pour les autres (comme le chemin de drill-down, qui n'est pas persisté non plus) ; il survit aux
  // re-rendus (clé = id de tuile), tombe avec la tuile (`disposeTile`). Plafond d'affichage TABLE_TILE_MAX_ROWS
  // lignes, avec un message : le tri s'applique à TOUTES les lignes avant la coupe. Aucune cellule n'est cliquable
  // (pas de cross-filtre : une ligne n'est pas une catégorie) ; le bouton « Détail » montre toutes les colonnes.
  const tableSort = new Map();
 // id de tuile -> { column, dir: 'asc' | 'desc' }
  function renderTable(tile, rows, container) {
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const columns = GristBI.data.tableColumnsOf(tile, rows);
    const sort = tableSort.get(tile.id);
    const sortCol = sort && columns.includes(sort.column) ? sort : null;
    const sorted = sortCol ? GristBI.data.sortRowsBy(rows, sortCol.column, sortCol.dir) : rows;
    const shown = sorted.slice(0, GristBI.data.TABLE_TILE_MAX_ROWS);
    const lang = GristBI.i18n.getLang();

    let html;
    if (!columns.length) {
      html = `<p class="pivot-empty">${escapeHtml(t('chart.table.noColumns'))}</p>`;
    } else {
      const head = columns.map((c) => {
        const dir = sortCol && sortCol.column === c ? sortCol.dir : null;
        const arrow = dir === 'asc' ? '▲' : (dir === 'desc' ? '▼' : '');
        const aria = dir === 'asc' ? 'ascending' : (dir === 'desc' ? 'descending' : 'none');
        return `<th scope="col" aria-sort="${aria}"><button type="button" class="dt-sort" data-column="${escapeHtml(c)}" title="${escapeHtml(t('chart.table.sortBy', { column: c }))}">`
          + `<span>${escapeHtml(c)}</span><span class="dt-arrow" aria-hidden="true">${arrow}</span></button></th>`;
      }).join('');
      const body = shown.map((r) => `<tr>${columns.map((c) => {
        const v = r[c];
        const isNum = (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'bigint';
        const text = isNum ? GristBI.format.cellNumber(tile, c, v, lang) : GristBI.data.cellText(v);
        return `<td${isNum ? ' class="dt-num"' : ''}>${escapeHtml(text)}</td>`;
      }).join('')}</tr>`).join('');
      const empty = shown.length ? '' : `<p class="pivot-empty">${escapeHtml(t('chart.table.empty'))}</p>`;
      const more = rows.length > shown.length
        ? `<p class="dt-truncated">${escapeHtml(t('chart.table.truncated', { shown: shown.length, total: rows.length }))}</p>` : '';
      html = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${empty}${more}`;
    }
    // Reconstruit seulement si le contenu change : la tuile est re-rendue à chaque render() (js/main.js) et un
    // innerHTML identique ferait perdre la position de défilement et le focus d'un en-tête.
    if (el.dataset.html !== html) {
      const scroll = el.scrollTop;
      GristBI.safeHtml.setHtml(el, html);
      el.dataset.html = html;
      el.scrollTop = scroll;
    }
    if (el.dataset.bound !== '1') {
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.dt-sort');
        if (!btn || !el.contains(btn)) return;
        const live = liveTile(tile.id); // la tuile VIVANTE, jamais celle du premier rendu (CLAUDE.md §7 n°18)
        if (!live) return;
        const column = btn.dataset.column;
        const cur = tableSort.get(live.id);
        const dir = GristBI.data.nextSortDir(cur && cur.column === column ? cur.dir : null);
        if (dir) tableSort.set(live.id, { column, dir }); else tableSort.delete(live.id);
        const state = GristBI.store.getState();
        renderTable(live, rowsForTile(live, state), container);
        const again = el.querySelector(`.dt-sort[data-column="${CSS.escape(column)}"]`);
        if (again) again.focus();
      });
    }
  }

  // ASYNCHRONE depuis que la valeur/la tendance peuvent passer par DuckDB-WASM au-delà du seuil
  // (voir computeAggregateSingle/computeGroupBy) — les calculs sont indépendants (une
  // tuile KPI n'a qu'une seule mesure mais potentiellement une dimension de tendance différente),
  // lancés en parallèle plutôt qu'en séquence pour ne payer qu'une seule fois la latence du plus
  // lent des deux. Sous le seuil (l'immense majorité des dashboards), les deux résolvent sur le
  // même tick et rien ne change visuellement par rapport à l'ancien comportement synchrone.
  async function renderKpi(tile, rows, container) {
    const seq = bumpSeq(tile.id);
    // Les groupes de la dimension de tendance servent deux fois : le delta (deux dernières périodes) et, si la
    // tuile le demande, la courbe (toutes les périodes). Un seul calcul, DuckDB au-delà du seuil comme le reste.
    const hasTarget = Boolean(tile.targetColumn) || finiteTarget(tile.target) != null;
    const [value, groups, targetValue] = await Promise.all([
      computeAggregateSingle(rows, tile.measure, tile.aggFn),
      tile.trendDimension ? computeGroupBy(rows, tile.trendDimension, tile.measure, tile.aggFn) : Promise.resolve(null),
      tile.targetColumn ? computeAggregateSingle(rows, tile.targetColumn, tile.aggFn) : Promise.resolve(tile.target)
    ]);
    if (isStale(tile.id, seq)) return; // rendu plus récent pour cette tuile entre-temps
    const trend = groups ? trendFromGroups(groups) : null;

    const valueEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-value`);
    if (!valueEl) return;
    const kpiFmt = fmtFor(tile, tile.measure);
    const kpiText = kpiFmt.format(value) || '–';
    valueEl.textContent = kpiText;
    // Le CSS réduit la police pour que la valeur tienne dans la tuile (voir `.tile-kpi-value`) : il lui faut la longueur.
    valueEl.style.setProperty('--kpi-chars', String(Math.max(kpiText.length, 4)));

    const trendEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-trend`);
    if (trendEl) {
      if (!trend) {
        trendEl.hidden = true;
      } else {
        const isUp = trend.deltaPct >= 0;
        trendEl.hidden = false;
        trendEl.className = `tile-kpi-trend ${isUp ? 'trend-up' : 'trend-down'}`;
        trendEl.textContent = `${isUp ? '▲' : '▼'} ${kpiFmt.percent(Math.abs(trend.deltaPct))} vs ${trend.previousKey}`;
      }
    }

    // Courbe de tendance (SVG maison, pas d'instance ECharts : rien à disposer ni à redimensionner).
    const sparkEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-spark`);
    if (sparkEl) {
      const geo = tile.kpiSparkline && groups ? sparklineGeometry(sparklineValues(groups), 100, 30, 3) : null;
      if (!geo) {
        sparkEl.hidden = true;
        sparkEl.innerHTML = '';
      } else {
        sparkEl.hidden = false;
        GristBI.safeHtml.setHtml(sparkEl, '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
          + `<path class="spark-area" d="${geo.area}"/><path class="spark-line" d="${geo.line}" vector-effect="non-scaling-stroke"/></svg>`
          + `<span class="spark-dot" style="left:${geo.last.x}%;top:${geo.last.y}%"></span>`);
      }
    }

    // Objectif : barre de progression, « 82 % de l'objectif », l'objectif lui-même ; couleur selon les seuils de la tuile.
    const goalEl = container.querySelector(`[data-tile-id="${tile.id}"] .tile-kpi-goal`);
    if (goalEl) {
      const prog = hasTarget ? targetProgress(value, targetValue, tile.goodPct, tile.warnPct) : null;
      if (!prog) {
        goalEl.hidden = true;
      } else {
        goalEl.hidden = false;
        const pctText = kpiFmt.percent(prog.pct);
        const goalBar = goalEl.querySelector('.goal-bar');
        const fill = goalEl.querySelector('.goal-fill');
        fill.style.width = `${Math.round(prog.fill * 1000) / 10}%`;
        fill.className = `goal-fill goal-${prog.level}`;
        goalBar.setAttribute('aria-valuenow', String(Math.round(prog.pct)));
        goalBar.setAttribute('aria-label', t('chart.kpi.goalPct', { pct: pctText }));
        goalEl.querySelector('.goal-pct').textContent = t('chart.kpi.goalPct', { pct: pctText });
        goalEl.querySelector('.goal-target').textContent = t('chart.kpi.goalTarget', { target: kpiFmt.format(finiteTarget(targetValue)) });
      }
    }
  }

  function finiteTarget(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Tuile « Progression » : une barre par catégorie, remplie à hauteur de son % d'objectif (objectif commun saisi, ou
  // colonne d'objectifs agrégée PAR catégorie). Cliquable comme une barre de graphique : filtre les autres tuiles sur la
  // catégorie (re-clic = retire), les autres lignes s'estompent. Pas de drill-down, pas de tri : l'ordre des données.
  // HTML/CSS maison dans `.tile-chart` (comme la table plate), reconstruit seulement s'il change.
  async function renderProgress(tile, rows, state, container) {
    const seq = bumpSeq(tile.id);
    const [valueGroups, targetGroups] = await Promise.all([
      computeGroupBy(rows, tile.dimension, tile.measure, tile.aggFn),
      tile.targetColumn ? computeGroupBy(rows, tile.dimension, tile.targetColumn, tile.aggFn) : Promise.resolve(null)
    ]);
    if (isStale(tile.id, seq)) return;
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const list = progressRows(valueGroups, targetGroups, tile.target, tile.goodPct, tile.warnPct);
    const numberFormat = fmtFor(tile, tile.measure);
    const filter = state.activeFilters.find((af) => af.column === tile.dimension);
    const good = finiteTarget(tile.goodPct) != null ? Number(tile.goodPct) : GristBI.data.DEFAULT_GOOD_PCT;
    const warn = finiteTarget(tile.warnPct) != null ? Number(tile.warnPct) : GristBI.data.DEFAULT_WARN_PCT;
    let html;
    if (!list.length) {
      html = `<p class="pivot-empty">${escapeHtml(t('chart.progress.empty'))}</p>`;
    } else {
      const rowsHtml = list.map((r) => {
        const key = String(r.key);
        const active = filter && filterSelects(filter, key);
        const dimmed = filter && !active;
        const pctText = r.pct == null ? '–' : numberFormat.percent(r.pct);
        const title = r.target == null ? `${key} : ${numberFormat.format(r.value) || '–'}`
          : t('chart.progress.row', { label: key, value: numberFormat.format(r.value) || '–', target: numberFormat.format(r.target) || '–' });
        return `<div class="prog-row${active ? ' prog-active' : ''}${dimmed ? ' prog-dimmed' : ''}" role="button" tabindex="0" data-value="${escapeHtml(key)}" title="${escapeHtml(title)}">`
          + `<span class="prog-label">${escapeHtml(key)}</span>`
          + `<span class="prog-track"><span class="prog-fill ${r.level ? 'goal-' + r.level : ''}" style="width:${Math.round(r.fill * 1000) / 10}%"></span></span>`
          + `<span class="prog-pct">${escapeHtml(pctText)}</span></div>`;
      }).join('');
      const legend = t('chart.progress.legend', { good: String(good), warn: String(warn) });
      html = `<div class="prog-list">${rowsHtml}</div><p class="prog-legend">${escapeHtml(legend)}</p>`;
    }
    if (el.dataset.html !== html) {
      const scroll = el.scrollTop;
      GristBI.safeHtml.setHtml(el, html);
      el.dataset.html = html;
      el.scrollTop = scroll;
    }
    if (el.dataset.bound !== '1') {
      el.dataset.bound = '1';
      const pick = (target) => {
        const row = target.closest && target.closest('.prog-row');
        const live = liveTile(tile.id);
        if (!row || !live || !el.contains(row)) return;
        GristBI.store.toggleFilter(live.dimension, row.dataset.value, live.id);
      };
      el.addEventListener('click', (e) => pick(e.target));
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!(e.target.classList && e.target.classList.contains('prog-row'))) return;
        e.preventDefault();
        pick(e.target);
      });
    }
  }

  // Gantt / planning (type 'gantt') : une ligne par tâche, une barre de sa date de début à sa date de fin sur un axe du temps commun
  // (js/data.js:ganttTasks/ganttLayout). HTML/CSS maison dans `.tile-chart` (comme la Progression : aucune instance ECharts, donc
  // rien à disposer ni à redimensionner ; l'axe est en pourcentages de la largeur, il suit tout seul l'agrandissement d'une tuile).
  // Un clic sur une tâche filtre les autres tuiles sur son libellé, un clic sur une pastille de la légende sur son statut (re-clic =
  // retire) ; les lignes non retenues par un filtre sur la colonne de libellé ou de statut s'estompent. La couleur ne porte jamais
  // seule l'information : la légende nomme chaque statut et l'infobulle de la ligne le répète. Reconstruit seulement si le HTML change
  // (le défilement survit aux render()) ; l'état « aujourd'hui » se relit à chaque rendu.
  function renderGantt(tile, rows, state, container) {
    bumpSeq(tile.id); // invalide un calcul asynchrone encore en vol pour cette tuile (changement de type)
    const el = container.querySelector(`[data-tile-id="${tile.id}"] .tile-chart`);
    if (!el) return;
    const lang = GristBI.i18n.getLang();
    // Nombre de graduations : ~54 px par libellé sur la part de la largeur qui revient à l'axe (72 % de la tuile) ; chaque libellé est de plus
    // rogné à sa case (CSS), jamais posé sur celui d'à côté. L'agrandissement d'une tuile relance render(), donc le calcul.
    const axisPx = (el.clientWidth || 300) * 0.72;
    const layout = ganttLayout(ganttTasks(rows, tile.dimension, tile.startColumn, tile.endColumn, tile.seriesColumn), Date.now(), Math.max(2, Math.floor(axisPx / 54)));
    const monthNames = t('chart.calendar.monthNames').split(',');
    const shortDate = (iso) => {
      try { return new Date(Date.parse(iso + 'T00:00:00Z')).toLocaleDateString(lang, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; }
    };
    const pctOf = (x) => Math.round(x * 10000) / 100;
    let html;
    if (!layout.bars.length) {
      html = `<p class="pivot-empty">${escapeHtml(t('chart.gantt.empty'))}</p>`;
    } else {
      const colors = paletteColors(tile.palette);
      const colorOf = (status) => colors[Math.max(0, layout.statuses.indexOf(status)) % colors.length];
      const labelFilter = state.activeFilters.find((af) => af.column === tile.dimension);
      const statusFilter = tile.seriesColumn ? state.activeFilters.find((af) => af.column === tile.seriesColumn) : null;
      // L'année s'écrit une fois, dans le coin de l'axe (au-dessus de la colonne des libellés) ; une graduation de janvier la répète
      // seulement quand la période en couvre plusieurs.
      const y0 = layout.min.slice(0, 4);
      const y1 = layout.max.slice(0, 4);
      const multiYear = y0 !== y1;
      const yearText = multiYear ? `${y0}–${y1}` : y0;
      const ticksHtml = layout.ticks.map((tk, i) => {
        const cell = pctOf((i + 1 < layout.ticks.length ? layout.ticks[i + 1].pct : 1) - tk.pct); // largeur de sa case : jusqu'à la graduation suivante
        const m = monthNames[tk.month] || '';
        let text;
        if (tk.kind === 'month') text = m + (multiYear && tk.month === 0 ? ' ' + tk.year : '');
        else if (tk.kind === 'week') text = `${tk.day} ${m}`;
        else text = (i === 0 || tk.day === 1) ? `${tk.day} ${m}` : String(tk.day);
        return `<span class="gantt-tick" style="left:${pctOf(tk.pct)}%;width:${cell}%">${escapeHtml(text)}</span>`;
      }).join('');
      const linesHtml = layout.ticks.filter((tk) => tk.pct > 0).map((tk) => `<span class="gantt-line" style="left:${pctOf(tk.pct)}%"></span>`).join('');
      const rowsHtml = layout.bars.map((b) => {
        const label = b.label === '' ? '–' : b.label;
        const hasStatus = tile.seriesColumn && b.status !== undefined;
        const dimmed = (labelFilter && b.label !== '' && !filterSelects(labelFilter, b.label)) || (statusFilter && hasStatus && b.status !== '' && !filterSelects(statusFilter, b.status));
        const active = !dimmed && ((labelFilter && b.label !== '' && filterSelects(labelFilter, b.label)) || (statusFilter && hasStatus && b.status !== '' && filterSelects(statusFilter, b.status)));
        const days = Math.round((Date.parse(b.end + 'T00:00:00Z') - Date.parse(b.start + 'T00:00:00Z')) / 86400000) + 1;
        const title = t('chart.gantt.row', { label, start: shortDate(b.start), end: shortDate(b.end), days: String(days) })
          + (hasStatus ? ` · ${b.status === '' ? t('chart.series.empty') : b.status}` : '');
        const clickable = b.label !== '';
        return `<div class="gantt-row${active ? ' gantt-active' : ''}${dimmed ? ' gantt-dimmed' : ''}"${clickable ? ` role="button" tabindex="0" data-value="${escapeHtml(b.label)}"` : ''} title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">`
          + `<span class="gantt-label">${escapeHtml(label)}</span>`
          + `<span class="gantt-track"><span class="gantt-bar" style="left:${pctOf(b.left)}%;width:${pctOf(b.width)}%;background:${colorOf(b.status)}"></span></span></div>`;
      }).join('');
      const todayHtml = layout.today === null ? '' : `<span class="gantt-today" style="--t:${Math.round(layout.today * 10000) / 10000}" title="${escapeHtml(t('chart.gantt.today'))}"></span>`;
      const chips = tile.seriesColumn ? layout.statuses.map((st) => {
        const on = statusFilter && st !== '' && filterSelects(statusFilter, st);
        const off = statusFilter && st !== '' && !filterSelects(statusFilter, st);
        return `<button type="button" class="gantt-chip${on ? ' gantt-chip-on' : ''}${off ? ' gantt-chip-off' : ''}"${st === '' ? ' disabled' : ` data-status="${escapeHtml(st)}"`}>`
          + `<span class="gantt-chip-swatch" style="background:${colorOf(st)}"></span>${escapeHtml(st === '' ? t('chart.series.empty') : st)}</button>`;
      }).join('') : '';
      const today = layout.today === null ? '' : `<span class="gantt-chip-today"><span class="gantt-today-swatch"></span>${escapeHtml(t('chart.gantt.today'))}</span>`;
      const notes = [];
      if (layout.hidden > 0) notes.push(t('chart.gantt.hidden', { shown: String(layout.tasks.length), total: String(layout.total), hidden: String(layout.hidden) }));
      if (layout.ignored > 0) notes.push(t('chart.gantt.ignored', { n: String(layout.ignored) }));
      html = `<div class="gantt"><div class="gantt-axis"><span class="gantt-year">${escapeHtml(yearText)}</span><div class="gantt-ticks">${ticksHtml}</div></div>`
        + `<div class="gantt-body"><div class="gantt-lines">${linesHtml}</div>${rowsHtml}${todayHtml}</div>`
        + (notes.length ? `<p class="gantt-note">${escapeHtml(notes.join(' '))}</p>` : '')
        + (chips || today ? `<div class="gantt-foot">${chips}${today}</div>` : '')
        + '</div>';
    }
    if (el.dataset.html !== html) {
      const scroll = el.scrollTop;
      GristBI.safeHtml.setHtml(el, html);
      el.dataset.html = html;
      el.scrollTop = scroll;
    }
    if (el.dataset.bound !== '1') {
      el.dataset.bound = '1';
      const pick = (target) => {
        const live = liveTile(tile.id);
        if (!live || !target.closest) return;
        const chip = target.closest('.gantt-chip');
        if (chip && el.contains(chip) && chip.dataset.status !== undefined && live.seriesColumn) { GristBI.store.toggleFilter(live.seriesColumn, chip.dataset.status, live.id); return; }
        const row = target.closest('.gantt-row');
        if (row && el.contains(row) && row.dataset.value !== undefined) GristBI.store.toggleFilter(live.dimension, row.dataset.value, live.id);
      };
      el.addEventListener('click', (e) => pick(e.target));
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!(e.target.classList && e.target.classList.contains('gantt-row'))) return;
        e.preventDefault();
        pick(e.target);
      });
    }
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
      trackLoading(instance);
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
    const gaugeFmt = fmtFor(tile, tile.measure);
    const min = Number.isFinite(tile.gaugeMin) ? tile.gaugeMin : 0;
    // Sans borne haute (tuile importée) : un « beau » nombre au-dessus de la valeur, pas 1,5 x la valeur (« 4 118 723 »).
    const shown = Number.isFinite(Number(value)) ? Number(value) : 0;
    const max = Number.isFinite(tile.gaugeMax) ? tile.gaugeMax : GristBI.format.niceCeil(Math.max(shown * 1.2, 1));
    // La jauge se redessine à la taille de SA zone (demi-cercle, voir GristBI.format.gaugeLayout) : à chaque rendu
    // et à chaque redimensionnement (resizeAll appelle `__refit`, ECharts ne sait pas refaire une géométrie en px).
    const draw = () => instance.setOption(gaugeOption(tile, { value: shown, hasValue: value != null, min, max, fmt: gaugeFmt, w: instance.getWidth(), h: instance.getHeight() }), true);
    draw();
    instance.__refit = draw;
  }

  // Option ECharts d'une jauge en demi-cercle. Éléments : arc de fond + arc de progression arrondi, aiguille fine
  // (elle ne dépasse pas 74 % du rayon, donc jamais sur l'anneau) et moyeu, bornes min/max en `graphic` sous les
  // extrémités de l'arc, valeur sous le moyeu, police réduite jusqu'à ce qu'elle tienne, sinon compacte (« 5,43 Bn »
  // plutôt qu'un nombre coupé). Graduations intermédiaires : À L'EXTÉRIEUR de l'arc (un trait, puis le libellé),
  // jamais dedans — dans l'arc elles se chevauchaient entre elles et avec l'aiguille (« 825,5 k » sur « 1,7 M ») ; leur
  // place est réservée avant de dimensionner l'arc (`GristBI.format.gaugeLayout(w, h, ticks)`), qui rétrécit un peu,
  // et elles disparaissent d'abord (moins, puis aucune) plutôt que de faire trop rétrécir l'arc ou de sortir de la tuile.
  function gaugeOption(tile, g) {
    const th = chartTheme();
    const F = GristBI.format;
    const family = th.font;
    // Libellés de l'échelle entière : une échelle d'entiers de moins de 5 chiffres (des années, une colonne entière) n'est
    // jamais compactée (« 1990, 2000 », pas « 1,99 k, 2 k ») — voir GristBI.format.plainScale.
    const scale = g.fmt.forScale(g.min, g.max);
    const bound = scale.axis;
    // Graduations : le plus grand nombre que la place permet, des valeurs rondes (1 M, 2 M, 3 M).
    const base = F.gaugeLayout(g.w, g.h);
    let L = base;
    let ticks = [];
    for (let n = F.gaugeTickBudget(base.r); n >= 1 && !ticks.length; n--) {
      const items = F.gaugeTicks(g.min, g.max, n).map((v) => ({ text: bound(v), frac: (v - g.min) / (g.max - g.min) }));
      if (!items.length) continue;
      const lay = F.gaugeLayout(g.w, g.h, items.map((it) => ({ frac: it.frac, w10: measureText(it.text, 10, 400, family) })));
      if (!lay.overflow && lay.r >= Math.max(44, 0.72 * base.r)) {
        L = lay;
        ticks = items;
      }
    }
    let text = g.hasValue ? (scale.format(g.value) || '–') : '–';
    let fs = F.fitFont(text, L.valueMaxWidth, L.valueMaxFont, L.valueMinFont, (s, px) => measureText(s, px, 700, family));
    if (fs <= L.valueMinFont && measureText(text, fs, 700, family) > L.valueMaxWidth) {
      text = g.fmt.axis(g.value) || text;
      fs = F.fitFont(text, L.valueMaxWidth, L.valueMaxFont, L.valueMinFont, (s, px) => measureText(s, px, 700, family));
    }
    const endX = L.r - L.ringW / 2;
    const labelY = L.ringW / 2 + 4; // sous le bout arrondi de l'arc, qui dépasse de la moitié de son épaisseur
    const labelStyle = { fill: th.muted, font: `${L.labelFont}px ${family}`, textAlign: 'center', textVerticalAlign: 'top' };
    const tickElements = [];
    for (const it of ticks) {
      const P = F.gaugeTickPlacement(L, it.frac);
      tickElements.push({ type: 'line', silent: true, shape: { x1: P.x1, y1: P.y1, x2: P.x2, y2: P.y2 }, style: { stroke: th.muted, lineWidth: 1 } });
      tickElements.push({ type: 'text', silent: true, x: P.x, y: P.y, style: { text: it.text, fill: th.muted, font: `${L.tick.font}px ${family}`, textAlign: P.align, textVerticalAlign: P.valign } });
    }
    return {
      series: [{
        type: 'gauge',
        min: g.min,
        max: g.max,
        startAngle: 180,
        endAngle: 0,
        center: [L.cx, L.cy],
        radius: L.r,
        itemStyle: { color: paletteColors(tile.palette)[0] },
        progress: { show: true, width: L.ringW, roundCap: true },
        axisLine: { roundCap: true, lineStyle: { width: L.ringW, color: [[1, th.track]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: true, length: '74%', width: clamp(L.r * 0.04, 3, 8), itemStyle: { color: th.text } },
        anchor: { show: true, showAbove: true, size: clamp(L.r * 0.09, 7, 16), itemStyle: { color: th.text } },
        title: { show: false },
        detail: {
          valueAnimation: false,
          formatter: () => text,
          fontSize: fs,
          fontWeight: 700,
          fontFamily: family,
          color: th.text,
          offsetCenter: [0, 12 + fs * 0.62]
        },
        data: [{ value: g.value }]
      }],
      graphic: {
        elements: [
          { type: 'text', silent: true, x: L.cx - endX, y: L.cy + labelY, style: Object.assign({ text: bound(g.min) }, labelStyle) },
          { type: 'text', silent: true, x: L.cx + endX, y: L.cy + labelY, style: Object.assign({ text: bound(g.max) }, labelStyle) }
        ].concat(tickElements)
      }
    };
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
      GristBI.safeHtml.setHtml(el, '<p class="pivot-empty">Aucune donnée à afficher.</p>');
      return;
    }
    const rowFilter = state.activeFilters.find((f) => f.column === tile.dimension);
    const colFilter = state.activeFilters.find((f) => f.column === tile.columnDimension);
    const pivotFmt = fmtFor(tile, tile.measure);
    const fmt = (v) => (v == null ? '–' : escapeHtml(String(pivotFmt.format(v))));

    const headCells = pivot.colKeys.map((ck) => {
      const active = colFilter && filterSelects(colFilter, ck);
      const dimmed = colFilter && !active;
      const cls = `pivot-col-header${active ? ' pivot-active' : ''}${dimmed ? ' pivot-dimmed' : ''}`;
      return `<th class="${cls}" data-axis="col" data-value="${escapeHtml(String(ck))}">${escapeHtml(String(ck))}</th>`;
    }).join('');

    // Tableau croisé coloré (`tile.pivotHeat`) : fond de chaque cellule de données d'un dégradé séquentiel (js/data.js:heatCellColors),
    // texte blanc ou noir selon le contraste ; le nombre reste écrit, la couleur n'est jamais seule. Totaux jamais colorés
    // (une somme de ligne écraserait l'échelle des cellules). Couleurs CALCULÉES (hex), jamais une chaîne de la configuration.
    const heat = tile.pivotHeat ? heatCellColors(pivot.cells, heatStops(tile.palette)) : null;
    const heatStyle = (ri, ci) => {
      const heatCell = heat && heat[ri] && heat[ri][ci];
      return heatCell ? ` style="background:${heatCell.bg};color:${heatCell.fg}"` : '';
    };
    const bodyRows = pivot.rowKeys.map((rk, ri) => {
      const rowActive = rowFilter && filterSelects(rowFilter, rk);
      const rowDimmed = rowFilter && !rowActive;
      const rowHeaderCls = `pivot-row-header${rowActive ? ' pivot-active' : ''}${rowDimmed ? ' pivot-dimmed' : ''}`;
      const cells = pivot.cells[ri].map((v, ci) => {
        const ck = pivot.colKeys[ci];
        const colActive = colFilter && filterSelects(colFilter, ck);
        const colDimmed = colFilter && !colActive;
        const cellActive = rowActive && colActive;
        const cellDimmed = !cellActive && (rowDimmed || colDimmed);
        const cls = `pivot-cell${cellActive ? ' pivot-active' : ''}${cellDimmed ? ' pivot-dimmed' : ''}${v == null ? ' pivot-cell-empty' : ''}`;
        return `<td class="${cls}" data-axis="cell" data-row="${escapeHtml(String(rk))}" data-col="${escapeHtml(String(ck))}"${heatStyle(ri, ci)}>${fmt(v)}</td>`;
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

    GristBI.safeHtml.setHtml(el, `<table class="pivot-table${heat ? ' pivot-heat' : ''}">
      <thead><tr><th class="pivot-corner"></th>${headCells}<th class="pivot-col-header pivot-total-label">${totalLabel}</th></tr></thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>`);

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

  Object.assign(parts, { renderGantt, renderGauge, renderKpi, renderPivot, renderProgress, renderTable, renderText, tableSort });
})(window);
