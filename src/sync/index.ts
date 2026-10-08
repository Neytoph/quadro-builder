// 与后端的文档同步。
//
// engine/docs.js 早就把同步要用的那一半写好了（rev / dirty / deletedAt、
// setSyncMode、putRemoteDoc、markDocSynced）。本模块只是它缺的另一半：
// 真正跟服务器说话的人。engine 里的代码来自 thecodingdad/quadro-3D，
// 因此这里刻意放在 engine 之外，只通过 engine-api 门面消费公开接口。
//
// 不传 baseUrl 就什么都不做——开源本地版的默认状态，行为与从前完全一致。

import { docs, storage, partsOfData } from '../engine-api'
import { cachedStats, rememberStats } from '../designStats'
import { ENGINE_VERSION } from '../engine/publicResources.js'
import { createStatsQueue } from './statsQueue'
import { forgetOrigin, originOf } from './origin'
import type {
  DesignParts, DocRecord, PullResponse, PushResponse, RemoteDoc, RemoteInventory,
  SavedDocSyncResult, SyncEvent, SyncOptions, PendingStats, StatsSnapshot,
} from './types'

async function readCursor(): Promise<number> {
  return docs.readPullCheckpoint()
}

function contentJSON(data: unknown): string | undefined {
  return JSON.stringify(data, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)
}

/** 402 = 配额用尽。带上服务端给的用量信息，UI 好提示。 */
export class QuotaError extends Error {
  feature: string
  used: number
  limit: number
  constructor(feature: string, used: number, limit: number) {
    super(`quota exceeded: ${feature} ${used}/${limit}`)
    this.name = 'QuotaError'
    this.feature = feature
    this.used = used
    this.limit = limit
  }
}

/** 409 = 服务端有更新的版本。 */
class ConflictError extends Error {
  remote: RemoteDoc
  constructor(remote: RemoteDoc) {
    super('conflict')
    this.name = 'ConflictError'
    this.remote = remote
  }
}

export function createSync(opts: SyncOptions = {}) {
  const { baseUrl, intervalMs = 30_000, fetchImpl = globalThis.fetch, onEvent, accountId, onIdentityChange } = opts
  const enabled = Boolean(baseUrl)
  let timer: ReturnType<typeof setInterval> | null = null
  // 正在跑的那一轮。存的是 Promise 而不是一个布尔值，调用方等 syncNow()
  // 才等得到结果——「存完马上发到社区」要的就是这个：那一刻可能正好有
  // 一轮在跑，返回 undefined 就成了「以为推完了，其实刚开始」。
  let inflight: Promise<void> | null = null
  let stopped = false
  let lastError: unknown
  const receipts = new Map<string, SavedDocSyncResult>()
  const controller = new AbortController()
  const scopeEpoch = storage.getAccountEpoch()
  const unwatchAccount = storage.onAccountChange(() => stop())
  function active() {
    if (stopped || storage.getAccountEpoch() !== scopeEpoch) throw new DOMException('account changed', 'AbortError')
  }

  const emit = (e: SyncEvent) => { try { onEvent?.(e) } catch { /* 回调自己的错不该拖垮同步 */ } }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    active()
    if (!accountId || storage.getAccountScope() !== `user:${accountId}`) throw new Error('sync requires a verified account')
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',           // 会话 cookie 由网关下发
      signal: init?.signal || controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}), 'X-Builder-User-ID': accountId },
    })
    active()
    if (res.status === 401 || (res.status === 409 && res.headers.get('X-Builder-User-ID') !== accountId)) {
      stop()
      onIdentityChange?.()
      throw new Error('sync account changed')
    }
    if (res.headers.get('X-Builder-User-ID') !== accountId) throw new Error('sync response account mismatch')
    if (res.status === 402) {
      const b = await res.json().catch(() => ({}))
      active()
      throw new QuotaError(b.feature ?? 'designs', b.used ?? 0, b.limit ?? 0)
    }
    if (res.status === 409) {
      const b = await res.json().catch(() => ({}))
      active()
      throw new ConflictError(b.remote as RemoteDoc)
    }
    if (res.status === 404 && init?.method === 'GET') return null as T
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
    const result = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
    active()
    return result
  }

  /** 冲突不丢数据：本地版本另存一份，再接受服务端版本。 */
  async function forkConflict(local: DocRecord, remote: RemoteDoc, authoritativeLegacy = false): Promise<Record<string, string>> {
    active()
    const result = await docs.resolveDocConflict(local, remote, authoritativeLegacy)
    active()
    for (const [saveId, copyId] of Object.entries(result.copies)) {
      receipts.set(`${local.id}:${saveId}`, { status: 'conflict', id: local.id, saveId, copyId: copyId as string })
      emit({ type: 'conflict', id: local.id, copyId: copyId as string, saveId })
    }
    return result.copies
  }

  /**
   * 装配计划的步骤数不挡这一次上传。造型先记成已同步，量按同一 rev 补上。
   * 用户又存了新版本，或这份内容已经变了，就不再写旧的步骤数。
   */
  const statsQueue = createStatsQueue()
  const statsDelivering = new Map<string, { task: PendingStats; abort: AbortController; promise: Promise<boolean> }>()
  // 每个文档仅保留最近一次真实服务端统计回执，绝不从队列为空推断成功。
  const statsReceipts = new Map<string, string>()
  const statsKey = (task: PendingStats) => JSON.stringify([task.rev, task.saveId, task.engineVersion, contentJSON(task.data)])
  let statsDraining = false
  function statsTask(doc: DocRecord, rev: number): PendingStats {
    return { id: `models-stats:${doc.id}`, docId: doc.id, data: structuredClone(doc.data), rev, saveId: doc.saveId, engineVersion: ENGINE_VERSION }
  }
  const currentStatsModel = async (task: PendingStats, allowCoverPending = true) => {
    active()
    const current = await docs.getDoc(task.docId) as DocRecord | null
    active()
    return current && !current.deletedAt && !current.legacyPending && !current.pendingRemote
      && (!current.dirty || allowCoverPending && current.syncedSaveId === task.saveId && Boolean(task.saveId)) && current.rev === task.rev && current.saveId === task.saveId
      && contentJSON(current.data) === contentJSON(task.data)
  }
  function launchStats(task: PendingStats) {
    const job = { task, abort: new AbortController(), promise: Promise.resolve(false) }
    statsDelivering.set(task.docId, job)
    job.promise = deliverStats(task, job.abort)
    return job
  }
  async function deliverStats(original: PendingStats, abort: AbortController): Promise<boolean> {
    let task = original
    const stopRequest = () => abort.abort()
    controller.signal.addEventListener('abort', stopRequest, { once: true })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      if (!await currentStatsModel(task)) { await docs.settleStats(task); return false }
      if (task.engineVersion !== ENGINE_VERSION) {
        await docs.settleStats(task, { engineVersion: ENGINE_VERSION, stats: undefined })
        active()
        task = { ...task, engineVersion: ENGINE_VERSION, stats: undefined }
      }
      emit({ type: 'stats-pending', id: task.docId, rev: task.rev })
      const stats = task.stats || await statsQueue.compute(task.docId, task.data)
      active()
      if (abort.signal.aborted) throw new DOMException('stats superseded', 'AbortError')
      if (!await currentStatsModel(task)) { await docs.settleStats(task); return false }
      rememberStats(task.data, stats)
      await docs.settleStats(task, { stats })
      active()
      timeout = setTimeout(() => abort.abort(new Error('stats upload timed out')), 15_000)
      await call(`/models/${encodeURIComponent(task.docId)}/stats`, { method: 'PUT', body: JSON.stringify({ rev: task.rev, stats }), signal: abort.signal })
      active()
      if (abort.signal.aborted || !await currentStatsModel(task)) return false
      await docs.settleStats(task)
      active()
      if (!await currentStatsModel(task)) return false
      statsReceipts.delete(task.docId)
      statsReceipts.set(task.docId, statsKey(task))
      if (statsReceipts.size > 8) statsReceipts.delete(statsReceipts.keys().next().value!)
      emit({ type: 'stats-synced', id: task.docId, rev: task.rev })
      return true
    } catch (error) {
      if (stopped || storage.getAccountEpoch() !== scopeEpoch) return false
      if (error instanceof ConflictError) { await docs.settleStats(task); return false }
      // 同一份设计的封面或下一次保存已经推进到新版本时，旧统计任务会主动取消。
      // 这是正常的版本替代：清掉旧任务，让新版本携带或重新计算统计，不记录失败。
      if (abort.signal.aborted && abort.signal.reason instanceof DOMException && abort.signal.reason.name === 'AbortError') {
        await docs.settleStats(task)
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      await docs.settleStats(task, { error: message, retryAt: Date.now() + 30_000 })
      emit({ type: 'stats-pending', id: task.docId, rev: task.rev, error })
      console.warn('[sync stats]', error)
      return false
    } finally {
      if (timeout) clearTimeout(timeout)
      controller.signal.removeEventListener('abort', stopRequest)
      if (statsDelivering.get(task.docId)?.abort === abort) statsDelivering.delete(task.docId)
      void drainStats()
    }
  }
  async function drainStats(force = false) {
    if (statsDraining || stopped || storage.getAccountEpoch() !== scopeEpoch) return
    statsDraining = true
    try {
      const tasks = await docs.pendingStats() as PendingStats[]
      active()
      for (const task of tasks) {
        if (statsDelivering.size >= 4) break
        if (statsDelivering.has(task.docId) || !force && (task.retryAt || 0) > Date.now()) continue
        launchStats(task)
      }
    } catch (error) { if (!stopped && storage.getAccountEpoch() === scopeEpoch) console.warn('[sync stats queue]', error) }
    finally { statsDraining = false }
  }
  function scheduleStats(id: string, rev: number) {
    const earlier = statsDelivering.get(id)
    if (earlier && earlier.task.rev !== rev) { earlier.abort.abort(); statsQueue.cancel(id) }
    void drainStats()
  }

  /**
   * 推送本地改动。拉取会保留dirty及远端分歧，上传以存档基线为准。
   */
  async function push(): Promise<void> {
    const all = (await docs.allRecords()) as DocRecord[]
    const queue = all.filter((d) => d.dirty)
    const queued = new Set(queue.map(doc => doc.id))
    for (const doc of queue) {
      active()
      if (doc.legacyPending || !doc.saveId && doc.rev > 0) {
        const protectedDoc = await docs.protectLegacyDoc(doc)
        active()
        if (!protectedDoc.local) continue
        const legacy = protectedDoc.local as DocRecord
        const remote = await call<RemoteDoc | null>(`/models/${encodeURIComponent(doc.id)}`, { method: 'GET', cache: 'no-store' })
        if (remote && (remote.id !== doc.id || !Number.isSafeInteger(remote.rev))) throw new Error('invalid legacy remote model')
        const copies = await forkConflict(legacy, remote || { id: doc.id, name: legacy.name, data: null,
          createdAt: legacy.createdAt, updatedAt: Date.now(), deletedAt: Date.now(), rev: 0 }, true)
        if (legacy.deletedAt && [legacy.data, legacy.recoveryData].every(data => data === null || data === undefined) && remote && !remote.deletedAt) {
          emit({ type: 'legacy-deletion', id: doc.id })
        }
        for (const copyId of new Set(Object.values(copies))) {
          if (queued.has(copyId)) continue
          const copy = await docs.getDoc(copyId) as DocRecord | null
          active()
          if (copy?.dirty) { queue.push(copy); queued.add(copyId) }
        }
        continue
      }
      // 记下这一刻的 updatedAt：上传期间用户可能又改了，
      // markDocSynced 靠它判断该不该清 dirty。
      const stamp = doc.updatedAt
      try {
        let response: PushResponse
        if (doc.deletedAt) {
          response = await call<PushResponse>(
            `/models/${encodeURIComponent(doc.id)}?baseRev=${doc.rev}`, { method: 'DELETE' })
          if (!Number.isSafeInteger(response.rev) || response.rev < doc.rev) throw new Error('invalid delete receipt')
          await docs.markDocSynced(doc.id, response.rev, stamp, undefined, doc.saveId, doc.rev)
        } else {
          const parts = partsOfData(doc.data) as DesignParts | null
          // 步骤数来自整份装配计划，保存时先上传造型。缓存里有的量一起带上。
          // origin：这一座是从哪个方案打开的（见 ./origin.ts），第一次推上去时带上
          const stats = cachedStats(doc.data)
          response = await call<PushResponse>(`/models/${encodeURIComponent(doc.id)}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: doc.name, data: doc.data, parts, stats, baseRev: doc.rev, origin: originOf(doc.id),
              ...(doc.saveId ? { saveId: doc.saveId } : {}),
              ...(doc.cover ? { cover: doc.cover } : {}),
            }),
          })
          if (!Number.isSafeInteger(response.rev) || response.rev <= doc.rev) throw new Error('invalid save receipt')
          if (response.saveId && response.saveId !== doc.saveId) throw new Error('save receipt mismatch')
          await docs.markDocSynced(doc.id, response.rev, stamp, response.coverApplied === false ? undefined : doc.cover, doc.saveId, doc.rev, stats ? null : statsTask(doc, response.rev))
          if (!response.originError) forgetOrigin(doc.id)
          if (response.coverError || response.originError) emit({ type: 'error', error: new Error(response.coverError || response.originError) })
          scheduleStats(doc.id, response.rev)
        }
        active()
        if (doc.saveId) receipts.set(`${doc.id}:${doc.saveId}`, { status: 'synced', id: doc.id, saveId: doc.saveId, rev: response.rev })
        emit({ type: 'pushed', id: doc.id, rev: response.rev, saveId: doc.saveId, statsPending: !doc.deletedAt && !cachedStats(doc.data) })
      } catch (err) {
        active()
        if (err instanceof ConflictError) {
          if (!err.remote || err.remote.id !== doc.id || !Number.isSafeInteger(err.remote.rev)) throw new Error('invalid conflict response')
          // 响应丢失后的重试：远端确实是这份完整模型才可确认。
          if (!doc.deletedAt && !err.remote.deletedAt && err.remote.name === doc.name && contentJSON(err.remote.data) === contentJSON(doc.data)) {
            await docs.markDocSynced(doc.id, err.remote.rev, stamp, undefined, doc.saveId, doc.rev, cachedStats(doc.data) ? null : statsTask(doc, err.remote.rev))
            active()
            scheduleStats(doc.id, err.remote.rev)
            if (doc.saveId) receipts.set(`${doc.id}:${doc.saveId}`, { status: 'synced', id: doc.id, saveId: doc.saveId, rev: err.remote.rev })
            emit({ type: 'pushed', id: doc.id, rev: err.remote.rev, saveId: doc.saveId, statsPending: !cachedStats(doc.data) })
          } else await forkConflict(doc, err.remote)
          continue
        }
        if (err instanceof QuotaError) {
          // 配额用尽：保持 dirty，停止本轮推送，别把服务器打满。
          emit({ type: 'quota', feature: err.feature, used: err.used, limit: err.limit })
          throw err
        }
        throw err
      }
    }
  }

  /** 拉取服务端变更。dirty记录的远端分歧与检查点一起持久化。 */
  async function pull(): Promise<void> {
    const since = await readCursor()
    const { rev, items } = await call<PullResponse>(`/models?since=${since}`)
    active()
    if (!Number.isSafeInteger(rev) || rev < since || !Array.isArray(items)
      || items.some(item => !item.id || !Number.isSafeInteger(item.rev) || item.rev > rev || item.rev <= since)) throw new Error('invalid models pull snapshot')
    const n = await docs.applyRemoteBatch(items, rev)
    active()
    emit({ type: 'pulled', count: n, rev })
  }

  // —— 库存 ——
  //
  // 库存每人只有一份，所以比文档简单：没有 id、没有列表、没有墓碑
  // （清空就是存一份空的）。engine/storage.js 早就把记账写好了
  // （inventoryMeta / putRemoteInventory / markInventorySynced），
  // 这里同样只补"跟服务器说话"的那一半。

  /** 冲突时本地那份存这儿，别静默丢掉。 */
  const INV_STASH_KEY = 'quadro.inventory.conflict.v1'

  /**
   * 冲突处理和文档不一样：文档能另存一份副本，库存不能——
   * 一个人只有一份库存，凭空多出"库存（冲突副本）"没有意义。
   * 所以取服务端那份生效，本地那份原样存进 localStorage 并抛事件，
   * 让 UI 能提示、用户能找回。合并交给人：数量该取大还是取小，
   * 只有他自己知道（在这台机器上减到 3，不代表另一台的 8 是错的）。
   */
  function stashInventoryConflict(local: unknown): string {
    const key = storage.accountKey(INV_STASH_KEY)
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), inventory: local }))
    } catch { /* 隐私模式下存不了，那就只剩事件 */ }
    return key
  }

  async function pushInventory(): Promise<void> {
    const meta = storage.inventoryMeta()
    if (!meta.dirty) return
    const local = storage.loadInventory()
    if (local == null) return
    const stamp = meta.updatedAt          // 上传期间用户可能又改了
    try {
      const r = await call<RemoteInventory>('/inventory', {
        method: 'PUT',
        body: JSON.stringify({ data: local, baseRev: meta.rev }),
      })
      storage.markInventorySynced(r.rev, stamp)
      emit({ type: 'inventory-pushed', rev: r.rev })
    } catch (err) {
      active()
      if (err instanceof ConflictError) {
        const remote = err.remote as unknown as RemoteInventory
        const key = stashInventoryConflict(local)
        storage.putRemoteInventory(remote)
        emit({ type: 'inventory-conflict', stashKey: key })
        return
      }
      throw err
    }
  }

  async function pullInventory(): Promise<void> {
    const meta = storage.inventoryMeta()
    if (meta.dirty) return                // 本地更新，下一轮由 push 处理
    const remote = await call<RemoteInventory>('/inventory')
    if (remote.rev <= meta.rev) return    // 没有更新的
    storage.putRemoteInventory(remote)
    emit({ type: 'inventory-pulled', rev: remote.rev })
  }

  async function round(): Promise<void> {
    emit({ type: 'start' })
    lastError = undefined
    try {
      active()
      const response = await fetchImpl(`${baseUrl}/identity`, { credentials: 'include', signal: controller.signal, cache: 'no-store' })
      active()
      if (response.status === 401 || response.status === 403) { stop(); onIdentityChange?.(); return }
      if (!response.ok) throw new Error(`GET /identity → ${response.status}`)
      const identity = await response.json() as { userId?: string }
      active()
      if (identity.userId !== accountId) { stop(); onIdentityChange?.(); return }
      try { await push() }
      catch (error) {
        if (!(error instanceof QuotaError)) throw error
        // 配额阻止上传时仍能安全拉取；整轮保留失败状态。
        await pull()
        throw error
      }
      await pull()
      await pushInventory()
      await pullInventory()
      void drainStats(true)
      emit({ type: 'idle', rev: await readCursor() })
    } catch (error) {
      lastError = error
      if (!stopped && storage.getAccountEpoch() === scopeEpoch) emit({ type: 'error', error })
    }
  }

  /** 跑一轮。已经有一轮在跑就把那一轮给出去，两边都能等到它结束。 */
  function syncNow(): Promise<void> {
    if (!enabled || stopped) return Promise.resolve()
    if (!inflight) inflight = round().finally(() => { inflight = null })
    return inflight
  }

  async function syncSavedDoc(id: string, saveId: string): Promise<SavedDocSyncResult> {
    const key = `${id}:${saveId}`
    const check = async (): Promise<SavedDocSyncResult | undefined> => {
      const receipt = receipts.get(key)
      if (receipt) return receipt
      const doc = await docs.getDoc(id) as DocRecord | null
      if (doc?.conflictCopies?.[saveId]) return { status: 'conflict', id, saveId, copyId: doc.conflictCopies[saveId] }
      if (doc?.syncedSaveId === saveId) return { status: 'synced', id, saveId, rev: doc.rev }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (stopped || storage.getAccountEpoch() !== scopeEpoch) return { status: 'pending', id, saveId, error: lastError || new Error('account changed') }
      const result = await check()
      if (result) return result
      if (!enabled) break
      await syncNow()
      const completed = await check()
      if (completed) return completed
      if (lastError || stopped) break
    }
    return { status: 'pending', id, saveId, error: lastError }
  }

  /** 发布专用：总等待60秒，加入同版本在途任务，成功必须来自实际stats PUT回执。 */
  async function syncDocStats(snapshot: StatsSnapshot): Promise<boolean> {
    if (!enabled || stopped || storage.getAccountEpoch() !== scopeEpoch) return false
    const task = statsTask(snapshot as DocRecord, snapshot.rev)
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let interrupted = () => {}
    const deadline = new Promise<boolean>(resolve => {
      interrupted = () => resolve(false)
      controller.signal.addEventListener('abort', interrupted, { once: true })
      timeout = setTimeout(interrupted, 60_000)
    })
    const wait = async () => {
      active()
      if (!await currentStatsModel(task, false)) return false
      if (statsReceipts.get(task.docId) === statsKey(task)) return true
      if (!(await docs.queueStats(task)).queued) return false
      while (!finished) {
        active()
        if (!await currentStatsModel(task, false)) return false
        if (statsReceipts.get(task.docId) === statsKey(task)) return true
        const running = statsDelivering.get(task.docId)
        if (running) {
          if (statsKey(running.task) !== statsKey(task)) {
            running.abort.abort()
            statsQueue.cancel(task.docId)
            await running.promise
            continue
          }
          return await running.promise && !finished && Boolean(await currentStatsModel(task, false))
        }
        if (statsDelivering.size >= 4) {
          await Promise.race([...statsDelivering.values()].map(job => job.promise))
          continue
        }
        return await launchStats(task).promise && !finished && Boolean(await currentStatsModel(task, false))
      }
      return false
    }
    try { return await Promise.race([wait(), deadline]) }
    catch { return false }
    finally {
      finished = true
      if (timeout) clearTimeout(timeout)
      controller.signal.removeEventListener('abort', interrupted)
    }
  }

  function start(): void {
    if (!enabled || stopped || timer) return
    docs.setSyncMode(true)          // 让删除留下墓碑，否则服务端的删不掉
    void syncNow()
    if (intervalMs > 0) timer = setInterval(() => void syncNow(), intervalMs)
  }

  function stop(): void {
    unwatchAccount()
    stopped = true
    controller.abort()
    statsQueue.cancel()
    for (const job of statsDelivering.values()) job.abort.abort()
    if (timer) { clearInterval(timer); timer = null }
    docs.setSyncMode(false)
  }

  return { enabled, start, stop, syncNow, syncSavedDoc, syncDocStats }
}
