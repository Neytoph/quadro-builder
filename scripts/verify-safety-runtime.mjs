import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

assert.ok(process.argv[2], 'Usage: node scripts/verify-safety-runtime.mjs <model.json> [output-directory]')
const out = resolve(process.argv[3] || '../evidence'), data = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))
const expected = JSON.parse(readFileSync(resolve(out, 'safety-equivalence.json'), 'utf8'))[0]
const browser = await chromium.launch({ channel: 'chrome', headless: true }), result = { recovery: null, race: null, production: [], errors: [] }
const save = () => writeFileSync(resolve(out, 'safety-runtime.json'), JSON.stringify(result, null, 2))
const openSafety = async page => {
  if (!await page.locator('[data-pane="safety"]:visible').count()) {
    await page.locator('[data-ui="mobile-tools-menu"]').click()
  }
  await page.locator('[data-pane="safety"]:visible').first().click()
  await page.waitForTimeout(850)
}
const routeModel = async page => {
  await page.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
  await page.route(url => url.pathname === '/runtime-model.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }))
}
try {
  // 真正阻断Worker资源请求，随后恢复请求并通过界面重试。
  const failed = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await routeModel(failed)
  const workerURL = url => url.pathname.endsWith('/safety.worker.ts')
  await failed.route(workerURL, route => route.abort('failed'))
  await failed.goto('http://127.0.0.1:35232/?src=/runtime-model.json&lang=zh')
  await failed.waitForFunction(count => window.__quadroDev?.model.tubes.size === count, data.tubes.length)
  await failed.waitForFunction(() => !!window.__quadroDev.safetyAnalysis?.error)
  await openSafety(failed)
  await failed.getByText('安全检查未完成', { exact: true }).waitFor()
  const noOldSuccess = await failed.evaluate(() => !window.__quadroDev.safetyAnalysis.result && !document.querySelector('[data-pane="safety"] .qb-safety-mark'))
  await failed.screenshot({ path: resolve(out, 'safety-error.png') })
  await failed.unroute(workerURL)
  await failed.getByRole('button', { name: '重试', exact: true }).click()
  await failed.waitForFunction(() => !window.__quadroDev.safetyAnalysis.pending && !!window.__quadroDev.safetyAnalysis.result)
  const recovered = await failed.evaluate(() => window.__quadroDev.safetyAnalysis.result)
  assert.deepEqual(recovered, { findings: expected.findings, height: expected.height })
  assert.equal(noOldSuccess, true)
  result.recovery = { networkFailureShown: true, noOldSuccess, retryEqualToBaseline: true }
  await failed.close(); save()

  // 暂停真实Worker加载，让连续编辑发生在旧计算仍未完成时。
  const raced = await browser.newPage()
  await routeModel(raced)
  let release
  const gate = new Promise(resolve => { release = resolve })
  await raced.route(workerURL, async route => { await gate; await route.continue() })
  await raced.goto('http://127.0.0.1:35232/?src=/runtime-model.json')
  await raced.waitForFunction(count => window.__quadroDev?.model.tubes.size === count, data.tubes.length)
  const rapid = await raced.evaluate(() => {
    const { builder, model, scene } = window.__quadroDev
    builder.setTube('T35'); builder.setMode('add')
    const before = model.tubes.size
    for (let i = 0; i < 4; i++) {
      const h = scene.handleMeshes.find(h => h.userData.nodeId && h.userData.dir && !h.userData.slope)
      builder.selectedNodeId = h.userData.nodeId; builder.stepFrom = []; builder.buildStep(h.userData.dir)
    }
    return { before, after: model.tubes.size }
  })
  await raced.waitForFunction(() => window.__quadroDev.safetyAnalysis.pending)
  await openSafety(raced)
  await raced.getByText('正在检查…', { exact: true }).waitFor()
  await raced.screenshot({ path: resolve(out, 'safety-pending.png') })
  release()
  await raced.waitForFunction(() => {
    const e = window.__quadroDev, a = e.safetyAnalysis
    return !a.pending && !!a.result && a.snapshot === JSON.stringify(e.model.toJSON({ pruneGroups: false }))
  })
  const latest = await raced.evaluate(() => ({ data: window.__quadroDev.model.toJSON(), result: window.__quadroDev.safetyAnalysis.result }))
  const reference = await browser.newPage()
  await reference.goto('http://127.0.0.1:35231/?view=locked')
  const oldResult = await reference.evaluate(async data => {
    const { loadCatalog } = await import('/src/engine/catalog.js'), { BuildModel } = await import('/src/engine/model.js')
    await loadCatalog(); await (await import('/src/engine/assemblyNativeMesh.js')).ensureAssemblyMeshes()
    const model = new BuildModel(); model.loadJSON(data)
    return (await import('/src/engine/safety.js')).computeSafety(model, { room: null, indoor: false })
  }, latest.data)
  assert.deepEqual(latest.result, oldResult)
  assert.equal(rapid.after - rapid.before, 4)
  result.race = { ...rapid, latestSnapshotEqualToBaseline: true, pendingShown: true }
  await reference.close(); await raced.close(); save()

  // 正式构建中的真实Worker和三语界面，依赖均从实际dist文件取得。
  const worker = readdirSync('dist/assets').find(name => /^safety\.worker-.*\.js$/.test(name))
  assert.ok(worker)
  for (const lang of ['zh', 'en', 'de']) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } })
    page.on('pageerror', e => result.errors.push(e.message))
    await routeModel(page)
    await page.goto(`http://127.0.0.1:35242/builder/?src=/runtime-model.json&lang=${lang}`)
    await page.locator('[data-ui="mobile-project-menu"], [data-pane="safety"]').first().waitFor({ state: 'attached' })
    await openSafety(page)
    if (lang === 'zh' && width === 1440) {
      const reply = await page.evaluate(({ data, worker }) => new Promise((resolve, reject) => {
        const w = new Worker('/builder/assets/' + worker, { type: 'module' })
        const timer = setTimeout(() => { w.terminate(); reject(new Error('built worker timeout')) }, 30000)
        w.onmessage = e => { clearTimeout(timer); w.terminate(); resolve(e.data) }
        w.onerror = e => { clearTimeout(timer); w.terminate(); reject(new Error(e.message)) }
        w.postMessage({ requestId: 1, data, options: { room: null, indoor: false } })
      }), { data, worker })
      assert.equal(reply.type, 'result')
      assert.deepEqual(reply.result, { findings: expected.findings, height: expected.height })
    }
    await page.waitForFunction(() => !!document.querySelector('#qb-right-dock button.flex.items-start'))
    const pane = await page.locator('#qb-right-dock').evaluate(e => ({ rect: e.getBoundingClientRect().toJSON(), opacity: getComputedStyle(e).opacity }))
    assert.ok(pane.rect.x < width && pane.rect.right > 0 && Number(pane.opacity) > .99)
    const check = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, body: document.body.innerText.slice(-2200) }))
    assert.equal(check.overflow, false)
    await page.screenshot({ path: resolve(out, `production-${lang}-${width}.png`) })
    result.production.push({ lang, width, overflow: false, safetyLoaded: true }); save(); await page.close()
  }
  assert.equal(result.errors.length, 0)
  console.log(JSON.stringify(result))
} finally { save(); await browser.close() }
