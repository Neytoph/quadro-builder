export const INSET_MOUNT_LAYOUT='opposite-transparent-screws';
export const INSET_PANEL_IDS=new Set(['acrylic_panel_40x40','acrylic_panel_40x20','acrylic_panel_40x60','acrylic_hole_panel_40x40','acrylic_platform_40x40','panel_40x40_capsule','panel_40x40_grid','panel_40x40_busy']);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const at=(frame,p)=>frame.pos.map((v,i)=>v+frame.axes.reduce((n,a,k)=>n+a[i]*p[k],0));
const local=(frame,p)=>frame.axes.map(a=>dot(sub(p,frame.pos),a));

export function hasInsetScrews(part) {return INSET_PANEL_IDS.has(part.panelId) && part.params?.mountLayout===INSET_MOUNT_LAYOUT;}

// 仅内嵌安装使用连续对边探针；每根短管都仍是实际模型管件。
export function insetPanelProbes(model,width,height) {
  const rails=[...model.tubes.values()].flatMap(t=>{const rail=model._rail(t.id);return rail?[{...rail,id:t.id}]:[];}),out=[],seen=new Set();
  for(const rail of rails){
    const starts=new Set(),intervals=[];
    for(const span of rails){
      if(Math.abs(dot(span.dir,rail.dir))<.999)continue;
      const offset=sub(span.p0,rail.p0),start=dot(offset,rail.dir);
      if(Math.hypot(...sub(offset,rail.dir.map(v=>v*start)))>.35)continue;
      const end=start+span.len*dot(span.dir,rail.dir);
      intervals.push({lo:Math.min(start,end),hi:Math.max(start,end)});
      for(const s of [start,end,start-height,end-height])starts.add(Math.round(s*1000)/1000);
    }
    intervals.sort((a,b)=>a.lo-b.lo);
    const complete=[...starts].filter(start=>{
      let reach=start;for(const span of intervals){if(span.lo>reach+.35)break;if(span.hi>reach)reach=span.hi;}
      return reach>=start+height-.35;
    });
    for(const partner of rails){
      if(partner.id===rail.id || Math.abs(dot(partner.dir,rail.dir))<.999)continue;
      const offset=sub(partner.p0,rail.p0),along=dot(offset,rail.dir),across=sub(offset,rail.dir.map(v=>v*along));
      if(Math.abs(Math.hypot(...across)-width)>.35)continue;
      for(const t0 of complete){
        const start=rail.p0.map((v,i)=>v+rail.dir[i]*t0),end=start.map((v,i)=>v+rail.dir[i]*height);
        const key=[start,end,start.map((v,i)=>v+across[i]),end.map((v,i)=>v+across[i])].map(p=>p.map(v=>v.toFixed(2)).join(',')).sort().join('|');
        if(seen.has(key))continue;seen.add(key);out.push({a:rail.id,b:partner.id,t0,len:height});
      }
    }
  }
  return out;
}

function edgeSpans(model,a,b) {
  const delta=sub(b,a),length=Math.hypot(...delta),direction=delta.map(v=>v/length),spans=[];
  for(const tube of model.tubes.values()){
    const rail=model._rail(tube.id);if(!rail || Math.abs(dot(rail.dir,direction))<.999)continue;
    const offset=sub(rail.p0,a),start=dot(offset,direction);
    if(Math.hypot(...sub(offset,direction.map(v=>v*start)))>.35)continue;
    const end=start+rail.len*dot(rail.dir,direction),lo=Math.max(0,Math.min(start,end)),hi=Math.min(length,Math.max(start,end));
    if(hi>lo+.01)spans.push({rail,tube,lo,hi});
  }
  spans.sort((a,b)=>a.lo-b.lo);return {spans,direction,length};
}

export function oppositeScrewSupports(model,frame,width,height,{screwAxis='vertical'}={}) {
  if(!frame)return null;
  const mounts=[],supportTubes=new Set();
  for(const side of [-1,1]){
    const horizontal=screwAxis==='horizontal';
    const a=at(frame,horizontal?[-width/2,side*height/2,0]:[side*width/2,-height/2,0]),b=at(frame,horizontal?[width/2,side*height/2,0]:[side*width/2,height/2,0]),{spans,direction,length}=edgeSpans(model,a,b);
    let reach=0;for(const span of spans){
      if(span.lo>reach+.35)break;
      if(span.hi>reach+.01){supportTubes.add(span.tube.id);reach=span.hi;}
    }
    if(reach<length-.35)return null;
    const margin=Math.min(6,length*.2);
    for(const distance of [margin,length-margin]){
      const span=spans.find(s=>s.lo<=distance && s.hi>=distance);if(!span)return null;
      const point=a.map((v,i)=>v+direction[i]*distance),t=dot(sub(point,span.rail.p0),span.rail.dir)/span.rail.len;
      mounts.push({tube:span.tube.id,t,role:'inset-screw',width:1.8,edge:horizontal?(side<0?0:2):(side<0?3:1)});
      supportTubes.add(span.tube.id);
    }
  }
  return {mounts,supportTubes:[...supportTubes]};
}

// 面的位置沿实际螺丝承载边记录，不依赖未固定的横边仍然存在。
export function insetPanelReference(model,frame,width,height,supports,{screwAxis='vertical'}={}) {
  const a=supports.mounts[0].tube,b=supports.mounts[2].tube,rail=model._rail(a);
  const horizontal=screwAxis==='horizontal',direction=dot(rail.dir,frame.axes[horizontal?0:1])>=0?1:-1;
  const start=at(frame,horizontal?[-direction*width/2,-height/2,0]:[-width/2,-direction*height/2,0]);
  return {a,b,t0:dot(sub(start,rail.p0),rail.dir),len:horizontal?width:height};
}

// 框边与内嵌板的接合属于既有框架空间，固定引用仅记录实际螺丝承载管。
export function insetFrameTubeIds(model,frame,width,height) {
  if(!frame)return [];
  const corners=[[-width/2,-height/2,0],[width/2,-height/2,0],[width/2,height/2,0],[-width/2,height/2,0]].map(p=>at(frame,p));
  return [...new Set(corners.flatMap((a,i)=>edgeSpans(model,a,corners[(i+1)%4]).spans.map(s=>s.tube.id)))];
}

export function insetScrewPose(model,frame,mount) {
  const rail=model._rail(mount?.tube);if(!rail || !Number.isFinite(mount.t))return null;
  const point=rail.p0.map((v,i)=>v+rail.dir[i]*rail.len*mount.t),position=local(frame,point),tangent=frame.axes.map(a=>dot(rail.dir,a));
  const length=Math.hypot(tangent[0],tangent[1]);if(length<.999)return null;
  tangent[0]/=length;tangent[1]/=length;tangent[2]=0;
  let inward=[-tangent[1],tangent[0],0];if(dot(inward,position)>0)inward=inward.map(v=>-v);
  return {position,tangent,inward};
}

export function insetScrewVolumes(model,part,frame) {
  const lower=part.panelId==='panel_40x40_busy' ? .9 : 1.95,out=[];
  for(const mount of part.mounts || []){
    const pose=insetScrewPose(model,frame,mount);if(!pose)continue;
    const {position,inward,tangent}=pose,front=(lower+3.25)/2;
    out.push({pos:at(frame,position.map((v,i)=>v+inward[i]*1.2+(i===2?front:0))),axes:[inward,tangent,[0,0,1]].map(axis=>frame.axes[0].map((_,i)=>frame.axes.reduce((n,a,k)=>n+a[i]*axis[k],0))),half:[2,.95,(3.25-lower)/2]});
  }
  return out;
}
