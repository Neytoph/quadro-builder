import { afterEach, describe, expect, it } from 'vitest'
import { docs, storage } from '../engine-api'
import { createSync } from './index'
import { createConfirmedComponentFixture } from '../engine/confirmedComponentExample.js'
import { loadCatalog } from '../engine/catalog.js'
import { openTabDoc } from '../collab/localDocs'
import { writeJSON } from '../collab/ymodel'

let serial = 0
const account = () => String(81000 + ++serial)
afterEach(() => { storage.setAccountScope(null); docs.setSyncMode(false) })

describe('账户存储与同步隔离（内存 IndexedDB、请求 sink，不代表真实登录验收）', () => {
  it('库存通知覆盖账号切换、本地保存和远端拉取', () => {
    const A = account(), B = account()
    storage.setAccountScope(A)
    const changes: unknown[] = []
    const stop = storage.onInventoryChange(() => changes.push(storage.loadInventory()))
    storage.saveInventory({ tubes: { T35: 10 } })
    storage.setAccountScope(B)
    storage.putRemoteInventory({ data: { connectors: { '4way': 8 } }, rev: 2, updatedAt: 3 })
    stop()
    storage.saveInventory({ panels: { panel_40x40: 1 } })
    expect(changes).toEqual([
      { tubes: { T35: 10 } },
      null,
      { connectors: { '4way': 8 } },
    ])
  })

  it('文档、会话、库存、Yjs 标签及旧库按账户隔离', async () => {
    await loadCatalog()
    const A = account(), B = account()
    const fixture = createConfirmedComponentFixture('rope').model.toJSON()
    storage.setAccountScope(A)
    await docs.saveDoc({ docId: 'A-private', name: 'A', data: fixture })
    await docs.putRemoteDoc({ id: 'A-clean', name: 'A clean', data: fixture, rev: 91, createdAt: 1, updatedAt: 2 })
    await docs.saveSession({ tabs: [{ tabId: 'same-tab', model: fixture }], activeTabId: 'same-tab' })
    storage.saveInventory({ tubes: { T35: 10 } })
    const localA = await openTabDoc('same-tab', fixture)
    writeJSON(localA.doc, fixture, 'test-seed')
    const dbA = localA.persistence!.name
    localA.history.destroy(); await localA.persistence!.destroy(); localA.doc.destroy()
    storage.setAccountScope(B)
    expect(await docs.listDocs()).toEqual([])
    expect(await docs.loadSession()).toBeNull()
    expect(storage.loadInventory()).toBeNull()
    expect(storage.inventoryMeta().rev).toBe(0)
    const localB = await openTabDoc('same-tab', null)
    expect(localB.persistence!.name).not.toBe(dbA)
    expect(localB.history.toJSON().nodes).toEqual([])
    localB.history.destroy(); await localB.persistence!.destroy(); localB.doc.destroy()
    expect(await docs.migrateOldDrafts()).toBe(0)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const sync = createSync({ baseUrl: '/quadro', accountId: B, intervalMs: 0, fetchImpl: async (input, init) => {
      const url = String(input); calls.push({ url, init })
      return new Response(JSON.stringify(url.endsWith('/identity') ? { userId: B } : url.includes('/models?') ? { items: [], rev: 0 } : { data: {}, rev: 0 }), { headers: { 'X-Builder-User-ID': B } })
    } })
    await sync.syncNow(); sync.stop()
    expect(calls.some(call => call.init?.method === 'PUT')).toBe(false)
    expect(calls.find(call => call.url.includes('/models?'))!.url).toBe('/quadro/models?since=0')
    expect(new Headers(calls[1].init!.headers).get('X-Builder-User-ID')).toBe(B)
    storage.setAccountScope(A)
    expect((await docs.listDocs()).map((doc: { id: string }) => doc.id)).toContain('A-private')
    expect((await docs.loadSession())!.activeTabId).toBe('same-tab')
    expect(storage.loadInventory()).toEqual({ tubes: { T35: 10 } })
  })

  it('身份已改变时不会推旧草稿；取消后旧拉取响应不会落入新库', async () => {
    const A = account(), B = account()
    storage.setAccountScope(A)
    await docs.saveDoc({ docId: 'private', name: 'private', data: { nodes: [], tubes: [] } })
    const calls: string[] = []
    let changed = false
    const mismatch = createSync({ baseUrl: '/quadro', accountId: A, onIdentityChange: () => { changed = true }, fetchImpl: async input => {
      calls.push(String(input)); return new Response(JSON.stringify({ userId: B }))
    } })
    await mismatch.syncNow()
    expect(changed).toBe(true); expect(calls).toEqual(['/quadro/identity'])
    await docs.dropDoc('private')
    let release!: (response: Response) => void
    let pulling!: () => void
    const pending = new Promise<void>(resolve => { pulling = resolve })
    const sync = createSync({ baseUrl: '/quadro', accountId: A, fetchImpl: async input => {
      if (String(input).endsWith('/identity')) return new Response(JSON.stringify({ userId: A }))
      pulling()
      return new Promise<Response>(resolve => { release = resolve })
    } })
    const round = sync.syncNow()
    await pending
    sync.stop(); storage.setAccountScope(B)
    release(new Response(JSON.stringify({ items: [{ id: 'old-response', name: 'old', data: { nodes: [] }, rev: 9 }], rev: 9 }), { headers: { 'X-Builder-User-ID': A } }))
    await round
    expect(await docs.getDoc('old-response')).toBeUndefined()
  })
})
