import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { componentFrame, componentMountsValid } from './accessoryPack.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { accessorySpec } from './accessoryPack.js'
import { Builder } from './builder.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON, type ModelJSON } from '../collab/ymodel'
import { getLang, setLang } from './i18n.js'
import { panelInstallationFacing } from './panelInstallationFacing.js'

beforeAll(async () => { await loadCatalog() })
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0)

// 隔离真实框架，固定点与翻面均调用正式模型API。
function frame(id: string, angle = Math.PI / 2, baseY = 80) {
  const spec = accessorySpec(id), model = new BuildModel()
  if (!spec || !('height' in spec) || typeof spec.height !== 'number') throw new Error(`板件尺寸缺失：${id}`)
  const nodes = [[0, 0], [spec.width, 0], [spec.width, spec.height], [0, spec.height]]
    .map(([x, y]) => model.addNode(x, baseY + y * Math.cos(angle), y * Math.sin(angle)))
  const tubes = nodes.map((node, i) => {
    const other = nodes[(i + 1) % 4], length = i % 2 ? spec.height : spec.width
    if (length === 60) {
      const middle = model.addNode((node.x + other.x) / 2, (node.y + other.y) / 2, (node.z + other.z) / 2)
      const first = model.addTube(node.id, middle.id, 'T25', 'blue', 25)!
      model.addTube(middle.id, other.id, 'T25', 'blue', 25)
      return first
    }
    return model.addTube(node.id, other.id, `T${length - 5}`, 'blue', length - 5)!
  })
  const part = model.addPanel(tubes[0].id, tubes[2].id, 0, spec.width, id, 'blue')!
  expect(part).toBeTruthy()
  return { model, part }
}

function controller(model: BuildModel) {
  const notices: string[] = [], history = new ModelHistory(docFromJSON(model.toJSON() as ModelJSON))
  history.onExternal(() => { expect(model.loadJSON(history.toJSON()).ok).toBe(true) })
  // 仅隔离界面呈现，历史、模型和冲突检查均使用正式实现。
  const builder = Object.assign(Object.create(Builder.prototype), { model, history, readOnly: false, onNotice: (message: string) => notices.push(message) }) as Builder
  return { builder, history, notices }
}

describe('已安装板件实际翻面', () => {
  it.each(CONFIRMED_COMPONENTS.filter(spec => spec.placement === 'panel').map(spec => spec.id))('%s 翻面改变真实法向，保存重开及再次翻面一致', id => {
    const { model, part } = createConfirmedComponentFixture(id)
    const before = componentFrame(model, part)!, saved = model.toJSON()
    expect(model.flipPanelSide(part.id)).not.toBeNull()
    const after = componentFrame(model, part)!
    expect(dot(after.axes[2], before.axes[2])).toBeCloseTo(-1)
    expect(componentMountsValid(model, part)).toBe(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(componentFrame(reopened, reopened.panels.get(part.id)!)!.axes).toEqual(after.axes)
    expect(model.flipPanelSide(part.id)).not.toBeNull()
    expect(componentFrame(model, part)!.axes).toEqual(before.axes)
    expect(model.toJSON()).toEqual(saved)
  })

  it.each([...CONFIRMED_COMPONENTS.filter(spec => spec.placement === 'panel').map(spec => spec.id), 'panel_40x40_busy'])('%s 水平框上的翻面改变真实法向及固定点验证', id => {
    const { model, part } = frame(id), before = componentFrame(model, part)!
    expect(model.flipPanelSide(part.id)).not.toBeNull()
    const after = componentFrame(model, part)!
    expect(dot(after.axes[2], before.axes[2])).toBeCloseTo(-1)
    expect(componentMountsValid(model, part)).toBe(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(componentFrame(reopened, reopened.panels.get(part.id)!)!.axes).toEqual(after.axes)
  })

  it.each([0, Math.PI / 4, Math.PI / 2])('太空舱翻面、再次翻面及真实Yjs撤销重做 angle=%s', angle => {
    const { model, part } = frame('panel_40x40_capsule', angle), saved = model.toJSON(), before = componentFrame(model, part)!.axes
    const { builder, history } = controller(model)
    expect(builder._flipPanel(part.id)).toBe(true)
    expect(dot(componentFrame(model, part)!.axes[2], before[2])).toBeCloseTo(-1)
    const flipped = model.toJSON()
    history.undo(); expect(history.toJSON()).toEqual(saved)
    history.redo(); expect(history.toJSON()).toEqual(flipped)
    expect(builder._flipPanel(part.id)).toBe(true)
    expect(model.toJSON()).toEqual(saved)
    history.destroy()
  })

  it('翻面受管子阻挡时保持原状态和历史，并给出三语具体原因', () => {
    const original = getLang()
    for (const language of ['zh', 'en', 'de'] as const) {
      setLang(language)
      const { model, part } = frame('panel_40x40_capsule')
      const a = model.addNode(0, 70, 20), b = model.addNode(40, 70, 20)
      model.addTube(a.id, b.id, 'T35', 'red', 35)
      const before = model.toJSON(), { builder, history, notices } = controller(model)
      expect(builder._flipPanel(part.id)).toBe(false)
      expect(model.toJSON()).toEqual(before); expect(history.canUndo()).toBe(false)
      expect(notices.at(-1)).toMatch(language === 'zh' ? /无法翻面.*管/ : language === 'en' ? /Cannot flip.*[Tt]ube/ : /nicht umgedreht.*Rohr/)
      history.destroy()
    }
    setLang(original)
  })

  it('水平太空舱安装时可朝向框架下方的视角', () => {
    const { model, part } = frame('panel_40x40_capsule')
    model.removePanel(part.id)
    const candidate = model.panelAccessoryDiagnostics(part)
    const result = panelInstallationFacing(model, candidate, [20, 40, 20])
    expect(result.part.valid).toBe(true)
    expect(componentFrame(model, result.part)!.axes[2][1]).toBeLessThan(0)
  })

  it('布兜不能翻面时说明开口方向，不写入历史', () => {
    const original = getLang(); setLang('zh')
    const { model, part } = frame('panel_40x40_pocket'), saved = model.toJSON(), { builder, history, notices } = controller(model)
    expect(builder._flipPanel(part.id)).toBe(false)
    expect(model.toJSON()).toEqual(saved); expect(history.canUndo()).toBe(false)
    expect(notices.at(-1)).toContain('开口朝上')
    history.destroy(); setLang(original)
  })

  it('贴地太空舱翻面会穿地时模型和点击入口共同拦截，保留原状态', () => {
    const original = getLang(); setLang('zh')
    const { model, part } = frame('panel_40x40_capsule', Math.PI / 2, 8), saved = model.toJSON(), { builder, history, notices } = controller(model)
    expect(model.panelFlipDiagnostics(part.id).reason).toBe('ground_clearance')
    expect(model.flipPanelSide(part.id)).toBeNull()
    expect(builder._flipPanel(part.id)).toBe(false)
    expect(model.toJSON()).toEqual(saved); expect(history.canUndo()).toBe(false)
    expect(notices.at(-1)).toContain('碰到地面')
    history.destroy(); setLang(original)
  })
})
