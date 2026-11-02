import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { componentMountsValid } from './accessoryPack.js'
import { curvePoint } from './confirmedComponentModel.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { computeBOM } from './bom.js'

beforeAll(async () => { await loadCatalog() })

// 通过真实模型API复现拼接框架；浏览器点击另行验收。
// 引擎为 JavaScript 模块，any 用于读取动态配件字段。
function frame(left = [40, 40], right = [40, 40], reverse = false, gap = 40) {
  const model = new BuildModel()
  const tube = (a: number[], b: number[]) => {
    const first = model.addNode(...a), second = model.addNode(...b)
    const span = Math.hypot(...a.map((v, i) => v - b[i]))
    return model.addTube(reverse ? second.id : first.id, reverse ? first.id : second.id, `T${span - 5}`, 'blue', span - 5)!
  }
  for (const [x, segments] of [[0, left], [gap, right]] as const) {
    let at = 0
    for (const length of segments) { tube([x, 42.5, at], [x, 42.5, at + length]); at += length }
  }
  tube([0, 42.5, 0], [gap, 42.5, 0])
  tube([0, 42.5, 80], [gap, 42.5, 80])
  return { model, tube }
}

function install(model: BuildModel) {
  const available = model.confirmedMounts('textile_bridge').filter((p: any) => p.valid)
  expect(available).toHaveLength(1)
  const part = model.addConfirmedComponent(available[0], 'blue') as any
  expect(part).toBeTruthy()
  expect(componentMountsValid(model, part)).toBe(true)
  return part
}

describe('彩虹桥按完整连续框边安装', () => {
  it.each([
    [[80], [80], false],
    [[40, 40], [40, 40], false],
    [[20, 20, 40], [40, 20, 20], false],
    [[80], [20, 40, 20], true],
    [[20, 20, 20, 20], [40, 40], true],
  ] as const)('左侧 %j、右侧 %j、反向 %s，固定点落在真实管件上', (left, right, reverse) => {
    const { model } = frame([...left], [...right], reverse)
    const part = install(model)
    expect(part.len).toBe(80)
    expect(part.mounts).toHaveLength(14)
    expect(part.supportTubes).toHaveLength(left.length + right.length)
    for (const mount of part.mounts) {
      expect(mount.t).toBeGreaterThanOrEqual(0)
      expect(mount.t).toBeLessThanOrEqual(1)
      const point = curvePoint(model, mount.tube, mount.t)!
      expect([0, 40]).toContain(point[0])
      expect(point[1]).toBe(42.5)
      expect(point[2]).toBeGreaterThan(0)
      expect(point[2]).toBeLessThan(80)
    }
    expect(computeBOM(model).fittings.some((p: any) => p.id === 'textile_bridge' && p.count === 1)).toBe(true)
  })

  it('图中框架的中间横管不妨碍安装', () => {
    const { model, tube } = frame()
    tube([0, 42.5, 40], [40, 42.5, 40])
    install(model)
  })

  it.each(['gap', 'wrong-width', 'short', 'nonparallel'])('拒绝 %s 框架', failure => {
    const { model } = frame([40, 40], failure === 'short' ? [40] : [40, 40], false, failure === 'wrong-width' ? 60 : 40)
    const left = [...model.tubes.values()].filter((t: any) => model.nodes.get(t.a)!.x === 0 && model.nodes.get(t.b)!.x === 0)
    if (failure === 'gap') model.removeTube(left[1].id)
    if (failure === 'nonparallel') model.nodes.get(left[1].b)!.x += 5
    expect(model.confirmedMounts('textile_bridge').filter((p: any) => p.valid)).toEqual([])
  })

  it('JSON、整组变换、复制与删除实际支撑管保留正确依赖', () => {
    const { model } = frame([40, 40], [20, 20, 40])
    const part = install(model), saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
    expect(componentMountsValid(reopened, [...reopened.fittings.values()][0])).toBe(true)
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    expect(model.moveSelection(selection, 160, 0, 0).ok).toBe(true)
    expect(model.rotateSelection(selection).ok).toBe(true)
    expect(model.mirrorSelection(selection, 'z').ok).toBe(true)
    expect(componentMountsValid(model, model.fittings.get(part.id))).toBe(true)
    const fragment = model.extractSelection(selection)!
    const inserted = model.insertFragment(fragment, [480, 2.5, 0]) as any
    const copy = model.fittings.get(inserted.fittings[0]) as any
    expect(copy.supportTubes.every((id: string) => inserted.tubes.includes(id))).toBe(true)
    expect(copy.mounts.every((m: any) => inserted.tubes.includes(m.tube))).toBe(true)
    expect(componentMountsValid(model, copy)).toBe(true)
    for (const support of part.supportTubes) {
      const target = new BuildModel(); target.loadJSON(saved)
      target.removeTube(support)
      expect(target.fittings.has(part.id)).toBe(false)
    }
  })

  it('安装后的真实历史可撤销重做', () => {
    const { model } = frame(), before = model.toJSON()
    const history = new ModelHistory(docFromJSON(before as any))
    install(model)
    const saved = model.toJSON()
    history.commit(JSON.stringify(before), JSON.stringify(saved))
    history.undo(); expect(history.toJSON()).toEqual(before)
    history.redo(); expect(history.toJSON()).toEqual(JSON.parse(JSON.stringify(saved)))
    const reopened = new BuildModel(); reopened.loadJSON(history.toJSON())
    expect(componentMountsValid(reopened, [...reopened.fittings.values()][0])).toBe(true)
    history.destroy()
  })
})
