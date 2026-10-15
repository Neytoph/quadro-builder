// 共享方案改名联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110、网关 9111）里走一遍。
// 运行：./scripts/build-hosted.sh，再 node scripts/e2e-rename.mjs。截图存到 SHOTS（默认 ../qb-shots）。
// 账号自己注册（rn-<时间>-*），站长用 dev-up 里 QH_ADMINS 那个邮箱，已经注册过就直接登录：
// 设计师提交资料、站长在后台通过、家长发需求单（参考设计师的广场方案）委派给他、设计师接单建方案，
// 再邀请一位家里人当评论者。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const GW = process.env.GW || 'http://localhost:9111'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
const QDF = fileURLToPath(new URL('../dist/qdf/A0068.qdf', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'
const RUN = `rn${Date.now().toString(36)}`

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const shot = (who, name) => who.page.screenshot({ path: `${SHOTS}rename-${name}.png` })

const browser = await chromium.launch()
const pages = []

async function person(label) {
  const ctx = await browser.newContext({ baseURL: SITE, locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.builder.collab-coach.v1', '1')
    localStorage.setItem('quadro.builder.collab-coach-guest.v1', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (e) => { console.error(`${label} pageerror`, e.message, e.stack); process.exitCode = 1 })
  page.on('response', (r) => { if (r.status() >= 500) console.error('HTTP', r.status(), r.request().method(), r.url()) })
  return { label, ctx, page }
}

async function register(who, email, username) {
  const r = await who.ctx.request.post(GW + '/register', {
    headers: { Accept: 'application/json' },
    form: { email, email_code: '000000', username, password: PASS, password2: PASS },
  })
  if (r.ok()) return
  // 站长的邮箱是固定的，这套环境里跑过一次就已经注册了
  const s = await who.ctx.request.post('/signin', { form: { identifier: email, password: PASS } })
  assert.equal(s.status(), 200, `${username} 注册失败，登录也失败`)
}

async function api(who, method, path, data) {
  const r = await who.ctx.request.fetch('/quadro' + path, {
    method, headers: { Accept: 'application/json' }, ...(data === undefined ? {} : { data }),
  })
  if (!r.ok()) throw new Error(`${who.label} ${method} ${path} → ${r.status()} ${(await r.text()).slice(0, 300)}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

async function openBuilder(who, url) {
  await who.page.goto(url)
  await who.page.locator('#canvas-host canvas').first().waitFor({ timeout: 30_000 })
}

async function openPlan(who, planId) {
  await openBuilder(who, `/builder/?plan=${planId}`)
  await who.page.locator('[data-ui=sync-state][data-conn=connected]').waitFor({ timeout: 30_000 })
}

const tabOf = (who, planId) => who.page.locator(`[data-plan-tab="${planId}"]`)
const tabName = (who, planId) => tabOf(who, planId).locator('button').first()

async function rename(who, planId, name) {
  await tabName(who, planId).dblclick()
  const input = tabOf(who, planId).locator('input')
  await input.fill(name)
  await input.press('Enter')
  await input.waitFor({ state: 'detached' })
}

async function tabShows(who, planId, name, label) {
  try {
    await tabName(who, planId).filter({ hasText: name }).waitFor({ timeout: 15_000 })
  } catch {
    throw new Error(`等不到：${label}（现在是「${await tabName(who, planId).textContent()}」）`)
  }
}

async function serverName(who, planId, name, label) {
  for (let i = 0; i < 50; i++) {
    if ((await api(who, 'GET', `/collab/plans/${planId}`)).name === name) return true
    await who.page.waitForTimeout(200)
  }
  throw new Error(`等不到：${label}`)
}

try {
  await run()
} catch (err) {
  for (const [i, p] of pages.entries()) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}rename-fail-${i}.png` })
  throw err
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
  // —— 准备：站长、设计师、家长、家里人 ——
  const admin = await person('站长')
  await register(admin, 'dev-admin@qinghe.test', 'Neytoph')
  const pro = await person('设计师')
  await register(pro, `${RUN}-pro@qinghe.test`, `${RUN}-pro`)
  const parent = await person('家长')
  await register(parent, `${RUN}-parent@qinghe.test`, `${RUN}-parent`)
  const family = await person('家里人')
  await register(family, `${RUN}-family@qinghe.test`, `${RUN}-family`)

  // 设计师在 builder 里导入一座官方造型，从发布页发到广场，当需求单的参考方案
  await openBuilder(pro, '/builder/?import=qdf')
  await pro.page.locator('input[type=file][accept=".qdf"]').setInputFiles([QDF])
  await pro.page.locator('[data-ui="batch-publish"]').first().waitFor({ timeout: 90_000 })
  const [pub] = await Promise.all([pro.ctx.waitForEvent('page'), pro.page.locator('[data-ui="batch-publish"]').first().click()])
  await pub.waitForURL(/\/publish\.html\?model=/)
  // 确认卡片：封面是这一座同步时存下的画面；训练功能在「写得更详细」的完整表单里勾
  const card = pub.locator('#card')
  await card.locator('#pcCoverPrev img[src*="/quadro/covers/"]').waitFor({ timeout: 20_000 })
  await card.locator('input[name=title]').fill(`${RUN} 双层游戏屋`)
  await card.locator('select[name=cat]').selectOption('climb')
  await card.locator('input[name=kid_m]').fill('30')
  await card.locator('textarea[name=why]').fill('下层是小客厅，上层平台加斜顶，两个孩子一上一下不抢地方。')
  await card.getByRole('button', { name: '写得更详细' }).click()
  await pub.locator('#pub [data-train="climb"]').click()
  await pub.locator('#pub input[name=age_ok]').check()
  await pub.locator('#pub').getByRole('button', { name: '发布到广场' }).click()
  await pub.waitForURL(/\/scheme\.html\?id=/, { timeout: 30_000 })
  await pub.close()
  const scheme = (await api(pro, 'GET', '/plaza/schemes?mine=1')).schemes.find((s) => s.title === `${RUN} 双层游戏屋`)
  assert.ok(scheme, '广场上有设计师发的方案')

  const me = await api(pro, 'PUT', '/pros/me', {
    name: `${RUN} 设计师`, avatar: '', bio: '联调用的设计师。', regions: ['上海'], specialties: ['small'],
    priceMin: 500, priceMax: 1000, serviceNote: '出两版。', wechat: `${RUN}_wx`, works: [scheme.id],
  })
  assert.equal(me.status, 'pending')
  await admin.page.goto('/admin/pros')
  await admin.page.locator('.card.rv').filter({ hasText: `${RUN} 设计师` }).getByRole('button', { name: '通过', exact: true }).click()
  await admin.page.locator('.flash.ok').waitFor()
  assert.equal((await api(pro, 'GET', '/pros/me')).status, 'approved')

  const { id: briefId } = await api(parent, 'POST', '/briefs', {
    region: '上海 · 闵行', kids: [{ age: 30 }], budget: 5000, feats: ['climb'],
    wants: '次卧窗边的角落，想要一座能爬的小屋。', refKind: 'scheme', refId: scheme.slug,
  })
  await api(parent, 'PUT', `/briefs/${briefId}/room`, { room: { w: 320, d: 260, h: 265 } })
  await api(parent, 'POST', `/briefs/${briefId}/assign`, { proId: me.id })
  const { planId } = await api(pro, 'POST', `/briefs/${briefId}/accept`)
  const { token } = await api(parent, 'POST', `/collab/plans/${planId}/invites`)
  await api(family, 'POST', `/collab/invites/${token}/join`)
  const first = (await api(parent, 'GET', `/collab/plans/${planId}`)).name
  console.log(`需求单 ${briefId}，共享方案 ${planId}「${first}」`)

  // —— 1. 三个人都打开方案 ——
  await openPlan(pro, planId)
  await openPlan(parent, planId)
  await openPlan(family, planId)
  await tabShows(pro, planId, first, '设计师的标签页是建方案时的名字')

  // —— 2. 设计师（编辑者）改名：另外两个人的标签页跟着变，服务端的名字立即更新 ——
  const name1 = `${RUN} 次卧窗边小屋`
  await rename(pro, planId, name1)
  await tabShows(pro, planId, name1, '设计师自己的标签页换成新名字')
  check('编辑者改名后自己的标签页是新名字', true)
  check('改名不算没保存（标签页后面没有圆点）', !(await tabName(pro, planId).textContent()).includes('•'))
  await tabShows(parent, planId, name1, '家长的标签页跟着变')
  check('创建人的标签页跟着变成新名字', true)
  await tabShows(family, planId, name1, '评论者的标签页跟着变')
  check('评论者的标签页跟着变成新名字', true)
  await shot(pro, '1-editor-renamed')
  await shot(parent, '2-owner-sees')
  check('改名后立即导出：GET /collab/plans/{id} 的 name 是新名字', await serverName(parent, planId, name1, '服务端的方案名'))
  const mine = (await api(parent, 'GET', '/collab/plans/mine')).plans.find((p) => p.id === planId)
  check('GET /collab/plans/mine 里的 name 是新名字', mine?.name === name1)

  // —— 3. 评论者改不了名 ——
  check('评论者的标签页没有「双击改名」提示', (await tabName(family, planId).getAttribute('title')) === null)
  await tabName(family, planId).dblclick()
  await family.page.waitForTimeout(500)
  check('评论者双击标签页不出改名框', await tabOf(family, planId).locator('input').count() === 0)
  await shot(family, '3-commenter-cannot')

  // —— 4. 创建人再改一次，设计师这边跟着变 ——
  const name2 = `${RUN} 次卧窗边小屋 · 定稿`
  await rename(parent, planId, name2)
  await tabShows(pro, planId, name2, '设计师的标签页跟着创建人改的名字变')
  check('创建人改名，编辑者的标签页跟着变', true)
  check('创建人改名后服务端的名字跟着变', await serverName(parent, planId, name2, '服务端的方案名'))

  // —— 5. 存版本、锁定交付：交付页标题是现在的名字 ——
  await pro.page.getByRole('button', { name: '版本', exact: true }).click()
  const pane = pro.page.locator('[data-ui="versions-pane"]')
  await pane.locator('[data-ui="version-name"]').fill('第 1 版')
  await pane.locator('[data-ui="version-save"]').click()
  await pane.locator('[data-ui="version-row"]').filter({ hasText: '第 1 版' }).waitFor({ timeout: 20_000 })
  check('存版本以后服务端的名字还是现在的名字', (await api(parent, 'GET', `/collab/plans/${planId}`)).name === name2)
  await pane.locator('[data-ui="version-deliver"]').click()
  const dlg = pro.page.locator('[data-ui="deliver-dialog"]')
  await dlg.locator('[data-ui="deliver-metrics"]').waitFor({ timeout: 20_000 })
  await dlg.locator('[data-ui="deliver-age"]').fill('18 个月以上，大人在旁边看着。')
  await dlg.locator('[data-ui="deliver-load"]').fill('上层合计不超过 40 kg。')
  await dlg.locator('[data-ui="deliver-submit"]').click()
  await dlg.locator('[data-ui="deliver-done"]').waitFor({ timeout: 20_000 })
  const dtoken = new URL(await dlg.locator('[data-ui="deliver-url"]').inputValue()).searchParams.get('t')
  check('交付接口的 planName 是现在的名字', (await api(parent, 'GET', `/collab/deliveries/${dtoken}`)).planName === name2)
  const dpage = await (await person('访客')).ctx.newPage()
  pages.push(dpage)
  await dpage.goto(`/deliver.html?t=${dtoken}`)
  await dpage.locator('.page-head h1').filter({ hasText: name2 }).waitFor({ timeout: 20_000 })
  check('交付页标题是现在的名字', (await dpage.title()).startsWith(name2))
  await dpage.waitForTimeout(1500)
  await dpage.screenshot({ path: `${SHOTS}rename-4-deliver.png` })

  // —— 6. 评论者重新打开：还是新名字 ——
  await openPlan(family, planId)
  await tabShows(family, planId, name2, '评论者重新打开后的标签页')
  check('评论者重新打开方案，标签页是新名字', true)
  await shot(family, '5-commenter-reopen')

  // —— 7. 评论者复制一份：新方案用自己的名字，不带原方案的名字 ——
  await family.page.locator('[data-ui=plan-fork]').click()
  await family.page.locator('[data-ui=fork-modal]').waitFor()
  await family.page.locator('[data-ui=fork-go]').click()
  await family.page.waitForFunction((id) => { const p = new URLSearchParams(location.search).get('plan'); return p && p !== id }, planId, { timeout: 15_000 })
  const forkId = new URLSearchParams(new URL(family.page.url()).search).get('plan')
  const forkName = (await api(family, 'GET', `/collab/plans/${forkId}`)).name
  await tabShows(family, forkId, forkName, '复制出来的方案的标签页')
  await family.page.waitForTimeout(2000)
  check('复制出来的方案标签页是它自己的名字', (await tabName(family, forkId).textContent()).trim() === forkName && forkName !== name2)
  check('复制出来的方案服务端名字没被原方案的名字盖掉', (await api(family, 'GET', `/collab/plans/${forkId}`)).name === forkName)
  await shot(family, '6-fork')
}
