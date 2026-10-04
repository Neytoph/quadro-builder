import { confirmedSpec, legoStudHeight } from './componentPack.js';
import { INSET_PANEL_IDS, INSET_MOUNT_LAYOUT, hasInsetScrews, oppositeScrewSupports, insetScrewVolumes, insetPanelReference, insetPanelProbes } from './insetPanelMounts.js';
import { quatFromBasis, xAxisOf, yAxisOf, zAxisOf } from './util.js';

export const cSub = (a, b) => a.map((v, i) => v - b[i]);
export const cDot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v/l); };
const xyz = n => [n.x,n.y,n.z];
const center = points => points[0].map((_,i) => points.reduce((n,p) => n+p[i],0)/points.length);
const bad = (reason, probe = {}) => ({...probe,valid:false,reason,mounts:[],supportTubes:[]});
const validQuat = q => Array.isArray(q) && q.length === 4 && q.every(Number.isFinite) && Math.abs(Math.hypot(...q)-1)<0.001;
const sameRotation = (a,b) => validQuat(a) && validQuat(b) && Math.abs(cDot(a,b))>0.9999;
const sameMounts = (saved, expected) => {
  if(saved.length!==expected.length)return false;
  const remaining=[...expected];
  return saved.every(s=>{const index=remaining.findIndex(m=>m.tube===s.tube && m.role===s.role && Math.abs(m.width-s.width)<0.01 && Math.abs(m.t-s.t)<0.001);if(index<0)return false;remaining.splice(index,1);return true;});
};
export const rungPositions = length => { const count=Math.max(2,Math.floor((length-14)/10)+1);return Array.from({length:count},(_,i)=>7+i*(length-14)/(count-1)); };
export function componentSize(part,spec=confirmedSpec(part.panelId||part.kind||part.partId)) {
  return spec?.feature==='trampoline' ? {width:part.params?.width ?? part.w ?? 40,height:part.params?.height ?? part.h ?? 40} : spec;
}

export function curvePoint(model, tubeId, t) {
  const tube = model.tubes.get(tubeId), a = tube && model.nodes.get(tube.a), b = tube && model.nodes.get(tube.b);
  if (!a || !b || !Number.isFinite(t)) return null;
  if (!tube.bow) return xyz(a).map((v,i) => v+(xyz(b)[i]-v)*t);
  if (!Array.isArray(tube.bowCenter) || !tube.bowCenter.every(Number.isFinite)) return null;
  const c = tube.bowCenter, va=cSub(xyz(a),c), vb=cSub(xyz(b),c), angle=t*Math.PI/2;
  return c.map((v,i) => v+va[i]*Math.cos(angle)+vb[i]*Math.sin(angle));
}

export function confirmedFrame(model, part) {
  const base=confirmedSpec(part.panelId || part.kind || part.partId),spec=base && {...base,...componentSize(part,base)};
  if (!spec) return null;
  if (part.kind) {
    if (![part.x,part.y,part.z].every(Number.isFinite) || !validQuat(part.quat)) return null;
    return {pos:[part.x,part.y,part.z],axes:[xAxisOf(part.quat),yAxisOf(part.quat),zAxisOf(part.quat)],quat:part.quat};
  }
  const cor=model.panelCorners(part);
  if (!cor || cor.some(p=>!p.every(Number.isFinite))) return null;
  let x=unit(cSub(cor[1],cor[0])), y=unit(cSub(cor[3],cor[0]));
  if((hasInsetScrews(part) && part.params?.screwAxis!=='horizontal') || Math.abs(Math.hypot(...cSub(cor[1],cor[0]))-spec.width)>0.5) [x,y]=[y,x];
  let z=unit(cross(x,y));
  if(Math.abs(z[1])<0.01) {const raw=unit(cross(unit(cSub(cor[1],cor[0])),unit(cSub(cor[3],cor[0]))));z=raw;y=[0,1,0];x=unit(cross(y,z));}
  const sign=Math.abs(z[1])>0.999 ? (z[1]<0?-1:1) : (part.side||1);
  if(sign<0) {x=x.map(v=>-v);z=z.map(v=>-v);}
  if (![...x,...y,...z].every(Number.isFinite)) return null;
  return {pos:center(cor),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
}
export function localToWorld(frame,p) {return frame.pos.map((v,i)=>v+frame.axes.reduce((s,a,k)=>s+a[i]*p[k],0));}
export function worldToLocal(frame,p) {const d=cSub(p,frame.pos);return frame.axes.map(a=>cDot(d,a));}
export function cVolume(frame,lo,hi) {return {pos:localToWorld(frame,lo.map((v,i)=>(v+hi[i])/2)),axes:frame.axes,half:lo.map((v,i)=>(hi[i]-v)/2)};}

function edgeSupports(model, corners, density=0) {
  const supportTubes=new Set(),mounts=[];
  for(let i=0;i<4;i++) {
    const a=corners[i],b=corners[(i+1)%4],d=unit(cSub(b,a)),L=Math.hypot(...cSub(b,a)),spans=[];
    for(const tube of model.tubes.values()) {
      const rail=model._rail(tube.id);if(!rail || Math.abs(cDot(rail.dir,d))<0.999)continue;
      const delta=cSub(rail.p0,a),start=cDot(delta,d);
      if(Math.hypot(...cSub(delta,d.map(v=>v*start)))>0.35)continue;
      const end=start+rail.len*cDot(rail.dir,d),lo=Math.max(0,Math.min(start,end)),hi=Math.min(L,Math.max(start,end));
      if(hi>lo)spans.push({rail,tube,lo,hi});
    }
    spans.sort((a,b)=>a.lo-b.lo);let reach=0;
    for(const s of spans){if(s.lo>reach+0.35)break;reach=Math.max(reach,s.hi);supportTubes.add(s.tube.id);}
    if(reach<L-0.35)return null;
    const positions=density?Array.from({length:Math.max(2,Math.floor((L-8)/density)+1)},(_,k)=>4+k*(L-8)/Math.max(1,Math.floor((L-8)/density))):[4];
    for(const position of positions) {
      const s=spans.find(s=>s.lo<=position && s.hi>=position);if(!s)return null;
      const p=a.map((v,k)=>v+d[k]*position),t=cDot(cSub(p,s.rail.p0),s.rail.dir)/s.rail.len;
      mounts.push({tube:s.tube.id,t,role:density?'lacing':'retainer',width:density?0.8:2,edge:i});
    }
  }
  return {mounts,supportTubes:[...supportTubes]};
}

export function confirmedPanelDiagnostics(model,probe,{legacyInset=false,screwAxis=probe.params?.screwAxis || 'vertical'}={}) {
  const spec=confirmedSpec(probe.panelId); if(!spec)return bad('frame_size',probe);
  const cor=model.panelCorners(probe);if(!cor)return bad('missing_support',probe);
  const lengths=[Math.hypot(...cSub(cor[1],cor[0])),Math.hypot(...cSub(cor[3],cor[0]))].sort((a,b)=>a-b),dims=[spec.width,spec.height].sort((a,b)=>a-b);
  if(lengths.some((v,i)=>Math.abs(v-dims[i])>0.5))return bad('frame_size',probe);
  const normal=unit(cross(cSub(cor[1],cor[0]),cSub(cor[3],cor[0])));
  if(spec.mountType==='vertical-frame' && Math.abs(normal[1])>0.01)return bad('vertical_frame',probe);
  if(spec.mountType==='horizontal-frame' && Math.abs(normal[1])<0.999)return bad('horizontal_frame',probe);
  const inset=INSET_PANEL_IDS.has(spec.id),legacy=legacyInset || (probe.appearanceVersion===2 && Array.isArray(probe.mounts) && probe.params?.mountLayout==null);
  if(inset && !['vertical','horizontal'].includes(screwAxis))return bad('missing_support',probe);
  const frameForSupports=confirmedFrame(model,probe);
  const supports=inset && !legacy ? oppositeScrewSupports(model,frameForSupports,spec.width,spec.height,{screwAxis}) : edgeSupports(model,cor);
  if(!supports)return bad(inset && !legacy?'opposite_edges':'four_edges',probe);
  const result={...probe,...supports,appearanceVersion:2,params:{...spec},valid:true,reason:null};
  if(inset && !legacy){
    Object.assign(result,insetPanelReference(model,frameForSupports,spec.width,spec.height,supports,{screwAxis}));
    if(probe.appearanceVersion!==2 || probe.params?.screwAxis!=null)result.params.screwAxis=screwAxis;
    result.side=1;
    if(cDot(confirmedFrame(model,result).axes[2],frameForSupports.axes[2])<0)result.side=-1;
  }
  const frame=confirmedFrame(model,result);if(!frame)return bad('missing_support',probe);
  if(spec.feature==='basketball') {
    const mounts=[];
    for(const x of [-spec.width/2,spec.width/2])for(const y of [-spec.height/2+6,spec.height/2-6]) {
      const point=localToWorld(frame,[x,y,0]);
      const tubeId=supports.supportTubes.find(id=>{const r=model._rail(id),t=cDot(cSub(point,r.p0),r.dir)/r.len;return t>=0 && t<=1 && Math.hypot(...cSub(curvePoint(model,id,t),point))<0.35;});
      if(!tubeId)return bad('four_corners',probe);
      const r=model._rail(tubeId);mounts.push({tube:tubeId,t:cDot(cSub(point,r.p0),r.dir)/r.len,role:'side-clamp',width:2});
    }result.mounts=mounts;
  }
  if(spec.feature==='basin' && frame.pos[1]<spec.depth+3)return {...result,valid:false,reason:'ground_clearance'};
  return {...result,pos:frame.pos};
}

function asFitting(spec,probe,frame,supports) {return {...probe,tube:probe.tube||probe.a,kind:spec.kind||spec.id,partId:spec.id,x:frame.pos[0],y:frame.pos[1],z:frame.pos[2],quat:frame.quat,...supports,appearanceVersion:2,params:{...spec},valid:true,reason:null,pos:frame.pos};}
export function trampolineCandidate(model,probe) {
  const spec=confirmedSpec('trampoline'),size=componentSize(probe,spec),cor=model.panelCorners(probe);
  if(!cor || !spec.sizes.some(([w,h])=>w===size.width && h===size.height))return bad('frame_size',probe);
  const e=cSub(cor[1],cor[0]),v=cSub(cor[3],cor[0]),lengths=[Math.hypot(...e),Math.hypot(...v)].sort((a,b)=>a-b),dims=[size.width,size.height].sort((a,b)=>a-b);
  if(lengths.some((n,i)=>Math.abs(n-dims[i])>.35))return bad('frame_size',probe);
  const normal=unit(cross(e,v));if(Math.abs(normal[1])<.999)return bad('horizontal_frame',probe);
  const supports=edgeSupports(model,cor,4);if(!supports)return bad('four_edges',probe);
  const frame=confirmedFrame(model,{...probe,kind:undefined,panelId:spec.id});
  if(probe.kind){
    const stored=confirmedFrame(model,probe);
    if(!stored || Math.hypot(...cSub(stored.pos,center(cor)))>.1 || stored.axes[2][1]<.999)return bad('missing_support',probe);
    const widthEdges=[e,v].filter(edge=>Math.abs(Math.hypot(...edge)-size.width)<.35);
    if(!widthEdges.some(edge=>Math.abs(cDot(unit(edge),stored.axes[0]))>.999))return bad('missing_support',probe);
    Object.assign(frame,stored);
  }
  const candidate={...asFitting({...spec,...size},probe,frame,supports),w:size.width,h:size.height,facing:1};
  delete candidate.panelId;return candidate;
}
function trampolineCandidates(model,spec) {
  const out=[],seen=new Set();
  const horizontal={tubes:new Map([...model.tubes].filter(([id])=>Math.abs(model._rail(id)?.dir[1] ?? 1)<.001)),_rail:id=>model._rail(id)};
  for(const [width,height] of spec.sizes){
    const sized={...spec,width,height};
    for(const probe of insetPanelProbes(horizontal,width,height)){
      const cor=model.panelCorners(probe);if(!cor)continue;
      const key=width+'x'+height+':'+cor.map(p=>p.map(v=>v.toFixed(2)).join(',')).sort().join('|');if(seen.has(key))continue;
      const frame=confirmedFrame(model,{...probe,panelId:spec.id,params:{width,height},side:1});
      if(!frame || Math.abs(frame.axes[2][1])<.999)continue;
      const supports=edgeSupports(model,cor,4);if(!supports)continue;
      const a=supports.mounts.find(m=>m.edge===0).tube,b=supports.mounts.find(m=>m.edge===2).tube,rail=model._rail(a),e=cSub(cor[1],cor[0]);
      const start=cDot(rail.dir,e)>0?cor[0]:cor[1];
      const reference={a,b,t0:cDot(cSub(start,rail.p0),rail.dir),len:Math.hypot(...e),params:{width,height}};
      const candidate=trampolineCandidate(model,reference);
      if(candidate.valid){out.push({...candidate,params:{...sized}});seen.add(key);}
    }
  }
  return out;
}
export function ropeCandidate(model,first,second) {
  const spec=confirmedSpec('rope');
  if(!first || !second || first.tube===second.tube)return bad('missing_support');
  const a=curvePoint(model,first.tube,first.t),b=curvePoint(model,second.tube,second.t);
  if(!a || !b || [first.t,second.t].some(t=>t<0.05 || t>0.95))return bad('missing_support');
  const length=Math.hypot(...cSub(b,a));if(length<8 || length>240)return bad('tube_short');
  const x=unit(cSub(b,a)),z=unit(cross(x,Math.abs(x[1])>0.9?[1,0,0]:[0,1,0])),y=cross(z,x),frame={pos:center([a,b]),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
  return {...asFitting(spec,{tube:first.tube,a:first.tube,b:second.tube},frame,{mounts:[first,second].map(m=>({...m,role:'knot',width:1})),supportTubes:[first.tube,second.tube]}),ropeLength:length};
}
function railCandidates(model,spec,{legacyInset=false}={}) {
  const out=[],seen=new Set();
  for(const tube of model.tubes.values())for(const partner of model.panelPartners(tube.id,[spec.width,spec.height])) {
    const count=Math.max(1,Math.floor((partner.hi-partner.lo+0.5)/partner.len));
    // 连续布套和彩虹桥沿指定长边安装，不能把跨距当成布套长度。
    if(spec.mountType==='rails' && Math.abs(partner.len-spec.height)>0.5)continue;
    for(let k=0;k<count;k++) {
      const probe={a:tube.id,b:partner.id,t0:partner.lo+k*partner.len,len:partner.len};
      const cor=model.panelCorners(probe);if(!cor)continue;
      const key=cor.map(p=>p.map(v=>v.toFixed(2)).join(',')).sort().join('|');if(seen.has(key))continue;seen.add(key);
      const frame=confirmedFrame(model,{...probe,panelId:spec.id,side:1});if(!frame)continue;
      const normal=frame.axes[2];if(spec.mountType==='horizontal-frame' && Math.abs(normal[1])<0.999)continue;
      const density=spec.feature==='trampoline'?4:spec.feature==='net'?10:0;
      let supports;
      if(spec.mountType==='rails' || spec.mountType==='rope') {
        const mounts=[];for(const id of [probe.a,probe.b]) {
          const rail=model._rail(id),positions=spec.feature==='bridge'?rungPositions(probe.len).map(p=>p/probe.len):spec.feature==='rope'?[0.5]:[0.25,0.75];
          for(const position of positions) {const p=cor[id===probe.a?0:3].map((v,i)=>v+(cor[id===probe.a?1:2][i]-v)*position);mounts.push({tube:id,t:cDot(cSub(p,rail.p0),rail.dir)/rail.len,role:spec.feature==='bridge'?'rung':spec.feature==='rope'?'knot':'sleeve',width:spec.feature==='bridge'?3:2});}
        }supports={mounts,supportTubes:[probe.a,probe.b]};
      } else supports=INSET_PANEL_IDS.has(spec.id) && !legacyInset ? oppositeScrewSupports(model,frame,spec.width,spec.height) : edgeSupports(model,cor,density);
      if(!supports)continue;
      out.push(asFitting(spec,probe,frame,supports));
    }
  }return out;
}
function curvedCandidates(model,spec) {
  const out=[],bows=[...model.tubes.values()].filter(t=>t.bow && t.bowCenter);
  for(let i=0;i<bows.length;i++)for(let j=i+1;j<bows.length;j++) {
    const a=bows[i],b=bows[j],a0=curvePoint(model,a.id,0),a1=curvePoint(model,a.id,1);
    for(const reverse of [false,true]) {
      const b0=curvePoint(model,b.id,reverse?1:0),b1=curvePoint(model,b.id,reverse?0:1),off=cSub(b0,a0);
      if(Math.abs(Math.hypot(...off)-spec.width)>0.5 || Math.hypot(...cSub(cSub(b1,a1),off))>0.5)continue;
      const x=unit(off),y=unit(cSub(a1,a0));if(Math.abs(cDot(x,y))>0.01)continue;
      const z=unit(cross(x,y)),frame={pos:center([a0,a1,b0,b1]),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
      const crossbars=[];
      for(const ends of [[a0,b0],[a1,b1]]) {
        const tube=[...model.tubes.values()].find(t=>!t.bow && !t.arm && !t.link && [false,true].some(r=>Math.hypot(...cSub(curvePoint(model,t.id,r?1:0),ends[0]))<0.35 && Math.hypot(...cSub(curvePoint(model,t.id,r?0:1),ends[1]))<0.35));
        if(tube)crossbars.push(tube.id);
      }
      if(crossbars.length!==2)continue;
      const mounts=[];
      for(const tube of [a,b]) for(let k=1;k<8;k++)mounts.push({tube:tube.id,t:k/8,role:'curve-lacing',width:0.8});
      for(const tube of crossbars)for(let k=1;k<4;k++)mounts.push({tube,t:k/4,role:'end-sleeve',width:0.8});
      out.push(asFitting(spec,{a:a.id,b:b.id,curveReverse:reverse,tube:a.id},frame,{mounts,supportTubes:[a.id,b.id,...crossbars]}));
    }
  }return out;
}
export function confirmedCandidates(model,id,options={}) {
  const spec=confirmedSpec(id);if(!spec)return [];
  if(spec.placement==='panel') {
    const fake={...spec,placement:'fitting'};
    const candidates=railCandidates(model,fake,options).map(p=>confirmedPanelDiagnostics(model,{a:p.a,b:p.b,t0:p.t0,len:p.len,panelId:spec.id,side:1},options));
    if(INSET_PANEL_IDS.has(spec.id) && !options.legacyInset){
      const seen=new Set(candidates.map(p=>model.panelCorners(p)?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|')));
      const horizontal=options.screwAxis==='horizontal';
      for(const probe of insetPanelProbes(model,horizontal?spec.height:spec.width,horizontal?spec.width:spec.height)){
        const key=model.panelCorners(probe)?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|');if(seen.has(key))continue;
        const candidate=confirmedPanelDiagnostics(model,{...probe,panelId:spec.id,side:1,params:{mountLayout:INSET_MOUNT_LAYOUT,screwAxis:options.screwAxis||'vertical'}},options);
        if(candidate.valid){candidates.push(candidate);seen.add(key);}
      }
    }
    return candidates;
  }
  if(spec.mountType==='curved-frame')return curvedCandidates(model,spec);
  if(spec.feature==='trampoline')return trampolineCandidates(model,spec);
  if(spec.mountType==='tube') {
    const out=[];for(const t of model.tubes.values()) {
      const rail=model._rail(t.id);if(!rail || rail.len<20)continue;
      const x=rail.dir,y=unit(Math.abs(x[1])>0.9?cross([0,0,1],x):cross([0,1,0],x)),z=cross(x,y),frame={pos:curvePoint(model,t.id,0.5),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
      const extent=spec.feature==='roller'?Math.max(4,rail.len-12):2.4;
      out.push(asFitting(spec,{tube:t.id},frame,{mounts:[{tube:t.id,t:0.5,role:'axle',width:extent}],supportTubes:[t.id]}));
    }return out;
  }
  if(spec.mountType==='corner') {
    const out=[];for(const node of model.nodes.values()) {
      const rails=[...model.tubes.values()].filter(t=>!t.bow && !t.arm && !t.link && (t.a===node.id || t.b===node.id)).map(t=>({tube:t,dir:unit(cSub(curvePoint(model,t.id,t.a===node.id?1:0),xyz(node))),start:t.a===node.id?0:1,len:model._rail(t.id)?.len||0})).filter(r=>r.len>=40);
      for(let i=0;i<rails.length;i++)for(let j=i+1;j<rails.length;j++) {
        const a=rails[i],b=rails[j];if(Math.abs(cDot(a.dir,b.dir))>0.01)continue;
        const z=cross(a.dir,b.dir),frame={pos:xyz(node),axes:[a.dir,b.dir,z],quat:quatFromBasis(a.dir,b.dir,z)};
        const endA=xyz(node).map((v,k)=>v+a.dir[k]*40),endB=xyz(node).map((v,k)=>v+b.dir[k]*40);
        const bow=[...model.tubes.values()].find(t=>t.bow && Array.isArray(t.bowCenter) && Math.hypot(...cSub(t.bowCenter,xyz(node)))<0.35 && [false,true].some(r=>Math.hypot(...cSub(curvePoint(model,t.id,r?1:0),endA))<0.35 && Math.hypot(...cSub(curvePoint(model,t.id,r?0:1),endB))<0.35));
        if(!bow)continue;
        const mounts=[{tube:a.tube.id,t:a.start+(a.start?-1:1)*4/a.len,role:'corner',width:2},{tube:a.tube.id,t:a.start+(a.start?-1:1)*36/a.len,role:'corner',width:2},{tube:b.tube.id,t:b.start+(b.start?-1:1)*36/b.len,role:'corner',width:2}];
        for(const t of [0.2,0.5,0.8])mounts.push({tube:bow.id,t,role:'arc-retainer',width:2});
        out.push(asFitting(spec,{tube:a.tube.id,a:a.tube.id,b:b.tube.id},frame,{mounts,supportTubes:[a.tube.id,b.tube.id,bow.id]}));
      }
    }return out;
  }
  // 绳子选一个框格：两端分别绕住相对管，保存两个实际承载引用。
  const candidates=railCandidates(model,spec);
  return spec.feature==='rope'?candidates.map(p=>ropeCandidate(model,...p.mounts)):candidates;
}

export function confirmedStructuralValid(model,part) {
  const spec=confirmedSpec(part.panelId||part.kind||part.partId);if(!spec || part.appearanceVersion!==2)return false;
  if(!Array.isArray(part.mounts) || !part.mounts.length || !Array.isArray(part.supportTubes) || !part.supportTubes.length || !confirmedFrame(model,part))return false;
  if(part.supportTubes.some(id=>typeof id!=='string' || !model.tubes.has(id)))return false;
  if(part.mounts.some(m=>!m || !part.supportTubes.includes(m.tube) || !Number.isFinite(m.t) || m.t<0 || m.t>1 || !Number.isFinite(m.width) || m.width<=0 || !curvePoint(model,m.tube,m.t)))return false;
  const size=componentSize(part,spec);
  if(spec.feature==='trampoline' && (!spec.sizes.some(([w,h])=>size.width===w && size.height===h) || (part.w!=null && part.w!==size.width) || (part.h!=null && part.h!==size.height)))return false;
  for(const key of ['width','height','depth','radius','feature','mountType'])if((key==='width'||key==='height'?size[key]:spec[key])!==part.params?.[key])return false;
  if(INSET_PANEL_IDS.has(spec.id) && part.params?.mountLayout!=null && part.params.mountLayout!==INSET_MOUNT_LAYOUT)return false;
  if(INSET_PANEL_IDS.has(spec.id) && part.params?.screwAxis!=null && !['vertical','horizontal'].includes(part.params.screwAxis))return false;
  if(spec.feature==='lego' && part.params?.studHeight!=null && part.params.studHeight!==spec.studHeight)return false;
  if(spec.feature==='rope') {
    if(part.mounts.length!==2 || part.mounts.some(m=>m.role!=='knot' || m.width!==1))return false;
    const candidate=ropeCandidate(model,...part.mounts);
    return candidate.valid && sameRotation(candidate.quat,part.quat) && Math.abs(candidate.ropeLength-part.ropeLength)<0.01 && Math.hypot(...cSub(candidate.pos,[part.x,part.y,part.z]))<0.1 && candidate.supportTubes.length===part.supportTubes.length && candidate.supportTubes.every(id=>part.supportTubes.includes(id));
  }
  if(spec.feature==='trampoline') {
    const candidate=trampolineCandidate(model,part);
    return candidate.valid && candidate.supportTubes.length===part.supportTubes.length && candidate.supportTubes.every(id=>part.supportTubes.includes(id)) && sameMounts(part.mounts,candidate.mounts);
  }
  const candidates=part.panelId ? [confirmedPanelDiagnostics(model,part)] : confirmedCandidates(model,spec.id);
  return candidates.some(p=>p.valid && p.supportTubes.length===part.supportTubes.length && p.supportTubes.every(id=>part.supportTubes.includes(id)) && sameMounts(part.mounts,p.mounts) && (!part.kind || Math.hypot(...cSub(p.pos,[part.x,part.y,part.z]))<0.1 && sameRotation(p.quat,part.quat)));
}

export function confirmedVolumes(model,part) {
  const body=componentBodyVolumes(model,part),frame=confirmedFrame(model,part),spec=confirmedSpec(part.panelId||part.kind||part.partId);
  if(hasInsetScrews(part))return [...body,...insetScrewVolumes(model,part,frame)];
  if(!frame || !spec || !['acrylic','acrylic_holes','capsule','basketball','grid','sector','bridge'].includes(spec.feature))return body;
  // 外露扣体和螺丝也占空间；承载管由调用方排除，但邻近其他管不能穿过扣体。
  for(const mount of Array.isArray(part.mounts)?part.mounts:[]) {
    if(!mount)continue;const point=curvePoint(model,mount.tube,mount.t);if(!point)continue;
    const p=worldToLocal(frame,point);body.push(cVolume(frame,[p[0]-1.5,p[1]-1.5,p[2]+2.25],[p[0]+1.5,p[1]+1.5,p[2]+4.3]));
  }
  return body;
}

function componentBodyVolumes(model,part) {
  const frame=confirmedFrame(model,part),base=confirmedSpec(part.panelId||part.kind||part.partId),spec=base && {...base,...componentSize(part,base)};if(!frame || !spec)return [];
  if(spec.mountType==='curved-frame') {
    const out=[];for(let k=0;k<24;k++) {
      const a=curvePoint(model,part.a,(k+0.5)/24),b=curvePoint(model,part.b,part.curveReverse?1-(k+0.5)/24:(k+0.5)/24),d=unit(cSub(curvePoint(model,part.a,(k+1)/24),curvePoint(model,part.a,k/24))),x=unit(cSub(b,a)),z=unit(cross(x,d));
      out.push({pos:center([a,b]),axes:[x,d,z],half:[spec.width/2-3,2,0.6]});
    }return out;
  }
  if(spec.feature==='sector')return [cVolume(frame,[3,3,-0.8],[37,37,0.8])];
  if(spec.feature==='rope')return [cVolume(frame,[-part.ropeLength/2,-2,-0.6],[part.ropeLength/2,0.6,0.6])];
  if(spec.mountType==='tube') {const rail=model._rail(part.tube),length=rail?.len-10;return rail?[cVolume(frame,[-length/2,-spec.radius,-spec.radius],[length/2,spec.radius,spec.radius])]:[];}
  if(spec.feature==='bridge') {
    const cor=model.panelCorners(part);if(!cor)return [];
    const x=unit(cSub(cor[1],cor[0])),y=unit(cSub(cor[3],cor[0])),z=cross(x,y);
    return rungPositions(part.len).map(position=>({pos:center([cor[0],cor[3]]).map((v,i)=>v+x[i]*position),axes:[x,y,z],half:[3,Math.hypot(...cSub(cor[3],cor[0]))/2-3,3]}));
  }
  if(spec.feature==='basketball')return [cVolume(frame,[-17.5,-17.5,1],[17.5,17.5,3]),cVolume(frame,[-10,-32,5],[10,1,30])];
  if(spec.feature==='capsule')return [cVolume(frame,[-16,-16,1.7],[16,16,18.3])];
  if(spec.feature==='basin')return [cVolume(frame,[-17,-17,-8],[17,17,2.4]),cVolume(frame,[-20.5,-15,1.2],[20.5,15,2.4]),cVolume(frame,[-15,-20.5,1.2],[15,20.5,2.4])];
  if(spec.placement==='fitting')return [cVolume(frame,[-spec.width/2+3,-spec.height/2+3,-1],[spec.width/2-3,spec.height/2-3,1])];
  const depth=spec.feature==='lego' ? (legoStudHeight(part)>0.7?4.5:3.7) : ({clock:5.9,maze:5.9,climbing:5.8,felt:3.9,magnet:6.2,sensory:3.2})[spec.feature] || 3.3;
  return [cVolume(frame,[-spec.width/2+5,-spec.height/2+1.3,1.5],[spec.width/2-5,spec.height/2-1.3,depth]),cVolume(frame,[-spec.width/2+1.3,-spec.height/2+5,1.5],[spec.width/2-1.3,spec.height/2-5,depth])];
}
