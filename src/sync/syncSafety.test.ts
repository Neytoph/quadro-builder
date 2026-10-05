import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docs, storage } from '../engine-api'
import { createSync } from './index'
import { loadCatalog } from '../engine/catalog.js'
import type { DocRecord, RemoteDoc, SyncEvent } from './types'

let serial = 0
let accountId: string
beforeEach(async () => { await loadCatalog(); accountId = `sync-safety-${++serial}`; storage.setAccountScope(accountId) })
afterEach(() => { storage.setAccountScope(null); docs.setSyncMode(false) })
const model = (version: string) => ({ nodes: [], tubes: [], meta: { version } })
const remote = (id: string, rev: number, version = 'remote'): RemoteDoc => ({ id, rev, name: id, data: model(version), createdAt: 1, updatedAt: rev })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'X-Builder-User-ID': accountId } })
function sink(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    if (String(input).endsWith('/identity')) return response({ userId: accountId })
    if (String(input).endsWith('/inventory')) return response({ data: {}, rev: 0 })
    return handler(String(input), init)
  }
}

describe('存档及同步竞争保护（内存 IndexedDB、隔离请求夹具，不代表真实服务验收）', () => {
  it('显式工作基线保持原值，旧调用兼容且每次保存独立saveId', async () => {
    await docs.putRemoteDoc(remote('A', 8))
    const stale = await docs.saveDoc({ docId: 'A', name: 'A', data: model('old'), baseRev: 2 })
    expect(stale.rev).toBe(2)
    expect(stale.pendingRemote?.rev).toBe(8)
    const next = await docs.saveDoc({ docId: 'A', name: 'A', data: model('new') })
    expect(next.rev).toBe(2)
    expect(next.saveId).not.toBe(stale.saveId)
    await docs.renameDoc('A', 'renamed')
    await docs.setDocCover('A', 'cover', undefined, next.saveId)
    expect((await docs.getDoc('A'))!.saveId).toBe(next.saveId)
  })

  it('拉取事务保护刚保存的dirty，并持久化远端墓碑及checkpoint', async () => {
    await docs.putRemoteDoc(remote('A', 1))
    const saved = await docs.saveDoc({ docId: 'A', name: 'local', data: model('local'), baseRev: 1 })
    await docs.applyRemoteBatch([{ ...remote('A', 4), data: null, deletedAt: 4 }, remote('B', 3)], 4)
    const current = await docs.getDoc('A')
    expect(current!.data).toEqual(saved.data)
    expect(current!.pendingRemote?.deletedAt).toBe(4)
    expect(await docs.readPullCheckpoint()).toBe(4)
    expect((await docs.getDoc('B'))!.rev).toBe(3)
  })

  it('旧保存回执不能覆写当前新保存或提升显式基线', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('sent'), baseRev: 1 })
    const newer = await docs.saveDoc({ docId: 'A', name: 'A', data: model('newer'), baseRev: 1 })
    await docs.markDocSynced('A', 2, sent.updatedAt, undefined, sent.saveId)
    const current = await docs.getDoc('A')
    expect(current!.saveId).toBe(newer.saveId)
    expect(current!.data).toEqual(newer.data)
    expect(current!.rev).toBe(1)
    expect(current!.dirty).toBe(true)
    expect(current!.syncedSaveId).toBeUndefined()
  })

  it('模型回执与稍后生成的封面分开，旧封面不能清掉新封面', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('sent') })
    await docs.setDocCover('A', 'new-cover', undefined, sent.saveId)
    await docs.markDocSynced('A', 2, sent.updatedAt, 'old-cover', sent.saveId)
    const current = await docs.getDoc('A')
    expect(current!.syncedSaveId).toBe(sent.saveId)
    expect(current!.cover).toBe('new-cover')
    expect(current!.dirty).toBe(true)
  })

  it('409等待中再次保存时，发送版本及最新版本都能恢复，并返回各自副本', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('sent'), baseRev: 1 })
    const newer = await docs.saveDoc({ docId: 'A', name: 'A', data: model('newer'), baseRev: 1 })
    await docs.applyRemoteBatch([remote('A', 5, 'latest-remote')], 5)
    const result = await docs.resolveDocConflict(sent, remote('A', 3))
    expect((await docs.getDoc(result.copies[sent.saveId]))!.data).toEqual(sent.data)
    expect((await docs.getDoc(result.copies[newer.saveId]))!.data).toEqual(newer.data)
    expect((await docs.getDoc('A'))!.rev).toBe(5)
    expect((await docs.getDoc('A'))!.syncedSaveId).toBeUndefined()
  })

  it('推送另一个高rev模型后，历史缺checkpoint仍从0全量修复遗漏', async () => {
    await docs.putRemoteDoc(remote('A', 1, 'old'))
    await docs.saveDoc({ docId: 'B', name: 'B', data: model('local') })
    const pulls: string[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((url, init) => {
      if (init?.method === 'PUT') return response({ rev: 5, saveId: JSON.parse(init.body as string).saveId })
      pulls.push(url)
      return response({ rev: 5, items: [remote('A', 4, 'new'), remote('B', 5, 'local')] })
    }) })
    await sync.syncNow(); sync.stop()
    expect(pulls).toEqual(['/quadro/models?since=0'])
    expect((await docs.getDoc('A'))!.data).toEqual(model('new'))
    expect(await docs.readPullCheckpoint()).toBe(5)
  })

  it('运行中的一轮之后，目标保存会补跑并确认准确saveId', async () => {
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { reached = resolve })
    let first = true
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(async (url, init) => {
      if (init?.method === 'PUT') return response({ rev: 2, saveId: JSON.parse(init.body as string).saveId })
      if (first && url.includes('/models?')) { first = false; reached(); await new Promise<void>(resolve => { release = resolve }) }
      return response({ rev: 0, items: [] })
    }) })
    const running = sync.syncNow(); await waiting
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('new') })
    const completion = sync.syncSavedDoc('A', saved.saveId)
    release(); await running
    expect(await completion).toEqual({ status: 'synced', id: 'A', saveId: saved.saveId, rev: 2 })
    sync.stop()
  })

  it('409不会把原设计远端clean状态冒充目标上传成功', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('local'), baseRev: 1 })
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((_url, init) => init?.method === 'PUT'
      ? response({ remote: remote('A', 2) }, 409) : response({ items: [remote('A', 2)], rev: 2 })) })
    const result = await sync.syncSavedDoc('A', saved.saveId)
    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') expect((await docs.getDoc(result.copyId))!.data).toEqual(saved.data)
    expect((await docs.getDoc('A'))!.dirty).toBe(false)
    sync.stop()
  })

  it('响应丢失重试的同内容409可确认，JSON对象键顺序不影响结果', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('same'), baseRev: 1 })
    const same = { ...remote('A', 2), data: { meta: { version: 'same' }, tubes: [], nodes: [] } }
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((_url, init) => init?.method === 'PUT'
      ? response({ remote: same }, 409) : response({ items: [same], rev: 2 })) })
    expect((await sync.syncSavedDoc('A', saved.saveId)).status).toBe('synced')
    expect((await docs.listDocs()).length).toBe(1)
    sync.stop()
  })

  it('网络失败保持待同步状态，不发idle或成功回执', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('local') })
    const events: SyncEvent[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, onEvent: event => events.push(event), fetchImpl: sink(() => { throw new Error('offline') }) })
    const result = await sync.syncSavedDoc('A', saved.saveId)
    expect(result.status).toBe('pending')
    expect((await docs.getDoc('A'))!.dirty).toBe(true)
    expect(events.some(event => event.type === 'error')).toBe(true)
    expect(events.some(event => event.type === 'idle' || event.type === 'pushed')).toBe(false)
    sync.stop()
  })

  it('封面后处理失败仍准确确认JSON，保留待补封面和错误事件', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('local') })
    await docs.setDocCover('A', 'cover', undefined, saved.saveId)
    const events: SyncEvent[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, onEvent: event => events.push(event), fetchImpl: sink((_url, init) => init?.method === 'PUT'
      ? response({ rev: 2, saveId: saved.saveId, coverApplied: false, coverError: 'cover unavailable' }) : response({ items: [], rev: 2 })) })
    expect((await sync.syncSavedDoc('A', saved.saveId)).status).toBe('synced')
    const current = await docs.getDoc('A') as DocRecord
    expect(current.cover).toBe('cover')
    expect(current.dirty).toBe(true)
    expect(events.some(event => event.type === 'error')).toBe(true)
    sync.stop()
  })

  it('pull响应等待期间保存仍受原子保护', async () => {
    await docs.putRemoteDoc(remote('A', 1, 'old'))
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { reached = resolve })
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(async () => {
      reached(); await new Promise<void>(resolve => { release = resolve })
      return response({ items: [remote('A', 2)], rev: 2 })
    }) })
    const round = sync.syncNow(); await waiting
    const saved = await docs.saveDoc({ docId: 'A', name: 'local', data: model('local'), baseRev: 1 })
    release(); await round; sync.stop()
    const current = await docs.getDoc('A')
    expect(current!.saveId).toBe(saved.saveId)
    expect(current!.data).toEqual(saved.data)
    expect(current!.pendingRemote?.rev).toBe(2)
    expect(await docs.readPullCheckpoint()).toBe(2)
  })

  it('PUT等待期间再保存，409保全最新工作并返回目标保存的副本', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('sent'), baseRev: 1 })
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { reached = resolve })
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(async (_url, init) => {
      if (init?.method === 'PUT') {
        reached(); await new Promise<void>(resolve => { release = resolve })
        return response({ remote: remote('A', 2) }, 409)
      }
      return response({ items: [remote('A', 2)], rev: 2 })
    }) })
    const completion = sync.syncSavedDoc('A', sent.saveId); await waiting
    const latest = await docs.saveDoc({ docId: 'A', name: 'A', data: model('latest'), baseRev: 1 })
    release()
    const result = await completion
    const laterResult = await sync.syncSavedDoc('A', latest.saveId)
    expect(result.status).toBe('conflict')
    expect(laterResult.status).toBe('conflict')
    if (result.status === 'conflict') expect((await docs.getDoc(result.copyId))!.data).toEqual(sent.data)
    if (laterResult.status === 'conflict') expect((await docs.getDoc(laterResult.copyId))!.data).toEqual(latest.data)
    sync.stop()
  })

  it('同一本地分支连续保存沿真实ACK推进基线，最后内容正常上传原docId', async () => {
    await docs.putRemoteDoc(remote('A', 1))
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>(resolve => { reached = resolve })
    let serverRev = 1
    let serverData: unknown = remote('A', 1).data
    const writes: Array<{ baseRev: number; saveId: string }> = []
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(async (_url, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string)
        writes.push(body)
        if (writes.length === 1) { reached(); await new Promise<void>(resolve => { release = resolve }) }
        if (body.baseRev !== serverRev) return response({ remote: { ...remote('A', serverRev), data: serverData } }, 409)
        serverData = body.data
        return response({ rev: ++serverRev, saveId: body.saveId })
      }
      return response({ items: [{ ...remote('A', serverRev), data: serverData }], rev: serverRev })
    }) })
    const firstCompletion = sync.syncSavedDoc('A', first.saveId); await waiting
    const second = await docs.saveDoc({ docId: 'A', name: 'A', data: model('second'), baseRev: 1 })
    release()
    expect((await firstCompletion).status).toBe('synced')
    expect((await sync.syncSavedDoc('A', second.saveId)).status).toBe('synced')
    const current = await docs.getDoc('A')
    expect(current!.data).toEqual(second.data)
    expect(current!.rev).toBe(3)
    expect(current!.syncedSaveId).toBe(second.saveId)
    expect(current!.dirty).toBe(false)
    expect(writes.map(write => write.baseRev)).toEqual([1, 2])
    expect((await docs.listDocs()).length).toBe(1)
    sync.stop()
  })

  it('配额失败仍全量拉取且保留dirty、pendingRemote和可见失败', async () => {
    await docs.saveDoc({ docId: 'A', name: 'A', data: model('local'), baseRev: 1 })
    const events: SyncEvent[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, onEvent: event => events.push(event), fetchImpl: sink((_url, init) => init?.method === 'PUT'
      ? response({ feature: 'designs', used: 3, limit: 3 }, 402) : response({ items: [remote('A', 2)], rev: 2 })) })
    await sync.syncNow(); sync.stop()
    expect(await docs.readPullCheckpoint()).toBe(2)
    expect((await docs.getDoc('A'))!.pendingRemote?.rev).toBe(2)
    expect((await docs.getDoc('A'))!.dirty).toBe(true)
    expect(events.some(event => event.type === 'quota')).toBe(true)
    expect(events.some(event => event.type === 'idle')).toBe(false)
  })

  it('删除中的旧PUT回执不能复活内容或清除墓碑', async () => {
    await docs.putRemoteDoc(remote('A', 1))
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('local'), baseRev: 1 })
    docs.setSyncMode(true)
    await docs.removeDoc('A')
    await docs.markDocSynced('A', 2, sent.updatedAt, undefined, sent.saveId)
    const tomb = (await docs.allRecords()).find((record: DocRecord) => record.id === 'A')
    expect(tomb.deletedAt).toBeGreaterThan(0)
    expect(tomb.dirty).toBe(true)
    expect(tomb.data).toBeNull()
    expect(tomb.rev).toBe(1)
  })

  it('checkpoint账户隔离，旧账户拉取进度不进入新账户', async () => {
    await docs.applyRemoteBatch([remote('A', 20)], 20)
    storage.setAccountScope('separate-checkpoint-account')
    expect(await docs.readPullCheckpoint()).toBe(0)
    expect(await docs.listDocs()).toEqual([])
    storage.setAccountScope(accountId)
    expect(await docs.readPullCheckpoint()).toBe(20)
  })

  it('批次存储失败时checkpoint和其他文档一起回滚', async () => {
    await expect(docs.applyRemoteBatch([remote('good', 1), { ...remote('bad', 2), data: () => {} }], 2)).rejects.toBeDefined()
    expect(await docs.readPullCheckpoint()).toBe(0)
    expect(await docs.getDoc('good')).toBeUndefined()
  })

  it('已持久化远端分歧时，旧ACK不会提升后续本地保存的基线', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('sent'), baseRev: 1 })
    const latest = await docs.saveDoc({ docId: 'A', name: 'A', data: model('latest'), baseRev: 1 })
    await docs.applyRemoteBatch([remote('A', 3)], 3)
    await docs.markDocSynced('A', 2, sent.updatedAt, undefined, sent.saveId, 1)
    const current = await docs.getDoc('A')
    expect(current!.saveId).toBe(latest.saveId)
    expect(current!.rev).toBe(1)
    expect(current!.pendingRemote?.rev).toBe(3)
    expect(current!.dirty).toBe(true)
  })

  it('父保存ACK先于下一保存事务时，以准确父saveId延续基线', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    const next = await docs.saveDoc({ docId: 'A', name: 'A', data: model('next'), baseRev: 1, parentSaveId: first.saveId })
    expect(next.rev).toBe(2)
    expect(next.pendingRemote).toBeUndefined()
    expect(next.saveId).not.toBe(first.saveId)
    expect(next.dirty).toBe(true)
    const unknown = await docs.saveDoc({ docId: 'A', name: 'A', data: model('unknown'), baseRev: 1, parentSaveId: 'different-parent' })
    expect(unknown.rev).toBe(1)
  })

  it('父保存存在远端分歧时，parentSaveId不能提升基线', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    await docs.setDocCover('A', 'late-cover', undefined, first.saveId)
    await docs.applyRemoteBatch([remote('A', 3)], 3)
    const next = await docs.saveDoc({ docId: 'A', name: 'A', data: model('next'), baseRev: 1, parentSaveId: first.saveId })
    expect(next.rev).toBe(1)
    expect(next.pendingRemote?.rev).toBe(3)
  })

  it('较新远端分歧跨过checkpoint后，旧ACK使clean项在下轮空批次自动接受最新', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('saved'), baseRev: 1 })
    await docs.applyRemoteBatch([remote('A', 3, 'latest-cloud')], 3)
    await docs.markDocSynced('A', 2, saved.updatedAt, undefined, saved.saveId, 1)
    expect((await docs.getDoc('A'))!.pendingRemote?.rev).toBe(3)
    await docs.applyRemoteBatch([], 3)
    const current = await docs.getDoc('A')
    expect(current!.rev).toBe(3)
    expect(current!.data).toEqual(model('latest-cloud'))
    expect(current!.pendingRemote).toBeUndefined()
  })

  it('下轮响应有更高版本时，clean pendingRemote不能覆盖新响应', async () => {
    const saved = await docs.saveDoc({ docId: 'A', name: 'A', data: model('saved'), baseRev: 1 })
    await docs.applyRemoteBatch([remote('A', 3, 'pending')], 3)
    await docs.markDocSynced('A', 2, saved.updatedAt, undefined, saved.saveId, 1)
    await docs.applyRemoteBatch([remote('A', 4, 'newest')], 4)
    expect((await docs.getDoc('A'))!.rev).toBe(4)
    expect((await docs.getDoc('A'))!.data).toEqual(model('newest'))
  })

  it('PUT等待中改名和封面也保全最新状态，后续远端更新保留副本定位', async () => {
    const sent = await docs.saveDoc({ docId: 'A', name: 'before', data: model('local'), baseRev: 1 })
    await docs.renameDoc('A', 'latest-name')
    await docs.setDocCover('A', 'latest-cover', undefined, sent.saveId)
    const result = await docs.resolveDocConflict(sent, remote('A', 2))
    const copy = await docs.getDoc(result.copyId)
    expect(copy!.name).toBe('latest-name（冲突副本）')
    expect(copy!.cover).toBe('latest-cover')
    expect(copy!.data).toEqual(sent.data)
    await docs.applyRemoteBatch([remote('A', 3)], 3)
    expect((await docs.getDoc('A'))!.conflictCopies[sent.saveId]).toBe(result.copyId)
  })
})
