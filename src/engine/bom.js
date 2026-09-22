// Stueckliste (BOM) + Kupplungstyp-Heuristik + Bestands-/Machbarkeitscheck.

import { getTube, getConnector, getPanel, colorName, partName, reinforcementPart, partForFitting, getPartById, getScrew, poolLinerFor, geometry, slideKindName } from "./catalog.js";
import { round2, xAxisOf, yAxisOf, zAxisOf } from "./util.js";
import { POOL_KINDS, isHolePart, isBoltPart, BOLT_PART, HINGE_PART, ARM_FITTINGS } from "./model.js";

// Einheitsvektoren der Nachbarn eines Knotens. Doppelrohr-Verbindungen (link)
// sind KEIN Arm der Kupplung und zaehlen nicht in die Kupplungstyp-Heuristik
// (sonst werden offene Rohrenden faelschlich als 2-armige Kupplung gezaehlt).
// Der C45-Adapter-Arm (arm) bleibt dagegen drin -- er gehoert zur Klassifizierung
// des Adapter-Koerpers (c45body).
// Anbauteile, die einen ARM der Kupplung belegen -- sie stecken auf einem
// Stutzen, genau wie ein Rohr, und gehoeren deshalb in die Armzahl. Die
// ARM_FITTINGS (aus model.js): Teile, die einen Stutzen belegen und ihn damit
// mitkaufen. Die Laufrolle sitzt auf ihrem Adapter und zaehlt nicht doppelt.
// Das offene Verbinderende ist genau dafuer da: es erzwingt den Stutzen, den
// ein freier Arm sonst weder bekommt noch kostet.

// Naechste Achsenrichtung zu einem Vektor.
function cardinalOf(dx, dy, dz) {
  const m = [Math.abs(dx), Math.abs(dy), Math.abs(dz)];
  const ax = m.indexOf(Math.max(m[0], m[1], m[2]));
  const d = [0, 0, 0];
  d[ax] = Math.sign([dx, dy, dz][ax]) || 1;
  return d;
}

function neighborDirs(model, node) {
  const dirs = [];
  for (const t of model.tubes.values()) {
    if (t.link) continue;
    let nb = null;
    if (t.a === node.id) nb = model.nodes.get(t.b);
    else if (t.b === node.id) nb = model.nodes.get(t.a);
    if (!nb) continue;
    const dx = nb.x - node.x, dy = nb.y - node.y, dz = nb.z - node.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Die Huelse der Winkelkupplung steckt auf einem Stutzen; ihr Koerper sitzt
    // zusaetzlich um den 45-Grad-Arm versetzt, die Kante dorthin laeuft deshalb
    // ~17 Grad schief. Ungerundet gaelte die Basiskupplung als Raumkupplung
    // statt als flache. Die genaue Richtung steht am Adapter-Koerper
    // (`c45axis`) -- nur ohne sie wird auf die naechste Achse gerundet, sonst
    // zoege eine diagonale Huelse (Winkelkupplung im Rohr) auf eine Weltachse.
    if (t.arm) {
      const achse = nb.c45body && nb.c45axis ? nb.c45axis
        : (node.c45body && node.c45axis ? node.c45axis.map((v) => -v) : null);
      dirs.push(achse ? achse.slice() : cardinalOf(dx, dy, dz));
    } else {
      dirs.push([dx / len, dy / len, dz / len]);
    }
  }
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    if (!ARM_FITTINGS.has(f.kind) || !f.quat) continue;
    if (Math.hypot(f.x - node.x, f.y - node.y, f.z - node.z) > 2) continue;
    const d = xAxisOf(f.quat);
    if (!dirs.some((e) => e[0] * d[0] + e[1] * d[1] + e[2] * d[2] > 0.9)) dirs.push(d);
  }
  // Eine Kupplung, die von einer Lagerkupplung getragen wird, steckt mit einem
  // Arm in deren Maul -- der ist belegt, obwohl dort kein Rohr sitzt. `stub`
  // zeigt vom Rohr weg, der Arm also entgegengesetzt.
  if (node.bearingOn && node.stub) {
    const d = [-node.stub[0], -node.stub[1], -node.stub[2]];
    if (!dirs.some((e) => e[0] * d[0] + e[1] * d[1] + e[2] * d[2] > 0.9)) dirs.push(d);
  }
  // Die Lochzapfenkupplung steckt mit ihrem Zapfen in einem Arm der Kupplung --
  // der ist damit belegt, obwohl dort kein Rohr sitzt. Ohne ihn zaehlte eine
  // T-Kupplung des Ball Cage nur zwei Arme.
  const cs = geometry().connectorSize;
  for (const h of model.nodes.values()) {
    // Dasselbe gilt fuer einen Flexikupplungs-Bolzen, der auf einem Stutzen
    // steckt statt am Rohrende (mittlere Gelenke des Ball Cage).
    if ((!isHolePart(h.part) && !isBoltPart(h.part)) || h.id === node.id) continue;
    const dx = h.x - node.x, dy = h.y - node.y, dz = h.z - node.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5 || len > cs * 1.2) continue;
    const d = [dx / len, dy / len, dz / len];
    if (!dirs.some((e) => e[0] * d[0] + e[1] * d[1] + e[2] * d[2] > 0.9)) dirs.push(d);
  }
  return dirs;
}

/**
 * Richtungen ins Achsenkreuz DER KUPPLUNG drehen.
 *
 * `isC45Dir` und `isAxisDir` messen gegen die Weltachsen -- an einer gedrehten
 * Kupplung (aus einer Datei oder an einer Winkelkupplung) laeuft ein Rohr aber
 * entlang eines ihrer EIGENEN Arme, auch wenn es in der Welt schraeg steht.
 * Ungedreht zaehlte die Heuristik dort lauter 45-Grad-Schraegen und legte je
 * eine Winkelkupplung dazu. Ohne gespeicherte Lage bleibt es bei den
 * Weltachsen.
 */
function localDirs(model, node, dirs) {
  const achsen = frameOf(model, node);
  if (!achsen) return dirs;
  const [ex, ey, ez] = achsen;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return dirs.map((d) => [dot(d, ex), dot(d, ey), dot(d, ez)]);
}

/**
 * Achsenkreuz einer Kupplung, oder null fuer die Weltachsen.
 *
 * Erste Wahl ist die gespeicherte Lage (`quat`). Eine im Editor gebaute
 * Schraeg-Kupplung hat keine: ihre Drehung steckt allein darin, dass ein
 * 45-Grad-Rohr an ihr haengt. Genommen wird sie nur, wenn danach JEDES Rohr des
 * Knotens auf einer Wuerfelachse liegt -- sonst gehoert die Schraege einer
 * Winkelkupplung und der Wuerfel steht kardinal (siehe `_slopeRotationAxis` in
 * scene.js, dieselbe Regel).
 */
function frameOf(model, node) {
  if (node.quat && node.quat.length === 4) {
    return [xAxisOf(node.quat), yAxisOf(node.quat), zAxisOf(node.quat)];
  }
  const rohre = [];
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue;
    const o = t.a === node.id ? model.nodes.get(t.b) : t.b === node.id ? model.nodes.get(t.a) : null;
    if (!o) continue;
    const v = [o.x - node.x, o.y - node.y, o.z - node.z];
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    rohre.push([v[0] / L, v[1] / L, v[2] / L]);
  }
  let k = -1;
  for (const u of rohre) {
    if (Math.max(Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])) >= 0.99) continue;
    const act = [0, 1, 2].filter((a) => Math.abs(u[a]) > 0.3);
    if (act.length !== 2) continue;
    k = [0, 1, 2].find((a) => !act.includes(a));
    break;
  }
  if (k < 0) return null;
  const [i, j] = [0, 1, 2].filter((a) => a !== k);
  const S = Math.SQRT1_2;
  const e = (a, b, va, vb) => { const v = [0, 0, 0]; v[a] = va; v[b] = vb; return v; };
  const ex = e(i, j, S, S), ey = e(i, j, -S, S), ez = e(k, k, 1, 1);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const passt = rohre.every((u) => {
    const l = [dot(u, ex), dot(u, ey), dot(u, ez)];
    return Math.max(Math.abs(l[0]), Math.abs(l[1]), Math.abs(l[2])) >= 0.99;
  });
  return passt ? [ex, ey, ez] : null;
}

/**
 * Liegen alle Richtungen in EINER Ebene? Geprueft wird die Ebene selbst, nicht
 * nur die drei Achsenebenen: ein gedrehter Aufbau (Ball Cage: 45 Grad um X)
 * spannt seine Ebene schraeg auf, seine T-Kupplungen sind aber genauso flach
 * wie die achsenparallelen.
 */
function isCoplanar(dirs) {
  // Normale aus dem ersten Paar, das nicht (anti-)parallel liegt.
  let n = null;
  for (let i = 0; i < dirs.length && !n; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const a = dirs[i], b = dirs[j];
      const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const len = Math.hypot(c[0], c[1], c[2]);
      if (len > 0.1) { n = [c[0] / len, c[1] / len, c[2] / len]; break; }
    }
  }
  if (!n) return true;   // alle auf einer Geraden -- das ist erst recht flach
  return dirs.every((d) => Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) < 0.1);
}

// Ist die (normierte) Richtung eine ECHTE 45-Grad-Schraege, die eine
// Winkelkupplung (C45) braucht? Kennzeichen: zwei betragsgleiche Komponenten
// (je ~0,707) und die dritte ~0 (also exakt 45 Grad in einer Achsenebene).
// Flache Rampen (z. B. Doppelrohr-Rampe 19,47 Grad = Richtung 0,94/0,33/0) oder
// steile Sparren erfuellen das NICHT und werden daher nicht als C45 gezaehlt.
function isC45Dir(d) {
  const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].sort((x, y) => y - x);
  return a[1] > 0.5 && a[0] - a[1] < 0.2 && a[2] < 0.2;
}

// Geometrische Klassifikation rein achsenparalleler Arme nach Anzahl + Lage.
function connectorTypeForDirs(dirs) {
  const deg = dirs.length;
  if (deg === 0) return null;
  if (deg === 1) return "end";
  const planar = isCoplanar(dirs);
  if (deg === 2) {
    // gegenueberliegend => gerade; sonst Winkel
    const dot = dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] + dirs[0][2] * dirs[1][2];
    return dot < -0.95 ? "straight" : "elbow";
  }
  if (deg === 3) return planar ? "t" : "3way";
  if (deg === 4) return planar ? "cross" : "4way";
  if (deg === 5) return "5way";
  return "6way";
}

// Zeigt die (normierte) Richtung genau eine Achse entlang? Echte Kupplungen
// haben ihre Stutzen nur auf den sechs Wuerfelflaechen.
function isAxisDir(d) {
  const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].sort((x, y) => y - x);
  return a[0] > 0.95 && a[1] < 0.1;
}

// Laesst sich ein Knoten mit diesen Arm-Richtungen aus dem echten Sortiment
// bauen? Liefert null wenn ja, sonst einen Grund.
function armsFeasible(dirs) {
  if (dirs.length <= 1) return null;   // freies Rohrende braucht keine Kupplung
  const axis = [], other = [];
  for (const d of dirs) (isAxisDir(d) ? axis : other).push(d);
  // Schraegen laufen ueber die aufgesteckte 45-Grad-Winkelkupplung. Alles
  // andere Schiefe (Rampen, Sparren) gibt es als Kupplung nicht.
  for (const d of other) if (!isC45Dir(d)) return "shape";
  // Zwei Rohre in dieselbe Richtung passen nicht in einen Stutzen.
  for (let i = 0; i < axis.length; i++) {
    for (let j = i + 1; j < axis.length; j++) {
      const a = axis[i], b = axis[j];
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.95) return "duplicate";
    }
  }
  if (axis.length > 6) return "arms";   // mehr Stutzen als ein Wuerfel Flaechen hat
  const type = connectorTypeForDirs(axis);
  if (!type || type === "end") return null;
  const def = getConnector(type);
  return def && def.buildable ? null : "type";
}

/**
 * Alle Knoten, fuer die es keine real erhaeltliche Kupplung gibt.
 *
 * Wird beim Verschieben gebraucht: fusionieren zwei Kupplungen zu einer, die es
 * so nicht gibt (zu viele Arme, zwei Rohre in derselben Richtung, eine schiefe
 * Lage), darf das Verschieben nicht stattfinden. Ein Durchlauf ueber die Rohre
 * statt neighborDirs je Knoten -- die Pruefung laeuft bei jedem Zieh-Schritt.
 */
export function infeasibleConnectors(model) {
  const dirsAt = new Map();
  const push = (id, from, to, arm) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    let d = [dx / len, dy / len, dz / len];
    // Die Huelse einer 45-Grad-Winkelkupplung steckt auf einem KARDINALEN
    // Stutzen; ihr Adapterkoerper sitzt aber zusaetzlich um den 45-Grad-Arm
    // versetzt, sodass die Kante gemessen leicht schief laeuft (~17 Grad).
    // Ungerundet gaelte damit jede gebaute Schraege als nicht herstellbar.
    if (arm) {
      const m = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
      const ax = m.indexOf(Math.max(m[0], m[1], m[2]));
      d = [0, 0, 0];
      d[ax] = Math.sign([dx, dy, dz][ax]) || 1;
    }
    if (!dirsAt.has(id)) dirsAt.set(id, []);
    dirsAt.get(id).push(d);
  };
  for (const t of model.tubes.values()) {
    if (t.link) continue;   // Doppelrohr-Verbindung ist kein Arm
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) continue;
    push(a.id, a, b, t.arm);
    push(b.id, b, a, t.arm);
  }
  const bad = new Set();
  for (const n of model.nodes.values()) {
    if (n.unused) continue;             // haelt nichts, also auch nichts zu pruefen
    if (n.c45body) continue;            // Adapter-Koerper ist immer einarmig
    // Flexikupplungs-Bolzen: dort steckt keine Kupplung, seine Arme sind der
    // Bolzen selbst und die Scharniere -- und die stehen frei in 45-Grad-
    // Schritten. An einer Kupplung gemessen waere das nie herstellbar.
    if (isBoltPart(n.part)) continue;
    // Im Achsenkreuz der Kupplung messen: eine gedrehte Kupplung haelt ihre
    // Rohre auf ihren eigenen Achsen, in der Welt stehen sie schraeg.
    if (armsFeasible(localDirs(model, n, dirsAt.get(n.id) || []))) bad.add(n.id);
  }
  return bad;
}

// Heuristik: aus Anzahl + Lage der Rohre den repraesentativen Kupplungstyp
// ableiten (fuer Beschriftung). Eine Winkelkupplung (45 Grad) ist nur dann
// kennzeichnend, wenn der Knoten als C45-Traeger markiert ist (node.c45, beim
// Import an einer echten connector45_2 gesetzt bzw. vom Editor beim Schraegbau).
// Sonst zaehlen schraege Arme als normale Arme der Basiskupplung (z. B. die
// Gegenenden von Schraegen oder flache Rampen = T-Stueck/Winkel). Der echte C45-
// Knoten ist die Basiskupplung selbst; das Schraegrohr dockt ~9 cm versetzt an,
// daher reicht das Flag und kein geometrischer 45-Grad-Arm am Knoten ist noetig.
export function inferConnectorType(model, node) {
  if (node.part) return node.part;
  const dirs = neighborDirs(model, node);
  if (dirs.length === 0) return null;
  // Die Winkelkupplung sitzt auf ihrem eigenen Knoten (dem Adapter-Koerper).
  // Die Kupplung, die sie TRAEGT, heisst weiter nach ihren eigenen Armen -- der
  // Stutzen unter der Huelse ist einer davon.
  if (node.c45body) return "diagonal";
  return connectorTypeForDirs(dirs);
}

// Liefert ALLE an einem Knoten verbauten Kupplungen als Liste von Typen.
// Nur an einem C45-Knoten bilden die achsenparallelen Arme die Basiskupplung und
// es kommt mindestens eine aufgesteckte 45-Grad-Winkelkupplung hinzu (Schraege
// braucht also 2 Kupplungen: Basis + 45 Grad). An allen anderen Knoten zaehlen
// alle Arme zusammen als eine normale Kupplung. Ein reines, freies Rohrende
// ("end") liefert eine leere Liste.
export function connectorsForNode(model, node) {
  // Eine Radkappe am Rohrende ERSETZT die Kupplung -- dort steckt keine mehr.
  if (model.hasWheelCap && model.hasWheelCap(node)) return [];
  // Klemm-Kupplungen sind ein festes Katalogteil. Die Lochzapfenkupplung nimmt
  // das Rohr selbst auf -- sie zaehlt allein. Die Lagerkupplung traegt eine
  // ganze Kupplung, die zusaetzlich in die Liste gehoert.
  if (isHolePart(node.part)) return [node.part];
  // Flexikupplung, im Editor gesetzt: der Knoten IST der Bolzen, dazu kommt je
  // Scharnier eines. Eine Kupplung steckt dort nicht -- der Bolzen ersetzt sie.
  if (isBoltPart(node.part)) {
    return [BOLT_PART, ...(node.hinges || []).map(() => HINGE_PART)];
  }
  // Flexikupplung: an diesem Punkt sitzt keine Kupplung, sondern zwei ihrer
  // Arme, die ein Bolzen haelt. Gezaehlt werden die Arme als Anbauteile (je
  // eine Zeile der Datei) -- hier also nichts, sonst stuende beides in der
  // Liste.
  if (node.part === "flexi") return [];
  if (node.part) {
    // Die getragene Kupplung steckt mit einem Arm IN der Lagerkupplung -- der
    // zaehlt mit, sonst faende die Heuristik bei einem einzigen Rohr nur ein
    // freies Ende und die Kupplung fehlte in der Liste.
    const dirs = neighborDirs(model, node);
    if (node.stub) dirs.push([-node.stub[0], -node.stub[1], -node.stub[2]]);
    // Sie ist immer da (sie wird auch gezeichnet); haengt noch kein Rohr daran,
    // zaehlt die kleinste Kupplung des Sortiments.
    const t = connectorTypeForDirs(dirs);
    return [node.part, t && t !== "end" ? t : "straight"];
  }
  const dirs = neighborDirs(model, node);
  if (dirs.length === 0) return node.preferType ? [node.preferType] : [];
  // Adapter-Koerper (c45body): genau HIER sitzt die 45-Grad-Winkelkupplung --
  // sie steckt mit ihrer Huelse auf dem Rohrende der Basiskupplung und nimmt
  // mit dem 45-Grad-Arm die Schraege auf. Es gibt sie nur einarmig, also immer
  // genau eine je Adapter-Koerper. Die Arm-Richtungen (Huelse + Schraege) nach
  // Anzahl/Lage zu klassifizieren lieferte hier faelschlich eine
  // "Flaechenkupplung 2-armig (90 Grad)".
  if (node.c45body) return ["diagonal"];
  // Kupplung, an der NUR die Huelse einer Winkelkupplung steckt (Adapter-Arm,
  // sonst nichts): Steckt die Winkelkupplung im Rohr, sitzt am anderen Ende der
  // Huelse genau so eine Dummy-Kupplung -- ein Rohr passt dort nicht hinein.
  // Ohne diese Regel gaelte ihr einzelner Arm als freies Rohrende und die
  // Kupplung fehlte in der Liste.
  {
    let arme = 0, andere = 0;
    for (const t of model.tubes.values()) {
      if (t.a !== node.id && t.b !== node.id) continue;
      if (t.arm) arme++; else if (!t.link) andere++;
    }
    if (arme && !andere) return ["straight"];
  }
  if (!node.c45) {
    const pref = getConnector(node.preferType);
    if (pref && (pref.arms || 0) > dirs.length) return [node.preferType];
    const t = connectorTypeForDirs(dirs);
    return t && t !== "end" ? [t] : [];
  }
  const axis = [], diag = [];
  for (const d of localDirs(model, node, dirs)) (isC45Dir(d) ? diag : axis).push(d);
  const out = [];
  const baseType = connectorTypeForDirs(axis);
  if (baseType && baseType !== "end") out.push(baseType);
  // Ein 45-Grad-Rohr, das direkt an diesem Knoten haengt (ohne eigenen Adapter-
  // Koerper), braucht hier eine Winkelkupplung. Haengt sie dagegen am Koerper,
  // zaehlt sie dort -- sonst stuende sie zweimal in der Liste.
  if (diag.length) {
    // 45-Grad-Winkelkupplung sitzt auf einer Basiskupplung; fehlt eine
    // achsenparallele Basis, traegt eine gerade Kupplung die Diagonale.
    if (out.length === 0) out.push("straight");
    for (let i = 0; i < diag.length; i++) out.push("diagonal");
  }
  return out;
}

// Fasst verstaerkte Rohre zu "Laeufen" zusammen: Rohre, die kollinear (gleiche
// Achse) ueber einen gemeinsamen Knoten aneinanderstossen, bilden EIN
// durchgehendes, laengeres Verstaerkungsprofil. Ueber Ecken (Richtungswechsel)
// hinweg wird NICHT verbunden, da ein Profil gerade ist. Die 45-Grad-Kupplungen
// brauchen etwas Platz, daher wird ueber Knoten-IDs (Topologie) statt exakter
// Koordinaten verbunden und die Laenge aus der echten Knotendistanz summiert.
function reinforcementRuns(model) {
  const reinforced = [...model.tubes.values()].filter((t) => t.reinforced);
  if (!reinforced.length) return [];

  const dirOf = (t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    return [dx / L, dy / L, dz / L];
  };
  const lenOf = (t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  };

  // Union-Find ueber Rohr-IDs.
  const parent = new Map(reinforced.map((t) => [t.id, t.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  // Verstaerkte Rohre pro Knoten sammeln.
  const byNode = new Map();
  for (const t of reinforced) {
    for (const nid of [t.a, t.b]) {
      if (!byNode.has(nid)) byNode.set(nid, []);
      byNode.get(nid).push(t);
    }
  }
  // An jedem Knoten kollineare verstaerkte Rohre zu einem Lauf verbinden.
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) {
      const d1 = dirOf(list[i]);
      if (!d1) continue;
      for (let j = i + 1; j < list.length; j++) {
        const d2 = dirOf(list[j]);
        if (!d2) continue;
        const dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
        if (Math.abs(dot) > 0.999) union(list[i].id, list[j].id); // gerade Linie
      }
    }
  }

  const runs = new Map(); // Wurzel -> { segments, length }
  for (const t of reinforced) {
    const r = find(t.id);
    if (!runs.has(r)) runs.set(r, { segments: 0, length: 0 });
    const run = runs.get(r);
    run.segments++;
    run.length += lenOf(t);
  }
  return [...runs.values()];
}

// --- Schrauben ------------------------------------------------------------
// Sie werden nur gerechnet: kein Teil im Modell, nichts zu setzen, nichts zu
// zeichnen. Grundregel des Systems: an einer Kupplung hat ein Rohr genau EIN
// Loch. Deshalb wird nicht addiert, sondern belegt -- jedes Rohr bringt zwei
// PLAETZE mit (je Ende einen), Platten- und Rutschenschrauben nehmen sich
// welche davon, und was uebrig bleibt, sind die Rohrschrauben.

// So nah muss ein Knoten liegen, damit eine Schraube ihn als ihren Platz
// nimmt: eine halbe Kupplung plus Toleranz.
const SCREW_SLOT_EPS = 6;
// Rutschenschrauben laufen durch das Geruest daneben -- dort darf der Knoten
// weiter weg liegen (eine Rutschenbreite).
const SCREW_SLIDE_EPS = 45;

/**
 * Schrauben eines Modells. Liefert Zeilen wie die uebrigen Abschnitte:
 * `{ key, id, name, color, colorName, count, price, subtotal }`. `price` ist
 * der STUECKpreis (Packpreis / Packgroesse) -- gekauft werden Packungen, die
 * Liste rechnet anteilig.
 */
export function computeScrews(model) {
  // 1. Plaetze aufspannen: je Rohrende einer. Arme und Doppelrohr-Verbindungen
  //    sind keine Rohre und tragen keine Schrauben.
  const slots = new Map();            // "tubeId@nodeId" -> { tube, node, frei }
  const slotsAtNode = new Map();      // nodeId -> [slotKey]
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue;
    for (const nodeId of [t.a, t.b]) {
      const key = t.id + "@" + nodeId;
      slots.set(key, { tube: t, node: nodeId, free: true });
      if (!slotsAtNode.has(nodeId)) slotsAtNode.set(nodeId, []);
      slotsAtNode.get(nodeId).push(key);
    }
  }
  const takeSlot = (key) => {
    const slot = key && slots.get(key);
    if (!slot || !slot.free) return false;
    slot.free = false;
    return true;
  };
  /** Freien Platz an einem Knoten belegen -- egal an welchem seiner Rohre. */
  const takeAtNode = (nodeId) => {
    for (const key of slotsAtNode.get(nodeId) || []) if (takeSlot(key)) return true;
    return false;
  };
  /** Knoten, der einem Punkt am naechsten liegt (innerhalb `eps`). */
  const nodeNear = (point, eps) => {
    let best = null, bestDist = eps;
    for (const n of model.nodes.values()) {
      const d = Math.hypot(n.x - point[0], n.y - point[1], n.z - point[2]);
      if (d <= bestDist) { best = n; bestDist = d; }
    }
    return best;
  };

  /** Richtung eines Rohrs (normiert) -- null, wenn die Knoten fehlen. */
  const dirOf = (t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b) return null;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len = Math.hypot(d[0], d[1], d[2]);
    return len < 1e-6 ? null : d.map((v) => v / len);
  };
  /** Waagerechtes Rohr, das dem Punkt am naechsten liegt -- der Traeger. */
  const horizontalTubeNear = (point) => {
    let best = null, bestDist = SCREW_SLIDE_EPS;
    for (const t of model.tubes.values()) {
      if (t.arm || t.link) continue;
      const d = dirOf(t);
      if (!d || Math.abs(d[1]) > 0.2) continue;          // nicht waagerecht
      const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
      // Abstand des Punktes von der Strecke a..b
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
      const ap = [point[0] - a.x, point[1] - a.y, point[2] - a.z];
      const lenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
      const tt = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lenSq));
      const dist = Math.hypot(ap[0] - ab[0] * tt, ap[1] - ab[1] * tt, ap[2] - ab[2] * tt);
      if (dist <= bestDist) { best = t; bestDist = dist; }
    }
    return best;
  };
  /** Rohr, das von diesem Knoten nach OBEN geht -- der Pfosten daneben. */
  const tubeUpwardFrom = (nodeId) => {
    for (const t of model.tubes.values()) {
      if (t.arm || t.link) continue;
      if (t.a !== nodeId && t.b !== nodeId) continue;
      const d = dirOf(t);
      if (!d) continue;
      const up = t.a === nodeId ? d[1] : -d[1];          // Richtung WEG vom Knoten
      if (up > 0.9) return t;
    }
    return null;
  };

  const count = { panel: 0, acrylic: 0, conical: 0, counter: 0, slide: 0 };

  // 2. Platten: vier Schrauben. Eine Platte hat ZWEI Lippen mit je zwei
  //    Schrauben, sie wird also an einem Rohr-PAAR verschraubt -- nicht an allen
  //    vier Kanten. Welches Paar, sagt ihre Drehung: ungedreht sind es die
  //    beiden Tragrohre (p.a und p.b), gedreht die beiden quer dazu. Die
  //    Schrauben laufen durch das Rohr in die Kupplung; liegt dort schon eine,
  //    ist der Platz weg.
  //    Die Acrylglasplatte ist eine Rahmenplatte: sie haengt wie jede Platte an
  //    vier Plattenschrauben, und ihre Scheibe sitzt mit vier eigenen
  //    Acrylglasschrauben im Rahmen -- die belegen keinen Platz am Rohr.
  for (const p of model.panels.values()) {
    if (p.poolPart) continue;                  // Baellebad ist eine Folie
    count.panel += 4;
    const pdef = getPanel(p.panelId);
    if (pdef && pdef.acrylic) count.acrylic += 4;
    const corners = model.panelCorners(p);
    if (!corners) continue;
    // corners: [Anfang a, Ende a, Ende b, Anfang b]
    if (!p.turned) {
      for (const [tubeId, punkt] of [[p.a, corners[0]], [p.a, corners[1]],
                                     [p.b, corners[3]], [p.b, corners[2]]]) {
        const t = model.tubes.get(tubeId);
        if (!t) continue;
        const node = nodeNear(punkt, SCREW_SLOT_EPS);
        if (!node) continue;                   // Platte sitzt mitten auf dem Rohr
        takeSlot(t.id + "@" + node.id);
      }
      continue;
    }
    // Gedreht: die Lippen liegen auf den Querrohren. Gesucht ist an jeder Ecke
    // das Rohr, das zur GEGENUEBERLIEGENDEN Ecke derselben Kante laeuft.
    const quer = [[corners[0], corners[3]], [corners[1], corners[2]]];
    for (const [von, nach] of quer) {
      const nv = nodeNear(von, SCREW_SLOT_EPS), nn = nodeNear(nach, SCREW_SLOT_EPS);
      if (!nv || !nn) continue;
      const t = model.tubeBetween ? model.tubeBetween(nv.id, nn.id) : null;
      if (!t) continue;
      takeSlot(t.id + "@" + nv.id);
      takeSlot(t.id + "@" + nn.id);
    }
  }

  // 3. Rutschen. Die Integralrutsche braucht keine Schraube; Kettenteile
  //    schon: je Verbindung zwei konische Schrauben mit Gegenstueck und zwei
  //    Rutschenschrauben, und der Einstieg haengt mit zwei konischen Schrauben
  //    und zwei Plattenschrauben am Geruest.
  const slides = [...(model.slides ? model.slides.values() : [])];
  const belegt = new Set();                    // Rutschen, die an einem Ausgang haengen
  for (const s of slides) {
    const exit = model.slideExit(s);
    if (!exit) continue;
    const folge = slides.find((o) => o.id !== s.id
      && Math.hypot(o.x - exit.pos[0], o.y - exit.pos[1], o.z - exit.pos[2]) < 5);
    if (!folge) continue;
    belegt.add(folge.id);
    count.conical += 2;
    count.counter += 2;
    count.slide += 2;
    const node = nodeNear(exit.pos, SCREW_SLIDE_EPS);
    if (node) { takeAtNode(node.id); takeAtNode(node.id); }
  }
  for (const s of slides) {
    // Kopf der Kette = Rutschenkoerper, der an keinem Ausgang haengt.
    if (!model.slideExit(s) || belegt.has(s.id)) continue;
    count.conical += 2;
    count.panel += 2;
    // Wo genau: die beiden Plattenschrauben sitzen im WAAGERECHTEN Rohr, auf
    // dem die Rutsche aufliegt (je Ende eine), die beiden konischen in den
    // Rohren, die von dessen Kupplungen nach OBEN gehen.
    const einstieg = s.hook && s.hook.length === 3 ? s.hook : [s.x, s.y, s.z];
    const traeger = horizontalTubeNear(einstieg);
    if (!traeger) continue;
    takeSlot(traeger.id + "@" + traeger.a);
    takeSlot(traeger.id + "@" + traeger.b);
    for (const nodeId of [traeger.a, traeger.b]) {
      const pfosten = tubeUpwardFrom(nodeId);
      if (pfosten) takeSlot(pfosten.id + "@" + nodeId);
    }
  }

  // 4. Rohrschrauben: was an Plaetzen uebrig ist, nach Rohrfarbe.
  const tubeScrews = new Map();                // Farbe -> Anzahl
  for (const slot of slots.values()) {
    if (!slot.free) continue;
    const color = slot.tube.color || null;
    tubeScrews.set(color, (tubeScrews.get(color) || 0) + 1);
  }

  const rows = [];
  const push = (id, anzahl, color = null) => {
    if (!anzahl) return;
    const def = getScrew(id);
    if (!def) return;
    const stueck = round2((def.price || 0) / (def.pack || 1));
    rows.push({
      key: id + (color ? "|" + color : ""), id, name: partName(def),
      color, colorName: color ? colorName(color) : null,
      count: anzahl, pack: def.pack || 1,
      price: stueck, subtotal: round2(stueck * anzahl),
    });
  };
  for (const [color, anzahl] of [...tubeScrews.entries()]
    .sort((a, b) => b[1] - a[1])) push("screw_tube", anzahl, color);
  push("screw_panel", count.panel);
  push("screw_acrylic", count.acrylic);
  push("screw_slide_conical", count.conical);
  push("screw_slide_conical_counter", count.counter);
  push("screw_slide", count.slide);
  return rows;
}

export function computeBOM(model) {
  // --- Rohre nach Typ + Farbe ---
  const tubeMap = new Map();
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue; // C45-Arm / Doppelrohr-Verbindung ist kein Rohr
    const key = t.tubeId + "|" + t.color;
    if (!tubeMap.has(key)) tubeMap.set(key, { tubeId: t.tubeId, color: t.color, count: 0 });
    tubeMap.get(key).count++;
  }
  const tubes = [...tubeMap.values()].map((r) => {
    const def = getTube(r.tubeId) || { name: r.tubeId, price: 0, length_cm: null };
    return {
      key: r.tubeId + "|" + r.color,
      tubeId: r.tubeId, color: r.color,
      name: partName(def), colorName: colorName(r.color),
      length: def.length_cm, count: r.count,
      price: def.price, subtotal: round2(def.price * r.count),
    };
  }).sort((a, b) => (a.length || 0) - (b.length || 0));

  // --- Kupplungen nach abgeleitetem Typ ---
  // Pro Knoten koennen mehrere Kupplungen anfallen: eine Basiskupplung plus eine
  // aufgesteckte 45-Grad-Winkelkupplung je Knoten mit schraegem Arm.
  const connMap = new Map();
  let openEnds = 0;
  for (const n of model.nodes.values()) {
    if (n.unused) continue;   // steht in der Datei, haelt aber nichts
    const types = connectorsForNode(model, n);
    if (types.length === 0) {
      // Radkappe und Rohrkappe schliessen das Rohrende ab -- es ist dann nicht
      // mehr offen. Die Kupplung selbst zaehlt weiter (nur die Radkappe ersetzt
      // sie, das steht in connectorsForNode).
      const zu = model.hasEndPiece && model.hasEndPiece(n);
      if (model.degree(n.id) >= 1 && !zu) openEnds++;
      continue;
    }
    for (const type of types) connMap.set(type, (connMap.get(type) || 0) + 1);
  }
  // Doppelrohrverbinder / Klemmen sind eigenstaendige Bauteile (nicht an Knoten).
  if (model.clamps) {
    for (const c of model.clamps.values()) {
      const type = c.connectorId || "double_tube";
      connMap.set(type, (connMap.get(type) || 0) + 1);
    }
  }
  const connectors = [...connMap.entries()].map(([type, count]) => {
    const def = getConnector(type) || { name: type, code: "", price: 0 };
    return {
      type, code: def.code, name: partName(def), count,
      price: def.price, subtotal: round2(def.price * count),
    };
  }).sort((a, b) => b.count - a.count);

  // --- Platten nach Typ + Farbe ---
  // Die Teile eines Baellebads bleiben aussen vor: sie sind keine Platten,
  // sondern EINE Poolfolie (siehe poolLiners weiter unten).
  const panelMap = new Map();
  for (const p of model.panels.values()) {
    if (p.poolPart) continue;
    const key = p.panelId + "|" + p.color;
    if (!panelMap.has(key)) panelMap.set(key, { panelId: p.panelId, color: p.color, count: 0 });
    panelMap.get(key).count++;
  }
  const panels = [...panelMap.values()].map((r) => {
    const def = getPanel(r.panelId) || { name: r.panelId, price: 0 };
    return {
      key: r.panelId + "|" + r.color,
      panelId: r.panelId, color: r.color,
      name: partName(def), colorName: colorName(r.color), count: r.count,
      price: def.price, subtotal: round2(def.price * r.count),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const tubeCount = tubes.reduce((s, r) => s + r.count, 0);
  const connCount = connectors.reduce((s, r) => s + r.count, 0);
  const panelCount = panels.reduce((s, r) => s + r.count, 0);

  // --- Netze/Stoffe (textil2) nach Groesse + Farbe ---
  // Ein Tuch hat kein Katalogteil je Groesse -- es gibt EINES (`textile`).
  // Name + Masse muessen hier schon stehen, sonst wird in der Stueckliste
  // aus fehlendem id/name das Wort "undefined".
  const textileDef = getPartById("textile");
  const textileMap = new Map();
  for (const tx of (model.textiles ? model.textiles.values() : [])) {
    const key = tx.w + "x" + tx.h + "|" + tx.color;
    if (!textileMap.has(key)) textileMap.set(key, { w: tx.w, h: tx.h, color: tx.color, count: 0 });
    textileMap.get(key).count++;
  }
  const textiles = [...textileMap.values()].map((r) => {
    const base = textileDef ? partName(textileDef) : "textile";
    const size = r.w && r.h ? ` ${r.w}×${r.h} cm` : "";
    return {
      key: r.w + "x" + r.h + "|" + r.color,
      id: (textileDef && textileDef.id) || "textile",
      kind: "textil2",
      w: r.w, h: r.h,
      name: `${base}${size}`,
      color: r.color, colorName: colorName(r.color), count: r.count,
      price: (textileDef && textileDef.price) || 0,
      subtotal: 0,
    };
  }).sort((a, b) => b.count - a.count);
  const textileCount = textiles.reduce((s, r) => s + r.count, 0);

  // --- Baellebaeder: je Pool EIN Teil ------------------------------------
  // Der Editor zeigt vier Waende und einen Boden, im Laden gibt es dafuer eine
  // einzige Plane -- die "Poolfolie" in vier Groessen. Gezaehlt wird ueber den
  // Boden: den gibt es genau einmal je Baellebad.
  const poolLiners = new Map();      // Teile-id -> Anzahl
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    if (!POOL_KINDS.has(f.kind)) continue;
    const def = poolLinerFor(Math.abs(f.w || 0), Math.abs(f.d || 0));
    if (def) poolLiners.set(def.id, (poolLiners.get(def.id) || 0) + 1);
  }
  // Aeltere Staende fuehren das Baellebad noch als fuenf Platten: dort zaehlt
  // der Boden, seine Grundflaeche gibt die Groesse.
  for (const p of model.panels.values()) {
    if (p.panelId !== "pool_floor") continue;
    const corners = model.panelCorners(p);
    if (!corners) continue;
    const span = (a, b) => Math.round(Math.hypot(
      corners[a][0] - corners[b][0], corners[a][1] - corners[b][1], corners[a][2] - corners[b][2]));
    const def = poolLinerFor(span(0, 1), span(0, 3));
    if (def) poolLiners.set(def.id, (poolLiners.get(def.id) || 0) + 1);
  }

  // --- Anbauteile (Raeder, Rollen, Netze, Sonderkupplungen) --------------
  // Gezaehlt wird nach Katalogteil, nicht nach QDF-Art: ein- und dreiarmige
  // Lochzapfenkupplung sind dieselbe Elementart, aber zwei Teile.
  const fitMap = new Map();
  for (const f of (model.fittings ? model.fittings.values() : [])) {
    if (POOL_KINDS.has(f.kind)) continue;   // zaehlt oben als Poolfolie
    // Das offene Verbinderende ist KEIN Bauteil: es sagt nur, dass an dieser
    // Kupplung ein Stutzen gerechnet werden soll (siehe ARM_FITTINGS). Gekauft
    // wird dafuer nichts -- es steht deshalb weder in der Stueckliste noch in
    // der Aufbau-Liste.
    if (f.kind === "open-connector2") continue;
    const def = partForFitting(f.kind, f.mask);
    const key = def ? def.id : f.kind;
    if (!fitMap.has(key)) fitMap.set(key, { def, kind: f.kind, count: 0 });
    fitMap.get(key).count++;
  }
  // Die Poolfolien reihen sich bei den Anbauteilen ein -- sie sind Zubehoer
  // mit Katalogpreis wie Sack, Netz oder Dachtextil.
  for (const [id, count] of poolLiners) {
    fitMap.set(id, { def: getPartById(id), kind: "pool2", count });
  }
  // Die Acrylglasscheibe wird nicht gesetzt, sie steckt in jeder Rahmenplatte:
  // eine Scheibe je Acrylglasplatte, gerechnet aus den Platten.
  let acrylicSheets = 0;
  for (const p of model.panels.values()) {
    const def = getPanel(p.panelId);
    if (def && def.acrylic) acrylicSheets++;
  }
  if (acrylicSheets) {
    fitMap.set("acrylic_glass", { def: getPartById("acrylic_glass"), kind: "acrylic", count: acrylicSheets });
  }
  const fittings = [...fitMap.entries()].map(([key, r]) => ({
    key, id: key, kind: r.kind,
    name: r.def ? partName(r.def) : (partName(getPartById(key)) || r.kind),
    code: (r.def && r.def.code) || "",
    count: r.count,
    price: (r.def && r.def.price) || 0,
    subtotal: round2(((r.def && r.def.price) || 0) * r.count),
  })).sort((a, b) => b.count - a.count);
  const fittingCount = fittings.reduce((s, r) => s + r.count, 0);

  // --- Rutschen/Daecher (slide*/roof2) nach Art ---------------------------
  // Die vier Rutschenteile stehen im Katalog (Integralrutsche, Modular- und
  // Bogenrutschen-Koerper, Auslauf) und bringen von dort Name, Code und Preis
  // mit; Arten ohne Katalogteil (Dach) behalten ihren Anzeigenamen.
  const slideMap = new Map();
  for (const sl of (model.slides ? model.slides.values() : [])) {
    slideMap.set(sl.kind, (slideMap.get(sl.kind) || 0) + 1);
  }
  const slides = [...slideMap.entries()].map(([kind, count]) => {
    const def = partForFitting(kind);
    return {
      key: kind, kind, count,
      id: def ? def.id : kind,
      name: def ? partName(def) : slideKindName(kind),
      code: (def && def.code) || "",
      price: (def && def.price) || 0,
      subtotal: round2(((def && def.price) || 0) * count),
    };
  }).sort((a, b) => b.count - a.count);
  const slideCount = slides.reduce((s, r) => s + r.count, 0);

  // --- Verstaerkungen ---
  // Zu kaufen gibt es nur EINE Laenge: das Holz-Profil mit 80 cm. Es deckt
  // 80 cm Knotenabstand -- ein 75er-Rohr oder zwei 35er in einer Linie.
  // Gezaehlt wird deshalb nicht nach Laufllaenge, sondern in Profilen: ein Lauf
  // von 160 cm braucht zwei. (Aus Herstellerdateien kommen auch andere Laengen
  // verstaerkt herein; die werden auf ganze Profile aufgerundet.)
  const runs = reinforcementRuns(model);
  const reinforcements = [];
  const part = reinforcementPart();
  const profilLaenge = (part && part.length_cm) || 80;
  const profileCount = runs.reduce(
    (s, run) => s + Math.max(1, Math.round(run.length / profilLaenge)), 0);

  if (profileCount > 0 && part) {
    reinforcements.push({
      key:      part.id,
      id:       part.id,
      len:      profilLaenge,
      name:     partName(part),
      count:    profileCount,
      pieces:   profileCount,
      price:    part.price,
      subtotal: round2(part.price * profileCount),
    });
  }

  // Gesamtzahl der Profile (erscheint im Summen-Footer).
  const reinfCount = profileCount;

  const screwRows = computeScrews(model);

  const price = round2(
    screwRows.reduce((s, r) => s + r.subtotal, 0) +
    tubes.reduce((s, r) => s + r.subtotal, 0) +
    connectors.reduce((s, r) => s + r.subtotal, 0) +
    panels.reduce((s, r) => s + r.subtotal, 0) +
    reinforcements.reduce((s, r) => s + r.subtotal, 0) +
    fittings.reduce((s, r) => s + r.subtotal, 0) +
    // Rutschenteile haben seit dem Katalogeintrag eigene Preise.
    slides.reduce((s, r) => s + (r.subtotal || 0), 0)
  );

  return {
    tubes, connectors, panels, reinforcements, openEnds, textiles, slides, fittings,
    screws: screwRows,
    totals: {
      tubes: tubeCount, connectors: connCount, panels: panelCount,
      reinforcements: reinfCount, textiles: textileCount, slides: slideCount,
      fittings: fittingCount, price,
      screws: screwRows.reduce((s, r) => s + r.count, 0),
      // Alles, was weder Rohr, Kupplung, Platte noch Schraube ist: Rutschen,
      // Raeder, Textilien, Anbauteile und die Verstaerkungslaeufe -- gezaehlt
      // wie in den Zeilen darueber.
      other: fittingCount + slideCount + textileCount + reinfCount,
    },
  };
}

// Bestand: benoetigte Mengen je Rohrlaenge (Farbe egal) und je Kupplungstyp.
// Teile, die NICHT ueber die Machbarkeit entscheiden. Schrauben zaehlt kaum
// jemand (Sonderregel weiter unten), und alles aus Textilien/Netzen -- Tuch,
// Netz, Rundwand, Spielsack, Dachtextil -- ist Zubehoer: es fehlt vielleicht,
// aber das Modell steht trotzdem. Die Zeilen bleiben in der Liste und faerben
// sich rot, nur der Haken bleibt gruen.
export const SOFT_PARTS = new Set(["textile", "lattice", "textile_round", "bag", "roof", "roof_large"]);

export function neededParts(bom) {
  const tubes = new Map();   // tubeId -> count
  for (const r of bom.tubes) tubes.set(r.tubeId, (tubes.get(r.tubeId) || 0) + r.count);
  const connectors = new Map(); // type -> count
  for (const r of bom.connectors) connectors.set(r.type, r.count);
  const panels = new Map();  // panelId -> count
  for (const r of bom.panels || []) panels.set(r.panelId, (panels.get(r.panelId) || 0) + r.count);
  // Anbauteile: was im Katalog eine Kupplung ist (Radlager, Lochzapfenkupplung),
  // gehoert in denselben Topf wie die uebrigen Kupplungen -- sonst stuende es im
  // Bestand zweimal.
  const fittings = new Map();   // Katalog-id -> Stueckzahl
  for (const r of bom.fittings || []) {
    const pot = getConnector(r.id) ? connectors : fittings;
    pot.set(r.id, (pot.get(r.id) || 0) + r.count);
  }
  // Rutschenteile stehen als Zubehoer im Katalog und zaehlen wie Anbauteile.
  for (const r of bom.slides || []) {
    if (!r.id) continue;
    fittings.set(r.id, (fittings.get(r.id) || 0) + r.count);
  }
  // Quadratische Tuecher leben in model.textiles, nicht in fittings -- sonst
  // fehlen sie im Bestand und die Zeile hat keine Katalog-id.
  for (const r of bom.textiles || []) {
    const id = r.id || "textile";
    fittings.set(id, (fittings.get(id) || 0) + r.count);
  }
  const reinforcements = new Map(); // id -> physische Stueckzahl (40-cm-Profile)
  for (const r of bom.reinforcements || [])
    reinforcements.set(r.id, (reinforcements.get(r.id) || 0) + (r.pieces ?? r.count));
  // Schrauben: die Rohrschraube steht je Rohrfarbe in einer eigenen Zeile, im
  // Bestand zaehlt die Summe je Teil.
  const screws = new Map();
  for (const r of bom.screws || []) screws.set(r.id, (screws.get(r.id) || 0) + r.count);
  return { tubes, connectors, panels, reinforcements, fittings, screws };
}

// Vergleicht Bedarf mit Bestand. inv = { tubes:{id:n}, connectors:{type:n}, panels:{id:n} }.
export function compareInventory(bom, inv) {
  const need = neededParts(bom);
  const rows = [];
  let feasible = true;

  for (const [tubeId, count] of need.tubes) {
    const def = getTube(tubeId) || { name: tubeId };
    const owned = (inv.tubes && inv.tubes[tubeId]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "tubes", key: tubeId, name: partName(def), need: count, owned, ok });
  }
  for (const [type, count] of need.connectors) {
    const def = getConnector(type) || { name: type };
    const owned = (inv.connectors && inv.connectors[type]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "connectors", key: type, name: partName(def), need: count, owned, ok });
  }
  for (const [panelId, count] of need.panels) {
    const def = getPanel(panelId) || { name: panelId };
    const owned = (inv.panels && inv.panels[panelId]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "panels", key: panelId, name: partName(def), need: count, owned, ok });
  }
  for (const [id, count] of need.fittings) {
    const def = getPartById(id) || { name: id };
    const owned = (inv.fittings && inv.fittings[id]) || 0;
    const ok = owned >= count;
    const soft = SOFT_PARTS.has(id);
    if (!ok && !soft) feasible = false;
    rows.push({ group: "fittings", key: id, name: partName(def), need: count, owned, ok, soft });
  }
  for (const [id, count] of need.reinforcements) {
    const def = reinforcementPart() || { name: id };
    const owned = (inv.reinforcements && inv.reinforcements[id]) || 0;
    const ok = owned >= count;
    if (!ok) feasible = false;
    rows.push({ group: "reinforcements", key: id, name: partName(def), need: count, owned, ok });
  }
  for (const [id, count] of need.screws || []) {
    const def = getScrew(id) || { name: id };
    const owned = (inv.screws && inv.screws[id]) || 0;
    const ok = owned >= count;
    // Sonderregel: Eine 0 heisst "noch nicht gezaehlt", nicht "fehlt". Die
    // Zeile faerbt sich trotzdem rot -- sie ist ein Hinweis, kein Ausschluss.
    // Ab dem ersten eingetragenen Stueck zaehlt der Bestand normal mit.
    const soft = owned === 0;
    if (!ok && !soft) feasible = false;
    rows.push({ group: "screws", key: id, name: partName(def), need: count, owned, ok, soft });
  }
  return { rows, feasible };
}
