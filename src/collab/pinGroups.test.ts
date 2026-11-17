import { describe, expect, it } from 'vitest'
import { groupPins, layoutPinGroups } from './pinGroups'

describe('位置评论的屏幕点击区', () => {
  it('合并原反馈中会误点的2、4号，保留每条评论身份和独立位置', () => {
    const points = [{ id: '2', x: 213.6, y: 430.8 }, { id: '4', x: 218.2, y: 436.3 }, { id: '3', x: 303, y: 424 }]
    const original = structuredClone(points)
    const groups = groupPins(points)
    expect(groups.map(group => group.ids)).toEqual([['2', '4'], ['3']])
    expect(groups[0].x).toBeCloseTo(215.9)
    expect(points).toEqual(original)
  })

  it('镜头拉近后重新分开，各个标记仍能独立选择', () => {
    expect(groupPins([{ id: '2', x: 100, y: 100 }, { id: '4', x: 148, y: 100 }]).map(group => group.ids)).toEqual([['2'], ['4']])
  })

  it('合并后的标记再次相碰时继续合并，不生成互相盖住的组合', () => {
    const groups = groupPins([{ id: '1', x: 0, y: 0 }, { id: '2', x: 40, y: 0 }, { id: '3', x: 64, y: 0 }])
    expect(groups).toHaveLength(1)
    expect(groups[0].ids).toEqual(['1', '2', '3'])
  })

  it('同一位置的多条评论都保留在一个可展开的标记中', () => {
    const points = Array.from({ length: 100 }, (_, id) => ({ id: String(id), x: 200, y: 200 }))
    expect(groupPins(points)).toEqual([{ ids: points.map(point => point.id), x: 200, y: 200 }])
    expect(groupPins([])).toEqual([])
  })

  it('避开小麦气泡，保留标记身份与原始投影位置', () => {
    const points = [{ id: '1', x: 150, y: 270 }]
    const groups = layoutPinGroups(points, [{ left: 110, top: 250, right: 320, bottom: 295 }], { width: 390, height: 664, top: 60 })
    expect(groups).toEqual([{ ids: ['1'], x: 150, y: 242 }])
    expect(points).toEqual([{ id: '1', x: 150, y: 270 }])
  })

  it('避让多个功能区后不越过屏幕，也不产生互相覆盖的组合', () => {
    const obstacles = [{ left: 8, top: 72, right: 382, bottom: 131 }, { left: 194, top: 142, right: 378, bottom: 230 }, { left: 110, top: 250, right: 320, bottom: 295 }]
    const points = [{ id: '1', x: 155, y: 270 }, { id: '7', x: 160, y: 265 }, { id: '2', x: 220, y: 230 }]
    const groups = layoutPinGroups(points, obstacles, { width: 390, height: 664, top: 60 })
    expect(groups.flatMap(group => group.ids).sort()).toEqual(['1', '2', '7'])
    for (const group of groups) {
      expect(group.x).toBeGreaterThanOrEqual(22)
      expect(group.x).toBeLessThanOrEqual(368)
      expect(group.y).toBeLessThanOrEqual(656)
      expect(obstacles.every(rect => group.x + 22 <= rect.left - 6 || group.x - 22 >= rect.right + 6 || group.y <= rect.top - 6 || group.y - 44 >= rect.bottom + 6)).toBe(true)
    }
    expect(groupPins(groups.map((group, i) => ({ id: String(i), x: group.x, y: group.y })))).toHaveLength(groups.length)
  })
})
