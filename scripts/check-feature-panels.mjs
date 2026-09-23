// 功能板（兼容件）：七种都是 40×40 板的变体；导出 .qdf 用材质名标记，我们导入
// 认回来；没有这些板定义的一方（官方软件）读到的是普通板；料表按种类分行。
//   npx --yes vite-node scripts/check-feature-panels.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const parts = JSON.parse(readFileSync(join(root, 'public/data/parts.json'), 'utf8'))
globalThis.localStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
globalThis.fetch = async (url) => {
  if (String(url).includes('parts.json')) return { ok: true, json: async () => parts }
  throw new Error('unexpected fetch ' + url)
}

const { loadCatalog, buildableTubes, panels, geometry, getPanel } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { buildQDF } = await import('../src/engine/qdfexport.js')
const { parseQDF } = await import('../src/engine/qdfimport.js')
const { computeBOM } = await import('../src/engine/bom.js')
const { geometricPreset } = await import('../src/data/presets.ts')
await loadCatalog()

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const FEATURES = ['lego', 'honeycomb', 'busy', 'felt', 'magnet', 'climbing']

// 1. 零件表：七种都在，40×40，标了 feature 和 compat
for (const f of FEATURES) {
  const def = getPanel('panel_40x40_' + f)
  ok(def && def.w === 40 && def.h === 40 && def.feature === f && def.compat === true, `功能板 ${f} 的定义`)
}

// 2. 一座带平台的架子，把板换成功能板 → 导出材质名带标记，导入认回来
const opts = () => ({ tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
function deckModel() {
  const m = new BuildModel()
  m.loadJSON(geometricPreset('rail_deck'))
  const deck = [...m.panels.values()].filter((p) => !p.poolPart)
  ok(deck.length >= 1, `护栏平台该有板，得到 ${deck.length}`)
  return { m, deck }
}
for (const f of FEATURES) {
  const { m, deck } = deckModel()
  for (const p of deck) { p.panelId = 'panel_40x40_' + f; p.color = 'red' }
  const text = buildQDF(m).text
  ok(text.includes(`"red (${f})"`), `导出该有材质「red (${f})」`)
  // 板行用的材质号就是那一行
  const nr = Number((text.match(new RegExp(`material3\\{(\\d+),"red \\(${f}\\)"`)) || [])[1])
  ok(nr >= 27, `材质号该在 27 起，得到 ${nr}`)
  ok(new RegExp(`panel2\\{${nr},`).test(text), `板行该用材质 ${nr}`)
  // 我们自己导入：认回功能板
  const back = new BuildModel()
  back.loadJSON(parseQDF(text, opts()))
  const got = [...back.panels.values()].map((p) => p.panelId)
  ok(got.length === deck.length && got.every((id) => id === 'panel_40x40_' + f), `导入该认回 ${f}，得到 ${got}`)
  ok([...back.panels.values()].every((p) => p.color === 'red'), '颜色还是红')
  // 官方那边（不认识功能板）：读到普通 40×40 板
  const plainOpts = opts()
  plainOpts.panels = plainOpts.panels.filter((p) => !p.feature)
  const plain = new BuildModel()
  plain.loadJSON(parseQDF(text, plainOpts))
  ok([...plain.panels.values()].every((p) => p.panelId === 'panel_40x40'), `不认识功能板的一方该读成普通板`)
}

// 3. 料表：功能板按种类分行，和原厂 40×40 不混；价格 0
{
  const { m, deck } = deckModel()
  deck[0].panelId = 'panel_40x40_lego'
  const bom = computeBOM(m)
  const lego = bom.panels.find((r) => r.panelId === 'panel_40x40_lego')
  ok(lego && lego.count === 1 && lego.price === 0, `料表该有一行乐高板，价格 0，得到 ${JSON.stringify(lego)}`)
  ok(/kompatibel|compatible|兼容件/.test(lego.name), `名字里该标兼容件，得到 ${lego.name}`)
  const total = bom.panels.reduce((s, r) => s + r.count, 0)
  ok(total === deck.length, `板总数不变 ${total}`)
}

// 4. 普通板照旧：导出没有功能板材质被用到，导入还是普通板
{
  const { m } = deckModel()
  const text = buildQDF(m).text
  ok(!/panel2\{(2[7-9]|[3-9]\d),/.test(text), '普通板不该用功能板的材质号')
  const back = new BuildModel()
  back.loadJSON(parseQDF(text, opts()))
  ok([...back.panels.values()].every((p) => p.panelId === 'panel_40x40'), '普通板导入还是普通板')
}

// 给浏览器测试留一座：六块并排的地板，各放一种功能板
if (process.env.E2E_OUT) {
  const m = new BuildModel()
  const K = FEATURES.length
  const row0 = [], row1 = []
  for (let i = 0; i <= K; i++) { row0.push(m.addNode(i * 40, 0, 0)); row1.push(m.addNode(i * 40, 0, 40)) }
  for (let i = 0; i <= K; i++) m.addTube(row0[i].id, row1[i].id, 'T35', 'blue', 35)
  for (let i = 0; i < K; i++) { m.addTube(row0[i].id, row0[i + 1].id, 'T35', 'blue', 35); m.addTube(row1[i].id, row1[i + 1].id, 'T35', 'blue', 35) }
  const colors = ['red', 'blue', 'yellow', 'yellow', 'green', 'yellow']
  const rails = [...m.tubes.values()].filter((t) => { const a = m.nodes.get(t.a), b = m.nodes.get(t.b); return a.z !== b.z })
  rails.sort((p, q) => m.nodes.get(p.a).x - m.nodes.get(q.a).x)
  for (let i = 0; i < K; i++) {
    const added = m.addPanel(rails[i].id, rails[i + 1].id, 0, 40, 'panel_40x40_' + FEATURES[i], colors[i], 1)
    ok(!!added, `第 ${i} 块功能板放上了`)
  }
  mkdirSync(process.env.E2E_OUT, { recursive: true })
  writeFileSync(join(process.env.E2E_OUT, 'feature-panels.json'), JSON.stringify(m.toJSON()))
}

console.log(`功能板检查通过，${n} 项断言`)
