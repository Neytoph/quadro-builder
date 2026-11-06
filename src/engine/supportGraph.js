import { geometry } from './catalog.js';
import { confirmedSpec } from './componentPack.js';
import { componentMountsValid } from './accessoryPack.js';
import { curvePoint } from './confirmedComponentModel.js';

// 仅用于支撑检查；不写入模型，也不参与刚性组选取、移动或旋转。
export function computeSupportGraph(model) {
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
  const components = [], byNode = new Map();
  for (const start of active) {
    if (byNode.has(start)) continue;
    const nodes = new Set([start]), queue = [start]; byNode.set(start, nodes);
    for (const id of queue) for (const next of adjacency.get(id)) {
      if (nodes.has(next)) continue;
      nodes.add(next); queue.push(next); byNode.set(next, nodes);
    }
    components.push(nodes);
  }
  return { components, byNode, straps };
}
