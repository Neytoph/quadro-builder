import { reinforcementPart, getTube, partName } from './catalog.js';
import { xAxisOf as rawXAxisOf, yAxisOf as rawYAxisOf, zAxisOf as rawZAxisOf, panelNormal as panelMountNormal, modelMiddle } from './util.js';
import { getLang } from './i18n.js';
import { nativeEnvelopes } from './assemblyNativeEnvelopes.js';
import { componentMountsValid, componentFrame, confirmedDiagnostics, ACCESSORY_IDS, PANEL_ACCESSORY_IDS } from './accessoryPack.js';
import { partEnvelope } from './assemblyCollision.js';
import { nativeAccessorySupport, normalizedAssemblyQuaternion } from './assemblyAccessoryMethods.js';
import { createCoreChannels } from './assemblyCoreChannels.js';
import { isOriginalComponent, componentInstallCopy, componentPartId } from './accessoryInfo.js';
const xAxisOf=q=>rawXAxisOf(normalizedAssemblyQuaternion(q)),yAxisOf=q=>rawYAxisOf(normalizedAssemblyQuaternion(q)),zAxisOf=q=>rawZAxisOf(normalizedAssemblyQuaternion(q));

const MAPS={nodeIds:'nodes',tubeIds:'tubes',panelIds:'panels',textileIds:'textiles',slideIds:'slides',fittingIds:'fittings',clampIds:'clamps'};
const copy=(zh,en,de)=>getLang()==='zh'?zh:getLang()==='en'?en:de;
const xyz=n=>[n.x,n.y,n.z];
const unit=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const tubeSupports=p=>[...new Set([...(Array.isArray(p.supportTubes)?p.supportTubes:[]),p.tube,p.a,p.b].filter(Boolean))];
const THREAD=new Set(['floating-wheel2','sleeve2','textil-round2','bag2','pool2','pool-small2','roof-large2']);
const verify=(pathChecked=false,methodChecked=true,directionConsistent=true)=>({directionConsistent,pathChecked,methodChecked,physical:'unverified',load:'unverified',basis:methodChecked?'topology-and-conservative-geometry':'unresolved-installation-method'});
const diag=(diagnostics,code,message,partIds,details)=>diagnostics.push({code,severity:'error',message,partIds,nodeIds:[],details});

/** Reassign physical prethread parts before their carrier is closed, then defer coverings. */
export function scheduleAssemblyAccessories(model,steps,diagnostics,regions=[],deferredAccessories=[]){
  for (const r of regions.filter(r=>r.kind==='roof')) {
    const pieces=steps.filter(s=>s.regionId===r.id&&s.action.type==='preassemble');
    if(pieces.length<2)continue; const first=pieces[0];
    for(const key of Object.keys(MAPS))first[key]=[...new Set(pieces.flatMap(s=>s[key]))];
    first.partIds=[...new Set(pieces.flatMap(s=>s.partIds))];
    first.title=copy(`预装 ${r.name}：开放端分组后合拢`,`Preassemble ${r.name}: join open subframes`,`${r.name} vormontieren: offene Teilrahmen verbinden`);
    for(const step of pieces.slice(1))steps.splice(steps.indexOf(step),1);
  }
  const physical=steps.filter(s=>s.action.type!=='attach'),owner=new Map(physical.flatMap(s=>s.partIds.map(id=>[id,s])));
  const move=(id,key,target)=>{const old=owner.get(id);if(!old||!target||old===target)return;old[key]=old[key].filter(v=>v!==id);old.partIds=old.partIds.filter(v=>v!==id);target[key].push(id);target.partIds.push(id);owner.set(id,target);
    const priorRegion=regions.find(region=>region.id===old.regionId),nextRegion=regions.find(region=>region.id===target.regionId);
    if(priorRegion&&nextRegion&&priorRegion!==nextRegion){priorRegion[key]=priorRegion[key].filter(part=>part!==id);priorRegion.partIds=priorRegion.partIds.filter(part=>part!==id);nextRegion[key]=[...new Set([...nextRegion[key],id])];nextRegion.partIds=[...new Set([...nextRegion.partIds,id])];}
  };
  for(const tx of model.textiles?.values()||[]){const supports=tubeSupports(tx),first=physical.filter(s=>supports.some(id=>s.tubeIds.includes(id))).sort((a,b)=>steps.indexOf(a)-steps.indexOf(b))[0];if(first)move(tx.id,'textileIds',first);else diag(diagnostics,'MISSING_THREAD_SUPPORT','穿管布件没有可识别的支撑管，无法安排封口前安装。',[tx.id,...supports]);}
  for(const f of model.fittings?.values()||[])if(THREAD.has(f.kind)){
    let supports=tubeSupports(f);
    if(['pool2','pool-small2'].includes(f.kind)){
      const q=f.quat||[0,0,0,1],axes=[xAxisOf(q),yAxisOf(q),zAxisOf(q)],w=f.w||(f.kind==='pool2'?120:80),depth=f.d||(f.kind==='pool2'?160:120),local=[[-w/2,0,0],[w/2,0,0],[w/2,0,depth],[-w/2,0,depth]],corners=local.map(point=>xyz(f).map((v,i)=>v+axes.reduce((sum,axis,k)=>sum+axis[i]*point[k],0))),edges=corners.map((point,i)=>[point,corners[(i+1)%4]]),byEdge=edges.map(([a,b])=>[...model.tubes.values()].filter(t=>{if(t.bow||t.arm||t.link)return false;const p=xyz(model.nodes.get(t.a)),end=xyz(model.nodes.get(t.b)),d=unit(sub(b,a)),r=sub(p,a),along=dot(r,d),L=Math.hypot(...sub(b,a)),tubeAxis=unit(sub(end,p));return Math.abs(dot(d,tubeAxis))>.995&&Math.hypot(...r.map((v,k)=>v-d[k]*along))<.01&&Math.max(along,dot(sub(end,a),d))>0&&Math.min(along,dot(sub(end,a),d))<L;}));
      supports=[...new Set(byEdge.flat().map(t=>t.id))];
      // Each complete edge must be covered by contiguous node-to-node tubes.
      const complete=byEdge.every((tubes,i)=>{const [a,b]=edges[i],axis=unit(sub(b,a)),L=Math.hypot(...sub(b,a)),ranges=tubes.map(t=>[dot(sub(xyz(model.nodes.get(t.a)),a),axis),dot(sub(xyz(model.nodes.get(t.b)),a),axis)].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi]of ranges){if(lo>end+.01)return false;end=Math.max(end,hi);}return end>=L-.01;});
      if(!complete)diag(diagnostics,'MISSING_THREAD_SUPPORT','软衬四边缺少连续的开放支撑管，不能安排封口前穿管。',[f.id,...supports],{edges:byEdge.map(tubes=>tubes.map(t=>t.id)),basis:'official-2025-section-1.14'});
    }
    if(!supports.length){const near=[...model.tubes.values()].filter(t=>{const a=model.nodes.get(t.a),b=model.nodes.get(t.b);if(!a||!b)return false;if(['pool2','pool-small2','bag2','roof-large2'].includes(f.kind) && (Math.abs(a.y-b.y)>.6 || Math.abs((a.y+b.y)/2-f.y)>1))return false;const p=xyz(f),d=xyz(b).map((v,i)=>v-xyz(a)[i]),L=Math.hypot(...d),u=unit(d),v=p.map((x,i)=>x-xyz(a)[i]),along=dot(v,u);return along>=-3&&along<=L+3&&Math.hypot(...v.map((x,i)=>x-u[i]*along))<3;});supports=near.map(t=>t.id);}
    const first=physical.filter(s=>supports.some(id=>s.tubeIds.includes(id))).sort((a,b)=>steps.indexOf(a)-steps.indexOf(b))[0];if(first){move(f.id,'fittingIds',first);first.threadSupports={...first.threadSupports,[f.id]:supports};if(['pool2','pool-small2'].includes(f.kind))first.flexibleLinings={...first.flexibleLinings,[f.id]:{carriers:supports,basis:'official-2025-section-1.14'}};}else diag(diagnostics,'MISSING_THREAD_SUPPORT','穿管配件缺少可确认的管轴，不能以完成位置代替安装方法。',[f.id]);
  }
  for(const f of model.fittings?.values()||[])if(f.kind==='multi-wheel2'){
    const q=f.quat||[0,0,0,1],axis=xAxisOf(q),bearings=[...model.fittings.values()].filter(p=>p.kind==='bearing2').filter(p=>{const d=xyz(f).map((v,i)=>v-xyz(p)[i]),along=dot(d,axis);return Math.abs(along)<15&&Math.hypot(...d.map((v,i)=>v-axis[i]*along))<.6;});
    if(bearings.length!==1)diag(diagnostics,'MISSING_WHEEL_BEARING','多功能轮需要明确的轮轴承安装引用，请核对轮轴和朝向。',[f.id,...bearings.map(p=>p.id)]);else {const s=owner.get(f.id);s.bearingSupports={...s.bearingSupports,[f.id]:bearings[0].id};}
  }
  for(const c of model.clamps?.values()||[]){const base=model._clampBaseTube?.(c);const cohort=model.clampCohort?.(c.id);const carriers=[base?.id,...(cohort?.tubes||[])].filter(Boolean);const candidates=physical.filter(s=>carriers.some(id=>s.tubeIds.includes(id))).sort((a,b)=>steps.indexOf(a)-steps.indexOf(b)),first=c.connectorId==='tube_clamp'?candidates.at(-1):candidates[0];if(first){move(c.id,'clampIds',first);if(c.connectorId==='tube_clamp')first.clampSupports={...first.clampSupports,[c.id]:carriers};else first.threadSupports={...first.threadSupports,[c.id]:carriers};}else diag(diagnostics,'MISSING_DOUBLE_TUBE_SUPPORT','双管连接环没有可识别的两根穿管轴。',[c.id]);}
  // Dedicated factory slides are fitted when their real entry/exit supports
  // exist, before upper guardrails can obstruct the entrance platform.
  for(const slide of [...model.slides.values()].filter(slide=>['slide-end2','slide2'].includes(slide.kind)).sort((a,b)=>(a.kind==='slide-end2'?0:1)-(b.kind==='slide-end2'?0:1))){
    const mount=nativeAccessorySupport(model,slide.id),supports=mount.supportIds||[],supportedSteps=supports.map(id=>owner.get(id));
    if(mount.valid&&supports.length&&supportedSteps.every(Boolean)){
      let target=supportedSteps.sort((a,b)=>steps.indexOf(b)-steps.indexOf(a))[0];
      if(slide.kind==='slide2'){const exit=model.slideExit(slide),runout=exit&&[...model.slides.values()].find(other=>other.kind==='slide-end2'&&Math.hypot(...sub(xyz(other),exit.pos))<.05),runoutStep=runout&&owner.get(runout.id);if(runoutStep&&steps.indexOf(runoutStep)>steps.indexOf(target))target=runoutStep;}
      if(!target.action.detached)move(slide.id,'slideIds',target);
    }
  }
  // A panel is installed as soon as every perimeter rail exists, before higher
  // risers can obstruct it. Later tube actions still check against that panel.
  for(const panel of model.panels.values()){
    const corners=model.panelCorners(panel);if(!corners)continue;
    const supports=new Set(tubeSupports(panel));
    for(const tube of model.tubes.values()){
      if(tube.arm||tube.link||tube.bow)continue;const rail=model._rail(tube.id);if(!rail)continue;
      if(corners.some((p,i)=>{const q=corners[(i+1)%4],d=unit(sub(q,p));if(Math.abs(dot(d,rail.dir))<.995)return false;const v=sub(rail.p0,p),along=dot(v,d);return Math.hypot(...v.map((x,k)=>x-d[k]*along))<.6 && along<Math.hypot(...sub(q,p))+.6 && along+rail.len>-.6;}))supports.add(tube.id);
    }
    // Original/confirmed components retain their own final installation step
    // and component-specific fixing instructions. Still resolve every actual
    // perimeter support for the normal motion and support-pose gates below.
    if(isOriginalComponent(panel)){
      const dedicated=owner.get(panel.id);
      if(dedicated)dedicated.panelSupports={...dedicated.panelSupports,[panel.id]:[...supports]};
      continue;
    }
    const supportSteps=[...supports].map(id=>owner.get(id)).filter(Boolean);
    if(supportSteps.length===supports.size&&supportSteps.length){let target=supportSteps.sort((a,b)=>steps.indexOf(b)-steps.indexOf(a))[0];
      // The official modular-slide guide installs the entrance platform after
      // seating the body. Match only its actual entry edge, not nearby panels.
      for(const slide of model.slides.values())if(slide.kind==='slide2'){
        const entry=model.slideEntry(slide),point=entry&&xyz(entry);
        const onEdge=point&&corners.some((a,i)=>{const b=corners[(i+1)%4],v=sub(b,a),L=Math.hypot(...v),d=unit(v),r=sub(point,a),along=dot(r,d);return along>=-.6&&along<=L+.6&&Math.hypot(...r.map((x,k)=>x-d[k]*along))<.6;});
        const slideStep=physical.find(s=>s.slideIds.includes(slide.id));
        if(onEdge&&slideStep&&steps.indexOf(slideStep)>=steps.indexOf(target)){
          const railId=[...supports].find(id=>{const tube=model.tubes.get(id),a=xyz(model.nodes.get(tube.a)),b=xyz(model.nodes.get(tube.b)),d=unit(sub(b,a)),r=sub(point,a),along=dot(r,d);return along>=-.6&&along<=Math.hypot(...sub(b,a))+.6&&Math.hypot(...r.map((x,k)=>x-d[k]*along))<.6;});
          if(railId){target=slideStep;target.panelAfterSlide={...target.panelAfterSlide,[panel.id]:slide.id};target.entryPanelContacts={...target.entryPanelContacts,[`${panel.id}:${slide.id}`]:{panelId:panel.id,slideId:slide.id,railId,basis:'official-2025-slide-body-before-entrance-platform'}};}
        }
      }
      move(panel.id,'panelIds',target);target.panelSupports={...target.panelSupports,[panel.id]:[...supports]};
    }
  }
  for(const request of deferredAccessories){let target=physical.find(step=>request.afterTubeIds.every(id=>step.tubeIds.includes(id)));
    if(target?.action.detached){const attach=steps.find(step=>step.regionId===target.regionId&&step.action.type==='attach'&&steps.indexOf(step)>steps.indexOf(target));if(attach){let post=steps.find(step=>step.id===`post-${attach.id}-coverings`);if(!post){post={...attach,id:`post-${attach.id}-coverings`,kind:'accessories',title:copy('模块落位后安装延后板面','Fit delayed coverings after module placement','Abdeckungen nach dem Platzieren des Moduls montieren'),partIds:[],parts:Object.fromEntries(Object.keys(attach.parts).map(key=>[key,[]])),instructions:[],dependsOn:[attach.id],interfaceIds:[],action:{type:'build',scope:'parts',detached:false,translation:[0,0,0]},...Object.fromEntries(Object.keys(MAPS).map(key=>[key,[]]))};steps.splice(steps.indexOf(attach)+1,0,post);physical.push(post);}target=post;}}
    if(target&&model.panels.has(request.partId)){const prior=owner.get(request.partId);if(prior&&steps.indexOf(target)>=steps.indexOf(prior)){const supports=prior.panelSupports?.[request.partId]||tubeSupports(model.panels.get(request.partId));move(request.partId,'panelIds',target);target.panelSupports={...target.panelSupports,[request.partId]:supports};if(target.id.startsWith('post-')){const corners=model.panelCorners(model.panels.get(request.partId));if(corners)target.y=corners.reduce((sum,p)=>sum+p[1],0)/corners.length;}target.instructions.push(copy('先完成本组框架，再装这块板面，保持向下套入的通道开放。','Complete this frame before fitting the covering, keeping its lowering path open.','Diesen Rahmen vor der Abdeckung fertigstellen, damit der Absenkweg frei bleibt.'));}}}
  for(const s of [...steps])if(s.action.type!=='attach'&&!Object.keys(MAPS).some(key=>s[key].length))steps.splice(steps.indexOf(s),1);
  for (const s of steps.filter(s=>s.action.type==='attach')) {
    const assembled=steps.slice(0,steps.indexOf(s)).filter(p=>p.regionId===s.regionId&&p.action.detached);
    for(const key of Object.keys(MAPS))s[key]=[...new Set(assembled.flatMap(p=>p[key]))];
    s.partIds=[...new Set(assembled.flatMap(p=>p.partIds))];
  }
  for (const s of steps) s.dependsOn = s.dependsOn.filter(id => steps.findIndex(o=>o.id===id)<steps.indexOf(s));
  for(const s of steps){if(s.action.type==='attach')continue;s.partIds=[...new Set(Object.keys(MAPS).flatMap(k=>s[k]))];}
  for(const p of [...model.panels.values(),...model.fittings.values()])if(p.appearanceVersion&&(ACCESSORY_IDS.has(p.kind)||PANEL_ACCESSORY_IDS.has(p.panelId))){
    let result;try{result=p.appearanceVersion===2?confirmedDiagnostics(model,p):p.kind?model.accessoryDiagnostics(p.kind,p.tube,{facing:p.facing,ignoreId:p.id}):model.panelAccessoryDiagnostics(p);}catch(error){result={valid:false,reason:String(error)};}
    if(!componentMountsValid(model,p)||!result?.valid)diag(diagnostics,'ACCESSORY_INSTALLATION_INVALID','配件的安装引用、朝向、支撑或空间无效，请检查诊断所指部件。',[p.id,...tubeSupports(p)],result);
  }
}

/** Recursive common-axis joins avoid inserting the last tube between two fixed ends. */
function frameSequence(model,nodeIds,tubeIds,emit,diagnostics,threads=[]){
  const nodes=[...new Set(nodeIds)],arms=[...model.tubes.values()].filter(t=>t.arm && nodeIds.includes(t.a)&&nodeIds.includes(t.b)),tubes=tubeIds.map(id=>model.tubes.get(id)).filter(t=>t&&!t.link&&!t.arm);
  const build=(ids,edges,offset=[0,0,0])=>{
    if(ids.length===1 || (edges.length===0 && ids.every(id=>arms.some(t=>t.a===id||t.b===id)))){emit('orient-connector',ids,copy('拿取图中连接件，按图摆正各插口，暂不固定。','Orient the shown connector; leave its ports open.','Gezeigte Kupplung ausrichten; Öffnungen freilassen.'),{openPorts:[ids[0]],placementTranslation:offset});return {partIds:ids,last:undefined};}
    let cut;
    // Prefer coordinate cuts, then bridge cuts (e.g. sloped roof triangles).
    for(const axis of [0,2,1]){const coords=[...new Set(ids.map(id=>xyz(model.nodes.get(id))[axis]))].sort((a,b)=>a-b);for(let k=0;k<coords.length-1&&!cut;k++){
      const plane=(coords[k]+coords[k+1])/2,left=ids.filter(id=>xyz(model.nodes.get(id))[axis]<plane),set=new Set(left),crossing=edges.filter(t=>set.has(t.a)!==set.has(t.b));if(!crossing.length || arms.some(t=>ids.includes(t.a)&&ids.includes(t.b)&&set.has(t.a)!==set.has(t.b)))continue;
      const directions=crossing.map(t=>{const n=model.nodes.get(set.has(t.a)?t.b:t.a),o=model.nodes.get(set.has(t.a)?t.a:t.b);return unit(model._tubeDirAt(t,n,o));});
      const crossingIds=new Set(crossing.map(t=>t.id));
      const compatible=threads.every(thread=>{const active=thread.carriers.filter(id=>edges.some(t=>t.id===id));if(active.length<2)return true;const crossed=active.filter(id=>crossingIds.has(id));if(crossed.length)return crossed.length===active.length;const sides=active.map(id=>set.has(model.tubes.get(id).a));return sides.every(side=>side===sides[0]);});
      if(compatible&&directions.every(d=>dot(d,directions[0])>.995))cut={left,right:ids.filter(id=>!set.has(id)),crossing,direction:directions[0]};
    }if(cut)break;}
    if(!cut){
      // Disconnected pieces can be built separately, never portrayed as one movable frame.
      const pending=new Set(ids),groups=[];for(const id of ids){if(!pending.delete(id))continue;const group=[id];for(let j=0;j<group.length;j++)for(const t of [...edges,...arms.filter(t=>ids.includes(t.a)&&ids.includes(t.b))]){if(t.a===group[j]&&pending.delete(t.b))group.push(t.b);if(t.b===group[j]&&pending.delete(t.a))group.push(t.a);}groups.push(group);}
      if(groups.length>1){for(const group of groups){const set=new Set(group);build(group,edges.filter(t=>set.has(t.a)&&set.has(t.b)),offset);}return {partIds:[...ids,...edges.map(t=>t.id)]};}
      diag(diagnostics,'UNRESOLVED_FRAME_CLOSURE','本框架闭环没有共轴合拢方法，不能把最后一根管强行插入两个已连接的接头。',[...ids,...edges.map(t=>t.id)]);emit('unresolved-closure',[...ids,...edges.map(t=>t.id)],copy('该闭环的安装方法尚未确认，请调整区域或连接方式后导出。','Closure method unresolved. Adjust the region or joints before export.','Schließverfahren ungeklärt. Bereich oder Verbindungen vor dem Export anpassen.'),{verification:verify(false,false)});return {partIds:[...ids,...edges.map(t=>t.id)]};
    }
    const left=new Set(cut.left),right=new Set(cut.right),translation=cut.direction.map(v=>-v*12);
    const L=build(cut.left,edges.filter(t=>left.has(t.a)&&left.has(t.b)),offset);
    const pending=new Set(cut.crossing.map(t=>t.id));
    for(const t of cut.crossing){if(!pending.has(t.id))continue;const thread=threads.find(a=>a.carriers.includes(t.id)),group=thread?cut.crossing.filter(t=>thread.carriers.includes(t.id)):[t];for(const tube of group)pending.delete(tube.id);const anchor=left.has(t.a)?t.a:t.b,other=anchor===t.a?t.b:t.a,d=unit(model._tubeDirAt(t,model.nodes.get(anchor),model.nodes.get(other)));emit('insert-tube',group.map(t=>t.id),copy(`拿取${partName(getTube(t.tubeId))}，沿图示方向插入箭头所指接头，另一端保持开放。`,`Insert ${partName(getTube(t.tubeId))} into the connector indicated by the arrow; leave the other end open.`,`${partName(getTube(t.tubeId))} entlang des Pfeils in die vom Pfeil angezeigte Kupplung einsetzen; anderes Ende offen lassen.`),{referencePartIds:group.map(t=>left.has(t.a)?t.a:t.b),position:xyz(model.nodes.get(anchor)),translation:d.map(v=>v*12),direction:d.map(v=>-v),openPorts:group.map(t=>right.has(t.a)?t.a:t.b),placementTranslation:offset});}
    const R=build(cut.right,edges.filter(t=>right.has(t.a)&&right.has(t.b)),offset.map((v,i)=>v+translation[i]));
    const closed=cut.crossing.map(t=>right.has(t.a)?t.a:t.b);
    emit('join-subframes',R.partIds,copy('对齐图中开放插口，沿箭头移动这一组，整体合拢；不要单独硬塞最后一根管。','Align the shown open ports and slide this subframe along the arrow to close the joints.','Offene Anschlüsse ausrichten und diesen Teilrahmen entlang des Pfeils zusammenschieben.'),{consumesPartIds:[],referencePartIds:[...L.partIds,...cut.crossing.map(t=>t.id)],translation,direction:cut.direction,position:xyz(model.nodes.get(closed[0])),openPorts:closed,closesPorts:closed,closureMethod:'common-axis-subframe-join',placementTranslation:offset});
    return {partIds:[...ids,...edges.map(t=>t.id),...threads.filter(thread=>thread.carriers.every(id=>edges.some(t=>t.id===id))).map(thread=>thread.id)]};
  };
  if(nodes.length)build(nodes,tubes);
}

export function addAssemblyOperations(model,plan){
  const {steps,diagnostics}=plan,installed=new Set(),runDone=new Set(),threadDone=new Set(),poses=new Map(),threadAssemblies=[],threadCarrierConsumed=new Set(),preparedRigid=new Set(),softLinings=[];let previous;
  const entryPanelContacts=new Map(steps.flatMap(step=>Object.entries(step.entryPanelContacts||{})));
  const linerCarrierContacts=new Map();
  for(const step of steps)for(const [linerId,{carriers,basis}]of Object.entries(step.flexibleLinings||{})){
    const byNode=new Map();for(const tubeId of carriers){const tube=model.tubes.get(tubeId);for(const nodeId of [tube.a,tube.b]){if(!byNode.has(nodeId))byNode.set(nodeId,[]);byNode.get(nodeId).push(tubeId);}}
    for(const [nodeId,tubeIds]of byNode)if(tubeIds.length===2){const node=model.nodes.get(nodeId),directions=tubeIds.map(id=>{const tube=model.tubes.get(id);return unit(model._tubeDirAt(tube,node,model.nodes.get(tube.a===nodeId?tube.b:tube.a)));});if(dot(directions[0],directions[1])<-.995)linerCarrierContacts.set(`${linerId}:${nodeId}`,{linerId,nodeId,carrierPartIds:tubeIds,axis:directions[0],basis});}
  }
  const panelLinerContacts=new Map();
  for(const step of steps)for(const [linerId,{carriers}]of Object.entries(step.flexibleLinings||{}))for(const panel of model.panels.values())for(const railId of tubeSupports(panel))if(carriers.includes(railId))panelLinerContacts.set(`${panel.id}:${linerId}`,{panelId:panel.id,linerId,railId,basis:'source-native-shared-carrier-lip'});
  const fittingMatingContacts=new Map();
  for(const fitting of model.fittings.values())if(!THREAD.has(fitting.kind)&&!fitting.appearanceVersion){const resolved=nativeAccessorySupport(model,fitting.id);if(resolved.valid)for(const supportId of resolved.supportIds){const kind=model.nodes.has(supportId)?'node-stub':model.fittings.get(supportId)?.kind==='bearing2'?'wheel-bearing':null;if(kind)fittingMatingContacts.set(`${fitting.id}:${supportId}`,{fittingId:fitting.id,supportId,kind,axis:resolved.mount.direction,basis:resolved.basis});}}
  const c45MatingContacts=new Map(plan.interfaces.filter(mark=>mark.directionBasis==='qdf-file-C45-mouth-and-matching-receiver-axis').map(mark=>[`${mark.nodeId}:${mark.supportTubeId}`,{cornerId:mark.nodeId,receiverNodeId:mark.mateNodeId,tubeId:mark.supportTubeId,basis:mark.directionBasis}]));
  const reinforcement=reinforcementPart(),core=createCoreChannels(model,{entryPanelContacts,linerCarrierContacts,panelLinerContacts,fittingMatingContacts,c45MatingContacts});
  const checkPath=(moving,installed,...args)=>core.check(moving,[...new Set([...installed,...preparedRigid])].filter(id=>!softLinings.some(lining=>lining.folded&&lining.id===id&&moving.every(part=>lining.carriers.includes(part)||lining.carriers.some(t=>{const tube=model.tubes.get(t);return tube.a===part||tube.b===part;})))),...args);
  const materialKeys=id=>plan.ledger.instances.filter(x=>x.partIds.includes(id)&&x.group!=='screws').map(x=>`${x.group}:${x.key}`);
  for(const step of steps){step.operations=[];const opByPart=new Map();let staging=[0,0,0];
    const region=plan.regions.find(r=>r.id===step.regionId),regional=step.action.detached ? region.detachedTranslation : [0,0,0];
    const present=new Set(installed);
    const emit=(type,partIds,text,extra={})=>{
      if(type==='insert-tube'){
        const carried=threadAssemblies.filter(thread=>thread.verification.methodChecked&&thread.carriers.some(id=>partIds.includes(id)));
        if(carried.length){
          const carriers=[...new Set(carried.flatMap(thread=>thread.carriers))],accessories=[...new Set(carried.filter(thread=>!thread.flexible).map(thread=>thread.id))],moving=[...carriers,...accessories];
          const offset=(extra.placementTranslation||[0,0,0]).map((v,i)=>v+regional[i]+staging[i]),destination=extra.translation.map((v,i)=>v+offset[i]),start=poses.get(accessories[0]||carriers[0]);
          if(start&&Math.hypot(...sub(start,destination))>1e-6){
            const highest=Math.max(...[...model.nodes.values()].map(n=>n.y))+30,minY=Math.min(...carriers.flatMap(id=>{const t=model.tubes.get(id);return [model.nodes.get(t.a).y,model.nodes.get(t.b).y];}));
            const direct=checkPath(moving,[...present],start,destination,{obstacleTranslations:poses});
            const route=direct?[start,[start[0],highest-minY,start[2]],[destination[0],highest-minY,destination[2]],destination]:[start,destination];
            for(let leg=0;leg<route.length-1;leg++){
              const translation=sub(route[leg],route[leg+1]),localDestination=route[leg+1].map((v,i)=>v-regional[i]-staging[i]);
              emit('transfer-threaded-carrier',moving,copy('拿起已穿好配件的管件组，保持图示相对位置，沿箭头移到开放插口前。','Keep the threaded tubes together in the shown alignment and move them to the open ports.','Aufgefädelte Rohrgruppe in der gezeigten Ausrichtung zusammenhalten und vor die offenen Anschlüsse bewegen.'),{consumesPartIds:carriers.filter(id=>!threadCarrierConsumed.has(id)),placementTranslation:localDestination,translation,direction:unit(translation).map(v=>-v),position:xyz(model.nodes.get(model.tubes.get(carriers[0]).a)),carrierPartIds:carriers});
              for(const id of carriers)threadCarrierConsumed.add(id);
            }
          }
          partIds=[...new Set([...partIds,...accessories])];extra={...extra,consumesPartIds:partIds.filter(id=>!threadCarrierConsumed.has(id)&&!threadDone.has(id)),carrierPartIds:carriers};
        }
      }
      const actualOffset=(extra.placementTranslation||[0,0,0]).map((v,i)=>v+regional[i]+staging[i]);
      const channel=core.channels.find(c=>c.active&&(c.middle.some(id=>partIds.includes(id))||partIds.includes(c.terminalNodeIds[1])));
      if(type==='orient-connector'&&channel){const nodeId=partIds.find(id=>channel.middle.includes(id)||id===channel.terminalNodeIds[1]),point=xyz(model.nodes.get(nodeId)),tip=dot(channel.end.map((v,i)=>v+(poses.get(channel.id)?.[i]||0)),channel.axis),target=dot(point.map((v,i)=>v+actualOffset[i]),channel.axis),clearance=Math.max(0,tip-target+7.5);if(clearance>1e-6){type='thread-core-connector';extra={...extra,translation:channel.axis.map(v=>v*clearance),direction:channel.axis.map(v=>-v),position:point,referencePartIds:channel.run.tubeIds,channelId:channel.id};text=copy('沿箭头把贯通接头穿过露出的木芯，保持通孔与木芯同轴，再接到已装管端。','Slide the through-connector over the protruding wood profile along the arrow, keeping the bore aligned, then seat it on the tube end.','Durchgangskupplung entlang des Pfeils über das herausragende Holzprofil schieben, Bohrung axial halten und auf das Rohrende setzen.');}}
      if(type==='insert-tube'){const next=core.channels.find(c=>c.active&&c.run.tubeIds.some(id=>partIds.includes(id))&&!partIds.includes(c.firstCarrier));if(next){const tube=model.tubes.get(partIds.find(id=>next.run.tubeIds.includes(id))),points=[tube.a,tube.b].map(id=>xyz(model.nodes.get(id))),axis=unit(extra.translation),tip=Math.max(dot(next.start.map((v,i)=>v+(poses.get(next.id)?.[i]||0)),axis),dot(next.end.map((v,i)=>v+(poses.get(next.id)?.[i]||0)),axis)),near=Math.min(...points.map(point=>dot(point.map((v,i)=>v+actualOffset[i]),axis))),clearance=Math.max(Math.hypot(...extra.translation),tip-near+7.5);extra={...extra,translation:axis.map(v=>v*clearance),direction:axis.map(v=>-v),channelId:next.id};text=copy('拿取下一根贯通管，沿露出的木芯同轴穿入，再插紧箭头所指接头；末端保持开放。','Slide the next tube over the exposed wood profile on the same axis, then seat it on the indicated connector; keep its far end open.','Nächstes Rohr axial über das freiliegende Holzprofil schieben und auf die gezeigte Kupplung setzen; anderes Ende offen lassen.');}}
      const unique=[...new Set(partIds)],id=`${step.id}-operation-${step.operations.length+1}`;
      const op={id,type,order:step.operations.length+1,partIds:unique,consumesPartIds:unique,dependsOn:previous?[previous]:[],instructions:[text],verification:verify(),...extra};
      const offset=(op.placementTranslation || [0,0,0]).map((v,i)=>v+regional[i]+staging[i]);
      op.placementTranslation=offset;
      if(op.translation && op.direction && !['prethread-accessory','thread-flexible-carrier'].includes(type)) {
        const start=op.translation.map((v,i)=>v+offset[i]);
        const obstruction=checkPath(op.movingEnvelopeIds||op.partIds,[...present],start,offset,{obstacleTranslations:poses});
        op.verification=verify(!obstruction,!obstruction);
        if(obstruction)diag(diagnostics,'INSTALLATION_PATH_BLOCKED','安装动作的完整部件包络被已装部件阻挡，请调整局部预装顺序或开放接口。',[obstruction.movingPartId,obstruction.obstaclePartId],{...obstruction,operationId:id,type});
      }
      for(const p of op.consumesPartIds){present.add(p);preparedRigid.delete(p);poses.set(p,offset);}
      if(op.translation)for(const p of op.partIds)poses.set(p,offset);
      if(op.direction&&op.translation&&Math.hypot(...op.translation)>1e-8){op.verification.directionConsistent=op.direction.every(Number.isFinite)&&op.translation.every(Number.isFinite)&&dot(unit(op.direction),unit(op.translation).map(v=>-v))>.995;op.verification.directionBasis='actual-translation-axis';if(!op.verification.directionConsistent)diag(diagnostics,'INVALID_OPERATION_DIRECTION','动作箭头与实际插接位移方向不一致，不能导出未确认的操作。',op.partIds,{operationId:id,type,direction:op.direction,translation:op.translation});}else {op.verification.directionApplicability='not-applicable';op.verification.directionBasis=type==='orient-connector'?'resolved-connector-port-orientation':'non-translating-preparation';}
      step.operations.push(op);previous=id;for(const p of op.consumesPartIds)opByPart.set(p,id);
      if(type==='insert-tube')for(const channel of core.channels.filter(c=>!c.active&&c.valid&&op.partIds.includes(c.firstCarrier))){
        channel.active=true;poses.set(channel.id,offset);const tube=model.tubes.get(channel.firstCarrier),reach=Math.max(...[tube.a,tube.b].map(id=>dot(sub(xyz(model.nodes.get(id)),channel.start),channel.axis)));
        const coreOp=emit('preinsert-reinforcement',[channel.firstCarrier],copy('从仍开放的管端沿箭头插入80cm木芯；为下一根管保留露出的芯材，中间接头先穿芯再闭合；固定前把芯材居中。木芯在图中旁置示意，实际穿入管内。','Insert the 80 cm wood profile through the open tube end. Leave the protruding portion for the next tube; thread intermediate connectors before closure, then center the profile before fastening. The profile is illustrated beside the tube; insert it inside the tube.','80-cm-Holzprofil durch das offene Rohrende einschieben. Überstand für das nächste Rohr lassen; Zwischenkupplungen vor dem Schließen auffädeln und Profil vor dem Befestigen mittig ausrichten. Das Profil wird neben dem Rohr gezeigt; tatsächlich wird es in das Rohr eingeschoben.'),{consumesPartIds:[],movingEnvelopeIds:[channel.id],translation:channel.axis.map(v=>v*reach),direction:channel.axis.map(v=>-v),position:channel.start,placementTranslation:offset.map((v,i)=>v-regional[i]-staging[i]),referencePartIds:[channel.firstCarrier],reinforcementId:reinforcement?.id,channelId:channel.id,profileKey:channel.run.tubeIds[0],protrusionCm:80-reach,verification:{...verify(false,channel.valid),basis:channel.basis,crossSectionCompatibility:channel.crossSection}});
        coreOp.verification.basis=channel.basis;coreOp.verification.crossSectionCompatibility=channel.crossSection;present.add(channel.id);installed.add(channel.id);
      }
      return op;
    };
    for(const channel of core.channels)if(!runDone.has(channel)&&channel.run.tubeIds.some(id=>step.tubeIds.includes(id))){
      runDone.add(channel);
      if(!channel.valid)diag(diagnostics,'REINFORCEMENT_PLACEMENT_UNVERIFIED','加固型材的长度、材质或管内放置位置尚未确认，请核对原始设计与配件目录。',[...channel.run.tubeIds,...channel.middle],{span:channel.span,stepId:step.id});
      if(!step.tubeIds.includes(channel.firstCarrier))diag(diagnostics,'REINFORCEMENT_CHANNEL_SPLIT','木芯贯通列的入口管尚未安装，不能先封闭另一端。',[...channel.run.tubeIds,...channel.middle],{firstCarrier:channel.firstCarrier,stepId:step.id});
      emit('prepare-core-channel',[channel.firstCarrier],copy('先确认80cm木芯的连续管轴；入口管的另一端和中间接头暂时保持开放，芯材插入前不要封口。','Identify the continuous 80 cm wood-profile channel. Keep the entry tube and intermediate connector ports open until the profile is inserted.','Durchgehenden 80-cm-Holzprofilkanal bestimmen. Eintrittsrohr und Zwischenkupplung vor dem Einschieben offen lassen.'),{consumesPartIds:[],referencePartIds:[channel.firstCarrier],openPorts:channel.middle,verification:{...verify(false,channel.valid),basis:channel.basis,crossSectionCompatibility:channel.crossSection}});
    }
    for(const [key,map] of [['textileIds','textiles'],['fittingIds','fittings'],['clampIds','clamps']])for(const id of step[key]){
      const p=model[map].get(id);if(threadDone.has(id)||step.action.type==='attach')continue;
      if(!(map==='textiles'||(map==='clamps'&&p.connectorId!=='tube_clamp')||THREAD.has(p?.kind)))continue;
      const carriers=[...new Set((step.threadSupports?.[id]||tubeSupports(p)).filter(id=>model.tubes.has(id)))];
      threadDone.add(id);
      if(step.flexibleLinings?.[id]){
        const open=carriers.length>0&&carriers.every(tube=>step.tubeIds.includes(tube)&&!present.has(tube)),maxX=Math.max(...[...model.nodes.values()].map(n=>n.x)),minX=Math.min(...carriers.flatMap(id=>{const t=model.tubes.get(id);return [model.nodes.get(t.a).x,model.nodes.get(t.b).x];})),loose=[maxX+90+Math.max(Math.abs(p.w||120),Math.abs(p.d||160))+8-minX+softLinings.length*200,25,0],lining={id,carriers,loose,folded:true,basis:step.flexibleLinings[id].basis};softLinings.push(lining);
        emit('prepare-flexible-liner',[id],copy('在架体旁展开软衬示意，四边套管口保持开放；依次穿入每根围管，再连接角部与中间接头。软衬按官方方法随管件弯折，图示不是柔性仿真。','Keep all four liner sleeves open beside the frame. Thread each perimeter tube in turn before joining corner and intermediate connectors. The liner flexes as directed by the official guide; its illustration is schematic.','Alle vier Foliensäume neben dem Rahmen offen halten. Umfangsrohre einzeln auffädeln, danach Eck- und Zwischenkupplungen verbinden. Folie nach offizieller Anleitung biegen; Darstellung schematisch.'),{consumesPartIds:[id],placementTranslation:loose.map((v,i)=>v-regional[i]),referencePartIds:carriers,verification:{...verify(false,open),basis:lining.basis,pathApplicability:'not-applicable-flexible-preparation',deformationValidation:'official-method;not-simulated'}});
        if(!open)diag(diagnostics,'PRETHREAD_METHOD_UNVERIFIED','软衬围管未同时开放，必须在封端之前逐根穿入四边套管。',[id,...carriers],{open,stepId:step.id,basis:lining.basis});
        const threadAxis=tubeId=>{const t=model.tubes.get(tubeId),axis=unit(t.geom?.dir||sub(xyz(model.nodes.get(t.b)),xyz(model.nodes.get(t.a)))),dominant=axis.findIndex(v=>Math.abs(v)===Math.max(...axis.map(Math.abs)));return axis[dominant]<0?axis.map(v=>-v):axis;};
        const orderedCarriers=[...carriers].sort((a,b)=>{const da=threadAxis(a),db=threadAxis(b),ka=da.findIndex(v=>Math.abs(v)>.9),kb=db.findIndex(v=>Math.abs(v)>.9);const lo=(id,axis)=>Math.min(...[model.tubes.get(id).a,model.tubes.get(id).b].map(node=>dot(xyz(model.nodes.get(node)),axis)));return ka-kb||lo(a,da)-lo(b,db);});
        for(const tubeId of orderedCarriers){const t=model.tubes.get(tubeId),axis=threadAxis(tubeId),reach=Math.max(Math.abs(p.w||120),Math.abs(p.d||160))+8,translation=axis.map(v=>v*reach),obstruction=core.check([tubeId],[id],translation,[0,0,0],{allowMating:false});
          const external=checkPath([tubeId],[...present,...preparedRigid].filter(part=>part!==id),loose.map((v,i)=>v+translation[i]),loose,{obstacleTranslations:poses});
          const checked=open&&!obstruction&&!external;
          if(!checked)diag(diagnostics,'PRETHREAD_METHOD_UNVERIFIED','此围管的开放套管轴穿入路径尚未通过，请调整软衬与接头预装顺序。',[id,tubeId],{obstruction:obstruction||external,stepId:step.id,basis:lining.basis});
          emit('thread-flexible-carrier',[tubeId],copy('拿取图示围管，沿这一侧开放的布套轴穿入；两端暂不接角部或中间接头。','Thread this tube along its open liner sleeve; leave both connector ends open.','Dieses Rohr entlang seines offenen Foliensaums einschieben; beide Kupplungsenden offen lassen.'),{consumesPartIds:[],placementTranslation:loose.map((v,i)=>v-regional[i]),translation,direction:axis.map(v=>-v),position:xyz(model.nodes.get(t.a)),referencePartIds:[id],carrierPartIds:[tubeId],openPorts:[t.a,t.b],verification:{...verify(checked,checked),basis:lining.basis,deformationValidation:'official-method;not-simulated'}});
          preparedRigid.add(tubeId);threadAssemblies.push({id,carriers:[tubeId],loose,flexible:true,verification:verify(checked,checked)});
        }
        continue;
      }
      const vectors=carriers.map(id=>{const t=model.tubes.get(id);return unit(t.geom?.dir||sub(xyz(model.nodes.get(t.b)),xyz(model.nodes.get(t.a))));});
      const aligned=vectors.length&&vectors.every(d=>Math.abs(dot(d,vectors[0]))>.995),open=carriers.length&&carriers.every(id=>step.tubeIds.includes(id)&&!present.has(id));
      const corners=model.textiles.has(id)?model.panelCorners(p):null;
      const axis=vectors[0]||[1,0,0],origin=corners?corners[0].map((_,i)=>corners.reduce((sum,point)=>sum+point[i],0)/corners.length):xyz(p),reach=Math.max(0,...carriers.flatMap(id=>{const t=model.tubes.get(id);return [t.a,t.b].map(n=>Math.abs(dot(sub(xyz(model.nodes.get(n)),origin),axis)));}))+8;
      const translation=axis.map(v=>v*reach),obstruction=aligned&&open?checkPath([id],carriers,translation,[0,0,0],{allowMating:false}):null;
      const clampPorts=map!=='clamps'||(carriers.length===2&&Math.abs(Math.hypot(...(p.off||[]))-5)<.05&&Math.abs(dot(unit(p.dir||[1,0,0]),unit(p.off||[0,1,0])))<.005&&[origin,origin.map((v,i)=>v+(p.off?.[i]||0))].every(center=>carriers.some(id=>{const t=model.tubes.get(id),a=xyz(model.nodes.get(t.a)),d=unit(sub(xyz(model.nodes.get(t.b)),a)),r=sub(center,a),along=dot(r,d);return along>=0&&along<=Math.hypot(...sub(xyz(model.nodes.get(t.b)),a))&&Math.hypot(...r.map((x,k)=>x-d[k]*along))<.01;})));
      const checked=!!(clampPorts&&aligned&&open&&origin.every(Number.isFinite)&&translation.every(Number.isFinite)&&!obstruction&&partEnvelope(model,id).length);
      const minX=Math.min(...carriers.flatMap(id=>{const t=model.tubes.get(id);return [model.nodes.get(t.a).x,model.nodes.get(t.b).x];}),origin[0]),maxX=Math.max(...[...model.nodes.values()].map(n=>n.x));
      const loose=[maxX+65-minX,18,0],local=loose.map((v,i)=>v-regional[i]);
      const verification=verify(checked,checked);if(checked)for(const carrier of carriers){preparedRigid.add(carrier);poses.set(carrier,loose);}threadAssemblies.push({id,carriers,verification,loose});
      if(!checked)diag(diagnostics,'PRETHREAD_METHOD_UNVERIFIED','穿管轴尚未同时开放、载管不共轴，或真实穿入路径受阻，不能确认安装方法。',[id,...carriers],{carrierPartIds:carriers,aligned,open,clampPorts,obstruction,stepId:step.id});
      emit('prethread-accessory',[id],copy('在架体旁拿取图示管件组，保持相对位置；沿箭头把配件同时穿过这些开放管轴，再按后续动作整体插接。','Beside the frame, align the shown loose tubes. Slide the accessory along the arrow onto their open axes, then insert the threaded group together.','Lose Rohre neben dem Rahmen in gezeigter Ausrichtung halten. Zubehör entlang des Pfeils auf die offenen Achsen schieben; anschließend die Rohrgruppe zusammen einsetzen.'),{referencePartIds:carriers,carrierPartIds:carriers,placementTranslation:local,displayTransforms:Object.fromEntries(carriers.map(id=>[id,loose])),translation,direction:axis.map(v=>-v),position:origin,openPorts:carriers.flatMap(id=>{const t=model.tubes.get(id);return [t.a,t.b];}),verification});
    }
    const unfold=(offset=[0,0,0],scope=step.tubeIds)=>{
      for(const lining of softLinings.filter(lining=>lining.folded&&lining.carriers.every(id=>scope.includes(id)&&present.has(id)))){
        const obstruction=core.check([lining.id],[...present].filter(id=>id!==lining.id),offset,offset,{obstacleTranslations:poses});
        if(obstruction)diag(diagnostics,'INSTALLATION_PATH_BLOCKED','软衬展开后的实际实体与已装部件相交，请调整围管或相邻附件。',[lining.id,obstruction.obstaclePartId],{...obstruction,type:'unfold-flexible-liner'});
        emit('unfold-flexible-liner',[lining.id],copy('围管与接头完成后展开软衬，确认四边均落在对应支撑上；此后按展开形态检查相邻部件。','After joining the perimeter tubes and connectors, unfold the liner onto all four supports. Subsequent parts must clear its expanded shape.','Nach dem Verbinden der Umfangsrohre und Kupplungen Folie auf alle vier Stützen entfalten. Folgeteile müssen die entfaltete Form freilassen.'),{consumesPartIds:[],placementTranslation:offset.map((v,i)=>v-regional[i]-staging[i]),referencePartIds:lining.carriers,verification:{...verify(!obstruction,!obstruction),basis:lining.basis,pathApplicability:'expanded-shape-checked;flexible-deformation-not-simulated',deformationValidation:'official-method;not-simulated'}});
        poses.set(lining.id,offset);lining.folded=false;
      }
    };
    const physicalTubes=step.tubeIds.filter(id=>{const t=model.tubes.get(id);return t&&!t.arm&&!t.link;});
    const currentNodes=new Set(step.nodeIds),handled=new Set();
    let modules=(step.action.modules||[]).map(m=>plan.frameModules.find(f=>f.id===m.id)).filter(Boolean);
    for(const thread of threadAssemblies.filter(thread=>!thread.flexible&&thread.verification.methodChecked)){
      const connected=modules.filter(m=>thread.carriers.some(id=>m.tubeIds.includes(id)));
      if(connected.length<2)continue;
      const first=connected[0];
      for(const key of ['nodeIds','tubeIds','partIds','interfaceIds'])first[key]=[...new Set(connected.flatMap(m=>m[key]))];
      first.installationTranslation=[0,Math.max(...connected.map(m=>m.installationTranslation[1])),0];
      for(const m of connected.slice(1)){
        for(const mark of plan.interfaces)if(mark.assemblyId===m.id)mark.assemblyId=first.id;
        plan.frameModules.splice(plan.frameModules.indexOf(m),1);
      }
      modules=modules.filter(m=>!connected.slice(1).includes(m));
      step.action.modules=step.action.modules.filter(m=>!connected.slice(1).some(other=>other.id===m.id));
      const visual=step.action.modules.find(m=>m.id===first.id);Object.assign(visual,{partIds:first.partIds,translation:first.installationTranslation,interfaceIds:first.interfaceIds});
    }
    for(const m of modules){
      for(const channel of core.channels.filter(c=>c.active&&Math.abs(c.axis[1])>.995&&c.middle.some(id=>m.nodeIds.includes(id)))){const tip=channel.end[1]+(poses.get(channel.id)?.[1]||0),lowest=Math.min(...m.nodeIds.map(id=>model.nodes.get(id).y));m.installationTranslation[1]=Math.max(m.installationTranslation[1],tip-lowest+12);const visual=step.action.modules.find(v=>v.id===m.id);visual.translation=[...m.installationTranslation];}
      const carried=step.operations.filter(op=>op.type==='prethread-accessory' && op.carrierPartIds?.some(id=>m.tubeIds.includes(id))).flatMap(op=>op.partIds);
      m.partIds=[...new Set([...m.partIds,...carried])];
      const visualModule=step.action.modules.find(module=>module.id===m.id); if(visualModule)visualModule.partIds=[...m.partIds];
      staging=m.installationTranslation;
      frameSequence(model,m.nodeIds,m.tubeIds,emit,diagnostics,threadAssemblies.filter(thread=>!thread.flexible&&thread.carriers.every(id=>m.tubeIds.includes(id))));
      unfold(staging,m.tubeIds);for(const lining of softLinings.filter(l=>!l.folded&&l.carriers.every(id=>m.tubeIds.includes(id)))){m.partIds.push(lining.id);visualModule.partIds=[...m.partIds];}
      staging=[0,0,0];for(const id of m.partIds)handled.add(id);
      const obstruction=checkPath(m.partIds,[...installed],m.installationTranslation);
      const op=emit('lower-frame',m.partIds,copy('先拼好此局部框架，分别对齐本组立柱，沿箭头向下套入；其他独立框架按后续动作安装。','Preassemble this frame, align these uprights and lower it along the arrow. Install other separate frames in their own actions.','Diesen Rahmen vormontieren, an diesen Stützen ausrichten und entlang des Pfeils absenken. Andere Rahmen einzeln montieren.'),{consumesPartIds:[],translation:m.installationTranslation,direction:[0,-1,0],position:xyz(model.nodes.get(m.nodeIds[0])),referencePartIds:m.interfaceIds.map(id=>plan.interfaces.find(x=>x.id===id)?.supportTubeId).filter(Boolean),verification:verify(!obstruction)});
      if(obstruction)op.verification.methodChecked=false;
    }
    const remainingTubes=physicalTubes.filter(id=>!handled.has(id));
    const freeNodes=step.nodeIds.filter(id=>!handled.has(id));
    const fixedEnds=remainingTubes.flatMap(id=>{const t=model.tubes.get(id);return [t.a,t.b].filter(n=>installed.has(n));});
    if(step.action.type==='attach'){
      emit('attach-module',step.partIds,copy('对齐图示接口，将预装模块沿箭头移入；支撑主体保持原位。','Align the shown ports and move the preassembled module along the arrow; keep the supporting frame in place.','Vormontiertes Modul an den Anschlüssen ausrichten und entlang des Pfeils einsetzen; tragenden Rahmen stehen lassen.'),{consumesPartIds:[],translation:plan.regions.find(r=>r.id===step.regionId)?.detachedTranslation,direction:plan.regions.find(r=>r.id===step.regionId)?.installation?.direction,verification:verify(plan.regions.find(r=>r.id===step.regionId)?.installation?.pathVerified===true)});
    }else if(remainingTubes.length && fixedEnds.length===0){
      const ownNodes=[...new Set([...freeNodes,...remainingTubes.flatMap(id=>{const t=model.tubes.get(id);return [t.a,t.b];})])];frameSequence(model,ownNodes,remainingTubes,emit,diagnostics,threadAssemblies.filter(thread=>!thread.flexible&&thread.carriers.every(id=>remainingTubes.includes(id))));for(const id of ownNodes)handled.add(id);for(const id of remainingTubes)handled.add(id);
    }else {
      for(const id of freeNodes)emit('orient-connector',[id],copy('摆正高亮连接件，保留下一动作所需插口。','Orient the highlighted connector; keep the ports for the next action open.','Markierte Kupplung ausrichten; erforderliche Anschlüsse freilassen.'),{openPorts:[id]});
      for(const id of remainingTubes){const t=model.tubes.get(id),anchors=[t.a,t.b].filter(n=>installed.has(n));
        if(anchors.length>1){diag(diagnostics,'UNVERIFIED_IN_PLACE_CLOSURE','管件两端接头已经接入主体，原位封口没有已验证的替代顺序；请先留开接头或改为预装框架。',[id,...anchors]);emit('unresolved-closure',[id],copy('两端均已连接：此原位安装方法尚未确认，调整顺序后再导出。','Both end connectors are already joined: this installation sequence is unresolved; adjust it before export.','Beide Endkupplungen sind bereits verbunden: Montagefolge ungeklärt; vor dem Export anpassen.'),{verification:verify(false,false)});continue;}
        const anchor=anchors[0]||t.a,free=anchor===t.a?t.b:t.a,d=unit(model._tubeDirAt(t,model.nodes.get(anchor),model.nodes.get(free))),translation=d.map(v=>v*12),obstruction=checkPath([id],[...installed],translation);
        emit('insert-tube',[id],copy(`拿取${partName(getTube(t.tubeId))}，沿箭头插入箭头所指接头，另一端保持开放。`,`Insert ${partName(getTube(t.tubeId))} into the connector indicated by the arrow; keep the other end open.`,`${partName(getTube(t.tubeId))} entlang des Pfeils in die vom Pfeil angezeigte Kupplung einsetzen; anderes Ende offen lassen.`),{referencePartIds:[anchor],translation,direction:d.map(v=>-v),position:xyz(model.nodes.get(anchor)),openPorts:[free],verification:verify(!obstruction,!obstruction)});

      }
    }
    unfold(regional);
    for(const id of (step.action.type==='attach'?[]:[...step.panelIds,...step.fittingIds,...step.slideIds,...step.clampIds]).filter(id=>!threadDone.has(id)).sort((a,b)=>{const rank=id=>model.panels.has(id)&&!step.panelAfterSlide?.[id]?-2.5:model.slides.get(id)?.kind==='slide-end2'?-3:model.slides.get(id)?.kind==='slide2'?-2:({'bearing2':0,'adapter2':1,'multi-wheel2':2,'floating-wheel2':2,'steering-lock2':3,'hub-cap2':3})[model.fittings.get(id)?.kind]??4;return rank(a)-rank(b);} )){
      const native=(model.fittings.has(id)&&!model.fittings.get(id).appearanceVersion)||model.slides.has(id)?nativeAccessorySupport(model,id):null;
      if(native&&!native.valid)diag(diagnostics,'NATIVE_SUPPORT_UNRESOLVED','原生配件缺少与实际安装点和插接轴相符的支撑，不能用无遮挡位置代替安装方法。',[id],native);
      const panel=model.panels.get(id),specialFrame=panel&&isOriginalComponent(panel)?componentFrame(model,panel):null;
      // Component appearance uses its own mounting frame, including facing;
      // the generic model-middle outward normal can point through its back.
      const specialNormal=specialFrame&&(panel.appearanceVersion===1&&panel.panelId==='panel_40x40_pocket'?specialFrame.axes[1]:specialFrame.axes[2]);
      const envelope=partEnvelope(model,id),normals=(envelope[0]?.axes || (envelope[0]?.points?[unit(cross(sub(envelope[0].points[1],envelope[0].points[0]),sub(envelope[0].points[2],envelope[0].points[0])))]:[])).flatMap(axis=>[axis.map(v=>v*18),axis.map(v=>v*-18)]),panelCorners=model.panels.has(id)?model.panelCorners(model.panels.get(id)):null,panelNormal=specialNormal||(panelCorners&&(model.panels.get(id).geom?.quat?zAxisOf(model.panels.get(id).geom.quat):panelMountNormal(unit(sub(panelCorners[1],panelCorners[0])),unit(sub(panelCorners[3],panelCorners[0])),panelCorners[0].map((_,i)=>panelCorners.reduce((sum,p)=>sum+p[i],0)/4),modelMiddle(model.nodes.values())).map(v=>v*(model.panels.get(id).side<0?-1:1)))),panelDepth=panelNormal?envelope.flatMap(shape=>shape.points?shape.points.map(point=>dot(point,panelNormal)):shape.kind==='box'?[dot(shape.pos,panelNormal)-shape.half.reduce((sum,h,i)=>sum+h*Math.abs(dot(shape.axes[i],panelNormal)),0),dot(shape.pos,panelNormal)+shape.half.reduce((sum,h,i)=>sum+h*Math.abs(dot(shape.axes[i],panelNormal)),0)]:[]):[],panelReach=panelDepth.length?Math.max(8,Math.max(...panelDepth)-Math.min(...panelDepth)+3):18,panelApproaches=panelNormal?[panelNormal.map(v=>v*panelReach),panelNormal.map(v=>v*Math.max(18,panelReach))]:[],candidates=panelNormal?panelApproaches:model.slides.has(id)?[[0,18,0]]:native?.valid&&model.fittings.has(id)?[native.mount.direction.map(v=>v*18)]:[...normals,[0,18,0],[18,0,0],[-18,0,0],[0,0,18],[0,0,-18],[0,-18,0]];
      const failures=[];let translation;const tried=new Set();for(const delta of candidates){const key=delta.map(v=>v.toFixed(4)).join(',');if(tried.has(key))continue;tried.add(key);const failure=checkPath([id],[...present],delta.map((v,i)=>v+regional[i]),regional,{obstacleTranslations:poses});failures.push(failure);if(!failure){translation=delta;break;}}
      if(!envelope.length || !translation)diag(diagnostics,'ACCESSORY_INSTALLATION_PATH_UNRESOLVED','板面或配件没有可确认的无遮挡安装路径，请调整朝向、支撑或区域顺序。',[id],{candidates:candidates.length,failures});
      const entry=[...entryPanelContacts.values()].find(contact=>contact.panelId===id);
      const component=model.panels.get(id)||model.fittings.get(id),special=isOriginalComponent(component)?componentInstallCopy(componentPartId(component),component):null;
      const fitOp=emit('fit-accessory',[id],special?.instructions[0]||copy('拿取图中配件，按图示朝向固定到已完成的支撑；确认所有相邻框架已拼接后再遮盖接口。','Fit the shown accessory to the completed support; cover ports only after adjacent frames are joined.','Gezeigtes Zubehör an der fertigen Stütze befestigen; Anschlüsse erst nach dem Verbinden benachbarter Rahmen abdecken.'),{...(special?{instructions:[...special.instructions],componentId:componentPartId(component),installationCopyBasis:'component-catalog-special-instructions'}:{}),referencePartIds:[...new Set([...(step.panelSupports?.[id]||tubeSupports(model.panels.get(id)||model.fittings.get(id)||{})),...(native?.supportIds||[]),...(entry?[entry.slideId,entry.railId]:[]),...(step.clampSupports?.[id]||[]),...(step.bearingSupports?.[id]?[step.bearingSupports[id]]:[])])],translation,direction:translation&&unit(translation).map(v=>-v),position:envelope[0]?.pos||envelope[0]?.points?.[0]||[0,step.y,0],verification:verify(!!translation,!!translation)});
      const supportPoses=fitOp.referencePartIds.map(partId=>({partId,translation:poses.get(partId)||[0,0,0],installed:present.has(partId)})),aligned=(supportPoses.length>0||native?.groundSupport)&&supportPoses.every(support=>support.installed&&Math.hypot(...sub(support.translation,fitOp.placementTranslation))<1e-6);
      fitOp.verification.mountSupport=native?.basis||'explicit-perimeter-support';fitOp.verification.supportPoses=supportPoses;
      if(!aligned||(native&&!native.valid)){fitOp.verification.methodChecked=false;if(!native||native.valid)diag(diagnostics,'NATIVE_SUPPORT_UNRESOLVED','配件安装时其真实支撑未就位或位移不同，必须先落位支撑模块再安装配件。',[id,...fitOp.referencePartIds],{operationId:fitOp.id,supportPoses,placementTranslation:fitOp.placementTranslation});}
      if(entry)fitOp.verification.installationBasis=entry.basis;
    }
    for(const id of step.partIds)installed.add(id);
    // Auxiliary topology entities are not physical tubes but must keep single ownership.
    const consumed=new Set(step.operations.flatMap(op=>op.consumesPartIds));
    for(const id of step.partIds)if(!consumed.has(id)&&step.action.type!=='attach')emit('topology-reference',[id],copy('图示连接关系随本组接头建立，不额外增加物料。','This connection is established with the shown connectors; no additional material.','Diese Verbindung entsteht mit den gezeigten Kupplungen; kein zusätzliches Material.'),{verification:verify(false)});
    if(['frame','risers'].includes(step.kind))step.instructions.push(copy('本层接口先保持未固定；主体完整拼好后，再按层由下往上固定；面板采用其专用固定方式。','Leave the layer joints unfastened. After the whole main frame is assembled, secure layers from bottom to top; use the panel-specific fastening method.','Anschlüsse dieser Ebene zunächst nicht befestigen. Erst nach dem vollständigen Zusammenstecken des gesamten Grundrahmens Ebenen von unten nach oben befestigen; Platten nach ihrer eigenen Methode sichern.'));
    step.detailGroups=[];let batch=[];
    const flush=()=>{if(!batch.length)return;const partIds=[...new Set(batch.flatMap(op=>[...op.partIds,...(op.referencePartIds||[])]))];const keys=[...new Set(partIds.flatMap(materialKeys))];step.detailGroups.push({id:`${step.id}-detail-${step.detailGroups.length+1}`,title:copy(`动作 ${batch.map(op=>op.order).join('、')}`,`Actions ${batch.map(op=>op.order).join(', ')}`,`Aktionen ${batch.map(op=>op.order).join(', ')}`),operationIds:batch.map(op=>op.id),partIds,instructions:batch.flatMap(op=>op.instructions),materialKeys:keys,viewDirection:batch.some(op=>op.partIds.some(id=>model.slides.get(id)?.kind==='roof2'))?'bottom':batch.some(op=>op.partIds.some(id=>model.panels.get(id)?.side<0||model.fittings.get(id)?.facing<0))?'back':'front',operationNumbers:batch.map(op=>({id:op.id,order:op.order,partIds:op.partIds}))});batch=[];};
    for(const op of step.operations){const keys=new Set([...batch,op].flatMap(o=>o.partIds.flatMap(materialKeys)));const repeatedMotion=op.translation&&batch.some(previous=>previous.translation&&previous.partIds.some(id=>op.partIds.includes(id)));if(batch.length&&(repeatedMotion||keys.size>6||batch.length>=3||op.type==='lower-frame'||op.type==='attach-module'||batch.some(o=>['lower-frame','attach-module'].includes(o.type))))flush();batch.push(op);}flush();
    // A dense moving frame may reference many material types: split focus groups without repeating consumption.
    step.detailGroups=step.detailGroups.flatMap(group=>{if(group.materialKeys.length<=6)return [group];const out=[];for(let i=0;i<group.materialKeys.length;i+=6){const keys=group.materialKeys.slice(i,i+6);out.push({...group,id:`${group.id}-${i/6+1}`,materialKeys:keys,partIds:group.partIds.filter(id=>materialKeys(id).some(k=>keys.includes(k)))});}return out;});
  }
  for (const p of [...model.fittings.values(),...model.slides.values()]) if(!p.appearanceVersion && !nativeEnvelopes[p.kind])diag(diagnostics,'UNKNOWN_INSTALLATION_GEOMETRY','此配件缺少可核验的几何包络，无法确认安装路径。',[p.id],{kind:p.kind});
  const completed=new Set();for(const step of steps)for(const op of step.operations){for(const id of op.dependsOn)if(!completed.has(id))diag(diagnostics,'INVALID_OPERATION_DEPENDENCY','安装动作的前置动作尚未完成。',op.partIds,{operationId:op.id,dependsOn:id});completed.add(op.id);}
  const operations=steps.flatMap(step=>step.operations);
  const consumption=new Map();
  for(const op of operations)for(const id of op.consumesPartIds)consumption.set(id,(consumption.get(id)||0)+1);
  const entities=[...Object.values(MAPS)].flatMap(key=>[...model[key].keys()]);
  for(const id of entities)if(consumption.get(id)!==1)diag(diagnostics,'OPERATION_CONSUMPTION_MISMATCH','安装动作的实体消耗必须恰好一次。',[id],{count:consumption.get(id)||0});
  // The existing BOM allocation is authoritative. Detail pages never allocate again.
  for(const op of operations)op.consumesMaterialInstanceIds=[];
  for(const instance of plan.ledger.instances){
    if(instance.group==='screws')continue;
    const candidates=operations.filter(op=>instance.partIds.some(id=>op.consumesPartIds.includes(id)));
    const core=instance.group==='reinforcements'?operations.find(op=>op.type==='preinsert-reinforcement' && instance.partIds.some(id=>op.partIds.includes(id))):null;
    const first=core||candidates[0];
    if(first){
      first.consumesMaterialInstanceIds.push(instance.id);
      // A cross-layer core is taken when its first open carrier is installed,
      // not when the final carrier later closes the channel.
      if(instance.group==='reinforcements'){
        const target=steps.find(step=>step.operations.includes(first)),old=steps.find(step=>step.id===instance.stepId);
        if(target&&old&&target!==old){const row=old.parts.reinforcements.find(row=>row.id===reinforcement?.id);if(row){row.count-=instance.count;row.instanceIds=row.instanceIds.filter(id=>!instance.partIds.includes(id));row.subtotal=Math.round((row.price||0)*row.count*100)/100;let assigned=target.parts.reinforcements.find(item=>item.id===row.id);if(assigned){assigned.count+=instance.count;assigned.instanceIds.push(...instance.partIds);assigned.subtotal=Math.round((assigned.price||0)*assigned.count*100)/100;}else target.parts.reinforcements.push({...row,count:instance.count,instanceIds:[...instance.partIds],subtotal:Math.round((row.price||0)*instance.count*100)/100});old.parts.reinforcements=old.parts.reinforcements.filter(item=>item.count>0);old.reinforcements=old.parts.reinforcements;target.reinforcements=target.parts.reinforcements;instance.stepId=target.id;instance.regionId=target.regionId;}}
      }
    }
    else diag(diagnostics,'OPERATION_MATERIAL_UNASSIGNED','物料台账没有对应的安装动作。',instance.partIds,{instanceId:instance.id});
  }

  plan.verification={directionChecked:operations.every(op=>op.verification.directionConsistent),pathChecked:!diagnostics.some(d=>['INSTALLATION_PATH_BLOCKED','ACCESSORY_INSTALLATION_PATH_UNRESOLVED','UNKNOWN_INSTALLATION_GEOMETRY','PRETHREAD_METHOD_UNVERIFIED','REINFORCEMENT_PATH_UNVERIFIED','REINFORCEMENT_CHANNEL_SPLIT','REINFORCEMENT_PLACEMENT_UNVERIFIED','MISSING_THREAD_SUPPORT'].includes(d.code))&&operations.filter(op=>op.translation).every(op=>op.verification.pathChecked),methodChecked:!diagnostics.some(d=>d.severity==='error')&&operations.every(op=>op.verification.methodChecked),physical:'unverified',load:'unverified'};
}
