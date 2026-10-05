import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeAssemblyPlan, assemblyState, assemblyDetailState } from './assemblyPlan.js'
import { coverItems, numberStepItems, stepItems, assemblyPresentationState, measureManualLegend, manualPartsHeight, manualLegendChunks, assemblyDetailItems, assemblyDetailDirection, wrapManualText, manualStepTextLayout, manualStepDetailDescriptors, layoutManualCallouts, manualTextPageLayout, manualDetailPageLayout, manualActionLabelBox, manualSafetyDescriptor, MANUAL_TEXT_MM, MANUAL_AUX_MM } from './assemblyManual.js'
import { parseQDF } from './qdfimport.js'
import { partImageSrc } from '../ui/partImages'
import { getLang, setLang } from './i18n.js'

type ManualItem = { id: string; key: string; kind: string; num: number }

const fixtureFiles = ['qdf/B0012.qdf', 'qdf/C0005.qdf', 'qdf/C0013.qdf', 'qdf/C0156.qdf', 'qdf/C0179.qdf', 'assembly-fixtures/s33.json', 'assembly-fixtures/s36.json']
const fixturePlans = new Map<string, any>()
const fixturePlanEvidence: any[] = []
const fixtureKey = (model: any) => JSON.stringify([getLang(), model.toJSON()])
function loadManualFixture(file: string) {
  const text = readFileSync(file.endsWith('.qdf') ? `public/${file}` : `tests/fixtures/assembly/${file.split('/').at(-1)}`, 'utf8')
  const data = file.endsWith('.qdf') ? parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }) : JSON.parse(text)
  const model = new BuildModel()
  expect(model.loadJSON(data).ok, file).toBe(true)
  return model
}
function manualFixture(file: string) {
  const model = loadManualFixture(file), plan = fixturePlans.get(fixtureKey(model))
  if (!plan) throw new Error(`固定输入与语言尚未预规划：${file}`)
  // 每项测试有独立模型和计划副本；修改后的输入不能借用旧计划。
  return { model, plan: structuredClone(plan) }
}
beforeAll(async () => {
  await loadCatalog()
  for (const file of fixtureFiles) {
    const model = loadManualFixture(file), key = fixtureKey(model), started = performance.now()
    if (!fixturePlans.has(key)) fixturePlans.set(key, computeAssemblyPlan(model))
    const plan = fixturePlans.get(key)
    fixturePlanEvidence.push({ file, lang: getLang(), ms: performance.now() - started, canExport: plan.canExport, diagnostics: plan.diagnostics.map((item: any) => item.code) })
  }
}, 300000)
const assetEvidence: any[] = []
afterAll(() => { mkdirSync('.work', { recursive: true }); writeFileSync('.work/assembly-pdf-assets.json', JSON.stringify(assetEvidence, null, 2)); writeFileSync('.work/assembly-pdf-fixture-plans.json', JSON.stringify(fixturePlanEvidence, null, 2)) })

describe('说明书材料编号', () => {
  it('三语搭建前页保留未实物验证状态，调用方缺少状态文案也不遗漏', () => {
    const claims = { zh: ['现场搭建', '首次搭建者走查', '承载', '尚未验证'], en: ['On-site assembly', 'first-time builder', 'load-bearing capacity', 'not yet been verified'], de: ['Aufbau vor Ort', 'erstmalige Aufbauende', 'Tragfähigkeit', 'noch nicht verifiziert'] }
    const previousLang = getLang()
    try {
      for (const [lang, required] of Object.entries(claims)) {
        // 导出等待资源时切换UI语言，显式冻结的导出语言仍决定验证状态。
        setLang(lang === 'zh' ? 'en' : 'zh')
        const descriptor = manualSafetyDescriptor({ safetyNotice: 'Caller assembly notice without a verification status.' }, lang)
        expect(descriptor.type).toBe('safety')
        const text = descriptor.lines.join(' ')
        for (const claim of required) expect(text).toContain(claim)
        expect(text).toContain('Caller assembly notice without a verification status.')
        expect(descriptor.lines.at(-1)).toBe('https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf')
      }
    } finally { setLang(previousLang) }
  })
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
    const { model, plan } = manualFixture(`qdf/${name}.qdf`)
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
    const { model, plan } = manualFixture('qdf/C0179.qdf')
    const index = plan.steps.findIndex((step: any) => plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'body' && step.y === 20 && step.action.layer)
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], before = assemblyState(plan, index, { action: true }), after = assemblyState(plan, index)
    const saved = JSON.stringify(model.toJSON()), originalVisible = [...before.visible]
    const left = assemblyPresentationState(model, plan, step, before), right = assemblyPresentationState(model, plan, step, after)
    expect([...left.visible].sort()).toEqual([...before.visible].sort())
    expect([...right.visible].sort()).toEqual([...after.visible].sort())
    expect(left.contextFiltered).toBe(false)
    expect(left.arrows).toHaveLength(4)
    expect(left.arrows.map((arrow: any) => arrow.id).sort()).toEqual(step.action.modules.flatMap((module: any) => module.interfaceIds).sort())
    expect(left.interfaceMarks).toEqual([])
    expect(before.interfaceMarks).toHaveLength(4)
    for (const module of step.action.modules) for (const id of module.partIds) {
      // Quaternion-derived translations can contain -0; compare physical coordinates.
      const translation = left.transforms.get(id)!
      for (let axis = 0; axis < 3; axis++) expect(translation[axis]).toBeCloseTo(module.translation[axis], 8)
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
    const { model, plan } = manualFixture('qdf/C0179.qdf')
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
    const { model, plan } = manualFixture('qdf/C0179.qdf')
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

  it('C0013 加固件完整分配，长料表真实分页且保留主图空间', () => {
    const { model, plan } = manualFixture('qdf/C0013.qdf')
    const groups = plan.steps.map((step: any) => stepItems(model, step)).filter((items: any[]) => items.some(item => item.kind === 'reinforcements'))
    // Real pagination/painting with deterministic metrics; visual font QA uses browser PDFs.
    const ctx: any = new Proxy({ font: '', measureText: (text: string) => ({ width: [...String(text)].length * 20 }) }, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => {} } })
    const canvases: any[] = []
    expect(groups.flat().filter((item: any) => item.kind === 'reinforcements').reduce((sum: number, item: any) => sum + item.count, 0)).toBe(8)
    vi.stubGlobal('document', { createElement: () => { const canvas = { width: 0, height: 0, getContext: () => ctx }; canvases.push(canvas); return canvas } })
    try {
      let continuationPages = 0
      for (const items of groups) {
        const title = 'C0013 材料续页', { chunks, partsH } = manualLegendChunks(items, false, new Map(), null, title)
        expect(chunks.flat()).toEqual(items)
        expect(chunks.flat().reduce((sum: number, item: any) => sum + item.count, 0)).toBe(items.reduce((sum: number, item: any) => sum + item.count, 0))
        expect(210 - 20 - partsH - 3).toBeGreaterThanOrEqual(85)
        chunks.forEach((chunk: any[], index: number) => {
          expect(chunk.length).toBeGreaterThan(0)
          const available = index ? 210 - 7 - manualTextPageLayout(ctx, title, []).bodyY : partsH - 5.2
          expect(measureManualLegend(ctx, chunk, 2830).height).toBeLessThanOrEqual(available * 10)
        })
        continuationPages += chunks.length - 1
      }
      expect(continuationPages).toBeGreaterThan(0)
      expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('s33 两条面板物料不再溢出封面成为稀疏续页', () => {
    const model = new BuildModel()
    model.loadJSON(JSON.parse(readFileSync('tests/fixtures/assembly/s33.json', 'utf8')))
    const items = coverItems(computeBOM(model))
    const ctx = { font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) }
    const layout = measureManualLegend(ctx, items, 2450)
    const partsH = manualPartsHeight(ctx, items, 2450, true)
    expect(layout.height).toBeGreaterThan((91 - 5.7) * 10)
    expect(layout.height).toBeLessThanOrEqual((partsH - 5.7) * 10)
    expect(210 - 16 - partsH - 3).toBeGreaterThanOrEqual(85)
  })
  it('C0005 顶棚安装保留完整支撑框架，供底部视角核对固定杆', () => {
    const { model, plan } = manualFixture('qdf/C0005.qdf')
    const cover = plan.regions.find((r: any) => r.accessoryType === 'roof-cover')
    expect(cover).toBeDefined()
    const index = plan.steps.findIndex((s: any) => s.regionId === cover.id && s.operations.some((op: any) => op.type === 'fit-accessory' && op.partIds.some((id: string) => model.slides.get(id)?.kind === 'roof2')))
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], operation = step.operations.find((op: any) => op.type === 'fit-accessory' && op.partIds.some((id: string) => model.slides.get(id)?.kind === 'roof2'))
    expect(step.action.type).toBe('build')
    expect(step.action.detached).toBe(false)
    expect(operation.placementTranslation).toEqual([0, 0, 0])
    expect(operation.translation).toEqual([0, 18, 0])
    const group = step.detailGroups.find((group: any) => group.operationIds.includes(operation.id))
    expect(assemblyDetailDirection(group, step)[1]).toBeLessThan(0)
    const support = plan.regions.find((r: any) => r.id === cover.supportRegionId)
    const saved = JSON.stringify(model.toJSON())
    const before = assemblyDetailState(plan, index, group.id, { action: true }), after = assemblyDetailState(plan, index, group.id, { action: false })
    const original = [...before.visible]
    const action = assemblyPresentationState(model, plan, step, before, { detail: true })
    const presented = assemblyPresentationState(model, plan, step, after, { detail: true })
    expect(action.contextFiltered).toBe(true)
    expect(presented.contextFiltered).toBe(true)
    expect(support.tubeIds.length).toBeGreaterThan(0)
    for (const id of support.tubeIds) {
      expect(action.visible.has(id)).toBe(true)
      expect(presented.visible.has(id)).toBe(true)
      expect(action.transforms.get(id) || [0, 0, 0]).toEqual([0, 0, 0])
      expect(presented.transforms.get(id) || [0, 0, 0]).toEqual([0, 0, 0])
    }
    for (const id of cover.slideIds) {
      expect(action.visible.has(id)).toBe(true)
      expect(presented.visible.has(id)).toBe(true)
      expect(action.transforms.get(id)).toEqual([0, 18, 0])
      expect(presented.transforms.get(id) || [0, 0, 0]).toEqual([0, 0, 0])
    }
    expect([...before.visible]).toEqual(original)
    expect(JSON.stringify(model.toJSON())).toBe(saved)
  })
  it('C0005 滑梯本体按原位分件步骤绘图，详情过滤遮挡板且不修改冻结模型或零件状态', () => {
    const { model, plan } = manualFixture('qdf/C0005.qdf')
    // The body is fitted in its completed support layer, which can own the slide material.
    const index = plan.steps.findIndex((step: any) => step.operations.some((operation: any) => operation.type === 'fit-accessory' && operation.partIds.some((id: string) => model.slides.get(id)?.kind === 'slide2')))
    expect(index).toBeGreaterThanOrEqual(0)
    expect(plan.steps[index].action.detached).toBe(false)
    expect(plan.steps[index].action.type).toBe('build')
    const step = plan.steps[index], operation = step.operations.find((operation: any) => operation.type === 'fit-accessory' && operation.partIds.some((id: string) => model.slides.get(id)?.kind === 'slide2'))
    expect(operation.placementTranslation).toEqual([0, 0, 0])
    expect(operation.translation).toEqual([0, 18, 0])
    expect(operation.verification.supportPoses.length).toBeGreaterThan(0)
    expect(operation.verification.supportPoses.every((support: any) => support.installed && support.translation.every((value: number) => value === 0))).toBe(true)
    const group = step.detailGroups.find((group: any) => group.operationIds.includes(operation.id))
    expect(group).toBeTruthy()
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
    const action = assemblyDetailState(plan, index, group.id, { action: true }), complete = assemblyDetailState(plan, index, group.id)
    for (const id of operation.partIds) {
      expect(action.visible.has(id)).toBe(true)
      expect(action.transforms.get(id)).toEqual([0, 18, 0])
      expect(complete.visible.has(id)).toBe(true)
      expect(complete.transforms.get(id) || [0, 0, 0]).toEqual([0, 0, 0])
    }
    const next = step.operations.findIndex((op: any) => group.operationIds.includes(op.id)), last = step.operations.findLastIndex((op: any) => group.operationIds.includes(op.id))
    const consumed = new Set(step.operations.slice(0, last + 1).flatMap((op: any) => op.consumesPartIds))
    for (const op of step.operations.slice(last + 1)) for (const id of op.consumesPartIds) if (!consumed.has(id)) expect(complete.visible.has(id)).toBe(false)
    expect(next).toBeGreaterThanOrEqual(0)
    expect([...state.visible]).toEqual(original)
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })
  it('s33 说明书不生成固定检查步骤或螺丝位置', () => {
    const { plan } = manualFixture('assembly-fixtures/s33.json')
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

  it.each(fixtureFiles)('%s 说明书物料图片存在且不统计螺丝', file => {
      const { model, plan } = manualFixture(file)
      const items = coverItems(computeBOM(model)) as ManualItem[]
      expect(items.some(item => item.kind === 'screws')).toBe(false)
      for (const step of plan.steps) expect(stepItems(model, step).some((item: any) => item.kind === 'screws')).toBe(false)
      const images = items.map(item => ({ id: item.id, kind: item.kind, src: partImageSrc(item.id) }))
      for (const image of images) {
        expect(image.src, `${file}: ${image.id}`).toBeTruthy()
        expect(existsSync(`public/${image.src!.replace(/^\//, '')}`), `${file}: ${image.src}`).toBe(true)
      }
      assetEvidence.push({ file, rows: items.length, images, missingPictures: [] })
  }, 30000)
})
