import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { confirmedColor } from './componentPack.js'
import { COLOR_HEX } from './colors.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { componentMountsValid, componentObstacle, componentVolumes } from './accessoryPack.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { computeSafety } from './safety.js'

beforeAll(async()=>{await loadCatalog()})
const selection=(model: BuildModel)=>new Map([...model.nodes.keys()].map(id=>[id,'node']))
const parts=(model: BuildModel)=>[...model.panels.values(),...model.fittings.values()] as any[]
function meshes(model: BuildModel,part: any): THREE.Mesh[] {
  // 仅隔离几何生成；WebGL成像由前端真实浏览器验收。
  const cache=new Map<string,THREE.BufferGeometry>()
  return confirmedComponentMeshes({_materials:{},_cachedGeo:(key: string,make: ()=>THREE.BufferGeometry)=>{if(!cache.has(key))cache.set(key,make());return cache.get(key)!}},model,part)
}

describe('确认组件实际安装与生命周期',()=>{
  it.each(CONFIRMED_COMPONENTS.map(p=>p.id))('%s 安装、保存重开、整组变换、复制引用与依赖删除',id=>{
    const {model,part:record}=createConfirmedComponentFixture(id),part=record as any
    expect(componentMountsValid(model,part)).toBe(true)
    expect(componentObstacle(model,part)).toBeNull()
    const geometry=meshes(model,part)
    expect(geometry.length).toBeGreaterThan(0)
    for(const mesh of geometry)expect(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite)).toBe(true)
    const reopened=new BuildModel();expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(componentMountsValid(reopened,parts(reopened)[0])).toBe(true)
    const selected=selection(model)
    expect(model.moveSelection(selected,160,0,0).ok).toBe(true)
    expect(model.rotateSelection(selected).ok).toBe(true)
    expect(model.mirrorSelection(selected,'z').ok).toBe(true)
    for(const p of parts(model))expect(componentMountsValid(model,p)).toBe(true)
    const fragment=model.extractSelection(selection(model))!
    const copy=model.insertFragment(fragment,[480,2.5,0]) as any
    const copied=parts(model).filter(p=>copy.panels.includes(p.id)||copy.fittings.includes(p.id))
    expect(copied).toHaveLength(1)
    expect(copied[0].supportTubes.every((tid: string)=>copy.tubes.includes(tid))).toBe(true)
    expect(copied[0].mounts.every((m: any)=>copy.tubes.includes(m.tube))).toBe(true)
    expect(componentMountsValid(model,copied[0])).toBe(true)
    const snapshot=model.toJSON();model.removeTube(copied[0].supportTubes[0])
    expect(parts(model).map(p=>p.id)).not.toContain(copied[0].id)
    expect(parts(model).map(p=>p.id)).toContain(part.id)
    expect(model.loadJSON(snapshot).ok).toBe(true)
    expect(parts(model)).toHaveLength(2)
  })
})

describe('确认组件数据及装配边界',()=>{
  it('自由blue语义色使用正式天蓝，经典绿固定件统一底板与凸点',()=>{
    const plain=createConfirmedComponentFixture('panel_40x40'),body=meshes(plain.model,plain.part).find(m=>m.name.startsWith('plate:'))!
    expect((body.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('2b8ff0')
    const lego=createConfirmedComponentFixture('panel_40x40_lego'),old=lego.part as any
    old.color='red'
    expect(confirmedColor(old)).toBe(COLOR_HEX.green)
    for(const mesh of meshes(lego.model,old))expect((mesh.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('2fcb5a')
    expect(old.color).toBe('red')
  })
  it('新握点两个金属螺钉在主体前方且保持原占用深度',()=>{
    const {model,part}=createConfirmedComponentFixture('panel_40x40_climbing'),actual=meshes(model,part)
    const grips=actual.filter(m=>m.name.startsWith('rounded-grip:')),faces=actual.filter(m=>m.name==='grip-screw-face')
    expect(faces).toHaveLength(6)
    const front=(mesh: THREE.Mesh)=>{mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox!.max.z+Math.abs(mesh.position.z)}
    expect(Math.min(...faces.map(front))).toBeGreaterThan(Math.max(...grips.map(front)))
    expect(Math.max(...faces.map(front))).toBeLessThan(5.8)
  })
  it('固定色件的普通改色入口保持原生记录与可见颜色一致',()=>{
    for(const id of ['panel_40x40_lego','panel_40x40_basketball']){
      const {model,part:record}=createConfirmedComponentFixture(id),part=record as any,before=part.color
      expect(model.setColorOf(part.panelId?'panel':'fitting',part.id,'red')).toBe(false)
      expect(part.color).toBe(before)
    }
    const {model,part:record}=createConfirmedComponentFixture('panel_40x40'),part=record as any
    expect(model.setColorOf('panel',part.id,'red')).toBe(true)
  })
  it('一键改色实际控制器入口跳过固定色组件和铝管',()=>{
    const {model,part:record}=createConfirmedComponentFixture('panel_40x40_lego'),part=record as any
    const a=model.addNode(100,40,0),b=model.addNode(140,40,0),tube=model.addTube(a.id,b.id,'TA35','blue',35)!
    expect(tube.color).toBe('#b9c0c5');expect(model.setColorOf('tube',tube.id,'red')).toBe(false)
    // 调用正式控制器变色函数；只隔离呈现/通知和历史提交接口，不代表浏览器验收。
    const controller=Object.create(Builder.prototype)
    Object.assign(controller,{model,history:{commit:()=>{}},onNotice:()=>{},refresh:()=>{}})
    expect(controller.recolorAll(['red'])).toBeGreaterThan(0)
    expect(part.color).toBe('#2FCB5A');expect(tube.color).toBe('#b9c0c5')
  })
  it('四个篮球扣体及螺丝确实伸出管外径而非埋在管内',()=>{
    const {model,part:record}=createConfirmedComponentFixture('panel_40x40_basketball'),part=record as any
    const actual=meshes(model,part)
    expect(actual.filter(m=>m.name.startsWith('actual-retainer-wrap:'))).toHaveLength(4)
    expect(actual.filter(m=>m.name.startsWith('actual-retainer:'))).toHaveLength(4)
    for(const mesh of actual.filter(m=>m.name.startsWith('retainer-screw:')))expect(Math.abs(mesh.position.z)).toBeGreaterThan(3.5)
  })
  it.each(['null-mount','object-support','duplicate-mount','bad-quat','rotated-rope','changed-param'])('保存损坏 %s 明确无效且安全检查不崩溃',kind=>{
    const {model}=createConfirmedComponentFixture(kind==='rotated-rope'?'rope':'textile_round'),data=model.toJSON() as any,p=data.fittings[0]
    if(kind==='null-mount')p.mounts[0]=null
    if(kind==='object-support')p.supportTubes={tube:p.tube}
    if(kind==='duplicate-mount')p.mounts[1]=structuredClone(p.mounts[0])
    if(kind==='bad-quat')p.quat=['bad',0,0,1]
    if(kind==='rotated-rope')p.quat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2).toArray()
    if(kind==='changed-param')p.params.height=80
    const target=new BuildModel();target.loadJSON(data)
    expect(componentMountsValid(target,parts(target)[0])).toBe(false)
    expect(()=>computeSafety(target)).not.toThrow()
  })
  it('绳子连接任意实际管参数点，长度跟随两端并保存两绳结',()=>{
    const model=new BuildModel(),a=model.addNode(0,80,0),b=model.addNode(80,80,0),c=model.addNode(15,40,65),d=model.addNode(55,40,65)
    const first=model.addTube(a.id,b.id,'T75','blue',75)!,second=model.addTube(c.id,d.id,'T35','yellow',35)!
    const candidate=model.ropeDiagnostics({tube:first.id,t:0.23},{tube:second.id,t:0.74}) as any
    expect(candidate.valid).toBe(true)
    const part=model.addConfirmedComponent(candidate,'blue') as any
    expect(part.mounts).toHaveLength(2);expect(part.mounts.every((m: any)=>m.role==='knot')).toBe(true)
    expect(part.ropeLength).toBeCloseTo(Math.hypot(15+40*.74-80*.23,40,65))
    expect(componentMountsValid(model,part)).toBe(true)
  })
  it('扇形板必须有真实弧边支撑，删除弧管清除依赖件',()=>{
    const {model,part:record}=createConfirmedComponentFixture('panel_sector_40'),part=record as any
    const bow=part.supportTubes.find((id: string)=>model.tubes.get(id)?.bow)
    expect(bow).toBeTruthy();expect(part.mounts.filter((m: any)=>m.role==='arc-retainer')).toHaveLength(3)
    model.removeTube(bow);expect(model.fittings.has(part.id)).toBe(false)
    expect(model.confirmedMounts('panel_sector_40')).toHaveLength(0)
  })
  it('80长桥实际7个软包横杠，长布套管沿80边',()=>{
    for(const id of ['textile_bridge','textile_long']){
      const {model,part:record}=createConfirmedComponentFixture(id),part=record as any
      expect(part.len).toBe(80)
      if(id==='textile_bridge'){
        expect(part.mounts).toHaveLength(14)
        const rungs=meshes(model,part).filter(m=>m.name.startsWith('soft-bridge-rung:'))
        expect(rungs).toHaveLength(7)
        for(const rung of rungs){rung.geometry.computeBoundingBox();const size=rung.geometry.boundingBox!.getSize(new THREE.Vector3());expect(Math.max(size.x,size.y,size.z)).toBeGreaterThan(34)}
      }
    }
  })
  it('四通布比普通弯管布有更大实际套管端净空',()=>{
    const measure=(id: string)=>{const {model,part}=createConfirmedComponentFixture(id);const g=meshes(model,part).find(m=>m.name.startsWith('continuous-sleeve:'))!.geometry;return Array.from(g.attributes.position.array)}
    const regular=measure('textile_round'),fourway=measure('textile_round_fourway')
    expect(regular).not.toEqual(fourway)
    expect(Math.max(...regular)).toBeGreaterThan(Math.max(...fourway))
  })
  it('互动板前突体积覆盖实际罩/螺丝/凸点且附近障碍不能安装',()=>{
    for(const [id,front] of [['panel_40x40_clock',5.9],['panel_40x40_maze',5.9],['panel_40x40_climbing',5.8],['panel_40x40_lego',3.7],['panel_40x40_capsule',18.3]] as [string,number][]){
      const {model,part}=createConfirmedComponentFixture(id),volumes=componentVolumes(model,part)
      expect(volumes.length).toBeGreaterThan(0)
      const frameNormal=volumes[0].axes[2],center=[20,62.5,0],a=center.map((v,i)=>v+frameNormal[i]*(front-.4)- (i===0?5:0)),b=center.map((v,i)=>v+frameNormal[i]*(front-.4)+(i===0?5:0))
      const na=model.addNode(...a as [number,number,number]),nb=model.addNode(...b as [number,number,number]);model.addTube(na.id,nb.id,'T5','red',5)
      expect(componentObstacle(model,part)).not.toBeNull()
    }
  })
})
