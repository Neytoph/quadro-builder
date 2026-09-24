// 共享方案联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110）里开几个浏览器上下文走一遍。
// 运行：NODE_ENV=development ./scripts/build-hosted.sh（要 window.__quadroDev 取模型和摆接头），
//       再 npx vite-node scripts/e2e-collab.mjs。截图存到 SHOTS（默认 ../qb-shots）。
// 账号：pro-owner、pro-editor、pro-viewer，密码 hunter2hunter（联调环境里建好的）。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}collab-${name}.png` })

const browser = await chromium.launch()

async function person(user) {
  const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  if (user) {
    const r = await ctx.request.post('/signin', { form: { identifier: user, password: PASS } })
    assert.equal(r.status(), 200, `signin ${user}`)
  }
  return ctx
}

async function open(ctx, path) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.error('pageerror', e); process.exitCode = 1 })
  await page.goto(path)
  await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('#canvas-host canvas'))
  await page.waitForTimeout(500)
  return page
}

/** 页面里的造型：各类零件的 id */
const modelOf = (page) => page.evaluate(() => {
  const m = window.__quadroDev.model
  return { tubes: [...m.tubes.keys()], nodes: [...m.nodes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z })) }
})

/**
 * 从一个上方空着的接头竖着往上接一根（方向键「上」正视时走的就是这一步）。
 * 'left' 挑最左边的，'right' 挑最右边的：两个人同时接不会撞在一处；'top' 挑最高的。
 */
const growUp = (page, side) => page.evaluate((which) => {
  const { model, builder } = window.__quadroDev
  const free = [...model.nodes.values()].filter((n) => !model.findNodeNear(n.x, n.y + 40, n.z))
  free.sort((a, b) => (which === 'top' ? b.y - a.y : which === 'left' ? a.x - b.x : b.x - a.x) || b.y - a.y)
  const before = model.tubes.size
  builder.setMode('add')
  builder.selectedNodeId = free[0].id
  builder.buildStep([0, 1, 0])
  if (model.tubes.size !== before + 1) throw new Error('growUp: 没接上')
  return model.tubes.size
}, side)

async function waitFor(page, fn, arg, label, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout })
  } catch {
    throw new Error(`等不到：${label}`)
  }
}

// —— 1. 创建人：搭一座、保存、开启共享 ——
const ownerCtx = await person('pro-owner')
const owner = await open(ownerCtx, '/builder/')
await owner.locator('#canvas-host canvas').click({ position: { x: 700, y: 450 } })
for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp']) { await owner.keyboard.press(k); await owner.waitForTimeout(120) }
const built = (await modelOf(owner)).tubes.length
check(`创建人搭了 ${built} 根管`, built >= 3)
await owner.getByRole('button', { name: '文件', exact: true }).click()
await owner.locator('[data-ui=enable-sharing]').click()
await owner.getByRole('dialog').locator('input').fill(`联调方案 ${Date.now().toString(36)}`)
await owner.keyboard.press('Enter')
await owner.waitForURL(/\?plan=/, { timeout: 15000 })
const planId = new URL(owner.url()).searchParams.get('plan')
check(`开启共享后转到方案 ${planId}`, !!planId)
await owner.waitForFunction(() => window.__quadroDev?.model)
await waitFor(owner, (n) => window.__quadroDev.model.tubes.size === n, built, '方案里是这一座')
await owner.locator('[data-ui=plan-bar]').waitFor()
check('顶栏显示方案和角色「创建人」', await owner.locator('[data-ui=plan-bar]').getByText('创建人').isVisible())
await waitFor(owner, () => document.querySelector('[data-ui=plan-bar] [title="已连上"]'), null, '连上 WebSocket')
check('WebSocket 已连上', true)

// —— 2. 邀请编辑者：邀请链接加入成为评论者，创建人把他改成编辑者 ——
await owner.getByRole('button', { name: '成员', exact: true }).click()
const [inviteRes] = await Promise.all([
  owner.waitForResponse((r) => r.url().includes('/invites') && r.request().method() === 'POST'),
  owner.locator('[data-ui=members-invite]').click(),
])
const invite = new URL((await inviteRes.json()).url)
check('生成邀请链接', invite.searchParams.get('invite'))

const editorCtx = await person('pro-editor')
const editor = await open(editorCtx, `${invite.pathname}${invite.search}`)
await editor.locator('[data-ui=plan-bar]').waitFor()
await waitFor(editor, () => !new URLSearchParams(location.search).get('invite'), null, '加入以后地址栏去掉 invite')
check('编辑者用邀请链接加入，先是评论者', await editor.locator('[data-ui=plan-bar]').getByText('评论者').isVisible())
check('评论者看不到搭建工具条', !(await editor.locator('[data-tour="tool-tubes"]').count()))

await owner.reload()
await owner.waitForFunction(() => window.__quadroDev?.model)
await owner.getByRole('button', { name: '成员', exact: true }).click()
const editorRow = owner.locator('[data-ui=member]').filter({ hasText: 'pro-editor' })
await editorRow.waitFor()
await editorRow.locator('[data-ui=member-role]').selectOption('editor')
await editor.locator('[data-ui=plan-bar]').getByText('编辑者').waitFor({ timeout: 15000 })
check('创建人把他改成编辑者，他那边重连后变成编辑者', true)
await editor.locator('[data-tour="tool-tubes"]').first().waitFor({ timeout: 10000 })
check('编辑者有了搭建工具条', true)

// —— 3. 实时编辑：一边改另一边马上看到 ——
await waitFor(editor, (n) => window.__quadroDev.model.tubes.size === n, built, '编辑者看到同一座')
const afterEditorAdd = await growUp(editor, 'left')
check('编辑者接了一根', afterEditorAdd === built + 1)
await waitFor(owner, (n) => window.__quadroDev.model.tubes.size === n, afterEditorAdd, '创建人实时看到编辑者接的管')
check('创建人实时看到编辑者接的那一根', true)
// 创建人接在编辑者刚加的那个接头上（最高的那个）
const afterOwnerAdd = await growUp(owner, 'top')
await waitFor(editor, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd, '编辑者实时看到创建人接的管')
check('编辑者实时看到创建人接的那一根', true)

// 选中标记：编辑者全选，创建人画面上出现他的头像
await editor.locator('#canvas-host canvas').click({ position: { x: 5, y: 880 } })
await editor.keyboard.press('Escape')
await editor.keyboard.press('ControlOrMeta+a')
await owner.locator('[data-ui=peer-mark]').first().waitFor({ timeout: 8000 })
check('创建人画面上出现编辑者的头像和选中标记', await owner.locator('[data-ui=peer-mark]').getByText('pro-editor').isVisible())
await shot(owner, '1-owner-sees-editor')
await editor.keyboard.press('Escape')

// 撤销只撤自己的：编辑者撤销，只撤掉他接的那根，创建人接的还在
// 创建人那根接在编辑者加的接头上：接头留下，创建人的管不悬空
const editorTubes = (await modelOf(editor)).tubes
await editor.keyboard.press('ControlOrMeta+z')
await waitFor(owner, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd - 1, '编辑者撤销后创建人那边少一根')
const ownerTubes = (await modelOf(owner)).tubes
check('编辑者撤销只撤掉自己接的那一根，创建人接在上面的还在', ownerTubes.length === editorTubes.length - 1)
check('两边一致', (await modelOf(editor)).tubes.sort().join() === [...ownerTubes].sort().join())
await editor.keyboard.press('ControlOrMeta+Shift+z')
await waitFor(owner, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd, '编辑者重做')

// —— 4. 评论者改不了 ——
const viewerCtx = await person('pro-viewer')
const [invite2] = await Promise.all([
  owner.waitForResponse((r) => r.url().includes('/invites') && r.request().method() === 'POST'),
  owner.locator('[data-ui=members-invite]').click(),
])
const inv2 = new URL((await invite2.json()).url)
const viewer = await open(viewerCtx, `${inv2.pathname}${inv2.search}`)
await viewer.locator('[data-ui=plan-bar]').getByText('评论者').waitFor()
await waitFor(viewer, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd, '评论者看到同一座')
await viewer.locator('#canvas-host canvas').click({ position: { x: 5, y: 880 } })
await viewer.keyboard.press('ControlOrMeta+a')
await viewer.keyboard.press('Delete')
await viewer.waitForTimeout(400)
check('评论者删除被拦下，画面上还在', (await modelOf(viewer)).tubes.length === afterOwnerAdd)
check('评论者看到「只能查看和评论」', await viewer.getByText('这里只能查看和评论，不能修改。').isVisible())
await owner.waitForTimeout(800)
check('创建人那边零件一件没少', (await modelOf(owner)).tubes.length === afterOwnerAdd)
await shot(viewer, '2-viewer-read-only')

// 访客：不登录也能看
const guestCtx = await person(null)
const guest = await open(guestCtx, `/builder/?plan=${planId}`)
await waitFor(guest, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd, '访客看到同一座')
check('访客能打开查看', await guest.locator('[data-ui=read-only-banner]').isVisible())
await guestCtx.close()

// —— 5. 位置评论和留言 ——
await viewer.getByRole('button', { name: '评论', exact: true }).click()
await viewer.locator('[data-ui=pin-start]').click()
await viewer.locator('[data-ui=pin-placer]').click({ position: { x: 700, y: 450 } })
await viewer.locator('[data-ui=pin-draft] textarea').fill('这根管能不能换成红色？')
await viewer.locator('[data-ui=pin-draft]').getByRole('button', { name: '发送' }).click()
await viewer.locator('[data-ui=pin-thread]').first().waitFor()
await viewer.waitForTimeout(300)
const pinBox = await viewer.locator('[data-ui=pin]').first().boundingBox()
// 图钉的针尖落在点下去的那一处（700, 450）
check('评论者在画面上放了一条位置评论，图钉就在点的地方',
  !!pinBox && Math.abs(pinBox.x + pinBox.width / 2 - 700) < 30 && pinBox.y + pinBox.height > 400 && pinBox.y + pinBox.height < 470)
await owner.getByRole('button', { name: /^评论/ }).click()
await owner.locator('[data-ui=pin-thread]').filter({ hasText: '换成红色' }).waitFor({ timeout: 10000 })
check('创建人马上收到这条评论', true)
await owner.locator('[data-ui=pin-thread]').filter({ hasText: '换成红色' }).click()
await owner.locator('[data-ui=pin-thread] textarea').fill('可以，下一版改')
await owner.locator('[data-ui=pin-thread]').getByRole('button', { name: '发送' }).click()
await owner.locator('[data-ui=pin-thread] [data-ui=post]').filter({ hasText: '可以，下一版改' }).waitFor()
check('创建人回复', true)
await owner.locator('[data-ui=comments-tab-chat]').click()
await owner.locator('[data-ui=chat] textarea').fill('预算大概 6000')
await owner.locator('[data-ui=chat]').getByRole('button', { name: '发送' }).click()
await owner.locator('[data-ui=chat] [data-ui=post]').filter({ hasText: '预算大概 6000' }).waitFor()
check('留言区发言', true)
await viewer.locator('[data-ui=comments-tab-chat]').click()
await viewer.locator('[data-ui=chat] [data-ui=post]').filter({ hasText: '预算大概 6000' }).waitFor({ timeout: 10000 })
check('评论者那边马上看到留言', true)
await viewer.locator('[data-ui=comments-tab-pins]').click()
await shot(owner, '3-comments')

// —— 6. 断网再连能合并 ——
await editorCtx.setOffline(true)
await editor.waitForTimeout(1500)
const offlineAdd = await growUp(editor, 'left')
await owner.waitForTimeout(1500)
check('编辑者断网时接的管创建人还看不到', (await modelOf(owner)).tubes.length === afterOwnerAdd)
const ownerOffline = await growUp(owner, 'right')
await editorCtx.setOffline(false)
await waitFor(owner, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd + 2, '重连后创建人看到编辑者断网时接的管', 20000)
await waitFor(editor, (n) => window.__quadroDev.model.tubes.size === n, afterOwnerAdd + 2, '重连后编辑者看到创建人接的管', 20000)
const a = (await modelOf(owner)).tubes.sort().join()
const b = (await modelOf(editor)).tubes.sort().join()
check(`断网再连两边合并成同一座（${offlineAdd}、${ownerOffline}）`, a === b)

// —— 7. 存版本、对照 ——
await owner.getByRole('button', { name: '版本', exact: true }).click()
await owner.locator('[data-ui=version-save]').click()
await owner.getByRole('dialog').locator('input').fill('第 1 版')
await owner.keyboard.press('Enter')
await owner.getByText('已存成版本「第 1 版」').waitFor()
check('存版本', true)
await growUp(owner, 'right')
await owner.locator('[data-ui=version-row]').filter({ hasText: '第 1 版' }).getByText('和当前对照').click()
await owner.locator('[data-ui=compare-view]').waitFor()
await owner.waitForTimeout(1500)
// 往上接一根：多一个接头、一根管
check('对照里标出新增的接头和管', await owner.locator('[data-ui=compare-view]').getByText('新增 2').isVisible())
check('料表差异列出管子多了', await owner.locator('[data-ui=compare-bom] tbody tr').count() >= 1)
check('地址栏带上 compare', new URL(owner.url()).searchParams.get('compare')?.endsWith(',current'))
await shot(owner, '4-compare')
await owner.locator('[data-ui=compare-close]').click()

// —— 8. 锁定交付 ——
// 联调环境的创建人不是接单设计师（can_deliver 由需求单接单时给），交付用编辑者也不一定有权限：
// 看成员里谁能交付，没有就跳过这一段，报告里写明
const canDeliver = await owner.evaluate(() => !!document.querySelector('[data-ui=version-deliver]'))
if (canDeliver) {
  await owner.locator('[data-ui=version-row]').filter({ hasText: '第 1 版' }).locator('[data-ui=version-deliver]').click()
  await owner.locator('[data-ui=deliver-metrics]').waitFor()
  await owner.locator('[data-ui=deliver-dialog] textarea').nth(0).fill('适合 3 岁以上')
  await owner.locator('[data-ui=deliver-dialog] textarea').nth(1).fill('上层按两个孩子设计')
  await owner.locator('[data-ui=deliver-submit]').click()
  await owner.locator('[data-ui=deliver-done]').waitFor()
  const url = await owner.locator('[data-ui=deliver-done] input').inputValue()
  const token = new URL(url).searchParams.get('t')
  check('锁定交付，拿到交付页地址', !!token)
  await shot(owner, '5-deliver')
  const dctx = await person(null)
  const dpage = await open(dctx, `/builder/?delivery=${token}`)
  await waitFor(dpage, () => window.__quadroDev.model.tubes.size > 0, null, '交付查看打开')
  check('?delivery= 不登录也能打开，只读', await dpage.evaluate(() => window.__quadroDev.builder.readOnly))
  await shot(dpage, '6-delivery')
  await dctx.close()
} else {
  console.log('· 创建人没有交付权限（不是接单设计师），交付一段交给需求单接单的方案去测')
}

await browser.close()
console.log(`${ok} 项通过`)
