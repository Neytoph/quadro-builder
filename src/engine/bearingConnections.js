const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=v=>{const l=Math.hypot(...v);return l>1e-8?v.map(x=>x/l):null;};
const pos=n=>[n.x,n.y,n.z];

function endpoint(model,node,tubes) {
  if(!node||node.part||node.bearingOn||node.clampOn||node.c45||node.c45body||node.c45file||node.unused||model.hasWheelCap(node)||model.hasEndPiece(node))return null;
  if(tubes.length!==1||tubes[0].bow||tubes[0].arm||tubes[0].link)return null;
  const tube=tubes[0],other=model.nodes.get(tube.a===node.id?tube.b:tube.a),dir=other&&norm(sub(pos(other),pos(node)));
  if((node.preferType&&node.preferType!=='straight')||(dir&&(node.arms||[]).some(arm=>Math.abs(dot(arm,dir))<.9999)))return null;
  return dir ? {nodeId:node.id,tubeId:tube.id,pos:pos(node),dir} : null;
}

export function bearingEndpoints(model) {
  const byNode=new Map();
  for(const tube of model.tubes.values())for(const id of [tube.a,tube.b]){if(!byNode.has(id))byNode.set(id,[]);byNode.get(id).push(tube);}
  return [...model.nodes.values()].map(node=>endpoint(model,node,byNode.get(node.id)||[])).filter(Boolean);
}

export function coaxial(origin,axis,point,direction,tolerance=.06) {
  const a=norm(axis),b=norm(direction);if(!a||!b||Math.abs(dot(a,b))<.9999)return false;
  const d=sub(point,origin),along=dot(d,a);
  return Math.hypot(...d.map((v,i)=>v-a[i]*along))<=tolerance;
}

export function bearingConnectionProbe(model,nodeId,tubeId,point,cs=5) {
  const end=endpoint(model,model.nodes.get(nodeId),[...model.tubes.values()].filter(t=>t.a===nodeId||t.b===nodeId));
  if(!end)return {valid:false,reason:'endpoint'};
  const tube=model.tubes.get(tubeId),a=tube&&model.nodes.get(tube.a),b=tube&&model.nodes.get(tube.b);
  if(!a||!b||tube.bow||tube.arm||tube.link||tube.id===end.tubeId||!point?.every(Number.isFinite))return {valid:false,reason:'support'};
  const axis=norm(sub(pos(b),pos(a))),length=Math.hypot(...sub(pos(b),pos(a)));
  if(!axis||Math.abs(dot(axis,end.dir))>.01)return {valid:false,reason:'perpendicular'};
  const projected=dot(sub(point,pos(a)),axis),aligned=dot(sub(end.pos,pos(a)),axis);
  const t=Math.abs(projected-aligned)<=3?aligned:projected;
  const center=pos(a).map((v,i)=>v+axis[i]*t),stub=end.dir;
  const position=center.map((v,i)=>v+stub[i]*cs*2),gapCm=Math.hypot(...sub(position,end.pos));
  const probe={nodeId,tubeId,center,pos:position,stub,axis,t,gapCm,valid:false,reason:'distance'};
  if(t<cs||t>length-cs)return {...probe,reason:'tube_end'};
  // 仅通过普通接头连在一起的管件属于同一刚体，不能回接为自己的轴承支撑。
  const connected=new Set([nodeId]),queue=[nodeId],adj=new Map();
  for(const candidate of model.tubes.values())for(const [from,to] of [[candidate.a,candidate.b],[candidate.b,candidate.a]]){if(!adj.has(from))adj.set(from,[]);adj.get(from).push(to);}
  for(let i=0;i<queue.length;i++){
    if(model.nodes.get(queue[i])?.hinges?.length)continue;
    for(const other of adj.get(queue[i])||[])if(!connected.has(other)){connected.add(other);queue.push(other);}
  }
  if(connected.has(tube.a)&&connected.has(tube.b))return {...probe,reason:'fixed'};
  for(const node of model.nodes.values())if(node.bearingOn) {
    const fitting=model.fittings.get(node.bearingOn);
    if(fitting&&Math.hypot(...sub(pos(fitting),center))<cs)return {...probe,reason:'occupied'};
  }
  for(const node of model.nodes.values())for(let index=0;index<(node.hinges||[]).length;index++) {
    const joint=model.rotationJoint({kind:'hinge',nodeId:node.id,index},cs);
    if(!joint?.nodes.has(nodeId))continue;
    if(joint.blocked||joint.tubes.has(tubeId))return {...probe,reason:'fixed'};
    if(!coaxial(joint.origin,joint.axis,center,axis))return {...probe,reason:'axis'};
  }
  if(gapCm>.12)return probe;
  return {...probe,valid:true,reason:null};
}
