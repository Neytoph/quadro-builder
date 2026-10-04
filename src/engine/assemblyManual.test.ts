import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeAssemblyPlan, assemblyState } from './assemblyPlan.js'
import { coverItems, numberStepItems, stepItems, assemblyPresentationState, measureManualLegend, manualPartsHeight, assemblyDetailItems, assemblyDetailDirection, wrapManualText, manualStepTextLayout, manualStepDetailDescriptors, layoutManualCallouts, manualTextPageLayout, manualDetailPageLayout, manualActionLabelBox, MANUAL_TEXT_MM, MANUAL_AUX_MM } from './assemblyManual.js'
import { parseQDF } from './qdfimport.js'
import { partImageSrc } from '../ui/partImages'

type ManualItem = { id: string; key: string; kind: string; num: number }

beforeAll(async () => { await loadCatalog() })
const assetEvidence: any[] = []
afterAll(() => { mkdirSync('.work', { recursive: true }); writeFileSync('.work/assembly-pdf-assets.json', JSON.stringify(assetEvidence, null, 2)) })

describe('说明书材料编号', () => {
  it('带二维码的长说明与长区域标题按安全高度续页，不覆盖二维码', () => {
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const title = 'Sehr lange Bereichsbezeichnung mit mehreren Montagehinweisen '.repeat(8)
    const lines = Array.from({ length: 80 }, (_, i) => `动作 ${i + 1}：完整保留正文与安装方向，先穿入套件再安装另一端接头。`)
    const layout = manualTextPageLayout(ctx, title, lines, { host: 'xiaomaifang.com' })
    expect(layout.titleLines.length).toBeGreaterThan(1)
    expect(layout.titleLines.join(' ').replace(/\s/g, '')).toBe(title.replace(/\s/g, ''))
    expect(layout.bodyY).toBeGreaterThan(18)
    const chunks = []
    for (let offset = 0; offset < layout.lines.length; offset += layout.capacity) chunks.push(layout.lines.slice(offset, offset + layout.capacity))
    expect(chunks.flat()).toEqual(layout.lines)
    for (const chunk of chunks) expect(layout.bodyY + (chunk.length - 1) * 5 + MANUAL_TEXT_MM).toBeLessThanOrEqual(layout.bodyBottom)
    expect(layout.bodyBottom).toBeLessThan(187.4)
    const details = manualDetailPageLayout(ctx, title, 'Materialnummern dienen zur Orientierung; Mengen sind im Hauptschritt enthalten.')
    expect(details.referenceY).toBeGreaterThan(5 + (details.titleLines.length - 1) * 5.4 + 4.4)
    expect(details.bodyY).toBeGreaterThan(details.referenceY + (details.referenceLines.length - 1) * 4.2 + MANUAL_AUX_MM)
    expect(details.bodyY + details.availableHeight).toBe(193)
    const legend = manualTextPageLayout(ctx, title, [], { host: 'xiaomaifang.com' })
    expect(legend.bodyY).toBeGreaterThan(5 + (legend.titleLines.length - 1) * 5.4 + 4.4)
  })
  it('全局动作134的标号白底按真实字宽放大并留在图框内', () => {
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 22 }) }
    const rect = { x: 50, y: 30, w: 800, h: 600 }
    const box = manualActionLabelBox(ctx, 134, [848, 200], rect)
    expect(box.label).toBe('(134)')
    expect(box.width).toBeGreaterThan(50)
    expect(box.x + box.width / 2).toBeLessThanOrEqual(rect.x + rect.w)
    expect(box.x - box.width / 2).toBeGreaterThanOrEqual(rect.x)
  })
  it('纸面正文字号至少10pt，辅助字至少9pt；长指令换行后保留全文', () => {
    expect(MANUAL_TEXT_MM * 72 / 25.4).toBeGreaterThanOrEqual(10)
    expect(MANUAL_AUX_MM * 72 / 25.4).toBeGreaterThanOrEqual(9)
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const instruction = '先将闭环套件穿入管件，再把管件沿着指定插口方向插入，最后安装另一端接头。'.repeat(60)
    expect(wrapManualText(ctx, instruction, 300).join('')).toBe(instruction)
    const layout = manualStepTextLayout(ctx, '步骤 2：安装本层', [instruction])
    expect([...layout.instructionLines, ...layout.remainingLines].join('')).toBe(instruction)
    expect(layout.remainingLines.length).toBeGreaterThan(0)
    expect(layout.headerH).toBeLessThanOrEqual(52)
  })
  it('局部材料只沿用封面编号，范围只包含本组且排除仅用于定位的支撑件', () => {
    const cover = [{ key: 'T35|red', ledgerKey: 'T35|red', num: 7, kind: 'tubes', name: '管35cm', count: 9, instanceIds: ['a', 'b'] }, { key: 'connectors:3', ledgerKey: '3', num: 2, kind: 'connectors', name: '接头', count: 5, instanceIds: ['c'] }]
    const items = assemblyDetailItems({}, { ledger: { instances: [] } }, {}, { id: 'g', partIds: ['b', 'c'], materialKeys: ['tubes:T35|red'] }, cover)
    expect(items).toHaveLength(1)
    expect(items[0].num).toBe(7)
    expect(items[0].instanceIds).toEqual(['b'])
    expect(items[0].referenceOnly).toBe(true)
    expect(cover[0].instanceIds).toEqual(['a', 'b'])
  })
  it('最多六个实际圆圈，侧边引线保留真实投影点且不叠号', () => {
    const marks = Array.from({ length: 6 }, (_, i) => ({ label: String(i + 1), x: 100 + i * 10, y: 100 }))
    const placed = layoutManualCallouts(marks, 800, 600, 28)
    expect(placed).toHaveLength(6)
    expect(new Set(placed.map(mark => `${mark.x},${mark.y}`)).size).toBe(6)
    placed.forEach(mark => expect(mark.anchorY).toBe(100))
    const phone = layoutManualCallouts(marks, 360, 260, 12)
    for (let index = 1; index < phone.length; index++) expect(Math.hypot(phone[index].x - phone[index - 1].x, phone[index].y - phone[index - 1].y)).toBeGreaterThanOrEqual(24)
    expect(() => layoutManualCallouts([...marks, marks[0]], 800, 600, 28)).toThrow('超过六个')
    expect(assemblyDetailDirection({ viewDirection: 'back' })).toEqual([-1, 0.65, -1])
    expect(assemblyDetailDirection({ viewDirection: 'bottom' })).toEqual([1, -0.65, 1])
    const group = { viewDirection: 'front', operationIds: ['diagonal'] }
    const step = { operations: [{ id: 'diagonal', direction: [1, 1, 1] }] }
    const direction = assemblyDetailDirection(group, step)
    expect(Math.abs(direction.reduce((sum: number, value: number) => sum + value, 0)) / Math.hypot(...direction) / Math.sqrt(3)).toBeLessThan(0.5)
    expect(assemblyDetailDirection({ ...group, viewDirection: 'back' }, step)).toEqual([-1, 0.65, -1])
  })
  it.each(['C0179', 'C0005', 'C0013'])('%s 局部续页保留主步骤号，每组仅一次且不重复计料', name => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync(`public/qdf/${name}.qdf`, 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const cover = coverItems(plan.bom)
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 16 }) }
    const copy = { stepHeading: '{k}/{n} · {title}', detailTitle: '局部动作详图' }
    for (let index = 0; index < plan.steps.length; index++) {
      const descriptors = manualStepDetailDescriptors(ctx, model, plan, index, cover, copy)
      expect(descriptors.flatMap((page: any) => page.groups.map((group: any) => group.id))).toEqual(plan.steps[index].detailGroups.map((group: any) => group.id))
      for (const descriptor of descriptors) {
        expect(descriptor.index).toBe(index)
        expect(descriptor.heading.startsWith(`${index + 1}/${plan.steps.length}`)).toBe(true)
        expect(descriptor.countsMaterials).toBe(false)
        expect(descriptor.groups.length).toBeLessThanOrEqual(2)
        for (const group of descriptor.groups) {
          expect(group.items.length).toBeLessThanOrEqual(6)
          expect(group.items.every((item: any) => item.referenceOnly)).toBe(true)
        }
      }
    }
  })
  it('C0179整层安装保留已装主体，顶层框架与接头一同下套且不修改模型状态', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'body' && step.y === 20 && step.action.layer)
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], before = assemblyState(plan, index, { action: true }), after = assemblyState(plan, index)
    const saved = JSON.stringify(model.toJSON()), originalVisible = [...before.visible]
    const left = assemblyPresentationState(model, plan, step, before), right = assemblyPresentationState(model, plan, step, after)
    expect([...left.visible].sort()).toEqual([...before.visible].sort())
    expect([...right.visible].sort()).toEqual([...after.visible].sort())
    expect(left.contextFiltered).toBe(false)
    expect(left.arrows).toHaveLength(4)
    expect(left.interfaceMarks).toEqual([])
    expect(before.interfaceMarks).toHaveLength(4)
    for (const module of step.action.modules) for (const id of module.partIds) {
      expect(left.transforms.get(id)).toEqual(module.translation)
      expect(right.transforms.has(id)).toBe(false)
    }
    for (const id of before.done) expect(left.transforms.has(id)).toBe(false)
    expect([...before.visible]).toEqual(originalVisible)
    expect([...before.hiddenNewParts].sort()).toEqual([...step.action.inPlacePartIds].sort())
    for (const id of step.action.inPlacePartIds) {
      expect(left.visible.has(id)).toBe(false)
      expect(right.visible.has(id)).toBe(true)
      expect(right.transforms.has(id)).toBe(false)
    }
    expect(JSON.stringify(model.toJSON())).toBe(saved)
  })
  it('C0179 80cm整层页同时呈现四个独立框架及完整已装主体', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'body' && step.y === 80 && step.action.layer)
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], state = assemblyState(plan, index, { action: true })
    const presented = assemblyPresentationState(model, plan, step, state)
    expect(presented.visible.size).toBe(state.visible.size)
    expect(step.action.modules).toHaveLength(4)
    const moduleTubes = step.action.modules.flatMap((module: any) => module.partIds.filter((id: string) => model.tubes.has(id)))
    expect(moduleTubes).toHaveLength(21)
    for (const module of step.action.modules) for (const id of module.partIds) expect(presented.visible.has(id)).toBe(true)
    for (const mark of presented.interfaceMarks) {
      expect(presented.visible.has(mark.supportTubeId)).toBe(true)
      expect(presented.transforms.has(mark.supportTubeId)).toBe(false)
      const support = model.tubes.get(mark.supportTubeId)
      expect(presented.visible.has(support.a)).toBe(true)
      expect(presented.visible.has(support.b)).toBe(true)
    }
    expect([...presented.visible].some(id => model.nodes.get(id)?.y === 0)).toBe(true)
    const installedTubes = [...state.done].filter(id => model.tubes.has(id))
    expect(installedTubes.length).toBeGreaterThan(21)
    for (const id of installedTubes) expect(presented.visible.has(id)).toBe(true)
    expect(presented.arrows.every((arrow: any) => arrow.from[1] > arrow.to[1])).toBe(true)
  })
  it('C0179主体20cm层的全部材料留在同一主步骤，管35 cm与后装立柱不单独计料', () => {
    const model = new BuildModel()
    model.loadJSON(parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'body' && step.y === 20 && step.action.layer)
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index]
    const items = stepItems(model, step)
    expect(items.some((item: any) => item.key?.includes('T35'))).toBe(true)
    const allocated = plan.ledger.instances.filter((instance: any) => instance.stepId === step.id && instance.group !== 'screws')
    expect(items.map((item: any) => `${item.kind}:${item.ledgerKey}`).sort()).toEqual([...new Set(allocated.map((instance: any) => `${instance.group}:${instance.key}`))].sort())
    for (const item of items) {
      const rows = allocated.filter((instance: any) => instance.group === item.kind && instance.key === item.ledgerKey)
      expect(new Set(item.instanceIds).size).toBe(item.instanceIds.length)
      expect([...item.instanceIds].sort()).toEqual([...new Set(rows.flatMap((instance: any) => instance.partIds))].sort())
      expect(item.count).toBe(rows.reduce((sum: number, instance: any) => sum + instance.count, 0))
    }
    // 隔离排版测试使用固定字宽；实际字体及三语分页另由浏览器导出核验。
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const layout = measureManualLegend(ctx, items, 2450)
    const partsH = manualPartsHeight(ctx, items, 2450)
    expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
    expect(210 - 20 - partsH - 3).toBeGreaterThanOrEqual(105)
    const descriptors = manualStepDetailDescriptors(ctx, model, plan, index, coverItems(plan.bom), { stepHeading: '{k}/{n} · {title}', detailTitle: '局部动作详图' })
    expect(descriptors.flatMap((page: any) => page.groups.map((group: any) => group.id))).toEqual(step.detailGroups.map((group: any) => group.id))
    for (const page of descriptors) {
      expect(page.index).toBe(index)
      expect(page.heading.startsWith(`${index + 1}/${plan.steps.length}`)).toBe(true)
      expect(page.countsMaterials).toBe(false)
      expect(page.groups.every((group: any) => group.items.every((item: any) => item.referenceOnly))).toBe(true)
    }
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
  }, 30000)
})
