// 画房间边界联调：建一张需求单草稿，打开 /builder/?room=brief:<id>，画一个 L 形房间、一扇窗、一扇门，
// 完成以后回到需求单页，再从接口读回 room 核对。运行：node scripts/e2e-room.mjs（联调环境 9110）。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { localStorage.setItem('quadro.lang', 'zh'); localStorage.setItem('quadro-builder-lang', 'zh') })
assert.equal((await ctx.request.post('/signin', { form: { identifier: 'pro-owner', password: 'hunter2hunter' } })).status(), 200)
const created = await ctx.request.post('/quadro/briefs', { data: { region: '上海 · 闵行', room: { w: 300, d: 400, h: 240 }, kids: [{ age: 36 }], budget: 6000, wants: '滑梯' } })
assert.equal(created.status(), 201, await created.text())
const briefId = (await created.json()).id
check(`建了需求单草稿 ${briefId}`, !!briefId)

const page = await ctx.newPage()
page.on('pageerror', (e) => { console.error('pageerror', e.message); process.exitCode = 1 })
await page.goto(`/builder/?room=brief:${briefId}`)
await page.locator('[data-ui=room-editor]').waitFor()
check('打开画房间：左边面板、俯视平面图', await page.locator('[data-ui=room-plan]').isVisible())

// 平面图上的厘米坐标换成窗口坐标再点
const at = (x, z) => page.evaluate(([px, pz]) => {
  const svg = document.querySelector('[data-ui=room-plan]')
  const p = new DOMPoint(px, pz).matrixTransform(svg.getScreenCTM())
  return [p.x, p.y]
}, [x, z])
const click = async (x, z) => { const [cx, cy] = await at(x, z); await page.mouse.click(cx, cy) }

for (const [x, z] of [[0, 0], [320, 0], [320, 260], [90, 260], [90, 200], [0, 200], [0, 0]]) await click(x, z)
check('六个角闭合成 L 形', await page.locator('[data-ui=room-editor]').getByText('320').first().isVisible())
await page.locator('[data-ui=room-window]').click()
await click(120, 0); await click(200, 0)
await page.locator('[data-ui=room-door]').click()
await click(0, 140); await click(0, 60)
check('一扇窗、一扇门列在面板上', await page.locator('.cb-open div').count() === 2)
await page.locator('[data-ui=room-h]').fill('265')
// 选中一条边直接输长度：第 3 条边（320,260 → 90,260）改成 230，终点挪到 90
await page.locator('[data-ui=room-wall]').click()
await click(200, 260)
await page.locator('[data-ui=room-edge-pop]').waitFor()
check('选中一条边弹出长度框', await page.locator('[data-ui=room-edge-pop] input').inputValue() === '230')
await page.screenshot({ path: `${SHOTS}room-1-draw.png` })

await Promise.all([
  page.waitForURL(/\/brief\.html\?id=/, { timeout: 15000 }),
  page.locator('[data-ui=room-save]').click(),
])
check('完成以后回到需求单页', new URL(page.url()).searchParams.get('id') === String(briefId))
const brief = await (await ctx.request.get(`/quadro/briefs/${briefId}`)).json()
const room = brief.room
check(`写回的宽深高 ${room.w}×${room.d}×${room.h}`, room.w === 320 && room.d === 260 && room.h === 265)
check('轮廓六个点，从左上角开始顺时针', room.outline.length === 6 && room.outline[0][0] === 0 && room.outline[0][1] === 0 && room.outline[1][0] === 320)
const win = room.openings.find((o) => o.kind === 'window')
const door = room.openings.find((o) => o.kind === 'door')
check('窗在第一条边 120–200 cm', win && win.edge === 0 && win.from === 120 && win.to === 200)
check('门在最后一条边上，宽 80 cm', door && door.edge === 5 && door.to - door.from === 80)

// 再打开一次：画过的边界接着显示
const again = await ctx.newPage()
await again.goto(`/builder/?room=brief:${briefId}`)
await again.locator('[data-ui=room-editor]').waitFor()
check('再打开时画过的边界还在', await again.locator('[data-ui=room-corner]').count() === 6)
await again.screenshot({ path: `${SHOTS}room-2-reopen.png` })

await browser.close()
console.log(`${ok} 项通过`)
