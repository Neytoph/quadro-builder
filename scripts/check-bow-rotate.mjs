// 选中一根弯管，Q / E 绕固定端转 90 度；点击可选择要转动的端点。
//   npx --yes vite-node scripts/check-bow-rotate.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Scene } from 'three'

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
const { withHistory } = await import('./withHistory.mjs')
await loadCatalog()

function fakeScene() {
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const base = { renderer: { domElement: el }, container: el, scene: new Scene(), camera: new PerspectiveCamera(), addHandle: () => ({}), clearHandles: () => {} }
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : () => null } })
}

const R = gridSpacing()
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const pos = (m, id) => { const p = m.nodes.get(id); return [p.x, p.y, p.z] }
const same = (p, q) => p.join(',') === q.join(',')

function setup() {
  const m = new BuildModel()
  const base = m.addNode(0, 0, 0)
  const top = m.addNode(0, 40, 0)
  m.addTube(base.id, top.id, 'T35', 'red', 35)
  // 从顶接头往 +x 出发、往上弯
  const res = m.extendBow(top.id, [1, 0, 0], [0, 1, 0], 'TC1', 'red', R)
  const b = withHistory(new Builder(fakeScene(), m))
  const notices = []
  b.onNotice = (msg) => notices.push(msg)
  b.mode = 'select'
  b.selection = new Map([[res.tube.id, 'tube']])
  return { m, b, bow: res.tube, top, notices }
}

// 1. E（+1）转一下：起点不动，终点换到垂直于原弯法的位置；Q（-1）转回来
{
  const { m, b, bow, top } = setup()
  const end0 = pos(m, bow.b)
  ok(same(end0, [40, 80, 0]), `起始终点 (40,80,0)，得到 ${end0}`)
  ok(b.rotateSelectionBy(1) === true, 'E 该转成功')
  ok(bow.a === top.id, '起点不动')
  const end1 = pos(m, bow.b)
  ok(!same(end1, end0), '终点该换地方')
  ok(end1[0] === 40 && end1[1] === 40, `绕 +x 切线转 90 度，终点该在 x=40,y=40 那一圈上，得到 ${end1}`)
  ok(b.rotateSelectionBy(-1) === true, 'Q 该转成功')
  ok(same(pos(m, bow.b), end0), `Q 该转回原处，得到 ${pos(m, bow.b)}`)
  // 连按四次 E 回到原处
  for (let i = 0; i < 4; i++) b.rotateSelectionBy(1)
  ok(same(pos(m, bow.b), end0), `四次 E 该回到原处，得到 ${pos(m, bow.b)}`)
  ok(m.tubes.size === 2 && [...m.nodes.values()].length === 3, '转来转去不该留下孤儿接头')
}

// 2. 两端都连接时，Q / E 固定起点并断开另一端
{
  const { m, b, bow, notices } = setup()
  const end = m.nodes.get(bow.b)
  const beyond = m.addNode(end.x, end.y + 40, end.z)
  m.addTube(end.id, beyond.id, 'T35', 'red', 35)
  const before = pos(m, bow.b)
  ok(b.rotateSelectionBy(1) === true, '两头都连接时可以旋转')
  ok(!same(pos(m, bow.b), before), '另一端应转到新位置')
  ok(m.degree(end.id) === 1, '原结构仍在原处')
  ok(notices.some((s) => s.includes('断开') || s.includes('disconnected') || s.includes('gelöst')), `该提示连接已断开，得到 ${notices}`)
}

// 3. 起点那头空着、终点那头接着东西：绕终点转，起点搬家
{
  const m = new BuildModel()
  const a = m.addNode(0, 40, 0)                                   // 空着的一头
  const res = m.extendBow(a.id, [1, 0, 0], [0, 1, 0], 'TC1', 'red', R)
  const bEnd = m.nodes.get(res.tube.b)
  const beyond = m.addNode(bEnd.x + 40, bEnd.y, bEnd.z)
  m.addTube(bEnd.id, beyond.id, 'T35', 'red', 35)                  // 终点接着一根直管
  const b = withHistory(new Builder(fakeScene(), m))
  b.onNotice = () => {}
  b.mode = 'select'
  b.selection = new Map([[res.tube.id, 'tube']])
  const fixedId = bEnd.id
  ok(b.rotateSelectionBy(1) === true, '一头空着就该能转')
  ok(res.tube.a === fixedId || res.tube.b === fixedId, '接着东西的那头还在这根弯管上')
  ok(same(pos(m, fixedId), [40, 80, 0]), `接着东西的那头不动，得到 ${pos(m, fixedId)}`)
  const other = res.tube.a === fixedId ? res.tube.b : res.tube.a
  ok(!same(pos(m, other), [0, 40, 0]), '空着的那头该搬家')
  ok(m.degree(beyond.id) === 1 && m.tubeBetween(fixedId, beyond.id), '直管还连在原处')
}

// 4. 选了不止一件：走整体旋转，不走弯管那条路
{
  const { m, b, bow, top } = setup()
  b.selection = new Map([[bow.id, 'tube'], [top.id, 'node']])
  ok(b._selectedLoneBow() === null, '多选时不算单选弯管')
}

// 5. 两端连接时点击靠近要转动的一端，固定另一端
{
  const { m, b, bow } = setup()
  const end = m.nodes.get(bow.b)
  const beyond = m.addNode(end.x, end.y + 40, end.z)
  m.addTube(end.id, beyond.id, 'T35', 'red', 35)
  ok(b._bowPivotFor(bow, end) === bow.a, '点终点应固定起点')
  ok(b._bowPivotFor(bow, m.nodes.get(bow.a)) === bow.b, '点起点应固定终点')
}

console.log(`弯管旋转检查通过，${n} 项断言`)
