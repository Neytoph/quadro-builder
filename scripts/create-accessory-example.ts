import { mkdir, writeFile } from 'node:fs/promises'
import { loadCatalog } from '../src/engine/catalog.js'
import { createOriginalAccessoryExample } from '../src/engine/accessoryExample.js'

const base = process.env.BASE || 'http://127.0.0.1:18636/'
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  return realFetch(new URL(String(input), base), init)
}) as typeof fetch

await loadCatalog()
const model = createOriginalAccessoryExample()
await mkdir('public/examples', { recursive: true })
await writeFile('public/examples/original-accessories.json', JSON.stringify(model.toJSON(), null, 2) + '\n')
process.stdout.write(`已通过真实API安装 ${model.panels.size} 个板/布组件、${model.fittings.size} 个附属件。\n`)
