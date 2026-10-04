import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 公共索引只收录实际存在的图片；编号别名来自目录中的同件编码。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entries = (await fs.readdir(path.join(root, 'public/parts/large'))).filter(name => name.endsWith('.png')).map(name => path.basename(name, '.png')).sort()
for (const id of entries) await fs.access(path.join(root, 'public/parts', `${id}.png`))
const source = '// 由 scripts/index-part-images.mjs 根据实际高清 PNG 生成。\nexport const PART_IMAGES_LARGE: ReadonlySet<string> = new Set(' + JSON.stringify(entries, null, 2) + ')\n'
await fs.writeFile(path.join(root, 'src/ui/partImagesHiDpi.ts'), source)
const small = (await fs.readdir(path.join(root, 'public/parts'))).filter(name => name.endsWith('.png')).map(name => path.basename(name, '.png')).sort()
const catalog = JSON.parse(await fs.readFile(path.join(root, 'public/data/parts.json'), 'utf8'))
const aliases = { 'slide-new2': 'slide_integral' }
const identities = new Map()
for (const rows of Object.values(catalog).filter(Array.isArray)) for (const part of rows) {
  if (!small.includes(part.id)) continue
  for (const alias of [part.code, part.qdf]) if (alias && alias !== part.id && !small.includes(alias)) {
    if (!identities.has(alias)) identities.set(alias, new Set())
    identities.get(alias).add(part.id)
  }
}
// 这个 QDF 原语仍需臂数 mask 才能确定单件，不能直接作为三臂件别名。
for (const [alias, ids] of identities) if (ids.size === 1 && alias !== 'hole-connector4') aliases[alias] = [...ids][0]
const parts = Object.fromEntries(small.map(id => [id, { src: `parts/${id}.png`, ...(entries.includes(id) ? { srcLarge: `parts/large/${id}.png` } : {}) }]))
const manifest = { version: 1, parts, aliases }
await fs.writeFile(path.join(root, 'public/data/part-images.json'), JSON.stringify(manifest, null, 2) + '\n')
await fs.writeFile(path.join(root, 'src/ui/partImageManifest.ts'), '// 由 scripts/index-part-images.mjs 生成，与 public/data/part-images.json 一致。\nexport const PART_IMAGE_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ' as const\n')
console.log(`已索引 ${entries.length} 张真实高清 PNG`)
