import { describe, expect, it } from 'vitest'
import { BoxGeometry, Float32BufferAttribute } from 'three'
import { BuildModel } from './model.js'
import { cachedTubePath, tubePath } from './tubeCollision.js'
import { SceneManager } from './scene.js'

describe('几何计算缓存', () => {
  it('分析快照只读取模型，正常存档继续清理失效分组', () => {
    const model = new BuildModel(), node = model.addNode(0, 0, 0)
    model.groups.set('g1', new Set([node.id, 'deleted']))
    expect(model.toJSON({ pruneGroups: false }).groups[0].ids).toEqual([node.id, 'deleted'])
    expect(model.groups.get('g1')).toEqual(new Set([node.id, 'deleted']))
    expect(model.toJSON().groups).toEqual([])
    expect(model.groups.size).toBe(0)
    expect(JSON.parse(JSON.stringify(model)).nodes).toEqual(model.toJSON().nodes)
  })

  it('重复弯管检查复用路径，原地移动端点和弯心立即重算', () => {
    const a = { x: 0, y: 80, z: 0 }, b = { x: 40, y: 80, z: 40 }
    const tube = { bow: true, bowCenter: [0, 80, 40] }
    const original = cachedTubePath(a, b, tube)
    expect(cachedTubePath(a, b, tube)).toBe(original)
    expect(original).toEqual(tubePath(a, b, tube))
    a.x += 10; b.x += 10; tube.bowCenter[0] += 10
    const moved = cachedTubePath(a, b, tube)
    expect(moved).not.toBe(original)
    expect(moved).toEqual(tubePath(a, b, tube))
    expect(original.points[0].x).toBeCloseTo(0)
    tube.bowCenter[2] += 5
    expect(cachedTubePath(a, b, tube)).toEqual(tubePath(a, b, tube))
    tube.bow = false
    expect(cachedTubePath(a, b, tube)).toEqual(tubePath(a, b, tube))
  })

  it('缓存后的弯管移动、删除和重新载入仍使用当前实际碰撞', () => {
    const model = new BuildModel(), a = model.addNode(0, 80, 0)
    const bow = model.extendBow(a.id, [1, 0, 0], [0, 0, 1], 'B40', 'yellow', 40)!.tube!
    const x = 40 / Math.sqrt(2), z = 40 - x
    const from = { x, y: 60, z }, to = { x, y: 100, z }
    expect(model.tubeCollision(from, to)?.id).toBe(bow.id)
    const before = structuredClone(model.toJSON())
    for (const n of model.nodes.values()) n.x += 100
    model.tubes.get(bow.id).bowCenter[0] += 100
    expect(model.tubeCollision(from, to)).toBeNull()
    expect(model.tubeCollision({ ...from, x: x + 100 }, { ...to, x: x + 100 })?.id).toBe(bow.id)
    model.loadJSON(before)
    expect(model.tubeCollision(from, to)?.id).toBe(bow.id)
    model.removeTube(bow.id)
    expect(model.tubeCollision(from, to)).toBeNull()
  })

  it('选择与悬停复用边线计算，轮廓可独立释放且几何修改会失效', () => {
    const scene = Object.create(SceneManager.prototype)
    scene._materials = {}
    const geometry = new BoxGeometry(2, 2, 2)
    const first = scene._partOutline(geometry, false), second = scene._partOutline(geometry, true)
    expect(first.geometry).not.toBe(second.geometry)
    expect(first.geometry.getAttribute('instanceStart').data.array)
      .toBe(second.geometry.getAttribute('instanceStart').data.array)
    first.geometry.dispose()
    expect(second.geometry.getAttribute('instanceStart').count).toBeGreaterThan(0)
    const before = scene._partOutlinePositions.get(geometry)
    geometry.scale(2, 1, 1)
    const changed = scene._partOutline(geometry, false)
    expect(scene._partOutlinePositions.get(geometry)).not.toBe(before)
    expect(changed.geometry.getAttribute('instanceStart').data.array)
      .not.toBe(second.geometry.getAttribute('instanceStart').data.array)
    const position = geometry.getAttribute('position')
    geometry.setAttribute('position', new Float32BufferAttribute(position.array, 3))
    const replaced = scene._partOutline(geometry, false)
    expect(scene._partOutlinePositions.get(geometry).source).not.toBe(position)
    for (const line of [second, changed, replaced]) line.geometry.dispose()
    for (const material of Object.values(scene._materials)) (material as { dispose(): void }).dispose()
    geometry.dispose()
  })
})
