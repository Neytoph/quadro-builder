import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { C45_ARM_LEN, C45_SLEEVE_LEN } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离画布刷新，使用真实斜管、接头、旋转入口与撤销记录。
function fixture(selectBase = false) {
  const model = new BuildModel()
  const lower = model.addNode(0, 40, 0)
  const upper = model.extend(lower.id, [Math.SQRT1_2, Math.SQRT1_2, 0], 'T35', 'red', 35, 40)!.node!
  const { body, base } = model.addC45OnTube(upper.id, [1, 0, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[selectBase ? base!.id : body!.id, 'node']])
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, builder, lower, body: body!, base: base! }
}

describe('单选 45° 斜角件的 Q/E 旋转', () => {
  for (const selectBase of [false, true]) {
    for (const direction of [-1, 1]) {
      it(`${selectBase ? '套筒端' : '本体'}按${direction === 1 ? 'E' : 'Q'}保持斜管和连接，单次撤销恢复`, () => {
        const { model, builder, lower, body } = fixture(selectBase)
        const before = model.toJSON()
        const fixed = [lower, body].map(node => [node.x, node.y, node.z])
        const selected = [...builder.selection]
        expect(builder.rotateSelectionBy(direction)).toBe(true)
        expect(model.toJSON().tubes).toEqual(before.tubes)
        expect(model.toJSON().nodes).toHaveLength(before.nodes.length)
        for (const [index, id] of [lower.id, body.id].entries()) {
          const node = model.nodes.get(id)!
          expect([node.x, node.y, node.z]).toEqual(fixed[index])
        }
        expect([...builder.selection]).toEqual(selected)
        expect(model.nodes.get(body.id)!.c45axis![2]).toBeCloseTo(direction * Math.SQRT1_2, 3)
        const after = model.toJSON()
        expect(after).not.toEqual(before)
        builder.history.undo()
        expect(model.toJSON()).toEqual(before)
        expect(builder.history.canUndo()).toBe(false)
        builder.history.redo()
        expect(JSON.stringify(model.toJSON())).toBe(JSON.stringify(after))
      })
    }
  }

  it('E 后 Q 恢复套筒方向，保留斜管与接头位置', () => {
    const { model, builder, body, base } = fixture()
    const before = model.toJSON()
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(builder.rotateSelectionBy(-1)).toBe(true)
    model.nodes.get(body.id)!.c45axis!.forEach((value: number, index: number) => expect(value).toBeCloseTo(index === 0 ? 1 : 0, 3))
    const saved = before.nodes.find(node => node.id === base.id)!
    const actual = model.nodes.get(base.id)!
    for (const key of ['x', 'y', 'z'] as const) expect(Math.abs(actual[key] - saved[key])).toBeLessThan(0.02)
    expect(model.toJSON().tubes).toEqual(before.tubes)
  })

  it('两侧接好管后 Q/E 均拒绝拆开结构，且不产生撤销记录', () => {
    const { model, builder, base } = fixture()
    model.extend(base.id, [0, 0, 1], 'T35', 'blue', 35, 40)
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    for (const direction of [-1, 1]) expect(builder.rotateSelectionBy(direction)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('只读时 Q/E 保持模型及历史', () => {
    const { model, builder } = fixture()
    builder.readOnly = true
    const before = model.toJSON()
    for (const direction of [-1, 1]) expect(builder.rotateSelectionBy(direction)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('转到朝下的套筒后可插直角接头并接出水平管', () => {
    const { model, builder, body, base } = fixture()
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(model.nodes.get(body.id)!.c45axis![1]).toBeCloseTo(1, 3)
    expect(builder._nodeAcceptsConnector(base, 'elbow')).toBe(true)
    expect(builder._applyConnectorType(base, 'elbow')).toBe(true)
    const horizontal = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].find(dir => model.canExtendFrom(base, dir))!
    expect(horizontal).toBeTruthy()
    const result = model.extend(base.id, horizontal, 'T35', 'green', 35, 40)!
    expect(result.tube).toBeTruthy()
    expect(result.node!.y).toBeCloseTo(base.y, 3)
  })

  for (const direction of [-1, 1]) {
    it(`空斜角件按${direction === 1 ? 'E' : 'Q'}绕套筒旋转，连接保持`, () => {
      const { model, builder } = fixture()
      model.clear()
      const base = model.addNode(0, 40, 0)
      const { body } = model.addC45Adapter(base.id, [1, 0, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
      builder.selection = new Map([[body!.id, 'node']])
      builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
      const before = model.toJSON()
      expect(builder.rotateSelectionBy(direction)).toBe(true)
      expect(model.nodes.get(body!.id)!.z * direction).toBeGreaterThan(0)
      expect(model.toJSON().tubes).toEqual(before.tubes)
      expect([base.x, base.y, base.z]).toEqual([0, 40, 0])
      builder.history.undo()
      expect(model.toJSON()).toEqual(before)
    })
  }

  it('快捷键取消等待执行的再次点击，避免稍后额外转一次', () => {
    const { model, builder, body } = fixture()
    builder._queueSelectFlip(body.id, { clientX: 0, clientY: 0 }, 'c45')
    expect(builder.rotateSelectionBy(1)).toBe(true)
    const after = model.toJSON()
    builder._runSelectFlip()
    expect(model.toJSON()).toEqual(after)
    builder.history.undo()
    expect(builder.history.canUndo()).toBe(false)
  })
})
