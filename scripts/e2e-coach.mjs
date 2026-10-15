// 共享方案提示气泡联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110）里走一遍。
// 运行：./scripts/build-hosted.sh，再 node scripts/e2e-coach.mjs。截图存到 SHOTS（默认 ../qb-shots），文件名 coach-*。
// 账号自己注册（cc<时间>-owner、-member、-outsider）。创建人先开启共享建一个新方案（他自己的气泡事先记成看过），
// 之后每个人用一个干净的浏览器上下文第一次打开它。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const GW = process.env.GW || 'http://localhost:9111'
const RUN = `cc${Date.now().toString(36)}`
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'
const MEMBER_KEY = 'quadro.builder.collab-coach.v1'
const GUEST_KEY = 'quadro.builder.collab-coach-guest.v1'

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}coach-${name}.png` })

const browser = await chromium.launch()
const pages = []

const registered = new Set()

/** user 为 null 是没登录的访客；第一次用到某个账号时注册，之后的浏览器上下文直接登录 */
async function person(user, { seen = false, viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ baseURL: SITE, viewport, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript((keys) => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
    for (const k of keys) localStorage.setItem(k, '1')
  }, seen ? [MEMBER_KEY, GUEST_KEY] : [])
  if (!user) return ctx
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
  return ctx
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

const coach = (page) => page.locator('[data-ui=collab-coach]')
const title = (page) => page.locator('#collab-coach-title')
const stepOf = async (page) => Number(await coach(page).getAttribute('data-step'))

/** 等气泡走到第 n 步并停稳（光圈滑过去、抽屉进场） */
async function atStep(page, n) {
  await page.locator(`[data-ui=collab-coach][data-step="${n}"]`).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(600)
}

/** 光圈（四块遮罩中间挖空的那块）滑到位以后是不是正好套住某个元素；抽屉进场加光圈滑动一共一秒多 */
async function ringAround(page, selector) {
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel)
      const ring = [...document.querySelectorAll('[data-ui=collab-coach] .m-spot')].find(d => d.className.includes('rounded-2xl'))
      if (!el || !ring) return false
      const a = el.getBoundingClientRect()
      const b = ring.getBoundingClientRect()
      return Math.abs(a.left - 8 - b.left) < 2 && Math.abs(a.top - 8 - b.top) < 2
        && Math.abs(a.width + 16 - b.width) < 2 && Math.abs(a.height + 16 - b.height) < 2
    }, selector, { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/** 气泡整个在屏幕里、没压住被指的东西 */
async function cardClear(page, selector) {
  return page.evaluate((sel) => {
    const card = document.querySelector('[data-ui=collab-coach] .m-card').getBoundingClientRect()
    const inView = card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight
    if (!sel) return inView
    const t = document.querySelector(sel).getBoundingClientRect()
    const overlap = card.left < t.right && card.right > t.left && card.top < t.bottom && card.bottom > t.top
    return inView && !overlap
  }, selector)
}

/** 评论抽屉关上（它先演一段离场，再从页面上拿掉） */
async function paneClosed(page) {
  try {
    await page.locator('[data-ui=comments-pane]').waitFor({ state: 'detached', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

const seenKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key)

async function noCoachAfterReload(page, label) {
  await page.reload()
  await page.locator('#canvas-host canvas').first().waitFor({ timeout: 30_000 })
  await page.locator('[data-ui=sync-state][data-conn=connected]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2000)
  check(label, await coach(page).count() === 0)
}

try {
  await run()
} catch (err) {
  for (const [i, p] of pages.entries()) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}coach-fail-${i}.png` })
  throw err
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
  // —— 准备：创建人搭一座、开启共享，拿一条邀请链接 ——
  const ownerCtx = await person('owner', { seen: true })
  const owner = await open(ownerCtx, '/builder/')
  await owner.locator('#canvas-host canvas').click({ position: { x: 720, y: 500 } })
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp']) { await owner.keyboard.press(k); await owner.waitForTimeout(120) }
  await owner.locator('[data-ui=share-enable]').click()
  await owner.locator('[data-ui=enable-share-go]').click()
  await owner.getByRole('dialog').locator('input').fill(`提示气泡 ${Date.now().toString(36)}`)
  await owner.keyboard.press('Enter')
  await owner.locator('[data-ui=plan-share]').waitFor({ timeout: 15_000 })
  await owner.waitForFunction(() => new URLSearchParams(location.search).get('plan'))
  const planId = new URL(owner.url()).searchParams.get('plan')
  await owner.locator('[data-ui=sync-state][data-conn=connected]').waitFor()
  await owner.waitForTimeout(1500)
  check('事先记成看过的人，开启共享以后不出气泡', await coach(owner).count() === 0)
  const [res] = await Promise.all([
    owner.waitForResponse((r) => r.url().includes('/invites') && r.request().method() === 'POST'),
    owner.locator('[data-ui=plan-share]').click(),
  ])
  const invite = new URL((await res.json()).url)
  await owner.keyboard.press('Escape')
  // 留言区里有一条，第二步看得出是留言区
  const threads = await (await ownerCtx.request.get(`/quadro/collab/plans/${planId}/threads`)).json()
  const chat = threads.threads.find((th) => th.kind === 'chat')
  await ownerCtx.request.post(`/quadro/collab/threads/${chat.id}/posts`, { data: { body: '周六上午上门量一次房，可以吗？', photos: [], refs: [] } })

  // —— 1. 成员第一次打开：三步，走完「知道了」——
  const memberCtx = await person('member')
  const member = await open(memberCtx, `${invite.pathname}${invite.search}`)
  await atStep(member, 1)
  check('成员第一次打开，出第 1 步「点零件写意见」', (await title(member).textContent()) === '点零件写意见')
  check('第 1 步的进度是 1/3', (await coach(member).textContent()).includes('共享方案 · 1/3'))
  check('第 1 步光圈套住工具条上的「评论」工具', await ringAround(member, '[data-tour=tool-comment]'))
  check('第 1 步的气泡没压住「评论」工具', await cardClear(member, '[data-tour=tool-comment]'))
  check('第 1 步没有「上一步」', await member.locator('[data-ui=coach-back]').count() === 0)
  await shot(member, '1-pin')

  await member.locator('[data-ui=coach-next]').click()
  await atStep(member, 2)
  check('第 2 步标题「留言区在右边」', (await title(member).textContent()) === '留言区在右边')
  check('第 2 步替人打开评论抽屉', await member.locator('[data-ui=comments-pane]').isVisible())
  check('评论抽屉切到「留言」', (await member.locator('[data-ui=comments-tab-chat]').getAttribute('class')) === 'on')
  check('留言区里看得到那一条', await member.locator('[data-ui=chat]').getByText('周六上午上门量一次房').isVisible())
  check('第 2 步光圈套住整个抽屉', await ringAround(member, '[data-tour=dock-panel]'))
  check('第 2 步的气泡在抽屉左边、不压住抽屉', await cardClear(member, '[data-tour=dock-panel]'))
  await shot(member, '2-chat')

  await member.locator('[data-ui=coach-back]').click()
  await atStep(member, 1)
  check('「上一步」回到第 1 步，抽屉关回去', await paneClosed(member))
  await member.locator('[data-ui=coach-next]').click()
  await atStep(member, 2)
  await member.locator('[data-ui=coach-next]').click()
  await atStep(member, 3)
  check('第 3 步「两个版本左右对照」', (await title(member).textContent()) === '两个版本左右对照')
  check('第 3 步抽屉关回去', await paneClosed(member))
  check('第 3 步光圈套住顶栏「版本」', await ringAround(member, '[data-tour=dock-versions]'))
  check('第 3 步的气泡没压住「版本」', await cardClear(member, '[data-tour=dock-versions]'))
  check('最后一步的按钮是「知道了」', (await member.locator('[data-ui=coach-next]').textContent()) === '知道了')
  await shot(member, '3-versions')

  await member.locator('[data-ui=coach-next]').click()
  await coach(member).waitFor({ state: 'detached' })
  check('按「知道了」气泡关掉，记下看过', await seenKey(member, MEMBER_KEY) === '1')
  check('成员看过不记访客那一份', await seenKey(member, GUEST_KEY) === null)
  await noCoachAfterReload(member, '成员第二次打开不再出')
  await shot(member, '4-member-again')

  // —— 2. 跳过：创建人换一个干净的浏览器打开 ——
  const skipCtx = await person('owner')
  const skipper = await open(skipCtx, `/builder/?plan=${planId}`)
  await atStep(skipper, 1)
  check('创建人第一次打开也出三步', (await coach(skipper).textContent()).includes('共享方案 · 1/3'))
  await skipper.locator('[data-ui=coach-next]').click()
  await atStep(skipper, 2)
  await skipper.locator('[data-ui=coach-skip]').click()
  await coach(skipper).waitFor({ state: 'detached' })
  check('第 2 步点「跳过」，气泡关掉', true)
  check('跳过时把第 2 步打开的抽屉关回去', await paneClosed(skipper))
  check('跳过也记下看过', await seenKey(skipper, MEMBER_KEY) === '1')
  await noCoachAfterReload(skipper, '跳过以后再打开不出')

  // —— 3. 没登录的访客：两步，第一步「登录后可以写意见」——
  const visitorCtx = await person(null)
  const visitor = await open(visitorCtx, `/builder/?plan=${planId}`)
  await atStep(visitor, 1)
  check('访客第 1 步「登录后可以写意见」', (await title(visitor).textContent()) === '登录后可以写意见')
  check('访客的进度是 1/2', (await coach(visitor).textContent()).includes('共享方案 · 1/2'))
  check('访客第 1 步光圈套住只读横条', await ringAround(visitor, '[data-tour=read-only-banner]'))
  check('访客第 1 步的气泡没压住只读横条', await cardClear(visitor, '[data-tour=read-only-banner]'))
  const login = visitor.locator('[data-tour=read-only-banner] a')
  check('光圈里的登录按钮指向登录页并带回这个方案', (await login.getAttribute('href')).startsWith('/login?next=') && (await login.getAttribute('href')).includes(planId))
  await shot(visitor, '5-visitor-login')
  await visitor.locator('[data-ui=coach-next]').click()
  await atStep(visitor, 2)
  check('访客第 2 步是留言区', (await title(visitor).textContent()) === '留言区在右边')
  check('访客第 2 步就是最后一步，按钮是「知道了」', (await visitor.locator('[data-ui=coach-next]').textContent()) === '知道了')
  check('访客的留言区也打开到「留言」', (await visitor.locator('[data-ui=comments-tab-chat]').getAttribute('class')) === 'on')
  await shot(visitor, '6-visitor-chat')
  await visitor.locator('[data-ui=coach-next]').click()
  await coach(visitor).waitFor({ state: 'detached' })
  check('访客看完记在访客那一份', await seenKey(visitor, GUEST_KEY) === '1' && await seenKey(visitor, MEMBER_KEY) === null)
  await noCoachAfterReload(visitor, '访客第二次打开不再出')

  // —— 4. 登录了但不是成员：第一步换成请人发邀请链接 ——
  const outsiderCtx = await person('outsider')
  const plan = await (await outsiderCtx.request.get(`/quadro/collab/plans/${planId}`)).json()
  assert.equal(plan.myRole, 'guest', '这个人不是方案的成员')
  const outsider = await open(outsiderCtx, `/builder/?plan=${planId}`)
  await atStep(outsider, 1)
  check('非成员第 1 步「加入方案后可以写意见」', (await title(outsider).textContent()) === '加入方案后可以写意见')
  check('非成员第 1 步说请人发邀请链接', (await coach(outsider).textContent()).includes('请方案里的人发邀请链接给你'))
  check('非成员第 1 步光圈套住只读横条', await ringAround(outsider, '[data-tour=read-only-banner]'))
  await shot(outsider, '7-outsider-join')
  // —— 4b. 这个人后来用邀请链接加入：还会看到一次完整的三步 ——
  await outsider.locator('[data-ui=coach-next]').click()
  await atStep(outsider, 2)
  await outsider.locator('[data-ui=coach-next]').click()
  await coach(outsider).waitFor({ state: 'detached' })
  await outsider.goto(`${invite.pathname}${invite.search}`)
  await atStep(outsider, 1)
  check('访客看过以后加入成为成员，还会看到完整的三步', (await coach(outsider).textContent()).includes('共享方案 · 1/3'))
  await outsider.keyboard.press('Escape')
  await coach(outsider).waitFor({ state: 'detached' })
  check('按 Esc 关掉也记下看过', await seenKey(outsider, MEMBER_KEY) === '1')

  // —— 5. 手机宽度：工具条横着划，先把「评论」划进来；第二步标题「在下面」——
  const phoneCtx = await person('member', { viewport: { width: 390, height: 844 } })
  const phone = await open(phoneCtx, `/builder/?plan=${planId}`)
  await atStep(phone, 1)
  check('手机上第 1 步的「评论」工具划进视野、光圈套住它', await ringAround(phone, '[data-tour=tool-comment]') && await phone.evaluate(() => {
    const r = document.querySelector('[data-tour=tool-comment]').getBoundingClientRect()
    return r.left >= 0 && r.right <= innerWidth
  }))
  check('手机上第 1 步的气泡在屏幕里', await cardClear(phone, '[data-tour=tool-comment]'))
  await shot(phone, '8-phone-pin')
  await phone.locator('[data-ui=coach-next]').click()
  await atStep(phone, 2)
  check('手机上第 2 步标题「留言区在下面」', (await title(phone).textContent()) === '留言区在下面')
  check('手机上第 2 步的气泡在屏幕里', await cardClear(phone, null))
  await shot(phone, '9-phone-chat')
  await phone.locator('[data-ui=coach-next]').click()
  await atStep(phone, 3)
  check('手机上第 3 步光圈套住「版本」', await ringAround(phone, '[data-tour=dock-versions]'))
  check('手机上第 3 步的气泡在屏幕里', await cardClear(phone, '[data-tour=dock-versions]'))
  await shot(phone, '10-phone-versions')
  assert.equal(await stepOf(phone), 3)
}
