import { quatFromBasis, xAxisOf } from './util.js';

export const REINFORCEMENT_SPECS = {
  reinforce35: { length: 35, span: 40 },
  reinforce55: { length: 55, span: 60 },
  reinforce80: { length: 75, span: 80 },
};
export const ALUMINIUM_CONNECTOR = 'alu_connector';
export const isAluminiumConnector = part => part?.kind === 'alu-connector2';
const xyz = p => [p.x, p.y, p.z];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = d => d.map(v => v / (Math.hypot(...d) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function reinforcementPaths(model, firstId, partId = 'reinforce80') {
  const spec = REINFORCEMENT_SPECS[partId], first = model.tubes.get(firstId);
  if (!spec || !first || first.arm || first.link || first.bow || first.reinforced) return [];
  const results = [], seen = new Set();
  for (const start of [first.a, first.b]) {
    const end = first.a === start ? first.b : first.a;
    const axis = norm(sub(xyz(model.nodes.get(end)), xyz(model.nodes.get(start))));
    const walk = (ids, at, length) => {
      if (Math.abs(length - spec.span) < 0.6) {
        const key = [...ids].sort().join('|');
        if (!seen.has(key)) { seen.add(key); results.push({ tubeIds: ids, start, end: at, span: spec.span }); }
        return;
      }
      if (length > spec.span + 0.6) return;
      for (const tube of model.tubes.values()) {
        if (ids.includes(tube.id) || tube.reinforced || tube.arm || tube.link || tube.bow) continue;
        if (tube.a !== at && tube.b !== at) continue;
        const next = tube.a === at ? tube.b : tube.a;
        const delta = sub(xyz(model.nodes.get(next)), xyz(model.nodes.get(at)));
        if (dot(norm(delta), axis) < 0.999) continue;
        walk([...ids, tube.id], next, length + Math.hypot(...delta));
      }
    };
    walk([firstId], end, model.tubeSpan(first));
  }
  return results;
}

export function explicitReinforcementGroups(model) {
  const groups = new Map();
  for (const tube of model.tubes.values()) {
    if (!tube.reinforced || !tube.reinforcement || !REINFORCEMENT_SPECS[tube.reinforcement.partId]) continue;
    const key = tube.reinforcement.group;
    if (!groups.has(key)) groups.set(key, { key, partId: tube.reinforcement.partId, tubeIds: [] });
    groups.get(key).tubeIds.push(tube.id);
  }
  return [...groups.values()];
}

export function validReinforcementRecords(nodes, tubes) {
  const view = { nodes: new Map(nodes.map(node => [node.id, node])), tubes: new Map(),
    tubeSpan: tube => {
      const a = view.nodes.get(tube.a), b = view.nodes.get(tube.b);
      return a && b ? Math.hypot(...sub(xyz(a), xyz(b))) : NaN;
    } };
  const groups = new Map();
  for (const tube of tubes) if (tube.reinforcement != null) {
    const record = tube.reinforcement;
    if (!tube.reinforced || !REINFORCEMENT_SPECS[record.partId] || typeof record.group !== 'string') return false;
    if (!view.nodes.has(tube.a) || !view.nodes.has(tube.b)) return false;
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(tube);
  }
  for (const [key, list] of groups) {
    const partId = list[0].reinforcement.partId;
    if (!list.some(tube => tube.id === key) || list.some(tube => tube.reinforcement.partId !== partId)) return false;
    view.tubes = new Map(list.map(tube => [tube.id, { ...tube, reinforced: false }]));
    if (!reinforcementPaths(view, list[0].id, partId).some(path => path.tubeIds.length === list.length)) return false;
  }
  return true;
}

export function aluminiumConnectorMounts(model, includeOccupied = false) {
  const ends = new Map();
  for (const group of explicitReinforcementGroups(model)) {
    const degree = new Map();
    for (const id of group.tubeIds) for (const node of [model.tubes.get(id).a, model.tubes.get(id).b]) degree.set(node, (degree.get(node) || 0) + 1);
    for (const [id, count] of degree) {
      if (count !== 1) continue;
      const tube = group.tubeIds.map(id => model.tubes.get(id)).find(t => t.a === id || t.b === id);
      const other = tube.a === id ? tube.b : tube.a;
      const direction = norm(sub(xyz(model.nodes.get(other)), xyz(model.nodes.get(id))));
      if (!ends.has(id)) ends.set(id, []);
      ends.get(id).push({ group, direction });
    }
  }
  const mounts = [];
  for (const [nodeId, list] of ends) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (list[a].group.key === list[b].group.key || dot(list[a].direction, list[b].direction) > -0.999) continue;
      const node = model.nodes.get(nodeId);
      const dominant = list[a].direction.find(v => Math.abs(v) > 0.001);
      const dir = list[a].direction.map(v => v * (dominant < 0 ? -1 : 1));
      const up = Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      const ey = norm(up.map((v, i) => v - dir[i] * dot(up, dir)));
      const pos = xyz(node).map((v, i) => v - dir[i] * 20);
      const occupied = [...model.fittings.values()].some(f => {
        if (!isAluminiumConnector(f)) return false;
        const axis = xAxisOf(f.quat || [0, 0, 0, 1]);
        const center = xyz(f).map((v, i) => v + axis[i] * (f.w || 40) / 2);
        return Math.hypot(...sub(center, xyz(node))) < 0.6;
      });
      if (!includeOccupied && occupied) continue;
      mounts.push({ nodeId, pos, dir, quat: quatFromBasis(dir, ey, cross(dir, ey)),
        supportTubes: [...new Set([...list[a].group.tubeIds, ...list[b].group.tubeIds])] });
    }
  }
  return mounts;
}

export function aluminiumConnectorSupport(model, fitting) {
  const axis = xAxisOf(fitting.quat || [0, 0, 0, 1]);
  const center = xyz(fitting).map((v, i) => v + axis[i] * (fitting.w || 40) / 2);
  const mount = aluminiumConnectorMounts(model, true).find(mount =>
    Math.hypot(...sub(xyz(model.nodes.get(mount.nodeId)), center)) < 0.6 && Math.abs(dot(mount.dir, axis)) > 0.999);
  return mount ? { ...mount, pos: xyz(fitting), dir: axis } : null;
}
