import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeAssemblyPlan, assemblyState } from './assemblyPlan.js'

const evidenceDir = '../qa/frame-followup'
const records: any[] = []
beforeAll(async () => { await loadCatalog(); mkdirSync(evidenceDir, { recursive: true }) })
afterAll(() => writeFileSync(`${evidenceDir}/frame-engine-evidence.json`, JSON.stringify(records, null, 2)))
function load(file: string) {
  const model = new BuildModel(), text = readFileSync(`public/${file}`, 'utf8')
  const data = file.endsWith('.qdf') ? parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }) : JSON.parse(text)
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}
const stepRecord = (s: any) => ({ id: s.id, title: s.title, y: s.y, kind: s.kind, action: s.action, nodeIds: s.nodeIds, tubeIds: s.tubeIds, partIds: s.partIds, interfaceIds: s.interfaceIds })

describe('上层水平框架真实预装与套入', () => {
  it('记录C0179本轮计划，保留原始比较快照', () => {
    const model = load('qdf/C0179.qdf'), plan = computeAssemblyPlan(model)
    records.push({ file: 'C0179', steps: plan.steps.map(stepRecord), frameModules: plan.frameModules, canExport: plan.canExport, diagnostics: plan.diagnostics })
  })

  it('C0179的20/80/120cm全部水平框架连同顶接头旁拼，下方立柱先装且不随模块移动', () => {
    const model = load('qdf/C0179.qdf'), before = model.toJSON(), plan = computeAssemblyPlan(model)
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true)
    const baseline = existsSync(`${evidenceDir}/C0179-baseline.json`) ? JSON.parse(readFileSync(`${evidenceDir}/C0179-baseline.json`, 'utf8')) : null
    for (const [y, count] of [[20, 4], [80, 21], [120, 14]]) {
      const modules = plan.frameModules.filter((m: any) => m.y === y && m.status === 'preassembled')
      const ids = modules.flatMap((m: any) => m.tubeIds)
      expect(ids).toHaveLength(count)
      if (baseline) expect(ids.sort()).toEqual(baseline.steps.find((s: any) => s.y === y && s.kind === 'frame').tubeIds.sort())
      for (const module of modules) {
        const preIndex = plan.steps.findIndex((s: any) => s.id === module.prepareStepId), attachIndex = plan.steps.findIndex((s: any) => s.id === module.attachStepId)
        const attach = plan.steps[attachIndex]
        expect(attachIndex).toBe(preIndex + 1)
        expect(Object.values(attach.parts).flat()).toEqual([])
        const beforeState = assemblyState(plan, preIndex, { action: true }), prepared = assemblyState(plan, preIndex)
        expect(beforeState.actionStage).toBe('before'); expect(beforeState.arrows).toEqual([])
        for (const id of module.partIds) {
          expect(beforeState.visible.has(id)).toBe(false)
          expect(prepared.visible.has(id)).toBe(true)
          expect(prepared.transforms.get(id)).toEqual(module.prepareTranslation)
        }
        const installing = assemblyState(plan, attachIndex, { action: true }), installed = assemblyState(plan, attachIndex)
        expect(installing.arrows.length).toBeGreaterThan(0)
        for (const arrow of installing.arrows) { expect(arrow.direction.map((v: number) => v || 0)).toEqual([0, -1, 0]); expect(arrow.from[1]).toBeGreaterThan(arrow.to[1]); expect(arrow.from[0]).toBe(arrow.to[0]); expect(arrow.from[2]).toBe(arrow.to[2]) }
        for (const id of module.partIds) { expect(installing.transforms.get(id)).toEqual(module.installationTranslation); expect(installed.transforms.has(id)).toBe(false) }
        for (const mark of plan.interfaces.filter((m: any) => m.assemblyId === module.id) as any[]) {
          const supportIndex = plan.steps.findIndex((s: any) => s.id === mark.supportStepId)
          expect(supportIndex).toBeLessThan(preIndex)
          expect(installing.transforms.has(mark.supportTubeId)).toBe(false)
          expect(installing.visible.has(mark.supportTubeId)).toBe(true)
          expect(plan.steps.slice(0, preIndex).some((s: any) => s.nodeIds.includes(mark.nodeId))).toBe(false)
        }
        expect(module.installation.pathVerified).toBe(true)
        for (let i = 0; i < module.installation.pathSamples.length; i++) {
          const a = module.transportPath[i], b = module.transportPath[i + 1]
          expect(Math.hypot(...a.map((v: number, j: number) => v - b[j])) / (module.installation.pathSamples[i] - 1)).toBeLessThanOrEqual(geometry().tubeRadius + 1e-8)
        }
      }
    }
    expect(new Set(plan.interfaces.map((m: any) => m.id)).size).toBe(plan.interfaces.length)
    expect(plan.fixingPoints).toEqual([]); expect(plan.steps.some((s: any) => s.action.type === 'fix')).toBe(false)
    expect(plan.ledger.conserved).toBe(true); expect(model.toJSON()).toEqual(before)
  })

  it('上层模块保持自底向上，改变无依赖区域优先级不会先装顶接头', () => {
    const model = load('qdf/C0179.qdf')
    for (const order of ['y+', 'x-', 'z+']) {
      const plan = computeAssemblyPlan(model, {}, order)
      const steps = plan.steps.filter((s: any) => s.regionId === plan.frameModules[0].regionId && (s.action.scope === 'parts' || ['frame', 'risers'].includes(s.kind)))
      expect(steps.map((s: any) => s.y)).toEqual(steps.map((s: any) => s.y).sort((a: number, b: number) => a - b))
      expect(plan.canExport).toBe(true)
    }
  })

  it('实际路径被穿过框架的已装管件阻挡时保留在位规划，不给虚假下套箭头', () => {
    const model = new BuildModel(), low = [], high = []
    for (const [x, z] of [[0, 0], [40, 0], [40, 40], [0, 40]]) { low.push(model.addNode(x, 0, z)); high.push(model.addNode(x, 40, z)) }
    for (let i = 0; i < 4; i++) { model.addTube(low[i].id, low[(i + 1) % 4].id, 'T35', 'blue', 35); model.addTube(low[i].id, high[i].id, 'T35', 'blue', 35); model.addTube(high[i].id, high[(i + 1) % 4].id, 'T35', 'blue', 35) }
    const foot = model.addNode(20, 0, 0), tip = model.addNode(20, 80, 0)
    const blocker = model.addTube(foot.id, tip.id, 'T75', 'red', 75)!
    model.addTube(low[0].id, foot.id, 'T15', 'blue', 15)
    const plan = computeAssemblyPlan(model)
    const blocked = plan.frameModules.find((m: any) => m.y === 40 && m.reason === 'installation-path-blocked')
    expect(blocked, JSON.stringify(plan.frameModules)).toBeTruthy()
    expect(blocked.obstruction.obstacleTubeId).toBe(blocker.id)
    expect(blocked.status).toBe('in-place')
    expect(plan.steps.some((s: any) => s.action.scope === 'parts' && s.action.assemblyId === blocked.id)).toBe(false)
    expect(plan.ledger.conserved).toBe(true)
  })

  it('区域整体分离期间，局部上框架位移叠加，不移动下方立柱或提前归位区域', () => {
    const model = new BuildModel()
    for (const offset of [0, 160]) {
      const a = model.addNode(offset, 0, 0), b = model.addNode(offset + 40, 0, 0), c = model.addNode(offset, 40, 0), d = model.addNode(offset + 40, 40, 0)
      for (const [from, to] of [[a, b], [a, c], [b, d], [c, d]]) model.addTube(from.id, to.id, 'T35', 'blue', 35)
    }
    const plan = computeAssemblyPlan(model), region = plan.regions.filter((r: any) => r.kind === 'body')[1]
    const module = plan.frameModules.find((m: any) => m.regionId === region.id && m.status === 'preassembled')!
    expect(module).toBeTruthy()
    const preIndex = plan.steps.findIndex((s: any) => s.id === module.prepareStepId), attachIndex = plan.steps.findIndex((s: any) => s.id === module.attachStepId)
    const prepared = assemblyState(plan, preIndex), installing = assemblyState(plan, attachIndex, { action: true }), installed = assemblyState(plan, attachIndex)
    for (const id of module.partIds) {
      expect(prepared.transforms.get(id)).toEqual(module.prepareTranslation.map((v: number, i: number) => v + region.detachedTranslation[i]))
      expect(installing.transforms.get(id)).toEqual(module.installationTranslation.map((v: number, i: number) => v + region.detachedTranslation[i]))
      expect(installed.transforms.get(id)).toEqual(region.detachedTranslation)
    }
    for (const mark of plan.interfaces.filter((m: any) => m.assemblyId === module.id)) expect(installing.transforms.get(mark.supportTubeId)).toEqual(region.detachedTranslation)
    expect(assemblyState(plan, plan.steps.length - 1).transforms.size).toBe(0)
  })
})
