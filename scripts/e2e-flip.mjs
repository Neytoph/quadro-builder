// 选择模式里真用鼠标点面板：选中后隔一会儿再点就翻面、撤销；快速连点两下是选整块；Shift / Ctrl 点、
// 拖动、点没选中的面板都不翻面；选中多块时先点成只选这一块、再点才翻；面板后面压着零件时
// 再点也是翻面，管子、接头照旧隔一会儿在同一处再点就往里选；共享方案标签页照样能翻，只能看时不翻。
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

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.addInitScript(() => {
  localStorage.setItem('quadro.builder.onboarded.v2', '1')
  localStorage.setItem('quadro.lang', 'zh')
  localStorage.setItem('quadro-builder-lang', 'zh')
})
const page = await ctx.newPage()
page.on('pageerror', (e) => { console.error('pageerror', e); process.exitCode = 1 })
await page.goto(BASE)
await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('canvas'))
await page.waitForTimeout(600)

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

// ---- 1. 选中 → 再点翻面 → 撤销 ----
const [p1, p2] = await load()
const c1 = await toScreen([20, 0, 20])
const c2 = await toScreen([60, 0, 20])
// 零件落下来的动效放完，点选用的碰撞体才到位
await page.waitForFunction(([c, id]) => window.__quadroDev.scene.pickAllForDelete(c.x, c.y)[0]?.data.id === id,
  [c1, p1], { timeout: 10000 })
await page.waitForTimeout(500)
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
await shot('6-plan-flipped')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
check('共享方案：撤销', (await side(p1)) === 1)
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
await shot('7-readonly')
await page.evaluate(() => { const { builder, model } = window.__quadroDev; builder.setReadOnly(false); model.idTag = '' })

await browser.close()
console.log(`\n${ok} 项通过`)
