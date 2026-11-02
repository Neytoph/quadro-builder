import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Builder } from './builder.js'
import { BuildModel } from './model.js'
import { SceneManager } from './scene.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离画布刷新；使用真实板框、地面约束、相机投影及历史记录。
function editor(side: number, axisSign = 1, grounded = false) {
  const model = new BuildModel()
  const rail = (z: number) => {
    const a = model.addNode(0, 40, z), b = model.addNode(40, 40, z)
    return model.addTube(a.id, b.id, 'T35', 'blue', 35)!
  }
  const base = rail(0), moving = rail(5), foot = rail(45)
  model.addLink(base.a, moving.a); model.addLink(base.b, moving.b)
  model.addTube(moving.a, foot.a, 'T35', 'yellow', 35)
  model.addTube(moving.b, foot.b, 'T35', 'blue', 35)
  model.addPanel(moving.id, foot.id, 0, 40, 'panel_40x40', 'green')
  const clamp = model.addClamp(20, 40, 0)
  clamp.dir = [axisSign, 0, 0]; clamp.off = [0, 0, 5]
  if (grounded) expect(model.rotateClamp(clamp.id, Math.asin(40 / 45) * axisSign)).toBe(true)
  const scene = Object.create(SceneManager.prototype)
  scene.camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 1000)
  scene.camera.position.set(side === 0 ? 180 : 20, 100, side === 0 ? 100 : 160 * side)
  scene.camera.lookAt(20, 30, 20); scene.camera.updateMatrixWorld()
  scene.renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } }
  scene._mouse = new THREE.Vector2(); scene._raycaster = new THREE.Raycaster()
  scene.setCursor = () => {}; scene.endOrbit = () => {}
  const builder = Object.create(Builder.prototype)
  Object.assign(builder, { model, scene, mode: 'select', selection: new Map([[clamp.id, 'clamp']]), stepFrom: [],
    refresh: () => {}, onNotice: () => {}, onHistoryChange: () => {} })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  const point = () => {
    const n = model.nodes.get(foot.a)!
    return scene.screenPoint([20, n.y, n.z])
  }
  const [x, y] = point()
  builder._down = { x, y }
  return { builder, model, scene, clamp, base, foot, point, x, y }
}

describe('翻板拖动方向与触地回拖', () => {
  for (const side of [-1, 1]) for (const sign of [-1, 1]) {
    it(`侧视 ${side}、轴向 ${sign}：翻板在屏幕上跟随拖动，固定管保持，一次撤销`, () => {
      const { builder, model, clamp, base, point, x, y } = editor(side, sign)
      const before = model.toJSON()
      builder._beginClampDrag(clamp.id)
      expect(builder._clampDrag.pointerDir).toBeNull()
      const event = { clientX: x, clientY: y - 15 }
      builder._updateClampDrag(event)
      expect(point()[1]).toBeLessThan(y)
      for (const id of [base.a, base.b]) expect(model.toJSON().nodes.find(n => n.id === id)).toEqual(before.nodes.find(n => n.id === id))
      const after = model.toJSON()
      builder._endClampDrag(event)
      builder.history.undo(); expect(model.toJSON()).toEqual(before)
      expect(builder.history.canUndo()).toBe(false)
      builder.history.redo(); expect(model.toJSON()).toEqual(after)
    })
  }

  it.each([-1, 1])('落地侧视 %i：继续压地保持原位，回拖一小段立即抬起', side => {
    const { builder, model, clamp, foot, x, y } = editor(side, 1, true)
    const before = model.toJSON()
    builder._beginClampDrag(clamp.id)
    const tangent = builder._clampDrag.screenTangent
    const pointer = (distance: number) => ({ clientX: x + tangent[0] * distance, clientY: y + tangent[1] * distance })
    builder._updateClampDrag(pointer(30))
    expect(model.toJSON()).toEqual(before)
    builder._updateClampDrag(pointer(20))
    expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(0)
  })

  it('斜视旋转平面：触地后丢弃越界角度，回拖立即抬起', () => {
    const { builder, model, scene, clamp, foot, x, y } = editor(0, 1, true)
    const before = model.toJSON()
    const origin = new THREE.Vector3(clamp.x, clamp.y, clamp.z)
    const start = new THREE.Vector3(0, model.nodes.get(foot.a)!.y - 40, model.nodes.get(foot.a)!.z)
    const pointer = (angle: number) => {
      const p = start.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle * Math.PI / 180).add(origin)
      const [clientX, clientY] = scene.screenPoint(p.toArray())
      return { clientX, clientY }
    }
    builder._down = { x, y }; builder._beginClampDrag(clamp.id)
    expect(builder._clampDrag.pointerDir).not.toBeNull()
    builder._updateClampDrag(pointer(20)); expect(model.toJSON()).toEqual(before)
    builder._updateClampDrag(pointer(10)); expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(0)
  })

  it('拖到地面边界保留最后有效姿态，回拖从该处继续', () => {
    const { builder, model, clamp, foot, x, y } = editor(1)
    builder._beginClampDrag(clamp.id)
    const tangent = builder._clampDrag.screenTangent
    const pointer = (distance: number) => ({ clientX: x + tangent[0] * distance, clientY: y + tangent[1] * distance })
    builder._updateClampDrag(pointer(50))
    const lastValid = model.toJSON(), height = model.nodes.get(foot.a)!.y
    expect(height).toBeGreaterThan(0); expect(height).toBeLessThan(10)
    builder._updateClampDrag(pointer(90)); expect(model.toJSON()).toEqual(lastValid)
    builder._updateClampDrag(pointer(80)); expect(model.nodes.get(foot.a)!.y).toBeGreaterThan(height)
  })

  it('Shift 吸附累计小幅移动，仍停在15度档位', () => {
    const { builder, model, clamp, x, y } = editor(1)
    builder._beginClampDrag(clamp.id)
    const tangent = builder._clampDrag.screenTangent
    for (const distance of [12, 18, 24]) builder._updateClampDrag({
      clientX: x + tangent[0] * distance, clientY: y + tangent[1] * distance, shiftKey: true,
    })
    const off = model.clamps.get(clamp.id)!.off
    expect(Math.atan2(-off[1], off[2]) * 180 / Math.PI).toBeCloseTo(30, 1)
  })
})
