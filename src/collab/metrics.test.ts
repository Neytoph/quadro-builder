import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { parseQDF } from '../engine/qdfimport.js'
import { computeMetrics, computeSafety } from '../engine/safety.js'

beforeAll(async () => { await loadCatalog() })

function tube(m: BuildModel, a: { id: string }, b: { id: string }) {
  const t = m.addTube(a.id, b.id, 'T35', 'blue', 35)
  if (!t) throw new Error('addTube failed')
  return t
}

describe('交付客观量', () => {
  it('两根柱子撑着一根 80 的横梁：跨度 80', () => {
    const m = new BuildModel()
    const g0 = m.addNode(0, 0, 0), g2 = m.addNode(80, 0, 0)
    const t0 = m.addNode(0, 40, 0), t1 = m.addNode(40, 40, 0), t2 = m.addNode(80, 40, 0)
    tube(m, g0, t0); tube(m, g2, t2); tube(m, t0, t1); tube(m, t1, t2)
    const r = computeMetrics(m)
    expect(r.maxSpan).toBe(80)
    expect(r.hasGuard).toBe(false)
    expect(r.footprint).toBeGreaterThan(0)
  })

  it('官方金字塔：高度和安全审查的最高站立面一致，占地按外框算', () => {
    const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
    const m = new BuildModel()
    m.loadJSON(parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
    const r = computeMetrics(m)
    expect(r.maxDeckHeight).toBe(computeSafety(m).height)
    expect(r.maxDeckHeight).toBeGreaterThan(0)
    const b = m.bounds(2.5)!
    expect(r.footprint).toBeCloseTo(b.size[0] * b.size[2] / 10000, 2)
    expect(r.maxSpan).toBeGreaterThan(0)
  })

  it('空造型全是 0', () => {
    expect(computeMetrics(new BuildModel())).toEqual({ maxDeckHeight: 0, maxSpan: 0, hasGuard: false, footprint: 0 })
  })
})
