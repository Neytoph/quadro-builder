import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { C45_ARM_LEN, C45_SLEEVE_LEN } from './config.js'

beforeAll(loadCatalog)

function vector(model: BuildModel, tube: { a: string; b: string }) {
  const a = model.nodes.get(tube.a)!, b = model.nodes.get(tube.b)!
  return [b.x - a.x, b.y - a.y, b.z - a.z]
}

// 使用隔离的真实引擎夹具验证形状不变量，不改变生产用户模型。
describe('吸附及刚体操作不改变管件形状', () => {
  it('弯管端点不吸向偏移节点，两端半径均保持40厘米', () => {
    const model = new BuildModel(), start = model.addNode(0, 80, 0)
    const nearby = model.addNode(40.2, 80, 40)
    const made = model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'TC35', 'red', 40)!
    const bow = made.tube as unknown as { bowCenter: number[] }
    expect(made.node.id).not.toBe(nearby.id)
    expect([made.node.x, made.node.y, made.node.z]).toEqual([40, 80, 40])
    expect(Math.hypot(...bow.bowCenter.map((v, i) => v - [made.node.x, made.node.y, made.node.z][i]))).toBeCloseTo(40, 10)
  })

  it('弯管旋转不吸向偏移节点，旋转前后半径保持', () => {
    const model = new BuildModel(), start = model.addNode(0, 80, 0)
    const made = model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'TC35', 'red', 40)!
    const bow = made.tube as unknown as { bowCenter: number[] }
    const nearby = model.addNode(40.2, 40, 0)
    const rotated = model.rotateBow(made.tube!.id, 1, { reverseOnBlock: false })!
    expect(rotated.node!.id).not.toBe(nearby.id)
    expect([rotated.node!.x, rotated.node!.y, rotated.node!.z]).toEqual([40, 40, 0])
    expect(Math.hypot(...bow.bowCenter.map((v, i) => v - [rotated.node!.x, rotated.node!.y, rotated.node!.z][i]))).toBeCloseTo(40, 10)
  })

  it.each([0, 5])('移动后的节点只在完全重合时合并，保持整根管的方向，吸附半径=%s', snapDist => {
    const model = new BuildModel(), a = model.addNode(0, 80, 0), b = model.addNode(40, 80, 0)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const stationary = { id: 'stationary', x: 40, y: 80.2, z: 0 }
    model.nodes.set(stationary.id, stationary)
    expect(model.moveSelection(new Map([[tube.id, 'tube']]), 0, .1, 0, { snapDist }).ok).toBe(true)
    expect(vector(model, tube)).toEqual([40, 0, 0])
    expect([stationary.x, stationary.y, stationary.z]).toEqual([40, 80.2, 0])
  })

  it('双管夹的第二根管不因端点附近节点改变平行方向', () => {
    const model = new BuildModel(), a = model.addNode(0, 80, 0), b = model.addNode(40, 80, 0)
    model.addTube(a.id, b.id, 'T35', 'green', 35)
    const clamp = model.addClamp(20, 80, 0); clamp.dir = [1, 0, 0]; clamp.off = [0, 5, 0]
    model.addNode(40, 85.2, 0)
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, tubeId: 'T35', colorFor: () => 'blue', onNotice: () => {}, onHistoryChange: () => {}, refresh: () => {} })
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    builder._placeSecondTube([20, 85, 0], clamp.dir, null, clamp.id)
    const second = [...model.tubes.values()].find(t => !t.link && t.a !== a.id)!
    expect(second).toBeTruthy()
    expect(vector(model, second)).toEqual([40, 0, 0])
    expect(model.nodes.get(second.a)!.y).toBe(85)
    expect(model.nodes.get(second.b)!.y).toBe(85)
  })

  it('非整数坐标刚体平移不逐点舍入，保留长度及方向', () => {
    const model = new BuildModel(), a = model.addNode(.004, 80.004, .004), b = model.addNode(28.288271247, 108.288271247, .004)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!, before = vector(model, tube)
    expect(model.moveSelection(new Map([[tube.id, 'tube']]), .003, .006, .001, { merge: false }).ok).toBe(true)
    vector(model, tube).forEach((value, axis) => expect(value).toBeCloseTo(before[axis], 10))
  })

  it('绕任意轴旋转保持管长，不因逐点舍入缩短或拉长', () => {
    const model = new BuildModel(), a = model.addNode(.004, 80.004, .004), b = model.addNode(40.004, 80.004, .004)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    expect(model.rotateSelectionAxis(new Map([[tube.id, 'tube']]), [1, 2, 3], .37, [.004, 80.004, .004]).ok).toBe(true)
    expect(Math.hypot(...vector(model, tube))).toBeCloseTo(40, 10)
  })

  it.each([20, 40])('%s厘米弯管不为近似闭环歪斜切线或改变半径', radius => {
    const model = new BuildModel(), center = model.addNode(0, 80, 0), start = model.addNode(radius, 80, 0)
    const end = model.addNode(.1, 80 + radius, 0)
    model.addTube(center.id, start.id, radius === 20 ? 'T15' : 'T35', 'blue', radius - 5)
    model.addTube(center.id, end.id, radius === 20 ? 'T15' : 'T35', 'blue', radius - 5)
    expect(model.closingBowNormal(start.id, [0, 1, 0], radius, [-1, 0, 0])).toBeNull()
  })

  it('镜像不会将非整数端点舍入到另一条轴线上', () => {
    const model = new BuildModel(), a = model.addNode(.004, 80.004, .004), b = model.addNode(28.288271247, 108.288271247, .004)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!, length = Math.hypot(...vector(model, tube))
    expect(model.mirrorSelection(new Map([[tube.id, 'tube']]), 'x', { merge: false }).ok).toBe(true)
    expect(Math.hypot(...vector(model, tube))).toBeCloseTo(length, 10)
  })

  it('单独安装C45体时，保持预设的轴线与偏移，不合并到附近节点', () => {
    const model = new BuildModel(), from = model.addNode(.004, 100.004, .004), S = Math.SQRT1_2
    const expected = [.004 - C45_SLEEVE_LEN + S * C45_ARM_LEN, 100.004 + S * C45_ARM_LEN, .004]
    const nearby = { id: 'nearby-adapter', x: expected[0], y: expected[1], z: expected[2] + .2 }
    model.nodes.set(nearby.id, nearby)
    const added = model.addC45Adapter(from.id, [-1, 0, 0], [S, S, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
    expect(added.body!.id).not.toBe(nearby.id)
    expect([added.body!.x, added.body!.y, added.body!.z]).toEqual(expected)
    expect(model.nodes.get(nearby.id)).toEqual(nearby)
  })

  it('管端安装C45的套筒基座保持精确落点', () => {
    const model = new BuildModel(), a = model.addNode(.004, 100.004, .004), b = model.addNode(40.004, 100.004, .004), S = Math.SQRT1_2
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const expected = [b.x - S * C45_SLEEVE_LEN + C45_ARM_LEN, b.y - S * C45_SLEEVE_LEN, b.z]
    const added = model.addC45OnTube(b.id, [S, S, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
    expect([added.base!.x, added.base!.y, added.base!.z]).toEqual(expected)
  })

  it('管夹安装跟随实际承载管，不覆盖相邻保存节点', () => {
    const model = new BuildModel(), a = model.addNode(.004, 100.004, .004), b = model.addNode(40.004, 100.004, .004)
    const tube = model.addTube(a.id, b.id, 'T35', 'green', 35)!, point = [20.004, 100.004, 5.004]
    const probe = model.tubeClampMount(tube.id, point, 'bearing')!
    const nearby = { id: 'nearby-clamp', x: probe.pos[0], y: probe.pos[1] + .2, z: probe.pos[2] }
    model.nodes.set(nearby.id, nearby)
    const added = model.addTubeClamp(tube.id, point, 'bearing')!
    expect(added.id).not.toBe(nearby.id)
    expect([added.x, added.y, added.z]).toEqual(probe.pos)
    expect(model.nodes.get(nearby.id)).toEqual(nearby)
  })
})
