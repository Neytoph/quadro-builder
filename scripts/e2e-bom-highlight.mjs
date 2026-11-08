// 启动 Vite 后，使用 BASE=http://localhost:5239/ node scripts/e2e-bom-highlight.mjs。
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile,
    })
    await context.addInitScript(() => {
      localStorage.setItem('quadro.builder.onboarded.v2', '1')
      localStorage.setItem('quadro.lang', 'zh')
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.BASE || 'http://localhost:5239/')
    await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('canvas'))
    const dock = page.locator('[data-ui="right-dock"][data-pane="bom"]')
    const openBom = async () => {
      if (mobile) {
        await page.locator('[data-ui="mobile-tools-menu"]').tap()
        await page.locator('.qb-mobile-menu-item[data-pane="bom"]').tap()
      } else {
        await page.locator('button[data-pane="bom"]').click()
      }
      await dock.waitFor()
    }
    await openBom()
    const parts = await page.evaluate(() => {
      const { builder, model, scene } = window.__quadroDev
      const tube = (x, z, len, color = 'blue') => {
        const a = model.addNode(x, 50, z), b = model.addNode(x + len + 5, 50, z)
        return model.addTube(a.id, b.id, 'T' + len, color, len)
      }
      builder.setMode('select')
      const ids = builder.recordHistory(() => {
        model.clear()
        const a = tube(0, 0, 35), b = tube(0, 40, 35)
        const c = tube(80, 0, 75, 'red'), d = tube(80, 40, 75, 'red')
        const double = model.addClamp(10, 50, 0)
        const legacy = model.addClamp(20, 50, 0)
        delete legacy.connectorId
        const clip = model.addClamp(30, 50, 0, 'tube_clamp')
        const fabric = model.addTextile(a.id, b.id, 0, 40, 'green')
        const long = model.addTextile(c.id, d.id, 0, 80, 'green')
        const bridge = model.addBridge(b.id, d.id)
        const shortRail = tube(0, 95, 15), oppositeRail = tube(0, 135, 15)
        const short = model.addTextile(shortRail.id, oppositeRail.id, 0, 20, 'green')
        const flexi = model.addFlexiJoint(shortRail.b)
        const tie = model.ropeDiagnostics({ tube: c.id, t: .5 }, { tube: d.id, t: .5 }, 'strap')
        const strap = model.addConfirmedComponent(tie, 'blue')
        const roll = model.addFitting('sleeve', 0, 0, 0)
        const longRoll = model.addFitting('sleeve', 0, 0, 0)
        roll.tube = a.id
        longRoll.tube = c.id
        const slide = model.addSlide([40, 85, 110], [0, 0, 1])
        const slideKinds = [
          'slide-domestic80', 'slide-domestic60', 'slide-domestic-integral60', 'slide-domestic-integral80',
          'slide-domestic-classic60', 'slide-domestic-classic80', 'curved-slide-domestic80',
        ]
        const domesticSlides = slideKinds.map((kind, i) => {
          const part = model.addSlide([70 * i, 85, 290], [0, 0, 1], kind)
          const id = kind === 'curved-slide-domestic80' ? 'slide_curved_domestic80' : kind.replaceAll('-', '_')
          return [id, part.id]
        })
        const liner = model.addFitting('pool-small2', 20, 50, -200, { w: 80, h: 40, d: 120 })
        liner.balls = true
        const otherLiner = model.addFitting('pool2', 170, 50, -200, { w: 120, h: 40, d: 160 })
        const glassA = tube(220, 0, 35), glassB = tube(220, 40, 35)
        const glass = model.addPanel(glassA.id, glassB.id, 0, 40, 'panel_40x40', 'blue')
        // 旧存档把框和玻璃合存成一个板件。
        glass.panelId = 'acrylic_panel_40x40'
        delete glass.appearanceVersion
        delete glass.params
        c.reinforced = true
        return { double: [double.id, legacy.id], clip: clip.id, fabric: fabric.id, long: long.id, short: short.id,
          flexi: flexi.id, strap: strap.id, bridge: bridge.id, domesticSlides,
          roll: roll.id, longRoll: longRoll.id, slide: slide.id, liner: liner.id,
          otherLiner: otherLiner.id, glass: glass.id, reinforced: c.id }
      })
      builder.refresh()
      scene.frameFromYaw(model, 0, { silent: true, margin: 1.1 })
      return ids
    })
    await dock.locator('[data-part-id="double_tube"]').waitFor()
    await page.waitForFunction(() => window.__quadroDev.scene.pickClamps.length > 0)

    // 从真实场景读取橙色网格，兼容普通网格和批量绘制的实例。
    const marked = () => page.evaluate(() => {
      const { scene } = window.__quadroDev
      const orange = new Set(Object.entries(scene._materials).filter(([key]) => key.startsWith('sel:')).map(([, mat]) => mat))
      const ids = new Set()
      scene.buildGroup.traverse(mesh => {
        if (!mesh.visible || !orange.has(mesh.material)) return
        for (const data of mesh.userData.instances || [mesh.userData]) {
          if (!data?.id) continue
          let suffix = ''
          if (data.role === 'water') suffix = ':balls'
          else if (data.hinge != null) suffix = '#' + data.hinge
          ids.add(data.id + suffix)
        }
      })
      return [...ids].sort()
    })
    const pick = async (id, expected, name) => {
      const matching = dock.locator(`[data-ui="bom-part-row"][data-part-id="${id}"]`)
      const row = name ? matching.and(dock.getByRole('button', { name })) : matching
      if (mobile) await row.tap()
      else await row.click()
      assert.deepEqual(await marked(), expected.sort(), id)
      return row
    }
    const double = await pick('double_tube', parts.double)
    if (mobile) {
      await dock.waitFor({ state: 'hidden' })
      await openBom()
      await double.tap()
      await dock.waitFor({ state: 'hidden' })
      assert.deepEqual(await marked(), [])
    } else {
      await double.click()
      assert.deepEqual(await marked(), [])
      await pick('double_tube', parts.double)
      await page.keyboard.press('Escape')
      assert.deepEqual(await marked(), [])
      await openBom()
      await pick('double_tube', parts.double)
      await pick('tube_clamp', [parts.clip])
      await pick('flexi_bolt', [parts.flexi])
      await pick('flexi_hinge', [parts.flexi + '#0', parts.flexi + '#1'])
      await pick('textile', [parts.fabric], /35×35/)
      await pick('textile', [parts.long], /75×35/)
      await pick('textile_20x40', [parts.short])
      await pick('strap', [parts.strap])
      await pick('sleeve|35', [parts.roll])
      await pick('sleeve|75', [parts.longRoll])
      await pick('slide_integral', [parts.slide])
      for (const [id, part] of parts.domesticSlides) await pick(id, [part])
      await pick('pool_liner_s', [parts.liner])
      await pick('pool_liner_l', [parts.otherLiner])
      await pick('balls', [parts.liner + ':balls'])
      await pick('acrylic_glass', [parts.glass])
      assert.equal(await page.evaluate(() => {
        const { scene } = window.__quadroDev
        const glass = scene._materials['sel:' + scene._materials.glass.uuid]
        return scene.pickPanels.filter(mesh => mesh.material === glass).length
      }), 1)
      await pick('reinforce80', [parts.reinforced])
      await page.getByRole('button', { name: '仅显示框架' }).click()
      await pick('textile_bridge', [parts.bridge])
      const slide = await pick('slide_integral', [parts.slide])
      await slide.click()
      assert.deepEqual(await marked(), [])
      assert.equal(await page.evaluate(() => window.__quadroDev.scene.pickSlides.length), 0)
    }
    assert.deepEqual(errors, [])
    console.log(`零件清单定位通过（${mobile ? '手机触屏' : '桌面'}）`)
    await context.close()
  }
} finally {
  await browser.close()
}
