import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { UI_ESCAPE_EVENT } from '../../ui/events'
import { useDock } from '../../ui/dock'
import { NARROW_MAX, usePanelLayout } from '../../ui/panelLayout'
import { CoachFrame, useCoachMeasure } from '../../ui/CoachFrame'
import { useCollab } from '../CollabContext'
import { coachKind, coachSeen, coachSteps, markCoachSeen, type CoachKind } from '../coach'

/**
 * 第一次进共享方案的提示气泡：点零件写意见、留言区、版本对照。样子和做法同 builder 自带的引导，
 * 每个人只出一次，访客只出前两步。方案还没打开、正在对照、邀请弹层开着的时候先不出。
 */
export default function CollabCoach() {
  const collab = useCollab()
  const plan = collab.plan
  const ready = collab.enabled && collab.mode === 'plan' && !!plan && !collab.compare && !collab.joinAsk && !collab.error
  const kind = ready && plan ? coachKind(plan) : null
  // 看过以后重新渲染一次，让 coachSeen 读到新值
  const [, setSeenRev] = useState(0)
  const open = kind != null && !coachSeen(kind)
  return open && kind && plan ? <Coach kind={kind} brief={plan.briefId != null} onDone={() => setSeenRev(r => r + 1)} /> : null
}

function Coach({ kind, brief, onDone }: { kind: CoachKind; brief: boolean; onDone: () => void }) {
  const { t } = useI18n()
  const { setPane, setCommentsTab } = useDock()
  const { vw } = usePanelLayout()
  const steps = coachSteps(kind, vw <= NARROW_MAX, brief)
  const [i, setI] = useState(0)
  const step = steps[i]
  const last = i === steps.length - 1
  const { hole, cardRef, cardH } = useCoachMeasure(true, i, step.tour)

  const finish = () => {
    markCoachSeen(kind)
    setPane(null)
    setCommentsTab(null)
    onDone()
  }

  // 看到一半离开页面也算看过，同 builder 自带的引导
  useEffect(() => {
    const leave = () => markCoachSeen(kind)
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [kind])

  useEffect(() => {
    window.addEventListener(UI_ESCAPE_EVENT, finish)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, finish)
  })

  useEffect(() => {
    if (step.pane === 'comments') setCommentsTab('chat')
    setPane(step.pane)
    // 被指的东西在横着划的工具条或顶栏里看不见时，先划进来
    document.querySelector(`[data-tour="${step.tour}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [step.id, step.pane, step.tour, setPane, setCommentsTab])

  return (
    <CoachFrame
      hole={hole} prefer={step.prefer} cardRef={cardRef} cardH={cardH}
      ui="collab-coach" kicker={t('coach.kicker')} step={i} count={steps.length}
      title={t(step.title)} body={t(step.body)} hint={step.hint ? t(step.hint) : undefined}
      tryLine={step.id === 'pin' || step.id === 'login' ? t('onboard.try') : undefined}
      skipLabel={t('onboard.skip')} backLabel={t('onboard.back')} nextLabel={last ? t('coach.done') : t('onboard.next')}
      onSkip={finish}
      onBack={() => setI(i - 1)}
      onNext={() => { if (last) finish(); else setI(i + 1) }}
    />
  )
}
