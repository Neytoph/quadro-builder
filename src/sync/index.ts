// 与后端的文档同步。
//
// engine/docs.js 早就把同步要用的那一半写好了（rev / dirty / deletedAt、
// setSyncMode、putRemoteDoc、markDocSynced）。本模块只是它缺的另一半：
// 真正跟服务器说话的人。engine 里的代码来自 thecodingdad/quadro-3D，
// 因此这里刻意放在 engine 之外，只通过 engine-api 门面消费公开接口。
//
// 不传 baseUrl 就什么都不做——开源本地版的默认状态，行为与从前完全一致。

import { docs, storage, partsOfData } from '../engine-api'
import { statsOfData } from '../designStats'
import { forgetOrigin, originOf } from './origin'
import type {
  DesignParts, DocRecord, PullResponse, PushResponse, RemoteDoc, RemoteInventory,
  SavedDocSyncResult, SyncEvent, SyncOptions,
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
      signal: controller.signal,
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
   * 推送本地改动。拉取会保留dirty及远端分歧，上传以存档基线为准。
   */
  async function push(): Promise<void> {
    const all = (await docs.allRecords()) as DocRecord[]
    const queue = all.filter((d) => d.dirty)
    const queued = new Set(queue.map(doc => doc.id))
    for (const doc of queue) {
      active()
      if (!doc.saveId && doc.rev > 0) {
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
          // stats：这一版的量（../designStats.ts），服务端拿它当客观量，和 parts 一样由引擎算
          // origin：这一座是从哪个方案打开的（见 ./origin.ts），第一次推上去时带上
          response = await call<PushResponse>(`/models/${encodeURIComponent(doc.id)}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: doc.name, data: doc.data, parts, stats: statsOfData(doc.data), baseRev: doc.rev, origin: originOf(doc.id),
              ...(doc.saveId ? { saveId: doc.saveId } : {}),
              ...(doc.cover ? { cover: doc.cover } : {}),
            }),
          })
          if (!Number.isSafeInteger(response.rev) || response.rev <= doc.rev) throw new Error('invalid save receipt')
          if (response.saveId && response.saveId !== doc.saveId) throw new Error('save receipt mismatch')
          await docs.markDocSynced(doc.id, response.rev, stamp, response.coverApplied === false ? undefined : doc.cover, doc.saveId, doc.rev)
          if (!response.originError) forgetOrigin(doc.id)
          if (response.coverError || response.originError) emit({ type: 'error', error: new Error(response.coverError || response.originError) })
        }
        active()
        if (doc.saveId) receipts.set(`${doc.id}:${doc.saveId}`, { status: 'synced', id: doc.id, saveId: doc.saveId, rev: response.rev })
        emit({ type: 'pushed', id: doc.id, rev: response.rev, saveId: doc.saveId })
      } catch (err) {
        active()
        if (err instanceof ConflictError) {
          if (!err.remote || err.remote.id !== doc.id || !Number.isSafeInteger(err.remote.rev)) throw new Error('invalid conflict response')
          // 响应丢失后的重试：远端确实是这份完整模型才可确认。
          if (!doc.deletedAt && !err.remote.deletedAt && err.remote.name === doc.name && contentJSON(err.remote.data) === contentJSON(doc.data)) {
            await docs.markDocSynced(doc.id, err.remote.rev, stamp, undefined, doc.saveId, doc.rev)
            active()
            if (doc.saveId) receipts.set(`${doc.id}:${doc.saveId}`, { status: 'synced', id: doc.id, saveId: doc.saveId, rev: err.remote.rev })
            emit({ type: 'pushed', id: doc.id, rev: err.remote.rev, saveId: doc.saveId })
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

  function start(): void {
    if (!enabled || stopped || timer) return
    docs.setSyncMode(true)          // 让删除留下墓碑，否则服务端的删不掉
    void syncNow()
    if (intervalMs > 0) timer = setInterval(() => void syncNow(), intervalMs)
  }

  function stop(): void {
    stopped = true
    controller.abort()
    if (timer) { clearInterval(timer); timer = null }
    docs.setSyncMode(false)
  }

  return { enabled, start, stop, syncNow, syncSavedDoc }
}
