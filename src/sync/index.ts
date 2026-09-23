// 与后端的文档同步。
//
// engine/docs.js 早就把同步要用的那一半写好了（rev / dirty / deletedAt、
// setSyncMode、putRemoteDoc、markDocSynced）。本模块只是它缺的另一半：
// 真正跟服务器说话的人。engine 里的代码来自 thecodingdad/quadro-3D，
// 因此这里刻意放在 engine 之外，只通过 engine-api 门面消费公开接口。
//
// 不传 baseUrl 就什么都不做——开源本地版的默认状态，行为与从前完全一致。

import { docs, storage, partsOfData } from '../engine-api'
import type {
  DesignParts, DocRecord, PullResponse, PushResponse, RemoteDoc, RemoteInventory,
  SyncEvent, SyncOptions,
} from './types'

/**
 * 拉取游标：本地记录里最大的 rev。
 *
 * 游标跟文档放在同一个 IndexedDB 里算出来，两者同生同灭。浏览器单独清掉
 * IndexedDB 时，游标跟着归零，下一轮把服务器上的整份重新拉回来。
 * 服务端每次改动都给这个用户的 rev 加一，拉下来的记录全部落进本地，
 * 所以本地最大的 rev 之前的改动都已经在本地。
 */
async function readCursor(): Promise<number> {
  const all = (await docs.allRecords()) as DocRecord[]
  return all.reduce((max, d) => Math.max(max, d.rev || 0), 0)
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
  const { baseUrl, intervalMs = 30_000, fetchImpl = globalThis.fetch, onEvent } = opts
  const enabled = Boolean(baseUrl)
  let timer: ReturnType<typeof setInterval> | null = null
  // 正在跑的那一轮。存的是 Promise 而不是一个布尔值，调用方等 syncNow()
  // 才等得到结果——「存完马上发到社区」要的就是这个：那一刻可能正好有
  // 一轮在跑，返回 undefined 就成了「以为推完了，其实刚开始」。
  let inflight: Promise<void> | null = null

  const emit = (e: SyncEvent) => { try { onEvent?.(e) } catch { /* 回调自己的错不该拖垮同步 */ } }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',           // 会话 cookie 由网关下发
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    if (res.status === 402) {
      const b = await res.json().catch(() => ({}))
      throw new QuotaError(b.feature ?? 'designs', b.used ?? 0, b.limit ?? 0)
    }
    if (res.status === 409) {
      const b = await res.json().catch(() => ({}))
      throw new ConflictError(b.remote as RemoteDoc)
    }
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  }

  /** 冲突不丢数据：本地版本另存一份，再接受服务端版本。 */
  async function forkConflict(local: DocRecord, remote: RemoteDoc): Promise<void> {
    const copy = await docs.saveDoc({
      docId: undefined,                 // 新建：engine 侧会生成 id
      name: `${local.name}（冲突副本）`,
      data: local.data,
    })
    await docs.putRemoteDoc(remote)
    emit({ type: 'conflict', id: local.id, copyId: copy.id })
  }

  /**
   * 推送本地改动。必须先于 pull——putRemoteDoc 是无条件覆盖，
   * 先拉会把还没上传的修改冲掉。
   */
  async function push(): Promise<void> {
    const all = (await docs.allRecords()) as DocRecord[]
    for (const doc of all.filter((d) => d.dirty)) {
      // 记下这一刻的 updatedAt：上传期间用户可能又改了，
      // markDocSynced 靠它判断该不该清 dirty。
      const stamp = doc.updatedAt
      try {
        if (doc.deletedAt) {
          const r = await call<PushResponse>(
            `/models/${encodeURIComponent(doc.id)}?baseRev=${doc.rev}`, { method: 'DELETE' })
          await docs.markDocSynced(doc.id, r.rev, stamp)
        } else {
          const parts = partsOfData(doc.data) as DesignParts | null
          const r = await call<PushResponse>(`/models/${encodeURIComponent(doc.id)}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: doc.name, data: doc.data, parts, baseRev: doc.rev,
            }),
          })
          await docs.markDocSynced(doc.id, r.rev, stamp)
        }
        emit({ type: 'pushed', id: doc.id, rev: doc.rev })
      } catch (err) {
        if (err instanceof ConflictError) { await forkConflict(doc, err.remote); continue }
        if (err instanceof QuotaError) {
          // 配额用尽：保持 dirty，停止本轮推送，别把服务器打满。
          emit({ type: 'quota', feature: err.feature, used: err.used, limit: err.limit })
          return
        }
        throw err
      }
    }
  }

  /** 拉取服务端变更。跳过仍为 dirty 的记录，它们下一轮由 push 处理。 */
  async function pull(): Promise<void> {
    const since = await readCursor()
    const { rev, items } = await call<PullResponse>(`/models?since=${since}`)
    if (!items.length) return

    const local = new Map(
      ((await docs.allRecords()) as DocRecord[]).map((d) => [d.id, d]))
    let n = 0
    for (const item of items) {
      if (local.get(item.id)?.dirty) continue        // 本地更新，别覆盖
      await docs.putRemoteDoc(item)
      n++
    }
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
    try {
      localStorage.setItem(INV_STASH_KEY, JSON.stringify({ at: Date.now(), inventory: local }))
    } catch { /* 隐私模式下存不了，那就只剩事件 */ }
    return INV_STASH_KEY
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
    try {
      await push()
      await pull()
      await pushInventory()
      await pullInventory()
      emit({ type: 'idle', rev: await readCursor() })
    } catch (error) {
      emit({ type: 'error', error })
    }
  }

  /** 跑一轮。已经有一轮在跑就把那一轮给出去，两边都能等到它结束。 */
  function syncNow(): Promise<void> {
    if (!enabled) return Promise.resolve()
    if (!inflight) inflight = round().finally(() => { inflight = null })
    return inflight
  }

  function start(): void {
    if (!enabled || timer) return
    docs.setSyncMode(true)          // 让删除留下墓碑，否则服务端的删不掉
    void syncNow()
    if (intervalMs > 0) timer = setInterval(() => void syncNow(), intervalMs)
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null }
    docs.setSyncMode(false)
  }

  return { enabled, start, stop, syncNow }
}
