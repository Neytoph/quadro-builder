// Export ins QDF-Format der originalen QUADRO-3D-Software.
//
// Gegenstueck zu qdfimport.js -- dort steht die Beschreibung des Formats. Kurz:
// Textdatei, eine Anweisung je Zeile, Koordinaten in Zehntel-Millimetern... genauer:
// in mm (Raster 400 mm = 40 cm), y = oben, Zeilenende CRLF.
//
// Drei Eigenheiten des Formats, die man beim Schreiben kennen muss:
//   1. Die Quaternion-Komponenten stehen vorzeichenbehaftet QUADRIERT in der
//      Datei (sign*v^2) und zusaetzlich mit 4 skaliert -- die vier Betraege
//      summieren sich in den Herstellerdateien ausnahmslos zu 4. Unser Import
//      normiert und merkt den Unterschied nicht; die Originalsoftware rechnet
//      ohne Normierung weiter und stellt ein falsch skaliertes Modell voellig
//      verdreht dar.
//   2. Rohre und Platten speichern das TEILEMASS, nicht die Rasterspannweite:
//      ein 40-cm-Feld steht als 350 (= 35 cm Rohr) in der Datei. Die Kupplung
//      steuert die fehlenden 5 cm bei (geometry.connectorSize). Hinter jedem
//      Mass steht ein Zuschlag, meist 0 -- in gedrehten Aufbauten traegt er den
//      Rest (siehe padOf in qdfimport.js); er geht unveraendert wieder hinaus.
//   3. Gedrehte Kupplungen behalten ihre Lage, und ihre Arm-Maske (variant2)
//      zaehlt die LOKALEN Wuerfelachsen, nicht die Weltachsen.
//
// Bewusst ohne Three.js und DOM -- wie qdfimport.js in Node testbar.

import { geometry, getPanel, getTube } from "./catalog.js";
import { ACCESSORY_IDS } from './accessoryPack.js';
import { officialColorId } from "./colors.js";
import { panelNormal, modelMiddle } from "./util.js";
import { isHolePart, HOLE_MASKS, BLACK_FITTINGS, isBoltPart, boltAxis, boltDepth, hingeDir, fixedFittingColor } from "./model.js";

// Farbtabelle wie in den Dateien der Herstellersoftware: erst der Satz fuer
// Rohre und Kupplungen (kind 1), dann derselbe Satz fuer Platten (kind 2). Die
// Namen sind entscheidend -- der Import bildet ueber sie auf unsere Farb-IDs ab.
const MATERIALS = [
  'material3{1,"black", 1, 1.,1.,1., 0.,0.,1.,7.5, 0.,0.,0.,7.5, "", 0}',
  'material3{2,"red", 1, 1.,0.,0., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{3,"green", 1, 0.,0.5,0.1, 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{4,"blue", 1, 0.,0.,1., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{5,"yellow", 1, 1.,1.,0., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{6,"red", 2, 1.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{7,"green", 2, 0.,0.4941,0.0941, 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{8,"blue", 2, 0.,0.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{9,"yellow", 2, 1.,1.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  // 11 ist die Nummer, unter der die Herstellerdateien das Alu-Profil fuehren
  // (218 von 239 Dateien) -- die alu2-Zeilen verweisen darauf.
  'material3{11,"alu", 1, 0.8,0.8,0.8, 0.5,0.4,0.7,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{13,"Aluminium", 1, 0.8,0.8,0.8, 0.5,0.4,0.7,7.5, 0.3,0.,0.,7.5, "", 0}',
  'material3{14,"white", 2, 1.,1.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  // Lochplatten. Das Format kennt sie nicht: `panel2` hat kein freies Feld
  // (Feld 2 ist der Sichtbarkeits-Schalter, Feld 7/8 sind Bearbeitungsschritte)
  // und in der Schluesselwort-Tabelle der Binary steht keine eigene Art. Damit
  // sie Speichern und Laden trotzdem ueberleben, tragen sie ein eigenes
  // MATERIAL: dieselben Farbwerte wie die volle Platte, nur unter eigener
  // Nummer und mit einem Namen, an dem wir sie wiedererkennen. Die
  // Herstellersoftware zeichnet sie damit als gewoehnliche Platte in derselben
  // Farbe -- die Datei bleibt also gueltig und sieht dort richtig aus.
  //
  // Dass zusaetzliche Materialien vertragen werden, steht in den
  // Herstellerdateien selbst: 19 von ihnen fuehren eine Nummer 20, sechs eine
  // 21, mit frei getexteten Namen bis hin zu "new material". Die Nummern
  // 15 bis 19 sind im ganzen Bestand frei.
  'material3{15,"red (hole)", 2, 1.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{16,"green (hole)", 2, 0.,0.4941,0.0941, 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{17,"blue (hole)", 2, 0.,0.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{18,"yellow (hole)", 2, 1.,1.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{19,"black (hole)", 2, 0.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  // Acrylglasplatten: derselbe Kniff wie bei den Lochplatten. Die Nummern 20
  // und 21 tauchen in Herstellerdateien mit freien Namen auf, deshalb 22 bis 26.
  'material3{22,"red (acrylic)", 2, 1.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{23,"green (acrylic)", 2, 0.,0.4941,0.0941, 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{24,"blue (acrylic)", 2, 0.,0.,1., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{25,"yellow (acrylic)", 2, 1.,1.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
  'material3{26,"black (acrylic)", 2, 0.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
];

// 功能板（兼容件）：同一个办法，材质名「<color> (<feature>)」，从 27 号起每种
// 五个颜色。官方软件按颜色画一块普通板，我们导入时按名字认回来。顺序固定，
// 编号才不会因为加了一种就全变。
const FEATURE_KEYS = ["lego", "honeycomb", "busy", "felt", "magnet", "climbing", "sensory", "pocket", "basin", "rainbow", "bridge"];
const FEATURE_RGB = { red: "1.,0.,0.", green: "0.,0.4941,0.0941", blue: "0.,0.,1.", yellow: "1.,1.,0.", black: "0.,0.,0." };
const FEATURE_MAT = {};
{
  let nr = 27;
  for (const key of FEATURE_KEYS) {
    FEATURE_MAT[key] = {};
    for (const [color, rgb] of Object.entries(FEATURE_RGB)) {
      MATERIALS.push(`material3{${nr},"${color} (${key})", 2, ${rgb}, 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}`);
      FEATURE_MAT[key][color] = nr++;
    }
  }
}

// Farb-ID -> Material-Nummer. Rohre nehmen den ersten Satz, Platten den zweiten;
// schwarze Platten gibt es dort nicht, sie fallen auf das schwarze Material des
// ersten Satzes zurueck.
const TUBE_MAT = { black: 1, red: 2, green: 3, blue: 4, yellow: 5 };

const PANEL_MAT = { red: 6, green: 7, blue: 8, yellow: 9, black: 1, white: 14 };
// Lochplatten: dieselbe Farbe, eigene Materialnummer -- daran erkennen wir sie
// beim Einlesen wieder (siehe MATERIALS). Weiss hat keine Lochplatte.
const HOLE_MAT = { red: 15, green: 16, blue: 17, yellow: 18, black: 19 };
// Acrylglasplatten: Rahmenfarbe, eigene Materialnummer (siehe MATERIALS).
const ACRYLIC_MAT = { red: 22, green: 23, blue: 24, yellow: 25, black: 26 };
// Verstaerkungsprofil: Material 11 in 166 von 174 Vorkommen der Herstellerdateien.
const ALU_MAT = 11;
const CONNECTOR_MAT = 1;

// Sichtbarkeitsmaske der Kupplungsflaechen (0xFFF), wie in den Originaldateien.
const RENDER_MASK = 4095;

// Arm-Bits einer Kupplung (variant2): lokale Achsen des Wuerfels.
const ARM_BITS = [
  [0x01, [1, 0, 0]], [0x02, [-1, 0, 0]],
  [0x04, [0, 1, 0]], [0x08, [0, -1, 0]],
  [0x10, [0, 0, 1]], [0x20, [0, 0, -1]],
];

// Kamerazeilen (camera2) schreiben wir NICHT: die Herstellersoftware hat eine
// eigene Standardansicht, und was die 25 Felder im Einzelnen steuern, wissen
// wir nicht. Unser Import ueberliest sie ohnehin.
const EOL = "\r\n";

/** Zahl im Stil der Originaldateien: ganze Werte mit angehaengtem Punkt. */
function fmt(v) {
  const n = Math.abs(v) < 1e-9 ? 0 : v;
  if (Number.isInteger(n)) return `${n}.`;
  return String(Math.round(n * 1e6) / 1e6);
}

const mm = (cm) => fmt(Math.round(cm * 10 * 1e4) / 1e4);

// Die gespeicherten Quadrate sind mit 4 skaliert: in JEDER der 10.958 geprueften
// Zeilen der Herstellerdateien summieren sich die vier Betraege exakt zu 4 (die
// Einheitsquaternion allein ergaebe 1). Unser Import normiert und merkt den
// Unterschied nicht -- die Originalsoftware rechnet ohne Normierung weiter und
// stellt ein Modell mit Faktor 1 voellig verdreht dar.
const QUAT_SCALE = 4;

/** Einheitsquaternion [w,x,y,z] -> die vier Dateiwerte (vorzeichenbehaftet quadriert). */
function encodeQuat(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((c) => {
    const u = c / n;
    return fmt(Math.round(Math.sign(u) * u * u * QUAT_SCALE * 1e12) / 1e12);
  });
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** Vektor mit dem Quaternion [w,x,y,z] drehen (wie qdfimport.rotateByQuat). */
function rotateByQuat(q, v) {
  let [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c);
  const c2 = cross(u, t);
  return [v[0] + w * t[0] + c2[0], v[1] + w * t[1] + c2[1], v[2] + w * t[2] + c2[2]];
}
/** Gegendrehung: Welt -> lokale Achsen der Kupplung. */
function conjugate(q) { return [q[0], -q[1], -q[2], -q[3]]; }

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Richtung des Kupplungs-Stutzens, in dem ein Bogenrohr steckt.
 *
 * Der Bogen ist ein Viertelkreis um `center`; am Knoten `from` verlaesst er die
 * Kupplung entlang der Tangente. Fuer 90 Grad ist die Tangente am einen Ende
 * genau der Radiusvektor des anderen Endes -- das spart jede Winkelrechnung.
 */
function bowStubDir(from, other, center) {
  return norm([other.x - center[0], other.y - center[1], other.z - center[2]]);
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Kuerzeste Drehung, die die lokale +X-Achse auf dir legt. */
function quatFromX(dir) {
  const d = norm(dir);
  const c = dot([1, 0, 0], d);
  if (c > 0.999999) return [1, 0, 0, 0];
  if (c < -0.999999) return [0, 0, 1, 0];        // 180 Grad um Y
  const axis = cross([1, 0, 0], d);
  const s = Math.sqrt((1 + c) * 2);
  return [s / 2, axis[0] / s, axis[1] / s, axis[2] / s];
}

/**
 * Drehung einer Klemme: die lokale +X-Achse laeuft mit dem gehaltenen Rohr, die
 * Richtung zum zweiten Loch liegt bei der Rohrklammer auf der lokalen +Y-, beim
 * Doppelrohrverbinder auf der lokalen -Z-Achse.
 */
function clampQuat(dir, off, clip) {
  const ex = norm(dir);
  let o = norm(off);
  const p = dot(o, ex);
  o = norm([o[0] - ex[0] * p, o[1] - ex[1] * p, o[2] - ex[2] * p]);
  return clip ? quatFromAxes(ex, o, cross(ex, o))
    : quatFromAxes(ex, cross([-o[0], -o[1], -o[2]], ex), [-o[0], -o[1], -o[2]]);
}

/**
 * Die beiden Zahlenfelder einer `flexi-connector3`-Zeile, die nicht in der
 * Drehung stecken -- gelesen aus den 168 Vorkommen des Bestands:
 *   Feld 4 ist 0, wenn der Arm des Scharniers senkrecht nach unten haengt, und
 *          60, wenn er 45 Grad daneben steht (andere Werte kommen nicht vor).
 *   Feld 7 zaehlt bei haengendem Arm die Bolzenachse durch (+X 32, +Z 33,
 *          -X 34, -Z 35); bei 45 Grad steht dort 16, 17 oder 18. Welche Regel
 *          das genau ist, wissen wir NICHT -- gezeichnet wird das Teil aus der
 *          Drehung, deshalb genuegt ein Wert, der im Bestand vorkommt (17).
 * Beide Felder sind damit VERMUTET, siehe docs/QDF-FORMAT.md.
 */
function hingeFields(achse, arm) {
  const unten = arm[1] < -0.9;
  if (!unten) return "60, 0, 8, 0, 17";
  const idx = Math.abs(achse[0]) > 0.5 ? (achse[0] > 0 ? 0 : 2)
    : Math.abs(achse[2]) > 0.5 ? (achse[2] > 0 ? 1 : 3) : 0;
  return `0, 0, 8, 0, ${32 + idx}`;
}

/**
 * Drehung aus einem vollstaendigen Dreibein: lokale X-, Y- und Z-Achse gehen auf
 * ex, ey, ez. Gebraucht fuer Boegen (Tangente + Normale) und Platten (die beiden
 * Kantenrichtungen).
 */
function quatFromAxes(ex, ey, ez) {
  const m = [ex, ey, ez];                        // Spalten der Drehmatrix
  const tr = m[0][0] + m[1][1] + m[2][2];
  let w, x, y, z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[1][2] - m[2][1]) / s; y = (m[2][0] - m[0][2]) / s; z = (m[0][1] - m[1][0]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[1][2] - m[2][1]) / s; x = s / 4; y = (m[1][0] + m[0][1]) / s; z = (m[2][0] + m[0][2]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[2][0] - m[0][2]) / s; x = (m[1][0] + m[0][1]) / s; y = s / 4; z = (m[2][1] + m[1][2]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[0][1] - m[1][0]) / s; x = (m[2][0] + m[0][2]) / s; y = (m[2][1] + m[1][2]) / s; z = s / 4;
  }
  return [w, x, y, z];
}

// Auch die Ruhelage traegt die Skala: (4,0,0,0), nicht (1,0,0,0).
const IDENTITY = [fmt(QUAT_SCALE), "0.", "0.", "0."];

function tuple(q, x, y, z) {
  return `{${q[0]}, ${q[1]}, ${q[2]}, ${q[3]}, ${mm(x)}, ${mm(y)}, ${mm(z)}}`;
}

function tubeMat(color) {
  return TUBE_MAT[officialColorId(color)] || TUBE_MAT.blue;
}
/**
 * Sonderplatte? "hole" fuer das Lochraster (Katalogteil `holes`), "acrylic" fuer
 * die Rahmenplatte mit Acrylglas (`acrylic`), sonst null. Beide tragen im QDF
 * ein eigenes Material, weil das Format sie nicht kennt (siehe MATERIALS).
 */
function lochplatte(p) {
  const def = getPanel(p.panelId);
  if (!def) return null;
  if (def.holes) return "hole";
  if (def.acrylic) return "acrylic";
  if (def.feature && FEATURE_MAT[def.feature]) return def.feature;
  return null;
}

function panelMat(color, variant) {
  const off = officialColorId(color);
  const special = variant === "hole" ? HOLE_MAT : variant === "acrylic" ? ACRYLIC_MAT : (variant && FEATURE_MAT[variant]) || null;
  if (special) return special[off] || special.blue;
  if (PANEL_MAT[color]) return PANEL_MAT[color];
  return PANEL_MAT[off] || PANEL_MAT.blue;
}

/**
 * Modell als QDF-Text.
 *
 * Was NICHT eins zu eins zurueckkommt, steht im README: der Import normalisiert
 * (Schraegen auf 45 Grad), und Teile ohne QDF-Entsprechung fallen weg. Geliefert
 * wird deshalb zusaetzlich eine Zaehlung, was geschrieben wurde.
 *
 * Liefert { text, stats }.
 */
/**
 * Verstaerkungsprofile aus den verstaerkten Rohren ableiten.
 *
 * Das Profil steckt nicht IN einem Rohr, es ueberbrueckt die STOSSSTELLE: in
 * den Herstellerdateien liegt jede alu2-Zeile mittig ueber der Kupplung
 * zwischen zwei kollinearen verstaerkten Rohren und reicht hoechstens 40 cm
 * nach jeder Seite (daher die beiden vorkommenden Laengen 800 mm bei 75er
 * Rohren und 600 mm bei 25ern).
 *
 * Exportiert, weil `scene.js` dieselben Laeufe zeichnet -- so steht die
 * Rechnung an EINER Stelle und Bild und Datei koennen nicht auseinanderlaufen.
 */
export function reinforcementProfiles(model) {
  const nodeOf = (id) => model.nodes.get(id);
  const list = [...model.tubes.values()].filter((t) => t.reinforced && !t.arm && !t.link
    && nodeOf(t.a) && nodeOf(t.b));
  const abstand = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const richtung = (a, b) => { const l = abstand(a, b) || 1;
    return [(b.x - a.x) / l, (b.y - a.y) / l, (b.z - a.z) / l]; };
  const byNode = new Map();
  for (const t of list) for (const id of [t.a, t.b]) {
    if (!byNode.has(id)) byNode.set(id, []);
    byNode.get(id).push(t);
  }
  const out = [];
  const gedeckt = new Set();
  for (const [id, group] of byNode) {
    const joint = nodeOf(id);
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const t1 = group[i], t2 = group[j];
      const d1 = richtung(joint, nodeOf(t1.a === id ? t1.b : t1.a));
      const d2 = richtung(joint, nodeOf(t2.a === id ? t2.b : t2.a));
      if (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2] > -0.999) continue;   // nicht gerade durch
      const half = Math.min(40, abstand(joint, nodeOf(t1.a === id ? t1.b : t1.a)),
        abstand(joint, nodeOf(t2.a === id ? t2.b : t2.a)));
      out.push({ from: [joint.x + d2[0] * half, joint.y + d2[1] * half, joint.z + d2[2] * half],
        dir: d1, len: 2 * half, tubes: [t1.id, t2.id] });
      gedeckt.add(t1.id).add(t2.id);
    }
  }
  // Ein verstaerktes Rohr ohne geraden Nachbarn (Ecke, Einzelstueck) bekommt
  // sein eigenes Profil -- sonst ginge die Verstaerkung beim Speichern verloren.
  for (const t of list) {
    if (gedeckt.has(t.id)) continue;
    const a = nodeOf(t.a), b = nodeOf(t.b);
    out.push({ from: [a.x, a.y, a.z], dir: richtung(a, b),
      len: Math.min(80, abstand(a, b)), tubes: [t.id] });
  }
  return out;
}

/**
 * Die gespeicherte Ansicht (`camera2`, docs/QDF-FORMAT.md §5.7) aus unserer
 * Kamera. Ohne Ansicht bleibt die Zeile weg und die Herstellersoftware nimmt
 * ihre eigene Vorgabe.
 *
 * Die Software dreht nicht die Kamera, sondern das MODELL: in allen
 * Herstellerdateien steht der Blickwinkel in Feld 8 (Modell-Drehwinkel),
 * waehrend die Kamera-Winkel 0 bleiben. Abstand und Hoehe sind die der Kamera,
 * beides in cm.
 *
 * Die drei abgeleiteten Groessen sind am Bestand nachgerechnet: eine Datei mit
 * 40 Grad Oeffnung fuehrt 33 mm Brennweite (12 / tan 20 Grad = 32,97), 146 cm
 * senkrechte Bildhoehe bei 200 cm Abstand (2 * 200 * tan 20 = 145,6) und
 * waagerecht das Seitenverhaeltnis mal diesen Wert.
 *
 * Geschrieben werden VIER gleiche Zeilen -- so viele legt die Software in einem
 * frischen Dokument an (eine je Ansicht), und der Dialog bearbeitet die erste.
 */
function cameraLines(cam) {
  if (!cam || !Array.isArray(cam.pos) || !Array.isArray(cam.target)) return [];
  const v = [cam.pos[0] - cam.target[0], cam.pos[1] - cam.target[1], cam.pos[2] - cam.target[2]];
  const abstand = Math.round(Math.hypot(v[0], v[2]));
  const hoehe = Math.round(v[1]);
  // Blickrichtung als Drehwinkel des Modells, 0 bis 359 Grad.
  const grad = Math.round((Math.atan2(v[0], v[2]) * 180) / Math.PI);
  const drehung = ((-grad % 360) + 360) % 360;
  const fovV = cam.fov || 45;
  const halb = Math.tan((fovV / 2) * (Math.PI / 180));
  const seiten = cam.aspect || 1;
  const fovH = Math.round((2 * Math.atan(seiten * halb) * 180) / Math.PI);
  const brennweite = Math.round(12 / halb);
  const bildH = Math.round(2 * abstand * halb);
  const bildB = Math.round(bildH * seiten);
  const zeile = [
    abstand, hoehe, 0, 0, 0,           // Kamera: Abstand, Hoehe, Links/Rechts, Dreh-, Kippwinkel
    0, 0, 0, drehung, 0,               // Modell: dasselbe -- nur der Drehwinkel traegt den Blick
    55, 0,                             // Augenhoehe (55 cm in jeder Herstellerdatei), Breite
    bildH, bildB, Math.round(fovV), fovH, brennweite,
    3000, 10, 10,                      // in jeder Zeile des Bestands gleich
    seiten.toFixed(6), fovV.toFixed(6),
    0,                                 // Format: Bildschirm
    "1.000000", "1.000000",            // eigenes Seitenverhaeltnis (nur bei Format 6)
  ].join(", ");
  return [`camera2{${zeile}}`, `camera2{${zeile}}`, `camera2{${zeile}}`, `camera2{${zeile}}`];
}

export function buildQDF(model, opts = {}) {
  const conn = geometry().connectorSize;
  const lines = ["0, 0;", ...MATERIALS, ...cameraLines(opts.camera)];
  const stats = { connectors: 0, tubes: 0, bows: 0, panels: 0, textiles: 0, clamps: 0, slides: 0, alu: 0, fittings: 0 };
  // Das Lager fuehrt eine feste Laenge (50 mm in allen Herstellerdateien).
  const cs50 = 5;

  const node = (id) => model.nodes.get(id);
  const dirOf = (a, b) => norm([b.x - a.x, b.y - a.y, b.z - a.z]);
  const lenOf = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  // Mittelpunkt des Modells: sagt bei senkrechten Platten, wo "aussen" ist.
  const middle = modelMiddle(model.nodes.values());

  // --- Kupplungen ---------------------------------------------------------
  // Der Adapterkoerper einer 45-Grad-Winkelkupplung ist kein eigenes Teil: er
  // steckt auf der Eck-Kupplung, die dafuer als connector45_2 geschrieben wird.
  for (const n of model.nodes.values()) {
    // Adapter-Koerper sind keine eigene Kupplung -- ausser am freien Ende einer
    // Schraege, wo die Datei eine connector3 fuehrt (ownConnector).
    if (n.c45body && !n.ownConnector) continue;
    // An einer Flexikupplung fuehrt die Datei keine connector3 -- dort halten
    // zwei Flexi-Arme und ein Bolzen die Rohre. Die Arme stehen als Anbauteile
    // in der Liste und werden weiter unten geschrieben.
    if (n.part === "flexi") continue;
    // Selbst gesetzte Flexikupplung: der Knoten IST der Bolzen. Er steht als
    // eigene Zeile in der Datei, dazu je Scharnier eine -- eine connector3 gibt
    // es an dieser Stelle nicht.
    if (isBoltPart(n.part)) {
      const ex = boltAxis(n);
      const tief = boltDepth(n) === 2;
      // Zwei Segmente tief: die Datei fuehrt den Punkt der BOLZENMITTE und
      // legt den Gelenkpunkt 50 mm entlang ihrer +X-Achse davor -- ihre Achse
      // zeigt also ins Rohr, unsere heraus. Also umdrehen und den Punkt
      // mitschieben, sonst steht das Gelenk beim naechsten Laden daneben.
      const fx = tief ? [-ex[0], -ex[1], -ex[2]] : ex;
      const qb = tief
        ? encodeQuat(quatFromX(fx))
        : (n.partQuat && n.partQuat.length === 4
          ? encodeQuat([n.partQuat[3], n.partQuat[0], n.partQuat[1], n.partQuat[2]])
          : encodeQuat(quatFromX(ex)));
      // Feld 3 ist die Bolzenlaenge (150 in jeder Zeile des Bestands), Feld 4
      // sagt, wie tief er steckt: 1 = mittig auf dem Gelenkpunkt (ein Segment
      // im Rohr), 0 = eines weiter hinein.
      const v = tief ? 5 : 0;
      lines.push(`bolt2{${CONNECTOR_MAT}, ${tuple(qb, n.x + fx[0] * v, n.y + fx[1] * v, n.z + fx[2] * v)}, 1, 150., ${tief ? 0 : 1}, 0}`);
      stats.fittings++;
      for (const grad of n.hinges || []) {
        const arm = hingeDir(n, grad);
        const ey = [-arm[0], -arm[1], -arm[2]];
        const qh = encodeQuat(quatFromAxes(ex, ey, cross(ex, ey)));
        lines.push(`flexi-connector3{${CONNECTOR_MAT}, ${tuple(qh, n.x, n.y, n.z)}, 1, ${hingeFields(ex, arm)}, 0}`);
        stats.fittings++;
      }
      continue;
    }
    // Klemm-Kupplung: eigene Zeile statt connector3. Der Punkt ist die
    // Muendung des offenen Anschlusses, das lokale -Y zeigt in ihn hinein und
    // das lokale X laeuft am umschlossenen Rohr entlang -- so steht es in allen
    // 51 Vorkommen der Herstellerdateien (Maskenfelder dort immer 11, 8, 3840).
    if (n.part && n.stub) {
      const tb = n.clampOn ? model.tubes.get(n.clampOn.tubeId) : null;
      const ta = tb && node(tb.a), tbb = tb && node(tb.b);
      // Ohne bekanntes Rohr irgendeine Achse quer zum Anschluss.
      const ex = ta && tbb ? dirOf(ta, tbb)
        : (Math.abs(n.stub[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0]);
      const ey = [-n.stub[0], -n.stub[1], -n.stub[2]];
      const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
      if (isHolePart(n.part)) {
        // Eingelesene Klemme: ihre Ausrichtung kommt aus der Datei. Nur selbst
        // gesetzte werden aus Stutzen und Rohr gerechnet.
        const qh = n.partQuat && n.partQuat.length === 4
          ? encodeQuat([n.partQuat[3], n.partQuat[0], n.partQuat[1], n.partQuat[2]])
          : encodeQuat(quatFromAxes(ex, ey, ez));
        // Arm-Maske wie bei der Kupplung; das Feld dahinter fuehrt sie ohne die
        // beiden Loch-Bits (11/8, 15/12, 59/56 -- so steht es im Bestand).
        const hm = n.partMask || HOLE_MASKS[n.part] || 11;
        lines.push(`hole-connector4{${CONNECTOR_MAT}, ${tuple(qh, n.x, n.y, n.z)}, 0, 0, ${hm}, ${hm - 3}, 3840, 0, 0}`);
        stats.fittings++;
        continue;   // die Lochzapfenkupplung IST die Kupplung
      }
      // Frueher stand hier eine bearing2-Zeile fuer die Lagerkupplung. Das war
      // das falsche Teil: bearing2 ist das RADLAGER (in 124 von 125 Vorkommen
      // sitzt es auf einer connector3), die Lagerkupplung ist
      // bearing-connector4 und sitzt am Rohr (101 von 101 Vorkommen NICHT auf
      // einer Kupplung). Sie ist jetzt ein Anbauteil und wird weiter unten
      // geschrieben; hier bleibt nur die Kupplung, die sie traegt.
    }
    // Eine gedrehte Kupplung (aus dem Import) behaelt ihre Lage. Die Arm-Maske
    // zaehlt die LOKALEN Wuerfelachsen -- bei einer gedrehten Kupplung sind das
    // nicht die Weltachsen, sonst bekaeme sie gar keine Arme zugeordnet.
    const quat = n.quat && n.quat.length === 4
      ? [n.quat[3], n.quat[0], n.quat[1], n.quat[2]]      // Three (x,y,z,w) -> Datei (w,x,y,z)
      : null;
    const toLocal = (d) => (quat ? rotateByQuat(conjugate(quat), d) : d);

    let mask = 0;
    let carriesAdapter = false;
    // Vorhandene Stutzen aus dem Import (inklusive offener Arme ohne Rohr).
    for (const a of n.arms || []) {
      const l = toLocal(a);
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    for (const t of model.tubes.values()) {
      if (t.link) continue;
      const other = t.a === n.id ? node(t.b) : t.b === n.id ? node(t.a) : null;
      if (!other) continue;
      // Eine Arm-Kante heisst: hier steckt eine Winkelkupplung. Das Kennzeichen
      // c45 am Knoten fuehrt nur das Modell selbst nach, importierte Ecken
      // haben es nicht -- deshalb zaehlt die Kante, nicht das Flag.
      if (t.arm) carriesAdapter = true;
      // Am Bogenrohr steckt der Stutzen in der TANGENTE, nicht in der Sehne --
      // die laeuft 45 Grad daneben und traf gar keine Wuerfelachse, weshalb der
      // Kupplung in der Originalsoftware der Fortsatz zum Bogen fehlte.
      // Fuer den Viertelkreis gilt: Tangente am Anfang = Richtung vom
      // Mittelpunkt zum ANDEREN Ende, und umgekehrt.
      const l = toLocal(t.bow && t.bowCenter ? bowStubDir(n, other, t.bowCenter) : dirOf(n, other));
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    // Eine Lochzapfenkupplung steckt mit ihrem Loch auf einem Stutzen -- der
    // gehoert damit in die Maske (52 von 55 Vorkommen des Bestands fuehren ihn
    // dort). Ihr Knoten liegt eine Kupplungslaenge daneben.
    for (const h of model.nodes.values()) {
      if (!isHolePart(h.part) || h.id === n.id) continue;
      const dx = h.x - n.x, dy = h.y - n.y, dz = h.z - n.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.5 || len > cs50 * 1.2) continue;
      const l = toLocal([dx / len, dy / len, dz / len]);
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    // Ein offenes Verbinderende erzwingt seinen Stutzen: in allen 67 Vorkommen
    // des Bestands, in denen es auf einer Kupplung sitzt, steht dessen Bit auch
    // in deren Maske. Ohne diese Zeile faenge die Herstellersoftware den Stutzen
    // beim naechsten Laden nicht wieder ein.
    for (const f of (model.fittings ? model.fittings.values() : [])) {
      if (f.kind !== "open-connector2" || !f.quat) continue;
      if (Math.hypot(f.x - n.x, f.y - n.y, f.z - n.z) > 2) continue;
      const l = toLocal(rotateByQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]], [1, 0, 0]));
      for (const [bit, v] of ARM_BITS) if (dot(l, v) > 0.9) mask |= bit;
    }
    // Ein Adapter-Koerper mit eigener Kupplung ist in der Datei eine gewoehnliche
    // connector3 -- die Winkelkupplung steckt an der Ecke, nicht hier.
    // c45file: die Datei hatte hier eine Winkelkupplung, auch wenn wir daraus
    // keinen Adapter-Koerper ableiten konnten.
    const c45 = (n.c45 || carriesAdapter || n.c45file) && !n.ownConnector;
    const q = quat ? encodeQuat(quat) : IDENTITY;
    // Die Eck-Kupplung der 45-Grad-Winkelkupplung fuehrt NUR drei Felder hinter
    // dem Tupel -- in allen 732 Vorkommen der Herstellerdateien. Schreibt man
    // ihr die sechs Felder einer connector3 (Arm-Maske, Sichtbarkeit), lehnt die
    // Herstellersoftware die Datei ab.
    // Die Winkelkupplung ERSETZT die Kupplung nicht, sie steckt auf ihr: in den
    // Herstellerdateien steht an derselben Lage beides, 726 von 732 Vorkommen.
    lines.push(`connector3{${CONNECTOR_MAT}, ${tuple(q, n.x, n.y, n.z)}, 1, 0, ${mask}, ${63 - mask}, ${RENDER_MASK}, 0}`);
    // Die Winkelkupplung hat eine EIGENE Lage -- nicht die des Wuerfels. Der
    // Wuerfel ist drehsymmetrisch, sie nicht: an 559 der 726 Vorkommen in den
    // Herstellerdateien tragen connector3 und connector45_2 an derselben Stelle
    // verschiedene Quaternionen. Kam sie aus einer Datei, geht sie unveraendert
    // wieder hinaus; sonst bleibt es bei der Wuerfel-Lage.
    if (c45) {
      const q45 = n.c45quat && n.c45quat.length === 4
        ? encodeQuat([n.c45quat[3], n.c45quat[0], n.c45quat[1], n.c45quat[2]])
        : q;
      lines.push(`connector45_2{${CONNECTOR_MAT}, ${tuple(q45, n.x, n.y, n.z)}, 1, 0, 0}`);
    }
    stats.connectors++;
  }

  // --- Rohre --------------------------------------------------------------
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue;               // Adapter-Huelse und Doppelrohr-Verbindung sind keine Teile
    const a = node(t.a), b = node(t.b);
    if (!a || !b) continue;
    const mat = tubeMat(t.color);
    // Ein eingelesenes Rohr bringt seine eigene Lage mit -- die geht unveraendert
    // wieder hinaus. Erst wenn es bewegt wurde, faellt sie weg und die Lage
    // ergibt sich wieder aus den beiden Kupplungen.
    if (t.geom && t.geom.p0 && t.geom.dir) {
      const g = t.geom;
      const q = t.bow && g.up
        ? encodeQuat(quatFromAxes(g.dir, g.up, cross(g.dir, g.up)))
        : encodeQuat(quatFromX(g.dir));
      // Der Zuschlag hinter dem Mass gehoert dazu: in gedrehten Aufbauten
      // steckt das Rohr schraeg im Kupplungswuerfel, ohne ihn landet das ferne
      // Ende neben der Kupplung (siehe padOf in qdfimport.js).
      lines.push(`${t.bow ? "round-tube2" : "tube2"}{${mat}, ${tuple(q, g.p0[0], g.p0[1], g.p0[2])}, 1, ${mm(g.len)}, ${mm(g.pad || 0)}, 0}`);
      if (t.bow) stats.bows++; else stats.tubes++;
      continue;
    }
    if (t.bow && t.bowCenter) {
      // Bogen: lokale X-Achse = Tangente am Anfang, lokale Y-Achse zeigt zum
      // Kreismittelpunkt. Radius = Rasterschritt, gespeichert wird das Rohrmass.
      const c = { x: t.bowCenter[0], y: t.bowCenter[1], z: t.bowCenter[2] };
      const R = lenOf(a, c);
      const N = dirOf(a, c);
      const T = norm([
        (b.x - a.x) / R - N[0], (b.y - a.y) / R - N[1], (b.z - a.z) / R - N[2],
      ]);
      const q = encodeQuat(quatFromAxes(T, N, cross(T, N)));
      lines.push(`round-tube2{${mat}, ${tuple(q, a.x, a.y, a.z)}, 1, ${mm(R - conn)}, 0., 0}`);
      stats.bows++;
      continue;
    }
    // Massgeblich ist der KUPPLUNGSABSTAND, nicht die Katalog-Laenge: der Import
    // rechnet das Rohrende aus Start + Richtung * (Laenge + Kupplung) und sucht
    // erst danach das passende Teil. Bei schraegen Streben aus alten Entwuerfen
    // weichen beide um ein paar Zentimeter voneinander ab -- mit der Katalog-
    // Laenge landete das Ende dann neben der Kupplung.
    const span = lenOf(a, b);
    // Die Datei kennt nur Katalog-Laengen (100/150/200/250/350/520/750). Liegt
    // der gemessene Abstand dicht an der Laenge des verbauten Teils, schreiben
    // wir diese -- sonst stuende dort ein Mass, das es nicht gibt (Schraegen aus
    // dem C45-Adapter kommen sonst als 360 oder 364 heraus). Weicht er weiter
    // ab, gilt weiter der Abstand: das Rohrende muss auf der Kupplung landen.
    const katalog = t.length != null ? t.length : (getTube(t.tubeId) || {}).length_cm;
    const gemessen = span - conn;
    const len = (katalog != null && Math.abs(katalog - gemessen) <= 2) ? katalog : gemessen;
    const q = encodeQuat(quatFromX(dirOf(a, b)));
    lines.push(`tube2{${mat}, ${tuple(q, a.x, a.y, a.z)}, 1, ${mm(len)}, 0., 0}`);
    stats.tubes++;
  }

  // --- Verstaerkungsprofile ----------------------------------------------
  // Die Datei fuehrt nicht die einzelnen 40-cm-Stangen, sondern den fertigen
  // LAUF: kollineare verstaerkte Rohre ergeben eine Zeile ueber die ganze
  // Strecke. In den Herstellerdateien kommen genau zwei Laengen vor,
  // 800 mm (160x) und 600 mm (14x) -- beides der Abstand der Endkupplungen.
  for (const p of reinforcementProfiles(model)) {
    const q = encodeQuat(quatFromX(p.dir));
    lines.push(`alu2{${ALU_MAT}, ${tuple(q, p.from[0], p.from[1], p.from[2])}, 1, ${mm(p.len)}, 0., 0}`);
    stats.alu++;
  }

  // --- Platten und Netze --------------------------------------------------
  // Geschrieben wird das KATALOGMASS, nicht der gemessene Eckabstand: eine
  // 40x40-Platte auf einer 45-Grad-Schraege spannt gemessen 40,9 cm, und mit
  // diesem krummen Mass findet der Import beim Zurueckladen kein Teil mehr.
  // Die Ecken selbst vertragen den kleinen Versatz (Snap-Toleranz 5 cm).
  //
  // Zwei Konventionen, an den Herstellerdateien abgelesen:
  //   * Das ERSTE Mass gehoert zur lokalen Y-Achse, das zweite zur X-Achse --
  //     in allen 98 Rechteckplatten der Beispielsammlung. Andersherum liegt eine
  //     40x20-Platte quer. (Unser Import probiert beide Zuordnungen und merkt
  //     den Unterschied deshalb nicht.)
  //   * Die Plattenmitte liegt exakt in der Kupplungsebene (2603 von 2604
  //     Platten, Versatz 0). Auf welcher Seite der Rohre das Teil liegt, sagt
  //     die Normale -- siehe canonicalNormal.
  const rectLine = (name, corners, matNum, dims, side, turned = false) => {
    if (!corners) return null;
    const [A, B, C, D] = corners.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
    const e1 = dirOf(A, B), e2 = dirOf(A, D);
    let w = lenOf(A, B), h = lenOf(A, D);
    if (dims && dims[0] > 0 && dims[1] > 0) {
      // Katalogmasse der langen/kurzen Kante zuordnen, nicht stur w vor h.
      const [d1, d2] = w >= h ? [Math.max(...dims), Math.min(...dims)] : [Math.min(...dims), Math.max(...dims)];
      if (Math.abs(d1 - w) < conn && Math.abs(d2 - h) < conn) { w = d1; h = d2; }
    }
    const cx = (A.x + B.x + C.x + D.x) / 4;
    const cy = (A.y + B.y + C.y + D.y) / 4;
    const cz = (A.z + B.z + C.z + D.z) / 4;
    // Normale nicht aus der Ecken-Reihenfolge ableiten (die ist beliebig und
    // liess die Platte mal oben, mal unten erscheinen), sondern eindeutig
    // festlegen und mit der gespeicherten Seite multiplizieren.
    const n = panelNormal(e1, e2, [cx, cy, cz], middle).map((v) => v * (side < 0 ? -1 : 1));
    // Rechtshaendiges Dreibein zur gewaehlten Normalen. Die lokale X-Achse sagt,
    // wo die LIPPEN der Platte liegen: laengs der Tragrohre (e1) oder quer dazu
    // (e2). Genau daran erkennt auch die Herstellersoftware eine gedrehte
    // Platte -- ihre beiden Dateien unterscheiden sich nur in dieser Rolllage.
    const ex = turned ? e2 : e1;
    const q = encodeQuat(quatFromAxes(ex, cross(n, ex), n));
    // Geschrieben wird das Mass auf der lokalen Y-Achse zuerst, dann das auf X.
    const [aufY, aufX] = turned ? [w, h] : [h, w];
    return `${name}{${matNum}, ${tuple(q, cx, cy, cz)}, 1, ${mm(aufY - conn)}, 0., ${mm(aufX - conn)}, 0., 0}`;
  };

  for (const p of model.panels.values()) {
    // Aeltere Staende fuehren das Baellebad noch als fuenf Platten mit der
    // Original-Zeile an der Frontwand. Die Zeile zurueckschreiben, die
    // abgeleiteten Flaechen auslassen -- sonst stuenden fuenf Platten statt
    // eines Pools da. Frisch eingelesene Pools sind Anbauteile (siehe unten).
    if (p.poolPart) {
      if (p.pool && p.pool.p) {
        const q = p.pool.quat && p.pool.quat.length === 4
          ? encodeQuat([p.pool.quat[3], p.pool.quat[0], p.pool.quat[1], p.pool.quat[2]])
          : IDENTITY;
        lines.push(`${p.pool.kind}{${panelMat(p.color)}, ${tuple(q, p.pool.p[0], p.pool.p[1], p.pool.p[2])}, 1, 0}`);
        stats.panels++;
      }
      continue;
    }
    // Eingelesene Platte: sie liegt da, wo die Datei sie hinschreibt. Auf
    // Schraegen weicht die aus dem Rohrpaar gerechnete Mitte um bis zu 1,2 cm ab.
    if (p.geom && p.geom.p && p.geom.quat) {
      const g = p.geom;
      // Reihenfolge wie in der Datei: `w` ist das ERSTE Mass (lokale Y-Achse),
      // `h` das zweite -- so hat der Import sie gelesen. Andersherum kam jede
      // nicht-quadratische Platte gedreht heraus (alle 106 im Bestand).
      lines.push(`panel2{${panelMat(p.color, lochplatte(p))}, ${tuple(encodeQuat([g.quat[3], g.quat[0], g.quat[1], g.quat[2]]), g.p[0], g.p[1], g.p[2])}, 1, ${mm(g.w)}, ${mm(g.padW || 0)}, ${mm(g.h)}, ${mm(g.padH || 0)}, 0}`);
      stats.panels++;
      continue;
    }
    const def = getPanel(p.panelId);
    const line = rectLine("panel2", model.panelCorners(p), panelMat(p.color, lochplatte(p)),
      def ? [def.w, def.h] : null, p.side, !!p.turned);
    if (line) { lines.push(line); stats.panels++; }
  }
  for (const x of (model.textiles ? model.textiles.values() : [])) {
    // 彩虹带、彩虹桥是布件的变体：材质名带标记，官方软件里是普通布件。
    // 原件的套筒在局部 X 的两头、顺着局部 Y 套在管上（抓来的 textil2_350x750：
    // 沿管 35、两管之间 75）：局部 X 要横过两根承重管，所以按「转过」的写法，
    // 第一个尺寸是沿管的长度。短布面照这样写成 150 × 350。
    const line = rectLine("textil2", model.panelCorners(x), panelMat(x.color, x.variant || null), [x.w, x.h], x.side, true);
    if (line) { lines.push(line); stats.textiles++; }
  }

  // --- Klemmen und Rutschen ----------------------------------------------
  for (const c of (model.clamps ? model.clamps.values() : [])) {
    // Doppelrohrverbinder und Rohrklammer sind zwei Elemente; die lokale
    // +X-Achse ist die Richtung des umschlossenen Rohrs.
    const kind = c.connectorId === "tube_clamp" ? "clip2" : "clamp2";
    // Der Punkt liegt im Loch des gehaltenen Rohrs. Wohin das ZWEITE Loch
    // zeigt, steckt allein in der Drehung: beim Doppelrohrverbinder liegt es in
    // lokal -Z, bei der Rohrklammer in lokal +Y (an den abgegriffenen Modellen
    // gemessen). Ohne Versatz -- eine Klemme ohne zweites Rohr -- bleibt es bei
    // der kuerzesten Drehung auf die Rohrachse.
    const q = c.dir
      ? encodeQuat(c.off ? clampQuat(c.dir, c.off, kind === "clip2") : quatFromX(c.dir))
      : IDENTITY;
    // ACHTUNG Feldzahl: die Herstellersoftware wirft eine Datei mit falsch
    // besetzter Zeile KOMPLETT weg. Der Doppelrohrverbinder fuehrt hinter der
    // Lage ZWEI Felder (`1, 2` / `1, 968` im Bestand), die Rohrklammer DREI
    // (`1, 0, 3`).
    lines.push(kind === "clip2"
      ? `clip2{${TUBE_MAT.red}, ${tuple(q, c.x, c.y, c.z)}, 1, 0, 0}`
      : `clamp2{${TUBE_MAT.red}, ${tuple(q, c.x, c.y, c.z)}, 1, 0}`);
    stats.clamps++;
  }
  // Anbauteile: Punkt + Ausrichtung, beim Netz zusaetzlich die Masse. Die
  // Feldzahl je Art richtet sich nach dem, was die Herstellerdateien fuehren.
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    const q = f.quat && f.quat.length === 4
      ? encodeQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]])
      : IDENTITY;
    // Tuchteile tragen die Platten-Materialien (Spielsack, Netz, Rundwand);
    // alles andere die der Rohre.
    // 软包滚筒和非官方的扩展配件在 .qdf 里没有对应元素，只存在我们自己的存档里
    if (f.kind === "sleeve" || ACCESSORY_IDS.has(f.kind)) continue;
    const stoff = f.kind === "bag2" || f.kind === "lattice2" || f.kind === "textil-round2"
      || f.kind === "pool2" || f.kind === "pool-small2";
    // Ohne Farbe: Material 0 wie in der Datei (so stehen alle 50 Dach-Zeilen
    // des Bestands dort). CONNECTOR_MAT waere schwarz und faerbte das Teil beim
    // naechsten Laden ein.
    // Radlager und Schwimmrad gibt es nur schwarz -- so stehen sie auch in den
    // Herstellerdateien (Material 1, 125 bzw. 76 Vorkommen).
    // Teile mit fester Farbe schreiben genau diese: Radlager, Schwimmrad und
    // Rohrkappe schwarz, die Poolfolie blau (so steht sie auch in allen 43
    // Vorkommen der Herstellerdateien).
    const fest = fixedFittingColor(f.kind);
    const farbe = fest || f.color;
    const mat = fest === "black" ? TUBE_MAT.black
      : farbe ? (stoff ? panelMat(farbe) : tubeMat(farbe)) : 0;
    // Der Spielsack wird an dem Rohr gespeichert, an dem er haengt -- unsere
    // Mitte liegt 20 cm weiter in der lokalen +Z-Richtung, also zurueckrechnen.
    let fx = f.x, fy = f.y, fz = f.z;
    if (f.kind === "bag2" && f.quat) {
      const ez = rotateByQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]], [0, 0, 1]);
      fx -= ez[0] * 20; fy -= ez[1] * 20; fz -= ez[2] * 20;
    }
    // Das kleine Baellebad haengt in der Datei nicht an der Mitte seiner
    // Frontwand, sondern 20 cm daneben (so liegt sein abgegriffenes Modell:
    // -22,5 bis +62,5 cm in lokal X). Wir fuehren die Mitte -- also zurueck.
    // Nur das echte 80er-Becken: der 40 cm breite Rahmen der XS-Folie hat
    // seinen Punkt mittig, sonst faende der Einleser seine Frontwand nicht.
    if (f.kind === "pool-small2" && f.quat && Math.abs((f.w || 80) - 80) < 1) {
      const ex = rotateByQuat([f.quat[3], f.quat[0], f.quat[1], f.quat[2]], [1, 0, 0]);
      fx -= ex[0] * 20; fy -= ex[1] * 20; fz -= ex[2] * 20;
    }
    if (f.kind === "lattice2" && f.w != null && f.h != null) {
      lines.push(`lattice2{${mat}, ${tuple(q, fx, fy, fz)}, 1, ${mm(f.w)}, 0., ${mm(f.h)}, 0., 0}`);
    } else if (f.kind === "hole-connector4") {
      const mask = f.mask || 0;
      lines.push(`hole-connector4{${CONNECTOR_MAT}, ${tuple(q, fx, fy, fz)}, 0, 0, ${mask}, ${mask - 3}, 3840, 0, 0}`);
    } else if (f.kind === "bearing2") {
      lines.push(`bearing2{${CONNECTOR_MAT}, ${tuple(q, fx, fy, fz)}, 1, ${mm(cs50)}, 0., 0}`);
    } else if (f.kind === "bearing-connector4" && !f.rest) {
      // Selbst gesetzte Lagerkupplung. Feldaufbau wie in den Herstellerdateien:
      // vier Felder hinter der Lage, in 36 von 101 Vorkommen "1, 0, 0, 0".
      lines.push(`bearing-connector4{${CONNECTOR_MAT}, ${tuple(q, fx, fy, fz)}, 1, 0, 0, 0}`);
    } else if (f.rest) {
      // Teile, die wir nur durchreichen (Flexikupplung, Bolzen, Lagerkupplung,
      // Rohrkappe): die Felder hinter der Lage stehen noch so da, wie sie beim
      // Einlesen in der Datei standen.
      lines.push(`${f.kind}{${mat}, ${tuple(q, fx, fy, fz)}, ${f.rest}}`);
    } else if (f.kind === "textil-round2") {
      // Auch hier zaehlt die Feldzahl: die Rundwand fuehrt DREI Felder hinter
      // der Lage (54 von 54 Vorkommen), nicht zwei wie die uebrigen Teile.
      lines.push(`textil-round2{${mat}, ${tuple(q, fx, fy, fz)}, 1, 0, 0}`);
    } else {
      lines.push(`${f.kind}{${mat}, ${tuple(q, fx, fy, fz)}, 1, 0}`);
    }
    stats.fittings++;
  }
  for (const s of (model.slides ? model.slides.values() : [])) {
    // s.quat steht in Three-Reihenfolge (x,y,z,w), die Datei will (w,x,y,z).
    const q = s.quat && s.quat.length === 4
      ? encodeQuat([s.quat[3], s.quat[0], s.quat[1], s.quat[2]])
      : IDENTITY;
    // Feld 2 ist die Positionsanpassung (docs/QDF-FORMAT.md §3.6): 1 = frei,
    // 0 = fixiert. Daecher haengt man von Hand ein, und die Herstellersoftware
    // schreibt sie in 41 von 42 Zeilen fixiert -- Rutschen dagegen frei.
    const frei = (s.kind === "roof2" || s.kind === "roof-large2") ? 0 : 1;
    lines.push(`${s.kind || "slide-new2"}{${tubeMat(s.color)}, ${tuple(q, s.x, s.y, s.z)}, ${frei}, 0}`);
    stats.slides++;
    // Fussrohr: Unter jeder Rutsche liegt in den Herstellerdateien ein 35er
    // Rohr, mittig auf dem Rutschenpunkt. Es gehoert zum Rutschenbauteil --
    // das Modell fuehrt es nicht, die Datei braucht es. Geschrieben wird die
    // Lage, die beim Einlesen dort stand.
    if (s.foot && s.foot.p0 && s.foot.dir) {
      const g = s.foot;
      lines.push(`tube2{${tubeMat(g.color || s.color)}, ${tuple(encodeQuat(quatFromX(g.dir)), g.p0[0], g.p0[1], g.p0[2])}, 1, ${mm(g.len)}, 0., 0}`);
    }
  }

  return { text: lines.join(EOL) + EOL, stats };
}
