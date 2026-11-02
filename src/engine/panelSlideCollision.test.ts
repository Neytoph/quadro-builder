import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { screenshotFrame } from '../../scripts/panel-mount-conflict-frame.js'
import { Builder } from './builder.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

describe('滑梯与平台板安装顺序', () => {
  it.each(['slide2', 'slide-new2', 'slide-domestic60', 'curved-slide2'])('%s 入口后方的板子可在滑梯之后安装', kind => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [60, 42.5, 20])!
    expect(probe.valid).toBe(true)
    const slide = model.addSlide([80, 42.5, 20], [1, 0, 0], kind)!
    expect(model.confirmedDiagnostics(probe), JSON.stringify({ slide, result: model.confirmedDiagnostics(probe) })).toMatchObject({ valid: true })
    expect(model.addConfirmedComponent(probe, 'green')).toBeTruthy()
  })
  it('朝滑梯方向的板子仍被拦截', () => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [60, 42.5, 20])!
    const slide = model.addSlide([40, 42.5, 20], [1, 0, 0], 'slide2')!
    expect(model.confirmedDiagnostics(probe)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: slide.id } })
  })
  it('滑梯入口附近的竖板不会被错误放行', () => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [80, 62.5, 20])!
    const slide = model.addSlide([80, 42.5, 20], [1, 0, 0], 'slide2')!
    expect(model.confirmedDiagnostics(probe)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: slide.id } })
  })
  it('板子工具通过实际安装流程放下板子并可撤销', () => {
    const { model, candidate } = screenshotFrame()
    const probe = candidate('panel_40x40', [60, 42.5, 20])!
    model.addSlide([80, 42.5, 20], [1, 0, 0], 'slide2')
    const notices: string[] = []
    const builder = Object.assign(Object.create(Builder.prototype), {
      model, panelId: 'panel_40x40', mode: 'panel', color: 'green', selection: new Map(),
      history: new ModelHistory(docFromJSON(model.toJSON())),
      scene: { cameraPosition: () => [60, 150, 20], clearInstallationPreview: () => {} },
      refresh: () => {}, onNotice: (message: string) => notices.push(message),
    })
    builder._placePanelOnRails(probe.a, probe.b, probe.t0, probe.len)
    expect(model.panels.size, notices.join(' ')).toBe(1)
    expect(builder.installationPreview).toBeNull()
    builder.history.undo()
    expect(builder.history.toJSON().panels).toHaveLength(0)
  })
})
