import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { BuildModel } from '../engine/model.js'
import { setAccountScope } from '../engine/storage.js'
import { canImportLegacyComponents, importLegacyComponents, readComponentLibrary, saveComponent, saveComponentConfiguration } from './customComponents'
import * as local from './customComponentsLocal'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setAccountScope(null) })
const row = () => {
  const model = new BuildModel(), node = model.addNode(0, 0, 0)
  return { id: 'legacy-one', name: '旧接头', fragment: model.extractSelection(new Map([[node.id, 'node']]))!, updatedAt: 1 }
}
const empty = () => ({ data: { components: [] as ReturnType<typeof row>[], keys: null as string[] | null }, rev: 0, updatedAt: 0 })

it('按验证后的账号读取；配置成功回执前不更新；冲突不自动重复写入', async () => {
  vi.stubEnv('VITE_SYNC_BASE', '/quadro'); setAccountScope('801')
  const value = empty(), calls: RequestInit[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    calls.push(init)
    expect(new Headers(init.headers).get('X-Builder-User-ID')).toBe('801')
    if (init.method === 'PUT') return new Response('components_changed', { status: 409, headers: { 'X-Builder-User-ID': '801' } })
    return Response.json(value, { headers: { 'X-Builder-User-ID': '801' } })
  }))
  expect(await readComponentLibrary()).toEqual(value.data)
  await expect(saveComponentConfiguration(['tube:TC1'])).rejects.toThrow('components_changed')
  expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1)
})

it('账号切换后的旧页面写入和迟到响应都会被拒绝', async () => {
  vi.stubEnv('VITE_SYNC_BASE', '/quadro'); setAccountScope('802')
  let release: (response: Response) => void = () => {}
  const pending = new Promise<Response>(resolve => { release = resolve })
  const fetcher = vi.fn(async (_url, init: RequestInit) => init.method === 'PUT' ? pending : Response.json(empty(), { headers: { 'X-Builder-User-ID': '802' } }))
  vi.stubGlobal('fetch', fetcher)
  await readComponentLibrary()
  const write = saveComponentConfiguration(['tube:TC1'])
  setAccountScope('803')
  release(Response.json({ ...empty(), rev: 1 }, { headers: { 'X-Builder-User-ID': '802' } }))
  await expect(write).rejects.toThrow('component_account_changed')
  const count = fetcher.mock.calls.length
  await expect(saveComponent(row())).rejects.toThrow('component_account_changed')
  expect(fetcher.mock.calls).toHaveLength(count)
})

it('旧版主动清空的圆环也保留为可迁移的有效配置', async () => {
  vi.stubEnv('VITE_SYNC_BASE', ''); setAccountScope(null)
  await local.saveComponentConfiguration([])
  expect((await local.legacyLibrary('807'))?.keys).toEqual([])
})

it('旧本机配置需明确导入，只能归属一个账号，保留原始记录', async () => {
  vi.stubEnv('VITE_SYNC_BASE', ''); setAccountScope(null)
  await local.saveComponent(row()); await local.saveComponentConfiguration(['saved:legacy-one', 'tube:TC1'])
  vi.stubEnv('VITE_SYNC_BASE', '/quadro'); setAccountScope('804')
  let value = empty()
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    if (init.method === 'PUT') { const body = JSON.parse(String(init.body)); expect(body.baseRev).toBe(value.rev); value = { ...body, rev: value.rev + 1, updatedAt: 1 } }
    return Response.json(value, { headers: { 'X-Builder-User-ID': '804' } })
  }))
  expect((await readComponentLibrary()).components).toHaveLength(0)
  expect(await canImportLegacyComponents()).toBe(true)
  await importLegacyComponents()
  expect(value.data.components[0]).toEqual(row())
  expect(value.data.keys).toEqual(['saved:legacy-one', 'tube:TC1'])
  expect(await canImportLegacyComponents()).toBe(false)
  setAccountScope('805')
  expect(await canImportLegacyComponents()).toBe(false)
  vi.stubEnv('VITE_SYNC_BASE', '')
  expect((await local.listComponents()).some(c => c.id === 'legacy-one')).toBe(true)
})

it('云端写入断网失败会报错，不退回访客库或假报已保存', async () => {
  vi.stubEnv('VITE_SYNC_BASE', '/quadro'); setAccountScope('806')
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    if (init.method === 'PUT') throw new TypeError('offline')
    return Response.json(empty(), { headers: { 'X-Builder-User-ID': '806' } })
  }))
  await readComponentLibrary()
  await expect(saveComponentConfiguration(['tube:TC1'])).rejects.toThrow('offline')
  setAccountScope(null)
  expect(await local.readComponentConfiguration()).toBeNull()
})
