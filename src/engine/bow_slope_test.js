import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuildModel, slopeArmDirsAt } from "./model.js";

const S = Math.SQRT1_2;

describe("Bogenrohr auf einer Schräge", () => {
  it("setzt den Bogen auf einer ansteigenden Schräge trotz tieferem Kreismittelpunkt", () => {
    const model = new BuildModel();
    const from = model.addNode(0, 0, 0);
    const result = model.extendBow(from.id, [S, S, 0], [S, -S, 0], "B40", "green", 40);

    assert.ok(result.tube);
    assert.equal(result.tube.bow, true);
    assert.ok(result.tube.bowCenter[1] < 0);
    assert.ok(Math.abs(result.node.x - 40 * Math.SQRT2) < 0.01);
    assert.ok(Math.abs(result.node.y) < 0.01);
  });

  it("berücksichtigt den tiefsten Punkt zwischen den Enden einer abfallenden Schräge", () => {
    const model = new BuildModel();
    const high = model.addNode(0, 20, 0);
    const low = model.addNode(0, 10, 40);
    const direction = [S, -S, 0];
    const normal = [S, S, 0];

    assert.ok(model.extendBow(high.id, direction, normal, "B40", "yellow", 40).tube);
    assert.deepEqual(model.extendBow(low.id, direction, normal, "B40", "yellow", 40), { ground: true });
    assert.equal(model.tubes.size, 1);
  });

  it("bietet am Bogenende die zur Tangente passenden Richtungen für das nächste Rohr", () => {
    const model = new BuildModel();
    const from = model.addNode(0, 0, 0);
    const bow = model.extendBow(from.id, [S, S, 0], [S, -S, 0], "B40", "green", 40);
    const directions = slopeArmDirsAt(model, bow.node);

    assert.deepEqual(directions.map((entry) => entry.name),
      ["+X+Y", "+X-Y", "-X+Y", "-X-Y", "+Z", "-Z"]);
    const next = model.extend(bow.node.id, directions.find((entry) => entry.name === "+Z").vec,
      "T35", "blue", 35, 40);
    assert.ok(next.tube);
    assert.equal(next.tube.a, bow.node.id);
    assert.equal(next.node.z, 40);
  });
});
