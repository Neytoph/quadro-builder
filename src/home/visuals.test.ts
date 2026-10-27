import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createHomeVisuals, furnitureRotation } from './visuals.js'

const visuals = createHomeVisuals(THREE, RoundedBoxGeometry)

describe('家具旋转保持真实形状', () => {
  for (const type of ['cabinet', 'sofa', 'bed', 'table', 'column', 'other']) {
    it(`${type} 四个朝向的每个顶点均为刚性旋转`, () => {
      const base = visuals.furniture(type, false, 0)
      base.scale.set(120, 180, 45)
      base.updateMatrixWorld(true)
      for (const rotation of [90, 180, 270, 0]) {
        const turned = visuals.furniture(type, rotation % 180 === 90, rotation)
        turned.scale.set(rotation % 180 ? 45 : 120, 180, rotation % 180 ? 120 : 45)
        turned.updateMatrixWorld(true)
        const before = base.children[0].children as THREE.Mesh[]
        const after = turned.children[0].children as THREE.Mesh[]
        for (let n = 0; n < before.length; n++) {
          const vertices = before[n].geometry.getAttribute('position')
          for (let v = 0; v < vertices.count; v++) {
            const p = new THREE.Vector3().fromBufferAttribute(vertices, v).applyMatrix4(before[n].matrixWorld)
            const expected = rotation === 90 ? new THREE.Vector3(p.z, p.y, 120 - p.x) : rotation === 180 ? new THREE.Vector3(120 - p.x, p.y, 45 - p.z) : rotation === 270 ? new THREE.Vector3(45 - p.z, p.y, p.x) : p
            const actual = new THREE.Vector3().fromBufferAttribute(after[n].geometry.getAttribute('position'), v).applyMatrix4(after[n].matrixWorld)
            expect(actual.distanceTo(expected)).toBeLessThan(.00001)
          }
        }
      }
    })
  }
  it('兼容旧柜子朝向，显式角度不随宽深改变', () => {
    expect(furnitureRotation({ type: 'cabinet', w: 45, d: 120 })).toBe(90)
    expect(furnitureRotation({ type: 'bed', w: 150, d: 200 })).toBe(0)
    expect(furnitureRotation({ type: 'cabinet', w: 45, d: 120, rotation: 180 })).toBe(180)
  })
})

describe('墙面开口', () => {
  it('门洞穿过墙体，旁边墙面保留，四面墙均可设置开口', () => {
    const room = { w: 450, d: 350, h: 260 }
    for (const [wall, origin, direction, solid] of [
      ['back', [100, 100, -30], [0, 0, 1], [20, 100, -30]],
      ['front', [100, 100, 380], [0, 0, -1], [20, 100, 380]],
      ['left', [-30, 100, 100], [1, 0, 0], [-30, 100, 20]],
      ['right', [480, 100, 100], [-1, 0, 0], [480, 100, 20]]
    ] as const) {
      const shell = visuals.roomShell(room, [{ id: 'door', kind: 'door', wall, offset: 50, width: 100, height: 200, elevation: 0 }])
      shell.updateMatrixWorld(true)
      const wallGroup = shell.children.find((o: THREE.Object3D) => o.userData.wall === (wall === 'back' || wall === 'front' ? 'z' : 'x') && o.userData.wallMaxSide === (wall === 'front' || wall === 'right'))!
      const ray = (p: readonly number[]) => new THREE.Raycaster(new THREE.Vector3(...p as [number, number, number]), new THREE.Vector3(...direction))
      expect(ray(origin).intersectObject(wallGroup, true)).toHaveLength(0)
      expect(ray(solid).intersectObject(wallGroup, true).length).toBeGreaterThan(0)
    }
  })
})
