import { reinforcementRuns, resolveNodeConnection } from './bom.js';
import { beginAssemblyCollisionPass, checkAssemblyPath } from './assemblyCollision.js';
const xyz=p=>[p.x,p.y,p.z],sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=a=>a.map(v=>v/(Math.hypot(...a)||1));
/** The official 80 cm wood profile fits QUADRO tube/through-port channels.
 * Its exterior occupied-space bound uses the carrier's outer radius, without
 * inventing a wood cross-section. Compatibility applies only inside that channel. */
export function createCoreChannels(model,pathOptions={}){
  const virtual=Object.assign(Object.create(Object.getPrototypeOf(model)),model,{nodes:new Map(model.nodes),tubes:new Map(model.tubes)}),channels=[];
  for(const [index,run] of reinforcementRuns(model).entries()){
    if(!run.tubeIds.every(id=>{const t=model.tubes.get(id);return t&&model.nodes.has(t.a)&&model.nodes.has(t.b);}))continue;
    const points=run.tubeIds.flatMap(id=>{const t=model.tubes.get(id);return [model.nodes.get(t.a),model.nodes.get(t.b)];});
    const first=model.tubes.get(run.tubeIds[0]),axis0=unit(sub(xyz(model.nodes.get(first.b)),xyz(model.nodes.get(first.a)))),dominant=axis0.findIndex(v=>Math.abs(v)===Math.max(...axis0.map(Math.abs))),axis=axis0[dominant]<0?axis0.map(v=>-v):axis0;
    const ordered=[...points].sort((a,b)=>dot(xyz(a),axis)-dot(xyz(b),axis)),start=xyz(ordered[0]),end=xyz(ordered.at(-1)),span=dot(sub(end,start),axis);
    const counts=new Map();for(const n of points)counts.set(n.id,(counts.get(n.id)||0)+1);
    const middle=[...counts].filter(([,count])=>count>1).map(([id])=>id),through=middle.every(id=>{const r=resolveNodeConnection(model,id);return [1,-1].every(sign=>r.renderDirs.some(d=>dot(d,axis)*sign>.995));});
    const carrierOrder=[...run.tubeIds].sort((a,b)=>{const lo=id=>{const t=model.tubes.get(id);return Math.min(...[t.a,t.b].map(n=>dot(sub(xyz(model.nodes.get(n)),start),axis)));};return lo(a)-lo(b);});
    const id=`assembly-wood-${index+1}`,a=`${id}-start`,b=`${id}-end`;
    virtual.nodes.set(a,{id:a,x:start[0]-axis[0]*2.5,y:start[1]-axis[1]*2.5,z:start[2]-axis[2]*2.5});
    virtual.nodes.set(b,{id:b,x:end[0]+axis[0]*2.5,y:end[1]+axis[1]*2.5,z:end[2]+axis[2]*2.5});
    virtual.tubes.set(id,{id,a,b,tubeId:'T75',length:80,geom:{p0:xyz(virtual.nodes.get(a)),dir:axis,len:80},reinforced:false});
    channels.push({id,run,axis,start,end,span,middle,carrierOrder,firstCarrier:carrierOrder[0],valid:Math.abs(span-80)<.6&&through&&run.tubeIds.length<=2&&run.tubeIds.every(id=>{const t=model.tubes.get(id);return !t.bow&&!t.arm&&!t.link&&((run.tubeIds.length===1&&Math.abs((t.geom?.len||t.length)-75)<.01)||(run.tubeIds.length===2&&Math.abs((t.geom?.len||t.length)-35)<.01));}),active:false,terminalNodeIds:[ordered[0].id,ordered.at(-1).id],basis:'official-80cm-profile-compatibility-and-opposed-port-topology',crossSection:'official-compatible; dimensions-unmeasured'});
  }
  beginAssemblyCollisionPass(virtual);
  const check=(moving,installed,start,end=[0,0,0],{obstacleTranslations:poses=new Map(),...extra}={})=>{
    const travel=sub(end,start),movingIds=[...moving];
    for(const channel of channels.filter(c=>c.active))if(moving.includes(channel.firstCarrier)&&!movingIds.includes(channel.id))movingIds.push(channel.id);
    for(const id of movingIds){
      let obstacles=installed.filter(other=>!movingIds.includes(other));const matingContacts=new Map();
      for(const channel of channels.filter(c=>c.active)){
        const offset=poses.get(channel.id)||[0,0,0],parallel=Math.hypot(...travel)<1e-8||Math.abs(dot(unit(travel),channel.axis))>.995;
        if(id===channel.id){
          // Only the verified factory-compatible axial channel is excluded.
          obstacles=obstacles.filter(other=>{
            const tube=model.tubes.get(other),node=model.nodes.get(other),carrier=channel.run.tubeIds.includes(other),through=channel.middle.includes(other)||channel.terminalNodeIds.includes(other);
            if(!parallel||(!carrier&&!through))return true;
            const obstacleOffset=poses.get(other)||[0,0,0],point=tube?xyz(model.nodes.get(tube.a)):xyz(node),d=tube?unit(sub(xyz(model.nodes.get(tube.b)),point)):channel.axis;
            if(Math.abs(dot(d,channel.axis))<.995)return true;
            // Compatibility is an internal coaxial channel rule, never a name-
            // based exemption after one member has been transported sideways.
            const relative=sub(point.map((v,i)=>v+obstacleOffset[i]),channel.start.map((v,i)=>v+end[i])),along=dot(relative,channel.axis),radial=Math.hypot(...relative.map((v,i)=>v-channel.axis[i]*along));
            if(radial>.01)return true;
            if(through){const resolution=resolveNodeConnection(model,other);if(!resolution.renderDirs.some(d=>Math.abs(dot(d,channel.axis))>.995))return true;return along< -7.5||along>80+7.5;}
            const far=dot(sub(xyz(model.nodes.get(tube.b)).map((v,i)=>v+obstacleOffset[i]),channel.start.map((v,i)=>v+end[i])),channel.axis);
            return Math.max(along,far)< -7.5||Math.min(along,far)>80+7.5;
          });
        }else{
          const tube=model.tubes.get(id),through=channel.middle.includes(id)||channel.terminalNodeIds[1]===id,carrier=channel.run.tubeIds.includes(id);
          if(parallel&&(carrier||through)){
            const point=tube?xyz(model.nodes.get(tube.a)):xyz(model.nodes.get(id)),relative=sub(point.map((v,i)=>v+end[i]),channel.start.map((v,i)=>v+offset[i]));
            if(Math.hypot(...relative.map((v,i)=>v-channel.axis[i]*dot(relative,channel.axis)))<.01)obstacles=obstacles.filter(other=>other!==channel.id);
          }
          if(tube){const shared=[tube.a,tube.b].filter(n=>channel.middle.includes(n));if(shared.length)matingContacts.set(`${id}:${channel.id}`,shared);}
        }
      }
      const failure=checkAssemblyPath(virtual,[id],obstacles,start,end,{obstacleTranslations:poses,matingContacts,movingAssemblyIds:movingIds,...pathOptions,...extra});if(failure)return failure;
    }
    return null;
  };
  return {model:virtual,channels,check};
}
