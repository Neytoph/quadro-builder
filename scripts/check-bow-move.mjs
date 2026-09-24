// 弯管挪动 / 复制粘贴后圆心跟着走：弯管按 bowCenter 画弧，圆心没跟上就会画成一截歪管。
//   npx --yes vite-node scripts/check-bow-move.mjs
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

const { loadCatalog, gridSpacing } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { Builder } = await import('../src/engine/builder.js')
const { withHistory } = await import('./withHistory.mjs')
const { setLang } = await import('../src/engine/i18n.js')
await loadCatalog()
setLang('zh')

const R = gridSpacing()
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

/** 弯管两头到圆心的距离都该是半径。 */
function bowIntact(m, t) {
  const c = t.bowCenter
  const d = (id) => { const p = m.nodes.get(id); return Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]) }
  return Math.abs(d(t.a) - R) < 0.6 && Math.abs(d(t.b) - R) < 0.6
}

function setup() {
  const m = new BuildModel()
  const base = m.addNode(0, 0, 0)
  const top = m.addNode(0, 40, 0)
  const post = m.addTube(base.id, top.id, 'T35', 'red', 35)
  const bow = m.extendBow(top.id, [1, 0, 0], [0, 1, 0], 'TC1', 'red', R).tube
  return { m, bow, post }
}

// 1. 只选弯管往旁边挪：和竖管断开，圆心跟着挪
{
  const { m, bow } = setup()
  const c0 = bow.bowCenter.slice()
  const res = m.moveSelection(new Map([[bow.id, 'tube']]), 80, 0, 0)
  ok(res.ok, `只选弯管挪 80 该成功，得到 ${res.reason}`)
  const t = m.tubes.get(bow.id)
  ok(t.bowCenter[0] === c0[0] + 80 && t.bowCenter[1] === c0[1] && t.bowCenter[2] === c0[2], `圆心跟着挪 80，得到 ${t.bowCenter}`)
  ok(bowIntact(m, t), '挪完弯管还是完整的四分之一圆')
}

// 2. 整块（竖管 + 弯管）往上挪一层
{
  const { m, bow, post } = setup()
  const res = m.moveSelection(new Map([[bow.id, 'tube'], [post.id, 'tube']]), 0, 40, 0)
  ok(res.ok, `整块挪该成功，得到 ${res.reason}`)
  ok(bowIntact(m, m.tubes.get(bow.id)), '整块挪完弯管完整')
}

// 3. 复制粘贴到别处：新弯管的圆心落在新位置
{
  const { m, bow, post } = setup()
  const frag = m.extractSelection(new Map([[bow.id, 'tube'], [post.id, 'tube']]))
  ok(frag && frag.tubes.some((t) => t.bowCenter), '片段带着弯管')
  const ids = m.insertFragment(frag, [200, 0, 120])
  const copy = ids.tubes.map((id) => m.tubes.get(id)).find((t) => t.bow)
  ok(copy && bowIntact(m, copy), `粘贴出的弯管完整，圆心 ${copy && copy.bowCenter}`)
  ok(bowIntact(m, m.tubes.get(bow.id)), '原来的弯管不受影响')
}

// 4. 放下弯管提示「再点一下换方向」；点它转成功提示「已换方向」
{
  const { m, bow } = setup()
  const el = { addEventListener() {}, removeEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const scene = new Proxy({ renderer: { domElement: el }, container: el }, { get(t, k) { return k in t ? t[k] : () => null } })
  const b = withHistory(new Builder(scene, m))
  const notices = []
  b.onNotice = (msg) => notices.push(String(msg))
  b._notePlaced(bow.id, 'tube')
  ok(/再点一下弯管/.test(notices.at(-1)), `放弯管该提示点它换方向，得到 ${notices.at(-1)}`)
  const straight = [...m.tubes.values()].find((t) => !t.bow)
  b._notePlaced(straight.id, 'tube')
  ok(!/弯管/.test(notices.at(-1)), `直管不提示换方向，得到 ${notices.at(-1)}`)
}

console.log(`弯管挪动 / 粘贴检查通过，${n} 项断言`)
