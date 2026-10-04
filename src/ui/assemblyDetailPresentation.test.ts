import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BuildModel } from '../engine/model.js'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { parseQDF } from '../engine/qdfimport.js'
import { computeAssemblyPlan, assemblyDetailState } from '../engine/assemblyPlan.js'
import { assemblyDetailItems, assemblyDetailDirection, coverItems } from '../engine/assemblyManual.js'
import { activeDetail, detailOperations, detailViewName, operationLabel, operationMarkGeometry } from './assemblyDetailPresentation'
import { layoutAssemblyMarks } from './assemblyOverlay'
import { assemblyStrings, assemblyPdfStrings, assemblyDiagnosticText } from './assemblyStrings'

beforeAll(async () => { await loadCatalog() })

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
  }, 30000)

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
