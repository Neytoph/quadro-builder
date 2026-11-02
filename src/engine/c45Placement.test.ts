import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog } from './catalog.js'
import { C45_SLEEVE_LEN as sleeve, C45_ARM_LEN as arm } from './config.js'
import { c45Frame, c45FrameFor } from './c45Pose.js'
import mesh from './c45Mesh.json'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

const s = Math.SQRT1_2
beforeAll(async () => { await loadCatalog() })

function fixture() {
  const model = new BuildModel(), base = model.addNode(40, 40, 0)
  const left = model.addNode(0, 40, 0), lower = model.addNode(40, 0, 0)
  model.addTube(left.id, base.id, 'T35', 'blue', 35)
  model.addTube(lower.id, base.id, 'T35', 'yellow', 35)
  const first = model.addC45Adapter(base.id, [0, 1, 0], [s, -s, 0], sleeve, arm)!.body!
  return { model, base, first }
}

function editor(model: BuildModel) {
  const builder = Object.create(Builder.prototype)
  builder.model = model; builder.tubeId = 'T35'; builder.selection = new Map(); builder.stepFrom = []
  builder.refresh = () => {}; builder.onNotice = () => {}; builder.onHistoryChange = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('45°件安装碰撞', () => {
  it('原图的两个相邻折回件被拒绝，失败不改变模型或ID序号', () => {
    const { model, base } = fixture(), before = model.toJSON()
    expect(model.addC45Adapter(base.id, [1, 0, 0], [-s, s, 0], sleeve, arm)).toEqual({ collision: true })
    expect(model.toJSON()).toEqual(before)
    const clean = new BuildModel(); clean.loadJSON(before)
    expect(model.addNode(300, 40, 0).id).toBe(clean.addNode(300, 40, 0).id)
  })

  it('同一接口重复安装会失败，不产生第二个件', () => {
    const { model, base } = fixture(), before = model.toJSON()
    expect(model.addC45Adapter(base.id, [0, 1, 0], [s, -s, 0], sleeve, arm)).toEqual({ collision: true })
    expect(model.toJSON()).toEqual(before)
  })

  it('所有朝向均相撞的插臂不显示安装入口，其他位置保留', () => {
    const { model, base } = fixture(), builder = editor(model)
    const mount = builder._c45MountsFor(base).find((m: { axis: number[] }) => m.axis[0] > .99)
    expect(mount).toBeUndefined()
    const free = model.addNode(100, 40, 0)
    expect(builder._c45MountsFor(free).length).toBeGreaterThan(0)
  })

  it('旋转进入相邻件时保持完整原状态，反向可旋转', () => {
    const { model, base } = fixture()
    const other = model.addNode(base.x - 10, base.y, 0)
    const body = model.addC45Adapter(other.id, [1, 0, 0], [-s, 0, -s], sleeve, arm)!.body!
    expect(body).toBeTruthy()
    const before = model.toJSON()
    expect(model.rotateC45(body.id, 1)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(model.rotateC45(body.id, -1)).toBe(true)
  })

  it('已有穿插存档不被静默改写，仍能删除和撤销', () => {
    const { model, base } = fixture()
    // 隔离夹具仅还原旧版本已保存的穿插状态。
    const old = model.toJSON(), id = 'old-c45'
    old.nodes.push({ id, x: base.x + sleeve - s * arm, y: base.y + s * arm, z: base.z,
      c45: true, c45body: true, c45axis: [1, 0, 0] } as typeof old.nodes[number])
    old.tubes.push({ id: 'old-arm', a: base.id, b: id, arm: true, tubeId: null, length: null, color: 'blue' } as typeof old.tubes[number])
    expect(model.loadJSON(old).ok).toBe(true)
    const before = model.toJSON(), builder = editor(model)
    builder.recordHistory(() => model.removeC45(id))
    expect(model.nodes.has(id)).toBe(false)
    builder.history.undo()
    const restored = model.toJSON()
    expect(restored.nodes).toEqual(before.nodes)
    expect(restored.tubes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.tubes.sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('渲染与碰撞分别使用两个件的真实姿态，旋转一个不带动另一个', () => {
    const model = new BuildModel(), base = model.addNode(40, 40, 0)
    const first = model.addC45Adapter(base.id, [-1, 0, 0], [s, s, 0], sleeve, arm)!.body!
    const second = model.addC45Adapter(base.id, [1, 0, 0], [-s, 0, s], sleeve, arm)!.body!
    const before = c45Frame(base, first)
    expect(model.rotateC45(second.id, 1)).toBe(true)
    expect(c45Frame(base, first)).toEqual(before)
    const scene = Object.create(SceneManager.prototype)
    const placement = scene._c45Placement(model, second) as THREE.Matrix4
    expect(new THREE.Vector3(1, 0, 0).transformDirection(placement).toArray()).toEqual([1, 0, 0])
    expect(c45Frame(base, second)).not.toEqual(before)
    const saved = new BuildModel(); saved.loadJSON(model.toJSON())
    expect(saved.toJSON()).toEqual(model.toJSON())
  })

  it('同一基座的合法多件导出时逐件写入姿态和数量', () => {
    const model = new BuildModel(), base = model.addNode(40, 40, 0)
    model.addC45Adapter(base.id, [-1, 0, 0], [s, s, 0], sleeve, arm)
    expect(model.addC45Adapter(base.id, [1, 0, 0], [-s, 0, s], sleeve, arm)!.body).toBeTruthy()
    const output = buildQDF(model).text
    const rows = output.split('\n').filter((line: string) => line.startsWith('connector45_2{'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).not.toEqual(rows[1])
    const reopened = new BuildModel()
    expect(reopened.loadJSON(parseQDF(output)).ok).toBe(true)
  })

  it('碰撞资源严格对应原厂精细模型', () => {
    const source = readFileSync(mesh.source, 'utf8')
    expect(createHash('sha256').update(source).digest('hex')).toBe(mesh.sha256)
    const actual = JSON.parse(source).connector45_2
    expect(mesh.pos).toEqual(actual.pos.map((v: number) => v / 100))
    expect(mesh.idx).toEqual(actual.idx)
  })

  it.each(['A0016', 'A0179', 'C0179'])('%s旧导入件的精确姿态保持，读取不会改写模型', name => {
    const model = new BuildModel()
    expect(model.loadJSON(parseQDF(readFileSync(`public/qdf/${name}.qdf`, 'utf8'))).ok).toBe(true)
    const before = model.toJSON(), scene = Object.create(SceneManager.prototype)
    for (const node of model.nodes.values()) {
      if (!node.c45body) continue
      const arm = [...model.tubes.values()].find(t => t.arm && (t.a === node.id || t.b === node.id))!
      const base = model.nodes.get(arm.a === node.id ? arm.b : arm.a)!
      if (!base.c45quat) continue
      const frame = c45FrameFor(model, base, node)
      const q = new THREE.Quaternion(...base.c45quat).normalize()
      const expected = new THREE.Matrix4().compose(new THREE.Vector3(base.x, base.y, base.z), q, new THREE.Vector3(1, 1, 1))
      const actual = scene._c45Placement(model, node) as THREE.Matrix4
      expected.elements.forEach((value, i) => expect(actual.elements[i]).toBeCloseTo(value, 8))
      expect(frame).toBeTruthy()
    }
    expect(model.toJSON()).toEqual(before)
  })
})
