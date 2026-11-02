import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { componentFrame, componentMountsValid, componentObstacle } from './accessoryPack.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'
import { panelInstallationFacing } from './panelInstallationFacing.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { setLang, t } from './i18n.js'

beforeAll(async () => { await loadCatalog() })

// 隔离结构均由实际模型 API 建立；不表示实体安装或 WebGL 验收。
function beam(y = 80, span = 40) {
  const model = new BuildModel(), a = model.addNode(0, y, 0), b = model.addNode(span, y, 0)
  const tube = model.addTube(a.id, b.id, span === 40 ? 'T35' : 'T75', 'green', span - 5)!
  return { model, tube }
}
const selectAll = (model: BuildModel) => new Map([...model.nodes.keys()].map(id => [id, 'node']))
function controller(model: BuildModel, camera: number[]) {
  return Object.assign(Object.create(Builder.prototype), {
    model, scene: { cameraPosition: () => camera, clearInstallationPreview: () => {} },
    history: new ModelHistory(docFromJSON(model.toJSON())), selection: new Map(),
    color: 'green', mode: 'panel', refresh: () => {}, onNotice: () => {},
  }) as Builder
}

describe('原生轮与硬质配件安装顺序一致', () => {
  it('先装方向盘后拒绝轮，缓存的旧位置也重新检查且不改变模型', () => {
    const { model, tube } = beam()
    const staleMount = model.tubeFittingMount(tube.id, [20, 80, 0], 'multi-wheel2')!
    const steering = model.addAccessory('steering_wheel', tube.id, 'blue')!
    const before = model.toJSON()
    expect(model.tubeFittingMount(tube.id, [20, 80, 0], 'multi-wheel2')).toBeNull()
    expect(model.addFittingAt('multi-wheel2', staleMount, 'yellow')).toBeNull()
    expect(model.toJSON()).toEqual(before)
    expect(model.accessoryDiagnostics('steering_wheel', tube.id, { ignoreId: steering.id }).valid).toBe(true)
  })
  it('先装轮后拒绝方向盘，轮的原生字段和保存恢复保持', () => {
    const { model, tube } = beam()
    const wheel = model.addFittingAt('multi-wheel2', model.tubeFittingMount(tube.id, [20, 80, 0], 'multi-wheel2')!, 'yellow')!
    expect(model.addAccessory('steering_wheel', tube.id, 'blue')).toBeNull()
    expect(wheel).not.toHaveProperty('appearanceVersion')
    const saved = model.toJSON(), copy = new BuildModel()
    expect(copy.loadJSON(saved).ok).toBe(true)
    expect(copy.toJSON()).toEqual(saved)
  })
  it('同管分开安装仍合法，布网允许重叠但滚筒仍有空间约束', () => {
    const { model, tube } = beam(80, 80)
    const steering = model.addAccessory('steering_wheel', tube.id, 'blue')!
    const mount = model.tubeFittingMount(tube.id, [10, 80, 0], 'multi-wheel2')!
    expect(model.addFittingAt('multi-wheel2', mount, 'yellow')).toBeTruthy()
    expect(componentObstacle(model, steering)).toBeNull()
    const fixture = createConfirmedComponentFixture('lattice')
    const rail = fixture.model._rail(fixture.part!.tube)!
    expect(fixture.model.addFittingAt('multi-wheel2', fixture.model.tubeFittingMount(fixture.part!.tube, rail.p0.map((v: number, i: number) => v + rail.dir[i] * rail.len / 2), 'multi-wheel2')!, 'blue')).toBeTruthy()
    const roller = createConfirmedComponentFixture('sleeve')
    expect(roller.model.tubeFittingMount(roller.part!.tube, [20, 42.5, 0], 'multi-wheel2')).toBeNull()
  })
  it('旧存档30厘米板的实际板面同样阻止后装轮', () => {
    const fixture = createConfirmedComponentFixture('panel_30x30'), data = fixture.model.toJSON()
    // 隔离兼容记录删除新版组件字段，保留真实框架与板面引用。
    const panel = data.panels[0] as Record<string, unknown>
    for (const key of ['appearanceVersion', 'params', 'mounts', 'supportTubes']) delete panel[key]
    const model = new BuildModel(); model.loadJSON(data)
    const rail = model._rail(panel.a)!
    expect(model.tubeFittingMount(panel.a, rail.p0.map((v: number, i: number) => v + rail.dir[i] * rail.len / 2), 'multi-wheel2')).toBeNull()
  })
})

// JavaScript 引擎候选为动态记录，测试只读取实际 frame 和承载引用。
function obstructFace(model: BuildModel, candidate: any, sign = 1) {
  const frame = componentFrame(model, candidate)!
  const center = frame.pos.map((v: number, i: number) => v + frame.axes[2][i] * 5 * sign)
  const a = model.addNode(...center.map((v: number, i: number) => v - frame.axes[0][i] * 10) as [number, number, number])
  const b = model.addNode(...center.map((v: number, i: number) => v + frame.axes[0][i] * 10) as [number, number, number])
  model.addTube(a.id, b.id, 'T15', 'red', 15)
  return frame
}
describe('安装点包含有效反面', () => {
  it.each(['panel_40x40_climbing', 'panel_40x40_capsule', 'panel_40x40_busy'])('%s 默认面受阻仍显示反面位置，点击后可撤销重做', id => {
    const model = id === 'panel_40x40_busy' ? createDirectInstallationFrame(80, 40, { vertical: true }) : createConfirmedComponentFixture(id, { install: false }).model
    const probe = model.panelAccessoryMounts(id).find((p: any) => id !== 'panel_40x40_busy' || p.pos[0] < 40 && p.pos[1] > 60)!
    const frame = obstructFace(model, probe)
    expect(model.panelAccessoryDiagnostics(probe).valid).toBe(false)
    const candidate = model.panelAccessoryMounts(id).find((p: any) => Math.hypot(...p.pos.map((v: number, i: number) => v - frame.pos[i])) < .1)!
    expect(candidate?.valid).toBe(true)
    const camera = frame.pos.map((v: number, i: number) => v + frame.axes[2][i] * 100)
    expect(panelInstallationFacing(model, candidate, camera).conflict).toBeTruthy()
    const builder = controller(model, camera), before = model.toJSON()
    expect(builder._previewInstallation(candidate, id)).toBe(true)
    const part = [...model.panels.values()][0]!
    expect(componentMountsValid(model, part)).toBe(true)
    const saved = model.toJSON(), copy = new BuildModel()
    copy.loadJSON(saved); expect(copy.toJSON()).toEqual(saved)
    builder.history.undo(); expect(builder.history.toJSON()).toEqual(before)
    builder.history.redo(); expect(builder.history.toJSON()).toEqual(saved)
  })
  it('两面受阻仍没有有效安装点，四边完整且无障碍时只有一个框格位置', () => {
    const { model, candidate } = createConfirmedComponentFixture('panel_40x40_climbing', { install: false })
    expect(model.panelAccessoryMounts(candidate.panelId)).toHaveLength(1)
    obstructFace(model, candidate, 1); obstructFace(model, candidate, -1)
    expect(model.panelAccessoryMounts(candidate.panelId)).toHaveLength(0)
    expect(model.addConfirmedComponent(candidate, 'blue')).toBeNull()
  })
})

function longFrame(axis: 'x' | 'z') {
  const model = new BuildModel(), nodes = new Map<string, string>()
  const at = (along: number, across: number) => axis === 'x' ? [along, 80, across] : [across, 80, along]
  const node = (along: number, across: number) => {
    const key = `${along},${across}`
    if (!nodes.has(key)) nodes.set(key, model.addNode(...at(along, across) as [number, number, number]).id)
    return nodes.get(key)!
  }
  const a = model.addTube(node(0, 0), node(80, 0), 'T75', 'green', 75)!
  const b = model.addTube(node(0, 40), node(80, 40), 'T75', 'green', 75)!
  for (const x of [0, 40, 80]) model.addTube(node(x, 0), node(x, 40), 'T35', 'blue', 35)
  return { model, probe: { a: a.id, b: b.id, t0: 0, len: 40, panelId: 'panel_40x40', side: 1 } }
}
describe('偏置面板与布面的真实镜像', () => {
  it.each(['x', 'z'] as const)('%s 原生板、v2板与布面跟随镜像，保存和再次镜像一致', axis => {
    for (const type of ['native', 'confirmed', 'textile']) {
      const { model, probe } = longFrame(axis)
      const part = type === 'native' ? model.addNativePanel(probe, 'green') : type === 'confirmed' ? model.addConfirmedComponent(probe, 'green') : model.addTextile(probe.a, probe.b, probe.t0, probe.len, 'green')
      expect(part).toBeTruthy()
      const before = model.toJSON(), corners = model.panelCorners(part!)!, dimension = axis === 'x' ? 0 : 2
      const expected = corners.map((p: number[]) => p.map((v, i) => i === dimension ? 80 - v : v))
      expect(model.mirrorSelection(selectAll(model), axis).ok).toBe(true)
      const mirrored = model.panels.get(part!.id) || model.textiles.get(part!.id)!
      expect(model.panelCorners(mirrored)).toEqual(expected)
      if (type === 'confirmed') expect(componentMountsValid(model, mirrored)).toBe(true)
      const copy = new BuildModel(), saved = model.toJSON(); copy.loadJSON(saved)
      expect(copy.toJSON()).toEqual(saved)
      expect(model.mirrorSelection(selectAll(model), axis).ok).toBe(true)
      expect(model.toJSON()).toEqual(before)
    }
  })
})

describe('功能板不再伪报旋转成功', () => {
  it.each(['panel_40x40_clock', 'panel_40x40_maze', 'acrylic_panel_40x40', 'panel_40x40_capsule'])('%s 固定方式不支持90度旋转时原子拒绝，不产生历史', id => {
    const { model, part } = createConfirmedComponentFixture(id), before = model.toJSON()
    const builder = controller(model, [100, 100, 100])
    expect(builder.recordHistory(() => model.turnPanel(part!.id))).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })
  it('原生普通板保持90度旋转，三语均有不可旋转提示', () => {
    const { model, probe } = longFrame('x'), part = model.addNativePanel(probe, 'green')!
    expect(model.turnPanel(part.id)).toBe(true)
    expect(model.panels.get(part.id)).toMatchObject({ turned: true })
    for (const lang of ['zh', 'en', 'de']) {
      setLang(lang)
      expect(t('notice_panel_turn_unavailable')).not.toBe('notice_panel_turn_unavailable')
      expect(t('notice_panel_turn_unavailable')).toContain('90°')
    }
    setLang('zh')
  })
})

describe('方向盘安装和下移都校验离地关系', () => {
  it.each([0, 2.5, 11])('高度%s穿地时没有安装点且不写入模型', y => {
    const { model, tube } = beam(y), before = model.toJSON()
    expect(model.accessoryDiagnostics('steering_wheel', tube.id).reason).toBe('ground_clearance')
    expect(model.accessoryMounts('steering_wheel')).toHaveLength(0)
    expect(model.addAccessory('steering_wheel', tube.id, 'blue')).toBeNull()
    expect(model.toJSON()).toEqual(before)
  })
  it('临界高度可装，下移破坏离地关系时原子拒绝，保存恢复保留朝向', () => {
    const { model, tube } = beam(12), part = model.addAccessory('steering_wheel', tube.id, 'blue')!
    expect(part).toBeTruthy()
    expect(componentMountsValid(model, part)).toBe(true)
    const before = model.toJSON()
    expect(model.moveSelection(selectAll(model), 0, -1, 0)).toEqual({ ok: false, reason: 'accessory_space' })
    expect(model.toJSON()).toEqual(before)
    expect(model.moveSelection(selectAll(model), 0, 5, 0).ok).toBe(true)
    const copy = new BuildModel(), saved = model.toJSON(); copy.loadJSON(saved)
    expect(copy.toJSON()).toEqual(saved)
    expect(componentMountsValid(copy, copy.fittings.get(part.id)!)).toBe(true)
  })
})
