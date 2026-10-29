import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON, type ModelJSON } from '../collab/ymodel'
import { panelCornerFrame } from '../../scripts/panel-corner-frame.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { computeBOM } from './bom.js'

beforeAll(loadCatalog)

function controller(model: BuildModel, panelId: string) {
  // 使用真实诊断和Yjs历史，鼠标拾取与WebGL另在浏览器验收。
  return Object.assign(Object.create(Builder.prototype), {
    model, panelId, history: new ModelHistory(docFromJSON(model.toJSON() as ModelJSON)),
    scene: { cameraPosition: () => [-100, 100, -100], clearInstallationPreview: () => {} },
    selection: new Map(), mode: 'panel', color: 'yellow', refresh: () => {}, onNotice: () => {},
  }) as Builder
}

describe('普通板转角安装使用原厂网格复核', () => {
  it.each([40, 20].flatMap(depth => [40, 20].map(split => [depth, split])))('深度%s、分段%s的侧面安装不改变邻板，支持保存与撤销重做', (depth, split) => {
    const { model, panelId, isSide } = panelCornerFrame({ depth, split }), before = model.toJSON()
    const available = model.panelAccessoryMounts(panelId).find(isSide)!
    expect(available).toBeTruthy()
    expect(available.nativeGeometry).toBe(true)
    expect(model.panelAccessoryDiagnostics(available)).toMatchObject({ valid: false, reason: 'component_space' })
    expect(model.confirmedDiagnostics(available).valid).toBe(true)
    const builder = controller(model, panelId)
    expect(builder._previewInstallation(available, panelId)).toBe(true)
    const added = [...model.panels.values()].find(part => !before.panels.some(original => original.id === part.id))!
    expect(added).toBeTruthy()
    expect(added).not.toHaveProperty('appearanceVersion')
    expect(added).not.toHaveProperty('nativeGeometry')
    for (const part of before.panels) expect(model.toJSON().panels.find(current => current.id === part.id)).toEqual(part)
    expect(model.toJSON().nodes).toEqual(before.nodes)
    expect(model.toJSON().tubes).toEqual(before.tubes)
    expect(model.nativePanelDiagnostics(added).valid).toBe(true)
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
    expect(reopened.nativePanelDiagnostics(reopened.panels.get(added.id)!).valid).toBe(true)
    builder.history.undo(); expect(builder.history.toJSON()).toEqual(before)
    builder.history.redo(); expect(builder.history.toJSON()).toEqual(saved)
    builder.history.destroy()
  })

  it('两根对边管的安装入口同样复核原厂网格', () => {
    const { model, panelId, isSide } = panelCornerFrame()
    const available = model.panelAccessoryMounts(panelId).find(isSide)!, builder = controller(model, panelId)
    builder._placePanelOnRails(available.a, available.b, available.t0, available.len)
    expect(model.panels.size).toBe(4)
    builder.history.destroy()
  })

  it.each(['addPanelAccessory', 'addConfirmedComponent'] as const)('%s接受已经过原厂网格复核的挂位', method => {
    const { model, panelId, isSide } = panelCornerFrame()
    const available = model.panelAccessoryMounts(panelId).find(isSide)!
    const part = model[method](available, 'yellow')!
    expect(part).toBeTruthy()
    expect(part).not.toHaveProperty('nativeGeometry')
    expect(model.nativePanelDiagnostics(part).valid).toBe(true)
  })

  it('真实穿板管、缺少固定边和重复占位继续拒绝', () => {
    const { model, panelId, isSide } = panelCornerFrame(), available = model.panelAccessoryMounts(panelId).find(isSide)!
    const a = model.addNode(-20, 62.5, 20), b = model.addNode(20, 62.5, 20)
    const obstacle = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    expect(model.panelPlacementDiagnostics(available)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: obstacle.id } })
    expect(model.addNativePanel(available, 'yellow', { nativeGeometry: true })).toBeNull()
    model.removeTube(obstacle.id)
    const added = model.addNativePanel(available, 'yellow', { nativeGeometry: true })!
    expect(added).toBeTruthy()
    expect(model.panelPlacementDiagnostics(available).valid).toBe(false)
    expect(model.addNativePanel(available, 'yellow', { nativeGeometry: true })).toBeNull()
    model.removePanel(added.id); model.removeTube(available.supportTubes[0])
    expect(model.panelPlacementDiagnostics(available).valid).toBe(false)
  })

  it('转角板QDF往返保持板面位置和零件数量', () => {
    const { model, panelId, isSide } = panelCornerFrame()
    const available = model.panelAccessoryMounts(panelId).find(isSide)!
    expect(model.addNativePanel(available, 'yellow', { nativeGeometry: true })).toBeTruthy()
    const source = [...model.panels.values()].map(panel => model.panelCorners(panel)!.map(point => point.join(',')).sort().join('|')).sort()
    const data = parseQDF(buildQDF(model).text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const reopened = new BuildModel()
    expect(reopened.loadJSON(data).ok).toBe(true)
    expect([...reopened.panels.values()].map(panel => reopened.panelCorners(panel)!.map(point => point.join(',')).sort().join('|')).sort()).toEqual(source)
    expect(computeBOM(reopened).panels).toEqual(computeBOM(model).panels)
  })
})
