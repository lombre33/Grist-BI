/*
 * Mots-clés automatiques des publications (chantier « recherche sur publications », demandé par
 * Antoine le 02/11/2026 ; branché sur la consigne GFS 019 du 18/11/2026).
 *
 * Ce fichier est la logique PURE (sans DOM, sans Grist, sans PDF.js, testable sous Node) de la
 * fenêtre « Mots-clés des publications » de js/main.js : quelles lignes traiter, comment lire une
 * cellule « Pièces jointes », comment écrire les mots-clés, et la boucle qui relie les quatre
 * pièces INJECTÉES par l'appelant (téléchargement d'une pièce jointe, lecture du texte d'un PDF,
 * extraction RAKE de js/keywords.js, écriture dans Grist). Rien de ce qui est branché ici n'est
 * importé : `js/main.js` donne `deps`, les tests en donnent de faux — c'est ce qui permet de tester
 * tout le déroulé (annulation, erreurs par ligne, lots d'écriture) sans navigateur ni PDF.
 *
 * Règles qui comptent pour les données de la personne :
 *  - Une cellule de mots-clés DÉJÀ remplie n'est JAMAIS modifiée (`planRows` ne retient que les
 *    lignes dont la cellule cible est vide) : un mot-clé saisi à la main gagne toujours.
 *  - Les mots saisis à la main (colonne « manuelle » facultative) ne sont jamais répétés dans la liste
 *    automatique : l'automatique COMPLÈTE, il ne double pas.
 *  - Une ligne sans texte exploitable (PDF scanné, pièce jointe qui n'est pas un PDF, résumé vide)
 *    n'écrit RIEN : la cellule reste vide, elle sera reprise à la prochaine fois.
 *  - Une erreur sur UNE ligne n'arrête pas les autres ; une erreur d'ÉCRITURE (droits, réseau) arrête
 *    tout, puisqu'elle reviendrait à chaque ligne.
 */
(function (global) {
  const GristBI = global.GristBI || (global.GristBI = {});

  const DEFAULT_MAX_KEYWORDS = 15;
  const MAX_ATTACHMENTS_PER_ROW = 3; // au-delà, les autres pièces jointes de la cellule sont laissées de côté
  const MIN_TEXT_CHARS = 20; // un texte plus court n'a rien à indexer
  const DEFAULT_BATCH_SIZE = 20; // lignes écrites par appel à Grist
  const KEYWORD_SEPARATOR = ', ';

  // Colonnes de Grist qu'on sait lire comme source ou écrire comme cible. Les types ChoiceList et
  // Choice ne servent qu'à LIRE les mots saisis à la main ; on n'écrit que dans une colonne Text.
  const SOURCE_TYPES = { pdf: ['Attachments'], text: ['Text'] };
  const TARGET_TYPES = ['Text'];
  const MANUAL_TYPES = ['Text', 'ChoiceList', 'Choice'];

  // ---------------------------------------------------------------------------------------------
  // Cellules
  // ---------------------------------------------------------------------------------------------

  // Une cellule est vide si elle ne porte aucun texte ni aucune pièce jointe : `null`, `''`, blanc,
  // liste vide (`[]` ou `['L']`, la forme d'une liste vide dans `fetchTable`).
  function isEmptyCell(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.filter((x, i) => !(i === 0 && x === 'L')).length === 0;
    return false;
  }

  // Numéros de pièces jointes d'une cellule. `fetchTable` rend `['L', 12, 13]` ; on accepte aussi une
  // liste nue, un nombre seul et le texte JSON `"[12, 13]"` (une cellule lue par l'API REST). Les
  // doublons et tout ce qui n'est pas un entier positif sont écartés ; l'ordre de la cellule reste.
  function attachmentIds(cell) {
    let list = cell;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) { return []; }
    }
    if (typeof list === 'number') list = [list];
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const ids = [];
    for (const x of list) {
      if (Number.isInteger(x) && x > 0 && !seen.has(x)) { seen.add(x); ids.push(x); }
    }
    return ids;
  }

  // Mots d'une cellule de mots-clés : un texte séparé par virgule, point-virgule ou saut de ligne, ou
  // une liste de choix (`['L', 'a', 'b']`).
  function splitWords(cell) {
    if (cell == null) return [];
    const parts = Array.isArray(cell)
      ? cell.filter((x, i) => !(i === 0 && x === 'L')).map(String)
      : String(cell).split(/[,;\n]+/);
    return parts.map((w) => w.trim()).filter(Boolean);
  }

  function formatKeywords(words) {
    return (words || []).join(KEYWORD_SEPARATOR);
  }

  // Forme de comparaison d'un mot-clé : minuscules, sans accent, espaces réduits. « Réseau neuronal »
  // et « reseau  neuronal » comptent pour le même mot-clé.
  function normalizeWord(word) {
    return String(word == null ? '' : word)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Retire d'une liste de mots-clés (textes) ceux que la personne a déjà saisis, et les doublons.
  function dropKnown(keywords, known) {
    const skip = new Set((known || []).map(normalizeWord));
    const out = [];
    for (const k of keywords || []) {
      const key = normalizeWord(k);
      if (!key || skip.has(key)) continue;
      skip.add(key);
      out.push(k);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Choix des colonnes et des lignes
  // ---------------------------------------------------------------------------------------------

  // `columns` : `{ colId: { type } }` (GristBI.api.readColumnFormats). Rend, pour chaque rôle de la
  // fenêtre, les identifiants de colonne qui conviennent, dans l'ordre de la table.
  function columnChoices(columns) {
    const ids = Object.keys(columns || {});
    const typeOf = (id) => String((columns[id] && columns[id].type) || '');
    const pick = (types) => ids.filter((id) => types.includes(typeOf(id)));
    return {
      pdfSource: pick(SOURCE_TYPES.pdf),
      textSource: pick(SOURCE_TYPES.text),
      target: pick(TARGET_TYPES),
      manual: pick(MANUAL_TYPES)
    };
  }

  // Nom proposé pour une nouvelle colonne de mots-clés, jamais un nom déjà pris dans la table
  // (insensible à la casse : Grist refuse deux identifiants qui ne diffèrent que par elle).
  function freshColumnName(existingIds, base) {
    const taken = new Set((existingIds || []).map((s) => String(s).toLowerCase()));
    const root = base || 'Mots_cles_auto';
    if (!taken.has(root.toLowerCase())) return root;
    for (let i = 2; i < 1000; i++) {
      const name = `${root}_${i}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    return `${root}_${Date.now()}`;
  }

  /**
   * Quelles lignes de `table` (format colonnaire de `fetchTable` : `{ id: [...], Col: [...] }`)
   * reçoivent des mots-clés. `source.kind` vaut 'pdf' (cellule « Pièces jointes ») ou 'text' (une
   * colonne de texte : titre, résumé…). `targetColumn` peut ne pas exister encore (colonne à créer) :
   * toutes ses cellules sont alors vides. Rend `{ todo, total, filled, noSource }` où `todo` est la
   * liste des tâches `{ id, ids }` (pièces jointes) ou `{ id, text }`, avec `known` quand une colonne
   * « manuelle » est donnée.
   */
  function planRows(table, { kind, sourceColumn, targetColumn, manualColumn }) {
    const ids = (table && table.id) || [];
    const source = (table && table[sourceColumn]) || [];
    const target = targetColumn && table ? table[targetColumn] : null;
    const manual = manualColumn && table ? table[manualColumn] : null;
    const todo = [];
    let filled = 0;
    let noSource = 0;
    for (let i = 0; i < ids.length; i++) {
      if (target && !isEmptyCell(target[i])) { filled++; continue; }
      let task;
      if (kind === 'pdf') {
        const att = attachmentIds(source[i]);
        if (!att.length) { noSource++; continue; }
        task = { id: ids[i], ids: att.slice(0, MAX_ATTACHMENTS_PER_ROW) };
      } else {
        const text = source[i] == null ? '' : String(source[i]).trim();
        if (text.length < MIN_TEXT_CHARS) { noSource++; continue; }
        task = { id: ids[i], text };
      }
      if (manual) task.known = splitWords(manual[i]);
      todo.push(task);
    }
    return { todo, total: ids.length, filled, noSource };
  }

  // ---------------------------------------------------------------------------------------------
  // Une ligne, puis toutes
  // ---------------------------------------------------------------------------------------------

  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * Les mots-clés d'UNE tâche. `deps` : `fetchPdf(attachmentId) -> ArrayBuffer`, `isPdf(buffer) ->
   * bool`, `extractText(buffer, opts) -> string`, `extractKeywords(text, opts) -> [{ phrase }]`.
   * Rend `{ status: 'ok', keywords }`, ou `{ status: 'noPdf' | 'noText' | 'noKeywords' }` quand il n'y
   * a rien à écrire. Une exception (réseau, PDF illisible) est laissée remonter : `runJob` la
   * range dans le compte d'erreurs de cette ligne.
   */
  async function keywordsForTask(task, deps, options) {
    const opts = options || {};
    let text = '';
    if (task.text != null) {
      text = task.text;
    } else {
      const parts = [];
      let sawPdf = false;
      for (const attachmentId of task.ids || []) {
        if (opts.signal && opts.signal.aborted) break;
        const buffer = await deps.fetchPdf(attachmentId);
        if (!deps.isPdf(buffer)) continue; // image, Word… : ignoré, sans erreur
        sawPdf = true;
        parts.push(await deps.extractText(buffer, { maxPages: opts.maxPages, maxChars: opts.maxChars, signal: opts.signal }));
      }
      if (!sawPdf) return { status: 'noPdf' };
      text = parts.join('\n');
    }
    if (text.trim().length < MIN_TEXT_CHARS) return { status: 'noText' };
    const wanted = (opts.maxKeywords || DEFAULT_MAX_KEYWORDS);
    const known = task.known || [];
    const found = deps.extractKeywords(text, { lang: opts.lang || 'auto', maxKeywords: wanted + known.length });
    const keywords = dropKnown(found.map((k) => k.phrase), known).slice(0, wanted);
    if (!keywords.length) return { status: 'noKeywords' };
    return { status: 'ok', keywords };
  }

  /**
   * Traite `todo` (liste de `planRows`) ligne après ligne. `deps` : celles de `keywordsForTask` plus
   * `write(entries)` — `entries` = `[{ id, value }]`, écrit en UN appel à Grist — et, facultatif,
   * `yieldNow()` (rendre la main au navigateur entre deux lignes, défaut `setTimeout 0`).
   * `options` : `kind`, `maxKeywords`, `lang`, `maxPages`, `maxChars`, `batchSize`, `signal`
   * (AbortSignal : l'annulation se prend entre deux lignes, et entre deux pages d'un PDF),
   * `onProgress({ index, total })` et `onRow({ id, status, keywords?, message? })`.
   * Rend `{ written, noPdf, noText, noKeywords, errors, errorSamples, cancelled, writeFailed }`.
   */
  async function runJob(todo, deps, options) {
    const opts = options || {};
    const batchSize = opts.batchSize || DEFAULT_BATCH_SIZE;
    const yieldNow = deps.yieldNow || yieldToBrowser;
    const result = { written: 0, noPdf: 0, noText: 0, noKeywords: 0, errors: 0, errorSamples: [], cancelled: false, writeFailed: null };
    let batch = [];

    async function flush() {
      if (!batch.length) return true;
      const entries = batch;
      batch = [];
      try {
        await deps.write(entries);
        result.written += entries.length;
        return true;
      } catch (e) {
        // Une écriture qui échoue échouerait pour chaque ligne : on arrête, la personne le voit.
        result.writeFailed = (e && e.message) || String(e);
        return false;
      }
    }

    for (let index = 0; index < todo.length; index++) {
      if (opts.signal && opts.signal.aborted) { result.cancelled = true; break; }
      const task = todo[index];
      if (opts.onProgress) opts.onProgress({ index, total: todo.length });
      let outcome;
      try {
        outcome = await keywordsForTask(task, deps, opts);
      } catch (e) {
        result.errors++;
        const message = (e && e.message) || String(e);
        if (result.errorSamples.length < 3) result.errorSamples.push({ id: task.id, message });
        if (opts.onRow) opts.onRow({ id: task.id, status: 'error', message });
        outcome = null;
      }
      if (outcome) {
        if (outcome.status === 'ok') {
          batch.push({ id: task.id, value: formatKeywords(outcome.keywords) });
        } else {
          result[outcome.status]++;
        }
        if (opts.onRow) opts.onRow({ id: task.id, status: outcome.status, keywords: outcome.keywords });
        if (batch.length >= batchSize && !(await flush())) break;
      }
      await yieldNow();
    }
    // Les lignes déjà prêtes sont écrites même après une annulation : le travail fait n'est pas perdu.
    if (result.writeFailed == null) await flush();
    if (opts.onProgress) opts.onProgress({ index: todo.length, total: todo.length });
    if (opts.signal && opts.signal.aborted) result.cancelled = true;
    return result;
  }

  GristBI.publications = {
    DEFAULT_MAX_KEYWORDS, MAX_ATTACHMENTS_PER_ROW, MIN_TEXT_CHARS, DEFAULT_BATCH_SIZE,
    isEmptyCell, attachmentIds, splitWords, formatKeywords, normalizeWord, dropKnown,
    columnChoices, freshColumnName, planRows, keywordsForTask, runJob
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = GristBI.publications;
  }
})(typeof self !== 'undefined' ? self : this);
