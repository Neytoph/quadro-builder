import { afterEach, describe, expect, it, vi } from 'vitest'
import * as docs from '../engine/docs.js'
import * as storage from '../engine/storage.js'
import { hasLocalDoc, pickRemote, pullDoc } from './docEntry'
import type { RemoteDoc } from './types'

const data = { tubes: [], nodes: [] }
const remote = (id: string, extra: Partial<RemoteDoc> = {}): RemoteDoc =>
  ({ id, name: `造型 ${id}`, data, createdAt: 1, updatedAt: 2, rev: 3, ...extra })
afterEach(() => { vi.unstubAllGlobals(); storage.setAccountScope(null) })

describe('?doc= 打开自己的一座', () => {
  it('服务端列表里挑出这一座', () => {
    const items = [remote('a'), remote('b')]
    expect(pickRemote(items, 'b')?.id).toBe('b')
  })

  it('服务端列表里没有（不是自己的）就是找不到', () => {
    expect(pickRemote([remote('a')], 'x')).toBeNull()
  })

  it('服务端已经删掉的算找不到', () => {
    expect(pickRemote([remote('a', { deletedAt: 5, data: null })], 'a')).toBeNull()
  })

  it('本机有这一座', async () => {
    const d = await docs.saveDoc({ docId: undefined, name: '本机的一座', data })
    expect(await hasLocalDoc(d.id)).toBe(true)
    expect(await hasLocalDoc('nope')).toBe(false)
  })

  it('本机删掉还没同步的墓碑不算有', async () => {
    docs.setSyncMode(true)
    await docs.putRemoteDoc(remote('tomb'))
    await docs.removeDoc('tomb')
    docs.setSyncMode(false)
    expect(await hasLocalDoc('tomb')).toBe(false)
  })

  it('本机已有也单独核对最新版本，不提升完整拉取检查点（隔离请求夹具）', async () => {
    storage.setAccountScope('doc-entry-test')
    await docs.putRemoteDoc(remote('existing'))
    const request = vi.fn(async () => new Response(JSON.stringify(remote('existing', { rev: 99, name: '最新' })), { headers: { 'X-Builder-User-ID': 'doc-entry-test' } }))
    vi.stubGlobal('fetch', request)
    expect(await pullDoc('/quadro', 'existing')).toBe(true)
    expect(request.mock.calls[0]).toBeDefined()
    expect((await docs.getDoc('existing'))!.name).toBe('最新')
    expect(await docs.readPullCheckpoint()).toBe(0)
  })

  it('单文档读取遇到本地dirty保留两份内容（隔离请求夹具）', async () => {
    storage.setAccountScope('doc-entry-dirty-test')
    const saved = await docs.saveDoc({ docId: 'dirty', name: '本机', data, baseRev: 1 })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(remote('dirty', { rev: 4 })), { headers: { 'X-Builder-User-ID': 'doc-entry-dirty-test' } }))
    await pullDoc('/quadro', 'dirty')
    const current = await docs.getDoc('dirty')
    expect(current!.saveId).toBe(saved.saveId)
    expect(current!.dirty).toBe(true)
    expect(current!.pendingRemote?.rev).toBe(4)
  })

  it('服务端那一座放进本机以后就能打开', async () => {
    const doc = pickRemote([remote('from-server')], 'from-server')!
    await docs.putRemoteDoc(doc)
    expect(await hasLocalDoc('from-server')).toBe(true)
    expect((await docs.getDoc('from-server') as { name: string }).name).toBe('造型 from-server')
  })
})
