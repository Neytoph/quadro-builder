// 安全审查校准：把全部官方造型和起步单元过一遍，统计每条规则触发多少座。
// 官方造型是原厂审过的，哪条规则在它们身上大面积触发，说明阈值定错了。
// 运行（仓库根目录）：npx vite-node scripts/check-safety.mjs [A0001 ...]
//   带造型编号时打印那几座的逐条结果。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const parts = JSON.parse(readFileSync(join(root, 'public/data/parts.json'), 'utf8'))
globalThis.localStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
globalThis.fetch = async (url) => {
  if (String(url).includes('parts.json')) return { ok: true, json: async () => parts }
  throw new Error('unexpected fetch ' + url)
}

const { loadCatalog, buildableTubes, panels, geometry } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { parseQDF } = await import('../src/engine/qdfimport.js')
const { computeSafety, SAFETY_RULE_IDS } = await import('../src/engine/safety.js')
const { ALL_PRESETS, geometricPreset } = await import('../src/data/presets.ts')
await loadCatalog()

const qdfOpts = () => ({ tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
const wanted = new Set(process.argv.slice(2).map((s) => s.toUpperCase()))

function show(label, res) {
  console.log(`\n== ${label}  最高站立面 ${res.height} cm`)
  for (const f of res.findings) {
    const ids = Object.entries(f.ids || {}).filter(([, v]) => v && v.length).map(([k, v]) => `${k} ${v.length}`).join(', ')
    console.log(`   [${f.level}] ${f.rule} (${f.ref}) ${JSON.stringify(f.params)}${ids ? '  → ' + ids : ''}`)
  }
}

// 1. 起步单元
console.log('#### 起步单元')
for (const p of ALL_PRESETS) {
  if (p.mode === 'replace') continue
  const m = new BuildModel()
  m.loadJSON(geometricPreset(p.key))
  const res = computeSafety(m)
  const short = res.findings.map((f) => `${f.level[0]}:${f.rule}`).join(' ')
  console.log(`${p.key.padEnd(14)} ${short}`)
  if (wanted.has(p.key.toUpperCase())) show(p.key, res)
}

// 2. 故意搭错的模型：每条规则至少要在一座上响
console.log('\n#### 故意搭错的模型')
const { getPanel } = await import('../src/engine/catalog.js')
function frame() {
  const m = new BuildModel()
  const at = (x, y, z) => m.findNodeNear(x, y, z) || m.addNode(x, y, z)
  const tube = (a, b, id = 'T35', len = 35) => {
    const na = at(...a), nb = at(...b)
    return m.tubeBetween(na.id, nb.id) || m.addTube(na.id, nb.id, id, 'red', len)
  }
  const ring = (y, x0, z0, x1, z1) => {
    for (let x = x0; x < x1; x += 40) { tube([x, y, z0], [x + 40, y, z0]); tube([x, y, z1], [x + 40, y, z1]) }
    for (let z = z0; z < z1; z += 40) { tube([x0, y, z], [x0, y, z + 40]); tube([x1, y, z], [x1, y, z + 40]) }
  }
  const posts = (y0, y1, spots) => { for (const [x, z] of spots) for (let y = y0; y < y1; y += 40) tube([x, y, z], [x, y + 40, z]) }
  const panel = (a, b, c, d, panelId = 'panel_40x40') => {
    const t0 = m.tubeBetween(at(...a).id, at(...b).id), t1 = m.tubeBetween(at(...c).id, at(...d).id)
    const def = getPanel(panelId)
    const p = m.panelPartners(t0.id, [def.w, def.h]).find((x) => x.id === t1.id)
    if (!p) throw new Error('板对不上')
    const sec = m.panelSection(p, p.lo + 0.05)
    if (!m.addPanel(t0.id, t1.id, sec.t0, sec.len, panelId, 'blue', 1)) throw new Error('铺板失败')
  }
  return { m, at, tube, ring, posts, panel }
}
const expect = (label, m, rule, level) => {
  const res = computeSafety(m)
  const hit = res.findings.find((f) => f.rule === rule)
  const ok = level === null ? !hit : (hit && hit.level === level)
  console.log(`${ok ? '✓' : '✗'} ${label}: ${rule} ${level === null ? '不该响' : level}${hit ? ` (实际 ${hit.level} ${JSON.stringify(hit.params)})` : ' (没响)'}`)
  if (!ok) process.exitCode = 1
}
{ // 悬空的管端
  const f = frame(); f.ring(0, 0, 0, 40, 40); f.posts(0, 40, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(40, 0, 0, 40, 40)
  f.tube([0, 40, 0], [0, 80, 0])
  expect('顶上多伸一根管', f.m, 'open_end', 'warn')
}
{ // 没落地
  const f = frame(); f.ring(40, 0, 0, 40, 40); f.posts(40, 80, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(80, 0, 0, 40, 40)
  f.m.addNode(200, 0, 200); f.m.addNode(240, 0, 200); f.tube([200, 0, 200], [240, 0, 200])
  expect('架子离地 40，旁边一根管落地', f.m, 'floating', 'error')
}
{ // 卡头开口
  const f = frame(); f.ring(0, 0, 0, 40, 40); f.posts(0, 80, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(40, 0, 0, 40, 40); f.ring(80, 0, 0, 40, 40)
  f.tube([0, 80, 0], [0, 100, 0], 'T15', 15); f.tube([40, 80, 0], [40, 100, 0], 'T15', 15); f.tube([0, 100, 0], [40, 100, 0])
  expect('80 cm 上一个 40×20 空框', f.m, 'entrapment', 'warn')
  f.panel([0, 80, 0], [40, 80, 0], [0, 100, 0], [40, 100, 0], 'panel_40x20')
  expect('同一个框铺了半板', f.m, 'entrapment', null)
}
{ // 板边下面没管
  const f = frame(); f.tube([0, 40, 0], [40, 40, 0]); f.tube([0, 40, 40], [40, 40, 40])
  f.posts(0, 40, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(0, 0, 0, 40, 40)
  f.panel([0, 40, 0], [40, 40, 0], [0, 40, 40], [40, 40, 40])
  expect('板只架在两根管上', f.m, 'deck_edges', 'warn')
}
{ // 倾覆
  const f = frame(); f.ring(0, 0, 0, 40, 40); f.posts(0, 120, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(40, 0, 0, 40, 40); f.ring(80, 0, 0, 40, 40); f.ring(120, 0, 0, 40, 40)
  expect('1×1 柱子 120 高', f.m, 'tipping', 'warn')
}
{ // 层间距、护栏、固定
  const f = frame(); f.ring(0, 0, 0, 40, 40)
  for (const [x, z] of [[0, 0], [40, 0], [0, 40], [40, 40]]) f.tube([x, 0, z], [x, 80, z], 'T75', 75)
  f.ring(80, 0, 0, 40, 40); f.panel([0, 80, 0], [40, 80, 0], [0, 80, 40], [40, 80, 40])
  expect('80 高平台，柱子是 75 管没有中间横档', f.m, 'level_gap', 'warn')
  expect('80 高平台没护栏', f.m, 'railing', 'info')
  expect('80 高平台要固定', f.m, 'anchoring', 'info')
  f.posts(80, 120, [[0, 0], [40, 0], [0, 40], [40, 40]]); f.ring(120, 0, 0, 40, 40)
  expect('加了一圈护栏', f.m, 'railing', null)
}
{ // 坠落高度
  const f = frame(); f.ring(0, 0, 0, 40, 40)
  f.posts(0, 280, [[0, 0], [40, 0], [0, 40], [40, 40]]); for (let y = 40; y <= 280; y += 40) f.ring(y, 0, 0, 40, 40)
  expect('280 高的塔', f.m, 'fall_height', 'error')
}

// 3. 官方造型
const dir = join(root, 'public/qdf')
const files = readdirSync(dir).filter((f) => f.endsWith('.qdf')).sort()
const tally = new Map(SAFETY_RULE_IDS.map((r) => [r, { n: 0, ids: [] }]))
let parsed = 0
for (const f of files) {
  const id = f.replace(/\.qdf$/, '')
  let res
  try {
    const data = parseQDF(readFileSync(join(dir, f), 'utf8'), qdfOpts())
    const m = new BuildModel()
    const r = m.loadJSON(data)
    if (r && r.ok === false) continue
    res = computeSafety(m)
  } catch (e) {
    console.log('跳过', id, String(e).slice(0, 80))
    continue
  }
  parsed++
  const seen = new Set()
  for (const x of res.findings) {
    if (seen.has(x.rule)) continue
    seen.add(x.rule)
    const t = tally.get(x.rule)
    t.n++
    if (t.ids.length < 8) t.ids.push(id)
  }
  if (wanted.has(id)) show(id, res)
}
console.log(`\n#### 官方造型 ${parsed} 座，各规则触发数`)
for (const [rule, t] of tally) {
  console.log(`${rule.padEnd(12)} ${String(t.n).padStart(4)}  ${(100 * t.n / parsed).toFixed(0).padStart(3)}%   ${t.ids.join(' ')}`)
}
