import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { UI_ESCAPE_EVENT } from './events'

const KEY = 'quadro.builder.onboarded.v1'
export const ONBOARDING_EVENT = 'quadro:onboarding'

const STEPS = [
  { title: 'onboard.s1title', body: 'onboard.s1body' },
  { title: 'onboard.s2title', body: 'onboard.s2body' },
  { title: 'onboard.s3title', body: 'onboard.s3body' },
  { title: 'onboard.s4title', body: 'onboard.s4body' },
  { title: 'onboard.s5title', body: 'onboard.s5body' },
] as const

function shouldOpen(): boolean {
  try { return localStorage.getItem(KEY) !== '1' } catch { return true }
}

function markDone() {
  try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
}

export default function Onboarding() {
  const { t } = useI18n()
  const [open, setOpen] = useState(shouldOpen)
  const [i, setI] = useState(0)

  useEffect(() => {
    const replay = () => { setI(0); setOpen(true) }
    window.addEventListener(ONBOARDING_EVENT, replay)
    return () => window.removeEventListener(ONBOARDING_EVENT, replay)
  }, [])

  useEffect(() => {
    if (!open) return
    const onEsc = () => { markDone(); setOpen(false); setI(0) }
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [open])

  if (!open) return null
  const last = i >= STEPS.length - 1
  const step = STEPS[i]
  const close = () => { markDone(); setOpen(false); setI(0) }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/45 p-4" onClick={close}>
      <div className="w-full max-w-md bg-gray-900 text-white rounded-2xl border border-gray-700 shadow-2xl p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-teal-400">
            {t('onboard.kicker')} · {i + 1}/{STEPS.length}
          </div>
          <button onClick={close} className="text-gray-400 hover:text-white text-sm cursor-pointer">{t('onboard.skip')}</button>
        </div>
        <div className="text-base font-semibold mb-2">{t(step.title)}</div>
        <p className="text-sm text-gray-300 leading-relaxed mb-5">{t(step.body)}</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex gap-1">
            {STEPS.map((_, k) => (
              <div key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-teal-400' : 'bg-gray-700'}`} />
            ))}
          </div>
          {i > 0 && (
            <button onClick={() => setI(i - 1)} className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 cursor-pointer">
              {t('onboard.back')}
            </button>
          )}
          <button
            onClick={() => { if (last) close(); else setI(i + 1) }}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-500 hover:bg-teal-400 text-gray-950 cursor-pointer"
          >
            {last ? t('onboard.done') : t('onboard.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
