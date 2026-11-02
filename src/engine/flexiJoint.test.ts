import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel, BOLT_PART, hingeDir, hingeGap, hingeKey } from './model.js'
import { loadCatalog } from './catalog.js'
import { connectorsForNode } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { Builder } from './builder.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

function freeEnd() {
  const model = new BuildModel()
  const a = model.addNode(0, 60, 0), b = model.addNode(40, 60, 0)
  model.addTube(a.id, b.id, 'T35', 'red', 35)
  return { model, a, b }
}

describe('柔性接头的整套安装', () => {
  it('一根栓与两片铰链作为真实零件保存，清单和 QDF 保持一致', () => {
    const { model, b } = freeEnd()
    const n = model.addFlexiJoint(b.id)!
    expect(n.part).toBe(BOLT_PART)
    expect(hingeGap(...n.hinges)).toBe(135)
    expect(connectorsForNode(model, n)).toEqual(['flexi_bolt', 'flexi_hinge', 'flexi_hinge'])
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(reopened.nodes.get(b.id)?.hinges).toEqual(n.hinges)
    const { text } = buildQDF(model)
    expect(text.match(/^bolt2\{/gm)).toHaveLength(1)
    expect(text.match(/^flexi-connector3\{/gm)).toHaveLength(2)
    const imported = parseQDF(text)
    const qdfModel = new BuildModel()
    expect(qdfModel.loadJSON(imported).ok).toBe(true)
    const bolt = [...qdfModel.nodes.values()].find(n => n.part === BOLT_PART)!
    expect(bolt.hinges).toHaveLength(2)
    expect(hingeGap(...bolt.hinges)).toBeCloseTo(135)
  })

  it('管端被占用或重复安装时不改变模型', () => {
    const { model, a, b } = freeEnd()
    const c = model.addNode(0, 100, 0)
    model.addTube(a.id, c.id, 'T35', 'blue', 35)
    const before = model.toJSON()
    expect(model.addFlexiJoint(a.id)).toBeNull()
    expect(model.toJSON()).toEqual(before)
    model.addFlexiJoint(b.id)
    const installed = model.toJSON()
    expect(model.addFlexiJoint(b.id)).toBeNull()
    expect(JSON.stringify(model.toJSON())).toBe(JSON.stringify(installed))
  })

  it('铰链方向能接管，接管后连着管子一起转动', () => {
    const { model, b } = freeEnd()
    const n = model.addFlexiJoint(b.id)!
    const dir = hingeDir(n, n.hinges[0])
    expect(model.extend(n.id, dir, 'T35', 'green', 35, 40)).toBeTruthy()
    const before = model.toJSON()
    expect(model.turnHinge(n.id, 0)).toBe(true)
    expect(model.toJSON()).not.toEqual(before)
    expect(model.turnHinge(n.id, 1)).toBe(true)
  })

  it('整套安装只产生一条撤销记录，重做恢复全部配件', () => {
    const { model, b } = freeEnd()
    const builder = Object.create(Builder.prototype)
    builder.model = model
    builder.mode = 'select'
    builder.stepFrom = []
    builder.selection = new Map()
    builder.refresh = () => {}
    builder.onHistoryChange = () => {}
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    builder.recordHistory(() => model.addFlexiJoint(b.id))
    const installed = model.toJSON()
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    expect(JSON.stringify(model.toJSON())).toBe(JSON.stringify(installed))
  })

  it('点栓只选择，明确调整深度才改变插入位置', () => {
    const { model, b } = freeEnd()
    model.addFlexiJoint(b.id)
    const builder = Object.create(Builder.prototype)
    builder.model = model
    builder.fittingKind = 'flexi'
    builder.mode = 'fitting'
    builder.scene = { pickHandle: () => null, pickForDelete: () => ({ data: { kind: 'node', id: b.id } }) }
    builder.refresh = () => {}
    builder.onNotice = () => {}
    builder.onHistoryChange = () => {}
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    builder._clickFlexi({ clientX: 0, clientY: 0 })
    expect(builder.selectedNodeId).toBe(b.id)
    expect(b.boltDeep).toBeUndefined()
    expect(builder.setFlexiDepth()).toBe(true)
    expect(b.boltDeep).toBe(2)
  })
})

function selectedEditor(model: BuildModel, id: string, kind = 'node') {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[id, kind]])
  builder.stepFrom = []
  builder.scene = { setCursor: () => {} }
  builder.refresh = () => {}
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('选择模式中的柔性连接操作', () => {
  it('选中栓可直接补铰链和调整深度，保持选择模式并支持撤销', () => {
    const { model, b } = freeEnd()
    model.addBolt(b.id)
    const builder = selectedEditor(model, b.id)
    expect(builder.addFlexiHinge()).toBe(true)
    expect(builder.mode).toBe('select')
    expect(builder.selection.get(b.id)).toBe('node')
    expect(b.hinges).toEqual([0])
    expect(builder.setFlexiDepth()).toBe(true)
    expect(b.boltDeep).toBe(2)
    builder.history.undo()
    expect(model.nodes.get(b.id).boltDeep).toBeFalsy()
    expect(model.nodes.get(b.id).hinges).toEqual([0])
  })

  it('选中铰链只转该片，重复点击与按钮共用同一操作', () => {
    const { model, b } = freeEnd()
    model.addFlexiJoint(b.id)
    const builder = selectedEditor(model, hingeKey(b.id, 1), 'hinge')
    const before = [...b.hinges]
    expect(builder.turnFlexiHinge()).toBe(true)
    expect(b.hinges[0]).toBe(before[0])
    expect(b.hinges[1]).not.toBe(before[1])
    builder._pickSelect = () => ({ data: { kind: 'node', id: b.id, hinge: 1 } })
    builder._isBlockClick = () => false
    builder._clickSelectRaw({ clientX: 0, clientY: 0 })
    expect(builder.selection.get(hingeKey(b.id, 1))).toBe('hinge')
    expect(b.hinges[0]).toBe(before[0])
    expect(b.hinges[1]).not.toBe(before[1])
  })

  it('选中铰链后接管会进入加管模式并保留所属栓作为起点', () => {
    const { model, b } = freeEnd()
    model.addFlexiJoint(b.id)
    const builder = selectedEditor(model, hingeKey(b.id, 0), 'hinge')
    expect(builder.connectFlexiTube()).toBe(true)
    expect(builder.mode).toBe('add')
    expect(builder.selectedNodeId).toBe(b.id)
    expect(builder.stepFrom).toEqual([b.id])
  })

  it('多选和只读不误改，已接管铰链可带管调整', () => {
    const { model, a, b } = freeEnd()
    model.addFlexiJoint(b.id)
    const builder = selectedEditor(model, b.id)
    builder.selection.set(a.id, 'node')
    const before = JSON.stringify(model.toJSON())
    expect(builder.flexiTarget()).toBeNull()
    expect(builder.addFlexiHinge()).toBe(false)
    expect(builder.setFlexiDepth()).toBe(false)
    builder.selection.delete(a.id)
    builder.readOnly = true
    expect(builder.turnFlexiHinge(0)).toBe(false)
    expect(builder.connectFlexiTube()).toBe(false)
    expect(JSON.stringify(model.toJSON())).toBe(before)
    builder.readOnly = false
    model.extend(b.id, hingeDir(b, b.hinges[0]), 'T35', 'green', 35, 40)
    const attached = JSON.stringify(model.toJSON())
    expect(builder.turnFlexiHinge(0)).toBe(true)
    expect(JSON.stringify(model.toJSON())).not.toBe(attached)
  })
})
