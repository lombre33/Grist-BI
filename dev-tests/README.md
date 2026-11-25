# Tests locaux (hors Grist)

## Logique pure (Node, aucune dépendance)

```
node dev-tests/test-data.js
```

Teste `js/data.js` (agrégations, filtrage, tendance, échappement HTML), `js/state.js` (store :
filtres croisés cumulables, drill-down, réorganisation, bookmarks, ajout/suppression/édition de
tuile), `js/demo-data.js` (jeu de données de test de charge, cohérence avec les tuiles par défaut —
fixture de test Node pure, plus chargée par `index.html`/`dev-tests/harness.html`, voir plus bas),
`js/combobox.js` (filtrage/surlignage) et `js/duckdb-engine.js` (échappement CSV/validation des
noms de colonne — la logique pure seulement, voir plus bas pour le moteur SQL réel) sans navigateur
ni API Grist.

## Rangement des pages des tables internes (Node, aucune dépendance)

```
node dev-tests/test-internal-pages.js
```

`js/internal-pages.js` (le plan) puis le vrai `js/grist-api.js` sur le faux Grist de `grist-stub.js` : un petit moteur écrit dans l'essai
applique les actions comme Grist et relit l'arbre des pages comme le client (capture d'Antoine, document neuf, course avec `AddTable`,
geste de la personne respecté, choix du parent, options hostiles). Ce que le faux Grist ne prouve pas : le comportement d'un vrai Grist
(`HYPOTHESES.md` point 18).

## Garde-fous de l'audit `gwaudit` (Node, aucune dépendance)

```
node dev-tests/test-audit.js
```

Ce que l'outil d'audit mesure et qu'une modification peut défaire sans bruit (voir `AUDIT-GW.md`) : chaque champ de
`index.html` a une étiquette, aucun bouton n'est vide, un seul `<main>`, `SECURITY.md` existe, et `js/vendor/SOURCES.md` dit
vrai (empreintes SHA-256 des bibliothèques embarquées).

## Écriture de HTML dans le DOM (`js/safe-html.js`)

```
node dev-tests/test-safe-html.js
```

La politique de la liste blanche (balises, attributs, style en ligne ; pure, sans DOM), plus les garde-fous des sources : aucun
`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` dynamique dans `js/` ni dans `echarts.min.js` (ses sept affectations
passent par `__gristBiSetHtml`, voir `dev-tests/patch-echarts.js`). La RECONSTRUCTION de l'arbre touche le DOM : elle se vérifie dans un
navigateur en ouvrant **`dev-tests/safe-html-test.html`** (double-clic, aucun serveur) qui rejoue la batterie de
`dev-tests/safe-html-cases.js` (charges hostiles : `onerror`, `script`, `svg onload`, `foreignObject`, `javascript:`, mutation par
`math`/`noscript`, `url()` dans un style, `position: fixed`, `id`/`name`… ; gabarits légitimes du widget, qui doivent survivre) et dit
OK ou ÉCHEC dans le titre de l'onglet. Pour ajouter une balise ou un attribut à un gabarit : la liste de `js/safe-html.js` ET un cas
dans `safe-html-cases.js`.

## Chargeur de code (`js/loader.js`, `js/modules.js`)

```
node dev-tests/test-loader.js
```

La politique de `planScript` (pure : https seulement hors du site de la page, empreinte `integrity` obligatoire pour un autre site, liste d'hôtes,
identifiants refusés, empreinte mal formée refusée — un navigateur l'ignorerait en silence —, `blob:`/`data:`/`javascript:` jamais une source de code),
l'élément `<script>` qu'il pose (sur un faux document), le registre de modules (nom inconnu refusé, une seule inscription), les garde-fous des sources
(UN `createElement('script')` dans `js/`, UN fichier avec `import()`, l'ordre des balises d'`index.html` et de `harness.html`) et, dans `echarts.min.js`, ni
`document.write` ni `.open(` à argument (`windowOpen` est évalué dans un `vm` : `javascript:`, `data:`, `file:` n'ouvrent rien). Le chargement RÉEL
se vérifie dans un navigateur, dans un `<iframe sandbox="allow-scripts allow-downloads">` servi AVEC `Access-Control-Allow-Origin` (les modules
sont chargés en CORS depuis l'origine opaque du cadre ; `http-server` sans `--cors` fait échouer `js/modules.js`) : trois exports, une extension à
bonne et à fausse empreinte, les refus, DuckDB au-delà de 5 000 lignes, la fenêtre du kit. **Pourquoi `js/modules.js` existe** : un `import()` écrit
dans un script CLASSIQUE n'a pas d'adresse de base dans ce cadre (« The base URL is about:blank »), alors qu'écrit dans un module il se résout ;
un essai fait seulement dans une page directe ne voit pas ce défaut (`CLAUDE.md` §7 piège n°49).

## Non-régression dans un vrai navigateur, à lancer avant toute fusion et tout envoi

```
sh dev-tests/run-all.sh          # les dix-huit essais Node (dont test-advice, test-advice-insights, test-advice-types, test-advice-types-time-grid, test-advice-complete, test-advice-column, test-advice-join, test-graphique et test-graphique-dessin), puis les deux essais du navigateur (≈ 2 min) ; sortie 0 = on peut fusionner / envoyer
NODE_PATH=$(npm root -g) node dev-tests/test-browser.js     # le seul essai du navigateur
```

**Le dessin du module `js/graphique/`** (`CLAUDE.md` §2) a deux essais : `node dev-tests/test-graphique-dessin.js` (Node, faux ECharts : formats comparés à `js/format.js` sur 23 520 combinaisons, options, refus, `image()`, vue, modèle Office) et `NODE_PATH=$(npm root -g) node dev-tests/test-graphique-navigateur.js` (Chromium : le module est comparé PIXEL À PIXEL au dessin de Grist BI pour dix tuiles, puis 500 images de suite avec contrôle du tas JS et de la mémoire des processus de rendu). Mesures de volume du second : `MESURES=1 TAILLES=5000,20000,50000,500000 NODE_PATH=$(npm root -g) node dev-tests/test-graphique-navigateur.js` ; sans `MESURES`, seuls la parité et la charge sont jouées. La charge sans libération des toiles monte à 2,9 Go : l'essai la voit.

`dev-tests/test-browser.js` charge le **vrai `index.html`** (pas `harness.html`), avec sa politique de sécurité du contenu, servi par un petit serveur local avec `Access-Control-Allow-Origin: *`. Il remplace
`https://docs.getgrist.com/grist-plugin-api.js` par un fichier qui s'exécute **par `eval` et `Function`** comme le bundle de Grist, et qui pose le faux `grist` de `dev-tests/grist-stub.js` ; une table de démonstration (`Ventes`) est préremplie
(le widget ne crée aucune table de données : sans elle il affiche « aucune table »). Pour jouer le VRAI fichier de Grist : `curl -o /tmp/api.js https://docs.getgrist.com/grist-plugin-api.js` puis `GRIST_PLUGIN_API_FILE=/tmp/api.js` (le
proxy de l'environnement de développement le refuse, 403 : à faire depuis un poste qui y accède). Il joue deux fois, en page directe puis dans un `<iframe sandbox="allow-scripts allow-downloads">`, et **échoue** sur :

- une erreur de console (`EvalError` comprise), une exception de page, une violation de politique (`securitypolicyviolation`) ;
- une requête échouée ou une réponse 4xx/5xx (un dossier `kit/` vide, c'est-à-dire un sous-module non récupéré, en donne trois : `git submodule update --init`). **Seule exception** : une réponse que la PAGE annule en cours de route (`net::ERR_ABORTED` avec une réponse déjà reçue : DuckDB-WASM lâche le flux de son `.wasm` après compilation, selon la machine) est relevée (« remarque ») mais n'est pas un défaut ; l'essai la rejoue lui-même à chaque lancement pour prouver que le tri la voit, et six cas de tri sont figés (refus de connexion, `ERR_BLOCKED_BY_CSP`, réponse jamais arrivée… restent des défauts) ;
- une requête vers un autre site que `docs.getgrist.com` ;
- `grist` indéfini, aucune ligne chargée, une tuile qui ne se dessine pas (barres, camembert, chiffre, table plate), DuckDB (init + une agrégation), ExcelJS ou les fenêtres du kit qui ne se chargent pas.

**Windows** : `.gitattributes` force LF (sinon `core.autocrlf=true` fait échouer `test-data.js` sur `harness.html` et `test-audit.js` sur les empreintes de `js/vendor/`). Dans un clone fait avant : `git rm --cached -r . && git reset --hard` (efface les modifications non committées), ou le recloner.

**Relais des appels bloqués à GFS (règle S8, consigne 026)** : trois scénarios supplémentaires avec une page parente qui fait le faux GFS (`/__host.html`, `?gfs=0` dans l'adresse du cadre, cadre `sandbox="allow-scripts allow-downloads"`). Hébergée, la page dit « relais actif » puis, pour un `fetch` et une image vers `http://exemple.test/…?secret=…` (bloqués par `connect-src` et `img-src`), `exemple.test` SEUL arrive au parent ; seule, elle n'écrit rien ; sans la ligne du relais (`/__norelay.html`), rien n'arrive. L'essai est en `http:` parce que `connect-src https:` (exception de la règle S3 pour la pièce jointe désignée par Grist) laisse passer tout `https:`.

**Mise à jour des noms de `BI_Dashboard_Config` (consigne GFS 030)** : quatre scénarios avec le VRAI kit (`kit/js/names-update/`, d'où `git submodule update --init`) sur un document préempli aux noms d'avant (`Nom`, `TypeRapport`, `DateModif`, `ModifiePar`, plus les tables système `_grist_Tables`/`_grist_Tables_column` que le widget lit) : propriétaire (la route `**/_stub/api/docs/stub/webhooks**` répond 200), autre personne (403, tolérée dans la console), et faux GFS qui ne dit pas le rôle (aucun appel `/webhooks` permis). Le scénario propriétaire clique la vraie fenêtre (`#nu-modal`, boutons « Mettre à jour » puis « Continuer ») et vérifie les colonnes relues dans le faux Grist.

**Contrôle négatif** : une copie d'`index.html` sans `'unsafe-eval'` doit être refusée par la même vérification (sinon l'essai ne voit plus rien). Sortie 2 = Playwright ou Chromium introuvable : ce n'est pas un succès.
**Ce que l'essai ne prouve pas** : le comportement du VRAI Grist et du vrai GFS (leur propre politique sur le cadre, l'accès réel). Avant de publier : ouvrir le widget dans un vrai Grist, console ouverte, et chercher « Content Security Policy » /
« Refused to ». Historique : `CLAUDE.md` §7 piège n°51 et `TEST_PROTOCOL.md` bug réel n°57.

## Politique de sécurité du contenu (`index.html`)

```
node dev-tests/test-csp.js
```

La balise `<meta http-equiv="Content-Security-Policy">` d'`index.html` : une seule, dans `<head>`, avant toute balise de script, de feuille ou de style ; les directives exactes
(`default-src 'none'`, `script-src` = `'self'` + `'unsafe-eval'` (REQUIS : `grist-plugin-api.js` de Grist s'exécute par `eval`) + `'wasm-unsafe-eval'` + `https:` + une empreinte, jamais `'unsafe-inline'`/joker/`data:`/`blob:`/`http:`, `form-action 'none'`, `worker-src 'self' blob:`) ;
**l'empreinte de l'`importmap` recalculée sur son texte réel** (retoucher l'`importmap` sans changer l'empreinte empêche DuckDB de se charger, et le widget retombe en silence sur le calcul JS) ; aucun
`on…=`, `javascript:`, `<style>` ni `<iframe>` ; `frame-ancestors`/`report-uri`/`sandbox` absents (ignorés dans une balise `<meta>`). Ce que la politique laisse passer ou bloque se mesure dans un navigateur :

- **Servir avec `Access-Control-Allow-Origin: *`** et ouvrir `index.html` (faux `grist` posé par la route, comme pour le chargeur) en page directe puis dans un
  `<iframe sandbox="allow-scripts allow-downloads">` ; écouter `securitypolicyviolation` (`document.addEventListener`, ajouté par `page.addInitScript`) et attendre 0 violation sur le parcours : 22 types de tuile,
  DuckDB au-delà de 5 000 lignes (Worker `blob:`, `.wasm`), fenêtre du kit, menus, exports Excel / PPTX (vraie bibliothèque servie à la place de jsDelivr, `context.route()`) / PDF, extension à bonne puis à fausse empreinte.
- **Prouver que la politique bloque** : `page.evaluate` de Playwright CONTOURNE la politique (`eval` y paraît permis) — la sonde doit être un fichier SERVI par le site (`/__probe.js`, `<script src>`) qui tente `eval`, `new Function`,
  un script et un gestionnaire en ligne, et lit `securitypolicyviolation`. Mesuré le 18/11 : `eval`/`new Function` bloqués, depuis le 19/11 permis exprès (`'unsafe-eval'`, voir plus haut) ; script et gestionnaire en ligne toujours bloqués.
- Piège : une extension de GFS d'essai se sert par `context.route('https://gfs.test/…')` avec `access-control-allow-origin: *` (sinon l'empreinte `integrity` refuse la réponse).

Voir `CLAUDE.md` §7 piège n°50.

## Aides communes aux essais (`dev-tests/lib/helpers.js`)

`test-layouts.js` et `test-styles.js` en tirent ce qu'ils recopiaient à l'identique : lecture d'un fichier du dépôt (`read`), lecteur de
règles CSS (`parseCssRules`) et le vrai `js/grist-api.js` branché sur un faux `grist` qui tient `BI_Dashboard_Config` en mémoire
(`loadApiWithFakeConfigTable`). `readCharts()` lit les cinq fichiers du rendu des tuiles (`js/charts-core.js`, `charts-cards.js`, `charts-cloud.js`, `charts-extra.js`, `charts.js`) bout à bout : `test-data.js` et `test-styles.js` s'en servent pour tout contrôle fait sur le texte du rendu. `readMain()` fait de même pour les neuf fichiers de `js/main*.js` (`main-core.js` … `main-session.js`, puis `main.js`) : `test-data.js`, `test-styles.js` et `test-layouts.js` s'en servent pour tout contrôle fait sur le texte du démarrage de l'interface. Un nouvel essai qui a besoin de l'un d'eux l'importe d'ici plutôt que de le recopier (l'audit `gwaudit`
compte les blocs dupliqués, A-DUP-01).

## Style global des tuiles (Node, aucune dépendance)

```
node dev-tests/test-styles.js
```

`js/styles.js` (registre, passe sur les options ECharts de chaque style, dégradés, couleurs, options d'affichage), `css/dash-styles.css`
(jetons complets en clair et en sombre — un seul bloc pour `console`, toujours sombre —, contrastes, le verre contre sa pire carte
translucide, règles des deux options), le réglage du store (style et options), l'aller-retour de la configuration par le vrai
`js/grist-api.js` (faux `grist`) et le câblage d'`index.html`/`harness.html`. Le rendu à l'écran (cartes, graphiques,
menu Réglages, cadre isolé) se rejoue dans un navigateur : voir `HYPOTHESES.md`.

## Dispositions de page (Node, aucune dépendance)

```
node dev-tests/test-layouts.js
```

`js/layouts.js` (registre et seuils de largeur, largeurs qui remplissent toujours la ligne, plan de chaque disposition pour 0 à 13 chiffres et
0 à 14 graphiques, vedette, Rail avec ou sans colonne de gauche, ordre affiché, cible des flèches ◀ ▶, miniatures), le réglage PAR PAGE du store
(`setPageLayout`, configuration hostile assainie par `setPages`), l'aller-retour de la configuration par le vrai `js/grist-api.js` (faux `grist`),
`css/layouts.css` (trois seuils `@container` égaux à `minWidthOf`, `--lu` = 28 px, règles communes de 640 et de 900 px identiques, jamais de
`min-height`, contrastes AA) et le câblage d'`index.html`/`harness.html`. Le rendu à l'écran (les quatre dispositions en clair et en sombre, avec
chaque style, les seuils de largeur, la stabilité des hauteurs, le mode Édition, la tuile agrandie, le cadre isolé) se rejoue dans un navigateur :
voir `HYPOTHESES.md`. Une feuille `harness.html` à jour demande aussi son `<link>` dans l'en-tête (`sync-harness.js` ne régénère que le corps).

## Harness visuelle (navigateur, sans document Grist)

`dev-tests/harness.html` charge les mêmes fichiers `index.html`/`css`/`js` que le widget réel
(y compris `js/vendor/echarts/echarts.min.js` — ECharts est embarqué dans le repo, plus de CDN
externe), mais remplace `grist-plugin-api.js` par `grist-stub.js` : un faux `window.grist` qui
simule `docApi.listTables` / `fetchTable` / `applyUserActions`
(`AddTable`/`AddRecord`/`UpdateRecord`/`RemoveRecord`/`AddColumn`/`RenameTable`) en mémoire, sans
persister sur disque — un `page.reload()` y perd donc tout, contrairement à un vrai document Grist.
Le widget se connecte automatiquement à la 1re table du document au démarrage (voir
`js/grist-api.js:listAvailableTables`/`js/main.js:bootstrap`) — il ne crée plus lui-même aucune
table de données (retrait de `BI_StressTest`, 2026-10-21, voir CLAUDE.md §1/§3/§7/§8), pas de
"table liée" figée. Ce harnais préremplit le mock avec une petite table `Ventes` de démonstration
(`window.__gristStubPreseed` en tête de `harness.html`) pour qu'un simple double-clic affiche un
dashboard non vide ; pour un volume réaliste (~47 000 lignes), préremplir soi-même via
`js/demo-data.js` dans un script Playwright ad hoc (voir plus bas).

Deux ajouts du faux Grist pour « Mots-clés des publications » (18/11/2026) : `getAccessToken(options)` rend
`{token, baseUrl: <origine de la page>/_stub/api/docs/stub, ttlMsecs, readOnly}` (ou lève une erreur si
`window.__gristStubNoToken` est posé, pour jouer « GFS sans la capacité `jeton` »), et `AddColumn` rend `{colRef, colId}`.
Rien de cela ne prouve la forme réelle de la réponse de Grist (HYPOTHESES.md). L'essai navigateur de cette fenêtre
(scripts Playwright non committés, comme les autres) sert le dépôt par un petit serveur HTTP qui répond aussi aux
téléchargements `/_stub/api/docs/stub/attachments/<id>/download` avec de vrais PDF (reportlab) et au fichier
`prototype/vendor/pdfjs/1.0.0/pdfjs.js` de GFS (son `integrity` sert à `attach` d'un faux lien :
`GristBI.extensions.attach(Promise.resolve({ hosted: true, ready, library, onExtensions, install }))`) ; pour que le cadre
`sandbox="allow-scripts"` (origine `null`) joigne `127.0.0.1`, lancer Chromium avec
`--disable-features=PrivateNetworkAccessForNavigations,PrivateNetworkAccessForWorkers,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks`.

Ouvrir `dev-tests/harness.html` directement dans un navigateur (double-clic) : pas de build, pas de
serveur requis pour l'essentiel des tests. **Exception : `js/duckdb-engine.js`** (moteur SQL
DuckDB-WASM, voir ROADMAP.md Tier 2) utilise `import()` dynamique de module ES, bloqué par CORS sur
`file://` (origine `"null"`) — les tests qui l'exercent réellement (`duckdb-engine-test.js`, dans le
scratchpad de développement, pas committé ici) servent le dépôt via un petit serveur HTTP local
(`http.createServer` de Node, sans dépendance) plutôt que `file://`. Rien de spécifique n'est requis
pour l'usage normal du widget : ce moteur est chargé PARESSEUX (jamais au démarrage), voir sa
documentation en tête de fichier.

**Ce que ce mock NE prouve PAS** : le comportement réel de `grist.docApi` dans un vrai document
Grist (voir `HYPOTHESES.md` à la racine, section "Points à valider en conditions réelles").
