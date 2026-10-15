// Kleine, von allen Modulen geteilte Hilfsfunktionen (geometriefrei, ohne
// Abhaengigkeiten) -- vermeidet die mehrfache Definition von round2() in
// model.js, builder.js, bom.js und qdfimport.js.

// Rundet auf 2 Nachkommastellen (cm-Werte fuer Speicherung/Vergleich).
export function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Eindeutige Normale einer Platte aus ihren beiden Kantenrichtungen.
 *
 * Die Eckenreihenfolge einer Platte ist beliebig, ihr Kreuzprodukt zeigt also
 * mal so und mal so. Fuer "liegt oben drauf / haengt unten dran" braucht es
 * aber eine feste Bezugsrichtung. Die Regel stammt aus den Dateien der
 * Herstellersoftware: waagerechte Platten zeigen nach OBEN (1457 von 1464),
 * senkrechte nach AUSSEN, vom Modell weg (1141 von 1340).
 *
 * center = Mitte der Platte, middle = Mitte des Modells (beide in cm).
 */
export function panelNormal(e1, e2, center, middle) {
  const c = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  const n = [c[0] / l, c[1] / l, c[2] / l];
  const flip = () => [-n[0], -n[1], -n[2]];
  if (Math.abs(n[1]) > 0.01) return n[1] < 0 ? flip() : n;
  const away = (center[0] - middle[0]) * n[0] + (center[2] - middle[2]) * n[2];
  if (Math.abs(away) > 0.5) return away < 0 ? flip() : n;
  if (Math.abs(n[0]) > 0.01) return n[0] < 0 ? flip() : n;
  return n[2] < 0 ? flip() : n;
}

/**
 * Quaternion (Three-Reihenfolge x,y,z,w), die die lokale +X-Achse auf `dir`
 * dreht -- auf kuerzestem Weg. Anbauteile speichern ihre Ausrichtung genau so:
 * die lokale +X ist Radachse, Rollenachse oder Flaechenbezug.
 */
export function quatFromXAxis(dir) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / L, dir[1] / L, dir[2] / L];
  if (d[0] > 0.999999) return [0, 0, 0, 1];
  if (d[0] < -0.999999) return [0, 0, 1, 0];      // 180 Grad um die Z-Achse
  // Achse = +X x d, Winkel aus dem Skalarprodukt (halber Winkel ueber die
  // uebliche w = 1 + cos-Form, danach normiert).
  const q = [0, -d[2], d[1], 1 + d[0]];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // Vier Nachkommastellen wie beim Import -- zwei waeren als Drehung zu grob.
  const r4 = (v) => Math.round((v / n) * 1e4) / 1e4;
  return [r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])];
}

/**
 * Quaternion (Three-Reihenfolge x,y,z,w) aus einem rechtshaendigen Dreibein.
 * ex/ey/ez sind die Bilder der lokalen Achsen in Weltkoordinaten.
 * Umrechnung ueber die Rotationsmatrix (Shepperd-Verfahren, Spurfall + drei
 * Achsenfaelle -- der stabilste Weg, wenn die Spur nahe -1 liegt).
 */
export function quatFromBasis(ex, ey, ez) {
  const m = [ex, ey, ez];                       // Spalten der Rotationsmatrix
  const at = (r, c) => m[c][r];
  const tr = at(0, 0) + at(1, 1) + at(2, 2);
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(at(2, 1) - at(1, 2)) / s, (at(0, 2) - at(2, 0)) / s, (at(1, 0) - at(0, 1)) / s, 0.25 * s];
  } else if (at(0, 0) > at(1, 1) && at(0, 0) > at(2, 2)) {
    const s = Math.sqrt(1 + at(0, 0) - at(1, 1) - at(2, 2)) * 2;
    q = [0.25 * s, (at(0, 1) + at(1, 0)) / s, (at(0, 2) + at(2, 0)) / s, (at(2, 1) - at(1, 2)) / s];
  } else if (at(1, 1) > at(2, 2)) {
    const s = Math.sqrt(1 + at(1, 1) - at(0, 0) - at(2, 2)) * 2;
    q = [(at(0, 1) + at(1, 0)) / s, 0.25 * s, (at(1, 2) + at(2, 1)) / s, (at(0, 2) - at(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + at(2, 2) - at(0, 0) - at(1, 1)) * 2;
    q = [(at(0, 2) + at(2, 0)) / s, (at(1, 2) + at(2, 1)) / s, 0.25 * s, (at(1, 0) - at(0, 1)) / s];
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const r4 = (v) => Math.round((v / n) * 1e4) / 1e4;
  return [r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])];
}

/** Lokale +X-Achse in Weltkoordinaten (quat in Three-Reihenfolge x,y,z,w). */
/**
 * Quaternion auf Laenge 1 bringen. Noetig, weil die Lagen aus den QDF-Dateien
 * NICHT normiert ankommen (die Datei fuehrt die Werte quadriert und mit 4
 * skaliert). Die Achsen-Formeln unten gelten nur fuer die Einheitsquaternion --
 * mit einer laengeren kommt nicht etwa eine zu lange Achse heraus, sondern eine
 * ganz andere Richtung.
 */
function einheit(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return (!n || Math.abs(n - 1) < 1e-9) ? q : [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function xAxisOf(q) {
  const [x, y, z, w] = einheit(q);
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
}

/** Die lokale +Y-Achse eines Teils in Weltkoordinaten (quat: Three x,y,z,w). */
export function yAxisOf(q) {
  const [x, y, z, w] = einheit(q);
  return [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)];
}

/** Die lokale +Z-Achse eines Teils in Weltkoordinaten (quat: Three x,y,z,w). */
export function zAxisOf(q) {
  const [x, y, z, w] = einheit(q);
  return [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}

/** Mittelpunkt aller Kupplungen -- Bezugspunkt fuer panelNormal. */
export function modelMiddle(nodes) {
  const m = [0, 0, 0];
  let n = 0;
  for (const p of nodes) { m[0] += p.x; m[1] += p.y; m[2] += p.z; n++; }
  if (n) for (let i = 0; i < 3; i++) m[i] /= n;
  return m;
}
