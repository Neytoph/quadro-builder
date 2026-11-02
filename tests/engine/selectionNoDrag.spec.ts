import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  return page.evaluate(() => {
    const { model, scene, builder } = window.__quadroDev
    // 隔离几何用于回归鼠标和触屏操作，不连接用户存档。
    model.clear()
    const a = model.addNode(0, 40, 0), b = model.addNode(40, 40, 0)
    const c = model.addNode(0, 40, 40), d = model.addNode(40, 40, 40)
    const rail = model.addTube(a.id, b.id, 'T35', 'green', 35)
    const partner = model.addTube(c.id, d.id, 'T35', 'green', 35)
    model.addTube(a.id, c.id, 'T35', 'blue', 35)
    model.addTube(b.id, d.id, 'T35', 'blue', 35)
    const panel = model.addPanel(rail.id, partner.id, 0, 40, 'P40', 'red')
    const foot = model.addNode(0, 0, 0)
    const leg = model.addTube(foot.id, a.id, 'T35', 'yellow', 35)
    builder.setMode('select')
    scene.setMotion(true)
    scene.setBackground('blank')
    builder.refresh()
    scene.releaseLoadGate()
    scene.resetCamera(model, { animate: false })
    return { tube: leg.id, node: foot.id, panel: panel.id }
  })
}

async function selectAndLocate(page: Page, id: string, kind: string) {
  await page.waitForFunction(() => window.__quadroDev.scene.meshesReady())
  return page.evaluate(({ id, kind }) => {
    const { model, scene, builder } = window.__quadroDev
    builder.selection.clear()
    builder.selection.set(id, kind)
    builder.refresh()
    scene._finishMotion()
    scene.buildGroup.updateWorldMatrix(true, true)
    const bounds = scene._piecesBox(scene._indexParts(scene.buildGroup.children).get(`${kind}:${id}`).pieces)
    const center = bounds.getCenter(scene.camera.position.clone()).project(scene.camera)
    const rect = scene.renderer.domElement.getBoundingClientRect()
    const x = rect.left + (center.x + 1) * rect.width / 2
    const y = rect.top + (1 - center.y) * rect.height / 2
    for (let dy = -24; dy <= 24; dy += 3) for (let dx = -24; dx <= 24; dx += 3) {
      if (builder._pickSelect(x + dx, y + dy)?.data.id === id) {
        return { x: x + dx, y: y + dy, before: JSON.stringify(model.toJSON()), camera: scene.camera.position.toArray() }
      }
    }
    throw new Error(`零件 ${id} 没有可点击位置`)
  }, { id, kind })
}

async function checkStable(page: Page, before: string) {
  const state = await page.evaluate(() => {
    const { model, scene, builder } = window.__quadroDev
    return { model: JSON.stringify(model.toJSON()), ghosts: scene._leaving.length, appearing: scene._appearing.size,
      selected: [...builder.selection.keys()], camera: scene.camera.position.toArray(), cursor: scene.container.style.cursor }
  })
  expect(state.model).toBe(before)
  expect(state.ghosts).toBe(0)
  expect(state.appearing).toBe(0)
  expect(state.cursor).not.toMatch(/move|grab/)
  return state
}

for (const kind of ['tube', 'node', 'panel'] as const) {
  test(`选中的${kind}拖动只旋转视角，模型及动画不变`, async ({ page }) => {
    const ids = await setup(page)
    const point = await selectAndLocate(page, ids[kind], kind)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await checkStable(page, point.before)
    await page.mouse.move(point.x + 65, point.y + 28, { steps: 8 })
    await page.mouse.up()
    const after = await checkStable(page, point.before)
    expect(after.selected).toContain(ids[kind])
    expect(after.camera).not.toEqual(point.camera)
  })
}

test('再次点击选中的直管可取消选择，不产生残影或下落', async ({ page }) => {
  const ids = await setup(page)
  const point = await selectAndLocate(page, ids.tube, 'tube')
  await page.mouse.click(point.x, point.y)
  expect((await checkStable(page, point.before)).selected).toEqual([])
})

test('触屏拖动选中的管子只旋转视角', async ({ page }) => {
  const ids = await setup(page)
  const point = await selectAndLocate(page, ids.tube, 'tube')
  const canvas = page.locator('#canvas-host canvas').first()
  await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0, buttons: 1, clientX: point.x, clientY: point.y })
  await canvas.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, buttons: 1, clientX: point.x + 65, clientY: point.y + 28 })
  await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, button: 0, buttons: 0, clientX: point.x + 65, clientY: point.y + 28 })
  const after = await checkStable(page, point.before)
  expect(after.selected).toContain(ids.tube)
  expect(after.camera).not.toEqual(point.camera)
})
