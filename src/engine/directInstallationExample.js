import {BuildModel} from './model.js';

// 仅通过实际BuildModel API建立可点击支撑框，尺寸沿当前框架设计口径。
export function createDirectInstallationFrame(width=80,height=80,{vertical=false}={}) {
  const model=new BuildModel(),nodes=new Map();
  const node=p=>{const key=p.join(',');if(!nodes.has(key))nodes.set(key,model.addNode(...p));return nodes.get(key);};
  const tube=(a,b)=>{const na=node(a),nb=node(b),length=Math.hypot(...a.map((v,i)=>v-b[i])),id=length===40?'T35':'T75';const rec=model.addTube(na.id,nb.id,id,'green',length-5);if(!rec)throw new Error('实际支撑框管件创建失败');return rec;};
  if(vertical){
    for(const x of [0,40,80])tube([x,42.5,0],[x,82.5,0]);
    for(const y of [42.5,82.5])for(const x of [0,40])tube([x,y,0],[x+40,y,0]);
    for(const x of [0,40,80]){tube([x,2.5,0],[x,42.5,0]);tube([x,2.5,0],[x,2.5,40]);}
    return model;
  }
  for(const z of [0,height])for(let x=0;x<width;x+=40)tube([x,42.5,z],[x+40,42.5,z]);
  for(const x of [0,width])for(let z=0;z<height;z+=40)tube([x,42.5,z],[x,42.5,z+40]);
  for(const x of [0,width])for(const z of [0,height])tube([x,2.5,z],[x,42.5,z]);
  return model;
}
