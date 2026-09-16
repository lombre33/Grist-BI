/*
 * Mock minimal de l'API Grist Custom Widget pour tester dev-tests/harness.html hors d'un
 * vrai document Grist. Couvre uniquement ce que ce POC utilise : grist.ready, grist.onRecords,
 * grist.docApi.{listTables,fetchTable,applyUserActions} avec
 * AddTable/AddRecord/UpdateRecord/RemoveRecord/AddColumn/RenameTable.
 * Ne PAS utiliser comme référence de l'API réelle — voir docs.getgrist.com pour la vraie surface.
 */
(function () {
  'use strict';

  const REGIONS = ['Nord', 'Sud', 'Est', 'Ouest'];
  const PRODUITS = ['Widget A', 'Widget B', 'Widget C'];
  const MOIS = ['Janvier', 'Février', 'Mars'];

  function buildSampleRows() {
    let id = 1;
    const rows = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const region of REGIONS) {
      for (const produit of PRODUITS) {
        for (const mois of MOIS) {
          rows.push({
            id: id++,
            Region: region,
            Produit: produit,
            Mois: mois,
            Montant: Math.round(300 + rand() * 1700),
            Quantite: Math.round(2 + rand() * 20)
          });
        }
      }
    }
    return rows;
  }

  const SAMPLE_ROWS = buildSampleRows();
  const SAMPLE_TABLE_ID = 'Ventes';

  // Pré-remplissage optionnel AVANT ce script (via page.addInitScript(), voir table-race-test.js) :
  // simule un document Grist qui a DÉJÀ ces tables d'une session widget précédente, pour tester ce
  // qui se passe à la RECONNEXION (le seul moment où le "faux négatif" décrit ci-dessous a un sens —
  // sur une table qui vient tout juste d'être créée dans CETTE session, il n'y a rien à retrouver).
  const tables = window.__gristStubPreseed ? JSON.parse(JSON.stringify(window.__gristStubPreseed)) : {};
  let nextRowId = 1 + Object.values(tables).reduce((max, t) => Math.max(max, ...(t.id || [0])), 0);

  function cloneColumnar(t) { return JSON.parse(JSON.stringify(t)); }

  // Simulation du "faux négatif" d'existence de table trouvé en conditions réelles (voir
  // js/grist-api.js:tableExistsConfirmed) : `grist.ready()` ne renvoie pas de promesse, la vraie
  // négociation d'accès avec Grist se termine de façon ASYNCHRONE, et un `listTables()` envoyé trop
  // tôt côté widget peut renvoyer une liste incomplète/vide. `window.__gristStubRaceCalls` (compteur,
  // pas un délai réel — déterministe, pas de flakiness liée au timing du test) : tant qu'il est > 0,
  // chaque appel à `listTables()` renvoie `[]` (comme si la table n'existait pas encore) et
  // décrémente le compteur ; les tests qui veulent reproduire le bug l'arment explicitement via
  // `page.addInitScript()` (qui s'exécute AVANT ce script) — `typeof ... !== 'number'` pour ne PAS
  // écraser cette valeur pré-armée [BUG DE TEST trouvé en écrivant table-race-test.js : une
  // affectation inconditionnelle ici annulait silencieusement l'armement fait par le test avant même
  // que ce script ne s'exécute, rendant la simulation de course totalement inopérante — le test
  // "passait" alors indépendamment de la présence du correctif, donc sans jamais rien vérifier].
  if (typeof window.__gristStubRaceCalls !== 'number') window.__gristStubRaceCalls = 0;

  window.grist = {
    ready(opts) {
      console.log('[grist-stub] ready()', opts);
    },
    onRecords(callback) {
      // Le vrai grist.onRecords rappelle à chaque changement de sélection/donnée ; ici un seul
      // envoi suffit pour le POC (pas de simulation d'édition live de la table liée).
      setTimeout(() => callback(SAMPLE_ROWS, { tableId: SAMPLE_TABLE_ID }), 0);
    },
    onOptions() {},
    docApi: {
      async listTables() {
        // Le vrai grist.docApi.listTables() renvoie un tableau de chaînes (les tableId), PAS des
        // objets {id} — vérifié contre la définition TypeScript de l'API Grist réelle.
        if (window.__gristStubRaceCalls > 0) {
          window.__gristStubRaceCalls--;
          return [];
        }
        return Object.keys(tables);
      },
      async fetchTable(tableId) {
        return tables[tableId] ? cloneColumnar(tables[tableId]) : { id: [] };
      },
      async applyUserActions(actions) {
        const retValues = [];
        for (const action of actions) {
          const kind = action[0];
          const tableId = action[1];
          if (kind === 'AddTable') {
            const columns = action[2];
            const t = { id: [] };
            for (const col of columns) t[col.id] = [];
            tables[tableId] = t;
            retValues.push(null);
          } else if (kind === 'AddRecord') {
            const fields = action[3] || {};
            const t = tables[tableId];
            const newId = nextRowId++;
            t.id.push(newId);
            const idx = t.id.length - 1;
            for (const key of Object.keys(fields)) {
              if (!t[key]) t[key] = [];
              t[key][idx] = fields[key];
            }
            retValues.push(newId);
          } else if (kind === 'UpdateRecord') {
            const rowId = action[2];
            const fields = action[3] || {};
            const t = tables[tableId];
            const idx = t.id.indexOf(rowId);
            if (idx >= 0) for (const key of Object.keys(fields)) t[key][idx] = fields[key];
            retValues.push(null);
          } else if (kind === 'RemoveRecord') {
            const rowId = action[2];
            const t = tables[tableId];
            const idx = t.id.indexOf(rowId);
            if (idx >= 0) for (const key of Object.keys(t)) t[key].splice(idx, 1);
            retValues.push(null);
          } else if (kind === 'AddColumn') {
            const colId = action[2];
            const t = tables[tableId];
            t[colId] = new Array(t.id.length).fill(null);
            retValues.push(null);
          } else if (kind === 'RenameTable') {
            const oldTableId = action[1];
            const newTableId = action[2];
            tables[newTableId] = tables[oldTableId];
            delete tables[oldTableId];
            retValues.push(null);
          } else {
            console.warn('[grist-stub] action non gérée par le mock:', kind);
            retValues.push(null);
          }
        }
        return { retValues };
      }
    }
  };
})();
