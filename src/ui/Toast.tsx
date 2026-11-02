import { useEffect } from 'react'
import { CircleCheck, X } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { usePresence } from './motion'
import './Toast.css'

export default function Toast() {
  const { toast: live, dismissToast } = useEngine()
  const { t } = useI18n()
  const [toast, leaving] = usePresence(live)
  useEffect(() => {
    if (!live || live.kind === 'saved') return
    const id = window.setTimeout(dismissToast, live.kind === 'ok' ? 2800 : 6000)
    return () => window.clearTimeout(id)
  }, [live, dismissToast])
  if (!toast) return null
  if (toast.kind === 'saved') return (
    <div data-ui="toast" data-tone="saved" key={toast.id} className={`qb-save-toast m-toast ${leaving ? 'm-leave' : ''}`}>
      <CircleCheck className="qb-save-toast-icon" size={24} aria-hidden="true" />
      <div className="qb-save-toast-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{t('toast.saveSuccess')}</strong>
        <span>{toast.message}</span>
      </div>
      <button type="button" className="qb-save-toast-close" data-button-motion="off" aria-label={t('toast.dismiss')} onClick={dismissToast} disabled={leaving}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
  const tone = toast.kind === 'err' ? 'text-red-700' : toast.kind === 'warn' ? 'text-amber-700' : 'text-gray-100'
  return (
    <div data-ui="toast" role="status" key={toast.id} className={`qb-floating-toast m-toast qb-card fixed top-[9.5rem] left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] text-center ${tone} text-sm font-medium px-4 py-2 z-[70] pointer-events-none ${leaving ? 'm-leave' : ''}`}>
      {toast.message}
    </div>
  )
}
