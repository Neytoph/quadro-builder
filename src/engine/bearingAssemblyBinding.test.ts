import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })
type SavedBearingNode = ReturnType<BuildModel['toJSON']>['nodes'][number] & {
  bearingOn?: string; clampOn?: { tubeId: string; t: number }
}

// 隔离结构夹具；真实界面从空白搭建及鼠标摆动另行验收，不经过 QDF。
function seesaw() {
  const model = new BuildModel()
  const top = [0, 20].map(x => [-40, 0, 40].map(z => model.addNode(x, 30, z)))
  for (const side of top) for (let i = 1; i < side.length; i++) model.addTube(side[i - 1].id, side[i].id, 'T35', 'red', 35)
  for (let i = 0; i < 3; i++) model.addTube(top[0][i].id, top[1][i].id, 'T15', 'red', 15)
  const legs = [-5, 25].map(x => {
    const base = model.addNode(x, 0, 0), end = model.addNode(x, 20, 0)
    model.addTube(base.id, end.id, 'T15', 'yellow', 15)
    for (const z of [-40, 40]) model.addTube(base.id, model.addNode(x, 0, z).id, 'T35', 'green', 35)
    return end
  })
  const seats = top.map(side => side[1])
  const axle = () => model.extend(legs[0].id, [1, 0, 0], 'T25', 'blue', 25, 30)!.tube!
  const install = () => seats.map(node => model.addBearingAtArm(node.id, [0, -1, 0])!)
  return { model, seats, axle, install }
}

function expectSwing(model: BuildModel, nodeId: string, shaftId: string) {
  const before = model.toJSON(), fixed = before.nodes.filter(n => n.y <= 20)
  const joint = model.rotationJoint({ kind: 'tubeClamp', nodeId })!
  expect(joint.blocked).toBe(false)
  expect(joint.nodes.size).toBe(6)
  expect(joint.tubes.size).toBe(7)
  expect(joint.tubes.has(shaftId)).toBe(false)
  for (const angle of [Math.PI / 9, -2 * Math.PI / 9]) {
    expect(model.rotateJoint({ kind: 'tubeClamp', nodeId }, angle)).toBe(true)
    expect(model.toJSON().nodes.filter(n => fixed.some(f => f.id === n.id))).toEqual(fixed)
    expect(model.toJSON().tubes).toEqual(before.tubes)
    expect(model.toJSON().nodes.some(n => n.y > 30.5)).toBe(true)
  }
}

describe('搭建时直接记录轴承穿管关系', () => {
  it.each([false, true])('两个轴承与横轴安装顺序均可立即摆动，先装轴承=%s', seatsFirst => {
    const { model, seats, axle, install } = seesaw()
    if (seatsFirst) install()
    const shaft = axle()
    if (!seatsFirst) install()
    expect(seats.map(n => n.clampOn)).toEqual([{ tubeId: shaft.id, t: 5 }, { tubeId: shaft.id, t: 25 }])
    expectSwing(model, seats[0].id, shaft.id)
  })

  it('旧 JSON 中已对准的轴承恢复连接，保存重开后继续摆动', () => {
    const { model, seats, axle, install } = seesaw(), shaft = axle()
    install()
    const legacy = model.toJSON()
    for (const node of legacy.nodes as SavedBearingNode[]) if (node.bearingOn) delete node.clampOn
    const reopened = new BuildModel()
    expect(reopened.loadJSON(legacy).ok).toBe(true)
    expectSwing(reopened, seats[0].id, shaft.id)
    const saved = reopened.toJSON(), again = new BuildModel()
    expect(again.loadJSON(saved).ok).toBe(true)
    expect(again.toJSON()).toEqual(saved)
    expect(again.rotateJoint({ kind: 'tubeClamp', nodeId: seats[1].id }, Math.PI / 18)).toBe(true)
  })

  it.each([false, true])('安装及绑定作为同一步撤销重做，最后添加横轴=%s', axleLast => {
    const { model, seats, axle, install } = seesaw()
    if (axleLast) install()
    else axle()
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, scene: {}, selection: new Map(), stepFrom: [],
      refresh: () => {}, onHistoryChange: () => {}, onPreview: () => {} })
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    builder.recordHistory(() => axleLast ? axle() : install())
    const installed = model.toJSON()
    expect((installed.nodes as SavedBearingNode[]).filter(n => n.bearingOn).every(n => n.clampOn)).toBe(true)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    // Yjs 按 JSON 值保存，-0 会规范为 0。
    expect(JSON.stringify(model.toJSON())).toBe(JSON.stringify(installed))
    const shaftId = model.nodes.get(seats[0].id)!.clampOn.tubeId
    expectSwing(model, seats[0].id, shaftId)
  })

  it('删除横轴保留轴承，重新搭入横轴立即恢复连接', () => {
    const { model, seats, axle, install } = seesaw(), shaft = axle()
    install()
    model.removeTube(shaft.id)
    expect(seats.every(n => n.bearingOn && !n.clampOn)).toBe(true)
    const replacement = axle()
    expect(seats.every(n => n.clampOn.tubeId === replacement.id)).toBe(true)
    expectSwing(model, seats[0].id, replacement.id)
  })

  it.each(['offset', 'direction', 'outside', 'bow', 'link', 'arm', 'ambiguous'])('不把无效穿管关系写入连接图：%s', kind => {
    const { model, seats, axle, install } = seesaw(), shaft = axle()
    const a = model.nodes.get(shaft.a)!, b = model.nodes.get(shaft.b)!
    if (kind === 'offset') a.z = b.z = 0.2
    if (kind === 'direction') a.z = -15, b.z = 15, a.x = b.x = 0
    if (kind === 'outside') a.x = 22, b.x = 52
    if (kind === 'bow') Object.assign(shaft, { bow: true })
    if (kind === 'link') Object.assign(shaft, { link: true })
    if (kind === 'arm') Object.assign(shaft, { arm: true })
    if (kind === 'ambiguous') {
      const c = model.addNode(-10, 20, 0), d = model.addNode(30, 20, 0)
      model.addTube(c.id, d.id, 'T35', 'blue', 35)
    }
    install()
    expect(seats.every(n => !n.clampOn)).toBe(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect([...reopened.nodes.values()].filter(n => n.bearingOn).every(n => !n.clampOn)).toBe(true)
  })

  it('把空轴承孔转到已有横轴方向后立即绑定', () => {
    const model = new BuildModel(), node = model.addNode(0, 30, 0)
    model.addTube(node.id, model.addNode(0, 50, 0).id, 'T15', 'red', 15)
    const shaft = model.addTube(model.addNode(0, 20, -20).id, model.addNode(0, 20, 20).id, 'T35', 'blue', 35)!
    model.addBearingAtArm(node.id, [0, -1, 0])
    expect(node.clampOn).toBeFalsy()
    expect(model.turnBearingMouth(node.id)).toBe(true)
    expect(node.clampOn).toEqual({ tubeId: shaft.id, t: 20 })
  })
})
