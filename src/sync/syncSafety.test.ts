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
    const url = String(input)
    if (url.endsWith('/identity')) return response({ userId: accountId })
    if (url.endsWith('/inventory')) return response({ data: {}, rev: 0 })
    // 步骤数是造型上传之后的补写，不占模型 PUT 的次数和回执。
    if (url.endsWith('/stats')) return new Response(null, { status: 204, headers: { 'X-Builder-User-ID': accountId } })
    return handler(url, init)
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
    const second = await docs.saveDoc({ docId: 'A', name: 'A', data: model('second'), baseRev: 1, parentSaveId: first.saveId })
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

  it('独立旧页面同rev保存不属于当前PUT父链，ACK后仍409保全独立分支', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('page-A'), baseRev: 1, parentSaveId: 'common-parent' })
    const independent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('page-B'), baseRev: 1, parentSaveId: 'common-parent' })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    expect((await docs.getDoc('A'))!.rev).toBe(1)
    expect((await docs.getDoc('A'))!.parentSaveId).toBe('common-parent')
    const puts: number[] = []
    const cloud = remote('A', 2, 'page-A')
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((_url, init) => {
      if (init?.method === 'PUT') { puts.push(JSON.parse(init.body as string).baseRev); return response({ remote: cloud }, 409) }
      return response({ items: [cloud], rev: 2 })
    }) })
    const result = await sync.syncSavedDoc('A', independent.saveId)
    expect(result.status).toBe('conflict')
    expect(puts).toEqual([1])
    expect((await docs.getDoc('A'))!.data).toEqual(first.data)
    if (result.status === 'conflict') expect((await docs.getDoc(result.copyId))!.data).toEqual(independent.data)
    sync.stop()
  })

  it('同页多次保存保留明确祖先链，首ACK能推进最新后代且不清dirty', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    let previous = first
    for (let i = 0; i < 5; i++) previous = await docs.saveDoc({ docId: 'A', name: 'A', data: model(`next-${i}`), baseRev: 1, parentSaveId: previous.saveId })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    const current = await docs.getDoc('A')
    expect(current!.rev).toBe(2)
    expect(current!.saveId).toBe(previous.saveId)
    expect(current!.data).toEqual(previous.data)
    expect(current!.dirty).toBe(true)
    expect(current!.syncedSaveId).toBeUndefined()
  })

  it('未传实际parentSaveId时不把DB上一记录猜作父保存', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    const independent = await docs.saveDoc({ docId: 'A', name: 'A', data: model('independent'), baseRev: 1 })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    expect((await docs.getDoc('A'))!.saveId).toBe(independent.saveId)
    expect((await docs.getDoc('A'))!.rev).toBe(1)
    expect((await docs.getDoc('A'))!.parentSaveId).toBeUndefined()
  })

  it('祖先查找在不同工作基线停止，不借历史祖先ACK抬升新分支', async () => {
    const first = await docs.saveDoc({ docId: 'A', name: 'A', data: model('first'), baseRev: 1 })
    const boundary = await docs.saveDoc({ docId: 'A', name: 'A', data: model('boundary'), baseRev: 2, parentSaveId: first.saveId })
    const latest = await docs.saveDoc({ docId: 'A', name: 'A', data: model('latest'), baseRev: 1, parentSaveId: boundary.saveId })
    await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 1)
    expect((await docs.getDoc('A'))!.saveId).toBe(latest.saveId)
    expect((await docs.getDoc('A'))!.rev).toBe(1)
  })

  it('旧dirty借用最新rev的存档先GET并另存恢复copy，绝不PUT原id', async () => {
    const legacy = { ...remote('legacy', 2, 'old-canvas'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const calls: string[] = []
    const cloud = remote('legacy', 2, 'new-cloud')
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/models/legacy')) return response(cloud)
      if (init?.method === 'PUT') return response({ rev: 3, saveId: JSON.parse(init.body as string).saveId })
      return response({ items: [cloud], rev: 3 })
    }) })
    await sync.syncNow(); sync.stop()
    expect(calls).toContain('GET /quadro/models/legacy')
    expect(calls).not.toContain('PUT /quadro/models/legacy')
    expect((await docs.getDoc('legacy'))!.data).toEqual(cloud.data)
    const copyId = (await docs.getDoc('legacy'))!.legacyRecoveryId
    const copy = await docs.getDoc(copyId)
    expect(copy!.data).toEqual(legacy.data)
    expect(copy!.syncedSaveId).toBe(copy!.saveId)
    expect(calls.filter(call => call.startsWith('PUT '))).toHaveLength(1)
  })

  it('旧dirty核对失败仍保护原记录和幂等副本，不上传不可信原id', async () => {
    const legacy = { ...remote('A', 2, 'legacy'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const puts: string[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((url, init) => {
      if (init?.method === 'PUT') puts.push(url)
      return response({}, 500)
    }) })
    await sync.syncNow(); await sync.syncNow(); sync.stop()
    expect(puts).toEqual([])
    const current = await docs.getDoc('A')
    expect(current!.dirty).toBe(true)
    expect(current!.data).toEqual(legacy.data)
    expect(current!.saveId).toBeUndefined()
    expect((await docs.listDocs()).length).toBe(2)
    expect((await docs.getDoc(current!.legacyRecoveryId))!.data).toEqual(legacy.data)
    expect(await docs.readPullCheckpoint()).toBe(0)
  })

  it('旧dirty远端墓碑和404均保留恢复copy，单目标核对不推进checkpoint', async () => {
    for (const missing of [false, true]) {
      const docId = missing ? 'missing' : 'deleted'
      const legacy = { ...remote(docId, 2, 'legacy'), dirty: true }
      await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
      let release!: () => void
      let reached!: () => void
      const waiting = new Promise<void>(resolve => { reached = resolve })
      const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(async (url, init) => {
        if (url.endsWith(`/models/${docId}`)) return missing ? response({}, 404) : response({ ...remote(docId, 3), data: null, deletedAt: 3 })
        if (init?.method === 'PUT') return response({ rev: 4, saveId: JSON.parse(init.body as string).saveId })
        reached(); await new Promise<void>(resolve => { release = resolve })
        return response({ items: [], rev: 4 })
      }) })
      const running = sync.syncNow(); await waiting
      expect(await docs.readPullCheckpoint()).toBe(missing ? 4 : 0)
      const tomb = (await docs.allRecords()).find((doc: DocRecord) => doc.id === docId)
      expect(tomb.deletedAt).toBeGreaterThan(0)
      expect(tomb.dirty).toBe(false)
      expect((await docs.getDoc(tomb.legacyRecoveryId))!.data).toEqual(legacy.data)
      release(); await running; sync.stop()
    }
  })

  it('旧41fd无恢复数据的删除核对live后保留意图，不造空副本且其他模型正常上传', async () => {
    const legacy = { ...remote('deleted', 2), data: null, deletedAt: 10, dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const other = await docs.saveDoc({ docId: 'other', name: 'other', data: model('other') })
    const cloud = remote('deleted', 3, 'latest')
    const calls: string[] = []
    const events: SyncEvent[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, onEvent: event => events.push(event), fetchImpl: sink((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/models/deleted')) return response(cloud)
      if (init?.method === 'PUT') {
        const payload = JSON.parse(init.body as string)
        expect(payload.data).toEqual(other.data)
        return response({ rev: 4, saveId: payload.saveId })
      }
      return response({ items: [cloud], rev: 4 })
    }) })
    await sync.syncNow(); sync.stop()
    expect(calls).toContain('GET /quadro/models/deleted')
    expect(calls.filter(call => call.startsWith('PUT '))).toEqual(['PUT /quadro/models/other'])
    expect(calls.some(call => call.startsWith('DELETE '))).toBe(false)
    expect(await docs.listDocs()).toHaveLength(2)
    const restored = await docs.getDoc('deleted')
    expect(restored!.data).toEqual(cloud.data)
    expect(restored!.legacyDeletionAt).toBe(10)
    expect(restored!.legacyRecoveryId).toBeUndefined()
    expect(events).toContainEqual({ type: 'legacy-deletion', id: 'deleted' })
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect((await docs.getDoc('other'))!.syncedSaveId).toBe(other.saveId)
    await docs.putRemoteDoc(remote('deleted', 5, 'next'))
    expect((await docs.getDoc('deleted'))!.legacyDeletionAt).toBe(10)
  })

  it('旧无数据删除GET失败仍保留墓碑，随后墓碑或404核对均不生成模型副本', async () => {
    for (const missing of [false, true]) {
      const docId = missing ? 'old-missing' : 'old-deleted'
      const legacy = { ...remote(docId, 2), data: null, deletedAt: 10, dirty: true }
      await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
      let failed = true
      const calls: string[] = []
      const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((url, init) => {
        calls.push(`${init?.method || 'GET'} ${url}`)
        if (url.endsWith(`/models/${docId}`)) {
          if (failed) return response({}, 500)
          return missing ? response({}, 404) : response({ ...remote(docId, 3), data: null, deletedAt: 3 })
        }
        return response({ items: [], rev: 3 })
      }) })
      await sync.syncNow()
      const pending = (await docs.allRecords()).find((doc: DocRecord) => doc.id === docId)
      expect(pending).toMatchObject({ deletedAt: 10, data: null, dirty: true })
      expect(pending.legacyRecoveryId).toBeUndefined()
      expect(await docs.listDocs()).toHaveLength(0)
      failed = false
      await sync.syncNow(); sync.stop()
      const accepted = (await docs.allRecords()).find((doc: DocRecord) => doc.id === docId)
      expect(accepted.dirty).toBe(false)
      expect(accepted.deletedAt).toBeGreaterThan(0)
      expect(accepted.legacyDeletionAt).toBe(10)
      expect(calls.some(call => call.startsWith('PUT ') || call.startsWith('DELETE '))).toBe(false)
      expect(await docs.listDocs()).toHaveLength(0)
    }
  })

  it.each(['old-canvas', 'edited-canvas'])('旧GET失败后手动保存%s只更新恢复副本，重建sync实例仍不覆盖云原模型', async version => {
    const legacy = { ...remote('A', 2, 'old-canvas'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const cloud = remote('A', 2, 'cloud-v2')
    let offline = true
    const calls: string[] = []
    let sent: Record<string, unknown> | undefined
    const fetchImpl = sink((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/models/A')) return offline ? response({}, 500) : response(cloud)
      if (init?.method === 'PUT') {
        sent = JSON.parse(init.body as string)
        return response({ rev: 3, saveId: sent!.saveId })
      }
      return response({ items: [cloud], rev: 3 })
    })
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl })
    await sync.syncNow(); sync.stop()
    const protectedRecord = await docs.getDoc('A')
    expect(protectedRecord!.legacyPending).toBe(true)
    const saved = await docs.saveDoc({ docId: 'A', name: 'manual', data: model(version), baseRev: 2,
      baseContent: JSON.stringify(legacy.data) })
    expect(saved.id).toBe(protectedRecord!.legacyRecoveryId)
    expect(saved.rev).toBe(0)
    expect(saved.legacyPending).toBeUndefined()
    expect((await docs.getDoc('A'))!.data).toEqual(legacy.data)
    storage.setAccountScope(null); storage.setAccountScope(accountId)
    expect((await docs.getDoc(saved.id))!.data).toEqual(model(version))
    offline = false
    const restarted = createSync({ baseUrl: '/quadro', accountId, fetchImpl })
    const receipt = await restarted.syncSavedDoc(saved.id, saved.saveId)
    restarted.stop()
    expect(receipt).toMatchObject({ status: 'synced', id: saved.id, saveId: saved.saveId })
    expect(calls.some(call => call === 'PUT /quadro/models/A' || call.startsWith('DELETE '))).toBe(false)
    expect(sent!.data).toEqual(model(version))
    expect((await docs.getDoc('A'))!.data).toEqual(cloud.data)
    expect((await docs.getDoc('A'))!.legacyPending).toBeUndefined()
    expect((await docs.getDoc(saved.id))!.syncedSaveId).toBe(saved.saveId)
    expect(await docs.listDocs()).toHaveLength(2)
  })

  it('protect尚未启动的直接保存也原子分叉，连续旧调用复用copy且账户隔离', async () => {
    const legacy = { ...remote('A', 2, 'old'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const first = await docs.saveDoc({ docId: 'A', name: 'manual', data: model('one'), baseRev: 2 })
    const second = await docs.saveDoc({ docId: 'A', name: 'manual', data: model('two'), parentSaveId: first.saveId })
    expect(first.id).not.toBe('A')
    expect(second.id).toBe(first.id)
    expect(second.rev).toBe(0)
    expect((await docs.getDoc('A'))).toMatchObject({ data: legacy.data, legacyPending: true, legacyRecoveryId: first.id })
    expect(await docs.listDocs()).toHaveLength(2)
    storage.setAccountScope(`${accountId}-other`)
    const other = await docs.saveDoc({ docId: 'A', name: 'other', data: model('other') })
    expect(other.id).toBe('A')
    storage.setAccountScope(accountId)
    expect((await docs.getDoc(first.id))!.data).toEqual(model('two'))
  })

  it('GET同rev接受新云模型后旧标签保存仍分叉，真实读新内容的标签正常保存原id', async () => {
    const legacy = { ...remote('A', 2, 'old'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    await docs.protectLegacyDoc(legacy)
    const cloud = remote('A', 2, 'cloud')
    await docs.resolveDocConflict(legacy, cloud, true)
    const content = (data: unknown) => JSON.stringify(data, (_key, value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    })
    const stale = await docs.saveDoc({ docId: 'A', name: 'stale', data: model('edited-old'), baseRev: 2, baseContent: content(legacy.data) })
    expect(stale.id).not.toBe('A')
    expect((await docs.getDoc('A'))!.data).toEqual(cloud.data)
    expect((await docs.getDoc('A'))!.dirty).toBe(false)
    const missingProof = await docs.saveDoc({ docId: 'A', name: 'old caller', data: model('unknown'), baseRev: 2 })
    expect(missingProof.id).not.toBe('A')
    expect((await docs.getDoc(stale.id))!.data).toEqual(model('edited-old'))
    const fresh = await docs.saveDoc({ docId: 'A', name: 'fresh', data: model('edited-cloud'), baseRev: 2, baseContent: content(cloud.data) })
    expect(fresh.id).toBe('A')
    const child = await docs.saveDoc({ docId: 'A', name: 'fresh', data: model('next-cloud'), baseRev: 2, parentSaveId: fresh.saveId })
    expect(child.id).toBe('A')
    expect(child.parentSaveId).toBe(fresh.saveId)
  })

  it('未知legacy改名封面再删除仍待真实GET，不因新删除saveId逃逸为DELETE', async () => {
    const legacy = { ...remote('A', 2, 'old'), dirty: true }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    await docs.renameDoc('A', 'renamed')
    await docs.setDocCover('A', 'cover')
    docs.setSyncMode(true)
    await docs.removeDoc('A')
    const pending = (await docs.allRecords()).find((doc: DocRecord) => doc.id === 'A')
    expect(pending.legacyPending).toBe(true)
    expect(pending.saveId).toBeUndefined()
    expect(pending.recoveryData).toEqual(legacy.data)
    let offline = true
    const calls: string[] = []
    const cloud = remote('A', 2, 'cloud')
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink((url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/models/A')) return offline ? response({}, 500) : response(cloud)
      if (init?.method === 'PUT') return response({ rev: 3, saveId: JSON.parse(init.body as string).saveId })
      return response({ items: [cloud], rev: 3 })
    }) })
    await sync.syncNow()
    offline = false
    await sync.syncNow(); sync.stop()
    expect(calls.some(call => call === 'PUT /quadro/models/A' || call.startsWith('DELETE '))).toBe(false)
    expect((await docs.getDoc('A'))!.data).toEqual(cloud.data)
    const copy = await docs.getDoc((await docs.getDoc('A'))!.legacyRecoveryId)
    expect(copy!.data).toEqual(legacy.data)
    expect(copy!.name).toContain('renamed')
    expect(copy!.legacyPending).toBeUndefined()
  })

  it('未证明父链的旧标签保存不覆写已编辑恢复副本，封面只继承同内容快照', async () => {
    const legacy = { ...remote('A', 2, 'old'), dirty: true, cover: 'old-cover' }
    await storage.dbTx(storage.DB_STORES.docs, 'readwrite', (store: IDBObjectStore) => store.put(legacy))
    const protection = await docs.protectLegacyDoc(legacy)
    const copyId = protection.copyId
    const edited = await docs.saveDoc({ docId: copyId, name: 'edited', data: model('edited') })
    expect(edited.cover).toBeUndefined()
    await docs.setDocCover(copyId, 'edited-cover', undefined, edited.saveId)
    const oldTab = await docs.saveDoc({ docId: 'A', name: 'old tab', data: legacy.data, baseRev: 2 })
    expect(oldTab.id).not.toBe(copyId)
    expect((await docs.getDoc(copyId))!.data).toEqual(model('edited'))
    expect((await docs.getDoc(copyId))!.cover).toBe('edited-cover')
    expect(oldTab.data).toEqual(legacy.data)
    expect(oldTab.cover).toBeUndefined()
    expect((await docs.getDoc('A'))!.legacyRecoveryId).toBe(oldTab.id)
    await docs.setDocCover(oldTab.id, 'same-cover', undefined, oldTab.saveId)
    const same = await docs.saveDoc({ docId: 'A', name: 'same', data: legacy.data, baseRev: 2 })
    expect(same.id).toBe(oldTab.id)
    expect(same.cover).toBe('same-cover')
    const changed = await docs.saveDoc({ docId: 'A', name: 'changed', data: model('changed'), baseRev: 2, parentSaveId: same.saveId })
    expect(changed.id).toBe(oldTab.id)
    expect(changed.cover).toBeUndefined()
    expect(changed.parentSaveId).toBe(same.saveId)
  })

  it('无saveId的正常clean云端记录不迁移，新rename/cover分配已知内容标识', async () => {
    const cloud = remote('clean', 2)
    await docs.putRemoteDoc(cloud)
    const requests: string[] = []
    const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: sink(url => {
      requests.push(url)
      return response({ items: [cloud], rev: 2 })
    }) })
    await sync.syncNow(); sync.stop()
    expect(requests).toEqual(['/quadro/models?since=0'])
    expect((await docs.listDocs()).length).toBe(1)
    expect((await docs.getDoc('clean'))!.legacyRecoveryId).toBeUndefined()
    await docs.renameDoc('clean', 'new-name')
    const renamed = await docs.getDoc('clean')
    expect(typeof renamed!.saveId).toBe('string')
    await docs.setDocCover('clean', 'new-cover')
    expect((await docs.getDoc('clean'))!.saveId).toBe(renamed!.saveId)
    await docs.putRemoteDoc(remote('cover-only', 3))
    await docs.setDocCover('cover-only', 'cover')
    expect(typeof (await docs.getDoc('cover-only'))!.saveId).toBe('string')
  })
})
