import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { computeSafety } from './safety.js'
import { computeSupportGraph } from './supportGraph.js'
import { componentMountsValid } from './accessoryPack.js'
import { tubeTieMount } from './confirmedComponentModel.js'
import { docFromJSON, docToJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'

beforeAll(loadCatalog)

// 通过真实安装API建立隔离管架；几何连通检查不代表实物承载验证。
function tube(model: BuildModel, a: number[], b: number[], part = 'T35', length = 35) {
  const first = model.addNode(...a, { merge: false }), second = model.addNode(...b, { merge: false })
  return model.addTube(first.id, second.id, part, 'red', length)!
}
function fixture(grounded = true) {
  const model = new BuildModel(), base = tube(model, [0, 80, 0], [40, 80, 0])
  if (grounded) {
    const foot = model.addNode(0, 0, 0)
    expect(model.addTube(foot.id, base.a, 'T75', 'blue', 75)).toBeTruthy()
  } else tube(model, [200, 0, 0], [240, 0, 0])
  const carried = tube(model, [0, 85, 0], [40, 85, 0])
  const corner = model.addNode(40, 85, 40)
  const cross = model.addTube(carried.b, corner.id, 'T35', 'green', 35)!
  const accessory = model.addConfirmedComponent(model.ropeDiagnostics({ tube: carried.id, t: .5 }, { tube: cross.id, t: .5 }), 'blue')!
  expect(accessory).toBeTruthy()
  return { model, base, carried, accessory }
}
function tie(model: BuildModel, first: string, second: string) {
  const candidate = model.ropeDiagnostics({ tube: first, t: .5 }, { tube: second, t: .5 }, 'strap')
  expect(candidate.valid).toBe(true)
  const part = model.addConfirmedComponent(candidate, 'black')!
  expect(part).toBeTruthy()
  return part
}
const floatingNodes = (model: BuildModel) => computeSafety(model).findings.find(f => f.rule === 'floating')?.ids.nodes || []
const unsupported = (model: BuildModel) => computeSafety(model).findings.find(f => f.rule === 'accessory_support')?.ids.fittings || []

describe('绑带支撑关系', () => {
  it('附近的独立管不会因15厘米内接近而得到支撑；真实绑带连通后消除两种误报', () => {
    const { model, base, carried, accessory } = fixture()
    expect(floatingNodes(model)).toContain(carried.a)
    expect(unsupported(model)).toContain(accessory.id)
    const strap = tie(model, base.id, carried.id)
    expect(computeSupportGraph(model).straps.has(strap.id)).toBe(true)
    expect(floatingNodes(model)).not.toContain(carried.a)
    expect(unsupported(model)).not.toContain(accessory.id)
    expect(unsupported(model)).not.toContain(strap.id)
  })

  it('支撑图不合并刚性组选取，也不改写管长、方向、节点和模型存档', () => {
    const { model, base, carried } = fixture()
    tie(model, base.id, carried.id)
    const before = model.toJSON(), rigid = [...model._floodNodes(new Set([carried.a]))]
    expect(rigid).not.toContain(base.a)
    expect(computeSupportGraph(model).byNode.get(carried.a)?.has(base.a)).toBe(true)
    computeSafety(model)
    expect(model.toJSON()).toEqual(before)
    expect([...model._floodNodes(new Set([carried.a]))]).toEqual(rigid)
  })

  it('多级有效绑带可追踪到地面，与配件遍历顺序无关', () => {
    const { model, base, carried } = fixture()
    const upper = tube(model, [0, 90, 0], [40, 90, 0])
    tie(model, carried.id, upper.id)
    tie(model, base.id, carried.id)
    expect(floatingNodes(model)).not.toContain(upper.a)
    const original = computeSafety(model)
    model.fittings = new Map([...model.fittings].reverse())
    expect(computeSafety(model).findings.filter(f => f.rule === 'floating')).toEqual(original.findings.filter(f => f.rule === 'floating'))
    expect(computeSupportGraph(model).byNode.get(upper.a)?.has(base.a)).toBe(true)
  })

  it('两根悬空管绑在一起或绑成闭环，仍然没有地面支撑', () => {
    const { model, base, carried, accessory } = fixture(false)
    tie(model, base.id, carried.id)
    tie(model, carried.id, base.id)
    expect(floatingNodes(model)).toContain(carried.a)
    expect(unsupported(model)).toContain(accessory.id)
  })

  it('远距离绑带可以保留造型，但不使悬空的另一端获得近距固定支撑', () => {
    const { model, base } = fixture()
    const distant = tube(model, [0, 180, 0], [40, 180, 0])
    const strap = tie(model, base.id, distant.id)
    expect(componentMountsValid(model, strap)).toBe(true)
    expect(computeSupportGraph(model).straps.has(strap.id)).toBe(false)
    expect(floatingNodes(model)).toContain(distant.a)
    expect(unsupported(model)).toContain(strap.id)
  })

  it.each(['missing', 'position', 'role', 'same-tube', 'metadata', 'legacy'])('损坏或缺失固定点 %s 不转移支撑，也不崩溃', damage => {
    const { model, base, carried, accessory } = fixture()
    const strap = tie(model, base.id, carried.id)
    if (damage === 'missing') strap.mounts[0].tube = 'missing'
    if (damage === 'position') strap.mounts[0].t = NaN
    if (damage === 'role') strap.mounts[0].role = 'knot'
    if (damage === 'same-tube') strap.mounts[0].tube = carried.id
    if (damage === 'metadata') strap.supportTubes = [base.id, 'missing']
    if (damage === 'legacy') delete strap.appearanceVersion
    expect(() => computeSafety(model)).not.toThrow()
    expect(computeSupportGraph(model).straps.has(strap.id)).toBe(false)
    expect(floatingNodes(model)).toContain(carried.a)
    expect(unsupported(model)).toContain(accessory.id)
  })

  it('删除、撤销、重做及原生／Yjs重开实时更新支撑，不使用旧图缓存', () => {
    const { model, base, carried } = fixture()
    const history = new ModelHistory(docFromJSON(model.toJSON()))
    const before = JSON.stringify(model.toJSON())
    const strap = tie(model, base.id, carried.id)
    history.commit(before, JSON.stringify(model.toJSON()))
    expect(floatingNodes(model)).not.toContain(carried.a)
    const doc = docFromJSON(model.toJSON()), copy = new BuildModel()
    expect(copy.loadJSON(docToJSON(doc)).ok).toBe(true)
    expect(floatingNodes(copy)).not.toContain(carried.a)
    model.removeFitting(strap.id)
    expect(floatingNodes(model)).toContain(carried.a)
    history.undo(); model.loadJSON(docToJSON(history.doc))
    expect(floatingNodes(model)).toContain(carried.a)
    history.redo(); model.loadJSON(docToJSON(history.doc))
    expect(floatingNodes(model)).not.toContain(carried.a)
    doc.destroy()
  })

  it('斜管与弯管使用实际挂点，能通过绑带获得地面连接', () => {
    const { model, base } = fixture()
    const diagonal = tube(model, [0, 65, 5], [28.284271, 93.284271, 5])
    tie(model, base.id, diagonal.id)
    expect(floatingNodes(model)).not.toContain(diagonal.a)
    const start = model.addNode(205, 60, 0, { merge: false })
    const bow = model.extendBow(start.id, [1, 0, 0], [0, 1, 0], 'TC35', 'yellow', 40)!.tube!
    const point = [205 + 40 * Math.SQRT1_2, 100 - 40 * Math.SQRT1_2, 0]
    const mount = tubeTieMount(model, bow.id, point, 'strap')!
    const carrier = tube(model, [point[0] - 20, point[1], 5], [point[0] + 20, point[1], 5])
    const ground = model.addNode(point[0] - 20, 0, 5)
    model.addTube(ground.id, carrier.a, 'T75', 'red', 75)
    const strap = model.addConfirmedComponent(model.ropeDiagnostics(mount, { tube: carrier.id, t: .5 }, 'strap'), 'black')!
    expect(strap).toBeTruthy()
    expect(computeSupportGraph(model).straps.has(strap.id)).toBe(true)
    expect(floatingNodes(model)).not.toContain(start.id)
  })

  it('整体平移后固定点仍有效，配件支撑判断保持一致', () => {
    const { model, base, carried, accessory } = fixture()
    tie(model, base.id, carried.id)
    const before = unsupported(model), data = model.toJSON()
    data.nodes.forEach(n => { n.x += 40 })
    data.fittings.forEach(f => {
      f.x += 40
      const mounts = (f as { mounts?: Array<{ pos?: number[] }> }).mounts
      mounts?.forEach(m => { if (m.pos) m.pos[0] += 40 })
    })
    const copy = new BuildModel(); expect(copy.loadJSON(data).ok).toBe(true)
    expect(unsupported(copy)).toEqual(before)
    expect(unsupported(copy)).not.toContain(accessory.id)
  })

  it('其他组件中的轮子或管夹不再掩盖此处悬空结构', () => {
    const { model, base, carried } = fixture()
    model.addFitting('multi-wheel2', 0, 0, 0)
    const anchor = model.nodes.get(base.a)!
    anchor.clampOn = { tubeId: base.id, t: .5 }
    expect(floatingNodes(model)).toContain(carried.a)
  })
})
