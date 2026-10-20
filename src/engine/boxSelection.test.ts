import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneManager } from './scene.js'
import { Builder } from './builder.js'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 使用真实投影、几何、模型及历史记录；鼠标路由另由实际页面验收。
function projectedParts() {
  const scene = Object.assign(Object.create(SceneManager.prototype), {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 1, 1000),
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 800 }) } },
    pickNodes: [], pickTubes: [], pickPanels: [], pickClamps: [], pickTextiles: [], pickSlides: [], pickFittings: [],
  })
  scene.camera.position.set(0, 0, 100); scene.camera.lookAt(0, 0, 0); scene.camera.updateMatrixWorld()
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 10, 1), new THREE.MeshStandardMaterial(), 3)
  mesh.userData.instances = [{ id: 'left', kind: 'panel' }, { id: 'right', kind: 'panel' }, { id: 'behind', kind: 'panel' }]
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-30, 0, 0))
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(30, 0, 0))
  mesh.setMatrixAt(2, new THREE.Matrix4().makeTranslation(-30, 0, 200))
  scene.scene.add(mesh); scene.pickPanels = [mesh]
  return { scene, mesh }
}

// 在真实 DOM 事件传播和 OrbitControls 上核对按键分工，不需要 WebGL 渲染器。
function pointerSelection() {
  const { scene, mesh } = projectedParts()
  const container = document.createElement('div'), canvas = document.createElement('canvas')
  container.append(canvas); document.body.append(container)
  canvas.getBoundingClientRect = scene.renderer.domElement.getBoundingClientRect
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 800 } })
  scene.container = container; scene.renderer.domElement = canvas
  scene._hover = null; scene._arrowFocus = null
  scene.controls = new OrbitControls(scene.camera, canvas)
  scene.controls.mouseButtons.LEFT = null
  const builder = Object.assign(Object.create(Builder.prototype), {
    scene, mode: 'select', boxSelect: false, inputType: 'mouse',
    selection: new Map([['right', 'panel']]), _boxSelected: new Map(),
    onHighlightCleared: () => {}, refresh: () => {},
  })
  let cameraStarts = 0
  scene.controls.addEventListener('start', () => { cameraStarts++ })
  builder._attach()
  const pointer = (type: string, button = 1, x = 100, y = 300, shiftKey = false) => {
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1,
      button, buttons: type === 'pointerdown' || type === 'pointermove' ? [1, 4, 2][button] : 0,
      clientX: x, clientY: y, shiftKey,
    }))
  }
  return { scene, builder, pointer, starts: () => cameraStarts, dispose: () => {
    scene.controls.dispose(); container.remove()
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose()
  } }
}

describe('矩形框选', () => {
  it.each([false, true])('中键拖动直接框选，Shift追加=%s，相机不启动缩放', add => {
    const { scene, builder, pointer, starts, dispose } = pointerSelection()
    const camera = scene.camera.position.clone(), target = scene.controls.target.clone()
    pointer('pointerdown', 1, 100, 300, add)
    pointer('pointermove', 1, 400, 500, add)
    expect(scene._selectBox.hidden).toBe(false)
    expect(scene._selectBox.style.width).toBe('300px')
    pointer('pointerup', 1, 400, 500, add)
    expect([...builder.selection.keys()]).toEqual(add ? ['right', 'left'] : ['left'])
    expect([...builder._boxSelected]).toEqual([['left', 'panel']])
    expect(scene._selectBox.hidden).toBe(true)
    expect(starts()).toBe(0)
    expect(scene.camera.position.equals(camera)).toBe(true)
    expect(scene.controls.target.equals(target)).toBe(true)
    dispose()
  })

  it('中键单击保持已有选择，取消中键拖动关闭矩形且保留选择', () => {
    const { scene, builder, pointer, dispose } = pointerSelection()
    pointer('pointerdown'); pointer('pointerup')
    expect([...builder.selection.keys()]).toEqual(['right'])
    pointer('pointerdown'); pointer('pointermove', 1, 400, 500); pointer('pointercancel')
    expect(scene._selectBox.hidden).toBe(true)
    expect([...builder.selection.keys()]).toEqual(['right'])
    expect(builder._pointerId).toBeNull(); expect(builder._boxing).toBe(false)
    dispose()
  })

  it('工具栏开启框选后左键拖动仍然完成选择', () => {
    const { builder, pointer, starts, dispose } = pointerSelection()
    builder.boxSelect = true
    pointer('pointerdown', 0); pointer('pointermove', 0, 400, 500); pointer('pointerup', 0, 400, 500)
    expect([...builder.selection.keys()]).toEqual(['left'])
    expect(starts()).toBe(0)
    dispose()
  })

  it.each([['select', 2], ['delete', 1]] as const)('%s模式的鼠标按键%d继续交给OrbitControls', (mode, button) => {
    const { builder, pointer, starts, dispose } = pointerSelection()
    builder.mode = mode
    pointer('pointerdown', button)
    expect(builder._down.box).toBe(false)
    expect(starts()).toBe(1)
    pointer('pointerup', button)
    dispose()
  })

  it('正向和反向框选使用同一屏幕投影，只选择区域内实例', () => {
    const { scene, mesh } = projectedParts()
    expect([...scene.pickInRect(100, 300, 400, 500)]).toEqual([['left', 'panel']])
    expect([...scene.pickInRect(400, 500, 100, 300)]).toEqual([['left', 'panel']])
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose()
  })

  it('被切面裁掉及相机背后的配件不进入选择', () => {
    const { scene, mesh } = projectedParts()
    scene._clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
    expect([...scene.pickInRect(0, 0, 810, 820)]).toEqual([['right', 'panel']])
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose()
  })

  it.each([false, true])('松开框选时，追加状态为 %s，按修饰键决定替换或保留旧选择', add => {
    const { scene, mesh } = projectedParts()
    Object.assign(scene, { hideSelectBox: () => {}, endOrbit: () => {} })
    const builder = Object.assign(Object.create(Builder.prototype), {
      scene, selection: new Map([['right', 'panel']]), _boxSelected: new Map(),
      _down: { x: 100, y: 300, box: true, add }, _boxing: true,
      highlight: new Set(['right']), _profilAuswahl: new Set(['old-profile']),
      onHighlightCleared: () => {}, refresh: () => {},
    })
    builder._onUp({ clientX: 400, clientY: 500, button: 0 })
    expect([...builder.selection.keys()]).toEqual(add ? ['right', 'left'] : ['left'])
    expect([...builder._boxSelected]).toEqual([['left', 'panel']])
    expect(builder.highlight).toBeNull(); expect(builder._profilAuswahl).toBeNull()
    expect(builder._boxing).toBe(false); expect(builder._down).toBeNull()
    mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose()
  })

  it('框选批量删除后，撤销一次完整恢复真实模型', () => {
    const model = new BuildModel(), a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0), c = model.addNode(80, 0, 0)
    const first = model.addTube(a.id, b.id, 'T35', 'blue', 35)!, second = model.addTube(b.id, c.id, 'T35', 'red', 35)!
    const before = model.toJSON(), builder = Object.assign(Object.create(Builder.prototype), {
      model, mode: 'select', selection: new Map([[first.id, 'tube'], [second.id, 'tube']]), stepFrom: [],
      onNotice: () => {}, onHistoryChange: () => {}, refresh: () => {},
    })
    builder.setHistory(new ModelHistory(docFromJSON(before)))
    expect(builder.deleteSelection()).toBe(2); expect(model.tubes.size).toBe(0)
    builder.history.undo(); expect(model.toJSON()).toEqual(before)
  })
})
