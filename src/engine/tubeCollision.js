import { MERGE_EPS } from './config.js';

// 圆弧用短线段逼近；每段弦与真圆弧相差不超过 0.005 cm。
const ARC_ERROR = 0.005;
const TINY = 1e-9;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const distance2 = (a, b) => dot(sub(a, b), sub(a, b));
const clamp = (v) => Math.max(0, Math.min(1, v));
const at = (a, d, t) => ({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });

export function tubePath(a, b, tube = {}) {
  let points = [a, b], center = null;
  if (tube.bow && tube.bowCenter) {
    const [x, y, z] = tube.bowCenter;
    const c = { x, y, z }, u = sub(a, c), v = sub(b, c);
    const ra = Math.hypot(u.x, u.y, u.z), rb = Math.hypot(v.x, v.y, v.z);
    if (ra > 1e-3 && rb > 1e-3) {
      for (const axis of ['x', 'y', 'z']) { u[axis] /= ra; v[axis] /= rb; }
      const cosine = Math.max(-1, Math.min(1, dot(u, v)));
      const w = { x: v.x - u.x * cosine, y: v.y - u.y * cosine, z: v.z - u.z * cosine };
      const sin = Math.hypot(w.x, w.y, w.z);
      // 与场景绘制一致：退化弯管按直管处理。
      if (sin * sin >= 1e-6) {
        for (const axis of ['x', 'y', 'z']) w[axis] /= sin;
        const radius = (ra + rb) / 2, angle = Math.acos(cosine);
        const step = 2 * Math.acos(Math.max(-1, 1 - ARC_ERROR / radius));
        const count = Math.max(1, Math.ceil(angle / step));
        points = Array.from({ length: count + 1 }, (_, i) => {
          const theta = angle * i / count, co = radius * Math.cos(theta), si = radius * Math.sin(theta);
          return { x: x + u.x * co + w.x * si, y: y + u.y * co + w.y * si, z: z + u.z * co + w.z * si };
        });
        center = c;
      }
    }
  }
  const lo = ['x', 'y', 'z'].map(axis => Math.min(...points.map(p => p[axis])));
  const hi = ['x', 'y', 'z'].map(axis => Math.max(...points.map(p => p[axis])));
  const segments = points.slice(1).map((b, i) => ({
    a: points[i], b,
    lo: ['x', 'y', 'z'].map(axis => Math.min(points[i][axis], b[axis])),
    hi: ['x', 'y', 'z'].map(axis => Math.max(points[i][axis], b[axis])),
  }));
  return { points, center, lo, hi, segments };
}

export function tubePathsCoincide(p, q) {
  const eps2 = MERGE_EPS ** 2;
  const [a, b] = [p.points[0], p.points.at(-1)], [c, d] = [q.points[0], q.points.at(-1)];
  return !!p.center === !!q.center
    && (!p.center || distance2(p.center, q.center) <= eps2)
    && ((distance2(a, c) <= eps2 && distance2(b, d) <= eps2)
      || (distance2(a, d) <= eps2 && distance2(b, c) <= eps2));
}

// 两条有限线段的最近点，分别夹紧两个参数，覆盖端点对内部的 T 形相交。
function closest(p, q) {
  const d = sub(p.b, p.a), e = sub(q.b, q.a), r = sub(p.a, q.a);
  const dd = dot(d, d), ee = dot(e, e), de = dot(d, e), dr = dot(d, r), er = dot(e, r);
  let s = 0, t = 0;
  if (dd <= TINY) t = ee <= TINY ? 0 : clamp(er / ee);
  else if (ee <= TINY) s = clamp(-dr / dd);
  else {
    const denominator = dd * ee - de * de;
    s = denominator > TINY ? clamp((de * er - dr * ee) / denominator) : 0;
    t = (de * s + er) / ee;
    if (t < 0) { t = 0; s = clamp(-dr / dd); }
    else if (t > 1) { t = 1; s = clamp((de - dr) / dd); }
  }
  return { s, t, p: at(p.a, d, s), q: at(q.a, e, t) };
}

function boxesTouch(p, q) {
  return p.lo.every((v, i) => v - MERGE_EPS <= q.hi[i] && q.lo[i] - MERGE_EPS <= p.hi[i]);
}

// 分段点仍属于同一根管；只接受整条路径上的局部最近点，避免把接头
// 附近相互远离的两个分段误判为穿管。
function localMinimum(path, i, t, p, q) {
  let vertex = -1;
  if (t < TINY) vertex = i;
  else if (t > 1 - TINY) vertex = i + 1;
  if (vertex < 0) return true;
  const diff = sub(p, q);
  for (const next of [vertex - 1, vertex + 1]) {
    if (path.points[next] && dot(diff, sub(path.points[next], p)) < -TINY) return false;
  }
  return true;
}

function atEnd(path, p) {
  return distance2(p, path.points[0]) <= MERGE_EPS ** 2
    || distance2(p, path.points.at(-1)) <= MERGE_EPS ** 2;
}

export function tubePathsCross(p, q) {
  if (!boxesTouch(p, q)) return false;
  for (let i = 0; i < p.segments.length; i++) {
    for (let j = 0; j < q.segments.length; j++) {
      if (!boxesTouch(p.segments[i], q.segments[j])) continue;
      const hit = closest(p.segments[i], q.segments[j]);
      if (distance2(hit.p, hit.q) > MERGE_EPS ** 2) continue;
      if (atEnd(p, hit.p) && atEnd(q, hit.q)) continue;
      if (localMinimum(p, i, hit.s, hit.p, hit.q) && localMinimum(q, j, hit.t, hit.q, hit.p)) return true;
    }
  }
  return false;
}
