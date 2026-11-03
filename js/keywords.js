/*
 * Extraction de mots-clés façon RAKE (Rose et al., 2010), 100% JS vanilla — aucune dépendance
 * externe, donc PAS de demande GFS pour ce module (voir GFS-ETAT.md : seule l'extraction de texte
 * PDF, dans js/pdf-text.js, en a besoin). La tokenisation mot-par-mot utilise `Intl.Segmenter`
 * (natif, disponible depuis longtemps dans tous les navigateurs cibles et sous Node — vérifié dans
 * cette session) plutôt qu'une librairie comme wink-nlp envisagée au départ : une fois la
 * contrainte « sûre/documentée/maintenue + validation GFS » posée par Antoine le 03/11/2026, éviter
 * une dépendance quand une API native suffit est strictement mieux. Repli sur une regex si
 * `Intl.Segmenter` est absent (vieux moteur JS) — jamais d'échec silencieux.
 *
 * Testable sous Node, pur, sans DOM ni Grist : voir dev-tests/test-data.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.keywords = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Listes volontairement modestes (mots-outils à haute fréquence), dans l'esprit du stoplist
  // d'origine de RAKE — pas besoin d'exhaustivité façon NLTK pour que l'algorithme fonctionne.
  const STOPWORDS_FR = [
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car',
    'que', 'qui', 'quoi', 'dont', 'où', 'ce', 'cet', 'cette', 'ces', 'cela', 'ça', 'ceci', 'son', 'sa',
    'ses', 'leur', 'leurs', 'notre', 'nos', 'votre', 'vos', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
    'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se', 'lui', 'y', 'en',
    'dans', 'sur', 'sous', 'vers', 'chez', 'avec', 'sans', 'pour', 'par', 'entre', 'parmi', 'selon',
    'depuis', 'pendant', 'avant', 'après', 'ainsi', 'alors', 'aussi', 'autre', 'autres', 'comme',
    'comment', 'quand', 'si', 'ne', 'pas', 'plus', 'moins', 'très', 'trop', 'peu', 'bien', 'mal',
    'tout', 'tous', 'toute', 'toutes', 'chaque', 'plusieurs', 'certain', 'certains', 'certaine',
    'certaines', 'aucun', 'aucune', 'même', 'mêmes', 'être', 'est', 'sont', 'étaient', 'était', 'été',
    'avoir', 'ont', 'avait', 'avaient', 'eu', 'faire', 'fait', 'faut', 'celui', 'celle', 'ceux',
    'celles', 'ici', 'là', 'enfin', 'cependant', 'toutefois', 'néanmoins', 'lorsque', 'tandis',
    'afin', 'jusqu', 'près', 'au', 'aux', 'à', 'd', 'l', 's', 'n', 'c', 'j', 't', 'm', 'qu'
  ];

  const STOPWORDS_EN = [
    'the', 'a', 'an', 'and', 'or', 'but', 'so', 'yet', 'nor', 'of', 'to', 'in', 'on', 'at', 'by',
    'for', 'with', 'without', 'from', 'into', 'onto', 'over', 'under', 'between', 'among', 'through',
    'during', 'before', 'after', 'about', 'against', 'as', 'than', 'then', 'that', 'this', 'these',
    'those', 'it', 'its', 'they', 'them', 'their', 'theirs', 'he', 'she', 'him', 'her', 'his', 'hers',
    'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'i', 'me', 'my', 'mine', 'is', 'are', 'was',
    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
    'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'not', 'no', 'if',
    'because', 'while', 'where', 'when', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose', 'all',
    'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
    'too', 'very', 'just', 'also', 'however', 'therefore', 'thus', 'hence', 'moreover', 'furthermore',
    'nevertheless', 'although', 'though', 'since', 'until', 'unless', 'whether', 'either', 'neither'
  ];

  function buildStopwordSet(lang) {
    const words = lang === 'fr' ? STOPWORDS_FR : lang === 'en' ? STOPWORDS_EN : STOPWORDS_FR.concat(STOPWORDS_EN);
    return new Set(words);
  }

  // Repli regex si Intl.Segmenter est absent : suite de lettres/chiffres (accents inclus), avec
  // apostrophes/tirets internes autorisés (mots composés, élisions) — même famille de motif que le
  // mock ne pourrait pas distinguer d'un vrai moteur, donc testé directement sous Node ici.
  const WORD_FALLBACK_RE = /[a-zà-öø-ÿ0-9]+(?:['-][a-zà-öø-ÿ0-9]+)*/gi;

  // Renvoie les segments du texte dans l'ordre, chacun `{ text, isWord }` : `isWord` distingue un
  // mot d'une frontière (ponctuation, espace) — c'est cette frontière qui délimite les phrases
  // candidates RAKE, pas seulement les mots vides (voir extractCandidatePhrases).
  function segmentText(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('fr', { granularity: 'word' });
      const out = [];
      for (const s of segmenter.segment(text)) {
        out.push({ text: s.segment, isWord: !!s.isWordLike });
      }
      return out;
    }
    const out = [];
    let lastIndex = 0;
    let m;
    WORD_FALLBACK_RE.lastIndex = 0;
    while ((m = WORD_FALLBACK_RE.exec(text))) {
      if (m.index > lastIndex) out.push({ text: text.slice(lastIndex, m.index), isWord: false });
      out.push({ text: m[0], isWord: true });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) out.push({ text: text.slice(lastIndex), isWord: false });
    return out;
  }

  const PURE_NUMBER_RE = /^[0-9]+$/;

  // Découpe `text` en phrases candidates : suites ininterrompues de mots « pleins » (ni mot vide, ni
  // nombre seul, ni plus courts que `minWordLength`), coupées à chaque mot vide/ponctuation — c'est
  // la génération de candidats de RAKE. Chaque phrase est un tableau de mots en minuscules.
  const WHITESPACE_ONLY_RE = /^\s*$/;

  function extractCandidatePhrases(text, stopwords, minWordLength) {
    const segments = segmentText(String(text || ''));
    const phrases = [];
    let current = [];
    for (const seg of segments) {
      if (seg.isWord) {
        const lower = seg.text.toLowerCase();
        const isContentWord = lower.length >= minWordLength
          && !stopwords.has(lower) && !PURE_NUMBER_RE.test(lower);
        if (isContentWord) {
          current.push(lower);
          continue;
        }
        // Mot vide ou trop court -> frontière (traité ci-dessous comme la ponctuation).
      } else if (WHITESPACE_ONLY_RE.test(seg.text)) {
        // Un espace seul est neutre : il NE coupe PAS la phrase candidate (sinon chaque mot
        // deviendrait sa propre "phrase" d'un seul mot, puisque l'espace sépare quasi tous les
        // mots — seule la ponctuation et les mots vides doivent couper, voir la docstring
        // d'extractKeywords).
        continue;
      }
      if (current.length) {
        phrases.push(current);
        current = [];
      }
    }
    if (current.length) phrases.push(current);
    return phrases;
  }

  // Score RAKE canonique (Rose et al., 2010) : degree(mot) = somme, sur chaque occurrence, de la
  // longueur de sa phrase (auto-boucle incluse) ; freq(mot) = nombre d'occurrences ; score(mot) =
  // degree/freq ; score(phrase) = somme des scores de ses mots (répétitions comptées).
  function scoreWords(phrases) {
    const degree = new Map();
    const freq = new Map();
    for (const phrase of phrases) {
      const len = phrase.length;
      for (const w of phrase) {
        degree.set(w, (degree.get(w) || 0) + len);
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const score = new Map();
    for (const [w, d] of degree) score.set(w, d / freq.get(w));
    return score;
  }

  function scorePhrase(phrase, wordScore) {
    let total = 0;
    for (const w of phrase) total += wordScore.get(w) || 0;
    return total;
  }

  /**
   * Extrait les mots-clés les plus significatifs d'un texte (résumé, texte intégral de PDF, etc.).
   * options.lang: 'fr' | 'en' | 'auto' (défaut 'auto', union des deux stoplists — un article de
   * chercheur francophone mélange souvent résumé anglais et commentaire français).
   * options.maxKeywords: nombre de mots-clés renvoyés (défaut 20).
   * options.minWordLength: longueur minimale d'un mot pour compter comme "plein" (défaut 2).
   * options.maxPhraseWords: une phrase candidate plus longue que ce nombre de mots est découpée en
   *   tronçons de cette taille avant notation — garde-fou défensif (RAKE n'en a pas nativement) :
   *   un texte sans aucun mot vide sur une longue plage (tableau de données mal extrait d'un PDF,
   *   liste à puces sans ponctuation) produirait sinon une seule "phrase" géante dont les mots
   *   obtiennent un degree artificiellement énorme et dominent le classement (défaut 8).
   * Renvoie [{ phrase, score }], triés par score décroissant, ex-aequo dans l'ordre de première
   * apparition (jamais un tri alphabétique implicite — même prudence que groupByAggregate, voir
   * CLAUDE.md §7 piège n°14).
   */
  function extractKeywords(text, options) {
    const opts = options || {};
    const lang = opts.lang || 'auto';
    const maxKeywords = opts.maxKeywords || 20;
    const minWordLength = opts.minWordLength != null ? opts.minWordLength : 2;
    const maxPhraseWords = opts.maxPhraseWords || 8;

    const stopwords = buildStopwordSet(lang);
    let phrases = extractCandidatePhrases(text, stopwords, minWordLength);

    const chunked = [];
    for (const phrase of phrases) {
      if (phrase.length <= maxPhraseWords) {
        chunked.push(phrase);
      } else {
        for (let i = 0; i < phrase.length; i += maxPhraseWords) {
          chunked.push(phrase.slice(i, i + maxPhraseWords));
        }
      }
    }
    phrases = chunked;

    const wordScore = scoreWords(phrases);

    const seen = new Map(); // phrase texte -> { phrase, score, firstIndex }
    phrases.forEach((phrase, index) => {
      const key = phrase.join(' ');
      if (seen.has(key)) return;
      seen.set(key, { phrase: key, score: scorePhrase(phrase, wordScore), firstIndex: index });
    });

    return Array.from(seen.values())
      .sort((a, b) => (b.score - a.score) || (a.firstIndex - b.firstIndex))
      .slice(0, maxKeywords)
      .map((e) => ({ phrase: e.phrase, score: e.score }));
  }

  return { extractKeywords, extractCandidatePhrases, scoreWords, segmentText, buildStopwordSet };
});
