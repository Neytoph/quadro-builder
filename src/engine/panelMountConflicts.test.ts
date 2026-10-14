import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { installationReason } from './installationReason.js'
import { setLang } from './i18n.js'
import { screenshotFrame } from '../../scripts/panel-mount-conflict-frame.js'

beforeAll(async () => { await loadCatalog() })

describe('普通板共边安装', () => {
  it.each(['panel_40x40', 'hole_panel_40x40'])('截图结构的三个空框可逐块安装%s，共边竖板不误占平台固定点', panelId => {
    const { model, candidate } = screenshotFrame()
    const back = model.confirmedDiagnostics({ ...candidate('panel_40x40_climbing', [20, 62.5, 0]), side: -1 })
    expect(back?.valid, JSON.stringify(back)).toBe(true)
    expect(model.addConfirmedComponent(back, 'yellow')).toBeTruthy()
    for (const pos of [[20, 42.5, 20], [60, 42.5, 20], [20, 42.5, 60]]) {
      const probe = candidate(panelId, pos)
      expect(probe, JSON.stringify({ pos, reason: probe?.reason })).toBeTruthy()
      expect(probe.valid, JSON.stringify({ pos, reason: probe.reason, obstacle: probe.obstacle })).toBe(true)
      expect(panelId === 'panel_40x40' ? model.addNativePanel(probe, 'green') : model.addConfirmedComponent(probe, 'green')).toBeTruthy()
    }
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
    for (const part of reopened.panels.values()) expect(reopened.confirmedDiagnostics(part).valid).toBe(true)
  })

  it.each(['double_tube', 'tube_clamp'])('%s 本身不阻止普通板安装', connectorId => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [20, 42.5, 20])
    const mount = probe.mounts[0], rail = model._rail(mount.tube)!
    const pos = rail.p0.map((v: number, i: number) => v + rail.dir[i] * rail.len * mount.t)
    const clamp = model.addClamp(pos[0], pos[1], pos[2], connectorId)
    clamp.dir = rail.dir; clamp.off = [0, -5, 0]
    expect(model.confirmedDiagnostics(probe).valid).toBe(true)
    expect(model.addNativePanel(probe, 'green')).toBeTruthy()
  })

  it('朝平台内侧的攀爬板仍提示具体板面重叠原因', () => {
    const { model, candidate } = screenshotFrame()
    const back = model.addConfirmedComponent(candidate('panel_40x40_climbing', [20, 62.5, 0]), 'yellow')!
    const blocked = candidate('panel_40x40', [20, 42.5, 20])
    expect(blocked).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: back.id } })
    setLang('zh')
    expect(installationReason(model, blocked)).toContain('攀岩板')
    expect(installationReason(model, blocked)).toContain('重叠')
    expect(model.addNativePanel(blocked, 'green')).toBeNull()
  })

  it.each(['zh', 'en', 'de'])('软包真实占用提示部件名称、管件和距离，语言=%s', lang => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [20, 42.5, 20]), mount = probe.mounts[0]
    const fitting = Object.assign(model.addFitting('sleeve', 20, 42.5, 0), { tube: mount.tube })
    const blocked = model.confirmedDiagnostics(probe)
    expect(blocked).toMatchObject({ reason: 'mount_occupied', obstacle: { id: fitting.id, tube: mount.tube, t: mount.t } })
    setLang(lang)
    const message = installationReason(model, blocked)!
    // 40cm节点间距含两端各2.5cm接头；固定点距35cm管材实际端部1.5cm。
    expect(message).toContain('1.5 cm')
    expect(message).toContain('35')
    expect(message).not.toContain('accessory_')
    expect(model.addNativePanel(probe, 'green')).toBeNull()
    setLang('zh')
  })

  it('重复开口、穿过板中央的管件仍拦截并说明障碍', () => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [60, 42.5, 20])
    const panel = model.addNativePanel(probe, 'green')!
    expect(model.confirmedDiagnostics(probe).obstacle?.id).toBe(panel.id)
    expect(installationReason(model, model.confirmedDiagnostics(probe))).toContain('板')
    model.removePanel(panel.id)
    const a = model.addNode(60, 22.5, 20), b = model.addNode(60, 62.5, 20)
    const tube = model.addTube(a.id, b.id, 'T35', 'green', 35)!
    const blocked = model.confirmedDiagnostics(probe)
    expect(blocked).toMatchObject({ reason: 'component_space', obstacle: { kind: 'tube', id: tube.id } })
    expect(installationReason(model, blocked)).toContain('35')
  })
})
