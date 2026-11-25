/*
 * Le DICTIONNAIRE DES NOMS DE COLONNES des suggestions de tuiles (25/11/2026, demande d'Antoine : « aller aussi chercher s'il y a des noms de colonnes
 * en français ou en anglais, un peu typés, genre montant ou autre ») : pur JS, AUCUNE dépendance, déterministe, testé sous Node
 * (dev-tests/test-advice-names.js). Il dit ce qu'un NOM de colonne annonce — un montant, une quantité, un prix unitaire, une note, un statut, une
 * catégorie, un identifiant, un téléphone, une date… — en français comme en anglais, avec les fautes qu'on fait en tapant un nom de colonne.
 *
 * Ce que le nom EST — et ce qu'il n'est jamais : un INDICE de plus, jamais la seule raison d'une décision (js/advice.js lit toujours les valeurs
 * d'abord ; un nom qui dit « montant » sur une colonne de texte n'en fait pas une mesure). Ce module ne connaît ni les valeurs ni Grist.
 *
 * Comment un nom est lu :
 *   1. le nom est coupé en MOTS (camelCase, `_`, `.`, espaces, chiffres), sans accents ni majuscules ; les mots vides (de, du, of, per…) et les
 *      lettres seules (« Durée_h », « N° ») sont écartés ;
 *   2. chaque mot est cherché tel quel, puis sans son pluriel ou son féminin (clients, commerciale), puis coupé en deux ou trois mots connus quand il est
 *      collé (« montantht », « nbclients », « prixunitaire »), puis cherché À UNE OU DEUX FAUTES PRÈS (« montnat », « quantitée », « telephne ») ;
 *   3. la FAUTE n'est tolérée que sur un mot d'au moins 5 lettres (une lettre de moins à 4 lettres et « date » deviendrait « data »), jamais sur la
 *      première lettre, jamais sur un mot qui est lui-même un mot courant (« store » n'est pas une faute de « score », « court » pas de « count »),
 *      et jamais quand deux mots connus de sortes différentes sont aussi proches l'un que l'autre ;
 *   4. quand plusieurs mots disent des choses différentes, la sorte la plus PRÉCISE gagne (voir PRIORITY) : « Nombre de clients » est une quantité (pas un
 *      client), « Nom du client » un libellé, « Prix total » un montant (pas un prix unitaire), « Délai de livraison » un délai (pas une date).
 *
 * `classify(nom)` rend `{ kind, tags, words, extra, near }` ; `kind` = '' quand le nom ne dit rien (le cas le plus courant, et il le reste : un nom
 * inconnu ne change rien aux suggestions). `extra` = le nombre de mots que le dictionnaire ne connaît pas (« Jours de congé » : un mot inconnu), `near` =
 * vrai quand un mot n'a été reconnu qu'approximativement (pluriel, collé, faute).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.GristBI = root.GristBI || {};
    root.GristBI.adviceNames = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Les sortes, de la plus précise à la plus générale : quand un nom en porte plusieurs, la première de cette liste gagne.
  //   contact     adresse électronique, téléphone, adresse postale, lien : jamais une mesure ni un axe
  //   id          identifiant, numéro, référence, matricule : jamais une mesure
  //   date        une date (la sorte `dateWeak` n'est retenue qu'en l'absence de toute autre : « Livraison », « Début »)
  //   text        commentaire, description, message : du texte libre
  //   code        code postal, code : jamais une mesure
  //   categoryMod type, groupe, famille, tranche : ce qui précède est une CATÉGORIE (« Tranche d'âge »)
  //   status      statut, état, étape, phase
  //   level       niveau, priorité, rang, gravité
  //   rate        taux, note, score, satisfaction, pourcentage : une grandeur bornée qu'on MOYENNE
  //   amount      montant, total, chiffre d'affaires, coût, salaire : une somme d'argent qu'on ADDITIONNE
  //   unitPrice   prix, tarif : un montant PAR unité, qu'on ne somme jamais
  //   quantity    quantité, nombre, volume, heures : un effectif qu'on ADDITIONNE
  //   avgMeasure  âge, délai, poids, ancienneté : une grandeur qu'on MOYENNE
  //   period      mois, semaine, trimestre, jour : un numéro de période
  //   dateWeak    livraison, début, fin : une date quand rien d'autre n'est dit
  //   label       nom, libellé, titre : le nom d'un individu
  //   category    produit, client, région, équipe, canal : une entité qui sert d'axe
  const PRIORITY = ['contact', 'id', 'date', 'text', 'code', 'categoryMod', 'status', 'level', 'rate', 'amount', 'unitPrice', 'quantity', 'avgMeasure', 'period', 'dateWeak', 'label', 'category'];

  // Les mots, par sorte. Les accents n'y figurent pas (« qte » dit aussi « qté »). Un mot ne figure que dans UNE sorte (un essai le vérifie).
  const WORDS = {
    contact: 'email e-mail mail courriel mel telephone tel phone mobile portable fax adresse adresses address addresses url lien liens link links website siteweb skype whatsapp',
    id: 'id ids uuid guid uid ref refs reference references identifiant identifiants identifier numero numeros num nr matricule sku siret siren iban bic ean isbn immatriculation cle key token',
    date: 'date dates dt created creation cree creee modifie modified updated maj naissance birth birthday echeance due deadline embauche hired inscription registered arrivee arrival signature signed expedition shipped',
    text: 'commentaire commentaires comment comments description descriptions desc remarque remarques remark remarks observation observations obs message messages msg details detail memo texte text contenu content resume summary feedback avis review motif raison reason cause justification objet subject sujet',
    code: 'code codes cp zip zipcode postal postcode insee',
    categoryMod: 'tranche tranches bracket groupe groupes group groups type types categorie categories category cat famille familles family classe classes class segment segments mode modes forme nature genre kind sorte',
    status: 'statut statuts status etat etats state situation stade etape etapes stage stages phase phases step steps decision valide validation approuve approved actif active cycle pipeline funnel entonnoir',
    level: 'niveau niveaux level levels priorite priorites priority rang rank grade gravite severity urgence urgency importance criticite criticality tier palier etoiles stars',
    rate: 'taux rate ratio pct percent percentage pourcentage note notes score scores rating ratings satisfaction avancement progress progression completion probabilite probability nps evaluation appreciation',
    // Les mots d'un montant qui ANNULENT un prix (« Prix total » est un total) : les mêmes que l'indice historique de js/advice.js:isUnitPriceName.
    amount: 'montant montants mt mnt amount amounts amt total totaux totale subtotal soustotal ca chiffre affaires revenue revenues revenu revenus recette recettes turnover somme sum '
      // Les autres mots d'argent : un montant, mais « Prix de vente » reste un prix.
      + 'vente ventes sales depense depenses expense expenses cout couts cost costs charge charges budget budgets salaire salaires salary salaries paie pay wage remuneration honoraires '
      + 'benefice profit marge margin perte loss solde balance valeur value prime bonus commission frais fees loyer rent impot impots taxe taxes tax epargne credit debit dette debt '
      + 'capital pret loan encours realise actual reel prevu planned objectif objectifs cible cibles target targets goal goals quota quotas attendu attendus expected ht ttc tva vat net brut gross eur euro euros usd dollar dollars',
    unitPrice: 'prix price prices tarif tarifs pu puht puttc pvu pvht',
    quantity: 'quantite quantites qte qty quantity nombre nb nbr nbre count volume volumes unites units pieces pcs stock effectif effectifs headcount population participants personnes people visites visits clics clicks vues views sessions heures hours hrs duree durees duration restant restants remaining reste surface superficie litres kg tonnes',
    avgMeasure: 'age ages anciennete seniority tenure moyenne average avg mean median delai delais delay poids weight taille height longueur length largeur width hauteur distance vitesse speed temperature temp',
    period: 'annee annees year yr mois month trimestre trimestres quarter semestre semester semaine semaines week jour day',
    dateWeak: 'debut start begin depart ouverture opened fin end livraison delivery cloture closed closing fermeture termine finish',
    label: 'nom noms name names libelle libelles label labels titre titres title designation intitule prenom firstname lastname surname fullname denomination appellation pseudo',
    category: 'produit produits product products article articles item items gamme range modele model marque brand collection rubrique client clients customer customers cust societe company entreprise enterprise '
      + 'organisation organization org fournisseur supplier vendor partenaire partner prospect beneficiaire patient eleve student etudiant salarie employe employee agent utilisateur user membre member '
      + 'pays country ville city region departement dept province zone secteur sector territoire territory agence agency magasin store stores boutique shop entrepot warehouse lieu location localisation '
      + 'continent quartier commune county equipe team service direction pole division commercial vendeur seller representant rep responsable manager owner proprietaire assigne assignee auteur author '
      + 'createur creator collaborateur technicien operateur conseiller intervenant pilote referent canal channel source origine origin medium methode method moyen campagne campaign plateforme platform '
      + 'appareil device navigateur browser langue language devise currency sexe sex gender civilite nationalite profession metier poste job fonction role industrie saison season periode period site'
  };

  // Des étiquettes à part des sortes : ce que js/advice-types-*.js cherche dans un nom (un objectif, un début, une fin, une étape) et de quelle
  // période un mot parle (pour borner un numéro de mois, de semaine…).
  const TAGS = {
    target: 'objectif objectifs cible cibles target targets goal goals quota quotas attendu attendus expected',
    start: 'debut start begin depart ouverture opened cree creee created',
    end: 'fin end echeance due deadline livraison delivery cloture closed closing fermeture termine finish',
    stage: 'etape etapes stage stages phase phases step steps pipeline funnel entonnoir',
    month: 'mois month',
    week: 'semaine semaines week',
    day: 'jour day',
    quarter: 'trimestre trimestres quarter',
    semester: 'semestre semester',
    year: 'annee annees year yr',
    unit: 'unit unite unitaire unitary'
  };
  // La part des mots d'argent qui annule un prix (voir ci-dessus) : les mots de `amount` jusqu'à « turnover somme sum ».
  const STRONG_AMOUNT = new Set('montant montants mt mnt amount amounts amt total totaux totale subtotal soustotal ca chiffre affaires revenue revenues revenu revenus recette recettes turnover somme sum'.split(' '));
  // Les mots qui se lisent « par unité » quand ils accompagnent un coût ou un prix.
  const WEAK_COST = new Set('cout couts cost costs vente ventes sales'.split(' '));

  // Les mots vides : jamais comptés comme « mot inconnu ».
  const STOP = new Set('de du des d l la le les au aux en par per of the a an and et ou or for pour sur on by in to sans avec with without est is at'.split(' '));
  // Des mots courants que le dictionnaire ne doit JAMAIS confondre avec l'un des siens à une faute près (ni dire quoi que ce soit) : « court » n'est pas
  // une faute de « count », « radio » pas de « ratio », « cours » pas de « couts »… Chaque mot est là parce que l'essai des faux amis a montré que, sans lui,
  // le nom disait quelque chose ; retirer un mot qui n'a plus de raison d'être est permis, en ajouter un demande l'essai qui le montre.
  const NEUTRAL = new Set((
    'court radio scare stick stack shock cable lever messager noted venter prince primer contest cotes tariff object objets personne cours directive'
  ).split(/\s+/).filter(Boolean));

  // Mots sans accent, une seule fois chacun, vers leur sorte.
  const KIND_OF = new Map();
  Object.keys(WORDS).forEach((kind) => WORDS[kind].split(/\s+/).filter(Boolean).forEach((word) => { if (!KIND_OF.has(word)) KIND_OF.set(word, kind); }));
  const TAGS_OF = new Map();
  Object.keys(TAGS).forEach((tag) => TAGS[tag].split(/\s+/).filter(Boolean).forEach((word) => {
    if (!TAGS_OF.has(word)) TAGS_OF.set(word, []);
    TAGS_OF.get(word).push(tag);
  }));
  // Les mots courts qu'on a le droit de COLLER à un autre (« nbclients », « montantht ») : jamais une coupure au milieu d'un mot ordinaire.
  const SHORT = new Set('nb ca ht pu mt cp tel qte qty pct id dt tva ttc net brut'.split(' '));

  // Les mots qu'une FAUTE peut viser : au moins 5 lettres, rangés par première lettre (une faute sur la première lettre est rare et fait des faux amis).
  const FUZZY = new Map();
  KIND_OF.forEach((kind, word) => {
    if (word.length < 5) return;
    const first = word.charAt(0);
    if (!FUZZY.has(first)) FUZZY.set(first, []);
    FUZZY.get(first).push(word);
  });

  // Distance de Damerau-Levenshtein « restreinte » : une substitution, une suppression, un ajout ou l'échange de deux lettres voisines comptent pour 1.
  function distance(a, b, limit) {
    const n = a.length;
    const m = b.length;
    if (Math.abs(n - m) > limit) return limit + 1;
    let prev2 = null;
    let prev = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      const row = new Array(m + 1);
      row[0] = i;
      let best = row[0];
      for (let j = 1; j <= m; j++) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) d = Math.min(d, prev2[j - 2] + 1);
        row[j] = d;
        if (d < best) best = d;
      }
      if (best > limit) return limit + 1;
      prev2 = prev;
      prev = row;
    }
    return prev[m];
  }

  // Le nom coupé en mots : sans accents, en minuscules, camelCase défait, `%` et `€` lus comme des mots.
  function wordsOf(name) {
    return String(name == null ? '' : name)
      .replace(/%/g, ' pct ')
      .replace(/€/g, ' eur ')
      .replace(/\$/g, ' usd ')
      .replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, '$1 $2')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1);
  }

  // Un mot sans son pluriel, son féminin ou son accord : « clients » -> « client », « commerciale » -> « commercial », « totaux » -> « total ».
  function stems(word) {
    const out = [];
    if (word.length > 3 && /aux$/.test(word)) out.push(word.slice(0, -3) + 'al');
    ['s', 'x', 'es', 'e', 'ee', 'ees'].forEach((suffix) => {
      if (word.length > suffix.length + 2 && word.slice(-suffix.length) === suffix) out.push(word.slice(0, -suffix.length));
    });
    return out;
  }

  // Un mot collé coupé en mots connus (« montantht » -> montant + ht) : au plus trois morceaux, chacun connu, les courts (moins de 4 lettres) pris dans
  // SHORT seulement, au moins un morceau de 4 lettres ou plus. Rend la liste des morceaux, ou null.
  function split(word) {
    if (word.length < 6) return null;
    const known = (piece) => (KIND_OF.has(piece) || TAGS_OF.has(piece)) && (piece.length >= 4 || SHORT.has(piece));
    function walk(from, parts) {
      if (from === word.length) return parts.some((p) => p.length >= 4) ? parts : null;
      if (parts.length >= 3) return null;
      for (let end = word.length; end > from + 1; end--) {
        const piece = word.slice(from, end);
        if (!known(piece)) continue;
        const found = walk(end, parts.concat(piece));
        if (found) return found;
      }
      return null;
    }
    const found = walk(0, []);
    return found && found.length >= 2 ? found : null;
  }

  // Le mot connu le plus proche d'un mot FAUTIF, ou null. UNE faute de 5 à 8 lettres, deux seulement entre deux mots d'au moins 9 lettres (« pression » et
  // « profession » sont à deux fautes l'un de l'autre, pas « satisfaction » et « satisfation ») ; jamais la première lettre ; jamais quand deux sortes
  // différentes se disputent le mot à égale distance.
  function nearest(word) {
    if (word.length < 5) return null;
    const limit = word.length >= 9 ? 2 : 1;
    let best = null;
    let bestDistance = limit + 1;
    let ambiguous = false;
    // La première lettre doit être la même, ou les deux premières échangées (« ealisé » n'est pas une faute, « rpix » en est une).
    const firsts = [word.charAt(0)];
    if (word.length > 1) firsts.push(word.charAt(1));
    firsts.forEach((first, index) => {
      (FUZZY.get(first) || []).forEach((candidate) => {
        if (index === 1 && !(candidate.charAt(0) === word.charAt(1) && candidate.charAt(1) === word.charAt(0))) return;
        if (index === 1 && candidate.charAt(0) === word.charAt(0)) return;
        // Deux fautes ne se tolèrent qu'entre deux mots longs (« commande » n'est pas une faute de « commune »).
        const d = distance(word, candidate, candidate.length >= 9 ? limit : Math.min(limit, 1));
        if (d > limit || (d === 2 && candidate.length < 9)) return;
        if (d < bestDistance) { best = candidate; bestDistance = d; ambiguous = false; }
        else if (d === bestDistance && best !== candidate && KIND_OF.get(candidate) !== KIND_OF.get(best)) ambiguous = true;
      });
    });
    return (best && !ambiguous) ? best : null;
  }

  // Ce que dit UN mot : `{ kinds: [sortes], tags: [étiquettes], near }`, ou null s'il est inconnu. Les mots neutres ne disent rien mais sont connus (`known: true`).
  function lookup(word) {
    if (STOP.has(word)) return { stop: true, kinds: [], tags: [], near: false };
    if (KIND_OF.has(word)) return { kinds: [KIND_OF.get(word)], tags: TAGS_OF.get(word) || [], near: false };
    if (TAGS_OF.has(word)) return { kinds: [], tags: TAGS_OF.get(word), near: false };
    if (NEUTRAL.has(word)) return { kinds: [], tags: [], near: false, neutral: true };
    const stem = stems(word).find((s) => KIND_OF.has(s));
    if (stem) return { kinds: [KIND_OF.get(stem)], tags: TAGS_OF.get(stem) || [], near: true };
    const pieces = split(word);
    if (pieces) {
      const kinds = [];
      const tags = [];
      pieces.forEach((p) => { if (KIND_OF.has(p)) kinds.push(KIND_OF.get(p)); (TAGS_OF.get(p) || []).forEach((t) => tags.push(t)); });
      return { kinds, tags, near: true };
    }
    const close = nearest(word);
    if (close) return { kinds: [KIND_OF.get(close)], tags: TAGS_OF.get(close) || [], near: true };
    return null;
  }

  const cache = new Map();
  const CACHE_LIMIT = 4000;

  /**
   * Ce qu'annonce le nom d'une colonne. Rend `{ kind, tags, words, extra, near }` :
   *   kind  — la sorte la plus précise (voir PRIORITY), '' quand le nom ne dit rien ;
   *   tags  — `target`, `start`, `end`, `stage`, `month`, `week`, `day`, `quarter`, `semester`, `year`, `unit` quand un mot les porte ;
   *   words — les mots du nom (sans accents, en minuscules) ; `extra` — combien le dictionnaire ne connaît pas ; `near` — un mot n'est reconnu qu'à peu près.
   */
  function classify(name) {
    const key = String(name == null ? '' : name);
    if (cache.has(key)) return cache.get(key);
    const words = wordsOf(key);
    const kinds = new Set();
    const tags = new Set();
    let extra = 0;
    let near = false;
    words.forEach((word) => {
      const found = lookup(word);
      if (!found) { extra++; return; }
      if (found.stop) return;
      if (found.neutral) { extra++; return; }
      found.kinds.forEach((k) => kinds.add(k));
      found.tags.forEach((t) => tags.add(t));
      if (found.near) near = true;
    });
    let kind = PRIORITY.find((k) => kinds.has(k)) || '';
    // Un prix : « Prix » seul, « Prix de vente », « Coût unitaire » ; un mot d'argent fort (« Prix total ») en fait un montant.
    const hasStrong = words.some((w) => STRONG_AMOUNT.has(w) || stems(w).some((s) => STRONG_AMOUNT.has(s)));
    if (kind === 'unitPrice' || kind === 'amount' || kind === 'quantity' || kind === 'avgMeasure') {
      const hasPrice = kinds.has('unitPrice');
      const hasUnitCost = tags.has('unit') && words.some((w) => WEAK_COST.has(w) || stems(w).some((s) => WEAK_COST.has(s)));
      if (!hasStrong && (hasPrice || hasUnitCost) && !kinds.has('rate')) kind = 'unitPrice';
      else if (kinds.has('rate')) kind = 'rate';
      else if (kinds.has('amount') || hasStrong) kind = 'amount';
    }
    if (kind === 'dateWeak') kind = 'date';
    // Le résultat est mis en cache et rendu tel quel à tous les appelants : il est gelé (aucun appelant ne peut le déformer pour les suivants).
    const result = Object.freeze({ kind, tags: Object.freeze(Array.from(tags)), words: Object.freeze(words), extra, near });
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, result);
    return result;
  }

  const kindOf = (name) => classify(name).kind;
  const hasTag = (name, tag) => classify(name).tags.indexOf(tag) !== -1;

  return { classify, kindOf, hasTag, distance, wordsOf, PRIORITY, WORDS, TAGS, NEUTRAL };
});
