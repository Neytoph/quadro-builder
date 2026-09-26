import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog, buildableTubes, panels, geometry } from './engine/catalog.js'
import { BuildModel } from './engine/model.js'
import { parseQDF } from './engine/qdfimport.js'
import { computeBuildPlan } from './engine/buildplan.js'
import { computeMetrics } from './engine/safety.js'
import { statsOfData, statsOfModel } from './designStats'

beforeAll(async () => { await loadCatalog() })

function pyramid() {
  const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
  const m = new BuildModel()
  m.loadJSON(parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
  return m
}

describe('造型的量', () => {
  it('官方金字塔：尺寸、步数、站立面都照引擎，没有错误', () => {
    const m = pyramid()
    const s = statsOfModel(m)
    const b = m.bounds(geometry().connectorSize / 2)!
    expect(s.size).toEqual([Math.round(b.size[0]), Math.round(b.size[2]), Math.round(b.size[1])])
    expect(s.steps).toBe(computeBuildPlan(m, 'y+').steps.length)
    expect(s.steps).toBeGreaterThan(0)
    expect(s.height).toBe(computeMetrics(m).maxDeckHeight)
    expect(s.floating).toBe(0)
    expect(s.errors).toEqual([])
    // 同步送上去的是 JSON：从 JSON 量出来的一样
    expect(statsOfData(m.toJSON())).toEqual(s)
  })

  it('一根横梁飘在半空：记成没落地，错误里有 floating', () => {
    const m = new BuildModel()
    const g0 = m.addNode(0, 0, 0), g1 = m.addNode(40, 0, 0)
    m.addTube(g0.id, g1.id, 'T35', 'blue', 35)
    const a = m.addNode(0, 80, 0), b = m.addNode(40, 80, 0)
    m.addTube(a.id, b.id, 'T35', 'blue', 35)
    const s = statsOfModel(m)
    expect(s.floating).toBe(1)
    expect(s.errors).toContain('floating')
  })

  it('读不进引擎的返回 null', () => {
    expect(statsOfData({ nodes: 'x' })).toBeNull()
  })
})
