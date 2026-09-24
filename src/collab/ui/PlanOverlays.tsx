import { useEffect, useRef, useState } from 'react'
import { Eye, GitFork, MessageSquare, TriangleAlert } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { BuildModel } from '../../engine-api'
import { UI_ESCAPE_EVENT } from '../../ui/events'
import { isDesigner, useCollab } from '../CollabContext'
import { mediaUrl, type Anchor, type Thread } from '../api'
import type { Peer } from '../planSession'
import { Face, partLabel, when } from './bits'
import { Compose } from './Compose'
import { ForkModal } from './Modals'

type P3 = [number, number, number]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any

/** 一件零件在画面里要框住的那几个点：接头取中心，管取两端，板取四角。 */
function partPoints(model: E, id: string): P3[] {
  const n = model.nodes.get(id)
  if (n) return [[n.x, n.y, n.z]]
  const tb = model.tubes.get(id)
  if (tb) {
    const a = model.nodes.get(tb.a), b = model.nodes.get(tb.b)
    return a && b ? [[a.x, a.y, a.z], [b.x, b.y, b.z]] : []
  }
  const p = model.panels.get(id) || model.textiles.get(id)
  if (p) return (model.panelCorners(p) as P3[] | null) || []
  const f = model.fittings.get(id) || model.slides.get(id) || model.clamps.get(id)
  return f ? [[f.x, f.y, f.z]] : []
}

/**
 * 画面上的共享标记：别人选中的零件套一个他颜色的框、位置评论的图钉和讨论气泡、
 * 放新图钉、左下角的同步状态、别人刚改完的那一条提示、只读提示条。
 * 位置每一帧按镜头重新投影，直接改样式，不经过 React。
 */
export default function PlanOverlays() {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const items = useRef(new Map<string, { el: HTMLElement; pts: () => P3[]; box: boolean }>())
  const [fork, setFork] = useState(false)
  const s = collab.session

  // 每一帧：图钉摆到那一点，选中框框住那几件零件；转到背后、出了画面的藏起来
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = api.engine()
      const host = document.getElementById('canvas-host')
      if (!e || !host) return
      const r = host.getBoundingClientRect()
      for (const it of items.current.values()) {
        const pts = it.pts()
        const proj = pts.length ? (e.scene.projectWorld(pts) as Array<{ u: number; v: number } | null>).filter(Boolean) as Array<{ u: number; v: number }> : []
        if (!proj.length) { it.el.style.display = 'none'; continue }
        it.el.style.display = ''
        if (!it.box) {
          it.el.style.transform = `translate(${r.left + proj[0].u * r.width}px, ${r.top + proj[0].v * r.height}px)`
          continue
        }
        const xs = proj.map(q => r.left + q.u * r.width), ys = proj.map(q => r.top + q.v * r.height)
        const pad = 10
        const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
        it.el.style.transform = `translate(${x0}px, ${y0}px)`
        it.el.style.width = `${Math.max(...xs) + pad - x0}px`
        it.el.style.height = `${Math.max(...ys) + pad - y0}px`
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [api])

  const track = (key: string, pts: () => P3[], box = false) => (el: HTMLElement | null) => {
    if (el) items.current.set(key, { el, pts, box })
    else items.current.delete(key)
  }

  // 放图钉：Esc 退出
  useEffect(() => {
    if (!collab.placingPin && !collab.pinDraft) return
    const off = () => { collab.setPlacingPin(false); collab.setPinDraft(null) }
    window.addEventListener(UI_ESCAPE_EVENT, off)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, off)
  }, [collab])

  const place = (ev: React.PointerEvent) => {
    const e = api.engine()
    if (!e || ev.button !== 0) return
    const hit = e.scene.pickPoint(ev.clientX, ev.clientY) as Anchor | null
    if (!hit) return
    collab.setActiveThread(null)
    collab.setPinDraft({ partId: hit.partId, point: hit.point.map(v => Math.round(v * 10) / 10) as P3 })
    collab.setPlacingPin(false)
  }

  if (!s) {
    return collab.error
      ? <div className="cb-ro qb-card" data-ui="collab-error"><TriangleAlert /><span><b>{t('collab.error.title')}</b> · {collab.error}</span></div>
      : <div className="cb-ro qb-card" data-ui="collab-loading"><span>{t('collab.loading')}</span></div>
  }

  const pins = collab.threads.filter(th => th.kind === 'pin' && th.anchor)
  const peers = collab.peers.filter(p => p.user && p.selection.length)
  const draft = collab.pinDraft
  const syncing = s.empty && !s.synced
  const me = collab.plan?.me
  const viewer = !collab.canEdit

  return (
    <>
      {collab.placingPin && (
        <>
          <div className="fixed inset-0 z-[33] cursor-crosshair" style={{ top: 44 }} data-ui="pin-placer" onPointerDown={place} />
          <div className="qb-card fixed top-[120px] left-1/2 -translate-x-1/2 z-[36] px-4 py-1.5 text-[13px] text-gray-100 pointer-events-none whitespace-nowrap rounded-full">{t('collab.pin.placeHint')}</div>
        </>
      )}

      {peers.map(p => <SelFrame key={`sel-${p.clientId}`} p={p} setRef={track(`sel-${p.clientId}`, () => {
        const m = api.engine()?.model
        return m ? p.selection.flatMap(id => partPoints(m, id)) : []
      }, true)} />)}

      {pins.map(th => {
        const active = collab.activeThread === th.id
        const gone = collab.partGone(th)
        const unread = th.posts.some(collab.isUnread)
        return (
          <div key={`pin-${th.id}`} className="cb-at" ref={track(`pin-${th.id}`, () => [th.anchor!.point as P3])} style={active ? { zIndex: 37 } : undefined}>
            {gone && <span className="cb-ghost-part" />}
            <button type="button" data-ui="pin" data-thread={th.id}
              className={`cb-pin ${active ? 'on' : ''} ${th.resolved ? 'done' : ''} ${gone ? 'gone' : ''} ${unread && !active ? 'unread' : ''}`}
              onClick={() => (active ? collab.setActiveThread(null) : collab.focusThread(th))}>
              <b>{collab.pinNumber(th)}</b>
            </button>
            {active && <Bubble th={th} gone={gone} />}
          </div>
        )
      })}

      {draft && (
        <div className="cb-at" ref={track('draft', () => [draft.point])} style={{ zIndex: 37 }}>
          <span className="cb-pin draft"><b>{pins.length + 1}</b></span>
          <DraftBubble draft={draft} />
        </div>
      )}

      <span className={`cb-sync qb-card ${s.conn === 'connected' ? '' : 'off'}`} data-ui="sync-state" data-conn={s.conn}>
        {t(syncing ? 'collab.connecting' : `collab.conn.${s.conn}`)}
      </span>

      {s.activity.filter(a => a.shown).slice(-1).map(a => (
        <div key={a.key} className="cb-toast qb-card" data-ui="activity">
          <Face name={a.user.name} avatar={a.user.avatar} color={collab.colorOf(a.user.userId)} />
          <span><b>{a.user.name}</b> {activityText(a.s, t)}</span>
        </div>
      ))}

      {viewer && !me && (
        <div className="cb-ro qb-card" data-ui="read-only-banner"><Eye />
          <span><b>{t('collab.readOnly.guestTitle')}</b> · {t('collab.readOnly.guest', { owner: collab.plan?.members.find(m => m.role === 'owner')?.name || '' })}</span>
          <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline">{t('collab.readOnly.login')}</a>
        </div>
      )}
      {viewer && me && (
        <div className="cb-ro low qb-card" data-ui="read-only-banner"><MessageSquare />
          <span><b>{t(collab.role === 'guest' ? 'collab.readOnly.visitorTitle' : 'collab.readOnly.commenterTitle')}</b> · {t(collab.role === 'guest' ? 'collab.readOnly.visitor' : 'collab.readOnly.commenter')}</span>
          {collab.role !== 'guest' && <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => setFork(true)} data-ui="plan-fork"><GitFork />{t('collab.forkOwn')}</button>}
        </div>
      )}
      {fork && <ForkModal onClose={() => setFork(false)} />}
    </>
  )
}

function activityText(s: { added: number; removed: number; moved: number; changed: number }, t: (k: string, v?: Record<string, string | number>) => string) {
  const parts: string[] = []
  if (s.added) parts.push(t('collab.activity.added', { n: s.added }))
  if (s.removed) parts.push(t('collab.activity.removed', { n: s.removed }))
  if (s.moved) parts.push(t('collab.activity.moved', { n: s.moved }))
  if (s.changed) parts.push(t('collab.activity.changed', { n: s.changed }))
  return parts.join(t('collab.activity.sep'))
}

function SelFrame({ p, setRef }: { p: Peer; setRef: (el: HTMLElement | null) => void }) {
  const collab = useCollab()
  const color = collab.colorOf(p.user!.userId)
  return (
    <div ref={setRef} className="cb-sel" data-ui="peer-mark" style={{ '--c': color } as React.CSSProperties}>
      <span className="cb-tag"><i>{p.user!.avatar ? <img src={mediaUrl(p.user!.avatar)} alt="" /> : p.user!.name.slice(0, 1)}</i>{p.user!.name}</span>
    </div>
  )
}

/** 气泡放在图钉右边；图钉靠右边缘时放左边 */
function useBubbleSide(ref: React.RefObject<HTMLDivElement | null>) {
  const [left, setLeft] = useState(false)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const check = () => {
      const x = el.getBoundingClientRect().left
      setLeft(x + 380 > window.innerWidth)
    }
    check()
    const id = window.setInterval(check, 300)
    return () => window.clearInterval(id)
  }, [ref])
  return left
}

/** 零件删掉了：它在哪一版被谁删掉，名字从还有它的那一版里取。 */
function useGoneNote(th: Thread, gone: boolean) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const [note, setNote] = useState<{ label: string; text: string } | null>(null)
  useEffect(() => {
    const pid = th.anchor?.partId
    if (!gone || !pid) { setNote(null); return }
    let dead = false
    void (async () => {
      const own = collab.versions.filter(v => v.kind !== 'reference').sort((a, b) => a.createdAt - b.createdAt)
      const builder = api.engine()?.builder
      let label = ''
      let text = t('collab.pin.partGone')
      let had = false
      for (const v of own) {
        const m = new BuildModel()
        m.loadJSON(await collab.versionModel(String(v.id)))
        const name = builder ? partLabel(builder, m, pid) : null
        if (name) { label = name; had = true; continue }
        if (had) {
          const who = collab.plan?.members.find(x => x.userId === v.createdBy)?.name || ''
          text = t('collab.pin.goneIn', { who, version: v.name, part: label })
          break
        }
      }
      if (!dead) setNote({ label, text })
    })().catch(collab.report)
    return () => { dead = true }
  }, [gone, th.anchor?.partId, collab, api, t])
  return note
}

function Bubble({ th, gone }: { th: Thread; gone: boolean }) {
  const collab = useCollab()
  const api = useEngine()
  const { t, lang } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const left = useBubbleSide(ref)
  const note = useGoneNote(th, gone)
  const e = api.engine()
  const pid = th.anchor?.partId
  const label = pid && e && !gone ? partLabel(e.builder, e.model, pid) : null
  const where = !pid ? t('collab.pin.space') : gone ? t('collab.pin.goneWhere', { part: note?.label || t('collab.pin.part') }) : (label || t('collab.pin.part'))
  const member = collab.role !== 'guest'
  // 气泡里的新回复标「新」，看过就不标：打开就记已读
  const [seen] = useState(() => collab.isUnread)
  useEffect(() => { if (th.posts.some(collab.isUnread)) collab.markRead().catch(collab.report) }, [th.id, collab])

  return (
    <div ref={ref} className={`cb-bubble ${left ? 'left' : ''}`} data-ui="pin-bubble" onPointerDown={ev => ev.stopPropagation()}>
      <div className="inner qb-card">
        <div className="cb-bh">
          <span className={`no ${gone ? 'gone' : ''}`}>{collab.pinNumber(th)}</span>
          <span className="where">{where}</span>
          {member && (
            <button type="button" className={`act ${th.resolved ? 'done' : ''}`} data-ui="pin-resolve"
              onClick={() => { collab.resolve(th.id, !th.resolved).catch(collab.report) }}>
              {t(th.resolved ? 'collab.pin.reopen' : 'collab.pin.resolve')}
            </button>
          )}
          <button type="button" className="x" aria-label="×" onClick={() => collab.setActiveThread(null)}>×</button>
        </div>
        {gone && <div className="cb-gone-note"><TriangleAlert />{note?.text || t('collab.pin.partGone')}</div>}
        <div className="cb-posts">
          {th.posts.map(p => (
            <div key={p.id} className={`cb-post ${seen(p) ? 'new' : ''}`} data-new={t('collab.new')} data-ui="post">
              <Face name={p.name} avatar={p.avatar} color={collab.colorOf(p.userId)} />
              <div>
                <div className="who">{p.name}{isDesigner(collab.plan, p.userId) && <span className="role">{t('collab.designer')}</span>}<small>{when(p.createdAt, lang)}</small></div>
                {p.body && <p>{p.body}</p>}
                {p.photos.length > 0 && <div className="pics">{p.photos.map(src => <a key={src} href={mediaUrl(src)} target="_blank" rel="noreferrer"><img src={mediaUrl(src)} alt="" /></a>)}</div>}
              </div>
            </div>
          ))}
        </div>
        {member
          ? <Compose placeholder={t('collab.pin.replyPlaceholder')} sendLabel={t('collab.pin.replyGo')} send={(body, files) => collab.reply(th.id, body, files, [])} />
          : !collab.plan?.me && <div className="cb-login-reply"><a className="qb-btn qb-btn-sm no-underline" href={collab.loginUrl()}>{t('collab.readOnly.login')}</a></div>}
      </div>
    </div>
  )
}

function DraftBubble({ draft }: { draft: Anchor }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const left = useBubbleSide(ref)
  const e = api.engine()
  const label = draft.partId && e ? partLabel(e.builder, e.model, draft.partId) : null
  return (
    <div ref={ref} className={`cb-bubble ${left ? 'left' : ''}`} data-ui="pin-draft" onPointerDown={ev => ev.stopPropagation()}>
      <div className="inner qb-card">
        <div className="cb-bh">
          <span className="no">{collab.threads.filter(th => th.kind === 'pin').length + 1}</span>
          <span className="where">{draft.partId ? (label || t('collab.pin.part')) : t('collab.pin.space')}</span>
          <button type="button" className="x" aria-label="×" onClick={() => collab.setPinDraft(null)}>×</button>
        </div>
        <Compose autoFocus placeholder={t('collab.pin.placeholder')} sendLabel={t('collab.pin.post')}
          send={(body, files) => collab.addPin(draft, body, files)} />
      </div>
    </div>
  )
}
