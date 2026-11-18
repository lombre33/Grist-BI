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
    'topbar.badgeAlpha': { fr: 'Alpha', en: 'Alpha' },
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
    'pages.addPage.title': { fr: 'Ajouter une page', en: 'Add a page' },
    'pages.remove.title': { fr: 'Supprimer cette page', en: 'Delete this page' },
    'pages.rename.prompt': { fr: 'Nouveau nom de la page :', en: 'New page name:' },
    'pages.remove.confirm': {
      fr: 'Supprimer la page « {name} » et toutes ses tuiles ?',
      en: 'Delete page “{name}” and all its tiles?',
    },
    'pages.new.prompt': { fr: 'Nom de la nouvelle page :', en: 'Name of the new page:' },

    // --- Vues sauvegardées (bookmarks) ---
    'bookmarks.save': { fr: 'Sauvegarder la vue actuelle', en: 'Save current view' },
    'bookmarks.save.prompt': { fr: 'Nom de la vue à sauvegarder :', en: 'Name of the view to save:' },
    'bookmarks.exportExcel': { fr: 'Exporter en Excel', en: 'Export to Excel' },
    'bookmarks.exportPdf': { fr: 'Exporter en PDF', en: 'Export to PDF' },
    'bookmarks.exportPptx': { fr: 'Exporter en PPTX', en: 'Export to PPTX' },
    'export.none': { fr: 'Aucune tuile à exporter.', en: 'No tile to export.' },
    'export.soon': { fr: 'bientôt disponible', en: 'coming soon' },
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
    // --- Style global des tuiles (js/styles.js, css/dash-styles.css) ---
    'style.title': { fr: 'Style des tuiles', en: 'Tile style' },
    'style.hint': {
      fr: 'Change l’apparence de toutes les tuiles de ce tableau de bord. Enregistré avec lui.',
      en: 'Changes the look of every tile in this dashboard. Saved with it.'
    },
    'style.standard.name': { fr: 'Standard', en: 'Standard' },
    'style.standard.desc': { fr: 'Le rendu d’origine du widget.', en: 'The widget’s original look.' },
    'style.fluid.name': { fr: 'Fluide', en: 'Fluid' },
    'style.fluid.desc': {
      fr: 'Cartes très arrondies, ombres douces, barres pastel avec leur valeur, peu d’axes.',
      en: 'Very rounded cards, soft shadows, pastel bars labelled with their value, few axes.'
    },
    'style.editorial.name': { fr: 'Éditorial', en: 'Editorial' },
    'style.editorial.desc': {
      fr: 'Sobre, façon rapport imprimé : fond papier, filet en tête de carte, titres à empattements.',
      en: 'Sober, like a printed report: paper background, a rule above each card, serif headings.'
    },
    'style.console.name': { fr: 'Console', en: 'Console' },
    'style.console.desc': {
      fr: 'Toujours sombre, filets fins, chiffres à chasse fixe, courbes qui luisent : façon console de supervision.',
      en: 'Always dark, thin rules, monospaced figures, glowing lines: like a monitoring console.'
    },
    'style.glass.name': { fr: 'Verre dépoli', en: 'Frosted glass' },
    'style.glass.desc': {
      fr: 'Fond dégradé, cartes en verre dépoli translucide, barres en dégradé : façon interfaces modernes.',
      en: 'Gradient backdrop, translucent frosted-glass cards, gradient bars: like modern app interfaces.'
    },
    'style.options.title': { fr: 'Options de la disposition « Grille »', en: 'Options for the “Grid” layout' },
    'style.option.hideBorders': { fr: 'Tuiles sans bordure apparente', en: 'Tiles without a visible border' },
    'style.option.hideBorders.desc': {
      fr: 'Plus de trait de contour : les tuiles se distinguent par leur fond et leur ombre.',
      en: 'No outline: tiles stand out through their background and shadow.'
    },
    'style.option.uniform': { fr: 'Tableau de bord uni', en: 'Uniform dashboard' },
    'style.option.uniform.desc': {
      fr: 'Une seule surface : les tuiles prennent le fond de la page, se touchent, sans ombre ni coins arrondis.',
      en: 'One single surface: tiles take the page background and touch each other, with no shadow or rounded corners.'
    },
    // --- Agencement d'une page (js/layouts.js, css/layouts.css) ---
    'layout.title': { fr: 'Disposition de la page', en: 'Page layout' },
    'layout.hint': {
      fr: 'Où se posent les tuiles de « {page} ». Chaque page a la sienne, enregistrée avec elle. Sur une zone étroite, la grille reprend.',
      en: 'Where the tiles of “{page}” are placed. Each page has its own, saved with it. On a narrow area the grid takes over.'
    },
    'layout.grid.name': { fr: 'Grille', en: 'Grid' },
    'layout.grid.desc': { fr: 'Des cartes de même taille côte à côte : le rendu d’origine.', en: 'Equal cards side by side: the original layout.' },
    'layout.report.name': { fr: 'Rapport', en: 'Report' },
    'layout.report.desc': {
      fr: 'Sans cartes : les chiffres en tête, deux graphiques par ligne, un filet fin au-dessus de chaque bloc.',
      en: 'No cards: figures first, two charts per row, a thin rule above each block.'
    },
    'layout.board.name': { fr: 'Planche', en: 'Board' },
    'layout.board.desc': {
      fr: 'Une seule surface arrondie, un bandeau de chiffres teinté, des filets entre les cellules.',
      en: 'One rounded surface, a tinted band of figures, rules between the cells.'
    },
    'layout.spotlight.name': { fr: 'Vedette', en: 'Spotlight' },
    'layout.spotlight.desc': {
      fr: 'Les chiffres en tête, un grand graphique en vedette (le premier en barres ou en courbe), le reste autour.',
      en: 'Figures first, one large lead chart (the first bar or line chart), the rest around it.'
    },
    'layout.rail.name': { fr: 'Rail', en: 'Rail' },
    'layout.rail.desc': {
      fr: 'Une colonne de chiffres et de jauges à gauche, les graphiques à droite.',
      en: 'A column of figures and gauges on the left, the charts on the right.'
    },
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
    'filters.advanced.label': { fr: 'Colonne', en: 'Column' },
    'filters.range.label': { fr: 'Plage', en: 'Range' },
    'filters.min.placeholder': { fr: 'Min', en: 'Min' },
    'filters.max.placeholder': { fr: 'Max', en: 'Max' },
    'filters.min.aria': { fr: 'Valeur minimale', en: 'Minimum value' },
    'filters.max.aria': { fr: 'Valeur maximale', en: 'Maximum value' },
    'filters.dateStart.aria': { fr: 'Date de début', en: 'Start date' },
    'filters.dateEnd.aria': { fr: 'Date de fin', en: 'End date' },
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
    'filters.apply': { fr: 'Ajouter le filtre', en: 'Add filter' },
    'filters.remove.aria': { fr: 'Retirer ce filtre', en: 'Remove this filter' },
    'filters.emptyRange': { fr: '(plage vide)', en: '(empty range)' },
    'filters.rangeExclusive': { fr: '{column} : de {min} à moins de {max}', en: '{column}: {min} to under {max}' },
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

    // --- Bandeau d'avertissement : rapport partagé en lecture seule (consigne GFS 012) ---
    'warning.sharedReadOnly': {
      fr: "Ce rapport vous est partagé en lecture seule : Grist refuse d'enregistrer vos modifications. Demandez l'accès en écriture à son propriétaire, ou travaillez sur une copie.",
      en: 'This report is shared with you as read-only: Grist is refusing to save your changes. Ask its owner for write access, or work on a copy.',
    },

    // --- Formulaire d'ajout/édition de tuile ---
    'tileForm.type.label': { fr: 'Type', en: 'Type' },
    'tileForm.type.bar': { fr: 'Barres', en: 'Bars' },
    'tileForm.type.pie': { fr: 'Camembert', en: 'Pie chart' },
    'tileForm.type.treemap': { fr: 'Treemap', en: 'Treemap' },
    'tileForm.type.sunburst': { fr: 'Soleil (anneaux hiérarchiques)', en: 'Sunburst (hierarchical rings)' },
    'tileForm.type.funnel': { fr: 'Entonnoir', en: 'Funnel' },
    'tileForm.type.scatter': { fr: 'Nuage de points / bulles', en: 'Scatter / bubble chart' },
    'tileForm.type.kpi': { fr: 'Carte KPI', en: 'KPI card' },
    'tileForm.type.gauge': { fr: 'Jauge', en: 'Gauge' },
    'tileForm.type.text': { fr: 'Texte', en: 'Text' },
    'tileForm.type.table': { fr: 'Table', en: 'Table' },
    'tileForm.type.progress': { fr: 'Progression', en: 'Progress' },
    'tileForm.target.label': { fr: 'Objectif (valeur)', en: 'Target (value)' },
    'tileForm.targetColumn.label': { fr: 'Objectif (colonne, facultatif)', en: 'Target (column, optional)' },
    'tileForm.target.hint': { fr: 'Une colonne d’objectifs est agrégée comme la mesure et prend le pas sur la valeur saisie.', en: 'A target column is aggregated like the measure and takes precedence over the typed value.' },
    'tileForm.goodPct.label': { fr: 'Vert à partir de (% de l’objectif)', en: 'Green from (% of target)' },
    'tileForm.warnPct.label': { fr: 'Orange à partir de (% de l’objectif)', en: 'Orange from (% of target)' },
    'tileForm.sparkline.label': { fr: 'Tracer la courbe de la tendance', en: 'Draw the trend line' },
    'tileForm.columns.label': { fr: 'Colonnes à afficher', en: 'Columns to show' },
    'tileForm.columns.hint': { fr: 'Cochez les colonnes ; les flèches changent leur ordre.', en: 'Tick the columns; the arrows change their order.' },
    'tileForm.columns.up': { fr: 'Monter {column}', en: 'Move {column} up' },
    'tileForm.columns.down': { fr: 'Descendre {column}', en: 'Move {column} down' },
    'tileForm.text.label': { fr: 'Texte', en: 'Text' },
    'tileForm.text.hint': { fr: 'Une ligne vide sépare les paragraphes. « # » pour un titre, « - » pour une liste, **gras**. Le HTML n’est pas interprété.', en: 'A blank line separates paragraphs. “# ” for a heading, “- ” for a list, **bold**. HTML is not interpreted.' },
    'tileForm.type.pivot': { fr: 'Tableau croisé', en: 'Pivot table' },
    'tileForm.type.waterfall': { fr: 'Cascade (waterfall)', en: 'Waterfall' },
    'tileForm.type.radar': { fr: 'Radar', en: 'Radar' },
    'tileForm.type.wordcloud': { fr: 'Nuage de mots', en: 'Word cloud' },
    'tileForm.dimension.label': { fr: 'Dimension', en: 'Dimension' },
    'tileForm.dimension.labelDate': { fr: 'Colonne de dates (une case = un jour)', en: 'Date column (one cell = one day)' },
    'tileForm.error.calendarNotDate': { fr: 'Cette colonne ne contient pas de dates (format AAAA-MM-JJ) : choisissez une colonne Date.', en: 'This column has no dates (YYYY-MM-DD format): choose a Date column.' },
    'chart.calendar.empty': { fr: 'Aucun jour avec une valeur : choisissez une colonne de dates.', en: 'No day with a value: choose a date column.' },
    'chart.calendar.dayNames': { fr: 'D,L,M,M,J,V,S', en: 'S,M,T,W,T,F,S' },
    'chart.calendar.monthNames': { fr: 'janv.,févr.,mars,avr.,mai,juin,juil.,août,sept.,oct.,nov.,déc.', en: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec' },
    'tileForm.type.gantt': { fr: 'Gantt (planning de tâches)', en: 'Gantt (task schedule)' },
    'tileForm.dimension.labelTask': { fr: 'Tâche (libellé de la ligne)', en: 'Task (row label)' },
    'tileForm.dimension.labelRing': { fr: 'Anneau central (1er niveau)', en: 'Central ring (1st level)' },
    'tileForm.startColumn.label': { fr: 'Début (colonne de dates)', en: 'Start (date column)' },
    'tileForm.endColumn.label': { fr: 'Fin (colonne de dates)', en: 'End (date column)' },
    'tileForm.series.labelStatus': { fr: 'Couleur (statut, facultatif)', en: 'Colour (status, optional)' },
    'tileForm.error.ganttStartRequired': { fr: 'Choisissez la colonne de début des tâches.', en: 'Choose the tasks’ start column.' },
    'tileForm.error.ganttEndRequired': { fr: 'Choisissez la colonne de fin des tâches.', en: 'Choose the tasks’ end column.' },
    'tileTitle.gantt': { fr: 'Planning ({dimension})', en: 'Schedule ({dimension})' },
    'chart.gantt.empty': { fr: 'Aucune tâche à dessiner : choisissez une colonne de début et une colonne de fin (dates).', en: 'No task to draw: choose a start and an end date column.' },
    'chart.gantt.row': { fr: '{label} : du {start} au {end} ({days} {days|jour|jours})', en: '{label}: {start} to {end} ({days} {days|day|days})' },
    'chart.gantt.today': { fr: 'Aujourd’hui', en: 'Today' },
    'chart.gantt.hidden': { fr: '{shown} premières tâches sur {total} ({hidden} de plus restent dans l’export).', en: 'First {shown} of {total} tasks ({hidden} more stay in the export).' },
    'chart.gantt.ignored': { fr: '{n} {n|ligne ignorée|lignes ignorées} (début ou fin absent, ou fin avant le début).', en: '{n} {n|row|rows} skipped (missing start or end, or end before start).' },
    'advice.use.gantt': { fr: 'Voir quand chaque tâche commence et finit, et ce qui se chevauche : une barre par tâche sur une frise du temps.', en: 'See when each task starts and ends, and what overlaps: one bar per task on a timeline.' },
    'advice.fit.noTwoDates': { fr: 'Il faut deux colonnes de dates (début et fin) : un Gantt n’aurait aucune barre à dessiner.', en: 'This needs two date columns (start and end): a Gantt would have no bar to draw.' },
    'advice.gantt.noTask': { fr: 'Aucune ligne n’a de dates valides dans « {start} » et « {end} » (format AAAA-MM-JJ, fin après le début) : aucune barre ne peut être dessinée.', en: 'No row has valid dates in “{start}” and “{end}” (YYYY-MM-DD format, end after start): no bar can be drawn.' },
    'advice.gantt.manyStatuses': { fr: '{n} statuts pour {max} couleurs : certains partagent la même couleur. Regroupez les statuts ou filtrez.', en: '{n} statuses for {max} colours: some share a colour. Group the statuses or filter.' },
    'advice.gantt.ignored': { fr: '{n} {n|ligne n’est pas dessinée|lignes ne sont pas dessinées} (début ou fin absent, ou fin avant le début) ; elles restent hors de l’export.', en: '{n} {n|row is|rows are} not drawn (missing start or end, or end before start); they stay out of the export.' },
    'advice.gantt.truncated': { fr: 'Seules les {max} premières tâches sont dessinées ({hidden} de plus restent dans l’export). Filtrez une période ou un statut pour voir le reste.', en: 'Only the first {max} tasks are drawn ({hidden} more stay in the export). Filter a period or a status to see the rest.' },
    'advice.use.calendar': { fr: 'Voir quels jours sont chargés ou creux : une case par jour, la couleur suit la valeur.', en: 'See which days are busy or quiet: one cell per day, colour follows the value.' },
    'advice.fit.noDate': { fr: 'Aucune colonne de dates dans ce tableau : un calendrier n’aurait aucune case à dessiner.', en: 'No date column in this table: a calendar would have no cell to draw.' },
    'advice.calendar.notDate': { fr: 'La colonne « {dimension} » ne contient aucune date valide (format AAAA-MM-JJ) : aucune case ne peut être dessinée.', en: 'The “{dimension}” column has no valid date (YYYY-MM-DD format): no cell can be drawn.' },
    'advice.calendar.fewDays': { fr: 'Seulement {n} jours avec une valeur : un calendrier a besoin d’au moins une semaine pour dire quelque chose.', en: 'Only {n} days with a value: a calendar needs at least a week to say anything.' },
    'advice.calendar.truncated': { fr: 'Seuls les {days} derniers jours sont dessinés ({hidden} plus anciens restent dans l’export). Filtrez une période pour voir le reste.', en: 'Only the last {days} days are drawn ({hidden} older ones stay in the export). Filter a period to see the rest.' },
    'tileForm.dimension.labelRows': { fr: 'Dimension (lignes)', en: 'Dimension (rows)' },
    'tileForm.columnDimension.label': { fr: 'Dimension (colonnes)', en: 'Dimension (columns)' },
    'tileForm.dimension.labelSource': { fr: 'Source (départ du flux)', en: 'Source (where the flow starts)' },
    'tileForm.columnDimension.labelTarget': { fr: 'Cible (arrivée du flux)', en: 'Target (where the flow ends)' },
    'tileForm.error.sankeyTargetRequired': { fr: 'Choisissez la colonne cible des flux.', en: 'Choose the flows’ target column.' },
    'tileForm.error.sunburstAdditive': { fr: 'Un soleil additionne ses parts : choisissez Somme ou Comptage (une moyenne, un minimum ou un maximum n’a pas pour valeur la somme de ses sous-parts).', en: 'A sunburst adds up its parts: choose Sum or Count (an average, a minimum or a maximum is not the sum of its sub-parts).' },
    'tileForm.error.sunburstTooManyRings': { fr: 'Un soleil montre au plus 4 anneaux : l’anneau central et 3 niveaux.', en: 'A sunburst shows at most 4 rings: the central one and 3 levels.' },
    'tileForm.alert.sankeyDimsDiffer': { fr: 'La source et la cible doivent être deux colonnes différentes.', en: 'The source and the target must be two different columns.' },
    'tileForm.radarMode.label': { fr: 'Axes du radar', en: 'Radar axes' },
    'tileForm.radarMode.dimension': { fr: 'Une colonne catégorielle (classique)', en: 'A single categorical column (classic)' },
    'tileForm.radarMode.columns': { fr: 'Plusieurs colonnes numériques (compétences)', en: 'Several numeric columns (skills)' },
    'tileForm.radarAxes.label': { fr: 'Axes (colonnes numériques)', en: 'Axes (numeric columns)' },
    'tileForm.radarAxes.addAxis': { fr: '+ Axe', en: '+ Axis' },
    'tileForm.radarEntity.columnLabel': { fr: 'Comparer une valeur (colonne)', en: 'Compare a value (column)' },
    'tileForm.radarEntity.valueLabel': { fr: 'Valeur à comparer', en: 'Value to compare' },
    'tileForm.radarEntity.compareAverage': { fr: 'Comparer aussi à la moyenne du groupe filtré', en: 'Also compare to the filtered group average' },
    'tileForm.wordCloudSplit.label': { fr: 'Découper chaque cellule en plusieurs mots (ex. mots-clés séparés par des virgules)', en: 'Split each cell into several words (e.g. comma-separated keywords)' },
    'tileForm.suggestDateHierarchy': { fr: 'Détailler par Année/Trimestre/Mois/Jour', en: 'Break down by Year/Quarter/Month/Day' },
    'tileForm.drill.label': { fr: 'Drill-down', en: 'Drill-down' },
    'tileForm.drill.labelRings': { fr: 'Anneaux suivants (du centre vers l’extérieur)', en: 'Next rings (from the centre outwards)' },
    'tileForm.drill.addLevel': { fr: '+ Niveau', en: '+ Level' },
    'tileForm.drill.crossFilter': { fr: 'Filtrer aussi les autres cartes en détaillant', en: 'Also filter other tiles when drilling down' },
    'tileForm.measure.label': { fr: 'Mesure', en: 'Measure' },
    'tileForm.measureSize.label': { fr: 'Taille des bulles (facultatif)', en: 'Bubble size (optional)' },
    'tileForm.aggSize.label': { fr: 'Agrégat de la taille', en: 'Size aggregate' },
    'tileForm.series.labelColor': { fr: 'Couleur (une par valeur, facultatif)', en: 'Colour (one per value, optional)' },
    'chart.bubble.size': { fr: 'taille', en: 'size' },
    'advice.bubble.sizeSign': { fr: '{n} valeurs de taille nulles ou négatives : une bulle ne peut pas avoir une aire négative, elles ne sont pas dessinées.', en: '{n} zero or negative size values: a bubble cannot have a negative area, so they are not drawn.' },
    'advice.bubble.tooManyColors': { fr: '{n} couleurs : au-delà de {max}, les couleurs se répètent et la légende devient illisible. Filtrez ou choisissez une colonne à moins de valeurs.', en: '{n} colours: beyond {max}, colours repeat and the legend becomes unreadable. Filter, or choose a column with fewer values.' },
    'advice.bubble.sameAsDimension': { fr: 'La colonne de couleur est la même que celle des points : chaque bulle aurait sa couleur, sans rien dire de plus.', en: 'The colour column is the same as the points’ column: every bubble would get its own colour, saying nothing more.' },
    'tileForm.measure.labelX': { fr: 'Mesure X', en: 'Measure X' },
    'tileForm.measure.labelBars': { fr: 'Mesure des barres', en: 'Bar measure' },
    'tileForm.measure.labelHistogram': { fr: 'Colonne numérique', en: 'Numeric column' },
    'tileForm.bins.label': { fr: 'Nombre de classes', en: 'Number of classes' },
    'tileForm.bins.placeholder': { fr: 'Automatique', en: 'Automatic' },
    'tileForm.bins.hint': { fr: 'Vide = automatique. Indicatif : les bornes sont arrondies à des valeurs simples (2, 5, 10…).', en: 'Empty = automatic. Approximate: the bounds are rounded to simple values (2, 5, 10…).' },
    'tileForm.measureY.labelLine': { fr: 'Mesure de la courbe (2e axe)', en: 'Line measure (2nd axis)' },
    'tileForm.aggY.label': { fr: 'Agrégat de la courbe', en: 'Line aggregate' },
    'tileForm.comboMode.label': { fr: 'Courbe', en: 'Line' },
    'tileForm.comboMode.measure': { fr: 'Une autre mesure (2e axe)', en: 'Another measure (2nd axis)' },
    'tileForm.comboMode.pareto': { fr: 'Pareto : part cumulée en %', en: 'Pareto: cumulative share in %' },
    'tileForm.measureY.label': { fr: 'Mesure Y', en: 'Measure Y' },
    'tileForm.agg.label': { fr: 'Agrégat', en: 'Aggregate' },
    'tileForm.agg.labelBars': { fr: 'Agrégat des barres', en: 'Bar aggregate' },
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
    'tileForm.submit.add': { fr: 'Ajouter la visualisation', en: 'Add visualization' },
    'tileForm.submit.edit': { fr: 'Enregistrer', en: 'Save' },
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
    'tileForm.alert.radarAxesDuplicate': {
      fr: 'Une même colonne ne peut pas apparaître deux fois parmi les axes du radar.',
      en: 'The same column cannot appear twice among the radar axes.',
    },

    // --- Boutons d'action d'une tuile (js/main.js:buildTileElement) ---
    'tile.moveLeft': { fr: 'Déplacer vers la gauche', en: 'Move left' },
    'tile.moveRight': { fr: 'Déplacer vers la droite', en: 'Move right' },
    'tile.edit.aria': { fr: 'Modifier', en: 'Edit' },
    'tile.edit.title': { fr: 'Modifier la tuile', en: 'Edit tile' },
    'tile.remove.aria': { fr: 'Supprimer', en: 'Delete' },
    'tile.remove.title': { fr: 'Supprimer la tuile', en: 'Delete tile' },
    'tile.comments.aria': { fr: 'Commentaires', en: 'Comments' },
    'tile.comments.title': { fr: 'Commentaires de la tuile', en: 'Tile comments' },
    'tile.detail.aria': { fr: 'Détail', en: 'Detail' },
    'tile.detail.title': { fr: 'Voir les lignes de données de la tuile', en: 'View the tile’s data rows' },
    // Agrandir une tuile dans la zone au-dessus de la grille (retours d'Antoine du 18/11/2026, point 8).
    'tile.zoom.aria': { fr: 'Agrandir la tuile', en: 'Enlarge tile' },
    'tile.zoom.title': { fr: 'Agrandir cette tuile au-dessus des autres', en: 'Enlarge this tile above the others' },
    'tile.unzoom.aria': { fr: 'Réduire la tuile', en: 'Shrink tile' },
    'tile.unzoom.title': { fr: 'Remettre cette tuile dans la grille', en: 'Put this tile back in the grid' },
    'zoom.zone.aria': { fr: 'Tuiles agrandies', en: 'Enlarged tiles' },
    'zoom.count': { fr: '{n} {n|tuile agrandie|tuiles agrandies}', en: '{n} enlarged {n|tile|tiles}' },
    'zoom.reset': { fr: 'Tout réduire', en: 'Shrink all' },

    // --- Modale de détail (substitut du drillthrough Power BI, panneau ouvert depuis une tuile) ---
    'detail.modal.title': { fr: 'Détail — {n} {n|ligne|lignes}', en: 'Detail — {n} {n|row|rows}' },
    'detail.modal.empty': { fr: 'Aucune ligne pour l’instant.', en: 'No rows yet.' },
    'detail.modal.truncated': {
      fr: 'Affichage des {shown} premières lignes sur {total}. Exportez en Excel pour tout voir.',
      en: 'Showing the first {shown} rows out of {total}. Export to Excel to see everything.'
    },

    // --- Mots-clés des publications (menu Données > « Mots-clés des publications », js/main.js,
    // logique pure js/publications.js ; consigne GFS 019, extension « Mots-clés des PDF ») ---
    'keywords.open': { fr: 'Mots-clés des publications…', en: 'Publication keywords…' },
    'keywords.title': { fr: 'Mots-clés des publications', en: 'Publication keywords' },
    'keywords.intro': {
      fr: 'Remplit une colonne de mots-clés à partir du texte de chaque publication, lu dans votre navigateur : rien n’est envoyé ailleurs. Une cellule déjà remplie n’est jamais modifiée.',
      en: 'Fills a keywords column from the text of each publication, read in your browser: nothing is sent elsewhere. A cell that already has a value is never changed.'
    },
    'keywords.source.legend': { fr: 'D’où vient le texte ?', en: 'Where does the text come from?' },
    'keywords.source.pdf': { fr: 'Le PDF joint à la ligne', en: 'The PDF attached to the row' },
    'keywords.source.text': { fr: 'Une colonne de texte (titre, résumé…)', en: 'A text column (title, abstract…)' },
    'keywords.source.pdfColumn': { fr: 'Colonne des pièces jointes', en: 'Attachments column' },
    'keywords.source.textColumn': { fr: 'Colonne de texte', en: 'Text column' },
    'keywords.target.label': { fr: 'Colonne des mots-clés automatiques', en: 'Automatic keywords column' },
    'keywords.target.new': { fr: 'Nouvelle colonne « {name} »', en: 'New column “{name}”' },
    'keywords.manual.label': { fr: 'Mots-clés saisis à la main (facultatif)', en: 'Keywords typed by hand (optional)' },
    'keywords.manual.none': { fr: 'Aucune colonne', en: 'No column' },
    'keywords.manual.hint': { fr: 'Ces mots ne sont pas répétés dans la colonne automatique.', en: 'These words are not repeated in the automatic column.' },
    'keywords.max.label': { fr: 'Mots-clés par publication', en: 'Keywords per publication' },
    'keywords.lang.label': { fr: 'Langue du texte', en: 'Text language' },
    'keywords.lang.auto': { fr: 'Automatique', en: 'Automatic' },
    'keywords.lang.fr': { fr: 'Français', en: 'French' },
    'keywords.lang.en': { fr: 'Anglais', en: 'English' },
    'keywords.plan': {
      fr: '{todo} {todo|ligne|lignes} à compléter sur {total}.',
      en: '{todo} {todo|row|rows} to fill out of {total}.'
    },
    'keywords.plan.filled': { fr: '{n} déjà {n|remplie|remplies}', en: '{n} already filled' },
    'keywords.plan.noSource': { fr: '{n} sans texte à lire', en: '{n} with no text to read' },
    'keywords.plan.none': {
      fr: 'Rien à compléter : chaque ligne a déjà ses mots-clés, ou n’a pas de texte à lire.',
      en: 'Nothing to fill: every row already has its keywords, or has no text to read.'
    },
    'keywords.noColumns.pdf': { fr: 'Cette table n’a aucune colonne de pièces jointes.', en: 'This table has no attachments column.' },
    'keywords.noColumns.text': { fr: 'Cette table n’a aucune colonne de texte.', en: 'This table has no text column.' },
    'keywords.noTable': { fr: 'Connectez d’abord une table de travail (menu Données).', en: 'Connect a working table first (Data menu).' },
    'keywords.start': { fr: 'Extraire les mots-clés', en: 'Extract keywords' },
    'keywords.stop': { fr: 'Arrêter', en: 'Stop' },
    'keywords.confirm.title': { fr: 'Écrire dans votre table ?', en: 'Write to your table?' },
    'keywords.confirm.message': {
      fr: 'Les mots-clés de {todo} {todo|ligne|lignes} vont être écrits dans la colonne « {column} » de la table « {table} ». Les cellules déjà remplies ne sont pas touchées.',
      en: 'The keywords of {todo} {todo|row|rows} will be written to the “{column}” column of the “{table}” table. Cells that already have a value are not touched.'
    },
    'keywords.confirm.newColumn': { fr: ' La colonne sera créée.', en: ' The column will be created.' },
    'keywords.confirm.ok': { fr: 'Écrire', en: 'Write' },
    'keywords.progress': { fr: 'Ligne {n} sur {total}…', en: 'Row {n} of {total}…' },
    'keywords.done.written': { fr: '{n} {n|ligne complétée|lignes complétées}.', en: '{n} {n|row|rows} filled.' },
    'keywords.done.noText': { fr: '{n} sans texte lisible (un PDF scanné n’a pas de texte).', en: '{n} with no readable text (a scanned PDF has no text).' },
    'keywords.done.noPdf': { fr: '{n} sans PDF parmi les pièces jointes.', en: '{n} with no PDF among the attachments.' },
    'keywords.done.noKeywords': { fr: '{n} sans mot-clé trouvé.', en: '{n} with no keyword found.' },
    'keywords.done.errors': { fr: '{n} {n|ligne en erreur|lignes en erreur} (ex. : {sample}).', en: '{n} {n|row|rows} failed (e.g. {sample}).' },
    'keywords.done.cancelled': { fr: 'Arrêté : ce qui était déjà fait est enregistré.', en: 'Stopped: what was already done is saved.' },
    'keywords.error.write': { fr: 'Grist a refusé l’écriture : {message}', en: 'Grist refused the write: {message}' },
    'keywords.error.token': {
      fr: 'Les pièces jointes ne sont pas lisibles ici : {message}',
      en: 'Attachments cannot be read here: {message}'
    },
    'keywords.error.pdfjsMissing': {
      fr: 'L’extension « Mots-clés des PDF » n’est plus ajoutée, ou son fichier a été refusé par le navigateur.',
      en: 'The “PDF keywords” extension is no longer added, or the browser refused its file.'
    },
    'keywords.error.pdfjs': { fr: 'PDF.js n’a pas pu être chargé : {message}', en: 'PDF.js could not be loaded: {message}' },
    'keywords.error.column': { fr: 'La colonne « {name} » n’a pas pu être créée : {message}', en: 'The “{name}” column could not be created: {message}' },
    'keywords.sample': { fr: 'Ligne {id} : {words}', en: 'Row {id}: {words}' },
    'keywords.needsGfs.note': {
      fr: 'Demande l’extension « Mots-clés des PDF » de Grist Factory Suite.',
      en: 'Needs the “PDF keywords” extension of Grist Factory Suite.'
    },
    'keywords.needsGfs.add': { fr: 'Ajouter l’extension', en: 'Add the extension' },
    'keywords.needsGfs.how': { fr: 'Comment l’avoir', en: 'How to get it' },

    // --- Commentaires collaboratifs (panneau ouvert depuis une tuile) ---
    'comments.modal.title': { fr: 'Commentaires', en: 'Comments' },
    'comments.empty': { fr: 'Aucun commentaire pour l’instant.', en: 'No comments yet.' },
    'comments.author.placeholder': { fr: 'Votre nom', en: 'Your name' },
    'comments.author.label': { fr: 'Auteur', en: 'Author' },
    'comments.author.autoNote': { fr: 'Reconnu depuis votre compte Grist.', en: 'Recognized from your Grist account.' },
    'comments.text.label': { fr: 'Commentaire', en: 'Comment' },
    'comments.author.autoTitle': {
      fr: 'Identifié automatiquement via votre session Grist quand c’est possible, sinon à saisir à la main.',
      en: 'Automatically identified from your Grist session when possible, otherwise type it in by hand.'
    },
    'comments.text.placeholder': { fr: 'Écrire un commentaire…', en: 'Write a comment…' },
    'comments.submit': { fr: 'Ajouter', en: 'Add' },
    'comments.count': { fr: '{n} {n|commentaire|commentaires}', en: '{n} {n|comment|comments}' },
    'comments.addFailed': { fr: "Échec de l'ajout du commentaire — voir la console (F12).", en: 'Failed to add the comment — see the console (F12).' },

    // --- Import de la mise en page d'un fichier Power BI (.pbix/.pbit) ---
    'pbixImport.button': { fr: 'Importer Power BI', en: 'Import Power BI' },
    'pbixImport.title': { fr: 'Importer un fichier Power BI', en: 'Import a Power BI file' },
    'pbixImport.intro': {
      fr: "Lit les visuels d'un fichier .pbix ou .pbit (type de graphique, colonnes utilisées, titre) et propose des tuiles correspondantes sur la table de travail actuelle. Les données du fichier Power BI ne sont pas importées par ce chemin.",
      en: 'Reads the visuals of a .pbix or .pbit file (chart type, columns used, title) and suggests matching tiles on the current working table. The Power BI file’s data is not imported through this path.'
    },
    'pbixImport.dataHint': {
      fr: 'Pour les vraies données du fichier (pas seulement sa mise en page) : exportez-les depuis Power BI (clic droit sur un visuel → « Exporter les données », ou « Analyser dans Excel »), puis importez le fichier obtenu dans Grist via son import natif. Les tuiles ci-dessous retrouveront alors les bonnes colonnes.',
      en: 'For the file’s actual data (not just its layout): export it from Power BI (right-click a visual → "Export data", or "Analyze in Excel"), then import the resulting file into Grist via its native import. The tiles below will then find the matching columns.'
    },
    'pbixImport.reading': { fr: 'Lecture du fichier…', en: 'Reading the file…' },
    'pbixImport.noLayout': {
      fr: "Aucune mise en page trouvée dans ce fichier (entrée « Report/Layout » absente) — est-ce bien un .pbix/.pbit ?",
      en: 'No layout found in this file (missing "Report/Layout" entry) — is this really a .pbix/.pbit?'
    },
    'pbixImport.readFailed': { fr: 'Échec de la lecture du fichier — voir la console (F12).', en: 'Failed to read the file — see the console (F12).' },
    'pbixImport.noVisual': {
      fr: "Aucun visuel pris en charge trouvé dans ce fichier (types comme carte/tableau croisé/ligne/aire ne sont pas convertis automatiquement).",
      en: 'No supported visual found in this file (types like map/matrix/line/area are not converted automatically).'
    },
    'pbixImport.found': { fr: '{n} {n|tuile proposée|tuiles proposées} sur {total} {total|visuel lu|visuels lus}.', en: '{n} {n|tile proposed|tiles proposed} out of {total} {total|visual read|visuals read}.' },
    'pbixImport.missingColumns': {
      fr: 'Colonnes introuvables dans la table connectée : {columns}',
      en: 'Columns not found in the connected table: {columns}'
    },
    'pbixImport.createSelected': { fr: 'Créer les tuiles sélectionnées', en: 'Create selected tiles' },
    'pbixImport.created': { fr: '{n} {n|tuile créée|tuiles créées}.', en: '{n} {n|tile created|tiles created}.' },

    // --- Import des DONNÉES d'un CSV exporté depuis Power BI (complète l'import ci-dessus) ---
    'pbixImport.csvTitle': { fr: 'Données (CSV exporté de Power BI)', en: 'Data (CSV exported from Power BI)' },
    'pbixImport.csvIntro': {
      fr: 'Déposez ici le CSV exporté depuis Power BI (clic droit sur un visuel → « Exporter les données », ou « Analyser dans Excel » puis enregistrement en CSV). Le widget détecte les colonnes et leur type et vous montre un aperçu ; la table n’est créée dans votre document Grist qu’après votre confirmation explicite.',
      en: 'Drop here the CSV exported from Power BI (right-click a visual → "Export data", or "Analyze in Excel" then save as CSV). The widget detects the columns and their type and shows you a preview; the table is only created in your Grist document after your explicit confirmation.'
    },
    'pbixImport.csvReading': { fr: 'Lecture du fichier…', en: 'Reading the file…' },
    'pbixImport.csvEmpty': {
      fr: 'Aucune ligne de données trouvée dans ce fichier — est-ce bien un CSV avec un en-tête de colonnes ?',
      en: 'No data row found in this file — is this really a CSV with a column header?'
    },
    'pbixImport.csvReadFailed': { fr: 'Échec de la lecture du fichier CSV — voir la console (F12).', en: 'Failed to read the CSV file — see the console (F12).' },
    'pbixImport.csvFound': {
      fr: 'Aperçu : {columns} {columns|colonne|colonnes}, {rows} {rows|ligne|lignes}.',
      en: 'Preview: {columns} {columns|column|columns}, {rows} {rows|row|rows}.'
    },
    'pbixImport.csvTableName': { fr: 'Nom de la table', en: 'Table name' },
    'pbixImport.fileAria': { fr: 'Fichier Power BI (.pbix ou .pbit)', en: 'Power BI file (.pbix or .pbit)' },
    'pbixImport.csvFileAria': { fr: 'Fichier CSV exporté de Power BI', en: 'CSV file exported from Power BI' },
    'pbixImport.csvCreate': { fr: 'Créer la table', en: 'Create table' },
    'pbixImport.csvNameRequired': { fr: 'Choisissez un nom de table.', en: 'Choose a table name.' },
    'pbixImport.csvConfirmText': {
      fr: 'Créer la table « {table} » avec {columns} {columns|colonne|colonnes} et {rows} {rows|ligne|lignes} dans ce document Grist ?',
      en: 'Create the table "{table}" with {columns} {columns|column|columns} and {rows} {rows|row|rows} in this Grist document?'
    },
    'pbixImport.csvConfirmYes': { fr: 'Confirmer la création', en: 'Confirm creation' },
    'pbixImport.csvConfirmNo': { fr: 'Annuler', en: 'Cancel' },
    'pbixImport.csvCreating': { fr: 'Création de la table…', en: 'Creating the table…' },
    'pbixImport.csvCreatingProgress': { fr: 'Création de la table… ({sent}/{total} lignes)', en: 'Creating the table… ({sent}/{total} rows)' },
    'pbixImport.csvCreated': {
      fr: 'Table « {table} » créée avec {rows} {rows|ligne|lignes} — widget reconnecté à cette table.',
      en: 'Table "{table}" created with {rows} {rows|row|rows} — widget reconnected to this table.'
    },
    'pbixImport.csvCreateFailed': { fr: 'Échec de la création de la table — voir la console (F12).', en: 'Failed to create the table — see the console (F12).' },


    // --- Panneau latéral « Ajouter / Modifier une visualisation » (js/main.js ; audit UI/UX du
    // 18/11/2026, lot 2). Les noms de type viennent de `tileForm.type.*`, les lignes des cartes de
    // `advice.*` (js/advice.js). ---
    'tilePanel.open': { fr: 'Ajouter', en: 'Add' },
    'tilePanel.open.aria': { fr: 'Ajouter une visualisation', en: 'Add a visualization' },
    'tilePanel.welcomeAdd': { fr: 'Ajouter une visualisation', en: 'Add a visualization' },
    'tilePanel.title.add': { fr: 'Ajouter une visualisation', en: 'Add a visualization' },
    'tilePanel.title.edit': { fr: 'Modifier la visualisation', en: 'Edit the visualization' },
    'tilePanel.close': { fr: 'Fermer', en: 'Close' },
    'tilePanel.choose.lead': { fr: 'Quelle question voulez-vous poser à vos données ?', en: 'What question do you want to ask your data?' },
    'tilePanel.back': { fr: 'Changer de type', en: 'Change type' },
    'tilePanel.titleField.label': { fr: 'Titre (facultatif)', en: 'Title (optional)' },
    'tilePanel.titleField.placeholder': { fr: 'Titre automatique', en: 'Automatic title' },
    'tilePanel.preview.title': { fr: 'Aperçu', en: 'Preview' },
    'tilePanel.preview.empty': { fr: "Complétez les champs obligatoires pour voir l'aperçu.", en: 'Fill in the required fields to see the preview.' },
    'tilePanel.advanced': { fr: 'Options avancées', en: 'Advanced options' },
    'tileForm.error.columnsRequired': { fr: 'Cochez au moins une colonne.', en: 'Tick at least one column.' },
    'tileForm.error.targetRequired': { fr: 'Saisissez un objectif ou choisissez une colonne d’objectifs.', en: 'Enter a target or choose a target column.' },
    'tileForm.error.targetPositive': { fr: 'L’objectif doit être un nombre supérieur à 0.', en: 'The target must be a number greater than 0.' },
    'tileForm.error.thresholds': { fr: 'Le seuil orange doit être inférieur au seuil vert.', en: 'The orange threshold must be lower than the green one.' },
    'tileForm.error.textRequired': { fr: 'Saisissez le texte à afficher.', en: 'Enter the text to display.' },
    'tileForm.error.measureRequired': { fr: 'Choisissez la colonne à mesurer.', en: 'Choose the column to measure.' },
    'tileForm.error.dimensionRequired': { fr: 'Choisissez la colonne de regroupement.', en: 'Choose the column to group by.' },
    'tileForm.error.measureYRequired': { fr: "Choisissez la colonne de l'axe Y.", en: 'Choose the Y-axis column.' },
    'tileForm.error.comboMeasureRequired': { fr: 'Choisissez la colonne de la courbe, ou passez en Pareto.', en: 'Choose the line column, or switch to Pareto.' },
    'tileForm.error.binsRange': { fr: 'Entrez un nombre entier de classes entre 2 et 60, ou laissez vide.', en: 'Enter a whole number of classes between 2 and 60, or leave empty.' },
    'tileForm.error.columnDimensionRequired': { fr: 'Choisissez la colonne qui forme les colonnes du tableau.', en: "Choose the column that forms the table's columns." },
    'tileForm.error.seriesSameAsDimension': { fr: 'Choisissez une colonne différente de la dimension : une série par valeur de cette colonne.', en: 'Choose a column other than the dimension: one series per value of this column.' },
    'tileForm.error.radarAxisRequired': { fr: 'Ajoutez au moins un axe.', en: 'Add at least one axis.' },

    // --- État vide ---
    'emptyState.hint': {
      fr: "Aucune tuile pour l'instant. Utilisez « Ajouter une visualisation » pour en créer une. Cliquer sur une barre/part filtre les autres tuiles (cumulable entre colonnes différentes ; recliquer retire le filtre). Une tuile avec un « Drill-down » se détaille au clic ; une carte KPI avec une « Tendance vs » affiche l'évolution par rapport à la période précédente.",
      en: 'No tile yet. Use “Add a visualization” to create one. Clicking a bar/slice filters the other tiles (stackable across different columns; click again to remove the filter). A tile with a “Drill-down” expands on click; a KPI card with a “Trend vs” shows the change compared to the previous period.',
    },
    // --- Connexion / statut (js/main.js:bootstrap) ---
    'status.connecting': { fr: 'Connexion…', en: 'Connecting…' },
    'status.noTables': {
      fr: 'Aucune table dans ce document — choisissez-en une via le sélecteur en haut à gauche, ou créez-en une dans Grist.',
      en: 'No table in this document — pick one from the selector at the top left, or create one in Grist.'
    },
    'status.connectionFailed': { fr: 'Échec de la connexion aux données — voir la console (F12).', en: 'Failed to connect to the data — see the console (F12).' },
    'status.retry': { fr: 'Réessayer', en: 'Retry' },
    // Libellés COURTS de la pastille « Données » (la phrase complète va dans l'état vide, ci-dessous).
    'status.noTables.short': { fr: 'Aucune table', en: 'No table' },
    'status.failed.short': { fr: 'Connexion impossible', en: 'Connection failed' },

    // --- Barre unique, menus, modes Lecture/Édition (js/main.js, js/appbar.js ; audit UI/UX du
    // 18/11/2026, lot 1). Bloc à part pour ne pas se marcher dessus avec `advice.*`. ---
    'bar.filter': { fr: 'Filtre', en: 'Filter' },
    'bar.views': { fr: 'Vues', en: 'Views' },
    'bar.export': { fr: 'Exporter', en: 'Export' },
    'mode.edit': { fr: 'Modifier', en: 'Edit' },
    'mode.done': { fr: 'Terminer', en: 'Done' },
    'pages.tablist': { fr: 'Pages', en: 'Pages' },
    'pages.rename.hint': { fr: 'Double-clic pour renommer', en: 'Double-click to rename' },
    'data.popover.aria': { fr: 'Données', en: 'Data' },
    'filters.popover.aria': { fr: 'Filtre', en: 'Filter' },
    'filters.popover.title': { fr: 'Filtrer sur quelle colonne ?', en: 'Filter on which column?' },
    'filters.column.search': { fr: 'Rechercher une colonne…', en: 'Search for a column…' },
    'filters.column.none': { fr: 'Aucune colonne ne correspond.', en: 'No column matches.' },
    'filters.column.aria': { fr: '{name}, colonne de type {kind}', en: '{name}, {kind} column' },
    'filters.kind.text': { fr: 'texte', en: 'text' },
    'filters.kind.number': { fr: 'nombre', en: 'number' },
    'filters.kind.date': { fr: 'date', en: 'date' },
    'filters.back': { fr: '← Colonnes', en: '← Columns' },
    'filters.values.aria': { fr: 'Valeurs de la colonne', en: 'Column values' },
    'filters.values.more': { fr: '{n} autres valeurs : tapez pour affiner.', en: '{n} more values: type to narrow down.' },
    'filters.values.hint': { fr: 'Cliquez une valeur pour filtrer tout de suite, ou tapez un morceau de texte.', en: 'Click a value to filter right away, or type part of a text.' },
    'views.popover.aria': { fr: 'Vues', en: 'Views' },
    'views.saved': { fr: 'Vues sauvegardées', en: 'Saved views' },
    // Suivi de la vue active (retours d'Antoine du 18/11/2026, point 4).
    'views.empty': {
      fr: 'Aucune vue sauvegardée pour l\'instant. Posez des filtres, puis sauvegardez-les ici pour y revenir en un clic.',
      en: 'No saved view yet. Set some filters, then save them here to come back to them in one click.'
    },
    'views.modified': { fr: 'modifiée', en: 'modified' },
    'views.current': { fr: 'vue active', en: 'current view' },
    'views.apply.aria': { fr: 'Appliquer la vue « {name} »', en: 'Apply view “{name}”' },
    'views.delete.aria': { fr: 'Supprimer la vue « {name} »', en: 'Delete view “{name}”' },
    'views.delete.title': { fr: 'Supprimer la vue', en: 'Delete view' },
    'views.delete.confirm': {
      fr: 'Supprimer la vue « {name} » ? Les filtres actuels ne changent pas.',
      en: 'Delete view “{name}”? The current filters stay as they are.'
    },
    'views.update': { fr: 'Mettre à jour « {name} »', en: 'Update “{name}”' },
    'views.saveNew': { fr: 'Sauvegarder comme nouvelle vue', en: 'Save as a new view' },
    'views.leave': { fr: 'Quitter la vue (les filtres restent)', en: 'Leave the view (filters stay)' },
    'views.chip.label': { fr: 'Vue', en: 'View' },
    'views.chip.update': { fr: 'Mettre à jour', en: 'Update' },
    'views.toggle.aria': { fr: 'Vues — vue active : {name}', en: 'Views — current view: {name}' },
    'views.toggle.ariaModified': { fr: 'Vues — vue active : {name} (modifiée)', en: 'Views — current view: {name} (modified)' },
    'export.menu.aria': { fr: 'Exporter', en: 'Export' },
    'blend.title': { fr: 'Joindre une autre table', en: 'Join another table' },
    'emptyState.readHint': {
      fr: 'Ce tableau de bord est vide. Cliquez sur « Modifier » pour ajouter une visualisation.',
      en: 'This dashboard is empty. Click “Edit” to add a visualization.',
    },

    // --- Fenêtres de dialogue du kit (js/dialogs.js, audit UI/UX du 18/11/2026) : remplacent
    // window.prompt/confirm/alert, muets dans le cadre isolé de GFS (pas de `allow-modals`). ---
    'dialog.confirm': { fr: 'Valider', en: 'OK' },
    'dialog.cancel': { fr: 'Annuler', en: 'Cancel' },
    'dialog.close': { fr: 'Fermer', en: 'Close' },
    'dialog.notice.title': { fr: 'Information', en: 'Notice' },

    // --- Extensions de GFS (js/extensions.js, consigne 019) : une fonction d'extension est grisée, jamais masquée ---
    'ext.name.nuage-de-mots': { fr: 'Nuage de mots', en: 'Word cloud' },
    'ext.name.mots-cles-pdf': { fr: 'Mots-clés des PDF', en: 'PDF keywords' },
    'ext.pending.hosted': { fr: 'Pas encore : extension « {extension} » à ajouter', en: 'Not yet: add the “{extension}” extension' },
    'ext.pending.standalone': { fr: 'Pas encore : disponible dans Grist Factory Suite', en: 'Not yet: available in Grist Factory Suite' },
    'ext.standalone.title': { fr: 'Cette fonction demande Grist Factory Suite', en: 'This feature needs Grist Factory Suite' },
    'ext.standalone.body': {
      fr: '« {feature} » fait partie de l’extension « {extension} », disponible quand Grist BI tourne dans Grist Factory Suite. Pour l’ajouter sans rien perdre : dans le panneau de droite de Grist, remplacez l’adresse du widget par celle de Grist Factory Suite. Ne passez pas par la galerie des widgets : elle effacerait les réglages de cette vue. Vos rapports et vos réglages restent tels quels, et vous pourrez revenir à l’adresse de Grist BI à tout moment.',
      en: '“{feature}” is part of the “{extension}” extension, available when Grist BI runs inside Grist Factory Suite. To add it without losing anything: in Grist’s right panel, replace the widget’s address with the Grist Factory Suite address. Do not use the widget gallery: it would erase this view’s settings. Your reports and settings stay as they are, and you can switch back to the Grist BI address at any time.'
    },
    'dialog.error.title': { fr: 'Une erreur est survenue', en: 'Something went wrong' },
    'pages.new.title': { fr: 'Nouvelle page', en: 'New page' },
    'pages.new.confirm': { fr: 'Créer la page', en: 'Create page' },
    'pages.rename.title': { fr: 'Renommer la page', en: 'Rename page' },
    'pages.rename.confirm': { fr: 'Renommer', en: 'Rename' },
    'pages.remove.dialogTitle': { fr: 'Supprimer la page', en: 'Delete page' },
    'pages.remove.confirmLabel': { fr: 'Supprimer', en: 'Delete' },
    'bookmarks.save.title': { fr: 'Sauvegarder la vue', en: 'Save view' },
    'bookmarks.save.confirm': { fr: 'Sauvegarder', en: 'Save' },
    'views.delete.dialogTitle': { fr: 'Supprimer la vue', en: 'Delete view' },
    'views.delete.confirmLabel': { fr: 'Supprimer', en: 'Delete' },

    // --- Titres de tuile composés automatiquement (js/main.js:autoTileTitle ; la tuile garde aussi
    // son `title` en clair, voir i18n.js:tileTitle). ---
    'tileTitle.measureByDimension': { fr: '{measure} par {dimension}', en: '{measure} by {dimension}' },
    'tileTitle.measureByDimensionSeries': { fr: '{measure} par {dimension} et {series}', en: '{measure} by {dimension} and {series}' },
    'tileTitle.pivot': { fr: '{measure} par {dimension} × {columnDimension}', en: '{measure} by {dimension} × {columnDimension}' },
    'tileTitle.radarColumns': { fr: 'Radar : {axes}', en: 'Radar: {axes}' },
    'tileTitle.text': { fr: 'Texte', en: 'Text' },
    'tileTitle.progress': { fr: 'Progression : {measure} par {dimension}', en: 'Progress: {measure} by {dimension}' },
    'tileTitle.combo': { fr: '{measure} et {measureY} par {dimension}', en: '{measure} and {measureY} by {dimension}' },
    'tileTitle.pareto': { fr: 'Pareto : {measure} par {dimension}', en: 'Pareto: {measure} by {dimension}' },
    'tileTitle.histogram': { fr: 'Répartition de {measure}', en: 'Distribution of {measure}' },
    'tileTitle.box': { fr: 'Répartition de {measure} par {dimension}', en: 'Distribution of {measure} by {dimension}' },
    'tileTitle.bubble': { fr: '{measure} et {measureY} par {dimension}, taille : {measureSize}', en: '{measure} and {measureY} by {dimension}, size: {measureSize}' },
    'tileTitle.calendar': { fr: '{measure} par jour ({dimension})', en: '{measure} per day ({dimension})' },
    'tileTitle.sankey': { fr: '{measure} : {dimension} → {columnDimension}', en: '{measure}: {dimension} → {columnDimension}' },
    'tileTitle.sunburst': { fr: '{measure} : {levels}', en: '{measure}: {levels}' },
    'tileTitle.heatmap': { fr: '{measure} par {dimension} × {columnDimension}', en: '{measure} by {dimension} × {columnDimension}' },
    'tileTitle.table': { fr: 'Table : {columns}', en: 'Table: {columns}' },
    'tileTitle.wordCloud': { fr: 'Nuage de mots : {dimension}', en: 'Word cloud: {dimension}' },
    'tileTitle.cumulative': { fr: 'Cumul : {agg}({measure})', en: 'Running total: {agg}({measure})' },
    'tileTitle.ytd': { fr: 'YTD : {agg}({measure})', en: 'YTD: {agg}({measure})' },
    'tileTitle.yoy': { fr: 'Comparaison N-1 : {agg}({measure})', en: 'Year-over-year: {agg}({measure})' },

    // --- GFS (js/grist-api.js:nextNewReportName, consigne 007) : nom par défaut d'un nouveau
    // rapport, posé au premier enregistrement — seul cas où js/grist-api.js (normalement sans
    // dépendance au DOM) passe par ce module, la consigne demandant explicitement ce nom "dans la
    // langue de la personne" plutôt qu'un texte figé.
    'gfs.newReportName': { fr: 'Rapport BI {n}', en: 'BI report {n}' },

    // --- Conseil de visualisation et suggestions de tuiles (js/advice.js) ---
    // Titres persistés des tuiles suggérées (résolus à la création, voir advice.js:suggestTiles).
    'advice.title.byDimension': { fr: '{measure} par {dimension}', en: '{measure} by {dimension}' },
    'advice.title.countBy': { fr: 'Nombre de lignes par {dimension}', en: 'Number of rows by {dimension}' },
    'advice.title.countAll': { fr: 'Nombre de lignes', en: 'Number of rows' },
    'advice.title.total': { fr: 'Total {measure}', en: 'Total {measure}' },
    'advice.title.average': { fr: 'Moyenne {measure}', en: 'Average {measure}' },
    'advice.title.scatter': { fr: '{measureY} selon {measure} (par {dimension})', en: '{measureY} vs {measure} (by {dimension})' },
    'advice.title.byTwoDimensions': { fr: '{measure} par {dimension} × {columnDimension}', en: '{measure} by {dimension} × {columnDimension}' },
    'advice.title.radar': { fr: 'Profil : {axes}', en: 'Profile: {axes}' },
    // Une ligne de raison sous chaque carte de suggestion.
    'advice.reason.kpiTotal': { fr: 'Le chiffre clé à afficher en premier : le total de {measure}.', en: 'The headline figure to show first: the total of {measure}.' },
    'advice.reason.kpiAverage': { fr: 'Le chiffre clé à afficher en premier : la moyenne de {measure}.', en: 'The headline figure to show first: the average of {measure}.' },
    'advice.reason.kpiTrend': { fr: 'Le chiffre clé à afficher en premier : {measure}, avec son évolution par rapport à la période précédente ({dimension}).', en: 'The headline figure to show first: {measure}, with its change from the previous period ({dimension}).' },
    'advice.reason.kpiCount': { fr: 'Le nombre de lignes du tableau, pour situer l’ampleur des données.', en: 'The number of rows in the table, to show the size of the data.' },
    'advice.reason.lineTime': { fr: 'Évolution dans le temps ({dimension}) : une courbe montre la tendance mieux que des barres.', en: 'Change over time ({dimension}): a line shows the trend better than bars.' },
    'advice.reason.barCompare': { fr: 'Comparer {n} valeurs de {dimension} d’un coup d’œil.', en: 'Compare {n} values of {dimension} at a glance.' },
    'advice.reason.piePart': { fr: 'Seulement {n} parts : un anneau montre bien le poids de chacune dans le tout ({dimension}).', en: 'Only {n} slices: a donut shows each one’s weight in the whole ({dimension}).' },
    'advice.reason.treemapShare': { fr: '{n} valeurs de {dimension} : le treemap montre la part de chacune sans surcharger l’écran.', en: '{n} values of {dimension}: the treemap shows each share without crowding the screen.' },
    'advice.reason.scatterRelation': { fr: 'Voir si {measure} et {measureY} évoluent ensemble.', en: 'See whether {measure} and {measureY} move together.' },
    'advice.reason.pivotCross': { fr: 'Croiser {dimension} et {columnDimension} dans un seul tableau.', en: 'Cross {dimension} and {columnDimension} in a single table.' },
    'advice.reason.radarSkills': { fr: '{n} colonnes sur une même échelle : un radar compare un profil à la moyenne du groupe.', en: '{n} columns on the same scale: a radar compares one profile with the group average.' },
    // « Quand l'utiliser » : une ligne par type de tuile (étape « Choisir »).
    'advice.use.bar': { fr: 'Comparer des catégories entre elles (idéal jusqu’à une douzaine, triées par valeur).', en: 'Compare categories with each other (best up to about a dozen, sorted by value).' },
    'advice.use.line': { fr: 'Suivre une évolution dans le temps : les points sont reliés dans l’ordre.', en: 'Follow a change over time: points are joined in order.' },
    'advice.use.combo': { fr: 'Lire deux mesures de même catégorie (barres + courbe), ou repérer les catégories qui font 80 % du total (Pareto).', en: 'Read two measures of the same category (bars + line), or spot the categories that make up 80% of the total (Pareto).' },
    'advice.use.histogram': { fr: 'Voir comment se répartissent les valeurs d’une colonne numérique : où elles se concentrent, où elles s’étalent.', en: 'See how the values of a numeric column are spread: where they cluster, where they scatter.' },
    'advice.use.heatmap': { fr: 'Repérer d’un coup d’œil où une mesure se concentre en croisant deux catégories (jour × heure, région × produit).', en: 'Spot at a glance where a measure concentrates by crossing two categories (day × hour, region × product).' },
    'advice.use.box': { fr: 'Comparer la répartition d’une valeur entre plusieurs groupes : médiane, quartiles et valeurs hors norme (notes par classe, délais par service).', en: 'Compare how a value is spread across groups: median, quartiles and outliers (marks per class, lead times per team).' },
    'advice.box.tooManyGroups': { fr: '{n} groupes : les boîtes deviennent trop fines pour se lire. Regroupez (famille plutôt que produit) ou filtrez.', en: '{n} groups: the boxes get too thin to read. Group them (family rather than product) or filter.' },
    'advice.box.fewValues': { fr: 'Moins de 5 valeurs par groupe : des quartiles sur si peu de points disent peu. Un tableau ou des barres se liront mieux.', en: 'Fewer than 5 values per group: quartiles on so few points say little. A table or bars will read better.' },
    'advice.use.sankey': { fr: 'Voir où va un flux : d’une colonne de départ vers une colonne d’arrivée (canal → statut, origine → destination), l’épaisseur donne la quantité.', en: 'See where a flow goes: from a start column to an end column (channel → status, origin → destination), thickness shows the amount.' },
    'advice.sankey.tooManyNodes': { fr: '{nodes} nœuds : au-delà d’une quinzaine le diagramme devient un écheveau. Regroupez les valeurs rares ou filtrez.', en: '{nodes} nodes: beyond about fifteen the diagram turns into a tangle. Group the rare values or filter.' },
    'advice.sankey.notAdditive': { fr: 'Un flux s’additionne : avec une moyenne, un minimum ou un maximum, la hauteur d’un nœud serait une somme de moyennes. Choisissez Somme ou Comptage.', en: 'A flow adds up: with an average, a minimum or a maximum, a node’s height would be a sum of averages. Choose Sum or Count.' },
    'advice.sunburst.notAdditive': { fr: 'Un soleil additionne ses parts : avec une moyenne, un minimum ou un maximum, l’angle d’une part ne serait pas la somme de ses sous-parts. La tuile affiche des sommes : choisissez Somme ou Comptage.', en: 'A sunburst adds up its parts: with an average, a minimum or a maximum, a part’s angle would not be the sum of its sub-parts. The tile shows sums: choose Sum or Count.' },
    'advice.sunburst.negative': { fr: 'Des valeurs négatives : une part ne peut pas avoir d’angle négatif, les parts à valeur négative ne sont pas dessinées. Utilisez des barres pour comparer.', en: 'Negative values: a part cannot have a negative angle, parts with a negative value are not drawn. Use bars to compare.' },
    'advice.sunburst.tooManyLevels': { fr: 'Au-delà de {max} anneaux, les derniers ne se lisent plus : seuls {max} sont dessinés.', en: 'Beyond {max} rings the last ones can’t be read: only {max} are drawn.' },
    'advice.sunburst.tooManyColors': { fr: '{n} parts au centre pour {max} couleurs : des couleurs se répètent. Filtrez ou choisissez un anneau central à moins de valeurs.', en: '{n} central parts for {max} colours: colours repeat. Filter, or choose a central ring with fewer values.' },
    'advice.sunburst.hidden': { fr: '{n} petites parts ne sont pas dessinées (au plus {max} par part : les plus grandes). Elles restent dans l’export.', en: '{n} small parts are not drawn (at most {max} per part: the largest). They stay in the export.' },
    'advice.sankey.dropped': { fr: '{n} flux nuls ou négatifs ne sont pas dessinés : un flux ne peut pas avoir une épaisseur négative.', en: '{n} zero or negative flows are not drawn: a flow cannot have a negative thickness.' },
    'advice.heatmap.tooBig': { fr: '{rows} lignes × {columns} colonnes : les cases deviennent trop petites pour s’y lire. Regroupez (mois plutôt que jours, famille plutôt que produit).', en: '{rows} rows × {columns} columns: the cells get too small to read. Group them (months rather than days, family rather than product).' },
    'advice.histogram.fewValues': { fr: 'Moins de 5 valeurs différentes : un graphique en barres, une par valeur, se lira mieux.', en: 'Fewer than 5 distinct values: a bar chart, one bar per value, will read better.' },
    'advice.combo.paretoAgg': { fr: 'Un Pareto additionne des parts : choisissez Somme ou Comptage (une moyenne ou un min/max ne se cumule pas).', en: 'A Pareto adds up shares: choose Sum or Count (an average or min/max does not accumulate).' },
    'advice.combo.paretoNegative': { fr: 'Des valeurs négatives : un Pareto ne compte que les valeurs positives.', en: 'Negative values: a Pareto only counts positive values.' },
    'advice.combo.sameSeries': { fr: 'La courbe reprend la mesure et l’agrégat des barres : elle n’apporte rien. Choisissez une autre colonne ou un autre agrégat.', en: 'The line repeats the bars’ measure and aggregate, so it adds nothing. Pick another column or aggregate.' },
    'advice.combo.manyBars': { fr: '{n} catégories : les barres deviennent étroites. Regroupez, ou gardez les plus grandes.', en: '{n} categories: the bars get narrow. Group them, or keep the largest.' },
    'advice.use.pie': { fr: 'Montrer la part de chacun dans un tout, avec peu de parts (6 au plus).', en: 'Show each part’s share of a whole, with few parts (6 at most).' },
    'advice.use.funnel': { fr: 'Suivre ce qui se perd d’une étape à l’autre d’un parcours (visiteurs, candidatures, ventes…).', en: 'Follow what is lost from one stage to the next in a process (visitors, applications, sales…).' },
    'advice.use.treemap': { fr: 'Voir les parts de nombreuses catégories sans surcharger l’écran.', en: 'See the shares of many categories without crowding the screen.' },
    'advice.use.sunburst': { fr: 'Voir comment un total se répartit à plusieurs niveaux : des anneaux concentriques, du plus général au plus fin (région, puis produit).', en: 'See how a total splits across several levels: concentric rings, from the broadest to the finest (region, then product).' },
    'advice.use.scatter': { fr: 'Voir si deux mesures évoluent ensemble, un point par catégorie ; une 3e mesure en taille en fait des bulles.', en: 'See whether two measures move together, one point per category; a 3rd measure as size makes them bubbles.' },
    'advice.use.waterfall': { fr: 'Décomposer comment des hausses et des baisses mènent à un total.', en: 'Break down how increases and decreases add up to a total.' },
    'advice.use.radar': { fr: 'Comparer un profil à la moyenne du groupe sur 3 à 8 axes.', en: 'Compare one profile with the group average on 3 to 8 axes.' },
    'advice.use.wordcloud': { fr: 'Repérer les mots les plus fréquents d’une colonne de texte.', en: 'Spot the most frequent words in a text column.' },
    'advice.use.kpi': { fr: 'Mettre en avant UN chiffre clé, avec sa tendance.', en: 'Highlight ONE key figure, with its trend.' },
    'advice.use.progress': { fr: 'Situer chaque catégorie par rapport à son objectif, en % atteint (vert, orange, rouge).', en: 'Place each category against its target, as % reached (green, orange, red).' },
    'advice.use.table': { fr: 'Lire les lignes une à une, avec les colonnes de votre choix, triables d’un clic sur l’en-tête.', en: 'Read the rows one by one, with the columns you pick, sortable by clicking a header.' },
    'advice.use.text': { fr: 'Poser un titre, une consigne de lecture ou une source sur la page, sans aucune donnée.', en: 'Put a heading, reading instructions or a source on the page, with no data.' },
    'advice.use.gauge': { fr: 'Situer une valeur entre un minimum et un maximum (un objectif).', en: 'Place one value between a minimum and a maximum (a target).' },
    'advice.use.pivot': { fr: 'Croiser deux catégories dans un tableau de chiffres.', en: 'Cross two categories in a table of figures.' },
    // Type inutilisable avec les données du tableau.
    'advice.fit.needTwoMeasures': { fr: 'Il faut deux colonnes numériques : ce tableau n’en a pas assez.', en: 'Needs two numeric columns: this table doesn’t have enough.' },
    'advice.fit.needTwoDimensions': { fr: 'Il faut deux colonnes de catégories : ce tableau n’en a pas assez.', en: 'Needs two category columns: this table doesn’t have enough.' },
    'advice.fit.needText': { fr: 'Il faut une colonne de texte : ce tableau n’en a pas.', en: 'Needs a text column: this table has none.' },
    'advice.fit.noTime': { fr: 'Aucune colonne de date ou d’année dans ce tableau : une courbe n’aurait pas d’ordre naturel.', en: 'No date or year column in this table: a line would have no natural order.' },
    'advice.fit.noMeasure': { fr: 'Aucune colonne numérique dans ce tableau : seul un comptage de lignes est possible.', en: 'No numeric column in this table: only a row count is possible.' },
    // Avertissements de lisibilité sur une tuile.
    'advice.pie.negative': { fr: 'Un camembert ne peut pas représenter des valeurs négatives : utilisez des barres.', en: 'A pie chart can’t show negative values: use bars instead.' },
    'advice.pie.tooManySlices': { fr: '{n} parts : au-delà de 7, un camembert devient difficile à lire. Passez en barres triées ou regroupez les petites parts.', en: '{n} slices: beyond 7, a pie chart is hard to read. Switch to sorted bars or group the small slices.' },
    'advice.funnel.negative': { fr: 'Un entonnoir ne peut pas représenter des valeurs négatives : utilisez des barres.', en: 'A funnel can’t show negative values: use bars instead.' },
    'advice.funnel.tooManyStages': { fr: '{n} étapes : au-delà de 10, un entonnoir devient illisible. Regroupez les étapes ou passez en barres horizontales.', en: '{n} stages: beyond 10, a funnel becomes hard to read. Group the stages or switch to horizontal bars.' },
    'advice.series.tooMany': { fr: '{n} séries : au-delà de {max}, les couleurs se répètent et la légende devient illisible. Filtrez ou choisissez une colonne à moins de valeurs.', en: '{n} series: beyond {max}, colours repeat and the legend becomes unreadable. Filter, or choose a column with fewer values.' },
    'advice.smallMultiples.tooMany': { fr: '{n} séries : au-delà de {max}, les petits graphiques deviennent trop petits pour se lire, seuls les {max} premiers sont dessinés. Filtrez ou choisissez une colonne à moins de valeurs.', en: '{n} series: beyond {max}, the small charts become too small to read, only the first {max} are drawn. Filter, or choose a column with fewer values.' },
    'advice.smallMultiples.single': { fr: 'La colonne « Séries » n’a qu’une valeur : il n’y a qu’un seul petit graphique, autant décocher cette option.', en: 'The “Series” column has only one value: there is a single small chart, so you may as well untick this option.' },
    'advice.smallMultiples.tooManyCategories': { fr: '{n} catégories : au-delà de {max}, elles ne se lisent plus dans un petit graphique. Regroupez-les (mois plutôt que jours) ou passez à un graphique unique.', en: '{n} categories: beyond {max}, they can’t be read in a small chart. Group them (months rather than days) or use a single chart.' },
    'advice.stackedPercent.negative': { fr: 'Des valeurs négatives : en 100 %, les parts d’une pile qui descend sous zéro ne se lisent pas. Décochez « En 100 % » ou filtrez les négatifs.', en: 'Negative values: in 100 % mode, the shares of a stack that goes below zero cannot be read. Untick “100 %” or filter out the negatives.' },
    'advice.stacked.notAdditive': { fr: 'Une pile additionne les hauteurs : pour une moyenne, un minimum ou un maximum, le total n’a pas de sens. Utilisez Somme ou Comptage, ou décochez « Empiler ».', en: 'A stack adds up heights: for an average, minimum or maximum the total is meaningless. Use Sum or Count, or untick “Stack”.' },
    'advice.series.sameAsDimension': { fr: 'La colonne « Séries » est la même que la dimension : chaque barre n’aurait qu’une série. Choisissez une autre colonne.', en: 'The “Series” column is the same as the dimension: each bar would have a single series. Choose another column.' },
    'advice.treemap.negative': { fr: 'Un treemap ne peut pas représenter des valeurs négatives : utilisez des barres.', en: 'A treemap can’t show negative values: use bars instead.' },
    'advice.line.notTime': { fr: '{dimension} n’a pas d’ordre naturel : une courbe relierait des valeurs sans lien entre elles. Préférez des barres.', en: '{dimension} has no natural order: a line would join unrelated values. Prefer bars.' },
    'advice.line.valueSort': { fr: 'Trier une courbe par valeur casse l’ordre du temps : gardez l’ordre des données ou triez par libellé.', en: 'Sorting a line by value breaks the time order: keep the data order or sort by label.' },
    'advice.line.unordered': { fr: 'Les valeurs de {dimension} ne sont pas dans l’ordre chronologique dans vos données : triez par libellé pour éviter une courbe en zigzag.', en: 'The values of {dimension} are not in chronological order in your data: sort by label to avoid a zigzag line.' },
    'advice.line.fewPoints': { fr: 'Seulement {n} points : des barres seraient plus claires qu’une courbe.', en: 'Only {n} points: bars would be clearer than a line.' },
    'advice.waterfall.unordered': { fr: 'Une cascade cumule dans l’ordre des données, et {dimension} n’y est pas chronologique : triez les lignes de votre table par date.', en: 'A waterfall accumulates in data order, and {dimension} isn’t chronological there: sort your table rows by date.' },
    'advice.radar.mixedScales': { fr: 'Les colonnes « {small} » et « {big} » n\'ont pas le même ordre de grandeur : tous les axes partagent une échelle, la plus petite sera écrasée au centre. Gardez des colonnes de même unité.', en: 'Columns "{small}" and "{big}" are on very different scales: all axes share one scale, so the smaller one is squashed into the centre. Keep columns with the same unit.' },
    'advice.radar.tooManyAxes': { fr: '{n} axes : au-delà de 8, un radar devient illisible. Gardez les axes essentiels ou passez en barres.', en: '{n} axes: beyond 8, a radar becomes unreadable. Keep the essential axes or switch to bars.' },
    'advice.gauge.outOfRange': { fr: 'La valeur actuelle ({value}) sort de l’échelle {min} – {max} : ajustez le minimum et le maximum.', en: 'The current value ({value}) is outside the {min} – {max} scale: adjust the minimum and maximum.' },
    'advice.data.mostlyEmpty': { fr: '{column} est vide dans {pct} % des lignes : le graphique ne reflète qu’une partie des données.', en: '{column} is empty in {pct}% of rows: the chart only reflects part of the data.' },
    'advice.bar.horizontal': { fr: '{n} catégories : passez en barres horizontales pour que les libellés restent lisibles.', en: '{n} categories: switch to horizontal bars to keep the labels readable.' },
    'advice.bar.longLabels': { fr: 'Libellés longs (jusqu’à {maxLen} caractères) : des barres horizontales les affichent en entier.', en: 'Long labels (up to {maxLen} characters): horizontal bars show them in full.' },
    'advice.bar.unsorted': { fr: 'Triez par valeur pour repérer d’un coup d’œil le plus grand et le plus petit.', en: 'Sort by value to spot the largest and smallest at a glance.' },

    // --- Modèles de rapport de « Nouveau > Depuis un modèle » de GFS (js/models.js, consigne 016) ---
    'models.page.overview': { fr: 'Vue d’ensemble', en: 'Overview' },
    'models.page.evolution': { fr: 'Évolution', en: 'Trend' },
    'models.page.breakdown': { fr: 'Répartition', en: 'Breakdown' },
    'models.title.seriesBy': { fr: '{measure} par {series}', en: '{measure} by {series}' },
    'models.need.data': { fr: 'une table avec des lignes de données', en: 'a table with rows of data' },
    'models.need.time': { fr: 'une colonne de dates (ou d’années)', en: 'a column of dates (or years)' },
    'models.need.category': { fr: 'une colonne de catégories (du texte qui se répète)', en: 'a column of categories (text that repeats)' },
    'models.needAnd': { fr: 'et', en: 'and' },
    'models.noFit': { fr: 'Ce modèle n’a pas été ouvert : il lui faut {needs}, et aucune table de ce document n’en a.', en: 'This template was not opened: it needs {needs}, and no table in this document has it.' },
    'models.noTables': { fr: 'Ce modèle n’a pas été ouvert : ce document n’a encore aucune table à analyser.', en: 'This template was not opened: this document has no table to analyse yet.' },
    'models.unknown': { fr: 'Ce modèle n’a pas été ouvert : cette version de Grist BI ne le connaît pas.', en: 'This template was not opened: this version of Grist BI does not know it.' },
    'models.failed': { fr: 'Ce modèle n’a pas pu être ouvert : la lecture du document a échoué.', en: 'This template could not be opened: reading the document failed.' },

    // --- Écran d'accueil d'un tableau de bord sans tuile (js/welcome.js) ---
    'welcome.title': { fr: 'Pour commencer', en: 'Get started' },
    'welcome.subtitle': { fr: 'Des visualisations adaptées à vos données : un clic suffit, vous pourrez les modifier ensuite.', en: 'Visualizations that fit your data: one click is enough, and you can edit them afterwards.' },
    'welcome.add': { fr: 'Ajouter', en: 'Add' },
    'welcome.addAria': { fr: 'Ajouter la visualisation « {title} »', en: 'Add the visualization “{title}”' },
    'welcome.addAll': { fr: '{n|Ajouter cette visualisation|Ajouter ces {n} visualisations}', en: '{n|Add this visualization|Add these {n} visualizations}' },
    'welcome.importPbix': { fr: 'Importer un fichier Power BI…', en: 'Import a Power BI file…' },
    'welcome.emptyTable': { fr: 'La table « {table} » ne contient encore aucune ligne : ajoutez-en dans Grist, des suggestions apparaîtront ici.', en: 'Table “{table}” has no rows yet: add some in Grist and suggestions will appear here.' },

    // --- Graphiques (js/charts.js) ---
    'chart.unavailable': { fr: 'ECharts indisponible — voir le bandeau en haut de page.', en: 'ECharts unavailable — see the banner at the top of the page.' },
    'chart.wordCloudNeedsExtension': { fr: 'Nuage de mots : l’extension « Nuage de mots » n’est pas encore ajoutée (Apps et extensions, dans Grist Factory Suite).', en: 'Word cloud: the “Word cloud” extension is not added yet (Apps and extensions, in Grist Factory Suite).' },
    'chart.wordCloudNeedsGfs': { fr: 'Nuage de mots : fonction de l’extension « Nuage de mots », disponible quand Grist BI tourne dans Grist Factory Suite.', en: 'Word cloud: a feature of the “Word cloud” extension, available when Grist BI runs inside Grist Factory Suite.' },
    'chart.measureFailed': { fr: 'Échec du calcul de la mesure — voir la console (F12).', en: 'Measure calculation failed — see the console (F12).' },
    'chart.computing': { fr: 'Calcul…', en: 'Computing…' },
    'chart.pivot.total': { fr: 'Total', en: 'Total' },
    'export.table.more': { fr: '… {n} lignes de plus (voir l’export Excel)', en: '… {n} more rows (see the Excel export)' },
    'chart.kpi.goalPct': { fr: '{pct} de l’objectif', en: '{pct} of target' },
    'chart.kpi.goalTarget': { fr: 'objectif {target}', en: 'target {target}' },
    'chart.progress.empty': { fr: 'Aucune donnée à afficher.', en: 'No data to show.' },
    'chart.progress.row': { fr: '{label} : {value} sur {target}', en: '{label}: {value} of {target}' },
    'chart.progress.legend': { fr: 'Vert ≥ {good} % · orange {warn}–{good} % · rouge < {warn} %', en: 'Green ≥ {good}% · orange {warn}–{good}% · red < {warn}%' },
    'chart.table.empty': { fr: 'Aucune ligne à afficher.', en: 'No rows to show.' },
    'chart.table.noColumns': { fr: 'Aucune colonne à afficher : modifiez la tuile.', en: 'No column to show: edit the tile.' },
    'chart.table.sortBy': { fr: 'Trier par {column}', en: 'Sort by {column}' },
    'chart.table.truncated': { fr: '{shown} lignes affichées sur {total}. Filtrez pour réduire la liste ; l’export Excel en contient jusqu’à 100 000.', en: '{shown} rows shown out of {total}. Filter to narrow the list; the Excel export holds up to 100,000.' },
    'chart.breadcrumb.hint': { fr: '(cliquer pour détailler par {column})', en: '(click to drill down by {column})' },
    'chart.waterfall.base': { fr: 'Base (cumul)', en: 'Base (running total)' },
    'chart.waterfall.increase': { fr: 'Hausse', en: 'Increase' },
    'chart.waterfall.decrease': { fr: 'Baisse', en: 'Decrease' },
    'chart.funnel.ofFirst': { fr: '{pct} de la 1re étape', en: '{pct} of the first stage' },
    'chart.stacked.total': { fr: 'Total', en: 'Total' },
    'chart.smallMultiples.hidden': { fr: 'Les {shown} premières séries sur {n}', en: 'First {shown} of {n} series' },
    'chart.combo.cumulative': { fr: 'Part cumulée', en: 'Cumulative share' },
    'chart.histogram.empty': { fr: 'Aucune valeur numérique dans cette colonne.', en: 'No numeric value in this column.' },
    'chart.histogram.rows': { fr: '{n} {count|ligne|lignes}', en: '{n} {count|row|rows}' },
    'chart.box.empty': { fr: 'Aucune valeur numérique à répartir par groupe.', en: 'No numeric value to spread by group.' },
    'chart.box.count': { fr: '{n} {count|valeur|valeurs}', en: '{n} {count|value|values}' },
    'chart.box.max': { fr: 'Moustache haute', en: 'Upper whisker' },
    'chart.box.q3': { fr: '3e quartile', en: '3rd quartile' },
    'chart.box.median': { fr: 'Médiane', en: 'Median' },
    'chart.box.q1': { fr: '1er quartile', en: '1st quartile' },
    'chart.box.min': { fr: 'Moustache basse', en: 'Lower whisker' },
    'chart.box.outliers': { fr: '{n} {count|valeur aberrante|valeurs aberrantes}', en: '{n} {count|outlier|outliers}' },
    'chart.box.outlier': { fr: 'Valeur aberrante', en: 'Outlier' },
    'chart.sankey.empty': { fr: 'Aucun flux positif à dessiner pour ces deux colonnes.', en: 'No positive flow to draw for these two columns.' },
    'chart.sunburst.empty': { fr: 'Aucune part à dessiner : les colonnes des anneaux sont vides, ou la valeur ne dépasse pas zéro.', en: 'Nothing to draw: the ring columns are empty, or the value is not above zero.' },
    'chart.sunburst.hidden': { fr: '{n} {n|petite part non dessinée|petites parts non dessinées}', en: '{n} small {n|part|parts} not drawn' },
    'chart.sankey.node': { fr: 'Total', en: 'Total' },
    'chart.sankey.capped': { fr: '{shown} flux les plus importants sur {total}', en: 'Top {shown} flows of {total}' },
    'chart.refLine.average': { fr: 'Moyenne', en: 'Average' },
    'chart.refLine.value': { fr: 'Objectif', en: 'Target' },
    'chart.heatmap.empty': { fr: 'Aucune valeur à croiser pour ces deux colonnes.', en: 'No value to cross for these two columns.' },
    'chart.series.empty': { fr: '(vide)', en: '(empty)' },
    'chart.radar.groupAverage': { fr: 'Moyenne du groupe', en: 'Group average' },

    // --- Options d'affichage des graphiques (courbe/aire, anneau, barres horizontales, tri) ---
    // Bloc séparé, en fin de fichier : pour limiter les conflits avec les refontes d'interface en
    // parallèle qui ajoutent leurs propres clés ailleurs dans ce dictionnaire.
    'tileForm.type.line': { fr: 'Courbe / aire', en: 'Line / area' },
    'tileForm.type.combo': { fr: 'Barres + courbe', en: 'Bars + line' },
    'tileForm.type.histogram': { fr: 'Histogramme', en: 'Histogram' },
    'tileForm.stackPercent.label': { fr: 'En 100 % : la part de chaque série dans la catégorie', en: 'As 100 %: each series’ share of the category' },
    'tileForm.smallMultiples.label': { fr: 'Un petit graphique par série (même échelle pour tous)', en: 'One small chart per series (same scale for all)' },
    'tileForm.lineShape.label': { fr: 'Tracé de la courbe', en: 'Line shape' },
    'tileForm.lineShape.straight': { fr: 'Droit (point à point)', en: 'Straight (point to point)' },
    'tileForm.lineShape.smooth': { fr: 'Lissé', en: 'Smooth' },
    'tileForm.lineShape.step': { fr: 'En escalier', en: 'Stepped' },
    'tileForm.valueLabels.label': { fr: 'Écrire les valeurs sur le graphique', en: 'Write the values on the chart' },
    'tileForm.refLine.label': { fr: 'Ligne de repère', en: 'Reference line' },
    'tileForm.refLine.none': { fr: 'Aucune', en: 'None' },
    'tileForm.refLine.average': { fr: 'Moyenne des valeurs affichées', en: 'Average of the values shown' },
    'tileForm.refLine.value': { fr: 'Valeur fixe (objectif)', en: 'Fixed value (target)' },
    'tileForm.refValue.label': { fr: 'Valeur de la ligne', en: 'Line value' },
    'tileForm.error.refValueRequired': { fr: 'Saisissez la valeur de la ligne de repère.', en: 'Enter the value of the reference line.' },
    'tileForm.type.heatmap': { fr: 'Carte de chaleur', en: 'Heatmap' },
    'tileForm.type.box': { fr: 'Boîte à moustaches', en: 'Box plot' },
    'tileForm.type.calendar': { fr: 'Calendrier (activité par jour)', en: 'Calendar (activity per day)' },
    'tileForm.type.sankey': { fr: 'Flux (Sankey)', en: 'Flow (Sankey)' },
    'tileForm.pivotHeat.label': { fr: 'Colorer les cellules selon leur valeur', en: 'Colour the cells by their value' },
    'tileForm.palette.heatHint': { fr: 'Un dégradé d’une seule teinte : clair = petite valeur, foncé = grande. « Standard » et « Okabe-Ito » donnent le bleu.', en: 'A single-hue ramp: light = small value, dark = large. “Standard” and “Okabe-Ito” give blue.' },
    'tileForm.sort.label': { fr: 'Tri', en: 'Sort' },
    'tileForm.series.label': { fr: 'Séries (une par valeur)', en: 'Series (one per value)' },
    'tileForm.sort.default': { fr: 'Ordre des données', en: 'Data order' },
    'tileForm.sort.valueDesc': { fr: 'Valeur décroissante', en: 'Value, high to low' },
    'tileForm.sort.valueAsc': { fr: 'Valeur croissante', en: 'Value, low to high' },
    'tileForm.sort.byLabel': { fr: 'Libellé (A→Z, 1→9)', en: 'Label (A→Z, 1→9)' },
    'tileForm.numFormat.label': { fr: 'Format des nombres', en: 'Number format' },
    'tileForm.numFormat.auto': { fr: 'Automatique (lisible)', en: 'Automatic (readable)' },
    'tileForm.numFormat.column': { fr: 'Comme dans la colonne', en: 'Same as in the column' },
    'tileForm.numFormat.custom': { fr: 'Personnalisé', en: 'Custom' },
    'tileForm.numFormat.decimals': { fr: 'Décimales', en: 'Decimals' },
    'tileForm.numFormat.decimalsAuto': { fr: 'Selon la valeur', en: 'Depends on the value' },
    'tileForm.numFormat.compact': { fr: 'Notation compacte (1,2 M)', en: 'Compact notation (1.2M)' },
    'tileForm.numFormat.hint.auto': { fr: 'Séparateurs de la langue de l\'interface ; entiers dès 1 000, 2 décimales au plus en dessous.', en: 'Separators of the interface language; whole numbers from 1,000, at most 2 decimals below.' },
    'tileForm.numFormat.hint.columnEach': { fr: 'Chaque colonne numérique reprend son propre format dans Grist (décimales, devise, pourcentage…) ; une colonne sans réglage reste en automatique.', en: 'Each numeric column uses its own format in Grist (decimals, currency, percent…); a column with no setting stays automatic.' },
    'tileForm.numFormat.hint.columnCount': { fr: 'Un comptage n\'a pas de format de colonne : affichage automatique.', en: 'A count has no column format: shown automatically.' },
    'tileForm.numFormat.hint.columnUnknown': { fr: 'Le format de cette colonne n\'est pas connu (colonne calculée, jointure ou lecture impossible) : affichage automatique.', en: 'The format of this column is unknown (computed column, join or unreadable): shown automatically.' },
    'tileForm.numFormat.hint.columnNone': { fr: 'La colonne « {column} » n\'a pas de réglage de décimales dans Grist : affichage automatique, avec ses autres options (devise, %).', en: 'Column "{column}" has no decimals setting in Grist: shown automatically, with its other options (currency, %).' },
    'tileForm.numFormat.hint.columnOk': { fr: 'Reprend les options de la colonne « {column} » dans Grist (décimales, devise, pourcentage…).', en: 'Uses the options of column "{column}" in Grist (decimals, currency, percent…).' },
    'tileForm.palette.label': { fr: 'Palette de couleurs', en: 'Colour palette' },
    'tileForm.palette.standard': { fr: 'Standard (8 couleurs)', en: 'Standard (8 colours)' },
    'tileForm.palette.okabe': { fr: 'Daltonisme : Okabe-Ito (6 couleurs)', en: 'Colour-blind safe: Okabe-Ito (6 colours)' },
    'tileForm.palette.blue': { fr: 'Dégradé bleu (catégories ordonnées)', en: 'Blue ramp (ordered categories)' },
    'tileForm.palette.orange': { fr: 'Dégradé orange (catégories ordonnées)', en: 'Orange ramp (ordered categories)' },
    'tileForm.palette.green': { fr: 'Dégradé vert (catégories ordonnées)', en: 'Green ramp (ordered categories)' },
    'tileForm.palette.gray': { fr: 'Dégradé gris (impression noir et blanc)', en: 'Grey ramp (black-and-white printing)' },
    'advice.palette.tooFewColors': { fr: 'Cette palette n’a que {max} couleurs pour {n} valeurs : les premières se répètent. Choisissez la palette Standard (8 couleurs) ou regroupez les petites valeurs.', en: 'This palette has only {max} colours for {n} values: the first ones repeat. Choose the Standard palette (8 colours) or group the small values.' },
    'tileForm.horizontal.label': { fr: 'Barres horizontales (libellés longs, nombreuses catégories)', en: 'Horizontal bars (long labels, many categories)' },
    'tileForm.stacked.label': { fr: 'Empiler les séries (afficher le total de chaque catégorie)', en: 'Stack the series (show each category’s total)' },
    'tileForm.area.label': { fr: 'Aire : remplir sous la courbe', en: 'Area: fill under the line' },
    'tileForm.donut.label': { fr: 'Anneau (trou au centre)', en: 'Donut (hole in the middle)' },
    'tileForm.showPct.label': { fr: 'Afficher le pourcentage de chaque part', en: 'Show each slice’s percentage' },
  };

  // Repli français si `localStorage` lève (consigne GFS 007, point 1) : dans le sous-cadre isolé
  // d'un hébergeur comme GFS (sandbox sans allow-same-origin), lire `localStorage` — y compris via
  // `typeof` — lève une exception, elle n'est jamais simplement absente comme sous Node. Le `try`
  // doit donc envelopper le `typeof` lui-même, pas seulement l'accès qui le suit.
  let lang = 'fr';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('gristbi_lang') === 'en') lang = 'en';
  } catch (e) { /* stockage indisponible (cadre isolé compris) - repli français */ }

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

  // Titre d'affichage d'une tuile : si elle porte la clé de traduction de son titre auto-composé
  // (`titleKey`/`titleVars`, posés par js/main.js à la création/modification), le titre suit la
  // langue de l'interface ; sinon (tuile antérieure à ce champ, import Power BI, titre saisi à la
  // main) le texte stocké (`title`) tel quel. Jamais utilisé pour nommer une feuille d'export
  // (js/data.js reste pur, sans dépendance à ce module) : ces exports gardent `tile.title`.
  function tileTitle(tile) {
    if (tile && tile.titleKey && STRINGS[tile.titleKey]) return t(tile.titleKey, tile.titleVars);
    return (tile && tile.title) || '';
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
    // Même garde que la lecture plus haut (consigne GFS 007, point 1) : le `typeof` doit être DANS
    // le `try`, pas seulement `setItem` - sinon il lève, lui aussi, dans un cadre isolé.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('gristbi_lang', lang);
    } catch (e) { /* stockage indisponible (cadre isolé compris) - la langue ne survivra pas au rechargement, sans plus de conséquence */ }
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

  return { t, tileTitle, getLang, setLang, applyTranslations, onChange, STRINGS };
});
