import {beforeAll,describe,expect,it} from 'vitest'
import {BuildModel} from './model.js'
import {loadCatalog} from './catalog.js'
import {componentMountsValid,mountPoint} from './accessoryPack.js'
import {accessoryMeshes} from './accessoryMeshes.js'
import {gymRingSupport} from './gymRingSupport.js'

beforeAll(async()=>{await loadCatalog()})
type Mount={tube:string;t:number;width:number;role:string}
type Ring=NonNullable<ReturnType<BuildModel['addAccessory']>> & {tube:string;mounts:Mount[];supportTubes:string[]}

// 隔离的真实管件组合，用于安装、保存及组件引用检查。
function chain(lengths:number[], reverse=false) {
  const model=new BuildModel(),tubes=[]
  let a=model.addNode(0,100,0),x=0
  for(const length of lengths){
    x+=length+5
    const b=model.addNode(x,100,0)
    tubes.push(model.addTube(reverse?b.id:a.id,reverse?a.id:b.id,`T${length}`,'blue',length)!)
    a=b
  }
  return {model,tubes}
}

describe('吊环单管及多管连续定位',()=>{
  it('75厘米管可在小数位置安装，模型、实际网格和重开位置一致',()=>{
    const {model,tubes}=chain([75])
    const candidate=model.accessoryDiagnostics('gym_rings',tubes[0].id,{position:[18.37,102,0]})
    expect(candidate.valid).toBe(true);expect(candidate.x).toBeCloseTo(18.37,8)
    const part=model.addAccessory('gym_rings',tubes[0].id,'green',{position:[18.37,100,0]})! as Ring
    expect(componentMountsValid(model,part)).toBe(true)
    const meshes=accessoryMeshes({_materials:{}},model,part,'green')
    expect(meshes[0].position.x).toBeCloseTo(18.37-9,8)
    for(const mesh of meshes)mesh.geometry.dispose()
    const data=JSON.parse(JSON.stringify(model.toJSON())),restored=new BuildModel()
    expect(restored.loadJSON(data).ok).toBe(true)
    expect(componentMountsValid(restored,restored.fittings.get(part.id)!)).toBe(true)
    expect(restored.toJSON()).toEqual(data)
  })

  it.each([false,true])('两根15厘米短管可跨接头安装，保留两个真实承载引用：反向=%s',reverse=>{
    const {model,tubes}=chain([15,15],reverse)
    const candidate=model.accessoryDiagnostics('gym_rings',tubes[0].id,{position:[20,100,0]})
    expect(candidate.valid).toBe(true)
    expect(new Set(candidate.mounts.map((m:Mount)=>m.tube))).toEqual(new Set(tubes.map(t=>t.id)))
    const points=candidate.mounts.map((m:Mount)=>mountPoint(model,m)!)
    expect(Math.abs(points[0][0]-points[1][0])).toBe(18)
    const part=model.addAccessory('gym_rings',tubes[0].id,'green',{position:[20,100,0]})! as Ring
    expect(componentMountsValid(model,part)).toBe(true)
    expect(model._invalidComponents().size).toBe(0)
    expect(part.supportTubes).toContain(part.tube)
  })

  it('滑过35厘米管接头时吊点分属两根管，单管位置不依赖无关延长管',()=>{
    const {model,tubes}=chain([35,35])
    const crossing=model.accessoryDiagnostics('gym_rings',tubes[0].id,{position:[40.73,100,0]})
    expect(crossing.valid).toBe(true);expect(crossing.x).toBeCloseTo(40.73,8)
    expect(crossing.supportTubes).toHaveLength(2)
    const part=model.addAccessory('gym_rings',tubes[0].id,'green',{position:[20,100,0]})! as Ring
    expect(part.supportTubes).toEqual([tubes[0].id])
    model.removeTube(tubes[1].id)
    expect(model.fittings.has(part.id)).toBe(true)
    expect(componentMountsValid(model,part)).toBe(true)
  })

  it('远端短管可以通过整段长度安装，保存的主承载管属于实际支撑集合',()=>{
    const {model,tubes}=chain([15,15,15])
    const part=model.addAccessory('gym_rings',tubes[0].id,'green',{position:[40,100,0]})! as Ring
    expect(part.x).toBe(40)
    expect(part.tube).toBe(tubes[1].id)
    expect(part.supportTubes).toEqual([tubes[1].id,tubes[2].id])
    expect(componentMountsValid(model,part)).toBe(true)
    const fragment=model.extractSelection(new Map([...model.nodes.keys()].map(id=>[id,'node'])))!
    const copy=model.insertFragment(fragment,[200,100,0])!
    const copied=model.fittings.get(copy.fittings[0])!
    expect(componentMountsValid(model,copied)).toBe(true)
    expect(copied.supportTubes).toContain(copied.tube)
    model.removeTube(copied.supportTubes[0])
    expect(model.fittings.has(copied.id)).toBe(false)
    expect(model.fittings.has(part.id)).toBe(true)
  })

  it('几何上接近但不相连、拐弯、过短和竖管不构成承载段',()=>{
    const {model,tubes}=chain([15])
    const a=model.addNode(21,100,0),b=model.addNode(41,100,0)
    model.addTube(a.id,b.id,'T15','blue',15)
    expect(gymRingSupport(model,tubes[0].id)!.segments).toHaveLength(1)
    expect(model.accessoryDiagnostics('gym_rings',tubes[0].id).reason).toBe('tube_short')
    const turn=model.addNode(20,100,40)
    model.addTube(tubes[0].b,turn.id,'T35','blue',35)
    expect(model.accessoryDiagnostics('gym_rings',tubes[0].id).reason).toBe('tube_short')
    const end=model.addNode(20,140,0),vertical=model.addTube(tubes[0].b,end.id,'T35','blue',35)!
    expect(model.accessoryDiagnostics('gym_rings',vertical.id).reason).toBe('horizontal_tube')
  })

  it('吊点避开接头，低高度和已有吊环的占用仍受检查',()=>{
    const {model,tubes}=chain([35,35])
    const nearJoint=model.accessoryDiagnostics('gym_rings',tubes[0].id,{position:[30,100,0]})
    for(const mount of nearJoint.mounts){const rail=model._rail(mount.tube)!;expect(Math.min(mount.t,1-mount.t)*rail.len).toBeGreaterThanOrEqual(6-0.001)}
    const part=model.addAccessory('gym_rings',tubes[0].id,'green',{position:[40,100,0]})! as Ring
    expect(model.accessoryDiagnostics('gym_rings',tubes[0].id,{position:[40,100,0]}).valid).toBe(false)
    expect(model.accessoryDiagnostics('gym_rings',part.tube,{ignoreId:part.id}).valid).toBe(true)
    for(const node of model.nodes.values())node.y=40
    expect(model.accessoryDiagnostics('gym_rings',tubes[0].id).reason).toBe('ground_clearance')
  })

  it('既有单根35厘米管中点吊环保持兼容',()=>{
    const {model,tubes}=chain([35]),part=model.addAccessory('gym_rings',tubes[0].id,'green')! as Ring
    expect(part.x).toBe(20)
    expect(part.mounts.map(m=>m.t)).toEqual([0.275,0.725])
    expect(componentMountsValid(model,part)).toBe(true)
  })
})
