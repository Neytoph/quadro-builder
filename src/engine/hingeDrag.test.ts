import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel, BOLT_PART, hingeDir, hingeGap, hingeKey, holeArmDirs } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { loadCatalog, panels } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

function joint() {
  const model = new BuildModel()
  const a = model.addNode(0, 60, 0), b = model.addNode(40, 60, 0)
  model.addTube(a.id, b.id, 'T35', 'red', 35)
  const node = model.addFlexiJoint(b.id)!
  return { model, node }
}

// 隔离画布刷新，使用真实相机投影、旋转平面射线、模型和Yjs撤销记录。
function editor(index = 0, side = false) {
  const { model, node } = joint()
  const scene = Object.create(SceneManager.prototype)
  scene.renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } }
  scene.camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000)
  scene.camera.position.set(side ? 40 : 100, 60, side ? 60 : 0)
  scene.camera.lookAt(node.x, node.y, node.z)
  scene.camera.updateMatrixWorld()
  scene._mouse = new THREE.Vector2(); scene._raycaster = new THREE.Raycaster()
  scene.endOrbit = () => {}; scene.setCursor = () => {}; scene.markModelReplaced = () => {}
  const builder = Object.create(Builder.prototype)
  builder.model = model; builder.scene = scene; builder.mode = 'select'
  builder.selection = new Map([[hingeKey(node.id, index), 'hinge']])
  builder.stepFrom = []; builder.refresh = () => {}
  builder.onNotice = () => {}; builder.onHistoryChange = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  const pointer = (angle: number, radius = 8) => {
    const direction = hingeDir(node, angle)
    const [clientX, clientY] = scene.screenPoint([node.x + direction[0] * radius, node.y + direction[1] * radius, node.z + direction[2] * radius])
    return { clientX, clientY, button: 0, buttons: 1 }
  }
  return { builder, model, node, pointer }
}

describe('柔性铰链连续拖动', () => {
  for (const index of [0, 1]) {
    it(`第${index + 1}片可停在非45°角度，另一片与载管不改变；一拖一条撤销`, () => {
      const { builder, model, node, pointer } = editor(index)
      const before = JSON.stringify(model.toJSON()), angle = node.hinges[index]
      const other = node.hinges[1 - index], tubes = model.toJSON().tubes
      expect(builder._beginHingeDrag(node.id, index, pointer(angle))).toBe(true)
      for (const delta of [5, 10, 17.25]) builder._updateHingeDrag(pointer(angle + delta))
      expect(model.nodes.get(node.id)!.hinges[index]).toBeCloseTo(angle + 17.25, 2)
      expect(model.nodes.get(node.id)!.hinges[1 - index]).toBe(other)
      expect(model.toJSON().tubes).toEqual(tubes)
      expect(builder.busy()).toBe(true)
      expect(builder.history.canUndo()).toBe(false)
      const after = JSON.stringify(model.toJSON())
      builder._endHingeDrag(pointer(angle + 17.25))
      expect(builder.busy()).toBe(false)
      builder.history.undo()
      expect(JSON.stringify(model.toJSON())).toBe(before)
      expect(builder.history.canUndo()).toBe(false)
      builder.history.redo()
      expect(JSON.stringify(model.toJSON())).toBe(after)
    })
  }

  it('连续角度保存重开及QDF往返保持方向，不回到45°档位', () => {
    const { model, node } = joint()
    expect(model.rotateHingeBy(node.id, 0, 17.25)).toBe(true)
    const reopened = new BuildModel(); reopened.loadJSON(model.toJSON())
    expect(reopened.nodes.get(node.id)!.hinges).toEqual(node.hinges)
    const imported = new BuildModel(); imported.loadJSON(parseQDF(buildQDF(model).text))
    const saved = [...imported.nodes.values()].find(n => n.part === BOLT_PART)!
    const directions = node.hinges.map((a: number) => hingeDir(node, a))
    for (const direction of directions) {
      const nearest = Math.max(...saved.hinges.map((a: number) => hingeDir(saved, a).reduce((sum, v, i) => sum + v * direction[i], 0)))
      expect(nearest).toBeGreaterThan(0.9998)
    }
    expect(saved.hinges.some((a: number) => Math.abs(a / 45 - Math.round(a / 45)) > 0.1)).toBe(true)
  })

  it('到达两片间距边界停住，反向拖动立即离开边界', () => {
    const { builder, node, pointer } = editor()
    builder._beginHingeDrag(node.id, 0, pointer(90))
    builder._updateHingeDrag(pointer(150))
    expect(builder.model.nodes.get(node.id).hinges[0]).toBe(135)
    expect(hingeGap(...builder.model.nodes.get(node.id).hinges)).toBe(90)
    builder._updateHingeDrag(pointer(140))
    expect(builder.model.nodes.get(node.id).hinges[0]).toBeCloseTo(125, 2)
    builder._cancelHingeDrag()
  })

  it('只有一片铰链可跨越0°连续转动', () => {
    const { builder, node, pointer } = editor()
    node.hinges = [350]
    builder._beginHingeDrag(node.id, 0, pointer(350))
    builder._updateHingeDrag(pointer(365))
    expect(builder.model.nodes.get(node.id).hinges[0]).toBeCloseTo(5, 2)
    builder._cancelHingeDrag()
  })

  it('侧面视角采用屏幕切线，仍可连续调整', () => {
    const { builder, node, pointer } = editor(0, true)
    const start = pointer(90)
    expect(builder._beginHingeDrag(node.id, 0, start)).toBe(true)
    const tangent = builder._hingeDrag.tangent
    expect(tangent).not.toBeNull()
    builder._updateHingeDrag({ ...start, clientX: start.clientX + tangent[0] * 0.3, clientY: start.clientY + tangent[1] * 0.3 })
    expect(builder.model.nodes.get(node.id).hinges[0]).toBeCloseTo(90 + 0.3 * 180 / Math.PI, 2)
    builder._cancelHingeDrag()
  })

  it('取消及中途只读恢复拖动前状态；没有额外历史记录', () => {
    const { builder, model, node, pointer } = editor()
    const before = JSON.stringify(model.toJSON())
    builder._beginHingeDrag(node.id, 0, pointer(90)); builder._updateHingeDrag(pointer(108))
    expect(builder.clearMarks()).toBe(true)
    expect(JSON.stringify(model.toJSON())).toBe(before)
    builder._beginHingeDrag(node.id, 0, pointer(90)); builder._updateHingeDrag(pointer(108))
    builder.setMode('select')
    expect(JSON.stringify(model.toJSON())).toBe(before)
    builder._beginHingeDrag(node.id, 0, pointer(90)); builder._updateHingeDrag(pointer(108))
    builder.setReadOnly(true)
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(builder.history.canUndo()).toBe(false)
    expect(builder._beginHingeDrag(node.id, 0, pointer(90))).toBe(false)
  })

  it('已接管铰链可以拖动，接管跟随且另一片仍能调整', () => {
    const { builder, model, node, pointer } = editor()
    model.extend(node.id, hingeDir(node, node.hinges[0]), 'T35', 'blue', 35, 40)
    const before = JSON.stringify(model.toJSON())
    expect(builder._beginHingeDrag(node.id, 0, pointer(90))).toBe(true)
    builder._updateHingeDrag(pointer(107))
    expect(model.nodes.get(node.id)!.hinges[0]).toBeCloseTo(107, 2)
    expect(model.nodes.get(node.id)!.hinges[1]).toBe(225)
    expect(JSON.stringify(model.toJSON())).not.toBe(before)
    builder._cancelHingeDrag()
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(model.rotateHingeBy(node.id, 1, 17.25)).toBe(true)
  })

  it('小于拖动阈值不改变角度，单击入口只执行一次', () => {
    const { builder, node, pointer } = editor()
    const start = pointer(90)
    builder._beginHingeDrag(node.id, 0, start)
    builder._updateHingeDrag({ ...start, clientX: start.clientX + 2 })
    expect(node.hinges[0]).toBe(90)
    builder._pickSelect = () => ({ data: { kind: 'node', id: node.id, hinge: 0 } })
    builder._isBlockClick = () => false
    builder._endHingeDrag(start)
    builder._runSelectFlip()
    expect(node.hinges[0]).toBe(135)
    expect(builder.history.canUndo()).toBe(true)
  })

  it('换模型后结束旧手势，不恢复旧模型或在新模型上触发点击', () => {
    const { builder, model, node, pointer } = editor()
    builder._down = pointer(90)
    builder._beginHingeDrag(node.id, 0, pointer(90)); builder._updateHingeDrag(pointer(108))
    model.clear(); model.addNode(100, 80, 0)
    const replacement = JSON.stringify(model.toJSON())
    builder.modelReplaced()
    expect(builder._down).toBeNull()
    expect(builder.busy()).toBe(false)
    builder._onUp(pointer(108))
    expect(JSON.stringify(model.toJSON())).toBe(replacement)
  })
})

describe('已接管铰链的分支跟转', () => {
  it('末端孔式接头及其接管通过真实承载关系跟随，不留在原安装点', () => {
    const { model, node } = joint()
    const arm = model.extend(node.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)!
    const hole = model.addHoleClamp(arm.node!.id, [1, 0, 0], 'hole_1', 5)!
    expect(hole).toBeTruthy()
    const pipe = model.extend(hole.id, holeArmDirs(hole)[0], 'T15', 'green', 15, 20)!
    const before = model.nodePos(hole.id), farBefore = model.nodePos(pipe.node!.id)
    expect(model.rotateHingeBy(node.id, 0, 17.25)).toBe(true)
    expect(model.nodePos(hole.id)).not.toEqual(before)
    expect(model.nodePos(pipe.node!.id)).not.toEqual(farBefore)
    expect(Math.hypot(...model.nodePos(hole.id).map((v, i) => v - model.nodePos(arm.node!.id)[i]))).toBeCloseTo(5, 2)
  })
  for (const index of [0, 1]) {
    it(`第${index + 1}片带动自己的接管与后续管，另一支及承载管保持；连续预览不累加误差`, () => {
      const { builder, model, node, pointer } = editor(index)
      const arm = model.extend(node.id, hingeDir(node, node.hinges[index]), 'T35', 'blue', 35, 40)!
      const next = model.extend(arm.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
      const other = model.extend(node.id, hingeDir(node, node.hinges[1 - index]), 'T35', 'green', 35, 40)!
      builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
      const before = JSON.stringify(model.toJSON()), angle = node.hinges[index]
      const fixedOther = model.toJSON().nodes.find(n => n.id === other.node!.id), fixedBase = model.toJSON().nodes.find(n => n.id === 'n1')
      const aLength = Math.hypot(arm.node!.x - node.x, arm.node!.y - node.y, arm.node!.z - node.z)
      const nextLength = Math.hypot(next.node!.x - arm.node!.x, next.node!.y - arm.node!.y, next.node!.z - arm.node!.z)
      builder._beginHingeDrag(node.id, index, pointer(angle))
      for (let i = 1; i <= 40; i++) builder._updateHingeDrag(pointer(angle + 17.25 * i / 40))
      const root = model.nodes.get(node.id)!, end = model.nodes.get(arm.node!.id)!, continuation = model.nodes.get(next.node!.id)!
      expect(root.hinges[index]).toBeCloseTo(angle + 17.25, 2)
      const expected = hingeDir(root, root.hinges[index])
      expect(Math.hypot(...[end.x - root.x - expected[0] * aLength, end.y - root.y - expected[1] * aLength, end.z - root.z - expected[2] * aLength])).toBeLessThan(0.02)
      expect(Math.hypot(continuation.x - end.x, continuation.y - end.y, continuation.z - end.z)).toBeCloseTo(nextLength, 2)
      expect(model.toJSON().nodes.find(n => n.id === other.node!.id)).toEqual(fixedOther)
      expect(model.toJSON().nodes.find(n => n.id === 'n1')).toEqual(fixedBase)
      expect(model.tubes.size).toBe(4)
      expect(builder.history.canUndo()).toBe(false)
      builder._endHingeDrag(pointer(angle + 17.25))
      const after = JSON.stringify(model.toJSON())
      builder.history.undo(); expect(JSON.stringify(model.toJSON())).toBe(before)
      expect(builder.history.canUndo()).toBe(false)
      builder.history.redo(); expect(JSON.stringify(model.toJSON())).toBe(after)
    })
  }

  it('连接回承载结构的闭环禁止单片转动，完整保持模型', () => {
    const { model, node } = joint()
    const arm = model.extend(node.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)!
    model.addLink(arm.node!.id, 'n1')
    const before = JSON.stringify(model.toJSON())
    expect(model.rotateHingeBy(node.id, 0, 17.25)).toBe(false)
    expect(model.hingeRotationFailure).toBe('connected')
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })

  it('两片通过板件连接时不拆开固定边，拒绝只转一片', () => {
    const { model, node } = joint()
    node.hinges = [90, 270]
    const a = model.extend(node.id, hingeDir(node, 90), 'T15', 'blue', 15, 20)!
    const b = model.extend(node.id, hingeDir(node, 270), 'T15', 'green', 15, 20)!
    const aa = model.extend(a.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    const bb = model.extend(b.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    const ar = model.extend(aa.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    const br = model.extend(bb.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    const ra = ar.tube!, rb = br.tube!
    model.addTube(aa.node!.id, bb.node!.id, 'T35', 'blue', 35)
    model.addTube(ar.node!.id, br.node!.id, 'T35', 'blue', 35)
    expect(model.addPanel(ra.id, rb.id, 0, 40, 'panel_40x40', 'blue')).toBeTruthy()
    const before = JSON.stringify(model.toJSON())
    expect(model.rotateHingeBy(node.id, 0, 17.25)).toBe(false)
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })

  it('分支碰到地面或已有管子时整次回退', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 20, 0), root = model.addNode(40, 20, 0)
    model.addTube(a.id, root.id, 'T35', 'red', 35); model.addFlexiJoint(root.id)
    model.extend(root.id, hingeDir(root, 90), 'T35', 'blue', 35, 40)
    let before = JSON.stringify(model.toJSON())
    expect(model.rotateHingeBy(root.id, 0, -75)).toBe(false)
    expect(model.hingeRotationFailure).toBe('ground')
    expect(JSON.stringify(model.toJSON())).toBe(before)
    const d = hingeDir(root, 120), x = root.x + d[0] * 20, y = root.y + d[1] * 20, z = root.z + d[2] * 20
    const p = model.addNode(x - 10, y, z), q = model.addNode(x + 10, y, z)
    model.addTube(p.id, q.id, 'T15', 'green', 15)
    before = JSON.stringify(model.toJSON())
    expect(model.rotateHingeBy(root.id, 0, 30)).toBe(false)
    expect(model.hingeRotationFailure).toBe('collision')
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })

  it('末端弯管及其圆心保持刚性，管上配件跟随，固定配件不动', () => {
    const { model, node } = joint()
    const arm = model.extend(node.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)!
    const bowId = model.extendBow(arm.node!.id, hingeDir(node, 90), [0, 1, 0], 'TC1', 'blue', 40)!.tube!.id
    const bow = model.tubes.get(bowId)!
    const mount = model.tubeFittingMount(arm.tube!.id, [node.x, node.y, -20], 'multi-wheel2')!
    const wheel = model.addFittingAt('multi-wheel2', mount, 'blue')!
    const fixed = model.addFittingAt('multi-wheel2', model.tubeFittingMount('t3', [20, 60, 0], 'multi-wheel2')!, 'green')!
    const fixedBefore = { ...fixed }
    const radius = Math.hypot(...bow.bowCenter!.map((v: number, i: number) => v - [arm.node!.x, arm.node!.y, arm.node!.z][i]))
    const wheelBefore = [wheel.x, wheel.y, wheel.z]
    expect(model.rotateHingeBy(node.id, 0, 17.25)).toBe(true)
    const end = model.nodes.get(bow.a)!
    expect(Math.hypot(...bow.bowCenter!.map((v: number, i: number) => v - [end.x, end.y, end.z][i]))).toBeCloseTo(radius, 1)
    expect([wheel.x, wheel.y, wheel.z]).not.toEqual(wheelBefore)
    expect(model.fittings.get(fixed.id)).toEqual(fixedBefore)
    const reopened = new BuildModel(); reopened.loadJSON(model.toJSON())
    expect(JSON.stringify(reopened.toJSON())).toBe(JSON.stringify(model.toJSON()))
    const imported = new BuildModel(); imported.loadJSON(parseQDF(buildQDF(model).text))
    const bolt = [...imported.nodes.values()].find(n => n.part === BOLT_PART)!
    const tube = [...imported.tubes.values()].find(t => {
      const end = t.a === bolt.id ? imported.nodes.get(t.b) : t.b === bolt.id ? imported.nodes.get(t.a) : null
      if (!end) return false
      const dir = [end.x - bolt.x, end.y - bolt.y, end.z - bolt.z], length = Math.hypot(...dir)
      return bolt.hinges.some((g: number) => hingeDir(bolt, g).reduce((sum, v, i) => sum + v * dir[i] / length, 0) > 0.999)
    })!
    const far = imported.nodes.get(tube.a === bolt.id ? tube.b : tube.a)!
    const actual = [far.x - bolt.x, far.y - bolt.y, far.z - bolt.z], length = Math.hypot(...actual)
    expect(bolt.hinges.some((g: number) => hingeDir(bolt, g).reduce((sum, v, i) => sum + v * actual[i] / length, 0) > 0.999)).toBe(true)
  })

  it('完整分支上的导入面板保留自身姿态，跟随承载管刚性旋转', () => {
    const { model, node } = joint()
    const arm = model.extend(node.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)!
    const first = model.extend(arm.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    const lower = model.extend(arm.node!.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)!
    const last = model.extend(lower.node!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    model.addTube(first.node!.id, last.node!.id, 'T35', 'blue', 35)
    expect(model.addPanel(first.tube!.id, last.tube!.id, 0, 40, 'panel_40x40', 'blue')).toBeTruthy()
    const imported = new BuildModel(); imported.loadJSON(parseQDF(buildQDF(model).text, { panels: panels() }))
    const bolt = [...imported.nodes.values()].find(n => n.part === BOLT_PART)!
    const panel = [...imported.panels.values()][0]
    const before = imported.panelCorners(panel)!, rotation = [...panel.geom!.quat]
    expect(imported.rotateHingeBy(bolt.id, 0, 17.25)).toBe(true)
    const after = imported.panelCorners(imported.panels.get(panel.id))!
    expect(after).not.toEqual(before)
    expect(imported.panels.get(panel.id)!.geom!.quat).not.toEqual(rotation)
    for (let i = 1; i < 4; i++) {
      expect(Math.hypot(...after[i].map((v: number, j: number) => v - after[0][j]))).toBeCloseTo(Math.hypot(...before[i].map((v: number, j: number) => v - before[0][j])), 1)
    }
  })

  it('拖动触地时保留上一处有效的整个分支，反向移动立即响应', () => {
    const { builder, model, node, pointer } = editor()
    model.extend(node.id, hingeDir(node, 90), 'T75', 'blue', 75, 80)
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    builder._beginHingeDrag(node.id, 0, pointer(90))
    builder._updateHingeDrag(pointer(45))
    expect(model.nodes.get(node.id)!.hinges[0]).toBeCloseTo(45, 2)
    const lastValid = JSON.stringify(model.toJSON())
    builder._updateHingeDrag(pointer(20))
    expect(JSON.stringify(model.toJSON())).toBe(lastValid)
    builder._updateHingeDrag(pointer(40))
    expect(model.nodes.get(node.id)!.hinges[0]).toBeCloseTo(65, 2)
    builder._cancelHingeDrag()
    expect(builder.history.canUndo()).toBe(false)
  })

  it('已接管时点击轴心附近仍可微调，不因旋转平面交点过近突然跳到边界', () => {
    const { builder, model, node, pointer } = editor()
    model.extend(node.id, hingeDir(node, 90), 'T35', 'blue', 35, 40)
    const start = pointer(90, 1)
    builder._beginHingeDrag(node.id, 0, start)
    const tangent = builder._hingeDrag.tangent
    expect(tangent).not.toBeNull()
    builder._updateHingeDrag({ ...start, clientX: start.clientX + tangent[0] * 0.3, clientY: start.clientY + tangent[1] * 0.3 })
    expect(model.nodes.get(node.id)!.hinges[0]).toBeCloseTo(90 + 0.3 * 180 / Math.PI, 2)
    builder._cancelHingeDrag()
  })
})
