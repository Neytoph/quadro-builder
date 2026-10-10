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

export function AssemblyStatus({ pending, error, onWhole, onRetry, onStart }: {
  pending: boolean
  error: boolean
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
    error: { title: 'assembly.failedTitle', hint: 'assembly.failedHint', icon: <CircleAlert size={18} /> },
    pending: { title: 'assembly.planning', hint: seconds >= 5 ? 'assembly.slowHint' : 'assembly.planningHint', icon: <span className="assembly-status-spinner" /> },
    ready: { title: 'assembly.ready', hint: 'assembly.readyHint', icon: <CircleCheck size={18} /> },
  }[state]
  return (
    <div data-tour="assembly" className="m-asm qb-card assembly-status fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 p-1.5 max-w-[calc(100vw-1rem)]" data-state={state}>
      <span className="assembly-status-icon" aria-hidden="true">
        {content.icon}
      </span>
      <div className="assembly-status-copy" role={error ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
        <div className="assembly-status-title">{t(content.title)}</div>
        <div className="assembly-status-hint">{t(content.hint)}</div>
      </div>
      <div className="assembly-status-actions">
        {state === 'pending' ? (
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm assembly-status-button" onClick={onWhole}>{t('assembly.whole')}</button>
        ) : (
          <>
            <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm assembly-status-button assembly-status-secondary" onClick={onWhole}>{t('assembly.whole')}</button>
            <button type="button" className="qb-btn qb-btn-sm assembly-status-button assembly-status-primary" onClick={error ? onRetry : onStart}>{t(error ? 'assembly.retry' : 'assembly.start')}</button>
          </>
        )}
      </div>
    </div>
  )
}
