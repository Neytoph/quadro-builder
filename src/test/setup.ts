// 单元测试的运行环境：IndexedDB 用 fake-indexeddb（照规范实现的内存数据库），
// 零件目录从仓库里的 public/data/parts.json 读。
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const publicDir = join(process.cwd(), 'public')
const realFetch = globalThis.fetch

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url.endsWith('data/parts.json')) {
    const text = readFileSync(join(publicDir, 'data/parts.json'), 'utf8')
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch
