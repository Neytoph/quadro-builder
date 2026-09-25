import { useLayoutEffect, useRef, useState } from 'react'

// builder 自带的引导和共享方案的提示气泡共用这一套：压暗、挖空光圈、气泡卡片和它的摆法

export const PAD = 8
const CARD_W = 340

export type Prefer = 'left' | 'right' | 'bottom' | 'top'

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(min, n), max)
}

function placeCard(hole: DOMRect | null, prefer: Prefer, cardH: number) {
  const margin = 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(CARD_W, vw - margin * 2)
  const h = cardH
  if (!hole) return { top: Math.max(margin, (vh - h) / 2), left: Math.max(margin, (vw - w) / 2) }
  const midY = hole.top + hole.height / 2 - h / 2
  const midX = hole.left + hole.width / 2 - w / 2
  const right = hole.right + PAD + margin
  const left = hole.left - w - margin
  const below = hole.bottom + PAD + margin
  const above = hole.top - h - margin
  const order: Prefer[] = prefer === 'left'
    ? ['left', 'right', 'bottom', 'top']
    : prefer === 'right'
      ? ['right', 'left', 'bottom', 'top']
      : prefer === 'top'
        ? ['top', 'bottom', 'right', 'left']
        : ['bottom', 'top', 'right', 'left']
  for (const side of order) {
    if (side === 'right' && right + w <= vw - margin) return { top: clamp(midY, margin, vh - h - margin), left: right }
    if (side === 'left' && left >= margin) return { top: clamp(midY, margin, vh - h - margin), left: left }
    if (side === 'bottom' && below + h <= vh - margin) return { top: below, left: clamp(midX, margin, vw - w - margin) }
    if (side === 'top' && above >= margin) return { top: above, left: clamp(midX, margin, vw - w - margin) }
  }
  return { top: clamp(below, margin, vh - h - margin), left: clamp(midX, margin, vw - w - margin) }
}

function readTourRect(id: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${id}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return null
  return r
}

function sameRect(a: DOMRect | null, b: DOMRect | null) {
  if (!a || !b) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

/**
 * 量被指的东西（data-tour）和气泡自己的高度。开着的时候每一帧量一次、变了才更新：
 * 抽屉打开时先进场、再按内容加宽、为了让开工具条往下挪，窗口大小和滚动也会动它，一帧一量都跟得上
 */
export function useCoachMeasure(open: boolean, step: number, tour: string) {
  const [hole, setHole] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const measure = () => {
      const r = readTourRect(tour)
      setHole(h => (sameRect(h, r) ? h : r))
      const ch = cardRef.current?.offsetHeight
      if (ch && ch > 40) setCardH(ch)
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    return () => window.cancelAnimationFrame(frame)
  }, [open, step, tour])

  return { hole, cardRef, cardH }
}

export function CoachFrame(p: {
  hole: DOMRect | null
  prefer: Prefer
  cardRef: React.RefObject<HTMLDivElement | null>
  cardH: number
  ui: string
  kicker: string
  step: number
  count: number
  title: string
  body: string
  hint?: string
  /** 「高亮的地方可以点」那一行 */
  tryLine?: string
  skipLabel: string
  backLabel: string
  nextLabel: string
  onSkip: () => void
  onBack: () => void
  onNext: () => void
}) {
  const { hole, step } = p
  const spot = hole
    ? {
      top: hole.top - PAD,
      left: hole.left - PAD,
      width: hole.width + PAD * 2,
      height: hole.height + PAD * 2,
    }
    : null
  const card = placeCard(hole, p.prefer, p.cardH)
  const titleId = `${p.ui}-title`

  return (
    <div className="m-onb fixed inset-0 z-[80] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby={titleId} data-ui={p.ui} data-step={step + 1}>
      {spot ? (
        <>
          {/* 这五块在步骤之间滑过去（m-spot），四块遮罩和光圈用同一条曲线，接缝不会裂开 */}
          <div className="m-spot absolute bg-black/50 pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spot.top) }} />
          <div className="m-spot absolute bg-black/50 pointer-events-auto" style={{ top: spot.top + spot.height, left: 0, right: 0, bottom: 0 }} />
          <div className="m-spot absolute bg-black/50 pointer-events-auto" style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }} />
          <div className="m-spot absolute bg-black/50 pointer-events-auto" style={{ top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height }} />
          <div
            className="m-spot absolute rounded-2xl pointer-events-none shadow-[0_0_0_2px_#2dd4bf,0_0_0_6px_rgba(45,212,191,0.28)]"
            style={spot}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/50 pointer-events-auto" />
      )}

      <div
        ref={p.cardRef}
        className="m-card qb-card absolute w-[min(21.25rem,calc(100vw-1.5rem))] text-gray-100 p-4 pointer-events-auto"
        style={{ top: card.top, left: card.left }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] tracking-wide text-teal-400">
            {p.kicker} · {step + 1}/{p.count}
          </div>
          <button type="button" onClick={p.onSkip} className="text-gray-400 hover:text-teal-300 text-sm cursor-pointer" data-ui="coach-skip">
            {p.skipLabel}
          </button>
        </div>
        <div key={step} className="m-swap">
          <div id={titleId} className="text-base font-semibold mb-1.5">{p.title}</div>
          <p className="text-sm text-gray-300 leading-relaxed">{p.body}</p>
          {p.hint && (
            <p className="text-[12px] text-teal-300/90 leading-relaxed mt-2">{p.hint}</p>
          )}
          {p.tryLine && <p className="text-[11px] text-gray-500 mt-2">{p.tryLine}</p>}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 flex gap-1" aria-hidden="true">
            {Array.from({ length: p.count }, (_, k) => (
              <div key={k} className={`h-1 flex-1 rounded-full ${k <= step ? 'bg-teal-400' : 'bg-gray-700'}`} />
            ))}
          </div>
          {step > 0 && (
            <button type="button" onClick={p.onBack} className="qb-btn qb-btn-ghost qb-btn-sm" data-ui="coach-back">
              {p.backLabel}
            </button>
          )}
          <button type="button" autoFocus onClick={p.onNext} className="qb-btn qb-btn-sm" data-ui="coach-next">
            {p.nextLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
