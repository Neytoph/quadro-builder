import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
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

describe('矩形框选', () => {
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
