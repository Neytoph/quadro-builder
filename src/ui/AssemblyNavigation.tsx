import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n'
import './AssemblyNavigation.css'
import { useMobileControls } from './useMobileControls'

export default function AssemblyNavigation({ step, total, onStep, onWhole, showBadge = false }: {
  step: number
  total: number
  onStep: (delta: number) => void
  onWhole: () => void
  showBadge?: boolean
}) {
  const { t } = useI18n()
  const mobile = useMobileControls()
  const lastStep = useRef(step)
  const direction = step >= lastStep.current ? 'up' : 'down'
  useEffect(() => { lastStep.current = step }, [step])
  const label = t('assembly.step', { k: step + 1, n: total })
  return (
    <div data-tour="assembly" className="m-asm qb-card assembly-navigation fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 max-w-[calc(100vw-1rem)]">
      {showBadge && !mobile && <button type="button" onClick={onWhole} className="qb-btn qb-btn-sm assembly-navigation-badge" title={t('assembly.allHint')}>{t('asm.steps', { n: total })}</button>}
      <button type="button" disabled={step <= 0} onClick={() => onStep(-1)} className="assembly-navigation-button" aria-label={t('assembly.prev')}>
        <ChevronLeft size={16} aria-hidden="true" /><span className="assembly-navigation-label">{t('assembly.prev')}</span>
      </button>
      <div className="assembly-navigation-count qb-num" role="status" aria-live="polite" aria-label={label}>
        <span key={step} className="m-tick inline-block" data-dir={direction} aria-hidden="true"><span className="assembly-navigation-label">{label}</span><span className="assembly-navigation-fraction">{step + 1} / {total}</span></span>
      </div>
      <button type="button" disabled={step >= total - 1} onClick={() => onStep(1)} className="assembly-navigation-button" aria-label={t('assembly.next')}>
        <span className="assembly-navigation-label">{t('assembly.next')}</span><ChevronRight size={16} aria-hidden="true" />
      </button>
      <button type="button" onClick={onWhole} className="assembly-navigation-button assembly-navigation-whole" aria-label={t('assembly.whole')}>{t('assembly.all')}</button>
    </div>
  )
}
