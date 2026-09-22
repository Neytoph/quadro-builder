// 海洋球：倒进泳池的标记存得住、料表按袋数算、点一下倒进再点倒出。
//   npx --yes vite-node scripts/check-balls.mjs
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

const { loadCatalog, getTube } = await import('../src/engine/catalog.js')
const { BuildModel, POOL_SETS, POOL_KINDS } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
const { computeBOM, ballBagsFor } = await import('../src/engine/bom.js')
const { buildQDF } = await import('../src/engine/qdfexport.js')
await loadCatalog()

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

function fakeScene(handles) {
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = {
    renderer: { domElement: el }, container: el,
    addHandle: () => ({}), clearHandles: () => { handles.length = 0 },
    addPanelHandle: (corners, data) => { handles.push({ corners, data }); return {} },
    pickHandle: () => (handles.length ? { data: handles[0].data } : null),
  }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

// 一座带池的架子：引擎自己的 poolFragment 连框带内衬一起生成
function withPool(linerId = 'pool_liner_l') {
  const m = new BuildModel()
  const spec = POOL_SETS[linerId]
  const frag = m.poolFragment(spec, { color: 'blue', tubeFor: (span) => getTube(span > 40 ? 'T75' : 'T35') })
  m.insertFragment(frag, [0, 0, 0])
  const pools = [...m.fittings.values()].filter((x) => POOL_KINDS.has(x.kind))
  ok(pools.length === 1 && pools[0].kind === spec.kind, `${linerId} 该正好一个池子，得到 ${pools.length}`)
  return { m, f: pools[0], spec }
}

// 1. 袋数：XS 1、S 2、L 5、XXL 8（和给用户说的一致）
{
  const want = { pool_liner_xs: 1, pool_liner_s: 2, pool_liner_l: 5, pool_liner_xxl: 8 }
  for (const [id, bags] of Object.entries(want)) {
    const s = POOL_SETS[id]
    const got = ballBagsFor({ w: s.w, h: s.h, d: s.d })
    ok(got === bags, `${id} 该 ${bags} 袋，得到 ${got}`)
  }
}

// 2. 标记存得住：toJSON → loadJSON，片段抽取再插入也带着
{
  const { m, f } = withPool()
  f.balls = true
  const m2 = new BuildModel()
  m2.loadJSON(m.toJSON())
  const f2 = [...m2.fittings.values()].find((x) => x.kind === f.kind)
  ok(f2 && f2.balls === true, '存读之后海洋球标记还在')
  const m3 = new BuildModel()
  m3.loadJSON(m.toJSON())
  for (const x of m3.fittings.values()) x.balls = false
  const f3 = [...m3.fittings.values()][0]
  ok(f3.balls === false && !('balls' in m3.toJSON().fittings[0]), '没球的池子不写 balls 字段')
  // 抽取整座再插回去
  const sel = new Map()
  for (const nd of m.nodes.values()) sel.set(nd.id, 'node')
  for (const x of m.fittings.values()) sel.set(x.id, 'fitting')
  const frag = m.extractSelection(sel)
  const m4 = new BuildModel()
  m4.insertFragment(frag, [200, 0, 0])
  ok([...m4.fittings.values()].some((x) => x.balls), '片段插入后标记还在')
}

// 3. 料表：有球多一行「500 个球」，袋数对；没球没这行；qdf 导出不受影响
{
  const { m, f } = withPool('pool_liner_l')
  const rowOf = (bom) => (bom.fittings || []).find((r) => r.id === 'balls')
  ok(!rowOf(computeBOM(m)), '没倒球时料表没有海洋球')
  f.balls = true
  const row = rowOf(computeBOM(m))
  ok(row && row.count === 5, `L 池该 5 袋，得到 ${row && row.count}`)
  ok(row.price === 99.99 && Math.abs(row.subtotal - 499.95) < 0.01, `一袋 99.99，小计 ${row.subtotal}`)
  const qdf = buildQDF(m).text
  ok(typeof qdf === 'string' && qdf.length > 100 && !/balls/i.test(qdf), 'qdf 照常导出，里面没有 balls')
}

// 4. 交互：泳池下拉选海洋球 → 配件模式，每个池子一块绿面；点一下倒进去，再点倒出来
{
  const { m, f } = withPool('pool_liner_s')
  const handles = []
  const b = new Builder(fakeScene(handles), m)
  const notices = []
  b.onNotice = (s) => notices.push(s)
  ok(b.startPool('balls') === 'mount', '选海洋球该进入挂载态')
  ok(b.mode === 'fitting' && b.fittingKind === 'balls' && b.poolLinerId === 'balls', '模式和当前件对')
  b._buildHandles()
  ok(handles.length === 1 && handles[0].data.poolBalls === f.id, `每个泳池一块绿面，得到 ${handles.length}`)
  const c = handles[0].corners
  ok(c.length === 4 && Math.abs(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]) - 80) < 1, '绿面宽 80')
  b._clickBalls({ clientX: 0, clientY: 0 })
  ok(f.balls === true, '点一下倒进去')
  ok(notices.some((s) => s.includes('倒进') || s.includes('poured') || s.includes('eingefüllt')), '提示倒进去了')
  b._clickBalls({ clientX: 0, clientY: 0 })
  ok(f.balls === false, '再点倒出来')
  b.undo && b.undo()
  // 没有泳池时不进模式
  const empty = new Builder(fakeScene([]), new BuildModel())
  const en = []
  empty.onNotice = (s) => en.push(s)
  ok(empty.startPool('balls') === false && empty.mode !== 'fitting', '没泳池不进模式')
  ok(en.length === 1, '提示先放一个泳池')
}

// 给浏览器测试留一座：S 池，已倒球
if (process.env.E2E_OUT) {
  const { m, f } = withPool('pool_liner_s')
  f.balls = true
  mkdirSync(process.env.E2E_OUT, { recursive: true })
  writeFileSync(join(process.env.E2E_OUT, 'balls-test.json'), JSON.stringify(m.toJSON()))
}

console.log(`海洋球检查通过，${n} 项断言`)
