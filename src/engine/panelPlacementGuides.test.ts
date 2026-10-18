import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PanelPlacementGuides } from './panelPlacementGuides.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog, geometry } from './catalog.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'

beforeAll(() => loadCatalog())

describe('板件安装位置独立提示', () => {
  it('只绘制通过场景深度检查的实线，提示不改变真实模型', () => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    const before = model.toJSON(), scene = new THREE.Scene(), guides = new PanelPlacementGuides(scene)
    guides.setRails(model, new Set(model.tubes.keys()), null)
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 1000)
    camera.position.set(100, 100, 180); camera.lookAt(40, 40, 0)
    guides.update(camera)
    expect(guides.lines.material.depthFunc).toBe(THREE.LessEqualDepth)
    expect(guides.lines.material.depthTest).toBe(true)
    expect(guides.group.children).toEqual([guides.lines])
    expect(model.toJSON()).toEqual(before)
    expect(scene.children).toHaveLength(1)
    guides.dispose(); expect(scene.children).toHaveLength(0)
  })

  it('固定镜头下跟随真实管子动画，结束和中途关闭动画后回到最终位置', () => {
    // 隔离 WebGL；实际动画、实例矩阵与提示几何使用场景实现，浏览器另验真实深度遮挡。
    const model = createDirectInstallationFrame(), root = new THREE.Scene(), guides = new PanelPlacementGuides(root)
    const id = [...model.tubes.keys()][0]
    guides.setRails(model, new Set([id]), null)
    const rail = guides.rails[0], mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(rail.len, 1, 1), new THREE.MeshBasicMaterial(), 1)
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(rail.mid.x, rail.mid.y, rail.mid.z)); root.add(mesh)
    const scene = Object.create(SceneManager.prototype), camera = new THREE.OrthographicCamera(-100, 100, 100, -100, .1, 1000)
    camera.position.set(40, 80, 200); camera.lookAt(rail.mid)
    const animation = { center: rail.mid.clone(), pieces: scene._bindPieces([{ obj: mesh, index: 0 }]), t0: 0, delay: 100, dur: 620, scale: 1, dy: 0 }
    const poses = new Map([[`tube:${id}`, animation]])
    const matrix = new THREE.Matrix4()
    for (const now of [0, 180, 400, 720]) {
      scene._poseAppear(animation, now); guides.update(camera, poses)
      mesh.getMatrixAt(0, matrix)
      const actual = new THREE.Vector3().setFromMatrixPosition(matrix)
      const coords = guides.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
      const first = new THREE.Vector3(coords.getX(0), coords.getY(0), coords.getZ(0))
      const opposite = new THREE.Vector3(coords.getX(2), coords.getY(2), coords.getZ(2))
      const offset = camera.getWorldDirection(new THREE.Vector3()).negate().multiplyScalar(.06 * animation.scale)
      expect(first.add(opposite).multiplyScalar(.5).distanceTo(actual.add(offset))).toBeLessThan(.00002)
      const start = new THREE.Vector3(coords.getX(0), coords.getY(0), coords.getZ(0))
      const end = guides.lines.geometry.getAttribute('instanceEnd')
      expect(start.distanceTo(new THREE.Vector3(end.getX(0), end.getY(0), end.getZ(0)))).toBeCloseTo(rail.len * animation.scale, 4)
    }
    scene._poseAppear(animation, 180); guides.update(camera, poses)
    poses.clear(); guides.update(camera, poses)
    const restored = [...(guides.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array]
    guides.dirty = true; guides.update(camera)
    expect([...(guides.lines.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array]).toEqual(restored)
    guides.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose()
  })

  it('背景切换立即改变细线颜色，选中管仍保持橙色', () => {
    const model = createDirectInstallationFrame(), guides = new PanelPlacementGuides(new THREE.Scene()), camera = new THREE.PerspectiveCamera()
    const ids = [...model.tubes.keys()]; camera.position.set(100, 100, 180); camera.lookAt(40, 40, 0)
    guides.setRails(model, new Set(ids), ids[1]); guides.update(camera, undefined, 'grass')
    const colors = () => guides.lines.geometry.getAttribute('instanceColorStart')
    expect(colors().getX(0)).toBeCloseTo(new THREE.Color('#fff7df').r)
    guides.update(camera, undefined, 'home')
    expect(colors().getX(0)).toBeCloseTo(new THREE.Color('#9a451c').r)
    expect(colors().getX(4)).toBeCloseTo(new THREE.Color('#f88929').r)
    expect(guides.lines.material.linewidth).toBe(2)
    guides.dispose()
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
