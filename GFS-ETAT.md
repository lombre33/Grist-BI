# GFS-ETAT : Grist-BI

Mis à jour le 2026-11-03 (voir le dernier commit du dépôt sur la branche `claude/project-thread-ko4m14`/sa PR pour le hash exact).

## Consignes
- 001 · faite · `23647eb` · 1.1 : écart sur la règle 4 (les 3 tables internes — `BI_Dashboard_Config`, `BI_Dashboard_Comments`, `BI_Dashboard_UserProbe` — se créent au démarrage sans l'accord de la personne) et la règle 11 (pas de CSP, déjà noté dans le guide) ; ligne du guide par ailleurs juste à ce commit, seule omission : elle ne mentionne jamais `BI_Dashboard_Comments` (créée depuis le 30/09) parmi les tables internes
- 002 · lue
- 003 · faite · `21b012b` · fichier vide `.nojekyll` ajouté à la racine (PR #30) ; vérifié qu'aucun fichier caché sensible n'est nouvellement exposé (seuls `.nojekyll` et `.gitignore`, rien de sensible dans l'un ou l'autre, aucun fichier `_*`) ; run « pages build and deployment » #58 passé en succès sur ce commit ; version vue en ligne le 02/11/2026 à `https://lombre33.github.io/Grist-BI/` : titre « Grist BI Dashboard (POC) », bandeau « Dashboard BI POC », état vide conforme à `main` à ce commit — l'app n'affiche aucun numéro de version, donc pas de numéro à relever

## Changements qui touchent GFS
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
- **`pdfjs-dist`** · version exacte **`6.5.438`** (dernière stable au moment de la demande,
  03/11/2026, vérifiée sur le registre npm) · fonction concernée : `js/pdf-text.js:extractTextFromPdf`,
  consommée ensuite par `js/keywords.js:extractKeywords` pour les mots-clés automatiques à l'ajout
  d'une publication · usage en une phrase : extraire le texte brut d'un PDF déposé en pièce jointe
  Grist, entièrement côté client, sans jamais envoyer le fichier à un service externe.
  Détail technique pour le choix du build/CDN : le code attend un global `window.pdfjsLib` (build
  UMD classique, ex. `legacy/build/pdf.js` du paquet npm) ET un fichier worker séparé
  (`pdf.worker.js`/`.mjs`) — sans `pdfjsLib.GlobalWorkerOptions.workerSrc` configuré vers ce worker,
  PDF.js échoue silencieusement à l'exécution ; à couvrir dans la consigne de réponse.
