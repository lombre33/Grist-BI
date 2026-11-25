/*
 * Écran d'accueil d'un tableau de bord sans tuile : trois cartes de suggestion (miniature, titre,
 * une ligne de raison, bouton « Ajouter »), « Créer une visualisation » et « Importer Power BI ».
 * Se pose dans `#welcome` (index.html), visible seulement en mode Édition (classe `edit-only`).
 *
 * Deux parties : `previewSvg` est PURE (miniature SVG à partir de js/advice.js:previewFor, testée
 * sous Node, dev-tests/test-data.js) ; `init`/`update` sont la glue DOM, jamais testées sous Node
 * (voir TEST_PROTOCOL.md : vérifiées contre le vrai index.html + dev-tests/grist-stub.js).
 *
 * Toute la décision (quoi proposer, pourquoi) vient de js/advice.js, qui ne renvoie que des clés
 * i18n : ce fichier ne contient que des clés `welcome.*` et ce que ces clés traduisent.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(null);
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.welcome = factory(root.GristBI);
  }
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  // Même ordre que js/charts.js:CATEGORICAL_PALETTE (palette colorblind-safe du tableau de bord) : la
  // miniature promet les couleurs que la tuile aura, et une ambiance GFS ne recolore jamais un
  // graphique (CLAUDE.md §8).
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const W = 120;
  const H = 64;
  const PAD = 8;

  const round2 = (n) => Math.round(n * 100) / 100;

  function arcPoint(cx, cy, r, angle) {
    return [round2(cx + r * Math.sin(angle)), round2(cy - r * Math.cos(angle))];
  }

  function pieShapes(values, donut) {
    const cx = W / 2;
    const cy = H / 2;
    const r = (H - 2 * PAD) / 2;
    if (values.length === 1) {
      return donut
        ? `<circle cx="${cx}" cy="${cy}" r="${round2(r - 6)}" fill="none" stroke="${PALETTE[0]}" stroke-width="12"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[0]}"/>`;
    }
    let from = 0;
    return values.map((share, i) => {
      const to = from + share * 2 * Math.PI;
      const large = to - from > Math.PI ? 1 : 0;
      const color = PALETTE[i % PALETTE.length];
      let shape;
      if (donut) {
        const [x1, y1] = arcPoint(cx, cy, r - 6, from);
        const [x2, y2] = arcPoint(cx, cy, r - 6, to);
        shape = `<path d="M${x1} ${y1} A${r - 6} ${r - 6} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="12"/>`;
      } else {
        const [x1, y1] = arcPoint(cx, cy, r, from);
        const [x2, y2] = arcPoint(cx, cy, r, to);
        shape = `<path d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}" stroke="var(--surface-sunken)" stroke-width="1"/>`;
      }
      from = to;
      return shape;
    }).join('');
  }

  // Entonnoir : une bande par étape, centrée, de largeur proportionnelle à sa valeur.
  function funnelShapes(values) {
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const bh = innerH / values.length;
    return values.map((v, i) => {
      const w = Math.max(4, v * innerW);
      return `<rect x="${round2((W - w) / 2)}" y="${round2(PAD + i * bh + 1)}" width="${round2(w)}" height="${round2(bh - 2)}" rx="1.5" fill="${PALETTE[i % PALETTE.length]}"/>`;
    }).join('');
  }

  // Treemap en tranches : la plus grande part occupe la moitié gauche, les autres s'empilent à droite.
  function treemapShapes(values) {
    const left = values[0];
    const rest = values.slice(1);
    const total = rest.reduce((a, b) => a + b, 0);
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const leftW = rest.length ? innerW * Math.max(0.3, Math.min(0.6, left / (left + total))) : innerW;
    let out = `<rect x="${PAD}" y="${PAD}" width="${round2(leftW - 1)}" height="${innerH}" fill="${PALETTE[0]}" rx="1.5"/>`;
    let y = PAD;
    rest.forEach((v, i) => {
      const h = innerH * (v / total);
      out += `<rect x="${round2(PAD + leftW + 1)}" y="${round2(y)}" width="${round2(innerW - leftW - 1)}" height="${round2(Math.max(1, h - 1))}" fill="${PALETTE[(i + 1) % PALETTE.length]}" rx="1.5"/>`;
      y += h;
    });
    return out;
  }

  function radarShapes(values) {
    const cx = W / 2;
    const cy = H / 2;
    const r = (H - 2 * PAD) / 2;
    const n = values.length;
    const at = (k, scale) => arcPoint(cx, cy, r * scale, (2 * Math.PI * k) / n).join(',');
    const ring = (scale) => Array.from({ length: n }, (_, k) => at(k, scale)).join(' ');
    return `<polygon points="${ring(1)}" fill="none" stroke="var(--border-strong)" stroke-width="1"/>`
      + `<polygon points="${ring(0.5)}" fill="none" stroke="var(--border-strong)" stroke-width="1"/>`
      + `<polygon points="${values.map((v, k) => at(k, Math.max(0.08, v))).join(' ')}" fill="${PALETTE[0]}" fill-opacity="0.25" stroke="${PALETTE[0]}" stroke-width="2" stroke-linejoin="round"/>`;
  }

  // Barres (la plus grande = pleine hauteur) et courbe par-dessus : un Pareto (part cumulée) ou deux mesures. Valeurs de 0 à 1.
  function barLineShapes(bars, line) {
    const n = bars.length;
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const bw = innerW / n;
    const rects = bars.map((v, i) => {
      const h = Math.max(2, v * innerH);
      return `<rect x="${round2(PAD + i * bw + bw * 0.15)}" y="${round2(H - PAD - h)}" width="${round2(bw * 0.7)}" height="${round2(h)}" rx="1.5" fill="${PALETTE[0]}"/>`;
    }).join('');
    const pts = line.map((v, i) => `${round2(PAD + i * bw + bw / 2)},${round2(H - PAD - v * innerH)}`);
    return rects
      + `<polyline points="${pts.join(' ')}" fill="none" stroke="${PALETTE[1]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      + pts.map((pt) => `<circle cx="${pt.split(',')[0]}" cy="${pt.split(',')[1]}" r="2" fill="${PALETTE[1]}"/>`).join('');
  }

  // Histogramme : des barres collées, une par classe.
  function histogramShapes(values) {
    const n = values.length;
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const bw = innerW / n;
    return values.map((v, i) => {
      const h = Math.max(1, v * innerH);
      return `<rect x="${round2(PAD + i * bw)}" y="${round2(H - PAD - h)}" width="${round2(Math.max(1, bw - 1))}" height="${round2(h)}" fill="${PALETTE[0]}"/>`;
    }).join('');
  }

  // Boîtes à moustaches verticales : moustache (bas-haut), boîte (Q1-Q3), médiane. Valeurs de 0 (bas) à 1 (haut).
  function boxShapes(boxes) {
    const n = boxes.length;
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const slot = innerW / n;
    const y = (v) => round2(H - PAD - v * innerH);
    return boxes.map((b, i) => {
      const cx = round2(PAD + i * slot + slot / 2);
      const bw = round2(Math.min(18, slot * 0.6));
      const x = round2(cx - bw / 2);
      return `<line x1="${cx}" y1="${y(b.low)}" x2="${cx}" y2="${y(b.high)}" stroke="${PALETTE[0]}" stroke-width="1.5"/>`
        + `<rect x="${x}" y="${y(b.q3)}" width="${bw}" height="${round2(Math.max(1.5, y(b.q1) - y(b.q3)))}" rx="1.5" fill="${PALETTE[0]}" fill-opacity="0.35" stroke="${PALETTE[0]}" stroke-width="1.5"/>`
        + `<line x1="${x}" y1="${y(b.median)}" x2="${round2(x + bw)}" y2="${y(b.median)}" stroke="${PALETTE[0]}" stroke-width="2"/>`;
    }).join('');
  }

  // Cascade : chaque marche flotte entre `from` et `to` (0 = bas, 1 = haut) ; hausse en vert, baisse en rouge (les couleurs de la tuile).
  function waterfallShapes(steps) {
    const n = steps.length;
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const bw = innerW / n;
    return steps.map((st, i) => {
      const top = H - PAD - Math.max(st.from, st.to) * innerH;
      const h = Math.max(1.5, Math.abs(st.to - st.from) * innerH);
      return `<rect x="${round2(PAD + i * bw + bw * 0.12)}" y="${round2(top)}" width="${round2(bw * 0.76)}" height="${round2(h)}" rx="1" fill="${st.to >= st.from ? PALETTE[2] : PALETTE[7]}"/>`;
    }).join('');
  }

  // Calendrier : une colonne par semaine, sept cases (du lundi au dimanche) ; plus la case est foncée, plus la valeur est haute (0 à 1) ; un jour
  // sans ligne (null) garde la trame neutre.
  function calendarShapes(weeks) {
    const n = weeks.length;
    const cw = (W - 2 * PAD) / n;
    const ch = (H - 2 * PAD) / 7;
    return weeks.map((week, w) => week.map((v, d) => {
      const fill = v === null ? 'var(--border-strong)' : PALETTE[0];
      const opacity = v === null ? 0.2 : round2(0.12 + 0.88 * v);
      return `<rect x="${round2(PAD + w * cw + 0.5)}" y="${round2(PAD + d * ch + 0.5)}" width="${round2(cw - 1)}" height="${round2(ch - 1)}" rx="1" fill="${fill}" fill-opacity="${opacity}"/>`;
    }).join('')).join('');
  }

  // Planning : une barre par tâche, de `left` à `left + width` (0 à 1 de l'étendue), les tâches l'une sous l'autre.
  function ganttShapes(bars) {
    const n = bars.length;
    const innerW = W - 2 * PAD;
    const bh = (H - 2 * PAD) / n;
    return bars.map((b, i) => `<rect x="${round2(PAD + b.left * innerW)}" y="${round2(PAD + i * bh + bh * 0.18)}" width="${round2(Math.max(2, Math.min(b.width, 1 - b.left) * innerW))}" height="${round2(bh * 0.64)}" rx="1.5" fill="${PALETTE[i % 2 ? 1 : 0]}"/>`).join('');
  }

  // Carte de chaleur : une grille de cases dont l'opacité suit la valeur (0 à 1) ; une intersection sans donnée (null) reste vide.
  function heatShapes(rowsOfValues) {
    const rowsN = rowsOfValues.length;
    const cols = rowsOfValues[0].length;
    const cw = (W - 2 * PAD) / cols;
    const rh = (H - 2 * PAD) / rowsN;
    return rowsOfValues.map((line, r) => line.map((v, c) => {
      const fill = v === null ? 'var(--border-strong)' : PALETTE[0];
      const opacity = v === null ? 0.15 : round2(0.1 + 0.9 * v);
      return `<rect x="${round2(PAD + c * cw + 0.5)}" y="${round2(PAD + r * rh + 0.5)}" width="${round2(cw - 1)}" height="${round2(rh - 1)}" rx="1" fill="${fill}" fill-opacity="${opacity}"/>`;
    }).join('')).join('');
  }

  // Un arc d'anneau (de `from` à `to`, en tours de 0 à 1) tracé au rayon `r`, d'épaisseur `width`.
  function ringArc(cx, cy, r, width, from, to, color, opacity) {
    const a = from * 2 * Math.PI;
    const b = Math.min(to, from + 0.9999) * 2 * Math.PI;
    const [x1, y1] = arcPoint(cx, cy, r, a);
    const [x2, y2] = arcPoint(cx, cy, r, b);
    return `<path d="M${x1} ${y1} A${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}"/>`;
  }

  // Soleil : le centre en parts pleines, l'anneau extérieur en sous-parts (même teinte, plus claires), toutes en part du total.
  function ringsShapes(parents) {
    const cx = W / 2;
    const cy = H / 2;
    let from = 0;
    return parents.map((p, i) => {
      const color = PALETTE[i % PALETTE.length];
      let inner = ringArc(cx, cy, 13, 12, from, from + p.share, color, 1);
      let start = from;
      p.children.forEach((c) => {
        inner += ringArc(cx, cy, 25, 11, start, start + c, color, 0.55);
        start += c;
      });
      from += p.share;
      return inner;
    }).join('');
  }

  // Progression : une piste par catégorie, remplie à la part de l'objectif atteinte, de la couleur d'état (vert, orange, rouge).
  const LEVEL_COLORS = { good: PALETTE[2], warn: PALETTE[3], bad: PALETTE[7] };
  function progressShapes(lines) {
    const n = lines.length;
    const innerW = W - 2 * PAD;
    const bh = (H - 2 * PAD) / n;
    return lines.map((l, i) => {
      const y = round2(PAD + i * bh + bh * 0.22);
      const h = round2(bh * 0.56);
      return `<rect x="${PAD}" y="${y}" width="${innerW}" height="${h}" rx="2" fill="var(--border-strong)" fill-opacity="0.35"/>`
        + `<rect x="${PAD}" y="${y}" width="${round2(Math.max(2, l.fill * innerW))}" height="${h}" rx="2" fill="${LEVEL_COLORS[l.level] || PALETTE[0]}"/>`;
    }).join('');
  }

  // Miniature SVG (chaîne) d'un aperçu de js/advice.js:previewFor ; '' quand il n'y en a pas.
  // `opts.lang` : langue du nombre affiché sur une carte KPI.
  function previewSvg(p, opts) {
    if (!p || !p.kind) return '';
    const lang = (opts && opts.lang) || 'fr';
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    let body = '';
    switch (p.kind) {
      case 'bars': {
        const n = p.values.length;
        if (p.horizontal) {
          const bh = innerH / n;
          body = p.values.map((v, i) => `<rect x="${PAD}" y="${round2(PAD + i * bh + bh * 0.15)}" width="${round2(Math.max(2, v * innerW))}" height="${round2(bh * 0.7)}" rx="1.5" fill="${PALETTE[0]}"/>`).join('');
        } else {
          const bw = innerW / n;
          body = p.values.map((v, i) => {
            const h = Math.max(2, v * innerH);
            return `<rect x="${round2(PAD + i * bw + bw * 0.15)}" y="${round2(H - PAD - h)}" width="${round2(bw * 0.7)}" height="${round2(h)}" rx="1.5" fill="${PALETTE[0]}"/>`;
          }).join('');
        }
        break;
      }
      case 'line': {
        const n = p.values.length;
        const pts = p.values.map((v, i) => `${round2(PAD + (i * innerW) / (n - 1))},${round2(H - PAD - v * innerH)}`);
        if (p.area) body += `<polygon points="${round2(PAD)},${H - PAD} ${pts.join(' ')} ${round2(W - PAD)},${H - PAD}" fill="${PALETTE[0]}" fill-opacity="0.25"/>`;
        body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${PALETTE[0]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        break;
      }
      case 'pie':
        body = pieShapes(p.values, p.donut);
        break;
      case 'treemap':
        body = treemapShapes(p.values);
        break;
      case 'funnel':
        body = funnelShapes(p.values);
        break;
      case 'barline':
        body = barLineShapes(p.bars, p.line);
        break;
      case 'histogram':
        body = histogramShapes(p.values);
        break;
      case 'boxes':
        body = boxShapes(p.boxes);
        break;
      case 'waterfall':
        body = waterfallShapes(p.steps);
        break;
      case 'calendar':
        body = calendarShapes(p.weeks);
        break;
      case 'gantt':
        body = ganttShapes(p.bars);
        break;
      case 'heat':
        body = heatShapes(p.rows);
        break;
      case 'rings':
        body = ringsShapes(p.parents);
        break;
      case 'progress':
        body = progressShapes(p.rows);
        break;
      case 'value': {
        const text = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(p.value);
        body = `<text x="${W / 2}" y="${p.trendPct == null ? 40 : 36}" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor">${text}</text>`;
        if (p.trendPct != null) {
          const up = p.trendPct >= 0;
          const pct = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 }).format(Math.abs(p.trendPct));
          body += `<text x="${W / 2}" y="54" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(${up ? '--good-ink' : '--critical'})">${up ? '▲' : '▼'} ${pct} %</text>`;
        }
        break;
      }
      case 'points':
        body = p.points.map((pt) => `<circle cx="${round2(PAD + pt.x * innerW)}" cy="${round2(H - PAD - pt.y * innerH)}" r="2.6" fill="${PALETTE[0]}" fill-opacity="0.8"/>`).join('');
        break;
      case 'radar':
        body = radarShapes(p.values);
        break;
      case 'gauge': {
        const cx = W / 2;
        const cy = H - PAD;
        const r = 40;
        const end = (ratio) => arcPoint(cx, cy, r, -Math.PI / 2 + ratio * Math.PI).join(' ');
        body = `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--border-strong)" stroke-width="9" stroke-linecap="round"/>`
          + (p.ratio > 0 ? `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${end(p.ratio)}" fill="none" stroke="${PALETTE[0]}" stroke-width="9" stroke-linecap="round"/>` : '');
        break;
      }
      case 'grid': {
        const cols = 4;
        const rowsN = 3;
        const cw = innerW / cols;
        const rh = innerH / rowsN;
        for (let r = 0; r < rowsN; r++) {
          for (let colIndex = 0; colIndex < cols; colIndex++) {
            const header = r === 0 || colIndex === 0;
            body += `<rect x="${round2(PAD + colIndex * cw + 1)}" y="${round2(PAD + r * rh + 1)}" width="${round2(cw - 2)}" height="${round2(rh - 2)}" rx="1.5" fill="${PALETTE[0]}" fill-opacity="${header ? 0.55 : 0.18 + ((r * 3 + colIndex * 5) % 4) * 0.1}"/>`;
          }
        }
        break;
      }
      default:
        return '';
    }
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  }

  // --- Glue DOM (navigateur uniquement) -----------------------------------------------------------

  // Les suggestions montrées d'emblée (« Ajouter ces N » ne porte que sur elles) ; les suivantes se déplient à la demande.
  const FIRST_SUGGESTIONS = 3;
  const MAX_SUGGESTIONS = 9;

  let cfg = null;
  let shown = { rows: null, lang: null, suggestions: [] };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // `options` : { addTile(tileData, index), importPowerBi() } — des rappels,
  // pour que ce fichier ne dépende ni du store ni de la façon dont js/main.js ouvre le formulaire (qui
  // change avec la refonte de l'interface).
  function init(options) {
    cfg = options;
    const byId = (id) => document.getElementById(id);
    byId('welcome-import').addEventListener('click', () => cfg.importPowerBi());
    byId('welcome-add-all').addEventListener('click', () => {
      shown.suggestions.slice(0, FIRST_SUGGESTIONS).forEach((s, i) => cfg.addTile(s.tileData, i));
    });
    byId('welcome-more').addEventListener('click', () => {
      const cards = byId('welcome-cards');
      const expanded = !cards.classList.contains('is-expanded');
      cards.classList.toggle('is-expanded', expanded);
      setMoreLabel(expanded);
    });
    byId('welcome-cards').addEventListener('click', (evt) => {
      const btn = evt.target.closest('button[data-suggestion]');
      if (btn) cfg.addTile(shown.suggestions[Number(btn.dataset.suggestion)].tileData, 0);
    });
  }

  // Le libellé du bouton « Voir d'autres suggestions » / « Moins de suggestions » suit l'état ; `aria-expanded` le dit aux lecteurs d'écran.
  function setMoreLabel(expanded) {
    const more = document.getElementById('welcome-more');
    more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    more.textContent = G.i18n.t(expanded ? 'welcome.less' : 'welcome.more');
  }

  function cardHtml(s, i, rows, lang) {
    const t = G.i18n.t;
    const title = t(s.titleKey, s.titleVars);
    const intent = s.intentKey ? `<span class="welcome-card-intent">${escapeHtml(t(s.intentKey))}</span>` : '';
    return `<li class="welcome-card${i >= FIRST_SUGGESTIONS ? ' welcome-card-extra' : ''}">
      <div class="welcome-preview">${previewSvg(G.advice.previewFor(s.tileData, rows), { lang })}</div>
      ${intent}
      <h3 class="welcome-card-title">${escapeHtml(title)}</h3>
      <p class="welcome-card-reason">${escapeHtml(t(s.reasonKey, s.reasonVars))}</p>
      <button type="button" class="btn-primary" data-suggestion="${i}" aria-label="${escapeHtml(t('welcome.addAria', { title }))}">${escapeHtml(t('welcome.add'))}</button>
    </li>`;
  }

  // Appelé à chaque rendu (js/main.js:render) : ne recalcule que si les lignes ou la langue ont changé
  // depuis la dernière fois — un clic de filtre ailleurs ne doit jamais relancer le profilage de la table.
  function update(state, connected, tableId) {
    const box = document.getElementById('welcome-suggestions');
    if (!box || !cfg) return;
    const empty = connected && state.tiles.length === 0;
    box.hidden = !empty;
    if (!empty) return;
    const lang = G.i18n.getLang();
    const noRows = state.rows.length === 0;
    document.getElementById('welcome-no-rows').hidden = !noRows;
    document.getElementById('welcome-suggestions-body').hidden = noRows;
    document.getElementById('welcome-no-rows').textContent = noRows ? G.i18n.t('welcome.emptyTable', { table: tableId || '' }) : '';
    if (noRows) {
      document.getElementById('welcome-add-all').hidden = true;
      shown = { rows: null, lang: null, suggestions: [] };
      return;
    }
    if (shown.rows === state.rows && shown.lang === lang) return;
    const suggestions = G.advice.suggestTiles(state.rows, undefined, { t: G.i18n.t, lang, limit: MAX_SUGGESTIONS });
    shown = { rows: state.rows, lang, suggestions };
    const cards = document.getElementById('welcome-cards');
    cards.classList.remove('is-expanded');
    G.safeHtml.setHtml(cards, suggestions.map((s, i) => cardHtml(s, i, state.rows, lang)).join(''));
    const first = Math.min(suggestions.length, FIRST_SUGGESTIONS);
    const addAll = document.getElementById('welcome-add-all');
    addAll.hidden = first < 2;
    addAll.textContent = G.i18n.t('welcome.addAll', { n: first });
    document.getElementById('welcome-more').hidden = suggestions.length <= FIRST_SUGGESTIONS;
    setMoreLabel(false);
    document.getElementById('welcome-suggestions-body').hidden = suggestions.length === 0;
  }

  return { previewSvg, init, update };
});
