import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadCatalog, geometry } from './catalog.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { confirmedFrame, worldToLocal, localToWorld } from './confirmedComponentModel.js'
import { componentObstacle } from './accessoryPack.js'
import { hasInsetScrews, INSET_PANEL_EDGE_INSET } from './insetPanelMounts.js'
import { PANEL_OUTER_FACE, panelLipProfiles } from './panelScrewMounts.js'
import { SceneManager } from './scene.js'

beforeAll(loadCatalog)
const plates = CONFIRMED_COMPONENTS.filter(spec => spec.placement === 'panel' && !['grid', 'basin', 'sensory'].includes(spec.feature))

// 真实安装及几何检查；三档画质的完整框架画面另由浏览器验收。
it.each(plates.flatMap(spec => ['vertical', 'horizontal'].map(axis => [spec.id, axis])))('%s %s按实际安装类型呈现板身与固定件', (id, axis) => {
  const { model } = createConfirmedComponentFixture(id, { install: false })
  const candidate = model.panelAccessoryMounts(id, { screwAxis: axis, oppositeRetainers: true }).find(part => part.valid)!
  const part = model.addPanelAccessory(candidate, 'blue')!
  const spec = CONFIRMED_COMPONENTS.find(spec => spec.id === id)!, frame = confirmedFrame(model, part)!
  const meshes = confirmedComponentMeshes({ _materials: {}, _cachedGeo: (_key: string, make: () => THREE.BufferGeometry) => make() }, model, part)
  const body = meshes.find(mesh => mesh.name.startsWith('plate:'))!
  expect(body).toBeTruthy()
  body.geometry.computeBoundingBox()
  const bounds = body.geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3())
  const inset = hasInsetScrews(part), edge = inset ? INSET_PANEL_EDGE_INSET : 0
  expect(size.x).toBeCloseTo(spec.width - 2 * edge, inset ? 0 : 4)
  expect(size.y).toBeCloseTo(spec.height - 2 * edge, inset ? 0 : 4)
  const offset = worldToLocal(frame, body.position.toArray())[2]
  expect(bounds.min.z + offset).toBeCloseTo(inset ? -geometry().panelThickness / 2 : PANEL_OUTER_FACE - geometry().panelThickness)
  expect(bounds.max.z + offset).toBeCloseTo(inset ? geometry().panelThickness / 2 : PANEL_OUTER_FACE)
  const clips = meshes.filter(mesh => mesh.name.startsWith('inset-screw-jaw-'))
  const lips = meshes.filter(mesh => mesh.name.startsWith('panel-back-lip:'))
  if (inset) {
    expect(clips).toHaveLength(8); expect(lips).toHaveLength(0)
    expect(part.mounts.every((mount: { role: string }) => mount.role === 'inset-screw')).toBe(true)
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), local = new THREE.Mesh(body.geometry, material)
    for (const x of [bounds.min.x + .3, bounds.max.x - .3]) for (const y of [bounds.min.y + .3, bounds.max.y - .3]) {
      expect(new THREE.Raycaster(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1)).intersectObject(local).length).toBeGreaterThan(0)
    }
    material.dispose()
  } else if (spec.feature !== 'basketball') {
    expect(clips).toHaveLength(0); expect(lips).toHaveLength(2)
    for (const profile of panelLipProfiles(part)) expect(profile.sections.at(-1)!.outer[1]).toBeCloseTo(PANEL_OUTER_FACE - geometry().panelThickness + .01)
  }
  for (const mesh of meshes) {
    mesh.geometry.dispose()
    for (const value of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) value.dispose()
  }
})

it.each(['low', 'medium', 'high'])('旧版外扣板 %s画质的外宽与普通板一致', quality => {
  const scene = Object.assign(Object.create(SceneManager.prototype) as SceneManager, {
    _panelGeos: new Map(), _keepGeos: new Set(), _quality: quality,
  })
  const reference = scene._panelGeometry('panel_40x40', 40, 40, .3)
  for (const id of ['panel_40x40_clock', 'panel_40x40_lego', 'panel_40x40_magnet', 'panel_40x40_felt']) {
    expect(scene._panelGeometry(id, 40, 40, .3)).toBe(reference)
  }
  for (const geometry of scene._keepGeos) geometry.dispose()
})

it('外扣板扩展到普通板外宽后，边缘障碍仍会阻止安装，框架延伸管不会误报', () => {
  const { model, part } = createConfirmedComponentFixture('panel_40x40_clock')
  expect(componentObstacle(model, part)).toBeNull()
  const frame = confirmedFrame(model, part)!
  const a = model.addNode(...localToWorld(frame, [19.7, -5, 2.4]) as [number, number, number])
  const b = model.addNode(...localToWorld(frame, [19.7, 5, 2.4]) as [number, number, number])
  const obstacle = model.addTube(a.id, b.id, 'T5', 'red', 5)!
  expect(componentObstacle(model, part)).toEqual({ kind: 'tube', id: obstacle.id })
})
