// 短布面（20×40）在浏览器里走一遍：从布件菜单选它，真的用鼠标点两根管放上去；间距不对的管点了给提示；
// 再走撤销重做、整体旋转、删除、刷新后还在、料表、导出 .qdf 再读回、拼装说明。
// 运行：先起开发服务 npx vite --port 5230 --strictPort，再 node scripts/e2e-textile.mjs
// 截图存到 SHOTS（默认 ../qb-shots），文件名 textile-*。
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

// 清空后搭两个竖立的框：左边宽 20（上下两根 15 管）高 40，右边宽 20 高 80（没有相距 40 的管）
await page.evaluate(() => {
  const { model, builder, scene } = window.__quadroDev
  builder.setMode('select')
  builder.recordHistory(() => {
    model.clear()
    const frame = (x0, w, h, tw, th) => {
      const a = model.addNode(x0, 0, 0), b = model.addNode(x0 + w, 0, 0)
      const c = model.addNode(x0 + w, h, 0), d = model.addNode(x0, h, 0)
      model.addTube(a.id, b.id, 'T' + tw, 'blue', tw)
      model.addTube(d.id, c.id, 'T' + tw, 'blue', tw)
      model.addTube(a.id, d.id, 'T' + th, 'red', th)
      model.addTube(b.id, c.id, 'T' + th, 'red', th)
    }
    frame(0, 20, 40, 15, 35)
    frame(60, 20, 80, 15, 75)
  })
  builder.refresh()
  scene.frameFromYaw(model, 0, { silent: true, margin: 1.4 })
})
await page.waitForTimeout(400)

// 世界坐标投到屏幕
const screenOf = (p) => page.evaluate((p) => {
  const { scene } = window.__quadroDev
  scene.renderer.render(scene.scene, scene.camera)
  const v = scene.camera.position.clone().set(p[0], p[1], p[2]).project(scene.camera)
  const r = scene.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
}, p)
const clickAt = async (p) => { const s = await screenOf(p); await page.mouse.click(s.x, s.y); await page.waitForTimeout(300) }

const state = () => page.evaluate(async () => {
  const { model } = window.__quadroDev
  const { textilePart, loadCatalog } = await import('/src/engine/catalog.js')
  await loadCatalog()
  return [...model.textiles.values()].map((x) => {
    const tb = (id) => model.tubes.get(id)
    return {
      id: x.id, part: textilePart(model.textileSpan(x), x.variant).id, span: model.textileSpan(x),
      rails: [tb(x.a).tubeId, tb(x.b).tubeId], corners: model.panelCorners(x),
    }
  })
})
const toast = (text) => page.getByText(text, { exact: false }).first().isVisible()

// 1. 菜单里有短布面，选中
await page.getByRole('button', { name: '布件' }).first().click()
await page.waitForTimeout(300)
check('布件菜单里有「短布面 20×40」', await page.getByText('短布面 20×40', { exact: true }).isVisible())
await page.screenshot({ path: SHOTS + 'textile-1-menu.png' })
await page.getByText('短布面 20×40', { exact: true }).click()
await page.waitForTimeout(300)
check('选中后放的是短布面', await page.evaluate(() => {
  const { builder } = window.__quadroDev
  return builder.mode === 'fitting' && builder.fittingKind === 'textil2' && builder.fittingPart === 'textile_20x40'
}))

// 2. 点竖着的管（和对面只隔 20）：提示，放不上
await clickAt([0, 20, 0])
check('间距不对：提示对面 40 cm 没有平行的管', await toast('对面 40 cm 处没有平行的管'))
check('间距不对：没放上', (await state()).length === 0)
// 20×80 框的横管：对面隔 80，也不行
await clickAt([70, 0, 0])
check('20×80 框的横管也放不上', (await state()).length === 0)

// 3. 点 20×40 框的下管、上管：放上
await clickAt([10, 0, 0])
check('点第一根管后提示去点对面那根', await toast('根'))
await clickAt([10, 40, 0])
let s = await state()
check('放上一块短布面', s.length === 1 && s[0].part === 'textile_20x40')
check('承重管是两根 15 管，沿管 20、间距 40', s[0].rails.every((r) => r === 'T15') && s[0].span.len === 20 && s[0].span.gap === 40)
check('放下后提示里是短布面的名字', await toast('已放下短布面 20×40'))
await page.waitForTimeout(400)
await page.screenshot({ path: SHOTS + 'textile-2-placed.png' })

// 同一格再点一次：放不上第二块
await clickAt([10, 0, 0])
await clickAt([10, 40, 0])
check('同一格不能叠第二块', (await state()).length === 1)

// 4. 撤销、重做
await page.keyboard.press('Escape')
await page.locator('canvas').first().click({ position: { x: 20, y: 880 } })
await page.keyboard.press('ControlOrMeta+z')
await page.waitForTimeout(250)
check('撤销：短布面没了', (await state()).length === 0)
await page.keyboard.press('ControlOrMeta+Shift+z')
await page.waitForTimeout(250)
s = await state()
check('重做：短布面回来', s.length === 1 && s[0].part === 'textile_20x40')

// 5. 整体旋转：选择模式下双击左边的框选中整块（框和布），按 E 转 90 度
const before = s[0].corners
await page.getByRole('button', { name: '选择' }).first().click()
await page.waitForTimeout(200)
const left = await screenOf([0, 20, 0])
await page.mouse.dblclick(left.x, left.y)
await page.waitForTimeout(300)
const picked = await page.evaluate(() => {
  const { builder } = window.__quadroDev
  return { n: builder.selection.size, textile: [...builder.selection.values()].includes('textile') }
})
check('双击选中整块：四根管和布', picked.textile && picked.n >= 5)
await page.keyboard.press('e')
await page.waitForTimeout(300)
s = await state()
const moved = s.length === 1 && JSON.stringify(s[0].corners) !== JSON.stringify(before)
check('旋转后布跟着框转了', moved)
check('旋转后还是短布面，沿管 20、间距 40', s[0].part === 'textile_20x40' && s[0].span.len === 20 && s[0].span.gap === 40)
await page.screenshot({ path: SHOTS + 'textile-3-rotated.png' })
await page.keyboard.press('ControlOrMeta+z')
await page.waitForTimeout(250)
check('撤销旋转：回到原位', JSON.stringify((await state())[0].corners) === JSON.stringify(before))

// 6. 删除：删除模式点布
await page.evaluate(() => { const { builder } = window.__quadroDev; builder.selection.clear(); builder.setMode('delete') })
await page.waitForTimeout(200)
await clickAt([10, 20, 0])
check('删除模式点布：删掉了', (await state()).length === 0)
await page.keyboard.press('ControlOrMeta+z')
await page.waitForTimeout(250)
check('撤销删除：回来了', (await state()).length === 1)
await page.evaluate(() => window.__quadroDev.builder.setMode('select'))

// 7. 刷新后还在
await page.waitForTimeout(800)
await page.reload()
await page.waitForFunction(() => window.__quadroDev?.model?.tubes.size > 0)
await page.waitForTimeout(800)
s = await state()
check('刷新后还在', s.length === 1 && s[0].part === 'textile_20x40')

// 8. 料表
await page.getByText('零件清单', { exact: true }).first().click()
await page.waitForTimeout(600)
const dock = page.locator('[data-ui="right-dock"]')
check('料表里有「短布面 20×40」一行', await dock.getByText('短布面 20×40', { exact: false }).first().isVisible())
await page.screenshot({ path: SHOTS + 'textile-4-bom.png' })

// 9. 导出 .qdf 再读回、拼装说明
const out = await page.evaluate(async () => {
  const { model } = window.__quadroDev
  const { buildQDF } = await import('/src/engine/qdfexport.js')
  const { parseQDF } = await import('/src/engine/qdfimport.js')
  const { computeBOM } = await import('/src/engine/bom.js')
  const { computeBuildPlan } = await import('/src/engine/buildplan.js')
  const { stepItems } = await import('/src/engine/assemblyManual.js')
  const { buildableTubes, panels, geometry, textilePart, loadCatalog } = await import('/src/engine/catalog.js')
  const { BuildModel } = await import('/src/engine/model.js')
  await loadCatalog()
  const text = buildQDF(model).text
  const line = text.split(/\r?\n/).find((l) => l.startsWith('textil2{'))
  const m2 = new BuildModel()
  const loaded = m2.loadJSON(parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
  const back = [...m2.textiles.values()].map((x) => ({ part: textilePart(m2.textileSpan(x), x.variant).id, span: m2.textileSpan(x) }))
  const bom = computeBOM(model)
  const plan = computeBuildPlan(model)
  const step = plan.steps.find((st) => (st.textileIds || []).length)
  return {
    line, loaded: loaded.ok, back,
    bomRow: bom.textiles.find((r) => r.id === 'textile_20x40'),
    stepRow: step ? stepItems(model, step).find((r) => r.id === 'textile_20x40') : null,
  }
})
check('导出成 textil2，沿管 150、间距 350（毫米）', /, 1, 150\., 0\., 350\., 0\., 0}$/.test(out.line))
check('读回来还是一块短布面', out.loaded && out.back.length === 1 && out.back[0].part === 'textile_20x40' && out.back[0].span.len === 20 && out.back[0].span.gap === 40)
check('料表：短布面 1 块', out.bomRow && out.bomRow.count === 1 && out.bomRow.name === '短布面 20×40')
check('拼装说明：放布那一步列出短布面', out.stepRow && out.stepRow.count === 1 && out.stepRow.name === '短布面 20×40')

console.log(`\n全部 ${ok} 项通过`)
await browser.close()
