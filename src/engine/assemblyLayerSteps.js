import { getLang } from './i18n.js';

const ENTITY_KEYS = ['nodeIds', 'tubeIds', 'panelIds', 'textileIds', 'slideIds', 'fittingIds', 'clampIds'];
const GROUPS = ['connectors', 'tubes', 'panels', 'textiles', 'slides', 'fittings', 'screws', 'reinforcements'];
const unique = values => [...new Set(values)];
const copy = (zh, en, de) => getLang() === 'zh' ? zh : getLang() === 'en' ? en : de;

function dependencyError(diagnostics, step, dependency, reason) {
  if (diagnostics.some(d => d.code === 'INVALID_STEP_DEPENDENCY' &&
      d.details?.stepId === step.id && d.details?.dependsOn === dependency && d.details?.reason === reason)) return;
  diagnostics.push({ code: 'INVALID_STEP_DEPENDENCY', severity: 'error',
    message: '主步骤的前置步骤缺失、循环或尚未完成，请检查搭建顺序。',
    nodeIds: [], partIds: [...(step.partIds || [])],
    details: { stepId: step.id, dependsOn: dependency, reason } });
}

/** Validate IDs and order without deleting a malformed prerequisite. */
export function validateStepDependencies(steps, diagnostics) {
  const indices = new Map(steps.map((step, index) => [step.id, index]));
  for (const [index, step] of steps.entries()) for (const dependency of step.dependsOn || []) {
    const prior = indices.get(dependency);
    if (prior === undefined) dependencyError(diagnostics, step, dependency, 'missing');
    else if (prior === index) dependencyError(diagnostics, step, dependency, 'cycle');
    else if (prior > index) dependencyError(diagnostics, step, dependency, 'not-earlier');
  }
}

/** Merging may remove valid internal edges, but must retain evidence of an
 * originally reversed or cyclic edge before any member IDs disappear.
 */
export function validateInternalStepDependencies(steps, diagnostics) {
  const members = new Set(steps.map(step => step.id));
  const internal = steps.map(step => ({ ...step, dependsOn: (step.dependsOn || []).filter(id => members.has(id)) }));
  validateStepDependencies(internal, diagnostics);
}

/** Empty scheduled steps have no remaining physical work. Preserve their
 * prerequisite ancestors; physically merged steps instead resolve to their
 * surviving owner. The graph is captured before any scheduling removes IDs.
 */
export function resolveScheduledStepDependencies(steps, originalDependencies, redirects = new Map(), diagnostics = []) {
  const retained = new Set(steps.map(step => step.id));
  for (const step of steps) {
    const resolve = (dependency, visiting) => {
      if (visiting.has(dependency)) {
        dependencyError(diagnostics, step, dependency, 'cycle');
        return [dependency];
      }
      const next = new Set(visiting); next.add(dependency);
      if (redirects.has(dependency)) return resolve(redirects.get(dependency), next);
      if (retained.has(dependency)) return [dependency];
      if (!originalDependencies.has(dependency)) return [dependency];
      return originalDependencies.get(dependency).flatMap(ancestor => resolve(ancestor, next));
    };
    step.dependsOn = unique((step.dependsOn || []).flatMap(id => resolve(id, new Set([step.id]))));
  }
  validateStepDependencies(steps, diagnostics);
  return steps;
}

/** Group already-validated frame and riser actions into one reading step per layer.
 * Physical operations, dependencies and material instances retain their identities.
 * This runs after scheduling and validation, so no construction action is reordered.
 */
export function consolidateLayerSteps(plan, rowKey) {
  const groups = [], remap = new Map();
  for (const step of plan.steps) {
    const last = groups.at(-1), previous = last?.at(-1);
    const layer = ['frame', 'risers'].includes(step.kind);
    if (layer && previous && ['frame', 'risers'].includes(previous.kind) &&
        step.regionId === previous.regionId && Math.abs(step.y - previous.y) < 0.6 &&
        step.action.type === previous.action.type && !!step.action.detached === !!previous.action.detached) last.push(step);
    else groups.push([step]);
  }
  for (const members of groups) for (const step of members) remap.set(step.id, members[0].id);
  const mapId = id => remap.get(id) || id;
  plan.steps = groups.map(members => {
    if (members.length === 1) return members[0];
    const first = members[0], region = plan.regions.find(r => r.id === first.regionId);
    const merged = { ...first, kind: 'frame',
      title: copy(`${region?.name || first.regionId}：${Math.round(first.y)} cm 本层搭建`, `${region?.name || first.regionId}: build the ${Math.round(first.y)} cm layer`, `${region?.name || first.regionId}: Ebene auf ${Math.round(first.y)} cm bauen`),
      partIds: unique(members.flatMap(s => s.partIds)),
      instructions: unique(members.flatMap(s => s.instructions)),
      interfaceIds: unique(members.flatMap(s => s.interfaceIds)),
      dependsOn: unique(members.flatMap(s => s.dependsOn).map(mapId)).filter(id => id !== first.id),
      operations: members.flatMap(s => s.operations || []),
      detailGroups: members.flatMap(s => s.detailGroups || []),
      parts: {},
      action: { ...first.action, operations: members.flatMap(s => s.action.operations || []),
        modules: members.flatMap(s => s.action.modules || []),
        inPlacePartIds: unique(members.flatMap(s => s.action.inPlacePartIds || (s.action.layer ? [] : s.partIds))) }
    };
    for (const key of ENTITY_KEYS) merged[key] = unique(members.flatMap(s => s[key] || []));
    for (const group of GROUPS) {
      const rows = new Map();
      for (const member of members) for (const row of member.parts[group] || []) {
        const key = rowKey(group, row), existing = rows.get(key);
        if (existing) {
          existing.count += row.count;
          existing.instanceIds = unique([...existing.instanceIds, ...(row.instanceIds || [])]);
          existing.subtotal = Math.round((existing.price || 0) * existing.count * 100) / 100;
        } else rows.set(key, { ...row, instanceIds: [...(row.instanceIds || [])] });
      }
      merged.parts[group] = [...rows.values()]; merged[group] = merged.parts[group];
    }
    for (let i = 0; i < merged.operations.length; i++) merged.operations[i].order = i + 1;
    const operations = new Map(merged.operations.map(op => [op.id, op]));
    for (const detail of merged.detailGroups) {
      const orders = detail.operationIds.map(id => operations.get(id)?.order).filter(Number.isFinite);
      detail.title = copy(`动作 ${orders.join('、')}`, `Actions ${orders.join(', ')}`, `Aktionen ${orders.join(', ')}`);
      detail.operationNumbers = detail.operationIds.map(id => operations.get(id)).filter(Boolean).map(op => ({ id: op.id, order: op.order, partIds: op.partIds }));
    }
    return merged;
  });
  for (const step of plan.steps) step.dependsOn = unique(step.dependsOn.map(mapId)).filter(id => id !== step.id);
  for (const mark of plan.interfaces) if (mark.supportStepId) mark.supportStepId = mapId(mark.supportStepId);
  for (const module of plan.frameModules) if (module.installStepId) module.installStepId = mapId(module.installStepId);
  for (const instance of plan.ledger.instances) instance.stepId = mapId(instance.stepId);
  for (const point of plan.fixingPoints || []) point.stepId = mapId(point.stepId);
  for (const diagnostic of plan.diagnostics) if (diagnostic.details?.stepId) diagnostic.details.stepId = mapId(diagnostic.details.stepId);
  validateStepDependencies(plan.steps, plan.diagnostics);
  if (plan.verification && plan.diagnostics.some(d => d.code === 'INVALID_STEP_DEPENDENCY')) plan.verification.methodChecked = false;
  return plan;
}
