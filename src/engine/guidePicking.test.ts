import { describe, expect, it } from 'vitest'
import { preferGuideHandle } from './pickcell.js'
import * as THREE from 'three'
import { SceneManager } from './scene.js'

type Point = number[]
function hit(segment: Point[], distance: number) {
  const root = { userData: { guideSegment: segment } }
  return { object: { userData: { arrowRoot: root } }, distance }
}
const project = (p: Point) => p

describe('方向线重叠拾取', () => {
  it.each([[8, 0, 'red'], [0, 8, 'green'], [-8, -8, 'blue']])('靠近%s,%s选择对应可见线，不按摄像机距离抢选', (x, y, expected) => {
    const red = hit([[0, 0], [30, 0]], 30)
    const green = hit([[0, 0], [0, 30]], 20)
    const blue = hit([[0, 0], [-30, -30]], 10)
    expect(preferGuideHandle([blue, green, red], x as number, y as number, project))
      .toBe({ red, green, blue }[expected as 'red' | 'green' | 'blue'])
  })
  it('公共根部无明确方向时不误安装', () => {
    expect(preferGuideHandle([hit([[0, 0], [30, 0]], 5), hit([[0, 0], [0, 30]], 4)], 0, 0, project)).toBeNull()
  })
  it('正对摄像机缩成点的方向不截取红线点击', () => {
    const red = hit([[0, 0], [30, 0]], 30)
    expect(preferGuideHandle([hit([[0, 0], [.1, .1]], 2), red], 5, 0, project)).toBe(red)
  })
  it('平行管的线段按实际两端排序，端点外不无限延长', () => {
    const short = hit([[5, 0], [10, 0]], 5), long = hit([[5, 1], [40, 1]], 20)
    expect(preferGuideHandle([short, long], 30, 0, project)).toBe(long)
  })
  it('普通安装点保持原判定，空列表与裁切方向不产生结果', () => {
    const dot = { object: { userData: {} }, distance: 1 }
    expect(preferGuideHandle([dot, hit([[0, 0], [30, 0]], 5)], 5, 0, project)).toBe(dot)
    expect(preferGuideHandle([], 0, 0, project)).toBeNull()
    expect(preferGuideHandle([hit([[0, 0], [30, 0]], 5)], 5, 0, () => null)).toBeNull()
  })
  it('沿管移动操作点时，判定线段随真实位置移动', () => {
    const scene = Object.create(SceneManager.prototype), group = new THREE.Group()
    group.userData.guideSegment = [[0, 0, 0], [21, 0, 0]]
    scene.moveHandle(group, [10, 5, 0])
    expect(group.userData.guideSegment).toEqual([[10, 5, 0], [31, 5, 0]])
  })
})
