import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel, BOLT_PART } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离检查真实删除与编辑记录，渲染和鼠标命中由浏览器验收覆盖。
function editor(model: BuildModel, id: string, kind: string) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'delete'
  builder.selection = new Map([[id, kind]])
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

function corner(manual = false) {
  const model = new BuildModel()
  const center = model.addNode(0, 40, 0), x = model.addNode(40, 40, 0), z = model.addNode(0, 40, 40)
  const first = model.addTube(center.id, x.id, 'T35', 'blue', 35)!
  const second = model.addTube(center.id, z.id, 'T35', 'green', 35)!
  if (manual) center.preferType = '6way'
  return { model, center, first, second }
}

describe('删除模式下的管子和连接件', () => {
  it('删除一根管子保留相连的其他管子，撤销恢复全部数据', () => {
    const { model, center, first, second } = corner()
    const before = model.toJSON()
    const builder = editor(model, first.id, 'tube')
    builder.deleteSelection()
    expect(model.tubes.has(first.id)).toBe(false)
    expect(model.tubes.get(second.id)).toEqual(second)
    expect(model.nodes.has(center.id)).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
  })

  it('自动生成的连接件连同直接相连的管子删除，其他位置不变', () => {
    const { model, center, first, second } = corner()
    const a = model.addNode(100, 40, 0), b = model.addNode(140, 40, 0)
    const unrelated = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    const builder = editor(model, center.id, 'node')
    expect(builder._deleteHoverExtras({ data: { kind: 'node', id: center.id } })).toEqual([first.id, second.id])
    builder.deleteSelection()
    expect(model.nodes.has(center.id)).toBe(false)
    expect(model.tubes.has(first.id)).toBe(false)
    expect(model.tubes.has(second.id)).toBe(false)
    expect(model.tubes.get(unrelated.id)).toEqual(unrelated)
  })

  it('手动通型只清除手动指定，相连管子保留，撤销和重做保持一致', () => {
    const { model, center } = corner(true)
    const before = model.toJSON(), tubes = model.toJSON().tubes
    const builder = editor(model, center.id, 'node')
    expect(builder._deleteHoverExtras({ data: { kind: 'node', id: center.id } })).toBeNull()
    builder.deleteSelection()
    expect(model.nodes.get(center.id)!.preferType).toBeUndefined()
    expect(model.toJSON().tubes).toEqual(tubes)
    const after = model.toJSON()
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('删管后空的手动连接件保留，单独点击后才移除', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0), b = model.addNode(40, 40, 0)
    a.preferType = '6way'; b.preferType = '3way'
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const builder = editor(model, tube.id, 'tube')
    builder.deleteSelection()
    expect(model.nodes.get(a.id)!.preferType).toBe('6way')
    expect(model.nodes.get(b.id)!.preferType).toBe('3way')
    model.removeConnector(a.id)
    expect(model.nodes.has(a.id)).toBe(false)
    expect(model.nodes.has(b.id)).toBe(true)
  })

  it('保存后打开的手动连接件仍然采用独立删除规则', () => {
    const { model, center } = corner(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    const tubes = reopened.toJSON().tubes
    reopened.removeConnector(center.id)
    expect(reopened.toJSON().tubes).toEqual(tubes)
    expect(reopened.nodes.get(center.id)!.preferType).toBeUndefined()
  })

  it('手动柔性栓及其铰链移除后保留管子，没有残留配件标记', () => {
    const { model, center } = corner()
    center.part = BOLT_PART
    center.partQuat = [0, 0, 0, 1]
    center.hinges = [0, 90]
    center.boltDeep = 2
    const tubes = model.toJSON().tubes
    model.removeConnector(center.id)
    expect(model.toJSON().tubes).toEqual(tubes)
    expect(center.part).toBeUndefined()
    expect(center.hinges).toBeUndefined()
    expect(center.boltDeep).toBeUndefined()
  })

  it('手动斜角接头移除后保留管子，继续使用原有拆卸路径', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0), b = model.addNode(40, 40, 0)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const adapter = model.addC45OnTube(a.id, [-Math.SQRT1_2, 0, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!.body!
    const builder = editor(model, adapter.id, 'node')
    expect(builder._deleteHoverExtras({ data: { kind: 'node', id: adapter.id } })).toBeNull()
    builder.deleteSelection()
    expect(model.tubes.get(tube.id)).toEqual(tube)
    expect(model.nodes.get(a.id)!.c45body).toBe(false)
  })
})
