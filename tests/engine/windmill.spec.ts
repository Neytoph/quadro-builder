import { expect, test } from '@playwright/test'

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
  await expect(item.locator('svg')).toBeVisible()
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
