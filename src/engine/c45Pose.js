import { xAxisOf, yAxisOf, zAxisOf } from './util.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const unit = v => { const length = Math.hypot(...v); return length > 1e-8 ? v.map(value => value / length) : null; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 独立45°件各自推导朝向；旧文件中没有独立本体的件保留原姿态。
export function c45Frame(base, body = null) {
  if (!body) {
    const q = base.c45quat;
    const length = q?.length === 4 ? Math.hypot(...q) : 0;
    if (length < 1e-8) return null;
    const normalized = q.map(value => value / length);
    return [xAxisOf(normalized), yAxisOf(normalized), zAxisOf(normalized)];
  }
  const ex = unit(body.c45axis || base.c45axis || []);
  if (!ex) return null;
  const span = [body.x - base.x, body.y - base.y, body.z - base.z];
  const along = dot(span, ex);
  const ey = unit(span.map((value, i) => value - ex[i] * along));
  return ey ? [ex, ey, cross(ex, ey)] : null;
}

export function c45FrameFor(model, base, body) {
  // 旧导入件的精确姿态保存在唯一基座上；多个件不能共用该姿态。
  if (body && !body.c45quat && base.c45quat) {
    const bodies = [...model.tubes.values()].filter(t => t.arm && (t.a === base.id || t.b === base.id))
      .map(t => model.nodes.get(t.a === base.id ? t.b : t.a)).filter(node => node?.c45body);
    if (bodies.length === 1 && bodies[0].id === body.id) return c45Frame(base);
  }
  return c45Frame(base, body);
}
