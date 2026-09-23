// Bau-Interaktion: Auswahl, Anbau ueber Richtungs-Handles, Loeschen.

import { DIRECTIONS, DIAGONAL_DIRECTIONS, DIR_ALIGN_TOL, ARM_ALIGN_TOL, CLAMP_LINK_DIST, C45_SLEEVE_LEN, C45_ARM_LEN } from "./config.js";
import { accessories, buildableTubes, geometry, getTube, spacingFor, getPanel, defaultPanel, diagonalTubeId, slideKindLabel, slideKindName, isCurvedTube, gridSpacing, partName, partForFitting, getPartById, getConnector, poolLinerFor, reinforcementPart } from "./catalog.js";
import { CLASSIC_COLOR_IDS, officialColorId } from "./colors.js";
import { computeBuildPlan, connectorLabelInfo } from "./buildplan.js";
import { infeasibleConnectors, inferConnectorType } from "./bom.js";
import { t } from "./i18n.js";
import { round2, panelNormal, modelMiddle, xAxisOf, yAxisOf, zAxisOf, quatFromBasis } from "./util.js";
import { TUBE_FITTINGS, POOL_KINDS, isHolePart, holeArmDirs, holeClampDirsAt, HOLE_MASKS,
  BOLT_PART, HINGE_PART, isBoltPart, boltArmDirs, boltDepth, hingeDir, hingeKey, splitHingeKey,
  POOL_SETS, ARM_FITTINGS, armFittingDirsAt, fixedFittingColor } from "./model.js";
import { CONNECTOR_ARM_BITS } from "./qdfimport.js";

// Kupplungen, die auf einem Rohr sitzen statt im Raster: QDF-Art -> Katalogteil.
// Teile, die sich um ein Rohr klemmen lassen. Die Lochzapfenkupplung gehört
// NICHT dazu -- sie umschließt kein Rohr (siehe PLACEABLE_FITTINGS).
const TUBE_CLAMP_PARTS = { "bearing-clamp": "bearing" };
// Dachtuecher: sie liegen auf einem Giebel-Gerippe (siehe model.roofMounts).
const ROOF_KINDS = new Set(["roof2", "roof-large2"]);

// So lange wartet der Seitenwechsel einer Platte auf einen zweiten Klick. Der
// Doppelklick dreht sie stattdessen; 250 ms ist der uebliche Abstand, den
// Betriebssysteme dafuer ansetzen.
const PANEL_DBLCLICK_MS = 250;
// Teile, die wie eine Platte an ZWEI parallelen Rohren haengen.
const RAIL_FITTINGS = new Set(["lattice2", "bag2", "textil2"]);

const CLICK_TOLERANCE = 9; // px: groessere Bewegung = Kamera drehen, kein Klick (Touch-tauglich)
// Halten auf dem Touchscreen: ersetzt Strg/Shift, die es dort nicht gibt.
// Auf einem Teil schaltet es dieses zur Auswahl hinzu, im Leeren beginnt es ein
// Auswahl-Rechteck. 450 ms sind lang genug, dass ein Tipper nicht ausloest, und
// kurz genug, dass niemand wartet.
const LONG_PRESS_MS = 450;
// Zweiter Klick auf dasselbe Teil innerhalb dieser Zeit waehlt den Verbund.
const SELECT_BLOCK_MS = 500;

// C45_SLEEVE_LEN / C45_ARM_LEN stehen in config.js. Ausgemessen an den Dateien
// der Herstellersoftware (alle sechs Adapter identisch): dazwischen liegt ein
// echtes Rohrende, auf das die Winkelkupplung gesteckt wird.

// Zufallsfarbe: kein echter Farbwert, sondern ein Schalter in builder.color.
// Jedes Teil wuerfelt beim Setzen (bzw. beim Umfaerben einer Auswahl) seine
// eigene Farbe -- sonst waere es nur eine weitere feste Farbe.
export const RANDOM_COLOR = "random";
// 随机色只走经典四色。黑是厂家面板色，会出现在导入文件里，但不进随机池，
// 免得工具栏没有黑色色块时突然铺出一块黑面板。

// 普通通型的臂位掩码（与 scene.js / connectors.json 同一套 bit）。
const CONN_TYPE_MASK = {
  straight: 0x03, elbow: 0x05, t: 0x07, cross: 0x0f,
  "3way": 0x15, "4way": 0x17, "5way": 0x1f, "6way": 0x3f,
};

// Verschieben im Cursor-Modus (und beim Einfuegen) laeuft im 5-cm-Raster --
// die Kupplungslaenge. Groebere Schritte wie das halbe 35er-Raster (20 cm)
// gehen an Aufbauten vorbei, die kurze Rohre mischen.
// Feines Raster, auf dem die Geometrie selbst einrastet: die Drehachse einer
// Auswahl und ein Rohr, das in eine Klemme kommt. Es hat nichts mit der
// Schrittweite zu tun, die der Nutzer unten rechts einstellt -- die gilt fuers
// VERSCHIEBEN (moveStep).
const SNAP_STEP = 5;
// Schrittweite beim Verschieben, Ziehen und Einfuegen. Voreinstellung 20 cm --
// ein halbes Rasterfeld; einstellbar ueber den Knopf im Bild.
export const MOVE_STEPS = [5, 10, 20, 40, 80];
export const DEFAULT_MOVE_STEP = 20;

export class Builder {
  constructor(scene, model, { onChange, onPreview } = {}) {
    this.scene = scene;
    this.model = model;
    this.onChange = onChange || (() => {});
    // Waehrend einer Vorschau: nur die Knoepfe nachziehen, nicht neu rechnen.
    this.onPreview = onPreview || (() => {});
    this.onNotice = () => {};        // kurze Hinweis-Meldung an die UI
    this._tubeHandles = new Map();   // Rohr -> mitwandernder Ankerpunkt
    this.slideKind = "slide-new2";   // gewaehltes Rutschenteil
    this.onHistoryChange = () => {}; // Undo-Verfuegbarkeit hat sich geaendert
    // Die Hervorhebung aus Stueckliste/Bestand/Aufbau wurde im Bild aufgehoben
    // (Klick ins Leere) -- die Liste muss ihre markierte Zeile zuruecknehmen.
    this.onHighlightCleared = () => {};
    // Zuletzt benutzte Eingabeart: "mouse" oder "touch". Sie entscheidet, welcher
    // Hinweis in der Statuszeile steht -- Strg/Shift gibt es am Finger nicht,
    // das Halten dafuer nicht an der Maus. Geraete koennen beides, deshalb
    // zaehlt, WOMIT gerade gearbeitet wird, nicht was das Geraet kann.
    this.inputType = "mouse";
    this.onInputTypeChange = () => {};

    // "select" (Cursor: vorhandenes auswaehlen) | "delete" (Klick loescht)
    // | "add" | "panel" | "slide" | "clamp" | "fitting" | "reinforce" | "assembly"
    this.mode = "select";
    this.tubeId = geometry().defaultTube;
    this.panelId = defaultPanel();
    this.fittingKind = "multi-wheel2";   // gewaehltes Anbauteil (QDF-Art)
    this.poolLinerId = null;             // pool_liner_xs/s/l/xxl, wenn Folie gesetzt wird    this.clampPart = "double_tube";      // Doppelrohrverbinder oder Rohrklammer
    this.placeConnectorId = null;       // 普通通型：套到现有空插座接头上
    // Platten-Modus: erstes angeklicktes Tragrohr + Stelle entlang davon.
    this.panelRail = null;
    // Verstaerken-Modus: erstes angeklicktes 35er-Rohr, das noch seinen Partner
    // sucht (ein Profil deckt immer 80 cm).
    this.reinforceRail = null;
    this.color = RANDOM_COLOR;
    // Schrittweite beim Verschieben (Pfeiltasten, Ziehen, Einfuegen).
    this.moveStep = DEFAULT_MOVE_STEP;
    this.selectedNodeId = null;
    // Cursor-Modus: id -> kind ("tube"/"panel"/"node"/...). Die ids sind ueber
    // alle Kategorien hinweg eindeutig (gemeinsamer Zaehler in model._id).
    this.selection = new Map();
    this.highlight = null;   // reine Sicht-Hervorhebung (Bestandsliste)

    this.buildPlan = { levels: [], steps: [] };
    this.assemblyStep = 0;
    this.assemblyOrder = "y+";   // Aufbaurichtung, siehe buildplan.BUILD_ORDERS
    this.manualLabels = false;   // 说明书导出：显示当前步所有接头/管标注

    this._undoStack = [];
    this._redoStack = [];
    this._maxUndo = 60;

    this._down = null;
    this._clampDrag = null;
    this._clampSlide = null;
    this._clampDragKandidat = null;
    this._clampSlideKandidat = null;
    this._panning = false;
    this._boxing = false;
    this._paste = null;              // Kopie, die gerade am Zeiger haengt
    this._lastPointer = null;        // letzte Zeigerstelle (fuer Strg+V)
    this._attach();
    // Wird der Renderer ersetzt (Kantenglaettung), haengt das alte Canvas nicht
    // mehr im DOM -- die Zeiger-Listener muessen ans neue.
    this.scene.onRendererReplaced = () => this._attach();
    this.refresh();
  }

  // --- Undo ---------------------------------------------------------------
  // Fuehrt eine Modell-Aenderung aus und merkt den Zustand davor (nur wenn sich
  // wirklich etwas geaendert hat).
  recordHistory(mutateFn) {
    const before = JSON.stringify(this.model.toJSON());
    const ret = mutateFn();
    const after = JSON.stringify(this.model.toJSON());
    if (after !== before) {
      this._undoStack.push(before);
      if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
      this._redoStack = []; // neue Aenderung verwirft die Redo-Historie
      this.onHistoryChange();
    }
    return ret;
  }

  /**
   * Alle Markierungen aufheben: Auswahl, Hervorhebung, gewaehltes Tragrohr,
   * Bau-Kupplung. Liefert true, wenn es etwas zu raeumen gab -- die Oberflaeche
   * wechselt erst beim naechsten Escape den Modus.
   */
  clearMarks() {
    const had = this.selection.size > 0 || !!this.highlight || !!this.panelRail ||
      !!this.reinforceRail || (this.mode !== "select" && !!this.selectedNodeId);
    if (!had) return false;
    this.selection.clear();
    this.highlight = null;
    this.panelRail = null;
    this.reinforceRail = null;
    if (this.mode !== "select") this.selectedNodeId = null;
    this.refresh();
    return true;
  }

  canUndo() { return this._undoStack.length > 0; }

  canRedo() { return this._redoStack.length > 0; }

  clearHistory() {
    this._undoStack = [];
    this._redoStack = [];
    this.onHistoryChange();
  }

  undo() {
    if (!this._undoStack.length) return;
    const prev = this._undoStack.pop();
    this._redoStack.push(JSON.stringify(this.model.toJSON()));
    if (this._redoStack.length > this._maxUndo) this._redoStack.shift();
    this.model.loadJSON(JSON.parse(prev));
    if (this.selectedNodeId && !this.model.nodes.has(this.selectedNodeId)) {
      this.selectedNodeId = null;
    }
    this._pruneSelection();
    if (this.mode === "assembly") this.enterAssembly();
    this.onHistoryChange();
    this.refresh();
  }

  redo() {
    if (!this._redoStack.length) return;
    const next = this._redoStack.pop();
    this._undoStack.push(JSON.stringify(this.model.toJSON()));
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this.model.loadJSON(JSON.parse(next));
    if (this.selectedNodeId && !this.model.nodes.has(this.selectedNodeId)) {
      this.selectedNodeId = null;
    }
    this._pruneSelection();
    if (this.mode === "assembly") this.enterAssembly();
    this.onHistoryChange();
    this.refresh();
  }

  // --- oeffentliche Steuerung --------------------------------------------
  setMode(mode) {
    // Ein Moduswechsel beendet ein laufendes Einfuegen (startPaste schaltet
    // selbst auf "select" und setzt seinen Zustand danach).
    if (this._paste && mode !== "select") this.cancelPaste();
    if (mode !== "add") this.placeConnectorId = null;
    this.mode = mode;
    if (this.panelRail) { this.panelRail = null; this.highlight = null; }
    if (this.reinforceRail) { this.reinforceRail = null; this.highlight = null; }
    // Im Cursor-Modus gibt es keine Bau-Kupplung: sonst blieben Ankerpunkte
    // stehen. Umgekehrt gilt die Cursor-Auswahl nur dort.
    if (mode === "select") this.selectedNodeId = null;
    else this.selection.clear();
    // Labels beim Moduswechsel grundsaetzlich ausschalten;
    // der Aufbaumodus schaltet sie in enterAssembly() selbst wieder ein.
    if (mode === "assembly") this.enterAssembly(); // Aufbau zeigt wieder eigene Labels
    this.scene.setCursor("default");
    this.refresh();
    if (mode === "slide" || mode === "fitting") this._hintPlaceMode();
  }

  /** 选了配件却没有绿面/绿点时，立刻说清：没有可挂的位置。 */
  _hintPlaceMode() {
    if (this.mode === "slide") {
      if (this.slideKind === "slide-end2") {
        if (!this.model.slideChainMounts(this.slideKind).length) {
          // Gibt es Ausgaenge, nur zu hoch? Dann fehlt erst noch ein Koerper.
          const offen = [...this.model.slides.values()].some((s) => {
            const e = this.model.slideExit(s);
            return e && !this.model._slideAt(e.pos);
          });
          this.onNotice(t(offen ? "notice_slide_end_high" : "notice_slide_end_none"), "info");
        }
        return;
      }
      const n = this.model.slideMounts(40, 2, this.slideKind).length
        + this.model.slideChainMounts(this.slideKind).length;
      if (!n) this.onNotice(t("notice_slide_no_mount"), "info");
      return;
    }
    if (this.mode !== "fitting") return;
    if (ROOF_KINDS.has(this.fittingKind)) {
      if (this.model.roofMounts(this.fittingKind).length) return;
      // Alle Gerippe schon bedeckt? Dann ist das die Nachricht. Gerippe da, nur
      // mit der anderen Firstlaenge? Dann gleich das passende Tuch nennen.
      const andere = this.fittingKind === "roof2" ? "roof-large2" : "roof2";
      const key = this.model.roofMounts(this.fittingKind, true).length ? "notice_roof_covered"
        : this.model.roofMounts(andere, true).length
          ? (this.fittingKind === "roof2" ? "notice_roof_use_large" : "notice_roof_use_small")
          : "notice_roof_no_frame";
      this.onNotice(t(key), "info");
      return;
    }
    if (this.fittingKind === "textil-round2") {
      if (!this.model.fittingMounts("textil-round2").length) {
        this.onNotice(t("notice_round_no_bow"), "info");
      }
      return;
    }
    if (RAIL_FITTINGS.has(this.fittingKind)
      && !this.model.railFittingMounts(this.fittingKind).length) {
      this.onNotice(t("notice_textile_no_cell"), "info");
      return;
    }
    if (POOL_KINDS.has(this.fittingKind)) {
      const spec = this.poolLinerId && POOL_SETS[this.poolLinerId];
      if (spec && !this.model.poolLinerMounts(spec).length) {
        this.onNotice(t("notice_pool_no_frame"), "info");
      }
      return;
    }
    if (!this._countFittingPlaces()) {
      const key = (this.fittingKind === "hub-cap2" || this.fittingKind === "tube-cap2")
        ? "notice_cap_no_end" : "notice_fitting_no_mount";
      this.onNotice(t(key), "info");
    }
  }

  /** Wieviele Stellen das gewaehlte Anbauteil jetzt hat -- wie _buildFittingHandles. */
  _countFittingPlaces() {
    const kind = this.fittingKind;
    const cs = geometry().connectorSize;
    if (RAIL_FITTINGS.has(kind)) return this.model.railFittingMounts(kind).length;
    if (ROOF_KINDS.has(kind)) return this.model.roofMounts(kind).length;
    if (kind === "textil-round2") return this.model.fittingMounts(kind).length;
    if (HOLE_MASKS[kind]) return this.model.holeArmMounts(cs).length;
    if (kind === BOLT_PART) return this.model.boltMounts(cs).length;
    if (kind === HINGE_PART) return this.model.hingeMounts(cs).length;
    if (TUBE_CLAMP_PARTS[kind]) {
      let n = 0;
      for (const t of this.model.tubes.values()) {
        if (!t.arm && !t.link && !t.bow) n++;
      }
      if (kind === "bearing-clamp") n += this.model.bearingArmMounts(cs).length;
      return n;
    }
    return this.model.fittingMounts(kind, cs).length
      + this.model.tubeFittingSpots(kind, cs).length;
  }

  setTube(tubeId) { this.tubeId = tubeId; this.placeConnectorId = null; }

  /**
   * 普通通型（6通/三通角/弯头…）：空场景直接在原点落下；已有结构则高亮
   * 现有接头（还有空插座的），点一下换成所选型号。不再在空气里的网格邻点落子。
   */
  placeConnector(id) {
    this.placeConnectorId = id || "6way";
    if (this.mode !== "add") this.setMode("add");
    else this.refresh();
    if (this.model.isEmpty()) {
      this.recordHistory(() => {
        const n = this.model.addNode(0, 0, 0);
        n.preferType = this.placeConnectorId;
        this.selectedNodeId = n.id;
      });
      this.placeConnectorId = null;
      this.scene.resetCamera(this.model);
      this.refresh();
      const def = getConnector(id);
      if (def) this.onNotice(t("notice_placed", partName(def)));
      return;
    }
    if (![...this.model.nodes.values()].some((n) => this._nodeAcceptsConnector(n, this.placeConnectorId))) {
      this.onNotice(t("notice_connector_no_node"), "warn");
    }
  }
  setPanel(panelId) { this.panelId = panelId; if (this.mode === "panel") this.refresh(); }
  /** Schrittweite beim Verschieben setzen (cm). */
  setMoveStep(cm) {
    const wert = Number(cm);
    if (!MOVE_STEPS.includes(wert)) return false;
    this.moveStep = wert;
    return true;
  }

  setClampPart(id) { this.clampPart = id; if (this.mode === "clamp") this.refresh(); }

  setFitting(kind, partId = null) {
    this.fittingKind = kind;
    // 同一种 qdf 元素下的具体件（布件 / 彩虹带 / 彩虹桥），放下去时给它打变体标记
    this.fittingPart = partId;
    this.poolLinerId = null;
    this._clearPanelRail();          // Rohr-Auswahl gilt nur fuer das Netz
    if (this.mode === "fitting") this.refresh();
  }

  /**
   * Auf welche Seite der Rohre gehoert eine neu gesetzte Platte?
   *
   * Auf die, von der aus man sie setzt: schaut man von oben auf das Feld, legt
   * sich die Platte oben auf, schaut man von unten dagegen, haengt sie darunter.
   * Umlegen laesst sie sich danach mit einem Klick auf die Platte selbst.
   */
  _panelSideFromCorners(cor) {
    if (!cor) return 1;
    const [A, B, , D] = cor;
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const e2 = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const c = [0, 1, 2].map((i) => cor.reduce((s, q) => s + q[i], 0) / 4);
    const n = panelNormal(e1, e2, c, modelMiddle(this.model.nodes.values()));
    const cam = this.scene.cameraPosition();
    const toCam = [cam[0] - c[0], cam[1] - c[1], cam[2] - c[2]];
    return (toCam[0] * n[0] + toCam[1] * n[1] + toCam[2] * n[2]) < 0 ? -1 : 1;
  }
  // Farbe der Toolbar. Im Cursor-Modus faerbt sie ausserdem die aktuelle
  // Auswahl um -- im Platzier-Modus gilt sie nur fuer NEUE Teile.
  setColor(colorId) {
    this.color = colorId;
    if (this.mode === "select" && this.selection.size) this.colorSelection(colorId);
  }

  /**
   * Farbe fuer ein NEU gesetztes Teil. Normalerweise die Toolbar-Farbe; bei
   * "Zufall" wuerfelt jedes Teil einzeln. Rohre nehmen an dem Knoten die
   * seltenste der klassischen Vier (wie designer).
   */
  colorFor(kind, nodeId) {
    if (this.color !== RANDOM_COLOR) return this.color;
    if (kind === "tube") return this._leastUsedClassic(nodeId);
    return CLASSIC_COLOR_IDS[Math.floor(Math.random() * CLASSIC_COLOR_IDS.length)];
  }

  /** Seltenste der klassischen Vier an diesem Knoten; bei Gleichstand zufaellig. */
  _leastUsedClassic(nodeId) {
    const counts = { red: 0, green: 0, blue: 0, yellow: 0 };
    if (nodeId != null) {
      for (const t of this.model.tubes.values()) {
        if (t.arm || t.link) continue;
        if (t.a !== nodeId && t.b !== nodeId) continue;
        const c = officialColorId(t.color);
        if (counts[c] != null) counts[c]++;
      }
    }
    const min = Math.min(...CLASSIC_COLOR_IDS.map((c) => counts[c]));
    const cand = CLASSIC_COLOR_IDS.filter((c) => counts[c] === min);
    return cand[Math.floor(Math.random() * cand.length)];
  }

  /** Alle sichtbaren Teile aus einer Farbfamilie neu wuerfeln. */
  recolorAll(colors) {
    const pool = Array.isArray(colors) ? colors.filter(Boolean) : [];
    if (!pool.length) return 0;
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    let changed = 0;
    this.recordHistory(() => {
      for (const t of this.model.tubes.values()) {
        if (t.arm || t.link) continue;
        const next = pick();
        if (t.color !== next) { t.color = next; changed++; }
      }
      for (const map of [this.model.panels, this.model.textiles, this.model.slides]) {
        for (const el of map.values()) {
          const next = pick();
          if (el.color !== next) { el.color = next; changed++; }
        }
      }
      for (const f of this.model.fittings.values()) {
        if (fixedFittingColor(f.kind)) continue;
        const next = pick();
        if (f.color !== next) { f.color = next; changed++; }
      }
    });
    if (changed) this.onNotice(t("notice_color_changed"));
    this.refresh();
    return changed;
  }

  // --- Cursor-Modus -------------------------------------------------------
  /** Faerbt alle faerbbaren Teile der Auswahl um. */
  colorSelection(colorId) {
    let changed = 0;
    const random = colorId === RANDOM_COLOR;
    this.recordHistory(() => {
      for (const [id, kind] of this.selection) {
        const c = random ? this.colorFor(kind) : colorId;
        if (this.model.setColorOf(kind, id, c)) changed++;
      }
    });
    if (changed) this.onNotice(t("notice_color_changed"));
    this.refresh();
    return changed;
  }

  /**
   * Alles Sichtbare auswaehlen (Strg+A). Quelle ist die Szene, nicht das
   * Modell: nur was gerade gezeichnet und nicht weggeschnitten ist, laesst
   * sich auch anklicken.
   */
  selectAll() {
    if (this.mode !== "select") return 0;
    this.selection = this.scene.selectableParts();
    this.refresh();
    return this.selection.size;
  }

  /**
   * Den zusammenhaengenden Block unter dem Zeiger (oder der aktuellen Auswahl)
   * markieren. add = zur Auswahl dazunehmen.
   */
  selectConnected({ add = false } = {}) {
    if (this.mode !== "select") this.setMode("select");
    if (this.mode !== "select") return 0;
    const zeiger = this._lastPointer;
    if (zeiger) {
      const pick = this.scene.pickForDelete(zeiger.x, zeiger.y);
      if (pick) return this._selectConnectedFromPick(pick, add);
    }
    if (this.selection.size) return this._selectConnectedFromSelection(add);
    return 0;
  }

  _isBlockClick(e, seedId) {
    const now = performance.now();
    const last = this._selectClick;
    this._selectClick = { t: now, id: seedId, x: e.clientX, y: e.clientY };
    return !!(last && now - last.t < SELECT_BLOCK_MS && last.id === seedId
      && Math.hypot(e.clientX - last.x, e.clientY - last.y) < CLICK_TOLERANCE);
  }

  _selectConnectedFromPick(pick, add) {
    const block = this.model.connectedSelection(pick.data.id, pick.data.kind, pick.data);
    return this._applyConnectedBlock(block, add, pick.data.id);
  }

  _selectConnectedFromSelection(add) {
    const union = new Map();
    for (const [id, kind] of this.selection) {
      const block = this.model.connectedSelection(id, kind);
      for (const [i, k] of block) union.set(i, k);
    }
    const seed = this.selection.size ? [...this.selection.keys()][0] : null;
    return this._applyConnectedBlock(union, add, seed);
  }

  _applyConnectedBlock(block, add, seedId) {
    const vis = this.scene.selectableParts();
    const next = new Map();
    for (const [id, kind] of block) {
      if (kind === "hinge") {
        const sp = splitHingeKey(id);
        if (sp && (vis.has(sp.nodeId) || vis.has(id))) next.set(id, kind);
      } else if (vis.has(id) || id === seedId) {
        next.set(id, vis.get(id) || kind);
      }
    }
    if (!next.size) return 0;
    if (add) {
      for (const [id, kind] of next) this.selection.set(id, kind);
    } else {
      this.selection = next;
    }
    this._profilAuswahl = null;
    this.refresh();
    return next.size;
  }

  // --- Verschieben --------------------------------------------------------
  /**
   * Auswahl um einen Rasterschritt in Richtung dir verschieben (Pfeiltasten).
   * dir ist ein Einheitsvektor auf einer Achse.
   */
  moveSelectionBy(dir, step = this.moveStep) {
    if (this.mode !== "select" || !this.selection.size) return false;
    const driver = this._selectedClampDriver();
    if (driver) {
      const c = this.model.clamps.get(driver);
      if (c && c.dir) {
        const u = c.dir;
        const ul = Math.hypot(u[0], u[1], u[2]) || 1;
        const along = (dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2]) / ul * step;
        if (Math.abs(along) < 0.01) return false;
        const before = JSON.stringify(this.model.toJSON());
        if (!this.model.slideClampFlap(driver, along, { snapDist: this._snapRadius() })) return false;
        this._afterMove(before, { merged: 0, detached: 0 });
        return true;
      }
    }
    const before = JSON.stringify(this.model.toJSON());
    const res = this._move(dir[0] * step, dir[1] * step, dir[2] * step);
    if (!res.ok) { this.onNotice(t("notice_move_" + res.reason), "warn"); return false; }
    this._afterMove(before, res);
    return true;
  }

  /**
   * Auswahl um die Hochachse drehen, in 90-Grad-Schritten (+1 = im Uhrzeiger-
   * sinn von oben). Haengt eine Kopie am Zeiger, dreht sich diese -- sie bleibt
   * dabei stehen und wird rot, wenn sie so nicht passt. Sonst gilt dieselbe
   * Regel wie bei den Pfeiltasten: geht es nicht, bleibt alles, wie es war.
   */
  rotateSelectionBy(steps = 1) {
    if (this._drag) return false;         // laufender Zug hat seinen eigenen Stand
    if (this._paste) return this._rotatePaste(steps);
    if (this.mode !== "select" || !this.selection.size) return false;
    const driver = this._selectedClampDriver();
    if (driver) {
      let ok = false;
      this.recordHistory(() => { ok = this.model.rotateClamp(driver, steps * Math.PI / 2); });
      if (!ok) { this.onNotice(t("notice_fitting_fixed"), "warn"); return false; }
      this.refresh();
      return true;
    }
    // 单选一根弯管：绕它接着的那头转 90 度，和放置时点它转是同一个动作。
    const bow = this._selectedLoneBow();
    if (bow) {
      const pivot = this._bowPivotFor(bow);
      if (!pivot) { this.onNotice(t("notice_bow_attached"), "warn"); return false; }
      let res;
      this.recordHistory(() => { res = this.model.rotateBow(bow.id, steps, { pivot }); });
      if (res && res.ground) { this.onNotice(t("notice_ground"), "warn"); return false; }
      if (res && res.duplicate) { this.onNotice(t("notice_bow_blocked"), "warn"); return false; }
      this.refresh();
      return !!(res && res.node);
    }
    const before = JSON.stringify(this.model.toJSON());
    const res = this.model.rotateSelection(this.selection, steps,
      { merge: true, validate: infeasibleConnectors, grid: SNAP_STEP });
    if (!res.ok) { this.onNotice(t("notice_rotate_" + res.reason), "warn"); return false; }
    this._afterMove(before, res);
    return true;
  }

  /** 选中的正好是一根弯管（没有别的）就给它，否则 null。 */
  _selectedLoneBow() {
    if (this.selection.size !== 1) return null;
    const [[id, kind]] = this.selection;
    if (kind !== "tube") return null;
    const tube = this.model.tubes.get(id);
    return tube && tube.bow ? tube : null;
  }

  /**
   * 弯管绕哪一头转：另一头得空着——只有这根管，接头上也没装配件。
   * 两头都接着东西就转不了（返回 null）；两头都空着就绕 a 头。
   */
  _bowPivotFor(tube) {
    const a = this.model.nodes.get(tube.a), b = this.model.nodes.get(tube.b);
    if (!a || !b) return null;
    const free = (n) => this.model.degree(n.id) === 1 && !n.part && !n.bearingOn && !n.c45body;
    if (free(b)) return tube.a;
    if (free(a)) return tube.b;
    return null;
  }

  /** Die Kopie am Zeiger dreht sich an Ort und Stelle mit. */
  _rotatePaste(steps) {
    const d = this._paste;
    if (!d || !d.sel) return false;
    // Ohne Zusammenlegen und ohne Trennen: die Kopie steht ja noch frei.
    const res = this.model.rotateSelection(d.sel, steps, { merge: false, grid: SNAP_STEP });
    if (!res.ok) return false;
    d.valid = !this._troubleWith(d.sel, d.collidedBefore);
    this.refresh();
    return true;
  }

  /** 选中部分沿世界轴 x 或 z 翻转；挂在指针上的副本就地翻。 */
  mirrorSelectionBy(axis = "x") {
    if (this._drag) return false;
    if (this._paste) return this._mirrorPaste(axis);
    if (this.mode !== "select" || !this.selection.size) return false;
    const before = JSON.stringify(this.model.toJSON());
    const res = this.model.mirrorSelection(this.selection, axis,
      { merge: true, validate: infeasibleConnectors, grid: SNAP_STEP });
    if (!res.ok) { this.onNotice(t("notice_mirror_" + res.reason), "warn"); return false; }
    this._afterMove(before, res);
    return true;
  }

  _mirrorPaste(axis) {
    const d = this._paste;
    if (!d || !d.sel) return false;
    const res = this.model.mirrorSelection(d.sel, axis, { merge: false, grid: SNAP_STEP });
    if (!res.ok) { this.onNotice(t("notice_mirror_" + res.reason), "warn"); return false; }
    d.valid = !this._troubleWith(d.sel, d.collidedBefore);
    this.refresh();
    return true;
  }

  // --- 成组 ----------------------------------------------------------------
  _kindOf(id) {
    const m = this.model;
    if (m.tubes.has(id)) return "tube";
    if (m.panels.has(id)) return "panel";
    if (m.textiles.has(id)) return "textile";
    if (m.slides.has(id)) return "slide";
    if (m.clamps.has(id)) return "clamp";
    if (m.fittings.has(id)) return "fitting";
    return "node";
  }

  groupSelection() {
    if (this.mode !== "select" || this.selection.size < 2) {
      this.onNotice(t("notice_group_few"), "warn");
      return false;
    }
    let gid = null;
    this.recordHistory(() => { gid = this.model.groupParts([...this.selection.keys()]); });
    if (!gid) { this.onNotice(t("notice_group_few"), "warn"); return false; }
    this.onNotice(t("notice_group_done", this.model.groups.get(gid).size));
    this.refresh();
    return true;
  }

  ungroupSelection() {
    let n = 0;
    this.recordHistory(() => { n = this.model.ungroupParts([...this.selection.keys()]); });
    if (!n) { this.onNotice(t("notice_ungroup_none"), "warn"); return false; }
    this.onNotice(t("notice_ungroup_done", n));
    this.refresh();
    return true;
  }

  /** 选中里涉及几个组。 */
  groupsInSelection() {
    const s = new Set();
    for (const id of this.selection.keys()) {
      const g = this.model.groupOf(id);
      if (g) s.add(g);
    }
    return s.size;
  }

  // --- Kopieren und Einfuegen ---------------------------------------------
  // Das Einfuegen laeuft wie das Ziehen einer Auswahl: Schnappschuss, bei jeder
  // Zeigerbewegung neu einsetzen, am Ende EIN Undo-Schritt. Der Unterschied --
  // die Kopie klebt am Zeiger, bis ein echter Klick sie absetzt, und wo sie
  // nicht hinpasst, wird sie rot gezeichnet statt stehen zu bleiben.

  /** Ausschnitt der Auswahl fuer die Zwischenablage. Null, wenn nichts gewaehlt. */
  copySelection() {
    if (!this.selection.size) return null;
    return this.model.extractSelection(this.selection);
  }

  /** Haengt gerade eine Kopie am Zeiger? */
  get pasting() { return !!this._paste; }

  /** Aktuelle Einfuege-Hoehe in cm, oder null. */
  get pasteHeightCm() {
    const d = this._paste;
    if (!d) return null;
    const a = d.frag.anchor;
    const y = d.flat ? a[1] : (d.planeY != null ? d.planeY : a[1]);
    return Math.round(y);
  }

  /**
   * 泳池内衬：有现成方框就标绿面让人点挂；没有框则整套跟指针走，↑↓ 换楼层。
   */
  startPool(linerId) {
    // 海洋球：不是内衬，是往现成的泳池里倒。每个泳池上方给一块绿面，点一下
    // 倒进去，再点一次倒出来。
    if (linerId === "balls") {
      if (!this._pools().length) { this.onNotice(t("notice_balls_none"), "info"); return false; }
      this.cancelPaste();
      this.poolLinerId = "balls";
      this.fittingKind = "balls";
      this.setMode("fitting");
      this.onNotice(t("notice_balls_pick"), "info");
      return "mount";
    }
    const spec = POOL_SETS[linerId];
    if (!spec) return false;
    this.poolLinerId = linerId;
    const mounts = this.model.poolLinerMounts(spec);
    if (mounts.length) {
      this.cancelPaste();
      this.fittingKind = spec.kind;
      this.setMode("fitting");
      this.onNotice(t("notice_pool_pick_frame"), "info");
      return "mount";
    }
    this.onNotice(t("notice_pool_no_frame"), "info");
    return this._startPoolPaste(spec) ? "paste" : false;
  }

  _startPoolPaste(spec) {
    const cs = geometry().connectorSize;
    const frag = this.model.poolFragment(spec, {
      // Der Rahmen wird bunt: je Rohr eine zufaellige Farbe, so wie das
      // Baellebad auch geliefert wird. Die Folie gibt es nur in Blau.
      color: () => {
        const farben = CLASSIC_COLOR_IDS;
        return farben[Math.floor(Math.random() * farben.length)] || "blue";
      },
      // Zu einer Spannweite das passende Rohr: die Kupplung steuert `cs` bei.
      tubeFor: (span) => getTube(this._tubeIdForSpan(span, cs)),
    });
    return frag ? this.startPaste(frag) : false;
  }

  /** Katalog-Rohr zu einem Kupplungsabstand (Spannweite = Rohr + Kupplung). */
  _tubeIdForSpan(span, cs) {
    const gesucht = span - cs;
    let best = null, bestD = Infinity;
    for (const tb of buildableTubes()) {
      if (tb.length_cm == null || tb.shape === "curved") continue;
      const d = Math.abs(tb.length_cm - gesucht);
      if (d < bestD) { bestD = d; best = tb; }
    }
    return best ? best.id : null;
  }

  /**
   * Kopie an den Zeiger haengen. Sie steckt ab sofort IM Modell (nur so
   * zeichnet die Szene sie und nur so laesst sich auf Kollisionen pruefen);
   * abgebrochen wird ueber den Schnappschuss.
   */
  startPaste(frag, opts = {}) {
    if (!frag) return false;
    this.cancelPaste();
    this.setMode("select");
    this._paste = {
      frag,
      before: JSON.stringify(this.model.toJSON()),
      collidedBefore: this.model.collisions(),
      offset: null,
      ids: null,
      valid: true,
      planeY: frag.anchor[1],
      flat: !!opts.flat,
    };
    this.selection.clear();
    // Erste Lage: dort, wo der Zeiger zuletzt stand.
    const zeiger = this._lastPointer;
    const p = zeiger ? this._pastePoint(zeiger.x, zeiger.y) : null;
    this._placePaste(p);
    this.scene.setCursor("copy");
    return true;
  }

  /** Bezugspunkt der Schiebe-Ebene: XZ vom Ausschnitt, Y per Pfeiltasten. */
  _pasteOrigin() {
    const d = this._paste;
    const a = d.frag.anchor;
    const y = d.flat ? a[1] : (d.planeY != null ? d.planeY : a[1]);
    return [a[0], y, a[2]];
  }

  /**
   * Zeigerpunkt fuer das Einfuegen. Waagerecht folgt die Kopie dem Zeiger;
   * die Hoehe bleibt, bis man sie mit den Pfeiltasten aendert.
   * Gerade per Taste gehoben: Zeiger unbewegt dann XZ festhalten -- sonst
   * wuerde der Strahl auf der neuen Ebene woanders auftreffen.
   */
  _pastePoint(clientX, clientY) {
    const d = this._paste;
    const pin = d.pinnedPointer;
    if (pin && Math.hypot(clientX - pin.x, clientY - pin.y) < 2) {
      const xz = d.gridOffset || d.offset || d.frag.anchor;
      return { x: xz[0], y: this._pasteOrigin()[1], z: xz[2] };
    }
    d.pinnedPointer = null;
    return this.scene.pointOnPlane(clientX, clientY, this._pasteOrigin(), [0, 1, 0]);
  }

  /**
   * Eine Etage hoch/runter (Pfeiltasten / Bild-auf/ab). steps ist +1 oder -1.
   * Nur die Hoehe aendern; die waagerechte Lage bleibt, solange der Zeiger ruht.
   */
  nudgePasteY(steps) {
    const d = this._paste;
    if (!d || d.flat) return false;
    const a = d.frag.anchor;
    const cur = d.planeY != null ? d.planeY : a[1];
    d.planeY = Math.max(0, cur + steps * this.moveStep);
    if (this._lastPointer) d.pinnedPointer = { x: this._lastPointer.x, y: this._lastPointer.y };
    const xz = d.gridOffset || d.offset || a;
    this._placePaste({ x: xz[0], y: d.planeY, z: xz[2] });
    return true;
  }

  /**
   * Kopie an einen Weltpunkt setzen. Die Koordinaten im Fragment liegen relativ
   * zu seiner Ecke -- der Versatz IST also die Stelle, an der diese Ecke landen
   * soll: waagerecht dem Zeiger nach, in der Hoehe der gewaehlten Etage.
   *
   * Gerastert wird vom URSPRUNG aus, nicht vom Nullpunkt der Welt: sonst rutscht
   * eine Kopie um bis zu einen halben Schritt zur Seite, sobald das Original
   * nicht selbst auf dem Raster liegt (importierte und gedrehte Aufbauten tun
   * das oft nicht). So bleibt sie in derselben Teilung wie ihre Vorlage.
   *
   * 挪动时不吸附，只在当前高度上平移；放下时若接点已经重合再合并去重。
   */
  _placePaste(point) {
    const d = this._paste;
    const a = d.frag.anchor;
    const schritt = this.moveStep;
    const raster = (v, ref) => ref + Math.round((v - ref) / schritt) * schritt;
    const yRef = d.flat ? a[1] : (d.planeY != null ? d.planeY : a[1]);
    const y = raster(yRef, a[1]);
    const grid = point
      ? [raster(point.x, a[0]), y, raster(point.z, a[2])]
      : (d.gridOffset || [a[0], y, a[2]]);
    if (d.gridOffset && grid[0] === d.gridOffset[0] && grid[1] === d.gridOffset[1] && grid[2] === d.gridOffset[2]) return;
    if (!d.ids) {
      d.ids = this.model.insertFragment(d.frag, grid);
      d.sel = this._fragmentSelection(d.ids);
      d.offset = grid.slice();
    } else {
      const o = d.offset;
      this.model.translateSelection(d.sel, grid[0] - o[0], grid[1] - o[1], grid[2] - o[2]);
      d.offset = grid.slice();
    }
    d.gridOffset = grid.slice();
    d.valid = !this._troubleWith(d.sel, d.collidedBefore);
    this.refresh();
  }

  /** 吸附半径：一个对角栅格步，半格偏了也能贴上 40 cm 节点。 */
  _snapRadius() {
    return this.moveStep * Math.SQRT2 + 1;
  }

  /** Auswahl-Karte ueber alles, was ein eingesetztes Fragment mitgebracht hat. */
  _fragmentSelection(ids) {
    const sel = new Map();
    for (const id of ids.nodes) sel.set(id, "node");
    for (const id of ids.tubes) sel.set(id, "tube");
    for (const id of ids.panels) sel.set(id, "panel");
    for (const id of ids.textiles) sel.set(id, "textile");
    for (const id of ids.clamps) sel.set(id, "clamp");
    for (const id of ids.slides) sel.set(id, "slide");
    for (const id of ids.fittings) sel.set(id, "fitting");
    return sel;
  }

  /**
   * Steht die bewegte Auswahl gerade schlecht? Liefert die Teile, die rot
   * gezeichnet werden sollen -- oder null, wenn alles passt. Gezaehlt werden
   * nur NEUE Ueberlagerungen: was vorher schon uebereinander lag, blockiert
   * nicht. Geprueft wird ausschliesslich gegen die bewegten Rohre.
   */
  _troubleWith(sel, collidedBefore) {
    const tg = this.model.moveTargets(sel);
    const schlecht = new Set();
    for (const id of this.model.collisions({
      only: this.model.tubesAt(tg.nodes),
      allowCoincide: true,
    }))
      if (!collidedBefore.has(id)) schlecht.add(id);
    for (const id of tg.nodes) {
      const n = this.model.nodes.get(id);
      if (n && this.model.isBelowGround(n.y)) schlecht.add(id);
    }
    for (const id of tg.clamps) {
      const c = this.model.clamps.get(id);
      if (c && this.model.isBelowGround(c.y)) schlecht.add(id);
    }
    return schlecht.size ? schlecht : null;
  }

  _updatePaste(e) {
    const d = this._paste;
    if (!d) return;
    // Mit gedrueckter Taste wird gedreht -- die Kopie bleibt so lange stehen.
    if (e.buttons & 1) return;
    const p = this._pastePoint(e.clientX, e.clientY);
    if (p) this._placePaste(p);
  }

  /** Kopie absetzen. Nur an einer gueltigen Stelle; sonst bleibt sie haengen. */
  commitPaste() {
    const d = this._paste;
    if (!d) return false;
    if (!d.valid) { this.onNotice(t("notice_collision"), "warn"); return false; }
    this._paste = null;
    this.scene.setCursor("default");
    const merged = this.model._mergeMovedNodes(new Set(d.ids.nodes));
    // Die Kopie ist die neue Auswahl -- so laesst sie sich gleich weiterschieben.
    // Und zwar VOLLSTAENDIG: Kupplungen ohne Rohr und Klemmen standen sonst
    // beim naechsten Verschieben stehen, weil `moveTargets` nur mitnimmt, was
    // wirklich markiert ist (Rohre bringen nur ihre eigenen Enden mit).
    this.selection = new Map(d.sel || this._fragmentSelection(d.ids));
    this._pruneSelection();
    this._pushHistory(d.before);
    this.onNotice(merged ? t("notice_paste_merged", merged) : t("notice_pasted"));
    this.refresh();      // erst hier zählt die Kopie als Änderung
    return true;
  }

  /**
   * Stand VOR dem Einfuegen. Die Oberflaeche sichert ihn statt des laufenden
   * Modells: die Kopie am Zeiger ist noch nicht abgesetzt und gehoert weder in
   * die Sitzung noch in die Datei.
   */
  pasteSnapshot() {
    return this._paste ? JSON.parse(this._paste.before) : null;
  }

  /** Einfuegen abbrechen -- das Modell steht wieder wie vorher. */
  cancelPaste() {
    const d = this._paste;
    if (!d) return false;
    this._paste = null;
    this.model.loadJSON(JSON.parse(d.before));
    this.scene.setCursor("default");
    this.refresh();
    return true;
  }

  // Ein Verschiebe-Versuch. Die Kupplungs-Pruefung wird hereingereicht, damit
  // model.js den Katalog nicht kennen muss.
  _move(dx, dy, dz) {
    return this.model.moveSelection(this.selection, dx, dy, dz,
      { merge: true, validate: infeasibleConnectors, snapDist: this._snapRadius() });
  }

  // Gemeinsamer Abschluss von Tasten- und Zieh-Verschiebung.
  _afterMove(beforeJson, res) {
    // Zusammengelegte Kupplungen gibt es nicht mehr -> aus der Auswahl nehmen.
    this._pruneSelection();
    this._pushHistory(beforeJson);
    const parts = [];
    if (res.detached) parts.push(t("notice_move_detached", res.detached));
    if (res.merged) parts.push(t("notice_move_merged", res.merged));
    if (parts.length) this.onNotice(parts.join(" "));
    this.refresh();
  }

  /** Zustand von VOR einer Aenderung in die Historie legen (siehe recordHistory). */
  _pushHistory(beforeJson) {
    const after = JSON.stringify(this.model.toJSON());
    if (after === beforeJson) return;
    this._undoStack.push(beforeJson);
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this._redoStack = [];
    this.onHistoryChange();
  }

  /** Ein echtes Rohr -- keine Arm-Huelse und keine Doppelrohr-Verbindung. */
  _realTube(id) {
    const t = this.model.tubes.get(id);
    return !!t && !t.arm && !t.link;
  }

  /** Ein GERADES echtes Rohr -- Klemmen und Raeder sitzen nur auf solchen. */
  _straightTube(id) {
    const t = this.model.tubes.get(id);
    return !!t && !t.arm && !t.link && !t.bow;
  }

  /**
   * Taugt dieses Rohr als Tragrohr fuer die gewaehlte Platte bzw. das Netz?
   * Ist schon eines gewaehlt, zaehlen nur noch die hervorgehobenen Gegenrohre --
   * die stecken in this.highlight und kommen hier gar nicht erst an.
   */
  _railUsable(id, lattice = false) {
    const t = this.model.tubes.get(id);
    if (!t || t.arm || t.link || t.bow) return false;
    if (this.panelRail) return this.highlight ? this.highlight.has(id) : false;
    if (lattice) return this._railPartners(id).length > 0;
    const dims = this._panelDims();
    return !!dims && this.model.panelPartners(id, dims).length > 0;
  }

  /** Laesst sich an dieser Stelle ein Ziehen der Auswahl beginnen? */
  _isMoveHandle(id) {
    return this.mode === "select" && this.selection.size > 0 && this.selection.has(id);
  }

  _beginMoveDrag(e, pick) {
    const origin = pick.point.clone();
    this._drag = {
      origin,
      // Zustand vor dem Ziehen: der ganze Zug wird EIN Undo-Schritt.
      before: JSON.stringify(this.model.toJSON()),
      applied: [0, 0, 0],
      // Letzte Lage, an der die Auswahl wirklich passt -- dorthin faellt sie
      // zurueck, wenn losgelassen wird, waehrend es rot ist.
      lastValid: [0, 0, 0],
      gridWant: [0, 0, 0],
      // Was vorher schon uebereinander lag, zaehlt nicht als neue Kollision.
      collidedBefore: this.model.collisions(),
      invalid: null,
      result: null,
      axes: this.scene.dragAxes(),
    };
    // Die Verbindungen zum stehenden Rest gleich trennen: ein Rohr, von dem nur
    // ein Ende mitwandert, kann nicht mitwandern (Rohre haben feste Laengen).
    // Ohne das zogen sich die angrenzenden Rohre waehrend des Ziehens in die
    // Laenge und sprangen erst beim Loslassen zurueck. Der echte Zug rechnet
    // beim Loslassen ohnehin vom Ausgangsstand aus neu.
    this.model.detachSelection(this.selection);
    this.scene.setCursor("grabbing");
    this.refresh();
  }

  _updateMoveDrag(e) {
    const d = this._drag;
    const p = this.scene.dragPlanePoint(e.clientX, e.clientY, d.origin);
    if (!p) return;
    const off = p.sub(d.origin);
    const { u, v } = d.axes;
    // Zeiger-Versatz auf die beiden Schiebe-Achsen projizieren und je Achse
    // auf das Raster runden.
    const schritt = this.moveStep;
    const su = Math.round((off.x * u[0] + off.y * u[1] + off.z * u[2]) / schritt) * schritt;
    const sv = Math.round((off.x * v[0] + off.y * v[1] + off.z * v[2]) / schritt) * schritt;
    const want = [
      u[0] * su + v[0] * sv,
      u[1] * su + v[1] * sv,
      u[2] * su + v[2] * sv,
    ];
    const a = d.applied;
    if (d.gridWant && want[0] === d.gridWant[0] && want[1] === d.gridWant[1] && want[2] === d.gridWant[2]) return;
    d.gridWant = want.slice();
    // Klemm-Kupplung: sie kann ihr Rohr nicht verlassen -- der Zeiger wird auf
    // die Rohrachse projiziert, statt frei im Raster zu schieben.
    const clamp = this._draggedClamp();
    if (clamp) {
      this.model.loadJSON(JSON.parse(d.before));
      const target = [d.origin.x + want[0], d.origin.y + want[1], d.origin.z + want[2]];
      if (this.model.slideTubeClamp(clamp, target, geometry().connectorSize)) {
        d.applied = want;
        d.result = { merged: 0, detached: 0 };
      }
      // Die Klemme gleitet auf ihrem Rohr statt im Raster zu wandern -- beim
      // Loslassen steht das Modell deshalb schon richtig und darf nicht noch
      // einmal ueber _move() geschoben werden.
      d.slid = true;
      this.refresh();
      return;
    }
    // Die Vorschau VERSCHIEBT nur -- sie trennt nichts, legt nichts zusammen
    // und prueft keine Kupplungen. Das faellt einmal beim Loslassen an. Frueher
    // wurde je Rasterschritt das ganze Modell neu geladen und ein vollstaendiger
    // Zug gerechnet; bei grossen Modellen ruckelte das Ziehen dadurch.
    this.model.translateSelection(this.selection, want[0] - a[0], want[1] - a[1], want[2] - a[2]);
    const extra = this.model.snapOffsetFor(this.model.moveTargets(this.selection).nodes, this._snapRadius());
    if (extra[0] || extra[1] || extra[2]) {
      this.model.translateSelection(this.selection, extra[0], extra[1], extra[2]);
      want[0] += extra[0]; want[1] += extra[1]; want[2] += extra[2];
    }
    d.applied = want;
    d.invalid = this._troubleWith(this.selection, d.collidedBefore);
    if (!d.invalid) d.lastValid = want.slice();
    this.refresh();
  }

  // Ist genau EINE Klemm-Kupplung ausgewaehlt? Dann bestimmt ihr Rohr den Weg.
  _draggedClamp() {
    if (this.selection.size !== 1) return null;
    const [id, kind] = [...this.selection][0];
    if (kind !== "node") return null;
    const n = this.model.nodes.get(id);
    return n && n.clampOn ? id : null;
  }

  _endMoveDrag() {
    const d = this._drag;
    this._drag = null;
    this.scene.setCursor("default");
    if (!d) return;
    // Die gleitende Klemm-Kupplung ist schon an ihrem Platz.
    if (d.slid) { this._afterMove(d.before, d.result || { merged: 0, detached: 0 }); return; }
    // Beim Loslassen zaehlt die letzte Lage, an der es passt: ueber einer
    // belegten Stelle rutscht die Auswahl dorthin zurueck.
    const ziel = d.invalid ? d.lastValid : d.applied;
    if (d.invalid) this.onNotice(t("notice_move_collision"), "warn");
    // Die Vorschau hat nur verschoben -- jetzt der echte Zug von der
    // Ausgangslage aus, mit Trennen, Zusammenlegen und Kupplungs-Pruefung.
    this.model.loadJSON(JSON.parse(d.before));
    if (!ziel[0] && !ziel[1] && !ziel[2]) { this.refresh(); return; }
    const res = this._move(ziel[0], ziel[1], ziel[2]);
    if (!res.ok) {
      // Das faellt nur auf, was die Vorschau nicht sehen kann (etwa eine
      // Kupplung, die es beim Zusammenlegen nicht gibt).
      this.onNotice(t("notice_move_" + res.reason), "warn");
      this.refresh();
      return;
    }
    this._afterMove(d.before, res);
  }

  // Anbauteil loeschen -- Laufrolle und ihr Adapter gehoeren zusammen und gehen
  // gemeinsam, egal welches der beiden ausgewaehlt war.
  _removeFittingWithRider(id) {
    const f = this.model.fittings.get(id);
    if (!f) return;
    const partner = f.kind === "casters2" ? "adapter2" : f.kind === "adapter2" ? "casters2" : null;
    if (partner) {
      for (const o of [...this.model.fittings.values()]) {
        if (o.kind === partner && Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z) < 2) {
          this.model.removeFitting(o.id);
        }
      }
    }
    this.model.removeFitting(id);
  }

  /**
   * Sind genau die Rohre gewaehlt, die beim Klick auf EIN Verstaerkungsprofil
   * zusammenkamen? Dann meint die Auswahl das Profil, nicht die Rohre.
   */
  _profilGewaehlt() {
    const p = this._profilAuswahl;
    return !!p && p.size === this.selection.size
      && [...this.selection.keys()].every((x) => p.has(x));
  }

  /** Loescht alle ausgewaehlten Teile. Kupplungen zuletzt (nehmen Rohre mit). */
  deleteSelection() {
    if (!this.selection.size) return 0;
    // Ein gewaehltes Verstaerkungsprofil: nur das Profil kommt heraus, die
    // Rohre bleiben stehen. Sie sind ja nicht angeklickt worden -- sie tragen
    // es nur.
    if (this._profilGewaehlt()) {
      const rohre = [...this.selection.keys()];
      this.recordHistory(() => { this.model.removeReinforcement(rohre[0]); });
      this.selection.clear();
      this._profilAuswahl = null;
      this.refresh();
      return rohre.length;
    }
    const entries = [...this.selection];
    // Kupplungen, an denen das Geloeschte haengt: sie koennten danach ohne
    // jeden Anschluss dastehen und werden dann mit weggeraeumt.
    const nachbarn = this.model.neighborNodeIds(entries.map(([id]) => id));
    this.recordHistory(() => {
      for (const [id, kind] of entries) {
        if (kind === "tube") this.model.removeTube(id);
        else if (kind === "panel") this.model.removePanel(id);
        else if (kind === "textile") this.model.removeTextile(id);
        else if (kind === "slide") this.model.removeSlide(id);
        else if (kind === "clamp") this.model.removeClamp(id);
        else if (kind === "fitting") this._removeFittingWithRider(id);
        else if (kind === "hinge") {
          const teil = splitHingeKey(id);
          if (teil) this.model.removeHinge(teil.nodeId, teil.index);
        }
      }
      for (const [id, kind] of entries) {
        if (kind !== "node") continue;
        // Eine Winkelkupplung haelt zwei Enden zusammen, die fuer sich
        // weiterbestehen: sie kommt heraus, die Rohre bleiben und tragen
        // wieder Dummy-Kupplungen (`removeC45`). Erst danach die gewoehnliche
        // Loeschung, die auch die Rohre mitnimmt.
        const n = this.model.nodes.get(id);
        if (n && n.c45body && this.model.removeC45(id)) continue;
        this.model.removeNode(id);
      }
      for (const [id] of entries) nachbarn.delete(id);
      this.model.removeEmptyNodes(nachbarn);
    });
    if (this.selectedNodeId && !this.model.nodes.has(this.selectedNodeId)) this.selectedNodeId = null;
    const n = entries.length;
    this.selection.clear();
    this.refresh();
    return n;
  }

  /**
   * Nach dem Laden/Importieren eines anderen Modells aufrufen: Auswahl und
   * Bau-Kupplung zeigen sonst auf gleichnamige ids des NEUEN Modells (die
   * Zaehler starten wieder bei 1) -- _pruneSelection findet das nicht.
   */
  modelReplaced() {
    this.selection.clear();
    this.selectedNodeId = null;
  }

  /**
   * Zustand, der zu EINEM Modell gehört: gewähltes Bauteil, Modus, Ansichts-
   * schalter und die Schrittspeicher. Beim Wechsel zwischen Tabs wird er
   * gesichert und wieder eingesetzt -- jede Datei behält so ihre eigene
   * Werkzeugleiste. Alles darin ist JSON-tauglich (die Schrittspeicher halten
   * ohnehin nur Modell-Abzüge).
   */
  uiState() {
    return {
      mode: this.mode, tubeId: this.tubeId, panelId: this.panelId,
      fittingKind: this.fittingKind, poolLinerId: this.poolLinerId,
      clampPart: this.clampPart, slideKind: this.slideKind,
      color: this.color,
      assemblyOrder: this.assemblyOrder, assemblyStep: this.assemblyStep,
      undo: this._undoStack.slice(), redo: this._redoStack.slice(),
    };
  }

  /** Gegenstück zu uiState(). Der Modus wird NICHT hier gesetzt -- das macht
   *  die Oberfläche über setMode(), damit die Knöpfe mitziehen. */
  setUiState(s = {}) {
    if (s.tubeId) this.tubeId = s.tubeId;
    if (s.panelId) this.panelId = s.panelId;
    if (s.fittingKind) this.fittingKind = s.fittingKind;
    this.poolLinerId = s.poolLinerId || null;
    if (s.clampPart) this.clampPart = s.clampPart;
    if (s.slideKind) this.slideKind = s.slideKind;
    if (s.color) this.color = s.color;
    if (s.assemblyOrder) this.assemblyOrder = s.assemblyOrder;
    this.assemblyStep = s.assemblyStep || 0;
    this._undoStack = Array.isArray(s.undo) ? s.undo.slice() : [];
    this._redoStack = Array.isArray(s.redo) ? s.redo.slice() : [];
    this.selection.clear();
    this.selectedNodeId = null;
    this.highlight = null;
    this.panelRail = null;
    this.reinforceRail = null;
    this.onHistoryChange();
  }

  /**
   * Teile fuer eine reine Sicht-Hervorhebung markieren (z. B. eine Zeile im
   * Bestand). Unabhaengig von der Cursor-Auswahl: nichts wird dadurch
   * loeschbar oder umfaerbbar, und es gilt in jedem Modus.
   */
  setHighlight(ids) {
    this.highlight = ids && ids.size ? ids : null;
    this.refresh();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.refresh();
  }

  /** Nach Undo/Redo/Import: Auswahl auf noch existierende Teile eindampfen. */
  _pruneSelection() {
    // Jede Art, die in der Auswahl vorkommen kann -- fehlt eine, faellt sie hier
    // stillschweigend heraus (die Anbauteile taten das jahrelang).
    const maps = {
      tube: this.model.tubes, panel: this.model.panels, node: this.model.nodes,
      textile: this.model.textiles, slide: this.model.slides, clamp: this.model.clamps,
      fitting: this.model.fittings,
    };
    for (const [id, kind] of [...this.selection]) {
      const map = maps[kind];
      if (!map || !map.has(id)) this.selection.delete(id);
    }
  }


  // Anzahl der Rohre, die sich mit einem anderen ueberlagern.

  // Rohr fuer eine Schraege: die in der Toolbar gewaehlte Laenge. Nur wenn dort
  // ein Bogenrohr steht (keine gerade Laenge), greift der Katalog-Standard.
  _diagonalTube() {
    const sel = getTube(this.tubeId);
    return sel && sel.length_cm != null ? sel : getTube(diagonalTubeId());
  }

  // --- Aufbaumodus -------------------------------------------------------
  // Aufbauplan (neu) berechnen und beim aktuellen Schritt bleiben (geklemmt).
  enterAssembly() {
    this.buildPlan = computeBuildPlan(this.model, this.assemblyOrder);
    const max = Math.max(0, this.buildPlan.steps.length - 1);
    this.assemblyStep = Math.min(this.assemblyStep, max);
  }

  // Aufbaurichtung wechseln: Plan neu rechnen und beim ersten Schritt beginnen.
  setAssemblyOrder(order) {
    if (this.assemblyOrder === order) return;
    this.assemblyOrder = order;
    this.assemblyStep = 0;
    if (this.mode === "assembly") { this.enterAssembly(); this.refresh(); }
  }

  assemblyCount() { return this.buildPlan.steps.length; }
  currentStep() { return this.buildPlan.steps[this.assemblyStep] || null; }

  setAssemblyStep(i) {
    const max = this.buildPlan.steps.length - 1;
    this.assemblyStep = Math.max(0, Math.min(i, max));
    this.refresh();
  }

  // Sichtbarkeit fuer den Aufbaumodus: bereits gebaute vs. aktueller Schritt.
  _assemblyVisibility() {
    const done = new Set();
    const current = new Set();
    const steps = this.buildPlan.steps;
    for (let k = 0; k <= this.assemblyStep && k < steps.length; k++) {
      const s = steps[k];
      const target = k === this.assemblyStep ? current : done;
      for (const id of s.nodeIds) target.add(id);
      for (const id of s.tubeIds) target.add(id);
      for (const id of s.panelIds) target.add(id);
      for (const id of s.textileIds || []) target.add(id);
      for (const id of s.slideIds || []) target.add(id);
    }
    return { done, current };
  }

  // Ein Bau-Schritt per Tastatur: vom ausgewaehlten Knoten in Richtung dirVec.
  buildStep(dirVec) {
    if (this.model.isEmpty()) {
      this.recordHistory(() => {
        // Erste Kupplung auf y = 0, genau wie beim Klick auf den Ursprung --
        // der Würfel steht damit auf dem Boden statt darüber.
        this.selectedNodeId = this.model.addNode(0, 0, 0).id;
      });
      this.refresh();
      return;
    }
    const node = this.selectedNodeId && this.model.nodes.get(this.selectedNodeId);
    if (!node) return;
    const tube = getTube(this.tubeId);
    let res;
    this.recordHistory(() => {
      res = isCurvedTube(this.tubeId)
        ? this.model.extendBow(node.id, dirVec, this._bowNormal(dirVec), this.tubeId, this.colorFor("tube", node.id), gridSpacing())
        : this.model.extend(
            node.id, dirVec, this.tubeId, this.colorFor("tube", node.id), tube.length_cm, spacingFor(tube.length_cm)
          );
    });
    if (res && res.ground) this.onNotice(t("notice_ground"), "warn");
    else if (res && res.collision) this.onNotice(t("notice_collision"), "warn");
    else if (res && res.tube) this._notePlaced(res.tube.id, "tube");
    // Der Ankerpunkt wandert ans neue Rohrende -- sonst müsste man jede
    // Richtung zweimal drücken: einmal bauen, einmal hinlaufen.
    if (res && res.node) this.selectedNodeId = res.node.id;
    this.refresh();
  }

  // Krummungsrichtung (zum Kreismittelpunkt) eines neu gesetzten Bogenrohrs:
  // waagerecht angesetzt krummt der Bogen nach UNTEN (der ueblichste Fall --
  // Geruestkante, Dachbogen), senkrecht angesetzt in die Blickrichtung, damit
  // der Bogen vom Betrachter weg schwingt statt zufaellig zur Seite.
  _bowNormal(dirVec) {
    if (Math.abs(dirVec[1]) < 0.5) return [0, -1, 0];
    const ax = this.scene.getHorizontalAxes ? this.scene.getHorizontalAxes() : null;
    const f = (ax && (ax.forward || ax.f)) || [0, 0, -1];
    return Math.abs(f[0]) >= Math.abs(f[2])
      ? [Math.sign(f[0]) || 1, 0, 0]
      : [0, 0, Math.sign(f[2]) || -1];
  }

  // Steckt am Knoten schon etwas in Arm-Richtung `axis`? Zaehlt echte Rohre UND
  // bereits gesteckte C45-Adapter (deren Arm-Kante zeigt ~kardinal in Huelsen-
  // richtung); nur reine Doppelrohr-Links zaehlen nicht. Dann ist dort kein Platz
  // fuer eine weitere Winkelkupplung/Huelse.
  _armOccupied(node, axis) {
    // Ein Anbauteil im Stutzen belegt ihn genauso wie ein Rohr -- die
    // Multirad-Arretierung schliesst ihn sogar ab. Ohne diese Pruefung bot der
    // Winkelkupplungs-Modus dort weiter einen Ankerpunkt an, waehrend der
    // Bau-Modus daneben schon keinen mehr zeigte (_occupiedDirs).
    for (const d of armFittingDirsAt(this.model, node)) {
      if (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2] > 0.9) return true;
    }
    for (const t of this.model.tubes.values()) {
      if (t.link) continue;
      let nb = null;
      if (t.a === node.id) nb = this.model.nodes.get(t.b);
      else if (t.b === node.id) nb = this.model.nodes.get(t.a);
      if (!nb) continue;
      // Bereits gesteckter C45-Adapter: seine Huelse sitzt auf nb.c45axis-Arm
      // (die Arm-Kante selbst zeigt nicht sauber kardinal).
      if (t.arm) {
        const a = nb.c45body && nb.c45axis;
        if (a && a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2] > 0.9) return true;
        continue;
      }
      // Echtes Rohr: Richtung pruefen.
      const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      if ((dx / L) * axis[0] + (dy / L) * axis[1] + (dz / L) * axis[2] > 0.9) return true;
    }
    return false;
  }

  /** Meldet unten links, was gerade gesetzt wurde. */
  _notePlaced(id, kind) {
    const name = this._partLabel(id, kind);
    if (name) this.onNotice(t("notice_placed", name));
  }

  /**
   * Volle Bezeichnung eines Teils -- die des Katalogs, keine Kurzform. Wird
   * angezeigt, sobald im Auswahl-Modus genau ein Teil gewaehlt ist.
   */
  _partLabel(id, kind) {
    const m = this.model;
    if (kind === "hinge") {
      const def = getConnector(HINGE_PART);
      return def ? partName(def) : null;
    }
    if (kind === "tube") {
      const t = m.tubes.get(id);
      const def = t && getTube(t.tubeId);
      return def ? partName(def) : null;
    }
    if (kind === "panel") {
      const p = m.panels.get(id);
      const def = p && getPanel(p.panelId);
      return def ? partName(def) : null;
    }
    if (kind === "textile") {
      // Ein Tuch hat kein Katalogteil je Groesse -- es gibt EINES, seine Masse
      // stehen am Teil. Ohne diesen Zweig suchte der Name ein `panelId`, das es
      // hier nicht gibt, und die Auswahl zeigte "null".
      const x = m.textiles.get(id);
      if (!x) return null;
      const def = accessories().find((a) => a.qdf === "textil2");
      const name = def ? partName(def) : t("bom_textile");
      return x.w && x.h ? `${name} ${x.w}×${x.h} cm` : name;
    }
    if (kind === "clamp") {
      const c = m.clamps.get(id);
      const def = c && getPartById(c.connectorId || "double_tube");
      return def ? partName(def) : null;
    }
    if (kind === "fitting") {
      const f = m.fittings.get(id);
      if (!f) return null;
      // Das Baellebad hat keine eigene QDF-Zuordnung im Katalog: gekauft wird
      // die Poolfolie, und die haengt an der Groesse des Beckens.
      if (POOL_KINDS.has(f.kind)) {
        const folie = poolLinerFor(Math.abs(f.w || 0), Math.abs(f.d || 0));
        return folie ? partName(folie) : null;
      }
      const def = partForFitting(f.kind, f.mask);
      return def ? partName(def) : null;
    }
    if (kind === "slide") {
      const sl = m.slides.get(id);
      return sl ? slideKindName(sl.kind) : null;
    }
    if (kind === "node") {
      const n = m.nodes.get(id);
      if (!n) return null;
      if (n.part) { const def = getPartById(n.part); return def ? partName(def) : null; }
      const type = inferConnectorType(m, n);
      const def = type && getConnector(type);
      return def ? partName(def) : null;
    }
    return null;
  }

  selectNode(id) {
    this.selectedNodeId = id;
    this.refresh();
  }

  refresh() {
    const assembly = this.mode === "assembly" && this.buildPlan.steps.length
      ? this._assemblyVisibility() : null;
    // Genau EIN gewaehltes Teil: dessen Namen anzeigen. Nur dann -- alle Namen
    // auf einmal machten das Bild unleserlich, deshalb gibt es den frueheren
    // Schalter "Kupplungsnamen" nicht mehr.
    // Ein Verstaerkungsprofil ist mehr als seine Rohre: es steckt in einem oder
    // zwei davon, und beim Klick darauf sind sie alle gewaehlt. Dann gilt sein
    // Name -- sonst stuende dort "Rohr 35" oder (bei zwei Rohren) gar nichts.
    const profil = this._profilGewaehlt() ? [...this.selection.keys()][0] : null;
    const soloId = (this.mode === "select" || this.mode === "assembly")
      ? (profil != null ? profil : (this.selection.size === 1 ? [...this.selection.keys()][0] : null))
      : null;
    const withLabels = this.manualLabels || soloId != null;
    const labelFor = withLabels ? (node) => connectorLabelInfo(this.model, node) : null;
    const slideNameFor = withLabels ? (sl) => slideKindLabel(sl.kind) : null;
    // Ein Scharnier haengt am Bolzen-Knoten und hat keine eigene Stelle im
    // Bild -- seine Beschriftung sitzt deshalb am Knoten.
    const scharnier = soloId != null ? splitHingeKey(soloId) : null;
    const labelAn = scharnier ? scharnier.nodeId : soloId;
    const labelIds = this.manualLabels ? null : (labelAn != null ? new Set([labelAn]) : null);
    const soloLabel = soloId != null
      ? { id: labelAn, text: profil != null
        ? (reinforcementPart() ? partName(reinforcementPart()) : null)
        : this._partLabel(soloId, this.selection.get(soloId)) } : null;
    // Vorschlaege, welche Rohre ein Verstaerkungsprofil gebrauchen koennten --
    // sichtbar genau dann, wenn man verstaerkt.
    const suggest = this.mode === "reinforce" ? this.model.reinforcementSuggestions() : null;
    const reinforce = this.mode === "reinforce";
    // Kollisions-Modus: immer ein Set (auch leeres), damit die Szene den Modus
    // erkennt und die uebrigen Rohre grau zeichnet.
    const selected = (this.mode === "select" || this.mode === "assembly") && this.selection.size
      ? this.selection : null;
    // An einer belegten Stelle werden die betroffenen Teile rot gezeichnet --
    // beim Einfuegen die ganze Kopie, beim Ziehen die gezogene Auswahl.
    const invalid = this._paste && !this._paste.valid && this._paste.sel
      ? new Set(this._paste.sel.keys())
      : (this._drag && this._drag.invalid ? new Set(this.selection.keys()) : null);
    this.scene.renderModel(this.model, this.selectedNodeId,
      { labelFor, slideNameFor, labelIds, soloId, soloLabel, assembly, suggest, reinforce,
        selected, highlight: this.highlight, invalid,
        focusId: this.panelRail ? this.panelRail.id : null });
    this._buildHandles();
    this.scene.requestRender();
    // Waehrend einer Vorschau (Ziehen, Kopie am Zeiger) bleibt die Oberflaeche
    // aussen vor: Stueckliste und Sitzung rechnen sonst bei jedem Rasterschritt
    // mit, obwohl der Stand noch gar nicht gilt. Beim Absetzen wird ohnehin neu
    // gezeichnet -- dann laeuft es einmal. Nur die Knoepfe, die vom Zustand
    // abhaengen (Drehen), werden nachgezogen.
    if (!this._paste && !this._drag && !this._clampDrag && !this._clampSlide) this.onChange();
    else this.onPreview();
  }

  // --- Handles ------------------------------------------------------------
  _buildHandles() {
    this.scene.clearHandles();
    // Ankerpunkte von Teilen, die frei auf einem Rohr sitzen -- sie wandern
    // unter dem Mauszeiger mit (siehe _trackTubeHandles).
    this._tubeHandles = new Map();
    // Waehrend eine Zeile aus Stueckliste, Bestand oder Aufbau hervorgehoben
    // ist, bleiben die gruenen Punkte weg: dort schaut man sich das Modell an,
    // und die Punkte legen sich nur davor. Die Hervorhebungen der Platten- und
    // Verstaerkungs-Ablaeufe gehoeren dagegen zum Setzen und bleiben.
    if (this.highlight && !this.panelRail && !this.reinforceRail) return;
    // Im Platten-Modus klickt man zwei Rohre an -- keine Flaechen-Handles.
    if (this.mode === "panel") return;
    if (this.mode === "slide") { this._buildSlideHandles(); return; }
    if (this.mode === "clamp") { this._buildClampHandles(); return; }
    if (this.mode === "c45") { this._buildC45Handles(); return; }
    if (this.mode === "fitting") { this._buildFittingHandles(); return; }
    if (this.mode !== "add") return;
    if (this.placeConnectorId) { this._buildConnectorPlaceHandles(); return; }

    if (this.model.isEmpty()) {
      this.scene.addHandle([0, 0, 0], { origin: true }, "origin");
      return;
    }
    // Freie Oeffnung eines Doppelrohrverbinders/einer Rohrklammer: dort gehoert
    // ein GERADES Rohr hinein -- mit einem Bogenrohr in der Hand nicht.
    if (!isCurvedTube(this.tubeId)) {
      for (const c of this.model.clamps.values()) {
        if (!c.dir || !c.off) continue;
        // Der Punkt der Klemme liegt auf dem gehaltenen Rohr, das freie Loch
        // eine volle Lochweite daneben.
        const center = [c.x + c.off[0], c.y + c.off[1], c.z + c.off[2]];
        if (this._openingOccupied(center, c.dir)) continue;
        this.scene.addHandle(center, { clampOpening: true, center, dir: c.dir }, "dir");
      }
      // Dasselbe fuer das noch leere Maul einer Lagerkupplung: der Punkt liegt
      // GENAU auf der Achse, auf der das Rohr durchlaeuft.
      for (const o of this.model.bearingOpenings()) {
        if (this._openingOccupied(o.pos, o.dir)) continue;
        this.scene.addHandle(o.pos,
          { clampOpening: true, center: o.pos, dir: o.dir, bearingNode: o.nodeId }, "dir");
      }
    }
    // 加管始终给出所有合法锚点（短桩，悬停再展开）。加完一根后不锁在新端点。
    const nodes = [...this.model.nodes.values()]
      // Kupplungen ohne Rohr aus einer QDF-Datei werden nicht gezeichnet --
      // dann bieten sie auch keine Ankerpunkte an. Ebenso ein Rohrende unter
      // einer Rad- oder Rohrkappe: dort steckt die Kappe ANSTELLE der Kupplung,
      // ihre Punkte wuerden ins Leere zeigen.
      .filter((n) => !n.unused && !(this.model.hasWheelCap && this.model.hasWheelCap(n)));
    for (const node of nodes) this._addBuildHandles(node);
  }

  /** 在现有接头上高亮空插座：点上去换成所选通型，不在空气中长新节点。 */
  _buildConnectorPlaceHandles() {
    const typeId = this.placeConnectorId;
    if (!typeId) return;
    for (const n of this.model.nodes.values()) {
      if (!this._nodeAcceptsConnector(n, typeId)) continue;
      this.scene.addHandle([n.x, n.y, n.z], { placeNode: true, nodeId: n.id }, "place");
    }
  }

  _connTypeMask(typeId) {
    return CONN_TYPE_MASK[typeId] || 0x3f;
  }

  _axisBit(x, y, z) {
    const L = Math.hypot(x, y, z) || 1;
    x /= L; y /= L; z /= L;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) return ax < 0.94 ? 0 : (x > 0 ? 0x01 : 0x02);
    if (ay >= az) return ay < 0.94 ? 0 : (y > 0 ? 0x04 : 0x08);
    return az < 0.94 ? 0 : (z > 0 ? 0x10 : 0x20);
  }

  _maskPopcount(mask) {
    let n = 0;
    for (let b = mask; b; b &= b - 1) n++;
    return n;
  }

  /** 真实管子占用的世界轴 bit；斜管无法套普通通型。 */
  _worldOccupiedBits(node) {
    let bits = 0;
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const other = t.a === node.id ? this.model.nodes.get(t.b)
        : t.b === node.id ? this.model.nodes.get(t.a) : null;
      if (!other) continue;
      const dx = other.x - node.x, dy = other.y - node.y, dz = other.z - node.z;
      const bit = this._axisBit(dx, dy, dz);
      if (!bit) return null;
      bits |= bit;
    }
    return bits;
  }

  _connectorOrients(typeMask, occBits) {
    const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const seen = new Set();
    const out = [];
    for (const x of AXES) {
      for (const y of AXES) {
        if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]) > 0.5) continue;
        const z = [
          x[1] * y[2] - x[2] * y[1],
          x[2] * y[0] - x[0] * y[2],
          x[0] * y[1] - x[1] * y[0],
        ];
        const cols = [x, y, z];
        let turned = 0;
        for (const [bit, d] of CONNECTOR_ARM_BITS) {
          if (!(typeMask & bit)) continue;
          const i = d[0] ? 0 : d[1] ? 1 : 2;
          const s = d[0] || d[1] || d[2];
          const c = cols[i];
          turned |= this._axisBit(c[0] * s, c[1] * s, c[2] * s);
        }
        if ((turned & occBits) !== occBits) continue;
        if (seen.has(turned)) continue;
        seen.add(turned);
        out.push(quatFromBasis(x, y, z));
      }
    }
    return out;
  }

  _nodeAcceptsConnector(node, typeId) {
    if (!node || node.unused || node.c45body || node.part) return false;
    if (this.model.hasWheelCap && this.model.hasWheelCap(node)) return false;
    const occ = this._worldOccupiedBits(node);
    if (occ == null) return false;
    const mask = this._connTypeMask(typeId);
    const used = this._maskPopcount(occ);
    const arms = this._maskPopcount(mask);
    if (used >= arms) return false;
    if (!occ) return true;
    return this._connectorOrients(mask, occ).length > 0;
  }

  _quatClose(a, b) {
    if (!a || !b) return !a && !b;
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    return Math.abs(dot) > 0.999;
  }

  _applyConnectorType(node, typeId) {
    const occ = this._worldOccupiedBits(node);
    if (occ == null) return false;
    const mask = this._connTypeMask(typeId);
    if (!occ) {
      node.preferType = typeId;
      node.quat = null;
      return true;
    }
    const orients = this._connectorOrients(mask, occ);
    if (!orients.length) return false;
    let pick = orients[0];
    if (node.preferType === typeId && node.quat && orients.length > 1) {
      const idx = orients.findIndex((q) => this._quatClose(q, node.quat));
      pick = orients[(Math.max(idx, 0) + 1) % orients.length];
    }
    node.preferType = typeId;
    node.quat = pick;
    return true;
  }

  /**
   * In welche Schraege zeigt eine 45-Grad-Winkelkupplung? Ihr Koerper sitzt um
   * die Huelse (auf einem Arm der Kupplung) plus den 45-Grad-Arm versetzt --
   * aus der Differenz zur tragenden Kupplung und der Huelsenachse ergibt sich
   * die Richtung.
   */
  _c45ArmDir(body) {
    if (!body.c45body || !body.c45axis) return null;
    let base = null;
    for (const t of this.model.tubes.values()) {
      if (!t.arm) continue;
      const id = t.a === body.id ? t.b : t.b === body.id ? t.a : null;
      if (id) { base = this.model.nodes.get(id); break; }
    }
    if (!base) return null;
    const u = body.c45axis;
    const v = [body.x - base.x, body.y - base.y, body.z - base.z];
    const laengs = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
    const rest = [v[0] - u[0] * laengs, v[1] - u[1] * laengs, v[2] - u[2] * laengs];
    const L = Math.hypot(rest[0], rest[1], rest[2]);
    if (L < 1e-6) return null;
    // Die Schraege knickt ZURUECK ueber die Kupplung: quer zur Huelse plus die
    // GEGENrichtung der Huelsenachse -- beide zu gleichen Teilen, das sind die
    // 45 Grad.
    const d = [rest[0] / L - u[0], rest[1] / L - u[1], rest[2] / L - u[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / dl, d[1] / dl, d[2] / dl];
  }

  /** Ankerpunkte einer einzelnen Kupplung (Bau-Modus). */
  /**
   * Die sechs Arm-Richtungen einer Kupplung -- ihre EIGENEN Wuerfelachsen, nicht
   * die der Welt. Eine gedrehte Kupplung (aus der Datei oder vom Schraegbau)
   * traegt ihre Lage in `quat`; von dort kommen die Achsen exakt, in jedem
   * Winkel. `armDirs` aus aelteren Staenden ist nur der Rueckfall -- die wurden
   * beim Einlesen auf die naechste benannte Richtung GERUNDET und konnten
   * deshalb nur 0 und 45 Grad, eine 22,5-Grad-Kupplung stand damit schief.
   *
   * Liefert `null` fuer die ungedrehte Kupplung; dort gelten die Weltachsen.
   */
  _armDirsOf(node) {
    // Flexikupplung: der Bolzen hat seine beiden Stutzen auf der Achse, dazu je
    // Scharnier dessen Arm -- und sonst nichts. Sie kommen aus seiner Lage,
    // gelten also auch nach jeder Drehung eines Scharniers.
    if (isBoltPart(node.part)) {
      return boltArmDirs(node).map((v, i) => ({ name: "bolt" + i, vec: v }));
    }
    if (node.quat && node.quat.length === 4) {
      const ex = xAxisOf(node.quat), ey = yAxisOf(node.quat), ez = zAxisOf(node.quat);
      const neg = (v) => [-v[0], -v[1], -v[2]];
      return [
        { name: "+X", vec: ex }, { name: "-X", vec: neg(ex) },
        { name: "+Y", vec: ey }, { name: "-Y", vec: neg(ey) },
        { name: "+Z", vec: ez }, { name: "-Z", vec: neg(ez) },
      ];
    }
    return (node.armDirs && node.armDirs.length) ? node.armDirs : null;
  }

  _addBuildHandles(node) {
    // Gedrehte Kupplung: ihre eigenen Arm-Richtungen verwenden, sie ist bereits
    // korrekt ausgerichtet.
    const armDirs = this._armDirsOf(node);
    const hasArmDirs = !!armDirs;
    // Schraeg-Konnektor: liegt auf einer Schraege (hat schon ein Diagonalrohr) =
    // ist bereits 45-Grad gedreht.
    const isSlope = !hasArmDirs && this._hasDiagonalTube(node);
    const occupied = this._occupiedDirs(node);
    const useDiag = !hasArmDirs && isSlope;
    // Die 45-Grad-Winkelkupplung ist einarmig: sie bietet genau ihre eigene
    // Schraege an, dorthin gehoert das Rohr.
    const c45Dir = node.c45body ? this._c45ArmDir(node) : null;
    // Lochzapfenkupplung: genau EIN offenes Ende, dorthin geht das Rohr. Die
    // Lagerkupplung traegt dagegen eine ganze Kupplung -- von der geht es in
    // jede freie Richtung weiter.
    // Lochzapfenkupplung: ihre EIGENEN Arme (ein, zwei oder drei) sind die
    // Richtungen -- dorthin gehoert das Rohr. Sie gelten auch nach
    // 45-Grad-Drehungen, weil sie aus ihrer Lage kommen.
    const holeDirs = isHolePart(node.part)
      ? holeArmDirs(node).map((v, i) => ({ name: "stub" + i, vec: v })) : null;
    const dirs = c45Dir ? [{ name: "c45", vec: c45Dir }]
      : (holeDirs && holeDirs.length) ? holeDirs
      : hasArmDirs ? armDirs
      : isSlope ? (this._slopeArmDirs(node) || DIAGONAL_DIRECTIONS)
      : DIRECTIONS;
    // Der Arm, auf dem eine Lagerkupplung steckt, ist belegt -- dort gehoert
    // kein Rohr hin. Das Rohr laeuft durch ihr MAUL, quer dazu; den Punkt dafuer
    // setzt _buildHandles ueber `bearingOpenings()`.
    const lagerArm = node.bearingOn && node.stub
      ? [-node.stub[0], -node.stub[1], -node.stub[2]] : null;
    const tube = getTube(this.tubeId);
    const previewSpan = isCurvedTube(this.tubeId)
      ? 0
      : spacingFor(tube ? tube.length_cm : 35);
    const previewColor = this.color === RANDOM_COLOR ? null : this.color;
    const bowInHand = isCurvedTube(this.tubeId);
    for (const d of dirs) {
      if (occupied.has(d.name)) continue;
      if (lagerArm && (lagerArm[0] * d.vec[0] + lagerArm[1] * d.vec[1] + lagerArm[2] * d.vec[2]) > 0.9) continue;
      // Die Schraege der Winkelkupplung traegt keinen Namen aus DIRECTIONS, ihre
      // Belegung muss ueber die Richtung geprueft werden -- sonst bietet sie den
      // Punkt auch dann noch an, wenn das Rohr schon steckt.
      if (c45Dir && this._armOccupied(node, d.vec)) continue;
      const isCardDir = Math.max(Math.abs(d.vec[0]), Math.abs(d.vec[1]), Math.abs(d.vec[2])) > DIR_ALIGN_TOL;
      // 弯管在手：一个方向给四根弧线手柄，四种弯法各一根，弧线画的就是点下去
      // 之后弯管的走向。落到地下或目标接头已经连着的那几种不给。
      if (bowInHand && isCardDir && !c45Dir) {
        const R = gridSpacing();
        const normals = this._bowNormalsFor(d.vec).filter((n) => this._bowFeasible(node, d.vec, n, R));
        // 静止时一个方向只画默认那种弯法（和键盘放下去的一样），指到接头再
        // 展开四种。默认那种会钻到地面以下（地面接头往下弯）就改成往上，
        // 放不下就拿第一种顶上。
        const ground = this.model._groundLevel ? this.model._groundLevel() : 0;
        let def = this._bowNormal(d.vec);
        if (node.y + R * (d.vec[1] + def[1]) < ground - 0.01 || node.y + R * def[1] < ground - 0.01) def = [0, 1, 0];
        let defaultIdx = normals.findIndex((n) => n[0] === def[0] && n[1] === def[1] && n[2] === def[2]);
        if (defaultIdx < 0) defaultIdx = 0;
        normals.forEach((normal, i) => {
          this.scene.addHandle(
            [node.x, node.y, node.z],
            {
              nodeId: node.id, dir: d.vec, dirName: d.name, slope: isSlope,
              bow: true, bowNormal: normal, bowRadius: R, bowDefault: i === defaultIdx,
              arrowCompact: true,
              previewSpan: 0,
              previewColor,
            },
            "dir"
          );
        });
        continue;
      }
      if (this._targetBelowGround(node, d.vec)) continue;
      // Pfeile wachsen aus der Kupplung heraus (wie designer), nicht als
      // schwebende Kugel auf `gap`. Die Richtung bleibt die des freien Arms.
      this.scene.addHandle(
        [node.x, node.y, node.z],
        {
          nodeId: node.id, dir: d.vec, dirName: d.name, slope: isSlope || !!c45Dir,
          arrowCompact: true,
          previewSpan,
          previewColor,
        },
        ((useDiag || c45Dir) && !isCardDir) ? "diag" : "dir"
      );
    }
  }

  /**
   * 弯管从某个方向出发时的四种弯法：和出发方向垂直的四个世界轴向。
   * 顺序固定（先竖直再水平），四根弧线的颜色和位置才每次一样。
   */
  _bowNormalsFor(dirVec) {
    const ax = Math.abs(dirVec[0]), ay = Math.abs(dirVec[1]), az = Math.abs(dirVec[2]);
    const main = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
    const out = [];
    for (const axis of [1, 0, 2]) {
      if (axis === main) continue;
      for (const s of [-1, 1]) {
        const n = [0, 0, 0];
        n[axis] = s;
        out.push(n);
      }
    }
    return out;
  }

  /** 这一种弯法放得下吗：弧线最低点不在地下，目标接头也还没和这个接头连着。 */
  _bowFeasible(node, dir, normal, R) {
    const cy = node.y + normal[1] * R;
    const ty = node.y + R * (dir[1] + normal[1]);
    if (this.model.isBelowGround(ty) || this.model.isBelowGround(cy)) return false;
    const hit = this.model.findNodeNear(
      node.x + R * (dir[0] + normal[0]), ty, node.z + R * (dir[2] + normal[2]));
    return !(hit && this.model.tubeBetween(node.id, hit.id));
  }

  _targetBelowGround(node, vec) {
    if (vec[1] >= 0) return false;
    const tube = getTube(this.tubeId);
    const span = isCurvedTube(this.tubeId)
      ? gridSpacing()
      : spacingFor(tube ? tube.length_cm : 35);
    return this.model.isBelowGround(node.y + vec[1] * span);
  }

  // Rotierte 90°-Arm-Basis eines Schräg-Konnektors: die Schräge liegt in EINER
  // Achsenebene (Drehung um die dritte Achse). Moegliche Arme = die 4 in-Ebene-
  // Diagonalen (Schräge + Quer dazu) PLUS die 2 Kardinalen entlang der Drehachse
  // -- alle 90° zueinander. (Aus DIRECTIONS/DIAGONAL_DIRECTIONS gefiltert, damit
  // die Namen zur Belegungspruefung passen.)
  _slopeArmDirs(node) {
    let d = null;
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const o = t.a === node.id ? this.model.nodes.get(t.b)
        : t.b === node.id ? this.model.nodes.get(t.a) : null;
      if (!o) continue;
      const v = [o.x - node.x, o.y - node.y, o.z - node.z], L = Math.hypot(...v) || 1, u = v.map((c) => c / L);
      if (Math.max(...u.map(Math.abs)) < DIR_ALIGN_TOL) { d = u; break; }
    }
    if (!d) return null;
    const act = [0, 1, 2].filter((a) => Math.abs(d[a]) > 0.3);
    if (act.length !== 2) return null;
    const k = [0, 1, 2].find((a) => !act.includes(a)); // Drehachse
    const out = [];
    for (const dd of DIAGONAL_DIRECTIONS) {
      if (Math.abs(dd.vec[k]) < 0.01 && Math.abs(dd.vec[act[0]]) > 0.3 && Math.abs(dd.vec[act[1]]) > 0.3) out.push(dd);
    }
    for (const cd of DIRECTIONS) {
      if (Math.abs(cd.vec[k]) > DIR_ALIGN_TOL) out.push(cd);
    }
    return out.length ? out : null;
  }

  // Hat der Knoten schon ein nicht-kardinales (45-Grad) Rohr? Dann liegt er auf
  // einer Schräge und ist selbst eine 45-Grad-gedrehte Kupplung.
  _hasDiagonalTube(node) {
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const u = this._tubeDirAt(t, node);
      if (!u) continue;
      if (Math.max(Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])) < DIR_ALIGN_TOL) return true;
    }
    return false;
  }

  // Richtung, in der ein Rohr den Knoten VERLAESST (normiert), oder null wenn es
  // dort nicht anliegt. Bei Bogenrohren zaehlt die Tangente am Knoten, nicht die
  // Sehne zum Gegenknoten: die Sehne eines Viertelkreises steht 45 Grad schief,
  // wodurch die Kupplung sonst als Schraeg-Kupplung gilt und nur noch diagonale
  // Anbau-Richtungen angeboten bekommt.
  _tubeDirAt(t, node) {
    const a = this.model.nodes.get(t.a), b = this.model.nodes.get(t.b);
    if (!a || !b) return null;
    let v;
    if (t.bow && t.bowCenter) {
      const c = t.bowCenter;
      if (t.a === node.id) v = [b.x - c[0], b.y - c[1], b.z - c[2]];
      else if (t.b === node.id) v = [a.x - c[0], a.y - c[1], a.z - c[2]];
      else return null;
    } else if (t.a === node.id) {
      v = [b.x - a.x, b.y - a.y, b.z - a.z];
    } else if (t.b === node.id) {
      v = [a.x - b.x, a.y - b.y, a.z - b.z];
    } else {
      return null;
    }
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }

  _occupiedDirs(node) {
    const occ = new Set();
    // Ein Stutzen ist belegt, wenn eine Lochzapfenkupplung darauf steckt oder
    // ein Teil daraufsitzt, das den Zapfen fuellt (Radlager, Adapter,
    // Multirad-Arretierung, offenes Verbinderende) -- ein Rohr passt dann nicht
    // mehr dazu. Andere Teile auf demselben Zapfen bleiben moeglich, die laufen
    // ueber die Anbauteil-Ankerpunkte.
    const durchKlemme = holeClampDirsAt(this.model, node, geometry().connectorSize);
    durchKlemme.push(...armFittingDirsAt(this.model, node, ARM_FITTINGS));
    // Rotierte Kupplung (armDirs aus QDF-Import): Belegung gegen gespeicherte
    // Arm-Richtungen pruefen (nicht gegen DIRECTIONS/DIAGONAL_DIRECTIONS).
    const eigene = node.c45body ? null : this._armDirsOf(node);
    if (eigene) {
      for (const nb of this.model.neighbors(node.id)) {
        if (!nb) continue;
        const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        for (const d of eigene) {
          if ((dx * d.vec[0] + dy * d.vec[1] + dz * d.vec[2]) / len > ARM_ALIGN_TOL) {
            occ.add(d.name);
          }
        }
      }
      for (const k of durchKlemme) {
        for (const d of eigene) {
          if (k[0] * d.vec[0] + k[1] * d.vec[1] + k[2] * d.vec[2] > ARM_ALIGN_TOL) occ.add(d.name);
        }
      }
      return occ;
    }
    // Eine schon gebaute Schraege (ueber den Adapter-Koerper) belegt ihre
    // Richtung -- sonst boete die Kupplung sie ein zweites Mal an.
    {
      for (const arm of this.model.tubes.values()) {
        if (!arm.arm) continue;
        const bId = arm.a === node.id ? arm.b : arm.b === node.id ? arm.a : null;
        const B = bId && this.model.nodes.get(bId);
        if (!B || !B.c45body) continue;
        for (const t of this.model.tubes.values()) {
          if (t.arm) continue;
          const fId = t.a === bId ? t.b : t.b === bId ? t.a : null;
          if (!fId) continue;
          const F = this.model.nodes.get(fId);
          const dx = F.x - B.x, dy = F.y - B.y, dz = F.z - B.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          for (const d of DIAGONAL_DIRECTIONS) {
            if ((dx * d.vec[0] + dy * d.vec[1] + dz * d.vec[2]) / len > DIR_ALIGN_TOL) occ.add(d.name);
          }
        }
      }
    }
    // Direkte Rohre belegen ihre Richtung -- kardinal UND diagonal (Schräg-
    // Konnektor). Arm-/Link-Kanten zaehlen nicht.
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const u = this._tubeDirAt(t, node);
      if (!u) continue;
      const [ux, uy, uz] = u;
      for (const d of DIRECTIONS) if (ux * d.vec[0] + uy * d.vec[1] + uz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
      for (const d of DIAGONAL_DIRECTIONS) if (ux * d.vec[0] + uy * d.vec[1] + uz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
    }
    for (const [kx, ky, kz] of durchKlemme) {
      for (const d of DIRECTIONS) if (kx * d.vec[0] + ky * d.vec[1] + kz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
      for (const d of DIAGONAL_DIRECTIONS) if (kx * d.vec[0] + ky * d.vec[1] + kz * d.vec[2] > DIR_ALIGN_TOL) occ.add(d.name);
    }
    return occ;
  }

  /**
   * Ankerpunkte fuer die 45-Grad-Winkelkupplung: an jedem FREIEN Arm einer
   * Kupplung sitzt einer. Ein Klick setzt sie dort, jeder weitere Klick auf die
   * gesetzte Kupplung dreht sie um 90 Grad weiter.
   */
  _buildC45Handles() {
    // Die Punkte sitzen dort, WO die Winkelkupplung ansetzt: an jedem freien
    // Arm einer Kupplung, gruen wie die uebrigen Bau-Punkte. In welche Schraege
    // sie dann zeigt, entscheidet der erste passende Wert -- weiterdrehen laesst
    // sie sich danach mit einem Klick auf sie selbst.
    //
    // Wie im Bau-Modus zeigt eine GEWAEHLTE Kupplung nur noch ihre eigenen
    // Punkte (Klick auf die Kupplung, siehe _clickC45).
    const nodes = this.selectedNodeId
      ? [this.model.nodes.get(this.selectedNodeId)].filter(Boolean)
      : [...this.model.nodes.values()];
    for (const node of nodes) {
      if (node.unused || node.c45body || node.part) continue;
      for (const m of this._c45MountsFor(node)) {
        this.scene.addHandle(
          [node.x, node.y, node.z],
          { c45mount: true, nodeId: node.id, axis: m.axis, dir: m.dir, arrowDir: m.axis }, "dir");
      }
      // Die Winkelkupplung laesst sich auch DIREKT ins Rohr stecken: an einer
      // Dummy-Kupplung (ein Rohr, sonst nichts) sitzt der Punkt deshalb MITTIG
      // auf ihr. Gesetzt tritt die Winkelkupplung an ihre Stelle, und am
      // anderen Ende der Huelse entsteht eine neue Dummy-Kupplung.
      const achsen = this.model.c45SleeveAxes(this.model.c45TubeDir(node));
      if (achsen.length) {
        // Er sitzt MITTEN auf der Dummy-Kupplung und ist etwas groesser: die
        // Punkte weiter aussen setzen die Winkelkupplung auf einen Stutzen,
        // dieser eine steckt sie ins Rohr. Auf der Rohrachse weiter aussen
        // waere er nicht zu unterscheiden -- dort sitzt schon der Stutzen-Punkt.
        this.scene.addHandle([node.x, node.y, node.z],
          { c45mount: true, inTube: true, nodeId: node.id, axis: achsen[0] }, "dir", 3.6);
      }
    }
  }

  /**
   * Achsenkreuz einer Kupplung in Weltkoordinaten. Eine gedrehte Kupplung (aus
   * einer Datei oder vom Schraegbau) traegt ihre Lage in `quat`; ohne die
   * gelten die Weltachsen.
   */
  _nodeFrame(node) {
    if (node && node.quat && node.quat.length === 4) {
      return { ex: xAxisOf(node.quat), ey: yAxisOf(node.quat), ez: zAxisOf(node.quat) };
    }
    // Ohne gespeicherte Lage: aus den Arm-Richtungen. Eine im Editor gebaute
    // Schraeg-Kupplung traegt kein `quat` -- ihre Drehung steckt allein darin,
    // dass ein 45-Grad-Rohr an ihr haengt (`_slopeArmDirs`, dieselbe Quelle wie
    // im Bau-Modus). Ohne diesen Rueckfall boete der Winkelkupplungs-Modus dort
    // die Weltachsen an, waehrend der Bau-Modus daneben die gedrehten zeigt.
    const dirs = (node && node.armDirs && node.armDirs.length)
      ? node.armDirs
      : (node && this._hasDiagonalTube(node) ? this._slopeArmDirs(node) : null);
    const frame = dirs && this._frameFromDirs(dirs.map((d) => d.vec || d));
    return frame || { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };
  }

  /**
   * Rechtshaendiges Achsenkreuz aus einer Liste von Arm-Richtungen: die erste
   * ist +X, dazu die erste dazu senkrechte als +Y, +Z ergibt sich. Liefert
   * null, wenn keine zwei senkrechten dabei sind.
   */
  _frameFromDirs(list) {
    const norm = (v) => {
      const L = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / L, v[1] / L, v[2] / L];
    };
    for (const a of list) {
      const ex = norm(a);
      for (const b of list) {
        const ey = norm(b);
        if (Math.abs(ex[0] * ey[0] + ex[1] * ey[1] + ex[2] * ey[2]) > 0.01) continue;
        const ez = [
          ex[1] * ey[2] - ex[2] * ey[1],
          ex[2] * ey[0] - ex[0] * ey[2],
          ex[0] * ey[1] - ex[1] * ey[0],
        ];
        return { ex, ey, ez };
      }
    }
    return null;
  }

  /**
   * Ankerpunkte fuer die Winkelkupplung an EINER Kupplung: je freiem Arm einer.
   *
   * Gerechnet wird im Achsenkreuz DER KUPPLUNG, nicht in dem der Welt: an einer
   * gedrehten Kupplung (Ende einer Schraege) sitzen Huelse und 45-Grad-Arm
   * ebenso gedreht. Vorher standen die Punkte waagerecht in der Weltebene, und
   * die Kupplung landete schief.
   *
   * Angeboten wird JEDER freie Arm -- auch der in der Rohrachse, aus der
   * Dummy-Kupplung wird dann eine gerade Kupplung. Welche der vier Schraegen
   * ein Arm bekommt, entscheidet die erste freie, moeglichst nach oben; die
   * uebrigen erreicht man durch Weiterdrehen.
   */
  _c45MountsFor(node) {
    const { ex, ey, ez } = this._nodeFrame(node);
    const nachWelt = (v) => [
      ex[0] * v[0] + ey[0] * v[1] + ez[0] * v[2],
      ex[1] * v[0] + ey[1] * v[1] + ez[1] * v[2],
      ex[2] * v[0] + ey[2] * v[1] + ez[2] * v[2],
    ];
    const out = [];
    for (const a of DIRECTIONS) {
      const axis = nachWelt(a.vec);
      if (this._armOccupied(node, axis)) continue;
      let beste = null;
      for (const d of DIAGONAL_DIRECTIONS) {
        // Die Schraege steht im 45-Grad-Innenwinkel zur Huelse: sie knickt
        // zurueck ueber die Kupplung (Skalarprodukt -0,707).
        const punkt = d.vec[0] * a.vec[0] + d.vec[1] * a.vec[1] + d.vec[2] * a.vec[2];
        if (Math.abs(punkt + Math.SQRT1_2) > 0.05) continue;
        const dir = nachWelt(d.vec);
        if (this._targetBelowGround(node, dir)) continue;
        // Schraege schon belegt? Geometrisch pruefen -- Namen aus
        // `_occupiedDirs` gelten nur fuer die ungedrehte Kupplung.
        if (this._armOccupied(node, dir)) continue;
        if (!beste || (dir[1] > 0.3 && !(beste.dir[1] > 0.3))) beste = { axis, dir };
      }
      if (beste) out.push(beste);
    }
    return out;
  }

  /** Steckt in der Winkelkupplung schon ein Rohr? */
  _c45HasTube(bodyId) {
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      if (t.a === bodyId || t.b === bodyId) return true;
    }
    return false;
  }

  /** Haengt an dieser Kupplung eine Winkelkupplung? Dann deren Koerper. */
  _c45BodyAt(nodeId) {
    for (const t of this.model.tubes.values()) {
      if (!t.arm) continue;
      const id = t.a === nodeId ? t.b : t.b === nodeId ? t.a : null;
      const n = id && this.model.nodes.get(id);
      if (n && n.c45body) return n;
    }
    return null;
  }

  /** Winkelkupplung setzen (Ankerpunkt) bzw. weiterdrehen (Klick auf sie). */
  _clickC45(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.c45mount) {
      let res;
      this.recordHistory(() => {
        res = h.data.inTube
          ? this.model.addC45OnTube(h.data.nodeId, h.data.axis, C45_SLEEVE_LEN, C45_ARM_LEN)
          : this.model.addC45Adapter(h.data.nodeId, h.data.axis, h.data.dir,
            C45_SLEEVE_LEN, C45_ARM_LEN);
      });
      if (res && res.ground) this.onNotice(t("notice_ground"), "warn");
      else if (res && res.body) this.onNotice(t("notice_placed", partName(getConnector("diagonal"))));
      this.refresh();
      return;
    }
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    const node = pick && pick.data.kind === "node" && this.model.nodes.get(pick.data.id);
    // Getroffen wird mal der Koerper der Winkelkupplung, mal die Kupplung, auf
    // der sie steckt (Huelse und Arm gehoeren beiden) -- beides dreht sie.
    const body = node && (node.c45body ? node : this._c45BodyAt(node.id));
    if (body) {
      // Steckt sie IM Rohr, dreht sich die Huelsenseite: die Dummy-Kupplung
      // wandert um die Rohrachse, das Rohr bleibt stehen.
      if (this._c45HasTube(body.id)) {
        let gedreht = false;
        this.recordHistory(() => { gedreht = this.model.rotateC45Sleeve(body.id); });
        // Sonst bleibt sie stehen: mitzudrehen hiesse, das halbe Modell
        // mitzuziehen -- dafuer gibt es das Drehen der Auswahl.
        this.onNotice(gedreht ? t("notice_c45_turned") : t("notice_c45_has_tube"),
          gedreht ? "ok" : "warn");
        if (gedreht) this.refresh();
        return;
      }
      let ok = false;
      this.recordHistory(() => { ok = this.model.rotateC45(body.id); });
      this.onNotice(ok ? t("notice_c45_turned") : t("notice_c45_no_turn"), ok ? "ok" : "warn");
      this.refresh();
      return;
    }
    // Klick auf eine Kupplung ohne Winkelkupplung waehlt sie: danach zeigt nur
    // noch sie ihre Ankerpunkte (wie im Bau- und im Anbauteil-Modus). Ein Klick
    // daneben hebt die Wahl wieder auf.
    if ((pick && pick.data.kind === "node") || this.selectedNodeId) {
      this._pickFittingNode(pick && pick.data.kind === "node" ? pick : null);
      return;
    }
    this.onNotice(t("notice_c45_click_arm"), "info");
  }

  // --- Doppelrohrverbinder ------------------------------------------------
  // Grüner Punkt in der leeren Öffnung jeder "8": dort kann eine zweite,
  // parallele Tube gesetzt werden.
  // Anbauteile: an jeder Montagestelle des gewaehlten Teils ein Ankerpunkt.
  // Wo dasselbe Teil schon steckt, wird keiner gezeigt -- gestapelt wird nicht.
  _buildFittingHandles() {
    // Merkt sich, an welchen Kupplungen das gewaehlte Teil sitzen darf -- der
    // Zeiger zeigt dort eine Hand, auch wenn er den Ankerpunkt knapp verfehlt.
    this._fittingMountNodes = new Set();
    if (this.fittingKind === "sleeve") {
      // 软包滚筒：每根还没套的直管中点一个点
      const taken = new Set();
      for (const f of this.model.fittings.values()) if (f.kind === "sleeve" && f.tube) taken.add(f.tube);
      for (const tb of this.model.tubes.values()) {
        if (tb.arm || tb.link || tb.bow || taken.has(tb.id)) continue;
        const a = this.model.nodes.get(tb.a), b = this.model.nodes.get(tb.b);
        if (!a || !b) continue;
        this.scene.addHandle([(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
          { sleeveTube: tb.id, placeNode: true }, "place");
      }
      return;
    }
    if (this.fittingKind === "balls") {
      for (const f of this._pools()) {
        this.scene.addPanelHandle(this._poolOpeningCorners(f), { poolBalls: f.id });
      }
      return;
    }
    if (POOL_KINDS.has(this.fittingKind)) {
      const spec = this.poolLinerId && POOL_SETS[this.poolLinerId];
      if (spec) {
        for (const m of this.model.poolLinerMounts(spec)) {
          this.scene.addPanelHandle(m.corners, { poolMount: m });
        }
      }
      return;
    }
    if (RAIL_FITTINGS.has(this.fittingKind)) {
      for (const m of this.model.railFittingMounts(this.fittingKind)) {
        this.scene.addPanelHandle(m.corners, { railMount: m });
      }
      return;
    }
    if (ROOF_KINDS.has(this.fittingKind)) {
      // Beide Dachschraegen leuchten -- ein Klick auf eine legt das Tuch auf.
      for (const m of this.model.roofMounts(this.fittingKind)) {
        for (const c of m.faces) this.scene.addPanelHandle(c, { roofMount: m });
      }
      return;
    }
    // Lochzapfenkupplung: je freiem Stutzen einer Kupplung ein Punkt -- dort
    // steckt ihr Loch darauf.
    if (HOLE_MASKS[this.fittingKind]) {
      const sel0 = this.selectedNodeId;
      for (const m of this.model.holeArmMounts(geometry().connectorSize)) {
        this._fittingMountNodes.add(m.nodeId);
        if (sel0 && m.nodeId !== sel0) continue;
        this.scene.addHandle(m.handle || m.pos, { holeArm: m }, "dir");
      }
      return;
    }
    // Flexikupplung: der Bolzen kommt auf ein freies Rohrende (er ersetzt die
    // Dummy-Kupplung), das Scharnier auf das mittlere Segment eines Bolzens.
    if (this.fittingKind === BOLT_PART || this.fittingKind === HINGE_PART) {
      const sel0 = this.selectedNodeId;
      const cs = geometry().connectorSize;
      const stellen = this.fittingKind === BOLT_PART
        ? this.model.boltMounts(cs).map((m) => ({ m, pos: m.handle || m.pos, art: "boltMount" }))
        : this.model.hingeMounts(cs).map((m) => ({ m, pos: m.pos, art: "hingeMount" }));
      for (const s of stellen) {
        this._fittingMountNodes.add(s.m.nodeId);
        if (sel0 && s.m.nodeId !== sel0) continue;
        this.scene.addHandle(s.pos, { [s.art]: s.m }, "dir");
      }
      return;
    }
    // Ist eine Kupplung gewaehlt, gelten nur ihre Stellen -- bei Teilen auf einem
    // Rohr nur die Rohre, die an ihr haengen. Ohne Auswahl sind alle zu sehen.
    const sel = this.selectedNodeId;
    const amKnoten = (tubeId) => {
      const tb = this.model.tubes.get(tubeId);
      return !!tb && (tb.a === sel || tb.b === sel);
    };
    // Belegt ist eine Stelle nur, wenn dort schon dasselbe Teil in DERSELBEN
    // Richtung sitzt: an einer Kupplung liegen alle Stutzen-Punkte auf ihrem
    // Mittelpunkt, erst die Richtung sagt, welcher Stutzen gemeint ist. Ohne den
    // Vergleich sperrte eine einzige Multirad-Arretierung die ganze Kupplung.
    const frei = (m) => {
      for (const f of this.model.fittings.values()) {
        if (f.kind !== this.fittingKind) continue;
        if (Math.hypot(f.x - m.pos[0], f.y - m.pos[1], f.z - m.pos[2]) >= 2) continue;
        if (!m.dir || !f.quat) return false;
        const ax = xAxisOf(f.quat);
        if (ax[0] * m.dir[0] + ax[1] * m.dir[1] + ax[2] * m.dir[2] > 0.9) return false;
      }
      return true;
    };
    for (const m of this.model.fittingMounts(this.fittingKind, geometry().connectorSize)) {
      if (m.nodeId) this._fittingMountNodes.add(m.nodeId);
      if (sel && m.nodeId !== sel) continue;
      if (!frei(m)) continue;
      this.scene.addHandle(m.handle || m.pos, { fittingMount: m }, "dir");
    }
    // Teile, die frei auf einem Rohr sitzen: je Rohr ein Vorschlag in der Mitte
    // des uebrigen Platzes. Unter dem Mauszeiger wandert er mit (_trackTubeHandles).
    for (const m of this.model.tubeFittingSpots(this.fittingKind, geometry().connectorSize)) {
      if (sel && !amKnoten(m.tubeId)) continue;
      if (!frei(m)) continue;
      const mesh = this.scene.addHandle(m.pos, { fittingMount: m }, "dir");
      this._tubeHandles.set(m.tubeId, { mesh, art: "fitting", ruhe: m });
    }
    // Klemm-Kupplungen (Lochzapfen-, Lagerkupplung) klemmen an einer beliebigen
    // Stelle -- ein Punkt je Rohr zeigt, welche Rohre in Frage kommen.
    if (TUBE_CLAMP_PARTS[this.fittingKind]) {
      for (const m of this._tubeMidpoints(sel, amKnoten)) {
        const mesh = this.scene.addHandle(m.pos, { clampTube: m }, "dir");
        this._tubeHandles.set(m.tubeId, { mesh, art: "clamp", ruhe: m });
      }
      // Die Lagerkupplung geht auch andersherum: erst an einen freien Arm einer
      // Kupplung, das Rohr klemmt spaeter darin. Dafuer je freiem Arm ein Punkt,
      // dort, wo die Klemme zu liegen kaeme.
      if (this.fittingKind === "bearing-clamp") {
        const cs = geometry().connectorSize;
        for (const m of this.model.bearingArmMounts(cs)) {
          this.scene.addHandle(m.handle || m.pos, { bearingArm: m }, "dir");
        }
      }
    }
  }

  /**
   * Der Ankerpunkt eines Teils, das FREI auf einem Rohr sitzt, laeuft unter dem
   * Mauszeiger mit: er zeigt genau die Stelle, an der das Teil landen wuerde --
   * und verschwindet dort, wo es nicht hinpasst (zu dicht an der Kupplung, ein
   * anderes Rad im Weg, unter dem Boden). Ohne Zeiger auf dem Rohr steht er
   * wieder auf seiner Ruhelage in der Mitte.
   */
  _trackTubeHandles(x, y) {
    if (!this._tubeHandles.size) return;
    const tp = this.scene.pickTube ? this.scene.pickTube(x, y) : null;
    const unterZeiger = tp && tp.point ? tp.data.id : null;
    const cs = geometry().connectorSize;
    for (const [tubeId, e] of this._tubeHandles) {
      if (tubeId !== unterZeiger) {
        this.scene.moveHandle(e.mesh, e.ruhe.pos);
        this.scene.setHandleVisible(e.mesh, true);
        if (e.art === "fitting") e.mesh.userData.fittingMount = e.ruhe;
        else e.mesh.userData.clampTube = e.ruhe;
        continue;
      }
      const punkt = [tp.point.x, tp.point.y, tp.point.z];
      const m = e.art === "fitting"
        ? this.model.tubeFittingMount(tubeId, punkt, this.fittingKind, cs)
        : e.art === "clamp"
          ? this.model.tubeClampMount(tubeId, punkt, TUBE_CLAMP_PARTS[this.fittingKind], cs)
          : { pos: punkt };            // Doppelrohrverbinder/Rohrklammer: ueberall
      if (!m) { this.scene.setHandleVisible(e.mesh, false); continue; }
      this.scene.setHandleVisible(e.mesh, true);
      // Der Punkt laeuft MITTIG im Rohr mit: nur die Stelle entlang des Rohrs
      // wandert, nicht die Seite. Fuer den Klick zaehlt trotzdem der echte
      // Trefferpunkt -- aus ihm ergibt sich, wohin der Anschluss zeigt.
      const aufAchse = e.art === "fitting" ? m.pos : (this.model.tubeAxisPoint(tubeId, punkt) || punkt);
      this.scene.moveHandle(e.mesh, aufAchse);
      if (e.art === "fitting") e.mesh.userData.fittingMount = m;
      else e.mesh.userData.clampTube = { tubeId, pos: punkt, tracked: true };
    }
  }

  /** Mitte jedes echten Rohrs -- Vorschlagspunkte fuer Teile, die dort klemmen. */
  _tubeMidpoints(sel, amKnoten) {
    const out = [];
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link || t.bow) continue;
      if (sel && !amKnoten(t.id)) continue;
      const a = this.model.nodes.get(t.a), b = this.model.nodes.get(t.b);
      if (!a || !b) continue;
      out.push({ tubeId: t.id, pos: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2] });
    }
    return out;
  }

  _buildClampHandles() {
    // Ein Punkt je Rohr zeigt, wo sich ein Verbinder setzen laesst; ist eine
    // Kupplung gewaehlt, nur an ihren Rohren.
    const sel = this.selectedNodeId;
    const amKnoten = (tubeId) => {
      const tb = this.model.tubes.get(tubeId);
      return !!tb && (tb.a === sel || tb.b === sel);
    };
    for (const m of this._tubeMidpoints(sel, amKnoten)) {
      const mesh = this.scene.addHandle(m.pos, { clampTube: m }, "dir");
      this._tubeHandles.set(m.tubeId, { mesh, art: "verbinder", ruhe: m });
    }

  }

  // Laeuft schon eine (parallele) Tube durch die Oeffnung?
  _openingOccupied(center, dir) {
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const u = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    for (const t of this.model.tubes.values()) {
      if (t.arm || t.link) continue;
      const a = this.model.nodes.get(t.a), b = this.model.nodes.get(t.b);
      if (!a || !b) continue;
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(...ab) || 1;
      if (Math.abs((ab[0] * u[0] + ab[1] * u[1] + ab[2] * u[2]) / L) < 0.9) continue; // nicht parallel
      let s = ((center[0] - a.x) * ab[0] + (center[1] - a.y) * ab[1] + (center[2] - a.z) * ab[2]) / (L * L);
      s = Math.max(0, Math.min(1, s));
      const cp = [a.x + ab[0] * s, a.y + ab[1] * s, a.z + ab[2] * s];
      if (Math.hypot(center[0] - cp[0], center[1] - cp[1], center[2] - cp[2]) < 3) return true;
    }
    return false;
  }

  // Kardinale Richtung senkrecht zu u, die am besten zu p (Klickseite) passt.
  _cardinalPerp(p, u) {
    const cards = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let best = cards[0], bd = -Infinity;
    for (const c of cards) {
      if (Math.abs(c[0] * u[0] + c[1] * u[1] + c[2] * u[2]) > 0.3) continue;
      const dot = c[0] * p[0] + c[1] * p[1] + c[2] * p[2];
      if (dot > bd) { bd = dot; best = c; }
    }
    return best;
  }

  // Doppelrohrverbinder auf ein Rohr setzen: Achse (Rohr) + Versatz (zur leeren
  // Oeffnung, Richtung Klickseite, auf Kardinale gerundet) merken -> "8".
  _placeClampOnTube(tubeId, hit) {
    const tb = this.model.tubes.get(tubeId);
    // Auch sie greifen nur um ein gerades Rohr.
    if (!tb || tb.bow || tb.arm || tb.link) { this.onNotice(t("notice_clamp_click_tube"), "info"); return; }
    const a = this.model.nodes.get(tb.a), b = this.model.nodes.get(tb.b);
    if (!a || !b) return;
    const cs = geometry().connectorSize;
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const dl = Math.hypot(...ab) || 1;
    const u = [ab[0] / dl, ab[1] / dl, ab[2] / dl];
    let s = (hit.x - a.x) * u[0] + (hit.y - a.y) * u[1] + (hit.z - a.z) * u[2];
    s = Math.max(0, Math.min(dl, s));
    const ax = [a.x + u[0] * s, a.y + u[1] * s, a.z + u[2] * s];
    let p = [hit.x - ax[0], hit.y - ax[1], hit.z - ax[2]];
    const pa = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    p = [p[0] - u[0] * pa, p[1] - u[1] * pa, p[2] - u[2] * pa];
    const pl = Math.hypot(...p) || 1; p = [p[0] / pl, p[1] / pl, p[2] / pl];
    const card = this._cardinalPerp(p, u);
    const off = [card[0] * cs, card[1] * cs, card[2] * cs];
    // Der Punkt liegt auf der Achse des UMSCHLOSSENEN Rohrs, nicht zwischen
    // beiden Loechern -- genau wie in den Herstellerdateien (Test.qdf: das Rohr
    // laeuft auf der Y-Achse, die clamp2-Zeile steht auf 0/340/0). Das
    // abgegriffene Modell hat dort seinen Nullpunkt; die alte Mitte zeichnete es
    // um eine halbe Lochweite versetzt.
    let gesetzt = null;
    this.recordHistory(() => {
      const clamp = this.model.addClamp(round2(ax[0]), round2(ax[1]), round2(ax[2]), this.clampPart);
      clamp.dir = u.map(round2); clamp.off = off.map(round2);
      gesetzt = clamp;
    });
    if (gesetzt) this._notePlaced(gesetzt.id, "clamp");
    this.refresh();
  }

  // Zweite, parallele Tube in die leere Oeffnung setzen (mittig an der Klemme).
  _placeSecondTube(center, dir, bearingNode = null) {
    const tube = getTube(this.tubeId);
    if (!tube) return;
    const span = spacingFor(tube.length_cm);
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const u = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const h = span / 2;
    const p1 = [center[0] - u[0] * h, center[1] - u[1] * h, center[2] - u[2] * h];
    // Mittig zur Klemme ist die grobe Lage -- entlang des Rohrs wird auf das
    // Raster gerastet, damit das neue Rohr zu allem anderen passt. Quer dazu
    // bleibt es, wo die Klemme es haelt.
    const achse = [Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])];
    const gr = achse.indexOf(Math.max(...achse));
    if (achse[gr] > 0.99) p1[gr] = Math.round(p1[gr] / SNAP_STEP) * SNAP_STEP;
    const p2 = [p1[0] + u[0] * span, p1[1] + u[1] * span, p1[2] + u[2] * span];
    this.recordHistory(() => {
      const n1 = this.model.addNode(round2(p1[0]), round2(p1[1]), round2(p1[2]));
      const n2 = this.model.addNode(round2(p2[0]), round2(p2[1]), round2(p2[2]));
      const tb = this.model.addTube(n1.id, n2.id, tube.id, this.colorFor("tube"), tube.length_cm);
      // Rohr im Maul einer Lagerkupplung: Teil und Rohr gehoeren jetzt zusammen.
      if (bearingNode && tb) this.model.noteBearingTube(bearingNode, tb.id);
      // Jedes Ende an seinen ausgerichteten Nachbar-Knoten (~Versatz) anbinden,
      // damit die Klemme beide Rohre als Paar zusammenhaelt.
      for (const nn of [n1, n2]) {
        let near = null, nd = Infinity;
        for (const m of this.model.nodes.values()) {
          if (m.id === n1.id || m.id === n2.id) continue;
          const d = Math.hypot(m.x - nn.x, m.y - nn.y, m.z - nn.z);
          if (d < nd) { nd = d; near = m; }
        }
        if (near && nd < CLAMP_LINK_DIST) this.model.addLink(near.id, nn.id);
      }
    });
    this.onNotice(t("notice_placed", partName(getTube(this.tubeId))));
    this.refresh();
  }

  // --- Events -------------------------------------------------------------
  _attach() {
    const el = this.scene.renderer.domElement;
    // Ein Zug gehoert genau EINEM Zeiger. Kommt ein zweiter Finger dazu, ist
    // das eine Zwei-Finger-Geste (Zoomen/Schieben) -- die uebernimmt
    // OrbitControls, der eigene Zug wird abgebrochen. Ohne diese Buchhaltung
    // kaemen waehrend des Zoomens abwechselnd Bewegungen BEIDER Finger an: der
    // Drehpunkt sprang dann zwischen ihnen hin und her.
    this._pointerId = null;

    // Rechtsklick im Platten-Modus dreht die Platte unter dem Zeiger um 90 Grad.
    // Sie hat zwei Lippen mit je zwei Schrauben -- die Drehung entscheidet, an
    // welchem Rohrpaar sie verschraubt wird. Das Kontextmenue bleibt sonst aus,
    // wie ueberall auf der Zeichenflaeche.
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      clearTimeout(this._panelFlipTimer);
      this._panelFlipTimer = null;
      if (this.mode !== "panel") return;
      const pick = this.scene.pickForDelete(e.clientX, e.clientY);
      if (!pick || pick.data.kind !== "panel") return;
      let ok = false;
      this.recordHistory(() => { ok = this.model.turnPanel(pick.data.id); });
      if (ok) this.onNotice(t("notice_panel_turned"), "info");
      this.refresh();
    });
    // Doppelklick tut dasselbe -- auf dem Touchpad ist er der bequemere Weg.
    el.addEventListener("dblclick", (e) => {
      // Der erste Klick hat einen Seitenwechsel vorgemerkt; der gilt nicht mehr.
      clearTimeout(this._panelFlipTimer);
      this._panelFlipTimer = null;
      if (this.mode === "select" && !this._paste) {
        const pick = this.scene.pickForDelete(e.clientX, e.clientY);
        if (pick) this._selectConnectedFromPick(pick, e.ctrlKey || e.metaKey || e.shiftKey);
        return;
      }
      if (this.mode !== "panel") return;
      const pick = this.scene.pickForDelete(e.clientX, e.clientY);
      if (!pick || pick.data.kind !== "panel") return;
      let ok = false;
      this.recordHistory(() => { ok = this.model.turnPanel(pick.data.id); });
      if (ok) this.onNotice(t("notice_panel_turned"), "info");
      this.refresh();
    });

    el.addEventListener("pointerdown", (e) => {
      const art = (e.pointerType === "touch" || e.pointerType === "pen") ? "touch" : "mouse";
      if (art !== this.inputType) { this.inputType = art; this.onInputTypeChange(); }
      if (this._pointerId !== null) { this._abortGesture(); return; }
      this._pointerId = e.pointerId;
      this._down = {
        x: e.clientX, y: e.clientY,
        add: e.ctrlKey || e.metaKey || e.shiftKey,
        // Rechteck nur mit Strg/Cmd -- ohne bleibt es beim Drehen wie gewohnt.
        box: this.mode === "select" && (e.ctrlKey || e.metaKey),
      };
      this._boxing = false;
      this._last = { x: e.clientX, y: e.clientY };
      // Ansichtswuerfel liegt ueber allem: ein Zug dort dreht nicht die Szene.
      this._cubeDown = e.button === 0 ? this.scene.pickViewCube(e.clientX, e.clientY) : null;
      if (this._cubeDown) {
        this._down = null;
        this._cubeDrag = null;
        this._cubeStart = { x: e.clientX, y: e.clientY };
        return;
      }
      // Zeiger festhalten: sonst geht das pointerup verloren, wenn man beim
      // Aufziehen ueber den Rand des Canvas hinauszieht.
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch { /* egal */ } }
      // Ziehen der Auswahl geht dem Drehen vor: setzt der Zug auf einem BEREITS
      // ausgewaehlten Teil auf, wird verschoben statt gedreht. Auf allem
      // anderen bleibt es beim Drehen -- so verliert man die Kamerasteuerung
      // nicht, nur weil etwas markiert ist.
      this._drag = null;
      // Haengt eine Kopie am Zeiger, gehoert die linke Taste ihr: gezogen wird
      // gedreht, ein echter Klick setzt ab (siehe _onUp).
      if (this._paste) {
        if (e.button === 0) this.scene.beginOrbit(e.clientX, e.clientY);
        return;
      }
      this._clampDrag = null;
      this._clampSlide = null;
      this._clampDragKandidat = null;
      this._clampSlideKandidat = null;
      if (e.button === 0 && this.mode === "clamp") {
        const pick = this.scene.pickClamp(e.clientX, e.clientY)
          || this.scene.pickBuild(e.clientX, e.clientY);
        if (pick && pick.data.kind === "clamp" && this._beginClampDrag(pick.data.id)) return;
      }
      this._dragKandidat = null;
      if (e.button === 0 && !this._down.box && this.mode === "select") {
        const pick = this._pickSelect(e.clientX, e.clientY);
        if (pick && pick.data.kind === "clamp") {
          if (this.selection.has(pick.data.id) && this._beginClampDrag(pick.data.id)) return;
          this._clampDragKandidat = pick;
        } else {
          const slideId = pick && this._slideDriverForPick(pick);
          if (slideId) {
            if (this._selectedClampDriver() && this._beginClampSlide(slideId)) return;
            this._clampSlideKandidat = slideId;
          } else if (pick && this.selection.size && this._isMoveHandle(pick.data.id)) {
            if (e.pointerType === "touch") {
              // Mit dem Finger entscheidet erst die BEWEGUNG, ob geschoben wird --
              // sonst kaeme das Halten auf einem gewaehlten Teil nie an, weil der
              // Zug schon begonnen haette.
              this._dragKandidat = { e, pick };
            } else {
              this._beginMoveDrag(e, pick);
              return;
            }
          }
        }
      }
      // ⌥ + Ziehen: quer verschieben -- am Mac-Trackpad die Alternative zur
      // mittleren / rechten Taste.
      if (e.button === 0 && e.altKey && !this._down.box) {
        this._panning = true;
        this.scene.beginPan();
        return;
      }
      // Linke Taste ohne Strg: eigene Drehung um den Punkt unter dem Zeiger.
      if (e.button === 0 && !this._down.box) this.scene.beginOrbit(e.clientX, e.clientY);
      // Touch im Cursor-Modus: das Halten vorbereiten.
      this._clearLongPress();
      if (e.button === 0 && e.pointerType === "touch" && this.mode === "select"
          && !this._paste && !this._drag && !this._down.box) {
        const px = e.clientX, py = e.clientY;
        this._longPress = setTimeout(() => this._fireLongPress(px, py), LONG_PRESS_MS);
      }
    });
    // Zeiger, die nicht zum laufenden Zug gehoeren, bleiben aussen vor.
    const fremd = (e) => this._pointerId !== null && e.pointerId !== this._pointerId;
    el.addEventListener("pointermove", (e) => { if (!fremd(e)) this._onMove(e); });
    el.addEventListener("pointerup", (e) => {
      if (fremd(e)) return;
      this._pointerId = null;
      this._onUp(e);
    });
    // Abgebrochene Zeiger (Geste vom System uebernommen, Finger verlassen den
    // Bildschirm) hinterlassen sonst einen halb offenen Zug.
    el.addEventListener("pointercancel", (e) => { if (!fremd(e)) this._abortGesture(); });
    // Mac-Trackpad: Zwei-Finger-Wisch ist ein Wheel-Event, kein Touch.
    // Ohne Zusatztaste bleibt es beim Zoomen; ⇧ oder ⌥ macht daraus Querverschieben.
    el.addEventListener("wheel", (e) => {
      if (!(e.shiftKey || e.altKey)) return;
      e.preventDefault();
      e.stopPropagation();
      this.scene.panBy(-e.deltaX, -e.deltaY);
    }, { passive: false, capture: true });
  }

  /** Wartenden Halte-Timer verwerfen. */
  _clearLongPress() {
    if (this._longPress) { clearTimeout(this._longPress); this._longPress = null; }
  }

  /**
   * Der Finger hat lange genug still gehalten. Auf einem Teil: es kommt zur
   * Auswahl dazu oder faellt heraus -- das, was am Zeiger Strg/Shift tut. Im
   * Leeren: von hier an zieht der Finger ein Auswahl-Rechteck auf, statt die
   * Ansicht zu drehen.
   */
  _fireLongPress(x, y) {
    this._longPress = null;
    this._dragKandidat = null;      // gehalten statt geschoben
    if (!this._down || this.mode !== "select") return;
    this._longDone = true;            // das folgende pointerup ist kein Klick
    this.scene.endOrbit();            // ab jetzt dreht der Finger nicht mehr
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* egal */ } }
    const pick = this._pickSelect(x, y);
    if (pick) {
      if (pick.data.kind === "clamp") {
        this._selectClampCohort(pick.data.id, true);
        this.onNotice(t("notice_touch_selected", this.selection.size), "info");
        return;
      }
      // Wie beim Klick: ein Verstaerkungsprofil meint alle Rohre seines Laufs.
      const ids = Array.isArray(pick.data.tubes) && pick.data.tubes.length
        ? pick.data.tubes : [pick.data.id];
      const drin = ids.every((id) => this.selection.has(id));
      for (const id of ids) {
        if (drin) this.selection.delete(id);
        else this.selection.set(id, pick.data.kind);
      }
      this.onNotice(t("notice_touch_selected", this.selection.size), "info");
      this.refresh();
      return;
    }
    this._down.box = true;
    this._boxing = false;
    this.scene.showSelectBox(x, y, x, y);
    this.scene.setHover(null);
    this.onNotice(t("notice_touch_box"), "info");
  }

  /**
   * Laufenden Zug ohne Wirkung beenden: Drehen aufheben, Auswahl-Rechteck
   * wegnehmen, ein begonnenes Verschieben auf den Stand davor zuruecksetzen.
   */
  _abortGesture() {
    this._clearLongPress();
    this._longDone = false;
    this._dragKandidat = null;
    this._clampDragKandidat = null;
    this._clampSlideKandidat = null;
    this._pointerId = null;
    this.cancelPaste();
    this._down = null;
    this._cubeDown = null;
    this._cubeDrag = null;
    if (this._boxing) {
      this._boxing = false;
      this.scene.hideSelectBox();
    }
    if (this._drag) {
      const d = this._drag;
      this._drag = null;
      this.model.loadJSON(JSON.parse(d.before));
      this.scene.setCursor("default");
      this.refresh();
    }
    if (this._clampDrag) {
      const d = this._clampDrag;
      this._clampDrag = null;
      this.model.loadJSON(JSON.parse(d.before));
      this.scene.setCursor("default");
      this.refresh();
    }
    if (this._clampSlide) {
      const d = this._clampSlide;
      this._clampSlide = null;
      this.model.loadJSON(JSON.parse(d.before));
      this.scene.setCursor("default");
      this.refresh();
    }
    this._panning = false;
    this.scene.endPan();
    this.scene.endOrbit();
  }


  // Der Zeigefinger-Cursor soll genau das anbieten, was im jeweiligen Modus
  // auch wirklich anklickbar ist -- sonst verspricht er Interaktionen, die es
  // nicht gibt.
  _onMove(e) {
    // Zeigerstelle merken -- Strg+V setzt die Kopie dorthin.
    this._lastPointer = { x: e.clientX, y: e.clientY };
    // Wer den Finger bewegt, will nicht halten -- er dreht die Ansicht.
    if (this._longPress && this._down
        && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > CLICK_TOLERANCE) {
      this._clearLongPress();
    }
    // Am Wuerfel ziehen dreht die Ansicht frei -- um den Bezugspunkt, denn der
    // Zeiger steht ja neben der Szene.
    if (this._cubeDown && (e.buttons & 1)) {
      if (!this._cubeDrag &&
          Math.hypot(e.clientX - this._cubeStart.x, e.clientY - this._cubeStart.y) > CLICK_TOLERANCE) {
        this._cubeDrag = true;
        this.scene.beginOrbitAtTarget();
        this._last = { x: e.clientX, y: e.clientY };
      }
      if (this._cubeDrag) {
        const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
        this._last = { x: e.clientX, y: e.clientY };
        if (dx || dy) this.scene.orbitBy(dx, dy);
      }
      return;
    }
    // Ansichtswuerfel zuerst: solange der Zeiger darueber steht, gilt nichts
    // anderes -- er liegt als Bedienelement ueber der Szene.
    if (!(e.buttons & 1)) {
      const cell = this.scene.pickViewCube(e.clientX, e.clientY);
      this.scene.setViewCubeHover(cell);
      if (cell) {
        this.scene.setHover(null);
        this.scene.setHoverPart(null);
        this.scene.setCursor("pointer");
        return;
      }
    }
    // Kopie am Zeiger: sie folgt ihm -- aber nur mit LOSER Taste. Wer zieht,
    // will die Ansicht drehen (abgesetzt wird ohnehin nur bei einem echten
    // Klick, siehe _onUp); nachgefuehrt sprang die Kopie dabei mit und die
    // Kamera stand still.
    if (this._paste) {
      if ((e.buttons & 1) && this.scene.orbiting) {
        const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
        this._last = { x: e.clientX, y: e.clientY };
        if (dx || dy) this.scene.orbitBy(dx, dy);
        return;
      }
      this._updatePaste(e);
      return;
    }
    // Cursor-Modus: mit gedrueckter linker Taste ziehen zieht ein Auswahl-
    // Rechteck auf, statt zu drehen (das liegt dort auf der rechten Taste).
    // Finger auf einem gewaehlten Teil, jetzt bewegt: der Zug beginnt hier.
    if (this._dragKandidat && (e.buttons & 1) && this._down
        && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > CLICK_TOLERANCE) {
      const kandidat = this._dragKandidat;
      this._dragKandidat = null;
      this._clearLongPress();
      this.scene.endOrbit();
      this._beginMoveDrag(kandidat.e, kandidat.pick);
      this._updateMoveDrag(e);
      return;
    }
    if (this._clampDragKandidat && (e.buttons & 1) && this._down
        && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > CLICK_TOLERANCE) {
      const pick = this._clampDragKandidat;
      this._clampDragKandidat = null;
      this._clearLongPress();
      this.scene.endOrbit();
      this._selectClampCohort(pick.data.id, false);
      if (this._beginClampDrag(pick.data.id)) this._updateClampDrag(e);
      return;
    }
    if (this._clampSlideKandidat && (e.buttons & 1) && this._down
        && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > CLICK_TOLERANCE) {
      const id = this._clampSlideKandidat;
      this._clampSlideKandidat = null;
      this._clearLongPress();
      this.scene.endOrbit();
      this._selectClampCohort(id, false);
      if (this._beginClampSlide(id)) this._updateClampSlide(e);
      return;
    }
    // Auswahl wird gerade geschoben.
    if (this._drag && (e.buttons & 1)) { this._updateMoveDrag(e); return; }
    if (this._clampDrag && (e.buttons & 1)) { this._updateClampDrag(e); return; }
    if (this._clampSlide && (e.buttons & 1)) { this._updateClampSlide(e); return; }
    if (this._panning && (e.buttons & 1)) {
      const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
      this._last = { x: e.clientX, y: e.clientY };
      if (dx || dy) this.scene.panBy(dx, dy);
      return;
    }
    // Linke Taste gedrueckt und kein Rechteck: um den Zeigerpunkt drehen.
    if (this._down && !this._down.box && (e.buttons & 1) && this.scene.orbiting) {
      const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
      this._last = { x: e.clientX, y: e.clientY };
      if (dx || dy) this.scene.orbitBy(dx, dy);
      return;
    }
    if (this._down && this._down.box && (e.buttons & 1)) {
      if (this._boxing ||
          Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > CLICK_TOLERANCE) {
        this._boxing = true;
        this.scene.showSelectBox(this._down.x, this._down.y, e.clientX, e.clientY);
        this.scene.setHover(null);
        this.scene.setHoverPart(null);
        return;
      }
    }
    const x = e.clientX, y = e.clientY;
    const handle = () => this.scene.pickHandle(x, y)?.object || null;
    // Liefert den Treffer selbst (nicht nur das Mesh): Kupplungen und Rohre
    // werden instanziert gezeichnet, die id steht deshalb nur in pick.data.
    const build = (kinds) => {
      const p = this.scene.pickBuild(x, y);
      return p && (!kinds || kinds.includes(p.data.kind)) ? p : null;
    };
    let obj = null;
    let arrowFocus;
    if (this.mode === "select" || this.mode === "delete") {
      // Cursor- und Loesch-Modus: alles Platzierte ist treffbar, Rutschen
      // eingeschlossen. Im Loesch-Modus wird der Klick zum Loeschen.
      obj = this.scene.pickForDelete(x, y)?.object || null;
    } else if (this.mode === "add") {
      if (this.placeConnectorId) {
        const h = this.scene.pickHandle(x, y);
        const p = this.scene.pickBuild(x, y);
        if (h) obj = h.object;
        else if (p && p.data.kind === "node") {
          const n = this.model.nodes.get(p.data.id);
          if (n && this._nodeAcceptsConnector(n, this.placeConnectorId)) obj = p.object;
        }
      } else {
        // Handles + anbaubare Kupplungen (Winkelkupplungen sind es nicht) und
        // Bogenrohre: die lassen sich per Klick weiterdrehen. Wie beim Klick
        // entscheidet die Entfernung, welches von beiden gemeint ist.
        const h = this.scene.pickHandle(x, y);
        const p = this.scene.pickBuild(x, y);
        const bow = p && p.data.kind === "tube" && this.model.tubes.get(p.data.id)?.bow ? p : null;
        if (bow && (!h || p.distance < h.distance)) obj = bow.object;
        else if (h) {
          obj = h.object;
          arrowFocus = h.data && h.data.nodeId != null ? h.data.nodeId : null;
        } else if (p && p.data.kind === "node" && this._isBuildable(p.data.id)) {
          obj = p.object;
          arrowFocus = p.data.id;
        } else {
          arrowFocus = null;
        }
      }
    } else if (this.mode === "panel") {
      // Hand nur, wo die gewaehlte Platte auch hinkann: auf einem Tragrohr mit
      // passendem Gegenrohr, danach auf dem gewaehlten Rohr (Abwahl) und den
      // hervorgehobenen Gegenrohren. Eine liegende Platte laesst sich umlegen.
      const p = (this.panelRail && this.highlight && this.scene.pickAmong(x, y, this.highlight))
        || this.scene.pickForDelete(x, y);
      const kind = p && p.data.kind;
      if (kind === "panel") obj = this.panelRail ? null : p.object;
      else if (kind === "tube") obj = this._railUsable(p.data.id) ? p.object : null;
    } else if (this.mode === "slide") {
      obj = handle();                            // nur die Feld-Handles
    } else if (this.mode === "fitting" && POOL_KINDS.has(this.fittingKind)) {
      obj = handle();
    } else if (this.mode === "fitting" && RAIL_FITTINGS.has(this.fittingKind)) {
      const h = this.scene.pickHandle(x, y);
      if (h) obj = h.object;
      else {
        const p = (this.panelRail && this.highlight && this.scene.pickAmong(x, y, this.highlight))
          || this.scene.pickForDelete(x, y);
        const kind = p && p.data.kind;
        if (kind === "fitting") obj = null;
        else if (kind === "tube") obj = this._railUsable(p.data.id, true) ? p.object : null;
        else if (kind === "node") {
          const ids = this.model.incidentTubeIds(p.data.id);
          obj = ids.some((id) => this._railUsable(id, true)) ? p.object : null;
        }
      }
    } else if (this.mode === "fitting"
        && (TUBE_CLAMP_PARTS[this.fittingKind] || TUBE_FITTINGS[this.fittingKind])) {
      // Der Ankerpunkt folgt dem Zeiger am Rohr entlang.
      this._trackTubeHandles(x, y);
      // Teile auf Rohr/Klemme: Ankerpunkte zuerst, dann Rohre, gesetzte Teile
      // derselben Art (Klick dreht sie) und Kupplungen, an denen das Teil sitzen
      // darf. Fremde Anbauteile fangen den Zeiger NICHT ab.
      const h = this.scene.pickHandle(x, y);
      if (h) obj = h.object;
      else {
        const p = this.scene.pickForDelete(x, y);
        const kind = p && p.data.kind;
        if (kind === "tube") {
          // Kein Platz an dieser Stelle (Punkt ausgeblendet) -> keine Hand.
          const spur = this._tubeHandles.get(p.data.id);
          obj = this._straightTube(p.data.id) && !(spur && !spur.mesh.visible)
            ? p.object : null;
        } else if (kind === "node") {
          const nd = this.model.nodes.get(p.data.id);
          obj = nd && (nd.clampOn || (this._fittingMountNodes && this._fittingMountNodes.has(nd.id)))
            ? p.object : null;
        } else if (kind === "fitting") {
          const eigenes = this.model.fittings.get(p.data.id)?.kind === this.fittingKind;
          obj = eigenes
            ? (this.model.canRotateFitting(p.data.id) ? p.object : null)
            : (this._mountNearPoint(p.point) ? p.object : null);
        }
        // Rohr hinter einem fremden Anbauteil: dorthin laesst sich trotzdem setzen.
        if (!obj && TUBE_FITTINGS[this.fittingKind]) {
          const tp = this.scene.pickTube(x, y);
          const spur = tp && this._tubeHandles.get(tp.data.id);
          if (tp && this._straightTube(tp.data.id) && !(spur && !spur.mesh.visible)) obj = tp.object;
        }
      }
    } else if (this.mode === "fitting") {
      // Ankerpunkte setzen, ein Klick auf ein gesetztes Anbauteil entfernt es.
      const h = this.scene.pickHandle(x, y);
      const p = this.scene.pickForDelete(x, y);
      const fremd = p && p.data.kind === "fitting"
        && this.model.fittings.get(p.data.id)?.kind !== this.fittingKind;
      if (h && (!p || h.distance <= p.distance)) obj = h.object;
      else if (p && p.data.kind === "fitting" && !fremd && this.model.canRotateFitting(p.data.id)) obj = p.object;
      else if (fremd && this._mountNearPoint(p.point)) obj = p.object;
      else obj = null;
    } else if (this.mode === "clamp") {
      this._trackTubeHandles(x, y);
      const p = this.scene.pickClamp(x, y) || build(["tube", "clamp"]);
      const echt = p && (p.data.kind === "clamp" || this._straightTube(p.data.id));
      obj = handle() || (echt ? p.object : null);
    } else if (this.mode === "c45") {
      // Zeigefinger auf den Ankerpunkten und auf schon gesetzten Winkelkupplungen.
      const p = build(["node"]);
      const gesetzt = p && this.model.nodes.get(p.data.id)?.c45body;
      obj = handle() || (gesetzt ? p.object : null);
    } else if (this.mode === "reinforce") {
      // Sucht das erste Rohr noch seinen Partner, zeigt die Hand nur auf den
      // hervorgehobenen Gegenstuecken.
      const p = (this.reinforceRail && this.highlight && this.scene.pickAmong(x, y, this.highlight))
        || build(["tube"]);
      obj = p && p.data.kind === "tube" && this._reinforceUsable(p.data.id) ? p.object : null;
    } else if (this.mode === "assembly") {
      // Nur ansehen -- aber die Hand zeigt, dass sich ein Teil nachschlagen laesst.
      obj = this.scene.pickForDelete(x, y)?.object || null;
    }
    if (this.mode === "select" || this.mode === "delete") {
      const raw = this.mode === "select"
        ? this._pickSelect(x, y)
        : this.scene.pickForDelete(x, y);
      const p = this.mode === "delete" ? this._resolveDeletePick(raw, x, y) : raw;
      this.scene.setHover(null);
      this.scene.setHoverPart(p, this.mode, x, y, this._deleteHoverExtras(p));
      if (this.mode === "select" && p) {
        if (p.data.kind === "clamp" && this.selection.has(p.data.id)) this.scene.setCursor("grab");
        else if (this._slideDriverForPick(p)
            && (this._selectedClampDriver() || this.selection.has(p.data.id))) {
          this.scene.setCursor("move");
        } else if (this.selection.size && this._isMoveHandle(p.data.id)) this.scene.setCursor("move");
      }
      return;
    }
    this.scene.setHoverPart(null);
    this.scene.setHover(obj, this.mode === "add" && !this.placeConnectorId ? arrowFocus : undefined);
  }

  _onUp(e) {
    // Klick auf den Ansichtswuerfel: Kamera dorthin schwenken.
    if (this._cubeDown) {
      const dragged = this._cubeDrag;
      this._cubeDown = null;
      this._cubeDrag = null;
      if (dragged) { this.scene.endOrbit(); return; }
      const cell = this.scene.pickViewCube(e.clientX, e.clientY);
      if (cell) this.scene.snapToDirection(cell.userData.dir);
      return;
    }
    if (this._panning) {
      this._panning = false;
      this._down = null;
      this._dragKandidat = null;
      this.scene.endPan();
      return;
    }
    const d = this._down;
    this._down = null;
    this._dragKandidat = null;
    this._clearLongPress();
    const gehalten = this._longDone;
    this._longDone = false;
    // Kopie absetzen -- aber nur bei einem ECHTEN Klick. Wer mit gedrueckter
    // Taste gezogen hat, wollte die Ansicht drehen.
    if (this._paste) {
      this.scene.endOrbit();
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= CLICK_TOLERANCE && e.button === 0) {
        this.commitPaste();
      }
      return;
    }
    // Verschieben abschliessen: hier faellt der eine Undo-Schritt an und hier
    // werden deckungsgleiche Kupplungen zusammengelegt.
    if (this._drag) { this._endMoveDrag(); return; }
    if (this._clampDrag) { this._endClampDrag(e); return; }
    if (this._clampSlide) { this._endClampSlide(); return; }
    this._clampDragKandidat = null;
    this._clampSlideKandidat = null;
    if (!d) { this.scene.endOrbit(); return; }
    // endOrbit() fuehrt den Drehpunkt nach und ruft controls.update() -- das
    // kann die Kamera minimal versetzen. Deshalb ERST den Klick auswerten,
    // sonst zielt der Pick auf einen veralteten Bildpunkt.
    const finish = () => this.scene.endOrbit();
    if (this._boxing) {
      this._boxing = false;
      this.scene.hideSelectBox();
      // Das Rechteck ergaenzt immer: mehrere Zuege lassen sich so zu einer
      // Auswahl zusammensetzen. Aufgehoben wird sie per Klick ins Leere.
      const found = this.scene.pickInRect(d.x, d.y, e.clientX, e.clientY);
      for (const [id, kind] of found) this.selection.set(id, kind);
      finish();
      this.refresh();
      return;
    }
    // Das Halten WAR die Geste (Teil geschaltet oder Rechteck begonnen) -- der
    // Finger hebt danach ab, ohne dass noch ein Klick gemeint ist.
    if (gehalten) { finish(); return; }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_TOLERANCE) {
      this._selectClick = null;
      finish();
      return;
    } // Drehen
    // Nur die LINKE Taste setzt/loescht. Rechts gehoert dem Kontextmenue der
    // Zeichenflaeche (im Platten-Modus: drehen) -- ohne diese Pruefung lief
    // beides zugleich und die Platte klappte nebenbei auf die andere Seite.
    if (e.button !== 0) { finish(); return; }
    // JEDER Klick ins Bild hebt eine Hervorhebung aus Stueckliste, Bestand oder
    // Aufbau wieder auf -- auch einer, der ein Teil trifft. Sie gehoert keinem
    // Modus, und in einem dichten Modell trifft man beim Wegklicken fast immer
    // irgendetwas; mit der Bedingung "nur ins Leere" blieb sie deshalb gefuehlt
    // haengen. Die Hervorhebungen der Platten- und Verstaerkungs-Ablaeufe
    // haengen dagegen an ihrem Rohr und bleiben.
    if (this.highlight && !this.panelRail && !this.reinforceRail) {
      this.highlight = null;
      this.onHighlightCleared();
      // Neu zeichnen MUSS hier passieren: die Klick-Behandlung der Modi kommt
      // ohne Auswahl oft gar nicht bis zu einem refresh (clearSelection steigt
      // bei leerer Auswahl sofort aus). Ohne diese Zeile war die Hervorhebung
      // zwar weg, das Bild zeigte sie aber weiter.
      this.refresh();
    }
    if (this.mode === "select") this._clickSelect(e);
    else if (this.mode === "delete") this._clickDelete(e);
    else if (this.mode === "add") this._clickAdd(e);
    else if (this.mode === "panel") this._clickPanel(e);
    else if (this.mode === "slide") this._clickSlide(e);
    else if (this.mode === "fitting") this._clickFitting(e);
    else if (this.mode === "clamp") this._clickClamp(e);
    else if (this.mode === "c45") this._clickC45(e);
    else if (this.mode === "reinforce") this._clickReinforce(e);
    else if (this.mode === "assembly") this._clickAssembly(e);
    finish();
  }

  /**
   * Aufbau-Modus: ein Teil anklicken zeigt seinen Namen. Es wird NICHTS am
   * Modell geaendert -- die Auswahl dient hier nur dem Nachschlagen.
   */
  _clickAssembly(e) {
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    const id = pick ? pick.data.id : null;
    // Erneuter Klick auf dasselbe Teil nimmt die Anzeige wieder weg.
    const same = id != null && this.selection.size === 1 && this.selection.has(id);
    this.selection.clear();
    if (id != null && !same) this.selection.set(id, pick.data.kind);
    // Hervorhebung aus der Schrittliste und Einzelauswahl schliessen sich aus.
    if (this.highlight) { this.highlight = null; this.onHighlightCleared(); }
    this.refresh();
  }

  /**
   * Klick auf ein Rohr schiebt ein Holz-Profil ein oder zieht es heraus. Zu
   * kaufen gibt es nur die 80-cm-Laenge: sie fuellt entweder ein 75er-Rohr oder
   * zwei 35er in einer Linie. Beim 35er wartet der zweite Klick auf das
   * Partnerrohr -- die moeglichen sind so lange hervorgehoben (wie bei der
   * Platte).
   */
  _clickReinforce(e) {
    // Ist das erste Rohr gewaehlt, zaehlen zuerst die hervorgehobenen Partner --
    // auch wenn ein anderes Teil davor liegt.
    const pick = (this.reinforceRail && this.highlight
      && this.scene.pickAmong(e.clientX, e.clientY, this.highlight))
      || this.scene.pickBuild(e.clientX, e.clientY);
    if (!pick || pick.data.kind !== "tube") { this._clearReinforceRail(); return; }
    const tube = this.model.tubes.get(pick.data.id);
    if (!tube) { this._clearReinforceRail(); return; }

    // Zweiter Klick: passt das angeklickte Rohr als Partner?
    if (this.reinforceRail) {
      const erste = this.reinforceRail;
      if (tube.id === erste) { this._clearReinforceRail(); return; }
      const partner = this.model.reinforcePartners(erste).some((o) => o.id === tube.id);
      if (!partner) { this.onNotice(t("notice_reinforce_no_fit"), "warn"); return; }
      this.recordHistory(() => { this.model.addReinforcement([erste, tube.id]); });
      this._clearReinforceRail();
      this.onNotice(t("notice_reinforce_added"));
      this.refresh();
      return;
    }

    // Schon verstaerkt: Profil herausziehen (beim 35er mit seinem Partner).
    if (tube.reinforced) {
      this.recordHistory(() => { this.model.removeReinforcement(tube.id); });
      this.onNotice(t("notice_reinforce_removed"));
      this.refresh();
      return;
    }
    // Ein 75er nimmt das Profil allein auf.
    if (this.model.takesReinforcementAlone(tube)) {
      this.recordHistory(() => { this.model.addReinforcement([tube.id]); });
      this.onNotice(t("notice_reinforce_added"));
      this.refresh();
      return;
    }
    // Ein 35er braucht ein zweites in derselben Linie.
    if (this.model.takesReinforcementPaired(tube)) {
      const partner = this.model.reinforcePartners(tube.id);
      if (!partner.length) { this.onNotice(t("notice_reinforce_no_partner"), "warn"); return; }
      this.reinforceRail = tube.id;
      this.highlight = new Set(partner.map((o) => o.id));
      this.onNotice(t("notice_reinforce_pick_second", partner.length), "info");
      this.refresh();
      return;
    }
    this.onNotice(t("notice_reinforce_wrong_tube"), "warn");
  }

  /** Laesst sich an diesem Rohr gerade ein Profil setzen oder herausziehen? */
  _reinforceUsable(id) {
    const tube = this.model.tubes.get(id);
    if (!tube || tube.arm || tube.link || tube.bow) return false;
    if (this.reinforceRail) return this.highlight ? this.highlight.has(id) : false;
    if (tube.reinforced) return true;
    if (this.model.takesReinforcementAlone(tube)) return true;
    return this.model.takesReinforcementPaired(tube)
      && this.model.reinforcePartners(id).length > 0;
  }

  _clearReinforceRail() {
    if (!this.reinforceRail && !this.highlight) return;
    this.reinforceRail = null;
    this.highlight = null;
    this.refresh();
  }

  // Klick auf ein Rohr setzt einen Doppelrohrverbinder oder eine Rohrklammer an
  // den Treffpunkt; ein Klick auf eine bestehende dreht sie weiter. Ziehen um
  // das Rohr stellt einen beliebigen Winkel ein. Das Rohr in ihre freie
  // Oeffnung kommt im BAU-Modus dazu, nicht hier.
  // Im Auswahl-Modus gilt dasselbe Drehen, sobald die Klemme gewaehlt ist;
  // Schwestern mit zweiter Tube kommen in die Auswahl und drehen mit.
  // Die zweite Tube laesst sich entlang der ersten schieben und snappt an sie.

  _pickSelect(x, y) {
    const clampHit = this.scene.pickClamp(x, y);
    const hits = this.scene.pickAllForDelete ? this.scene.pickAllForDelete(x, y) : [];
    let allHit = hits.length ? hits[0] : this.scene.pickForDelete(x, y);
    // 同一个位置、隔一会儿再点一次：选它后面那一件。密闭的盒子里底板被侧板
    // 挡着，点不到，就靠这个一层层往里选。快的两下还是选整块，不冲突。
    const last = this._selectClick;
    if (hits.length > 1 && last && Math.hypot(x - last.x, y - last.y) < CLICK_TOLERANCE
        && performance.now() - last.t >= SELECT_BLOCK_MS) {
      const cur = this.selection.size === 1 ? [...this.selection.keys()][0] : null;
      const idx = cur != null ? hits.findIndex((h) => h.data && h.data.id === cur) : -1;
      if (idx >= 0) allHit = hits[(idx + 1) % hits.length];
    }
    if (clampHit && (!allHit || allHit.data.kind === "clamp"
        || clampHit.distance <= allHit.distance + 6))
      return clampHit;
    return allHit;
  }

  _selectClampCohort(id, add) {
    const group = this.model.clampCohort(id);
    const clampIds = [...group.clamps];
    const tubeIds = [...group.tubes];
    const schonDrin = clampIds.every((x) => this.selection.has(x))
      && tubeIds.every((x) => this.selection.has(x));
    const n = clampIds.length + tubeIds.length;
    if (add) {
      if (schonDrin) {
        for (const x of clampIds) this.selection.delete(x);
        for (const x of tubeIds) this.selection.delete(x);
      } else {
        for (const x of clampIds) this.selection.set(x, "clamp");
        for (const x of tubeIds) this.selection.set(x, "tube");
      }
    } else if (this.selection.size === n && schonDrin) {
      this.selection.clear();
    } else {
      this.selection.clear();
      for (const x of clampIds) this.selection.set(x, "clamp");
      for (const x of tubeIds) this.selection.set(x, "tube");
    }
    this._profilAuswahl = null;
    this.refresh();
  }

  _selectedClampDriver() {
    let driver = null;
    for (const [id, kind] of this.selection) {
      if (kind === "clamp") { driver = id; break; }
    }
    if (!driver) {
      for (const [id, kind] of this.selection) {
        if (kind !== "tube") continue;
        for (const c of this.model.clamps.values()) {
          const t = this.model._clampSecondTube(c);
          if (t && t.id === id) { driver = c.id; break; }
        }
        if (driver) break;
      }
    }
    if (!driver) return null;
    const c = this.model.clamps.get(driver);
    if (!c) return null;
    const flap = this.model._clampFlap(c);
    const panelOk = (id, kind) => {
      if (kind !== "panel" && kind !== "textile") return false;
      const p = (kind === "panel" ? this.model.panels : this.model.textiles).get(id);
      return !!(p && (flap.second.has(p.a) || flap.second.has(p.b)));
    };
    for (const [id, kind] of this.selection) {
      if (kind === "clamp" && flap.clampIds.has(id)) continue;
      if (kind === "tube" && flap.second.has(id)) continue;
      if (panelOk(id, kind)) continue;
      return null;
    }
    return driver;
  }

  _flapDriverForPick(pick) {
    if (!pick || !this.selection.size) return null;
    const kind = pick.data.kind;
    const id = pick.data.id;
    for (const [cid, k] of this.selection) {
      if (k !== "clamp") continue;
      const c = this.model.clamps.get(cid);
      if (!c) continue;
      const flap = this.model._clampFlap(c);
      if (kind === "tube" && flap.second.has(id)) return cid;
      if (kind === "panel" || kind === "textile") {
        const p = (kind === "panel" ? this.model.panels : this.model.textiles).get(id);
        if (p && (flap.second.has(p.a) || flap.second.has(p.b))) return cid;
      }
    }
    return null;
  }

  /** Zweite Tube / Klappen-Platte: die Klemme, entlang deren Rohr sich das schiebt. */
  _slideDriverForPick(pick) {
    if (!pick) return null;
    const fromSel = this._flapDriverForPick(pick);
    if (fromSel) return fromSel;
    const kind = pick.data.kind;
    const id = pick.data.id;
    if (kind === "tube") {
      for (const c of this.model.clamps.values()) {
        const t = this.model._clampSecondTube(c);
        if (t && t.id === id) return c.id;
      }
      return null;
    }
    if (kind !== "panel" && kind !== "textile") return null;
    const p = (kind === "panel" ? this.model.panels : this.model.textiles).get(id);
    if (!p) return null;
    for (const c of this.model.clamps.values()) {
      const t = this.model._clampSecondTube(c);
      if (t && (t.id === p.a || t.id === p.b)) return c.id;
    }
    return null;
  }

  _beginClampDrag(id) {
    const c = this.model.clamps.get(id);
    if (!c || !c.dir || !c.off) return false;
    this._clampDrag = {
      id,
      before: JSON.stringify(this.model.toJSON()),
      origin: [c.x, c.y, c.z],
      axis: c.dir.slice(),
      startOff: c.off.slice(),
      moved: false,
    };
    this.scene.setCursor("grabbing");
    return true;
  }

  _snapDirAroundAxis(dir, u, stepRad) {
    let ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t = u[0] * ref[0] + u[1] * ref[1] + u[2] * ref[2];
    ref = [ref[0] - u[0] * t, ref[1] - u[1] * t, ref[2] - u[2] * t];
    const rl = Math.hypot(...ref) || 1;
    ref = [ref[0] / rl, ref[1] / rl, ref[2] / rl];
    const si = u[0] * (ref[1] * dir[2] - ref[2] * dir[1])
      + u[1] * (ref[2] * dir[0] - ref[0] * dir[2])
      + u[2] * (ref[0] * dir[1] - ref[1] * dir[0]);
    const co = ref[0] * dir[0] + ref[1] * dir[1] + ref[2] * dir[2];
    const snapped = Math.round(Math.atan2(si, co) / stepRad) * stepRad;
    const cs = Math.cos(snapped), ss = Math.sin(snapped);
    const c2 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
    const d = (u[0] * ref[0] + u[1] * ref[1] + u[2] * ref[2]) * (1 - cs);
    return [ref[0] * cs + c2[0] * ss + u[0] * d, ref[1] * cs + c2[1] * ss + u[1] * d, ref[2] * cs + c2[2] * ss + u[2] * d];
  }

  _updateClampDrag(e) {
    const d = this._clampDrag;
    if (!d || !this._down) return;
    if (!d.moved && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) <= CLICK_TOLERANCE) return;
    d.moved = true;
    const hit = this.scene.pointOnPlane(e.clientX, e.clientY, d.origin, d.axis);
    if (!hit) return;
    const u = d.axis;
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    const ux = u[0] / ul, uy = u[1] / ul, uz = u[2] / ul;
    let q = [hit.x - d.origin[0], hit.y - d.origin[1], hit.z - d.origin[2]];
    const along = q[0] * ux + q[1] * uy + q[2] * uz;
    q = [q[0] - ux * along, q[1] - uy * along, q[2] - uz * along];
    const ql = Math.hypot(q[0], q[1], q[2]);
    if (ql < 0.4) return;
    q = [q[0] / ql, q[1] / ql, q[2] / ql];
    if (e.shiftKey) q = this._snapDirAroundAxis(q, [ux, uy, uz], Math.PI / 12);
    this.model.loadJSON(JSON.parse(d.before));
    const ok = this.model.setClampOffDir(d.id, q);
    if (!ok && d.lastDir) this.model.setClampOffDir(d.id, d.lastDir);
    else if (ok) d.lastDir = q;
    this.refresh();
    const c = this.model.clamps.get(d.id);
    if (c && c.off && d.startOff) {
      const a = d.startOff, b = c.off;
      const al = Math.hypot(...a) || 1, bl = Math.hypot(...b) || 1;
      const from = [a[0] / al, a[1] / al, a[2] / al];
      const to = [b[0] / bl, b[1] / bl, b[2] / bl];
      const si = ux * (from[1] * to[2] - from[2] * to[1])
        + uy * (from[2] * to[0] - from[0] * to[2])
        + uz * (from[0] * to[1] - from[1] * to[0]);
      const co = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
      const deg = Math.round(Math.atan2(si, co) * 180 / Math.PI);
      this.onNotice(t("notice_clamp_angle", deg), "info");
    }
  }

  _endClampDrag(e) {
    const d = this._clampDrag;
    this._clampDrag = null;
    this.scene.setCursor("default");
    this.scene.endOrbit();
    if (!d) return;
    if (!d.moved) {
      let turned = false;
      this.recordHistory(() => { turned = this.model.rotateClamp(d.id); });
      if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
      this.refresh();
      return;
    }
    this._pushHistory(d.before);
    this.refresh();
  }

  _beginClampSlide(id) {
    const c = this.model.clamps.get(id);
    if (!c || !c.dir) return false;
    const group = this.model.clampCohort(id);
    if (!group.tubes.size) return false;
    const tb = this.model.tubes.get([...group.tubes][0]);
    const n0 = tb && this.model.nodes.get(tb.a);
    this._clampSlide = {
      id,
      before: JSON.stringify(this.model.toJSON()),
      origin: [c.x, c.y, c.z],
      axis: c.dir.slice(),
      mark: n0 ? [n0.id, n0.x, n0.y, n0.z] : null,
      moved: false,
    };
    this.scene.setCursor("grabbing");
    return true;
  }

  _updateClampSlide(e) {
    const d = this._clampSlide;
    if (!d || !this._down) return;
    if (!d.moved && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) <= CLICK_TOLERANCE) return;
    d.moved = true;
    const hit = this.scene.dragPlanePoint(e.clientX, e.clientY, d.origin);
    if (!hit) return;
    const u = d.axis;
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    const ux = u[0] / ul, uy = u[1] / ul, uz = u[2] / ul;
    let delta = (hit.x - d.origin[0]) * ux + (hit.y - d.origin[1]) * uy + (hit.z - d.origin[2]) * uz;
    delta = Math.round(delta / SNAP_STEP) * SNAP_STEP;
    this.model.loadJSON(JSON.parse(d.before));
    this.model.slideClampFlap(d.id, delta, { snapDist: this._snapRadius() });
    this.refresh();
    let along = 0;
    if (d.mark) {
      const n = this.model.nodes.get(d.mark[0]);
      if (n) {
        along = Math.round((n.x - d.mark[1]) * ux + (n.y - d.mark[2]) * uy + (n.z - d.mark[3]) * uz);
      }
    }
    this.onNotice(t("notice_clamp_slide", along), "info");
  }

  _endClampSlide() {
    const d = this._clampSlide;
    this._clampSlide = null;
    this.scene.setCursor("default");
    this.scene.endOrbit();
    if (!d || !d.moved) return;
    this._pushHistory(d.before);
    this.refresh();
  }

  _clickClamp(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data.clampTube) {
      const ct = h.data.clampTube;
      // Ruhelage: der Punkt liegt auf der Rohrachse, dann gibt der Versatz nach
      // oben die Seite vor. Ist er dem Zeiger gefolgt, liegt er schon auf der
      // richtigen Seite des Rohrs.
      this._placeClampOnTube(ct.tubeId, ct.tracked
        ? { x: ct.pos[0], y: ct.pos[1], z: ct.pos[2] }
        : { x: ct.pos[0], y: ct.pos[1] + 3, z: ct.pos[2] });
      return;
    }
    const pick = this.scene.pickClamp(e.clientX, e.clientY)
      || this.scene.pickBuild(e.clientX, e.clientY);
    if (!pick) return;
    if (pick.data.kind === "clamp") {
      // Erneuter Klick DREHT ihn um 45 Grad weiter -- geloescht wird im
      // Auswahl-Modus, wie bei allen anderen Teilen auch.
      let turned = false;
      this.recordHistory(() => { turned = this.model.rotateClamp(pick.data.id); });
      if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
      this.refresh();
      return;
    }
    if (pick.data.kind !== "tube" || !pick.point) {
      this.onNotice(t("notice_clamp_click_tube"), "info");
      return;
    }
    this._placeClampOnTube(pick.data.id, pick.point);
  }

  // Montagestellen fuer Rutschen: Felder aus zwei senkrechten, parallelen Rohren.
  _buildSlideHandles() {
    // Der Rutschenauslauf haengt nur an einem Koerper, nie am Geruest.
    if (this.slideKind !== "slide-end2") {
      for (const m of this.model.slideMounts(40, 2, this.slideKind)) {
        this.scene.addPanelHandle(m.corners, { slideMount: m });
      }
    }
    // Freie Ausgaenge schon gesetzter Teile: dort wird die Kette fortgesetzt.
    // Gezeichnet wird die Standflaeche des naechsten Teils, nicht ein Punkt:
    // der Punkt laege in der Muendung des Koerpers, unsichtbar und vom Koerper
    // verdeckt -- der Klick ging ins Leere.
    for (const m of this.model.slideChainMounts(this.slideKind)) {
      this.scene.addPanelHandle(this._slideChainFootprint(m), { slideChain: m });
    }
  }

  /**
   * Standflaeche des Kettenteils, das an diesem Ausgang beginnen wuerde --
   * waagerecht auf Hoehe des Ausgangs, in dessen Laufrichtung (lokales +Z),
   * 40 cm breit. Laengen nach den Teilen: Auslauf 47,5 cm, Modularkoerper 120 cm
   * (Folgeteil bei +120), Bogenkoerper ein 60x60-Quadrat nach +X/+Z (Folgeteil
   * bei (60, -80, 60)).
   */
  _slideChainFootprint(m) {
    const q = m.quat || [0, 0, 0, 1];
    const ex = xAxisOf(q), ez = zAxisOf(q);
    const kind = this.slideKind;
    const len = kind === "slide-end2" ? 47.5 : kind === "curved-slide2" ? 60 : 120;
    const x0 = kind === "curved-slide2" ? 0 : -20;
    const x1 = kind === "curved-slide2" ? 60 : 20;
    const y = m.pos[1] + 0.5;
    const at = (sx, sz) => [
      m.pos[0] + ex[0] * sx + ez[0] * sz, y + ex[1] * sx + ez[1] * sz, m.pos[2] + ex[2] * sx + ez[2] * sz,
    ];
    return [at(x0, 0), at(x1, 0), at(x1, len), at(x0, len)];
  }

  /** Dachtuch: Klick auf eine gruene Dachschraege legt es auf das Gerippe. */
  _clickRoof(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.roofMount) {
      const m = h.data.roofMount;
      let added = null;
      this.recordHistory(() => { added = this.model.addRoofAt(m, this.colorFor("slide")); });
      if (added) this._notePlaced(added.id, m.kind === "roof2" ? "slide" : "fitting");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    this._hintPlaceMode();
  }

  /**
   * Nach dem Setzen einer Rutsche: steckt sie in Rohren, Platten oder Kupplungen,
   * sagt eine Warnung wie viele -- weggenommen wird nichts, das entscheidet der
   * Nutzer selbst.
   */
  _warnSlideConflicts(slide) {
    const c = this.model.slideConflicts(slide);
    if (!c.total) return false;
    const teile = [];
    if (c.tubes) teile.push(t("conflict_tubes", c.tubes));
    if (c.nodes) teile.push(t("conflict_nodes", c.nodes));
    if (c.panels) teile.push(t("conflict_panels", c.panels));
    if (c.textiles) teile.push(t("conflict_textiles", c.textiles));
    if (c.fittings) teile.push(t("conflict_fittings", c.fittings));
    this.onNotice(t("notice_slide_conflict", teile.join(t("conflict_sep"))), "warn");
    return true;
  }

  _clickPoolLiner(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.poolMount) {
      let added = null;
      this.recordHistory(() => { added = this.model.addPoolLiner(h.data.poolMount); });
      if (added) this._notePlaced(added.id, "fitting");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    this.onNotice(t("notice_pool_pick_frame"), "info");
  }

  /**
   * Anbauteil-Modus: Ankerpunkt anklicken setzt das gewaehlte Teil, ein Klick
   * auf ein gesetztes Anbauteil nimmt es wieder weg. Naeher am Auge gewinnt --
   * sonst laege ein Ankerpunkt hinter einem Teil und man kaeme nicht daran.
   */
  /** 模型里的泳池（配件 pool2 / pool-small2）。 */
  _pools() {
    return [...this.model.fittings.values()].filter((f) => POOL_KINDS.has(f.kind));
  }

  /** 泳池口的四个角（世界坐标）：局部 x 是宽，z 是深（带正负），y=0 是前墙上沿。 */
  _poolOpeningCorners(f) {
    const q = f.quat && f.quat.length === 4 ? f.quat : [0, 0, 0, 1];
    const ex = xAxisOf(q), ez = zAxisOf(q);
    const w = f.w || 120, d = f.d || 120;
    const at = (lx, lz) => [f.x + ex[0] * lx + ez[0] * lz, f.y + ex[1] * lx + ez[1] * lz, f.z + ex[2] * lx + ez[2] * lz];
    return [at(-w / 2, 0), at(w / 2, 0), at(w / 2, d), at(-w / 2, d)];
  }

  _clickBalls(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    const f = h && h.data && h.data.poolBalls ? this.model.fittings.get(h.data.poolBalls) : null;
    if (!f) { this.onNotice(t("notice_balls_pick"), "info"); return; }
    this.recordHistory(() => { f.balls = !f.balls; });
    this.onNotice(t(f.balls ? "notice_balls_in" : "notice_balls_out"));
    this.refresh();
  }

  _clickSleeve(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.sleeveTube) {
      const tb = this.model.tubes.get(h.data.sleeveTube);
      const a = tb && this.model.nodes.get(tb.a), b = tb && this.model.nodes.get(tb.b);
      if (!a || !b) return;
      let added = null;
      this.recordHistory(() => {
        added = this.model.addFitting("sleeve", (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
          { color: this.colorFor("panel") });
        if (added) added.tube = tb.id;
      });
      if (added) this.onNotice(t("notice_sleeve_on"));
      this.refresh();
      return;
    }
    // 点软包本身：取下来
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    if (pick && pick.data && pick.data.kind === "fitting") {
      const f = this.model.fittings.get(pick.data.id);
      if (f && f.kind === "sleeve") {
        this.recordHistory(() => { this.model.removeFitting(f.id); });
        this.onNotice(t("notice_sleeve_off"));
        this.refresh();
        return;
      }
    }
    this.onNotice(t("notice_sleeve_pick"), "info");
  }

  _clickFitting(e) {
    if (this.fittingKind === "sleeve") { this._clickSleeve(e); return; }
    if (this.fittingKind === "balls") { this._clickBalls(e); return; }
    if (ROOF_KINDS.has(this.fittingKind)) { this._clickRoof(e); return; }
    if (POOL_KINDS.has(this.fittingKind)) { this._clickPoolLiner(e); return; }
    if (RAIL_FITTINGS.has(this.fittingKind)) { this._clickLattice(e); return; }
    if (HOLE_MASKS[this.fittingKind]) { this._clickHoleClamp(e); return; }
    if (this.fittingKind === BOLT_PART || this.fittingKind === HINGE_PART) { this._clickFlexi(e); return; }
    if (TUBE_CLAMP_PARTS[this.fittingKind]) { this._clickTubeClamp(e); return; }
    if (TUBE_FITTINGS[this.fittingKind]) { this._clickTubeFitting(e); return; }
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    const p = this.scene.pickForDelete(e.clientX, e.clientY);
    // Der Ankerpunkt hat Vorrang: er liegt dicht an der Kupplung, und die waere
    // sonst als naeheres Teil im Weg.
    if (h && h.data && h.data.fittingMount) {
      let added = null;
      this.recordHistory(() => {
        added = this.model.addFittingAt(this.fittingKind, h.data.fittingMount, this.colorFor("fitting"));
      });
      if (added) this._notePlaced(added.id, "fitting");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    if (p && p.data.kind === "fitting"
        && this.model.fittings.get(p.data.id)?.kind !== this.fittingKind) {
      // Fremdes Teil verdeckt den Ankerpunkt: die Stelle dahinter gilt trotzdem.
      const nah = this._mountNearPoint(p.point);
      if (nah) {
        let added = null;
        this.recordHistory(() => {
          added = this.model.addFittingAt(this.fittingKind, nah, this.colorFor("fitting"));
        });
        if (added) this._notePlaced(added.id, "fitting");
        else this.onNotice(t("notice_fitting_exists"), "warn");
        this.refresh();
        return;
      }
    }
    if (p && p.data.kind === "fitting") {
      // Klick auf ein gesetztes Teil DREHT es weiter (wie beim Bogenrohr) --
      // geloescht wird im Auswahl-Modus. Teile ohne Wahlmoeglichkeit bleiben.
      let turned = false;
      this.recordHistory(() => { turned = this.model.rotateFitting(p.data.id); });
      if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
      this.refresh();
      return;
    }
    this._pickFittingNode(p);
  }

  /**
   * Klick auf eine Kupplung waehlt sie aus: danach zeigt nur noch sie ihre
   * Ankerpunkte. Ein Klick ins Leere hebt die Wahl wieder auf.
   */
  _pickFittingNode(pick) {
    if (pick && pick.data.kind === "node") {
      this.selectedNodeId = pick.data.id === this.selectedNodeId ? null : pick.data.id;
      this.refresh();
      return;
    }
    if (!pick && this.selectedNodeId) { this.selectedNodeId = null; this.refresh(); }
  }

  /**
   * Teil auf einem Rohr (Rad, Schwimmrad, Nabenkappe): Rohr anklicken. Raeder
   * sitzen genau an der angeklickten Stelle, die Nabenkappe am naeheren Ende.
   * Ein Klick auf ein gesetztes Teil dreht es -- oder meldet, dass es nichts zu
   * drehen gibt.
   */
  _clickTubeFitting(e) {
    // Das Multirad hat beides: Ankerpunkte auf den Radlagern UND die freie
    // Stelle auf einem Rohr. Ein getroffener Ankerpunkt geht vor.
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.fittingMount) {
      let added = null;
      this.recordHistory(() => {
        added = this.model.addFittingAt(this.fittingKind, h.data.fittingMount, this.colorFor("fitting"));
      });
      if (added) this._notePlaced(added.id, "fitting");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    // Nur ein Teil DERSELBEN Art faengt den Klick ab -- sonst verdeckt das
    // erste gesetzte Rad das Rohr und nichts liesse sich mehr daneben setzen.
    if (pick && pick.data.kind === "fitting"
        && this.model.fittings.get(pick.data.id)?.kind === this.fittingKind) {
      let turned = false;
      this.recordHistory(() => { turned = this.model.rotateFitting(pick.data.id); });
      if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
      this.refresh();
      return;
    }
    // Fremdes Anbauteil im Weg (Arretierung ueber dem Radlager): die Stelle
    // dahinter gilt trotzdem.
    if (pick && pick.data.kind === "fitting") {
      const nah = this._mountNearPoint(pick.point);
      if (nah) {
        let added = null;
        this.recordHistory(() => {
          added = this.model.addFittingAt(this.fittingKind, nah, this.colorFor("fitting"));
        });
        if (added) this._notePlaced(added.id, "fitting");
        else this.onNotice(t("notice_fitting_exists"), "warn");
        this.refresh();
        return;
      }
    }
    const hitTube = this.scene.pickTube ? this.scene.pickTube(e.clientX, e.clientY) : null;
    const tubePick = (pick && pick.data.kind === "tube") ? pick : hitTube;
    if (!tubePick || !tubePick.point) { this._pickFittingNode(pick); return; }
    const pickData = tubePick.data;
    const tb = this.model.tubes.get(pickData.id);
    if (!tb || tb.arm || tb.link || tb.bow) { this.onNotice(t("notice_clamp_click_tube"), "info"); return; }
    const hit = [tubePick.point.x, tubePick.point.y, tubePick.point.z];
    const mount = this.model.tubeFittingMount(pickData.id, hit, this.fittingKind,
      geometry().connectorSize);
    if (!mount) { this.onNotice(t("notice_fitting_no_room"), "warn"); return; }
    let added = null;
    this.recordHistory(() => {
      added = this.model.addFittingAt(this.fittingKind, mount, this.colorFor("fitting"));
    });
    if (added) this._notePlaced(added.id, "fitting");
    else this.onNotice(t("notice_fitting_no_room"), "warn");
    this.refresh();
  }

  /**
   * Montagestelle des gewaehlten Teils dicht am angeklickten Punkt.
   *
   * Ein fremdes Anbauteil kann den Ankerpunkt verdecken: die Multirad-
   * Arretierung ist eine Scheibe genau dort, wo das Multirad auf sein Radlager
   * gehoert. Wer auf die Scheibe klickt, verfehlt die kleine Kugel des
   * Ankerpunkts -- gemeint ist aber offensichtlich diese Stelle.
   */
  _mountNearPoint(point, tol = 8) {
    if (!point) return null;
    const besetzt = (m) => {
      for (const f of this.model.fittings.values()) {
        if (f.kind !== this.fittingKind) continue;
        if (Math.hypot(f.x - m.pos[0], f.y - m.pos[1], f.z - m.pos[2]) < 2) return true;
      }
      return false;
    };
    let best = null, bd = tol;
    for (const m of this.model.fittingMounts(this.fittingKind)) {
      if (besetzt(m)) continue;
      const d = Math.hypot(m.pos[0] - point.x, m.pos[1] - point.y, m.pos[2] - point.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /** Gegenrohre fuer das gewaehlte Rohr-Teil: Netz frei, Sack im 40er-Feld. */
  _railPartners(railId) {
    return this.fittingKind === "bag2"
      ? this.model.bagPartners(railId)
      : this.model.latticePartners(railId);   // Netz und Textil: gleiche Regel
  }

  /**
   * Lochzapfenkupplung: sie steckt mit ihrem Loch auf einem freien Stutzen
   * einer Kupplung -- also einen der gruenen Ankerpunkte anklicken. Ein Klick
   * auf eine schon gesetzte dreht sie um 90 Grad um ihre Lochachse weiter,
   * solange noch kein Rohr an ihren Armen haengt.
   */
  _clickHoleClamp(e) {
    const cs = geometry().connectorSize;
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.holeArm) {
      const m = h.data.holeArm;
      let gesetzt = null;
      this.recordHistory(() => {
        gesetzt = this.model.addHoleClamp(m.nodeId, m.dir, this.fittingKind, cs);
      });
      if (gesetzt) this._notePlaced(gesetzt.id, "node");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    if (pick && pick.data.kind === "node") {
      const n = this.model.nodes.get(pick.data.id);
      if (n && isHolePart(n.part)) {
        let gedreht = false;
        this.recordHistory(() => { gedreht = this.model.turnHoleClamp(n.id); });
        if (!gedreht) this.onNotice(t("notice_fitting_fixed"), "warn");
        this.refresh();
        return;
      }
    }
    this._pickFittingNode(pick);
  }

  /**
   * Flexikupplung: der BOLZEN kommt auf ein freies Rohrende und ersetzt dort
   * die Dummy-Kupplung, das SCHARNIER auf das mittlere Segment eines Bolzens
   * (hoechstens zwei). Ein Klick auf ein gesetztes Scharnier dreht es um 45
   * Grad um die Bolzenachse weiter -- die Stellung des zweiten Scharniers wird
   * dabei uebersprungen, und ein Arm mit Rohr bleibt stehen.
   */
  _clickFlexi(e) {
    const cs = geometry().connectorSize;
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.boltMount) {
      let gesetzt = null;
      this.recordHistory(() => { gesetzt = this.model.addBolt(h.data.boltMount.nodeId, cs); });
      if (gesetzt) this._notePlaced(gesetzt.id, "node");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    if (h && h.data && h.data.hingeMount) {
      let gesetzt = null;
      this.recordHistory(() => { gesetzt = this.model.addHinge(h.data.hingeMount.nodeId); });
      if (gesetzt) this._notePlaced(gesetzt.id, "node");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    // Getroffen wird das Scharnier selbst: sein Index steht am Treffer, sonst
    // wuesste man bei zwei Scharnieren nicht, welches gemeint ist.
    if (pick && pick.data.kind === "node" && pick.data.hinge != null) {
      const n = this.model.nodes.get(pick.data.id);
      if (n && isBoltPart(n.part)) {
        let gedreht = false;
        this.recordHistory(() => { gedreht = this.model.turnHinge(n.id, pick.data.hinge); });
        if (!gedreht) this.onNotice(t("notice_fitting_fixed"), "warn");
        this.refresh();
        return;
      }
    }
    // Klick auf den BOLZEN: er rutscht ein Segment tiefer ins Rohr und beim
    // naechsten Klick wieder heraus.
    if (pick && pick.data.kind === "node" && pick.data.hinge == null) {
      const n = this.model.nodes.get(pick.data.id);
      if (n && isBoltPart(n.part)) {
        let ok = false;
        this.recordHistory(() => { ok = this.model.turnBoltDepth(n.id); });
        if (ok) this.onNotice(t("notice_bolt_depth", boltDepth(n)));
        else this.onNotice(t("notice_bolt_has_tube"), "warn");
        this.refresh();
        return;
      }
    }
    this._pickFittingNode(pick);
  }

  /**
   * Klemm-Kupplung (Lochzapfen-, Lagerkupplung): auf ein beliebiges Rohr
   * klicken -- sie sitzt genau dort, mit dem offenen Anschluss zur Klickseite.
   * Ein Klick auf eine gesetzte Kupplung nimmt sie weg.
   */
  _clickTubeClamp(e) {
    const part = TUBE_CLAMP_PARTS[this.fittingKind];
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.bearingArm) {
      const m = h.data.bearingArm;
      let f = null;
      this.recordHistory(() => { f = this.model.addBearingAtArm(m.nodeId, m.dir, geometry().connectorSize); });
      if (f) this._notePlaced(m.nodeId, "node");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    if (h && h.data && h.data.clampTube) {
      const m = h.data.clampTube;
      let added = null;
      this.recordHistory(() => {
        added = this.model.addTubeClamp(m.tubeId, m.pos, part, geometry().connectorSize);
      });
      if (added) this._notePlaced(added.id, "node");
      else this.onNotice(t("notice_fitting_exists"), "warn");
      this.refresh();
      return;
    }
    const pick = this.scene.pickForDelete(e.clientX, e.clientY);
    if (!pick) { this._pickFittingNode(null); return; }
    if (pick.data.kind === "node") {
      const n = this.model.nodes.get(pick.data.id);
      // Lagerkupplung ohne Rohr: das MAUL dreht weiter, nicht das Teil um ein
      // Rohr -- damit laesst sich waehlen, wo das Rohr spaeter durchlaeuft.
      if (n && n.bearingOn && !n.clampOn) {
        let turned = false;
        this.recordHistory(() => { turned = this.model.turnBearingMouth(n.id); });
        if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
        this.refresh();
        return;
      }
      if (n && n.clampOn) {
        // Weiterdrehen statt loeschen: der Anschluss rueckt um 90 Grad um das
        // Rohr weiter, das Eingesteckte dreht mit.
        let turned = false;
        this.recordHistory(() => { turned = this.model.rotateTubeClamp(n.id, geometry().connectorSize); });
        if (!turned) this.onNotice(t("notice_fitting_fixed"), "warn");
        this.refresh();
        return;
      }
    }
    // Zweiter Weg fuer die Lagerkupplung: erst an eine Kupplung, das Rohr kommt
    // spaeter. Die Herstellersoftware kann beides -- ans Rohr, dann erscheint
    // aussen die Kupplung, oder an eine Kupplung, dann klemmt spaeter ein Rohr
    // darin. Gewaehlt wird der freie Arm, der dem Klickpunkt am naechsten liegt.
    if (part === "bearing" && pick.data.kind === "node" && pick.point) {
      const n = this.model.nodes.get(pick.data.id);
      if (n && !n.bearingOn && !n.part) {
        const dir = this._freeArmTowards(n, pick.point);
        if (!dir) { this.onNotice(t("notice_fitting_exists"), "warn"); return; }
        let f = null;
        this.recordHistory(() => { f = this.model.addBearingAtArm(n.id, dir, geometry().connectorSize); });
        if (f) this._notePlaced(n.id, "node");
        else this.onNotice(t("notice_fitting_exists"), "warn");
        this.refresh();
        return;
      }
    }
    if (pick.data.kind !== "tube" || !pick.point) { this.onNotice(t("notice_clamp_click_tube"), "info"); return; }
    const tb = this.model.tubes.get(pick.data.id);
    if (!tb || tb.arm || tb.link || tb.bow) { this.onNotice(t("notice_clamp_click_tube"), "info"); return; }
    let added = null;
    const hit = [pick.point.x, pick.point.y, pick.point.z];
    this.recordHistory(() => { added = this.model.addTubeClamp(pick.data.id, hit, part, geometry().connectorSize); });
    if (added) this._notePlaced(added.id, "node");
    else this.onNotice(t("notice_fitting_exists"), "warn");
    this.refresh();
  }

  /**
   * Freier Arm einer Kupplung, der dem Klickpunkt am naechsten liegt. Belegt
   * sind Richtungen, in denen schon ein Rohr steckt.
   */
  _freeArmTowards(node, point) {
    const belegt = [];
    for (const tb of this.model.tubes.values()) {
      const other = tb.a === node.id ? this.model.nodes.get(tb.b)
        : tb.b === node.id ? this.model.nodes.get(tb.a) : null;
      if (!other) continue;
      const d = [other.x - node.x, other.y - node.y, other.z - node.z];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      belegt.push([d[0] / L, d[1] / L, d[2] / L]);
    }
    const zeiger = [point.x - node.x, point.y - node.y, point.z - node.z];
    const Z = Math.hypot(zeiger[0], zeiger[1], zeiger[2]) || 1;
    const z = [zeiger[0] / Z, zeiger[1] / Z, zeiger[2] / Z];
    let best = null, bestDot = -2;
    for (const richtung of DIRECTIONS) {
      const d = richtung.vec;
      if (belegt.some((b) => b[0] * d[0] + b[1] * d[1] + b[2] * d[2] > 0.9)) continue;
      const dot = z[0] * d[0] + z[1] * d[1] + z[2] * d[2];
      if (dot > bestDot) { bestDot = dot; best = d; }
    }
    return best;
  }

  /**
   * 布面 / 网 / 袋：优先点绿色格子一下放下；也可以先点承重管再点对面管。
   * 点到接头上时，按接到这颗接头的承重管来算。
   */
  _clickLattice(e) {
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (h && h.data && h.data.railMount) {
      const m = h.data.railMount;
      this._placeRailFitting(m.a, m.b, m.t0, m.len);
      return;
    }
    const hit = this._pickRailFromEvent(e);
    if (!hit || !hit.id) {
      if (hit && hit.pick && hit.pick.data.kind === "fitting" && !this.panelRail) {
        const f = this.model.fittings.get(hit.pick.data.id);
        if (f && RAIL_FITTINGS.has(f.kind)) {
          this.onNotice(t("notice_fitting_fixed"), "warn");
          return;
        }
      }
      this._clearPanelRail();
      return;
    }
    const { id, point } = hit;

    if (this.panelRail) {
      if (id === this.panelRail.id) { this._clearPanelRail(); return; }
      const partner = this._railPartners(this.panelRail.id).find((c) => c.id === id);
      if (!partner) { this.onNotice(t("notice_panel_no_fit"), "warn"); return; }
      const sec = this.model.panelSection(partner, this.panelRail.at);
      this._placeRailFitting(this.panelRail.id, partner.id, sec.t0, sec.len);
      return;
    }
    const partners = this._railPartners(id);
    if (!partners.length) { this.onNotice(t("notice_textile_no_partner"), "warn"); return; }
    this.panelRail = { id, at: this._alongTube(id, point) };
    this.highlight = new Set([id, ...partners.map((c) => c.id)]);
    this.onNotice(t("notice_panel_pick_second", partners.length), "info");
    this.refresh();
  }

  _placeRailFitting(aId, bId, t0, len) {
    let added = null;
    this.recordHistory(() => {
      const wohin = this.fittingKind === "bag2" ? "addBag"
        : this.fittingKind === "textil2" ? "addTextile" : "addLattice";
      added = this.model[wohin](aId, bId, t0, len, this.colorFor("panel"));
      if (added && this.fittingKind === "textil2" && this.fittingPart) {
        const def = getPartById(this.fittingPart);
        if (def && def.variant) added.variant = def.variant;
      }
    });
    if (added) this._notePlaced(added.id, this.fittingKind === "textil2" ? "textile" : "fitting");
    else this.onNotice(t("notice_fitting_exists"), "warn");
    // Direkt auf die gruene Flaeche geklickt: kein Tragrohr gewaehlt, also raeumt
    // _clearPanelRail nichts auf und zeichnet auch nicht neu -- das Teil bliebe
    // bis zum naechsten Moduswechsel unsichtbar.
    this.panelRail = null;
    this.highlight = null;
    this.refresh();
  }

  /** 布件点选：管子，或接到这颗接头上的承重管。 */
  _pickRailFromEvent(e) {
    const pick = (this.panelRail && this.highlight
      && this.scene.pickAmong(e.clientX, e.clientY, this.highlight))
      || this.scene.pickForDelete(e.clientX, e.clientY);
    if (!pick) return null;
    if (pick.data.kind === "tube") {
      const tube = this.model.tubes.get(pick.data.id);
      if (!tube || tube.arm || tube.link || tube.bow) return { pick, id: null };
      return { id: pick.data.id, point: pick.point, pick };
    }
    if (pick.data.kind === "node") {
      const n = this.model.nodes.get(pick.data.id);
      if (!n) return { pick, id: null };
      const ids = this.model.incidentTubeIds(pick.data.id);
      const usable = ids.filter((id) => this._railUsable(id, true));
      if (!usable.length) return { pick, id: null };
      let id = usable[0];
      if (this.panelRail) {
        const hit = usable.find((u) => u === this.panelRail.id
          || this._railPartners(this.panelRail.id).some((c) => c.id === u));
        if (hit) id = hit;
      }
      return { id, point: { x: n.x, y: n.y, z: n.z }, pick };
    }
    return { pick, id: null };
  }

  _clickSlide(e) {
    // pickHandle liefert { object, data } -- die Nutzdaten stecken in h.data.
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    // Ausgang eines gesetzten Teils: das naechste Kettenglied kommt dorthin.
    if (h && h.data && h.data.slideChain) {
      let added = null;
      this.recordHistory(() => {
        added = this.model.addSlideAt(this.slideKind, h.data.slideChain, this.colorFor("slide"));
      });
      if (added) { if (!this._warnSlideConflicts(added)) this._notePlaced(added.id, "slide"); }
      else this.onNotice(t("notice_slide_exists"), "warn");
      this.refresh();
      return;
    }
    if (!h || !h.data || !h.data.slideMount) return;
    const m = h.data.slideMount;
    // Richtung aus der angeklickten SEITE des Feldes: die Rutsche faellt zu der
    // Seite ab, von der aus man draufschaut. Das Feld ist eine duenne Flaeche,
    // also entscheidet die Lage der Kamera bezueglich seiner Ebene -- so laesst
    // sich dieselbe Montagestelle wahlweise nach vorn oder nach hinten belegen.
    const n = m.normal.slice();
    const cam = this.scene.camera.position;
    if ((cam.x - m.hook[0]) * n[0] + (cam.z - m.hook[2]) * n[2] < 0) {
      n[0] = -n[0]; n[2] = -n[2];
    }
    let added = null;
    this.recordHistory(() => { added = this.model.addSlide(m.hook, n, this.slideKind, this.colorFor("slide")); });
    if (added) { if (!this._warnSlideConflicts(added)) this._notePlaced(added.id, "slide"); }
    else this.onNotice(t("notice_slide_exists"), "warn");
    this.refresh();
  }

  /**
   * Platten-Modus: erst ein Tragrohr anklicken, dann das Gegenrohr.
   *
   * Nach dem ersten Klick leuchtet das gewaehlte Rohr (amber) und alle Rohre,
   * die zusammen mit ihm die Platte tragen koennen (gruen); der Rest tritt
   * zurueck. Wo entlang die Platte sitzt, entscheidet die Stelle des ersten
   * Klicks. Ein Klick auf eine liegende Platte legt sie auf die andere Seite.
   */
  _clickPanel(e) {
    // Ist ein Tragrohr gewaehlt, zaehlen zuerst die hervorgehobenen Gegenrohre --
    // auch wenn ein anderes Teil davor liegt. Sie scheinen ohnehin durch die
    // zurueckgeblendeten Teile hindurch.
    const pick = (this.panelRail && this.highlight
      && this.scene.pickAmong(e.clientX, e.clientY, this.highlight))
      || this.scene.pickForDelete(e.clientX, e.clientY);
    if (!pick) { this._clearPanelRail(); return; }

    if (pick.data.kind === "panel" && !this.panelRail) {
      // Der Seitenwechsel wartet kurz: ein Doppelklick DREHT die Platte, und
      // der besteht aus zwei Klicks -- ohne diese Pause klappte sie dabei
      // zweimal um. `dblclick` raeumt den Auftrag weg (siehe _attach).
      const id = pick.data.id;
      clearTimeout(this._panelFlipTimer);
      this._panelFlipTimer = setTimeout(() => {
        this._panelFlipTimer = null;
        let side = null;
        this.recordHistory(() => { side = this.model.flipPanelSide(id); });
        if (side != null) this.onNotice(t(side < 0 ? "notice_panel_below" : "notice_panel_above"), "info");
        this.refresh();
      }, PANEL_DBLCLICK_MS);
      return;
    }
    if (pick.data.kind !== "tube") { this._clearPanelRail(); return; }
    const tube = this.model.tubes.get(pick.data.id);
    if (!tube || tube.arm || tube.link || tube.bow) { this._clearPanelRail(); return; }

    const dims = this._panelDims();
    if (!dims) return;

    // Zweiter Klick: passt das angeklickte Rohr als Gegenstueck?
    if (this.panelRail) {
      if (pick.data.id === this.panelRail.id) { this._clearPanelRail(); return; }
      const partner = this.model.panelPartners(this.panelRail.id, dims)
        .find((c) => c.id === pick.data.id);
      if (!partner) { this.onNotice(t("notice_panel_no_fit"), "warn"); return; }
      const sec = this.model.panelSection(partner, this.panelRail.at);
      this._placePanelOnRails(this.panelRail.id, partner.id, sec.t0, sec.len);
      return;
    }

    // Erster Klick: Rohr merken -- es selbst (amber) und die Gegenrohre (gruen)
    // leuchten, die uebrigen treten zurueck.
    const partners = this.model.panelPartners(pick.data.id, dims);
    if (!partners.length) { this.onNotice(t("notice_panel_no_partner"), "warn"); return; }
    this.panelRail = { id: pick.data.id, at: this._alongTube(pick.data.id, pick.point) };
    this.highlight = new Set([pick.data.id, ...partners.map((c) => c.id)]);
    this.onNotice(t("notice_panel_pick_second", partners.length), "info");
    this.refresh();
  }

  _placePanelOnRails(aId, bId, t0, len) {
    let added = null;
    this.recordHistory(() => {
      added = this.model.addPanel(aId, bId, t0, len, this.panelId, this.colorFor("panel"), 1);
      if (added) added.side = this._panelSideFromCorners(this.model.panelCorners(added));
    });
    this.onNotice(t(added ? "notice_panel_placed" : "notice_panel_exists"));
    this.panelRail = null;
    this.highlight = null;
    this.refresh();
    return added;
  }

  /** Masse der gewaehlten Platte. */
  _panelDims() {
    const def = getPanel(this.panelId);
    return def && def.w && def.h ? [def.w, def.h] : null;
  }

  /** Wo entlang des Rohrs liegt dieser Punkt (cm ab Rohranfang)? */
  _alongTube(tubeId, point) {
    const t = this.model.tubes.get(tubeId);
    const a = t && this.model.nodes.get(t.a), b = t && this.model.nodes.get(t.b);
    if (!a || !b || !point) return 0;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return ((point.x - a.x) * d[0] + (point.y - a.y) * d[1] + (point.z - a.z) * d[2]) / L;
  }

  _clearPanelRail() {
    if (!this.panelRail && !this.highlight) return;
    this.panelRail = null;
    this.highlight = null;
    this.refresh();
  }

  _clickAdd(e) {
    // 1. Handle?
    const h = this.scene.pickHandle(e.clientX, e.clientY);
    if (this.placeConnectorId) {
      const typeId = this.placeConnectorId;
      const apply = (node) => {
        if (!node || !this._nodeAcceptsConnector(node, typeId)) {
          this.onNotice(t("notice_connector_no_fit"), "warn");
          return;
        }
        let ok = false;
        this.recordHistory(() => { ok = this._applyConnectorType(node, typeId); });
        if (!ok) { this.onNotice(t("notice_connector_no_fit"), "warn"); return; }
        this.selectedNodeId = node.id;
        const def = getConnector(typeId);
        if (def) this.onNotice(t("notice_connector_apply", partName(def)));
        this.refresh();
      };
      if (h && h.data && (h.data.placeNode || h.data.nodeId)) {
        const n = this.model.nodes.get(h.data.nodeId);
        apply(n);
        return;
      }
      const hit = this.scene.pickBuild(e.clientX, e.clientY);
      if (hit && hit.data.kind === "node") {
        apply(this.model.nodes.get(hit.data.id));
        return;
      }
      return;
    }
    // Klick auf ein Bogenrohr dreht es um 90 Grad weiter -- wie das Umlegen
    // einer Platte. Ein Griff HINTER dem Bogen darf das nicht abfangen,
    // deshalb entscheidet die Entfernung.
    const front = this.scene.pickBuild(e.clientX, e.clientY);
    const bow = front && front.data.kind === "tube" ? this.model.tubes.get(front.data.id) : null;
    if (bow && bow.bow && (!h || front.distance < h.distance)) {
      // 另一头接着东西就不转：转了弯管会从那个接头上脱开。
      const pivot = this._bowPivotFor(bow);
      if (!pivot) { this.onNotice(t("notice_bow_attached"), "warn"); return; }
      let res;
      this.recordHistory(() => { res = this.model.rotateBow(bow.id, 1, { pivot }); });
      if (res && res.ground) this.onNotice(t("notice_ground"), "warn");
      else if (res && res.duplicate) this.onNotice(t("notice_bow_blocked"));
      this.refresh();
      return;
    }
    if (h) {
      if (h.data.clampOpening) { this._placeSecondTube(h.data.center, h.data.dir, h.data.bearingNode); return; }
      if (h.data.origin) {
        this.recordHistory(() => {
          // Erste Kupplung auf y = 0 -- genau wie in den Herstellerdateien, wo
          // die unterste Kupplung dort sitzt. Der Würfel reicht dann eine halbe
          // Kupplung nach unten und steht auf dem (2,5 cm tiefer gezeichneten)
          // Boden auf, statt darüber zu schweben.
          this.selectedNodeId = this.model.addNode(0, 0, 0).id;
        });
        this.refresh();
        return;
      }
      let res;
      if (h.data.slope) {
        // Schräg-Konnektor (schon 45-Grad gedreht): Diagonalrohr weiterbauen,
        // OHNE neuen C45-Adapter; snappt an vorhandene Schräg-Kupplungen.
        const dt = this._diagonalTube();
        this.recordHistory(() => {
          res = this.model.extendDiagonalSnap(
            h.data.nodeId, h.data.dir, dt.id, this.colorFor("tube", h.data.nodeId), dt.length_cm, spacingFor(dt.length_cm)
          );
        });
      } else {
        // Normales Rohr in Achsrichtung -- entweder kardinal/diagonal, oder
        // (bei rotierten Kupplungen aus QDF-Import) entlang einer Arm-Richtung;
        // model.extend() braucht das nicht zu unterscheiden.
        const tube = getTube(this.tubeId);
        this.recordHistory(() => {
          // 弧线手柄自带弯法；键盘步进和老式手柄还是按默认弯法来。
          res = isCurvedTube(this.tubeId)
            ? this.model.extendBow(h.data.nodeId, h.data.dir, h.data.bowNormal || this._bowNormal(h.data.dir), tube.id, this.colorFor("tube", h.data.nodeId), gridSpacing())
            : this.model.extend(
                h.data.nodeId, h.data.dir, tube.id, this.colorFor("tube", h.data.nodeId), tube.length_cm, spacingFor(tube.length_cm)
              );
        });
      }
      if (res && res.ground) this.onNotice(t("notice_ground"), "warn");
      else if (res && res.collision) this.onNotice(t("notice_collision"), "warn");
      else if (res && res.tube) {
        this._notePlaced(res.tube.id, "tube");
        this.selectedNodeId = null;
      }
      // 鼠标加管不锁到新端点：所有合法接头继续可加。键盘步进仍用 selectedNodeId。
      this.refresh();
      return;
    }
    // 点接头只作为键盘步进的锚，不收起其它位置的锚点。
    const pick = front;
    if (pick && pick.data.kind === "node" && this._isBuildable(pick.data.id)) {
      this.selectedNodeId = pick.data.id === this.selectedNodeId ? null : pick.data.id;
      this.refresh();
      return;
    }
    if (this.selectedNodeId) { this.selectedNodeId = null; this.refresh(); }
  }

  // Laesst sich an dieser Kupplung ueberhaupt weiterbauen?
  _isBuildable(nodeId) {
    return this.model.nodes.has(nodeId);
  }

  /**
   * Loesch-Modus: Klick auf ein Teil nimmt genau dieses heraus. Verstaerkungs-
   * profil und Scharnier gelten wie in der Auswahl -- ein Profil ist der ganze
   * Lauf, nicht nur das eine Rohr. Klick ins Leere tut nichts.
   */
  _clickDelete(e) {
    const pick = this._resolveDeletePick(this.scene.pickForDelete(e.clientX, e.clientY), e.clientX, e.clientY);
    if (!pick) return;
    this._fillSelectionFromPick(pick);
    this.deleteSelection();
  }

  /**
   * 删接头会带走相连的管子。接头常被管子或面板挡住，射线先打在它们上——
   * 落在接头范围内时仍按接头算，预览和点击才一致。
   */
  _resolveDeletePick(pick, clientX, clientY) {
    if (!pick) return pick;
    if (pick.data.kind === "node") return pick;
    const cs = geometry().connectorSize;
    if ((pick.data.kind === "panel" || pick.data.kind === "textile") && clientX != null) {
      const corners = this._surfaceCornerNodes(pick.data.id);
      const near = this.scene.closestOnRay(corners, clientX, clientY, cs * 0.75);
      if (near) return { ...pick, data: { kind: "node", id: near.id } };
    }
    if (!pick.point) return pick;
    const pt = pick.point;
    const ball = this._nodeNearPoint(pt, cs * 1.2);
    if (ball) return { ...pick, data: { kind: "node", id: ball.id } };
    if (pick.data.kind !== "tube") return pick;
    const t = this.model.tubes.get(pick.data.id);
    if (!t || t.arm || t.link) return pick;
    const a = this.model.nodes.get(t.a);
    const b = this.model.nodes.get(t.b);
    if (!a || !b) return pick;
    const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    const along = ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y) + (pt.z - a.z) * (b.z - a.z)) / span;
    const zone = cs * 1.55;
    let n = null;
    if (along <= zone && !a.c45body) n = a;
    else if (along >= span - zone && !b.c45body) n = b;
    return n ? { ...pick, data: { kind: "node", id: n.id } } : pick;
  }

  _surfaceCornerNodes(partId) {
    const part = this.model.panels.get(partId) || this.model.textiles.get(partId);
    if (!part) return [];
    const ids = new Set();
    if (part.nodes) for (const id of part.nodes) ids.add(id);
    for (const tid of [part.a, part.b]) {
      const t = this.model.tubes.get(tid);
      if (t) { ids.add(t.a); ids.add(t.b); }
    }
    const out = [];
    for (const id of ids) {
      const n = this.model.nodes.get(id);
      if (n && !n.c45body && !n.unused) out.push(n);
    }
    return out;
  }

  _nodeNearPoint(pt, reach) {
    let best = null, bestD = reach;
    for (const n of this.model.nodes.values()) {
      if (n.c45body || n.unused) continue;
      const d = Math.hypot(pt.x - n.x, pt.y - n.y, pt.z - n.z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** 删除模式下：指到接头时，把会一起删掉的管子也标出来。 */
  _deleteHoverExtras(pick) {
    if (this.mode !== "delete" || !pick || pick.data.kind !== "node") return null;
    if (pick.data.hinge != null) return null;
    const n = this.model.nodes.get(pick.data.id);
    if (!n || n.c45body) return null;
    const ids = this.model.incidentTubeIds(pick.data.id);
    return ids.length ? ids : null;
  }

  /** Setzt die Auswahl auf genau das getroffene Teil (ohne refresh). */
  _fillSelectionFromPick(pick) {
    this.selection.clear();
    const { kind, id } = pick.data;
    if (kind === "node" && pick.data.hinge != null) {
      this.selection.set(hingeKey(id, pick.data.hinge), "hinge");
      this._profilAuswahl = null;
      return;
    }
    const ids = Array.isArray(pick.data.tubes) && pick.data.tubes.length
      ? pick.data.tubes : [id];
    this._profilAuswahl = Array.isArray(pick.data.tubes) ? new Set(ids) : null;
    for (const x of ids) this.selection.set(x, kind);
  }

  // Cursor-Modus: bereits platzierte Teile auswaehlen. Einfacher Klick waehlt
  // genau eines, Strg/Shift-Klick nimmt dazu bzw. wieder heraus, Klick ins
  // Leere hebt die Auswahl auf. Es werden KEINE Ankerpunkte gebaut.
  /** 选中里有组员的，整组都进选中：夹子、滑梯那几条路各自选完再统一扩。 */
  _expandSelectionGroups() {
    if (!this.model.groups.size) return;
    const gids = new Set();
    for (const id of this.selection.keys()) {
      const g = this.model.groupOf(id);
      if (g) gids.add(g);
    }
    for (const g of gids) {
      for (const m of this.model.groups.get(g)) if (!this.selection.has(m)) this.selection.set(m, this._kindOf(m));
    }
  }

  _clickSelect(e) {
    this._clickSelectRaw(e);
    this._expandSelectionGroups();
    this.refresh();
  }

  _clickSelectRaw(e) {
    const pick = this._pickSelect(e.clientX, e.clientY);
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!pick) {
      this._selectClick = null;
      if (!add) this.clearSelection();
      return;
    }
    const { kind, id } = pick.data;
    if (kind === "clamp") {
      if (this._isBlockClick(e, id)) {
        this._selectConnectedFromPick(pick, add);
        return;
      }
      this._selectClampCohort(id, add);
      return;
    }
    const slideOwner = this._slideDriverForPick(pick);
    if (slideOwner && (kind === "tube" || kind === "panel" || kind === "textile")) {
      if (this._isBlockClick(e, id)) {
        this._selectConnectedFromPick(pick, add);
        return;
      }
      this._selectClampCohort(slideOwner, add);
      return;
    }
    // Ein Scharnier der Flexikupplung ist ein eigenes Teil, obwohl es am
    // Bolzen-Knoten haengt: es waehlt sich unter seiner eigenen Kennung.
    if (kind === "node" && pick.data.hinge != null) {
      const key = hingeKey(id, pick.data.hinge);
      if (this._isBlockClick(e, key)) {
        this._selectConnectedFromPick(pick, add);
        return;
      }
      if (add) {
        if (this.selection.has(key)) this.selection.delete(key);
        else this.selection.set(key, "hinge");
      } else if (this.selection.size === 1 && this.selection.has(key)) {
        this.selection.clear();
      } else {
        this.selection.clear();
        this.selection.set(key, "hinge");
      }
      this._profilAuswahl = null;
      this.refresh();
      return;
    }
    // Klick auf ein Verstaerkungsprofil: es gehoert zum ganzen Lauf, also
    // kommen alle seine Rohre in die Auswahl -- ein 80er Profil steckt in zwei
    // 35ern, da waere ein einzelnes Rohr nur die halbe Wahrheit.
    const ids = Array.isArray(pick.data.tubes) && pick.data.tubes.length
      ? pick.data.tubes : [id];
    if (this._isBlockClick(e, ids[0])) {
      this._selectConnectedFromPick(pick, add);
      return;
    }
    // Kam der Klick vom Profil, merken wir uns genau diese Rohre. Stimmt die
    // Auswahl spaeter nicht mehr damit ueberein, gilt der Vermerk nicht mehr --
    // so muss ihn niemand aufraeumen.
    this._profilAuswahl = Array.isArray(pick.data.tubes) ? new Set(ids) : null;
    // 组里的零件一起选
    const kinds = new Map(ids.map((x) => [x, kind]));
    const gid = this.model.groupOf(ids[0]);
    if (gid) for (const m of this.model.groups.get(gid)) if (!kinds.has(m)) kinds.set(m, this._kindOf(m));
    const alle = [...kinds.keys()];
    const schonDrin = alle.every((x) => this.selection.has(x));
    if (add) {
      if (schonDrin) for (const x of alle) this.selection.delete(x);
      else for (const [x, k] of kinds) this.selection.set(x, k);
    } else if (this.selection.size === alle.length && schonDrin) {
      this.selection.clear();
    } else {
      this.selection.clear();
      for (const [x, k] of kinds) this.selection.set(x, k);
    }
    this.refresh();
  }
}
