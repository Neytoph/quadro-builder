import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = path.join(root, '.work/parts-image-first')
await fs.mkdir(path.join(evidence, 'sources'), { recursive: true })
const catalog = JSON.parse(await fs.readFile(path.join(root, 'public/data/parts.json'), 'utf8'))
const photos = ['reinforce80', 'safety_clamp', 'acrylic_glass', 'TS7', ...catalog.screws.map(part => part.id)]
const sources = []
for (const id of photos) {
  const part = Object.values(catalog).filter(Array.isArray).flat().find(part => part.id === id)
  const response = await fetch(`${part.url.split('?')[0]}.json`)
  if (!response.ok) throw new Error(`官方产品读取失败：${id} ${response.status}`)
  const product = (await response.json()).product
  if (!product?.images?.length) throw new Error(`官方产品没有图片：${id}`)
  const image = product.images[0]
  const imageResponse = await fetch(image.src)
  if (!imageResponse.ok) throw new Error(`官方产品图片读取失败：${id}`)
  const raw = Buffer.from(await imageResponse.arrayBuffer())
  const extension = new URL(image.src).pathname.split('.').pop()
  const file = path.join(evidence, 'sources', `${id}.${extension}`)
  await fs.writeFile(file, raw)
  sources.push({ id, type: 'official-product-photo', product: part.url, image: image.src, width: image.width, height: image.height, source: file, data: `data:${imageResponse.headers.get('content-type')};base64,${raw.toString('base64')}` })
  console.log(`已读取官方产品图：${id}`)
}
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const page = await browser.newPage()
  await page.goto(process.env.BASE || 'http://127.0.0.1:18668/')
  const generated = await page.evaluate(async (photos) => {
    const results = []
    for (const photo of photos) {
      const image = new Image()
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = photo.data })
      for (const size of [128, 256]) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'
        const scale = (size * .92) / Math.max(image.width, image.height)
        const w = image.width * scale, h = image.height * scale
        ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)
        results.push({ id: photo.id, size, url: canvas.toDataURL('image/png') })
      }
    }
    const api = await import('/src/engine-api.ts')
    const { waitSceneReady } = await import('/src/engine/thumbShot.js')
    const THREE = await import('/node_modules/.vite/deps/three.js')
    await api.loadCatalog()
    for (const id of ['wheel_floating', 'roof_large', 'open_end']) {
      const model = new api.BuildModel()
      model.addFitting(({ wheel_floating: 'floating-wheel2', roof_large: 'roof-large2', open_end: 'open-connector2' })[id], 0, 0, 0, { color: id === 'roof_large' ? 'green' : 'black', quat: id === 'roof_large' ? [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)] : [0, 0, 0, 1] })
      const host = document.createElement('div'); host.style.width = '800px'; host.style.height = '600px'; document.body.append(host)
      const scene = new api.SceneManager(host); scene.setMotion(false); scene.setScene(false)
      scene.onMeshesReady = () => scene.renderModel(model, null)
      scene.renderModel(model, null)
      if (!await waitSceneReady(scene)) throw new Error(`网格加载超时：${id}`)
      scene.renderModel(model, null); scene.buildGroup.updateMatrixWorld(true)
      const stage = new THREE.Scene()
      scene.scene.traverse(object => { if (object.isLight) stage.add(object.clone()) })
      let meshes = 0
      scene.buildGroup.traverse(object => {
        if (object.isMesh && !object.isInstancedMesh) {
          const mesh = new THREE.Mesh(object.geometry, object.material)
          mesh.applyMatrix4(object.matrixWorld); stage.add(mesh); meshes++
        }
      })
      if (!meshes) throw new Error(`零件没有真实网格：${id}`)
      const box = new THREE.Box3().setFromObject(stage)
      const center = box.getCenter(new THREE.Vector3()), radius = box.getBoundingSphere(new THREE.Sphere()).radius
      const camera = new THREE.PerspectiveCamera(28, 1, .1, 100000)
      camera.position.copy(center).addScaledVector(new THREE.Vector3(1, .9, 1.6).normalize(), radius / Math.sin(THREE.MathUtils.degToRad(14)) * 1.06); camera.lookAt(center)
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
      renderer.setSize(512, 512); renderer.setClearColor(0, 0); renderer.outputColorSpace = scene.renderer.outputColorSpace; renderer.toneMapping = scene.renderer.toneMapping
      renderer.render(stage, camera)
      for (const size of [128, 256]) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(renderer.domElement, 0, 0, size, size)
        results.push({ id, size, url: canvas.toDataURL('image/png'), meshes, sizeCm: box.getSize(new THREE.Vector3()).toArray(), model: model.toJSON() })
      }
      renderer.dispose(); renderer.forceContextLoss(); scene.dispose(); host.remove()
    }
    return results
  }, sources)
  for (const result of generated) {
    const directory = path.join(root, result.size === 256 ? 'public/parts/large' : 'public/parts')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${result.id}.png`), Buffer.from(result.url.split(',')[1], 'base64'))
    if (result.model) await fs.writeFile(path.join(evidence, 'sources', `${result.id}.json`), JSON.stringify(result.model, null, 2))
  }
  await fs.writeFile(path.join(evidence, 'asset-sources.json'), JSON.stringify({ photos: sources.map(({ data, ...source }) => source), renders: generated.filter(result => result.meshes).map(({ url, model, ...result }) => result) }, null, 2))
  await fs.writeFile(path.join(root, 'public/parts/sources.json'), JSON.stringify({
    generator: 'scripts/complete-part-images.mjs',
    sizes: [128, 256],
    photos: sources.map(({ id, type, product, image, width, height }) => ({ id, type, product, image, width, height })),
    renders: generated.filter(result => result.meshes && result.size === 256).map(({ id, meshes, sizeCm, model }) => ({ id, type: 'builder-scene-geometry', meshes, sizeCm, model })),
  }, null, 2) + '\n')
  console.log(`已生成 ${generated.length} 张128/256真实零件图`)
} finally { await browser.close() }
