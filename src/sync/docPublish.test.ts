import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { docs, storage } from '../engine-api'
import { pushDocToServer } from './docPublish'
import { syncDocStats, syncNow, syncSavedDoc } from './bootstrap'

vi.mock('./bootstrap', () => ({ syncDocStats: vi.fn(), syncNow: vi.fn(), syncSavedDoc: vi.fn() }))
let serial = 0
beforeEach(() => { storage.setAccountScope(`publish-handoff-${++serial}`); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); storage.setAccountScope(null) })
const data = { nodes: [{ id: 1, x: 0, y: 0, z: 0 }], tubes: [] }
function held() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>(done => { resolve = done })
  return { promise, resolve }
}

it('社区默认只等模型回执，不调用统计门禁', async () => {
  const saved = await docs.saveDoc({ docId: 'A', name: 'A', data })
  vi.mocked(syncSavedDoc).mockResolvedValue({ status: 'synced', id: 'A', saveId: saved.saveId, rev: 1 })
  expect(await pushDocToServer('A')).toBe(true)
  expect(syncSavedDoc).toHaveBeenCalledWith('A', saved.saveId)
  expect(syncDocStats).not.toHaveBeenCalled()
  expect(syncNow).not.toHaveBeenCalled()
})

it('冷远端存档封面产生新saveId，发布等待封面模型新rev及同版本统计', async () => {
  await docs.putRemoteDoc({ id: 'A', name: 'A', data, rev: 1, createdAt: 1, updatedAt: 1 })
  await docs.setDocCover('A', 'cover', 1)
  const covered = await docs.getDoc('A')
  const gate = held()
  vi.mocked(syncDocStats).mockReturnValue(gate.promise)
  vi.mocked(syncNow).mockImplementation(async () => { await docs.markDocSynced('A', 2, covered!.updatedAt, 'cover', covered!.saveId, 1) })
  let complete = false
  const publish = pushDocToServer('A', { requireStats: true, expectedData: data }).then(ok => { complete = true; return ok })
  await vi.waitFor(() => expect(syncDocStats).toHaveBeenCalledWith({ id: 'A', data, rev: 2, saveId: covered!.saveId }))
  expect(complete).toBe(false)
  gate.resolve(true)
  expect(await publish).toBe(true)
})

it('统计失败及封面期间内容变化均拒绝，不调用其他模型的统计', async () => {
  const saved = await docs.saveDoc({ docId: 'A', name: 'A', data })
  await docs.markDocSynced('A', 1, saved.updatedAt, undefined, saved.saveId, 0)
  vi.mocked(syncNow).mockResolvedValue()
  vi.mocked(syncDocStats).mockResolvedValue(false)
  expect(await pushDocToServer('A', { requireStats: true })).toBe(false)
  vi.clearAllMocks()
  expect(await pushDocToServer('A', { requireStats: true, expectedData: { ...data, title: 'another' } })).toBe(false)
  expect(syncDocStats).not.toHaveBeenCalled()
  expect(syncNow).not.toHaveBeenCalled()
})

it.each(['version', 'account', 'cover', 'name'])('统计成功之后%s改变，最终检查仍拒绝发布', async change => {
  const saved = await docs.saveDoc({ docId: 'A', name: 'A', data })
  await docs.markDocSynced('A', 1, saved.updatedAt, undefined, saved.saveId, 0)
  vi.mocked(syncNow).mockResolvedValue()
  const gate = held()
  vi.mocked(syncDocStats).mockReturnValue(gate.promise)
  const publish = pushDocToServer('A', { requireStats: true })
  await vi.waitFor(() => expect(syncDocStats).toHaveBeenCalled())
  if (change === 'version') await docs.saveDoc({ docId: 'A', name: 'A', data: { ...data, title: 'new' }, baseRev: 1, parentSaveId: saved.saveId })
  else if (change === 'cover') await docs.setDocCover('A', 'new-cover', undefined, saved.saveId)
  else if (change === 'name') await docs.renameDoc('A', 'new name')
  else storage.setAccountScope('other')
  gate.resolve(true)
  expect(await publish).toBe(false)
})

it('模型同步hang也受到发布总75秒限制，旧异步任务晚结束不能放行', async () => {
  const saved = await docs.saveDoc({ docId: 'A', name: 'A', data })
  const gate = held()
  vi.mocked(syncNow).mockImplementation(async () => { await gate.promise })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const publish = pushDocToServer('A', { requireStats: true })
  await vi.waitFor(() => expect(syncNow).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(75_000)
  expect(await publish).toBe(false)
  gate.resolve(true)
  expect((await docs.getDoc('A'))!.saveId).toBe(saved.saveId)
  expect((await docs.getDoc('A'))!.dirty).toBe(true)
  expect(syncDocStats).not.toHaveBeenCalled()
})
