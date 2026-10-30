import { BuildModel } from '../src/engine/model.js';
import { confirmedSpec } from '../src/engine/componentPack.js';
import { confirmedCandidates, confirmedFrame } from '../src/engine/confirmedComponentModel.js';

// 隔离框架覆盖两块竖板转角及上下平台，不读取用户存档。
export function outerPanelCornerFrame(panelId,{split=40,horizontal=false,frontId=null}={}) {
  const spec=confirmedSpec(panelId),width=spec.width,height=spec.height,model=new BuildModel(),nodes=new Map();
  const world=p=>horizontal?[p[1],100-p[0],p[2]]:p;
  const node=p=>{const key=p.join(',');if(!nodes.has(key))nodes.set(key,model.addNode(...world(p)));return nodes.get(key);};
  const edge=(a,b)=>{
    const length=Math.hypot(...b.map((v,i)=>v-a[i]));
    for(let start=0;start<length;start+=split){
      const end=Math.min(length,start+split),first=node(a.map((v,i)=>v+(b[i]-v)*start/length)),second=node(a.map((v,i)=>v+(b[i]-v)*end/length));
      if(!model.addTube(first.id,second.id,`T${end-start-5}`,'green',end-start-5))throw new Error('外扣板转角框架创建失败');
    }
  };
  for(const y of [42.5,42.5+height]){
    edge([0,y,0],[width,y,0]);edge([0,y,width],[width,y,width]);
    edge([0,y,0],[0,y,width]);edge([width,y,0],[width,y,width]);
  }
  for(const x of [0,width])for(const z of [0,width])edge([x,42.5,z],[x,42.5+height,z]);
  const near=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))<.01;
  const normal=n=>horizontal?[n[1],-n[0],n[2]]:n;
  const install=(id,pos,n)=>{
    const wanted=normal(n);
    const candidate=confirmedCandidates(model,id,{deduplicate:false}).flatMap(p=>[p,{...p,side:-(p.side||1)}]).find(p=>{
      const frame=confirmedFrame(model,p);
      return near(frame.pos,world(pos)) && frame.axes[2].reduce((s,v,i)=>s+v*wanted[i],0)>.999 && model.panelPlacementDiagnostics(p).valid;
    });
    if(!candidate || !model.addPanelAccessory(model.panelPlacementDiagnostics(candidate),'blue'))throw new Error(`外扣板邻板安装失败：${id}`);
  };
  const front=frontId || ({'30x30':'panel_30x30','40x30':'panel_40x30_climbing','40x20':'panel_40x20'})[`${width}x${height}`] || 'panel_40x40';
  install(front,[width/2,42.5+height/2,0],[0,0,-1]);
  for(const y of [42.5+height,42.5])install(width===30?'panel_30x30':'panel_40x40',[width/2,y,width/2],[0,1,0]);
  const center=world([0,42.5+height/2,width/2]),outward=normal([-1,0,0]);
  const isTarget=p=>{const frame=confirmedFrame(model,p);return frame&&near(frame.pos,center)&&frame.axes[2].reduce((s,v,i)=>s+v*outward[i],0)>.999;};
  return {model,isTarget,center,outward};
}
