import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { C45_ARM_LEN, C45_SLEEVE_LEN } from './config.js'
import { connectorsForNode, resolveNodeConnection } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离结构夹具复现两侧主架接头承载45°件，使用真实接管、引导、存档和撤销路径。
function frame(imported: boolean) {
  const model = new BuildModel()
  const bases = [0, 40].map(z => {
    const base = model.addNode(0, 60, z)
    model.addTube(base.id, model.addNode(-40, 60, z).id, 'T35', 'red', 35)
    model.addTube(base.id, model.addNode(0, 20, z).id, 'T35', 'green', 35)
    const adapter = model.addC45Adapter(base.id, [1, 0, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
    expect(model.extend(adapter.body!.id, [-Math.SQRT1_2, Math.SQRT1_2, 0], 'T15', 'blue', 15, 20)?.tube).toBeTruthy()
    if (imported) base.arms = [[-1, 0, 0], [0, -1, 0], [1, 0, 0]]
    return base
  })
  const builder = Object.create(Builder.prototype)
  const handles: Array<{ nodeId: string; dir: number[]; previewTarget: number[] }> = []
  Object.assign(builder, { model, mode: 'add', tubeId: 'T35', color: 'yellow', selectedNodeId: bases[0].id,
    selection: new Map(), stepFrom: [], refresh: () => {}, onNotice: () => {}, onHistoryChange: () => {},
    scene: { addHandle: (_p: number[], data: typeof handles[number]) => handles.push(data) } })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, bases, builder, handles }
}

describe('承载斜角件的普通接头自动扩建', () => {
  it.each([false, true])('接横杆时两端三通自动变四通，导入臂=%s', imported => {
    const { model, bases, builder, handles } = frame(imported)
    const before = model.toJSON()
    expect(bases.map(n => connectorsForNode(model, n))).toEqual([['t'], ['t']])
    builder._addBuildHandles(bases[0])
    expect(handles.find(h => h.dir[2] > .99)?.previewTarget).toEqual([0, 60, 40])
    expect(model.toJSON()).toEqual(before)
    builder.buildStep([0, 0, 1])
    expect(model.nodes.size).toBe(before.nodes.length)
    expect(model.tubes.size).toBe(before.tubes.length + 1)
    expect(model.tubeBetween(bases[0].id, bases[1].id)?.tubeId).toBe('T35')
    for (const n of bases) {
      expect(connectorsForNode(model, n)).toEqual(['4way'])
      expect(resolveNodeConnection(model, n).diagnostics).toEqual([])
    }
    const after = model.toJSON()
    expect(after.tubes.filter(t => 'arm' in t && t.arm)).toEqual(before.tubes.filter(t => 'arm' in t && t.arm))
    expect(after.nodes.filter(n => 'c45body' in n && n.c45body)).toEqual(before.nodes.filter(n => 'c45body' in n && n.c45body))
    for (const tube of before.tubes) expect(after.tubes.find(t => t.id === tube.id)).toEqual(tube)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(after).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(after)
    const qdf = new BuildModel()
    expect(qdf.loadJSON(parseQDF(buildQDF(model).text)).ok).toBe(true)
    for (const z of [0, 40]) {
      const n = [...qdf.nodes.values()].find(n => Math.hypot(n.x, n.y - 60, n.z - z) < .1)!
      expect(connectorsForNode(qdf, n)).toEqual(['4way'])
      expect(resolveNodeConnection(qdf, n).diagnostics).toEqual([])
    }
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('遇到穿管障碍时不增加接口、不修改模型', () => {
    const { model, bases } = frame(true)
    model.addTube(model.addNode(-20, 60, 20).id, model.addNode(20, 60, 20).id, 'T35', 'red', 35)
    const before = model.toJSON()
    expect(model.planTubeExtension(bases[0].id, [0, 0, 1], 40)).toEqual({ collision: true })
    expect(model.extend(bases[0].id, [0, 0, 1], 'T35', 'yellow', 35, 40)).toEqual({ collision: true })
    expect(model.toJSON()).toEqual(before)
  })

  it('45°件本体和已占用插口不增加横向接管入口', () => {
    const { model, bases } = frame(true)
    const body = [...model.nodes.values()].find(n => n.c45body)!
    const before = model.toJSON()
    for (const dir of [[0, 0, 1], [0, 0, -1]]) expect(model.extend(body.id, dir, 'T35', 'yellow', 35, 40)).toBeNull()
    for (const dir of [[1, 0, 0], [-1, 0, 0], [0, -1, 0]]) expect(model.canExtendFrom(bases[0], dir)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('导入接头增加弯管时按切线更新接口，保留原有空接口', () => {
    const { model, bases } = frame(true)
    bases[0].arms!.push([0, 1, 0])
    const result = model.extendBow(bases[0].id, [0, 0, -1], [0, 1, 0], 'TC1', 'yellow', 40)!
    expect(result.tube).toMatchObject({ bow: true })
    expect(bases[0].arms).toContainEqual([0, 1, 0])
    expect(bases[0].arms).toContainEqual([0, 0, -1])
    expect(bases[0].arms).not.toContainEqual([0, Math.SQRT1_2, -Math.SQRT1_2])
    expect(resolveNodeConnection(model, bases[0]).diagnostics).toEqual([])
  })
})
