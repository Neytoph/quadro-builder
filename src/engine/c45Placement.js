import mesh from './c45Mesh.json';
import { c45Frame, c45FrameFor } from './c45Pose.js';
import { assemblyShapesOverlap } from './assemblyCollision.js';

const xyz = node => [node.x, node.y, node.z];
const localTriangles = Array.from({ length: mesh.idx.length / 3 }, (_, i) =>
  mesh.idx.slice(i * 3, i * 3 + 3).map(index => mesh.pos.slice(index * 3, index * 3 + 3)));
const boundsOf = points => [0, 1, 2].map(i => [Math.min(...points.map(p => p[i])), Math.max(...points.map(p => p[i]))]);
const overlapBounds = (a, b) => a.every(([lo, hi], i) => hi > b[i][0] + 1e-6 && b[i][1] > lo + 1e-6);

function placedMesh(base, frame) {
  const origin = xyz(base);
  const triangles = localTriangles.map(points => {
    const world = points.map(point => origin.map((value, i) => value + point.reduce((sum, v, k) => sum + v * frame[k][i], 0)));
    return { kind: 'triangle', points: world, bounds: boundsOf(world) };
  });
  return { triangles, bounds: boundsOf(triangles.flatMap(t => t.points)) };
}

function meshesOverlap(a, b) {
  if (!overlapBounds(a.bounds, b.bounds)) return false;
  return a.triangles.some(left => b.triangles.some(right =>
    overlapBounds(left.bounds, right.bounds) && assemblyShapesOverlap(left, right)));
}

/** 比较真实45°件外形；不修改模型，不把共用基座当作碰撞。 */
export function c45CollisionContext(model) {
  const adapters = new Map();
  for (const tube of model.tubes.values()) {
    if (!tube.arm) continue;
    const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
    if (a?.c45body && b) adapters.set(a.id, { base: b, body: a });
    if (b?.c45body && a) adapters.set(b.id, { base: a, body: b });
  }
  const carriers = new Set([...adapters.values()].map(adapter => adapter.base.id));
  for (const node of model.nodes.values()) {
    if (node.c45file && !node.c45body && !carriers.has(node.id)) adapters.set(node.id, { base: node, body: null });
  }
  return adapters;
}

export function c45PlacementBlocked(model, base, body, context = c45CollisionContext(model)) {
  const frame = c45Frame(base, body);
  if (!frame) return true;
  let candidate;
  for (const [id, adapter] of context) {
    if (id === body.id) continue;
    // 原厂45°件距基座不超过15cm，远处零件无需展开三角面。
    if (Math.hypot(...xyz(base).map((value, i) => value - xyz(adapter.base)[i])) > 30) continue;
    const otherFrame = c45FrameFor(model, adapter.base, adapter.body);
    if (!otherFrame) continue;
    candidate ||= placedMesh(base, frame);
    adapter.mesh ||= placedMesh(adapter.base, otherFrame);
    if (meshesOverlap(candidate, adapter.mesh)) return true;
  }
  return false;
}
