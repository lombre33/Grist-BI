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
      shown.suggestions.forEach((s, i) => cfg.addTile(s.tileData, i));
    });
    byId('welcome-cards').addEventListener('click', (evt) => {
      const btn = evt.target.closest('button[data-suggestion]');
      if (btn) cfg.addTile(shown.suggestions[Number(btn.dataset.suggestion)].tileData, 0);
    });
  }

  function cardHtml(s, i, rows, lang) {
    const t = G.i18n.t;
    const title = t(s.titleKey, s.titleVars);
    return `<li class="welcome-card">
      <div class="welcome-preview">${previewSvg(G.advice.previewFor(s.tileData, rows), { lang })}</div>
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
    const suggestions = G.advice.suggestTiles(state.rows, undefined, { t: G.i18n.t });
    shown = { rows: state.rows, lang, suggestions };
    G.safeHtml.setHtml(document.getElementById('welcome-cards'), suggestions.map((s, i) => cardHtml(s, i, state.rows, lang)).join(''));
    const addAll = document.getElementById('welcome-add-all');
    addAll.hidden = suggestions.length < 2;
    addAll.textContent = G.i18n.t('welcome.addAll', { n: suggestions.length });
    document.getElementById('welcome-suggestions-body').hidden = suggestions.length === 0;
  }

  return { previewSvg, init, update };
});
