// 共享方案在界面这一层的状态和动作。
//
// 共享方案是标签页里的一个：标签页带着方案 id，文档存在本机。这里给每个方案标签页
// 连一条 WebSocket（PlanSession），当前标签页是方案时，评论、版本、成员、对照都跟着它。
// 另有两种只放一座的打开方式：交付查看（?delivery=）和画房间边界（?room=brief:）。
//
// 开源本地版（不设 VITE_SYNC_BASE）什么都不做，界面也不出现。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../store/EngineContext'
import { bootEntry, dropParam } from '../entry'
import { computeMetrics, BuildModel } from '../engine-api'
import { useI18n } from '../i18n'
import { ApiError, collabApi, collabEnabled, type Anchor, type Metrics, type Plan, type Post, type Ref, type Role, type Room, type Thread, type VersionInfo } from './api'
import { canEditRole, docFromBase64, exportOf, memberColor, PlanSession, type Peer } from './planSession'
import { memoryDoc } from './localDocs'
import { docToJSON, type ModelJSON } from './ymodel'
import { diffBom, diffModels, type BomDiffRow, type ModelDiff } from './compare'

export type CollabMode = 'off' | 'plan' | 'delivery' | 'room'

/** 版本对照：左右两边是哪两版、造型、差异。 */
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
  title: string
}

/** 打开邀请链接时还没登录：先看看，或者去登录 */
export interface JoinAsk {
  plan: Plan
  invite: string
}

export const DIFF_COLORS = { added: '#1FA85A', removed: '#E11D48' }

interface CollabApi {
  enabled: boolean
  mode: CollabMode
  /** 当前方案标签页打不开的原因 */
  error: string | null
  rev: number
  session: PlanSession | null
  plan: Plan | null
  role: Role
  canEdit: boolean
  canDeliver: boolean
  peers: Peer[]
  /** 成员的颜色：按加入顺序 */
  colorOf: (userId: number) => string
  threads: Thread[]
  versions: VersionInfo[]
  isUnread: (p: Post) => boolean
  unread: { pins: number; chat: number }
  markRead: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshVersions: () => Promise<void>
  /** 放图钉的工具开着 */
  placingPin: boolean
  setPlacingPin: (on: boolean) => void
  pinDraft: Anchor | null
  setPinDraft: (a: Anchor | null) => void
  addPin: (anchor: Anchor, body: string, files: File[]) => Promise<void>
  reply: (tid: number, body: string, files: File[], refs: Ref[]) => Promise<void>
  resolve: (tid: number, resolved: boolean) => Promise<void>
  partGone: (t: Thread) => boolean
  pinNumber: (t: Thread) => number
  /** 我名下的其他共享方案（复制出去改的那几份），留言时可以引用 */
  myPlans: Array<{ id: string; name: string; role: Role }>
  focusThread: (t: Thread) => void
  activeThread: number | null
  setActiveThread: (id: number | null) => void
  /** 这个方案的标签页能不能改名：创建人、编辑者能改，评论者和访客不能 */
  renamable: (planId: string) => boolean
  /** 方案改名：名字写进文档同步给成员，立即交一次导出 */
  renamePlan: (planId: string, name: string) => void
  saveVersion: (name: string) => Promise<{ id: number }>
  inviteUrl: () => Promise<string>
  viewUrl: () => string
  setRole: (userId: number, role: Role) => Promise<void>
  removeMember: (userId: number) => Promise<void>
  fork: (versionId: number | null) => Promise<void>
  metricsOf: (versionId: number) => Promise<Metrics>
  deliver: (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics }) => Promise<string>
  compare: CompareState | null
  openCompare: (a: string, b: string) => void
  closeCompare: () => void
  /** 某一版的造型（对照、查零件删在哪一版） */
  versionModel: (id: string) => Promise<ModelJSON>
  delivery: DeliveryState | null
  room: RoomState | null
  saveRoom: (room: Room) => Promise<void>
  /** 自己的造型开启共享：当前标签页原地变成共享方案 */
  enableSharing: () => Promise<void>
  /** 打开「我的设计」里的一份：开启过共享的，打开方案标签页 */
  planOfDoc: (docId: string) => boolean
  openPlan: (planId: string) => Promise<void>
  joinAsk: JoinAsk | null
  joinAsGuest: () => void
  loginUrl: () => string
  report: (err: unknown) => void
}

const Ctx = createContext<CollabApi | null>(null)

function planUrl(id: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ plan: id, ...extra })
  return `${location.pathname}?${q.toString()}`
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export function CollabProvider({ children }: { children: ReactNode }) {
  const api = useEngine()
  const { t } = useI18n()
  const enabled = collabEnabled()
  const entry = useMemo(() => bootEntry(), [])
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev(n => n + 1), [])
  const sessions = useRef(new Map<string, PlanSession>())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [threads, setThreads] = useState<Thread[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [placingPin, setPlacingPin] = useState(false)
  const [pinDraft, setPinDraft] = useState<Anchor | null>(null)
  const [activeThread, setActiveThread] = useState<number | null>(null)
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [delivery, setDelivery] = useState<DeliveryState | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [readAt, setReadAt] = useState<Record<string, number>>({})
  const [myPlans, setMyPlans] = useState<Array<{ id: string; name: string; role: Role }>>([])
  const [joinAsk, setJoinAsk] = useState<JoinAsk | null>(null)
  const nudgeSeen = useRef(new Map<number, number>())

  // 引擎那边这几样是稳定的，下面的回调和副作用只依赖它们，不依赖每次渲染都换新的 api
  const { notify, tabLocal, setTabAccess, setTabName, openPlanTab, saveCurrent, convertToPlan, engine, tick } = api
  const report = useCallback((err: unknown) => { notify(errText(err), 'err') }, [notify])

  const activeTab = api.tabs.find(x => x.tabId === api.activeTabId) || null
  const activePlanId = activeTab?.planId || null
  // 方案导出时截封面要看的是那一刻：哪个方案开在画面上、截图用哪一份引擎接口
  const shotRef = useRef({ activePlanId, coverShot: api.coverShot })
  shotRef.current = { activePlanId, coverShot: api.coverShot }
  const session = activePlanId ? sessions.current.get(activePlanId) || null : null
  // rev 随每个连接的变化走，让下面读 session 的地方跟着刷新
  void rev

  const mode: CollabMode = !enabled ? 'off'
    : entry.delivery ? 'delivery'
      : entry.roomBrief ? 'room'
        : activePlanId ? 'plan' : 'off'

  // —— 每个方案标签页一条连接；标签页关了就断开 ——
  const loading = useRef(new Set<string>())
  useEffect(() => {
    if (!enabled || !api.ready) return
    const wanted = new Map(api.tabs.filter(x => x.planId).map(x => [x.planId as string, x.tabId]))
    for (const [planId, s] of sessions.current) {
      if (wanted.has(planId)) continue
      s.destroy()
      sessions.current.delete(planId)
    }
    for (const [planId, tabId] of wanted) {
      if (sessions.current.has(planId) || loading.current.has(planId)) continue
      loading.current.add(planId)
      collabApi.plan(planId).then((plan) => {
        const local = tabLocal(tabId)
        if (!local) return
        const s = new PlanSession(plan, local)
        // 页面在后台时浏览器不出帧，截图等不到，这一次不带封面
        s.cover = async () => (shotRef.current.activePlanId === planId && document.visibilityState === 'visible'
          ? shotRef.current.coverShot() : null)
        sessions.current.set(planId, s)
        setReadAt(r => ({ ...r, [planId]: plan.me?.lastReadAt || 0 }))
        s.subscribe(bump)
        setTabAccess(tabId, { readOnly: !s.canEdit, idTag: s.idTag })
        bump()
      }).catch((err) => {
        setErrors(e => ({ ...e, [planId]: errText(err) }))
      }).finally(() => { loading.current.delete(planId) })
    }
  }, [enabled, api.ready, api.tabs, tabLocal, setTabAccess, bump])

  useEffect(() => () => { for (const s of sessions.current.values()) s.destroy() }, [])

  // 角色变了（重连后取到新的方案信息）：能不能编辑跟着变
  const canEdit = !!session && canEditRole(session.plan.myRole)
  useEffect(() => {
    if (!session || !activeTab) return
    setTabAccess(activeTab.tabId, { readOnly: !canEdit, idTag: session.idTag })
    // 只跟角色走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, canEdit, activeTab?.tabId, setTabAccess])

  // 标签页的名字跟着方案的名字：自己改的、别人改的、服务端取来的
  useEffect(() => {
    for (const tab of api.tabs) {
      const s = tab.planId ? sessions.current.get(tab.planId) : null
      if (s && s.name !== tab.name) setTabName(tab.tabId, s.name)
    }
    setMyPlans(list => {
      const next = list.map(p => {
        const name = sessions.current.get(p.id)?.name
        return name && name !== p.name ? { ...p, name } : p
      })
      return next.some((p, i) => p !== list[i]) ? next : list
    })
  }, [rev, api.tabs, setTabName])

  const renamable = useCallback((planId: string) => !!sessions.current.get(planId)?.canEdit, [])
  const renamePlan = useCallback((planId: string, name: string) => {
    const s = sessions.current.get(planId)
    if (!s) throw new Error(`renamePlan: plan ${planId} is not open`)
    s.rename(name)
  }, [])

  // 地址栏跟着当前标签页：共享方案显示它的地址，刷新以后还是这个方案
  useEffect(() => {
    if (!enabled || !api.ready || mode === 'delivery' || mode === 'room') return
    const q = new URLSearchParams(location.search)
    if (activePlanId) {
      if (q.get('plan') === activePlanId) return
      history.replaceState(null, '', planUrl(activePlanId))
    } else if (q.has('plan') || q.has('compare')) {
      dropParam('plan')
      dropParam('compare')
    }
  }, [enabled, api.ready, activePlanId, mode])

  // —— 打开：地址上带着方案（邀请、分享链接），交付查看，画房间 ——
  const opened = useRef(false)
  useEffect(() => {
    if (!enabled || !api.ready || opened.current) return
    opened.current = true
    void (async () => {
      try {
        if (entry.delivery) {
          const d = await collabApi.delivery(entry.delivery)
          const m = new BuildModel()
          if (!m.loadJSON(d.data).ok) throw new Error(t('collab.badModel'))
          api.attachDoc({ local: memoryDoc(m.toJSON() as ModelJSON), name: String(d.planName || ''), readOnly: true })
          if (entry.assembly) api.setAssembly(true)
          setDelivery({ token: entry.delivery, supersededBy: d.supersededBy })
          return
        }
        if (entry.roomBrief) {
          const b = await collabApi.brief(entry.roomBrief)
          setRoom({ briefId: entry.roomBrief, room: b.room || { w: 300, d: 400, h: 240 }, title: String(b.region || '') })
          return
        }
        if (!entry.plan) return
        const plan = await collabApi.plan(entry.plan)
        if (entry.invite) {
          if (!plan.me) { setJoinAsk({ plan, invite: entry.invite }); return }
          await collabApi.join(entry.invite)
          dropParam('invite')
          api.notify(t('collab.join.joined'))
        }
        api.openPlanTab(plan.id, plan.name)
      } catch (err) {
        if (entry.plan) setErrors(e => ({ ...e, [entry.plan as string]: errText(err) }))
        else report(err)
      }
    })()
    // 只在引擎就绪时打开一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, api.ready])

  const joinAsGuest = useCallback(() => {
    if (!joinAsk) return
    dropParam('invite')
    openPlanTab(joinAsk.plan.id, joinAsk.plan.name)
    setJoinAsk(null)
  }, [joinAsk, openPlanTab])

  // 我参与的方案：「我的设计」里开启过共享的那几份打开方案标签页；留言引用复制件
  useEffect(() => {
    if (!enabled || !api.ready) return
    collabApi.mine().then(list => setMyPlans(list.map(p => ({ id: p.id, name: p.name, role: p.role }))))
      // 没登录：没有「我参与的方案」
      .catch(err => { if (err instanceof ApiError && err.status === 401) setMyPlans([]); else report(err) })
  }, [enabled, api.ready, activePlanId, report])

  // —— 当前方案的评论和版本 ——
  const refreshThreads = useCallback(async () => {
    if (!activePlanId) return
    setThreads(await collabApi.threads(activePlanId))
  }, [activePlanId])

  const refreshVersions = useCallback(async () => {
    if (!activePlanId) return
    setVersions(await collabApi.versions(activePlanId))
  }, [activePlanId])

  useEffect(() => {
    setThreads([])
    setVersions([])
    setActiveThread(null)
    setPinDraft(null)
    setPlacingPin(false)
    setCompare(null)
    if (!activePlanId) return
    Promise.all([refreshThreads(), refreshVersions()]).catch(report)
  }, [activePlanId, refreshThreads, refreshVersions, report])

  /** 告诉在线的其他人评论、版本有变化，让他们重新取一遍 */
  const nudge = useCallback(() => {
    if (!session) return
    const aw = session.provider.awareness
    aw.setLocalStateField('nudge', Number(aw.getLocalState()?.nudge || 0) + 1)
  }, [session])

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

  // 自己选中的零件放进在线状态
  useEffect(() => {
    if (!session) return
    const b = engine()?.builder
    if (!b) return
    session.setSelection([...(b.selection as Map<string, string>).keys()].map(String))
  }, [session, engine, tick])

  const peers = session ? session.peers() : []
  const members = session?.plan.members || []
  const colorOf = useCallback((userId: number) => memberColor(members, userId), [members])

  // —— 对照 ——
  const fetchVersionModel = useCallback(async (planId: string, id: string): Promise<ModelJSON> => {
    const load = (data: unknown) => {
      const m = new BuildModel()
      if (!data || !m.loadJSON(data).ok) throw new Error(t('collab.badModel'))
      return m.toJSON() as ModelJSON
    }
    // 评论者复制出去改的那一份：用它交上来的 data
    if (id.startsWith('fork:')) return load((await collabApi.plan(id.slice('fork:'.length))).data)
    const v = await collabApi.version(planId, id)
    // 参考方案那一条没有 Yjs 状态，只有 data
    return v.state ? docToJSON(docFromBase64(v.state)) : load(v.data)
  }, [t])

  // 存下的版本不会再变，取过一次就记着；复制件还会改，每次重取
  const versionCache = useRef(new Map<string, ModelJSON>())
  const versionModel = useCallback(async (id: string): Promise<ModelJSON> => {
    if (!session) throw new Error('no plan')
    if (id === 'current') return session.toJSON()
    const key = `${session.id}:${id}`
    const hit = versionCache.current.get(key)
    if (hit) return hit
    const json = await fetchVersionModel(session.id, id)
    if (!id.startsWith('fork:')) versionCache.current.set(key, json)
    return json
  }, [session, fetchVersionModel])

  const nameOfSide = useCallback(async (id: string) => {
    if (id === 'current') return t('collab.version.now')
    if (id.startsWith('fork:')) return myPlans.find(p => `fork:${p.id}` === id)?.name || (await collabApi.plan(id.slice(5))).name
    return versions.find(v => String(v.id) === id)?.name || id
  }, [t, myPlans, versions])

  const buildCompare = useCallback(async (a: string, b: string) => {
    const [l, r, ln, rn] = await Promise.all([versionModel(a), versionModel(b), nameOfSide(a), nameOfSide(b)])
    setCompare({ ids: [a, b], names: [ln, rn], left: l, right: r, diff: diffModels(l, r), bom: diffBom(l, r) })
  }, [versionModel, nameOfSide])

  // 地址上带着 compare：方案连上、版本列表到了以后打开
  const entryCompare = useRef(entry.compare)
  useEffect(() => {
    const cmp = entryCompare.current
    if (!session || !cmp || session.id !== entry.plan || !session.synced) return
    entryCompare.current = null
    buildCompare(cmp[0], cmp[1]).catch(report)
  }, [session, rev, versions, buildCompare, report, entry.plan])

  // 对照「当前」一边时，别人改了跟着更新
  useEffect(() => {
    if (!compare || !compare.ids.includes('current')) return
    buildCompare(compare.ids[0], compare.ids[1]).catch(report)
    // 只跟文档变化走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const openCompare = useCallback((a: string, b: string) => {
    if (!session) return
    history.replaceState(null, '', planUrl(session.id, { compare: `${a},${b}` }))
    buildCompare(a, b).catch(report)
  }, [session, buildCompare, report])

  const closeCompare = useCallback(() => {
    dropParam('compare')
    setCompare(null)
  }, [])

  // —— 评论 ——
  const me = session?.plan.me || null
  const seenAt = activePlanId ? readAt[activePlanId] || 0 : 0
  const isUnread = useCallback((p: Post) => !!me && p.userId !== me.userId && p.createdAt > seenAt, [me, seenAt])
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
    setReadAt(r => ({ ...r, [session.id]: Date.now() }))
  }, [session, me])

  const upload = useCallback(async (files: File[]) => {
    if (!session) throw new Error('no plan')
    const out: string[] = []
    for (const f of files) out.push((await collabApi.photo(session.id, f)).path)
    return out
  }, [session])

  // 写评论时所在的版本：最近存的那一版
  const currentVersionId = useMemo(() => {
    const own = versions.filter(v => v.kind !== 'reference')
    return own.length ? own.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id : null
  }, [versions])

  const addPin = useCallback(async (anchor: Anchor, body: string, files: File[]) => {
    if (!session) return
    const photos = await upload(files)
    const { id } = await collabApi.newThread(session.id, { anchor, versionId: currentVersionId, body, photos, refs: [] })
    setPinDraft(null)
    await refreshThreads()
    setActiveThread(id)
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
    const m = engine()?.model
    if (!m) return false
    return !(m.nodes.has(pid) || m.tubes.has(pid) || m.panels.has(pid) || m.clamps.has(pid)
      || m.textiles.has(pid) || m.fittings.has(pid) || m.slides.has(pid))
    // tick：零件增删以后重新算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tick])

  const pinOrder = useMemo(() => {
    const ids = threads.filter(th => th.kind === 'pin').map(th => th.id).sort((a, b) => a - b)
    return new Map(ids.map((id, i) => [id, i + 1]))
  }, [threads])
  const pinNumber = useCallback((th: Thread) => pinOrder.get(th.id) || 0, [pinOrder])

  const focusThread = useCallback((th: Thread) => {
    setActiveThread(th.id)
    if (th.anchor) engine()?.scene.flyToPoint(th.anchor.point)
  }, [engine])

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

  const viewUrl = useCallback(() => {
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

  const openPlan = useCallback(async (planId: string) => {
    const p = await collabApi.plan(planId)
    openPlanTab(p.id, p.name)
  }, [openPlanTab])

  const fork = useCallback(async (versionId: number | null) => {
    if (!session) return
    const { planId } = await collabApi.fork(session.id, versionId)
    await openPlan(planId)
  }, [session, openPlan])

  const metricsOf = useCallback(async (versionId: number) => {
    const m = new BuildModel()
    if (!m.loadJSON(await versionModel(String(versionId))).ok) throw new Error(t('collab.badModel'))
    return computeMetrics(m) as Metrics
  }, [versionModel, t])

  const deliver = useCallback(async (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics }) => {
    if (!session) throw new Error('no plan')
    await session.exportNow()
    const { token } = await collabApi.deliver(session.id, o)
    await refreshVersions()
    nudge()
    return token
  }, [session, refreshVersions, nudge])

  // —— 房间 ——
  const saveRoom = useCallback(async (r: Room) => {
    if (!room) return
    await collabApi.saveRoom(room.briefId, r)
    location.href = `/brief.html?id=${encodeURIComponent(room.briefId)}`
  }, [room])

  // —— 自己的造型开启共享：原地变成共享方案 ——
  const enableSharing = useCallback(async () => {
    const tab = activeTab
    if (!tab || tab.planId) return
    // 先存一下：方案的 id 就是这份存档的 id
    const saved = await saveCurrent()
    if (!saved) return
    const body = exportOf(saved.data, saved.name)
    await collabApi.createPlan({ id: saved.docId, name: saved.name, data: body.data, qdf: body.qdf, parts: body.parts })
    // 开启共享的这一刻画面上就是这一座：截一张交上去当方案封面
    const cover = await shotRef.current.coverShot()
    if (cover) await collabApi.exportPlan(saved.docId, { ...body, cover })
    convertToPlan(tab.tabId, saved.docId, saved.name)
    setMyPlans(list => [...list, { id: saved.docId, name: saved.name, role: 'owner' }])
  }, [activeTab, saveCurrent, convertToPlan])

  const planOfDoc = useCallback((docId: string) => myPlans.some(p => p.id === docId), [myPlans])

  const loginUrl = useCallback(() => {
    const base = import.meta.env.VITE_LOGIN_URL
    if (!base) throw new Error('VITE_LOGIN_URL is not set')
    return `${base}?next=${encodeURIComponent(location.pathname + location.search)}`
  }, [])

  const value: CollabApi = {
    enabled, mode,
    error: activePlanId ? errors[activePlanId] || null : entry.plan && !activePlanId ? errors[entry.plan] || null : null,
    rev, session,
    plan: session?.plan || null,
    role: session?.plan.myRole || 'guest',
    canEdit,
    canDeliver: !!session?.canDeliver,
    peers, colorOf,
    threads, versions, isUnread, unread, markRead, refreshThreads, refreshVersions,
    placingPin, setPlacingPin, pinDraft, setPinDraft, addPin, reply, resolve, partGone, pinNumber, myPlans, focusThread,
    activeThread, setActiveThread,
    renamable, renamePlan,
    saveVersion, inviteUrl, viewUrl, setRole, removeMember, fork, metricsOf, deliver,
    compare, openCompare, closeCompare, versionModel,
    delivery, room, saveRoom, enableSharing, planOfDoc, openPlan,
    joinAsk, joinAsGuest, loginUrl, report,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCollab() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCollab')
  return ctx
}

/** 这个人是不是方案里接单的设计师（可以锁定交付的那位） */
export function isDesigner(plan: Plan | null, userId: number) {
  return !!plan && plan.members.some(m => m.userId === userId && m.canDeliver && m.role !== 'owner')
}
