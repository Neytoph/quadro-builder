import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useI18n } from '../i18n'
import { useElapsedSeconds } from './useElapsedSeconds'
import './AssemblyStatus.css'

type Assembly = { active: boolean; pending: boolean; error: boolean }

export function useAssemblyStatus(assembly: Assembly) {
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (!assembly.active || assembly.pending) setStarted(false)
  }, [assembly.active, assembly.pending])
  return {
    visible: assembly.active && (assembly.pending || assembly.error || !started),
    start: () => setStarted(true),
  }
}

export function AssemblyStatus({ pending, error, progress, onWhole, onRetry, onStart }: {
  pending: boolean
  error: boolean
  progress: number
  onWhole: () => void
  onRetry: () => void
  onStart: () => void
}) {
  const { t } = useI18n()
  const seconds = useElapsedSeconds(pending)
  let state: 'error' | 'pending' | 'ready' = 'ready'
  if (pending) state = 'pending'
  if (error) state = 'error'
  const content = {
    error: { title: 'assembly.failedTitle', compact: 'assembly.mobileFailed', hint: 'assembly.failedHint', icon: <CircleAlert size={18} /> },
    pending: { title: 'assembly.planning', compact: seconds >= 5 ? 'assembly.mobileSlow' : 'assembly.mobilePlanning', hint: seconds >= 5 ? 'assembly.slowHint' : 'assembly.planningHint', icon: <svg className="assembly-status-progress" viewBox="0 0 24 24" role="progressbar" aria-label={t('assembly.planning')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><title>{progress}%</title><circle className="assembly-status-progress-track" cx="12" cy="12" r="9" /><circle className="assembly-status-progress-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress} transform="rotate(-90 12 12)" /></svg> },
    ready: { title: 'assembly.ready', compact: 'assembly.mobileReady', hint: 'assembly.readyHint', icon: <CircleCheck size={18} /> },
  }[state]
  return (
    <div data-tour="assembly" className="m-asm qb-card assembly-status fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 p-1.5 max-w-[calc(100vw-1rem)]" data-state={state}>
      <span className="assembly-status-icon" aria-hidden={state === 'pending' ? undefined : true}>
        {content.icon}
      </span>
      <div className="assembly-status-copy" role={error ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
        <div className="assembly-status-title"><span className="assembly-status-full">{t(content.title)}</span><span className="assembly-status-compact">{t(content.compact)}</span></div>
        <div className="assembly-status-hint">{t(content.hint)}</div>
      </div>
      <div className="assembly-status-actions">
        <button type="button" aria-label={t('assembly.whole')} className="qb-btn qb-btn-ghost qb-btn-sm assembly-status-button assembly-status-secondary" onClick={onWhole}><span className="assembly-status-full">{t('assembly.whole')}</span><span className="assembly-status-compact">{t('assembly.all')}</span></button>
        {state !== 'pending' && (
          <button type="button" aria-label={t(error ? 'assembly.retry' : 'assembly.start')} className="qb-btn qb-btn-sm assembly-status-button assembly-status-primary" onClick={error ? onRetry : onStart}><span className="assembly-status-full">{t(error ? 'assembly.retry' : 'assembly.start')}</span><span className="assembly-status-compact">{t(error ? 'assembly.mobileRetry' : 'assembly.mobileStart')}</span></button>
        )}
      </div>
    </div>
  )
}
