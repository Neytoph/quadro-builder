// Globale Konstanten fuer QUADRO 3D.

// Fassung der App (SemVer). Sie steht an DREI Stellen -- hier, in der Datei
// `VERSION` und im Cache-Namen von `sw.js` -- und wird ausschliesslich von
// `tools/bump-version.py` gepflegt; von Hand geaendert laufen die drei
// auseinander und der Release-Workflow bricht ab.
// Nicht zu verwechseln mit FORMAT_VERSION weiter unten: das ist das
// Speicherformat der Modelle und zaehlt fuer sich.
export const APP_VERSION = "1.1.1";

// Die 6 Achsen-Richtungen eines Wuerfel-Knotens (Three.js: y = oben).
export const DIRECTIONS = [
  { name: "+X", vec: [1, 0, 0] },
  { name: "-X", vec: [-1, 0, 0] },
  { name: "+Y", vec: [0, 1, 0] },
  { name: "-Y", vec: [0, -1, 0] },
  { name: "+Z", vec: [0, 0, 1] },
  { name: "-Z", vec: [0, 0, -1] },
];

// Schraege Rampen-/Dach-Richtungen. Projektvorgabe: alle Schraegen sind immer
// 45 Grad (eine waagerechte Achse kombiniert mit hoch/runter, normiert) -- auch
// wenn importierte QDF-Modelle andere Winkel angeben. 8 vertikale Diagonalen.
const S = Math.SQRT1_2; // 1/sqrt(2)  -> 45 Grad
export const DIAGONAL_DIRECTIONS = [
  { name: "+X+Y", vec: [S, S, 0] },
  { name: "+X-Y", vec: [S, -S, 0] },
  { name: "-X+Y", vec: [-S, S, 0] },
  { name: "-X-Y", vec: [-S, -S, 0] },
  { name: "+Z+Y", vec: [0, S, S] },
  { name: "+Z-Y", vec: [0, -S, S] },
  { name: "-Z+Y", vec: [0, S, -S] },
  { name: "-Z-Y", vec: [0, -S, -S] },
];

// Toleranz (cm), innerhalb der zwei Knoten als identisch gelten und verschmelzen.
export const MERGE_EPS = 0.5;

// Cosinus-Schwelle, ab der zwei Richtungsvektoren als "praktisch identisch"
// gelten (~8°). Genutzt fuer Belegungs-/Ausrichtungspruefungen entlang
// kardinaler/diagonaler Richtungen (builder.js).
export const DIR_ALIGN_TOL = 0.99;

// Lockerere Cosinus-Schwelle (~23°) fuer Arm-Richtungen rotierter Kupplungen
// (armDirs aus QDF-Import), die nicht exakt kardinal/diagonal ausgerichtet sind.
export const ARM_ALIGN_TOL = 0.92;

// Toleranz (cm) beim Andocken an eine vorhandene Schräg-Kupplung
// (extendDiagonalSnap in model.js).
export const DIAGONAL_SNAP_TOL = 3;

// Masse der aufgesteckten 45-Grad-Winkelkupplung (C45): Laenge der kardinalen
// Huelse (Basiskupplung -> Adapterkoerper) und des 45-Grad-Arms
// (Adapterkoerper -> Rohranschluss).
export const C45_SLEEVE_LEN = 10.83;
export const C45_ARM_LEN = 3.61;

// Max. Abstand (cm), bis zu dem ein Knoten beim Setzen eines zweiten Rohrs im
// Doppelrohrverbinder noch mit seinem Nachbarn verlinkt wird (builder.js).
export const CLAMP_LINK_DIST = 7;

/**
 * Abstand der Richtungspfeile vom MITTELPUNKT der Kupplung, in cm.
 *
 * Alle Punkte an einer Kupplung meinen dasselbe: "hier ist ein Stutzen frei".
 * Ob daran ein Rohr, eine Winkelkupplung, ein Anbauteil oder eine
 * Lochzapfenkupplung haengt, aendert nichts an der Stelle -- sie stehen deshalb
 * ueberall gleich weit draussen, in jede Richtung. Halbe Kupplung plus Luft:
 * damit liegt der Punkt knapp vor dem Wuerfel und ist frei anklickbar.
 *
 * NICHT gemeint sind Punkte mit eigener Bedeutung: das freie Loch einer
 * Rohrklammer oder eines Lagermauls liegt genau dort, wo das Rohr durchlaeuft,
 * und ein Punkt zum ERSETZEN der Kupplung gehoert auf sie selbst.
 */
export const anchorGap = (connectorSize = 5) => connectorSize / 2 + 4;

// Schluessel fuer den automatischen Zwischenspeicher.
export const AUTOSAVE_KEY = "quadro.autosave.v1";

// Aktuelles Speicherformat. Aeltere Staende werden beim Laden angehoben
// (model.js, loadJSON), neuere abgelehnt.
//   1 -> 2: Der Punkt einer Klemme lag zwischen ihren beiden Loechern; jetzt
//           liegt er im Loch des gehaltenen Rohrs, wie in den QDF-Dateien.
export const FORMAT_VERSION = 2;
