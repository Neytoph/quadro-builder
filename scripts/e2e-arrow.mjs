// 加管模式里真按方向键：空白放第一个接头、键盘接管、鼠标加完一根接着按、点选接头、从选择模式带着
// 一根管或一个接头切过来、从面板模式切过来、不知道从哪接时的提示、共享方案标签页（本端 id 标记、
// 别处修改读回、只能看）的情况。
// 运行：先起开发服务 npx vite --port 5230 --strictPort，再 node scripts/e2e-arrow.mjs
// 截图存到 SHOTS（默认 ../qb-shots），文件名 arrow-*。
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

const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}arrow-${name}.png` }) }
const toast = () => page.evaluate(() => document.querySelector('.m-toast:not(.m-leave)')?.textContent || '')

// 相机正对 yaw 0：→ 是 +x，← 是 -x；↑ 平视时往上，从上面斜看时往相机前方
const upDir = () => page.evaluate(() => {
  const { scene } = window.__quadroDev
  return scene.isFrontalView() ? [0, 1, 0] : scene.getHorizontalAxes().forward.map((v) => Math.round(v))
})
// 摆正镜头，等零件落下来的动效放完再点
const frame = async () => {
  await page.evaluate(() => {
    const { model, scene } = window.__quadroDev
    scene.frameFromYaw(model, 0, { silent: true, margin: 2.2 })
  })
  await page.waitForTimeout(1500)
}

// 清空，换成 build(model) 摆出来的造型，当作刚打开的一座（没有点选、没有刚加的接头）
const load = (src) => page.evaluate((src) => {
  const { model, builder } = window.__quadroDev
  builder.setMode('select')
  builder.recordHistory(() => { model.clear(); new Function('model', src)(model) })
  builder.modelReplaced()
  builder.refresh()
}, src)

const tubes = () => page.evaluate(() => {
  const { model } = window.__quadroDev
  return [...model.tubes.values()].filter((t) => !t.link).map((t) => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b)
    return { id: t.id, a: t.a, b: t.b, pa: [a.x, a.y, a.z], pb: [b.x, b.y, b.z] }
  })
})
const nodeAt = (p) => page.evaluate((p) => {
  const n = window.__quadroDev.model.findNodeNear(p[0], p[1], p[2])
  return n ? n.id : null
}, p)
const state = () => page.evaluate(() => {
  const { builder } = window.__quadroDev
  return { mode: builder.mode, sel: builder.selectedNodeId, selection: builder.selection.size }
})
const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.01
const plus = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]

// 按一下方向键，返回新长出来的那根管（从哪个点到哪个点）
async function press(key) {
  const before = new Set((await tubes()).map((t) => t.id))
  await page.keyboard.press(key)
  await page.waitForTimeout(120)
  const added = (await tubes()).filter((t) => !before.has(t.id))
  return added
}
// 新管是不是从 from 往 dir 接出去的
const grewFrom = (added, from, dir, span) => added.length === 1 &&
  ((same(added[0].pa, from) && same(added[0].pb, plus(from, dir, span))) ||
   (same(added[0].pb, from) && same(added[0].pa, plus(from, dir, span))))

// 世界坐标 → 窗口坐标
const toScreen = (p) => page.evaluate((p) => {
  const { scene } = window.__quadroDev
  scene.renderer.render(scene.scene, scene.camera)
  const v = scene.camera.position.clone().set(p[0], p[1], p[2]).project(scene.camera)
  const r = scene.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
}, p)
// 某个接头往 dir 的加管锚点，取它看得见的碰撞体中心
const handlePoint = (nodeId, dir) => page.evaluate(([nodeId, dir]) => {
  const { scene } = window.__quadroDev
  const hit = scene.handleMeshes.find((m) => m.visible && m.userData.nodeId === nodeId && m.userData.dir &&
    m.userData.dir.every((v, i) => Math.abs(v - dir[i]) < 1e-6))
  if (!hit) return null
  scene.renderer.render(scene.scene, scene.camera)
  const v = hit.getWorldPosition(hit.position.clone()).project(scene.camera)
  const r = scene.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
}, [nodeId, dir])
async function clickAt(p) {
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(150)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(200)
  // 鼠标挪开，免得悬停亮线挡截图
  await page.mouse.move(1380, 880)
}

const SPAN = 40 // 35 cm 的管
const X = [1, 0, 0], NX = [-1, 0, 0], UP = [0, 1, 0]

// ---- 1. 空白标签页：键盘放第一个接头、接一根 ----
await load('')
await frame()
await page.keyboard.press('b')
check('按 B 进加管模式', (await state()).mode === 'add')
check('空白按 → 放下第一个接头', (await press('ArrowRight')).length === 0 &&
  await page.evaluate(() => window.__quadroDev.model.nodes.size === 1))
const origin = [0, 0, 0]
let added = await press('ArrowRight')
check('再按 → 从第一个接头往右接一根', grewFrom(added, origin, X, SPAN))
await frame()
await shot('1-keyboard')

// ---- 2. 鼠标加一根，方向键接着从新端点长 ----
const right = [SPAN, 0, 0]
const rightId = await nodeAt(right)
const h = await handlePoint(rightId, UP)
check('右端有往上的加管锚点', !!h)
const beforeMouse = new Set((await tubes()).map((t) => t.id))
await clickAt(h)
const mouseTube = (await tubes()).filter((t) => !beforeMouse.has(t.id))
const top = plus(right, UP, SPAN)
check('鼠标点锚点往上加了一根', mouseTube.length === 1 && [mouseTube[0].pa, mouseTube[0].pb].some((p) => same(p, top)))
check('鼠标加完不高亮新端点', (await state()).sel === null)
added = await press('ArrowLeft')
check('鼠标加完按 ← ：从新端点往左接', grewFrom(added, top, NX, SPAN))
const top2 = plus(top, NX, SPAN)
added = await press('ArrowUp')
const fwd = await upDir()
check(`接着按 ↑ ：从刚接出的端点往 ${fwd} 接`, grewFrom(added, top2, fwd, SPAN))
await frame()
await shot('2-after-mouse')

const selected = () => page.evaluate(() => [...window.__quadroDev.builder.selection])

// ---- 3. 选择模式里用鼠标点一个接头，按 B 切到加管，方向键从它接 ----
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
check('Esc 回到选择模式', (await state()).mode === 'select')
await clickAt(await toScreen(origin))
const originId = await nodeAt(origin)
check('选择模式点第一个接头：选中它', JSON.stringify(await selected()) === JSON.stringify([[originId, 'node']]))
await shot('3-node-selected')
await page.keyboard.press('b')
added = await press('ArrowLeft')
check('带着选中的接头按 B 再按 ← ：从这个接头往左接', grewFrom(added, origin, NX, SPAN))
await frame()
await shot('3-from-node')

// ---- 4. 选择模式里用鼠标点一根管，按 B 切到加管，方向键从它合适的那头接 ----
await load(`
  const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0), c = model.addNode(40, 40, 0), d = model.addNode(0, 40, 0)
  model.addTube(a.id, b.id, 'T35', 'blue', 35); model.addTube(b.id, c.id, 'T35', 'red', 35)
  model.addTube(c.id, d.id, 'T35', 'blue', 35); model.addTube(d.id, a.id, 'T35', 'red', 35)
`)
await frame()
const topTube = (await tubes()).find((t) => t.pa[1] === 40 && t.pb[1] === 40)
await clickAt(await toScreen([20, 40, 0]))
check('选择模式点顶上那根管：选中它', JSON.stringify(await selected()) === JSON.stringify([[topTube.id, 'tube']]))
added = await press('ArrowRight')
check('选择模式里选中一根管按 → ：照旧挪动它，不长管', added.length === 0 && (await state()).mode === 'select')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(200)
check('撤销挪动：顶上那根管回到原处', (await tubes()).some((t) => t.id === topTube.id && same(t.pa, topTube.pa)))
await clickAt(await toScreen([20, 40, 0]))
await shot('4-tube-selected')
await page.keyboard.press('b')
added = await press('ArrowRight')
check('带着选中的顶上那根管按 B 再按 → ：从它右端往右接', grewFrom(added, [40, 40, 0], X, SPAN))
const tip4 = [80, 40, 0]
added = await press('ArrowUp')
const up4 = await upDir()
check(`再按 ↑ ：从刚接出的端点往 ${up4} 接`, grewFrom(added, tip4, up4, SPAN))
await frame()
await shot('4-from-tube')

// ---- 5. 从面板模式切过来 ----
const tip5 = plus(tip4, up4, SPAN)
await page.keyboard.press('p')
check('按 P 进面板模式', (await state()).mode === 'panel')
added = await press('ArrowLeft')
check('面板模式按 ← ：切回加管，从上次接出的端点往左接', (await state()).mode === 'add' && grewFrom(added, tip5, NX, SPAN))

// ---- 6. 选择模式什么也没选按方向键：切到加管，接着上次的端点 ----
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
check('Esc 回到选择模式', (await state()).mode === 'select')
added = await press('ArrowLeft')
check('选择模式没选中东西按 ← ：切到加管，接着上次的端点往左接', (await state()).mode === 'add' && grewFrom(added, plus(tip5, NX, SPAN), NX, SPAN))
await frame()
await shot('6-from-select')

// ---- 7. 刚打开一座只有一根管的造型：往管子方向从前面那头接 ----
await load(`const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0); model.addTube(a.id, b.id, 'T35', 'blue', 35)`)
await frame()
await page.keyboard.press('b')
added = await press('ArrowLeft')
check('只有一根管、没有点选：按 ← 从左端往左接', grewFrom(added, [0, 0, 0], NX, SPAN))

// ---- 8. 不知道从哪接：给提示，不长管 ----
await load(`
  const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0), c = model.addNode(40, 40, 0)
  model.addTube(a.id, b.id, 'T35', 'blue', 35); model.addTube(b.id, c.id, 'T35', 'red', 35)
`)
await frame()
await page.keyboard.press('b')
added = await press('ArrowRight')
const tip9 = await toast()
check(`没有点选的接头按 → ：不长管，提示「${tip9}」`, added.length === 0 && tip9.includes('先点一个接头'))
await shot('8-hint')

// ---- 9. 共享方案标签页：新零件 id 带本端标记，别处的修改读回来以后照样接 ----
await load(`const a = model.addNode(0, 0, 0), b = model.addNode(40, 0, 0); model.addTube(a.id, b.id, 'T35', 'blue', 35)`)
await page.evaluate(() => { window.__quadroDev.model.idTag = 'k7:' })
await frame()
await page.keyboard.press('b')
const bId = await nodeAt([40, 0, 0])
await clickAt(await handlePoint(bId, UP))
const planTop = [40, 40, 0]
check('共享方案：鼠标加的新接头 id 带本端标记', (await nodeAt(planTop)).includes('k7:'))
// 别人改了一处：文档里整座读回（和收到远端修改时走同一条路）
await page.evaluate(() => {
  const { builder, model } = window.__quadroDev
  const json = builder.history.toJSON()
  builder.applyExternal(json)
  return model.nodes.size
})
added = await press('ArrowRight')
check('共享方案：别处修改读回以后按 → ：从新端点往右接', grewFrom(added, planTop, X, SPAN))
await frame()
await shot('9-plan')
// 只能看：按方向键不改动，提示只能看
await page.evaluate(() => window.__quadroDev.builder.setReadOnly(true))
added = await press('ArrowRight')
const tip10 = await toast()
check(`只能看的共享方案按 → ：不长管，提示「${tip10}」`, added.length === 0 && tip10.includes('只能查看'))
check('只能看时按方向键不切到加管模式', (await state()).mode === 'select')
await page.evaluate(() => { const { builder, model } = window.__quadroDev; builder.setReadOnly(false); model.idTag = '' })

await browser.close()
console.log(`\n${ok} 项通过`)
