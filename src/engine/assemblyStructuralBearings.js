import { xAxisOf, yAxisOf } from './util.js';

const xyz = n => [n.x, n.y, n.z];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const unit = a => a.map(v => v / Math.hypot(...a));
const near = (a, b) => Math.hypot(...sub(a, b)) < .01;

// 原生 bearingOn 确认插口，clampOn 确认穿孔中的连续直管。
export function structuralBearingSupport(model, fitting) {
  const invalid = { valid: false, supportIds: [], basis: 'structural-bearing-binding-unresolved' };
  if (fitting.kind !== 'bearing-connector4' || fitting.quat?.length !== 4 || !fitting.quat.every(Number.isFinite) || Math.abs(Math.hypot(...fitting.quat) - 1) > .001) return invalid;
  const held = [...model.nodes.values()].filter(n => n.bearingOn === fitting.id);
  if (held.length !== 1) return invalid;
  const node = held[0], q = unit(fitting.quat), direction = xAxisOf(q), shaftAxis = yAxisOf(q);
  if (!node.stub || !near(node.stub, direction.map(v => -v)) || !near(xyz(fitting), xyz(node).map((v, i) => v + 10 * direction[i]))) return invalid;
  const tube = model.tubes.get(node.clampOn?.tubeId);
  if (!tube || tube.arm || tube.link || tube.bow) return invalid;
  const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
  if (!a || !b) return invalid;
  const span = sub(xyz(b), xyz(a)), length = Math.hypot(...span), axis = unit(span), along = dot(sub(xyz(fitting), xyz(a)), axis);
  if (!Number.isFinite(tube.length) || Math.abs(length - tube.length - 5) > .05) return invalid;
  if (tube.geom) {
    const { p0, dir, len, pad = 0 } = tube.geom;
    if (!p0 || !dir || !Number.isFinite(len) || !Number.isFinite(pad)) return invalid;
    const end = p0.map((v, i) => v + dir[i] * (len + pad + 5));
    if (!(near(p0, xyz(a)) && near(end, xyz(b))) && !(near(p0, xyz(b)) && near(end, xyz(a)))) return invalid;
  }
  if (Math.abs(dot(shaftAxis, axis)) < .999999 || !near(xyz(fitting), xyz(a).map((v, i) => v + along * axis[i])) || along < 7.5 || along > length - 7.5 || !Number.isFinite(node.clampOn.t) || Math.abs(node.clampOn.t - along) > .05) return invalid;
  const nodes = new Map(model.nodes), fittings = new Map(model.fittings);
  nodes.set(node.id, { ...node, bearingOn: null, clampOn: null }); fittings.delete(fitting.id);
  const virtual = Object.assign(Object.create(Object.getPrototypeOf(model)), model, { nodes, fittings });
  if (!virtual.bearingArmMounts().some(m => m.nodeId === node.id && near(m.dir, direction) && near(m.pos, xyz(fitting)))) return invalid;
  return { valid: true, supportIds: [node.id], carrierId: tube.id, shaftAxis: axis, basis: 'native-bearingOn-free-port-and-clampOn-continuous-shaft', mount: { position: xyz(fitting), direction } };
}
