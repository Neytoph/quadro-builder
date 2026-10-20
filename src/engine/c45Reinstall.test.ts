import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async () => { await loadCatalog() })

function fixture() {
  const model = new BuildModel()
  const lower = model.addNode(0, 40, 0)
  model.extend(lower.id, [1, 0, 0], 'T35', 'green', 35, 40)
  const diagonal = model.extendC45Diagonal(lower.id, [Math.SQRT1_2, Math.SQRT1_2, 0], [-1, 0, 0], 'T35', 'red', 35, 40, C45_SLEEVE_LEN, C45_ARM_LEN)!
  const result = model.addC45OnTube(diagonal.node!.id, [1, 0, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
  return { model, body: result.body!, base: result.base! }
}

function editor(model: BuildModel, id: string) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[id, 'node']])
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('删除45°件后重新安装', () => {
  it('删除套筒侧接头后，斜管端不会残留不可见的45°件占用', () => {
    const { model, body, base } = fixture()
    const builder = editor(model, base.id)
    const before = model.toJSON()
    const tubes = before.tubes.filter(t => t.a !== base.id && t.b !== base.id)
    builder.deleteSelection()
    expect(model.toJSON().tubes).toEqual(tubes)
    const end = model.nodes.get(body.id)!
    expect(end.c45body).toBe(false)
    expect(model.c45TubeDir(end)).toBeTruthy()
    const after = model.toJSON()
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('直接移除套筒连接臂后也能重新安装，斜管和另一端保持', () => {
    const { model, body } = fixture()
    const arm = [...model.tubes.values()].find(t => t.arm && (t.a === body.id || t.b === body.id))!
    const tubes = model.toJSON().tubes.filter(t => t.id !== arm.id)
    model.removeTube(arm.id)
    expect(model.toJSON().tubes).toEqual(tubes)
    expect(model.c45TubeDir(model.nodes.get(body.id))).toBeTruthy()
  })

  it('旧存档缺少套筒连接臂时恢复自由管端，合法的下端45°件保持', () => {
    const { model: source, body, base } = fixture()
    const data = source.toJSON()
    data.nodes = data.nodes.filter(n => n.id !== base.id)
    data.tubes = data.tubes.filter(t => t.a !== base.id && t.b !== base.id)
    const model = new BuildModel()
    expect(model.loadJSON(data).ok).toBe(true)
    const end = model.nodes.get(body.id)!
    expect(end.c45body).toBe(false)
    expect(model.c45TubeDir(end)).toBeTruthy()
    expect([...model.nodes.values()].filter(n => n.c45body)).toHaveLength(1)
    expect(model.toJSON().tubes).toEqual(data.tubes)
    const reopened = new BuildModel()
    reopened.loadJSON(model.toJSON())
    expect(reopened.toJSON()).toEqual(model.toJSON())
  })

  for (const format of ['native', 'qdf']) {
    it(`${format}模型删除后露出的管口仍显示安装点并可装回`, () => {
      const source = fixture()
      const model = new BuildModel()
      model.loadJSON(format === 'qdf' ? parseQDF(buildQDF(source.model).text) : source.model.toJSON())
      const body = [...model.nodes.values()].filter(n => n.c45body).sort((a, b) => b.y - a.y)[0]
      const builder = editor(model, body.id)
      builder.deleteSelection()
      const end = model.nodes.get(body.id)!
      const dir = model.c45TubeDir(end)
      expect(dir).toBeTruthy()
      expect(model.c45SleeveAxes(dir).length).toBeGreaterThan(0)
      const handles: Array<{ nodeId: string; inTube?: boolean }> = []
      builder.scene = { addHandle: (_p: number[], data: typeof handles[number]) => handles.push(data) }
      builder.selectedNodeId = null
      builder._buildC45Handles()
      expect(handles.some(h => h.nodeId === end.id && h.inTube)).toBe(true)
      expect(model.addC45OnTube(end.id, model.c45SleeveAxes(dir)[0], C45_SLEEVE_LEN, C45_ARM_LEN)!.body).toBeTruthy()
    })
  }
})
