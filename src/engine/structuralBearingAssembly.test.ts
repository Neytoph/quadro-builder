import { beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog } from './catalog.js';
import { BuildModel } from './model.js';
import { computeAssemblyPlan } from './assemblyPlan.js';
import { nativeAccessorySupport } from './assemblyAccessoryMethods.js';
import { beginAssemblyCollisionPass, checkAssemblyPath } from './assemblyCollision.js';
import { scheduleAssemblyAccessories } from './assemblyOperations.js';
beforeAll(async () => { await loadCatalog(); });

function fixture() {
  const model = new BuildModel();
  const nodes = [[20, 0, 0], [60, 0, 0], [60, 0, 40], [20, 0, 40]].map(p => model.addNode(...p));
  for (let i = 0; i < 4; i++) model.addTube(nodes[i].id, nodes[(i + 1) % 4].id, 'T35', 'blue', 35);
  const supports = [nodes[0], nodes[1]].map(n => {
    const top = model.addNode(n.x, 30, n.z);
    model.addTube(n.id, top.id, 'T25', 'blue', 25);
    return top;
  });
  model.addTube(supports[0].id, supports[1].id, 'T35', 'blue', 35);
  const bearings = supports.map(n => model.addBearingAtArm(n.id, [0, 1, 0])!);
  const a = model.addNode(0, 40, 0), b = model.addNode(80, 40, 0);
  const axle = model.addTube(a.id, b.id, 'T75', 'blue', 75)!;
  supports.forEach((n, i) => model.noteBearingTube(n.id, axle.id, 20 + 40 * i));
  return { model, supports, bearings, axle };
}

describe('native structural bearing assembly', () => {
  it('fits both support bearings before passing the continuous shaft through their open bores', () => {
    const { model, supports, bearings, axle } = fixture(), plan = computeAssemblyPlan(model), ops = plan.steps.flatMap((s: any) => s.operations);
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true);
    expect(plan.ledger.conserved).toBe(true);
    const shaft = ops.find((op: any) => op.bearingShaftMethod)!;
    expect(shaft.partIds).toEqual([axle.id]);
    expect(shaft.translation).toEqual([67.5, 0, 0]);
    expect(shaft.bearingShaftMethod.valid).toBe(true);
    for (const [i, bearing] of bearings.entries()) {
      const fit = ops.find((op: any) => op.type === 'fit-accessory' && op.partIds.includes(bearing.id))!;
      expect(fit.referencePartIds).toContain(supports[i].id);
      expect(fit.verification.pathChecked && fit.verification.methodChecked).toBe(true);
      expect(ops.indexOf(fit)).toBeLessThan(ops.indexOf(shaft));
      expect(shaft.referencePartIds).toContain(bearing.id);
      expect(ops.filter((op: any) => op.consumesPartIds.includes(bearing.id))).toHaveLength(1);
    }
    expect(ops.filter((op: any) => op.consumesPartIds.includes(axle.id))).toHaveLength(1);
  }, 30000);

  it('orders explicitly separated support and shaft regions using the bearing references', () => {
    const { model, bearings, axle } = fixture(), shaftIds = [axle.a, axle.b, axle.id], supportIds = [...model.nodes.keys(), ...model.tubes.keys(), ...model.fittings.keys()].filter(id => !shaftIds.includes(id));
    const plan = computeAssemblyPlan(model, { version: 1, regions: [{ id: 'shaft', partIds: shaftIds }, { id: 'stand', partIds: supportIds }], order: ['shaft', 'stand'] });
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true);
    expect(plan.regions.map((r: any) => r.id)).toEqual(['stand', 'shaft']);
    expect(plan.interfaces.filter((mark: any) => mark.attachment === 'bearing-shaft').map((mark: any) => mark.bearingId).sort()).toEqual(bearings.map(f => f.id).sort());
  }, 30000);

  it('rejects a schedule that closes the shaft before its bearing support step', () => {
    const { model, supports, bearings, axle } = fixture();
    const step = (id: string, partIds: string[], nodeIds: string[], tubeIds: string[], fittingIds: string[]) => ({ id, regionId: 'body', partIds, nodeIds, tubeIds, fittingIds, panelIds: [], slideIds: [], textileIds: [], clampIds: [], dependsOn: [], action: { type: 'build' } });
    const steps = [step('closed-shaft', [axle.a, axle.b, axle.id], [axle.a, axle.b], [axle.id], []), step('stand', [...supports.map(n => n.id), ...bearings.map(f => f.id)], supports.map(n => n.id), [], bearings.map(f => f.id))], diagnostics: any[] = [];
    scheduleAssemblyAccessories(model, steps, diagnostics);
    expect(diagnostics.filter(d => d.code === 'BEARING_SUPPORT_ORDER_UNRESOLVED')).toHaveLength(2);
  });

  it.each(['missing-bearing-link', 'missing-shaft-link', 'wrong-shaft-position', 'wrong-mouth', 'wrong-stub', 'duplicate-link', 'wrong-length', 'wrong-native-axis'])('rejects %s', reason => {
    const { model, supports, bearings, axle } = fixture(), node: any = supports[0], fitting: any = bearings[0];
    if (reason === 'missing-bearing-link') node.bearingOn = null;
    if (reason === 'missing-shaft-link') node.clampOn = null;
    if (reason === 'wrong-shaft-position') node.clampOn.t += 1;
    if (reason === 'wrong-mouth') fitting.quat = [.5, .5, .5, .5];
    if (reason === 'wrong-stub') node.stub = [0, 1, 0];
    if (reason === 'duplicate-link') (supports[1] as any).bearingOn = fitting.id;
    if (reason === 'wrong-length') axle.length = 35;
    if (reason === 'wrong-native-axis') (axle as any).geom = { p0: [0, 40, 1], dir: [1, 0, 0], len: 75, pad: 0 };
    expect(nativeAccessorySupport(model, fitting.id).valid).toBe(false);
  });

  it('limits socket contact to the exact bound port and axial insertion', () => {
    const { model, supports, bearings } = fixture(), fitting = bearings[0], node = supports[0];
    const contracts = new Map([[`${fitting.id}:${node.id}`, { fittingId: fitting.id, supportId: node.id, kind: 'structural-bearing-stub', axis: [0, 1, 0] }]]);
    const check = (start: number[], end = [0, 0, 0], ids = [node.id]) => {
      beginAssemblyCollisionPass(model);
      return checkAssemblyPath(model, [fitting.id], ids, start, end, { fittingMatingContacts: contracts });
    };
    expect(check([0, 18, 0])).toBeNull();
    expect(check([18, 0, 0])).not.toBeNull();
    expect(check([0, -18, 0])).not.toBeNull();
    expect(check([1, 18, 0], [1, 0, 0])).not.toBeNull();
    const a = model.addNode(0, 55, 0), b = model.addNode(40, 55, 0), obstacle = model.addTube(a.id, b.id, 'T35', 'red', 35)!;
    expect(check([0, 18, 0], [0, 0, 0], [node.id, obstacle.id])).toMatchObject({ obstaclePartId: obstacle.id });
  });

  it('blocks a shaft obstruction even when both bearing references are correct', () => {
    const { model, axle } = fixture();
    const a = model.addNode(40, 0, 0), b = model.addNode(40, 80, 0), obstacle = model.addTube(a.id, b.id, 'T75', 'red', 75)!;
    beginAssemblyCollisionPass(model);
    expect(checkAssemblyPath(model, [axle.id], [obstacle.id], [67.5, 0, 0])).toMatchObject({ obstaclePartId: obstacle.id });
  });
});
