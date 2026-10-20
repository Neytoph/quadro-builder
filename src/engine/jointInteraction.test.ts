import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SceneManager } from './scene.js'
import { BuildModel, hingeDir, hingeKey, holeArmDirs } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离夹具检查关节图与历史，真实指针事件另用本地网页验收。
function hingeFixture() {
  const model = new BuildModel()
  const base = model.addNode(-40, 80, 0), pivot = model.addNode(0, 80, 0)
  model.addTube(base.id, pivot.id, 'T35', 'green', 35)
  expect(model.addBolt(pivot.id)).toBeTruthy()
  expect(model.addHinge(pivot.id)).toBeTruthy()
  expect(model.addHinge(pivot.id)).toBeTruthy()
  pivot.hinges = [0, 180]
  const end = model.extend(pivot.id, hingeDir(pivot, 0), 'T35', 'yellow', 35, 40)!.node!
  const other = model.extend(pivot.id, hingeDir(pivot, 180), 'T35', 'blue', 35, 40)!.node!
  expect(end).toBeTruthy(); expect(other).toBeTruthy()
  const tube = model.tubeBetween(pivot.id, end.id)!
  return { model, base, pivot, end, other, tube, ref: { kind: 'hinge', nodeId: pivot.id, index: 0 } }
}

function clampFixture(part = 'hole_1') {
  const model = new BuildModel()
  const a = model.addNode(0, 80, 0), b = model.addNode(40, 80, 0)
  const base = model.addTube(a.id, b.id, 'T35', 'green', 35)!
  const node = part === 'bearing' ? model.addTubeClamp(base.id, [20, 80, 5], part)! : model.addHoleClamp(b.id, [1, 0, 0], part)!
  expect(node).toBeTruthy()
  const dir = part === 'bearing' ? [0, 0, 1] : holeArmDirs(node)[0]
  const end = model.extend(node.id, dir, 'T35', 'yellow', 35, 40)!.node!
  expect(end).toBeTruthy()
  const tube = model.tubeBetween(node.id, end.id)!
  return { model, node, base, end, tube, dir, ref: { kind: part === 'bearing' ? 'tubeClamp' : 'hole', nodeId: node.id } }
}

// JS 引擎的推断类型不含运行时附加字段，夹具使用 any 保留真实引擎方法。
function builderFor(model: any) {
  const builder = Object.create(Builder.prototype)
  const scene = { setCursor: () => {}, endOrbit: () => {}, pointOnPlane: () => null,
    projectWorld: SceneManager.prototype.projectWorld,
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 1000),
    renderer: { domElement: { getBoundingClientRect: () => ({ width: 100, height: 100 }) } } }
  scene.camera.position.set(0, 160, 180)
  scene.camera.lookAt(0, 80, 0)
  Object.assign(builder, { model, scene, selection: new Map(), stepFrom: [], mode: 'select', refresh: () => {},
    onNotice: () => {}, onHistoryChange: () => {}, onChange: () => {} })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('活动关节与已连接组件连续旋转', () => {
  it.each(['hole_1', 'hole_2', 'hole_t', 'bearing'])('%s 拖转携带子树、嵌套双管与配件，固定管不动', part => {
    const { model, node, base, end, tube, ref, dir } = clampFixture(part)
    const off = part === 'bearing' ? [0, 5, 0] : [0, 0, 5]
    const c = model.addClamp((node.x + end.x) / 2, (node.y + end.y) / 2, (node.z + end.z) / 2)
    c.dir = dir; c.off = off
    const a = model.addNode(node.x + off[0], node.y + off[1], node.z + off[2]), b = model.addNode(end.x + off[0], end.y + off[1], end.z + off[2])
    const second = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const wheel = model.addFitting('steering_wheel', (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { quat: [0, 0, 0, 1] })
    Object.assign(wheel, { tube: second.id })
    const old = model.toJSON()
    expect(model.rotateJoint(ref, Math.PI / 6)).toBe(true)
    for (const id of [base.a, base.b]) expect(model.nodes.get(id)).toEqual(old.nodes.find(n => n.id === id))
    expect(model.nodes.get(end.id)!.y).not.toBe(old.nodes.find(n => n.id === end.id)!.y)
    expect(wheel.y).not.toBe(old.fittings.find(f => f.id === wheel.id)!.y)
    expect(model.rotationJoint(ref)!.tubes.has(tube.id)).toBe(true)
    expect(model.rotationJoint(ref)!.tubes.has(second.id)).toBe(true)
    if (node.bearingOn) expect(model.fittings.get(node.bearingOn)!.quat).toEqual(node.quat)
  })

  it('一个铰链带动连接管与面板，轴心、支撑和另一个铰链独立', () => {
    const { model, base, pivot, end, other, ref } = hingeFixture()
    const c = model.addNode(40, 40, 0), d = model.addNode(40, 40, 40), e = model.addNode(0, 40, 40)
    const rail = model.addTube(c.id, d.id, 'T35', 'yellow', 35)!
    const movingRail = model.addTube(end.id, e.id, 'T35', 'yellow', 35)!
    model.addTube(end.id, c.id, 'T35', 'red', 35); model.addTube(e.id, d.id, 'T35', 'red', 35)
    const panel = model.addNativePanel({ a: movingRail.id, b: rail.id, t0: 0, len: 40, panelId: 'panel_40x40', side: 1 }, 'red')!
    expect(panel).toBeTruthy()
    const old = model.toJSON(), lengths = [...model.tubes.values()].map(t => model._rail(t.id)!.len)
    expect(model.rotateJoint(ref, 27.3 * Math.PI / 180)).toBe(true)
    expect(pivot.hinges).toEqual([27.3, 180])
    for (const id of [base.id, other.id]) expect(model.nodes.get(id)).toEqual(old.nodes.find(n => n.id === id))
    expect(model.nodes.get(pivot.id)).toMatchObject({ x: 0, y: 80, z: 0, partQuat: (old.nodes.find(n => n.id === pivot.id)! as any).partQuat })
    expect(end.z).toBeGreaterThan(0)
    expect(model.jointMovesPart(model.rotationJoint(ref), panel.id, 'panel')).toBe(true)
    ;[...model.tubes.values()].forEach((t, i) => expect(model._rail(t.id)!.len).toBeCloseTo(lengths[i], 1))
    expect(model.turnHinge(pivot.id, 0)).toBe(true)
    expect(pivot.hinges![0]).toBe(72.3)
  })

  it('铰链间距与固定侧闭环阻止移动，失败后整个模型保持原状', () => {
    const { model, pivot, end, other, ref } = hingeFixture()
    let old = model.toJSON()
    expect(model.rotateJoint(ref, 100 * Math.PI / 180)).toBe(false)
    expect(model.toJSON()).toEqual(old)
    // 即使终点合法，拖动也不能穿过另一个铰链。
    expect(model.rotateJoint(ref, 300 * Math.PI / 180)).toBe(false)
    expect(model.toJSON()).toEqual(old)
    model.addTube(end.id, other.id, 'T75', 'red', 75)
    old = model.toJSON()
    expect(model.rotateJoint(ref, Math.PI / 6)).toBe(false)
    expect(model.turnHinge(pivot.id, 0)).toBe(false)
    expect(model.toJSON()).toEqual(old)
  })

  it('管夹回接固定管、活动组碰地均失败而不拉伸管', () => {
    const { model, end, base, ref } = clampFixture()
    model.addTube(end.id, base.a, 'T45', 'red', 45)
    const before = model.toJSON()
    expect(model.rotateJoint(ref, Math.PI / 6)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    const low = clampFixture('bearing')
    for (const n of low.model.nodes.values()) n.y -= 65
    const initial = low.model.toJSON()
    expect(low.model.rotateJoint(low.ref, Math.PI / 2)).toBe(false)
    expect(low.model.toJSON()).toEqual(initial)
  })

  it('空轴承开口连续转动，固定安装节点和结构不动', () => {
    const { model, base, pivot } = hingeFixture()
    delete pivot.part; delete pivot.partQuat; delete pivot.hinges
    // 安装在固定管的另一个自由端。
    const f = model.addBearingAtArm(base.id, [0, 0, 1])!
    expect(f).toBeTruthy()
    const before = model.toJSON()
    expect(model.rotateJoint({ kind: 'bearing', nodeId: base.id }, Math.PI / 7)).toBe(true)
    expect(model.toJSON().tubes).toEqual(before.tubes)
    expect(f.quat).not.toEqual((before.fittings.find(x => x.id === f.id)! as any).quat)
    expect(model.nodes.get(base.id)).toMatchObject({ x: -40, y: 80, z: 0 })
  })

  it('同一固定管上的两个轴承共同托住框架时一起转动', () => {
    const { model, node, base, ref } = clampFixture('bearing')
    const other = model.addTubeClamp(base.id, [35, 80, 5], 'bearing')!
    expect(other).toBeTruthy()
    expect(model.addTube(node.id, other.id, 'T10', 'red', 10)).toBeTruthy()
    const before = model.toJSON(), old = model.nodes.get(other.id)!.z
    expect(model.rotateJoint(ref, Math.PI / 6)).toBe(true)
    expect(model.nodes.get(other.id)!.z).not.toBe(old)
    for (const id of [base.a, base.b]) expect(model.nodes.get(id)).toEqual(before.nodes.find(n => n.id === id))
    expect(model.fittings.get(other.bearingOn)!.quat).toEqual(other.quat)
  })

  it.each(['pipe', 'hinge', 'bearing'])('选择 %s 后侧视拖动与撤销重做', kind => {
    const f = kind === 'pipe' ? clampFixture() : hingeFixture()
    const model = f.model, builder = builderFor(model)
    let id = f.tube.id, selectedKind = 'tube', ref = f.ref
    if (kind === 'hinge') { id = hingeKey((f as any).pivot.id, 0); selectedKind = 'hinge' }
    if (kind === 'bearing') {
      const n = (f as any).base
      const bearing = model.addBearingAtArm(n.id, [0, 0, 1])!
      id = bearing.id; selectedKind = 'fitting'; ref = { kind: 'bearing', nodeId: n.id } as any
    }
    builder.selection.set(id, selectedKind)
    const data = selectedKind === 'hinge' ? { id: (f as any).pivot.id, kind: 'node', hinge: 0 } : { id, kind: selectedKind }
    expect(builder._rotationDriverForPick({ data })).toEqual(ref)
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    builder._down = { x: 0, y: 0 }
    expect(builder._beginClampDrag(ref)).toBe(true)
    builder._updateClampDrag({ clientX: 0, clientY: 25 })
    builder._endClampDrag({ clientX: 0, clientY: 25 })
    const after = model.toJSON()
    expect(after).not.toEqual(before)
    builder.undo(); expect(JSON.stringify(model.toJSON())).toEqual(JSON.stringify(before))
    builder.redo(); expect(JSON.stringify(model.toJSON())).toEqual(JSON.stringify(after))
    expect(builder.selection.has(id)).toBe(true)
    builder.readOnly = true; expect(builder._beginClampDrag(ref)).toBe(false)
  })

  it('任意铰链角度 QDF 往返保持方向，并且重新导入后仍可连续旋转', () => {
    const { model, ref } = hingeFixture()
    expect(model.rotateJoint(ref, 27.3 * Math.PI / 180)).toBe(true)
    const parsed = parseQDF(buildQDF(model).text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const reopened = new BuildModel()
    expect(reopened.loadJSON(parsed).ok).toBe(true)
    const bolt = [...reopened.nodes.values()].find(n => n.part === 'flexi_bolt')!
    expect(bolt.hinges!.some((g: number) => Math.abs(g - 27.3) < 0.1)).toBe(true)
    const i = bolt.hinges!.findIndex((g: number) => Math.abs(g - 27.3) < 0.1)
    expect(reopened.rotateJoint({ kind: 'hinge', nodeId: bolt.id, index: i }, 10 * Math.PI / 180)).toBe(true)
  })

  it.each(['hole_1', 'hole_2', 'hole_t', 'bearing'])('%s 的任意角度 QDF 重开仍能驱动活动管', part => {
    const { model, ref } = clampFixture(part)
    expect(model.rotateJoint(ref, Math.PI / 7)).toBe(true)
    const parsed = parseQDF(buildQDF(model).text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const reopened = new BuildModel()
    expect(reopened.loadJSON(parsed).ok).toBe(true)
    const node = [...reopened.nodes.values()].find(n => part === 'bearing' ? n.bearingOn : n.part === part)!
    expect(node).toBeTruthy()
    expect(reopened.rotateJoint({ kind: part === 'bearing' ? 'tubeClamp' : 'hole', nodeId: node.id }, Math.PI / 9)).toBe(true)
  })

  it('拖回起始角度完全恢复，并优先使用所选管直接连接的内层关节', () => {
    const { model, pivot, end, ref } = hingeFixture()
    const inner = model.addHoleClamp(end.id, [1, 0, 0])!
    const second = model.extend(inner.id, holeArmDirs(inner)[0], 'T15', 'blue', 15, 20)!.tube!
    const builder = builderFor(model)
    builder.selection.set(second.id, 'tube')
    expect(builder._rotationDriverForPick({ data: { id: second.id, kind: 'tube' } })).toEqual({ kind: 'hole', nodeId: inner.id })
    builder.selection = new Map([[hingeKey(pivot.id, 0), 'hinge']])
    const before = JSON.stringify(model.toJSON())
    builder._down = { x: 0, y: 0 }; builder._beginClampDrag(ref)
    builder._updateClampDrag({ clientX: 0, clientY: 25 })
    expect(JSON.stringify(model.toJSON())).not.toBe(before)
    expect(model.nodes.get(inner.id)!.z).not.toBe(0)
    builder._updateClampDrag({ clientX: 0, clientY: 0 })
    builder._endClampDrag({ clientX: 0, clientY: 0 })
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(builder.history.canUndo()).toBe(false)
  })
})
