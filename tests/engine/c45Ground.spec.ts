import { test, expect } from '@playwright/test'

// 在隔离模型上使用真实编辑器、画布拾取与撤销，不读写账户模型。
for (const width of [1280, 390]) {
  test(`贴地管口点击放置45度件并连续旋转 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('quadro.builder.onboarded.v2', '1')
      localStorage.setItem('quadro-builder-lang', 'zh')
    })
    await page.goto('/')
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
    const ids = await page.evaluate(() => {
      const { model, builder, scene } = window.__quadroDev
      model.clear()
      const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0)
      model.addTube(a.id, b.id, 'T35', 'blue', 35)
      builder.setMode('c45')
      builder.selectedNodeId = a.id
      scene.setBackground('blank')
      builder.refresh()
      scene.releaseLoadGate()
      scene.resetCamera(model, { animate: false })
      return { a: a.id, b: b.id }
    })
    await page.waitForFunction(() => window.__quadroDev.scene.meshesReady())
    const point = await page.evaluate(() => {
      const { scene } = window.__quadroDev
      scene._finishMotion()
      scene.handleGroup.updateWorldMatrix(true, true)
      const handle = scene.handleMeshes.find((m: any) => m.userData.inTube)
      if (!handle) throw new Error('贴地管口没有安装入口')
      const p = handle.getWorldPosition(handle.position.clone())
      const [x, y] = scene.screenPoint([p.x, p.y, p.z])
      return { x, y }
    })
    await page.mouse.click(point.x, point.y)
    const read = () => page.evaluate((ids) => {
      const { model } = window.__quadroDev
      const body = model.nodes.get(ids.a)!
      const base = [...model.nodes.values()].find((n: any) => n.id !== ids.a && n.id !== ids.b)
      return { placed: !!body.c45body, base: base && [base.x, base.y, base.z],
        fixed: [model.nodePos(ids.a), model.nodePos(ids.b)],
        below: [...model.nodes.values()].some((n: any) => model.isBelowGround(n.y)) }
    }, ids)
    const placed = await read()
    expect(placed.placed).toBe(true)
    expect(placed.below).toBe(false)
    for (let i = 0; i < 4; i++) {
      const previous = await read()
      await page.waitForFunction(() => window.__quadroDev.scene.meshesReady())
      const click = await page.evaluate(ids => {
        const { model, scene } = window.__quadroDev
        scene._finishMotion()
        scene.buildGroup.updateWorldMatrix(true, true)
        const base = [...model.nodes.values()].find((n: any) => n.id !== ids.a && n.id !== ids.b)!
        const body = model.nodes.get(ids.a)!
        const [x, y] = scene.screenPoint([(base.x + body.x) / 2, (base.y + body.y) / 2, (base.z + body.z) / 2])
        for (const dx of [0, -4, 4, -8, 8, -12, 12, -24, 24, -48, 48]) {
          for (const dy of [0, -4, 4, -8, 8, -12, 12, -24, 24, -48, 48]) {
            const hit = scene.pickForDelete(x + dx, y + dy)
            if (hit?.data.kind === 'node' && [ids.a, base.id].includes(hit.data.id))
              return { x: x + dx, y: y + dy }
          }
        }
        throw new Error('45度件没有可点击的接头表面')
      }, ids)
      await page.mouse.click(click.x, click.y)
      await expect.poll(async () => (await read()).base).not.toEqual(previous.base)
      const next = await read()
      expect(next.below).toBe(false)
      expect(next.fixed).toEqual([[0, 0, 0], [40, 0, 0]])
    }
    await page.screenshot({ path: test.info().outputPath(`c45-ground-${width}.png`) })
    expect(errors).toEqual([])
  })
}
