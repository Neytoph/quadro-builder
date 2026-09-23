import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { UI_ESCAPE_EVENT } from './events'
import { useDock, type DockPane } from './dock'
import { usePanelLayout } from './panelLayout'
import { track } from '../analytics/track'

const KEY = 'quadro.builder.onboarded.v2'
export const ONBOARDING_EVENT = 'quadro:onboarding'

const PAD = 8
const CARD_W = 340

type Prefer = 'left' | 'right' | 'bottom' | 'top'

const STEPS: Array<{
  title: string
  body: string
  hint?: string
  tour: string
  pane: DockPane | null
  color?: boolean
  prefer: Prefer
}> = [
  { title: 'onboard.s1title', body: 'onboard.s1body', hint: 'onboard.s1hint', tour: 'dock-panel', pane: 'library', prefer: 'left' },
  { title: 'onboard.s2title', body: 'onboard.s2body', hint: 'onboard.s2hint', tour: 'tool-tubes', pane: null, prefer: 'bottom' },
  { title: 'onboard.s3title', body: 'onboard.s3body', tour: 'left-color', pane: null, color: true, prefer: 'right' },
  { title: 'onboard.s4title', body: 'onboard.s4body', tour: 'dock-panel', pane: 'bom', prefer: 'left' },
  { title: 'onboard.s5title', body: 'onboard.s5body', tour: 'scene-buttons', pane: null, prefer: 'bottom' },
  { title: 'onboard.s6title', body: 'onboard.s6body', hint: 'onboard.s6hint', tour: 'dock-panel', pane: 'file', prefer: 'left' },
]

function shouldOpen(): boolean {
  try { return localStorage.getItem(KEY) !== '1' } catch { return true }
}

function markDone() {
  try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
}

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

export default function Onboarding() {
  const { t } = useI18n()
  const { setPane } = useDock()
  const { setLeftColor } = usePanelLayout()
  const [open, setOpen] = useState(shouldOpen)
  const [i, setI] = useState(0)
  const [hole, setHole] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)

  const step = STEPS[i]
  const last = i >= STEPS.length - 1

  // how: done=走到最后一步、skip=点了跳过、esc=按 Esc 关掉。
  // 三者分开记，因为它们说明的事完全不同——skip 是引导没用，
  // esc 多半是挡着视线了。
  const finish = (how: 'done' | 'skip' | 'esc') => {
    track('builder.onboard.end', { how, step: i + 1, of: STEPS.length })
    markDone()
    setOpen(false)
    setI(0)
    setPane(null)
  }

  // 引导开着的时候人离开了页面（关掉、刷新、跳走），也算看过。
  // 只在走完、跳过、按 Esc 的时候才记的话，看到一半就走的人下次进来引导又从头弹一遍，
  // 第一步还把右边的模型库打开——每次进来都得先把它关掉。想再看一遍，文件面板里有重看引导的入口。
  // 不在引导一出现就记：启动的时候这个组件会挂上不止一次，第一次一记，第二次就不弹了
  useEffect(() => {
    if (!open) return
    window.addEventListener('pagehide', markDone)
    return () => window.removeEventListener('pagehide', markDone)
  }, [open])

  useEffect(() => {
    const replay = () => { track('builder.onboard.replay'); setI(0); setOpen(true) }
    window.addEventListener(ONBOARDING_EVENT, replay)
    return () => window.removeEventListener(ONBOARDING_EVENT, replay)
  }, [])

  // deps 里要带上 i：finish 现在会把"停在第几步"发出去，只依赖 open 的话
  // 这里闭包住的是引导刚打开那一刻的 i，按 Esc 永远报第 1 步。
  useEffect(() => {
    if (!open) return
    const onEsc = () => finish('esc')
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [open, i])

  useEffect(() => {
    if (!open || !step) return
    setPane(step.pane)
    if (step.color) setLeftColor(true)
  }, [open, i, step, setPane, setLeftColor])

  useLayoutEffect(() => {
    if (!open || !step) return
    let dead = false
    const measure = () => {
      if (dead) return
      setHole(readTourRect(step.tour))
      const ch = cardRef.current?.offsetHeight
      if (ch && ch > 40) setCardH(ch)
    }
    measure()
    const a = window.requestAnimationFrame(measure)
    const t1 = window.setTimeout(measure, 80)
    const t2 = window.setTimeout(measure, 220)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      dead = true
      window.cancelAnimationFrame(a)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, i, step])

  if (!open || !step) return null

  const spot = hole
    ? {
      top: hole.top - PAD,
      left: hole.left - PAD,
      width: hole.width + PAD * 2,
      height: hole.height + PAD * 2,
    }
    : null
  const card = placeCard(hole, step.prefer, cardH)

  return (
    <div className="m-onb fixed inset-0 z-[80] pointer-events-none" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
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
        ref={cardRef}
        className="m-card absolute w-[min(21.25rem,calc(100vw-1.5rem))] bg-gray-900 text-gray-100 rounded-2xl border border-gray-700 shadow-2xl p-4 pointer-events-auto"
        style={{ top: card.top, left: card.left }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] tracking-wide text-teal-400">
            {t('onboard.kicker')} · {i + 1}/{STEPS.length}
          </div>
          <button type="button" onClick={() => finish('skip')} className="text-gray-400 hover:text-teal-300 text-sm cursor-pointer">
            {t('onboard.skip')}
          </button>
        </div>
        <div key={i} className="m-swap">
          <div id="onboard-title" className="text-base font-semibold mb-1.5">{t(step.title)}</div>
          <p className="text-sm text-gray-300 leading-relaxed">{t(step.body)}</p>
          {step.hint && (
            <p className="text-[12px] text-teal-300/90 leading-relaxed mt-2">{t(step.hint)}</p>
          )}
          <p className="text-[11px] text-gray-500 mt-2">{t('onboard.try')}</p>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 flex gap-1" aria-hidden="true">
            {STEPS.map((_, k) => (
              <div key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-teal-400' : 'bg-gray-700'}`} />
            ))}
          </div>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 cursor-pointer">
              {t('onboard.back')}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => { if (last) finish('done'); else { track('builder.onboard.step', { i: i + 2 }); setI(i + 1) } }}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-500 hover:bg-teal-400 text-white cursor-pointer"
          >
            {last ? t('onboard.done') : t('onboard.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
