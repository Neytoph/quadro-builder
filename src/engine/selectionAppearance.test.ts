import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SceneManager } from './scene.js'
import { hingeKey } from './model.js'
import { PanelPlacementGuides } from './panelPlacementGuides.js'

// 使用真实Three.js几何检查描边与资源释放；完整材质和鼠标操作另行浏览器验收。
function sceneFixture() {
  return Object.assign(Object.create(SceneManager.prototype) as SceneManager, {
    _materials: {}, buildGroup: new THREE.Group(), _hoverPartGroup: new THREE.Group(), _clipList: [],
  })
}

describe('选中配件保留真实外观的轮廓', () => {
  it('整件橙色的框选配件不再叠加选中和悬停轮廓，普通点选继续描边', () => {
    const scene = sceneFixture(), geo = new THREE.BoxGeometry(8, 8, 8), material = new THREE.MeshStandardMaterial()
    const mesh = new THREE.InstancedMesh(geo, material, 2)
    mesh.userData.instances = [{ id: 'boxed', kind: 'node' }, { id: 'clicked', kind: 'node' }]
    mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0))
    scene.buildGroup.add(mesh)
    Object.assign(scene, { _solidSelectedParts: new Map([['boxed', 'node']]), _hoverMat: new THREE.Matrix4(),
      _hoverPartMode: 'select', _hoverPartKind: 'node', _hoverPartHinge: null })
    scene._outlineSelectedParts(new Map([['boxed', 'node'], ['clicked', 'node']]))
    const outlines = scene.buildGroup.children.filter(o => o.userData.partOutline) as THREE.Mesh[]
    expect(outlines.map(o => o.userData.partOutlineFor)).toEqual(['clicked'])
    scene._rebuildHoverOverlay('boxed'); expect(scene._hoverPartGroup.children).toHaveLength(0)
    scene._rebuildHoverOverlay('clicked'); expect(scene._hoverPartGroup.children).toHaveLength(1)
    scene._clearHoverGeometry()
    scene._solidSelectedParts = null
    scene._rebuildHoverOverlay('boxed'); expect(scene._hoverPartGroup.children).toHaveLength(1)
    scene._clearHoverGeometry()
    for (const line of outlines) line.geometry.dispose()
    mesh.dispose(); geo.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })

  it('框选节点的铰链附属片也不描边，删除悬停仍然显示删除反馈', () => {
    const scene = sceneFixture(), geo = new THREE.BoxGeometry(8, 4, 2), material = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(geo, material)
    mesh.userData = { id: 'joint', kind: 'node', hinge: 1 }; scene.buildGroup.add(mesh)
    Object.assign(scene, { _solidSelectedParts: new Map([['joint', 'node']]), _hoverMat: new THREE.Matrix4(),
      _hoverPartMode: 'select', _hoverPartKind: 'node', _hoverPartHinge: 1 })
    scene._outlineSelectedParts(new Map([[hingeKey('joint', 1), 'hinge']]))
    expect(scene.buildGroup.children.filter(o => o.userData.partOutline)).toHaveLength(0)
    scene._rebuildHoverOverlay('joint'); expect(scene._hoverPartGroup.children).toHaveLength(0)
    scene._hoverPartMode = 'delete'
    scene._rebuildHoverOverlay('joint'); expect(scene._hoverPartGroup.children).toHaveLength(1)
    scene._clearHoverGeometry(); geo.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })

  it('框选的玻璃和纹理配件整件着橙色，清除选择后原始材质完整保留', () => {
    const scene = sceneFixture(), texture = new THREE.Texture()
    const original = new THREE.MeshPhysicalMaterial({ color: '#22c55e', map: texture, vertexColors: true, transmission: .9, transparent: true, opacity: .25, side: THREE.DoubleSide })
    const selected = scene._boxSelectedMaterial(original) as THREE.MeshPhysicalMaterial
    expect(selected.color.getHexString()).toBe('ea580c')
    expect(selected.transmission).toBe(0); expect(selected.opacity).toBe(1)
    expect(selected.transparent).toBe(false); expect(selected.map).toBeNull(); expect(selected.vertexColors).toBe(false)
    expect(selected.side).toBe(THREE.DoubleSide); expect(selected.depthWrite).toBe(true)
    expect(original.color.getHexString()).toBe('22c55e'); expect(original.transmission).toBe(.9)
    expect(original.map).toBe(texture); expect(original.opacity).toBe(.25); expect(original.vertexColors).toBe(true)
    expect(scene._boxSelectedMaterial(original)).toBe(selected)
    selected.dispose(); original.dispose(); texture.dispose()
  })
  it('半球只生成边缘线，原始几何保持完整', () => {
    const scene = sceneFixture(), original = new THREE.SphereGeometry(16, 56, 36, 0, Math.PI * 2, 0, Math.PI / 2)
    const before = original.getAttribute('position').array.slice()
    const line = scene._partOutline(original, true)!
    expect(line.isLineSegments2).toBe(true)
    expect(line.geometry.getAttribute('instanceStart').count).toBeGreaterThan(0)
    expect(line.material.linewidth).toBeLessThan(2)
    expect(line.material.depthWrite).toBe(false)
    expect(original.getAttribute('position').array).toEqual(before)
    line.geometry.dispose(); line.material.dispose(); original.dispose()
  })

  it('实例零件只描选中的实例，矩阵对应真实摆放', () => {
    const scene = sceneFixture(), geo = new THREE.BoxGeometry(20, 30, .3), material = new THREE.MeshPhysicalMaterial({ transmission: .9 })
    const mesh = new THREE.InstancedMesh(geo, material, 2)
    mesh.userData.instances = [{ id: 'left', kind: 'panel' }, { id: 'right', kind: 'panel' }]
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 20, 0)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(40, 20, 0))
    scene.buildGroup.add(mesh)
    scene._outlineSelectedParts(new Map([['right', 'panel']]))
    const lines = scene.buildGroup.children.filter(o => o.userData.partOutline)
    expect(lines).toHaveLength(1)
    expect(lines[0].userData.partOutlineFor).toBe('right')
    expect(lines[0].position.toArray()).toEqual([40, 20, 0])
    expect(material.transmission).toBe(.9)
    expect(mesh.material).toBe(material)
    const line = lines[0] as THREE.Mesh
    line.geometry.dispose(); geo.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })

  it('圆滑网格条没有锐边时仍提供可见轮廓', () => {
    const scene = sceneFixture(), geo = new THREE.CapsuleGeometry(.25, 34, 8, 16)
    const line = scene._partOutline(geo, true)!
    expect(line).not.toBeNull()
    expect(line.geometry.getAttribute('instanceStart').count).toBeGreaterThan(0)
    line.geometry.dispose(); line.material.dispose(); geo.dispose()
  })

  it('移出悬停只释放临时轮廓几何，原零件和共享材质继续可用', () => {
    const scene = sceneFixture(), original = new THREE.BoxGeometry(10, 10, 1), line = scene._partOutline(original, false)!
    let outlineDisposed = 0, originalDisposed = 0, materialDisposed = 0
    line.geometry.addEventListener('dispose', () => outlineDisposed++)
    original.addEventListener('dispose', () => originalDisposed++)
    line.material.addEventListener('dispose', () => materialDisposed++)
    scene._hoverPartGroup.add(line, new THREE.Mesh(original, line.material))
    scene._clearHoverGeometry()
    expect(scene._hoverPartGroup.children).toHaveLength(0)
    expect(outlineDisposed).toBe(1); expect(originalDisposed).toBe(0); expect(materialDisposed).toBe(0)
    original.dispose(); line.material.dispose()
  })

  it('铰链单选和悬停只标记对应片，不连同螺栓及另一片一起标记', () => {
    const scene = sceneFixture(), geo = new THREE.BoxGeometry(8, 4, 2), material = new THREE.MeshStandardMaterial()
    Object.assign(scene, { _hoverMat: new THREE.Matrix4(), _hoverPartMode: 'select', _hoverPartKind: 'node', _hoverPartHinge: 1 })
    const mesh = new THREE.InstancedMesh(geo, material, 3)
    mesh.userData.instances = [{ id: 'joint', kind: 'node' }, { id: 'joint', kind: 'node', hinge: 0 }, { id: 'joint', kind: 'node', hinge: 1 }]
    for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 20, 0))
    scene.buildGroup.add(mesh)
    const key = hingeKey('joint', 1)
    scene._outlineSelectedParts(new Map([[key, 'hinge']]))
    const selected = scene.buildGroup.children.filter(o => o.userData.partOutline)
    expect(selected).toHaveLength(1); expect(selected[0].userData.partOutlineFor).toBe(key)
    expect(selected[0].position.x).toBe(20)
    scene._rebuildHoverOverlay('joint')
    expect(scene._hoverPartGroup.children).toHaveLength(1)
    expect(scene._hoverPartGroup.children[0].matrix.elements[12]).toBe(20)
    scene._clearHoverGeometry()
    for (const line of selected as THREE.Mesh[]) line.geometry.dispose()
    mesh.dispose(); geo.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })

  it('铝管与支撑管共用记录身份时，只标记当前选择的种类', () => {
    const scene = sceneFixture(), geo = new THREE.BoxGeometry(5, 35, 5), material = new THREE.MeshStandardMaterial()
    const mesh = new THREE.InstancedMesh(geo, material, 2)
    mesh.userData.instances = [{ id: 'tube1', kind: 'tube' }, { id: 'tube1', kind: 'tube', tubes: ['tube1'] }]
    mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(7, 0, 0))
    scene.buildGroup.add(mesh)
    scene._outlineSelectedParts(new Map([['tube1', 'tube']]), new Set(['tube1']))
    const lines = scene.buildGroup.children.filter(o => o.userData.partOutline) as THREE.Mesh[]
    expect(lines).toHaveLength(1); expect(lines[0].position.x).toBe(7)
    lines[0].geometry.dispose(); mesh.dispose(); geo.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })

  it('安装引导和选中轮廓服从同一切面，并能解除切面', () => {
    const scene = sceneFixture(), guides = new PanelPlacementGuides(new THREE.Scene())
    scene._panelPlacementGuides = guides
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -20)
    scene._clipPlane = plane; scene._applyClip()
    expect(guides.lines.material.clippingPlanes).toEqual([plane])
    expect(guides.group.children).toHaveLength(1)
    scene._clipPlane = null; scene._applyClip()
    expect(guides.lines.material.clippingPlanes).toEqual([])
    guides.dispose()
  })

  it('细节密集的配件只描主体，选中与悬停保留小凸点原貌', () => {
    const scene = sceneFixture(), body = new THREE.BoxGeometry(40, 40, .5), stud = new THREE.CylinderGeometry(.7, .7, .3, 16)
    const material = new THREE.MeshStandardMaterial({ color: '#22c55e' })
    Object.assign(scene, { _hoverMat: new THREE.Matrix4(), _hoverPartMode: 'select', _hoverPartKind: 'panel', _hoverPartHinge: null })
    const board = new THREE.Mesh(body, material), dots = new THREE.InstancedMesh(stud, material, 4)
    board.userData = { id: 'board', kind: 'panel' }
    dots.userData.instances = Array.from({ length: 4 }, () => ({ id: 'board', kind: 'panel' }))
    for (let i = 0; i < 4; i++) dots.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 2, 0, 1))
    scene.buildGroup.add(board, dots)
    scene._outlineSelectedParts(new Map([['board', 'panel']]))
    const selected = scene.buildGroup.children.filter(o => o.userData.partOutline) as THREE.Mesh[]
    expect(selected).toHaveLength(1)
    scene._rebuildHoverOverlay('board')
    expect(scene._hoverPartGroup.children).toHaveLength(1)
    expect(dots.material).toBe(material); expect(board.material).toBe(material)
    scene._clearHoverGeometry(); selected[0].geometry.dispose(); dots.dispose(); body.dispose(); stud.dispose(); material.dispose()
    for (const value of Object.values(scene._materials) as THREE.Material[]) value.dispose()
  })
})
