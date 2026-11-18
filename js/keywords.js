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

  // Mots qui reviennent dans TOUT article sans désigner son sujet : verbes de discours scientifique
  // (« montre », « propose », « require »), adverbes, adjectifs vagues et rubriques (« résultats »,
  // « figure »). Traités comme des mots vides : ils COUPENT une phrase candidate, au lieu de s'y coller
  // (« langage naturel doit gérer » -> « langage naturel »). Mesuré sur des textes d'essai le 18/11/2026 :
  // sans eux, les mots-clés d'un PDF sortaient en demi-phrases. Liste volontairement courte : un verbe
  // ou un adjectif qui n'y est pas ne casse rien, il est seulement moins bien écarté — le classement par
  // fréquence (voir extractKeywords) le rend rare parmi les premiers.
  const FILLER_FR = [
    'doit', 'doivent', 'devrait', 'peut', 'peuvent', 'pourrait', 'pourraient', 'permet', 'permettent',
    'montre', 'montrent', 'montré', 'montrés', 'indique', 'indiquent', 'améliore', 'améliorent',
    'propose', 'proposons', 'proposé', 'présente', 'présentent', 'présenté', 'utilise', 'utilisent',
    'utilisé', 'utilisés', 'repose', 'reposent', 'retrouve', 'impose', 'imposent', 'reste', 'restent',
    'consiste', 'vise', 'visent', 'obtenu', 'obtenus', 'réalisé', 'réalisés', 'effectué', 'observé',
    'observés', 'sera', 'seront', 'serait', 'soit', 'font', 'faits', 'faisant', 'devient', 'sert',
    'notamment', 'souvent', 'ensuite', 'directement', 'également', 'généralement', 'désormais', 'déjà',
    'encore', 'toujours', 'jamais', 'beaucoup', 'surtout', 'seulement', 'ainsi', 'puis', 'non', 'oui',
    'etc', 'ci', 'ceux', 'compte', 'nombreux', 'nombreuses', 'différents', 'différentes', 'divers', 'diverses',
    'principal', 'principale', 'principaux', 'premier', 'première', 'second', 'seconde', 'nouveau',
    'nouvelle', 'nouveaux', 'nouvelles', 'grand', 'grande', 'grands', 'grandes', 'bon', 'bonne',
    'important', 'importante', 'importants', 'simple', 'simples', 'possible', 'possibles', 'notable',
    'article', 'articles', 'étude', 'études', 'travail', 'travaux', 'résultat', 'résultats', 'figure',
    'tableau', 'section', 'introduction', 'conclusion', 'résumé', 'abstract', 'méthode', 'méthodes',
    'approche', 'approches', 'cas', 'fois', 'partie', 'part', 'type', 'types', 'nombre', 'ensemble',
    'augmente', 'augmentent', 'insistent', 'insiste', 'comptent', 'modifie', 'modifient',
    'confirment', 'confirme', 'incluent', 'inclure', 'associé', 'associée', 'associés', 'mesuré', 'mesurée',
    'discutons', 'discutent', 'étudie', 'étudient', 'analysons', 'considère', 'considèrent',
    'constitue', 'constituent', 'dépend', 'dépendait', 'disposait', 'efface', 'explique', 'expliquent',
    'favorise', 'favorisent', 'persiste', 'persistent', 'suggère', 'suggèrent', 'semble', 'semblent',
    'devrait', 'devraient', 'concerne', 'concernent', 'porte', 'portent', 'compense', 'protège', 'fondée', 'fondé'
  ];
  const FILLER_EN = [
    'require', 'requires', 'required', 'show', 'shows', 'shown', 'showed', 'improve', 'improves',
    'improved', 'propose', 'proposes', 'proposed', 'present', 'presents', 'presented', 'use', 'uses',
    'used', 'using', 'based', 'allow', 'allows', 'provide', 'provides', 'provided', 'obtain',
    'obtained', 'evaluate', 'evaluated', 'demonstrate', 'demonstrates', 'suggest', 'suggests',
    'indicate', 'indicates', 'become', 'becomes', 'make', 'makes', 'made', 'give', 'gives', 'given',
    'often', 'usually', 'generally', 'especially', 'already', 'always', 'never', 'many', 'several',
    'various', 'different', 'new', 'novel', 'large', 'small', 'high', 'low', 'good', 'better', 'best',
    'important', 'simple', 'possible', 'paper', 'papers', 'article', 'articles', 'study', 'studies',
    'work', 'works', 'result', 'results', 'figure', 'table', 'section', 'introduction', 'conclusion',
    'abstract', 'approach', 'approaches', 'method', 'methods', 'case', 'cases', 'type', 'types',
    'number', 'set', 'et', 'al', 'etc', 'one', 'two', 'three',
    'across', 'within', 'whereas', 'thereby', 'confirm', 'confirmed', 'confirms', 'lost', 'lose', 'reduce',
    'reduces', 'reduced', 'increase', 'increases', 'increased', 'decrease', 'decreases', 'explain', 'explains',
    'include', 'includes', 'including', 'included', 'retained', 'remain', 'remains', 'reached', 'achieve',
    'achieved', 'test', 'tested', 'created', 'creates', 'exposed', 'indicated', 'found', 'observed', 'measured',
    'suppress', 'suppresses', 'accelerates', 'combine', 'combines', 'discuss', 'discussed', 'consider',
    'considered', 'compare', 'compared', 'describe', 'described', 'perform', 'performed', 'follow', 'follows'
  ];

  function buildStopwordSet(lang) {
    const words = lang === 'fr' ? STOPWORDS_FR.concat(FILLER_FR)
      : lang === 'en' ? STOPWORDS_EN.concat(FILLER_EN)
      : STOPWORDS_FR.concat(STOPWORDS_EN, FILLER_FR, FILLER_EN);
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
      // `Intl.Segmenter` coupe « mots-clés » en trois segments (mot, trait d'union, mot) : un mot
      // composé redevient UN mot, sans quoi « mots-clés automatiques » perdait « mots » en route.
      const merged = [];
      for (let i = 0; i < out.length; i++) {
        const seg = out[i];
        if (seg.isWord && merged.length >= 2) {
          const hyphen = merged[merged.length - 1];
          const before = merged[merged.length - 2];
          if (before.isWord && !hyphen.isWord && /^[-\u2010\u2011]$/.test(hyphen.text)) {
            merged.splice(merged.length - 2, 2, { text: before.text + '-' + seg.text, isWord: true });
            continue;
          }
        }
        // `Intl.Segmenter` rend chaque saut de ligne à part : on recolle les blancs qui se suivent pour
        // qu'une ligne vide (fin de paragraphe ou de page) se reconnaisse comme telle.
        const last = merged[merged.length - 1];
        if (last && !last.isWord && !seg.isWord && /^\s+$/.test(last.text) && /^\s+$/.test(seg.text)) {
          last.text += seg.text;
          continue;
        }
        merged.push(seg);
      }
      return merged;
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
  const PARAGRAPH_BREAK_RE = /\n\s*\n/;
  // Élision française (« l'apprentissage », « d'un », « qu'il ») : le mot est ce qui suit l'apostrophe ;
  // « d'un » devient « un », un mot vide, qui coupe la phrase comme il se doit. Possessif anglais (« model's »).
  const ELISION_RE = /^(?:l|d|s|n|m|t|c|j|qu|jusqu|lorsqu|puisqu|quoiqu)['\u2019](.+)$/;
  const POSSESSIVE_RE = /^(.+?)['\u2019]s$/;

  function extractCandidatePhrases(text, stopwords, minWordLength) {
    const segments = segmentText(String(text || ''));
    const phrases = [];
    let current = [];
    for (const seg of segments) {
      if (seg.isWord) {
        let lower = seg.text.toLowerCase();
        const elision = ELISION_RE.exec(lower);
        if (elision) {
          // « centres d'examens » : « d' » est un mot vide, il COUPE la phrase (sinon « centres examens »).
          if (current.length) { phrases.push(current); current = []; }
          lower = elision[1];
        } else {
          const possessive = POSSESSIVE_RE.exec(lower);
          if (possessive) lower = possessive[1];
        }
        const isContentWord = lower.length >= minWordLength
          && !stopwords.has(lower) && !PURE_NUMBER_RE.test(lower);
        if (isContentWord) {
          current.push(lower);
          continue;
        }
        // Mot vide ou trop court -> frontière (traité ci-dessous comme la ponctuation).
      } else if (WHITESPACE_ONLY_RE.test(seg.text) && !PARAGRAPH_BREAK_RE.test(seg.text)) {
        // Un espace seul est neutre : il NE coupe PAS la phrase candidate (sinon chaque mot
        // deviendrait sa propre "phrase" d'un seul mot, puisque l'espace sépare quasi tous les
        // mots — seule la ponctuation et les mots vides doivent couper, voir la docstring
        // d'extractKeywords). Une ligne vide, elle, coupe : fin de paragraphe, ou de page (voir
        // js/pdf-text.js:joinPages) — la fin d'une page ne se colle jamais au début de la suivante.
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
   * RAKE d'origine (Rose et al., 2010), tel quel : le score d'une phrase candidate est la somme des
   * scores de ses mots. Gardé comme référence et pour comparer ; `extractKeywords` (plus bas) est ce que
   * l'application utilise, parce que RAKE seul classe en tête de LONGUES phrases rares (« recherche
   * documentaire efficace doit rester utilisable ») plutôt que les termes qui reviennent.
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
  function rakeKeywords(text, options) {
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

  /**
   * Mots-clés d'un texte (résumé, texte intégral d'un PDF) : les phrases candidates de RAKE, classées
   * par ce qui compte pour un LECTEUR — un terme qui REVIENT, en 1 à 3 mots.
   *
   * Pourquoi pas RAKE seul : son score additionne les mots d'une phrase, donc une longue phrase rare
   * bat toujours un terme court qui revient quarante fois (essai du 18/11/2026 sur de vrais PDF :
   * « recherche documentaire efficace doit rester utilisable » avant « recherche sémantique »). Ici :
   *  1. les phrases candidates sont celles de RAKE (coupées aux mots vides et à la ponctuation) ;
   *  2. chaque suite de 1 à `maxPhraseWords` mots d'une phrase est une unité, dont on compte les
   *     occurrences (`tf`) dans tout le texte — « langage naturel » gagne un point à chaque phrase où
   *     il figure, qu'elle soit longue ou non ;
   *  3. score = (somme des scores RAKE des mots, qui fait préférer 2-3 mots à 1) x (1 + ln tf), un
   *     mot seul pesant moitié moins (un mot seul est ambigu : « recherche ») ;
   *  4. une unité tirée d'une phrase plus longue que `maxPhraseWords` n'est retenue que si elle revient
   *     (tf >= 2) : sinon on ne saurait pas quelles coupes de « langage naturel doit gérer les accents »
   *     sont un terme ; un mot seul ne compte qu'à partir de 2 occurrences (sauf texte très court) ;
   *  5. une unité qui n'est presque qu'un morceau d'une unité déjà retenue (« sémantique » dans
   *     « analyse sémantique ») est écartée ; un mot qui sert aussi seul (tf bien plus grand) reste.
   * options : `lang` ('fr' | 'en' | 'auto'), `maxKeywords` (20), `minWordLength` (2),
   * `maxPhraseWords` (3 : la longueur maximale d'un mot-clé). Le nombre de mots-clés est aussi plafonné
   * à un pour cinq mots utiles du texte (au moins 3) : un résumé court n'en rend que quelques-uns.
   * Rend [{ phrase, score }], ex-aequo dans
   * l'ordre de première apparition (jamais alphabétique, CLAUDE.md §7 piège n°14).
   */
  const MIN_SHORT_TEXT_KEYWORDS = 3;
  const WORDS_PER_KEYWORD = 5;

  function extractKeywords(text, options) {
    const opts = options || {};
    const maxKeywords = opts.maxKeywords || 20;
    const minWordLength = opts.minWordLength != null ? opts.minWordLength : 2;
    const maxN = Math.max(1, opts.maxPhraseWords || 3);
    const phrases = extractCandidatePhrases(text, buildStopwordSet(opts.lang || 'auto'), minWordLength);

    // Score RAKE des mots, sur les phrases telles quelles mais avec une longueur plafonnée à maxN :
    // une phrase de 12 mots ne doit pas donner à ses mots un « degree » énorme.
    const degree = new Map();
    const freq = new Map();
    let totalWords = 0;
    for (const phrase of phrases) {
      const len = Math.min(phrase.length, maxN);
      for (const w of phrase) {
        degree.set(w, (degree.get(w) || 0) + len);
        freq.set(w, (freq.get(w) || 0) + 1);
        totalWords++;
      }
    }
    const wordScore = (w) => degree.get(w) / freq.get(w);

    // Les unités : toute suite de 1 à maxN mots d'une phrase, comptées dans le texte entier.
    const units = new Map(); // clé -> { words, tf, firstIndex, whole }
    let index = 0;
    for (const phrase of phrases) {
      for (let n = 1; n <= Math.min(maxN, phrase.length); n++) {
        for (let i = 0; i + n <= phrase.length; i++) {
          const words = phrase.slice(i, i + n);
          const key = words.join(' ');
          let u = units.get(key);
          if (!u) { u = { key, words, tf: 0, firstIndex: index, whole: 0 }; units.set(key, u); }
          u.tf++;
          if (n === phrase.length) u.whole++; // l'unité EST une phrase complète (et pas seulement un morceau d'une plus longue)
        }
      }
      index++;
    }

    // Une occurrence comme phrase complète vaut 1, un morceau d'une phrase plus longue vaut 1/2 : « risque
    // cardiovasculaire » seul est un terme, « risque cardiovasculaire augmente » une demi-phrase.
    // Dans un texte long (un PDF), une unité vue une seule fois est du bruit : on exige qu'elle revienne ;
    // dans un résumé ou un titre, rien ne revient, on garde ce qui est vu une fois (pondéré plus bas).
    const shortText = totalWords < 200;
    const minEffective = totalWords >= 400 ? 2 : 1;
    const scored = [];
    for (const u of units.values()) {
      const n = u.words.length;
      if (n === 1 && u.words[0].length < 3) continue;
      if (n === 1 && u.tf < 2 && !shortText) continue;
      const effective = u.whole + 0.5 * (u.tf - u.whole);
      if (effective < minEffective) continue;
      if (!u.whole && u.tf < 2) continue; // coupe d'une phrase trop longue, vue une seule fois
      let base = 0;
      for (const w of u.words) base += wordScore(w);
      u.score = base * (1 + Math.log(effective)) * (n === 1 ? 0.5 : 1) * (u.tf === 1 ? 0.5 : 1);
      scored.push(u);
    }
    scored.sort((a, b) => (b.score - a.score) || (a.firstIndex - b.firstIndex));

    // Sélection gloutonne : on écarte ce qui n'est qu'un morceau d'une unité déjà prise.
    const contains = (big, small) => {
      if (small.length >= big.length) return false;
      for (let i = 0; i + small.length <= big.length; i++) {
        let hit = true;
        for (let j = 0; j < small.length; j++) if (big[i + j] !== small[j]) { hit = false; break; }
        if (hit) return true;
      }
      return false;
    };
    // Un texte court (titre, résumé de 40 mots) n'a que quelques termes : au-delà d'un mot-clé pour cinq
    // mots utiles, la fin de liste n'est plus que du bruit (« jour, hausse, personnes… », essai du 18/11/2026).
    // Un texte de 100 mots utiles ou plus n'est pas touché (20 mots-clés et plus).
    const limit = Math.min(maxKeywords, Math.max(MIN_SHORT_TEXT_KEYWORDS, Math.ceil(totalWords / WORDS_PER_KEYWORD)));
    const chosen = [];
    for (const u of scored) {
      if (chosen.length >= limit) break;
      if (chosen.some((c) => contains(c.words, u.words) && u.tf <= c.tf * 2)) continue;
      chosen.push(u);
    }
    return chosen.map((u) => ({ phrase: u.key, score: u.score }));
  }

  return { extractKeywords, rakeKeywords, extractCandidatePhrases, scoreWords, segmentText, buildStopwordSet };
});
