import {beforeAll,describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {Color} from 'three'
import {loadCatalog,buildableTubes,panels,geometry,colorHex} from './catalog.js'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {SceneManager} from './scene.js'
import {confirmedSpec,CONFIRMED_COMPONENTS} from './componentPack.js'
import {ACCESSORY_IDS,componentMountsValid,componentVolumes} from './accessoryPack.js'
import {createRetainedComponentFixture} from './confirmedComponentExample.js'
import {buildQDF} from './qdfexport.js'
import {parseQDF} from './qdfimport.js'
import {computeBOM} from './bom.js'
import {computeSafety} from './safety.js'
beforeAll(async()=>{await loadCatalog()})
const legacy=()=>{const m=new BuildModel();expect(m.loadJSON(JSON.parse(readFileSync('src/engine/__fixtures__/confirmed-wheel-v2-81f934d.json','utf8')).model).ok).toBe(true);return m}
const select=(m:BuildModel)=>new Map([...m.nodes.keys()].map(id=>[id,'node']))
describe('多向轮沿线上原生语义',()=>{
  it('目录、旧别名与控制器恢复原生路由',()=>{
    expect(CONFIRMED_COMPONENTS).toHaveLength(35);expect(confirmedSpec('wheel')).toBeNull();expect(confirmedSpec('multi-wheel2')).toBeNull();expect(ACCESSORY_IDS.has('multi-wheel2')).toBe(false)
    const controller=Object.create(Builder.prototype);Object.assign(controller,{scene:{clearInstallationPreview:()=>{}},_clearPanelRail:()=>{},mode:'build'})
    controller.setFitting('wheel','wheel');expect(controller.fittingKind).toBe('multi-wheel2');expect(controller.installationPreview).toBeNull()
  })
  it('直管任意点击参数、端部余量与相邻轮占用使用实际原生安装',()=>{
    const model=createRetainedComponentFixture('wheel'),tube=[...model.tubes.values()][0],wheel=[...model.fittings.values()][0] as any
    expect(wheel.x).toBe(13);expect(wheel.kind).toBe('multi-wheel2');expect(wheel.appearanceVersion).toBeUndefined()
    const other=model.tubeFittingMount(tube.id,[27,42.5,0],'multi-wheel2')!;expect(other.pos[0]).toBe(27)
    expect(model.addFittingAt('multi-wheel2',other,'blue')).toBeTruthy()
    expect(model.tubeFittingMount(tube.id,[13,42.5,0],'multi-wheel2')).toBeNull()
    expect(model.tubeFittingMount(tube.id,[-50,42.5,0],'multi-wheel2')!.pos[0]).toBeCloseTo(3.7)
  })
  it('原生轴承真实手柄偏移5厘米且保持轮占用规则',()=>{
    const model=createRetainedComponentFixture('wheel');for(const f of [...model.fittings.values()])model.removeFitting(f.id)
    const bearingMount=model.fittingMounts('bearing2')[0];expect(bearingMount).toBeTruthy()
    const bearing=model.addFittingAt('bearing2',bearingMount,'red')!
    const mount=model.fittingMounts('multi-wheel2')[0];expect(mount).toBeTruthy()
    const wheel=model.addFittingAt('multi-wheel2',mount,'blue')!
    expect(Math.hypot(wheel.x-bearing.x,wheel.y-bearing.y,wheel.z-bearing.z)).toBeCloseTo(5)
    expect(model.addFittingAt('multi-wheel2',mount,'red')).toBeNull()
    expect((wheel as any).appearanceVersion).toBeUndefined()
  })
  it('原生自由姿态随明确选区移动、复制、删除并原生重开，占位沿原网格口径',()=>{
    const model=createRetainedComponentFixture('wheel'),wheel=[...model.fittings.values()][0]
    const selection=select(model);selection.set(wheel.id,'fitting')
    expect(model.moveSelection(selection,160,0,0).ok).toBe(true);expect(wheel.x).toBe(173)
    const copy=model.insertFragment(model.extractSelection(selection)!,[320,42.5,0]) as any
    const copied=model.fittings.get(copy.fittings[0]) as any
    expect(copied.kind).toBe('multi-wheel2');expect(copied.appearanceVersion).toBeUndefined();expect(copied.tube).toBeUndefined()
    expect(componentVolumes(model,copied)[0].half).toEqual([4,15.1,15.1])
    const saved=model.toJSON();model.removeFitting(copied.id);expect(model.fittings.has(copied.id)).toBe(false)
    expect(model.loadJSON(saved).ok).toBe(true);expect(model.toJSON()).toEqual(saved)
  })
  it('原生与旧v2轮使用同一原版fallback几何、保留自由色',()=>{
    // 仅隔离fallback网格缓存，不代表WebGL/抓取原网格的视觉验收。
    const scene=Object.create(SceneManager.prototype);Object.assign(scene,{_materials:{},_keepGeos:new Set(),_q:()=>({tube:20,meshes:false})})
    const model=legacy(),part=[...model.fittings.values()][0] as any
    const old=scene._fittingMeshes(part),native=scene._fittingMeshes({...part,appearanceVersion:undefined,partId:undefined})
    expect(old).toHaveLength(1);expect(old[0].geometry).toBe(native[0].geometry)
    expect(old[0].material.color.getHexString()).toBe(native[0].material.color.getHexString())
    expect(model.setColorOf('fitting',part.id,'red')).toBe(true)
    const material=scene._fittingMeshes(part)[0].material
    expect(material.userData.tuneHex).toBe(colorHex('red'))
    expect(material.color.getHexString()).toBe(new Color(scene._lookHex(colorHex('red'))).getHexString())
  })
  it('旧v2原生重开不丢字段，移动/镜像/旋转及复制重映射真实单管',()=>{
    const model=legacy(),part=[...model.fittings.values()][0] as any,before=model.toJSON(),loaded=new BuildModel();loaded.loadJSON(before)
    expect(loaded.toJSON()).toEqual(before);expect(componentMountsValid(model,part)).toBe(true)
    expect(model.moveSelection(select(model),160,0,0).ok).toBe(true);expect(model.rotateSelection(select(model)).ok).toBe(true);expect(model.mirrorSelection(select(model),'z').ok).toBe(true)
    expect(componentMountsValid(model,part)).toBe(true)
    const copy=model.insertFragment(model.extractSelection(select(model))!,[480,2.5,0]) as any,duplicate=[...model.fittings.values()].find(f=>copy.fittings.includes(f.id)) as any
    expect(duplicate.tube).not.toBe(part.tube);expect(copy.tubes).toContain(duplicate.tube)
    expect(duplicate.supportTubes).toEqual([duplicate.tube]);expect(duplicate.mounts[0].tube).toBe(duplicate.tube);expect(componentMountsValid(model,duplicate)).toBe(true)
    const snapshot=model.toJSON();model.removeTube(duplicate.tube);expect(model.fittings.has(duplicate.id)).toBe(false);expect(model.fittings.has(part.id)).toBe(true)
    model.loadJSON(snapshot);expect(componentMountsValid(model,model.fittings.get(duplicate.id)!)).toBe(true)
    expect(computeSafety(model).findings.some(f=>f.rule==='accessory_load' && f.ids?.fittings?.includes(part.id))).toBe(false)
  })
  it.each([false,true])('原生/旧v2轮QDF完整导出回读，无新套装或遗漏警告 legacy=%s',old=>{
    const model=old?legacy():createRetainedComponentFixture('wheel'),out=buildQDF(model),wheel=[...model.fittings.values()][0] as any
    expect(out.warnings).toEqual([]);expect(out.text).toContain('multi-wheel2{')
    const parsed=parseQDF(out.text,{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})
    expect(parsed.fittings.filter((f:any)=>f.kind==='multi-wheel2')).toHaveLength(1)
    const restored=new BuildModel();restored.loadJSON(parsed);const copy=[...restored.fittings.values()].find(f=>f.kind==='multi-wheel2')!
    expect(Math.hypot(copy.x-wheel.x,copy.y-wheel.y,copy.z-wheel.z)).toBeLessThan(.1)
    const row=computeBOM(model).fittings.find((row:any)=>row.kind==='multi-wheel2')!
    expect(row).toBeTruthy();expect(row.count).toBe(1);expect(row.kitContents).toBeFalsy()
  })
})
