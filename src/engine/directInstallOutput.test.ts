import { beforeAll, afterEach, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeBuildPlan } from './buildplan.js'
import { componentInstallCopy } from './accessoryInfo.js'
import { collectPositions, coverItems, stepItems } from './assemblyManual.js'
import { buildQDF } from './qdfexport.js'
import { setLang } from './i18n.js'
import { asBom } from '../store/EngineContext'
import { bomToCsv } from '../ui/bomExport'
import { accessoryStrings } from '../ui/accessoryStrings'

beforeAll(async () => { await loadCatalog() })
afterEach(() => setLang('zh'))

// 通过正式节点、管件和安装 API 构造隔离框架，核验尺寸输出与原生保存。
function frame(model: any, width: number, height: number, offset: number) {
  const nodes = new Map<string, any>()
  const node = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`
    if (!nodes.has(key)) nodes.set(key, model.addNode(x + offset, y, z))
    return nodes.get(key)
  }
  const tube = (a: number[], b: number[]) => {
    const na = node(a[0], a[1], a[2]), nb = node(b[0], b[1], b[2])
    expect(model.addTube(na.id, nb.id, 'T35', 'green', 35)).toBeTruthy()
  }
  for (const z of [0, height]) for (let x = 0; x < width; x += 40) tube([x, 42.5, z], [x + 40, 42.5, z])
  for (const x of [0, width]) {
    for (let z = 0; z < height; z += 40) tube([x, 42.5, z], [x, 42.5, z + 40])
    for (const z of [0, height]) tube([x, 2.5, z], [x, 42.5, z])
  }
  const candidate = model.confirmedMounts('trampoline').find((p: any) => p.valid && p.w === width && p.h === height && p.x > offset && p.x < offset + width)
  expect(candidate, `${width}×${height}真实候选`).toBeTruthy()
  const part = model.addConfirmedComponent(candidate, 'black')
  expect(part).toBeTruthy()
  return part
}

it('不同尺寸的真实蹦床在三语清单、手册、编号及CSV中分别列出，目录ID仍可查找', () => {
  const model = new BuildModel()
  const parts = [frame(model, 40, 40, 0), frame(model, 40, 80, 200), frame(model, 80, 80, 400)]
  const saved = model.toJSON(), reopened = new BuildModel()
  expect(reopened.loadJSON(saved).ok).toBe(true)
  expect(reopened.toJSON()).toEqual(saved)
  for (const lang of ['zh', 'en', 'de'] as const) {
    setLang(lang)
    const raw = computeBOM(reopened), rows = raw.fittings.filter((r: any) => r.id === 'trampoline')
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r: any) => r.key)).size).toBe(3)
    const bom = asBom(raw)
    const uiRows = [...bom.textiles, ...bom.fittings].filter(r => r.id === 'trampoline')
    expect(new Set(uiRows.map(r => r.key)).size).toBe(3)
    const plan = computeBuildPlan(reopened)
    const cover = coverItems(bom), positions = collectPositions(reopened)
    const csv = bomToCsv({ bom, name: '隔离尺寸验收框架', sizeCm: null, invRows: [], lang, t: key => accessoryStrings[lang][key as keyof typeof accessoryStrings.zh] || key })
    for (const part of parts) {
      const size = `${part.w}×${part.h} cm`
      const row = rows.find((r: any) => r.name.includes(size))
      if (!row) throw new Error(`缺少蹦床清单尺寸：${size}`)
      expect(row.count).toBe(1)
      expect(csv).toContain(size)
      const coverRow = cover.find((r: any) => r.name.includes(size))
      expect(positions.get(coverRow.key)).toHaveLength(1)
      const step = plan.steps.find((s: any) => s.fittingIds?.includes(part.id))
      expect(step.title).toContain(size)
      expect(step.instructions.join(' ')).toContain(size)
      const item = stepItems(reopened, step).find((r: any) => r.id === 'trampoline')
      expect(item.name).toContain(size)
      expect(item.key).toBe(coverRow.key)
    }
  }
  const output = buildQDF(reopened)
  expect(output.warnings.filter((w: any) => w.partId === 'trampoline')).toHaveLength(3)
  expect(reopened.toJSON()).toEqual(saved)
})

it('上下或左右透明螺丝在三语安装说明中明确，旧布局按左右解释', () => {
  for (const lang of ['zh', 'en', 'de'] as const) {
    setLang(lang)
    const labels = { zh: ['上下', '左右'], en: ['top and bottom', 'left and right'], de: ['obere und untere', 'linke und rechte'] }[lang]
    const params = { mountLayout: 'opposite-transparent-screws', screwAxis: 'horizontal' }
    const updated = componentInstallCopy('panel_40x40_busy', { params })
    expect(updated.instructions[0]).toContain(labels[0])
    const old = componentInstallCopy('panel_40x40_busy', { params: { mountLayout: params.mountLayout } })
    expect(old.instructions[0]).toContain(labels[1])
    expect(old.instructions[0]).not.toContain(labels[0])
  }
})
