import { useRef } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { ONBOARDING_EVENT } from './Onboarding'

const btn = 'text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2.5 py-2 text-left cursor-pointer'

export default function FilePanel() {
  const api = useEngine()
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
      <div className="flex flex-col gap-1.5">
        <button onClick={() => api.newTab()} className={btn}>{t('btn.new')}</button>
        <button onClick={() => void api.saveCurrent()} className={btn}>{t('btn.save')}</button>
        <button onClick={() => fileRef.current?.click()} className={btn}>{t('btn.import')}</button>
        <button onClick={api.exportQdf} className={btn}>{t('btn.exportQdf')}</button>
        <button onClick={api.exportJson} className={btn}>{t('btn.exportJson')}</button>
        <button onClick={api.exportPng} className={btn}>{t('btn.exportPng')}</button>
        <button onClick={() => void api.shareCurrent()} className={btn}>{t('btn.share')}</button>
        <button onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))} className={btn}>{t('onboard.replay')}</button>
        <input ref={fileRef} type="file" accept=".qdf,.json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void api.importFile(f); e.target.value = '' }} />
      </div>
    </div>
  )
}
