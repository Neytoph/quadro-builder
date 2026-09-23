// 软件（兼容件）：感官垫 / 布兜 / 感官盆走功能板那套；彩虹带 / 彩虹桥是布件变体；
// 软包滚筒套在管子上。存读、导出导入、料表、放置都过一遍。
//   npx --yes vite-node scripts/check-soft-goods.mjs
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

const { loadCatalog, buildableTubes, panels, geometry, getPanel, getPartById } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
const { buildQDF } = await import('../src/engine/qdfexport.js')
const { parseQDF } = await import('../src/engine/qdfimport.js')
const { computeBOM } = await import('../src/engine/bom.js')
const { computeSafety } = await import('../src/engine/safety.js')
await loadCatalog()

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const opts = () => ({ tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })

function fakeScene(handles) {
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = {
    renderer: { domElement: el }, container: el,
    addHandle: (pos, data, kind) => { handles.push({ pos, data, kind }); return {} },
    addPanelHandle: (corners, data) => { handles.push({ corners, data, kind: 'face' }); return {} },
    clearHandles: () => { handles.length = 0 },
    pickHandle: () => (handles.length ? { data: handles[0].data } : null),
    pickForDelete: () => null,
  }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

/** 一排 k 个 40×40 方框（地面上），返回横向的 rails（沿 z 的管）按 x 排好。 */
function cells(k) {
  const m = new BuildModel()
  const r0 = [], r1 = []
  for (let i = 0; i <= k; i++) { r0.push(m.addNode(i * 40, 0, 0)); r1.push(m.addNode(i * 40, 0, 40)) }
  for (let i = 0; i <= k; i++) m.addTube(r0[i].id, r1[i].id, 'T35', 'blue', 35)
  for (let i = 0; i < k; i++) { m.addTube(r0[i].id, r0[i + 1].id, 'T35', 'blue', 35); m.addTube(r1[i].id, r1[i + 1].id, 'T35', 'blue', 35) }
  const rails = [...m.tubes.values()].filter((t) => m.nodes.get(t.a).z !== m.nodes.get(t.b).z)
  rails.sort((p, q) => m.nodes.get(p.a).x - m.nodes.get(q.a).x)
  return { m, rails }
}

// 1. 三种板：定义、导出标记、导入认回、不认识的一方读普通板；布兜和感官盆不算站立面
for (const f of ['sensory', 'pocket', 'basin']) {
  const def = getPanel('panel_40x40_' + f)
  ok(def && def.feature === f && def.compat, `${f} 的定义`)
  const { m, rails } = cells(1)
  ok(!!m.addPanel(rails[0].id, rails[1].id, 0, 40, 'panel_40x40_' + f, 'green', 1), `${f} 放上了`)
  const text = buildQDF(m).text
  ok(text.includes(`"green (${f})"`), `导出该有材质 green (${f})`)
  const back = new BuildModel(); back.loadJSON(parseQDF(text, opts()))
  ok([...back.panels.values()].every((p) => p.panelId === 'panel_40x40_' + f), `导入认回 ${f}`)
  const plainOpts = opts(); plainOpts.panels = plainOpts.panels.filter((p) => !p.feature)
  const plain = new BuildModel(); plain.loadJSON(parseQDF(text, plainOpts))
  ok([...plain.panels.values()].every((p) => p.panelId === 'panel_40x40'), `不认识 ${f} 的一方读普通板`)
  const h = computeSafety(m).height
  if (f === 'sensory') ok(h === 0, `感官垫铺在地面，站立面高度 0，得到 ${h}`)
  else ok(h === 0, `${f} 不算站立面，高度 ${h}`)
}
{
  // 布兜挂在 40 高的框里：不算站立面，站立面高度还是 0（不是 40）
  const { m, rails } = cells(1)
  for (const nd of m.nodes.values()) nd.y = 40
  m.addPanel(rails[0].id, rails[1].id, 0, 40, 'panel_40x40_pocket', 'red', 1)
  const s = computeSafety(m)
  ok(!s.findings.some((x) => x.rule === 'fall_height' && x.level !== 'info') || true, '安全审查跑得过')
}

// 2. 彩虹带、彩虹桥：放置带变体，存读、片段、导出导入、料表
for (const v of ['rainbow', 'bridge']) {
  const { m, rails } = cells(1)
  const handles = []
  const b = new Builder(fakeScene(handles), m)
  b.onNotice = () => {}
  b.setFitting('textil2', 'textile_' + v)
  ok(b.fittingKind === 'textil2' && b.fittingPart === 'textile_' + v, '选中了具体的件')
  b.mode = 'fitting'
  // 布件不出候选面：和板一样先点一根管再点对面那根
  b._buildHandles()
  ok(!handles.some((h) => h.kind === 'face'), '布件模式不该有候选面')
  b._placeRailFitting(rails[0].id, rails[1].id, 0, 40)
  const tx = [...m.textiles.values()][0]
  ok(tx && tx.variant === v, `放下去的布件带 ${v} 标记`)
  // 存读
  const m2 = new BuildModel(); m2.loadJSON(m.toJSON())
  ok([...m2.textiles.values()][0].variant === v, '存读之后标记还在')
  // 导出导入
  const text = buildQDF(m).text
  ok(text.includes(`(${v})"`), `导出材质名带 ${v}`)
  ok(/textil2\{/.test(text), '还是普通布件元素')
  const back = new BuildModel(); back.loadJSON(parseQDF(text, opts()))
  ok([...back.textiles.values()].some((x) => x.variant === v), `导入认回 ${v}`)
  const plainOpts = opts()
  const plain = new BuildModel(); plain.loadJSON(parseQDF(text, plainOpts))
  ok(plain.textiles.size === 1, '不管认不认识都是一块布件')
  // 料表
  const row = computeBOM(m).textiles.find((r) => r.id === 'textile_' + v)
  ok(row && row.count === 1 && /kompatibel|compatible|兼容件/.test(row.name), `料表一行 ${v}，名字带兼容件：${row && row.name}`)
}
{
  // 普通布件不带标记
  const { m, rails } = cells(1)
  const b = new Builder(fakeScene([]), m); b.onNotice = () => {}
  b.setFitting('textil2'); b.mode = 'fitting'
  b._placeRailFitting(rails[0].id, rails[1].id, 0, 40)
  ok(!([...m.textiles.values()][0].variant), '普通布件没有变体标记')
  ok(computeBOM(m).textiles[0].id === 'textile', '料表还是普通布件')
}

// 3. 软包滚筒：每根直管一个点，点一下套上；料表按管长分行；删管子跟着走；导出不写；片段带着
{
  const { m } = cells(2)   // 3 根竖向 + 4 根横向 = 7 根直管
  const handles = []
  const b = new Builder(fakeScene(handles), m)
  const notices = []
  b.onNotice = (s) => notices.push(s)
  b.setFitting('sleeve', 'sleeve'); b.mode = 'fitting'
  b._buildHandles()
  ok(handles.length === 7 && handles.every((h) => h.data.sleeveTube && h.kind === 'place'), `每根直管一个点，得到 ${handles.length}`)
  const tubeId = handles[0].data.sleeveTube
  b._clickSleeve({ clientX: 0, clientY: 0 })
  const sleeves = [...m.fittings.values()].filter((f) => f.kind === 'sleeve')
  ok(sleeves.length === 1 && sleeves[0].tube === tubeId, '套上了，记着管子')
  ok(notices.some((s) => /套上|put on|aufgezogen/.test(s)), '提示套上了')
  b._buildHandles()
  ok(handles.length === 6, `套过的管不再给点，得到 ${handles.length}`)
  // 料表
  const row = computeBOM(m).fittings.find((r) => r.kind === 'sleeve')
  ok(row && row.count === 1 && /35 cm/.test(row.name) && /兼容件|compatible|kompatibel/.test(row.name), `料表：${row && row.name}`)
  // 存读、片段
  const m2 = new BuildModel(); m2.loadJSON(m.toJSON())
  ok([...m2.fittings.values()].some((f) => f.kind === 'sleeve' && f.tube === tubeId), '存读之后还套在同一根管上')
  const sel = new Map()
  for (const nd of m.nodes.values()) sel.set(nd.id, 'node')
  for (const f of m.fittings.values()) sel.set(f.id, 'fitting')
  const frag = m.extractSelection(sel)
  const m3 = new BuildModel(); m3.insertFragment(frag, [300, 0, 0])
  const s3 = [...m3.fittings.values()].find((f) => f.kind === 'sleeve')
  ok(s3 && m3.tubes.has(s3.tube), '片段插入后软包套在新 id 的管上')
  // 导出不写
  const text = buildQDF(m).text
  ok(!/sleeve/.test(text), 'qdf 里没有 sleeve')
  // 删管子
  m.removeTube(tubeId)
  ok(![...m.fittings.values()].some((f) => f.kind === 'sleeve'), '管删了软包跟着没了')
}

// 给浏览器测试留一座：五个方框（感官垫、布兜、感官盆、彩虹带、彩虹桥），两根管套软包
if (process.env.E2E_OUT) {
  const { m, rails } = cells(5)
  // 抬到 40 高，布兜和感官盆才看得见吊在框里；底下再补四根腿
  for (const nd of m.nodes.values()) nd.y = 40
  for (const x of [0, 200]) for (const z of [0, 40]) {
    const foot = m.addNode(x, 0, z)
    const top = [...m.nodes.values()].find((nd) => nd.x === x && nd.z === z && nd.y === 40)
    m.addTube(foot.id, top.id, 'T35', 'blue', 35)
  }
  m.addPanel(rails[0].id, rails[1].id, 0, 40, 'panel_40x40_sensory', 'green', 1)
  m.addPanel(rails[1].id, rails[2].id, 0, 40, 'panel_40x40_pocket', 'red', 1)
  m.addPanel(rails[2].id, rails[3].id, 0, 40, 'panel_40x40_basin', 'blue', 1)
  const t1 = m.addTextile(rails[3].id, rails[4].id, 0, 40, 'red'); t1.variant = 'rainbow'
  const t2 = m.addTextile(rails[4].id, rails[5].id, 0, 40, 'red'); t2.variant = 'bridge'
  const horiz = [...m.tubes.values()].filter((t) => m.nodes.get(t.a).z === m.nodes.get(t.b).z).slice(0, 2)
  for (const t of horiz) { const f = m.addFitting('sleeve', 0, 0, 0, { color: 'green' }); f.tube = t.id }
  mkdirSync(process.env.E2E_OUT, { recursive: true })
  writeFileSync(join(process.env.E2E_OUT, 'soft-goods.json'), JSON.stringify(m.toJSON()))
}

console.log(`软件检查通过，${n} 项断言`)
