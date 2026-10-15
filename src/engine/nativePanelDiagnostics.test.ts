import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js'
import { computeSafety } from './safety.js'

beforeAll(async () => { await loadCatalog(); await ensureAssemblyMeshes() })

// 带侧向T管的独立板框，复现包围盒误判，不依赖用户模型。
function frame(fragmented=false) {
  const model = new BuildModel(), nodes = new Map<string, ReturnType<BuildModel['addNode']>>()
  const at = (x:number,y:number,z:number) => {
    const key = [x,y,z].join(',')
    if (!nodes.has(key)) nodes.set(key,model.addNode(x+2.5,y+2.5,z+2.5))
    return nodes.get(key)!
  }
  const pipe = (a:number[],b:number[]) => {
    const A=at(...a as [number,number,number]),B=at(...b as [number,number,number]),length=Math.hypot(...a.map((n,i)=>n-b[i]))
    return model.addTube(A.id,B.id,length===20?'T15':'T35','blue',length-5)!
  }
  for (const x of [0,40]) for (const y of [40,60]) pipe([x,y,0],[x,y+20,0])
  for (const y of [40,80]) {
    if(fragmented){pipe([0,y,0],[20,y,0]);pipe([20,y,0],[40,y,0])}
    else pipe([0,y,0],[40,y,0])
  }
  pipe([40,60,0],[40,60,40])
  const probe=(fragmented?model.nativePanelMounts('panel_40x40'):model.confirmedMounts('panel_40x40',{deduplicate:false})).find((p:{a:string})=>model.panelCorners(p)?.every((c:number[])=>Math.abs(c[2]-2.5)<.01))!
  expect(probe).toBeTruthy()
  return {model,probe,pipe}
}

describe('普通板真实网格安装复核',()=>{
  it('坡面板引用实际坡架，拒绝平台边管延长线并随铰链整体转动',()=>{
    const model=new BuildModel(),nodes=new Map<string,ReturnType<BuildModel['addNode']>>()
    const at=(x:number,z:number)=>{
      const key=[x,z].join(',')
      if(!nodes.has(key))nodes.set(key,model.addNode(x+2.5,22.5,z+2.5))
      return nodes.get(key)!
    }
    const pipe=(x:number,z:number,X:number,Z:number)=>model.addTube(at(x,z).id,at(X,Z).id,'T35','blue',35)!
    const base=[pipe(0,0,40,0),pipe(0,40,40,40),pipe(0,0,0,40),pipe(40,0,40,40)]
    pipe(45,0,85,0);pipe(45,40,85,40);pipe(45,0,45,40);pipe(85,0,85,40)
    const clamp=Object.assign(model.addClamp(42.5,22.5,22.5,'double_tube'),{dir:[0,0,1],off:[5,0,0]})
    model.addLink(at(40,0).id,at(45,0).id);model.addLink(at(40,40).id,at(45,40).id)
    const virtual={a:base[0].id,b:base[1].id,t0:45,len:40,panelId:'panel_40x40',side:1}
    expect(model.nativePanelDiagnostics(virtual)).toMatchObject({valid:false,reason:'missing_support'})
    const candidates=model.nativePanelMounts('panel_40x40').filter((p:{a:string})=>model.panelCorners(p)!.every((c:number[])=>c[0]>=47.49&&c[0]<=87.51&&Math.abs(c[1]-22.5)<.01))
    expect(candidates.length).toBeGreaterThan(0)
    const panel=model.addNativePanel(candidates.find((p:object)=>model.nativePanelDiagnostics(p).valid)!,'yellow',{nativeGeometry:true})!
    expect(panel).toBeTruthy()
    const before=model.panelCorners(panel)!,baseBefore=base.map(t=>structuredClone(model.nodes.get(t.a)))
    const angle=-Math.PI/8
    expect(model.rotateClamp(clamp.id,angle)).toBe(true)
    const actual=model.panelCorners(panel)!
    for(const point of before){
      const x=point[0]-42.5,y=point[1]-22.5
      const expected=[42.5+x*Math.cos(angle)-y*Math.sin(angle),22.5+x*Math.sin(angle)+y*Math.cos(angle),point[2]]
      expect(actual.some((p:number[])=>Math.hypot(...p.map((n,i)=>n-expected[i]))<.02)).toBe(true)
    }
    expect(base.map(t=>model.nodes.get(t.a))).toEqual(baseBefore)
    const loaded=new BuildModel();expect(loaded.loadJSON(model.toJSON()).ok).toBe(true)
    expect(loaded.panelCorners(loaded.panels.get(panel.id))).toEqual(actual)
  })
  it('允许覆盖承载边管上的双管连接件与管夹，板内无承载关系的连接件仍拒绝',()=>{
    for(const connectorId of ['double_tube','tube_clamp']){
      const {model,probe}=frame()
      Object.assign(model.addClamp(22.5,42.5,2.5,connectorId),{dir:[1,0,0],off:[0,0,5]})
      expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
    }
    const {model,probe}=frame()
    const obstacle=Object.assign(model.addClamp(22.5,62.5,2.5,'double_tube'),{dir:[1,0,0],off:[0,0,5]})
    expect(model.nativePanelDiagnostics(probe)).toMatchObject({valid:false,reason:'component_space',obstacle:{id:obstacle.id}})
  })
  it('四边都由短管连接时仍能寻找整板，缺边后不能套用透明板对边规则',()=>{
    const {model,probe}=frame(true)
    const corners=model.panelCorners(probe)!.map((p:number[])=>p.join(',')).sort().join('|')
    const mounts=model.nativePanelMounts('panel_40x40').filter((p:{a:string})=>model.panelCorners(p)!.map((c:number[])=>c.join(',')).sort().join('|')===corners)
    expect(mounts.length).toBeGreaterThanOrEqual(4)
    expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
    const panel=model.addNativePanel(probe,'yellow',{nativeGeometry:true})!
    expect(panel).toBeTruthy()
    const loaded=new BuildModel();expect(loaded.loadJSON(model.toJSON()).ok).toBe(true)
    expect(loaded.toJSON()).toEqual(model.toJSON())
    const supports=model.nativePanelDiagnostics({...panel,id:panel.id}).supportTubes
    for(const node of model.nodes.values()){const y=node.y;node.y=node.z+40;node.z=y-40}
    expect(computeSafety(model).findings.some(f=>f.rule==='deck_edges')).toBe(false)
    model.tubes.delete(supports.find((id:string)=>id!==probe.a&&id!==probe.b)!)
    expect(model.nativePanelDiagnostics({...panel,id:panel.id}).valid).toBe(false)
    expect(computeSafety(model).findings.some(f=>f.rule==='deck_edges'&&f.ids.panels.includes(panel.id))).toBe(true)
  })
  it('侧管位于整板边缘时保留整板，原生文件完整往返',()=>{
    const {model,probe}=frame()
    expect(model.confirmedDiagnostics(probe)).toMatchObject({valid:false,reason:'component_space'})
    expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
    const panel=model.addNativePanel(probe,'yellow',{nativeGeometry:true})!
    expect(panel).toBeTruthy()
    const saved=model.toJSON(),loaded=new BuildModel()
    expect(loaded.loadJSON(saved).ok).toBe(true)
    expect(loaded.toJSON()).toEqual(saved)
    expect(loaded.nativePanelDiagnostics({...panel,id:panel.id}).valid).toBe(true)
    expect(model.nativePanelDiagnostics(probe).valid).toBe(false)
  })
  it('新增穿板管后刷新几何，实际碰撞继续拒绝',()=>{
    const {model,probe,pipe}=frame()
    expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
    const obstacle=pipe([20,60,-20],[20,60,20])
    expect(model.nativePanelDiagnostics(probe)).toMatchObject({valid:false,reason:'component_space',obstacle:{id:obstacle.id}})
  })
  it('不能绕过缺边和固定点占用',()=>{
    const {model,probe}=frame(),mount=probe.mounts[0],rail=model._rail(mount.tube)!
    const p=rail.p0.map((v:number,i:number)=>v+rail.dir[i]*rail.len*mount.t)
    const sleeve=Object.assign(model.addFitting('sleeve',...p as [number,number,number]),{tube:mount.tube})
    expect(model.nativePanelDiagnostics(probe)).toMatchObject({valid:false,reason:'mount_occupied'})
    model.fittings.delete(sleeve.id)
    model.tubes.delete(probe.supportTubes[0])
    expect(model.nativePanelDiagnostics(probe).valid).toBe(false)
  })
})
