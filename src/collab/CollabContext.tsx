// 共享方案在界面这一层的状态和动作：打开方案、邀请加入、在线的人、评论和留言、
// 版本、对照、复制、交付，还有交付查看和画房间两种打开方式。
//
// 开源本地版（不设 VITE_SYNC_BASE）mode 永远是 off，这里什么都不做，界面也不出现。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../store/EngineContext'
import { bootEntry, dropParam } from '../entry'
import { computeMetrics, BuildModel } from '../engine-api'
import { useI18n } from '../i18n'
import { collabApi, collabEnabled, type Anchor, type Member, type Metrics, type Opening, type Plan, type Post, type Ref, type Role, type Room, type Thread, type VersionInfo } from './api'
import { canEditRole, docFromBase64, exportOf, PlanSession, peerColor, type Peer } from './planSession'
import { memoryDoc } from './localDocs'
import { docToJSON, type ModelJSON } from './ymodel'
import { diffBom, diffModels, type BomDiffRow, type ModelDiff } from './compare'

export type CollabMode = 'off' | 'plan' | 'delivery' | 'room'
export type CollabStatus = 'loading' | 'needLogin' | 'ready' | 'error'

/** 版本对照：左右两边的造型、名字、差异。 */
export interface CompareState {
  ids: [string, string]
  names: [string, string]
  left: ModelJSON
  right: ModelJSON
  diff: ModelDiff
  bom: BomDiffRow[]
}

export interface DeliveryState {
  token: string
  supersededBy: string | null
}

export interface RoomState {
  briefId: string
  room: Room
}

/** 对照和选中标记用的颜色 */
export const DIFF_COLORS = { added: '#2f9e44', removed: '#e03131', changed: '#f08c00' }

interface CollabApi {
  enabled: boolean
  mode: CollabMode
  status: CollabStatus
  error: string | null
  /** 界面跟着刷新的计数 */
  rev: number
  session: PlanSession | null
  plan: Plan | null
  role: Role
  canEdit: boolean
  canDeliver: boolean
  members: Member[]
  peers: Peer[]
  threads: Thread[]
  versions: VersionInfo[]
  isUnread: (p: Post) => boolean
  unread: { pins: number; chat: number }
  markRead: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshVersions: () => Promise<void>
  /** 位置评论：下一次点画布取一个点 */
  placingPin: boolean
  setPlacingPin: (on: boolean) => void
  pinDraft: Anchor | null
  setPinDraft: (a: Anchor | null) => void
  addPin: (anchor: Anchor, body: string, files: File[]) => Promise<void>
  reply: (tid: number, body: string, files: File[], refs: Ref[]) => Promise<void>
  resolve: (tid: number, resolved: boolean) => Promise<void>
  /** 零件已经不在了的评论 */
  partGone: (t: Thread) => boolean
  /** 位置评论的编号：按发表先后从 1 数 */
  pinNumber: (t: Thread) => number
  /** 我名下的其他造型（复制出来的那几份），留言时可以引用 */
  myForks: Array<{ id: string; name: string }>
  focusThread: (t: Thread) => void
  activeThread: number | null
  setActiveThread: (id: number | null) => void
  saveVersion: (name: string) => Promise<{ id: number }>
  inviteUrl: () => Promise<string>
  shareUrl: () => string
  setRole: (userId: number, role: Role) => Promise<void>
  removeMember: (userId: number) => Promise<void>
  fork: (versionId: number | null) => Promise<void>
  metricsOf: (versionId: number) => Promise<Metrics>
  deliver: (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics }) => Promise<string>
  compare: CompareState | null
  openCompare: (a: string, b: string) => void
  closeCompare: () => void
  delivery: DeliveryState | null
  room: RoomState | null
  saveRoom: (room: Room) => Promise<void>
  /** 自己的造型开启共享：成为一个共享方案，转到方案地址 */
  enableSharing: () => Promise<void>
  loginUrl: () => string
  report: (err: unknown) => void
}

const Ctx = createContext<CollabApi | null>(null)

function modeOf(): CollabMode {
  if (!collabEnabled()) return 'off'
  const e = bootEntry()
  if (e.plan) return 'plan'
  if (e.delivery) return 'delivery'
  if (e.roomBrief) return 'room'
  return 'off'
}

function planUrl(id: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ plan: id, ...extra })
  return `${location.pathname}?${q.toString()}`
}

export function CollabProvider({ children }: { children: ReactNode }) {
  const api = useEngine()
  const { t } = useI18n()
  const mode = useMemo(modeOf, [])
  const [status, setStatus] = useState<CollabStatus>(mode === 'off' ? 'ready' : 'loading')
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [session, setSession] = useState<PlanSession | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [placingPin, setPlacingPin] = useState(false)
  const [pinDraft, setPinDraft] = useState<Anchor | null>(null)
  const [activeThread, setActiveThread] = useState<number | null>(null)
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [delivery, setDelivery] = useState<DeliveryState | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [readAt, setReadAt] = useState(0)
  const nudgeSeen = useRef(new Map<number, number>())
  const bump = useCallback(() => setRev(n => n + 1), [])

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
    setStatus('error')
  }, [])

  /** 打开以后的操作出错（断网时取评论之类）：提示出来，方案照常能用 */
  const report = useCallback((err: unknown) => {
    api.notify(err instanceof Error ? err.message : String(err), 'err')
  }, [api])

  const refreshThreads = useCallback(async () => {
    const id = bootEntry().plan
    if (!id) return
    setThreads(await collabApi.threads(id))
  }, [])

  const refreshVersions = useCallback(async () => {
    const id = bootEntry().plan
    if (!id) return
    setVersions(await collabApi.versions(id))
  }, [])

  /** 告诉在线的其他人评论、版本有变化，让他们重新取一遍 */
  const nudge = useCallback(() => {
    if (!session) return
    const aw = session.provider.awareness
    const n = Number(aw.getLocalState()?.nudge || 0) + 1
    aw.setLocalStateField('nudge', n)
  }, [session])

  // —— 打开 ——
  useEffect(() => {
    if (!api.ready || mode === 'off') return
    const e = bootEntry()
    let dead = false
    let opened: PlanSession | null = null
    void (async () => {
      try {
        if (mode === 'plan') {
          const id = e.plan as string
          if (e.invite) {
            const peek = await collabApi.plan(id)
            if (!peek.me) { if (!dead) setStatus('needLogin'); return }
            await collabApi.join(e.invite)
            dropParam('invite')
          }
          const s = await PlanSession.open(id)
          if (dead) { s.destroy(); return }
          opened = s
          setReadAt(s.plan.me?.lastReadAt || 0)
          api.attachDoc({ local: s.local, name: s.name, readOnly: !s.canEdit, idTag: s.idTag })
          s.subscribe(bump)
          setSession(s)
          const [th, vs] = await Promise.all([collabApi.threads(id), collabApi.versions(id)])
          if (dead) return
          setThreads(th)
          setVersions(vs)
          setStatus('ready')
        } else if (mode === 'delivery') {
          const token = e.delivery as string
          const d = await collabApi.delivery(token)
          if (dead) return
          const m = new BuildModel()
          if (!m.loadJSON(d.data).ok) throw new Error(t('collab.badModel'))
          api.attachDoc({ local: memoryDoc(m.toJSON() as ModelJSON), name: String(d.planName || ''), readOnly: true, idTag: '' })
          setDelivery({ token, supersededBy: d.supersededBy })
          setStatus('ready')
        } else if (mode === 'room') {
          const id = e.roomBrief as string
          const b = await collabApi.brief(id)
          if (dead) return
          setRoom({ briefId: id, room: b.room || { w: 300, d: 400, h: 240 } })
          setStatus('ready')
        }
      } catch (err) {
        if (!dead) fail(err)
      }
    })()
    return () => {
      dead = true
      opened?.destroy()
    }
    // 只在引擎就绪时打开一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.ready, mode])

  // 角色变了（重连后取到新的方案信息）：能不能编辑跟着变
  const canEdit = !!session && canEditRole(session.plan.myRole)
  useEffect(() => {
    if (!session) return
    if (api.readOnly === !canEdit) return
    api.setReadOnly(!canEdit)
  }, [session, canEdit, api])

  // 自己选中的零件放进在线状态
  useEffect(() => {
    if (!session) return
    const b = api.engine()?.builder
    if (!b) return
    session.setSelection([...(b.selection as Map<string, string>).keys()].map(String))
  }, [session, api, api.tick])

  // 别人选中的零件在画面上按他的颜色标出来；别人发了评论、存了版本就重新取
  const peers = session ? session.peers() : []
  const tintKey = peers.map(p => `${p.user?.userId}:${p.selection.join(',')}`).join('|')
  useEffect(() => {
    const b = api.engine()?.builder
    if (!b || !session || compare) return
    const tints = new Map<string, string>()
    for (const p of session.peers()) {
      const color = p.user?.color || peerColor(p.clientId)
      for (const id of p.selection) tints.set(id, color)
    }
    b.tints = tints.size ? tints : null
    b.refresh()
    // tintKey 概括了所有人的选中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tintKey, session, compare])

  useEffect(() => {
    if (!session) return
    let changed = false
    session.provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === session.provider.awareness.clientID) return
      const n = Number(state.nudge || 0)
      if (nudgeSeen.current.get(clientId) !== n) {
        if (nudgeSeen.current.has(clientId)) changed = true
        nudgeSeen.current.set(clientId, n)
      }
    })
    if (changed) Promise.all([refreshThreads(), refreshVersions()]).catch(report)
  }, [rev, session, refreshThreads, refreshVersions, report])

  // —— 对照 ——
  const loadSide = useCallback(async (id: string): Promise<{ json: ModelJSON; name: string }> => {
    if (!session) throw new Error('no plan')
    if (id === 'current') return { json: session.toJSON(), name: t('collab.current') }
    // 评论者复制出去改的那一份：用它交上来的 data
    if (id.startsWith('fork:')) {
      const p = await collabApi.plan(id.slice('fork:'.length))
      const m = new BuildModel()
      if (!p.data || !m.loadJSON(p.data).ok) throw new Error(t('collab.badModel'))
      return { json: m.toJSON() as ModelJSON, name: p.name }
    }
    const v = await collabApi.version(session.id, id)
    return { json: docToJSON(docFromBase64(v.state)), name: v.name }
  }, [session, t])

  const buildCompare = useCallback(async (a: string, b: string) => {
    const [l, r] = await Promise.all([loadSide(a), loadSide(b)])
    setCompare({ ids: [a, b], names: [l.name, r.name], left: l.json, right: r.json, diff: diffModels(l.json, r.json), bom: diffBom(l.json, r.json) })
  }, [loadSide])

  useEffect(() => {
    const cmp = bootEntry().compare
    if (!session || !cmp || compare) return
    void buildCompare(cmp[0], cmp[1]).catch(fail)
  }, [session, compare, buildCompare, fail])

  // 对照「当前」一边时，别人改了跟着更新
  useEffect(() => {
    if (!compare || !session || !compare.ids.includes('current')) return
    void buildCompare(compare.ids[0], compare.ids[1]).catch(fail)
    // 只跟文档变化走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.tick])

  const openCompare = useCallback((a: string, b: string) => {
    if (!session) return
    history.replaceState(null, '', planUrl(session.id, { compare: `${a},${b}` }))
    void buildCompare(a, b).catch(fail)
  }, [session, buildCompare, fail])

  const closeCompare = useCallback(() => {
    dropParam('compare')
    setCompare(null)
  }, [])

  // —— 评论 ——
  const me = session?.plan.me || null
  const isUnread = useCallback((p: Post) => !!me && p.userId !== me.userId && p.createdAt > readAt, [me, readAt])
  const unread = useMemo(() => {
    let pins = 0, chat = 0
    for (const th of threads) {
      const n = th.posts.filter(isUnread).length
      if (th.kind === 'chat') chat += n
      else pins += n
    }
    return { pins, chat }
  }, [threads, isUnread])

  const markRead = useCallback(async () => {
    if (!session || !me) return
    await collabApi.read(session.id)
    setReadAt(Date.now())
  }, [session, me])

  const upload = useCallback(async (files: File[]) => {
    if (!session) throw new Error('no plan')
    const out: string[] = []
    for (const f of files) out.push((await collabApi.photo(session.id, f)).path)
    return out
  }, [session])

  // 写评论时所在的版本：最近存的那一版
  const currentVersionId = versions.length
    ? versions.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id
    : null

  const addPin = useCallback(async (anchor: Anchor, body: string, files: File[]) => {
    if (!session) return
    const photos = await upload(files)
    await collabApi.newThread(session.id, { anchor, versionId: currentVersionId, body, photos, refs: [] })
    setPinDraft(null)
    await refreshThreads()
    nudge()
  }, [session, upload, currentVersionId, refreshThreads, nudge])

  const reply = useCallback(async (tid: number, body: string, files: File[], refs: Ref[]) => {
    const photos = await upload(files)
    await collabApi.reply(tid, { body, photos, refs })
    await refreshThreads()
    nudge()
  }, [upload, refreshThreads, nudge])

  const resolve = useCallback(async (tid: number, resolved: boolean) => {
    if (resolved) await collabApi.resolve(tid)
    else await collabApi.reopen(tid)
    await refreshThreads()
    nudge()
  }, [refreshThreads, nudge])

  const partGone = useCallback((th: Thread) => {
    const pid = th.anchor?.partId
    if (!pid) return false
    const m = api.engine()?.model
    if (!m) return false
    return !(m.nodes.has(pid) || m.tubes.has(pid) || m.panels.has(pid) || m.clamps.has(pid)
      || m.textiles.has(pid) || m.fittings.has(pid) || m.slides.has(pid))
    // tick：零件增删以后重新算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, api.tick])

  const pinOrder = useMemo(() => {
    const ids = threads.filter(th => th.kind === 'pin').map(th => th.id).sort((a, b) => a - b)
    return new Map(ids.map((id, i) => [id, i + 1]))
  }, [threads])
  const pinNumber = useCallback((th: Thread) => pinOrder.get(th.id) || 0, [pinOrder])

  const [myForks, setMyForks] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!session?.plan.me) return
    collabApi.mine().then(list => setMyForks(list.filter(p => p.role === 'owner' && p.id !== session.id).map(p => ({ id: p.id, name: p.name })))).catch(report)
  }, [session, report])

  const focusThread = useCallback((th: Thread) => {
    setActiveThread(th.id)
    if (th.anchor) api.engine()?.scene.flyToPoint(th.anchor.point)
  }, [api])

  // —— 版本、成员、复制、交付 ——
  const saveVersion = useCallback(async (name: string) => {
    if (!session) throw new Error('no plan')
    const v = await session.saveVersion(name)
    await refreshVersions()
    nudge()
    return v
  }, [session, refreshVersions, nudge])

  const inviteUrl = useCallback(async () => {
    if (!session) throw new Error('no plan')
    return (await collabApi.invite(session.id)).url
  }, [session])

  const shareUrl = useCallback(() => {
    if (!session) return ''
    return `${location.origin}${planUrl(session.id, { src: `plan:${session.id}` })}`
  }, [session])

  const setRole = useCallback(async (userId: number, role: Role) => {
    if (!session) return
    await collabApi.setRole(session.id, userId, role)
    await session.refresh()
  }, [session])

  const removeMember = useCallback(async (userId: number) => {
    if (!session) return
    await collabApi.removeMember(session.id, userId)
    await session.refresh()
  }, [session])

  const fork = useCallback(async (versionId: number | null) => {
    if (!session) return
    const { planId } = await collabApi.fork(session.id, versionId)
    location.href = planUrl(planId)
  }, [session])

  const metricsOf = useCallback(async (versionId: number) => {
    if (!session) throw new Error('no plan')
    const v = await collabApi.version(session.id, versionId)
    const m = new BuildModel()
    if (!m.loadJSON(docToJSON(docFromBase64(v.state))).ok) throw new Error(t('collab.badModel'))
    return computeMetrics(m) as Metrics
  }, [session, t])

  const deliver = useCallback(async (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics }) => {
    if (!session) throw new Error('no plan')
    await session.exportNow()
    const { token } = await collabApi.deliver(session.id, o)
    return token
  }, [session])

  // —— 房间 ——
  const saveRoom = useCallback(async (r: Room) => {
    if (!room) return
    await collabApi.saveRoom(room.briefId, r)
    location.href = `/brief.html?id=${encodeURIComponent(room.briefId)}`
  }, [room])

  // —— 自己的造型开启共享 ——
  const enableSharing = useCallback(async () => {
    // 先存一下：方案的 id 就是这份存档的 id
    const saved = await api.saveCurrent()
    if (!saved) return
    const body = exportOf(saved.data, saved.name)
    await collabApi.createPlan({ id: saved.docId, name: saved.name, data: body.data, qdf: body.qdf, parts: body.parts })
    location.href = planUrl(saved.docId)
  }, [api])

  const loginUrl = useCallback(() => {
    const base = import.meta.env.VITE_LOGIN_URL
    if (!base) throw new Error('VITE_LOGIN_URL is not set')
    return `${base}?next=${encodeURIComponent(location.pathname + location.search)}`
  }, [])

  const value: CollabApi = {
    enabled: collabEnabled(),
    mode, status, error, rev, session,
    plan: session?.plan || null,
    role: session?.plan.myRole || 'guest',
    canEdit,
    canDeliver: !!session?.canDeliver,
    members: session?.plan.members || [],
    peers,
    threads, versions, isUnread, unread, markRead, refreshThreads, refreshVersions,
    placingPin, setPlacingPin, pinDraft, setPinDraft, addPin, reply, resolve, partGone, pinNumber, myForks, focusThread,
    activeThread, setActiveThread,
    saveVersion, inviteUrl, shareUrl, setRole, removeMember, fork, metricsOf, deliver,
    compare, openCompare, closeCompare,
    delivery, room, saveRoom, enableSharing, loginUrl, report,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCollab() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCollab')
  return ctx
}

export type { Opening }
