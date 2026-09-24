import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { UI_ESCAPE_EVENT } from '../../ui/events'
import { useDock } from '../../ui/dock'
import { useCollab } from '../CollabContext'
import type { Anchor } from '../api'
import { Composer } from './Posts'
import { Avatar } from './PlanBar'

type P3 = [number, number, number]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any

/** 一件零件在画面里的位置：接头取中心，管取两端中点，板取四角中心。 */
function partPoint(model: E, id: string): P3 | null {
  const n = model.nodes.get(id)
  if (n) return [n.x, n.y, n.z]
  const tb = model.tubes.get(id)
  if (tb) {
    const a = model.nodes.get(tb.a), b = model.nodes.get(tb.b)
    return a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2] : null
  }
  const p = model.panels.get(id) || model.textiles.get(id)
  if (p) {
    const c = model.panelCorners(p) as P3[] | null
    if (!c) return null
    return [0, 1, 2].map(k => c.reduce((s, q) => s + q[k], 0) / c.length) as P3
  }
  const f = model.fittings.get(id) || model.slides.get(id) || model.clamps.get(id)
  return f ? [f.x, f.y, f.z] : null
}

function centroid(pts: P3[]): P3 | null {
  if (!pts.length) return null
  return [0, 1, 2].map(k => pts.reduce((s, q) => s + q[k], 0) / pts.length) as P3
}

/**
 * 画面上的共享标记：位置评论的图钉、正在写的那一条、其他成员选中的零件上的头像。
 * 位置每一帧按镜头重新投影，直接改样式，不经过 React 渲染。
 */
export default function PlanOverlays() {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const { setPane } = useDock()
  const layer = useRef<HTMLDivElement>(null)
  const items = useRef(new Map<string, { el: HTMLElement; at: () => P3 | null }>())

  const pins = collab.threads.filter(th => th.kind === 'pin' && th.anchor && (!th.resolved || th.id === collab.activeThread))
  const peers = collab.peers.filter(p => p.user && p.selection.length)

  // 每一帧把标记挪到零件在画面里的位置；转到背后、出了画面的藏起来
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = api.engine()
      const host = document.getElementById('canvas-host')
      if (!e || !host || !layer.current) return
      const r = host.getBoundingClientRect()
      const list = [...items.current.values()]
      const pts = list.map(it => it.at())
      const proj = e.scene.projectWorld(pts.map(p => p || [0, -1e6, 0])) as Array<{ u: number; v: number } | null>
      list.forEach((it, i) => {
        const q = pts[i] ? proj[i] : null
        if (!q) { it.el.style.display = 'none'; return }
        it.el.style.display = ''
        it.el.style.transform = `translate(${r.left + q.u * r.width}px, ${r.top + q.v * r.height}px)`
      })
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [api])

  const track = (key: string, at: () => P3 | null) => (el: HTMLElement | null) => {
    if (el) items.current.set(key, { el, at })
    else items.current.delete(key)
  }

  // 放图钉：点画布取一个点
  useEffect(() => {
    if (!collab.placingPin) return
    const off = () => collab.setPlacingPin(false)
    window.addEventListener(UI_ESCAPE_EVENT, off)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, off)
  }, [collab])

  const place = (ev: React.PointerEvent) => {
    const e = api.engine()
    if (!e) return
    const hit = e.scene.pickPoint(ev.clientX, ev.clientY) as Anchor | null
    collab.setPlacingPin(false)
    if (!hit) return
    collab.setPinDraft({ partId: hit.partId, point: hit.point.map(v => Math.round(v * 10) / 10) as P3 })
  }

  const draft = collab.pinDraft

  return (
    <>
      {collab.placingPin && (
        <div className="fixed inset-0 z-[36] cursor-crosshair" data-ui="pin-placer" onPointerDown={place}>
          <div className="qb-card fixed top-[5.5rem] left-1/2 -translate-x-1/2 px-3 py-1.5 text-sm text-gray-100 pointer-events-none">{t('collab.pin.placeHint')}</div>
        </div>
      )}
      <div ref={layer} className="fixed inset-0 z-[35] pointer-events-none" data-ui="plan-overlays">
        {pins.map(th => (
          // 外层只管摆到那一点，里面的针尖朝下：旋转放在里层，不然位置也跟着转
          <div key={`pin-${th.id}`} ref={track(`pin-${th.id}`, () => th.anchor!.point as P3)} className="absolute left-0 top-0">
            <button data-ui="pin" data-thread={th.id}
              onClick={() => { setPane('comments'); collab.focusThread(th) }}
              className={`absolute -left-3.5 -top-[34px] pointer-events-auto cursor-pointer w-7 h-7 rounded-full rounded-bl-none -rotate-45 flex items-center justify-center shadow-md border-2 border-white ${th.id === collab.activeThread ? 'bg-teal-500' : th.resolved ? 'bg-gray-400' : 'bg-orange-500'}`}>
              <span className="rotate-45 text-white text-[11px] font-bold">{collab.pinNumber(th)}</span>
            </button>
          </div>
        ))}
        {peers.map(p => (
          <div key={`peer-${p.clientId}`} data-ui="peer-mark"
            ref={track(`peer-${p.clientId}`, () => {
              const m = api.engine()?.model
              return m ? centroid(p.selection.map(id => partPoint(m, id)).filter(Boolean) as P3[]) : null
            })}
            className="absolute left-0 top-0 -translate-x-1/2 -translate-y-[130%] flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] text-white shadow"
            style={{ background: p.user!.color }}>
            <Avatar name={p.user!.name} avatar={p.user!.avatar} color={p.user!.color} size={18} />
            <span className="max-w-[7rem] truncate">{p.user!.name}</span>
          </div>
        ))}
        {draft && (
          <div key="draft" ref={track('draft', () => draft.point)} className="absolute left-0 top-0 pointer-events-auto" data-ui="pin-draft">
            <div className="absolute -left-3.5 -top-[34px] w-7 h-7 rounded-full rounded-bl-none -rotate-45 bg-orange-500 border-2 border-white shadow-md" />
            <div className="qb-card absolute left-4 -top-3 w-72 p-3 text-gray-100">
              <div className="text-xs text-gray-400 mb-1.5">{t(draft.partId ? 'collab.pin.onPart' : 'collab.pin.onSpace')}</div>
              <Composer autoFocus placeholder={t('collab.pin.placeholder')}
                onSend={(body, files) => collab.addPin(draft, body, files).then(() => { setPane('comments') })} />
              <button onClick={() => collab.setPinDraft(null)} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer mt-1">{t('confirm.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
