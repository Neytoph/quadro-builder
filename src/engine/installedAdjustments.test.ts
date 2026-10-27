import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BuildModel, ROTATABLE_FITTINGS, holeArmDirs } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { CONN_TYPE_MASK } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import * as THREE from 'three'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async () => { await loadCatalog() })
afterEach(() => { vi.useRealTimers() })
const click = { clientX: 0, clientY: 0 }
const json = (model: BuildModel) => JSON.stringify(model.toJSON())

// 使用真实安装、模型和历史；隔离射线命中，浏览器另验实际拾取。
function editor(source: BuildModel, id: string, kind: string) {
  const model = new BuildModel()
  model.loadJSON(source.toJSON())
  const builder = Object.create(Builder.prototype)
  const pick = { data: { id, kind } }
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[id, kind]])
  builder.stepFrom = []
  builder.scene = { pickHandle: () => null, pickForDelete: () => pick, pickBuild: () => pick }
  builder._pickSelect = () => pick
  builder._isBlockClick = () => false
  builder.refresh = () => {}
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

function carrier() {
  const model = new BuildModel()
  const node = model.addNode(0, 60, 0)
  const tube = model.extend(node.id, [1, 0, 0], 'T35', 'red', 35, 40)!.tube!
  node.preferType = '6way'
  return { model, node, tube }
}

function selectedClick(builder: Builder) {
  builder._clickSelectRaw(click)
  builder._runSelectFlip()
}

function parity(model: BuildModel, id: string, kind: string, action: string,
  installed: (builder: Builder) => void, changes = true) {
  const selection = editor(model, id, kind), placement = editor(model, id, kind)
  expect(selection.selectedPartAdjustment()).toBe(action)
  const before = json(selection.model)
  selectedClick(selection)
  placement.mode = 'fitting'
  installed(placement)
  expect(json(selection.model)).toBe(json(placement.model))
  if (!changes) {
    expect(json(selection.model)).toBe(before)
    expect(selection.history.canUndo()).toBe(false)
    return
  }
  expect(json(selection.model)).not.toBe(before)
  const after = json(selection.model)
  expect(selection.selection.get(id)).toBe(kind)
  selection.history.undo()
  expect(json(selection.model)).toBe(before)
  expect(selection.history.canUndo()).toBe(false)
  selection.history.redo()
  expect(json(selection.model)).toBe(after)
}

describe('已安装组件在选择模式与安装工具中的调整一致', () => {
  it('多用轮在管上点击翻面，位置不变且可撤销重做和保存', () => {
    const { model, tube } = carrier()
    const mount = model.tubeFittingMount(tube.id, [20, 60, 0], 'multi-wheel2')!
    const wheel = model.addFittingAt('multi-wheel2', mount, 'blue')!
    const builder = editor(model, wheel.id, 'fitting')
    const before = json(builder.model)
    const original = builder.model.fittings.get(wheel.id)!
    const position = [original.x, original.y, original.z]
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...original.quat!))
    selectedClick(builder)
    const flipped = builder.model.fittings.get(wheel.id)!
    const flippedAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...flipped.quat!))
    expect(flippedAxis.dot(axis)).toBeCloseTo(-1)
    expect([flipped.x, flipped.y, flipped.z]).toEqual(position)
    const after = json(builder.model)
    const restored = new BuildModel(); restored.loadJSON(JSON.parse(after))
    expect(json(restored)).toBe(after)
    const imported = parseQDF(buildQDF(builder.model).text).fittings.find(f => f.kind === 'multi-wheel2')!
    const importedAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...imported.quat!))
    expect(importedAxis.dot(flippedAxis)).toBeCloseTo(1)
    expect([imported.x, imported.y, imported.z]).toEqual(position)
    builder.history.undo(); expect(json(builder.model)).toBe(before)
    builder.history.redo(); expect(json(builder.model)).toBe(after)
    const placement = editor(model, wheel.id, 'fitting')
    placement.mode = 'fitting'; placement.fittingKind = 'multi-wheel2'
    placement._clickTubeFitting(click)
    expect(json(placement.model)).toBe(after)
  })

  it('轴承上的多用轮翻面不移动轴承，并可再次翻回', () => {
    const { model } = carrier()
    const bearing = model.addFittingAt('bearing2', model.fittingMounts('bearing2')[0], 'blue')!
    const wheel = model.addFittingAt('multi-wheel2', model.fittingMounts('multi-wheel2')[0], 'blue')!
    const builder = editor(model, wheel.id, 'fitting')
    const beforeBearing = JSON.stringify(builder.model.fittings.get(bearing.id))
    const axis = (q: number[]) => new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...q))
    const before = axis(builder.model.fittings.get(wheel.id)!.quat!)
    selectedClick(builder)
    expect(axis(builder.model.fittings.get(wheel.id)!.quat!).dot(before)).toBeCloseTo(-1)
    expect(JSON.stringify(builder.model.fittings.get(bearing.id))).toBe(beforeBearing)
    selectedClick(builder)
    expect(axis(builder.model.fittings.get(wheel.id)!.quat!).dot(before)).toBeCloseTo(1)
  })
  for (const type of Object.keys(CONN_TYPE_MASK)) {
    it(`${type} 普通接头换向，管子保持连接`, () => {
      const { model, node } = carrier()
      node.preferType = type
      parity(model, node.id, 'node', 'connector', builder => {
        builder.mode = 'add'; builder.placeConnectorId = type
        builder._clickAdd(click)
      }, !['straight', '6way'].includes(type))
    })
  }

  for (const part of ['hole_1', 'hole_2', 'hole_t']) {
    it(`${part} 孔式接头转动`, () => {
      const { model, node } = carrier()
      const hole = model.addHoleClamp(node.id, [0, 0, 1], part, 5)!
      parity(model, hole.id, 'node', 'hole', builder => {
        builder.fittingKind = part; builder._clickHoleClamp(click)
      })
    })
  }

  for (const kind of ROTATABLE_FITTINGS) {
    it(`${kind} 更换朝向，配套零件和历史一致`, () => {
      const { model } = carrier()
      const mount = model.fittingMounts(kind).find(m => m.dir[1] === 0)!
      const fitting = model.addFittingAt(kind, mount, 'blue')!
      parity(model, fitting.id, 'fitting', 'fitting', builder => {
        builder.fittingKind = kind; builder._clickFitting(click)
      })
    })
  }

  it('未接管轴承点击本体调整开口，隐藏锚点仍能保存和撤销', () => {
    const { model, node } = carrier()
    const fitting = model.addBearingAtArm(node.id, [0, 0, 1], 5)!
    parity(model, fitting.id, 'fitting', 'bearing', builder => {
      builder.fittingKind = 'bearing-clamp'; builder._clickTubeClamp(click)
    })
  })

  it('装在管上的管夹绕管调整', () => {
    const { model, tube } = carrier()
    const clamp = model.addTubeClamp(tube.id, [20, 60, 0], 'bearing', 5)!
    parity(model, clamp.id, 'node', 'tubeClamp', builder => {
      builder.fittingKind = 'bearing-clamp'; builder._clickTubeClamp(click)
    })
  })

  it('面板翻面及固定边旋转均支持撤销，旋转取消排队的翻面', () => {
    vi.useFakeTimers()
    const { model, tube } = carrier()
    const a = model.addNode(0, 60, 40), b = model.addNode(40, 60, 40)
    const other = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    model.addTube(tube.a, a.id, 'T35', 'red', 35)
    model.addTube(tube.b, b.id, 'T35', 'red', 35)
    const panel = model.addPanel(tube.id, other.id, 0, 40, 'P40', 'blue')!
    parity(model, panel.id, 'panel', 'panel', builder => {
      builder.mode = 'panel'; builder._clickPanel(click); vi.runAllTimers()
    })
    const selection = editor(model, panel.id, 'panel'), placement = editor(model, panel.id, 'panel')
    const before = json(selection.model)
    selection._queueSelectFlip(panel.id, click)
    expect(selection.turnSelectedPanel()).toBe(true)
    placement.recordHistory(() => placement.model.turnPanel(panel.id))
    vi.runAllTimers()
    expect(json(selection.model)).toBe(json(placement.model))
    expect(selection.model.panels.get(panel.id)!.side).toBe(panel.side)
    selection.history.undo()
    expect(json(selection.model)).toBe(before)
    expect(selection.history.canUndo()).toBe(false)
  })

  for (const kind of ['pool2', 'pool-small2']) {
    it(`${kind} 球池选中后可切换海洋球`, () => {
      const model = new BuildModel()
      const fitting = model.addFitting(kind, 0, 60, 0, { balls: false })
      parity(model, fitting.id, 'fitting', 'pool', builder => {
        builder.scene.pickHandle = () => ({ data: { poolBalls: fitting.id } })
        builder._clickBalls(click)
      })
    })
  }

  it('已接管孔式接头带动活动分支，只读及多选保留状态', () => {
    const { model, node } = carrier()
    const hole = model.addHoleClamp(node.id, [0, 0, 1], 'hole_1', 5)!
    const pipe = model.extend(hole.id, holeArmDirs(hole)[0], 'T35', 'green', 35, 40)!
    const selection = editor(model, hole.id, 'node')
    const original = json(selection.model)
    selectedClick(selection)
    expect(json(selection.model)).not.toBe(original)
    const end = selection.model.nodes.get(pipe.node!.id)!
    expect([end.x, end.y, end.z]).not.toEqual([pipe.node!.x, pipe.node!.y, pipe.node!.z])
    const before = json(selection.model)
    expect(selection.history.canUndo()).toBe(true)
    selection.readOnly = true
    expect(selection.selectedPartAdjustment()).toBeNull()
    expect(selection._adjustPlacedPart(hole.id, 'hole')).toBe(false)
    selection.readOnly = false
    selection.selection.set(node.id, 'node')
    expect(selection.selectedPartAdjustment()).toBeNull()
    selectedClick(selection)
    expect(json(selection.model)).toBe(before)
  })

  it('Shift 重复点选只取消选择，取消等待不会误调整', () => {
    const { model, node } = carrier()
    const hole = model.addHoleClamp(node.id, [0, 0, 1], 'hole_1', 5)!
    const selection = editor(model, hole.id, 'node')
    const before = json(selection.model)
    selection._clickSelectRaw({ ...click, shiftKey: true })
    expect(selection.selection.size).toBe(0)
    expect(json(selection.model)).toBe(before)
    selection.selection.set(hole.id, 'node')
    selection._clickSelectRaw(click)
    selection._cancelSelectFlip()
    selection._runSelectFlip()
    expect(json(selection.model)).toBe(before)
  })
})
