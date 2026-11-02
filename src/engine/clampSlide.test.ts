import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })
afterEach(() => { vi.useRealTimers() })

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
    _snapRadius: () => 1, _pickSelect: () => ({ data: { id: tube.id, kind: 'tube' } }), _down: { x: 200, y: 200 } })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, builder, clamp, base, tube, n0, n1 }
}

describe('双管连接旋转与沿轴平移', () => {
  it('重叠管在延迟单击时可穿透点选，悬停与拖动起点仍命中前面的第二根管', () => {
    const { builder, tube, base } = fixture()
    const front = { data: { id: tube.id, kind: 'tube' }, distance: 100 }
    const back = { data: { id: base.id, kind: 'tube' }, distance: 105 }
    builder.scene.pickClamp = () => null
    builder.scene.pickAllForDelete = () => [front, back]
    builder._pickSelect = Builder.prototype._pickSelect
    builder._selectClick = { x: 200, y: 200, t: performance.now() - 1000, id: tube.id }
    expect(builder._pickSelect(200, 200)).toBe(back)
    expect(builder._pickSelect(200, 200, false)).toBe(front)
  })

  it('点击第二根管只选中本管，保留关节调整且不产生历史', () => {
    const { model, builder, clamp, tube } = fixture()
    builder.selection.clear()
    const before = model.toJSON()
    builder._clickSelect({ clientX: 200, clientY: 200 })
    expect([...builder.selection]).toEqual([[tube.id, 'tube']])
    expect(builder.clampAdjustment()).toEqual({ id: clamp.id, mode: 'rotate' })
    expect(builder.selectionTransformState()).toBeNull()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('Shift 点第二根管只增减本管，不带选连接器或活动侧其他管', () => {
    const { builder, tube, base } = fixture()
    builder.selection = new Map([[base.id, 'tube']])
    builder._clickSelect({ clientX: 200, clientY: 200, shiftKey: true })
    expect([...builder.selection]).toEqual([[base.id, 'tube'], [tube.id, 'tube']])
    builder._selectClick = null
    builder._clickSelect({ clientX: 200, clientY: 200, shiftKey: true })
    expect([...builder.selection]).toEqual([[base.id, 'tube']])
  })

  it('明确选连接器活动组时，通用面板及直接变换接口均不接管关节', () => {
    const { model, builder, clamp, base, tube } = fixture()
    builder._selectClampCohort(clamp.id, false)
    const before = model.toJSON()
    expect(builder.selection.has(clamp.id)).toBe(true)
    expect(builder.selection.has(tube.id)).toBe(true)
    expect(builder.selectionTransformState()).toBeNull()
    expect(builder.beginSelectionTransform()).toBe(false)
    expect(builder.setSelectionPosition([20, 100, 5])).toBe(false)
    expect(builder.rotateSelectionAxis('Y', 30)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.selection.set(base.id, 'tube')
    expect(builder.clampAdjustment()).toBeNull()
    expect(builder.selectionTransformState()).not.toBeNull()
  })

  it('只选第二根管后沿管平移与绕管旋转保持固定管，支持撤销重做', () => {
    const { model, builder, tube, base } = fixture()
    builder._rotationDirections = new Map()
    builder.selection.clear()
    builder._clickSelect({ clientX: 200, clientY: 200 })
    const before = model.toJSON()
    expect(builder.slideSelectedClampBy(5)).toBe(true)
    expect(builder.rotateSelectionBy()).toBe(true)
    const after = model.toJSON()
    expect(model.nodes.get(tube.a)!.x).toBe(5)
    for (const id of [base.a, base.b]) expect(after.nodes.find(n => n.id === id)).toEqual(before.nodes.find(n => n.id === id))
    expect(model.clamps.get(builder.clampAdjustment().id)!.off).not.toEqual([0, 0, 5])
    expect([...builder.selection]).toEqual([[tube.id, 'tube']])
    builder.history.undo(); builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo(); builder.history.redo()
    expect(model.toJSON()).toEqual(after)
  })

  function slopedPanel() {
    const f = fixture()
    const a = f.model.addNode(0, 80, 45), b = f.model.addNode(40, 80, 45)
    const foot = f.model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    f.model.addTube(f.tube.a, a.id, 'T35', 'blue', 35)
    f.model.addTube(f.tube.b, b.id, 'T35', 'blue', 35)
    const panel = f.model.addPanel(f.tube.id, foot.id, 0, 40, 'panel_40x40', 'green')!
    expect(f.model.rotateClamp(f.clamp.id, Math.PI / 6)).toBe(true)
    f.builder.selection = new Map([[panel.id, 'panel']])
    f.builder._pickSelect = () => ({ data: { id: panel.id, kind: 'panel' } })
    f.builder.setHistory(new ModelHistory(docFromJSON(f.model.toJSON())))
    return { ...f, panel }
  }

  it.each(['rotate', 'slide'])('%s 模式下斜坡面板原地点击翻面，支架保持，真实历史可撤销重做', mode => {
    vi.useFakeTimers()
    const { model, builder, clamp, panel } = slopedPanel()
    // 旋转手势需要随位置变化的投影。
    builder.scene.projectWorld = (points: number[][]) => points.map(([x, y]) => ({ u: x / 100, v: y / 100 }))
    builder.setClampAdjustmentMode(mode)
    const before = model.toJSON()
    const side = panel.side
    expect(builder._beginClampDrag(clamp.id)).toBe(true)
    builder._onUp({ clientX: 200, clientY: 200, button: 0 })
    expect(model.toJSON()).toEqual(before)
    vi.advanceTimersByTime(1000)
    expect(model.panels.get(panel.id)!.side).toBe(-side)
    const after = model.toJSON()
    expect(after.nodes).toEqual(before.nodes)
    expect(after.tubes).toEqual(before.tubes)
    expect(after.clamps).toEqual(before.clamps)
    builder.history.undo(); expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo(); expect(model.toJSON()).toEqual(after)
    builder.history.destroy()
  })

  it('沿管平移模式下快速双击斜坡面板只选整块，取消待翻面', () => {
    vi.useFakeTimers()
    const { model, builder, clamp } = slopedPanel()
    builder.setClampAdjustmentMode('slide')
    const before = model.toJSON()
    builder._selectConnectedFromPick = vi.fn()
    for (let i = 0; i < 2; i++) {
      builder._down = { x: 200, y: 200 }
      builder._beginClampDrag(clamp.id)
      builder._onUp({ clientX: 200, clientY: 200, button: 0 })
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(1000)
    expect(builder._selectConnectedFromPick).toHaveBeenCalledOnce()
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
    builder.history.destroy()
  })

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
