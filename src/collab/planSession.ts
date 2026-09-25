// 连上一个共享方案：y-websocket 连接、在线状态、导出。
//
// 连接照 y-websocket 的协议走 {VITE_SYNC_BASE}/collab/ws?plan=<id>；服务端只中转，
// 不解析 Yjs（见接口约定「实时同步」一节）。文档是方案那个标签页的，存在本机，
// 断网时的修改先存着，连上以后自动合并。
//
// 服务端还没有任何更新记录（新建的方案）时，第一次连上以后编辑者用 quadro_plans.data
// 生成文档交上去；访客和评论者在自己这边生成一份用来查看，服务端会丢掉他们的更新。

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { BuildModel, buildQDF, partsOfData } from '../engine-api'
import { collabApi, wsServerUrl, type ExportBody, type Parts, type Plan } from './api'
import { SEED_ORIGIN, type LocalDoc } from './localDocs'
import { docIsEmpty, docToJSON, flatten, metaMap, NAME_ORIGIN, planName, sameJson, setPlanName, writeJSON, type EditSummary, type ModelJSON } from './ymodel'

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

/** 成员颜色：按加入顺序轮流取，头像描边、画面上的选中框、名字条都用它 */
export const MEMBER_COLORS = ['#EA580C', '#2563EB', '#9333EA', '#0D9488', '#DB2777']

export function memberColor(members: Plan['members'], userId: number) {
  const i = members.findIndex(m => m.userId === userId)
  return MEMBER_COLORS[(i >= 0 ? i : Math.abs(userId)) % MEMBER_COLORS.length]
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
  private editSeq = 0
  // 每个在线的端上一次看到的修改序号
  private editSeen = new Map<number, number>()
  // 已经为哪些不在名单上的人重取过成员
  private askedMembers = new Set<number>()
  /**
   * 别人刚做的修改，按人攒着：停手 1.2 秒以后亮出来，亮 3 秒收走。
   * 界面画底部那一条「林木木 加了 4 件、挪了 2 件」。
   */
  activity: Array<{ key: string; user: PeerUser; s: EditSummary; shown: boolean }> = []
  private activityTimers = new Map<string, number>()

  /** 连上一个共享方案。文档是它那个标签页的（存在本机），这里只管连接和在线状态。 */
  constructor(plan: Plan, local: LocalDoc) {
    this.plan = plan
    this.id = plan.id
    this.local = local
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
      // 上一次停手不到 30 秒就关了页面、改名以后没交上去，服务端那份没跟上：连上以后补交一次
      if (first && this.canEdit && (this.name !== this.plan.name || !sameModel(this.plan.data, this.toJSON()))) this.scheduleExport()
      this.emit()
    })
    this.provider.awareness.on('change', () => { this.collectActivity(); this.emit() })
    // 名字变了：自己改的立即交一次导出，服务端的方案名、需求单、交付页跟着变；别人改的刷新标签页
    this.onMeta = (ev, tr) => {
      if (!ev.keysChanged.has('name') && !ev.keysChanged.has('plan')) return
      if (tr.origin === NAME_ORIGIN && tr.local) void this.exportNow()
      this.emit()
    }
    metaMap(local.doc).observe(this.onMeta)
    // 自己改了一次（编辑、撤销、重做）：30 秒后交导出，在线状态里告诉别人改了什么
    local.history.onEdit((s) => {
      this.scheduleExport()
      const edit = { n: ++this.editSeq, ...s }
      this.provider.awareness.setLocalStateField('edit', edit)
    })
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
  private readonly onMeta: (ev: Y.YMapEvent<unknown>, tr: Y.Transaction) => void

  private collectActivity() {
    const aw = this.provider.awareness
    aw.getStates().forEach((state, clientId) => {
      if (clientId === aw.clientID) return
      const edit = state.edit as ({ n: number } & EditSummary) | undefined
      const user = state.user as PeerUser | null | undefined
      // 在线的人里有成员名单上没有的：刚用邀请链接加入，把方案和成员再取一遍
      if (user && !this.plan.members.some(m => m.userId === user.userId) && !this.askedMembers.has(user.userId)) {
        this.askedMembers.add(user.userId)
        // 没取到（断网）下次再取，出错照样抛出去
        this.refresh().catch((err) => { this.askedMembers.delete(user.userId); throw err })
      }
      // 第一次看到还没改过东西的端：从 0 数起
      if (!edit) { if (!this.editSeen.has(clientId)) this.editSeen.set(clientId, 0); return }
      if (!user) return
      const seen = this.editSeen.get(clientId)
      this.editSeen.set(clientId, edit.n)
      // 第一次看到这个端：是它连上前的旧修改，不算
      if (seen === undefined || seen === edit.n) return
      const key = String(user.userId)
      let item = this.activity.find(a => a.key === key && !a.shown)
      if (!item) {
        item = { key, user, s: { added: 0, removed: 0, moved: 0, changed: 0 }, shown: false }
        this.activity.push(item)
      }
      item.s = {
        added: item.s.added + edit.added, removed: item.s.removed + edit.removed,
        moved: item.s.moved + edit.moved, changed: item.s.changed + edit.changed,
      }
      const pending = item
      window.clearTimeout(this.activityTimers.get(key))
      this.activityTimers.set(key, window.setTimeout(() => {
        pending.shown = true
        this.emit()
        window.setTimeout(() => {
          this.activity = this.activity.filter(a => a !== pending)
          this.emit()
        }, 3000)
      }, 1200))
    })
  }

  get canEdit() { return canEditRole(this.plan.myRole) }

  get canDeliver() {
    const me = this.plan.me
    return this.canEdit && !!me && this.plan.members.some(m => m.userId === me.userId && m.canDeliver)
  }

  /** 方案的名字：文档里改过名就用文档里的，没改过用服务端的。 */
  get name(): string {
    return planName(this.local.doc, this.id) ?? this.plan.name
  }

  /** 改名（创建人、编辑者）。名字写进文档，立即交一次导出。空名字不改。 */
  rename(name: string) {
    if (!this.canEdit) throw new Error(`plan ${this.id}: ${this.plan.myRole} cannot rename`)
    const next = name.trim()
    if (!next || next === this.name) return
    setPlanName(this.local.doc, this.id, next)
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
    const user: PeerUser | null = me ? { userId: me.userId, name: me.name, avatar: me.avatar, color: memberColor(this.plan.members, me.userId) } : null
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

  /**
   * 导出时带的封面：这个方案的标签页正开在画面上时截一张，不在画面上时是 null。
   * 由 CollabProvider 接上。
   */
  cover: () => Promise<string | null> = async () => null

  private async exportWithCover(body: ExportBody) {
    const cover = await this.cover()
    await collabApi.exportPlan(this.id, cover ? { ...body, cover } : body)
    this.plan = { ...this.plan, name: body.name }
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
    await this.exportWithCover(this.exportBody())
  }

  async saveVersion(name: string) {
    const body = this.exportBody()
    const v = await collabApi.saveVersion(this.id, { name, state: stateBase64(this.local.doc), data: body.data, qdf: body.qdf, parts: body.parts })
    await this.exportWithCover(body)
    return v
  }

  /** 断开（标签页关了）。文档归标签页管，这里不动。 */
  destroy() {
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('online', this.onOnline)
    metaMap(this.local.doc).unobserve(this.onMeta)
    if (this.exportTimer) window.clearTimeout(this.exportTimer)
    for (const id of this.activityTimers.values()) window.clearTimeout(id)
    this.local.history.onEdit(() => {})
    this.provider.destroy()
    this.provider.awareness.destroy()
    this.listeners.clear()
  }
}
