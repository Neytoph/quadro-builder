import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useCollab } from '../CollabContext'
import type { Opening, Room } from '../api'
import { edgeLength, nearestEdge, pointOnEdge, roomFromDrawing, signedArea, snap, type Pt } from '../room'
import { errText } from './bits'

type Tool = 'wall' | 'door' | 'window'
type Box = { x: number; y: number; w: number; h: number }

/** 靠近前一个点的横平竖直：差不到 12 cm 就对齐 */
function straighten(p: Pt, prev: Pt | undefined): Pt {
  if (!prev) return p
  if (Math.abs(p[0] - prev[0]) < 12) return [prev[0], p[1]]
  if (Math.abs(p[1] - prev[1]) < 12) return [p[0], prev[1]]
  return p
}

/** 画布框住房间，四周留 60 cm；还没画就是一块 6 × 5 米的地 */
function fitBox(pts: Pt[]): Box {
  if (pts.length < 2) return { x: -60, y: -60, w: 720, h: 620 }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
  const m = 60
  return { x: x0 - m, y: y0 - m, w: Math.max(x1 - x0 + 2 * m, 400), h: Math.max(y1 - y0 + 2 * m, 320) }
}

/**
 * 画房间边界（从需求单进来，/builder/?room=brief:<id>）：俯视平面，单位厘米。
 * 点一下放一个角，回到起点闭合；拖角点改形状，选中一条边可以直接输长度。
 * 门和窗在墙上点两下定起止。宽和深取外框，高自己填。「完成」写回需求单并回去。
 */
export default function RoomEditor() {
  const collab = useCollab()
  const { t } = useI18n()
  const start = collab.room!
  const initial = useMemo(() => {
    const r = start.room
    return { pts: (r.outline || []).map(([x, z]) => [x, z] as Pt), openings: (r.openings || []).map(o => ({ ...o })) }
  }, [start])
  const [pts, setPts] = useState<Pt[]>(initial.pts)
  const [closed, setClosed] = useState(initial.pts.length >= 3)
  const [openings, setOpenings] = useState<Opening[]>(initial.openings)
  const [tool, setTool] = useState<Tool>('wall')
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [pendingStart, setPendingStart] = useState<{ edge: number; t: number } | null>(null)
  const [edge, setEdge] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [h, setH] = useState(start.room.h || 240)
  const [wd, setWd] = useState({ w: start.room.w || 300, d: start.room.d || 400 })
  const [box, setBox] = useState<Box>(() => fitBox(initial.pts))
  const [busy, setBusy] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const room: Room = roomFromDrawing(closed ? pts : [], closed ? openings : [], h, wd)
  const n = pts.length

  const toPlan = (ev: { clientX: number; clientY: number }): Pt | null => {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return null
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse())
    return [snap(p.x), snap(p.y)]
  }

  const down = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return
    const raw = toPlan(ev)
    if (!raw) return
    if (tool === 'wall') {
      if (closed) {
        // 边界画好以后：点在边上选中这条边，改长度
        const hit = nearestEdge(pts, raw)
        setEdge(hit.dist < 12 ? hit.edge : null)
        return
      }
      const p = straighten(raw, pts[n - 1])
      if (n >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 15) { setClosed(true); setCursor(null); return }
      setPts(list => [...list, p])
      return
    }
    if (!closed) { collab.report(t('room.closeFirst')); return }
    const hit = nearestEdge(pts, raw)
    if (hit.edge < 0 || hit.dist > 30) return
    const at = snap(hit.t)
    if (!pendingStart || pendingStart.edge !== hit.edge) { setPendingStart({ edge: hit.edge, t: at }); return }
    setPendingStart(null)
    if (Math.abs(at - pendingStart.t) < 20) return
    setOpenings(list => [...list, { kind: tool, edge: hit.edge, from: Math.min(at, pendingStart.t), to: Math.max(at, pendingStart.t) }])
  }

  const move = (ev: React.PointerEvent) => {
    const p = toPlan(ev)
    if (!p) return
    if (drag != null) { setPts(list => list.map((q, i) => (i === drag ? p : q))); return }
    setCursor(tool === 'wall' && !closed ? straighten(p, pts[n - 1]) : p)
  }

  useEffect(() => {
    if (drag == null) return
    const up = () => { setDrag(null); setBox(fitBox(pts)) }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [drag, pts])

  // 选中的边直接输长度：终点沿这条边挪到那个长度
  const setEdgeLength = (i: number, len: number) => {
    if (!(len > 0)) return
    setPts(list => {
      const a = list[i], b = list[(i + 1) % list.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const nb: Pt = [Math.round(a[0] + (b[0] - a[0]) * len / L), Math.round(a[1] + (b[1] - a[1]) * len / L)]
      return list.map((q, j) => (j === (i + 1) % list.length ? nb : q))
    })
  }

  const clear = () => {
    setPts([]); setClosed(false); setOpenings([]); setPendingStart(null); setEdge(null); setTool('wall'); setBox(fitBox([]))
  }

  const save = async () => {
    setBusy(true)
    try {
      await collab.saveRoom(room)
    } catch (err) {
      collab.report(errText(err))
      setBusy(false)
    }
  }

  const valid = h > 0 && room.w > 0 && room.d > 0 && (closed || n === 0)
  const edges = closed ? n : Math.max(0, n - 1)
  const at = (i: number, tt: number) => pointOnEdge(pts, i, tt)
  const pending: [Pt, Pt] | null = (() => {
    if (!pendingStart || !cursor || !closed) return null
    const hit = nearestEdge(pts, cursor)
    return hit.edge === pendingStart.edge ? [at(hit.edge, pendingStart.t), at(hit.edge, snap(hit.t))] : null
  })()
  // 边长标在边的外侧：顺时针画的轮廓外侧在前进方向的左手边，逆时针反过来
  const side = n >= 3 && signedArea(pts) < 0 ? -1 : 1
  const label = (i: number) => {
    const a = pts[i], b = pts[(i + 1) % n]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const L = Math.hypot(dx, dy) || 1
    return { x: (a[0] + b[0]) / 2 + dy / L * 16 * side, y: (a[1] + b[1]) / 2 - dx / L * 16 * side, len: Math.round(L), rot: Math.abs(dx) < Math.abs(dy) ? 90 : 0 }
  }
  const pop = edge != null && closed && svg.current ? (() => {
    const m = svg.current.getScreenCTM()
    const a = pts[edge], b = pts[(edge + 1) % n]
    if (!m) return null
    const p = new DOMPoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2).matrixTransform(m)
    return { left: p.x + 14, top: p.y + 14 }
  })() : null

  return (
    <>
      <div className="cb-roomtop">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
        <span className="tab">{t('room.tab', { title: start.title })}</span>
        <span className="flex-1" />
        <button type="button" className="qb-btn qb-btn-sm" disabled={!valid || busy} onClick={() => void save()} data-ui="room-save">{t('room.done')}</button>
      </div>
      <div className="cb-roomstage">
        <svg ref={svg} className="plan" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={down} onPointerMove={move} onPointerLeave={() => setCursor(null)} data-ui="room-plan"
          style={{ cursor: tool === 'wall' && closed ? 'default' : 'crosshair' }}>
          <defs>
            <pattern id="rg10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#EADFD2" strokeWidth=".4" /></pattern>
            <pattern id="rg50" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#rg10)" /><path d="M50 0H0V50" fill="none" stroke="#DCCDBC" strokeWidth=".8" /></pattern>
          </defs>
          <rect x={box.x - 1000} y={box.y - 1000} width={box.w + 2000} height={box.h + 2000} fill="url(#rg50)" />
          {closed && n >= 3 && <polygon points={pts.map(p => p.join(',')).join(' ')} fill="#FFF1E6" stroke="#EA580C" strokeWidth="3" strokeLinejoin="round" />}
          {!closed && n >= 2 && <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke="#EA580C" strokeWidth="3" strokeLinejoin="round" />}
          {!closed && n >= 1 && cursor && tool === 'wall' && <line x1={pts[n - 1][0]} y1={pts[n - 1][1]} x2={cursor[0]} y2={cursor[1]} stroke="#EA580C" strokeWidth="2" strokeDasharray="6 4" />}
          {edge != null && closed && <line x1={pts[edge][0]} y1={pts[edge][1]} x2={pts[(edge + 1) % n][0]} y2={pts[(edge + 1) % n][1]} stroke="#9A3412" strokeWidth="5" strokeLinecap="round" />}
          {closed && openings.map((o, i) => {
            const a = at(o.edge, o.from), b = at(o.edge, o.to)
            if (o.kind === 'window') return (
              <g key={i}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#5A9BD5" strokeWidth="7" /><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fff" strokeWidth="1.2" /></g>
            )
            // 门：墙上留一个口，画出门扇和开门的弧
            const e0 = pts[o.edge], e1 = pts[(o.edge + 1) % n]
            const L = edgeLength(pts, o.edge) || 1
            const ux = (e1[0] - e0[0]) / L, uy = (e1[1] - e0[1]) / L
            const w = o.to - o.from
            const leaf: Pt = [a[0] - uy * w, a[1] + ux * w]
            return (
              <g key={i}>
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#F6EFE7" strokeWidth="5" />
                <line x1={a[0]} y1={a[1]} x2={leaf[0]} y2={leaf[1]} stroke="#8A8278" strokeWidth="2" />
                <path d={`M${b[0]} ${b[1]} A${w} ${w} 0 0 1 ${leaf[0]} ${leaf[1]}`} fill="none" stroke="#8A8278" strokeWidth="1.2" strokeDasharray="3 2" />
              </g>
            )
          })}
          {pending && <line x1={pending[0][0]} y1={pending[0][1]} x2={pending[1][0]} y2={pending[1][1]} stroke={tool === 'window' ? '#5A9BD5' : '#8A8278'} strokeWidth="7" opacity=".6" />}
          {Array.from({ length: edges }, (_, i) => {
            const l = label(i)
            return <text key={i} x={l.x} y={l.y} fontSize="11" fontWeight="700" fill="#5A6270" textAnchor="middle" dominantBaseline="middle"
              transform={l.rot ? `rotate(90 ${l.x} ${l.y})` : undefined} style={{ fontFamily: 'var(--cb-num)', pointerEvents: 'none' }}>{l.len}</text>
          })}
          {pts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 && !closed ? 7 : 5} fill={i === 0 && !closed ? '#EA580C' : '#fff'} stroke="#EA580C" strokeWidth="2"
              style={{ cursor: closed && tool === 'wall' ? 'grab' : 'pointer' }} data-ui="room-corner"
              onPointerDown={ev => {
                if (!closed || tool !== 'wall') return
                ev.stopPropagation()
                setEdge(null)
                setDrag(i)
              }} />
          ))}
        </svg>
        {pop && edge != null && (
          <div className="cb-edgepop qb-card" style={{ left: pop.left, top: pop.top }} data-ui="room-edge-pop">
            {t('room.edgeN', { n: edge + 1 })}
            <input type="number" defaultValue={Math.round(edgeLength(pts, edge))} key={`${edge}:${Math.round(edgeLength(pts, edge))}`}
              aria-label={t('room.edgeLen')} onKeyDown={e => { if (e.key === 'Enter') setEdgeLength(edge, Number((e.target as HTMLInputElement).value)) }}
              onBlur={e => setEdgeLength(edge, Number(e.target.value))} /> cm
          </div>
        )}
        <div className="cb-roomtip"><span className="qb-card">{t(closed ? (tool === 'wall' ? 'room.tipClosed' : 'room.tipOpening') : 'room.tipDraw')}</span></div>
      </div>
      <aside className="cb-roompanel qb-card" data-ui="room-editor">
        <h3>{t('room.title')}</h3>
        <p className="s">{t('room.body')}</p>
        <div className="cb-dims">
          {(['w', 'd'] as const).map(k => (
            <label key={k}>{t(`room.${k}`)}
              <span className={closed ? 'ro' : ''}>
                {closed ? room[k] : <input type="number" value={wd[k]} onChange={e => setWd(v => ({ ...v, [k]: Number(e.target.value) || 0 }))} />}
                <small>cm</small>
              </span>
            </label>
          ))}
          <label>{t('room.h')}<span><input type="number" value={h} onChange={e => setH(Number(e.target.value) || 0)} data-ui="room-h" /><small>cm</small></span></label>
        </div>
        <div className="cb-rtools">
          {(['wall', 'door', 'window'] as const).map(k => (
            <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setPendingStart(null); setEdge(null) }} data-ui={`room-${k}`}>
              {k === 'wall' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20 4 4h16v10H10v6z" /></svg>}
              {k === 'door' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V4h10v16M4 20h16M14 4a10 10 0 0 1 6 9" /></svg>}
              {k === 'window' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="6" rx="1" /><path d="M3 12h18" /></svg>}
              {t(`room.tool.${k}`)}
            </button>
          ))}
        </div>
        {openings.length > 0 && (
          <div className="cb-open">
            {openings.map((o, i) => (
              <div key={i}><i className={o.kind === 'window' ? 'win' : 'door'} /><b>{t(`room.tool.${o.kind}Short`)}</b>
                <span>{t('room.onEdge', { n: o.edge + 1, from: Math.round(o.from), to: Math.round(o.to) })}</span>
                <button type="button" aria-label="×" onClick={() => setOpenings(list => list.filter((_, j) => j !== i))}>×</button></div>
            ))}
          </div>
        )}
        {edge != null && closed && (
          <div className="cb-open"><div className="on"><i style={{ background: '#9A3412' }} /><b>{t('room.selected')}</b><span>{t('room.edgeLenN', { n: edge + 1, len: Math.round(edgeLength(pts, edge)) })}</span><span /></div></div>
        )}
        {!closed && n > 0 && <div className="cb-hint" style={{ padding: 0, color: '#B45309' }}>{t('room.notClosed')}</div>}
        <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" disabled={!n} onClick={clear}>{t('room.clear')}</button>
      </aside>
    </>
  )
}
