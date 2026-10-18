import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { storage } from '../engine-api'
import { useEngine } from '../store/EngineContext'
import { EDITOR_EMBED } from '../entry'
import { syncConfigured } from '../sync/bootstrap'
import { UI_ESCAPE_EVENT } from './events'
import { useDock, type DockPane } from './dock'
import { usePanelLayout } from './panelLayout'
import { track } from '../analytics/track'
import { CoachFrame, useCoachMeasure, type Prefer } from './CoachFrame'
import { usePresence } from './motion'
import { myModelsURL } from './MyModelsLink'

const KEY = 'quadro.builder.onboarded.v2'
const MANAGEMENT_KEY = 'quadro.builder.models-guide.v2:'
export const ONBOARDING_EVENT = 'quadro:onboarding'

type Step = { title: string; body: string; hint?: string; tour: string; pane: DockPane | null; color?: boolean; prefer: Prefer }
type Session = { account: string | null; management: boolean; short: boolean }
const MANAGEMENT_STEP: Step = { title: 'models.guideTitle', body: 'models.guideBody', hint: 'models.guideHint', tour: 'my-models', pane: null, prefer: 'bottom' }
const STEPS: Step[] = [
  { title: 'onboard.s1title', body: 'onboard.s1body', hint: 'onboard.s1hint', tour: 'dock-panel', pane: 'library', prefer: 'left' },
  { title: 'onboard.s2title', body: 'onboard.s2body', hint: 'onboard.s2hint', tour: 'tool-tubes', pane: null, prefer: 'bottom' },
  { title: 'onboard.s3title', body: 'onboard.s3body', tour: 'left-color', pane: null, color: true, prefer: 'right' },
  { title: 'onboard.s4title', body: 'onboard.s4body', tour: 'dock-panel', pane: 'bom', prefer: 'left' },
  { title: 'onboard.s5title', body: 'onboard.s5body', tour: 'scene-buttons', pane: null, prefer: 'bottom' },
  { title: 'onboard.s6title', body: 'onboard.s6body', hint: 'onboard.s6hint', tour: 'dock-panel', pane: 'file', prefer: 'left' },
]

function account(): string | null {
  const scope = String(storage.getAccountScope())
  return syncConfigured() && scope.startsWith('user:') ? scope.slice(5) : null
}

function guideSteps(session: Session | null): Step[] {
  if (!session?.management) return STEPS
  if (session.short) return [MANAGEMENT_STEP]
  return [MANAGEMENT_STEP, ...STEPS]
}

export default function Onboarding({ autoOpen = true }: { autoOpen?: boolean } = {}) {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const { setLeftColor } = usePanelLayout()
  const attempted = useRef(false)
  const [session, setSession] = useState<Session | null>(null)
  const [shown, leaving] = usePresence(session)
  const [i, setI] = useState(0)

  const steps = guideSteps(shown)
  const step = shown ? steps[i] : STEPS[0]
  const management = step === MANAGEMENT_STEP
  const last = i >= steps.length - 1
  const { hole, cardRef, cardH } = useCoachMeasure(!!session, i, step.tour)

  // 身份和来源模型准备完毕后再决定是否展示；内嵌编辑由父页面管理。
  useEffect(() => {
    if (!autoOpen || !api.ready || !api.entryReady || attempted.current) return
    attempted.current = true
    const owner = account(), seen = localStorage.getItem(KEY) === '1'
    const management = !!owner && localStorage.getItem(MANAGEMENT_KEY + owner) !== '1'
    if (management || !seen) setSession({ account: owner, management, short: management && seen })
  }, [autoOpen, api.ready, api.entryReady])

  const markDone = () => {
    localStorage.setItem(KEY, '1')
    if (shown?.management && shown.account) localStorage.setItem(MANAGEMENT_KEY + shown.account, '1')
  }
  const finish = (how: 'done' | 'skip' | 'esc' | 'models') => {
    track('builder.onboard.end', { how, step: i + 1, of: steps.length })
    markDone()
    setSession(null)
    setPane(null)
  }

  useEffect(() => {
    if (!session) return
    window.addEventListener('pagehide', markDone)
    return () => window.removeEventListener('pagehide', markDone)
  }, [session])

  useEffect(() => {
    const replay = () => {
      attempted.current = true
      track('builder.onboard.replay')
      setI(0)
      const owner = account()
      setSession({ account: owner, management: !!owner && !EDITOR_EMBED, short: false })
    }
    window.addEventListener(ONBOARDING_EVENT, replay)
    return () => window.removeEventListener(ONBOARDING_EVENT, replay)
  }, [])

  useEffect(() => {
    if (!session) return
    const onEsc = () => finish('esc')
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [session, i])

  useEffect(() => {
    if (!session || !management) return
    const onOpen = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-tour="my-models"]')) finish('models')
    }
    document.addEventListener('click', onOpen)
    return () => document.removeEventListener('click', onOpen)
  }, [session, i])

  useEffect(() => {
    if (!session) return
    setPane(step.pane)
    if (step.color) setLeftColor(true)
  }, [session, i, step, setPane, setLeftColor])

  if (!shown) return null
  let nextLabel = 'onboard.next'
  if (shown.short) nextLabel = 'models.continue'
  else if (last) nextLabel = 'onboard.done'

  return (
    <CoachFrame
      hole={hole} prefer={step.prefer} cardRef={cardRef} cardH={cardH} leaving={leaving}
      ui="onboard" kicker={t(management ? 'models.guideKicker' : 'onboard.kicker')} step={i} count={steps.length}
      title={t(step.title)} body={t(step.body)} hint={step.hint ? t(step.hint) : undefined}
      tryLine={management ? undefined : t('onboard.try')}
      action={management ? { label: t('models.open'), href: myModelsURL(lang), onClick: () => finish('models'), secondary: { label: t('single.find'), href: `/builder/?recover=1&lang=${lang}` } } : undefined}
      skipLabel={t('onboard.skip')} backLabel={t('onboard.back')}
      nextLabel={t(nextLabel)}
      onSkip={() => finish('skip')} onDismiss={() => finish('esc')}
      onBack={() => setI(i - 1)}
      onNext={() => { if (last) finish('done'); else { track('builder.onboard.step', { i: i + 2 }); setI(i + 1) } }}
    />
  )
}
