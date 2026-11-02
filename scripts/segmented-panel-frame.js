import { BuildModel } from '../src/engine/model.js';

// 隔离复现短管围出的实际框格，不读取或改写用户存档。
export function segmentedPanelFrame({ orientation='horizontal', width=40, height=40, split=20 }={}) {
  const model=new BuildModel(),nodes=new Map(),edges=[];
  const world=([x,y])=>{
    if(orientation==='vertical')return [x,y+42.5,0];
    if(orientation==='tilted')return [x,42.5+y*.6,y*.8];
    return [x,42.5,y];
  };
  const node=p=>{
    const key=p.join(',');
    if(!nodes.has(key))nodes.set(key,model.addNode(...world(p)));
    return nodes.get(key);
  };
  const corners=[[0,0],[width,0],[width,height],[0,height]];
  for(let i=0;i<4;i++){
    const a=corners[i],b=corners[(i+1)%4],length=Math.hypot(...b.map((v,k)=>v-a[k])),ids=[];
    for(let start=0;start<length;start+=split){
      const end=Math.min(start+split,length),span=end-start;
      const first=node(a.map((v,k)=>v+(b[k]-v)*start/length)),second=node(a.map((v,k)=>v+(b[k]-v)*end/length));
      const tube=model.addTube(first.id,second.id,span===20?'T15':'T5',['red','green','blue','yellow'][i],span-5);
      if(!tube)throw new Error('短管框格创建失败');
      ids.push(tube.id);
    }
    edges.push(ids);
  }
  return {model,edges,world};
}
