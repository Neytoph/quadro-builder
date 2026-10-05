import {xAxisOf as rawXAxisOf,yAxisOf as rawYAxisOf,zAxisOf as rawZAxisOf} from './util.js';
export const normalizedAssemblyQuaternion=q=>{const value=q||[0,0,0,1],length=Math.hypot(...value);return length?value.map(v=>v/length):[0,0,0,1];};
const xAxisOf=q=>rawXAxisOf(normalizedAssemblyQuaternion(q)),yAxisOf=q=>rawYAxisOf(normalizedAssemblyQuaternion(q)),zAxisOf=q=>rawZAxisOf(normalizedAssemblyQuaternion(q));
const xyz=p=>[p.x,p.y,p.z],sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),unit=d=>d.map(v=>v/(Math.hypot(...d)||1));
const sameRoofSlopes=(a,b)=>{const leaf=q=>[zAxisOf(q),yAxisOf(q).map(v=>-v)],[a0,a1]=leaf(a),[b0,b1]=leaf(b);return (dot(a0,b0)>.995&&dot(a1,b1)>.995)||(dot(a0,b1)>.995&&dot(a1,b0)>.995);};
/** Resolve an existing physical mounting rule, not merely a nearby shape. */
export function nativeAccessorySupport(model,id){
  const fitting=model.fittings.get(id),slide=model.slides.get(id);
  if(fitting){
    const virtual=Object.assign(Object.create(Object.getPrototypeOf(model)),model,{fittings:new Map(model.fittings)});virtual.fittings.delete(id);
    const axis=xAxisOf(fitting.quat||[0,0,0,1]),point=xyz(fitting);
    let mounts=[];try{mounts=virtual.fittingMounts(fitting.kind)||[];}catch{}
    const matches=mounts.filter(m=>Math.hypot(...sub(m.pos,point))<.05&&dot(unit(m.dir),axis)>.995);
    if(matches.length===1){const match=matches[0],supports=[match.nodeId,match.tubeId].filter(Boolean);
      if(fitting.kind==='multi-wheel2')for(const bearing of virtual.fittings.values())if(bearing.kind==='bearing2'){const d=xAxisOf(bearing.quat||[0,0,0,1]);if(dot(d,axis)>.995&&Math.hypot(...sub(xyz(bearing).map((v,i)=>v+d[i]*5),point))<.05)supports.push(bearing.id);}
      return {valid:supports.length>0,supportIds:supports,basis:'existing-catalog-mount-position-and-port-axis',mount:{position:match.pos,direction:axis,catalogDirection:match.dir}};
    }
    return {valid:false,supportIds:[],basis:'native-mount-unresolved',matchingMounts:matches.length};
  }
  if(slide){
    const point=xyz(slide),axis=xAxisOf(slide.quat||[0,0,0,1]);
    if(slide.kind==='roof2'){
      const mounts=model.roofMounts('roof2',true).filter(m=>Math.hypot(...sub(m.pos,point))<2&&Math.abs(dot(xAxisOf(m.quat),axis))>.995&&sameRoofSlopes(m.quat,slide.quat||[0,0,0,1]));
      if(mounts.length===1){const peak=mounts[0].faces[0].slice(0,2),ridgeNodes=[...model.nodes.values()].filter(n=>{const r=sub(xyz(n),peak[0]),d=unit(sub(peak[1],peak[0])),along=dot(r,d);return along>=-2&&along<=Math.hypot(...sub(peak[1],peak[0]))+2&&Math.hypot(...r.map((v,i)=>v-d[i]*along))<2;}),nodeIds=new Set(ridgeNodes.map(n=>n.id)),supports=[...model.tubes.values()].filter(t=>!t.arm&&!t.link&&!t.bow&&(nodeIds.has(t.a)||nodeIds.has(t.b))).filter(t=>{const a=model.nodes.get(t.a),b=model.nodes.get(t.b);return (nodeIds.has(t.a)&&nodeIds.has(t.b))||Math.abs(Math.abs(a.y-b.y)-Math.hypot(a.x-b.x,a.z-b.z))<3;}).map(t=>t.id);return {valid:supports.length>0,supportIds:supports,basis:'existing-roof-mount-ridge-and-opposing-rafters',mount:{position:mounts[0].pos,direction:axis}};}
      // Legacy factory QDFs may span the 80 cm ridge with one T75;
      // the authoring suggestion grid is not an extra physical support.
      const up=yAxisOf(slide.quat||[0,0,0,1]),down=zAxisOf(slide.quat||[0,0,0,1]),ends=[-1,1].map(sign=>point.map((v,i)=>v+axis[i]*40)),nodes=ends.map(p=>[...model.nodes.values()].filter(n=>Math.hypot(...sub(xyz(n),p))<2));
      if(Math.abs(axis[1])<.01&&Math.abs(up[1]-Math.SQRT1_2)<.02&&Math.abs(down[1]+Math.SQRT1_2)<.02&&nodes.every(matches=>matches.length===1)){
        const endNodes=nodes.map(matches=>matches[0]),rafters=endNodes.map(node=>[down,up.map(v=>-v)].map(direction=>[...model.tubes.values()].filter(t=>!t.arm&&!t.link&&!t.bow&&(t.a===node.id||t.b===node.id)).filter(t=>{const other=model.nodes.get(t.a===node.id?t.b:t.a);return other.y<node.y-10&&dot(unit(sub(xyz(other),xyz(node))),direction)>.995;})));
        const ridge=[...model.tubes.values()].filter(t=>!t.arm&&!t.link&&!t.bow).filter(t=>[t.a,t.b].every(id=>{const r=sub(xyz(model.nodes.get(id)),ends[0]),along=dot(r,axis);return along>=-2&&along<=82&&Math.hypot(...r.map((v,i)=>v-axis[i]*along))<2;})),ranges=ridge.map(t=>[t.a,t.b].map(id=>dot(sub(xyz(model.nodes.get(id)),ends[0]),axis)).sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);let covered=0,continuous=true;for(const [lo,hi]of ranges){if(lo>covered+2)continuous=false;covered=Math.max(covered,hi);}
        const topology=new Set([endNodes[0].id]);for(let i=0;i<ridge.length;i++)for(const t of ridge)if(topology.has(t.a)||topology.has(t.b)){topology.add(t.a);topology.add(t.b);}
        if(continuous&&covered>=78&&topology.has(endNodes[1].id)&&rafters.every(pair=>pair.every(matches=>matches.length===1)))return {valid:true,supportIds:[...ridge.map(t=>t.id),...rafters.flat(2).map(t=>t.id)],basis:'factory-80cm-continuous-ridge-and-two-opposing-45degree-gables',mount:{position:point,direction:axis}};
      }
      return {valid:false,supportIds:[],basis:'roof-mount-unresolved'};
    }
    const entry=model.slideEntry(slide),position=entry&&xyz(entry),rails=position?[...model.tubes.values()].filter(t=>{if(t.arm||t.link||t.bow)return false;const a=xyz(model.nodes.get(t.a)),b=xyz(model.nodes.get(t.b)),d=unit(sub(b,a)),r=sub(position,a),along=dot(r,d);return Math.abs(dot(d,axis))>.995&&along>=0&&along<=Math.hypot(...sub(b,a))&&Math.hypot(...r.map((v,i)=>v-d[i]*along))<.05;}):[];
    if(slide.kind==='slide-end2'){
      const parents=[...model.slides.values()].filter(other=>other.id!==id).filter(other=>{const exit=model.slideExit(other);return exit&&Math.hypot(...sub(exit.pos,point))<.05&&Math.abs(dot(xAxisOf(exit.quat),axis))>.995;}),ground=model._groundLevel?.()??0,rests=Math.abs(point[1]-ground)<.05;
      return {valid:parents.length===1&&(rests||rails.length>0),supportIds:rails.map(t=>t.id),groundSupport:rests,basis:'official-runout-first-at-matching-module-exit-and-ground-frame',mateSlideId:parents[0]?.id,mount:{position,direction:axis}};
    }
    const supports=[];
    for(const rail of rails)if(Math.abs((rail.length||0)-35)<.5){const posts=[rail.a,rail.b].map(nodeId=>[...model.tubes.values()].filter(t=>!t.arm&&!t.link&&!t.bow&&(t.a===nodeId||t.b===nodeId)).map(t=>{const a=model.nodes.get(t.a),b=model.nodes.get(t.b);if(Math.hypot(a.x-b.x,a.z-b.z)>.5||Math.abs(a.y-b.y)<.5)return null;return {tubeId:t.id,x:a.x,z:a.z,low:Math.min(a.y,b.y),high:Math.max(a.y,b.y),len:t.length,lowId:a.y<b.y?a.id:b.id,highId:a.y<b.y?b.id:a.id};}).filter(Boolean));for(const p of posts[0])for(const q of posts[1])if(model._slideEntryOk(p,q,position[1]))supports.push(rail.id,p.tubeId,q.tubeId);}
    return {valid:supports.length>0,supportIds:[...new Set(supports)],basis:'existing-slide-entry-two-posts-and-35cm-crossrail',mount:{position,direction:axis}};
  }
  return {valid:false,supportIds:[],basis:'unknown-native-mount'};
}
