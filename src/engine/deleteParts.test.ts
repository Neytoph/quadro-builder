import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel, BOLT_PART } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, buildableTubes, buildablePanels } from './catalog.js'
import { readFileSync } from 'node:fs'
import { parseQDF } from './qdfimport.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { connectorsForNode, inferConnectorType } from './bom.js'
import { SceneManager } from './scene.js'
import { geometricPreset } from '../data/presets'

beforeAll(async () => { await loadCatalog() })

type ConnectorShape = { arms: number[][]; quat: number[] }

// 隔离检查真实删除与编辑记录，渲染和鼠标命中由浏览器验收覆盖。
function editor(model: BuildModel, id: string, kind: string) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'delete'
  builder.selection = new Map([[id, kind]])
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  // 使用真实方向和姿态方法建立隔离渲染快照；完整WebGL形状另由浏览器比较。
  builder.scene = Object.create(SceneManager.prototype)
  builder.refresh = () => {
    builder.scene._connectorShapes = new Map()
    for (const node of model.nodes.values()) {
      if (node.unused) continue
      const tubeDirs = [...model.tubes.values()].flatMap(tube => {
        const other = tube.a === node.id ? model.nodes.get(tube.b) : tube.b === node.id ? model.nodes.get(tube.a) : null
        if (!other || tube.link) return []
        const d: number[] = model._tubeDirAt(tube, node, other)
        const length = Math.hypot(...d)
        return length ? [{ d: d.map(v => v / length), bow: !!tube.bow }] : []
      })
      if (!node.preferType && !node.arms?.length && !node.c45 && !node.c45body && !node.part && tubeDirs.length === 1) continue
      const quat = builder.scene._nodeCubeQuat(model, node)
      const dirs: { d: number[] }[] = builder.scene._connectorArmDirs(node, tubeDirs, quat)
      builder.scene._connectorShapes.set(node.id, { arms: dirs.map(e => e.d), quat: quat.toArray() })
    }
  }
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  builder.refresh()
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

describe('选区批量删除的兼容规则', () => {
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
    builder.deleteSelection()
    expect(model.tubes.get(tube.id)).toEqual(tube)
    expect(model.nodes.get(a.id)!.c45body).toBe(false)
  })
})

function clickDelete(builder: Builder, id: string, kind: string, extra = {}) {
  builder.scene.pickForDelete = () => ({ data: { id, kind, ...extra } })
  builder._clickDelete({ clientX: 0, clientY: 0 })
}

describe('精准删除的真实编辑入口（隔离模型）', () => {
  it('点管子只删该管，两端连接件和原有型号保留，撤销重做完整', () => {
    const { model, center, first, second } = corner()
    center.arms = [[1, 0, 0], [0, 0, 1]]
    const far = model.nodes.get(first.b)!
    far.preferType = '3way'
    const type = inferConnectorType(model, center)
    const before = model.toJSON()
    const builder = editor(model, first.id, 'tube')
    clickDelete(builder, first.id, 'tube')
    expect(model.tubes.has(first.id)).toBe(false)
    expect(model.tubes.get(second.id)).toEqual(second)
    expect(model.nodes.has(far.id)).toBe(true)
    expect(inferConnectorType(model, center)).toBe(type)
    expect(model.nodes.get(center.id)!.arms).toEqual([[1, 0, 0], [0, 0, 1]])
    expect(connectorsForNode(model, far)).toEqual(['3way'])
    const after = model.toJSON()
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('导入连接件保留实际插口，不额外叠加通型默认插口', () => {
    const { model, center, first } = corner()
    center.arms = [[1, 0, 0], [0, 0, 1]]
    const builder = editor(model, first.id, 'tube')
    const shape: ConnectorShape = builder.scene.connectorShapeFor(center.id)
    clickDelete(builder, first.id, 'tube')
    expect(model.nodes.get(center.id)!.preferType).toBeUndefined()
    const after: ConnectorShape = builder.scene.connectorShapeFor(center.id)
    expect(after.arms.map(d => d.join(',')).sort()).toEqual(shape.arms.map(d => d.join(',')).sort())
    expect(after.quat).toEqual(shape.quat)
  })

  it('隐式旋转连接件删去斜管后仍保留原朝向，裸管端不新增连接件', () => {
    const model = new BuildModel()
    const center = model.addNode(0, 40, 0), a = model.addNode(40, 80, 0), b = model.addNode(-40, 80, 0)
    const first = model.addTube(center.id, a.id, 'T50', 'red', 50)!
    model.addTube(center.id, b.id, 'T50', 'blue', 50)
    const builder = editor(model, first.id, 'tube')
    const before: ConnectorShape = builder.scene.connectorShapeFor(center.id)
    clickDelete(builder, first.id, 'tube')
    const after: ConnectorShape = builder.scene.connectorShapeFor(center.id)
    expect(after.arms.map(d => d.join(',')).sort()).toEqual(before.arms.map(d => d.join(',')).sort())
    expect(after.quat).toEqual(before.quat)
    expect(model.nodes.get(a.id)!.arms).toBeUndefined()
    expect(model.nodes.get(a.id)!.unused).toBe(true)
    expect(connectorsForNode(model, model.nodes.get(a.id)!)).toEqual([])
  })

  for (const manual of [false, true]) it(`点${manual ? '手动' : '自动'}连接件删掉所有直接相连管，另一端即使变空也保留`, () => {
    const { model, center, first, second } = corner(manual)
    const farX = model.nodes.get(first.b)!, farZ = model.nodes.get(second.b)!
    farX.preferType = '6way'; farZ.preferType = '3way'
    const next = model.addNode(80, 40, 0)
    const remaining = model.addTube(farX.id, next.id, 'T35', 'red', 35)!
    const before = model.toJSON()
    const builder = editor(model, center.id, 'node')
    expect(builder._deleteHoverExtras({ data: { id: center.id, kind: 'node' } })).toEqual([first.id, second.id])
    clickDelete(builder, center.id, 'node')
    expect(model.nodes.has(center.id)).toBe(false)
    expect([...model.tubes.keys()]).toEqual([remaining.id])
    expect(model.nodes.get(farX.id)!.preferType).toBe('6way')
    expect(model.nodes.get(farZ.id)!.preferType).toBe('3way')
    const after = model.toJSON()
    const reopened = new BuildModel()
    expect(reopened.loadJSON(after).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(after)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('删除单管后自动连接件即使没有剩余管子也保留在料表', () => {
    const { model, center, first, second } = corner()
    const type = inferConnectorType(model, center)
    const builder = editor(model, first.id, 'tube')
    clickDelete(builder, first.id, 'tube')
    clickDelete(builder, second.id, 'tube')
    expect(model.tubes.size).toBe(0)
    expect(connectorsForNode(model, center)).toEqual([type])
    clickDelete(builder, center.id, 'node')
    expect(model.nodes.has(center.id)).toBe(false)
  })

  it('斜顶架连续删除五根管，保留45°承载连接件料表且裸管端不冒出新连接件', () => {
    const model = new BuildModel()
    expect(model.loadJSON(geometricPreset('a_frame')).ok).toBe(true)
    const builder = editor(model, '', 'tube')
    const originalBOM = [...model.nodes].map(([id, node]) => [id, connectorsForNode(model, node)])
    const original = model.toJSON()
    const tubes = [...model.tubes.values()].filter(t => !t.arm && !t.link).slice(0, 5)
    for (const tube of tubes) {
      clickDelete(builder, tube.id, 'tube')
      expect([...model.nodes].map(([id, node]) => [id, connectorsForNode(model, node)])).toEqual(originalBOM)
    }
    const after = model.toJSON()
    for (const _ of tubes) builder.history.undo()
    expect(model.toJSON()).toEqual(original)
    for (const _ of tubes) builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('删除斜管保留另一端45°接头和它的套筒连接', () => {
    const model = new BuildModel()
    const end = model.addNode(0, 40, 0)
    const far = model.addNode(40, 40, 0)
    const tube = model.addTube(end.id, far.id, 'T35', 'blue', 35)!
    const { body, base } = model.addC45OnTube(end.id, [-Math.SQRT1_2, 0, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!
    const builder = editor(model, tube.id, 'tube')
    clickDelete(builder, tube.id, 'tube')
    expect(model.nodes.get(body!.id)!.c45body).toBe(true)
    expect([...model.tubes.values()].filter(t => t.arm && (t.a === body!.id || t.b === body!.id))).toHaveLength(1)
    clickDelete(builder, body!.id, 'node')
    expect(model.nodes.has(body!.id)).toBe(false)
    expect(model.nodes.has(base!.id)).toBe(true)
    expect(model.nodes.get(base!.id)!.c45).toBe(false)
  })

  it('官方雪橇删除45°件不在保留的承载接头上恢复同一件', () => {
    const model = new BuildModel()
    const data = parseQDF(readFileSync('public/qdf/A0015.qdf', 'utf8'), { tubes: buildableTubes(), panels: buildablePanels() })
    expect(model.loadJSON(data).ok).toBe(true)
    const body = [...model.nodes.values()].find(n => n.c45body)!
    const arm = [...model.tubes.values()].find(t => t.arm && (t.a === body.id || t.b === body.id))!
    const baseId = arm.a === body.id ? arm.b : arm.a
    const original = connectorsForNode(model, model.nodes.get(baseId)!)
    const builder = editor(model, body.id, 'node')
    clickDelete(builder, body.id, 'node')
    expect(model.nodes.has(baseId)).toBe(true)
    expect(connectorsForNode(model, model.nodes.get(baseId)!)).toEqual(original)
    expect(model.nodes.get(baseId)!.c45file).toBe(false)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(connectorsForNode(reopened, reopened.nodes.get(baseId)!)).toEqual(original)
  })

  it('点柔性连接件连管一起删，远端连接件保留；单独点铰链仍只删铰链', () => {
    const { model, center, first, second } = corner()
    center.part = BOLT_PART
    center.hinges = [0, 90]
    const builder = editor(model, center.id, 'node')
    expect(builder._deleteHoverExtras({ data: { id: center.id, kind: 'node', hinge: 0 } })).toBeNull()
    clickDelete(builder, center.id, 'node', { hinge: 0 })
    expect(model.tubes.size).toBe(2)
    expect(center.hinges).toHaveLength(1)
    clickDelete(builder, center.id, 'node')
    expect(model.tubes.size).toBe(0)
    expect(model.nodes.has(center.id)).toBe(false)
    expect(model.nodes.has(first.b)).toBe(true)
    expect(model.nodes.has(second.b)).toBe(true)
  })
})
