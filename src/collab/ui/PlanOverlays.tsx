import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
import { anchorPoint, attachAnchor } from '../anchors'
import {CommentActions} from './CommentActions'
import {useCommentText} from '../commentStrings'
import { ForkModal } from './Modals'
import { NARROW_MAX, PANEL_GAP, projectBarHeight, TOOLBAR_CHROME_H, usePanelLayout } from '../../ui/panelLayout'
import { SINGLE_MODEL } from '../../entry'
import { Pop } from '../../ui/Pop'
import { layoutPinGroups, type PinPosition } from '../pinGroups'

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
  const commentText=useCommentText()
  const { vw } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const items = useRef(new Map<string, { el: HTMLElement; pts: () => P3[]; box: boolean }>())
  const [fork, setFork] = useState(false)
  const [bannerTop, setBannerTop] = useState(projectBarHeight(vw) + PANEL_GAP)
  const [pinChoices, setPinChoices] = useState<{ anchor: HTMLElement; ids: number[] } | null>(null)
  const placement=useRef<{x:number;y:number;cancelled:boolean}|null>(null)
  const pointers=useRef(new Set<number>())
  const s = collab.session
  const { engine } = api

  useEffect(() => setPinChoices(null), [s?.id])

  useLayoutEffect(() => {
    const elements = ['[data-ui=toolbar-wrap]', '[data-ui=scene-buttons]'].map(selector => document.querySelector(selector)).filter((el): el is Element => !!el)
    const update = () => setBannerTop(Math.max(projectBarHeight(vw), ...elements.map(el => el.getBoundingClientRect().bottom)) + PANEL_GAP)
    update()
    const observer = new ResizeObserver(update)
    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [vw, collab.canEdit, collab.role])

  // 每一帧：图钉摆到那一点，选中框框住那几件零件；转到背后、出了画面的藏起来
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = engine()
      const host = document.getElementById('canvas-host')
      if (!e || !host) return
      const r = host.getBoundingClientRect()
      const pinPositions: PinPosition[] = []
      for (const it of items.current.values()) {
        const pts = it.pts()
        const proj = pts.length ? (e.scene.projectWorld(pts) as Array<{ u: number; v: number } | null>).filter(Boolean) as Array<{ u: number; v: number }> : []
        if (!proj.length) { it.el.style.display = 'none'; continue }
        it.el.style.display = ''
        if (!it.box) {
          const x = r.left + proj[0].u * r.width, y = r.top + proj[0].v * r.height
          it.el.style.transform = `translate(${x}px, ${y}px)`
          if (it.el.dataset.pinId) pinPositions.push({ id: it.el.dataset.pinId, x, y })
          continue
        }
        const xs = proj.map(q => r.left + q.u * r.width), ys = proj.map(q => r.top + q.v * r.height)
        const pad = 10
        const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
        it.el.style.transform = `translate(${x0}px, ${y0}px)`
        it.el.style.width = `${Math.max(...xs) + pad - x0}px`
        it.el.style.height = `${Math.max(...ys) + pad - y0}px`
      }
      const obstacles = Array.from(document.querySelectorAll<HTMLElement>('[data-ui=toolbar-wrap], [data-ui=scene-buttons], .cb-ro, #qhChatFab, #qhChatNoticeHint, #qhChatPeek')).filter(el => {
        const style = getComputedStyle(el)
        return style.visibility !== 'hidden' && Number(style.opacity) > 0
      }).map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
      const positions = new Map(pinPositions.map(point => [point.id, point]))
      for (const group of layoutPinGroups(pinPositions, obstacles, { width: window.innerWidth, height: window.innerHeight, top: projectBarHeight(window.innerWidth) })) {
        const primary = group.ids.find(id => items.current.get(`pin-${id}`)?.el.querySelector('.cb-pin.on')) || group.ids[0]
        const ids = [primary, ...group.ids.filter(id => id !== primary)]
        const el = items.current.get(`pin-${primary}`)?.el
        const button = el?.querySelector<HTMLButtonElement>('[data-ui=pin]')
        if (!el || !button) continue
        el.style.transform = `translate(${group.x}px, ${group.y}px)`
        const line = el.querySelector<SVGLineElement>('.cb-pin-connector line')
        if (line) {
          const original = group.ids.map(id => positions.get(id)!)
          const x = original.reduce((sum, point) => sum + point.x, 0) / original.length - group.x
          const y = original.reduce((sum, point) => sum + point.y, 0) / original.length - group.y
          line.style.display = Math.hypot(x, y) > 4 ? '' : 'none'
          line.setAttribute('x2', String(x))
          line.setAttribute('y2', String(y))
        }
        button.dataset.pinIds = ids.join(',')
        button.dataset.clusterUnread = String(ids.some(id => items.current.get(`pin-${id}`)?.el.querySelector('.cb-pin.unread')))
        const numbers = ids.map(id => items.current.get(`pin-${id}`)?.el.dataset.pinNumber || '')
        button.setAttribute('aria-label', `${t('collab.tab.pins')} ${numbers.join(', ')}`)
        if (group.ids.length > 1) button.dataset.clusterCount = `+${group.ids.length - 1}`
        else delete button.dataset.clusterCount
        for (const id of ids.slice(1)) {
          const member = items.current.get(`pin-${id}`)?.el
          if (member) member.style.display = 'none'
        }
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [engine, t])

  const track = (key: string, pts: () => P3[], box = false) => (el: HTMLElement | null) => {
    if (el) items.current.set(key, { el, pts, box })
    else items.current.delete(key)
  }

  // 放图钉：Esc 退出
  const { placingPin, pinDraft, setPlacingPin, setPinDraft } = collab
  useEffect(() => {
    if (!pinChoices) return
    document.querySelector<HTMLButtonElement>('[data-ui=pin-choices] button')?.focus()
  }, [pinChoices])
  useEffect(() => {
    if (!placingPin && !pinDraft) return
    const off = () => { if(collab.savingPin)return;collab.cancelMovePin();setPlacingPin(false); setPinDraft(null) }
    window.addEventListener(UI_ESCAPE_EVENT, off)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, off)
  }, [placingPin, pinDraft, setPlacingPin, setPinDraft,collab.cancelMovePin,collab.savingPin])

  const place = (ev: React.MouseEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    if(!collab.canComment||placement.current?.cancelled)return
    const e = api.engine()
    if (!e || ev.button !== 0) return
    const hit = e.scene.pickPoint(ev.clientX, ev.clientY) as Anchor | null
    if (!hit) return
    collab.setActiveThread(null)
    collab.setPinDraft(attachAnchor(e.model, { partId: hit.partId, point: hit.point.map(v => Math.round(v * 10) / 10) as P3,...(collab.plan?.viewOnly?{sceneRevision:collab.plan.sceneRevision}:{}) }))
    collab.setPlacingPin(false)
  }

  if (!s) {
    return collab.error
      ? <div className="cb-ro qb-card" style={{ top: bannerTop }} data-ui="collab-error"><TriangleAlert /><span><b>{t('collab.error.title')}</b> · {collab.error}</span></div>
      : <div className="cb-ro qb-card" style={{ top: bannerTop }} data-ui="collab-loading"><span>{t('collab.loading')}</span></div>
  }

  const pins = collab.threads.filter(th => th.kind === 'pin' && th.anchor && !(collab.movingPin?.id===th.id&&pinDraft))
  const peers = collab.peers.filter(p => p.user && p.selection.length)
  const draft = collab.pinDraft
  const syncing = s.empty && !s.synced
  const me = collab.plan?.me
  const viewer = !collab.canEdit

  return (
    <>
      {collab.placingPin && (
        <>
          <div className="fixed inset-0 z-[38] cursor-crosshair" style={{ top: projectBarHeight(vw), touchAction: 'none' }} data-ui="pin-placer" onClick={place}
            onPointerDown={event=>{pointers.current.add(event.pointerId);if(pointers.current.size===1)placement.current={x:event.clientX,y:event.clientY,cancelled:false};else if(placement.current)placement.current.cancelled=true}}
            onPointerMove={event=>{if(placement.current&&Math.hypot(event.clientX-placement.current.x,event.clientY-placement.current.y)>7)placement.current.cancelled=true}}
            onPointerUp={event=>pointers.current.delete(event.pointerId)} onPointerCancel={event=>{pointers.current.delete(event.pointerId);if(placement.current)placement.current.cancelled=true}} />
          <div className="qb-card cb-pin-placement" style={{ top: projectBarHeight(vw) + PANEL_GAP + TOOLBAR_CHROME_H + 8 }} data-ui="pin-placement-hint">
            <span>{collab.movingPin?commentText('place'):t(narrow ? 'collab.pin.placeTouchHint' : 'collab.pin.placeHint')}</span>
            <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" data-ui="cancel-pin-placement" onClick={() => collab.cancelMovePin()}>{t('confirm.cancel')}</button>
          </div>
        </>
      )}

      {peers.map(p => <SelFrame key={`sel-${p.clientId}`} p={p} setRef={track(`sel-${p.clientId}`, () => {
        const m = api.engine()?.model
        return m ? p.selection.flatMap(id => partPoints(m, id)) : []
      }, true)} />)}

      {pins.map(th => {
        const active = collab.activeThread === th.id && !draft && !collab.placingPin
        const gone = collab.partGone(th)
        const unread = th.posts.some(collab.isUnread)
        return (
          <Fragment key={`pin-${th.id}`}><div className="cb-at" data-pin-id={th.id} data-pin-number={collab.pinNumber(th)} ref={track(`pin-${th.id}`, () => [anchorPoint(api.engine()?.model, th.anchor!)])} style={active ? { zIndex: 37 } : undefined}>
            <svg className="cb-pin-connector" aria-hidden="true"><line x1="0" y1="-22" x2="0" y2="0" /></svg>
            {gone && <span className="cb-ghost-part" />}
            <button type="button" data-ui="pin" data-thread={th.id}
              className={`cb-pin ${active ? 'on' : ''} ${th.resolved ? 'done' : ''} ${gone ? 'gone' : ''} ${unread && !active ? 'unread' : ''}`}
              onClick={event => {
                const ids = (event.currentTarget.dataset.pinIds || String(th.id)).split(',').map(Number)
                if (ids.length > 1) setPinChoices({ anchor: event.currentTarget, ids })
                else { setPinChoices(null); if (active) collab.setActiveThread(null); else collab.focusThread(th) }
              }}>
              <b>{collab.pinNumber(th)}</b>
            </button>
          </div>{active && <Discussion anchor={th.anchor!}><Bubble th={th} gone={gone} /></Discussion>}</Fragment>
        )
      })}
      {pinChoices && <Pop anchor={pinChoices.anchor} leaving={false} onClose={() => setPinChoices(null)} width={320} align="center" className="cb-pin-choice-pop">
        <div className="cb-pin-choices" role="group" aria-label={t('collab.tab.pins')} data-panel-chrome="" data-ui="pin-choices" onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
          }
          if (event.key === 'Escape') pinChoices.anchor.focus()
        }}>
          {pinChoices.ids.map(id => collab.threads.find(th => th.id === id)).filter((th): th is Thread => !!th).map(th => <button key={th.id} type="button" data-thread={th.id} onClick={() => { setPinChoices(null); collab.focusThread(th) }}>
            <b>{collab.pinNumber(th)}</b><span>{th.posts[0]?.body || t('collab.pin.photoOnly')}</span>
          </button>)}
        </div>
      </Pop>}

      {draft && (
        <><div className="cb-at" ref={track('draft', () => [anchorPoint(api.engine()?.model, draft)])} style={{ zIndex: 37 }}>
          <span className="cb-pin draft"><b>{collab.movingPin?collab.pinNumber(collab.movingPin):'+'}</b></span>
        </div><Discussion anchor={draft}><DraftBubble draft={draft} /></Discussion></>
      )}

      <span className={`cb-sync qb-card ${s.conn === 'connected' ? '' : 'off'}`} data-ui="sync-state" data-conn={s.conn} title={t(syncing ? 'collab.connecting' : `collab.conn.${s.conn}`)}>
        <span className="cb-sync-label">{t(syncing ? 'collab.connecting' : `collab.conn.${s.conn}`)}</span>
      </span>

      {s.activity.filter(a => a.shown).slice(-1).map(a => (
        <div key={a.key} className="cb-toast qb-card" data-ui="activity">
          <Face name={a.user.name} avatar={a.user.avatar} color={collab.colorOf(a.user.userId)} />
          <span><b>{a.user.name}</b> {activityText(a.s, t)}</span>
        </div>
      ))}

      {viewer && !me && (
        <div className="cb-ro qb-card" style={{ top: bannerTop }} data-ui="read-only-banner" data-tour="read-only-banner"><Eye />
          <span><b>{t('collab.readOnly.guestTitle')}</b>{!narrow && <> · {t('collab.readOnly.guest', { owner: collab.plan?.members.find(m => m.role === 'owner')?.name || '' })}</>}</span>
          <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline">{t('collab.readOnly.login')}</a>
        </div>
      )}
      {viewer && me && !SINGLE_MODEL && (
        <div className="cb-ro qb-card" style={{ top: bannerTop }} data-ui="read-only-banner" data-tour="read-only-banner"><MessageSquare />
          <span><b>{t(collab.role === 'guest' ? 'collab.readOnly.visitorTitle' : 'collab.readOnly.commenterTitle')}</b>{!narrow && <> · {t(collab.role === 'guest' ? 'collab.readOnly.visitor' : 'collab.readOnly.commenter')}</>}</span>
          {collab.role !== 'guest'&&!collab.plan?.viewOnly && <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => setFork(true)} data-ui="plan-fork"><GitFork />{t('collab.forkOwn')}</button>}
        </div>
      )}
      {fork && <ForkModal onClose={() => setFork(false)} />}
    </>
  )
}

/** 手机输入框独立挂在页面上，避开图钉投影的 transform，并跟随软键盘可视区域。 */
function Discussion({ anchor, children }: { anchor: Anchor; children: ReactNode }) {
  const { vw } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const { engine } = useEngine()
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const measure = () => {
    const view = window.visualViewport
    const height = view?.height ?? window.innerHeight
    return { bottom: Math.max(0, window.innerHeight - (view?.offsetTop ?? 0) - height), height }
  }
  const [viewport, setViewport] = useState(measure)
  useLayoutEffect(() => {
    if (narrow) return
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const el = ref.current, host = document.getElementById('canvas-host')
      const e = engine()
      const projected = e?.scene.projectWorld([anchorPoint(e.model, anchor)])?.[0]
      if (!el || !host) return
      el.style.display = projected ? '' : 'none'
      if (projected) {
        const r = host.getBoundingClientRect()
        const x=r.left+projected.u*r.width,y=r.top+projected.v*r.height
        el.dataset.pinX=String(x)
        const bubble=el.querySelector<HTMLElement>('.cb-bubble')
        if(bubble){
          const style=getComputedStyle(bubble),dx=parseFloat(style.marginLeft),dy=parseFloat(style.marginTop)
          const safeTop=projectBarHeight(vw)+PANEL_GAP+TOOLBAR_CHROME_H+8
          const left=Math.max(8,Math.min(window.innerWidth-bubble.offsetWidth-8,x+dx))
          const top=Math.max(safeTop,Math.min(window.innerHeight-bubble.offsetHeight-12,y+dy))
          el.style.transform=`translate(${left-dx}px,${top-dy}px)`
          bubble.style.setProperty('--cb-arrow-top',`${Math.max(16,Math.min(bubble.offsetHeight-24,y-top-6))}px`)
        }else el.style.transform=`translate(${x}px,${y}px)`
      }
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [narrow, engine, anchor])
  useEffect(() => {
    const update = () => setViewport(measure())
    const view = window.visualViewport
    view?.addEventListener('resize', update)
    view?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      view?.removeEventListener('resize', update)
      view?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return createPortal(<div ref={ref} className={narrow ? 'cb-mobile-discussion' : 'cb-anchored-discussion'} data-ui={narrow ? 'mobile-pin-sheet' : 'anchored-pin-discussion'} role="dialog" aria-label={t('collab.tab.pins')}
    style={narrow ? { display: 'block', transform: 'none', bottom: viewport.bottom, maxHeight: Math.max(80, viewport.height - projectBarHeight(vw) - PANEL_GAP) } : undefined}>{children}</div>, document.body)
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
      const x = el.dataset.pinX===undefined?el.getBoundingClientRect().left:Number(el.dataset.pinX)
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
  const { versions, versionModel, plan, report } = useCollab()
  const { engine } = useEngine()
  const { t } = useI18n()
  const [note, setNote] = useState<{ label: string; text: string } | null>(null)
  useEffect(() => {
    const pid = th.anchor?.partId
    if (!gone || !pid || plan?.viewOnly) { setNote(null); return }
    let dead = false
    void (async () => {
      const own = versions.filter(v => v.kind !== 'reference').sort((a, b) => a.createdAt - b.createdAt)
      const builder = engine()?.builder
      let label = ''
      let text = t('collab.pin.partGone')
      let had = false
      for (const v of own) {
        const m = new BuildModel()
        m.loadJSON(await versionModel(String(v.id)))
        const name = builder ? partLabel(builder, m, pid) : null
        if (name) { label = name; had = true; continue }
        if (had) {
          const who = plan?.members.find(x => x.userId === v.createdBy)?.name || ''
          text = t('collab.pin.goneIn', { who, version: v.name, part: label })
          break
        }
      }
      if (!dead) setNote({ label, text })
    })().catch(report)
    return () => { dead = true }
  }, [gone, th.anchor?.partId, versions, versionModel, plan, report, engine, t])
  return note
}

function Bubble({ th, gone }: { th: Thread; gone: boolean }) {
  const collab = useCollab()
  const api = useEngine()
  const { t, lang } = useI18n()
  const commentText=useCommentText()
  const ref = useRef<HTMLDivElement>(null)
  const left = useBubbleSide(ref)
  const note = useGoneNote(th, gone)
  const e = api.engine()
  const pid = th.anchor?.partId
  const label = pid && e && !gone ? partLabel(e.builder, e.model, pid) : null
  const where = !pid ? t('collab.pin.space') : gone ? t('collab.pin.goneWhere', { part: note?.label || t('collab.pin.part') }) : (label || t('collab.pin.part'))
  const member = collab.canComment
  // 气泡里的新回复标「新」，看过就不标：打开就记已读
  const [seen] = useState(() => collab.isUnread)
  const { isUnread, markRead, report } = collab
  useEffect(() => { if (th.posts.some(isUnread)) markRead().catch(report) }, [th.posts, isUnread, markRead, report])

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
          {th.posts.map((p,i) => (
            <div key={p.id} className={`cb-post ${seen(p) ? 'new' : ''}`} data-new={t('collab.new')} data-ui="post">
              <Face name={p.name} avatar={p.avatar} color={collab.colorOf(p.userId)} />
              <div>
                <div className="who">{p.name}{isDesigner(collab.plan, p.userId) && <span className="role">{t('collab.designer')}</span>}<small>{when(p.createdAt, lang)}{p.editedAt?` · ${commentText('edited')}`:''}</small><CommentActions thread={th} post={p} first={i===0}/></div>
                {p.deleted?<p className="cb-deleted-post">{commentText('deleted')}</p>:p.body && <p>{p.body}</p>}
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
  const commentText=useCommentText()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const ref = useRef<HTMLDivElement>(null)
  const left = useBubbleSide(ref)
  const e = api.engine()
  const label = draft.partId && e ? partLabel(e.builder, e.model, draft.partId) : null
  let where=draft.partId?(label||t('collab.pin.part')):t('collab.pin.space')
  if(collab.movingPin)where=commentText('moveTitle')
  return (
    <div ref={ref} className={`cb-bubble ${left ? 'left' : ''}`} data-ui="pin-draft" onPointerDown={ev => ev.stopPropagation()}>
      <div className="inner qb-card">
        <div className="cb-bh">
          <span className="no">{collab.movingPin?collab.pinNumber(collab.movingPin):'+'}</span>
          <span className="where">{where}</span>
          <button type="button" className="x" aria-label="×" disabled={busy} onClick={() => collab.cancelMovePin()}>×</button>
        </div>
        {collab.movingPin?<div className="cb-move-confirm" data-ui="move-pin-confirm">
          <p>{collab.movingPin.posts[0]?.body}</p>{error&&<p role="alert" className="cb-comment-error">{error}</p>}
          <div className="foot"><button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={collab.cancelMovePin}>{commentText('cancel')}</button><button type="button" className="qb-btn qb-btn-sm" disabled={busy} aria-busy={busy} onClick={()=>{const thread=collab.movingPin;if(!thread||busy)return;setBusy(true);setError('');collab.movePin(thread,draft).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false))}}>{commentText('save')}</button></div>
        </div>:<Compose autoFocus placeholder={t('collab.pin.placeholder')} sendLabel={t('collab.pin.post')}
          send={(body, files) => collab.addPin(draft, body, files)} />}
      </div>
    </div>
  )
}
