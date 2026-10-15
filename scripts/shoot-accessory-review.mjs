import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// 仅输出本地真实三维资产；不控制用户浏览器或伪造 Builder 界面。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '.work/frontend-evidence/appearance-views')
await fs.mkdir(output, { recursive: true })
const groups = {
  six: [['panel_40x40_magnet', '磁吸板'], ['panel_40x40_honeycomb', '蜂窝板'], ['panel_40x40_climbing', '大攀岩板 · 40×40'], ['panel_40x30_climbing', '中攀岩板 · 40×30'], ['panel_40x20_climbing', '小攀岩板 · 40×20'], ['panel_40x40_felt', '毛毡板']],
  sensory: [['panel_40x40_sensory', '透明凝胶感官垫'], ['panel_40x40_lego', '经典绿色积木板']],
  clear: [['acrylic_panel_40x40', '透明板 · 40×40'], ['acrylic_panel_40x20', '透明小板 · 40×20'], ['acrylic_panel_40x60', '透明长板 · 40×60'], ['acrylic_hole_panel_40x40', '透明九孔板'], ['acrylic_platform_40x40', '透明平台'], ['panel_40x40_capsule', '透明凸半球太空舱']],
  sky: [['panel_40x40', '普通方板'], ['hole_panel_40x40', '九孔板'], ['panel_40x20_castle', '城垛板'], ['panel_sector_40', '扇形板']],
  side: [['panel_40x40_capsule', '透明凸半球 · 侧视']],
}
const requestedGroups = process.env.REVIEW_GROUP?.split(',').filter(Boolean)
if (requestedGroups?.some(group => !Object.hasOwn(groups, group))) throw new Error(`未知近景分组：${process.env.REVIEW_GROUP}`)
const manifestPath = path.join(output, 'manifest.json')
const existing = requestedGroups && await fs.stat(manifestPath).then(() => true, error => {
  if (error.code === 'ENOENT') return false
  throw error
}) ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : []
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const manifest = existing.filter(record => !requestedGroups.includes(record.group))
  for (const [group, entries] of Object.entries(groups).filter(([group]) => !requestedGroups || requestedGroups.includes(group))) for (const [id, label] of entries) {
    const source = path.join(root, `public/examples/confirmed-components/${id}.json`)
    const data = JSON.parse(await fs.readFile(source, 'utf8'))
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    try {
      await page.goto(`${process.env.BASE || 'http://127.0.0.1:18637'}/examples/original-accessories.json`)
      const views = await page.evaluate(async ({ data, id, group }) => {
        const { renderAccessoryIcons } = await import('/scripts/accessory-icon-render.ts')
        const host = document.createElement('div')
        host.style.width = '800px'; host.style.height = '600px'; document.body.appendChild(host)
        const direction = group === 'side' ? [2, .3, .45] : undefined
        const single = (await renderAccessoryIcons(data, host, [id], { outputSize: 512, direction }))[0]
        const mounted = (await renderAccessoryIcons(data, host, [id], { outputSize: 512, includeFrame: true, direction }))[0]
        return { single, mounted }
      }, { data, id, group })
      const record = { group, id, label, source, meshes: views.single.meshes, sizeCm: views.single.size }
      for (const [view, part] of Object.entries(views)) {
        const filename = path.join(output, `${group}-${id}-${view}.png`)
        await fs.writeFile(filename, Buffer.from(part.url.split(',')[1], 'base64'))
        record[view] = filename
      }
      manifest.push(record)
      process.stdout.write(`${group} ${id}：真实单件与安装框完成。\n`)
    } finally { await page.close() }
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
} finally { await browser.close() }
