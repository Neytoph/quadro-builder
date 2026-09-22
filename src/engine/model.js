// Datenmodell des Bauwerks: Graph aus Knoten (Kupplungen) und Kanten (Rohren).
// Bewusst ohne Three.js-Abhaengigkeit, damit es testbar und Backend-tauglich bleibt.

import { MERGE_EPS, FORMAT_VERSION, DIAGONAL_SNAP_TOL, DIRECTIONS, DIAGONAL_DIRECTIONS, anchorGap } from "./config.js";

// Zellweite des Rasters, mit dem die Kollisionspruefung Nachbarn sucht. Etwas
// groesser als das laengste Rohr (75 cm + Kupplung): ein Rohr liegt damit in
// hoechstens zwei Zellen je Achse.
const COLL_CELL = 100;
import { round2 as round, quatFromXAxis, quatFromBasis, xAxisOf, yAxisOf, zAxisOf } from "./util.js";

// Wohin ein Anbauteil gehoert, gemessen an den 799 Vorkommen in den Dateien des
// Herstellers: `at` ist der Anker (Kupplung oder Rohr), `offset` der Abstand in
// cm entlang der gewaehlten Achse. Die Achse ist immer die lokale +X des Teils.
const FITTING_MOUNTS = {
  "bearing2":        { at: "node", offset: 0 },   // Radlager: 5-cm-Stueck an der Kupplung
  "casters2":        { at: "node", offset: 0 },   // Laufrolle; der Adapter kommt mit
  // Laufrollen-Adapter allein: in den Herstellerdateien 40-mal als eigenes Teil
  // auf einem freien Stutzen (meist waagerecht), ohne Rolle darauf.
  "adapter2":        { at: "node", offset: 0 },
  // Offenes Verbinderende: eine 5 cm lange, beidseitig offene Huelse auf einem
  // freien Stutzen der Kupplung. Sie ERZWINGT diesen Stutzen -- ohne Rohr
  // rechnet und zeichnet ihn sonst niemand (genau wie in der Herstellersoftware).
  "open-connector2": { at: "node", offset: 0 },
  // Multirad-Arretierung: sitzt am Ende des Stutzens. Sie darf als EINZIGE auf
  // einen Stutzen, auf dem schon eine Lochzapfenkupplung steckt -- sie haelt
  // diese dort fest.
  "steering-lock2":  { at: "node", offset: 0, onClamp: true },
};

/**
 * Teile, die auf einem ROHR sitzen statt an einer Kupplung -- sie werden durch
 * einen Klick auf das Rohr gesetzt, nicht ueber einen Ankerpunkt.
 *   "anywhere" = an der angeklickten Stelle, Achse = Rohrachse
 *   "end"      = am naeheren Rohrende, Achse nach aussen
 * Gemessen am Truck (My first Q+Mobil): die Raeder sitzen mitten auf einem
 * 15-cm-Rohr, die Nabenkappe an dessen Ende.
 */
export const TUBE_FITTINGS = {
  "multi-wheel2":    "anywhere",   // Multirad: auf einem Rohr ODER auf einem Radlager
  "floating-wheel2": "anywhere",   // Schwimmrad, knapp 15 cm dick
  "hub-cap2":        "end",        // Radkappe: am Rohrende ANSTELLE der Kupplung
};

// Welche Anbauteile sich setzen lassen: die an einer Kupplung (FITTING_MOUNTS),
// die auf einem Rohr (TUBE_FITTINGS) und die mit eigenem Ablauf (Radarretierung,
// Netz, Rundabdeckung, grosses Dach).
// Doppelte fallen raus: manche Teile stehen in zwei Tabellen, weil sie zwei
// Wege kennen (Radkappe: Ankerpunkt an der Kupplung UND Klick aufs Rohrende).
export const PLACEABLE_FITTINGS = [...new Set([
  ...Object.keys(FITTING_MOUNTS),
  ...Object.keys(TUBE_FITTINGS),
  "hub-cap2",                     // am offenen Rohrende, siehe _wheelCapMounts
  "tube-cap2",                    // Rohrkappe, ebenfalls am offenen Rohrende
  "bag2",                         // zwischen zwei Rohren, siehe addBag
  // Die Lochzapfenkupplung (hole-connector4) klemmt NICHT um ein Rohr: ihr Ring
  // greift über den Stutzen einer Kupplung, quer dazu steht ihr eigener Stutzen
  // für das Rohr.
  // Ein Ablauf zum Setzen fehlt noch; aus Dateien wird sie gelesen, gezeichnet
  // und gezählt.
  "bearing-clamp",                // Lagerkupplung: klemmt um ein Rohr (kein eigenes QDF-Element)
  "lattice2", "textil-round2",
  "textil2",                      // Textil: wie das Netz zwischen zwei Rohre
  // Das Dachtextil (roof-large2) steht bewusst NICHT hier: es ist über eine
  // ganz bestimmte Dachkonstruktion gestülpt und lässt sich nicht frei setzen.
  // Aus Dateien wird es weiter gelesen, gezeichnet und gezählt.
])];


// Abstand der beiden Bogenrohre, ueber die eine Rundabdeckung gespannt wird:
// in allen 52 Vorkommen 800 mm.
const ROUND_COVER_SPAN = 80;

// Netz: im Ball Cage spannt es 160 x 80 cm von Rohrmitte zu Rohrmitte. Da die
// Datei die Masse mitfuehrt, ist es nicht auf dieses eine Format festgelegt:
// erlaubt sind alle Rasterabstaende bis 160 cm, die Laenge ergibt sich aus der
// Ueberdeckung der beiden Rohre.
const LATTICE_GAPS = [40, 80, 120, 160];
const LATTICE_STEP = 40;
const LATTICE_MAX = 160;

// Breite der Teile entlang ihrer Achse (cm) -- so breit wie in scene.js
// gezeichnet. Gebraucht wird sie, um zu pruefen, ob ein Rad auf sein Rohr passt
// und ob es an ein anderes Teil stoesst.
const FITTING_WIDTH = {
  "multi-wheel2": 2.4, "floating-wheel2": 14, "hub-cap2": 5, "tube-cap2": 2.4,
  "open-connector2": 5,
  "bearing2": 5, "casters2": 5, "adapter2": 5, "steering-lock2": 2.4,
};

const WHEEL_KINDS = new Set(["multi-wheel2", "floating-wheel2"]);

// Kantenmass des Spielsacks (cm) -- er spannt ein Rasterfeld.
const BAG_SIZE = 35;

const CARDINALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Laenge des Radlagers (Feld 50. in allen 125 bearing2-Zeilen des Bestands).
const BEARING_LEN = 5;

// Die lokale +X-Achse eines Anbauteils in Weltkoordinaten (quat: Three x,y,z,w).
/** Vektor mit einem Quaternion (Three-Reihenfolge x,y,z,w) drehen. */
function rotateVecByQuat(q, v) {
  const [x, y, z, w] = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}

/** Quaternion um `grad` um die eigene Hochachse (lokales Y) weiterdrehen. */
function turnAroundY(q, grad) {
  if (!grad) return q.slice();
  const h = (grad * Math.PI) / 180 / 2;
  const r = [0, Math.sin(h), 0, Math.cos(h)];       // Drehung um lokales Y
  const [x1, y1, z1, w1] = q, [x2, y2, z2, w2] = r;
  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
}

/**
 * Quaternion um die WELT-Hochachse drehen (r  q statt q  r wie turnAroundY,
 * das um die eigene Y-Achse dreht). Gebraucht, wenn eine ganze Auswahl im
 * Raster gedreht wird: die Teile behalten ihre Neigung, ihre Ausrichtung
 * wandert aber mit der Drehung der Welt mit.
 */
function spinAroundY(q, grad) {
  if (!q || q.length !== 4 || !grad) return q ? q.slice() : q;
  const h = (grad * Math.PI) / 180 / 2;
  const [x2, y2, z2, w2] = q, [x1, y1, z1, w1] = [0, Math.sin(h), 0, Math.cos(h)];
  // Fein runden (neun Stellen): das raeumt den Rechenrest von 1e-16 weg, ohne
  // die teils krummen Werte aus den Dateien zu verbiegen -- vier Vierteldrehungen
  // ergeben so wieder genau die Ausgangswerte. Die 0 ohne Vorzeichen halten,
  // sonst steht -0 in der Datei.
  const r9 = (v) => (Math.round(v * 1e9) / 1e9) || 0;
  const out = [
    r9(w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2),
    r9(w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2),
    r9(w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2),
    r9(w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2),
  ];
  // q und -q beschreiben dieselbe Drehung; nach vier Vierteln kaeme sonst das
  // negierte Quaternion heraus und jede Datei saehe "geaendert" aus. Der
  // uebliche Schnitt haelt den Realteil positiv.
  const fuehrend = out[3] !== 0 ? out[3] : out.find((v) => Math.abs(v) > 1e-9);
  return fuehrend < 0 ? out.map((v) => (v === 0 ? 0 : -v)) : out;
}

/** Quaternion um eine Weltachse `u` um `radians` drehen (r * q). */
function spinAroundAxis(q, u, radians) {
  if (!q || q.length !== 4 || Math.abs(radians) < 1e-12) return q ? q.slice() : q;
  const h = radians / 2, s = Math.sin(h);
  const [x1, y1, z1, w1] = [u[0] * s, u[1] * s, u[2] * s, Math.cos(h)];
  const [x2, y2, z2, w2] = q;
  const r9 = (v) => (Math.round(v * 1e9) / 1e9) || 0;
  const out = [
    r9(w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2),
    r9(w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2),
    r9(w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2),
    r9(w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2),
  ];
  const fuehrend = out[3] !== 0 ? out[3] : out.find((v) => Math.abs(v) > 1e-9);
  return fuehrend < 0 ? out.map((v) => (v === 0 ? 0 : -v)) : out;
}

function rotateX(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
  ];
}

/**
 * Abstand der Klemm-Kupplung von der Rohrachse, in Kupplungslaengen.
 * Die Lochzapfenkupplung nimmt an ihrer Muendung direkt ein Rohr auf -- eine
 * Laenge reicht. Die Lagerkupplung traegt dort eine ganze Kupplung, die noch
 * einmal eine Laenge weiter aussen sitzt.
 */
export function clampOffset(part, cs = 5) {
  return part === "bearing" ? cs * 2 : cs;
}

/**
 * Abstand der Kupplung, die eine Lagerkupplung traegt, von der Rohrachse.
 * Sie ist ein gewoehnlicher Knoten -- die Lagerkupplung selbst ist ein
 * Anbauteil, `bearingOn` verbindet die beiden.
 */
/**
 * Lage einer Lagerkupplung. Sie braucht ZWEI Achsen, nicht nur eine:
 * lokales +X zeigt von der getragenen Kupplung weg, und das geklemmte Rohr
 * laeuft entlang des lokalen +Y -- gemessen an allen 86 eindeutigen Vorkommen
 * in den Herstellerdateien. Nur +X festzulegen laesst die Rolle offen, und die
 * Klemme steht dann quer zum Rohr statt darum.
 *
 * `rohr` darf fehlen (noch nichts eingeklemmt) -- dann tut es irgendeine
 * Querrichtung.
 */
function bearingQuat(ausrichtung, rohr) {
  if (rohr) {
    // Das Rohr gibt die Achse vor -- die Klemme MUSS genau darum greifen. Die
    // Ausrichtung zur getragenen Kupplung darf dafuer nachgeben; steht sie
    // nicht exakt quer (schraeges Rohr), wird ihr Laengsanteil abgezogen.
    const ey = norm3(rohr);
    let rest = [ausrichtung[0] - ey[0] * dot3(ausrichtung, ey),
      ausrichtung[1] - ey[1] * dot3(ausrichtung, ey),
      ausrichtung[2] - ey[2] * dot3(ausrichtung, ey)];
    if (Math.hypot(rest[0], rest[1], rest[2]) < 1e-3) {
      const ersatz = Math.abs(ey[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      rest = [ersatz[0] - ey[0] * dot3(ersatz, ey), ersatz[1] - ey[1] * dot3(ersatz, ey),
        ersatz[2] - ey[2] * dot3(ersatz, ey)];
    }
    const ex = norm3(rest);
    return quatFromBasis(ex, ey, cross3(ex, ey));
  }
  // Noch kein Rohr: die Ausrichtung steht fest, das Maul zeigt irgendwohin quer.
  const ex = norm3(ausrichtung);
  const ersatz = Math.abs(ex[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const rest = [ersatz[0] - ex[0] * dot3(ersatz, ex), ersatz[1] - ex[1] * dot3(ersatz, ex),
    ersatz[2] - ex[2] * dot3(ersatz, ex)];
  const ey = norm3(rest);
  return quatFromBasis(ex, ey, cross3(ex, ey));
}

/**
 * Teile, die es nur in Schwarz gibt: weder die Baufarbe noch die aus der Datei
 * faerbt sie um. In den Herstellerdateien tragen Radlager und Schwimmrad
 * durchgehend das schwarze Material (125 bzw. 76 Vorkommen), das offene
 * Verbinderende ebenso (alle 69 Vorkommen in 31 Dateien); die Rohrkappe gibt
 * es ebenfalls nur schwarz.
 */
export const BLACK_FITTINGS = new Set([
  "bearing2", "floating-wheel2", "tube-cap2", "open-connector2",
]);

// Teile mit FESTER Farbe -- weder die Baufarbe noch die aus der Datei faerbt
// sie um. Die Poolfolie gibt es nur in Blau; Radlager, Schwimmrad und
// Rohrkappe nur in Schwarz (siehe BLACK_FITTINGS).
export function fixedFittingColor(kind) {
  if (BLACK_FITTINGS.has(kind)) return "black";
  if (POOL_KINDS.has(kind)) return "blue";
  return null;
}

/**
 * Lochzapfenkupplungen: Katalog-Kennung -> Arm-Maske im LOKALEN System des
 * Teils, genau wie sie in der QDF-Zeile steht. Die Bits 0x01 und 0x02 (+X/-X)
 * sind das LOCH, mit dem das Teil ueber den Stutzen einer Kupplung greift; die
 * uebrigen Bits sind seine eigenen Arme.
 *   11 = -Y            einarmig
 *   15 = +Y -Y         zweiarmig
 *   59 = -Y +Z -Z      dreiarmig
 * Maske 31 (+Y -Y +Z) ist dieselbe dreiarmige, um 90 Grad um die Lochachse
 * gedreht -- sie kommt aus einer Datei des Bestands und wird nur gelesen.
 */
export const HOLE_MASKS = { hole_1: 11, hole_2: 15, hole_t: 59 };
const HOLE_ARM_BITS = [[0x04, 1, 1], [0x08, 1, -1], [0x10, 2, 1], [0x20, 2, -1]];

/** Ist dieser Knoten eine Lochzapfenkupplung? */
export function isHolePart(part) {
  return part === "hole_1" || part === "hole_2" || part === "hole_t";
}

/** Katalogteil zu einer Arm-Maske: die Zahl der Arme entscheidet. */
export function holePartForMask(mask) {
  let arme = 0;
  for (const [bit] of HOLE_ARM_BITS) if (mask & bit) arme++;
  return arme >= 3 ? "hole_t" : arme === 2 ? "hole_2" : "hole_1";
}

/**
 * Die eigenen Arme einer Lochzapfenkupplung in Weltrichtungen -- dorthin
 * gehoeren Rohre. Die Lage steckt in `partQuat`, welche Arme es gibt in
 * `partMask` (aus der Datei) bzw. in der Maske ihres Katalogteils.
 */
export function holeArmDirs(node) {
  if (!node || !isHolePart(node.part)) return [];
  const mask = node.partMask || HOLE_MASKS[node.part] || 0;
  const q = node.partQuat;
  const achsen = q && q.length === 4
    ? [xAxisOf(q), yAxisOf(q), zAxisOf(q)]
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const out = [];
  for (const [bit, achse, vz] of HOLE_ARM_BITS) {
    if (!(mask & bit)) continue;
    // Normieren: die Lage aus der Datei ist NICHT auf Laenge 1 gebracht (die
    // Werte stehen dort quadriert und mit 4 skaliert), ihre Achsen kaemen sonst
    // um diesen Faktor zu lang heraus.
    const a = norm3(achsen[achse]);
    out.push([round(a[0] * vz), round(a[1] * vz), round(a[2] * vz)]);
  }
  // Ohne Lage (aeltere Staende) bleibt nur der gemerkte Stutzen.
  if (!out.length && node.stub) out.push(node.stub.slice());
  return out;
}

/**
 * In welchen Richtungen steckt an dieser Kupplung eine Lochzapfenkupplung? Ihr
 * Loch sitzt auf dem Stutzen, der ist damit BELEGT -- dort gehoert weder ein
 * Rohr noch ein weiteres Teil hin. Einzige Ausnahme ist die Multirad-
 * Arretierung: sie haelt die Lochzapfenkupplung fest (so steht sie auch in den
 * Herstellerdateien, mitten auf dem Stutzen daneben).
 */
export function holeClampDirsAt(model, node, cs = 5) {
  const out = [];
  for (const h of model.nodes.values()) {
    // Auch ein Flexikupplungs-Bolzen kann auf einem Stutzen stecken statt am
    // Rohrende: dann ist der Stutzen genauso belegt (so sitzen die mittleren
    // Gelenke des Ball Cage auf ihrer Kupplung).
    if ((!isHolePart(h.part) && !isBoltPart(h.part)) || h.id === node.id) continue;
    const d = [h.x - node.x, h.y - node.y, h.z - node.z];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 0.5 || L > cs * 1.2) continue;
    out.push([d[0] / L, d[1] / L, d[2] / L]);
  }
  return out;
}

/**
 * Anbauteile, die den Stutzen einer Kupplung FUELLEN: sie stecken darauf oder
 * darin, daneben passt nichts mehr. Dieselbe Liste fuehren builder.js, scene.js
 * (zeichnet den Stutzen) und bom.js (zaehlt ihn als Arm).
 */
export const ARM_FITTINGS = new Set(["adapter2", "bearing2", "steering-lock2", "open-connector2"]);

/**
 * Teile, die den Stutzen ABSCHLIESSEN. Die Multirad-Arretierung sitzt an seinem
 * Ende; was darueber hinausginge -- Rohr, Winkelkupplung, Lochzapfen- oder
 * Lagerkupplung, weitere Anbauteile -- passt dort nicht mehr. Erlaubt bleibt
 * nur, was UNTER ihr sitzt: das Radlager (und das Rad darauf, das ohnehin am
 * Lager haengt, nicht am Stutzen).
 */
export const STUB_END_FITTINGS = new Set(["steering-lock2"]);
export const STUB_END_ALLOWED = new Set(["bearing2", "multi-wheel2"]);

/**
 * In welchen Richtungen steckt an dieser Kupplung ein Anbauteil im Stutzen?
 * `kinds` waehlt aus, welche zaehlen -- alle stutzenfuellenden (ARM_FITTINGS)
 * oder nur die abschliessenden (STUB_END_FITTINGS).
 */
export function armFittingDirsAt(model, node, kinds = ARM_FITTINGS) {
  const out = [];
  if (!model.fittings || !node) return out;
  for (const f of model.fittings.values()) {
    if (!kinds.has(f.kind) || !f.quat) continue;
    // Die Teile sitzen mit Abstand 0 auf der Kupplung (FITTING_MOUNTS); ihre
    // Richtung ist die eigene +X-Achse.
    if (Math.hypot(f.x - node.x, f.y - node.y, f.z - node.z) > 2) continue;
    out.push(xAxisOf(f.quat));
  }
  return out;
}

export function nodeClampOffset(node, cs = 5) {
  if (node && node.bearingOn) return cs * 2;
  return clampOffset(node && node.part, cs);
}

// Anbauteile, die sich per Klick weiterdrehen lassen: sie sitzen an einer
// Kupplung und haben eine Achse, fuer die es mehrere Richtungen gibt.
export const ROTATABLE_FITTINGS = new Set([
  "bearing2", "casters2", "open-connector2",
]);

const norm3 = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
const round4 = (v) => Math.round(v * 1e4) / 1e4;
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rodrigues: Punkt `p` um Achse durch `o` in Richtung `u` drehen (co=cos, si=sin). */
function rodriguesAt(p, o, u, co, si) {
  const r = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const c = cross3(u, r), d = dot3(u, r) * (1 - co);
  return [o[0] + r[0] * co + c[0] * si + u[0] * d,
    o[1] + r[1] * co + c[1] * si + u[1] * d,
    o[2] + r[2] * co + c[2] * si + u[2] * d];
}
function rodriguesDir(v, u, co, si) {
  const c = cross3(u, v), d = dot3(u, v) * (1 - co);
  return [v[0] * co + c[0] * si + u[0] * d, v[1] * co + c[1] * si + u[1] * d, v[2] * co + c[2] * si + u[2] * d];
}
/** Vorzeichenbehafteter Winkel von `from` nach `to` um Achse `u` (Bogenmass). */
function signedAngleAround(from, to, u) {
  return Math.atan2(dot3(u, cross3(from, to)), dot3(from, to));
}

// Baellebad-Bausaetze: die vier Poolfolien und der Rahmen, den jede braucht.
// `w` ist die Breite der Frontwand, `d` die Tiefe, `h` die Wandhoehe -- so
// steht es auch im Anbauteil. Die Masse stammen vom Hersteller; das Innenmass
// der Folie ist das Rahmenmass + 2,5 cm, das Aussenmass + 5 cm (Rohrbreite):
// `querHinten` gibt die hintere Breitseite eigens vor, wo der Bausatz von der
// Regel abweicht: beim S-Pool ist sie EIN 75er, waehrend vorn zwei 35er stehen.
//   XS   82,5 x  82,5 x 25  ->  80 x  80, Wandhoehe 20
//   S   122,5 x  82,5 x 25  ->  80 x 120, Wandhoehe 20
//   L   162,5 x 122,5 x 45  -> 120 x 160, Wandhoehe 40
//   XXL 242,5 x 122,5 x 45  -> 120 x 240, Wandhoehe 40 Die Datei kennt nur ZWEI Becken-Elemente
// (gemessen an den abgegriffenen Modellen: `pool-small2` ist 80 x 120 cm bei
// 20 cm Wandhoehe, `pool2` 120 x 160 bei 40); XS und XXL unterscheiden sich
// davon nur in der Tiefe, die die Datei ohnehin aus dem Rahmen ableitet.
export const POOL_SETS = {
  pool_liner_xs:  { liner: "pool_liner_xs",  kind: "pool-small2", w: 80,  d: 80,  h: 20 },
  pool_liner_s:   { liner: "pool_liner_s",   kind: "pool-small2", w: 80,  d: 120, h: 20, querHinten: [80] },
  pool_liner_l:   { liner: "pool_liner_l",   kind: "pool2",       w: 120, d: 160, h: 40 },
  pool_liner_xxl: { liner: "pool_liner_xxl", kind: "pool2",       w: 120, d: 240, h: 40 },
};

// --- Flexikupplung: Bolzen + Scharniere ---------------------------------
// Das Gelenk besteht aus DREI Teilen. Der Bolzen (QDF `bolt2`) ist 15 cm lang
// und hat drei Segmente zu je 5 cm: die beiden aeusseren sind Stutzen wie die
// Arme einer Kupplung, auf dem mittleren sitzen bis zu zwei Scharniere
// (QDF `flexi-connector3`), jedes mit einem eigenen Stutzen am anderen Ende.
//
// Im Modell ist der Bolzen ein KNOTEN mit festem Katalogteil -- wie die
// Lochzapfenkupplung. Er ersetzt die einarmige Kupplung am Rohrende: das eine
// aeussere Segment steckt im Rohr, die beiden anderen schauen heraus. Seine
// Lage steht in `partQuat` (lokales +X = Bolzenachse, vom Rohr weg), die
// Stellung der Scharniere in `hinges` -- Grad um diese Achse, 0 = lokal -Y.
export const BOLT_PART = "flexi_bolt";
export const HINGE_PART = "flexi_hinge";
// Die Kraenze der beiden Scharniere sind verzahnt: sie rasten in 45-Grad-
// Schritten. Naeher als 90 Grad koennen zwei Scharniere aber nicht
// zusammenstehen -- dafuer sind ihre Riemen zu breit; im Bestand stehen sie an
// allen 83 Gelenken 135 Grad auseinander.
export const HINGE_STEP = 45;
export const HINGE_MIN_GAP = 90;
export const MAX_HINGES = 2;
export const BOLT_SEGMENT = 5;              // Laenge eines Bolzensegments (cm)
// Wie tief der Bolzen im Rohr steckt -- ein Segment oder zwei. Bei EINEM sitzen
// die Scharniere auf dem mittleren Segment und das dritte steht frei fuer ein
// weiteres Teil; bei ZWEIEN traegt das aeussere Segment die Scharniere und es
// bleibt nichts uebrig. Beides gibt es in der Herstellersoftware, in der Datei
// steht es als Feld 4 der bolt2-Zeile (1 = mittig, 0 = ein Segment tiefer).
export const BOLT_DEPTHS = [1, 2];

/**
 * Kennung EINES Scharniers fuer Auswahl und Hervorhebung: sie haengen als
 * Winkel am Bolzen-Knoten und haben deshalb keine eigene Id.
 */
export function hingeKey(nodeId, index) {
  return `${nodeId}#${index}`;
}

/** Zerlegt so eine Kennung wieder; liefert null, wenn es keine ist. */
export function splitHingeKey(key) {
  const i = String(key).indexOf("#");
  if (i < 0) return null;
  const index = Number(key.slice(i + 1));
  return Number.isInteger(index) ? { nodeId: key.slice(0, i), index } : null;
}

/** Abstand zweier Stellungen auf dem Kranz, immer 0..180 Grad. */
export function hingeGap(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Ist dieser Knoten ein Flexikupplungs-Bolzen? */
export function isBoltPart(part) {
  return part === BOLT_PART;
}

/** Wie viele Segmente des Bolzens stecken im Rohr? (1 oder 2) */
export function boltDepth(node) {
  return node && node.boltDeep === 2 ? 2 : 1;
}

/**
 * Versatz der Bolzenmitte gegenueber dem Gelenkpunkt, in cm entlang seiner
 * +X-Achse. Steckt er zwei Segmente tief, rutscht er eines weiter ins Rohr.
 */
export function boltShift(node) {
  return (boltDepth(node) - 1) * -BOLT_SEGMENT;
}

/** Bolzenachse in Weltkoordinaten -- das lokale +X seiner Lage. */
export function boltAxis(node) {
  if (!node || !node.partQuat || node.partQuat.length !== 4) return [1, 0, 0];
  // Normieren: eine Lage aus der Datei hat nicht Laenge 1 (siehe holeArmDirs).
  return norm3(xAxisOf(node.partQuat));
}

/**
 * Armrichtung eines Scharniers. Es sitzt mit seinem Kranz auf der Bolzenachse
 * und zeigt mit dem eigenen Stutzen quer dazu; `grad` ist die Stellung um die
 * Achse, 0 = lokal -Y (bei waagerechtem Bolzen also nach unten).
 */
export function hingeDir(node, grad) {
  if (!node || !node.partQuat || node.partQuat.length !== 4) return [0, -1, 0];
  const ey = norm3(yAxisOf(node.partQuat)), ez = norm3(zAxisOf(node.partQuat));
  const b = (grad * Math.PI) / 180, c = Math.cos(b), s = Math.sin(b);
  return [round4(-ey[0] * c + ez[0] * s), round4(-ey[1] * c + ez[1] * s),
    round4(-ey[2] * c + ez[2] * s)];
}

/** Die Arme aller Scharniere eines Bolzens, in der Reihenfolge von `hinges`. */
export function hingeDirs(node) {
  if (!isBoltPart(node && node.part)) return [];
  return (node.hinges || []).map((g) => hingeDir(node, g));
}

/**
 * Alle Anschlussrichtungen eines Bolzens: seine beiden Stutzen auf der Achse
 * und je Scharnier dessen Arm. Dorthin gehoeren Rohre -- wie an die Arme einer
 * Kupplung.
 */
export function boltArmDirs(node) {
  if (!isBoltPart(node && node.part)) return [];
  const ex = boltAxis(node);
  const out = [[round4(-ex[0]), round4(-ex[1]), round4(-ex[2])]];
  // Der freie Stutzen gibt es nur, solange der Bolzen EIN Segment tief steckt --
  // zwei Segmente tief schaut nichts mehr heraus, woran etwas passt.
  if (boltDepth(node) === 1) out.unshift([round4(ex[0]), round4(ex[1]), round4(ex[2])]);
  return [...out, ...hingeDirs(node)];
}

// Name der naechsten Achsrichtung -- reicht, um belegte Arme zu erkennen.
function cardinalName(v) {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] > 0 ? "+x" : "-x";
  if (ay >= az) return v[1] > 0 ? "+y" : "-y";
  return v[2] > 0 ? "+z" : "-z";
}

// Rutsche: Einhaengepunkt sitzt knapp ueber den unteren Kupplungen des
// senkrechten Rohrpaars.
const SLIDE_HOOK_LIFT = 5;                 // cm ueber der unteren Kupplung
// Die Rutsche ist ein Fertigteil fester Groesse: im 40-cm-Raster zwei Ebenen
// hoch und drei Felder lang -- Fall 80 cm ab der Kupplung, Auslauf 120 cm. In
// den Herstellerdateien steht genau das: Fall 85 cm ab Einhaengepunkt (der
// Haken sitzt 5 cm ueber der Kupplung), Auslauf 120 cm, Neigung 35,3 Grad.
// Der Fuss muss nicht auf dem Boden landen -- er darf auch auf dem Geruest
// aufliegen; nur unter den Boden darf er nicht.
const SLIDE_DROP = 80;                     // cm, von der Kupplung bis zum Boden
const SLIDE_RUN = 120;                     // cm waagerechter Auslauf
// Rutschenteile und wie sie zusammenhaengen -- gemessen an den 176 Vorkommen
// in den Herstellerdateien:
//   Modularrutschen-Koerper (slide2): das Folgeteil sitzt im lokalen System bei
//     (0, -80, 120) cm und ist gleich gedreht (73 von 76 Vorkommen).
//   Bogenrutschen-Koerper (curved-slide2): das Folgeteil sitzt bei (60, -80, 60)
//     und ist um 90 Grad um die Hochachse weitergedreht (9 von 9) -- der Bogen
//     laeuft in lokaler +Z-Richtung hinein und in +X wieder heraus.
//   Rutschenauslauf (slide-end2) und Integralrutsche (slide-new2) haben keinen
//     Ausgang: hinter ihnen kommt nichts mehr.
export const SLIDE_PARTS = {
  "slide-new2":    { chain: false, exit: null },
  "slide2":        { chain: true,  exit: { off: [0, -80, 120], turn: 0 } },
  "curved-slide2": { chain: true,  exit: { off: [60, -80, 60], turn: 90 } },
  "slide-end2":    { chain: false, exit: null },
};
// QDF-Arten eines Baellebads: grosses und kleines Becken. Es ist EIN Anbauteil
// (Frontwand-Oberkante als Bezugspunkt, dazu w/h/d) -- keine Platten.
export const POOL_KINDS = new Set(["pool2", "pool-small2"]);

// Teile, die eine Kette fortsetzen duerfen (der Auslauf beendet sie).
export const SLIDE_CHAIN_KINDS = ["slide2", "curved-slide2", "slide-end2"];

// Freiraum, den die Bahn braucht: naeher als das darf keine Kupplung stehen.
const SLIDE_CLEARANCE = 18;
// So nah muss eine Kupplung am Auslauf liegen, damit er getragen wird.
const SLIDE_SUPPORT = 30;

// Zwei Platten gelten als in derselben Ebene, wenn ihre Mitten quer dazu weniger
// als so weit auseinanderliegen (oben/unten am selben Rohrpaar sind es 3,3 cm).
const PANEL_PLANE_EPS = 6;
// Erst ab dieser Ueberdeckung zaehlt es als Ueberlappung -- Kante an Kante nicht.
const PANEL_OVERLAP_EPS = 1;

// Boden. Unter der Nullebene wird nicht gebaut: die Kupplungen der untersten
// Lage sitzen genau darauf (y = 0), erst ein negativer Wert liegt darunter. Die
// Toleranz faengt Rundungsreste aus round2 ab.
const GROUND_TOL = 0.01;
// 不许往地面以下搭。原来是放开的（官方文件里偶尔有地下的件），但放开之后
// 地面接头会给出钻进地里的引导线，用户搭着搭着就把管子插到地下去了。
// 官方文件里本来就在地下的件照样能打开，只是不能再往下接。
const ALLOW_BELOW_GROUND = false;

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Punkt-zu-Strecke (Kupplung a–b). */
function distPointToSeg(px, py, pz, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  const t = ab2 < 1e-8 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2));
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

export class BuildModel {
  constructor() {
    this.nodes = new Map();  // id -> { id, x, y, z }
    this.tubes = new Map();  // id -> { id, a, b, tubeId, color, length }
    this.panels = new Map(); // id -> { id, nodes:[4 ids], panelId, color }
    this.clamps = new Map(); // id -> { id, x, y, z, connectorId } (Doppelrohrverbinder/Klemme)
    this.textiles = new Map(); // id -> { id, nodes:[4 ids], w, h, color } (Netz/Stoff, textil2)
    this.slides = new Map();   // id -> { id, x, y, z, dir, kind } (Rutsche, slide*/roof2, dekorativ)
    // Anbauteile: alles, was mit Punkt und Ausrichtung am Geruest haengt --
    // Raeder, Radkappen, Laufrollen, Lager, Lochzapfen- und offene Kupplungen,
    // Rundwaende, grosse Daecher, Netze, Saecke.
    // id -> { id, kind, x, y, z, quat, color, w?, h?, mask? }
    this.fittings = new Map();
    // 成组：一组是一批零件 id（管、板、布、滑梯、夹子、配件、接头）。
    // 点到组里任何一件整组一起选。gid -> Set<id>
    this.groups = new Map();
    this._seq = 1;
  }

  _id(prefix) {
    return prefix + this._seq++;
  }

  // --- Knoten -------------------------------------------------------------
  findNodeNear(x, y, z) {
    const p = { x, y, z };
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const n of this.nodes.values()) {
      if (dist2(n, p) <= eps2) return n;
    }
    return null;
  }

  /**
   * Hoehe der untersten Kupplungslage. Im Editor gebaute Modelle sitzen auf
   * y = connectorSize/2, importierte auf y = 0 -- die Rutsche endet auf der
   * Ebene, die das jeweilige Modell als Boden benutzt.
   */
  _groundLevel() {
    let min = Infinity;
    for (const n of this.nodes.values()) if (n.y < min) min = n.y;
    return Number.isFinite(min) ? min : 0;
  }

  /**
   * Liegt diese Hoehe unter dem Boden (Nullebene)?
   *
   * Gebaut werden darf auch unter dem Boden: mehrere Entwuerfe des Herstellers
   * setzen Teile bewusst tiefer (Fussenden von Tischen und Stuehlen, Raeder
   * unter dem Rahmen, Bodenplatten eines Pools). Die Pruefung bleibt als eine
   * Stelle stehen, damit sich die Regel wieder umdrehen laesst -- GROUND_TOL
   * beschreibt jetzt keinen Anschlag mehr.
   */
  isBelowGround(y) {
    return ALLOW_BELOW_GROUND ? false : y < -GROUND_TOL;
  }

  addNode(x, y, z) {
    const existing = this.findNodeNear(x, y, z);
    // Wird hier gebaut, ist die Kupplung in Gebrauch -- der Vermerk aus dem
    // Import (steht in der Datei, haelt aber nichts) gilt dann nicht mehr.
    if (existing) { delete existing.unused; return existing; }
    const node = { id: this._id("n"), x, y, z };
    this.nodes.set(node.id, node);
    return node;
  }

  removeNode(id) {
    const weg = this.nodes.get(id);
    if (!weg) return;
    // Die Lagerkupplung gehoert zu der Kupplung, die sie traegt -- faellt die,
    // faellt auch die Klemme.
    if (weg.bearingOn) this.fittings.delete(weg.bearingOn);
    for (const t of [...this.tubes.values()]) {
      if (t.a === id || t.b === id) this.tubes.delete(t.id);
    }
    this.nodes.delete(id);
    this._prunePanels();
    this._pruneClamps();
  }

  degree(nodeId) {
    let d = 0;
    for (const t of this.tubes.values()) {
      if (t.a === nodeId || t.b === nodeId) d++;
    }
    return d;
  }

  neighbors(nodeId) {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.a === nodeId) out.push(this.nodes.get(t.b));
      else if (t.b === nodeId) out.push(this.nodes.get(t.a));
    }
    return out;
  }

  /** 删掉这个接头时会一起走的真管子（不含 C45 臂 / 双管连杆）。 */
  incidentTubeIds(nodeId) {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link) continue;
      if (t.a === nodeId || t.b === nodeId) out.push(t.id);
    }
    return out;
  }

  // --- Rohre --------------------------------------------------------------
  tubeBetween(aId, bId) {
    for (const t of this.tubes.values()) {
      if ((t.a === aId && t.b === bId) || (t.a === bId && t.b === aId)) return t;
    }
    return null;
  }

  addTube(aId, bId, tubeId, color, length, reinforced = false) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null; // schon vorhanden
    const tube = { id: this._id("t"), a: aId, b: bId, tubeId, color, length, reinforced: !!reinforced };
    this.tubes.set(tube.id, tube);
    return tube;
  }

  // C45-Adapter-Arm (kurze Huelse Eck-Kupplung <-> Adapter-Koerper). Kein Rohr:
  // zaehlt nicht in der Stueckliste und wird als Adapter-Huelse gezeichnet.
  addArm(aId, bId) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null;
    const arm = { id: this._id("m"), a: aId, b: bId, arm: true, tubeId: null, color: "blue", length: null, reinforced: false };
    this.tubes.set(arm.id, arm);
    return arm;
  }

  // Doppelrohr-Verbindung (kein Rohr): haelt zwei parallele Tubes als Paar
  // zusammen. Zaehlt nicht in der Stueckliste, wird als "8"-Klemme gezeichnet.
  addLink(aId, bId) {
    if (aId === bId) return null;
    if (this.tubeBetween(aId, bId)) return null;
    const link = { id: this._id("l"), a: aId, b: bId, link: true, tubeId: null, color: "blue", length: null, reinforced: false };
    this.tubes.set(link.id, link);
    return link;
  }

  // --- Verstaerkung (Holz-Profil 80 cm) -------------------------------------
  // Zu kaufen gibt es nur EINE Laenge: 80 cm. Sie deckt genau 80 cm Knoten-
  // abstand -- also ein 75er-Rohr (75 + 2 x halbe Kupplung) oder zwei 35er in
  // einer Linie (40 + 40). Aus Herstellerdateien kommen auch andere Rohre
  // verstaerkt herein; die bleiben, wie sie sind, lassen sich hier aber nicht
  // neu setzen.
  static REINFORCE_SPAN = 80;

  /** Knotenabstand eines Rohrs (Rohrlaenge + eine ganze Kupplung). */
  tubeSpan(t) {
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  _tubeDir(t) {
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / L, d[1] / L, d[2] / L];
  }

  /** Traegt dieses Rohr allein ein ganzes Profil (75er)? */
  takesReinforcementAlone(t) {
    return !!t && !t.arm && !t.link && !t.bow
      && Math.abs(this.tubeSpan(t) - BuildModel.REINFORCE_SPAN) < 1;
  }

  /** Braucht dieses Rohr einen Partner (35er)? */
  takesReinforcementPaired(t) {
    return !!t && !t.arm && !t.link && !t.bow
      && Math.abs(this.tubeSpan(t) - BuildModel.REINFORCE_SPAN / 2) < 1;
  }

  /**
   * Welche Rohre koennen zusammen mit `id` EIN Profil aufnehmen? Sie stossen an
   * einem gemeinsamen Knoten an, laufen in derselben Geraden weiter und sind
   * selbst noch unverstaerkt.
   */
  reinforcePartners(id) {
    const t = this.tubes.get(id);
    if (!this.takesReinforcementPaired(t) || t.reinforced) return [];
    const d1 = this._tubeDir(t);
    if (!d1) return [];
    const out = [];
    for (const o of this.tubes.values()) {
      if (o.id === t.id || o.reinforced) continue;
      if (!this.takesReinforcementPaired(o)) continue;
      // Gemeinsame Kupplung?
      if (o.a !== t.a && o.a !== t.b && o.b !== t.a && o.b !== t.b) continue;
      const d2 = this._tubeDir(o);
      if (!d2) continue;
      if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) < 0.999) continue;
      out.push(o);
    }
    return out;
  }

  /** Profil einschieben. `ids` ist ein 75er oder zwei 35er in einer Linie. */
  addReinforcement(ids) {
    const list = ids.map((id) => this.tubes.get(id)).filter(Boolean);
    if (!list.length) return false;
    for (const t of list) t.reinforced = true;
    return true;
  }

  /**
   * Profil an diesem Rohr herausziehen. Bei einem 35er geht der Partner mit --
   * ein halbes Profil gibt es nicht. Liefert die betroffenen Rohr-IDs.
   */
  removeReinforcement(id) {
    const t = this.tubes.get(id);
    if (!t || !t.reinforced) return [];
    const raus = [t];
    if (this.takesReinforcementPaired(t)) {
      const d1 = this._tubeDir(t);
      for (const o of this.tubes.values()) {
        if (o.id === t.id || !o.reinforced) continue;
        if (!this.takesReinforcementPaired(o)) continue;
        if (o.a !== t.a && o.a !== t.b && o.b !== t.a && o.b !== t.b) continue;
        const d2 = this._tubeDir(o);
        if (!d2 || !d1) continue;
        if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) < 0.999) continue;
        raus.push(o);
        break;   // ein Profil deckt genau zwei 35er
      }
    }
    for (const x of raus) x.reinforced = false;
    return raus.map((x) => x.id);
  }

  // Prueft, ob ein neues Rohr von p nach q ein bestehendes Rohr ueberdeckt:
  // entweder kollineare Ueberlappung (Laenge > 0) oder eine Kreuzung/ein T-Stoss,
  // dessen Treffpunkt im Inneren mindestens eines Rohres liegt (z. B. 35er quer
  // ueber ein 75er). Beruehren an einer gemeinsamen Kupplung zaehlt nicht.
  // Liefert das kollidierende Rohr oder null.
  tubeCollision(p, q) {
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (segmentsOverlap(p, q, a, b)) return t;
      if (segmentsCross(p, q, a, b)) return t;
    }
    return null;
  }

  removeTube(id) {
    this.tubes.delete(id);
    this._prunePanels();
    this._pruneClamps();
    this._pruneOrphanedC45Bodies();
  }

  /**
   * Kupplungen, an denen nach dem Loeschen NICHTS mehr haengt, mit entfernen.
   *
   * Gemeint sind nur die Nachbarn des Geloeschten (`ids`) -- eine frisch
   * gesetzte, noch leere Kupplung soll ja stehen bleiben. Behalten wird
   * ausserdem, was ein Teil traegt: Klemm-Kupplungen, Kupplungen mit einem
   * Anbauteil darauf und solche, die aus einer Datei stammen.
   */
  removeEmptyNodes(ids) {
    let weg = 0;
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (!n || n.part) continue;
      let belegt = false;
      for (const t of this.tubes.values()) if (t.a === id || t.b === id) { belegt = true; break; }
      if (belegt) continue;
      for (const p of this.panels.values()) {
        for (const tid of [p.a, p.b]) {
          const t = this.tubes.get(tid);
          if (t && (t.a === id || t.b === id)) { belegt = true; break; }
        }
        if (belegt) break;
      }
      if (belegt) continue;
      // Sitzt ein Anbauteil, eine Rutsche oder eine Klemme daran, bleibt die
      // Kupplung: sonst haengt das Teil in der Luft.
      const nah = (o) => Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z) < 3;
      for (const f of this.fittings.values()) if (nah(f)) { belegt = true; break; }
      if (!belegt) for (const c of this.clamps.values()) if (nah(c)) { belegt = true; break; }
      if (!belegt) for (const sl of this.slides.values()) if (nah(sl)) { belegt = true; break; }
      if (belegt) continue;
      this.nodes.delete(id);
      weg++;
    }
    return weg;
  }

  /** Kupplungen, die an diesen Teilen haengen -- Kandidaten fuers Aufraeumen. */
  neighborNodeIds(ids) {
    const out = new Set();
    for (const id of ids) {
      const t = this.tubes.get(id);
      if (t) { out.add(t.a); out.add(t.b); continue; }
      const n = this.nodes.get(id);
      if (!n) continue;
      for (const tb of this.tubes.values()) {
        if (tb.a === id) out.add(tb.b);
        else if (tb.b === id) out.add(tb.a);
      }
    }
    return out;
  }

  // Verwaiste c45body-Knoten entfernen: Adapter-Koerper ohne Diagonalrohr
  // (nur noch per Arm-Kante mit der Eck-Kupplung verbunden) werden geloescht.
  _pruneOrphanedC45Bodies() {
    for (const n of [...this.nodes.values()]) {
      if (!n.c45body) continue;
      let hasNonArmTube = false;
      for (const t of this.tubes.values()) {
        if ((t.a === n.id || t.b === n.id) && !t.arm && !t.link) { hasNonArmTube = true; break; }
      }
      if (!hasNonArmTube) {
        for (const t of [...this.tubes.values()]) {
          if (t.a === n.id || t.b === n.id) this.tubes.delete(t.id);
        }
        this.nodes.delete(n.id);
      }
    }
  }

  // --- Platten -----------------------------------------------------------
  //
  // Eine Platte haengt an ZWEI parallelen Rohren -- so wie man sie wirklich
  // einclipst und wie die Herstellersoftware es fuehrt. Gespeichert werden die
  // beiden Tragrohre, der Versatz entlang (t0) und die Laenge in Rohrrichtung
  // (len). Daraus ergeben sich die vier Ecken; sie muessen NICHT auf Kupplungen
  // liegen -- eine 40er-Platte darf mitten auf zwei 75ern sitzen.

  /** Achse eines Rohrs: Startpunkt, Einheitsrichtung, Laenge. Null bei Bogen. */
  _rail(tubeId) {
    const t = this.tubes.get(tubeId);
    if (!t || t.arm || t.link || t.bow) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return null;
    return { p0: [a.x, a.y, a.z], dir: [d[0] / len, d[1] / len, d[2] / len], len };
  }

  /**
   * Die vier Eckpunkte einer Platte (oder eines Netzes) in Weltkoordinaten,
   * umlaufend. Liefert null, wenn eines der Tragrohre fehlt.
   */
  panelCorners(p) {
    const ra = this._rail(p.a), rb = this._rail(p.b);
    if (!ra || !rb) return null;
    const d = ra.dir;
    // Versatz quer: der Anteil von rb.p0 - ra.p0, der senkrecht auf der Achse steht.
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = off[0] * d[0] + off[1] * d[1] + off[2] * d[2];
    const perp = [off[0] - d[0] * along, off[1] - d[1] * along, off[2] - d[2] * along];
    const at = (s) => [ra.p0[0] + d[0] * s, ra.p0[1] + d[1] * s, ra.p0[2] + d[2] * s];
    const c0 = at(p.t0), c1 = at(p.t0 + p.len);
    const add = (q) => [q[0] + perp[0], q[1] + perp[1], q[2] + perp[2]];
    return [c0, c1, add(c1), add(c0)];
  }

  /**
   * Platte um 90 Grad drehen. Sie hat zwei LIPPEN mit je zwei Schrauben; die
   * Drehung entscheidet, an welchem Rohrpaar sie verschraubt wird -- laengs der
   * Tragrohre (Vorgabe) oder quer dazu. Geometrisch deckt sie dasselbe Feld,
   * nur die Schrauben wandern (siehe computeScrews in bom.js).
   */
  turnPanel(id) {
    const p = this.panels.get(id);
    if (!p) return false;
    p.turned = !p.turned;
    // Eine eingelesene Platte behaelt ihre Lage aus der Datei -- die Drehung um
    // die Normale gehoert dann mitgedreht, sonst schriebe der Export weiter die
    // alte Rolllage und die Drehung waere beim naechsten Laden verloren. Mit den
    // Achsen wandern die beiden Kantenmasse.
    const g = p.geom;
    if (g && g.quat && g.quat.length === 4) {
      const ex = xAxisOf(g.quat), ey = yAxisOf(g.quat), ez = zAxisOf(g.quat);
      g.quat = quatFromBasis(ey, [-ex[0], -ex[1], -ex[2]], ez).map(round4);
      const w = g.w; g.w = g.h; g.h = w;
      const pw = g.padW; g.padW = g.padH; g.padH = pw;
    }
    return true;
  }

  /**
   * Liegt diese eingelesene Platte gedreht? Verglichen wird ihre lokale X-Achse
   * mit der Richtung der Tragrohre: laeuft sie quer dazu, sind die Lippen quer.
   */
  _panelTurnedFromQuat(p) {
    if (!p.geom || !p.geom.quat) return false;
    const ecken = this.panelCorners(p);
    if (!ecken) return false;
    const e1 = norm3([ecken[1][0] - ecken[0][0], ecken[1][1] - ecken[0][1], ecken[1][2] - ecken[0][2]]);
    const ax = norm3(xAxisOf(p.geom.quat));
    return Math.abs(dot3(ax, e1)) < 0.5;
  }

  /** Abstand der beiden Tragrohre (Breite der Platte). */
  panelGap(p) {
    const c = this.panelCorners(p);
    if (!c) return 0;
    return Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]);
  }

  /** Liegt auf diesen beiden Rohren im Bereich [t0, t0+len] schon eine Platte? */
  /**
   * Ueberdecken sich zwei Plattenflaechen? Geprueft wird auf DERSELBEN Ebene:
   * gleiche Ausrichtung, dicht beieinander (die beiden Seiten desselben
   * Rohrpaars liegen nur gut 3 cm auseinander) und ueberlappende Flaeche.
   *
   * Die Flaechenpruefung laeuft ueber Trennachsen -- die beiden Platten koennen
   * an ganz verschiedenen Rohren haengen und trotzdem dasselbe Feld belegen
   * (Nord/Sued gegen Ost/West).
   */
  _panelsOverlap(ca, cb) {
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const centre = (c) => [0, 1, 2].map((i) => (c[0][i] + c[1][i] + c[2][i] + c[3][i]) / 4);

    const ua = unit3(sub(ca[1], ca[0])), va = unit3(sub(ca[3], ca[0]));
    const ub = unit3(sub(cb[1], cb[0])), vb = unit3(sub(cb[3], cb[0]));
    const na = unit3(cross3(ua, va)), nb = unit3(cross3(ub, vb));
    if (Math.abs(dot3(na, nb)) < 0.99) return false;              // andere Ausrichtung
    const d = sub(centre(cb), centre(ca));
    if (Math.abs(dot3(d, na)) > PANEL_PLANE_EPS) return false;    // andere Ebene
    // Trennachsen-Test in der gemeinsamen Ebene.
    for (const axis of [ua, va, ub, vb]) {
      const proj = (c) => c.map((q) => dot3(q, axis));
      const pa = proj(ca), pb = proj(cb);
      const loA = Math.min(...pa), hiA = Math.max(...pa);
      const loB = Math.min(...pb), hiB = Math.max(...pb);
      if (Math.min(hiA, hiB) - Math.max(loA, loB) <= PANEL_OVERLAP_EPS) return false;
    }
    return true;
  }

  /**
   * Liegt an dieser Stelle schon eine Platte (oder ein Netz)? Geprueft werden
   * beide Sammlungen -- gestapelt wird nichts.
   */
  panelAt(aId, bId, t0, len) {
    const probe = this.panelCorners({ a: aId, b: bId, t0, len });
    if (!probe) return null;
    for (const map of [this.panels, this.textiles]) {
      for (const p of map.values()) {
        const c = this.panelCorners(p);
        if (c && this._panelsOverlap(c, probe)) return p;
      }
    }
    return null;
  }

  /**
   * Welche Rohre koennen mit `railId` zusammen eine Platte tragen?
   *
   * Voraussetzung: parallel, im Abstand einer Plattenkante, und die beiden
   * Rohre ueberdecken sich laengs weit genug fuer die andere Kante. Geliefert
   * wird je Kandidat der Ueberdeckungsbereich in der Achse des ERSTEN Rohrs --
   * daraus ergeben sich die moeglichen Abschnitte.
   */
  panelPartners(railId, dims, tol = 1.5) {
    const ra = this._rail(railId);
    if (!ra) return [];
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.id === railId) continue;
      const rb = this._rail(t.id);
      if (!rb) continue;
      const dot = rb.dir[0] * ra.dir[0] + rb.dir[1] * ra.dir[1] + rb.dir[2] * ra.dir[2];
      if (Math.abs(dot) < 0.999) continue;                    // nicht parallel
      const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
      const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
      const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
      const gap = Math.hypot(perp[0], perp[1], perp[2]);
      if (gap < 1) continue;                                  // dasselbe Rohr, doppelt
      // Welche Plattenkante passt auf den Abstand? Die andere laeuft laengs.
      let len = null;
      for (let i = 0; i < dims.length; i++) {
        if (Math.abs(dims[i] - gap) <= tol) { len = dims[1 - i] ?? dims[i]; break; }
      }
      if (len == null) continue;
      // Ueberdeckung in der Achse des ersten Rohrs
      const e = along + rb.len * dot;
      const lo = Math.max(0, Math.min(along, e));
      const hi = Math.min(ra.len, Math.max(along, e));
      if (hi - lo < len - tol) continue;
      out.push({ id: t.id, gap: round(gap), len: round(len), lo: round(lo), hi: round(hi) });
    }
    return out;
  }

  /**
   * Abschnitt waehlen: An welcher Stelle liegt die Platte, wenn man das erste
   * Rohr bei `at` angeklickt hat? Das Raster ist die Plattenlaenge selbst.
   */
  panelSection(partner, at) {
    const count = Math.max(1, Math.floor((partner.hi - partner.lo + 0.5) / partner.len));
    const k = Math.max(0, Math.min(count - 1, Math.floor((at - partner.lo) / partner.len)));
    return { t0: round(partner.lo + k * partner.len), len: partner.len, index: k, count };
  }

  /**
   * Platte auf zwei parallele Rohre setzen.
   * side: +1 = liegt oben auf den Rohren (bzw. aussen), -1 = haengt darunter.
   */
  addPanel(aId, bId, t0, len, panelId, color, side = 1) {
    if (!this._rail(aId) || !this._rail(bId)) return null;
    if (this.panelAt(aId, bId, t0, len)) return null;
    const panel = {
      id: this._id("p"), a: aId, b: bId, t0: round(t0), len: round(len),
      panelId, color, side: side < 0 ? -1 : 1,
    };
    this.panels.set(panel.id, panel);
    return panel;
  }

  /** Platte auf die andere Seite der Rohre legen. Liefert die neue Seite. */
  flipPanelSide(id) {
    const p = this.panels.get(id) || this.textiles.get(id);
    if (!p) return null;
    p.side = (p.side || 1) < 0 ? 1 : -1;
    // Die eigene Lage aus der Datei kennt die alte Seite -- ab jetzt rechnet
    // sich die Platte wieder aus ihrem Rohrpaar.
    delete p.geom;
    return p.side;
  }

  removePanel(id) {
    this.panels.delete(id);
  }

  removeTextile(id) {
    this.textiles.delete(id);
  }

  removeSlide(id) {
    this.slides.delete(id);
  }

  // --- Anbauteile ---------------------------------------------------------
  /**
   * Anbauteil setzen. `kind` ist die QDF-Elementart (z. B. "multi-wheel2"),
   * damit Import, Darstellung und Export dieselbe Sprache sprechen.
   * quat in Three-Reihenfolge (x,y,z,w); w/h nur bei Flaechenteilen (Netz).
   */
  addFitting(kind, x, y, z, opts = {}) {
    const f = {
      id: this._id("f"), kind,
      x: round(x), y: round(y), z: round(z),
      quat: opts.quat || null,
      color: opts.color || null,
    };
    if (opts.w != null) f.w = round(opts.w);
    if (opts.h != null) f.h = round(opts.h);
    // Tiefe -- bisher nur das Baellebad: sein Becken reicht `d` weit in die
    // lokale Z-Richtung, das Vorzeichen sagt, nach welcher Seite.
    if (opts.d != null) f.d = round(opts.d);
    if (opts.mask != null) f.mask = opts.mask;
    this.fittings.set(f.id, f);
    return f;
  }

  removeFitting(id) {
    // Die Kupplung, die eine Lagerkupplung trug, steht danach frei -- ihr
    // Verweis muss weg, sonst zeichnet die Szene weiter einen Stutzen ins Leere.
    for (const n of this.nodes.values()) if (n.bearingOn === id) { n.bearingOn = null; n.stub = null; }
    this.fittings.delete(id);
  }

  /**
   * Anbauteil weiterdrehen: es springt auf die naechste freie Achsrichtung
   * seiner Kupplung -- so wie ein Bogenrohr per Klick weiterrueckt. Teile ohne
   * Wahlmoeglichkeit (Radarretierung in der Nabe, Flaechenteile, Teile auf einem
   * Rohr) bleiben, wo sie sind.
   */
  rotateFitting(id) {
    const step = this._nextFittingMount(id);
    if (!step) return false;
    const { f, mount } = step;
    const quat = quatFromXAxis(mount.dir);
    // Die Laufrolle sitzt auf ihrem Adapter -- sie dreht mit.
    const rider = f.kind === "adapter2" || f.kind === "casters2"
      ? [...this.fittings.values()].find((o) => o.id !== f.id
          && (o.kind === "casters2" || o.kind === "adapter2")
          && Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z) < 2)
      : null;
    for (const part of [f, rider]) {
      if (!part) continue;
      part.x = round(mount.pos[0]); part.y = round(mount.pos[1]); part.z = round(mount.pos[2]);
      part.quat = quat.slice();
    }
    return true;
  }

  /** Laesst sich dieses Anbauteil weiterdrehen? (fuer Zeiger und Meldung) */
  canRotateFitting(id) {
    return !!this._nextFittingMount(id);
  }

  // Naechste freie Stelle desselben Teils an derselben Kupplung -- oder null.
  _nextFittingMount(id) {
    const f = this.fittings.get(id);
    if (!f || !ROTATABLE_FITTINGS.has(f.kind)) return null;
    let anchor = null, nd = 16;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z);
      if (d < nd) { nd = d; anchor = n; }
    }
    if (!anchor) return null;
    const mounts = this.fittingMounts(f.kind).filter((m) => m.nodeId === anchor.id);
    if (mounts.length < 2) return null;
    // Teile, die GENAU auf der Kupplung sitzen (Radlager, Arretierung), haben an
    // jeder Stelle dieselbe Position -- unterscheiden lassen sie sich nur an
    // ihrer Achse. Deshalb zaehlt Ort UND Richtung.
    const axis = f.quat ? xAxisOf(f.quat) : [1, 0, 0];
    const gleich = (m, x, y, z, ax) =>
      Math.hypot(m.pos[0] - x, m.pos[1] - y, m.pos[2] - z) < 2
      && dot3(m.dir, ax) > 0.9;
    let cur = mounts.findIndex((m) => gleich(m, f.x, f.y, f.z, axis));
    if (cur < 0) cur = 0;
    for (let k = 1; k <= mounts.length; k++) {
      const m = mounts[(cur + k) % mounts.length];
      if (gleich(m, f.x, f.y, f.z, axis)) continue;
      let taken = false;
      for (const o of this.fittings.values()) {
        if (o.id === f.id || o.kind !== f.kind) continue;
        if (gleich(m, o.x, o.y, o.z, o.quat ? xAxisOf(o.quat) : [1, 0, 0])) { taken = true; break; }
      }
      if (!taken) return { f, mount: m };
    }
    return null;
  }

  /**
   * Klemm-Kupplung weiterdrehen: der offene Anschluss rueckt um 90 Grad um das
   * umschlossene Rohr weiter, alles daran Steckende dreht mit.
   */
  rotateTubeClamp(nodeId, cs = 5) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.clampOn || !node.stub) return false;
    const t = this.tubes.get(node.clampOn.tubeId);
    const a = t && this.nodes.get(t.a), b = t && this.nodes.get(t.b);
    if (!a || !b) return false;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const off = nodeClampOffset(node, cs);
    const axis = [node.x - node.stub[0] * off, node.y - node.stub[1] * off, node.z - node.stub[2] * off];
    // 45 Grad um die Rohrachse (Rodrigues). Acht Stellungen -- die Kupplungen
    // sitzen am Rohr, sie muessen sich nicht ins Achsraster fuegen.
    const co = Math.SQRT1_2, si = Math.SQRT1_2;
    const turn = (p) => {
      const r = [p[0] - axis[0], p[1] - axis[1], p[2] - axis[2]];
      const c = cross3(u, r);
      const d = dot3(u, r) * (1 - co);
      return [
        axis[0] + r[0] * co + c[0] * si + u[0] * d,
        axis[1] + r[1] * co + c[1] * si + u[1] * d,
        axis[2] + r[2] * co + c[2] * si + u[2] * d,
      ];
    };
    const branch = this._branchFrom(nodeId).map((n) => ({ n, p: turn([n.x, n.y, n.z]) }));
    if (branch.some((e) => this.isBelowGround(e.p[1]))) return false;
    for (const e of branch) { e.n.x = round(e.p[0]); e.n.y = round(e.p[1]); e.n.z = round(e.p[2]); }
    const gedreht = new Set(branch.map((e) => e.n.id));
    this._moveTubeGeom(gedreht);
    this._movePanelGeom(gedreht);
    const st = node.stub;
    const c = cross3(u, st), d = dot3(u, st) * (1 - co);
    const ns = [st[0] * co + c[0] * si + u[0] * d, st[1] * co + c[1] * si + u[1] * d, st[2] * co + c[2] * si + u[2] * d];
    // Die Richtung feiner runden als Koordinaten: bei 45-Grad-Schritten summiert
    // sich der Rundungsfehler sonst ueber mehrere Drehungen sichtbar auf.
    const L2 = Math.hypot(ns[0], ns[1], ns[2]) || 1;
    const r4 = (v) => Math.round((v / L2) * 1e4) / 1e4;
    node.stub = [r4(ns[0]), r4(ns[1]), r4(ns[2])];
    // Die Lagerkupplung sitzt auf der Rohrachse und bleibt liegen -- nur ihr
    // Maul dreht mit, es zeigt weiter von der getragenen Kupplung weg.
    if (node.bearingOn) {
      const f = this.fittings.get(node.bearingOn);
      if (f) {
        f.quat = bearingQuat([-node.stub[0], -node.stub[1], -node.stub[2]], u);
        node.quat = f.quat.slice();
      }
    }
    return true;
  }

  /**
   * Montagestellen eines Anbauteils. Die Regeln sind an den Herstellerdateien
   * gemessen (FITTING_MOUNTS): die einen sitzen an einer Kupplung und zeigen in
   * eine freie Achsrichtung, die anderen stecken auf einem Rohr.
   * Liefert je Stelle { pos:[x,y,z], dir:[x,y,z], nodeId?, tubeId? }.
   */
  fittingMounts(kind, cs = 5) {
    if (kind === "multi-wheel2") return this._wheelMounts();
    if (kind === "hub-cap2" || kind === "tube-cap2") return this._wheelCapMounts();
    if (kind === "textil-round2") return this._roundCoverMounts();
    const spec = FITTING_MOUNTS[kind];
    if (!spec) return [];
    return spec.at === "tube" ? this._fittingTubeMounts(spec) : this._fittingNodeMounts(spec, cs, kind);
  }

  /**
   * Montagestelle eines Rohr-Teils aus dem Trefferpunkt: entweder genau dort
   * (Raeder) oder am naeheren Rohrende (Nabenkappe).
   */
  tubeFittingMount(tubeId, point, kind, cs = 5) {
    const where = TUBE_FITTINGS[kind];
    if (!where) return null;
    if (where === "end") return this.tubeEndMount(tubeId, point, true);
    const t = this.tubes.get(tubeId);
    if (t && (t.bow || t.arm || t.link)) return null;   // Raeder nur auf geraden Rohren
    const a = t && this.nodes.get(t.a), b = t && this.nodes.get(t.b);
    if (!a || !b) return null;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    // Das Teil muss GANZ auf dem SICHTBAREN Rohr sitzen. Das Rohr steckt an
    // beiden Enden eine halbe Kupplungslaenge in der Kupplung -- so weit reicht
    // es also nicht, wie der Abstand der Knoten vermuten laesst.
    const half = (FITTING_WIDTH[kind] || 0) / 2;
    const rand = half + cs / 2;
    if (L < 2 * rand) return null;
    const rel = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
    const raw = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
    const s = Math.max(rand, Math.min(L - rand, raw));
    const pos = [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
    // Stoesst es an ein anderes Teil auf demselben Rohr?
    if (this._fittingBlocked(kind, pos, u, half)) return null;
    return { pos, dir: u, tubeId };
  }

  /**
   * Vorschlagsstellen fuer ein Rohr-Teil: je Rohr eine, in der Mitte des Platzes,
   * der uebrig bleibt. Gesetzt werden kann trotzdem ueberall auf dem Rohr -- die
   * Punkte zeigen nur, welche Rohre in Frage kommen.
   */
  tubeFittingSpots(kind, cs = 5) {
    if (!TUBE_FITTINGS[kind]) return [];
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
      const m = this.tubeFittingMount(t.id, mid, kind, cs);
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * Liegt auf derselben Achse schon ein Teil so nah, dass sich beide
   * ueberschneiden wuerden? Verglichen wird der Abstand entlang der Achse mit
   * den halben Breiten; quer dazu zaehlt nur, was ueberhaupt in der Naehe liegt.
   */
  _fittingBlocked(kind, pos, axis, half) {
    // Geprueft wird Rad gegen Rad. Kappen, Arretierungen und Lager gehoeren zu
    // ihrem Rad und duerfen es beruehren -- sie halten es ja fest.
    if (!WHEEL_KINDS.has(kind)) return false;
    for (const f of this.fittings.values()) {
      if (!WHEEL_KINDS.has(f.kind)) continue;
      const w = (FITTING_WIDTH[f.kind] || 0) / 2;
      if (!w) continue;
      const d = [f.x - pos[0], f.y - pos[1], f.z - pos[2]];
      const along = Math.abs(dot3(d, axis));
      const quer = Math.hypot(d[0], d[1], d[2]) ** 2 - along ** 2;
      if (Math.sqrt(Math.max(0, quer)) > 8) continue;      // sitzt woanders
      if (along < half + w - 0.2) return true;
    }
    return false;
  }

  /**
   * Lagerkupplung auf ein Rohrende schieben: sie umschliesst das ENDE des
   * angeklickten Rohrs. Genommen wird das naehere der beiden Enden, die Achse
   * zeigt vom Rohr weg.
   */
  tubeEndMount(tubeId, point, freeOnly = false) {
    const t = this.tubes.get(tubeId);
    if (!t) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const da = Math.hypot(point[0] - a.x, point[1] - a.y, point[2] - a.z);
    const db = Math.hypot(point[0] - b.x, point[1] - b.y, point[2] - b.z);
    const end = da <= db ? a : b, other = da <= db ? b : a;
    // Die Radkappe verschliesst ein Rohrende -- an einer Kupplung mit weiteren
    // Rohren gibt es nichts zu verschliessen.
    if (freeOnly && this.degree(end.id) !== 1) return null;
    const d = [end.x - other.x, end.y - other.y, end.z - other.z];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return { pos: [end.x, end.y, end.z], dir: [d[0] / L, d[1] / L, d[2] / L], nodeId: end.id };
  }

  /**
   * Multirad: sitzt auf dem AEUSSEREN Ende eines Radlagers -- das ist ein 5 cm
   * langes Rohrstueck an einer Kupplung. Gemessen in Basic II_Auto: Radlager auf
   * der Kupplung mit Laengenfeld 50 mm, das Rad 50 mm weiter aussen auf
   * derselben Achse.
   */
  _wheelMounts() {
    const out = [];
    for (const f of this.fittings.values()) {
      if (f.kind !== "bearing2" || !f.quat) continue;
      const ax = rotateX(f.quat);
      out.push({ pos: [round(f.x + ax[0] * BEARING_LEN), round(f.y + ax[1] * BEARING_LEN),
        round(f.z + ax[2] * BEARING_LEN)], dir: ax, quat: f.quat.slice() });
    }
    return out;
  }

  /**
   * Radkappe: sitzt auf einer EINARMIGEN Kupplung, also am Ende eines Rohrs --
   * und ersetzt sie dort. Sinn ergibt das mit einem Schwimmrad auf demselben
   * Rohr, gesetzt wird sie aber an der Kupplung.
   */
  _wheelCapMounts() {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.c45body || n.part) continue;
      const arms = [];
      // Eine Winkelkupplung haengt ueber eine Arm-Kante am Knoten, ein
      // Doppelrohrverbinder ueber eine Link-Kante. Beide zaehlen nicht als Rohr,
      // besetzen den Knoten aber trotzdem: eine Kappe kommt dorthin nicht mehr.
      let besetzt = !!n.c45 || !!n.bearingOn;
      for (const t of this.tubes.values()) {
        const dran = t.a === n.id || t.b === n.id;
        if (t.arm || t.link) { if (dran) besetzt = true; continue; }
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (other) arms.push(other);
      }
      if (besetzt) continue;
      if (arms.length !== 1) continue;                 // nur freie Rohrenden
      if (this.hasEndPiece(n)) continue;               // dort steckt schon eine Kappe
      const o = arms[0];
      const d = [n.x - o.x, n.y - o.y, n.z - o.z];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      const dir = [d[0] / L, d[1] / L, d[2] / L];
      // Der Punkt selbst liegt mitten im Kupplungswuerfel -- dort waere der
      // gruene Ankerpunkt verdeckt und nicht anklickbar. Der Griff steht
      // deshalb ein Stueck weiter aussen, genau wie bei _fittingNodeMounts.
      out.push({ pos: [n.x, n.y, n.z], dir, nodeId: n.id,
        handle: [n.x + dir[0] * 7, n.y + dir[1] * 7, n.z + dir[2] * 7] });
    }
    return out;
  }

  /**
   * Steckt auf diesem Knoten eine Kappe, die die Kupplung ersetzt? Radkappe und
   * Rohrkappe stecken beide ueber dem Rohrende -- an einem Ende mit nur einem
   * Rohr sitzt dann keine Kupplung mehr, auch keine einarmige. Hat der Knoten
   * mehrere Arme, bleibt die Kupplung: dort schliesst die Kappe nur einen
   * freien Stutzen ab.
   *
   * (Die Herstellerdateien fuehren an der Stelle einer Rohrkappe zusaetzlich
   * eine `connector3` -- Spieltisch: beide auf -800/-50/-800. Wir zeichnen und
   * zaehlen dort trotzdem nur die Kappe: sie steckt auf dem Rohr, eine
   * einarmige Kupplung braucht es dafuer nicht.)
   */
  hasWheelCap(node) {
    if (!this._fittingAt(node, "hub-cap2") && !this._fittingAt(node, "tube-cap2")) return false;
    return this.degree(node.id) <= 1;
  }

  /**
   * Steckt an diesem Knoten ein Abschluss? Radkappe und Rohrkappe schliessen
   * ein Rohrende ab -- es zaehlt dann nicht mehr als offenes Ende.
   */
  hasEndPiece(node) {
    return this._fittingAt(node, "hub-cap2") || this._fittingAt(node, "tube-cap2");
  }

  _fittingAt(node, kind) {
    for (const f of this.fittings.values()) {
      if (f.kind !== kind) continue;
      if (Math.hypot(f.x - node.x, f.y - node.y, f.z - node.z) < 3) return true;
    }
    return false;
  }

  /**
   * Rundabdeckung: braucht ZWEI gleich liegende Bogenrohre im Abstand von 80 cm
   * -- das Tuch spannt sich ueber den Tonnenbogen dazwischen. Der Ankerpunkt ist
   * die Ecke gegenueber dem Kruemmungsmittelpunkt, die lokale +Z-Achse zeigt zum
   * zweiten Bogen (so steht es in den Dateien des Herstellers).
   */
  _roundCoverMounts() {
    const bows = [];
    for (const t of this.tubes.values()) {
      if (!t.bow || !t.bowCenter) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const C = t.bowCenter;
      // Ecke gegenueber dem Mittelpunkt: dort sitzt der Bezugspunkt des Tuchs.
      bows.push({
        O: [a.x + b.x - C[0], a.y + b.y - C[1], a.z + b.z - C[2]],
        u: norm3([a.x - (a.x + b.x - C[0]), a.y - (a.y + b.y - C[1]), a.z - (a.z + b.z - C[2])]),
        v: norm3([b.x - (a.x + b.x - C[0]), b.y - (a.y + b.y - C[1]), b.z - (a.z + b.z - C[2])]),
      });
    }
    const out = [];
    for (const p of bows) {
      for (const s of bows) {
        if (s === p) continue;
        const d = [s.O[0] - p.O[0], s.O[1] - p.O[1], s.O[2] - p.O[2]];
        const dist = Math.hypot(d[0], d[1], d[2]);
        if (Math.abs(dist - ROUND_COVER_SPAN) > 1.5) continue;
        const ez = [d[0] / dist, d[1] / dist, d[2] / dist];
        // Jedes Bogenpaar nur EINMAL anbieten: sonst gaebe es zu jeder Stelle
        // zwei Ankerpunkte (einen je Bogen) und das Tuch liesse sich doppelt
        // setzen. Genommen wird die Richtung mit positiver Hauptkomponente.
        const domi = ez.map(Math.abs).indexOf(Math.max(...ez.map(Math.abs)));
        if (ez[domi] < 0) continue;
        // Nur wenn der zweite Bogen wirklich daneben liegt (gleiche Schenkel).
        if (Math.abs(dot3(p.u, ez)) > 0.02 || Math.abs(dot3(p.v, ez)) > 0.02) continue;
        // Lokales +Y und -X sind die beiden Schenkel; welcher welcher ist,
        // entscheidet die Rechtshaendigkeit gegen die Achse zum zweiten Bogen.
        let ey = p.u, ex = [-p.v[0], -p.v[1], -p.v[2]];
        if (dot3(cross3(ex, ey), ez) < 0) { ey = p.v; ex = [-p.u[0], -p.u[1], -p.u[2]]; }
        out.push({ pos: p.O, dir: ex, quat: quatFromBasis(ex, ey, ez) });
      }
    }
    return out;
  }




  // An der Kupplung: jede kardinale Richtung ohne Rohr, nicht unter den Boden.
  // Die Laufrolle haengt immer nach unten, sie kennt nur diese eine Stelle.
  _fittingNodeMounts(spec, cs = 5, kind = null) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.c45body) continue;                       // Adapterkoerper ist keine Kupplung
      // Knoten mit festem Katalogteil (Lochzapfen-, Lagerkupplung, Flexi) sind
      // keine Kupplung mit freien Stutzen -- ein Anbauteil sitzt dort nicht.
      // Die Multirad-Arretierung, die eine Lochzapfenkupplung festhaelt, gehoert
      // auf den Stutzen der TRAGENDEN Kupplung; ihr Punkt kommt von dort. Ohne
      // diese Zeile stand ein zweiter, um eine Kupplungslaenge zu weit aussen.
      if (n.part) continue;
      const taken = new Set();
      for (const t of this.tubes.values()) {
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (!other) continue;
        const d = [other.x - n.x, other.y - n.y, other.z - n.z];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        taken.add(cardinalName([d[0] / L, d[1] / L, d[2] / L]));
      }
      // Auf einem Stutzen mit Lochzapfenkupplung ist kein Platz mehr -- ausser
      // fuer die Multirad-Arretierung, die sie genau dort festhaelt.
      const durchKlemme = spec.onClamp ? [] : holeClampDirsAt(this, n);
      // Eine Multirad-Arretierung schliesst den Stutzen ab: was ueber sie
      // hinausginge, passt dort nicht mehr. Nur das Radlager unter ihr (und das
      // Rad, das ohnehin am Lager haengt) bleibt moeglich.
      const abgeschlossen = STUB_END_ALLOWED.has(kind)
        ? [] : armFittingDirsAt(this, n, STUB_END_FITTINGS);
      for (const dir of (spec.dirs === "down" ? [[0, -1, 0]] : CARDINALS)) {
        if (taken.has(cardinalName(dir))) continue;
        if (durchKlemme.some((k) => dot3(k, dir) > 0.9)) continue;
        if (abgeschlossen.some((k) => dot3(k, dir) > 0.9)) continue;
        const pos = [n.x + dir[0] * spec.offset, n.y + dir[1] * spec.offset, n.z + dir[2] * spec.offset];
        if (this.isBelowGround(pos[1])) continue;
        // Der Ankerpunkt liegt weiter aussen als das Teil selbst: Teile, die
        // direkt auf der Kupplung sitzen (Abstand 0), haetten ihren Punkt sonst
        // mitten im Kupplungswuerfel -- unsichtbar und nicht anklickbar. Der
        // Abstand ist derselbe wie im Bau-Modus (anchorGap): jeder Punkt an
        // einer Kupplung meint dasselbe und soll gleich weit draussen stehen.
        const gap = Math.max(spec.offset, anchorGap(cs));
        out.push({ pos, dir, nodeId: n.id,
          handle: [n.x + dir[0] * gap, n.y + dir[1] * gap, n.z + dir[2] * gap] });
      }
    }
    return out;
  }

  // Auf dem Rohr: fester Abstand ab jedem Rohrende, Achse = Rohrrichtung.
  _fittingTubeMounts(spec) {
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      if (L < spec.offset * 2) continue;
      const u = [d[0] / L, d[1] / L, d[2] / L];
      for (const [from, sign] of [[a, 1], [b, -1]]) {
        const pos = [from.x + u[0] * spec.offset * sign,
          from.y + u[1] * spec.offset * sign,
          from.z + u[2] * spec.offset * sign];
        if (this.isBelowGround(pos[1])) continue;
        out.push({ pos, dir: u, tubeId: t.id });
      }
    }
    return out;
  }

  // --- Klemm-Kupplungen (sitzen auf einem Rohr, nicht im Raster) -----------
  /**
   * Lochzapfenkupplung und Lagerkupplung umschliessen ein Rohr an einer
   * BELIEBIGEN Stelle und bieten quer dazu einen offenen Anschluss. Sie sind
   * deshalb Knoten (dort steckt ein Rohr) mit zwei Zusatzangaben: `clampOn`
   * haelt Rohr und Stelle darauf, `stub` die Richtung des offenen Endes.
   * Der Knoten selbst liegt an der Muendung, eine Kupplungslaenge neben der
   * Rohrachse -- dort faengt das eingesteckte Rohr an.
   *
   * `point` ist der Trefferpunkt des Klicks: er bestimmt die Stelle auf dem
   * Rohr UND (ueber die Seite, auf der er liegt) die Richtung des Anschlusses.
   */
  addTubeClamp(tubeId, point, part, cs = 5) {
    const m = this.tubeClampMount(tubeId, point, part, cs);
    if (!m) return null;
    const node = this.addNode(round(m.pos[0]), round(m.pos[1]), round(m.pos[2]));
    // Die Lagerkupplung ist ein ANBAUTEIL, das um das Rohr klemmt, und die
    // Kupplung, die sie traegt, ein eigener Knoten -- genau so fuehrt die Datei
    // beides (bearing-connector4 am Rohr, connector3 10 cm daneben). Frueher war
    // beides EIN Knoten: der Wuerfel gehoerte dann der Klemme, ein Klick darauf
    // waehlte kein Bauteil, an das sich etwas stecken laesst.
    if (part === "bearing") {
      const f = this.addFitting("bearing-connector4", m.achse[0], m.achse[1], m.achse[2],
        { quat: bearingQuat([-m.stub[0], -m.stub[1], -m.stub[2]], this._tubeDir(this.tubes.get(tubeId))) });
      node.bearingOn = f.id;
      // Die getragene Kupplung steht wie die Klemme -- am schraegen Rohr also
      // schraeg. Ohne das boete sie die Weltachsen an und ein angestecktes Rohr
      // liefe im falschen Winkel weg.
      node.quat = f.quat.slice();
    } else {
      node.part = part;
    }
    node.clampOn = { tubeId, t: m.t };
    node.stub = m.stub;
    return node;
  }

  /**
   * Freie Arme, an die eine Lagerkupplung passt: je Kupplung jede Achsrichtung,
   * in der kein Rohr steckt und die nicht schon belegt ist. Der Punkt liegt
   * dort, wo die Klemme zu liegen kaeme -- eine doppelte Kupplungslaenge weiter.
   */
  bearingArmMounts(cs = 5) {
    const off = cs * 2;
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.part || n.bearingOn || n.unused || n.c45body) continue;
      const belegt = [];
      for (const t of this.tubes.values()) {
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (!other) continue;
        belegt.push(norm3([other.x - n.x, other.y - n.y, other.z - n.z]));
      }
      if (!belegt.length) continue;   // freie Kupplung ohne Rohr: nichts zu tragen
      belegt.push(...holeClampDirsAt(this, n, cs));
      // Sie schiebt sich auf den Stutzen -- ein Anbauteil darin sperrt ihn.
      belegt.push(...armFittingDirsAt(this, n));
      for (const richtung of DIRECTIONS) {
        const d = richtung.vec;
        if (belegt.some((b) => dot3(b, d) > 0.9)) continue;
        const pos = [n.x + d[0] * off, n.y + d[1] * off, n.z + d[2] * off];
        if (this.isBelowGround(pos[1])) continue;
        // `pos` ist die Stelle, an die die Klemme kommt; der gruene Griff steht
        // wie jeder Punkt an einer Kupplung gleich weit vor ihrem Wuerfel.
        const gap = anchorGap(cs);
        out.push({ nodeId: n.id, dir: d, pos,
          handle: [n.x + d[0] * gap, n.y + d[1] * gap, n.z + d[2] * gap] });
      }
    }
    return out;
  }

  /**
   * Noch leere Maeuler von Lagerkupplungen: dort gehoert ein gerades Rohr
   * hinein, so wie in die freie Oeffnung einer Rohrklammer. Der Punkt liegt
   * GENAU auf der Rohrachse -- also im Maul, nicht daneben. `dir` ist die
   * Lochachse (lokales +Y der Klemme).
   */
  bearingOpenings() {
    const out = [];
    for (const n of this.nodes.values()) {
      if (!n.bearingOn || n.clampOn) continue;
      const f = this.fittings.get(n.bearingOn);
      if (!f || !f.quat) continue;
      out.push({ nodeId: n.id, pos: [f.x, f.y, f.z], dir: yAxisOf(f.quat) });
    }
    return out;
  }

  /**
   * Maul einer noch leeren Lagerkupplung um 90 Grad weiterdrehen -- damit laesst
   * sich waehlen, in welcher Richtung das Rohr spaeter durchlaeuft. Steckt schon
   * eines darin, gilt `rotateTubeClamp`.
   */
  turnBearingMouth(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n || !n.bearingOn || n.clampOn) return false;
    const f = this.fittings.get(n.bearingOn);
    if (!f || !f.quat) return false;
    // +Y wandert auf +Z, die Ausrichtung (+X) bleibt.
    f.quat = quatFromBasis(xAxisOf(f.quat), zAxisOf(f.quat),
      cross3(xAxisOf(f.quat), zAxisOf(f.quat)));
    n.quat = f.quat.slice();
    return true;
  }

  /** Rohr im Maul einer Lagerkupplung vermerken. */
  noteBearingTube(nodeId, tubeId, t = 0.5) {
    const n = this.nodes.get(nodeId);
    if (!n || !n.bearingOn) return;
    n.clampOn = { tubeId, t: round(t) };
  }

  /**
   * Lagerkupplung andersherum setzen: erst an eine Kupplung, das Rohr kommt
   * spaeter. `dir` ist der freie Arm, an dem sie haengt -- die Klemme sitzt eine
   * doppelte Kupplungslaenge davor, ihr Maul zeigt vom Knoten weg.
   */
  addBearingAtArm(nodeId, dir, cs = 5) {
    const node = this.nodes.get(nodeId);
    if (!node || node.bearingOn || node.part) return null;
    const u = norm3(dir);
    const off = cs * 2;
    const achse = [node.x + u[0] * off, node.y + u[1] * off, node.z + u[2] * off];
    if (this.isBelowGround(achse[1])) return null;
    // Noch kein Rohr in der Klemme: das Maul zeigt in eine Querrichtung, die
    // ein spaeter eingeklemmtes Rohr haben kann. Genommen wird die waagerechte.
    const f = this.addFitting("bearing-connector4", achse[0], achse[1], achse[2],
      { quat: bearingQuat(u, null) });
    node.bearingOn = f.id;
    node.quat = f.quat.slice();   // die Kupplung steht wie die Klemme
    node.stub = [round(-u[0]), round(-u[1]), round(-u[2])];
    return f;
  }

  /**
   * Ankerpunkte einer Lochzapfenkupplung: jeder freie Stutzen einer Kupplung.
   * Sie steckt mit ihrem Loch darauf, ihr Koerper sitzt deshalb genau eine
   * Kupplungslaenge davor -- so steht es auch in den Herstellerdateien (in 54
   * von 55 Vorkommen liegt die tragende Kupplung 5 cm entlang der lokalen
   * -X-Achse).
   */
  holeArmMounts(cs = 5) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.part || n.bearingOn || n.unused || n.c45body) continue;
      const belegt = [];
      for (const t of this.tubes.values()) {
        const other = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (other) belegt.push(norm3([other.x - n.x, other.y - n.y, other.z - n.z]));
      }
      if (!belegt.length) continue;   // freie Kupplung ohne Rohr: nichts zu tragen
      belegt.push(...holeClampDirsAt(this, n, cs));
      // Ihr Ring greift UEBER den Stutzen -- steckt dort schon ein Anbauteil
      // (Radlager, Adapter, Arretierung, offenes Ende), passt sie nicht mehr.
      belegt.push(...armFittingDirsAt(this, n));
      for (const richtung of DIRECTIONS) {
        const d = richtung.vec;
        if (belegt.some((b) => dot3(b, d) > 0.9)) continue;
        const pos = [round(n.x + d[0] * cs), round(n.y + d[1] * cs), round(n.z + d[2] * cs)];
        if (this.isBelowGround(pos[1])) continue;
        if (this.findNodeNear(pos[0], pos[1], pos[2])) continue;   // dort steht schon etwas
        // `pos` ist die Stelle, an die die Kupplung KOMMT (eine Kupplungslaenge
        // vor dem Traeger); der gruene Griff steht dort, wo alle Punkte an
        // einer Kupplung stehen -- sonst saesse er als einziger enger.
        const gap = anchorGap(cs);
        out.push({ nodeId: n.id, dir: d, pos,
          handle: [round(n.x + d[0] * gap), round(n.y + d[1] * gap), round(n.z + d[2] * gap)] });
      }
    }
    return out;
  }

  /**
   * Lochzapfenkupplung auf einen freien Stutzen setzen. Sie wird ein KNOTEN mit
   * festem Katalogteil -- wie die eingelesene: ihre eigenen Arme tragen dann
   * Rohre wie die Arme einer Kupplung.
   *
   * Die lokale +X-Achse zeigt vom Traeger weg (in seinem Stutzen steckt das
   * Loch), die Arme stehen quer dazu. Ihre Rollage ist frei -- genommen wird
   * die, bei der der erste Arm (lokal -Y) nach unten zeigt; weiterdrehen laesst
   * sie sich mit `turnHoleClamp`.
   */
  addHoleClamp(nodeId, dir, part = "hole_1", cs = 5) {
    const traeger = this.nodes.get(nodeId);
    if (!traeger || traeger.part || !HOLE_MASKS[part]) return null;
    const ex = norm3(dir);
    const pos = [round(traeger.x + ex[0] * cs), round(traeger.y + ex[1] * cs),
      round(traeger.z + ex[2] * cs)];
    if (this.isBelowGround(pos[1]) || this.findNodeNear(pos[0], pos[1], pos[2])) return null;
    // Rollage: lokal +Y moeglichst nach oben, damit der Arm (lokal -Y) nach
    // unten zeigt. Steht die Achse selbst senkrecht, tut es jede Querrichtung.
    const hoch = Math.abs(ex[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const ey = norm3([hoch[0] - ex[0] * dot3(hoch, ex), hoch[1] - ex[1] * dot3(hoch, ex),
      hoch[2] - ex[2] * dot3(hoch, ex)]);
    const node = this.addNode(pos[0], pos[1], pos[2]);
    node.part = part;
    node.partMask = HOLE_MASKS[part];
    node.partQuat = quatFromBasis(ex, ey, cross3(ex, ey)).map(round4);
    // `stub` ist der ERSTE eigene Arm (lokal -Y) -- so fuehrt ihn auch der
    // Import, und daran haengen die aelteren Pfade (Bauhilfen, Export).
    node.stub = holeArmDirs(node)[0] || [round(-ex[0]), round(-ex[1]), round(-ex[2])];
    return node;
  }

  /**
   * Lochzapfenkupplung um 90 Grad um ihre Lochachse weiterdrehen -- damit ihre
   * Arme woandershin zeigen. Steckt schon ein Rohr darin, bleibt sie stehen:
   * sonst risse die Drehung das Rohr von seinem Arm.
   */
  turnHoleClamp(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n || !isHolePart(n.part) || !n.partQuat) return false;
    if (this.degree(n.id) > 0) return false;
    const ex = xAxisOf(n.partQuat), ez = zAxisOf(n.partQuat);
    // +Y wandert auf +Z, die Lochachse (+X) bleibt.
    n.partQuat = quatFromBasis(ex, ez, cross3(ex, ez)).map(round4);
    const arme = holeArmDirs(n);
    if (arme.length) n.stub = arme[0];
    return true;
  }

  /**
   * Haengt an dieser Richtung des Knotens schon ein Rohr? Gebraucht fuer die
   * Scharniere: ein Arm mit Rohr darf sich nicht mehr wegdrehen.
   */
  _armHasTube(node, dir) {
    for (const t of this.tubes.values()) {
      if (t.link) continue;
      const o = t.a === node.id ? this.nodes.get(t.b) : t.b === node.id ? this.nodes.get(t.a) : null;
      if (!o) continue;
      const v = norm3([o.x - node.x, o.y - node.y, o.z - node.z]);
      if (dot3(v, dir) > 0.9) return true;
    }
    return false;
  }

  /**
   * Ankerpunkte fuer den Flexikupplungs-Bolzen: jede DUMMY-Kupplung, also ein
   * Rohrende mit genau einem Rohr und ohne weiteres Teil. Der Bolzen ersetzt
   * sie -- er steckt mit einem Segment im Rohr, zwei schauen heraus.
   */
  boltMounts(cs = 5) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.part || n.c45 || n.c45body || n.bearingOn || n.unused) continue;
      if (this.hasWheelCap(n) || this.hasEndPiece(n)) continue;
      const nachbarn = [];
      for (const t of this.tubes.values()) {
        if (t.arm || t.link) continue;
        const o = t.a === n.id ? this.nodes.get(t.b) : t.b === n.id ? this.nodes.get(t.a) : null;
        if (o) nachbarn.push(norm3([o.x - n.x, o.y - n.y, o.z - n.z]));
      }
      if (nachbarn.length !== 1) continue;      // nur die einarmige Dummy-Kupplung
      const dir = [round4(-nachbarn[0][0]), round4(-nachbarn[0][1]), round4(-nachbarn[0][2])];
      out.push({
        nodeId: n.id, dir, pos: [n.x, n.y, n.z],
        // Der Punkt selbst steckt im Wuerfel -- der gruene Griff gehoert davor.
        handle: [round(n.x + dir[0] * cs), round(n.y + dir[1] * cs), round(n.z + dir[2] * cs)],
      });
    }
    return out;
  }

  /**
   * Bolzen auf eine Dummy-Kupplung setzen. Der Knoten bleibt, bekommt aber das
   * feste Katalogteil: gezeichnet wird ab jetzt der Bolzen statt des Wuerfels.
   * Die lokale +X-Achse zeigt vom Rohr weg, die Rollage ist frei -- genommen
   * wird die, bei der ein Scharnier bei 0 Grad nach unten haengt.
   */
  addBolt(nodeId, cs = 5) {
    const n = this.nodes.get(nodeId);
    if (!n || n.part) return null;
    const m = this.boltMounts(cs).find((x) => x.nodeId === nodeId);
    if (!m) return null;
    const ex = norm3(m.dir);
    const hoch = Math.abs(ex[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const ey = norm3([hoch[0] - ex[0] * dot3(hoch, ex), hoch[1] - ex[1] * dot3(hoch, ex),
      hoch[2] - ex[2] * dot3(hoch, ex)]);
    n.part = BOLT_PART;
    n.partQuat = quatFromBasis(ex, ey, cross3(ex, ey)).map(round4);
    n.hinges = [];
    return n;
  }

  /**
   * Die naechste freie Stellung fuer ein Scharnier an diesem Bolzen -- in
   * 45-Grad-Schritten und mindestens 90 Grad neben jedem, das schon steht.
   * Naeher passen die Riemen nicht aneinander vorbei.
   */
  freeHingeAngle(node) {
    if (!isBoltPart(node && node.part)) return null;
    const steht = (node.hinges || []).map((g) => ((g % 360) + 360) % 360);
    for (let g = 0; g < 360; g += HINGE_STEP) {
      if (steht.every((h) => hingeGap(g, h) >= HINGE_MIN_GAP)) return g;
    }
    return null;
  }

  /**
   * Ankerpunkte fuer ein Scharnier: je Bolzen mit weniger als zwei Scharnieren
   * einer. Der Griff liegt dort, wo der Arm des naechsten Scharniers landet --
   * so sieht man vorher, wohin es zeigt.
   */
  hingeMounts(cs = 5) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (!isBoltPart(n.part)) continue;
      if ((n.hinges || []).length >= MAX_HINGES) continue;
      const grad = this.freeHingeAngle(n);
      if (grad == null) continue;
      const d = hingeDir(n, grad);
      const pos = [round(n.x + d[0] * cs * 1.5), round(n.y + d[1] * cs * 1.5),
        round(n.z + d[2] * cs * 1.5)];
      out.push({ nodeId: n.id, grad, pos });
    }
    return out;
  }

  /** Scharnier auf das mittlere Segment eines Bolzens setzen. */
  addHinge(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!isBoltPart(n && n.part)) return null;
    if (!n.hinges) n.hinges = [];
    if (n.hinges.length >= MAX_HINGES) return null;
    const grad = this.freeHingeAngle(n);
    if (grad == null) return null;
    n.hinges.push(grad);
    return n;
  }

  /** EIN Scharnier vom Bolzen nehmen. */
  removeHinge(nodeId, index) {
    const n = this.nodes.get(nodeId);
    if (!isBoltPart(n && n.part) || !n.hinges || index >= n.hinges.length) return false;
    n.hinges.splice(index, 1);
    return true;
  }

  /**
   * Bolzen eine Stufe tiefer ins Rohr schieben und wieder zurueck: ein Segment
   * oder zwei. Mit zwei Segmenten traegt das aeussere Segment die Scharniere
   * und der freie Stutzen faellt weg -- steckt dort ein Rohr, bleibt es beim
   * flacheren Sitz.
   */
  turnBoltDepth(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!isBoltPart(n && n.part)) return false;
    const tief = boltDepth(n) === 1 ? 2 : 1;
    if (tief === 2 && this._armHasTube(n, boltAxis(n))) return false;
    if (tief === 2) n.boltDeep = 2; else delete n.boltDeep;
    return true;
  }

  /**
   * Scharnier um 45 Grad um die Bolzenachse weiterdrehen. Stellungen, die dem
   * anderen Scharnier naeher als 90 Grad kaemen, werden dabei uebersprungen --
   * der Klick geht also weiter, bis die naechste erlaubte Rastung kommt.
   * Haengt an diesem Arm ein Rohr, bleibt es stehen: sonst risse die Drehung
   * das Rohr vom Stutzen.
   */
  turnHinge(nodeId, index = 0) {
    const n = this.nodes.get(nodeId);
    if (!isBoltPart(n && n.part) || !n.hinges || index >= n.hinges.length) return false;
    if (this._armHasTube(n, hingeDir(n, n.hinges[index]))) return false;
    const andere = n.hinges.filter((_, i) => i !== index)
      .map((g) => ((g % 360) + 360) % 360);
    let g = n.hinges[index];
    for (let i = 0; i < 360 / HINGE_STEP; i++) {
      g = (g + HINGE_STEP) % 360;
      if (andere.every((h) => hingeGap(g, h) >= HINGE_MIN_GAP)) { n.hinges[index] = g; return true; }
    }
    return false;
  }

  /**
   * Wohin eine Klemm-Kupplung an dieser Stelle des Rohrs kaeme -- ohne sie zu
   * setzen. Liefert null, wo sie nicht hin darf (Bogenrohr, unter dem Boden,
   * schon eine gleiche Klemme dort). Gebraucht fuer die Vorschau unter dem
   * Mauszeiger und von addTubeClamp selbst.
   */
  tubeClampMount(tubeId, point, part, cs = 5) {
    const g = this._clampGeom(tubeId, point);
    if (!g) return null;
    const off = clampOffset(part, cs);
    const pos = [g.axis[0] + g.stub[0] * off, g.axis[1] + g.stub[1] * off, g.axis[2] + g.stub[2] * off];
    if (this.isBelowGround(pos[1])) return null;
    for (const n of this.nodes.values()) {
      if (part === "bearing" ? n.bearingOn : n.part === part) {
        if (Math.hypot(n.x - pos[0], n.y - pos[1], n.z - pos[2]) < 2) return null;
      }
    }
    return { tubeId, pos, achse: g.axis, stub: g.stub, t: round(g.t) };
  }

  /**
   * Trefferpunkt auf die Rohrachse ziehen (auf das Rohr begrenzt). Der
   * Ankerpunkt einer Klemme gehoert MITTIG ins Rohr, nicht auf die Stelle der
   * Oberflaeche, an der der Zeiger steht.
   */
  tubeAxisPoint(tubeId, point) {
    const t = this.tubes.get(tubeId);
    if (!t) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const rel = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
    const s = Math.max(0, Math.min(L, rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]));
    return [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
  }

  /**
   * Klemm-Kupplung entlang ihres Rohrs verschieben. Alles, was an ihr haengt
   * (eingestecktes Rohr samt allem dahinter), geht mit -- der Zweig haengt im
   * Graphen ja nur ueber sie. Das umschlossene Rohr selbst gehoert nicht dazu:
   * es beruehrt den Knoten nicht.
   */
  slideTubeClamp(nodeId, point, cs = 5) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.clampOn) return false;
    const g = this._clampGeom(node.clampOn.tubeId, point, node.stub);
    if (!g) return false;
    const off = nodeClampOffset(node, cs);
    const pos = [g.axis[0] + node.stub[0] * off, g.axis[1] + node.stub[1] * off, g.axis[2] + node.stub[2] * off];
    if (this.isBelowGround(pos[1])) return false;
    const d = [pos[0] - node.x, pos[1] - node.y, pos[2] - node.z];
    if (Math.hypot(d[0], d[1], d[2]) < 0.01) return false;
    const moved = new Set();
    for (const n of this._branchFrom(nodeId)) {
      n.x = round(n.x + d[0]); n.y = round(n.y + d[1]); n.z = round(n.z + d[2]);
      moved.add(n.id);
    }
    this._moveTubeGeom(moved, d);
    this._movePanelGeom(moved, d);
    node.clampOn.t = round(g.t);
    return true;
  }

  // Knoten, die nur ueber `startId` zusammenhaengen (der Zweig an der Klemme).
  _branchFrom(startId) {
    const seen = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      for (const t of this.tubes.values()) {
        const other = t.a === id ? t.b : t.b === id ? t.a : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    return [...seen].map((id) => this.nodes.get(id)).filter(Boolean);
  }

  // Stelle auf dem Rohr + Richtung des Anschlusses aus einem Trefferpunkt.
  _clampGeom(tubeId, point, keepStub = null) {
    const t = this.tubes.get(tubeId);
    // Klemmen sitzen nur auf GERADEN Rohren -- um einen Bogen greifen sie nicht.
    if (!t || t.bow || t.arm || t.link) return null;
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1;
    const u = [ab[0] / L, ab[1] / L, ab[2] / L];
    const rel = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
    const s = Math.max(0, Math.min(L, rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]));
    const axis = [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
    let stub = keepStub;
    if (!stub) {
      const off = [point[0] - axis[0], point[1] - axis[1], point[2] - axis[2]];
      stub = this._cardinalPerpTo(off, u);
    }
    return { axis, dir: u, t: s, stub };
  }

  /**
   * Richtung senkrecht zum Rohr, die am ehesten zur Klickseite zeigt.
   *
   * Gewaehlt wird unter den Weltachsen, gemessen wird aber EXAKT senkrecht: am
   * schraegen Rohr steht keine Weltachse wirklich quer (erlaubt sind bis zu
   * 17 Grad Abweichung), und mit der schiefen Richtung sass die Klemme quer
   * statt um das Rohr. Erst ein Weiterdrehen richtete sie -- das dreht naemlich
   * um die Rohrachse und trifft die Senkrechte dadurch immer.
   */
  _cardinalPerpTo(off, u) {
    let best = null, bd = -Infinity;
    for (const c of CARDINALS) {
      if (Math.abs(dot3(c, u)) > 0.3) continue;
      const d = dot3(c, off);
      if (d > bd) { bd = d; best = c; }
    }
    if (!best) return [0, 1, 0];
    // Laengsanteil abziehen -- uebrig bleibt die echte Querrichtung.
    const laengs = dot3(best, u);
    const quer = [best[0] - u[0] * laengs, best[1] - u[1] * laengs, best[2] - u[2] * laengs];
    const L = Math.hypot(quer[0], quer[1], quer[2]);
    if (L < 1e-6) return best;
    return [round4(quer[0] / L), round4(quer[1] / L), round4(quer[2] / L)];
  }

  /**
   * Gegenrohre fuer ein Netz. Anders als eine Platte hat das Netz keine
   * feste Groesse -- die Datei speichert seine Masse -- deshalb passt jeder
   * Rohrabstand des Rasters. Die Laenge ist die Ueberdeckung der beiden Rohre,
   * auf volle Felder abgerundet und bei vier Feldern gedeckelt (so gross ist
   * das Netz im Ball Cage).
   */
  latticePartners(railId, tol = 1.5) {
    const ra = this._rail(railId);
    if (!ra) return [];
    const out = [];
    for (const t of this.tubes.values()) {
      if (t.id === railId || t.arm || t.link || t.bow) continue;
      const rb = this._rail(t.id);
      if (!rb) continue;
      const dot = rb.dir[0] * ra.dir[0] + rb.dir[1] * ra.dir[1] + rb.dir[2] * ra.dir[2];
      if (Math.abs(dot) < 0.999) continue;
      const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
      const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
      const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
      const gap = Math.hypot(perp[0], perp[1], perp[2]);
      if (!LATTICE_GAPS.some((g) => Math.abs(g - gap) <= tol)) continue;
      const e = along + rb.len * dot;
      const lo = Math.max(0, Math.min(along, e));
      const hi = Math.min(ra.len, Math.max(along, e));
      const span = hi - lo;
      if (span < LATTICE_STEP - tol) continue;
      const len = Math.min(LATTICE_MAX, Math.floor((span + tol) / LATTICE_STEP) * LATTICE_STEP);
      out.push({ id: t.id, gap: round(gap), len, lo: round(lo), hi: round(hi) });
    }
    return out;
  }

  /**
   * 布面 / 网 / 袋可点的格子：一对承重管 + 一段重叠。同一块开口只出一次，
   * 避免竖管对和横管对在同一面上叠两块绿。
   */
  railFittingMounts(kind) {
    const out = [];
    const seenPair = new Set();
    const seenFace = new Set();
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const partners = kind === "bag2" ? this.bagPartners(t.id) : this.latticePartners(t.id);
      for (const p of partners) {
        const count = Math.max(1, Math.floor((p.hi - p.lo + 0.5) / p.len));
        for (let k = 0; k < count; k++) {
          const t0 = round(p.lo + k * p.len);
          const pairKey = [t.id, p.id].sort().join("|") + "|" + t0 + "|" + p.len;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);
          if (this._railFittingTaken(kind, t.id, p.id, t0, p.len)) continue;
          const cor = this.panelCorners({ a: t.id, b: p.id, t0, len: p.len });
          if (!cor) continue;
          const faceKey = this._railFaceKey(cor);
          if (seenFace.has(faceKey) || this._railFaceTaken(kind, cor)) continue;
          seenFace.add(faceKey);
          // Auf einer Platte, einem Tuch oder quer ueber ein Rohr laesst sich
          // nichts spannen -- das Feld muss frei sein.
          if (!this._openingFree(cor)) continue;
          out.push({ a: t.id, b: p.id, t0, len: p.len, corners: cor });
        }
      }
    }
    return out;
  }

  _railFaceKey(cor) {
    return cor.map((c) => c.map((v) => Math.round(v)).join(",")).sort().join(";");
  }

  _railFaceTaken(kind, cor) {
    const faceKey = this._railFaceKey(cor);
    if (kind === "textil2") {
      for (const x of this.textiles.values()) {
        const existing = this.panelCorners(x);
        if (existing && this._railFaceKey(existing) === faceKey) return true;
      }
      return false;
    }
    const mid = [0, 1, 2].map((i) => cor.reduce((s, q) => s + q[i], 0) / 4);
    const near = kind === "bag2" ? 5 : 2;
    for (const f of this.fittings.values()) {
      if (f.kind !== kind) continue;
      if (Math.hypot(f.x - mid[0], f.y - mid[1], f.z - mid[2]) < near) return true;
    }
    return false;
  }

  _railFittingTaken(kind, aId, bId, t0, len) {
    if (kind === "textil2") {
      for (const x of this.textiles.values()) {
        if (((x.a === aId && x.b === bId) || (x.a === bId && x.b === aId))
          && Math.abs((x.t0 || 0) - t0) < 2) return true;
      }
      return false;
    }
    const cor = this.panelCorners({ a: aId, b: bId, t0, len });
    if (!cor) return false;
    const c = [0, 1, 2].map((i) => cor.reduce((s, q) => s + q[i], 0) / 4);
    const near = kind === "bag2" ? 5 : 2;
    for (const f of this.fittings.values()) {
      if (f.kind !== kind) continue;
      if (Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]) < near) return true;
    }
    return false;
  }

  /**
   * Textil zwischen zwei parallele Rohre spannen -- gesetzt wie das Netz, nur
   * dass daraus kein Anbauteil wird, sondern ein Eintrag in `textiles`: dieselbe
   * Sorte Fläche wie eine Platte (zwei Tragrohre, Versatz, Länge) und genau das,
   * was der Export als textil2 schreibt.
   */
  addTextile(aId, bId, t0, len, color) {
    const ra = this._rail(aId), rb = this._rail(bId);
    if (!ra || !rb) return null;
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
    const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
    const gap = Math.hypot(perp[0], perp[1], perp[2]);
    if (gap < 1) return null;
    for (const x of this.textiles.values()) {
      if (((x.a === aId && x.b === bId) || (x.a === bId && x.b === aId))
        && Math.abs((x.t0 || 0) - t0) < 2) return null;      // dort hängt schon eins
    }
    const tx = {
      id: this._id("x"), a: aId, b: bId, t0: round(t0), len: round(len),
      w: round(len - 5), h: round(gap - 5), color: color || null, side: 1,
    };
    this.textiles.set(tx.id, tx);
    return tx;
  }

  /**
   * Netz auf zwei parallele Rohre setzen -- derselbe Ablauf wie bei einer
   * Platte, nur entsteht ein Anbauteil mit eigenen Massen. Die Masse sind an
   * den Ball-Cage-Entwuerfen gemessen: laengs der Rohre das Rastermass minus
   * eine Kupplung (1600 -> 1550), quer dazu minus eine halbe (800 -> 775), und
   * das Netz schliesst oben buendig mit dem Rohr ab, unten bleiben 25 mm Luft.
   */
  addLattice(aId, bId, t0, len, color) {
    const ra = this._rail(aId), rb = this._rail(bId);
    if (!ra || !rb) return null;
    const A = [ra.p0[0] + ra.dir[0] * t0, ra.p0[1] + ra.dir[1] * t0, ra.p0[2] + ra.dir[2] * t0];
    // Lot vom ersten auf das zweite Rohr
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = off[0] * ra.dir[0] + off[1] * ra.dir[1] + off[2] * ra.dir[2];
    const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
    const gap = Math.hypot(perp[0], perp[1], perp[2]);
    if (gap < 1) return null;
    const u = [perp[0] / gap, perp[1] / gap, perp[2] / gap];   // erstes -> zweites Rohr
    // Lokales X zeigt zum OBEREN Rohr, lokales Y laeuft laengs, Z ist die Normale.
    const up = u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
    const sign = up === u ? 1 : -1;
    const w = round(len - 5), h = round(gap - 2.5);
    // Mitte: Feldmitte, dann 1,25 cm zum oberen Rohr -- so sitzt die Oberkante
    // auf der Rohrachse und unten bleibt der gemessene Spalt.
    const c = [
      A[0] + ra.dir[0] * (len / 2) + perp[0] / 2 + up[0] * 1.25,
      A[1] + ra.dir[1] * (len / 2) + perp[1] / 2 + up[1] * 1.25,
      A[2] + ra.dir[2] * (len / 2) + perp[2] / 2 + up[2] * 1.25,
    ];
    const ey = [ra.dir[0] * sign, ra.dir[1] * sign, ra.dir[2] * sign];
    const ez = [up[1] * ey[2] - up[2] * ey[1], up[2] * ey[0] - up[0] * ey[2], up[0] * ey[1] - up[1] * ey[0]];
    for (const f of this.fittings.values()) {
      if (f.kind === "lattice2" && Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]) < 2) return null;
    }
    return this.addFitting("lattice2", c[0], c[1], c[2],
      { quat: quatFromBasis(up, ey, ez), color: color || null, w, h });
  }

  /**
   * Gegenrohre fuer den Spielsack: beide Rohre muessen WAAGERECHT liegen und auf
   * gleicher Hoehe, denn der Sack haengt nach unten -- zur Seite oder nach oben
   * gibt es ihn nicht.
   */
  bagPartners(railId) {
    const ra = this._rail(railId);
    if (!ra || Math.abs(ra.dir[1]) > 0.01) return [];
    return this.panelPartners(railId, [40, 40]).filter((c) => {
      const rb = this._rail(c.id);
      if (!rb || Math.abs(rb.dir[1]) > 0.01) return false;
      return Math.abs(rb.p0[1] - ra.p0[1]) < 1;      // gleiche Hoehe
    });
  }

  /**
   * Spielsack zwischen zwei parallele Rohre haengen. Das Tuch misst 35 x 35 cm
   * und spannt damit ein Rasterfeld; gehalten wird es von den beiden Rohren.
   * Gespeichert wird wie beim Netz: Mitte, Dreibein, Masse.
   */
  addBag(aId, bId, t0, len, color) {
    const ra = this._rail(aId), rb = this._rail(bId);
    if (!ra || !rb) return null;
    const A = [ra.p0[0] + ra.dir[0] * t0, ra.p0[1] + ra.dir[1] * t0, ra.p0[2] + ra.dir[2] * t0];
    const off = [rb.p0[0] - ra.p0[0], rb.p0[1] - ra.p0[1], rb.p0[2] - ra.p0[2]];
    const along = dot3(off, ra.dir);
    const perp = [off[0] - ra.dir[0] * along, off[1] - ra.dir[1] * along, off[2] - ra.dir[2] * along];
    const gap = Math.hypot(perp[0], perp[1], perp[2]);
    if (gap < 1) return null;
    const u = [perp[0] / gap, perp[1] / gap, perp[2] / gap];   // erstes -> zweites Rohr
    const c = [
      A[0] + ra.dir[0] * (len / 2) + perp[0] / 2,
      A[1] + ra.dir[1] * (len / 2) + perp[1] / 2,
      A[2] + ra.dir[2] * (len / 2) + perp[2] / 2,
    ];
    for (const f of this.fittings.values()) {
      if (f.kind === "bag2" && Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]) < 5) return null;
    }
    // Dreibein wie in den Herstellerdateien: lokales X laeuft AM ROHR entlang,
    // Y zeigt nach oben, Z zum zweiten Rohr. (Gemessen an allen fuenf Saecken:
    // Kupplungen liegen lokal bei (+-200, 0, 0) und (+-200, 0, 400).)
    const ey = [0, 1, 0];
    let ex = ra.dir;
    let ez = cross3(ex, ey);
    if (dot3(ez, u) < 0) { ex = [-ex[0], -ex[1], -ex[2]]; ez = cross3(ex, ey); }
    if (Math.abs(ex[1]) > 0.01 || dot3(ez, u) < 0.9) return null;   // Feld nicht waagerecht
    return this.addFitting("bag2", c[0], c[1], c[2],
      { quat: quatFromBasis(ex, ey, ez), color: color || null, w: BAG_SIZE, h: BAG_SIZE });
  }

  /**
   * Anbauteil an einer Montagestelle setzen. Die lokale +X-Achse des Teils
   * zeigt in `dir` -- dieselbe Regel, nach der die Dateien des Herstellers
   * gelesen und geschrieben werden. Sitzt dort schon dasselbe Teil, passiert
   * nichts (kein Stapeln).
   */
  addFittingAt(kind, mount, color) {
    if (!PLACEABLE_FITTINGS.includes(kind)) return null;
    // Rohrkappe und Radkappe schliessen beide ein Rohrende ab -- an derselben
    // Stelle ergibt nur eine von beiden Sinn.
    const CAPS = ["hub-cap2", "tube-cap2"];
    const blocken = CAPS.includes(kind) ? CAPS : [kind];
    for (const f of this.fittings.values()) {
      if (!blocken.includes(f.kind)) continue;
      if (Math.hypot(f.x - mount.pos[0], f.y - mount.pos[1], f.z - mount.pos[2]) >= 3) continue;
      // Teile an einer Kupplung sitzen alle auf DEREN Punkt -- erst die
      // Richtung sagt, welcher Stutzen belegt ist. An einer Kupplung duerfen
      // durchaus mehrere Arretierungen sitzen, nur nicht zwei auf einem Stutzen.
      if (!mount.dir || !f.quat) return null;
      const ax = xAxisOf(f.quat);
      if (ax[0] * mount.dir[0] + ax[1] * mount.dir[1] + ax[2] * mount.dir[2] > 0.9) return null;
    }
    const half = (FITTING_WIDTH[kind] || 0) / 2;
    if (half && this._fittingBlocked(kind, mount.pos, mount.dir || [1, 0, 0], half)) return null;
    const f = this.addFitting(kind, mount.pos[0], mount.pos[1], mount.pos[2],
      { quat: mount.quat || quatFromXAxis(mount.dir), color: color || null });
    // Eine Laufrolle sitzt immer auf ihrem Adapter -- der kommt deshalb im
    // selben Zug mit. In der Stueckliste bleiben es zwei Teile.
    if (f && kind === "casters2") {
      const quat = mount.quat || quatFromXAxis(mount.dir);
      const ax = xAxisOf(quat);
      // Steckt dort schon ein einzeln gesetzter Adapter, bleibt es bei dem.
      const schonDa = [...this.fittings.values()].some((o) => o.kind === "adapter2"
        && Math.hypot(o.x - mount.pos[0], o.y - mount.pos[1], o.z - mount.pos[2]) < 3
        && o.quat && dot3(xAxisOf(o.quat), ax) > 0.9);
      if (!schonDa) {
        this.addFitting("adapter2", mount.pos[0], mount.pos[1], mount.pos[2], { quat });
      }
    }
    return f;
  }

  // Montagestellen fuer eine Rutsche: zwei parallele SENKRECHTE Rohre. Die
  // Rutsche wird dort eingehaengt und sitzt knapp ueber den unteren Kupplungen.
  // Liefert je Stelle { nodes, hook:[x,y,z], normal:[..] } -- hook ist der
  // Einhaengepunkt (Mitte zwischen beiden Rohren, kurz ueber den unteren
  // Kupplungen), normal die Richtung, in die die Rutsche abfaellt.
  //
  // 滑梯落差固定约 80 cm。挂钩挂在两根竖管之间的 35 cm 横梁上——官方文件里
  // 全部 130 多处滑梯都是这样：横梁是平台那一层的边，两根竖管在横梁上方
  // 继续往上（护栏），滑梯从护栏之间这个空档滑出去。所以绿面标的是横梁
  // 【上方】的那个空档，空档里有板、网、布就挂不了。
  //
  // 横梁两端只有一端有竖管往上（比如舞台正面一整片 80 cm 宽的开口）时，横梁
  // 本身也能挂，条件同样是它上方那 40×40 的空档里什么都没有。
  //
  // 竖管到横梁就结束（两层立方框的顶面）时，滑梯也能搭在顶梁上——这时绿面
  // 是横梁下方那一格；只有上面什么都不接时才这样算，免得同一根横梁出两个面。
  slideMounts(width = 40, tol = 2, kind = "slide-new2") {
    // Ein Koerper einer Kette endet nicht hier: hinter ihm kommt das naechste
    // Teil, sein Fuss muss also nichts tragen. Nur die Integralrutsche braucht
    // Boden oder Geruest unter dem Auslauf.
    const kette = !!(SLIDE_PARTS[kind] && SLIDE_PARTS[kind].chain);
    const brauchtAuflage = !kette;
    const out = [];
    const seen = new Set();
    const groundY = this._groundLevel();

    // Gemeinsame Pruefung einer Stelle: Querrohr als Haken, Hoehe, freies Feld,
    // keine Rutsche schon dort, freie Bahn und (Integralrutsche) Auflage.
    // p/q: { x, z, lowId?, highId?, low?, high?, len? } der beiden Seiten.
    const pruefe = (p, q, hookY, y0, y1) => {
      if (y1 - y0 < 10) return;
      if (!this._slideEntryOk(p, q, hookY) || hookY - groundY < SLIDE_DROP - 1) return;
      const dx = q.x - p.x, dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      const hook = [(p.x + q.x) / 2, hookY + (kette ? 0 : SLIDE_HOOK_LIFT), (p.z + q.z) / 2];
      const key = [Math.round(hook[0]), Math.round(hook[1]), Math.round(hook[2])].join("|");
      if (seen.has(key)) return;
      const corners = [
        [p.x, y0, p.z], [q.x, y0, q.z],
        [q.x, y1, q.z], [p.x, y1, p.z],
      ];
      // Platte, Netz, Tuch oder Rohr auf dem Feld: da kommt keine Rutsche durch.
      if (!this._openingFree(corners)) return;
      // Dort haengt schon eine Rutsche (gleich welcher Art).
      if (this._slideHooked(hook)) return;
      const nrm = [-dz / d, 0, dx / d];
      let front = 0, back = 0;
      for (const n of this.nodes.values()) {
        const sdist = (n.x - hook[0]) * nrm[0] + (n.z - hook[2]) * nrm[2];
        if (sdist > 5) front++; else if (sdist < -5) back++;
      }
      let dir = front > back ? [-nrm[0], 0, -nrm[2]] : nrm;
      const usable = (vec) => this._slidePathFree(hook, vec)
        && (!brauchtAuflage || this._slideFootRests(hook, vec, groundY));
      if (!usable(dir)) {
        const other = [-dir[0], 0, -dir[2]];
        if (!usable(other)) return;
        dir = other;
      }
      seen.add(key);
      out.push({ hook, normal: dir, corners });
    };

    // 1. Pfostenpaare: zwei senkrechte Rohre im Abstand `width`.
    const posts = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.z - b.z) > 0.5) continue; // nicht senkrecht
      if (Math.abs(a.y - b.y) < 0.5) continue;
      const aLow = a.y <= b.y;
      posts.push({
        x: a.x, z: a.z,
        low: Math.min(a.y, b.y), high: Math.max(a.y, b.y),
        len: t.length,
        lowId: aLow ? a.id : b.id,
        highId: aLow ? b.id : a.id,
      });
    }
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        const p = posts[i], q = posts[j];
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (Math.abs(d - width) > tol) continue;
        const hakenOk = (y) => this._slideEntryOk(p, q, y) && y - groundY >= SLIDE_DROP - 1;
        // Haken am unteren Ende: die Rutsche laeuft durch die Oeffnung ZWISCHEN
        // den beiden Pfosten hinaus -- der Regelfall.
        const untenGleich = Math.abs(p.low - q.low) <= 0.5;
        if (untenGleich) pruefe(p, q, p.low, p.low, Math.min(p.high, q.high));
        // Haken am oberen Ende (Rutsche ueber die Oberkante gehaengt): nur wenn
        // dort kein Pfosten weitergeht (sonst liefert das Paar darueber dieselbe
        // Stelle mit der richtigen Oeffnung) und das untere Ende selbst kein
        // Haken sein kann -- sonst laege auf EINEM Feld zweimal Gruen.
        if (Math.abs(p.high - q.high) <= 0.5 && !(untenGleich && hakenOk(p.low))
          && !this._postAbove(p.highId) && !this._postAbove(q.highId)) {
          pruefe(p, q, p.high, Math.max(p.low, q.low), p.high);
        }
      }
    }

    // 2. Querrohre ohne passendes Pfostenpaar: mindestens an einem Ende geht
    //    es nach oben weiter (sonst ist es die Oberkante -- Fall 1), und das
    //    Feld darueber ist frei.
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b || Math.abs(a.y - b.y) > 0.5) continue;              // nicht waagerecht
      if (Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - width) > tol) continue;
      if (!this._postAbove(a.id) && !this._postAbove(b.id)) continue;
      const p = { x: a.x, z: a.z, low: a.y, high: a.y, lowId: a.id, highId: a.id, len: 0 };
      const q = { x: b.x, z: b.z, low: b.y, high: b.y, lowId: b.id, highId: b.id, len: 0 };
      pruefe(p, q, a.y, a.y, a.y + width);
    }
    return out;
  }

  /**
   * Ist dieses Feld frei -- keine Platte, kein Tuch, kein Netz darauf, kein
   * Rohr und keine Kupplung mittendrin? Der Rand (die tragenden Rohre und ihre
   * Kupplungen) zaehlt nicht. Platten und Tuecher werden ueber die gemeinsame
   * Ebene und Trennachsen verglichen, so faellt auch ein breiteres Tuch auf,
   * das dieses Feld nur mit abdeckt.
   */
  _openingFree(corners) {
    for (const p of this.panels.values()) {
      const c = this.panelCorners(p);
      if (c && this._panelsOverlap(corners, c)) return false;
    }
    for (const x of this.textiles.values()) {
      const c = this.panelCorners(x);
      if (c && this._panelsOverlap(corners, c)) return false;
    }
    for (const f of this.fittings.values()) {
      if (f.kind !== "lattice2") continue;
      const c = this._latticeCorners(f);
      if (c && this._panelsOverlap(corners, c)) return false;
    }
    const [c0, c1, , c3] = corners;
    const u = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const v = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
    const U = Math.hypot(...u), V = Math.hypot(...v);
    if (U < 1 || V < 1) return true;
    const n = cross3([u[0] / U, u[1] / U, u[2] / U], [v[0] / V, v[1] / V, v[2] / V]);
    const margin = 3;
    const innen = (pt) => {
      const d = [pt[0] - c0[0], pt[1] - c0[1], pt[2] - c0[2]];
      if (Math.abs(dot3(d, n)) > margin) return false;
      const s = dot3(d, u) / U, t = dot3(d, v) / V;
      return s > margin && s < U - margin && t > margin && t < V - margin;
    };
    for (const nd of this.nodes.values()) if (innen([nd.x, nd.y, nd.z])) return false;
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (innen([(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2])) return false;
    }
    return true;
  }

  /** Die vier Ecken eines Netzes (lattice2): Mitte, Dreibein, Masse w x h. */
  _latticeCorners(f) {
    if (!f.quat || f.quat.length !== 4 || !f.w || !f.h) return null;
    const ex = xAxisOf(f.quat), ey = yAxisOf(f.quat);
    const hx = f.h / 2, hy = f.w / 2;
    const at = (sx, sy) => [
      f.x + ex[0] * sx * hx + ey[0] * sy * hy,
      f.y + ex[1] * sx * hx + ey[1] * sy * hy,
      f.z + ex[2] * sx * hx + ey[2] * sy * hy,
    ];
    return [at(-1, -1), at(-1, 1), at(1, 1), at(1, -1)];
  }

  /** Geht von dieser Kupplung ein gerades Rohr senkrecht nach OBEN weiter? */
  _postAbove(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n) return false;
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      if (t.a !== nodeId && t.b !== nodeId) continue;
      const o = this.nodes.get(t.a === nodeId ? t.b : t.a);
      if (!o) continue;
      if (Math.abs(o.x - n.x) <= 0.5 && Math.abs(o.z - n.z) <= 0.5 && o.y > n.y + 0.5) return true;
    }
    return false;
  }

  /**
   * Haengt an diesem Querrohr schon eine Rutsche? Verglichen wird der Einstieg
   * jedes Rutschenteils; die Integralrutsche fuehrt ihren 5 cm hoeher, darum
   * die grosszuegige Hoehentoleranz.
   */
  _slideHooked(hook) {
    for (const s of this.slides.values()) {
      const e = this.slideEntry(s);
      if (!e) continue;
      if (Math.hypot(e.x - hook[0], e.z - hook[2]) < 3 && Math.abs(e.y - hook[1]) <= SLIDE_HOOK_LIFT + 1) return true;
    }
    return false;
  }

  /**
   * 滑梯的挂钩：这一高度上两根竖管之间要有 35 cm 横梁，一体、模块、弯滑梯
   * 都一样（官方文件里 36 处一体滑梯、100 多处模块/弯滑梯无一例外）。官方
   * 用法是两根 15 cm 竖管站在平台上；两层立方框顶面的 35 cm 竖管 + 顶梁也算。
   */
  _slideEntryOk(p, q, hookY = p.low) {
    const idAt = (post) => (Math.abs(post.low - hookY) <= 0.5 ? post.lowId
      : Math.abs(post.high - hookY) <= 0.5 ? post.highId : null);
    const a = idAt(p), b = idAt(q);
    if (a && b) {
      const quer = this.tubeBetween(a, b);
      if (quer && !quer.arm && !quer.link && Math.abs((quer.length || 0) - 35) < 0.5) return true;
    }
    if (Math.abs((p.len || 0) - 15) > 0.5 || Math.abs((q.len || 0) - 15) > 0.5) return false;
    const quer = this.tubeBetween(p.lowId, q.lowId);
    return !!quer && !quer.arm && !quer.link && Math.abs((quer.length || 0) - 35) < 0.5;
  }

  /**
   * Ist die Bahn zwischen Einstieg und Auslauf frei? Die Rutsche braucht ihre
   * volle Laenge; steht mittendrin eine Kupplung, laesst sie sich dort nicht
   * montieren. Die Enden bleiben ausgenommen: oben sind es die beiden Rohre,
   * an denen sie haengt, unten darf sie auf dem Geruest aufliegen.
   */
  _slidePathFree(hook, dir) {
    const foot = [hook[0] + dir[0] * SLIDE_RUN, hook[1] - SLIDE_DROP - SLIDE_HOOK_LIFT, hook[2] + dir[2] * SLIDE_RUN];
    for (const n of this.nodes.values()) {
      const rel = [n.x - hook[0], n.y - hook[1], n.z - hook[2]];
      const along = rel[0] * dir[0] + rel[2] * dir[2];
      if (along < SLIDE_CLEARANCE || along > SLIDE_RUN - SLIDE_CLEARANCE) continue;
      const t = along / SLIDE_RUN;
      const on = [hook[0] + (foot[0] - hook[0]) * t, hook[1] + (foot[1] - hook[1]) * t, hook[2] + (foot[2] - hook[2]) * t];
      if (Math.hypot(n.x - on[0], n.y - on[1], n.z - on[2]) < SLIDE_CLEARANCE) return false;
    }
    return true;
  }

  /**
   * Liegt der Auslauf auf? Entweder auf dem Boden oder auf dem Geruest -- eine
   * Rutsche, die in der Luft endet, laesst sich nicht bauen.
   */
  _slideFootRests(hook, dir, groundY) {
    const foot = [hook[0] + dir[0] * SLIDE_RUN, hook[1] - SLIDE_DROP - SLIDE_HOOK_LIFT, hook[2] + dir[2] * SLIDE_RUN];
    if (foot[1] - groundY < 1) return true;                      // steht auf dem Boden
    for (const n of this.nodes.values()) {
      if (Math.hypot(n.x - foot[0], n.y - foot[1], n.z - foot[2]) <= SLIDE_SUPPORT) return true;
    }
    return false;
  }

  /**
   * Ausgang eines Rutschenteils: wo das naechste Teil ansetzt und wie es dort
   * gedreht steht. Liefert null bei Teilen ohne Ausgang (Auslauf, Integral-
   * rutsche) und bei Teilen ohne eigene Drehung (im Editor an ein Rohrpaar
   * gehaengte Rutschen fuehren stattdessen `hook`).
   */
  slideExit(slide) {
    const spec = slide && SLIDE_PARTS[slide.kind];
    if (!spec || !spec.exit) return null;
    const q = slide.quat && slide.quat.length === 4 ? slide.quat : [0, 0, 0, 1];
    const off = rotateVecByQuat(q, spec.exit.off);
    const pos = [round(slide.x + off[0]), round(slide.y + off[1]), round(slide.z + off[2])];
    return { pos, quat: turnAroundY(q, spec.exit.turn), afterId: slide.id };
  }

  /**
   * Einstieg eines Rutschenteils -- der Punkt, an dem es OBEN Halt findet.
   * Die drei Faelle:
   *  - im Editor gesetzt: `hook` ist genau dieser Punkt;
   *  - Kettenteil (Modular-/Bogenrutsche, Auslauf): sein Bezugspunkt liegt
   *    bereits am oberen Ende, so fuehren es auch die Herstellerdateien;
   *  - Integralrutsche aus einer Datei: ihr Punkt liegt am FUSS (es gibt dort
   *    keinen `hook`), also Fall und Auslauf zurueckrechnen. Die Laufrichtung
   *    steckt in der Drehung -- das lokale +X steht 90 Grad quer dazu.
   */
  slideEntry(slide) {
    if (!slide) return null;
    if (slide.hook && slide.hook.length === 3) {
      return { x: slide.hook[0], y: slide.hook[1], z: slide.hook[2] };
    }
    if (slide.kind !== "slide-new2") return { x: slide.x, y: slide.y, z: slide.z };
    const q = slide.quat && slide.quat.length === 4 ? slide.quat : [0, 0, 0, 1];
    const ax = rotateVecByQuat(q, [1, 0, 0]);
    const dir = [-ax[2], 0, ax[0]];             // Laufrichtung des Auslaufs
    return {
      x: round(slide.x - dir[0] * SLIDE_RUN),
      y: round(slide.y + SLIDE_DROP + SLIDE_HOOK_LIFT),
      z: round(slide.z - dir[2] * SLIDE_RUN),
    };
  }

  /** Sitzt an dieser Stelle schon ein Rutschenteil? */
  _slideAt(pos, tol = 5) {
    for (const s of this.slides.values()) {
      if (Math.hypot(s.x - pos[0], s.y - pos[1], s.z - pos[2]) < tol) return s;
    }
    return null;
  }

  /**
   * Freie Ausgaenge aller gesetzten Rutschenteile -- dort laesst sich das
   * naechste Teil der Kette anhaengen. Die Integralrutsche gehoert nicht in
   * eine Kette, der Auslauf beendet sie.
   */
  slideChainMounts(kind) {
    if (!SLIDE_CHAIN_KINDS.includes(kind)) return [];
    const spec = SLIDE_PARTS[kind];
    const groundY = this._groundLevel();
    const out = [];
    for (const s of this.slides.values()) {
      const exit = this.slideExit(s);
      if (!exit) continue;
      if (this._slideAt(exit.pos)) continue;          // dort haengt schon eines
      if (this.isBelowGround(exit.pos[1])) continue;
      // Ein Koerper faellt weitere 80 cm: unter den Boden darf er nicht. Der
      // Auslauf liegt auf dem Boden -- an einem Ausgang in der Luft haengt er
      // nicht (dort gehoert erst noch ein Koerper hin). Boden ist die Nullebene
      // oder, wenn das Modell tiefer/hoeher steht, seine unterste Kupplung.
      if (spec.exit && exit.pos[1] + spec.exit.off[1] < Math.min(groundY, 0) - 1) continue;
      if (!spec.exit && exit.pos[1] > Math.max(groundY, 0) + 1) continue;
      out.push(exit);
    }
    return out;
  }

  /**
   * Rutschenteil an einen Ausgang haengen (Kette). Punkt und Drehung kommen von
   * der Montagestelle -- genau so, wie die Herstellerdateien die Teile fuehren.
   */
  addSlideAt(kind, mount, color = null) {
    if (!SLIDE_PARTS[kind] || !mount || !mount.pos) return null;
    if (this._slideAt(mount.pos)) return null;
    const slide = {
      id: this._id("s"),
      x: round(mount.pos[0]), y: round(mount.pos[1]), z: round(mount.pos[2]),
      quat: (mount.quat || [0, 0, 0, 1]).map((v) => Math.round(v * 1e4) / 1e4),
      kind, color,
    };
    this.slides.set(slide.id, slide);
    return slide;
  }

  /**
   * Wo ein Dachtuch hinpasst. Beide Daecher sitzen auf demselben Gerippe --
   * ein waagerechter First, an dessen beiden Enden je zwei 45-Grad-Sparren
   * nach beiden Seiten hinunterlaufen (zur Traufe aus C45-Kupplungen):
   *   roof2 (Dach):            First 80 cm  -- in 50 der 70 Herstellerdateien
   *                            sitzt der Punkt genau auf der Firstmitte;
   *   roof-large2 (Dachtextil): First 160 cm (zwei 75er), der Punkt liegt 40 cm
   *                            hinter dem Firstanfang (so zeichnet es die Szene).
   * Lokale X-Achse laeuft am First entlang, Y und Z sind um 45 Grad gekippt --
   * die beiden Dachschraegen fallen entlang +Z und -Y ab.
   * Liefert { pos, quat, faces: [Ecken Schraege A, Ecken Schraege B] }.
   */
  roofMounts(kind, alle = false) {
    const len = kind === "roof-large2" ? 160 : kind === "roof2" ? 80 : 0;
    if (!len) return [];
    const STEP = 40, EAVE = 60;
    // Nachbarn je Kupplung ueber gerade Rohre.
    const nb = new Map();
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      if (!this.nodes.has(t.a) || !this.nodes.has(t.b)) continue;
      if (!nb.has(t.a)) nb.set(t.a, new Set());
      if (!nb.has(t.b)) nb.set(t.b, new Set());
      nb.get(t.a).add(t.b); nb.get(t.b).add(t.a);
    }
    // Giebelknoten: zwei 45-Grad-Sparren nach unten, einander gegenueber.
    // Merkt sich die waagerechte Sparrenachse (senkrecht zum First).
    const gable = [];
    for (const n of this.nodes.values()) {
      const down = [];
      for (const id of nb.get(n.id) || []) {
        const o = this.nodes.get(id);
        const dy = n.y - o.y, dh = Math.hypot(o.x - n.x, o.z - n.z);
        if (dy < 10 || Math.abs(dy - dh) > 3) continue;           // kein 45-Grad-Sparren
        down.push([(o.x - n.x) / dh, (o.z - n.z) / dh]);
      }
      for (let i = 0; i < down.length; i++) {
        for (let j = i + 1; j < down.length; j++) {
          if (down[i][0] * down[j][0] + down[i][1] * down[j][1] > -0.98) continue;
          gable.push({ n, perp: down[i] });
        }
      }
    }
    const out = [];
    const seen = new Set();
    for (const g1 of gable) {
      for (const g2 of gable) {
        if (g1 === g2 || Math.abs(g1.n.y - g2.n.y) > 1) continue;
        const dx = g2.n.x - g1.n.x, dz = g2.n.z - g1.n.z;
        const d = Math.hypot(dx, dz);
        if (Math.abs(d - len) > 2) continue;
        // First immer in +X, sonst +Z zaehlen -- sonst waere derselbe Grat
        // zweimal mit entgegengesetztem Bezugspunkt im Angebot.
        if (dx < -0.5 || (Math.abs(dx) <= 0.5 && dz < 0)) continue;
        const ax = [dx / d, 0, dz / d];
        // First steht quer zu den Sparren -- an beiden Enden gleich.
        if (Math.abs(ax[0] * g1.perp[0] + ax[2] * g1.perp[1]) > 0.05) continue;
        if (Math.abs(ax[0] * g2.perp[0] + ax[2] * g2.perp[1]) > 0.05) continue;
        // Durchgehender First: an jedem Rasterpunkt eine Kupplung, dazwischen Rohr.
        let prev = g1.n, ok = true;
        for (let k = 1; ok && k <= Math.round(len / STEP); k++) {
          const px = g1.n.x + ax[0] * STEP * k, pz = g1.n.z + ax[2] * STEP * k;
          const here = [...this.nodes.values()].find((o) => Math.abs(o.y - g1.n.y) < 1
            && Math.hypot(o.x - px, o.z - pz) < 2);
          if (!here || !(nb.get(prev.id) || new Set()).has(here.id)) ok = false;
          prev = here;
        }
        if (!ok) continue;
        const mid = [(g1.n.x + g2.n.x) / 2, g1.n.y, (g1.n.z + g2.n.z) / 2];
        const key = [Math.round(mid[0]), Math.round(mid[1]), Math.round(mid[2])].join("|");
        if (seen.has(key)) continue;
        // Bezugspunkt: Dach in der Firstmitte, Dachtextil 40 cm hinter dem Anfang.
        const pos = kind === "roof2" ? mid
          : [g1.n.x + ax[0] * 40, g1.n.y, g1.n.z + ax[2] * 40];
        const posAlt = kind === "roof2" ? mid
          : [g2.n.x - ax[0] * 40, g2.n.y, g2.n.z - ax[2] * 40];
        const near = (p, o) => Math.hypot(o.x - p[0], o.y - p[1], o.z - p[2]) < 3;
        // Da liegt schon ein Dach (gleich welcher Art).
        const belegt = [...this.slides.values()].some((s) => s.kind === "roof2" && near(mid, s))
          || [...this.fittings.values()].some((f) => f.kind === "roof-large2"
            && (near(pos, f) || near(posAlt, f)));
        if (belegt && !alle) continue;
        seen.add(key);
        // Lokal +Z und -Y fallen ab: Y zeigt schraeg nach oben, Z = X x Y muss
        // nach unten weisen -- sonst die Sparrenseite wechseln.
        let perp = [g1.perp[0], 0, g1.perp[1]];
        const s2 = Math.SQRT1_2;
        let ay = [perp[0] * s2, s2, perp[2] * s2];
        let az = cross3(ax, ay);
        if (az[1] > 0) {
          perp = [-perp[0], 0, -perp[2]];
          ay = [perp[0] * s2, s2, perp[2] * s2];
          az = cross3(ax, ay);
        }
        const quat = quatFromBasis(ax, ay, az).map((v) => Math.round(v * 1e4) / 1e4);
        const face = (sg) => {
          const A = [g1.n.x, g1.n.y, g1.n.z], B = [g2.n.x, g2.n.y, g2.n.z];
          const off = [perp[0] * EAVE * sg, -EAVE, perp[2] * EAVE * sg];
          return [A, B, [B[0] + off[0], B[1] + off[1], B[2] + off[2]], [A[0] + off[0], A[1] + off[1], A[2] + off[2]]];
        };
        out.push({ pos, quat, kind, faces: [face(1), face(-1)] });
      }
    }
    return out;
  }

  /** Dachtuch auf ein Gerippe legen: das Dach ist ein Rutschen-Eintrag, das Dachtextil ein Anbauteil. */
  addRoofAt(mount, color = null) {
    if (!mount || !mount.pos) return null;
    const [x, y, z] = mount.pos;
    if (mount.kind === "roof2") {
      if (this._slideAt(mount.pos, 3)) return null;
      const slide = { id: this._id("s"), x: round(x), y: round(y), z: round(z), quat: mount.quat, kind: "roof2", color };
      this.slides.set(slide.id, slide);
      return slide;
    }
    for (const f of this.fittings.values()) {
      if (f.kind === "roof-large2" && Math.hypot(f.x - x, f.y - y, f.z - z) < 3) return null;
    }
    return this.addFitting("roof-large2", x, y, z, { quat: mount.quat, color });
  }

  /**
   * Womit ein Rutschenteil zusammenstoesst: Rohre, Kupplungen, Platten, Tuecher
   * und Anbauteile, die in seinem Koerper stecken. Gesetzt wird trotzdem -- der
   * Nutzer entscheidet, was weicht. Die Bahn wird als gerades Stueck vom
   * Einstieg zum Ausgang genommen (beim Bogen die Sehne), 40 cm breit, von
   * knapp unter der Rutschflaeche bis zur Oberkante der Seitenwaende.
   * Ausgenommen sind die Kupplungen und Rohre am Einstieg selbst (der Haken).
   * Liefert { tubes, nodes, panels, textiles, fittings, total }.
   */
  slideConflicts(slide) {
    const res = { tubes: 0, nodes: 0, panels: 0, textiles: 0, fittings: 0, total: 0 };
    if (!slide) return res;
    const spec = SLIDE_PARTS[slide.kind];
    if (!spec) return res;
    const entry = this.slideEntry(slide);
    if (!entry) return res;
    const q = slide.quat && slide.quat.length === 4 ? slide.quat : [0, 0, 0, 1];
    const start = [entry.x, entry.y, entry.z];
    const lokal = (v) => { const o = rotateVecByQuat(q, v); return [slide.x + o[0], slide.y + o[1], slide.z + o[2]]; };
    // Bahn als Polygonzug: gerade Teile ein Stueck, der Bogen eine Bezierkurve
    // (Einlauf lokal +Z, Auslauf lokal +X -- wie die Szene ihn zeichnet).
    let pts;
    if (slide.kind === "curved-slide2") {
      const P0 = start, P3 = lokal(spec.exit.off);
      const C1 = lokal([0, 0, 33]), C2 = lokal([spec.exit.off[0] - 33, spec.exit.off[1], spec.exit.off[2]]);
      pts = [];
      for (let i = 0; i <= 8; i++) {
        const tt = i / 8, uu = 1 - tt, a = uu ** 3, b = 3 * uu * uu * tt, c = 3 * uu * tt * tt, d = tt ** 3;
        pts.push([0, 1, 2].map((k) => a * P0[k] + b * C1[k] + c * C2[k] + d * P3[k]));
      }
    } else if (spec.exit) {
      pts = [start, lokal(spec.exit.off)];
    } else if (slide.kind === "slide-end2") {
      pts = [start, lokal([0, 0, 47.5])];
    } else {
      pts = [start, [slide.x, slide.y, slide.z]];      // Integralrutsche: Punkt am Fuss
    }
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...L);
      if (len < 1) continue;
      const u = [L[0] / len, L[1] / len, L[2] / len];
      const hz = Math.hypot(u[0], u[2]) || 1;
      const side = [-u[2] / hz, 0, u[0] / hz];             // quer zur Bahn, waagerecht
      segs.push({ a, u, len, side, up: cross3(side, u) }); // up: senkrecht zur Rutschflaeche
    }
    if (!segs.length) return res;
    const HALF_W = 18, BELOW = 3, ABOVE = 28, HEAD = 12, FOOT = 4;
    const inside = (p) => segs.some((sg, i) => {
      const d = [p[0] - sg.a[0], p[1] - sg.a[1], p[2] - sg.a[2]];
      const s = dot3(d, sg.u);
      const s0 = i === 0 ? HEAD : 0, s1 = sg.len - (i === segs.length - 1 ? FOOT : 0);
      if (s < s0 || s > s1) return false;
      if (Math.abs(dot3(d, sg.side)) > HALF_W) return false;
      const v = dot3(d, sg.up);
      return v > -BELOW && v < ABOVE;
    });
    const anyOf = (pts) => pts.some(inside);
    const seg = (a, b, n = 6) => {
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, a[2] + (b[2] - a[2]) * i / n]);
      return pts;
    };
    for (const n of this.nodes.values()) if (inside([n.x, n.y, n.z])) res.nodes++;
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (anyOf(seg([a.x, a.y, a.z], [b.x, b.y, b.z]))) res.tubes++;
    }
    const flaeche = (c) => {
      if (!c) return false;
      const pts = [];
      for (let i = 0; i < 4; i++) pts.push(...seg(c[i], c[(i + 1) % 4], 4));
      pts.push(...seg([(c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2, (c[0][2] + c[3][2]) / 2],
        [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2, (c[1][2] + c[2][2]) / 2], 4));
      return anyOf(pts);
    };
    for (const p of this.panels.values()) if (flaeche(this.panelCorners(p))) res.panels++;
    for (const x of this.textiles.values()) if (flaeche(this.panelCorners(x))) res.textiles++;
    for (const f of this.fittings.values()) {
      if (f.kind === "lattice2") { if (flaeche(this._latticeCorners(f))) res.textiles++; continue; }
      if (inside([f.x, f.y, f.z])) res.fittings++;
    }
    res.total = res.tubes + res.nodes + res.panels + res.textiles + res.fittings;
    return res;
  }

  // Rutsche an einer Montagestelle einhaengen. Feste Groesse: zwei Rasterebenen
  // Fall, drei Felder Auslauf -- der Fuss landet damit auf dem Boden.
  addSlide(hook, normal, kind = "slide-new2", color = null) {
    const drop = SLIDE_DROP + SLIDE_HOOK_LIFT;
    const run = SLIDE_RUN;
    // Kettenteile (Modular-, Bogenrutschen-Koerper) fuehren ihren Punkt am
    // EINSTIEG und eine eigene Drehung -- so wie die Herstellerdateien, und nur
    // so laesst sich das naechste Teil an ihren Ausgang rechnen. Die
    // Integralrutsche behaelt ihren Punkt am Fuss samt Einhaengepunkt.
    const kette = SLIDE_PARTS[kind] && SLIDE_PARTS[kind].chain;
    const slide = kette
      ? {
        id: this._id("s"),
        x: round(hook[0]), y: round(hook[1]), z: round(hook[2]),
        quat: quatFromBasis(cross3([0, 1, 0], normal), [0, 1, 0], normal)
          .map((v) => Math.round(v * 1e4) / 1e4),
        kind, color,
      }
      : {
        id: this._id("s"),
        x: round(hook[0] + normal[0] * run),
        y: round(hook[1] - drop),
        z: round(hook[2] + normal[2] * run),
        hook: [round(hook[0]), round(hook[1]), round(hook[2])],
        // Auch die Integralrutsche merkt sich ihre Richtung: der Einhängepunkt
        // steht nicht in der QDF-Datei, die Drehung schon. Ohne sie stünde die
        // Rutsche nach Export und Import irgendwo -- die Datei führt ihre
        // Laufrichtung 90 Grad gegen den Uhrzeigersinn gedreht (so lesen wir
        // sie auch aus den Herstellerdateien).
        quat: quatFromXAxis([normal[2], 0, -normal[0]]),
        kind, color,
      };
    if (kette && this._slideAt([slide.x, slide.y, slide.z])) return null;
    for (const s of this.slides.values()) {
      if (s.hook && Math.hypot(s.hook[0] - slide.hook[0], s.hook[1] - slide.hook[1], s.hook[2] - slide.hook[2]) < 1) {
        return null; // hier haengt schon eine Rutsche
      }
    }
    this.slides.set(slide.id, slide);
    return slide;
  }

  // Farbe eines Rohrs / einer Platte / eines Netzes setzen (Klick im Bau-Modus
  // mit gewaehlter Farbe). Liefert true, wenn sich die Farbe geaendert hat.
  setColorOf(kind, id, color) {
    const map = kind === "tube" ? this.tubes
      : kind === "panel" ? this.panels
      : kind === "textile" ? this.textiles
      : kind === "slide" ? this.slides
      // Anbauteile nehmen beim Setzen die Baufarbe an -- dann muessen sie sich
      // auch nachtraeglich umfaerben lassen.
      : kind === "fitting" ? this.fittings : null;
    if (!map) return false;
    const el = map.get(id);
    if (!el || el.color === color) return false;
    // Arm-/Link-Kanten (C45-Adapter, Doppelrohr-Verbindung) sind keine echten
    // Rohre und werden nicht eingefaerbt.
    if (kind === "tube" && (el.arm || el.link)) return false;
    // Schwarze Teile bleiben schwarz.
    if (kind === "fitting" && fixedFittingColor(el.kind)) return false;
    el.color = color;
    return true;
  }

  // --- Klemmen (Doppelrohrverbinder) -------------------------------------
  // Eine Klemme sitzt als freier Punkt auf/an einem Rohr und verbindet zwei
  // Rohre laengs (ermoeglicht Klappen, bewegliche und schraege Elemente).
  clampNear(x, y, z) {
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const c of this.clamps.values()) {
      if (dist2(c, { x, y, z }) <= eps2) return c;
    }
    return null;
  }

  addClamp(x, y, z, connectorId = "double_tube") {
    const existing = this.clampNear(x, y, z);
    if (existing) return existing;
    const clamp = { id: this._id("k"), x, y, z, connectorId };
    this.clamps.set(clamp.id, clamp);
    return clamp;
  }

  removeClamp(id) {
    this.clamps.delete(id);
  }

  /**
   * Doppelrohrverbinder um sein Rohr drehen. Standard: 45 Grad (ein Klick).
   * Beliebiger Winkel: `radians` (Bogenmass), Vorzeichen um die Rohrachse.
   *
   * Das zweite Loch wandert auf dem Kreis um das gehaltene Rohr; die zweite
   * Tube und alles, was nur ueber sie (oder eine Platte an ihr) haengt, dreht
   * mit -- eine Klappe um die Achse, oder zwei parallele Klemmen zusammen als
   * Tablett. Das gehaltene Rohr selbst bleibt.
   */
  rotateClamp(id, radians = Math.PI / 4) {
    const c = this.clamps.get(id);
    if (!c || !c.dir || !c.off) return false;
    if (!Number.isFinite(radians) || Math.abs(radians) < 1e-9) return false;
    const u = norm3(c.dir);
    const co = Math.cos(radians), si = Math.sin(radians);
    const no = rodriguesDir(c.off, u, co, si);
    if (this.isBelowGround(c.y + no[1])) return false;

    const flap = this._clampFlap(c);
    const tagged = this._flapNodeAxes(c, flap);
    const hingeAx = { o: [c.x, c.y, c.z], u };
    const frozenBase = new Set();
    for (const cid of flap.clampIds) {
      const k = this.clamps.get(cid);
      const base = k && this._clampBaseTube(k);
      if (base && !flap.second.has(base.id)) frozenBase.add(base.id);
    }
    const axAt = (x, y, z) => {
      if (frozenBase.size <= 1) return hingeAx;
      let best = hingeAx, bestD = Infinity;
      for (const [nid, ax] of tagged) {
        const n = this.nodes.get(nid);
        if (!n) continue;
        const d = (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2;
        if (d < bestD) { bestD = d; best = ax; }
      }
      return best;
    };
    const neu = [];
    for (const [nid, ax] of tagged) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      const p = rodriguesAt([n.x, n.y, n.z], ax.o, ax.u, co, si);
      if (this.isBelowGround(p[1])) return false;
      neu.push({ n, p, ax });
    }
    const clampMove = [];
    for (const cid of flap.clampIds) {
      const k = this.clamps.get(cid);
      if (!k || !k.off || !k.dir) continue;
      const base = this._clampBaseTube(k);
      const frozen = base && frozenBase.has(base.id);
      const ax = frozen ? { o: [k.x, k.y, k.z], u: norm3(k.dir) } : axAt(k.x, k.y, k.z);
      const pos = frozen ? [k.x, k.y, k.z] : rodriguesAt([k.x, k.y, k.z], ax.o, ax.u, co, si);
      const ko = rodriguesDir(k.off, ax.u, co, si);
      const kd = frozen ? k.dir : rodriguesDir(k.dir, ax.u, co, si);
      if (this.isBelowGround(pos[1] + ko[1]) || this.isBelowGround(pos[1])) return false;
      clampMove.push({ k, pos, off: ko, dir: kd });
    }
    const bearingDone = new Set();
    for (const e of neu) if (e.n.bearingOn) bearingDone.add(e.n.bearingOn);
    const extraMove = [];
    for (const f of this.fittings.values()) {
      if (bearingDone.has(f.id)) continue;
      let ax = null;
      for (const [nid, a] of tagged) {
        const n = this.nodes.get(nid);
        if (n && Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z) <= 3) { ax = a; break; }
      }
      if (!ax) continue;
      const p = rodriguesAt([f.x, f.y, f.z], ax.o, ax.u, co, si);
      if (this.isBelowGround(p[1])) return false;
      extraMove.push({ o: f, p, ax, hook: null });
    }
    for (const s of this.slides.values()) {
      let ax = null;
      for (const [nid, a] of tagged) {
        const n = this.nodes.get(nid);
        if (n && Math.hypot(n.x - s.x, n.y - s.y, n.z - s.z) <= 3) { ax = a; break; }
      }
      if (!ax) continue;
      const p = rodriguesAt([s.x, s.y, s.z], ax.o, ax.u, co, si);
      if (this.isBelowGround(p[1])) return false;
      const hook = s.hook ? rodriguesAt(s.hook, ax.o, ax.u, co, si) : null;
      extraMove.push({ o: s, p, ax, hook });
    }

    for (const e of neu) {
      e.n.x = round(e.p[0]); e.n.y = round(e.p[1]); e.n.z = round(e.p[2]);
      this._spinNodeAround(e.n, e.ax, co, si, radians);
    }
    const moved = new Set(neu.map((e) => e.n.id));
    for (const e of clampMove) {
      e.k.x = round(e.pos[0]); e.k.y = round(e.pos[1]); e.k.z = round(e.pos[2]);
      const len = Math.hypot(e.k.off[0], e.k.off[1], e.k.off[2]) || 1;
      const d = norm3(e.off);
      e.k.off = [round(d[0] * len), round(d[1] * len), round(d[2] * len)];
      e.k.dir = [round4(e.dir[0]), round4(e.dir[1]), round4(e.dir[2])];
    }
    for (const e of extraMove) {
      e.o.x = round(e.p[0]); e.o.y = round(e.p[1]); e.o.z = round(e.p[2]);
      e.o.quat = spinAroundAxis(e.o.quat && e.o.quat.length === 4 ? e.o.quat : [0, 0, 0, 1], e.ax.u, radians);
      if (e.hook) e.o.hook = [round(e.hook[0]), round(e.hook[1]), round(e.hook[2])];
    }
    this._moveTubeGeom(moved);
    this._movePanelGeom(moved);
    return true;
  }

  /** Ausrichtung eines Knotens um Achse `ax.u` mitdrehen (Stutzen, Quaternion). */
  _spinNodeAround(n, ax, co, si, radians) {
    const spin = (v) => {
      if (!v || v.length !== 3) return v;
      const d = rodriguesDir(v, ax.u, co, si);
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      return [round4(d[0] / L), round4(d[1] / L), round4(d[2] / L)];
    };
    if (n.stub) n.stub = spin(n.stub);
    if (n.c45axis) n.c45axis = spin(n.c45axis);
    if (n.arms) n.arms = n.arms.map(spin);
    if (n.armDirs) n.armDirs = n.armDirs.map((a) => {
      const vec = spin(a.vec || a);
      return a.vec ? { name: a.name, vec } : vec;
    });
    n.quat = spinAroundAxis(n.quat && n.quat.length === 4 ? n.quat : [0, 0, 0, 1], ax.u, radians);
    if (n.c45quat) n.c45quat = spinAroundAxis(n.c45quat, ax.u, radians);
    if (n.partQuat) n.partQuat = spinAroundAxis(n.partQuat, ax.u, radians);
    if (n.bearingOn) {
      const f = this.fittings.get(n.bearingOn);
      if (f) {
        const p = rodriguesAt([f.x, f.y, f.z], ax.o, ax.u, co, si);
        f.x = round(p[0]); f.y = round(p[1]); f.z = round(p[2]);
        f.quat = spinAroundAxis(f.quat && f.quat.length === 4 ? f.quat : [0, 0, 0, 1], ax.u, radians);
      }
    }
  }

  /**
   * Zweites Loch auf eine gegebene Querrichtung drehen (Laenge von `off`
   * bleibt). `dir` muss nicht senkrecht sein -- der Laengsanteil faellt weg.
   */
  setClampOffDir(id, dir) {
    const c = this.clamps.get(id);
    if (!c || !c.dir || !c.off || !dir) return false;
    const u = norm3(c.dir);
    const along = dot3(dir, u);
    let q = [dir[0] - u[0] * along, dir[1] - u[1] * along, dir[2] - u[2] * along];
    const L = Math.hypot(q[0], q[1], q[2]);
    if (L < 1e-6) return false;
    q = [q[0] / L, q[1] / L, q[2] / L];
    const cur = norm3(c.off);
    return this.rotateClamp(id, signedAngleAround(cur, q, u));
  }

  /** Tube, deren Achse durch `point` laeuft und zu `dir` parallel ist. */
  _clampTubeAt(point, dir, maxDist = 3) {
    if (!dir) return null;
    const u = norm3(dir);
    let best = null, bestD = maxDist;
    for (const t of this.tubes.values()) {
      const rail = this._rail(t.id);
      if (!rail) continue;
      if (Math.abs(dot3(rail.dir, u)) < 0.9) continue;
      const rel = [point[0] - rail.p0[0], point[1] - rail.p0[1], point[2] - rail.p0[2]];
      const s = Math.max(0, Math.min(rail.len, dot3(rel, rail.dir)));
      const cp = [rail.p0[0] + rail.dir[0] * s, rail.p0[1] + rail.dir[1] * s, rail.p0[2] + rail.dir[2] * s];
      const d = Math.hypot(point[0] - cp[0], point[1] - cp[1], point[2] - cp[2]);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  _clampBaseTube(c) { return c ? this._clampTubeAt([c.x, c.y, c.z], c.dir) : null; }
  _clampSecondTube(c) {
    if (!c || !c.off) return null;
    return this._clampTubeAt([c.x + c.off[0], c.y + c.off[1], c.z + c.off[2]], c.dir);
  }

  /**
   * Klemmen, die zusammen eine Klappe bilden: dieselbe gehaltene Tube, oder
   * zweite Tubes, die ueber eine Platte/ein Netz verbunden sind.
   *
   * Schwestern auf demselben Rohr kommen nur mit, wenn sie selbst eine zweite
   * Tube halten -- eine leere Klemme daneben ist ein eigener Winkel, nicht
   * dieselbe Klappe.
   */
  _clampFlap(c) {
    const clampIds = new Set([c.id]);
    const base0 = this._clampBaseTube(c);
    if (base0) {
      for (const o of this.clamps.values()) {
        if (o.id === c.id) continue;
        const b = this._clampBaseTube(o);
        if (b && b.id === base0.id && this._clampSecondTube(o)) clampIds.add(o.id);
      }
    }
    const bases = new Set();
    const second = new Set();
    const note = (k) => {
      if (!k) return;
      const b = this._clampBaseTube(k);
      if (b) bases.add(b.id);
      const t = this._clampSecondTube(k);
      if (t) second.add(t.id);
    };
    for (const id of clampIds) note(this.clamps.get(id));
    let grow = true;
    while (grow) {
      grow = false;
      for (const map of [this.panels, this.textiles]) {
        for (const p of map.values()) {
          const a = second.has(p.a), bHas = second.has(p.b);
          if (a === bHas) continue;
          const other = a ? p.b : p.a;
          if (bases.has(other) || second.has(other)) continue;
          second.add(other);
          grow = true;
        }
      }
      for (const o of this.clamps.values()) {
        if (clampIds.has(o.id)) continue;
        const t = this._clampSecondTube(o);
        const b = this._clampBaseTube(o);
        // Auch Klemmen AUF einer schon mitdrehenden Tube (nicht nur solche,
        // deren zweite Tube schon in der Klappe ist) -- sonst bleibt alles,
        // was man an der zweiten Tube weitergebaut hat, stehen und die Rohre
        // werden schief.
        if ((t && second.has(t.id)) || (b && second.has(b.id))) {
          clampIds.add(o.id);
          note(o);
          grow = true;
        }
      }
      const baseNodes = new Set();
      for (const id of bases) {
        if (second.has(id)) continue;
        const t = this.tubes.get(id);
        if (t) { baseNodes.add(t.a); baseNodes.add(t.b); }
      }
      const seenN = new Set();
      const stack = [];
      const pushN = (nid) => {
        if (!nid || baseNodes.has(nid) || seenN.has(nid)) return;
        seenN.add(nid);
        stack.push(nid);
      };
      for (const tid of second) {
        const t = this.tubes.get(tid);
        if (!t) continue;
        pushN(t.a);
        pushN(t.b);
      }
      for (const n of this.nodes.values()) {
        if (n.clampOn && second.has(n.clampOn.tubeId)) pushN(n.id);
      }
      while (stack.length) {
        const id = stack.pop();
        for (const t of this.tubes.values()) {
          const other = t.a === id ? t.b : t.b === id ? t.a : null;
          if (other == null || baseNodes.has(other)) continue;
          if (!second.has(t.id)) { second.add(t.id); grow = true; }
          pushN(other);
        }
        for (const n of this.nodes.values()) {
          const t = n.clampOn && this.tubes.get(n.clampOn.tubeId);
          if (!t) continue;
          if (t.a === id || t.b === id || second.has(t.id)) pushN(n.id);
        }
      }
    }
    return { clampIds, second };
  }

  /** Auswahl-Gruppe: die Klemme plus Schwestern mit zweiter Tube, und jene Tubes. */
  clampCohort(id) {
    const c = this.clamps.get(id);
    if (!c) return { clamps: new Set(), tubes: new Set() };
    const flap = this._clampFlap(c);
    return { clamps: flap.clampIds, tubes: new Set(flap.second) };
  }

  /**
   * Zweite Tube (und die Klappe) parallel zur gehaltenen Tube verschieben.
   * `delta` ist der Weg entlang `c.dir`. Die Klemmen bleiben stehen -- das
   * zweite Rohr gleitet durch ihr Loch. `snapDist` > 0: Enden der zweiten
   * Tube ziehen an die der ersten.
   */
  slideClampFlap(id, delta, { snapDist = 0 } = {}) {
    const c = this.clamps.get(id);
    if (!c || !c.dir || !Number.isFinite(delta)) return false;
    const u = norm3(c.dir);
    const flap = this._clampFlap(c);
    const tagged = this._flapNodeAxes(c, flap);
    if (!flap.second.size && !tagged.size) {
      // Leere Klemme: nur sie selbst gleitet auf dem Rohr.
      let d = this._snapSlideDelta(c, flap, tagged, u, delta, snapDist);
      d = this._limitSlideDelta(flap, u, d);
      if (Math.abs(d) < 1e-6) return false;
      const p = [c.x + u[0] * d, c.y + u[1] * d, c.z + u[2] * d];
      if (this.isBelowGround(p[1])) return false;
      c.x = round(p[0]); c.y = round(p[1]); c.z = round(p[2]);
      this._reseatClamp(c);
      return true;
    }
    let d = this._snapSlideDelta(c, flap, tagged, u, delta, snapDist);
    d = this._limitSlideDelta(flap, u, d);
    if (Math.abs(d) < 1e-6) return false;
    const vec = [u[0] * d, u[1] * d, u[2] * d];
    for (const nid of tagged.keys()) {
      const n = this.nodes.get(nid);
      if (n && this.isBelowGround(n.y + vec[1])) return false;
    }
    const moved = new Set();
    for (const nid of tagged.keys()) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      n.x = round(n.x + vec[0]); n.y = round(n.y + vec[1]); n.z = round(n.z + vec[2]);
      moved.add(n.id);
    }
    for (const cid of flap.clampIds) {
      const k = this.clamps.get(cid);
      const base = k && this._clampBaseTube(k);
      if (!k || !base || !flap.second.has(base.id)) continue;
      k.x = round(k.x + vec[0]); k.y = round(k.y + vec[1]); k.z = round(k.z + vec[2]);
    }
    this._moveTubeGeom(moved, vec);
    this._movePanelGeom(moved, vec);
    return true;
  }

  _reseatClamp(k) {
    const base = this._clampBaseTube(k);
    if (!base) return;
    const rail = this._rail(base.id);
    if (!rail) return;
    const rel = [k.x - rail.p0[0], k.y - rail.p0[1], k.z - rail.p0[2]];
    const s = Math.max(0, Math.min(rail.len, dot3(rel, rail.dir)));
    k.x = round(rail.p0[0] + rail.dir[0] * s);
    k.y = round(rail.p0[1] + rail.dir[1] * s);
    k.z = round(rail.p0[2] + rail.dir[2] * s);
  }

  _limitSlideDelta(flap, u, d) {
    let lo = -Infinity, hi = Infinity;
    let anyHole = false;
    for (const cid of flap.clampIds) {
      const k = this.clamps.get(cid);
      const sec = k && this._clampSecondTube(k);
      const rail = sec && this._rail(sec.id);
      if (!k || !k.off || !rail) continue;
      anyHole = true;
      const hole = [k.x + k.off[0], k.y + k.off[1], k.z + k.off[2]];
      const sHole = dot3([hole[0] - rail.p0[0], hole[1] - rail.p0[1], hole[2] - rail.p0[2]], rail.dir);
      const sign = dot3(rail.dir, u) >= 0 ? 1 : -1;
      if (sign > 0) {
        lo = Math.max(lo, sHole - rail.len);
        hi = Math.min(hi, sHole);
      } else {
        lo = Math.max(lo, -sHole);
        hi = Math.min(hi, rail.len - sHole);
      }
    }
    if (!anyHole) {
      for (const cid of flap.clampIds) {
        const k = this.clamps.get(cid);
        const base = k && this._clampBaseTube(k);
        const rail = base && this._rail(base.id);
        if (!k || !rail) continue;
        const sign = dot3(rail.dir, u) >= 0 ? 1 : -1;
        const s = dot3([k.x - rail.p0[0], k.y - rail.p0[1], k.z - rail.p0[2]], rail.dir);
        if (sign > 0) {
          lo = Math.max(lo, -s);
          hi = Math.min(hi, rail.len - s);
        } else {
          lo = Math.max(lo, s - rail.len);
          hi = Math.min(hi, s);
        }
      }
    }
    if (!(lo <= hi)) return 0;
    if (d < lo) return lo;
    if (d > hi) return hi;
    return d;
  }

  _snapSlideDelta(c, flap, tagged, u, d, snapDist) {
    if (!(snapDist > 0) || !tagged.size) return d;
    const origin = [c.x, c.y, c.z];
    const anchors = [];
    const seen = new Set();
    for (const cid of flap.clampIds) {
      const base = this._clampBaseTube(this.clamps.get(cid));
      if (!base || seen.has(base.id)) continue;
      seen.add(base.id);
      const t = this.tubes.get(base.id);
      if (!t) continue;
      for (const nid of [t.a, t.b]) {
        const n = this.nodes.get(nid);
        if (n) anchors.push(dot3([n.x - origin[0], n.y - origin[1], n.z - origin[2]], u));
      }
    }
    if (!anchors.length) return d;
    let best = d, bestErr = snapDist;
    for (const nid of tagged.keys()) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      const s0 = dot3([n.x - origin[0], n.y - origin[1], n.z - origin[2]], u);
      for (const a of anchors) {
        const need = a - s0;
        // Schon bündig: nicht festkleben, sonst kommt man mit einem Rasterschritt
        // nicht mehr vom Ende weg.
        if (Math.abs(need) < 1e-6) continue;
        const err = Math.abs(need - d);
        if (err < bestErr - 1e-6) { bestErr = err; best = need; }
      }
    }
    return best;
  }

  /**
   * Welche Knoten sich mitdrehen, und um welche Achse. Alles, was an der
   * zweiten Tube haengt -- Rohre, Kupplungen, Klemm-Kupplungen -- kreist als
   * ein starres Stueck um die Scharnierachse. Die gehaltene Tube bleibt.
   */
  _flapNodeAxes(driven, flap) {
    const hingeAx = { o: [driven.x, driven.y, driven.z], u: norm3(driven.dir) };
    const frozenTubes = new Set();
    const hingeOf = new Map();
    for (const cid of flap.clampIds) {
      const k = this.clamps.get(cid);
      if (!k || !k.dir) continue;
      const ax = { o: [k.x, k.y, k.z], u: norm3(k.dir) };
      const base = this._clampBaseTube(k);
      const sec = this._clampSecondTube(k);
      if (base && !flap.second.has(base.id)) {
        frozenTubes.add(base.id);
        if (sec) hingeOf.set(sec.id, ax);
      }
    }
    const fence = new Set();
    for (const id of frozenTubes) {
      const t = this.tubes.get(id);
      if (t) { fence.add(t.a); fence.add(t.b); }
    }
    const adj = this._nodeAdj();
    const tagged = new Map();
    const stack = [];
    const seed = (nid, ax) => {
      if (!nid || fence.has(nid) || tagged.has(nid) || !this.nodes.has(nid)) return;
      tagged.set(nid, ax);
      stack.push(nid);
    };
    for (const tid of flap.second) {
      const t = this.tubes.get(tid);
      if (!t) continue;
      const ax = hingeOf.get(tid) || hingeAx;
      seed(t.a, ax);
      seed(t.b, ax);
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (a && b) {
        for (const n of this.nodes.values()) {
          if (fence.has(n.id) || tagged.has(n.id)) continue;
          if (distPointToSeg(n.x, n.y, n.z, a, b) <= 1.2) seed(n.id, ax);
        }
      }
    }
    for (const n of this.nodes.values()) {
      if (n.clampOn && flap.second.has(n.clampOn.tubeId)) {
        seed(n.id, hingeOf.get(n.clampOn.tubeId) || hingeAx);
      }
    }
    while (stack.length) {
      const id = stack.pop();
      const ax = tagged.get(id);
      for (const other of adj.get(id) || []) seed(other, ax);
    }
    if (frozenTubes.size <= 1) {
      for (const nid of [...tagged.keys()]) tagged.set(nid, hingeAx);
    }
    return tagged;
  }

  _nodeAdj() {
    const adj = new Map();
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    for (const t of this.tubes.values()) link(t.a, t.b);
    for (const n of this.nodes.values()) {
      const t = n.clampOn && this.tubes.get(n.clampOn.tubeId);
      if (t) { link(n.id, t.a); link(n.id, t.b); }
    }
    return adj;
  }

  // Klemm-Kupplungen haengen an ihrem umschlossenen Rohr: faellt es weg,
  // faellt die Kupplung mit (und mit ihr, was an ihr steckt).
  _pruneClamps() {
    for (const n of [...this.nodes.values()]) {
      if (n.clampOn && !this.tubes.has(n.clampOn.tubeId)) this.removeNode(n.id);
    }
  }

  // Platten und Netze haengen an ihren beiden Tragrohren: faellt eines weg,
  // faellt die Platte mit.
  _prunePanels() {
    for (const map of [this.panels, this.textiles]) {
      for (const p of [...map.values()]) {
        if (!this._rail(p.a) || !this._rail(p.b)) map.delete(p.id);
      }
    }
  }

  // Schlaegt Rohre vor, die ein Holz-Profil gebrauchen koennten:
  // Alle waagerechten und schraegen Rohre, bei denen mindestens ein erhoehter
  // Endknoten keine senkrechte Stuetze nach unten hat (frei tragend, Kragarm,
  // Diagonale mit ungestuetzter Kupplung).  Senkrechte Rohre und Rohre auf
  // Bodenebene werden ausgeschlossen.  Liefert ein Set von Rohr-IDs.
  /**
   * Traegt etwas den Auslauf dieser Rutsche? Boden, eine Kupplung oder ein Rohr
   * unter dem Fuss zaehlen. Ohne Auflage braucht die Rutsche eine Stuetze --
   * genau darauf weist der Verstaerkungs-Vorschlag hin.
   */
  slideRests(sl) {
    const groundY = this._groundLevel();
    if (sl.y - groundY < 1) return true;
    for (const n of this.nodes.values()) {
      if (Math.hypot(n.x - sl.x, n.y - sl.y, n.z - sl.z) <= SLIDE_SUPPORT) return true;
    }
    // Auch mitten auf einem Rohr liegt der Auslauf auf.
    for (const t of this.tubes.values()) {
      if (t.arm || t.link) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (len2 < 1e-6) continue;
      let u = ((sl.x - a.x) * d[0] + (sl.y - a.y) * d[1] + (sl.z - a.z) * d[2]) / len2;
      u = Math.max(0, Math.min(1, u));
      const p = [a.x + d[0] * u, a.y + d[1] * u, a.z + d[2] * u];
      if (Math.hypot(sl.x - p[0], sl.y - p[1], sl.z - p[2]) <= SLIDE_SUPPORT) return true;
    }
    return false;
  }

  reinforcementSuggestions() {
    const out = new Set();
    // Rutschen ohne Auflage brauchen eine Stuetze.
    for (const sl of this.slides.values()) if (!this.slideRests(sl)) out.add(sl.id);
    let minY = Infinity;
    for (const n of this.nodes.values()) if (n.y < minY) minY = n.y;
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      // Senkrechte Rohre benoetigen kein Laengsprofil.
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5) continue;
      // Beide Knoten auf Bodenebene: keine Notwenigkeit.
      if (a.y - minY < 0.5 && b.y - minY < 0.5) continue;
      // Vorschlag wenn mindestens ein erhoehter Knoten ungestuetzt ist.
      const aUnsupported = a.y - minY > 0.5 && !this._supportedFromBelow(a);
      const bUnsupported = b.y - minY > 0.5 && !this._supportedFromBelow(b);
      if (aUnsupported || bUnsupported) out.add(t.id);
    }
    return out;
  }

  // Alle Rohre, die sich mit einem anderen ueberlagern -- kollineare Ueberdeckung
  // (zwei Rohre auf derselben Achse) oder Kreuzung im Rohrinneren. Genau die
  // beiden Faelle, die tubeCollision() beim Bauen verhindert; importierte oder
  // aeltere Modelle koennen sie trotzdem enthalten.
  // Arm-/Link-Kanten sind keine Rohre. Boegen bleiben aussen vor: gespeichert ist
  // ihre Sehne, nicht der Bogen -- ein Test darauf meldet Falschtreffer.
  // --- Verschieben --------------------------------------------------------
  /**
   * Welche Teile haengen an den Auswahl-Eintraegen? Rohre und Platten haben
   * keine eigene Position -- sie folgen ihren Kupplungen, also werden deren
   * Knoten verschoben. Klemmen und Rutschen sitzen frei und bewegen sich
   * selbst.
   * sel: Map id -> kind (wie builder.selection).
   */
  moveTargets(sel) {
    const nodes = new Set(), clamps = new Set(), slides = new Set(), fittings = new Set();
    const addNodes = (list) => { for (const id of list || []) if (this.nodes.has(id)) nodes.add(id); };
    for (const [id, kind] of sel) {
      if (kind === "node") { if (this.nodes.has(id)) nodes.add(id); }
      else if (kind === "tube") { const t = this.tubes.get(id); if (t) addNodes([t.a, t.b]); }
      // Platten und Netze haengen an zwei Rohren -- verschoben werden deren Knoten.
      else if (kind === "panel" || kind === "textile") {
        const p = (kind === "panel" ? this.panels : this.textiles).get(id);
        for (const tid of p ? [p.a, p.b] : []) {
          const t = this.tubes.get(tid);
          if (t) addNodes([t.a, t.b]);
        }
      }
      else if (kind === "clamp") { if (this.clamps.has(id)) clamps.add(id); }
      else if (kind === "slide") { if (this.slides.has(id)) slides.add(id); }
      else if (kind === "fitting") { if (this.fittings.has(id)) fittings.add(id); }
    }
    return { nodes, clamps, slides, fittings };
  }

  /**
   * Vom angeklickten Teil aus: alles, was ueber Rohre / Adapter / Klemmen
   * zusammenhaengt. Zwei getrennte Aufbauten bleiben zwei Bloecke.
   * extra.hinge / extra.tubes kommen vom Treffer (Scharnier, Verstaerkungsprofil).
   */
  connectedSelection(seedId, seedKind, extra = {}) {
    let id = seedId, kind = seedKind;
    if (kind === "node" && extra.hinge != null) {
      id = hingeKey(seedId, extra.hinge);
      kind = "hinge";
    }
    if (Array.isArray(extra.tubes) && extra.tubes.length) {
      id = extra.tubes[0];
      kind = "tube";
    }
    const seed = this._seedNodesFor(id, kind);
    if (!seed.size) {
      const solo = new Map();
      if (id != null && kind) solo.set(id, kind);
      return solo;
    }
    return this._selectionOnNodes(this._floodNodes(seed));
  }

  _seedNodesFor(id, kind) {
    const out = new Set();
    const addTube = (tid) => {
      const t = this.tubes.get(tid);
      if (t) { out.add(t.a); out.add(t.b); }
    };
    const addNear = (x, y, z, r) => {
      for (const nid of this._nodesNearPoint(x, y, z, r)) out.add(nid);
    };
    if (kind === "node") {
      if (this.nodes.has(id)) out.add(id);
    } else if (kind === "hinge") {
      const sp = splitHingeKey(id);
      if (sp && this.nodes.has(sp.nodeId)) out.add(sp.nodeId);
    } else if (kind === "tube") {
      addTube(id);
    } else if (kind === "panel" || kind === "textile") {
      const p = (kind === "panel" ? this.panels : this.textiles).get(id);
      if (p) { addTube(p.a); addTube(p.b); }
    } else if (kind === "clamp") {
      const c = this.clamps.get(id);
      if (c) addNear(c.x, c.y, c.z, 12);
    } else if (kind === "fitting") {
      const f = this.fittings.get(id);
      if (f) {
        for (const n of this.nodes.values()) if (n.bearingOn === id) out.add(n.id);
        const reach = POOL_KINDS.has(f.kind)
          ? Math.max(50, Math.hypot(f.w || 0, f.h || 0, f.d || 0) / 2 + 25)
          : 16;
        addNear(f.x, f.y, f.z, reach);
      }
    } else if (kind === "slide") {
      for (const sid of this._slideChainIds(id)) {
        const s = this.slides.get(sid);
        if (!s) continue;
        addNear(s.x, s.y, s.z, 22);
        if (s.hook) addNear(s.hook[0], s.hook[1], s.hook[2], 16);
        const ent = this.slideEntry(s);
        if (ent) addNear(ent.x, ent.y, ent.z, 16);
      }
    }
    return out;
  }

  _nodesNearPoint(x, y, z, maxDist) {
    const out = new Set();
    const max2 = maxDist * maxDist;
    for (const n of this.nodes.values()) {
      if (dist2(n, { x, y, z }) <= max2) out.add(n.id);
    }
    for (const t of this.tubes.values()) {
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      if (distPointToSeg(x, y, z, a, b) <= maxDist) { out.add(t.a); out.add(t.b); }
    }
    return out;
  }

  _floodNodes(start) {
    const adj = this._nodeAdj();
    const seen = new Set();
    const q = [];
    for (const id of start) {
      if (!this.nodes.has(id) || seen.has(id)) continue;
      seen.add(id);
      q.push(id);
    }
    for (let i = 0; i < q.length; i++) {
      for (const nb of adj.get(q[i]) || []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        q.push(nb);
      }
    }
    return seen;
  }

  _slideChainIds(startId) {
    const ids = new Set();
    if (!this.slides.has(startId)) return ids;
    const close = (p, s) => p && Math.hypot(p[0] - s.x, p[1] - s.y, p[2] - s.z) < 8;
    const linked = (a, b) => {
      const ea = this.slideExit(a), eb = this.slideExit(b);
      return (ea && close(ea.pos, b)) || (eb && close(eb.pos, a));
    };
    const q = [startId];
    ids.add(startId);
    for (let i = 0; i < q.length; i++) {
      const cur = this.slides.get(q[i]);
      for (const s of this.slides.values()) {
        if (ids.has(s.id) || !linked(cur, s)) continue;
        ids.add(s.id);
        q.push(s.id);
      }
    }
    return ids;
  }

  _pointOnIsland(x, y, z, nodes, tubeIds, nodeReach, tubeReach) {
    for (const id of nodes) {
      const n = this.nodes.get(id);
      if (n && Math.hypot(n.x - x, n.y - y, n.z - z) <= nodeReach) return true;
    }
    for (const tid of tubeIds) {
      const t = this.tubes.get(tid);
      const a = t && this.nodes.get(t.a), b = t && this.nodes.get(t.b);
      if (a && b && distPointToSeg(x, y, z, a, b) <= tubeReach) return true;
    }
    return false;
  }

  _selectionOnNodes(nodes) {
    const sel = new Map();
    for (const id of nodes) {
      const n = this.nodes.get(id);
      if (!n) continue;
      sel.set(id, "node");
      if (n.hinges && n.hinges.length) {
        for (let i = 0; i < n.hinges.length; i++) sel.set(hingeKey(id, i), "hinge");
      }
      if (n.bearingOn && this.fittings.has(n.bearingOn)) sel.set(n.bearingOn, "fitting");
    }
    const tubeIds = new Set();
    for (const t of this.tubes.values()) {
      if (nodes.has(t.a) && nodes.has(t.b)) {
        sel.set(t.id, "tube");
        tubeIds.add(t.id);
      }
    }
    for (const [map, kind] of [[this.panels, "panel"], [this.textiles, "textile"]]) {
      for (const p of map.values()) {
        if (tubeIds.has(p.a) && tubeIds.has(p.b)) sel.set(p.id, kind);
      }
    }
    for (const c of this.clamps.values()) {
      if (this._pointOnIsland(c.x, c.y, c.z, nodes, tubeIds, 12, 8)) sel.set(c.id, "clamp");
    }
    for (const f of this.fittings.values()) {
      if (sel.has(f.id)) continue;
      const nodeReach = POOL_KINDS.has(f.kind)
        ? Math.max(50, Math.hypot(f.w || 0, f.h || 0, f.d || 0) / 2 + 25)
        : 16;
      if (this._pointOnIsland(f.x, f.y, f.z, nodes, tubeIds, nodeReach, 8)) sel.set(f.id, "fitting");
    }
    const slideHit = new Set();
    for (const s of this.slides.values()) {
      const ent = this.slideEntry(s);
      if (this._pointOnIsland(s.x, s.y, s.z, nodes, tubeIds, 22, 10)
          || (s.hook && this._pointOnIsland(s.hook[0], s.hook[1], s.hook[2], nodes, tubeIds, 16, 10))
          || (ent && this._pointOnIsland(ent.x, ent.y, ent.z, nodes, tubeIds, 16, 10))) {
        for (const sid of this._slideChainIds(s.id)) slideHit.add(sid);
      }
    }
    for (const sid of slideHit) sel.set(sid, "slide");
    return sel;
  }

  // --- Kopieren und Einfuegen ---------------------------------------------

  /**
   * Bausatz fuer ein Baellebad: der Rahmen aus Rohren und Kupplungen und die
   * Folie darin. Geliefert wird ein FRAGMENT wie beim Kopieren -- der Builder
   * haengt es an den Zeiger und setzt es mit einem Klick ab.
   *
   * Der Rahmen ist das Mindeste, was die Folie braucht: ein Rechteck aus Rohren
   * unten und oben, dazwischen an jeder Ecke und jedem Zwischenpunkt ein
   * senkrechter Pfosten. Eine Seite wird mit 75er-Rohren geteilt, wenn ihre
   * Laenge durch 80 cm aufgeht (der XXL-Pool ist in der Laenge genau
   * 3 x 75 cm), sonst mit 35ern -- so baut es auch die Herstellersoftware in
   * ihren Beispielmodellen ("Pool groß": Langseite 2 x 75, Breitseite 3 x 35).
   *
   * `tubeFor(spannweite)` liefert das Rohr zu einem Kupplungsabstand, `color`
   * die Farbe je Rohr (Zeichenkette oder Funktion); der Katalog gehoert nicht
   * hierher (siehe Trennung in CLAUDE.md).
   */
  poolFragment(spec, { color = "blue", tubeFor } = {}) {
    // `color` darf eine Funktion sein: das Baellebad wird Rohr fuer Rohr
    // eingefaerbt, so bunt wie das echte Teil.
    const farbe = typeof color === "function" ? color : () => color;
    if (!spec || typeof tubeFor !== "function") return null;
    const { w, d, h } = spec;
    // Seite in Abschnitte teilen. In der LAENGE zaehlt jedes 75er-Rohr, das
    // hineingeht: der S-Pool ist 75 + 35, der L 2 x 75, der XXL 3 x 75. Quer
    // dazu stehen 35er -- so baut es auch die Herstellersoftware (Beispiel
    // "Pool groß": Langseite 2 x 75, Breitseite 3 x 35).
    const abschnitte = (L, schritte) => {
      const out = [];
      let s = 0;
      for (const schritt of schritte) {
        while (L - s >= schritt) { out.push([s, s + schritt]); s += schritt; }
      }
      if (s < L) out.push([s, L]);
      return out;
    };
    // Die Breitseiten bekommen 35er -- auch die 80 cm breite Seite, die
    // rechnerisch in ein 75er passen wuerde. EINE Ausnahme steht im Bausatz:
    // beim S-Pool ist die hintere Breitseite ein einziges 75er (`querHinten`).
    const xTeile = abschnitte(w, [40]);
    const xHinten = spec.querHinten
      ? spec.querHinten.map((len, i, alle) => {
        const s = alle.slice(0, i).reduce((sum, v) => sum + v, 0);
        return [s, s + len];
      })
      : xTeile;
    // Ein 75er kommt nur in eine Seite, die LAENGER als 80 cm ist: das
    // quadratische XS-Becken misst rundherum 80 und besteht rundherum aus
    // 35ern, je zwei pro Seite.
    const zTeile = abschnitte(d, d > 80 ? [80, 40] : [40]);
    const xPos = [0, ...xTeile.map(([, b]) => b)];
    const xPosHinten = [0, ...xHinten.map(([, b]) => b)];
    // Die beiden Laengsseiten laufen VERSETZT gegeneinander: auf der einen
    // kommt erst das lange Rohr, auf der anderen erst das kurze. So liegen die
    // Stoesse nicht auf einer Linie gegenueber -- beim S-Pool also 75 + 35
    // links und 35 + 75 rechts. Bei gleich langen Abschnitten aendert das
    // nichts.
    const zLinks = [0, ...zTeile.map(([, b]) => b)];
    const zRechts = zLinks.map((z) => d - z).reverse();
    // Umlaufende Punkte des Rechtecks, im Kreis herum und ohne Doppelte.
    const rund = [];
    for (const x of xPos) rund.push([x, 0]);
    for (const z of zRechts.slice(1)) rund.push([w, z]);
    for (const x of xPosHinten.slice(0, -1).reverse()) rund.push([x, d]);
    for (const z of zLinks.slice(1, -1).reverse()) rund.push([0, z]);

    const nodes = [], tubes = [];
    const idOf = (i, oben) => `pn${i}${oben ? "o" : "u"}`;
    rund.forEach(([x, z], i) => {
      nodes.push({ id: idOf(i, false), x, y: 0, z });
      nodes.push({ id: idOf(i, true), x, y: h, z });
    });
    let lauf = 0;
    const rohr = (a, b, span) => {
      const teil = tubeFor(span);
      if (!teil) return;
      tubes.push({ id: `pt${lauf++}`, a, b, tubeId: teil.id, color: farbe(), length: teil.length_cm });
    };
    // Die beiden Ringe -- unten und oben um das ganze Becken.
    for (let i = 0; i < rund.length; i++) {
      const j = (i + 1) % rund.length;
      const span = Math.round(Math.hypot(rund[j][0] - rund[i][0], rund[j][1] - rund[i][1]));
      for (const oben of [false, true]) rohr(idOf(i, oben), idOf(j, oben), span);
    }
    // Pfosten an jedem Punkt des Rings.
    for (let i = 0; i < rund.length; i++) rohr(idOf(i, false), idOf(i, true), h);

    // Die Folie: ihr Bezugspunkt ist die Oberkante der Frontwand, also die
    // Mitte der vorderen Breitseite; von dort geht es `d` in die Tiefe.
    const fittings = [{
      id: "pf0", kind: spec.kind, x: round(w / 2), y: h, z: 0,
      // Die Folie gibt es nur in Blau -- die Baufarbe gilt nur fuer den Rahmen.
      quat: [0, 0, 0, 1], color: fixedFittingColor(spec.kind) || farbe(), w, h, d,
    }];
    return { anchor: [0, 0, 0], nodes, tubes, panels: [], textiles: [], clamps: [], slides: [], fittings };
  }

  /**
   * Offene Rechtecke, in die eine Poolfolie der gegebenen Groesse haengt.
   * Gemessen wird der OBERE Ring: vier Ecken im Abstand `w` x `d` (oder gedreht),
   * die Kanten mit Rohren belegt, innen keine Kupplung. Die Folie sitzt an der
   * Oberkante der Frontwand -- derselbe Bezug wie in poolFragment.
   */
  poolLinerMounts(spec, opts = {}) {
    if (!spec) return [];
    const all = this._poolLinerOpenings(spec);
    if (opts.includeTaken) return all;
    return all.filter((m) => !this._poolOpeningTaken(m));
  }

  addPoolLiner(mount) {
    if (!mount || !POOL_KINDS.has(mount.kind)) return null;
    if (this._poolOpeningTaken(mount)) return null;
    return this.addFitting(mount.kind, mount.pos[0], mount.pos[1], mount.pos[2], {
      quat: mount.quat || [0, 0, 0, 1],
      color: fixedFittingColor(mount.kind) || "blue",
      w: mount.w, h: mount.h, d: mount.d,
    });
  }

  _poolLinerOpenings(spec) {
    const w = spec.w, d = spec.d, h = spec.h, kind = spec.kind;
    const tol = 2.5;
    const out = [];
    const seen = new Set();
    const byY = new Map();
    for (const n of this.nodes.values()) {
      if (n.unused) continue;
      const y = Math.round(n.y);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(n);
    }
    const near = (nodes, x, z) => nodes.find((n) => Math.abs(n.x - x) <= tol && Math.abs(n.z - z) <= tol);
    for (const [y, nodes] of byY) {
      const xs = [...new Set(nodes.map((n) => round(n.x)))].sort((a, b) => a - b);
      const zs = [...new Set(nodes.map((n) => round(n.z)))].sort((a, b) => a - b);
      for (const x0 of xs) {
        for (const z0 of zs) {
          for (const [sx, sz, rotated] of [[w, d, false], [d, w, true]]) {
            const c0 = near(nodes, x0, z0);
            const c1 = near(nodes, x0 + sx, z0);
            const c2 = near(nodes, x0 + sx, z0 + sz);
            const c3 = near(nodes, x0, z0 + sz);
            if (!c0 || !c1 || !c2 || !c3) continue;
            if (!this._axisEdgeCovered(c0, c1) || !this._axisEdgeCovered(c1, c2)
              || !this._axisEdgeCovered(c2, c3) || !this._axisEdgeCovered(c3, c0)) continue;
            if (!this._poolRectClear(x0, y, z0, sx, sz)) continue;
            const key = `${y}|${round(x0)}|${round(z0)}|${sx}x${sz}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const corners = [
              [c0.x, c0.y, c0.z], [c1.x, c1.y, c1.z],
              [c2.x, c2.y, c2.z], [c3.x, c3.y, c3.z],
            ];
            // Front = die kleinere Z- (bzw. gedreht X-) Kante; lokale +Z geht ins Becken.
            const mount = rotated
              ? {
                pos: [x0, y, z0 + sz / 2],
                quat: quatFromBasis([0, 0, 1], [0, 1, 0], [1, 0, 0]),
              }
              : {
                pos: [x0 + sx / 2, y, z0],
                quat: [0, 0, 0, 1],
              };
            out.push({
              ...mount, kind, w, h, d, corners,
            });
          }
        }
      }
    }
    return out;
  }

  _poolRectClear(x0, y, z0, sx, sz) {
    const pad = 3;
    for (const n of this.nodes.values()) {
      if (n.unused || Math.abs(n.y - y) > 2) continue;
      if (n.x > x0 + pad && n.x < x0 + sx - pad && n.z > z0 + pad && n.z < z0 + sz - pad) {
        return false;
      }
    }
    return true;
  }

  _poolOpeningTaken(mount) {
    const fd = Math.abs(mount.d || 0);
    const want = [mount.pos[0], mount.pos[1], mount.pos[2]];
    if (mount.quat) {
      const z = zAxisOf(mount.quat);
      want[0] += z[0] * fd / 2;
      want[1] += z[1] * fd / 2;
      want[2] += z[2] * fd / 2;
    } else {
      want[2] += fd / 2;
    }
    for (const f of this.fittings.values()) {
      if (!POOL_KINDS.has(f.kind)) continue;
      if (Math.abs(f.y - mount.pos[1]) > 3) continue;
      const depth = Math.abs(f.d || 0);
      let cx = f.x, cy = f.y, cz = f.z;
      if (f.quat) {
        const z = zAxisOf(f.quat);
        cx += z[0] * depth / 2;
        cy += z[1] * depth / 2;
        cz += z[2] * depth / 2;
      } else {
        cz += depth / 2;
      }
      if (Math.hypot(cx - want[0], cy - want[1], cz - want[2]) < 10) return true;
    }
    return false;
  }

  /** Kante a--b mit geraden Rohren belegt (Zwischenknoten erlaubt). */
  _axisEdgeCovered(a, b, tol = 2.5) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1) return true;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const param = (n) => {
      const px = n.x - a.x, py = n.y - a.y, pz = n.z - a.z;
      const t = px * ux + py * uy + pz * uz;
      const qx = px - ux * t, qy = py - uy * t, qz = pz - uz * t;
      if (Math.hypot(qx, qy, qz) > tol) return null;
      if (t < -tol || t > L + tol) return null;
      return t;
    };
    const segs = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const na = this.nodes.get(t.a), nb = this.nodes.get(t.b);
      if (!na || !nb) continue;
      const ta = param(na), tb = param(nb);
      if (ta == null || tb == null) continue;
      segs.push([Math.min(ta, tb), Math.max(ta, tb)]);
    }
    segs.sort((p, q) => p[0] - q[0]);
    let reach = 0;
    for (const [lo, hi] of segs) {
      if (lo > reach + tol) return false;
      reach = Math.max(reach, hi);
    }
    return reach >= L - tol;
  }

  /**
   * Ausschnitt aus dem Modell: alles, was zur Auswahl gehoert, als reines JSON.
   * Koordinaten liegen relativ zum `anchor` (kleinste Ecke), damit sich das
   * Fragment ueberall wieder einsetzen laesst -- auch in einem anderen Entwurf.
   *
   * Mitgenommen wird ein Rohr nur, wenn BEIDE Enden dabei sind (ein halbes Rohr
   * gibt es nicht), eine Platte nur mit beiden Tragrohren. Die aus Dateien
   * stammenden Lagen (`geom`, `pool`) fallen weg: sie beschreiben die
   * URSPRUENGLICHE Stelle und wuerden die Kopie dorthin zurueckziehen.
   */
  extractSelection(sel) {
    const tg = this.moveTargets(sel);
    if (!tg.nodes.size && !tg.clamps.size && !tg.slides.size && !tg.fittings.size) return null;
    const json = this.toJSON();
    const ohneGeom = (o) => { const c = { ...o }; delete c.geom; delete c.pool; delete c.poolPart; return c; };

    const nodes = (json.nodes || []).filter((n) => tg.nodes.has(n.id));
    const tubeIds = new Set();
    const tubes = (json.tubes || []).filter((t) => {
      const drin = tg.nodes.has(t.a) && tg.nodes.has(t.b);
      if (drin) tubeIds.add(t.id);
      return drin;
    }).map(ohneGeom);
    const aufRohren = (list) => (list || [])
      .filter((p) => tubeIds.has(p.a) && tubeIds.has(p.b)).map(ohneGeom);

    const clamps = (json.clamps || []).filter((c) => tg.clamps.has(c.id));
    const slides = (json.slides || []).filter((s) => tg.slides.has(s.id));
    const fittings = (json.fittings || []).filter((f) => tg.fittings.has(f.id));

    // Anker: kleinste Ecke ueber alles, was eine eigene Lage hat.
    const punkte = [...nodes, ...clamps, ...slides, ...fittings];
    if (!punkte.length) return null;
    const anchor = [
      Math.min(...punkte.map((o) => o.x)),
      Math.min(...punkte.map((o) => o.y)),
      Math.min(...punkte.map((o) => o.z)),
    ];
    const rel = (o) => ({ ...o, x: o.x - anchor[0], y: o.y - anchor[1], z: o.z - anchor[2] });
    const relPunkt = (p) => (Array.isArray(p) && p.length === 3
      ? [p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]] : p);

    const panels = aufRohren(json.panels);
    const textiles = aufRohren(json.textiles);
    // 整组都在片段里的组跟着走
    const drin = new Set([
      ...nodes.map((n) => n.id), ...tubeIds, ...panels.map((p) => p.id), ...textiles.map((x) => x.id),
      ...clamps.map((c) => c.id), ...slides.map((s) => s.id), ...fittings.map((f) => f.id),
    ]);
    const groups = [...this.groups.entries()]
      .filter(([, set]) => set.size >= 2 && [...set].every((id) => drin.has(id)))
      .map(([id, set]) => ({ id, ids: [...set] }));

    return {
      anchor,
      nodes: nodes.map(rel),
      tubes,
      panels,
      textiles,
      groups,
      clamps: clamps.map(rel),
      slides: slides.map((s) => {
        const o = rel(s);
        if (s.hook) o.hook = relPunkt(s.hook);
        if (s.foot) o.foot = relPunkt(s.foot);
        return o;
      }),
      fittings: fittings.map(rel),
    };
  }

  /**
   * Fragment an einer Stelle einsetzen. Jedes Teil bekommt eine neue Kennung,
   * die Verweise (Rohre auf Knoten, Platten auf Rohre) werden mit umgeschrieben.
   * Es wird NICHT geprueft und NICHT zusammengelegt -- das entscheidet der
   * Aufrufer, wenn die Lage feststeht. Liefert die neuen Kennungen je Art.
   */
  insertFragment(frag, offset = [0, 0, 0]) {
    const out = { nodes: [], tubes: [], panels: [], textiles: [], clamps: [], slides: [], fittings: [] };
    if (!frag) return out;
    const [dx, dy, dz] = offset;
    const neu = new Map();                       // alte Kennung -> neue
    const versetzt = (o, prefix, art) => {
      const id = this._id(prefix);
      neu.set(o.id, id);
      out[art].push(id);
      return { ...o, id, x: round(o.x + dx), y: round(o.y + dy), z: round(o.z + dz) };
    };
    const punktVersetzt = (p) => (Array.isArray(p) && p.length === 3
      ? [round(p[0] + dx), round(p[1] + dy), round(p[2] + dz)] : p);

    for (const n of frag.nodes || []) {
      const rec = versetzt(n, "n", "nodes");
      this.nodes.set(rec.id, {
        id: rec.id, x: rec.x, y: rec.y, z: rec.z,
        c45: !!n.c45, c45body: !!n.c45body, c45axis: n.c45axis || null, c45quat: n.c45quat || null,
        armDirs: n.armDirs || null, arms: n.arms || null, quat: n.quat || null,
        part: n.part || null, clampOn: n.clampOn ? { ...n.clampOn } : null,
        stub: n.stub || null, bearingOn: n.bearingOn || null,
        ownConnector: !!n.ownConnector, c45file: !!n.c45file,
        unused: !!n.unused, partQuat: n.partQuat || null,
        partMask: n.partMask || null,
        hinges: Array.isArray(n.hinges) ? n.hinges.slice() : null,
        boltDeep: n.boltDeep || 0,
        preferType: n.preferType || null,
      });
    }
    for (const t of frag.tubes || []) {
      const a = neu.get(t.a), b = neu.get(t.b);
      if (!a || !b) continue;
      const id = this._id("t");
      neu.set(t.id, id);
      out.tubes.push(id);
      this.tubes.set(id, { ...t, id, a, b });
    }
    // Klemm-Kupplungen zeigen auf ihr Rohr -- der Verweis muss mitwandern.
    for (const id of out.nodes) {
      const n = this.nodes.get(id);
      if (n && n.clampOn && neu.has(n.clampOn.tubeId)) n.clampOn.tubeId = neu.get(n.clampOn.tubeId);
    }
    const aufRohre = (list, map, prefix, art) => {
      for (const p of list || []) {
        const a = neu.get(p.a), b = neu.get(p.b);
        if (!a || !b) continue;
        const id = this._id(prefix);
        neu.set(p.id, id);
        out[art].push(id);
        map.set(id, { ...p, id, a, b });
      }
    };
    aufRohre(frag.panels, this.panels, "p", "panels");
    aufRohre(frag.textiles, this.textiles, "x", "textiles");
    for (const c of frag.clamps || []) {
      const rec = versetzt(c, "k", "clamps");
      this.clamps.set(rec.id, rec);
    }
    for (const s of frag.slides || []) {
      const rec = versetzt(s, "s", "slides");
      if (s.hook) rec.hook = punktVersetzt(s.hook);
      if (s.foot) rec.foot = punktVersetzt(s.foot);
      this.slides.set(rec.id, rec);
    }
    for (const f of frag.fittings || []) {
      const rec = versetzt(f, "f", "fittings");
      this.fittings.set(rec.id, rec);
    }
    // 片段里的组换上新 id 再登记
    for (const g of frag.groups || []) {
      const ids = (g.ids || []).map((id) => neu.get(id)).filter(Boolean);
      if (ids.length >= 2) this.groups.set(this._id("g"), new Set(ids));
    }
    return out;
  }

  /**
   * Verbindungen der Auswahl zum stehenden Rest trennen -- oeffentliche
   * Kurzform von `_detachBoundary` fuer die Vorschau beim Ziehen.
   */
  detachSelection(sel) {
    const tg = this.moveTargets(sel);
    return tg.nodes.size ? this._detachBoundary(tg.nodes) : 0;
  }

  /**
   * Verbindungen zum stehen bleibenden Teil trennen.
   *
   * Ein Rohr, von dem sich nur EIN Ende bewegt, kann nicht mitwandern -- Rohre
   * haben feste Katalog-Laengen. Es bleibt deshalb liegen und bekommt an der
   * frei werdenden Seite eine eigene Kupplung an der bisherigen Stelle; die
   * abgedockte Kupplung behaelt nur noch die Arme, die mitgehen.
   *
   * Liefert die Anzahl getrennter Rohre.
   */
  _detachBoundary(nodeIds) {
    // Platten und Netze, deren Ecken auseinandergerissen wuerden, gibt es
    // danach nicht mehr -- sie sind starre Fertigteile.
    // Eine Platte, deren zwei Tragrohre auseinandergerissen wuerden, gibt es
    // danach nicht mehr -- sie ist ein starres Fertigteil.
    const railNodes = (p) => {
      const out = [];
      for (const tid of [p.a, p.b]) {
        const t = this.tubes.get(tid);
        if (t) out.push(t.a, t.b);
      }
      return out;
    };
    const torn = (ids) => ids.some((id) => nodeIds.has(id)) && ids.some((id) => !nodeIds.has(id));
    for (const p of [...this.panels.values()]) if (torn(railNodes(p))) this.panels.delete(p.id);
    for (const x of [...this.textiles.values()]) if (torn(railNodes(x))) this.textiles.delete(x.id);

    const stubs = new Map();   // mitwandernde Knoten-id -> zurueckbleibende Kupplung
    const touched = new Set();
    let count = 0;
    for (const t of this.tubes.values()) {
      const a = nodeIds.has(t.a), b = nodeIds.has(t.b);
      if (a === b) continue;
      const movingId = a ? t.a : t.b;
      let stubId = stubs.get(movingId);
      if (!stubId) {
        const src = this.nodes.get(movingId);
        const stub = { id: this._id("n"), x: src.x, y: src.y, z: src.z };
        this.nodes.set(stub.id, stub);
        stubs.set(movingId, stub.id);
        stubId = stub.id;
      }
      if (a) t.a = stubId; else t.b = stubId;
      touched.add(movingId).add(stubId);
      count++;
    }
    for (const id of touched) this._syncC45Flag(id);
    if (count) this._pruneOrphanedC45Bodies();
    return count;
  }

  /**
   * c45-Kennzeichen nachziehen: Der Knoten traegt genau dann eine 45-Grad-
   * Winkelkupplung, wenn eine Arm-Kante zu einem Adapter-Koerper an ihm haengt.
   * Nach dem Trennen oder Zusammenlegen kann das kippen.
   */
  _syncC45Flag(id) {
    const n = this.nodes.get(id);
    if (!n || n.c45body) return;
    let has = false;
    for (const t of this.tubes.values()) {
      if (t.arm && (t.a === id || t.b === id)) { has = true; break; }
    }
    n.c45 = has;
    if (!has) n.c45axis = null;
  }

  _applyOffset(tg, dx, dy, dz) {
    const shift = (o) => {
      o.x = round(o.x + dx); o.y = round(o.y + dy); o.z = round(o.z + dz);
    };
    for (const id of tg.nodes) shift(this.nodes.get(id));
    for (const id of tg.clamps) shift(this.clamps.get(id));
    for (const id of tg.fittings || []) shift(this.fittings.get(id));
    for (const id of tg.slides) {
      const s = this.slides.get(id);
      shift(s);
      // Der Einhaengepunkt gehoert zur Rutsche und wandert mit.
      if (s.hook && s.hook.length === 3)
        s.hook = [round(s.hook[0] + dx), round(s.hook[1] + dy), round(s.hook[2] + dz)];
    }
    this._moveTubeGeom(tg.nodes, [dx, dy, dz]);
    this._movePanelGeom(tg.nodes, [dx, dy, dz]);
  }

  /**
   * Eigene Lage der Platten nach einer Knotenbewegung nachziehen -- gleiche
   * Regel wie bei den Rohren: wandern alle vier Ecken mit, wandert sie mit,
   * sonst gilt sie nicht mehr.
   */
  _movePanelGeom(movedIds, delta = null) {
    for (const p of this.panels.values()) {
      if (!p.geom) continue;
      const ecken = this.panelCorners(p);
      if (!ecken) { delete p.geom; continue; }
      const traeger = [this.tubes.get(p.a), this.tubes.get(p.b)].filter(Boolean);
      const ids = traeger.flatMap((t) => [t.a, t.b]);
      const bewegt = ids.filter((id) => movedIds.has(id)).length;
      if (!bewegt) continue;
      if (bewegt === ids.length && delta) {
        p.geom = { ...p.geom, p: [round(p.geom.p[0] + delta[0]),
          round(p.geom.p[1] + delta[1]), round(p.geom.p[2] + delta[2])] };
      } else {
        delete p.geom;
      }
    }
  }

  /**
   * Eigene Lage der Rohre nach einer Knotenbewegung nachziehen.
   *
   * Ein eingelesenes Rohr bringt seine Lage aus der Datei mit. Wandern BEIDE
   * Enden um denselben Betrag, wandert sie mit; wandert nur ein Ende oder wird
   * gedreht (`delta` fehlt), gilt sie nicht mehr und das Rohr rechnet sich
   * wieder aus seinen zwei Kupplungen.
   */
  _moveTubeGeom(movedIds, delta = null) {
    for (const t of this.tubes.values()) {
      if (!t.geom) continue;
      const ba = movedIds.has(t.a), bb = movedIds.has(t.b);
      if (!ba && !bb) continue;
      if (ba && bb && delta) {
        t.geom = { ...t.geom, p0: [round(t.geom.p0[0] + delta[0]),
          round(t.geom.p0[1] + delta[1]), round(t.geom.p0[2] + delta[2])] };
      } else {
        delete t.geom;
      }
    }
  }

  /**
   * Verschiebt die ausgewaehlten Teile um (dx,dy,dz).
   *
   * Haengt die Auswahl ueber Rohre am Rest, werden diese Verbindungen getrennt
   * (siehe _detachBoundary); trifft sie am Ziel auf vorhandene Kupplungen,
   * verschmelzen die (siehe _mergeMovedNodes).
   *
   * Abgelehnt wird, was es real nicht gibt: ein Ziel, an dem sich Rohre
   * ueberlagern wuerden, und eine Kupplung, die es im Sortiment nicht gibt.
   * Beides zaehlt nur, wenn es VORHER nicht schon so war -- sonst liesse sich
   * ein Modell, das bereits kollidiert oder eine Sonderkupplung enthaelt, nie
   * mehr bewegen. Die Pruefung der Kupplungen wird hereingereicht (validate),
   * damit dieses Modul den Katalog nicht kennen muss.
   *
   * merge = false laesst deckungsgleiche Kupplungen getrennt.
   *
   * Liefert { ok, reason, merged, detached }.
   */
  moveSelection(sel, dx, dy, dz, { merge = true, validate = null, snapDist = 0 } = {}) {
    if (!dx && !dy && !dz) return { ok: true, merged: 0, detached: 0 };
    const tg = this.moveTargets(sel);
    if (!tg.nodes.size && !tg.clamps.size && !tg.slides.size && !tg.fittings.size) return { ok: false, reason: "empty" };

    // Unter den Boden wird nicht verschoben. Frueh geprueft, damit der teure
    // Schnappschuss bei einem offensichtlich ungueltigen Zug entfaellt.
    if (dy < 0) {
      for (const id of tg.nodes) if (this.isBelowGround(this.nodes.get(id).y + dy)) return { ok: false, reason: "ground" };
      for (const id of tg.clamps) if (this.isBelowGround(this.clamps.get(id).y + dy)) return { ok: false, reason: "ground" };
    }

    const snapshot = this.toJSON();
    // Geprueft wird nur, was sich bewegt: stehende Rohre koennen untereinander
    // keine NEUE Ueberlagerung bilden. Das spart bei grossen Modellen den
    // Loewenanteil der Rechnung (siehe collisions()).
    const movedTubes = this.tubesAt(tg.nodes);
    const collidedBefore = this.collisions({ only: movedTubes });
    const badBefore = validate ? validate(this) : null;

    const fail = (reason) => { this.loadJSON(snapshot); return { ok: false, reason }; };
    const detached = this._detachBoundary(tg.nodes);
    this._applyOffset(tg, dx, dy, dz);
    if (snapDist > 0) {
      const extra = this.snapOffsetFor(tg.nodes, snapDist);
      if (extra[0] || extra[1] || extra[2]) this._applyOffset(tg, extra[0], extra[1], extra[2]);
    }
    // 完全重合的管会在合并后去掉，不算拦住；交叉或只叠一部分仍然拦住。
    for (const id of this.collisions({ only: movedTubes, allowCoincide: merge })) {
      if (!collidedBefore.has(id)) return fail("collision");
    }

    const merged = merge ? this._mergeMovedNodes(tg.nodes) : 0;
    if (badBefore) {
      for (const id of validate(this)) if (!badBefore.has(id)) return fail("connector");
    }
    return { ok: true, merged, detached };
  }

  /**
   * Verdreht die ausgewaehlten Teile um die HOCHACHSE, in 90-Grad-Schritten.
   *
   * Der Ablauf ist derselbe wie beim Verschieben (moveSelection): was am
   * stehenden Rest haengt, wird getrennt; am Ziel deckungsgleiche Kupplungen
   * verschmelzen; abgelehnt wird, was sich ueberlagern wuerde oder eine
   * Kupplung braeuchte, die es nicht gibt.
   *
   * Gedreht wird um die Mitte der Auswahl, auf `grid` gerundet -- so bleiben
   * die Teile in demselben Raster, in dem sie vorher lagen.
   *
   * Liefert { ok, reason, merged, detached }.
   */
  // --- 成组 --------------------------------------------------------------
  _partExists(id) {
    return this.tubes.has(id) || this.panels.has(id) || this.textiles.has(id) || this.slides.has(id)
      || this.clamps.has(id) || this.fittings.has(id) || this.nodes.has(id);
  }

  /** 删掉零件之后组里可能剩下不存在的 id；剩一件的组没有意义。 */
  _pruneGroups() {
    for (const [gid, set] of [...this.groups]) {
      for (const id of [...set]) if (!this._partExists(id)) set.delete(id);
      if (set.size < 2) this.groups.delete(gid);
    }
  }

  groupOf(id) {
    for (const [gid, set] of this.groups) if (set.has(id)) return gid;
    return null;
  }

  /** 把这些零件成一组。已经在别的组里的换到新组。少于两件返回 null。 */
  groupParts(ids) {
    const set = new Set(ids.filter((id) => this._partExists(id)));
    if (set.size < 2) return null;
    for (const id of set) {
      const g = this.groupOf(id);
      if (g) this.groups.get(g).delete(id);
    }
    const gid = this._id("g");
    this.groups.set(gid, set);
    this._pruneGroups();
    return gid;
  }

  /** 解散这些零件所在的组，返回解散了几组。 */
  ungroupParts(ids) {
    let n = 0;
    for (const id of ids) {
      const g = this.groupOf(id);
      if (g) { this.groups.delete(g); n++; }
    }
    return n;
  }

  // --- 镜像 --------------------------------------------------------------
  /**
   * 选中部分沿一根世界轴翻转（axis = "x" 或 "z"），镜面穿过选中部分的中心，
   * 中心对齐 grid。和 rotateSelection 同一条路：快照、和外面断开、翻转、
   * 碰撞、合并、接头校验。弯滑梯有手性，镜像后没有对应零件，直接拒绝。
   */
  mirrorSelection(sel, axis = "x", { merge = true, validate = null, grid = 5 } = {}) {
    const tg = this.moveTargets(sel);
    if (!tg.nodes.size && !tg.clamps.size && !tg.slides.size && !tg.fittings.size) return { ok: false, reason: "empty" };
    for (const id of tg.slides) {
      const sl = this.slides.get(id);
      if (sl && sl.kind === "curved-slide2") return { ok: false, reason: "chiral" };
    }
    const i = axis === "z" ? 2 : 0;
    const punkte = [];
    for (const id of tg.nodes) punkte.push(this.nodes.get(id));
    for (const id of tg.clamps) punkte.push(this.clamps.get(id));
    for (const id of tg.slides) punkte.push(this.slides.get(id));
    for (const id of tg.fittings || []) punkte.push(this.fittings.get(id));
    const gueltig = punkte.filter(Boolean);
    if (!gueltig.length) return { ok: false, reason: "empty" };
    const vs = gueltig.map((o) => (i === 0 ? o.x : o.z));
    const c = Math.round((Math.min(...vs) + Math.max(...vs)) / 2 / grid) * grid;

    const snapshot = this.toJSON();
    const movedTubes = this.tubesAt(tg.nodes);
    const collidedBefore = this.collisions({ only: movedTubes });
    const badBefore = validate ? validate(this) : null;
    const fail = (reason) => { this.loadJSON(snapshot); return { ok: false, reason }; };

    const detached = this._detachBoundary(tg.nodes);
    this._applyMirror(tg, i, c);
    for (const id of this.collisions({ only: movedTubes, allowCoincide: merge })) {
      if (!collidedBefore.has(id)) return fail("collision");
    }
    const merged = merge ? this._mergeMovedNodes(tg.nodes) : 0;
    if (badBefore) {
      for (const id of validate(this)) if (!badBefore.has(id)) return fail("connector");
    }
    return { ok: true, merged, detached };
  }

  /**
   * 翻转本身：位置沿第 i 个坐标对镜面 c 反射，方向的第 i 个分量取反。
   * 朝向（四元数）翻过来是左手系，把局部 x 轴（零件的宽度方向）重新按
   * y × z 算回来：滑梯的走向和顶棚的屋脊都不变，只有左右互换。
   */
  _applyMirror(tg, i, c) {
    const r6 = (t) => Math.round(t * 1e6) / 1e6;
    const flipPos = (o) => {
      if (!o) return;
      if (i === 0) o.x = round(2 * c - o.x); else o.z = round(2 * c - o.z);
    };
    const flipPt = (p) => {
      if (!Array.isArray(p) || p.length !== 3) return p;
      const q = p.slice(); q[i] = round(2 * c - q[i]); return q;
    };
    const flipDir = (v) => {
      if (!v || v.length !== 3) return v;
      const q = v.slice(); q[i] = -q[i]; return q.map(r6);
    };
    const flipQuat = (q) => {
      if (!q || q.length !== 4) return q;
      const ey = flipDir(yAxisOf(q)), ez = flipDir(zAxisOf(q));
      const ex = cross3(ey, ez);
      return quatFromBasis(ex, ey, ez).map((v) => Math.round(v * 1e4) / 1e4);
    };

    // 板和布在承重管上的起点：管的方向翻过来之后，从另一头量
    for (const list of [this.panels, this.textiles]) {
      for (const p of list.values()) {
        const t = this.tubes.get(p.a);
        if (!t || !tg.nodes.has(t.a) || !tg.nodes.has(t.b)) continue;
        const ra = this._rail(p.a);
        if (!ra || Math.abs(ra.dir[i]) < 0.5) continue;
        p.t0 = round(ra.len - (p.t0 + p.len));
      }
    }

    for (const id of tg.nodes) {
      const n = this.nodes.get(id);
      if (!n) continue;
      flipPos(n);
      if (n.quat) n.quat = flipQuat(n.quat);
      if (n.c45quat) n.c45quat = flipQuat(n.c45quat);
      if (n.partQuat) n.partQuat = flipQuat(n.partQuat);
      if (n.stub) n.stub = flipDir(n.stub);
      if (n.c45axis) n.c45axis = flipDir(n.c45axis);
      if (n.arms) n.arms = n.arms.map(flipDir);
      if (n.armDirs) n.armDirs = n.armDirs.map((a) => {
        const vec = flipDir(a.vec || a);
        return a.vec ? { name: cardinalName(vec), vec } : vec;
      });
    }
    for (const id of tg.clamps) {
      const cl = this.clamps.get(id);
      if (!cl) continue;
      flipPos(cl);
      if (cl.dir) cl.dir = flipDir(cl.dir);
      if (cl.off) cl.off = flipDir(cl.off).map(round);
    }
    for (const id of tg.slides) {
      const sl = this.slides.get(id);
      if (!sl) continue;
      flipPos(sl);
      if (sl.quat) sl.quat = flipQuat(sl.quat);
      if (sl.hook) sl.hook = flipPt(sl.hook);
      if (sl.foot && sl.foot.p0) sl.foot = { ...sl.foot, p0: flipPt(sl.foot.p0), dir: flipDir(sl.foot.dir) };
    }
    for (const id of tg.fittings || []) {
      const f = this.fittings.get(id);
      if (!f) continue;
      flipPos(f);
      if (f.quat) f.quat = flipQuat(f.quat);
    }
    for (const t of this.tubes.values()) {
      const ba = tg.nodes.has(t.a), bb = tg.nodes.has(t.b);
      if (!ba && !bb) continue;
      if (t.bow && t.bowCenter && ba && bb) t.bowCenter = flipPt(t.bowCenter);
      if (!t.geom) continue;
      if (ba && bb) {
        t.geom = { ...t.geom, p0: flipPt(t.geom.p0), dir: flipDir(t.geom.dir) };
        if (t.geom.up) t.geom.up = flipDir(t.geom.up);
      } else {
        delete t.geom;
      }
    }
    for (const p of this.panels.values()) {
      if (!p.geom) continue;
      const traeger = [this.tubes.get(p.a), this.tubes.get(p.b)].filter(Boolean);
      const ids = traeger.flatMap((t) => [t.a, t.b]);
      const bewegt = ids.filter((id) => tg.nodes.has(id)).length;
      if (!bewegt) continue;
      if (bewegt === ids.length && p.geom.p) {
        p.geom = { ...p.geom, p: flipPt(p.geom.p), quat: p.geom.quat ? flipQuat(p.geom.quat) : p.geom.quat };
      } else {
        delete p.geom;
      }
    }
  }

  rotateSelection(sel, steps = 1, { merge = true, validate = null, grid = 5 } = {}) {
    const schritte = ((steps % 4) + 4) % 4;
    if (!schritte) return { ok: true, merged: 0, detached: 0 };
    const tg = this.moveTargets(sel);
    if (!tg.nodes.size && !tg.clamps.size && !tg.slides.size && !tg.fittings.size) return { ok: false, reason: "empty" };

    // Drehachse: senkrecht durch die Mitte der Auswahl. Auf das Raster
    // gerundet, sonst landen die Teile zwischen den Rasterpunkten.
    const punkte = [];
    for (const id of tg.nodes) punkte.push(this.nodes.get(id));
    for (const id of tg.clamps) punkte.push(this.clamps.get(id));
    for (const id of tg.slides) punkte.push(this.slides.get(id));
    for (const id of tg.fittings || []) punkte.push(this.fittings.get(id));
    const gueltig = punkte.filter(Boolean);
    if (!gueltig.length) return { ok: false, reason: "empty" };
    const xs = gueltig.map((o) => o.x), zs = gueltig.map((o) => o.z);
    const raster = (v) => Math.round(v / grid) * grid;
    const cx = raster((Math.min(...xs) + Math.max(...xs)) / 2);
    const cz = raster((Math.min(...zs) + Math.max(...zs)) / 2);

    const snapshot = this.toJSON();
    const movedTubes = this.tubesAt(tg.nodes);
    const collidedBefore = this.collisions({ only: movedTubes });
    const badBefore = validate ? validate(this) : null;
    const fail = (reason) => { this.loadJSON(snapshot); return { ok: false, reason }; };

    const detached = this._detachBoundary(tg.nodes);
    this._applyTurn(tg, schritte, cx, cz);
    for (const id of this.collisions({ only: movedTubes, allowCoincide: merge })) {
      if (!collidedBefore.has(id)) return fail("collision");
    }

    const merged = merge ? this._mergeMovedNodes(tg.nodes) : 0;
    if (badBefore) {
      for (const id of validate(this)) if (!badBefore.has(id)) return fail("connector");
    }
    return { ok: true, merged, detached };
  }

  /**
   * Die eigentliche Drehung: Lage UND Ausrichtung aller betroffenen Teile.
   * Ein Viertel um die Hochachse ist reine Vertauschung -- ohne Sinus und
   * Kosinus bleiben die Koordinaten exakt auf dem Raster.
   */
  _applyTurn(tg, schritte, cx, cz) {
    // EIN Schritt dreht von oben gesehen im Uhrzeigersinn: +X wird zu +Z.
    // (Von oben blickt man gegen die Y-Achse, dort liegt +Z unten im Bild.)
    const drehePunkt = (x, z) => {
      let dx = x - cx, dz = z - cz;
      for (let k = 0; k < schritte; k++) { const nx = -dz, nz = dx; dx = nx; dz = nz; }
      return [round(cx + dx), round(cz + dz)];
    };
    // Richtungen drehen um den Ursprung, nicht um die Achse.
    const dreheDir = (v) => {
      if (!v || v.length !== 3) return v;
      let x = v[0], z = v[2];
      for (let k = 0; k < schritte; k++) { const nx = -z, nz = x; x = nx; z = nz; }
      const r6 = (t) => Math.round(t * 1e6) / 1e6;
      return [r6(x), v[1], r6(z)];
    };
    const grad = -schritte * 90;
    const dreheOrt = (o) => { if (!o) return; const [x, z] = drehePunkt(o.x, o.z); o.x = x; o.z = z; };

    for (const id of tg.nodes) {
      const n = this.nodes.get(id);
      if (!n) continue;
      dreheOrt(n);
      if (n.quat) n.quat = spinAroundY(n.quat, grad);
      if (n.c45quat) n.c45quat = spinAroundY(n.c45quat, grad);
      if (n.partQuat) n.partQuat = spinAroundY(n.partQuat, grad);
      if (n.stub) n.stub = dreheDir(n.stub);
      if (n.c45axis) n.c45axis = dreheDir(n.c45axis);
      if (n.arms) n.arms = n.arms.map(dreheDir);
      // Die Arm-Richtungen tragen ihren Namen mit -- der muss mitwandern.
      if (n.armDirs) n.armDirs = n.armDirs.map((a) => {
        const vec = dreheDir(a.vec || a);
        return a.vec ? { name: cardinalName(vec), vec } : vec;
      });
    }
    for (const id of tg.clamps) {
      const c = this.clamps.get(id);
      if (!c) continue;
      dreheOrt(c);
      if (c.dir) c.dir = dreheDir(c.dir);
      if (c.off) c.off = dreheDir(c.off).map(round);
    }
    for (const id of tg.slides) {
      const sl = this.slides.get(id);
      if (!sl) continue;
      dreheOrt(sl);
      if (sl.quat) sl.quat = spinAroundY(sl.quat, grad);
      if (sl.hook && sl.hook.length === 3) {
        const [hx, hz] = drehePunkt(sl.hook[0], sl.hook[2]);
        sl.hook = [hx, sl.hook[1], hz];
      }
      if (sl.foot && sl.foot.p0) {
        const [fx, fz] = drehePunkt(sl.foot.p0[0], sl.foot.p0[2]);
        sl.foot = { ...sl.foot, p0: [fx, sl.foot.p0[1], fz], dir: dreheDir(sl.foot.dir) };
      }
    }
    for (const id of tg.fittings || []) {
      const f = this.fittings.get(id);
      if (!f) continue;
      dreheOrt(f);
      if (f.quat) f.quat = spinAroundY(f.quat, grad);
    }
    // Rohre und Platten aus der Datei bringen ihre eigene Lage mit -- die dreht
    // mit, solange BEIDE Enden bzw. beide Traeger in der Auswahl sind. Sonst
    // faellt sie weg und das Teil rechnet sich wieder aus seinen Kupplungen.
    for (const t of this.tubes.values()) {
      const ba = tg.nodes.has(t.a), bb = tg.nodes.has(t.b);
      if (!ba && !bb) continue;
      if (t.bow && t.bowCenter && ba && bb) {
        const [bx, bz] = drehePunkt(t.bowCenter[0], t.bowCenter[2]);
        t.bowCenter = [bx, t.bowCenter[1], bz];
      }
      if (!t.geom) continue;
      if (ba && bb) {
        const [px, pz] = drehePunkt(t.geom.p0[0], t.geom.p0[2]);
        t.geom = { ...t.geom, p0: [px, t.geom.p0[1], pz], dir: dreheDir(t.geom.dir) };
        if (t.geom.up) t.geom.up = dreheDir(t.geom.up);
      } else {
        delete t.geom;
      }
    }
    for (const p of this.panels.values()) {
      if (!p.geom) continue;
      const traeger = [this.tubes.get(p.a), this.tubes.get(p.b)].filter(Boolean);
      const ids = traeger.flatMap((t) => [t.a, t.b]);
      const bewegt = ids.filter((id) => tg.nodes.has(id)).length;
      if (!bewegt) continue;
      if (bewegt === ids.length && p.geom.p) {
        const [px, pz] = drehePunkt(p.geom.p[0], p.geom.p[2]);
        p.geom = { ...p.geom, p: [px, p.geom.p[1], pz],
          quat: p.geom.quat ? spinAroundY(p.geom.quat, grad) : p.geom.quat };
      } else {
        delete p.geom;
      }
    }
  }

  /**
   * 刚体平移，让尽量多的移动中节点落到未移动节点上。
   * 已经贴上的保持不动，除非另一处能贴上更多点。
   */
  snapOffsetFor(movedIds, maxDist = 20) {
    const moved = [];
    const rest = [];
    for (const n of this.nodes.values()) {
      if (movedIds.has(n.id)) moved.push(n);
      else rest.push(n);
    }
    if (!moved.length || !rest.length) return [0, 0, 0];

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of moved) {
      if (m.x < minX) minX = m.x; if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y; if (m.y > maxY) maxY = m.y;
      if (m.z < minZ) minZ = m.z; if (m.z > maxZ) maxZ = m.z;
    }
    const pad = maxDist;
    const nearby = [];
    for (const s of rest) {
      if (s.x < minX - pad || s.x > maxX + pad) continue;
      if (s.y < minY - pad || s.y > maxY + pad) continue;
      if (s.z < minZ - pad || s.z > maxZ + pad) continue;
      nearby.push(s);
    }
    if (!nearby.length) return [0, 0, 0];

    const eps2 = MERGE_EPS * MERGE_EPS;
    const countHits = (dx, dy, dz) => {
      let hits = 0;
      for (const m of moved) {
        const x = m.x + dx, y = m.y + dy, z = m.z + dz;
        for (const s of nearby) {
          const ddx = s.x - x, ddy = s.y - y, ddz = s.z - z;
          if (ddx * ddx + ddy * ddy + ddz * ddz <= eps2) { hits++; break; }
        }
      }
      return hits;
    };

    // 贴到邻面（部分节点重合）优先于整块叠上去：否则半格偏移会吸成同一个立方体。
    const total = moved.length;
    const isFull = (hits) => total > 0 && hits >= total;
    const better = (hits, dist2, best) => {
      if (!hits) return false;
      if (!best.hits) return true;
      const cFull = isFull(hits), bFull = isFull(best.hits);
      if (cFull !== bFull) return !cFull;
      if (hits !== best.hits) return hits > best.hits;
      return dist2 < best.dist2;
    };

    const max2 = maxDist * maxDist;
    const best = { hits: countHits(0, 0, 0), dist2: 0, dx: 0, dy: 0, dz: 0 };
    const tried = new Set(["0,0,0"]);
    for (const m of moved) {
      for (const s of nearby) {
        const dx = s.x - m.x, dy = s.y - m.y, dz = s.z - m.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > max2) continue;
        const key = `${Math.round(dx * 1000)},${Math.round(dy * 1000)},${Math.round(dz * 1000)}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const hits = countHits(dx, dy, dz);
        if (better(hits, d2, best)) {
          best.hits = hits; best.dist2 = d2; best.dx = dx; best.dy = dy; best.dz = dz;
        }
      }
    }
    return [round(best.dx), round(best.dy), round(best.dz)];
  }

  /**
   * Kupplungen anpassen: landet ein verschobener Knoten auf einem stehen
   * gebliebenen, werden beide zu EINER Kupplung -- so waechst das verschobene
   * Teil mit dem Rest zusammen (aus der 2-armigen wird z.B. eine 3-armige).
   * Der stehende Knoten ueberlebt, damit Verweise ausserhalb der Auswahl gelten
   * bleiben.
   */
  _mergeMovedNodes(movedIds) {
    let merged = 0;
    const survivors = new Set();
    const eps2 = MERGE_EPS * MERGE_EPS;
    for (const id of movedIds) {
      const n = this.nodes.get(id);
      if (!n) continue;
      let target = null;
      for (const o of this.nodes.values()) {
        if (o.id === id || movedIds.has(o.id)) continue;
        if (dist2(o, n) <= eps2) { target = o; break; }
      }
      if (!target) continue;
      // Kennzeichen der verschwindenden Kupplung uebernehmen, soweit die
      // ueberlebende noch keines hat (Schraegen-Traeger, Wuerfel-Drehung).
      for (const key of ["c45", "c45body", "c45axis", "c45quat", "quat", "arms", "armDirs"]) {
        if (!target[key] && n[key]) target[key] = n[key];
      }
      this._replaceNodeRefs(id, target.id);
      this.nodes.delete(id);
      survivors.add(target.id);
      merged++;
    }
    if (merged) {
      this._dedupeTubes();
      this._prunePanels();
      for (const id of survivors) this._syncC45Flag(id);
    }
    return merged;
  }

  _replaceNodeRefs(fromId, toId) {
    for (const t of this.tubes.values()) {
      if (t.a === fromId) t.a = toId;
      if (t.b === fromId) t.b = toId;
    }
    // Platten verweisen auf Rohre, nicht auf Knoten -- da ist nichts zu tauschen.
  }

  // Nach dem Zusammenlegen koennen Rohre zwischen denselben zwei Kupplungen
  // doppelt vorliegen oder auf einen Punkt zusammenfallen.
  _dedupeTubes() {
    const seen = new Set();
    for (const t of [...this.tubes.values()]) {
      if (t.a === t.b) { this.tubes.delete(t.id); continue; }
      const pair = t.a < t.b ? `${t.a}|${t.b}` : `${t.b}|${t.a}`;
      const key = `${pair}|${t.arm ? "a" : t.link ? "l" : "t"}`;
      if (seen.has(key)) this.tubes.delete(t.id);
      else seen.add(key);
    }
  }

  /**
   * Rohre, die sich mit einem anderen ueberlagern oder es kreuzen.
   *
   * Verglichen wird nicht jedes Rohr mit jedem -- bei 425 Rohren waeren das
   * 90.000 Paare und rund 9 ms je Aufruf, und beim Ziehen faellt der Aufruf bei
   * JEDEM Rasterschritt an. Stattdessen kommen die Rohre in ein grobes Raster
   * (Zellweite COLL_CELL); geprueft wird nur gegen die Rohre derselben Zellen.
   * Zwei Rohre, deren Kisten sich nicht beruehren, koennen sich nicht treffen.
   *
   * `only` schraenkt auf bestimmte Rohre ein: beim Ziehen und Einfuegen bewegt
   * sich nur ein Teil, alles Uebrige steht und bildet keine NEUE Ueberlagerung.
   */
  collisions({ only = null, allowCoincide = false } = {}) {
    const out = new Set();
    const list = [];
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
      if (!a || !b) continue;
      list.push({
        id: t.id, a, b,
        lo: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)],
        hi: [Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)],
      });
    }
    // Raster aufbauen: jedes Rohr liegt in allen Zellen, die seine Kiste beruehrt.
    const grid = new Map();
    const zellen = (e) => {
      const keys = [];
      const vx = Math.floor((e.lo[0] - MERGE_EPS) / COLL_CELL), bx = Math.floor((e.hi[0] + MERGE_EPS) / COLL_CELL);
      const vy = Math.floor((e.lo[1] - MERGE_EPS) / COLL_CELL), by = Math.floor((e.hi[1] + MERGE_EPS) / COLL_CELL);
      const vz = Math.floor((e.lo[2] - MERGE_EPS) / COLL_CELL), bz = Math.floor((e.hi[2] + MERGE_EPS) / COLL_CELL);
      for (let ix = vx; ix <= bx; ix++)
        for (let iy = vy; iy <= by; iy++)
          for (let iz = vz; iz <= bz; iz++) keys.push(ix + "," + iy + "," + iz);
      return keys;
    };
    list.forEach((e, i) => {
      for (const key of zellen(e)) {
        const bucket = grid.get(key);
        if (bucket) bucket.push(i); else grid.set(key, [i]);
      }
    });
    const beruehrt = (p, q) => p.lo[0] - MERGE_EPS <= q.hi[0] && q.lo[0] - MERGE_EPS <= p.hi[0]
      && p.lo[1] - MERGE_EPS <= q.hi[1] && q.lo[1] - MERGE_EPS <= p.hi[1]
      && p.lo[2] - MERGE_EPS <= q.hi[2] && q.lo[2] - MERGE_EPS <= p.hi[2];
    const gesehen = new Set();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (only && !only.has(p.id)) continue;
      for (const key of zellen(p)) {
        for (const j of grid.get(key) || []) {
          if (j === i) continue;
          // Jedes Paar nur einmal ansehen -- ueber mehrere Zellen begegnen sich
          // zwei Rohre sonst mehrfach.
          const paar = i < j ? i * list.length + j : j * list.length + i;
          if (gesehen.has(paar)) continue;
          gesehen.add(paar);
          const q = list[j];
          if (!beruehrt(p, q)) continue;
          if (allowCoincide && segmentsCoincide(p.a, p.b, q.a, q.b)) continue;
          if (segmentsOverlap(p.a, p.b, q.a, q.b) || segmentsCross(p.a, p.b, q.a, q.b)) {
            out.add(p.id);
            out.add(q.id);
          }
        }
      }
    }
    return out;
  }

  /** Rohre, die an einem dieser Knoten haengen -- sie bewegen sich mit ihnen. */
  tubesAt(nodeIds) {
    const out = new Set();
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      if (nodeIds.has(t.a) || nodeIds.has(t.b)) out.add(t.id);
    }
    return out;
  }

  /**
   * Auswahl nur verschieben: ohne Trennen, ohne Zusammenlegen, ohne Pruefung.
   * Das ist der Schritt fuer eine Vorschau (Ziehen, Einfuegen) -- alles Weitere
   * faellt erst beim Absetzen an.
   */
  translateSelection(sel, dx, dy, dz) {
    const tg = this.moveTargets(sel);
    if (dx || dy || dz) this._applyOffset(tg, dx, dy, dz);
    return tg;
  }

  // Hat der Knoten eine senkrechte Stuetze nach unten (Rohr zu einem Knoten direkt darunter)?
  _supportedFromBelow(node) {
    for (const nb of this.neighbors(node.id)) {
      if (nb && nb.y < node.y - 0.5 &&
          Math.abs(nb.x - node.x) < 0.5 && Math.abs(nb.z - node.z) < 0.5) return true;
    }
    return false;
  }

  // Baut von einem bestehenden Knoten in eine Richtung ein Rohr an und legt
  // (falls noetig) den Zielknoten an. spacing = Rohrlaenge + Kupplungsgroesse.
  // Rueckgabe:
  //   { node, tube }            erfolgreich gebaut
  //   { node, tube:null, duplicate:true }  Ziel existiert und ist schon verbunden (Navigation)
  //   { collision:true }        Pfad ist durch ein anderes Rohr belegt
  extend(fromNodeId, dirVec, tubeId, color, length, spacing) {
    const from = this.nodes.get(fromNodeId);
    if (!from) return null;
    const target = {
      x: from.x + dirVec[0] * spacing,
      y: from.y + dirVec[1] * spacing,
      z: from.z + dirVec[2] * spacing,
    };
    if (this.isBelowGround(target.y)) return { ground: true };
    // Bereits verbundener Zielknoten => reine Navigation, kein neuer Bau.
    const existing = this.findNodeNear(target.x, target.y, target.z);
    if (existing && this.tubeBetween(from.id, existing.id)) {
      return { node: existing, tube: null, duplicate: true };
    }
    // Liegt auf dem Pfad schon ein Rohr? Dann nicht ueberbauen.
    if (this.tubeCollision(from, target)) {
      return { collision: true };
    }
    const to = this.addNode(target.x, target.y, target.z);
    // Der neue Knoten steht in derselben Lage wie der, von dem gebaut wird --
    // sonst boete er am Ende einer gedrehten Reihe wieder die Weltachsen an und
    // das naechste Rohr knickte weg.
    if (from.quat && !to.quat) to.quat = from.quat.slice();
    const tube = this.addTube(from.id, to.id, tubeId, color, length);
    return { node: to, tube };
  }

  // Schraege Strebe ueber eine 45-Grad-Winkelkupplung (C45) anbauen. Von der
  // Basiskupplung `fromId` fuehrt ein kurzer Adapter-Arm (kardinale Huelse,
  // Richtung c45axis) zum Adapter-Koerper; von dort geht das Diagonalrohr (45
  // Grad, Richtung dir) zum neuen Knoten. So belegt der Adapter echten Platz und
  // erscheint als Winkelkupplung in der Stueckliste -- wie beim QDF-Import.
  //   sleeveLen = Huelsenlaenge (Basis->Koerper, kardinal),
  //   armLen    = 45-Grad-Armlaenge (Koerper->Rohranschluss).
  extendC45Diagonal(fromId, dir, c45axis, tubeId, color, length, spacing, sleeveLen, armLen) {
    const from = this.nodes.get(fromId);
    if (!from) return null;
    const bx = from.x + c45axis[0] * sleeveLen + dir[0] * armLen;
    const by = from.y + c45axis[1] * sleeveLen + dir[1] * armLen;
    const bz = from.z + c45axis[2] * sleeveLen + dir[2] * armLen;
    const target = { x: bx + dir[0] * spacing, y: by + dir[1] * spacing, z: bz + dir[2] * spacing };
    // Adapter-Koerper UND Rohrende muessen ueber dem Boden bleiben.
    if (this.isBelowGround(by) || this.isBelowGround(target.y)) return { ground: true };
    // Am oberen Ende sitzt haeufig schon eine Kupplung. Die Winkelkupplung frisst
    // im Schraegen-Raster ein gutes Stueck Weg, deshalb landet das gerechnete
    // Rohrende ein bis zwei Zentimeter daneben -- zu weit fuer den Auto-Merge
    // (MERGE_EPS). Ohne dieses Snapping entstuende eine zweite Kupplung, die die
    // vorhandene ueberlagert. Gleiche Logik wie in extendDiagonalSnap.
    const snap = this._nodeNear(target, DIAGONAL_SNAP_TOL, [fromId]);
    const end = snap || target;
    // Pfad des Diagonalrohrs schon belegt?
    if (this.tubeCollision({ x: bx, y: by, z: bz }, end)) return { collision: true };
    const body = this.addNode(round(bx), round(by), round(bz));
    body.c45 = true;
    body.c45body = true;
    body.c45axis = c45axis.slice();
    this.addArm(from.id, body.id);
    const to = snap || this.addNode(round(target.x), round(target.y), round(target.z));
    const tube = this.addTube(body.id, to.id, tubeId, color, length);
    return { node: to, tube, body };
  }

  /**
   * 45-Grad-Winkelkupplung setzen: ihre Huelse steckt auf einem freien Arm der
   * Kupplung (`axis`), ihr Arm zeigt in die Schraege (`dir`). Ein Rohr kommt
   * spaeter dazu -- die Kupplung ist ein eigenes Teil.
   */
  /**
   * Richtung des Rohrs an einer DUMMY-Kupplung -- vom Knoten aus INS Rohr
   * hinein. Liefert null, wenn der Knoten keine ist.
   *
   * Eine Dummy-Kupplung ist ein Rohrende, an dem sonst nichts haengt: genau ein
   * gerades Rohr, kein festes Teil, keine Kappe, kein Adapter. Nur dort laesst
   * sich die Winkelkupplung direkt ins Rohr stecken (siehe `addC45OnTube`).
   */
  c45TubeDir(node) {
    if (!node || node.part || node.c45body || node.c45 || node.unused) return null;
    if (this.hasWheelCap(node) || this.hasEndPiece(node)) return null;
    let nb = null;
    for (const t of this.tubes.values()) {
      if (t.link) continue;
      const otherId = t.a === node.id ? t.b : t.b === node.id ? t.a : null;
      if (!otherId) continue;
      if (nb || t.arm) return null;    // zweites Rohr oder Adapter-Huelse: keine Dummy-Kupplung
      if (t.bow) return null;          // in ein Bogenrohr passt sie nicht
      nb = this.nodes.get(otherId);
    }
    if (!nb) return null;
    const v = [nb.x - node.x, nb.y - node.y, nb.z - node.z];
    const L = Math.hypot(v[0], v[1], v[2]);
    if (L < 1e-6) return null;
    return [v[0] / L, v[1] / L, v[2] / L];
  }

  /**
   * Moegliche Huelsenachsen, wenn die Winkelkupplung direkt in ein Rohr
   * gesteckt wird. Zur Rohrrichtung steht die Huelse im 45-Grad-Innenwinkel
   * (Skalarprodukt -0,707) -- das sind die vier Diagonalen der beiden Ebenen
   * quer zum Rohr. Die erste ist die Vorgabe, die uebrigen erreicht ein Klick
   * auf die gesetzte Kupplung (`rotateC45Sleeve`).
   */
  c45SleeveAxes(dir) {
    if (!dir) return [];
    const out = [];
    // Beide Listen: liegt das Rohr auf einer Achse, ist die Huelse diagonal --
    // liegt es schraeg (Rohr an einer Winkelkupplung), ist sie kardinal.
    for (const d of [...DIAGONAL_DIRECTIONS, ...DIRECTIONS]) {
      const dot = d.vec[0] * dir[0] + d.vec[1] * dir[1] + d.vec[2] * dir[2];
      if (Math.abs(dot + Math.SQRT1_2) < 0.05) out.push(d.vec.slice());
    }
    // Die Huelse haelt sich moeglichst oben: so laeuft der Aufbau nach oben
    // weiter statt in den Boden.
    out.sort((a, b) => b[1] - a[1]);
    return out;
  }

  /**
   * Winkelkupplung DIREKT in ein Rohrende stecken: ihr 45-Grad-Fortsatz steckt
   * im Rohr, die Huelse zeigt 45 Grad davon weg.
   *
   * Damit ersetzt sie die Dummy-Kupplung am Rohrende -- der Knoten wird zum
   * Adapter-Koerper. Am anderen Ende der Huelse entsteht eine neue
   * Dummy-Kupplung: dort passt nur ein Kupplungs-STUTZEN hinein, kein Rohr.
   * Sie wird um die Huelsenachse gedreht angelegt, damit ihre eigenen Arme
   * stimmen und dort alles Weitere gesetzt werden kann.
   *
   * Der Aufbau ist derselbe wie beim Schraegbau (`extendC45Diagonal`):
   * Kupplung -- Huelse -- Adapter-Koerper -- 45-Grad-Arm; nur entsteht hier
   * nicht das Rohr, sondern die Kupplung neu.
   */
  addC45OnTube(nodeId, axis, sleeveLen, armLen) {
    const body = this.nodes.get(nodeId);
    if (!body) return null;
    const dir = this.c45TubeDir(body);
    if (!dir || !axis) return null;
    // Die Kupplung sitzt eine Huelsenlaenge und einen Arm zurueck -- genau so,
    // dass `body` auf ihrem 45-Grad-Arm landet.
    const bx = body.x - axis[0] * sleeveLen - dir[0] * armLen;
    const by = body.y - axis[1] * sleeveLen - dir[1] * armLen;
    const bz = body.z - axis[2] * sleeveLen - dir[2] * armLen;
    if (this.isBelowGround(by)) return { ground: true };
    const base = this.addNode(round(bx), round(by), round(bz));
    // Ihre Wuerfelachsen folgen der Huelse: lokal +X zeigt zum Adapter.
    base.quat = quatFromXAxis(axis);
    body.c45 = true;
    body.c45body = true;
    body.c45axis = axis.slice();
    this.addArm(base.id, body.id);
    this._syncC45Flag(base.id);
    return { body, base };
  }

  /**
   * Eine ins Rohr gesteckte Winkelkupplung um 90 Grad um die ROHRACHSE weiter
   * drehen -- mit ihr wandert die Dummy-Kupplung an der Huelse.
   *
   * `rotateC45` dreht die andere Seite (alles, was am Adapter haengt); hier
   * steckt der Adapter im Rohr, also dreht sich die Huelsenseite. Traegt die
   * Kupplung an der Huelse schon etwas anderes, bleibt alles stehen.
   */
  rotateC45Sleeve(bodyId) {
    const body = this.nodes.get(bodyId);
    if (!body || !body.c45body || !body.c45axis) return false;
    const dir = this._c45BodyTubeDir(bodyId);
    if (!dir) return false;
    let base = null;
    for (const t of this.tubes.values()) {
      if (!t.arm) continue;
      const id = t.a === bodyId ? t.b : t.b === bodyId ? t.a : null;
      if (id) { base = this.nodes.get(id); break; }
    }
    if (!base) return false;
    // Nur solange an der Huelsen-Kupplung nichts weiter haengt: sonst zoege die
    // Drehung das halbe Modell mit.
    for (const t of this.tubes.values()) {
      if (t.arm) continue;
      if (t.a === base.id || t.b === base.id) return false;
    }
    const dreh = (v) => {
      // 90 Grad um `dir`: v' = (dir x v) + dir (dir . v)
      const c = cross3(dir, v);
      const d = dot3(dir, v);
      return [c[0] + dir[0] * d, c[1] + dir[1] * d, c[2] + dir[2] * d];
    };
    const achse = dreh(body.c45axis);
    const r = dreh([base.x - body.x, base.y - body.y, base.z - body.z]);
    const p = { x: body.x + r[0], y: body.y + r[1], z: body.z + r[2] };
    if (this.isBelowGround(p.y)) return false;
    base.x = round(p.x); base.y = round(p.y); base.z = round(p.z);
    const L = Math.hypot(achse[0], achse[1], achse[2]) || 1;
    const r4 = (v) => Math.round((v / L) * 1e4) / 1e4;
    body.c45axis = [r4(achse[0]), r4(achse[1]), r4(achse[2])];
    base.quat = quatFromXAxis(body.c45axis);
    this._moveTubeGeom(new Set([base.id]));
    return true;
  }

  /**
   * Winkelkupplung entfernen -- OHNE die Rohre mitzunehmen.
   *
   * Anders als eine gewoehnliche Kupplung haelt sie zwei Enden zusammen, die
   * fuer sich weiterbestehen: der Adapter-Koerper wird wieder zur
   * Dummy-Kupplung am Rohrende, die Kupplung an der Huelse bleibt stehen. Weg
   * kommen nur die Huelse (Arm-Kante) und das Kennzeichen. Was danach gar
   * nichts mehr haelt, faellt weg.
   */
  removeC45(bodyId) {
    const body = this.nodes.get(bodyId);
    if (!body || !body.c45body) return false;
    let baseId = null;
    for (const t of [...this.tubes.values()]) {
      if (!t.arm) continue;
      const other = t.a === bodyId ? t.b : t.b === bodyId ? t.a : null;
      if (!other) continue;
      baseId = other;
      this.tubes.delete(t.id);
    }
    body.c45 = false;
    body.c45body = false;
    body.c45axis = null;
    body.c45quat = null;
    body.c45file = false;
    body.ownConnector = false;
    if (baseId) this._syncC45Flag(baseId);
    // Knoten, die nun nichts mehr halten, verschwinden -- ein Wuerfel ohne
    // Rohr steht sonst allein in der Luft.
    for (const id of [bodyId, baseId]) {
      if (!id) continue;
      const n = this.nodes.get(id);
      if (n && this.degree(id) === 0) this.nodes.delete(id);
    }
    return true;
  }

  /** Richtung des Rohrs, das im Adapter-Koerper steckt (vom Koerper weg). */
  _c45BodyTubeDir(bodyId) {
    const body = this.nodes.get(bodyId);
    if (!body) return null;
    for (const t of this.tubes.values()) {
      if (t.arm || t.link) continue;
      const id = t.a === bodyId ? t.b : t.b === bodyId ? t.a : null;
      if (!id) continue;
      const nb = this.nodes.get(id);
      if (!nb) continue;
      const v = [nb.x - body.x, nb.y - body.y, nb.z - body.z];
      const L = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / L, v[1] / L, v[2] / L];
    }
    return null;
  }

  addC45Adapter(fromId, axis, dir, sleeveLen, armLen) {
    const from = this.nodes.get(fromId);
    if (!from) return null;
    const bx = from.x + axis[0] * sleeveLen + dir[0] * armLen;
    const by = from.y + axis[1] * sleeveLen + dir[1] * armLen;
    const bz = from.z + axis[2] * sleeveLen + dir[2] * armLen;
    if (this.isBelowGround(by)) return { ground: true };
    const body = this.addNode(round(bx), round(by), round(bz));
    body.c45 = true;
    body.c45body = true;
    body.c45axis = axis.slice();
    this.addArm(from.id, body.id);
    this._syncC45Flag(from.id);
    return { body };
  }

  /**
   * Winkelkupplung um 90 Grad um ihre Huelsenachse weiterdrehen -- mit allem,
   * was an ihr haengt. Vier Stellungen, danach ist sie wieder am Anfang.
   */
  rotateC45(bodyId) {
    const body = this.nodes.get(bodyId);
    if (!body || !body.c45body || !body.c45axis) return false;
    // Die Kupplung, auf der die Huelse steckt: ueber die Arm-Kante.
    let baseId = null;
    for (const t of this.tubes.values()) {
      if (!t.arm) continue;
      if (t.a === bodyId) baseId = t.b;
      else if (t.b === bodyId) baseId = t.a;
      if (baseId) break;
    }
    const base = baseId && this.nodes.get(baseId);
    if (!base) return false;
    const u = body.c45axis;
    // Drehpunkt: die Kupplung selbst; gedreht wird um ihre Huelsenachse.
    const dreh = (p) => {
      const r = [p.x - base.x, p.y - base.y, p.z - base.z];
      const c = cross3(u, r);
      const d = dot3(u, r);
      // 90 Grad: cos = 0, sin = 1 -> p' = (u x r) + u (u . r)
      return { x: base.x + c[0] + u[0] * d, y: base.y + c[1] + u[1] * d, z: base.z + c[2] + u[2] * d };
    };
    // Alles, was an der Winkelkupplung haengt -- aber nicht ueber die Huelse
    // zurueck in die tragende Kupplung.
    const seen = new Set([bodyId, baseId]);
    const stack = [bodyId];
    while (stack.length) {
      const id = stack.pop();
      for (const t of this.tubes.values()) {
        const other = t.a === id ? t.b : t.b === id ? t.a : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    seen.delete(baseId);
    const zweig = [...seen].map((id) => this.nodes.get(id)).filter(Boolean).map((n) => ({ n, p: dreh(n) }));
    if (zweig.some((e) => this.isBelowGround(e.p.y))) return false;
    for (const e of zweig) { e.n.x = round(e.p.x); e.n.y = round(e.p.y); e.n.z = round(e.p.z); }
    const bewegt = new Set(zweig.map((e) => e.n.id));
    this._moveTubeGeom(bewegt);
    this._movePanelGeom(bewegt);
    return true;
  }

  // Aussenmasse des Modells in cm. Die Bounding-Box laeuft ueber alle Kupplungen
  // (Platten/Netze haengen an ihnen) plus die Eckpunkte der Rutschen, die ueber
  // das Rohrgeruest hinausragen. `pad` schlaegt an jeder Seite etwas drauf --
  // die Kupplungswuerfel stehen um ihre halbe Kantenlaenge ueber den Knoten
  // hinaus, sonst faelle das Mass um eine Kupplung zu klein aus.
  // Liefert null, solange nichts gebaut ist.
  bounds(pad = 0) {
    let lo = null, hi = null;
    const push = (x, y, z) => {
      if (!lo) { lo = [x, y, z]; hi = [x, y, z]; return; }
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    };
    for (const n of this.nodes.values()) push(n.x, n.y, n.z);
    for (const f of (this.fittings ? this.fittings.values() : [])) push(f.x, f.y, f.z);
    for (const s of (this.slides ? this.slides.values() : [])) {
      push(s.x, s.y, s.z);
      if (s.hook && s.hook.length === 3) push(s.hook[0], s.hook[1], s.hook[2]);
    }
    if (!lo) return null;
    return {
      min: [lo[0] - pad, lo[1] - pad, lo[2] - pad],
      max: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
      size: [hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad],
    };
  }

  // 只包住给定零件（拼装说明书按「当前已出现」框镜头，避免早期步骤缩在画面中间）。
  boundsOf(ids, pad = 0) {
    if (!ids) return this.bounds(pad);
    const want = ids instanceof Set ? ids : new Set(ids);
    if (!want.size) return this.bounds(pad);
    let lo = null, hi = null;
    const push = (x, y, z) => {
      if (!lo) { lo = [x, y, z]; hi = [x, y, z]; return; }
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    };
    const pushNode = (n) => { if (n) push(n.x, n.y, n.z); };
    for (const n of this.nodes.values()) {
      if (want.has(n.id)) pushNode(n);
    }
    for (const t of this.tubes.values()) {
      if (!want.has(t.id)) continue;
      pushNode(this.nodes.get(t.a));
      pushNode(this.nodes.get(t.b));
    }
    for (const p of this.panels.values()) {
      if (!want.has(p.id)) continue;
      const cor = this.panelCorners(p);
      if (cor) for (const c of cor) push(c[0], c[1], c[2]);
    }
    for (const p of (this.textiles ? this.textiles.values() : [])) {
      if (!want.has(p.id)) continue;
      const cor = this.panelCorners(p);
      if (cor) for (const c of cor) push(c[0], c[1], c[2]);
    }
    for (const f of (this.fittings ? this.fittings.values() : [])) {
      if (want.has(f.id)) push(f.x, f.y, f.z);
    }
    for (const s of (this.slides ? this.slides.values() : [])) {
      if (!want.has(s.id)) continue;
      push(s.x, s.y, s.z);
      if (s.hook && s.hook.length === 3) push(s.hook[0], s.hook[1], s.hook[2]);
    }
    if (!lo) return this.bounds(pad);
    return {
      min: [lo[0] - pad, lo[1] - pad, lo[2] - pad],
      max: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
      size: [hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad],
    };
  }

  // Naechster vorhandener Knoten innerhalb tol um p, ohne die ausgeschlossenen ids.
  _nodeNear(p, tol, exclude = []) {
    let best = null, bestD = tol;
    for (const n of this.nodes.values()) {
      if (exclude.includes(n.id)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z);
      if (d <= bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // Schräg-Rohr an einer (schon rotierten) Schräg-Kupplung weiterbauen. Wie
  // extend, aber wenn am Zielpunkt schon ein Konnektor sitzt (im Schräg-Raster
  // ~41 cm statt 40), wird grosszuegig daran angeschlossen -> nach Loeschen+
  // Neusetzen werden die Rohre wieder sauber zusammengefuehrt. Kein C45-Adapter
  // (die Kupplung ist bereits 45-Grad gedreht).
  extendDiagonalSnap(fromId, dir, tubeId, color, length, spacing, snapTol = DIAGONAL_SNAP_TOL) {
    const from = this.nodes.get(fromId);
    if (!from) return null;
    const tx = from.x + dir[0] * spacing, ty = from.y + dir[1] * spacing, tz = from.z + dir[2] * spacing;
    let best = null, bestD = snapTol;
    for (const n of this.nodes.values()) {
      if (n.id === fromId) continue;
      const d = Math.hypot(n.x - tx, n.y - ty, n.z - tz);
      if (d <= bestD) { bestD = d; best = n; }
    }
    if (best) {
      if (this.tubeBetween(fromId, best.id)) return { node: best, tube: null, duplicate: true };
      if (this.tubeCollision(from, best)) return { collision: true };
      const tube = this.addTube(fromId, best.id, tubeId, color, length);
      return { node: best, tube };
    }
    // Ohne Rasterpunkt entsteht ein neuer Knoten -- extend() prueft den Boden.
    return this.extend(fromId, dir, tubeId, color, length, spacing);
  }

  // Bogenrohr (Viertelkreis) anbauen. dirVec ist die Tangente am Startknoten,
  // normal die Richtung zum Kreismittelpunkt (senkrecht dazu), R der Radius.
  // Endpunkt = from + R * (dir + normal); der Mittelpunkt wird mitgespeichert,
  // damit die Szene denselben Bogen zeichnet wie beim QDF-Import.
  extendBow(fromNodeId, dirVec, normal, tubeId, color, R) {
    const from = this.nodes.get(fromNodeId);
    if (!from) return null;
    const cx = from.x + normal[0] * R, cy = from.y + normal[1] * R, cz = from.z + normal[2] * R;
    const target = {
      x: from.x + R * (dirVec[0] + normal[0]),
      y: from.y + R * (dirVec[1] + normal[1]),
      z: from.z + R * (dirVec[2] + normal[2]),
    };
    // Der Bogen haengt zwischen Start und Ziel durch: der tiefste Punkt liegt
    // bei einem abwaerts fuehrenden Viertelkreis am Mittelpunkt der Sehne.
    if (this.isBelowGround(target.y) || this.isBelowGround(cy)) return { ground: true };
    const existing = this.findNodeNear(target.x, target.y, target.z);
    if (existing && this.tubeBetween(from.id, existing.id)) {
      return { node: existing, tube: null, duplicate: true };
    }
    const to = this.addNode(round(target.x), round(target.y), round(target.z));
    if (from.id === to.id) return null;
    const tube = this.addTube(from.id, to.id, tubeId, color, null);
    if (tube) {
      tube.bow = true;
      tube.bowCenter = [round(cx), round(cy), round(cz)];
    }
    return { node: to, tube };
  }

  /**
   * Bogenrohr um 90 Grad um seine eigene Tangente drehen.
   *
   * Der Startknoten und die Richtung, in der der Bogen die Kupplung verlaesst,
   * bleiben stehen; die Kruemmungsebene kippt. Nach vier Aufrufen ist der Bogen
   * wieder da, wo er war. Das Ende wandert dabei auf einen neuen Rasterpunkt --
   * ein dadurch verwaister Knoten wird entfernt.
   *
   * Liefert { node } oder { ground:true } / { duplicate:true }.
   *
   * steps < 0 转另一个方向（Q 键）；pivot 指定绕哪一头转（默认 a 头），
   * 传 b 头就先把两头对调——弯管两头本来就没有先后。
   */
  rotateBow(id, steps = 1, { pivot } = {}) {
    const t = this.tubes.get(id);
    if (!t || !t.bow || !t.bowCenter) return null;
    if (pivot != null && pivot === t.b) { const tmp = t.a; t.a = t.b; t.b = tmp; }
    const a = this.nodes.get(t.a), b = this.nodes.get(t.b);
    if (!a || !b) return null;
    const c = { x: t.bowCenter[0], y: t.bowCenter[1], z: t.bowCenter[2] };
    const R = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
    if (R < 1) return null;
    const n = [(c.x - a.x) / R, (c.y - a.y) / R, (c.z - a.z) / R];
    // Tangente am Anfang: Sehne minus Radiusanteil, normiert.
    const t0 = unit([(b.x - a.x) / R - n[0], (b.y - a.y) / R - n[1], (b.z - a.z) / R - n[2]]);
    // Die drei uebrigen Lagen: 90, 180, 270 Grad um die Tangente. Geht eine
    // nicht (unter dem Boden, Ziel schon verbunden), wird die naechste
    // genommen -- sonst liesse sich ein Bogen ueber dem Boden gar nicht mehr
    // bewegen, weil ausgerechnet der naechste Schritt nach unten zeigt.
    const perp = cross(t0, n);
    const back = [-n[0], -n[1], -n[2]];
    const anti = [-perp[0], -perp[1], -perp[2]];
    const order = steps < 0 ? [anti, back, perp] : [perp, back, anti];
    let blocked = null;
    for (const n2 of order) {
      const target = {
        x: round(a.x + R * (t0[0] + n2[0])),
        y: round(a.y + R * (t0[1] + n2[1])),
        z: round(a.z + R * (t0[2] + n2[2])),
      };
      const cy = a.y + n2[1] * R;
      if (this.isBelowGround(target.y) || this.isBelowGround(cy)) { blocked = { ground: true }; continue; }
      const hit = this.findNodeNear(target.x, target.y, target.z);
      if (hit && hit.id !== t.b && this.tubeBetween(t.a, hit.id)) { blocked = { duplicate: true }; continue; }

      const oldEnd = t.b;
      const to = hit || this.addNode(target.x, target.y, target.z);
      if (to.id === t.a) { blocked = { duplicate: true }; continue; }
      t.b = to.id;
      t.bowCenter = [round(a.x + n2[0] * R), round(cy), round(a.z + n2[2] * R)];
      // Zurueckgebliebener Knoten ohne Rohr verschwindet.
      if (oldEnd !== to.id && this.degree(oldEnd) === 0) this.nodes.delete(oldEnd);
      this._prunePanels();
      return { node: to };
    }
    return blocked || null;
  }

  /**
   * Platten-/Netz-Datensatz aus dem Speicherformat.
   *
   * Neue Staende bringen die beiden Tragrohre mit. Aeltere (und der QDF-Import)
   * liefern vier Eck-Knoten -- daraus werden die zwei gegenueberliegenden Rohre
   * gesucht, an denen die Platte haengt. Findet sich keines, gehoert die Platte
   * nirgends hin und faellt weg.
   */
  _panelRecord(p) {
    const side = p.side < 0 ? -1 : 1;
    if (p.a && p.b) {
      const r = { id: p.id, a: p.a, b: p.b, t0: p.t0 || 0, len: p.len || 0, color: p.color, side };
      if (p.geom) r.geom = p.geom;
      if (p.pool) r.pool = p.pool;
      if (p.poolPart) r.poolPart = true;
      return r;
    }
    if (!p.nodes || p.nodes.length !== 4) return null;
    const ns = p.nodes.map((id) => this.nodes.get(id));
    if (ns.some((n) => !n)) return null;
    // [A,B,C,D] laeuft umlaufend: Kandidaten sind (A,B)+(D,C) oder (B,C)+(A,D).
    const pairs = [[[0, 1], [3, 2]], [[1, 2], [0, 3]]];
    for (const [[i0, i1], [j0, j1]] of pairs) {
      // Erst das Rohr genau zwischen den beiden Ecken; sonst irgendeines, das
      // auf der Kante liegt. Lange Platten (Baellebad-Wand, Netze) spannen ueber
      // mehrere Rohre -- dann traegt sie das erste davon.
      const ta = this.tubeBetween(p.nodes[i0], p.nodes[i1]) || this._tubeAlong(ns[i0], ns[i1]);
      const tb = this.tubeBetween(p.nodes[j0], p.nodes[j1]) || this._tubeAlong(ns[j0], ns[j1]);
      if (!ta || !tb || ta.bow || tb.bow) continue;
      const rail = this._rail(ta.id);
      if (!rail) continue;
      const s = (n) => (n.x - rail.p0[0]) * rail.dir[0] + (n.y - rail.p0[1]) * rail.dir[1] + (n.z - rail.p0[2]) * rail.dir[2];
      const s0 = s(ns[i0]), s1 = s(ns[i1]);
      return {
        id: p.id, a: ta.id, b: tb.id,
        t0: round(Math.min(s0, s1)), len: round(Math.abs(s1 - s0)),
        color: p.color, side,
      };
    }
    return null;
  }

  /**
   * Ein Rohr, das auf der Strecke a->b liegt (gleiche Achse, echte Ueberdeckung).
   * Gebraucht fuer Platten, die ueber mehrere Rohre spannen.
   */
  _tubeAlong(a, b) {
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return null;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    let best = null, bestS = Infinity;
    for (const t of this.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      const p = this.nodes.get(t.a), q = this.nodes.get(t.b);
      if (!p || !q) continue;
      if (perpDist(a, u, p) > MERGE_EPS || perpDist(a, u, q) > MERGE_EPS) continue;
      const s0 = (p.x - a.x) * u[0] + (p.y - a.y) * u[1] + (p.z - a.z) * u[2];
      const s1 = (q.x - a.x) * u[0] + (q.y - a.y) * u[1] + (q.z - a.z) * u[2];
      if (Math.min(s0, s1) > L - MERGE_EPS || Math.max(s0, s1) < MERGE_EPS) continue;
      const start = Math.min(s0, s1);
      if (start < bestS) { bestS = start; best = t; }
    }
    return best;
  }

  isEmpty() {
    return this.nodes.size === 0;
  }

  clear() {
    this.nodes.clear();
    this.tubes.clear();
    this.panels.clear();
    this.clamps.clear();
    this.textiles.clear();
    this.slides.clear();
    this.fittings.clear();
    this.groups.clear();
    this._seq = 1;
  }

  // --- Serialisierung -----------------------------------------------------
  toJSON() {
    // 删过零件的组在这里收拾：存档、撤销快照、复制都经过这一步
    this._pruneGroups();
    return {
      format: FORMAT_VERSION,
      nodes: [...this.nodes.values()].map((n) => {
        const o = { id: n.id, x: round(n.x), y: round(n.y), z: round(n.z) };
        if (n.c45) o.c45 = true; // Knoten traegt eine 45-Grad-Winkelkupplung
        if (n.c45file) o.c45file = true; // Winkelkupplung stand so in der QDF-Datei
        if (n.unused) o.unused = true;   // aus der Datei, aber ohne Rohr/Platte
        if (n.partQuat) o.partQuat = n.partQuat; // Ausrichtung der Klemm-Kupplung aus der Datei
        if (n.partMask) o.partMask = n.partMask; // Arm-Maske der Lochzapfenkupplung
        if (n.hinges && n.hinges.length) o.hinges = n.hinges.slice(); // Stellungen der Flexi-Scharniere
        if (n.boltDeep) o.boltDeep = n.boltDeep; // Bolzen steckt zwei Segmente tief
        if (n.c45body) o.c45body = true; // Adapter-Koerper am Arm-Ende der C45
        if (n.c45axis) o.c45axis = n.c45axis; // kardinale Huelsenachse des Adapters
        if (n.c45quat) o.c45quat = n.c45quat; // eigene Lage der Winkelkupplung (Three x,y,z,w)
        if (n.armDirs) o.armDirs = n.armDirs; // gespeicherte Arm-Richtungen (rotierte Kupplung)
        if (n.arms) o.arms = n.arms; // echte Arm-Stutzen aus variant2 (Darstellung)
        if (n.quat) o.quat = n.quat; // Wuerfel-Orientierung der Kupplung (Three x,y,z,w)
        if (n.part) o.part = n.part; // festes Katalogteil (Klemm-Kupplungen)
        if (n.clampOn) o.clampOn = n.clampOn; // umschlossenes Rohr + Stelle darauf
        if (n.stub) o.stub = n.stub; // Richtung des offenen Anschlusses
        if (n.bearingOn) o.bearingOn = n.bearingOn; // getragen von dieser Lagerkupplung
        if (n.ownConnector) o.ownConnector = true; // Adapter-Koerper MIT eigener Kupplung
        if (n.preferType) o.preferType = n.preferType; // 空节点上用户点选的通型
        return o;
      }),
      tubes: [...this.tubes.values()].map((t) => {
        const o = { id: t.id, a: t.a, b: t.b, tubeId: t.tubeId, color: t.color, length: t.length };
        if (t.reinforced) o.reinforced = true;
        if (t.arm) o.arm = true; // C45-Adapter-Arm (kein Rohr)
        if (t.link) o.link = true; // Doppelrohrverbinder-Verbindung (kein Rohr)
        if (t.bow) { o.bow = true; o.bowCenter = t.bowCenter; } // Bogenrohr (Viertelkreis)
        // Eigene Lage aus einer eingelesenen Datei: Anfang, Richtung, Teilemass.
        // Sie gilt, solange das Rohr nicht bewegt wurde -- gedrehte Aufbauten
        // ueberstehen damit Laden und Speichern unveraendert.
        if (t.geom) o.geom = t.geom;
        return o;
      }),
      panels: [...this.panels.values()].map((p) => {
        const o = { id: p.id, a: p.a, b: p.b, t0: round(p.t0), len: round(p.len), panelId: p.panelId, color: p.color };
        if ((p.side || 1) < 0) o.side = -1;   // Standard ist oben/aussen
        if (p.turned) o.turned = true;        // Lippen quer statt laengs (Schrauben)
        if (p.geom) o.geom = p.geom;          // eigene Lage aus der Datei
        if (p.pool) o.pool = p.pool;          // Original-Zeile des Baellebads
        if (p.poolPart) o.poolPart = true;    // Wand/Boden eines Baellebads
        return o;
      }),
      clamps: [...this.clamps.values()].map((c) => {
        const o = { id: c.id, x: round(c.x), y: round(c.y), z: round(c.z), connectorId: c.connectorId };
        if (c.dir) o.dir = c.dir;   // Achse der gehaltenen Tubes
        if (c.off) o.off = c.off;   // Versatz zur zweiten Tube (die "8")
        return o;
      }),
      textiles: [...this.textiles.values()].map((t) => {
        const o = { id: t.id, a: t.a, b: t.b, t0: round(t.t0), len: round(t.len), w: t.w, h: t.h, color: t.color };
        if ((t.side || 1) < 0) o.side = -1;
        return o;
      }),
      fittings: [...this.fittings.values()].map((f) => {
        const o = { id: f.id, kind: f.kind, x: round(f.x), y: round(f.y), z: round(f.z) };
        if (f.quat) o.quat = f.quat;
        if (f.color) o.color = f.color;
        if (f.w != null) o.w = f.w;
        if (f.h != null) o.h = f.h;
        if (f.d != null) o.d = f.d;
        if (f.mask != null) o.mask = f.mask;
        if (f.rest) o.rest = f.rest;
        if (f.balls) o.balls = true;      // 泳池里倒了海洋球
        return o;
      }),
      slides: [...this.slides.values()].map((s) => {
        const o = { id: s.id, x: round(s.x), y: round(s.y), z: round(s.z), kind: s.kind };
        if (s.quat) o.quat = s.quat;
        if (s.hook) o.hook = s.hook; // manuell gesetzt: Einhaengepunkt am Rohrpaar
        if (s.color) o.color = s.color; // Three-Quaternion x,y,z,w (vor Rz90)
        if (s.foot) o.foot = s.foot;   // Lage des Fussrohrs, gehoert zur Rutsche
        return o;
      }),
      groups: [...this.groups.entries()].map(([id, set]) => ({ id, ids: [...set] })),
    };
  }

  // Laedt ein gespeichertes/importiertes Modell. Liefert { ok, reason }, damit
  // die UI-Schicht eine passende (uebersetzte) Meldung anzeigen kann, statt
  // ein kaputtes Modell still zu uebernehmen oder den Aufrufer abstuerzen zu
  // lassen. reason ist einer von: "format" (unbekannte/zu neue Version),
  // "data" (kein Objekt / nodes fehlt oder kein Array).
  loadJSON(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) {
      return { ok: false, reason: "data" };
    }
    // Aeltere Speicherstaende ohne "format"-Feld gelten als Version 1
    // (Legacy) und werden weiter akzeptiert -- sie werden beim Laden angehoben.
    // Abgelehnt wird nur, was NEUER ist als dieser Stand: dessen Felder kennen
    // wir nicht.
    const version = data.format != null ? data.format : 1;
    if (!(version >= 1 && version <= FORMAT_VERSION)) {
      return { ok: false, reason: "format" };
    }
    this.clear();
    let maxSeq = 0;
    for (const n of data.nodes) {
      this.nodes.set(n.id, { id: n.id, x: n.x, y: n.y, z: n.z, c45: !!n.c45, c45body: !!n.c45body,
        c45axis: n.c45axis || null, c45quat: n.c45quat || null,
        armDirs: n.armDirs || null, arms: n.arms || null, quat: n.quat || null,
        part: n.part || null, clampOn: n.clampOn || null, stub: n.stub || null,
        bearingOn: n.bearingOn || null,
        ownConnector: !!n.ownConnector, c45file: !!n.c45file, unused: !!n.unused,
        partQuat: n.partQuat || null, partMask: n.partMask || null,
        hinges: Array.isArray(n.hinges) ? n.hinges.slice() : null,
        boltDeep: n.boltDeep || 0,
        preferType: n.preferType || null });
      maxSeq = Math.max(maxSeq, parseSeq(n.id));
    }
    for (const t of data.tubes || []) {
      if (!t.a || !t.b) continue;
      if (!this.nodes.has(t.a) || !this.nodes.has(t.b)) {
        console.warn(`Ungültiges Rohr: Knoten ${t.a} oder ${t.b} existiert nicht.`);
        continue;
      }
      this.tubes.set(t.id, {
        id: t.id, a: t.a, b: t.b, tubeId: t.tubeId, color: t.color, length: t.length,
        reinforced: !!t.reinforced, arm: !!t.arm, link: !!t.link,
        bow: !!t.bow, bowCenter: t.bowCenter || null, geom: t.geom || null,
      });
      maxSeq = Math.max(maxSeq, parseSeq(t.id));
    }
    for (const p of data.panels || []) {
      const rec = this._panelRecord(p);
      if (!rec) continue;
      rec.panelId = p.panelId;
      if (p.turned) rec.turned = true;
      if (p.geom) rec.geom = p.geom;
      // Eingelesene Platte: ob sie gedreht liegt, steht in ihrer Rolllage. Die
      // Herstellersoftware speichert die Drehung genau so -- zwei Dateien mit
      // derselben Platte, einmal gedreht, unterscheiden sich AUSSCHLIESSLICH im
      // Quaternion (Platte1/Platte2.qdf). Laeuft die lokale X-Achse quer zu den
      // Tragrohren, liegen die Lippen quer: gedreht.
      if (!rec.turned && rec.geom && rec.geom.quat) rec.turned = this._panelTurnedFromQuat(rec);
      if (p.pool) rec.pool = p.pool;
      if (p.poolPart) rec.poolPart = true;
      this.panels.set(p.id, rec);
      maxSeq = Math.max(maxSeq, parseSeq(p.id));
    }
    for (const c of data.clamps || []) {
      // Version 1 fuehrte den Punkt in der MITTE zwischen beiden Loechern; seit
      // Version 2 liegt er im Loch des gehaltenen Rohrs. Beim Laden also eine
      // halbe Lochweite weiterschieben, sonst haengt die Klemme neben dem Rohr.
      // Der Versatz zeigt vom gehaltenen Rohr zum freien Loch, die alte Mitte lag
      // also eine halbe Lochweite DAHINTER -- zurueckschieben.
      const alt = version < 2 && c.off ? c.off : null;
      this.clamps.set(c.id, {
        id: c.id,
        x: round(c.x - (alt ? alt[0] / 2 : 0)),
        y: round(c.y - (alt ? alt[1] / 2 : 0)),
        z: round(c.z - (alt ? alt[2] / 2 : 0)),
        connectorId: c.connectorId || "double_tube",
        dir: c.dir || null, off: c.off || null,
      });
      maxSeq = Math.max(maxSeq, parseSeq(c.id));
    }
    for (const t of data.textiles || []) {
      const rec = this._panelRecord(t);
      if (!rec) continue;
      rec.w = t.w; rec.h = t.h;
      this.textiles.set(t.id, rec);
      maxSeq = Math.max(maxSeq, parseSeq(t.id));
    }
    for (const f of data.fittings || []) {
      // Bis Version 1 stand die Rohrkappe als `open-connector2` im Stand -- das
      // ist in Wahrheit das offene Verbinderende (eine Huelse auf einem
      // Kupplungs-Stutzen). Die Kappe heisst jetzt nach ihrem eigenen Element.
      const kind = version < 2 && f.kind === "open-connector2" ? "tube-cap2" : f.kind;
      this.fittings.set(f.id, {
        id: f.id, kind, x: f.x, y: f.y, z: f.z,
        quat: f.quat || null, color: f.color || null,
        w: f.w, h: f.h, d: f.d, mask: f.mask,
        // Felder aus der Datei, die wir nur durchreichen (Flexikupplung & Co.)
        rest: f.rest || null,
        balls: !!f.balls,
      });
      maxSeq = Math.max(maxSeq, parseSeq(f.id));
    }
    for (const s of data.slides || []) {
      this.slides.set(s.id, { id: s.id, x: s.x, y: s.y, z: s.z, quat: s.quat || null, hook: s.hook || null,
        color: s.color || null, foot: s.foot || null, kind: s.kind });
      maxSeq = Math.max(maxSeq, parseSeq(s.id));
    }
    for (const g of data.groups || []) {
      if (!g || !g.id || !Array.isArray(g.ids)) continue;
      this.groups.set(g.id, new Set(g.ids));
      maxSeq = Math.max(maxSeq, parseSeq(g.id));
    }
    this._pruneGroups();
    this._seq = maxSeq + 1;
    return { ok: true };
  }
}

// 两端是否落在同一对点上（方向可反）。贴面共用的边会在合并后被去掉。
function segmentsCoincide(p1, p2, p3, p4) {
  const e = MERGE_EPS * MERGE_EPS;
  const same = (a, b) => dist2(a, b) <= e;
  return (same(p1, p3) && same(p2, p4)) || (same(p1, p4) && same(p2, p3));
}

// Ueberlappen sich die Strecken p1->p2 und p3->p4 kollinear mit Laenge > eps?
function segmentsOverlap(p1, p2, p3, p4) {
  const d = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  const u = [d[0] / len, d[1] / len, d[2] / len];
  // p3, p4 muessen auf der Geraden durch p1 in Richtung u liegen.
  if (perpDist(p1, u, p3) > MERGE_EPS || perpDist(p1, u, p4) > MERGE_EPS) return false;
  const t3 = (p3.x - p1.x) * u[0] + (p3.y - p1.y) * u[1] + (p3.z - p1.z) * u[2];
  const t4 = (p4.x - p1.x) * u[0] + (p4.y - p1.y) * u[1] + (p4.z - p1.z) * u[2];
  const lo = Math.max(0, Math.min(t3, t4));
  const hi = Math.min(len, Math.max(t3, t4));
  return hi - lo > MERGE_EPS;
}

// Schneiden sich die Strecken p1->p2 und q1->q2 (nicht parallel) so, dass der
// Treffpunkt im Inneren mindestens einer Strecke liegt? Beruehrung an einem
// gemeinsamen Endpunkt (Kupplung) zaehlt nicht. Faengt den Fall ab, dass ein
// neues Rohr quer ueber ein laengeres Rohr (z. B. 75er) gebaut wird.
function segmentsCross(p1, p2, q1, q2) {
  const d1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const d2 = { x: q2.x - q1.x, y: q2.y - q1.y, z: q2.z - q1.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  if (a < 1e-9 || e < 1e-9) return false;
  const r = { x: p1.x - q1.x, y: p1.y - q1.y, z: p1.z - q1.z };
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
  const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
  const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
  const denom = a * e - b * b;
  if (Math.abs(denom) < 1e-9) return false; // (nahezu) parallel -> kollinear separat geprueft
  let s = (b * f - c * e) / denom;
  let t = (a * f - b * c) / denom;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  const x1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const x2 = { x: q1.x + d2.x * t, y: q1.y + d2.y * t, z: q1.z + d2.z * t };
  if (dist2(x1, x2) > MERGE_EPS * MERGE_EPS) return false; // treffen sich nicht
  const eps = MERGE_EPS;
  const interior1 = Math.sqrt(dist2(x1, p1)) > eps && Math.sqrt(dist2(x1, p2)) > eps;
  const interior2 = Math.sqrt(dist2(x2, q1)) > eps && Math.sqrt(dist2(x2, q2)) > eps;
  return interior1 || interior2;
}

// Senkrechter Abstand des Punktes p von der Geraden (origin, Richtung u, |u|=1).
function perpDist(origin, u, p) {
  const r = [p.x - origin.x, p.y - origin.y, p.z - origin.z];
  const t = r[0] * u[0] + r[1] * u[1] + r[2] * u[2];
  const px = r[0] - t * u[0], py = r[1] - t * u[1], pz = r[2] - t * u[2];
  return Math.hypot(px, py, pz);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function parseSeq(id) {
  const m = /(\d+)$/.exec(id || "");
  return m ? parseInt(m[1], 10) : 0;
}
