import { beforeAll, describe, expect, it } from 'vitest';
import { consolidateLayerSteps } from './assemblyLayerSteps.js';
import { assemblyDetailState, assemblyState, computeAssemblyPlan } from './assemblyPlan.js';
import { BuildModel } from './model.js';
import { loadCatalog } from './catalog.js';

beforeAll(async () => { await loadCatalog(); });

function fixture() {
  const make = (id: string, kind: string, y: number, partId: string, dependsOn: string[]) => ({
    id, kind, regionId: 'body', y, title: id, dependsOn, interfaceIds: [], instructions: ['Layer instruction'],
    partIds: [partId], nodeIds: [], tubeIds: [partId], panelIds: [], textileIds: [], slideIds: [], fittingIds: [], clampIds: [],
    parts: { tubes: [{ key: 'T35|blue', count: 1, price: 2, subtotal: 2, instanceIds: [partId] }] },
    action: { type: 'build', detached: false, operations: [] },
    operations: [{ id: `op-${id}`, order: 1, type: 'insert-tube', partIds: [partId], consumesPartIds: [partId], consumesMaterialInstanceIds: [`material-${partId}`], dependsOn: dependsOn.map(s => `op-${s}`), placementTranslation: [0, 0, 0] }],
    detailGroups: [{ id: `detail-${id}`, operationIds: [`op-${id}`], partIds: [partId], instructions: ['Take pipe'], materialKeys: ['tubes:T35|blue'], operationNumbers: [{ id: `op-${id}`, order: 1, partIds: [partId] }] }]
  });
  return {
    steps: [make('floor', 'frame', 0, 'floor-pipe', []), make('columns', 'risers', 0, 'column-pipe', ['floor']), make('upper', 'frame', 40, 'upper-pipe', ['columns'])],
    regions: [{ id: 'body', name: 'Body', partIds: ['floor-pipe', 'column-pipe', 'upper-pipe'], tubeIds: ['floor-pipe', 'column-pipe', 'upper-pipe'] }],
    interfaces: [{ id: 'port', supportStepId: 'columns' }], frameModules: [{ installStepId: 'upper' }], fixingPoints: [], diagnostics: [],
    ledger: { instances: [{ id: 'material-floor-pipe', stepId: 'floor' }, { id: 'material-column-pipe', stepId: 'columns' }, { id: 'material-upper-pipe', stepId: 'upper' }] }
  };
}

describe('one reading step per layer', () => {
  it('gives a real two-level frame one main step at each height, with columns after the lower frame', () => {
    const model = new BuildModel();
    const lower = [[0, 0, 0], [40, 0, 0], [40, 0, 40], [0, 0, 40]].map(p => model.addNode(...p));
    const upper = lower.map(n => model.addNode(n.x, 40, n.z));
    for (const nodes of [lower, upper]) nodes.forEach((n, i) => model.addTube(n.id, nodes[(i + 1) % 4].id, 'T35', 'blue', 35));
    const columns = lower.map((n, i) => model.addTube(n.id, upper[i].id, 'T35', 'blue', 35)!.id);
    const plan = computeAssemblyPlan(model);
    const body = plan.regions.find((r: any) => r.kind === 'body')!;
    expect(plan.steps.filter((s: any) => s.regionId === body.id).map((s: any) => s.y)).toEqual([0, 40]);
    const ops = plan.steps[0].operations;
    const firstColumn = ops.findIndex((o: any) => o.consumesPartIds.some((id: string) => columns.includes(id)));
    const frameClosed = ops.findIndex((o: any) => o.type === 'join-subframes');
    expect(frameClosed).toBeGreaterThanOrEqual(0);
    expect(firstColumn).toBeGreaterThan(frameClosed);
    expect(new Set(plan.steps.flatMap((s: any) => s.operations.flatMap((o: any) => o.consumesPartIds))).size).toBe(model.nodes.size + model.tubes.size);
  });

  it('preserves the construction sequence and single material allocation when combining a frame with its risers', () => {
    const plan = fixture(), operations = plan.steps.flatMap(s => s.operations), materialIds = plan.ledger.instances.map(i => i.id);
    consolidateLayerSteps(plan, (_group: string, row: any) => row.key);
    expect(plan.steps.map(s => s.y)).toEqual([0, 40]);
    expect(plan.steps.flatMap(s => s.operations).map(o => o.id)).toEqual(operations.map(o => o.id));
    expect(plan.steps[0].operations.map(o => o.order)).toEqual([1, 2]);
    expect(plan.steps[0].operations[1].dependsOn).toEqual(['op-floor']);
    expect(plan.steps[1].dependsOn).toEqual(['floor']);
    expect(plan.interfaces[0].supportStepId).toBe('floor');
    expect(plan.ledger.instances.map(i => i.id)).toEqual(materialIds);
    expect(plan.steps.reduce((sum, s) => sum + s.parts.tubes[0].count, 0)).toBe(3);
    expect(plan.ledger.instances.map(i => i.stepId)).toEqual(['floor', 'floor', 'upper']);
  });

  it('shows the whole layer in the overview but hides later actions in a local frame detail', () => {
    const plan = fixture(); consolidateLayerSteps(plan, (_group: string, row: any) => row.key);
    expect([...assemblyState(plan, 0).visible]).toEqual(['floor-pipe', 'column-pipe']);
    expect([...assemblyDetailState(plan, 0, 'detail-floor', { action: false }).visible]).toEqual(['floor-pipe']);
    expect([...assemblyDetailState(plan, 0, 'detail-columns', { action: false }).visible]).toEqual(['floor-pipe', 'column-pipe']);
    expect(plan.steps[0].detailGroups[1].operationNumbers[0].order).toBe(2);
  });

  it('keeps separate lowered frames and hides later risers only in the layer action overview', () => {
    const plan: any = fixture(), floor = plan.steps[0];
    floor.partIds.push('separate-frame-pipe'); floor.tubeIds.push('separate-frame-pipe');
    floor.action.layer = true;
    floor.action.modules = [
      { id: 'left-frame', partIds: ['floor-pipe'], translation: [0, 18, 0], interfaceIds: ['left-port'] },
      { id: 'right-frame', partIds: ['separate-frame-pipe'], translation: [0, 25, 0], interfaceIds: ['right-port'] }
    ];
    floor.action.inPlacePartIds = [];
    plan.interfaces.push({ id: 'left-port', position: [0, 0, 0] }, { id: 'right-port', position: [40, 0, 0] });
    consolidateLayerSteps(plan, (_group: string, row: any) => row.key);
    const action = assemblyState(plan, 0, { action: true }), complete = assemblyState(plan, 0, { action: false });
    expect(action.arrows.map((a: any) => a.assemblyId)).toEqual(['left-frame', 'right-frame']);
    expect(action.transforms.get('floor-pipe')).toEqual([0, 18, 0]);
    expect(action.transforms.get('separate-frame-pipe')).toEqual([0, 25, 0]);
    expect(action.visible.has('column-pipe')).toBe(false);
    expect(action.hiddenNewParts.has('column-pipe')).toBe(true);
    expect(complete.visible.has('column-pipe')).toBe(true);
    expect(complete.transforms.size).toBe(0);
  });

  it('retains separate layers and separate configured regions', () => {
    const plan = fixture(); plan.steps[1].regionId = 'adjacent';
    consolidateLayerSteps(plan, (_group: string, row: any) => row.key);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1].dependsOn).toEqual(['floor']);
  });
});
