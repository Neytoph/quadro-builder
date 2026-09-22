// 起步造型 / 单体组件自检：每个几何单元都要能进模型、没有碰撞、每个接头都是真实可买的零件。
// 运行（仓库根目录）：npx vite-node scripts/check-presets.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const parts = JSON.parse(readFileSync(join(root, 'public/data/parts.json'), 'utf8'))
globalThis.localStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
globalThis.fetch = async (url) => {
  if (String(url).includes('parts.json')) return { ok: true, json: async () => parts }
  throw new Error('unexpected fetch ' + url)
}

const { loadCatalog, getPartById, partName } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { infeasibleConnectors, computeBOM, neededParts } = await import('../src/engine/bom.js')
const { setLang } = await import('../src/engine/i18n.js')
const { ALL_PRESETS, geometricPreset, jsonToFragment } = await import('../src/data/presets.ts')

await loadCatalog()
setLang('zh')

let failed = 0
for (const p of ALL_PRESETS) {
  if (p.mode === 'replace') continue
  const data = geometricPreset(p.key)
  if (!data) { console.log(`✗ ${p.key}: geometricPreset 返回空`); failed++; continue }
  const frag = jsonToFragment(data)
  if (!frag) { console.log(`✗ ${p.key}: 收不成片段`); failed++; continue }
  const m = new BuildModel()
  const res = m.loadJSON(data)
  if (res && res.ok === false) { console.log(`✗ ${p.key}: loadJSON ${res.reason}`); failed++; continue }
  const bad = infeasibleConnectors(m)
  const collisions = m.collisions()
  const need = neededParts(computeBOM(m))
  const lines = []
  for (const map of [need.tubes, need.connectors, need.panels, need.reinforcements, need.fittings]) {
    for (const [id, qty] of map.entries()) if (qty) lines.push(`${partName(getPartById(id) || { id }) || id}×${qty}`)
  }
  const problems = []
  if (!m.nodes.size) problems.push('没有接头')
  if (bad.size) problems.push(`${bad.size} 个接头做不出来`)
  if (collisions && collisions.size) problems.push(`${collisions.size} 处碰撞`)
  if (problems.length) failed++
  console.log(`${problems.length ? '✗' : '✓'} ${p.key.padEnd(14)} 接头 ${String(m.nodes.size).padStart(3)} 管 ${String(m.tubes.size).padStart(3)} 板 ${String(m.panels.size).padStart(2)}${problems.length ? '  ' + problems.join('，') : ''}`)
  console.log(`   ${lines.join(' · ')}`)
}
if (failed) {
  console.error(`\n${failed} 个单元有问题`)
  process.exit(1)
}
console.log('\n全部单元通过')
