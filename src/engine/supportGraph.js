import { geometry } from './catalog.js';
import { confirmedSpec } from './componentPack.js';
import { componentMountsValid } from './accessoryPack.js';
import { curvePoint } from './confirmedComponentModel.js';

// 仅用于支撑检查；不写入模型，也不参与刚性组选取、移动或旋转。
export function computeSupportGraph(model, groundLimit) {
  const active = new Set([...model.nodes.values()].filter(n => !n.unused).map(n => n.id));
  const adjacency = new Map([...active].map(id => [id, new Set()]));
  const link = (a, b) => {
    if (!active.has(a) || !active.has(b)) return;
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  };
  // 包括真实接头、45度连接臂及管夹连接，不按空间接近猜测连接关系。
  for (const [a, neighbours] of model._nodeAdj()) for (const b of neighbours) link(a, b);
  const straps = new Set();
  for (const part of model.fittings.values()) {
    if (part.kind !== 'strap' || part.appearanceVersion !== 2 || !componentMountsValid(model, part)) continue;
    const [a, b] = part.mounts.map(m => curvePoint(model, m.tube, m.t));
    // 近距固定参与支撑追踪；远距离绑带仍可建模，不作为两管贴合的依据。
    // 此阈值是几何检查规则，不表示绑带承载能力已验证。
    const maxSpan = geometry().tubeRadius * 2 + confirmedSpec('strap').bandWidth;
    if (!a || !b || Math.hypot(...a.map((v, i) => v - b[i])) > maxSpan + 1e-6) continue;
    const [first, second] = part.supportTubes.map(id => model.tubes.get(id));
    if (![first.a, first.b, second.a, second.b].every(id => active.has(id))) continue;
    link(first.a, second.a); straps.add(part.id);
  }
  const base = connectedComponents(adjacency);
  const suspended = new Set();
  const ropes = new Map();
  for (const part of model.fittings.values()) {
    if (part.kind !== 'rope' || part.appearanceVersion !== 2 || !componentMountsValid(model, part)) continue;
    const ends = part.mounts.map(mount => {
      const tube = model.tubes.get(mount.tube);
      if (!active.has(tube.a) || !active.has(tube.b)) return null;
      return { node: tube.a, height: curvePoint(model, mount.tube, mount.t)[1] };
    });
    if (ends.some(end => !end)) continue;
    const [upper, lower] = ends.sort((a, b) => b.height - a.height);
    if (upper.height <= lower.height + 0.001) continue;
    const upperGroup = base.byNode.get(upper.node), lowerGroup = base.byNode.get(lower.node);
    if (upperGroup === lowerGroup) continue;
    if (!ropes.has(upperGroup)) ropes.set(upperGroup, []);
    ropes.get(upperGroup).push({ upper: upper.node, lower: lower.node, lowerGroup });
  }
  if (!ropes.size) return { ...base, straps, suspended };

  // 只有上端已获得地面支撑的绳索，才能把支撑传给下方的桥架。
  const queue = base.components.filter(group => [...group].some(id => model.nodes.get(id).y <= groundLimit));
  const supported = new Set(queue);
  for (const group of queue) {
    for (const { lowerGroup } of ropes.get(group) || []) {
      if (supported.has(lowerGroup)) continue;
      supported.add(lowerGroup);
      queue.push(lowerGroup);
      for (const id of lowerGroup) suspended.add(id);
    }
  }
  for (const group of queue) {
    for (const { upper, lower } of ropes.get(group) || []) {
      if (suspended.has(lower)) link(upper, lower);
    }
  }
  return { ...connectedComponents(adjacency), straps, suspended };
}

function connectedComponents(adjacency) {
  const components = [], byNode = new Map();
  for (const start of adjacency.keys()) {
    if (byNode.has(start)) continue;
    const nodes = new Set([start]), queue = [start]; byNode.set(start, nodes);
    for (const id of queue) for (const next of adjacency.get(id)) {
      if (nodes.has(next)) continue;
      nodes.add(next); queue.push(next); byNode.set(next, nodes);
    }
    components.push(nodes);
  }
  return { components, byNode };
}
