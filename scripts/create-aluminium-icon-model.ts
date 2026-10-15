import { mkdir, writeFile } from 'node:fs/promises'
import { Window } from 'happy-dom'

const base = process.env.BASE || 'http://127.0.0.1:18637/'
const environment = new Window({ url: base })
Object.defineProperty(globalThis, 'localStorage', { value: environment.localStorage, configurable: true })
const actualFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => actualFetch(new URL(String(input), base), init)) as typeof fetch
const { loadCatalog, BuildModel } = await import('../src/engine-api')
await loadCatalog()
const model = new BuildModel()
for (const [index, length] of [35, 75].entries()) {
  const a = model.addNode(0, 40, index * 40)
  const b = model.addNode(length + 5, 40, index * 40)
  if (!model.addTube(a.id, b.id, `TA${length}`, 'grey', length)) throw new Error(`真实铝管安装失败：TA${length}`)
}
await mkdir('.work/frontend-evidence', { recursive: true })
await writeFile('.work/frontend-evidence/aluminium-icon-model.json', JSON.stringify(model.toJSON(), null, 2) + '\n')
process.stdout.write('真实API生成TA35和TA75铝管缩略图模型。\n')
