import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, Raycaster, Vector3 } from 'three'
import * as Y from 'yjs'
import { loadCatalog, getPartById } from './catalog.js'
import { BuildModel, armFittingDirsAt } from './model.js'
import { SceneManager } from './scene.js'
import { computeBOM } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { applyDelta, docToJSON } from '../collab/ymodel'
import { ModelHistory, refsOf } from '../collab/history'
import { Builder } from './builder.js'
import { carouselBearingForPick, rotateCarouselBearing } from './carouselBearingModel.js'
import { CarouselRotationGesture } from './carouselRotationGesture.js'

beforeAll(async () => { await loadCatalog() })
function fixture() {
  const model = new BuildModel(), base = model.addNode(0, 2.5, 0)
  for (const [x, z] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) {
    const end = model.addNode(x, 2.5, z)
    model.addTube(base.id, end.id, 'T35', 'green', 35)
  }
  const mount = model.fittingMounts('carousel_bearing')[0]
  return { model, base, mount }
}
function installed() {
  const result = fixture(), { model, mount } = result
  const bearing = model.addFittingAt('carousel_bearing', mount)!
  const rotor = model.nodes.get(bearing.params.rotorNode)!
  rotor.unused = false; rotor.preferType = '6way'
  const end = model.addNode(20, rotor.y, 0)
  model.addTube(rotor.id, end.id, 'T15', 'yellow', 15)
  return { ...result, bearing, rotor, end }
}
describe('UCF209十字底座与独立转轴', () => {
  it('安装轴承保持空位，用户可选择二通、三通或六通，保存后仍为空位', () => {
    const { model, mount } = fixture()
    const before = computeBOM(model).connectors
    const bearing = model.addFittingAt('carousel_bearing', mount)!
    const rotor = model.nodes.get(bearing.params.rotorNode)!
    expect(rotor.unused).toBe(true)
    expect(rotor.preferType).toBeUndefined()
    expect(computeBOM(model).connectors).toEqual(before)
    const saved = model.toJSON(), reopened = new BuildModel()
    expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.nodes.get(rotor.id)!.unused).toBe(true)
    const builder = Object.create(Builder.prototype)
    builder.model = model
    for (const type of ['straight', 'elbow', 't', 'cross', '3way', '4way', '5way', '6way']) {
      expect(builder._nodeAcceptsConnector(rotor, type)).toBe(true)
      expect(builder._applyConnectorType(rotor, type)).toBe(true)
      expect(rotor.preferType).toBe(type)
      expect(rotor.unused).toBe(false)
      expect(rotor.arms.some((a: number[]) => a[1] < -0.999)).toBe(true)
    }
  })
  it('任意角度旋转与跨越正负180度拖动连续，取消恢复起点', () => {
    const { model, bearing, end } = installed()
    expect(rotateCarouselBearing(model, bearing.id, 23.7 / 90)).toBe(true)
    expect(end.x).toBeCloseTo(20 * Math.cos(23.7 * Math.PI / 180), 1)
    expect(end.z).toBeCloseTo(20 * Math.sin(23.7 * Math.PI / 180), 1)
    const before = model.toJSON()
    const plane = (angle: number) => ({ x: 20 * Math.cos(angle), y: bearing.y, z: 20 * Math.sin(angle) })
    const gesture = new CarouselRotationGesture(model, bearing.id, 3, 0, plane(3), plane)
    for (const a of [-3, -2, 0, 2, -3, -1]) expect(gesture.update(a, 0)).toBe(true)
    expect(gesture.angle).toBeCloseTo(4 * Math.PI - 4)
    gesture.cancel(); expect(model.toJSON()).toEqual(before)
    const center = new CarouselRotationGesture(model, bearing.id, 0, 0, null, () => ({ x: 0, y: 0, z: 0 }))
    expect(center.update(52, 0)).toBe(true)
    expect(model.fittings.get(bearing.id)!.params.angle).toBeCloseTo(23.7 + 52 * .012 * 180 / Math.PI)
  })
  it('拖动归属仅包含上部，外壳和底座保持固定；只读切换取消手势', () => {
    const { model, bearing, base, end } = installed()
    const baseAccessory = model.addFitting('cap2', base.x, base.y, base.z)
    expect(carouselBearingForPick(model, { data: { id: end.id } })).toBe(bearing.id)
    expect(carouselBearingForPick(model, { data: { id: base.id } })).toBeNull()
    expect(carouselBearingForPick(model, { data: { id: baseAccessory.id } })).toBeNull()
    expect(carouselBearingForPick(model, { data: { id: bearing.id }, object: { name: 'ucf209:flange-four-holes' } })).toBeNull()
    expect(carouselBearingForPick(model, { data: { id: bearing.id }, object: { name: 'ucf209:inner-race-through-bore' } })).toBe(bearing.id)
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, mode: 'select', scene: { setCursor() {}, endOrbit() {}, endPan() {} }, refresh() {}, cancelPaste() {} })
    builder._carouselDrag = new CarouselRotationGesture(model, bearing.id, 0, 0, null, () => null)
    const before = model.toJSON()
    builder._carouselDrag.update(60, 0)
    expect(builder.busy()).toBe(true)
    builder.setReadOnly(true)
    expect(builder.readOnly).toBe(true)
    expect(builder.busy()).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })
  it('一次拖动只提交一次原生Yjs历史，撤销重做恢复全部上部朝向', () => {
    const { model, bearing } = installed()
    const before = model.toJSON(), doc = new Y.Doc()
    applyDelta(doc, { nodes: [] }, before, 'fixture')
    const history = new ModelHistory(doc)
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, history, scene: { setCursor() {}, endOrbit() {} }, refresh() {} })
    const gesture = new CarouselRotationGesture(model, bearing.id, 0, 0, null, () => null)
    builder._carouselDrag = gesture
    for (const x of [20, 50, 70, 110]) gesture.update(x, 0)
    expect(docToJSON(doc)).toEqual(before)
    builder._onUp({ clientX: 110, clientY: 0, button: 0 })
    const after = model.toJSON()
    expect(docToJSON(doc)).toEqual(after)
    history.undo(); expect(docToJSON(doc)).toEqual(before)
    expect(history.canUndo()).toBe(false)
    history.redo(); expect(docToJSON(doc)).toEqual(after)
    const restored = new BuildModel(); expect(restored.loadJSON(after).ok).toBe(true)
    expect(restored.toJSON()).toEqual(after)
    history.destroy(); doc.destroy()
  })
  it('遇到新增管子碰撞保留最后有效角度，取消恢复原始造型', () => {
    const { model, bearing, rotor } = installed()
    const a = model.addNode(-10, rotor.y, 10), b = model.addNode(10, rotor.y, 10)
    model.addTube(a.id, b.id, 'T15', 'blue', 15)
    const original = model.toJSON()
    const gesture = new CarouselRotationGesture(model, bearing.id, 0, 0, null, () => null)
    expect(gesture.update(20 * Math.PI / 180 / .012, 0)).toBe(true)
    const valid = model.toJSON()
    expect(gesture.update(90 * Math.PI / 180 / .012, 0)).toBe(false)
    expect(model.toJSON()).toEqual(valid)
    gesture.cancel(); expect(model.toJSON()).toEqual(original)
  })
  it('只接受完整水平十字，保存四根扎带与四根真实支撑管，不能重复安装', () => {
    const { model, base, mount } = fixture()
    expect(model.fittingMounts('carousel_bearing')).toHaveLength(1)
    expect(model.addFittingAt('carousel_bearing', { ...mount, pos: [0, 70, 0] })).toBeNull()
    const bearing = model.addFittingAt('carousel_bearing', mount)!
    expect(bearing.params).toMatchObject({ baseNode: base.id, tieCount: 4 })
    expect(bearing.supportTubes).toHaveLength(4)
    const rotor = model.nodes.get(bearing.params.rotorNode)!
    expect(armFittingDirsAt(model, rotor)[0][1]).toBeCloseTo(-1)
    expect(model.addFittingAt('carousel_bearing', mount)).toBeNull()
    expect(model.fittingMounts('carousel_bearing')).toHaveLength(0)
    expect(model.setColorOf('fitting', bearing.id, 'red')).toBe(false)
    const row = computeBOM(model).fittings.find(r => r.kind === 'carousel_bearing')!
    expect(row.count).toBe(1)
    expect(row.kitContents).toContain('4')
    expect(getPartById('carousel_bearing')?.code).toBe('UCF209')
    model.removeTube(bearing.supportTubes[0])
    expect(model.fittings.has(bearing.id)).toBe(false)
    expect(model.nodes.has(rotor.id)).toBe(true)
    expect(model.fittingMounts('carousel_bearing')).toHaveLength(0)
  })
  it('转动上部保持底座、外座和四根支撑管完全不动，四次恢复原位置', () => {
    const { model, base, bearing, rotor, end } = installed()
    const baseNodes = new Set([...model.tubes.values()].filter(t => bearing.supportTubes.includes(t.id)).flatMap(t => [t.a, t.b]))
    const fixed = [...baseNodes].map(id => structuredClone(model.nodes.get(id)))
    const frame = { x: bearing.x, y: bearing.y, z: bearing.z, quat: bearing.quat.slice() }
    expect(model.rotateFitting(bearing.id)).toBe(true)
    expect(end.x).toBeCloseTo(0); expect(end.z).toBeCloseTo(20)
    expect(rotor.x).toBe(base.x); expect(rotor.z).toBe(base.z)
    expect([...baseNodes].map(id => model.nodes.get(id))).toEqual(fixed)
    expect({ x: bearing.x, y: bearing.y, z: bearing.z, quat: bearing.quat }).toEqual(frame)
    for (let i = 0; i < 3; i++) expect(model.rotateFitting(bearing.id)).toBe(true)
    expect(end.x).toBeCloseTo(20); expect(end.z).toBeCloseTo(0)
    expect(model._invalidComponents().size).toBe(0)
    expect(model.moveSelection(new Map([[rotor.id, 'node']]), 10, 0, 0).ok).toBe(false)
  })
  it('拆下轴承后保留上部，重新安装复用原接头；下插柱已占用时拒绝安装', () => {
    const { model, bearing, rotor } = installed()
    model.removeFitting(bearing.id)
    const mounts = model.fittingMounts('carousel_bearing')
    expect(mounts).toHaveLength(1)
    const replaced = model.addFittingAt('carousel_bearing', mounts[0])!
    expect(replaced.params.rotorNode).toBe(rotor.id)
    model.removeFitting(replaced.id)
    model.addFitting('bearing2', rotor.x, rotor.y, rotor.z, { quat: replaced.quat })
    expect(model.fittingMounts('carousel_bearing')).toHaveLength(0)
  })
  it('原生与Yjs重开保留底座引用、角度；整组复制引用只指向副本', () => {
    const { model, bearing } = installed()
    model.rotateFitting(bearing.id)
    const saved = model.toJSON(), restored = new BuildModel()
    expect(restored.loadJSON(saved).ok).toBe(true)
    expect(restored.toJSON()).toEqual(saved)
    const doc = new Y.Doc()
    applyDelta(doc, { nodes: [] }, saved, 'test')
    const reloaded = new BuildModel(); expect(reloaded.loadJSON(docToJSON(doc)).ok).toBe(true)
    expect(reloaded.toJSON()).toEqual(saved)
    const refs = refsOf(key => ({ ...bearing, $type: 'fitting' } as Record<string, unknown>)[key])
    expect(refs).toContain(bearing.params.baseNode); expect(refs).toContain(bearing.params.rotorNode)
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    selection.set(bearing.id, 'fitting')
    const copy = model.insertFragment(model.extractSelection(selection)!, [160, 2.5, 0])!
    const duplicate = model.fittings.get(copy.fittings[0])!
    expect(duplicate.params.baseNode).not.toBe(bearing.params.baseNode)
    expect(copy.nodes).toContain(duplicate.params.baseNode)
    expect(copy.nodes).toContain(duplicate.params.rotorNode)
    expect(model.rotateFitting(duplicate.id)).toBe(true)
    expect(model.fittings.get(bearing.id)!.params.angle).toBe(90)
    model.removeNode(duplicate.params.baseNode)
    expect(model.fittings.has(duplicate.id)).toBe(false)
    expect(model.fittings.has(bearing.id)).toBe(true)
    expect(buildQDF(model).warnings).toContainEqual({ code: 'omitted_accessory', partId: 'carousel_bearing', id: bearing.id })
    doc.destroy()
  })
  it('四个法兰孔与45mm中心孔贯通，裸件网格外框137mm', () => {
    const scene = Object.create(SceneManager.prototype)
    Object.assign(scene, { _materials: {}, _keepGeos: new Set() })
    const meshes = scene._fittingMeshes({ kind: 'carousel_bearing', x: 0, y: 0, z: 0, quat: [0, 0, 0, 1] })
    for (const mesh of meshes) mesh.updateMatrixWorld(true)
    const box = new Box3(); for (const mesh of meshes) box.expandByObject(mesh)
    expect(box.max.y - box.min.y).toBeCloseTo(13.7)
    expect(box.max.z - box.min.z).toBeCloseTo(13.7)
    expect(box.max.x - box.min.x).toBeCloseTo(5.22)
    for (const [y, z] of [[0, 0], [-5.25, -5.25], [-5.25, 5.25], [5.25, -5.25], [5.25, 5.25]]) {
      expect(new Raycaster(new Vector3(-5, y, z), new Vector3(1, 0, 0)).intersectObjects(meshes)).toHaveLength(0)
    }
    expect(new Raycaster(new Vector3(-5, 0, 5), new Vector3(1, 0, 0)).intersectObjects(meshes).length).toBeGreaterThan(0)
  })
})
