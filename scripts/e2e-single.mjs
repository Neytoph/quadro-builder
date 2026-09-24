// 单人造型在浏览器里走一遍：放零件、撤销重做、删除、刷新后还在、保存、旧版会话转换。
// 运行：先起开发服务 npx vite --port 5230 --strictPort，再 node scripts/e2e-single.mjs
// 截图存到 SHOTS（默认 ../qb-shots）。
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const BASE = process.env.BASE || 'http://localhost:5230/'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }

async function open(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.error('pageerror', e); process.exitCode = 1 })
  await page.goto(BASE)
  await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('canvas'))
  await page.waitForTimeout(600)
  return page
}

const count = (page) => page.evaluate(() => {
  const m = window.__quadroDev.model
  return { tubes: m.tubes.size, nodes: m.nodes.size }
})

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.addInitScript(() => {
  localStorage.setItem('quadro.builder.onboarded.v2', '1')
  localStorage.setItem('quadro.lang', 'zh')
  localStorage.setItem('quadro-builder-lang', 'zh')
})
let page = await open(ctx)
await page.locator('canvas').first().click({ position: { x: 700, y: 450 } })

// 放零件：方向键接管
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp']) {
  await page.keyboard.press(key)
  await page.waitForTimeout(120)
}
let c = await count(page)
check(`方向键接了 ${c.tubes} 根管`, c.tubes >= 3)
const built = c.tubes
await page.screenshot({ path: SHOTS + 'single-1-built.png' })

// 撤销、重做
await page.keyboard.press('ControlOrMeta+z')
await page.waitForTimeout(150)
c = await count(page)
check('撤销少一根', c.tubes === built - 1)
await page.keyboard.press('ControlOrMeta+Shift+z')
await page.waitForTimeout(150)
c = await count(page)
check('重做回来', c.tubes === built)

// 删除：全选后删掉，再撤销
await page.keyboard.press('Escape')
await page.keyboard.press('ControlOrMeta+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(150)
c = await count(page)
check('全选删除后没有管', c.tubes === 0)
await page.keyboard.press('ControlOrMeta+z')
await page.waitForTimeout(150)
c = await count(page)
check('撤销删除，管都回来', c.tubes === built)

// 没保存也不丢：刷新后还在
await page.waitForTimeout(700)
await page.reload()
await page.waitForFunction(() => window.__quadroDev?.model)
await page.waitForTimeout(800)
c = await count(page)
check('刷新后未保存的标签页还在', c.tubes === built)

// 保存：Ctrl+S 起名
await page.keyboard.press('ControlOrMeta+s')
await page.getByRole('dialog').locator('input').fill('攀爬架测试')
await page.keyboard.press('Enter')
await page.getByText('已保存「攀爬架测试」').waitFor()
const saved = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('quadro.library.v1')
  req.onsuccess = () => {
    const tx = req.result.transaction('docs', 'readonly')
    const all = tx.objectStore('docs').getAll()
    all.onsuccess = () => resolve(all.result.map((d) => ({ name: d.name, tubes: d.data.tubes.length })))
  }
}))
check('存档里有这一座，管数一致', saved.some((d) => d.name === '攀爬架测试' && d.tubes === built))
await page.screenshot({ path: SHOTS + 'single-2-saved.png' })

// 保存以后再改一步（从一个接头竖着往上接一根，方向键「上」在正视时走的就是这一步），
// 刷新：改动还在，标签页名字是存档名
await page.evaluate(() => {
  const { model, builder } = window.__quadroDev
  const node = [...model.nodes.values()][0]
  builder.setMode('add')
  builder.selectedNodeId = node.id
  builder.buildStep([0, 1, 0])
})
await page.waitForTimeout(150)
c = await count(page)
check('保存后又接了一根', c.tubes === built + 1)
await page.waitForTimeout(700)
await page.reload()
await page.waitForFunction(() => window.__quadroDev?.model)
await page.waitForTimeout(800)
c = await count(page)
check('保存后又接的一根刷新后还在', c.tubes === built + 1)
check('标签页名字是存档名', await page.getByText('攀爬架测试').first().isVisible())
// 开源本地版（没设 VITE_SYNC_BASE）：共享相关的界面一样都不出现
check('开源本地版没有「共享」按钮', !(await page.locator('.cb-cluster, [data-ui=share-enable], [data-ui=plan-share]').count()))
check('开源本地版顶栏没有「评论」「版本」', !(await page.getByRole('button', { name: /^评论|^版本$/ }).count()))
await page.close()

// 批量导入 .qdf：?import=qdf 打开就是导入框，每个文件存成一座造型
page = await open(ctx)
await page.goto(BASE + '?import=qdf')
await page.waitForFunction(() => window.__quadroDev?.model)
await page.locator('[data-ui=batch-import]').waitFor()
const qdf = readFileSync(fileURLToPath(new URL('../src/data/A0128.qdf', import.meta.url)))
await page.locator('[data-ui=batch-import] input[type=file]').setInputFiles([
  { name: 'A0128.qdf', mimeType: 'text/plain', buffer: qdf },
  { name: 'kaputt.qdf', mimeType: 'text/plain', buffer: Buffer.from('<nothing/>') },
])
await page.locator('[data-ui=batch-row]').nth(1).waitFor()
check('导入了一座、一个文件读不了', await page.locator('[data-ui=batch-row][data-ok=true]').count() === 1 && await page.locator('[data-ui=batch-row][data-ok=false]').count() === 1)
check('导入结果带缩略图', await page.locator('[data-ui=batch-row][data-ok=true] img').count() === 1)
check('开源本地版没有「发到广场」', !(await page.locator('[data-ui=batch-publish]').count()))
await page.screenshot({ path: SHOTS + 'single-4-batch-import.png' })
const docs = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('quadro.library.v1')
  req.onsuccess = () => {
    const all = req.result.transaction('docs', 'readonly').objectStore('docs').getAll()
    all.onsuccess = () => resolve(all.result.map((d) => d.name))
  }
}))
check('导入的那一座进了「我的设计」', docs.includes('A0128'))
await page.close()
await ctx.close()

// 旧版会话：造型 JSON 记在会话里，第一次打开转换成 Yjs 文档
const legacy = await browser.newContext({ viewport: { width: 1200, height: 800 } })
await legacy.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
const seedPage = await legacy.newPage()
await seedPage.goto(BASE + 'favicon.svg')
await seedPage.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('quadro.library.v1', 2)
  req.onupgradeneeded = () => {
    for (const s of ['designs', 'docs', 'session']) req.result.createObjectStore(s, { keyPath: 'id' })
  }
  req.onsuccess = () => {
    const tx = req.result.transaction('session', 'readwrite')
    tx.objectStore('session').put({
      id: 'current',
      activeTabId: 'tlegacy',
      tabs: [{
        tabId: 'tlegacy', docId: null, name: '旧的一座', dirty: true, view: {},
        model: {
          format: 2,
          nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }, { id: 'n2', x: 40, y: 0, z: 0 }, { id: 'n3', x: 40, y: 40, z: 0 }],
          tubes: [
            { id: 't4', a: 'n1', b: 'n2', tubeId: 'T35', color: 'red', length: 35 },
            { id: 't5', a: 'n2', b: 'n3', tubeId: 'T35', color: 'blue', length: 35 },
          ],
        },
      }],
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }
}))
await seedPage.close()
page = await open(legacy)
c = await count(page)
check('旧会话里的造型转换后打开', c.tubes === 2 && c.nodes === 3)
const dbs = await page.evaluate(() => indexedDB.databases().then((l) => l.map((d) => d.name)))
check('转换出 Yjs 本地库', dbs.includes('quadro.tab.tlegacy'))
await page.waitForTimeout(700)
const session = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('quadro.library.v1')
  req.onsuccess = () => {
    const g = req.result.transaction('session', 'readonly').objectStore('session').get('current')
    g.onsuccess = () => resolve(g.result)
  }
}))
check('会话记录不再带造型 JSON', session.tabs.every((tb) => !('model' in tb)))
await page.reload()
await page.waitForFunction(() => window.__quadroDev?.model)
await page.waitForTimeout(800)
c = await count(page)
check('转换后刷新仍在', c.tubes === 2)
await page.screenshot({ path: SHOTS + 'single-3-legacy.png' })
await legacy.close()

await browser.close()
console.log(`${ok} 项通过`)
