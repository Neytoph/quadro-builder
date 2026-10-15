import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// 独立 headless 渲染过程仅生成本地三维资产；交互验收由 cua_repl 执行。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const relativeModel = process.env.MODEL || 'public/examples/original-accessories.json'
const ids = process.env.PART_IDS?.split(',').filter(Boolean)
const outputSize = Number(process.env.OUTPUT_SIZE || 128)
if (!Number.isInteger(outputSize) || outputSize < 128 || outputSize > 1024) throw new Error('OUTPUT_SIZE 必须为 128 到 1024 的整数')
const outputDirectory = path.resolve(root, process.env.OUTPUT_DIR || 'public/parts')
await fs.mkdir(outputDirectory, { recursive: true })
const retainedFixtures = new Set(['gym_rings.json', 'swing.json', 'textile_rainbow.json', 'ocean_balls.json', 'TA35.json', 'TA75.json'])
const modelPaths = process.env.MODEL_DIR
  ? (await fs.readdir(path.resolve(root, process.env.MODEL_DIR))).filter(name => name.endsWith('.json') && !name.endsWith('-frame.json') && !name.endsWith('manifest.json') && !retainedFixtures.has(name)).sort().map(name => path.resolve(root, process.env.MODEL_DIR, name))
  : [path.resolve(root, relativeModel)]
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const manifest = []
  for (const modelPath of modelPaths) {
    const model = JSON.parse(await fs.readFile(modelPath, 'utf8'))
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    try {
      // 每个真实夹具独立释放 WebGL 上下文，避免大目录产生上下文累积。
      await page.goto(`${process.env.BASE || 'http://127.0.0.1:18636'}/examples/original-accessories.json`)
      console.log(`开始渲染真实组件：${path.relative(root, modelPath)}`)
      const rendered = await page.evaluate(async ({ data, ids, outputSize }) => {
        const { renderAccessoryIcons } = await import('/scripts/accessory-icon-render.ts')
        const host = document.createElement('div')
        host.style.width = '800px'; host.style.height = '600px'
        document.body.appendChild(host)
        return renderAccessoryIcons(data, host, ids, { outputSize })
      }, { data: model, ids, outputSize })
      for (const part of rendered) {
        const output = path.join(outputDirectory, `${part.id}.png`)
        await fs.writeFile(output, Buffer.from(part.url.split(',')[1], 'base64'))
        manifest.push({ id: part.id, meshes: part.meshes, sizeCm: part.size, output, source: modelPath })
        console.log(`${part.id}: ${part.meshes} meshes, ${part.size.map(n => n.toFixed(1)).join(' × ')} cm`)
      }
    } finally { await page.close() }
  }
  const evidence = path.join(root, '.work/frontend-evidence')
  await fs.mkdir(evidence, { recursive: true })
  await fs.writeFile(path.join(evidence, process.env.MANIFEST || 'icon-manifest.json'), JSON.stringify(manifest, null, 2))
} finally {
  await browser.close()
}
