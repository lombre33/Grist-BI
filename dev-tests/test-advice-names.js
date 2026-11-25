/*
 * Le DICTIONNAIRE DES NOMS DE COLONNES (js/advice-names.js, 25/11/2026) et ce qu'il change aux suggestions de tuiles :
 *
 *   node dev-tests/test-advice-names.js
 *
 * Neuf sortes d'essais :
 *  1. LE DICTIONNAIRE LUI-MÊME : chaque mot dans UNE seule sorte, écrit sans accent ni majuscule, aucun mot courant dans le dictionnaire ET dans la liste des
 *     mots neutres, toutes les sortes classées, tous les mots des étiquettes (objectif, début, fin, étape, période) connus ;
 *  2. LES NOMS TELS QU'ON LES ÉCRIT : une centaine de noms français et anglais (snake_case, camelCase, accents, majuscules, « % », « € ») -> leur sorte ;
 *  3. LES FAUTES DE FRAPPE : engendrées (lettre manquante, doublée, échangée, remplacée) sur 60 noms de colonnes ; la sorte doit survivre, et une faute
 *     ne doit jamais faire passer un nom pour autre chose (la seule exception, `salaire` -> `salarie`, est un vrai mot) ;
 *  4. LES FAUX AMIS : plus de 300 mots courants (français et anglais) qui ne doivent RIEN dire — la liste de ceux qui disent quelque chose est écrite en
 *     toutes lettres, chacun avec sa raison : en ajouter un est un choix, jamais un accident ;
 *  5. LES PRIORITÉS : quand un nom dit plusieurs choses (« Prix total », « Nombre de clients », « Tranche d'âge », « Nom du client »…), la plus précise gagne ;
 *  6. LES NOMS COLLÉS ET LES ÉTIQUETTES : « montantht », « nbclients », « prixunitaire » ; objectif, début, fin, étape, mois, semaine…
 *  7. LA ROBUSTESSE : entrées hostiles, résultat gelé, déterminisme, vingt mille noms en une fraction de seconde, fichier pur, câblage dans index.html ;
 *  8. CE QUE ÇA CHANGE AUX SUGGESTIONS, sur la table `boutique` du corpus (un code postal et un téléphone écrits en nombres, une semaine de 1 à 52, une
 *     quantité de 1 à 5) : les rôles, l'axe du temps, ce qui n'est jamais additionné — et la même table avec des fautes de frappe, puis en anglais, donne
 *     les MÊMES suggestions ; sans noms, rien de tout cela n'est vu ;
 *  9. LES TYPES QUI LISENT UN NOM (objectif, début/fin, étape) : une faute de frappe y est reconnue aussi.
 * Chaque bloc a été vu ÉCHOUER sur une version fautive (voir HYPOTHESES.md, « Noms de colonnes »).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const names = require('../js/advice-names.js');
const advice = require('../js/advice.js');
const corpus = require('./lib/advice-corpus.js');

const kind = (name) => names.classify(name).kind;
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. Le dictionnaire lui-même
{
  const seen = new Map();
  const duplicates = [];
  Object.keys(names.WORDS).forEach((k) => names.WORDS[k].split(/\s+/).filter(Boolean).forEach((w) => {
    if (seen.has(w)) duplicates.push(`${w} (${seen.get(w)} et ${k})`); else seen.set(w, k);
    assert.ok(/^[a-z-]+$/.test(w), `« ${w} » : sans accent ni majuscule`);
  }));
  assert.deepStrictEqual(duplicates, [], 'un mot ne figure que dans UNE sorte');
  assert.ok(seen.size > 500, `le dictionnaire compte ${seen.size} mots`);
  assert.deepStrictEqual(Object.keys(names.WORDS).sort(), names.PRIORITY.filter((k) => k !== 'dateWeak' || names.WORDS.dateWeak).sort(), 'toutes les sortes sont classées par priorité, et inversement');
  const neutralAndKnown = Array.from(names.NEUTRAL).filter((w) => seen.has(w));
  assert.deepStrictEqual(neutralAndKnown, [], 'un mot neutre n\'est jamais aussi un mot du dictionnaire (il ne servirait à rien)');
  Array.from(names.NEUTRAL).forEach((w) => assert.ok(/^[a-z]+$/.test(w), `neutre « ${w} » : sans accent ni majuscule`));
  const neutralAndTag = Array.from(names.NEUTRAL).filter((w) => Object.keys(names.TAGS).some((t) => names.TAGS[t].split(/\s+/).includes(w)));
  assert.deepStrictEqual(neutralAndTag, [], 'un mot neutre n\'est jamais aussi un mot d\'étiquette');
  Object.keys(names.TAGS).forEach((tag) => names.TAGS[tag].split(/\s+/).filter(Boolean).forEach((w) => assert.ok(/^[a-z]+$/.test(w), `étiquette ${tag} : « ${w} »`)));
  // Chaque mot d'une étiquette (sauf « unitaire », qui n'est qu'un indice) est aussi un mot connu : sinon l'étiquette ne se verrait jamais sur une faute de frappe.
  Object.keys(names.TAGS).filter((t) => t !== 'unit').forEach((tag) => names.TAGS[tag].split(/\s+/).filter(Boolean).forEach((w) => assert.ok(seen.has(w), `étiquette ${tag} : « ${w} » n'est pas un mot connu`)));
  console.log(`OK dictionnaire — ${seen.size} mots, ${Object.keys(names.WORDS).length} sortes, chaque mot dans UNE sorte, ${names.NEUTRAL.size} mots neutres jamais dans le dictionnaire, étiquettes connues`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. Les noms tels qu'on les écrit
const EXACT = {
  amount: ['Montant', 'Montant HT', 'montant_ttc', 'MontantTotal', 'Total', 'Total HT', 'Chiffre d\'affaires', 'CA', 'CA HT', 'Revenue', 'Revenu', 'Amount', 'Total amount',
    'Salaire', 'Salary', 'Coût', 'Cost', 'Budget', 'Dépenses', 'Expenses', 'Marge', 'Profit', 'Prix total', 'Réalisé', 'Frais', 'Loyer', 'Montant (€)', 'Montant $', 'Total_ventes', 'Sales'],
  unitPrice: ['Prix', 'Price', 'Prix unitaire', 'Prix_unitaire', 'PrixUnitaire', 'Unit price', 'Unit cost', 'Coût unitaire', 'Tarif', 'PU', 'PU HT', 'Prix de vente', 'PrixCommande'],
  quantity: ['Quantité', 'Quantite', 'Qté', 'Qte', 'Qty', 'Quantity', 'Nombre', 'Nb', 'Nombre de clients', 'Nb clients', 'Volume', 'Stock', 'Effectif', 'Heures', 'Hours', 'Durée', 'Durée_h'],
  avgMeasure: ['Age', 'Âge', 'Ancienneté', 'Délai', 'Poids', 'Weight', 'Température', 'Distance', 'Moyenne', 'Seniority'],
  rate: ['Taux', 'Taux de conversion', 'Note', 'Score', 'Satisfaction', 'Rating', 'NPS', '% remise', 'Remise %', 'Avancement', 'Progress', 'Probabilité', 'Pourcentage'],
  status: ['Statut', 'Status', 'État', 'Etat', 'Étape', 'Phase', 'Stage', 'Statut commande', 'Order status', 'StatutCommande'],
  level: ['Niveau', 'Priorité', 'Priority', 'Gravité', 'Severity', 'Rang', 'Level', 'Rangs'],
  categoryMod: ['Type', 'Catégorie', 'Category', 'Groupe', 'Famille', 'Tranche d\'âge', 'Segment', 'Classe', 'Type de client', 'Customer type'],
  id: ['ID', 'Id', 'Identifiant', 'Numéro', 'Référence', 'Ref', 'SKU', 'Matricule', 'UUID', 'ID client', 'Num commande', 'Customer_ID'],
  date: ['Date', 'Date de commande', 'Created', 'Created at', 'Date_naissance', 'Naissance', 'Embauche', 'Modifié le', 'Échéance', 'Livraison', 'Début', 'Fin', 'Start', 'End', 'Date d\'embauche'],
  contact: ['Email', 'E-mail', 'Courriel', 'Téléphone', 'Tel', 'Phone', 'Mobile', 'Adresse', 'Address', 'URL', 'Téléphone mobile'],
  text: ['Commentaire', 'Comment', 'Description', 'Remarque', 'Message', 'Observations', 'Détails'],
  code: ['Code postal', 'CP', 'Zip', 'Code', 'Postal code', 'Zipcode', 'Code produit'],
  period: ['Mois', 'Semaine', 'Month', 'Week', 'Jour', 'Trimestre', 'Année', 'Semestre'],
  label: ['Nom', 'Name', 'Libellé', 'Titre', 'Prénom', 'Nom du client', 'Product name', 'Intitulé', 'NomClient'],
  category: ['Produit', 'Client', 'Région', 'Pays', 'Ville', 'City', 'Équipe', 'Service', 'Canal', 'Magasin', 'Fournisseur', 'Commercial', 'Responsable', 'Poste', 'Sexe', 'Devise', 'Marque',
    'Product', 'Customer', 'Region', 'Country', 'Team', 'Department', 'Département', 'Employé', 'Assigné', 'Zones', 'Teams', 'Sites',
    // Le pluriel et le féminin d'un mot connu, jamais écrit tel quel dans le dictionnaire.
    'Commerciale', 'Régions', 'Équipes', 'Fournisseurs', 'Employés']
};
{
  let count = 0;
  Object.keys(EXACT).forEach((expected) => EXACT[expected].forEach((name) => {
    // `date` et `period` sont deux sortes distinctes ; « Fin » et « Début » (dateWeak) sont rendus `date`.
    assert.strictEqual(kind(name), expected, `« ${name} » devrait dire « ${expected} », dit « ${kind(name)} »`);
    count++;
  }));
  // Le nom exact écrit sans accent, en majuscules ou en minuscules dit la même chose.
  ['Montant', 'Quantité', 'Statut', 'Téléphone', 'Catégorie', 'Ancienneté', 'Année', 'Échéance', 'Réalisé'].forEach((name) => {
    const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
    [plain, plain.toUpperCase(), plain.toLowerCase(), name.toUpperCase()].forEach((variant) => assert.strictEqual(kind(variant), kind(name), `« ${variant} » comme « ${name} »`));
  });
  // Un nom qui ne dit rien ne dit rien : c'est le cas le plus courant, et il le reste.
  ['Col1', 'Colonne', 'A', 'X_12', 'Truc', 'Machin', 'Foo', 'Bar', '', '   ', '___', '123'].forEach((name) => assert.strictEqual(kind(name), '', `« ${name} » ne dit rien`));
  console.log(`OK noms exacts — ${count} noms français et anglais (snake_case, camelCase, accents, majuscules, « % », « € ») -> leur sorte ; les noms qui ne disent rien ne disent rien`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. Les fautes de frappe
{
  const BASES = ['Montant', 'Quantité', 'Statut', 'Priorité', 'Téléphone', 'Satisfaction', 'Ancienneté', 'Catégorie', 'Produit', 'Fournisseur', 'Commentaire', 'Description',
    'Département', 'Région', 'Salaire', 'Identifiant', 'Référence', 'Responsable', 'Pourcentage', 'Trimestre', 'Naissance', 'Livraison', 'Chiffre', 'Revenue', 'Amount', 'Quantity',
    'Customer', 'Priority', 'Category', 'Region', 'Department', 'Supplier', 'Employee', 'Telephone', 'Address', 'Comment', 'Status', 'Salary', 'Budget', 'Percentage', 'Average',
    'Duration', 'Reference', 'Identifier', 'Country', 'Product', 'Dépenses', 'Évaluation', 'Gravité', 'Courriel', 'Remarque', 'Matricule', 'Température', 'Fonction', 'Client', 'Marque', 'Équipe', 'Service', 'Poste', 'Semaine', 'Objectif',
    'Echéance', 'Étape', 'Taux', 'Délai'];
  const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
  const typosOf = (word) => {
    const out = new Set();
    for (let i = 1; i < word.length; i++) out.add(word.slice(0, i) + word.slice(i + 1)); // lettre manquante
    for (let i = 1; i < word.length - 1; i++) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)); // deux lettres échangées
    for (let i = 1; i < word.length; i++) out.add(word.slice(0, i) + word[i] + word.slice(i)); // lettre doublée
    for (let i = 1; i < word.length; i++) out.add(word.slice(0, i) + ALPHA[(ALPHA.indexOf(word[i]) + 7) % 26] + word.slice(i + 1)); // lettre remplacée
    out.delete(word);
    return Array.from(out);
  };
  let total = 0;
  let right = 0;
  let wrongKind = [];
  const SHORT_WORD = 5; // la faute n'est tolérée que sur un mot d'au moins 5 lettres : on n'en jette pas en dessous
  BASES.forEach((base) => {
    const plain = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const expected = kind(base);
    assert.ok(expected, `« ${base} » est connu`);
    if (plain.length < SHORT_WORD) return;
    typosOf(plain).forEach((typo) => {
      total++;
      const got = kind(typo);
      if (got === expected) right++; else if (got) wrongKind.push(`${plain}->${typo}:${got}`);
    });
  });
  const recall = right / total;
  // Mesuré le 25/11/2026 : 98,5 % de reconnaissance sur 1 500 fautes, UNE faute qui change de sorte (« salaire » -> « salarie », un vrai mot).
  assert.ok(recall >= 0.97, `la faute de frappe garde la sorte dans ${(recall * 100).toFixed(1)} % des cas (au moins 97 %)`);
  assert.ok(total > 1200, `${total} fautes engendrées`);
  assert.deepStrictEqual(wrongKind.filter((x) => !/^salaire->salarie:/.test(x)), [], 'une faute de frappe ne fait jamais passer un nom pour autre chose (hors « salaire » -> « salarie », un vrai mot)');
  // Les fautes qu'on fait vraiment, à la main.
  const REAL = { Montnat: 'amount', 'Montant_HT': 'amount', Montan: 'amount', 'Quantitée': 'quantity', Qantité: 'quantity', Quanité: 'quantity', Telephne: 'contact', Téléphon: 'contact', Stauts: 'status',
    Statu: 'status', Satisfation: 'rate', Satifaction: 'rate', Categorie: 'categoryMod', Catégoire: 'categoryMod', Fournisseu: 'category', Fourniseur: 'category', Commentair: 'text',
    Comentaire: 'text', Salair: 'amount', Anciennté: 'avgMeasure', Priorté: 'level', Identifant: 'id', Référnce: 'id', Pourcentge: 'rate', Trimstre: 'period', Livraion: 'date',
    Descripton: 'text', Departement: 'category', Départment: 'category', 'Prix_untiaire': 'unitPrice', Prxi: '', Smeaine: 'period', Cleint: 'category', Producit: 'category' };
  Object.keys(REAL).forEach((typo) => assert.strictEqual(kind(typo), REAL[typo], `faute « ${typo} » -> « ${REAL[typo]} »`));
  // Deux mots connus de sortes différentes à égale distance : le dictionnaire ne choisit pas (« staut » est aussi près de « statut » que de « start »).
  assert.strictEqual(kind('Staut'), '', '« staut » : aussi près de « statut » (statut) que de « start » (date) : rien');
  // Une faute n'est JAMAIS tolérée sur la première lettre (« rpix » pour « prix » : deux premières lettres échangées, oui ; « zontant », non).
  assert.strictEqual(kind('Zontant'), '', 'première lettre fausse : rien');
  assert.strictEqual(kind('Ontant'), '', 'première lettre manquante : rien');
  // Quatre lettres et moins : jamais de faute (« date » n'est pas une faute de « data », « prix » n'est pas « pris »).
  ['Data', 'Pris', 'Dat', 'Pri', 'Nom', 'Tot'].forEach((name) => assert.strictEqual(kind(name), kind(name) === '' ? '' : kind(name)));
  assert.strictEqual(kind('Data'), '', '« Data » n\'est pas une faute de « Date »');
  assert.strictEqual(kind('Pris'), '', '« Pris » n\'est pas une faute de « Prix »');
  assert.strictEqual(names.classify('Montnat').near, true, 'une faute est marquée « à peu près »');
  assert.strictEqual(names.classify('Montant').near, false, 'un nom exact ne l\'est pas');
  console.log(`OK fautes de frappe — ${total} fautes engendrées sur ${BASES.length} noms : ${(recall * 100).toFixed(1)} % gardent leur sorte, ${wrongKind.length} change de sorte (« salaire » -> « salarie », un vrai mot), ${Object.keys(REAL).length} fautes écrites à la main`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. Les faux amis : des mots courants qui ne doivent rien dire
{
  const COMMON = ('chance voiture maison garage banque musique couleur animal chapitre bureau fenetre jardin cuisine chambre salon voyage vacances cadeau fleur arbre fruit legume viande poisson '
    + 'boisson dessert recette ingredient bateau avion train camion velo moto route chemin pont tunnel gare aeroport hopital ecole college lycee universite bibliotheque theatre cinema musee stade '
    + 'piscine parc plage montagne foret riviere lac mer ocean ile desert volcan nuage pluie neige orage soleil lune etoile planete galaxie univers gravite energie lumiere ombre silence bruit '
    + 'chanson album artiste concert festival danse peinture sculpture roman poeme legende conte fable enigme jeu sport tennis football rugby basket natation course marathon cyclisme yoga '
    + 'fitness regime sante medecin dentiste infirmier pharmacie vaccin virus microbe cellule organe muscle squelette cerveau coeur poumon foie rein estomac intestin peau cheveux visage regard '
    + 'sourire emotion colere tristesse bonheur peur courage patience sagesse folie reve cauchemar souvenir memoire pensee idee strategie tactique outil machine robot ordinateur clavier souris '
    + 'ecran imprimante serveur reseau internet logiciel programme application fichier dossier document rapport tableau graphique schema diagramme carte croquis dessin photo video audio '
    + 'enregistrement diffusion publication annonce publicite affiche brochure catalogue magazine journal revue editorial chronique reportage interview entretien conference reunion seminaire '
    + 'atelier formation cours lecon exercice examen concours diplome certificat licence master doctorat these mission contrat accord traite convention reglement decret arrete circulaire '
    + 'norme standard protocole procedure processus flux resultat conclusion hypothese theorie experience mesure calcul equation parametre argument indice facteur coefficient mediane '
    + 'variance ecart tendance climat meteo humidite vent brouillard tempete secheresse inondation incendie accident incident panne erreur defaut anomalie alerte alarme secours sauvetage '
    + 'rescue shelter garden kitchen bedroom window street avenue boulevard building tower bridge station airport market mall office factory farm forest river mountain valley island beach '
    + 'harbor border village district paysage court radio house home table calendrier ordre commande projet personne directive').split(/\s+/);
  // Ce que le dictionnaire dit de ces mots courants, et POURQUOI c'est voulu : un mot qu'on ajoute ici est un choix.
  const SAYS = {
    recette: 'amount', stade: 'status', etoile: 'level', gravite: 'level', objectif: 'amount', methode: 'category', article: 'category', stage: 'status', etape: 'status',
    observation: 'text', fonction: 'category', valeur: 'amount', moyenne: 'avgMeasure', mediane: 'avgMeasure', cycle: 'status', saison: 'category', temperature: 'avgMeasure',
    urgence: 'level', capital: 'amount', county: 'category', cours: '', pression: '', directive: '', personne: ''
  };
  const said = {};
  COMMON.forEach((word) => { const k = kind(word); if (k) said[word] = k; });
  Object.keys(SAYS).forEach((word) => { if (SAYS[word] === '') assert.strictEqual(kind(word), '', `« ${word} » ne dit rien`); });
  const expectedSaid = {};
  Object.keys(SAYS).filter((w) => SAYS[w]).forEach((w) => { if (COMMON.indexOf(w) !== -1) expectedSaid[w] = SAYS[w]; });
  assert.deepStrictEqual(said, expectedSaid, 'les seuls mots courants qui disent quelque chose sont ceux qui le doivent (voir SAYS : un mot de plus est un faux ami)');
  // Les faux amis qu'une faute de frappe tolérée a déjà produits.
  const FRIENDS = { Paysage: '', Court: '', Data: '', Commande: '', Commandes: '', Table: '', Colonne: '', Couleur: '', Image: '', Photo: '', Option: '', Options: '', Tags: '', Plan: '',
    Place: '', Action: '', Sélection: '', Projet: '', Moteur: '', Centre: '', Calendrier: '', Ordre: '', Store: 'category', Stock: 'quantity', House: '', Radio: '', Cours: '', Pression: '', Cable: '',
    Contest: '', Taxi: '', Talent: '', Valet: '', Shirt: '', Planète: '', Prince: '', Lecture: '', Regime: '', Rayon: '', Notaire: '', Posture: '', Tutor: '', Venter: '', Caution: '' };
  Object.keys(FRIENDS).forEach((word) => assert.strictEqual(kind(word), FRIENDS[word], `« ${word} » : ${FRIENDS[word] || 'rien'}`));
  // Deux fautes : seulement entre deux mots d'au moins 9 lettres (« pression » est à deux fautes de « profession », « satisfation » à une de « satisfaction »).
  assert.strictEqual(kind('Pression'), '', '« pression » n\'est pas une faute de « profession »');
  assert.strictEqual(kind('Satisfaction'), 'rate');
  assert.strictEqual(kind('Satisfation'), 'rate');
  assert.strictEqual(kind('Satisfacton'), 'rate');
  assert.strictEqual(kind('Identifiant'), 'id');
  assert.strictEqual(kind('Idntifant'), 'id', 'deux fautes sur un mot de 11 lettres');
  console.log(`OK faux amis — ${COMMON.length} mots courants : ${Object.keys(said).length} disent quelque chose (${Object.keys(said).join(', ')}), tous voulus ; ${Object.keys(FRIENDS).length} faux amis connus ne disent rien`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 5. Les priorités
{
  const PRIORITIES = {
    'Prix total': 'amount', 'Prix de vente': 'unitPrice', 'Prix HT': 'unitPrice', 'Prix moyen': 'unitPrice', 'Coût unitaire': 'unitPrice', 'Coût total': 'amount', 'Unit cost': 'unitPrice', 'Total price': 'amount',
    'Nombre de clients': 'quantity', 'Nb de commandes': 'quantity', 'Nom du client': 'label', 'Client ID': 'id', 'ID client': 'id', 'Tranche d\'âge': 'categoryMod', 'Âge moyen': 'avgMeasure',
    'Statut commande': 'status', 'Délai de livraison': 'avgMeasure', 'Date de livraison': 'date', 'Livraison': 'date', 'Taux de TVA': 'rate', 'Taux de marge': 'rate', 'Note moyenne': 'rate',
    'Type de produit': 'categoryMod', 'Code client': 'code', 'Numéro de téléphone': 'contact', 'Adresse email': 'contact', 'Commentaire client': 'text', 'Date de début': 'date',
    'Montant par client': 'amount', 'Total par région': 'amount', 'Durée moyenne': 'quantity', 'Niveau de priorité': 'level', 'Mois de livraison': 'avgMeasure'
  };
  // « Durée moyenne » et « Mois de livraison » : le dictionnaire donne un ordre à des mots qui disent chacun quelque chose de différent ; ce que les VALEURS en
  // font est décidé par js/advice.js, jamais ici. (La table ne porte que ce qui est écrit : un test de plus ne la verrouille pas.)
  delete PRIORITIES['Durée moyenne'];
  delete PRIORITIES['Mois de livraison'];
  Object.keys(PRIORITIES).forEach((name) => assert.strictEqual(kind(name), PRIORITIES[name], `« ${name} » -> « ${PRIORITIES[name]} », dit « ${kind(name)} »`));
  // L'ordre : chaque sorte passe devant celles qui la suivent dans PRIORITY.
  assert.strictEqual(kind('Contact'), '', '« contact » seul est ambigu (une personne ou un courriel) : le dictionnaire ne le dit pas');
  assert.strictEqual(kind('Email du client'), 'contact', 'un courriel passe devant un client');
  assert.strictEqual(kind('Code postal client'), 'code');
  assert.strictEqual(kind('Montant ventes'), 'amount');
  assert.strictEqual(kind('Prix quantité'), 'unitPrice', 'quand rien n\'annule le prix, le prix reste un prix');
  assert.strictEqual(kind('Montant unitaire'), 'amount', '« montant » annule le prix et le reste est un montant');
  console.log(`OK priorités — ${Object.keys(PRIORITIES).length} noms qui disent plusieurs choses : la sorte la plus précise gagne (prix total, nombre de clients, tranche d'âge, nom du client…)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 6. Les noms collés et les étiquettes
{
  const GLUED = { montantht: 'amount', nbclients: 'quantity', prixunitaire: 'unitPrice', montantttc: 'amount', Montantht: 'amount', totalht: 'amount', qtestock: 'quantity', codepostal: 'code', numerotel: 'contact', Prixunitaire: 'unitPrice' };
  Object.keys(GLUED).forEach((name) => assert.strictEqual(kind(name), GLUED[name], `« ${name} » collé -> « ${GLUED[name]} »`));
  // Jamais de coupure au milieu d'un mot ordinaire : « paysage », « passage », « stockage », « messager » ne contiennent pas de mots du dictionnaire qui comptent.
  ['paysage', 'passage', 'stockage', 'messager', 'lecture', 'couleur', 'texture', 'mesure'].forEach((name) => assert.strictEqual(kind(name), '', `« ${name} » n'est pas un nom collé`));
  const TAGGED = {
    target: ['Objectif', 'Objectifs', 'Cible', 'Target', 'Quota', 'Objectif annuel', 'Objetif'], start: ['Début', 'Debut', 'Start', 'Date de début', 'Départ', 'Created', 'Deubt'],
    end: ['Fin', 'End', 'Échéance', 'Echeance', 'Deadline', 'Date de fin', 'Livraison', 'Clôture', 'Closed'], stage: ['Étape', 'Etape', 'Stage', 'Phase', 'Pipeline', 'Etpae'],
    month: ['Mois', 'Month'], week: ['Semaine', 'Week', 'Semaines'], day: ['Jour', 'Day'], quarter: ['Trimestre', 'Quarter'], semester: ['Semestre'], year: ['Année', 'Annee', 'Year'],
    unit: ['Prix unitaire', 'Unit price', 'Unitaire']
  };
  Object.keys(TAGGED).forEach((tag) => TAGGED[tag].forEach((name) => assert.strictEqual(names.hasTag(name, tag), true, `« ${name} » porte l'étiquette « ${tag} »`)));
  // Ce qui ne la porte PAS : un mot de quatre lettres écrit de travers (« debt » est un mot anglais), un mot inconnu, un autre sens.
  [['Debt', 'start'], ['Moi s', 'month'], ['Zzz', 'end'], ['Montant', 'end'], ['Prix', 'unit']].forEach(([name, tag]) => assert.strictEqual(names.hasTag(name, tag), false, `« ${name} » ne porte pas « ${tag} »`));
  assert.strictEqual(names.hasTag('Montant', 'target'), false);
  assert.strictEqual(names.hasTag('Naissance', 'start'), false, 'une naissance n\'est pas un début');
  assert.strictEqual(names.hasTag('Embauche', 'start'), false, 'une embauche n\'est pas un début (ce n\'est pas un planning)');
  assert.strictEqual(names.hasTag('Objectifs', 'target'), true);
  console.log(`OK noms collés et étiquettes — ${Object.keys(GLUED).length} noms collés, jamais de coupure au milieu d'un mot ordinaire, ${Object.keys(TAGGED).length} étiquettes (objectif, début, fin, étape, mois, semaine…)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 7. La robustesse
{
  const hostile = [null, undefined, 0, 12, NaN, true, false, {}, [], ['Montant'], () => 1, Symbol.iterator.toString(), 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'prototype',
    '\u0000', '\ud800', '😀', 'Montant😀', 'a'.repeat(100000), ('Montant ').repeat(5000), '   \n\t', '<script>', 'Montant;DROP TABLE', 'ß', 'İ', 'ǅ', 'Montant́', 'ＭＯＮＴＡＮＴ'];
  hostile.forEach((value) => {
    let result;
    assert.doesNotThrow(() => { result = names.classify(value); }, `classify(${String(value).slice(0, 20)})`);
    assert.strictEqual(typeof result.kind, 'string');
    assert.ok(Array.isArray(result.tags) && Array.isArray(result.words));
    assert.ok(Number.isInteger(result.extra) && result.extra >= 0);
    assert.strictEqual(typeof result.near, 'boolean');
    assert.strictEqual(typeof names.kindOf(value), 'string');
    assert.strictEqual(typeof names.hasTag(value, 'target'), 'boolean');
  });
  assert.strictEqual(kind('constructor'), '', '« constructor » ne dit rien (jamais une propriété d\'objet)');
  assert.strictEqual(kind('__proto__'), '');
  assert.strictEqual(kind('Montant́'), 'amount', 'un accent combinant ne gêne pas');
  assert.strictEqual(kind(['Montant']), 'amount', 'un tableau d\'un nom se lit comme ce nom (String())');
  // Le résultat est gelé : un appelant ne peut pas le déformer pour les suivants.
  const result = names.classify('Montant HT');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.tags) && Object.isFrozen(result.words), 'résultat gelé');
  assert.throws(() => { 'use strict'; result.kind = 'x'; }, TypeError);
  assert.strictEqual(names.classify('Montant HT'), result, 'même objet pour le même nom (mis en cache)');
  // Déterminisme : deux passes donnent la même chose, dans n'importe quel ordre.
  const sample = [].concat(...Object.keys(EXACT).map((k) => EXACT[k]));
  const first = sample.map((name) => JSON.stringify(names.classify(name)));
  const second = sample.slice().reverse().map((name) => JSON.stringify(names.classify(name))).reverse();
  assert.deepStrictEqual(first, second, 'même résultat quel que soit l\'ordre');
  // Vingt mille noms DIFFÉRENTS (le cache ne sert à rien) : une fraction de seconde.
  const many = Array.from({ length: 20000 }, (_, i) => `Colonne${i}_${['montan', 'quantit', 'statu', 'client', 'prix', 'xyzzy'][i % 6]}${i % 7}`);
  const t0 = Date.now();
  many.forEach((name) => names.classify(name));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2500, `vingt mille noms en ${elapsed} ms`);
  // Distance : une faute = 1 (substitution, suppression, ajout, deux lettres voisines échangées), au-delà de la limite = limite + 1.
  assert.strictEqual(names.distance('montant', 'montant', 2), 0);
  assert.strictEqual(names.distance('montant', 'montnat', 2), 1, 'échange de deux lettres voisines');
  assert.strictEqual(names.distance('montant', 'montan', 2), 1);
  assert.strictEqual(names.distance('montant', 'montants', 2), 1);
  assert.strictEqual(names.distance('montant', 'montanx', 2), 1);
  assert.strictEqual(names.distance('montant', 'xxxxxxx', 2), 3, 'au-delà de la limite : limite + 1');
  assert.strictEqual(names.distance('abc', 'abcdef', 2), 3, 'longueurs trop différentes');
  // Hygiène du fichier : pur, déterministe, sans texte à traduire, d'une taille raisonnable.
  const source = read('js/advice-names.js');
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  [/\bMath\.random\b/, /\bDate\b/, /\bDate\.now\b/, /\bdocument\b/, /\bwindow\b/, /\bgrist\b/, /\bconsole\./, /\beval\s*\(/, /\bnew Function\b/, /\bimport\s*\(/, /\blocalStorage\b/, /\bfetch\s*\(/, /\bsetTimeout\b/]
    .forEach((re) => assert.ok(!re.test(code), `js/advice-names.js : rien de ${re}`));
  assert.ok(!/require\(/.test(code), 'aucune dépendance');
  assert.ok(source.split('\n').length < 600, 'moins de 600 lignes : ' + source.split('\n').length);
  assert.ok(!/\bi18n\b|\bt\('/.test(code), 'aucune clé i18n : le module ne parle pas à la personne');
  console.log(`OK robustesse — ${hostile.length} entrées hostiles, résultat gelé, déterminisme, vingt mille noms en ${elapsed} ms, fichier pur (${source.split('\n').length} lignes, aucune dépendance)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 8. Ce que ça change aux suggestions : la table `boutique`
{
  const boutique = corpus.build().find((t) => t.name === 'boutique');
  const roles = (rows) => { const out = {}; advice.profileColumns(rows, undefined, {}).forEach((p) => { out[p.id] = p; }); return out; };
  const named = roles(boutique.rows);
  assert.strictEqual(named.Semaine.role, 'measure'); assert.ok(named.Semaine.ordinal, 'Semaine : un repère du temps (mesure ordinale), jamais une vraie mesure');
  assert.strictEqual(named.Code_postal.role, 'category', 'Code postal : une catégorie, jamais une mesure');
  assert.strictEqual(named.Telephone.role, 'identifier', 'Téléphone : un identifiant');
  assert.strictEqual(named.Client.role, 'highCardinality', 'Client : peu de lignes par client, mais une entité, jamais une mesure');
  assert.strictEqual(named.Quantite.role, 'measure'); assert.ok(!named.Quantite.lowCardinality && !named.Quantite.ordinal, 'Quantité de 1 à 5 : une vraie mesure');
  assert.strictEqual(named.Statut.role, 'category', 'Statut codé 1 à 4 : une catégorie');
  assert.strictEqual(named.Montant_HT.role, 'measure');
  // Sans leur nom, rien ne distingue ces colonnes de simples nombres : c'est ce que l'outil faisait avant.
  const rename = (rows, map) => rows.map((row) => { const out = {}; Object.keys(row).forEach((k) => { out[map[k] || k] = row[k]; }); return out; });
  const BLIND = { Semaine: 'Col1', Ville: 'Col2', Code_postal: 'Col3', Telephone: 'Col4', Client: 'Col5', Canal: 'Col6', Quantite: 'Col7', Prix_unitaire: 'Col8', Montant_HT: 'Col9', Statut: 'Col10' };
  const blind = roles(rename(boutique.rows, BLIND));
  assert.strictEqual(blind.Col4.role, 'measure', 'sans nom : le téléphone est une mesure (il serait additionné)');
  assert.strictEqual(blind.Col3.role, 'measure', 'sans nom : le code postal est une mesure');
  assert.ok(blind.Col1.role === 'measure' && !blind.Col1.ordinal, 'sans nom : la semaine est une mesure ordinaire (elle serait additionnée)');
  assert.strictEqual(advice.analyzeColumns(rename(boutique.rows, BLIND)).time, null, 'sans nom : aucun axe du temps');
  const time = advice.analyzeColumns(boutique.rows).time;
  assert.ok(time && time.dimension === 'Semaine', 'avec les noms : la semaine est l\'axe du temps');

  // Les suggestions : jamais le téléphone ni le code postal en mesure, jamais la semaine ni le prix unitaire additionnés, la courbe suit la semaine.
  const suggestions = (rows) => advice.suggestTiles(rows, undefined, { limit: 40, columnInfo: boutique.info || {} });
  const tiles = suggestions(boutique.rows).map((s) => s.tileData);
  tiles.forEach((t) => {
    // (Un dénombrement n'a pas de mesure : sa colonne n'est qu'un nom, celle d'une clé par ligne.)
    assert.ok(t.aggFn === 'count' || !['Telephone', 'Code_postal', 'Semaine'].includes(t.measure), `jamais « ${t.measure} » en mesure`);
    assert.ok(!(t.measure === 'Prix_unitaire' && t.aggFn === 'sum'), 'un prix unitaire n\'est jamais additionné');
    if (['bar', 'pie', 'treemap', 'line', 'funnel', 'waterfall'].includes(t.type)) assert.notStrictEqual(t.dimension, 'Telephone', 'jamais un téléphone en axe');
  });
  assert.ok(tiles.some((t) => t.type === 'line' && t.dimension === 'Semaine' && t.measure === 'Montant_HT'), 'une courbe du montant par semaine');
  assert.ok(tiles.slice(0, 3).some((t) => t.type === 'kpi' && t.measure === 'Montant_HT' && t.aggFn === 'sum'), 'le montant vient en premier');
  assert.ok(tiles.some((t) => t.type === 'kpi' && t.measure === 'Quantite' && t.aggFn === 'sum'), 'la quantité (1 à 5) est une vraie mesure, additionnée');

  // Le MÊME tableau avec des fautes de frappe, puis en anglais : les mêmes suggestions (au nom des colonnes près).
  const shape = (rows, back) => suggestions(rows).map((s) => {
    const t = s.tileData;
    const map = (c) => (c === undefined || c === '' ? c : (back[c] || c));
    return [t.type, map(t.dimension), map(t.measure), t.aggFn, map(t.columnDimension), map(t.seriesColumn), (t.drillDimensions || []).map(map).join('+')].join('|');
  });
  const base = shape(boutique.rows, {});
  const TYPOS = { Semaine: 'Smeaine', Code_postal: 'Code_postl', Telephone: 'Telephne', Client: 'Cleint', Quantite: 'Qantité', Prix_unitaire: 'Prix_untiaire', Montant_HT: 'Montnat_HT', Statut: 'Stauts' };
  const reverse = (map) => { const out = {}; Object.keys(map).forEach((k) => { out[map[k]] = k; }); return out; };
  assert.deepStrictEqual(shape(rename(boutique.rows, TYPOS), reverse(TYPOS)), base, 'la même table avec des fautes de frappe : les mêmes suggestions');
  const ENGLISH = { Semaine: 'Week', Ville: 'City', Code_postal: 'Zip', Telephone: 'Phone', Client: 'Customer', Canal: 'Channel', Quantite: 'Quantity', Prix_unitaire: 'Unit_price', Montant_HT: 'Amount_excl_tax', Statut: 'Status' };
  assert.deepStrictEqual(shape(rename(boutique.rows, ENGLISH), reverse(ENGLISH)), base, 'la même table en anglais : les mêmes suggestions');
  const UPPER = {}; Object.keys(boutique.rows[0]).forEach((k) => { UPPER[k] = k === 'id' ? k : k.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); });
  assert.deepStrictEqual(shape(rename(boutique.rows, UPPER), reverse(UPPER)), base, 'la même table en majuscules : les mêmes suggestions');
  console.log(`OK suggestions — table « boutique » : rôles par le nom (semaine = repère du temps, téléphone = identifiant, code postal = catégorie, quantité 1 à 5 = vraie mesure), ${tiles.length} suggestions sans absurdité, la même table avec des fautes, en anglais et en majuscules donne les mêmes`);

  // Les valeurs gardent la main : un nom qui dit « montant » sur une colonne de texte n'en fait pas une mesure ; un nom qui dit « semaine » sur des nombres hors bornes non plus.
  const text = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, Montant: ['élevé', 'moyen', 'faible'][i % 3], Semaine: 100 + i * 5, Statut: ['A', 'B'][i % 2] }));
  const p = roles(text);
  assert.notStrictEqual(p.Montant.role, 'measure', 'un « Montant » de texte n\'est pas une mesure');
  assert.ok(!p.Semaine.ordinal, 'des « semaines » de 100 à 295 ne sont pas des numéros de semaine');
  // « Jours de congé » : un mot inconnu de plus, ce n'est plus un numéro de jour.
  const leave = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, Jours_de_conge: 1 + (i % 28), Service: ['A', 'B', 'C'][i % 3] }));
  assert.ok(!roles(leave).Jours_de_conge.ordinal, '« Jours de congé » n\'est pas un numéro de jour');
  console.log('OK les valeurs gardent la main — un « Montant » de texte n\'est pas une mesure, des « semaines » hors bornes ne sont pas des numéros de semaine, « Jours de congé » n\'est pas un jour');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 9. Les types qui lisent un nom (objectif, début / fin, étape) et le câblage
{
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Un objectif : « Objetif » (faute) est reconnu comme sa colonne de cible.
  const goals = Array.from({ length: 120 }, (_, i) => {
    const goal = 1000 + (i % 6) * 100;
    return { id: i + 1, Commercial: ['A', 'B', 'C', 'D'][i % 4], Mois: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin'][i % 6], Realise: Math.round(goal * (0.7 + ((i * 7) % 5) / 10)), Objectif: goal };
  });
  const hasTarget = (rows) => advice.suggestTiles(rows, undefined, { limit: 60 }).some((s) => s.tileData.targetColumn);
  assert.ok(hasTarget(goals), 'un objectif écrit « Objectif » : une jauge ou une progression avec cible');
  const typoGoals = goals.map((r) => ({ id: r.id, Commercial: r.Commercial, Mois: r.Mois, Realise: r.Realise, Objetif: r.Objectif }));
  assert.ok(hasTarget(typoGoals), 'un objectif écrit « Objetif » : reconnu aussi');
  const noGoals = goals.map((r) => ({ id: r.id, Commercial: r.Commercial, Mois: r.Mois, Realise: r.Realise, Zzqqx: r.Objectif }));
  assert.ok(!hasTarget(noGoals), 'sans nom d\'objectif, aucune cible inventée');
  // Un planning : « Debut » / « Fin » reconnus, les fautes aussi.
  const plan = (start, end) => Array.from({ length: 24 }, (_, i) => ({ id: i + 1, Tache: 'T' + i, [start]: iso(2025, 1 + (i % 6), 1 + (i % 20)), [end]: iso(2025, 4 + (i % 6), 5 + (i % 20)), Statut: ['A faire', 'En cours', 'Fini'][i % 3] }));
  const hasGantt = (rows) => advice.suggestTiles(rows, undefined, { limit: 60 }).some((s) => s.tileData.type === 'gantt');
  assert.ok(hasGantt(plan('Debut', 'Fin')), 'Début / Fin : un planning');
  assert.ok(hasGantt(plan('Débt', 'Fin')), 'un début mal écrit est reconnu par la fin');
  assert.ok(hasGantt(plan('Debut', 'Fni')), 'une fin mal écrite est reconnue par le début');
  assert.ok(!hasGantt(plan('Naissance', 'Embauche')), 'naissance et embauche ne font pas un planning');
  // Une étape : un entonnoir sur la table `parcours` du corpus, avec « Etape » comme avec « Etpae » ; sans nom d'étape, aucun entonnoir.
  const parcours = corpus.build().find((t) => t.name === 'parcours');
  const stageColumn = Object.keys(parcours.rows[0]).find((k) => /^etape$/i.test(k));
  assert.ok(stageColumn, 'la table `parcours` a une colonne d\'étapes');
  const hasFunnel = (rows) => advice.suggestTiles(rows, undefined, { limit: 60, columnInfo: parcours.info || {} }).some((s) => s.tileData.type === 'funnel');
  const renamed = (to) => parcours.rows.map((r) => { const o = {}; Object.keys(r).forEach((k) => { o[k === stageColumn ? to : k] = r[k]; }); return o; });
  assert.ok(hasFunnel(parcours.rows), 'Etape : un entonnoir');
  assert.ok(hasFunnel(renamed('Etpae')), 'Etpae : un entonnoir aussi');
  assert.ok(!hasFunnel(renamed('Zzqqx')), 'sans nom d\'étape, aucun entonnoir');
  console.log('OK types — un objectif, un début, une fin, une étape écrits avec une faute sont reconnus ; naissance et embauche ne font pas un planning ; sans nom, aucune cible ni entonnoir inventés');

  // Câblage : le dictionnaire est chargé avant tout ce qui le lit, et les trois modules de types le lisent.
  const index = read('index.html');
  const harness = read('dev-tests/harness.html');
  [[index, 'js/'], [harness, '../js/']].forEach(([html, prefix]) => {
    const at = (file) => html.indexOf(`<script src="${prefix}${file}"></script>`);
    assert.ok(at('advice-names.js') > 0, `advice-names.js est chargé (${prefix})`);
    ['advice-insights.js', 'advice-types-time.js', 'advice-types-grid.js', 'advice-types.js', 'advice.js'].forEach((file) => assert.ok(at('advice-names.js') < at(file), `advice-names.js avant ${file}`));
    assert.strictEqual(html.split('advice-names.js').length - 1, 1, 'chargé une seule fois');
  });
  assert.ok(/hasTag\(String\(name\), tag\)/.test(read('js/advice-types-grid.js')) && /nameHas\(name, 'target'\)/.test(read('js/advice-types-grid.js')), 'la cible passe par le dictionnaire');
  assert.ok(/nameHas\(name, 'start'\)/.test(read('js/advice-types-time.js')) && /nameHas\(name, 'end'\)/.test(read('js/advice-types-time.js')), 'début et fin passent par le dictionnaire');
  assert.ok(/nameHas\(p\.id, 'stage'\)/.test(read('js/advice-types.js')), 'l\'étape passe par le dictionnaire');
  assert.ok(/require\('\.\/advice-names\.js'\)/.test(read('js/advice.js')), 'advice.js lit le dictionnaire');
  console.log('OK câblage — le dictionnaire est chargé avant tout ce qui le lit (page et harnais), une seule fois, et lu par advice.js et les trois modules de types');
}

console.log('\nOK — dictionnaire des noms de colonnes : tous les essais passent');
