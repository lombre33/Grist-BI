/*
 * Traduction FR/EN de l'interface, attribut `data-i18n` (voir index.html/harness.html) résolu par
 * ce module — même mécanisme que `lombre33/publipostageGrist` (`js/i18n.js`), demandé par le
 * cadrage d'identité Grist Factory (`planning/identite-ui-ux-grist-factory.md` : "Chaque chaîne
 * d'interface visible passe par un attribut data-i18n... résolu par un module i18n dédié").
 *
 * Chargé en TOUT PREMIER (avant data.js/combobox.js/.../main.js, voir index.html) pour que les
 * autres scripts lisent GristBI.i18n.t()/getLang() comme un global déjà prêt, même schéma de
 * dépendance implicite par ordre de <script> que le reste de ce projet.
 *
 * UMD comme js/data.js (testable sous Node, dev-tests/test-data.js) : `t`/`getLang`/`setLang`
 * fonctionnent sans DOM ni localStorage (repli silencieux), seul `applyTranslations()` a besoin
 * d'un vrai `document`.
 *
 * MAINTENANCE : chaque entrée porte fr ET en côte à côte dans le même objet littéral. `t()`
 * avertit en console (jamais un échec silencieux) si une traduction 'en' manque.
 *
 * Périmètre délibéré : seule la CHROME de l'interface (libellés, boutons, messages, badges,
 * infobulles) passe par ce module. Le CONTENU généré (noms de colonnes du jeu de données, titres
 * de tuile auto-composés à partir de ces noms comme "Montant par Région", en-têtes de feuille
 * Excel dans js/data.js) reste tel quel — js/data.js reste volontairement sans dépendance au DOM
 * ni à ce module (voir son en-tête), pour rester pur et testable sous Node ; l'étendre à l'i18n
 * serait un chantier à part, pas cette petite fondation. Voir HYPOTHESES.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.i18n = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STRINGS = {
    // --- Bandeau du haut ---
    'topbar.title': { fr: 'Dashboard BI', en: 'BI Dashboard' },
    'topbar.badgePoc': { fr: 'POC', en: 'POC' },
    'topbar.clearFilters': { fr: 'Effacer les filtres', en: 'Clear filters' },
    'status.rowCount': { fr: '{n} {n|ligne|lignes}', en: '{n} {n|row|rows}' },
    'status.renderTime': { fr: 'rendu : {ms} ms', en: 'rendered: {ms} ms' },

    // --- Sélecteur de table ---
    'table.label': { fr: 'Table de travail', en: 'Working table' },
    'table.connectFailed': {
      fr: 'Impossible de se connecter à la table "{table}" — voir la console (F12).',
      en: 'Could not connect to table "{table}" — see the console (F12).',
    },

    // --- Data blending multi-tables ---
    'blend.secondaryTable.label': { fr: 'Table secondaire', en: 'Secondary table' },
    'blend.primaryColumn.label': { fr: 'Clé (table principale)', en: 'Key (primary table)' },
    'blend.secondaryColumn.label': { fr: 'Clé (table secondaire)', en: 'Key (secondary table)' },
    'blend.none': { fr: '(aucune)', en: '(none)' },
    'blend.failed': {
      fr: 'Échec de la jointure avec la table "{table}" — voir la console (F12).',
      en: 'Join with table "{table}" failed — see the console (F12).',
    },

    // --- Pages ---
    'pages.addPage': { fr: '+ Page', en: '+ Page' },
    'pages.addPage.title': { fr: 'Ajouter une page', en: 'Add a page' },
    'pages.remove.title': { fr: 'Supprimer cette page', en: 'Delete this page' },
    'pages.rename.prompt': { fr: 'Nouveau nom de la page :', en: 'New page name:' },
    'pages.remove.confirm': {
      fr: 'Supprimer la page « {name} » et toutes ses tuiles ?',
      en: 'Delete page “{name}” and all its tiles?',
    },
    'pages.new.prompt': { fr: 'Nom de la nouvelle page :', en: 'Name of the new page:' },

    // --- Vues sauvegardées (bookmarks) ---
    'bookmarks.placeholder': { fr: 'Vues sauvegardées…', en: 'Saved views…' },
    'bookmarks.delete': { fr: 'Supprimer la vue', en: 'Delete view' },
    'bookmarks.save': { fr: 'Sauvegarder la vue actuelle', en: 'Save current view' },
    'bookmarks.save.prompt': { fr: 'Nom de la vue à sauvegarder :', en: 'Name of the view to save:' },
    'bookmarks.exportExcel': { fr: 'Exporter en Excel', en: 'Export to Excel' },
    'bookmarks.exportPdf': { fr: 'Exporter en PDF', en: 'Export to PDF' },
    'bookmarks.exportPptx': { fr: 'Exporter en PPTX', en: 'Export to PPTX' },
    'export.none': { fr: 'Aucune tuile à exporter.', en: 'No tile to export.' },
    'export.failed': { fr: "Échec de l'export Excel — voir la console (F12).", en: 'Excel export failed — see the console (F12).' },
    'export.pdf.chartUnavailable': { fr: 'Graphique indisponible pour cette tuile — réaffichez-la avant d\'exporter.', en: 'Chart unavailable for this tile — display it again before exporting.' },
    'export.pdf.networkError': {
      fr: "Échec de l'export PDF — pdfmake est chargé depuis cdnjs.cloudflare.com (pas vendorisé dans ce dépôt, voir CLAUDE.md) : vérifiez votre connexion. Détail dans la console (F12).",
      en: 'PDF export failed — pdfmake is loaded from cdnjs.cloudflare.com (not vendored in this repo, see CLAUDE.md): check your connection. Details in the console (F12).',
    },
    'export.pptx.chartUnavailable': { fr: 'Graphique indisponible pour cette tuile — réaffichez-la avant d\'exporter.', en: 'Chart unavailable for this tile — display it again before exporting.' },
    'export.pptx.networkError': {
      fr: "Échec de l'export PPTX — PptxGenJS est chargé depuis cdnjs.cloudflare.com (pas vendorisé dans ce dépôt, voir CLAUDE.md) : vérifiez votre connexion. Détail dans la console (F12).",
      en: 'PPTX export failed — PptxGenJS is loaded from cdnjs.cloudflare.com (not vendored in this repo, see CLAUDE.md): check your connection. Details in the console (F12).',
    },

    // --- Panneau Réglages (logo/Crédits/licence GPL v3, PR #7 ; langue, remplace le bouton de
    // bandeau #lang-toggle depuis le 29/09/2026 — placement de référence Publipostage+) ---
    'settings.button': { fr: 'Réglages', en: 'Settings' },
    'settings.close': { fr: 'Fermer', en: 'Close' },
    'settings.language.title': { fr: 'Langue', en: 'Language' },
    'settings.language.fr': { fr: 'Français', en: 'French' },
    'settings.language.en': { fr: 'Anglais', en: 'English' },
    'settings.credits.title': { fr: 'Crédits', en: 'Credits' },
    'settings.credits.author': { fr: 'Auteur', en: 'Author' },
    'settings.credits.website': { fr: 'Site', en: 'Website' },
    'settings.credits.license': { fr: 'Licence', en: 'License' },
    'settings.credits.bio': { fr: 'Bio', en: 'Bio' },
    'settings.credits.bioText': {
      fr: 'Grist Factory conçoit des widgets libres pour Grist. Dashboard BI en est un : croiser vos données Grist dans des tableaux de bord multi-tuiles avec cross-filtering et drill-down, directement dans Grist.',
      en: 'Grist Factory builds free and open-source widgets for Grist. Dashboard BI is one of them: cross-reference your Grist data in multi-tile dashboards with cross-filtering and drill-down, directly inside Grist.',
    },

    // --- Filtres avancés ---
    'filters.advanced.label': { fr: 'Filtre avancé', en: 'Advanced filter' },
    'filters.range.label': { fr: 'Plage', en: 'Range' },
    'filters.min.placeholder': { fr: 'Min', en: 'Min' },
    'filters.max.placeholder': { fr: 'Max', en: 'Max' },
    'filters.mode.label': { fr: 'Mode', en: 'Mode' },
    'filters.mode.dateRange': { fr: 'Plage de dates', en: 'Date range' },
    'filters.mode.relativeDate': { fr: 'Période relative', en: 'Relative period' },
    'filters.dateRange.label': { fr: 'Du / au', en: 'From / to' },
    'filters.relative.label': { fr: 'Période', en: 'Period' },
    'filters.relative.last7d': { fr: '7 derniers jours', en: 'Last 7 days' },
    'filters.relative.last30d': { fr: '30 derniers jours', en: 'Last 30 days' },
    'filters.relative.thisMonth': { fr: 'Ce mois-ci', en: 'This month' },
    'filters.relative.thisYear': { fr: 'Cette année', en: 'This year' },
    'filters.relative.last12m': { fr: '12 derniers mois', en: 'Last 12 months' },
    'filters.text.label': { fr: 'Recherche', en: 'Search' },
    'filters.text.placeholder': { fr: 'contient…', en: 'contains…' },
    'filters.apply': { fr: '+ Filtre', en: '+ Filter' },
    'filters.remove.aria': { fr: 'Retirer ce filtre', en: 'Remove this filter' },
    'filters.emptyRange': { fr: '(plage vide)', en: '(empty range)' },
    'filters.contains': { fr: 'contient', en: 'contains' },
    'filters.minBoundRequired': { fr: 'Renseignez au moins une borne (Min ou Max).', en: 'Enter at least one bound (Min or Max).' },
    'filters.maxGteMin': { fr: 'Max doit être supérieur ou égal à Min.', en: 'Max must be greater than or equal to Min.' },
    'filters.dateBoundRequired': { fr: 'Renseignez au moins une date (Du ou au).', en: 'Enter at least one date (From or to).' },
    'filters.endAfterStart': { fr: 'La date de fin doit être postérieure à la date de début.', en: 'The end date must be after the start date.' },
    'filters.textRequired': { fr: 'Saisissez un texte à rechercher.', en: 'Enter text to search for.' },

    // --- Bandeau d'avertissement ECharts ---
    'warning.echarts': {
      fr: "La bibliothèque de graphiques (ECharts, <code>js/vendor/echarts/echarts.min.js</code>) n'a pas pu être chargée : les cartes KPI fonctionnent, mais les tuiles barres/camembert resteront vides. Ouvrez la console du navigateur (F12 → Console / Réseau) pour voir pourquoi.",
      en: 'The charting library (ECharts, <code>js/vendor/echarts/echarts.min.js</code>) could not be loaded: KPI cards still work, but bar/pie tiles will stay empty. Open the browser console (F12 → Console / Network) to see why.',
    },

    // --- Formulaire d'ajout/édition de tuile ---
    'tileForm.type.label': { fr: 'Type', en: 'Type' },
    'tileForm.type.bar': { fr: 'Barres', en: 'Bars' },
    'tileForm.type.pie': { fr: 'Camembert', en: 'Pie chart' },
    'tileForm.type.treemap': { fr: 'Treemap', en: 'Treemap' },
    'tileForm.type.scatter': { fr: 'Nuage de points', en: 'Scatter plot' },
    'tileForm.type.kpi': { fr: 'Carte KPI', en: 'KPI card' },
    'tileForm.type.gauge': { fr: 'Jauge', en: 'Gauge' },
    'tileForm.type.pivot': { fr: 'Tableau croisé', en: 'Pivot table' },
    'tileForm.dimension.label': { fr: 'Dimension', en: 'Dimension' },
    'tileForm.dimension.labelRows': { fr: 'Dimension (lignes)', en: 'Dimension (rows)' },
    'tileForm.columnDimension.label': { fr: 'Dimension (colonnes)', en: 'Dimension (columns)' },
    'tileForm.suggestDateHierarchy': { fr: 'Détailler par Année/Trimestre/Mois/Jour', en: 'Break down by Year/Quarter/Month/Day' },
    'tileForm.drill.label': { fr: 'Drill-down', en: 'Drill-down' },
    'tileForm.drill.addLevel': { fr: '+ Niveau', en: '+ Level' },
    'tileForm.drill.crossFilter': { fr: 'Filtrer aussi les autres cartes en détaillant', en: 'Also filter other tiles when drilling down' },
    'tileForm.measure.label': { fr: 'Mesure', en: 'Measure' },
    'tileForm.measure.labelX': { fr: 'Mesure X', en: 'Measure X' },
    'tileForm.measureY.label': { fr: 'Mesure Y', en: 'Measure Y' },
    'tileForm.agg.label': { fr: 'Agrégat', en: 'Aggregate' },
    'tileForm.agg.sum': { fr: 'Somme', en: 'Sum' },
    'tileForm.agg.avg': { fr: 'Moyenne', en: 'Average' },
    'tileForm.agg.count': { fr: 'Comptage', en: 'Count' },
    'tileForm.agg.min': { fr: 'Min', en: 'Min' },
    'tileForm.agg.max': { fr: 'Max', en: 'Max' },
    'tileForm.gaugeMin.label': { fr: 'Min', en: 'Min' },
    'tileForm.gaugeMax.label': { fr: 'Max', en: 'Max' },
    'tileForm.measureMode.label': { fr: 'Mode', en: 'Mode' },
    'tileForm.measureMode.brut': { fr: 'Brut', en: 'Raw' },
    'tileForm.measureMode.cumulative': { fr: 'Cumul', en: 'Cumulative' },
    'tileForm.measureMode.ytd': { fr: 'Cumul annuel (YTD)', en: 'Year-to-date (YTD)' },
    'tileForm.measureMode.yoy': { fr: 'Comparaison N-1', en: 'Year-over-year' },
    'tileForm.dateColumn.label': { fr: 'Colonne date', en: 'Date column' },
    'tileForm.trend.label': { fr: 'Tendance vs', en: 'Trend vs' },
    'tileForm.submit.add': { fr: '+ Ajouter la tuile', en: '+ Add tile' },
    'tileForm.submit.edit': { fr: 'Modifier la tuile', en: 'Edit tile' },
    'tileForm.cancel': { fr: 'Annuler', en: 'Cancel' },
    'tileForm.none.m': { fr: '(aucun)', en: '(none)' },
    'tileForm.none.f': { fr: '(aucune)', en: '(none)' },
    'tileForm.alert.dateColumnRequired': { fr: 'Choisissez une colonne date pour ce mode de calcul.', en: 'Choose a date column for this calculation mode.' },
    'tileForm.alert.pivotDimsDiffer': {
      fr: 'Les dimensions lignes et colonnes du tableau croisé doivent être différentes.',
      en: 'The pivot table’s row and column dimensions must be different.',
    },
    'tileForm.alert.gaugeMinMax': {
      fr: 'Les valeurs Min/Max de la jauge doivent être des nombres valides, avec Max > Min.',
      en: 'The gauge’s Min/Max values must be valid numbers, with Max > Min.',
    },
    'tileForm.alert.drillDuplicate': {
      fr: 'Une même colonne ne peut pas apparaître deux fois dans le drill-down, ni reprendre la dimension racine.',
      en: 'The same column cannot appear twice in the drill-down, nor repeat the root dimension.',
    },

    // --- Boutons d'action d'une tuile (js/main.js:buildTileElement) ---
    'tile.moveLeft': { fr: 'Déplacer vers la gauche', en: 'Move left' },
    'tile.moveRight': { fr: 'Déplacer vers la droite', en: 'Move right' },
    'tile.edit.aria': { fr: 'Modifier', en: 'Edit' },
    'tile.edit.title': { fr: 'Modifier la tuile', en: 'Edit tile' },
    'tile.remove.aria': { fr: 'Supprimer', en: 'Delete' },
    'tile.remove.title': { fr: 'Supprimer la tuile', en: 'Delete tile' },

    // --- État vide ---
    'emptyState.hint': {
      fr: "Aucune tuile pour l'instant. Ajoutez-en une ci-dessus. Cliquer sur une barre/part filtre les autres tuiles (cumulable entre colonnes différentes ; recliquer retire le filtre). Une tuile avec un « Drill-down » se détaille au clic ; une carte KPI avec une « Tendance vs » affiche l'évolution par rapport à la période précédente.",
      en: 'No tile yet. Add one above. Clicking a bar/slice filters the other tiles (stackable across different columns; click again to remove the filter). A tile with a “Drill-down” expands on click; a KPI card with a “Trend vs” shows the change compared to the previous period.',
    },
    'emptyState.restoreDefaults': { fr: 'Restaurer les tuiles par défaut', en: 'Restore default tiles' },

    // --- Connexion / statut (js/main.js:bootstrap) ---
    'status.connecting': { fr: 'Connexion…', en: 'Connecting…' },
    'status.migrating': { fr: 'Mise à jour du schéma…', en: 'Updating schema…' },
    'status.creating': { fr: 'Création…', en: 'Creating…' },
    'status.progress': { fr: '{label} {pct}% ({sent}/{total})', en: '{label} {pct}% ({sent}/{total})' },
    'status.connectionFailed': { fr: 'Échec de la connexion aux données — voir la console (F12).', en: 'Failed to connect to the data — see the console (F12).' },

    // --- Graphiques (js/charts.js) ---
    'chart.unavailable': { fr: 'ECharts indisponible — voir le bandeau en haut de page.', en: 'ECharts unavailable — see the banner at the top of the page.' },
    'chart.measureFailed': { fr: 'Échec du calcul de la mesure — voir la console (F12).', en: 'Measure calculation failed — see the console (F12).' },
    'chart.computing': { fr: 'Calcul…', en: 'Computing…' },
    'chart.pivot.total': { fr: 'Total', en: 'Total' },
    'chart.breadcrumb.hint': { fr: '(cliquer pour détailler par {column})', en: '(click to drill down by {column})' },
  };

  let lang = (typeof localStorage !== 'undefined' && localStorage.getItem('gristbi_lang') === 'en') ? 'en' : 'fr';

  // Pluriel sans parenthèses, même syntaxe que publipostageGrist (`js/i18n.js`) : `{n|forme au
  // singulier|forme au pluriel}` prend l'une ou l'autre selon la règle de pluriel RÉELLE de la
  // langue active (Intl.PluralRules — en français 0 ET 1 sont au singulier, en anglais seul 1),
  // pas juste "n === 1". Traité AVANT les variables simples pour qu'une valeur de variable ne soit
  // jamais lue comme un pluriel.
  const pluralRules = {};
  function expandPlurals(s, vars) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) return out + s.slice(i);
      out += s.slice(i, open);
      const head = /^\{(\w+)\|/.exec(s.slice(open));
      if (!head || !vars || !(head[1] in vars)) { out += '{'; i = open + 1; continue; }
      let depth = 0;
      let split = -1;
      let close = -1;
      for (let j = open; j < s.length && close < 0; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { if (--depth === 0) close = j; }
        else if (s[j] === '|' && depth === 1 && j >= open + head[0].length && split < 0) split = j;
      }
      if (close < 0 || split < 0) { out += '{'; i = open + 1; continue; }
      const rules = pluralRules[lang] || (pluralRules[lang] = new Intl.PluralRules(lang));
      const chosen = rules.select(Number(vars[head[1]])) === 'one' ? s.slice(open + head[0].length, split) : s.slice(split + 1, close);
      out += expandPlurals(chosen, vars);
      i = close + 1;
    }
    return out;
  }

  function t(key, vars) {
    const entry = STRINGS[key];
    if (!entry) { console.warn('[GristBI.i18n] clé inconnue :', key); return key; }
    if (!entry[lang]) console.warn('[GristBI.i18n] traduction "' + lang + '" manquante pour "' + key + '" (repli FR).');
    let s = entry[lang] || entry.fr;
    if (vars) {
      s = expandPlurals(s, vars);
      Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    }
    return s;
  }

  function getLang() { return lang; }

  // Abonnés notifiés après chaque changement de langue — pour tout ce qu'aucun attribut
  // data-i18n-* ne peut porter parce que ça se compose à l'exécution selon un autre état que la
  // langue (ex. le libellé "Dimension" vs "Dimension (lignes)" selon le type de tuile choisi, ou
  // le texte du bouton "+ Ajouter"/"Modifier" selon le mode édition — voir js/main.js).
  const changeListeners = [];
  function onChange(fn) { if (typeof fn === 'function') changeListeners.push(fn); }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'fr';
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('gristbi_lang', lang); } catch (e) { /* stockage indisponible - la langue ne survivra pas au rechargement, sans plus de conséquence */ }
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    applyTranslations();
    changeListeners.forEach((fn) => { try { fn(lang); } catch (e) { console.warn('[GristBI.i18n] un abonné au changement de langue a levé une exception', e); } });
  }

  // Parcourt le DOM (ou un sous-arbre `root`) et applique les 5 variantes d'attribut de traduction
  // déclarative — le texte français d'origine reste en dur dans le HTML comme repli si ce fichier
  // n'a pas encore chargé. `data-i18n-html` (contrairement à Publipostage+) : nécessaire ici pour
  // le bandeau d'avertissement ECharts, dont la traduction contient un <code> imbriqué — seules des
  // valeurs de ce dictionnaire y passent, jamais une donnée utilisateur.
  function applyTranslations(root) {
    if (typeof document === 'undefined') return; // Node (tests) : pas de DOM à mettre à jour.
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
  }

  // Applique tout de suite (pas seulement lors d'un futur setLang) : ce script est placé après tout
  // le HTML du widget (les <script> sont en fin de <body>, voir index.html), donc le DOM à traduire
  // existe déjà — un utilisateur ayant déjà choisi EN voit l'anglais dès l'ouverture.
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  applyTranslations();

  return { t, getLang, setLang, applyTranslations, onChange, STRINGS };
});
