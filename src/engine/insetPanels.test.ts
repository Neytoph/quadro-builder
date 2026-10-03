import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes } from './catalog.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { createOriginalAccessoryExample } from './accessoryExample.js'
import { confirmedColor } from './componentPack.js'
import { confirmedFrame, localToWorld } from './confirmedComponentModel.js'
import { componentMountsValid, componentObstacle, componentVolumes, componentFrame, mountPoint } from './accessoryPack.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { insetScrewMeshes } from './insetPanelMeshes.js'
import { INSET_PANEL_IDS, INSET_MOUNT_LAYOUT } from './insetPanelMounts.js'
import { computeSafety } from './safety.js'

beforeAll(async()=>{await loadCatalog()})
const scene=()=>({_materials:{},_cachedGeo:(_key:string,make:()=>THREE.BufferGeometry)=>make()})
const fixture=(id:string)=>{
  if(id!=='panel_40x40_busy')return createConfirmedComponentFixture(id)
  const model=createOriginalAccessoryExample(),part=[...model.panels.values()].find((p:any)=>p.panelId===id)!
  return {model,part}
}
const selection=(model:BuildModel)=>new Map([...model.nodes.keys()].map(id=>[id,'node']))
const record=(model:BuildModel,id:string)=>[...model.panels.values()].find((p:any)=>p.panelId===id) as any
describe('八类内嵌件两边四螺丝与原生兼容',()=>{
  it.each([...INSET_PANEL_IDS])('%s 新安装真实两条对边、四固定点及生命周期',id=>{
    const {model,part:raw}=fixture(id),part=raw as any,frame=componentFrame(model,part)!
    expect(part.params.mountLayout).toBe(INSET_MOUNT_LAYOUT)
    expect(part.mounts).toHaveLength(4)
    expect(part.mounts.every((m:any)=>m.role==='inset-screw')).toBe(true)
    const positions=part.mounts.map((m:any)=>{
      const delta=mountPoint(model,m)!.map((v:number,i:number)=>v-frame.pos[i]);return frame.axes.map(a=>a.reduce((sum:number,v:number,i:number)=>sum+v*delta[i],0))
    })
    for(const side of [-1,1])expect(positions.filter((p:number[])=>Math.abs(p[0]-side*part.params.width/2)<.1)).toHaveLength(2)
    expect(new Set(part.supportTubes)).toEqual(new Set(part.mounts.map((m:any)=>m.tube)))
    expect(componentMountsValid(model,part)).toBe(true);expect(componentObstacle(model,part)).toBeNull()
    const fasteners=insetScrewMeshes(scene(),model,part,frame)
    expect(fasteners.filter(m=>m.name.startsWith('inset-screw-head:'))).toHaveLength(4)
    for(const mesh of fasteners){
      mesh.geometry.computeBoundingBox();expect(mesh.geometry.boundingBox!.max.z).toBeLessThan(1.3)
    }
    const before=model.toJSON(),reopened=new BuildModel();expect(reopened.loadJSON(before).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(before);expect(componentMountsValid(reopened,record(reopened,id))).toBe(true)
    expect(model.moveSelection(selection(model),320,0,0).ok).toBe(true)
    expect(model.rotateSelection(selection(model)).ok).toBe(true)
    expect(model.mirrorSelection(selection(model),'z').ok).toBe(true)
    expect(componentMountsValid(model,record(model,id))).toBe(true)
    const copy=model.insertFragment(model.extractSelection(selection(model))!,[640,2.5,0]) as any
    const duplicate=[...model.panels.values()].find((p:any)=>copy.panels.includes(p.id) && p.panelId===id) as any
    expect(componentMountsValid(model,duplicate)).toBe(true)
    const saved=model.toJSON();model.removeTube(duplicate.supportTubes[0]);expect(model.panels.has(duplicate.id)).toBe(false)
    expect(model.loadJSON(saved).ok).toBe(true);expect(componentMountsValid(model,model.panels.get(duplicate.id)!)).toBe(true)
  })
  it.each([...INSET_PANEL_IDS])('%s 旧字段与锚点重开完全保持',id=>{
    const data=JSON.parse(readFileSync('src/engine/__fixtures__/inset-panels-legacy-2b45062.json','utf8')).models[id],model=new BuildModel()
    expect(model.loadJSON(data).ok).toBe(true);const part=record(model,id)
    expect(part.params.mountLayout).toBeUndefined()
    const saved=structuredClone(part);expect(componentMountsValid(model,part)).toBe(true)
    const fasteners=insetScrewMeshes(scene(),model,part,componentFrame(model,part)!)
    expect(fasteners.filter(m=>m.name.startsWith('inset-screw-head:'))).toHaveLength(4)
    expect(part).toEqual(saved)
    const reopened=new BuildModel();expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(record(reopened,id)).toEqual(saved);expect(componentMountsValid(reopened,record(reopened,id))).toBe(true)
  })
  it('透明板仅两条实际对边也可安装，缺承载边不能确认',()=>{
    const {model,candidate}=createConfirmedComponentFixture('acrylic_panel_40x40',{install:false})
    const initial=model.confirmedDiagnostics(candidate) as any,supports=new Set(initial.supportTubes)
    const frame=confirmedFrame(model,initial)!
    const nonSupports=[...model.tubes.values()].filter(t=>!supports.has(t.id) && [t.a,t.b].every(id=>Math.abs(model.nodes.get(id)!.z)<.1 && model.nodes.get(id)!.y>=42.5))
    nonSupports.forEach(t=>model.removeTube(t.id))
    const part=model.addConfirmedComponent(candidate,'blue') as any
    expect(part).toBeTruthy();expect(componentMountsValid(model,part)).toBe(true)
    expect(part.supportTubes).toHaveLength(2)
    expect(frame.pos).toHaveLength(3)
    model.removeTube(part.supportTubes[0]);expect(model.panels.has(part.id)).toBe(false)
    expect(model.confirmedDiagnostics(part).valid).toBe(false)
  })
  it.each(['duplicate','role','layout'])('损坏四螺丝记录 %s 明确拒绝且安全不崩溃',kind=>{
    const {model}=fixture('acrylic_panel_40x40'),data=model.toJSON() as any,p=data.panels[0]
    if(kind==='duplicate')p.mounts[1]=structuredClone(p.mounts[0])
    if(kind==='role')p.mounts[0].role='retainer'
    if(kind==='layout')p.params.mountLayout='invented'
    const reopened=new BuildModel();reopened.loadJSON(data)
    expect(componentMountsValid(reopened,record(reopened,'acrylic_panel_40x40'))).toBe(false)
    expect(()=>computeSafety(reopened)).not.toThrow()
  })
})
describe('凸点高度、经典蜂窝色与磨砂膜',()=>{
  it('新凸点升到1.25厘米，旧0.7厘米缺字段保持，空间随真实高度',()=>{
    const {model,part:raw}=fixture('panel_40x40_lego'),part=raw as any,frame=confirmedFrame(model,part)!
    const bounds=()=>{
      const studs=confirmedComponentMeshes(scene(),model,part).filter(m=>m.name.startsWith('lego-stud:'))
      studs.forEach(m=>m.geometry.computeBoundingBox());return studs[0].geometry.boundingBox!.getSize(new THREE.Vector3()).z
    }
    expect(bounds()).toBeCloseTo(1.25);expect(part.params.studHeight).toBe(1.25)
    const depth=()=>Math.max(...componentVolumes(model,part).map(b=>b.half[2]+b.pos.map((v:number,i:number)=>(v-frame.pos[i])*frame.axes[2][i]).reduce((a:number,b:number)=>a+b,0)))
    expect(depth()).toBe(4.5)
    const a=localToWorld(frame,[-10,0,6.5]),b=localToWorld(frame,[10,0,6.5])
    const na=model.addNode(...a as [number,number,number]),nb=model.addNode(...b as [number,number,number]),tube=model.addTube(na.id,nb.id,'T15','red',15)!
    expect(componentObstacle(model,part)).toEqual({kind:'tube',id:tube.id})
    delete part.params.studHeight;expect(bounds()).toBeCloseTo(.7);expect(depth()).toBe(3.7)
    expect(componentMountsValid(model,part)).toBe(true);expect(componentObstacle(model,part)).toBeNull()
  })
  it('蜂窝默认经典蓝、可选色、旧粉色输出与显示一致且旧字段不改',()=>{
    const {model,candidate}=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false})
    const part=model.addConfirmedComponent(candidate) as any
    expect(part.color).toBe('blue');expect(confirmedColor(part)).toBe('blue')
    expect(model.setColorOf('panel',part.id,'green')).toBe(true);expect(confirmedColor(part)).toBe('green')
    part.color='#ec9eb2';delete part.params.paletteVersion
    expect(confirmedColor(part)).toBe('blue');expect(part.color).toBe('#ec9eb2')
    const body=confirmedComponentMeshes(scene(),model,part).find(m=>m.name.startsWith('plate:'))!
    expect((body.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('2b8ff0')
  })
  it('感官膜磨砂透视、无镜面涂层、无专用反射/法线缓存',()=>{
    const {model,part}=fixture('panel_40x40_sensory'),cache=scene(),actual=confirmedComponentMeshes(cache,model,part)
    const film=actual.find(m=>m.name.startsWith('gel-clear-envelope'))!
    const material=film.material as THREE.MeshPhysicalMaterial
    expect(material.roughness).toBeGreaterThan(.5);expect(material.transmission).toBeGreaterThan(.8)
    expect(material.clearcoat).toBe(0);expect(material.envMap).toBeNull();expect(material.normalMap).toBeNull()
    expect((cache as any)._confirmedGelEnvironmentTarget).toBeUndefined()
  })
})

describe('连续分段对边的定位与完整结构依赖',()=>{
  it.each(['acrylic_panel_40x60','panel_40x40_busy'])('%s 仅分段对边可选位置且保存完整路径依赖',id=>{
    const model=new BuildModel(),segments=id==='panel_40x40_busy'?[20,20]:[20,20,20],height=segments.reduce((a,b)=>a+b,0),middle:string[]=[],all:string[]=[]
    for(const x of [0,40]){
      let a=model.addNode(x,42.5,0),y=42.5
      segments.forEach((span,index)=>{
        y+=span;const b=model.addNode(x,y,0),spec=buildableTubes().find((t:any)=>!t.id.startsWith('TA') && t.shape==='straight' && Math.abs(t.length_cm+5-span)<.001)!
        expect(spec).toBeTruthy();const tube=model.addTube(a.id,b.id,spec.id,'blue',spec.length_cm)!
        expect(tube).toBeTruthy();all.push(tube.id);if(segments.length===3 && index===1)middle.push(tube.id);a=b
      })
    }
    const candidate=model.panelAccessoryMounts(id).find(p=>p.valid) as any
    expect(candidate).toBeTruthy();expect(candidate.len).toBe(height)
    const part=(id==='panel_40x40_busy'?model.addPanel(candidate.a,candidate.b,candidate.t0,candidate.len,id,'green',candidate.side):model.addConfirmedComponent(candidate,'blue')) as any
    expect(part).toBeTruthy();expect(part.mounts).toHaveLength(4)
    expect(new Set(part.supportTubes)).toEqual(new Set(all))
    expect(middle.every(t=>!part.mounts.some((m:any)=>m.tube===t))).toBe(true)
    expect(componentMountsValid(model,part)).toBe(true)
    const saved=model.toJSON(),reopened=new BuildModel();expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(componentMountsValid(reopened,record(reopened,id))).toBe(true);expect(reopened.toJSON()).toEqual(saved)
    expect(model.moveSelection(selection(model),160,0,0).ok).toBe(true)
    expect(model.rotateSelection(selection(model)).ok).toBe(true)
    expect(model.mirrorSelection(selection(model),'z').ok).toBe(true)
    expect(componentMountsValid(model,record(model,id))).toBe(true)
    const fragment=model.extractSelection(selection(model))!,copy=model.insertFragment(fragment,[640,2.5,0]) as any
    const duplicate=[...model.panels.values()].find((p:any)=>copy.panels.includes(p.id)) as any
    expect(duplicate.supportTubes).toHaveLength(all.length)
    expect(duplicate.supportTubes.every((t:string)=>copy.tubes.includes(t))).toBe(true)
    expect(componentMountsValid(model,duplicate)).toBe(true)
    for(const tubeId of middle){
      const restored=new BuildModel();restored.loadJSON(saved);restored.removeTube(tubeId)
      expect(restored.panels.has(part.id)).toBe(false)
      restored.loadJSON(saved);expect(componentMountsValid(restored,record(restored,id))).toBe(true)
    }
    const omitted=middle.length?middle:[all[0]],corrupt=structuredClone(saved) as any;corrupt.panels[0].supportTubes=corrupt.panels[0].supportTubes.filter((t:string)=>!omitted.includes(t))
    const invalid=new BuildModel();invalid.loadJSON(corrupt)
    expect(componentMountsValid(invalid,record(invalid,id))).toBe(false)
  })
})
