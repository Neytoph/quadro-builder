import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { getLang } from './i18n.js'
import { computeAssemblyPlan as computeRawAssemblyPlan, assemblyState } from './assemblyPlan.js'
import { framePanelIds, reconcileFrameModulePanels } from './assemblyOperations.js'

vi.setConfig({ testTimeout: 120000 })
const fixturePlans = new Map<string, any>()
function computeAssemblyPlan(model: any, config?: any, order?: string) {
  const key = JSON.stringify([getLang(), model.toJSON(), config ?? model.assemblyConfig ?? {}, order ?? 'y+'])
  if (!fixturePlans.has(key)) fixturePlans.set(key, computeRawAssemblyPlan(model, config, order))
  return structuredClone(fixturePlans.get(key))
}

const evidenceDir = '../qa/layer-followup'
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

describe('本层框架连续展示与真实下套', () => {
  it('记录C0179本轮计划，保留原始比较快照', () => {
    const model = load('qdf/C0179.qdf'), plan = computeAssemblyPlan(model)
    records.push({ file: 'C0179', steps: plan.steps.map(stepRecord), frameModules: plan.frameModules, canExport: plan.canExport, diagnostics: plan.diagnostics })
  })

  it('板面随整组支撑管下套，完成态回到支撑框架上', () => {
    const model = load('qdf/C0179.qdf'), plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => step.action.layer && step.panelIds.includes('p395'))
    expect(index).toBeGreaterThanOrEqual(0)
    const step = plan.steps[index], module = step.action.modules.find((item: any) => item.partIds.includes('p395'))
    expect(module, JSON.stringify(step.action.modules)).toBeTruthy()
    expect(module.partIds).toEqual(expect.arrayContaining(['t232', 't233', 't234', 't235']))
    const moving = assemblyState(plan, index, { action: true }), complete = assemblyState(plan, index)
    expect(moving.transforms.get('p395')).toEqual(module.translation)
    expect(complete.transforms.has('p395')).toBe(false)

    const carried: string[] = []
    for (const [stepIndex, layer] of plan.steps.entries()) for (const frame of layer.action.modules || []) {
      const frameTubes = new Set(frame.partIds.filter((id: string) => model.tubes.has(id)))
      for (const panelId of layer.panelIds || []) {
        const supports = layer.panelSupports?.[panelId] || []
        if (!supports.length || !supports.every((id: string) => frameTubes.has(id))) continue
        expect(frame.partIds).toContain(panelId)
        expect(assemblyState(plan, stepIndex, { action: true }).transforms.get(panelId)).toEqual(frame.translation)
        carried.push(panelId)
      }
    }
    expect(new Set(carried).size).toBeGreaterThan(1)
  })

  it('区域清单缺少板件时仍根据全部支撑管归入可移动框架', () => {
    const model = load('qdf/C0179.qdf'), panel = model.panels.get('p395')
    const panelOnlyModel = Object.create(model)
    panelOnlyModel.panels = new Map([[panel.id, panel]])
    expect(framePanelIds(panelOnlyModel, ['t232', 't233', 't234', 't235'])).toEqual(['p395'])

    const module = { id: 'frame-test', tubeIds: ['t232', 't233', 't234', 't235'], panelIds: [], partIds: ['n45', 't232', 't233', 't234', 't235'], installStepId: 'step-10' }
    const step = { id: 'step-10', panelIds: ['p395'], action: { modules: [{ id: module.id, partIds: [...module.partIds] }], inPlacePartIds: ['p395'] } }
    reconcileFrameModulePanels(panelOnlyModel, [module], [step])
    expect(module.partIds).toContain('p395')
    expect(step.action.modules[0].partIds).toContain('p395')
    expect(step.action.inPlacePartIds).not.toContain('p395')
  })

  it('C0179的20/80/120cm各合并为一层，39根横管和顶接头真实下套且立柱不移动', () => {
    const model = load('qdf/C0179.qdf'), before = model.toJSON(), plan = computeAssemblyPlan(model)
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true)
    const baseline = JSON.parse(readFileSync('tests/fixtures/assembly/C0179-baseline.json', 'utf8'))
    expect(plan.steps.some((s: any) => s.action.scope === 'parts' && s.action.type === 'preassemble')).toBe(false)
    for (const [y, count] of [[20, 4], [80, 21], [120, 14]]) {
      const modules = plan.frameModules.filter((m: any) => m.y === y && m.status === 'lowerable')
      const ids = modules.flatMap((m: any) => m.tubeIds)
      expect(ids).toHaveLength(count)
      expect(ids.sort()).toEqual(baseline.steps.find((s: any) => s.y === y && s.kind === 'frame').tubeIds.sort())
      const layerIndices = plan.steps.map((s: any, i: number) => s.y === y && s.action.layer && s.regionId === modules[0].regionId ? i : -1).filter((i: number) => i >= 0)
      expect(layerIndices).toHaveLength(1)
      const index = layerIndices[0], step = plan.steps[index]
      expect(ids.every((id: string) => step.tubeIds.includes(id))).toBe(true)
      const risers = step.tubeIds.filter((id: string) => !ids.includes(id))
      expect(risers.every((id: string) => { const tube = model.tubes.get(id)!; return tube.arm || tube.link || Math.abs(model.nodes.get(tube.a)!.y - model.nodes.get(tube.b)!.y) > 0.6 })).toBe(true)
      expect(step.action.modules).toHaveLength(modules.length)
      expect(step.instructions.join(' ')).toMatch(/先拼好|Preassemble|vormontieren/)
      expect(step.parts.tubes.reduce((n: number, r: any) => n + r.count, 0)).toBe(step.tubeIds.filter((id: string) => { const tube = model.tubes.get(id)!; return !tube.arm && !tube.link }).length)
      const installing = assemblyState(plan, index, { action: true }), installed = assemblyState(plan, index)
      expect(installing.actionStage).toBe('installation')
      for (const id of plan.steps.slice(0, index).flatMap((s: any) => s.partIds)) { expect(installing.visible.has(id)).toBe(true); expect(installing.transforms.has(id)).toBe(false) }
      expect(installing.arrows.length).toBeGreaterThan(0)
      for (const arrow of installing.arrows) { expect(arrow.direction[0]).toBeCloseTo(0, 8); expect(arrow.direction[1]).toBe(-1); expect(arrow.direction[2]).toBeCloseTo(0, 8); expect(arrow.from[1]).toBeGreaterThan(arrow.to[1]); expect(arrow.from[0]).toBe(arrow.to[0]); expect(arrow.from[2]).toBe(arrow.to[2]) }
      for (const module of modules) {
        expect(module.installStepId).toBe(step.id)
        for (const id of module.partIds) {
          expect(installing.visible.has(id)).toBe(true)
          expect(installed.visible.has(id)).toBe(true)
          expect(installing.transforms.get(id)).toEqual(module.installationTranslation)
          expect(installed.transforms.has(id)).toBe(false)
          expect(plan.steps.slice(0, index).some((s: any) => s.partIds.includes(id))).toBe(false)
        }
        for (const mark of plan.interfaces.filter((m: any) => m.assemblyId === module.id) as any[]) {
          const supportIndex = plan.steps.findIndex((s: any) => s.id === mark.supportStepId)
          expect(supportIndex).toBeLessThan(index)
          expect(installing.transforms.has(mark.supportTubeId)).toBe(false)
          expect(installing.visible.has(mark.supportTubeId)).toBe(true)
          expect(plan.steps.slice(0, index).some((s: any) => s.nodeIds.includes(mark.nodeId))).toBe(false)
        }
        expect(module.installation.pathVerified).toBe(true)
        for (let i = 0; i < module.installation.pathSamples.length; i++) {
          const a = module.transportPath[i], b = module.transportPath[i + 1]
          expect(Math.hypot(...a.map((v: number, j: number) => v - b[j])) / (module.installation.pathSamples[i] - 1)).toBeLessThanOrEqual(geometry().tubeRadius + 1e-8)
        }
      }
      for (const id of step.action.inPlacePartIds) { expect(installing.transforms.has(id)).toBe(false); expect(installing.visible.has(id)).toBe(false); expect(installed.visible.has(id)).toBe(true) }
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
    expect(plan.steps.some((s: any) => s.action.modules?.some((m: any) => m.id === blocked.id))).toBe(false)
    expect(plan.ledger.conserved).toBe(true)
  })

  it('独立落地主体的上框架下套，支撑立柱原位且完成后无偏移', () => {
    const model = new BuildModel()
    for (const offset of [0, 160]) {
      const a = model.addNode(offset, 0, 0), b = model.addNode(offset + 40, 0, 0), c = model.addNode(offset, 40, 0), d = model.addNode(offset + 40, 40, 0)
      for (const [from, to] of [[a, b], [a, c], [b, d], [c, d]]) model.addTube(from.id, to.id, 'T35', 'blue', 35)
    }
    const plan = computeAssemblyPlan(model), region = plan.regions.filter((r: any) => r.kind === 'body')[1]
    const module = plan.frameModules.find((m: any) => m.regionId === region.id && m.status === 'lowerable')!
    expect(module).toBeTruthy()
    const index = plan.steps.findIndex((s: any) => s.id === module.installStepId)
    const installing = assemblyState(plan, index, { action: true }), installed = assemblyState(plan, index)
    for (const id of module.partIds) {
      expect(plan.steps[index].action.detached).toBe(false)
      expect(installing.transforms.get(id)).toEqual(module.installationTranslation)
      expect(installed.transforms.has(id)).toBe(false)
    }
    for (const mark of plan.interfaces.filter((m: any) => m.assemblyId === module.id)) expect(installing.transforms.has(mark.supportTubeId)).toBe(false)
    expect(assemblyState(plan, plan.steps.length - 1).transforms.size).toBe(0)
  })

  it('同层状态按各模块自己的clearance生成动作，不把互不相连的框架伪造为一整块', () => {
    const plan = computeAssemblyPlan(load('qdf/C0179.qdf'))
    const index = plan.steps.findIndex((s: any) => s.y === 80 && s.action.layer), step = plan.steps[index]
    // 状态接口的独立位移回归：仅调整测试快照，不作为物理路径验证证据。
    step.action.modules = step.action.modules.map((m: any, i: number) => ({ ...m, translation: [0, 18 + 5 * i, 0] }))
    const state = assemblyState(plan, index, { action: true })
    expect(new Set(step.action.modules.map((m: any) => m.translation[1])).size).toBe(4)
    const used = new Set()
    for (const module of step.action.modules) {
      for (const id of module.partIds) { expect(used.has(id)).toBe(false); used.add(id); expect(state.transforms.get(id)).toEqual(module.translation) }
      for (const arrow of state.arrows.filter((a: any) => a.assemblyId === module.id)) { expect(arrow.from[1] - arrow.to[1]).toBe(module.translation[1]); expect(arrow.direction).toEqual([0, -1, 0]) }
    }
    expect(state.arrows).toHaveLength(step.interfaceIds.length)
    expect(assemblyState(plan, index).transforms.size).toBe(0)
  })
})
