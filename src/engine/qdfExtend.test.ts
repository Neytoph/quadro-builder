import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { parseQDF } from './qdfimport.js'
import { buildQDF } from './qdfexport.js'
import { BuildModel } from './model.js'

beforeAll(async () => { await loadCatalog() })

function importedModel() {
  const text = readFileSync(join(process.cwd(), 'public/qdf/A0001.qdf'), 'utf8')
  const data = parseQDF(text, {
    tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
  })
  const model = new BuildModel()
  expect(model.loadJSON(data).ok).toBe(true)
  return model
}

function structure(model: BuildModel) {
  return [...model.tubes.values()].filter((tube) => !tube.arm && !tube.link).map((tube) => {
    const a = model.nodes.get(tube.a)!
    const b = model.nodes.get(tube.b)!
    const endpoints = [[a.x, a.y, a.z], [b.x, b.y, b.z]].sort((left, right) =>
      left.join(',').localeCompare(right.join(',')))
    return JSON.stringify({ endpoints, tubeId: tube.tubeId })
  }).sort()
}

describe('导入 QDF 后继续加管', () => {
  it('真实造型的现有接头可以扩建，存档和 QDF 再导入保留新管', () => {
    const model = importedModel()
    const from = model.nodes.get('n1')!
    expect([from.x, from.y, from.z]).toEqual([-40, 0, -40])
    expect(from.arms).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])

    const before = model.tubes.size
    expect(model.canExtendFrom(from, [-1, 0, 0])).toBe(true)
    const result = model.extend(from.id, [-1, 0, 0], 'T35', 'blue', 35, 40)
    expect(result?.tube).toBeTruthy()
    expect(model.tubes.size).toBe(before + 1)
    expect([result!.node.x, result!.node.y, result!.node.z]).toEqual([-80, 0, -40])

    const saved = new BuildModel()
    expect(saved.loadJSON(model.toJSON()).ok).toBe(true)
    expect(saved.tubes.size).toBe(before + 1)

    const exported = buildQDF(saved).text
    const reimported = new BuildModel()
    expect(reimported.loadJSON(parseQDF(exported, {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    })).ok).toBe(true)
    expect(structure(reimported)).toEqual(structure(saved))
    expect(reimported.panels.size).toBe(saved.panels.size)
    const a = [...reimported.nodes.values()].find((n) => n.x === -40 && n.y === 0 && n.z === -40)
    const b = [...reimported.nodes.values()].find((n) => n.x === -80 && n.y === 0 && n.z === -40)
    expect(a && b && reimported.tubeBetween(a.id, b.id)).toBeTruthy()
  })

  it('空白造型仍可从首个接头添加管件', () => {
    const model = new BuildModel()
    const origin = model.addNode(0, 0, 0)
    expect(model.extend(origin.id, [1, 0, 0], 'T35', 'blue', 35, 40)?.tube).toBeTruthy()
  })
})
