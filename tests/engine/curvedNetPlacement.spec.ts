import { expect, test } from '@playwright/test'

test('弧形攀爬网通过画布安装点放置和重复放置', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/')
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await page.evaluate(async () => {
    const { createConfirmedComponentFixture } = await import('/src/engine/confirmedComponentExample.js')
    const { builder, model } = window.__quadroDev
    model.loadJSON(createConfirmedComponentFixture('lattice_curved', { install: false }).model.toJSON())
    builder.refresh()
  })
  await page.locator('[data-ui="catalogue-tool-textiles"]').click()
  await page.locator('[data-ui="catalogue-item"][data-part-id="lattice_curved"]').click()
  await page.evaluate(() => {
    const scene = window.__quadroDev.builder.scene
    scene.camera.position.set(20, 180, -100)
    scene.controls.target.set(20, 65, 20)
    scene.controls.update()
    scene.camera.updateMatrixWorld()
  })
  for (let count = 1; count <= 2; count++) {
    const point = await page.evaluate(() => {
      const { builder } = window.__quadroDev
      const handle = builder.scene.handleMeshes.find((item: any) => item.userData.confirmedComponent?.kind === 'lattice_curved')
      handle.updateWorldMatrix(true, false)
      const p = handle.getWorldPosition(handle.position.clone()).project(builder.scene.camera)
      const rect = builder.scene.renderer.domElement.getBoundingClientRect()
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 }
    })
    await page.mouse.click(point.x, point.y)
    await expect.poll(() => page.evaluate(() => [...window.__quadroDev.model.fittings.values()].filter((part: any) => part.kind === 'lattice_curved').length)).toBe(count)
  }
})
