import { beforeAll, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'

beforeAll(loadCatalog)

function frame(radius: number) {
  const model = new BuildModel(), center = model.addNode(0, 80, 0)
  const start = model.addNode(radius, 80, 0), end = model.addNode(0, 80 + radius, 0)
  const tube = radius === 20 ? 'T15' : 'T35', length = radius - 5
  model.addTube(center.id, start.id, tube, 'blue', length)
  model.addTube(center.id, end.id, tube, 'blue', length)
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.scene = { getHorizontalAxes: () => ({ forward: [0, 0, 1] }) }
  builder.tubeId = radius === 20 ? 'TC15' : 'TC1'
  return { model, start, end, builder }
}

it.each([20, 40])('%i cm 弯管优先闭合已有管架，端点和存档保持连接', radius => {
  const { model, start, end, builder } = frame(radius)
  const dir = [0, 1, 0]
  const normal = builder._bowNormal(dir, start)
  expect(normal).toEqual([-1, 0, 0])
  const result = model.extendBow(start.id, dir, normal, builder.tubeId, 'blue', radius)!
  expect(result.node!.id).toBe(end.id)
  expect((result.tube as unknown as {bowCenter: number[]}).bowCenter).toEqual([0, 80, 0])
  const reopened = new BuildModel()
  expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
  expect(reopened.tubes.get(result.tube!.id)!.b).toBe(end.id)
})

it('不把没有连接路径的接头识别成闭环', () => {
  const { model, start, end, builder } = frame(40)
  for (const tube of [...model.tubes.values()]) if (tube.a === end.id || tube.b === end.id) model.removeTube(tube.id)
  model.addNode(0, 120, 0)
  expect(builder._bowNormal([0, 1, 0], start)).toEqual([0, 0, 1])
})

it('闭环端点插口被占用时保留默认方向', () => {
  const { model, start, end, builder } = frame(40)
  const occupied = model.addNode(40, 120, 0)
  model.addTube(end.id, occupied.id, 'T35', 'red', 35)
  expect(builder._bowNormal([0, 1, 0], start)).toEqual([0, 0, 1])
  expect(model.extendBow(start.id, [0, 1, 0], [-1, 0, 0], 'TC1', 'blue', 40)).toEqual({ collision: true })
})

it('弧线受到其他管阻挡时不选择该闭环方向', () => {
  const { model, start, builder } = frame(40)
  const a = model.addNode(28, 108, -20), b = model.addNode(28, 108, 20)
  model.addTube(a.id, b.id, 'T35', 'red', 35)
  expect(builder._bowNormal([0, 1, 0], start)).toEqual([0, 0, 1])
})

it.each([
  [[1, 0, 0], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1]],
  [[0, 0, -1], [0, -1, 0]],
  [[Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]],
])('旋转后的切线 %j 和法线 %j 可以闭环', (dir, normal) => {
  const model = new BuildModel(), radius = 40
  const origin = [0, 100, 0], start = model.addNode(...origin)
  const center = model.addNode(...origin.map((v, i) => v + normal[i] * radius))
  const end = model.addNode(...origin.map((v, i) => v + (dir[i] + normal[i]) * radius))
  model.addTube(start.id, center.id, 'T35', 'blue', 35)
  model.addTube(center.id, end.id, 'T35', 'blue', 35)
  const selected = model.closingBowNormal(start.id, dir, radius, normal)
  expect(selected).toBeTruthy()
  selected!.forEach((value, i) => expect(value).toBeCloseTo(normal[i], 3))
  expect(model.extendBow(start.id, dir, selected!, 'TC1', 'blue', radius)!.node!.id).toBe(end.id)
})
