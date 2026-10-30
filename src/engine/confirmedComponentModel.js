import { confirmedSpec, legoStudHeight } from './componentPack.js';
import { INSET_PANEL_IDS, INSET_MOUNT_LAYOUT, INSET_PANEL_EDGE_INSET, hasInsetScrews, oppositeScrewSupports, insetScrewVolumes, insetPanelReference, insetPanelProbes } from './insetPanelMounts.js';
import { geometry } from './catalog.js';
import { quatFromBasis, xAxisOf, yAxisOf, zAxisOf } from './util.js';
import { panelScrewPose, panelScrewAxes, panelLipSegments, sectorScrewMounts, PANEL_SCREW_RADIUS, PANEL_SCREW_HEAD_DEPTH, PANEL_SCREW_SHAFT_RADIUS, PANEL_SCREW_SHAFT_LENGTH, PANEL_OUTER_FACE, PANEL_CORNER_RELIEF } from './panelScrewMounts.js';

export const cSub = (a, b) => a.map((v, i) => v - b[i]);
export const PANEL_RETAINER_LAYOUT = 'opposite-retainers';
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
  if(((hasInsetScrews(part) || part.params?.mountLayout===PANEL_RETAINER_LAYOUT) && part.params?.screwAxis!=='horizontal') || Math.abs(Math.hypot(...cSub(cor[1],cor[0]))-spec.width)>0.5) [x,y]=[y,x];
  let z=unit(cross(x,y));
  if(Math.abs(z[1])<0.01) {
    // 竖直平面内的斜框保留实际框边；方板选更朝上的边作为高度轴。
    if(Math.abs(spec.width-spec.height)<0.5 && Math.abs(x[1])>Math.abs(y[1]))[x,y]=[y,x];
    if(y[1]<0)y=y.map(v=>-v);
    z=unit(cross(unit(cSub(cor[1],cor[0])),unit(cSub(cor[3],cor[0]))));
    x=unit(cross(y,z));
  }
  let sign=z[1]<0?-1:1;
  if(Math.abs(z[1])>0.999 && part.side<0)sign=-sign;
  if(Math.abs(z[1])<=0.999&&part.side!==null&&part.side!==undefined)sign=part.side<0?-1:1;
  if(sign<0) {x=x.map(v=>-v);z=z.map(v=>-v);}
  if (![...x,...y,...z].every(Number.isFinite)) return null;
  return {pos:center(cor),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
}
export function localToWorld(frame,p) {return frame.pos.map((v,i)=>v+frame.axes.reduce((s,a,k)=>s+a[i]*p[k],0));}
export function worldToLocal(frame,p) {const d=cSub(p,frame.pos);return frame.axes.map(a=>cDot(d,a));}
export function cVolume(frame,lo,hi) {return {pos:localToWorld(frame,lo.map((v,i)=>(v+hi[i])/2)),axes:frame.axes,half:lo.map((v,i)=>(hi[i]-v)/2)};}

function edgeSupports(model, corners, density=0, coverage=null) {
  const supportTubes=new Set(),mounts=[];
  const rails=[];
  for(const tube of model.tubes.values()){
    const rail=model._rail(tube.id);if(rail)rails.push({rail,tube});
  }
  for(let i=0;i<4;i++) {
    const a=corners[i],b=corners[(i+1)%4],d=unit(cSub(b,a)),L=Math.hypot(...cSub(b,a)),spans=[];
    for(const {rail,tube} of rails) {
      const alignment=rail.dir[0]*d[0]+rail.dir[1]*d[1]+rail.dir[2]*d[2];
      if(Math.abs(alignment)<0.999)continue;
      const dx=rail.p0[0]-a[0],dy=rail.p0[1]-a[1],dz=rail.p0[2]-a[2],start=dx*d[0]+dy*d[1]+dz*d[2];
      if(Math.hypot(dx-d[0]*start,dy-d[1]*start,dz-d[2]*start)>0.35)continue;
      const end=start+rail.len*alignment,lo=Math.max(0,Math.min(start,end)),hi=Math.min(L,Math.max(start,end));
      if(hi>lo+0.01)spans.push({rail,tube,lo,hi});
    }
    spans.sort((a,b)=>a.lo-b.lo);let reach=0;
    for(const s of spans){if(s.lo>reach+0.35)break;reach=Math.max(reach,s.hi);supportTubes.add(s.tube.id);}
    if(coverage){coverage.push(reach>=L-0.35);continue;}
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

export function panelEdgeCoverage(model,corners) {
  const coverage=[];edgeSupports(model,corners,0,coverage);return coverage;
}

export function supportsPanelFixing(panelId) {
  const spec=confirmedSpec(panelId);
  return panelId==='panel_40x40_busy' || spec?.placement==='panel' && spec.feature!=='basketball';
}

export function isOuterScrewPanel(panelId) {
  return !!confirmedSpec(panelId) && supportsPanelFixing(panelId) && !INSET_PANEL_IDS.has(panelId);
}

export function panelRailScrewAxis(model,probe,frame=confirmedFrame(model,probe)) {
  const rail=model._rail(probe.a);
  if(!frame || !rail)return null;
  return Math.abs(cDot(rail.dir,frame.axes[0]))>.999 ? 'horizontal' : 'vertical';
}

export function confirmedPanelDiagnostics(model,probe,{legacyInset=false,screwAxis=probe.params?.screwAxis}={}) {
  const spec=confirmedSpec(probe.panelId); if(!spec)return bad('frame_size',probe);
  const cor=model.panelCorners(probe);if(!cor)return bad('missing_support',probe);
  const lengths=[Math.hypot(...cSub(cor[1],cor[0])),Math.hypot(...cSub(cor[3],cor[0]))].sort((a,b)=>a-b),dims=[spec.width,spec.height].sort((a,b)=>a-b);
  if(lengths.some((v,i)=>Math.abs(v-dims[i])>0.5))return bad('frame_size',probe);
  const normal=unit(cross(cSub(cor[1],cor[0]),cSub(cor[3],cor[0])));
  if(spec.mountType==='horizontal-frame' && Math.abs(normal[1])<0.999)return bad('horizontal_frame',probe);
  const inset=INSET_PANEL_IDS.has(spec.id),legacy=legacyInset || (probe.appearanceVersion===2 && Array.isArray(probe.mounts) && probe.params?.mountLayout==null);
  const outer=isOuterScrewPanel(spec.id),legacyOuter=outer && legacy;
  screwAxis ??= outer && !legacyOuter ? panelRailScrewAxis(model,probe) : 'vertical';
  if((inset || probe.params?.screwAxis!=null) && !['vertical','horizontal'].includes(screwAxis))return bad('missing_support',probe);
  const frameForSupports=confirmedFrame(model,probe);
  const retainers=outer && (!legacyOuter || probe.params?.screwAxis!=null);
  const legacyRetainers=retainers && probe.appearanceVersion===2 && Array.isArray(probe.mounts) && probe.params?.mountLayout==null;
  const opposite=inset && !legacy || retainers;
  let supports=opposite ? oppositeScrewSupports(model,frameForSupports,spec.width,spec.height,{screwAxis}) : edgeSupports(model,cor);
  if(!supports)return bad(opposite?'opposite_edges':'four_edges',probe);
  if(retainers){
    const legacySupports=legacyRetainers?edgeSupports(model,cor):supports;
    if(!legacySupports)return bad('four_edges',probe);
    supports={...legacySupports,mounts:supports.mounts.map(m=>({...m,role:'retainer',width:2}))};
  }
  const result={...probe,...supports,appearanceVersion:2,params:{...spec},valid:true,reason:null};
  if(retainers || !inset && probe.params?.screwAxis!=null)result.params.screwAxis=screwAxis;
  if(retainers && !legacyRetainers){
    // 几何引用跟随实际固定管，删除未固定的框边后仍能重开和变换。
    result.params.mountLayout=PANEL_RETAINER_LAYOUT;
    Object.assign(result,insetPanelReference(model,frameForSupports,spec.width,spec.height,supports,{screwAxis}));
    result.side=1;
    if(cDot(confirmedFrame(model,result).axes[2],frameForSupports.axes[2])<0)result.side=-1;
  }
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

function asFitting(spec,probe,frame,supports) {return {...probe,tube:probe.tube||probe.a,kind:spec.kind||spec.id,partId:spec.id,x:frame.pos[0],y:frame.pos[1],z:frame.pos[2],quat:frame.quat,facing:probe.facing||1,...supports,appearanceVersion:2,params:{...spec},valid:true,reason:null,pos:frame.pos};}
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
function railCandidates(model,spec,{legacyInset=false,deduplicate=true,screwAxis='vertical',oppositeRetainers=false}={}) {
  const out=[],seen=new Set();
  for(const tube of model.tubes.values())for(const partner of model.panelPartners(tube.id,[spec.width,spec.height])) {
    const count=Math.max(1,Math.floor((partner.hi-partner.lo+0.5)/partner.len));
    // 连续布套沿指定长边安装，不能把跨距当成布套长度。
    if(spec.mountType==='rails' && Math.abs(partner.len-spec.height)>0.5)continue;
    for(let k=0;k<count;k++) {
      const probe={a:tube.id,b:partner.id,t0:partner.lo+k*partner.len,len:partner.len};
      const retainers=oppositeRetainers && supportsPanelFixing(spec.id) && !INSET_PANEL_IDS.has(spec.id);
      if(retainers){
        if(Math.abs(probe.len-(screwAxis==='horizontal'?spec.width:spec.height))>.5)continue;
        probe.params={screwAxis,mountLayout:PANEL_RETAINER_LAYOUT};
      }
      const cor=model.panelCorners(probe);if(!cor)continue;
      const key=cor.map(p=>p.map(v=>v.toFixed(2)).join(',')).sort().join('|');if(deduplicate && seen.has(key))continue;seen.add(key);
      const frame=confirmedFrame(model,{...probe,panelId:spec.id,side:1});if(!frame)continue;
      const normal=frame.axes[2];if(spec.mountType==='horizontal-frame' && Math.abs(normal[1])<0.999)continue;
      const density=spec.feature==='trampoline'?4:spec.feature==='net'?10:0;
      let supports;
      if(spec.mountType==='rails' || spec.mountType==='rope') {
        const mounts=[];for(const id of [probe.a,probe.b]) {
          const rail=model._rail(id),positions=spec.feature==='rope'?[0.5]:[0.25,0.75];
          for(const position of positions) {const p=cor[id===probe.a?0:3].map((v,i)=>v+(cor[id===probe.a?1:2][i]-v)*position);mounts.push({tube:id,t:cDot(cSub(p,rail.p0),rail.dir)/rail.len,role:spec.feature==='rope'?'knot':'sleeve',width:2});}
        }supports={mounts,supportTubes:[probe.a,probe.b]};
      } else supports=INSET_PANEL_IDS.has(spec.id) && !legacyInset || oppositeRetainers && supportsPanelFixing(spec.id) ? oppositeScrewSupports(model,frame,spec.width,spec.height,{screwAxis}) : edgeSupports(model,cor,density);
      if(!supports)continue;
      out.push(asFitting(spec,probe,frame,supports));
    }
  }return out;
}

function bridgeCandidates(model,spec) {
  const rails=[...model.tubes.values()].flatMap(tube=>{
    const rail=model._rail(tube.id);return rail?[{...rail,id:tube.id}]:[];
  });
  const out=[];
  for(const probe of insetPanelProbes(model,spec.width,spec.height)) {
    const corners=model.panelCorners(probe),supportTubes=new Set(),mounts=[];
    if(!corners)continue;
    // 框边按连续覆盖判断，横杠固定点仍记录各自实际落到的管件。
    for(const [a,b] of [[corners[0],corners[1]],[corners[3],corners[2]]]) {
      const direction=unit(cSub(b,a)),length=Math.hypot(...cSub(b,a)),spans=[];
      for(const rail of rails) {
        const alignment=cDot(rail.dir,direction);if(Math.abs(alignment)<.999)continue;
        const offset=cSub(rail.p0,a),start=cDot(offset,direction);
        if(Math.hypot(...cSub(offset,direction.map(v=>v*start)))>.35)continue;
        const end=start+rail.len*alignment,lo=Math.max(0,Math.min(start,end)),hi=Math.min(length,Math.max(start,end));
        if(hi>lo+.01)spans.push({rail,lo,hi});
      }
      spans.sort((a,b)=>a.lo-b.lo);let reach=0;
      for(const span of spans) {
        if(span.lo>reach+.35)break;
        if(span.hi>reach+.01){reach=span.hi;supportTubes.add(span.rail.id);}
      }
      if(reach<length-.35)break;
      for(const distance of rungPositions(length)) {
        const span=spans.find(s=>s.lo<=distance && s.hi>=distance);if(!span)break;
        const point=a.map((v,i)=>v+direction[i]*distance);
        mounts.push({tube:span.rail.id,t:cDot(cSub(point,span.rail.p0),span.rail.dir)/span.rail.len,role:'rung',width:3});
      }
    }
    if(mounts.length!==2*rungPositions(spec.height).length)continue;
    const frame=confirmedFrame(model,{...probe,panelId:spec.id,side:1});if(!frame)continue;
    out.push(asFitting(spec,probe,frame,{mounts,supportTubes:[...supportTubes]}));
  }
  return out;
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
// 引擎记录按部件类型动态扩展，显式数组类型保留调用方的回调类型推断。
/** @returns {Array<Record<string, any>>} */
export function confirmedCandidates(model,id,options={}) {
  const spec=confirmedSpec(id);if(!spec)return [];
  if(isOuterScrewPanel(id) && options.screwAxis==null){
    const candidates=['vertical','horizontal'].flatMap(screwAxis=>confirmedCandidates(model,id,{...options,screwAxis,deduplicate:false}));
    return selectPanelCandidates(model,candidates,options);
  }
  if(isOuterScrewPanel(id))options={...options,oppositeRetainers:true};
  if(spec.mountType==='net-frame'){
    const candidates=railCandidates(model,spec),seen=new Set(candidates.map(p=>model.panelCorners(p)?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|')));
    for(const probe of insetPanelProbes(model,spec.width,spec.height,{deduplicate:false})){
      const corners=model.panelCorners(probe),key=corners?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|');
      if(!corners||seen.has(key))continue;
      const supports=edgeSupports(model,corners,10),frame=confirmedFrame(model,{...probe,panelId:spec.id,side:1});
      if(!supports||!frame)continue;
      candidates.push(asFitting(spec,probe,frame,supports));seen.add(key);
    }
    return candidates;
  }
  if(spec.placement==='panel') {
    const fake={...spec,placement:'fitting'};
    const fixing=options.screwAxis && (options.oppositeRetainers || INSET_PANEL_IDS.has(id)) && supportsPanelFixing(id) ? {params:{screwAxis:options.screwAxis,...(!INSET_PANEL_IDS.has(id)?{mountLayout:PANEL_RETAINER_LAYOUT}:{})}} : {};
    const candidates=railCandidates(model,fake,{...options,deduplicate:false}).map(p=>confirmedPanelDiagnostics(model,{a:p.a,b:p.b,t0:p.t0,len:p.len,panelId:spec.id,side:1,...fixing},options));
    const inset=INSET_PANEL_IDS.has(spec.id);
    if(!inset || !options.legacyInset){
      const seen=new Set(candidates.filter(p=>p.valid).map(p=>model.panelCorners(p)?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|')));
      const horizontal=options.screwAxis==='horizontal';
      // 普通板也识别多根短管拼成的连续框边；实际固定边由诊断核对。
      let sizes=[[spec.width,spec.height]];
      if((inset || fixing.params) && horizontal)sizes=[[spec.height,spec.width]];
      else if(fixing.params)sizes=[[spec.width,spec.height]];
      else if(!inset && spec.width!==spec.height)sizes.push([spec.height,spec.width]);
      for(const [width,height] of sizes)for(const probe of insetPanelProbes(model,width,height,{deduplicate:false})){
        const key=model.panelCorners(probe)?.map(c=>c.map(v=>v.toFixed(2)).join(',')).sort().join('|');if(seen.has(key))continue;
        const candidate=confirmedPanelDiagnostics(model,{...probe,panelId:spec.id,side:1,...fixing,...(inset?{params:{mountLayout:INSET_MOUNT_LAYOUT,screwAxis:options.screwAxis||'vertical'}}:{})},options);
        if(candidate.valid){candidates.push(candidate);seen.add(key);}
      }
    }
    return selectPanelCandidates(model,candidates,options);
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
    const radius=spec.width;
    const out=[];for(const node of model.nodes.values()) {
      const rails=[...model.tubes.values()].filter(t=>!t.bow && !t.arm && !t.link && (t.a===node.id || t.b===node.id)).map(t=>({tube:t,dir:unit(cSub(curvePoint(model,t.id,t.a===node.id?1:0),xyz(node))),start:t.a===node.id?0:1,len:model._rail(t.id)?.len||0})).filter(r=>r.len>=radius);
      for(let i=0;i<rails.length;i++)for(let j=i+1;j<rails.length;j++) {
        const a=rails[i],b=rails[j];if(Math.abs(cDot(a.dir,b.dir))>0.01)continue;
        const facing=options.sectorFacing===-1?-1:1;
        const [x,y]=facing===-1?[b.dir,a.dir]:[a.dir,b.dir],z=cross(x,y),frame={pos:xyz(node),axes:[x,y,z],quat:quatFromBasis(x,y,z)};
        const endA=xyz(node).map((v,k)=>v+a.dir[k]*radius),endB=xyz(node).map((v,k)=>v+b.dir[k]*radius);
        const bow=[...model.tubes.values()].find(t=>t.bow && Array.isArray(t.bowCenter) && Math.hypot(...cSub(t.bowCenter,xyz(node)))<0.35 && [false,true].some(r=>Math.hypot(...cSub(curvePoint(model,t.id,r?1:0),endA))<0.35 && Math.hypot(...cSub(curvePoint(model,t.id,r?0:1),endB))<0.35));
        if(options.legacySector){
          if(!bow)continue;
          const mounts=[{tube:a.tube.id,t:a.start+(a.start?-1:1)*4/a.len,role:'corner',width:2},{tube:a.tube.id,t:a.start+(a.start?-1:1)*(radius-4)/a.len,role:'corner',width:2},{tube:b.tube.id,t:b.start+(b.start?-1:1)*(radius-4)/b.len,role:'corner',width:2}];
          for(const t of [0.2,0.5,0.8])mounts.push({tube:bow.id,t,role:'arc-retainer',width:2});
          out.push(asFitting(spec,{tube:a.tube.id,a:a.tube.id,b:b.tube.id},frame,{mounts,supportTubes:[a.tube.id,b.tube.id,bow.id]}));
          continue;
        }
        const mounts=[a,b].flatMap(rail=>[4,radius-4].map(distance=>({tube:rail.tube.id,t:rail.start+(rail.start?-1:1)*distance/rail.len,role:'panel-screw',width:2})));
        out.push(asFitting(spec,{tube:a.tube.id,a:a.tube.id,b:b.tube.id,facing},frame,{mounts,supportTubes:[a.tube.id,b.tube.id]}));
      }
    }return out;
  }
  // 彩虹桥按连续框边识别，布片和绳子保留各自的安装方式。
  const candidates=spec.feature==='bridge'?bridgeCandidates(model,spec):railCandidates(model,spec);
  return spec.feature==='rope'?candidates.map(p=>ropeCandidate(model,...p.mounts)):candidates;
}

// 同一框格保留实际可用的固定方向；批量装配可保留全部方案。
function selectPanelCandidates(model,candidates,options) {
  if(options.deduplicate===false)return candidates;
  const faces=new Map();
  for(const candidate of candidates){
    const cor=model.panelCorners(candidate);if(!cor)continue;
    const key=cor.map(p=>p.map(v=>(Math.abs(v)<.005?0:v).toFixed(2)).join(',')).sort().join('|');
    const previous=faces.get(key);if(previous?.accepted)continue;
    const accepted=candidate.valid && (options.isPanelCandidateValid?.(candidate) ?? true);
    if(!previous || accepted && !previous.accepted)faces.set(key,{candidate,accepted});
  }
  return [...faces.values()].map(({candidate})=>candidate);
}

export function confirmedStructuralValid(model,part) {
  const spec=confirmedSpec(part.panelId||part.kind||part.partId);if(!spec || part.appearanceVersion!==2)return false;
  if(!Array.isArray(part.mounts) || !part.mounts.length || !Array.isArray(part.supportTubes) || !part.supportTubes.length || !confirmedFrame(model,part))return false;
  if(part.supportTubes.some(id=>typeof id!=='string' || !model.tubes.has(id)))return false;
  if(part.mounts.some(m=>!m || !part.supportTubes.includes(m.tube) || !Number.isFinite(m.t) || m.t<0 || m.t>1 || !Number.isFinite(m.width) || m.width<=0 || !curvePoint(model,m.tube,m.t)))return false;
  const size=componentSize(part,spec);
  if(spec.feature==='trampoline' && (!spec.sizes.some(([w,h])=>size.width===w && size.height===h) || (part.w!=null && part.w!==size.width) || (part.h!=null && part.h!==size.height)))return false;
  for(const key of ['width','height','depth','radius','feature','mountType']){
    // 旧板件保留原存档字段，安装朝向已放开，固定点仍按真实框架校验。
    if(key==='mountType' && spec.placement==='panel' && spec.mountType==='frame' && part.params?.mountType==='vertical-frame')continue;
    if((key==='width'||key==='height'?size[key]:spec[key])!==part.params?.[key])return false;
  }
  if(INSET_PANEL_IDS.has(spec.id) && part.params?.mountLayout!=null && part.params.mountLayout!==INSET_MOUNT_LAYOUT)return false;
  if(!INSET_PANEL_IDS.has(spec.id) && supportsPanelFixing(spec.id) && part.params?.mountLayout!=null && part.params.mountLayout!==PANEL_RETAINER_LAYOUT)return false;
  if(part.params?.screwAxis!=null && !['vertical','horizontal'].includes(part.params.screwAxis))return false;
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
  const candidates=part.panelId ? [confirmedPanelDiagnostics(model,part)] : confirmedCandidates(model,spec.id,{legacySector:spec.feature==='sector' && part.mounts.some(m=>m.role==='arc-retainer'),sectorFacing:part.facing});
  return candidates.some(p=>p.valid && p.supportTubes.length===part.supportTubes.length && p.supportTubes.every(id=>part.supportTubes.includes(id)) && sameMounts(part.mounts,p.mounts) && (!part.kind || Math.hypot(...cSub(p.pos,[part.x,part.y,part.z]))<0.1 && sameRotation(p.quat,part.quat)));
}

export function confirmedVolumes(model,part) {
  const body=componentBodyVolumes(model,part),frame=confirmedFrame(model,part),spec=confirmedSpec(part.panelId||part.kind||part.partId);
  if(hasInsetScrews(part))return [...body,...insetScrewVolumes(model,part,frame)];
  if(frame && (part.params?.screwAxis && supportsPanelFixing(part.panelId) || spec?.feature==='sector')){
    const worldAxes=axes=>axes.map(axis=>frame.axes[0].map((_,i)=>frame.axes.reduce((sum,a,k)=>sum+a[i]*axis[k],0)));
    for(const segment of panelLipSegments(part)){
      const axes=worldAxes(segment.axes),origin=localToWorld(frame,segment.origin);
      const panelLip=isOuterScrewPanel(part.panelId)?{origin,axis:axes[0],inward:unit(cSub(frame.pos,origin))}:undefined;
      body.push({pos:localToWorld(frame,segment.point),axes,half:segment.half,...(panelLip?{panelLip}:{})});
    }
    for(const mount of spec?.feature==='sector'?sectorScrewMounts(model,part):(part.mounts || [])){
      const pose=panelScrewPose(model,part,frame,mount);if(!pose)continue;
      const {normal}=pose,axes=worldAxes(panelScrewAxes(pose));
      const at=distance=>localToWorld(frame,pose.point.map((v,i)=>v+normal[i]*distance));
      const rail=model._rail(mount.tube),origin=curvePoint(model,mount.tube,mount.t),delta=cSub(frame.pos,origin);
      const along=delta.reduce((s,v,k)=>s+v*rail.dir[k],0),inward=unit(delta.map((v,i)=>v-rail.dir[i]*along));
      const panelScrew=isOuterScrewPanel(part.panelId)?{origin,axis:rail.dir,inward}:undefined;
      const fixing=panelScrew?{panelScrew}:{};
      body.push({pos:at(-.033),axes,half:[PANEL_SCREW_RADIUS,PANEL_SCREW_RADIUS,PANEL_SCREW_HEAD_DEPTH/2+.002],...fixing});
      body.push({pos:at(-.1-PANEL_SCREW_SHAFT_LENGTH/2),axes,half:[PANEL_SCREW_SHAFT_RADIUS,PANEL_SCREW_SHAFT_RADIUS,PANEL_SCREW_SHAFT_LENGTH/2],...fixing});
    }
    return body;
  }
  if(!frame || !spec || !(part.params?.screwAxis || ['acrylic','acrylic_holes','capsule','basketball','grid','sector','bridge'].includes(spec.feature)))return body;
  // 外露扣体和螺丝也占空间；承载管由调用方排除，但邻近其他管不能穿过扣体。
  for(const mount of Array.isArray(part.mounts)?part.mounts:[]) {
    if(!mount)continue;const point=curvePoint(model,mount.tube,mount.t);if(!point)continue;
    const p=worldToLocal(frame,point);body.push(cVolume(frame,[p[0]-1.5,p[1]-1.5,p[2]+2.25],[p[0]+1.5,p[1]+1.5,p[2]+4.3]));
  }
  return body;
}

function outerPanelBodyVolumes(frame,spec) {
  const x=spec.width/2,y=spec.height/2,r=PANEL_CORNER_RELIEF,z=PANEL_OUTER_FACE,boxes=[];
  const panelSkin={origin:frame.pos,axes:frame.axes,width:spec.width,height:spec.height};
  const add=(x0,y0,x1,y1)=>boxes.push({...cVolume(frame,[x0,y0,z-geometry().panelThickness],[x1,y1,z]),roundTubeClearance:true,panelSkin});
  add(-x+r,-y,x-r,y);add(-x,-y+r,x,y-r);
  // 在原16条保守盒体内继续切分，避免扩大任何旧碰撞区域。
  // 每段平方跨度至多r²/32，到角心至少r*sqrt(31/32)，保留49mm圆管的让位间隙。
  const bands=16,maxSquaredSpan=r*r/32;
  for(const sx of [-1,1])for(const sy of [-1,1])for(let i=0;i<bands;i++){
    const lo=r*i/bands,hi=r*(i+1)/bands,span=hi*hi-lo*lo;
    const steps=Math.ceil(span/maxSquaredSpan-1e-10);
    for(let j=0;j<steps;j++){
      const a=Math.sqrt(lo*lo+span*j/steps),b=Math.sqrt(lo*lo+span*(j+1)/steps),c=Math.sqrt(Math.max(0,r*r-b*b));
      const xx=[sx*(x-a),sx*(x-b)].sort((a,b)=>a-b),yy=[sy*(y-c),sy*(y-r)].sort((a,b)=>a-b);
      add(xx[0],yy[0],xx[1],yy[1]);
    }
  }
  return boxes;
}

function componentBodyVolumes(model,part) {
  const frame=confirmedFrame(model,part),base=confirmedSpec(part.panelId||part.kind||part.partId),spec=base && {...base,...componentSize(part,base)};if(!frame || !spec)return [];
  if(spec.mountType==='curved-frame') {
    const out=[];for(let k=0;k<24;k++) {
      const a=curvePoint(model,part.a,(k+0.5)/24),b=curvePoint(model,part.b,part.curveReverse?1-(k+0.5)/24:(k+0.5)/24),d=unit(cSub(curvePoint(model,part.a,(k+1)/24),curvePoint(model,part.a,k/24))),x=unit(cSub(b,a)),z=unit(cross(x,d));
      out.push({pos:center([a,b]),axes:[x,d,z],half:[spec.width/2-3,2,0.6]});
    }return out;
  }
  if(spec.feature==='sector'){
    const radius=spec.width-3,step=radius/8,boxes=[];
    for(let i=0;i<8;i++){
      const x0=i*step,x1=(i+1)*step,y1=Math.sqrt(Math.max(0,radius*radius-x1*x1));
      if(y1>3 && x1>3)boxes.push(cVolume(frame,[Math.max(3,x0),3,PANEL_OUTER_FACE-geometry().panelThickness],[x1,y1,PANEL_OUTER_FACE]));
    }
    return boxes;
  }
  if(spec.feature==='rope')return [cVolume(frame,[-part.ropeLength/2,-2,-0.6],[part.ropeLength/2,0.6,0.6])];
  if(spec.mountType==='tube') {const rail=model._rail(part.tube),length=rail?.len-10;return rail?[cVolume(frame,[-length/2,-spec.radius,-spec.radius],[length/2,spec.radius,spec.radius])]:[];}
  if(spec.feature==='bridge') {
    const cor=model.panelCorners(part);if(!cor)return [];
    const x=unit(cSub(cor[1],cor[0])),y=unit(cSub(cor[3],cor[0])),z=cross(x,y);
    return rungPositions(part.len).map(position=>({pos:center([cor[0],cor[3]]).map((v,i)=>v+x[i]*position),axes:[x,y,z],half:[3,Math.hypot(...cSub(cor[3],cor[0]))/2-3,3]}));
  }
  if(spec.feature==='basketball')return [...outerPanelBodyVolumes(frame,spec),cVolume(frame,[-10,-32,5],[10,1,30])];
  if(hasInsetScrews(part)){
    const x=spec.width/2-INSET_PANEL_EDGE_INSET,y=spec.height/2-INSET_PANEL_EDGE_INSET,z=geometry().panelThickness/2;
    const body=[cVolume(frame,[-x-.06,-y-.06,-z],[x+.06,y+.06,z])];
    if(spec.feature==='capsule')body.push(cVolume(frame,[-16.18,-16.18,-.18],[16.18,16.18,16]));
    return body;
  }
  if(spec.feature==='capsule')return [cVolume(frame,[-16,-16,1.7],[16,16,18.3])];
  if(spec.feature==='basin')return [cVolume(frame,[-17,-17,-8],[17,17,2.4]),cVolume(frame,[-20.5,-15,1.2],[20.5,15,2.4]),cVolume(frame,[-15,-20.5,1.2],[15,20.5,2.4])];
  if(spec.placement==='fitting')return [cVolume(frame,[-spec.width/2+3,-spec.height/2+3,-1],[spec.width/2-3,spec.height/2-3,1])];
  if(spec.feature==='sensory')return [cVolume(frame,[-15,-18.7,1.5],[15,18.7,3.2]),cVolume(frame,[-18.7,-15,1.5],[18.7,15,3.2])];
  const body=outerPanelBodyVolumes(frame,spec);
  // 凸起附件只占自身区域；无凸起的板不附加覆盖到安装边的厚盒体。
  const decoration=({
    lego:[16.8,16.8,legoStudHeight(part)>.7?4.5:3.7],
    clock:[16.55,16.55,6.2],maze:[16.5,16.5,5.9],
    climbing:[14.5,Math.min(spec.height/2-3,14),5.8],
    felt:[16.5,16.5,3.9],magnet:[13,13,6.2],
  })[spec.feature];
  if(decoration){const [x,y,depth]=decoration;body.push(cVolume(frame,[-x,-y,1.5],[x,y,depth]));}
  return body;
}
