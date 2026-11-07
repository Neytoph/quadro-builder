import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'
import { componentMountsValid } from './accessoryPack.js'
import { beginAssemblyCollisionPass, checkAssemblyPath } from './assemblyCollision.js'
import { computeBOM } from './bom.js'
import { docFromJSON, docToJSON } from '../collab/ymodel'

beforeAll(loadCatalog)

// 真实安装API生成的隔离板框；不改变用户模型，不代表实物承载验收。
function fixture(panelId = 'panel_40x40') {
  const model = createDirectInstallationFrame(40, panelId === 'panel_40x20' ? 20 : 40)
  const probe = model.confirmedMounts(panelId, { deduplicate: false }).find(p => p.valid && model.nativePanelDiagnostics(p).valid)!
  expect(probe).toBeTruthy()
  const installStrap = () => {
    const candidate = model.ropeDiagnostics({ tube: probe.a, t: .5 }, { tube: probe.b, t: .5 }, 'strap')
    expect(candidate.valid).toBe(true)
    return model.addConfirmedComponent(candidate, 'black')!
  }
  return { model, probe, installStrap }
}

describe('面板可以覆盖柔软绑带', () => {
  it.each(['panel_40x40', 'panel_40x20'])('%s 先装绑带后放面板，精细复核及实际安装均通过', panelId => {
    const { model, probe, installStrap } = fixture(panelId), strap = installStrap()
    expect(strap).toBeTruthy()
    const before = model.toJSON()
    const result = model.panelPlacementDiagnostics({ ...probe, nativeGeometry: true })
    expect(result.valid, JSON.stringify(result)).toBe(true)
    expect(model.toJSON()).toEqual(before)
    const panel = model.addNativePanel(probe, 'blue', { nativeGeometry: true })!
    expect(panel).toBeTruthy()
    expect(componentMountsValid(model, strap)).toBe(true)
    expect(model.addNativePanel(probe, 'green', { nativeGeometry: true })).toBeNull()
  })

  it.each(['panel_40x40', 'panel_40x20'])('%s 先放面板后加绑带，重开后仍允许板面覆盖', panelId => {
    const { model, probe, installStrap } = fixture(panelId)
    const panel = model.addNativePanel(probe, 'blue', { nativeGeometry: true })!
    expect(panel).toBeTruthy()
    const strap = installStrap()
    expect(strap).toBeTruthy()
    expect(model.nativePanelDiagnostics(panel).valid).toBe(true)
    const doc = docFromJSON(model.toJSON()), copy = new BuildModel()
    expect(copy.loadJSON(docToJSON(doc)).ok).toBe(true)
    expect(copy.nativePanelDiagnostics(copy.panels.get(panel.id)).valid).toBe(true)
    expect(componentMountsValid(copy, copy.fittings.get(strap.id)!)).toBe(true)
    expect(computeBOM(copy)).toEqual(computeBOM(model))
    expect(computeBOM(copy).fittings.find(f => f.kind === 'strap')?.count).toBe(1)
    doc.destroy()
  })

  it('板与绑带的最终重叠及装配路径按两个安装顺序采用同一规则', () => {
    const { model, probe, installStrap } = fixture(), strap = installStrap()
    const panel = model.addNativePanel(probe, 'blue')!
    expect(panel).toBeTruthy()
    beginAssemblyCollisionPass(model)
    for (const [moving, installed] of [[panel.id, strap.id], [strap.id, panel.id]]) {
      expect(checkAssemblyPath(model, [moving], [installed], [0, 0, 0])).toBeNull()
      expect(checkAssemblyPath(model, [moving], [installed], [0, 12, 0])).toBeNull()
    }
  })

  it('绑带不遮住另一根真实穿板管的错误，也不放开重复硬板', () => {
    const { model, probe, installStrap } = fixture()
    installStrap()
    const a = model.addNode(20, 22.5, 20), b = model.addNode(20, 62.5, 20)
    const obstacle = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    expect(obstacle).toBeTruthy()
    expect(model.nativePanelDiagnostics(probe)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: obstacle.id } })
    model.removeTube(obstacle.id)
    expect(model.addNativePanel(probe, 'blue', { nativeGeometry: true })).toBeTruthy()
    expect(model.addNativePanel(probe, 'yellow', { nativeGeometry: true })).toBeNull()
  })
})
