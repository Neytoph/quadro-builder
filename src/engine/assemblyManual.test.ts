import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeAssemblyPlan, assemblyState } from './assemblyPlan.js'
import { coverItems, numberStepItems, stepItems, assemblyPresentationState, measureManualLegend, manualPartsHeight } from './assemblyManual.js'
import { parseQDF } from './qdfimport.js'
import { partImageSrc } from '../ui/partImages'

type ManualItem = { id: string; key: string; kind: string; num: number }

beforeAll(async () => { await loadCatalog() })
const assetEvidence: any[] = []
afterAll(() => { mkdirSync('.work', { recursive: true }); writeFileSync('.work/assembly-pdf-assets.json', JSON.stringify(assetEvidence, null, 2)) })

describe('说明书材料编号', () => {
  it('C0179预拼页只呈现本模块零件，分开图不制造插接箭头或修改模型状态', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => step.y === 20 && step.action.scope === 'parts' && step.action.type === 'preassemble')
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], before = assemblyState(plan, index, { action: true }), after = assemblyState(plan, index)
    const saved = JSON.stringify(model.toJSON()), originalVisible = [...before.visible]
    const left = assemblyPresentationState(model, plan, step, before), right = assemblyPresentationState(model, plan, step, after)
    expect([...left.visible].sort()).toEqual([...step.action.partIds].sort())
    expect([...right.visible].sort()).toEqual([...step.action.partIds].sort())
    expect(left.arrows).toEqual([])
    for (const id of step.nodeIds) expect(left.transforms.get(id)).toEqual(right.transforms.get(id))
    for (const id of step.tubeIds) expect(left.transforms.get(id)).toEqual(right.transforms.get(id).map((v: number, axis: number) => v + (axis === 1 ? 8 : 0)))
    expect([...before.visible]).toEqual(originalVisible)
    expect(before.hiddenNewParts.size).toBe(step.action.partIds.length)
    expect(JSON.stringify(model.toJSON())).toBe(saved)
  })
  it('C0179 第2步全部7种零件留在步骤页，管35 cm不再单独占页', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const step = computeAssemblyPlan(model).steps[1]
    const items = stepItems(model, step)
    expect(items.length).toBe(7)
    // 隔离排版测试使用固定字宽；实际字体及三语分页另由浏览器导出核验。
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const layout = measureManualLegend(ctx, items, 2450)
    const partsH = manualPartsHeight(ctx, items, 2450)
    expect(layout.height).toBeGreaterThan((47 - 5.2) * 10)
    expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
    expect(210 - 20 - partsH - 3).toBeGreaterThanOrEqual(105)
  })

  it('长德文物料名增加实际行高，大料表仍为组装图保留空间', () => {
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 18 }) }
    const items = Array.from({ length: 20 }, (_, index) => ({ num: index + 1, count: 123, name: 'Sehr lange Materialbezeichnung für ein Verbindungselement mit mehreren Anschlussrichtungen' }))
    const layout = measureManualLegend(ctx, items, 2200)
    expect(layout.wrapped.some((lines: string[]) => lines.length > 1)).toBe(true)
    expect(manualPartsHeight(ctx, items, 2200)).toBe(82)
    expect(manualPartsHeight(ctx, [], 2200)).toBe(47)
  })

  it('C0013 新步骤的加固件完整分配，料表按实际行高留在图示页', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0013.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const groups = plan.steps.map((step: any) => stepItems(model, step)).filter((items: any[]) => items.some(item => item.kind === 'reinforcements'))
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    expect(groups.flat().filter((item: any) => item.kind === 'reinforcements').reduce((sum: number, item: any) => sum + item.count, 0)).toBe(8)
    for (const items of groups) {
      const layout = measureManualLegend(ctx, items, 2450)
      const partsH = manualPartsHeight(ctx, items, 2450)
      expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
      expect(210 - 20 - partsH - 3).toBeGreaterThanOrEqual(85)
    }
  })

  it('s33 两条面板物料不再溢出封面成为稀疏续页', () => {
    const model = new BuildModel()
    model.loadJSON(JSON.parse(readFileSync('public/assembly-fixtures/s33.json', 'utf8')))
    const items = coverItems(computeBOM(model))
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const layout = measureManualLegend(ctx, items, 2450)
    const partsH = manualPartsHeight(ctx, items, 2450, true)
    expect(layout.height).toBeGreaterThan((91 - 5.7) * 10)
    expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
    expect(210 - 16 - partsH - 3).toBeGreaterThanOrEqual(85)
  })
  it('C0005 顶棚安装保留完整支撑框架，供底部视角核对固定杆', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0005.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const cover = plan.regions.find((r: any) => r.accessoryType === 'roof-cover')
    const index = plan.steps.findIndex((s: any) => s.regionId === cover.id && s.action.type === 'attach')
    const support = plan.regions.find((r: any) => r.id === cover.supportRegionId)
    const presented = assemblyPresentationState(model, plan, plan.steps[index], assemblyState(plan, index, { action: false }), { detail: true })
    expect(support.tubeIds.length).toBeGreaterThan(0)
    for (const id of support.tubeIds) expect(presented.visible.has(id)).toBe(true)
    for (const id of cover.slideIds) expect(presented.visible.has(id)).toBe(true)
  })
  it('C0005 滑梯操作仅显示模块与支撑接口，隐藏遮挡板且不修改冻结模型或零件状态', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0005.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => step.action.type === 'attach' && plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'slide')
    expect(index).toBeGreaterThanOrEqual(0)
    const before = JSON.stringify(model.toJSON())
    const state = assemblyState(plan, index, { action: false })
    const original = [...state.visible]
    const presented = assemblyPresentationState(model, plan, plan.steps[index], state, { detail: true })
    expect(presented.contextFiltered).toBe(true)
    expect([...presented.visible].some(id => model.slides.has(id) || model.tubes.has(id))).toBe(true)
    expect([...presented.visible].filter(id => model.panels.has(id)).length).toBeLessThan([...state.visible].filter(id => model.panels.has(id)).length)
    expect([...state.visible]).toEqual(original)
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(plan.ledger.conserved).toBe(true)
  })
  it('s33 说明书不生成固定检查步骤或螺丝位置', () => {
    const model = new BuildModel()
    expect(model.loadJSON(JSON.parse(readFileSync('public/assembly-fixtures/s33.json', 'utf8'))).ok).toBe(true)
    const plan = computeAssemblyPlan(model)
    expect(plan.steps.some((step: any) => step.action.type === 'fix')).toBe(false)
    expect(plan.fixingPoints).toEqual([])
    expect(plan.ledger.conserved).toBe(true)
  })
  it('原始总 BOM 的管件、连接件有图片目录 ID，各步编号沿用全书编号', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0), c = model.addNode(40, 40, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    model.addTube(b.id, c.id, 'T35', 'red', 35)
    const plan = computeAssemblyPlan(model)
    const cover = coverItems(computeBOM(model)) as ManualItem[]
    expect(cover.every(item => item.id && item.key)).toBe(true)
    expect(cover.filter(item => item.kind === 'connectors').every(item => item.key === `connectors:${item.id}`)).toBe(true)
    for (const step of plan.steps) {
      const items = numberStepItems(stepItems(model, step), cover)
      for (const item of items) expect(item.num).toBe(cover.find(row => row.key === item.key)?.num)
    }
  })

  it('缺失总料表的步骤物料明确报错', () => {
    expect(() => numberStepItems([{ key: 'unknown', id: 'unknown', count: 1 }], [])).toThrow('材料未列入总料表')
  })

  it.each(['qdf/B0012.qdf', 'qdf/C0005.qdf', 'qdf/C0013.qdf', 'qdf/C0156.qdf', 'qdf/C0179.qdf', 'assembly-fixtures/s33.json', 'assembly-fixtures/s36.json'])('%s 说明书物料图片存在且不统计螺丝', file => {
      const text = readFileSync(`public/${file}`, 'utf8')
      const data = file.endsWith('.qdf') ? parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }) : JSON.parse(text)
      const model = new BuildModel()
      expect(model.loadJSON(data).ok).toBe(true)
      const items = coverItems(computeBOM(model)) as ManualItem[]
      expect(items.some(item => item.kind === 'screws')).toBe(false)
      const plan = computeAssemblyPlan(model)
      for (const step of plan.steps) expect(stepItems(model, step).some((item: any) => item.kind === 'screws')).toBe(false)
      const images = items.map(item => ({ id: item.id, kind: item.kind, src: partImageSrc(item.id) }))
      for (const image of images) {
        expect(image.src, `${file}: ${image.id}`).toBeTruthy()
        expect(existsSync(`public/${image.src!.replace(/^\//, '')}`), `${file}: ${image.src}`).toBe(true)
      }
      assetEvidence.push({ file, rows: items.length, images, missingPictures: [] })
  })
})
