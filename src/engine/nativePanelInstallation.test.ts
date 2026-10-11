import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { computeBOM } from './bom.js'
import { computeAssemblyPlan } from './assemblyPlan.js'
import { beginAssemblyCollisionPass, checkAssemblyPath, partEnvelope } from './assemblyCollision.js'
import { assemblyMeshes } from './assemblyNativeMesh.js'

beforeAll(async () => { await loadCatalog() })

// 隔离的真实40厘米方框：验证工厂板几何、安装前提及完整装配账本。
function cube(height = 40) {
  const model = new BuildModel(), nodes = new Map<string, any>()
  const at = (x: number, y: number, z: number) => {
    const key = [x, y, z].join(',')
    if (!nodes.has(key)) nodes.set(key, model.addNode(x + 2.5, y + 2.5, z + 2.5))
    return nodes.get(key)
  }
  for (const y of [0, height]) for (const z of [0, 40]) model.addTube(at(0, y, z).id, at(40, y, z).id, 'T35', 'blue', 35)
  for (const y of [0, height]) for (const x of [0, 40]) model.addTube(at(x, y, 0).id, at(x, y, 40).id, 'T35', 'blue', 35)
  for (const x of [0, 40]) for (const z of [0, 40]) model.addTube(at(x, 0, z).id, at(x, height, z).id, height === 20 ? 'T15' : 'T35', 'blue', height - 5)
  const probe = model.confirmedMounts('panel_40x40', { deduplicate: false }).find((candidate: any) => {
    return candidate.valid && model.panelCorners(candidate)?.every((point: number[]) => Math.abs(point[1] - height - 2.5) < 0.01)
  })!
  expect(probe).toBeTruthy()
  return { model, probe }
}

describe('工厂普通方板的确认安装入口', () => {
  it('确认组件显式朝外的方向保存后不变，缺省居中仍保持缺省', () => {
    const { model, probe } = cube()
    const panel = model.addConfirmedComponent({ ...probe, side: 1 }, 'yellow')!
    expect(panel).toBeTruthy()
    panel.side = 1
    const data = model.toJSON()
    expect((data.panels.find((p: any) => p.id === panel.id) as { side?: number })?.side).toBe(1)
    const restored = new BuildModel()
    expect(restored.loadJSON(data).ok).toBe(true)
    expect(restored.panels.get(panel.id)?.side).toBe(1)
    expect(restored.toJSON()).toEqual(data)
    panel.side = null
    const centered = model.toJSON()
    expect(Object.hasOwn(centered.panels.find((p: any) => p.id === panel.id)!, 'side')).toBe(false)
    expect(restored.loadJSON(centered).ok).toBe(true)
    expect(restored.panels.get(panel.id)?.side).toBeNull()
  })
  it('半高围板保留真实工厂网格、四边支撑与四颗板螺丝', () => {
    const { model } = cube(20)
    const probe = model.confirmedMounts('panel_40x20', { deduplicate: false }).find((p: any) => p.valid)!
    const panel = model.addNativePanel(probe, 'blue')!
    expect(panel).toBeTruthy()
    expect(Object.hasOwn(panel, 'appearanceVersion')).toBe(false)
    expect(model.confirmedDiagnostics(panel).valid).toBe(true)
    beginAssemblyCollisionPass(model)
    expect(partEnvelope(model, panel.id)).toHaveLength(assemblyMeshes()!.surfaceTriangles.panel2_350x150.length)
    const restored = new BuildModel()
    expect(restored.loadJSON(model.toJSON()).ok).toBe(true)
    expect(restored.toJSON()).toEqual(model.toJSON())
    expect(computeBOM(restored).screws.find((r: any) => r.id === 'screw_panel')?.count).toBe(4)
    expect(computeAssemblyPlan(restored).canExport).toBe(true)
  })
  it('真实工厂板网格、四颗板螺丝及完整装配导出保持一致', () => {
    const { model, probe } = cube()
    const panel = model.addNativePanel(probe, 'green')!
    expect(panel).toBeTruthy()
    expect(Object.hasOwn(panel, 'appearanceVersion')).toBe(false)
    expect(Object.hasOwn(panel, 'params')).toBe(false)
    expect(Object.hasOwn(panel, 'mounts')).toBe(false)
    expect(model.confirmedDiagnostics(panel).valid).toBe(true)
    beginAssemblyCollisionPass(model)
    const shapes = partEnvelope(model, panel.id)
    expect(shapes).toHaveLength(assemblyMeshes()!.surfaceTriangles.panel2_350x350.length)
    expect(shapes.every((shape: any) => shape.kind === 'triangle')).toBe(true)
    const bom = computeBOM(model)
    expect(bom.panels).toHaveLength(1)
    expect(bom.panels[0].count).toBe(1)
    expect(bom.screws.find((row: any) => row.id === 'screw_panel')?.count).toBe(4)
    const restored = new BuildModel(), data = model.toJSON()
    expect(restored.loadJSON(data).ok).toBe(true)
    expect(restored.toJSON()).toEqual(data)
    expect(computeBOM(restored)).toEqual(bom)
    const plan = computeAssemblyPlan(restored)
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true)
    expect(plan.diagnostics).toEqual([])
    expect(plan.ledger.conserved).toBe(true)
    expect(plan.ledger.rows.every((row: any) => row.conserved && row.expected === row.assigned)).toBe(true)
    expect(plan.verification).toMatchObject({ directionChecked: true, pathChecked: true, methodChecked: true })
  }, 30000)

  it.each(['vertical', 'horizontal'])('普通板固定位在丢弃无效轴提示后保持一致 screwAxis=%s', screwAxis => {
    const { model, probe } = cube()
    const selected = { ...probe, params: { ...probe.params, screwAxis } }
    const before = model.confirmedDiagnostics(selected)
    expect(before.valid).toBe(true)
    const panel = model.addNativePanel(selected, 'green')!
    expect(panel).toBeTruthy()
    const after = model.confirmedDiagnostics(panel)
    expect(after.valid).toBe(true)
    expect(after.mounts).toEqual(before.mounts)
    expect(after.supportTubes).toEqual(before.supportTubes)
    expect([panel.a, panel.b, panel.t0, panel.len, panel.side]).toEqual([before.a, before.b, before.t0, before.len, before.side])
  })

  it('缺少一条边、重复占位及特殊板均在安装前拒绝', () => {
    const missing = cube()
    const removed = missing.probe.supportTubes.find((id: string) => ![missing.probe.a, missing.probe.b].includes(id))!
    missing.model.removeTube(removed)
    expect(missing.model.addNativePanel(missing.probe, 'green')).toBeNull()
    expect(missing.model.panels.size).toBe(0)
    const occupied = cube()
    expect(occupied.model.addNativePanel(occupied.probe, 'green')).toBeTruthy()
    const before = occupied.model.toJSON()
    expect(occupied.model.addNativePanel(occupied.probe, 'red')).toBeNull()
    expect(occupied.model.addNativePanel({ ...occupied.probe, panelId: 'panel_40x40_clock' }, 'red')).toBeNull()
    expect(occupied.model.toJSON()).toEqual(before)
  })

  it('普通板前后两种安装顺序都保留固定位占用检查', () => {
    const first = cube(), mount = first.probe.mounts[0]
    const sleeve: any = first.model.addFitting('sleeve', 0, 0, 0)
    sleeve.tube = mount.tube
    expect(first.model.confirmedDiagnostics(first.probe).reason).toBe('mount_occupied')
    expect(first.model.addNativePanel(first.probe, 'green')).toBeNull()

    const second = cube()
    expect(second.model.addNativePanel(second.probe, 'green')).toBeTruthy()
    const a = second.model.addNode(82.5, 82.5, 82.5), b = second.model.addNode(122.5, 82.5, 82.5)
    const remote = second.model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const nativeMount = second.probe.mounts[0]
    expect(second.model.ropeDiagnostics({ tube: nativeMount.tube, t: nativeMount.t }, { tube: remote.id, t: 0.5 }).reason).toBe('mount_occupied')
    const restored = new BuildModel()
    expect(restored.loadJSON(second.model.toJSON()).ok).toBe(true)
    expect(restored.ropeDiagnostics({ tube: nativeMount.tube, t: nativeMount.t }, { tube: remote.id, t: 0.5 }).reason).toBe('mount_occupied')
  })

  it('穿过板面中央的真实管件仍然阻止安装路径', () => {
    const { model, probe } = cube(), panel = model.addNativePanel(probe, 'green')!
    const a = model.addNode(22.5, 22.5, 22.5), b = model.addNode(22.5, 62.5, 22.5)
    const obstacle = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    beginAssemblyCollisionPass(model)
    expect(checkAssemblyPath(model, [panel.id], [obstacle.id], [0, 8, 0])).toMatchObject({ obstaclePartId: obstacle.id })
  })

  it('活动板继续保存专用外观和安装记录', () => {
    const { model } = cube()
    const probe = model.confirmedMounts('panel_40x40_clock').find((candidate: any) => candidate.valid)!
    expect(probe).toBeTruthy()
    const panel = model.addConfirmedComponent(probe, 'green')!
    expect(panel.appearanceVersion).toBe(2)
    expect(panel.params.feature).toBe('clock')
    expect(panel.mounts).toHaveLength(4)
  })
})
