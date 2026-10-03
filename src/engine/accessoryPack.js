import { quatFromBasis, xAxisOf, yAxisOf, zAxisOf } from './util.js';
import { CONFIRMED_COMPONENTS, CONFIRMED_PANEL_IDS, CONFIRMED_FITTING_IDS, confirmedSpec } from './componentPack.js';
import { confirmedCandidates, confirmedPanelDiagnostics, confirmedStructuralValid, confirmedFrame, confirmedVolumes, curvePoint, ropeCandidate, trampolineCandidate } from './confirmedComponentModel.js';
import { INSET_MOUNT_LAYOUT, hasInsetScrews, oppositeScrewSupports, insetFrameTubeIds, insetScrewVolumes, insetPanelReference } from './insetPanelMounts.js';

export const ACCESSORY_PACK = [
  { id: 'steering_wheel', name: '方向盘', name_en: 'Steering wheel', name_de: 'Lenkrad', placement: 'fitting', mount: 'horizontal', diameter: 24, clampSpacing: 8, shaft: 8, width: 24, drop: 0 },
  { id: 'swing', name: '秋千', name_en: 'Swing', name_de: 'Schaukel', placement: 'fitting', mount: 'horizontal', drop: 48, width: 28, depth: 15, hangerSpacing: 22 },
  { id: 'gym_rings', name: '吊环', name_en: 'Gym rings', name_de: 'Turnringe', placement: 'fitting', mount: 'horizontal', drop: 40, width: 30 },
];
export const PANEL_COMPONENT_PACK = [
  { id: 'panel_40x40_busy', name: '忙碌板', name_en: 'Busy board', name_de: 'Motoriktafel', placement: 'panel', mount: 'vertical-frame', width: 40, height: 40, depth: 6, mountLayout:INSET_MOUNT_LAYOUT, kitContents:['component','transparent-screw-4'] },
  { id: 'panel_40x40_pocket', name: '布兜', name_en: 'Fabric pocket', name_de: 'Stofftasche', placement: 'panel', mount: 'horizontal-frame', width: 40, height: 40, depth: 25 },
];
export const BUILDER_COMPONENT_PACK = [...ACCESSORY_PACK, ...PANEL_COMPONENT_PACK, ...CONFIRMED_COMPONENTS];
export const ACCESSORY_IDS = new Set([...ACCESSORY_PACK.map(part => part.id), ...CONFIRMED_FITTING_IDS]);
export const PANEL_ACCESSORY_IDS = new Set([...PANEL_COMPONENT_PACK.map(part => part.id), ...CONFIRMED_PANEL_IDS]);
export const APPEARANCE_VERSION = 1;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
const point = n => [n.x, n.y, n.z];
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const at = (frame, p) => frame.pos.map((v, i) => v + frame.axes.reduce((n, a, k) => n + a[i] * p[k], 0));
const invalid = reason => ({ valid: false, reason, mounts: [], supportTubes: [] });

export function accessorySpec(kind) {
  if (confirmedSpec(kind)) return confirmedSpec(kind);
  const spec = [...ACCESSORY_PACK, ...PANEL_COMPONENT_PACK].find(part => part.id === kind);
  if (!spec) throw new Error(`未知配件：${kind}`);
  return spec;
}

export function mountPoint(model, mount) {
  if (!mount || typeof mount !== 'object') return null;
  if (model.tubes.get(mount.tube)?.bow) return curvePoint(model, mount.tube, mount.t);
  const tube = model.tubes.get(mount.tube);
  const a = tube && model.nodes.get(tube.a), b = tube && model.nodes.get(tube.b);
  if (!a || !b || !Number.isFinite(mount.t)) return null;
  return [a.x, a.y, a.z].map((v, i) => v + ([b.x, b.y, b.z][i] - v) * mount.t);
}

export function componentFrame(model, part) {
  if(part.kind==='multi-wheel2') {
    if(![part.x,part.y,part.z].every(Number.isFinite))return null;
    const q=part.quat || [0,0,0,1];
    if(!Array.isArray(q) || q.length!==4 || !q.every(Number.isFinite) || Math.abs(Math.hypot(...q)-1)>.001)return null;
    return {pos:[part.x,part.y,part.z],axes:[xAxisOf(q),yAxisOf(q),zAxisOf(q)],quat:q};
  }
  if (part.appearanceVersion === 2) return confirmedFrame(model, part);
  if (ACCESSORY_IDS.has(part.kind)) {
    const tube = model.tubes.get(part.tube);
    const a = tube && model.nodes.get(tube.a), b = tube && model.nodes.get(tube.b);
    if (!a || !b) return null;
    if (![part.x, part.y, part.z, a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return null;
    if ((part.appearanceVersion || part.quat) && (!Array.isArray(part.quat) || part.quat.length !== 4 || !part.quat.every(Number.isFinite) || Math.abs(Math.hypot(...part.quat) - 1) > 0.001)) return null;
    const axes = part.quat ? [xAxisOf(part.quat), yAxisOf(part.quat), zAxisOf(part.quat)]
      : (() => { const x = unit(sub(point(b), point(a))), y = [0, 1, 0]; return [x, y, cross(x, y)]; })();
    return { pos: [part.x, part.y, part.z], axes, quat: quatFromBasis(...axes) };
  }
  const c = model.panelCorners(part);
  if (!c || c.some(p => !p.every(Number.isFinite)) || Math.hypot(...sub(c[1], c[0])) < 0.01 || Math.hypot(...sub(c[3], c[0])) < 0.01) return null;
  const pos = c[0].map((_, i) => c.reduce((n, p) => n + p[i], 0) / 4);
  const e = unit(sub(c[1], c[0])), v = unit(sub(c[3], c[0]));
  if (part.panelId === 'panel_40x40_pocket') {
    const x = Math.abs(e[1]) < 0.01 ? e : v;
    const y = [0, 1, 0], z = cross(x, y);
    return { pos, axes: [x, y, z], quat: quatFromBasis(x, y, z) };
  }
  const x = Math.abs(e[1]) < 0.01 ? e : v;
  const y = [0, 1, 0];
  let z = cross(x, y);
  if ((part.side || 1) < 0) z = z.map(n => -n);
  const xx = cross(y, z);
  return { pos, axes: [xx, y, z], quat: quatFromBasis(xx, y, z) };
}

function volume(frame, lo, hi) {
  const center = mid(lo, hi);
  return { pos: at(frame, center), axes: frame.axes, half: hi.map((n, i) => (n - lo[i]) / 2) };
}

export function componentVolumes(model, part, { sweep = false } = {}) {
  // 原生抓取网格为7.5×30.2×30.2cm；保持原配件空间检查的保守4cm轴向半厚度。
  if(part.kind==='multi-wheel2'){const frame=componentFrame(model,part);return frame?[volume(frame,[-4,-15.1,-15.1],[4,15.1,15.1])]:[];}
  if (part.appearanceVersion === 2) return confirmedVolumes(model, part);
  const frame = componentFrame(model, part);
  if (!frame) return [];
  const kind = part.kind || part.panelId;
  if (kind === 'steering_wheel') return [
    volume(frame, [-12, -12, 5], [12, 12, 11.7]),
    volume(frame, [-5.25, -3.6, 2], [5.25, 3.6, 4.4]),
    volume(frame, [-1.45, -1.45, 3.4], [1.45, 1.45, 9]),
  ];
  if (kind === 'panel_40x40_busy') return [volume(frame, [-17.5, -17.5, -1], [17.5, 17.5, 6]), ...(hasInsetScrews(part)?insetScrewVolumes(model,part,frame):[])];
  if (kind === 'panel_40x40_pocket') return [volume(frame, [-17.5, -27, -17.5], [17.5, -1, 17.5])];
  const spec = accessorySpec(kind), drop = part.params?.drop || spec.drop;
  if (kind === 'gym_rings') return [volume(frame, [-15, -drop, -2], [15, -5, 2])];
  const out = [];
  for (const angle of sweep ? Array.from({ length: 31 }, (_, i) => -30 + i * 2) : [0]) {
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const axes = [frame.axes[0], frame.axes[1].map((n, i) => n * c + frame.axes[2][i] * s), frame.axes[2].map((n, i) => n * c - frame.axes[1][i] * s)];
    const swung = { ...frame, axes };
    out.push(volume(swung, [-14, -drop - 1.8, -7.5], [14, -drop + 3, 7.5]));
    for (const x of [-11, 11]) out.push(volume(swung, [x - 0.6, -drop + 3, -0.6], [x + 0.6, -4, 0.6]));
  }
  return out;
}

function segmentHits(box, a, b, radius = 2.45) {
  const p = sub(a, box.pos), q = sub(b, box.pos);
  let lo = 0, hi = 1;
  for (let i = 0; i < 3; i++) {
    const start = dot(p, box.axes[i]), d = dot(sub(q, p), box.axes[i]), half = box.half[i] + radius;
    if (Math.abs(d) < 1e-8) { if (Math.abs(start) >= half) return false; continue; }
    const t0 = (-half - start) / d, t1 = (half - start) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (hi <= lo) return false;
  }
  return true;
}

function boxesOverlap(a, b) {
  const delta = sub(b.pos, a.pos);
  for (const axis of [...a.axes, ...b.axes, ...a.axes.flatMap(x => b.axes.map(y => cross(x, y)))]) {
    if (Math.hypot(...axis) < 1e-7) continue;
    const ra = a.axes.reduce((n, x, i) => n + Math.abs(dot(x, axis)) * a.half[i], 0);
    const rb = b.axes.reduce((n, x, i) => n + Math.abs(dot(x, axis)) * b.half[i], 0);
    if (Math.abs(dot(delta, axis)) >= ra + rb - 0.01) return false;
  }
  return true;
}

function panelVolume(model, panel) {
  const c = model.panelCorners(panel);
  if (!c) return [];
  const x = sub(c[1], c[0]), z = sub(c[3], c[0]), nx = unit(x), nz = unit(z), y = unit(cross(nz, nx));
  return [{ pos: mid(c[0], c[2]), axes: [nx, y, nz], half: [Math.hypot(...x) / 2, 1.5, Math.hypot(...z) / 2] }];
}

export function componentObstacle(model, part, { sweep = false } = {}) {
  const volumes = componentVolumes(model, part, { sweep });
  const supports = new Set(Array.isArray(part.supportTubes) ? part.supportTubes : [part.tube, part.a, part.b].filter(Boolean));
  if(hasInsetScrews(part)) {
    const spec=accessorySpec(part.panelId);
    for(const id of insetFrameTubeIds(model,componentFrame(model,part),spec.width,spec.height))supports.add(id);
  }
  for (const tube of model.tubes.values()) {
    if (supports.has(tube.id) || tube.link || tube.arm) continue;
    const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
    if (!a || !b) continue;
    if (tube.bow && tube.bowCenter) {
      // 弧管按实际圆心上的四分之一圆分段检查，不能用端点弦代替。
      const c = tube.bowCenter, va = sub(point(a), c), vb = sub(point(b), c);
      let prev = point(a);
      for (let k = 1; k <= 24; k++) {
        const theta = k / 24 * Math.PI / 2, next = c.map((n, i) => n + va[i] * Math.cos(theta) + vb[i] * Math.sin(theta));
        if (volumes.some(box => segmentHits(box, prev, next))) return { kind: 'tube', id: tube.id };
        prev = next;
      }
    } else if (volumes.some(box => segmentHits(box, point(a), point(b)))) return { kind: 'tube', id: tube.id };
  }
  for (const other of [...model.panels.values(), ...model.textiles.values(), ...model.fittings.values()]) {
    if (other.id === part.id) continue;
    const boxes = (ACCESSORY_IDS.has(other.kind) && (!confirmedSpec(other.kind) || other.appearanceVersion === 2)) || (other.appearanceVersion && PANEL_ACCESSORY_IDS.has(other.panelId))
      ? componentVolumes(model, other, { sweep: other.kind === 'swing' })
      : other.kind==='multi-wheel2' ? componentVolumes(model,other) : (other.a && other.b ? panelVolume(model, other) : [{ pos: [other.x, other.y, other.z], axes: other.quat?.every(Number.isFinite) ? [xAxisOf(other.quat), yAxisOf(other.quat), zAxisOf(other.quat)] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: other.kind === 'floating-wheel2' ? [7.5, 15.1, 15.1] : [3, 3, 3] }]);
    if (volumes.some(box => boxes.some(otherBox => boxesOverlap(box, otherBox)))) return { kind: other.panelId ? 'panel' : 'fitting', id: other.id };
  }
  for (const slide of model.slides.values()) {
    const origin = [slide.x, slide.y, slide.z];
    const end = slide.hook || origin;
    if (volumes.some(box => segmentHits(box, origin, end, 20))) return { kind: 'slide', id: slide.id };
  }
  return null;
}

function occupiedMount(model, mounts, ignoreId) {
  const parts = [...model.fittings.values(), ...model.panels.values()];
  for (const part of parts) {
    if (part.id === ignoreId) continue;
    const used = Array.isArray(part.mounts) ? part.mounts.filter(m => m && typeof m === 'object') : (part.tube ? [{ tube: part.tube, t: 0.5, width: part.kind === 'sleeve' ? Infinity : 5 }] : []);
    for (const a of mounts) for (const b of used) {
      if (a.tube !== b.tube) continue;
      const t = model.tubes.get(a.tube), n = t && model.nodes.get(t.a), m = t && model.nodes.get(t.b);
      if (n && m && Math.abs(a.t - b.t) * Math.hypot(...sub(point(m), point(n))) < (a.width + b.width) / 2 + 0.2) return part.id;
    }
  }
  return null;
}

export function accessoryDiagnostics(model, kind, tubeId, opts = {}) {
  if (confirmedSpec(kind)) {
    const candidate = confirmedCandidates(model, kind).find(p => p.tube === tubeId || p.supportTubes.includes(tubeId));
    return candidate ? confirmedDiagnostics(model, { ...candidate, id: opts.ignoreId }) : invalid('missing_support');
  }
  const spec = accessorySpec(kind), tube = model.tubes.get(tubeId);
  if (!tube || tube.arm || tube.link || tube.bow) return invalid('straight_tube');
  const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
  if (!a || !b) return invalid('missing_support');
  if (Math.abs(a.y - b.y) > 0.01) return invalid('horizontal_tube');
  const len = Math.hypot(...sub(point(b), point(a)));
  const spacing = spec.clampSpacing || spec.hangerSpacing || 18;
  if (len < spacing + 12) return invalid('tube_short');
  if (kind !== 'steering_wheel' && a.y < spec.drop + 8) return invalid('ground_clearance');
  const x = unit(sub(point(b), point(a))), y = [0, 1, 0], z = cross(x, y);
  const facing = opts.facing < 0 ? -1 : 1;
  const quat = quatFromBasis(x.map(n => n * facing), y, z.map(n => n * facing));
  const mounts = [-1, 1].map(side => ({ tube: tubeId, t: 0.5 + side * spacing / (2 * len), width: 2.5, role: kind === 'steering_wheel' ? 'clamp' : 'hanger' }));
  const part = { kind, tube: tubeId, ...Object.fromEntries(['x', 'y', 'z'].map((key, i) => [key, mid(point(a), point(b))[i]])), quat,
    mounts, supportTubes: [tubeId], appearanceVersion: APPEARANCE_VERSION, facing, params: { ...spec }, id: opts.ignoreId };
  if (occupiedMount(model, mounts, opts.ignoreId)) return { ...part, valid: false, reason: 'mount_occupied' };
  const obstacle = componentObstacle(model, part, { sweep: kind === 'swing' });
  if (obstacle) return { ...part, valid: false, reason: kind === 'swing' ? 'swing_clearance' : 'component_space', obstacle };
  return { ...part, pos: [part.x, part.y, part.z], valid: true, reason: null };
}

export function accessoryMount(model, kind, tubeId, opts = {}) {
  const mount = accessoryDiagnostics(model, kind, tubeId, opts);
  return mount.valid ? mount : null;
}

export function panelAccessoryDiagnostics(model, probe, { ignoreId = probe.id } = {}) {
  if (CONFIRMED_PANEL_IDS.has(probe.panelId)) return confirmedDiagnostics(model, { ...probe, id: ignoreId });
  const spec = accessorySpec(probe.panelId), corners = model.panelCorners(probe);
  if (!corners) return invalid('missing_support');
  const e = sub(corners[1], corners[0]), v = sub(corners[3], corners[0]), normal = unit(cross(e, v));
  if (Math.abs(Math.hypot(...e) - 40) > 1 || Math.abs(Math.hypot(...v) - 40) > 1) return invalid('frame_size');
  if (spec.mount === 'vertical-frame' && Math.abs(normal[1]) > 0.01) return invalid('vertical_frame');
  if (spec.mount === 'horizontal-frame' && Math.abs(normal[1]) < 0.999) return invalid('horizontal_frame');
  const supportTubes = new Set(), mounts = [];
  const inset=probe.panelId==='panel_40x40_busy',legacy=inset && probe.appearanceVersion===1 && Array.isArray(probe.mounts) && probe.params?.mountLayout==null;
  const screwAxis=probe.params?.screwAxis || 'vertical';
  if(inset && !['vertical','horizontal'].includes(screwAxis))return invalid('missing_support');
  if(inset && !legacy){
    const supports=oppositeScrewSupports(model,componentFrame(model,probe),40,40,{screwAxis});
    if(!supports)return invalid('opposite_edges');
    mounts.push(...supports.mounts);supports.supportTubes.forEach(id=>supportTubes.add(id));
  }
  for (let i = 0; i < (inset && !legacy?0:4); i++) {
    const a = corners[i], b = corners[(i + 1) % 4], d = unit(sub(b, a)), edge = [];
    for (const tube of model.tubes.values()) {
      const ra = model._rail(tube.id);
      if (!ra || Math.abs(dot(ra.dir, d)) < 0.999) continue;
      const delta = sub(ra.p0, a), s0 = dot(delta, d);
      if (Math.hypot(...sub(delta, d.map(n => n * s0))) > 0.5) continue;
      const s1 = s0 + ra.len * dot(ra.dir, d), lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(40, Math.max(s0, s1));
      if (hi - lo > 0.1) edge.push({ tube, ra, lo, hi });
    }
    edge.sort((a, b) => a.lo - b.lo);
    let reach = 0;
    for (const item of edge) { if (item.lo > reach + 0.5) break; reach = Math.max(reach, item.hi); supportTubes.add(item.tube.id); }
    if (reach < 39.5) return invalid('four_edges');
    const carrier = edge.find(item => item.lo <= 4 && item.hi >= 4);
    if (!carrier) return invalid('four_corners');
    const p = a.map((n, k) => n + d[k] * 4), t = dot(sub(p, carrier.ra.p0), carrier.ra.dir) / carrier.ra.len;
    mounts.push({ tube: carrier.tube.id, t, role: 'corner', width: 2.5, corner: i });
  }
  const part = { ...probe, mounts, supportTubes: [...supportTubes], appearanceVersion: APPEARANCE_VERSION, params: { ...spec } };
  if(inset && !legacy){
    const frame=componentFrame(model,probe);
    Object.assign(part,insetPanelReference(model,frame,40,40,{mounts},{screwAxis}));part.side=1;
    if(dot(componentFrame(model,part).axes[2],frame.axes[2])<0)part.side=-1;
    if(probe.appearanceVersion!==1 || probe.params?.screwAxis!=null)part.params.screwAxis=screwAxis;
  }
  if(legacy)delete part.params.mountLayout;
  if (spec.mount === 'horizontal-frame' && Math.min(...corners.map(p => p[1])) < spec.depth + 3) return { ...part, valid: false, reason: 'ground_clearance' };
  if (occupiedMount(model, part.mounts, ignoreId)) return { ...part, valid: false, reason: 'mount_occupied' };
  const existing = model.panelAt(probe.a, probe.b, probe.t0, probe.len);
  if (existing && existing.id !== ignoreId) return { ...part, valid: false, reason: 'opening_occupied' };
  const obstacle = componentObstacle(model, part);
  if (obstacle) return { ...part, valid: false, reason: 'component_space', obstacle };
  return { ...part, valid: true, reason: null, pos: componentFrame(model, part).pos };
}

export function componentMountsValid(model, part) {
  if (!part.appearanceVersion) return true;
  if(part.kind==='multi-wheel2'){
    const rail=model._rail(part.tube),frame=componentFrame(model,part);if(!rail || !frame)return false;
    const delta=sub(frame.pos,rail.p0),distance=dot(delta,rail.dir);
    return distance>=0 && distance<=rail.len && Math.hypot(...sub(delta,rail.dir.map(v=>v*distance)))<.1 && Math.abs(dot(frame.axes[0],rail.dir))>.999;
  }
  if (part.appearanceVersion === 2) return confirmedStructuralValid(model, part);
  if (part.appearanceVersion !== APPEARANCE_VERSION) return false;
  const expected = part.kind ? 2 : 4;
  if (!Array.isArray(part.mounts) || part.mounts.length !== expected || !Array.isArray(part.supportTubes) || !part.supportTubes.length) return false;
  if (part.supportTubes.some(id => !model._rail(id))) return false;
  if (part.mounts.some(m => !m || typeof m !== 'object' || !Number.isFinite(m.t) || m.t < 0 || m.t > 1 || !Number.isFinite(m.width) || m.width <= 0 || !part.supportTubes.includes(m.tube) || !mountPoint(model, m))) return false;
  const spec = accessorySpec(part.kind || part.panelId);
  if(part.panelId==='panel_40x40_busy' && part.params?.mountLayout!=null && part.params.mountLayout!==INSET_MOUNT_LAYOUT)return false;
  if(part.panelId==='panel_40x40_busy' && part.params?.screwAxis!=null && !['vertical','horizontal'].includes(part.params.screwAxis))return false;
  for (const key of ['diameter', 'clampSpacing', 'shaft', 'width', 'height', 'depth', 'drop', 'hangerSpacing']) {
    if (spec[key] != null && part.params?.[key] !== spec[key]) return false;
  }
  const candidate = part.kind ? accessoryDiagnostics(model, part.kind, part.tube, { facing: part.facing, ignoreId: part.id }) : panelAccessoryDiagnostics(model, part);
  if (!candidate.mounts || candidate.mounts.length !== expected) return false;
  if (candidate.supportTubes.length !== part.supportTubes.length || candidate.supportTubes.some(id => !part.supportTubes.includes(id))) return false;
  const unmatched = candidate.mounts.slice();
  for (const saved of part.mounts) {
    const p = mountPoint(model, saved);
    const index = unmatched.findIndex(m => m.tube === saved.tube && m.role === saved.role && Math.abs(m.width - saved.width) < 0.01 && (m.corner == null || m.corner === saved.corner) && Math.hypot(...sub(mountPoint(model, m), p)) < 0.1);
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  if (part.kind) {
    if (![part.x, part.y, part.z].every(Number.isFinite) || !Array.isArray(part.quat) || part.quat.length !== 4 || !part.quat.every(Number.isFinite) || Math.abs(Math.hypot(...part.quat) - 1) > 0.001) return false;
    if (Math.hypot(...sub([part.x, part.y, part.z], candidate.pos || [candidate.x, candidate.y, candidate.z])) > 0.1) return false;
    const frame = componentFrame(model, part);
    if (!frame || Math.abs(frame.axes[1][1] - 1) > 0.01) return false;
    const rail = model._rail(part.tube);
    if (Math.abs(dot(frame.axes[0], rail.dir)) < 0.999) return false;
    if (part.kind === 'steering_wheel' && ((part.facing !== 1 && part.facing !== -1) || dot(frame.axes[2], cross(rail.dir, [0, 1, 0])) * part.facing < 0.999)) return false;
  }
  return !['straight_tube', 'horizontal_tube', 'missing_support', 'tube_short', 'ground_clearance', 'frame_size', 'vertical_frame', 'horizontal_frame', 'four_edges', 'four_corners','opposite_edges'].includes(candidate.reason);
}

export function confirmedDiagnostics(model, probe) {
  const spec = confirmedSpec(probe.panelId || probe.kind || probe.partId);
  if (!spec) return invalid('missing_support');
  let part;
  if (spec.feature === 'rope') part = { ...ropeCandidate(model, ...(probe.mounts || [])), id: probe.id, color: probe.color };
  else if(spec.feature==='trampoline')part={...trampolineCandidate(model,probe),id:probe.id,color:probe.color};
  else if (probe.panelId) part = confirmedPanelDiagnostics(model, probe);
  else {
    const candidate = confirmedCandidates(model, spec.id).find(p => p.supportTubes.length === probe.supportTubes?.length && p.supportTubes.every(id => probe.supportTubes.includes(id)) && (p.a == null || p.a === probe.a) && (p.b == null || p.b === probe.b) && (p.t0 == null || p.t0 === probe.t0) && (p.len == null || p.len === probe.len) && (spec.feature!=='trampoline' || p.params.width===(probe.params?.width ?? probe.w ?? 40) && p.params.height===(probe.params?.height ?? probe.h ?? 40)) && (p.curveReverse == null || p.curveReverse === probe.curveReverse));
    part = candidate ? { ...candidate, id: probe.id, color: probe.color } : invalid('missing_support');
  }
  if (!part.valid) return part;
  if (occupiedMount(model, part.mounts, probe.id)) return { ...part, valid: false, reason: 'mount_occupied' };
  const obstacle = componentObstacle(model, part);
  if (obstacle) return { ...part, valid: false, reason: 'component_space', obstacle };
  return part;
}
