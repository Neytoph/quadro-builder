import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuildModel } from "./model.js";

const CS = 5;
const near = (a, b, eps = 0.08) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;
const xyz = (n) => [n.x, n.y, n.z];

function tubeX(m, z, y = 40) {
  const a = m.addNode(0, y, z);
  const b = m.addNode(40, y, z);
  return m.addTube(a.id, b.id, "T35", "blue", 35);
}

function clampOn(m, tube, off) {
  return clampAt(m, tube, off, 20);
}

function clampAt(m, tube, off, x) {
  const a = m.nodes.get(tube.a), b = m.nodes.get(tube.b);
  const c = m.addClamp(x, (a.y + b.y) / 2, (a.z + b.z) / 2);
  c.dir = [1, 0, 0];
  c.off = off.slice();
  return c;
}

function tubeXAt(m, z, x0, y = 40) {
  const a = m.addNode(x0, y, z);
  const b = m.addNode(x0 + 40, y, z);
  return m.addTube(a.id, b.id, "T35", "blue", 35);
}

describe("rotateClamp", () => {
  it("dreht das zweite Loch um 45° um die Rohrachse", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const c = clampOn(m, hinge, [0, 0, CS]);
    assert.equal(m.rotateClamp(c.id), true);
    const s = Math.SQRT1_2 * CS;
    assert.ok(near(c.off, [0, -s, s]));
    assert.equal(m.rotateClamp(c.id, 0), false);
  });

  it("nimmt die zweite Tube mit, das gehaltene Rohr bleibt", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const h0 = xyz(m.nodes.get(hinge.a));
    assert.equal(m.rotateClamp(c.id, Math.PI / 2), true);
    assert.ok(near(c.off, [0, -CS, 0]));
    assert.ok(near(xyz(m.nodes.get(hinge.a)), h0));
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40 - CS, 0]));
    assert.ok(near(xyz(m.nodes.get(flap.b)), [40, 40 - CS, 0]));
  });

  it("Klappe: Platte auf Halte- und Gegenrohr, der Rest am Haltrohr bleibt", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const stay = tubeX(m, -40);
    m.addPanel(hinge.id, flap.id, 0, 40, "P40", "green");
    m.addPanel(hinge.id, stay.id, 0, 40, "P40", "red");
    const c = clampOn(m, hinge, [0, 0, CS]);
    const stay0 = xyz(m.nodes.get(stay.a));
    assert.equal(m.rotateClamp(c.id, Math.PI / 2), true);
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40 - CS, 0]));
    assert.ok(near(xyz(m.nodes.get(stay.a)), stay0), "Gegenplatte darf das Haltrohr nicht mitziehen");
    const corners = m.panelCorners([...m.panels.values()][0]);
    assert.ok(corners);
  });

  it("Tablett: zwei zweite Tubes bleiben parallel", () => {
    const m = new BuildModel();
    const hL = tubeX(m, 0);
    const hR = tubeX(m, 40);
    const fL = tubeX(m, 0, 40 - CS);
    const fR = tubeX(m, 40, 40 - CS);
    const cL = clampOn(m, hL, [0, -CS, 0]);
    clampOn(m, hR, [0, -CS, 0]);
    m.addPanel(fL.id, fR.id, 0, 40, "P40", "green");
    assert.equal(m.setClampOffDir(cL.id, [0, -Math.SQRT1_2, -Math.SQRT1_2]), true);
    const a = xyz(m.nodes.get(fL.a)), b = xyz(m.nodes.get(fL.b));
    const c = xyz(m.nodes.get(fR.a)), d = xyz(m.nodes.get(fR.b));
    assert.ok(near([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [40, 0, 0]));
    assert.ok(near([d[0] - c[0], d[1] - c[1], d[2] - c[2]], [40, 0, 0]));
    const dY = a[1] - c[1], dZ = a[2] - c[2];
    assert.ok(Math.abs(dY) < 0.08 && Math.abs(dZ - -40) < 0.08
      || Math.abs(Math.hypot(dY, dZ) - 40) < 0.15);
  });

  it("setClampOffDir projiziert auf die Querebene", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const c = clampOn(m, hinge, [0, 0, CS]);
    assert.equal(m.setClampOffDir(c.id, [3, -1, 0]), true);
    const L = Math.hypot(...c.off);
    assert.ok(Math.abs(L - CS) < 0.02);
    assert.ok(near([c.off[0] / L, c.off[1] / L, c.off[2] / L], [0, -1, 0]));
  });

  it("leere Schwester auf demselben Rohr bleibt stehen", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const cHold = clampAt(m, hinge, [0, 0, CS], 10);
    const cEmpty = clampAt(m, hinge, [0, CS, 0], 30);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const empty0 = cEmpty.off.slice();
    assert.equal(m.rotateClamp(cHold.id, Math.PI / 2), true);
    assert.ok(near(cEmpty.off, empty0), "leere Klemme dreht nicht mit");
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40 - CS, 0]));
  });

  it("Schwester mit zweiter Tube dreht mit", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const cEmpty = clampAt(m, hinge, [0, CS, 0], 10);
    const cHold = clampAt(m, hinge, [0, 0, CS], 30);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    assert.equal(m.rotateClamp(cEmpty.id, Math.PI / 2), true);
    assert.ok(near(cHold.off, [0, -CS, 0]));
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40 - CS, 0]));
  });

  it("schiebt die zweite Tube entlang der ersten", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    const h0 = xyz(m.nodes.get(hinge.a));
    assert.equal(m.slideClampFlap(c.id, 10), true);
    assert.ok(near(xyz(m.nodes.get(hinge.a)), h0));
    assert.ok(near(xyz(m.nodes.get(flap.a)), [10, 40, CS]));
    assert.ok(near([c.x, c.y, c.z], [20, 40, 0]), "Klemme bleibt");
  });

  it("snappt die zweite Tube an die Enden der ersten", () => {
    const m = new BuildModel();
    const hinge = tubeXAt(m, 0, 0);
    const flap = tubeXAt(m, CS, 10);
    const c = clampAt(m, hinge, [0, 0, CS], 20);
    assert.equal(m.slideClampFlap(c.id, -3, { snapDist: 8 }), true);
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40, CS]));
    assert.ok(near([c.x, c.y, c.z], [20, 40, 0]), "Klemme bleibt");
  });

  it("gleitet nicht vom Rohrende", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    assert.equal(m.slideClampFlap(c.id, 100), true);
    assert.ok(near([c.x, c.y, c.z], [20, 40, 0]), "Klemme bleibt");
    assert.ok(near(xyz(m.nodes.get(flap.a)), [20, 40, CS]));
  });

  it("nach dem Snap wieder vom Ende weg", () => {
    const m = new BuildModel();
    const hinge = tubeXAt(m, 0, 0);
    const flap = tubeXAt(m, CS, 0);
    const c = clampAt(m, hinge, [0, 0, CS], 20);
    assert.equal(m.slideClampFlap(c.id, 5, { snapDist: 8 }), true);
    assert.ok(near(xyz(m.nodes.get(flap.a)), [5, 40, CS]));
  });

  it("Auswahl: Schwester mit zweiter Tube gehoert dazu, leere nicht", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const cEmpty = clampAt(m, hinge, [0, CS, 0], 10);
    const cHold = clampAt(m, hinge, [0, 0, CS], 30);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const fromHold = m.clampCohort(cHold.id);
    assert.equal(fromHold.clamps.has(cHold.id), true);
    assert.equal(fromHold.clamps.has(cEmpty.id), false);
    assert.equal(fromHold.tubes.has(flap.id), true);
    const fromEmpty = m.clampCohort(cEmpty.id);
    assert.equal(fromEmpty.clamps.has(cHold.id), true);
    assert.equal(fromEmpty.tubes.has(flap.id), true);
  });

  it("schiebt Schwestern mit zweiter Tube zusammen", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flapA = tubeXAt(m, CS, 0, 40);
    const flapB = tubeXAt(m, -CS, 0, 40);
    const cA = clampAt(m, hinge, [0, 0, CS], 10);
    const cB = clampAt(m, hinge, [0, 0, -CS], 30);
    m.addLink(hinge.a, flapA.a);
    m.addLink(hinge.b, flapA.b);
    m.addLink(hinge.a, flapB.a);
    m.addLink(hinge.b, flapB.b);
    assert.equal(m.slideClampFlap(cA.id, 5), true);
    assert.ok(near(xyz(m.nodes.get(flapA.a)), [5, 40, CS]));
    assert.ok(near(xyz(m.nodes.get(flapB.a)), [5, 40, -CS]));
    assert.ok(near([cA.x, cA.y, cA.z], [10, 40, 0]));
    assert.ok(near([cB.x, cB.y, cB.z], [30, 40, 0]));
  });

  it("nimmt an der zweiten Tube angebaute Rohre mit", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const far = m.addNode(40, 80, CS);
    m.addTube(flap.b, far.id, "T35", "green", 35);
    assert.equal(m.rotateClamp(c.id, Math.PI / 2), true);
    assert.ok(near(xyz(m.nodes.get(hinge.a)), [0, 40, 0]));
    assert.ok(near(xyz(m.nodes.get(flap.b)), [40, 40 - CS, 0]));
    assert.ok(near(xyz(far), [40, 40 - CS, 40]));
    const a = xyz(m.nodes.get(flap.b)), b = xyz(far);
    assert.ok(near([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 40]),
      "angebautes Rohr bleibt gerade");
  });

  it("nimmt Klemm-Kupplung auf der zweiten Tube mit", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const kn = m.addTubeClamp(flap.id, [20, 41, CS], "hole-connector4");
    assert.ok(kn);
    const far = m.addNode(kn.x, kn.y + 40, kn.z);
    m.addTube(kn.id, far.id, "T35", "green", 35);
    const stub0 = kn.stub ? kn.stub.slice() : null;
    assert.equal(m.rotateClamp(c.id, Math.PI / 2), true);
    assert.ok(near(xyz(kn), [20, 40 - CS, CS]));
    assert.ok(near(xyz(far), [20, 40 - CS, CS + 40]));
    const a = xyz(kn), b = xyz(far);
    assert.ok(near([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 40]));
    if (stub0) {
      const L = Math.hypot(...kn.stub);
      assert.ok(near([kn.stub[0] / L, kn.stub[1] / L, kn.stub[2] / L], [0, 0, 1], 0.08));
    }
  });

  it("nimmt Doppelklemme auf der zweiten Tube mit", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const extra = tubeX(m, CS, 40 + CS);
    const nested = clampAt(m, flap, [0, CS, 0], 20);
    assert.equal(m.rotateClamp(c.id, Math.PI / 2), true);
    assert.ok(near([c.x, c.y, c.z], [20, 40, 0]), "Scharnier-Klemme bleibt");
    assert.ok(near(xyz(m.nodes.get(extra.a)), [0, 40 - CS, CS]));
    assert.ok(near(xyz(m.nodes.get(extra.b)), [40, 40 - CS, CS]));
    assert.ok(near([nested.x, nested.y, nested.z], [20, 40 - CS, 0]));
    assert.ok(near(nested.off, [0, 0, CS]));
  });

  it("45°: Wuerfel an der zweiten Tube bleibt rechtwinklig", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const a0 = m.addNode(0, 80, CS);
    const a1 = m.addNode(40, 80, CS);
    const b0 = m.addNode(0, 80, CS + 40);
    const b1 = m.addNode(40, 80, CS + 40);
    const c0 = m.addNode(0, 40, CS + 40);
    const c1 = m.addNode(40, 40, CS + 40);
    m.addTube(flap.a, a0.id, "T35", "green", 35);
    m.addTube(flap.b, a1.id, "T35", "green", 35);
    m.addTube(a0.id, a1.id, "T35", "yellow", 35);
    m.addTube(a0.id, b0.id, "T35", "red", 35);
    m.addTube(a1.id, b1.id, "T35", "red", 35);
    m.addTube(b0.id, b1.id, "T35", "yellow", 35);
    m.addTube(flap.a, c0.id, "T35", "blue", 35);
    m.addTube(flap.b, c1.id, "T35", "blue", 35);
    m.addTube(c0.id, c1.id, "T35", "blue", 35);
    m.addTube(c0.id, b0.id, "T35", "green", 35);
    m.addTube(c1.id, b1.id, "T35", "green", 35);
    assert.equal(m.rotateClamp(c.id, Math.PI / 4), true);
    const edge = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const S = xyz(m.nodes.get(flap.b)), P = xyz(a1), Q = xyz(b1), R = xyz(c1);
    assert.ok(Math.abs(edge(S, P) - 40) < 0.2);
    assert.ok(Math.abs(edge(P, Q) - 40) < 0.2);
    assert.ok(Math.abs(edge(S, R) - 40) < 0.2);
    const u = [P[0] - S[0], P[1] - S[1], P[2] - S[2]];
    const v = [R[0] - S[0], R[1] - S[1], R[2] - S[2]];
    assert.ok(Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) < 3,
      "Kanten an der zweiten Tube bleiben senkrecht");
    assert.ok(near(xyz(m.nodes.get(hinge.a)), [0, 40, 0]));
  });

  it("greift die naechste parallele Tube, nicht die erste im Map", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const decoy = tubeX(m, CS + 2.5);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    assert.equal(m._clampSecondTube(c).id, flap.id);
    assert.equal(m.rotateClamp(c.id, Math.PI / 4), true);
    assert.ok(near(xyz(m.nodes.get(flap.a)), [0, 40 - Math.SQRT1_2 * CS, Math.SQRT1_2 * CS], 0.15));
    assert.ok(near(xyz(m.nodes.get(decoy.a)), [0, 40, CS + 2.5]));
  });

  it("45°: nested Klemme auf extra Rohr laesst das Quadrat rechtwinklig", () => {
    const m = new BuildModel();
    const hinge = tubeX(m, 0);
    const flap = tubeX(m, CS);
    const c = clampOn(m, hinge, [0, 0, CS]);
    m.addLink(hinge.a, flap.a);
    m.addLink(hinge.b, flap.b);
    const a1 = m.addNode(40, 80, CS);
    const b1 = m.addNode(40, 80, CS + 40);
    const c1 = m.addNode(40, 40, CS + 40);
    m.addTube(flap.b, a1.id, "T35", "green", 35);
    m.addTube(a1.id, b1.id, "T35", "red", 35);
    m.addTube(b1.id, c1.id, "T35", "yellow", 35);
    m.addTube(flap.b, c1.id, "T35", "blue", 35);
    const nested = m.addClamp(40, 60, CS);
    nested.dir = [0, 1, 0];
    nested.off = [0, 0, CS];
    assert.equal(m.rotateClamp(c.id, Math.PI / 4), true);
    const S = xyz(m.nodes.get(flap.b)), P = xyz(a1), R = xyz(c1);
    const u = [P[0] - S[0], P[1] - S[1], P[2] - S[2]];
    const v = [R[0] - S[0], R[1] - S[1], R[2] - S[2]];
    const ul = Math.hypot(...u), vl = Math.hypot(...v);
    assert.ok(Math.abs(ul - 40) < 0.2);
    assert.ok(Math.abs(vl - 40) < 0.2);
    assert.ok(Math.abs((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (ul * vl)) < 0.08,
      "extra Quadrat bleibt rechtwinklig");
  });

  it("17°/35°: extra Wuerfel und Kupplungen drehen als ein Stueck", () => {
    const quatAroundX = (deg) => {
      const h = deg * Math.PI / 360;
      let q = [Math.sin(h), 0, 0, Math.cos(h)];
      if (q[3] < 0) q = q.map((v) => -v);
      return q;
    };
    const sameQ = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.999;
    for (const deg of [-17, -32, -35, -8]) {
      const m = new BuildModel();
      const hinge = tubeX(m, 0);
      const flap = tubeX(m, CS);
      const c = clampOn(m, hinge, [0, 0, CS]);
      m.addLink(hinge.a, flap.a);
      m.addLink(hinge.b, flap.b);
      const a0 = m.addNode(0, 80, CS);
      const a1 = m.addNode(40, 80, CS);
      const b0 = m.addNode(0, 80, CS + 40);
      const b1 = m.addNode(40, 80, CS + 40);
      const c0 = m.addNode(0, 40, CS + 40);
      const c1 = m.addNode(40, 40, CS + 40);
      m.addTube(flap.a, a0.id, "T35", "green", 35);
      m.addTube(flap.b, a1.id, "T35", "green", 35);
      m.addTube(a0.id, a1.id, "T35", "yellow", 35);
      m.addTube(a0.id, b0.id, "T35", "red", 35);
      m.addTube(a1.id, b1.id, "T35", "red", 35);
      m.addTube(b0.id, b1.id, "T35", "yellow", 35);
      m.addTube(flap.a, c0.id, "T35", "blue", 35);
      m.addTube(flap.b, c1.id, "T35", "blue", 35);
      m.addTube(c0.id, c1.id, "T35", "blue", 35);
      m.addTube(c0.id, b0.id, "T35", "green", 35);
      m.addTube(c1.id, b1.id, "T35", "green", 35);
      assert.equal(a1.quat, undefined);
      assert.equal(m.rotateClamp(c.id, deg * Math.PI / 180), true, String(deg));
      const S = xyz(m.nodes.get(flap.b)), P = xyz(a1), Q = xyz(b1), R = xyz(c1);
      const edge = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      assert.ok(Math.abs(edge(S, P) - 40) < 0.25, "Kante SP " + deg);
      assert.ok(Math.abs(edge(P, Q) - 40) < 0.25, "Kante PQ " + deg);
      assert.ok(Math.abs(edge(S, R) - 40) < 0.25, "Kante SR " + deg);
      const u = [P[0] - S[0], P[1] - S[1], P[2] - S[2]];
      const v = [R[0] - S[0], R[1] - S[1], R[2] - S[2]];
      const ul = Math.hypot(...u), vl = Math.hypot(...v);
      assert.ok(Math.abs((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (ul * vl)) < 0.08,
        "rechtwinklig " + deg);
      const want = quatAroundX(deg);
      for (const n of [m.nodes.get(flap.a), m.nodes.get(flap.b), a0, a1, b0, b1, c0, c1]) {
        assert.ok(n.quat && n.quat.length === 4, "Kupplung quat " + deg);
        assert.ok(sameQ(n.quat, want), "Kupplung dreht " + deg);
      }
      assert.equal(m.nodes.get(hinge.a).quat, undefined);
      assert.ok(near(xyz(m.nodes.get(hinge.a)), [0, 40, 0]));
    }
  });
});
