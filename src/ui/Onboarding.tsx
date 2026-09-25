import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { UI_ESCAPE_EVENT } from './events'
import { useDock, type DockPane } from './dock'
import { usePanelLayout } from './panelLayout'
import { track } from '../analytics/track'
import { CoachFrame, useCoachMeasure, type Prefer } from './CoachFrame'

const KEY = 'quadro.builder.onboarded.v2'
export const ONBOARDING_EVENT = 'quadro:onboarding'

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

export default function Onboarding() {
  const { t } = useI18n()
  const { setPane } = useDock()
  const { setLeftColor } = usePanelLayout()
  const [open, setOpen] = useState(shouldOpen)
  const [i, setI] = useState(0)

  const step = STEPS[i]
  const last = i >= STEPS.length - 1
  const { hole, cardRef, cardH } = useCoachMeasure(open, i, step.tour)

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

  if (!open || !step) return null

  return (
    <CoachFrame
      hole={hole} prefer={step.prefer} cardRef={cardRef} cardH={cardH}
      ui="onboard" kicker={t('onboard.kicker')} step={i} count={STEPS.length}
      title={t(step.title)} body={t(step.body)} hint={step.hint ? t(step.hint) : undefined} tryLine={t('onboard.try')}
      skipLabel={t('onboard.skip')} backLabel={t('onboard.back')} nextLabel={last ? t('onboard.done') : t('onboard.next')}
      onSkip={() => finish('skip')}
      onBack={() => setI(i - 1)}
      onNext={() => { if (last) finish('done'); else { track('builder.onboard.step', { i: i + 2 }); setI(i + 1) } }}
    />
  )
}
