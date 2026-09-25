// 批量导入的封面联调：设计师在 /builder/?import=qdf 拖进两个官方 .qdf，每一座连同导入结果里那张缩略图
// 一起同步进「我的设计」；点「发到广场」，发布页的封面就是这张图，发出去的广场方案、设计师主页和设计师页的
// 作品缩略图都是这一座的画面。运行：node scripts/e2e-import.mjs（联调环境 9110，dist 按 build-hosted.sh 构建）。
// 账号：pro-designer（联调环境里建好的），管理员 dev-admin@qinghe.test（dev-up 的 QH_ADMINS 里有它，没有就注册）。
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const SITE = process.env.SITE || 'http://localhost:9110'
const SHOTS = process.env.SHOTS || fileURLToPath(new URL('../../qb-shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const PASS = 'hunter2hunter'
const QDF = (id) => ({ name: `${id}.qdf`, mimeType: 'application/octet-stream', buffer: readFileSync(fileURLToPath(new URL(`../dist/qdf/${id}.qdf`, import.meta.url))) })

let ok = 0
const check = (label, cond) => { assert.ok(cond, label); ok++; console.log(`✓ ${label}`) }
const json = async (res, label) => { assert.ok(res.ok(), `${label} → ${res.status()} ${await res.text()}`); return res.json() }
// 本机「我的设计」的存档记录（builder 存在 IndexedDB quadro.library.v1 的 docs 里）
const localDocs = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('quadro.library.v1')
  req.onerror = () => reject(req.error)
  req.onsuccess = () => {
    const all = req.result.transaction('docs', 'readonly').objectStore('docs').getAll()
    all.onerror = () => reject(all.error)
    all.onsuccess = () => resolve(all.result.map((d) => ({ id: d.id, name: d.name, cover: d.cover || null, dirty: !!d.dirty, deletedAt: d.deletedAt || null, updatedAt: d.updatedAt })))
  }
}))

const browser = await chromium.launch()
const ctx = await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
await ctx.addInitScript(() => {
  // 「发到广场」用 noopener 开新标签页，它先是一张 about:blank，那里读不了 localStorage
  if (location.origin === 'null') return
  localStorage.setItem('quadro.builder.onboarded.v2', '1')
  localStorage.setItem('quadro.lang', 'zh')
  localStorage.setItem('quadro-builder-lang', 'zh')
})
assert.equal((await ctx.request.post('/signin', { form: { identifier: 'pro-designer', password: PASS } })).status(), 200)

try {
  await run()
} finally {
  await browser.close()
}
console.log(`${ok} 项通过`)

async function run() {
// —— 1. 批量导入两座 ——
const page = await ctx.newPage()
page.on('pageerror', (e) => { console.error('pageerror', e.message); process.exitCode = 1 })
await page.goto('/builder/?import=qdf')
await page.locator('[data-ui=batch-import]').waitFor()
await page.locator('[data-ui=batch-import] input[type=file]').setInputFiles([QDF('A0128'), QDF('A0035')])
await page.locator('[data-ui=batch-row][data-ok=true]').nth(1).waitFor({ timeout: 60000 })
check('两个文件都导入了，每一座一张缩略图', await page.locator('[data-ui=batch-row][data-ok=true] img').count() === 2)
await page.screenshot({ path: `${SHOTS}import-1-results.png` })

// 导入的两座在本机存档里的 id：按名字找，同名的取最新的那份
const docs = (await localDocs(page)).filter((d) => !d.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)
const names = await page.locator('[data-ui=batch-row][data-ok=true] .ttl').allTextContents()
const ids = names.map((n) => docs.find((d) => d.name === n)?.id)
check(`导入的两座：${names.join('、')}`, ids.length === 2 && ids.every(Boolean))

// —— 2. 「我的设计」里两座都有封面：同步交上去的就是导入结果里那张图 ——
let designs = []
for (let i = 0; i < 40; i++) {
  designs = (await json(await ctx.request.get('/quadro/designs'), 'designs')).designs.filter((d) => ids.includes(d.doc_id))
  if (designs.length === 2 && designs.every((d) => d.cover_path)) break
  await page.waitForTimeout(500)
}
check('「我的设计」里这两座都带封面', designs.length === 2 && designs.every((d) => d.cover_path))
const thumbs = await page.locator('[data-ui=batch-row][data-ok=true] img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
for (const [i, id] of ids.entries()) {
  const d = designs.find((x) => x.doc_id === id)
  const got = Buffer.from(await (await ctx.request.get(`/quadro/covers/${d.cover_path}`)).body())
  const want = Buffer.from(thumbs[i].split(',')[1], 'base64')
  check(`「${names[i]}」的封面和导入结果里的缩略图是同一张`, got.equals(want))
}
const local = (await localDocs(page)).filter((d) => ids.includes(d.id))
check('交上去以后本机存档不再记着封面', local.length === 2 && local.every((d) => !d.cover && !d.dirty))

// 「我的设计」在站点上的样子：写帖子时带上这一座
const write = await ctx.newPage()
await write.goto(`/write.html?model=${encodeURIComponent(ids[0])}`)
await write.locator(`img[src*="${designs.find((x) => x.doc_id === ids[0]).cover_path}"]`).first().waitFor({ timeout: 15000 })
check('站点上「我的设计」这一座的卡片用的是这张封面', true)
await write.screenshot({ path: `${SHOTS}import-2-my-designs.png` })
await write.close()

// —— 3. 发到广场：发布页封面是这张图，发出去的方案封面也是 ——
const [pub] = await Promise.all([ctx.waitForEvent('page'), page.locator('[data-ui=batch-publish]').first().click()])
pub.on('pageerror', (e) => { console.error('publish pageerror', pub.url(), e.stack); process.exitCode = 1 })
await pub.waitForURL(/\/publish\.html\?model=/)
await pub.locator('#modelPicked').filter({ hasText: names[0] }).waitFor({ timeout: 15000 })
await pub.locator('#coverPrev img[src^="data:image/jpeg"]').waitFor({ timeout: 15000 })
check('发布页的封面预先换成这一座的画面', true)
const title = `导入封面 ${Date.now().toString(36)}`
await pub.locator('input[name=title]').fill(title)
const age = pub.locator('select[name=age_min_m]')
await pub.waitForFunction(() => document.querySelector('select[name=age_min_m]').value !== '')
check('起步月龄按量出来的高度选好了', !!(await age.inputValue()))
await pub.locator('input[name=kid_m]').fill('30')
await pub.locator('textarea[name=why]').fill('官方软件里画好的作品，批量导入以后发出来。')
await pub.screenshot({ path: `${SHOTS}import-3-publish.png`, fullPage: true })
await pub.getByRole('button', { name: '发布到广场' }).click()
await pub.waitForURL(/\/scheme\.html\?id=/, { timeout: 20000 })
const schemeId = new URL(pub.url()).searchParams.get('id')
const scheme = await json(await ctx.request.get(`/quadro/plaza/schemes/${schemeId}`), 'scheme')
const schemeCover = Buffer.from(await (await ctx.request.get(scheme.cover_url)).body())
const firstCover = Buffer.from(await (await ctx.request.get(`/quadro/covers/${designs.find((x) => x.doc_id === ids[0]).cover_path}`)).body())
check(`广场方案 ${schemeId} 的封面就是这一座的画面`, schemeCover.equals(firstCover))
await pub.screenshot({ path: `${SHOTS}import-4-scheme.png` })
await pub.close()

// —— 4. 设计师主页、设计师页的作品缩略图 ——
let me = await json(await ctx.request.get('/quadro/pros/me'), 'pros/me')
if (me.status !== 'approved') {
  await json(await ctx.request.put('/quadro/pros/me', {
    data: {
      name: '导入联调设计师', bio: '做儿童攀爬架设计，作品从官方软件导入。', regions: ['上海 · 浦东'], specialties: ['small'],
      priceMin: 800, priceMax: 2000, serviceNote: '每单出两版。', wechat: 'import_e2e', works: [scheme.id],
    },
  }), 'PUT pros/me')
  const admin = await browser.newContext({ baseURL: SITE })
  const adminMail = 'dev-admin@qinghe.test'
  if ((await admin.request.post('/signin', { form: { identifier: adminMail, password: PASS } })).status() !== 200) {
    const r = await admin.request.post('/register', { headers: { Accept: 'application/json' }, form: { email: adminMail, email_code: '000000', username: 'dev-admin', password: PASS, password2: PASS } })
    assert.ok(r.ok(), `注册管理员 → ${r.status()} ${await r.text()}`)
  }
  const ap = await admin.newPage()
  await ap.goto('/admin/pros')
  await ap.locator('.card.rv').filter({ hasText: '导入联调设计师' }).getByRole('button', { name: /通过，分配 \d+ 号/ }).click()
  await ap.locator('.flash.ok').waitFor()
  await admin.close()
  me = await json(await ctx.request.get('/quadro/pros/me'), 'pros/me')
}
check(`pro-designer 是认证设计师 ${me.no} 号`, me.status === 'approved' && me.no > 0)
const home = await json(await ctx.request.get(`/quadro/pros/${me.no}`), 'pros/{no}')
const work = home.works.find((w) => w.slug === scheme.slug)
check('设计师主页的作品里有这一座，封面是同一张', !!work && work.cover_url === scheme.cover_url)
const list = await json(await ctx.request.get(`/quadro/pros?q=${me.no}`), 'pros')
const item = list.pros.find((p) => p.no === me.no)
check('设计师页这位设计师的作品缩略图里有这一座', !!item && item.covers.includes(scheme.cover_url))

const pro = await ctx.newPage()
await pro.goto(`/pro.html?no=${me.no}`)
await pro.locator(`img[src="${scheme.cover_url}"]`).first().waitFor({ timeout: 15000 })
check('设计师主页上画出了这张封面', true)
await pro.screenshot({ path: `${SHOTS}import-5-pro-home.png`, fullPage: true })
await pro.goto(`/pros.html?q=${me.no}`)
await pro.locator(`img[src="${scheme.cover_url}"]`).first().waitFor({ timeout: 15000 })
check('设计师页上画出了这张封面', true)
await pro.screenshot({ path: `${SHOTS}import-6-pros.png` })
}
