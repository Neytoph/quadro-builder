import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BuildModel, docs, storage } from '../engine-api'
import { loadCatalog } from '../engine/catalog.js'
import { createSync } from './index'
import type { DocRecord } from './types'

// 隔离HTTP/Worker故障契约夹具；几何统计使用真实梁模型，正式浏览器验收由QA另记。
let accountId: string
let serial = 0
const live: ReturnType<typeof createSync>[] = []
beforeEach(async () => { await loadCatalog(); accountId = `stats-publish-${++serial}`; storage.setAccountScope(accountId) })
afterEach(() => { for (const sync of live.splice(0)) sync.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); storage.setAccountScope(null); docs.setSyncMode(false) })
function beam() {
  const model = new BuildModel()
  const a = model.addNode(serial * 10, 0, 0), b = model.addNode(serial * 10 + 40, 0, 0)
  model.addTube(a.id, b.id, 'T35', 'blue', 35)
  return model.toJSON()
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'X-Builder-User-ID': accountId } })
}
function server(stats: (init: RequestInit) => Promise<Response>) {
  const requests: { url: string; body: any }[] = []
  let rev = 2
  const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: async (input, init) => {
    const url = String(input)
    if (url.endsWith('/identity')) return response({ userId: accountId })
    if (url.endsWith('/inventory')) return response({ data: {}, rev: 0 })
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      requests.push({ url, body })
      if (url.endsWith('/stats')) return stats(init)
      return response({ rev: rev++, saveId: body.saveId })
    }
    return response({ rev: rev - 1, items: [] })
  } })
  live.push(sync)
  return { sync, requests }
}
async function clean() {
  const saved = await docs.saveDoc({ docId: 'beam', name: '梁', data: beam() })
  await docs.markDocSynced(saved.id, 1, saved.updatedAt, undefined, saved.saveId, 0)
  return await docs.getDoc(saved.id) as DocRecord
}

it('普通保存先完成；重复发布加入同一实际统计PUT，204前均不允许继续', async () => {
  const held = deferred()
  const { sync, requests } = server(async () => { await held.promise; return response(null, 204) })
  const saved = await docs.saveDoc({ docId: 'beam', name: '梁', data: beam() })
  expect((await sync.syncSavedDoc(saved.id, saved.saveId)).status).toBe('synced')
  const snapshot = await docs.getDoc(saved.id) as DocRecord
  let completed = 0
  const first = sync.syncDocStats(snapshot).then(ok => { completed++; return ok })
  const second = sync.syncDocStats(snapshot).then(ok => { completed++; return ok })
  await vi.waitFor(() => expect(requests.filter(r => r.url.endsWith('/stats'))).toHaveLength(1))
  expect(completed).toBe(0)
  held.resolve()
  expect(await first).toBe(true)
  expect(await second).toBe(true)
  expect(await docs.pendingStats()).toHaveLength(0)
  expect(requests.find(r => r.url.endsWith('/stats'))!.body.stats.steps).toBeGreaterThan(0)
})

it('冷clean存档没有本地统计回执仍需PUT；后补封面引起新rev不能借用旧统计', async () => {
  const initial = await clean()
  const { sync, requests } = server(async () => response(null, 204))
  expect(await sync.syncDocStats(initial)).toBe(true)
  await docs.setDocCover(initial.id, 'cover', initial.updatedAt, initial.saveId)
  expect(await sync.syncDocStats(initial)).toBe(false)
  await sync.syncNow()
  const covered = await docs.getDoc(initial.id) as DocRecord
  expect(covered.rev).toBe(2)
  expect(await sync.syncDocStats(covered)).toBe(true)
  expect(requests.filter(r => r.url.endsWith('/stats')).map(r => r.body.rev)).toEqual([1, 2])
  expect(requests.filter(r => !r.url.endsWith('/stats'))).toHaveLength(1)
})

it('统计HTTP失败拒绝发布并持久保留；重建同步实例可以完成同版本重试', async () => {
  const snapshot = await clean()
  const first = server(async () => response(null, 500))
  expect(await first.sync.syncDocStats(snapshot)).toBe(false)
  expect((await docs.pendingStats())[0].error).toContain('500')
  expect((await docs.pendingStats())[0].stats.steps).toBeGreaterThan(0)
  first.sync.stop()
  const restarted = server(async () => response(null, 204))
  expect(await restarted.sync.syncDocStats(snapshot)).toBe(true)
  expect(await docs.pendingStats()).toHaveLength(0)
})

it('统计上传期间新保存、同rev不同内容都不能被晚204当成成功', async () => {
  const snapshot = await clean()
  const held = deferred()
  const { sync, requests } = server(async () => { await held.promise; return response(null, 204) })
  const pending = sync.syncDocStats(snapshot)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  await docs.saveDoc({ docId: snapshot.id, name: '新梁', data: { ...snapshot.data as object, title: 'changed' }, baseRev: 1, parentSaveId: snapshot.saveId })
  held.resolve()
  expect(await pending).toBe(false)
  expect(await sync.syncDocStats({ ...snapshot, data: { ...snapshot.data as object, title: 'different' } })).toBe(false)
})

it('账户切换立即拒绝，旧统计回执不能确认新账户或清旧账户待补', async () => {
  const snapshot = await clean()
  const held = deferred()
  const { sync, requests } = server(async () => { await held.promise; return response(null, 204) })
  const pending = sync.syncDocStats(snapshot)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  storage.setAccountScope(`${accountId}-other`)
  expect(await pending).toBe(false)
  expect(await docs.pendingStats()).toHaveLength(0)
  held.resolve()
  storage.setAccountScope(accountId)
  expect(await docs.pendingStats()).toHaveLength(1)
})

it('真实Worker启动故障拒绝发布且持久记录诊断，下一次可正常重试', async () => {
  const snapshot = await clean()
  vi.stubGlobal('Worker', class { constructor() { throw new Error('worker startup failed') } })
  const { sync, requests } = server(async () => response(null, 204))
  expect(await sync.syncDocStats(snapshot)).toBe(false)
  expect(requests).toHaveLength(0)
  expect((await docs.pendingStats())[0].error).toContain('worker startup failed')
  vi.unstubAllGlobals()
  expect(await sync.syncDocStats(snapshot)).toBe(true)
})

it('统计上传15秒超时拒绝，已算出的真实结果留在持久队列', async () => {
  const snapshot = await clean()
  const { sync, requests } = server(init => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))
  const pending = sync.syncDocStats(snapshot)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // 上传计时器先前由真实timer建立，换clock前重试一个已缓存结果的新任务。
  sync.stop()
  expect(await pending).toBe(false)
  const retry = server(init => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))
  const attempt = retry.sync.syncDocStats(snapshot)
  await vi.waitFor(() => expect(retry.requests).toHaveLength(1))
  await vi.advanceTimersByTimeAsync(15_001)
  expect(await attempt).toBe(false)
  expect((await docs.pendingStats())[0].stats.steps).toBeGreaterThan(0)
  expect((await docs.pendingStats())[0].error).toContain('timed out')
})

it('Worker队列等待也受发布总60秒限制，所有待补快照保持可恢复', async () => {
  vi.stubGlobal('Worker', class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  })
  const snapshots: DocRecord[] = []
  for (let index = 0; index < 5; index++) {
    const saved = await docs.saveDoc({ docId: `queued-${index}`, name: '梁', data: { ...beam(), title: `uncached-${index}` } })
    await docs.markDocSynced(saved.id, 1, saved.updatedAt, undefined, saved.saveId, 0)
    snapshots.push(await docs.getDoc(saved.id) as DocRecord)
  }
  const { sync, requests } = server(async () => response(null, 204))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const pending = snapshots.map(snapshot => sync.syncDocStats(snapshot))
  await vi.waitFor(async () => expect(await docs.pendingStats()).toHaveLength(5))
  await vi.advanceTimersByTimeAsync(60_001)
  expect(await Promise.all(pending)).toEqual([false, false, false, false, false])
  expect(requests).toHaveLength(0)
  expect(await docs.pendingStats()).toHaveLength(5)
})
