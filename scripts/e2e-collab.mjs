// 共享方案联调：在联调环境（主仓库 dev-up 起的 pro 那一套，站点 9110）里开几个浏览器上下文走一遍。
// 运行：NODE_ENV=development ./scripts/build-hosted.sh（要 window.__quadroDev 摆接头、读模型），
//       再 node scripts/e2e-collab.mjs。截图存到 SHOTS（默认 ../qb-shots）。
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
  const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.builder.collab-coach.v1', '1')
    localStorage.setItem('quadro.builder.collab-coach-guest.v1', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  if (user) {
    const r = await ctx.request.post('/signin', { form: { identifier: user, password: PASS } })
    assert.equal(r.status(), 200, `signin ${user}`)
  }
  return ctx
}

const pages = []
async function open(ctx, path) {
  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (e) => { console.error('pageerror', e.message, e.stack); process.exitCode = 1 })
  page.on('response', (r) => { if (r.status() >= 500) console.error('HTTP', r.status(), r.request().method(), r.url()) })
  await page.goto(path)
  await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('#canvas-host canvas'))
  await page.waitForTimeout(500)
  return page
}

const tubes = (page) => page.evaluate(() => [...window.__quadroDev.model.tubes.keys()].sort())
const tubeCount = (page) => page.evaluate(() => window.__quadroDev.model.tubes.size)

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
  builder.setMode('select')
  return model.tubes.size
}, side)

async function waitFor(page, fn, arg, label, timeout = 10000) {
  try {
    await page.waitForFunction(fn, arg, { timeout })
  } catch {
    throw new Error(`等不到：${label}`)
  }
}
const sameCount = (page, n, label, timeout) => waitFor(page, (x) => window.__quadroDev.model.tubes.size === x, n, label, timeout)

async function inviteFrom(owner) {
  const [res] = await Promise.all([
    owner.waitForResponse((r) => r.url().includes('/invites') && r.request().method() === 'POST'),
    owner.locator('[data-ui=plan-share]').click(),
  ])
  const url = new URL((await res.json()).url)
  await owner.locator('[data-ui=share-modal]').waitFor()
  return url
}
const closeModal = (page) => page.keyboard.press('Escape')

try {
  await run()
} catch (err) {
  // 出错时每个页面截一张，看当时的样子
  for (const [i, p] of pages.entries()) if (!p.isClosed()) await p.screenshot({ path: `${SHOTS}collab-fail-${i}.png` })
  throw err
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
// —— 1. 创建人：搭一座，顶栏「共享」开启共享，当前标签页原地变成共享方案 ——
const ownerCtx = await person('pro-owner')
const owner = await open(ownerCtx, '/builder/')
await owner.locator('#canvas-host canvas').click({ position: { x: 720, y: 500 } })
for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp']) { await owner.keyboard.press(k); await owner.waitForTimeout(120) }
const built = await tubeCount(owner)
check(`创建人搭了 ${built} 根管`, built >= 3)
await owner.locator('[data-ui=share-enable]').click()
await owner.locator('[data-ui=enable-share]').waitFor()
await shot(owner, '1-enable-share')
await owner.locator('[data-ui=enable-share-go]').click()
const planName = `联调方案 ${Date.now().toString(36)}`
await owner.getByRole('dialog').locator('input').fill(planName)
await owner.keyboard.press('Enter')
await owner.locator('[data-ui=plan-share]').waitFor({ timeout: 15000 })
await waitFor(owner, () => new URLSearchParams(location.search).get('plan'), null, '地址栏换成方案地址')
const planId = new URL(owner.url()).searchParams.get('plan')
check(`开启共享：标签页原地变成共享方案 ${planId}`, !!planId && await tubeCount(owner) === built)
check('顶栏多出「评论」「版本」', await owner.getByRole('button', { name: '版本', exact: true }).isVisible())
await owner.locator('[data-ui=sync-state][data-conn=connected]').waitFor()
check('左下角「已同步」', await owner.locator('[data-ui=sync-state]').getByText('已同步').isVisible())
const mine = await (await ownerCtx.request.get('/quadro/collab/plans/mine')).json()
const cover = mine.plans.find((p) => p.id === planId)?.cover
const coverRes = cover ? await ownerCtx.request.get(cover) : null
check('开启共享时交上画面缩略图，「我参与的方案」里有封面', !!coverRes && coverRes.ok() && /^image\//.test(coverRes.headers()['content-type']))

// —— 2. 邀请：共享弹层里拿邀请链接，编辑者打开加入成为评论者，创建人把他改成编辑者 ——
const invite = await inviteFrom(owner)
check('共享弹层里有邀请链接', !!invite.searchParams.get('invite'))
await closeModal(owner)

const editorCtx = await person('pro-editor')
const editor = await open(editorCtx, `${invite.pathname}${invite.search}`)
await editor.locator('[data-ui=read-only-banner]').waitFor({ timeout: 15000 })
check('编辑者用邀请链接加入，先是评论者（提示条）', await editor.locator('[data-ui=read-only-banner]').getByText('你是评论者').isVisible())
check('加入以后地址栏去掉 invite', !new URL(editor.url()).searchParams.get('invite'))
check('评论者的工具条灰掉，只剩选择和评论', await editor.locator('.qb-locked').count() > 0 && await editor.locator('[data-ui=tool-comment]').isVisible())

await owner.locator('[data-ui=plan-share]').click()
const editorRow = owner.locator('[data-ui=member]').filter({ hasText: 'pro-editor' })
await editorRow.waitFor({ timeout: 10000 })
await shot(owner, '2-share-members')
await editorRow.locator('[data-ui=member-role]').click()
await editorRow.locator('[data-ui=member-menu] button').filter({ hasText: '编辑者' }).click()
await closeModal(owner)
await editor.locator('[data-ui=read-only-banner]').waitFor({ state: 'detached', timeout: 20000 })
check('创建人把他改成编辑者，他那边重连后能编辑了', await editor.locator('.qb-locked').count() === 0)

// —— 3. 实时编辑、选中标记、别人改完的提示、撤销只撤自己的 ——
await sameCount(editor, built, '编辑者看到同一座')
const afterEditorAdd = await growUp(editor, 'left')
await sameCount(owner, afterEditorAdd, '创建人实时看到编辑者接的管')
check('一边接一根，另一边实时看到', true)
await owner.locator('[data-ui=activity]').filter({ hasText: 'pro-editor' }).waitFor({ timeout: 8000 })
check('创建人画面底部浮出「pro-editor 加了 2 件」', await owner.locator('[data-ui=activity]').getByText('加了 2 件').isVisible())
const afterOwnerAdd = await growUp(owner, 'top')
await sameCount(editor, afterOwnerAdd, '编辑者实时看到创建人接的管')
check('另一边接的也实时同步回来', true)

await editor.locator('#canvas-host canvas').click({ position: { x: 5, y: 890 } })
await editor.keyboard.press('Escape')
await editor.keyboard.press('ControlOrMeta+a')
await owner.locator('[data-ui=peer-mark]').filter({ hasText: 'pro-editor' }).waitFor({ timeout: 8000 })
check('创建人画面上别人选中的零件套着他颜色的框和名字条', true)
await shot(owner, '3-live-selection')
await editor.keyboard.press('Escape')
await editor.evaluate(() => { window.__quadroDev.builder.selection.clear(); window.__quadroDev.builder.refresh() })

// 创建人那根接在编辑者加的接头上：撤销时接头留下，创建人的管不悬空
const editorBefore = await tubes(editor)
await editor.keyboard.press('ControlOrMeta+z')
await sameCount(owner, afterOwnerAdd - 1, '编辑者撤销后创建人那边少一根')
check('编辑者撤销只撤掉自己接的那一根，创建人接在上面的还在', (await tubes(owner)).length === editorBefore.length - 1)
check('两边一致', (await tubes(owner)).join() === (await tubes(editor)).join())
await editor.keyboard.press('ControlOrMeta+Shift+z')
await sameCount(owner, afterOwnerAdd, '编辑者重做')

// —— 4. 评论者改不了；访客只读 ——
const viewerCtx = await person('pro-viewer')
const inv2 = await inviteFrom(owner)
await closeModal(owner)
const viewer = await open(viewerCtx, `${inv2.pathname}${inv2.search}`)
await viewer.locator('[data-ui=read-only-banner]').waitFor({ timeout: 15000 })
await sameCount(viewer, afterOwnerAdd, '评论者看到同一座')
await viewer.locator('#canvas-host canvas').click({ position: { x: 5, y: 890 } })
await viewer.keyboard.press('ControlOrMeta+a')
await viewer.keyboard.press('Delete')
await viewer.waitForTimeout(500)
check('评论者删除被拦下，画面上还在', await tubeCount(viewer) === afterOwnerAdd)
check('评论者看到「这里只能查看和评论，不能修改」', await viewer.getByText('这里只能查看和评论，不能修改。').isVisible())
await owner.waitForTimeout(800)
check('创建人那边零件一件没少', await tubeCount(owner) === afterOwnerAdd)
await viewer.keyboard.press('Escape')
await viewer.evaluate(() => { window.__quadroDev.builder.selection.clear(); window.__quadroDev.builder.refresh() })
await shot(viewer, '4-commenter')

const guestCtx = await person(null)
const guest = await open(guestCtx, `/builder/?plan=${planId}`)
await sameCount(guest, afterOwnerAdd, '访客看到同一座')
check('访客能打开，只读提示条「登录后写评论」', await guest.locator('[data-ui=read-only-banner]').getByText('登录后写评论').isVisible())
check('访客没有工具条', !(await guest.locator('[data-ui=tool-comment]').count()) && !(await guest.locator('[data-tour=toolbar]').count()))
await shot(guest, '5-guest')
await guestCtx.close()

// —— 5. 位置评论：工具条「评论」放图钉，图钉旁边讨论；留言区 ——
await viewer.locator('[data-ui=tool-comment]').click()
await viewer.locator('[data-ui=pin-placer]').click({ position: { x: 720, y: 520 } })
await viewer.locator('[data-ui=pin-draft] textarea').fill('这根管能不能换成红色？')
await viewer.locator('[data-ui=pin-draft]').getByRole('button', { name: '发出' }).click()
await viewer.locator('[data-ui=pin-bubble]').waitFor()
const pinBox = await viewer.locator('[data-ui=pin]').first().boundingBox()
// 放图钉那一层从顶栏下面（44px）开始，点的是窗口里的 (720, 564)；图钉转了 45°，外框比针尖低几像素
check('评论者放了一颗图钉，针尖在点的地方，讨论就地打开',
  !!pinBox && Math.abs(pinBox.x + pinBox.width / 2 - 720) < 12 && Math.abs(pinBox.y + pinBox.height - 564) < 12)
await owner.locator('[data-tour=dock-comments]').click()
const item = owner.locator('[data-ui=pin-thread]').filter({ hasText: '换成红色' })
await item.waitFor({ timeout: 10000 })
check('创建人的评论抽屉里马上有这一条，带未读', await item.evaluate((el) => el.classList.contains('unread')))
await item.click()
await owner.locator('[data-ui=pin-bubble] textarea').fill('可以，下一版改')
await owner.locator('[data-ui=pin-bubble]').getByRole('button', { name: '回复' }).click()
await owner.locator('[data-ui=pin-bubble] [data-ui=post]').filter({ hasText: '可以，下一版改' }).waitFor()
check('创建人在图钉旁边回复', true)
await viewer.locator('[data-ui=pin-bubble] [data-ui=post]').filter({ hasText: '可以，下一版改' }).waitFor({ timeout: 10000 })
check('评论者那边的讨论马上多了这条回复', true)
await shot(owner, '6-pin-bubble')
await owner.locator('[data-ui=comments-tab-chat]').click()
await owner.locator('[data-ui=comments-pane] textarea').fill('预算大概 6000')
await owner.locator('[data-ui=comments-pane]').getByRole('button', { name: '发送' }).click()
await owner.locator('[data-ui=chat] [data-ui=post]').filter({ hasText: '预算大概 6000' }).waitFor()
check('留言区发言', true)
await shot(owner, '7-chat')
await owner.locator('[data-tour=dock-comments]').click()

// —— 6. 断网再连能合并 ——
await editorCtx.setOffline(true)
await editor.locator('[data-ui=sync-state][data-conn=offline]').waitFor({ timeout: 8000 })
check('断网时左下角「离线中 · 修改先存在本机」', await editor.locator('[data-ui=sync-state]').getByText('离线中').isVisible())
await growUp(editor, 'left')
await owner.waitForTimeout(1500)
check('编辑者断网时接的管创建人还看不到', await tubeCount(owner) === afterOwnerAdd)
await growUp(owner, 'right')
await editorCtx.setOffline(false)
await sameCount(owner, afterOwnerAdd + 2, '重连后创建人看到编辑者断网时接的管', 20000)
await sameCount(editor, afterOwnerAdd + 2, '重连后编辑者看到创建人接的管', 20000)
check('断网再连两边合并成同一座', (await tubes(owner)).join() === (await tubes(editor)).join())

// —— 7. 存版本、对照 ——
await owner.getByRole('button', { name: '版本', exact: true }).click()
await owner.locator('[data-ui=version-name]').fill('第 1 版：初稿')
await owner.locator('[data-ui=version-save]').click()
await owner.locator('[data-ui=version-row]').filter({ hasText: '第 1 版：初稿' }).waitFor()
check('存版本', true)
await editor.getByRole('button', { name: '版本', exact: true }).click()
await editor.locator('[data-ui=version-row]').filter({ hasText: '第 1 版：初稿' }).waitFor({ timeout: 10000 })
check('编辑者的版本抽屉马上多了这一版', true)
await growUp(owner, 'right')
await owner.locator('[data-ui=version-row][data-version=current]').getByText('上次存版本以后改了 2 件').waitFor({ timeout: 8000 })
check('「现在」一行写着上次存版本以后改了几件', true)
await owner.locator('[data-ui=version-row]').filter({ hasText: '第 1 版：初稿' }).getByRole('button', { name: '对照' }).click()
await owner.locator('[data-ui=version-row][data-version=current]').getByRole('button', { name: '对照' }).click()
await shot(owner, '8-versions')
await owner.locator('[data-ui=version-compare]').click()
await owner.locator('[data-ui=compare-view]').waitFor()
await owner.waitForTimeout(1500)
check('对照：右边新增 2 件（一个接头、一根管）', await owner.locator('[data-ui=compare-view]').getByText('新增 2 件').isVisible())
check('料表差异列出变了的零件', await owner.locator('[data-ui=compare-bom] tbody tr').count() >= 1)
check('地址栏带上 compare', /,current$/.test(new URL(owner.url()).searchParams.get('compare') || ''))
await shot(owner, '9-compare')
await owner.locator('[data-ui=compare-close]').click()

// —— 8. 锁定交付，?delivery= 不登录也能打开 ——
// 退出对照以后版本抽屉还开着
await owner.locator('[data-ui=versions-pane]').waitFor()
// 自己开启共享的造型，创建人自己能锁定交付
check('创建人的版本抽屉里有「锁定交付」', await owner.locator('[data-ui=version-deliver]').count() > 0)
await owner.locator('[data-ui=version-deliver]').click()
await owner.locator('[data-ui=deliver-dialog] dl').waitFor()
await owner.locator('[data-ui=deliver-age]').fill('下层 18 个月以上，大人在旁边看着')
await owner.locator('[data-ui=deliver-load]').fill('上层按两个孩子设计，合计不超过 40 kg')
await shot(owner, '10-deliver')
await owner.locator('[data-ui=deliver-submit]').click()
await owner.locator('[data-ui=deliver-done]').waitFor()
const url = new URL(await owner.locator('[data-ui=deliver-url]').inputValue())
const token = url.searchParams.get('t')
check('锁定交付，拿到交付页地址 /deliver.html?t=', url.pathname === '/deliver.html' && !!token)
await closeModal(owner)
const dctx = await person(null)
const dpage = await open(dctx, `/builder/?delivery=${token}`)
await waitFor(dpage, () => window.__quadroDev.model.tubes.size > 0, null, '交付查看打开')
check('?delivery= 不登录也能打开，只读', await dpage.evaluate(() => window.__quadroDev.builder.readOnly))
check('单独打开时有分步手册按钮和视角方块', await dpage.locator('[data-tour=assembly]').isVisible() && await dpage.evaluate(() => window.__quadroDev.scene._cubeEnabled))
await shot(dpage, '11-delivery')

// 交付页里嵌的那一份：只剩可拖动的三维画面
await dpage.goto(`/deliver.html?t=${token}`)
const frame = dpage.frameLocator('.dl-view iframe')
await frame.locator('[data-ui=delivery-embed] #canvas-host canvas').waitFor({ timeout: 20000 })
const inner = dpage.frames().find((f) => f.url().includes('/builder/?delivery='))
await inner.waitForFunction(() => window.__quadroDev?.model.tubes.size > 0)
await dpage.waitForTimeout(800)
check('交付页 iframe 里没有分步手册按钮', await frame.locator('[data-tour=assembly]').count() === 0)
check('交付页 iframe 里不画视角方块', await inner.evaluate(() => window.__quadroDev.scene._cubeEnabled === false))
check('交付页 iframe 里没有小麦头像', !(await frame.locator('.qh-chat-root').count()) || !(await frame.locator('.qh-chat-fab').isVisible()))
check('交付页 iframe 里没有「在 Builder 里打开」', !(await frame.getByText('在 Builder 里打开').count()))
const canvasBox = await frame.locator('#canvas-host canvas').boundingBox()
const camBefore = await inner.evaluate(() => window.__quadroDev.scene.camera.position.toArray().join())
await dpage.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
await dpage.mouse.down()
await dpage.mouse.move(canvasBox.x + canvasBox.width / 2 + 160, canvasBox.y + canvasBox.height / 2 + 20, { steps: 8 })
await dpage.mouse.up()
await dpage.waitForTimeout(400)
check('交付页 iframe 里的三维画面能拖动旋转', await inner.evaluate(() => window.__quadroDev.scene.camera.position.toArray().join()) !== camBefore)
await dpage.screenshot({ path: `${SHOTS}collab-12-deliver-page.png` })

// 「开始拼」：&assembly=1 单独打开，直接进逐层拼装
await dpage.goto(`/builder/?delivery=${token}&assembly=1`)
await waitFor(dpage, () => window.__quadroDev?.builder.mode === 'assembly', null, '进逐层拼装')
check('&assembly=1 打开就是逐层拼装，底下是上一步、下一步', await dpage.locator('[data-tour=assembly]').getByText('下一步').isVisible())
await dpage.waitForTimeout(600)
await shot(dpage, '13-assembly')
await dctx.close()

// —— 9. 评论者复制一份：新开一个标签页，是他自己的方案 ——
await viewer.locator('[data-ui=plan-fork]').click()
await viewer.locator('[data-ui=fork-modal]').waitFor()
await viewer.locator('[data-ui=fork-go]').click()
await waitFor(viewer, (id) => { const p = new URLSearchParams(location.search).get('plan'); return p && p !== id }, planId, '复制出来的方案打开', 15000)
await viewer.locator('[data-ui=read-only-banner]').waitFor({ state: 'detached', timeout: 15000 })
check('复制一份：新开的标签页是评论者自己的方案，能编辑', await viewer.locator('.qb-locked').count() === 0)
await sameCount(viewer, afterOwnerAdd + 3, '复制出来的一份和原方案一样', 15000)
check('原方案的标签页还在', await viewer.getByText(planName).count() > 0)
}
