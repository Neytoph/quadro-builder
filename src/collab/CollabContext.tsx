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
import { computeMetrics, BuildModel, storage } from '../engine-api'
import { useI18n } from '../i18n'
import { ApiError, collabApi, collabEnabled, type Anchor, type InviteInfo, type InviteRole, type Metrics, type Plan, type Post, type Ref, type Role, type Room, type Thread, type VersionInfo } from './api'
import { canEditRole, docFromBase64, exportOf, memberColor, PlanSession, type Peer } from './planSession'
import { memoryDoc } from './localDocs'
import { docToJSON, type ModelJSON } from './ymodel'
import { diffBom, diffModels, type BomDiffRow, type ModelDiff } from './compare'
import { ScopedRequests } from './scopedRequests'

export type CollabMode = 'off' | 'plan' | 'delivery' | 'room' | 'snapshot'

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
  info: InviteInfo
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
  inviteUrl: (role?: InviteRole) => Promise<string>
  viewUrl: () => string
  setRole: (userId: number, role: Role) => Promise<void>
  removeMember: (userId: number) => Promise<void>
  fork: (versionId: number | null) => Promise<void>
  metricsOf: (versionId: number) => Promise<Metrics>
  deliver: (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics; renders: string[] }) => Promise<string>
  compare: CompareState | null
  openCompare: (a: string, b: string) => void
  closeCompare: () => void
  /** 某一版的造型（对照、查零件删在哪一版） */
  versionModel: (id: string) => Promise<ModelJSON>
  delivery: DeliveryState | null
  room: RoomState | null
  saveRoom: (room: Room) => Promise<void>
  /** 点击时复制当前实际造型，服务端创建独立方案。 */
  enableSharing: (name: string, blank: boolean) => Promise<void>
  createdPlan: { id: string; name: string; coverError?: string } | null
  recoverCreatedPlan: () => void
  retryCover: () => Promise<void>
  inviteOpenId: string | null
  closeInvite: () => void
  coachBlocked: boolean
  setSharingDialogOpen: (open: boolean) => void
  holdModal: () => () => void
  openPlan: (planId: string) => Promise<void>
  joinAsk: JoinAsk | null
  inviteError: string | null
  dismissInviteError: () => void
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
  const [threadResult, setThreadResult] = useState<{ plan: string | null; epoch: number; items: Thread[] }>({ plan: null, epoch: 0, items: [] })
  const [versionResult, setVersionResult] = useState<{ plan: string | null; epoch: number; items: VersionInfo[] }>({ plan: null, epoch: 0, items: [] })
  const [placingPin, setPlacingPin] = useState(false)
  const [pinDraft, setPinDraft] = useState<Anchor | null>(null)
  const [activeThread, setActiveThread] = useState<number | null>(null)
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [delivery, setDelivery] = useState<DeliveryState | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [readAt, setReadAt] = useState<Record<string, number>>({})
  const [myPlans, setMyPlans] = useState<Array<{ id: string; name: string; role: Role }>>([])
  const [joinAsk, setJoinAsk] = useState<JoinAsk | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteOpenId, setInviteOpenId] = useState<string | null>(null)
  // 入口弹窗加载期间也先保留首次引导，避免方案先到而邀请窗尚未打开。
  const [sharingDialogOpen, setSharingDialogOpen] = useState(() => !!entry.createShared || (!!entry.plan && new URLSearchParams(location.search).get('inviteManage') === '1'))
  const [modalCount, setModalCount] = useState(0)
  const holdModal = useCallback(() => {
    setModalCount(count => count + 1)
    return () => setModalCount(count => count - 1)
  }, [])
  const [createdPlan, setCreatedPlan] = useState<{ id: string; name: string; coverError?: string } | null>(() => {
    const pending = localStorage.getItem(storage.accountKey('quadro.shared.created'))
    return pending ? JSON.parse(pending) : null
  })
  const createdRef = useRef(createdPlan)
  const creating = useRef(false)
  // 地址上带着邀请：加入以前先不连这个方案。上次看过它的话标签页会恢复出来，
  // 抢在加入之前按访客连上，加入以后还是只读
  const [joining, setJoining] = useState(!!entry.invite)
  const nudgeSeen = useRef(new Map<number, number>())

  // 引擎那边这几样是稳定的，下面的回调和副作用只依赖它们，不依赖每次渲染都换新的 api
  const { notify, tabLocal, setTabAccess, setTabName, openPlanTab, engine, tick } = api
  const report = useCallback((err: unknown) => { notify(errText(err), 'err') }, [notify])

  const activeTab = api.tabs.find(x => x.tabId === api.activeTabId) || null
  const activePlanId = activeTab?.planId || null
  const planGeneration = useRef(new ScopedRequests()).current
  planGeneration.select(activePlanId)
  const threads = threadResult.plan === activePlanId && threadResult.epoch === planGeneration.current.epoch ? threadResult.items : []
  const versions = versionResult.plan === activePlanId && versionResult.epoch === planGeneration.current.epoch ? versionResult.items : []
  useEffect(() => {
    planGeneration.select(activePlanId)
    return () => {
      planGeneration.cancel()
      planGeneration.current = { id: null, epoch: planGeneration.current.epoch + 1 }
    }
  }, [activePlanId, planGeneration])
  // 方案导出时截封面要看的是那一刻：哪个方案开在画面上、截图用哪一份引擎接口
  const shotRef = useRef({ activePlanId, coverShot: api.coverShot })
  shotRef.current = { activePlanId, coverShot: api.coverShot }
  const session = activePlanId ? sessions.current.get(activePlanId) || null : null
  // rev 随每个连接的变化走，让下面读 session 的地方跟着刷新
  void rev

  const mode: CollabMode = !enabled ? 'off'
    : entry.version ? 'snapshot'
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
      if (joining && (!entry.plan || planId === entry.plan)) continue
      loading.current.add(planId)
      collabApi.plan(planId).then((plan) => {
        const local = tabLocal(tabId)
        if (!local) return
        const s = new PlanSession(plan, local)
        // 页面在后台时浏览器不出帧，截图等不到，这一次不带封面
        s.cover = async () => (shotRef.current.activePlanId === planId && document.visibilityState === 'visible'
          ? shotRef.current.coverShot() : null)
        sessions.current.set(planId, s)
        setErrors(e => { const next = { ...e }; delete next[planId]; return next })
        setReadAt(r => ({ ...r, [planId]: plan.me?.lastReadAt || 0 }))
        s.subscribe(bump)
        setTabAccess(tabId, { readOnly: !s.canEdit, idTag: s.idTag })
        bump()
      }).catch((err) => {
        setErrors(e => ({ ...e, [planId]: errText(err) }))
      }).finally(() => { loading.current.delete(planId) })
    }
  }, [enabled, api.ready, api.tabs, tabLocal, setTabAccess, bump, joining, entry.plan])

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
    if (!name.trim() || Array.from(name.trim()).length > 40) { notify(t('collab.create.nameLimit'), 'err'); return }
    s.rename(name)
  }, [notify, t])

  // 地址栏跟着当前标签页：共享方案显示它的地址，刷新以后还是这个方案
  useEffect(() => {
    if (!enabled || !api.ready || joining || joinAsk || mode === 'delivery' || mode === 'room' || mode === 'snapshot') return
    const q = new URLSearchParams(location.search)
    if (activePlanId) {
      if (q.get('plan') === activePlanId) return
      history.replaceState(null, '', planUrl(activePlanId, q.get('inviteManage') === '1' ? { inviteManage: '1' } : {}))
    } else if (q.has('plan') || q.has('compare')) {
      dropParam('plan')
      dropParam('compare')
    }
  }, [enabled, api.ready, activePlanId, mode, joining, joinAsk])

  // —— 打开：地址上带着方案（邀请、分享链接），交付查看，画房间 ——
  const opened = useRef(false)
  useEffect(() => {
    if (!enabled || !api.ready || opened.current) return
    opened.current = true
    void (async () => {
      try {
        if (entry.version && entry.plan) {
          const v = await collabApi.version(entry.plan, entry.version)
          const m = new BuildModel()
          if (!m.loadJSON(v.data).ok) throw new Error(t('collab.badModel'))
          const scene = engine()?.scene
          scene?.setMotion(false)
          api.attachDoc({ local: memoryDoc(m.toJSON() as ModelJSON), name: v.name, readOnly: true })
          scene?.setScene(false)
          scene?.resetCamera(m, { animate: false })
          return
        }
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
        if (entry.invite) {
          const info = await collabApi.inviteInfo(entry.invite)
          const plan = await collabApi.plan(info.planId)
          if (!plan.me) { setJoinAsk({ plan, invite: entry.invite, info }); setJoining(false); return }
          const joined = await collabApi.join(entry.invite)
          // 已作为访客打开过：加入后重新建立具有实际成员权限的连接。
          const old = sessions.current.get(joined.planId)
          if (old) { old.destroy(); sessions.current.delete(joined.planId) }
          setJoining(false)
          dropParam('invite')
          const actual = await collabApi.plan(joined.planId)
          api.openPlanTab(actual.id, actual.name)
          api.notify(t('collab.create.joined', { role: t(`collab.role.${actual.myRole}`) }))
          return
        }
        if (!entry.plan) return
        const plan = await collabApi.plan(entry.plan)
        api.openPlanTab(plan.id, plan.name)
      } catch (err) {
        setJoining(false)
        if (entry.invite) setInviteError(errText(err))
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
  const dismissInviteError = useCallback(() => { setInviteError(null); dropParam('invite') }, [])

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
    await planGeneration.run(activePlanId, 'threads', signal => collabApi.threads(activePlanId, signal),
      (items, epoch) => setThreadResult({ plan: activePlanId, epoch, items }))
  }, [activePlanId, planGeneration])

  const refreshVersions = useCallback(async () => {
    if (!activePlanId) return
    await planGeneration.run(activePlanId, 'versions', signal => collabApi.versions(activePlanId, signal),
      (items, epoch) => setVersionResult({ plan: activePlanId, epoch, items }))
  }, [activePlanId, planGeneration])

  useEffect(() => {
    setThreadResult({ plan: activePlanId, epoch: planGeneration.current.epoch, items: [] })
    setVersionResult({ plan: activePlanId, epoch: planGeneration.current.epoch, items: [] })
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

  const compareRequest = useRef(0)
  const buildCompare = useCallback(async (a: string, b: string) => {
    const generation = planGeneration.current
    const request = ++compareRequest.current
    const [l, r, ln, rn] = await Promise.all([versionModel(a), versionModel(b), nameOfSide(a), nameOfSide(b)])
    if (generation !== planGeneration.current || request !== compareRequest.current) return
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
    compareRequest.current++
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
    const generation = planGeneration.current
    const photos = await upload(files)
    if (generation !== planGeneration.current || generation.id !== session.id) throw new Error('active plan changed')
    const { id } = await collabApi.newThread(session.id, { anchor, versionId: currentVersionId, body, photos, refs: [] })
    if (generation !== planGeneration.current) return
    setPinDraft(null)
    await refreshThreads()
    if (generation !== planGeneration.current) return
    setActiveThread(id)
    nudge()
  }, [session, upload, currentVersionId, refreshThreads, nudge])

  const reply = useCallback(async (tid: number, body: string, files: File[], refs: Ref[]) => {
    const generation = planGeneration.current
    if (generation.id !== activePlanId || !threads.some(thread => thread.id === tid)) throw new Error('thread is not in the active plan')
    const photos = await upload(files)
    if (generation !== planGeneration.current) throw new Error('active plan changed')
    await collabApi.reply(tid, { body, photos, refs })
    await refreshThreads()
    nudge()
  }, [activePlanId, threads, upload, refreshThreads, nudge])

  const resolve = useCallback(async (tid: number, resolved: boolean) => {
    if (planGeneration.current.id !== activePlanId || !threads.some(thread => thread.id === tid)) throw new Error('thread is not in the active plan')
    if (resolved) await collabApi.resolve(tid)
    else await collabApi.reopen(tid)
    await refreshThreads()
    nudge()
  }, [activePlanId, threads, refreshThreads, nudge])

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
    if (planGeneration.current.id !== activePlanId || !threads.some(thread => thread.id === th.id)) return
    setActiveThread(th.id)
    if (th.anchor) engine()?.scene.flyToPoint(th.anchor.point)
  }, [activePlanId, threads, engine])

  // —— 版本、成员、复制、交付 ——
  const saveVersion = useCallback(async (name: string) => {
    if (!session) throw new Error('no plan')
    const v = await session.saveVersion(name)
    await refreshVersions()
    nudge()
    return v
  }, [session, refreshVersions, nudge])

  const inviteUrl = useCallback(async (role: InviteRole = 'editor') => {
    if (!session) throw new Error('no plan')
    return (await collabApi.invite(session.id, role)).url
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

  const deliver = useCallback(async (o: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics; renders: string[] }) => {
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

  const recoverCreatedPlan = useCallback(() => {
    const p = createdRef.current
    if (!p) return
    openPlanTab(p.id, p.name, true)
    setInviteOpenId(p.id)
  }, [openPlanTab])

  useEffect(() => {
    if (!session || session.id !== createdRef.current?.id || createdRef.current.coverError) return
    localStorage.removeItem(storage.accountKey('quadro.shared.created'))
    createdRef.current = null
    setCreatedPlan(null)
  }, [session])

  const retryCover = useCallback(async () => {
    const pending = createdRef.current
    if (!pending) return
    const target = sessions.current.get(pending.id)
    if (!target) throw new Error(t('collab.loading'))
    const body = target.exportBody()
    const cover = await shotRef.current.coverShot()
    if (!cover) throw new Error(t('collab.create.coverFailed'))
    await collabApi.exportPlan(pending.id, { ...body, cover })
    localStorage.removeItem(storage.accountKey('quadro.shared.created'))
    createdRef.current = null
    setCreatedPlan(null)
    notify(t('collab.create.coverSaved'))
  }, [notify, t])

  const enableSharing = useCallback(async (name: string, blank: boolean) => {
    if (creating.current) return
    if (createdRef.current) { recoverCreatedPlan(); return }
    const current = engine()
    if (!activeTab || !current || !api.entryReady) throw new Error(t('collab.loading'))
    const trimmed = name.trim()
    if (!trimmed || Array.from(trimmed).length > 40) throw new Error(t('collab.create.nameLimit'))
    // 任何 await 之前锁定实际引擎画面，包含未保存的编辑。
    const data = structuredClone((blank ? new BuildModel() : current.model).toJSON()) as ModelJSON
    const body = exportOf(data, trimmed)
    creating.current = true
    try {
      const cover = blank ? null : await shotRef.current.coverShot()
      const result = await collabApi.createPlan({ ...body, ...(blank ? {} : { sourceName: activeTab.name }), ...(cover ? { cover } : {}) })
      const created = { id: result.id, name: trimmed, ...(result.coverError ? { coverError: result.coverError } : {}) }
      createdRef.current = created
      setCreatedPlan(created)
      localStorage.setItem(storage.accountKey('quadro.shared.created'), JSON.stringify(created))
      if (result.coverError) notify(t('collab.create.coverFailed'), 'warn')
      setMyPlans(list => [...list, { ...created, role: 'owner' }])
      recoverCreatedPlan()
    } finally { creating.current = false }
  }, [activeTab, engine, api.entryReady, recoverCreatedPlan, notify, t])

  const loginUrl = useCallback(() => {
    const base = import.meta.env.VITE_LOGIN_URL
    if (!base) throw new Error('VITE_LOGIN_URL is not set')
    const next = new URL(location.href)
    if (entry.invite) { next.searchParams.set('invite', entry.invite); if (entry.plan) next.searchParams.set('plan', entry.plan) }
    if (joinAsk) { next.searchParams.set('invite', joinAsk.invite); next.searchParams.set('plan', joinAsk.info.planId) }
    if (entry.createShared) {
      next.searchParams.set('createShared', '1')
      if (entry.src) next.searchParams.set('src', entry.src)
      if (entry.name) next.searchParams.set('name', entry.name)
      if (entry.blank) next.searchParams.set('new', '1')
      if (entry.doc) next.searchParams.set('doc', entry.doc)
    }
    const login = new URL(base, location.origin)
    login.searchParams.set('next', next.pathname + next.search + next.hash)
    return login.pathname + login.search
  }, [joinAsk, entry])
  const closeInvite = useCallback(() => setInviteOpenId(null), [])

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
    delivery, room, saveRoom, enableSharing, createdPlan, recoverCreatedPlan, retryCover, inviteOpenId, closeInvite, openPlan,
    coachBlocked: sharingDialogOpen || modalCount > 0, setSharingDialogOpen, holdModal,
    joinAsk, inviteError, dismissInviteError, joinAsGuest, loginUrl, report,
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
