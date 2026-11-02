import { mkdir, writeFile } from 'node:fs/promises'
import { BuildModel } from '../src/engine/model.js'
import { loadCatalog } from '../src/engine/catalog.js'
await loadCatalog()
const model = new BuildModel()
const base = model.addNode(0, 2.5, 0)
for (const [x, z] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) {
  const end = model.addNode(x, 2.5, z)
  model.addTube(base.id, end.id, 'T35', 'green', 35)
}
await mkdir('public/examples', { recursive: true })
await writeFile('public/examples/carousel-bearing-base.json', JSON.stringify(model.toJSON(), null, 2) + '\n')
const mount = model.fittingMounts('carousel_bearing').find(m => m.nodeId === base.id)
const bearing = mount && model.addFittingAt('carousel_bearing', mount)
if (!bearing) throw new Error('轴承示例安装失败')
const center = model.nodes.get(bearing.params.rotorNode)!
// 教学示例明确选用六通；正常安装轴承时保持空位。
center.unused = false
center.preferType = '6way'
const top = model.addNode(0, center.y + 40, 0)
model.addTube(center.id, top.id, 'T35', 'blue', 35)
for (const [x, z] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
  const end = model.addNode(x, center.y, z)
  model.addTube(center.id, end.id, 'T15', x === 20 ? 'red' : 'yellow', 15)
}
await writeFile('public/examples/carousel-bearing.json', JSON.stringify(model.toJSON(), null, 2) + '\n')
console.log('已生成原生轴承安装示例')
