// Import von QDF-Dateien (natives Format der originalen QUADRO-3D-Software).
//
// Eine QDF-Datei ist Text, eine Anweisung pro Zeile: `typ{ feld, {tuple}, feld... }`.
// Relevante Zeilen:
//   material3{id,"farbe",...}                         -> Farbtabelle
//   connector3{mat,{q0,q1,q2,q3, x,y,z},...}          -> Kupplung (Knoten)
//   connector45_2{mat,{q0,q1,q2,q3, x,y,z},...}       -> 45-Grad-Kupplung (Knoten)
//   tube2{mat,{q0,q1,q2,q3, x,y,z},flag,len_mm,...}   -> Rohr (Start + Richtung + Laenge in rest[3])
//   round-tube2{...}                                  -> wie tube2
//   panel2{mat,{q0..q3, cx,cy,cz},flag,w_mm,_,h_mm,..}-> Platte (Mitte + Kantenmasse)
//   alu2{mat,{q0..q3, x,y,z},flag,len_mm,...}         -> Alu-Verstaerkungsprofil (wie Rohr, 800 mm)
//   alu-connector2{...}                               -> kurzes Alu-Profil (400 mm)
//   clamp2{mat,{q0..q3, x,y,z},flag,...}              -> Doppelrohrverbinder (Punkt auf einem Rohr)
//   clip2{mat,{q0..q3, x,y,z},flag,...}               -> Rohrklammer (wie clamp2, ein Loch offen)
//   textil2 / roof2 / slide* / curved-slide*          -> Sonderteile (uebersprungen)
//
// Alu-Profile werden in Rohre geschoben und verstaerken sie. Sie liegen wie
// Rohre entlang einer Achse (meist horizontal, auf erhoehten Ebenen). Da der
// Alu-Ankerpunkt nicht zuverlaessig auf einer Kupplung sitzt, ordnen wir ein
// Alu-Profil jenen importierten Rohren zu, deren Mittelpunkt auf dem Alu-Segment
// liegt (kollinear + parallel) und setzen dort reinforced = true.
//
// Koordinaten in mm (y = oben), Raster 400 mm = 40 cm. Quaternion {w,x,y,z}
// (nicht normiert) dreht die Basisachse +X. Rohr-Endpunkt = Start + Richtung * (Laenge + Kupplungsmass).
//
// Bewusst ohne Three.js/DOM, damit per Node testbar und Backend-tauglich.

import { round2 as round, panelNormal, modelMiddle, quatFromBasis } from "./util.js";
import { FORMAT_VERSION, C45_SLEEVE_LEN, C45_ARM_LEN } from "./config.js";
import { holePartForMask, holeArmDirs, BOLT_PART, MAX_HINGES, HINGE_STEP } from "./model.js";

// Alle benannten Richtungen (kardinal + 45°-diagonal) fuer Arm-Erkennung.
const S45 = Math.SQRT1_2;
const ALL_NAMED_DIRS = [
  { name: "+X", vec: [1, 0, 0] }, { name: "-X", vec: [-1, 0, 0] },
  { name: "+Y", vec: [0, 1, 0] }, { name: "-Y", vec: [0, -1, 0] },
  { name: "+Z", vec: [0, 0, 1] }, { name: "-Z", vec: [0, 0, -1] },
  { name: "+X+Y", vec: [S45, S45, 0] }, { name: "+X-Y", vec: [S45, -S45, 0] },
  { name: "-X+Y", vec: [-S45, S45, 0] }, { name: "-X-Y", vec: [-S45, -S45, 0] },
  { name: "+Z+Y", vec: [0, S45, S45] }, { name: "+Z-Y", vec: [0, -S45, S45] },
  { name: "-Z+Y", vec: [0, S45, -S45] }, { name: "-Z-Y", vec: [0, -S45, -S45] },
  { name: "+X+Z", vec: [S45, 0, S45] }, { name: "+X-Z", vec: [S45, 0, -S45] },
  { name: "-X+Z", vec: [-S45, 0, S45] }, { name: "-X-Z", vec: [-S45, 0, -S45] },
];
// Vektor auf die naechste benannte Richtung (kardinal oder 45°) runden.
function nearestNamedDir(v) {
  let best = ALL_NAMED_DIRS[0], bestDot = -Infinity;
  for (const d of ALL_NAMED_DIRS) {
    const dot = v[0] * d.vec[0] + v[1] * d.vec[1] + v[2] * d.vec[2];
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return { name: best.name, vec: best.vec };
}

// Anbauteile: QDF-Elementart -> wie sie zu lesen ist.
//   sized      = bringt Kantenmasse mit (rest[3]/rest[5], wie panel2)
//   masked     = fuehrt eine Arm-Maske (rest[4], wie connector3)
const FITTING_KINDS = {
  "bearing2":        {},                  // Lagerkupplung, traegt die Radachse
  "multi-wheel2":    {},                  // Speichenrad
  "floating-wheel2": {},                  // schwarzes Laufrad
  "hub-cap2":        {},                  // Nabenkappe
  "casters2":        {},                  // Laufrolle
  "steering-lock2":  {},                  // Lenkarretierung
  "adapter2":        {},
  "textil-round2":   {},                  // gebogene Wand (Viertelzylinder)
  "roof-large2":     {},                  // grosses Dach
  "lattice2":        { sized: true },     // Netz
  "bag2":            {},                  // Spielsack
  // Offenes Verbinderende: Huelse auf einem Stutzen der Kupplung. Sie erzwingt
  // diesen Stutzen -- ohne Rohr zeichnet und rechnet ihn sonst niemand.
  "open-connector2": {},
  // Kupplungen, die wir (noch) nicht setzen koennen und auch nicht zeichnen --
  // gelesen, benannt und beim Speichern unveraendert zurueckgeschrieben werden
  // sie trotzdem. `keepRest` haelt dafuer die Felder hinter der Lage fest.
  "flexi-connector3":   { keepRest: true },  // Flexikupplung (ein Arm)
  "bolt2":              { keepRest: true },  // Flexikupplung Bolzen
  "bearing-connector4": { keepRest: true },  // Lagerkupplung, klemmt um ein Rohr
  "tube-cap2":          { keepRest: true },  // Rohrkappe
};

// Tiefen, die ein Baellebad ueberhaupt haben kann -- die Langseiten der vier
// Poolfolien (XS 40x40, S 80x120, L 120x160, XXL 120x240). Die Datei fuehrt die
// Groesse nicht mit, sie wird aus den umstehenden Kupplungen gelesen; ohne diese
// Liste greift die Suche in alles, was zufaellig dahinter steht.
const POOL_DEPTHS = new Set([40, 80, 120, 160, 240]);

// Der Nullpunkt des kleinen Beckens liegt 20 cm neben der Mitte seiner
// Frontwand (abgegriffenes Modell: -22,5 bis +62,5 cm in lokal X). Beim
// grossen Becken sitzt er mittig.
const POOL_SMALL_OFFSET = 20;


// Farbnamen aus material3 auf unsere Farb-IDs abbilden.
const COLOR_BY_NAME = {
  red: "red", green: "green", blue: "blue", yellow: "yellow",
  // Schwarz gibt es als Bauteilfarbe (Platten, Raeder): ohne diesen Eintrag
  // wurde es zu Blau, und ein schwarzes Schwimmrad kam blau zurueck.
  black: "black",
  petrol: "petrol", mint: "mint", berry: "berry", apricot: "apricot",
};

// Lochplatten-Marker: Das QDF-Format kennt keine Lochplatte -- `panel2` hat kein
// freies Feld dafuer. Unser Export gibt ihr deshalb ein eigenes MATERIAL mit
// denselben Farbwerten und einem Namen "<farbe> (hole)" (siehe MATERIALS in
// qdfexport.js). Die Herstellersoftware zeichnet damit eine gewoehnliche Platte
// in derselben Farbe, wir erkennen sie hier wieder.
const HOLE_SUFFIX = " (hole)";
// Acrylglasplatte: gleicher Kniff, Name "<farbe> (acrylic)".
const ACRYLIC_SUFFIX = " (acrylic)";
// 功能板（兼容件）：名字「<farbe> (<feature>)」，feature 见 qdfexport.js FEATURE_KEYS。
const FEATURE_SUFFIX_RE = / \((lego|honeycomb|busy|felt|magnet|climbing|sensory|pocket|basin|rainbow|bridge)\)$/;
const FALLBACK_COLOR = "blue";

// So weit sitzt die Kupplung, die eine Lagerkupplung traegt, von deren Punkt
// entfernt (cm) -- gemessen an den Herstellerdateien, entgegen ihrer +X-Achse.
const BEARING_REACH = 10;

// Abstand vom gespeicherten Punkt des Spielsacks zur Mitte seines Feldes (cm).
const BAG_OFFSET = 20;

// Eine QDF-Zeile in { name, tuple:number[], rest:(number|string)[] } zerlegen.
function parseLine(line) {
  const m = line.match(/^\s*([A-Za-z][\w-]*)\s*\{(.*)\}\s*;?\s*$/);
  if (!m) return null;
  const name = m[1];
  let body = m[2];
  let tuple = null;
  const inner = body.match(/\{([^{}]*)\}/);
  if (inner) {
    tuple = inner[1].split(",").map((s) => parseFloat(s));
    body = body.slice(0, inner.index) + "\u0000" + body.slice(inner.index + inner[0].length);
  }
  const rest = body.split(",").map((s) => {
    const t = s.trim();
    if (t === "\u0000" || t === "") return null;
    const q = t.match(/^"(.*)"$/);
    if (q) return q[1];
    const num = parseFloat(t);
    return Number.isNaN(num) ? t : num;
  });
  // Rohtext der Felder HINTER der Lage: nur so kommen Teile, die wir bloss
  // durchreichen, beim Speichern wieder genau so heraus (150. bleibt 150.).
  const nach = body.indexOf("\u0000");
  const rawRest = nach < 0 ? "" : body.slice(nach + 1).replace(/^\s*,\s*/, "").trim();
  return { name, tuple, rest, rawRest };
}

// Vektor v mit (nicht normiertem) Quaternion q={w,x,y,z} drehen.
function rotateByQuat(q, v) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  const c2 = cross(u, t);
  return [v[0] + w * t[0] + c2[0], v[1] + w * t[1] + c2[1], v[2] + w * t[2] + c2[2]];
}
// Vektor auf Laenge 1 -- die Achsen aus einer Datei-Quaternion kommen sonst um
// deren Skalierung zu lang heraus.
function einsVec(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// QDF speichert die Quaternion-Komponenten vorzeichenbehaftet QUADRIERT
// (sign·v²·scale). Rueckwaerts: sign·√(|v|). ERST damit ergeben die Orientierungen
// die echten Richtungen -- Diagonalen kommen direkt als sauberes 45° heraus, ohne
// jeden Korrektur-Hack. (Erkenntnis aus dem Referenz-Viewer quadro-viewer:
// app/lib/qdf_transform_utils.ts -> decodeQdfQuaternion.)
function decodeQuat(q) {
  const rev = (v) => (v < 0 ? -1 : 1) * Math.sqrt(Math.abs(v));
  return [rev(q[0]), rev(q[1]), rev(q[2]), rev(q[3])];
}

// Ist die (normierte) Richtung eine saubere 45-Grad-Diagonale in EINER
// Achsenebene? (zwei Komponenten ~1/√2, die dritte ~0.)
function isDiag45(d) {
  const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].sort((x, y) => y - x);
  return Math.abs(a[0] - Math.SQRT1_2) < 0.04 && Math.abs(a[1] - Math.SQRT1_2) < 0.04 && a[2] < 0.04;
}

/**
 * Zuschlag zu einem Mass (cm). Die Datei fuehrt jedes Mass als PAAR: Grundmass
 * und direkt dahinter eine Zahl, die fast immer 0 ist. Wo sie es nicht ist,
 * gehoert sie DAZU -- die Strecke ist die Summe.
 *
 * Gemessen an den Herstellerdateien: von den 729 tube2-Zeilen mit einem
 * Zuschlag trifft das ferne Rohrende eine Kupplung in 665 Faellen MIT und in
 * 3 Faellen OHNE ihn; bei Platten liegen 74 von 96 mit Zuschlag auf allen vier
 * Ecken, ohne nur 25. Vorkommen tut das in gedrehten Aufbauten (22,5 Grad):
 * dort steckt das Rohr schraeg im Kupplungswuerfel, der Mittenabstand ist
 * darum groesser als Rohrlaenge + Kupplung.
 *
 * Das Teil selbst wird davon nicht laenger -- die Katalog-Zuordnung laeuft
 * weiter ueber das Grundmass.
 */
function padOf(rest, i) {
  return typeof rest[i] === "number" ? rest[i] / 10 : 0;
}

// renderRange-Filter (aus dem Referenz-Viewer): Der Viewer rendert NUR Rohre/
// Platten OHNE renderRangeStart-Feld; Datensätze MIT diesem Feld sind Alternativ-
// Pass-/Hilfsgeometrie -- meist exakte Duplikate. Wir verwerfen sie wie der Viewer.
// `base` = Anzahl der rest-Felder OHNE renderRange:
//   tube2          = 6  [id,∅,mat,len,endMat,0]
//   panel2/textil2
//   /display2      = 8  [id,∅,flag,w,_,h,_,0]
// rest[base] ist dann renderRangeStart.
/**
 * Feldzahl einer LEBENDEN Zeile je Elementart (docs/QDF-FORMAT.md §5).
 *
 * Jede Teile-Zeile endet mit dem Schritt, in dem das Teil entstand; eine
 * zweite Zahl dahinter ist der Schritt, in dem es wieder verschwand (§3.5).
 * Eine Zeile mit dieser zweiten Zahl beschreibt also ein geloeschtes Teil und
 * gehoert uebersprungen -- die Herstellersoftware zeichnet sie ebenfalls nicht.
 * Ohne den Filter kommen Karteileichen als Teile herein: allein die Kupplungen
 * brachten 575 Knoten an Stellen, an denen laengst nichts mehr steht.
 */
const LIVE_FIELDS = {
  "connector3": 8, "connector45_2": 5,
  "tube2": 6, "round-tube2": 6, "alu2": 6, "alu-connector2": 6,
  "panel2": 8, "display2": 8, "textil2": 8, "lattice2": 8,
  "clamp2": 4, "clip2": 5,
  "bearing2": 6, "bearing-connector4": 6, "bolt2": 6,
  "hole-connector4": 9, "flexi-connector3": 9,
  "open-connector2": 4, "adapter2": 4, "tube-cap2": 4,
  "multi-wheel2": 4, "floating-wheel2": 4, "hub-cap2": 4, "casters2": 4,
  "steering-lock2": 4,
  "slide2": 4, "slide-new2": 4, "curved-slide2": 4, "slide-end2": 4,
  "roof2": 4, "roof-large2": 4,
  "pool2": 4, "pool-small2": 4, "bag2": 4, "textil-round2": 5,
};

/**
 * Beschreibt die Zeile ein geloeschtes Teil? Erkannt an der EINEN zusaetzlichen
 * Zahl hinter den Feldern der Art. Genau eine -- laengere Zeilen bleiben
 * stehen: unsere eigenen Exporte fuehrten die Winkelkupplung zeitweise mit acht
 * statt fuenf Feldern, und die soll ein alter Entwurf nicht verlieren.
 */
function istTot(p) {
  const live = LIVE_FIELDS[p.name];
  return live != null && p.rest.length === live + 1;
}

// Lokale Arm-Achsen je variant2-Bit einer connector3 (Bitmaske der vorhandenen
// Arme). Exportiert, weil `scene.js` dieselbe Bitfolge braucht: die abgegriffenen
// Kupplungsmodelle sind nach ihr benannt und werden ueber sie zugeordnet.
export const CONNECTOR_ARM_BITS = [
  [0x01, [1, 0, 0]], [0x02, [-1, 0, 0]],
  [0x04, [0, 1, 0]], [0x08, [0, -1, 0]],
  [0x10, [0, 0, 1]], [0x20, [0, 0, -1]],
];
// Vereinigt zwei Listen von Richtungsvektoren (dedup nach ~Gleichheit).
function unionDirs(a, b) {
  const out = a.slice();
  for (const d of b) {
    if (!out.some((e) => Math.abs(e[0] - d[0]) < 0.05 && Math.abs(e[1] - d[1]) < 0.05 && Math.abs(e[2] - d[2]) < 0.05))
      out.push(d);
  }
  return out;
}

// Vektor auf die naechste Koordinatenachse (Einheits-Kardinalrichtung) runden.
function nearestCardinal(v) {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return [Math.sign(v[0]) || 1, 0, 0];
  if (ay >= az) return [0, Math.sign(v[1]) || 1, 0];
  return [0, 0, Math.sign(v[2]) || 1];
}

// Nearest-Buildable-Tube nach Laenge (cm) bestimmen.
function nearestTube(tubes, lengthCm) {
  let best = tubes[0], bestD = Infinity;
  for (const t of tubes) {
    if (t.length_cm == null) continue;
    const d = Math.abs(t.length_cm - lengthCm);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

// QDF-Text parsen -> { nodes, tubes, panels } passend fuer BuildModel.loadJSON().
// opts.tubes: [{id,length_cm}] (buildbare Rohre), opts.connectorSize: cm, opts.mergeEps: cm.
export function parseQDF(text, opts = {}) {
  const tubeCatalog = opts.tubes && opts.tubes.length
    ? opts.tubes
    : [{ id: "T35", length_cm: 35 }];
  const conn = opts.connectorSize != null ? opts.connectorSize : 5;
  const eps = opts.mergeEps != null ? opts.mergeEps : 2; // cm, beim Verschmelzen grosszuegig
  // Katalog-ID des Bogenrohrs (shape "curved"); nicht baubar, daher nicht in opts.tubes.
  const curvedTubeId = opts.curvedTubeId || "TC1";

  const materials = new Map(); // id -> colorId
  const holeMaterials = new Set(); // Material-Nummern, die eine Lochplatte kennzeichnen
  const acrylicMaterials = new Set(); // dito fuer die Acrylglasplatte
  const featureMaterials = new Map(); // Material-Nummer -> feature (功能板)
  const nodes = [];            // { id, x, y, z }
  const tubes = [];            // { id, a, b, tubeId, color, length }
  const panels = [];           // { id, nodes:[4 ids], panelId, color }
  const clamps = [];           // { id, x, y, z, connectorId } (clamp2 = Doppelrohrverbinder)
  const textiles = [];         // { id, nodes:[4 ids], w, h, color } (textil2 = Netz/Stoff)
  const slides = [];
  const holeClamps = [];       // Lochzapfenkupplungen (Rohr + Stelle folgt spaeter)           // { id, x, y, z, dir, kind } (slide*/roof2, dekorativ)
  const fittings = [];         // { id, kind, x, y, z, quat, color, w?, h?, mask? }
  const skipped = {};
  let seq = 1;

  // Plattengroesse (w x h cm) -> panelId. Sortiert, damit Reihenfolge egal ist.
  // Lochplatten (holes) bleiben aus der Massliste heraus: sie haben dieselben
  // Masse wie die volle Platte und wuerden diese sonst ueberschreiben. Aus einer
  // Herstellerdatei kommt eine Platte deshalb immer als VOLLE Platte -- das
  // Format kennt keine Lochplatte. Nur unsere eigenen Dateien kennzeichnen sie
  // ueber das Material (siehe HOLE_SUFFIX), dafuer steht `holePanelId`.
  const panelByDims = new Map();
  let holePanelId = null;
  let acrylicPanelId = null;
  const featurePanelIds = new Map();   // feature -> panelId（功能板同样不进尺寸表）
  for (const pa of opts.panels || []) {
    if (pa.w == null || pa.h == null) continue;
    if (pa.holes) { if (!holePanelId) holePanelId = pa.id; continue; }
    if (pa.acrylic) { if (!acrylicPanelId) acrylicPanelId = pa.id; continue; }
    if (pa.feature) { if (!featurePanelIds.has(pa.feature)) featurePanelIds.set(pa.feature, pa.id); continue; }
    const a = Math.round(pa.w), b = Math.round(pa.h);
    panelByDims.set(Math.min(a, b) + "x" + Math.max(a, b), pa.id);
  }
  function panelIdForDims(wCm, hCm) {
    const a = Math.round(wCm), b = Math.round(hCm);
    return panelByDims.get(Math.min(a, b) + "x" + Math.max(a, b)) || null;
  }


  // Knoten finden oder anlegen (verschmelzt nahe Punkte).
  const eps2 = eps * eps;
  function nodeAt(x, y, z, create = true) {
    for (const nd of nodes) {
      const dx = nd.x - x, dy = nd.y - y, dz = nd.z - z;
      if (dx * dx + dy * dy + dz * dz <= eps2) return nd;
    }
    if (!create) return null;
    const nd = { id: "n" + seq++, x, y, z };
    nodes.push(nd);
    return nd;
  }

  // Kupplungen sind die echten Gelenke. Rohrenden docken an die naechst-
  // gelegene zuvor platzierte Kupplung an, sodass aufeinanderfolgende Segmente
  // denselben Kupplungs-Knoten teilen.
  // Winkelkupplungs-Rohre (connector45_2) haben einen physischen Arm-Versatz
  // von ~8,67 cm zum Kupplungszentrum. Dafuer wird eine groessere Snap-
  // Toleranz (10 cm) verwendet.
  const connectorNodes = []; // Knoten, die aus einer Kupplung stammen
  // 5,5 statt 5 cm: Rohrenden, die genau eine Kupplungslaenge neben ihrer
  // Kupplung enden (Schraegen aus gedrehten Aufbauten), lagen exakt auf der
  // Grenze -- nach dem Runden auf Millimeter fielen sie mal drueber, mal
  // drunter, und beim Wiedereinlesen des eigenen Exports entstand dort ein
  // zweiter Knoten. Kleiner als das kuerzeste Rohr (10 cm) bleibt es.
  const SNAP_TOL = opts.snapTol != null ? opts.snapTol : 5.5;
  const snapTol2 = SNAP_TOL * SNAP_TOL;
  function snapToConnector(x, y, z, create = true) {
    let best = null, bestD = snapTol2;
    for (const nd of connectorNodes) {
      const dx = nd.x - x, dy = nd.y - y, dz = nd.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= bestD) { bestD = d2; best = nd; }
    }
    if (best) return best;
    return nodeAt(x, y, z, create);
  }

  // --- 45-Grad-Winkelkupplung (C45) -----------------------------------------
  // Das Diagonalrohr dockt ~8,67 cm (Adapter-Arm) versetzt zur Eck-Kupplung an.
  // diagonalEndNode legt am Rohrende den Adapter-Koerper (c45body) an und
  // verbindet ihn per kurzer Arm-Kante mit der Eck-Kupplung. Dadurch bleibt die
  // Diagonale exakt 45 Grad und das Bauwerk bleibt zusammenhaengend.
  const ARM_TOL = opts.armTol != null ? opts.armTol : 11; // cm, > Arm (8,67)
  const armTol2 = ARM_TOL * ARM_TOL;
  function nearestC45Corner(x, y, z) {
    let best = null, bestD = armTol2;
    for (const nd of connectorNodes) {
      if (!nd._c45corner) continue;
      const dx = nd.x - x, dy = nd.y - y, dz = nd.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.25 && d2 <= bestD) { bestD = d2; best = nd; } // > 0,5 cm: nicht die Ecke selbst
    }
    return best;
  }
  function diagonalEndNode(x, y, z) {
    const existing = snapToConnector(round(x), round(y), round(z), false);
    // Liegt das Rohrende in Arm-Reichweite eines connector45_2-Eck-Knotens?
    // Dann sitzt hier der C45-Adapter-Koerper (c45body) -- AUCH wenn dort schon
    // eine Kupplung steht: die Herstellersoftware schreibt an das freie Ende
    // einer Schraege eine connector3-Zeile, die Winkelkupplung steckt trotzdem
    // dort (Basic II_Auto mit Garage: 2 Enden mit Zeile, 2 ohne, alle vier sind
    // Winkelkupplungen). Nur eine ECK-Kupplung selbst wird nicht umgedeutet.
    const corner = nearestC45Corner(x, y, z);
    if (!corner || (existing && existing._c45corner)) {
      return existing || snapToConnector(round(x), round(y), round(z));
    }
    const body = existing || nodeAt(round(x), round(y), round(z)); // Adapter-Koerper am Rohrende
    // Stand an dieser Stelle schon eine Kupplung (freies Ende einer Schraege),
    // dann gehoert sie in die Datei zurueck -- der Adapter kommt dort zusaetzlich.
    if (existing) body.ownConnector = true;
    body.c45 = true;
    body.c45body = true;
    if (!connectorNodes.includes(body)) connectorNodes.push(body); // L3-fix: c45body als Snap-Ziel
    if (corner._c45axis) body.c45axis = corner._c45axis; // kardinale Huelsenachse
    if (corner.id !== body.id && !tubeExists(tubes, corner.id, body.id)) {
      tubes.push({ id: "m" + seq++, a: corner.id, b: body.id, arm: true, color: FALLBACK_COLOR });
    }
    return body;
  }

  // --- Winkelkupplung IM Rohr ----------------------------------------------
  // Sie muss nicht auf einem Stutzen sitzen: ihr 45-Grad-Fortsatz passt ebenso
  // in ein Rohrende. Dann steht dort KEINE connector3, sondern eine
  // connector45_2 eine Huelse plus einen Arm daneben -- und das Rohrende ist
  // der Adapter-Koerper.
  //
  // Erkannt wird das an der EXAKTEN Lage, nicht an blosser Naehe:
  //   Ende = Ecke + Huelsenachse * C45_SLEEVE_LEN + Rohrrichtung * C45_ARM_LEN
  // Am Bestand gemessen trifft das 8 Rohrenden in 3 Herstellerdateien (genau
  // die Faelle mit einer connector45_2 ohne eigene Kupplung); eine blosse
  // Abstandspruefung deutete dagegen 150 gerade Rohrenden um.
  const SLEEVE_TOL = 1;   // cm
  function sleeveCornerFor(x, y, z, insRohr) {
    for (const nd of connectorNodes) {
      if (!nd._c45corner || !nd._c45axis) continue;
      const a = nd._c45axis;
      const dx = nd.x + a[0] * C45_SLEEVE_LEN + insRohr[0] * C45_ARM_LEN - x;
      const dy = nd.y + a[1] * C45_SLEEVE_LEN + insRohr[1] * C45_ARM_LEN - y;
      const dz = nd.z + a[2] * C45_SLEEVE_LEN + insRohr[2] * C45_ARM_LEN - z;
      if (dx * dx + dy * dy + dz * dz <= SLEEVE_TOL * SLEEVE_TOL) return nd;
    }
    return null;
  }
  /**
   * Ende eines GERADEN Rohrs. Sitzt dort eine Kupplung, bleibt alles wie
   * gehabt; passt stattdessen die Huelsen-Rechnung, entsteht der Adapter-
   * Koerper samt Arm-Kante zur Eck-Kupplung.
   */
  function sleeveEndNode(x, y, z, insRohr) {
    const vorhanden = snapToConnector(round(x), round(y), round(z), false);
    if (vorhanden) return vorhanden;
    const corner = sleeveCornerFor(x, y, z, insRohr);
    if (!corner) return snapToConnector(round(x), round(y), round(z));
    const body = nodeAt(round(x), round(y), round(z));
    body.c45 = true;
    body.c45body = true;
    body.c45axis = corner._c45axis;
    if (!connectorNodes.includes(body)) connectorNodes.push(body);
    if (corner.id !== body.id && !tubeExists(tubes, corner.id, body.id)) {
      tubes.push({ id: "m" + seq++, a: corner.id, b: body.id, arm: true, color: FALLBACK_COLOR });
    }
    return body;
  }

  const lines = text.split(/\r?\n/);

  // 1. Durchlauf: Materialien + Kupplungen (Knoten zuerst, damit Rohre andocken).
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === "material3") {
      const id = p.rest.find((v) => typeof v === "number");
      let colorName = p.rest.find((v) => typeof v === "string");
      if (typeof colorName === "string" && colorName.endsWith(HOLE_SUFFIX)) {
        if (id != null) holeMaterials.add(id);
        colorName = colorName.slice(0, -HOLE_SUFFIX.length);
      } else if (typeof colorName === "string" && colorName.endsWith(ACRYLIC_SUFFIX)) {
        if (id != null) acrylicMaterials.add(id);
        colorName = colorName.slice(0, -ACRYLIC_SUFFIX.length);
      } else if (typeof colorName === "string" && FEATURE_SUFFIX_RE.test(colorName)) {
        const feature = colorName.match(FEATURE_SUFFIX_RE)[1];
        if (id != null) featureMaterials.set(id, feature);
        colorName = colorName.replace(FEATURE_SUFFIX_RE, "");
      }
      if (id != null) materials.set(id, COLOR_BY_NAME[colorName] || FALLBACK_COLOR);
    } else if (p.name === "connector3" || p.name === "connector45_2") {
      if (!p.tuple || p.tuple.length < 7) continue;
      if (istTot(p)) continue;                 // geloescht (Schrittfelder, §3.5)
      const x = p.tuple[4] / 10, y = p.tuple[5] / 10, z = p.tuple[6] / 10;
      const nd = nodeAt(round(x), round(y), round(z));
      // Sie steht als eigene Zeile in der Datei: ein gekauftes Teil, das bleibt
      // -- auch wenn gerade kein Rohr an ihr steckt (etwa das Deckenraster eines
      // Zimmeraufbaus). Weggeraeumt wird nur, was wir selbst angelegt haben.
      nd.fromFile = true;
      if (!connectorNodes.includes(nd)) connectorNodes.push(nd);
      // connector45_2 ist die ECK-Kupplung, an der eine 45-Grad-Winkelkupplung
      // (C45) sitzt. Der eigentliche Adapter-Koerper samt Diagonalrohr sitzt
      // ~8,67 cm versetzt (Adapter-Arm). Er wird in Durchlauf 2 als eigener
      // c45body-Knoten erzeugt und per kurzer Arm-Kante hier angedockt -- so
      // bleibt die Diagonale exakt 45 Grad UND zusammenhaengend (kein loses Ende).
      // _c45corner ist transient (nur Import-intern, wird nicht serialisiert).
      if (p.name === "connector45_2") {
        nd._c45corner = true;
        // Die Datei fuehrt hier eine Winkelkupplung -- unabhaengig davon, ob
        // wir daraus einen Adapter-Koerper ableiten koennen. Ohne diese Notiz
        // fiele sie beim Speichern weg (38 Stueck im Bestand).
        nd.c45file = true;
        // Huelsenachse: Richtung, in der die C45-Huelse auf einen Arm der
        // Basiskupplung gesteckt ist (= +X-Arm des connector45-Quaternions).
        // Gerundet wird auf die naechste BENANNTE Richtung, nicht nur auf eine
        // Achse: steckt die Winkelkupplung im Rohr statt auf einem Stutzen,
        // liegt ihre Huelse diagonal, und eine kardinal gerundete Achse zoege
        // den Adapter beim naechsten Laden schief. Steuert die Darstellung.
        const qc = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
        nd._c45axis = nearestNamedDir(rotateByQuat(qc, [1, 0, 0])).vec;
        // EIGENE Lage der Winkelkupplung (Three-Order x,y,z,w). Sie ist NICHT
        // die des Wuerfels: an 559 der 726 Vorkommen im Bestand tragen
        // connector3 und connector45_2 an derselben Stelle verschiedene
        // Quaternionen -- der Wuerfel ist ja drehsymmetrisch, die Winkelkupplung
        // nicht. Ohne sie zeigt jede Winkelkupplung in dieselbe Richtung.
        const cn = Math.hypot(qc[0], qc[1], qc[2], qc[3]) || 1;
        const cq = (v) => Math.round((v / cn) * 1e4) / 1e4;
        nd.c45quat = [cq(qc[1]), cq(qc[2]), cq(qc[3]), cq(qc[0])];
      } else {
        // connector3: Bei 45°-Drehung (Diagonalkupplung) die rotierten Arm-Richtungen
        // speichern. Dann braucht man beim Weiterbauen KEINEN C45-Adapter.
        const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
        // Wuerfel-Orientierung der Kupplung (Three-Order x,y,z,w). So sitzt der
        // Kupplungs-Wuerfel wie das echte Teil -- die Arme kommen aus den Flaechen,
        // auch bei Rampenwinkeln (30°/60°). Erste gewinnt bei Merge.
        // Die Identitaet nicht merken: sie dreht nichts und wuerde ein Modell
        // nach dem eigenen Export anders aussehen lassen als davor (wir
        // schreiben ungedrehte Kupplungen mit der Identitaet).
        const dreht = Math.abs(q[1]) > 1e-6 || Math.abs(q[2]) > 1e-6 || Math.abs(q[3]) > 1e-6;
        if (!nd.quat && dreht) {
          const cq = (n) => Math.round(n * 1e4) / 1e4;
          nd.quat = [cq(q[1]), cq(q[2]), cq(q[3]), cq(q[0])];
        }
        const fwd = rotateByQuat(q, [1, 0, 0]);
        const isCardinal = Math.max(Math.abs(fwd[0]), Math.abs(fwd[1]), Math.abs(fwd[2])) > 0.85;
        if (!isCardinal) {
          nd.armDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
            .map(v => nearestNamedDir(rotateByQuat(q, v)));
        }
        // variant2 (rest[4]) = Bitmaske der PHYSISCH vorhandenen Arme der Kupplung
        // (lokale Achsen: 0x01=+X,0x02=-X,0x04=+Y,0x08=-Y,0x10=+Z,0x20=-Z). In Welt-
        // koordinaten gedreht ergeben sie die echten Stutzen -- inkl. OFFENER Arme
        // (ohne Rohr). So sieht die Kupplung aus wie das echte Teil (Wuerfel + Arme).
        // Quelle: quadro-viewer connector_renderer.ts (getTubeDirections, variant2).
        const mask = typeof p.rest[4] === "number" ? p.rest[4] : 0;
        if (mask) {
          // ECHTE Arm-Richtung aus der Quaternion -- NICHT auf eine benannte
          // Richtung (kardinal/45°) snappen. Sonst wuerde ein realer Rampenwinkel
          // (z.B. 30°/60° = [0,0.866,0.5]) faelschlich auf 45° gezwungen. Genau wie
          // bei den Rohren wird die rohe, gedrehte Richtung verwendet.
          const ar4 = (n) => Math.round(n * 1e4) / 1e4;
          const armWorld = CONNECTOR_ARM_BITS
            .filter(([b]) => mask & b)
            .map(([, v]) => rotateByQuat(q, v).map(ar4));
          // Bei verschmolzenen Kupplungen (dichtes Netz) Arme vereinigen statt ueberschreiben.
          nd.arms = nd.arms ? unionDirs(nd.arms, armWorld) : armWorld;
        }
      }
    } else if (p.name === "clamp2" || p.name === "clip2") {
      // Doppelrohrverbinder (clamp2) und Rohrklammer (clip2) sitzen als freier
      // Punkt auf einem Rohr; der Punkt liegt in dem Loch, durch das dieses Rohr
      // laeuft (Test.qdf: Rohr auf der Y-Achse, clamp2 auf 0/340/0). Die lokale
      // +X-Achse ist die Rohrrichtung.
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      if (istTot(p)) continue;
      const x = p.tuple[4] / 10, y = p.tuple[5] / 10, z = p.tuple[6] / 10;
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const dir = nearestCardinal(rotateByQuat(q, [1, 0, 0]));
      // Wohin das zweite Loch zeigt, steckt in der Drehung: bei der Rohrklammer
      // auf der lokalen +Y-, beim Doppelrohrverbinder auf der lokalen -Z-Achse
      // (an den abgegriffenen Modellen gemessen). Ohne diese Richtung stuende
      // das Teil beliebig um sein Rohr gedreht.
      const zweit = nearestCardinal(p.name === "clip2"
        ? rotateByQuat(q, [0, 1, 0])
        : rotateByQuat(q, [0, 0, -1]));
      clamps.push({
        id: "k" + seq++, x: round(x), y: round(y), z: round(z),
        connectorId: p.name === "clip2" ? "tube_clamp" : "double_tube",
        dir, off: zweit.map((v) => round(v * conn)),
      });
    }
  }

  // 2. Durchlauf: Rohre (Start + gedrehte +X-Achse * Spannweite).
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === "round-tube2") {
      // Bogenrohr (Viertelkreis, 90 Grad). Die lokale +X-Achse ist die Tangente
      // am Bogenanfang, die lokale +Y-Achse zeigt zum Kreismittelpunkt; der
      // Radius ist der Rasterschritt (Rohrlaenge + Kupplungsmass).
      //   Mittelpunkt C = Start + N * R
      //   Ende        E = Start + R * (T + N)
      // Empirisch aus QuadroTobezimmer.qdf bestimmt: nur mit dieser Geometrie
      // landen BEIDE Bogenenden auf vorhandenen Kupplungen (gerade Deutung
      // trifft dort nichts). Vorher wurde der Bogen wie ein gerades Rohr
      // importiert und lag damit voellig falsch im Modell.
      if (!p.tuple || p.tuple.length < 7) continue;
      if (istTot(p)) continue;                 // geloescht (Schrittfelder, §3.5)
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const sx = p.tuple[4] / 10, sy = p.tuple[5] / 10, sz = p.tuple[6] / 10;
      const lenCm = (typeof p.rest[3] === "number" ? p.rest[3] : 350) / 10;
      const pad = padOf(p.rest, 4);              // Zuschlag zum Mass (siehe padOf)
      const R = lenCm + pad + conn;
      const T = rotateByQuat(q, [1, 0, 0]);
      const N = rotateByQuat(q, [0, 1, 0]);
      const cx = sx + N[0] * R, cy = sy + N[1] * R, cz = sz + N[2] * R;
      const ex = sx + R * (T[0] + N[0]), ey = sy + R * (T[1] + N[1]), ez = sz + R * (T[2] + N[2]);
      const a = snapToConnector(round(sx), round(sy), round(sz));
      const b = snapToConnector(round(ex), round(ey), round(ez));
      if (a.id === b.id) continue;
      if (tubeExists(tubes, a.id, b.id)) continue;
      const mat = typeof p.rest[0] === "number" ? p.rest[0] : null;
      const r6 = (v) => Math.round(v * 1e6) / 1e6;
      tubes.push({
        id: "t" + seq++, a: a.id, b: b.id,
        tubeId: curvedTubeId, color: materials.get(mat) || FALLBACK_COLOR,
        length: null, bow: true, bowCenter: [round(cx), round(cy), round(cz)],
        // Wie beim geraden Rohr: eigene Lage aus der Datei (Tangente T, Normale N).
        geom: { p0: [round(sx), round(sy), round(sz)], dir: T.map(r6), up: N.map(r6), len: lenCm,
          ...(pad ? { pad: round(pad) } : {}) },
      });
    } else if (p.name === "tube2") {
      if (!p.tuple || p.tuple.length < 7) continue;
      if (istTot(p)) continue;                 // geloescht (Schrittfelder, §3.5)
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const sx = p.tuple[4] / 10, sy = p.tuple[5] / 10, sz = p.tuple[6] / 10;
      const lenCm = (typeof p.rest[3] === "number" ? p.rest[3] : 350) / 10;
      const pad = padOf(p.rest, 4);              // Zuschlag zum Mass (siehe padOf)
      // Das TEIL richtet sich nach dem Grundmass -- laenger wird es nicht.
      const def = nearestTube(tubeCatalog, lenCm);
      const span = lenCm + pad + conn;
      // Dank √-Dekodierung ist dir die ECHTE Richtung: kardinal, sauberes 45°
      // (C45-Diagonale) oder ein echter Rampen-Winkel (z.B. 30°/60°, Doppelrohr).
      const dir = rotateByQuat(q, [1, 0, 0]);
      const is45 = isDiag45(dir);
      const ex = sx + dir[0] * span, ey = sy + dir[1] * span, ez = sz + dir[2] * span;
      // 45°-Diagonalrohre docken ueber einen Adapter-Koerper + Arm-Kante an die
      // C45-Eck-Kupplung an; gerade Rohre und echte Rampen schnappen direkt auf
      // die naechste Kupplung -- ausser die Winkelkupplung steckt IM Rohr
      // (sleeveEndNode).
      const gegen = [-dir[0], -dir[1], -dir[2]];
      const a = is45 ? diagonalEndNode(sx, sy, sz) : sleeveEndNode(sx, sy, sz, dir);
      const b = is45 ? diagonalEndNode(ex, ey, ez) : sleeveEndNode(ex, ey, ez, gegen);
      if (a.id === b.id) continue;
      if (tubeExists(tubes, a.id, b.id)) continue;
      const mat = typeof p.rest[0] === "number" ? p.rest[0] : null;
      const color = materials.get(mat) || FALLBACK_COLOR;
      // Das Rohr bringt seine eigene Lage mit: Anfang, Richtung und Teilemass
      // aus der Datei. Nur so bleibt eine gedrehte Konstruktion erhalten -- in
      // 4,7 % der Rohre des Bestands trifft das gerechnete Ende die Kupplung
      // naemlich nicht (die Herstellersoftware rundet dort selbst).
      tubes.push({ id: "t" + seq++, a: a.id, b: b.id, tubeId: def.id, color, length: def.length_cm,
        geom: { p0: [round(sx), round(sy), round(sz)], dir: dir.map((v) => Math.round(v * 1e6) / 1e6),
          len: lenCm, ...(pad ? { pad: round(pad) } : {}) } });
    } else if (p.name === "hole-connector4") {
      // Lochzapfenkupplung: sie umschliesst ein Rohr und bietet quer dazu einen
      // offenen Anschluss. Der Punkt ist die Muendung dieses Anschlusses, das
      // eingesteckte Rohr laeuft in lokaler -Y-Richtung (26 von 26 Faellen im
      // Bestand). Welches Rohr sie umschliesst, steht erst nach Durchlauf 3
      // fest -- deshalb hier nur merken.
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      if (istTot(p)) continue;
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const ey = rotateByQuat(q, [0, 1, 0]);
      holeClamps.push({
        x: round(p.tuple[4] / 10), y: round(p.tuple[5] / 10), z: round(p.tuple[6] / 10),
        stub: nearestCardinal([-ey[0], -ey[1], -ey[2]]),
        // Arm-Maske wie bei der Kupplung (rest[4]). Die Bits 0x01/0x02 sind das
        // Loch, der Rest sind ihre eigenen Arme -- daran haengt, ob sie ein-,
        // zwei- oder dreiarmig ist. Ohne Angabe die einarmige (51 von 55).
        mask: typeof p.rest[4] === "number" ? p.rest[4] : 11,
        // Eigene Ausrichtung aus der Datei (Three-Reihenfolge x,y,z,w). In
        // gedrehten Aufbauten steht die Klemme schraeg -- aus Stutzen und Rohr
        // laesst sie sich dann nicht zurueckrechnen.
        quat: [q[1], q[2], q[3], q[0]].map((v) => Math.round(v * 1e4) / 1e4),
      });
    } else if (FITTING_KINDS[p.name]) {
      // Anbauteile: Raeder, Radkappen, Laufrollen, Lager, Lochzapfen- und
      // offene Kupplungen, Rundwaende, grosse Daecher, Netze, Saecke. Alle
      // tragen Punkt + Ausrichtung; einige zusaetzlich Masse oder eine
      // Arm-Maske. Sie haengen am Geruest, greifen aber nicht in Knoten und
      // Rohre ein -- deshalb eine eigene Sammlung.
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      const spec = FITTING_KINDS[p.name];
      if (istTot(p)) continue;
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const qn = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      const mat = typeof p.rest[0] === "number" ? p.rest[0] : null;
      const f = {
        id: "f" + seq++, kind: p.name,
        x: round(p.tuple[4] / 10), y: round(p.tuple[5] / 10), z: round(p.tuple[6] / 10),
        quat: [r4(q[1] / qn), r4(q[2] / qn), r4(q[3] / qn), r4(q[0] / qn)],
        color: materials.get(mat) || null,
      };
      // Der Spielsack haengt zwischen zwei Rohren; der Punkt in der Datei liegt
      // aber auf dem EINEN Rohr -- die Mitte des Feldes liegt 200 mm weiter in
      // der lokalen +Z-Richtung (an allen fuenf Vorkommen steht dort das zweite
      // Rohr). Wir merken uns die Mitte, so wie bei selbst gesetzten Saecken.
      if (p.name === "bag2") {
        const ez = rotateByQuat(q, [0, 0, 1]);
        f.x = round(f.x + ez[0] * BAG_OFFSET);
        f.y = round(f.y + ez[1] * BAG_OFFSET);
        f.z = round(f.z + ez[2] * BAG_OFFSET);
      }
      // Das Netz bringt seine Masse mit. Anders als bei Rohren und Platten
      // ist es das ECHTE Mass der Flaeche, nicht das Teilemass ohne Kupplung:
      // 1550 x 775 spannt gemessen genau von -775 bis +775 um den Mittelpunkt.
      // Erstes Feld = lokales Y, zweites = lokales X (wie bei den Platten).
      if (spec.sized && typeof p.rest[3] === "number" && typeof p.rest[5] === "number") {
        f.w = round(p.rest[3] / 10 + padOf(p.rest, 4));
        f.h = round(p.rest[5] / 10 + padOf(p.rest, 6));
      }
      // Lochzapfenkupplung: Arm-Maske entscheidet ueber ein- oder dreiarmig.
      if (spec.masked && typeof p.rest[4] === "number") f.mask = p.rest[4];
      // Teile, die wir nur durchreichen: die Felder hinter der Lage im
      // Rohtext merken, damit der Export dieselbe Zeile schreibt wie die
      // Datei sie hatte.
      if (spec.keepRest && p.rawRest) f.rest = p.rawRest;
      fittings.push(f);
    } else if (
      p.name === "slide2" || p.name === "slide-new2" || p.name === "slide-end2" ||
      p.name === "curved-slide2" || p.name === "roof2"
    ) {
      // Rutsche/Dach: KEINE Maße im QDF, rein dekorativ. Wir merken Position +
      // volle (√-dekodierte) Quaternion. Damit baut scene.js die Slide-Geometrie
      // exakt wie der Referenz-Viewer (slide_renderer.ts) -- inkl. der dortigen
      // lokalen Versaetze + 45°/90°-Drehung. q ist [w,x,y,z]; Three nutzt [x,y,z,w].
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      // Alternativ-Pass-Duplikate verwerfen: Ein Rutschen-Teil steht mehrfach in
      // der Datei -- das ECHTE Teil traegt hoechstens EINE Zahl am Zeilenende,
      // die Duplikate ein vollstaendiges renderRange-PAAR (rest[4] gesetzt).
      // Ohne diesen Filter wird eine einzelne Rutsche mehrfach uebereinander
      // gezeichnet, teils spiegelverkehrt (entgegengesetzte Quaternionen).
      // Gleiche Regel wie bei round-tube2, dort mit dem Referenzbild abgeglichen.
      if (istTot(p)) continue;
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const qn = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      slides.push({
        id: "s" + seq++,
        x: round(p.tuple[4] / 10), y: round(p.tuple[5] / 10), z: round(p.tuple[6] / 10),
        quat: [r4(q[1]/qn), r4(q[2]/qn), r4(q[3]/qn), r4(q[0]/qn)], // Three-Reihenfolge x,y,z,w (normiert)
        kind: p.name,
      });
    }
  }

  // 2.5. Durchlauf: Platten + Textilien + Bällebad-Wände (nach allen Rohren, damit
  // c45body-Knoten vorhanden sind).
  //
  // Hilfsfunktion: sucht 4 Eck-Kupplungen eines rechteckigen Panels. cx/cy/cz ist die
  // wahre Mitte (symmetrisch zu allen vier Ecken). h1/h2 = halbe Netz-Spannweiten.
  // Probiert alle drei Achsenpaare (XY, XZ, YZ) plus gespiegelte h1/h2-Zuweisung.
  // Gibt [4 node-Refs] zurück, oder null wenn keine passenden Kupplungen gefunden.
  function findPanelCorners(q, cx, cy, cz, h1, h2) {
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => rotateByQuat(q, v));
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      for (const [ha, hb] of (h1 === h2 ? [[h1, h2]] : [[h1, h2], [h2, h1]])) {
        const [e1, e2] = [axes[i], axes[j]];
        const corner = (s1, s2) => [
          round(cx + e1[0] * ha * s1 + e2[0] * hb * s2),
          round(cy + e1[1] * ha * s1 + e2[1] * hb * s2),
          round(cz + e1[2] * ha * s1 + e2[2] * hb * s2),
        ];
        const ns = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
          .map((c) => snapToConnector(c[0], c[1], c[2], false));
        if (ns.every((n) => n)) return ns;
      }
    }
    return null;
  }

  // Auf welcher Seite der Rohre liegt die Platte? Die Datei sagt es ueber ihre
  // lokale Z-Achse; verglichen wird sie mit der kanonischen Normalen der vier
  // gefundenen Ecken (oben bzw. aussen = +1).
  function sideFromQuat(q, corners) {
    const [A, B, , D] = corners;
    const e1 = [B.x - A.x, B.y - A.y, B.z - A.z];
    const e2 = [D.x - A.x, D.y - A.y, D.z - A.z];
    const c = [0, 1, 2].map((i) => corners.reduce((s2, n) => s2 + [n.x, n.y, n.z][i], 0) / 4);
    const canon = panelNormal(e1, e2, c, modelMiddle(nodes));
    const ez = rotateByQuat(q, [0, 0, 1]);
    return (ez[0] * canon[0] + ez[1] * canon[1] + ez[2] * canon[2]) < 0 ? -1 : 1;
  }

  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;

    if (p.name === "panel2" || p.name === "display2") {
      // Platte (panel2) und Infoschild (display2): tuple = {q0..q3, cx,cy,cz} (Mitte, mm).
      // rest[3]/rest[5] = Kantenmaße (mm). display2 hat identische Struktur und wird als Panel importiert.
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      if (istTot(p)) continue;                 // geloescht (Schrittfelder, §3.5)
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const cx = p.tuple[4] / 10, cy = p.tuple[5] / 10, cz = p.tuple[6] / 10;
      const dimW = (typeof p.rest[3] === "number" ? p.rest[3] : 0) / 10;
      const dimH = (typeof p.rest[5] === "number" ? p.rest[5] : 0) / 10;
      // Zuschlaege gehoeren zur Spannweite, nicht zum Teil (siehe padOf): das
      // KATALOGTEIL sucht die Platte weiter ueber die Grundmasse, ihre Ecken
      // liegen aber um die Zuschlaege weiter aussen.
      const padW = padOf(p.rest, 4), padH = padOf(p.rest, 6);
      if (!(dimW > 0) || !(dimH > 0)) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      const matNr = typeof p.rest[0] === "number" ? p.rest[0] : null;
      // Lochplatte? Dann nicht ueber das Mass suchen -- das Lochraster steht im
      // Material (siehe HOLE_SUFFIX), die Groesse ist dieselbe wie bei der vollen.
      const featureId = matNr != null && featureMaterials.has(matNr)
        ? featurePanelIds.get(featureMaterials.get(matNr)) : null;
      const panelId = (matNr != null && holeMaterials.has(matNr) && holePanelId)
        ? holePanelId
        : (matNr != null && acrylicMaterials.has(matNr) && acrylicPanelId)
          ? acrylicPanelId
          : featureId || panelIdForDims(dimW + conn, dimH + conn);
      if (!panelId) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      const nodesFound = findPanelCorners(q, cx, cy, cz, (dimW + padW + conn) / 2, (dimH + padH + conn) / 2);
      if (!nodesFound) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      const mat = matNr;
      panels.push({ id: "p" + seq++, nodes: nodesFound.map((n) => n.id), panelId,
        color: materials.get(mat) || FALLBACK_COLOR, side: sideFromQuat(q, nodesFound),
        // Eigene Lage wie beim Rohr: auf Schraegen liegt die Platte in der Datei
        // bis zu 1,2 cm anders als aus dem Rohrpaar gerechnet.
        geom: { quat: [q[1], q[2], q[3], q[0]].map((v) => Math.round(v * 1e4) / 1e4),
          p: [round(cx), round(cy), round(cz)], w: round(dimW), h: round(dimH),
          ...(padW ? { padW: round(padW) } : {}), ...(padH ? { padH: round(padH) } : {}) } });

    } else if (p.name === "textil2") {
      // Netz/Stoff: gleiche Struktur wie panel2 (Zentrum + Maße + Quat). Maße z.B.
      // 35x75 cm -> Netz 40x80 cm (nicht im Platten-Katalog -> eigene Textil-Sammlung).
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      if (istTot(p)) continue;
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const cx = p.tuple[4] / 10, cy = p.tuple[5] / 10, cz = p.tuple[6] / 10;
      const dimW = (typeof p.rest[3] === "number" ? p.rest[3] : 0) / 10;
      const dimH = (typeof p.rest[5] === "number" ? p.rest[5] : 0) / 10;
      if (!(dimW > 0) || !(dimH > 0)) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      // Spannweite mit Zuschlag (siehe padOf); die Netzgroesse selbst rundet
      // weiter auf das Rastermass.
      const wGrid = dimW + padOf(p.rest, 4) + conn, hGrid = dimH + padOf(p.rest, 6) + conn;
      const found = findPanelCorners(q, cx, cy, cz, wGrid / 2, hGrid / 2);
      if (!found) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      // 套筒顺着局部 Y 套在管上：让 A→B 顺着局部 Y，模型就把这两条边上的管
      // 当承重管（_panelRecord 先试 A-B / D-C 这一对）。
      const [A, B, C, D] = found;
      const ey = rotateByQuat(q, [0, 1, 0]);
      const along = (m, n) => Math.abs((n.x - m.x) * ey[0] + (n.y - m.y) * ey[1] + (n.z - m.z) * ey[2]);
      const nodesFound = along(A, B) >= along(A, D) ? found : [A, D, C, B];
      const mat = typeof p.rest[0] === "number" ? p.rest[0] : null;
      const variant = mat != null && featureMaterials.has(mat) ? featureMaterials.get(mat) : null;
      textiles.push({
        id: "x" + seq++, nodes: nodesFound.map((n) => n.id),
        w: Math.round(Math.min(wGrid, hGrid)), h: Math.round(Math.max(wGrid, hGrid)),
        color: materials.get(mat) || FALLBACK_COLOR, side: sideFromQuat(q, nodesFound),
        ...(variant === "rainbow" || variant === "bridge" ? { variant } : {}),
      });

    } else if (p.name === "pool2" || p.name === "pool-small2") {
      if (istTot(p)) continue;
      // Bällebad: feste Geometrie (keine Maße im QDF -- im Original-Binary hardcoded).
      // Entity-Ursprung = OBERKANTE der Front-Wand -> wahre Mitte = Ursprung - lokaleY*(span1/2).
      //   pool2:       Frontwand 120 x 40 cm (3 x 1 Felder)
      //   pool-small2: Frontwand  80 x 20 cm (2 x 0,5 Felder)
      // Die Masse stehen im abgegriffenen Modell: pool2 misst 125 x 165 cm
      // (Becken 120 x 160 plus je eine halbe Rohrbreite), pool-small2
      // 85 x 125 -- also 80 x 120. Mit den frueheren 40 cm fand die Suche nur
      // die halbe Frontwand, das kleine Becken kam 40 x 40 herein und die
      // Stueckliste bot die XS-Folie statt der S-Folie an.
      // Die Datei enthält nur EINE Entity je Bällebad (die Front-Wand); die Tiefe
      // steht nicht darin und wird aus dem Kupplungsnetz hergeleitet
      // (Tiefenrichtung = cross(A→B, A→D) der Front-Wand).
      if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      // Breite, Hoehe und der Versatz des Nullpunkts -- die erste Fassung, zu
      // der es vier Ecken gibt, gewinnt. Beim KLEINEN Becken liegt der
      // Nullpunkt nicht in der Mitte der Frontwand: das abgegriffene Modell
      // reicht von -22,5 bis +62,5 cm, die Wandmitte liegt also 20 cm in
      // lokaler +X-Richtung. Die zweite Fassung (40 cm, mittig) ist der
      // Rahmen der XS-Folie, den diese App selbst baut.
      const kandidaten = p.name === "pool2"
        ? [[120, 40, 0]]
        : [[80, 20, POOL_SMALL_OFFSET], [40, 20, 0]];
      const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
      const ay = rotateByQuat(q, [0, 1, 0]); // lokale Y-Achse (Wandhöhe)
      const ax = rotateByQuat(q, [1, 0, 0]); // lokale X-Achse (Wandbreite)
      let span0 = 0, span1 = 0, versatz = 0, nodesFound = null;
      for (const [b0, b1, off] of kandidaten) {
        const px = p.tuple[4] / 10 + ax[0] * off + ay[0] * (-b1 / 2);
        const py = p.tuple[5] / 10 + ax[1] * off + ay[1] * (-b1 / 2);
        const pz = p.tuple[6] / 10 + ax[2] * off + ay[2] * (-b1 / 2);
        const ecken = findPanelCorners(q, px, py, pz, b0 / 2, b1 / 2);
        if (ecken) { span0 = b0; span1 = b1; versatz = off; nodesFound = ecken; break; }
      }
      if (!nodesFound) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
      const mat = typeof p.rest[0] === "number" ? p.rest[0] : null;
      const color = materials.get(mat) || FALLBACK_COLOR;
      // Das Baellebad ist EIN Teil -- die Datei fuehrt eine Zeile, im Laden gibt
      // es dafuer eine Poolfolie. Gespeichert wird deshalb ein Anbauteil an der
      // Original-Stelle (Oberkante der Frontwand) mit Breite, Hoehe und Tiefe;
      // Waende, Boden und Wasser zeichnet scene.js daraus.
      const [nA, nB, nC, nD] = nodesFound;
      const e1 = [nB.x - nA.x, nB.y - nA.y, nB.z - nA.z]; // horizontal
      const e2 = [nD.x - nA.x, nD.y - nA.y, nD.z - nA.z]; // vertikal
      const cr = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const crLen = Math.hypot(...cr) || 1;
      // Rückwand-Synthese: alle Connector-Tiefen ab nA in dv-Richtung aufzählen,
      // von nah nach fern testen, bis alle 4 Rückecken auf einem Rechteck liegen.
      // "Farthest" würde bei Pools, hinter denen weitere Struktur folgt (z.B. C0178),
      // über die echte Rückwand hinausschießen.
      const snapAtDepth = (nd, dir, depthCm) => {
        const ex = nd.x + dir[0]*depthCm, ey = nd.y + dir[1]*depthCm, ez = nd.z + dir[2]*depthCm;
        return connectorNodes.find(c => Math.hypot(c.x-ex, c.y-ey, c.z-ez) <= 3) || null;
      };
      const depthsAlong = (nd, dir) => {
        const ds = [];
        for (const c of connectorNodes) {
          const dx = c.x-nd.x, dy = c.y-nd.y, dz = c.z-nd.z;
          const proj = dx*dir[0]+dy*dir[1]+dz*dir[2];
          if (proj < 5) continue;
          if (Math.hypot(dx-dir[0]*proj, dy-dir[1]*proj, dz-dir[2]*proj) > 3) continue;
          ds.push(Math.round(proj));
        }
        return ds.sort((a, b) => a - b);
      };
      let dv = cr.map(v => v / crLen); // Tiefenrichtung (zeigt in den Pool)
      let depths = depthsAlong(nA, dv);
      if (depths.length === 0) { dv = dv.map(v => -v); depths = depthsAlong(nA, dv); } // Vorzeichen korrigieren
      // Entfernteste Tiefe nehmen, bei der ALLE 4 Rückecken existieren.
      // "Farthest" statt "nearest": Pool-Rückwand ist am Ende, Zwischen-Connectoren
      // (z.B. Seitenwand-Mittelknoten) würden sonst als falsche Rückwand gelten.
      let bestDepth = 0, bestBack = null;
      for (const depthCm of depths) {
        // Ein Baellebad ist ein PRODUKT: seine Folie gibt es in genau vier
        // Groessen, tiefer als 240 cm wird keine. Ohne diese Schranke lief die
        // Suche in die Konstruktion DAHINTER weiter -- in drei Herstellerdateien
        // kamen so 440 und 520 cm heraus, das Becken stand ueber und die
        // Stueckliste bot die naechstgroessere Folie an.
        if (!POOL_DEPTHS.has(depthCm)) continue;
        const bA = snapAtDepth(nA, dv, depthCm);
        const bB = snapAtDepth(nB, dv, depthCm);
        const bC = snapAtDepth(nC, dv, depthCm);
        const bD = snapAtDepth(nD, dv, depthCm);
        if (bA && bB && bC && bD && depthCm > bestDepth) {
          bestDepth = depthCm;
          bestBack = [bA, bB, bC, bD];
        }
      }
      // Ohne Rueckwand fehlt die Tiefe -- dann bleibt das Becken so flach wie
      // die Frontwand breit ist, statt gar nicht zu erscheinen.
      const depth = bestDepth || span0;
      // Vorzeichen: dv zeigt in den Pool, die lokale Z-Achse kann anders herum
      // stehen. In `d` steckt beides -- Tiefe UND Richtung.
      const localZ = rotateByQuat(q, [0, 0, 1]);
      const sign = (dv[0] * localZ[0] + dv[1] * localZ[1] + dv[2] * localZ[2]) < 0 ? -1 : 1;
      // Unser Anbauteil fuehrt die MITTE der Frontwand (dort zeichnet scene.js
      // die Waende); beim kleinen Becken liegt sie neben dem Nullpunkt der
      // Datei. Der Export rechnet den Versatz wieder heraus.
      fittings.push({
        id: "f" + seq++, kind: p.name,
        x: round(p.tuple[4] / 10 + ax[0] * versatz),
        y: round(p.tuple[5] / 10 + ax[1] * versatz),
        z: round(p.tuple[6] / 10 + ax[2] * versatz),
        quat: [q[1], q[2], q[3], q[0]], color,
        w: span0, h: span1, d: round(depth * sign),
      });
    }
  }

  // Lagerkupplung (bearing-connector4): Sie klemmt um ein Rohr und TRAEGT eine
  // Kupplung. Die steht in der Datei als eigene connector3 -- 10 cm entlang der
  // Ruecken-Richtung der Klemme (gemessen: 47 von 47 eindeutigen Faellen liegen
  // dort, ihre lokale +X-Achse zeigt von der Kupplung weg). Ohne diesen Durchlauf
  // weiss die Kupplung nichts von der Klemme und bekommt keinen Stutzen -- sie
  // stand als nackter Wuerfel neben dem Rohr.
  for (const f of fittings) {
    if (f.kind !== "bearing-connector4" || !f.quat) continue;
    // Lokale +X-Achse des Anbauteils (f.quat in Three-Order x,y,z,w).
    const ex = rotateByQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]], [1, 0, 0]);
    const ziel = [f.x - ex[0] * BEARING_REACH, f.y - ex[1] * BEARING_REACH, f.z - ex[2] * BEARING_REACH];
    const nd = nodeAt(round(ziel[0]), round(ziel[1]), round(ziel[2]), false);
    if (!nd || nd.part) continue;
    // Stutzen-Richtung wie beim selbst gesetzten Teil: vom Rohr WEG (die Kupplung
    // zeichnet ihren Arm entgegengesetzt, siehe scene.js).
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    nd.stub = [r4(-ex[0]), r4(-ex[1]), r4(-ex[2])];
    nd.bearingOn = f.id;
    // Die getragene Kupplung steht wie die Klemme -- sonst bietet sie die
    // Weltachsen an und ein angestecktes Rohr laeuft im falschen Winkel weg.
    if (!nd.quat) nd.quat = f.quat.slice();
  }

  // 3. Durchlauf: Alu-Verstaerkungsprofile -> markiere getroffene Rohre.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let reinforced = 0;
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name !== "alu2" && p.name !== "alu-connector2") continue;
    if (!p.tuple || p.tuple.length < 7) { skipped[p.name] = (skipped[p.name] || 0) + 1; continue; }
    if (istTot(p)) continue;
    const q = decodeQuat([p.tuple[0], p.tuple[1], p.tuple[2], p.tuple[3]]);
    const sx = p.tuple[4] / 10, sy = p.tuple[5] / 10, sz = p.tuple[6] / 10;
    const lenCm = (typeof p.rest[3] === "number" ? p.rest[3] : 800) / 10
      + padOf(p.rest, 4);                        // Zuschlag zum Mass (siehe padOf)
    // Dank √-Dekodierung hat das Alu-Profil dieselbe echte Richtung wie das Rohr,
    // das es verstaerkt (Diagonalen sauber 45°) -- es trifft die Rohre direkt.
    const sx2 = sx, sy2 = sy, sz2 = sz;
    const d = rotateByQuat(q, [1, 0, 0]);
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const u = [d[0] / dl, d[1] / dl, d[2] / dl];
    const span = lenCm + conn;
    let hit = false;
    for (const t of tubes) {
      const A = nodeById.get(t.a), B = nodeById.get(t.b);
      if (!A || !B) continue;
      const mx = (A.x + B.x) / 2 - sx2, my = (A.y + B.y) / 2 - sy2, mz = (A.z + B.z) / 2 - sz2;
      const proj = mx * u[0] + my * u[1] + mz * u[2];
      if (proj < -conn || proj > span + conn) continue;
      const px = mx - u[0] * proj, py = my - u[1] * proj, pz = mz - u[2] * proj;
      if (Math.hypot(px, py, pz) > eps + conn) continue; // nicht auf der Alu-Linie (L1-fix: +conn statt +2)
      const tx = B.x - A.x, ty = B.y - A.y, tz = B.z - A.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const cosang = Math.abs((tx * u[0] + ty * u[1] + tz * u[2]) / tl);
      if (cosang < 0.9) continue; // Rohr nicht parallel zum Alu
      if (!t.reinforced) { t.reinforced = true; reinforced++; }
      hit = true;
    }
    if (!hit) skipped[p.name] = (skipped[p.name] || 0) + 1;
  }

  // --- 4. Durchlauf: Doppelrohrverbinder (clamp2) -----------------------------
  // Eine Klemme ist eine "8": zwei Oeffnungen nebeneinander, durch jede laeuft
  // eine Tube. Sie haelt also ZWEI parallele, ~5 cm versetzte Tubes zusammen.
  // Wir finden dieses Paar, merken Achse + Versatz fuer die Darstellung und
  // verbinden die beiden Tubes per Link-Kante -- sonst haengt die angeklemmte
  // Teilstruktur (Rutsche/Rampe) lose in der Luft.
  {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const realTubes = tubes.filter((t) => !t.arm && !t.link);
    const closestOnSeg = (p, a, b) => {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const L2 = abx * abx + aby * aby + abz * abz || 1, L = Math.sqrt(L2);
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / L2;
      t = Math.max(0, Math.min(1, t));
      return { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t, dir: [abx / L, aby / L, abz / L] };
    };
    for (const c of clamps) {
      const cand = [];
      for (const t of realTubes) {
        const a = nodeById.get(t.a), b = nodeById.get(t.b);
        if (!a || !b) continue;
        const cp = closestOnSeg(c, a, b);
        const d = Math.hypot(cp.x - c.x, cp.y - c.y, cp.z - c.z);
        if (d < 7) cand.push({ t, cp, d });
      }
      cand.sort((x, y) => x.d - y.d);
      if (!cand.length) continue;
      const T1 = cand[0];
      let T2 = null;
      for (let i = 1; i < cand.length; i++) {
        const dot = Math.abs(T1.cp.dir[0] * cand[i].cp.dir[0] + T1.cp.dir[1] * cand[i].cp.dir[1] + T1.cp.dir[2] * cand[i].cp.dir[2]);
        const off = Math.hypot(cand[i].cp.x - T1.cp.x, cand[i].cp.y - T1.cp.y, cand[i].cp.z - T1.cp.z);
        if (dot > 0.95 && off >= 3 && off <= 7) { T2 = cand[i]; break; }
      }
      c.dir = T1.cp.dir.map(round);
      if (T2) {
        // Die Klemme sitzt auf der NAECHSTEN Tube (dort steht auch ihr Punkt in
        // der Datei) und greift mit dem zweiten Loch nach der anderen -- also
        // auf die erste Achse setzen und den Versatz dorthin merken.
        c.x = round(T1.cp.x); c.y = round(T1.cp.y); c.z = round(T1.cp.z);
        c.off = [round(T2.cp.x - T1.cp.x), round(T2.cp.y - T1.cp.y), round(T2.cp.z - T1.cp.z)];
        // Beide Tubes verbinden: naechstes Endknoten-Paar (kurze Link-Kante).
        const e1 = [nodeById.get(T1.t.a), nodeById.get(T1.t.b)], e2 = [nodeById.get(T2.t.a), nodeById.get(T2.t.b)];
        let best = null, bd = Infinity;
        for (const p of e1) for (const q of e2) { const dd = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); if (dd < bd) { bd = dd; best = [p, q]; } }
        if (best && best[0].id !== best[1].id && !tubeExists(tubes, best[0].id, best[1].id)) {
          tubes.push({ id: "l" + seq++, a: best[0].id, b: best[1].id, link: true, color: FALLBACK_COLOR });
        }
      }
    }
  }

  // --- Bereinigung -----------------------------------------------------------
  // Durch das Andocken an gemeinsame Kupplungen koennen entartete (a===b) oder
  // doppelte Rohre entstehen. Diese entfernen.
  for (let i = tubes.length - 1; i >= 0; i--) if (tubes[i].a === tubes[i].b) tubes.splice(i, 1);
  {
    const seenT = new Set();
    for (let i = tubes.length - 1; i >= 0; i--) {
      const t = tubes[i];
      const k = t.a < t.b ? t.a + "|" + t.b : t.b + "|" + t.a;
      if (seenT.has(k)) tubes.splice(i, 1); else seenT.add(k);
    }
  }

  // Fußrohr der Integralrutsche verwerfen: Unter ihrem Auslauf steht in der
  // QDF-Datei ein Rohr, dessen Mitte exakt auf der Rutschen-Position liegt --
  // es gehört zum Bauteil und ist real kein eigenes Rohr.
  //
  // Bei den Ketten-Teilen (Modular- und Bogenrutschen-Körper, Auslauf) ist es
  // umgekehrt: dort trägt an JEDEM Ende ein echtes Rohr die Bahn, und die
  // Herstellersoftware zeigt es auch. Die bleiben deshalb stehen.
  if (slides.length) {
    const FOOT_TOL = 3; // cm
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    for (let i = tubes.length - 1; i >= 0; i--) {
      const t = tubes[i];
      const a = nodeById.get(t.a), b = nodeById.get(t.b);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      const slide = slides.find((s) => s.kind === "slide-new2"
        && Math.hypot(s.x - mx, s.y - my, s.z - mz) <= FOOT_TOL);
      if (slide) {
        // Lage des Fussrohrs merken: der Export schreibt es wieder mit, sonst
        // fehlt es in der Datei und die Herstellersoftware zeigt die Rutschen-
        // Auflage nicht.
        if (t.geom) slide.foot = { ...t.geom, color: t.color };
        tubes.splice(i, 1);
      }
    }
  }

  // Frei schwebende Verbinder-Knoten (kein Rohr, keine Platte) entfernen --
  // diese Markierungen tragen nichts zum Modell bei und wuerden lose herumstehen.
  {
    const referenced = new Set();
    for (const t of tubes) { referenced.add(t.a); referenced.add(t.b); }
    for (const pa of panels) for (const id of pa.nodes) referenced.add(id);
    // Netze/Stoffe haengen genauso an Eck-Kupplungen wie Platten. Fehlten sie
    // hier, wurden deren Ecken als "frei schwebend" geloescht und das Netz zeigte
    // danach auf Knoten, die es nicht mehr gibt.
    for (const tx of textiles) for (const id of tx.nodes) referenced.add(id);
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (referenced.has(nodes[i].id)) continue;
      // Aus der Datei: nicht wegwerfen, aber als ungenutzt merken. In 71 der
      // 237 Herstellerdateien stehen solche Kupplungen (228 Stueck), an denen
      // nichts haengt -- die Herstellersoftware zeichnet sie nicht, wir also
      // auch nicht. Beim Speichern gehen sie trotzdem wieder mit hinaus.
      if (nodes[i].fromFile) nodes[i].unused = true;
      else nodes.splice(i, 1);
    }
  }

  // Lochzapfenkupplungen: Knoten an der Muendung, dazu das umschlossene Rohr.
  // Die Huelse sitzt eine Kupplungslaenge hinter der Muendung, auf der Achse
  // des Rohrs -- dort wird gesucht.
  const clampNodes = new Map(nodes.map((n) => [n.id, n]));
  for (const h of holeClamps) {
    const axis = [h.x - h.stub[0] * conn, h.y - h.stub[1] * conn, h.z - h.stub[2] * conn];
    let onTube = null, best = 6;   // Toleranz: die Huelse sitzt auf der Rohrachse
    for (const t of tubes) {
      if (t.bow) continue;
      const a = clampNodes.get(t.a), b = clampNodes.get(t.b);
      if (!a || !b) continue;
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
      const u = [ab[0] / L, ab[1] / L, ab[2] / L];
      const rel = [axis[0] - a.x, axis[1] - a.y, axis[2] - a.z];
      const s2 = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
      if (s2 < -1 || s2 > L + 1) continue;
      const d = Math.hypot(rel[0] - u[0] * s2, rel[1] - u[1] * s2, rel[2] - u[2] * s2);
      if (d < best) { best = d; onTube = { id: t.id, t: round(Math.max(0, Math.min(L, s2))) }; }
    }
    // NICHT auf eine vorhandene Kupplung schnappen: die Klemm-Kupplung ist ein
    // eigenes Teil, auch wenn sie dicht neben einer Kupplung sitzt. Sonst
    // verschwindet beim Export die Kupplung, an deren Stelle sie geschnappt ist.
    const nd = { id: "n" + seq++, x: h.x, y: h.y, z: h.z };
    nodes.push(nd);
    clampNodes.set(nd.id, nd);
    nd.part = holePartForMask(h.mask);
    nd.partMask = h.mask;
    nd.stub = h.stub;
    if (h.quat) nd.partQuat = h.quat;
    if (onTube) nd.clampOn = onTube;

    // Das Rohr steckt IM Zapfen, nicht in der Kupplung daneben: es laeuft an
    // der Muendung los, in Stutzenrichtung. Beim Einlesen der Rohre gab es den
    // Zapfen noch nicht, also ist sein Ende auf die naechstgelegene Kupplung
    // (5 cm daneben) geschnappt -- das wird hier umgehaengt. Sonst zaehlte die
    // Kupplung einen Arm zu viel und das Rohr saesse schief.
    // Das Rohr steckt IM Zapfen, nicht in der Kupplung daneben -- entschieden
    // wird an seiner echten Lage aus der Datei. Der frueher benutzte Vergleich
    // gegen die Armachse griff dort nicht, wo auch das FERNE Ende an einer
    // Lochzapfenkupplung sitzt: es war selbst um eine Kupplungslaenge
    // verschnappt und lag damit 5 cm neben der Achse (Ball Cage, das 52er
    // zwischen zwei Zapfen).
    haengeRohreUm(nd);
  }

  /**
   * Rohre, die in Wahrheit an DIESEM Teil haengen, von der Kupplung daneben
   * umhaengen. Entschieden wird an der ECHTEN Lage aus der Datei (`geom`):
   * liegt das Rohrende naeher am Teil als an dem Knoten, an dem es gerade
   * haengt, gehoert es dorthin. Beim Einlesen der Rohre gab es das Teil noch
   * nicht, ihr Ende schnappte deshalb auf die naechste Kupplung.
   */
  function haengeRohreUm(ziel, radius = 8) {
    for (const t of tubes) {
      if (t.arm || t.link) continue;
      const g = t.geom;
      if (!g || !g.p0 || !g.dir) continue;
      const spanne = (g.len || 0) + (g.pad || 0) + conn;
      const enden = {
        a: g.p0,
        b: [g.p0[0] + g.dir[0] * spanne, g.p0[1] + g.dir[1] * spanne, g.p0[2] + g.dir[2] * spanne],
      };
      for (const ende of ["a", "b"]) {
        if (t[ende] === ziel.id) continue;
        const dran = nodes.find((n) => n.id === t[ende]);
        if (!dran || Math.hypot(dran.x - ziel.x, dran.y - ziel.y, dran.z - ziel.z) > radius) continue;
        const e = enden[ende];
        const zumZiel = Math.hypot(e[0] - ziel.x, e[1] - ziel.y, e[2] - ziel.z);
        const zumKnoten = Math.hypot(e[0] - dran.x, e[1] - dran.y, e[2] - dran.z);
        if (zumZiel < zumKnoten) t[ende] = ziel.id;
      }
    }
  }

  // Flexikupplung: ein Bolzen (bolt2) und bis zu zwei Scharniere
  // (flexi-connector3) sitzen an EINER Stelle -- eine connector3 fuehrt die
  // Datei dort nicht. Daraus wird EIN Knoten mit Katalogteil: der Bolzen ist
  // das Teil (lokales +X = seine Achse), die Stellungen der Scharniere stehen
  // als Winkel um diese Achse in `hinges`. Genau so setzt sie auch der Editor,
  // und der Export schreibt daraus wieder dieselben Zeilen.
  //
  // Wo das Gelenk sitzt, sagt Feld 4 der bolt2-Zeile (an allen 83 Gelenken des
  // Bestands geprueft): 1 = der Bolzen steht mittig auf dem Punkt, 0 = er ist
  // 50 mm entlang seiner Achse hineingeschoben. Die Scharniere liegen in beiden
  // Faellen auf dem Gelenkpunkt.
  const flexiWeg = new Set();
  for (const b of fittings) {
    if (b.kind !== "bolt2" || !b.quat) continue;
    const qb = [b.quat[3], b.quat[0], b.quat[1], b.quat[2]];   // Three -> Datei
    let ex = einsVec(rotateByQuat(qb, [1, 0, 0]));
    const felder = String(b.rest || "").split(",").map((s) => s.trim());
    const mittig = felder[2] === "1";
    const px = b.x - (mittig ? 0 : ex[0] * 5);
    const py = b.y - (mittig ? 0 : ex[1] * 5);
    const pz = b.z - (mittig ? 0 : ex[2] * 5);
    let nd = nodes.find((n) => !n.part && Math.hypot(n.x - px, n.y - py, n.z - pz) < 2);
    let aufTraeger = false;
    // Kein Knoten am Gelenkpunkt? Dann steckt der Bolzen nicht anstelle einer
    // Kupplung, sondern auf DEREN STUTZEN -- eine Kupplungslaenge daneben, wie
    // die Lochzapfenkupplung. So sitzen die mittleren Gelenke des Ball Cage.
    // Der Knoten dafuer entsteht hier; die Kupplung selbst bleibt stehen.
    if (!nd) {
      const traeger = nodes.find((n) => {
        if (n.part || n.c45body) return false;
        const d = [n.x - px, n.y - py, n.z - pz];
        const L = Math.hypot(d[0], d[1], d[2]);
        if (Math.abs(L - conn) > 1) return false;                 // eine Kupplungslaenge
        // ... und zwar auf der Bolzenachse, nicht irgendwo daneben.
        return Math.abs(d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2]) > conn * 0.8;
      });
      if (traeger) {
        // Unsere Achse zeigt IMMER vom Traeger weg.
        const zu = einsVec([traeger.x - px, traeger.y - py, traeger.z - pz]);
        if (zu[0] * ex[0] + zu[1] * ex[1] + zu[2] * ex[2] > 0) ex = [-ex[0], -ex[1], -ex[2]];
        nd = nodeAt(round(px), round(py), round(pz));
        aufTraeger = true;
        // Rohre, die in Wahrheit am BOLZEN haengen, umhaengen -- sonst saessen
        // zwei Teile auf einem Stutzen, die Spannweiten waeren 5 cm zu gross
        // und die Rohre liefen schief (0/-1/0,06 statt 0/-1/0).
        haengeRohreUm(nd);
      }
    }
    if (!nd) continue;              // ohne Knoten bleibt die Zeile, wie sie war
    // Steckt der Bolzen ein Segment TIEFER (Feld 4 = 0), dann zeigt die Achse
    // der Datei ins Rohr hinein -- unsere zeigt immer heraus, also umdrehen.
    // Sitzt er mittig, ist die Richtung frei: dann zeigt sie wie beim selbst
    // gesetzten vom gehaltenen Rohr weg.
    if (!mittig) ex = [-ex[0], -ex[1], -ex[2]];
    // Steckt der Bolzen auf einem Stutzen, zeigt die Achse schon vom Traeger
    // weg -- dann bleibt sie so. Sonst gilt: weg vom gehaltenen Rohr.
    if (mittig && !aufTraeger) {
      let vorne = 0, hinten = 0;
      for (const t of tubes) {
        const o = t.a === nd.id ? nodes.find((n) => n.id === t.b)
          : t.b === nd.id ? nodes.find((n) => n.id === t.a) : null;
        if (!o) continue;
        const d = einsVec([o.x - nd.x, o.y - nd.y, o.z - nd.z]);
        const s = d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2];
        if (s > 0.9) vorne++;
        else if (s < -0.9) hinten++;
      }
      if (vorne && !hinten) ex = [-ex[0], -ex[1], -ex[2]];
    }
    const hoch = Math.abs(ex[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const sk = hoch[0] * ex[0] + hoch[1] * ex[1] + hoch[2] * ex[2];
    const ey = einsVec([hoch[0] - ex[0] * sk, hoch[1] - ex[1] * sk, hoch[2] - ex[2] * sk]);
    const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2],
      ex[0] * ey[1] - ex[1] * ey[0]];
    nd.part = BOLT_PART;
    nd.partQuat = quatFromBasis(ex, ey, ez).map((v) => Math.round(v * 1e4) / 1e4);
    // Wie tief der Bolzen im Rohr steckt: mittig (Feld 4 = 1) ein Segment,
    // sonst zwei -- dann traegt das AEUSSERE Segment die Scharniere und es
    // schaut nichts mehr heraus. Ohne das stand am Rand des Ball Cage ein
    // leeres Segment in der Luft.
    if (!mittig) nd.boltDeep = 2;
    nd.hinges = [];
    flexiWeg.add(b.id);
    for (const h of fittings) {
      if (h.kind !== "flexi-connector3" || !h.quat) continue;
      if (Math.hypot(h.x - px, h.y - py, h.z - pz) > 2) continue;
      if (nd.hinges.length >= MAX_HINGES) break;
      const qh = [h.quat[3], h.quat[0], h.quat[1], h.quat[2]];
      // Der eigene Stutzen des Scharniers zeigt nach lokal -Y.
      const arm = einsVec(rotateByQuat(qh, [0, -1, 0]));
      const u = -(arm[0] * ey[0] + arm[1] * ey[1] + arm[2] * ey[2]);   // 0 Grad = -Y
      const v = arm[0] * ez[0] + arm[1] * ez[1] + arm[2] * ez[2];
      let grad = Math.round((Math.atan2(v, u) * 180) / Math.PI / HINGE_STEP) * HINGE_STEP;
      grad = ((grad % 360) + 360) % 360;
      if (!nd.hinges.includes(grad)) nd.hinges.push(grad);
      flexiWeg.add(h.id);
    }
  }
  // Was zum Knoten geworden ist, faellt aus der Anbauteil-Liste: sonst stuende
  // die Flexikupplung zweimal in der Stueckliste und der Export schriebe jede
  // Zeile doppelt.
  if (flexiWeg.size) {
    for (let i = fittings.length - 1; i >= 0; i--) {
      if (flexiWeg.has(fittings[i].id)) fittings.splice(i, 1);
    }
  }

  // Durch das Umhaengen koennen Hilfsknoten am Rohrende leer zurueckbleiben --
  // die Kupplungen aus der Datei bleiben stehen (sie stehen ja darin), alles
  // andere faellt weg.
  if (holeClamps.length) {
    const used = new Set();
    for (const t of tubes) { used.add(t.a); used.add(t.b); }
    for (const pa of panels) for (const id of pa.nodes) used.add(id);
    for (const tx of textiles) for (const id of tx.nodes) used.add(id);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (used.has(n.id) || n.part) continue;
      if (n.fromFile) n.unused = true;
      else nodes.splice(i, 1);
    }
  }

  return {
    // Der Einleser liefert IMMER den aktuellen Stand -- er baut die Felder ja
    // gerade neu auf. Stuende hier 1, schoebe die Migration in model.js die
    // Klemmen noch einmal um eine halbe Lochweite.
    format: FORMAT_VERSION,
    nodes: nodes.map((n) => {
      const o = { id: n.id, x: n.x, y: n.y, z: n.z };
      if (n.c45) o.c45 = true;
      if (n.c45file) o.c45file = true;   // Winkelkupplung stand so in der Datei
      if (n.unused) o.unused = true;     // Kupplung ohne Rohr/Platte: nicht zeichnen
      if (n.partQuat) o.partQuat = n.partQuat;   // Ausrichtung der Klemm-Kupplung
      if (n.c45body) o.c45body = true;
      if (n.c45axis) o.c45axis = n.c45axis;
      if (n.c45quat) o.c45quat = n.c45quat; // eigene Lage der Winkelkupplung
      if (n.armDirs) o.armDirs = n.armDirs; // rotierte Arm-Richtungen (45-gedrehte Kupplung)
      if (n.arms) o.arms = n.arms; // variant2: echte Arm-Stutzen (inkl. offener Arme)
      if (n.quat) o.quat = n.quat; // Wuerfel-Orientierung der Kupplung (Three x,y,z,w)
      if (n.part) o.part = n.part; // festes Katalogteil (Klemm-Kupplung)
      if (n.partMask) o.partMask = n.partMask; // Arm-Maske der Lochzapfenkupplung
      if (n.hinges && n.hinges.length) o.hinges = n.hinges.slice(); // Stellungen der Flexi-Scharniere
      if (n.boltDeep) o.boltDeep = n.boltDeep; // Bolzen steckt zwei Segmente tief
      if (n.clampOn) o.clampOn = n.clampOn; // umschlossenes Rohr + Stelle darauf
      if (n.stub) o.stub = n.stub; // Richtung des offenen Anschlusses
      if (n.bearingOn) o.bearingOn = n.bearingOn; // getragen von dieser Lagerkupplung
      if (n.ownConnector) o.ownConnector = true; // c45body, an dem auch eine Kupplung sitzt
      return o;
    }),
    tubes,
    panels,
    clamps,
    textiles,
    slides,
    fittings,
    stats: {
      nodes: nodes.length, tubes: tubes.length, panels: panels.length,
      clamps: clamps.length, textiles: textiles.length, slides: slides.length,
      fittings: fittings.length,
      reinforced, skipped,
    },
  };
}

function tubeExists(tubes, a, b) {
  return tubes.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
}
