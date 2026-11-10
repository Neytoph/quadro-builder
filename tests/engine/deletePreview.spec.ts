import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

async function deleteBearingShaft(page: Page, touch: boolean, info: TestInfo) {
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const ids = await page.evaluate(() => {
    const { model, builder, scene } = window.__quadroDev
    const ids = builder.recordHistory(() => {
      model.clear()
      const points = [[0, 0], [40, 0], [0, -40], [40, -40], [0, 40], [40, 40]]
      const [a, b, c, d, e, f] = points.map(([x, z]) => model.addNode(x, 2.5, z))
      const frame = [[a, b], [a, c], [c, d], [d, b], [a, e], [e, f], [f, b]]
        .map(([from, to], index) => model.addTube(from.id, to.id, 'T35', index === 0 ? 'yellow' : 'blue', 35)!)
      const bearings = [a, b].map(node => model.addBearingAtArm(node.id, [0, 1, 0])!)
      const start = model.addNode(-10, 12.5, 0), end = model.addNode(30, 12.5, 0)
      const shaft = model.addTube(start.id, end.id, 'T35', 'green', 35)!
      model.noteBearingTube(a.id, shaft.id)
      return { shaft: shaft.id, frame: frame.map(t => t.id), bearings: bearings.map(part => part.id) }
    })
    builder.setMode('delete')
    builder.refresh()
    scene.releaseLoadGate()
    scene.resetCamera(model, { animate: false })
    return ids
  })
  await page.waitForFunction(() => window.__quadroDev.scene.meshesReady())
  const point = await page.evaluate(id => {
    const { builder, scene } = window.__quadroDev
    scene._finishMotion()
    scene.buildGroup.updateWorldMatrix(true, true)
    for (const along of [13, 20, 25]) {
      const [x, y] = scene.screenPoint([along, 12.5, 0])
      if (builder.scene.pickForDelete(x, y)?.data.id === id) return { x, y }
    }
    throw new Error('无法点到穿轴')
  }, ids.shaft)
  if (!touch) {
    await page.mouse.move(point.x, point.y)
    const preview = await page.evaluate(() => {
      const { scene } = window.__quadroDev
      return { target: scene._hoverPartId, extras: scene._hoverPartExtra,
        overlay: scene._hoverPartGroup.children.length }
    })
    expect(preview.target).toBe(ids.shaft)
    expect(preview.extras).toBeNull()
    expect(preview.overlay).toBeGreaterThan(0)
  }
  await page.screenshot({ path: info.outputPath('before.png') })
  if (touch) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
  const state = () => page.evaluate(() => {
    const { model } = window.__quadroDev
    return { tubes: [...model.tubes.keys()], bearings: [...model.fittings.keys()], openings: model.bearingOpenings().length }
  })
  expect(await state()).toEqual({ tubes: ids.frame, bearings: ids.bearings, openings: 2 })
  await page.evaluate(() => window.__quadroDev.scene._finishMotion())
  await page.screenshot({ path: info.outputPath('after.png') })
  await page.evaluate(() => window.__quadroDev.builder.undo())
  expect(await state()).toEqual({ tubes: [...ids.frame, ids.shaft], bearings: ids.bearings, openings: 1 })
  await page.evaluate(() => window.__quadroDev.builder.redo())
  expect(await state()).toEqual({ tubes: ids.frame, bearings: ids.bearings, openings: 2 })
}

test('删除模式只高亮并移除穿轴，两个轴承座和框架均保留', async ({ page }, info) => {
  await deleteBearingShaft(page, false, info)
})

test.describe('触屏', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('点按穿轴只移除管子', async ({ page }, info) => {
    await deleteBearingShaft(page, true, info)
  })
})
