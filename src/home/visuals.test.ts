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
