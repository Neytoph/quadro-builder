import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeBOM, resolveNodeConnection } from './bom.js'
import { computeAssemblyPlan, assemblyState } from './assemblyPlan.js'
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
    expect(plan.regions.filter((r: any) => r.kind === 'ramp').every((r: any) => r.installation.mode === 'in-place')).toBe(true)
    expect(plan.interfaces).toHaveLength(4)
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

  it('单端立柱沿真实轴线展示待插位置，完成态与源模型不受影响', () => {
    const model = load(), before = model.toJSON(), plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((s: any) => s.kind === 'risers')
    const action = assemblyState(plan, index, { action: true }), complete = assemblyState(plan, index)
    expect(action.arrows).toHaveLength(4)
    for (const id of plan.steps[index].tubeIds) {
      if (model.tubes.get(id)!.link) continue;
      expect(action.transforms.get(id)?.[1]).toBeGreaterThan(0)
      expect(complete.transforms.has(id)).toBe(false)
    }
    expect(action.arrows.every((a: any) => a.direction[1] < -0.99)).toBe(true)
    expect(model.toJSON()).toEqual(before)
  })

  it('闭合框架的双端横管保留安装前支撑，不绘制伪造的单向插入', () => {
    const plan = computeAssemblyPlan(load()), index = plan.steps.findIndex((s: any) => s.kind === 'frame' && s.y === 40)
    const action = assemblyState(plan, index, { action: true }), complete = assemblyState(plan, index)
    expect(action.arrows).toEqual([])
    expect(action.actionStage).toBe('before')
    for (const id of plan.steps[index].tubeIds) { expect(action.visible.has(id)).toBe(false); expect(complete.visible.has(id)).toBe(true) }
  })

  it('单独安装C45和承载接头的步骤在前图保留主体、后图显示新增接头', () => {
    const model = load(), plan = computeAssemblyPlan(model)
    const index = plan.steps.findIndex((step: any) => step.kind === 'frame' && step.nodeIds.some((id: string) => model.nodes.get(id)?.c45file) && !step.parts.tubes.length)
    expect(index).toBeGreaterThan(-1)
    const before = assemblyState(plan, index, { action: true }), after = assemblyState(plan, index)
    expect(before.actionStage).toBe('before')
    for (const id of plan.steps[index].nodeIds) { expect(before.visible.has(id)).toBe(false); expect(after.visible.has(id)).toBe(true) }
    for (const id of plan.steps[index - 1].tubeIds) expect(before.visible.has(id)).toBe(true)
    expect(before.arrows).toEqual([])
  })

  it('预装模块的插管位移叠加区域分离，完成单步仍保留区域分离', () => {
    const model = new BuildModel()
    for (const x of [0, 160]) {
      const a = model.addNode(x, 0, 0), b = model.addNode(x + 40, 0, 0), c = model.addNode(x, 40, 0)
      model.addTube(a.id, b.id, 'T35', 'red', 35); model.addTube(a.id, c.id, 'T35', 'blue', 35)
    }
    const plan = computeAssemblyPlan(model), index = plan.steps.findIndex((s: any) => s.action.type === 'preassemble' && s.kind === 'risers')
    expect(index).toBeGreaterThan(-1)
    const id = plan.steps[index].tubeIds[0], a = assemblyState(plan, index, { action: true }), b = assemblyState(plan, index)
    expect(a.transforms.get(id)?.[1]).toBeGreaterThan(b.transforms.get(id)![1])
    expect(assemblyState(plan, plan.steps.length - 1).transforms.size).toBe(0)
  })
})
