import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { computeSafety } from './safety.js'

beforeAll(loadCatalog)

function bridge() {
  const model = new BuildModel()
  const tube = (a: number[], b: number[]) => {
    const first = model.addNode(...a), second = model.addNode(...b)
    const length = Math.hypot(...a.map((value, i) => value - b[i])) - 5
    return model.addTube(first.id, second.id, length === 75 ? 'T75' : 'T35', 'blue', length)!
  }
  const anchors = [0, 80].map(z => tube([0, 82.5, z], [40, 82.5, z]))
  for (const z of [0, 80]) for (const x of [0, 40]) tube([x, 2.5, z], [x, 82.5, z])
  for (const x of [0, 40]) tube([x, 2.5, 0], [x, 2.5, 80])
  const rails = [20, 60].map(z => tube([0, 42.5, z], [40, 42.5, z]))
  const [first, second] = rails
  const board = model.addConfirmedComponent({
    a: first.id, b: second.id, len: 40, t0: 0, panelId: 'panel_40x40', side: 1,
  }, 'red')!
  expect(board).toBeTruthy()
  const ropes = anchors.flatMap((anchor, i) => [0.3, 0.7].map(t => {
    const mount = model.ropeDiagnostics({ tube: anchor.id, t }, { tube: rails[i].id, t })
    const rope = model.addConfirmedComponent(mount, 'white')!
    expect(rope).toBeTruthy()
    return rope
  }))
  return { model, board, ropes, rails }
}

const supportRules = new Set(['accessory_mounts', 'accessory_support', 'floating', 'deck_edges'])
const issues = (model: BuildModel) => computeSafety(model).findings.filter(f => supportRules.has(f.rule))

describe('吊桥支撑检查', () => {
  it('有效吊绳支撑两边桥板，保存重开后不误报四边缺管或悬空', () => {
    const { model } = bridge()
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(issues(reopened)).toEqual([])
    expect(reopened.toJSON()).toEqual(model.toJSON())
  })

  it('一侧绳结损坏仍报安装错误和缺少支撑', () => {
    const { model, board, ropes } = bridge()
    ropes[0].mounts[0].t = 2
    model.removeFitting(ropes[1].id)
    const result = issues(model)
    expect(result.find(f => f.rule === 'accessory_mounts')?.ids.fittings).toEqual([ropes[0].id])
    expect(result.find(f => f.rule === 'accessory_support')?.ids.panels).toContain(board.id)
    expect(result.find(f => f.rule === 'deck_edges')?.ids.panels).toContain(board.id)
  })

  it('普通落地平台保留四边检查，绳索不能支撑位于落地点上方的悬空管', () => {
    const { model, board, rails } = bridge()
    for (const rail of rails) {
      const node = model.nodes.get(rail.a)!
      const foot = model.addNode(node.x, 2.5, node.z)
      expect(model.addTube(foot.id, node.id, 'T35', 'green', 35)).toBeTruthy()
    }
    const first = model.addNode(80, 82.5, 20), second = model.addNode(120, 82.5, 20)
    const high = model.addTube(first.id, second.id, 'T35', 'blue', 35)!
    const mount = model.ropeDiagnostics({ tube: rails[0].id, t: .5 }, { tube: high.id, t: .5 })
    expect(model.addConfirmedComponent(mount, 'white')).toBeTruthy()
    const result = issues(model)
    expect(result.find(f => f.rule === 'deck_edges')?.ids.panels).toContain(board.id)
    expect(result.find(f => f.rule === 'floating')?.ids.nodes).toContain(high.a)
  })
})
