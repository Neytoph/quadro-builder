import { useEffect, useRef } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import './saveConflict.css'

export default function SaveConflictDialog() {
  const { saveConflict, answerSaveConflict, saving } = useEngine(), { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = dialog.current
    if (!saveConflict || !element) return
    const focused = document.activeElement as HTMLElement | null
    const previous = focused && focused !== document.body && !element.contains(focused) ? focused : document.querySelector<HTMLElement>('.qb-single-save')
    element.showModal()
    return () => { element.close(); restoreFocus.current = previous }
  }, [saveConflict])
  useEffect(() => {
    if (saveConflict || saving) return
    const target = restoreFocus.current
    const frame = requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
      if (restoreFocus.current === target) restoreFocus.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [saveConflict, saving])
  if (!saveConflict) return null
  return <dialog ref={dialog} aria-labelledby="save-conflict-title" aria-describedby="save-conflict-body"
    className="qb-card qb-save-conflict text-gray-100"
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus() }
    }}
    onCancel={event => { event.preventDefault(); answerSaveConflict('cancel') }}>
    <h2 id="save-conflict-title" className="text-base font-semibold">{t('saveConflict.title')}</h2>
    <p id="save-conflict-body" className="mt-3 text-sm">{t('saveConflict.body')}</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button autoFocus className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => answerSaveConflict('cancel')}>{t('saveConflict.keep')}</button>
      <button className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => answerSaveConflict('latest')}>{t('saveConflict.latest')}</button>
      <button className="qb-btn qb-btn-sm" onClick={() => answerSaveConflict('copy')}>{t('saveConflict.copy')}</button>
    </div>
  </dialog>
}
