// 选择模式：同一位置隔一会儿再点一次，选到后面那一件；快的两下还是选整块。
//   npx --yes vite-node scripts/check-pick-deeper.mjs
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
const { geometricPreset } = await import('../src/data/presets.ts')
await loadCatalog()

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

// 一座两层的护栏平台：拿它的一根管当「前面那件」、一个接头当「后面那件」
const m = new BuildModel()
m.loadJSON(geometricPreset('rail_deck_tall'))
const panelIds = [...m.panels.values()].filter((p) => !p.poolPart).map((p) => p.id)
ok(panelIds.length >= 1, `该有板，得到 ${panelIds.length}`)
const front = [...m.tubes.values()][0].id
const back = [...m.nodes.values()][0].id
const hits = [
  { data: { kind: 'tube', id: front }, distance: 100, point: null },
  { data: { kind: 'node', id: back }, distance: 140, point: null },
]

// 假场景：指针下面总是这两件，前面那件在前
function fakeScene() {
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = {
    renderer: { domElement: el }, container: el,
    pickAllForDelete: () => hits.slice(),
    pickForDelete: () => hits[0],
    pickClamp: () => null,
    addHandle: () => ({}), clearHandles: () => {},
  }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

// 时钟自己拨
let clock = 1000
const realNow = performance.now
performance.now = () => clock

const b = withHistory(new Builder(fakeScene(), m))
b.onNotice = () => {}
b.mode = 'select'
const click = (x, y) => b._clickSelectRaw({ clientX: x, clientY: y })
const sel = () => [...b.selection.keys()]

// 1. 第一下：最近的那件
click(100, 100)
ok(sel().length === 1 && sel()[0] === front, `第一下选前面那件，得到 ${sel()}`)

// 2. 隔一会儿同一处再点：后面那件
clock += 1500
click(102, 101)
ok(sel().length === 1 && sel()[0] === back, `隔一会儿再点该选后面那件，得到 ${sel()}`)

// 3. 再来一次：绕回前面那件
clock += 1500
click(101, 100)
ok(sel().length === 1 && sel()[0] === front, `再点绕回前面那件，得到 ${sel()}`)

// 4. 换了位置：又从最近的开始（先清掉选中，不然点已选中的那件是取消选中）
clock += 1500
b.clearSelection()
click(300, 300)
ok(sel()[0] === front, `换位置从最近的开始，得到 ${sel()}`)

// 5. 快的两下（双击）：选整块，不是往里选
clock += 1500
click(300, 300)          // 慢点之后先停在 back 上
const before = sel()[0]
clock += 100             // 100 ms 内再点：算双击
click(300, 300)
ok(sel().length > 1 || sel()[0] !== undefined, '快的两下走整块选择')
ok(!(sel().length === 1 && sel()[0] !== before && sel()[0] !== front), '双击没有被当成往里选')

performance.now = realNow

// 6. 放板：几块候选面叠在一起，点到圆点算圆点那块；没点到圆点看离哪块中心近
{
  const { preferPanelCell } = await import('../src/engine/pickcell.js')
  const cell = (id, pos, dot) => ({ object: { userData: { panelCell: true, panelDot: !!dot, cellId: id }, position: pos } })
  const toScreen = (p) => [p.x, p.y]          // 测试里屏幕坐标就用 x,y
  const frontQuad = cell('front', { x: 100, y: 100 })     // 最前面那块，中心在上面
  const bottomQuad = cell('bottom', { x: 100, y: 300 })   // 底下那格，中心在下面
  // 点在底格中心附近：虽然射线先碰到前面那块，也该算底格
  let got = preferPanelCell([frontQuad, bottomQuad], 104, 290, toScreen)
  ok(got.object.userData.cellId === 'bottom', '点在底格附近该算底格')
  // 点在前面那块中心附近：算前面
  got = preferPanelCell([frontQuad, bottomQuad], 100, 110, toScreen)
  ok(got.object.userData.cellId === 'front', '点在前面那块附近算前面')
  // 点到了底格的圆点：不管远近都算底格
  const bottomDot = cell('bottom', { x: 100, y: 300 }, true)
  got = preferPanelCell([frontQuad, bottomDot, bottomQuad], 100, 100, toScreen)
  ok(got.object.userData.cellId === 'bottom' && got.object.userData.panelDot, '点到圆点算圆点那块')
  // 只有一块或者不是候选面：还是最近的
  got = preferPanelCell([frontQuad], 500, 500, toScreen)
  ok(got === frontQuad, '只有一块就是它')
  const arrow = { object: { userData: { kind: 'handle', arrowRoot: true }, position: { x: 0, y: 0 } } }
  got = preferPanelCell([arrow, bottomQuad], 100, 300, toScreen)
  ok(got === arrow, '不是候选面的手柄照旧取最近的')
  ok(preferPanelCell([], 0, 0, toScreen) === null, '没命中就是 null')
}

console.log(`往里选检查通过，${n} 项断言`)
