import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { buildQDF } from './qdfexport.js'
import { computeBOM } from './bom.js'
import { computeBuildPlan } from './buildplan.js'
import { componentKitFields, componentInstallCopy } from './accessoryInfo.js'
import { setLang } from './i18n.js'
import { createOriginalAccessoryExample } from './accessoryExample.js'

beforeAll(async () => { await loadCatalog() })
afterEach(() => { setLang('zh') })

function officialModel() {
  const model = new BuildModel()
  const data = parseQDF(readFileSync('public/qdf/A0001.qdf', 'utf8'), {
    tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
  })
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}

describe('原创组件清单与导出集成', () => {
  it('四件通过真实安装API生成并原生保存重开，清单和安装步骤均完整', () => {
    const model = createOriginalAccessoryExample()
    expect(model.panels.size).toBe(2)
    expect(model.fittings.size).toBe(2)
    const data = model.toJSON()
    const restored = new BuildModel()
    expect(restored.loadJSON(data).ok).toBe(true)
    expect(restored.toJSON()).toEqual(data)
    for (const part of [...restored.panels.values(), ...restored.fittings.values()]) {
      expect(part.appearanceVersion).toBe(1)
      expect(part.mounts).toHaveLength(part.panelId ? 4 : 2)
      expect(part.supportTubes.every((id: string) => restored.tubes.has(id))).toBe(true)
    }
    const bom = computeBOM(restored)
    expect([...bom.panels, ...bom.fittings].filter(row => row.kitContents)).toHaveLength(4)
    expect(bom.screws.some(row => row.id === 'screw_panel')).toBe(false)
    const plan = computeBuildPlan(restored)
    expect(plan.steps.slice(-4).every(step => step.kind === 'accessories')).toBe(true)
    expect(plan.steps.slice(-4).flatMap(step => [...step.panelIds, ...step.fittingIds])).toHaveLength(4)
    expect(buildQDF(restored).warnings).toHaveLength(4)
  })

  it('真实官方旧模型保持清单、步骤和QDF重新导入的板件数量', () => {
    const model = officialModel()
    const originalBOM = computeBOM(model)
    expect(originalBOM.panels.every((row: Record<string, unknown>) => !row.kitContents)).toBe(true)
    expect(computeBuildPlan(model).steps.every((step: Record<string, unknown>) => step.kind !== 'accessories')).toBe(true)
    const out = buildQDF(model)
    expect(out.warnings).toEqual([])
    const copy = new BuildModel()
    copy.loadJSON(parseQDF(out.text, {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    }))
    expect(computeBOM(copy).totals.panels).toBe(originalBOM.totals.panels)
  })

  it('新版忙碌板随附固定夹不重复计标准板螺丝，保留旧板螺丝语义', () => {
    const model = officialModel()
    const panel = [...model.panels.values()][0]
    expect(panel).toBeTruthy()
    // 本检查使用真实官方框架上的隔离兼容件夹具，验证清单契约；安装验收另走真实API。
    panel.panelId = 'panel_40x40_busy'
    const oldBOM = computeBOM(model)
    panel.appearanceVersion = 1
    const newBOM = computeBOM(model)
    expect(newBOM.screws.find((row: { id: string }) => row.id === 'screw_panel')?.count ?? 0)
      .toBe((oldBOM.screws.find((row: { id: string }) => row.id === 'screw_panel')?.count ?? 0) - 4)
    expect(newBOM.panels.find((row: { panelId: string }) => row.panelId === 'panel_40x40_busy')?.kitContents).toContain('4')
    const componentSteps = computeBuildPlan(model).steps.filter((step: { kind: string }) => step.kind === 'accessories')
    expect(componentSteps).toHaveLength(1)
    expect(componentSteps[0].panelIds).toEqual([panel.id])
    expect(componentSteps[0].instructions).toHaveLength(3)
    expect(computeBuildPlan(model).steps.at(-1)).toBeDefined()
    expect(buildQDF(model).warnings).toContainEqual({ code: 'simplified_component', partId: panel.panelId, id: panel.id })
  })

  it('秋千与方向盘被QDF明确列为遗漏，清单和最后安装步骤仍完整', () => {
    const model = officialModel()
    // 使用模型现有管引用构造隔离导出夹具，不作为安装通过证据。
    const tube = [...model.tubes.values()][0]
    for (const kind of ['swing', 'steering_wheel']) {
      const part = model.addFitting(kind, 0, 80, 0) as ReturnType<BuildModel['addFitting']> & {
        tube?: string; appearanceVersion?: number; supportTubes?: string[]
      }
      part.tube = tube.id
      part.appearanceVersion = 1
      part.supportTubes = [tube.id]
    }
    const warnings = buildQDF(model).warnings
    expect(warnings.filter((w: { code: string }) => w.code === 'omitted_accessory').map((w: { partId: string }) => w.partId)).toEqual(['swing', 'steering_wheel'])
    const bom = computeBOM(model)
    expect(bom.fittings.filter((row: { kitContents?: string }) => row.kitContents)).toHaveLength(2)
    const steps = computeBuildPlan(model).steps
    expect(steps.slice(-2).map((step: { kind: string }) => step.kind)).toEqual(['accessories', 'accessories'])
    expect(steps.slice(-2).every((step: { instructions: string[] }) => step.instructions.length === 3)).toBe(true)
  })

  it('三语套装及手册文案完整，混合旧新版数量有明确说明', () => {
    for (const lang of ['zh', 'en', 'de']) {
      setLang(lang)
      for (const id of ['swing', 'steering_wheel', 'panel_40x40_busy', 'panel_40x40_pocket']) {
        const fields = componentKitFields(id, 1, 2)
        expect(fields.kitContents).toContain('1')
        expect(fields.designAssumption).toBe(true)
        expect(fields.loadVerified).toBe(false)
        const info = componentInstallCopy(id)
        expect(info.title).toBeTruthy()
        expect(info.instructions).toHaveLength(3)
      }
    }
  })

  it('对边内嵌螺丝进入真实模型清单与手册，旧记录继续说明原固定方式', () => {
    const model = createOriginalAccessoryExample()
    const panel = [...model.panels.values()].find(part => part.panelId === 'panel_40x40_busy')!
    // 此处仅核验输出契约；实际四点安装由引擎安装测试和独立验收覆盖。
    panel.params = { ...panel.params, mountLayout: 'opposite-transparent-screws' }
    for (const lang of ['zh', 'en', 'de']) {
      setLang(lang)
      const row = computeBOM(model).panels.find(part => part.panelId === panel.panelId)!
      const step = computeBuildPlan(model).steps.find(step => step.panelIds?.includes(panel.id))!
      expect(row.kitContents).toMatch(/透明螺丝|clear screws|transparente Schrauben/)
      expect(step.instructions.join(' ')).toMatch(/对边|opposite|gegenüberliegenden/)
      const old = componentInstallCopy(panel.panelId)
      expect(old.instructions.join(' ')).toMatch(/四角|four corners|vier Ecken/)
      const mixed = componentKitFields(panel.panelId, 2, 2, 1)
      expect(mixed.kitContents).toMatch(/其余保留|other kits retain|übrige Befestigungen/)
    }
  })
})
