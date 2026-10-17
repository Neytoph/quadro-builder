import { beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { loadCatalog, geometry } from './catalog.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { SceneManager } from './scene.js'

beforeAll(loadCatalog)

const flat = CONFIRMED_COMPONENTS.filter(part =>
  (part.placement === 'panel' && !['basin', 'sensory'].includes(part.feature)) || part.feature === 'sector')

// 读取真实组件夹具及几何；WebGL画面另由浏览器检查。
it.each(flat.map(part => part.id))('%s 板身统一为3毫米，倒角不会增加厚度', id => {
  const { model, part } = createConfirmedComponentFixture(id)
  const cache = new Map<string, THREE.BufferGeometry>()
  const scene = { _materials: {}, _cachedGeo: (key: string, make: () => THREE.BufferGeometry) => {
    if (!cache.has(key)) cache.set(key, make())
    return cache.get(key)!
  } }
  const meshes = confirmedComponentMeshes(scene, model, part).filter((mesh: THREE.Mesh) =>
    mesh.name.startsWith('plate:') || mesh.name === 'sector-panel' || mesh.name.startsWith('grid-'))
  expect(meshes.length).toBeGreaterThan(0)
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox()
    const bounds = mesh.geometry.boundingBox!
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.3, 5)
  }
})

it('原生板身厚度一致，九洞正反面贯通，安装唇边独立保留', () => {
  const records = JSON.parse(readFileSync('public/data/models/surfaces.json', 'utf8'))
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith('panel2_') && key !== 'hole_panel_40x40') continue
    const record = value as { pos: number[]; idx: number[] }
    const body = record.pos.filter((z, i) => i % 3 === 2 && z > 0)
    expect((Math.max(...body) - Math.min(...body)) / 100).toBeCloseTo(0.3)
    expect(Math.max(...body) / 100).toBe(2.51)
    expect(Math.min(...record.pos.filter((_, i) => i % 3 === 2)) / 100).toBe(-2.2)
    if (key !== 'hole_panel_40x40') continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(record.pos.map(v => v / 100), 3))
    geo.setIndex(record.idx)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    for (const sign of [-1, 1]) for (const x of [-12, 0, 12]) for (const y of [-12, 0, 12]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, sign * 10), new THREE.Vector3(0, 0, -sign))
      expect(ray.intersectObject(mesh)).toHaveLength(0)
    }
    geo.dispose()
    mesh.material.dispose()
  }
})

it('旧版板件与透明窗片采用相同板身厚度', () => {
  const scene = Object.create(SceneManager.prototype)
  Object.assign(scene, { _panelGeos: new Map(), _keepGeos: new Set(), _quality: 'high' })
  for (const geo of [scene._panelGeometry('hole_panel_40x40', 40, 40, geometry().panelThickness),
    scene._acrylicPaneGeometry(40, 40, geometry().panelThickness)]) {
    geo.computeBoundingBox()
    expect(geo.boundingBox.max.y - geo.boundingBox.min.y).toBeCloseTo(0.3, 5)
  }
})
