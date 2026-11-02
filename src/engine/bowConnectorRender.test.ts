import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadCatalog, geometry } from './catalog.js'
import { SceneManager } from './scene.js'
import { CONNECTOR_ARM_BITS } from './qdfimport.js'

beforeAll(() => loadCatalog())

type RawMesh = { mask: number; pos: number[]; nrm: number[]; idx: number[] }
type MeshRecord = { mask: number; pos: Float32Array; nrm: Float32Array; idx: Uint16Array }
type MeshScene = SceneManager & { _connMeshes: Record<string, MeshRecord> }

function sceneWithMeshes(file: string) {
  // 几何方法直接使用真实网格；浏览器验收另外创建完整 WebGL 场景。
  const scene = Object.create(SceneManager.prototype) as MeshScene
  const raw = JSON.parse(readFileSync(`public/data/models/${file}`, 'utf8')) as Record<string, RawMesh>
  scene._connMeshes = Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, {
    mask: value.mask,
    pos: Float32Array.from(value.pos, (n: number) => n / 100),
    nrm: Float32Array.from(value.nrm, (n: number) => n / 1000),
    idx: Uint16Array.from(value.idx),
  }]))
  scene._keepGeos = new Set()
  return scene
}

function dispose(scene: SceneManager) {
  for (const geo of scene._keepGeos) geo.dispose()
}

describe('弯管端部的真实接头网格', () => {
  for (const file of ['connectors.json', 'connectors-fine.json']) {
    it(`${file} 各型号插入弯管的直杆完全留在管身内，本体和其他插口保持原样`, () => {
      const scene = sceneWithMeshes(file)
      for (const [id, rec] of Object.entries(scene._connMeshes)) {
        const arms = (CONNECTOR_ARM_BITS as Array<[number, number[]]>).filter(([bit]) => rec.mask & bit)
        for (const [bowBit, direction] of arms) {
          const axis = new THREE.Vector3(...direction)
          const inward = new THREE.Vector3(direction[1], direction[2], direction[0]).normalize()
          const source = scene._connMeshFor(arms.map(([, d]: [number, number[]]) => ({ d })), new THREE.Quaternion(), id)
          assert.ok(source)
          source.geo.computeBoundingBox()
          const rendered = scene._connMeshFor(arms.map(([bit, d]: [number, number[]]) => ({ d, bow: bit === bowBit })), new THREE.Quaternion(), id)
          assert.ok(source && rendered)
          const inverse = rendered.quat.clone().invert()
          const original = source.geo.getAttribute('position'), positions = rendered.geo.getAttribute('position')
          let changed = 0, originalOutside = 0
          // 使用实际 40 cm 弯管路径，检查插杆每个表面顶点到管中心线的距离。
          const curve = scene._bowCurve(new THREE.Vector3(), axis.clone().add(inward).multiplyScalar(40), inward.clone().multiplyScalar(40).toArray(), geometry().connectorSize / 2)
          assert.ok(curve)
          const path = curve.getSpacedPoints(1000)
          for (let i = 0; i < positions.count; i++) {
            const before = new THREE.Vector3().fromBufferAttribute(original, i)
            const after = new THREE.Vector3().fromBufferAttribute(positions, i)
            const localAxis = axis.clone().applyQuaternion(inverse)
            if (before.dot(localAxis) <= geometry().connectorSize / 2 + 0.00001) {
              expect(after.toArray()).toEqual(before.toArray())
            } else {
              changed++
              const world = after.applyQuaternion(rendered.quat)
              expect(world.dot(axis)).toBeLessThanOrEqual(3.70001)
              if (world.dot(axis) > 3) {
                expect(Math.min(...path.map((p: THREE.Vector3) => p.distanceTo(world)))).toBeLessThan(geometry().tubeRadius - 0.01)
              }
              const oldWorld = before.applyQuaternion(source.quat)
              if (Math.min(...path.map((p: THREE.Vector3) => p.distanceTo(oldWorld))) > geometry().tubeRadius) originalOutside++
            }
          }
          expect(changed).toBeGreaterThan(0)
          expect(originalOutside).toBeGreaterThan(0)
          expect(rendered.geo).not.toBe(source.geo)
          expect(rendered.geo.boundingBox?.equals(new THREE.Box3().setFromBufferAttribute(positions))).toBe(true)
          expect(Array.from(source.geo.getAttribute('position').array)).toEqual(Array.from(rec.pos))
          const again = scene._connMeshFor(arms.map(([bit, d]: [number, number[]]) => ({ d, bow: bit === bowBit })), new THREE.Quaternion(), id)
          expect(again?.geo).toBe(rendered.geo)
          expect(scene._connMeshFor(arms.map(([, d]) => ({ d })), new THREE.Quaternion(), id)?.geo).toBe(source.geo)
        }
      }
      dispose(scene)
    })
  }

  it('旋转后的两个弯管仅收短对应插杆，直管保持长度，细节升级释放全部变体', () => {
    const scene = sceneWithMeshes('connectors-fine.json')
    const cube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 0.73)
    const arms = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const dirs = arms.map((d, i) => ({ d: new THREE.Vector3(...d).applyQuaternion(cube).toArray(), bow: i === 0 || i === 3 }))
    const rendered = scene._connMeshFor(dirs, cube, '6way')
    const source = scene._connMeshFor(dirs.map(e => ({ ...e, bow: false })), cube, '6way')
    assert.ok(source && rendered)
    expect(rendered.quat.angleTo(source.quat)).toBeLessThan(0.000001)
    const inverse = cube.clone().invert()
    const limits = arms.map(d => {
      const axis = new THREE.Vector3(...d)
      const position = rendered.geo.getAttribute('position')
      return Math.max(...Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyQuaternion(rendered.quat).applyQuaternion(inverse).dot(axis)))
    })
    expect(limits[0]).toBeCloseTo(3.7)
    expect(limits[3]).toBeCloseTo(3.7)
    for (const i of [1, 2, 4, 5]) expect(limits[i]).toBeCloseTo(7.5)
    expect(scene._keepGeos.size).toBe(2)
    scene._clearMeshGeometry()
    expect(scene._keepGeos.size).toBe(0)
    expect(scene._fitGeos?.size).toBe(0)
  })

  it('接头型号自身旋转后仍按最终局部方向收短弯管插杆', () => {
    const scene = sceneWithMeshes('connectors-fine.json')
    const cube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 0.73)
    const directions = [[0, 0, -1], [0, 0, 1], [-1, 0, 0]]
    const dirs = directions.map((d, i) => ({ d: new THREE.Vector3(...d).applyQuaternion(cube).toArray(), bow: i === 0 }))
    const rendered = scene._connMeshFor(dirs, cube, 't')
    assert.ok(rendered)
    expect(rendered.quat.angleTo(cube)).toBeGreaterThan(0.1)
    const positions = rendered.geo.getAttribute('position')
    for (let i = 0; i < dirs.length; i++) {
      const axis = new THREE.Vector3(...dirs[i].d)
      const extent = Math.max(...Array.from({ length: positions.count }, (_, n) => new THREE.Vector3().fromBufferAttribute(positions, n).applyQuaternion(rendered.quat).dot(axis)))
      expect(extent).toBeCloseTo(i === 0 ? 3.7 : 7.5)
    }
    dispose(scene)
  })
})
