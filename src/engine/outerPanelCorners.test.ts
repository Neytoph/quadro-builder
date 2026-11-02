import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { confirmedCandidates, isOuterScrewPanel } from './confirmedComponentModel.js'
import { outerPanelCornerFrame } from '../../scripts/outer-panel-corner-frame.js'
import { BuildModel } from './model.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { Builder } from './builder.js'
import { componentVolumes, panelMountsMate } from './accessoryPack.js'
import { checkAssemblyPath } from './assemblyCollision.js'

beforeAll(loadCatalog)
const outer=CONFIRMED_COMPONENTS.filter(p=>isOuterScrewPanel(p.id))
const square=outer.filter(p=>p.width===40 && p.height===40 && p.mountType!=='horizontal-frame')

describe('全部外扣板的转角安装',()=>{
  it('连接面豁免不覆盖板身、螺丝相交、偏移或同向重复卡边',()=>{
    const {model,isTarget}=outerPanelCornerFrame('panel_40x40_honeycomb')
    const candidate=model.panelAccessoryMounts('panel_40x40_honeycomb',{screwAxis:'vertical'}).find(isTarget)!
    const volumes=componentVolumes(model,candidate),lip=volumes.find(v=>v.panelLip)!,skin=volumes.find(v=>v.panelSkin)!,screw=volumes.find(v=>v.panelScrew)!
    expect(panelMountsMate(lip,lip)).toBe(false)
    expect(panelMountsMate(skin,skin)).toBe(false)
    expect(panelMountsMate(screw,screw)).toBe(false)
    const other={...lip,panelLip:{...lip.panelLip,inward:lip.panelLip.inward.map((v:number)=>-v)}}
    expect(panelMountsMate(lip,other)).toBe(true)
    other.panelLip.origin=other.panelLip.origin.map((v:number,i:number)=>v+(i===0?.1:0))
    expect(panelMountsMate(lip,other)).toBe(false)
    const inward={...candidate,side:-(candidate.side||1)}
    expect(model.panelPlacementDiagnostics(inward).valid).toBe(false)
  })

  it.each(square.flatMap(spec=>square.flatMap(front=>['vertical','horizontal'].map(screwAxis=>({spec,front,screwAxis})))))('$spec.id 与 $front.id 共边 / $screwAxis',({spec,front,screwAxis})=>{
    const {model,isTarget}=outerPanelCornerFrame(spec.id,{frontId:front.id})
    const candidate=model.panelAccessoryMounts(spec.id,{screwAxis}).find(isTarget)
    expect(candidate).toBeTruthy()
    expect(model.addPanelAccessory(candidate,'red')).toBeTruthy()
  })

  it.each(outer.flatMap(spec=>['vertical','horizontal'].flatMap(screwAxis=>[40,20].map(split=>({spec,screwAxis,split})))))('$spec.id / $screwAxis / 分段$split',({spec,screwAxis,split})=>{
    const {model,isTarget}=outerPanelCornerFrame(spec.id,{split,horizontal:spec.mountType==='horizontal-frame'})
    const candidates=confirmedCandidates(model,spec.id,{screwAxis,deduplicate:false}).flatMap(p=>[p,{...p,side:-(p.side||1)}]).filter(isTarget)
    expect(candidates.length).toBeGreaterThan(0)
    const candidate=candidates.find(p=>model.panelPlacementDiagnostics(p).valid)
    expect(candidate,JSON.stringify(candidates.map(p=>model.panelPlacementDiagnostics(p)))).toBeTruthy()
    const before=model.toJSON(),part=model.addPanelAccessory(candidate,'red')!
    expect(part).toBeTruthy()
    expect(model.panels.size).toBe(before.panels.length+1)
    expect(model.panelAccessoryDiagnostics(part).valid).toBe(true)
    const saved=model.toJSON(),reopened=new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
    expect(reopened.panelAccessoryDiagnostics(reopened.panels.get(part.id)).valid).toBe(true)
    expect(model.addPanelAccessory(candidate,'green')).toBeNull()
  })

  it.each(outer.filter(p=>p.mountType!=='horizontal-frame'))('$id 的实际穿管继续受阻',spec=>{
    const {model,isTarget}=outerPanelCornerFrame(spec.id)
    const candidate=model.panelAccessoryMounts(spec.id).find(isTarget)!
    expect(candidate).toBeTruthy()
    const center=model.panelCorners(candidate)!.reduce((s,p)=>s.map((v,i)=>v+p[i]/4),[0,0,0])
    const a=model.addNode(center[0]-20,center[1],center[2]),b=model.addNode(center[0]+20,center[1],center[2])
    const obstacle=model.addTube(a.id,b.id,'T35','yellow',35)!
    expect(model.panelPlacementDiagnostics(candidate)).toMatchObject({valid:false,reason:'component_space',obstacle:{id:obstacle.id}})
    expect(model.addPanelAccessory(candidate,'red')).toBeNull()
  })

  it('蜂窝板正常安装、固定边切换、撤销与重做',()=>{
    const {model,isTarget}=outerPanelCornerFrame('panel_40x40_honeycomb'),before=model.toJSON()
    const history=new ModelHistory(docFromJSON(before)),builder=Object.assign(Object.create(Builder.prototype),{
      model,history,selection:new Map(),onNotice:()=>{},refresh:()=>{},scene:{cameraPosition:()=>[-100,100,-100],clearInstallationPreview:()=>{}},
    }) as Builder
    const candidate=model.panelAccessoryMounts('panel_40x40_honeycomb').find(isTarget)!
    expect(builder._previewInstallation(candidate,candidate.panelId)).toBe(true)
    const installed=model.toJSON()
    const part=[...model.panels.values()].find(p=>!before.panels.some(original=>original.id===p.id))!
    expect(model.setPanelFixing(part.id,'horizontal')).toBe(true)
    const after=model.toJSON();history.commit(JSON.stringify(installed),JSON.stringify(after))
    history.undo();expect(history.toJSON()).not.toEqual(after)
    history.undo();expect(history.toJSON()).toEqual(before)
    history.redo();history.redo();expect(history.toJSON()).toEqual(after)
    history.destroy()
  })

  it('装配检查沿用共管连接规则，板身从内侧穿越仍拒绝',()=>{
    const {model,isTarget}=outerPanelCornerFrame('panel_40x40_honeycomb')
    const installed=[...model.panels.keys()],candidate=model.panelAccessoryMounts('panel_40x40_honeycomb').find(isTarget)!
    const part=model.addPanelAccessory(candidate,'red')!
    expect(checkAssemblyPath(model,[part.id],installed,[0,0,0])).toBeNull()
    expect(checkAssemblyPath(model,[part.id],installed,[-8,0,0])).toBeNull()
    expect(checkAssemblyPath(model,[part.id],installed,[8,0,0])).not.toBeNull()
    expect(checkAssemblyPath(model,[part.id],installed,[0,0,0],[0,0,0],{allowMating:false})).not.toBeNull()
  })
})
