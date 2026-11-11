import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

assert.ok(process.argv[2], 'Usage: node scripts/verify-safety-equivalence.mjs <model.json> [output-directory]')
const output = resolve(process.argv[3] || '../evidence'), source = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true }), pages = [], rows = []
try {
  for (const port of [35231, 35232]) {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/?view=locked`)
    await page.waitForFunction(() => window.__quadroDev?.model)
    await page.evaluate(async () => (await import('/src/engine/assemblyNativeMesh.js')).ensureAssemblyMeshes())
    pages.push(page)
  }
  const variants = []
  const push = (name, change, options = { room: null, indoor: false }) => { const data = structuredClone(source); change(data); variants.push({ name, data, options }) }
  push('saved-model', () => {})
  push('room-constraints', () => {}, { room: { w: 300, d: 600 }, indoor: true })
  push('one-net-mount-damaged', d => { d.fittings.find(f => f.kind === 'lattice').mounts[0].t += .08 })
  push('net-support-missing', d => { const id = d.fittings.find(f => f.kind === 'lattice').supportTubes[0]; d.tubes = d.tubes.filter(t => t.id !== id) })
  push('net-just-inside-position-tolerance', d => { d.fittings.find(f => f.kind === 'lattice').x += .099 })
  push('net-outside-position-tolerance', d => { d.fittings.find(f => f.kind === 'lattice').x += .101 })
  push('same-count-support-moved', d => { const f = d.fittings.find(f => f.kind === 'lattice'), t = d.tubes.find(t => t.id === f.supportTubes[0]); d.nodes.find(n => n.id === t.a).x += 10 })
  push('same-count-tube-order-changed', d => { d.tubes.reverse() })
  push('duplicate-support-first', d => { const f = d.fittings.find(f => f.kind === 'lattice'), t = d.tubes.find(t => t.id === f.supportTubes[0]); d.tubes.unshift({ ...t, id: 'duplicate-support' }) })
  push('obstacle-crossing-net', d => { const f = d.fittings.find(f => f.kind === 'lattice'); d.nodes.push({ id: 'obstacle-a', x: f.x - 20, y: f.y - 10, z: f.z }, { id: 'obstacle-b', x: f.x + 20, y: f.y + 10, z: f.z }); d.tubes.push({ id: 'obstacle', a: 'obstacle-a', b: 'obstacle-b', tubeId: 'T35', color: 'red', length: 35 }) })
  push('full-coordinate-translation', d => { for (const n of d.nodes) { n.x += 160; n.z -= 80 } for (const f of d.fittings) { if (Number.isFinite(f.x)) f.x += 160; if (Number.isFinite(f.z)) f.z -= 80 } })
  for (const test of variants) {
    const results = []
    for (const page of pages) results.push(await page.evaluate(async ({ data, options }) => {
      const { BuildModel } = await import('/src/engine/model.js'), { computeSafety } = await import('/src/engine/safety.js')
      const m = new BuildModel(); if (!m.loadJSON(data).ok) throw new Error('原始模型不能加载')
      const start = performance.now(), result = computeSafety(m, options)
      return { ms: performance.now() - start, result }
    }, test))
    assert.deepEqual(results[1].result, results[0].result, `${test.name}安全结果变化`)
    rows.push({ name: test.name, baselineMs: results[0].ms, optimizedMs: results[1].ms, findings: results[0].result.findings, height: results[0].result.height, equal: true })
    writeFileSync(resolve(output, 'safety-equivalence.json'), JSON.stringify(rows, null, 2))
    console.log(test.name, results[0].ms.toFixed(1), '->', results[1].ms.toFixed(1), 'equal')
  }
  // 同一实例连续替换、恢复与重排，核对检查缓存没有携带旧模型结论。
  const reused = await pages[1].evaluate(async tests => {
    const { BuildModel } = await import('/src/engine/model.js'), { computeSafety } = await import('/src/engine/safety.js')
    const model = new BuildModel()
    return tests.map(test => { model.loadJSON(test.data); return computeSafety(model, test.options) })
  }, [variants[0], ...variants.slice(2), variants[0]])
  const indexes = [0, ...variants.slice(2).map((_, i) => i + 2), 0]
  reused.forEach((actual, i) => assert.deepEqual(actual, { findings: rows[indexes[i]].findings, height: rows[indexes[i]].height }))
  writeFileSync(resolve(output, 'safety-reused-model.json'), JSON.stringify({ states: reused.length, equal: true }))
} finally { await browser.close() }
