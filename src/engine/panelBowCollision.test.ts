import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js'
import { Builder } from './builder.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON, type ModelJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog(); await ensureAssemblyMeshes() })

// 隔离的标准板框与弯管，检查实际几何，不读取或修改用户存档。
function frame(panelId = 'panel_40x40') {
  const model = new BuildModel()
  const width = panelId === 'panel_40x20' ? 20 : 40
  const nodes = [[0,60,0],[0,100,0],[0,100,width],[0,60,width]].map(p => model.addNode(...p as [number,number,number]))
  const rails = nodes.map((node, i) => {
    const length = i % 2 ? width : 40
    return model.addTube(node.id, nodes[(i+1)%4].id, `T${length-5}`, 'green', length-5)!
  })
  const probe = { a: rails[0].id, b: rails[2].id, t0: 0, len: 40, panelId, side: 1 }
  const end = model.addNode(40,60,0)
  const bow = Object.assign(model.addTube(nodes[1].id,end.id,'TC1','yellow',null)!,{bow:true,bowCenter:[0,60,0]})
  return { model, probe, bow }
}

describe('普通板与弯管实际空间', () => {
  it.each(['panel_40x40','panel_40x20'])('%s的转角复核不能放过弯管边缘', panelId => {
    const { model, probe, bow } = frame(panelId), before = model.toJSON()
    for (const side of [1,-1]) {
      const candidate = { ...probe, side }
      expect(model.panelPlacementDiagnostics(candidate)).toMatchObject({ valid:false,reason:'component_space',obstacle:{id:bow.id} })
      expect(model.nativePanelDiagnostics(candidate)).toMatchObject({ valid:false,reason:'component_space',obstacle:{id:bow.id} })
      expect(model.addNativePanel(candidate,'yellow',{nativeGeometry:true})).toBeNull()
      expect(model.addPanelAccessory({...candidate,nativeGeometry:true},'yellow')).toBeNull()
      expect(model.addConfirmedComponent({...candidate,nativeGeometry:true},'yellow')).toBeNull()
    }
    expect(model.toJSON()).toEqual(before)
    for (const candidate of model.panelAccessoryMounts(panelId)) {
      expect(model.panelAccessoryDiagnostics(candidate).valid).toBe(true)
      expect(candidate.nativeGeometry).not.toBe(true)
    }
  })

  it('先命中的直管冲突不能遮住弯管冲突', () => {
    const { model, probe, bow } = frame()
    // 外部原生存档可能同时有多根管件冲突，复核必须单独检查弯管。
    const other = model.addNode(-20,80,20), end = model.addNode(20,80,20)
    const straight = model.addTube(other.id,end.id,'T35','red',35)!
    model.tubes = new Map([[straight.id,straight],...model.tubes])
    expect(model.panelAccessoryDiagnostics(probe).obstacle?.id).toBe(straight.id)
    expect(model.nativePanelDiagnostics(probe)).toMatchObject({ valid:false,obstacle:{id:bow.id} })
  })

  it('移走弯管后安装候选恢复，正常放置与撤销重做有效', () => {
    const { model, probe, bow } = frame()
    expect(model.nativePanelDiagnostics(probe).valid).toBe(false)
    model.removeTube(bow.id)
    expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
    expect(model.panelAccessoryMounts(probe.panelId).length).toBeGreaterThan(0)
    const before = model.toJSON(), history = new ModelHistory(docFromJSON(before as ModelJSON))
    const builder = Object.assign(Object.create(Builder.prototype), {
      model, history, selection:new Map(), onNotice:()=>{}, refresh:()=>{},
      scene:{cameraPosition:()=>[100,100,100],clearInstallationPreview:()=>{}},
    }) as Builder
    const added = model.nativePanelDiagnostics(probe)
    expect(builder._previewInstallation({...added,nativeGeometry:true},probe.panelId)).toBe(true)
    expect(model.panels.size).toBe(1)
    const after = model.toJSON()
    history.undo(); expect(history.toJSON()).toEqual(before)
    history.redo(); expect(history.toJSON()).toEqual(after)
    history.destroy()
  })

  it('远处弯管不影响空框的正常安装', () => {
    const { model, probe, bow } = frame()
    for (const id of [bow.a,bow.b]) model.nodes.get(id)!.x += 100
    bow.bowCenter[0] += 100
    // 独立弯管移动，不带动框架接头。
    const original = model.addNode(0,100,0)
    const rail = model.tubes.get(probe.a)!
    rail.b = original.id
    const top = [...model.tubes.values()].find(t => t.id !== bow.id && t.a === bow.a)!
    top.a = original.id
    expect(model.nativePanelDiagnostics(probe).valid).toBe(true)
  })
})
