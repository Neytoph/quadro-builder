import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { computeBOM, resolveNodeConnection } from './bom.js'

beforeAll(async () => { await loadCatalog() })

function frameWithSlope() {
  const model = new BuildModel()
  const bases = [model.addNode(0, 40, 0), model.addNode(0, 40, 40)]
  model.addTube(bases[0].id, bases[1].id, 'T35', 'blue', 35)
  for (const base of bases) {
    const foot = model.addNode(base.x, 0, base.z)
    model.addTube(base.id, foot.id, 'T35', 'green', 35)
  }
  const connections = bases.map(base => resolveNodeConnection(model, base))
  const adapters = bases.map(base => model.addC45Adapter(base.id,
    [1, 0, 0], [Math.SQRT1_2, -Math.SQRT1_2, 0], 7.5, 3.61)!.body!)
  const ends = adapters.map(body => model.addNode(body.x + 40 * Math.SQRT1_2, body.y - 40 * Math.SQRT1_2, body.z))
  const slopes = adapters.map((body, i) => model.addTube(body.id, ends[i].id, 'T35', 'red', 35)!)
  return { model, bases, adapters, ends, slopes, connections }
}

function expectFrameRestored(f: ReturnType<typeof frameWithSlope>) {
  expect([...f.model.nodes.values()].some(n => n.c45 || n.c45body)).toBe(false)
  expect([...f.model.tubes.values()].some(t => t.arm)).toBe(false)
  expect(f.bases.map(base => resolveNodeConnection(f.model, base))).toEqual(f.connections)
  expect(computeBOM(f.model).connectors.some(row => row.type === 'diagonal')).toBe(false)
}

describe('删除斜坡后的接头清理', () => {
  it('删除两根斜管后移除两端转接头，原框架的接头恢复原状', () => {
    const f = frameWithSlope()
    for (const tube of f.slopes) f.model.removeTube(tube.id)
    expectFrameRestored(f)
    expect(f.model.tubes.size).toBe(3)
  })

  it('删除斜管自由端接头时也清理随管失去支撑的转接头', () => {
    const f = frameWithSlope()
    for (const end of f.ends) f.model.removeNode(end.id)
    expectFrameRestored(f)
    expect(f.model.tubes.size).toBe(3)
  })

  it('直接删除转接头本体时同步原框架的标记', () => {
    const f = frameWithSlope()
    for (const body of f.adapters) f.model.removeNode(body.id)
    expectFrameRestored(f)
  })

  it('移除一侧斜管时保留另一侧仍在使用的转接头', () => {
    const f = frameWithSlope()
    f.model.removeTube(f.slopes[0].id)
    expect(f.bases[0].c45).toBe(false)
    expect(f.bases[1].c45).toBe(true)
    expect(f.model.nodes.has(f.adapters[0].id)).toBe(false)
    expect(f.model.nodes.has(f.adapters[1].id)).toBe(true)
    expect(computeBOM(f.model).connectors.find(row => row.type === 'diagonal')?.count).toBe(1)
  })

  it('同一接头还有另一个转接头时保留其标记与支撑', () => {
    const f = frameWithSlope(), base = f.bases[0]
    const other = f.model.addC45Adapter(base.id, [-1, 0, 0], [-Math.SQRT1_2, -Math.SQRT1_2, 0], 7.5, 3.61)!.body!
    const end = f.model.addNode(other.x - 40, other.y - 40, other.z)
    const tube = f.model.addTube(other.id, end.id, 'T35', 'red', 35)!
    f.model.removeTube(f.slopes[0].id)
    expect(base.c45).toBe(true)
    expect(f.model.nodes.has(other.id)).toBe(true)
    f.model.removeTube(tube.id)
    expect(base.c45).toBe(false)
  })

  it('清理导入接头上指向转接头的显式臂，保留其他预留臂', () => {
    const f = frameWithSlope(), base = f.bases[0]
    base.arms = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    f.model.removeTube(f.slopes[0].id)
    expect(base.arms).toEqual([[0, 1, 0], [0, 0, 1]])
    expect(base.c45).toBe(false)
  })

  it('删除接头时保留其他位置已安装、尚未接管的转接头', () => {
    const f = frameWithSlope(), base = f.model.addNode(200, 40, 0)
    const adapter = f.model.addC45Adapter(base.id, [1, 0, 0], [Math.SQRT1_2, -Math.SQRT1_2, 0], 7.5, 3.61)!.body!
    f.model.removeNode(f.ends[0].id)
    expect(f.model.nodes.has(adapter.id)).toBe(true)
    expect(base.c45).toBe(true)
  })

  it('保存重开保留清理结果，历史快照可恢复完整斜坡', () => {
    const f = frameWithSlope(), before = f.model.toJSON()
    for (const tube of f.slopes) f.model.removeTube(tube.id)
    const after = f.model.toJSON()
    expect(f.model.loadJSON(after).ok).toBe(true)
    expectFrameRestored({ ...f, bases: f.bases.map(base => f.model.nodes.get(base.id)!) })
    expect(f.model.loadJSON(before).ok).toBe(true)
    expect(computeBOM(f.model).connectors.find(row => row.type === 'diagonal')?.count).toBe(2)
    expect(f.model.loadJSON(after).ok).toBe(true)
    expectFrameRestored({ ...f, bases: f.bases.map(base => f.model.nodes.get(base.id)!) })
  })
})
