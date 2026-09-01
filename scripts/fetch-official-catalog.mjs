#!/usr/bin/env node
/** 从官网 sitemap 抽出 Model Database 全部设计，写成 src/data/officialModels.json。不下载 QDF。 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITEMAP = 'https://mdb.quadroworld.com/sitemap.xml'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function titleFromSlug(slug) {
  return decodeURIComponent(slug)
    .split('-')
    .filter(Boolean)
    .map(w => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

const xml = await (await fetch(SITEMAP)).text()
const blocks = xml.split('<url>').slice(1)
const seen = new Set()
const models = []
for (const b of blocks) {
  const loc = b.match(/<loc>([^<]+)<\/loc>/)?.[1] || ''
  const m = loc.match(/\/de\/designs\/([a-z]\d{4})\/([^<]+)/i)
  if (!m) continue
  const id = m[1].toUpperCase()
  if (seen.has(id)) continue
  seen.add(id)
  const en = b.match(/hreflang="en_US" href="([^"]+)"/)?.[1] || ''
  const slug = (en.match(/\/en\/designs\/[a-z]\d{4}\/([^"/]+)/i) || [])[1] || m[2]
  models.push({ id, name: titleFromSlug(slug) })
}
models.sort((a, b) => a.id.localeCompare(b.id, 'en'))
const out = join(root, 'src/data/officialModels.json')
writeFileSync(out, `${JSON.stringify(models)}\n`)
console.log(`wrote ${models.length} models -> ${out}`)
