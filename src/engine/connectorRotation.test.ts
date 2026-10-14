import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog } from './catalog.js'
import { connectorsForNode, inferConnectorType } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { CONN_TYPE_MASK, DIRECTIONS } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离检查真实模型和编辑记录；浏览器另外覆盖实际按钮与动画。
function editor(model: BuildModel, id: string) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[id, 'node']])
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('单选普通接头原地换向', () => {
  for (const type of Object.keys(CONN_TYPE_MASK) as Array<keyof typeof CONN_TYPE_MASK>) {
    it(`${type} 连着管旋转后保持类型、位置和连接`, () => {
      const model = new BuildModel()
      const node = model.addNode(2, 40, 3)
      node.preferType = type
      model.extend(node.id, [1, 0, 0], 'T35', 'blue', 35, 40)
      const before = model.toJSON()
      const builder = editor(model, node.id)
      expect(builder.rotateSelectionBy(1)).toBe(true)
      expect(model.nodes.size).toBe(before.nodes.length)
      expect([node.x, node.y, node.z]).toEqual([2, 40, 3])
      expect(inferConnectorType(model, node)).toBe(type)
      expect(connectorsForNode(model, node)).toEqual([type])
      expect(model.toJSON().tubes).toEqual(before.tubes)
      const reopened = new BuildModel()
      reopened.loadJSON(model.toJSON())
      expect(reopened.toJSON()).toEqual(model.toJSON())
      const qdf = parseQDF(buildQDF(model).text)
      const saved = qdf.nodes.find((n) => Math.hypot(n.x - 2, n.y - 40, n.z - 3) < 0.1)! as typeof node & { arms: number[][] }
      expect(saved.arms.length).toBe(DIRECTIONS.filter((_, i) => CONN_TYPE_MASK[type] & (1 << i)).length)
      if (builder.history.canUndo()) {
        const after = model.toJSON()
        builder.history.undo()
        expect(model.toJSON()).toEqual(before)
        builder.history.redo()
        expect(model.toJSON()).toEqual(after)
      }
    })
  }

  it('三根管上的四通保留空插口，循环换向不会生成重复节点', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    node.preferType = '4way'
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0]]) model.extend(node.id, d, 'T35', 'blue', 35, 40)
    const tubes = model.toJSON().tubes
    const builder = editor(model, node.id)
    const ports = new Set<string>()
    for (let i = 0; i < 8; i++) {
      expect(builder.rotateSelectionBy(1)).toBe(true)
      const dirs = SceneManager.prototype._connectorArmDirs.call({}, node, [], new THREE.Quaternion(...node.quat))
      expect(dirs.length).toBe(4)
      ports.add(JSON.stringify(dirs.map((entry: { d: number[] }) => entry.d.map(Math.round)).sort()))
      expect(model.nodes.size).toBe(4)
      expect(model.toJSON().tubes).toEqual(tubes)
    }
    expect(ports.size).toBe(2)
  })

  it('正向再反向恢复插口方向', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    node.preferType = '4way'; node.quat = [0, 0, 0, 1]
    model.extend(node.id, [1, 0, 0], 'T35', 'blue', 35, 40)
    const builder = editor(model, node.id)
    builder.rotateSelectionBy(1)
    builder.rotateSelectionBy(-1)
    const dirs = SceneManager.prototype._connectorArmDirs.call({}, node, [], new THREE.Quaternion(...node.quat))
    expect(dirs.map((entry: { d: number[] }) => entry.d.map(Math.round)).sort()).toEqual([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1]].sort())
  })

  it('QDF 的空插口重新打开后依然保持四通', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    node.preferType = '4way'
    model.extend(node.id, [1, 0, 0], 'T35', 'blue', 35, 40)
    const reopened = new BuildModel()
    reopened.loadJSON(parseQDF(buildQDF(model).text))
    const saved = [...reopened.nodes.values()].find((n) => n.x === 0 && n.y === 40 && n.z === 0)!
    expect(inferConnectorType(reopened, saved)).toBe('4way')
    expect(connectorsForNode(reopened, saved)).toEqual(['4way'])
    expect(editor(reopened, saved.id).rotateSelectionBy(1)).toBe(true)
    expect(saved.preferType).toBe('4way')
  })

  it('倾斜接头换向后仍保留管子占用的插口', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4)
    node.preferType = '4way'; node.quat = q.toArray()
    const d = new THREE.Vector3(1, 0, 0).applyQuaternion(q).toArray()
    model.extend(node.id, d, 'T35', 'blue', 35, 40)
    const before = model.toJSON().tubes
    const builder = editor(model, node.id)
    for (let i = 0; i < 8; i++) {
      expect(builder.rotateSelectionBy(1)).toBe(true)
      const ports = SceneManager.prototype._connectorArmDirs.call({}, node, [], new THREE.Quaternion(...node.quat))
      expect(ports.length).toBe(4)
      expect(ports.some((port: { d: number[] }) => port.d.reduce((sum, v, j) => sum + v * d[j], 0) > 0.99)).toBe(true)
      expect(model.toJSON().tubes).toEqual(before)
    }
  })

  it('只读模式无法修改通型或方向', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    node.preferType = '4way'
    const builder = editor(model, node.id)
    builder.readOnly = true
    const before = model.toJSON()
    expect(builder.rotateSelectionBy(1)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('自由管端导出再打开仍为空管端，可以继续连接', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    const tube = model.extend(node.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    expect(connectorsForNode(model, tube.node!)).toEqual([])
    const exported = buildQDF(model)
    expect(exported.stats.connectors).toBe(0)
    const reopened = new BuildModel()
    reopened.loadJSON(parseQDF(exported.text))
    const end = [...reopened.nodes.values()].find((n) => n.x === 40)!
    expect(connectorsForNode(reopened, end)).toEqual([])
    expect(reopened.extend(end.id, [0, 1, 0], 'T35', 'green', 35, 40)!.tube).toBeTruthy()
    expect(connectorsForNode(reopened, end)).toEqual(['elbow'])
  })
})

describe('管口的真实几何', () => {
  it('中心射线穿过空管，两端和管壁仍可被命中', () => {
    const scene = Object.create(SceneManager.prototype)
    scene._tubeGeos = new Map(); scene._keepGeos = new Set()
    const geo = scene._tubeGeometry(2.45, 35, 24, true)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld()
    const center = new THREE.Raycaster(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, -1, 0))
    expect(center.intersectObject(mesh)).toHaveLength(0)
    const rim = new THREE.Raycaster(new THREE.Vector3(2.3, 30, 0), new THREE.Vector3(0, -1, 0))
    expect(rim.intersectObject(mesh).length).toBeGreaterThan(0)
    const wall = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))
    expect(wall.intersectObject(mesh).length).toBeGreaterThan(0)
    const rod = new THREE.Mesh(scene._tubeGeometry(2.45, 35, 24), new THREE.MeshBasicMaterial())
    rod.updateMatrixWorld()
    expect(center.intersectObject(rod).length).toBeGreaterThan(0)
  })
})
