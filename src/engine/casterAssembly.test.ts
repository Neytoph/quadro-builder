import { beforeAll, describe, expect, it } from 'vitest';
import { BuildModel } from './model.js';
import { loadCatalog } from './catalog.js';
import { computeAssemblyPlan } from './assemblyPlan.js';
import { nativeAccessorySupport } from './assemblyAccessoryMethods.js';
import { beginAssemblyCollisionPass, checkAssemblyPath, partEnvelope } from './assemblyCollision.js';
import { assemblyMeshes } from './assemblyNativeMesh.js';

beforeAll(async () => { await loadCatalog(); });
function fixture() {
  const model = new BuildModel();
  const corners = [[2.5, 14, 2.5], [42.5, 14, 2.5], [42.5, 14, 42.5], [2.5, 14, 42.5]].map(p => model.addNode(...p));
  for (let i = 0; i < 4; i++) model.addTube(corners[i].id, corners[(i + 1) % 4].id, 'T35', 'blue', 35);
  const mount = model.fittingMounts('casters2').find((m: any) => m.nodeId === corners[0].id && m.dir[1] === -1)!;
  const caster = model.addFittingAt('casters2', mount, 'blue')!;
  const adapter = [...model.fittings.values()].find((f: any) => f.kind === 'adapter2')!;
  return { model, caster, adapter, node: corners[0] };
}

describe('脚轮与适配器的真实安装', () => {
  it('先装适配器再装脚轮，保留两件物料和完整插接路径', () => {
    const { model, caster, adapter, node } = fixture();
    expect(nativeAccessorySupport(model, caster.id).supportIds).toEqual([node.id, adapter.id]);
    const plan = computeAssemblyPlan(model), ops = plan.steps.flatMap((s: any) => s.operations);
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.ledger.conserved).toBe(true);
    expect(ops.findIndex((op: any) => op.type === 'fit-accessory' && op.partIds.includes(adapter.id))).toBeLessThan(ops.findIndex((op: any) => op.type === 'fit-accessory' && op.partIds.includes(caster.id)));
    expect(plan.verification).toMatchObject({ pathChecked: true, methodChecked: true });
    beginAssemblyCollisionPass(model);
    expect(partEnvelope(model, caster.id)).toHaveLength(assemblyMeshes()!.accessoryTriangles.casters2.length);
    expect(partEnvelope(model, caster.id).every((shape: any) => shape.kind === 'triangle')).toBe(true);
  });

  it.each(['missing', 'offset', 'reversed', 'duplicate'])('适配器%s时不能确认脚轮支撑', reason => {
    const { model, caster, adapter } = fixture();
    if (reason === 'missing') model.fittings.delete(adapter.id);
    if (reason === 'offset') adapter.x += 1;
    if (reason === 'reversed') adapter.quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    if (reason === 'duplicate') model.fittings.set('duplicate', { ...adapter, id: 'duplicate' });
    expect(nativeAccessorySupport(model, caster.id).valid).toBe(false);
  });

  it('有限插接接触不能放过横向穿入和外部挡物', () => {
    const { model, caster, adapter, node } = fixture();
    const contracts = new Map([[`${adapter.id}:${node.id}`, { fittingId: adapter.id, supportId: node.id, kind: 'node-stub', axis: [0, -1, 0] }]]);
    beginAssemblyCollisionPass(model);
    expect(checkAssemblyPath(model, [adapter.id], [node.id], [0, -18, 0], [0, 0, 0], { fittingMatingContacts: contracts })).toBeNull();
    expect(checkAssemblyPath(model, [adapter.id], [node.id], [18, 0, 0], [0, 0, 0], { fittingMatingContacts: contracts })).toBeTruthy();
    const a = model.addNode(-17.5, -4, 2.5), b = model.addNode(22.5, -4, 2.5);
    const obstacle = model.addTube(a.id, b.id, 'T35', 'red', 35)!;
    beginAssemblyCollisionPass(model);
    expect(checkAssemblyPath(model, [caster.id], [obstacle.id], [0, -18, 0])).toMatchObject({ obstaclePartId: obstacle.id });
  });
});
