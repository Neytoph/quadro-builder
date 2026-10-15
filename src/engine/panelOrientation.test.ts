import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { accessorySpec, componentFrame, componentMountsValid } from './accessoryPack.js'
import { installationReason } from './installationReason.js'
import { getLang, setLang } from './i18n.js'
import { builderComponents, componentHintKey } from '../store/builderComponents'
import { accessoryStrings } from '../ui/accessoryStrings'

beforeAll(async () => { await loadCatalog() })

const panels = ['panel_40x40_capsule', 'panel_40x40_clock', 'panel_40x40_maze', 'panel_40x40_magnet', 'panel_40x40_climbing', 'panel_40x30_climbing', 'panel_40x20_climbing', 'panel_40x40_basketball', 'panel_40x40_felt', 'panel_40x20_castle', 'panel_40x40_busy']

// 隔离框架使用真实模型安装、保存和支撑检查；不代表实物承载验证。
function frame(id: string, angle: number) {
  const spec = accessorySpec(id), model = new BuildModel()
  if (!spec || !('height' in spec) || typeof spec.height !== 'number') throw new Error(`没有板件尺寸：${id}`)
  const points = [[0, 0], [spec.width, 0], [spec.width, spec.height], [0, spec.height]]
  const nodes = points.map(([x, y]) => model.addNode(x, 80 + y * Math.cos(angle), y * Math.sin(angle)))
  const tubes = nodes.map((node, i) => {
    const span = i % 2 ? spec.height : spec.width
    return model.addTube(node.id, nodes[(i + 1) % 4].id, `T${span - 5}`, 'blue', span - 5)!
  })
  return { model, tubes, probe: { a: tubes[0].id, b: tubes[2].id, t0: 0, len: spec.width, panelId: id, side: 1 } }
}

describe('板件安装朝向', () => {
  it.each(panels)('%s 在竖直、倾斜和水平框上实际安装并保存重开', id => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const { model, probe } = frame(id, angle)
      const diagnostic = model.panelAccessoryDiagnostics(probe)
      expect(diagnostic.valid, `${id} ${angle}: ${diagnostic.reason}`).toBe(true)
      const part = model.addPanel(probe.a, probe.b, 0, probe.len, id, 'blue')! as ReturnType<BuildModel['addPanel']> & { supportTubes: string[] }
      expect(part).toBeTruthy()
      expect(componentMountsValid(model, part)).toBe(true)
      const normal = componentFrame(model, part)!.axes[2]
      expect(Math.abs(normal[1])).toBeCloseTo(Math.sin(angle))
      const reopened = new BuildModel()
      expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
      expect(componentMountsValid(reopened, reopened.panels.get(part.id)!)).toBe(true)
      model.removeTube(part.supportTubes![0])
      expect(model.panels.has(part.id)).toBe(false)
    }
  })

  it('放开朝向后仍校验尺寸、螺丝支撑和水平专用部件', () => {
    const capsule = frame('panel_40x40_capsule', Math.PI / 2)
    expect(capsule.model.panelAccessoryDiagnostics({ ...capsule.probe, len: 20 }).reason).toBe('frame_size')
    capsule.model.removeTube(capsule.tubes[1].id)
    expect(capsule.model.panelAccessoryDiagnostics(capsule.probe).reason).toBe('opposite_edges')
    for (const id of ['panel_40x40_basin', 'panel_40x40_sensory', 'acrylic_platform_40x40', 'panel_40x40_pocket']) {
      const vertical = frame(id, 0)
      expect(vertical.model.panelAccessoryDiagnostics(vertical.probe).reason).toBe('horizontal_frame')
    }
  })

  it.each(panels.filter(id => id !== 'panel_40x40_busy'))('%s 旧存档的竖直安装字段保持有效', id => {
    const { model, probe } = frame(id, 0)
    const part = model.addPanel(probe.a, probe.b, 0, probe.len, id, 'blue')! as ReturnType<BuildModel['addPanel']> & { params: { mountType: string; mount: string } }
    part.params.mountType = 'vertical-frame'
    part.params.mount = 'vertical-frame'
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(componentMountsValid(reopened, reopened.panels.get(part.id)!)).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
  })

  it('三语安装提示匹配当前部件及固定边，不串用忙碌板或布兜文案', () => {
    const original = getLang(), { model } = frame('panel_40x40_capsule', 0)
    for (const language of ['zh', 'en', 'de'] as const) {
      setLang(language)
      for (const id of panels) {
        const part = builderComponents().find(part => part.id === id)!
        const key = componentHintKey(part) as keyof typeof accessoryStrings.zh
        expect(accessoryStrings[language][key]).not.toMatch(/竖直|vertical|senkrecht/)
      }
      expect(installationReason(model, { reason: 'horizontal_frame' })).not.toMatch(/布兜|pocket|Stofftasche/)
      expect(installationReason(model, { reason: 'frame_size' })).not.toMatch(/40/)
      expect(installationReason(model, { reason: 'opposite_edges' })).not.toMatch(/左右|side edges/)
    }
    setLang(original)
  })
})
