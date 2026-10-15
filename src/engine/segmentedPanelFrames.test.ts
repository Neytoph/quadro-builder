import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { componentMountsValid } from './accessoryPack.js'
import { segmentedPanelFrame } from '../../scripts/segmented-panel-frame.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async()=>{await loadCatalog()})

describe('短管围成的连续板件框格',()=>{
  for(const orientation of ['horizontal','vertical','tilted']){
    it.each(['panel_40x40','hole_panel_40x40','panel_40x40_lego','panel_40x40_climbing','acrylic_panel_40x40'])('%s 可安装于'+orientation+'短管40×40框并保存重开',panelId=>{
      const {model}=segmentedPanelFrame({orientation})
      expect([...model.tubes.values()].every(t=>model._rail(t.id)!.len<40)).toBe(true)
      const mounts=model.panelAccessoryMounts(panelId)
      expect(mounts).toHaveLength(1)
      expect(mounts[0].valid).toBe(true)
      const part=model.addConfirmedComponent(mounts[0],'yellow')!
      expect(part).toBeTruthy()
      expect(componentMountsValid(model,part)).toBe(true)
      expect(model.addConfirmedComponent(mounts[0],'yellow')).toBeNull()
      const saved=model.toJSON(),reopened=new BuildModel()
      expect(reopened.loadJSON(saved).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(saved)
      expect(reopened.confirmedDiagnostics(reopened.panels.get(part.id)!).valid).toBe(true)
      model.removeTube(part.supportTubes![0])
      expect(model.panels.has(part.id)).toBe(false)
    })
  }

  it.each([[40,20],[20,40],[30,30]])('%i×%i短管框按实际尺寸识别', (width,height)=>{
    const {model}=segmentedPanelFrame({width,height,split:10})
    expect(model.panelAccessoryMounts(width===30?'panel_30x30':'panel_40x20')).toHaveLength(1)
    expect(model.panelAccessoryMounts('panel_40x40')).toHaveLength(0)
  })

  it('缺少任一框边短管时不生成普通板安装点',()=>{
    for(let edge=0;edge<4;edge++){
      const {model,edges}=segmentedPanelFrame()
      model.removeTube(edges[edge][0])
      expect(model.panelAccessoryMounts('panel_40x40')).toHaveLength(0)
    }
  })

  it('穿过板中央的实际管件仍阻止安装',()=>{
    const {model}=segmentedPanelFrame(),probe=model.panelAccessoryMounts('panel_40x40')[0]
    expect(probe).toBeTruthy()
    const a=model.addNode(20,22.5,20),b=model.addNode(20,62.5,20)
    const tube=model.addTube(a.id,b.id,'T35','green',35)!
    expect(model.confirmedDiagnostics(probe)).toMatchObject({valid:false,reason:'component_space',obstacle:{id:tube.id}})
    expect(model.panelAccessoryMounts('panel_40x40')).toHaveLength(0)
  })

  it('短管框的板件导出QDF再导入后位置与安装关系保持',()=>{
    const {model}=segmentedPanelFrame(),part=model.addConfirmedComponent(model.panelAccessoryMounts('panel_40x40')[0],'yellow')!
    const reopened=new BuildModel(),out=buildQDF(model)
    expect(reopened.loadJSON(parseQDF(out.text,{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})).ok).toBe(true)
    expect(reopened.panels.size).toBe(1)
    const restored=[...reopened.panels.values()][0]
    expect(reopened.panelCorners(restored)!.map(p=>p.join(',')).sort()).toEqual(model.panelCorners(part)!.map(p=>p.join(',')).sort())
    expect(reopened.confirmedDiagnostics(restored).valid).toBe(true)
  })
})
