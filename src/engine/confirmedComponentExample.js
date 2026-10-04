import { BuildModel, POOL_SETS } from './model.js';
import { createOriginalAccessoryExample } from './accessoryExample.js';
import { CONFIRMED_COMPONENTS, confirmedSpec } from './componentPack.js';
import { getTube, allTubes } from './catalog.js';

// 独立结构夹具通过真实模型API安装，供外观、变换与保存验收，不表示实物承载通过。
export function createConfirmedComponentFixture(id, { install = true, offset = [0,0,0] } = {}) {
  const spec=confirmedSpec(id);if(!spec)throw new Error(`没有确认的组件：${id}`);
  const model=new BuildModel(),points=new Map();
  const node=p=>{const key=p.join(',');if(!points.has(key))points.set(key,model.addNode(p[0]+offset[0],p[1]+offset[1],p[2]+offset[2]));return points.get(key);};
  const tube=(a,b,color='yellow',curved=false,center=null)=>{
    const na=node(a),nb=node(b),length=Math.hypot(...a.map((v,i)=>v-b[i]));
    const part=curved?getTube('TC1'):allTubes().find(t=>t.buildable && t.shape==='straight' && Math.abs(t.length_cm+5-length)<0.1 && !t.id.startsWith('TA'));
    if(!part && !curved && length===60) { const mid=a.map((v,i)=>(v+b[i])/2);const first=tube(a,mid,color);tube(mid,b,color);return first; }
    if(!part)throw new Error(`夹具没有对应管长：${length}`);
    const record=model.addTube(na.id,nb.id,part.id,color,part.length_cm);
    if(!record)throw new Error('框架创建失败');
    if(curved){record.bow=true;record.bowCenter=center.map((v,i)=>v+offset[i]);}
    return record;
  };
  if(spec.mountType==='curved-frame') {
    for(const x of [0,40])tube([x,42.5,0],[x,82.5,40],'yellow',true,[x,42.5,40]);
    tube([0,42.5,0],[40,42.5,0],'green');tube([0,82.5,40],[40,82.5,40],'green');
    for(const x of [0,40]){tube([x,42.5,0],[x,42.5,40],'red');tube([x,42.5,40],[x,82.5,40],'blue');tube([x,2.5,40],[x,42.5,40],'green');}
  } else if(spec.mountType==='corner') {
    tube([0,42.5,0],[40,42.5,0]);tube([0,42.5,0],[0,82.5,0],'green');
    tube([40,42.5,0],[0,82.5,0],'blue',true,[0,42.5,0]);
    tube([0,2.5,0],[0,42.5,0],'green');tube([40,2.5,0],[40,42.5,0],'yellow');
    tube([0,2.5,0],[40,2.5,0],'red');
  } else if(spec.mountType==='tube') {
    tube([0,42.5,0],[40,42.5,0],'green');
    for(const x of [0,40]){tube([x,2.5,0],[x,42.5,0]);tube([x,2.5,0],[x,2.5,40],'red');}
    tube([0,2.5,40],[40,2.5,40],'blue');
  } else {
    const horizontal=spec.placement==='fitting' || spec.mountType==='horizontal-frame',w=spec.width,h=spec.height;
    const positions=horizontal?[[0,42.5,0],[w,42.5,0],[w,42.5,h],[0,42.5,h]]:[[0,42.5,0],[w,42.5,0],[w,42.5+h,0],[0,42.5+h,0]];
    for(let i=0;i<4;i++)tube(positions[i],positions[(i+1)%4],['red','green','blue','yellow'][i]);
    for(const x of [0,w]){tube([x,2.5,0],[x,42.5,0],'green');tube([x,2.5,0],[x,2.5,40],'blue');}
    tube([0,2.5,40],[w,2.5,40],'red');
  }
  const candidates=model.confirmedMounts(id),candidate=candidates.find(c=>c.valid);
  if(!candidate)throw new Error(`${id}无可用真实安装位置：${candidates.map(c=>c.reason).join(',')}`);
  const part=install?model.addConfirmedComponent(candidate,spec.fixedColor||'blue'):null;
  if(install && !part)throw new Error(`${id}安装失败`);
  return {model,part,candidate};
}

export function createConfirmedComponentGallery() {
  const model=new BuildModel(),manifest=[];
  CONFIRMED_COMPONENTS.forEach((spec,i)=>{
    const offset=[(i%6)*160,0,Math.floor(i/6)*180],fixture=createConfirmedComponentFixture(spec.id,{offset});
    const selection=new Map([...fixture.model.nodes.keys()].map(id=>[id,'node']));
    const fragment=fixture.model.extractSelection(selection);
    const inserted=model.insertFragment(fragment,[offset[0],2.5,offset[2]]);
    manifest.push({partId:spec.id,ids:inserted,designAssumption:true});
  });
  return {model,manifest};
}

export function createRetainedComponentFixture(id) {
  if(id==='swing' || id==='gym_rings') {
    const model=createOriginalAccessoryExample(),swing=[...model.fittings.values()].find(p=>p.kind==='swing');
    for(const panel of [...model.panels.values()])model.removePanel(panel.id);
    for(const fitting of [...model.fittings.values()])if(fitting.id!==swing.id)model.removeFitting(fitting.id);
    if(id==='gym_rings') {model.removeFitting(swing.id);if(!model.addAccessory(id,swing.tube,'blue'))throw new Error('沿线吊环安装失败');}
    return model;
  }
  if(id==='textile_rainbow') {
    const {model,candidate}=createConfirmedComponentFixture('textile',{install:false});
    const textile=model.addTextile(candidate.a,candidate.b,candidate.t0,candidate.len,'yellow');
    if(!textile)throw new Error('线上彩虹门安装失败');textile.variant='rainbow';return model;
  }
  const model=new BuildModel();
  if(id==='wheel'){
    const a=model.addNode(0,42.5,0),b=model.addNode(40,42.5,0);
    const tube=model.addTube(a.id,b.id,'T35','green',35);
    const mount=model.tubeFittingMount(tube.id,[13,42.5,0],'multi-wheel2');
    if(!mount || !model.addFittingAt('multi-wheel2',mount,'yellow'))throw new Error('原版多向轮安装失败');
    return model;
  }
  if(id==='TA35' || id==='TA75') {
    const part=getTube(id),a=model.addNode(0,2.5,0),b=model.addNode(part.length_cm+5,2.5,0);
    if(!model.addTube(a.id,b.id,id,'blue',part.length_cm))throw new Error('铝管安装失败');return model;
  }
  if(id==='ocean_balls') {
    const fragment=model.poolFragment(POOL_SETS.pool_liner_xs,{tubeFor:span=>allTubes().find(t=>t.buildable && t.shape==='straight' && !t.id.startsWith('TA') && Math.abs(t.length_cm+5-span)<0.1)});
    if(!fragment)throw new Error('海洋球池框架生成失败');model.insertFragment(fragment,[0,2.5,0]);
    for(const part of model.fittings.values())part.balls=true;return model;
  }
  throw new Error(`未知保留件：${id}`);
}
