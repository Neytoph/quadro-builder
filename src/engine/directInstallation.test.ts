import {beforeAll,describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {loadCatalog} from './catalog.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'
import {INSET_PANEL_IDS} from './insetPanelMounts.js'
import {createConfirmedComponentFixture} from './confirmedComponentExample.js'
import {createDirectInstallationFrame} from './directInstallationExample.js'
import {componentFrame,componentMountsValid,componentObstacle,componentVolumes,mountPoint} from './accessoryPack.js'
import {confirmedComponentMeshes} from './confirmedComponentMeshes.js'
beforeAll(async()=>{await loadCatalog()})
const selection=(m:BuildModel)=>new Map([...m.nodes.keys()].map(id=>[id,'node']))
const busy=(m:BuildModel,axis='vertical',left=true)=>m.panelAccessoryMounts('panel_40x40_busy',{screwAxis:axis}).find((p:any)=>p.pos[1]>60 && (left?p.pos[0]<40:p.pos[0]>40)) as any
const meshes=(m:BuildModel,p:any)=>confirmedComponentMeshes({_materials:{},_cachedGeo:(_key:string,make:()=>THREE.BufferGeometry)=>make()},m,p)
function controller(model:BuildModel,camera=[20,60,150]) {
  // 控制器调度与真实Yjs历史的隔离检查；场景适配只提供相机/刷新，不冒充实际鼠标或WebGL。
  const b=Object.create(Builder.prototype),history=new ModelHistory(docFromJSON(model.toJSON() as any))
  Object.assign(b,{model,history,scene:{cameraPosition:()=>camera,clearInstallationPreview:()=>{}},selection:new Map(),color:'green',mode:'panel',refresh:()=>{},onNotice:()=>{}})
  return b as Builder
}
describe('点击有效安装位置直接写入一次历史',()=>{
  it.each([150,-150])('忙碌板按相机近侧保存，Esc/重开后姿态一致，相机z=%s',z=>{
    const model=createDirectInstallationFrame(80,40,{vertical:true}),b=controller(model,[20,60,z]);let edits=0
    b.history.onEdit(()=>edits++)
    expect(b._previewInstallation(busy(model),'panel_40x40_busy')).toBe(true)
    expect(model.panels.size).toBe(1);expect(edits).toBe(1);expect(b.installationPreview).toBeNull()
    const part=[...model.panels.values()][0] as any,frame=componentFrame(model,part)!
    expect(frame.axes[2][2]*z).toBeGreaterThan(0)
    const saved=model.toJSON();b.cancelInstallation();expect(model.toJSON()).toEqual(saved)
    const reopened=new BuildModel();reopened.loadJSON(saved);expect(componentFrame(reopened,reopened.panels.get(part.id)!)!.axes).toEqual(frame.axes)
    b.history.undo();expect(b.history.toJSON().panels).toHaveLength(0);expect(b.history.canUndo()).toBe(false)
  })
  it('有效方向盘直接安装，选中后的翻转仍单独可撤销',()=>{
    const model=createDirectInstallationFrame(),tube=[...model.tubes.values()].find(t=>model._rail(t.id)!.dir[0]===1)!,b=controller(model)
    expect(b._previewInstallation(model.accessoryDiagnostics('steering_wheel',tube.id),'steering_wheel')).toBe(true)
    const part=[...model.fittings.values()][0] as any;b.selection.set(part.id,'fitting')
    expect(b.canFlipSelectedAccessory()).toBe(true);expect(b.flipSelectedAccessory()).toBe(true);expect(part.facing).toBe(-1)
    b.history.undo();expect((b.history.toJSON().fittings![0] as any).facing).toBe(1)
  })
  it('绳子第二点实际候选即安装，非法第二点不写历史',()=>{
    const model=createDirectInstallationFrame(),rails=[...model.tubes.values()].filter(t=>model._rail(t.id)!.dir[0]===1),b=controller(model)
    const first={tube:rails[0].id,t:.3},second={tube:rails[1].id,t:.7}
    expect(b._previewInstallation(model.ropeDiagnostics(first,second),'rope')).toBe(true)
    expect([...model.fittings.values()].filter(p=>p.kind==='rope')).toHaveLength(1)
    expect(b.installationPreview).toBeNull()
    b._previewInstallation(model.ropeDiagnostics(first,first),'rope');expect(b.installationPreview!.valid).toBe(false)
    b.history.undo();expect(b.history.toJSON().fittings).toHaveLength(0);expect(b.history.canUndo()).toBe(false)
  })
})
describe('八种内嵌件选择真实左右/上下对边',()=>{
  it.each([...INSET_PANEL_IDS].flatMap(id=>['vertical','horizontal'].map(axis=>[id,axis])))('%s %s 四螺丝、变换与引用', (id,axis)=>{
    const model=id==='panel_40x40_busy'?createDirectInstallationFrame(80,40,{vertical:true}):createConfirmedComponentFixture(id,{install:false}).model
    const candidate=model.panelAccessoryMounts(id,{screwAxis:axis}).find((p:any)=>p.valid && (id!=='panel_40x40_busy'||p.pos[1]>60)) as any
    expect(candidate).toBeTruthy()
    const part=(id==='panel_40x40_busy'?model.addPanelAccessory(candidate,'green'):model.addConfirmedComponent(candidate,'blue')) as any
    expect(part).toBeTruthy();expect(part.params.screwAxis).toBe(axis);expect(part.mounts).toHaveLength(4)
    const frame=componentFrame(model,part)!,dimension=axis==='vertical'?0:1,size=dimension===0?part.params.width:part.params.height
    for(const sign of [-1,1])expect(part.mounts.filter((mount:any)=>Math.abs(mountPoint(model,mount)!.reduce((s:number,v:number,i:number)=>s+(v-frame.pos[i])*frame.axes[dimension][i],0)-sign*size/2)<.1)).toHaveLength(2)
    expect(componentMountsValid(model,part)).toBe(true)
    expect(model.moveSelection(selection(model),320,0,0).ok).toBe(true);expect(model.rotateSelection(selection(model)).ok).toBe(true);expect(model.mirrorSelection(selection(model),'z').ok).toBe(true)
    expect(componentMountsValid(model,model.panels.get(part.id)!)).toBe(true)
    const saved=model.toJSON(),reopen=new BuildModel();reopen.loadJSON(saved);expect(reopen.toJSON()).toEqual(saved)
    const copy=model.insertFragment(model.extractSelection(selection(model))!,[640,2.5,0]) as any,copied=model.panels.get(copy.panels[0]) as any
    expect(componentMountsValid(model,copied)).toBe(true);expect(copied.supportTubes.every((id:string)=>copy.tubes.includes(id))).toBe(true)
    model.removeTube(copied.supportTubes[0]);expect(model.panels.has(copied.id)).toBe(false)
  })
  it('邻格共立管仍占用，改上下对边可合法安装；重复开口仍拒绝',()=>{
    const model=createDirectInstallationFrame(80,40,{vertical:true}),left=model.addPanelAccessory(busy(model),'green') as any
    const rightFrame=createDirectInstallationFrame(80,40,{vertical:true}),right=busy(rightFrame,'vertical',false)
    expect(model.panelAccessoryDiagnostics(right).reason).toBe('mount_occupied')
    expect(busy(model,'vertical',false)).toBeUndefined()
    const upper=busy(model,'horizontal',false);expect(upper.valid).toBe(true)
    const added=model.addPanelAccessory(upper,'green') as any;expect(componentMountsValid(model,added)).toBe(true)
    expect(model.addPanelAccessory(upper,'green')).toBeNull();expect(componentObstacle(model,left)).toBeNull()
  })
  it('旧八件轴字段缺省保持原存档，不自动添加；非法选轴拒绝',()=>{
    const old=JSON.parse(readFileSync('src/engine/__fixtures__/inset-panels-legacy-2b45062.json','utf8')).models
    for(const id of INSET_PANEL_IDS){const m=new BuildModel();m.loadJSON(old[id]);const p=[...m.panels.values()].find((p:any)=>p.panelId===id) as any,saved=m.toJSON();expect(p.params.screwAxis).toBeUndefined();expect(componentMountsValid(m,p)).toBe(true);expect(m.toJSON()).toEqual(saved);p.params.screwAxis='diagonal';expect(componentMountsValid(m,p)).toBe(false)}
  })
})
describe('连续完整边界蹦床尺寸和固定',()=>{
  it.each([[40,40],[40,80],[80,40],[80,80]])('%sx%s 实际多管边界、几何/占用/保存/镜像复制一致',(w,h)=>{
    const model=createDirectInstallationFrame(w,h),candidate=model.confirmedMounts('trampoline').find((p:any)=>p.valid && p.params.width===w && p.params.height===h)!
    const part=model.addConfirmedComponent(candidate,'black') as any
    expect(part).toBeTruthy();expect([part.w,part.h,part.params.width,part.params.height]).toEqual([w,h,w,h])
    const perimeter=[...model.tubes.values()].filter(t=>[t.a,t.b].every(id=>model.nodes.get(id)!.y===42.5)).map(t=>t.id)
    expect(new Set(part.supportTubes)).toEqual(new Set(perimeter));expect(part.mounts.every((m:any)=>perimeter.includes(m.tube))).toBe(true)
    expect(part.mounts.length).toBeGreaterThanOrEqual(36);expect(componentMountsValid(model,part)).toBe(true)
    const saved=model.toJSON(),opened=new BuildModel();opened.loadJSON(saved);expect(opened.toJSON()).toEqual(saved)
    const mesh=meshes(model,part).find(m=>m.name.startsWith('fabric:'))!,box=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());expect([box.x,box.z].sort((a,b)=>a-b)[1]).toBeCloseTo(Math.max(w,h)*.74,1)
    expect(componentVolumes(model,part)[0].half.slice(0,2)).toEqual([w/2-3,h/2-3])
    expect(model.moveSelection(selection(model),320,0,0).ok).toBe(true);expect(model.rotateSelection(selection(model)).ok).toBe(true);expect(model.mirrorSelection(selection(model),'z').ok).toBe(true)
    const copy=model.insertFragment(model.extractSelection(selection(model))!,[640,2.5,0]) as any,copied=model.fittings.get(copy.fittings[0]) as any
    expect(componentMountsValid(model,copied)).toBe(true);expect(copied.supportTubes.every((id:string)=>copy.tubes.includes(id))).toBe(true)
    model.removeTube(copied.supportTubes[0]);expect(model.fittings.has(copied.id)).toBe(false)
  })
  it('旧40参数缺w/h仍40，不能默认为80',()=>{
    const model=new BuildModel();model.loadJSON(JSON.parse(readFileSync('src/engine/__fixtures__/trampoline-40x40-81f934d.json','utf8')))
    const part=[...model.fittings.values()][0] as any;expect(part.params.width).toBe(40);expect(componentMountsValid(model,part)).toBe(true)
    expect(componentVolumes(model,part)[0].half.slice(0,2)).toEqual([17,17])
  })
  it('缺边、重复、内部横管及伪造尺寸仍拒绝',()=>{
    const model=createDirectInstallationFrame(),candidate=model.confirmedMounts('trampoline').find((p:any)=>p.valid && p.params.width===80 && p.params.height===80)!
    const saved=model.toJSON(),part=model.addConfirmedComponent(candidate,'black') as any;expect(model.addConfirmedComponent(candidate,'black')).toBeNull()
    part.params.width=60;expect(componentMountsValid(model,part)).toBe(false)
    model.loadJSON(saved);model.removeTube(candidate.supportTubes[0]);expect(model.confirmedMounts('trampoline').some((p:any)=>p.params.width===80 && p.params.height===80 && p.valid)).toBe(false)
    model.loadJSON(saved);const a=model.addNode(0,42.5,40),b=model.addNode(80,42.5,40);model.addTube(a.id,b.id,'T75','red',75)
    expect(model.confirmedMounts('trampoline').some((p:any)=>p.params.width===80 && p.params.height===80 && p.valid)).toBe(false)
  })
})
