import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 只为已真实生成的高清 PNG 建索引，缺图继续使用原有资源。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entries = (await fs.readdir(path.join(root, 'public/parts/large'))).filter(name => name.endsWith('.png')).map(name => path.basename(name, '.png')).sort()
for (const id of entries) await fs.access(path.join(root, 'public/parts', `${id}.png`))
const source = '// 由 scripts/index-part-images.mjs 根据实际高清 PNG 生成。\nexport const PART_IMAGES_LARGE: ReadonlySet<string> = new Set(' + JSON.stringify(entries, null, 2) + ')\n'
await fs.writeFile(path.join(root, 'src/ui/partImagesHiDpi.ts'), source)
console.log(`已索引 ${entries.length} 张真实高清 PNG`)
