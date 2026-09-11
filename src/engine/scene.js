// 3D-Szene + Rendering (Three.js). Kennt das Modell nur zum Zeichnen.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { geometry, colorHex, connectorColor, getPanel } from "./catalog.js";
import { panelNormal, modelMiddle } from "./util.js";
import { nodeClampOffset, isHolePart, HOLE_MASKS, holeArmDirs, BLACK_FITTINGS,
  isBoltPart, boltAxis, boltShift, hingeDir, hingeKey, POOL_KINDS, fixedFittingColor,
  ARM_FITTINGS } from "./model.js";
import { reinforcementProfiles } from "./qdfexport.js";
import { loadConnectorMeshes, loadSlideMeshes, loadTubeMeshes, loadFittingMeshes,
  loadSurfaceMeshes } from "./meshes.js";
import { CONNECTOR_ARM_BITS } from "./qdfimport.js";
import { shadeHex, hexRgba, DEFAULT_TUNE, DEFAULT_GRADE, gradeHex, displayHex } from "./colorTune.js";

const UP = new THREE.Vector3(0, 1, 0);
// So viel darf ein Bauteil vor einem Ankerpunkt liegen, ohne ihn zu verdecken
// (Rohrhalbmesser + halbe Kupplung).
const HANDLE_CLEAR = 6;
// 加管箭头：平时短芽，指到接头才展开。隐形碰撞体保持够点。
const ARROW = {
  shaftR: 0.52,
  shaftLen: 5.1,
  coneR: 1.28,
  coneLen: 2.05,
  offset: 3.35,
  stubR: 0.7,
  stubLen: 2.35,
  hitR: 2.45,
  geoVer: 3,
};
const ARROW_TEAL = 0x2dd4bf;
// Das große Dach liegt auf dem First-Rohr, nicht auf dessen Achse.
const ROOF_LIFT = 5;
const ROOF_THICK = 2.5;   // Materialstärke der beiden Dachschrägen
const ONE = new THREE.Vector3(1, 1, 1);

// Render-Qualitaet: steuert nur die Aufloesung der gecachten Geometrien, nicht
// die Masse. conn = [Segmente breit, hoch] des abgerundeten Kupplungs-Wuerfels
// (null = scharfkantiger Wuerfel), tube = Umfangssegmente der Rohre.
export const QUALITY_LEVELS = ["low", "medium", "high"];
// notch = Segmente je Eck-Aussparung einer Platte. 0 heisst rechtwinklig --
// das passt zur Stufe "low", auf der auch die Kupplungen kantig sind.
// meshes = die aus der Herstellersoftware abgegriffenen Modelle benutzen (siehe
// meshes.js). Auf ALLEN Stufen: die Teile sollen überall gleich aussehen, sonst
// steht auf "low" eine andere Kupplung als daneben in der Anleitung. Die Stufe
// steuert weiter alles, was wir selbst zeichnen -- Rohre, Platten, Schatten,
// Kantenglättung -- nur eben nicht mehr die Form der abgegriffenen Teile.
//
// Kantenglaettung: `antialias` schaltet die des Browsers (MSAA) ein -- die
// kennt nur an oder aus. Eine STAERKERE gibt es nur ueber mehr Bildpunkte:
// `ss` rechnet das Bild um diesen Faktor groesser und laesst die Grafikkarte
// es beim Anzeigen wieder verkleinern (Supersampling). 1,5 bedeutet gut die
// doppelte Punktzahl -- das glaettet auch die groben Kanten der abgegriffenen
// Modelle, kostet aber entsprechend. Ein Nachbearbeitungs-Schritt (FXAA/SMAA)
// waere die dritte Moeglichkeit; der braeuchte zusaetzliche Dateien aus dem
// three.js-Beispielordner, und die App kommt ohne aus.
//
// fine = die hochaufloesende Fassung der abgegriffenen Modelle laden
// (`data/models/*-fine.json`, rund doppelt so viele Dreiecke). Nur auf "hoch":
// die Dateien sind zusammen etwa dreimal so gross wie die groben und werden
// erst geholt, wenn die Stufe gewaehlt ist.
const QUALITY = {
  low:    { conn: null,      tube: 8,  bow: 8,  notch: 0,  shadow: 0,    antialias: false, ss: 1,   meshes: true,  fine: false },
  medium: { conn: [16, 10],  tube: 16, bow: 14, notch: 6,  shadow: 1024, antialias: true,  ss: 1,   meshes: true,  fine: false },
  high:   { conn: [48, 32],  tube: 44, bow: 32, notch: 16, shadow: 2048, antialias: true,  ss: 1.5, meshes: true,  fine: true },
};

// Wo die geladenen Modelle liegen: Satz -> Feld der Szene.
const MESH_FIELDS = {
  connectors: "_connMeshes", slides: "_slideMeshes", tubes: "_tubeMeshes",
  fittings: "_fitMeshes", surfaces: "_surfMeshes",
};

// So viele Bildpunkte je CSS-Punkt hoechstens -- auf einem Telefon mit dreifach
// feinem Bildschirm waere das Bild sonst neunmal so gross wie noetig.
const MAX_PIXEL_RATIO = 2.5;
const DEFAULT_QUALITY = "high";

// Hervorhebung (Cursor-Auswahl und Bestandsliste): immer dasselbe Lila,
// unabhaengig von der Teilefarbe. Nur die Emissive einzufaerben liess die
// Grundfarbe durchschlagen -- ein rotes und ein blaues Rohr sahen dann
// unterschiedlich aus. Lila kommt im Teile-Katalog nicht vor.
// Spalt zwischen benachbarten Platten (cm, gesamt -- je Seite die Haelfte).
const PANEL_GAP = 1.5;

// Laenge des Doppelrohrverbinders entlang der Rohre.
const CLAMP_LEN = 5;

// Wandstaerke des Klemmenkoerpers (cm). Ohne sie ist der Ring eine blosse
// Mantelflaeche -- von der Seite betrachtet papierduenn und ohne sichtbare
// Stirnflaeche.
const CLAMP_WALL = 0.7;

// Wandstaerke des Rings der Lochzapfenkupplung. Ihr eigener Stutzen setzt an
// dessen Innenwand an, sonst klafft dazwischen eine Luecke.
const PIN_RING_WALL = 0.7;

// Schlitz der Rohrklammer: so breit ist die Oeffnung, durch die das Rohr
// einklickt (in der Ringebene gemessen).
const CLIP_GAP = Math.PI * 0.55;

// Tiefe des Spielsacks: er haengt an allen vier Seiten rund 17 cm hinunter.
const BAG_DEPTH = 17;

// So tief liegt der gezeichnete Boden unter der Nullebene (halbe Kupplung).
const GROUND_DROP = 2.5;

// Anbauteile: Radgroesse und Radius der gebogenen Wand, aus den Entwurfsdaten
// (Rad sitzt 5 cm neben der Kupplung, Rundwand 40 cm von Kupplung und Rohr).
const WHEEL_R = 19;
const ROUND_WALL_R = 40;
// Laenge der Rundabdeckung entlang ihrer Achse: die Bogenpaare stehen in allen
// Entwuerfen 800 mm auseinander.
const ROUND_COVER_LEN = 80;

// Bogenrutsche, gemessen an allen zehn Vorkommen im Bestand: das Folgeteil sitzt
// stets 60 cm voraus (lokales +X), 80 cm tiefer und 60 cm zur Seite (lokales +Z).
const CURVED_SLIDE_DROP = new THREE.Vector3(60, -80, 60);
// Laufrichtung einer Rutsche ist ihr lokales +Z: bei 73 von 76 geraden Rutschen
// sitzt das Endstueck auf (0, -800, 1200). Die Bogenrutsche START ET ebenso in
// ihrem lokalen +Z und dreht auf das lokale +X -- das Folgeteil steht in allen
// zehn Faellen mit seinem eigenen +Z genau auf dem lokalen +X des Bogens.
const CURVED_SLIDE_ENTRY = new THREE.Vector3(0, 0, 1);
// Gerade Rutsche: Folgeteil auf dem lokalen Versatz (0, -800, 1200) mm.
const STRAIGHT_SLIDE_DROP = new THREE.Vector3(0, -80, 120);
// Austrittsrichtung am Ende des Bogens: lokales +X, rund 33 Grad abwaerts --
// dasselbe Gefaelle wie die gerade Rutsche (80 cm auf 120 cm).
// Austrittsrichtung der Bogenrutsche: WAAGERECHT in der lokalen +X-Richtung.
// Dahinter sitzt der flach liegende Auslauf -- käme der Bogen schräg an, gäbe
// es dort einen Knick.
const CURVED_SLIDE_EXIT = new THREE.Vector3(1, 0, 0);
// Höhe der Rutschbahn über dem Bezugspunkt eines Teils: der Auslauf liegt eine
// halbe Kupplung darüber, ein Rutschenkörper beginnt OBEN auf dem Rohr, das ihn
// trägt (5 cm).
const SLIDE_END_LIFT = 2.5;
const SLIDE_BODY_LIFT = 5;
// Integralrutsche: fester Fall und Auslauf ab dem Einhängepunkt (Modell:
// SLIDE_DROP + SLIDE_HOOK_LIFT und SLIDE_RUN).
const INTEGRAL_DROP = 85;
const INTEGRAL_RUN = 120;
// Auslauf: waagerechtes Stück, dann die Lippe -- ein abgerundeter Viertelkreis,
// der um 90 Grad nach unten kippt (nur die Rutschfläche, ohne Wangen). Zusammen
// reichen sie 47,5 cm nach vorn, so lang ist das Teil.
const SLIDE_END_LIP = 5;                                     // cm Bogenlänge der Lippe
const SLIDE_END_LIP_R = SLIDE_END_LIP / (Math.PI / 2);       // Radius des Viertelkreises
const SLIDE_END_FLAT = 47.5 - SLIDE_END_LIP_R;
// Flaechige Anbauteile verschwinden im Verstaerken- und Kollisions-Modus, wie
// Platten und Netze auch.
const FLAT_FITTINGS = new Set(["lattice2", "textil-round2", "roof-large2"]);
// Staerke der Baellebad-Folie: nur so dick, dass sie sichtbar ist.
// Der Nullpunkt des kleinen Beckens liegt 20 cm neben der Mitte seiner
// Frontwand (abgegriffenes Modell, lokale X-Achse) -- wie in qdfimport.js.
const POOL_SMALL_OFFSET = 20;
const POOL_SKIN = 2;
// Sie haengt innen im Rahmen -- eine halbe Rohrbreite von den Rohrachsen weg.
const POOL_INSET = 2.5;
// ARM_FITTINGS (aus model.js): Teile, die auf einem Stutzen der Kupplung sitzen
// -- dort gehoert einer gezeichnet, auch wenn kein Rohr steckt. Beim offenen
// Verbinderende ist genau das seine Aufgabe: es ERZWINGT den Stutzen (so auch
// in der Herstellersoftware).


// Farbschema der normalen Ansicht (die Szene bringt ihren eigenen Himmel mit).
// 空白画布：桦木工作台。风景开时背景要退后，把彩管留给主体。
const BG_LIGHT = 0xedd8c4;
const BG_DARK = 0x221e19;
// Bodenraster: Kantenlaenge und Zellweite. 1040 cm sind 52 Zellen je Achse --
// das urspruengliche 800er Raster plus sechs Zellen auf jeder Seite, damit auch
// breitere Aufbauten noch darauf stehen. Es bleibt deutlich innerhalb der
// Grasflaeche, sonst schwebte das Raster ueber deren Rand hinaus.
const GRID_SIZE = 1040;
// Voreingestellte Zellweite. Sie folgt der Schrittweite, die der Nutzer fuers
// Verschieben waehlt (setGridCell) -- das Bild zeigt damit genau das Raster, in
// dem sich Teile bewegen lassen. Alle Stufen teilen GRID_SIZE glatt.
const GRID_CELL = 20;

// Die Wiese um das Raster herum. Sie muss deutlich groesser sein als das
// Raster, sonst endet die Welt gleich hinter dem Aufbau; ihr Rand liegt am
// besten so weit draussen, dass er bei einem eingepassten Modell gar nicht ins
// Bild kommt. Baeume und Buesche stehen im Ring dahinter -- ausserhalb des
// Rasters, damit sie nicht in ein grosses Modell hineinragen.
const GROUND_AREA = 2600;                     // Kantenlaenge der Wiese, cm
const GRASS_TILE = 80;                        // 大块平铺，颗粒在，纹路不抢眼
const TREE_RING = [GRID_SIZE / 2 + 120, GROUND_AREA / 2 - 120];
const BUSH_RING = [GRID_SIZE / 2 + 60, GROUND_AREA / 2 - 100];

const GRID_LIGHT = [0xb88850, 0xd0b08a];   // 主线 / 次线：暖棕，显色底上要压得住
const GRID_DARK = [0x3d382f, 0x2e2a23];

// 风景退后：草地/树冠灰绿；天空走晴天蓝，避免阴天灰。
const SCENE_SKY_HORIZON = 0xeaf5fd;
const SCENE_SKY_ZENITH = 0xa7d9fb;
const SCENE_TRUNK = 0x6b5a3e;
const SCENE_CROWN_A = 0x649655;
const SCENE_CROWN_B = 0x709b62;
const SCENE_CROWN_C = 0x56804a;
const SCENE_BUSH = 0x4a7544;

// Ansichtswuerfel: Kanten hell/dunkel (die Flaechen stecken in der Textur).
const CUBE_EDGE_LIGHT = 0x6e7884;
const CUBE_EDGE_DARK = 0x3d4450;

const HIGHLIGHT_COLOR = 0xea580c;
const HIGHLIGHT_EMISSIVE = 0x612f00;
// Platten-Modus: das angeklickte Tragrohr (amber) und die Gegenrohre (gruen).
const FOCUS_COLOR = 0xf59e0b;
const FOCUS_EMISSIVE = 0x7c4a00;
const PARTNER_COLOR = 0x22c55e;
const PARTNER_EMISSIVE = 0x14532d;
// Einfuegen an einer belegten Stelle: die Kopie wird rot gezeichnet.
const INVALID_COLOR = 0xe03131;
const INVALID_EMISSIVE = 0x5a0000;

// Rundung des Kupplungs-Wuerfels (p-Norm des Superellipsoids). 2 waere die
// Kugel, grosse Werte ein scharfer Wuerfel. Bei 3 liegen die Flanken buendig
// auf 2,5 cm (Rohrradius 2,45) und die Ecken stehen nur noch 0,5 cm ueber --
// bei 5 waren es 1 cm, die Kupplung wirkte dadurch klobig.
const CONNECTOR_ROUNDNESS = 3;

// Herauszoomen begrenzen: sonst schrumpft das Modell zu einem Punkt in der
// Bildmitte und man findet ohne Zuruecksetzen nicht mehr hin. Grenze ist ein
// Vielfaches der Modelldiagonale -- bei diesem Abstand fuellt das Modell noch
// rund ein Drittel der Bildhoehe. Der Mindestwert gilt fuer kleine und leere
// Modelle, damit man ein gutes Stueck des Rasters (GRID_SIZE) noch sieht.
const ZOOM_OUT_FACTOR = 3;
// Luft am Bildrand, wenn die Ansicht auf ein Modell eingepasst wird.
const FIT_MARGIN = 1.15;
const MIN_ZOOM_OUT_DISTANCE = 600;   // cm

// Wie nah darf der Blick an Drauf- und Untersicht heran? OrbitControls rechnet
// mit fester Oben-Achse und entartet genau am Pol, deshalb bleibt ein Rest von
// gut einem Zehntelgrad -- sichtbar ist der nicht.
const POLE_GAP = 0.002;                          // rad
const MAX_PITCH = Math.PI / 2 - POLE_GAP;

// Ansichtswuerfel 右下角（避开右侧抽屉）。
const CUBE_PX = 80;
const CUBE_MARGIN = 22;
const CUBE_SNAP_MS = 320;   // Dauer des Kameraschwenks beim Klick
// Ortho-Ausschnitt. 45°-Orbit: Silhouette bis |ux|+|uy|+|uz| ≈ 1,63;
// darunter schneidet der Scissor die untere Spitze ab.
const CUBE_FRUSTUM = 1.85;

// Wie weit darf eine Rohrrichtung von einer Würfelachse abweichen, damit noch
// ein Kupplungsmodell dazu passt? cos(20°) ≈ 0,94. Alles Schiefere (Rampen,
// Sparren) bekommt weiter den selbst gezeichneten Würfel.
const AXIS_TOL = 0.94;

// Lokale Armmaske der acht abgegriffenen Kupplungen (siehe connectors.json).
// Gleicher Bitplan wie variant2 / CONNECTOR_ARM_BITS.
const CONN_TYPE_MASK = {
  straight: 0x03, elbow: 0x05, t: 0x07, cross: 0x0f,
  "3way": 0x15, "4way": 0x17, "5way": 0x1f, "6way": 0x3f,
};

function maskPopcount(mask) {
  let n = 0;
  for (let b = mask; b; b &= b - 1) n++;
  return n;
}

function pushUniqueArm(liste, d, bow) {
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-6) return;
  const u = [d[0] / L, d[1] / L, d[2] / L];
  if (liste.some((e) => e.d[0] * u[0] + e.d[1] * u[1] + e.d[2] * u[2] > 0.99)) return;
  liste.push({ d: u, bow: !!bow });
}

// Halbmesser des abgegriffenen Bogenrohrs (cm): 35er Rohr + Kupplung.
const BOW_MESH_R = 40;

// So weit rueckt der Import den Punkt des Spielsacks vor (BAG_OFFSET in
// qdfimport.js). Das abgegriffene Modell braucht den Punkt aus der Datei.
const BAG_OFFSET = 20;

/** Bit der Würfelachse, auf der diese Richtung liegt -- 0, wenn sie zu schief ist. */
function axisBit(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return ax < AXIS_TOL ? 0 : (x > 0 ? 0x01 : 0x02);
  if (ay >= az) return ay < AXIS_TOL ? 0 : (y > 0 ? 0x04 : 0x08);
  return az < AXIS_TOL ? 0 : (z > 0 ? 0x10 : 0x20);
}

/**
 * Die 24 Drehungen, die einen Würfel auf sich selbst abbilden: jede Wahl, wohin
 * +X zeigt (sechs), mal jede Wahl für +Y darauf senkrecht (vier).
 */
function cubeRotations() {
  const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const out = [];
  for (const x of AXES) {
    for (const y of AXES) {
      if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]) > 0.5) continue;
      const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
      out.push({ cols: [x, y, z], quat: new THREE.Quaternion().setFromRotationMatrix(m) });
    }
  }
  return out;
}

/** Armmaske, nachdem die Kupplung mit dieser Drehung gedreht wurde. */
function turnMask(mask, cols) {
  let out = 0;
  for (const [bit, d] of CONNECTOR_ARM_BITS) {
    if (!(mask & bit)) continue;
    const i = d[0] ? 0 : d[1] ? 1 : 2;
    const s = d[0] || d[1] || d[2];
    const c = cols[i];
    out |= axisBit(c[0] * s, c[1] * s, c[2] * s);
  }
  return out;
}

/**
 * Armmaske -> { Modell, Drehung }. Die acht abgegriffenen Kupplungen liegen in
 * je einer festen Lage vor; jede Maske mit mindestens zwei Armen ist genau eine
 * ihrer 24 Würfeldrehungen. Einmal gebaut, sobald die Modelle da sind.
 */
let _maskTable = null;
function maskTable(store) {
  if (_maskTable) return _maskTable;
  _maskTable = {};
  for (const rot of cubeRotations()) {
    for (const id of Object.keys(store)) {
      const mask = store[id].mask;
      if (!mask) continue;
      const turned = turnMask(mask, rot.cols);
      if (_maskTable[turned] === undefined) _maskTable[turned] = { id, quat: rot.quat };
    }
  }
  return _maskTable;
}

// Hintergrundfarben fuer die Beschriftung nach Kategorie (Aufbaumodus-Hervorhebung).
const LABEL_BG = {
  tube75: "rgba(139,61,245,0.94)",  // 75er Rohre - violett
  flaeche: "rgba(20,160,110,0.95)", // Flaechenkupplungen - gruen
  raum: "rgba(26,140,255,0.95)",    // Raumkupplungen - blau
};

export class SceneManager {
  constructor(container) {
    this.container = container;

    // Nur zeichnen, wenn sich wirklich etwas geaendert hat (siehe requestRender).
    this._needsRender = true;
    this._quality = DEFAULT_QUALITY;
    this._makeRenderer(QUALITY[DEFAULT_QUALITY].antialias);
    this.onRendererReplaced = () => {};   // Builder haengt seine Listener neu ein
    // Die abgegriffenen Modelle kommen erst nach dem ersten Bild; sind sie da,
    // laesst dieser Haken die Szene einmal neu aufbauen (main.js: builder.refresh).
    this.onMeshesReady = () => {};

    this.scene = new THREE.Scene();
    // Farbschema und Szene entscheiden gemeinsam ueber Hintergrund und Raster
    // (siehe _applyBackground/_applyGrid). Beim Bau steht beides auf "aus".
    this._dark = false;
    this._sceneOn = false;
    this._tune = { ...DEFAULT_TUNE.scene };
    this._grade = { ...DEFAULT_GRADE };
    this.scene.background = new THREE.Color(BG_LIGHT);

    // Beide Kameras stehen bereit; umgeschaltet wird ueber setProjection().
    // Die orthografische zeigt keine Fluchtpunkte -- parallele Rohre bleiben
    // parallel, Masse sind vergleichbar (Bauplan-Blick).
    this._perspCam = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 1, 100000
    );
    this._orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.camera = this._perspCam;
    this._projection = "perspective";
    this._defaultCam = { pos: [140, 120, 180], target: [0, 30, 0] };
    // Steht VOR dem ersten resetCamera(): der meldet den neuen Stand bereits.
    this.onCameraChange = () => {};   // von der UI zum Sichern ueberschrieben
    this.resetCamera();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this._bindControls(this.controls);
    this.controls.target.set(...this._defaultCam.target);

    // Licht: warmes Sonnenlicht + Himmelslicht + weiche Schatten
    this._hemiLight = new THREE.HemisphereLight(0xffffff, 0xa89880, 1.15);
    this.scene.add(this._hemiLight);
    this._dirLight = new THREE.DirectionalLight(0xffffff, 1.1);  // setScene() stellt Farbe/Staerke
    this._dirLight.position.set(200, 320, 150);
    this._dirLight.castShadow = true;
    this._dirLight.shadow.mapSize.width  = 2048;
    this._dirLight.shadow.mapSize.height = 2048;
    this._dirLight.shadow.camera.left   = -480;
    this._dirLight.shadow.camera.right  =  480;
    this._dirLight.shadow.camera.top    =  480;
    this._dirLight.shadow.camera.bottom = -480;
    this._dirLight.shadow.camera.near   =   1;
    this._dirLight.shadow.camera.far    =  800;
    this._dirLight.shadow.bias          = -0.0005;
    this._dirLight.shadow.radius        =   3;
    this.scene.add(this._dirLight);
    // Fuell- und Randlicht: weiches Volumen statt einer Plastik-Hotspot.
    this._fillLight = new THREE.DirectionalLight(0xfff4ea, 0.5);
    this._fillLight.position.set(-220, 90, -140);
    this._fillLight.castShadow = false;
    this.scene.add(this._fillLight);
    this._rimLight = new THREE.DirectionalLight(0xf4f7ff, 0.28);
    this._rimLight.position.set(-60, 40, 240);
    this._rimLight.castShadow = false;
    this.scene.add(this._rimLight);
    // Schattenaufloesung richtet sich nach der Qualitaetsstufe.
    this._applyShadowQuality();

    // Boden-Raster (20 cm Zellen). Er liegt eine halbe Kupplung TIEFER als die
    // Nullebene: Rohre auf y = 0 sind um ihre Achse zentriert, ihre untere
    // Haelfte laege sonst unter dem Boden und waere abgeschnitten.
    this._applyGrid();

    // Prozedurales Gras + gruener Boden (umschaltbar via setScene()).
    this._buildGrass();
    this._buildSky();
    this._buildTrees();
    this.setScene(false);

    // Gruppen
    this.buildGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this._hoverPartGroup = new THREE.Group();
    this._hoverPartGroup.name = "hover-part";
    this._roomGroup = new THREE.Group();
    this._roomGroup.name = "roomOverlay";
    this._roomSig = "";
    this.scene.add(this.buildGroup);
    this.scene.add(this.handleGroup);
    this.scene.add(this.labelGroup);
    this.scene.add(this._hoverPartGroup);
    this.scene.add(this._roomGroup);

    // Pick-Listen
    this.pickNodes = [];
    this.pickTubes = [];
    this.pickPanels = [];
    this.pickClamps = [];
    this.pickTextiles = [];
    this.pickSlides = [];
    this.pickFittings = [];
    this.pickReinforce = [];
    this.handleMeshes = [];
    this.labelMeshes = [];

    // Wiederverwendbare Ressourcen
    this._raycaster = new THREE.Raycaster();
    this._cubePadRight = 0;   // 右下角：相对右边的额外让位
    this._cubePadBottom = 0;  // 右下角：相对底边的额外让位
    this._cubePx = CUBE_PX;
    this._mouse = new THREE.Vector2();
    this._hover = null;
    this._arrowFocus = null;
    this._tubePreview = null;
    this._hoverPartId = null;
    this._hoverPartExtra = null;
    this._hoverPartExtraKey = "";
    this._hoverPartMode = null;
    this._hoverMat = new THREE.Matrix4();
    this._panning = false;

    this._connGeo = null;     // lazy (braucht Katalog-Geometrie)
    this._c45Geo = null;      // lazy (45-Grad-Adapter-Koerper, Box)
    this._c45StubGeo = null;  // lazy (Diagonal-Stutzen des Adapters)
    this._panelGeos = new Map(); // lazy, pro Plattenmass/Lochbild (siehe _panelGeometry)
    this._tubeGeos = new Map();  // lazy, pro Rohrlaenge (siehe _tubeGeometry)
    // Alle dauerhaft gecachten Geometrien. _disposeGroup darf sie nicht
    // freigeben -- frueher war das ein Array, das pro Aufruf neu gebaut und je
    // Mesh linear durchsucht wurde.
    this._keepGeos = new Set();
    this._materials = {};
    // Sammelbecken fuer instanziert gezeichnete Teile (siehe _batchAdd).
    this._batches = new Map();
    // Weltpositionen der gezeichneten Kupplungen (Drehpunkt-Suche).
    this._nodePoints = [];

    window.addEventListener("resize", () => this.onResize());
    // Container-Größe verfolgen: Layout der Sidebar steht beim Konstruieren
    // evtl. noch nicht final -> sonst überlappen Canvas und Panel bis zum
    // ersten Resize. ResizeObserver gleicht das automatisch ab.
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => this.onResize());
      this._resizeObserver.observe(container);
    }
    this._buildViewCube();
    this._animate = this._animate.bind(this);
    this._animate();
  }

  /**
   * Ansicht zuruecksetzen. Der BLICKWINKEL bleibt immer der der Vorgabe -- man
   * soll wissen, wo vorne ist. Abstand und Bildmitte richten sich dagegen nach
   * dem Modell, sofern eines mitkommt: die Kiste um alle Teile soll ganz im
   * Bild stehen, statt bei kleinen Modellen zu verschwinden und bei grossen
   * ueber den Rand zu ragen. Ohne Modell (oder bei leerem) gelten die alten
   * festen Werte.
   */
  resetCamera(model = null) {
    const start = new THREE.Vector3(...this._defaultCam.pos);
    const heim = new THREE.Vector3(...this._defaultCam.target);
    const dir = start.clone().sub(heim).normalize();
    this._frameAlong(model, dir);
  }

  /**
   * 绕竖直轴转 yaw 弧度后框住模型。说明书正/反视图用：0 是默认 3/4，π 是背面。
   * silent 时不写进会话相机。
   */
  frameFromYaw(model, yaw = 0, opts = {}) {
    const start = new THREE.Vector3(...this._defaultCam.pos);
    const heim = new THREE.Vector3(...this._defaultCam.target);
    const dir = start.clone().sub(heim);
    if (yaw) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    dir.normalize();
    if (opts.elevate) {
      dir.y += opts.elevate;
      dir.normalize();
    }
    this._frameAlong(model, dir, opts);
  }

  /**
   * 世界坐标投到当前相机画面，返回 0–1 的 uv（原点在左上）以及 NDC z。
   * 在相机背后或明显出画的点返回 null。aspect 若给定会临时改透视比，投完还原。
   */
  projectWorld(points, aspect = null) {
    const cam = this.camera;
    const prevAspect = cam.aspect;
    if (aspect && Math.abs(aspect - cam.aspect) > 1e-4) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position;
    const v = new THREE.Vector3();
    const to = new THREE.Vector3();
    const out = [];
    for (const p of points) {
      v.set(p[0], p[1], p[2]);
      to.copy(v).sub(origin);
      if (to.dot(dir) <= 0.4) {
        out.push(null);
        continue;
      }
      v.project(cam);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.12 || Math.abs(v.y) > 1.12) {
        out.push(null);
        continue;
      }
      out.push({
        u: v.x * 0.5 + 0.5,
        v: -v.y * 0.5 + 0.5,
        z: v.z,
      });
    }
    if (aspect && Math.abs(prevAspect - cam.aspect) > 1e-4) {
      cam.aspect = prevAspect;
      cam.updateProjectionMatrix();
    }
    return out;
  }

  getCameraPose() {
    const t = this.controls ? this.controls.target : new THREE.Vector3(...this._defaultCam.target);
    return {
      pos: this.camera.position.toArray(),
      target: t.toArray(),
      zoom: this.camera.zoom,
      projection: this._projection,
    };
  }

  setCameraPose(pose) {
    if (!pose) return;
    this._camAnim = null;
    this._needsRender = true;
    if (pose.projection && pose.projection !== this._projection) this.setProjection(pose.projection);
    this.camera.position.fromArray(pose.pos);
    this.camera.zoom = pose.zoom || 1;
    this.camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    this.camera.updateProjectionMatrix();
    if (this.controls) {
      this.controls.target.fromArray(pose.target);
      this.controls.update();
    }
    this._updateOrthoFrustum();
  }

  _frameAlong(model, dir, opts = {}) {
    this._camAnim = null;
    this._needsRender = true;
    const heim = new THREE.Vector3(...this._defaultCam.target);
    const pad = geometry().connectorSize / 2;
    const b = opts.bounds || (model && model.bounds ? model.bounds(pad) : null);
    const leer = !b || (!b.size[0] && !b.size[1] && !b.size[2]);
    let target, dist;
    if (leer) {
      target = heim;
      dist = new THREE.Vector3(...this._defaultCam.pos).distanceTo(heim);
    } else {
      target = new THREE.Vector3(
        (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      const w = this._viewSize?.w || this.container.clientWidth || 1;
      const h = this._viewSize?.h || this.container.clientHeight || 1;
      const aspect = opts.aspect || (w / h);
      const fovV = (this._perspCam.fov * Math.PI) / 180;
      const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
      const blick = dir.clone().negate();
      let quer = new THREE.Vector3().crossVectors(blick, new THREE.Vector3(0, 1, 0));
      if (quer.lengthSq() < 1e-6) quer = new THREE.Vector3(1, 0, 0);
      quer.normalize();
      const hoch = new THREE.Vector3().crossVectors(quer, blick).normalize();
      const tanH = Math.tan(fovH / 2), tanV = Math.tan(fovV / 2);
      let noetig = 1;
      for (const cx of [b.min[0], b.max[0]]) {
        for (const cy of [b.min[1], b.max[1]]) {
          for (const cz of [b.min[2], b.max[2]]) {
            const v = new THREE.Vector3(cx, cy, cz).sub(target);
            const tiefe = v.dot(blick);
            noetig = Math.max(noetig,
              Math.abs(v.dot(quer)) / tanH + tiefe,
              Math.abs(v.dot(hoch)) / tanV + tiefe);
          }
        }
      }
      dist = (opts.margin || FIT_MARGIN) * noetig;
      if (!opts.silent) this._maxDistance = Math.max(this._maxDistance || 0, dist);
      if (opts.lookDown) target.y -= (b.max[1] - b.min[1]) * opts.lookDown;
    }

    const prev = this.onCameraChange;
    if (opts.silent) this.onCameraChange = () => {};
    try {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
      if (this.controls) {
        this.controls.target.copy(target);
        this.controls.update();
      }
      this._updateOrthoFrustum();
      this.onCameraChange();
    } finally {
      this.onCameraChange = prev;
    }
  }

  /** Aktive Projektion: "perspective" | "orthographic". */
  get projection() { return this._projection; }

  /**
   * Projektion umschalten. Standort, Blickrichtung und der sichtbare Ausschnitt
   * werden uebernommen: die Bildhoehe der orthografischen Kamera ergibt sich aus
   * Abstand und Oeffnungswinkel der perspektivischen, sonst springt das Bild.
   */
  setProjection(mode) {
    if (mode !== "perspective" && mode !== "orthographic") return false;
    if (mode === this._projection) return false;
    const from = this.camera;
    const to = mode === "orthographic" ? this._orthoCam : this._perspCam;
    const target = this.controls ? this.controls.target : new THREE.Vector3(...this._defaultCam.target);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    // Zurueck zur Perspektive: der orthografische Zoom steckt in camera.zoom,
    // die Perspektive kennt das nicht -- also in einen Abstand umrechnen, sonst
    // springt die Bildgroesse.
    if (mode === "perspective" && from.zoom !== 1) {
      const dir = new THREE.Vector3().subVectors(from.position, target);
      dir.setLength(dir.length() / from.zoom);
      to.position.copy(target).add(dir);
    }
    to.zoom = 1;
    to.updateProjectionMatrix();
    this._projection = mode;
    this.camera = to;
    this._needsRender = true;
    this._updateOrthoFrustum();
    if (this.controls) {
      this.controls.object = to;
      this.controls.update();
    }
    // Der Wechsel schiebt die Kamera (Zoom -> Abstand): auch das gehoert
    // gesichert, sonst kommt nach dem Reload der Stand von davor zurueck.
    this.onCameraChange();
    return true;
  }

  // Bildausschnitt der orthografischen Kamera aus Abstand zum Ziel und dem
  // Oeffnungswinkel der perspektivischen ableiten -- so deckt sie beim
  // Umschalten denselben Bereich ab.
  _updateOrthoFrustum() {
    const w = this._viewSize?.w || this.container.clientWidth;
    const h = this._viewSize?.h || this.container.clientHeight;
    if (!w || !h) return;
    const target = this.controls ? this.controls.target : new THREE.Vector3(...this._defaultCam.target);
    const dist = this.camera.position.distanceTo(target) || 1;
    const height = 2 * dist * Math.tan((this._perspCam.fov / 2) * (Math.PI / 180));
    const width = height * (w / h);
    const o = this._orthoCam;
    o.left = -width / 2; o.right = width / 2;
    o.top = height / 2; o.bottom = -height / 2;
    o.updateProjectionMatrix();
    // Der kleinste Zoomfaktor haengt an der Bildhoehe -- die hat sich hier
    // gerade geaendert.
    this._applyZoomLimits();
  }

  /**
   * Grenze fuers Herauszoomen setzen. Mit model wird sie aus dessen Groesse neu
   * berechnet, ohne Argument nur erneut angewendet (Fenstergroesse, Projektion).
   *
   * Perspektivisch begrenzt OrbitControls den Abstand zum Ziel, orthografisch
   * dagegen camera.zoom -- dort bleibt die Kamera stehen und nur der Aus-
   * schnitt waechst. Deshalb dieselbe Grenze zusaetzlich als Zoomfaktor.
   */
  _applyZoomLimits(model) {
    if (model !== undefined) {
      const b = model && model.bounds ? model.bounds(0) : null;
      const diag = b ? Math.hypot(b.size[0], b.size[1], b.size[2]) : 0;
      this._maxDistance = Math.max(MIN_ZOOM_OUT_DISTANCE, diag * ZOOM_OUT_FACTOR);
    }
    const maxDist = this._maxDistance || MIN_ZOOM_OUT_DISTANCE;
    if (!this.controls) return;
    this.controls.maxDistance = maxDist;
    const o = this._orthoCam;
    const maxHeight = 2 * maxDist * Math.tan((this._perspCam.fov / 2) * (Math.PI / 180));
    const minZoom = maxHeight > 0 ? (o.top - o.bottom) / maxHeight : 0;
    this.controls.minZoom = minZoom;

    // Steht die Kamera schon zu weit draussen (kleineres Modell geladen), sie
    // gleich heranholen. OrbitControls klemmt sonst erst beim naechsten Zug.
    const t = this.controls.target;
    if (this._projection === "orthographic") {
      if (this.camera.zoom < minZoom) {
        this.camera.zoom = minZoom;
        this.camera.updateProjectionMatrix();
        this._needsRender = true;
      }
    } else {
      const d = this.camera.position.distanceTo(t);
      if (d > maxDist) {
        this.camera.position.copy(t)
          .addScaledVector(this.camera.position.clone().sub(t).normalize(), maxDist);
        this._needsRender = true;
      }
    }
  }

  /** Bildpunkte je CSS-Punkt: Geraet mal Supersampling der Qualitaetsstufe. */
  _pixelRatio() {
    const geraet = window.devicePixelRatio || 1;
    return Math.min(MAX_PIXEL_RATIO, geraet * (this._q().ss || 1));
  }

  onResize() {
    this._needsRender = true;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    // Unveraenderte Groesse ignorieren: sonst kann der ResizeObserver sich
    // ueber setSize() selbst erneut ausloesen (Endlosschleife).
    if (w === this._lastW && h === this._lastH) return;
    this._lastW = w;
    this._lastH = h;
    this._perspCam.aspect = w / h;
    this._perspCam.updateProjectionMatrix();
    this._updateOrthoFrustum();
    // updateStyle = false -> Three schreibt KEINE festen px-Werte in den
    // Canvas-Style. Sonst wird der Canvas breiter als sein Container, das
    // Dokument bekommt eine Scrollbar, der Container schrumpft um deren
    // Breite, der Observer feuert erneut -> Viewport flackert dauerhaft.
    this.renderer.setSize(w, h, false);
  }

  // Auf die nächste Achse gerundete horizontale Blickrichtung (für Pfeiltasten).
  /**
   * Schaut die Kamera eher flach von der Seite auf das Modell (frontal) oder
   * von oben herab? Ab 45 Grad Neigung gilt der Blick als Aufsicht. Die
   * Pfeiltasten richten sich danach: frontal zeigt "hoch" nach oben, in der
   * Aufsicht nach hinten -- also immer dorthin, wo es auf dem Bildschirm
   * tatsaechlich hingeht.
   */
  isFrontalView() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    return Math.abs(f.y) < Math.SQRT1_2;
  }

  /** Standort der Kamera in Weltkoordinaten -- von wo aus wird gebaut? */
  cameraPosition() {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }

  getHorizontalAxes() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const forward = Math.abs(f.x) >= Math.abs(f.z)
      ? [Math.sign(f.x) || 1, 0, 0]
      : [0, 0, Math.sign(f.z) || 1];
    const right = [-forward[2], 0, forward[0]];
    return { forward, right };
  }

  /**
   * Die beiden Achsen, in denen sich mit der Maus schieben laesst. Sie folgen
   * dem Blickwinkel wie die Pfeiltasten: frontal die Waagerechte quer zum Blick
   * und die Senkrechte, aus der Aufsicht die beiden Waagerechten. Fuer die
   * dritte Achse dreht man die Ansicht.
   */
  dragAxes() {
    const ax = this.getHorizontalAxes();
    return this.isFrontalView() ? { u: ax.right, v: [0, 1, 0] } : { u: ax.right, v: ax.forward };
  }

  /**
   * Weltpunkt unter dem Zeiger auf der Schiebe-Ebene durch origin. Die Ebene
   * steht senkrecht auf der Achse, in der NICHT geschoben wird (siehe
   * dragAxes), damit die Bewegung der Maus folgt.
   */
  dragPlanePoint(clientX, clientY, origin) {
    this._setMouse(clientX, clientY);
    const ax = this.getHorizontalAxes();
    const n = this.isFrontalView()
      ? new THREE.Vector3(ax.forward[0], ax.forward[1], ax.forward[2])
      : new THREE.Vector3(0, 1, 0);
    // Der Aufrufer darf auch ein einfaches [x,y,z] schicken -- builder.js
    // kennt Three.js nicht.
    const o = origin && origin.isVector3
      ? origin : new THREE.Vector3(origin[0], origin[1], origin[2]);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  /**
   * Weltpunkt unter dem Zeiger auf einer frei gewaehlten Ebene. Anders als
   * dragPlanePoint legt der Aufrufer die Normale fest -- das Einfuegen haelt
   * damit die Hoehe fest und schiebt nur in der Ebene. Steht die Ebene fast
   * parallel zum Blick, gibt es keinen brauchbaren Schnittpunkt: dann null.
   */
  pointOnPlane(clientX, clientY, origin, normal) {
    this._setMouse(clientX, clientY);
    const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
    // Fast parallel = der Schnittpunkt wandert ins Unendliche.
    if (Math.abs(this._raycaster.ray.direction.dot(n)) < 0.15) return null;
    const o = origin && origin.isVector3
      ? origin : new THREE.Vector3(origin[0], origin[1], origin[2]);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  /** Mauszeiger-Form setzen (Builder signalisiert damit "verschiebbar"). */
  setCursor(css) {
    this.container.classList.toggle("qb-cursor-delete", css === "delete-x");
    this.container.style.cursor = css === "delete-x" ? "none" : (css || "default");
    if (css !== "delete-x") this._setDeleteX(false);
  }

  _setDeleteX(on, clientX, clientY) {
    if (!this._deleteXEl) {
      const el = document.createElement("div");
      el.className = "qb-delete-x";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
      this._deleteXEl = el;
    }
    const el = this._deleteXEl;
    el.classList.toggle("on", !!on);
    if (on && clientX != null) {
      el.style.left = `${clientX}px`;
      el.style.top = `${clientY}px`;
    }
  }

  // Abgerundeter Wuerfel (Superellipsoid): eine Kugel wird per p-Norm zum
  // Wuerfel mit weichen Kanten gezogen -- groesseres n = kantiger, n = 2 waere
  // wieder die Kugel. Das trifft die echte QUADRO-Kupplung deutlich besser als
  // ein scharfkantiger Wuerfel und braucht keine zusaetzliche Geometrie-Klasse.
  // Die Flanken liegen bei size/2 (2,5 cm) und schliessen damit buendig mit dem
  // Rohr ab (tubeRadius 2,45 cm).
  _roundedBoxGeometry(size, n = CONNECTOR_ROUNDNESS, segW = 16, segH = 10) {
    const half = size / 2;
    const geo = new THREE.SphereGeometry(half, segW, segH);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).divideScalar(half);   // auf die Einheitskugel
      const s = Math.abs(v.x) ** n + Math.abs(v.y) ** n + Math.abs(v.z) ** n;
      v.multiplyScalar(half * s ** (-1 / n));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Renderer anlegen bzw. ersetzen. Antialiasing laesst sich an einem
   * bestehenden WebGLRenderer nicht umschalten -- dafuer muss ein neuer her.
   */
  _makeRenderer(antialias) {
    const old = this.renderer;
    this.renderer = new THREE.WebGLRenderer({ antialias: !!antialias });
    this.renderer.setPixelRatio(this._pixelRatio());
    // updateStyle = false: die CSS-Groesse des Canvas kommt aus dem Stylesheet
    // (100 % des Containers), nicht als feste px-Werte -> siehe onResize().
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    // PCFShadowMap ist seit r182 die weiche Variante -- PCFSoftShadowMap gilt
    // dort als ueberholt.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Die Schattenkarte wird NICHT pro Bild neu gerechnet: das waere ein zweiter
    // Durchgang ueber alle ~1850 Werfer, obwohl sich Licht und Modell selten
    // aendern. _shadowsDirty() stoesst sie gezielt an (Modell, Szene, Schnitt).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.enabled = QUALITY[this._quality].shadow > 0;
    // Die Schnittebene haengt an den MATERIALIEN des Modells, nicht am Renderer
    // -- Boden, Gras, Baeume und Himmel sollen ungeschnitten stehen bleiben.
    this.renderer.localClippingEnabled = true;
    if (this._clipPlane) this._applyClip();
    if (old) {
      old.dispose();
      old.domElement.remove();
    }
    this.container.appendChild(this.renderer.domElement);
    this._needsRender = true;
  }

  /** Schattenaufloesung der Stufe anwenden (0 = Schatten aus). */
  _applyShadowQuality() {
    const size = QUALITY[this._quality].shadow;
    this.renderer.shadowMap.enabled = size > 0;
    if (size > 0 && this._dirLight) {
      const sh = this._dirLight.shadow;
      if (sh.mapSize.width !== size) {
        sh.mapSize.set(size, size);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
    }
    this._shadowsDirty();
  }

  /** Aktuelle Qualitaetsstufe (Aufloesung der Geometrien). */
  get quality() { return this._quality; }

  /**
   * Qualitaetsstufe setzen. Wirft die davon abhaengigen Geometrie-Caches weg;
   * der Aufrufer muss anschliessend neu rendern (builder.refresh()), sonst
   * zeigen die vorhandenen Meshes noch die alte Aufloesung.
   */
  setQuality(level) {
    if (!QUALITY[level] || level === this._quality) return false;
    const prev = this._quality;
    this._quality = level;
    this._shadowsDirty();
    for (const key of ["_connGeo", "_c45Geo", "_c45StubGeo"]) {
      if (this[key]) { this._keepGeos.delete(this[key]); this[key].dispose(); }
      this[key] = null;
    }
    // Rohr-, Deckel- und Plattengeometrien haengen an der Stufe -> Cache leeren.
    for (const g of this._tubeGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
    this._tubeGeos.clear();
    for (const g of this._panelGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
    this._panelGeos.clear();
    if (this._capGeos) {
      for (const g of this._capGeos.values()) { this._keepGeos.delete(g); g.dispose(); }
      this._capGeos.clear();
    }
    // Grobe gegen feine Modelle tauschen -- die Dateien holt meshes.js beim
    // naechsten Bild nach, bis dahin steht das Teil in der anderen Aufloesung.
    if (QUALITY[level].fine !== QUALITY[prev].fine) this._dropMeshes();
    this._applyShadowQuality();
    // Kantenglaettung nur ueber einen neuen Renderer moeglich. Danach haengen
    // OrbitControls und die Zeiger-Listener am alten Canvas -> neu binden.
    if (QUALITY[level].antialias !== QUALITY[prev].antialias) this._replaceRenderer();
    else if (QUALITY[level].ss !== QUALITY[prev].ss) {
      // Nur die Punktdichte aendert sich -- dafuer braucht es keinen neuen
      // Renderer, aber ein setSize danach, sonst behaelt der Puffer seine alte
      // Groesse und das Bild wird verzerrt.
      this.renderer.setPixelRatio(this._pixelRatio());
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
      this._needsRender = true;
    }
    return true;
  }

  _q() { return QUALITY[this._quality] || QUALITY[DEFAULT_QUALITY]; }

  /** OrbitControls nach dem Bau / Renderer-Wechsel gleich einstellen. */
  _bindControls(controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    controls.enablePan = true;
    // Drehen macht der Builder selbst (um den Punkt unter dem Zeiger).
    controls.mouseButtons.LEFT = null;
    // Rechte Taste bleibt PAN -- mit der Maus. Am Mac-Trackpad gibt es keine
    // mittlere Taste; Querverschieben laeuft ueber ⌥-Ziehen / ⇧+Zwei-Finger.
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener("end", () => {
      if (!this.orbiting && !this.panning) this._reanchorTarget();
      this.onCameraChange();
    });
  }

  /**
   * Renderer austauschen und alles neu verbinden, was am Canvas haengt:
   * OrbitControls (Ziel/Position bleiben erhalten) und die Zeiger-Listener des
   * Builders ueber onRendererReplaced.
   */
  _replaceRenderer() {
    const pos = this.camera.position.clone();
    const target = this.controls.target.clone();
    const zoom = this.camera.zoom;
    this.controls.dispose();
    this._makeRenderer(QUALITY[this._quality].antialias);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this._bindControls(this.controls);
    this.camera.position.copy(pos);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
    this.onRendererReplaced();
  }

  // Rohr-Geometrie, gecacht je Laenge/Radius/Segmentzahl. Vorher entstand pro
  // Rohr und pro Render-Durchlauf eine neue CylinderGeometry (~425 Stueck), die
  // beim naechsten Durchlauf wieder weggeworfen wurde.
  _tubeGeometry(radius, length, segments) {
    const key = `${radius.toFixed(2)}:${length.toFixed(2)}:${segments}`;
    let geo = this._tubeGeos.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(radius, radius, length, segments);
      this._tubeGeos.set(key, geo);
      this._keepGeos.add(geo);
    }
    return geo;
  }

  // Abschluss-Scheibe fuer die Enden eines Bogenrohrs, gecacht wie die
  // Rohr-Geometrien. Liegt in der XY-Ebene, Normale +Z.
  _capGeometry(radius, segments) {
    if (!this._capGeos) this._capGeos = new Map();
    const key = `${radius.toFixed(2)}:${segments}`;
    let geo = this._capGeos.get(key);
    if (!geo) {
      geo = new THREE.CircleGeometry(radius, segments);
      this._capGeos.set(key, geo);
      this._keepGeos.add(geo);
    }
    return geo;
  }

  _connGeometry() {
    if (!this._connGeo) {
      const s = geometry().connectorSize;
      const seg = this._q().conn;
      this._connGeo = seg ? this._roundedBoxGeometry(s, CONNECTOR_ROUNDNESS, seg[0], seg[1])
        : new THREE.BoxGeometry(s, s, s);
    }
    return this._connGeo;
  }

  // ---- Abgegriffene Originalmodelle (meshes.js) -------------------------------

  /** Geometrie aus einem geladenen Modell, einmal gebaut und behalten. */
  _meshGeometry(key, rec) {
    return this._cachedGeo("mesh:" + key, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(rec.pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(rec.nrm, 3));
      geo.setIndex(new THREE.BufferAttribute(rec.idx, 1));
      geo.computeBoundingSphere();
      return geo;
    });
  }

  /**
   * Modelle nachladen und danach EINMAL neu zeichnen lassen. Beides passiert
   * erst, wenn wirklich etwas davon vorkommt -- ein leerer Entwurf holt die
   * Rutschen gar nicht. Bis die Antwort da ist, zeichnet die Szene ihre eigenen
   * Formen; schlaegt sie fehl, bleibt es dabei.
   */
  _ensureMeshes(which) {
    const feld = MESH_FIELDS[which] || "_connMeshes";
    if (this[feld] !== undefined) return this[feld];
    const fein = !!this._q().fine;
    this[feld] = null;   // laeuft -> nicht noch einmal anfordern
    const laden = which === "slides" ? loadSlideMeshes(fein)
      : which === "tubes" ? loadTubeMeshes(fein)
      : which === "fittings" ? loadFittingMeshes(fein)
      : which === "surfaces" ? loadSurfaceMeshes(fein) : loadConnectorMeshes(fein);
    laden.then((rec) => {
      // Hat die Stufe waehrend des Ladens gewechselt, gehoert die Antwort zur
      // falschen Aufloesung. Sie faellt weg; das Feld steht dank _dropMeshes()
      // schon wieder auf `undefined` und wird gleich neu angefordert.
      if (!!this._q().fine !== fein) return;
      // `false` heisst: endgueltig nichts geworden (Datei fehlt, kein Netz).
      // Damit wartet das Bild nicht weiter, sondern zeichnet seine eigenen
      // Formen -- `null` bedeutet dagegen "laeuft noch".
      this[feld] = rec || false;
      this.onMeshesReady();
    });
    return null;
  }

  /**
   * Kleiner Ladekreisel ueber der Zeichenflaeche. Er laeuft nur, solange die
   * Modelldateien unterwegs sind: gezeichnet wird in dieser Zeit gar nichts,
   * damit nicht erst die Ersatzformen aufblitzen (siehe renderModel).
   */
  _setLoading(an) {
    if (!this._spinner) {
      if (!an) return;
      this._spinner = document.createElement("div");
      this._spinner.className = "scene-spinner";
      this._spinner.setAttribute("aria-hidden", "true");
      this.container.appendChild(this._spinner);
    }
    this._spinner.classList.toggle("visible", !!an);
  }

  /**
   * Geladene Modelle wegwerfen -- beim Wechsel zwischen grober und feiner
   * Fassung. Die Felder gehen auf `undefined` zurueck, damit das naechste Bild
   * sie neu anfordert (die JSON-Dateien selbst haelt meshes.js fest, es geht
   * also kein Netzverkehr verloren), und die daraus gebauten Geometrien geben
   * ihren Grafikspeicher frei: beide Aufloesungen gleichzeitig zu halten waere
   * bei den Rutschen der groesste Posten der ganzen Szene.
   */
  _dropMeshes() {
    _maskTable = null;
    for (const feld of Object.values(MESH_FIELDS)) this[feld] = undefined;
    if (!this._fitGeos) return;
    for (const [key, geo] of [...this._fitGeos]) {
      if (!key.startsWith("mesh:")) continue;
      this._fitGeos.delete(key);
      this._keepGeos.delete(geo);
      geo.dispose();
    }
  }

  /**
   * Passendes Kupplungsmodell zu den Richtungen, in denen an diesem Knoten
   * wirklich etwas steckt. Geliefert wird Geometrie samt Drehung, oder `null`
   * -- dann zeichnet der Aufrufer wie bisher Würfel plus Stutzen.
   *
   * Der Weg: die Weltrichtungen zurück in das lokale System der Kupplung
   * drehen, auf die Würfelachsen runden und daraus die Armmaske bilden (dieselbe
   * Bitfolge wie `variant2` in der Datei). Jedes Modell liegt nur in EINER Lage
   * vor -- welche der 24 Würfeldrehungen es auf die gesuchte Maske bringt, steht
   * in `maskTable()`.
   *
   * `null` kommt heraus, wenn eine Richtung mehr als ~20 Grad von ihrer Achse
   * abweicht (Rampen, Sparren), wenn zwei Teile denselben Arm belegen, oder bei
   * weniger als zwei Armen.
   */
  _connMeshFor(dirs, cubeQuat, typeId) {
    const store = this._connMeshes;
    if (!store) return null;
    const inv = cubeQuat.clone().invert();
    const v = new THREE.Vector3();
    let mask = 0;
    let maskOk = dirs.length > 0;
    for (const e of dirs) {
      v.set(e.d[0], e.d[1], e.d[2]).applyQuaternion(inv);
      const bit = axisBit(v.x, v.y, v.z);
      if (!bit || mask & bit) { maskOk = false; break; }
      mask |= bit;
    }
    let entry = maskOk ? maskTable(store)[mask] : null;
    if (!entry && typeId && store[typeId] && store[typeId].mask) {
      entry = maskTable(store)[store[typeId].mask];
      if (entry) entry = { id: typeId, quat: entry.quat };
      else entry = { id: typeId, quat: new THREE.Quaternion() };
    }
    if (!entry) return null;
    const rec = store[entry.id];
    if (!rec) return null;
    return {
      geo: this._meshGeometry("conn:" + entry.id, rec),
      quat: cubeQuat.clone().multiply(entry.quat),
    };
  }

  /**
   * Armrichtungen fuer das Kupplungsmodell: belegte Rohre plus offene Stutzen.
   * Import bringt die physischen Arme in `node.arms` (variant2, inkl. leer);
   * im Editor gilt `preferType`, damit eine abgelegte 4-Wege-Kupplung auch
   * ohne Rohr die leeren Huelsen zeigt -- sonst bleibt nur der Ersatzwuerfel.
   */
  _connectorArmDirs(n, tubeDirs, cubeQuat) {
    const dirs = [];
    for (const e of tubeDirs) pushUniqueArm(dirs, e.d, e.bow);
    if (n.arms) {
      for (const a of n.arms) pushUniqueArm(dirs, a, false);
    }
    const typeId = n.preferType;
    const store = this._connMeshes;
    const mask = (typeId && store && store[typeId] && store[typeId].mask)
      || CONN_TYPE_MASK[typeId]
      || 0;
    if (mask && maskPopcount(mask) > dirs.length) {
      const v = new THREE.Vector3();
      for (const [bit, d] of CONNECTOR_ARM_BITS) {
        if (!(mask & bit)) continue;
        v.set(d[0], d[1], d[2]).applyQuaternion(cubeQuat);
        pushUniqueArm(dirs, [v.x, v.y, v.z], false);
      }
    }
    return dirs;
  }

  /**
   * Abgegriffenes Modell zu einer Flaeche (Platte oder Tuch), passend zu ihrer
   * Spannweite. Geliefert wird Geometrie samt Lage-Matrix, oder `null` -- dann
   * zeichnet der Aufrufer wie bisher.
   *
   * Achsen wie in der Datei (siehe rectLine in qdfexport.js): lokales X entlang
   * der Kante A->B, lokales Z die Normale, Y = Z x X. Der Bezugspunkt ist die
   * Mitte der vier Ecken, also die Rohrachsen-Ebene -- der Versatz auf den
   * Rohrscheitel steckt schon im Modell (dessen Z laeuft von -22 bis +25 mm).
   *
   * Der Schluessel ist das Masspaar in Millimetern, Feld 3 (lokale Y-Achse)
   * zuerst. Die halbe Platte liegt nur in EINER Drehung vor; kommt sie quer,
   * wird das Kreuz um 90 Grad um die Normale gedreht. Die Lochplatte steht
   * unter ihrer Katalog-Kennung -- `art` ist dann schon der ganze Schluessel.
   */
  _surfaceMeshFor(art, xAxis, zAxis, spanX, spanZ, center, nrmArr, side) {
    const store = this._surfMeshes;
    if (!store) return null;
    const cs = geometry().connectorSize;
    const mm = (cm) => Math.round((cm - cs) * 10);
    const key = store[art] ? art : `${art}_${mm(spanZ)}x${mm(spanX)}`;
    const quer = `${art}_${mm(spanX)}x${mm(spanZ)}`;
    const rec = store[key] || store[quer];
    if (!rec) return null;
    const gedreht = !store[key];
    const nrm = new THREE.Vector3(nrmArr[0], nrmArr[1], nrmArr[2]).normalize()
      .multiplyScalar((side || 1) < 0 ? -1 : 1);
    // Rechtshaendiges Dreibein zur gewaehlten Normalen, X bleibt die Kante A->B.
    const ex = gedreht ? zAxis.clone() : xAxis.clone();
    ex.addScaledVector(nrm, -ex.dot(nrm)).normalize();
    const ey = new THREE.Vector3().crossVectors(nrm, ex).normalize();
    return {
      geo: this._meshGeometry("surf:" + (gedreht ? quer : key), rec),
      matrix: new THREE.Matrix4().makeBasis(ex, ey, nrm).setPosition(center),
    };
  }

  /**
   * Drehung des Kupplungswuerfels an diesem Knoten. Importierte Kupplungen
   * drehen exakt um ihre Quaternion aus der Datei, damit die Arme aus den
   * Flaechen kommen -- auch bei Rampenwinkeln (30°/60°). Kardinale Kupplungen
   * sind invariant. Manuell gebaute Schraegen (ohne quat) drehen 45 Grad um die
   * Schraegen-Achse.
   */
  _nodeCubeQuat(model, n) {
    const quat = new THREE.Quaternion();
    if (n.quat && n.quat.length === 4) {
      quat.set(n.quat[0], n.quat[1], n.quat[2], n.quat[3]).normalize();
    } else {
      const sa = this._slopeRotationAxis(model, n);
      if (sa) quat.setFromAxisAngle(sa, Math.PI / 4);
    }
    return quat;
  }

  /**
   * Basiskupplung einer Winkelkupplung: der Knoten, auf dessen Stutzen sie
   * steckt. Beim Import ist das der Knoten am anderen Ende der Arm-Kante des
   * Adapter-Koerpers, im Editor der Knoten selbst. Die Datei fuehrt die
   * `connector45_2` genau dort und mit dessen Lage (siehe qdfexport.js).
   */
  _c45BaseNode(model, n) {
    if (!n.c45body) return n;
    for (const t of model.tubes.values()) {
      if (!t.arm) continue;
      if (t.a === n.id) return model.nodes.get(t.b) || null;
      if (t.b === n.id) return model.nodes.get(t.a) || null;
    }
    return null;
  }

  /**
   * Lage-Matrix für das abgegriffene Modell der Winkelkupplung, oder `null`.
   *
   * Sie hat eine EIGENE Drehung, nicht die des Würfels: der Würfel ist
   * drehsymmetrisch, die Winkelkupplung nicht, und an 559 der 726 Vorkommen im
   * Bestand tragen `connector3` und `connector45_2` an derselben Stelle
   * verschiedene Quaternionen. Aus der Datei kommt sie als `c45quat`.
   *
   * Fehlt sie (im Editor gesetzt), wird sie gebaut: lokales +X ist die Achse,
   * auf der die Hülse steckt (`c45axis`), lokales +Y die Querkomponente des
   * 45-Grad-Arms -- im Modell läuft die Hülse von 15 bis 95 mm auf +X und der
   * Arm bis 93 mm auf +Y.
   */
  _c45Placement(model, n) {
    const basis = this._c45BaseNode(model, n);
    if (!basis) return null;
    const pos = new THREE.Vector3(basis.x, basis.y, basis.z);
    if (basis.c45quat && basis.c45quat.length === 4) {
      const q = new THREE.Quaternion(
        basis.c45quat[0], basis.c45quat[1], basis.c45quat[2], basis.c45quat[3]).normalize();
      return new THREE.Matrix4().compose(pos, q, ONE);
    }
    const achse = n.c45axis || basis.c45axis;
    if (!achse) return null;
    const ex = new THREE.Vector3(achse[0], achse[1], achse[2]).normalize();
    // Richtung des 45-Grad-Arms: zum Adapter-Koerper, sonst aus der Schraege.
    const ziel = n.c45body ? n : null;
    const arm = ziel
      ? new THREE.Vector3(ziel.x - basis.x, ziel.y - basis.y, ziel.z - basis.z)
      : (this._c45ArmDirAt ? null : null);
    if (!arm || arm.lengthSq() < 1e-6) return null;
    const ey = arm.addScaledVector(ex, -arm.dot(ex));
    if (ey.lengthSq() < 1e-6) return null;
    ey.normalize();
    const ez = new THREE.Vector3().crossVectors(ex, ey);
    return new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(pos);
  }

  /**
   * Bogenrohr als abgegriffenes Originalmodell. Seine Lage ist dieselbe wie in
   * der Datei: Ursprung im Knoten, lokales +X die Tangente am Bogenanfang,
   * lokales +Y zum Kreismittelpunkt. Beides steht hier aus der Geometrie zur
   * Verfügung, also braucht es die Datei-Lage (`t.geom`) nicht -- auch im
   * Editor gesetzte Bögen kommen so durch.
   *
   * Das Modell ist ein festes Viertel mit 40 cm Halbmesser; weicht ein Bogen
   * davon ab (Winkelrohre mit 135 Grad, ein Zuschlag am Maß), zeichnet der
   * Aufrufer weiter seinen eigenen Schlauch.
   */
  _bowMeshFor(va, vb, center) {
    const store = this._tubeMeshes;
    const rec = store && store["round-tube2"];
    if (!rec) return null;
    const C = new THREE.Vector3(center[0], center[1], center[2]);
    const u = va.clone().sub(C), w = vb.clone().sub(C);
    const R = (u.length() + w.length()) / 2;
    if (Math.abs(R - BOW_MESH_R) > 0.5) return null;
    u.normalize(); w.normalize();
    // Viertelkreis? Sonst passt das Modell nicht.
    if (Math.abs(u.dot(w)) > 0.02) return null;
    const N = u.clone().negate();                       // lokales +Y: zum Mittelpunkt
    const T = w.clone().addScaledVector(u, -u.dot(w));  // lokales +X: Tangente am Anfang
    if (T.lengthSq() < 1e-6) return null;
    T.normalize();
    const B = new THREE.Vector3().crossVectors(T, N);
    return {
      geo: this._meshGeometry("tube:round-tube2", rec),
      matrix: new THREE.Matrix4().makeBasis(T, N, B).setPosition(va),
    };
  }

  /**
   * Koerper einer Klemme, in ihrer eigenen Ebene: die beiden Loecher liegen auf
   * der X-Achse im Abstand `d`, die Rohre laufen entlang +Z.
   *
   * Der Doppelrohrverbinder ist eine geschlossene "8": ein einziger Koerper,
   * dessen Aussenkreise sich schneiden (daher die eingezogene Taille) und aus
   * dem zwei Loecher ausgespart sind -- nicht zwei Ringe uebereinander, denn
   * dann ragte die Wand des einen Rings in das Loch des anderen.
   *
   * Die Rohrklammer ist derselbe Koerper, aber beide Schalen sind nach AUSSEN
   * offen ("ↃC"): links zeigt die Luecke nach links, rechts nach rechts, dort
   * klicken die Rohre ein. In der Taille bleibt ein gemeinsamer Steg.
   */
  _clampBodyGeometry(open, d) {
    const seg = Math.max(12, this._q().tube);
    const key = `clampBody${open ? "o" : "c"}:${d.toFixed(1)}:${seg}`;
    return this._cachedGeo(key, () => {
      // Loch: so weit, dass das Rohr hindurchpasst -- aber nie so weit, dass
      // sich die beiden Loecher treffen (sonst bliebe kein Steg dazwischen).
      const ri = Math.min(geometry().tubeRadius + 0.45, d > 0 ? d / 2 - 0.02 : Infinity);
      const ro = ri + CLAMP_WALL;
      const shapes = [];
      const lobes = d > 0 ? [-d / 2, d / 2] : [0];
      if (open && d > 0 && ro > d / 2) {
        // "ↃC": beide Schalen sind nach AUSSEN offen, in der Taille teilen sie
        // sich einen Steg. Ein einziger Umriss laeuft deshalb aussen um beide
        // Schalen herum und durch die beiden Luecken jeweils in das Loch und
        // wieder heraus -- zwei getrennte Ringe waeren in der Mitte doppelt
        // gewandet.
        const g = CLIP_GAP, b = Math.acos((d / 2) / ro);
        const s = new THREE.Shape();
        s.absarc(-d / 2, 0, ro, Math.PI + g / 2, Math.PI * 2 - b, false);  // links aussen, unten herum
        s.absarc(d / 2, 0, ro, Math.PI + b, Math.PI * 2 - g / 2, false);   // rechts aussen bis zur Luecke
        s.absarc(d / 2, 0, ri, Math.PI * 2 - g / 2, g / 2, true);          // rechtes Loch
        s.absarc(d / 2, 0, ro, g / 2, Math.PI - b, false);                 // rechts aussen, oben herum
        s.absarc(-d / 2, 0, ro, b, Math.PI - g / 2, false);                // links aussen bis zur Luecke
        s.absarc(-d / 2, 0, ri, Math.PI - g / 2, Math.PI + g / 2, true);   // linkes Loch
        shapes.push(s);
      } else if (open) {
        // Ohne zweites Rohr bleibt es bei einer offenen Schale.
        const s = new THREE.Shape();
        s.absarc(0, 0, ro, CLIP_GAP / 2, Math.PI * 2 - CLIP_GAP / 2, false);
        s.absarc(0, 0, ri, Math.PI * 2 - CLIP_GAP / 2, CLIP_GAP / 2, true);
        shapes.push(s);
      } else {
        const s = new THREE.Shape();
        if (d > 0 && ro > d / 2) {
          // Aussenkreise schneiden sich: der Umriss laeuft ueber die beiden
          // langen Boegen, die Schnittpunkte sind die Taille.
          const a = Math.acos((d / 2) / ro);
          s.absarc(-d / 2, 0, ro, a, Math.PI * 2 - a, false);
          s.absarc(d / 2, 0, ro, Math.PI + a, Math.PI * 3 - a, false);
        } else {
          s.absarc(lobes[0], 0, ro, 0, Math.PI * 2, false);
        }
        for (const cx of lobes) {
          const hole = new THREE.Path();
          hole.absarc(cx, 0, ri, 0, Math.PI * 2, true);
          s.holes.push(hole);
        }
        shapes.push(s);
      }
      const g = new THREE.ExtrudeGeometry(shapes, {
        depth: CLAMP_LEN, bevelEnabled: false, curveSegments: seg,
      });
      g.translate(0, 0, -CLAMP_LEN / 2);            // um die Mitte, Achse auf +Z
      // Der Umriss steht um die Mitte zwischen beiden Loechern; der Punkt der
      // Klemme liegt aber im ERSTEN Loch (dort laeuft das gehaltene Rohr).
      g.translate(d / 2, 0, 0);
      return g;
    });
  }

  // Platten-Geometrie, gecacht pro Mass + Lochbild. Volle Platten sind eine
  // flache Box; Lochplatten (Katalog-Feld "holes") werden als Rechteck-Shape
  // mit ausgestanzten Kreisen extrudiert.
  // Wichtig: Der Cache muss in _disposeGroup ausgenommen werden, sonst gibt der
  // naechste Render-Durchlauf die noch benutzte Geometrie frei.
  // Zwischen zwei Platten bleibt ein schmaler Spalt, damit die Rohre darunter
  // sichtbar und anklickbar bleiben -- Kante an Kante verdeckt das Geruest.
  _panelGeometry(panelId, wSpan, dSpan, thickness) {
    const w = Math.max(1, wSpan - PANEL_GAP);
    const d = Math.max(1, dSpan - PANEL_GAP);
    const def = getPanel(panelId);
    const holes = (def && def.holes) || 0;
    const seg = this._q().notch;
    const key = `${holes}:${seg}:${w.toFixed(2)}x${d.toFixed(2)}x${thickness}`;
    const hit = this._panelGeos.get(key);
    if (hit) return hit;

    // Die Ecken sind ausgespart: dort sitzt die Kupplung. Der Wuerfel misst
    // connectorSize und steht mit seiner halben Kantenlaenge um den Knoten --
    // genau so gross ist die quadratische Aussparung. Bei sehr kleinen Platten
    // gedeckelt, damit nicht mehr Ecke fehlt als Platte bleibt.
    const notch = Math.min((geometry().connectorSize || 5) / 2, Math.min(w, d) / 4);
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    // Die Aussparung ist ein Viertelkreis um den Eckpunkt. Der Umriss laeuft
    // gegen den Uhrzeigersinn, die Boegen dagegen -- so schneiden sie in die
    // Platte hinein, statt sie abzurunden. Auf der Stufe "low" wird der Bogen
    // zum rechten Winkel; dort sind auch die Kupplungen kantig.
    const HALF = Math.PI / 2;
    const shape = new THREE.Shape();
    const corner = (cx, cy, from) => {
      if (seg > 0) { shape.absarc(cx, cy, notch, from, from - HALF, true); return; }
      const at = (a) => [cx + Math.cos(a) * notch, cy + Math.sin(a) * notch];
      const [sx, sy] = at(from), [ex, ey] = at(from - HALF);
      shape.lineTo(sx + (ex - cx), sy + (ey - cy));   // innere Ecke des Quadrats
      shape.lineTo(ex, ey);
    };
    shape.moveTo(x0 + notch, y0);
    shape.lineTo(x1 - notch, y0);
    corner(x1, y0, Math.PI);
    shape.lineTo(x1, y1 - notch);
    corner(x1, y1, -HALF);
    shape.lineTo(x0 + notch, y1);
    corner(x0, y1, 0);
    shape.lineTo(x0, y0 + notch);
    corner(x0, y0, HALF);
    shape.closePath();
    if (holes === 9) {
      const r = Math.min(w, d) * 0.105;   // Lochradius ~4 cm im 40er-Feld
      const off = Math.min(w, d) * 0.29;  // Mitte der aeusseren Lochreihen
      for (const gx of [-off, 0, off])
        for (const gy of [-off, 0, off])
          shape.holes.push(new THREE.Path().absarc(gx, gy, r, 0, Math.PI * 2, true));
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: false, curveSegments: Math.max(seg, 6),
    });
    // Shape liegt in XY und wird nach +Z extrudiert. Die Drehung um -90 Grad
    // um X bringt das in die Box-Orientierung (x = u, y = Dicke, z = w);
    // danach mittig um die Plattenebene zentrieren.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -thickness / 2, 0);
    geo.computeVertexNormals();
    this._panelGeos.set(key, geo);
    this._keepGeos.add(geo);
    return geo;
  }

  /**
   * Vorschlags-Variante eines beliebigen Bauteil-Materials: orange, sonst
   * unveraendert. Geklont statt ersetzt -- das feste Vorschlags-Material ist
   * einseitig, und eine Rutsche (U-Rinne, DoubleSide) verlor damit ihre
   * Innenflaechen und sah aus wie ein Balken.
   */
  _suggestMaterial(base) {
    const key = "sug:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.color = new THREE.Color(0xff8c1a);
      if (m.emissive) m.emissive = new THREE.Color(0x5a3000);
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  /**
   * Geometrie eines Anbauteils. Die Formen stammen aus den Bildschirmfotos der
   * Herstellersoftware; Lage und Ausrichtung aus den Entwurfsdateien. Die lokale
   * +X-Achse ist bei allen Teilen die Bezugsrichtung (Radachse, Rollenachse,
   * Flaechennormale) -- genau wie im QDF.
   */
  _fittingMeshes(f) {
    const q = f.quat && f.quat.length === 4
      ? new THREE.Quaternion(f.quat[0], f.quat[1], f.quat[2], f.quat[3]).normalize()
      : new THREE.Quaternion();
    // Radlager und Schwimmrad gibt es nur in Schwarz -- weder die Baufarbe noch
    // die Farbe aus der Datei faerbt sie um. In den Herstellerdateien tragen
    // beide durchgehend das schwarze Material (125 bzw. 76 Vorkommen).
    // Teile mit fester Farbe: Radlager, Schwimmrad und Rohrkappe sind schwarz,
    // die Poolfolie ist blau -- die Baufarbe gilt fuer sie nicht.
    const fest = fixedFittingColor(f.kind);
    const hex = fest === "black" ? connectorColor().hex
      : fest ? colorHex(fest)
      : f.color ? colorHex(f.color) : "#2B2B2B";
    let geo = null, mat = null;
    const cs = geometry().connectorSize;

    // Abgegriffenes Originalmodell, wenn es zu dieser Art eines gibt. Alle
    // Anbauteile sitzen auf ihrer Lage aus der Datei, also reicht _placeFitting.
    // Zwei Arten brauchen trotzdem noch etwas: der Spielsack haengt IMMER nach
    // unten (seine Datei-Lage wuerde ihn kippen), und im Baellebad steht Wasser,
    // das die Herstellersoftware nicht kennt.
    let echt = this._q().meshes && this._fitMeshes ? this._fitMeshes[f.kind] : null;
    // Das Baellebad gibt es als abgegriffenes Modell in genau EINER Groesse je
    // Art (pool2 120 x 160, pool-small2 80 x 120). Ein Becken mit anderer Tiefe
    // -- XS und XXL bauen wir selbst -- zeichnet der Pfad darunter aus Waenden
    // und Boden, sonst staende dort ein Becken der falschen Groesse.
    if (echt && POOL_KINDS.has(f.kind)) {
      const [mw, md] = f.kind === "pool2" ? [120, 160] : [80, 120];
      if (Math.abs((f.w || mw) - mw) > 1 || Math.abs(Math.abs(f.d || md) - md) > 1) echt = null;
    }
    if (echt) {
      const geoEcht = this._meshGeometry("fit:" + f.kind, echt);
      const matEcht = this._fittingMaterial(hex, false);
      const mesh = this._placeFitting(new THREE.Mesh(geoEcht, matEcht), f, q);
      // Der Spielsack: der Import ruecht seinen Punkt um BAG_OFFSET auf die
      // Mitte seines Feldes vor (qdfimport.js), das Modell erwartet aber den
      // Punkt, wie er in der Datei steht -- also wieder zurueck. Seine eigene
      // Lage darf er dabei behalten: die Herstellersoftware zeichnet ihn genau
      // so, unsere Aufrichtung war ein Behelf fuer die gezeichnete Form.
      if (f.kind === "bag2") {
        mesh.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), -BAG_OFFSET);
      }
      // Das KLEINE Baellebad hat seinen Nullpunkt nicht in der Mitte der
      // Frontwand: sein Modell reicht von -22,5 bis +62,5 cm in lokal X. Wir
      // fuehren die Mitte -- also um diese 20 cm zurueckschieben, sonst steht
      // das Becken neben seinem Rahmen (dieselbe Rechnung wie im Export).
      if (f.kind === "pool-small2") {
        mesh.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), -POOL_SMALL_OFFSET);
      }
      const teile = [mesh];
      const wasser = f.kind === "pool2" || f.kind === "pool-small2"
        ? this._markPoolWater(this._poolWater(f, q)) : null;
      if (wasser) teile.push(wasser);
      return teile;
    }

    switch (f.kind) {
      case "multi-wheel2": {            // Speichenrad: Scheibe mit Kranz
        geo = this._wheelGeometry(WHEEL_R, 2.4, true);
        mat = this._fittingMaterial(hex, false);
        break;
      }
      case "floating-wheel2": {         // Schwimmrad, knapp 15 cm dick
        geo = this._wheelGeometry(WHEEL_R, 14, false);
        mat = this._fittingMaterial(hex, false);   // immer schwarz, siehe BLACK_FITTINGS
        break;
      }
      case "hub-cap2": {                // Radkappe: haelt das Schwimmrad fest
        // Gleiche Aufgabe wie die Radarretierung, nur groesser und gewoelbt --
        // und weiter aussen, weil das Schwimmrad 14 cm dick ist. Sie steht wie
        // die Arretierung 1 cm ueber die Aussenflaeche des Rades hinaus.
        // Sie sitzt auf der einarmigen Kupplung am Rohrende und greift von dort
        // nach INNEN ueber die Aussenflaeche des Schwimmrads -- deshalb liegt
        // ihr Koerper vor dem Ankerpunkt, nicht dahinter.
        geo = this._cachedGeo("hubcap", () => {
          const g = new THREE.CylinderGeometry(5.5, 7, 5, Math.max(16, this._q().tube * 2));
          g.rotateZ(-Math.PI / 2);          // Achse auf +X, schmale Seite aussen
          g.translate(-2.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0xd42e2e, false);
        break;
      }
      case "casters2": {                // Laufrolle: Gabel mit Raedchen am Ende
        // Wie bei allen Anbauteilen ist die lokale +X-Achse die Bezugsrichtung:
        // dorthin zeigt die Gabel. In den Entwurfsdateien steht dort immer
        // (0,-1,0) -- die Rolle haengt also nach unten.
        const dark = this._fittingMaterial(0x1c1c1c, false);
        const fork = new THREE.Mesh(this._cachedGeo("casterFork", () => {
          const g = new THREE.BoxGeometry(5, 4.5, 3);
          g.translate(2.5, 0, 0);
          return g;
        }), dark);
        const roll = new THREE.Mesh(this._cachedGeo("casterRoll", () => {
          const g = new THREE.CylinderGeometry(3.2, 3.2, 2.2, Math.max(10, this._q().tube));
          g.translate(6.5, 0, 0);
          return g;
        }), dark);
        return [fork, roll].map((m) => this._placeFitting(m, f, q));
      }
      case "bearing2": {                // Radlager: schwarzes 5-cm-Rohrstueck
        // Es steckt auf einem Stutzen der Kupplung und traegt das Multirad an
        // seinem aeusseren Ende. Laenge 5 cm -- so steht es im Datensatz.
        // Es steckt auf dem STUTZEN der Kupplung und beginnt deshalb erst an
        // deren Wuerfelflaeche -- sonst laege es ueber dem Kern der Kupplung.
        const rb = geometry().tubeRadius;
        const start = geometry().connectorSize / 2;
        geo = this._cachedGeo("bearingstub", () => {
          const g = new THREE.CylinderGeometry(rb, rb, 5, Math.max(10, this._q().tube));
          g.rotateZ(Math.PI / 2);
          g.translate(start + 2.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x1c1c1c, false);
        break;
      }
      case "adapter2": {                // Topf, der ueber den Stutzen der Kupplung greift
        const r = geometry().tubeRadius * 1.3;
        geo = this._cachedGeo("fitcup", () => {
          const g = new THREE.CylinderGeometry(r, r, cs * 1.2, Math.max(10, this._q().tube));
          g.rotateZ(Math.PI / 2);                 // Achse auf lokales +X
          g.translate(cs * 0.4, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "steering-lock2": {          // Radarretierung: runde Scheibe in der Nabe
        // Sie liegt in derselben Ebene wie das Rad (Achse = lokales +X) und ist
        // immer rot -- unabhaengig von der Baufarbe.
        // Durchmesser 7 cm (Massblatt), also Radius 3,5 -- gut halb so gross
        // wie die Radkappe des Schwimmrads.
        geo = this._cachedGeo("wheellock", () => {
          const g = new THREE.CylinderGeometry(3.5, 3.5, 2.4, Math.max(16, this._q().tube * 2));
          g.rotateZ(Math.PI / 2);
          // Sie sitzt am Ende des Kupplungs-Stutzens, also eine Kupplungslaenge
          // von der Kupplung entfernt -- genau dort, wo das Multirad auf seinem
          // Radlager sitzt -- und steht 1 cm ueber dessen Aussenflaeche hinaus.
          g.translate(6, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0xd42e2e, false);
        break;
      }
      case "tube-cap2": {               // Rohrkappe: runde Kappe auf dem Rohr
        // Sie verschliesst das Rohrende, ist also nur so dick wie noetig und hat
        // den Durchmesser des Rohrs. Sie sitzt auf der Schnittflaeche des Rohrs,
        // eine halbe Kupplungslaenge vor dem Knoten.
        const rc = geometry().tubeRadius;
        geo = this._cachedGeo("endcap", () => {
          const g = new THREE.CylinderGeometry(rc, rc, 1, Math.max(12, this._q().tube));
          g.rotateZ(Math.PI / 2);
          g.translate(-cs / 2 + 0.5, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "open-connector2": {         // Offenes Verbinderende: Huelse ueber dem Stutzen
        // Sie ist so lang wie ein Kupplungs-Stutzen und beidseitig offen: von
        // aussen sieht es aus wie ein abgeschnittenes Rohr. Den Stutzen darunter
        // zeichnet die Kupplung selbst (ARM_FITTINGS).
        const ro = geometry().tubeRadius;
        geo = this._cachedGeo("openend", () => {
          const g = new THREE.CylinderGeometry(ro, ro, cs, Math.max(12, this._q().tube), 1, true);
          g.rotateZ(Math.PI / 2);
          g.translate(cs, 0, 0);
          return g;
        });
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "hole-connector4": {         // Kupplungsnahes Teil: Wuerfel in Teilegroesse
        const sz = cs * 0.9;
        geo = this._cachedGeo("fitbox" + sz.toFixed(2), () => new THREE.BoxGeometry(sz, sz, sz));
        mat = this._fittingMaterial(0x2b2b2b, false);
        break;
      }
      case "lattice2": {                // Netz: Rechteck in der lokalen XY-Ebene
        // Gemessen an den Ball-Cage-Entwuerfen: das erste Mass (f.w) liegt auf
        // der lokalen Y-, das zweite (f.h) auf der lokalen X-Achse, die Flaeche
        // steht senkrecht auf der lokalen Z-Achse -- dieselbe Regel wie bei den
        // Platten. Ein 1550 x 775 grosses Netz spannt damit genau zwischen den
        // beiden Rohrebenen, statt flach in der Gegend zu liegen.
        const w = f.w || 40, h = f.h || 40;
        geo = this._cachedGeo(`lattice${w}x${h}`, () => this._latticeGeometry(h, w));
        mat = this._fittingMaterial(hex, false);
        break;
      }
      case "textil-round2": {           // Rundabdeckung: Viertelzylinder ueber einem Bogen
        // Die beiden Enden des Tuchs liegen 400 mm vom Punkt entfernt, in
        // lokaler +Y- und -X-Richtung (52 von 52 Vorkommen). Der Kruemmungs-
        // mittelpunkt ist die GEGENUEBERLIEGENDE Ecke, nicht der Punkt selbst:
        // nur so steht die Tangente am Fuss senkrecht (das Bogenrohr setzt den
        // Pfosten fort) und am Scheitel waagerecht. Das Tuch woelbt sich also
        // zum Punkt hin. Entlang der lokalen +Z-Achse laeuft es 800 mm weit.
        geo = this._cachedGeo("roundwall", () => {
          const g = new THREE.CylinderGeometry(ROUND_WALL_R, ROUND_WALL_R, ROUND_COVER_LEN,
            Math.max(12, this._q().tube * 2), 1, true, 0, Math.PI / 2);
          g.rotateX(Math.PI / 2);            // Achse von +Y auf +Z drehen
          g.translate(-ROUND_WALL_R, ROUND_WALL_R, ROUND_COVER_LEN / 2);
          return g;
        });
        // Deckend wie die uebrigen Tuecher -- Textil ist blickdicht.
        mat = this._fittingMaterial(hex, false);
        break;
      }
      case "roof-large2": {             // Dachtextil: Giebel über dem First
        // Der Punkt liegt auf dem First, die lokale X-Achse läuft am First
        // entlang. Von dort fällt eine Fläche entlang +Z, die andere entlang
        // -Y ab (beide 45 Grad, deshalb stehen die Achsen senkrecht aufeinander).
        // Maße aus den neun Cover-Entwürfen: First von -40 bis +120 cm, Traufe
        // 60 cm tiefer und 60 cm seitlich -> Schräge 60*sqrt(2). Der First liegt
        // dort immer auf ZWEI waagerechten 75ern (lokal -40..40 und 40..120) --
        // deshalb ist das Teil nicht frei setzbar, es passt nur auf genau diese
        // Konstruktion.
        const slope = Math.SQRT2 * 60;
        // Dachstärke wie an einer Platte: das Dach ist ein Formteil, kein Tuch.
        // Beide Schrägen liegen mit ihrer Innenseite am First und überlappen
        // sich dort -- die Ecke bleibt dadurch geschlossen.
        const dick = ROOF_THICK;
        return [
          this._cachedGeo("roofSlopeA", () => {
            const g = new THREE.BoxGeometry(160, dick, slope);
            g.translate(40, -dick / 2, slope / 2);
            return g;
          }),
          this._cachedGeo("roofSlopeB", () => {
            const g = new THREE.BoxGeometry(160, slope, dick);
            g.translate(40, -slope / 2, -dick / 2);
            return g;
          }),
        ].map((g) => {
          const mesh = this._placeFitting(new THREE.Mesh(g, this._fittingMaterial(hex, false)), f, q);
          // Der Bezugspunkt liegt auf der Achse des First-Rohrs. Das Dach LIEGT
          // aber darauf: eine halbe Kupplung höher, sonst schneidet der First
          // durch das Rohr und das Dach hängt darunter.
          mesh.position.y += ROOF_LIFT;
          return mesh;
        });
      }
      case "pool2":
      case "pool-small2": {              // Baellebad: EIN Teil (Folie im Rahmen)
        // Bezugspunkt ist die OBERKANTE der Frontwand -- so steht es in der
        // Datei. Von dort geht es `h` nach unten (lokales -Y), `w` breit
        // (lokales X) und `d` tief (lokales Z, Vorzeichen inklusive).
        const pw = f.w || 120, ph = f.h || 40, pd = f.d || 120;
        const tief = Math.abs(pd);
        const dz = pd < 0 ? -1 : 1;
        const dick = POOL_SKIN;
        // Die Folie haengt INNEN im Rahmen: an den vier Seiten und oben eine
        // halbe Rohrbreite eingerueckt, sonst liefe sie mitten durch die Rohre.
        // Unten bleibt sie, wo sie ist -- dort liegt sie auf.
        const ein = POOL_INSET;
        const breite = pw - 2 * ein;
        const laenge = tief - 2 * ein;
        const hoehe = ph - ein;                       // Oberkante liegt tiefer
        const wand = (bx, by, bz, x, y, z) => this._cachedGeo(
          `pool${bx}x${by}x${bz}@${x},${y},${z}`,
          () => {
            const g = new THREE.BoxGeometry(bx, by, bz);
            g.translate(x, y, z);
            return g;
          });
        const mittelY = -ein - hoehe / 2;
        const mitte = dz * tief / 2;
        const teile = [
          wand(breite, hoehe, dick, 0, mittelY, dz * ein),               // Frontwand
          wand(breite, hoehe, dick, 0, mittelY, dz * (tief - ein)),      // Rueckwand
          wand(dick, hoehe, laenge, -breite / 2, mittelY, mitte),        // linke Wand
          wand(dick, hoehe, laenge, breite / 2, mittelY, mitte),         // rechte Wand
          wand(breite, dick, laenge, 0, -ph + dick / 2, mitte),          // Boden
        ].map((g) => this._placeFitting(
          new THREE.Mesh(g, this._fittingMaterial(hex, false)), f, q));
        // Wasser: 75 % Fuellhoehe, knapp innerhalb der Folie.
        const wasserH = hoehe * 0.75;
        const wasser = this._markPoolWater(this._placeFitting(new THREE.Mesh(
          wand(breite - 2 * dick, wasserH, laenge - 2 * dick,
            0, -ph + dick + wasserH / 2, mitte),
          this._waterMaterial()), f, q));
        return [...teile, wasser];
      }
      case "bag2": {                    // Spielsack: offener Kasten aus Tuch
        // Er haengt zwischen zwei Rohren: oben offen, an allen vier Seiten rund
        // 17 cm tief, mit Boden. Er haengt IMMER nach unten -- die Drehung um die
        // Hochachse kommt aus dem Teil, die Neigung nicht. Importierte Saecke
        // tragen eine beliebige Lage, die sie sonst schraeg stellen wuerde.
        const w = f.w || 35;
        const bagMesh = new THREE.Mesh(
          this._cachedGeo(`bag${w}`, () => this._bagGeometry(w, BAG_DEPTH)),
          this._fittingMaterial(hex, false));
        const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        ax.y = 0;
        if (ax.lengthSq() < 0.01) ax.set(1, 0, 0);
        ax.normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(up, ax).normalize();
        bagMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, side, up));
        bagMesh.position.set(f.x, f.y, f.z);
        bagMesh.castShadow = true;
        bagMesh.receiveShadow = true;
        return [bagMesh];
      }
      default:
        return [];
    }
    return [this._placeFitting(new THREE.Mesh(geo, mat), f, q)];
  }

  /** Anbauteil an seinen Platz drehen und setzen. */
  /**
   * Wasserquader im Baellebad, 75 % der Wandhoehe. Die Herstellersoftware
   * zeichnet nur die Folie; das Wasser ist unsere Zutat und bleibt auch am
   * abgegriffenen Becken. Masse wie bei der gezeichneten Folie -- Bezugspunkt
   * ist die Oberkante der Frontwand, von dort `h` nach unten.
   */
  _poolWater(f, q) {
    const pw = f.w || 0, ph = f.h || 0, pd = f.d || 0;
    if (!pw || !ph || !pd) return null;
    const tief = Math.abs(pd), dz = pd < 0 ? -1 : 1;
    const ein = POOL_INSET, dick = POOL_SKIN;
    const breite = pw - 2 * ein, laenge = tief - 2 * ein, hoehe = ph - ein;
    const h = hoehe * 0.75;
    const geo = this._cachedGeo(
      `poolwater${breite}x${h}x${laenge}@${ph},${dz}`,
      () => {
        const g = new THREE.BoxGeometry(breite - 2 * dick, h, laenge - 2 * dick);
        g.translate(0, -ph + dick + h / 2, dz * tief / 2);
        return g;
      });
    return this._placeFitting(new THREE.Mesh(geo, this._waterMaterial()), f, q);
  }

  /** Wasser ist nur Dekoration: nicht mitfaerben, sonst wirkt die Auswahl wie ein oranger Kasten. */
  _markPoolWater(mesh) {
    if (mesh) mesh.userData.role = "water";
    return mesh;
  }

  _placeFitting(mesh, f, q) {
    mesh.quaternion.copy(q);
    mesh.position.set(f.x, f.y, f.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Netz als echtes Geflecht: schmale Baender in der lokalen XY-Ebene, aussen ein
   * Rahmen, innen ein Raster von rund 2,5 cm. Alles in EINER Geometrie (eine
   * Zeichnung), weil mergeGeometries nicht mitgeliefert ist. sx laeuft auf der
   * lokalen X-, sy auf der lokalen Y-Achse.
   */
  _latticeGeometry(sx, sy, bar = 0.5, step = 2.5) {
    const pos = [];
    // Ein Band als zwei Dreiecke, Ecken gegen den Uhrzeigersinn.
    const ribbon = (x0, y0, x1, y1) => {
      pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
    };
    const hx = sx / 2, hy = sy / 2, b = bar / 2;
    const lines = (span, make) => {
      const n = Math.max(1, Math.round(span / step));
      for (let i = 0; i <= n; i++) make(-span / 2 + (span * i) / n);
    };
    lines(sx, (x) => ribbon(Math.max(-hx, Math.min(hx - bar, x - b)),
      -hy, Math.max(-hx + bar, Math.min(hx, x + b)), hy));
    lines(sy, (y) => ribbon(-hx, Math.max(-hy, Math.min(hy - bar, y - b)),
      hx, Math.max(-hy + bar, Math.min(hy, y + b))));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /**
   * Spielsack: oben offener Kasten -- vier Waende und ein Boden, alles in EINER
   * Geometrie. Die Oberkante liegt auf z = 0 (Ebene der beiden Rohre), der Boden
   * bei -depth.
   */
  _bagGeometry(size, depth) {
    const h = size / 2, pos = [];
    const quad = (a, b, c, d) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    };
    // Boden
    quad([-h, -h, -depth], [h, -h, -depth], [h, h, -depth], [-h, h, -depth]);
    // Waende: je zwei gegenueberliegende
    quad([-h, -h, -depth], [-h, h, -depth], [-h, h, 0], [-h, -h, 0]);
    quad([h, -h, -depth], [h, h, -depth], [h, h, 0], [h, -h, 0]);
    quad([-h, -h, -depth], [h, -h, -depth], [h, -h, 0], [-h, -h, 0]);
    quad([-h, h, -depth], [h, h, -depth], [h, h, 0], [-h, h, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Rad: Scheibe mit Kranz, wahlweise mit Speichenkerben. */
  _wheelGeometry(r, thickness, spokes) {
    return this._cachedGeo(`wheel${r}x${thickness}${spokes ? "s" : ""}`, () => {
      const seg = Math.max(12, this._q().tube);
      const g = new THREE.CylinderGeometry(r, r, thickness, seg);
      // Das Rad steht senkrecht auf seiner Achse: lokale +X ist die Achse.
      g.rotateZ(Math.PI / 2);
      return g;
    });
  }

  /** Geometrie einmal bauen und behalten (wie _tubeGeometry). */
  _cachedGeo(key, make) {
    if (!this._fitGeos) this._fitGeos = new Map();
    let g = this._fitGeos.get(key);
    if (!g) {
      g = make();
      this._fitGeos.set(key, g);
      this._keepGeos.add(g);
    }
    return g;
  }

  _fittingMaterial(hex, transparent) {
    const raw = this._asHex(hex);
    const key = `fit${raw}${transparent ? "t" : ""}`;
    if (!this._materials[key]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this._lookHex(raw)), roughness: 0.42, metalness: 0.04,
        side: THREE.DoubleSide,
        transparent, opacity: transparent ? 0.55 : 1,
      });
      m.userData.tuneHex = raw;
      this._materials[key] = m;
    } else {
      this._materials[key].color.set(this._lookHex(this._materials[key].userData.tuneHex || raw));
    }
    return this._materials[key];
  }

  // Hervorhebungs-Variante eines beliebigen Bauteil-Materials: durchgehend orange
  // (小麦坊主橙 P1). Geklont statt neu gebaut, damit Eigenschaften wie DoubleSide oder
  // Transparenz (Platten, Netze) erhalten bleiben. Pro Basis-Material einmal
  // gecacht -- _disposeGroup gibt nur Geometrien frei.
  _selectedMaterial(base) {
    return this._tintMaterial(base, "sel:", HIGHLIGHT_COLOR, HIGHLIGHT_EMISSIVE);
  }

  _hoverMaterial(base) {
    const two = !!(base && base.side === THREE.DoubleSide);
    const key = two ? "hov:2" : "hov:1";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshBasicMaterial({
        color: HIGHLIGHT_COLOR,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: two ? THREE.DoubleSide : THREE.FrontSide,
      });
    }
    return this._materials[key];
  }

  _focusMaterial(base) {
    return this._tintMaterial(base, "focus:", FOCUS_COLOR, FOCUS_EMISSIVE);
  }

  _partnerMaterial(base) {
    return this._tintMaterial(base, "partner:", PARTNER_COLOR, PARTNER_EMISSIVE);
  }

  _tintMaterial(base, prefix, color, emissive) {
    const key = prefix + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.color = new THREE.Color(color);
      if (m.emissive) m.emissive = new THREE.Color(emissive);
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  // Rot: die Lage geht nicht (Kollision beim Einfuegen). Gleiche Machart wie
  // die Auswahl-Farbe, nur eben als Absage.
  _invalidMaterial(base) {
    const key = "bad:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.color = new THREE.Color(INVALID_COLOR);
      if (m.emissive) m.emissive = new THREE.Color(INVALID_EMISSIVE);
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  // Zurueckgetretene Variante eines Bauteil-Materials: gleiche Farbe, stark
  // durchscheinend. depthWrite aus, damit die hervorgehobenen Teile dahinter
  // nicht weggeschnitten werden.
  _dimmedMaterial(base) {
    const key = "dim:" + base.uuid;
    if (!this._materials[key]) {
      const m = base.clone();
      m.transparent = true;
      m.opacity = (base.opacity != null ? base.opacity : 1) * 0.25;
      m.depthWrite = false;
      this._materials[key] = m;
    }
    return this._materials[key];
  }

  _clampMaterial() {
    if (!this._materials["clamp"]) {
      // Das echte Teil ist rot -- und zwar immer, unabhaengig von der Baufarbe.
      this._materials["clamp"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xd42e2e), roughness: 0.5, metalness: 0.1,
        side: THREE.DoubleSide,
      });
    }
    return this._materials["clamp"];
  }

  // Aussenradius der beiden Schenkel der 45-Grad-Winkelkupplung. Das Teil ist
  // ein KNIEROHR: es schiebt sich ueber das gerade Rohr, und das Diagonalrohr
  // steckt im zweiten Schenkel -- beide Schenkel also etwas weiter als ein Rohr.
  _c45SocketR() {
    return geometry().tubeRadius * 1.18;
  }

  // Der Knick des Kniestuecks: Kugel im Schenkelradius. Zusammen mit den beiden
  // Zylindern ergibt das den runden Bogen des echten Teils (statt eines Wuerfels,
  // der aus dem Rohr herausstand).
  _c45Geometry() {
    if (!this._c45Geo) {
      const seg = Math.max(10, this._q().tube);
      this._c45Geo = new THREE.SphereGeometry(this._c45SocketR(), seg, Math.max(6, seg / 2));
    }
    return this._c45Geo;
  }

  // Diagonal-Schenkel des Kniestuecks (nimmt das Diagonalrohr auf).
  _c45StubGeometry() {
    if (!this._c45StubGeo) {
      const r = this._c45SocketR();
      const cs = geometry().connectorSize;
      this._c45StubGeo = new THREE.CylinderGeometry(r, r, cs * 0.9, 14);
    }
    return this._c45StubGeo;
  }

  _c45Material() {
    if (!this._materials["c45"]) {
      // Schwarz wie die normalen Kupplungen (Gregor: die C45 sind auch schwarz).
      // BEIDE Seiten zeichnen: das abgegriffene Modell ist an Huelse und
      // Stutzen offen, also ein Flaechenzug ohne Wandstaerke. Nur von vorn
      // gezeichnet schaut man von innen durch die Kupplung hindurch -- dasselbe
      // gilt fuer die Rutschenbahnen.
      this._materials["c45"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(connectorColor().hex), roughness: 0.6, metalness: 0.1,
        emissive: new THREE.Color(0x000000),
        side: THREE.DoubleSide,
      });
    }
    return this._materials["c45"];
  }

  // Rutschen-Material je Art, SOLIDE (Gregor): gerade Rutsche rot, Bogenrutsche
  // gruen, Auslauf gelb, Dach grau. Im Aufbau-Modus hervorgehoben.
  // Beide Seiten, immer: die selbst gezeichnete Rinne ist eine blosse Flaeche --
  // und die abgegriffene auch. Die Rutschbahn der Herstellersoftware hat KEINE
  // Wandstaerke, sie ist ein einzelner Flaechenzug; von einer Seite betrachtet
  // faellt mit FrontSide die halbe Rutsche weg. (Der Umlaufsinn selbst ist in
  // den Modelldateien bereits gerichtet, siehe tmp/extracted/README.md.)
  _slideMatFor(kind, isCurrent, colorId) {
    const COL = {
      "slide2": 0xf23b3b, "slide-new2": 0xf23b3b,  // gerade Rutsche = rot
      "curved-slide2": 0x2fcb5a,                    // Bogenrutsche = gruen
      "slide-end2": 0xffd21a,                       // Auslauf = gelb
      "roof2": 0x2fcb5a,                            // Dach-Tuch = gruen, durchsichtig
    };
    // Das Dach ist deckend wie jedes andere Teil. Es war einmal durchscheinend
    // gedacht ("Tuch"), war damit aber das einzige halbdurchsichtige Stueck im
    // Bild -- und seit es aus dem abgegriffenen Modell kommt, ist es ohnehin ein
    // Formteil und kein Tuch.
    const transp = false;
    // Im Editor gesetzte Rutschen tragen die gewaehlte Baufarbe; importierte
    // ohne Farbangabe behalten die feste Farbe ihrer Art.
    const raw = colorId ? colorHex(colorId) : this._asHex(COL[kind] || 0x9aa3ad);
    const key = "slidem_" + kind + (colorId || "") + (isCurrent ? "_c" : "");
    if (!this._materials[key]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorId ? this._look(colorId) : this._lookHex(raw)),
        roughness: transp ? 0.9 : 0.42, metalness: 0.04,
        side: THREE.DoubleSide,
        transparent: transp, opacity: transp ? 0.5 : 1,
        emissive: new THREE.Color(isCurrent ? 0x3a2400 : 0x000000),
      });
      if (colorId) m.userData.tuneColorId = colorId;
      else m.userData.tuneHex = raw;
      this._materials[key] = m;
    } else {
      const m = this._materials[key];
      if (m.userData.tuneColorId) m.color.set(this._look(m.userData.tuneColorId));
      else if (m.userData.tuneHex) m.color.set(this._lookHex(m.userData.tuneHex));
    }
    return this._materials[key];
  }

  // Gerenderte Mitte eines Rutschen-Endstuecks (mit den Viewer-Offsets), damit
  // die Bogenrutsche dort optisch ankommt (nicht an der rohen QDF-Position).
  _slideEndRenderedCenter(se) {
    const g = new THREE.Group();
    g.position.set(se.x, se.y, se.z);
    if (se.quat && se.quat.length === 4) {
      const Rz90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      g.quaternion.set(se.quat[0], se.quat[1], se.quat[2], se.quat[3]).normalize().multiply(Rz90).normalize();
    }
    const size = 35, depth = 0.4;
    g.translateZ(-size * 0.75); g.translateX(depth * 2); g.translateY(size * 0.5); g.rotateY(Math.PI / 2);
    g.updateMatrixWorld(true);
    return new THREE.Vector3(0, -size / 2, depth / 2).applyMatrix4(g.matrixWorld);
  }

  // Anschlusspunkt Rutschenkoerper <-> Auslauf: etwas ueber der Endstueck-Mitte.
  // Der Rutschenkoerper (Bogen/gerade) ENDET hier, der Auslauf BEGINNT hier -> kein
  // Versatz, gleicher Punkt = sauberer Uebergang. Der Auslauf faellt von hier auf
  // Bodenhoehe ab und flacht aus.
  /**
   * Punkt der RUTSCHFLÄCHE eines Teils: sein Bezugspunkt plus die Höhe, in der
   * die Bahn dort liegt. So treffen sich zwei Kettenglieder ohne Stufe.
   */
  _slideSurfacePoint(sl) {
    if (sl.kind === "slide-end2") return this._slideEndConnectPoint(sl);
    const lift = (sl.kind === "slide2" || sl.kind === "curved-slide2") ? SLIDE_BODY_LIFT : 0;
    return new THREE.Vector3(sl.x, sl.y + lift, sl.z);
  }

  _slideEndConnectPoint(se) {
    // Anschlusspunkt = Lage aus der Datei plus die halbe Kupplungslänge: die
    // Rutschbahn des Auslaufs liegt so hoch über seinem Bezugspunkt. Die früher
    // hier stehenden 12 cm glichen aus, dass der Auslauf schräg gezeichnet
    // wurde und erst am Ende auf seine Höhe kam -- seit er flach liegt, hingen
    // Auslauf UND der Körper davor dadurch zu hoch.
    return new THREE.Vector3(se.x, se.y + SLIDE_END_LIFT, se.z);
  }

  // Legt einen Rutschenkoerper als EINE durchgehende U-Rinne (Boden + 2 hochgezogene
  // Seitenwangen, als zusammenhaengender Flaechenstreifen) entlang einer Bahn
  // bez(t)∈[0,1] an. Ersetzt die fruehere Kette einzelner Box-Segmente, deren Kanten
  // an den Uebergaengen sichtbare "Stufen"/Rippen erzeugten (Gregor: "die Übergänge
  // sind nicht schön", "die curved slide ist noch nicht schön"). Querschnitt je
  // Stuetzstelle: Wange-links-oben, Boden-links, Boden-rechts, Wange-rechts-oben.
  // Breitenachse W = T×up (faellt die Bahn, dreht sich die Rinne mit; ~senkrechte
  // Abschnitte behalten die vorige Achse -- kein Vorzeichen-Flip = kein Verdrehen).
  // startFrame={W,Nrm}: optional -- erzwingt den ERSTEN Querschnitt (z.B. exakt der
  // LETZTE Querschnitt des Vorgaengerteils), damit zwei Rutschenteile am gemeinsamen
  // Punkt OHNE Spalt/Knick im Querschnitt ineinander uebergehen ("Übergänge"-Fix).
  // Rueckgabe: {W,Nrm} des LETZTEN Querschnitts, fuer das naechste Teil der Kette.
  _addSlideAlongCurve(mat, st, id, bez, SEG, startFrame, wallOf = null) {
    const halfW = 35 / 2, WALL = 11, DICKE = 1.2;
    const N = SEG + 1, eps = 0.5 / SEG;
    // Je Stützstelle acht Punkte: der Querschnitt innen (Wange links oben,
    // Boden links, Boden rechts, Wange rechts oben) und derselbe Querschnitt
    // außen, um die Wandstärke versetzt. Daraus entsteht ein KÖRPER statt einer
    // Fläche: Innenseite, Außenseite, die beiden oberen Ränder und je ein
    // Deckel an Anfang und Ende.
    const verts = [];
    let prevW = startFrame ? startFrame.W.clone() : null;
    let lastW = prevW, lastNrm = startFrame ? startFrame.Nrm.clone() : null;
    for (let i = 0; i < N; i++) {
      const t = i / SEG;
      const c = bez(t);
      let W, Nrm;
      if (i === 0 && startFrame) {
        W = startFrame.W.clone(); Nrm = startFrame.Nrm.clone();
      } else {
        const t0 = Math.max(0, t - eps), t1 = Math.min(1, t + eps);
        const T = bez(t1).sub(bez(t0));
        if (T.lengthSq() < 1e-8) T.set(1, 0, 0); else T.normalize();
        W = new THREE.Vector3().crossVectors(T, UP);
        if (W.lengthSq() < 0.02) W = prevW ? prevW.clone() : new THREE.Vector3(1, 0, 0);
        W.normalize();
        if (prevW && W.dot(prevW) < 0) W.negate();
        Nrm = new THREE.Vector3().crossVectors(W, T).normalize();
      }
      prevW = W; lastW = W; lastNrm = Nrm;
      // Wangenhöhe darf entlang der Bahn auslaufen -- die Lippe des Auslaufs
      // ist nur noch Rutschfläche, ohne Ränder.
      const wallH = WALL * (wallOf ? wallOf(t) : 1);
      const fl = c.clone().addScaledVector(W, -halfW);
      const fr = c.clone().addScaledVector(W, halfW);
      const tl = fl.clone().addScaledVector(Nrm, wallH);
      const tr = fr.clone().addScaledVector(Nrm, wallH);
      // außen: Boden nach unten, Wangen zur Seite
      const flA = fl.clone().addScaledVector(Nrm, -DICKE).addScaledVector(W, -DICKE);
      const frA = fr.clone().addScaledVector(Nrm, -DICKE).addScaledVector(W, DICKE);
      const tlA = tl.clone().addScaledVector(W, -DICKE);
      const trA = tr.clone().addScaledVector(W, DICKE);
      verts.push(tl, fl, fr, tr, tlA, flA, frA, trA);
    }
    const positions = [];
    for (const v of verts) positions.push(v.x, v.y, v.z);
    const idx = [];
    const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };
    for (let i = 0; i < N - 1; i++) {
      const r0 = i * 8, r1 = r0 + 8;
      for (let k = 0; k < 3; k++) {
        quad(r0 + k, r1 + k, r1 + k + 1, r0 + k + 1);            // Innenseite
        quad(r0 + 4 + k + 1, r1 + 4 + k + 1, r1 + 4 + k, r0 + 4 + k); // Außenseite
      }
      quad(r0 + 4, r1 + 4, r1, r0);          // oberer Rand links
      quad(r0 + 3, r1 + 3, r1 + 7, r0 + 7);  // oberer Rand rechts
    }
    // Deckel: der Querschnitt ist ein Ring aus innen + außen.
    for (const [r, dreh] of [[0, false], [(N - 1) * 8, true]]) {
      for (let k = 0; k < 3; k++) {
        if (dreh) quad(r + k, r + k + 1, r + 4 + k + 1, r + 4 + k);
        else quad(r + 4 + k, r + 4 + k + 1, r + k + 1, r + k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { kind: "slide", id };
    this.buildGroup.add(mesh);
    if (st !== "future") this.pickSlides.push(mesh);
    return { W: lastW.clone(), Nrm: lastNrm.clone() };
  }


  // FESTE Austrittsrichtung einer Bogenrutsche (identisch zur Berechnung in
  // _addCurvedSlide): nach der 90°-Drehung in der PERPENDIKULAEREN kardinalen
  // Richtung zum waagerechten Einlauf, ~33° abwaerts. Damit der Auslauf knickfrei
  // an die Bogenrutsche anschliesst.
  _curvedSlideExit(sl) {
    return CURVED_SLIDE_EXIT.clone().applyQuaternion(this._slideQuat(sl));
  }

  /** Eigenes Quaternion eines Rutschenteils (Three-Reihenfolge), sonst Einheit. */
  _slideQuat(sl) {
    return sl.quat && sl.quat.length === 4
      ? new THREE.Quaternion(sl.quat[0], sl.quat[1], sl.quat[2], sl.quat[3]).normalize()
      : new THREE.Quaternion();
  }

  // Bogenrutsche: gekrümmte Rutschflaeche, die KARDINAL+waagerecht am Anschluss
  // Bogenrutsche: gekruemmte Rutschflaeche, die waagerecht in der lokalen
  // +X-Richtung beginnt und nach einer 90-Grad-Drehung in der lokalen
  // +Z-Richtung abwaerts wieder herauskommt. Kubische Bézier P0 -> C1 -> C2 -> P3,
  // alle vier Punkte aus dem eigenen Quaternion des Teils.
  _addCurvedSlide(sl, model, mat, st) {
    const P0 = this._slideSurfacePoint(sl);
    const q = this._slideQuat(sl);
    // Die Bogenrutsche ist ein FESTES Teil: gemessen an allen zehn Vorkommen im
    // Bestand liegt das Folgeteil IMMER auf demselben lokalen Versatz
    // (600, -800, 600) mm. Losgelaufen wird im lokalen +Z (Laufrichtung jeder
    // Rutsche), gedreht wird auf das lokale +X; der Bogen macht also 90 Grad in
    // der Draufsicht und faellt dabei 80 cm. Frueher kam die Form aus der Lage
    // des naechsten Rutschenteils; das ging schief, sobald ein anderes Teil
    // naeher lag.
    // Kette: das naechste Rutschenteil setzt am Bogen an.
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      if (s2.y > sl.y - 1) continue; // nur tiefer liegende Teile
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; target = s2; }
    }
    // Endpunkt: der Bogen hört dort auf, wo die Bahn des Folgeteils ANFÄNGT
    // (_slideSurfacePoint) -- sonst bliebe dort eine Stufe. Sitzt das Folgeteil
    // nicht da, wo es laut Versatz sitzen müsste, bleibt es beim festen
    // Endpunkt (die Form kippt dann nicht weg). Gerechnet wird ab dem
    // Bezugspunkt, P0 liegt ja schon auf der Rohroberkante.
    let P3 = CURVED_SLIDE_DROP.clone().applyQuaternion(q)
      .add(new THREE.Vector3(sl.x, sl.y + SLIDE_END_LIFT, sl.z));
    if (target) {
      const entry = this._slideSurfacePoint(target);
      if (entry.distanceTo(P3) < 40) P3 = entry;
    }
    const C1 = P0.clone().addScaledVector(CURVED_SLIDE_ENTRY.clone().applyQuaternion(q), 33);
    const exitDir = this._curvedSlideExit(sl);
    const C2 = P3.clone().addScaledVector(exitDir, -33);
    // ECHTE kubische Bézier (P0,C1,C2,P3) -- vorher war C2 unbenutzt (quadratisch),
    // dadurch hatte der Bogen keine eigene Austrittsrichtung am Ende (Knick/unschoen).
    const bez = (t) => {
      const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return new THREE.Vector3(
        a * P0.x + b * C1.x + c * C2.x + d * P3.x,
        a * P0.y + b * C1.y + c * C2.y + d * P3.y,
        a * P0.z + b * C1.z + c * C2.z + d * P3.z);
    };
    // Bananenfoermiger, durchgehend gebogener Rinnenkoerper entlang der Bézier.
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 24, hint);
    this._slideChainNextId = target ? target.id : null;
  }

  // Nicht-achsparallele Richtungen der Rohre an einem Knoten.
  // Achsparallel = eine Komponente >= 0.90, alle anderen klein.
  // Alles darunter (echte Diagonalen: 45°, oder leicht davon abweichend durch
  // Snap auf reale Kupplungspositionen) wird als Adapter-Richtung zurueckgegeben.
  _diagonalDirsAt(model, node) {
    const out = [];
    // Gemessen wird im Achsenkreuz DER KUPPLUNG, nicht in dem der Welt: an
    // einer gedrehten Kupplung laeuft ein Rohr entlang eines ihrer eigenen
    // Arme, auch wenn es in der Welt schraeg steht -- eine Winkelkupplung
    // braucht es dort nicht. Ohne diese Drehung zeichnete die Szene neben eine
    // gesetzte Winkelkupplung eine zweite, sobald an ihrer Dummy-Kupplung ein
    // Rohr hing.
    const gegen = this._nodeCubeQuat(model, node).clone().invert();
    const lokal = new THREE.Vector3();
    for (const t of model.tubes.values()) {
      // Nur echte Rohre. Die Arm-Kante zum Adapter-Koerper laeuft selbst schief
      // (Huelse + 45-Grad-Arm) -- als Diagonale gedeutet zeichnete sie eine
      // zweite Winkelkupplung ueber die vorhandene. Sichtbar wurde das, sobald
      // die Huelse diagonal liegt (Winkelkupplung im Rohr): dann faellt die
      // Kante unter die 0,90-Schwelle.
      if (t.arm || t.link) continue;
      let other = null;
      if (t.a === node.id) other = model.nodes.get(t.b);
      else if (t.b === node.id) other = model.nodes.get(t.a);
      if (!other) continue;
      const dx = other.x - node.x, dy = other.y - node.y, dz = other.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      const d = [dx / L, dy / L, dz / L];
      // Rohre entlang einer Wuerfelachse (groesste lokale Komponente >= 0.90)
      // brauchen keinen Adapter.
      lokal.set(d[0], d[1], d[2]).applyQuaternion(gegen);
      const mx = Math.max(Math.abs(lokal.x), Math.abs(lokal.y), Math.abs(lokal.z));
      if (mx < 0.90) out.push(d);
    }
    return out;
  }

  // Bestimmt die Achse, in die der c45-Adapter gesteckt wird:
  // die axiale Tube-Richtung an diesem Knoten mit dem groessten positiven
  // Skalarprodukt zur Diagonalrichtung.
  // Physikalisch: der Adapter sitzt auf dem Arm, der der Diagonale am
  // naechsten liegt (z.B. Arm nach oben fuer eine Diagonale oben-rechts).
  _c45ArmDirAt(model, node, diagDir) {
    let bestDot = -Infinity, bestAxis = null;
    for (const t of model.tubes.values()) {
      let other = null;
      if (t.a === node.id) other = model.nodes.get(t.b);
      else if (t.b === node.id) other = model.nodes.get(t.a);
      if (!other) continue;
      const dx = other.x - node.x, dy = other.y - node.y, dz = other.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      // Nur achsparallele Rohre: groesste Komponente >= 0.90
      if (Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.90) continue;
      const dot = nx * diagDir[0] + ny * diagDir[1] + nz * diagDir[2];
      if (dot > bestDot) {
        bestDot = dot;
        if (Math.abs(nx) >= 0.90) bestAxis = new THREE.Vector3(Math.sign(nx), 0, 0);
        else if (Math.abs(ny) >= 0.90) bestAxis = new THREE.Vector3(0, Math.sign(ny), 0);
        else bestAxis = new THREE.Vector3(0, 0, Math.sign(nz));
      }
    }
    // Fallback falls kein axiales Rohr vorhanden: dominante Komponente der Diagonale
    if (!bestAxis || bestDot <= 0) {
      const ax = Math.abs(diagDir[0]), ay = Math.abs(diagDir[1]), az = Math.abs(diagDir[2]);
      if (ax >= ay && ax >= az) bestAxis = new THREE.Vector3(Math.sign(diagDir[0]), 0, 0);
      else if (ay >= ax && ay >= az) bestAxis = new THREE.Vector3(0, Math.sign(diagDir[1]), 0);
      else bestAxis = new THREE.Vector3(0, 0, Math.sign(diagDir[2]));
    }
    return bestAxis;
  }

  // Geometrie des importierten C45-Adapters. n ist der Adapter-Koerper am
  // Diagonal-Fuss. Liefert die Huelse (von der Basiskupplung G KARDINAL weg),
  // die Koerperposition (Knick) und den 45°-Arm (in die Tube). Die kardinale
  // Huelsenachse kommt aus n.c45axis (QDF); sonst wird sie aus der Geometrie
  // hergeleitet (jene aktive Diagonal-Achse, die einen positiven Armarm ergibt).
  _c45AdapterGeo(model, n) {
    let G = null, foot = null;
    for (const t of model.tubes.values()) {
      const other = t.a === n.id ? model.nodes.get(t.b) : t.b === n.id ? model.nodes.get(t.a) : null;
      if (!other) continue;
      if (t.arm) G = other; else if (!foot) foot = other;
    }
    if (!G) return null;
    const v = new THREE.Vector3(n.x - G.x, n.y - G.y, n.z - G.z); // Basis -> Fuss
    let d, a;
    if (foot) {
      d = new THREE.Vector3(foot.x - n.x, foot.y - n.y, foot.z - n.z).normalize();
      // 45°-Arm-Laenge a so waehlen, dass (Fuss - d*a) - G kardinal liegt (Huelse).
      const active = [];
      for (let k = 0; k < 3; k++) if (Math.abs(d.getComponent(k)) > 0.3) active.push(k);
      a = 0;
      const ci = n.c45axis ? (Math.abs(n.c45axis[0]) > 0.5 ? 0 : Math.abs(n.c45axis[1]) > 0.5 ? 1 : 2) : -1;
      if (ci >= 0) {
        const m = active.find((k) => k !== ci);
        if (m != null) a = v.getComponent(m) / d.getComponent(m);
      }
      if (!(a > 0.01)) {
        for (const m of active) { const aa = v.getComponent(m) / d.getComponent(m); if (aa > 0.01) { a = aa; break; } }
      }
    } else {
      // Noch kein Rohr daran: die Lage steckt in der Huelsenachse. Der Fuss
      // liegt um die Huelse UND den 45-Grad-Arm neben der Kupplung -- daraus
      // ergeben sich Armrichtung (genau zwischen Achse und Querteil) und Laenge.
      if (!n.c45axis) return null;
      const u = new THREE.Vector3(n.c45axis[0], n.c45axis[1], n.c45axis[2]).normalize();
      const quer = v.clone().addScaledVector(u, -v.dot(u));
      const L = quer.length();
      if (L < 0.01) return null;
      // Der 45-Grad-Arm knickt ZURUECK ueber die Kupplung: seine Achskomponente
      // zeigt der Huelse entgegen (Knierohr). Daher quer MINUS Huelsenachse.
      d = quer.multiplyScalar(1 / L).sub(u).normalize();
      a = L * Math.SQRT2;
    }
    if (!(a > 0.01)) return null;
    const bodyPos = new THREE.Vector3(n.x - d.x * a, n.y - d.y * a, n.z - d.z * a);
    const sleeveVec = new THREE.Vector3().subVectors(bodyPos, G);
    const fullLen = sleeveVec.length();
    if (fullLen < 0.5) return null;
    const sleeveDir = sleeveVec.clone().normalize();
    const cs = geometry().connectorSize;
    const Gv = new THREE.Vector3(G.x, G.y, G.z);
    // Der ARM der Basiskupplung ragt vom Wuerfel nach aussen und STECKT in die
    // C45-Huelse (Gregor: "Der Arm der Kupplung ragt in die Huelse der C45 rein").
    // Die Huelse beginnt daher ~40% entlang des Arms (nicht am Wuerfel), der Arm
    // ueberlappt ihre Innenseite.
    const baseArmLen = Math.max(1.5, Math.min(cs, fullLen - cs / 2 - 1.5));
    // Die Huelse sitzt KOMPLETT ueber dem Arm und beginnt direkt an der Kupplung
    // (Wuerfelflaeche cs/2) (Gregor: "naeher heran, passt komplett auf den Arm").
    const sleeveOff = Math.max(0, cs / 2 - 0.5);
    const sleeveStart = Gv.clone().addScaledVector(sleeveDir, sleeveOff);
    const sleeveLen = bodyPos.distanceTo(sleeveStart);
    if (sleeveLen < 0.5) return null;
    return {
      bodyPos,
      sleeveDir,
      sleeveLen,
      sleeveMid: sleeveStart.clone().add(bodyPos).multiplyScalar(0.5),
      baseArmLen,
      baseArmMid: Gv.clone().addScaledVector(sleeveDir, cs / 2 + baseArmLen / 2),
      armDir: d,
      armLen: a,
      armMid: new THREE.Vector3((bodyPos.x + n.x) / 2, (bodyPos.y + n.y) / 2, (bodyPos.z + n.z) / 2),
    };
  }

  // Drehachse eines Schräg-Konnektors: hat der Knoten ein Diagonalrohr, liegt es
  // in einer Achsenebene; die Kupplung ist um 45° um die dazu senkrechte Achse
  // gedreht. Liefert diese Achse (THREE.Vector3) oder null (keine Schräge).
  _slopeRotationAxis(model, n) {
    if (n.c45body) return null;
    // Traegt der Knoten eine Winkelkupplung, ist die Schraege in aller Regel
    // IHRE Sache: der Wuerfel bleibt dann kardinal, das Diagonalrohr laeuft
    // ueber den Adapter. Nur wenn jedes Rohr am Knoten erst durch die Drehung
    // auf eine Wuerfelachse faellt, ist die Kupplung wirklich gedreht -- so
    // eine Dummy-Kupplung an einem schraegen Rohr, an der zusaetzlich eine
    // Winkelkupplung steckt. Ohne die Unterscheidung stand sie unverdreht da,
    // mit Stutzen quer zum eigenen Rohr.
    if (n.c45 && !this._slopeFitsAllTubes(model, n)) return null;
    for (const t of model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === n.id ? model.nodes.get(t.b) : t.b === n.id ? model.nodes.get(t.a) : null;
      if (!o) continue;
      // Bogenrohr: die Tangente am Knoten zaehlt, nicht die Sehne. Die Sehne
      // eines Viertelkreises steht 45 Grad schief -- die Kupplung am freien
      // Bogenende wuerde sonst um 45 Grad verdreht gezeichnet.
      const v = t.bow && t.bowCenter
        ? [o.x - t.bowCenter[0], o.y - t.bowCenter[1], o.z - t.bowCenter[2]]
        : [o.x - n.x, o.y - n.y, o.z - n.z];
      const L = Math.hypot(...v) || 1, u = v.map((c) => c / L);
      if (Math.max(...u.map(Math.abs)) >= 0.99) continue; // kardinal
      const act = [0, 1, 2].filter((a) => Math.abs(u[a]) > 0.3);
      if (act.length !== 2) continue;
      const k = [0, 1, 2].find((a) => !act.includes(a));
      return new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
    }
    return null;
  }

  /**
   * Faellt JEDES Rohr am Knoten nach der 45-Grad-Drehung auf eine Wuerfelachse?
   * Dann steht die Kupplung wirklich schraeg. Bleibt auch nur eines quer, ist
   * sie kardinal und die Schraege gehoert einer Winkelkupplung.
   */
  _slopeFitsAllTubes(model, n) {
    const rohre = [];
    for (const t of model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === n.id ? model.nodes.get(t.b) : t.b === n.id ? model.nodes.get(t.a) : null;
      if (!o) continue;
      const v = t.bow && t.bowCenter
        ? [o.x - t.bowCenter[0], o.y - t.bowCenter[1], o.z - t.bowCenter[2]]
        : [o.x - n.x, o.y - n.y, o.z - n.z];
      const L = Math.hypot(v[0], v[1], v[2]) || 1;
      rohre.push([v[0] / L, v[1] / L, v[2] / L]);
    }
    if (!rohre.length) return false;
    // Achse aus dem ersten schraegen Rohr -- dieselbe Regel wie unten.
    let achse = null;
    for (const u of rohre) {
      if (Math.max(Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])) >= 0.99) continue;
      const act = [0, 1, 2].filter((a) => Math.abs(u[a]) > 0.3);
      if (act.length !== 2) continue;
      const k = [0, 1, 2].find((a) => !act.includes(a));
      achse = new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      break;
    }
    if (!achse) return false;
    const gegen = new THREE.Quaternion().setFromAxisAngle(achse, Math.PI / 4).invert();
    const v = new THREE.Vector3();
    return rohre.every((u) => {
      v.set(u[0], u[1], u[2]).applyQuaternion(gegen);
      return Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) >= 0.99;
    });
  }

  _tubeMaterial(colorId) {
    const key = "tube:" + colorId;
    if (!this._materials[key]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this._look(colorId)),
        roughness: 0.5,
        metalness: 0,
      });
      m.userData.tuneColorId = colorId;
      this._materials[key] = m;
    } else {
      this._materials[key].color.set(this._look(colorId));
    }
    return this._materials[key];
  }

  // Platten (solide) und Textilien/Netze (halbtransparent) – je Katalogfarbe und
  // Aufbau-Status gecacht. Frueher wurde pro renderModel() ein neues Material je
  // Platte/Textil alloziert und nie freigegeben (-> GPU-Speicher-Leck), da
  // _disposeGroup nur Geometrien disposed. transparent steckt im Key, damit eine
  // Platte und ein Textil gleicher Farbe nicht kollidieren. "current" im
  // Aufbau-Modus orange hervorgehoben (emissive).
  _panelMaterial(colorId, isCurrent, transparent) {
    const key = "panel:" + colorId + (isCurrent ? ":c" : "") + (transparent ? ":t" : "");
    if (!this._materials[key]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this._look(colorId)),
        roughness: transparent ? 0.95 : 0.48, metalness: transparent ? 0.0 : 0.04,
        side: THREE.DoubleSide,
        transparent: !!transparent, opacity: transparent ? 0.5 : 1,
        emissive: new THREE.Color(isCurrent ? 0x3a2400 : 0x000000),
      });
      m.userData.tuneColorId = colorId;
      this._materials[key] = m;
    } else {
      this._materials[key].color.set(this._look(colorId));
    }
    return this._materials[key];
  }

  // Bällebad-Wasser: semitransparentes Blau (wird über pool_floor-Panel gerendert).
  _waterMaterial() {
    if (!this._materials["water"]) {
      this._materials["water"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2879d0),
        roughness: 0.05, metalness: 0.1,
        transparent: true, opacity: 0.58,
        side: THREE.FrontSide,
      });
    }
    return this._materials["water"];
  }

  // Verstaerkungsprofil-Stab (Bauen-Modus): dunkles Alu-Metallic.
  _rodMaterial() {
    if (!this._materials["rod"]) {
      this._materials["rod"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x7a8794), roughness: 0.3, metalness: 0.85,
      });
    }
    return this._materials["rod"];
  }

  // Material fuer vorgeschlagene Verstaerkungsrohre (Hinweis-Modus): orange.
  _tubeSuggest() {
    if (!this._materials["tubeSuggest"]) {
      this._materials["tubeSuggest"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xff8c1a), roughness: 0.4, metalness: 0.1,
        emissive: new THREE.Color(0x5a3000),
      });
    }
    return this._materials["tubeSuggest"];
  }

  // Reinforce-Modus: neutrale graue Rohre.
  _tubeGray() {
    if (!this._materials["tubeGray"]) {
      this._materials["tubeGray"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xa0aab5), roughness: 0.7, metalness: 0.05,
      });
    }
    return this._materials["tubeGray"];
  }

  // Reinforce-Modus: Rohre, die bereits verstärkt sind (blau-metallic).
  _tubeReinforceActive() {
    if (!this._materials["tubeReinforceActive"]) {
      this._materials["tubeReinforceActive"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x1a8cff), roughness: 0.2, metalness: 0.8,
        emissive: new THREE.Color(0x00213a),
      });
    }
    return this._materials["tubeReinforceActive"];
  }

  _connMaterial(selected) {
    const key = selected ? "conn:sel" : "conn:base";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(selected ? 0xea580c : connectorColor().hex),
        roughness: 0.6, metalness: 0.1,
        emissive: new THREE.Color(selected ? 0x612f00 : 0x000000),
      });
    }
    return this._materials[key];
  }

  // Halbtransparentes "Geist"-Material fuer noch nicht gebaute Teile (Aufbaumodus).
  // Bereits gebaute Teile im Aufbaumodus: blass und leicht durchscheinend, damit
  // die Teile des AKTUELLEN Schritts klar hervortreten.
  /**
   * EIN Grau fuer alles Erledigte -- die Bauteilfarbe (`hex`) spielt hier
   * bewusst keine Rolle mehr.
   *
   * EIN Ton fuer alles Erledigte: so tritt es geschlossen zurueck, und der
   * aktuelle Schritt ist das Einzige mit Farbe.
   */
  _fadedMaterial(twoSided = false) {
    const key = "faded" + (twoSided ? "_2" : "") + (this._dark ? "_d" : "") + ":ghost";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this._dark ? 0xa79e91 : 0xcfc7ba),
        roughness: 0.85, metalness: 0.02,
        side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
        transparent: true, opacity: 0.28,
        depthWrite: true,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
    }
    return this._materials[key];
  }

  _ghostMaterial() {
    if (!this._materials["ghost"]) {
      this._materials["ghost"] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x9aa6b4), roughness: 0.9, metalness: 0,
        transparent: true, opacity: 0.14, depthWrite: false,
      });
    }
    return this._materials["ghost"];
  }

  /**
   * Klemm-Kupplung zeichnen: eine Huelse, die das Rohr umschliesst, und der
   * offene Anschluss quer dazu. Der Knoten selbst liegt an der Muendung, eine
   * Kupplungslaenge neben der Rohrachse -- dort beginnt das eingesteckte Rohr.
   */
  _addTubeClamp(model, n, mat, st) {
    const g = geometry();
    const cs = g.connectorSize;
    const stub = n.stub || [0, 1, 0];
    const off = nodeClampOffset(n, cs);
    const axis = new THREE.Vector3(n.x - stub[0] * off, n.y - stub[1] * off, n.z - stub[2] * off);
    const tube = n.clampOn ? model.tubes.get(n.clampOn.tubeId) : null;
    // Ohne bekanntes Rohr (importierte Kupplungen sitzen manchmal frei) liegt
    // die Huelse quer zum Anschluss.
    let dir = new THREE.Vector3(Math.abs(stub[1]) > 0.5 ? 1 : 0, Math.abs(stub[1]) > 0.5 ? 0 : 1, 0);
    if (tube) {
      const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
      if (a && b) dir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    }
    const seg = Math.max(10, this._q().tube);
    const sleeveR = g.tubeRadius * 1.3;
    const sleeve = new THREE.Mesh(
      this._cachedGeo(`clampSleeve${seg}`, () => new THREE.CylinderGeometry(sleeveR, sleeveR, cs + 2, seg)), mat);
    sleeve.quaternion.setFromUnitVectors(UP, dir);
    sleeve.position.copy(axis);
    sleeve.userData = { kind: "node", id: n.id };
    this.buildGroup.add(sleeve);
    if (st !== "future") this.pickNodes.push(sleeve);
    // Der Hals ist bei beiden Klemm-Kupplungen gleich lang: eine Kupplungslaenge
    // ab der Rohrachse. Bei der Lagerkupplung schliesst dahinter der Wuerfel der
    // getragenen Kupplung an, die eine weitere Laenge weiter aussen sitzt.
    const sockR = g.tubeRadius * 1.18;
    const neck = cs * 1.4;
    const socket = new THREE.Mesh(
      this._cachedGeo(`clampSocket${seg}:${neck.toFixed(1)}`, () => new THREE.CylinderGeometry(sockR, sockR, neck, seg)), mat);
    const sv = new THREE.Vector3(stub[0], stub[1], stub[2]);
    socket.quaternion.setFromUnitVectors(UP, sv);
    socket.position.copy(axis).addScaledVector(sv, neck / 2);
    socket.userData = { kind: "node", id: n.id };
    this.buildGroup.add(socket);
    if (st !== "future") this.pickNodes.push(socket);
  }

  /**
   * Flexikupplung zeichnen: der Bolzen liegt mit seiner Achse (lokal +X) im
   * Rohrende, sein mittleres Segment traegt bis zu zwei Scharniere. Jedes
   * Scharnier sitzt mit dem Kranz auf derselben Achse; sein eigener Stutzen
   * zeigt nach lokal -Y, also in die Armrichtung.
   *
   * Jedes Scharnier bekommt seinen Index an den Treffer (`hinge`) -- nur so
   * weiss der Klick, welches der beiden gedreht werden soll.
   */
  _addFlexiJoint(model, n, grund, st, matFor = (id, m) => m) {
    // Bolzen und Scharniere lassen sich EINZELN waehlen und hervorheben --
    // jedes Scharnier hat dafuer eine eigene Kennung (`hingeKey`).
    const mat = matFor(n.id, grund);
    const pos = new THREE.Vector3(n.x, n.y, n.z);
    const pick = st !== "future" ? this.pickNodes : null;
    const achse = boltAxis(n);
    const ex = new THREE.Vector3(achse[0], achse[1], achse[2]).normalize();
    const bolzen = this._q().meshes && this._fitMeshes ? this._fitMeshes["bolt2"] : null;
    const scharnier = this._q().meshes && this._fitMeshes ? this._fitMeshes["flexi-connector3"] : null;
    const q = n.partQuat && n.partQuat.length === 4
      ? new THREE.Quaternion(n.partQuat[0], n.partQuat[1], n.partQuat[2], n.partQuat[3]).normalize()
      : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), ex);
    const g = geometry();
    // Der Bolzen steckt ein Segment tief oder zwei. Zwei Segmente tief rutscht
    // seine Mitte um eines weiter ins Rohr -- dann traegt das aeussere Segment
    // die Scharniere und es schaut kein leeres mehr heraus.
    const mitte = pos.clone().addScaledVector(ex, boltShift(n));
    if (bolzen) {
      this._batchAdd(this._meshGeometry("fit:bolt2", bolzen), mat,
        new THREE.Matrix4().compose(mitte, q, ONE), "node", n.id, pick);
    } else {
      // Rueckfall ohne Modelldatei: ein Stab von drei Segmenten Laenge.
      const seg = Math.max(8, this._q().tube);
      const stab = new THREE.Mesh(this._cachedGeo(`bolt${seg}`,
        () => new THREE.CylinderGeometry(g.armRadius, g.armRadius, g.connectorSize * 3, seg)), mat);
      stab.quaternion.setFromUnitVectors(UP, ex);
      stab.position.copy(mitte);
      stab.userData = { kind: "node", id: n.id };
      this.buildGroup.add(stab);
      if (pick) pick.push(stab);
    }
    const winkel = n.hinges || [];
    for (let i = 0; i < winkel.length; i++) {
      const d = hingeDir(n, winkel[i]);
      const arm = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      if (scharnier) {
        // Lokales +X = Bolzenachse, lokales -Y = Arm. Daraus die Basis; die
        // dritte Achse ergibt sich aus den beiden.
        //
        // Das ZWEITE Scharnier steht um seine eigene Armachse gewendet auf dem
        // Bolzen (also 180 Grad, von vorn auf den Stutzen gesehen): seine
        // beiden Riemen greifen sonst in dieselben Zaehne wie die des ersten
        // und liegen uebereinander. Die Datei fuehrt diese Wendung NICHT -- in
        // allen 83 Gelenken des Bestands tragen beide Scharniere dieselbe
        // X-Richtung --, sie gehoert deshalb nur ins Bild, nicht in den Export.
        const achse = i % 2 ? ex.clone().negate() : ex;
        const ey = arm.clone().negate();
        const ez = new THREE.Vector3().crossVectors(achse, ey);
        this._batchAdd(this._meshGeometry("fit:flexi-connector3", scharnier),
          // WICHTIG: vom Grundmaterial ausgehen, nicht vom Material des
          // Bolzens -- sonst erbt das Scharnier dessen Hervorhebung (mit dem
          // Bolzen leuchteten die Scharniere mit) oder dessen Abblendung (dann
          // war die Hervorhebung durchscheinend).
          matFor(hingeKey(n.id, i), grund),
          new THREE.Matrix4().makeBasis(achse, ey, ez).setPosition(pos),
          "node", n.id, pick, { hinge: i });
      } else {
        const seg = Math.max(8, this._q().tube);
        const len = g.connectorSize * 1.5;
        const stab = new THREE.Mesh(this._cachedGeo(`hingeArm${seg}`,
          () => new THREE.CylinderGeometry(g.armRadius, g.armRadius, len, seg)),
          matFor(hingeKey(n.id, i), grund));
        stab.quaternion.setFromUnitVectors(UP, arm);
        stab.position.copy(pos).addScaledVector(arm, len / 2);
        stab.userData = { kind: "node", id: n.id, hinge: i };
        this.buildGroup.add(stab);
        if (pick) pick.push(stab);
      }
    }
  }

  /**
   * Lochzapfenkupplung zeichnen. Sie klemmt NICHT um ein Rohr, sie sieht aus
   * wie "O--": ein Ring greift ueber den Stutzen einer Kupplung, quer dazu
   * steht ihr eigener Stutzen, in dem das Rohr steckt. Der Knoten liegt an
   * dessen Fuss -- eine Kupplungslaenge neben dem Wuerfel der Kupplung.
   */
  _addPinConnector(model, n, mat, st) {
    const g = geometry();
    const cs = g.connectorSize;
    const stub = new THREE.Vector3(...(n.stub || [0, 1, 0])).normalize();
    // Abgegriffenes Originalteil: eines je Arm-Maske. Es sitzt auf dem Punkt
    // des Knotens, seine Lage ist die des Teils (lokales -X zeigt zur tragenden
    // Kupplung, die Arme stehen quer dazu).
    const maske = n.partMask || HOLE_MASKS[n.part] || 11;
    const echt = this._q().meshes && this._fitMeshes
      ? this._fitMeshes["hole-connector4_" + maske] : null;
    if (echt && n.partQuat && n.partQuat.length === 4) {
      const qh = new THREE.Quaternion(n.partQuat[0], n.partQuat[1], n.partQuat[2],
        n.partQuat[3]).normalize();
      this._batchAdd(this._meshGeometry("hole:" + maske, echt), mat,
        new THREE.Matrix4().compose(new THREE.Vector3(n.x, n.y, n.z), qh, ONE),
        "node", n.id, st !== "future" ? this.pickNodes : null);
      return;
    }
    // Achse des Rings, also die Richtung zur tragenden Kupplung: die lokale
    // -X-Achse der Teile-Quaternion (so steht es in allen Dateien des
    // Bestands). Fehlt sie, zeigt sie zur naechsten Kupplung; ohne die bleibt
    // nur irgendeine Querrichtung.
    let peg = null;
    if (n.partQuat && n.partQuat.length === 4) {
      const q = new THREE.Quaternion(n.partQuat[0], n.partQuat[1], n.partQuat[2], n.partQuat[3]).normalize();
      peg = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    } else {
      for (const o of model.nodes.values()) {
        if (o.id === n.id || o.part) continue;
        const v = new THREE.Vector3(o.x - n.x, o.y - n.y, o.z - n.z);
        if (v.length() > cs * 1.2) continue;
        peg = v.normalize();
        break;
      }
      if (!peg) peg = new THREE.Vector3(-stub.z, stub.x, stub.y).normalize();
    }
    const seg = Math.max(10, this._q().tube);
    const at = new THREE.Vector3(n.x, n.y, n.z);
    const armR = g.armRadius;
    // "O--": ein Ring, der ueber den Stutzen der tragenden Kupplung greift, und
    // quer dazu ein eigener Stutzen, in dem das Rohr steckt.
    const ringLen = cs * 0.9;
    const ringR = armR + 0.05 + PIN_RING_WALL;   // Aussenmass des Rings
    const ring = new THREE.Mesh(this._cachedGeo(`pinRing${seg}`, () => {
      const s = new THREE.Shape();
      s.absarc(0, 0, ringR, 0, Math.PI * 2, false);
      const loch = new THREE.Path();
      loch.absarc(0, 0, ringR - PIN_RING_WALL, 0, Math.PI * 2, true);
      s.holes.push(loch);
      const geo = new THREE.ExtrudeGeometry(s, { depth: ringLen, bevelEnabled: false, curveSegments: seg });
      geo.rotateX(Math.PI / 2);            // Achse von +Z auf +Y, wie die Rohre
      geo.translate(0, ringLen / 2, 0);    // um die Mitte
      return geo;
    }), mat);
    ring.quaternion.setFromUnitVectors(UP, peg);
    // Der Stutzen der Kupplung reicht von ihrer Wuerfelflaeche (2,5 cm neben
    // der Muendung) bis gut einen Zentimeter darueber hinaus -- dort sitzt der
    // Ring, also knapp um die Muendung herum.
    ring.position.copy(at).addScaledVector(peg, 0.5);
    ring.userData = { kind: "node", id: n.id };
    this.buildGroup.add(ring);
    if (st !== "future") this.pickNodes.push(ring);
    // Der eigene Stutzen ist so duenn wie ein Kupplungs-Arm -- er steckt IM
    // Rohr und ist deshalb nur an der Muendung zu sehen. Er waechst aus der
    // INNENwand des Rings heraus: am Aussenmantel angesetzt klaffte zwischen
    // Ring und Stutzen eine Luecke.
    const stubLen = cs * 0.85;
    // Ein Stutzen je Arm -- die zwei- und die dreiarmige Fassung haben mehrere.
    const arme = holeArmDirs(n).map((d) => new THREE.Vector3(d[0], d[1], d[2]).normalize());
    for (const richtung of (arme.length ? arme : [stub])) {
      const arm = new THREE.Mesh(
        this._cachedGeo(`pinStub${seg}`, () => this._tubeGeometry(armR, stubLen, Math.max(6, seg - 4))), mat);
      arm.quaternion.setFromUnitVectors(UP, richtung);
      arm.position.copy(at).addScaledVector(richtung, ringR - PIN_RING_WALL + stubLen / 2);
      arm.userData = { kind: "node", id: n.id };
      this.buildGroup.add(arm);
      if (st !== "future") this.pickNodes.push(arm);
    }
  }

  /**
   * Wo haengt die Beschriftung eines gewaehlten Teils, das von sich aus keine
   * bekommt? Kupplungen, Rohre und Rutschen beschriften sich selbst -- fuer die
   * liefert das hier nichts.
   */
  _soloAnchor(model, id) {
    const f = model.fittings && model.fittings.get(id);
    if (f) return new THREE.Vector3(f.x, f.y + 10, f.z);
    const c = model.clamps && model.clamps.get(id);
    if (c) return new THREE.Vector3(c.x, c.y + 8, c.z);
    for (const map of [model.panels, model.textiles]) {
      const p = map && map.get(id);
      if (!p) continue;
      const corners = model.panelCorners(p);
      if (!corners) continue;
      const m = corners.reduce((s2, q) => [s2[0] + q[0] / 4, s2[1] + q[1] / 4, s2[2] + q[2] / 4], [0, 0, 0]);
      return new THREE.Vector3(m[0], m[1] + 8, m[2]);
    }
    return null;
  }

  // Bau-Anfasser (Handle): 3 feste Varianten nach kind. War fruehers pro addHandle()-
  // Aufruf ein neues Material (-> Leak), da _disposeGroup nur Geometrien freigibt.
  _handleMaterial(kind) {
    const key = "handle:" + kind;
    if (!this._materials[key]) {
      const isOrigin = kind === "origin";
      const isPlace = kind === "place";
      const isDiag = kind === "diag";
      this._materials[key] = new THREE.MeshBasicMaterial({
        color: isOrigin ? 0x1a8cff : isPlace ? 0xea580c : isDiag ? 0x8b3df5 : 0x18a558,
        transparent: true, opacity: isOrigin ? 0.45 : isPlace ? 0.7 : 0.85,
      });
    }
    return this._materials[key];
  }

  // 箭头材质按语气分开，避免改透明度时整排一起亮。
  _arrowMaterial(tone) {
    const key = "arrow:" + tone;
    if (!this._materials[key]) {
      const focus = tone === "focus";
      const hot = tone === "hot" || focus;
      this._materials[key] = new THREE.MeshStandardMaterial({
        color: focus ? 0x5eead4 : ARROW_TEAL,
        emissive: hot ? 0x115e59 : 0x042f2e,
        emissiveIntensity: focus ? 0.42 : hot ? 0.2 : 0.06,
        roughness: 0.4,
        metalness: 0.08,
        transparent: true,
        opacity: focus ? 0.94 : hot ? 0.76 : 0.38,
        depthWrite: false,
      });
    }
    return this._materials[key];
  }

  _ensureArrowGeos() {
    if (this._arrowGeoVer === ARROW.geoVer && this._arrowShaft) return;
    this._arrowGeoVer = ARROW.geoVer;
    this._arrowShaft = new THREE.CylinderGeometry(ARROW.shaftR, ARROW.shaftR, ARROW.shaftLen, 10);
    this._arrowCone = new THREE.ConeGeometry(ARROW.coneR, ARROW.coneLen, 10);
    this._arrowStub = new THREE.CylinderGeometry(ARROW.stubR * 0.72, ARROW.stubR, ARROW.stubLen, 10);
    const stubHit = ARROW.offset + ARROW.stubLen + 1.5;
    const fullHit = ARROW.offset + ARROW.shaftLen + ARROW.coneLen;
    this._arrowHitStub = new THREE.CylinderGeometry(ARROW.hitR, ARROW.hitR, stubHit, 8);
    this._arrowHit = new THREE.CylinderGeometry(ARROW.hitR, ARROW.hitR, fullHit, 8);
    this._keepGeos.add(this._arrowShaft);
    this._keepGeos.add(this._arrowCone);
    this._keepGeos.add(this._arrowStub);
    this._keepGeos.add(this._arrowHit);
    this._keepGeos.add(this._arrowHitStub);
  }

  _arrowShaftGeo() { this._ensureArrowGeos(); return this._arrowShaft; }
  _arrowConeGeo() { this._ensureArrowGeos(); return this._arrowCone; }
  _arrowStubGeo() { this._ensureArrowGeos(); return this._arrowStub; }
  _arrowHitGeo() { this._ensureArrowGeos(); return this._arrowHit; }
  _arrowHitStubGeo() { this._ensureArrowGeos(); return this._arrowHitStub; }

  _arrowHitMaterial() {
    if (!this._materials["arrowHit"]) {
      this._materials["arrowHit"] = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false,
      });
    }
    return this._materials["arrowHit"];
  }

  _panelDotGeo() {
    if (!this._panelDot) {
      this._panelDot = new THREE.SphereGeometry(2, 16, 12);
      this._keepGeos.add(this._panelDot);
    }
    return this._panelDot;
  }

  /** 接管箭头用工具栏青绿，不按轴向分色。 */
  _arrowColor() {
    return ARROW_TEAL;
  }

  // Kandidaten-Feld fuer eine Platte (addPanelHandle): ein festes Material.
  // Feld-Handles (Platten/Rutschen-Montagestellen). Das Material ist bewusst
  // gecacht und damit von ALLEN Handles geteilt -- die Hervorhebung unter dem
  // Mauszeiger darf deshalb nicht seine Deckkraft aendern, sonst leuchten alle
  // Felder gleichzeitig auf. Stattdessen gibt es eine zweite Variante, die in
  // setHover() nur am getroffenen Mesh eingehaengt wird.
  _panelHandleMaterial(hovered) {
    const key = hovered ? "panelHandle:hover" : "panelHandle";
    if (!this._materials[key]) {
      this._materials[key] = new THREE.MeshBasicMaterial({
        color: hovered ? 0x34d399 : 0x22c55e, transparent: true,
        opacity: hovered ? 0.42 : 0.2,
        side: THREE.DoubleSide, depthWrite: false,
      });
    }
    return this._materials[key];
  }

  _panelDotMaterial() {
    if (!this._materials["panelDot"]) {
      this._materials["panelDot"] = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    }
    return this._materials["panelDot"];
  }

  // Hervorhebung der im aktuellen Aufbau-Schritt hinzukommenden Rohre.
  // Rohre des AKTUELLEN Aufbauschritts (nur dort ist st === "current"): orange
  // hervorgehoben und leicht durchscheinend, damit die Kupplungen dahinter --
  // die im selben Schritt gesteckt werden -- sichtbar bleiben.
  _tubeHighlight(colorId) {
    const key = "tubehl:" + colorId;
    if (!this._materials[key]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this._look(colorId)), roughness: 0.5, metalness: 0,
        emissive: new THREE.Color(0x3a2400),
        transparent: true, opacity: 0.75, depthWrite: false,
      });
      m.userData.tuneColorId = colorId;
      this._materials[key] = m;
    } else {
      this._materials[key].color.set(this._look(colorId));
    }
    return this._materials[key];
  }

  // Textmarke (Sprite mit Canvas-Textur) ueber einer Kupplung.
  _makeLabelSprite(text, current, category) {
    const dpr = this._labelDpr || 2;
    const pad = 10 * dpr, fs = 30 * dpr;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    canvas.width = Math.ceil(tw + pad * 2);
    canvas.height = Math.ceil(fs + pad * 1.4);
    ctx.font = `bold ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = "middle";
    const r = 12 * dpr;
    ctx.fillStyle = LABEL_BG[category] || (current ? "rgba(255,140,26,0.96)" : "rgba(31,38,48,0.92)");
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
    ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
    ctx.arcTo(0, canvas.height, 0, 0, r);
    ctx.arcTo(0, 0, canvas.width, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, pad, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const worldH = 7; // cm Hoehe der Beschriftung
    sprite.scale.set(worldH * (canvas.width / canvas.height), worldH, 1);
    sprite.renderOrder = 1000;
    return sprite;
  }

  _disposeLabels() {
    for (let i = this.labelGroup.children.length - 1; i >= 0; i--) {
      const c = this.labelGroup.children[i];
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
      this.labelGroup.remove(c);
    }
    this.labelMeshes = [];
  }

  // --- Instanziertes Zeichnen ---------------------------------------------
  // Kupplungen, Arm-Stutzen und Rohre sind Hunderte gleicher Koerper. Statt je
  // Teil ein eigenes Mesh (= ein Draw-Call) werden sie nach Geometrie UND
  // Material gebuendelt und als ein InstancedMesh gezeichnet.
  //
  // Gebuendelt wird nach dem FERTIGEN Material, nicht ueber instanceColor: die
  // Varianten (grau im Kollisions-Modus, rot, orange, blass) unter-
  // scheiden sich nicht nur in der Farbe, sondern auch in Rauheit, Emissive und
  // Transparenz -- das laesst sich nicht je Instanz setzen. Da es nur eine
  // Handvoll Rohrlaengen und Farben gibt, bleiben es trotzdem wenige Buendel.
  //
  // kind/id duerfen null sein (nicht anklickbare Teile wie die Verstaerkungsprofile).
  _batchAdd(geo, mat, matrix, kind, id, pickList, zusatz = null) {
    const key = geo.uuid + "|" + mat.uuid;
    let b = this._batches.get(key);
    if (!b) { b = { geo, mat, mats: [], items: [], pick: pickList || null }; this._batches.set(key, b); }
    b.mats.push(matrix);
    // `zusatz` haengt weitere Felder an den Treffer -- das Verstaerkungsprofil
    // gibt darueber alle Rohre seines Laufs mit.
    b.items.push(kind ? { kind, id, ...(zusatz || {}) } : null);
  }

  // Gesammelte Buendel als InstancedMesh in die Bau-Gruppe haengen. Die
  // Zuordnung Instanz -> Bauteil steht in userData.instances und wird beim
  // Picking ueber intersection.instanceId aufgeloest (siehe _hitData).
  _batchFlush() {
    for (const b of this._batches.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
      for (let i = 0; i < b.mats.length; i++) im.setMatrixAt(i, b.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.userData = { instances: b.items };
      im.castShadow = true;
      im.receiveShadow = true;
      this.buildGroup.add(im);
      if (b.pick) b.pick.push(im);
    }
    this._batches.clear();
  }

  // Baut die Szene aus dem Modell neu auf.
  // opts.labelFor(node) -> string|null  : Beschriftung an der Kupplung.
  // opts.slideNameFor(slide) -> string|null : Beschriftung an der Rutsche/Dach.
  // opts.assembly { done:Set, current:Set } : Aufbaumodus (fertig/aktuell/kuenftig).
  renderModel(model, selectedNodeId, opts = {}) {
    this._disposeGroup(this.buildGroup);
    this._disposeLabels();
    this.pickNodes = [];
    this.pickTubes = [];
    this.pickPanels = [];
    this.pickClamps = [];
    this.pickTextiles = [];
    this.pickSlides = [];
    this.pickFittings = [];
    // Verstaerkungsprofile liegen NEBEN ihrem Rohr -- sie brauchen eine eigene
    // Trefferliste, sonst faengt das Profil im Bau- oder Plattenmodus Klicks ab,
    // die dem Rohr gelten.
    this.pickReinforce = [];
    this._nodePoints = [];
    this._batches.clear();

    // Hervorhebung (Cursor-Auswahl und Bestandsliste). Frueher lief das als
    // Nachlauf ueber die fertige Gruppe und tauschte je Mesh das Material.
    // Instanzen teilen sich ihr Material, deshalb muss die Entscheidung schon
    // beim Anlegen fallen -- matFor() liefert das endgueltige Material.
    // Bei der Bestands-Hervorhebung treten alle uebrigen Teile zusaetzlich
    // zurueck (halbtransparent), damit die gesuchten im Gewirr auffallen. Fuer
    // die Cursor-Auswahl waere das stoerend: dort waehlt man staendig etwas an.
    const selected = opts.selected && opts.selected.size ? opts.selected : null;
    const highlight = opts.highlight && opts.highlight.size ? opts.highlight : null;
    const focusId = opts.focusId != null ? opts.focusId : null;
    // Beides zugleich ist der Normalfall: etwas ist im Modell gewaehlt UND in
    // der Liste wird eine Zeile angeklickt. Dann gilt die ZEILE -- die Auswahl
    // tritt so lange zurueck, sonst leuchten zwei Dinge um die Wette und man
    // sieht nicht mehr, welche Teile die Zeile meint. (Frueher war es
    // umgekehrt: die Auswahl gewann und der Klick blieb wirkungslos.)
    const marked = highlight || selected;
    // Beim Verstaerken steht das Modell ohnehin schon in Grau -- es dann auch
    // noch zurueckzublenden nimmt nur Licht, ohne etwas zu klaeren.
    const dimOthers = !!highlight && !opts.reinforce;
    // Eingefuegte Teile an einer belegten Stelle: Rot geht allem vor -- es sagt,
    // dass der Klick hier nichts absetzt.
    const invalid = opts.invalid && opts.invalid.size ? opts.invalid : null;
    const matFor = (id, base) => {
      if (invalid && id != null && invalid.has(id)) return this._invalidMaterial(base);
      if (focusId != null && id === focusId) return this._focusMaterial(base);
      if (highlight && id != null && highlight.has(id)) {
        return focusId != null ? this._partnerMaterial(base) : this._selectedMaterial(base);
      }
      if (marked) {
        if (id != null && marked.has(id)) return this._selectedMaterial(base);
        return dimOthers ? this._dimmedMaterial(base) : base;
      }
      return base;
    };

    const tubeRadius = geometry().tubeRadius;
    const armRadius = geometry().armRadius; // C45-Arm: ~42 mm, duenner als das Rohr
    const asm = opts.assembly || null;
    const labelFor = opts.labelFor || null;
    // Genau ein gewaehltes Teil: seine volle Bezeichnung, egal welcher Art.
    const soloLabel = opts.soloLabel || null;
    const slideNameFor = opts.slideNameFor || null;
    // Nur diese ids beschriften (Cursor-Modus mit genau einem gewaehlten Teil).
    // null = alle, die labelFor/slideNameFor liefern.
    const labelIds = opts.labelIds || null;
    const wantsLabel = (id) => !labelIds || labelIds.has(id);
    // Einzeln angeklicktes Teil: wird IMMER beschriftet, auch wenn es im
    // Aufbaumodus nicht zum aktuellen Schritt gehoert (dort ist Nachschlagen
    // gerade der Zweck).
    const soloId = opts.soloId != null ? opts.soloId : null;
    const suggest = opts.suggest || null;
    const reinforce = opts.reinforce || false;
    // Kollisions-Modus: betroffene Rohre rot, alle anderen grau. Platten und
    // Netze bleiben aussen vor, damit die Ueberlagerungen sichtbar sind.
    const hideFlat = reinforce;
    const cs = geometry().connectorSize;
    // Echte Kupplungs-Arme (aus variant2 importiert, node.arms): kurze Stutzen
    // mit Arm-Durchmesser (~42 mm). Offene Arme ragen heraus; von Rohren belegte
    // stecken im Rohr (Arm dünner als Rohr) -> sichtbar nur die freien Arme.
    const armStubLen = cs * 0.85;
    const qual = this._q();   // Aufloesung je Qualitaetsstufe
    const armStubGeo = this._tubeGeometry(armRadius, armStubLen, Math.max(6, qual.tube - 4));
    const armStubOff = cs / 2 + armStubLen / 2 - 0.4;
    // Am BOGENROHR laeuft der Stutzen gerade, das Rohr biegt aber weg: bei
    // 6,85 cm Stutzenende weicht der Bogen schon 0,58 cm von der Tangente ab --
    // mehr als zwischen Stutzen (Radius ~2,1) und Rohrwand (2,45) Platz ist,
    // der Stutzen durchstiess die Wand. Dort also ein kurzer Stutzen.
    const bowStubLen = cs * 0.32;
    const bowStubGeo = this._tubeGeometry(armRadius, bowStubLen, Math.max(6, qual.tube - 4));
    const bowStubOff = cs / 2 + bowStubLen / 2 - 0.4;

    // Richtungen der an einem Knoten TATSAECHLICH angeschlossenen Rohre.
    // Einmal fuer alle Knoten aufgebaut (sonst waere die Pruefung je Knoten ueber
    // alle Rohre quadratisch). Bei Bogenrohren zaehlt die Tangente am Knoten,
    // nicht die Sehne zum Gegenknoten -- sonst gilt ein belegter Arm faelschlich
    // als frei.
    const tubeDirsAt = new Map();
    const pushDir = (nodeId, vx, vy, vz, bow) => {
      const L = Math.hypot(vx, vy, vz);
      if (L < 1e-6) return;
      if (!tubeDirsAt.has(nodeId)) tubeDirsAt.set(nodeId, []);
      const d = [vx / L, vy / L, vz / L];
      // Ein Stutzen je Richtung: an einer Kupplung koennen mehrere Teile
      // denselben Arm belegen (Multirad-Arretierung und Lochzapfenkupplung
      // sitzen sogar zusammen darauf) -- gezeichnet wird er trotzdem einmal.
      const liste = tubeDirsAt.get(nodeId);
      if (liste.some((e) => e.d[0] * d[0] + e.d[1] * d[1] + e.d[2] * d[2] > 0.99)) return;
      liste.push({ d, bow: !!bow });
    };
    // Die Lochzapfenkupplung greift mit ihrem Ring ueber einen Stutzen der
    // Kupplung -- der gehoert also gezeichnet, obwohl dort kein Rohr steckt.
    // Ihr Knoten liegt eine Kupplungslaenge daneben, das gibt die Richtung.
    // Dasselbe gilt fuer einen Flexikupplungs-Bolzen, der auf einem Stutzen
    // steckt statt am Rohrende -- ohne den Stutzen haengt er neben der Kupplung
    // in der Luft (mittlere Gelenke des Ball Cage).
    for (const p of model.nodes.values()) {
      if (!isHolePart(p.part) && !isBoltPart(p.part)) continue;
      let near = null, nd = geometry().connectorSize * 1.4;
      for (const n of model.nodes.values()) {
        if (n === p || n.part) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z);
        if (d < nd) { nd = d; near = n; }
      }
      if (near) pushDir(near.id, p.x - near.x, p.y - near.y, p.z - near.z, false);
    }
    // Ein Rad sitzt auf einem Stutzen der Kupplung -- also bekommt die Kupplung
    // dort auch einen, so wie bei einem Rohr. Der Anker ist die naechstgelegene
    // Kupplung, die Richtung die eigene Achse des Teils (lokales +X).
    for (const f of (model.fittings ? model.fittings.values() : [])) {
      if (!ARM_FITTINGS.has(f.kind) || !f.quat) continue;
      let near = null, nd = 16;
      for (const n of model.nodes.values()) {
        const d = Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z);
        if (d < nd) { nd = d; near = n; }
      }
      if (!near) continue;
      // Sitzt das Teil GENAU auf der Kupplung (Radlager, Adapter), gibt der
      // Abstand keine Richtung her -- dann zaehlt seine eigene Achse.
      const dx = f.x - near.x, dy = f.y - near.y, dz = f.z - near.z;
      if (Math.hypot(dx, dy, dz) > 0.5) pushDir(near.id, dx, dy, dz, false);
      else {
        const qx = new THREE.Quaternion(f.quat[0], f.quat[1], f.quat[2], f.quat[3]).normalize();
        const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(qx);
        pushDir(near.id, ax.x, ax.y, ax.z, false);
      }
    }
    // Die Kupplung, die eine Lagerkupplung traegt, steckt mit einem Stutzen in
    // ihr -- der zeigt zurueck zum Rohr, sonst schwebt der Wuerfel frei.
    // Die Kupplung, die eine Lagerkupplung traegt, steckt mit einem Stutzen in
    // ihr -- der zeigt zurueck zum Rohr, sonst schwebt der Wuerfel frei. Gilt
    // fuer die selbst gesetzte (part "bearing") wie fuer die eingelesene, die
    // ihren `stub` aus dem 3. Durchlauf des Imports hat (`bearingOn`).
    for (const n of model.nodes.values()) {
      if (!n.stub) continue;
      if (n.part && n.part !== "bearing") continue;
      if (!n.part && !n.bearingOn) continue;
      pushDir(n.id, -n.stub[0], -n.stub[1], -n.stub[2], false);
    }
    for (const t of model.tubes.values()) {
      const na = model.nodes.get(t.a), nb = model.nodes.get(t.b);
      if (!na || !nb) continue;
      if (t.bow && t.bowCenter) {
        const [cx, cy, cz] = t.bowCenter;
        pushDir(t.a, nb.x - cx, nb.y - cy, nb.z - cz, true);
        pushDir(t.b, na.x - cx, na.y - cy, na.z - cz, true);
      } else if (t.arm) {
        // Kante zum Adapter-Koerper der Winkelkupplung: ihre Huelse steckt auf
        // einem Stutzen, der Koerper sitzt aber um den 45-Grad-Arm versetzt --
        // gemessen laeuft die Kante ~17 Grad schief. Der Stutzen gehoert
        // trotzdem genau auf die Huelsenachse.
        //
        // Die steht am Adapter-Koerper (`c45axis`) und zeigt von der Kupplung
        // weg. Nur wenn sie fehlt (alte Staende), wird auf die naechste ACHSE
        // gerundet -- diagonal liegende Huelsen (Winkelkupplung im Rohr) zog das
        // sonst auf eine Weltachse, und die Kupplung stand voellig verdreht da.
        const q = (d) => { const m = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
          const ax = m.indexOf(Math.max(m[0], m[1], m[2]));
          const o = [0, 0, 0]; o[ax] = Math.sign(d[ax]) || 1; return o; };
        const koerper = na.c45body ? na : nb.c45body ? nb : null;
        const achse = koerper && koerper.c45axis;
        const ab = achse
          ? (koerper === nb ? achse.slice() : [-achse[0], -achse[1], -achse[2]])
          : q([nb.x - na.x, nb.y - na.y, nb.z - na.z]);
        pushDir(t.a, ab[0], ab[1], ab[2], false);
        pushDir(t.b, -ab[0], -ab[1], -ab[2], false);
      } else {
        pushDir(t.a, nb.x - na.x, nb.y - na.y, nb.z - na.z, false);
        pushDir(t.b, na.x - nb.x, na.y - nb.y, na.z - nb.z, false);
      }
    }

    // Abgegriffene Originalmodelle: auf dieser Stufe erwuenscht? Dann laden.
    // Anbauteile-Datei traegt auch Klemmen und die Winkelkupplung.
    // Die Lochzapfenkupplung ist ein KNOTEN, kein Anbauteil -- ihr Modell liegt
    // aber bei den Anbauteilen. Ohne diese Zeile blieb es beim gezeichneten
    // Ersatz, solange das Modell sonst keine Anbauteile hatte.
    const wantMeshes = qual.meshes;
    const wantsFitMeshes = (model.fittings && model.fittings.size)
      || (model.clamps && model.clamps.size)
      // Auch die Verstaerkungsprofile liegen in dieser Datei -- ohne diese
      // Zeile blieb es in einem Modell ohne Anbauteile beim gezeichneten
      // Innenstab, das abgegriffene Profil kam nie.
      || [...model.tubes.values()].some((t) => t.reinforced)
      || [...model.nodes.values()].some((n) => n.c45 || isHolePart(n.part) || isBoltPart(n.part));
    const braucht = [];
    if (model.nodes.size) braucht.push("connectors");
    if ([...model.tubes.values()].some((t) => t.bow)) braucht.push("tubes");
    if (model.slides.size) braucht.push("slides");
    if (wantsFitMeshes) braucht.push("fittings");
    if (model.panels.size || (model.textiles && model.textiles.size)) braucht.push("surfaces");
    if (wantMeshes) for (const satz of braucht) this._ensureMeshes(satz);
    // Solange eine der gebrauchten Dateien noch unterwegs ist, wird das Modell
    // GAR NICHT gezeichnet -- sonst stuenden beim Laden erst die selbst
    // gezeichneten Ersatzformen da und wechselten eine Zehntelsekunde spaeter.
    // Stattdessen laeuft ein Spinner; scheitert eine Datei endgueltig (Feld
    // `false`), geht es mit den Ersatzformen weiter.
    const wartet = wantMeshes && braucht.some((satz) => this[MESH_FIELDS[satz]] === null);
    this._setLoading(wartet);
    if (wartet) {
      // Die Zoomgrenze haengt an der MODELLGROESSE, nicht am Gezeichneten --
      // sie muss auch beim Warten stehen. Sonst gilt weiter die Grenze fuer ein
      // leeres Modell, und der naechste `_applyZoomLimits()` (Fenstergroesse,
      // Projektion) holt eine weit draussen stehende Kamera heran: die gerade
      // wiederhergestellte Ansicht sprang damit beim Laden zurueck.
      this._applyZoomLimits(model);
      this._needsRender = true;
      return;
    }
    // Verstaerkungsprofile: die abgegriffenen Modelle liegen bei den Anbauteilen.
    // Sie decken die genormten Laeufe (80 und 60 cm) ab; was uebrig bleibt --
    // etwa die krummen Abstaende eines gedrehten Aufbaus -- behaelt den
    // gezeichneten Innenstab. `aluGedeckt` haelt fest, welche Rohre schon ein
    // Profil haben.
    const aluModelle = !!(wantMeshes && this._fitMeshes && this._fitMeshes.alu2_800
      && [...model.tubes.values()].some((t) => t.reinforced));
    const aluGedeckt = new Set();

    // Zustand eines Teils im Aufbaumodus: "done" | "current" | "future".
    const stateOf = (id) => {
      if (!asm) return "done";
      if (asm.current.has(id)) return "current";
      if (asm.done.has(id)) return "done";
      return "future";
    };

    // Verstaerkungsprofile als ganze Laeufe. Sie liegen NEBEN dem Rohr, mit
    // Pfeilen darauf -- genau so zeigt sie die Herstellersoftware.
    if (aluModelle && !reinforce) {
      for (const lauf of reinforcementProfiles(model)) {
        const zustand = lauf.tubes.map((id) => stateOf(id));
        if (zustand.every((z) => z === "future")) continue;
        const rec = this._fitMeshes[
          Math.abs(lauf.len - 80) < 1 ? "alu2_800" : Math.abs(lauf.len - 60) < 1 ? "alu2_600" : null];
        if (!rec) continue;
        for (const id of lauf.tubes) aluGedeckt.add(id);
        const ex = new THREE.Vector3(lauf.dir[0], lauf.dir[1], lauf.dir[2]).normalize();
        // Die Rollachse ist frei: im Bestand kommen neun verschiedene vor, eine
        // Regel gibt es dort nicht. Genommen wird die, die am ehesten nach oben
        // zeigt -- damit liegt das Profil bei waagerechten Laeufen immer oben.
        let ey = new THREE.Vector3(0, 1, 0);
        if (Math.abs(ex.y) > 0.9) ey.set(0, 0, 1);
        ey.addScaledVector(ex, -ey.dot(ex)).normalize();
        const ez = new THREE.Vector3().crossVectors(ex, ey);
        // Hervorhebung: sobald eines der Rohre des Laufs gewaehlt oder in der
        // Liste markiert ist, leuchtet das ganze Profil mit -- sonst sieht man
        // nicht, dass der Klick darauf gesessen hat.
        const grund = zustand.some((z) => z === "current") ? this._rodMaterial()
          : (asm && zustand.every((z) => z === "done")) ? this._fadedMaterial()
          : this._rodMaterial();
        const mat = matFor(lauf.tubes.find((id) => marked && marked.has(id)) ?? null, grund);
        this._batchAdd(this._meshGeometry("fit:" + (Math.abs(lauf.len - 80) < 1 ? "alu2_800" : "alu2_600"), rec),
          mat, new THREE.Matrix4().makeBasis(ex, ey, ez)
            .setPosition(new THREE.Vector3(lauf.from[0], lauf.from[1], lauf.from[2])),
          // Ein Klick auf das Profil meint das Rohr darunter; `tubes` haelt den
          // ganzen Lauf fest, damit die Auswahl beide Rohre erwischt.
          "tube", lauf.tubes[0], this.pickReinforce, { tubes: lauf.tubes.slice() });
      }
    }

    // Kupplungen (Wuerfel)
    for (const n of model.nodes.values()) {
      const st = stateOf(n.id);
      if (st === "future") continue;   // noch nicht gebaute Teile bleiben unsichtbar
      // Kupplung, die in der Datei steht, aber nichts haelt: die Hersteller-
      // software zeichnet sie nicht -- sonst schweben Wuerfel in der Luft.
      if (n.unused) continue;
      // Bezugspunkte fuer die Drehpunkt-Suche (_pointUnderCursor).
      this._nodePoints.push(new THREE.Vector3(n.x, n.y, n.z));
      let mat;
      if (st === "future") mat = this._ghostMaterial();
      else if (st === "current") mat = this._connMaterial(false);
      else if (asm && st === "done") mat = this._fadedMaterial();
      else mat = this._connMaterial(n.id === selectedNodeId);
      // Adapter-Koerper (importierte C45, n.c45body) sind keine eigenstaendige
      // Kupplung -> kein dunkler Wuerfel; sie werden unten in Adapter-Farbe
      // gezeichnet (Huelse + Koerper + 45°-Arm).
      // Klemm-Kupplung: Huelse um das umschlossene Rohr, quer dazu der offene
      // Anschluss. Die Lochzapfenkupplung nimmt dort direkt ein Rohr auf und
      // braucht keinen Wuerfel; die Lagerkupplung traegt eine ganze Kupplung --
      // die wird unten zusaetzlich gezeichnet.
      if (n.stub && isHolePart(n.part)) this._addPinConnector(model, n, matFor(n.id, mat), st);
      else if (isBoltPart(n.part)) this._addFlexiJoint(model, n, mat, st, matFor);
      else if (n.stub && n.part) this._addTubeClamp(model, n, matFor(n.id, mat), st);
      // Wo eine Radkappe sitzt, gibt es keine Kupplung mehr -- die Kappe
      // schliesst das Rohrende selbst ab. Der Flexikupplungs-Bolzen ersetzt sie
      // ebenfalls: er steckt selbst im Rohrende.
      if (!n.c45body && !isHolePart(n.part) && !isBoltPart(n.part)
          && !(model.hasWheelCap && model.hasWheelCap(n))) {
        const pos = new THREE.Vector3(n.x, n.y, n.z);
        const quat = this._nodeCubeQuat(model, n);
        // Abgegriffenes Originalteil: EIN Mesh mit Bohrungen und Armen.
        // Offene Huelsen kommen aus variant2 (`n.arms`) bzw. dem gewaehlten
        // `preferType` -- nicht nur aus bereits steckenden Rohren.
        const dirs = this._connectorArmDirs(n, tubeDirsAt.get(n.id) || [], quat);
        const echt = wantMeshes ? this._connMeshFor(dirs, quat, n.preferType) : null;
        if (echt) {
          this._batchAdd(echt.geo, matFor(n.id, mat),
            new THREE.Matrix4().compose(pos, echt.quat, ONE), "node", n.id, this.pickNodes);
        } else {
          this._batchAdd(this._connGeometry(), matFor(n.id, mat),
            new THREE.Matrix4().compose(pos, quat, ONE), "node", n.id, this.pickNodes);

          // Ersatz: kurze Stutzen in jeder Armrichtung, inkl. offener Huelsen.
          for (const e of dirs) {
            const dv = new THREE.Vector3(e.d[0], e.d[1], e.d[2]);
            const off = e.bow ? bowStubOff : armStubOff;
            const p = new THREE.Vector3(
              n.x + dv.x * off, n.y + dv.y * off, n.z + dv.z * off);
            const q = new THREE.Quaternion().setFromUnitVectors(UP, dv);
            this._batchAdd(e.bow ? bowStubGeo : armStubGeo, matFor(n.id, mat),
              new THREE.Matrix4().compose(p, q, ONE), "node", n.id, this.pickNodes);
          }
        }
      }

      // 45-Grad-Winkelkupplung (C45). Echtes Teil: eine Huelse wird auf einen
      // KARDINALEN Arm der Basiskupplung gesteckt, davon zweigt ein 45°-Arm ab,
      // der in die Tube greift.
      if (n.c45 && st !== "future") {
        // Im Aufbau bleicht der Adapter genau wie die uebrigen fertigen Teile
        // aus -- sonst steht die 45-Grad-Kupplung als einziges Stueck kraeftig
        // schwarz im schon Gebauten.
        const c45base = (asm && st === "done")
          ? this._fadedMaterial() : this._c45Material();
        const c45mat = matFor(n.id, c45base);
        // Abgegriffenes Originalteil: EIN Mesh auf der Basiskupplung, mit deren
        // Lage -- genau dort und so fuehrt die Datei die connector45_2. Huelse,
        // Koerper und 45-Grad-Arm stecken darin, es braucht keinen Zusammenbau.
        const echtC45 = wantMeshes && this._fitMeshes
          ? this._fitMeshes["connector45_2"] : null;
        const c45lage = echtC45 ? this._c45Placement(model, n) : null;
        if (c45lage) {
          this._batchAdd(this._meshGeometry("fit:connector45_2", echtC45), c45mat,
            c45lage, "node", n.id, this.pickNodes);
        } else if (n.c45body) {
          // Import: n ist der Adapter-Koerper am Diagonal-Fuss; die Basis sitzt
          // am anderen Ende der Arm-Kante. Huelse laeuft kardinal von der Basis.
          const ad = this._c45AdapterGeo(model, n);
          if (ad) {
            // Arm der Basiskupplung -- ragt vom Wuerfel in die C45-Huelse hinein.
            if (ad.baseArmLen > 0.5) {
              const baseArm = new THREE.Mesh(
                new THREE.CylinderGeometry(armRadius, armRadius, ad.baseArmLen, 14),
                c45mat);
              baseArm.position.copy(ad.baseArmMid);
              baseArm.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
              baseArm.userData = { kind: "node", id: n.id };
              this.buildGroup.add(baseArm);
            }
            // C45-Huelse: etwas breiter als das Rohr, der Basis-Arm steckt darin.
            const sockR = this._c45SocketR();
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(sockR, sockR, ad.sleeveLen, 14),
              c45mat);
            sleeve.position.copy(ad.sleeveMid);
            sleeve.quaternion.setFromUnitVectors(UP, ad.sleeveDir);
            sleeve.userData = { kind: "node", id: n.id };
            this.buildGroup.add(sleeve);
            if (st !== "future") this.pickNodes.push(sleeve);

            const body = new THREE.Mesh(this._c45Geometry(), c45mat);
            body.position.copy(ad.bodyPos);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);

            if (ad.armLen > 0.5) {
              // Zweiter Schenkel: gleicher Durchmesser wie die Huelse, das
              // Diagonalrohr steckt darin (Knierohr, kein duenner Stift). Er
              // reicht eine halbe Kupplungslaenge UEBER den Fusspunkt hinaus --
              // genau so weit ist das Diagonalrohr an seinem Ende gekuerzt,
              // sonst klafft dort eine Luecke zwischen Kupplung und Rohr.
              const armLen = ad.armLen + cs / 2;
              const arm = new THREE.Mesh(
                new THREE.CylinderGeometry(sockR, sockR, armLen, 14),
                c45mat);
              arm.position.copy(ad.bodyPos).addScaledVector(ad.armDir, armLen / 2);
              arm.quaternion.setFromUnitVectors(UP, ad.armDir);
              arm.userData = { kind: "node", id: n.id };
              this.buildGroup.add(arm);
            }
          }
        } else {
          // Manuell gebaut: Knoten ist die Basiskupplung, Adapter sitzt auf dem
          // zur Diagonale naechsten Achsarm (kleiner Versatz von cs).
          for (const d of this._diagonalDirsAt(model, n)) {
            const dv = new THREE.Vector3(d[0], d[1], d[2]).normalize();
            const cv = this._c45ArmDirAt(model, n, d);
            const bx = n.x + cv.x * cs, by = n.y + cv.y * cs, bz = n.z + cv.z * cs;
            // Huelse: schiebt sich vom Kupplungswuerfel bis zum Knick ueber den
            // Arm -- dieselbe Form wie bei den importierten C45.
            const sockR = this._c45SocketR();
            const sleeveLen = cs / 2;
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(sockR, sockR, sleeveLen, 14), c45mat);
            sleeve.position.set(n.x + cv.x * cs * 0.75, n.y + cv.y * cs * 0.75, n.z + cv.z * cs * 0.75);
            sleeve.quaternion.setFromUnitVectors(UP, cv);
            sleeve.userData = { kind: "node", id: n.id };
            this.buildGroup.add(sleeve);
            const body = new THREE.Mesh(this._c45Geometry(), c45mat);
            body.position.set(bx, by, bz);
            body.userData = { kind: "node", id: n.id };
            this.buildGroup.add(body);
            const stub = new THREE.Mesh(this._c45StubGeometry(), c45mat);
            const stubOff = cs * 0.75;
            stub.position.set(bx + dv.x * stubOff, by + dv.y * stubOff, bz + dv.z * stubOff);
            stub.quaternion.setFromUnitVectors(UP, dv);
            stub.userData = { kind: "node", id: n.id };
            this.buildGroup.add(stub);
          }
        }
      }

      // Beschriftung: im Aufbaumodus nur die aktuelle Ebene, sonst alle sichtbaren.
      const showLabel = labelFor && wantsLabel(n.id) &&
        (n.id === soloId || (asm ? st === "current" : st !== "future"));
      if (showLabel) {
        const info = (soloLabel && n.id === soloLabel.id) ? soloLabel.text : labelFor(n);
        const text = typeof info === "string" ? info : info && info.text;
        if (text) {
          const category = info && typeof info === "object" ? info.category : null;
          const sprite = this._makeLabelSprite(text, st === "current", category);
          sprite.position.set(n.x, n.y + cs / 2 + 6, n.z);
          this.labelGroup.add(sprite);
          this.labelMeshes.push(sprite);
        }
      }
    }

    // Rohre (Zylinder zwischen zwei Knoten)
    for (const t of model.tubes.values()) {
      const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
      if (!a || !b) continue;
      const st = stateOf(t.id);
      if (st === "future") continue;   // noch nicht gebaute Teile bleiben unsichtbar
      // Reine Konnektivitaets-Kanten (Daten): C45-Adapter-Arm wird als Huelse am
      // c45body-Knoten gezeichnet, die Doppelrohr-Verbindung als "8"-Klemme --
      // beide nicht hier als Rohr.
      if (t.arm || t.link) continue;
      const va = new THREE.Vector3(a.x, a.y, a.z);
      const vb = new THREE.Vector3(b.x, b.y, b.z);
      // Eingelesenes gerades Rohr: es liegt da, wo die Datei es hinschreibt.
      // In den Herstellerdateien treffen rund 5 % der Rohre ihre Kupplung nicht
      // genau -- gezeichnet wird das echte Rohr, nicht die Verbindungslinie.
      if (t.geom && !t.bow && t.geom.p0 && t.geom.dir) {
        // Der ZUSCHLAG gehoert dazu: auf einer 45-Grad-Schraege steckt das Rohr
        // tiefer in der Kupplung, die Datei fuehrt den Rest als eigenes Feld
        // (75er-Schraege im Ball Cage: 75 + 4,85 + 5 = 84,85 cm). Ohne ihn
        // endete das Rohr 4,85 cm vor seiner Kupplung -- die Dachschraegen
        // sahen zu kurz aus.
        const g = t.geom, span = g.len + (g.pad || 0) + cs;
        va.set(g.p0[0], g.p0[1], g.p0[2]);
        vb.set(g.p0[0] + g.dir[0] * span, g.p0[1] + g.dir[1] * span, g.p0[2] + g.dir[2] * span);
      }
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      const len = va.distanceTo(vb);

      // Bogenrohr: als Roehre entlang des Kreisbogens um bowCenter zeichnen.
      // cs / 2 je Ende -- dieselbe Kuerzung wie beim geraden Rohr (drawLen).
      const bowCurve = t.bow && t.bowCenter ? this._bowCurve(va, vb, t.bowCenter, cs / 2) : null;
      if (bowCurve) {
        const bowMat = st === "future" ? this._ghostMaterial()
          : st === "current" ? this._tubeMaterial(t.color)
          : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
          : reinforce ? this._tubeGray()
          : (asm && st === "done") ? this._fadedMaterial()
          : this._tubeMaterial(t.color);
        const bowFinalMat = matFor(t.id, bowMat);
        // Abgegriffenes Originalteil, wenn es passt: EIN Mesh, an beiden Enden
        // geschlossen und mit dem geraden Vorlauf, in dem der Kupplungsarm steckt.
        const echterBogen = wantMeshes ? this._bowMeshFor(va, vb, t.bowCenter) : null;
        if (echterBogen) {
          this._batchAdd(echterBogen.geo, bowFinalMat, echterBogen.matrix,
            "tube", t.id, st !== "future" ? this.pickTubes : null);
          continue;
        }
        const bowMesh = new THREE.Mesh(
          new THREE.TubeGeometry(bowCurve, 24, tubeRadius, qual.bow, false),
          bowFinalMat
        );
        bowMesh.userData = { kind: "tube", id: t.id };
        bowMesh.castShadow = true;
        this.buildGroup.add(bowMesh);
        if (st !== "future") this.pickTubes.push(bowMesh);

        // TubeGeometry ist ein offener Schlauch. Ohne Deckel sieht man in das
        // Rohr hinein (die Rueckseiten werden weggeschnitten) -- es wirkt als
        // blosse Flaeche, waehrend gerade Rohre als CylinderGeometry
        // geschlossen sind. Also je Ende eine Scheibe, Normale nach aussen.
        const capGeo = this._capGeometry(tubeRadius, qual.bow);
        for (const [u01, sign] of [[0, -1], [1, 1]]) {
          const cap = new THREE.Mesh(capGeo, bowFinalMat);
          cap.position.copy(bowCurve.getPointAt(u01));
          const outward = bowCurve.getTangentAt(u01).multiplyScalar(sign);
          cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
          cap.userData = { kind: "tube", id: t.id };
          this.buildGroup.add(cap);
          if (st !== "future") this.pickTubes.push(cap);
        }
        continue;
      }

      // Sichtbare Rohrlaenge: das echte Rohr, NICHT der Knotenabstand -- zwischen
      // zwei Kupplungsmitten liegen Rohrlaenge + connectorSize, ein Zylinder ueber
      // die volle Distanz schaut sonst aus der Kupplung wieder heraus. Gerechnet
      // wird aus der Distanz statt aus der Katalog-Laenge: im Schraegen-Raster
      // (importierte Diagonalen, ~41,5 statt 40) klaffte sonst eine Luecke.
      // Die Luecke zur Kupplung fuellen die Arm-Stutzen (siehe oben).
      // Eingelesenes Rohr: Mass UND Zuschlag zeichnen. Das TEIL bleibt das
      // Katalogrohr (die Stueckliste fuehrt weiter 35 cm), aber in der Datei
      // stehen manche Verbindungen weiter auseinander, als Rohr + Kupplung
      // ergeben -- den Rest fuehrt sie als Zuschlag, und die Herstellersoftware
      // zeichnet ihn mit. Ohne ihn endete die Dachschraege des Ball Cage
      // 2,4 cm vor ihrer Kupplung.
      const drawLen = t.geom && !t.bow && t.geom.len
        ? Math.max(1, t.geom.len + (t.geom.pad || 0)) : Math.max(1, len - cs);
      const isReinforceActive = reinforce && t.reinforced;
      const effectiveRadius = isReinforceActive ? tubeRadius * 1.08 : tubeRadius;
      const geo = this._tubeGeometry(tubeRadius, drawLen, qual.tube);
      const geo2 = isReinforceActive
        ? this._tubeGeometry(effectiveRadius, drawLen, qual.tube)
        : geo;
      const mat = st === "future" ? this._ghostMaterial()
        : st === "current" ? this._tubeMaterial(t.color)
        : isReinforceActive ? this._tubeReinforceActive()
        : (suggest && suggest.has(t.id)) ? this._tubeSuggest()
        : reinforce ? this._tubeGray()
        : (asm && st === "done") ? this._fadedMaterial()
        : this._tubeMaterial(t.color);
      const dir = vb.clone().sub(va).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      this._batchAdd(isReinforceActive ? geo2 : geo, matFor(t.id, mat),
        new THREE.Matrix4().compose(mid, quat, ONE), "tube", t.id, this.pickTubes);

      // Verstaerkungsprofil: dünner Innenstab im Bauen-Modus sichtbar.
      // Das Profil (ca. 2,5 cm) liegt im hohlen Rohr (5 cm Außen-Ø) und ragt
      // durch die Kupplungen hindurch – deshalb volle Rohrlänge. Liegen die
      // abgegriffenen Modelle vor, zeichnet sie stattdessen `_addAluProfiles()`
      // als ganze Laeufe NEBEN dem Rohr, so wie die Herstellersoftware.
      if (t.reinforced && !reinforce && st !== "future" && !aluGedeckt.has(t.id)) {
        // Verstaerkungsprofil: ~30 mm Durchmesser (gemessen), passt in das hohle
        // Rohr (49 mm aussen, 3 mm Wandstaerke -> 43 mm Innen-Durchmesser).
        const rodRadius = 1.5;  // 15 mm Radius = 30 mm Durchmesser in cm
        const rodGeo = this._tubeGeometry(rodRadius, len, 8);
        // Nicht anklickbar (kind null) -- das Profil steckt im Rohr.
        this._batchAdd(rodGeo, matFor(null, this._rodMaterial()),
          new THREE.Matrix4().compose(mid, quat, ONE), null, null, null);
      }

      // Laengen-Beschriftung: gleiche Sichtbarkeitsregel wie die Kupplungs-Namen.
      const showTubeLabel = labelFor && wantsLabel(t.id) &&
        (t.id === soloId || (asm ? st === "current" : st !== "future"));
      if (showTubeLabel) {
        const cm = t.length != null ? t.length : Math.round(len - cs);
        const category = t.tubeId === "T75" ? "tube75" : null;
        const text = (soloLabel && t.id === soloLabel.id) ? soloLabel.text : `${cm} cm`;
        const sprite = this._makeLabelSprite(text, st === "current", category);
        sprite.position.set(mid.x, mid.y + tubeRadius + 4, mid.z);
        this.labelGroup.add(sprite);
        this.labelMeshes.push(sprite);
      }
    }

    // Platten (flache Box in der Feld-Ebene) – im Verstaerken-/Kollisions-Modus ausgeblendet.
    const thickness = geometry().panelThickness || 1.6;
    const middle = modelMiddle(model.nodes.values());
    for (const p of model.panels.values()) {
      if (hideFlat) continue;
      const cor = model.panelCorners(p);
      if (!cor) continue;
      const st = stateOf(p.id);
      if (st === "future") continue;
      const [A, B, , D] = cor.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = cor
        .reduce((acc, c) => acc.add(new THREE.Vector3(c[0], c[1], c[2])), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      // Die Platte liegt nicht auf der Rohrachse, sondern oben (side +1) oder
      // unten (side -1) BUENDIG mit dem Rohr: ihre Oberflaeche schliesst mit dem
      // Rohrscheitel ab, sie sitzt also in der oberen Rohrhaelfte und steht
      // nicht darauf. Mitte = Scheitel - halbe Plattenstaerke.
      const nrm = panelNormal(
        [xAxis.x, xAxis.y, xAxis.z], [zAxis.x, zAxis.y, zAxis.z],
        [center.x, center.y, center.z], middle,
      );
      const mat = st === "future" ? this._ghostMaterial()
        : (asm && st === "done") ? this._fadedMaterial(true)
        : this._panelMaterial(p.color, false, false);
      // Abgegriffenes Originalteil, wenn es die Groesse gibt. Es bringt seinen
      // Versatz auf den Rohrscheitel selbst mit, also OHNE `lift` und mit der
      // rohen Eckenmitte. Die Lochplatte laeuft ueber ihre Katalog-Kennung: sie
      // ist ein Nachbau, kein Mitschnitt, und hat kein eigenes Masspaar.
      // Gedrehte Platte: ihre Lippen liegen quer. Achsen tauschen, damit man es
      // sieht -- das abgegriffene Modell bringt die Lippe mit.
      const flaechenX = p.turned ? zAxis : xAxis;
      const flaechenZ = p.turned ? xAxis : zAxis;
      const spanX = p.turned ? w.length() : u.length();
      const spanZ = p.turned ? u.length() : w.length();
      const echteFlaeche = wantMeshes
        ? this._surfaceMeshFor((getPanel(p.panelId) || {}).holes ? p.panelId : "panel2",
          flaechenX, flaechenZ, spanX, spanZ, center.clone(), nrm, p.side)
        : null;
      if (echteFlaeche) {
        this._batchAdd(echteFlaeche.geo, matFor(p.id, mat), echteFlaeche.matrix,
          "panel", p.id, this.pickPanels);
        continue;
      }
      const lift = (geometry().tubeRadius || 2.45) - thickness / 2;
      const sgn = (p.side || 1) < 0 ? -1 : 1;
      center.add(new THREE.Vector3(nrm[0], nrm[1], nrm[2]).multiplyScalar(lift * sgn));
      const geo = this._panelGeometry(p.panelId, u.length(), w.length(), thickness);
      // Gleiches Mass + gleiche Farbe teilen sich Geometrie und Material -> ein
      // Buendel. In grossen Modellen sind die Platten sonst der groesste
      // verbliebene Posten (56 Platten = 56 Draw-Calls).
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(center);
      this._batchAdd(geo, matFor(p.id, mat), basis, "panel", p.id, this.pickPanels);

      // Bällebad-Boden: Wasser-Volumen (75 % Füllhöhe) über dem Boden rendern.
      if (p.panelId === "pool_floor" && st !== "future") {
        const wallH = 40;                   // Wandhöhe pool2 in cm
        const waterH = wallH * 0.75;        // 30 cm Wasserstand
        const wGeo = new THREE.BoxGeometry(u.length(), waterH, w.length());
        const wMesh = new THREE.Mesh(wGeo, matFor(null, this._waterMaterial()));
        // Mitte des Wassers: Boden-Deckfläche + waterH/2  (kein Z-Fighting mit Bodenplatte)
        wMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
        wMesh.position.copy(center).addScaledVector(yAxis, thickness / 2 + waterH / 2);
        this.buildGroup.add(wMesh);
      }
    }

    // Doppelrohrverbinder/Rohrklammer: ein "8"-foermiger Koerper, durch jedes
    // Loch laeuft eine Tube. Loch-Achse = Tube-Richtung (c.dir), die beiden
    // Loecher stehen um c.off (~5 cm) auseinander. Ohne Paar (die zweite Tube
    // ist noch nicht gewaehlt) bleibt es bei einem Loch.
    for (const c of (model.clamps ? model.clamps.values() : [])) {
      const klammer = c.connectorId === "tube_clamp";
      const st = stateOf(c.id);
      if (st === "future") continue;
      const mat = matFor(c.id, this._clampMaterial());
      const dir = c.dir ? new THREE.Vector3(c.dir[0], c.dir[1], c.dir[2]).normalize() : new THREE.Vector3(1, 0, 0);
      const off = c.off ? new THREE.Vector3(c.off[0], c.off[1], c.off[2]) : null;
      const d = off ? off.length() : 0;
      // Eigenes Achsenkreuz: +Z laeuft mit den Rohren, +X von Loch zu Loch.
      // Ohne zweites Rohr steht die Querachse frei -- dann tut es irgendeine.
      const zAxis = dir;
      let xAxis = off ? off.clone().normalize() : new THREE.Vector3(0, 1, 0).cross(zAxis);
      if (xAxis.lengthSq() < 1e-6) xAxis = new THREE.Vector3(1, 0, 0).cross(zAxis);
      xAxis.sub(zAxis.clone().multiplyScalar(xAxis.dot(zAxis))).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      // Abgegriffenes Originalteil: das umschlossene Rohr laeuft entlang dem
      // lokalen +X, und der Nullpunkt liegt in dessen Loch -- deshalb sitzt das
      // Modell direkt auf dem Punkt der Klemme. Das zweite Loch liegt bei den
      // beiden Teilen woanders (am Modell gemessen): beim Doppelrohrverbinder
      // 5,0 cm in lokal -Z, bei der Rohrklammer 5,5 cm in lokal +Y.
      const echt = wantMeshes && this._fitMeshes
        ? this._fitMeshes[klammer ? "clip2" : "clamp2"] : null;
      if (echt) {
        const zweit = off ? off.clone().normalize() : yAxis.clone();
        const qM = new THREE.Quaternion().setFromRotationMatrix(klammer
          ? new THREE.Matrix4().makeBasis(dir,
            zweit, new THREE.Vector3().crossVectors(dir, zweit).normalize())
          : new THREE.Matrix4().makeBasis(dir,
            new THREE.Vector3().crossVectors(zweit.clone().negate(), dir).normalize(),
            zweit.clone().negate()));
        this._batchAdd(this._meshGeometry("fit:" + (klammer ? "clip2" : "clamp2"), echt), mat,
          new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y, c.z), qM, ONE),
          "clamp", c.id, this.pickClamps);
        continue;
      }
      this._batchAdd(this._clampBodyGeometry(klammer, d), mat,
        new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y, c.z), q, ONE),
        "clamp", c.id, this.pickClamps);
    }

    // Netze/Stoffe (textil2): Flaeche ueber 4 Eck-Kupplungen. Deckend -- ein
    // Tuch ist auch am echten Geruest blickdicht.
    for (const tx of (model.textiles ? model.textiles.values() : [])) {
      if (hideFlat) continue;
      const cor = model.panelCorners(tx);
      if (!cor) continue;
      const st = stateOf(tx.id);
      if (st === "future") continue;
      const [A, B, , D] = cor.map((c) => ({ x: c[0], y: c[1], z: c[2] }));
      const va = new THREE.Vector3(A.x, A.y, A.z);
      const u = new THREE.Vector3(B.x, B.y, B.z).sub(va);
      const w = new THREE.Vector3(D.x, D.y, D.z).sub(va);
      const center = cor
        .reduce((acc, c) => acc.add(new THREE.Vector3(c[0], c[1], c[2])), new THREE.Vector3())
        .multiplyScalar(0.25);
      const xAxis = u.clone().normalize();
      const zAxis = w.clone().normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const mat = matFor(tx.id,
        st === "future" ? this._ghostMaterial()
          : (asm && st === "done") ? this._fadedMaterial(true)
          : this._panelMaterial(tx.color, false, false));
      // Abgegriffenes Originaltuch, wenn es die Groesse gibt. Die Normale
      // bestimmt hier dieselbe Regel wie bei der Platte, damit das Tuch nicht
      // je nach Ecken-Reihenfolge einmal oben und einmal unten liegt.
      const echtesTuch = wantMeshes ? this._surfaceMeshFor("textil2", xAxis, zAxis,
        u.length(), w.length(), center.clone(),
        panelNormal([xAxis.x, xAxis.y, xAxis.z], [zAxis.x, zAxis.y, zAxis.z],
          [center.x, center.y, center.z], middle), tx.side) : null;
      if (echtesTuch) {
        this._batchAdd(echtesTuch.geo, mat, echtesTuch.matrix, "textile", tx.id, this.pickTextiles);
        continue;
      }
      const geo = new THREE.BoxGeometry(u.length(), 0.6, w.length());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      mesh.position.copy(center);
      mesh.userData = { kind: "textile", id: tx.id };
      this.buildGroup.add(mesh);
      if (st !== "future") this.pickTextiles.push(mesh);
    }

    // Anbauteile: Raeder, Rollen, Kappen, Netze, Rundwand, Dach, Sonderkupplungen.
    for (const f of (model.fittings ? model.fittings.values() : [])) {
      if (hideFlat && FLAT_FITTINGS.has(f.kind)) continue;
      const st = stateOf(f.id);
      if (st === "future") continue;
      for (const mesh of this._fittingMeshes(f)) {
        const role = mesh.userData.role;
        mesh.userData = { kind: "fitting", id: f.id, role };
        const base = mesh.material;
        // Wasser bleibt blau -- es ist kein Bauteil, Orange wuerde wie ein Kasten wirken.
        mesh.material = role === "water" ? base
          : matFor(f.id, (suggest && suggest.has(f.id)) ? this._suggestMaterial(base)
          : (asm && st === "done") ? this._fadedMaterial(base.side === THREE.DoubleSide) : base);
        this.buildGroup.add(mesh);
        this.pickFittings.push(mesh);
      }
    }

    // Rutschen/Daecher: eigene Geometrie je Art (Bogen/gerade/Auslauf = U-Rinne,
    // Dach = flache Kappe). slide-end2-Position via _slideEndRenderedCenter.
    // Ketten-Status fuer nahtlose Uebergaenge: der Querschnitt (W/Nrm), mit dem das
    // VORHERIGE Rutschenteil endete, plus die ID des Teils, das ihn uebernehmen soll.
    this._slideChainFrame = null;
    this._slideChainNextId = null;
    for (const sl of (model.slides ? model.slides.values() : [])) {
      if (hideFlat) continue;
      const st = stateOf(sl.id);
      if (st === "future") continue;
      // Liegt zu dieser Art ein abgegriffenes Originalmodell vor?
      const echtesTeil = !!(wantMeshes && this._slideMeshes && this._slideMeshes[sl.kind]);
      const base = (asm && st === "done")
        ? this._fadedMaterial(true)
        : this._slideMatFor(sl.kind, false, sl.color);
      const mat = matFor(sl.id, (suggest && suggest.has(sl.id)) ? this._suggestMaterial(base) : base);

      // Beschriftung: Name des Rutschenenteils/Dachs wenn Labels aktiv.
      if (slideNameFor && wantsLabel(sl.id) && st !== "future") {
        const name = (soloLabel && sl.id === soloLabel.id) ? soloLabel.text : slideNameFor(sl);
        if (name) {
          const sprite = this._makeLabelSprite(name, st === "current", null);
          sprite.position.set(sl.x, sl.y + 30, sl.z);
          this.labelGroup.add(sprite);
          this.labelMeshes.push(sprite);
        }
      }

      // Originalmodell, sobald es geladen ist: das Teil sitzt schlicht auf seiner
      // gespeicherten Lage -- genau so zeichnet es die Herstellersoftware. Die
      // Kette darunter braucht es dann nicht mehr, jedes Stueck steht fuer sich.
      if (echtesTeil && this._addSlideMesh(sl, mat, st)) continue;
      // Bogenrutsche: gekrümmte 90°-Form oben, fuehrt nach unten ins Folgeteil.
      if (sl.kind === "curved-slide2") { this._addCurvedSlide(sl, model, mat, st); continue; }
      // Gerade Rutsche: schraege Rampe von ihrer Position zum naechsten Folgeteil.
      if (sl.kind === "slide2" || sl.kind === "slide-new2") { this._addStraightSlide(sl, model, mat, st); continue; }
      // Rutschenauslauf: kurzes, flaches U-Rinnen-Endstueck mit offenem Auslauf.
      if (sl.kind === "slide-end2") { this._addSlideEnd(sl, model, mat, st); continue; }
      // roof2 (Dach-Tuch): als GIEBEL ueber das Dach (von den C45-Traufen die
      // Dachschraegen hoch, 90°-Knick am First, andere Schraege runter).
      if (sl.kind === "roof2") { this._addRoof(sl, model, mat, st); continue; }
    }

    // Beschriftung fuer Teile, die selbst keine tragen (Platten, Anbauteile,
    // Doppelrohrverbinder, Netze): nur fuer das eine gewaehlte Teil.
    if (soloLabel) {
      const at = this._soloAnchor(model, soloLabel.id);
      if (at) {
        const sprite = this._makeLabelSprite(soloLabel.text, false, null);
        sprite.position.copy(at);
        this.labelGroup.add(sprite);
        this.labelMeshes.push(sprite);
      }
    }

    // Gesammelte Kupplungen, Arm-Stutzen und Rohre als InstancedMesh anlegen.
    this._batchFlush();

    // Schnittebene: Materialien entstehen erst bei ihrer ersten Verwendung und
    // muessen die Ebene nachtragen -- deshalb hier statt nur in setClip().
    if (this._clipPlane) this._applyClip();

    // Gras unter bodennahen Bauteilen ausblenden (Footprint-Maske).
    this._updateGrassMask(model);

    // Schatten: alle Bauteile werfen und empfangen Schatten.
    this.buildGroup.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;
    });

    // Bäume: bei Bedarf ausblenden wenn zu nah an Knoten.
    this._updateTrees(model);

    // Zoom-Grenze richtet sich nach der Modellgroesse.
    this._applyZoomLimits(model);

    // Der Szenegraph ist neu -> Schattenkarte einmal nachziehen.
    this._shadowsDirty();
    if (this._hoverPartId != null) this._rebuildHoverOverlay(this._hoverPartId, this._hoverPartExtra);
  }

  /**
   * Rutsche oder Dach als abgegriffenes Originalmodell setzen: Lage aus der
   * Datei (Bezugspunkt + eigenes Quaternion), sonst nichts -- die Kette der
   * selbst gezeichneten Teile entfaellt hier, weil jedes Stueck seine Form
   * mitbringt. Liefert false, wenn zu dieser Art kein Modell vorliegt.
   */
  _addSlideMesh(sl, mat, st) {
    const rec = this._slideMeshes && this._slideMeshes[sl.kind];
    if (!rec) return false;
    const mesh = new THREE.Mesh(this._meshGeometry("slide:" + sl.kind, rec), mat);
    mesh.position.set(sl.x, sl.y, sl.z);
    mesh.quaternion.copy(this._slideQuat(sl));
    mesh.userData = { kind: "slide", id: sl.id };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.buildGroup.add(mesh);
    if (st !== "future") this.pickSlides.push(mesh);
    // Der Querschnitt-Uebergabe der gezeichneten Kette ist hier nichts zu
    // uebergeben -- ein nachfolgendes gezeichnetes Teil faengt frisch an.
    this._slideChainFrame = null;
    this._slideChainNextId = null;
    return true;
  }

  // Gerade Rutsche (slide2/slide-new2): schraege Rampe (Rutschflaeche + 2 erhoehte
  // Seitenholme) von ihrer QDF-Position zum NAECHSTEN tiefer liegenden Rutschenteil
  // (Endstueck oder weitere gerade Rutsche). Die QDF-Kette legt das Folgeteil genau
  // an ihr Ende -> die feste ~140cm-Form ergibt sich aus der Distanz. Ersetzt die
  // fehlplatzierte Viewer-Transformation (fester Block + rotateY45 + Offsets).
  _addStraightSlide(sl, model, mat, st) {
    let P0 = this._slideSurfacePoint(sl);
    // Auch die gerade Rutsche ist ein festes Teil: bei 73 von 76 Vorkommen im
    // Bestand sitzt das Folgeteil auf dem lokalen Versatz (0, -800, 1200) -- drei
    // Felder in Laufrichtung (lokales +Z), zwei Ebenen tiefer. Gesucht wird das
    // Teil DORT, nicht mehr das naechstgelegene tiefere: in Abenteuerschloss
    // liegt die Rutsche einer anderen Kette naeher, und die obere Rutsche lief
    // dadurch quer durch das Geruest zu ihr hinueber.
    // Gesucht wird über die BEZUGSPUNKTE (so stehen sie in der Datei), gezeichnet
    // über die Flächenpunkte -- P0 liegt bereits auf der Rohroberkante.
    const roh = new THREE.Vector3(sl.x, sl.y, sl.z);
    const P1exp = STRAIGHT_SLIDE_DROP.clone().applyQuaternion(this._slideQuat(sl)).add(roh);
    let target = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "slide-end2") continue;
      const d = Math.hypot(s2.x - P1exp.x, s2.y - P1exp.y, s2.z - P1exp.z);
      if (d < bestD) { bestD = d; target = s2; }
    }
    if (bestD > 40) target = null;   // dort steht nichts -> Rutsche haengt allein
    let P1;
    // Im Editor gesetzte Rutsche: Der Einhaengepunkt am senkrechten Rohrpaar ist
    // bekannt, es muss nichts aus Quaternion/Kette hergeleitet werden.
    if (sl.hook && sl.hook.length === 3) {
      // Auslauf = gespeicherte Position, die Rutschfläche liegt eine halbe
      // Kupplung darüber (wie beim Rutschenauslauf der Kette).
      P1 = P0.clone().setY(P0.y + SLIDE_END_LIFT);
      // Der Einstieg liegt auf dem Einhängepunkt: der sitzt bereits eine halbe
      // Kupplung über der unteren Kupplung des Rohrpaars (SLIDE_HOOK_LIFT im
      // Modell), also genau auf dem Rohr.
      P0 = new THREE.Vector3(sl.hook[0], sl.hook[1], sl.hook[2]);
      const C0 = new THREE.Vector3((P0.x + P1.x) / 2, P1.y + (P0.y - P1.y) * 0.32, (P0.z + P1.z) / 2);
      const bez0 = (t) => {
        const u = 1 - t;
        return new THREE.Vector3(
          u * u * P0.x + 2 * u * t * C0.x + t * t * P1.x,
          u * u * P0.y + 2 * u * t * C0.y + t * t * P1.y,
          u * u * P0.z + 2 * u * t * C0.z + t * t * P1.z);
      };
      this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez0, 9, null);
      this._slideChainNextId = null;
      return;
    }
    if (target) {
      P1 = this._slideSurfacePoint(target);
    } else if (sl.kind === "slide2" && sl.quat && sl.quat.length === 4) {
      // Modularrutschen-Körper ohne Folgeteil: er ist ein festes Teil und läuft
      // seine eigenen (0, -80, 120) ab -- der Punkt ist der EINSTIEG. Das Ende
      // liegt so hoch, wie das nächste Teil dort ansetzen würde.
      // (Die Integralrutsche unten ist etwas anderes: dort liegt der Punkt am
      // Fuß, deshalb der Suchlauf nach dem Einhängepunkt.)
      P1 = P1exp.clone().setY(P1exp.y + SLIDE_BODY_LIFT);
    } else {
      // Einzelne Rutsche ohne Folgeteil: Die QDF-Position ist dann der FUSS
      // (Auslauf am Boden), nicht der Einstieg -- alle Rutschen-Records einer
      // solchen Datei liegen auf y = 0. Die Rutsche steigt entgegen der
      // Laufrichtung auf Plattformhoehe an: 2 Ebenen hoch (80 cm) bei 100 cm
      // horizontal. Frueher lief der Fallback stattdessen 130 cm nach vorn und
      // 60 cm nach UNTEN -- die Rutsche lag dadurch flach unter dem Boden.
      // Geprueft an QuadroTobezimmer.qdf: Fuss (40,0,100) + Anstieg trifft
      // exakt die Kupplung (40,80,0), an der die Rutsche eingehaengt ist.
      const SLIDE_RUN = 100, SLIDE_RISE = 80; // Rueckfall, falls nichts passt
      const fwd = new THREE.Vector3(1, 0, 0);
      if (sl.quat && sl.quat.length === 4) fwd.applyQuaternion(new THREE.Quaternion(sl.quat[0], sl.quat[1], sl.quat[2], sl.quat[3]).normalize());
      if (fwd.lengthSq() < 0.01) fwd.set(1, 0, 0);
      fwd.normalize();
      // Die Rutsche steht 90 Grad gegen den Uhrzeigersinn (um die Hochachse) zu
      // der Richtung, die direkt aus der QDF-Quaternion faellt -- im Vergleich
      // mit der Herstellersoftware lag sie sonst quer und auf der falschen Seite
      // des Turms.
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      // Auslauf = QDF-Position, die Rutschfläche liegt eine halbe Kupplung
      // darüber -- genauso wie bei der im Editor gesetzten Rutsche, sonst säße
      // dieselbe Rutsche nach Export und Import tiefer.
      P1 = P0.clone().setY(P0.y + SLIDE_END_LIFT);
      // Einstieg = die Kupplung, an der die Rutsche oben eingehaengt ist: erhoeht,
      // in Laufrichtung vor dem Fuss und seitlich auf der Rutschenachse. Damit
      // reicht die Rutsche bis an das Geruest, statt frei in der Luft zu enden.
      // Von mehreren Kandidaten gewinnt der mit der rutschentypischen Neigung
      // (~35 Grad) -- sonst wuerde die oberste Ebene gewaehlt und die Rutsche
      // stuende viel zu steil.
      const IDEAL_SLOPE = 35 * Math.PI / 180;
      let hook = null, bestSlope = Infinity;
      for (const n of model.nodes.values()) {
        const rel = new THREE.Vector3(n.x - P1.x, 0, n.z - P1.z);
        const along = rel.dot(fwd);
        if (along < 20) continue;                                   // liegt hinter dem Fuss
        if (rel.clone().addScaledVector(fwd, -along).length() > 25) continue; // zu weit seitlich
        if (n.y < P1.y + 20) continue;                              // nicht erhoeht
        const off = Math.abs(Math.atan2(n.y - P1.y, along) - IDEAL_SLOPE);
        if (off < bestSlope) { bestSlope = off; hook = { y: n.y, along }; }
      }
      // Mit eigener Drehung ist nichts zu raten: die Integralrutsche ist ein
      // festes Teil, ihr Einhängepunkt liegt INTEGRAL_RUN vor dem Fuß und
      // INTEGRAL_DROP darüber. Nur ohne Drehung wird gesucht.
      if (sl.quat && sl.quat.length === 4) {
        // Auf die Hauptachse einrasten: eine Rutsche läuft im Raster, und die
        // Drehungen aus den Dateien sind nicht immer ganz sauber.
        const kard = Math.abs(fwd.x) >= Math.abs(fwd.z)
          ? new THREE.Vector3(Math.sign(fwd.x) || 1, 0, 0)
          : new THREE.Vector3(0, 0, Math.sign(fwd.z) || 1);
        P0 = new THREE.Vector3(sl.x + kard.x * INTEGRAL_RUN, sl.y + INTEGRAL_DROP, sl.z + kard.z * INTEGRAL_RUN);
      } else {
        // Der Einstieg liegt auf dem Rohr an der gefundenen Kupplung -- eine
        // halbe Kupplung höher, wie der Einhängepunkt einer gesetzten Rutsche.
        P0 = hook
          ? new THREE.Vector3(P1.x + fwd.x * hook.along, hook.y + SLIDE_BODY_LIFT, P1.z + fwd.z * hook.along)
          : P1.clone().addScaledVector(fwd, SLIDE_RUN).setY(P1.y + SLIDE_RISE);
      }
    }
    if (P0.distanceTo(P1) < 1) { this._slideChainFrame = null; this._slideChainNextId = null; return; }
    // Die Bahn läuft am Ende WAAGERECHT aus: der Rutschenauslauf liegt flach,
    // ein schräg ankommender Körper hätte dort einen Knick. Kubische Bézier mit
    // steilem Einstieg (entlang der Sehne) und waagerechter Ausfahrt -- dadurch
    // hängt die Mitte etwas tiefer als die gerade Verbindung, genau wie am
    // echten Teil.
    const sehne = P1.clone().sub(P0);
    const lauf = new THREE.Vector3(sehne.x, 0, sehne.z);
    const waagerecht = lauf.lengthSq() > 0.01 ? lauf.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const laenge = sehne.length();
    // Kurze Griffe: die Bahn bleibt dicht an der Sehne, die Welle ist nur noch
    // angedeutet (Wunsch: "leicht gewellt", nicht buckelig). Das Ende bleibt
    // trotzdem waagerecht -- dafür sorgt die Richtung von C2.
    const C1 = P0.clone().addScaledVector(sehne.clone().normalize(), laenge * 0.26);
    const C2 = P1.clone().addScaledVector(waagerecht, -laenge * 0.34);
    const bez = (t) => {
      const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return new THREE.Vector3(
        a * P0.x + b * C1.x + c * C2.x + d * P1.x,
        a * P0.y + b * C1.y + c * C2.y + d * P1.y,
        a * P0.z + b * C1.z + c * C2.z + d * P1.z);
    };
    // U-Rinne mit hohen Seitenwangen entlang der leicht gebogenen Rampe.
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 9, hint);
    this._slideChainNextId = target ? target.id : null;
  }

  // Rutschenauslauf (Endstueck): kurzes, FLACHES U-Rinnen-Stueck. Hinten (am
  // Anschluss an den Rutschenkoerper) etwas hoeher, laeuft nach vorne flach und
  // OFFEN aus (Bremszone). Auslaufrichtung = horizontale (kardinale) Laufrichtung
  // der einlaufenden Rutsche. Ersetzt das alte 35×35-Viewer-Kaestchen.
  _addSlideEnd(sl, model, mat, st) {
    // Start = GLEICHER Anschlusspunkt, an dem der Rutschenkoerper endet (kein Versatz).
    const P0 = this._slideEndConnectPoint(sl);
    // Einlaufende Rutsche (naechstes Rutschenteil OBERHALB).
    let feeder = null, bestD = Infinity;
    for (const s2 of model.slides.values()) {
      if (s2 === sl) continue;
      if (s2.kind !== "slide2" && s2.kind !== "slide-new2" && s2.kind !== "curved-slide2") continue;
      if (s2.y < sl.y - 1) continue;
      const d = (s2.x - sl.x) ** 2 + (s2.y - sl.y) ** 2 + (s2.z - sl.z) ** 2;
      if (d < bestD) { bestD = d; feeder = s2; }
    }
    // Tangente, mit der die Rutsche hier ankommt -> KNICKFREIER Auslauf-Start:
    // Bogenrutsche = ihre feste Austrittsrichtung; gerade Rutsche = ihr Gefaelle.
    const entryT = feeder
      ? (feeder.kind === "curved-slide2"
          ? this._curvedSlideExit(feeder, model)
          : P0.clone().sub(new THREE.Vector3(feeder.x, feeder.y, feeder.z)).normalize())
      : new THREE.Vector3(0, -1, 0);
    // Horizontale Auslaufrichtung = horizontale (kardinale) Komponente der Einlauf-
    // tangente -> der Auslauf laeuft in DERSELBEN Richtung weiter wie die Rutsche.
    // Laufrichtung: die lokale +Z-Achse des Auslaufs selbst. In allen 73
    // Vorkommen hinter einem Modularkörper zeigt sie genau dorthin, wo der
    // Auslauf hinläuft -- hinter einem Bogenkörper ist der Weg diagonal, und
    // aus ihm die Richtung zu raten ging dort schief (der Auslauf drehte sich
    // zum Einstieg statt zum Ausgang).
    let fwd = null;
    if (sl.quat && sl.quat.length === 4) {
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(this._slideQuat(sl));
      z.y = 0;
      if (z.lengthSq() > 0.04) fwd = z.normalize();
    }
    if (!fwd) {
      let h = new THREE.Vector3(entryT.x, 0, entryT.z);
      if (h.lengthSq() < 0.04 && feeder) h.set(P0.x - feeder.x, 0, P0.z - feeder.z);
      if (h.lengthSq() < 0.01) h.set(1, 0, 0);
      fwd = Math.abs(h.z) >= Math.abs(h.x)
        ? new THREE.Vector3(0, 0, Math.sign(h.z) || -1)
        : new THREE.Vector3(Math.sign(h.x) || -1, 0, 0);
    }
    // Der Auslauf liegt FLACH und endet in einer nach unten geneigten Lippe:
    // erst SLIDE_END_FLAT waagerecht, dann SLIDE_END_LIP schräg abwärts. Der
    // Rutschenkörper davor endet ebenfalls waagerecht, der Übergang bleibt also
    // knickfrei.
    const front = new THREE.Vector3(P0.x + fwd.x * SLIDE_END_FLAT, P0.y, P0.z + fwd.z * SLIDE_END_FLAT);
    // Lippe: Viertelkreis um einen Punkt senkrecht unter dem Ende des flachen
    // Stücks -- die Fläche kippt auf ihrer Länge um volle 90 Grad nach unten.
    const mitte = front.clone().addScaledVector(UP, -SLIDE_END_LIP_R);
    // Parameter-Aufteilung, nicht Längen-Aufteilung: die kurze Lippe bekommt so
    // genug Stützstellen für ihre Rundung, das flache Stück braucht kaum welche.
    const anteil = 0.55;
    const bez = (t) => {
      if (t <= anteil) return P0.clone().lerp(front, t / anteil);
      const phi = ((t - anteil) / (1 - anteil)) * Math.PI / 2;
      return mitte.clone()
        .addScaledVector(fwd, SLIDE_END_LIP_R * Math.sin(phi))
        .addScaledVector(UP, SLIDE_END_LIP_R * Math.cos(phi));
    };
    // Die Wangen enden mit dem flachen Stück; auf der Lippe bleibt nur die
    // Rutschfläche.
    const wallOf = (t) => (t <= anteil ? 1
      : Math.max(0, 1 - ((t - anteil) / (1 - anteil)) * 4));
    const hint = this._slideChainNextId === sl.id ? this._slideChainFrame : null;
    this._slideChainFrame = this._addSlideAlongCurve(mat, st, sl.id, bez, 14, hint, wallOf);
    this._slideChainNextId = null; // Endstück: Kette stoppt hier.
  }

  // Dach-Tuch (roof2) als GIEBEL: findet First (hoechste Knoten nahe roof2) + die
  // C45-Traufen-Ecken und spannt zwei Dachschraegen-Flaechen auf, die sich am First
  // mit ~90°-Knick treffen (Gregor: "startet bei den c45 kupplungen, entlang der
  // Dachschraegen, 90°-Knick oben, andere Schraege zu den c45 kupplungen"). Findet
  // er die Struktur nicht, faellt er auf eine flache Kappe zurueck.
  _addRoof(sl, model, mat, st) {
    const P = new THREE.Vector3(sl.x, sl.y, sl.z);
    const nodes = [...model.nodes.values()];
    const hxz = (n) => Math.hypot(n.x - P.x, n.z - P.z);
    let maxY = -Infinity;
    for (const n of nodes) if (hxz(n) < 80 && n.y > maxY) maxY = n.y;
    const ridge = nodes.filter((n) => Math.abs(n.y - maxY) < 8 && hxz(n) < 80);
    // C45-Traufen-Ecken: C45-Knoten im Dach-Hoehenband, nahe roof2.
    // Bei komplexen Strukturen (z.B. C0178) gibt es C45-Knoten von benachbarten Abschnitten
    // auf verschiedenen Hoehenebenen. Wir nehmen die HOECHSTE Ebene die mind. 4 Knoten liefert
    // (= die echten Traufen-Knoten, die dem First am naechsten liegen).
    const eavesAll = nodes.filter((n) => (n.c45 || n.c45body) && n.y < maxY - 15 && n.y > maxY - 115 && hxz(n) < 140);
    const yLevels = [...new Set(eavesAll.map((n) => Math.round(n.y * 10) / 10))].sort((a, b) => b - a);
    let eaves = eavesAll; // Fallback (triggert eaves.length<4-Check unten)
    for (const y0 of yLevels) {
      const band = eavesAll.filter((n) => Math.abs(n.y - y0) < 8);
      if (band.length >= 4) { eaves = band; break; }
    }
    if (ridge.length < 2 || eaves.length < 4) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(80, 0.6, 80), mat); // Fallback
      m.position.copy(P); m.userData = { kind: "slide", id: sl.id };
      this.buildGroup.add(m); if (st !== "future") this.pickSlides.push(m);
      return;
    }
    // First-Achse = horizontale Achse mit groesster Spannweite unter den First-Knoten.
    const rx = ridge.map((n) => n.x), rz = ridge.map((n) => n.z);
    const alongZ = (Math.max(...rz) - Math.min(...rz)) >= (Math.max(...rx) - Math.min(...rx));
    const ridgeKey = (n) => (alongZ ? n.z : n.x);
    const slopeKey = (n) => (alongZ ? n.x : n.z);
    const slopeCenter = alongZ ? P.x : P.z;
    // First-Endpunkte (auf der Querposition von roof2).
    const rMin = alongZ ? new THREE.Vector3(P.x, maxY, Math.min(...rz)) : new THREE.Vector3(Math.min(...rx), maxY, P.z);
    const rMax = alongZ ? new THREE.Vector3(P.x, maxY, Math.max(...rz)) : new THREE.Vector3(Math.max(...rx), maxY, P.z);
    // Zwei Seiten der Traufen (links/rechts der First-Achse).
    for (const sign of [-1, 1]) {
      const side = eaves.filter((n) => (slopeKey(n) - slopeCenter) * sign > 0);
      if (side.length < 2) continue;
      side.sort((a, b) => ridgeKey(a) - ridgeKey(b));
      const eA = side[0], eB = side[side.length - 1];
      // Quad: Traufe(min) -> Traufe(max) -> First(max) -> First(min).
      this._addRoofQuad([
        new THREE.Vector3(eA.x, eA.y, eA.z), new THREE.Vector3(eB.x, eB.y, eB.z),
        ridgeKey(eB) >= ridgeKey(eA) ? rMax : rMin,
        ridgeKey(eB) >= ridgeKey(eA) ? rMin : rMax,
      ], mat, st, sl.id);
    }
  }

  // Eine Dachschraegen-Flaeche (Rechteck-Quad aus 4 Ecken A,B,C,D) als duenne Platte.
  _addRoofQuad(c, mat, st, id) {
    const [A, B, , D] = c;
    const u = B.clone().sub(A), w = D.clone().sub(A);
    if (u.lengthSq() < 1 || w.lengthSq() < 1) return;
    const center = A.clone().add(B).add(c[2]).add(D).multiplyScalar(0.25);
    const xAxis = u.clone().normalize(), zAxis = w.clone().normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(u.length(), 0.8, w.length()), mat);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    mesh.position.copy(center);
    mesh.userData = { kind: "slide", id };
    this.buildGroup.add(mesh);
    if (st !== "future") this.pickSlides.push(mesh);
  }

  // --- Handles (Bau-Anfasser) --------------------------------------------
  // Kreisbogen von va nach vb um den Mittelpunkt center (Bogenrohr, 90 Grad).
  // Liefert null, wenn die Punkte keinen echten Bogen aufspannen (dann wird das
  // Rohr wie ein gerades gezeichnet).
  //
  // trim = Bogenlaenge, die an BEIDEN Enden entfaellt. va/vb sind Kupplungs-
  // MITTEN; ohne Kuerzung liefe die Roehre bis dorthin und schnitte sichtbar
  // durch den Kupplungswuerfel. Gerade Rohre kuerzen dafuer ihre Laenge um
  // connectorSize, hier ist es der zugehoerige Winkel trim/R je Ende.
  _bowCurve(va, vb, center, trim = 0) {
    const C = new THREE.Vector3(center[0], center[1], center[2]);
    const u = va.clone().sub(C);
    const v = vb.clone().sub(C);
    const R = (u.length() + v.length()) / 2;
    if (R < 1e-3) return null;
    u.normalize();
    v.normalize();
    // Komponente von v senkrecht zu u spannt mit u die Bogenebene auf.
    const w = v.clone().addScaledVector(u, -u.dot(v));
    if (w.lengthSq() < 1e-6) return null; // kollinear -> kein Bogen
    w.normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
    // Punkt und Tangente auf dem Bogen (Winkel waechst von va nach vb).
    const pAt = (th) => C.clone()
      .addScaledVector(u, R * Math.cos(th))
      .addScaledVector(w, R * Math.sin(th));
    const tAt = (th) => w.clone().multiplyScalar(Math.cos(th))
      .addScaledVector(u, -Math.sin(th)).normalize();

    if (trim <= 0) {
      const pts = [];
      const SEG = 16;
      for (let i = 0; i <= SEG; i++) pts.push(pAt((ang * i) / SEG));
      return new THREE.CatmullRomCurve3(pts);
    }

    // Das Rohrende muss BUENDIG auf der Kupplungsflaeche sitzen. Kuerzt man nur
    // den Bogenwinkel, steht die Tangente dort schon um trim/R gedreht -- der
    // Endring wird schraeg angeschnitten (gemessen: 0,51 cm Versatz ueber den
    // Querschnitt, das Ende ragte halb in die Kupplung und halb heraus).
    // Deshalb laeuft das letzte Stueck GERADE in der Kupplungsachse: der Bogen
    // wird um trim + LEAD gekuerzt und um LEAD entlang der Achse am Knoten
    // verlaengert. Die Mittellinie weicht dabei um R*(1-cos) < 0,1 cm vom
    // echten Kreis ab -- unsichtbar, das Ende dafuer exakt rechtwinklig.
    const LEAD = 1.5;
    const dth = Math.min((trim + LEAD) / R, ang * 0.4);
    const span = ang - 2 * dth;
    const pts = [pAt(dth).addScaledVector(tAt(0), -LEAD)];
    const SEG = 16;
    for (let i = 0; i <= SEG; i++) pts.push(pAt(dth + (span * i) / SEG));
    pts.push(pAt(ang - dth).addScaledVector(tAt(ang), LEAD));
    return new THREE.CatmullRomCurve3(pts);
  }

  clearHandles() {
    this._needsRender = true;
    this._arrowFocus = null;
    this._clearTubePreview();
    this._disposeGroup(this.handleGroup);
    this.handleMeshes = [];
  }

  // `radius` waechst nur dort, wo ein Punkt schwerer zu treffen ist -- etwa der
  // Punkt MITTEN auf einer Kupplung (Winkelkupplung direkt ins Rohr).
  // Richtungshandles (userData.dir / arrowDir) werden als Pfeil gezeichnet,
  // nicht als Kugel -- wie designer die freien Arme markiert.
  addHandle(position, userData, kind = "dir", radius = 2.4) {
    this._needsRender = true;
    const data = userData || {};
    const arrowDir = data.arrowDir || data.dir;
    if (kind !== "origin" && kind !== "place" && arrowDir) {
      return this._addArrowHandle(position, arrowDir, data, kind);
    }
    const isBox = kind === "origin" || kind === "place";
    const cs = geometry().connectorSize;
    const size = kind === "origin" ? cs
      : (kind === "place" && data.placeNode) ? cs * 1.28
      : 3;
    const geo = isBox
      ? new THREE.BoxGeometry(size, size, size)
      : new THREE.SphereGeometry(radius, 16, 12);
    const mat = this._handleMaterial(kind);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.userData = Object.assign({ kind: "handle" }, data);
    mesh.renderOrder = 999;
    this.handleGroup.add(mesh);
    this.handleMeshes.push(mesh);
    return mesh;
  }

  /**
   * Pfeil vom Ursprung entlang `dir`. Lokales +Y = Richtung.
   * 加管默认短芽；指到该接头才展开完整箭头。隐形碰撞体保持好点。
   */
  _addArrowHandle(origin, dirArr, userData, kind) {
    const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    else dir.normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const compact = !!userData.arrowCompact;
    const mat = this._arrowMaterial(compact ? "rest" : "hot");
    const group = new THREE.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    group.quaternion.copy(quat);
    group.userData = Object.assign({
      kind: "handle",
      arrowRoot: true,
      arrowStub: compact,
    }, userData);

    const stub = new THREE.Mesh(this._arrowStubGeo(), mat);
    stub.position.y = ARROW.offset + ARROW.stubLen / 2;
    const shaft = new THREE.Mesh(this._arrowShaftGeo(), mat);
    shaft.position.y = ARROW.offset + ARROW.shaftLen / 2;
    const cone = new THREE.Mesh(this._arrowConeGeo(), mat);
    cone.position.y = ARROW.offset + ARROW.shaftLen + ARROW.coneLen / 2;
    const hitStub = new THREE.Mesh(this._arrowHitStubGeo(), this._arrowHitMaterial());
    hitStub.position.y = (ARROW.offset + ARROW.stubLen + 1.5) / 2;
    const hitFull = new THREE.Mesh(this._arrowHitGeo(), this._arrowHitMaterial());
    hitFull.position.y = (ARROW.offset + ARROW.shaftLen + ARROW.coneLen) / 2;
    const childData = Object.assign({ kind: "handle", arrowRoot: group }, userData);
    stub.userData = shaft.userData = cone.userData = hitStub.userData = hitFull.userData = childData;
    stub.renderOrder = shaft.renderOrder = cone.renderOrder = 999;
    group.userData.stubMesh = stub;
    group.userData.shaftMesh = shaft;
    group.userData.coneMesh = cone;
    group.userData.hitStub = hitStub;
    group.userData.hitFull = hitFull;
    group.add(stub);
    group.add(shaft);
    group.add(cone);
    group.add(hitStub);
    group.add(hitFull);
    this._applyArrowPose(group, !compact, compact ? "rest" : "hot");
    this.handleGroup.add(group);
    this.handleMeshes.push(hitStub, hitFull, stub, shaft, cone);
    return group;
  }

  _paintArrow(group, tone) {
    const mat = this._arrowMaterial(tone);
    if (group.userData.stubMesh) group.userData.stubMesh.material = mat;
    if (group.userData.shaftMesh) group.userData.shaftMesh.material = mat;
    if (group.userData.coneMesh) group.userData.coneMesh.material = mat;
  }

  _applyArrowPose(group, expanded, tone) {
    const stub = group.userData.stubMesh;
    const shaft = group.userData.shaftMesh;
    const cone = group.userData.coneMesh;
    const hitStub = group.userData.hitStub;
    const hitFull = group.userData.hitFull;
    if (stub) stub.visible = !expanded;
    if (shaft) shaft.visible = expanded;
    if (cone) cone.visible = expanded;
    if (hitStub) hitStub.visible = !expanded;
    if (hitFull) hitFull.visible = expanded;
    if (tone) this._paintArrow(group, tone);
  }

  _arrowFocusId(obj) {
    if (!obj || !obj.userData) return null;
    if (obj.userData.nodeId != null) return obj.userData.nodeId;
    if (obj.userData.kind === "node" && obj.userData.id != null) return obj.userData.id;
    return null;
  }

  _setArrowFocus(nodeId) {
    if (this._arrowFocus === nodeId) return;
    this._arrowFocus = nodeId;
    for (const child of this.handleGroup.children) {
      if (!child.userData || child.userData.arrowRoot !== true) continue;
      if (!child.userData.arrowCompact) continue;
      const on = nodeId != null && child.userData.nodeId === nodeId;
      this._applyArrowPose(child, on, on ? "hot" : "rest");
    }
    this._needsRender = true;
  }

  _setTubePreview(group) {
    const span = Number(group && group.userData && group.userData.previewSpan);
    const dirArr = group && group.userData && group.userData.dir;
    if (!(span > 0) || !dirArr) {
      this._clearTubePreview();
      return;
    }
    const cs = geometry().connectorSize;
    const r = geometry().tubeRadius;
    const drawLen = Math.max(6, span - cs);
    const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
    if (dir.lengthSq() < 1e-8) { this._clearTubePreview(); return; }
    dir.normalize();
    const colorId = group.userData.previewColor;
    const hex = colorId ? this._look(colorId) : ARROW_TEAL;
    if (!this._tubePreview) {
      const geo = new THREE.CylinderGeometry(r, r, 1, 14);
      const mat = new THREE.MeshStandardMaterial({
        transparent: true, opacity: 0.28, roughness: 0.48, metalness: 0.04,
        depthWrite: false,
      });
      this._tubePreview = new THREE.Mesh(geo, mat);
      this._tubePreview.renderOrder = 998;
      this._keepGeos.add(geo);
      this.scene.add(this._tubePreview);
    }
    this._tubePreview.material.color.set(hex);
    this._tubePreview.scale.set(1, drawLen, 1);
    const mid = new THREE.Vector3().copy(group.position).addScaledVector(dir, cs / 2 + drawLen / 2);
    this._tubePreview.position.copy(mid);
    this._tubePreview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this._tubePreview.visible = true;
    this._needsRender = true;
  }

  _clearTubePreview() {
    if (!this._tubePreview || !this._tubePreview.visible) return;
    this._tubePreview.visible = false;
    this._needsRender = true;
  }

  /**
   * Einen vorhandenen Ankerpunkt verschieben (ohne alle Handles neu zu bauen).
   * Gebraucht fuer Teile, die frei auf einem Rohr sitzen: der Punkt laeuft unter
   * dem Zeiger mit und zeigt, wo das Teil landen wuerde.
   */
  moveHandle(mesh, position) {
    if (!mesh) return;
    if (mesh.position.x === position[0] && mesh.position.y === position[1]
      && mesh.position.z === position[2]) return;
    mesh.position.set(position[0], position[1], position[2]);
    this._needsRender = true;
  }

  /** Ankerpunkt ein- oder ausblenden (bleibt in handleMeshes, nur unsichtbar). */
  setHandleVisible(mesh, visible) {
    if (!mesh || mesh.visible === visible) return;
    mesh.visible = visible;
    this._needsRender = true;
  }

  // Anklickbares Kandidaten-Feld fuer eine Platte (Quad aus 4 Eckpunkten).
  addPanelHandle(corners, userData) {
    this._needsRender = true;
    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    const cz = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
    const local = corners.map((c) => [c[0] - cx, c[1] - cy, c[2] - cz]);
    const tri = [0, 1, 2, 0, 2, 3];
    const pos = new Float32Array(18);
    for (let k = 0; k < 6; k++) {
      const p = local[tri[k]];
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = this._panelHandleMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.userData = Object.assign({ kind: "handle", panelCell: true }, userData);
    mesh.renderOrder = 998;
    this.handleGroup.add(mesh);
    this.handleMeshes.push(mesh);
    const dot = new THREE.Mesh(this._panelDotGeo(), this._panelDotMaterial());
    dot.position.set(cx, cy, cz);
    dot.userData = Object.assign({ kind: "handle", panelCell: true, panelDot: true }, userData);
    dot.renderOrder = 999;
    this.handleGroup.add(dot);
    this.handleMeshes.push(dot);
    return mesh;
  }

  // --- Raycasting ---------------------------------------------------------
  _setMouse(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((clientX - r.left) / r.width) * 2 - 1;
    this._mouse.y = -((clientY - r.top) / r.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    // Orthografisch beginnt der Strahl in der KAMERAEBENE. Gezeichnet wird aber
    // auch, was dahinter liegt -- die vordere Ebene der Kamera steht mit Absicht
    // weit im Ruecken (near = -100000), damit beim Drehen nichts wegschneidet.
    // Teile hinter der Kameraebene waren dadurch zwar zu sehen, aber nicht
    // anklickbar (der Strahl trifft nur, was vor seinem Ursprung liegt). Also
    // den Ursprung um dieselbe Strecke zurueckziehen.
    if (this.camera.isOrthographicCamera) {
      const ray = this._raycaster.ray;
      ray.origin.addScaledVector(ray.direction, this.camera.near);
    }
  }

  /**
   * Welcher der Punkte liegt der Zeiger-Geraden am naechsten?
   * Fehlt, wenn keiner naeher als maxDist (cm) liegt.
   */
  closestOnRay(points, clientX, clientY, maxDist) {
    this._setMouse(clientX, clientY);
    const ray = this._raycaster.ray;
    const v = new THREE.Vector3();
    let best = null, bestD = maxDist;
    for (const p of points) {
      v.set(p.x, p.y, p.z);
      if (this._clipPlane && this._clipPlane.distanceToPoint(v) < 0) continue;
      const d = ray.distanceToPoint(v);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  raycastObjects(clientX, clientY, objects) {
    this._setMouse(clientX, clientY);
    const hits = this._raycaster.intersectObjects(objects, false);
    if (!hits.length) return null;
    // Schnittebene aktiv: weggeschnittene Stellen sind nicht anklickbar. Damit
    // faellt ein komplett verdecktes Teil automatisch raus, ein angeschnittenes
    // bleibt an seiner sichtbaren Haelfte waehlbar.
    const plane = this._clipPlane;
    if (!plane) return hits[0];
    for (const h of hits) if (plane.distanceToPoint(h.point) >= 0) return h;
    return null;
  }

  /**
   * Nutzdaten eines Treffers. Bei instanziert gezeichneten Teilen (Kupplungen,
   * Rohre) traegt nicht das Mesh die id, sondern der Platz in userData.instances
   * -- welcher Platz, sagt intersection.instanceId.
   */
  _hitData(hit) {
    if (!hit) return null;
    const o = hit.object;
    if (o.isInstancedMesh) {
      const list = o.userData && o.userData.instances;
      return (list && hit.instanceId != null && list[hit.instanceId]) || null;
    }
    return o.userData || null;
  }

  /**
   * Weltpunkt unter dem Mauszeiger (Bauteil-Treffer, sonst Bodenebene).
   */
  _pointUnderCursor(clientX, clientY) {
    this._setMouse(clientX, clientY);
    const objects = [...this.pickNodes, ...this.pickTubes, ...this.pickPanels,
                     ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides];
    for (const h of this._raycaster.intersectObjects(objects, false)) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(h.point) < 0) continue;
      return h.point.clone();
    }
    // Daneben getroffen: die Kupplung nehmen, die dem Sehstrahl am naechsten
    // liegt. Ein Drehpunkt auf dem leeren Boden liegt sonst je nach Blickwinkel
    // weit weg vom Modell und das Drehen fuehlt sich wieder aus wie um nichts.
    let best = null, bestD = Infinity;
    for (const v of this._nodePoints) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(v) < 0) continue;
      const d = this._raycaster.ray.distanceToPoint(v);
      if (d < bestD) { bestD = d; best = v.clone(); }
    }
    if (best) return best;
    // Gar kein Modell: auf die Bodenebene ausweichen.
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(ground, p) ? p : null;
  }

  /**
   * Drehen um den Punkt unter dem Mauszeiger -- eigene Implementierung, weil
   * OrbitControls immer um controls.target dreht und die Kamera in update() per
   * lookAt darauf ausrichtet. Ein verschobener target liesse das Bild also
   * springen (der Drehpunkt landet in der Bildmitte).
   *
   * Stattdessen wird das ganze Gespann aus Kamera-Position, Kamera-Ausrichtung
   * UND controls.target als starrer Koerper um den Drehpunkt gedreht. Der Blick
   * bleibt dadurch exakt erhalten (kein Sprung), der Punkt unter dem Zeiger
   * steht still, und weil der target mitwandert, passt anschliessend auch das
   * lookAt von OrbitControls genau zur gesetzten Ausrichtung.
   */
  beginOrbit(clientX, clientY) {
    this._orbitPivot = this._pointUnderCursor(clientX, clientY);
    return !!this._orbitPivot;
  }

  /**
   * Drehen um den aktuellen Bezugspunkt statt um einen Punkt unter dem Zeiger.
   * Fuer das Ziehen am Ansichtswuerfel: dort liegt der Zeiger neben der Szene.
   */
  beginOrbitAtTarget() {
    this._orbitPivot = this.controls ? this.controls.target.clone() : null;
    return !!this._orbitPivot;
  }

  endOrbit() {
    if (!this._orbitPivot) return;
    this._orbitPivot = null;
    this._reanchorTarget();
    this.onCameraChange();
  }

  /**
   * controls.target wieder auf die Modelloberflaeche in Blickmitte setzen.
   *
   * OrbitControls leitet BEIDES vom Abstand Kamera<->target ab: die Schrittweite
   * beim Zoomen (multiplikativ) und die Geschwindigkeit beim Verschieben
   * (proportional). Zoomt man laenger hinein, schrumpft dieser Abstand
   * geometrisch gegen null -- danach bewegt sich beim Schieben fast nichts mehr
   * und die Zoomschritte sind winzig. Der target wandert durch zoomToCursor
   * ausserdem seitlich aus dem Modell heraus.
   *
   * Der neue Punkt liegt auf der BLICKACHSE, nicht am Trefferpunkt: so bleibt
   * das Bild unveraendert (OrbitControls richtet die Kamera per lookAt auf den
   * target aus), nur der Bezugsabstand stimmt wieder.
   */
  _reanchorTarget() {
    if (!this.controls) return false;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = this._pointUnderCursor(r.left + r.width / 2, r.top + r.height / 2);
    if (!p) return false;
    const dist = this.camera.position.distanceTo(p);
    if (!(dist > 0.01)) return false;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.controls.target.copy(this.camera.position).addScaledVector(fwd, dist);
    this.controls.update();
    this._needsRender = true;
    return true;
  }

  get orbiting() { return !!this._orbitPivot; }
  get panning() { return !!this._panning; }

  beginPan() { this._panning = true; }

  endPan() {
    if (!this._panning) return;
    this._panning = false;
    this._reanchorTarget();
    this.onCameraChange();
  }

  /**
   * Bildebene verschieben: Kamera und Ziel wandern gemeinsam, der Blick bleibt.
   * `dx`/`dy` in CSS-Pixeln -- nach rechts ziehen schiebt die Szene mit
   * (wie ein Blatt Papier), nicht gegen den Zug.
   */
  panBy(dx, dy) {
    if (!this.controls) return;
    const cam = this.camera;
    const target = this.controls.target;
    const h = this.container.clientHeight || 1;
    let worldPerPx;
    if (this._projection === "orthographic" && this._orthoCam) {
      worldPerPx = (this._orthoCam.top - this._orthoCam.bottom) / h / (cam.zoom || 1);
    } else {
      const dist = Math.max(1, cam.position.distanceTo(target));
      const fov = ((this._perspCam || cam).fov || 55) * Math.PI / 180;
      worldPerPx = (2 * dist * Math.tan(fov / 2)) / h;
    }
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const move = new THREE.Vector3()
      .addScaledVector(right, -dx * worldPerPx)
      .addScaledVector(up, dy * worldPerPx);
    cam.position.add(move);
    target.add(move);
    this.controls.update();
    this._needsRender = true;
  }

  orbitBy(dx, dy) {
    const P = this._orbitPivot;
    if (!P) return;
    this._needsRender = true;
    const h = this.container.clientHeight || 1;
    const yaw = -2 * Math.PI * dx / h;
    const pitch = -2 * Math.PI * dy / h;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // Waagerecht halten: nur um die Welt-Y-Achse und um die WAAGERECHTE
    // Kamera-Rechtsachse drehen -- so sammelt sich keine Rollung an.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);

    // Neigung so BEGRENZEN, dass der Blick knapp vor dem Pol stehen bleibt --
    // frueher wurde sie ab 84 Grad ganz verworfen, die Draufsicht war damit gar
    // nicht erreichbar. Der Rest von 0,1 Grad haelt OrbitControls (rechnet mit
    // fester Oben-Achse) aus der Entartung heraus und ist nicht zu sehen.
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const phi = Math.asin(clamp1(fwd.y));
    // Vorzeichen: hebt eine positive Neigung um `right` den Blick oder senkt sie ihn?
    const probe = fwd.clone().applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(right, 1e-3));
    const sign = probe.y >= fwd.y ? 1 : -1;
    const phiNext = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, phi + sign * pitch));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, sign * (phiNext - phi));
    const q = qYaw.multiply(qPitch);

    const move = (v) => v.sub(P).applyQuaternion(q).add(P);
    move(cam.position);
    if (this.controls) move(this.controls.target);
    cam.quaternion.premultiply(q);
    cam.updateMatrixWorld();
  }

  /** Kamerazustand zum Sichern (Position, Ziel, Zoom). */
  /**
   * Ansicht in der Form, die der QDF-Export braucht (docs/QDF-FORMAT.md §5.7):
   * Standpunkt und Blickziel in cm plus Oeffnungswinkel und Seitenverhaeltnis.
   * Der Winkel kommt IMMER von der perspektivischen Kamera -- die
   * orthografische hat keinen, ihre Ansicht laesst sich in der Datei nur als
   * Perspektive beschreiben.
   */
  cameraForQdf() {
    if (!this.controls) return null;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fov: this._perspCam.fov,
      aspect: this._perspCam.aspect || 1,
    };
  }

  cameraState() {
    if (!this.controls) return null;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      zoom: this.camera.zoom,
    };
  }

  restoreCameraState(st) {
    this._needsRender = true;
    if (!st || !this.controls || !Array.isArray(st.pos) || !Array.isArray(st.target)) return false;
    this.camera.position.fromArray(st.pos);
    this.controls.target.fromArray(st.target);
    if (typeof st.zoom === "number" && st.zoom > 0) this.camera.zoom = st.zoom;
    this.camera.updateProjectionMatrix();
    this._updateOrthoFrustum();
    this.controls.update();
    return true;
  }

  // --- Schnittebene --------------------------------------------------------
  // Blendet alles vor der Ebene aus (echtes Clipping, keine Objekt-Sichtbarkeit)
  // -- ein Rohr, das die Ebene kreuzt, bleibt zur Haelfte stehen. Geschnitten
  // wird NUR das Modell: die Ebene haengt an den Modell-Materialien
  // (`localClippingEnabled`), nicht global am Renderer, sonst waeren Boden,
  // Gras, Baeume und Himmel gleich mit halbiert.
  // axis: "x" | "y" | "z", value in cm, flip dreht die sichtbare Seite um.
  setClip(axis, value, flip) {
    const n = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const sign = flip ? 1 : -1;
    const normal = new THREE.Vector3(n[0] * sign, n[1] * sign, n[2] * sign);
    const constant = flip ? -value : value;
    if (this._clipPlane) {
      // Dieselbe Ebene weiterdrehen: die Materialien halten sie bereits, nur
      // ihre Lage aendert sich -- kein neues Uebersetzen der Shader noetig.
      this._clipPlane.set(normal, constant);
    } else {
      this._clipPlane = new THREE.Plane(normal, constant);
      this._applyClip();
    }
    this._shadowsDirty();
  }

  clearClip() {
    if (!this._clipPlane) return;
    this._clipPlane = null;
    this._applyClip();
    this._shadowsDirty();
  }

  /**
   * Schnittebene an alle Modell-Materialien haengen (bzw. wieder abnehmen).
   * Die Liste ist bei jedem Wechsel eine NEUE Anordnung: three uebersetzt den
   * Shader nur neu, wenn sich die Anzahl der Ebenen aendert, und daran haengt
   * die Erkennung "schon gesetzt" (Vergleich der Anordnung selbst).
   */
  _applyClip() {
    const want = this._clipPlane ? 1 : 0;
    // Anordnung nur beim Wechsel neu bauen: sonst haetten nach jedem Zeichnen
    // ALLE Materialien eine fremde Anordnung und wuerden neu uebersetzt.
    if (!this._clipList || this._clipList.length !== want) {
      this._clipList = this._clipPlane ? [this._clipPlane] : [];
    }
    for (const key of Object.keys(this._materials)) this._clipMaterial(this._materials[key]);
    for (const group of [this.buildGroup, this.handleGroup, this.labelGroup, this._hoverPartGroup]) {
      group.traverse((o) => { if (o.material) this._clipMaterial(o.material); });
    }
  }

  // Ein Material (oder eine Materialliste) auf den aktuellen Stand bringen.
  // `clipShadows`, damit Weggeschnittenes auch keinen Schatten mehr wirft.
  _clipMaterial(mat) {
    const planes = this._clipList || [];
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m || m.clippingPlanes === planes) continue;
      m.clippingPlanes = planes;
      m.clipShadows = true;
      m.needsUpdate = true;
    }
  }

  get clipping() { return !!this._clipPlane; }

  pickHandle(clientX, clientY) {
    const hit = this.raycastObjects(clientX, clientY, this.handleMeshes.filter((h) => h.visible));
    // Verdeckte Ankerpunkte gelten nicht: liegt ein Bauteil deutlich davor,
    // sieht man den Punkt nicht und darf dort auch nichts setzen -- sonst baut
    // man durch das Modell hindurch. HANDLE_CLEAR Zentimeter Spiel, weil viele
    // Punkte bewusst IN ihrem Teil liegen (Ankerpunkt auf der Rohrachse, Punkt
    // dicht an der Kupplung).
    if (hit) {
      // Platten-Felder liegen zwischen den Rohren -- eine Kante darf den Klick
      // nicht wegnehmen, sonst kaeme man an die Flaeche nicht heran.
      if (!(hit.object.userData && hit.object.userData.panelCell)) {
        const davor = this.raycastObjects(clientX, clientY,
          [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
           ...this.pickTextiles, ...this.pickSlides, ...this.pickFittings]);
        if (davor && davor.distance < hit.distance - HANDLE_CLEAR) return null;
      }
    }
    // distance: Abstand zur Kamera -- damit laesst sich ein Griff gegen ein
    // Bauteil abwaegen, das davor liegt.
    return hit ? { object: hit.object, data: hit.object.userData, distance: hit.distance } : null;
  }

  /**
   * Erster Treffer entlang des Strahls, dessen id in `ids` steht -- auch wenn
   * etwas davor liegt. Gebraucht im Platten-Modus: die hervorgehobenen
   * Gegenrohre scheinen durch die zurueckgeblendeten Teile hindurch und sollen
   * sich auch dann anklicken lassen.
   */
  pickAmong(clientX, clientY, ids) {
    if (!ids || !ids.size) return null;
    this._setMouse(clientX, clientY);
    const objs = [...this.pickTubes, ...this.pickNodes, ...this.pickPanels,
                  ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides,
                  ...this.pickFittings];
    for (const hit of this._raycaster.intersectObjects(objs, false)) {
      if (this._clipPlane && this._clipPlane.distanceToPoint(hit.point) < 0) continue;
      const data = this._hitData(hit);
      if (data && ids.has(data.id)) return { object: hit.object, data, point: hit.point, distance: hit.distance };
    }
    return null;
  }

  // Nur Rohre treffen -- fuer Teile, die auf einem Rohr sitzen und deshalb
  // durch schon gesetzte Anbauteile hindurch zielen muessen.
  pickTube(clientX, clientY) {
    const hit = this.raycastObjects(clientX, clientY, this.pickTubes);
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance, instanceId: hit.instanceId } : null;
  }

  pickBuild(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
       ...this.pickTextiles, ...this.pickFittings]
    );
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance, instanceId: hit.instanceId } : null;
  }

  // Wie pickBuild, aber inkl. Rutschen/Dächer (nur fuers Loeschen relevant; im
  // Bau-Modus sollen die dekorativen Platzhalter keine Klicks abfangen).
  pickForDelete(clientX, clientY) {
    const hit = this.raycastObjects(
      clientX, clientY,
      [...this.pickNodes, ...this.pickTubes, ...this.pickPanels, ...this.pickClamps,
       ...this.pickTextiles, ...this.pickSlides, ...this.pickFittings, ...this.pickReinforce]
    );
    const data = this._hitData(hit);
    return data ? { object: hit.object, data, point: hit.point, distance: hit.distance, instanceId: hit.instanceId } : null;
  }

  // --- Auswahl-Rechteck (Cursor-Modus) ------------------------------------

  showSelectBox(x0, y0, x1, y1) {
    this._needsRender = true;
    if (!this._selectBox) {
      this._selectBox = document.createElement("div");
      this._selectBox.className = "select-box";
      this.container.appendChild(this._selectBox);
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    const b = this._selectBox;
    b.hidden = false;
    b.style.left = (Math.min(x0, x1) - r.left) + "px";
    b.style.top = (Math.min(y0, y1) - r.top) + "px";
    b.style.width = Math.abs(x1 - x0) + "px";
    b.style.height = Math.abs(y1 - y0) + "px";
  }

  hideSelectBox() {
    this._needsRender = true;
    if (this._selectBox) this._selectBox.hidden = true;
  }

  /**
   * Alle waehlbaren Teile, deren Mittelpunkt im Bildschirm-Rechteck liegt.
   * Der Mittelpunkt entscheidet (nicht die Huelle): ein langes Rohr, das nur
   * durch das Rechteck streift, gilt damit als nicht enthalten.
   * Liefert id -> kind, passend zu builder.selection.
   */
  pickInRect(x0, y0, x1, y1) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out = new Map();
    const v = new THREE.Vector3();
    this._forEachPickable((d, center) => {
      if (out.has(d.id)) return;
      v.copy(center).project(this.camera);
      if (v.z > 1) return;   // hinter der Kamera
      const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.set(d.id, d.kind);
    });
    return out;
  }

  /** Alles, was gerade waehlbar ist (Strg+A). Liefert id -> kind. */
  selectableParts() {
    const out = new Map();
    this._forEachPickable((d) => { if (!out.has(d.id)) out.set(d.id, d.kind); });
    return out;
  }

  /**
   * Ruft cb(data, weltMittelpunkt) fuer jedes waehlbare Teil auf. Der Mittel-
   * punkt entscheidet (nicht die Huelle): ein langes Rohr, das nur durch das
   * Rechteck streift, gilt damit als nicht enthalten. Weggeschnittene Teile
   * (Schnittebene) bleiben aussen vor -- sie sind nicht sichtbar und sollen
   * deshalb auch per Rechteck oder Strg+A nicht in die Auswahl geraten.
   */
  _forEachPickable(cb) {
    const c = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    this.scene.updateMatrixWorld();
    const meshes = [...this.pickNodes, ...this.pickTubes, ...this.pickPanels,
                    ...this.pickClamps, ...this.pickTextiles, ...this.pickSlides,
                    ...this.pickFittings];
    const emit = (m, world, d) => {
      if (!d || !d.id) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.geometry.boundingBox.getCenter(c).applyMatrix4(world);
      if (this._clipPlane && this._clipPlane.distanceToPoint(c) < 0) return;
      cb(d, c);
    };
    for (const m of meshes) {
      if (m.isInstancedMesh) {
        const list = (m.userData && m.userData.instances) || [];
        for (let i = 0; i < list.length; i++) {
          if (!list[i]) continue;
          m.getMatrixAt(i, mat);
          emit(m, mat.premultiply(m.matrixWorld), list[i]);
        }
      } else {
        emit(m, m.matrixWorld, m.userData);
      }
    }
  }

  _handleVisual(object) {
    if (!object) return null;
    if (object.userData && object.userData.arrowRoot === true) return object;
    if (object.parent && object.parent.userData && object.parent.userData.arrowRoot) {
      return object.parent;
    }
    return object;
  }

  setHover(object, focusNodeId) {
    const root = this._handleVisual(object);
    const focus = focusNodeId !== undefined ? focusNodeId : this._arrowFocusId(root);
    if (this._hover === root && this._arrowFocus === focus) return;
    this._needsRender = true;
    if (this._hover && this._hover.userData && this._hover.userData.kind === "handle") {
      if (this._hover.userData.panelCell && !this._hover.userData.panelDot) {
        this._hover.material = this._panelHandleMaterial(false);
      } else {
        this._hover.scale.setScalar(1);
        if (this._hover.userData.arrowRoot) {
          const on = focus != null && this._hover.userData.nodeId === focus;
          this._paintArrow(this._hover, on || !this._hover.userData.arrowCompact ? "hot" : "rest");
        }
      }
    }
    this._setArrowFocus(focus);
    this._hover = root;
    if (root && root.userData && root.userData.kind === "handle") {
      if (root.userData.panelCell && !root.userData.panelDot) {
        root.material = this._panelHandleMaterial(true);
        this._clearTubePreview();
      } else {
        const isArrow = !!root.userData.arrowRoot;
        root.scale.setScalar(isArrow ? 1.12 : root.userData.panelDot ? 1.4 : 1.6);
        if (isArrow) {
          this._paintArrow(root, "focus");
          this._setTubePreview(root);
        } else {
          this._clearTubePreview();
        }
      }
    } else {
      this._clearTubePreview();
    }
    if (!this._hoverPartId) this.container.style.cursor = root ? "pointer" : "default";
  }

  /**
   * Auswahl / Loeschen: das Teil unter dem Zeiger orange hervorheben.
   * pick = pickForDelete()-Treffer oder null. mode "delete" setzt das X.
   */
  setHoverPart(pick, mode, clientX, clientY, extraIds) {
    const id = pick && pick.data && pick.data.id != null ? pick.data.id : null;
    const extra = extraIds && extraIds.length ? extraIds : null;
    const extraKey = extra ? extra.join(",") : "";
    if (id !== this._hoverPartId || extraKey !== this._hoverPartExtraKey) {
      this._hoverPartId = id;
      this._hoverPartExtra = extra;
      this._hoverPartExtraKey = extraKey;
      this._rebuildHoverOverlay(id, extra);
      this._needsRender = true;
    }
    this._hoverPartMode = mode || null;
    if (mode === "delete" && id != null) {
      this.setCursor("delete-x");
      this._setDeleteX(true, clientX, clientY);
    } else {
      this._setDeleteX(false);
      if (id != null) this.setCursor("pointer");
      else this.setCursor("default");
    }
  }

  _clearHoverOverlay() {
    const g = this._hoverPartGroup;
    if (!g) return;
    while (g.children.length) g.remove(g.children[0]);
    if (this._hoverPartId != null) this._needsRender = true;
    this._hoverPartId = null;
    this._hoverPartExtra = null;
    this._hoverPartExtraKey = "";
    this._hoverPartMode = null;
    this.container.classList.remove("qb-cursor-delete");
    this._setDeleteX(false);
  }

  _rebuildHoverOverlay(id, extraIds) {
    const g = this._hoverPartGroup;
    if (!g) return;
    while (g.children.length) g.remove(g.children[0]);
    if (id == null) return;
    const ids = new Set([id, ...(extraIds || [])]);
    const tmp = this._hoverMat;
    const add = (geo, mat, world) => {
      if (!geo || !mat) return;
      const m = new THREE.Mesh(geo, this._hoverMaterial(mat));
      m.matrix.copy(world);
      m.matrixAutoUpdate = false;
      m.raycast = () => {};
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 8;
      g.add(m);
    };
    this.buildGroup.traverse((o) => {
      if (o.isInstancedMesh) {
        const list = (o.userData && o.userData.instances) || [];
        for (let i = 0; i < list.length; i++) {
          if (!list[i] || !ids.has(list[i].id)) continue;
          o.getMatrixAt(i, tmp);
          add(o.geometry, o.material, tmp.clone().premultiply(o.matrixWorld));
        }
        return;
      }
      if (o.isMesh && o.userData && ids.has(o.userData.id) && o.userData.role !== "water") {
        add(o.geometry, o.material, o.matrixWorld);
      }
    });
    this._applyClip();
  }

  _disposeGroup(group) {
    const keep = this._keepGeos;
    for (const g of [this._connGeo, this._c45Geo, this._c45StubGeo])
      if (g) keep.add(g);
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      // Rekursiv (verschachtelte Gruppen, z.B. Rutschen) Geometrien freigeben.
      c.traverse((o) => {
        // InstancedMesh haelt eigene Attribut-Puffer (Matrizen) auf der GPU --
        // die gibt nur dispose() frei, nicht das Wegwerfen der Geometrie.
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
      });
      group.remove(c);
    }
  }

  _makeGrassTexture(baseHex) {
    const S = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    const base = baseHex || this._tune?.grass || "#7A9B6C";
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const patches = [shadeHex(base, -14), shadeHex(base, 10), shadeHex(base, -22), shadeHex(base, 6)];
    ctx.globalAlpha = 0.26;
    for (let i = 0; i < 32; i++) {
      const x = rng() * S, y = rng() * S, r = 28 + rng() * 56;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, patches[i % patches.length]);
      g.addColorStop(1, hexRgba(shadeHex(base, -18), 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 380; i++) {
      const x = rng() * S, y = rng() * S;
      ctx.fillStyle = i % 2 ? shadeHex(base, 14) : shadeHex(base, -16);
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(GROUND_AREA / GRASS_TILE, GROUND_AREA / GRASS_TILE);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // 草地：灰绿底 + 淡颗粒。阴影仍落在地面上。
  _buildGrass(opts = {}) {
    const area = opts.area || GROUND_AREA;
    const env = new THREE.Group();
    env.name = "grass-env";

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(area, area),
      new THREE.MeshLambertMaterial({ map: this._makeGrassTexture() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -GROUND_DROP - 0.4;
    ground.receiveShadow = true;
    env.add(ground);

    this.scene.add(env);
    this._grassGround = ground;
    this._grassEnv  = env;
    this._grassMesh = null;   // keine Halm-Instanzen → _updateGrassMask ist no-op
    this._grassXZ   = null;
    this._grassCull = null;
    this._grassMat  = null;
    this._grassArea = area;
    this._grassClearH = 32;
  }

  // Halme dort ausblenden, wo bodennahe Bauteile (y <= _grassClearH) stehen.
  // Pro renderModel() neu: grobes XZ-Belegungsraster (Uint8) aus Rohren/Knoten/
  // Platten/Rutschen, dann je Halm aCull=1, wenn seine Rasterzelle belegt ist.
  _updateGrassMask(model) {
    if (!this._grassMesh || !this._grassXZ || !model) return;
    const area = this._grassArea, half = area / 2, H = this._grassClearH;
    const CELL = 4;                          // cm pro Rasterzelle
    const N = Math.ceil(area / CELL);
    const occ = new Uint8Array(N * N);
    const g = geometry();
    const tubeR = g.tubeRadius + 3;
    const nodeR = Math.max(g.connectorSize / 2, g.tubeRadius) + 3;

    const markDisc = (x, z, r) => {
      const r2 = r * r;
      let cx0 = Math.floor((x - r + half) / CELL), cx1 = Math.floor((x + r + half) / CELL);
      let cz0 = Math.floor((z - r + half) / CELL), cz1 = Math.floor((z + r + half) / CELL);
      if (cx0 < 0) cx0 = 0; if (cz0 < 0) cz0 = 0;
      if (cx1 >= N) cx1 = N - 1; if (cz1 >= N) cz1 = N - 1;
      for (let cz = cz0; cz <= cz1; cz++) {
        const dz = (cz + 0.5) * CELL - half - z;
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = (cx + 0.5) * CELL - half - x;
          if (dx * dx + dz * dz <= r2) occ[cz * N + cx] = 1;
        }
      }
    };
    // Rohr: 3D-Strecke abtasten, nur wo y <= H markieren (Bodenrohr -> ganze
    // Strecke; Stuetze -> nur der Fuss; erhoehtes Rohr -> nichts).
    const markTube = (a, b, r) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (a.y + (b.y - a.y) * t > H) continue;
        markDisc(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r);
      }
    };

    for (const tb of model.tubes.values()) {
      const a = model.nodes.get(tb.a), b = model.nodes.get(tb.b);
      if (!a || !b || Math.min(a.y, b.y) > H) continue;
      markTube(a, b, tubeR);
    }
    for (const n of model.nodes.values()) {
      if (n.y <= H) markDisc(n.x, n.z, nodeR);
    }
    // Platten/Netze: nur waagerechte Bodenplatten flaechig (Wandplatten decken
    // ihre Rahmen-Rohre/Knoten schon ab).
    const fillPanels = (coll) => {
      if (!coll) return;
      for (const p of coll.values()) {
        const ns = p.nodes.map((id) => model.nodes.get(id)).filter(Boolean);
        if (ns.length < 3) continue;
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const v of ns) {
          if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
          if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
          if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
        }
        if (minY > H || maxY - minY > 8) continue; // nicht bodennah / nicht flach
        for (let z = minZ; z <= maxZ; z += CELL)
          for (let x = minX; x <= maxX; x += CELL) markDisc(x, z, CELL);
      }
    };
    fillPanels(model.panels);
    fillPanels(model.textiles);
    // Rutschen: tatsächliche Mesh-Positionen aus buildGroup verwenden (QDF-
    // Koordinaten stimmen nicht mit den gerenderten Positionen überein, da Bézier-
    // Versatz + _slideEndConnectPoint das Endstück verschiebt).
    this.buildGroup.traverse(child => {
      if (!child.isMesh || child.userData.kind !== "slide") return;
      const wy = child.position.y;
      if (wy > H) return;
      markDisc(child.position.x, child.position.z, 25);
    });

    // Je Halm: Rasterzelle belegt -> wegcullen.
    const xz = this._grassXZ, arr = this._grassCull.array, m = arr.length;
    for (let i = 0; i < m; i++) {
      const cx = Math.floor((xz[i * 2] + half) / CELL);
      const cz = Math.floor((xz[i * 2 + 1] + half) / CELL);
      arr[i] = (cx >= 0 && cx < N && cz >= 0 && cz < N && occ[cz * N + cx]) ? 1 : 0;
    }
    this._grassCull.needsUpdate = true;
  }

  // Gradient-Himmel: große Kugel (BackSide) mit GLSL-Verlauf Horizont → Zenit.
  _buildSky() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying float vY;
        void main() {
          float t = clamp(vY * 2.5 + 0.10, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, t * t), 1.0);
        }`,
      uniforms: {
        uHorizon: { value: new THREE.Color(SCENE_SKY_HORIZON) },
        uZenith:  { value: new THREE.Color(SCENE_SKY_ZENITH) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest:  false,
    });
    this._skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4800, 16, 10), mat);
    this._skyMesh.renderOrder = -1;
    this._skyMat = mat;
    this.scene.add(this._skyMesh);
    // Hintergrundfarbe passend zum Himmel (Szene) bzw. zum Farbschema setzen --
    // sonst blitzt bis zum ersten setScene() die falsche Farbe auf.
    this._applyBackground();
  }

  // Prozedurale Bäume auf der Wiese, im Ring HINTER dem Raster (TREE_RING).
  // Frueher standen sie naeher an der Mitte und ragten in grosse Modelle
  // hinein; seit das Raster gewachsen ist, richten sie sich nach dessen Kante.
  // Geometrien und Materialien werden einmalig geteilt; per-Baum nur Transform.
  _buildTrees() {
    const trunkMat  = new THREE.MeshLambertMaterial({ color: SCENE_TRUNK });
    const crownMatA = new THREE.MeshLambertMaterial({ color: SCENE_CROWN_A });
    const crownMatB = new THREE.MeshLambertMaterial({ color: SCENE_CROWN_B });
    const crownMatC = new THREE.MeshLambertMaterial({ color: SCENE_CROWN_C });
    const trunkGeo  = new THREE.CylinderGeometry(8, 13, 100, 7);
    const crownGeoA = new THREE.SphereGeometry(120, 8, 6);
    const crownGeoB = new THREE.SphereGeometry(100, 7, 5);
    const crownGeoC = new THREE.SphereGeometry(85,  7, 5);

    const group = new THREE.Group();
    this._treeNodes = [];

    // Deterministischer LCG-RNG (reproduzierbare Positionen je Session).
    let seed = 137;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

    // Die Zahl richtet sich nach dem Ring: er ist groesser als die frueheren
    // 620-780 cm, bei 60 Stueck stuenden sie vereinzelt in der Landschaft.
    const rand = GROUND_AREA / 2 - 10;
    for (let i = 0; i < 72; i++) {
      const r = TREE_RING[0] + rng() * (TREE_RING[1] - TREE_RING[0]);
      const θ = rng() * Math.PI * 2;
      const tx = Math.cos(θ) * r, tz = Math.sin(θ) * r;
      if (Math.abs(tx) > rand || Math.abs(tz) > rand) continue;

      const sc = 0.65 + rng() * 0.7;
      const ox2 = (rng() - 0.5) * 56, oz2 = (rng() - 0.5) * 56;
      const ox3 = (rng() - 0.5) * 46, oz3 = (rng() - 0.5) * 46;

      const tg = new THREE.Group();
      tg.position.set(tx, 0, tz);
      tg.scale.setScalar(sc);
      tg.rotation.y = rng() * Math.PI * 2;

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 50; trunk.castShadow = true; tg.add(trunk);

      const c1 = new THREE.Mesh(crownGeoA, crownMatA);
      c1.position.set(0, 175, 0); c1.castShadow = true; tg.add(c1);

      const c2 = new THREE.Mesh(crownGeoB, crownMatB);
      c2.position.set(ox2, 210, oz2); c2.castShadow = true; tg.add(c2);

      const c3 = new THREE.Mesh(crownGeoC, crownMatC);
      c3.position.set(ox3, 195, oz3); c3.castShadow = true; tg.add(c3);

      group.add(tg);
      this._treeNodes.push({ group: tg, x: tx, z: tz });
    }

    this.scene.add(group);
    this._treeGroup = group;
    this._trunkMat = trunkMat;
    this._crownMatA = crownMatA;
    this._crownMatB = crownMatB;
    this._crownMatC = crownMatC;

    this._buildBushes();
  }

  _buildBushes() {
    const bushGeo = new THREE.SphereGeometry(30, 8, 6);
    const bushMat = new THREE.MeshLambertMaterial({ color: SCENE_BUSH });

    const group = new THREE.Group();
    this._bushNodes = [];

    let seed = 138;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

    for (let i = 0; i < 40; i++) {
      const r = BUSH_RING[0] + rng() * (BUSH_RING[1] - BUSH_RING[0]);
      const θ = rng() * Math.PI * 2;
      const tx = Math.cos(θ) * r, tz = Math.sin(θ) * r;
      if (Math.abs(tx) > GROUND_AREA / 2 - 10 || Math.abs(tz) > GROUND_AREA / 2 - 10) continue;

      const sc = 0.5 + rng() * 0.5;

      const tg = new THREE.Group();
      tg.position.set(tx, 0, tz);
      tg.scale.setScalar(sc);
      tg.rotation.y = rng() * Math.PI * 2;

      const bush = new THREE.Mesh(bushGeo, bushMat);
      bush.position.y = 15;
      bush.castShadow = true;
      tg.add(bush);

      group.add(tg);
      this._bushNodes.push({ group: tg, x: tx, z: tz });
    }

    this.scene.add(group);
    this._bushGroup = group;
    this._bushMat = bushMat;
  }

  // Bäume ausblenden, die zu nah an einem Modellknoten stehen.
  // Prüft Abstand zu Modellknoten und setzt t.blocked. Die tatsächliche
  // Sichtbarkeit wird pro Frame von _updateTreeCamera() kombiniert.
  // Bewuchs ausblenden, der dem Bauwerk zu nahe kommt. Zwei Kriterien:
  // direkt an einer Kupplung (dichter Bewuchs im Geruest) und innerhalb des
  // Grundrisses plus Sicherheitsabstand -- Letzteres faengt grosse Modelle ab,
  // die sonst bis in den Baumring reichen wuerden. Die Baumpositionen selbst
  // stehen fest (einmal gestreut), nur die Sichtbarkeit wird nachgefuehrt.
  _updateTrees(model) {
    if (!this._treeNodes) return;
    const nodes = model && model.nodes ? [...model.nodes.values()] : [];
    const CLEAR2 = 90 * 90;
    const KEEP_OUT = 250;   // cm Abstand zum Grundriss
    // Grundriss-Radius um den Ursprung (waagerecht).
    let reach = 0;
    for (const n of nodes) reach = Math.max(reach, Math.hypot(n.x, n.z));
    const keepOut2 = (reach + KEEP_OUT) * (reach + KEEP_OUT);
    const markBlocked = (list) => {
      for (const t of list) {
        if (t.x * t.x + t.z * t.z < keepOut2) { t.blocked = true; continue; }
        let close = false;
        for (const n of nodes) {
          const dx = t.x - n.x, dz = t.z - n.z;
          if (dx * dx + dz * dz < CLEAR2) { close = true; break; }
        }
        t.blocked = close;
      }
    };
    markBlocked(this._treeNodes);
    if (this._bushNodes) markBlocked(this._bushNodes);
  }

  // Pro Frame: Bäume + Büsche im 90°-Sektor hinter der Kamera ausblenden (270° sichtbar).
  // Kombiniert mit t.blocked (Abstand zum Gerüst) und treeGroup/bushGroup.visible (Szene).
  _updateTreeCamera() {
    const tx = this.controls.target.x, tz = this.controls.target.z;
    const cx = this.camera.position.x - tx, cz = this.camera.position.z - tz;
    const cl = Math.hypot(cx, cz);

    // Liefert true, wenn sich mindestens eine Sichtbarkeit geaendert hat --
    // nur dann braucht es ein neues Bild.
    let changed = false;
    const setVis = (t, v) => { if (t.group.visible !== v) { t.group.visible = v; changed = true; } };
    const updateNodes = (nodes, groupVisible) => {
      if (!nodes || !groupVisible) return;
      if (cl < 1) { nodes.forEach(t => { if (!t.blocked) setVis(t, true); }); return; }
      const cnx = cx / cl, cnz = cz / cl;
      for (const t of nodes) {
        if (t.blocked) { setVis(t, false); continue; }
        const dx = t.x - tx, dz = t.z - tz;
        const dl = Math.hypot(dx, dz);
        if (dl < 1) { setVis(t, true); continue; }
        // dot > cos(45°)=0.707 → Objekt im 90°-Kamera-Sektor → ausblenden.
        setVis(t, (dx / dl) * cnx + (dz / dl) * cnz < 0.707);
      }
    };

    updateNodes(this._treeNodes, this._treeGroup?.visible);
    updateNodes(this._bushNodes, this._bushGroup?.visible);
    return changed;
  }

  // Szene komplett ein-/ausblenden (Gras, Bäume, Himmel, Licht, Schatten).
  // Ersetzt setGrass(); wird weiterhin von ui.js als scene.setScene(on) aufgerufen.
  setScene(on) {
    this._shadowsDirty();
    const v = !!on;
    this._sceneOn = v;
    if (this._grassEnv)  this._grassEnv.visible  = v;
    if (this._skyMesh)   this._skyMesh.visible    = v;
    if (this._treeGroup) this._treeGroup.visible  = v;
    if (this._bushGroup) this._bushGroup.visible  = v; // Büsche: nur im Szene-Modus
    // Direktionales Licht: brennt AUCH im Normal-Modus, denn es modelliert die
    // Bauteile -- ohne es steht alles flach in einer Farbe da und Vorder- und
    // Rueckseite sind nicht auseinanderzuhalten. GEWORFENE Schatten gibt es
    // dort aber nicht: sie legen sich ueber die Nachbarteile und machen genau
    // die Unterscheidung wieder kaputt, um die es geht. Nur die Szene wirft.
    if (this._dirLight) {
      this._dirLight.visible    = true;
      this._dirLight.castShadow = v;
      this._dirLight.intensity  = v ? (this._tune?.dirIntensity ?? 1.42) : 1.05;
      this._dirLight.color.set(v ? 0xfff8e7 : 0xffffff);
    }
    if (this._fillLight) this._fillLight.intensity = v ? 0.28 : 0.5;
    if (this._rimLight) this._rimLight.intensity = v ? 0.18 : 0.28;
    if (this._hemiLight) {
      this._hemiLight.intensity = v ? (this._tune?.hemiIntensity ?? 1.22) : 1.15;
      this._hemiLight.color.set(v ? 0xdef2ff : 0xffffff);
      this._hemiLight.groundColor.set(v ? this._lookHex(this._tune?.hemiGround || "#6A8258") : 0xc4a078);
    }
    this._applyBackground();
    this._applyGrid();
  }

  /**
   * Farbschema der Oberflaeche uebernehmen (hell/dunkel). Betroffen sind nur
   * Hintergrund, Bodenraster und das Ausblassen im Aufbaumodus -- die
   * Teilefarben sind Produktfarben und bleiben in beiden Schemata gleich, und
   * die Szene-Ansicht bringt ihren eigenen Himmel mit.
   */
  setTheme(dark) {
    const v = !!dark;
    if (v === this._dark) return false;
    this._dark = v;
    this._applyBackground();
    this._applyGrid();
    this._applyViewCubeTheme();
    this._shadowsDirty();
    return true;
  }

  /** Ansichtswuerfel mitfaerben: Kanten direkt, Flaechen ueber die Textur. */
  _applyViewCubeTheme() {
    if (!this._cubeEdgeMat) return;
    this._cubeEdgeMat.color.set(this._dark ? CUBE_EDGE_DARK : CUBE_EDGE_LIGHT);
    if (this._cubeLabels) this.setViewCubeLabels(this._cubeLabels);
    this._needsRender = true;
  }

  /** Hintergrund: Szene an -> Horizont-Blau, sonst nach Farbschema. */
  _applyBackground() {
    if (!this.scene.background) return;
    const horizon = this._lookHex(this._tune?.skyHorizon || SCENE_SKY_HORIZON);
    const blank = this._lookHex(this._tune?.blank || BG_LIGHT);
    this.scene.background.set(
      this._sceneOn ? horizon : (this._dark ? BG_DARK : blank));
    this._needsRender = true;
  }

  _look(colorId) {
    return displayHex(colorId, this._grade);
  }

  _lookHex(hex) {
    return gradeHex(this._asHex(hex), this._grade);
  }

  _asHex(c) {
    if (typeof c === "number") {
      return "#" + (c >>> 0).toString(16).padStart(6, "0").toUpperCase();
    }
    return String(c || "#888888");
  }

  /** 调试调色：风景 + 已缓存的管/板材质立刻跟上。 */
  applyColorTune(tune) {
    if (!tune) return;
    if (tune.grade) this._grade = { ...DEFAULT_GRADE, ...tune.grade };
    if (tune.scene) this._tune = { ...this._tune, ...tune.scene };
    this._paintSceneTune();
    this._applyFrameTune();
  }

  _paintSceneTune() {
    const s = this._tune || {};
    const look = (hex) => this._lookHex(hex);
    if (this._skyMat?.uniforms) {
      if (s.skyHorizon) this._skyMat.uniforms.uHorizon.value.set(look(s.skyHorizon));
      if (s.skyZenith) this._skyMat.uniforms.uZenith.value.set(look(s.skyZenith));
    }
    if (this._grassGround && s.grass) {
      const grassLook = look(s.grass);
      if (grassLook !== this._grassLook) {
        const old = this._grassGround.material.map;
        this._grassGround.material.map = this._makeGrassTexture(grassLook);
        this._grassGround.material.needsUpdate = true;
        if (old) old.dispose();
        this._grassLook = grassLook;
      }
    }
    if (s.trunk && this._trunkMat) this._trunkMat.color.set(look(s.trunk));
    if (s.crownA && this._crownMatA) this._crownMatA.color.set(look(s.crownA));
    if (s.crownB && this._crownMatB) this._crownMatB.color.set(look(s.crownB));
    if (s.crownC && this._crownMatC) this._crownMatC.color.set(look(s.crownC));
    if (s.bush && this._bushMat) this._bushMat.color.set(look(s.bush));
    if (this._sceneOn) {
      if (this._dirLight && s.dirIntensity != null) this._dirLight.intensity = s.dirIntensity;
      if (this._hemiLight) {
        if (s.hemiIntensity != null) this._hemiLight.intensity = s.hemiIntensity;
        if (s.hemiGround) this._hemiLight.groundColor.set(look(s.hemiGround));
      }
    }
    this._applyBackground();
    this._needsRender = true;
  }

  _applyFrameTune() {
    const mats = this._materials || {};
    for (const [key, mat] of Object.entries(mats)) {
      if (!mat?.color) continue;
      if (mat.userData?.tuneColorId) {
        mat.color.set(this._look(mat.userData.tuneColorId));
        mat.needsUpdate = true;
        continue;
      }
      if (mat.userData?.tuneHex) {
        mat.color.set(this._lookHex(mat.userData.tuneHex));
        mat.needsUpdate = true;
        continue;
      }
      const kind = key.split(":")[0];
      if (kind !== "tube" && kind !== "panel" && kind !== "tubehl") continue;
      const colorId = key.split(":")[1];
      if (!colorId) continue;
      mat.color.set(this._look(colorId));
      mat.needsUpdate = true;
    }
    this._needsRender = true;
  }

  /**
   * Bodenraster (neu) aufbauen. Der GridHelper baeckt seine Farben in die
   * Geometrie, also gibt es zum Umfaerben nur den Austausch. Ueber dem Gras
   * bleiben die hellen Linien: die Szene ist immer Tag.
   */
  /**
   * Zellweite des Bodenrasters setzen (cm). Es zeigt damit dasselbe Raster, in
   * dem sich eine Auswahl verschieben laesst.
   */
  setGridCell(cm) {
    const wert = Number(cm);
    if (!(wert > 0) || wert === this._gridCell) return false;
    this._gridCell = wert;
    this._applyGrid();
    return true;
  }

  _applyGrid() {
    const [major, minor] = (this._dark && !this._sceneOn) ? GRID_DARK : GRID_LIGHT;
    if (this._grid) {
      this.scene.remove(this._grid);
      this._grid.geometry.dispose();
      this._grid.material.dispose();
    }
    const zelle = this._gridCell || GRID_CELL;
    const grid = new THREE.GridHelper(GRID_SIZE, Math.round(GRID_SIZE / zelle), major, minor);
    grid.position.y = -GROUND_DROP;
    this.scene.add(grid);
    this._grid = grid;
    this._needsRender = true;
  }

  _clearRoomOverlay() {
    if (!this._roomGroup) return;
    for (let i = this._roomGroup.children.length - 1; i >= 0; i--) {
      const c = this._roomGroup.children[i];
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && m.map) m.map.dispose();
            if (m) m.dispose();
          }
        }
      });
      this._roomGroup.remove(c);
    }
  }

  _addDimLine(a, b, color, label) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]),
      new THREE.Vector3(b[0], b[1], b[2]),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color, depthTest: false, transparent: true, opacity: 0.95,
    }));
    line.renderOrder = 25;
    line.raycast = () => {};
    this._roomGroup.add(line);
    const sprite = this._makeLabelSprite(label, false, null);
    sprite.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    sprite.raycast = () => {};
    this._roomGroup.add(sprite);
  }

  /**
   * 房间边界盒子 + 模型外包尺寸线。不进 buildGroup，刷新模型时不会被清掉，
   * 也不挂到拾取列表上。盒子 Y 从地面 0 到 h；XZ 以模型包围盒中心对齐。
   */
  setRoomOverlay(opts) {
    const visible = !!(opts && opts.visible);
    const showExtents = !!(opts && opts.showExtents);
    const w = Number(opts && opts.w) || 0;
    const d = Number(opts && opts.d) || 0;
    const h = Number(opts && opts.h) || 0;
    const b = opts && opts.bounds;
    const sig = JSON.stringify({
      visible, showExtents, w, d, h,
      min: b && b.min, max: b && b.max,
    });
    if (sig === this._roomSig) return;
    this._roomSig = sig;
    this._clearRoomOverlay();
    if (!this._roomGroup) return;

    if (visible && w > 0 && d > 0 && h > 0) {
      let cx = 0, cz = 0;
      if (b && b.min && b.max) {
        cx = (b.min[0] + b.max[0]) / 2;
        cz = (b.min[2] + b.max[2]) / 2;
      }
      const geo = new THREE.BoxGeometry(w, h, d);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x38bdf8, transparent: true, opacity: 0.07,
        depthWrite: false, side: THREE.DoubleSide,
      }));
      fill.position.set(cx, h / 2, cz);
      fill.renderOrder = -1;
      fill.raycast = () => {};
      fill.castShadow = false;
      fill.receiveShadow = false;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.55 }),
      );
      edges.position.copy(fill.position);
      edges.renderOrder = 8;
      edges.raycast = () => {};
      this._roomGroup.add(fill);
      this._roomGroup.add(edges);
    }

    if (showExtents && b && b.min && b.max) {
      const min = b.min, max = b.max;
      const rx = Math.round(max[0] - min[0]);
      const ry = Math.round(max[1] - min[1]);
      const rz = Math.round(max[2] - min[2]);
      if (rx > 0) this._addDimLine([min[0], min[1], min[2]], [max[0], min[1], min[2]], 0xef4444, `${rx}cm`);
      if (ry > 0) this._addDimLine([min[0], min[1], min[2]], [min[0], max[1], min[2]], 0x22c55e, `${ry}cm`);
      if (rz > 0) this._addDimLine([min[0], min[1], min[2]], [min[0], min[1], max[2]], 0x3b82f6, `${rz}cm`);
    }
    this.requestRender();
  }

  /**
   * Das Bild der Szene als PNG-Datenstrom -- fuer "Als Bild speichern".
   *
   * Weggelassen wird alles, was zur Bedienung gehoert und nicht zum Modell:
   * Bodenraster, Bau-Punkte und Beschriftungen; der Ansichtswuerfel faellt weg,
   * weil hier NUR die Hauptszene gezeichnet wird (er kommt sonst erst danach
   * ueber `_renderViewCube`). Alles darum herum -- Himmel, Wiese, Baeume --
   * bleibt so stehen, wie es auf dem Schirm zu sehen ist.
   *
   * Gerendert wird eigens fuer diesen Aufruf und der Puffer SOFORT ausgelesen:
   * `preserveDrawingBuffer` ist aus, nach dem naechsten Bild waere er leer.
   */
  snapshot(opts = {}) {
    const hideGrid = opts.hideGrid !== false;
    const hideLabels = opts.hideLabels !== false;
    const hideRoom = opts.hideRoom === true;
    const mime = opts.mime || "image/png";
    const quality = opts.quality;
    const snapW = opts.width | 0;
    const snapH = opts.height | 0;
    const resized = snapW > 0 && snapH > 0;
    const prevPR = this.renderer.getPixelRatio();
    if (resized) {
      this._viewSize = { w: snapW, h: snapH };
      this._perspCam.aspect = snapW / snapH;
      this._perspCam.updateProjectionMatrix();
      this.renderer.setPixelRatio(opts.pixelRatio || Math.max(2, prevPR));
      this.renderer.setSize(snapW, snapH, false);
      this._updateOrthoFrustum();
    }
    const versteckt = [
      hideGrid ? this._grid : null,
      this.handleGroup,
      hideLabels ? this.labelGroup : null,
      this._hoverPartGroup,
      hideRoom ? this._roomGroup : null,
    ].filter(Boolean).map((o) => [o, o.visible]);
    for (const [o] of versteckt) o.visible = false;
    let url = null;
    try {
      this.renderer.render(this.scene, this.camera);
      url = mime === "image/jpeg"
        ? this.renderer.domElement.toDataURL(mime, quality ?? 0.82)
        : this.renderer.domElement.toDataURL(mime);
    } finally {
      for (const [o, sichtbar] of versteckt) o.visible = sichtbar;
      if (resized) {
        this._viewSize = null;
        this.renderer.setPixelRatio(prevPR);
        this._lastW = 0;
        this._lastH = 0;
        this.onResize();
      }
      this._needsRender = true;      // das naechste Bild zeigt wieder alles
    }
    return url;
  }

  /**
   * Ein Bild anfordern. Gezeichnet wird nur nach einer echten Aenderung --
   * die Schleife lief vorher stur mit 60 Bildern/s weiter, auch wenn nichts
   * passierte. Bei jedem Zweifel lieber ein Bild zu viel anfordern.
   */
  requestRender() { this._needsRender = true; }

  /** Schattenkarte einmalig neu rechnen lassen (Modell/Szene/Schnitt geaendert). */
  _shadowsDirty() {
    this.renderer.shadowMap.needsUpdate = true;
    this._needsRender = true;
  }

  // --- Ansichtswuerfel -----------------------------------------------------
  // Kleiner Wuerfel oben rechts, der die Blickrichtung zeigt und auf Klick die
  // Kamera dorthin schwenkt (Vorbild Fusion 360).
  //
  // Gezeichnet wird er im SELBEN Renderer ueber setViewport/setScissor, nicht
  // in einem zweiten Canvas: ein zweiter WebGL-Kontext kostet auf der
  // GPU-losen Testmaschine spuerbar und muesste beim Renderer-Tausch
  // (Kantenglaettung) mitgezogen werden.
  _buildViewCube() {
    this._cubeScene = new THREE.Scene();
    // Orthografisch, damit der Wuerfel unabhaengig von der Hauptprojektion
    // immer gleich aussieht. Der Ausschnitt fasst auch die Ecken der Diagonale.
    this._cubeCam = new THREE.OrthographicCamera(
      -CUBE_FRUSTUM, CUBE_FRUSTUM, CUBE_FRUSTUM, -CUBE_FRUSTUM, 0.1, 40);
    // Hell ausgeleuchtet: der Wuerfel ist ein Bedienelement, kein Bauteil --
    // er soll vor jedem Hintergrund gleich gut lesbar sein.
    this._cubeScene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const light = new THREE.DirectionalLight(0xffffff, 0.85);
    light.position.set(4, 6, 5);
    this._cubeScene.add(light);

    // Wuerfelkoerper. Materialreihenfolge von BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
    this._cubeFaceOrder = ["right", "left", "top", "bottom", "front", "back"];
    this._cubeFaceMats = this._cubeFaceOrder.map(() => new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this._cubeBody = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this._cubeFaceMats);
    this._cubeScene.add(this._cubeBody);

    this._cubeEdgeMat = new THREE.LineBasicMaterial({ color: CUBE_EDGE_LIGHT, transparent: true, opacity: 0.55 });
    this._cubeScene.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(this._cubeBody.geometry), this._cubeEdgeMat));

    // 26 Klickfelder: das 3x3x3-Raster ohne die Mitte. Ein Feld mit einer
    // Nicht-Null-Achse ist eine Flaeche, mit zweien eine Kante, mit dreien eine
    // Ecke -- die Blickrichtung ist einfach seine normierte Lage.
    this._cubeCellMat = new THREE.MeshBasicMaterial({
      color: 0x1a8cff, transparent: true, opacity: 0, depthWrite: false });
    this._cubeCellHoverMat = new THREE.MeshBasicMaterial({
      color: 0x1a8cff, transparent: true, opacity: 0.42, depthWrite: false });
    this._cubeCells = [];
    const third = 2 / 3;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (!x && !y && !z) continue;
          const cell = new THREE.Mesh(
            new THREE.BoxGeometry(third, third, third), this._cubeCellMat);
          // Knapp ausserhalb der Wuerfelflaeche, damit die Hervorhebung nicht
          // mit dem Koerper um dieselben Pixel streitet.
          cell.position.set(x * third * 1.03, y * third * 1.03, z * third * 1.03);
          cell.userData = { dir: [x, y, z] };
          this._cubeScene.add(cell);
          this._cubeCells.push(cell);
        }
      }
    }
    this._cubeHover = null;
    this._cubeEnabled = true;
  }

  /**
   * Beschriftung der sechs Flaechen. Kommt von aussen (ui.js), damit scene.js
   * die Sprachdateien nicht kennen muss; bei Sprachwechsel erneut aufrufen.
   * labels: { right, left, top, bottom, front, back }
   */
  setViewCubeLabels(labels) {
    if (!this._cubeFaceMats) return;
    // Gemerkt, weil der Wuerfel beim Wechsel des Farbschemas neu beschriftet
    // wird -- Flaechenfarbe und Schrift stecken in derselben Textur.
    this._cubeLabels = labels;
    this._cubeFaceOrder.forEach((key, i) => {
      const mat = this._cubeFaceMats[i];
      if (mat.map) mat.map.dispose();
      mat.map = this._cubeFaceTexture(labels[key] || "");
      mat.needsUpdate = true;
    });
    this._needsRender = true;
  }

  _cubeFaceTexture(text) {
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = this._dark ? "#2a3038" : "#eef1f5";
    g.fillRect(0, 0, S, S);
    g.fillStyle = this._dark ? "#e8edf3" : "#3a4350";
    g.font = "700 26px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(text).toUpperCase(), S / 2, S / 2);
    const tex = new THREE.CanvasTexture(cv);
    // Ohne sRGB-Kennzeichnung liest Three die Farbwerte als linear und die
    // Schrift kommt ausgewaschen heraus (gemessen: Helligkeit 140 statt 50
    // gegen einen Grund von 220).
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * 视角方块停在画布右下角。right / bottom 是相对右边和底边再让出的 CSS 像素
   * （右侧抽屉、拼装条等）。
   */
  setViewCubePad(right, bottom, size) {
    const r = Math.max(0, right || 0);
    const b = Math.max(0, bottom || 0);
    const s = Math.max(32, Math.round(size || CUBE_PX));
    if (r === this._cubePadRight && b === this._cubePadBottom && s === this._cubePx) return;
    this._cubePadRight = r;
    this._cubePadBottom = b;
    this._cubePx = s;
    this._needsRender = true;
  }

  setViewCubeInset(px) {
    this.setViewCubePad(this._cubePadRight, px);
  }

  /** Ausschnitt des Wuerfels in CSS-Pixeln, gemessen von der linken oberen Ecke. */
  _cubeRect() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const size = this._cubePx || CUBE_PX;
    if (w < size + CUBE_MARGIN * 2 || h < size + CUBE_MARGIN * 2) return null;
    const x = w - size - CUBE_MARGIN - (this._cubePadRight || 0);
    const y = h - size - CUBE_MARGIN - (this._cubePadBottom || 0);
    if (x < 0 || y < 0 || x + size > w || y + size > h) return null;
    return { x, y, size, w, h };
  }

  _renderViewCube() {
    if (!this._cubeEnabled) return;
    const r = this._cubeRect();
    if (!r) return;
    // Wuerfel genauso ausrichten wie die Hauptkamera und von aussen anschauen.
    this._cubeCam.left = -CUBE_FRUSTUM;
    this._cubeCam.right = CUBE_FRUSTUM;
    this._cubeCam.top = CUBE_FRUSTUM;
    this._cubeCam.bottom = -CUBE_FRUSTUM;
    this._cubeCam.quaternion.copy(this.camera.quaternion);
    this._cubeCam.position.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(12);
    this._cubeCam.updateProjectionMatrix();

    const gl = this.renderer;
    const yBottom = r.h - r.y - r.size;    // Viewport rechnet von unten
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setViewport(r.x, yBottom, r.size, r.size);
    gl.setScissor(r.x, yBottom, r.size, r.size);
    gl.clearDepth();
    // Die Schnittebene haengt an den Modell-Materialien -- der Wuerfel hat
    // eigene und bleibt ohne Zutun ungeschnitten.
    gl.render(this._cubeScene, this._cubeCam);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, r.w, r.h);
    gl.autoClear = true;
  }

  /** Getroffenes Feld des Ansichtswuerfels oder null. */
  pickViewCube(clientX, clientY) {
    if (!this._cubeEnabled) return null;
    const r = this._cubeRect();
    if (!r) return null;
    const box = this.renderer.domElement.getBoundingClientRect();
    const cx = clientX - box.left, cy = clientY - box.top;
    if (cx < r.x || cx > r.x + r.size || cy < r.y || cy > r.y + r.size) return null;
    this._mouse.x = ((cx - r.x) / r.size) * 2 - 1;
    this._mouse.y = -(((cy - r.y) / r.size) * 2 - 1);
    this._raycaster.setFromCamera(this._mouse, this._cubeCam);
    const hits = this._raycaster.intersectObjects(this._cubeCells, false);
    return hits.length ? hits[0].object : null;
  }

  setViewCubeHover(cell) {
    if (this._cubeHover === cell) return;
    if (this._cubeHover) this._cubeHover.material = this._cubeCellMat;
    this._cubeHover = cell || null;
    if (this._cubeHover) this._cubeHover.material = this._cubeCellHoverMat;
    this._needsRender = true;
  }

  /**
   * Kamera auf eine Blickrichtung schwenken (Klick auf den Ansichtswuerfel).
   * dir zeigt vom Modell zur Kamera. Abstand und Drehpunkt bleiben.
   */
  snapToDirection(dir) {
    if (!this.controls) return false;
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target) || 200;
    const v = new THREE.Vector3(dir[0], dir[1], dir[2]);
    if (v.lengthSq() < 1e-9) return false;
    v.normalize();
    // Genau senkrecht waere fuer OrbitControls entartet -- minimal kippen, wie
    // beim Drehen von Hand (siehe POLE_GAP). Gekippt wird in die Richtung, aus
    // der man GERADE schaut: sonst landet die Draufsicht immer in derselben
    // Lage und das Modell springt einmal um die Hochachse.
    if (Math.abs(v.y) > Math.cos(POLE_GAP)) {
      const quer = this.camera.position.clone().sub(target);
      quer.y = 0;
      // Auf die naechste Vierteldrehung einrasten: die Draufsicht steht damit
      // immer achsenparallel, behaelt aber die Seite, von der man kommt.
      const az = quer.lengthSq() < 1e-9 ? Math.PI
        : Math.round(Math.atan2(quer.x, quer.z) / (Math.PI / 2)) * (Math.PI / 2);
      const kipp = Math.sin(POLE_GAP);
      v.set(Math.sin(az) * kipp, Math.sign(v.y) * Math.cos(POLE_GAP), Math.cos(az) * kipp);
    }
    this._camAnim = {
      from: this.camera.position.clone().sub(target).normalize(),
      to: v,
      target,
      dist,
      t0: performance.now(),
    };
    this._needsRender = true;
    return true;
  }

  _stepCameraAnimation() {
    const a = this._camAnim;
    if (!a) return false;
    const k = Math.min(1, (performance.now() - a.t0) / CUBE_SNAP_MS);
    // Weich anlaufen und auslaufen.
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const v = new THREE.Vector3().copy(a.from).lerp(a.to, e);
    if (v.lengthSq() < 1e-9) v.copy(a.to);
    v.normalize();
    this.camera.position.copy(a.target).addScaledVector(v, a.dist);
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(a.target);
    this.controls.update();
    if (k >= 1) {
      this._camAnim = null;
      this.onCameraChange();
    }
    return true;
  }

  _animate() {
    requestAnimationFrame(this._animate);
    if (this._stepCameraAnimation()) this._needsRender = true;
    // controls.update() liefert true, solange das Damping noch nachlaeuft.
    if (this.controls.update()) this._needsRender = true;
    if (this._updateTreeCamera()) this._needsRender = true;
    if (!this._needsRender) return;
    this._needsRender = false;
    this.renderer.render(this.scene, this.camera);
    this._renderViewCube();
  }
}
