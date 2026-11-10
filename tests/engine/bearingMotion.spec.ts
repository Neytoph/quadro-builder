import { expect, test } from '@playwright/test'

for (const touch of [false, true]) {
  test(`选中轴承内的管子可平移和旋转（${touch ? '触屏' : '鼠标'}）`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      hasTouch: touch, isMobile: touch,
      baseURL,
    })
    try {
      const page = await context.newPage()
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
          const left = model.addNode(0, 50, 0), right = model.addNode(40, 50, 0)
          model.addTube(left.id, right.id, 'T35', 'blue', 35)
          const bearings = [left, right].map(n => model.addBearingAtArm(n.id, [0, 1, 0])!)
          const a = model.addNode(-20, 60, 0), b = model.addNode(60, 60, 0)
          const shaft = model.addTube(a.id, b.id, 'T75', 'green', 75)!
          const spoke = model.addNode(60, 60, 20)
          model.addTube(b.id, spoke.id, 'T15', 'red', 15)
          model.noteBearingTube(left.id, shaft.id)
          return { shaft: shaft.id, a: a.id, spoke: spoke.id, supports: [left.id, right.id], bearings: bearings.map(f => f.id) }
        })
        builder.setMode('select')
        scene.setBackground('blank')
        builder.refresh()
        scene.releaseLoadGate()
        scene.resetCamera(model, { animate: false })
        return ids
      })
      await page.waitForFunction(() => window.__quadroDev.scene.meshesReady())
      const point = () => page.evaluate(id => {
        const { scene, model, builder } = window.__quadroDev
        scene._finishMotion()
        scene.buildGroup.updateWorldMatrix(true, true)
        const a = model.nodePos(id)
        const [x, y] = scene.screenPoint([a[0] + 8, a[1], a[2]])
        const next = scene.screenPoint([a[0] + 13, a[1], a[2]])
        return { x, y, dx: next[0] - x, dy: next[1] - y, picked: builder._pickSelect(x, y, false)?.data.id }
      }, ids.a)
      const read = () => page.evaluate(ids => {
        const { model } = window.__quadroDev
        const saved = model.toJSON()
        const pos = (id: string) => {
          const node = saved.nodes.find(n => n.id === id)!
          return [node.x, node.y, node.z]
        }
        return { a: pos(ids.a), spoke: pos(ids.spoke), fixed: ids.supports.map(pos),
          bearings: saved.fittings.filter(f => ids.bearings.includes(f.id)) }
      }, ids)
      const initial = await read()
      const p = await point()
      expect(p.picked).toBe(ids.shaft)
      if (touch) await page.touchscreen.tap(p.x, p.y)
      else await page.mouse.click(p.x, p.y)
      const guide = page.getByRole('region', { name: '轴承座 · 调整' })
      await expect(guide).toBeVisible()
      const press = (name: string) => {
        const button = guide.getByRole('button', { name, exact: true })
        return touch ? button.tap() : button.click()
      }
      await press('沿管平移')
      const cdp = touch ? await context.newCDPSession(page) : null
      const drag = async (x: number, y: number, dx: number, dy: number) => {
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
          for (let i = 1; i <= 6; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] })
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } else {
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + dx, y + dy, { steps: 6 })
          await page.mouse.up()
        }
      }
      await drag(p.x, p.y, p.dx, p.dy)
      const slid = await read()
      expect(slid.a[0] - initial.a[0]).toBeGreaterThan(3)
      expect(slid.a[0] - initial.a[0]).toBeLessThan(7)
      expect(slid.a.slice(1)).toEqual(initial.a.slice(1))
      expect(slid.fixed).toEqual(initial.fixed)
      expect(slid.bearings).toEqual(initial.bearings)
      await press('旋转')
      const q = await point()
      expect(q.picked).toBe(ids.shaft)
      await drag(q.x, q.y, -q.dy * 4, q.dx * 4)
      const rotated = await read()
      expect(rotated.a).toEqual(slid.a)
      expect(rotated.spoke.slice(1)).not.toEqual(slid.spoke.slice(1))
      expect(rotated.fixed).toEqual(initial.fixed)
      expect(rotated.bearings).toEqual(initial.bearings)
      await page.evaluate(() => window.__quadroDev.builder.undo())
      expect(await read()).toEqual(slid)
      await page.evaluate(() => window.__quadroDev.builder.redo())
      expect(await read()).toEqual(rotated)
      await press('沿管平移')
      await expect(guide.getByRole('status')).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath(touch ? 'touch.png' : 'desktop.png') })
      if (touch) await press('沿管后移 5 cm')
      else await page.keyboard.press('ArrowLeft')
      expect((await read()).a[0]).toBeCloseTo(rotated.a[0] - 5, 2)
    } finally {
      await context.close()
    }
  })
}
