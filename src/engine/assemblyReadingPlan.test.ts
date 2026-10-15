import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeAssemblyPlan } from './assemblyPlan.js'
import { coverItems, projectReadingLocatorBounds } from './assemblyManual.js'
import { createAssemblyReadingPlan, readingLayerNeedsAreas, partitionReadingLayer, readingMaterials, assemblyReadingState } from './assemblyReadingPlan.js'
import { assemblyPdfStrings } from '../ui/assemblyStrings'

beforeAll(loadCatalog)

describe('确定性的说明书阅读计划', () => {
  it('真实C0179保留11阅读主步骤和9空间页，物理计划及逐实例物料保持不变', () => {
    const model = new BuildModel()
    const input = parseQDF(readFileSync('public/qdf/C0179.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    expect(model.loadJSON(input).ok).toBe(true)
    const physical = computeAssemblyPlan(model), before = JSON.stringify(physical), modelBefore = JSON.stringify(model.toJSON())
    const items = coverItems(physical.bom)
    const reading = createAssemblyReadingPlan(model, physical, { items, copy: assemblyPdfStrings.zh })
    expect(physical.canExport).toBe(true)
    expect(reading.steps).toHaveLength(11)
    expect(reading.steps.flatMap((entry: any) => entry.areas)).toHaveLength(9)
    expect(reading.steps.filter((entry: any) => entry.areas.length).map((entry: any) => physical.steps[entry.sourceIndex].y)).toEqual([40, 80, 120])
    expect(1 + reading.steps.length + reading.steps.flatMap((entry: any) => entry.areas).length + 1).toBe(22)
    const indices = reading.steps.flatMap((entry: any) => entry.sourceIndices).sort((a: number, b: number) => a - b)
    expect(indices).toEqual(physical.steps.map((_: any, index: number) => index))
    for (const item of items) {
      expect(reading.steps.reduce((sum: number, entry: any) => sum + (entry.materials.find((row: any) => row.num === item.num)?.count || 0), 0)).toBe(item.count)
    }
    for (const entry of reading.steps) {
      if (!entry.areas.length) continue
      for (const material of entry.materials) expect(entry.areas.reduce((sum: number, area: any) => sum + (area.materials.find((row: any) => row.num === material.num)?.count || 0), 0)).toBe(material.count)
      const rows = entry.areas.flatMap((area: any) => area.allocations.map((row: any) => row.id))
      expect(new Set(rows).size).toBe(rows.length)
      expect(rows.sort()).toEqual(entry.allocations.map((row: any) => row.id).sort())
      const state = assemblyReadingState(model, physical, entry, { area: entry.areas[0], structure: false })
      expect(state.current).toEqual(new Set(entry.areas[0].partIds))
      expect([...state.done].every(id => !state.current.has(id))).toBe(true)
    }
    expect(JSON.stringify(physical)).toBe(before)
    expect(JSON.stringify(model.toJSON())).toBe(modelBefore)
  }, 120000)

  it('没有面板且材料种类少的密集上层也放大，开放地面不因总数量拆页', () => {
    const allocations = [{ group: 'tubes', count: 96 }]
    expect(readingLayerNeedsAreas({ y: 40, action: { type: 'build', layer: {} } }, allocations, [])).toBe(true)
    expect(readingLayerNeedsAreas({ y: 0, action: { type: 'build', layer: {} } }, allocations, [])).toBe(false)
    expect(readingLayerNeedsAreas({ y: 40, action: { type: 'build', layer: {} } }, [{ count: 12 }], [])).toBe(false)
  })

  it('跨空间的复合实物账本整行及共享实体一起归属，灰邻接参照不重复计料', () => {
    // 仅用于隔离分区规则的坐标夹具，不声明为真实搭建验证。
    const model: any = { nodes: new Map([['a', { x: 0, y: 40, z: 0 }], ['b', { x: 100, y: 40, z: 0 }], ['c', { x: 200, y: 40, z: 0 }]]), tubes: new Map() }
    const allocations = [{ id: 'ab', group: 'connectors', key: 'compound', count: 2, partIds: ['a', 'b'] }, { id: 'bextra', group: 'connectors', key: 'bore', count: 1, partIds: ['b'] }, { id: 'c', group: 'tubes', key: 'tube', count: 1, partIds: ['c'] }]
    const areas = partitionReadingLayer(model, ['c', 'b', 'a'], allocations)
    expect(areas.flatMap((area: any) => area.allocations)).toHaveLength(3)
    const compound = areas.find((area: any) => area.allocations.some((row: any) => row.id === 'ab'))!
    expect(compound.allocations.map((row: any) => row.id)).toEqual(['ab', 'bextra'])
    expect(compound.partIds).toEqual(['a', 'b'])
    const items = [{ kind: 'connectors', ledgerKey: 'compound', num: 1 }, { kind: 'connectors', ledgerKey: 'bore', num: 2 }, { kind: 'tubes', ledgerKey: 'tube', num: 3 }]
    expect(areas.flatMap((area: any) => readingMaterials(items, area.allocations)).reduce((sum: number, row: any) => sum + row.count, 0)).toBe(4)
    expect(partitionReadingLayer(model, ['a', 'b', 'c'], allocations)).toEqual(areas)
  })

  it('同区域多次attach不重复领取预拼源步，保留原失败诊断', () => {
    const pre = { id: 'pre', regionId: 'roof', partIds: ['a'], action: { type: 'preassemble', scope: 'parts', partIds: ['a'] } }
    const plan: any = { steps: [pre, { id: 'first', regionId: 'roof', partIds: [], dependsOn: ['pre'], action: { type: 'attach', partIds: ['a'] } }, { id: 'second', regionId: 'roof', partIds: [], dependsOn: ['pre'], action: { type: 'attach', partIds: ['a'] } }], regions: [], ledger: { instances: [{ id: 'one', stepId: 'pre', group: 'tubes', key: 'tube', count: 1, partIds: ['a'] }] }, canExport: false, diagnostics: [{ code: 'UNVERIFIED' }] }
    const model: any = { nodes: new Map(), tubes: new Map() }
    const reading = createAssemblyReadingPlan(model, plan, { items: [{ kind: 'tubes', ledgerKey: 'tube' }], copy: {} })
    expect(reading.steps.map((entry: any) => entry.sourceIndices)).toEqual([[0, 1], [2]])
    expect(reading.steps.flatMap((entry: any) => entry.allocations)).toHaveLength(1)
    expect(reading.canExport).toBe(false)
    expect(reading.diagnostics).toBe(plan.diagnostics)
  })

  it('定位图核对真实全模型八角投影及padding，裁切或缺失角点均失败', () => {
    const bounds = { min: [-10, 0, -20], max: [10, 40, 20] }
    let seen: any[] = []
    const scene = { projectWorld: (points: any[], aspect: number) => { seen = points; expect(aspect).toBe(35 / 29); return points.map(point => ({ u: .5 + point[0] / 40, v: .2 + point[1] / 80 })) } }
    expect(projectReadingLocatorBounds(scene, bounds, 35 / 29).complete).toBe(true)
    expect(seen).toContainEqual([-10, 0, -20]); expect(seen).toContainEqual([10, 40, 20]); expect(seen).toHaveLength(8)
    expect(projectReadingLocatorBounds({ projectWorld: () => Array(8).fill({ u: 1.01, v: .5 }) }, bounds, 1).complete).toBe(false)
    expect(projectReadingLocatorBounds({ projectWorld: () => [null] }, bounds, 1).complete).toBe(false)
  })
})
