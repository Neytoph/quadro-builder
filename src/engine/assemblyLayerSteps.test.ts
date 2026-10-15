import { beforeAll, describe, expect, it } from 'vitest';
import { consolidateLayerSteps, resolveScheduledStepDependencies } from './assemblyLayerSteps.js';
import { scheduleAssemblyAccessories } from './assemblyOperations.js';
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
  it('passes through two removed empty steps and preserves both completed cross-region prerequisites', () => {
    const plan: any = fixture(), lower = plan.steps[0], columns = plan.steps[1], upper = plan.steps[2];
    columns.regionId = 'adjacent'; columns.dependsOn = [];
    const empty = (id: string, dependsOn: string[]) => ({ ...lower, id, dependsOn, partIds: [], tubeIds: [], operations: [], detailGroups: [] });
    plan.steps = [lower, columns, empty('empty-1', ['floor', 'columns']), empty('empty-2', ['empty-1']), upper];
    upper.dependsOn = ['empty-2'];
    const before = [lower, columns, upper].map(step => ({ id: step.id, operations: step.operations, details: step.detailGroups, parts: step.parts }));
    const model = { panels: new Map(), textiles: new Map(), slides: new Map(), fittings: new Map(), clamps: new Map(), tubes: new Map() };
    scheduleAssemblyAccessories(model, plan.steps, plan.diagnostics, plan.regions);
    expect(plan.steps.map((step: any) => step.id)).toEqual(['floor', 'columns', 'upper']);
    expect(upper.dependsOn).toEqual(['floor', 'columns']);
    expect(plan.diagnostics).toEqual([]);
    for (const [index, step] of plan.steps.entries()) {
      expect(step.operations).toBe(before[index].operations);
      expect(step.detailGroups).toBe(before[index].details);
      expect(step.parts).toBe(before[index].parts);
    }
  });

  it('redirects a physically merged roof to its retained owner and keeps all external roof prerequisites', () => {
    const plan: any = fixture(), body = plan.steps[0], adjacent = plan.steps[1], roof = plan.steps[2];
    adjacent.regionId = 'adjacent'; adjacent.dependsOn = [];
    roof.id = 'roof-1'; roof.regionId = 'roof'; roof.action = { type: 'preassemble', detached: true, operations: [] }; roof.dependsOn = [body.id];
    const second = { ...roof, id: 'roof-2', partIds: ['roof-pipe-2'], tubeIds: ['roof-pipe-2'], dependsOn: ['roof-1', adjacent.id] };
    const attach = { ...roof, id: 'attach-roof', action: { type: 'attach', operations: [] }, dependsOn: ['roof-2'] };
    plan.steps = [body, adjacent, roof, second, attach];
    const model = { panels: new Map(), textiles: new Map(), slides: new Map(), fittings: new Map(), clamps: new Map(), tubes: new Map() };
    scheduleAssemblyAccessories(model, plan.steps, plan.diagnostics, [{ id: 'roof', kind: 'roof', name: 'Roof' }]);
    expect(plan.steps.map((step: any) => step.id)).toEqual(['floor', 'columns', 'roof-1', 'attach-roof']);
    expect(roof.partIds).toEqual(['upper-pipe', 'roof-pipe-2']);
    expect(roof.dependsOn).toEqual(['floor', 'columns']);
    expect(attach.dependsOn).toEqual(['roof-1']);
    expect(plan.diagnostics).toEqual([]);
  });

  it('does not erase an originally cyclic or future roof-member prerequisite during physical merging', () => {
    const plan: any = fixture(), first = plan.steps[0], second = plan.steps[1];
    first.regionId = second.regionId = 'roof';
    first.action = second.action = { type: 'preassemble', detached: true, operations: [] };
    first.dependsOn = ['columns']; second.dependsOn = ['floor', 'columns'];
    plan.steps = [first, second];
    const model = { panels: new Map(), textiles: new Map(), slides: new Map(), fittings: new Map(), clamps: new Map(), tubes: new Map() };
    scheduleAssemblyAccessories(model, plan.steps, plan.diagnostics, [{ id: 'roof', kind: 'roof', name: 'Roof' }]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_STEP_DEPENDENCY', severity: 'error', partIds: ['floor-pipe'], details: { stepId: 'floor', dependsOn: 'columns', reason: 'not-earlier' } }),
      expect.objectContaining({ code: 'INVALID_STEP_DEPENDENCY', severity: 'error', partIds: ['column-pipe'], details: { stepId: 'columns', dependsOn: 'columns', reason: 'cycle' } })
    ]));
  });

  it('retains transitive ancestors when the surviving frame and risers subsequently merge into one layer', () => {
    const plan: any = fixture();
    const graph = new Map([['floor', []], ['columns', ['floor']], ['empty', ['columns']], ['upper', ['empty']]]);
    plan.steps[2].dependsOn = ['empty'];
    const ops = plan.steps.flatMap((step: any) => step.operations).map((op: any) => ({ id: op.id, dependsOn: [...op.dependsOn] }));
    resolveScheduledStepDependencies(plan.steps, graph, new Map(), plan.diagnostics);
    expect(plan.steps[2].dependsOn).toEqual(['columns']);
    consolidateLayerSteps(plan, (_group: string, row: any) => row.key);
    expect(plan.steps[1].dependsOn).toEqual(['floor']);
    expect(plan.steps.flatMap((step: any) => step.operations).map((op: any) => ({ id: op.id, dependsOn: op.dependsOn }))).toEqual(ops);
    expect(plan.interfaces[0].supportStepId).toBe('floor');
    expect(plan.diagnostics).toEqual([]);
  });

  it('diagnoses unknown, cyclic and future prerequisites instead of silently deleting them', () => {
    const steps: any[] = [
      { id: 'first', partIds: ['n-first'], dependsOn: ['missing', 'cycle-a', 'future', 'first'] },
      { id: 'future', partIds: ['n-future'], dependsOn: [] }
    ];
    const graph = new Map([['first', [...steps[0].dependsOn]], ['cycle-a', ['cycle-b']], ['cycle-b', ['cycle-a']], ['future', []]]);
    const diagnostics: any[] = [];
    resolveScheduledStepDependencies(steps, graph, new Map(), diagnostics);
    expect(steps[0].dependsOn).toEqual(['missing', 'cycle-a', 'future', 'first']);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_STEP_DEPENDENCY', severity: 'error', partIds: ['n-first'], details: { stepId: 'first', dependsOn: 'missing', reason: 'missing' } }),
      expect.objectContaining({ details: { stepId: 'first', dependsOn: 'cycle-a', reason: 'cycle' } }),
      expect.objectContaining({ details: { stepId: 'first', dependsOn: 'future', reason: 'not-earlier' } }),
      expect.objectContaining({ details: { stepId: 'first', dependsOn: 'first', reason: 'cycle' } })
    ]));
    expect(graph.get('first')).toEqual(['missing', 'cycle-a', 'future', 'first']);
  });

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
    // The later column has a real motion, but the layer overview hides it.
    plan.steps[1].action.operations = [{ id: 'future-column-insertion', partIds: ['column-pipe'], translation: [0, 12, 0], position: [0, 0, 0], direction: [0, -1, 0] }];
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
