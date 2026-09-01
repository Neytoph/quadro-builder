import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const KEY_V1 = 'quadro.ui.widths.v1'
const KEY = 'quadro.ui.layout.v2'
export const PANEL_GAP = 12
export const TAB_BAR_H = 32
export const TOP_MIN = TAB_BAR_H + PANEL_GAP

export const LEFT_DEFAULT = 192
export const RIGHT_DEFAULT = 264
const LEFT_MIN = 160
const LEFT_MAX = 360
const RIGHT_MIN = 196
const RIGHT_MAX = 448
export const HEIGHT_MIN = 180

/** 视角方块边长 / 外边距，与 scene.js 的 CUBE_PX / CUBE_MARGIN 一致。 */
export const VIEW_CUBE_PX = 104
export const VIEW_CUBE_MARGIN = 14

export type PanelBox = { width: number; top: number; height: number }
type Side = 'left' | 'right'
type Dir = 'ew' | 'ns' | 'move'

type Ctx = {
  left: PanelBox
  right: PanelBox
  vw: number
  vh: number
  patchLeft: (p: Partial<PanelBox>) => void
  patchRight: (p: Partial<PanelBox>) => void
}

const PanelCtx = createContext<Ctx | null>(null)

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function viewport() {
  return { vw: window.innerWidth, vh: window.innerHeight }
}

function defaultHeight(vh: number) {
  return Math.max(HEIGHT_MIN, vh - TOP_MIN - PANEL_GAP)
}

export function clampBox(box: PanelBox, side: Side, vh: number): PanelBox {
  const minW = side === 'left' ? LEFT_MIN : RIGHT_MIN
  const maxW = side === 'left' ? LEFT_MAX : RIGHT_MAX
  const width = clamp(box.width, minW, maxW)
  const maxH = Math.max(HEIGHT_MIN, vh - TOP_MIN - PANEL_GAP)
  const height = clamp(box.height, HEIGHT_MIN, maxH)
  const maxTop = Math.max(TOP_MIN, vh - PANEL_GAP - height)
  const top = clamp(box.top, TOP_MIN, maxTop)
  return { width, top, height }
}

function readBox(raw: unknown, side: Side, vh: number, fallbackW: number): PanelBox {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  return clampBox({
    width: Number(o.width) || fallbackW,
    top: Number(o.top) || TOP_MIN,
    height: Number(o.height) || defaultHeight(vh),
  }, side, vh)
}

function load(vh: number): { left: PanelBox; right: PanelBox } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '') as { left?: unknown; right?: unknown }
    if (raw && (raw.left || raw.right)) {
      return {
        left: readBox(raw.left, 'left', vh, LEFT_DEFAULT),
        right: readBox(raw.right, 'right', vh, RIGHT_DEFAULT),
      }
    }
  } catch { /* fall through */ }
  try {
    const v1 = JSON.parse(localStorage.getItem(KEY_V1) || '') as { left?: number; right?: number }
    const h = defaultHeight(vh)
    return {
      left: clampBox({ width: Number(v1.left) || LEFT_DEFAULT, top: TOP_MIN, height: h }, 'left', vh),
      right: clampBox({ width: Number(v1.right) || RIGHT_DEFAULT, top: TOP_MIN, height: h }, 'right', vh),
    }
  } catch {
    const h = defaultHeight(vh)
    return {
      left: { width: LEFT_DEFAULT, top: TOP_MIN, height: h },
      right: { width: RIGHT_DEFAULT, top: TOP_MIN, height: h },
    }
  }
}

export function panelStyle(side: Side, box: PanelBox): CSSProperties {
  return {
    width: box.width,
    height: box.height,
    top: box.top,
    ...(side === 'left' ? { left: PANEL_GAP } : { right: PANEL_GAP }),
  }
}

/** Left edge of the canvas strip beside the left panel. */
export function canvasInset(box: PanelBox) {
  return PANEL_GAP + box.width + PANEL_GAP
}

/** 视角方块相对画布的额外上/右边距，避开顶栏和右栏。 */
export function viewCubePad(right: PanelBox, open = true) {
  const top = Math.max(0, TOP_MIN - VIEW_CUBE_MARGIN)
  const cubeTop = VIEW_CUBE_MARGIN + top
  const cubeBottom = cubeTop + VIEW_CUBE_PX
  const overlaps = open && right.top < cubeBottom + PANEL_GAP && right.top + right.height > cubeTop - PANEL_GAP
  return { top, right: overlaps ? PANEL_GAP + right.width : 0 }
}

export function PanelLayoutProvider({ children }: { children: ReactNode }) {
  const [{ vw, vh }, setVp] = useState(viewport)
  const [layout, setLayout] = useState(() => load(viewport().vh))

  useEffect(() => {
    const on = () => setVp(viewport())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  useEffect(() => {
    setLayout(cur => {
      const next = {
        left: clampBox(cur.left, 'left', vh),
        right: clampBox(cur.right, 'right', vh),
      }
      const same = (a: PanelBox, b: PanelBox) => a.width === b.width && a.top === b.top && a.height === b.height
      if (same(next.left, cur.left) && same(next.right, cur.right)) return cur
      return next
    })
  }, [vh])

  useEffect(() => {
    const id = window.setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(layout)) } catch { /* ignore */ }
    }, 160)
    return () => window.clearTimeout(id)
  }, [layout])

  const patchLeft = useCallback((p: Partial<PanelBox>) => {
    setLayout(cur => ({ ...cur, left: clampBox({ ...cur.left, ...p }, 'left', window.innerHeight) }))
  }, [])
  const patchRight = useCallback((p: Partial<PanelBox>) => {
    setLayout(cur => ({ ...cur, right: clampBox({ ...cur.right, ...p }, 'right', window.innerHeight) }))
  }, [])

  const value = useMemo(
    () => ({ left: layout.left, right: layout.right, vw, vh, patchLeft, patchRight }),
    [layout, vw, vh, patchLeft, patchRight],
  )
  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>
}

export function usePanelLayout() {
  const ctx = useContext(PanelCtx)
  if (!ctx) throw new Error('usePanelLayout')
  return ctx
}

function setResizeCursor(dir: Dir | null) {
  document.body.classList.toggle('resizing-panels', !!dir)
  if (dir) document.body.dataset.resizeDir = dir
  else delete document.body.dataset.resizeDir
}

export function PanelHandles({ side, moveLabel, sizeLabel }: {
  side: Side
  moveLabel: string
  sizeLabel: string
}) {
  const { left, right, vh, patchLeft, patchRight } = usePanelLayout()
  const box = side === 'left' ? left : right
  const patch = side === 'left' ? patchLeft : patchRight
  const minW = side === 'left' ? LEFT_MIN : RIGHT_MIN
  const maxW = side === 'left' ? LEFT_MAX : RIGHT_MAX
  const drag = useRef<{ kind: Dir | 'n' | 's'; x: number; y: number; box: PanelBox; on: boolean }>({
    kind: 'ew', x: 0, y: 0, box, on: false,
  })

  const endDrag = () => {
    drag.current.on = false
    setResizeCursor(null)
  }

  const begin = (kind: typeof drag.current.kind, dir: Dir, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, x: e.clientX, y: e.clientY, box, on: true }
    setResizeCursor(dir)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.on) return
    const start = drag.current.box
    const kind = drag.current.kind
    if (kind === 'ew') {
      const dx = e.clientX - drag.current.x
      patch({ width: side === 'left' ? start.width + dx : start.width - dx })
      return
    }
    if (kind === 'move') {
      const desiredTop = start.top + (e.clientY - drag.current.y)
      const bottomLimit = window.innerHeight - PANEL_GAP
      const top = clamp(desiredTop, TOP_MIN, bottomLimit - HEIGHT_MIN)
      const height = Math.min(start.height, bottomLimit - top)
      patch({ top, height })
      return
    }
    if (kind === 'n') {
      const bottom = start.top + start.height
      const top = clamp(e.clientY, TOP_MIN, bottom - HEIGHT_MIN)
      patch({ top, height: bottom - top })
      return
    }
    if (kind === 's') {
      patch({ height: e.clientY - start.top })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    endDrag()
  }

  const edge = (kind: 'n' | 's' | 'ew', extra: string) => (
    <div
      role="separator"
      aria-label={sizeLabel}
      tabIndex={0}
      title={sizeLabel}
      onPointerDown={e => begin(kind, kind === 'ew' ? 'ew' : 'ns', e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={endDrag}
      onKeyDown={e => {
        const step = e.shiftKey ? 24 : 8
        if (kind === 'ew' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault()
          const dir = e.key === 'ArrowRight' ? 1 : -1
          patch({ width: box.width + (side === 'left' ? dir : -dir) * step })
        } else if (kind !== 'ew' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          const dir = e.key === 'ArrowDown' ? 1 : -1
          if (kind === 's') patch({ height: box.height + dir * step })
          else patch({ top: box.top + dir * step, height: box.height - dir * step })
        } else if (e.key === 'Home') {
          e.preventDefault()
          if (kind === 'ew') patch({ width: minW })
          else if (kind === 'n') patch({ top: TOP_MIN, height: box.top + box.height - TOP_MIN })
        } else if (e.key === 'End') {
          e.preventDefault()
          if (kind === 'ew') patch({ width: maxW })
          else if (kind === 's') patch({ height: vh - PANEL_GAP - box.top })
        }
      }}
      className={`absolute z-20 touch-none group outline-none focus-visible:ring-1 focus-visible:ring-teal-400 ${extra}`}
      data-panel-chrome=""
    >
      <span className={`absolute rounded-full bg-gray-600/0 group-hover:bg-teal-400/80 group-focus-visible:bg-teal-400 group-active:bg-teal-300 ${
        kind === 'ew' ? 'inset-y-6 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-6 top-1/2 h-0.5 -translate-y-1/2'
      }`} />
    </div>
  )

  return (
    <>
      <div
        role="slider"
        aria-label={moveLabel}
        aria-valuemin={TOP_MIN}
        aria-valuemax={Math.max(TOP_MIN, vh - PANEL_GAP - HEIGHT_MIN)}
        aria-valuenow={box.top}
        aria-orientation="vertical"
        tabIndex={0}
        title={moveLabel}
        onPointerDown={e => begin('move', 'move', e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={endDrag}
        onKeyDown={e => {
          const step = e.shiftKey ? 24 : 8
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const desiredTop = box.top + (e.key === 'ArrowDown' ? step : -step)
            const bottomLimit = vh - PANEL_GAP
            const top = clamp(desiredTop, TOP_MIN, bottomLimit - HEIGHT_MIN)
            patch({ top, height: Math.min(box.height, bottomLimit - top) })
          } else if (e.key === 'Home') {
            e.preventDefault()
            patch({ top: TOP_MIN })
          } else if (e.key === 'End') {
            e.preventDefault()
            patch({ top: vh - PANEL_GAP - box.height })
          }
        }}
        className="shrink-0 h-3.5 cursor-grab active:cursor-grabbing touch-none flex items-center justify-center group outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
        data-panel-chrome=""
      >
        <span className="w-10 h-1 rounded-full bg-gray-600 group-hover:bg-teal-400 group-focus-visible:bg-teal-400" />
      </div>
      {edge('n', 'top-0 left-2 right-2 h-1 cursor-ns-resize')}
      {edge('s', 'bottom-0 left-2 right-2 h-1.5 cursor-ns-resize')}
      {edge('ew', side === 'left' ? 'top-0 bottom-0 right-0 w-2 cursor-ew-resize' : 'top-0 bottom-0 left-0 w-2 cursor-ew-resize')}
    </>
  )
}
