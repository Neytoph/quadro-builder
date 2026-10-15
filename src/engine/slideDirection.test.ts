import { beforeAll, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'

beforeAll(async () => { await loadCatalog() })

it('设计指定滑梯朝向时分别检查出入口、通路和落地，不被默认朝向覆盖', () => {
  const model = new BuildModel()
  const left: any[] = [], right: any[] = []
  for (const y of [0, 40, 80, 120]) {
    left.push(model.addNode(2.5, y + 2.5, 2.5))
    right.push(model.addNode(42.5, y + 2.5, 2.5))
  }
  for (const nodes of [left, right]) for (let i = 0; i < 3; i++) expect(model.addTube(nodes[i].id, nodes[i + 1].id, 'T35', 'blue', 35)).toBeTruthy()
  expect(model.addTube(left[2].id, right[2].id, 'T35', 'blue', 35)).toBeTruthy()
  const entry = (mount: any) => Math.hypot(mount.hook[0] - 22.5, mount.hook[1] - 87.5, mount.hook[2] - 2.5) < 0.1
  for (const normal of [[0, 0, 1], [0, 0, -1]]) {
    const mount = model.slideMounts(40, 2, 'slide-new2', false, normal).find(entry)
    expect(mount).toBeTruthy()
    expect(mount!.normal).toEqual(normal)
  }
  model.addNode(22.5, 42.5, 82.5)
  expect(model.slideMounts(40, 2, 'slide-new2', false, [0, 0, 1]).some(entry)).toBe(false)
  expect(model.slideMounts(40, 2, 'slide-new2', false, [0, 0, -1]).some(entry)).toBe(true)
  for (const invalid of [[1, 0, 0], [0, 1, 0], [0, 0, 2], [0, 0, NaN]]) expect(model.slideMounts(40, 2, 'slide-new2', false, invalid).some(entry)).toBe(false)
})
