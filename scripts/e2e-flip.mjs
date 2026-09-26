// 选择模式里真用鼠标点面板：选中后隔一会儿再点就翻面、撤销，翻面等过 500 毫秒才执行；双击和
// 间隔不到 500 毫秒的两下是选整块；Shift / Ctrl / ⌘ 点、拖动、点没选中的面板都不翻面；选中多块时
// 先点成只选这一块、再点才翻；成组的板只翻点到的那块；面板后面压着零件时再点也是翻面，管子、
// 接头照旧隔一会儿在同一处再点就往里选；翻面排着时撤销撤的就是它、点别处先翻完；共享方案标签页
// 照样能翻、写进共享文档，只能看时不翻；触屏点一下选中、再点一下翻面。
// 运行：先起开发服务 npx vite --port 5230 --strictPort，再 node scripts/e2e-flip.mjs
// 截图存到 SHOTS（默认 ../qb-shots），文件名 flip-*。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const BASE = process.env.BASE || 'http://localhost:5230/'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }

// 打开一页 Builder；触屏那一段用 hasTouch 的上下文另开一页
async function openPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts })
  await ctx.addInitScript(() => {
    localStorage.setItem('quadro.builder.onboarded.v2', '1')
    localStorage.setItem('quadro.lang', 'zh')
    localStorage.setItem('quadro-builder-lang', 'zh')
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => { console.error('pageerror', e); process.exitCode = 1 })
  await p.goto(BASE)
  await p.waitForFunction(() => window.__quadroDev?.model && document.querySelector('canvas'))
  await p.waitForTimeout(600)
  return p
}
let page = await openPage()

const shot = async (name) => {
  await page.mouse.move(1380, 880)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}flip-${name}.png` })
}
const toast = () => page.evaluate(() => document.querySelector('.m-toast:not(.m-leave)')?.textContent || '')

// 两格并排的平台（地面上一圈 35 cm 的管），每格铺一块 40×40 的板。返回两块板的 id。
const load = () => page.evaluate(() => {
  const { model, builder, scene } = window.__quadroDev
  builder.setMode('select')
  let ids = null
  builder.recordHistory(() => {
    model.clear()
    const n = [[0, 0], [40, 0], [80, 0], [0, 40], [40, 40], [80, 40]].map(([x, z]) => model.addNode(x, 0, z))
    const tube = (i, j, color) => model.addTube(n[i].id, n[j].id, 'T35', color, 35)
    const front = tube(0, 1, 'blue'), back = tube(3, 4, 'blue')
    tube(1, 2, 'red'); tube(4, 5, 'red')
    const left = tube(0, 3, 'red'), mid = tube(1, 4, 'blue'), right = tube(2, 5, 'red')
    const p1 = model.addPanel(front.id, back.id, 0, 40, 'panel_40x40', 'green', 1)
    const p2 = model.addPanel(mid.id, right.id, 0, 40, 'panel_40x40', 'yellow', 1)
    ids = [p1.id, p2.id]
    void left
  })
  builder.modelReplaced()
  builder.clearSelection()
  builder.refresh()
  scene.frameFromYaw(model, 0, { silent: true, margin: 2.2 })
  return ids
})

// 世界坐标 → 窗口坐标
const toScreen = (p) => page.evaluate((p) => {
  const { scene } = window.__quadroDev
  scene.renderer.render(scene.scene, scene.camera)
  const v = scene.camera.position.clone().set(p[0], p[1], p[2]).project(scene.camera)
  const r = scene.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
}, p)
// 指针下最前面那件
const frontAt = (p) => page.evaluate((p) => {
  const hit = window.__quadroDev.scene.pickAllForDelete(p.x, p.y)[0]
  return hit ? hit.data.id : null
}, p)
const side = (id) => page.evaluate((id) => window.__quadroDev.model.panels.get(id).side, id)
const selected = () => page.evaluate(() => [...window.__quadroDev.builder.selection.keys()])
const onlySelected = async (id) => { const s = await selected(); return s.length === 1 && s[0] === id }
const undoDepth = () => page.evaluate(() => window.__quadroDev.builder.history.manager.undoStack.length)

// 选中之后隔过选整块的时间再点；翻面也要等过这个时间才执行
const PAUSE = 700
async function click(p, modifiers = []) {
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(120)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(p.x, p.y)
  for (const m of modifiers) await page.keyboard.up(m)
  await page.waitForTimeout(PAUSE)
}

// 摆好平台，等零件落下来的动效放完（点选用的碰撞体这时才到位），返回两块板和它们中心的屏幕位置
async function loadSettled() {
  const [a, b] = await load()
  const ca = await toScreen([20, 0, 20])
  const cb = await toScreen([60, 0, 20])
  await page.waitForFunction(([c, id]) => window.__quadroDev.scene.pickAllForDelete(c.x, c.y)[0]?.data.id === id,
    [ca, a], { timeout: 10000 })
  await page.waitForTimeout(500)
  return { p1: a, p2: b, c1: ca, c2: cb }
}

// ---- 1. 选中 → 再点翻面 → 撤销 ----
const { p1, p2, c1, c2 } = await loadSettled()
check('第一块板中心点下去最前面是它', (await frontAt(c1)) === p1)
check('第二块板中心点下去最前面是它', (await frontAt(c2)) === p2)
await click(c1)
check('点没选中的面板：只选中它', await onlySelected(p1))
check('点没选中的面板：不翻面', (await side(p1)) === 1)
await shot('1-selected')
const depth = await undoDepth()
await click(c1)
check('隔一会儿再点已选中的面板：翻到管子下面', (await side(p1)) === -1)
const tip = await toast()
check(`翻面给出提示「${tip}」`, tip.includes('板挂在管子下面'))
check('翻面记进了撤销', (await undoDepth()) === depth + 1)
check('翻面后它还选着', await onlySelected(p1))
await shot('2-flipped')
await click(c1)
check('再点一次：翻回管子上面', (await side(p1)) === 1)
check('又给出提示', (await toast()).includes('板铺在管子上面'))
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销：回到管子下面', (await side(p1)) === -1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('再撤销：回到最初的上面', (await side(p1)) === 1)
await shot('3-undone')

// ---- 1b. 翻面等过选整块的时间窗口才执行 ----
await page.mouse.click(c1.x, c1.y)
await page.waitForTimeout(250)
check('再点之后 250 毫秒：还没翻', (await side(p1)) === 1)
await page.waitForTimeout(450)
check('过了 500 毫秒：翻了', (await side(p1)) === -1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销回到上面', (await side(p1)) === 1)
await page.waitForTimeout(PAUSE)

// ---- 1c. 分开的两下点击、间隔不到 500 毫秒：选整块，不翻 ----
check('这时还只选着第一块板', await onlySelected(p1))
const depth2 = await undoDepth()
await page.mouse.click(c1.x, c1.y)
await page.waitForTimeout(350)
await page.mouse.click(c1.x, c1.y)
await page.waitForTimeout(1200)
const block2 = await selected()
check(`间隔 350 毫秒的两下：选中整块（${block2.length} 件）`, block2.length > 2 && block2.includes(p2))
check('间隔 350 毫秒的两下：不翻', (await side(p1)) === 1)
check('间隔 350 毫秒的两下：没记撤销', (await undoDepth()) === depth2)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await page.waitForTimeout(300)

// ---- 2. 快速连点两下：选整块，不翻面 ----
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
check('先选中第一块板', await onlySelected(p1))
await page.mouse.dblclick(c1.x, c1.y)
await page.waitForTimeout(PAUSE)
const block = await selected()
check(`快速连点两下已选中的面板：选中整块（${block.length} 件）`, block.length > 2 && block.includes(p1) && block.includes(p2))
check('快速连点两下：不翻面', (await side(p1)) === 1)
await shot('4-block')

// ---- 3. 选中多块时点其中一块：先变成只选它，再点才翻 ----
await click(c1)
check('选中多块时点其中一块：只选中这一块', await onlySelected(p1))
check('选中多块时点其中一块：不翻面', (await side(p1)) === 1)
await click(c1)
check('接着再点：翻面', (await side(p1)) === -1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销回到上面', (await side(p1)) === 1)

// ---- 4. Shift / Ctrl 点已选中的面板：不翻面 ----
await click(c1, ['Shift'])
check('Shift 点已选中的面板：不翻面', (await side(p1)) === 1)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
await click(c1, ['Control'])
check('Ctrl 点已选中的面板：不翻面', (await side(p1)) === 1)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
await click(c1, ['Meta'])
check('⌘ 点已选中的面板：不翻面', (await side(p1)) === 1)

// ---- 5. 拖动已选中的面板：不翻面 ----
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
check('拖动之前只选中第一块板', await onlySelected(p1))
const modelJson = () => page.evaluate(() => JSON.stringify(window.__quadroDev.model.toJSON()))
async function drag(p) {
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x + i * 12, p.y); await page.waitForTimeout(30) }
  await page.mouse.up()
  await page.waitForTimeout(PAUSE)
}
// 单独一块板挂在它那对管上，自己挪不动：拖了只是没动，也不翻
const before = await modelJson()
await drag(c1)
check('拖动单独选中的面板：不翻面', (await side(p1)) === 1)
check('拖动单独选中的面板：造型没变', (await modelJson()) === before)
// 选着整块拖：真的挪了，也不翻
await page.mouse.dblclick(c1.x, c1.y)
await page.waitForTimeout(PAUSE)
check('双击选中整块', (await selected()).length > 2)
await drag(c1)
check('拖动选中的整块：真的挪了', (await modelJson()) !== before)
check('拖动选中的整块：不翻面', (await side(p1)) === 1)
await shot('5-dragged')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('拖动撤销以后回到原样', (await modelJson()) === before)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await page.waitForTimeout(300)

// ---- 6. 点没选中的另一块：只选中它 ----
await click(c2)
check('点没选中的第二块：只选中它', await onlySelected(p2))
check('点没选中的第二块：两块都不翻', (await side(p1)) === 1 && (await side(p2)) === 1)

// ---- 7. 面板后面压着零件：再点是翻面，不往里选；管子照旧往里选 ----
// 找一处最前面是 front、后面还压着别的零件的地方
const spot = (front) => page.evaluate((front) => {
  const { scene } = window.__quadroDev
  const r = scene.renderer.domElement.getBoundingClientRect()
  for (let y = r.top + 5; y < r.bottom; y += 3) {
    for (let x = r.left + 5; x < r.right; x += 3) {
      const hits = scene.pickAllForDelete(x, y)
      if (hits.length > 1 && hits[0].data.id === front) return { x, y, behind: hits[1].data.id }
    }
  }
  return null
}, front)
const deep = await spot(p1)
check(`找到面板后面还压着 ${deep && deep.behind} 的一处`, !!deep)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(deep)
check('那一处先点：选中面板', await onlySelected(p1))
await click(deep)
check('隔一会儿在同一处再点：翻面', (await side(p1)) === -1)
check('隔一会儿在同一处再点：还选着面板，没有往里选', await onlySelected(p1))
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销回到上面', (await side(p1)) === 1)
// 管子（不是面板）照旧：同一处隔一会儿再点就选它后面那件
let tubeId = null, tubeSpot = null
for (const id of await page.evaluate(() => [...window.__quadroDev.model.tubes.keys()])) {
  tubeSpot = await spot(id)
  if (tubeSpot) { tubeId = id; break }
}
check(`找到管子 ${tubeId} 后面还压着 ${tubeSpot && tubeSpot.behind} 的一处`, !!tubeSpot)
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(tubeSpot)
check('那一处先点：选中管子', await onlySelected(tubeId))
await click(tubeSpot)
check(`选着管子隔一会儿在同一处再点：改选后面那件（${tubeSpot.behind}）`, await onlySelected(tubeSpot.behind))
await shot('5-tube-deeper')
check('面板都没翻', (await side(p1)) === 1 && (await side(p2)) === 1)

// ---- 7b. 成组的两块板：点一块选中整组，再点只翻点到的那块 ----
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
await click(c2, ['Shift'])
check('Shift 点第二块：两块都选着', (await selected()).length === 2)
await page.keyboard.press('Meta+g')
await page.waitForTimeout(300)
check('⌘G 把两块板成组', await page.evaluate(([a, b]) => {
  const { model } = window.__quadroDev
  const g = model.groupOf(a)
  return !!g && g === model.groupOf(b)
}, [p1, p2]))
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await page.waitForTimeout(300)
await click(c1)
check('点成组的第一块：整组两块都选中', (await selected()).sort().join() === [p1, p2].sort().join())
await click(c1)
check('再点：点到的第一块翻面', (await side(p1)) === -1)
check('再点：同组的第二块不翻', (await side(p2)) === 1)
await shot('5-group-flipped')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销翻面', (await side(p1)) === 1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销成组', await page.evaluate((a) => !window.__quadroDev.model.groupOf(a), p1))

// ---- 7c. 翻面还排着的时候按撤销：撤的就是这次翻面 ----
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
const depth3 = await undoDepth()
await page.mouse.click(c1.x, c1.y)
await page.waitForTimeout(100)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(PAUSE)
check('排着翻面时按撤销：面板还在上面', (await side(p1)) === 1)
check('排着翻面时按撤销：撤销栈回到点之前', (await undoDepth()) === depth3)
check('排着翻面时按撤销：能重做这次翻面', await page.evaluate(() => window.__quadroDev.builder.canRedo()))
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(300)
check('重做：翻到下面', (await side(p1)) === -1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('再撤销回到上面', (await side(p1)) === 1)

// ---- 7d. 翻面还排着的时候点别处：先翻完，再照常处理这一下 ----
// 顺带记下哪些零件又放了一遍落下来的入场动效：点选着的面板不该让旁边的零件重新落一遍
// （落的时候点选用的碰撞体也跟着在半空，紧接着点旁边那块会点空）
await page.evaluate(() => {
  const { scene } = window.__quadroDev
  window.__replayed = []
  const orig = scene._motionAfterRender.bind(scene)
  scene._motionAfterRender = (old, opts) => {
    const before = new Set(scene._appearing.keys())
    const r = orig(old, opts)
    for (const k of scene._appearing.keys()) if (!before.has(k)) window.__replayed.push(k)
    return r
  }
})
await page.evaluate(() => window.__quadroDev.builder.clearSelection())
await click(c1)
await page.mouse.click(c1.x, c1.y)
await page.waitForTimeout(100)
await page.mouse.click(c2.x, c2.y)
check('点选着的面板、翻面：没有零件重新放入场动效', (await page.evaluate(() => window.__replayed)).length === 0)
check('排着翻面时点第二块：第一块马上翻了', (await side(p1)) === -1)
await page.waitForTimeout(PAUSE)
check('点第二块：改选第二块', await onlySelected(p2))
check('点第二块：第二块不翻', (await side(p2)) === 1)
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('撤销回到上面', (await side(p1)) === 1)

// ---- 8. 共享方案标签页：别处修改读回以后照样能翻；只能看时不翻 ----
await page.evaluate(() => {
  const { builder, model } = window.__quadroDev
  model.idTag = 'k7:'
  builder.applyExternal(builder.history.toJSON())
  builder.clearSelection()
})
await click(c1)
check('共享方案：点面板选中它', await onlySelected(p1))
await click(c1)
check('共享方案：再点翻面', (await side(p1)) === -1)
// 共享方案的文档（Yjs，发给别人的就是它）里也翻了；没写 side 和模型一样算在上面
const docSide = (id) => page.evaluate((id) => {
  const p = window.__quadroDev.builder.history.toJSON().panels.find((q) => q.id === id)
  return p.side < 0 ? -1 : 1
}, id)
check('共享方案：翻面写进了共享文档', (await docSide(p1)) === -1)
await shot('6-plan-flipped')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('共享方案：撤销', (await side(p1)) === 1)
check('共享方案：撤销也写进了共享文档', (await docSide(p1)) === 1)
await page.evaluate(() => {
  const { builder } = window.__quadroDev
  builder.setReadOnly(true)
  builder.clearSelection()
})
await click(c1)
check('只能看：点面板照样选中', await onlySelected(p1))
const roDepth = await undoDepth()
await click(c1)
check('只能看：再点不翻面', (await side(p1)) === 1)
check('只能看：没有记撤销', (await undoDepth()) === roDepth)
check('只能看：没有弹「只能查看」的提示', !(await toast()).includes('只能查看'))
await shot('7-readonly')
await page.evaluate(() => { const { builder, model } = window.__quadroDev; builder.setReadOnly(false); model.idTag = '' })

// ---- 9. 触屏：点一下选中，隔一会儿再点一下就翻 ----
await page.context().close()
page = await openPage({ hasTouch: true })
const touch = await loadSettled()
const tap = async (p) => { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(PAUSE) }
await tap(touch.c1)
check('触屏：点一下选中面板', await onlySelected(touch.p1))
check('触屏：输入方式认成触屏', await page.evaluate(() => window.__quadroDev.builder.inputType === 'touch'))
await tap(touch.c1)
check('触屏：再点一下翻面', (await side(touch.p1)) === -1)
await shot('8-touch-flipped')
await tap(touch.c2)
check('触屏：点没选中的第二块只选中它，不翻', await onlySelected(touch.p2) && (await side(touch.p2)) === 1)

await browser.close()
console.log(`\n${ok} 项通过`)
