import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from './config.js'
import { xAxisOf, yAxisOf } from './util.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async () => { await loadCatalog() })

// 隔离验证真实模型、旋转入口和编辑记录；场景刷新不参与几何断言。
function editor(model: BuildModel, selection: Map<string, string>) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = selection
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

function flap(twoSides = false) {
  const model = new BuildModel()
  const rail = (z: number) => {
    const a = model.addNode(0, 40, z), b = model.addNode(40, 40, z)
    return model.addTube(a.id, b.id, 'T35', 'blue', 35)!
  }
  const base = rail(0), moving = rail(5), foot = rail(45)
  model.addLink(base.a, moving.a)
  model.addLink(base.b, moving.b)
  model.addTube(moving.a, foot.a, 'T35', 'blue', 35)
  model.addTube(moving.b, foot.b, 'T35', 'blue', 35)
  model.addPanel(moving.id, foot.id, 0, 40, 'P40', 'blue')
  const clamp = model.addClamp(20, 40, 0)
  clamp.dir = [1, 0, 0]
  clamp.off = [0, 0, 5]
  if (twoSides) {
    const other = rail(-45)
    model.addTube(moving.a, other.a, 'T35', 'blue', 35)
    model.addTube(moving.b, other.b, 'T35', 'blue', 35)
  }
  return { model, clamp, foot, moving }
}

describe('受阻后反向旋转', () => {
  it('夹子遇地面换向后连续沿新方向转，不在两个姿态间往返', () => {
    const { model, clamp, foot } = flap()
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const builder = editor(model, new Map([[clamp.id, 'clamp']]))
    expect(builder._rotateClampWithFallback(clamp.id)).toBe(true)
    const firstHeight = model.nodes.get(foot.a)!.y
    expect(builder._rotateClampWithFallback(clamp.id)).toBe(true)
    const secondHeight = model.nodes.get(foot.a)!.y
    expect(secondHeight).toBeGreaterThan(firstHeight)
    expect(builder._rotateClampWithFallback(clamp.id)).toBe(true)
    expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(secondHeight)
  })

  it('弯管遇地面换向后继续经过另一侧，再遇地面时才换回来', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 0, 0)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 0, 1], 'TC1', 'blue', 40)!.tube!
    const builder = editor(model, new Map([[bow.id, 'tube']]))
    const before = model.toJSON()
    for (const expected of [[40, 40, 0], [40, 0, -40], [40, 40, 0], [40, 0, 40]]) {
      expect(builder._turnBow(bow)).toBe(true)
      const end = model.nodes.get(bow.b)!
      expect([end.x, end.y, end.z]).toEqual(expected)
    }
    for (let i = 0; i < 4; i++) builder.history.undo()
    expect(model.toJSON()).toEqual(before)
  })

  it('管端45°接头换向后下一次继续同方向，其他接头仍用自己的方向', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const { body, base } = model.addC45OnTube(a.id, [-Math.SQRT1_2, 0, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!
    const otherBase = model.addNode(200, 40, 0)
    const other = model.addC45Adapter(otherBase.id, [1, 0, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!.body!
    const builder = editor(model, new Map([[body!.id, 'node']]))
    expect(builder._turnC45(body!.id)).toBe(true)
    const expected = new BuildModel()
    expect(expected.loadJSON(model.toJSON()).ok).toBe(true)
    expect(expected.rotateC45Sleeve(body!.id, -1)).toBe(true)
    expect(expected.rotateC45(other.id, 1)).toBe(true)
    expect(builder._turnC45(body!.id)).toBe(true)
    expect(builder._turnC45(other.id)).toBe(true)
    expect(model.nodes.get(body!.id)!.c45axis).toEqual(expected.nodes.get(body!.id)!.c45axis)
    expect([base!.x, base!.y, base!.z]).toEqual([expected.nodes.get(base!.id)!.x, expected.nodes.get(base!.id)!.y, expected.nodes.get(base!.id)!.z])
    expect([other.x, other.y, other.z]).toEqual([expected.nodes.get(other.id)!.x, expected.nodes.get(other.id)!.y, expected.nodes.get(other.id)!.z])
  })

  it('主动按相反Q/E方向重新指定方向，不沿用先前的自动换向', () => {
    const { model, clamp } = flap()
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const builder = editor(model, new Map([[clamp.id, 'clamp']]))
    expect(builder.rotateSelectionBy(1)).toBe(true)
    const expected = new BuildModel()
    expect(expected.loadJSON(model.toJSON()).ok).toBe(true)
    expect(expected.rotateClamp(clamp.id, -Math.PI / 2)).toBe(true)
    expect(builder.rotateSelectionBy(-1)).toBe(true)
    expect(model.toJSON()).toEqual(expected.toJSON())
    expect(expected.rotateClamp(clamp.id, Math.PI / 2)).toBe(true)
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(model.toJSON()).toEqual(expected.toJSON())
  })

  it('选择模式的地面坡板能反向抬起，并只产生一次可撤销操作', () => {
    const { model, clamp, foot } = flap()
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const before = model.toJSON()
    const builder = editor(model, new Map([[clamp.id, 'clamp']]))
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(0)
    expect(builder.history.canUndo()).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('再次点击转角夹的 45 度旋转遇地面后反向', () => {
    const { model, clamp, foot } = flap()
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const builder = editor(model, new Map([[clamp.id, 'clamp']]))
    expect(builder._rotateClampWithFallback(clamp.id)).toBe(true)
    expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(0)
  })

  it('夹子两边都被地面阻挡时完整保持原位，没有撤销记录', () => {
    const { model, clamp } = flap(true)
    const before = model.toJSON()
    const builder = editor(model, new Map([[clamp.id, 'clamp']]))
    expect(builder.rotateSelectionBy(1)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('整组选区碰到其他管子后反向旋转，障碍保持原位', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 20, 0), b = model.addNode(40, 20, 0), c = model.addNode(40, 20, 40)
    const first = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const second = model.addTube(b.id, c.id, 'T35', 'blue', 35)!
    const p = model.addNode(10, 20, 40), q = model.addNode(30, 20, 40)
    model.addTube(p.id, q.id, 'T15', 'red', 15)
    const selection = new Map([[first.id, 'tube'], [second.id, 'tube']])
    expect(model.rotateSelection(selection, 1)).toMatchObject({ ok: false, reason: 'collision' })
    const builder = editor(model, selection)
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect([model.nodes.get(a.id)!.x, model.nodes.get(a.id)!.z]).toEqual([0, 40])
    expect([model.nodes.get(p.id)!.x, model.nodes.get(p.id)!.z]).toEqual([10, 40])
  })

  it('选区碰撞换向后即使障碍移除，也继续沿新方向旋转', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 20, 0), b = model.addNode(40, 20, 0), c = model.addNode(40, 20, 40)
    const first = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const second = model.addTube(b.id, c.id, 'T35', 'blue', 35)!
    const p = model.addNode(10, 20, 40), q = model.addNode(30, 20, 40)
    const obstacle = model.addTube(p.id, q.id, 'T15', 'red', 15)!
    const builder = editor(model, new Map([[first.id, 'tube'], [second.id, 'tube']]))
    expect(builder.rotateSelectionBy(1)).toBe(true)
    model.removeTube(obstacle.id)
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect([model.nodes.get(a.id)!.x, model.nodes.get(a.id)!.z]).toEqual([40, 40])
  })

  it('弯管前方受阻时反向 90 度，不跳到 180 度的另一侧', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 0, 0)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 0, 1], 'TC1', 'blue', 40)!.tube!
    expect(model.rotateBow(bow.id, 1)?.node).toBeTruthy()
    const end = model.nodes.get(bow.b)!
    expect([end.x, end.y, end.z]).toEqual([40, 40, 0])
  })

  it('弯管反向支点下两侧都受阻时，连端点顺序也保持不变', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 1, 0], 'TC1', 'blue', 40)!.tube!
    const end = model.nodes.get(bow.b)!
    for (const z of [-40, 40]) {
      const target = model.addNode(end.x, 40, z)
      model.addTube(end.id, target.id, 'T35', 'red', 35)
    }
    const before = model.toJSON()
    expect(model.rotateBow(bow.id, 1, { pivot: bow.b })?.duplicate).toBe(true)
    expect(model.toJSON()).toEqual(before)
  })
})

describe('选择模式下再次点击弯管和斜角接头', () => {
  it('单选弯管的再次点击转 90 度，支点保持原位，撤销完整恢复', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 1, 0], 'TC1', 'blue', 40)!.tube!
    const before = model.toJSON()
    const builder = editor(model, new Map([[bow.id, 'tube']]))
    expect(builder._clickRotationKind(bow.id, 'tube')).toBe('bow')
    builder._queueSelectFlip(bow.id, { clientX: 20, clientY: 20 }, 'bow')
    builder._runSelectFlip()
    expect([model.nodes.get(a.id)!.x, model.nodes.get(a.id)!.y, model.nodes.get(a.id)!.z]).toEqual([0, 40, 0])
    expect(model.nodes.get(bow.b)!.y).toBe(40)
    expect(Math.abs(model.nodes.get(bow.b)!.z)).toBe(40)
    expect(builder.selection.has(bow.id)).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
  })

  it('弯管两端都接着其他管子时拒绝点击旋转，连接不变', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0), base = model.addNode(0, 0, 0)
    model.addTube(base.id, a.id, 'T35', 'blue', 35)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 1, 0], 'TC1', 'blue', 40)!.tube!
    const end = model.nodes.get(bow.b)!, other = model.addNode(end.x + 40, end.y, end.z)
    model.addTube(end.id, other.id, 'T35', 'blue', 35)
    const before = model.toJSON()
    const builder = editor(model, new Map([[bow.id, 'tube']]))
    expect(builder._turnBow(bow)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('空的 45° 斜角接头再次点击后换朝向，四次恢复且可以撤销', () => {
    const model = new BuildModel()
    const base = model.addNode(0, 40, 0)
    const body = model.addC45Adapter(base.id, [1, 0, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!.body!
    const before = model.toJSON()
    const builder = editor(model, new Map([[body.id, 'node']]))
    expect(builder._clickRotationKind(body.id, 'node')).toBe('c45')
    builder._queueSelectFlip(body.id, { clientX: 20, clientY: 20 }, 'c45')
    builder._runSelectFlip()
    expect(model.toJSON()).not.toEqual(before)
    expect(builder.selection.has(body.id)).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    for (let i = 0; i < 4; i++) expect(builder._turnC45(body.id)).toBe(true)
    expect(model.toJSON().nodes.map(node => [node.id, node.x, node.y, node.z])).toEqual(before.nodes.map(node => [node.id, node.x, node.y, node.z]))
    expect(model.toJSON().tubes).toEqual(before.tubes)
  })

  it('插在水平管中的 45° 斜角接头碰到地面后反向，管子保持原位', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const result = model.addC45OnTube(a.id, [-Math.SQRT1_2, 0, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!
    const body = result.body!, base = result.base!
    const builder = editor(model, new Map([[body.id, 'node']]))
    expect(model.rotateC45Sleeve(body.id)).toBe(false)
    expect(builder._turnC45(body.id)).toBe(true)
    expect(model.nodes.get(base.id)!.y).toBeGreaterThan(0)
    expect([model.nodes.get(a.id)!.x, model.nodes.get(a.id)!.y, model.nodes.get(a.id)!.z]).toEqual([0, 0, 0])
    expect([model.nodes.get(b.id)!.x, model.nodes.get(b.id)!.y, model.nodes.get(b.id)!.z]).toEqual([40, 0, 0])
  })

  it('斜角接头两侧都安装管子时不拆开结构；取消待执行点击也不改模型', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0), b = model.addNode(40, 40, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const result = model.addC45OnTube(a.id, [-Math.SQRT1_2, 0, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!
    const body = result.body!, base = result.base!
    const other = model.addNode(base.x, base.y + 40, base.z)
    model.addTube(base.id, other.id, 'T35', 'blue', 35)
    const before = model.toJSON()
    const builder = editor(model, new Map([[body.id, 'node']]))
    expect(builder._turnC45(body.id)).toBe(false)
    builder._queueSelectFlip(body.id, { clientX: 20, clientY: 20 }, 'c45')
    builder._cancelSelectFlip()
    builder._runSelectFlip()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('导入姿态在旋转后同步更新，保存与 QDF 导出保留新朝向', () => {
    const model = new BuildModel()
    const base = model.addNode(0, 40, 0)
    const body = model.addC45Adapter(base.id, [1, 0, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!.body!
    base.c45quat = [0, 0, 0, 1]
    const builder = editor(model, new Map([[body.id, 'node']]))
    expect(builder._turnC45(body.id)).toBe(true)
    expect(xAxisOf(base.c45quat)).toEqual([1, 0, 0])
    expect(yAxisOf(base.c45quat)[2]).toBeCloseTo(1, 4)
    const saved = new BuildModel()
    expect(saved.loadJSON(model.toJSON()).ok).toBe(true)
    expect(saved.nodes.get(base.id)!.c45quat).toEqual(base.c45quat)
    const exported = buildQDF(model)
    expect(exported.stats.connectors).toBeGreaterThan(0)
    const reopened = parseQDF(exported.text)
    const adapter = reopened.nodes.find((node): node is typeof node & { c45quat: number[] } =>
      'c45quat' in node && Array.isArray(node.c45quat))
    expect(adapter).toBeTruthy()
    expect(yAxisOf(adapter!.c45quat)[2]).toBeCloseTo(1, 3)
  })
})
