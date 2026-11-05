import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { bridgeParams, bridgeShape, hangingCurve } from './rainbowBridge.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { computeBOM } from './bom.js'
import { docFromJSON, docToJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'

type V = [number, number, number]
beforeAll(async () => { await loadCatalog() })

function carriers(other: V = [40, 60, 100], reversed = false) {
  const model = new BuildModel()
  const tube = (a: V, b: V, length: number) => {
    const na = model.addNode(...a), nb = model.addNode(...b)
    return model.addTube(na.id, nb.id, `T${length}`, 'blue', length)!
  }
  const a = tube([-20, 100, 0], [20, 100, 0], 35)
  const left: V = [other[0] - 40, other[1], other[2]], right: V = [other[0] + 40, other[1], other[2]]
  const b = tube(reversed ? right : left, reversed ? left : right, 75)
  return { model, a, b }
}

describe('彩虹桥的静态重力形态', () => {
  it('不同高低、管长和偏移的两根管可直接创建，绳子连接各自管子两侧', () => {
    const { model, a, b } = carriers()
    const tx = model.addBridge(a.id, b.id)!
    const shape = bridgeShape(model, tx)!
    expect(shape.rungs).toHaveLength(7)
    expect(shape.ropes[0][0]).toEqual([-14.5, 100, 0])
    expect(shape.ropes[0].at(-1)).toEqual([5.5, 60, 100])
    expect(shape.rungs.every(rung => rung.length === 35)).toBe(true)
    for (const rung of shape.rungs) expect(rung.center[1]).toBeLessThan(100 - 40 * rung.t)
    expect(computeBOM(model).textiles[0].id).toBe('textile_bridge')
  })
  it('管子存储方向相反时绳索保持同侧，不交叉', () => {
    const x = carriers(), y = carriers([40, 60, 100], true)
    expect(bridgeShape(x.model, x.model.addBridge(x.a.id, x.b.id)!)!.ropes)
      .toEqual(bridgeShape(y.model, y.model.addBridge(y.a.id, y.b.id)!)!.ropes)
  })
  it('两端不平行、竖直共线、跨度很短时都保持有限坐标', () => {
    for (const other of [[0, 20, 0], [0, 100, 8], [60, 70, 100]] as V[]) {
      const { model, a, b } = carriers(other)
      const end = model.nodes.get(b.b)!
      if (other[2] === 100) { end.x -= 30; end.y += 30; end.z += 20 }
      const shape = bridgeShape(model, model.addBridge(a.id, b.id)!)!
      expect(shape.ropes.flat(2).every(Number.isFinite)).toBe(true)
      expect(shape.rungs).toHaveLength(7)
    }
  })
  it('增大下垂参数增加垂距；端点和不等高的弦线保持准确', () => {
    const a = [0, 100, 0], b = [40, 30, 100]
    const curve = hangingCurve(a, b, 25)
    expect(curve(0)).toEqual(a)
    expect(curve(1)).toEqual(b)
    expect(curve(0.5)[1]).toBeCloseTo(40, 7)
    expect(hangingCurve(a, b, 0)(0.5)[1]).toBe(65)
  })
  it('较大最小间距会增加绳长和下垂，管数只计算中间横管', () => {
    const { model, a, b } = carriers([0, 100, 30])
    const tx = model.addBridge(a.id, b.id, { count: 9, sag: 0, gap: 1 })!
    const tight = bridgeShape(model, tx)!
    model.updateBridge(tx.id, { gap: 12 })
    const loose = bridgeShape(model, tx)!
    expect(loose.sag).toBeGreaterThan(tight.sag)
    expect(loose.rungs).toHaveLength(9)
    expect(loose.rungs.every(r => r.length === 35)).toBe(true)
    expect(loose.rungs.filter(r => r.t > 0 && r.t < 1)).toHaveLength(9)
    expect(loose.ropes[0][0]).toEqual([-14.5, 100, 0])
    expect(loose.ropes[0].at(-1)).toEqual([-34.5, 100, 30])
  })
  it('自身、缺失管与重合中心不会生成无效桥，参数越界被限制', () => {
    const { model, a } = carriers()
    expect(model.addBridge(a.id, a.id)).toBeNull()
    expect(model.addBridge(a.id, 'missing')).toBeNull()
    expect(bridgeParams({ count: 1000, tubeLength: -1, gap: NaN, sag: Infinity })).toMatchObject({ count: 60, tubeLength: 10, gap: 1, sag: 12 })
    expect(bridgeParams(null)).toEqual(bridgeParams())
    expect(bridgeParams({ endTubes: true })).toEqual(bridgeParams())
  })
  it('框选和相机范围包含下垂的横管，不裁切伸出的长管', () => {
    const { model, a, b } = carriers([0, 100, 80])
    const tx = model.addBridge(a.id, b.id, { sag: 160, tubeLength: 150 })!
    for (const bounds of [model.bounds()!, model.boundsOf([tx.id])!]) {
      expect(bounds.min[0]).toBeLessThanOrEqual(-75)
      expect(bounds.max[0]).toBeGreaterThanOrEqual(75)
      expect(bounds.min[1]).toBeLessThan(0)
    }
  })
})

describe('彩虹桥存档、QDF和编辑历史', () => {
  it('现行组件存档保留原有身份和参数，并能导出为可读回的桥', () => {
    const { model, part } = createConfirmedComponentFixture('textile_bridge')
    const builder = Object.create(Builder.prototype)
    builder.model = model; builder.mode = 'select'; builder.selection = new Map([[part.id, 'fitting']])
    expect(builder.bridgeTarget()?.id).toBe(part.id)
    expect(model.updateBridge(part.id, { count: 9, tubeLength: 45 })).toBe(true)
    const back = new BuildModel()
    back.loadJSON(model.toJSON())
    const fitting = back.fittings.get(part.id)!
    expect(fitting.kind).toBe('textile_bridge')
    expect(fitting.bridge).toMatchObject({ count: 9, tubeLength: 45 })
    expect(bridgeShape(back, fitting)!.rungs).toHaveLength(9)
    const qdf = buildQDF(back)
    const roundtrip = new BuildModel()
    roundtrip.loadJSON(parseQDF(qdf.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize }))
    expect([...roundtrip.textiles.values()][0]?.bridge).toMatchObject({ count: 9, tubeLength: 45 })
  })
  it('现行组件菜单选择桥时进入双管点击流程', () => {
    const builder = Object.create(Builder.prototype)
    builder.scene = {}; builder.mode = 'fitting'; builder.refresh = () => {}
    builder.setFitting('textile_bridge', 'textile_bridge')
    expect(builder.fittingKind).toBe('textil2')
    expect(builder._bridgeTool()).toBe(true)
    expect(builder._confirmedFittingMounts).toBeUndefined()
  })
  it('忽略桥的碰撞占位；复制独立参数，删除承重管时清除桥', () => {
    const { model, a, b } = carriers([0, 100, 80])
    const tx = model.addBridge(a.id, b.id, { count: 8 })!
    expect(model.panelAt(a.id, b.id, 0, 40)).toBeNull()
    expect(model.sectionFree('textil2', a.id, b.id, 0, 40)).toBe(true)
    const fragment = model.extractSelection(new Map([[tx.id, 'textile']]))!
    const copy = new BuildModel()
    copy.insertFragment(fragment, [200, 100, 0])
    const [copied] = copy.textiles.values()
    copy.updateBridge(copied.id, { count: 10 })
    expect(model.textiles.get(tx.id)!.bridge.count).toBe(8)
    expect(copied.bridge.count).toBe(10)
    copy.removeTube(copied.a)
    expect(copy.textiles.size).toBe(0)
    model.removeTextile(tx.id)
    expect(model.tubes.has(a.id) && model.tubes.has(b.id)).toBe(true)
  })
  it('JSON、Yjs协作与旧彩虹桥存档都能加载', () => {
    const { model, a, b } = carriers()
    const tx = model.addBridge(a.id, b.id, { count: 11, tubeLength: 45, gap: 8, sag: 30 })!
    const doc = docFromJSON(model.toJSON())
    const back = new BuildModel()
    back.loadJSON(docToJSON(doc))
    expect(back.textiles.get(tx.id)!.bridge).toEqual(tx.bridge)
    expect(bridgeShape(back, back.textiles.get(tx.id)!)!.ropes).toEqual(bridgeShape(model, tx)!.ropes)
    const old = model.toJSON()
    delete (old.textiles[0] as { bridge?: unknown }).bridge
    back.loadJSON(old)
    expect(bridgeShape(back, back.textiles.get(tx.id)!)!.rungs).toHaveLength(7)
    doc.destroy()
  })
  it.each([[40, 60, 100], [0, 20, 0]] as V[])('QDF读回保留任意端管和完整参数：%s', (x, y, z) => {
    const { model, a, b } = carriers([x, y, z])
    const tx = model.addBridge(a.id, b.id, { count: 8, tubeLength: 45, gap: 4, sag: 22 })!
    const qdf = buildQDF(model)
    expect(qdf.stats.textiles).toBe(1)
    expect(qdf.text).not.toContain('NaN')
    const back = new BuildModel()
    back.loadJSON(parseQDF(qdf.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize }))
    const [loaded] = back.textiles.values()
    expect(loaded?.bridge).toEqual(tx.bridge)
    expect(bridgeShape(back, loaded)!.rungs).toHaveLength(8)
  })
  it('多座桥共用端管且端管不平行时，QDF保持各自身份', () => {
    const { model, a, b } = carriers()
    const end = model.nodes.get(b.b)!
    end.y += 20; end.z += 30
    const first = model.addBridge(a.id, b.id, { count: 5, tubeLength: 25 })!
    const second = model.addBridge(b.id, a.id, { count: 9, tubeLength: 45 })!
    const out = buildQDF(model)
    expect(out.text).not.toContain('NaN')
    const back = new BuildModel()
    back.loadJSON(parseQDF(out.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize }))
    expect([...back.textiles.values()].map(tx => tx.bridge)).toEqual([first.bridge, second.bridge])
  })
  it('真实历史提交后可撤销、重做，并阻止只读编辑', () => {
    const { model, a, b } = carriers()
    const tx = model.addBridge(a.id, b.id)!
    const builder = Object.create(Builder.prototype)
    builder.model = model
    builder.mode = 'select'
    builder.selection = new Map([[tx.id, 'textile']])
    builder.refresh = () => {}
    builder.onHistoryChange = () => {}
    const doc = docFromJSON(model.toJSON()), history = new ModelHistory(doc)
    builder.history = history
    history.onExternal(() => model.loadJSON(history.toJSON()))
    expect(builder.setBridgeParams({ count: 12 })).toBe(true)
    expect(model.textiles.get(tx.id)!.bridge.count).toBe(12)
    history.undo()
    expect(model.textiles.get(tx.id)!.bridge.count).toBe(7)
    history.redo()
    expect(model.textiles.get(tx.id)!.bridge.count).toBe(12)
    builder.readOnly = true
    expect(builder.setBridgeParams({ count: 3 })).toBe(false)
    expect(model.textiles.get(tx.id)!.bridge.count).toBe(12)
    doc.destroy()
  })
  it('彩虹桥工具不会沿用布件的平行、固定格子及占位筛选', () => {
    const { model, a, b } = carriers()
    const builder = Object.create(Builder.prototype)
    builder.model = model
    builder.mode = 'fitting'
    builder.fittingKind = 'textil2'
    builder.fittingPart = 'textile_bridge'
    expect(builder._freePartners(a.id).map((p: { id: string }) => p.id)).toContain(b.id)
    expect(builder._railUsable(a.id, true)).toBe(true)
    builder.fittingPart = 'textile'
    expect(builder._freePartners(a.id)).toHaveLength(0)
  })
})
