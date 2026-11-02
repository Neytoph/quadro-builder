import { CAROUSEL_BEARING_BACK } from './carouselBearing.js';
import { quatFromBasis, xAxisOf } from './util.js';

export const CAROUSEL_BASE_OFFSET = CAROUSEL_BEARING_BACK + 2.45;
const xyz = n => [n.x, n.y, n.z];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

export function crossBase(model, nodeId) {
  const node = model.nodes.get(nodeId);
  if (!node || node.part || node.bearingOn || node.clampOn || node.c45body) return null;
  const arms = [];
  for (const tube of model.tubes.values()) {
    if (tube.a !== nodeId && tube.b !== nodeId) continue;
    if (tube.bow || tube.arm || tube.link) return null;
    const other = model.nodes.get(tube.a === nodeId ? tube.b : tube.a);
    if (!other) return null;
    const d = xyz(other).map((v, i) => v - xyz(node)[i]), len = Math.hypot(...d);
    if (len < 15 || Math.abs(d[1]) > 0.01) return null;
    arms.push({ tube: tube.id, node: other.id, dir: d.map(v => v / len) });
  }
  if (arms.length !== 4) return null;
  const u = arms[0].dir;
  const opposite = arms.find(a => dot(a.dir, u) < -0.999);
  const side = arms.find(a => Math.abs(dot(a.dir, u)) < 0.001);
  if (!opposite || !side || !arms.some(a => dot(a.dir, side.dir) < -0.999)) return null;
  return { node, arms, u };
}

export function carouselBaseMounts(model) {
  const result = [];
  for (const node of model.nodes.values()) {
    const base = crossBase(model, node.id);
    if (!base || [...model.fittings.values()].some(f => f.kind === 'carousel_bearing' && f.params?.baseNode === node.id)) continue;
    const pos = [node.x, node.y + CAROUSEL_BASE_OFFSET, node.z];
    const rotor = model.findNodeNear(...pos);
    if (rotor) {
      if (rotor.part || rotor.bearingOn || rotor.clampOn || rotor.c45body
        || Math.hypot(...xyz(rotor).map((v, i) => v - pos[i])) > 0.02
        || model._floodNodes(new Set([rotor.id])).has(node.id)) continue;
      const downOccupied = [...model.tubes.values()].some(t => {
        const other = model.nodes.get(t.a === rotor.id ? t.b : t.b === rotor.id ? t.a : null);
        return other && other.y < rotor.y && Math.hypot(other.x - rotor.x, other.z - rotor.z) < 0.1;
      });
      const occupied = [...model.fittings.values()].some(f =>
        (f.kind === 'carousel_bearing' && f.params?.rotorNode === rotor.id)
        || (f.quat && Math.hypot(f.x - rotor.x, f.y - rotor.y, f.z - rotor.z) < 0.02 && xAxisOf(f.quat)[1] < -0.999));
      if (downOccupied || occupied) continue;
    }
    // 方座转45°后，四个安装孔分别位于十字底座的四根管上方。
    const [ux, , uz] = base.u, c = Math.SQRT1_2;
    const y = [(ux - uz) * c, 0, (uz + ux) * c];
    const z = [-y[2], 0, y[0]];
    result.push({ nodeId: node.id, pos, dir: [0, -1, 0], quat: quatFromBasis([0, -1, 0], y, z), handle: pos });
  }
  return result;
}

export function addCarouselBearing(model, mount) {
  const current = carouselBaseMounts(model).find(m => m.nodeId === mount?.nodeId
    && Array.isArray(mount.pos) && Math.hypot(...m.pos.map((v, i) => v - mount.pos[i])) < 0.01);
  if (!current) return null;
  const base = crossBase(model, current.nodeId);
  const existing = model.findNodeNear(...current.pos);
  const rotor = existing || model.addNode(...current.pos);
  // 空节点只保存安装位；选择连接件后才显示并计入清单。
  if (!existing) rotor.unused = true;
  const fitting = model.addFitting('carousel_bearing', ...current.pos, { quat: current.quat, color: '#526b4c' });
  fitting.params = { baseNode: current.nodeId, rotorNode: rotor.id, tieCount: 4 };
  fitting.supportTubes = base.arms.map(a => a.tube);
  return fitting;
}

export function carouselBearingValid(model, fitting) {
  const base = crossBase(model, fitting.params?.baseNode);
  const rotor = model.nodes.get(fitting.params?.rotorNode);
  if (!base || !rotor || !Array.isArray(fitting.supportTubes) || fitting.supportTubes.length !== 4) return false;
  if (!base.arms.every(a => fitting.supportTubes.includes(a.tube))) return false;
  return Math.hypot(rotor.x - fitting.x, rotor.y - fitting.y, rotor.z - fitting.z) < 0.02
    && Math.hypot(rotor.x - base.node.x, rotor.y - base.node.y - CAROUSEL_BASE_OFFSET, rotor.z - base.node.z) < 0.02;
}

export function carouselBearingAtRotor(model, nodeId) {
  return [...model.fittings.values()].find(f => f.kind === 'carousel_bearing' && f.params?.rotorNode === nodeId);
}

export function carouselRotationTargets(model, id) {
  const fitting = model.fittings.get(id);
  if (fitting?.kind !== 'carousel_bearing' || !carouselBearingValid(model, fitting)) return null;
  const branch = model._floodNodes(new Set([fitting.params.rotorNode]));
  if (branch.has(fitting.params.baseNode)) return null;
  const selection = model._selectionOnNodes(branch);
  for (const f of model.fittings.values()) {
    const refs = f.supportTubes || (f.tube ? [f.tube] : []);
    const nearest = refs.length ? null : [...model.nodes.values()].reduce((best, n) =>
      !best || Math.hypot(n.x - f.x, n.y - f.y, n.z - f.z) < Math.hypot(best.x - f.x, best.y - f.y, best.z - f.z) ? n : best, null);
    if (f.id === id || (refs.length && !refs.every(tid => {
      const t = model.tubes.get(tid); return t && branch.has(t.a) && branch.has(t.b);
    })) || (!refs.length && nearest && !branch.has(nearest.id))) selection.delete(f.id);
  }
  const targets = model.moveTargets(selection);
  targets.fittings.delete(id);
  if ([...targets.nodes].some(nid => !branch.has(nid))) return null;
  return { fitting, branch, selection, targets };
}

export function carouselBearingForPick(model, pick) {
  if (!pick?.data) return null;
  for (const f of model.fittings.values()) {
    if (f.kind !== 'carousel_bearing') continue;
    if (pick.data.id === f.id) {
      if (/^ucf209:(inner-race|set-screw)/.test(pick.object?.name || '')) return f.id;
      continue;
    }
    const rotation = carouselRotationTargets(model, f.id);
    if (rotation?.selection.has(pick.data.id)) return f.id;
  }
  return null;
}

export function rotateCarouselBearing(model, id, steps = 1) {
  if (!Number.isFinite(steps)) return false;
  const rotation = carouselRotationTargets(model, id);
  if (!rotation) return false;
  const { fitting, branch, targets } = rotation;
  const before = model.toJSON(), moved = model.tubesAt(branch), collisions = model.collisions({ only: moved });
  const invalid = model._invalidComponents();
  for (const nid of targets.nodes) {
    const node = model.nodes.get(nid);
    if (!node.unused) node.quat ||= [0, 0, 0, 1];
  }
  model._applyTurn(targets, ((steps % 4) + 4) % 4, fitting.x, fitting.z);
  if ([...model.collisions({ only: moved })].some(t => !collisions.has(t))
    || [...model._invalidComponents()].some(p => !invalid.has(p))) {
    model.loadJSON(before);
    return false;
  }
  fitting.params.angle = (((fitting.params.angle || 0) + steps * 90) % 360 + 360) % 360;
  return true;
}
