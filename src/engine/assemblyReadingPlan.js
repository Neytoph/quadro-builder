import { assemblyState } from './assemblyPlan.js';

const meshGroups = ['nodes', 'tubes', 'panels', 'clamps', 'textiles', 'slides', 'fittings'];
const unique = values => [...new Set(values)];
const mean = points => points.length ? [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length) : null;
const finite = point => point?.length === 3 && point.every(Number.isFinite);

export function readingPartCenter(model, id) {
  for (const group of ['nodes', 'clamps', 'slides', 'fittings']) {
    const value = model[group]?.get(id);
    if (value && finite([value.x, value.y, value.z])) return [value.x, value.y, value.z];
  }
  const tube = model.tubes?.get(id);
  if (tube) return mean([model.nodes.get(tube.a), model.nodes.get(tube.b)].filter(Boolean).map(node => [node.x, node.y, node.z]));
  const panel = model.panels?.get(id) || model.textiles?.get(id);
  return panel ? mean(model.panelCorners(panel).filter(finite)) : null;
}

export function readingMaterials(items, allocations) {
  return items.map(item => {
    const rows = allocations.filter(row => row.group === item.kind && row.key === item.ledgerKey);
    return { ...item, count: rows.reduce((sum, row) => sum + row.count, 0), instanceIds: unique(rows.flatMap(row => row.partIds || [])), referenceOnly: false };
  }).filter(item => item.count > 0);
}

const horizontalDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;

/** Spatial areas are reading references. A ledger instance belongs wholly to one area. */
export function partitionReadingLayer(model, partIds, allocations, count = 3) {
  const points = unique(partIds).map(id => ({ id, position: readingPartCenter(model, id) })).filter(row => finite(row.position)).sort((a, b) => a.position[0] - b.position[0] || a.position[2] - b.position[2] || a.id.localeCompare(b.id));
  if (points.length < 2) return [];
  const centers = [[...points[0].position]];
  while (centers.length < Math.min(count, points.length)) {
    const ranked = points.map(row => ({ ...row, distance: Math.min(...centers.map(center => horizontalDistance(row.position, center))) })).sort((a, b) => b.distance - a.distance || a.id.localeCompare(b.id));
    if (!ranked[0].distance) break;
    centers.push([...ranked[0].position]);
  }
  let groups = [];
  for (let iteration = 0; iteration < 16; iteration++) {
    groups = centers.map(() => []);
    for (const point of points) {
      let best = 0;
      for (let index = 1; index < centers.length; index++) if (horizontalDistance(point.position, centers[index]) < horizontalDistance(point.position, centers[best])) best = index;
      groups[best].push(point);
    }
    groups.forEach((group, index) => { if (group.length) centers[index] = mean(group.map(row => row.position)); });
  }
  const areas = groups.filter(group => group.length).map(group => ({ center: mean(group.map(row => row.position)), partIds: group.map(row => row.id), allocations: [] })).sort((a, b) => a.center[0] - b.center[0] || a.center[2] - b.center[2]);
  const pointOwners = new Map(areas.flatMap((area, index) => area.partIds.map(id => [id, index])));
  const parents = allocations.map((_, index) => index);
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const shared = new Map();
  allocations.forEach((row, index) => { for (const id of row.partIds || []) { if (shared.has(id)) parents[find(index)] = find(shared.get(id)); else shared.set(id, index); } });
  const bundles = new Map();
  allocations.forEach((row, index) => { const root = find(index); if (!bundles.has(root)) bundles.set(root, []); bundles.get(root).push(row); });
  for (const rows of bundles.values()) {
    const ids = unique(rows.flatMap(row => row.partIds || []));
    const candidates = ids.map(id => readingPartCenter(model, id)).filter(finite);
    const center = mean(candidates) || areas[0].center;
    const votes = areas.map((_, index) => ids.filter(id => pointOwners.get(id) === index).length);
    let best = 0;
    for (let index = 1; index < areas.length; index++) if (votes[index] > votes[best] || (votes[index] === votes[best] && horizontalDistance(center, areas[index].center) < horizontalDistance(center, areas[best].center))) best = index;
    areas[best].allocations.push(...rows);
  }
  // 无坐标或跨区的完整实例仍归一处；同实体其他区只作灰色参照。
  for (const area of areas) area.partIds = unique(area.allocations.flatMap(row => row.partIds || []));
  return areas.filter(area => area.allocations.length).map((area, index) => ({ ...area, id: `area-${index}`, label: String.fromCharCode(65 + index) }));
}

export function readingLayerNeedsAreas(step, allocations, items) {
  const quantity = allocations.reduce((sum, row) => sum + row.count, 0);
  // 上层实体拥挤程度决定放大，材料种类少或没有面板也适用。
  return step.action?.type === 'build' && !!step.action?.layer && step.y > 0 && quantity >= 32;
}

function readingTitle(step, plan, copy) {
  const region = plan.regions?.find(row => row.id === step.regionId);
  if (step.action?.layer) {
    const title = step.y === 0 ? copy.readingBase : (copy.readingLayer || '{height} cm').replace('{height}', String(step.y));
    const bodies = (plan.regions || []).filter(row => row.kind === 'body');
    return bodies.length > 1 ? `${region?.name || ''} · ${title}` : title;
  }
  return region?.name || step.title || '';
}

/** Pure presentation plan: physical steps, operations, dependencies and ledger stay untouched.
 * @param {any} model
 * @param {any} plan
 * @param {{items?: any[], copy?: Record<string, string>}} [options]
 */
export function createAssemblyReadingPlan(model, plan, { items = [], copy = {} } = {}) {
  const physical = plan.steps || [];
  const rows = (plan.ledger?.instances || []).filter(row => row.group !== 'screws');
  const entries = [];
  const combined = new Map();
  const claimed = new Set();
  for (let index = 0; index < physical.length; index++) {
    const step = physical[index];
    if (step.action?.type !== 'attach') continue;
    const attachedIds = new Set(step.action?.partIds || step.partIds || []);
    const memberIndices = physical.map((candidate, at) => ({ candidate, at })).filter(({ candidate, at }) => at < index && !claimed.has(at) && candidate.regionId === step.regionId && candidate.action?.type === 'preassemble' && ((step.dependsOn || []).includes(candidate.id) || (candidate.action?.partIds || candidate.partIds || []).some(id => attachedIds.has(id)))).map(({ at }) => at);
    if (memberIndices.length) {
      combined.set(index, memberIndices);
      for (const member of memberIndices) { combined.set(member, null); claimed.add(member); }
    }
  }
  for (let index = 0; index < physical.length; index++) {
    if (combined.has(index) && combined.get(index) === null) continue;
    const step = physical[index], sourceIndices = [...(combined.get(index) || []), index];
    const sourceStepIds = sourceIndices.map(at => physical[at].id);
    const allocations = rows.filter(row => sourceStepIds.includes(row.stepId));
    const materials = readingMaterials(items, allocations);
    const partIds = unique(sourceIndices.flatMap(at => physical[at].partIds || []));
    const entry = { id: `reading-${step.id}`, index: entries.length, sourceIndex: index, sourceIndices, sourceStepIds, regionId: step.regionId, kind: combined.get(index)?.length ? 'module' : 'layer', title: readingTitle(step, plan, copy), partIds, allocations, materials, areas: [], interfaceIds: unique(sourceIndices.flatMap(at => physical[at].interfaceIds || [])) };
    if (readingLayerNeedsAreas(step, allocations, materials)) entry.areas = partitionReadingLayer(model, partIds, allocations).map(area => ({ ...area, materials: readingMaterials(items, area.allocations) }));
    entries.push(entry);
  }
  return { steps: entries, canExport: plan.canExport, diagnostics: plan.diagnostics, verification: plan.verification, physicalPlan: plan };
}

/** States are copied for illustrations; no new physical action or consumption is created.
 * @param {any} model
 * @param {any} plan
 * @param {any} entry
 * @param {{area?: any, structure?: boolean, whole?: boolean}} [options]
 */
export function assemblyReadingState(model, plan, entry, { area = null, structure = false, whole = false } = {}) {
  const completed = assemblyState(plan, entry.sourceIndex, { action: false });
  const ids = new Set(area?.partIds || entry.partIds);
  let visible = whole ? new Set(completed.visible) : new Set(ids);
  const includeTube = id => {
    const tube = model.tubes?.get(id);
    if (tube) for (const part of [id, tube.a, tube.b]) if (completed.visible.has(part)) visible.add(part);
  };
  if (area) {
    for (const id of ids) {
      includeTube(id);
      const panel = model.panels?.get(id) || model.textiles?.get(id);
      if (panel) { includeTube(panel.a); includeTube(panel.b); }
    }
    const nodes = new Set([...visible].filter(id => model.nodes.has(id)));
    for (let pass = 0; pass < 3; pass++) for (const [id, tube] of model.tubes) if (completed.visible.has(id) && (tube.arm || tube.link) && (nodes.has(tube.a) || nodes.has(tube.b))) { nodes.add(tube.a); nodes.add(tube.b); includeTube(id); }
    for (const [id, tube] of model.tubes) if (completed.visible.has(id) && (nodes.has(tube.a) || nodes.has(tube.b))) includeTube(id);
  }
  if (structure) visible = new Set([...visible].filter(id => !model.panels?.has(id) && !model.textiles?.has(id)));
  const current = new Set([...ids].filter(id => visible.has(id)));
  return { ...completed, visible, current, done: new Set([...visible].filter(id => !current.has(id))), arrows: [], operationNumbers: [], interfaceMarks: [], fixingPoints: [] };
}

export function readingModuleDirection(model, plan, entry) {
  const moduleCenter = mean(entry.partIds.map(id => readingPartCenter(model, id)).filter(finite));
  const other = meshGroups.flatMap(group => [...(model[group]?.keys() || [])]).filter(id => !entry.partIds.includes(id));
  const bodyCenter = mean(other.map(id => readingPartCenter(model, id)).filter(finite));
  if (!moduleCenter || !bodyCenter) return [1, .75, 1];
  const dx = moduleCenter[0] - bodyCenter[0], dz = moduleCenter[2] - bodyCenter[2];
  return [Math.abs(dx) < 1 ? 1 : Math.sign(dx), .75, Math.abs(dz) < 1 ? 1 : Math.sign(dz)];
}
