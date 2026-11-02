import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'
import { componentMountsValid, componentObstacle } from './accessoryPack.js'

beforeAll(async () => { await loadCatalog() })

describe('软装不参与放置冲突检查', () => {
  it.each(['lattice', 'lattice_curved', 'trampoline', 'textile', 'textile_long', 'textile_round', 'textile_round_fourway', 'textile_bridge', 'rope'])('%s 同一位置可重复安装，保存重开保留独立零件', partId => {
    const { model, candidate, part } = createConfirmedComponentFixture(partId)
    const second = model.addConfirmedComponent(candidate, 'green')!
    expect(second).toBeTruthy()
    expect(second.id).not.toBe(part.id)
    expect(componentObstacle(model, part)).toBeNull()
    expect(model.confirmedDiagnostics(part).valid).toBe(true)
    expect(model.confirmedDiagnostics(second).valid).toBe(true)
    expect(model.confirmedMounts(partId).some(p => p.valid)).toBe(true)
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON().fittings).toHaveLength(saved.fittings.length)
    for (const p of saved.fittings) expect(reopened.fittings.get(p.id)).toMatchObject(p)
    for (const p of reopened.fittings.values()) expect(componentMountsValid(reopened, p)).toBe(true)
    // 放置自由不取消真实承载引用；拆掉承载管仍移除失去支撑的软装。
    model.removeTube(second.supportTubes[0])
    expect(model.fittings.has(second.id)).toBe(false)
  })

  it.each(['panel_40x40', 'hole_panel_40x40'])('蹦床与相邻%s 共边时不占用板件固定点', panelId => {
    for (const softFirst of [true, false]) {
      const model = createDirectInstallationFrame(80, 40)
      const a = model.findNodeNear(40, 42.5, 0)!, b = model.findNodeNear(40, 42.5, 40)!
      const sharedEdge = model.addTube(a.id, b.id, 'T35', 'green', 35)!
      expect(sharedEdge).toBeTruthy()
      const trampoline = model.confirmedMounts('trampoline').find(p => p.valid && p.params.width === 40 && p.params.height === 40)!
      expect(trampoline.supportTubes).toContain(sharedEdge.id)
      if (softFirst) expect(model.addConfirmedComponent(trampoline, 'black')).toBeTruthy()
      // 同一板面有多个固定方向；保留候选方向，明确选择使用共边管的一组。
      const panel = model.confirmedMounts(panelId, { deduplicate: false }).find(p =>
        p.supportTubes.includes(sharedEdge.id) &&
        Math.abs(Math.abs(p.pos[0] - trampoline.pos[0]) - 40) < 0.01 &&
        Math.abs(p.pos[1] - trampoline.pos[1]) < 0.01 && Math.abs(p.pos[2] - trampoline.pos[2]) < 0.01)!
      expect(panel).toBeTruthy()
      expect(panel.valid).toBe(true)
      expect(panel.mounts.some((mount: {tube: string}) => mount.tube === sharedEdge.id)).toBe(true)
      expect(trampoline.mounts.some((mount: {tube: string}) => mount.tube === sharedEdge.id)).toBe(true)
      expect(panelId === 'panel_40x40' ? model.addNativePanel(panel, 'blue') : model.addConfirmedComponent(panel, 'blue')).toBeTruthy()
      if (!softFirst) expect(model.addConfirmedComponent(trampoline, 'black')).toBeTruthy()
      expect(model.addNativePanel({ ...panel, panelId: 'panel_40x40' }, 'green')).toBeNull()
    }
  })

  it('普通板与网、布面可按任一顺序重叠安装，硬板重复仍拒绝', () => {
    for (const softFirst of [true, false]) {
      const model = createDirectInstallationFrame(40, 40)
      const panel = model.confirmedMounts('panel_40x40').find(p => p.valid)!
      const net = model.confirmedMounts('lattice').find(p => p.valid)!
      const installPanel = () => model.addNativePanel(panel, 'blue')
      const installNet = () => model.addConfirmedComponent(net, 'green')
      expect(softFirst ? installNet() : installPanel()).toBeTruthy()
      expect(softFirst ? installPanel() : installNet()).toBeTruthy()
      expect(model.addTextile(panel.a, panel.b, panel.t0, panel.len, 'red')).toBeTruthy()
      expect(model.addNativePanel(panel, 'blue')).toBeNull()
    }
  })

  it('旧版布面、攀爬网和玩具袋允许重复；普通板不会被旧布面占用', () => {
    const model = createDirectInstallationFrame(40, 40)
    const panel = model.confirmedMounts('panel_40x40').find(p => p.valid)!
    for (let i = 0; i < 2; i++) {
      expect(model.addTextile(panel.a, panel.b, panel.t0, panel.len, 'red')).toBeTruthy()
      expect(model.addLattice(panel.a, panel.b, panel.t0, panel.len, 'green')).toBeTruthy()
      expect(model.addBag(panel.a, panel.b, panel.t0, panel.len, 'yellow')).toBeTruthy()
    }
    expect(model.sectionFree('lattice2', panel.a, panel.b, panel.t0, panel.len)).toBe(true)
    expect(model.sectionFree(null, panel.a, panel.b, panel.t0, panel.len)).toBe(true)
    expect(model.addNativePanel(panel, 'blue')).toBeTruthy()
  })

  it('硬质部件体积和固定点冲突仍拦截，软装尺寸与框架检查仍有效', () => {
    const { model, candidate, part } = createConfirmedComponentFixture('panel_40x40_climbing')
    expect(model.addConfirmedComponent(candidate, 'green')).toBeNull()
    expect(model.confirmedDiagnostics(candidate).valid).toBe(false)
    expect(model.confirmedDiagnostics({ ...part, id: undefined }).obstacle?.id).toBe(part.id)
    const empty = new BuildModel()
    expect(empty.confirmedMounts('lattice')).toEqual([])
    expect(empty.addConfirmedComponent({ kind: 'lattice', supportTubes: [], mounts: [] }, 'green')).toBeNull()
  })
})
