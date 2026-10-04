import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BuildModel } from './model.js'
import { loadCatalog, geometry, panels, buildableTubes, getTube } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeBuildPlan } from './buildplan.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { setLang } from './i18n.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { confirmedSpec } from './componentPack.js'
import { officialColorId } from './colors.js'

beforeAll(async () => { await loadCatalog() })
afterEach(() => { setLang('zh') })

// 独立真实框架，用正式安装API验证清单/手册/QDF，不伪造配件记录。
function frame(height = 40) {
  const model = new BuildModel(), points = new Map<string, any>()
  const node = (x: number, y: number) => {
    const key = `${x},${y}`
    if (!points.has(key)) points.set(key, model.addNode(x, y + 2.5, 0))
    return points.get(key)
  }
  const tube = (x: number, y: number, xx: number, yy: number) => {
    const a = node(x, y), b = node(xx, yy), length = Math.hypot(xx - x, yy - y)
    const id = length === 20 ? 'T15' : length === 30 ? 'T25' : 'T35'
    expect(model.addTube(a.id, b.id, id, 'yellow', getTube(id).length_cm)).toBeTruthy()
  }
  tube(0, 0, 40, 0)
  for (const x of [0, 40]) {
    tube(x, 0, x, 40)
    tube(x, 40, x, 40 + height)
  }
  tube(0, 40, 40, 40)
  tube(0, 40 + height, 40, 40 + height)
  return model
}

describe('确认配件的真实清单、手册和格式转换', () => {
  it('旧v2攀岩存档保留原始记录，清单和导出采用当前实际固定色', () => {
    const { model, part } = createConfirmedComponentFixture('panel_40x20_climbing')
    // 从真实安装存档派生上一版颜色记录，验证外观更新不会改写原生数据。
    const saved = model.toJSON() as any
    saved.panels.find((p: any) => p.id === part.id).color = 'blue'
    const reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    const before = reopened.toJSON()
    const color = confirmedSpec('panel_40x20_climbing')!.fixedColor
    for (const lang of ['zh', 'en', 'de']) {
      setLang(lang)
      const row = computeBOM(reopened).panels.find((p: any) => p.panelId === 'panel_40x20_climbing')
      if (!row) throw new Error('旧v2攀岩板清单缺失')
      expect(row.color).toBe(color)
      expect(row.colorName).not.toMatch(/^#/)
      const step = computeBuildPlan(reopened).steps.find((s: any) => s.panelIds?.includes(part.id))
      if (!step) throw new Error('旧v2攀岩板安装步骤缺失')
      expect(step.panels[0].color).toBe(color)
      expect(step.panels[0].colorName).toBe(row.colorName)
    }
    const output = buildQDF(reopened)
    const imported = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    expect(imported.panels[0].color).toBe(officialColorId(color))
    expect(reopened.toJSON()).toEqual(before)
  })
  for (const collection of ['fittings', 'slides'] as const) {
    it(`损坏存档中的未知${collection}不写入无效QDF元素，明确提示遗漏`, () => {
      const { model } = createConfirmedComponentFixture('panel_40x40')
      // 这是未知数据负例，不把它当作真实安装证据。
      const unknown = { id: 'unknown-negative', kind: 'qa_unknown_component', x: 200, y: 100, z: 200, rest: '1, 0' }
      const negative = model.toJSON() as any
      negative[collection].push(unknown)
      const reopened = new BuildModel()
      expect(reopened.loadJSON(negative).ok).toBe(true)
      const output = buildQDF(reopened)
      expect(output.text).not.toContain('qa_unknown_component{')
      expect(output.warnings).toContainEqual(expect.objectContaining({ code: 'omitted_accessory', id: unknown.id }))
      const data = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
      expect(data.stats.skipped).toEqual({})
      expect(data.panels).toHaveLength(1)
    })
  }
  for (const id of ['acrylic_panel_40x20', 'acrylic_panel_40x60']) {
    it(`${id}真实多管框架导出后保持透明材质及尺寸变体`, () => {
      const { model } = createConfirmedComponentFixture(id)
      const output = buildQDF(model)
      const data = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
      expect(data.stats.skipped).toEqual({})
      expect(data.panels).toHaveLength(1)
      expect(data.panels[0].panelId).toBe(id)
    })
  }
  it('真实官方A0043旧轮模型重新导出，轮子不被新版集合遗漏', () => {
    const options = { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }
    const original = parseQDF(readFileSync('public/qdf/A0043.qdf', 'utf8'), options)
    expect(original.tubes.some((p: any) => p.tubeId.startsWith('TA'))).toBe(false)
    const expected = original.fittings.filter((p: any) => p.kind === 'multi-wheel2').length
    expect(expected).toBeGreaterThan(0)
    const model = new BuildModel()
    expect(model.loadJSON(original).ok).toBe(true)
    const output = buildQDF(model)
    expect(output.warnings.some((w: any) => w.partId === 'multi-wheel2')).toBe(false)
    const reopened = parseQDF(output.text, options)
    expect(reopened.fittings.filter((p: any) => p.kind === 'multi-wheel2')).toHaveLength(expected)
  })
  for (const id of ['panel_40x40_capsule', 'panel_40x40_basketball', 'panel_40x40_lego', 'panel_40x40_clock', 'panel_40x40_grid']) {
    it(`${id}原生保留多点引用；QDF按类型提示简化并能解析`, () => {
      const model = frame()
      const candidate = model.confirmedMounts(id).find((p: any) => p.valid)
      expect(candidate, id).toBeTruthy()
      expect(model.addConfirmedComponent(candidate, 'blue')).toBeTruthy()
      const saved = model.toJSON(), reopened = new BuildModel()
      expect(reopened.loadJSON(saved).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(saved)
      const bom = computeBOM(reopened)
      const row = bom.panels.find((p: any) => p.panelId === id)
      if (!row) throw new Error(`清单缺少已安装配件：${id}`)
      expect(row.kitContents).toBeTruthy()
      expect(row.loadVerified).toBe(false)
      expect(row.colorName).not.toMatch(/^#[\da-f]{6}$/i)
      expect(bom.screws.some((p: any) => p.id === 'screw_panel')).toBe(false)
      for (const lang of ['zh', 'en', 'de']) {
        setLang(lang)
        const step = computeBuildPlan(reopened).steps.find((s: any) => s.kind === 'accessories')
        expect(step.panelIds).toHaveLength(1)
        expect(step.instructions).toHaveLength(3)
        expect(step.title).not.toContain('undefined')
      }
      const output = buildQDF(reopened)
      expect(output.warnings).toEqual([expect.objectContaining({ code: 'simplified_component', partId: id })])
      const imported = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
      expect(imported.panels).toHaveLength(1)
      expect(imported.panels[0].panelId).toBe(id)
    })
  }

  for (const [id, height] of [['panel_40x30_climbing', 30], ['panel_40x20_climbing', 20]] as const) {
    it(`${id}导出再读取保持真实尺寸变体`, () => {
      const model = frame(height)
      const mount = model.confirmedMounts(id).find((p: any) => p.valid)
      expect(mount).toBeTruthy()
      expect(model.addConfirmedComponent(mount, 'green')).toBeTruthy()
      const output = buildQDF(model)
      const data = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
      expect(data.panels).toHaveLength(1)
      expect(data.panels[0].panelId).toBe(id)
    })
  }
})
