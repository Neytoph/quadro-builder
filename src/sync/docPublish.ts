import { docs, storage } from '../engine-api'
import { statsContentKey } from '../designStats'
import { syncDocStats, syncNow, syncSavedDoc } from './bootstrap'
import type { DocRecord } from './types'

export interface PushDocOptions {
  requireStats?: boolean
  expectedData?: unknown
  expectedUpdatedAt?: number
  expectedSaveId?: string
}

/** 社区等待模型回执；发布另外等待这个完整版本的服务端统计回执。 */
export async function pushDocToServer(docId: string, options: PushDocOptions = {}): Promise<boolean> {
  const epoch = storage.getAccountEpoch()
  const doc = await docs.getDoc(docId) as DocRecord | null
  if (!doc || doc.deletedAt) return false
  if (!options.requireStats) {
    if (!doc.saveId) return Number(doc.rev) > 0 && !doc.dirty
    return (await syncSavedDoc(docId, doc.saveId)).status === 'synced'
  }
  if (options.expectedData !== undefined && statsContentKey(doc.data) !== statsContentKey(options.expectedData)) return false
  if (options.expectedUpdatedAt !== undefined && doc.updatedAt !== options.expectedUpdatedAt
    || 'expectedSaveId' in options && doc.saveId !== options.expectedSaveId) return false
  const content = statsContentKey(doc.data)
  let expired = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const publishReady = async () => {
    // 封面可能沿用原saveId；旧模型回执不代表这次封面PUT已经结束。
    await syncNow()
    if (expired || storage.getAccountEpoch() !== epoch) return false
    const current = await docs.getDoc(docId) as DocRecord | null
    if (!current || current.deletedAt || current.dirty || current.pendingRemote || current.legacyPending
      || current.saveId !== doc.saveId || current.updatedAt !== doc.updatedAt || current.name !== doc.name || current.cover
      || statsContentKey(current.data) !== content || Number(current.rev) <= 0) return false
    if (!await syncDocStats({ id: docId, rev: current.rev, saveId: current.saveId, data: current.data })) return false
    const latest = await docs.getDoc(docId) as DocRecord | null
    return !expired && storage.getAccountEpoch() === epoch && Boolean(latest && !latest.dirty && !latest.deletedAt
      && !latest.pendingRemote && latest.rev === current.rev && latest.saveId === current.saveId
      && latest.updatedAt === current.updatedAt && latest.name === current.name && !latest.cover && statsContentKey(latest.data) === content)
  }
  try {
    return await Promise.race([publishReady(), new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 75_000) })])
  } catch { return false }
  finally { expired = true; if (timeout) clearTimeout(timeout) }
}
