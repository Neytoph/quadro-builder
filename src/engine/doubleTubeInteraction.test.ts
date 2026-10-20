import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog, geometry } from './catalog.js'
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
