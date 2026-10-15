import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SceneManager } from './scene.js'

// 隔离几何夹具只核验渲染平移与材质，不代替真实 QDF/PDF 验收。
describe('装配渲染展示状态', () => {
  it('连接件旋转缓存按型号集合与场景隔离，不沿用首个型号的旋转表', () => {
    const createScene = () => {
      const scene = Object.create(SceneManager.prototype)
      scene._connMeshes = { straight: { mask: 3 }, elbow: { mask: 5 }, '3way': { mask: 21 } }
      scene._meshGeometry = (name: string) => ({ name })
      return scene
    }
    const identity = new THREE.Quaternion()
    const arms = (vectors: number[][]) => vectors.map(d => ({ d }))
    const rotatedArms = (vectors: number[][], quat: THREE.Quaternion) => vectors.map(d => new THREE.Vector3(...d).applyQuaternion(quat).toArray().map(value => Math.round(value) || 0)).sort()
    const first = createScene()
    first._connMeshFor(arms([[1, 0, 0], [-1, 0, 0]]), identity, 'straight')
    const elbow = first._connMeshFor(arms([[-1, 0, 0], [0, 1, 0]]), identity, 'elbow')
    expect(elbow.geo.name).toBe('conn:elbow')
    expect(rotatedArms([[1, 0, 0], [0, 1, 0]], elbow.quat)).toEqual([[-1, 0, 0], [0, 1, 0]].sort())
    const second = createScene()
    const corner = second._connMeshFor(arms([[0, -1, 0], [-1, 0, 0], [0, 0, -1]]), identity, '3way')
    expect(corner.geo.name).toBe('conn:3way')
    expect(rotatedArms([[1, 0, 0], [0, 1, 0], [0, 0, 1]], corner.quat)).toEqual([[0, -1, 0], [-1, 0, 0], [0, 0, -1]].sort())
    const vertical = second._connMeshFor(arms([[0, 1, 0], [0, -1, 0]]), identity, 'straight')
    expect(rotatedArms([[1, 0, 0], [-1, 0, 0]], vertical.quat)).toEqual([[0, 1, 0], [0, -1, 0]].sort())
  })
  it('同一零件的实例碎片与普通碎片平移相同，不改变另一个零件', () => {
    const scene = Object.create(SceneManager.prototype)
    scene.buildGroup = new THREE.Group()
    const geo = new THREE.BoxGeometry(2, 2, 2)
    const material = new THREE.MeshStandardMaterial({ color: '#ff0000' })
    const instances = new THREE.InstancedMesh(geo, material, 2)
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 2, 3))
    instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(9, 8, 7))
    instances.userData.instances = [{ kind: 'tube', id: 'moving' }, { kind: 'tube', id: 'fixed' }]
    const ordinary = new THREE.Mesh(geo, material)
    ordinary.position.set(4, 5, 6)
    ordinary.userData = { kind: 'tube', id: 'moving' }
    scene.buildGroup.add(instances, ordinary)
    scene._applyAssemblyTransforms(new Map([['moving', [10, 20, 30]]]))
    const matrix = new THREE.Matrix4()
    instances.getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([11, 22, 33])
    instances.getMatrixAt(1, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([9, 8, 7])
    expect(ordinary.position.toArray()).toEqual([14, 25, 36])
    geo.dispose(); material.dispose(); instances.dispose()
  })

  it('已装材质降低饱和度，当前零件共享的原材质保持原色', () => {
    const scene = Object.create(SceneManager.prototype)
    scene._materials = {}
    const base = new THREE.MeshStandardMaterial({ color: '#ff0000' })
    const before = base.color.getHex()
    const done = scene._assemblyDoneMaterial(base)
    expect(base.color.getHex()).toBe(before)
    expect(done).not.toBe(base)
    const source = { h: 0, s: 0, l: 0 }, reduced = { h: 0, s: 0, l: 0 }
    base.color.getHSL(source); done.color.getHSL(reduced)
    expect(reduced.s).toBeCloseTo(source.s * 0.18)
    expect(scene._assemblyDoneMaterial(base)).toBe(done)
    base.dispose(); done.dispose()
  })

  it('新增件轮廓跟随展示位置，已装件没有轮廓且不进入零件索引', () => {
    const scene = Object.create(SceneManager.prototype)
    scene.buildGroup = new THREE.Group()
    scene._materials = {}
    scene._fitGeos = new Map()
    scene._keepGeos = new Set()
    const geometry = new THREE.BoxGeometry(2, 2, 2)
    const material = new THREE.MeshStandardMaterial({ color: '#2B8FF0' })
    const instances = new THREE.InstancedMesh(geometry, material, 2)
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 20, 30))
    instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, 0))
    instances.userData.instances = [{ kind: 'tube', id: 'current' }, { kind: 'tube', id: 'done' }]
    scene.buildGroup.add(instances)
    scene._outlineAssemblyParts(new Set(['current']))
    const lines = scene.buildGroup.children.filter((part: any) => part.isLineSegments)
    expect(lines.length).toBe(1)
    expect(lines[0].position.toArray()).toEqual([10, 20, 30])
    expect(scene._indexParts(scene.buildGroup.children).size).toBe(2)
    expect(material.color.getHexString()).toBe('2b8ff0')
    geometry.dispose(); material.dispose(); instances.dispose()
    lines[0].geometry.dispose(); lines[0].material.dispose()
  })
})
