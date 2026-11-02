import { componentVolumes, ACCESSORY_IDS, PANEL_ACCESSORY_IDS } from './accessoryPack.js';
import { geometry } from './catalog.js';
import { assemblyMeshes } from './assemblyNativeMesh.js';
import { currentPartBounds } from './assemblyCollision.js';
import { modelMiddle } from './util.js';

const states = new WeakMap();
const groups = ['nodes','tubes','panels','textiles','fittings','clamps','slides'];
const structural = new Set(['nodes','tubes','clamps']);
export const overlaps = (a,b) => a && b && [0,1,2].every(i=>a[i]<=b[i+3] && b[i]<=a[i+3]);
export function pointsBounds(points, margin=0) {
  if (!points?.length || points.some(p=>!p?.every(Number.isFinite))) return null;
  return [0,1,2].map(i=>Math.min(...points.map(p=>p[i]))-margin)
    .concat([0,1,2].map(i=>Math.max(...points.map(p=>p[i]))+margin));
}
export function placementBounds(model, part) {
  const supported=ACCESSORY_IDS.has(part.kind)||PANEL_ACCESSORY_IDS.has(part.panelId)||['panel_40x40','panel_40x20'].includes(part.panelId)||part.kind==='multi-wheel2';
  if(!supported)return pointsBounds(part.a && part.b ? model.panelCorners(part) : [[part.x,part.y,part.z]],80);
  const boxes=componentVolumes(model,part,{sweep:part.kind==='swing'});
  if(!boxes.length)return pointsBounds(part.a && part.b ? model.panelCorners(part) : null,80);
  const points=boxes.flatMap(box=>[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>
    box.pos.map((v,i)=>v+box.axes.reduce((sum,axis,k)=>sum+axis[i]*box.half[k]*[x,y,z][k],0))))));
  return pointsBounds(points,8);
}
export function railBounds(model,id,margin=0) {
  const t=model.tubes.get(id),a=t&&model.nodes.get(t.a),b=t&&model.nodes.get(t.b);
  return a&&b?pointsBounds([[a.x,a.y,a.z],[b.x,b.y,b.z]],margin):null;
}
// 连续边候选可能沿同一直线延伸；沿轴无限、横向有界的依赖保留该语义。
export function railLineScope(model,id,radius) {
  const rail=model._rail(id);
  return {groups:['nodes','tubes','clamps'],ids:new Set([id]),affected:bounds=>{
    if(!rail||!bounds)return true;
    const center=[0,1,2].map(i=>(bounds[i]+bounds[i+3])/2),delta=center.map((v,i)=>v-rail.p0[i]);
    const along=delta.reduce((s,v,i)=>s+v*rail.dir[i],0);
    return Math.hypot(...delta.map((v,i)=>v-along*rail.dir[i]))<=radius+Math.hypot(...[0,1,2].map(i=>(bounds[i+3]-bounds[i])/2));
  }};
}
function recordBounds(model,group,part) {
  const bounds=logicalBounds(model,group,part);
  if(!assemblyMeshes())return bounds;
  const native=currentPartBounds(model,part.id);
  if(!native)return bounds;
  const exact=[...native.map(([lo])=>lo-8),...native.map(([,hi])=>hi+8)];
  return bounds?bounds.map((v,i)=>i<3?Math.min(v,exact[i]):Math.max(v,exact[i])):exact;
}
function logicalBounds(model,group,part) {
  if(group==='nodes')return pointsBounds([[part.x,part.y,part.z]],part.part?80:12);
  if(group==='tubes'){
    const a=model.nodes.get(part.a),b=model.nodes.get(part.b);
    if(!a||!b)return null;
    if(part.bow){
      const center=part.bowCenter;if(!center)return null;
      const radius=Math.max(Math.hypot(...center.map((v,i)=>v-[a.x,a.y,a.z][i])),Math.hypot(...center.map((v,i)=>v-[b.x,b.y,b.z][i])));
      return pointsBounds([center],radius+8);
    }
    return pointsBounds([[a.x,a.y,a.z],[b.x,b.y,b.z]],8);
  }
  if(group==='slides')return pointsBounds([[part.x,part.y,part.z],part.hook||[part.x,part.y,part.z]],160);
  if(group==='clamps')return pointsBounds([[part.x,part.y,part.z]],20);
  if(group==='panels'||group==='textiles'||group==='fittings')return placementBounds(model,part);
  // 未声明空间范围的旧配件变化使相关空间查询全部失效。
  return null;
}
// 部分几何查询使用轻量模型视图；保留动态模型接口，返回值仍由泛型约束。
// 同步统计期间模型不变，不需要为后续编辑建立空间变更记录；查询结果仅在本次共享。
/** @template T @param {any} model @param {()=>T} compute @returns {T} */
export function withPlacementSnapshot(model,compute) {
  const previous=states.get(model);
  if(previous?.active)return compute();
  states.set(model,{entries:new Map(),active:true,hits:0,misses:0});
  try{return compute();}finally{if(previous)states.set(model,previous);else states.delete(model);}
}
/** @template T @param {any} model @param {()=>T} compute @returns {T} */
export function withPlacementPass(model,compute) {
  let state=states.get(model);
  if(state?.active)return compute();
  if(!state){state={records:new Map(),entries:new Map(),active:false,hits:0,misses:0};states.set(model,state);}
  const environment=JSON.stringify(geometry());
  if(state.environment!==environment || state.meshes!==assemblyMeshes()){
    state.entries.clear();state.records.clear();
  }
  state.environment=environment;state.meshes=assemblyMeshes();
  const next=new Map(),changes=[];
  const middle=modelMiddle(model.nodes.values());
  for(const group of groups)for(const part of model[group]?.values()||[]){
    const key=group+':'+part.id;
    const dependency=group==='tubes'?[model.nodes.get(part.a),model.nodes.get(part.b)]:structural.has(group)?null:
      [...new Set([part.a,part.b,part.tube,...(part.supportTubes||[])].filter(Boolean))].map(id=>{const t=model.tubes.get(id);return [t,t&&model.nodes.get(t.a),t&&model.nodes.get(t.b)];});
    const legacyNormal=(group==='panels'||group==='textiles')&&!part.appearanceVersion&&!part.geom?middle:null;
    const stamp=JSON.stringify([part,dependency,legacyNormal]),old=state.records.get(key);
    const record=old?.stamp===stamp?old:{stamp,group,id:part.id,refs:[part.a,part.b,part.tube,...(part.supportTubes||[])].filter(Boolean),bounds:recordBounds(model,group,part)};
    next.set(key,record);if(record!==old)changes.push(...[old,record].filter(Boolean));
  }
  for(const [key,record]of state.records)if(!next.has(key))changes.push(record);
  if(changes.length)for(const [key,entry]of state.entries){
    if(changes.some(change=>entry.structure?structural.has(change.group):
      (!entry.groups||entry.groups.includes(change.group)) && (entry.ids?.has(change.id)||change.refs?.some(id=>entry.ids?.has(id))||
      (entry.affected?entry.affected(change.bounds):!entry.bounds||!change.bounds||overlaps(entry.bounds,change.bounds)))))state.entries.delete(key);
  }
  state.records=next;state.active=true;
  try{return compute();}finally{state.active=false;}
}
// scope 同时接受空间范围、结构依赖和延迟构造函数。
/** @template T @param {any} model @param {string} key @param {any} scope @param {()=>T} compute @returns {T} */
export function placementMemo(model,key,scope,compute) {
  const state=states.get(model);
  if(!state?.active)return compute();
  if(state.entries.has(key)){state.hits++;return structuredClone(state.entries.get(key).value);}
  state.misses++;
  const value=compute();state.entries.set(key,{...(typeof scope==='function'?scope():scope),value:structuredClone(value)});
  if(state.entries.size>20000)state.entries.delete(state.entries.keys().next().value);
  return value;
}
export function placementCacheStats(model){const s=states.get(model);return s?{hits:s.hits,misses:s.misses,entries:s.entries.size}:null;}
export function placementCached(model,key){const state=states.get(model);return state?.active && state.entries.has(key);}
