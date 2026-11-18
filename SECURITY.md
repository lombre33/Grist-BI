# Signaler une vulnérabilité

Une faille dans Grist BI Dashboard (le widget lui-même, son code dans `js/`, la façon dont il lit ou écrit un document Grist)
se signale **sans ouvrir d'issue publique** : tant qu'elle n'est pas corrigée, une issue la rendrait publique.

- **Sur GitHub** : onglet « Security » du dépôt, puis « Report a vulnerability » (signalement privé).
- **Si ce bouton n'existe pas** : ouvrez une issue qui dit seulement qu'un signalement de sécurité est à faire (sans aucun détail
  technique), et un canal privé vous sera proposé.
- **Politique de divulgation de l'État** (pour une faille touchant une instance Grist officielle) :
  <https://vdp.numerique.gouv.fr/p/Send-a-report>

Dites ce que vous avez observé, comment le reproduire (document Grist, table, navigateur), et ce que la faille permet. Une
réponse vient avant toute publication ; la correction se publie avec la mention de qui l'a signalée, si vous le souhaitez.

## Ce qui est déjà su

Le widget demande l'accès `full` à Grist (voir `CLAUDE.md` §3 pour la raison : l'API des widgets n'a pas de palier entre « une
table » et « tout le document ») ; il écrit dans trois tables internes (`BI_Dashboard_Config`, `BI_Dashboard_Comments`,
`BI_Dashboard_UserProbe`) et, sur confirmation explicite de la personne, dans une table créée par l'import CSV. Aucune donnée ne
quitte le document : le widget n'a pas de serveur, et ses seuls appels réseau sont le chargement d'`index.html`, du script d'API de
Grist et, à la demande, de `pdfmake`/`PptxGenJS` (version figée, empreinte SRI).

La restriction fine des données passe par les règles d'accès natives de Grist, pas par le widget.

La configuration d'un rapport (`BI_Dashboard_Config`) est traitée comme une entrée non fiable : une ligne partagée peut avoir été écrite par une autre personne du document.
Les identifiants de tuile qu'elle contient sont ramenés à `[A-Za-z0-9_-]` à la lecture (`js/state.js`), et toute chaîne qu'elle porte (titres, noms de pages et de vues, valeurs de
filtre) est échappée avant d'être écrite dans la page.

L'état de l'audit automatisé `gwaudit` (ce qui est corrigé, ce qui est voulu, ce qui reste) est tenu dans
[`AUDIT-GW.md`](AUDIT-GW.md).

Une faille dans une bibliothèque tierce embarquée (`js/vendor/`, voir [`js/vendor/SOURCES.md`](js/vendor/SOURCES.md)) se signale
aussi à son auteur.
