import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { componentMountsValid, componentObstacle, componentFrame, mountPoint } from './accessoryPack.js'
import { computeSafety, computeMetrics } from './safety.js'
import { createOriginalAccessoryExample } from './accessoryExample.js'

beforeAll(async () => { await loadCatalog() })

type Mount = { tube: string; t: number; width: number; role: string; corner?: number }
type Component = { id: string; tube: string; mounts: Mount[]; supportTubes: string[]; facing: number; params: Record<string, number>; panelId?: string }
function component<T>(part: T): T & Component { return part as T & Component }

// 这些模型是隔离安装夹具，直接使用真实BuildModel API，检验几何约束与数据生命周期。
function beam(y = 80, span = 40) {
  const model = new BuildModel(), a = model.addNode(0, y, 0), b = model.addNode(span, y, 0)
  const tube = model.addTube(a.id, b.id, span > 60 ? 'T75' : 'T35', 'yellow', span - 5)!
  return { model, tube, a, b }
}

function frame(horizontal = false, y = 40) {
  const model = new BuildModel()
  const positions = horizontal ? [[0, y, 0], [40, y, 0], [40, y, 40], [0, y, 40]] : [[0, y, 0], [40, y, 0], [40, y + 40, 0], [0, y + 40, 0]]
  const nodes = positions.map(p => model.addNode(...p as [number, number, number]))
  const tubes = nodes.map((n, i) => model.addTube(n.id, nodes[(i + 1) % 4].id, 'T35', 'blue', 35)!)
  return { model, nodes, tubes, probe: { a: tubes[0].id, b: tubes[2].id, t0: 0, len: 40, panelId: horizontal ? 'panel_40x40_pocket' : 'panel_40x40_busy', side: 1 } }
}

describe('原创配件固定点与空间约束', () => {
  it('方向盘实际保存两个相距8cm的独立卡箍并可翻转', () => {
    const { model, tube } = beam()
    const part = component(model.addAccessory('steering_wheel', tube.id, 'blue')!)
    const pts = part.mounts.map(m => mountPoint(model, m)!)
    expect(Math.hypot(...pts[0].map((n: number, i: number) => n - pts[1][i]))).toBeCloseTo(8)
    expect(componentMountsValid(model, part)).toBe(true)
    expect(model.flipAccessory(part.id)).toBe(true)
    expect(part.facing).toBe(-1)
    expect(componentMountsValid(model, part)).toBe(true)
  })

  it('秋千保存22cm双吊点、48cm下垂与弧形座椅参数', () => {
    const { model, tube } = beam(120, 80)
    const swing = component(model.addAccessory('swing', tube.id, 'blue')!)
    expect(swing.params.hangerSpacing).toBe(22)
    expect(swing.params.drop).toBe(48)
    expect(swing.mounts.map(m => m.role)).toEqual(['hanger', 'hanger'])
    expect(componentMountsValid(model, swing)).toBe(true)
  })

  it('拒绝竖管、短管、弧管和离地不足并给出具体原因', () => {
    const { model, tube, b } = beam()
    b.y += 40
    expect(model.accessoryDiagnostics('swing', tube.id).reason).toBe('horizontal_tube')
    b.y -= 40; b.x = 20
    expect(model.accessoryDiagnostics('swing', tube.id).reason).toBe('tube_short')
    Object.assign(tube, { bow: true })
    expect(model.accessoryDiagnostics('swing', tube.id).reason).toBe('straight_tube')
    const low = beam(40)
    expect(low.model.accessoryDiagnostics('swing', low.tube.id).reason).toBe('ground_clearance')
  })

  it('同位置重复方向盘和承载管软包占用不能确认安装', () => {
    const { model, tube } = beam()
    model.addAccessory('steering_wheel', tube.id, 'blue')
    expect(model.addAccessory('steering_wheel', tube.id, 'blue')).toBeNull()
    const other = beam()
    const sleeve = component(other.model.addFitting('sleeve', 20, 80, 0))
    sleeve!.tube = other.tube.id
    expect(other.model.accessoryDiagnostics('steering_wheel', other.tube.id).reason).toBe('mount_occupied')
  })

  it('方向盘朝向有障碍时翻转原子失败', () => {
    const { model, tube } = beam()
    const part = model.addAccessory('steering_wheel', tube.id, 'blue')!
    const a = model.addNode(10, 80, -8), b = model.addNode(30, 80, -8)
    model.addTube(a.id, b.id, 'T15', 'red', 15)
    const before = model.toJSON()
    expect(model.flipAccessory(part.id)).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('秋千静止座面无碰撞时仍检查±30°活动范围', () => {
    const { model, tube } = beam(120, 80)
    const a = model.addNode(20, 77, 24), b = model.addNode(60, 77, 24)
    model.addTube(a.id, b.id, 'T35', 'red', 35)
    const candidate = model.accessoryDiagnostics('swing', tube.id)
    expect(candidate.reason).toBe('swing_clearance')
    expect(componentObstacle(model, candidate)).toBeNull()
    expect(componentObstacle(model, candidate, { sweep: true })).not.toBeNull()
    expect(model.addAccessory('swing', tube.id, 'blue')).toBeNull()
  })

  it.each([false, true])('忙碌板两边螺丝/布兜四边张紧保存真实引用 horizontal=%s', horizontal => {
    const { model, tubes, probe } = frame(horizontal)
    const part = component(model.addPanel(probe.a, probe.b, 0, 40, probe.panelId, 'green')!)
    expect(part.mounts).toHaveLength(4)
    if(horizontal){
      expect(new Set(part.mounts.map(m => m.corner)).size).toBe(4)
      expect(new Set(part.supportTubes)).toEqual(new Set(tubes.map(t => t.id)))
    }else{
      expect(part.mounts.every(m=>m.role==='inset-screw')).toBe(true)
      expect(new Set(part.supportTubes)).toEqual(new Set([tubes[1].id,tubes[3].id]))
    }
    expect(componentMountsValid(model, part)).toBe(true)
    model.removeTube(tubes[1].id)
    expect(model.panels.has(part.id)).toBe(false)
  })

  it('方框朝向、缺边和兜底空间分别校验', () => {
    const vertical = frame(false), horizontal = frame(true)
    expect(vertical.model.panelAccessoryDiagnostics({ ...vertical.probe, panelId: 'panel_40x40_pocket' }).reason).toBe('horizontal_frame')
    expect(horizontal.model.panelAccessoryDiagnostics({ ...horizontal.probe, panelId: 'panel_40x40_busy' }).reason).toBe('vertical_frame')
    vertical.model.removeTube(vertical.tubes[1].id)
    expect(vertical.model.panelAccessoryDiagnostics(vertical.probe).reason).toBe('opposite_edges')
    const low = frame(true, 20)
    expect(low.model.panelAccessoryDiagnostics(low.probe).reason).toBe('ground_clearance')
    const inside = frame(true)
    const a = inside.model.addNode(0, 25, 20), b = inside.model.addNode(40, 25, 20)
    inside.model.addTube(a.id, b.id, 'T35', 'red', 35)
    expect(inside.model.panelAccessoryDiagnostics(inside.probe).reason).toBe('component_space')
  })

  it.each(['swing', 'steering_wheel'])('保存后重复吊点或错误尺寸不能通过结构检查：%s', kind => {
    const { model, tube } = beam(120, 80)
    const part = component(model.addAccessory(kind, tube.id, 'blue')!)
    const data = model.toJSON() as ReturnType<BuildModel['toJSON']> & { fittings: Component[] }
    data.fittings[0].mounts[1] = structuredClone(data.fittings[0].mounts[0])
    model.loadJSON(data)
    expect(componentMountsValid(model, model.fittings.get(part.id)!)).toBe(false)
    expect(computeSafety(model).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
    model.loadJSON({ ...data, fittings: [{ ...data.fittings[0], mounts: part.mounts, params: { ...part.params, width: 100 } }] })
    expect(componentMountsValid(model, model.fittings.get(part.id)!)).toBe(false)
  })

  it('保存后的重复角点和漏掉的承载边会被检出', () => {
    const { model, probe } = frame(true)
    const part = component(model.addPanel(probe.a, probe.b, 0, 40, probe.panelId, 'cream')!)
    part.mounts[3] = structuredClone(part.mounts[0])
    expect(componentMountsValid(model, part)).toBe(false)
    expect(computeSafety(model).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
  })

  it('原生JSON包含null固定点时读取保留诊断，结构检查不会崩溃', () => {
    const model = createOriginalAccessoryExample()
    const data = JSON.parse(JSON.stringify(model.toJSON()))
    const wheel = data.fittings.find((p: { kind: string }) => p.kind === 'steering_wheel')
    wheel.mounts[0] = null
    expect(model.loadJSON(data).ok).toBe(true)
    expect(componentMountsValid(model, model.fittings.get(wheel.id))).toBe(false)
    expect(computeSafety(model).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
  })

  it.each([['bad', 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 2], [0, 0, 1]].map(quat => [quat]))('原生JSON的错误四元数不造成NaN伪通过：%s', quat => {
    const model = createOriginalAccessoryExample()
    const data = JSON.parse(JSON.stringify(model.toJSON()))
    const wheel = data.fittings.find((p: { kind: string }) => p.kind === 'steering_wheel')
    wheel.quat = quat
    expect(model.loadJSON(data).ok).toBe(true)
    expect(componentMountsValid(model, model.fittings.get(wheel.id))).toBe(false)
    expect(componentFrame(model, model.fittings.get(wheel.id))).toBeNull()
    expect(computeSafety(model).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
  })

  it('原生JSON承载引用为对象时只报告数据错误，安全计算不崩溃', () => {
    const model = createOriginalAccessoryExample()
    const data = JSON.parse(JSON.stringify(model.toJSON()))
    const wheel = data.fittings.find((p: { kind: string }) => p.kind === 'steering_wheel')
    wheel.supportTubes = { tube: wheel.tube }
    model.loadJSON(data)
    expect(componentMountsValid(model, model.fittings.get(wheel.id))).toBe(false)
    expect(computeSafety(model).findings.some(f => f.rule === 'accessory_mounts')).toBe(true)
  })

  it('方向盘底座与短轴空间也会检查，两个管互不碰撞仍拒绝穿底座安装', () => {
    const { model, tube } = beam()
    const a = model.addNode(10, 85, 1), b = model.addNode(30, 85, 1)
    model.addTube(a.id, b.id, 'T15', 'red', 15)
    expect(model.collisions().size).toBe(0)
    expect(model.accessoryDiagnostics('steering_wheel', tube.id).reason).toBe('component_space')
    expect(model.addAccessory('steering_wheel', tube.id, 'blue')).toBeNull()
  })
})

describe('组件编辑与结构提示', () => {
  it.each(['x', 'z'])('完整组镜像后忙碌板的活动模块法线按镜面反射：%s', axis => {
    const model = createOriginalAccessoryExample()
    const busy = [...model.panels.values()].find(p => p.panelId === 'panel_40x40_busy')!
    const before = componentFrame(model, busy)!.axes[2] as number[]
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    expect(model.mirrorSelection(selection, axis).ok).toBe(true)
    const normal = componentFrame(model, model.panels.get(busy.id))!.axes[2] as number[]
    const expected = before.map((v, i) => i === (axis === 'x' ? 0 : 2) ? -v : v)
    normal.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 8))
    expect(componentMountsValid(model, model.panels.get(busy.id))).toBe(true)
    expect(model.mirrorSelection(selection, axis).ok).toBe(true)
    ;(componentFrame(model, model.panels.get(busy.id))!.axes[2] as number[]).forEach((value, i) => expect(value).toBeCloseTo(before[i], 8))
  })
  it.each(['move', 'rotate', 'mirror'])('局部移动承载管破坏四角安装时原子阻止：%s', action => {
    const { model, probe, tubes } = frame(true)
    model.addPanel(probe.a, probe.b, 0, 40, probe.panelId, 'cream')
    const before = model.toJSON(), selection = new Map([[tubes[0].id, 'tube']])
    const result = action === 'move' ? model.moveSelection(selection, 40, 0, 0) : action === 'rotate' ? model.rotateSelection(selection) : model.mirrorSelection(selection)
    expect(result).toEqual({ ok: false, reason: 'accessory_mounts' })
    expect(model.toJSON()).toEqual(before)
  })

  it('完整组合移动、旋转、镜像后每一个固定点仍有效', () => {
    const model = createOriginalAccessoryExample()
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    expect(model.moveSelection(selection, 320, 0, 0).ok).toBe(true)
    expect(model.rotateSelection(selection).ok).toBe(true)
    expect(model.mirrorSelection(selection).ok).toBe(true)
    for (const part of [...model.panels.values(), ...model.fittings.values()]) expect(componentMountsValid(model, part)).toBe(true)
  })

  it('片段复制完整重映射全部固定点，删除副本承载边不影响原件', () => {
    const model = createOriginalAccessoryExample()
    const fragment = model.extractSelection(new Map([...model.nodes.keys()].map(id => [id, 'node'])))!
    const copy = model.insertFragment(fragment, [400, 0, 0]) as { panels: string[]; fittings: string[]; tubes: string[] }
    expect(copy.panels).toHaveLength(2); expect(copy.fittings).toHaveLength(2)
    const copiedParts = [...copy.panels.map(id => component(model.panels.get(id)!)), ...copy.fittings.map(id => component(model.fittings.get(id)!))]
    for (const part of copiedParts) {
      expect(part.supportTubes.every((id: string) => copy.tubes.includes(id))).toBe(true)
      expect(part.mounts.every((m: Mount) => copy.tubes.includes(m.tube))).toBe(true)
      expect(componentMountsValid(model, part)).toBe(true)
    }
    const pocket = copiedParts.find(p => p.panelId === 'panel_40x40_pocket')!
    model.removeTube(pocket.supportTubes[1])
    expect(model.panels.has(pocket.id)).toBe(false)
    expect(model.panels.size).toBe(3)
  })

  it('删除承载节点同步删除附属组件，原生快照可完整恢复', () => {
    const { model, tube, a } = beam(120, 80)
    const part = model.addAccessory('swing', tube.id, 'blue')!, before = model.toJSON()
    model.removeNode(a.id)
    expect(model.fittings.has(part.id)).toBe(false)
    model.loadJSON(before)
    expect(componentMountsValid(model, model.fittings.get(part.id)!)).toBe(true)
    expect(model.toJSON()).toEqual(before)
  })

  it('独立悬空承载结构与未验证承载能力有明确报告', () => {
    const { model, tube } = beam()
    model.addAccessory('steering_wheel', tube.id, 'blue')
    const findings = computeSafety(model).findings
    expect(findings.some(f => f.rule === 'accessory_support')).toBe(true)
    expect(findings.some(f => f.rule === 'accessory_load')).toBe(true)
  })

  it('真实组合有地面承载连通，忙碌板和布兜均不计站立面', () => {
    const example = createOriginalAccessoryExample()
    expect(computeSafety(example).findings.some(f => ['accessory_mounts', 'accessory_support', 'accessory_clearance'].includes(f.rule))).toBe(false)
    const { model, probe } = frame(true)
    model.addPanel(probe.a, probe.b, 0, 40, probe.panelId, 'cream')
    // 本夹具只有单框，站立高度可能来自框架横管；没有板平台的护栏、层高和固定规则。
    expect(computeSafety(model).findings.some(f => ['deck_edges', 'level_gap', 'anchoring', 'railing'].includes(f.rule))).toBe(false)
    expect(computeMetrics(model).hasGuard).toBe(false)
  })
})
