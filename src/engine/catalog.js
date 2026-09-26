// Laedt und kapselt den Teile-Katalog (data/parts.json).
// Einziger Ort, der das JSON kennt -> spaeter leicht durch ein Backend ersetzbar.

import { t, getLang } from "./i18n.js";
import { ACCESSORY_PACK } from './accessoryPack.js';
import { COLOR_HEX, isHexColor } from "./colors.js";
import { COLOR_ZH, COLOR_EN, COLOR_DE, PART_ZH, PART_EN, PART_DE } from "../names";

let _data = null;

export async function loadCatalog() {
  if (_data) return _data;
  const res = await fetch(`${import.meta.env.BASE_URL}data/parts.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(t("catalog_load_error", res.status));
  _data = await res.json();
  _data.accessories.push(...ACCESSORY_PACK.map(part => ({ ...part, compat: true, qdf: part.id })));
  return _data;
}

export function catalog() {
  if (!_data) throw new Error(t("catalog_not_loaded"));
  return _data;
}

export function geometry() {
  return catalog().geometry;
}

export function tubeColors() {
  return catalog().colors.tube;
}

export function connectorColor() {
  return catalog().colors.connector;
}

export function buildableTubes() {
  return catalog().tubes.filter((t) => t.buildable && t.length_cm != null);
}

export function allTubes() {
  return catalog().tubes;
}

// Baubare Bogenrohre (shape "curved"). Sie haben keine length_cm und tauchen
// daher bewusst NICHT in buildableTubes() auf -- ihr Rasterschritt ist der
// Bogenradius, nicht eine gerade Laenge.
export function buildableCurvedTubes() {
  return catalog().tubes.filter((t) => t.buildable && t.shape === "curved");
}

export function isCurvedTube(id) {
  const t = getTube(id);
  return !!t && t.shape === "curved";
}

export function allConnectors() {
  return catalog().connectors;
}

export function panels() {
  return catalog().panels || [];
}

export function buildablePanels() {
  return panels().filter((p) => p.buildable);
}

export function getPanel(id) {
  return panels().find((p) => p.id === id) || null;
}

// Zubehoer (Raeder, Rollen, Kappen, Netze ...) -- alles, was als Anbauteil
// am Geruest haengt und keine Kupplung, kein Rohr und keine Platte ist.
/** Teil nach id ueber alle Rubriken -- fuer Stueckliste und Bestand. */
export function getPartById(id) {
  const all = [...allConnectors(), ...accessories(), ...allTubes(), ...panels(),
    ...reinforcements(), ...screws()];
  return all.find((p) => p.id === id) || null;
}

export function accessories() {
  return catalog().accessories || [];
}

/**
 * Tuecher mit fester Groesse (Feld `rail`: Schlaufe laengs der Tragrohre und
 * Abstand der beiden Tragrohre, in cm). Das gewoehnliche Tuch hat keins -- es
 * nimmt jedes Feld des Netzrasters.
 */
export function railTextiles() {
  return accessories().filter((a) => a.qdf === "textil2" && a.rail);
}

/**
 * Katalogteil eines gesetzten Tuchs. Regenbogenband und -bruecke tragen ihre
 * Variante; sonst sagt die Lage, welches Tuch es ist: passen Schlaufenlaenge
 * und Rohrabstand zu einem Tuch fester Groesse, ist es dieses.
 */
export function textilePart(span, variant) {
  if (variant) return getPartById("textile_" + variant);
  const tol = 1.5;
  const fest = span && railTextiles().find((a) =>
    Math.abs(a.rail.along - span.len) <= tol && Math.abs(a.rail.gap - span.gap) <= tol);
  return fest || getPartById("textile");
}

/**
 * Katalogteil zu einer QDF-Elementart ("multi-wheel2" ...). Die Zuordnung steht
 * als Feld `qdf` am Teil, damit Import, Stueckliste und Export dieselbe Quelle
 * nutzen. Die Lochzapfenkupplung gibt es ein- und dreiarmig -- welche, sagt die
 * Arm-Maske aus dem Entwurf.
 */
export function partForFitting(kind, mask) {
  // Die Lagerkupplung hat kein eigenes QDF-Element -- sie ist eine Klemm-
  // Kupplung, die wir selbst setzen, und wird als bearing2 geschrieben.
  if (kind === "bearing-clamp") return getConnector("bearing");
  // Rohrkappe und offenes Verbinderende sind ZWEI Teile, nicht eins: die Kappe
  // (`tube-cap2`) ist 24 mm lang und an einem Ende geschlossen, das offene
  // Verbinderende (`open-connector2`) eine 50 mm lange, beidseitig offene
  // Huelse auf einem Kupplungs-Stutzen. Beide haengen an ihrem eigenen
  // Katalogteil, die Suche unten findet sie ueber `qdf`.
  if (kind === "hole-connector4") {
    // Die beiden untersten Bits sind das LOCH (lokal +X/-X), nicht Arme --
    // gezaehlt wird nur der Rest: ein, zwei oder drei Arme.
    let arms = 0;
    for (let b = 2; b < 6; b++) if ((mask || 0) & (1 << b)) arms++;
    return getConnector(arms >= 3 ? "hole_t" : arms === 2 ? "hole_2" : "hole_1");
  }
  const all = [...allConnectors(), ...accessories(), ...allTubes(), ...panels()];
  // Manche Teile waehlt die Leiste unter ihrer KATALOG-Kennung statt unter der
  // QDF-Art: die Lochzapfenkupplungen und die beiden Teile der Flexikupplung.
  // Ohne diesen zweiten Griff stand ueber der Szene kein Name.
  return all.find((x) => x.qdf === kind) || all.find((x) => x.id === kind) || null;
}

// Verstaerkungen (Holz-Profile), die in Rohre geschoben werden. Zu kaufen gibt
// es nur die 80-cm-Laenge; die Alu-Profile der Herstellersoftware sind weg.
export function reinforcements() {
  return catalog().reinforcements || [];
}

// Schrauben. Eigene Gruppe, weil sie NUR gerechnet werden: nichts zu setzen,
// nichts zu zeichnen, nichts im Bestand. Der Preis gilt je Packung (`pack`).
export function screws() {
  return catalog().screws || [];
}

/**
 * Passende Poolfolie zu einer Baellebad-Grundflaeche. Verglichen wird mit den
 * Katalogmassen (`pool` am Teil): XS gehoert zum kleinen Becken, S/L/XXL
 * unterscheiden sich in der Tiefe. Passt nichts genau, gewinnt die
 * flaechenmaessig naechste Groesse -- eine Folie braucht das Becken ohnehin.
 */
export function poolLinerFor(s1, s2) {
  const liners = accessories().filter((a) => a.pool);
  if (!liners.length || !s1 || !s2) return null;
  const short = Math.min(s1, s2), long = Math.max(s1, s2);
  const exact = liners.find((a) => a.pool.short === short && a.pool.long === long);
  if (exact) return exact;
  const area = short * long;
  return liners.reduce((best, a) => {
    const diff = Math.abs(a.pool.short * a.pool.long - area);
    return !best || diff < best.diff ? { def: a, diff } : best;
  }, null).def;
}

/** Schraube nach Kennung, z. B. "screw_panel". */
export function getScrew(id) {
  return screws().find((s) => s.id === id) || null;
}

// Standard-Verstaerkungsprofil (erstes definiertes).
export function reinforcementPart() {
  return reinforcements()[0] || null;
}

export function defaultPanel() {
  return geometry().defaultPanel || (buildablePanels()[0] && buildablePanels()[0].id);
}

export function getTube(id) {
  return catalog().tubes.find((t) => t.id === id) || null;
}

export function getConnector(id) {
  return catalog().connectors.find((c) => c.id === id) || null;
}

// Schwarz gibt es nicht als Rohrfarbe, aber als Farbe von Platten, Raedern und
// anderen Anbauteilen -- und in den Herstellerdateien als Material 1.
const EXTRA_COLORS = [{ id: "black", name: "Schwarz", name_en: "Black", hex: "#2b2b2b" }];

function colorDef(colorId) {
  return tubeColors().find((x) => x.id === colorId)
    || EXTRA_COLORS.find((x) => x.id === colorId) || null;
}

export function colorHex(colorId) {
  if (isHexColor(colorId)) return colorId;
  // 调色台改的是 COLOR_HEX；目录里的 hex 可能还是出厂值。
  if (COLOR_HEX[colorId]) return COLOR_HEX[colorId];
  const c = colorDef(colorId);
  if (c) return c.hex;
  return "#888888";
}

export function colorName(colorId) {
  if (isHexColor(colorId)) return colorId;
  const c = colorDef(colorId);
  if (!c) return colorId;
  const lang = getLang();
  if (lang === "zh") return COLOR_ZH[c.id] || c.name_en || c.name;
  if (lang === "en") return COLOR_EN[c.id] || c.name_en || c.name;
  return COLOR_DE[c.id] || c.name || c.name_en;
}

/** Gibt den Namen eines Teils in der aktuellen Sprache zurück. */
export function partName(part) {
  if (!part) return "";
  const lang = getLang();
  if (lang === "zh") return PART_ZH[part.id] || part.name_en || part.name || "";
  if (lang === "en") return PART_EN[part.id] || part.name_en || part.name || "";
  return PART_DE[part.id] || part.name || part.name_en || "";
}

// Knoten-Abstand (Mitte zu Mitte) fuer eine gegebene Rohrlaenge.
export function spacingFor(lengthCm) {
  return lengthCm + geometry().connectorSize;
}

// Raster-Schritt (40 cm beim 35er) = Basis fuer Diagonalen.
export function gridSpacing() {
  const t = getTube(geometry().defaultTube);
  return spacingFor(t ? t.length_cm : 35);
}

// Rohr fuer schraege (45-Grad) Elemente, z. B. T52 ueber ein 40er-Feld.
export function diagonalTubeId() {
  return geometry().diagonalTube || "T52";
}

// Rutschen/Dach-Art -> i18n-Schluessel. Einziger Ort, der die QDF-"kind"-Werte
// kennt (slide2, slide-new2, ...) -> spaeter leicht erweiterbar.
const SLIDE_KIND_KEYS = {
  "slide2": "slide_slide",            // Modularrutschen-Koerper
  "slide-new2": "slide_integral",     // Integralrutsche, steht fuer sich
  "slide-end2": "slide_end",          // Rutschenauslauf, schliesst eine Kette ab
  "curved-slide2": "slide_curved",    // Bogenrutschen-Koerper
  "roof2": "slide_roof",
};

// Anzeigename einer Rutsche/eines Dachs (BOM/Stueckliste): unbekannte Arten
// fallen auf "Rutsche" zurueck.
export function slideKindName(kind) {
  return t(SLIDE_KIND_KEYS[kind] || "slide_slide");
}

// Beschriftungstext fuer die 3D-Ansicht: liefert null bei unbekannter Art
// (dann wird keine Beschriftung angezeigt).
export function slideKindLabel(kind) {
  const key = SLIDE_KIND_KEYS[kind];
  return key ? t(key) : null;
}
