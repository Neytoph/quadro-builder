import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离场景投影检查手势与历史；真实射线命中另在浏览器验收。
// JS 引擎会附加手势字段，夹具用 any 调用真实原型方法。
function fixture(axis = [1, 0, 0], screenAxis = [100, 0]) {
  const model = new BuildModel()
  const point = (s: number, off = 0) => axis.map((v, i) => v * s + (i === 1 ? 80 : 0) + (i === 2 ? off : 0))
  const a = model.addNode(...point(0)), b = model.addNode(...point(80))
  const base = model.addTube(a.id, b.id, 'T75', 'red', 75)!
  const n0 = model.addNode(...point(0, 5)), n1 = model.addNode(...point(40, 5))
  const tube = model.addTube(n0.id, n1.id, 'T35', 'blue', 35)!
  const clamp = model.addClamp(...point(20))
  clamp.dir = axis; clamp.off = [0, 0, 5]
  model.addLink(a.id, n0.id)
  const builder: any = Object.create(Builder.prototype)
  const scene = { setCursor: vi.fn(), endOrbit: vi.fn(), endPan: vi.fn(), pointOnPlane: () => null,
    projectWorld: () => [{ u: 0, v: 0 }, { u: screenAxis[0] / 1000, v: screenAxis[1] / 1000 }],
    renderer: { domElement: { getBoundingClientRect: () => ({ width: 1000, height: 1000 }) } } }
  Object.assign(builder, { model, scene, selection: new Map([[tube.id, 'tube']]), stepFrom: [], mode: 'select',
    refresh: vi.fn(), onNotice: vi.fn(), onHistoryChange: vi.fn(), onChange: vi.fn(),
    _snapRadius: () => 1, _down: { x: 200, y: 200 } })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, builder, clamp, base, tube, n0, n1 }
}

describe('双管连接旋转与沿轴平移', () => {
  it('连续拖动保留小数位移，不分档、不吸附，并按原抓取点往返', () => {
    const { model, builder, clamp, tube } = fixture()
    builder._snapRadius = () => 30
    const before = model.toJSON()
    builder.setClampAdjustmentMode('slide'); builder._beginClampDrag(clamp.id)
    for (const cm of [1.37, 1.58, 0.41, -1.26]) {
      builder._updateClampDrag({ clientX: 200 + cm * 10, clientY: 200 })
      expect(model.nodes.get(tube.a)!.x).toBeCloseTo(cm, 2)
      expect(model.clamps.get(clamp.id)).toEqual(before.clamps[0])
    }
    builder._endClampDrag({})
    const after = model.toJSON()
    builder.history.undo(); expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo(); expect(model.toJSON()).toEqual(after)
  })

  it.each([
    [[1, 0, 0], [100, 0], [300, 200]],
    [[0, 1, 0], [0, -100], [200, 100]],
    [[Math.SQRT1_2, Math.SQRT1_2, 0], [60, -80], [260, 120]],
  ])('不同轴和视角从抓取点平移，固定管与夹子不动', (axis, screenAxis, end) => {
    const { model, builder, clamp, base, tube } = fixture(axis, screenAxis)
    const old = model.toJSON()
    expect(builder.setClampAdjustmentMode('slide')).toBe(true)
    expect(builder._beginClampDrag(clamp.id)).toBe(true)
    expect(builder._clampDrag.motion).toBe('slide')
    builder._updateClampDrag({ clientX: end[0], clientY: end[1] })
    const n = model.nodes.get(tube.a)!
    const first = old.nodes.find(n => n.id === tube.a)!
    ;[n.x, n.y, n.z].forEach((v, i) => expect(v).toBeCloseTo([first.x, first.y, first.z][i] + axis[i] * 10, 1))
    expect(model.clamps.get(clamp.id)).toEqual(old.clamps[0])
    for (const id of [base.a, base.b]) expect(model.toJSON().nodes.find(n => n.id === id)).toEqual(old.nodes.find(n => n.id === id))
    builder._endClampDrag({})
    const after = model.toJSON()
    builder.history.undo(); expect(model.toJSON()).toEqual(old)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo(); expect(model.toJSON()).toEqual(after)
  })

  it('平移微调、切回旋转与再次平移均保留当前姿态', () => {
    const { model, builder, clamp, tube } = fixture()
    expect(builder.clampAdjustment().mode).toBe('rotate')
    expect(builder.slideSelectedClampBy(5)).toBe(true)
    const before = model.nodes.get(tube.a)!.x
    expect(builder.setClampAdjustmentMode('rotate')).toBe(true)
    // 旋转切线需要有位置变化的投影；平移夹具的固定两点只用于标定沿轴距离。
    builder.scene.projectWorld = (points: number[][]) => points.map(([x, y]) => ({ u: x / 100, v: y / 100 }))
    builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 200, clientY: 230, shiftKey: true })
    builder._endClampDrag({})
    expect(model.nodes.get(tube.a)!.x).toBe(before)
    expect(model.clamps.get(clamp.id)!.off).not.toEqual([0, 0, 5])
    expect(builder.setClampAdjustmentMode('slide')).toBe(true)
    const off = model.clamps.get(clamp.id)!.off!.slice()
    expect(builder.slideSelectedClampBy(5)).toBe(true)
    expect(model.clamps.get(clamp.id)!.off).toEqual(off)
    expect(model.nodes.get(tube.a)!.x).toBe(before + 5)
  })

  it('取消平移恢复模型，不产生撤销条目', () => {
    const { model, builder, clamp } = fixture()
    const before = model.toJSON()
    builder.setClampAdjustmentMode('slide'); builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 300, clientY: 200 })
    builder._abortGesture()
    expect(model.toJSON()).toEqual(before)
    expect(builder.busy()).toBe(false)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('单击或垂直转轴的拖动不位移、不旋转、不写历史', () => {
    const { model, builder, clamp } = fixture()
    const before = model.toJSON()
    builder.setClampAdjustmentMode('slide'); builder._beginClampDrag(clamp.id)
    builder._endClampDrag({})
    expect(model.toJSON()).toEqual(before)
    builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 200, clientY: 300 })
    builder._endClampDrag({})
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('只读、框选、无关选择和正对管端时不误启平移', () => {
    const { builder, clamp, base } = fixture()
    builder.readOnly = true
    expect(builder.clampAdjustment()).toBeNull()
    expect(builder.slideSelectedClampBy(5)).toBe(false)
    expect(builder._beginClampDrag(clamp.id)).toBe(false)
    builder.readOnly = false; builder.boxSelect = true
    expect(builder.clampAdjustment()).toBeNull()
    builder.boxSelect = false; builder.selection.set(base.id, 'tube')
    expect(builder.clampAdjustment()).toBeNull()
    const end = fixture([1, 0, 0], [0, 0])
    end.builder.setClampAdjustmentMode('slide')
    expect(end.builder._beginClampDrag(end.clamp.id)).toBe(false)
    expect(end.builder.slideSelectedClampBy(5)).toBe(true)
  })

  it('管中配件随平移，回接固定侧时拒绝拉伸', () => {
    const { model, clamp, tube, base } = fixture()
    const fitting = model.addFitting('steering_wheel', 20, 80, 5)
    Object.assign(fitting, { tube: tube.id })
    expect(model.slideClampFlap(clamp.id, 10)).toBe(true)
    expect(fitting.x).toBe(30)
    model.addTube(tube.b, base.b, 'T35', 'yellow', 35)
    const before = model.toJSON()
    expect(model.slideClampFlap(clamp.id, 5)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('滑动范围限制在夹子仍夹住第二根管的位置', () => {
    const { model, clamp, tube } = fixture()
    expect(model.slideClampFlap(clamp.id, 100)).toBe(true)
    expect(model.nodes.get(tube.a)!.x).toBeLessThanOrEqual(clamp.x)
    const before = model.toJSON()
    expect(model.slideClampFlap(clamp.id, 100)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('5cm按钮不被端点吸附扩大位移', () => {
    const { model, builder, clamp, tube } = fixture()
    builder._snapRadius = () => 8
    model.slideClampFlap(clamp.id, 10)
    expect(builder.slideSelectedClampBy(-5)).toBe(true)
    expect(model.nodes.get(tube.a)!.x).toBe(5)
  })

  it('缩远视角拖动仍跟随方向，不被大吸附范围拉回端点', () => {
    const { model, builder, clamp, tube } = fixture()
    builder._snapRadius = () => 30
    builder.slideSelectedClampBy(5)
    builder.setClampAdjustmentMode('slide'); builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 300, clientY: 200 })
    expect(model.nodes.get(tube.a)!.x).toBe(15)
    builder._endClampDrag({})
  })

  it('权限变成只读时恢复正在预览的平移', () => {
    const { model, builder, clamp } = fixture()
    const before = model.toJSON()
    builder.setClampAdjustmentMode('slide'); builder._beginClampDrag(clamp.id)
    builder._updateClampDrag({ clientX: 300, clientY: 200 })
    builder.setReadOnly(true)
    expect(model.toJSON()).toEqual(before)
    expect(builder.busy()).toBe(false)
    expect(builder.slideSelectedClampBy(5)).toBe(false)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('固定侧与活动侧共同承载的板件不能被平移拉开', () => {
    const { model, clamp, tube, base } = fixture()
    model.addPanel(base.id, tube.id, 0, 40, 'P40', 'red')
    const before = model.toJSON()
    expect(model.slideClampFlap(clamp.id, 5)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })
})
