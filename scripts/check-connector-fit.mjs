// 官方造型删管、加管、拆开以后，通跟着换成合适的那一种：画面、料表、导出三处的臂数一致。
//   npx --yes vite-node scripts/check-connector-fit.mjs
import { readFileSync, readdirSync } from 'node:fs'
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

const { loadCatalog, getConnector, spacingFor } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
const { connectorsForNode } = await import('../src/engine/bom.js')
const { parseDesign } = await import('../src/engine/library.js')
const { buildQDF } = await import('../src/engine/qdfexport.js')
const { setLang } = await import('../src/engine/i18n.js')
await loadCatalog()
setLang('zh')

let count = 0
const ok = (cond, msg) => { assert.ok(cond, msg); count++ }

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v) => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L] }
const tubeDirs = (m, n) => {
  const out = []
  for (const t of m.tubes.values()) {
    if (t.link || t.arm || t.bow) continue
    const o = t.a === n.id ? m.nodes.get(t.b) : t.b === n.id ? m.nodes.get(t.a) : null
    if (o) out.push(unit([o.x - n.x, o.y - n.y, o.z - n.z]))
  }
  return out
}
const union = (a, b) => { const out = [...a]; for (const d of b) if (!out.some((e) => dot(e, d) > 0.9)) out.push(d); return out }
// 画面上的臂：插着管的方向加上文件里写明的臂（scene.js 的 _connectorArmDirs 同样这么取）
const drawnArms = (m, n) => union(tubeDirs(m, n), n.arms || []).length
const bomArms = (m, n) => connectorsForNode(m, n).reduce((s, t) => s + ((getConnector(t) || {}).arms || 0), 0)
const exportedArms = (m, n) => {
  const back = parseDesign(buildQDF(m).text)
  const nb = back.nodes.find((o) => Math.hypot(o.x - n.x, o.y - n.y, o.z - n.z) < 1)
  return nb && nb.arms ? nb.arms.length : 0
}
const arms3 = (m, n) => [drawnArms(m, n), bomArms(m, n), exportedArms(m, n)]
const same = (r) => r[0] === r[1] && r[1] === r[2]

// 普通的通：没挂零件、没有斜向和弯管、每一臂都插着轴向的直管
const plain = (m, n) => !n.part && !n.c45 && !n.c45body && !n.unused && n.arms
  && [...m.tubes.values()].every((t) => !((t.a === n.id || t.b === n.id) && (t.arm || t.bow || t.link)))
  && tubeDirs(m, n).length === n.arms.length
  && tubeDirs(m, n).every((d) => Math.max(...d.map(Math.abs)) > 0.99)

const load = (file) => {
  const m = new BuildModel()
  m.loadJSON(parseDesign(readFileSync(join(root, 'public/qdf', file), 'utf8')))
  return m
}
const tubeAt = (m, n) => [...m.tubes.values()].find((t) => !t.arm && !t.link && (t.a === n.id || t.b === n.id))
const otherEnd = (m, t, n) => m.nodes.get(t.a === n.id ? t.b : t.a)
const fourWay = (m) => [...m.nodes.values()].find((n) => plain(m, n) && n.arms.length === 4)

// 1. 四通删掉一根管：两头的通在画面、料表、导出里一起少一臂
{
  const m = load('A0006.qdf')
  const n = fourWay(m)
  ok(n, 'A0006 里有一个四臂的普通通')
  const t = tubeAt(m, n)
  const o = otherEnd(m, t, n)
  const oBefore = drawnArms(m, o)
  m.removeTube(t.id)
  const r = arms3(m, n)
  ok(same(r) && r[0] === 3, `删管以后这个通三处都是三臂，得到 画面${r[0]} 料表${r[1]} 导出${r[2]}`)
  const ro = arms3(m, o)
  ok(same(ro) && ro[0] === oBefore - 1, `另一头的通也少一臂，原来 ${oBefore}，得到 ${ro}`)
}

// 2. 删掉一个通：连在它上面的通各自少一臂
{
  const m = load('A0006.qdf')
  const n = fourWay(m)
  const t = tubeAt(m, n)
  const o = otherEnd(m, t, n)
  const before = drawnArms(m, n)
  m.removeNode(o.id)
  const r = arms3(m, n)
  ok(same(r) && r[0] === before - 1, `删掉邻居通以后少一臂，得到 ${r}`)
}

// 3. 在编辑器里选中管子删除，再撤销：臂数跟着回来
{
  const m = load('A0006.qdf')
  const n = fourWay(m)
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const scene = new Proxy({ renderer: { domElement: el }, container: el }, { get(t, k) { return k in t ? t[k] : () => null } })
  const b = new Builder(scene, m)
  const t = tubeAt(m, n)
  b.selection.set(t.id, 'tube')
  b.deleteSelection()
  let r = arms3(m, n)
  ok(same(r) && r[0] === 3, `编辑器删除以后三臂，得到 ${r}`)
  b.undo()
  const back = m.nodes.get(n.id)
  r = arms3(m, back)
  ok(same(r) && r[0] === 4, `撤销以后回到四臂，得到 ${r}`)
}

// 4. 往空着的方向加一根管：三处一起多一臂
{
  const m = load('A0006.qdf')
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]
  let done = false
  for (const n of m.nodes.values()) {
    if (!plain(m, n) || n.arms.length !== 3) continue
    const free = axes.find((a) => !tubeDirs(m, n).some((d) => dot(d, a) > 0.9))
    if (!free) continue
    const res = m.extend(n.id, free, 'T35', 'red', 35, spacingFor(35))
    if (!res || !res.tube) continue
    const r = arms3(m, n)
    ok(same(r) && r[0] === 4, `三通加一根管以后三处都是四臂，得到 ${r}`)
    done = true
    break
  }
  ok(done, 'A0006 里找到能加管的三通')
}

// 5. 把一个通拖走：拖走的通不留空臂，留在原地接住管子的通照旧
{
  const m = load('A0006.qdf')
  const n = fourWay(m)
  const pos = [n.x, n.y, n.z]
  const res = m.moveSelection(new Map([[n.id, 'node']]), 0, 400, 0)
  ok(res.ok && res.detached === 4, `拖走四通，拆开四根管，得到 ${JSON.stringify(res)}`)
  const moved = m.nodes.get(n.id)
  ok(!moved.arms, '拖走的通不再带着文件里的臂')
  const stay = [...m.nodes.values()].find((o) => o.id !== n.id && Math.hypot(o.x - pos[0], o.y - pos[1], o.z - pos[2]) < 0.5)
  const r = arms3(m, stay)
  ok(same(r) && r[0] === 4, `原地的通还是四臂，得到 ${r}`)
}

// 6. 原设计里空着的臂不动：删掉别的方向上的管，那一臂还在
{
  let checked = 0
  for (const f of ['A0015.qdf', 'A0016.qdf', 'A0018.qdf']) {
    const m = load(f)
    for (const n of m.nodes.values()) {
      if (!n.arms || n.part || n.c45 || n.c45body || n.unused) continue
      const d = tubeDirs(m, n)
      const open = n.arms.filter((a) => !d.some((e) => dot(e, a) > 0.9))
      if (!open.length || d.length < 2) continue
      m.removeTube(tubeAt(m, n).id)
      const left = n.arms || []
      ok(open.every((a) => left.some((e) => dot(e, a) > 0.99)), `${f} ${n.id} 原本空着的臂还在`)
      ok(drawnArms(m, n) === exportedArms(m, n), `${f} ${n.id} 画面和导出一致`)
      checked++
      break
    }
  }
  ok(checked === 3, `三个带空臂的官方造型都查到了，查了 ${checked} 个`)
}

// 7. 全部官方造型：各挑一个普通的三通或四通删一根管，三处一致
{
  let total = 0
  const bad = []
  for (const f of readdirSync(join(root, 'public/qdf')).filter((x) => x.endsWith('.qdf')).sort()) {
    const text = readFileSync(join(root, 'public/qdf', f), 'utf8')
    const data = parseDesign(text)
    if (!data) continue
    const m = new BuildModel()
    m.loadJSON(data)
    const n = [...m.nodes.values()].find((x) => plain(m, x) && x.arms.length >= 3)
    if (!n) continue
    m.removeTube(tubeAt(m, n).id)
    const r = arms3(m, n)
    total++
    if (!same(r)) bad.push(`${f} ${n.id} ${r}`)
  }
  ok(total > 400 && !bad.length, `官方造型删管后三处一致：查了 ${total} 个，不一致 ${bad.length} 个 ${bad.slice(0, 5).join('；')}`)
}

console.log(`通随管子增删调整检查通过，${count} 项断言`)
