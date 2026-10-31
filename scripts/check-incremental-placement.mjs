import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [source,output='.work/incremental-browser',url='http://127.0.0.1:34835/']=process.argv.slice(2);
if(!source)throw new Error('需要原生模型 JSON 路径');
mkdirSync(output,{recursive:true});
const data=JSON.parse(readFileSync(source,'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],rows=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.addInitScript(()=>localStorage.setItem('quadro.builder.onboarded.v2','1'));
  await page.goto(url);
  await page.waitForFunction(()=>window.__quadroDev?.builder.history);
  const counts=await page.evaluate(async data=>{
    await(await import('/src/engine/assemblyNativeMesh.js')).ensureAssemblyMeshes();
    const {model,builder,scene}=window.__quadroDev;
    builder.setMode('select');if(!model.loadJSON(data).ok)throw new Error('模型加载失败');
    builder.modelReplaced();builder.history.commit(JSON.stringify(builder.history.toJSON()),JSON.stringify(model.toJSON()));
    scene.resetCamera(model);window.incrementalBase=structuredClone(model.toJSON());
    window.checkIncremental=async label=>{
      const {BuildModel}=await import('/src/engine/model.js');
      const {withPlacementPass,placementCacheStats}=await import('/src/engine/incrementalPlacement.js');
      const {DIRECTIONS}=await import('/src/engine/config.js');
      const fresh=new BuildModel();fresh.loadJSON(model.toJSON());
      const query=m=>withPlacementPass(m,()=>{
        const context=m.tubeExtensionContext();
        return {
          honeycomb:m.panelAccessoryMounts('panel_40x40_honeycomb'),
          panel:m.panelAccessoryMounts('panel_40x40'),
          sleeve:m.confirmedMounts('sleeve'),trampoline:m.confirmedMounts('trampoline'),
          steering:m.accessoryMounts('steering_wheel'),swing:m.accessoryMounts('swing'),rings:m.accessoryMounts('gym_rings'),
          wheels:m.tubeFittingSpots('multi-wheel2'),holes:m.holeArmMounts(),
          slides:m.slideMounts(),chains:m.slideChainMounts('slide-end2'),
          tubes:[...m.nodes.values()].flatMap(n=>DIRECTIONS.map(d=>{
            const p=m.planTubeExtension(n.id,d.vec,40,{context});
            return [n.id,d.name,p&&{target:p.target,existing:p.existing?.id,node:p.node?.id,collision:p.collision,ground:p.ground,duplicate:p.duplicate}];
          })),
        };
      });
      const before=placementCacheStats(model),start=performance.now(),actual=query(model),incrementalMs=performance.now()-start;
      const fullStart=performance.now(),expected=query(fresh),fullMs=performance.now()-fullStart;
      for(const key of Object.keys(actual))if(JSON.stringify(actual[key])!==JSON.stringify(expected[key]))throw new Error(`${label}: ${key} 增量结果不同于完整重算`);
      const after=placementCacheStats(model);
      if(after.hits+after.misses===(before?.hits||0)+(before?.misses||0))throw new Error('未进入同一增量缓存实例；重启开发服务器后复测');
      return {label,incrementalMs,fullMs,hits:after.hits-(before?.hits||0),misses:after.misses-(before?.misses||0),counts:Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,v.length]))};
    };
    return Object.fromEntries(['nodes','tubes','panels','fittings','clamps'].map(k=>[k,model[k].size]));
  },data);
  rows.push(await page.evaluate(()=>window.checkIncremental('初始模型')));
  for(const kind of ['tube','panel_40x40_honeycomb','panel_40x40','steering_wheel','sleeve','trampoline','clamp','textile']){
    console.log('check',kind);
    await page.evaluate(kind=>{
      const {builder}=window.__quadroDev;
      if(kind==='tube'){builder.setTube('T35');builder.setMode('add');}
      else if(kind==='clamp'){builder.setClampPart('double_tube',{refresh:false});builder.setMode('clamp');}
      else if(kind==='textile'){builder.setFitting('textil2',null,{refresh:false});builder.setMode('fitting');}
      else if(kind.startsWith('panel_')){builder.setPanel(kind,{refresh:false});builder.setMode('panel');}
      else{builder.setFitting(kind,kind,{refresh:false});builder.setMode('fitting');}
    },kind);
    if(kind.startsWith('panel_'))await page.waitForFunction(()=>{const q=window.__quadroDev.builder._panelMountQueue;return q&&!q.running&&!q.waiting&&q.results.size;},null,{timeout:60000});
    const installed=await page.evaluate(async kind=>{
      const {builder,model}=window.__quadroDev;
      const group=kind==='tube'?'tubes':kind==='clamp'?'clamps':kind==='textile'?'textiles':kind.startsWith('panel_')?'panels':'fittings';
      const before=new Set(model[group].keys()),original=structuredClone(model.toJSON());
      let started;
      if(kind==='tube'){
        const h=window.__quadroDev.scene.handleMeshes.find(h=>h.userData.nodeId&&h.userData.dir&&!h.userData.slope);
        if(!h)throw new Error('没有接管位置');
        builder.selectedNodeId=h.userData.nodeId;builder.stepFrom=[];
        started=performance.now();builder.buildStep(h.userData.dir);
      }else if(kind==='clamp'){
        const mount=builder._tubeMidpoints().find(m=>!model.clampNear(...m.pos));
        if(!mount)throw new Error('没有管夹位置');
        started=performance.now();builder._placeClampOnTube(mount.tubeId,{x:mount.pos[0],y:mount.pos[1],z:mount.pos[2]});
      }else if(kind==='textile'){
        const mount=model.railFittingMounts('textil2')[0];
        if(!mount)throw new Error('没有布件位置');
        started=performance.now();builder._placeRailFitting(mount.a,mount.b,mount.t0,mount.len);
      }else{
        const candidates=group==='panels'?model.panelAccessoryMounts(kind):kind==='steering_wheel'?model.accessoryMounts(kind):model.confirmedMounts(kind);
        const part=candidates.find(p=>p.valid);if(!part)throw new Error(`${kind} 没有安装位置`);
        builder._installationPart=part;started=performance.now();if(!builder.confirmInstallation())throw new Error(`${kind} 安装失败`);
      }
      const elapsed=performance.now()-started,id=[...model[group].keys()].find(id=>!before.has(id));
      if(!id)throw new Error(`${kind} 未写入模型`);
      window.incrementalOperation={id,group,original,installed:structuredClone(model.toJSON())};
      return {kind,id,elapsed,handles:window.__quadroDev.scene.handleMeshes.length};
    },kind);
    rows.push({installed});
    rows.push(await page.evaluate(kind=>window.checkIncremental(kind+' 安装'),kind));
    for(const step of ['undo-install','redo-install','delete','undo-delete','redo-delete']){
      const timing=await page.evaluate(({kind,step})=>{
        const {builder,model}=window.__quadroDev,{id,group,original,installed}=window.incrementalOperation,start=performance.now();
        if(step.startsWith('undo'))builder.undo();else if(step.startsWith('redo'))builder.redo();
        else {builder.selection.clear();builder.selection.set(id,({tubes:'tube',panels:'panel',clamps:'clamp',textiles:'textile',fittings:'fitting'})[group]);if(!builder.deleteSelection())throw new Error('删除失败');}
        const has=model[group].has(id),expected=step==='redo-install'||step==='undo-delete';
        if(has!==expected)throw new Error(`${kind} ${step} 实体存在状态错误`);
        if(step==='undo-install' && JSON.stringify(model.toJSON())!==JSON.stringify(original))throw new Error('安装撤销未还原完整模型');
        if(expected && JSON.stringify(model.toJSON())!==JSON.stringify(installed))throw new Error('重做或撤销删除未还原完整模型');
        return {operation:kind+' '+step,elapsed:performance.now()-start};
      },{kind,step});
      rows.push(timing,await page.evaluate(label=>window.checkIncremental(label),kind+' '+step));
      console.log(kind,step,'passed');
    }
  }
  await page.waitForFunction(()=>{const q=window.__quadroDev.builder._panelMountQueue;return !q?.running&&!q?.waiting;},null,{timeout:60000});
  await page.screenshot({path:resolve(output,'large-model.png')});
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,'results.json'),JSON.stringify({source,counts,rows,errors,interaction:'真实 Chrome / WebGL / Worker；调用 Builder 安装、键盘接管、删除、撤销重做入口；未模拟鼠标点击'},null,2));
  console.log(JSON.stringify({counts,checks:rows.filter(r=>r.label).length,errors}));
}finally{await browser.close();}
