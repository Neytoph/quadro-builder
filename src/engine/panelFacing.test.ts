import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Builder } from './builder.js'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { componentFrame } from './accessoryPack.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON, type ModelJSON } from '../collab/ymodel'
import { setLang } from './i18n.js'
import { screenshotFrame } from '../../scripts/panel-mount-conflict-frame.js'

beforeAll(async () => { await loadCatalog() })
beforeEach(() => setLang('zh'))

function setup(deck = false, camera = [20, 62.5, 150]) {
  const { model, candidate } = screenshotFrame()
  if (deck) expect(model.addNativePanel(candidate('panel_40x40', [20, 42.5, 20]), 'green')).toBeTruthy()
  const notices: string[] = []
  // 隔离控制器调度，使用真实模型、诊断及 Yjs 历史；WebGL 另行检查。
  const builder = Object.assign(Object.create(Builder.prototype), {
    model, history: new ModelHistory(docFromJSON(model.toJSON() as ModelJSON)),
    scene: { cameraPosition: () => camera, clearInstallationPreview: () => {} },
    selection: new Map(), color: 'green', mode: 'panel', refresh: () => {},
    onNotice: (message: string) => notices.push(message),
  }) as Builder
  return { model, candidate, builder, notices }
}

describe('单面板件安装朝向', () => {
  it.each([150, -150])('无障碍时攀岩面朝向当前视角，z=%s', z => {
    const { model, candidate, builder, notices } = setup(false, [20, 62.5, z])
    setLang('zh')
    expect(builder._previewInstallation(candidate('panel_40x40_climbing', [20, 62.5, 0]), 'panel_40x40_climbing')).toBe(true)
    const part = [...model.panels.values()][0]!
    expect(componentFrame(model, part)!.axes[2][2] * z).toBeGreaterThan(0)
    expect(notices.at(-1)).toBe('配件已安装。')
  })

  it.each(['zh', 'en', 'de'])('平台挡住近侧时自动选用另一朝向并说明重叠，%s', lang => {
    const { model, candidate, builder, notices } = setup(true)
    setLang(lang)
    const probe = candidate('panel_40x40_climbing', [20, 62.5, 0])!
    expect(probe.valid).toBe(true)
    expect(builder._previewInstallation(probe, 'panel_40x40_climbing')).toBe(true)
    const part = [...model.panels.values()].find(p => p.panelId === 'panel_40x40_climbing')!
    expect(componentFrame(model, part)!.axes[2][2]).toBeLessThan(0)
    const messages = { zh: ['已自动改变朝向','重叠'], en: ['automatically changed','overlap'], de: ['automatisch geändert','überlapp'] }
    for (const text of messages[lang as keyof typeof messages]) expect(notices.at(-1)).toContain(text)
    const saved = model.toJSON(), axes = componentFrame(model, part)!.axes
    builder.cancelInstallation()
    expect(model.toJSON()).toEqual(saved)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(componentFrame(reopened, reopened.panels.get(part.id)!)!.axes).toEqual(axes)
    expect(JSON.stringify(saved)).not.toContain('facingConflict')
    builder.history.undo()
    expect(builder.history.toJSON().panels).toHaveLength(1)
    expect(builder.history.canUndo()).toBe(false)
    setLang('zh')
  })

  it('两侧都被占用时拦截，不能写入攀岩板或提示安装成功', () => {
    const { model, candidate, builder, notices } = setup(true)
    // 在另一侧真实搭出同高度框格并装板。
    const node = (x: number, y: number, z: number) => model.findNodeNear(x, y, z) || model.addNode(x, y, z)
    for (const [a, b] of [ [[0,42.5,0],[0,42.5,-40]], [[40,42.5,0],[40,42.5,-40]], [[0,42.5,-40],[40,42.5,-40]] ]) {
      expect(model.addTube(node(...a as [number,number,number]).id, node(...b as [number,number,number]).id, 'T35', 'blue', 35)).toBeTruthy()
    }
    expect(model.addNativePanel(candidate('panel_40x40', [20,42.5,-20]), 'red')).toBeTruthy()
    const probe = model.confirmedMounts('panel_40x40_climbing').find(p => p.pos && Math.hypot(...p.pos.map((v: number, i: number) => v - [20,62.5,0][i])) < .1)!
    builder._previewInstallation(probe, 'panel_40x40_climbing')
    expect([...model.panels.values()].some(p => p.panelId === 'panel_40x40_climbing')).toBe(false)
    expect(builder.installationPreview!.valid).toBe(false)
    expect(notices.at(-1)).toContain('重叠')
  })
})
