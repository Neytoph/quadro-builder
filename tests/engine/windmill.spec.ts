import { expect, test } from '@playwright/test'

test('风火轮通过轮轴承安装，支持旋转和撤销重做', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/')
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const bearingId = await page.evaluate(() => {
    const { model, builder, scene } = window.__quadroDev
    model.clear()
    const a = model.addNode(0, 60, 0), b = model.addNode(-40, 60, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const mount = model.fittingMounts('bearing2').find(m => m.nodeId === a.id && m.dir[2] === 1)
    const bearing = model.addFittingAt('bearing2', mount, 'red')
    builder.refresh()
    scene.releaseLoadGate()
    scene.resetCamera(model, { animate: false })
    return bearing.id
  })
  await page.locator('[data-ui="catalogue-tool-connectors"]').click()
  await page.locator('[data-part-id="windmill"]').click()
  await expect.poll(() => page.evaluate(() => window.__quadroDev.builder.fittingKind)).toBe('windmill-clamp')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const point = await page.evaluate(id => {
    const { model, scene } = window.__quadroDev
    const mount = model.windmillBearingMounts().find(m => m.bearingId === id)
    const p = scene.camera.position.clone().set(...mount.pos).project(scene.camera)
    const rect = scene.renderer.domElement.getBoundingClientRect()
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 }
  }, bearingId)
  expect(await page.evaluate(p => window.__quadroDev.scene.pickHandle(p.x, p.y)?.data?.windmillBearing?.bearingId, point)).toBe(bearingId)
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => [...window.__quadroDev.model.nodes.values()].filter(n => n.part === 'windmill').length)).toBe(1)
  await page.evaluate(() => window.__quadroDev.builder.undo())
  await expect.poll(() => page.evaluate(() => [...window.__quadroDev.model.nodes.values()].filter(n => n.part === 'windmill').length)).toBe(0)
  await page.evaluate(() => window.__quadroDev.builder.redo())
  await expect.poll(() => page.evaluate(() => [...window.__quadroDev.model.nodes.values()].filter(n => n.part === 'windmill').length)).toBe(1)
  expect(await page.evaluate(id => {
    const { model, builder } = window.__quadroDev
    const hub = [...model.nodes.values()].find(n => n.part === 'windmill')
    const fixed = JSON.stringify(model.fittings.get(id))
    const centre = model.nodePos(hub.id)
    const end = model.extend(hub.id, [1, 0, 0], 'T15', 'red', 15, 20).node
    const original = model.nodePos(end.id)
    const ok = builder._adjustPlacedPart(hub.id, 'hole')
    window.__quadroDev.scene.resetCamera(model, { animate: false })
    return ok && JSON.stringify(model.fittings.get(id)) === fixed && JSON.stringify(centre) === JSON.stringify(model.nodePos(hub.id)) && JSON.stringify(original) !== JSON.stringify(model.nodePos(end.id))
  }, bearingId)).toBe(true)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: '.work/windmill-bearing-installed.png' })
  await test.info().attach('model.json', { body: JSON.stringify(await page.evaluate(() => window.__quadroDev.model.toJSON())), contentType: 'application/json' })
  expect(errors).toEqual([])
})

test('从目录选择三个新组件，并在真实画布上安装风火轮', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => {
    const { model, builder, scene } = window.__quadroDev
    model.clear()
    const a = model.addNode(0, 40, 0), b = model.addNode(40, 40, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    builder.refresh()
    scene.releaseLoadGate()
    scene.resetCamera(model, { animate: false })
  })
  await page.locator('[data-ui="catalogue-tool-connectors"]').click()
  const item = page.locator('[data-ui="catalogue-item"][data-part-id="windmill"]')
  await expect(item).toHaveText('风火轮')
  await expect(item.locator('img')).toHaveAttribute('src', /windmill\.png/)
  await item.click()
  const point = await page.evaluate(() => {
    const { scene, model } = window.__quadroDev
    const tube = [...model.tubes.values()][0]
    const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b)
    const p = scene.camera.position.clone().set((a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2).project(scene.camera)
    const rect = scene.renderer.domElement.getBoundingClientRect()
    return { x: rect.left + (p.x+1)*rect.width/2, y: rect.top + (1-p.y)*rect.height/2 }
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => [...window.__quadroDev.model.nodes.values()].some(n => n.part === 'windmill'))).toBe(true)
  await expect(page.locator('[data-ui="installation-catalogue"]')).toHaveCount(0)
  await page.screenshot({ path: '.work/windmill-installed.png' })
  await page.locator('[data-ui="catalogue-tool-tubes"]').click()
  await expect(page.locator('[data-part-id="TC15"]')).toHaveText('小弯管')
  await expect(page.locator('[data-part-id="TC15"] img')).toHaveAttribute('src', /TC15\.png/)
  await page.locator('[data-part-id="TC15"]').click()
  await expect.poll(() => page.evaluate(() => window.__quadroDev.builder.tubeId)).toBe('TC15')
  await page.locator('[data-ui="catalogue-tool-panels"]').click()
  await expect(page.locator('[data-part-id="panel_sector_20"]')).toHaveText('小扇形板')
  await page.locator('[data-part-id="panel_sector_20"]').click()
  await expect.poll(() => page.evaluate(() => window.__quadroDev.builder.fittingPart)).toBe('panel_sector_20')
})

test('手机目录中三个新组件可见', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await page.locator('[data-ui="catalogue-tool-connectors"]').click()
  await expect(page.locator('[data-part-id="windmill"]')).toBeVisible()
  await expect.poll(() => page.locator('.ic-popover').evaluate(el => el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false)
  await page.screenshot({ path: '.work/windmill-mobile.png' })
  await page.locator('[data-ui="catalogue-tool-tubes"]').click()
  await expect(page.locator('[data-part-id="TC15"]')).toBeVisible()
  await page.locator('[data-ui="catalogue-tool-panels"]').click()
  await expect(page.locator('[data-part-id="panel_sector_20"]')).toBeVisible()
})
