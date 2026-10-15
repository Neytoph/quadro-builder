// ?new=1 联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110、网关 9111）里走一遍。
// 运行：./scripts/build-hosted.sh，再 node scripts/e2e-new.mjs。截图存到 SHOTS（默认 ../qb-shots），文件名 new-*。
// 账号自己注册（nw<时间>-owner）：先存一座、再开启共享一座，然后用 ?new=1 打开。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const GW = process.env.GW || 'http://localhost:9111'
const RUN = `nw${Date.now().toString(36)}`
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}new-${name}.png` })

const browser = await chromium.launch()
const pages = []

try {
  await run()
} catch (err) {
  for (const [i, p] of pages.entries()) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}new-fail-${i}.png` })
  throw err
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
  const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.builder.collab-coach.v1', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  const username = `${RUN}-owner`
  const r = await ctx.request.post(GW + '/register', {
    headers: { Accept: 'application/json' },
    form: { email: `${username}@qinghe.test`, email_code: '000000', username, password: PASS, password2: PASS },
  })
  assert.ok(r.ok(), `注册：${r.status()} ${await r.text()}`)
  assert.equal((await ctx.request.post('/signin', { form: { identifier: `${username}@qinghe.test`, password: PASS } })).status(), 200)

  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (e) => { console.error('pageerror', e.message, e.stack); process.exitCode = 1 })
  page.on('response', (res) => { if (res.status() >= 500) console.error('HTTP', res.status(), res.request().method(), res.url()) })
  const ready = () => page.locator('#canvas-host canvas').first().waitFor({ timeout: 30_000 })
  const tabs = () => page.locator('.m-tab').allTextContents()
  const active = () => page.locator('.m-tab.border-teal-500').textContent()

  // —— 准备：存一座，再新开一页搭一座开启共享 ——
  await page.goto('/builder/')
  await ready()
  const build = async () => {
    await page.locator('#canvas-host canvas').click({ position: { x: 720, y: 500 } })
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k); await page.waitForTimeout(120) }
  }
  await build()
  const name1 = `${RUN} 客厅小屋`
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByRole('dialog').locator('input').fill(name1)
  await page.keyboard.press('Enter')
  await page.getByText(`已保存「${name1}」`).waitFor()
  await page.getByRole('button', { name: '+', exact: true }).click()
  await build()
  await page.locator('[data-ui=share-enable]').click()
  await page.locator('[data-ui=enable-share-go]').click()
  const name2 = `${RUN} 共享的一座`
  await page.getByRole('dialog').locator('input').fill(name2)
  await page.keyboard.press('Enter')
  await page.locator('[data-ui=plan-share]').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  const before = await tabs()
  check(`准备好两个标签页：${before.join('、')}`, before.length === 2)
  await shot(page, '1-before')

  // —— 1. ?new=1：新开一个空白标签页，已开的两个留着 ——
  await page.goto('/builder/?new=1')
  await ready()
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('new'), null, { timeout: 20_000 })
  check('处理完地址栏去掉 new', true)
  await page.locator('.m-tab').nth(2).waitFor()
  const after = await tabs()
  check(`多了一个标签页：${after.join('、')}`, after.length === 3)
  check('已开的两个都留着、顺序不变', after[0].includes(name1) && after[1].includes(name2))
  check('新开的一页是空白的「未命名」、在最后', after[2].includes('未命名'))
  check('新开的一页是前台', (await active()).includes('未命名'))
  check('前台这一页是空的：没有逐层拼装', await page.locator('[data-tour=assembly]').count() === 0)
  check('地址栏不是共享方案的地址', !new URL(page.url()).searchParams.has('plan'))
  await shot(page, '2-new-tab')

  // —— 2. 什么都没搭就刷新：不再新开；空着的「未命名」照 builder 原来的规矩不留 ——
  await page.waitForTimeout(1500)
  await page.reload()
  await ready()
  await page.waitForTimeout(2500)
  const reloaded = await tabs()
  check(`空着刷新：不再新开，回到原来两个标签页（${reloaded.join('、')}）`, reloaded.length === 2 && !reloaded.some((x) => x.includes('未命名')))
  await shot(page, '3-reload-empty')

  // —— 3. 再带一次 ?new=1，在新开的一页里搭几根，刷新：它留着，也不再多开 ——
  await page.goto('/builder/?new=1')
  await ready()
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('new'), null, { timeout: 20_000 })
  await page.locator('.m-tab').nth(2).waitFor()
  check('再带一次 ?new=1 又新开一个', (await tabs()).length === 3 && (await active()).includes('未命名'))
  await build()
  await page.waitForTimeout(1500)
  await page.reload()
  await ready()
  await page.waitForTimeout(2500)
  const kept = await tabs()
  check(`搭过的新标签页刷新以后留着，没有再多开（${kept.join('、')}）`, kept.length === 3 && kept[2].includes('未命名'))
  check('刷新以后前台还是这一页', (await active()).includes('未命名') && await page.locator('[data-tour=assembly]').count() > 0)
  await shot(page, '4-reload-built')
}
