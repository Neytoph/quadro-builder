import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PanelPlacementGuides } from './panelPlacementGuides.js'
import { Builder } from './builder.js'
import { loadCatalog, geometry } from './catalog.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'

beforeAll(() => loadCatalog())

describe('板件安装位置独立提示', () => {
  it('可见实线和遮挡虚线使用互补深度条件，提示不改变真实模型', () => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    const before = model.toJSON(), scene = new THREE.Scene(), guides = new PanelPlacementGuides(scene)
    guides.setRails(model, new Set(model.tubes.keys()), null)
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 1000)
    camera.position.set(100, 100, 180); camera.lookAt(40, 40, 0)
    guides.update(camera)
    expect(guides.lines.material.depthFunc).toBe(THREE.LessEqualDepth)
    expect(guides.hidden.material.depthFunc).toBe(THREE.GreaterDepth)
    expect(guides.hidden.material.depthWrite).toBe(false)
    expect(guides.hidden.material.opacity).toBeLessThan(guides.lines.material.opacity)
    expect(guides.hidden.geometry.getAttribute('instanceDistanceStart').count).toBe(guides.rails.length * 4)
    expect(model.toJSON()).toEqual(before)
    expect(scene.children).toHaveLength(1)
    guides.dispose(); expect(scene.children).toHaveLength(0)
  })

  it('镜头转动后轮廓跟随，沿管轴观察也不产生无效坐标', () => {
    const model = createDirectInstallationFrame(), guides = new PanelPlacementGuides(new THREE.Scene())
    const id = [...model.tubes.keys()][0]
    guides.setRails(model, new Set([id]), id)
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(120, 90, 100); camera.lookAt(40, 42.5, 20); guides.update(camera)
    const before = [...(guides.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array]
    camera.position.set(120, 42.5, 0); camera.lookAt(20, 42.5, 0); guides.update(camera)
    const after = [...(guides.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array]
    expect(after.every(Number.isFinite)).toBe(true); expect(after).not.toEqual(before)
    const color = guides.lines.geometry.getAttribute('instanceColorStart')
    expect(color.getX(0)).toBeCloseTo(new THREE.Color('#f88929').r)
    guides.dispose()
  })

  it('已有板占据的框格退出候选，剩余位置可以连续放置', () => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    // 这里只隔离控制器调度；安装与候选计算使用真实 BuildModel，鼠标另行浏览器验收。
    const builder = Object.create(Builder.prototype) as Builder
    Object.assign(builder, { model, mode: 'panel', panelId: 'panel_40x40', panelRail: null })
    const before = builder._firstRailCandidates()!
    expect(before.size).toBeGreaterThan(0)
    const mount = model.panelAccessoryMounts('panel_40x40', { screwAxis: 'auto', oppositeRetainers: true })[0]
    expect(model.addPanelAccessory(mount, 'blue')).toBeTruthy()
    const after = builder._firstRailCandidates()!
    expect(after.size).toBeLessThan(before.size)
    expect(model.panelAccessoryMounts('panel_40x40', { screwAxis: 'auto', oppositeRetainers: true }).length).toBeGreaterThan(0)
    expect([...model.panels.values()]).toHaveLength(1)
  })

  it('短管外观长度与导入几何一致，切换模式可清空提示', () => {
    const model = createDirectInstallationFrame(), guides = new PanelPlacementGuides(new THREE.Scene())
    const tube = [...model.tubes.values()][0]
    Object.assign(tube, { geom: { p0: [10, 20, 30], dir: [1, 0, 0], len: 35, pad: 2 } })
    guides.setRails(model, new Set([tube.id]), null)
    expect(guides.rails[0].len).toBe(37)
    expect(guides.rails[0].mid.x).toBe(10 + (37 + geometry().connectorSize) / 2)
    guides.setRails(model, null, null)
    expect(guides.group.visible).toBe(false); expect(guides.rails).toHaveLength(0)
    guides.dispose()
  })
})
