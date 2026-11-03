/*
 * Lecture de la MISE EN PAGE d'un fichier Power BI (.pbix/.pbit — tous deux des archives ZIP) :
 * fonctions pures, testables sous Node (voir dev-tests/test-data.js), aucune dépendance au DOM ni
 * à l'API Grist. L'inflation DEFLATE (seule étape qui a besoin d'un environnement) est injectée en
 * paramètre plutôt qu'importée ici — même convention que js/data.js pour le calcul DuckDB (voir son
 * en-tête) : la vraie implémentation (`DecompressionStream('deflate-raw')`) vit côté navigateur
 * dans js/main.js, les tests Node lui substituent `zlib.inflateRawSync`.
 *
 * Portée DÉLIBÉRÉE : uniquement `Report/Layout` (quels visuels, quel type, quelles colonnes/mesures
 * utilisées, quel titre) — jamais les données ni les formules DAX des mesures, qui vivent dans
 * `DataModel`, un format binaire propriétaire (VertiPaq/xVelocity) non documenté officiellement et
 * hors de portée de ce module (voir CLAUDE.md pour l'étude de faisabilité complète).
 *
 * [Piège réel trouvé en testant contre de vrais fichiers .pbix du commerce, pas une fixture
 * maison] `Report/Layout` est encodé en UTF-16LE (avec BOM), jamais en UTF-8 — contrairement à ce
 * que son contenu (du JSON) suggère au premier abord. `decodeLayoutJson` essaie UTF-16LE en
 * premier, UTF-8 en repli (au cas où une variante future du format changerait ça), jamais l'inverse
 * (un flux UTF-16LE mal décodé en UTF-8 ne lève pas forcément d'erreur JSON.parse immédiate — il
 * produit des caractères NUL/illisibles qui font plus souvent planter le parse, mais autant tester
 * l'encodage réellement observé en premier).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GristBI = root.GristBI || {};
    root.GristBI.pbixLayout = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ZIP_METHOD_STORED = 0;
  const ZIP_METHOD_DEFLATE = 8;
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_DIR_SIGNATURE = 0x02014b50;
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;

  function readUInt32LE(view, offset) { return view.getUint32(offset, true); }
  function readUInt16LE(view, offset) { return view.getUint16(offset, true); }

  // Cherche la signature "End Of Central Directory" en partant de la fin du fichier — c'est le seul
  // point d'entrée fiable d'un ZIP (le format est pensé pour être lu depuis la queue, pas le début).
  // Le commentaire de fin d'archive (0 à 65535 octets, rarement utilisé par Power BI) fait varier sa
  // position exacte, d'où la recherche en arrière plutôt qu'un offset fixe.
  function findEndOfCentralDirectory(bytes) {
    const maxCommentLength = 65535;
    const searchStart = Math.max(0, bytes.length - 22 - maxCommentLength);
    for (let i = bytes.length - 22; i >= searchStart; i--) {
      if (
        bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06
      ) {
        return i;
      }
    }
    return -1;
  }

  // Lit le répertoire central d'une archive ZIP (`bytes`: Uint8Array/ArrayBuffer) et renvoie la
  // liste de ses entrées — pas de dépendance à une lib de dézippage : le format ZIP central
  // directory est simple et stable (documenté publiquement), pas besoin de plus pour n'extraire
  // qu'un seul fichier connu d'avance (`Report/Layout`).
  function parseZipCentralDirectory(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buf);
    if (eocdOffset < 0) throw new Error('Archive ZIP invalide : signature de fin de répertoire central introuvable.');
    const entryCount = readUInt16LE(view, eocdOffset + 10);
    const centralDirOffset = readUInt32LE(view, eocdOffset + 16);

    const entries = [];
    let offset = centralDirOffset;
    for (let i = 0; i < entryCount; i++) {
      if (readUInt32LE(view, offset) !== CENTRAL_DIR_SIGNATURE) {
        throw new Error('Archive ZIP invalide : signature de répertoire central inattendue.');
      }
      const method = readUInt16LE(view, offset + 10);
      const compressedSize = readUInt32LE(view, offset + 20);
      const uncompressedSize = readUInt32LE(view, offset + 24);
      const nameLength = readUInt16LE(view, offset + 28);
      const extraLength = readUInt16LE(view, offset + 30);
      const commentLength = readUInt16LE(view, offset + 32);
      const localHeaderOffset = readUInt32LE(view, offset + 42);
      const name = new TextDecoder('utf-8').decode(buf.subarray(offset + 46, offset + 46 + nameLength));
      entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  // Lit les octets RÉELS d'une entrée (après son en-tête local, dont la taille peut différer de
  // celle du répertoire central si un "extra field" diffère entre les deux — rare mais déjà vu,
  // d'où une lecture explicite de l'en-tête local plutôt que de supposer un offset fixe) et les
  // décompresse si besoin. `inflateRaw(compressedBytes)` n'est appelé que pour une entrée DEFLATE
  // (`DataModel`, la plus grosse entrée d'un .pbix, est elle-même STOCKÉE non compressée au niveau
  // ZIP — voir l'en-tête de ce fichier) ; peut renvoyer une valeur ou une Promise, les deux formes
  // sont acceptées.
  async function readZipEntryBytes(bytes, entry, inflateRaw) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (readUInt32LE(view, entry.localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Archive ZIP invalide : en-tête local manquant pour "${entry.name}".`);
    }
    const nameLength = readUInt16LE(view, entry.localHeaderOffset + 26);
    const extraLength = readUInt16LE(view, entry.localHeaderOffset + 28);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const compressed = buf.subarray(dataOffset, dataOffset + entry.compressedSize);
    if (entry.method === ZIP_METHOD_STORED) return compressed;
    if (entry.method === ZIP_METHOD_DEFLATE) return await inflateRaw(compressed);
    throw new Error(`Méthode de compression ZIP non prise en charge (${entry.method}) pour "${entry.name}".`);
  }

  // `Report/Layout` est systématiquement en UTF-16LE (voir l'en-tête de ce fichier) ; UTF-8 en
  // repli si un jour ce n'est plus le cas, jamais annoncé comme garanti.
  function decodeLayoutJson(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let lastError;
    for (const encoding of ['utf-16le', 'utf-8']) {
      try {
        const text = new TextDecoder(encoding).decode(buf).replace(/^﻿/, '');
        return JSON.parse(text);
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error('Impossible de décoder Report/Layout en JSON (ni UTF-16LE ni UTF-8) : ' + (lastError && lastError.message));
  }

  // Type de visuel Power BI -> type de tuile Grist BI, limité aux correspondances directes et sans
  // ambiguïté. Volontairement absents (pas d'équivalent à 1 dimension + 1 mesure, ou logique trop
  // différente pour une suggestion automatique fiable) : table/matrix (-> notre "pivot" a 2
  // dimensions, pas 1), scatterChart (2 mesures), lineChart/areaChart/comboChart/map/
  // shapeMap/filledMap/decompositionTree/keyInfluencers/qnaVisual (aucun équivalent), slicer (c'est
  // un filtre, pas une tuile), textbox/image/shape/actionButton (pas un visuel de données).
  const VISUAL_TYPE_TO_TILE_TYPE = {
    barChart: 'bar',
    clusteredBarChart: 'bar',
    columnChart: 'bar',
    clusteredColumnChart: 'bar',
    hundredPercentStackedBarChart: 'bar',
    hundredPercentStackedColumnChart: 'bar',
    pieChart: 'pie',
    donutChart: 'pie',
    treemap: 'treemap',
    card: 'kpi',
    multiRowCard: 'kpi',
    gauge: 'gauge',
  };

  function literalTitle(singleVisual) {
    try {
      const titleObjs = singleVisual.vcObjects && singleVisual.vcObjects.title;
      const value = titleObjs && titleObjs[0] && titleObjs[0].properties && titleObjs[0].properties.text
        && titleObjs[0].properties.text.expr && titleObjs[0].properties.text.expr.Literal
        && titleObjs[0].properties.text.expr.Literal.Value;
      if (typeof value === 'string') return value.replace(/^'|'$/g, '');
    } catch (e) { /* titre absent ou structure inattendue : repli plus bas */ }
    return null;
  }

  // Lit chaque `visualContainer` de chaque section (page) du Layout décodé et en extrait les
  // champs utiles : type de visuel, titre (si défini explicitement), et les colonnes/mesures
  // utilisées (`prototypeQuery.Select`, la structure la plus stable observée dans de vrais fichiers
  // — `projections` existe aussi mais ne fait que RENVOYER vers les mêmes entrées `Select` par
  // index/rôle, sans information supplémentaire utile pour une suggestion de tuile). Un visuel dont
  // le JSON de config est illisible (`vc.config` non-JSON, visuel corrompu/futur format) est ignoré
  // plutôt que de faire échouer tout l'import — un seul visuel cassé ne doit pas bloquer les autres.
  function extractVisuals(layoutJson) {
    const visuals = [];
    const sections = (layoutJson && layoutJson.sections) || [];
    for (const section of sections) {
      const containers = section.visualContainers || [];
      for (const vc of containers) {
        let config;
        try { config = JSON.parse(vc.config); } catch (e) { continue; }
        const sv = config.singleVisual;
        if (!sv || !sv.visualType) continue;
        const select = (sv.prototypeQuery && sv.prototypeQuery.Select) || [];
        const fields = select.map((item) => {
          const isMeasure = !!item.Measure;
          const ref = item.Column || item.Measure || {};
          return {
            isMeasure,
            property: ref.Property || null,
            displayName: item.NativeReferenceName || ref.Property || null,
            fullName: item.Name || null,
          };
        });
        visuals.push({
          sectionName: section.displayName || section.name,
          visualId: config.name || null,
          visualType: sv.visualType,
          title: literalTitle(sv),
          tileType: VISUAL_TYPE_TO_TILE_TYPE[sv.visualType] || null,
          fields,
        });
      }
    }
    return visuals;
  }

  // Clé de comparaison tolérante entre un nom de champ Power BI (souvent "Sales Amount", avec
  // espaces/majuscules) et un id de colonne Grist réel (souvent "SalesAmount" ou "Sales_Amount") :
  // minuscules, espaces/tirets/underscores retirés. Best-effort assumé — les deux mondes n'ont
  // aucune garantie de nommage commun, voir la documentation utilisateur de cette fonctionnalité.
  function normalizeColumnKey(name) {
    return String(name || '').toLowerCase().replace(/[\s_-]+/g, '');
  }

  // Pour chaque champ d'un visuel, cherche la colonne Grist réelle correspondante parmi
  // `availableColumnIds` (essaie le nom technique `property` PUIS le nom d'affichage
  // `displayName` — voir l'exemple réel en tête de ce fichier où `property` est souvent déjà un
  // identifiant technique proche d'un id de colonne). Renvoie l'id Grist trouvé ou `null`.
  function matchColumn(field, availableColumnIds, columnKeyIndex) {
    for (const candidate of [field.property, field.displayName]) {
      if (!candidate) continue;
      const match = columnKeyIndex.get(normalizeColumnKey(candidate));
      if (match) return match;
    }
    return null;
  }

  // Construit, pour chaque visuel dont le type est pris en charge (voir VISUAL_TYPE_TO_TILE_TYPE),
  // une suggestion de tuile Grist BI prête à ajouter via `store.addTile` (voir js/main.js) — UNE
  // dimension + UNE mesure (bar/pie/treemap) ou juste UNE mesure (kpi/gauge), les mêmes champs que
  // le formulaire "+ Ajouter la tuile" construit à la main. Un visuel dont une colonne requise ne
  // trouve aucune correspondance dans `availableColumnIds` (table de travail actuellement
  // connectée) a `tileData: null` et liste ses `missingFields` — à afficher à l'utilisateur plutôt
  // qu'à importer en silence une tuile pointant vers une colonne qui n'existe pas.
  function suggestTiles(visuals, availableColumnIds) {
    const columnKeyIndex = new Map();
    for (const id of availableColumnIds) columnKeyIndex.set(normalizeColumnKey(id), id);

    return visuals.filter((v) => v.tileType).map((visual) => {
      const dimensionFields = visual.fields.filter((f) => !f.isMeasure);
      const measureFields = visual.fields.filter((f) => f.isMeasure);
      const needsDimension = visual.tileType !== 'kpi' && visual.tileType !== 'gauge';
      const missingFields = [];

      let dimension = null;
      if (needsDimension) {
        const field = dimensionFields[0];
        if (!field) missingFields.push('(dimension manquante dans le visuel)');
        else {
          dimension = matchColumn(field, availableColumnIds, columnKeyIndex);
          if (!dimension) missingFields.push(field.displayName || field.property);
        }
      }

      let measure = null;
      const measureField = measureFields[0] || dimensionFields[needsDimension ? 1 : 0];
      if (!measureField) missingFields.push('(mesure manquante dans le visuel)');
      else {
        measure = matchColumn(measureField, availableColumnIds, columnKeyIndex);
        if (!measure) missingFields.push(measureField.displayName || measureField.property);
      }

      const title = visual.title || [measure, dimension].filter(Boolean).join(' par ') || visual.visualType;
      const tileData = missingFields.length ? null : Object.assign(
        { type: visual.tileType, measure, aggFn: 'sum', title },
        needsDimension ? { dimension } : { dimension: '' }
      );

      return { visual, tileType: visual.tileType, title, missingFields, tileData };
    });
  }

  return {
    ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE,
    parseZipCentralDirectory, readZipEntryBytes, decodeLayoutJson,
    VISUAL_TYPE_TO_TILE_TYPE, extractVisuals, normalizeColumnKey, suggestTiles,
  };
});
