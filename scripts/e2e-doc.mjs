// ?doc=<doc id> 联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110、网关 9111）里走一遍。
// 运行：./scripts/build-hosted.sh，再 node scripts/e2e-doc.mjs。截图存到 SHOTS（默认 ../qb-shots），文件名 doc-*。
// 账号自己注册（dc<时间>-owner、-other）：造型的主人存两座，一座开启共享；
// 同一个浏览器、换一个浏览器、别人、没登录的访客分别用 ?doc= 打开。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const GW = process.env.GW || 'http://localhost:9111'
const RUN = `dc${Date.now().toString(36)}`
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}doc-${name}.png` })

const browser = await chromium.launch()
const pages = []
const registered = new Set()

async function person(user) {
  const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.builder.collab-coach.v1', '1')
    localStorage.setItem('quadro.builder.collab-coach-guest.v1', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  if (user) await signIn(ctx, user)
  return ctx
}

async function signIn(ctx, user) {
  const username = `${RUN}-${user}`
  const email = `${username}@qinghe.test`
  if (!registered.has(user)) {
    const r = await ctx.request.post(GW + '/register', {
      headers: { Accept: 'application/json' },
      form: { email, email_code: '000000', username, password: PASS, password2: PASS },
    })
    assert.ok(r.ok(), `注册 ${username}：${r.status()} ${await r.text()}`)
    registered.add(user)
  }
  const s = await ctx.request.post('/signin', { form: { identifier: email, password: PASS } })
  assert.equal(s.status(), 200, `登录 ${username}`)
}

async function open(ctx, path) {
  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (e) => { console.error('pageerror', e.message, e.stack); process.exitCode = 1 })
  page.on('response', (r) => { if (r.status() >= 500) console.error('HTTP', r.status(), r.request().method(), r.url()) })
  await page.goto(path)
  await page.locator('#canvas-host canvas').first().waitFor({ timeout: 30_000 })
  return page
}

const activeTab = (page) => page.locator('.m-tab.border-teal-500')

/** 处理完 ?doc=：地址栏去掉 doc（同步跑完一轮以后才去掉） */
const handled = (page) => page.waitForFunction(() => !new URLSearchParams(location.search).has('doc'), null, { timeout: 30_000 })

/** 当前标签页换成这个名字 */
async function activeIs(page, name, label) {
  try {
    await activeTab(page).filter({ hasText: name }).waitFor({ timeout: 20_000 })
  } catch {
    throw new Error(`等不到：${label}（现在是「${await activeTab(page).textContent()}」）`)
  }
}

/** 搭几根管、Ctrl+S 起名存下来，等它同步上服务端，返回 doc id */
async function buildAndSave(ctx, page, name) {
  await page.locator('#canvas-host canvas').click({ position: { x: 720, y: 500 } })
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k); await page.waitForTimeout(120) }
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByRole('dialog').locator('input').fill(name)
  await page.keyboard.press('Enter')
  await page.getByText(`已保存「${name}」`).waitFor()
  for (let i = 0; i < 100; i++) {
    const r = await ctx.request.get('/quadro/models?since=0')
    const item = (await r.json()).items.find((d) => d.name === name && !d.deletedAt)
    if (item) return item.id
    await page.waitForTimeout(300)
  }
  throw new Error(`等不到：「${name}」同步上服务端`)
}

try {
  await run()
} catch (err) {
  for (const [i, p] of pages.entries()) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}doc-fail-${i}.png` })
  throw err
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
  // —— 准备：主人存两座，第二座开启共享 ——
  const ownerCtx = await person('owner')
  const owner = await open(ownerCtx, '/builder/')
  const name1 = `${RUN} 客厅小屋`
  const docId = await buildAndSave(ownerCtx, owner, name1)
  await owner.getByRole('button', { name: '+', exact: true }).click()
  const name2 = `${RUN} 共享的一座`
  const sharedId = await buildAndSave(ownerCtx, owner, name2)
  await owner.locator('[data-ui=share-enable]').click()
  await owner.locator('[data-ui=enable-share-go]').click()
  await owner.locator('[data-ui=plan-share]').waitFor({ timeout: 15_000 })
  await owner.waitForFunction((id) => new URLSearchParams(location.search).get('plan') === id, sharedId)
  // 再开一个空白标签页当前台：?doc= 打开时要切过去
  await owner.getByRole('button', { name: '+', exact: true }).click()
  await owner.waitForTimeout(1200)
  await owner.close()
  console.log(`造型 ${docId}，共享的一座 ${sharedId}`)

  // —— 1. 同一个浏览器：本机就有，切到它的标签页 ——
  const same = await open(ownerCtx, '/builder/')
  await same.getByRole('button', { name: '+', exact: true }).click()
  await same.waitForTimeout(300)
  check('打开之前前台是新开的空白标签页', !(await activeTab(same).textContent()).includes(name1))
  await same.evaluate((url) => { location.href = url }, `/builder/?doc=${docId}`)
  await same.waitForURL(/\?doc=/)
  await handled(same)
  check('打开以后地址栏去掉 doc', true)
  await activeIs(same, name1, '切到这一座的标签页')
  check('同一个浏览器：切到这一座的标签页', true)
  check('这一座只开了一个标签页', await same.locator('.m-tab').filter({ hasText: name1 }).count() === 1)
  await shot(same, '1-same-browser')
  await same.close()

  // —— 2. 换一个浏览器（本机什么都没有）：同步跑完一轮以后打开 ——
  const freshCtx = await person('owner')
  const fresh = await open(freshCtx, `/builder/?doc=${docId}`)
  await handled(fresh)
  await activeIs(fresh, name1, '换一个浏览器也打开这一座')
  check('换一个浏览器：从 /models 拉下来打开', true)
  check('换一个浏览器：画面上有这一座（逐层拼装有步数）', await fresh.locator('[data-tour=assembly]').first().isVisible())
  await shot(fresh, '2-fresh-browser')

  // —— 3. 开启过共享的一座：打开方案标签页 ——
  await fresh.goto(`/builder/?doc=${sharedId}`)
  await fresh.locator(`[data-plan-tab="${sharedId}"].border-teal-500`).waitFor({ timeout: 20_000 })
  check('开启过共享的一座打开方案标签页', true)
  await fresh.waitForFunction((id) => new URLSearchParams(location.search).get('plan') === id, sharedId)
  check('地址栏换成方案地址', !new URL(fresh.url()).searchParams.has('doc'))
  await fresh.locator('[data-ui=sync-state][data-conn=connected]').waitFor({ timeout: 30_000 })
  await shot(fresh, '3-shared-plan')

  // —— 4. 别人的：找不到这座造型 ——
  const otherCtx = await person('other')
  const other = await open(otherCtx, `/builder/?doc=${docId}`)
  const toast = other.getByText('找不到这座造型')
  await toast.waitFor({ timeout: 20_000 })
  check('别人的造型：提示「找不到这座造型」', await toast.isVisible())
  check('别人的造型：没有打开它的标签页', await other.locator('.m-tab').filter({ hasText: name1 }).count() === 0)
  await shot(other, '4-not-mine')
  await other.goto('/builder/?doc=nosuchdoc')
  await other.getByText('找不到这座造型').waitFor({ timeout: 20_000 })
  check('不存在的 id：提示「找不到这座造型」', true)

  // —— 5. 没登录：跳登录页，带着这个地址回来 ——
  const anonCtx = await person(null)
  const anon = await anonCtx.newPage()
  pages.push(anon)
  await anon.goto(`/builder/?doc=${docId}`)
  await anon.waitForURL(/\/login\?/, { timeout: 30_000 })
  const next = new URL(anon.url()).searchParams.get('next')
  check('没登录跳到登录页', true)
  check(`登录页的 next 是原来的地址（${next}）`, next === `/builder/?doc=${docId}`)
  await shot(anon, '5-login')
  await signIn(anonCtx, 'owner')
  await anon.goto(next)
  await anon.locator('#canvas-host canvas').first().waitFor({ timeout: 30_000 })
  await activeIs(anon, name1, '登录以后回来打开这一座')
  check('登录以后回到这个地址，打开这一座', true)
  await shot(anon, '6-after-login')
}
