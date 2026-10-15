import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js'

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
    model.panels.delete(panel.id)
    const supports=model.nativePanelDiagnostics(probe).supportTubes
    model.tubes.delete(supports.find((id:string)=>id!==probe.a&&id!==probe.b)!)
    expect(model.nativePanelDiagnostics(probe).valid).toBe(false)
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
