import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { resolveNodeConnection } from './bom.js'
import { loadCatalog } from './catalog.js'
import { C45_ARM_LEN, C45_SLEEVE_LEN } from './config.js'
import { DIRECTIONS, DIAGONAL_DIRECTIONS } from './config.js'
import { Quaternion, Vector3 } from 'three'

beforeAll(() => loadCatalog())

// 隔离端点夹具覆盖普通、斜向和C45安装；不作为用户模型的装配证明。
describe('新增管件严格沿所选引导线', () => {
  for (const angle of [0, Math.PI / 6]) for (const guide of [...DIRECTIONS, ...DIAGONAL_DIRECTIONS]) for (const offset of [.25, 2.5]) {
    it(`方向${guide.name}，局部转角${angle}，旁接偏移${offset}时保持引导方向和管长`, () => {
      const model = new BuildModel(), from = model.addNode(13.127, 100.334, -9.541)
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), angle)
      const direction = new Vector3(...guide.vec).applyQuaternion(q).normalize()
      const side = new Vector3().crossVectors(direction, Math.abs(direction.x) < .8 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize()
      const expected = new Vector3(from.x, from.y, from.z).addScaledVector(direction, 40)
      const beside = expected.clone().addScaledVector(side, offset)
      const nearby = model.addNode(...beside.toArray())
      const plan = model.planTubeExtension(from.id, direction.toArray(), 40)!
      expect(plan.existing).toBeNull()
      const placed = model.extend(from.id, direction.toArray(), 'T35', 'blue', 35, 40)!
      expect(placed.node.id).not.toBe(nearby.id)
      const delta = new Vector3(placed.node.x - from.x, placed.node.y - from.y, placed.node.z - from.z)
      expect(delta.length()).toBeCloseTo(40, 10)
      expect(delta.normalize().distanceTo(direction)).toBeLessThan(1e-12)
      expect([placed.node.x, placed.node.y, placed.node.z]).toEqual([plan.target!.x, plan.target!.y, plan.target!.z])
      expect(placed.tube!.length).toBe(35)
    })
  }

  for (const offset of [.006, .1, .4, 1, 2.5]) {
    it(`横管不吸向偏离引导线${offset}厘米的节点，新增节点也不二次合并`, () => {
      const model = new BuildModel(), from = model.addNode(0, 80, 0)
      const nearby = model.addNode(40, 80 + offset, 0)
      const before = model.toJSON()
      const plan = model.planTubeExtension(from.id, [1, 0, 0], 40)!
      expect(plan.existing).toBeNull()
      expect(plan.target).toEqual({ x: 40, y: 80, z: 0 })
      expect(model.toJSON()).toEqual(before)
      const added = model.extend(from.id, [1, 0, 0], 'T35', 'yellow', 35, 40)!
      expect(added.node.id).not.toBe(nearby.id)
      expect([added.node.x, added.node.y, added.node.z]).toEqual([40, 80, 0])
      expect([nearby.x, nearby.y, nearby.z]).toEqual([40, 80 + offset, 0])
      const reopened = new BuildModel()
      expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(model.toJSON())
    })
  }

  it('斜管不吸向旁边节点，安装与预览保留45度方向', () => {
    const model = new BuildModel(), from = model.addNode(0, 80, 0), S = Math.SQRT1_2
    const target = [0, 80 + 40 * S, 40 * S]
    const nearby = model.addNode(0, target[1] - 1, target[2] + 1)
    const plan = model.planTubeExtension(from.id, [0, S, S], 40)!
    expect(plan.target).toEqual({ x: target[0], y: target[1], z: target[2] })
    expect(plan.existing).toBeNull()
    const added = model.extendDiagonalSnap(from.id, [0, S, S], 'T35', 'blue', 35, 40)!
    expect(added.node.id).not.toBe(nearby.id)
    expect([added.node.x, added.node.y, added.node.z]).toEqual(target)
    expect(added.node.y - from.y).toBeCloseTo(added.node.z - from.z, 12)
  })

  it('共线端点仍可吸附，记录的管长和目标端口保持', () => {
    const model = new BuildModel(), from = model.addNode(0, 80, 0)
    const existing = model.addNode(40.2, 80, 0)
    const plan = model.planTubeExtension(from.id, [1, 0, 0], 40)!
    expect(plan.existing?.id).toBe(existing.id)
    const added = model.extend(from.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    expect(added.node.id).toBe(existing.id)
    expect(added.tube!.length).toBe(35)
    expect([added.node.y, added.node.z]).toEqual([80, 0])
  })

  it.each([false, true])('两根斜管到达同一存档坐标时共用接头（中途重开 %s）', reopen => {
    const model = new BuildModel(), S = Math.SQRT1_2
    const left = model.addNode(0, 90, -14.14), right = model.addNode(0, 90, 14.14)
    const first = model.extendDiagonalSnap(left.id, [0, -S, S], 'T15', 'blue', 15, 20)!
    expect(first.tube).toBeTruthy()
    if (reopen) expect(model.loadJSON(model.toJSON()).ok).toBe(true)
    const dir = [0, -S, -S]
    expect(model.planTubeExtension(right.id, dir, 20)?.existing?.id).toBe(first.node.id)
    const second = model.extendDiagonalSnap(right.id, dir, 'T15', 'red', 15, 20)!
    expect(second.tube?.b).toBe(first.node.id)
    expect(model.nodes.size).toBe(3)
    expect(resolveNodeConnection(model, first.node.id).types).toEqual(['elbow'])
    expect(model.collisions().size).toBe(0)
  })

  it('C45安装不被近端节点拉歪，套筒体与管端保留精确引导方向', () => {
    const model = new BuildModel(), from = model.addNode(0, 80, 0), S = Math.SQRT1_2
    const start = [-C45_SLEEVE_LEN + S * C45_ARM_LEN, 80 + S * C45_ARM_LEN, 0]
    const end = [start[0] + S * 40, start[1] + S * 40, 0]
    const nearby = model.addNode(end[0], end[1], .2)
    const added = model.extendC45Diagonal(from.id, [S, S, 0], [-1, 0, 0], 'T35', 'red', 35, 40, C45_SLEEVE_LEN, C45_ARM_LEN)!
    expect(added.tube).toBeTruthy()
    expect(added.node.id).not.toBe(nearby.id)
    expect([added.body!.x, added.body!.y, added.body!.z]).toEqual(start)
    expect([added.node.x, added.node.y, added.node.z]).toEqual(end)
    expect(added.node.x - added.body!.x).toBeCloseTo(added.node.y - added.body!.y, 12)
  })
})
