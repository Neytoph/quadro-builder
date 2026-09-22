// 镜像和成组的引擎自检。
// 运行（仓库根目录）：npx vite-node scripts/check-editing.mjs
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
const { loadCatalog, getPanel } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { infeasibleConnectors } = await import('../src/engine/bom.js')
const { geometricPreset } = await import('../src/data/presets.ts')
await loadCatalog()

const at = (m, x, y, z) => m.findNodeNear(x, y, z)
const has = (m, x, y, z) => !!at(m, x, y, z)
const selAll = (m) => {
  const sel = new Map()
  for (const id of m.tubes.keys()) sel.set(id, 'tube')
  for (const id of m.panels.keys()) sel.set(id, 'panel')
  for (const id of m.slides.keys()) sel.set(id, 'slide')
  return sel
}
let ok = 0
const check = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (cond) ok++; else process.exitCode = 1 }

// 1. 滑梯塔左右镜像：滑梯从 -x 那面挪到 +x 那面，板和接头都对称，接头仍可行
{
  const m = new BuildModel()
  m.loadJSON(geometricPreset('slide_tower'))
  const slide = { ...[...m.slides.values()][0] }
  const towerX = () => { const xs = [...m.nodes.values()].map((n) => n.x); return (Math.min(...xs) + Math.max(...xs)) / 2 }
  const cx0 = towerX()
  const before = m.toJSON()
  const res = m.mirrorSelection(selAll(m), 'x', { merge: true, validate: infeasibleConnectors, grid: 5 })
  check('滑梯塔沿 x 镜像成功', res.ok)
  const after = [...m.slides.values()][0]
  const cx1 = towerX()
  console.log(`   滑梯 x ${slide.x} → ${after.x}，塔中心 x ${cx0} → ${cx1}`)
  check('滑梯挪到了塔的另一侧', Math.sign(after.x - cx1) === -Math.sign(slide.x - cx0) && Math.abs(after.z - slide.z) < 0.01)
  check('接头数不变', m.nodes.size === before.nodes.length)
  check('板还在顶面', [...m.panels.values()].length === 1)
  check('接头全部可行', infeasibleConnectors(m).size === 0)
  // 再翻一次回到原样
  m.mirrorSelection(selAll(m), 'x', { merge: true, validate: infeasibleConnectors, grid: 5 })
  const back = [...m.slides.values()][0]
  check('翻两次回到原位', Math.abs(back.x - slide.x) < 0.01 && Math.abs(back.z - slide.z) < 0.01)
}

// 2. 转角台阶前后镜像：三块板的位置对称
{
  const m = new BuildModel()
  m.loadJSON(geometricPreset('steps_l'))
  const zs = [...m.panels.values()].map((p) => m.panelCorners(p).map((c) => c[2])).map((c) => (Math.min(...c) + Math.max(...c)) / 2).sort((a, b) => a - b)
  const res = m.mirrorSelection(selAll(m), 'z', { merge: true, validate: infeasibleConnectors, grid: 5 })
  check('转角台阶沿 z 镜像成功', res.ok)
  const zs2 = [...m.panels.values()].map((p) => m.panelCorners(p).map((c) => c[2])).map((c) => (Math.min(...c) + Math.max(...c)) / 2).sort((a, b) => a - b)
  const c = (Math.min(...zs) + Math.max(...zs)) / 2
  const mirrored = zs.map((z) => 2 * c - z).sort((a, b) => a - b)
  check('三块板关于中面对称', zs2.every((z, i) => Math.abs(z - mirrored[i]) < 5))
  check('接头全部可行', infeasibleConnectors(m).size === 0)
}

// 3. 弯滑梯拒绝镜像
{
  const m = new BuildModel()
  m.loadJSON(geometricPreset('slide_tower'))
  const s = [...m.slides.values()][0]
  s.kind = 'curved-slide2'
  const res = m.mirrorSelection(selAll(m), 'x', { merge: true, grid: 5 })
  check('含弯滑梯时拒绝，理由 chiral', !res.ok && res.reason === 'chiral')
}

// 4. 成组：存读、复制粘贴、删件后自动消失
{
  const m = new BuildModel()
  m.loadJSON(geometricPreset('cube'))
  const tubes = [...m.tubes.keys()]
  const gid = m.groupParts(tubes.slice(0, 4))
  check('四根管成组', !!gid && m.groups.get(gid).size === 4)
  check('groupOf 找得到', m.groupOf(tubes[1]) === gid && m.groupOf(tubes[6]) === null)
  const json = m.toJSON()
  check('JSON 里带组', Array.isArray(json.groups) && json.groups.length === 1 && json.groups[0].ids.length === 4)
  const m2 = new BuildModel()
  m2.loadJSON(json)
  check('读回来组还在', m2.groups.size === 1 && [...m2.groups.values()][0].size === 4)
  // 复制粘贴：整组在片段里就跟着走
  const sel = new Map(tubes.slice(0, 4).map((id) => [id, 'tube']))
  const frag = m2.extractSelection(sel)
  check('片段里带组', frag.groups.length === 1)
  const out = m2.insertFragment(frag, [200, 0, 0])
  console.log(`   粘贴进来 ${out.tubes.length} 根管，组数 ${m2.groups.size}`)
  check('粘贴后多了一组', m2.groups.size === 2 && out.tubes.length >= 4)
  // 删掉组里三根，剩一根，组消失
  for (const id of tubes.slice(0, 3)) m2.removeTube(id)
  m2.toJSON()
  check('删到剩一件时组自动消失', m2.groups.size === 1)
  // 解组
  const g2 = [...m2.groups.keys()][0]
  const n = m2.ungroupParts([...m2.groups.get(g2)].slice(0, 1))
  check('解组', n === 1 && m2.groups.size === 0)
}

console.log(`\n${ok} 项通过${process.exitCode ? '，有失败' : ''}`)
