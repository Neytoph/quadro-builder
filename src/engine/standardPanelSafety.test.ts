import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { confirmedSpec } from './componentPack.js'
import { computeSafety, computeMetrics } from './safety.js'

beforeAll(async () => { await loadCatalog() })
const STANDARD = ['panel_40x40', 'panel_40x20', 'panel_30x30', 'hole_panel_40x40']
const RULES = new Set(['deck_edges', 'entrapment', 'level_gap', 'fall_height', 'anchoring', 'railing'])

function platform(panelId: string) {
  const model = new BuildModel(), spec = confirmedSpec(panelId)!
  const w = spec.width, h = spec.height, points = [[0,82.5,0],[w,82.5,0],[w,82.5,h],[0,82.5,h]]
  const top = points.map(p => model.addNode(p[0], p[1], p[2]))
  const perimeter = top.map((a, i) => {
    const b = top[(i + 1) % 4], span = Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z)
    return model.addTube(a.id, b.id, ({20:'T15',30:'T25',40:'T35'} as Record<number,string>)[span], 'green', span-5)!
  })
  for (const p of points) {
    const ground = model.addNode(p[0], 2.5, p[2]), upper = model.findNodeNear(p[0], p[1], p[2])!
    expect(model.addTube(ground.id, upper.id, 'T75', 'green', 75)).toBeTruthy()
  }
  const candidate = model.panelAccessoryMounts(panelId).find((p: any) => model.panelCorners(p)?.every(c => c[1] === 82.5))!
  expect(candidate).toBeTruthy()
  const part = model.addConfirmedComponent(candidate, 'blue') as any
  expect(part).toBeTruthy(); expect(part.appearanceVersion).toBe(2)
  return { model, part, perimeter }
}

function readPair(data: any) {
  const current = new BuildModel(), old = new BuildModel(), legacy = structuredClone(data)
  // 同一实际安装框及板，仅去掉外观版本，复现旧板的安全分类。
  for (const panel of legacy.panels) delete panel.appearanceVersion
  expect(current.loadJSON(data).ok).toBe(true); expect(old.loadJSON(legacy).ok).toBe(true)
  return { current, old }
}
const risks = (model: BuildModel) => computeSafety(model, { indoor: true }).findings.filter(f => RULES.has(f.rule))

describe('官方标准板保留既有安全检查角色', () => {
  it.each(STANDARD)('%s 新v2与旧板相同高框的站立、落差、护栏、固定及地面提示一致', id => {
    const { model, part } = platform(id), { current, old } = readPair(model.toJSON())
    expect(confirmedSpec(id)!.verifiedLoad).toBe(false)
    expect(computeSafety(current, { indoor: true }).height).toBe(80)
    expect(computeSafety(current, { indoor: true }).height).toBe(computeSafety(old, { indoor: true }).height)
    expect(computeMetrics(current)).toEqual(computeMetrics(old))
    expect(risks(current)).toEqual(risks(old))
    for (const rule of ['level_gap','anchoring','railing']) {
      const finding = risks(current).find(f => f.rule === rule)!
      expect(finding).toBeTruthy(); expect(finding.ids.panels).toContain(part.id)
    }
    expect(risks(current).find(f => f.rule === 'fall_height')?.params).toEqual({ h:80, band:'soil', indoor:true })
    expect(risks(current).some(f => f.rule === 'deck_edges')).toBe(false)
  })

  it.each(STANDARD)('%s 损坏实际存档缺一横边，新旧均保留deck_edges风险', id => {
    const { model, part, perimeter } = platform(id), data = model.toJSON()
    // 基于已安装的实际JSON移除非a/b横边，模拟损坏保存；不是一次合法安装。
    const missing = perimeter.find(t => t.id !== part.a && t.id !== part.b)!
    data.tubes = data.tubes.filter(t => t.id !== missing.id)
    const { current, old } = readPair(data)
    expect(current.panels.has(part.id)).toBe(true)
    expect(risks(current)).toEqual(risks(old))
    const finding = risks(current).find(f => f.rule === 'deck_edges')!
    expect(finding.ids.panels).toEqual([part.id]); expect(finding.params.edges).toBe(1)
    expect(computeSafety(current).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
  })

  it('官方半板真实覆盖高处40×20开口，新旧均不误报entrapment', () => {
    const { model } = platform('panel_40x20'), { current, old } = readPair(model.toJSON())
    expect(risks(current).some(f => f.rule === 'entrapment')).toBe(false)
    expect(risks(current)).toEqual(risks(old))
    current.panels.clear()
    expect(computeSafety(current).findings.some(f => f.rule === 'entrapment')).toBe(true)
  })

  it.each(['acrylic_panel_40x40','acrylic_hole_panel_40x40','acrylic_platform_40x40','panel_40x40_lego','panel_40x40_honeycomb','panel_40x40_basin','panel_40x40_sensory'])('%s 扩展水平设计保持非站立面，框架坠落高度检查仍保留', id => {
    const { model } = platform(id), result = computeSafety(model, { indoor: true })
    expect(result.findings.some(f => ['deck_edges','level_gap','anchoring','railing'].includes(f.rule))).toBe(false)
    expect(result.findings.some(f => f.rule === 'accessory_load')).toBe(true)
    expect(result.findings.find(f => f.rule === 'fall_height')?.params.h).toBe(80)
    expect(confirmedSpec(id)!.verifiedLoad).toBe(false)
  })

  it('新透明小板不替代可靠开口覆盖，保留entrapment提示', () => {
    const { model } = platform('acrylic_panel_40x20')
    expect(computeSafety(model).findings.some(f => f.rule === 'entrapment')).toBe(true)
    expect(computeSafety(model).findings.some(f => f.rule === 'anchoring')).toBe(false)
  })
})
