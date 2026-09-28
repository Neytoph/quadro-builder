// 真实浏览器导入官方 QDF，检查占满的旋转接头与仍有空插口的接头。
// 运行：npx vite --port 5237 --strictPort，再运行 node scripts/e2e-occupied-corner.mjs。
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = process.env.BASE || 'http://127.0.0.1:5237/'
const shots = process.env.SHOTS || '.work/'
mkdirSync(shots, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
await page.addInitScript(() => {
  localStorage.setItem('quadro.builder.onboarded.v2', '1')
  localStorage.setItem('quadro.lang', 'zh')
})
await page.goto(base)
await page.waitForFunction(() => window.__quadroDev?.model && document.querySelector('canvas'))

const loadQdf = (name, nodeId) => page.evaluate(async ({ name, nodeId }) => {
  const { parseQDF } = await import('/src/engine/qdfimport.js')
  const { buildableTubes, panels, geometry } = await import('/src/engine/catalog.js')
  const response = await fetch(`/qdf/${name}`)
  assertResponse(response.ok, name)
  const data = parseQDF(await response.text(), {
    tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
  })
  const { model, builder, scene } = window.__quadroDev
  builder.recordHistory(() => model.loadJSON(data))
  builder.modelReplaced()
  builder.setMode('add')
  builder.selectedNodeId = nodeId
  builder.refresh()
  scene.frameFromYaw(model, 0, { silent: true, margin: 2.2 })
  function assertResponse(ok, file) { if (!ok) throw new Error(`QDF unavailable: ${file}`) }
}, { name, nodeId })

const inspect = (nodeId) => page.evaluate(async (nodeId) => {
  const { computeBOM, connectorsForNode } = await import('/src/engine/bom.js')
  const { model, builder, scene } = window.__quadroDev
  const node = model.nodes.get(nodeId)
  return {
    node: { id: node.id, xyz: [node.x, node.y, node.z], arms: node.arms, connectorTypes: connectorsForNode(model, node) },
    incident: [...model.tubes.values()].filter((tube) => tube.a === nodeId || tube.b === nodeId)
      .map((tube) => ({ color: tube.color, a: tube.a, b: tube.b, arm: !!tube.arm })),
    handles: scene.handleMeshes.filter((mesh) => mesh.userData.nodeId === nodeId && mesh.userData.dir)
      .map((mesh) => mesh.userData.dir),
    nodes: model.nodes.size,
    tubes: model.tubes.size,
    bom: JSON.stringify(computeBOM(model)),
    model: JSON.stringify(model.toJSON()),
    undo: builder.history.manager.undoStack.length,
  }
}, nodeId)

const pointFor = (nodeId, direction) => page.evaluate(({ nodeId, direction }) => {
  const { scene } = window.__quadroDev
  const mesh = scene.handleMeshes.find((item) => item.userData.nodeId === nodeId && item.userData.dir &&
    item.userData.dir.every((value, index) => Math.abs(value - direction[index]) < 0.01))
  if (!mesh) return null
  scene.renderer.render(scene.scene, scene.camera)
  const projected = mesh.getWorldPosition(mesh.position.clone()).project(scene.camera)
  const rect = scene.renderer.domElement.getBoundingClientRect()
  return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 }
}, { nodeId, direction })

const focusNode = (nodeId, side = 1) => page.evaluate(({ nodeId, side }) => {
  const { model, scene } = window.__quadroDev
  const node = model.nodes.get(nodeId)
  scene.controls.target.set(node.x, node.y, node.z)
  scene.camera.position.set(node.x + side * 65, node.y + 50, node.z + side * 65)
  scene.controls.update()
  scene.requestRender()
}, { nodeId, side })

await loadQdf('A0104.qdf', 'n34')
await page.waitForTimeout(1300)
const occupied = await inspect('n34')
assert.deepEqual(occupied.node.connectorTypes, ['t'])
assert.equal(occupied.node.arms.length, 3)
assert.equal(occupied.incident.length, 3)
assert.equal(occupied.handles.length, 0)
await focusNode('n34', -1)
await page.waitForTimeout(300)
await page.screenshot({ path: `${shots}corner-occupied.png` })

await page.evaluate(() => window.__quadroDev.builder.buildStep([0, 1, 0]))
let after = await inspect('n34')
for (const key of ['model', 'bom', 'undo', 'nodes', 'tubes']) assert.deepEqual(after[key], occupied[key], `keyboard changed ${key}`)

await page.evaluate(() => {
  const { model } = window.__quadroDev
  model.extend('n34', [0, 1, 0], 'T35', 'red', 35, 40)
  model.extendDiagonalSnap('n34', [0, Math.SQRT1_2, -Math.SQRT1_2], 'T35', 'red', 35, 40)
  model.extendBow('n34', [0, 1, 0], [1, 0, 0], 'TC1', 'red', 40)
})
after = await inspect('n34')
for (const key of ['model', 'bom', 'undo', 'nodes', 'tubes']) assert.deepEqual(after[key], occupied[key], `model entry changed ${key}`)

const cornerPoint = await page.evaluate(() => {
  const { model, scene } = window.__quadroDev
  const node = model.nodes.get('n34')
  const rect = scene.renderer.domElement.getBoundingClientRect()
  const projected = scene.camera.position.clone().set(node.x, node.y, node.z).project(scene.camera)
  return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 }
})
await page.mouse.click(cornerPoint.x, cornerPoint.y)
after = await inspect('n34')
for (const key of ['model', 'bom', 'undo', 'nodes', 'tubes']) assert.deepEqual(after[key], occupied[key], `corner click changed ${key}`)

await loadQdf('A0004.qdf', 'n11')
const twoPort = await inspect('n11')
assert.deepEqual(twoPort.node.connectorTypes, ['elbow'])
assert.equal(twoPort.node.arms.length, 2)
assert.equal(twoPort.incident.length, 2)
assert.equal(twoPort.handles.length, 0)
await focusNode('n11')
await page.waitForTimeout(300)
await page.screenshot({ path: `${shots}corner-two-port.png` })
await page.evaluate(() => window.__quadroDev.builder.buildStep([0, 1, 0]))
const twoPortAfter = await inspect('n11')
for (const key of ['model', 'bom', 'undo', 'nodes', 'tubes']) assert.deepEqual(twoPortAfter[key], twoPort[key], `two-port corner changed ${key}`)

await loadQdf('A0019.qdf', 'n11')
await page.waitForTimeout(1300)
const open = await inspect('n11')
assert.ok(open.handles.length > 0)
const point = await pointFor('n11', open.handles[0])
assert.ok(point)
await page.screenshot({ path: `${shots}corner-open.png` })
await page.mouse.move(point.x, point.y)
await page.waitForTimeout(150)
await page.mouse.click(point.x, point.y)
await page.waitForTimeout(300)
const built = await inspect('n11')
assert.equal(built.nodes, open.nodes + 1)
assert.equal(built.tubes, open.tubes + 1)
assert.equal(built.undo, open.undo + 1)
assert.notEqual(built.bom, open.bom)
assert.deepEqual(pageErrors, [])
await page.screenshot({ path: `${shots}corner-built.png` })

const evidence = {
  occupied: { node: occupied.node, incident: occupied.incident, handles: occupied.handles,
    before: { nodes: occupied.nodes, tubes: occupied.tubes, undo: occupied.undo },
    after: { nodes: after.nodes, tubes: after.tubes, undo: after.undo } },
  twoPort: { node: twoPort.node, incident: twoPort.incident, handles: twoPort.handles,
    before: { nodes: twoPort.nodes, tubes: twoPort.tubes, undo: twoPort.undo },
    after: { nodes: twoPortAfter.nodes, tubes: twoPortAfter.tubes, undo: twoPortAfter.undo } },
  open: { node: open.node, handles: open.handles,
    before: { nodes: open.nodes, tubes: open.tubes, undo: open.undo },
    after: { nodes: built.nodes, tubes: built.tubes, undo: built.undo } },
}
writeFileSync(`${shots}corner-browser-evidence.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
await browser.close()
