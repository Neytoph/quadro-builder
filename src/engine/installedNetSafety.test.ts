import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { confirmedCandidates, confirmedPanelDiagnostics, confirmedStructuralValid } from './confirmedComponentModel.js'
import { withPlacementSnapshot } from './incrementalPlacement.js'

beforeAll(() => loadCatalog())
// 原生组件字段随类型变化，测试沿用引擎动态记录以比较完整固定点。
type Part = Record<string, any>
const fullSearch = (model: BuildModel, part: Part) => withPlacementSnapshot(model, () => (part.panelId ? [confirmedPanelDiagnostics(model, part)] : confirmedCandidates(model, 'lattice', { sectorFacing: part.facing })).some((p: Part) => {
  const mounts = [...p.mounts]
  return p.valid && p.supportTubes.length === part.supportTubes.length && p.supportTubes.every((id: string) => part.supportTubes.includes(id))
    && part.mounts.length === mounts.length && part.mounts.every((m: Part) => {
      const i = mounts.findIndex((a: Part) => a.tube === m.tube && a.role === m.role && Math.abs(a.width - m.width) < .01 && Math.abs(a.t - m.t) < .001)
      if (i < 0) return false
      mounts.splice(i, 1); return true
    }) && Math.hypot(...p.pos.map((v: number, i: number) => v - [part.x, part.y, part.z][i])) < .1
    && Math.abs(p.quat.reduce((sum: number, v: number, i: number) => sum + v * part.quat[i], 0)) > .9999
}))
const check = (model: BuildModel, part: Part) => expect(withPlacementSnapshot(model, () => confirmedStructuralValid(model, part))).toBe(fullSearch(model, part))

describe('已安装攀爬网与原全模型枚举保持一致', () => {
  it('安装、刚体移动、旋转和镜像后保留同一固定点判定', () => {
    const { model, part } = createConfirmedComponentFixture('lattice')
    check(model, part)
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    model.moveSelection(selection, 100, 0, 160); check(model, part)
    model.rotateSelection(selection); check(model, part)
    model.mirrorSelection(selection, 'z'); check(model, part)
  })
  it('连续框边、支撑删除和恢复、同数量移动均与全枚举一致', () => {
    const fixture = createConfirmedComponentFixture('lattice'), original = fixture.model.toJSON(), part = fixture.part as Part
    const variants = [original, { ...original, tubes: original.tubes.filter((t: Part) => t.id !== part.supportTubes[0]) },
      { ...original, nodes: original.nodes.map((n: Part, i: number) => i === 0 ? { ...n, x: n.x + 8 } : n) },
      { ...original, tubes: [...original.tubes].reverse() }]
    for (const data of variants) {
      const model = new BuildModel(); model.loadJSON(data)
      check(model, model.fittings.get(part.id)!)
    }
  })
  it('位置容差、固定点损坏、四边相同但姿态不同保持原结论', () => {
    const { model, part } = createConfirmedComponentFixture('lattice')
    for (const dx of [0, .099, .101, .999, 1.001, 40]) check(model, { ...part, x: part.x + dx })
    check(model, { ...part, mounts: part.mounts.map((m: Part, i: number) => i === 0 ? { ...m, t: m.t + .01 } : m) })
    check(model, { ...part, quat: [0, 0, 0, 1] })
    check(model, { ...part, panelId: 'lattice' })
  })
  it('附近和远处另加框架、重合管与不同插入顺序不改变候选去重语义', () => {
    const { model, part } = createConfirmedComponentFixture('lattice')
    const other = createConfirmedComponentFixture('lattice', { offset: [1000, 0, 0] })
    const original = model.toJSON()
    const variants = [
      { ...original, tubes: [...original.tubes, { ...original.tubes[0], id: 'tDuplicate' }] },
      { ...original, tubes: [{ ...original.tubes[0], id: 'tDuplicate' }, ...original.tubes] },
    ]
    for (const data of variants) { const next = new BuildModel(); next.loadJSON(data); check(next, next.fittings.get(part.id)!) }
    model.insertFragment(other.model.extractSelection(new Map([...other.model.nodes.keys()].map(id => [id, 'node']))), [1000, 2.5, 0])
    check(model, part)
  })
})
