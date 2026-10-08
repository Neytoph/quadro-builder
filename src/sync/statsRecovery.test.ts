import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BuildModel, docs, storage } from '../engine-api'
import { loadCatalog } from '../engine/catalog.js'
import { ENGINE_VERSION } from '../engine/publicResources.js'
import { createSync } from './index'
import type { PendingStats } from './types'

let accountId: string
let serial = 0
beforeEach(async () => { await loadCatalog(); accountId = `stats-recovery-${++serial}`; storage.setAccountScope(accountId) })
afterEach(() => { storage.setAccountScope(null); docs.setSyncMode(false) })
function beam() {
  const model = new BuildModel()
  const a = model.addNode(serial, 0, 0), b = model.addNode(serial + 40, 0, 0)
  model.addTube(a.id, b.id, 'T35', 'blue', 35)
  return model.toJSON()
}
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'X-Builder-User-ID': accountId } })
}

it('真实梁模型+隔离HTTP契约：模型clean后关闭，重建同步实例仅补统计，无重复模型PUT', async () => {
  const saved = await docs.saveDoc({ docId: 'beam', name: '梁', data: beam() })
  let hold = true
  const requests: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push(`${init?.method || 'GET'} ${url}`)
    if (url.endsWith('/identity')) return response({ userId: accountId })
    if (url.endsWith('/inventory')) return response({ data: {}, rev: 0 })
    if (url.endsWith('/stats')) {
      if (hold) await new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
      return response(null, 204)
    }
    if (init?.method === 'PUT') return response({ rev: 2, saveId: saved.saveId })
    return response({ rev: 2, items: [] })
  }
  const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl })
  expect((await sync.syncSavedDoc('beam', saved.saveId)).status).toBe('synced')
  expect((await docs.getDoc('beam'))!.dirty).toBe(false)
  expect(await docs.pendingStats()).toHaveLength(1)
  // 同一模型后补封面不影响统计版本。
  await docs.setDocCover('beam', 'cover', undefined, saved.saveId)
  await vi.waitFor(() => expect(requests.some(url => url.endsWith('/stats'))).toBe(true))
  sync.stop()
  storage.setAccountScope(null); storage.setAccountScope(accountId)
  hold = false
  const restarted = createSync({ baseUrl: '/quadro', accountId, fetchImpl })
  // 模拟封面自己已经补完：统计恢复独立于dirty模型和封面队列。
  await docs.markDocSynced('beam', 2, undefined, 'cover', saved.saveId)
  await restarted.syncNow()
  await vi.waitFor(async () => expect(await docs.pendingStats()).toHaveLength(0))
  restarted.stop()
  expect(requests.filter(url => url === 'PUT /quadro/models/beam')).toHaveLength(1)
  expect(requests.filter(url => url === 'PUT /quadro/models/beam/stats')).toHaveLength(2)
})

it('持久队列契约：晚旧统计回执不能清新save，账号切换互不读写', async () => {
  const data = beam()
  const first = await docs.saveDoc({ docId: 'A', name: 'A', data })
  const oldTask: PendingStats = { id: 'models-stats:A', docId: 'A', data, rev: 2, saveId: first.saveId, engineVersion: ENGINE_VERSION }
  await docs.markDocSynced('A', 2, first.updatedAt, undefined, first.saveId, 0, oldTask)
  const second = await docs.saveDoc({ docId: 'A', name: 'A', data: { ...data, title: 'new' }, baseRev: 2, parentSaveId: first.saveId })
  const newTask: PendingStats = { ...oldTask, rev: 3, data: second.data, saveId: second.saveId }
  await docs.markDocSynced('A', 3, second.updatedAt, undefined, second.saveId, 2, newTask)
  await docs.settleStats(oldTask)
  expect((await docs.pendingStats())[0].saveId).toBe(second.saveId)
  storage.setAccountScope(`${accountId}-other`)
  expect(await docs.pendingStats()).toHaveLength(0)
  storage.setAccountScope(accountId)
  expect((await docs.pendingStats())[0].rev).toBe(3)
})

it('真实梁模型+隔离HTTP契约：统计失败保留结果和诊断，联网重试不丢待补', async () => {
  const data = beam()
  const saved = await docs.saveDoc({ docId: 'A', name: 'A', data })
  let failing = true
  const sync = createSync({ baseUrl: '/quadro', accountId, fetchImpl: async (input, init) => {
    const url = String(input)
    if (url.endsWith('/identity')) return response({ userId: accountId })
    if (url.endsWith('/inventory')) return response({ data: {}, rev: 0 })
    if (url.endsWith('/stats')) return response(null, failing ? 500 : 204)
    if (init?.method === 'PUT') return response({ rev: 2, saveId: saved.saveId })
    return response({ rev: 2, items: [] })
  } })
  await sync.syncSavedDoc('A', saved.saveId)
  await vi.waitFor(async () => expect((await docs.pendingStats())[0].error).toContain('500'))
  expect((await docs.pendingStats())[0].stats.steps).toBeGreaterThan(0)
  expect((await docs.getDoc('A'))!.dirty).toBe(false)
  failing = false
  await sync.syncNow()
  await vi.waitFor(async () => expect(await docs.pendingStats()).toHaveLength(0))
  sync.stop()
})

it('同一保存补封面推进版本时静默取消旧统计，最新版本携带统计完成同步', async () => {
  const data = beam()
  const saved = await docs.saveDoc({ docId: 'cover', name: '封面梁', data })
  const events: Array<{ type: string; error?: unknown }> = []
  let rev = 1
  let statsCalls = 0
  let statsStarted = () => {}
  const firstStatsStarted = new Promise<void>(resolve => { statsStarted = resolve })
  const sync = createSync({ baseUrl: '/quadro', accountId, onEvent: event => events.push(event), fetchImpl: async (input, init) => {
    const url = String(input)
    if (url.endsWith('/identity')) return response({ userId: accountId })
    if (url.endsWith('/inventory')) return response({ data: {}, rev: 0 })
    if (url.endsWith('/stats')) {
      statsCalls++
      statsStarted()
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    }
    if (init?.method === 'PUT') return response({ rev: ++rev, saveId: saved.saveId })
    return response({ rev, items: [] })
  } })
  expect((await sync.syncSavedDoc(saved.id, saved.saveId)).status).toBe('synced')
  await firstStatsStarted

  await docs.setDocCover(saved.id, 'cover', undefined, saved.saveId)
  await sync.syncNow()
  await vi.waitFor(async () => expect(await docs.pendingStats()).toHaveLength(0))

  expect(statsCalls).toBe(1)
  expect(events.some(event => event.type === 'stats-pending' && event.error)).toBe(false)
  expect((await docs.getDoc(saved.id))!.rev).toBe(3)
  sync.stop()
})
