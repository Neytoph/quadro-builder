// 面板 / 布件两步点选的第一步：还没选第一根管时，能当第一根的管（有能配的对面管）先亮出来；
// 选了第一根之后第一步的高亮让位给「它 + 对面管」。已经放了板 / 布的格子，对面管不再算数。
//   npx --yes vite-node scripts/check-first-rail.mjs
import { readFileSync } from 'node:fs'
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

const { loadCatalog } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
const { withHistory } = await import('./withHistory.mjs')
await loadCatalog()

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

function fakeScene(renders) {
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = {
    renderer: { domElement: el }, container: el,
    renderModel: (_m, _sel, opts) => { renders.push(opts) },
  }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

/** 地面上两格 40×40，三根沿 z 的管（x = 0 / 40 / 80），外加一根孤零零竖着的管。 */
function twoCells() {
  const m = new BuildModel()
  const r0 = [], r1 = []
  for (let i = 0; i <= 2; i++) { r0.push(m.addNode(i * 40, 0, 0)); r1.push(m.addNode(i * 40, 0, 40)) }
  const rails = []
  for (let i = 0; i <= 2; i++) rails.push(m.addTube(r0[i].id, r1[i].id, 'T35', 'blue', 35))
  for (let i = 0; i < 2; i++) { m.addTube(r0[i].id, r0[i + 1].id, 'T35', 'red', 35); m.addTube(r1[i].id, r1[i + 1].id, 'T35', 'red', 35) }
  const up = m.addTube(r0[0].id, m.addNode(0, 40, 0).id, 'T35', 'green', 35)
  return { m, rails, up }
}

for (const [label, setup] of [
  ['面板', (b) => { b.mode = 'panel'; b.panelId = 'panel_40x40' }],
  ['布面', (b) => { b.mode = 'fitting'; b.fittingKind = 'textil2' }],
]) {
  const { m, rails, up } = twoCells()
  const renders = []
  const b = withHistory(new Builder(fakeScene(renders), m, { onChange() {} }))
  setup(b)
  b.refresh()
  const first = renders.at(-1).highlight
  ok(first && rails.every((r) => first.has(r.id)), `${label}：三根承重管都该亮`)
  ok(!first.has(up.id), `${label}：没有对面管的竖管不亮`)

  // 选了第一根：第一步的高亮让位，只剩它和对面管
  b.panelRail = { id: rails[0].id, at: 20 }
  b.highlight = new Set([rails[0].id, rails[1].id])
  b.refresh()
  const second = renders.at(-1)
  ok(second.focusId === rails[0].id && second.highlight.size === 2 && !second.highlight.has(rails[2].id),
    `${label}：选了第一根后只亮它和对面管`)

  // 别的模式不受影响
  b.panelRail = null; b.highlight = null; b.mode = 'select'
  b.refresh()
  ok(!renders.at(-1).highlight, `${label}：选择模式下什么都不亮`)
}

// 已经有板的格子：对面管不再算，占满了的管第一步也不亮
for (const [label, setup, fill] of [
  ['面板', (b) => { b.mode = 'panel'; b.panelId = 'panel_40x40' }, (m, a, c) => m.addPanel(a, c, 0, 40, 'panel_40x40', 'red', 1)],
  ['布面', (b) => { b.mode = 'fitting'; b.fittingKind = 'textil2' }, (m, a, c) => m.addTextile(a, c, 0, 40, 'red')],
]) {
  const { m, rails } = twoCells()
  ok(!!fill(m, rails[0].id, rails[1].id), `${label}：左格先放上`)
  const renders = []
  const b = withHistory(new Builder(fakeScene(renders), m, { onChange() {} }))
  setup(b)
  b.refresh()
  const first = renders.at(-1).highlight
  ok(first && !first.has(rails[0].id), `${label}：左管唯一的对面格已占，第一步不亮`)
  ok(first.has(rails[1].id) && first.has(rails[2].id), `${label}：中管和右管之间还空，都亮`)
  const partners = b._freePartners(rails[1].id, 20).map((p) => p.id)
  ok(partners.length === 1 && partners[0] === rails[2].id, `${label}：中管只配右管，不配已占的左管，得到 ${partners}`)
}

console.log(`面板 / 布件第一步高亮检查通过，${n} 项断言`)
