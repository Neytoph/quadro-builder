// Aufbauplan: zerlegt das Modell Lage fuer Lage in nachvollziehbare Bauschritte.
// Bewusst ohne Three.js/DOM, damit es testbar und Backend-tauglich bleibt.
//
// Logik: Man baut von unten nach oben. Pro Hoehen-Ebene entsteht zuerst der
// waagerechte Rahmen (Kupplungen + Rohre + Platten), danach die senkrechten
// Stuetzen zur naechsten Ebene. Die Kupplungstypen werden aus dem FERTIGEN
// Modell abgeleitet (man greift beim Bau die endgueltige Kupplung).

import { inferConnectorType, connectorsForNode } from "./bom.js";
import { getTube, getConnector, getPanel, colorName, partName, reinforcementPart } from "./catalog.js";
import { getLang, t } from "./i18n.js";

const Y_EPS = 0.6; // cm: Knoten innerhalb dieser Hoehe gelten als gleiche Ebene

// Kurzes, gut lesbares Label fuer die 3D-Beschriftung am Knoten.
const SHORT_LABEL_DE = {
  end: "Ende", straight: "Gerade", elbow: "Winkel",
  t: "T", cross: "Kreuz",
  "3way": "3-Wege", "4way": "4-Wege", "5way": "5-Wege", "6way": "6-Wege",
  diagonal: "45°",
};
const SHORT_LABEL_EN = {
  end: "End", straight: "Straight", elbow: "Elbow",
  t: "T", cross: "Cross",
  "3way": "3-way", "4way": "4-way", "5way": "5-way", "6way": "6-way",
  diagonal: "45°",
};
const SHORT_LABEL_ZH = {
  end: "端", straight: "直通", elbow: "弯头",
  t: "T", cross: "十字",
  "3way": "3通", "4way": "4通", "5way": "5通", "6way": "6通",
  diagonal: "45°",
};
function shortLabel(type) {
  const lang = getLang();
  const map = lang === "zh" ? SHORT_LABEL_ZH : lang === "en" ? SHORT_LABEL_EN : SHORT_LABEL_DE;
  return map[type] || type;
}

// Kategorien fuer die farbliche Hervorhebung der Beschriftung im Aufbaumodus.
const FLAECHE_TYPES = new Set(["t", "cross"]);   // planare Flaechenkupplungen
const RAUM_TYPES = new Set(["3way", "4way", "5way", "6way"]); // raeumliche Kupplungen

// Beschriftungstext fuer einen Knoten: Kurzname + Katalog-Code (z. B. "3-Wege CS3").
export function connectorLabel(model, node) {
  const info = connectorLabelInfo(model, node);
  return info ? info.text : null;
}

// Wie connectorLabel, liefert zusaetzlich die Kategorie ("flaeche" | "raum" | null)
// fuer die farbliche Hervorhebung.
export function connectorLabelInfo(model, node) {
  const type = inferConnectorType(model, node);
  if (!type) return null;
  const def = getConnector(type);
  const short = shortLabel(type);
  const text = def && def.code ? `${short} ${def.code}` : short;
  let category = null;
  if (FLAECHE_TYPES.has(type)) category = "flaeche";
  else if (RAUM_TYPES.has(type)) category = "raum";
  return { text, type, category };
}

// Aufbaurichtungen: Achse + Vorzeichen. "y+" = von unten nach oben (Standard),
// "x+" = von links nach rechts, "x-" = von rechts nach links, "z+"/"z-" analog
// fuer vorne/hinten. Je nach Modell und Platz im Raum ist eine andere Reihenfolge
// praktischer -- gebaut wird immer Scheibe fuer Scheibe entlang dieser Achse.
export const BUILD_ORDERS = ["y+", "x+", "x-", "z+", "z-"];

// Liefert die Koordinatenfunktion fuer eine Aufbaurichtung: der Wert waechst
// immer in Baureihenfolge, damit die uebrige Logik unveraendert bleibt.
export function orderCoord(order) {
  const axis = (order || "y+")[0];
  const sign = (order || "y+")[1] === "-" ? -1 : 1;
  return (o) => (o ? o[axis] * sign : 0);
}

// Sortierte, eindeutige Ebenen (cm) des Modells in Aufbaureihenfolge.
export function levelsOf(model, order = "y+") {
  const coord = orderCoord(order);
  const ys = [...model.nodes.values()].map((n) => coord(n)).sort((a, b) => a - b);
  const levels = [];
  for (const y of ys) {
    if (levels.length === 0 || Math.abs(y - levels[levels.length - 1]) > Y_EPS) {
      levels.push(y);
    }
  }
  return levels;
}

function levelIndex(levels, y) {
  for (let i = 0; i < levels.length; i++) {
    if (Math.abs(y - levels[i]) <= Y_EPS) return i;
  }
  // Zwischenwert (z. B. der Einhaengepunkt einer Rutsche, der bewusst etwas
  // ueber der Kupplung sitzt): die NAECHSTGELEGENE Ebene nehmen. Frueher fiel
  // das auf die letzte Ebene zurueck -- solche Teile rutschten dadurch ans
  // Ende des Bauplans.
  let best = 0, bestD = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(y - levels[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// --- Zaehl-Helfer -------------------------------------------------------
function countConnectors(model, nodes) {
  const map = new Map(); // type -> count
  let openEnds = 0;
  for (const n of nodes) {
    const types = connectorsForNode(model, n);
    if (types.length === 0) {
      if (model.degree(n.id) >= 1) openEnds++;
      continue;
    }
    for (const type of types) map.set(type, (map.get(type) || 0) + 1);
  }
  const rows = [...map.entries()].map(([type, count]) => {
    const def = getConnector(type) || { name: type, code: "", price: 0 };
    return { type, code: def.code, name: partName(def), count,
             label: shortLabel(type), price: def.price || 0 };
  }).sort((a, b) => b.count - a.count);
  return { rows, openEnds };
}

function countTubes(tubes) {
  const map = new Map(); // tubeId|color -> {tubeId,color,count}
  for (const t of tubes) {
    // Die Huelse einer 45-Grad-Winkelkupplung (arm) und die Verbindung im
    // Doppelrohrverbinder (link) sind KEINE Rohre -- sie tragen keine
    // Rohrkennung und standen sonst als Zeile "null" in der Liste. Gezeichnet
    // werden sie weiter mit ihrem Schritt (sie bleiben in `tubeIds`).
    if (t.arm || t.link) continue;
    const key = t.tubeId + "|" + t.color;
    if (!map.has(key)) map.set(key, { tubeId: t.tubeId, color: t.color, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].map((r) => {
    const def = getTube(r.tubeId) || { name: r.tubeId, length_cm: null, price: 0 };
    return { tubeId: r.tubeId, color: r.color, name: partName(def),
             colorName: colorName(r.color), length: def.length_cm,
             count: r.count, price: def.price || 0 };
  }).sort((a, b) => (a.length || 0) - (b.length || 0));
}

function countPanels(panels) {
  const map = new Map(); // panelId|color -> {panelId,color,count}
  for (const p of panels) {
    const key = p.panelId + "|" + p.color;
    if (!map.has(key)) map.set(key, { panelId: p.panelId, color: p.color, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].map((r) => {
    const def = getPanel(r.panelId) || { name: r.panelId, price: 0 };
    return { panelId: r.panelId, color: r.color, name: partName(def),
             colorName: colorName(r.color), count: r.count, price: def.price || 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Holz-Profile eines Schritts. Gekauft wird nur die 80-cm-Laenge; sie deckt
// 80 cm Knotenabstand (ein 75er-Rohr oder zwei 35er in einer Linie). Gezaehlt
// wird deshalb die verstaerkte Strecke des Schritts, nicht die Zahl der Rohre.
function countReinforcements(model, tubes) {
  const part = reinforcementPart();
  if (!part) return [];
  let strecke = 0;
  for (const t of tubes) {
    if (!t.reinforced) continue;
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) continue;
    strecke += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  if (strecke <= 0) return [];
  const count = Math.max(1, Math.round(strecke / (part.length_cm || 80)));
  return [{ id: part.id, name: partName(part), count, price: part.price || 0 }];
}

// So nah muss ein Rutschenteil am Ausgang des Teils darueber liegen, damit es
// als dessen Fortsetzung gilt. Die Herstellerdateien treffen den Punkt genau;
// die Toleranz faengt nur Rundungsreste ab.
const SLIDE_CHAIN_TOL = 12;

/**
 * Rutschen zu Ketten buendeln. Eine Kette ist ein Einstieg samt allem, was
 * darunter haengt (Koerper, Bogen, Auslauf) -- sie wird in EINEM Schritt
 * eingebaut, naemlich dort, wo ihr oberes Ende Halt findet.
 * Liefert [{ head, parts }] -- `head` ist das oberste Teil.
 */
function slideChainHeads(model) {
  const slides = [...(model.slides ? model.slides.values() : [])];
  if (!slides.length) return [];
  // Wer haengt an wem? Der Ausgang eines Teils zeigt auf die Stelle, an der das
  // naechste sitzt (model.slideExit kennt die Versaetze je Art).
  const next = new Map();      // id -> Folgeteil
  const hasParent = new Set(); // ids, die an einem anderen Teil haengen
  for (const sl of slides) {
    const exit = model.slideExit ? model.slideExit(sl) : null;
    if (!exit) continue;
    let best = null, bestD = Infinity;
    for (const other of slides) {
      if (other === sl) continue;
      const d = Math.hypot(other.x - exit.pos[0], other.y - exit.pos[1], other.z - exit.pos[2]);
      if (d < bestD) { bestD = d; best = other; }
    }
    if (best && bestD <= SLIDE_CHAIN_TOL && !hasParent.has(best.id)) {
      next.set(sl.id, best);
      hasParent.add(best.id);
    }
  }
  const out = [];
  for (const sl of slides) {
    if (hasParent.has(sl.id)) continue;    // haengt an einem Teil weiter oben
    const parts = [];
    const seen = new Set();
    for (let cur = sl; cur && !seen.has(cur.id); cur = next.get(cur.id)) {
      seen.add(cur.id);
      parts.push(cur);
    }
    out.push({ head: sl, parts });
  }
  return out;
}

// Erzeugt den Aufbauplan: ein Array von Schritten.
// Jeder Schritt: { kind, title, level, y, connectors, openEnds, tubes, panels,
//                  nodeIds, tubeIds, panelIds }
export function computeBuildPlan(model, order = "y+") {
  const coord = orderCoord(order);
  const levels = levelsOf(model, order);
  const steps = [];
  if (levels.length === 0) return { levels, steps };

  // Knoten je Ebene
  const nodeLevel = new Map(); // nodeId -> levelIndex
  const nodesByLevel = levels.map(() => []);
  for (const n of model.nodes.values()) {
    const li = levelIndex(levels, coord(n));
    nodeLevel.set(n.id, li);
    nodesByLevel[li].push(n);
  }

  // Rohre einordnen: waagerecht (gleiche Ebene) vs. Stuetze (Ebene -> hoeher)
  const horizByLevel = levels.map(() => []);
  const risersByLevel = levels.map(() => []); // von der UNTEREN Ebene aus
  // Huelse der 45-Grad-Winkelkupplung (arm) und Verbindung im Doppelrohr-
  // verbinder (link): KEINE Rohre, sondern Teil der Kupplung. Sie zaehlen in
  // keiner Liste, sollen aber mit ihrem Schritt gezeichnet werden -- also
  // gehoeren sie zu dem Schritt, in dem ihr oberer Knoten entsteht. Als
  // "Stuetze" gefuehrt ergaeben sie einen Schritt ganz ohne Teile.
  const armsByLevel = levels.map(() => []);
  for (const t of model.tubes.values()) {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) continue;
    const la = nodeLevel.get(a.id), lb = nodeLevel.get(b.id);
    if (t.arm || t.link) armsByLevel[Math.max(la, lb)].push(t);
    else if (la === lb) horizByLevel[la].push(t);
    else risersByLevel[Math.min(la, lb)].push(t);
  }

  // Platten: dem Schritt der hoechsten beteiligten Ebene zuordnen
  // Platten haengen an zwei Rohren -- die Ebene ergibt sich aus deren Knoten.
  const railNodeIds = (p) => {
    const out = [];
    for (const tid of [p.a, p.b]) {
      const t = model.tubes.get(tid);
      if (t) out.push(t.a, t.b);
    }
    return out;
  };
  const panelsByLevel = levels.map(() => []);
  for (const p of model.panels.values()) {
    let maxLi = 0;
    for (const id of railNodeIds(p)) maxLi = Math.max(maxLi, nodeLevel.get(id) ?? 0);
    panelsByLevel[maxLi].push(p);
  }

  // Netze/Stoffe wie Platten (hoechste beteiligte Ebene); Rutschen/Daecher nach Hoehe.
  const textilesByLevel = levels.map(() => []);
  for (const tx of (model.textiles ? model.textiles.values() : [])) {
    let maxLi = 0;
    for (const id of railNodeIds(tx)) maxLi = Math.max(maxLi, nodeLevel.get(id) ?? 0);
    textilesByLevel[maxLi].push(tx);
  }
  // Anbauteile haengen an einem Punkt -- sie kommen in die Ebene, auf der sie
  // sitzen.
  const fittingsByLevel = levels.map(() => []);
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    // Das offene Verbinderende ist kein Bauteil, sondern ein Vermerk an der
    // Kupplung -- im Aufbau gibt es dafuer nichts zu tun.
    if (f.kind === "open-connector2") continue;
    fittingsByLevel[levelIndex(levels, coord(f))].push(f);
  }
  // Rutschen kommen dorthin, wo ihr EINSTIEG gebaut wird -- und eine Kette
  // gehoert zusammen: Koerper und Auslauf werden in einem Zug eingehaengt, der
  // Auslauf haengt ja am Teil ueber ihm. Frueher zaehlte jedes Teil fuer sich,
  // der Auslauf landete dadurch zwei Ebenen frueher als sein Koerper.
  const slidesByLevel = levels.map(() => []);
  for (const chain of slideChainHeads(model)) {
    // Wo die Kette oben haengt, weiss das Modell (model.slideEntry): der
    // Einhaengepunkt am Rohrpaar, der Bezugspunkt eines Kettenteils oder --
    // bei der Integralrutsche aus einer Datei -- ihr zurueckgerechneter
    // Einstieg; deren Punkt steht dort naemlich am Fuss.
    const anchor = model.slideEntry ? model.slideEntry(chain.head) : chain.head;
    slidesByLevel[levelIndex(levels, coord(anchor || chain.head))].push(...chain.parts);
  }

  // Fortschritt in Baurichtung: Abstand zur ersten Ebene. `levels` waechst
  // dank orderCoord() immer in Baureihenfolge, auch bei x-/z-.
  const progressAt = (i) => (levels[i] ?? levels[levels.length - 1]) - levels[0];
  // Im Titel steht, wie weit man NACH dem Schritt ist: der Rahmen nennt also
  // schon die Hoehe der naechsten Ebene, die Stuetzen die Hoehe, die sie
  // erreichen. Beim letzten Schritt bleibt es bei der eigenen Ebene.
  const reachedAfter = (i) => round1(progressAt(i + 1));

  for (let i = 0; i < levels.length; i++) {
    const nodes = nodesByLevel[i];
    const horiz = horizByLevel[i];
    const pans = panelsByLevel[i];
    const txs = textilesByLevel[i];
    const sls = slidesByLevel[i];
    const fts = fittingsByLevel[i];

    // Rahmen-Schritt (nur, wenn er etwas Neues bringt)
    if (nodes.length || horiz.length || pans.length || txs.length || sls.length || fts.length) {
      const conn = countConnectors(model, nodes);
      const title = t("buildplan_level", i + 1, reachedAfter(i));
      steps.push({
        kind: "frame", title, level: i, y: levels[i],
        connectors: conn.rows, openEnds: conn.openEnds,
        tubes: countTubes(horiz), panels: countPanels(pans),
        reinforcements: countReinforcements(model, horiz),
        nodeIds: nodes.map((n) => n.id),
        // Die Huelsen kommen mit ihrer Kupplung ins Bild, tauchen aber in
        // keiner Liste auf (siehe armsByLevel).
        tubeIds: [...horiz, ...armsByLevel[i]].map((t) => t.id),
        panelIds: pans.map((p) => p.id),
        textileIds: txs.map((tx) => tx.id),
        slideIds: sls.map((sl) => sl.id),
        fittingIds: fts.map((f) => f.id),
      });
    }

    // Stuetzen-Schritt zur naechsten Ebene
    const risers = risersByLevel[i];
    if (risers.length) {
      steps.push({
        kind: "risers",
        // Die Stuetzen fuehren zur naechsten Ebene -- der Titel nennt sie,
        // damit die Schritte in Baurichtung durchzaehlen.
        title: t("buildplan_level", i + 2, reachedAfter(i)),
        level: i, y: levels[i],
        connectors: [], openEnds: 0,
        tubes: countTubes(risers), panels: [],
        reinforcements: countReinforcements(model, risers),
        nodeIds: [],
        tubeIds: risers.map((t) => t.id),
        panelIds: [],
        textileIds: [],
        slideIds: [],
        fittingIds: [],
      });
    }
  }

  return { levels, steps };
}
