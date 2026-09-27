import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { docFromJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'

beforeAll(async () => { await loadCatalog() })

function assembly() {
  const model = new BuildModel()
  const tube = (z: number) => {
    const a = model.addNode(0, 40, z)
    const b = model.addNode(40, 40, z)
    return model.addTube(a.id, b.id, 'T35', 'blue', 35)!
  }
  const hinge = tube(0), flap = tube(5), foot = tube(45)
  model.addPanel(flap.id, foot.id, 0, 40, 'P40', 'blue')
  const clamp = model.addClamp(20, 40, 0)
  clamp.dir = [1, 0, 0]
  clamp.off = [0, 0, 5]
  model.addLink(hinge.a, flap.a)
  model.addLink(hinge.b, flap.b)
  model.addTube(flap.a, foot.a, 'T35', 'yellow', 35)
  model.addTube(flap.b, foot.b, 'T35', 'yellow', 35)
  const made = model.extendBow(flap.a, [0, 1, 0], [0, 0, 1], 'round-tube2', 'green', 10)
  if (!made?.tube) throw new Error('弯管创建失败')
  const bow = made.tube
  return { model, clamp, bow }
}

function bowShape(model: BuildModel, id: string) {
  const bow = model.tubes.get(id)!
  const a = model.nodes.get(bow.a)!, b = model.nodes.get(bow.b)!
  const c = bow.bowCenter!
  const ra = Math.hypot(a.x - c[0], a.y - c[1], a.z - c[2])
  const rb = Math.hypot(b.x - c[0], b.y - c[1], b.z - c[2])
  return { center: c, ra, rb }
}

describe('双管斜板与弯管持久化', () => {
  it('撤销重做保留旋转后的圆心', () => {
    const { model, clamp, bow } = assembly()
    const original = model.toJSON()
    const history = new ModelHistory(docFromJSON(original))
    const before = JSON.stringify(original)
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const after = JSON.stringify(model.toJSON())
    history.commit(before, after)
    history.undo()
    const undone = new BuildModel()
    expect(undone.loadJSON(history.toJSON()).ok).toBe(true)
    expect(bowShape(undone, bow.id).center).toEqual(bowShape(newModel(original), bow.id).center)
    history.redo()
    const redone = new BuildModel()
    expect(redone.loadJSON(history.toJSON()).ok).toBe(true)
    expect(bowShape(redone, bow.id)).toEqual(bowShape(model, bow.id))
  })

  it('导出 .qdf 再导入保持弯管半径与接头位置', () => {
    const { model, clamp, bow } = assembly()
    expect(model.rotateClamp(clamp.id, Math.asin(40 / 45))).toBe(true)
    const text = buildQDF(model).text
    expect(text).toContain('round-tube2{')
    const opened = new BuildModel()
    const data = parseQDF(text, {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    })
    expect(opened.loadJSON(data).ok).toBe(true)
    const round = [...opened.tubes.values()].find((tube) => tube.bow)!
    const shape = bowShape(opened, round.id)
    expect(shape.ra).toBeCloseTo(10, 1)
    expect(shape.rb).toBeCloseTo(10, 1)
    expect(shape.center[1]).toBeCloseTo(bowShape(model, bow.id).center[1], 1)
    const originalEnds = [model.nodes.get(bow.a)!, model.nodes.get(bow.b)!]
    const importedEnds = [opened.nodes.get(round.a)!, opened.nodes.get(round.b)!]
    for (let i = 0; i < 2; i++) {
      expect(importedEnds[i].x).toBeCloseTo(originalEnds[i].x, 1)
      expect(importedEnds[i].y).toBeCloseTo(originalEnds[i].y, 1)
      expect(importedEnds[i].z).toBeCloseTo(originalEnds[i].z, 1)
    }
  })
})

function newModel(data: ReturnType<BuildModel['toJSON']>) {
  const model = new BuildModel()
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}
