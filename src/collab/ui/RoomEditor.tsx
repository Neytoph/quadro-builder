import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import type { Opening } from '../api'
import { drawingFromRoom, edgeLength, nearestEdge, roomFromDrawing, snap, type Pt } from '../room'

type Tool = 'wall' | 'door' | 'window'

/** 靠近前一个点的横平竖直：差不到 12 cm 就对齐 */
function straighten(p: Pt, prev: Pt | undefined): Pt {
  if (!prev) return p
  const [x, z] = p
  if (Math.abs(x - prev[0]) < 12) return [prev[0], z]
  if (Math.abs(z - prev[1]) < 12) return [x, prev[1]]
  return p
}

/**
 * 画房间边界（从需求单进来）：俯视地面，点一下放一个墙角，点回第一个点封口；
 * 门和窗在墙上点两下定起止。宽深取外框，高度自己填。画完写回需求单，回到需求单页。
 */
export default function RoomEditor() {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const start = collab.room
  const initial = useMemo(() => (start ? drawingFromRoom(start.room) : { pts: [], openings: [] }), [start])
  const [pts, setPts] = useState<Pt[]>(initial.pts)
  const [closed, setClosed] = useState(initial.pts.length >= 3)
  const [openings, setOpenings] = useState<Opening[]>(initial.openings)
  const [tool, setTool] = useState<Tool>('wall')
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [pendingStart, setPendingStart] = useState<{ edge: number; t: number } | null>(null)
  const [h, setH] = useState(start?.room.h || 240)
  const [wd, setWd] = useState({ w: start?.room.w || 300, d: start?.room.d || 400 })
  const [busy, setBusy] = useState(false)
  const labels = useRef<HTMLDivElement>(null)

  // 俯视，镜头框住已有的房间
  useEffect(() => {
    const e = api.engine()
    if (!e || !start) return
    e.scene.setScene(false)
    e.scene.topView([0, 0], Math.max(start.room.w, start.room.d, 300) * 1.4)
  }, [api, start])

  const room = roomFromDrawing(closed ? pts : [], closed ? openings : [], h, wd)

  // 画面上的轮廓跟着状态走
  useEffect(() => {
    const e = api.engine()
    if (!e) return
    let pending: [Pt, Pt] | null = null
    if (pendingStart && cursor && closed) {
      const hit = nearestEdge(pts, cursor)
      if (hit.edge === pendingStart.edge) {
        const at = (tt: number): Pt => {
          const a = pts[hit.edge], b = pts[(hit.edge + 1) % pts.length]
          const L = edgeLength(pts, hit.edge) || 1
          return [a[0] + (b[0] - a[0]) * tt / L, a[1] + (b[1] - a[1]) * tt / L]
        }
        pending = [at(pendingStart.t), at(snap(hit.t))]
      }
    }
    e.scene.setRoomDrawing({ pts, closed, openings, cursor: tool === 'wall' ? cursor : null, pending, pendingKind: tool })
  }, [api, pts, closed, openings, cursor, tool, pendingStart])

  useEffect(() => () => { api.engine()?.scene.setRoomDrawing(null) }, [api])

  // 每条墙的长度标在墙的中点
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = api.engine()
      const host = document.getElementById('canvas-host')
      const box = labels.current
      if (!e || !host || !box) return
      const r = host.getBoundingClientRect()
      const n = pts.length
      const edges = closed ? n : n - 1
      const mids = Array.from({ length: Math.max(0, edges) }, (_, i) => {
        const a = pts[i], b = pts[(i + 1) % n]
        return [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]
      })
      const proj = e.scene.projectWorld(mids) as Array<{ u: number; v: number } | null>
      const kids = box.children
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i] as HTMLElement
        const q = proj[i]
        if (!q) { el.style.display = 'none'; continue }
        el.style.display = ''
        el.style.transform = `translate(${r.left + q.u * r.width}px, ${r.top + q.v * r.height}px) translate(-50%, -50%)`
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [api, pts, closed])

  const groundAt = (ev: React.PointerEvent): Pt | null => {
    const e = api.engine()
    const hit = e?.scene.pickPoint(ev.clientX, ev.clientY) as { point: [number, number, number] } | null
    return hit ? [snap(hit.point[0]), snap(hit.point[2])] : null
  }

  const onMove = (ev: React.PointerEvent) => {
    const p = groundAt(ev)
    setCursor(p && tool === 'wall' && !closed ? straighten(p, pts[pts.length - 1]) : p)
  }

  const onClick = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return
    const raw = groundAt(ev)
    if (!raw) return
    if (tool === 'wall') {
      if (closed) return
      const p = straighten(raw, pts[pts.length - 1])
      if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 15) { setClosed(true); return }
      setPts(list => [...list, p])
      return
    }
    if (!closed) { api.notify(t('room.closeFirst'), 'warn'); return }
    const hit = nearestEdge(pts, raw)
    if (hit.edge < 0 || hit.dist > 40) return
    if (!pendingStart) { setPendingStart({ edge: hit.edge, t: snap(hit.t) }); return }
    if (hit.edge !== pendingStart.edge) { setPendingStart({ edge: hit.edge, t: snap(hit.t) }); return }
    const a = pendingStart.t, b = snap(hit.t)
    setPendingStart(null)
    if (Math.abs(b - a) < 20) return
    setOpenings(list => [...list, { kind: tool, edge: hit.edge, from: Math.min(a, b), to: Math.max(a, b) }])
  }

  const undo = () => {
    if (pendingStart) { setPendingStart(null); return }
    if (openings.length && closed && tool !== 'wall') { setOpenings(list => list.slice(0, -1)); return }
    if (closed) { setClosed(false); setOpenings([]); return }
    setPts(list => list.slice(0, -1))
  }

  const save = async () => {
    setBusy(true)
    try {
      await collab.saveRoom(room)
    } catch (err) {
      api.notify(String(err instanceof Error ? err.message : err), 'err')
      setBusy(false)
    }
  }

  const n = pts.length
  const edgeCount = closed ? n : Math.max(0, n - 1)
  const toolBtn = (k: Tool) => `flex-1 text-sm rounded-lg py-2 cursor-pointer border ${tool === k ? 'bg-teal-500 text-white border-teal-400' : 'border-gray-700 bg-gray-800 text-gray-100'}`

  return (
    <>
      <div className="fixed inset-0 z-[30] cursor-crosshair" data-ui="room-canvas"
        onPointerMove={onMove} onPointerDown={onClick} onPointerLeave={() => setCursor(null)}
        onWheel={ev => { document.querySelector('#canvas-host canvas')?.dispatchEvent(new WheelEvent('wheel', ev.nativeEvent)) }} />
      <div ref={labels} className="fixed inset-0 z-[31] pointer-events-none">
        {Array.from({ length: edgeCount }, (_, i) => (
          <span key={i} className="absolute left-0 top-0 qb-card px-1.5 py-0.5 text-[11px] text-gray-100 qb-num whitespace-nowrap">
            {Math.round(edgeLength(pts, i))} cm
          </span>
        ))}
      </div>
      <aside className="qb-card fixed z-[40] top-3 left-3 w-72 max-w-[calc(100vw-1.5rem)] p-4 text-gray-100 flex flex-col gap-3" data-ui="room-editor">
        <div>
          <div className="text-base font-semibold">{t('room.title')}</div>
          <p className="text-xs text-gray-400 mt-1">{t(closed ? (tool === 'wall' ? 'room.hintClosed' : 'room.hintOpening') : 'room.hintDraw')}</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => { setTool('wall'); setPendingStart(null) }} className={toolBtn('wall')}>{t('room.tool.wall')}</button>
          <button onClick={() => { setTool('door'); setPendingStart(null) }} className={toolBtn('door')} data-ui="room-door">{t('room.tool.door')}</button>
          <button onClick={() => { setTool('window'); setPendingStart(null) }} className={toolBtn('window')} data-ui="room-window">{t('room.tool.window')}</button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['w', 'd'] as const).map(k => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-500">{t(`room.${k}`)}</span>
              <input type="number" value={room[k]} disabled={closed}
                onChange={e => setWd(v => ({ ...v, [k]: Number(e.target.value) || 0 }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1.5 text-sm qb-num disabled:opacity-70" />
            </label>
          ))}
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">{t('room.h')}</span>
            <input type="number" value={h} onChange={e => setH(Number(e.target.value) || 0)} data-ui="room-h"
              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1.5 text-sm qb-num" />
          </label>
        </div>
        {closed && <div className="text-[11px] text-gray-400">{t('room.fromOutline')}</div>}
        {openings.length > 0 && (
          <div className="text-[11px] text-gray-300">
            {openings.map((o, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: o.kind === 'window' ? '#3b82c4' : '#9aa1ac' }} />
                {t(o.kind === 'window' ? 'room.tool.window' : 'room.tool.door')} · {Math.round(o.to - o.from)} cm
                <button onClick={() => setOpenings(list => list.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400 cursor-pointer ml-auto">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <button onClick={undo} disabled={!n} className="qb-btn qb-btn-ghost qb-btn-sm flex-1">{t('room.undo')}</button>
          <button onClick={() => { setPts([]); setClosed(false); setOpenings([]); setPendingStart(null); setTool('wall') }} disabled={!n} className="qb-btn qb-btn-ghost qb-btn-sm flex-1">{t('room.clear')}</button>
        </div>
        <button onClick={() => void save()} disabled={busy || !(h > 0) || (!closed && n > 0) || !(room.w > 0 && room.d > 0)} className="qb-btn" data-ui="room-save">{t('room.save')}</button>
        {!closed && n > 0 && <div className="text-[11px] text-amber-700">{t('room.notClosed')}</div>}
      </aside>
    </>
  )
}
