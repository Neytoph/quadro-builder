// Modell-Bibliothek: eigene QDF-Sammlung einlesen, Kennzahlen ableiten und
// gegen den Bestand pruefen.
//
// Bewusst ohne Three.js und DOM -- wie model.js/bom.js in Node testbar. Die
// Dateien selbst kommen vom Nutzer (z. B. die Beispielsammlung der
// Herstellersoftware); ausgeliefert wird hier nichts.

import { parseQDF } from "./qdfimport.js";
import { BuildModel } from "./model.js";
import { computeBOM, neededParts, SOFT_PARTS } from "./bom.js";
import { buildableTubes, panels as catalogPanels, geometry } from "./catalog.js";

// Toleranz beim QDF-Import. Gleicher Wert wie im Datei-Import der Oberflaeche:
// die Originaldateien rasten nicht immer exakt auf den halben Zentimeter ein.
const QDF_MERGE_EPS = 2;

// Wonach sich entscheidet, ob ein Modell aus dem eigenen Bestand entsteht.
// Anbauteile gehoeren dazu -- eine Rutsche oder ein Baellebad fehlt genauso wie
// ein Rohr. Draussen bleiben Schrauben (eigene Gruppe) und alles aus
// Textilien/Netzen (`SOFT_PARTS`).
const GROUPS = ["tubes", "connectors", "panels", "reinforcements", "fittings"];
// Kennzahlen-Fassung: aeltere Eintraege fuehren die Anbauteile noch nicht.
export const META_VERSION = 2;

/** QDF-Text in ein Modell-JSON uebersetzen. Liefert null, wenn nichts drin ist. */
export function parseDesign(qdfText) {
  const data = parseQDF(qdfText, {
    tubes: buildableTubes(),
    panels: catalogPanels(),
    connectorSize: geometry().connectorSize,
    mergeEps: QDF_MERGE_EPS,
  });
  return data && data.nodes && data.nodes.length ? data : null;
}

/**
 * Anzeigename aus einem Dateinamen: Endung ab, Unterstriche zu Leerzeichen,
 * angehaengte Bestellnummern weg ("Junior II_Haus_13820.qdf" -> "Junior II Haus").
 */
export function designName(filename) {
  let n = String(filename).replace(/\.[^.]+$/, "").trim();
  n = n.replace(/_+/g, " ");
  n = n.replace(/\s+\d[\d\s+x]*$/i, "");        // Bestellnummern am Ende
  return n.replace(/\s{2,}/g, " ").trim() || filename;
}

/**
 * Ein Bibliotheks-Eintrag aus einer QDF-Datei.
 *
 * Gespeichert wird der Originaltext plus die Kennzahlen -- damit laesst sich die
 * Liste anzeigen und gegen den Bestand filtern, ohne alle Dateien neu zu parsen.
 * Liefert null, wenn die Datei kein brauchbares Modell enthaelt.
 */
export function designEntry(id, filename, qdfText) {
  const data = parseDesign(qdfText);
  if (!data) return null;
  const model = new BuildModel();
  if (!model.loadJSON(data).ok) return null;

  const bom = computeBOM(model);
  const need = neededParts(bom);
  const b = model.bounds(geometry().connectorSize / 2);
  const parts = {};
  for (const g of GROUPS) {
    parts[g] = Object.fromEntries([...need[g]].filter(([id]) => !SOFT_PARTS.has(id)));
  }

  return {
    id,
    name: designName(filename),
    file: String(filename),
    qdf: qdfText,
    meta: {
      v: META_VERSION,
      nodes: model.nodes.size,
      connectors: bom.totals.connectors,
      tubes: bom.totals.tubes,
      panels: bom.totals.panels,
      slides: bom.totals.slides,
      price: bom.totals.price,
      size: b ? b.size.map((v) => Math.round(v)) : [0, 0, 0],
      parts,
    },
  };
}

/**
 * Reicht der Bestand fuer diesen Entwurf? Arbeitet auf den gespeicherten
 * Kennzahlen (parts), damit die Liste bei jeder Bestandsaenderung sofort neu
 * gefiltert werden kann -- neu geparst wird erst beim Oeffnen.
 * inv: { tubes:{id:n}, connectors:{}, panels:{}, reinforcements:{} }
 */
export function checkAgainstInventory(meta, inv) {
  const missing = [];
  for (const g of GROUPS) {
    const need = (meta.parts && meta.parts[g]) || {};
    const owned = (inv && inv[g]) || {};
    for (const [key, n] of Object.entries(need)) {
      const have = owned[key] || 0;
      if (have < n) missing.push({ group: g, key, need: n, owned: have });
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Summe der fehlenden Teile -- fuer die Sortierung "fast baubar zuerst". */
export function missingCount(check) {
  let n = 0;
  for (const m of check.missing) n += m.need - m.owned;
  return n;
}
