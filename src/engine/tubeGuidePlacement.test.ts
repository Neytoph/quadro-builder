import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog } from './catalog.js'
import { mergeTubeGuideSegments } from './tubeGuides.js'

beforeAll(async () => { await loadCatalog() })

// 隔离几何夹具使用真实模型和场景句柄；WebGL 点击另行验收。
function fixture() {
  const model = new BuildModel(), scene = Object.create(SceneManager.prototype)
  Object.assign(scene, { handleGroup: new THREE.Group(), handleMeshes: [], scene: new THREE.Scene(),
    _materials: {}, _geos: new Map(), _tubeGeos: new Map(), _keepGeos: new Set(), _look: () => '#ffcc00' })
  const builder = Object.create(Builder.prototype)
  Object.assign(builder, { model, scene, mode: 'add', tubeId: 'T35', color: 'blue', selection: new Map(),
    stepFrom: [], colorFor: () => 'blue' })
  const add = (p: number[]) => model.addNode(...p)
  const join = (a: { id: string }, b: { id: string }) => model.addTube(a.id, b.id, 'T35', 'blue', 35)!
  return { model, scene, builder, add, join }
}

describe('可安装引导线与端点闭环', () => {
  it('路径被横管挡住时不显示方向，计算候选不修改模型', () => {
    const { model, builder, scene, add, join } = fixture()
    const start = add([0, 40, 0])
    join(add([20, 40, -20]), add([20, 40, 20]))
    const before = model.toJSON()
    builder._buildHandles()
    expect(scene.handleGroup.children.some((g: THREE.Object3D) => g.userData.nodeId === start.id && g.userData.dirName === '+X')).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(model.extend(start.id, [1, 0, 0], 'T35', 'blue', 35, 40)).toEqual({ collision: true })
  })

  it.each([false, true])('目标插口已占用／被限制时不显示方向，限制=%s', restricted => {
    const { model, builder, scene, add, join } = fixture()
    const start = add([0, 40, 0]), end = add([40, 40, 0])
    if (restricted) end.preferType = 'straight', end.quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
    else join(end, add([30, 40, 0]))
    builder._buildHandles()
    expect(scene.handleGroup.children.some((g: THREE.Object3D) => g.userData.nodeId === start.id && g.userData.dirName === '+X')).toBe(false)
    expect(model.extend(start.id, [1, 0, 0], 'T35', 'blue', 35, 40)).toEqual({ collision: true })
  })

  it.each([0, Math.PI / 6])('双管斜面相接处有小偏差时，预览及实际安装共用端点，转角=%s', angle => {
    const { model, builder, scene, add, join } = fixture()
    const rotate = (p: number[]) => new THREE.Vector3(...p).applyAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray()
    const start = add(rotate([40, 50, 40])), left = add(rotate([0, 50, 40]))
    const topLeft = add(rotate([0, 55, 0])), end = add(rotate([40, 55, 0]))
    join(start, left); join(left, topLeft); join(topLeft, end)
    const baseLeft = add(rotate([0, 50, 0])), baseRight = add(rotate([40, 50, 0]))
    join(baseLeft, baseRight)
    model.addLink(baseLeft.id, topLeft.id); model.addLink(baseRight.id, end.id)
    if (angle) start.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray()
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray()
    const count = model.nodes.size, before = model.toJSON()
    const plan = model.planTubeExtension(start.id, dir, 40)!
    expect(plan.existing?.id).toBe(end.id)
    builder._buildHandles()
    const handle = scene.handleGroup.children.find((g: THREE.Object3D) => g.userData.nodeId === start.id && g.userData.dirName === '-Z')!
    expect(handle.userData.previewTarget).toEqual([end.x, end.y, end.z])
    scene._setTubePreview(handle)
    expect(scene._tubePreview.position.toArray()).toEqual([start.x, start.y, start.z].map((v, i) => (v + [end.x, end.y, end.z][i]) / 2))
    expect(model.toJSON()).toEqual(before)
    const result = model.extend(start.id, dir, 'T35', 'green', 35, 40)!
    expect(result.node.id).toBe(end.id)
    expect(model.nodes.size).toBe(count)
    expect(model.incidentTubeIds(end.id)).toContain(result.tube!.id)
    const reopened = new BuildModel(); reopened.loadJSON(model.toJSON())
    expect(reopened.tubeBetween(start.id, end.id)?.id).toBe(result.tube!.id)
  })

  it('附近独立平行管架不使用双管闭环的大范围吸附', () => {
    const { model, add, join } = fixture()
    const start = add([40, 50, 40]), unrelated = add([40, 55, 0])
    join(unrelated, add([0, 55, 0]))
    const result = model.extend(start.id, [0, 0, -1], 'T35', 'blue', 35, 40)!
    expect(result.node.id).not.toBe(unrelated.id)
    expect([result.node.x, result.node.y, result.node.z]).toEqual([40, 50, 0])
  })

  it('准确落在旧存档的闲置节点时可接管，预览不提前激活节点', () => {
    const { model, add } = fixture()
    const start = add([0, 40, 0]), end = add([40, 40, 0])
    end.unused = true
    expect(model.planTubeExtension(start.id, [1, 0, 0], 40)?.existing?.id).toBe(end.id)
    expect(end.unused).toBe(true)
    expect(model.extend(start.id, [1, 0, 0], 'T35', 'blue', 35, 40)?.node.id).toBe(end.id)
    expect(end.unused).toBeUndefined()
  })

  it('相同第二根管的多个空夹子只提供一个安装候选，横穿障碍时不提供', () => {
    const { model, builder, scene, add, join } = fixture()
    join(add([0, 40, 0]), add([40, 40, 0]))
    for (const x of [10, 30]) {
      const clamp = model.addClamp(x, 40, 0)
      clamp.dir = [1, 0, 0]; clamp.off = [0, 5, 0]
    }
    builder._buildHandles()
    expect(scene.handleGroup.children.filter((g: THREE.Object3D) => g.userData.clampOpening)).toHaveLength(1)
    join(add([20, 45, -20]), add([20, 45, 20]))
    builder._buildHandles()
    expect(scene.handleGroup.children.filter((g: THREE.Object3D) => g.userData.clampOpening)).toHaveLength(0)
  })

  it('轴承连接器的空孔仍提供合法的平行接管位置', () => {
    const { model, builder, scene, add } = fixture()
    const node = add([0, 40, 0])
    expect(model.addBearingAtArm(node.id, [1, 0, 0])).toBeTruthy()
    builder._buildHandles()
    expect(scene.handleGroup.children.some((g: THREE.Object3D) => g.userData.bearingNode === node.id)).toBe(true)
  })
})

describe('引导线几何合并', () => {
  it('合并后的可见线共用高亮，保留两端拾取并能正常清除', () => {
    const { scene } = fixture()
    scene.addHandle([0, 40, 0], { dir: [1, 0, 0], arrowCompact: true })
    scene.addHandle([40, 40, 0], { dir: [-1, 0, 0], arrowCompact: true })
    scene.mergeTubeGuides()
    const a = scene._guideAt.get('0,400,0').userData.arms[0][1]
    const b = scene._guideAt.get('400,400,0').userData.arms[0][1]
    expect(a).toBe(b)
    scene._lightNodeGuide([0, 40, 0], true)
    expect(b.material).toBe(scene._guideMaterial('x', true))
    expect(scene.handleMeshes).toHaveLength(4)
    scene.clearHandles()
    expect(scene.handleGroup.children).toHaveLength(0)
    expect(scene._guideAt.size).toBe(0)
  })
  it('同线重叠、反向和相接合并，保留分离及平行插口', () => {
    const lines = mergeTubeGuideSegments([
      { start: [0, 0, 0], end: [21, 0, 0] },
      { start: [40, 0, 0], end: [19, 0, 0] },
      { start: [40, 0, 0], end: [50, 0, 0] },
      { start: [60, 0, 0], end: [70, 0, 0] },
      { start: [0, 5, 0], end: [21, 5, 0] },
    ])
    expect(lines.map(line => [line.start, line.end])).toEqual([
      [[0, 0, 0], [50, 0, 0]], [[60, 0, 0], [70, 0, 0]], [[0, 5, 0], [21, 5, 0]],
    ])
  })
})
