import { expect, test } from '@playwright/test'

test('框架切换隐藏面板与配件，保留结构及模型数据', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/')
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const button = page.getByRole('button', { name: '仅显示框架', exact: true })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  for (const partId of ['panel_40x40', 'textile', 'lattice_curved', 'sleeve']) {
    const before = await page.evaluate(async id => {
      const { createConfirmedComponentFixture } = await import('/src/engine/confirmedComponentExample.js')
      const { model, builder, scene } = window.__quadroDev
      const fixture = createConfirmedComponentFixture(id)
      model.loadJSON(fixture.model.toJSON())
      builder.modelReplaced()
      builder.refresh()
      scene.releaseLoadGate()
      scene.resetCamera(model, { animate: false })
      return { json: JSON.stringify(model.toJSON()), hiddenId: fixture.part.id }
    }, partId)
    await expect.poll(() => page.evaluate(id => window.__quadroDev.scene.selectableParts().has(id), before.hiddenId)).toBe(true)
    await page.evaluate(id => {
      const { builder, scene } = window.__quadroDev
      builder.selection.set(id, scene.selectableParts().get(id))
      builder.refresh()
    }, before.hiddenId)
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(id => {
      const { model, scene, builder } = window.__quadroDev
      return {
        hidden: !scene.selectableParts().has(id),
        selected: builder.selection.has(id),
        frame: scene.pickTubes.length > 0 && scene.pickNodes.length > 0,
        flat: scene.pickPanels.length + scene.pickTextiles.length + scene.pickSlides.length,
        ghosts: scene._leaving.length,
        json: JSON.stringify(model.toJSON()),
      }
    }, before.hiddenId)).toEqual({ hidden: true, selected: false, frame: true, flat: 0, ghosts: 0, json: before.json })
    await page.evaluate(() => window.__quadroDev.builder.refresh())
    expect(await page.evaluate(id => window.__quadroDev.scene.selectableParts().has(id), before.hiddenId)).toBe(false)
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => page.evaluate(id => window.__quadroDev.scene.selectableParts().has(id), before.hiddenId)).toBe(true)
  }
  const order = await page.locator('[data-ui="scene-buttons"] button').evaluateAll(buttons => buttons.map(button => button.getAttribute('title')))
  expect(order[2]).toContain('说明书')
  expect(order[3]).toBe('仅显示框架')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-ui="scene-buttons"]')).toHaveCSS('width', '184px')
  const boxes = await page.locator('[data-ui="scene-buttons"] button').evaluateAll(buttons => buttons.map(button => {
    const { x, y, width, height } = button.getBoundingClientRect()
    return { x, y, width, height }
  }))
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i].x).toBeGreaterThanOrEqual(0)
    expect(boxes[i].x + boxes[i].width).toBeLessThanOrEqual(390)
    if (i) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width)
  }
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('框架视图保留轴承，隐藏滑梯；室内开关在窄屏换行', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
  await page.goto('/')
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  const bearing = await page.evaluate(async () => {
    const { geometricPreset } = await import('/src/data/presets.ts')
    const { model, builder, scene } = window.__quadroDev
    model.loadJSON(geometricPreset('slide_tower'))
    const a = model.addNode(180, 60, 0), b = model.addNode(140, 60, 0)
    model.addTube(a.id, b.id, 'T35', 'blue', 35)
    const mount = model.fittingMounts('bearing2').find(m => m.nodeId === a.id && m.dir[2] === 1)
    const fitting = model.addFittingAt('bearing2', mount, 'black')
    builder.modelReplaced()
    builder.refresh()
    scene.releaseLoadGate()
    return fitting.id
  })
  await expect.poll(() => page.evaluate(() => window.__quadroDev.scene.pickSlides.length)).toBeGreaterThan(0)
  await page.locator('[data-ui="frame-only-toggle"]').click()
  expect(await page.evaluate(id => {
    const { scene } = window.__quadroDev
    return { slides: scene.pickSlides.length, bearing: scene.selectableParts().has(id) }
  }, bearing)).toEqual({ slides: 0, bearing: true })
  await page.evaluate(async () => {
    const { placeInRoom } = await import('/src/home/context.js')
    const { model, builder, scene } = window.__quadroDev
    model.homeContext = placeInRoom({ id: 'frame-inspection', rev: 1, name: '框架检查房间', data: { mode: 'area', room: { w: 450, h: 260, d: 350 }, items: [] } }, model.bounds())
    scene.setHomeContext(model.homeContext)
    scene.setBackground('home')
    builder.refresh()
  })
  const zone = page.locator('[data-ui="home-zone-toggle"]')
  await expect(zone).toBeVisible()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('[data-ui="scene-buttons"]')).toHaveCSS('width', width < 768 ? '184px' : '232px')
    const boxes = await page.locator('[data-ui="scene-buttons"] button').evaluateAll(buttons => buttons.map(button => {
      const { x, y, width, height } = button.getBoundingClientRect()
      return { x, y, width, height }
    }))
    expect(boxes).toHaveLength(5)
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    if (width < 768) expect(boxes[4].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height)
    else expect(boxes[4].x).toBeGreaterThanOrEqual(boxes[3].x + boxes[3].width)
  }
  await zone.click()
  await expect(zone).toHaveAttribute('data-zone-state', 'orange')
  await expect(page.locator('[data-ui="frame-only-toggle"]')).toHaveAttribute('aria-pressed', 'true')
})
