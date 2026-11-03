# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-03, au commit `3556d02` (le dernier commit de code que cette page décrit).

## Consignes
- 001 · faite · `23647eb` · 1.1 : écart sur la règle 4 (les 3 tables internes — `BI_Dashboard_Config`, `BI_Dashboard_Comments`, `BI_Dashboard_UserProbe` — se créent au démarrage sans l'accord de la personne) et la règle 11 (pas de CSP, déjà noté dans le guide) ; ligne du guide par ailleurs juste à ce commit, seule omission : elle ne mentionne jamais `BI_Dashboard_Comments` (créée depuis le 30/09) parmi les tables internes
- 002 · lue
- 003 · faite · `21b012b` · fichier vide `.nojekyll` ajouté à la racine (PR #30) ; vérifié qu'aucun fichier caché sensible n'est nouvellement exposé (seuls `.nojekyll` et `.gitignore`, rien de sensible dans l'un ou l'autre, aucun fichier `_*`) ; run « pages build and deployment » #58 passé en succès sur ce commit ; version vue en ligne le 02/11/2026 à `https://lombre33.github.io/Grist-BI/` : titre « Grist BI Dashboard (POC) », bandeau « Dashboard BI POC », état vide conforme à `main` à ce commit — l'app n'affiche aucun numéro de version, donc pas de numéro à relever

## Changements qui touchent GFS
- 2026-11-03 · `(hash à venir)` · tuile « Nuage de mots » (`js/charts.js`/`js/data.js`/`js/main.js`) :
  Antoine a demandé une lib plus récente/mieux maintenue qu'echarts-wordcloud et choisi **d3-cloud
  2.0.0** à la place (voir la demande mise à jour ci-dessous) — rendu toujours en attente de GFS,
  la tuile affiche un message explicite (`chart.wordCloudUnavailable`) en attendant.
- Nouveau chantier (demande d'Antoine, fil "Recherche sémantique sur publications") : mots-clés
  automatiques sur les publications (PDF en pièce jointe Grist), en plus de mots-clés manuels,
  pour indexer richement en restant zéro-backend. `js/keywords.js` (extraction RAKE, scoring
  degree/freq, Rose et al. 2010) est 100% JS vanilla — tokenisation via `Intl.Segmenter` natif,
  aucune nouvelle dépendance, testé sous Node (`dev-tests/test-data.js`). Seule l'extraction du
  texte à partir du PDF lui-même a besoin d'une bibliothèque externe : voir la demande ci-dessous.
  `js/pdf-text.js` est déjà écrit et codé CONTRE l'API de PDF.js (`window.pdfjsLib`) sans jamais la
  charger (`isAvailable()` renvoie `false` tant que GFS n'a pas ajouté la bibliothèque) — rien
  d'autre dans ce dépôt ne référence PDF.js. Pas encore dans `index.html`/`importmap` : branché
  seulement une fois la bibliothèque disponible.

## Questions pour GFS
- aucune

## Demandes à GFS
- **`d3-cloud`** · version exacte **`2.0.0`** · remplace la demande `echarts-wordcloud` 2.1.0 d'un
  lot précédent (écartée sur demande d'Antoine : dépôt amont sans commit de code depuis fin 2022,
  voir l'historique de cette section dans git) · fonction concernée : `js/charts.js`
  (`placeWordCloud`/`loadD3Cloud`, tuile « Nuage de mots ») · usage en une phrase : calcule le
  PLACEMENT des mots d'un nuage de mots pour visualiser les mots-clés/auteurs les plus fréquents
  d'une colonne, comme le nuage de mots natif de Power BI.
  Choisie le 03/11/2026 : réécrite le 30/10/2026 (4 jours avant cette demande), zéro dépendance,
  tests + types + guide de migration, licence BSD-3-Clause.
  Détail technique pour le choix du build/CDN : **ESM uniquement depuis la 2.x, aucun build UMD**
  (retiré explicitement dans ce lot de version, voir son CHANGELOG — contrairement aux bibliothèques
  déjà demandées jusqu'ici) — `js/charts.js` fait un `import('d3-cloud')` (spécificateur NU, même
  mécanisme que `apache-arrow`/`flatbuffers`/`tslib` dans l'`importmap` d'`index.html`) : attend donc
  une entrée `"d3-cloud": "<url>"` dans cet importmap, pointant vers `build/d3-cloud.js` du paquet
  (champs `unpkg`/`jsdelivr` de son `package.json`, déjà prêt à l'emploi). Export par défaut = la
  classe `CloudLayout` (voir `index.d.ts` du paquet).
  d3-cloud ne fait QUE le placement (pas de rendu ni de clic/survol, contrairement à
  echarts-wordcloud) : ce dépôt dessine lui-même sur un `<canvas>` dédié
  (`drawWordCloud`/`hitTestWordCloud`), déjà vérifié avec un stub écrit à la main reproduisant
  l'API documentée (jamais le vrai paquet, non exécutable dans un navigateur depuis ce sandbox,
  même limite que pour les demandes précédentes de ce fichier).
- **`pdfjs-dist`** · version exacte **`6.5.438`** (dernière stable au moment de la demande,
  03/11/2026, vérifiée sur le registre npm) · fonction concernée : `js/pdf-text.js:extractTextFromPdf`,
  consommée ensuite par `js/keywords.js:extractKeywords` pour les mots-clés automatiques à l'ajout
  d'une publication · usage en une phrase : extraire le texte brut d'un PDF déposé en pièce jointe
  Grist, entièrement côté client, sans jamais envoyer le fichier à un service externe.
  Détail technique pour le choix du build/CDN : le code attend un global `window.pdfjsLib` (build
  UMD classique, ex. `legacy/build/pdf.js` du paquet npm) ET un fichier worker séparé
  (`pdf.worker.js`/`.mjs`) — sans `pdfjsLib.GlobalWorkerOptions.workerSrc` configuré vers ce worker,
  PDF.js échoue silencieusement à l'exécution ; à couvrir dans la consigne de réponse.
