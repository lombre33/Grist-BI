/*
 * Import d'un CSV exporté depuis Power BI (clic droit sur un visuel → "Exporter les données", ou
 * "Analyser dans Excel" → enregistrer en CSV) : fonctions pures, testables sous Node (voir
 * dev-tests/test-data.js), aucune dépendance au DOM ni à l'API Grist — même convention que
 * js/pbix-layout.js. Complète l'import Power BI existant : celui-ci ne couvre QUE la mise en page
 * (js/pbix-layout.js, voir son en-tête) puisque le format de données natif de Power BI (VertiPaq)
 * est propriétaire et non documenté (voir CLAUDE.md, étude de faisabilité du 2026-11-03) ; le CSV
 * exporté depuis Power BI lui-même est, en revanche, un format ouvert et trivial à lire sans la
 * moindre nouvelle dépendance.
 *
 * Point d'entrée : parseCsvFile(text) -> { columns, rows, rowCount }, où `columns` est prêt à
 * passer directement à GristBI.api.createTableFromRows (js/grist-api.js) comme spec `AddTable`, et
 * `rows` au `fillTable` qui s'ensuit.
 *
 * [Piège locale, pas une fixture jamais vue en réel] Power BI Desktop exporte un CSV dans la LOCALE
 * de son utilisateur, jamais figée. En français (le cas d'Antoine, voir CLAUDE.md), le séparateur
 * décimal des nombres est la virgule — qui ne peut donc plus servir de séparateur de champ, d'où
 * un fichier français qui utilise ';' alors qu'un fichier anglophone utilise ','.
 * `detectDelimiter`/`parseLocaleNumber` gèrent explicitement les deux conventions plutôt que de
 * n'en supposer qu'une — un fichier mal interprété sous l'autre convention donnerait des nombres
 * silencieusement faux (1 234,56 lu comme 1 et 234,56 par exemple), pas une erreur visible.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.csvImport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CANDIDATE_DELIMITERS = [',', ';', '\t'];

  // Compte les occurrences d'un délimiteur HORS zone entre guillemets, sur chaque ligne non vide
  // (une virgule dans un champ texte guillemeté — ex. "Dupont, Jean" — ne doit jamais compter).
  // Suppose une ligne par `\n` pour ce seul comptage préliminaire : approximatif en présence d'un
  // champ guillemeté contenant lui-même un retour à la ligne, mais suffisant ici puisqu'on ne
  // cherche que le délimiteur le plus fréquent, pas un parsing exact (parseCsv, plus bas, s'en
  // charge correctement).
  function countDelimiterOutsideQuotes(line, delimiter) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === delimiter) count++;
    }
    return count;
  }

  // Choisit, parmi ',' ';' et tabulation, celui dont le nombre d'occurrences par ligne est à la
  // fois le plus élevé ET constant sur les premières lignes non vides (un vrai délimiteur de champ
  // apparaît le même nombre de fois sur chaque ligne d'un CSV rectangulaire ; un caractère présent
  // par hasard dans le texte, lui, varie). Repli sur ',' si aucun délimiteur candidat n'apparaît
  // de façon constante (ex. un fichier à une seule colonne) — le cas le plus neutre.
  function detectDelimiter(text) {
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length).slice(0, 10);
    if (!lines.length) return ',';
    let best = ',';
    let bestScore = -1;
    for (const delimiter of CANDIDATE_DELIMITERS) {
      const counts = lines.map((l) => countDelimiterOutsideQuotes(l, delimiter));
      const first = counts[0];
      if (first === 0) continue;
      const constant = counts.every((c) => c === first);
      const score = constant ? first : -1;
      if (score > bestScore) { bestScore = score; best = delimiter; }
    }
    return best;
  }

  // Parseur CSV complet par automate à états (pas une simple coupe sur le délimiteur, insuffisante
  // dès qu'un champ est guillemeté) : gère les champs entre guillemets contenant le délimiteur, un
  // retour à la ligne (CRLF ou LF), ou un guillemet doublé (`""` -> `"` littéral, convention RFC
  // 4180 reprise par Excel/Power BI). Retire aussi un BOM UTF-8 éventuel en tête de fichier (ajouté
  // systématiquement par Excel/Power BI à l'export). Renvoie { headers: string[], rows: string[][] }
  // — valeurs encore brutes (chaînes) : inferColumnType/coerceValue plus bas décident du type Grist
  // et convertissent.
  function parseCsv(text, delimiter) {
    const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = clean.length;
    while (i < n) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; } // avalé ici, le \n qui suit (ou non) ferme la ligne
      if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
        i++; continue;
      }
      field += ch; i++;
    }
    // Dernier champ/ligne sans retour à la ligne final (fichier qui ne se termine pas par \n).
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Ignore les lignes totalement vides (ex. une ligne finale vide issue d'un \n de fin de
    // fichier déjà consommé ci-dessus, ou une ligne blanche décorative dans l'export) — jamais une
    // ligne avec au moins une valeur non vide, même si les autres colonnes sont vides.
    const nonEmptyRows = rows.filter((r) => r.some((v) => v !== ''));
    if (!nonEmptyRows.length) return { headers: [], rows: [] };
    const [headers, ...dataRows] = nonEmptyRows;
    return { headers, rows: dataRows };
  }

  // Transforme un en-tête de colonne CSV (accents, espaces, ponctuation — jamais garanti valide
  // côté Grist) en identifiant de colonne Grist valide : lettre/underscore en tête, puis
  // lettres/chiffres/underscores uniquement (mêmes règles qu'un identifiant Python, Grist étant
  // construit dessus). `usedIds` déduplique (deux en-têtes qui se réduisent au même identifiant,
  // ex. "Montant €" et "Montant $") en suffixant _2/_3/... — jamais un doublon silencieux qui
  // écraserait une colonne sur l'autre.
  function sanitizeColumnId(header, usedIds) {
    let id = String(header || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents -> lettre nue
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!id) id = 'colonne';
    if (/^[0-9]/.test(id)) id = 'c_' + id;
    let candidate = id;
    let suffix = 2;
    while (usedIds.has(candidate)) { candidate = id + '_' + suffix; suffix++; }
    usedIds.add(candidate);
    return candidate;
  }

  // Nombre français/européen ("1 234,56", espace ou point en séparateur de milliers, virgule en
  // séparateur décimal) OU anglo-saxon ("1,234.56", virgule en séparateur de milliers, point en
  // séparateur décimal) — jamais les deux conventions mélangées dans un même fichier (locale unique
  // d'export Power BI, voir l'en-tête de ce fichier). Renvoie `null` (jamais 0) si `raw` ne
  // correspond à aucune des deux formes : une valeur non numérique ne doit jamais devenir
  // silencieusement un zéro, qui fausserait toute agrégation ultérieure sans qu'aucune erreur ne
  // soit visible.
  function parseLocaleNumber(raw) {
    const s = String(raw).trim();
    if (!s) return null;
    // Virgule décimale (style FR) : au plus UNE virgule, et si elle est suivie d'un point, le
    // point est forcément un séparateur de milliers (donc après la virgule, impossible en FR) ->
    // distingue en exigeant qu'aucun point ne suive la dernière virgule.
    if (/^-?[0-9][0-9 .]*,[0-9]+$/.test(s)) {
      const n = Number(s.replace(/[ .]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    // Point décimal (style EN), virgule optionnelle en séparateur de milliers.
    if (/^-?[0-9][0-9,]*(\.[0-9]+)?$/.test(s) && !/,,/.test(s)) {
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    // Entier/décimal simple sans séparateur de milliers (couvre aussi le cas où les deux regex
    // ci-dessus échouent sur un nombre négatif à décimale pure, ex. "-3.5" déjà couvert, ou "3").
    const simple = Number(s);
    return Number.isFinite(simple) && /^-?[0-9]+(\.[0-9]+)?$/.test(s) ? simple : null;
  }

  // Date ISO ('AAAA-MM-JJ'), ou date française/jour-mois-année ('JJ/MM/AAAA' ou 'JJ-MM-AAAA',
  // export le plus courant d'un Power BI en locale FR) -> toujours renvoyée en 'AAAA-MM-JJ' (même
  // convention d'écriture que le reste de ce widget pour une colonne Grist de type Date, voir
  // CLAUDE.md piège n°16 et js/demo-data.js:deriveDateColumn). `null` si `raw` ne correspond à
  // aucun des deux formats ou désigne une date invalide (ex. 31/02).
  function parseLocaleDate(raw) {
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return isValidYmd(m[1], m[2], m[3]) ? s : null;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      return isValidYmd(y, mo, d) ? `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
    }
    return null;
  }

  function isValidYmd(y, mo, d) {
    const year = Number(y), month = Number(mo), day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  // Décide le type Grist d'une colonne à partir de TOUTES ses valeurs non vides (une seule valeur
  // qui ne correspond pas au type candidat retombe sur Text, le choix le plus sûr — jamais de
  // coercition partielle qui perdrait silencieusement des valeurs). Numeric est testé avant Date
  // (une valeur comme "2024" est un nombre ET pourrait ressembler à une année, mais jamais à une
  // date complète JJ/MM/AAAA ou AAAA-MM-JJ, donc aucune ambiguïté réelle entre les deux regex).
  // Colonne entièrement vide (aucune valeur non vide) -> Text, repli le plus neutre.
  function inferColumnType(values) {
    const nonEmpty = values.filter((v) => v !== '' && v != null);
    if (!nonEmpty.length) return 'Text';
    if (nonEmpty.every((v) => parseLocaleNumber(v) !== null)) return 'Numeric';
    if (nonEmpty.every((v) => parseLocaleDate(v) !== null)) return 'Date';
    return 'Text';
  }

  // Convertit une valeur brute (chaîne) vers la forme attendue par AddRecord pour le type Grist
  // décidé par inferColumnType : nombre JS pour Numeric, chaîne 'AAAA-MM-JJ' pour Date (jamais un
  // nombre de secondes depuis l'epoch — voir CLAUDE.md piège n°16, c'est la convention d'ÉCRITURE
  // de ce widget, fetchTable renverrait lui des secondes à la RELECTURE), chaîne brute pour Text.
  // Une valeur vide devient `null` pour Numeric/Date (jamais 0 ni une chaîne vide qui serait un
  // 1/1/1970 ou un zéro silencieux), chaîne vide pour Text.
  function coerceValue(raw, type) {
    const s = raw == null ? '' : String(raw).trim();
    if (type === 'Numeric') return s === '' ? null : parseLocaleNumber(s);
    if (type === 'Date') return s === '' ? null : parseLocaleDate(s);
    return s;
  }

  // Point d'entrée unique : du texte brut d'un fichier CSV à une structure prête pour
  // GristBI.api.createTableFromRows (js/grist-api.js) — colonnes au format `AddTable` ({id, type,
  // label}) et lignes déjà typées/converties, dans le même ordre que `columns`.
  function parseCsvFile(text) {
    const delimiter = detectDelimiter(text);
    const { headers, rows: rawRows } = parseCsv(text, delimiter);
    const usedIds = new Set();
    const ids = headers.map((h) => sanitizeColumnId(h, usedIds));
    const types = ids.map((_, colIndex) => inferColumnType(rawRows.map((r) => r[colIndex])));
    const columns = ids.map((id, i) => ({ id, type: types[i], label: headers[i] || id }));
    const rows = rawRows.map((r) => {
      const obj = {};
      ids.forEach((id, i) => { obj[id] = coerceValue(r[i], types[i]); });
      return obj;
    });
    return { columns, rows, rowCount: rows.length };
  }

  return {
    detectDelimiter, parseCsv, sanitizeColumnId, parseLocaleNumber, parseLocaleDate,
    inferColumnType, coerceValue, parseCsvFile,
  };
});
