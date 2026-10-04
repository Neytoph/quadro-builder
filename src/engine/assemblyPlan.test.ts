import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeAssemblyPlan as computeRawAssemblyPlan, assemblyState } from './assemblyPlan.js'
import { getLang } from './i18n.js'
import { proposeAssemblyRepairs, resolveNodeConnection } from './connectionResolver.js'

// Native full-mesh verification intentionally exceeds Vitest's default 5 s.
vi.setConfig({ testTimeout: 120000 })
beforeAll(async () => { await loadCatalog() })
const evidence: any[] = []
const fixedPlans = new Map<string, any>()
// Exact inputs only: altered geometry/configuration and language get a fresh plan.
// Each assertion receives a deep copy, so tests cannot modify another's plan.
function computeAssemblyPlan(model: any, config?: any, order?: string) {
  const key = JSON.stringify([getLang(), model.toJSON(), config ?? model.assemblyConfig ?? {}, order ?? 'y+'])
  if (!fixedPlans.has(key)) fixedPlans.set(key, computeRawAssemblyPlan(model, config, order))
  return structuredClone(fixedPlans.get(key))
}
afterAll(() => { mkdirSync('../qa/layer-followup', { recursive: true }); writeFileSync('../qa/layer-followup/engine-evidence.json', JSON.stringify(evidence, null, 2)) })
const load = (file: string) => {
  const model = new BuildModel()
  const text = readFileSync(`public/${file}`, 'utf8')
  const data = file.endsWith('.qdf') ? parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }) : JSON.parse(text)
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}

describe('真实装配区域、连接件与物料守恒', () => {
  it.each(['qdf/C0005.qdf', 'qdf/C0013.qdf'])('%s 原生顶棚在实际支撑落位后从上方装入', file => {
    const model = load(file), plan = computeAssemblyPlan(model)
    const cover = plan.regions.find((r: any) => r.slideIds.some((id: string) => model.slides.get(id)?.kind === 'roof2'))
    expect(cover.accessoryType).toBe('roof-cover')
    expect(cover.name).toMatch(/屋顶配件|Roof accessory|Dachaufsatz/)
    expect(plan.regions.some((r: any) => r.id === cover.supportRegionId)).toBe(true)
    const fit = plan.steps.filter((step: any) => step.regionId === cover.id).flatMap((step: any) => step.operations).find((operation: any) => operation.type === 'fit-accessory' && cover.slideIds.some((id: string) => operation.partIds.includes(id)))
    expect(fit).toBeTruthy()
    expect(fit.placementTranslation).toEqual([0, 0, 0])
    expect(fit.translation).toEqual([0, 18, 0])
    expect(fit.verification.supportPoses.length).toBeGreaterThan(2)
    expect(fit.verification.supportPoses.every((support: any) => support.installed && support.translation.every((value: number) => value === 0))).toBe(true)
  })
  it.each(['qdf/B0012.qdf', 'qdf/C0005.qdf', 'qdf/C0013.qdf', 'qdf/C0156.qdf', 'qdf/C0179.qdf', 'assembly-fixtures/s33.json', 'assembly-fixtures/s36.json'])('%s 全部实体仅一次归属且 BOM 守恒', file => {
    const model = load(file), plan: any = computeAssemblyPlan(model)
    expect(plan.regions.length).toBeGreaterThan(1)
    expect(plan.ledger.rows.filter((r: any) => !r.conserved)).toEqual([])
    expect(plan.diagnostics.filter((d: any) => ['PART_UNASSIGNED', 'BOM_UNASSIGNED', 'DUPLICATE_PART_STEP'].includes(d.code))).toEqual([])
    const ids = plan.steps.filter((s: any) => s.action.type !== 'attach').flatMap((s: any) => s.partIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe([...model.nodes.values(), ...model.tubes.values(), ...model.panels.values(), ...model.textiles.values(), ...model.slides.values(), ...model.fittings.values(), ...model.clamps.values()].length)
    for (const group of ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'screws', 'reinforcements']) expect(plan.steps.reduce((n: number, s: any) => n + s.parts[group].reduce((sum: number, row: any) => sum + row.count, 0), 0)).toBe(plan.bom[group].reduce((n: number, row: any) => n + row.count, 0))
    expect(plan.fixingPoints).toEqual([])
    expect(plan.steps.some((s: any) => s.action.type === 'fix')).toBe(false)
    evidence.push({ file, parts: ids.length, regions: plan.regions.map((r: any) => ({ id: r.id, kind: r.kind, parts: r.partIds.length, nodeIds: r.nodeIds, tubeIds: r.tubeIds, installation: r.installation })), frameModules: plan.frameModules, interfaces: plan.interfaces, actions: plan.steps.map((s: any) => ({ id: s.id, regionId: s.regionId, kind: s.kind, action: s.action.type, scope: s.action.scope, detached: !!s.action.detached, tubeIds: s.tubeIds, partCount: s.partIds.length, interfaceIds: s.interfaceIds })), steps: plan.steps.length, bom: plan.bom.totals, ledger: plan.ledger.rows, diagnostics: plan.diagnostics, canExport: plan.canExport })
  })

  it('s36 用弯管切线识别重复端口，真实修正移除两根 T15并保留支撑和料表', () => {
    const model = load('assembly-fixtures/s36.json'), before = model.toJSON()
    for (const id of ['n35', 'n37']) {
      const connection = resolveNodeConnection(model, id)
      expect(connection.type).toBe('3way')
      expect(connection.diagnostics.some((d: any) => d.code === 'DUPLICATE_CONNECTOR_PORT')).toBe(true)
    }
    expect(computeAssemblyPlan(model).canExport).toBe(false)
    const repair = proposeAssemblyRepairs(model, ['n35', 'n37'])
    expect(repair.canApply, JSON.stringify(repair.diagnostics)).toBe(true)
    expect(repair.changes.map((c: any) => c.tubeId).sort()).toEqual(['t45', 't47'])
    expect(repair.validation.groundConnectivity).toBe(true)
    expect(repair.validation.dependencies).toBe(true)
    expect(repair.validation.loadVerified).toBe(false)
    expect(model.toJSON()).toEqual(before)
    const repaired = new BuildModel(); expect(repaired.loadJSON(repair.data).ok).toBe(true)
    const repairedPlan = computeAssemblyPlan(repaired)
    expect(repairedPlan.diagnostics.filter((diagnostic: any) => diagnostic.code === 'DUPLICATE_CONNECTOR_PORT')).toEqual([])
    expect(repairedPlan.ledger.conserved).toBe(true)
    expect(repairedPlan.verification.physical).toBe('unverified')
    // Removing duplicate ports is a connection repair, not certification of
    // the remaining assembly motions. Keep any located path/closure blockers.
    if (!repairedPlan.canExport) expect(repairedPlan.diagnostics.some((diagnostic: any) => diagnostic.severity === 'error' && diagnostic.partIds.length > 0)).toBe(true)
    evidence.push({ file: 'assembly-fixtures/s36.json repaired', canExport: repairedPlan.canExport, diagnostics: repairedPlan.diagnostics, changes: repair.changes, bomChanges: repair.bomChanges, validation: repair.validation })
  })

  it('尖顶两斜管与顶端弯头一起预装，安装动作分离且不重复计料', () => {
    const model = load('assembly-fixtures/s36.json'), plan = computeAssemblyPlan(model)
    const roof = plan.regions.find((r: any) => r.kind === 'roof')!
    expect(roof).toBeTruthy()
    expect(roof.nodeIds).toContain('n274'); expect(roof.tubeIds.length).toBeGreaterThanOrEqual(2)
    const pre = plan.steps.findIndex((s: any) => s.regionId === roof.id && s.action.type === 'preassemble')
    const attach = plan.steps.findIndex((s: any) => s.regionId === roof.id && s.action.type === 'attach')
    expect(plan.steps[pre].nodeIds).toContain('n274')
    // The preassembly also owns its two C45 topology arms (no extra tubes).
    expect([...plan.steps[pre].tubeIds].sort()).toEqual(['m267', 'm269', 't275', 't276'])
    expect(assemblyState(plan, pre).transforms.has('n274')).toBe(true)
    expect(assemblyState(plan, attach, { action: true }).transforms.has('n274')).toBe(true)
    expect(assemblyState(plan, attach).transforms.has('n274')).toBe(false)
    expect(Object.values(plan.steps[attach].parts).flat()).toEqual([])
  })

  it('配置无效引用和重复区域归属提供诊断并阻止导出', () => {
    const model = load('qdf/B0012.qdf'), first = [...model.tubes.keys()][0]
    const plan = computeAssemblyPlan(model, { version: 1, regions: [{ id: 'a', name: 'a', partIds: [first, 'missing'] }, { id: 'b', name: 'b', partIds: [first] }], order: ['missing'] })
    expect(plan.canExport).toBe(false)
    expect(plan.diagnostics.map((d: any) => d.code)).toEqual(expect.arrayContaining(['UNKNOWN_REGION_PART', 'DUPLICATE_REGION_PART', 'INVALID_REGION_ORDER']))
  })

  it('缺少 C45 的真实直斜管通过 API 创建适配器并移动终点', () => {
    const model = new BuildModel(), base = model.addNode(0, 0, 0)
    for (const p of [[-40, 0, 0], [0, 0, -40]]) { const n = model.addNode(...p); model.addTube(base.id, n.id, 'T35', 'blue', 35) }
    const tip = model.addNode(28.284, 28.284, 0), tube = model.addTube(base.id, tip.id, 'T35', 'blue', 35)!
    expect(resolveNodeConnection(model, base).diagnostics[0].code).toBe('MISSING_C45_ADAPTER')
    const repair = proposeAssemblyRepairs(model, [base.id])
    expect(repair.canApply, JSON.stringify(repair.diagnostics)).toBe(true)
    expect(repair.data!.nodes.some((n: any) => n.c45body)).toBe(true)
    expect(repair.data!.nodes.find((n: any) => n.id === tip.id)!.x).not.toBe(tip.x)
    expect(repair.data!.tubes.find((t: any) => t.id === tube.id)!.a).not.toBe(base.id)
  })

  it('自定义合并区域和x-/z+优先级仍按底框、立柱、上框自底向上', () => {
    const model = load('qdf/B0012.qdf'), auto = computeAssemblyPlan(model)
    const bodyIds = auto.regions.filter((r: any) => r.kind === 'body').flatMap((r: any) => r.partIds)
    for (const order of ['y+', 'x-', 'z+']) {
      const plan = computeAssemblyPlan(model, { version: 1, regions: [{ id: 'merged-body', name: '合并主体', partIds: bodyIds }] }, order)
      const structural = plan.steps.filter((s: any) => s.regionId === 'merged-body' && ['frame', 'risers'].includes(s.kind))
      expect(structural.length).toBeGreaterThanOrEqual(2)
      expect(new Set(structural.map((s: any) => s.y)).size).toBe(structural.length)
      expect(structural.map((s: any) => s.y)).toEqual(structural.map((s: any) => s.y).sort((a: number, b: number) => a - b))
      expect(plan.ledger.conserved).toBe(true)
      // A region/order edit cannot certify the same unresolved rigid closure.
      expect(plan.canExport).toBe(false)
      expect(plan.diagnostics.some((d: any) => d.code === 'UNRESOLVED_FRAME_CLOSURE' && d.partIds.length > 0)).toBe(true)
      expect(plan.verification.methodChecked).toBe(false)
    }
  })

  it('反转用户区域顺序不改变接口支撑来源，topo排序保留稳定物理依赖', () => {
    const model = load('assembly-fixtures/s33.json'), original = computeAssemblyPlan(model)
    const config = { version: 1, regions: original.regions.map((r: any) => ({ id: r.id, name: r.name, partIds: r.partIds })), order: original.regions.map((r: any) => r.id).reverse() }
    const reversed = computeAssemblyPlan(model, config)
    expect(reversed.interfaces.map((i: any) => [i.sourceRegionId, i.targetRegionId, i.nodeId])).toEqual(original.interfaces.map((i: any) => [i.sourceRegionId, i.targetRegionId, i.nodeId]))
    expect(reversed.canExport).toBe(original.canExport)
    const blockers = (plan: any) => plan.diagnostics.filter((item: any) => item.severity === 'error').map((item: any) => [item.code, [...item.partIds].sort().join('|')].join(':')).sort()
    expect(blockers(reversed)).toEqual(blockers(original))
    for (const step of reversed.steps) for (const id of step.dependsOn) expect(reversed.steps.findIndex((s: any) => s.id === id)).toBeLessThan(reversed.steps.indexOf(step))
  })

  it('屋顶共同竖直插接轴通过真实管径通道检查，横穿安装空间的管件被定位阻止', () => {
    const model = load('assembly-fixtures/s33.json'), clear = computeAssemblyPlan(model)
    const roof = clear.regions.find((r: any) => r.kind === 'roof')!
    expect(roof.installation.commonAxis).toBe(true); expect(roof.installation.pathVerified).toBe(true)
    expect(roof.detachedTranslation[1]).toBeGreaterThan(0)
    const a = model.addNode(-60, 102, 0), b = model.addNode(20, 102, 0)
    const obstruction = model.addTube(a.id, b.id, 'T75', 'blue', 75)!
    const blocked = computeAssemblyPlan(model)
    expect(blocked.canExport).toBe(false)
    expect(blocked.diagnostics.some((d: any) => d.code === 'INSTALLATION_PATH_BLOCKED' && d.partIds.includes(obstruction.id))).toBe(true)
  })

  it('保存型号与朝向必须容纳实际端口，不能以臂数量替代形状', () => {
    const model = new BuildModel(), center = model.addNode(0, 0, 0)
    for (const x of [-40, 40]) { const n = model.addNode(x, 0, 0); model.addTube(center.id, n.id, 'T35', 'blue', 35) }
    center.preferType = '3way'
    expect(resolveNodeConnection(model, center).diagnostics.map((d: any) => d.code)).toContain('INCOMPATIBLE_CONNECTOR_TYPE')
    center.preferType = 'elbow'
    expect(resolveNodeConnection(model, center).canExport).toBe(false)
    center.preferType = 't'
    expect(resolveNodeConnection(model, center).canExport).toBe(true)
    center.quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
    expect(resolveNodeConnection(model, center).canExport).toBe(false)
  })

  it('修正保留区域编辑并清理删去管件后的空区域和order引用', () => {
    const model = load('assembly-fixtures/s36.json')
    model.assemblyConfig = { version: 1, regions: [{ id: 'removed-riser', name: '冲突柱', partIds: ['t45', 't47'] }], order: ['removed-riser'] }
    const proposal = proposeAssemblyRepairs(model, ['n35', 'n37'])
    expect(proposal.canApply).toBe(true)
    expect(proposal.data!.assemblyConfig.regions).toEqual([])
    expect(proposal.data!.assemblyConfig.order).toEqual([])
  })

  it('相互独立的落地主体原位按层搭建，独立上框分次下套且无物料重计', () => {
    const model = new BuildModel()
    for (const offset of [0, 160]) {
      const a = model.addNode(offset, 0, 0), b = model.addNode(offset + 40, 0, 0), c = model.addNode(offset, 40, 0), d = model.addNode(offset + 40, 40, 0)
      for (const [from, to] of [[a, b], [a, c], [b, d], [c, d]]) model.addTube(from.id, to.id, 'T35', 'blue', 35)
    }
    const plan = computeAssemblyPlan(model), bodies = plan.regions.filter((r: any) => r.kind === 'body')
    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      const structural = plan.steps.filter((step: any) => step.regionId === body.id)
      expect(structural.map((step: any) => step.y)).toEqual([0, 40])
      expect(structural.every((step: any) => step.action.type === 'build' && !step.action.detached)).toBe(true)
      const upper = structural[1], module = plan.frameModules.find((part: any) => part.regionId === body.id && part.status === 'lowerable')
      expect(module).toBeTruthy()
      const index = plan.steps.indexOf(upper), action = assemblyState(plan, index, { action: true }), complete = assemblyState(plan, index)
      expect(module.partIds.every((id: string) => action.transforms.has(id))).toBe(true)
      expect(module.partIds.every((id: string) => !complete.transforms.has(id))).toBe(true)
      expect(upper.operations.some((operation: any) => operation.type === 'lower-frame')).toBe(true)
    }
    expect(plan.steps.some((step: any) => step.action.type === 'attach')).toBe(false)
    expect(plan.steps.filter((s: any) => !s.action.layer && !['attach', 'join'].includes(s.action.type)).every((s: any) => s.interfaceIds.length === 0)).toBe(true)
    expect(plan.canExport).toBe(true)
  })
})
