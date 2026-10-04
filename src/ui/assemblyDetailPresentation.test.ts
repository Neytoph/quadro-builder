import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BuildModel } from '../engine/model.js'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { parseQDF } from '../engine/qdfimport.js'
import { computeAssemblyPlan, assemblyDetailState } from '../engine/assemblyPlan.js'
import { assemblyDetailItems, assemblyDetailDirection, coverItems, layoutOperationCallouts, projectedOperationArrowHead } from '../engine/assemblyManual.js'
import { activeDetail, detailOperations, detailViewName, operationLabel, operationMarkGeometry, operationCalloutOptions } from './assemblyDetailPresentation'
import { layoutAssemblyMarks } from './assemblyOverlay'
import { assemblyStrings, assemblyPdfStrings, assemblyDiagnosticText } from './assemblyStrings'

beforeAll(async () => { await loadCatalog() })

// Independent segment/rectangle intersection assertion: verifies that a readable
// label never covers the observed shaft or its tip, rather than checking output
// against a second copy of the placement algorithm.
function segmentHitsBox(arrow: { x1: number; y1: number; x2: number; y2: number }, box: { x: number; y: number; boxWidth: number; boxHeight: number }, clearance: number) {
  let from = 0, to = 1
  for (const [start, end, center, extent] of [[arrow.x1, arrow.x2, box.x, box.boxWidth / 2 + clearance], [arrow.y1, arrow.y2, box.y, box.boxHeight / 2 + clearance]]) {
    const delta = end - start
    if (Math.abs(delta) < 1e-9) { if (Math.abs(start - center) > extent) return false; continue }
    const a = (center - extent - start) / delta, b = (center + extent - start) / delta
    from = Math.max(from, Math.min(a, b)); to = Math.min(to, Math.max(a, b))
    if (from > to) return false
  }
  return true
}

describe('同一步局部导航与共用材料编号', () => {
  it.each(['B0012', 'C0179', 'C0156'])('%s 真实计划保持主步骤并逐组读取冻结动作与材料', id => {
    const model = new BuildModel()
    const source = readFileSync(`public/qdf/${id}.qdf`, 'utf8')
    expect(model.loadJSON(parseQDF(source, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })).ok).toBe(true)
    const plan: any = computeAssemblyPlan(model)
    const before = model.toJSON()
    const coverNumbers = new Map(coverItems(plan.bom).map((item: { key: string; num: number }) => [item.key, item.num]))
    let groups = 0
    for (const [index, step] of plan.steps.entries()) for (const group of step.detailGroups) {
      groups++
      expect(activeDetail(step.detailGroups, group.id)).toBe(group)
      const operations = detailOperations(step, group)
      expect(operations.map(operation => operation.id)).toEqual(group.operationIds)
      expect(operations.map(operation => operation.order)).toEqual([...operations.map(operation => operation.order)].sort((a, b) => a - b))
      const items = assemblyDetailItems(model, plan, step, group)
      expect(items.length).toBeLessThanOrEqual(6)
      for (const item of items) {
        expect(item.num).toBe(coverNumbers.get(item.key))
        expect(item.instanceIds.every((partId: string) => group.partIds.includes(partId))).toBe(true)
        expect(item.kind).not.toBe('screws')
      }
      const action: any = assemblyDetailState(plan, index, group.id, { action: true })
      const complete: any = assemblyDetailState(plan, index, group.id, { action: false })
      const localParts = new Set(step.operations.filter((operation: any) => group.operationIds.includes(operation.id)).flatMap((operation: any) => [...operation.partIds, ...(operation.referencePartIds || []), ...(operation.closesPorts || [])]))
      expect(action.focusPartIds.every((partId: string) => localParts.has(partId) && action.visible.has(partId))).toBe(true)
      expect(complete.focusPartIds.every((partId: string) => localParts.has(partId) && complete.visible.has(partId))).toBe(true)
      expect(action.operationNumbers.map((operation: { id: string }) => operation.id)).toEqual(group.operationIds)
    }
    expect(groups).toBeGreaterThan(0)
    expect(model.toJSON()).toEqual(before)
  }, 120000)

  it('动作序号独立于材料编号，旧选择不会指向新计划中的其他详图', () => {
    expect(operationLabel(1)).toBe('①')
    expect(operationLabel(3)).toBe('③')
    expect(operationLabel(21)).toBe('(21)')
    expect(activeDetail([{ id: 'new' }], 'old')).toBeNull()
    expect(detailViewName('back')).toBe('back')
    expect(detailViewName('bottom')).toBe('bottom')
    expect(detailViewName([1, -2, 1])).toBe('bottom')
    expect(detailViewName(assemblyDetailDirection({ viewDirection: 'bottom' }))).toBe('bottom')
  })

  it('密集层三位动作号完整容纳在方框中，避让按实际宽度进行', () => {
    const marks = [134, 135, 136].map(order => ({ x: 160, y: 130, label: operationLabel(order) }))
    const radius = Math.max(...marks.map(mark => operationMarkGeometry(mark.label).radius))
    const placed = layoutAssemblyMarks(marks, 320, 260, { radius })
    for (const [index, mark] of placed.entries()) {
      const geometry = operationMarkGeometry(mark.label)
      expect(geometry.width).toBeGreaterThan(26)
      expect(geometry.fontSize).toBeGreaterThanOrEqual(12)
      expect(mark.x - geometry.width / 2).toBeGreaterThanOrEqual(0)
      expect(mark.x + geometry.width / 2).toBeLessThanOrEqual(320)
      for (const other of placed.slice(0, index)) expect(Math.hypot(mark.x - other.x, mark.y - other.y)).toBeGreaterThanOrEqual(radius * 2)
    }
  })

  it('首个手机详图的接头动作框避开短插管箭头，保持真实起止点与引线锚点', () => {
    // Rounded pixel anchors from final-browser-r3/de-320-detail-0-action.png.
    // The old 26px ① box centered at (209,158) covered the insertion tip.
    const arrows = [{ x1: 186, y1: 166, x2: 209, y2: 158 }]
    const materials = [{ x: 15, y: 178, radius: 12 }, { x: 303, y: 178, radius: 12 }]
    const marks = [{ x: 209, y: 158, label: '①', boxWidth: 26, boxHeight: 26 }, { x: 145, y: 184, label: '②', boxWidth: 26, boxHeight: 26 }]
    expect(segmentHitsBox(arrows[0], marks[0], 0)).toBe(true)
    const input = structuredClone({ arrows, materials, marks })
    const placed = layoutOperationCallouts(marks, 318, 356, operationCalloutOptions(arrows, materials))
    expect({ arrows, materials, marks }).toEqual(input)
    expect(placed).toHaveLength(2)
    expect(placed[0].x !== marks[0].x || placed[0].y !== marks[0].y).toBe(true)
    for (const [index, mark] of placed.entries()) {
      expect(mark.placementClear).toBe(true)
      expect([mark.anchorX, mark.anchorY]).toEqual([marks[index].x, marks[index].y])
      expect(segmentHitsBox(arrows[0], mark, 8)).toBe(false)
    }
  })

  it.each([320, 390])('%dpx手机三位动作号避开真实箭头和材料圈，完整留在图内', width => {
    const arrows = [{ x1: width / 2 - 25, y1: 170, x2: width / 2 + 25, y2: 145 }]
    const materials = [{ x: 15, y: 155, radius: 12 }, { x: width - 15, y: 155, radius: 12 }]
    const marks = [134, 169, 170].map(order => ({ x: width / 2, y: 155, label: operationLabel(order), boxWidth: operationMarkGeometry(operationLabel(order)).width, boxHeight: 26 }))
    const placed = layoutOperationCallouts(marks, width, 260, operationCalloutOptions(arrows, materials))
    for (const [index, mark] of placed.entries()) {
      expect(mark.placementClear).toBe(true)
      expect(mark.x - mark.boxWidth / 2).toBeGreaterThanOrEqual(3)
      expect(mark.x + mark.boxWidth / 2).toBeLessThanOrEqual(width - 3)
      expect(mark.y - mark.boxHeight / 2).toBeGreaterThanOrEqual(3)
      expect(mark.y + mark.boxHeight / 2).toBeLessThanOrEqual(257)
      expect(segmentHitsBox(arrows[0], mark, 8)).toBe(false)
      for (const material of materials) {
        const dx = Math.max(Math.abs(material.x - mark.x) - mark.boxWidth / 2, 0)
        const dy = Math.max(Math.abs(material.y - mark.y) - mark.boxHeight / 2, 0)
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(material.radius + 6)
      }
      for (const other of placed.slice(0, index)) expect(Math.abs(mark.x - other.x) >= (mark.boxWidth + other.boxWidth) / 2 + 6 || Math.abs(mark.y - other.y) >= (mark.boxHeight + other.boxHeight) / 2 + 6).toBe(true)
    }
  })

  it('短运动箭头共用真实终点，头部不会延伸到起点后方或为零投影编造方向', () => {
    const arrow = { x1: 4, y1: 6, x2: 4.5, y2: 6.5 }
    const head = projectedOperationArrowHead(arrow, 8)!
    expect(head.tip).toEqual([arrow.x2, arrow.y2])
    const dx = arrow.x2 - arrow.x1, dy = arrow.y2 - arrow.y1, length2 = dx * dx + dy * dy
    for (const point of [head.left, head.right]) {
      const along = ((point[0] - arrow.x1) * dx + (point[1] - arrow.y1) * dy) / length2
      expect(along).toBeGreaterThanOrEqual(0)
      expect(along).toBeLessThanOrEqual(1)
    }
    expect(projectedOperationArrowHead({ x1: 4, y1: 6, x2: 4, y2: 6 }, 8)).toBeNull()
  })

  it('首个完成详图序号避开实际接头图框，保留接头锚点且不把灰色背景全部禁用', () => {
    // Visible connector body bounds rounded from the 318×356 completion crop.
    // Those are finite black connector footprints, not arbitrary circles around
    // every part: the pipe label may remain close to its own anchor.
    const connectorRects = [{ x: 209, y: 158, boxWidth: 28, boxHeight: 49 }, { x: 94, y: 214, boxWidth: 48, boxHeight: 78 }]
    const marks = [{ x: 211, y: 160, label: '①' }, { x: 173, y: 173, label: '②' }, { x: 94, y: 213, label: '③' }].map(mark => ({ ...mark, boxWidth: 26, boxHeight: 26 }))
    const materialMarks = [{ x: 303, y: 124, radius: 12 }, { x: 303, y: 231, radius: 12 }]
    const options = operationCalloutOptions([], materialMarks, connectorRects)
    expect(options.blockedRects).toBe(connectorRects)
    const placed = layoutOperationCallouts(marks, 318, 356, options)
    expect(placed.map(mark => mark.label)).toEqual(['①', '②', '③'])
    for (const [index, mark] of placed.entries()) {
      expect(mark.placementClear).toBe(true)
      expect([mark.anchorX, mark.anchorY]).toEqual([marks[index].x, marks[index].y])
      for (const connector of connectorRects) expect(Math.abs(mark.x - connector.x) >= (mark.boxWidth + connector.boxWidth) / 2 + 6 || Math.abs(mark.y - connector.y) >= (mark.boxHeight + connector.boxHeight) / 2 + 6).toBe(true)
      expect(mark.x - mark.boxWidth / 2).toBeGreaterThanOrEqual(3)
      expect(mark.x + mark.boxWidth / 2).toBeLessThanOrEqual(315)
      expect(mark.y - mark.boxHeight / 2).toBeGreaterThanOrEqual(3)
      expect(mark.y + mark.boxHeight / 2).toBeLessThanOrEqual(353)
    }
    expect(operationCalloutOptions([], []).blockedRects).toEqual([])
  })

  it.each(['zh', 'en', 'de'] as const)('%s 方向、固定提示与PDF文字完整共用', lang => {
    const ui = assemblyStrings[lang], pdf = assemblyPdfStrings[lang]
    expect(pdf.safetyNotice).toBe(ui.safetyNotice)
    expect(pdf.viewBack).toBe(ui.back)
    expect(pdf.viewBottom).toBe(ui.bottom)
    expect(ui.detailHint.length).toBeGreaterThan(10)
    expect(pdf.detailReference.length).toBeGreaterThan(10)
    expect(ui.physicalUnverified).not.toContain('已完成')
  })

  it.each(['ACCESSORY_INSTALLATION_PATH_UNRESOLVED', 'REINFORCEMENT_CHANNEL_SPLIT', 'UNKNOWN_INSTALLATION_GEOMETRY', 'MISSING_WHEEL_BEARING'])('%s 阻断提示有真实英德翻译', code => {
    const zh = assemblyDiagnosticText('zh', code, 'fallback')
    const en = assemblyDiagnosticText('en', code, 'fallback')
    const de = assemblyDiagnosticText('de', code, 'fallback')
    expect(en).not.toBe(zh)
    expect(de).not.toBe(zh)
    expect(en).not.toBe('fallback')
    expect(de).not.toBe('fallback')
    expect(en).toMatch(/path|channel|geometry|bearing/)
    expect(de).toMatch(/Montageweg|Profilkanal|Geometrie|Lager/)
  })
})
