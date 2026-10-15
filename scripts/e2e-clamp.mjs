// 双管连接的第二根管在浏览器里走一遍：摆好第一根管和夹子，真的用鼠标点夹子空孔上的绿色点放第二根，
// 看它和第一根怎么对齐；再走撤销重做、刷新后还在、导出 .qdf、料表和拼装说明。
// 运行：先起开发服务 npx vite --port 5230 --strictPort，再 node scripts/e2e-clamp.mjs
// 截图存到 SHOTS（默认 ../qb-shots），文件名 clamp-*。
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

// 清空后摆第一根管（节点间距按管长加一个连接件）和夹子。axis 是管子方向，t 是夹子离起点多远，
// off 是空孔那一侧。返回第一根管两端。
const setup = (c) => page.evaluate((c) => {
  const { model, builder, scene } = window.__quadroDev
  const U = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[c.axis]
  const span = c.baseLen + 5
  const o = [0, c.axis === 'y' ? 0 : 20, 0]
  const at = (s) => [o[0] + U[0] * s, o[1] + U[1] * s, o[2] + U[2] * s]
  builder.setMode('select')
  builder.recordHistory(() => {
    model.clear()
    const a = model.addNode(...o)
    const b = model.addNode(...at(span))
    model.addTube(a.id, b.id, 'T' + c.baseLen, 'blue', c.baseLen)
    const k = model.addClamp(...at(c.t), 'double_tube')
    k.dir = U.slice()
    k.off = c.off.map((v) => v * 5)
  })
  builder.setMode('add')
  builder.setTube('T' + c.secondLen)
  builder.refresh()
  scene.frameFromYaw(model, 0, { silent: true, margin: 1.6 })
  return { lo: o, hi: at(span) }
}, c)

// 夹子空孔上那个点在屏幕上的位置（取它看得见的那个碰撞体中心）。
const openingPoint = () => page.evaluate(() => {
  const { scene } = window.__quadroDev
  const hit = scene.handleMeshes.find((m) => m.userData.clampOpening && m.visible)
  if (!hit) return null
  scene.renderer.render(scene.scene, scene.camera)
  const v = hit.getWorldPosition(hit.position.clone()).project(scene.camera)
  const r = scene.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
})

// 第二根管（不是第一根、也不是连接）两端，按沿管方向从小到大。
const secondTube = (axis) => page.evaluate((axis) => {
  const { model } = window.__quadroDev
  const i = { x: 0, y: 1, z: 2 }[axis]
  const real = [...model.tubes.values()].filter((t) => !t.link)
  const t = real[real.length - 1]
  const p = [model.nodes.get(t.a), model.nodes.get(t.b)].map((n) => [n.x, n.y, n.z]).sort((a, b) => a[i] - b[i])
  const links = [...model.tubes.values()].filter((l) => l.link).length
  return { tubes: real.length, links, lo: p[0], hi: p[1], tubeId: t.tubeId }
}, axis)

const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.01
const plus = (p, off) => [p[0] + off[0] * 5, p[1] + off[1] * 5, p[2] + off[2] * 5]

async function place(c) {
  const base = await setup(c)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}clamp-${c.name}-1-before.png` })
  const pt = await openingPoint()
  check(`${c.name}：夹子空孔上有绿色点`, !!pt)
  await page.mouse.move(pt.x, pt.y)
  await page.waitForTimeout(150)
  await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(300)
  const s = await secondTube(c.axis)
  check(`${c.name}：放上了第二根 ${s.tubeId}`, s.tubes === 2 && s.tubeId === 'T' + c.secondLen)
  await page.evaluate(() => { const { builder, scene, model } = window.__quadroDev; builder.setMode('select'); scene.frameFromYaw(model, 0, { silent: true, margin: 1.6 }) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}clamp-${c.name}-2-after.png` })
  console.log(`   第一根 ${JSON.stringify(base.lo)} → ${JSON.stringify(base.hi)}，第二根 ${JSON.stringify(s.lo)} → ${JSON.stringify(s.hi)}，连接 ${s.links}`)
  return { base, s }
}

// 1. 一样长，夹子在中间：两端都对齐，两端各连上一根连接
{
  const c = { name: 'x-same-mid', axis: 'x', baseLen: 75, secondLen: 75, t: 40, off: [0, 0, 1] }
  const { base, s } = await place(c)
  check('一样长：两端和第一根对齐', same(s.lo, plus(base.lo, c.off)) && same(s.hi, plus(base.hi, c.off)))
  check('一样长：两端各有一根连接', s.links === 2)
}

// 2. 一样长，竖着，夹子靠近上端
{
  const c = { name: 'y-same-end', axis: 'y', baseLen: 75, secondLen: 75, t: 65, off: [1, 0, 0] }
  const { base, s } = await place(c)
  check('竖管一样长：两端对齐', same(s.lo, plus(base.lo, c.off)) && same(s.hi, plus(base.hi, c.off)))
}

// 3. 第二根更长，沿 z，夹子靠近远端：和远端对齐
{
  const c = { name: 'z-longer-end', axis: 'z', baseLen: 35, secondLen: 75, t: 32, off: [1, 0, 0] }
  const { base, s } = await place(c)
  check('第二根更长：和夹子近的那一端对齐', same(s.hi, plus(base.hi, c.off)))
  check('第二根更长：那一端有连接', s.links === 1)
}

// 4. 第二根更短，沿 x，夹子靠近起点：和起点对齐
{
  const c = { name: 'x-shorter-end', axis: 'x', baseLen: 75, secondLen: 35, t: 12, off: [0, 0, 1] }
  const { base, s } = await place(c)
  check('第二根更短：和夹子近的那一端对齐', same(s.lo, plus(base.lo, c.off)))
}

// 5. 第二根更短，竖着，夹子在中间：和下端对齐
{
  const c = { name: 'y-shorter-mid', axis: 'y', baseLen: 75, secondLen: 52, t: 40, off: [1, 0, 0] }
  const { base, s } = await place(c)
  check('竖管更短、夹子在中间：和下端对齐', same(s.lo, plus(base.lo, c.off)))
}

// 6. 第二根短到哪一端都夹不住：以夹子为中心
{
  const c = { name: 'x-shorter-center', axis: 'x', baseLen: 75, secondLen: 35, t: 40, off: [0, 0, 1] }
  const { base, s } = await place(c)
  check('夹不住：以夹子为中心摆', same(s.lo, plus([base.lo[0] + 20, base.lo[1], base.lo[2]], c.off)))
}

// 7. 撤销、重做、刷新、导出、料表、拼装说明（用第 1 种）
{
  const c = { name: 'x-flow', axis: 'x', baseLen: 75, secondLen: 75, t: 40, off: [0, 0, 1] }
  const { base, s } = await place(c)
  await page.locator('canvas').first().click({ position: { x: 20, y: 880 } })
  await page.keyboard.press('ControlOrMeta+z')
  await page.waitForTimeout(250)
  check('撤销：第二根管和连接都没了', (await page.evaluate(() => window.__quadroDev.model.tubes.size)) === 1)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await page.waitForTimeout(250)
  const r = await secondTube(c.axis)
  check('重做：第二根回到对齐的位置', r.tubes === 2 && r.links === 2 && same(r.lo, s.lo) && same(r.hi, s.hi))
  await page.waitForTimeout(800)
  await page.reload()
  await page.waitForFunction(() => window.__quadroDev?.model?.tubes.size > 0)
  await page.waitForTimeout(800)
  const back = await secondTube(c.axis)
  check('刷新后还在原位', back.tubes === 2 && back.links === 2 && same(back.lo, plus(base.lo, c.off)))
  const out = await page.evaluate(async () => {
    const { model } = window.__quadroDev
    const { buildQDF } = await import('/src/engine/qdfexport.js')
    const { parseQDF } = await import('/src/engine/qdfimport.js')
    const { computeBOM } = await import('/src/engine/bom.js')
    const { computeBuildPlan } = await import('/src/engine/buildplan.js')
    const { buildableTubes, panels, geometry } = await import('/src/engine/catalog.js')
    const { BuildModel } = await import('/src/engine/model.js')
    const qdf = buildQDF(model)
    const text = typeof qdf === 'string' ? qdf : qdf.text
    const data = parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const m2 = new BuildModel()
    const loaded = m2.loadJSON(data)
    const ends = (m) => [...m.tubes.values()].filter((t) => !t.link)
      .map((t) => [m.nodes.get(t.a), m.nodes.get(t.b)].map((n) => [n.x, n.y, n.z].join(',')).sort().join(' '))
      .sort()
    const bom = computeBOM(model)
    const plan = computeBuildPlan(model)
    return {
      loaded: loaded.ok,
      same: JSON.stringify(ends(model)) === JSON.stringify(ends(m2)),
      clamps: m2.clamps.size,
      t75: bom.tubes.filter((t) => t.tubeId === 'T75').reduce((s, t) => s + t.count, 0),
      clampParts: bom.connectors.filter((c) => c.type === 'double_tube').reduce((s, c) => s + c.count, 0),
      bom: JSON.stringify(bom.connectors.map((c) => [c.type, c.count])),
      steps: plan.steps ? plan.steps.length : (plan.levels || plan).length,
    }
  })
  check('导出 .qdf 再读回：两根管位置一样', out.loaded && out.same)
  check('导出 .qdf 再读回：夹子还在', out.clamps === 1)
  check('料表里有两根 75 的管和一个双管连接', out.t75 === 2 && out.clampParts === 1)
  check('拼装说明算得出来', out.steps > 0)
  console.log(`   料表里的连接件 ${out.bom}`)
}

console.log(`\n全部 ${ok} 项通过`)
await browser.close()
