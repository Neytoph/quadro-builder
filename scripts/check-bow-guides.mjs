// 弯管在手时的弧线手柄：每个空方向四种弯法，落地下和已连着的不给；
// 点哪根，弯管就落在那根弧线的终点上。
//   npx --yes vite-node scripts/check-bow-guides.mjs
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

const { loadCatalog, gridSpacing } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
await loadCatalog()

// 假场景：只记录手柄，其他调用一律吞掉
function fakeScene() {
  const handles = []
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = {
    handles,
    renderer: { domElement: el },
    container: el,
    addHandle: (pos, data, kind) => { handles.push({ pos, data, kind }); return {} },
    clearHandles: () => { handles.length = 0 },
  }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

function verticalTube() {
  const m = new BuildModel()
  const a = m.addNode(0, 0, 0)
  const b = m.addNode(0, 40, 0)
  m.addTube(a.id, b.id, 'T35', 'red', 35)
  return { m, a, b }
}

const R = gridSpacing()
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

// 1. 直管在手：没有弧线手柄
{
  const { m } = verticalTube()
  const sc = fakeScene()
  const b = new Builder(sc, m)
  b.mode = 'add'; b.tubeId = 'T35'
  b._buildHandles()
  ok(sc.handles.length > 0, '直管该有手柄')
  ok(sc.handles.every((h) => !h.data.bow), '直管在手不该出弧线')
}

// 2. 弯管在手：顶上的接头（0,40,0）五个空方向；上方向四种弯法全给，
//    四个水平方向各三种（往下弯的圆心在 y=0，不算地下；但目标点 y=0 处没接头，
//    所以四种都给）→ 先算清楚再断言
{
  const { m, a, b: top } = verticalTube()
  const sc = fakeScene()
  const b = new Builder(sc, m)
  b.mode = 'add'; b.tubeId = 'TC1'
  b._buildHandles()
  const bows = sc.handles.filter((h) => h.data.bow)
  ok(bows.length > 0, '弯管在手该有弧线手柄')
  ok(sc.handles.every((h) => h.data.bow || h.data.clampOpening), '弯管在手时接头上只该有弧线手柄')
  for (const h of bows) {
    const d = h.data.dir, nn = h.data.bowNormal
    ok(Math.abs(d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]) < 1e-9, '弯法要和出发方向垂直')
    ok(Math.abs(Math.hypot(...nn) - 1) < 1e-9, '弯法是单位向量')
    ok(h.data.bowRadius === R, '半径是一格')
  }
  const atTop = bows.filter((h) => h.data.nodeId === top.id)
  const atBase = bows.filter((h) => h.data.nodeId === a.id)
  // 每个方向恰好一根默认的（静止时只露它）
  for (const list of [atTop, atBase]) {
    const byDir = new Map()
    for (const h of list) byDir.set(h.data.dirName, (byDir.get(h.data.dirName) || 0) + (h.data.bowDefault ? 1 : 0))
    for (const [name, cnt] of byDir) ok(cnt === 1, `方向 ${name} 该有且只有一根默认弧线，得到 ${cnt}`)
  }
  // 水平方向默认往下弯，竖直方向默认水平弯（和键盘放下去的一样）
  const defTopX = atTop.find((h) => h.data.dir[0] === 1 && h.data.bowDefault)
  ok(defTopX && defTopX.data.bowNormal[1] === -1, '水平出发的默认弯法该是往下')
  const defTopY = atTop.find((h) => h.data.dir[1] === 1 && h.data.bowDefault)
  ok(defTopY && defTopY.data.bowNormal[1] === 0, '竖直出发的默认弯法该是水平的')
  // 地面接头：往下弯会钻进地里，默认改成往上
  const defBaseX = atBase.find((h) => h.data.dir[0] === 1 && h.data.bowDefault)
  ok(defBaseX && defBaseX.data.bowNormal[1] === 1, '地面接头水平出发的默认弯法该是往上')
  // 顶接头：下方向被管占着；上 4 种 + 四个水平方向各 4 种 = 20
  ok(atTop.length === 20, `顶接头该有 20 根弧线，得到 ${atTop.length}`)
  // 底接头：上方向被管占着，其余五个方向各 4 种 = 20。
  // 地下的判定在 model 里是全局关着的（ALLOW_BELOW_GROUND），所以往下弯的也给；
  // 哪天把它打开，这里该变成 12（四个水平方向各去掉往下弯那种，下方向整个没了）。
  ok(atBase.length === 20 || atBase.length === 12, `地面接头该有 20（或开了地面判定后 12）根弧线，得到 ${atBase.length}`)

  // 3. 点一根弧线：弯管落在弧线终点
  const pick = atTop.find((h) => h.data.dir[0] === 1 && h.data.bowNormal[1] === 1)
  ok(!!pick, '该有一根 +x 出发、往上弯的弧线')
  const res = m.extendBow(pick.data.nodeId, pick.data.dir, pick.data.bowNormal, 'TC1', 'red', R)
  ok(res && res.tube && res.tube.bow, '放下去的是弯管')
  const end = m.nodes.get(res.node.id)
  ok(end.x === 40 && end.y === 80 && end.z === 0, `终点该在 (40,80,0)，得到 (${end.x},${end.y},${end.z})`)
  ok(res.tube.bowCenter.join(',') === '0,80,0', `圆心该在 (0,80,0)，得到 ${res.tube.bowCenter}`)

  // 4. 放完再算手柄：+x 方向被弯管的切线占了，那个方向四根全没了；
  //    「往上出发、往 +x 弯」那根的终点也是 (40,80,0)，两根弯管不能连同一对
  //    接头，所以也不给。20 - 4 - 1 = 15。
  sc.clearHandles(); b._buildHandles()
  const again = sc.handles.filter((h) => h.data.bow && h.data.nodeId === top.id)
  ok(!again.some((h) => h.data.dir[0] === 1), '+x 方向已被弯管占着，不该再有弧线')
  ok(!again.some((h) => h.data.dir[1] === 1 && h.data.bowNormal[0] === 1), '终点撞上已连接头的弧线不该再给')
  ok(again.length === 15, `顶接头剩 15 根，得到 ${again.length}`)

  // 给浏览器测试留一座（一根竖管）：E2E_OUT=<目录> 时写到那里
  if (process.env.E2E_OUT) {
    const { m: tiny } = verticalTube()
    mkdirSync(process.env.E2E_OUT, { recursive: true })
    writeFileSync(join(process.env.E2E_OUT, 'bow-test.json'), JSON.stringify(tiny.toJSON()))
  }
}

console.log(`弧线手柄检查通过，${n} 项断言`)
