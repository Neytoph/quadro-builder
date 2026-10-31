import { placementMemo, railLineScope } from './incrementalPlacement.js';
const point = node => [node.x,node.y,node.z];
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0);
const END_CLEARANCE = 6; // 延用吊点到接头中心至少6厘米的安装净距。
export const GYM_RING_SPACING = 18;

// 只沿共享接头追踪同高、共线的真实直管；分离的管子不能拼成承载段。
export function gymRingSupport(model, tubeId) {
  return placementMemo(model,'gym-ring-support:'+tubeId,railLineScope(model,tubeId,1),()=>computeGymRingSupport(model,tubeId));
}
function computeGymRingSupport(model,tubeId) {
  const base = model._rail(tubeId);
  if (!base || Math.abs(base.dir[1]) > 0.001) return null;
  const queue = [tubeId], seen = new Set(), segments = [];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const rail = model._rail(id), tube = model.tubes.get(id);
    if (!rail || Math.abs(Math.abs(dot(rail.dir,base.dir))-1) > 0.001) continue;
    const delta = sub(rail.p0,base.p0), along = dot(delta,base.dir);
    if (Math.hypot(...sub(delta,base.dir.map(v=>v*along))) > 0.01) continue;
    const a = dot(sub(point(model.nodes.get(tube.a)),base.p0),base.dir);
    const b = dot(sub(point(model.nodes.get(tube.b)),base.p0),base.dir);
    segments.push({id,lo:Math.min(a,b),hi:Math.max(a,b),a,b});
    for (const nodeId of [tube.a,tube.b]) for (const next of model.incidentTubeIds(nodeId)) if (!seen.has(next)) queue.push(next);
  }
  segments.sort((a,b)=>a.lo-b.lo);
  const ranges = [];
  for (const left of segments) for (const right of segments) {
    const lo = Math.max(left.lo+END_CLEARANCE+GYM_RING_SPACING/2,right.lo+END_CLEARANCE-GYM_RING_SPACING/2);
    const hi = Math.min(left.hi-END_CLEARANCE+GYM_RING_SPACING/2,right.hi-END_CLEARANCE-GYM_RING_SPACING/2);
    if (lo <= hi+0.001) ranges.push({lo,hi,left,right});
  }
  return {...base,segments,ranges};
}

export function gymRingPlacement(model,tubeId,position) {
  const support = gymRingSupport(model,tubeId);
  if (!support?.ranges.length) return null;
  if (position && (!Array.isArray(position) || position.length!==3 || !position.every(Number.isFinite))) return null;
  const requested = position ? dot(sub(position,support.p0),support.dir) : support.len/2;
  let best = null;
  for (const range of support.ranges) {
    const center = Math.max(range.lo,Math.min(range.hi,requested));
    if (!best || Math.abs(center-requested)<Math.abs(best.center-requested)) best={...range,center};
  }
  const mounts = [best.left,best.right].map((segment,i) => {
    const along = best.center+(i ? 1 : -1)*GYM_RING_SPACING/2;
    return {tube:segment.id,t:(along-segment.a)/(segment.b-segment.a),width:2.5,role:'hanger'};
  });
  const half = GYM_RING_SPACING/2+END_CLEARANCE;
  const supportTubes = support.segments.filter(segment=>segment.hi>best.center-half+0.001 && segment.lo<best.center+half-0.001).map(segment=>segment.id);
  return {tube:mounts[0].tube,pos:support.p0.map((v,i)=>v+support.dir[i]*best.center),mounts,supportTubes};
}
