import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const KEY_V1 = 'quadro.ui.widths.v1'
const KEY_V2 = 'quadro.ui.layout.v2'
const KEY = 'quadro.ui.layout.v3'
export const PANEL_GAP = 12
export const TAB_BAR_H = 44
export const NARROW_MAX = 767
export const TOP_MIN = TAB_BAR_H + PANEL_GAP
export const TOOLBAR_H = 56

export const LEFT_DEFAULT = 192
export const RIGHT_DEFAULT = 264
const LEFT_MIN = 160
const LEFT_MAX = 360
const RIGHT_MIN = 196
const RIGHT_MAX = 448
export const HEIGHT_MIN = 180

/** 草地 / 框住：固定小方块，贴在左栏右侧画布角。 */
export const CORNER_TILE = 40
export const VIEW_CUBE_PX = 80
export const VIEW_CUBE_MARGIN = 22
export const SCENE_TOGGLE_PX = CORNER_TILE
export const SCENE_CLUSTER_GAP = 8
export const SCENE_CLUSTER_W = CORNER_TILE * 2 + SCENE_CLUSTER_GAP
export const CORNER_BOTTOM = 16
export const CORNER_BOTTOM_NARROW = 72
/** 左栏拖动手柄 h-3.5 + 栏内 gap-2，窄屏没有手柄。 */
export const LEFT_MOVE_HANDLE_H = 14
export const LEFT_STACK_GAP = 8

export type PanelBox = { width: number; top: number; height: number }
type Side = 'left' | 'right'
type Dir = 'ew' | 'ns' | 'move'

type Ctx = {
  left: PanelBox
  right: PanelBox
  vw: number
  vh: number
  leftColor: boolean
  leftKeys: boolean
  patchLeft: (p: Partial<PanelBox>) => void
  patchRight: (p: Partial<PanelBox>) => void
  setLeftColor: (on: boolean) => void
  setLeftKeys: (on: boolean) => void
  toggleLeftColor: () => void
  toggleLeftKeys: () => void
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

type StoredLayout = { left?: unknown; right?: unknown; leftColor?: boolean; leftKeys?: boolean }

function flagsOf(raw: StoredLayout | null) {
  return {
    leftColor: raw?.leftColor !== false,
    leftKeys: raw?.leftKeys !== false,
  }
}

function load(vh: number): { left: PanelBox; right: PanelBox; leftColor: boolean; leftKeys: boolean } {
  const empty = () => {
    const h = defaultHeight(vh)
    return {
      left: { width: LEFT_DEFAULT, top: TOP_MIN, height: h },
      right: { width: RIGHT_DEFAULT, top: TOP_MIN, height: h },
      leftColor: true,
      leftKeys: true,
    }
  }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(KEY_V2) || '') as StoredLayout
    if (raw && (raw.left || raw.right)) {
      return {
        left: readBox(raw.left, 'left', vh, LEFT_DEFAULT),
        right: readBox(raw.right, 'right', vh, RIGHT_DEFAULT),
        ...flagsOf(raw),
      }
    }
  } catch { /* fall through */ }
  try {
    const v1 = JSON.parse(localStorage.getItem(KEY_V1) || '') as { left?: number; right?: number }
    const h = defaultHeight(vh)
    return {
      left: clampBox({ width: Number(v1.left) || LEFT_DEFAULT, top: TOP_MIN, height: h }, 'left', vh),
      right: clampBox({ width: Number(v1.right) || RIGHT_DEFAULT, top: TOP_MIN, height: h }, 'right', vh),
      leftColor: true,
      leftKeys: true,
    }
  } catch {
    return empty()
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

export function leftColumnWidth(box: PanelBox, vw: number) {
  return vw <= NARROW_MAX ? Math.min(box.width, vw - PANEL_GAP * 2) : box.width
}

/** 草地 / 框住贴左栏右侧顶上；视角方块在画布右下，避开右侧抽屉。 */
export function canvasCorner(left: PanelBox, vw: number, extras: { right?: PanelBox; dockOpen?: boolean } = {}) {
  const narrow = vw <= NARROW_MAX
  const tile = SCENE_TOGGLE_PX
  const clusterW = tile * 2 + SCENE_CLUSTER_GAP
  const bottom = narrow ? CORNER_BOTTOM_NARROW : CORNER_BOTTOM
  const sceneLeft = Math.min(
    canvasInset(left),
    Math.max(PANEL_GAP, vw - clusterW - PANEL_GAP),
  )
  const stackTop = narrow ? TOP_MIN + TOOLBAR_H + PANEL_GAP : left.top
  const sceneTop = stackTop + (narrow ? 0 : LEFT_MOVE_HANDLE_H + LEFT_STACK_GAP)
  const cubeSize = VIEW_CUBE_PX
  const rightInset = !narrow && extras.dockOpen && extras.right
    ? extras.right.width + PANEL_GAP * 2
    : PANEL_GAP
  return {
    beside: true,
    tile,
    cubeSize,
    clusterW,
    stackH: tile,
    sceneLeft,
    sceneTop,
    frameLeft: sceneLeft,
    toggleLeft: sceneLeft,
    toggleBottom: bottom,
    frameBottom: bottom,
    sceneBottom: bottom,
    cubePadRight: Math.max(0, rightInset - VIEW_CUBE_MARGIN),
    cubePadBottom: Math.max(0, bottom - VIEW_CUBE_MARGIN),
    clusterBottom: bottom,
  }
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
        ...cur,
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
  const setLeftColor = useCallback((on: boolean) => {
    setLayout(cur => (cur.leftColor === on ? cur : { ...cur, leftColor: on }))
  }, [])
  const setLeftKeys = useCallback((on: boolean) => {
    setLayout(cur => (cur.leftKeys === on ? cur : { ...cur, leftKeys: on }))
  }, [])
  const toggleLeftColor = useCallback(() => {
    setLayout(cur => ({ ...cur, leftColor: !cur.leftColor }))
  }, [])
  const toggleLeftKeys = useCallback(() => {
    setLayout(cur => ({ ...cur, leftKeys: !cur.leftKeys }))
  }, [])

  const value = useMemo(
    () => ({
      left: layout.left,
      right: layout.right,
      vw,
      vh,
      leftColor: layout.leftColor,
      leftKeys: layout.leftKeys,
      patchLeft,
      patchRight,
      setLeftColor,
      setLeftKeys,
      toggleLeftColor,
      toggleLeftKeys,
    }),
    [layout, vw, vh, patchLeft, patchRight, setLeftColor, setLeftKeys, toggleLeftColor, toggleLeftKeys],
  )
  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>
}

export function usePanelLayout() {
  const ctx = useContext(PanelCtx)
  if (!ctx) throw new Error('usePanelLayout')
  return ctx
}

/** 左栏卡片标题：整行可点，箭头收起 / 展开。 */
export function FoldHeader({
  open,
  onToggle,
  label,
  title,
  children,
}: {
  open: boolean
  onToggle: () => void
  label: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={title}
      className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 shrink-0 text-left cursor-pointer hover:bg-white/[0.04] transition-colors ${
        open ? 'border-b border-gray-800' : ''
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        className={`shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        aria-hidden
      >
        <path d="M6 3.5 L11 8 L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="flex-1 min-w-0 text-[10px] uppercase tracking-wider text-gray-400 truncate">{label}</span>
      {children}
    </button>
  )
}

function setResizeCursor(dir: Dir | null) {
  document.body.classList.toggle('resizing-panels', !!dir)
  if (dir) document.body.dataset.resizeDir = dir
  else delete document.body.dataset.resizeDir
}

export function PanelHandles({ side, moveLabel, sizeLabel, hug, showMove = true }: {
  side: Side
  moveLabel: string
  sizeLabel: string
  hug?: boolean
  showMove?: boolean
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
      {showMove && <div
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
      </div>}
      {!hug && edge('n', 'top-0 left-2 right-2 h-1 cursor-ns-resize')}
      {!hug && edge('s', 'bottom-0 left-2 right-2 h-1.5 cursor-ns-resize')}
      {edge('ew', side === 'left' ? 'top-0 bottom-0 right-0 w-2 cursor-ew-resize' : 'top-0 bottom-0 left-0 w-2 cursor-ew-resize')}
    </>
  )
}
