import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeBOM, resolveNodeConnection } from './bom.js'
import { computeAssemblyPlan, assemblyState, assemblyDetailState } from './assemblyPlan.js'
import { SceneManager } from './scene.js'
import { buildQDF } from './qdfexport.js'

beforeAll(async () => { await loadCatalog() })
const load = (file = 'A0016') => {
  const model = new BuildModel()
  const data = parseQDF(readFileSync(`public/qdf/${file}.qdf`, 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}

describe('官方 A0016 旋转 C45 与真实装配动作', () => {
  it('四个文件 C45 以真实朝向接入底轨，保存实体位置和管长', () => {
    const model = load(), scene = Object.create(SceneManager.prototype)
    const adapters = [...model.nodes.values()].filter((n: any) => n.c45file)
    expect(adapters).toHaveLength(4)
    expect([...model.tubes.values()].filter((t: any) => !t.arm && !t.link)).toHaveLength(24)
    expect(computeBOM(model).connectors.find((row: any) => row.type === 'diagonal')?.count).toBe(4)
    for (const node of adapters) {
      const link = [...model.tubes.values()].find((t: any) => t.link && (t.a === node.id || t.b === node.id))!
      expect(link).toBeTruthy()
      const endpoint = model.nodes.get(link.a === node.id ? link.b : link.a)!
      const matrix = scene._c45Placement(model, node)
      const connectorMouth = new THREE.Vector3(10.83 - 3.61 * Math.SQRT1_2, 3.61 * Math.SQRT1_2, 0).applyMatrix4(matrix)
      expect(connectorMouth.distanceTo(new THREE.Vector3(endpoint.x, endpoint.y, endpoint.z))).toBeLessThan(0.015)
      const actualTubeEnd = new THREE.Vector3(6.517, 4.313, 0).applyMatrix4(matrix)
      expect(Math.abs(actualTubeEnd.y)).toBeLessThan(0.015)
      expect(Math.abs(actualTubeEnd.z)).toBeCloseTo(57.5, 1)
      expect(resolveNodeConnection(model, node).types.filter((id: string) => id === 'diagonal')).toHaveLength(1)
      expect(resolveNodeConnection(model, node).worldDirs).toHaveLength(3)
      expect(resolveNodeConnection(model, node).type).toBe(node.z < 0 ? '3way' : 't')
    }
    const plan = computeAssemblyPlan(model)
    expect(plan.canExport, JSON.stringify(plan.diagnostics)).toBe(true)
    expect(plan.regions.filter((r: any) => r.kind === 'ramp').every((r: any) => r.installation.commonAxis && r.installation.pathVerified)).toBe(true)
    expect(plan.interfaces.filter((m: any) => m.directionBasis === 'qdf-file-C45-mouth-and-matching-receiver-axis')).toHaveLength(4)
    expect(plan.interfaces.filter((m: any) => m.attachment !== 'upper-frame')).toHaveLength(4)
    expect(plan.interfaces.filter((m: any) => m.attachment === 'upper-frame')).toHaveLength(4)
    expect(assemblyState(plan, plan.steps.length - 1).transforms.size).toBe(0)
    const reopened = new BuildModel(); expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(computeBOM(reopened).connectors.find((row: any) => row.type === 'diagonal')?.count).toBe(4)
    const qdf = buildQDF(model), roundtrip = new BuildModel()
    expect(roundtrip.loadJSON(parseQDF(qdf.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })).ok).toBe(true)
    expect([...roundtrip.tubes.values()].filter((t: any) => t.link)).toHaveLength(4)
    expect(computeBOM(roundtrip).connectors.find((row: any) => row.type === 'diagonal')?.count).toBe(4)
  })

  it('既有 C45body 与 c45file 共用一个实体，不重复计料', () => {
    const model = load('C0005'), expected = [...model.nodes.values()].filter((n: any) => n.c45file).length
    expect(expected).toBeGreaterThan(0)
    expect(computeBOM(model).connectors.find((row: any) => row.type === 'diagonal')?.count).toBe(expected)
  })

  it('合层后的四根立柱仍有独立沿真实轴线的详图动作，完成态与源模型不受影响', () => {
    const model = load(), before = model.toJSON(), plan = computeAssemblyPlan(model)
    const columns = [...model.tubes.values()].filter((tube: any) => !tube.arm && !tube.link && Math.abs(model.nodes.get(tube.a)!.y - model.nodes.get(tube.b)!.y) > 10 && Math.hypot(model.nodes.get(tube.a)!.x - model.nodes.get(tube.b)!.x, model.nodes.get(tube.a)!.z - model.nodes.get(tube.b)!.z) < 0.01)
    expect(columns).toHaveLength(4)
    for (const tube of columns) {
      const index = plan.steps.findIndex((step: any) => step.operations.some((op: any) => op.type === 'insert-tube' && op.partIds.includes(tube.id)))
      const step = plan.steps[index], op = step.operations.find((op: any) => op.type === 'insert-tube' && op.partIds.includes(tube.id))
      const group = step.detailGroups.find((group: any) => group.operationIds.includes(op.id))
      const action = assemblyDetailState(plan, index, group.id, { action: true }), complete = assemblyDetailState(plan, index, group.id)
      expect(op.direction[1]).toBeLessThan(-0.99)
      expect(action.arrows.some((arrow: any) => arrow.id === op.id && arrow.direction[1] < -0.99)).toBe(true)
      const a = action.transforms.get(tube.id) || [0, 0, 0], b = complete.transforms.get(tube.id) || [0, 0, 0]
      expect(a.map((v: number, axis: number) => v - b[axis])).toEqual(op.translation)
    }
    expect(model.toJSON()).toEqual(before)
  })

  it('闭合框架按层展示，整体向下套入立柱，不绘制双端横管的伪造单向插入', () => {
    const plan = computeAssemblyPlan(load()), index = plan.steps.findIndex((s: any) => s.action.layer && s.y === 40)
    expect(index).toBeGreaterThan(-1)
    const action = assemblyState(plan, index, { action: true }), complete = assemblyState(plan, index)
    expect(action.arrows).toHaveLength(4)
    for (const id of plan.steps[index].partIds) { expect(action.visible.has(id)).toBe(true); expect(complete.visible.has(id)).toBe(true); expect(action.transforms.get(id)?.[1]).toBeGreaterThan(0); expect(complete.transforms.has(id)).toBe(false) }
    expect(action.arrows.every((a: any) => a.direction[1] < -0.99)).toBe(true)
    expect(plan.steps[index].parts.tubes.reduce((sum: number, r: any) => sum + r.count, 0)).toBe(4)
    expect(plan.steps.some((s: any) => s.action.scope === 'parts' && s.action.type === 'preassemble')).toBe(false)
  })

  it('C45随真实坡道框架预装，详图接合时接头可见且没有独立假主体', () => {
    const model = load(), plan = computeAssemblyPlan(model)
    for (const corner of [...model.nodes.values()].filter((node: any) => node.c45file)) {
      const region = plan.regions.find((region: any) => region.ownedNodeIds.includes(corner.id))!
      expect(region.kind).toBe('ramp')
      const index = plan.steps.findIndex((step: any) => step.action.type === 'preassemble' && step.nodeIds.includes(corner.id))
      expect(index).toBeGreaterThan(-1)
      const step = plan.steps[index], op = step.operations.find((op: any) => ['insert-tube', 'join-subframes'].includes(op.type) && (op.referencePartIds.includes(corner.id) || op.partIds.includes(corner.id)))!
      expect(op).toBeTruthy()
      const group = step.detailGroups.find((group: any) => group.operationIds.includes(op.id))!
      const action = assemblyDetailState(plan, index, group.id, { action: true }), complete = assemblyDetailState(plan, index, group.id)
      expect(action.visible.has(corner.id)).toBe(true)
      expect(complete.visible.has(corner.id)).toBe(true)
      expect(plan.steps.flatMap((step: any) => step.operations).filter((op: any) => op.consumesPartIds.includes(corner.id))).toHaveLength(1)
    }
  })

  it('真实预装坡道的插管位移叠加区域分离，完成单步仍保留预装位置', () => {
    const model = load(), before = model.toJSON(), plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => step.action.type === 'preassemble' && plan.regions.find((region: any) => region.id === step.regionId)?.kind === 'ramp')
    expect(index).toBeGreaterThan(-1)
    const step = plan.steps[index], region = plan.regions.find((region: any) => region.id === step.regionId)!, op = step.operations.find((op: any) => op.type === 'insert-tube')!, id = op.partIds[0]
    expect(Math.hypot(...region.detachedTranslation)).toBeGreaterThan(0)
    const group = step.detailGroups.find((group: any) => group.operationIds.includes(op.id))!, action = assemblyDetailState(plan, index, group.id, { action: true }), complete = assemblyDetailState(plan, index, group.id)
    const a = action.transforms.get(id) || [0, 0, 0], b = complete.transforms.get(id) || [0, 0, 0]
    expect(a.map((v: number, axis: number) => v - b[axis])).toEqual(op.translation)
    expect(b).toEqual(op.placementTranslation)
    expect(assemblyState(plan, plan.steps.length - 1).transforms.size).toBe(0)
    expect(model.toJSON()).toEqual(before)
  })
})
