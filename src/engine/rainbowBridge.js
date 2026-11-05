// 世界坐标中求静态悬链线；与渲染、存档共用同一组管子和绳索位置。
export const BRIDGE_DEFAULTS = Object.freeze({ count: 7, tubeLength: 35, gap: 1, sag: 12 });
export const BRIDGE_LIMITS = Object.freeze({ count: [2, 60], tubeLength: [10, 150], gap: [0, 50], sag: [0, 300] });
export const BRIDGE_RADIUS = 2.45;

/** @param {Record<string, unknown> | null} [value] */
export function bridgeParams(value = {}) {
  value = value || {};
  const out = { ...BRIDGE_DEFAULTS };
  for (const [key, [lo, hi]] of Object.entries(BRIDGE_LIMITS)) {
    const n = value[key] === null || value[key] === undefined ? BRIDGE_DEFAULTS[key] : Number(value[key]);
    out[key] = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : BRIDGE_DEFAULTS[key];
  }
  out.count = Math.round(out.count);
  return out;
}

/** @param {number[]} a @param {number[]} b @param {number} t */
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
/** @param {number[]} p @param {number[]} dir @param {number} amount */
const shifted = (p, dir, amount) => p.map((v, i) => v + dir[i] * amount);

// 用中点相对弦线的垂距求悬链线；竖直两端采用悬绳折返的极限情况。
export function hangingCurve(a, b, sag) {
  const h = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const dy = b[1] - a[1];
  if (sag < 1e-6) return t => lerp(a, b, t);
  if (h < 1e-5) return t => {
    const p = lerp(a, b, t);
    p[1] -= 4 * sag * t * (1 - t);
    return p;
  };
  const terms = k => {
    const scale = h / (2 * k);
    const shift = Math.asinh(dy / (2 * scale * Math.sinh(k)));
    return { scale, shift, drop: scale * Math.cosh(shift) * (Math.cosh(k) - 1) };
  };
  let lo = 1e-5, hi = 24;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (terms(mid).drop < sag) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const { scale, shift } = terms(k);
  const base = Math.cosh(shift - k);
  return t => {
    if (t === 0) return [...a];
    if (t === 1) return [...b];
    const p = lerp(a, b, t);
    p[1] = a[1] + scale * (Math.cosh((2 * t - 1) * k + shift) - base);
    return p;
  };
}

function sampleCurve(curve) {
  const samples = Array.from({ length: 193 }, (_, i) => ({ t: i / 192, p: curve(i / 192), s: 0 }));
  for (let i = 1; i < samples.length; i++) samples[i].s = samples[i - 1].s + distance(samples[i].p, samples[i - 1].p);
  return samples;
}

export function bridgeShape(model, tx) {
  const ra = model._rail(tx.a), rb = model._rail(tx.b);
  if (!ra || !rb || tx.a === tx.b) return null;
  const params = bridgeParams(tx.bridge);
  const a = shifted(ra.p0, ra.dir, ra.len / 2);
  const b = shifted(rb.p0, rb.dir, rb.len / 2);
  if (distance(a, b) < 1e-4) return null;
  const sign = ra.dir.reduce((s, v, i) => s + v * rb.dir[i], 0) < 0 ? -1 : 1;
  const dirB = rb.dir.map(v => v * sign);
  const count = params.count;
  const minimum = (count + 1) * (2 * BRIDGE_RADIUS + params.gap);
  let sag = params.sag;
  let curve = hangingCurve(a, b, sag), samples = sampleCurve(curve);
  if (samples.at(-1).s < minimum) {
    let lo = sag, hi = Math.max(minimum, sag + 1);
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (sampleCurve(hangingCurve(a, b, mid)).at(-1).s < minimum) lo = mid; else hi = mid;
    }
    sag = hi;
    curve = hangingCurve(a, b, sag);
    samples = sampleCurve(curve);
  }
  const atLength = fraction => {
    const s = fraction * samples.at(-1).s;
    const i = Math.max(1, samples.findIndex(sample => sample.s >= s));
    const prev = samples[i - 1], next = samples[i];
    return prev.t + (next.t - prev.t) * (s - prev.s) / (next.s - prev.s || 1);
  };
  const rungs = [];
  for (let i = 0; i < count; i++) {
    const t = atLength((i + 1) / (count + 1));
    const dir = lerp(ra.dir, dirB, t);
    const len = Math.hypot(...dir);
    rungs.push({ center: curve(t), dir: dir.map(v => v / len), length: params.tubeLength, t, colorIndex: i });
  }
  const endA = { center: a, dir: ra.dir, length: Math.max(1, ra.len - 5) };
  const endB = { center: b, dir: dirB, length: Math.max(1, rb.len - 5) };
  const all = [endA, ...rungs, endB];
  const ropes = [-1, 1].map(side => all.map(rung => shifted(rung.center, rung.dir, side * Math.max(0.5, rung.length / 2 - 3))));
  return { params, rungs, ropes, sag, corners: [ropes[0][0], ropes[1][0], ropes[1][ropes[1].length - 1], ropes[0][ropes[0].length - 1]] };
}

export function bridgeExtentPoints(shape) {
  if (!shape) return [];
  return shape.rungs.flatMap(rung => [-1, 1].flatMap(side => {
    const end = shifted(rung.center, rung.dir, side * rung.length / 2);
    return [end.map(v => v - BRIDGE_RADIUS), end.map(v => v + BRIDGE_RADIUS)];
  })).concat(shape.ropes.flat());
}
