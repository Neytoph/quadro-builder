import { useEffect, useRef, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { LANGS, useI18n } from '../i18n'
import { ONBOARDING_EVENT } from './Onboarding'
import { useCollab } from '../collab/CollabContext'
import BatchImport from '../collab/ui/BatchImport'

const btn = 'text-sm rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-3 py-2.5 text-left cursor-pointer leading-snug'

export default function FilePanel() {
  const api = useEngine()
  const collab = useCollab()
  const { t, lang, setLang } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [batch, setBatch] = useState(false)
  // 共享方案随改随同步，没有「保存」；「另存为」存一份到自己的设计里
  const plan = collab.mode === 'plan'

  return (
    <div className="p-3">
      <div className="flex flex-col gap-1.5">
        {/* 手机上这块面板盖满画布，新开的标签页被挡在后面，点完得有一句话 */}
        <button onClick={() => { api.newTab(); api.notify(t('toast.newTab')) }} className={btn}>{t('btn.new')}</button>
        {!plan && <button onClick={() => void api.saveCurrent()} className={btn}>{t('btn.save')}</button>}
        <button onClick={() => void api.saveCurrentAs()} className={btn}>{t('btn.saveAs')}</button>
        <button onClick={() => fileRef.current?.click()} className={btn}>{t('btn.import')}</button>
        <button onClick={() => setBatch(true)} className={btn} data-ui="batch-open">{t('batch.open')}</button>
        <button onClick={api.exportQdf} className={btn}>{t('btn.exportQdf')}</button>
        <button onClick={api.exportJson} className={btn}>{t('btn.exportJson')}</button>
        <button onClick={api.exportPng} className={btn}>{t('btn.exportPng')}</button>
        <button
          onClick={() => void api.exportAssemblyPdf()}
          disabled={!!api.exportingManual}
          className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
        >{t('btn.exportManual')}</button>
        <button onClick={() => void api.shareCurrent()} className={btn}>{t('btn.share')}</button>
        <button onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))} className={btn}>{t('onboard.replay')}</button>
        <input ref={fileRef} type="file" accept=".qdf,.json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void api.importFile(f); e.target.value = '' }} />
      </div>
      {batch && <BatchImport onClose={() => setBatch(false)} />}

      <div className="mt-4 pt-3 border-t border-gray-800">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{t('section.room')}</div>
        <label className="flex items-center gap-2 text-sm text-gray-50 cursor-pointer mb-1.5 min-h-9">
          <input type="checkbox" checked={api.room.visible} onChange={e => api.setRoom({ visible: e.target.checked })} className="accent-sky-500" />
          {t('room.show')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-50 cursor-pointer mb-2 min-h-9">
          <input type="checkbox" checked={api.room.showExtents} onChange={e => api.setRoom({ showExtents: e.target.checked })} className="accent-sky-500" />
          {t('room.extents')}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          <CmField label={t('room.w')} value={api.room.w} onCommit={n => api.setRoom({ w: n })} />
          <CmField label={t('room.d')} value={api.room.d} onCommit={n => api.setRoom({ d: n })} />
          <CmField label={t('room.h')} value={api.room.h} onCommit={n => api.setRoom({ h: n })} />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-800">
        <div className="flex gap-1">
          {LANGS.map(item => (
            <button key={item.id} onClick={() => setLang(item.id)}
              className={`flex-1 text-sm rounded-lg py-2.5 border cursor-pointer ${lang === item.id ? 'bg-teal-500 text-white border-teal-400' : 'border-gray-700 bg-gray-800'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CmField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type="number"
        min={40}
        max={2000}
        value={txt}
        onChange={e => setTxt(e.target.value)}
        onBlur={() => onCommit(Number(txt))}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-1 py-2 text-sm tabular-nums outline-none focus:border-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}
