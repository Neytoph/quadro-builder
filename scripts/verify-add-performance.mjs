import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

assert.ok(process.argv[2], 'Usage: node scripts/verify-add-performance.mjs <model.json> [output-directory]')
const output = resolve(process.argv[3] || '../evidence'), data = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))
mkdirSync(output, { recursive: true })
const result = { model: { nodes: data.nodes.length, tubes: data.tubes.length }, cases: [], errors: [] }
const save = () => writeFileSync(resolve(output, 'browser-comparison.json'), JSON.stringify(result, null, 2))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const pages = {}
  for (const [name, port] of [['baseline', 35231], ['optimized', 35232]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    pages[name] = page
    page.on('pageerror', e => { result.errors.push({ name, error: e.message }); console.log('pageerror', name, e.message) })
    await page.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
    await page.route(url => url.pathname === '/large-model.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }))
    await page.goto(`http://127.0.0.1:${port}/?src=/large-model.json&name=L型`)
    await page.waitForFunction(count => window.__quadroDev?.model.tubes.size === count, data.tubes.length)
    await page.evaluate(async () => {
      await (await import('/src/engine/assemblyNativeMesh.js')).ensureAssemblyMeshes()
      const { builder, scene, model } = window.__quadroDev
      builder.color = 'blue'; builder.setTube('T35'); builder.setMode('add')
      const node = model.nodes.values().next().value
      if (!node) throw new Error('加管验收需要非空模型')
      scene.setCameraPose({ pos: [node.x - 80, node.y + 80, node.z - 100], target: [node.x, node.y + 10, node.z], zoom: 1 })
      const canvas = scene.renderer.domElement
      canvas.addEventListener('pointerup', () => {
        const start = performance.now(), before = model.tubes.size
        window.__clickTiming = null
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__clickTiming = { before, after: model.tubes.size, paintMs: performance.now() - start }
          if (window.__quadroDev.safetyAnalysis) {
            const watch = () => {
              const s = window.__quadroDev.safetyAnalysis
              if (!s.pending && s.result && s.snapshot === JSON.stringify(model.toJSON({ pruneGroups: false }))) window.__clickTiming.safetyMs = performance.now() - start
              else requestAnimationFrame(watch)
            }
            watch()
          }
        }))
      }, { capture: true })
    })
    if (name === 'optimized') await page.waitForFunction(() => window.__quadroDev.safetyAnalysis?.result && !window.__quadroDev.safetyAnalysis.pending)
    else await page.waitForTimeout(800)
  }
  const state = async name => pages[name].evaluate(async () => {
    const e = window.__quadroDev
    const safety = e.safetyAnalysis?.result ?? (await import('/src/engine/safety.js')).computeSafety(e.model, { room: null, indoor: false })
    return { data: e.model.toJSON(), safety }
  })
  const verify = async label => {
    await pages.optimized.waitForFunction(() => {
      const e = window.__quadroDev, s = e.safetyAnalysis
      return !s.pending && !s.error && s.result && s.snapshot === JSON.stringify(e.model.toJSON({ pruneGroups: false }))
    })
    const expected = await state('baseline'), actual = await state('optimized')
    assert.deepEqual(actual.data, expected.data, `${label}模型不同`)
    assert.deepEqual(actual.safety, expected.safety, `${label}安全检查不同`)
    return { safetySame: true, modelSame: true, findings: actual.safety.findings.length, nodes: actual.data.nodes.length, tubes: actual.data.tubes.length }
  }
  result.cases.push({ label: 'initial', ...await verify('initial') }); save()
  for (let i = 0; i < 3; i++) {
    let selected = null
    const row = { label: `mouse-add-${i + 1}` }
    for (const name of ['baseline', 'optimized']) {
      const point = await pages[name].evaluate(selected => {
        const { scene } = window.__quadroDev
        scene.scene.updateMatrixWorld(true)
        const rect = scene.renderer.domElement.getBoundingClientRect()
        for (const h of scene.handleMeshes) {
          const d = h.userData
          if (!h.visible || !d.nodeId || !d.dir || d.slope || selected && (d.nodeId !== selected.nodeId || JSON.stringify(d.dir) !== JSON.stringify(selected.dir))) continue
          const p = h.getWorldPosition(h.position.clone()).project(scene.camera)
          const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2
          if (x < rect.left + 10 || x > rect.right - 10 || y < rect.top + 80 || y > rect.bottom - 100) continue
          const hit = scene.pickHandle(x, y)
          if (hit?.data.nodeId !== d.nodeId || JSON.stringify(hit.data.dir) !== JSON.stringify(d.dir)) continue
          return { x, y, nodeId: d.nodeId, dir: d.dir }
        }
        throw new Error('没有可点击的同一加管位置')
      }, selected)
      selected = point
      const before = await pages[name].evaluate(() => window.__quadroDev.model.tubes.size)
      await pages[name].mouse.move(point.x, point.y)
      await pages[name].mouse.click(point.x, point.y)
      await pages[name].waitForFunction(before => window.__clickTiming?.after === before + 1, before, { timeout: 15000 })
      if (name === 'optimized') await pages[name].waitForFunction(() => typeof window.__clickTiming?.safetyMs === 'number')
      row[name] = await pages[name].evaluate(() => window.__clickTiming)
    }
    Object.assign(row, await verify(row.label))
    result.cases.push(row); save(); console.log(JSON.stringify(row))
  }
  for (const method of ['undo', 'redo']) {
    for (const page of Object.values(pages)) await page.evaluate(method => window.__quadroDev.builder[method](), method)
    result.cases.push({ label: method, ...await verify(method) }); save(); console.log(method, 'equal')
  }
  await pages.optimized.screenshot({ path: resolve(output, 'large-model-after-add.png') })
  assert.equal(result.errors.length, 0)
} finally { save(); await browser.close() }
