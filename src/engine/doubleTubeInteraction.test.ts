import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog, geometry, buildableTubes, panels as catalogPanels } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { connectorsForNode } from './bom.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离框架只用于几何、图关系与历史回归；页面手势另行验收。
function fixture(axis = 0) {
  const model = new BuildModel()
  const start = [0, 40, 0], end = start.slice()
  end[axis] += 40
  const a = model.addNode(...start), b = model.addNode(...end)
  const base = model.addTube(a.id, b.id, 'T35', 'green', 35)!
  const p = start.slice(); p[axis] += 30
  const clamp = model.addClamp(...p)
  clamp.dir = [0, 0, 0]; clamp.dir[axis] = 1
  clamp.off = [0, 0, 0]; clamp.off[axis === 1 ? 2 : 1] = 5
  const scene = Object.create(SceneManager.prototype)
  Object.assign(scene, { handleGroup: new THREE.Group(), handleMeshes: [], scene: new THREE.Scene(),
    _materials: {}, _geos: new Map(), _tubeGeos: new Map(), _keepGeos: new Set(),
    setCursor: () => {}, endOrbit: () => {}, _look: () => '#ffcc00' })
  const builder = Object.create(Builder.prototype)
  Object.assign(builder, { model, scene, mode: 'add', tubeId: 'T35', selection: new Map(), stepFrom: [],
    onNotice: () => {}, onHistoryChange: () => {}, onChange: () => {}, refresh: () => {},
    colorFor: () => 'yellow' })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, builder, scene, clamp, base }
}

describe('双管空孔预览与实际落点', () => {
  it.each([0, 1, 2])('沿轴 %i：预览线两端对齐第一根，加管使用相同端点', axis => {
    const { model, builder, scene, clamp, base } = fixture(axis)
    builder._buildHandles()
    const handle = scene.handleGroup.children.find((g: THREE.Object3D) => g.userData.clampId === clamp.id)!
    const expected = [model.nodes.get(base.a)!, model.nodes.get(base.b)!].map(n => [n.x, n.y, n.z].map((v: number, i: number) => v + clamp.off[i]))
    expect(handle.userData.previewEnds).toEqual(expected)
    handle.updateMatrixWorld(true)
    const beam = handle.userData.beamMesh as THREE.Mesh<THREE.BufferGeometry>
    beam.geometry.computeBoundingBox()
    const bounds = beam.geometry.boundingBox!
    const beamEnds = [bounds.min.y, bounds.max.y].map(y => beam.localToWorld(new THREE.Vector3(0, y, 0)).toArray())
    beamEnds.forEach((p, j) => p.forEach((v, i) => expect(v).toBeCloseTo(expected[j][i])))
    scene._setTubePreview(handle)
    expect(scene._tubePreview.position.toArray()).toEqual(expected[0].map((v, i) => (v + expected[1][i]) / 2))
    expect(scene._tubePreview.scale.y).toBe(40 - geometry().connectorSize)
    builder._placeSecondTube(handle.userData.center, clamp.dir, null, clamp.id)
    const second = model._clampSecondTube(clamp)!
    expect([model.nodes.get(second.a), model.nodes.get(second.b)].map(n => [n!.x, n!.y, n!.z])).toEqual(expected)
    expect(connectorsForNode(model, model.nodes.get(second.a)!)).toEqual([])
    expect(connectorsForNode(model, model.nodes.get(second.b)!)).toEqual([])
    expect(model.clampCohort(clamp.id).tubes.has(second.id)).toBe(true)
  })

  it('不同长度使用端点对齐规则，换管后重新计算预览', () => {
    const { model, builder, scene, clamp } = fixture()
    for (const [tubeId, span] of [['T15', 20], ['T75', 80]] as const) {
      builder.tubeId = tubeId
      builder._buildHandles()
      const handle = scene.handleGroup.children.find((g: THREE.Object3D) => g.userData.clampId === clamp.id)!
      const { p1, p2 } = model.secondTubeEnds(clamp.id, span, { step: 5, cs: 5 })
      expect(handle.userData.previewEnds).toEqual([p1, p2])
      expect(handle.userData.previewSpan).toBe(span)
    }
  })

  it('第二根管端实际接管后生成接头，手动指定接头保留', () => {
    const { model, builder, clamp } = fixture()
    builder._placeSecondTube([30, 45, 0], clamp.dir, null, clamp.id)
    const second = model._clampSecondTube(clamp)!
    const n = model.nodes.get(second.a)!
    n.preferType = 'elbow'
    expect(connectorsForNode(model, n)).toContain('elbow')
    delete n.preferType
    model.extend(n.id, [0, 0, 1], 'T35', 'blue', 35, 40)
    expect(connectorsForNode(model, n)).toContain('elbow')
  })
})

describe('自由管口的空心几何', () => {
  it('直管两端中心都可穿过，管壁与端面环仍可命中，接头插杆保持实心', () => {
    const { scene } = fixture()
    const material = new THREE.MeshBasicMaterial()
    const tube = new THREE.Mesh(scene._tubeGeometry(2.45, 35, 24, true), material)
    tube.updateMatrixWorld()
    for (const sign of [-1, 1]) {
      const center = new THREE.Raycaster(new THREE.Vector3(0, sign * 30, 0), new THREE.Vector3(0, -sign, 0))
      expect(center.intersectObject(tube)).toHaveLength(0)
      const rim = new THREE.Raycaster(new THREE.Vector3(2.3, sign * 30, 0), new THREE.Vector3(0, -sign, 0))
      expect(rim.intersectObject(tube).length).toBeGreaterThan(0)
    }
    const wall = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))
    expect(wall.intersectObject(tube).length).toBeGreaterThan(0)
    const rod = new THREE.Mesh(scene._tubeGeometry(2.45, 35, 24), material)
    rod.updateMatrixWorld()
    expect(new THREE.Raycaster(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, -1, 0)).intersectObject(rod).length).toBeGreaterThan(0)
  })

  it('弯管管口环中心没有端面', () => {
    const { scene } = fixture()
    const rim = new THREE.Mesh(scene._capGeometry(2.45, 24), new THREE.MeshBasicMaterial())
    rim.updateMatrixWorld()
    expect(new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1)).intersectObject(rim)).toHaveLength(0)
    expect(new THREE.Raycaster(new THREE.Vector3(2.3, 0, 10), new THREE.Vector3(0, 0, -1)).intersectObject(rim).length).toBeGreaterThan(0)
  })
})

describe('双管斜面继续接管与相邻两格对齐', () => {
  it('夹子先转到任意角度，再放第二根管：自由端提供斜面的侧向接管方向', () => {
    const { model, builder, scene, clamp } = fixture()
    const angle = Math.PI / 6
    model.rotateClamp(clamp.id, angle)
    builder._placeSecondTube([], clamp.dir, null, clamp.id)
    const second = model._clampSecondTube(clamp)!
    const start = model.nodes.get(second.a)!
    scene.clearHandles()
    builder._addBuildHandles(start)
    const side = [0, -Math.sin(angle), Math.cos(angle)]
    const handle = scene.handleGroup.children.find((g: THREE.Object3D) => g.userData.dir?.every((v: number, i: number) => Math.abs(v - side[i]) < 1e-4))!
    expect(handle).toBeTruthy()
    const result = model.extend(start.id, handle.userData.dir, 'T35', 'blue', 35, 40)!
    expect(result.tube).toBeTruthy()
    expect(connectorsForNode(model, start)).toContain('elbow')
    const reopened = new BuildModel()
    reopened.loadJSON(model.toJSON())
    expect(reopened.nodes.get(start.id)!.quat).toEqual(start.quat)
    expect(reopened.tubes.has(result.tube!.id)).toBe(true)
  })

  it.each([false, true])('相邻两格沿用已装斜面的角度，共用接缝并整体转动，第二格反向建管=%s', reverse => {
    const { model, builder, clamp, base } = fixture()
    model.rotateClamp(clamp.id, Math.PI / 6)
    builder._placeSecondTube([], clamp.dir, null, clamp.id)
    const first = model._clampSecondTube(clamp)!
    const joint = model.nodes.get(base.b)!
    const end = model.addNode(80, 40, 0)
    const nextBase = model.addTube(reverse ? end.id : joint.id, reverse ? joint.id : end.id, 'T35', 'green', 35)!
    builder.clampPart = 'double_tube'
    builder._placeClampOnTube(nextBase.id, { x: 60, y: 42, z: 0 })
    const next = [...model.clamps.values()].find(c => c.id !== clamp.id)!
    expect(next.off).toEqual(clamp.off)
    builder._placeSecondTube([], next.dir, null, next.id)
    const second = model._clampSecondTube(next)!
    expect([second.a, second.b]).toContain(first.b)
    const fixed = [base.a, base.b, end.id].map(id => ({ ...model.nodes.get(id)! }))
    expect(model.rotateClamp(clamp.id, Math.PI / 12)).toBe(true)
    expect(next.off).toEqual(clamp.off)
    const a = model.nodes.get(first.a)!, b = model.nodes.get(first.b)!
    const c = model.nodes.get(second.a === first.b ? second.b : second.a)!
    expect([a.y, a.z]).toEqual([b.y, b.z])
    expect([b.y, b.z]).toEqual([c.y, c.z])
    for (const node of fixed) expect(model.nodes.get(node.id)).toEqual(node)
    const reopened = new BuildModel()
    reopened.loadJSON(model.toJSON())
    expect(reopened.clampCohort(clamp.id).clamps.has(next.id)).toBe(true)
    builder._placeClampOnTube(nextBase.id, { x: 70, y: 38, z: 0 })
    const added = [...model.clamps.values()].find(c => c.id !== clamp.id && c.id !== next.id)!
    expect(added.off).toEqual(next.off)
    expect(model._clampSecondTube(added)!.id).toBe(second.id)
    expect(model.rotateClamp(added.id, -Math.PI / 12)).toBe(true)
    expect(added.off).toEqual(next.off)
    expect(next.off).toEqual(clamp.off)
  })

  it('独立管架与转角不自动改角度，已有第二根管的位置优先沿用真实角度', () => {
    const { model, builder, clamp, base } = fixture()
    model.rotateClamp(clamp.id, Math.PI / 6)
    builder._placeSecondTube([], clamp.dir, null, clamp.id)
    const off = [0, 5, 0]
    const a = model.addNode(0, 40, 40), b = model.addNode(40, 40, 40)
    const separate = model.addTube(a.id, b.id, 'T35', 'green', 35)!
    expect(model.alignedClampOff(separate.id, off, [20, 40, 40])).toEqual(off)
    const corner = model.addNode(40, 40, 40)
    const turn = model.addTube(base.b, corner.id, 'T35', 'green', 35)!
    expect(model.alignedClampOff(turn.id, off, [40, 40, 20])).toEqual(off)
    const matched = model.alignedClampOff(base.id, [0, -5, 0], [20, 40, 0])
    matched.forEach((v: number, i: number) => expect(v).toBeCloseTo(clamp.off[i], 2))
  })

  it('虚拟连接桥不阻挡接管，真实管件仍阻挡交叉路径', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 40, 0), b = model.addNode(0, 50, 0)
    const bridge = model.addLink(a.id, b.id)!
    const start = { x: -20, y: 45, z: 0 }, end = { x: 20, y: 45, z: 0 }
    expect(model.tubeCollision(start, end)).toBeNull()
    model.tubes.delete(bridge.id)
    model.addTube(a.id, b.id, 'T05', 'red', 5)
    expect(model.tubeCollision(start, end)).toBeTruthy()
  })

  it('2×2 斜面的面板、管件和配件独立选整块，主架构从两边均不穿过双管连接桥', () => {
    const { model, builder, clamp, base } = fixture()
    builder._placeSecondTube([], clamp.dir, null, clamp.id)
    const first = model._clampSecondTube(clamp)!
    const fixedEnd = model.addNode(80, 40, 0)
    const nextBase = model.addTube(base.b, fixedEnd.id, 'T35', 'green', 35)!
    const supports = [base.a, base.b, fixedEnd.id].flatMap(id => {
      const node = model.nodes.get(id)!
      const foot = model.addNode(node.x, 0, node.z)
      return [foot.id, model.addTube(foot.id, id, 'T35', 'yellow', 35)!.id]
    })
    builder._placeClampOnTube(nextBase.id, { x: 60, y: 42, z: 0 })
    const nextClamp = [...model.clamps.values()].find(c => c.id !== clamp.id)!
    builder._placeSecondTube([], nextClamp.dir, null, nextClamp.id)
    const second = model._clampSecondTube(nextClamp)!
    const rows = [[first, second]]
    const movingTubes = [first.id, second.id]
    const panels: string[] = []
    let previous = [first.a, first.b, second.b]
    for (let row = 1; row <= 2; row++) {
      const nodes = [0, 40, 80].map(x => model.addNode(x, 45, row * 40))
      for (let i = 0; i < 3; i++) movingTubes.push(model.addTube(previous[i], nodes[i].id, 'T35', 'blue', 35)!.id)
      const rails = [0, 1].map(i => model.addTube(nodes[i].id, nodes[i + 1].id, 'T35', 'blue', 35)!)
      movingTubes.push(...rails.map(t => t.id))
      for (let i = 0; i < 2; i++) panels.push(model.addPanel(rows[row - 1][i].id, rails[i].id, 0, 40, 'panel_40x40', 'green')!.id)
      rows.push(rails)
      previous = nodes.map(n => n.id)
    }
    const movingFitting = model.addFitting('end-cap', 0, 45, 0)!
    const fixedFitting = model.addFitting('end-cap', 0, 40, 0)!
    expect(model.rotateClamp(clamp.id, -Math.PI / 12)).toBe(true)
    const fixed = new Set([base.a, base.b, fixedEnd.id, base.id, nextBase.id, fixedFitting.id, ...supports])
    for (const [seed, kind] of [[first.id, 'tube'], [panels[0], 'panel'], [movingFitting.id, 'fitting'], [clamp.id, 'clamp']] as const) {
      const selection = model.connectedSelection(seed, kind)
      for (const id of movingTubes) expect(selection.has(id), `${kind} missing ${id}`).toBe(true)
      for (const id of panels) expect(selection.get(id)).toBe('panel')
      expect(selection.get(movingFitting.id)).toBe('fitting')
      expect(selection.get(clamp.id)).toBe('clamp')
      expect(selection.get(nextClamp.id)).toBe('clamp')
      for (const id of fixed) expect(selection.has(id), `${kind} leaked ${id}`).toBe(false)
    }
    const main = model.connectedSelection(base.id, 'tube')
    for (const id of fixed) expect(main.has(id), `main missing ${id}`).toBe(true)
    for (const id of [...movingTubes, ...panels, clamp.id, nextClamp.id, movingFitting.id]) expect(main.has(id), `main leaked ${id}`).toBe(false)
    const before = model.toJSON()
    sceneParts(builder, model)
    builder._selectConnectedFromPick({ data: { id: panels[0], kind: 'panel' } }, false)
    expect(builder.selection.has(base.id)).toBe(false)
    expect(builder.selection.has(second.id)).toBe(true)
    expect(model.toJSON()).toEqual(before)
    const reopened = new BuildModel()
    const exported = buildQDF(model)
    expect(reopened.loadJSON(parseQDF(exported.text, {
      tubes: buildableTubes(), panels: catalogPanels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    })).ok).toBe(true)
    const panel = [...reopened.panels.values()][0]
    const slope = reopened.connectedSelection(panel.id, 'panel')
    expect([...reopened.panels.keys()].every(id => slope.has(id))).toBe(true)
    expect(reopened.panels.size).toBe(4)
    const mainTube = [...reopened.tubes.values()].find(t => !t.link && Math.abs(reopened.nodes.get(t.a)!.y - 40) < .1 && Math.abs(reopened.nodes.get(t.b)!.y - 40) < .1)!
    expect(mainTube).toBeTruthy()
    expect(slope.has(mainTube.id)).toBe(false)
  })
})

function sceneParts(builder: Builder, model: BuildModel) {
  builder.scene.selectableParts = () => new Map([
    ...[...model.nodes.keys()].map(id => [id, 'node'] as const),
    ...[...model.tubes.values()].filter(t => !t.link).map(t => [t.id, 'tube'] as const),
    ...[...model.panels.keys()].map(id => [id, 'panel'] as const),
    ...[...model.clamps.keys()].map(id => [id, 'clamp'] as const),
    ...[...model.fittings.keys()].map(id => [id, 'fitting'] as const),
  ])
}

describe('已选双管夹绕管旋转', () => {
  it('拖动旋转保持第一根管、图关系，可逐步撤销重做', () => {
    const { model, builder, scene, clamp, base } = fixture()
    builder._placeSecondTube([30, 45, 0], clamp.dir, null, clamp.id)
    builder.mode = 'select'
    builder.selection = new Map([[clamp.id, 'clamp']])
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    scene.pointOnPlane = (x: number) => x === 0 ? new THREE.Vector3(30, 45, 0) : new THREE.Vector3(30, 40, 5)
    builder._down = { x: 0, y: 0 }
    expect(builder._beginClampDrag(clamp.id)).toBe(true)
    builder._updateClampDrag({ clientX: 30, clientY: 20 })
    builder._endClampDrag({ clientX: 30, clientY: 20 })
    const after = model.toJSON()
    expect(after).not.toEqual(before)
    for (const id of [base.a, base.b]) expect(model.nodes.get(id)).toMatchObject(before.nodes.find((n: { id: string }) => n.id === id)!)
    expect(after.tubes).toEqual(before.tubes)
    expect(builder.history.canUndo()).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  it('按下后未移动走点击旋转入口；只读禁止开始拖动', () => {
    const { builder, clamp } = fixture()
    builder.mode = 'select'
    let clicks = 0
    builder._clickSelect = () => { clicks++ }
    expect(builder._beginClampDrag(clamp.id)).toBe(true)
    builder._endClampDrag({ clientX: 0, clientY: 0 })
    expect(clicks).toBe(1)
    builder.readOnly = true
    expect(builder._beginClampDrag(clamp.id)).toBe(false)
  })

  it('选中第二根管、远端管、板或配件都能驱动整组，固定管不参与', () => {
    const { model, builder, scene, clamp, base } = fixture()
    builder._placeSecondTube([30, 45, 0], clamp.dir, null, clamp.id)
    const moving = model._clampSecondTube(clamp)!
    const a = model.addNode(0, 85, 0), b = model.addNode(40, 85, 0)
    const foot = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const side = model.addTube(moving.a, a.id, 'T35', 'blue', 35)!
    model.addTube(moving.b, b.id, 'T35', 'blue', 35)
    const panel = model.addPanel(moving.id, foot.id, 0, 40, 'panel_40x40', 'blue')!
    const fitting = model.addFitting('end-cap', a.x, a.y, a.z)!
    builder.mode = 'select'
    for (const [id, kind] of [[moving.id, 'tube'], [foot.id, 'tube'], [side.id, 'tube'], [panel.id, 'panel'], [a.id, 'node'], [fitting.id, 'fitting']]) {
      builder.selection = new Map([[id, kind]])
      expect(builder._selectedClampDriver(), `${kind}:${id}`).toBe(clamp.id)
      expect(builder._flapDriverForPick({ data: { id, kind } })).toBe(clamp.id)
    }
    builder.selection = new Map([[base.id, 'tube']])
    expect(builder._selectedClampDriver()).toBeNull()
    builder.selection = new Map([[moving.id, 'tube'], [base.id, 'tube']])
    expect(builder._selectedClampDriver()).toBeNull()
    builder.selection = new Map([[moving.id, 'tube']])
    scene.pointOnPlane = (x: number) => x === 0 ? new THREE.Vector3(30, 45, 0) : new THREE.Vector3(30, 40, 5)
    builder._down = { x: 0, y: 0 }
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 30, clientY: 20 })
    builder._endClampDrag({ clientX: 30, clientY: 20 })
    expect(model.nodes.get(a.id)).toMatchObject({ x: 0, y: 40, z: 45 })
    expect(model.fittings.get(fitting.id)).toMatchObject({ x: 0, y: 40, z: 45 })
    expect(model.toJSON().tubes).toEqual(before.tubes)
    expect(model.panels.has(panel.id)).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
  })

  it('抓取点与夹子偏移角不同也不跳角，正侧面可连续转动', () => {
    const { model, builder, scene, clamp } = fixture()
    builder._down = { x: 0, y: 0 }
    scene.pointOnPlane = (x: number) => new THREE.Vector3(30, 40, 5 + x / 100)
    builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 10, clientY: 0 })
    expect(model.clamps.get(clamp.id)!.off).toEqual([0, 5, 0])
    builder._endClampDrag({ clientX: 10, clientY: 0 })
    scene.pointOnPlane = () => null
    scene.camera = new THREE.PerspectiveCamera(45, 1.25, 0.1, 1000)
    scene.camera.position.set(30, 120, 100)
    scene.camera.lookAt(30, 40, 0)
    scene.renderer = { domElement: { getBoundingClientRect: () => ({ width: 1000, height: 800 }) } }
    builder._down = { x: 0, y: 0 }
    builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 0, clientY: 12 })
    const angle = Math.atan2(model.clamps.get(clamp.id)!.off[2], model.clamps.get(clamp.id)!.off[1]) * 180 / Math.PI
    expect(angle).toBeCloseTo(12, 1)
    builder._updateClampDrag({ clientX: 0, clientY: 17 })
    expect(model.clamps.get(clamp.id)!.off[2]).toBeGreaterThan(1)
  })

  it('套在管中部的真实方向盘跟随承载管，位置、方向与安装引用一同保持', () => {
    const { model, builder, clamp } = fixture()
    builder._placeSecondTube([30, 45, 0], clamp.dir, null, clamp.id)
    const second = model._clampSecondTube(clamp)!
    const a = model.addNode(0, 85, 0), b = model.addNode(40, 85, 0)
    const moving = model.addTube(a.id, b.id, 'T35', 'green', 35)!
    model.addTube(second.a, a.id, 'T35', 'red', 35)
    model.addTube(second.b, b.id, 'T35', 'red', 35)
    const wheel = model.addAccessory('steering_wheel', moving.id, 'green')!
    expect(wheel).toBeTruthy()
    builder.selection = new Map([[wheel.id, 'fitting']])
    expect(builder._selectedClampDriver()).toBe(clamp.id)
    const old = [wheel.x, wheel.y, wheel.z]
    expect(model.rotateClamp(clamp.id, Math.PI / 2)).toBe(true)
    const turned = model.fittings.get(wheel.id)!
    expect(turned.x).toBe(old[0])
    expect(turned.y).toBeCloseTo(40 - old[2])
    expect(turned.z).toBeCloseTo(old[1] - 40)
    expect(turned.tube).toBe(moving.id)
    expect(turned.supportTubes).toEqual([moving.id])
    const reopened = new BuildModel()
    reopened.loadJSON(model.toJSON())
    expect(reopened.fittings.get(wheel.id)).toMatchObject({ tube: moving.id, x: turned.x, y: turned.y, z: turned.z })
  })
})
