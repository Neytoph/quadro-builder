// 打开一个共享方案：本机文档、y-websocket 连接、在线状态、导出。
//
// 连接照 y-websocket 的协议走 {VITE_SYNC_BASE}/collab/ws?plan=<id>；服务端只中转，
// 不解析 Yjs（见接口约定「实时同步」一节）。成员的文档同时存在本机
// （quadro.plan.<id>），断网时的修改先存着，连上以后自动合并；访客不在本机留东西。
//
// 服务端还没有任何更新记录（新建的方案）时，第一次连上以后编辑者用 quadro_plans.data
// 生成文档交上去；访客和评论者在自己这边生成一份用来查看，服务端会丢掉他们的更新。

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import { BuildModel, buildQDF, partsOfData } from '../engine-api'
import { collabApi, wsServerUrl, type ExportBody, type Parts, type Plan } from './api'
import { ModelHistory } from './history'
import { planDbName, SEED_ORIGIN, type LocalDoc } from './localDocs'
import { docIsEmpty, docToJSON, flatten, metaMap, sameJson, writeJSON, type ModelJSON } from './ymodel'

/** 编辑停下来多久以后把导出结果交给服务端。 */
export const EXPORT_IDLE_MS = 30_000

/** 在线状态里每个人的样子。 */
export interface PeerUser {
  userId: number
  name: string
  avatar: string
  color: string
}

export interface Peer {
  clientId: number
  user: PeerUser | null
  selection: string[]
}

export type ConnState = 'connecting' | 'connected' | 'offline'

const PEER_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5c940d']

export function peerColor(key: number) {
  return PEER_COLORS[Math.abs(key) % PEER_COLORS.length]
}

export function canEditRole(role: Plan['myRole']) {
  return role === 'owner' || role === 'editor'
}

/** 造型 JSON 的导出结果：data、qdf、料表。 */
export function exportOf(data: ModelJSON, name: string): ExportBody {
  const model = new BuildModel()
  const res = model.loadJSON(data)
  if (!res.ok) throw new Error(`export: model does not load (${res.reason})`)
  const out = buildQDF(model) as { text?: string } | string
  const qdf = typeof out === 'string' ? out : String(out.text || '')
  return { name, data, qdf, parts: partsOfData(data) as Parts }
}

/** 两份造型 JSON 的零件和字段完全相同（不看顺序）。a 先按引擎的规矩读一遍。 */
export function sameModel(raw: ModelJSON | null, b: ModelJSON): boolean {
  if (!raw) return false
  const m = new BuildModel()
  if (!m.loadJSON(raw).ok) return false
  const fa = flatten(m.toJSON() as ModelJSON)
  const fb = flatten(b)
  if (fa.size !== fb.size) return false
  for (const [id, rec] of fa) {
    const other = fb.get(id)
    if (!other || !sameJson(rec, other)) return false
  }
  return true
}

export function stateBase64(doc: Y.Doc): string {
  const bytes = Y.encodeStateAsUpdate(doc)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function docFromBase64(state: string): Y.Doc {
  const bin = atob(state)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return doc
}

export class PlanSession {
  plan: Plan
  readonly id: string
  readonly local: LocalDoc
  readonly provider: WebsocketProvider
  /** 新建零件 id 里夹的本端标记 */
  readonly idTag: string
  conn: ConnState = 'connecting'
  /** 连上过服务器、拿到过服务器那一份 */
  synced = false
  private exportTimer: number | null = null
  private listeners = new Set<() => void>()
  private readonly persistence: IndexeddbPersistence | null
  private readonly onUpdate: (u: Uint8Array, origin: unknown) => void

  private constructor(plan: Plan, local: LocalDoc, persistence: IndexeddbPersistence | null) {
    this.plan = plan
    this.id = plan.id
    this.local = local
    this.persistence = persistence
    this.idTag = `c${local.doc.clientID.toString(36)}_`
    this.provider = new WebsocketProvider(wsServerUrl(), 'ws', local.doc, {
      params: { plan: plan.id },
      // 所有方案的房间名都是 ws，同一个浏览器里的广播频道会串，只走服务器
      disableBc: true,
    })
    this.provider.on('status', ({ status }: { status: string }) => {
      const before = this.conn
      this.conn = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'
      // 角色变了服务端会断开这个人的连接：重新连上时把方案和角色再取一遍
      if (before !== 'connected' && this.conn === 'connected' && this.synced) void this.refresh()
      this.emit()
    })
    this.provider.on('sync', (isSynced: boolean) => {
      if (!isSynced) return
      const first = !this.synced
      this.synced = true
      this.seedIfEmpty()
      // 上一次停手不到 30 秒就关了页面，服务端那份 data 没跟上：连上以后补交一次
      if (first && this.canEdit && !sameModel(this.plan.data, this.toJSON())) this.scheduleExport()
      this.emit()
    })
    this.provider.awareness.on('change', () => this.emit())
    this.onUpdate = (_u, origin) => {
      if (origin === this.local.history.origin) this.scheduleExport()
    }
    local.doc.on('update', this.onUpdate)
    // 浏览器说断网了就先断开，这段时间的修改留在本机；联网了立刻重连，
    // 连上时交给服务器的是完整状态，断网期间的修改一起合并进去。
    // 不等 y-websocket 自己 30 秒收不到消息才发现
    this.onOffline = () => this.provider.disconnect()
    this.onOnline = () => this.provider.connect()
    window.addEventListener('offline', this.onOffline)
    window.addEventListener('online', this.onOnline)
    this.setUser()
  }

  private readonly onOffline: () => void
  private readonly onOnline: () => void

  static async open(id: string): Promise<PlanSession> {
    const plan = await collabApi.plan(id)
    const doc = new Y.Doc()
    let persistence: IndexeddbPersistence | null = null
    if (plan.myRole !== 'guest') {
      persistence = new IndexeddbPersistence(planDbName(plan.id), doc)
      await persistence.whenSynced
    }
    const local: LocalDoc = { doc, history: new ModelHistory(doc), persistence }
    return new PlanSession(plan, local, persistence)
  }

  get canEdit() { return canEditRole(this.plan.myRole) }

  get canDeliver() {
    const me = this.plan.me
    return this.canEdit && !!me && this.plan.members.some(m => m.userId === me.userId && m.canDeliver)
  }

  get name(): string {
    return String(metaMap(this.local.doc).get('name') || this.plan.name)
  }

  /** 文档里还没有造型（没连上过、本机也没有）：界面显示「连接中」。 */
  get empty() { return docIsEmpty(this.local.doc) }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private emit() { for (const cb of this.listeners) cb() }

  private setUser() {
    const me = this.plan.me
    const user: PeerUser | null = me ? { userId: me.userId, name: me.name, avatar: me.avatar, color: peerColor(me.userId) } : null
    this.provider.awareness.setLocalStateField('user', user)
  }

  /** 在线状态里放自己选中的零件，别人画面上标出来。 */
  setSelection(ids: string[]) {
    const prev = (this.provider.awareness.getLocalState()?.selection as string[] | undefined) || []
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return
    this.provider.awareness.setLocalStateField('selection', ids)
  }

  /** 其他在线的人（不含自己）。 */
  peers(): Peer[] {
    const out: Peer[] = []
    this.provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.provider.awareness.clientID) return
      out.push({ clientId, user: (state.user as PeerUser | null) || null, selection: (state.selection as string[]) || [] })
    })
    return out
  }

  private seedIfEmpty() {
    if (!docIsEmpty(this.local.doc) || !this.plan.data) return
    const m = new BuildModel()
    const res = m.loadJSON(this.plan.data)
    if (!res.ok) throw new Error(`plan ${this.id}: data does not load (${res.reason})`)
    writeJSON(this.local.doc, m.toJSON() as ModelJSON, SEED_ORIGIN)
  }

  /** 方案和自己的角色再取一遍（重连以后、角色调整以后）。 */
  async refresh() {
    this.plan = await collabApi.plan(this.id)
    this.setUser()
    this.emit()
  }

  toJSON(): ModelJSON {
    return docToJSON(this.local.doc)
  }

  exportBody(): ExportBody {
    return exportOf(this.toJSON(), this.name)
  }

  private scheduleExport() {
    if (!this.canEdit) return
    if (this.exportTimer) window.clearTimeout(this.exportTimer)
    this.exportTimer = window.setTimeout(() => {
      this.exportTimer = null
      void this.exportNow()
    }, EXPORT_IDLE_MS)
  }

  /** 把现在的造型交给服务端（存版本、锁定交付、编辑停下 30 秒）。 */
  async exportNow() {
    if (!this.canEdit) return
    if (this.exportTimer) { window.clearTimeout(this.exportTimer); this.exportTimer = null }
    await collabApi.exportPlan(this.id, this.exportBody())
  }

  async saveVersion(name: string) {
    const body = this.exportBody()
    const v = await collabApi.saveVersion(this.id, { name, state: stateBase64(this.local.doc), data: body.data, qdf: body.qdf, parts: body.parts })
    await collabApi.exportPlan(this.id, body)
    return v
  }

  destroy() {
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('online', this.onOnline)
    if (this.exportTimer) window.clearTimeout(this.exportTimer)
    this.local.doc.off('update', this.onUpdate)
    this.provider.destroy()
    this.local.history.destroy()
    if (this.persistence) void this.persistence.destroy()
    this.local.doc.destroy()
  }
}
