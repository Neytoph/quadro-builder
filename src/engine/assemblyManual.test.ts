import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeAssemblyPlan, assemblyState } from './assemblyPlan.js'
import { coverItems, numberStepItems, stepItems, assemblyFixingGroups, assemblyPresentationState, measureManualLegend, manualPartsHeight } from './assemblyManual.js'
import { parseQDF } from './qdfimport.js'
import { partImageSrc } from '../ui/partImages'

type ManualItem = { id: string; key: string; kind: string; num: number }

beforeAll(async () => { await loadCatalog() })

describe('说明书材料编号', () => {
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

  it('C0013 第4步的最后一条加固管留在六行步骤料表中', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0013.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const items = stepItems(model, computeAssemblyPlan(model).steps[3])
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const layout = measureManualLegend(ctx, items, 2450)
    const partsH = manualPartsHeight(ctx, items, 2450)
    expect(items.length).toBe(16)
    expect(layout.height).toBeGreaterThan((82 - 5.7) * 10)
    expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
    expect(210 - 20 - partsH - 3).toBeGreaterThanOrEqual(85)
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
  it('s33 固定标号合并同部位但保留全部螺丝数量和固定步骤', () => {
    const model = new BuildModel()
    expect(model.loadJSON(JSON.parse(readFileSync('public/assembly-fixtures/s33.json', 'utf8'))).ok).toBe(true)
    const plan = computeAssemblyPlan(model)
    const marks = assemblyFixingGroups(plan)
    expect(marks.reduce((n: number, mark: any) => n + mark.count, 0)).toBe(plan.bom.screws.reduce((n: number, row: any) => n + row.count, 0))
    expect(new Set(marks.map((mark: any) => mark.label)).size).toBe(marks.length)
    expect(marks.every((mark: any) => plan.steps.some((step: any) => step.id === mark.stepId && step.action.type === 'fix'))).toBe(true)
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

  it('七个真实模型的说明书物料图片在目录中存在且不统计螺丝', () => {
    const evidence = []
    for (const file of ['qdf/B0012.qdf', 'qdf/C0005.qdf', 'qdf/C0013.qdf', 'qdf/C0156.qdf', 'qdf/C0179.qdf', 'assembly-fixtures/s33.json', 'assembly-fixtures/s36.json']) {
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
      evidence.push({ file, rows: items.length, images, missingPictures: [] })
    }
    mkdirSync('.work', { recursive: true })
    writeFileSync('.work/assembly-pdf-assets.json', JSON.stringify(evidence, null, 2))
  })
})
