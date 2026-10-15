import { assemblyMeshes } from './assemblyNativeMesh.js';
import { beginAssemblyCollisionPass, forkAssemblyCollisionPass, invalidateAssemblyEnvelope, partEnvelope, checkAssemblyPath } from './assemblyCollision.js';
import { insetPanelProbes } from './insetPanelMounts.js';
import { confirmedSpec } from './componentPack.js';

const geometryPasses = new WeakMap();

export function nativePanelMounts(model, panelId) {
  if (!['panel_40x40','panel_40x20'].includes(panelId)) throw new Error('原生面板挂位只支持普通方板和半板');
  const spec=confirmedSpec(panelId);
  // 复用连续边管的几何探针；普通板的完整四边和固定点仍由诊断检查。
  const dimensions=spec.width===spec.height?[[spec.width,spec.height]]:[[spec.width,spec.height],[spec.height,spec.width]],seen=new Set();
  return dimensions.flatMap(([width,height])=>insetPanelProbes(model,width,height,{deduplicate:false})).filter(probe=>{
    const key=model.panelCorners(probe).map(p=>p.map(n=>n.toFixed(2)).join(',')).join('|');
    if(seen.has(key))return false;seen.add(key);return true;
  }).map(probe=>({...probe,panelId,side:1}));
}

// 普通板的实际唇边与接头让位由工厂网格复核，粗略组件包围盒只保留挂位诊断。
export function nativePanelDiagnostics(model, probe) {
  if (!['panel_40x40', 'panel_40x20'].includes(probe?.panelId)) throw new Error('原生面板检查只支持普通方板和半板');
  if (!assemblyMeshes()) throw new Error('原生面板检查需要先加载装配网格');
  const candidate = model.confirmedDiagnostics(probe);
  if (!candidate.valid && candidate.reason !== 'component_space') return candidate;
  if (model.panelAt(candidate.a, candidate.b, candidate.t0, candidate.len, probe.id)) return candidate;
  const frame = JSON.stringify(['nodes','tubes','clamps'].map(group => [...model[group].values()]));
  let pass = geometryPasses.get(model);
  if (!pass || pass.frame !== frame) {
    beginAssemblyCollisionPass(model);
    pass = { frame, parts:new Map(), frameResults:new Map() }; geometryPasses.set(model,pass);
  }
  for (const group of ['panels','textiles','slides','fittings']) for (const part of model[group].values()) {
    const stamp = JSON.stringify(part);
    if (pass.parts.get(part.id) !== stamp) { invalidateAssemblyEnvelope(model,part.id); pass.parts.set(part.id,stamp); }
  }
  let id = probe.id || '__native_panel_probe__';
  if (!probe.id) while (model.panels.has(id) || model.nodes.has(id) || model.tubes.has(id)) id += '_';
  const copy = Object.create(model);
  copy.panels = new Map(model.panels);
  copy.panels.set(id, { id, a:candidate.a, b:candidate.b, t0:candidate.t0, len:candidate.len, panelId:candidate.panelId, side:candidate.side < 0 ? -1 : 1 });
  // 普通板可覆盖承载边管上的双管连接件或管夹，沿用普通板安装规则。
  const coveredClamp = other => {
    const clamp=copy.clamps.get(other);
    if(!clamp||!['double_tube','tube_clamp'].includes(clamp.connectorId))return false;
    return [copy._clampBaseTube(clamp)?.id,copy._clampSecondTube(clamp)?.id].some(tube=>candidate.supportTubes?.includes(tube));
  };
  const installed = ['nodes', 'tubes', 'panels', 'clamps', 'textiles', 'slides', 'fittings'].flatMap(group => [...copy[group].keys()]).filter(other => other !== id&&!coveredClamp(other));
  for (const other of installed) partEnvelope(model,other);
  forkAssemblyCollisionPass(model,copy,id);
  const isFrame = other => copy.nodes.has(other)||copy.tubes.has(other)||copy.clamps.has(other);
  const frameKey = JSON.stringify([candidate.panelId,candidate.a,candidate.b,candidate.t0,candidate.len,copy.panels.get(id).side]);
  if(!pass.frameResults.has(frameKey))pass.frameResults.set(frameKey,checkAssemblyPath(copy,[id],installed.filter(isFrame),[0,0,0]));
  const collision = pass.frameResults.get(frameKey) || checkAssemblyPath(copy,[id],installed.filter(other=>!isFrame(other)),[0,0,0]);
  if (collision) {
    const other = collision.obstaclePartId;
    return { ...candidate, valid:false, reason:'component_space', obstacle:{ kind:copy.tubes.has(other)?'tube':copy.nodes.has(other)?'connector':copy.panels.has(other)?'panel':'fitting', id:other }, nativeCollision:{...collision,movingPartId:id} };
  }
  const clear = { ...candidate }; delete clear.obstacle; delete clear.nativeCollision;
  return { ...clear, valid:true, reason:null };
}
