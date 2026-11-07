import { expect, test, type Page } from '@playwright/test'

const toolbar = (page: Page) => page.locator('[data-ui="toolbar-wrap"]')
const menu = (page: Page) => page.locator('[data-ui="editing-menu"]')
const placement = (page: Page) => page.locator('[data-ui="paste-placement"]')
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  await page.goto('/?lang=zh')
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
}

function state(page: Page) {
  return page.evaluate(() => {
    const { builder, model, scene } = window.__quadroDev
    return {
      pasting: builder.pasting,
      selection: builder.selection.size,
      groups: model.groups.size,
      height: builder.pasteHeightCm,
      current: JSON.stringify(model.toJSON()),
      saved: JSON.stringify(builder.history.toJSON()),
      camera: scene.camera.position.toArray(),
      valid: builder._paste?.valid,
    }
  })
}

async function selectMenu(page: Page, name: string) {
  await toolbar(page).getByRole('button', { name: '选择菜单', exact: true }).tap()
  await menu(page).getByRole('button', { name, exact: true }).tap()
}

async function pinch(page: Page) {
  const client = await page.context().newCDPSession(page)
  const width = page.viewportSize()!.width
  const y = Math.round(page.viewportSize()!.height * .72)
  const x = Math.round(width / 2)
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 28, y }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 28, y }, { id: 2, x: x + 28, y }] })
    for (const distance of [40, 56, 76]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ id: 1, x: x - distance, y }, { id: 2, x: x + distance, y }],
      })
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await client.detach()
  }
}

test.describe('手机编辑入口', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('选择、镜像、成组、复制与放置沿用真实模型和撤销历史', async ({ page }) => {
    await boot(page)
    await expect(toolbar(page).locator('kbd')).toHaveCount(0)
    await page.locator('[data-ui="mobile-tools-menu"]').tap()
    await page.locator('[data-ui="mobile-topbar-dialog"] [data-pane="library"]').tap()
    await page.getByRole('button', { name: '起步造型', exact: true }).tap()
    await page.getByTitle(/^两级台阶 ·/).tap()
    await expect(placement(page)).toBeVisible()
    await expect(page.locator('[data-ui="right-dock"]')).toHaveCount(0)
    await placement(page).getByRole('button', { name: '放置', exact: true }).tap()
    await expect(placement(page)).toHaveCount(0)
    await expect(page.locator('[data-ui="selection-transform"]')).toBeVisible()
    const original = await state(page)
    expect(original.selection).toBeGreaterThan(1)
    await selectMenu(page, '清除选择')
    expect((await state(page)).selection).toBe(0)
    await selectMenu(page, '全选')
    expect((await state(page)).selection).toBe(original.selection)

    for (const direction of ['左右镜像', '前后镜像']) {
      const before = await state(page)
      await button(page, '镜像').tap()
      await menu(page).getByRole('button', { name: direction, exact: true }).tap()
      expect((await state(page)).current).not.toBe(before.current)
    }
    await button(page, '更多选区操作').tap()
    await expect(menu(page).getByRole('button', { name: '解组' })).toBeDisabled()
    await menu(page).getByRole('button', { name: '成组' }).tap()
    expect((await state(page)).groups).toBe(1)
    await button(page, '更多选区操作').tap()
    await menu(page).getByRole('button', { name: '解组' }).tap()
    expect((await state(page)).groups).toBe(0)
    await button(page, '复制选中').tap()
    const copied = await state(page)
    expect(copied.pasting).toBe(false)
    expect(copied.current).toBe(copied.saved)
    await selectMenu(page, '粘贴')
    await expect(placement(page)).toBeVisible()

    const height = placement(page).getByRole('spinbutton')
    await placement(page).getByRole('button', { name: '升高副本' }).tap()
    await expect(height).toHaveValue('20')
    await height.fill('12.5')
    await height.press('Enter')
    expect((await state(page)).height).toBe(12.5)
    await placement(page).getByRole('button', { name: '降低副本' }).tap()
    await expect(height).toHaveValue('0')
    await placement(page).getByRole('button', { name: '升高副本' }).tap()
    await page.touchscreen.tap(78, 652)
    const beforeRotate = await state(page)
    expect(beforeRotate).toMatchObject({ pasting: true, valid: true })
    await placement(page).getByRole('button', { name: '向右旋转 90°' }).tap()
    expect((await state(page)).current).not.toBe(beforeRotate.current)
    const beforeMirror = await state(page)
    await placement(page).getByRole('button', { name: '镜像', exact: true }).tap()
    await menu(page).getByRole('button', { name: '左右镜像', exact: true }).tap()
    expect((await state(page)).current).not.toBe(beforeMirror.current)

    const beforePinch = await state(page)
    await pinch(page)
    await expect.poll(async () => (await state(page)).camera).not.toEqual(beforePinch.camera)
    expect(await state(page)).toMatchObject({
      pasting: true, current: beforePinch.current, saved: copied.saved, height: beforePinch.height,
    })
    await page.touchscreen.tap(45, 716)
    const positioned = await state(page)
    expect(positioned.pasting).toBe(true)
    expect(positioned.saved).toBe(copied.saved)
    expect(positioned.valid).toBe(true)
    expect(positioned.current).not.toBe(beforePinch.current)
    await placement(page).getByRole('button', { name: '放置', exact: true }).tap()
    await expect(placement(page)).toHaveCount(0)
    expect((await state(page)).saved).not.toBe(copied.saved)
    await toolbar(page).getByRole('button', { name: /撤销/ }).tap()
    expect(JSON.parse((await state(page)).saved)).toEqual(JSON.parse(copied.saved))

    await selectMenu(page, '粘贴')
    await placement(page).getByRole('button', { name: '取消', exact: true }).tap()
    expect(await state(page)).toMatchObject({ pasting: false, current: copied.saved, saved: copied.saved })
    await selectMenu(page, '全选')
    await button(page, '更多选区操作').tap()
    await menu(page).getByRole('button', { name: /删除选中/ }).tap()
    expect((await state(page)).selection).toBe(0)
    expect((await state(page)).saved).not.toBe(copied.saved)
    await toolbar(page).getByRole('button', { name: /撤销/ }).tap()
    expect(JSON.parse((await state(page)).saved)).toEqual(JSON.parse(copied.saved))
  })
})

test('桌面点击画布仍可确认放置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await boot(page)
  await button(page, '模型库').click()
  await button(page, '起步造型').click()
  await page.getByTitle(/^两级台阶 ·/).click()
  expect((await state(page)).pasting).toBe(true)
  await expect(placement(page)).toHaveCount(0)
  await page.mouse.move(630, 610)
  await page.mouse.click(630, 610)
  expect((await state(page)).pasting).toBe(false)
})
