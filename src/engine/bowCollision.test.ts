import { describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { tubePath, tubePathsCoincide } from './tubeCollision.js'

type Point = [number, number, number]
const R = 40
const middle: Point = [R / Math.sqrt(2), 80, R - R / Math.sqrt(2)]

// 隔离的几何夹具：水平四分之一圆，起点 (0,80,0)，终点 (40,80,40)。
function frame() {
  const model = new BuildModel()
  const start = model.addNode(0, 80, 0)
  const result = model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'B40', 'yellow', R)!
  if (!result.tube) throw new Error('弯管创建失败')
  return { model, bow: result.tube, start }
}

function straight(model: BuildModel, a: Point, b: Point) {
  const from = model.addNode(...a), to = model.addNode(...b)
  return model.addTube(from.id, to.id, 'T35', 'blue', 35)!
}

function vertical(model: BuildModel, x: number, z: number) {
  return straight(model, [x, 60, z], [x, 100, z])
}

describe('弯管按实际圆弧检测碰撞', () => {
  it('新增直管可以穿过弦线处的空位', () => {
    const { model } = frame()
    const from = model.addNode(20, 60, 20)
    expect(model.extend(from.id, [0, 1, 0], 'T35', 'blue', 35, 40)?.tube).toBeTruthy()
    expect(model.collisions().size).toBe(0)
  })

  it('斜管也可以穿过弦线处的空位', () => {
    const { model } = frame()
    const from = model.addNode(20, 60, 0)
    expect(model.extendDiagonalSnap(from.id, [0, Math.SQRT1_2, Math.SQRT1_2],
      'T35', 'blue', 35, 40 * Math.SQRT2)?.tube).toBeTruthy()
  })

  it('直管穿过实际弧线时拒绝新增且不留下零件', () => {
    const { model, bow } = frame()
    const from = model.addNode(middle[0], 60, middle[2])
    const before = model.toJSON()
    expect(model.tubeCollision(from, { x: middle[0], y: 100, z: middle[2] })?.id).toBe(bow.id)
    expect(model.tubeCollision(from, { x: middle[0], y: 100, z: middle[2] }, bow.id)).toBeNull()
    expect(model.extend(from.id, [0, 1, 0], 'T35', 'blue', 35, 40)).toEqual({ collision: true })
    expect(model.toJSON()).toEqual(before)
  })

  it('新增弯管时也拒绝穿过已有直管', () => {
    const model = new BuildModel()
    vertical(model, middle[0], middle[2])
    const start = model.addNode(0, 80, 0), before = model.toJSON()
    expect(model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'B40', 'yellow', R))
      .toEqual({ collision: true })
    expect(model.toJSON()).toEqual(before)
  })

  it('新增弯管可以绕过落在弦线上的直管', () => {
    const model = new BuildModel()
    vertical(model, 20, 20)
    const start = model.addNode(0, 80, 0)
    expect(model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'B40', 'yellow', R)?.tube).toBeTruthy()
  })

  it.each([10, 20, 40, 80])('半径 %s cm 的圆弧内部相交不会漏检', radius => {
    const model = new BuildModel(), start = model.addNode(0, 80, 0)
    const bow = model.extendBow(start.id, [1, 0, 0], [0, 0, 1], 'B40', 'green', radius)!.tube!
    const theta = 0.371
    const tube = vertical(model, radius * Math.sin(theta), radius * (1 - Math.cos(theta)))
    expect(model.collisions()).toEqual(new Set([bow.id, tube.id]))
  })

  it('遵循原有 0.5 cm 中心线容差，区分贴近与错层', () => {
    const { model, bow } = frame()
    const [x, y, z] = middle
    expect(model.tubeCollision({ x: x - 5, y: y + 0.4, z }, { x: x + 5, y: y + 0.4, z })?.id).toBe(bow.id)
    expect(model.tubeCollision({ x: x - 5, y: y + 0.6, z }, { x: x + 5, y: y + 0.6, z })).toBeNull()
  })

  it('共用接头的直管和弯管正常相接，包括 45 度方向', () => {
    for (const dir of [[-1, 0, 0], [0, 1, 0], [0, 0, -1], [Math.SQRT1_2, 0, -Math.SQRT1_2]]) {
      const { model, start } = frame()
      expect(model.extend(start.id, dir, 'T35', 'blue', 35, 40)?.tube).toBeTruthy()
      expect(model.collisions().size).toBe(0)
    }
  })

  it('共用接头的两根弯管可以连续安装', () => {
    const { model, bow } = frame()
    expect(model.extendBow(bow.b, [0, 0, 1], [-1, 0, 0], 'B40', 'green', R)?.tube).toBeTruthy()
    expect(model.collisions().size).toBe(0)
  })

  it('直管端点落在圆弧内部也算碰撞', () => {
    const { model, bow } = frame()
    const tube = straight(model, [middle[0], 60, middle[2]], middle)
    expect(model.collisions()).toEqual(new Set([bow.id, tube.id]))
  })

  it('直管在圆弧内部相切也算碰撞', () => {
    const { model, bow } = frame()
    const [x, y, z] = middle
    expect(model.tubeCollision({ x: x - 10, y, z: z - 10 }, { x: x + 10, y, z: z + 10 })?.id).toBe(bow.id)
  })

  it('共用弯管末端的直管仍可沿切线继续接管', () => {
    const { model, bow } = frame()
    expect(model.extend(bow.b, [0, 0, 1], 'T35', 'blue', 35, 40)?.tube).toBeTruthy()
    expect(model.collisions().size).toBe(0)
  })

  it('斜面圆弧的包围盒包含端点之间的最高处', () => {
    const model = new BuildModel(), start = model.addNode(0, 80, 0), s = Math.SQRT1_2
    const bow = model.extendBow(start.id, [s, s, 0], [s, -s, 0], 'B40', 'green', R)!.tube!
    const top = 80 + R * (1 - s)
    const tube = straight(model, [R * s, top, -10], [R * s, top, 10])
    expect(model.collisions()).toEqual(new Set([bow.id, tube.id]))
  })

  it('两根圆弧在内部相交时报告双方', () => {
    const { model, bow } = frame()
    const start = model.addNode(40, 80, 0), end = model.addNode(0, 80, 40)
    const other = model.addTube(start.id, end.id, 'B40', 'blue', null)!
    Object.assign(other, { bow: true, bowCenter: [40, 80, 40] })
    expect(model.collisions()).toEqual(new Set([bow.id, other.id]))
  })

  it('复制重合弯管时可允许合并，弧面不同不视为重合', () => {
    const { model, bow } = frame()
    const copy = { ...bow, id: 'copy', bow: true, bowCenter: [0, 80, 40] }
    model.tubes.set(copy.id, copy)
    expect(model.collisions()).toEqual(new Set([bow.id, copy.id]))
    expect(model.collisions({ allowCoincide: true }).size).toBe(0)
    const a = model.nodes.get(bow.a)!, b = model.nodes.get(bow.b)!
    expect(tubePathsCoincide(tubePath(a, b, bow), tubePath(b, a, copy))).toBe(true)
    copy.bowCenter = [40, 80, 0]
    expect(tubePathsCoincide(tubePath(a, b, bow), tubePath(a, b, copy))).toBe(false)
    expect(model.collisions({ allowCoincide: true }).size).toBe(0)
  })

  it('移动选区包含弯管，穿过弧线时恢复原来的节点和圆心', () => {
    const { model, bow } = frame()
    vertical(model, middle[0], middle[2] + 20)
    expect(model.tubesAt(new Set([bow.a, bow.b]))).toEqual(new Set([bow.id]))
    const before = model.toJSON()
    expect(model.moveSelection(new Map([[bow.id, 'tube']]), 0, 0, 20)).toEqual({ ok: false, reason: 'collision' })
    expect(model.toJSON()).toEqual(before)
  })

  it('移动至仅弦线相交的位置不会被拦截', () => {
    const { model, bow } = frame()
    vertical(model, 20, 40)
    expect(model.moveSelection(new Map([[bow.id, 'tube']]), 0, 0, 20)?.ok).toBe(true)
    expect(model.tubes.get(bow.id)!.bowCenter).toEqual([0, 80, 60])
  })

  it('只检查指定弯管时仍能发现与静止管的相交', () => {
    const { model, bow } = frame()
    const tube = vertical(model, middle[0], middle[2])
    expect(model.collisions({ only: new Set([bow.id]) })).toEqual(new Set([bow.id, tube.id]))
  })

  it('反向存储的圆弧与任意倾斜圆弧使用相同检测', () => {
    const s = Math.SQRT1_2
    // 使用刚体旋转：X 轴旋转 45 度，再绕 Y 轴旋转 45 度。
    const rotate = ([x, y, z]: Point): Point => [x * s + (y * s + z * s) * s, y * s - z * s, -x * s + (y * s + z * s) * s]
    const fresh = frame()
    for (const node of fresh.model.nodes.values()) [node.x, node.y, node.z] = rotate([node.x, node.y, node.z])
    const freshBow = fresh.model.tubes.get(fresh.bow.id)!
    freshBow.bowCenter = rotate([0, 80, 40])
    const from = rotate([middle[0], 60, middle[2]]), to = rotate([middle[0], 100, middle[2]])
    expect(fresh.model.tubeCollision({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] })?.id)
      .toBe(freshBow.id)
    const first = freshBow.a
    freshBow.a = freshBow.b
    freshBow.b = first
    expect(fresh.model.tubeCollision({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] })?.id)
      .toBe(freshBow.id)
  })

  it('旋转弯管时检测新圆弧，受阻后保留原姿态', () => {
    const { model, bow } = frame()
    const z = R - R / Math.sqrt(2)
    straight(model, [middle[0], 80 + z, -10], [middle[0], 80 + z, 10])
    const before = model.toJSON()
    expect(model.rotateBow(bow.id, -1, { reverseOnBlock: false })).toEqual({ blocked: true })
    expect(model.toJSON()).toEqual(before)
  })

  it('旋转弯管时新弦线上的空位仍可安装', () => {
    const { model, bow } = frame()
    straight(model, [20, 100, -10], [20, 100, 10])
    expect(model.rotateBow(bow.id, -1, { reverseOnBlock: false })?.node).toBeTruthy()
    expect(model.collisions().size).toBe(0)
  })

  it('直管重叠和交叉的原有检测保持有效', () => {
    const model = new BuildModel()
    const tube = straight(model, [0, 80, 0], [40, 80, 0])
    expect(model.tubeCollision({ x: 10, y: 80, z: 0 }, { x: 60, y: 80, z: 0 })?.id).toBe(tube.id)
    expect(model.tubeCollision({ x: 20, y: 60, z: 0 }, { x: 20, y: 100, z: 0 })?.id).toBe(tube.id)
    expect(model.tubeCollision({ x: 40, y: 80, z: 0 }, { x: 40, y: 100, z: 0 })).toBeNull()
  })
})
