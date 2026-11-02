import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { withPlacementPass, withPlacementSnapshot, placementCacheStats } from './incrementalPlacement.js'
import { DIRECTIONS } from './config.js'
import { Builder } from './builder.js'

beforeAll(loadCatalog)
const fresh = (model: BuildModel) => { const copy=new BuildModel(); expect(copy.loadJSON(model.toJSON()).ok).toBe(true); return copy }
const mounts = (model: BuildModel,id:string) => model.confirmedMounts(id)

describe('增量安装位置与完整重算一致',()=>{
  it('同步统计共享真实安装查询，结束后释放缓存并响应后续编辑',()=>{
    const {model}=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false})
    const initialCache=placementCacheStats(model)
    const query=()=>model.panelAccessoryMounts('panel_40x40_honeycomb')
    const expected=fresh(model).panelAccessoryMounts('panel_40x40_honeycomb')
    withPlacementSnapshot(model,()=>{
      expect(query()).toEqual(expected)
      expect(withPlacementSnapshot(model,query)).toEqual(expected)
      expect(placementCacheStats(model)!.hits).toBeGreaterThan(0)
    })
    expect(placementCacheStats(model)).toEqual(initialCache)
    query()
    const previous=placementCacheStats(model)
    withPlacementSnapshot(model,()=>expect(query()).toEqual(expected))
    expect(placementCacheStats(model)).toEqual(previous)
    const node=model.nodes.values().next().value!
    node.x+=20
    expect(withPlacementSnapshot(model,query)).toEqual(fresh(model).panelAccessoryMounts('panel_40x40_honeycomb'))
    expect(query()).toEqual(fresh(model).panelAccessoryMounts('panel_40x40_honeycomb'))
  })

  it.each(CONFIRMED_COMPONENTS.filter(s=>s.id!=='rope'))('$id 安装、删除、恢复、移动及支撑变化',spec=>{
    const {model,candidate}=createConfirmedComponentFixture(spec.id,{install:false})
    const check=()=>expect(mounts(model,spec.id)).toEqual(mounts(fresh(model),spec.id))
    check()
    const original=model.toJSON(),part=model.addConfirmedComponent(candidate,'blue')!
    expect(part).toBeTruthy();check()
    const installed=model.toJSON()
    if(spec.placement==='panel')model.removePanel(part.id);else model.removeFitting(part.id)
    check()
    model.loadJSON(installed);check()
    model.loadJSON(original);check()
    const node=model.nodes.values().next().value!
    node.x+=2;check()
    model.loadJSON(original)
    model.removeTube(candidate.supportTubes[0]);check()
    model.loadJSON(installed);check()
  })

  it('缓存结果不能被调用方的嵌套修改污染',()=>{
    const {model}=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false})
    const first=model.panelAccessoryMounts('panel_40x40_honeycomb')
    expect(first.length).toBeGreaterThan(0)
    first[0].mounts[0].t=100
    first[0].params.screwAxis='wrong'
    expect(model.panelAccessoryMounts('panel_40x40_honeycomb')).toEqual(fresh(model).panelAccessoryMounts('panel_40x40_honeycomb'))
  })

  it('宽网片及可变尺寸彩虹带按真实跨度失效，切换配件型号不串用结果',()=>{
    const model=new BuildModel(),a=model.addNode(0,40,0),b=model.addNode(0,80,0),c=model.addNode(160,40,0),d=model.addNode(160,80,0)
    const first=model.addTube(a.id,b.id,'T35','blue',35)!,second=model.addTube(c.id,d.id,'T35','blue',35)!
    const builder=Object.assign(Object.create(Builder.prototype),{model,mode:'fitting',fittingKind:'lattice2',fittingPart:null,panelId:'panel_40x40'})
    const partners=()=>withPlacementPass(model,()=>builder._freePartners(first.id,null,true))
    expect(partners().map((p:{id:string})=>p.id)).toContain(second.id)
    c.x=260;d.x=260;expect(partners()).toEqual([])
    builder.fittingKind='textil2';builder.fittingPart='textile_rainbow'
    expect(partners().map((p:{id:string})=>p.id)).toContain(second.id)
    builder.fittingPart=null;expect(partners()).toEqual([])
    builder.fittingPart='textile_rainbow';model.removeTube(second.id);expect(partners()).toEqual([])
  })

  it('远处添管复用原有接管计划，拆桥后重新核对闭环吸附关系',()=>{
    const model=new BuildModel()
    const a=model.addNode(0,40,0),b=model.addNode(0,40,40),c=model.addNode(44,40,0),d=model.addNode(44,40,40)
    model.addTube(a.id,b.id,'T35','blue',35);model.addTube(c.id,d.id,'T35','blue',35)
    const query=(m:BuildModel)=>withPlacementPass(m,()=>{
      const context=m.tubeExtensionContext()
      return [...m.nodes.keys()].flatMap(id=>DIRECTIONS.map(dir=>{
        const p=m.planTubeExtension(id,dir.vec,40,{context})
        return [id,dir.name,p&&{target:p.target,existing:p.existing?.id,node:p.node?.id,collision:p.collision,ground:p.ground,duplicate:p.duplicate}]
      }))
    })
    expect(query(model)).toEqual(query(fresh(model)))
    const stats=placementCacheStats(model)!
    const distant=model.addNode(1000,40,0),other=model.addNode(1000,40,40)
    model.addTube(distant.id,other.id,'T35','blue',35)
    expect(query(model)).toEqual(query(fresh(model)))
    expect(placementCacheStats(model)!.hits-stats.hits).toBeGreaterThanOrEqual(24)
    const bridge=model.addTube(b.id,d.id,'T35','blue',35)!
    expect(query(model)).toEqual(query(fresh(model)))
    model.removeTube(bridge.id)
    expect(query(model)).toEqual(query(fresh(model)))
  })

  it('新增挡管使板位失效，删除后恢复；原地移动与同数量替换均被检测',()=>{
    const {model}=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false})
    const check=()=>expect(model.panelAccessoryMounts('panel_40x40_honeycomb')).toEqual(fresh(model).panelAccessoryMounts('panel_40x40_honeycomb'))
    check();const before=model.toJSON(),mount=model.panelAccessoryMounts('panel_40x40_honeycomb')[0]
    const center=mount.pos
    const a=model.addNode(center[0],center[1],center[2]-20),b=model.addNode(center[0],center[1],center[2]+20)
    const obstacle=model.addTube(a.id,b.id,'T35','blue',35)!
    check();expect(model.panelAccessoryMounts('panel_40x40_honeycomb').length).toBeLessThan(fresh(newModel(before)).panelAccessoryMounts('panel_40x40_honeycomb').length)
    a.x+=200;b.x+=200;check()
    model.removeTube(obstacle.id);check()
    model.loadJSON(before);check()
  })
})
function newModel(data:ReturnType<BuildModel['toJSON']>){const m=new BuildModel();m.loadJSON(data);return m}
