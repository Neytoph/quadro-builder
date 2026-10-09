import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, geometry, panels } from './catalog.js'
import { confirmedSpec } from './componentPack.js'
import { confirmedFrame, worldToLocal } from './confirmedComponentModel.js'
import { componentMountsValid, componentObstacle } from './accessoryPack.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { INSET_PANEL_IDS } from './insetPanelMounts.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async () => { await loadCatalog() })

// 用真实模型 API 搭出两格相邻斜框，分别验证安装、几何和保存。
function slopedFrames(id: string, angle = Math.PI / 6, horizontal = false, order = 'rows') {
  // BuildModel 来自 JavaScript，测试中的 any 用于其动态节点和面板记录。
  const model = new BuildModel(), spec = confirmedSpec(id)!, nodes = new Map<string, any>()
  const x = [Math.cos(angle), horizontal ? 0 : Math.sin(angle), horizontal ? Math.sin(angle) : 0]
  const y = horizontal ? [-Math.sin(angle), 0, Math.cos(angle)] : [-Math.sin(angle), Math.cos(angle), 0]
  const node = (u: number, v: number) => {
    const key = `${u},${v}`
    if (!nodes.has(key)) nodes.set(key, model.addNode(x[0] * u + y[0] * v, 82.5 + x[1] * u + y[1] * v, x[2] * u + y[2] * v))
    return nodes.get(key)
  }
  const edge = (u: number, v: number, du: number, dv: number) => {
    const a = node(u, v), b = node(u + du, v + dv)
    if (model.tubeBetween(a.id, b.id)) return
    const span = Math.hypot(du, dv)
    if (span === 60) { edge(u, v, du / 2, dv / 2); edge(u + du / 2, v + dv / 2, du / 2, dv / 2); return }
    const tube = buildableTubes().find((t: any) => t.shape === 'straight' && !t.id.startsWith('TA') && Math.abs(t.length_cm + 5 - span) < .01)!
    expect(tube).toBeTruthy(); expect(model.addTube(a.id, b.id, tube.id, 'green', tube.length_cm)).toBeTruthy()
  }
  if (order === 'cells') {
    for (let i = 0; i < 2; i++) {
      const u = i * spec.width
      edge(u, 0, spec.width, 0); edge(u, spec.height, spec.width, 0)
      edge(u, 0, 0, spec.height); edge(u + spec.width, 0, 0, spec.height)
    }
  } else {
    for (const v of [0, spec.height]) for (let i = 0; i < 2; i++) edge(i * spec.width, v, spec.width, 0)
    for (let i = 0; i < 3; i++) edge(i * spec.width, 0, 0, spec.height)
  }
  const candidates = (screwAxis = 'vertical') => model.panelAccessoryMounts(id, { screwAxis }).filter(part => {
    const corners = model.panelCorners(part)!.map(p => {
      const relative = p.map((n, i) => n - (i === 1 ? 82.5 : 0))
      return [x, y].map(axis => relative.reduce((sum, n, i) => sum + n * axis[i], 0))
    })
    return [0, spec.width].some(start => corners.every(([u, v]) => [start, start + spec.width].some(n => Math.abs(u - n) < .1) && [0, spec.height].some(n => Math.abs(v - n) < .1)))
  }).filter((part, i, all) => all.findIndex(other => Math.hypot(...confirmedFrame(model, other)!.pos.map((v: number, k: number) => v - confirmedFrame(model, part)!.pos[k])) < .1) === i)
  return { model, spec, candidates }
}
const scene = () => ({ _materials: {}, _cachedGeo: (_key: string, make: () => THREE.BufferGeometry) => make() })
const close = (a: number[], b: number[], precision = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], precision))

describe('倾斜方框面板沿真实框边对齐', () => {
  it.each(['panel_40x40', 'hole_panel_40x40', 'panel_40x20', 'panel_40x30_climbing', 'acrylic_panel_40x40', 'acrylic_panel_40x20', 'acrylic_panel_40x60'])('%s 两格斜框可以连续安装，板面与实际边长一致', id => {
    const { model, spec, candidates } = slopedFrames(id), available = candidates()
    expect(available).toHaveLength(2)
    const installed: any[] = []
    for (const [index, initial] of available.entries()) {
      const candidate = index === 1 && INSET_PANEL_IDS.has(id) ? candidates('horizontal').find(p => Math.hypot(...p.pos.map((v: number, i: number) => v - initial.pos[i])) < .1)! : initial
      const part = model.addConfirmedComponent(candidate, 'blue') as any
      expect(part).toBeTruthy(); installed.push(part)
      const frame = confirmedFrame(model, part)!
      const corners = model.panelCorners(part)!.map(p => worldToLocal(frame, p))
      for (const corner of corners) {
        expect(Math.abs(corner[0])).toBeCloseTo(spec.width / 2, 2)
        expect(Math.abs(corner[1])).toBeCloseTo(spec.height / 2, 2)
        expect(corner[2]).toBeCloseTo(0, 2)
      }
      const body = confirmedComponentMeshes(scene(), model, part).find(m => m.name.startsWith('plate:'))!
      const meshAxes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(v => v.applyQuaternion(body.quaternion).toArray())
      meshAxes.forEach((axis, i) => close(axis, frame.axes[i]))
      expect(componentMountsValid(model, part)).toBe(true)
      expect(componentObstacle(model, part)).toBeNull()
    }
    for (const part of installed) expect(componentObstacle(model, part)).toBeNull()
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true); expect(reopened.toJSON()).toEqual(saved)
    for (const part of reopened.panels.values()) expect(componentMountsValid(reopened, part)).toBe(true)
  })

  it.each(['rows', 'cells'])('造管顺序 %s 相邻斜框安装第一块后保留第二块可用承载方案', order => {
    const { model, candidates } = slopedFrames('panel_40x40', Math.PI / 6, false, order), available = candidates()
    expect(available).toHaveLength(2)
    expect(model.addConfirmedComponent(available[0], 'blue')).toBeTruthy()
    const remaining = candidates().find(p => Math.hypot(...p.pos.map((v: number, i: number) => v - available[1].pos[i])) < .1)!
    expect(remaining).toBeTruthy()
    expect(model.confirmedDiagnostics(remaining)).toMatchObject({ valid: true, reason: null })
    expect(model.addConfirmedComponent(remaining, 'red')).toBeTruthy()
    const saved = model.toJSON(), reopened = new BuildModel(); expect(reopened.loadJSON(saved).ok).toBe(true)
    for (const part of reopened.panels.values()) expect(componentMountsValid(reopened, part)).toBe(true)
  })

  it('已装斜板的另一面及反向承载引用不能重复安装，自己的翻面诊断保持有效', () => {
    const { model, candidates } = slopedFrames('panel_40x40'), first = candidates()[0], part = model.addConfirmedComponent(first, 'green') as any
    const opposite = { ...first, a: first.b, b: first.a }
    expect(model.panelAt(opposite.a, opposite.b, opposite.t0, opposite.len)?.id).toBe(part.id)
    expect(model.confirmedDiagnostics(opposite)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { kind: 'panel', id: part.id } })
    expect(model.addConfirmedComponent(opposite, 'red')).toBeNull()
    const sameFace = model.confirmedMounts('panel_40x40').filter(p => Math.hypot(...p.pos.map((v: number, i: number) => v - first.pos[i])) < .1)
    expect(sameFace.every(p => !p.valid)).toBe(true)
    expect(model.confirmedDiagnostics({ ...part, side: -1 }).valid).toBe(true)
    expect(model.flipPanelSide(part.id)).toBe(-1)
    expect(model.confirmedDiagnostics(part).valid).toBe(true)
    expect(model.addConfirmedComponent(part, 'red')).toBeNull()
    expect(model.panels.size).toBe(1)
  })

  it('同框真实布片占用也阻止反面板重复覆盖', () => {
    const { model, candidates } = slopedFrames('panel_40x40'), candidate = candidates()[0]
    const textile = model.addTextile(candidate.a, candidate.b, candidate.t0, candidate.len, 'yellow')!
    expect(textile).toBeTruthy()
    const opposite = { ...candidate, a: candidate.b, b: candidate.a }
    expect(model.confirmedDiagnostics(opposite)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { id: textile.id } })
    expect(model.addConfirmedComponent(opposite, 'red')).toBeNull()
    expect(model.panels.size).toBe(0)
  })

  it('相邻透明板共边四螺丝冲突继续拒绝，改用上下对边可安装', () => {
    const { model, candidates } = slopedFrames('acrylic_panel_40x40'), available = candidates()
    expect(model.addConfirmedComponent(available[0], 'blue')).toBeTruthy()
    expect(model.confirmedDiagnostics(available[1])).toMatchObject({ valid: false, reason: 'mount_occupied' })
    const remaining = candidates('horizontal').find(p => Math.hypot(...p.pos.map((v: number, i: number) => v - available[1].pos[i])) < .1)!
    expect(model.addConfirmedComponent(remaining, 'blue')).toBeTruthy()
  })

  it.each([1, -1])('交换同一框格承载管后 side=%s 仍与实际边对齐', side => {
    const { model, candidates } = slopedFrames('panel_40x20'), initial = candidates()[0]
    const probe = { ...initial, a: initial.b, b: initial.a, side }
    const frame = confirmedFrame(model, probe)!
    for (const p of model.panelCorners(probe)!.map(p => worldToLocal(frame, p))) {
      expect(Math.abs(p[0])).toBeCloseTo(20, 2); expect(Math.abs(p[1])).toBeCloseTo(10, 2)
    }
    expect(model.addConfirmedComponent(probe, 'blue')).toBeTruthy()
  })

  it('斜板正式 QDF 输出保留真实框内旋转', () => {
    const { model, candidates } = slopedFrames('panel_40x40'), part = model.addConfirmedComponent(candidates()[0], 'green') as any
    const frame = confirmedFrame(model, part)!, output = buildQDF(model)
    const imported = parseQDF(output.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    expect(imported.panels).toHaveLength(1)
    const quaternion = new THREE.Quaternion(...imported.panels[0].geom.quat).normalize()
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(v => v.applyQuaternion(quaternion).toArray())
    axes.forEach((axis, i) => close(axis, frame.axes[i]))
  })

  it('真实穿入斜板主体的管仍阻止安装', () => {
    const { model, candidates } = slopedFrames('panel_40x40'), candidate = candidates()[0]
    const frame = confirmedFrame(model, candidate)!, origin = new THREE.Vector3(...frame.pos)
    const a = origin.clone().addScaledVector(new THREE.Vector3(...frame.axes[0]), -10).addScaledVector(new THREE.Vector3(...frame.axes[2]), 2.4)
    const b = origin.clone().addScaledVector(new THREE.Vector3(...frame.axes[0]), 10).addScaledVector(new THREE.Vector3(...frame.axes[2]), 2.4)
    const na = model.addNode(a.x, a.y, a.z), nb = model.addNode(b.x, b.y, b.z), tube = model.addTube(na.id, nb.id, 'T15', 'red', 15)!
    expect(model.confirmedDiagnostics(candidate)).toMatchObject({ valid: false, reason: 'component_space', obstacle: { kind: 'tube', id: tube.id } })
    expect(model.addConfirmedComponent(candidate, 'blue')).toBeNull()
  })

  it.each([0, Math.PI / 12, -Math.PI / 6, Math.PI / 3])('角度 %s 的方板翻面和 turned 保持真实框内旋转', angle => {
    const { model } = slopedFrames('panel_40x40', angle)
    const candidate = model.panelAccessoryMounts('panel_40x40')[0]
    expect(candidate).toBeTruthy()
    const part = model.addConfirmedComponent(candidate, 'red') as any, before = confirmedFrame(model, part)!
    expect(model.turnPanel(part.id)).toBe(true)
    close(confirmedFrame(model, part)!.axes[2], before.axes[2])
    expect(model.flipPanelSide(part.id)).toBe(-1)
    const after = confirmedFrame(model, part)!
    close(after.axes[2], before.axes[2].map((v: number) => -v))
    expect(componentMountsValid(model, part)).toBe(true)
    expect(componentObstacle(model, part)).toBeNull()
  })

  it.each(['panel_40x20', 'acrylic_panel_40x20'])('%s 水平方向的长方形安装仍按实际宽高', id => {
    const { model, spec, candidates } = slopedFrames(id, Math.PI / 6, true), available = candidates()
    expect(available).toHaveLength(2)
    for (const [index, initial] of available.entries()) {
      const candidate = index === 1 && INSET_PANEL_IDS.has(id) ? candidates('horizontal').find(p => Math.hypot(...p.pos.map((v: number, i: number) => v - initial.pos[i])) < .1)! : initial
      const part = model.addConfirmedComponent(candidate, 'blue') as any
      expect(part).toBeTruthy()
      const frame = confirmedFrame(model, part)!
      expect(frame.axes[2][1]).toBeGreaterThan(.999)
      for (const p of model.panelCorners(part)!.map(p => worldToLocal(frame, p))) {
        expect(Math.abs(p[0])).toBeCloseTo(spec.width / 2, 2)
        expect(Math.abs(p[1])).toBeCloseTo(spec.height / 2, 2)
      }
    }
  })
})
